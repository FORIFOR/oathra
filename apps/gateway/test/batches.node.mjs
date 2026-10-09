// One approval for the same call to a list of saved contacts; each call still passes every ordinary check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Worker } from '../lib/worker.mjs';
import { Alerts } from '../lib/alerts.mjs';
import { Batches } from '../lib/batches.mjs';
import { hash } from '../lib/security.mjs';
const start=Date.parse('2026-10-02T10:00:00+09:00');
function fixture({live=false,lines=1,callHours}={}){
  let clock=start,reply='検討します';
  const config={mode:live?'live':'simulator',liveReady:live,users:[{id:'alice',team:'one',role:'operator',tokenHash:hash('alice')},{id:'bob',team:'one',role:'operator',tokenHash:hash('bob')},{id:'viewer',team:'one',role:'viewer',tokenHash:hash('viewer')}],
    maxSeconds:300,maxCallUsd:10,dailyCalls:0,dailyUsd:0,rateCeilingUsd:0.25,setupFeeUsd:0,consentVersion:'v1',callerId:live?'+815000000000':undefined,publicUrl:'https://gateway.test',missing:[],maxConcurrentCalls:lines,...(callHours?{callHours}:{})};
  const store=new Store(':memory:',randomBytes(32).toString('hex'),()=>clock),service=new Service(store,config),alice=config.users[0];
  service.saveConsent(alice,'v1');service.saveConsent(config.users[1],'v1');
  const product=service.product(alice,{name:'Example product',facts:'Only the reviewed feature.',reviewed:true});
  const contact=(n,extra={})=>service.contact(alice,{name:`取引先${n}`,phone:`+8190000002${String(n).padStart(2,'0')}`,relationship:'customer',basis:'既存の取引先',...extra});
  const alerts=new Alerts(service,null),batches=new Batches(service,alerts),dialed=[];
  const execute=async(m,{onEvent})=>{dialed.push(m.target.name);const said=typeof reply==='function'?reply(m):reply;if(said===null)return {};onEvent({type:'call.connected'});onEvent({type:'transcript.final',turnId:'t1',source:'callee',text:typeof reply==='function'?reply(m):reply});return {};};
  const worker=new Worker(service,{process:async()=>{},send:async()=>{}},execute,alerts,null,batches);worker.log=()=>{};
  const pass=async()=>{clock+=1000;await worker.tick();await Promise.all([...worker.running.values()].map(a=>a.promise));};
  const sales=(ids,key='batch-key-1',extra={})=>batches.create(alice,{kind:'sales',contactIds:ids,sales:{productId:product.id,request:'新しいプランのご案内',goal:'introduce'},acknowledged:true,...extra},key);
  return {config,store,service,alice,product,contact,batches,worker,dialed,pass,sales,says(v){reply=v;},advance(ms){clock+=ms;},close(){store.close();}};
}
const using=(fn,options)=>async()=>{const f=fixture(options);try{await fn(f);}finally{await f.worker.stop();f.close();}};
const code=fn=>{try{fn();return null;}catch(e){return e.code??e.name;}};

