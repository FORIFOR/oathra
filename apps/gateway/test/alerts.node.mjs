// A call that hears trouble, or reaches nobody, tells a person to look. It never carries the words unless asked to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Worker } from '../lib/worker.mjs';
import { Alerts, alertConfiguration, alertSignature } from '../lib/alerts.mjs';
import { hash } from '../lib/security.mjs';
const now=Date.parse('2026-09-19T03:00:00+09:00'),secret='s'.repeat(40),url='https://alerts.example.org/hook';
function fixture({webhook=true,quotes=false}={}){
  const config={mode:'simulator',users:[{id:'alice',team:'one',role:'admin',tokenHash:hash('alice-token')}],maxSeconds:300,maxCallUsd:10,dailyCalls:20,dailyUsd:30,rateCeilingUsd:0.1,setupFeeUsd:0,consentVersion:'v1',liveReady:false,publicUrl:'https://gateway.example.org',missing:[]};
  const store=new Store(':memory:',randomBytes(32).toString('hex'),()=>now),service=new Service(store,config),u=config.users[0],sent=[];
  const alerts=new Alerts(service,webhook?alertConfiguration({OATHRA_ALERT_WEBHOOK_URL:url,OATHRA_ALERT_WEBHOOK_SECRET:secret,...(quotes?{OATHRA_ALERT_INCLUDE_QUOTES:'true'}:{})}):null,
    {fetchImpl:async(to,init)=>{sent.push({to,init});return {ok:true};},resolve:async()=>[{address:'93.184.216.34'}]});
  // The simulator only previews ordinary requests, so a dialing one is placed directly and its execution entered past the claim.
  const mission=(extra={})=>{const m={id:crypto.randomUUID(),owner:u.id,team:'one',kind:'phone-request',status:'DIALING',revision:1,mode:'live',maxSeconds:180,origin:null,createdAt:now,approvedAt:now,target:{phone:'+819000000002',name:'山田'},request:'お変わりないか聞いてください。',
    phoneRequest:{schemaVersion:1,kind:'oathra.phone-request',phone:'+819000000002',name:'山田',instruction:'お変わりないか聞いてください。',...extra}};store.put('mission',m);return m;};
  const run=async(m,lines,{connect=true}={})=>{let aborted;const w=new Worker(service,{process:async()=>{},send:async()=>{}},async(_,hooks)=>{if(connect)hooks.onEvent({type:'call.connected'});
    lines.forEach((line,i)=>hooks.onEvent({type:'transcript.final',turnId:`t${i}`,source:line.startsWith('A:')?'caller':'callee',text:line.slice(2).trim()}));aborted=hooks.signal.aborted;return {};},alerts);
    await w.run(m,{id:m.id,abort:new AbortController(),control:{}});return {aborted,worker:w,saved:store.get('mission',m.id)};};
  const queued=()=>store.list('alert');
  const audits=()=>store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='call.alert'").get().n;
  return {store,service,alerts,sent,mission,run,queued,audits,close(){store.close();}};
}
const using=(fn,options)=>async()=>{const f=fixture(options);try{await fn(f);}finally{f.close();}};

test('the endpoint must be HTTPS with a long secret, or absent',()=>{
  assert.equal(alertConfiguration({}),null);
  assert.throws(()=>alertConfiguration({OATHRA_ALERT_WEBHOOK_URL:'http://alerts.example.org/hook',OATHRA_ALERT_WEBHOOK_SECRET:secret}),/configure_alert_webhook_url/);
  assert.throws(()=>alertConfiguration({OATHRA_ALERT_WEBHOOK_URL:'https://user:pw@alerts.example.org/hook',OATHRA_ALERT_WEBHOOK_SECRET:secret}),/configure_alert_webhook_url/);
  assert.throws(()=>alertConfiguration({OATHRA_ALERT_WEBHOOK_URL:url,OATHRA_ALERT_WEBHOOK_SECRET:'short'}),/configure_alert_webhook_secret/);
  assert.deepEqual(alertConfiguration({OATHRA_ALERT_WEBHOOK_URL:url,OATHRA_ALERT_WEBHOOK_SECRET:secret}),{url,secret,includeQuotes:false});
});

