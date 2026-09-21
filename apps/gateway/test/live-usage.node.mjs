// GPT-Live accounting fixtures: session minutes only, real temporary SQLite, no phone calls or provider requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {billingConfiguration,applyBillingEvent,meteredCost,USAGE_RATE} from '../lib/billing.mjs';
import {firstConnectionNanoUsd,spendingProgress} from '../lib/credit-guard.mjs';
import {Store} from '../lib/store.mjs';
import {Credits} from '../lib/credits.mjs';

const usage=JSON.stringify({version:'live-boundary',carrier:[{prefix:'+81',currency:'USD',perMinute:'0.1',incrementSeconds:60,source:'bounded test rate'}],mediaPerMinute:'0.0044',search:{model:'gpt-5.4-mini',perCall:'0.01',input:'0.75',cached:'0.075',output:'4.5'}});
const env={OATHRA_CREDIT_POLICY:'provider-cost-v1',OATHRA_CREDIT_USD:'0.01',OATHRA_VOICE_ENGINE:'gpt-live',OATHRA_VOICE_MODEL:'gpt-live-1',OATHRA_LIVE_PRICES_JSON:JSON.stringify({model:'gpt-live-1',version:'live-boundary',perMinute:'0.05'}),OATHRA_SETTLEMENT_MODE:USAGE_RATE,OATHRA_USAGE_PRICES_JSON:usage};
function fixture(available=400){
 const dir=mkdtempSync(join(tmpdir(),'live-usage-')),store=new Store(join(dir,'db'),randomBytes(32).toString('hex'));
 const owner=randomUUID(),u={id:owner,role:'admin'},config={deployment:'managed',billing:billingConfiguration(env),maxCallUsd:4,users:[u]},credits=new Credits(store,config);
 credits.grant(u,owner,available,randomUUID(),'boundary test');
 const m={id:randomUUID(),owner,mode:'live',status:'INCOMPLETE',executionId:randomUUID(),target:{phone:'+819000000000'},createdAt:Date.now(),creditQuote:credits.quote('live','+819000000000',available)};
 store.tx(()=>credits.reserveTx(m));
 return {m,store,credits,close(){store.close();rmSync(dir,{recursive:true,force:true})}};
}
const using=(fn,available)=>async()=>{const f=fixture(available);try{await fn(f)}finally{f.close()}};

test('configuration: gpt-live is the only voice engine and needs its own reviewed per-minute price',()=>{
 const t=billingConfiguration(env);assert.equal(t.model,'gpt-live-1');assert.equal(t.voicePerMinuteNanoUsd,50000000);assert.equal(t.rates,undefined);
 const code=(overrides)=>{try{billingConfiguration({...env,...overrides});return null}catch(e){return e.code??e.message}};
 assert.equal(billingConfiguration({...env,OATHRA_SETTLEMENT_MODE:undefined,OATHRA_VOICE_ENGINE:undefined}).voicePerMinuteNanoUsd,50000000);
 assert.equal(code({OATHRA_LIVE_PRICES_JSON:undefined}),'configure_live_prices');
 assert.equal(code({OATHRA_VOICE_MODEL:'gpt-live-2'}),'configure_live_prices');
 assert.equal(code({OATHRA_LIVE_PRICES_JSON:JSON.stringify({model:'gpt-live-1',version:'v',perMinute:'0'})}),'configure_live_prices');
 for(const engine of ['realtime','pipeline'])assert.equal(code({OATHRA_VOICE_ENGINE:engine}),'unsupported_voice_engine');
});

test('a 62 second session settles two started voice minutes with no token usage events',using(f=>{
 const {m}=f;applyBillingEvent(m,{type:'billing.timing',startedAt:1000,endedAt:63000});m.billing.executionFinished=true;m.billing.carrier={durationSeconds:61,costNanoUsd:null,amount:null};
 const c=meteredCost(m);
 assert.equal(c.aiNanoUsd,100000000);assert.equal(c.carrierNanoUsd,200000000);assert.equal(c.mediaNanoUsd,8800000);assert.equal(c.totalNanoUsd,308800000);
 assert.equal(c.voiceModel,'gpt-live-1');assert.equal(c.quantities.voiceSeconds,62);assert.equal(c.unitRates.voicePerMinuteNanoUsd,50000000);assert.deepEqual(c.excluded,[]);
 f.store.put('mission',m);f.store.tx(()=>f.credits.settleTx(m));f.store.tx(()=>f.credits.settleTx(m));
 assert.equal(f.credits.usage(m).consumed,31);assert.equal(f.credits.balance(m.owner).available,369);assert.equal(f.credits.balance(m.owner).held,0);
}));

test('a rejected dial is free; a connected call without stream timing is absorbed, never invented',using(f=>{
 const {m}=f;applyBillingEvent(m,{type:'billing.timing',startedAt:NaN,endedAt:NaN});m.billing.executionFinished=true;m.billing.carrier={durationSeconds:0,costNanoUsd:0};
 assert.equal(meteredCost(m).aiNanoUsd,0);assert.deepEqual(meteredCost(m).excluded,[]);
 m.billing.connectedAt=5000;m.billing.carrier={durationSeconds:40,costNanoUsd:null};
 const c=meteredCost(m);assert.equal(c.aiNanoUsd,0);assert.deepEqual(c.excluded,['unmeasured-media-usage','unmeasured-voice-usage']);
 m.status='UNKNOWN';assert.equal(meteredCost(m),null);
}));

test('the balance guard reserves the first voice minute and stops before an unfunded one',using(f=>{
 const {m}=f;
 // carrier 0.1 + media 0.0044 + voice 0.05 per started minute = 0.1544 USD.
 assert.equal(firstConnectionNanoUsd(m.creditQuote.tariff),154400000);assert.equal(m.creditQuote.minimumAmount,16);assert.equal(m.creditQuote.amount,20);
 applyBillingEvent(m,{type:'billing.timing',startedAt:NaN,endedAt:NaN});m.billing.answeredAt=1000;m.billing.connectedAt=1000;
 const early=spendingProgress(m,31000);assert.equal(early.totalNanoUsd,154400000);assert.equal(early.stop,false);
 // 20 credits fund one minute only: stop at the boundary instead of starting a second one.
 assert.equal(spendingProgress(m,60500).stop,true);
},20));

test('a phone request may choose the voice; unknown voices are refused and the list is published',async()=>{
 const {createGateway,configuration}=await import('../server.mjs'),{createHash}=await import('node:crypto');
 const dir=mkdtempSync(join(tmpdir(),'voice-choice-')),token=randomBytes(32).toString('hex');
 const config=configuration({OATHRA_USERS_JSON:JSON.stringify([{id:'owner',team:'local',role:'admin',tokenHash:createHash('sha256').update(token).digest('hex')}]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:'3'});
 const app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+app.server.address().port,headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const status=await(await fetch(base+'/v1/phone/status',{headers})).json();assert.equal(status.defaultVoice,'marin');assert.equal(status.voices.length,13);assert.ok(status.voices.includes('vesper'));
  const draft=body=>fetch(base+'/v1/phone/draft',{method:'POST',headers,body:JSON.stringify({phone:'+819000000000',name:'local',instruction:'Only local validation; no phone execution.',...body})});
  const chosen=await draft({voice:'vesper'});assert.equal(chosen.status,201);assert.equal((await chosen.json()).mission.phoneRequest.voice,'vesper');
  const plain=await draft({});assert.equal(plain.status,201);assert.equal((await plain.json()).mission.phoneRequest.voice,undefined);
  assert.equal((await draft({voice:'alloy'})).status,400);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true})}
});