test('a list needs an explicit approval, the person’s own saved contacts, and at least one who can be called',using(f=>{
  const a=f.contact(1);
  assert.equal(code(()=>f.sales([a.id],'batch-key-1',{acknowledged:false})),'explicit_batch_approval_required');
  assert.equal(code(()=>f.sales([])),'batch_1_to_100_contacts');assert.equal(code(()=>f.sales([a.id,a.id])),'batch_1_to_100_contacts');
  assert.equal(code(()=>f.sales(['00000000-0000-4000-8000-000000000000'])),'not_found');
  assert.equal(code(()=>f.batches.create(f.config.users[1],{kind:'sales',contactIds:[a.id],sales:{productId:f.product.id,request:'x'},acknowledged:true},'bob-key-01')),'not_found');
  assert.equal(code(()=>f.batches.create(f.config.users[2],{kind:'sales',contactIds:[a.id],sales:{productId:f.product.id,request:'x'},acknowledged:true},'viewer-key-1')),'read_only_account');
  assert.equal(code(()=>f.batches.create(f.alice,{kind:'request',contactIds:[a.id],request:{instruction:'納期を確認してください。',task:'reservation'},acknowledged:true},'batch-key-2')),'batch_cannot_reserve');
  assert.equal(code(()=>f.batches.create(f.alice,{kind:'request',contactIds:[a.id],request:{instruction:'納期を確認',phone:'+819011112222'},acknowledged:true},'batch-key-3')),'batch_request_names_no_recipient');
  f.store.suppress('one',a.phone,'transcript');assert.equal(code(()=>f.sales([a.id])),'batch_has_no_callable_contact');
}));
test('the approval screen is told who will not be called and why; the same key returns the same list',using(f=>{
  const ok=f.contact(1),noBasis=f.contact(2,{basis:''}),stopped=f.contact(3),noPhone=f.service.contact(f.alice,{name:'番号なし'});f.store.suppress('one',stopped.phone,'dtmf');
  const ids=[ok.id,noBasis.id,stopped.id,noPhone.id],preview=f.batches.preview(f.alice,{kind:'sales',contactIds:ids});
  assert.equal(f.store.list('batch').length,0,'a preview creates nothing');
  const b=f.sales(ids);assert.deepEqual(preview.items,b.items);assert.equal(preview.callable,2);
  // A written basis is a note, not a requirement (2026-10-04); who asked not to be called and a missing number still leave a contact out.
  assert.deepEqual(b.items.map(i=>[i.state,i.reason??null]),[['PENDING',null],['PENDING',null],['SKIPPED','recipient_suppressed'],['SKIPPED','contact_phone_required']]);
  assert.deepEqual(b.counts,{pending:2,calling:0,done:0,skipped:2,failed:0});assert.equal(b.fingerprint,undefined);
  assert.equal(f.sales([ok.id,noBasis.id,stopped.id,noPhone.id]).id,b.id);assert.equal(code(()=>f.sales([ok.id])),'idempotency_conflict');
}));

test('calls leave one at a time, each through the ordinary start, and the list finishes with every outcome',using(async f=>{
  const ids=[1,2,3].map(n=>f.contact(n).id),b=f.sales(ids);
  await f.pass();assert.deepEqual(f.dialed,['取引先1']);
  assert.equal(f.store.list('mission').filter(m=>m.batch?.id===b.id).every(m=>m.approvedAt),true);
  await f.pass();await f.pass();await f.pass();
  assert.deepEqual(f.dialed,['取引先1','取引先2','取引先3']);
  const done=f.batches.list(f.alice)[0];
  assert.equal(done.status,'FINISHED');assert.deepEqual(done.items.map(i=>[i.state,typeof i.outcome]),[['DONE','string'],['DONE','string'],['DONE','string']]);
  await f.pass();assert.equal(f.dialed.length,3,'nothing is redialled');
}));
test('with two lines the list uses both',using(async f=>{
  f.sales([1,2,3].map(n=>f.contact(n).id));f.worker.execute=(m,hooks)=>new Promise(r=>{f.dialed.push(m.target.name);hooks.signal.addEventListener('abort',()=>r({}));});
  await f.worker.tick();assert.equal(f.dialed.length,2);assert.equal(f.worker.running.size,2);
},{lines:2}));
test('a refusal suppresses that contact as always and the list goes on to the next',using(async f=>{
  const [a,b]=[1,2].map(n=>f.contact(n));f.says(m=>m.target.name==='取引先1'?'今後は電話しないでください':'資料をお願いします');f.sales([a.id,b.id]);
  await f.pass();await f.pass();await f.pass();
  assert.equal(f.store.suppressed('one',a.phone),true);assert.deepEqual(f.dialed,['取引先1','取引先2']);
  assert.deepEqual(f.batches.list(f.alice)[0].items.map(i=>i.outcome),['DECLINED',f.store.list('mission').find(m=>m.target.name==='取引先2').status]);
}));
test('a contact who asked not to be called after the approval is skipped, not called',using(async f=>{
  const [a,b]=[1,2].map(n=>f.contact(n));f.sales([a.id,b.id]);f.store.suppress('one',a.phone,'dtmf');
  await f.pass();await f.pass();
  assert.deepEqual(f.dialed,['取引先2']);assert.deepEqual(f.batches.list(f.alice)[0].items.map(i=>[i.state,i.reason??null]),[['SKIPPED','recipient_suppressed'],['DONE',null]]);
}));
test('paused and ended lists place no call; ending marks what was not called',using(async f=>{
  const b=f.sales([1,2].map(n=>f.contact(n).id));
  f.batches.set(f.alice,b.id,'PAUSED');await f.pass();assert.equal(f.dialed.length,0);
  assert.equal(code(()=>f.batches.set(f.config.users[1],b.id,'ACTIVE')),'not_found');
  f.batches.set(f.alice,b.id,'ACTIVE');await f.pass();assert.equal(f.dialed.length,1);
  const ended=f.batches.set(f.alice,b.id,'ENDED');assert.deepEqual(ended.items.map(i=>[i.state,i.reason??null]),[['CALLING',null],['SKIPPED','ended_by_owner']]);
  await f.pass();await f.pass();assert.equal(f.dialed.length,1);assert.equal(code(()=>f.batches.set(f.alice,b.id,'ACTIVE')),'batch_ended');
}));
test('after seven days what was not called is skipped',using(async f=>{
  const b=f.sales([1].map(n=>f.contact(n).id));f.batches.set(f.alice,b.id,'PAUSED');f.advance(8*86400_000);
  assert.equal(code(()=>f.batches.set(f.alice,b.id,'ACTIVE')),'batch_ended');
}));

