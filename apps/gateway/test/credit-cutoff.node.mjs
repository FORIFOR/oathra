// Limited quantity/time/abort fixtures to verify the real ledger and worker without PSTN.
// Every in-memory database is closed after each test. No carrier success is fabricated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Store} from '../lib/store.mjs';
import {Service} from '../lib/service.mjs';
import {Worker} from '../lib/worker.mjs';
import {billingConfiguration,applyBillingEvent} from '../lib/billing.mjs';
import {spendingProgress} from '../lib/credit-guard.mjs';
import {prepareManagedPhone,phoneRecord} from '../lib/phone-service.mjs';
const env={OATHRA_CREDIT_POLICY:'provider-cost-v1',OATHRA_CREDIT_USD:'0.01',OATHRA_VOICE_ENGINE:'realtime',OATHRA_VOICE_MODEL:'gpt-realtime-1.5',OATHRA_REALTIME_PRICES_JSON:JSON.stringify({model:'gpt-realtime-1.5',version:'cutoff-boundary',inputText:4,inputAudio:32,cachedText:0.4,cachedAudio:0.4,outputText:16,outputAudio:64}),OATHRA_SETTLEMENT_MODE:'usage-rate-v1',OATHRA_USAGE_PRICES_JSON:JSON.stringify({version:'cutoff-boundary',carrier:[{prefix:'+81',currency:'USD',perMinute:'0.2',incrementSeconds:60,source:'bounded accounting fixture'}],mediaPerMinute:'0.0044',search:{model:'gpt-5.4-mini',perCall:'0.01',input:'0.75',cached:'0.075',output:'4.5'}})};
function fixture(amount=377){
 let now=100000;const store=new Store(':memory:',randomBytes(32).toString('hex'),()=>now),u={id:randomUUID(),team:'local',role:'admin'};
 const config={deployment:'managed',mode:'live',liveReady:true,users:[u],billing:billingConfiguration(env),maxCallUsd:4,maxSeconds:180,rateCeilingUsd:0.1,setupFeeUsd:0,dailyCalls:0,dailyUsd:0,consentVersion:'v1',callerId:'+819000000000'};
 const service=new Service(store,config);service.saveConsent(u,'v1');if(amount)service.credits.grant(u,u.id,amount,randomUUID(),'bounded cutoff verification');
 const draft=()=>prepareManagedPhone(service,u,{phone:'+819000000000',name:'local boundary',instruction:'Only local accounting verification; no phone execution.'});
 const start=m=>service.start(u,service.review(u,m.id).approvalToken,randomUUID(),true,m.id);
 return {store,u,config,service,draft,start,advance(ms){now+=ms},now:()=>now,close:()=>store.close()};
}
const using=(fn,amount)=>async()=>{const f=fixture(amount);try{await fn(f)}finally{f.close()}};
test('377 remaining can approve below the fixed 400 cap and execute against held funds',using(f=>{
 const m=f.draft();assert.equal(m.creditQuote.amount,377);assert.equal(m.creditQuote.minimumAmount,21);f.start(m);
 assert.deepEqual({...f.service.credits.balance(f.u.id)},{available:0,held:377});
 const worker=new Worker(f.service,{},undefined);const claimed=worker.claimNext();assert.equal(claimed.id,m.id);assert.equal(claimed.status,'DIALING');
 assert.equal(f.service.credits.usage(claimed).held,377);
}));
for(const amount of [0,20])test(`balance ${amount} cannot fund the first billing unit and never reserves`,using(f=>{
 const m=f.draft();assert.equal(m.creditQuote.amount,amount);assert.throws(()=>f.start(m),/insufficient_connection_credits/);assert.deepEqual({...f.service.credits.balance(f.u.id)},{available:amount,held:0});assert.equal(f.store.list('mission',f.u.id,'QUEUED').length,0);
},amount));
test('a second reviewed draft cannot spend credits already held by another approval',using(f=>{
 const a=f.draft(),b=f.draft(),r=f.service.review(f.u,b.id);f.start(a);
 // Mark only the first queue cancelled after preserving its hold to isolate ledger concurrency.
 const held=f.store.get('mission',a.id);held.status='CANCELLED';f.store.put('mission',held);
 assert.throws(()=>f.service.start(f.u,r.approvalToken,randomUUID(),true,b.id),/insufficient_credits/);assert.equal(f.service.credits.balance(f.u.id).held,377);
}));
test('price changes invalidate the approved amount without spending any credits',using(f=>{
 const m=f.draft(),r=f.service.review(f.u,m.id);f.config.billing.rates.outputAudio++;
 assert.throws(()=>f.service.start(f.u,r.approvalToken,randomUUID(),true,m.id),/credit_price_changed/);assert.equal(f.service.credits.balance(f.u.id).available,377);
}));
test('elapsed carrier time and search usage share the final settlement arithmetic',using(f=>{
 const m=f.start(f.draft());m.billing={connectedAt:f.now(),ai:{started:false,closed:false,pending:[],responses:[]}};
 f.advance(1000);assert.equal(spendingProgress(m,f.now()).consumed,21);
 applyBillingEvent(m,{type:'billing.search',kind:'response',id:'search',model:'gpt-5.4-mini',calls:2,usage:{input_tokens:0,output_tokens:0,input_tokens_details:{cached_tokens:0}}});
 assert.equal(spendingProgress(m,f.now()).consumed,23);
 m.creditQuote.amount=21;assert.equal(spendingProgress(m,f.now()).stop,true);
}));
test('worker aborts once on voice usage, caps the debit, and records a readable stopping reason',using(async f=>{
 f.start(f.draft());const worker=new Worker(f.service,{},async(m,h)=>{
  let stops=0;h.signal.addEventListener('abort',()=>{stops++});h.onEvent({type:'call.connected'});f.advance(1000);
  const usage={input_tokens:0,output_tokens:2000,input_token_details:{text_tokens:0,audio_tokens:0,cached_tokens:0},output_token_details:{text_tokens:0,audio_tokens:2000}};
  for(let i=0;i<2;i++)h.onEvent({type:'billing.ai',kind:'response',id:'large-response',model:env.OATHRA_VOICE_MODEL,usage});
  assert.equal(h.signal.aborted,true);assert.equal(stops,1);
  h.onEvent({type:'billing.timing',startedAt:f.now()-1000,endedAt:f.now()});return {transcript:[]};
 });
 const m=worker.claimNext();await worker.run(m,{abort:new AbortController(),control:{}});
 const saved=f.store.get('mission',m.id);assert.equal(saved.stopReason,'credit_limit');assert.equal(saved.status,'CANCELLED');
 assert.equal(f.service.credits.usage(saved).consumed,25);assert.equal(f.service.credits.usage(saved).cost.capped,true);assert.deepEqual({...f.service.credits.balance(f.u.id)},{available:0,held:0});assert.match(phoneRecord(f.service,saved).summary,/上限/);
},25));
test('timer cuts off before an unaffordable next carrier minute even without new usage events',using(async f=>{
 f.start(f.draft());let aborted=0;
 const worker=new Worker(f.service,{},async(m,h)=>{
  h.onEvent({type:'call.connected'});f.advance(59500);
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('cutoff timer missing')),2000);h.signal.addEventListener('abort',()=>{aborted++;clearTimeout(timeout);resolve()},{once:true})});
  h.onEvent({type:'billing.timing',startedAt:f.now()-59500,endedAt:f.now()});return {transcript:[]};
 });
 const m=worker.claimNext();await worker.run(m,{abort:new AbortController(),control:{}});assert.equal(aborted,1);assert.equal(f.service.credits.usage(m).consumed,21);assert.equal(f.service.credits.usage(m).released,4);assert.equal(f.store.events(m.id,m.owner).filter(e=>e.type==='credit.limit').length,1);assert.equal(f.service.credits.history(m.owner).filter(e=>e.kind==='consume').length,1);assert.equal(f.service.credits.history(m.owner).filter(e=>e.kind==='release').length,1);
},25));
test('a manual stop or closed media cannot be relabelled as credit exhaustion during a delayed stop',using(async f=>{
 f.start(f.draft());const abort=new AbortController();
 const worker=new Worker(f.service,{},async(m,h)=>{h.onEvent({type:'call.connected'});abort.abort();f.advance(120000);await new Promise(r=>setTimeout(r,300));return {transcript:[]}});
 const m=worker.claimNext();await worker.run(m,{abort,control:{}});assert.equal(f.store.get('mission',m.id).stopReason,undefined);
 const closed={...m,billing:{connectedAt:100000,timing:{startedAt:100000,endedAt:100100},ai:{responses:[]}}};assert.equal(spendingProgress(closed,999999),null);
},25));
test('failed carrier stop remains unknown and holds credits for reconciliation',using(async f=>{
 f.start(f.draft());const worker=new Worker(f.service,{},async(m,h)=>{h.onEvent({type:'call.connected'});f.advance(59500);h.onEvent({type:'billing.ai',kind:'started'});const saved=f.store.get('mission',m.id);saved.stopNeedsReconciliation=true;f.store.put('mission',saved);return {transcript:[]}});
 const m=worker.claimNext();await worker.run(m,{abort:new AbortController(),control:{}});assert.equal(f.store.get('mission',m.id).status,'UNKNOWN');assert.equal(f.service.credits.usage(m).held,25);
},25));

