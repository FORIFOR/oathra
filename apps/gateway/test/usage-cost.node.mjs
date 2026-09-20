// Minimal accounting fixtures: only quantities and lifecycle boundaries, real temporary SQLite, no phone calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {billingConfiguration,applyBillingEvent,meteredCost,USAGE_RATE} from '../lib/billing.mjs';
import {Store} from '../lib/store.mjs';
import {Credits} from '../lib/credits.mjs';
import {Worker} from '../lib/worker.mjs';
import {Phone} from '../lib/phone.mjs';
import {createHmac} from 'node:crypto';

const env={OATHRA_CREDIT_POLICY:'provider-cost-v1',OATHRA_CREDIT_USD:'0.01',OATHRA_VOICE_ENGINE:'realtime',OATHRA_VOICE_MODEL:'gpt-realtime-1.5',OATHRA_REALTIME_PRICES_JSON:JSON.stringify({model:'gpt-realtime-1.5',version:'unit-boundary',inputText:4,inputAudio:32,cachedText:0.4,cachedAudio:0.4,outputText:16,outputAudio:64}),OATHRA_SETTLEMENT_MODE:USAGE_RATE,OATHRA_USAGE_PRICES_JSON:JSON.stringify({version:'unit-boundary',carrier:[{prefix:'+81',currency:'USD',perMinute:'0.1',incrementSeconds:60,source:'bounded test rate'},{prefix:'+8190',currency:'USD',perMinute:'0.2',incrementSeconds:60,source:'bounded test rate'}],mediaPerMinute:'0.0044',search:{model:'gpt-5.4-mini',perCall:'0.01',input:'0.75',cached:'0.075',output:'4.5'}})};
const voice={input_tokens:1000,output_tokens:100,input_token_details:{text_tokens:800,audio_tokens:200,cached_tokens:200,cached_tokens_details:{text_tokens:100,audio_tokens:100}},output_token_details:{text_tokens:20,audio_tokens:80}};
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'usage-cost-')),store=new Store(join(dir,'db'),randomBytes(32).toString('hex'));
 const owner=randomUUID(),u={id:owner,role:'admin'},config={deployment:'managed',billing:billingConfiguration(env),maxCallUsd:4,users:[u]},credits=new Credits(store,config);
 const m={id:randomUUID(),owner,mode:'live',status:'FAILED',executionId:randomUUID(),target:{phone:'+819000000000'},createdAt:Date.now(),creditQuote:credits.quote('live','+819000000000')};
 credits.grant(u,owner,400,randomUUID(),'boundary test');store.tx(()=>credits.reserveTx(m));
 for(const e of [{type:'billing.ai',kind:'started'},{type:'billing.ai',kind:'response',id:'voice-1',model:config.billing.model,usage:voice},{type:'billing.ai',kind:'closed',complete:true},{type:'billing.timing',startedAt:1000,endedAt:33000}])applyBillingEvent(m,e);
 m.billing.executionFinished=true;store.put('mission',m);
 return {m,store,config,credits,u,close(){store.close();rmSync(dir,{recursive:true,force:true})}};
}
const using=fn=>async()=>{const f=fixture();try{await fn(f)}finally{f.close()}};
function search(m){for(const e of [{kind:'started'},{kind:'response',calls:1,usage:{input_tokens:1000,input_tokens_details:{cached_tokens:200},output_tokens:100}}])applyBillingEvent(m,{type:'billing.search',id:'search-1',model:'gpt-5.4-mini',...e})}
test('ends without carrier price: minute rounding, cached tokens, search and one final credit rounding',using(f=>{
 const {m}=f;search(m);m.billing.carrier={durationSeconds:32,costNanoUsd:null,amount:null};
 const c=meteredCost(m);assert.equal(c.carrierNanoUsd,200000000);assert.equal(c.mediaNanoUsd,4400000);assert.equal(c.aiNanoUsd,11520000);assert.equal(c.searchNanoUsd,11065000);assert.equal(c.totalNanoUsd,226985000);
 f.store.tx(()=>f.credits.settleTx(m));assert.equal(f.credits.usage(m).consumed,23);assert.equal(f.credits.balance(m.owner).available,377);assert.equal(f.credits.balance(m.owner).held,0);
 assert.equal(f.credits.usage(m).cost.voiceModel,'gpt-realtime-1.5');assert.equal(f.credits.usage(m).cost.searchCalls,1);
}));
test('longer calls and additional searches increase cost; cache quantities use discounted rates',using(({m})=>{
 const a=meteredCost(m);m.billing.timing.endedAt=62000;const b=meteredCost(m);assert.equal(b.carrierNanoUsd,400000000);assert.ok(b.totalNanoUsd>a.totalNanoUsd);search(m);assert.equal(meteredCost(m).totalNanoUsd-b.totalNanoUsd,11065000);
}));
test('multiple web-search calls returned in one Responses request are all counted',using(({m})=>{
 applyBillingEvent(m,{type:'billing.search',id:'multi-search',kind:'response',model:'gpt-5.4-mini',calls:2,usage:{input_tokens:9268,input_tokens_details:{cached_tokens:0},output_tokens:491}});
 assert.equal(meteredCost(m).searchCalls,2);assert.equal(meteredCost(m).searchNanoUsd,29160500);assert.deepEqual(meteredCost(m).excluded,[]);
}));
test('restart between terminal write and finally settles known usage without a carrier price lookup',using(async f=>{
 f.m.status='INCOMPLETE';delete f.m.billing.executionFinished;f.store.put('mission',f.m);
 const worker=new Worker({store:f.store,credits:f.credits,notify(){}},{},undefined);worker.start();
 try{assert.equal(f.credits.usage(f.m).consumed,22);assert.equal(f.credits.balance(f.m.owner).held,0);}finally{await worker.stop()}
}));
test('restart after a definitive rejected dial returns the entire hold with no carrier SID',using(async f=>{
 f.m.status='FAILED';f.m.error='carrier_dial_rejected';f.m.billing={state:'pending',ai:{started:false,closed:false,complete:false,pending:[],responses:[]}};f.store.put('mission',f.m);
 const worker=new Worker({store:f.store,credits:f.credits,notify(){}},{},undefined);worker.start();
 try{assert.equal(f.credits.usage(f.m).consumed,0);assert.equal(f.credits.usage(f.m).released,400);assert.equal(f.credits.balance(f.m.owner).held,0);}finally{await worker.stop()}
}));
test('identical usage, repeated settlement, late invoice, restart and tariff change never double debit',using(f=>{
 search(f.m);search(f.m);assert.equal(meteredCost(f.m).searchCalls,1);
 for(let i=0;i<3;i++)f.store.tx(()=>f.credits.settleTx(f.m));
 f.m.billing.carrier={durationSeconds:100,costNanoUsd:999999999};f.config.billing.rates.outputAudio=999999;
 f.store.tx(()=>f.credits.settleTx(f.m));assert.equal(f.credits.usage(f.m).consumed,23);assert.equal(f.credits.history(f.m.owner).filter(x=>x.kind==='consume').length,1);
 const reopened=new Credits(f.store,f.config);assert.equal(reopened.usage(f.store.get('mission',f.m.id)).consumed,23);
}));
test('unknown side effects keep hold; incomplete usage is explicitly absorbed after a known stop',using(f=>{
 const m=f.m;m.status='UNKNOWN';assert.equal(meteredCost(m),null);m.status='FAILED';m.stopNeedsReconciliation=true;assert.equal(meteredCost(m),null);delete m.stopNeedsReconciliation;
 m.billing.ai.complete=false;m.billing.ai.pending.push('missing');applyBillingEvent(m,{type:'billing.search',id:'lost',kind:'started',model:'gpt-5.4-mini'});
 const c=meteredCost(m);assert.deepEqual(c.excluded,['unmeasured-voice-usage','unmeasured-search-usage']);assert.equal(c.aiNanoUsd,11520000);assert.equal(c.searchNanoUsd,0);
}));
test('conflicting search usage cannot inflate a charge; cancellation without provider usage is not invented',using(({m})=>{
 search(m);applyBillingEvent(m,{type:'billing.search',id:'search-1',kind:'response',model:'gpt-5.4-mini',calls:1,usage:{input_tokens:99999,input_tokens_details:{cached_tokens:0},output_tokens:100}});
 assert.equal(meteredCost(m).searchNanoUsd,0);assert.deepEqual(meteredCost(m).excluded,['unmeasured-search-usage']);
}));
test('rates bind destination by longest prefix and invalid/unpriced destinations fail before reservation',using(f=>{
 assert.equal(f.credits.quote('live','+819000000000').tariff.carrierRate.perMinute,'0.2');assert.equal(f.credits.quote('live','+81300000000').tariff.carrierRate.perMinute,'0.1');
 assert.throws(()=>f.credits.quote('live','+12025550123'),/carrier_rate_not_configured/);
 f.config.billing.carrier[0].perMinuteNanoUsd++;const next={...f.m,id:randomUUID()};assert.throws(()=>f.store.tx(()=>f.credits.reserveTx(next)),/credit_price_changed/);
}));
test('failed call before connection is free, upper bound cannot overdraw, settlement rolls back atomically',using(f=>{
 const m=f.m;m.billing.timing=undefined;m.billing.carrier={durationSeconds:0,costNanoUsd:0};m.billing.ai={started:false,closed:false,complete:false,pending:[],responses:[]};assert.equal(meteredCost(m).totalNanoUsd,0);
 assert.throws(()=>f.store.tx(()=>{f.credits.settleTx(m);throw Error('rollback')}),/rollback/);assert.equal(f.credits.balance(m.owner).held,400);
 m.billing.carrier.durationSeconds=9999;f.store.tx(()=>f.credits.settleTx(m));assert.equal(f.credits.usage(m).consumed,400);assert.equal(f.credits.usage(m).cost.capped,true);assert.equal(f.credits.balance(m.owner).available,0);
}));
test('worker finally immediately settles usage and timing without waiting for a price GET',using(async f=>{
 const {m}=f;m.kind='phone-request';m.goal='phone.message';m.request='accounting boundary';m.maxSeconds=60;m.product=null;delete m.billing.executionFinished;f.store.put('mission',m);
 const service={store:f.store,credits:f.credits,notify(){}};
 const worker=new Worker(service,{},async (_m,{onEvent})=>{onEvent({type:'call.connected'});onEvent({type:'billing.timing',startedAt:1000,endedAt:33000});return {transcript:[]}});
 await worker.run(m,{abort:new AbortController(),control:{}});assert.equal(f.credits.usage(m).status,'settled');assert.equal(f.credits.usage(m).consumed,22);assert.equal(f.credits.balance(m.owner).held,0);
}));
test('signed Twilio callback authenticates identity, records duration and is idempotent',using(f=>{
 const token=randomUUID(),sid='CA'+randomBytes(16).toString('hex'),account='AC'+randomBytes(16).toString('hex'),secret=randomUUID();
 f.m.carrierSid=sid;f.m.billing.timing=undefined;f.store.put('mission',f.m);f.store.setKey('optout',token,f.store.seal({mission:f.m.id}));
 const phone=new Phone({store:f.store,credits:f.credits,config:{publicUrl:'https://example.com'}},{TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:secret});
 const path='/hooks/twilio/status/'+token,params={AccountSid:account,CallSid:sid,CallStatus:'completed',CallDuration:'32'};
 const sig=p=>createHmac('sha1',secret).update('https://example.com'+path+Object.keys(p).sort().map(k=>k+p[k]).join('')).digest('base64');
 assert.throws(()=>phone.callback(path,params,{}),/invalid_twilio_signature/);
 for(let i=0;i<2;i++)phone.callback(path,params,{'x-twilio-signature':sig(params)});
 assert.equal(f.credits.usage(f.m).consumed,22);assert.equal(f.credits.history(f.m.owner).filter(e=>e.kind==='consume').length,1);
 const wrong={...params,CallSid:'CA'+randomBytes(16).toString('hex')};assert.throws(()=>phone.callback(path,wrong,{'x-twilio-signature':sig(wrong)}),/unknown_call/);
}));
