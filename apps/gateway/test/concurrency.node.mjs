// Several calls at once, when the operator allows it: each runs on its own, and the limit holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Worker } from '../lib/worker.mjs';
import { hash } from '../lib/security.mjs';
const start=Date.parse('2026-09-19T03:00:00+09:00');
function fixture(lines){
  const config={mode:'simulator',users:[{id:'alice',team:'one',role:'admin',tokenHash:hash('alice')}],maxSeconds:300,maxCallUsd:10,dailyCalls:0,dailyUsd:0,rateCeilingUsd:0.1,setupFeeUsd:0,consentVersion:'v1',liveReady:false,publicUrl:'http://localhost:4244',missing:[],...(lines?{maxConcurrentCalls:lines}:{})};
  let clock=start; // each approval a second apart, so the queue has an order
  const store=new Store(':memory:',randomBytes(32).toString('hex'),()=>clock),service=new Service(store,config),u=config.users[0];
  service.saveConsent(u,'v1');
  const product=service.product(u,{name:'Example product',facts:'Only the reviewed feature.',reviewed:true});
  const approve=n=>{clock+=1000;const contact=service.contact(u,{name:`相手${n}`,phone:`+8190000001${String(n).padStart(2,'0')}`,relationship:'inquiry',basis:'Customer requested a follow-up'});
    const m=service.prepare(u,{request:`相手${n}に商談を提案`,contactId:contact.id,productId:product.id}),r=service.review(u,m.id);return service.start(u,r.approvalToken,`key-${n}`,true);};
  // Each call stays in progress until the test lets it go.
  const gates=new Map(),started=[];
  const execute=(m,hooks)=>new Promise(resolve=>{started.push(m.id);hooks.onEvent({type:'call.connected'});gates.set(m.id,()=>resolve({}));hooks.signal.addEventListener('abort',()=>resolve({}));});
  const worker=new Worker(service,{process:async()=>{},send:async()=>{}},execute);worker.log=()=>{};
  const finish=async id=>{const a=worker.activeFor(id);gates.get(id)();await a.promise;};
  return {config,store,service,u,approve,worker,started,finish,close(){store.close();}};
}
const using=(fn,lines)=>async()=>{const f=fixture(lines);try{await fn(f);}finally{await f.worker.stop();f.close();}};

test('by default one call at a time: the second waits for the first to end',using(async f=>{
  const a=f.approve(1),b=f.approve(2);
  await f.worker.tick();await f.worker.tick();
  assert.deepEqual(f.started,[a.id]);assert.equal(f.store.get('mission',b.id).status,'QUEUED');
  await f.finish(a.id);await f.worker.tick();
  assert.deepEqual(f.started,[a.id,b.id]);
}));
test('with three lines, three calls run together and the fourth waits; each ends on its own',using(async f=>{
  const calls=[1,2,3,4].map(f.approve);
  await f.worker.tick();
  assert.equal(f.started.length,3);assert.equal(f.worker.running.size,3);
  assert.equal(f.store.get('mission',calls[3].id).status,'QUEUED');
  for(const c of calls.slice(0,3))assert.ok(['DIALING','ACTIVE'].includes(f.store.get('mission',c.id).status));
  await f.finish(calls[1].id);
  assert.equal(f.worker.running.size,2);assert.ok(f.store.get('mission',calls[1].id).finishedAt);
  assert.ok(!f.store.get('mission',calls[0].id).finishedAt,'the others are untouched');
  await f.worker.tick();assert.equal(f.started.length,4);assert.equal(f.worker.running.size,3);
},3));
test('cancelling one call stops that call only',using(async f=>{
  const [a,b]=[1,2].map(f.approve);await f.worker.tick();
  const pa=f.worker.activeFor(a.id).promise;f.service.cancel(f.u,a.id);await f.worker.tick();await pa;
  assert.equal(f.store.get('mission',a.id).status,'CANCELLED');
  assert.ok(f.worker.activeFor(b.id));assert.equal(f.worker.activeFor(b.id).abort.signal.aborted,false);
},2));
test('stopping the worker ends every call in progress and waits for them',using(async f=>{
  [1,2].map(f.approve);await f.worker.tick();assert.equal(f.worker.running.size,2);
  await f.worker.stop();assert.equal(f.worker.running.size,0);
},2));
test('two calls to the same number are never in progress together, however many lines there are',using(async f=>{
  f.approve(1);
  const contact=f.store.list('contact',f.u.id)[0],product=f.store.list('product',f.u.id)[0];
  const again=f.service.prepare(f.u,{request:'もう一度提案',contactId:contact.id,productId:product.id}),r=f.service.review(f.u,again.id);
  assert.throws(()=>f.service.start(f.u,r.approvalToken,'key-again',true),/recipient_has_active_call/);
},3));