test('legacy quotes retain their fixed reservation and have no balance-cutoff guard',using(f=>{
 const m=f.draft();m.creditQuote=f.service.credits.quote('live',m.target.phone);assert.equal(m.creditQuote.amount,400);assert.equal(m.creditQuote.spendingLimit,undefined);assert.equal(spendingProgress(m,f.now()),null);
 delete f.config.billing.settlement;assert.equal(f.service.credits.quote('live',m.target.phone).amount,400);
 f.config.billing={policy:'call-attempt-v1'};f.config.creditsPerCall=3;assert.equal(f.service.credits.quote('live',m.target.phone).amount,3);
}));
test('JPY conversion and a six-second carrier increment use the same cutoff and settlement rounding',using(f=>{
 const usage=JSON.parse(env.OATHRA_USAGE_PRICES_JSON);usage.carrier[0]={...usage.carrier[0],currency:'JPY',perMinute:'29.858741',incrementSeconds:6};
 f.config.billing=billingConfiguration({...env,OATHRA_CARRIER_JPY_PER_USD:'157.888307',OATHRA_CARRIER_FX_DATE:'2026-09-18',OATHRA_USAGE_PRICES_JSON:JSON.stringify(usage)});
 const m=f.draft();assert.equal(m.creditQuote.minimumAmount,3);assert.equal(m.creditQuote.tariff.carrierRate.perMinuteNanoUsd,189113060);
 m.creditQuote.amount=3;m.billing={connectedAt:f.now(),ai:{started:false,closed:false,pending:[],responses:[]}};
 f.advance(1000);const a=spendingProgress(m,f.now());assert.equal(a.totalNanoUsd,23311306);assert.equal(a.consumed,3);assert.equal(a.stop,false);
 f.advance(4500);assert.equal(spendingProgress(m,f.now()).stop,true);
}));

