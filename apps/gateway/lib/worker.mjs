import { randomUUID } from 'node:crypto';
import { assert, Fault } from './security.mjs';
import { evaluateSales, wantsNoContact } from './sales.mjs';
import { terminal } from './service.mjs';

/** No automatic redial. An interrupted execution is UNKNOWN, never silently requeued. */
export class Worker {
  constructor(service, channels, execute) { this.service=service; this.store=service.store; this.channels=channels; this.execute=execute; this.holder=randomUUID(); this.active=null; this.busy=false; }
  start() {
    assert(this.store.lease(this.holder),'another_gateway_worker_is_active',409);
    for(const m of this.store.list('mission')) if(['DIALING','ACTIVE','VERIFYING','CANCEL_REQUESTED','HANDOFF_PENDING','HANDOFF_ACTIVE'].includes(m.status)) {
      m.status='UNKNOWN'; m.finishedAt=this.store.now(); m.error='worker_interrupted_reconcile_carrier_before_retry'; this.store.put('mission',m); this.service.notify(m,'result');
    }
    // Inbox and notifications can be retried; telephone attempts cannot.
    for(const f of this.store.list('followup',undefined,'EXECUTING')) { f.status='UNKNOWN'; f.error='process_interrupted_do_not_resend_without_reconciliation'; this.store.put('followup',f); }
    for(const kind of ['inbox','outbox']) for(const j of this.store.list(kind,undefined,'processing')) { j.status='pending'; this.store.put(kind,j); }
    this.leaseTimer=setInterval(() => { if(!this.store.lease(this.holder)) { this.active?.abort.abort(); clearInterval(this.timer); } },5000);
    this.controlTimer=setInterval(()=>{if(this.active && this.store.get('mission',this.active.id)?.status==='CANCEL_REQUESTED')this.active.abort.abort();},200);
    this.timer=setInterval(() => { void this.tick().catch(() => {}); },300);
  }
  async processQueue(kind, handler) {
    const job=this.store.next(kind); if(!job) return;
    job.status='processing'; this.store.put(kind,job);
    try { await handler(job); job.status='done'; }
    catch { job.attempts++; job.status=job.attempts>=5?'failed':'pending'; job.available=this.store.now()+Math.min(60_000,1000*2**job.attempts); }
    this.store.put(kind,job);
  }
  async tick() {
    if(this.busy) return; this.busy=true;
    try {
      await this.processQueue('inbox',j=>this.channels.process(j));
      await this.processQueue('outbox',j=>this.channels.send(j));
      if(this.active) { const m=this.store.get('mission',this.active.id); if(m?.status==='CANCEL_REQUESTED') this.active.abort.abort(); return; }
      const m=this.store.list('mission',undefined,'QUEUED').reverse()[0]; if(!m) return;
      const u=this.service.user(m.owner);
      try { this.service.checkPolicy(u,m); assert(m.approvalExpiresAt>this.store.now(),'queued_approval_expired',409); }
      catch(e) { m.status='FAILED'; m.finishedAt=this.store.now(); m.error=e.code??'policy_rejected'; this.store.put('mission',m); this.store.audit(m.owner,'call.policy_rejected',m.id,{mission:m.id,error:m.error}); this.service.notify(m,'result'); return; }
      m.status='DIALING'; m.executionId=randomUUID(); this.store.put('mission',m); this.store.event(m,{type:'status',status:'DIALING'});
      this.store.audit(m.owner,'call.dialing',m.id,{mission:m.id,execution:m.executionId,target:this.store.phoneRef(m.target.phone),mode:m.mode,approvedAt:m.approvedAt});
      this.service.notify(m,'発信しています。');
      const active={ id:m.id,abort:new AbortController(),control:{} }; this.active=active;
      active.promise=this.run(m,active).finally(()=>{ if(this.active===active) this.active=null; });
    } finally { this.busy=false; }
  }
  /** Suppress and leave a trace of why: a number that silently stops being callable is as hard to explain as one that does not. */
  suppress(m,source,turn) { this.store.suppress(m.team,m.target.phone); this.store.audit(m.owner,'contact.suppressed',m.id,{mission:m.id,target:this.store.phoneRef(m.target.phone),source,...(turn?{turn}:{})}); }
  finished(current,connected) { this.store.audit(current.owner,'call.result',current.id,{mission:current.id,status:current.status,connected,carrierSid:current.carrierSid??null,doNotContact:current.result?.doNotContact===true,verified:Object.keys(current.result?.verified??{}),error:current.error??null}); }
  async run(m,active) {
    const turns=[]; let connected=false;
    const watchdog=setTimeout(()=>active.abort.abort(),(m.maxSeconds+30)*1000);
    const onEvent=e=>{
      const current=this.store.get('mission',m.id); if(!current) return;
      if(e.type==='call.connected') { connected=true; if(current.status==='DIALING') current.status='ACTIVE'; }
      if(e.type==='carrier.sid') current.carrierSid=e.sid;
      if(e.type==='callee.consent') current.calleeConsented=true;
      if(e.type==='contact.opt_out') { current.optOut=true; this.suppress(m,'dtmf'); active.abort.abort(); }
      if(e.type==='transcript.final') {
        turns.push({id:e.turnId,source:e.source,text:e.text,t:e.t});
        if(e.source==='callee' && wantsNoContact(e.text)) { this.suppress(m,'transcript',e.turnId); active.abort.abort(); }
      }
      if(['call.connected','carrier.sid','callee.consent','contact.opt_out','transcript.final','permission.requested','permission.decided','handoff'].includes(e.type)) {
        this.store.event(current,e); this.store.put('mission',current);
      }
    };
    try {
      const outcome=await this.execute(m,{signal:active.abort.signal,onEvent,control:active.control,service:this.service});
      if(!turns.length && outcome.transcript) turns.push(...outcome.transcript);
      const result=evaluateSales(turns,m,connected,this.store.now());
      if(this.store.get('mission',m.id)?.optOut) { result.status='DECLINED'; result.doNotContact=true; result.verified={}; result.evidence.push({field:'do_not_contact',source:'dtmf',value:true,quote:'電話の連絡停止操作（2）'}); }
      if(result.doNotContact && !this.store.suppressed(m.team,m.target.phone)) this.suppress(m,'verdict');
      const current=this.store.get('mission',m.id);
      current.result=result; current.transcript=turns; current.runtimeResult=outcome.result??null;
      current.status=result.doNotContact?'DECLINED':current.status==='CANCEL_REQUESTED'?'CANCELLED':active.abort.signal.aborted?'INCOMPLETE':result.status;
      if(current.handoff?.status && current.handoff.status!=='COMPLETED') current.status=current.handoff.status==='UNKNOWN'?'UNKNOWN':current.handoff.status==='CONNECTED'?'HANDOFF_ACTIVE':'HANDOFF_PENDING';
      if(current.stopNeedsReconciliation) current.status='UNKNOWN';
      if(terminal(current.status)) current.finishedAt=this.store.now();
      this.store.put('mission',current); this.store.event(current,{type:'result',status:current.status,result}); this.finished(current,connected); this.service.notify(current,'result');
    } catch(e) {
      const current=this.store.get('mission',m.id); if(!current) return;
      const result=evaluateSales(turns,m,connected,this.store.now());
      if(this.store.get('mission',m.id)?.optOut) { result.status='DECLINED'; result.doNotContact=true; result.verified={}; result.evidence.push({field:'do_not_contact',source:'dtmf',value:true,quote:'電話の連絡停止操作（2）'}); }
      if(result.doNotContact && !this.store.suppressed(m.team,m.target.phone)) this.suppress(m,'verdict');
      current.status=result.doNotContact?'DECLINED':current.status==='CANCEL_REQUESTED'?'CANCELLED':e.uncertain?'UNKNOWN':'FAILED';
      if(current.stopNeedsReconciliation) current.status='UNKNOWN';
      current.error=e.code??'execution_failed'; current.result=result; current.transcript=turns; current.finishedAt=this.store.now();
      this.store.put('mission',current); this.store.event(current,{type:'result',status:current.status}); this.finished(current,connected); this.service.notify(current,'result');
    } finally { clearTimeout(watchdog); }
  }
  async stop() {
    clearInterval(this.timer); clearInterval(this.leaseTimer); clearInterval(this.controlTimer); this.active?.abort.abort();
    if(this.active?.promise) await this.active.promise;
    this.store.db.prepare('DELETE FROM lease WHERE holder=?').run(this.holder);
  }
}
/** Demonstration is explicit and cannot reach a carrier. It deliberately returns no fabricated success. */
export async function simulate(m,{signal,onEvent}) {
  onEvent({type:'call.connected'});
  const turns=[{id:'sim-1',source:'caller',text:`${m.product.name}についてAIアシスタントからご案内です。`},{id:'sim-2',source:'callee',text:'資料を送ってください。日程はまだ決められません。'}];
  for(const t of turns) { if(signal.aborted) break; await new Promise(r=>setTimeout(r,200)); onEvent({type:'transcript.final',turnId:t.id,...t}); }
  return {transcript:turns,result:{simulation:true}};
}
