// A restaurant's line answered by the AI. Real SQLite and the real webhook, credit and ledger code; signed
// requests are built locally and no carrier, model or network is contacted. Nothing here rings anyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../lib/store.mjs';
import {Service} from '../lib/service.mjs';
import {Phone} from '../lib/phone.mjs';
import {phoneRecord} from '../lib/phone-service.mjs';
import {evaluateSales} from '../lib/sales.mjs';
import {METERED,USAGE_RATE} from '../lib/billing.mjs';
import {configuration} from '../server.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const account='AC'+'a'.repeat(32),secret='twilio-secret',publicUrl='https://gateway.test';
const NOW=Date.parse('2026-09-21T10:00:00+09:00');
const restaurant={name:'ビストロ灯',slots:{'19:00':0,'19:30':1,'20:00':2},maxParty:6,closedDates:['2026-09-23']};
function setup(over={}){
 const dir=mkdtempSync(join(tmpdir(),'reception-')),key=randomBytes(32).toString('hex');
 const users=[{id:'bistro',team:'bistro',role:'admin',tokenHash:hash(randomUUID())},{id:'other',team:'other',role:'operator',tokenHash:hash(randomUUID())}];
 const env={OATHRA_USERS_JSON:JSON.stringify(users),OATHRA_DATA_KEY:key,OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_MODE:'live',OATHRA_PUBLIC_URL:publicUrl,
  TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:secret,TWILIO_PHONE_NUMBER:'+815000000000',OPENAI_API_KEY:'local-unused',OATHRA_VOICE_MODEL:'gpt-live-1',OATHRA_BUSINESS_NAME:'Oathra',OATHRA_RATE_CEILING_USD:'1',OATHRA_LIVE_POLICY_REVIEWED:'true',
  OATHRA_CREDIT_POLICY:METERED,OATHRA_CREDIT_USD:'0.01',OATHRA_LIVE_PRICES_JSON:JSON.stringify({model:'gpt-live-1',version:'reception',perMinute:'0.05'}),OATHRA_SETTLEMENT_MODE:USAGE_RATE,
  OATHRA_USAGE_PRICES_JSON:JSON.stringify({version:'reception',carrier:[{prefix:'+81',currency:'USD',perMinute:'0.1',incrementSeconds:60,source:'bounded test rate'}],inbound:{currency:'USD',perMinute:'0.02',incrementSeconds:60,source:'bounded test rate'},mediaPerMinute:'0.0044',search:{model:'gpt-5.4-mini',perCall:'0.01',input:'0.75',cached:'0.075',output:'4.5'}}),
  OATHRA_INBOUND_OWNER:'bistro',OATHRA_RESTAURANT_JSON:JSON.stringify(restaurant),...over};
 const config=configuration(env);config.liveReady=true;
 const store=new Store(config.dbPath,key,()=>NOW),service=new Service(store,config),phone=new Phone(service,env);
 for(const u of users)service.saveConsent(u,config.consentVersion);
 service.credits.grant(users[0],'bistro',500,randomUUID(),'bounded reception verification');
 const ring=from=>{const path='/hooks/twilio/voice',params={AccountSid:account,CallSid:'CA'+randomBytes(16).toString('hex'),From:from,To:'+815000000000',CallStatus:'ringing'};
  const twiml=phone.callback(path,params,{'x-twilio-signature':createHmac('sha1',secret).update(publicUrl+path+Object.keys(params).sort().map(k=>k+params[k]).join('')).digest('base64')});
  return {twiml,mission:store.list('mission').find(m=>m.inbound?.callSid===params.CallSid)};};
 // One call at a time is answered: end the last one before the next rings.
 const end=m=>{const x=store.get('mission',m.id);x.status='INCOMPLETE';x.finishedAt=NOW;store.put('mission',x);service.credits.grant(users[0],'bistro',500,randomUUID(),'the next bounded call')};
 return {dir,store,service,phone,config,users,ring,end,close(){store.close();rmSync(dir,{recursive:true,force:true})}};
}
const using=(fn,over)=>async()=>{const f=setup(over);try{await fn(f)}finally{f.close()}};
const want={date:'2026-09-25',time:'19:30',partySize:2};

