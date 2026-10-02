// A refusal ends a sales call and suppresses the number. In an ordinary request it is only an answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Worker } from '../lib/worker.mjs';
import { hash } from '../lib/security.mjs';
import { evaluateSales } from '../lib/sales.mjs';
import { createGateway } from '../server.mjs';
const now=Date.parse('2026-09-19T03:00:00+09:00'), token='test-operator-token-'.repeat(3);
function fixture(){
  const config={mode:'simulator',users:[{id:'alice',team:'one',role:'admin',tokenHash:hash(token)},{id:'bob',team:'one',role:'operator',tokenHash:hash('bob')},{id:'carol',team:'two',role:'admin',tokenHash:hash('carol')}],maxSeconds:300,maxCallUsd:10,dailyCalls:20,dailyUsd:30,rateCeilingUsd:0.1,setupFeeUsd:0,consentVersion:'v1',liveReady:false,publicUrl:'http://localhost:4244',missing:[]};
  const store=new Store(':memory:',randomBytes(32).toString('hex'),()=>now), service=new Service(store,config),u=config.users[0];
  service.saveConsent(u,'v1');store.put('account',{...service.account(u),verifiedPhone:'+15005550006',phoneVerificationProvider:'simulator'});
  const product=service.product(u,{name:'Example product',facts:'Only the reviewed feature.',reviewed:true});
  const contact=service.contact(u,{name:'田中さん',phone:'+819000000001',relationship:'inquiry',basis:'Customer requested a follow-up',email:'tanaka@example.test'});
  const approved=()=>{const m=service.prepare(u,{request:'田中さんに商談を提案',contactId:contact.id,productId:product.id}),r=service.review(u,m.id);return service.start(u,r.approvalToken,'one',true);};
  return {config,store,service,u,contact,approved,close(){store.close();}};
}
const using=fn=>async()=>{const f=fixture();try{await fn(f);}finally{f.close();}};
const hears=(f,m,text)=>{let aborted;const w=new Worker(f.service,{process:async()=>{},send:async()=>{}},async(_,hooks)=>{hooks.onEvent({type:'call.connected'});hooks.onEvent({type:'transcript.final',turnId:'t1',source:'callee',text});aborted=hooks.signal.aborted;return {};});
  // The simulator only previews ordinary requests, so their execution is entered directly, past the claim.
  if(f.store.get('mission',m.id).kind==='phone-request'){const current={...f.store.get('mission',m.id),status:'DIALING'};f.store.put('mission',current);return w.run(current,{id:m.id,abort:new AbortController(),control:{}}).then(()=>aborted);}
  return w.tick().then(()=>w.active?.promise).then(()=>aborted);};
const asRequest=(f,m)=>{const saved=f.store.get('mission',m.id);f.store.put('mission',{...saved,kind:'phone-request',phoneRequest:{phone:saved.target.phone,name:saved.target.name,instruction:'在庫があるか確認してください。'}});};

test('in an ordinary request a plain refusal neither ends the call nor suppresses the number',using(async f=>{
  const m=f.approved();asRequest(f,m);
  assert.equal(await hears(f,m,'いえ、それは結構です。在庫はあります。'),false);
  assert.equal(f.store.suppressed('one',f.contact.phone),false);
  assert.notEqual(f.store.get('mission',m.id).status,'DECLINED');
}));
test('in an ordinary request an explicit request not to be called still ends the call and suppresses',using(async f=>{
  const m=f.approved();asRequest(f,m);
  assert.equal(await hears(f,m,'もう二度と電話しないでください。'),true);
  assert.equal(f.store.suppressed('one',f.contact.phone),true);
  assert.equal(f.store.get('mission',m.id).status,'DECLINED');
}));
test('a sales call still ends and suppresses at a plain refusal',using(async f=>{
  const m=f.approved();
  assert.equal(await hears(f,m,'結構です。'),true);
  assert.equal(f.store.suppressed('one',f.contact.phone),true);
}));
test('the verdict of an ordinary request treats a refusal as an answer, and a stop request as declined',()=>{
  const mission={kind:'phone-request',phoneRequest:{phone:'+819000000001',name:'x',instruction:'y'}};
  assert.equal(evaluateSales([{source:'callee',text:'不要です'}],mission,true,now).doNotContact,false);
  const stop=evaluateSales([{source:'callee',text:'今後は連絡しないでください'}],mission,true,now);
  assert.equal(stop.doNotContact,true);assert.equal(stop.status,'DECLINED');
});