test('an ordinary request goes to each contact under their own name and number',using(async f=>{
  const ids=[1,2].map(n=>f.contact(n).id);
  f.batches.create(f.alice,{kind:'request',contactIds:ids,request:{instruction:'10月分の注文の納期を確認してください。',callerName:'丸山'},acknowledged:true},'request-key-1');
  await f.pass();await f.pass();await f.pass();
  const calls=f.store.list('mission').filter(m=>m.batch).sort((a,b)=>a.createdAt-b.createdAt);
  assert.deepEqual(calls.map(m=>[m.kind,m.target.name,m.phoneRequest.phone,m.phoneRequest.instruction]),[['phone-request','取引先1','+819000000201','10月分の注文の納期を確認してください。'],['phone-request','取引先2','+819000000202','10月分の注文の納期を確認してください。']]);
},{live:true}));
test('outside the calling hours the list waits and loses nobody; inside them it calls',using(async f=>{
  const b=f.sales([1,2].map(n=>f.contact(n).id));
  await f.pass();await f.pass();
  assert.equal(f.dialed.length,0);assert.deepEqual(f.batches.list(f.alice)[0].items.map(i=>i.state),['PENDING','PENDING']);assert.equal(f.batches.list(f.alice)[0].status,'ACTIVE');
  f.config.callHours={sales:{from:'09:00',to:'20:00'},request:null};
  await f.pass();assert.equal(f.dialed.length,1);
},{live:true,callHours:{sales:{from:'13:00',to:'14:00'},request:null}}));