test('an emergency line is flagged at once, the call is not cut, and the alert carries no speech',using(async f=>{
  const m=f.mission(),{aborted,worker,saved}=await f.run(m,['A: お体の調子はいかがですか。','B: 胸が痛くて息が苦しいんです']);
  assert.equal(aborted,false,'the person is still being listened to');
  assert.equal(saved.attention.level,'emergency');assert.deepEqual(saved.attention.signals.map(s=>s.turn),['t1','t1']);
  assert.equal(f.queued().length,1);assert.equal(f.audits(),1);
  await worker.tick();
  assert.equal(f.sent.length,1);
  const {to,init}=f.sent[0],body=JSON.parse(init.body);
  assert.equal(to,url);assert.equal(init.redirect,'error');
  assert.equal(init.headers['x-oathra-signature'],alertSignature(secret,Math.floor(now/1000),init.body));
  assert.deepEqual({type:body.type,reason:body.reason,level:body.level,mission:body.mission,recipient:body.recipient,reportUrl:body.reportUrl},
    {type:'oathra.alert',reason:'distress',level:'emergency',mission:m.id,recipient:'山田',reportUrl:`https://gateway.example.org/app/#/call/${m.id}`});
  assert.equal(body.quotes,undefined);assert.ok(!init.body.includes('胸が痛'),'what was said stays in the record');
  assert.equal(f.store.get('alert',f.queued()[0].id).status,'done');
}));
test('the words are included only when the operator opted in',using(async f=>{
  const {worker}=await f.run(f.mission(),['B: 昨日転んで腰が痛いんです']);await worker.tick();
  assert.deepEqual(JSON.parse(f.sent[0].init.body).quotes,['昨日転んで腰が痛いんです']);
},{quotes:true}));
test('one alert per level: more worries do not repeat it, an emergency after a worry does alert again',using(async f=>{
  const {saved}=await f.run(f.mission(),['B: 腰が痛いんです','B: 夜も眠れなくて','B: 助けてください']);
  assert.equal(saved.attention.level,'emergency');
  assert.deepEqual(f.queued().map(j=>j.payload.level).sort(),['concern','emergency']);
}));
test('the agent’s own words and an ordinary reply raise nothing',using(async f=>{
  const {saved}=await f.run(f.mission(),['A: 痛いところはありませんか。転んだりしていませんか。','B: 元気ですよ。痛いところはないです。']);
  assert.equal(saved.attention,undefined);assert.equal(f.queued().length,0);assert.equal(f.audits(),0);
}));

test('a wellbeing call nobody answered is itself reported',using(async f=>{
  const {saved}=await f.run(f.mission({pace:'gentle'}),[],{connect:false});
  assert.equal(saved.result.checkIn.answered,false);
  assert.deepEqual(f.queued().map(j=>[j.payload.reason,j.payload.level]),[['unanswered','concern']]);
}));
test('an ordinary request nobody answered is not a care finding',using(async f=>{
  const {saved}=await f.run(f.mission(),[],{connect:false});
  assert.equal(saved.result.checkIn,undefined);assert.equal(f.queued().length,0);
}));
test('a missed medicine is recorded with the person’s words and reported once',using(async f=>{
  const {saved}=await f.run(f.mission({pace:'gentle'}),['A: お薬は飲まれましたか。','B: まだ飲んでいません。','A: 朝ご飯は召し上がりましたか。','B: はい、食べました。']);
  const item=topic=>saved.result.checkIn.items.find(i=>i.topic===topic);
  assert.deepEqual([item('medication').answer,item('medication').quote,item('meal').answer,item('sleep').answer],['no','まだ飲んでいません。','yes','not_asked']);
  assert.deepEqual(f.queued().map(j=>[j.payload.reason,j.payload.level,j.payload.categories]),[['checkin','concern',['medication']]]);
}));
test('a quiet, well check-in is recorded and alerts nobody',using(async f=>{
  const {saved}=await f.run(f.mission({pace:'gentle'}),['A: お体の調子はいかがですか。','B: 変わりないですよ。']);
  assert.equal(saved.result.checkIn.attention,'none');assert.equal(f.queued().length,0);
}));