test('releasing a suppression: this team only, the shared entry survives another team, a key press is never released',using(f=>{
  const p='+819000000001';
  assert.equal(f.store.unsuppress('one',p),'not_suppressed');
  f.store.suppress('one',p,'transcript');assert.equal(f.store.unsuppress('one',p),'released');assert.equal(f.store.suppressed('one',p),false);assert.equal(f.store.suppressed('two',p),false);
  f.store.suppress('one',p,'transcript');f.store.suppress('two',p,'manual');
  assert.equal(f.store.unsuppress('one',p),'held_by_another_team');assert.equal(f.store.suppressed('one',p),true,'the other team’s refusal still protects the person');
  assert.equal(f.store.unsuppress('two',p),'released');assert.equal(f.store.suppressed('one',p),false);
  f.store.suppress('one',p,'dtmf');assert.equal(f.store.unsuppress('one',p),'opted_out_by_recipient');assert.equal(f.store.suppressed('one',p),true);
}));
test('only an administrator releases a suppression, with a reason, and it is audited',using(async f=>{
  const app=await createGateway(f.config,{store:f.store,execute:async()=>({}),channels:{process:async()=>{},send:async()=>{}}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port,post=(bearer,body)=>fetch(base+'/v1/suppressions/release',{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},body:JSON.stringify(body)});
  try{
    f.store.suppress('one',f.contact.phone,'transcript');
    const ok={contactId:f.contact.id,acknowledged:true,reason:'聞き取りの誤りでした。本人に確認済み。'};
    assert.equal((await post('bob',ok)).status,403,'an operator cannot release');
    assert.equal((await post('carol',ok)).status,404,'another person’s contact is not visible');
    assert.equal((await post(token,{...ok,reason:''})).status,400);
    assert.equal((await post(token,{...ok,acknowledged:false})).status,400);
    assert.equal(f.store.suppressed('one',f.contact.phone),true);
    const done=await post(token,ok);assert.equal(done.status,200);assert.deepEqual(await done.json(),{suppressed:false,outcome:'released'});
    assert.equal(f.store.suppressed('one',f.contact.phone),false);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='contact.suppression_released'").get().n,1);
    assert.equal((await post(token,ok)).status,409);
    f.store.suppress('one',f.contact.phone,'dtmf');
    assert.equal((await post(token,ok)).status,403);assert.equal(f.store.suppressed('one',f.contact.phone),true);
  }finally{await app.close();}
}));

test('a sales call is told to say who, by what, about what and that it is a sales call before anything else, and never to press after a no',async()=>{
  const {SALES_CALL_POLICY}=await import('../lib/phone.mjs');
  for(const part of ['caller_identity の会社名・名前','AIアシスタントが代わりにかけている電話','商品・サービスの種類（product_name）','営業（ご案内）のお電話であること','これらを告げる前に商品の説明や質問を始めない','引き留めたり言い換えて再度すすめたりせず'])assert.ok(SALES_CALL_POLICY.includes(part),part);
  assert.ok(SALES_CALL_POLICY.indexOf('(1)')<SALES_CALL_POLICY.indexOf('(4)'));
});

test('a stop the person made by key press is never written over, so nothing can make it releasable',using(f=>{
  const p='+819000000001';
  f.store.suppress('one',p,'dtmf');f.store.suppress('one',p,'manual');f.store.suppress('one',p,'transcript');
  assert.equal(f.store.unsuppress('one',p),'opted_out_by_recipient');assert.equal(f.store.suppressed('one',p),true);
  // The other order still records the key press.
  const q='+819000000002';f.store.suppress('one',q,'manual');f.store.suppress('one',q,'dtmf');assert.equal(f.store.unsuppress('one',q),'opted_out_by_recipient');
}));

test('a stop a staff member set by hand is their team’s own; what the person said or did binds every team',using(f=>{
  const p='+819000000003',q='+819000000004';
  f.store.suppress('two',p,'manual');assert.equal(f.store.suppressed('two',p),true);assert.equal(f.store.suppressed('one',p),false);
  f.store.suppress('two',q,'transcript');assert.equal(f.store.suppressed('one',q),true);
}));