test('a contact who did not pick up is tried again after the wait, a bounded number of times; a refusal never is',using(async f=>{
  const [a,b]=[1,2].map(n=>f.contact(n));let tries=0;
  f.says(m=>m.target.name==='取引先1'?(++tries<3?null:'はい、お願いします'):'結構です');
  f.sales([a.id,b.id],'retry-key-01',{retry:{count:2,minutes:30}});
  await f.pass();await f.pass();await f.pass();
  assert.deepEqual(f.dialed,['取引先1','取引先2']);
  assert.deepEqual(f.batches.list(f.alice)[0].items.map(i=>[i.state,i.outcome??null,i.attempts]),[['PENDING',null,1],['DONE','DECLINED',1]]);
  f.advance(29*60_000);await f.pass();assert.equal(f.dialed.length,2,'not before the wait is over');
  f.advance(2*60_000);await f.pass();await f.pass();assert.equal(f.dialed.length,3);
  f.advance(31*60_000);await f.pass();await f.pass();assert.equal(f.dialed.length,4);
  const done=f.batches.list(f.alice)[0];assert.equal(done.status,'FINISHED');assert.equal(done.items[0].attempts,3);assert.notEqual(done.items[0].outcome,'UNANSWERED');
  f.advance(86400_000);await f.pass();assert.equal(f.dialed.length,4);
}));
test('a contact who never picks up ends as unanswered once the tries are used up; without retries there is one call',using(async f=>{
  f.says(null);f.sales([f.contact(1).id],'retry-key-02',{retry:{count:1,minutes:30}});
  await f.pass();await f.pass();f.advance(31*60_000);await f.pass();await f.pass();f.advance(31*60_000);await f.pass();await f.pass();
  assert.equal(f.dialed.length,2);assert.deepEqual(f.batches.list(f.alice)[0].items.map(i=>[i.state,i.outcome,i.attempts]),[['DONE','UNANSWERED',2]]);
  for(const retry of [{count:3,minutes:30},{count:1,minutes:10},{count:1,minutes:30,extra:1}])assert.equal(code(()=>f.sales([f.contact(2).id],'retry-key-03',{retry})),'invalid_batch_retry');
}));

test('one contact who is on another call does not hold up the rest of the list',using(async f=>{
  const [a,b]=[1,2].map(n=>f.contact(n));
  f.store.put('mission',{id:'other-call',owner:'bob',team:'one',status:'UNKNOWN',kind:'phone-request',target:{phone:a.phone,name:'x'}});
  f.sales([a.id,b.id]);await f.pass();await f.pass();
  assert.deepEqual(f.dialed,['取引先2']);assert.deepEqual(f.batches.list(f.alice)[0].items.map(i=>i.state),['PENDING','DONE']);
}));
test('an ordinary request in a list calls contacts without a written basis too, and waits for daytime',using(async f=>{
  const a=f.contact(1),b=f.contact(2,{basis:''});
  const made=f.batches.create(f.alice,{kind:'request',contactIds:[a.id,b.id],request:{instruction:'納期を確認してください。'},acknowledged:true},'basis-key-01');
  assert.deepEqual(made.items.map(i=>[i.state,i.reason??null]),[['PENDING',null],['PENDING',null]]);
  f.advance(13*3600_000);await f.pass();assert.equal(f.dialed.length,0,'23:00 is not a time to ring a supplier');
  f.advance(10*3600_000);await f.pass();assert.ok(f.dialed.length>=1,'daytime calls go out');
},{live:true}));
test('a paused list expires like any other',using(async f=>{
  const b=f.sales([f.contact(1).id]);f.batches.set(f.alice,b.id,'PAUSED');f.advance(8*86400_000);await f.pass();
  assert.deepEqual(f.batches.list(f.alice)[0].items.map(i=>[i.state,i.reason]),[['SKIPPED','batch_expired']]);assert.equal(f.batches.list(f.alice)[0].status,'FINISHED');
}));

test('the same number saved twice is called once; a number changed after the approval is not called',using(async f=>{
  const a=f.contact(1),twin=f.service.contact(f.alice,{name:'取引先1の別名',phone:a.phone,relationship:'customer',basis:'既存の取引先'}),b=f.contact(2);
  const made=f.sales([a.id,twin.id,b.id]);
  assert.deepEqual(made.items.map(i=>[i.state,i.reason??null]),[['PENDING',null],['SKIPPED','same_number_as_another_contact'],['PENDING',null]]);
  f.store.put('contact',{...b,phone:'+819000000299'});
  await f.pass();await f.pass();await f.pass();
  assert.deepEqual(f.dialed,['取引先1']);assert.deepEqual(f.batches.list(f.alice)[0].items.map(i=>[i.state,i.reason??null]),[['DONE',null],['SKIPPED','same_number_as_another_contact'],['FAILED','contact_changed_review_again']]);
}));