test('without an endpoint the finding is still recorded and audited',using(async f=>{
  const {saved,worker}=await f.run(f.mission(),['B: 助けて']);await worker.tick();
  assert.equal(saved.attention.level,'emergency');assert.equal(f.audits(),1);assert.equal(f.queued().length,0);assert.equal(f.sent.length,0);
},{webhook:false}));
test('an endpoint that resolves to a private address is never called, and the alert stays queued for retry',using(async f=>{
  f.alerts.resolve=async()=>[{address:'10.0.0.5'}];
  const {worker}=await f.run(f.mission(),['B: 助けて']);const log=worker.log;worker.log=()=>{};await worker.tick();worker.log=log;
  assert.equal(f.sent.length,0);assert.equal(f.queued()[0].status,'pending');assert.equal(f.queued()[0].attempts,1);
}));

test('an alert is never given up on: after many failed deliveries it is still queued, and goes out when the endpoint is back',using(async f=>{
  let up=false;f.alerts.fetchImpl=async(to,init)=>{if(!up)throw new Error('down');f.sent.push({to,init});return {ok:true};};
  const {worker}=await f.run(f.mission(),['B: 助けて']);worker.log=()=>{};
  for(let i=0;i<12;i++){const job=f.queued()[0];f.store.put('alert',{...job,available:0});await worker.tick();}
  assert.equal(f.queued()[0].status,'pending');assert.ok(f.queued()[0].attempts>=12);assert.equal(f.sent.length,0);
  up=true;f.store.put('alert',{...f.queued()[0],available:0});await worker.tick();
  assert.equal(f.sent.length,1);assert.equal(f.queued()[0].status,'done');
}));
test('words that arrive only with the outcome are read like words that arrive line by line',using(async f=>{
  const m=f.mission(),w=new Worker(f.service,{process:async()=>{},send:async()=>{}},async(_,hooks)=>{hooks.onEvent({type:'call.connected'});return {transcript:[{id:'t0',source:'callee',text:'胸が痛いんです'}]};},f.alerts);
  await w.run(m,{id:m.id,abort:new AbortController(),control:{}});
  assert.equal(f.store.get('mission',m.id).attention.level,'emergency');assert.equal(f.queued().length,1);
}));
test('an answered call that then fails still tells the staff a call came in',using(async f=>{
  const m=f.mission({});f.store.put('mission',{...f.store.get('mission',m.id),direction:'inbound',inbound:{ownerName:'丸山商事'}});
  const w=new Worker(f.service,{process:async()=>{},send:async()=>{}},async(_,hooks)=>{hooks.onEvent({type:'call.connected'});throw new Error('boom');},f.alerts);w.log=()=>{};
  await w.run(f.store.get('mission',m.id),{id:m.id,abort:new AbortController(),control:{}});
  assert.deepEqual(f.queued().map(j=>j.payload.reason),['inbound']);
}));

test('a wellbeing report carries a note a person may pass on to a relative, in said-wording',using(async f=>{
  const {phoneRecord}=await import('../lib/phone-service.mjs');
  const {saved}=await f.run(f.mission({pace:'gentle',callerName:'ひかり苑'}),['A: お薬は飲まれましたか。','B: はい、飲みました。']);
  const note=phoneRecord(f.service,saved).familyNote;
  assert.match(note,/^山田さんへの電話（9月19日 3時ごろ）のご報告です。ひかり苑の代わりに、AIがおかけしました。/);assert.ok(note.includes('・お薬: 「はい、飲みました。」と話されました。'));
  assert.ok(note.endsWith('ご本人の様子を確かめたものではありません。'));
  const plain=await f.run(f.mission(),['B: 営業時間は10時からです']);assert.equal(phoneRecord(f.service,plain.saved).familyNote,undefined);
}));

