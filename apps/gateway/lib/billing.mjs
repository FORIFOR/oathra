import { assert } from './security.mjs';

export const METERED='provider-cost-v1';
export const USAGE_RATE='usage-rate-v1';
const keys=['inputText','inputAudio','cachedText','cachedAudio','outputText','outputAudio'];
// Integer nanodollars avoid binary floating point rounding at credit boundaries.
export function nanoUsd(value) {
 const s=String(value);assert(/^\d+(?:\.\d{1,9})?$/.test(s),'invalid_usd_amount');
 const [whole,part='']=s.split('.'),n=BigInt(whole)*1000000000n+BigInt(part.padEnd(9,'0'));
 assert(n<=BigInt(Number.MAX_SAFE_INTEGER),'usd_amount_too_large');return Number(n);
}
export function billingConfiguration(env) {
 const policy=env.OATHRA_CREDIT_POLICY??'call-attempt-v1';assert(['call-attempt-v1',METERED].includes(policy),'invalid_credit_policy',500);
 if(policy!==METERED)return {policy};
 assert(env.OATHRA_VOICE_ENGINE==='realtime','metered_requires_realtime',500);
 const creditNanoUsd=nanoUsd(env.OATHRA_CREDIT_USD);assert(creditNanoUsd>0,'invalid_credit_usd',500);
 let prices;try{prices=JSON.parse(env.OATHRA_REALTIME_PRICES_JSON)}catch{assert(false,'configure_realtime_prices',500)}
 assert(prices.model===env.OATHRA_VOICE_MODEL&&typeof prices.version==='string'&&prices.version.length>0,'configure_realtime_prices',500);
 const rates=Object.fromEntries(keys.map(k=>{const n=nanoUsd(prices[k]);assert(n%1000000===0,'invalid_token_price');return [k,n/1000000]}));
 let carrierFx;
 if(env.OATHRA_CARRIER_JPY_PER_USD){const unitsPerUsdNano=nanoUsd(env.OATHRA_CARRIER_JPY_PER_USD);assert(unitsPerUsdNano>0&&/^\d{4}-\d{2}-\d{2}$/.test(env.OATHRA_CARRIER_FX_DATE??''),'configure_carrier_fx',500);carrierFx={currency:'JPY',unitsPerUsdNano,date:env.OATHRA_CARRIER_FX_DATE};}
 const tariff={policy,creditNanoUsd,model:prices.model,version:prices.version,rates,...(carrierFx?{carrierFx}:{})};
 if(env.OATHRA_SETTLEMENT_MODE){
  assert(env.OATHRA_SETTLEMENT_MODE===USAGE_RATE,'invalid_settlement_mode',500);
  let p;try{p=JSON.parse(env.OATHRA_USAGE_PRICES_JSON)}catch{assert(false,'configure_usage_prices',500)}
  assert(typeof p?.version==='string'&&p.version.length>0&&Array.isArray(p.carrier)&&p.carrier.length>0,'configure_usage_prices',500);
  const prefixes=new Set();
  const carrier=p.carrier.map(c=>{
   assert(/^\+[1-9]\d{0,14}$/.test(c.prefix)&&!prefixes.has(c.prefix),'invalid_carrier_prefix',500);prefixes.add(c.prefix);
   assert(typeof c.source==='string'&&c.source.length>0,'configure_carrier_source',500);
   const rate=nanoUsd(c.perMinute);
   // carrierCost accepts the provider's negative-charge notation.
   const converted=carrierCost(rate?'-'+c.perMinute:'0',c.currency,tariff);
   assert(converted!==null&&converted>0,'configure_carrier_rate',500);
   assert(Number.isSafeInteger(c.incrementSeconds)&&c.incrementSeconds>0&&c.incrementSeconds<=60,'invalid_billing_increment',500);
   return {...c,perMinuteNanoUsd:converted};
  }).sort((a,b)=>b.prefix.length-a.prefix.length);
  const s=p.search;assert(s?.model==='gpt-5.4-mini','configure_search_model',500);
  const search={model:s.model,perCallNanoUsd:nanoUsd(s.perCall),rates:Object.fromEntries(['input','cached','output'].map(k=>{const n=nanoUsd(s[k]);assert(n%1000000===0,'invalid_token_price');return [k,n/1000000]}))};
  Object.assign(tariff,{settlement:USAGE_RATE,usageVersion:p.version,carrier,mediaPerMinuteNanoUsd:nanoUsd(p.mediaPerMinute),search});
 }
 return tariff;
}
export function carrierCost(price,currency,tariff){
 if(typeof price!=='string'||!/^-(?:\d+)(?:\.\d{1,9})?$|^0(?:\.0+)?$/.test(price))return null;
 const amount=nanoUsd(price.replace(/^-/,''));
 if(currency==='USD')return amount;
 if(currency==='JPY'&&tariff.carrierFx?.currency==='JPY')return Number(BigInt(amount)*1000000000n/BigInt(tariff.carrierFx.unitsPerUsdNano));
 return null;
}
export function responseCost(usage,rates) {
 const integer=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000;
 const i=usage?.input_token_details,o=usage?.output_token_details,c=i?.cached_tokens_details;
 if(!i||!o||![usage.input_tokens,usage.output_tokens,i.text_tokens,i.audio_tokens,i.cached_tokens,o.text_tokens,o.audio_tokens].every(integer))return null;
 if((i.image_tokens??0)!==0||i.text_tokens+i.audio_tokens!==usage.input_tokens||o.text_tokens+o.audio_tokens!==usage.output_tokens)return null;
 const ct=i.cached_tokens===0?0:c?.text_tokens,ca=i.cached_tokens===0?0:c?.audio_tokens;
 if(!integer(ct)||!integer(ca)||ct+ca!==i.cached_tokens||ct>i.text_tokens||ca>i.audio_tokens)return null;
 const counts={inputText:i.text_tokens-ct,inputAudio:i.audio_tokens-ca,cachedText:ct,cachedAudio:ca,outputText:o.text_tokens,outputAudio:o.audio_tokens};
 const cost=keys.reduce((n,k)=>n+BigInt(counts[k])*BigInt(rates[k]),0n);
 return cost<=BigInt(Number.MAX_SAFE_INTEGER)?Number(cost):null;
}
export function applyBillingEvent(m,e) {
 if(m.creditQuote?.policy!==METERED)return;
 const b=m.billing??={state:'pending',ai:{started:false,closed:false,complete:false,pending:[],responses:[]}};
 if(e.type==='billing.timing'){
  if(Number.isSafeInteger(e.startedAt)&&Number.isSafeInteger(e.endedAt)&&e.endedAt>=e.startedAt)b.timing={startedAt:e.startedAt,endedAt:e.endedAt};
 }
 if(e.type==='billing.search'&&typeof e.id==='string'){
  const list=b.search??=[];let item=list.find(r=>r.id===e.id);
  if(!item){item={id:e.id,model:e.model,state:'pending'};list.push(item);}
  if(e.kind==='response'){
   const normalized={model:e.model,usage:e.usage,calls:e.calls};
   if(item.state==='reported'&&JSON.stringify(item.report)!==JSON.stringify(normalized))item.conflict=true;
   if(item.state!=='reported'){item.report=normalized;item.state='reported';}
  }
  if(e.kind==='unavailable'&&item.state!=='reported')item.state='unavailable';
 }
 if(e.type==='billing.ai'){
  const a=b.ai;
  if(e.kind==='started')a.started=true;
  if(e.kind==='pending'&&typeof e.id==='string'&&!a.pending.includes(e.id)&&!a.responses.some(r=>r.id===e.id))a.pending.push(e.id);
  if(e.kind==='response'&&typeof e.id==='string'){
   const costNanoUsd=e.model===m.creditQuote.tariff.model?responseCost(e.usage,m.creditQuote.tariff.rates):null;
   const old=a.responses.find(r=>r.id===e.id);
   if(old&&JSON.stringify(old.usage)!==JSON.stringify(e.usage))a.conflict=true;
   if(!old)a.responses.push({id:e.id,usage:e.usage,costNanoUsd});
   a.pending=a.pending.filter(id=>id!==e.id);
  }
  if(e.kind==='closed'){a.closed=true;a.complete=e.complete===true;}
 }
}
export function meteredCost(m) {
 const b=m.billing;if(!b||m.creditQuote?.policy!==METERED)return null;
 if(m.creditQuote.tariff.settlement===USAGE_RATE)return usageRateCost(m);
 if(!b.carrier||!Number.isSafeInteger(b.carrier.costNanoUsd)||b.carrier.costNanoUsd<0||!b.executionFinished||m.status==='UNKNOWN'||m.stopNeedsReconciliation)return null;
 const a=b.ai;
 if(a.started&&(!a.closed||!a.complete||a.pending.length||a.conflict||a.responses.some(r=>r.costNanoUsd===null)))return null;
 const aiNanoUsd=a.responses.reduce((n,r)=>n+r.costNanoUsd,0);
 const totalNanoUsd=b.carrier.costNanoUsd+aiNanoUsd;
 assert(Number.isSafeInteger(totalNanoUsd)&&totalNanoUsd>=0,'invalid_metered_total');
 return {currency:'USD',totalNanoUsd,carrierNanoUsd:b.carrier.costNanoUsd,carrierAmount:b.carrier.amount,carrierCurrency:b.carrier.currency,carrierFx:m.creditQuote.tariff.carrierFx,aiNanoUsd,durationSeconds:b.carrier.durationSeconds,
  basis:'carrier-price-and-realtime-usage',operatorPays:['transcription','media-streams','taxes','phone-number','infrastructure'],tariff:m.creditQuote.tariff.version};
}

