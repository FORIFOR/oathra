import { phoneMemory } from '../../../packages/core/dist/index.js';
import { randomUUID } from 'node:crypto';
import { assert, Fault } from './security.mjs';
import { evaluateSales, wantsNoContact } from './sales.mjs';
import { terminal } from './service.mjs';
import { spendingProgress } from './credit-guard.mjs';
import { METERED, applyBillingEvent, finishBilling } from './billing.mjs';

/** No automatic redial. An interrupted execution is UNKNOWN, never silently requeued. */
export class Worker {
  constructor(service, channels, execute) { this.service=service; this.store=service.store; this.channels=channels; this.execute=execute; this.holder=randomUUID(); this.active=null; this.busy=false; }
  start() {
    assert(this.store.lease(this.holder),'another_gateway_worker_is_active',409);
    const recovery=new Map([...this.store.list('mission'),...this.service.credits.pendingMissions()].map(m=>[m.id,m]));
    // A crash can also land after the terminal result write but before run.finally.
    for(const m of recovery.values())if(m.billing?.state==='pending'&&m.executionId&&!['DRAFT','QUEUED'].includes(m.status)){
      finishBilling(m);this.store.put('mission',m);
    }
    for(const m of recovery.values()) if(['DIALING','ACTIVE','VERIFYING','CANCEL_REQUESTED','HANDOFF_PENDING','HANDOFF_ACTIVE'].includes(m.status)) {
      if(m.billing)m.billing.executionFinished=true;
      m.status='UNKNOWN'; m.finishedAt=this.store.now(); m.error='worker_interrupted_reconcile_carrier_before_retry'; this.store.put('mission',m); this.service.notify(m,'result');
    }
    for(const m of recovery.values())if(m.billing?.state==='pending'&&m.creditQuote?.tariff?.settlement==='usage-rate-v1'){
      // One call that cannot be settled must not keep the whole service from starting; its hold stays for an administrator.
      try{this.store.tx(()=>this.service.credits.settleTx(this.store.get('mission',m.id)));}
      catch(error){this.log('billing.recovery_failed',error,{mission:m.id});}
    }
    // Inbox and notifications can be retried; telephone attempts cannot.
    for(const f of this.store.list('followup',undefined,'EXECUTING')) { f.status='UNKNOWN'; f.error='process_interrupted_do_not_resend_without_reconciliation'; this.store.put('followup',f); }
    for(const kind of ['inbox','outbox']) for(const j of this.store.list(kind,undefined,'processing')) { j.status='pending'; this.store.put(kind,j); }
    this.leaseTimer=setInterval(() => { if(!this.store.lease(this.holder)) { this.active?.abort.abort(); clearInterval(this.timer); } },5000);
    this.controlTimer=setInterval(()=>{if(this.active && this.store.get('mission',this.active.id)?.status==='CANCEL_REQUESTED')this.active.abort.abort();},200);
    this.timer=setInterval(() => { void this.tick().catch(e => this.log('worker.tick_failed',e)); },300);
  }
  /** Codes only: never message text, names or numbers. */
  log(event,error,extra={}) { console.error(JSON.stringify({level:'error',event,code:error?.code??error?.name??'error',...extra,at:new Date(this.store.now()).toISOString()})); }
  async processQueue(kind, handler) {
    const job=this.store.next(kind); if(!job) return;
    job.status='processing'; this.store.put(kind,job);
    try { await handler(job); job.status='done'; }
    catch(e) { job.attempts++; job.status=job.attempts>=5?'failed':'pending'; job.available=this.store.now()+Math.min(60_000,1000*2**job.attempts); if(job.status==='failed') this.log(`${kind}.gave_up`,e,{job:job.id.slice(0,80),attempts:job.attempts}); }
    this.store.put(kind,job);
  }
  async tick() {
    if(this.busy) return; this.busy=true;
    try {
      await this.processQueue('inbox',j=>this.channels.process(j));
      await this.processQueue('outbox',j=>this.channels.send(j));
      if(this.active) { const m=this.store.get('mission',this.active.id); if(m?.status==='CANCEL_REQUESTED') this.active.abort.abort(); return; }
      const m=this.claimNext();
      if(!m)return;
      this.service.notify(m,'発信しています。');
      const active={ id:m.id,abort:new AbortController(),control:{} }; this.active=active;
      active.promise=this.run(m,active).catch(error=>this.log('call.run_failed',error,{mission:m.id})).finally(()=>{ if(this.active===active) this.active=null; });
    } finally { this.busy=false; }
  }
  /** Atomically commits an execution claim and its credits; does not contact a carrier. */
  claimNext() {
    return this.store.tx(()=>{
        const m=this.store.list('mission',undefined,'QUEUED').reverse()[0];if(!m)return null;
        const lease=this.store.db.prepare('SELECT * FROM lease WHERE id=1').get();
        assert(!lease||lease.holder===this.holder,'worker_lease_lost',409);
        this.store.db.prepare('INSERT INTO lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires').run(this.holder,this.store.now()+30000);
        // A capture that cannot succeed fails this call only; left outside, it would block every call queued behind it.
        try {const u=this.service.user(m.owner);this.service.checkPolicy(u,m);assert(m.approvalExpiresAt>this.store.now(),'queued_approval_expired',409);this.service.credits.captureTx(m);}
        catch(e){m.status='FAILED';m.finishedAt=this.store.now();m.error=e.code??'policy_rejected';this.service.credits.releaseTx(m);this.store.put('mission',m);this.store.audit(m.owner,'call.policy_rejected',m.id,{mission:m.id,error:m.error});this.service.notify(m,'result');return null;}
        if(m.creditQuote?.policy===METERED)m.billing={state:'pending'};
        m.status='DIALING';m.executionId=randomUUID();this.store.put('mission',m);this.store.event(m,{type:'status',status:'DIALING'});
        this.store.audit(m.owner,'call.dialing',m.id,{mission:m.id,execution:m.executionId,target:this.store.phoneRef(m.target.phone),mode:m.mode,approvedAt:m.approvedAt});
        return m;
      });
  }
  /** Suppress and leave a trace of why: a number that silently stops being callable is as hard to explain as one that does not. */
  suppress(m,source,turn) { this.store.suppress(m.team,m.target.phone); this.store.audit(m.owner,'contact.suppressed',m.id,{mission:m.id,target:this.store.phoneRef(m.target.phone),source,...(turn?{turn}:{})}); }
  finished(current,connected) { this.store.audit(current.owner,'call.result',current.id,{mission:current.id,status:current.status,connected,carrierSid:current.carrierSid??null,doNotContact:current.result?.doNotContact===true,verified:Object.keys(current.result?.verified??{}),error:current.error??null}); }
  async run(m,active) {
    const turns=[]; let connected=false;
    const watchdog=setTimeout(()=>active.abort.abort(),(m.maxSeconds+30)*1000);
    let creditStopping=false;
    const checkCredits=()=>{
      const current=this.store.get('mission',m.id);
      if(!current||creditStopping||active.abort.signal.aborted||current.status==='CANCEL_REQUESTED'||current.billing?.timing||current.carrierStatus==='completed'||current.billing?.executionFinished||terminal(current.status))return;
      const progress=spendingProgress(current,this.store.now());
      if(!progress)return;
      current.billing.spending=progress;
      if(progress.stop){
        creditStopping=true;current.stopReason='credit_limit';current.status='CANCEL_REQUESTED';
        this.store.event(current,{type:'credit.limit',limit:progress.limit});
      }
      this.store.put('mission',current);
      if(progress.stop)active.abort.abort();
    };
    const creditTimer=setInterval(()=>{try{checkCredits()}catch(error){this.log('credit.monitor_failed',error,{mission:m.id});creditStopping=true;active.abort.abort();}},250);
    const onEvent=e=>{
      const current=this.store.get('mission',m.id); if(!current) return;
      let shouldAbort=false;
      if(['billing.search','billing.timing'].includes(e.type)){applyBillingEvent(current,e);this.store.put('mission',current);checkCredits();return;}
      if(e.type==='error') {
        const diagnostic={type:'runtime.error',code:/^[a-z][a-z0-9_]{0,99}$/.test(e.code??'')?e.code:'runtime_error',fatal:e.fatal!==false,...(Number.isFinite(e.t)?{t:e.t}:{})};
        this.store.event(current,diagnostic);
        if(diagnostic.fatal){current.runtimeError=diagnostic;this.store.put('mission',current);this.log('call.runtime_failed',diagnostic,{mission:m.id});}
        return;
      }
      if(e.type==='call.connected') { if(current.billing)current.billing.connectedAt=this.store.now();connected=true; if(current.status==='DIALING') current.status='ACTIVE'; }
      if(e.type==='carrier.sid') current.carrierSid=e.sid;
      if(e.type==='callee.consent') current.calleeConsented=true;
      if(e.type==='recording.notice') current.recordingNotice={method:e.method,text:e.text};
      if(e.type==='contact.opt_out') { current.optOut=true; this.suppress(m,'dtmf'); shouldAbort=true; }
      if(e.type==='transcript.final') {
        turns.push({id:e.turnId,source:e.source,text:e.text,t:e.t,...(e.interrupted?{interrupted:true}:{})});
        if(current.kind==='phone-request')current.memory=phoneMemory(current.inbound?.reception?{...current.phoneRequest,conversationMode:'chat'}:current.phoneRequest,turns,current.approvedAt??current.createdAt);
        if(e.source==='callee' && wantsNoContact(e.text)) { this.suppress(m,'transcript',e.turnId); shouldAbort=true; }
      }
      if(['call.connected','carrier.sid','callee.consent','recording.notice','contact.opt_out','transcript.final','permission.requested','permission.decided','handoff','news.lookup'].includes(e.type)) {
        this.store.event(current,e); this.store.put('mission',current);
      }
      checkCredits();
      if(shouldAbort)active.abort.abort(); // Closing the voice engine may synchronously persist usage.
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
      // A cancellation request cannot prove a timed-out carrier request never connected.
      current.status=e.uncertain?'UNKNOWN':result.doNotContact?'DECLINED':current.status==='CANCEL_REQUESTED'?'CANCELLED':'FAILED';
      if(current.stopNeedsReconciliation) current.status='UNKNOWN';
      current.error=e.code??'execution_failed'; current.result=result; current.transcript=turns; current.finishedAt=this.store.now();
      this.store.put('mission',current); this.store.event(current,{type:'result',status:current.status}); this.finished(current,connected); this.service.notify(current,'result');
    } finally {
      clearTimeout(watchdog);clearInterval(creditTimer);
      this.store.tx(()=>{const current=this.store.get('mission',m.id);if(current?.billing){finishBilling(current);
        this.store.put('mission',current);this.service.credits.settleTx(current);
      }});
    }
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
