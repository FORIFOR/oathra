// Real SQLite + local HTTP. Temporary identities and integer amounts only exercise accounting boundaries;
// no provider response doubles, external calls or payment events are generated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.mjs';
import { Credits } from '../lib/credits.mjs';
import { Service } from '../lib/service.mjs';
import { createGateway, configuration } from '../server.mjs';
import { hash } from '../lib/security.mjs';
import { gatewayClient } from '../../../sdk/gateway-client/index.mjs';
import { Worker } from '../lib/worker.mjs';

function setup() {
 const dir=mkdtempSync(join(tmpdir(),'oathra-credit-')),key=randomBytes(32).toString('hex'),token=randomBytes(32).toString('hex'),otherToken=randomBytes(32).toString('hex');
 const users=[{id:randomUUID(),team:'local',role:'admin',tokenHash:hash(token)},{id:randomUUID(),team:'local',role:'operator',tokenHash:hash(otherToken)}];
 const config=configuration({OATHRA_USERS_JSON:JSON.stringify(users),OATHRA_DATA_KEY:key,OATHRA_DB:join(dir,'credits.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:'3'});
 const store=new Store(config.dbPath,key),credits=new Credits(store,config);
 const mission=()=>({id:randomUUID(),owner:users[0].id,mode:'live',creditQuote:credits.quote('live')});
 return {dir,key,token,otherToken,users,config,store,credits,mission,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
const using=fn=>async()=>{const f=setup();try{await fn(f)}finally{f.close()}};
test('per-call usage follows recorded movement, survives reopening, and is owner scoped',using(f=>{
 const owner=f.users[0].id,m=f.mission(),cancelled=f.mission();f.credits.grant(f.users[0],owner,9,randomUUID(),'local per-call accounting verification');
 assert.deepEqual(f.credits.usage(m),{status:'none',consumed:0,held:0,released:0});
 f.store.tx(()=>f.credits.reserveTx(m));assert.deepEqual(f.credits.usage(m),{status:'held',consumed:0,held:3,released:0});
 f.store.tx(()=>f.credits.captureTx(m));assert.deepEqual(f.credits.usage(m),{status:'captured',consumed:3,held:0,released:0});
 f.store.tx(()=>{f.credits.reserveTx(cancelled);f.credits.releaseTx(cancelled)});
 assert.deepEqual(f.credits.usage(cancelled),{status:'released',consumed:0,held:0,released:3});
 assert.deepEqual(f.credits.usage({...m,owner:f.users[1].id}),{status:'none',consumed:0,held:0,released:0});
 f.config.creditsPerCall=99;
 const reopened=new Store(f.config.dbPath,f.key);
 try{assert.equal(new Credits(reopened,f.config).usage({...m,creditQuote:{amount:99}}).consumed,3)}finally{reopened.close()}
}));
test('configuration is opt-in and managed price must be an explicit positive integer',()=>{
 const users=JSON.stringify([{id:'operator',team:'local',role:'admin',tokenHash:hash(randomUUID())}]);
 assert.equal(configuration({OATHRA_USERS_JSON:users}).deployment,'self-hosted');
 for(const price of ['', '0','-1','1.5','9007199254740992'])assert.throws(()=>configuration({OATHRA_USERS_JSON:users,OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:price}),/configure_credits/);
});
test('grants are durable idempotent, scoped, integer and cannot overflow',using(f=>{
 const owner=f.users[0].id,ref=randomUUID();f.credits.grant(f.users[0],owner,9,ref,'local accounting verification');
 assert.equal(f.credits.grant(f.users[0],owner,9,ref,'local accounting verification').replayed,true);
 for(const [who,amount] of [[owner,10],[f.users[1].id,9]])assert.throws(()=>f.credits.grant(f.users[0],who,amount,ref,'local accounting verification'),/idempotency_conflict/);
 assert.throws(()=>f.credits.grant(f.users[1],owner,1,randomUUID(),'local'),/administrator_required/);
 for(const n of [-1,0,0.5,NaN,Number.MAX_SAFE_INTEGER])assert.throws(()=>f.credits.grant(f.users[0],owner,n,randomUUID(),'local'),/invalid_credit_amount/);
 assert.deepEqual({...f.credits.balance(owner)},{available:9,held:0});assert.equal(f.credits.history(f.users[1].id).length,0);
 const reopened=new Store(f.config.dbPath,f.key);try{assert.equal(new Credits(reopened,f.config).balance(owner).available,9);}finally{reopened.close()}
}));
test('two database connections cannot overdraw; rollback and capture/release are durable',using(f=>{
 const u=f.users[0];f.credits.grant(u,u.id,3,randomUUID(),'local accounting verification');
 const a=f.mission(),b=f.mission(),other=new Store(f.config.dbPath,f.key),c=new Credits(other,f.config);
 try {
  assert.throws(()=>f.store.tx(()=>{f.credits.reserveTx(a);throw Error('rollback')}),/rollback/);assert.equal(f.credits.balance(u.id).available,3);
  f.store.tx(()=>f.credits.reserveTx(a));assert.throws(()=>other.tx(()=>c.reserveTx(b)),/insufficient_credits/);
  f.store.tx(()=>f.credits.captureTx(a));f.store.tx(()=>f.credits.captureTx(a));other.tx(()=>c.releaseTx(a));
  assert.deepEqual({...c.balance(u.id)},{available:0,held:0});assert.equal(c.history(u.id).filter(e=>e.kind==='consume').length,1);
 }finally{other.close()}
}));
test('cancel and queued policy rejection release held credits with the mission status',using(async f=>{
 const service=new Service(f.store,f.config),u=f.users[0];f.credits.grant(u,u.id,6,randomUUID(),'local accounting verification');
 for(const cancel of [true,false]){
  const m={...f.mission(),status:'QUEUED',approvalExpiresAt:Date.now()-1};
  // Minimal durable queue record for interruption/policy recovery; not a fabricated carrier outcome.
  f.store.tx(()=>{f.credits.reserveTx(m);f.store.put('mission',m)});
  if(cancel) service.cancel(u,m.id);
  else {const worker=new Worker(service,{},{execute:undefined});await worker.tick();}
  assert.equal(f.credits.status(m),'released');assert.ok(['CANCELLED','FAILED'].includes(f.store.get('mission',m.id).status));
 }
 assert.deepEqual({...f.credits.balance(u.id)},{available:6,held:0});
}));
test('price changes require new review, simulator is free, self-hosted needs no wallet',using(f=>{
 const m=f.mission();f.config.creditsPerCall=4;assert.throws(()=>f.store.tx(()=>f.credits.reserveTx(m)),/credit_price_changed/);
 assert.equal(f.credits.quote('simulator').amount,0);f.config.deployment='self-hosted';f.store.tx(()=>f.credits.reserveTx({id:randomUUID(),owner:f.users[0].id,mode:'live'}));assert.equal(f.credits.history(f.users[0].id).length,0);
}));
test('HTTP credit API authenticates, isolates balances, and denies user grants',using(async f=>{
 const app=await createGateway(f.config,{store:f.store,env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try {
 const base='http://127.0.0.1:'+app.server.address().port;
 const req=(path,token,body,reference=randomUUID())=>fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json','idempotency-key':reference}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const client=gatewayClient({baseUrl:base,token:f.token});assert.equal((await client.credits()).available,0);
 assert.equal((await fetch(base+'/v1/credits')).status,401);
 const data={owner:f.users[0].id,amount:6,reason:'local accounting verification'},ref=randomUUID();
 assert.equal((await req('/v1/admin/credits/grants',f.otherToken,data,ref)).status,403);
 for(let i=0;i<2;i++)assert.equal((await req('/v1/admin/credits/grants',f.token,data,ref)).status,200);
 assert.equal((await(await req('/v1/credits',f.token)).json()).available,6);
 assert.equal((await(await req('/v1/credits?owner='+f.users[0].id,f.otherToken)).json()).available,0);
 assert.equal((await(await req('/v1/credits/ledger',f.token)).json()).entries.length,1);
 assert.equal((await req('/v1/credits/ledger?after=-1',f.token)).status,400);
 }finally{await app.close()}
}));

test('two concurrent processes reserve only the available credits',using(async f=>{
 const {spawn}=await import('node:child_process');
 f.credits.grant(f.users[0],f.users[0].id,3,randomUUID(),'local concurrent accounting verification');
 const moduleUrl=new URL('../lib/credits.mjs',import.meta.url).href,storeUrl=new URL('../lib/store.mjs',import.meta.url).href;
 const script=`import {Store} from ${JSON.stringify(storeUrl)};import {Credits} from ${JSON.stringify(moduleUrl)};let raw='';for await(const part of process.stdin)raw+=part;const p=JSON.parse(raw),s=new Store(p.path,p.key),c=new Credits(s,p.config);try{s.tx(()=>c.reserveTx(p.m));process.stdout.write('reserved')}catch(e){if(e.code!=='insufficient_credits')throw e;process.stdout.write('insufficient')}finally{s.close()}`;
 const run=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',v=>out+=v);p.on('error',reject);p.on('exit',code=>code===0?resolve(out):reject(Error('child exit '+code)));p.stdin.end(JSON.stringify({path:f.config.dbPath,key:f.key,config:f.config,m:f.mission()}));});
 assert.deepEqual((await Promise.all([run(),run()])).sort(),['insufficient','reserved']);
 assert.deepEqual({...f.credits.balance(f.users[0].id)},{available:0,held:3});
}));

test('queued policy rejection through claim releases a hold exactly once',using(f=>{
 // Minimal interruption-state records are the bounded exception for accounting verification.
 // No live-ready provider is invented: policy failure must release; capture is tested at its transaction boundary above.
 const service=new Service(f.store,f.config),worker=new Worker(service,{},undefined),m={...f.mission(),status:'QUEUED',approvalExpiresAt:0};
 f.credits.grant(f.users[0],m.owner,3,randomUUID(),'queued accounting verification');f.store.tx(()=>{f.credits.reserveTx(m);f.store.put('mission',m)});
 assert.equal(worker.claimNext(),null);assert.equal(f.credits.status(m),'released');assert.equal(worker.claimNext(),null);assert.equal(f.credits.history(m.owner).filter(e=>e.kind==='release').length,1);
}));
