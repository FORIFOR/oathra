// Holds that could never be settled, and calls that must not take the service down with them.
// Real temporary SQLite and loopback HTTP; never dials a carrier.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../lib/store.mjs';
import {Credits} from '../lib/credits.mjs';
import {Service} from '../lib/service.mjs';
import {Worker} from '../lib/worker.mjs';
import {METERED,USAGE_RATE,billingConfiguration} from '../lib/billing.mjs';
import {createGateway,configuration} from '../server.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const env={OATHRA_CREDIT_POLICY:METERED,OATHRA_CREDIT_USD:'0.01',OATHRA_VOICE_MODEL:'gpt-live-1',OATHRA_LIVE_PRICES_JSON:JSON.stringify({model:'gpt-live-1',version:'hold-recovery',perMinute:'0.05'}),OATHRA_SETTLEMENT_MODE:USAGE_RATE,
 OATHRA_USAGE_PRICES_JSON:JSON.stringify({version:'hold-recovery',carrier:[{prefix:'+81',currency:'USD',perMinute:'0.1',incrementSeconds:60,source:'bounded test rate'}],mediaPerMinute:'0.0044',search:{model:'gpt-5.4-mini',perCall:'0.01',input:'0.75',cached:'0.075',output:'4.5'}})};
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'hold-recovery-')),key=randomBytes(32).toString('hex'),adminToken=randomBytes(32).toString('hex'),ownerToken=randomBytes(32).toString('hex');
 const users=[{id:'admin',team:'local',role:'admin',tokenHash:hash(adminToken)},{id:'customer',team:'local',role:'operator',tokenHash:hash(ownerToken)}];
 const config=configuration({...env,OATHRA_USERS_JSON:JSON.stringify(users),OATHRA_DATA_KEY:key,OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed'});
 const store=new Store(config.dbPath,key),credits=new Credits(store,config);
 credits.grant(users[0],'customer',400,randomUUID(),'bounded recovery verification');
 // The dial request timed out: execution was claimed, no carrier SID was ever stored, the outcome is unknown.
 const stuck=(over={})=>{const m={id:randomUUID(),owner:'customer',team:'local',mode:'live',kind:'phone-request',status:'UNKNOWN',executionId:randomUUID(),error:'dial_request_outcome_unknown',target:{phone:'+819000000000',name:'local'},createdAt:Date.now(),billing:{state:'pending',executionFinished:true},creditQuote:credits.quote('live','+819000000000',400),...over};store.tx(()=>{credits.reserveTx(m);store.put('mission',m)});return m;};
 return {dir,store,credits,users,config,adminToken,ownerToken,stuck,close(){store.close();rmSync(dir,{recursive:true,force:true})}};
}
const using=fn=>async()=>{const f=setup();try{await fn(f)}finally{f.close()}};

test('a call with no carrier SID can never be reconciled or waived; only a checked force-release frees it, once',using(f=>{
 const m=f.stuck(),[admin,owner]=f.users;
 assert.deepEqual({...f.credits.balance('customer')},{available:0,held:400});
 assert.throws(()=>f.credits.waive(admin,m,'lost'),/reconcile_call_before_waiving/);
 assert.throws(()=>f.credits.forceRelease(owner,m.id,'lost',true),/administrator_required/);
 assert.throws(()=>f.credits.forceRelease(admin,m.id,'lost',false),/carrier_console_check_required/);
 assert.throws(()=>f.credits.forceRelease(admin,m.id,'',true));
 assert.throws(()=>f.credits.forceRelease(admin,randomUUID(),'lost',true),/not_found/);
 assert.deepEqual({...f.credits.balance('customer')},{available:0,held:400});
 for(let i=0;i<2;i++)assert.equal(f.credits.forceRelease(admin,m.id,'carrier console shows no call for this number',true).status,'waived');
 assert.deepEqual({...f.credits.balance('customer')},{available:400,held:0});
 assert.equal(f.credits.history('customer').filter(e=>e.kind==='release').length,1);
 const saved=f.store.get('mission',m.id);assert.equal(saved.status,'FAILED');assert.equal(saved.previousStatus,'UNKNOWN');assert.equal(saved.error,'carrier_outcome_unknown_released_by_operator');
 // The number is callable again and the record can be removed, which the UNKNOWN state forbade.
 assert.equal(f.store.some('mission',x=>x.target.phone===m.target.phone&&(x.status==='UNKNOWN'||x.stopNeedsReconciliation)),false);
}));

test('a call that the carrier can still answer for must be reconciled, not force-released',using(f=>{
 f.credits.grant(f.users[0],'customer',400,randomUUID(),'second bounded hold');
 const withSid=f.stuck({carrierSid:'CA'+randomBytes(16).toString('hex')}),finished=f.stuck({status:'INCOMPLETE',target:{phone:'+819000000001',name:'local'}});
 for(const m of [withSid,finished])assert.throws(()=>f.credits.forceRelease(f.users[0],m.id,'checked',true),/reconcile_call_instead/);
 assert.equal(f.credits.balance('customer').held>0,true);
}));

test('administrators reach another owner\'s call over HTTP; the owner and other users cannot force a release',using(async f=>{
 const m=f.stuck(),app=await createGateway(f.config,{store:f.store,env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+app.server.address().port;
  const post=(path,token,body)=>fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
  const body={acknowledged:true,carrierChecked:true,reason:'carrier console shows no call'};
  // The owner-scoped route hides the call from the administrator (404); that is why the admin route exists.
  assert.equal((await post(`/v1/missions/${m.id}/billing-waive`,f.adminToken,body)).status,404);
  assert.equal((await post(`/v1/admin/missions/${m.id}/credits-force-release`,f.ownerToken,body)).status,403);
  assert.equal((await post(`/v1/admin/missions/${m.id}/credits-force-release`,f.adminToken,{...body,acknowledged:false})).status,403);
  assert.equal((await post(`/v1/admin/missions/${randomUUID()}/credits-force-release`,f.adminToken,body)).status,404);
  const done=await post(`/v1/admin/missions/${m.id}/credits-force-release`,f.adminToken,body);assert.equal(done.status,200);assert.equal((await done.json()).released,400);
  assert.deepEqual({...f.credits.balance('customer')},{available:400,held:0});
 }finally{await app.close()}
}));

test('a queued call whose reservation is gone fails alone; the next call behind it still starts',using(f=>{
 const service=new Service(f.store,f.config);service.saveConsent(f.users[1],f.config.consentVersion);
 const queued=(phone)=>{const m={id:randomUUID(),owner:'customer',team:'local',mode:'live',kind:'phone-request',status:'QUEUED',goal:'phone.message',product:null,request:'local',maxSeconds:60,maxUsd:4,estimatedMaximumUsd:1,approvalExpiresAt:Date.now()+60000,approvedAt:Date.now(),target:{phone,name:'local'},createdAt:Date.now(),creditQuote:f.credits.quote('live',phone,100)};return m;};
 const broken=queued('+819000000010'),healthy=queued('+819000000011');
 f.store.tx(()=>{f.store.put('mission',broken);f.credits.reserveTx(healthy);f.store.put('mission',healthy)});
 const worker=new Worker(service,{},undefined);worker.checkPolicyOriginal=service.checkPolicy;service.checkPolicy=()=>{};
 // Whichever is at the head of the queue, two claims must get through both.
 const claimed=[worker.claimNext(),worker.claimNext()].filter(Boolean);
 assert.equal(f.store.get('mission',broken.id).status,'FAILED');assert.equal(f.store.get('mission',broken.id).error,'credit_reservation_missing');
 assert.deepEqual(claimed.map(m=>m.id),[healthy.id]);assert.equal(f.store.get('mission',healthy.id).status,'DIALING');
}));

test('startup settles what it can and logs what it cannot, instead of refusing to start',using(async f=>{
 const service=new Service(f.store,f.config),m=f.stuck({status:'INCOMPLETE'});
 const original=service.credits.settleTx.bind(service.credits);let calls=0;
 service.credits.settleTx=x=>{calls++;if(x.id===m.id)throw Object.assign(new Error('credit_reservation_missing'),{code:'credit_reservation_missing'});return original(x)};
 const logged=[],error=console.error;console.error=line=>logged.push(String(line));
 const worker=new Worker(service,{},undefined);
 try{worker.start();assert.ok(calls>=1);assert.ok(logged.some(l=>l.includes('billing.recovery_failed')&&l.includes(m.id)));assert.equal(f.credits.balance('customer').held,400)}
 finally{console.error=error;await worker.stop()}
}));