test('the voice model’s own report alerts when the word rules heard nothing, and is kept as the AI’s account',using(async f=>{
  const m=f.mission({pace:'gentle'}),w=new Worker(f.service,{process:async()=>{},send:async()=>{}},async(_,hooks)=>{hooks.onEvent({type:'call.connected'});
    hooks.onEvent({type:'transcript.final',turnId:'t0',source:'callee',text:'ばあちゃんが風呂場で動かんごとなっとる'});
    hooks.onEvent({type:'safety.reported',level:'emergency',heard:'ばあちゃんが風呂場で動かんごとなっとる'});
    hooks.onEvent({type:'safety.reported',level:'concern',heard:'さびしか'});return {};},f.alerts);
  await w.run(m,{id:m.id,abort:new AbortController(),control:{}});
  const saved=f.store.get('mission',m.id);
  assert.equal(saved.attention.level,'emergency');assert.ok(saved.attention.signals.some(s=>s.source==='model'&&s.category==='reported'));
  assert.deepEqual(f.queued().filter(j=>j.payload.reason==='distress').map(j=>j.payload.level),['emergency'],'one alert at the level reached; a lower later report adds none');
}));
test('a recording the word rules do not know is still not an answer when the voice model says a machine answered',using(async f=>{
  const m=f.mission({pace:'gentle'}),w=new Worker(f.service,{process:async()=>{},send:async()=>{}},async(_,hooks)=>{hooks.onEvent({type:'call.connected'});
    hooks.onEvent({type:'transcript.final',turnId:'t0',source:'callee',text:'まいどおおきに、いまちょっと出とりますねん'});hooks.onEvent({type:'safety.reported',level:'machine',heard:'留守番電話'});return {};},f.alerts);
  await w.run(m,{id:m.id,abort:new AbortController(),control:{}});
  const saved=f.store.get('mission',m.id);
  assert.deepEqual([saved.answered,saved.machineAnswered],[false,true]);assert.deepEqual(f.queued().map(j=>j.payload.reason),['unanswered']);
}));

// From a real call on 2026-10-03: the callee's phone screened the call first, then the person answered and talked.
const SCREENED=['B:発信先が応答できるかどうか確認します','A:もしもし。知り合いの方の代わりにお電話しているAIなんだけど、今、少し話せる?','B:ありがとうございます。通話を切らずにこのままお待ちください',
  'B:いただきました。はい、もしもし','A:あ、もしもし。今、少し話せる?','B:はい。話せるよ','A:最近なんかハマってることある?','B:最近、AIアプリ作ってるよ'];
test('a screening assistant that hands over to the person is an answered call, not a recording',using(async f=>{
  const {saved}=await f.run(f.mission({pace:'gentle'}),SCREENED);
  assert.equal(saved.answered,true);assert.notEqual(saved.machineAnswered,true);
  assert.deepEqual(f.queued().filter(j=>j.payload.reason==='unanswered'),[]);
}));
test('a voicemail greeting with nobody after it is still not an answer',using(async f=>{
  const {saved}=await f.run(f.mission({pace:'gentle'}),['A:もしもし、お変わりないですか。','B:ただいま電話に出ることができません。発信音のあとにメッセージをどうぞ。','A:また改めておかけします。']);
  assert.equal(saved.answered,false);assert.equal(saved.machineAnswered,true);
}));
test('a chat at a gentle pace is not a wellbeing check: no check-in table and no care alert',using(async f=>{
  const {saved}=await f.run(f.mission({pace:'gentle',conversationMode:'chat'}),SCREENED);
  assert.equal(saved.result.checkIn,undefined);assert.equal(f.queued().length,0);
  const missed=await f.run(f.mission({pace:'gentle',conversationMode:'chat'}),[],{connect:false});
  assert.equal(missed.saved.result.checkIn,undefined);assert.equal(f.queued().length,0);
}));