test('balance-limited calls honor the configured ten minutes instead of the legacy three-minute cap',using(f=>{
 f.config.maxSeconds=600;f.config.rateCeilingUsd=1;const m=f.draft();assert.equal(m.estimatedMaximumUsd,3.77);assert.equal(m.maxSeconds,600);assert.equal(m.creditQuote.amount,377);assert.equal(m.creditQuote.spendingLimit,'balance-v1');
 f.config.maxSeconds=60;assert.equal(f.draft().maxSeconds,60);assert.equal(f.store.get('mission',m.id).maxSeconds,600);
 f.config.maxSeconds=600;delete f.config.billing.settlement;assert.throws(()=>f.draft(),/estimated_cost_exceeds_budget/);f.config.rateCeilingUsd=0.1;assert.equal(f.draft().maxSeconds,180);
}));
test('carrier duration at the reviewed limit explains the end without mislabeling other stops',using(f=>{
 const m=f.draft();m.maxSeconds=60;m.status='INCOMPLETE';m.carrierStatus='completed';m.billing={carrier:{durationSeconds:60}};
 assert.equal(phoneRecord(f.service,m).error,'call_time_limit_reached');assert.match(phoneRecord(f.service,m).summary,/60秒/);
 m.billing.carrier.durationSeconds=59;assert.notEqual(phoneRecord(f.service,m).error,'call_time_limit_reached');
 m.billing.carrier.durationSeconds=60;m.status='CANCELLED';assert.notEqual(phoneRecord(f.service,m).error,'call_time_limit_reached');
 m.status='INCOMPLETE';m.stopReason='credit_limit';assert.equal(phoneRecord(f.service,m).error,'credit_limit_reached');
 delete m.stopReason;m.stopNeedsReconciliation=true;assert.notEqual(phoneRecord(f.service,m).error,'call_time_limit_reached');
}));

test('phone notes persist requested and changed conditions from the worker without claiming a reservation',using(async f=>{
 const m=prepareManagedPhone(f.service,f.u,{phone:'+819000000000',name:'条件保持の境界確認',instruction:'9月25日19時2名の空席を確認。予約はしない。'});f.start(m);
 const worker=new Worker(f.service,{},async(_m,h)=>{
  h.onEvent({type:'call.connected'});
  for(const [i,source,text] of [[1,'callee','19時半でしたら空いております。'],[2,'caller','では、19時半でお願いします。'],[3,'callee','かしこまりました。19時でご予約承りました。']])h.onEvent({type:'transcript.final',turnId:'memory-'+i,source,text,t:i});
  const active=f.store.get('mission',m.id);assert.equal(active.memory.notes.find(n=>n.field==='time').status,'proposed');return {};
 });
 const active={abort:new AbortController(),control:{}};await worker.run(worker.claimNext(),active);
 const saved=f.store.get('mission',m.id),record=phoneRecord(f.service,saved);
 assert.equal(record.memory.bookingStatus,'not_authorized');assert.equal(record.memory.notes.find(n=>n.field==='time').value,'19:00');assert.equal(record.memory.notes.find(n=>n.field==='time').requested,'19:00');assert.ok(record.memory.history.some(n=>n.value==='19:30'));
 const original=record.memory;delete saved.memory;f.store.put('mission',saved);assert.deepEqual(phoneRecord(f.service,f.store.get('mission',m.id)).memory,original);
}));