test('a restaurant line needs no person\'s name, and a broken ledger configuration stops the service at start',()=>{
 const f=setup();try{assert.equal(f.config.inbound.name,'ビストロ灯');assert.deepEqual(f.config.inbound.restaurant.slots,restaurant.slots)}finally{f.close()}
 assert.throws(()=>setup({OATHRA_RESTAURANT_JSON:'{"name":"x","slots":{"25:00":1},"maxParty":4}'}),/configure_restaurant_json/);
 assert.throws(()=>setup({OATHRA_RESTAURANT_JSON:'not json'}),/configure_restaurant_json/);
});

test('the call is answered as the restaurant, billed to the restaurant, whoever rang before',using(f=>{
 const {twiml,mission:m}=f.ring('+819011112222');
 assert.ok(twiml.includes('この通話は記録されています。'));assert.ok(twiml.includes('/media/'+m.inbound.token));
 assert.equal(m.goal,'phone.reception');assert.equal(m.owner,'bistro');assert.equal(m.inbound.reception,true);assert.equal(m.inbound.ownerName,'ビストロ灯');assert.equal(m.creditQuote.tariff.carrierRate.prefix,'inbound');
 assert.match(evaluateSales([],m,true).caveat,/^予約受付の記録です/);
}));

test('the ledger is the restaurant\'s: the last table goes once, a change moves it, and each call shows only its own booking',using(f=>{
 const first=f.ring('+819011112222').mission,desk=f.phone.desk(first);
 assert.deepEqual(desk.check({...want,time:'19:00'}),{status:'full',alternatives:['19:30','20:00']});
 assert.equal(desk.check({...want,date:'2026-09-23'}).status,'closed');
 const booked=desk.book({...want,name:'田中'});
 assert.equal(booked.status,'booked');assert.equal(booked.booking.phone,undefined);
 // The caller's number is on the stored record for the restaurant, never in what the model is told.
 const [saved]=f.store.all('table-booking','bistro');assert.equal(saved.phone,'+819011112222');assert.equal(saved.callId,first.id);
 f.end(first);

 const second=f.ring('+819033334444').mission,other=f.phone.desk(second);
 assert.deepEqual(other.book({...want,name:'佐藤'}),{status:'full',alternatives:['20:00']});
 assert.equal(other.book({...want,time:'20:00',name:'佐藤'}).status,'booked');
 assert.equal(other.book({...want,time:'20:00',name:'佐藤'}).moved,true);
 assert.deepEqual(f.store.all('table-booking','bistro').map(b=>`${b.time} ${b.name}`).sort(),['19:30 田中','20:00 佐藤']);

 // The first caller changes their mind on their own call: one booking, moved; 19:30 is free again.
 assert.equal(desk.book({...want,time:'20:00',name:'田中'}).moved,true);
 assert.equal(other.check(want).status,'available');
 assert.equal(f.store.all('table-booking','bistro').length,2);
 assert.deepEqual(phoneRecord(f.service,f.store.get('mission',first.id)).booking,{id:saved.id,date:'2026-09-25',time:'20:00',partySize:2,name:'田中',callId:first.id,createdAt:NOW,status:'booked'});
 assert.equal(phoneRecord(f.service,f.store.get('mission',first.id)).memory.notes?.length??0,0);
 assert.deepEqual(f.store.audits().map(a=>a.action).filter(a=>a.startsWith('table.')).sort(),['table.booked','table.booked','table.booking_moved','table.booking_moved']);
 // Another account has no view of this ledger.
 assert.deepEqual(f.store.all('table-booking','other'),[]);
}));

test('a call that books nothing shows no booking, and old bookings leave with the other records',using(f=>{
 const {mission:m}=f.ring('+819011112222');
 assert.equal(phoneRecord(f.service,m).booking,null);
 f.store.put('table-booking',{id:randomUUID(),owner:'bistro',status:'booked',date:'2026-08-01',time:'19:30',partySize:2,name:'古い予約',callId:'x',createdAt:0});
 f.store.put('table-booking',{id:randomUUID(),owner:'bistro',status:'booked',date:'2026-09-25',time:'19:30',partySize:2,name:'先の予約',callId:'y',createdAt:0});
 f.store.prune(30);
 assert.deepEqual(f.store.all('table-booking','bistro').map(b=>b.name),['先の予約']);
}));
