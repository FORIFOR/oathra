// Bounded accounting/protocol fixtures. Real SQLite transactions; never dial a carrier.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../lib/store.mjs';
import {Credits} from '../lib/credits.mjs';
import {METERED,billingConfiguration,applyBillingEvent,meteredCost} from '../lib/billing.mjs';
import {Phone} from '../lib/phone.mjs';
import {createServer} from 'node:http';
// One started voice minute costs 0.01152 USD, so a 25 second session is 11,520,000 nanodollars.
const prices={model:'gpt-live-1',version:'2026-09-20',perMinute:'0.01152'};
const billing=billingConfiguration({OATHRA_CREDIT_POLICY:METERED,OATHRA_CREDIT_USD:'0.01',OATHRA_VOICE_ENGINE:'gpt-live',OATHRA_VOICE_MODEL:prices.model,OATHRA_LIVE_PRICES_JSON:JSON.stringify(prices)});
const timing={type:'billing.timing',startedAt:1000,endedAt:26000};
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'metered-')),key=randomBytes(32).toString('hex'),path=join(dir,'db.sqlite');
 const store=new Store(path,key),owner=randomUUID(),u={id:owner,role:'admin'},config={deployment:'managed',billing,maxCallUsd:4,users:[u]},credits=new Credits(store,config);
 const m={id:randomUUID(),owner,mode:'live',status:'FAILED',executionId:randomUUID(),createdAt:Date.now(),finishedAt:Date.now(),creditQuote:credits.quote('live')};
 credits.grant(u,owner,400,randomUUID(),'local boundary verification');store.tx(()=>{credits.reserveTx(m);credits.captureTx(m);store.put('mission',m)});
 return {dir,path,key,store,credits,m,u,config,close(){store.close();rmSync(dir,{recursive:true,force:true})}};
}
const using=fn=>async()=>{const f=setup();try{await fn(f)}finally{f.close()}};
function finish(f,carrier=10000000){
 const m=f.m;applyBillingEvent(m,timing);m.billing.connectedAt=1000;
 m.billing.carrier={costNanoUsd:carrier,durationSeconds:25};m.billing.executionFinished=true;f.store.put('mission',m);return m;
}
test('voice is charged per started session minute and malformed timing is never accepted',using(f=>{
 const m=finish(f,0);assert.equal(meteredCost(m).aiNanoUsd,11520000);
 applyBillingEvent(m,{...timing,endedAt:61001});assert.equal(meteredCost(m).aiNanoUsd,23040000);
 for(const e of [{...timing,endedAt:999},{...timing,startedAt:NaN},{...timing,endedAt:1.5},{type:'billing.timing'}]){applyBillingEvent(m,e);assert.deepEqual(m.billing.timing,{startedAt:1000,endedAt:61001});}
 assert.throws(()=>billingConfiguration({OATHRA_CREDIT_POLICY:METERED,OATHRA_CREDIT_USD:'0.01',OATHRA_VOICE_ENGINE:'realtime',OATHRA_VOICE_MODEL:prices.model,OATHRA_LIVE_PRICES_JSON:JSON.stringify(prices)}),/unsupported_voice_engine/);
 assert.throws(()=>billingConfiguration({OATHRA_CREDIT_POLICY:METERED,OATHRA_CREDIT_USD:'0.01',OATHRA_VOICE_MODEL:'gpt-live-2',OATHRA_LIVE_PRICES_JSON:JSON.stringify(prices)}),/configure_live_prices/);
}));
test('execution keeps the hold; settlement consumes once and returns the unused maximum',using(f=>{
 assert.equal(f.credits.usage(f.m).status,'pending');assert.equal(f.credits.balance(f.m.owner).held,400);
 const m=finish(f);assert.equal(meteredCost(m).totalNanoUsd,21520000);
 for(let i=0;i<2;i++)f.store.tx(()=>f.credits.settleTx(m));
 assert.equal(f.credits.usage(m).consumed,3);assert.equal(f.credits.usage(m).released,397);
 assert.deepEqual({...f.credits.balance(m.owner)},{available:397,held:0});
 assert.equal(f.credits.history(m.owner).filter(e=>e.kind==='consume').length,1);
 const other=new Store(f.path,f.key);try{const c=new Credits(other,f.config);other.tx(()=>c.settleTx(m));assert.equal(c.usage(m).consumed,3)}finally{other.close()}
}));
test('a connected session without measured time cannot be charged as zero',using(f=>{
 const m=finish(f);delete m.billing.timing;assert.equal(meteredCost(m),null);assert.equal(f.store.tx(()=>f.credits.settleTx(m)),false);
 delete m.creditQuote.tariff.voicePerMinuteNanoUsd;applyBillingEvent(m,timing);assert.equal(meteredCost(m),null);
 assert.equal(f.credits.balance(m.owner).held,400);
}));
test('a repeated timing report is not added; a different tariff after approval cannot reprice a call',using(f=>{
 const m=finish(f);applyBillingEvent(m,timing);assert.equal(meteredCost(m).aiNanoUsd,11520000);
 f.config.billing={...billing,creditNanoUsd:1};f.store.tx(()=>f.credits.settleTx(m));assert.equal(f.credits.usage(m).consumed,3);
}));
test('cost over the approved maximum never debits more than the held credits',using(f=>{
 const m=finish(f,5000000000);f.store.tx(()=>f.credits.settleTx(m));assert.equal(f.credits.usage(m).consumed,400);assert.equal(f.credits.usage(m).cost.capped,true);assert.equal(f.credits.balance(m.owner).available,0);
}));
test('partial settlement is rolled back and the final total is rounded only once',using(f=>{
 const m=finish(f,8480000);assert.equal(meteredCost(m).totalNanoUsd,20000000);
 assert.throws(()=>f.store.tx(()=>{f.credits.settleTx(m);throw Error('rollback')}),/rollback/);
 assert.equal(f.credits.balance(m.owner).held,400);f.store.tx(()=>f.credits.settleTx(m));assert.equal(f.credits.usage(m).consumed,2);
}));
test('unsettled costs survive retention; zero cost returns the full hold',using(f=>{
 const m=finish(f,0);delete m.billing.timing;delete m.billing.connectedAt;m.finishedAt=1;f.store.put('mission',m);
 f.store.now=()=>Date.now()+40*86400000;f.store.prune(30);assert.ok(f.store.get('mission',m.id));
 f.store.tx(()=>f.credits.settleTx(m));assert.equal(f.credits.usage(m).consumed,0);assert.equal(f.credits.usage(m).released,400);
}));
test('carrier price reconciliation waits for USD terminal price and authenticates the returned call',using(async f=>{
 const m=finish(f);delete m.billing.carrier;const sid='CA'+randomBytes(16).toString('hex'),account='AC'+randomBytes(16).toString('hex');m.carrierSid=sid;f.store.put('mission',m);
 let data={sid,account_sid:account,status:'completed',duration:'25',price:null,price_unit:'USD'},gets=0;
 const server=createServer((req,res)=>{assert.equal(req.method,'GET');gets++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const p=new Phone({store:f.store,credits:f.credits,config:f.config},{TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:randomUUID()});p.callURL=()=>`http://127.0.0.1:${server.address().port}`;
 try{
  await p.reconcileBilling(m);assert.equal(f.credits.usage(m).status,'pending');
  data={...data,price:'-0.0100',price_unit:'JPY'};await p.reconcileBilling(m);assert.equal(f.credits.usage(m).status,'pending');
  data={...data,price_unit:'USD',sid:'CA'+randomBytes(16).toString('hex')};await assert.rejects(()=>p.reconcileBilling(m),/carrier_billing_identity/);
  data={...data,sid};await p.reconcileBilling(m);assert.equal(f.credits.usage(m).consumed,3);assert.equal(f.credits.usage(m).cost.durationSeconds,25);assert.equal(gets,4);
 }finally{await new Promise(r=>server.close(r))}
}));

test('two concurrent SQLite processes can settle a hold only once',using(async f=>{
 const {spawn}=await import('node:child_process');const m=finish(f);
 const script=`import {Store} from ${JSON.stringify(new URL('../lib/store.mjs',import.meta.url).href)};import {Credits} from ${JSON.stringify(new URL('../lib/credits.mjs',import.meta.url).href)};let raw='';for await(const chunk of process.stdin)raw+=chunk;const p=JSON.parse(raw),s=new Store(p.path,p.key),c=new Credits(s,p.config);try{s.tx(()=>c.settleTx(s.get('mission',p.id)))}finally{s.close()}`;
 const run=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe']});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('child '+code)));p.stdin.end(JSON.stringify({path:f.path,key:f.key,config:f.config,id:m.id}))});
 await Promise.all([run(),run()]);assert.equal(f.credits.usage(m).consumed,3);assert.equal(f.credits.history(m.owner).filter(e=>e.kind==='consume').length,1);assert.equal(f.credits.balance(m.owner).available,397);
}));
test('only an administrator can absorb unmeasurable costs after carrier reconciliation',using(f=>{
 const m=finish(f);delete m.billing.timing;f.store.put('mission',m);assert.equal(meteredCost(m),null);
 assert.throws(()=>f.credits.waive({id:m.owner,role:'operator'},m,'usage lost'),/administrator_required/);
 for(let i=0;i<2;i++)assert.equal(f.credits.waive(f.u,m,'usage lost; operator absorbs costs').status,'waived');
 assert.equal(f.credits.balance(m.owner).available,400);assert.equal(f.credits.history(m.owner).filter(e=>e.kind==='release').length,1);
}));

test('restart marks local execution finished while retaining the unmeasured session and all pending holds',using(async f=>{
 const {Worker}=await import('../lib/worker.mjs'),{Service}=await import('../lib/service.mjs');
 const m=finish(f);m.status='DIALING';delete m.billing.executionFinished;delete m.billing.timing;f.store.put('mission',m);
 for(let i=0;i<1001;i++)f.store.put('mission',{id:randomUUID(),owner:m.owner,status:'DRAFT'});
 const worker=new Worker(new Service(f.store,f.config),{},undefined);
 // The recovery scan is expected to include pending holds even behind more than 1000 drafts.
 worker.start();try{const restored=f.store.get('mission',m.id);assert.equal(restored.status,'UNKNOWN');assert.equal(restored.billing.executionFinished,true);assert.equal(restored.billing.timing,undefined);assert.equal(meteredCost(restored),null);assert.equal(f.credits.pendingMissions().length,1)}finally{await worker.stop()}
}));

test('a timing report emitted synchronously during an opt-out stop is persisted',using(async f=>{
 const {Worker}=await import('../lib/worker.mjs'),{Service}=await import('../lib/service.mjs');
 const m=f.m;m.team='local';m.target={phone:'+15005550006'};m.goal='phone.message';m.kind='phone-request';m.maxSeconds=30;m.product=null;m.request='local accounting check';
 m.billing={state:'pending',connectedAt:1000};f.store.put('mission',m);
 const worker=new Worker(new Service(f.store,f.config),{},async(_m,h)=>{h.signal.addEventListener('abort',()=>h.onEvent(timing));h.onEvent({type:'contact.opt_out'});return {transcript:[]}});
 await worker.run(m,{abort:new AbortController(),control:{}});
 assert.deepEqual(f.store.get('mission',m.id).billing.timing,{startedAt:1000,endedAt:26000});
}));

test('JPY carrier amounts use the reviewed FX snapshot and unpriced calls stay pending',async()=>{
 const {carrierCost}=await import('../lib/billing.mjs');
 const tariff={...billing,carrierFx:{currency:'JPY',unitsPerUsdNano:150000000000,date:'2026-09-18'}};
 assert.equal(carrierCost('-150','JPY',tariff),1000000000);assert.equal(carrierCost('-1.50','USD',tariff),1500000000);
 assert.equal(carrierCost('-150','JPY',billing),null);
 for(const price of [null,undefined,'','NaN','1.50','-Infinity'])assert.equal(carrierCost(price,'JPY',tariff),null);
});

test('restart after a terminal result write still resumes pending price reconciliation',using(async f=>{
 const {Worker}=await import('../lib/worker.mjs'),{Service}=await import('../lib/service.mjs');const m=finish(f);delete m.billing.executionFinished;f.store.put('mission',m);
 const worker=new Worker(new Service(f.store,f.config),{},undefined);worker.start();try{const saved=f.store.get('mission',m.id);assert.equal(saved.status,'FAILED');assert.equal(saved.billing.executionFinished,true);assert.deepEqual(saved.billing.timing,{startedAt:1000,endedAt:26000})}finally{await worker.stop()}
}));