export function finishBilling(m){
 if(!m?.billing)return;
 m.billing.executionFinished=true;
 if(m.error==='carrier_dial_rejected'&&!m.carrierSid&&!m.billing.ai.started)m.billing.carrier={costNanoUsd:0,durationSeconds:0};
}

/** A service charge fixed at call end, not a claim that the provider invoice has arrived. */
export function usageRateCost(m){
 const b=m.billing,t=m.creditQuote.tariff;
 if(!b?.executionFinished||m.status==='UNKNOWN'||m.stopNeedsReconciliation)return null;
 const seconds=Number.isSafeInteger(b.carrier?.durationSeconds)?b.carrier.durationSeconds:
  b.timing?Math.ceil((b.timing.endedAt-(b.answeredAt??b.timing.startedAt))/1000):null;
 if(seconds===null||seconds<0)return null;
 const rate=t.carrierRate;if(!rate)return null;
 const billedSeconds=Math.ceil(seconds/rate.incrementSeconds)*rate.incrementSeconds;
 const perDuration=(n,s)=>Number((BigInt(n)*BigInt(s)+59n)/60n);
 const carrierNanoUsd=perDuration(rate.perMinuteNanoUsd,billedSeconds);
 const mediaSeconds=b.timing?Math.ceil((b.timing.endedAt-b.timing.startedAt)/1000):0;
 const mediaNanoUsd=perDuration(t.mediaPerMinuteNanoUsd,Math.ceil(mediaSeconds/60)*60);
 const a=b.ai,excluded=[];
 if(!b.timing&&a.started)excluded.push('unmeasured-media-usage');
 // Lost or conflicting quantities are explicitly absorbed, never invented or billed twice.
 const valid=a.conflict?[]:a.responses.filter(r=>Number.isSafeInteger(r.costNanoUsd)&&r.costNanoUsd>=0);
 if(a.started&&(!a.closed||!a.complete||a.pending.length||a.conflict||valid.length!==a.responses.length))excluded.push('unmeasured-voice-usage');
 const aiNanoUsd=valid.reduce((n,r)=>n+r.costNanoUsd,0);
 let searchNanoUsd=0,searchCalls=0,searchTokensNanoUsd=0;
 const searchUsage={input:0,cached:0,output:0};
 for(const r of b.search??[]){
  const p=r.report,u=p?.usage,cached=u?.input_tokens_details?.cached_tokens;
  const integer=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000;
  if(r.conflict||r.state!=='reported'||p.model!==t.search.model||![u?.input_tokens,u?.output_tokens,cached,p?.calls].every(integer)||cached>u.input_tokens||p.calls>1000){excluded.push('unmeasured-search-usage');continue;}
  searchCalls+=p.calls;searchUsage.input+=u.input_tokens-cached;searchUsage.cached+=cached;searchUsage.output+=u.output_tokens;
 }
 for(const k of ['input','cached','output'])searchTokensNanoUsd+=searchUsage[k]*t.search.rates[k];
 searchNanoUsd=searchTokensNanoUsd+searchCalls*t.search.perCallNanoUsd;
 const totalNanoUsd=carrierNanoUsd+mediaNanoUsd+aiNanoUsd+searchNanoUsd;
 assert(Number.isSafeInteger(totalNanoUsd)&&totalNanoUsd>=0,'invalid_metered_total');
 const voiceUsage=Object.fromEntries(keys.map(k=>[k,0]));
 for(const r of valid){const i=r.usage.input_token_details,o=r.usage.output_token_details,c=i.cached_tokens_details;voiceUsage.inputText+=i.text_tokens-(c?.text_tokens??0);voiceUsage.inputAudio+=i.audio_tokens-(c?.audio_tokens??0);voiceUsage.cachedText+=c?.text_tokens??0;voiceUsage.cachedAudio+=c?.audio_tokens??0;voiceUsage.outputText+=o.text_tokens;voiceUsage.outputAudio+=o.audio_tokens;}
 return {currency:'USD',totalNanoUsd,carrierNanoUsd,mediaNanoUsd,aiNanoUsd,searchNanoUsd,searchCalls,searchTokensNanoUsd,durationSeconds:seconds,
  basis:USAGE_RATE,voiceModel:t.model,searchModel:t.search.model,tariff:t.usageVersion,
  quantities:{carrierBilledSeconds:billedSeconds,mediaSeconds,voice:voiceUsage,search:searchUsage},
  unitRates:{carrier:rate,mediaPerMinuteNanoUsd:t.mediaPerMinuteNanoUsd,voice:t.rates,search:t.search,carrierFx:t.carrierFx},
  durationSource:Number.isSafeInteger(b.carrier?.durationSeconds)?'twilio-duration':b.answeredAt?'answered-to-close':'media-stream',
  excluded:[...new Set(excluded)],operatorPays:['unmeasured-usage','invoice-differences','transcription','taxes','phone-number','infrastructure']};
}
