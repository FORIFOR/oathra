// Standing phone requests: approved once with bounds, then each occurrence goes through the ordinary checks.
// Live mode with a fake `execute` and no carrier; the worker and the clock are driven by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Worker } from '../lib/worker.mjs';
import { Alerts } from '../lib/alerts.mjs';
import { Schedules } from '../lib/schedules.mjs';
import { hash } from '../lib/security.mjs';

const start=Date.parse('2026-10-02T08:50:00+09:00'); // a Friday
const RESIDENT='+819000000011',min=60_000,hour=60*min;
const liveConfig=()=>({mode:'live',liveReady:true,users:[{id:'alice',team:'home',role:'admin',tokenHash:hash('alice')},{id:'viewer',team:'home',role:'viewer',tokenHash:hash('viewer')},{id:'carol',team:'other',role:'admin',tokenHash:hash('carol')}],
  maxSeconds:300,maxCallUsd:10,dailyCalls:0,dailyUsd:0,rateCeilingUsd:0.25,setupFeeUsd:0,consentVersion:'v1',callerId:'+815000000000',publicUrl:'https://gateway.test',missing:[]});
function fixture(){
  let clock=start,answer=true;
  const config=liveConfig(),store=new Store(':memory:',randomBytes(32).toString('hex'),()=>clock),service=new Service(store,config),alice=config.users[0];
  for(const u of [alice,config.users[2]])service.saveConsent(u,'v1');
  const contact=service.contact(alice,{name:'山田 花子',phone:RESIDENT,relationship:'customer',basis:'入居者（見守りの同意あり）'});
  // A wellbeing schedule needs somewhere to send its alerts; deliveries go to a stand-in.
  const alerts=new Alerts(service,{url:'https://alerts.example.org/hook',secret:'s'.repeat(40),includeQuotes:false},{fetchImpl:async()=>({ok:true}),resolve:async()=>[{address:'93.184.216.34'}]}),schedules=new Schedules(service,alerts),dialed=[];
  const execute=async(m,{onEvent})=>{dialed.push(m.id);if(!answer)return {};onEvent({type:'call.connected'});
    for(const [i,[source,text]] of [['caller','お体の調子はいかがですか。'],['callee',typeof answer==='string'?answer:'変わりないですよ。']].entries())onEvent({type:'transcript.final',turnId:`t${i}`,source,text});return {};};
  const worker=new Worker(service,{process:async()=>{},send:async()=>{}},execute,alerts,schedules);worker.log=()=>{};
  // One worker pass, then let the call it started run to its end.
  const pass=async()=>{await worker.tick();await worker.active?.promise;};
  const request={phone:RESIDENT,name:'山田 花子',instruction:'お変わりないか聞いてください。',pace:'gentle'};
  const create=(extra={},key='schedule-key-1')=>schedules.create(alice,{request,times:['09:00'],until:new Date(start+30*86400_000).toISOString(),acknowledged:true,...extra},key);
  const runs=()=>store.all('schedule-run',alice.id).sort((a,b)=>a.id<b.id?-1:1);
  const alertsRaised=()=>store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='call.alert'").get().n;
  return {config,store,service,alice,contact,schedules,worker,dialed,pass,create,runs,request,alertsRaised,
    at(ms){clock=ms;},advance(ms){clock+=ms;},answers(value){answer=value;},close(){store.close();}};
}
const using=fn=>async()=>{const f=fixture();try{await fn(f);}finally{f.close();}};
const code=fn=>{try{fn();return null;}catch(e){return e.code??e.name;}};

test('a schedule needs an explicit approval, a saved contact, an end date, and cannot book',using(f=>{
  assert.equal(code(()=>f.create({acknowledged:false})),'explicit_schedule_approval_required');
  assert.equal(code(()=>f.create({request:{...f.request,phone:'+819000000099'}})),'schedule_recipient_must_be_contact');
  assert.equal(code(()=>f.create({request:{...f.request,task:'reservation'}})),'schedule_cannot_reserve');
  assert.equal(code(()=>f.create({until:new Date(start+120*86400_000).toISOString()})),'schedule_end_required_within_92_days');
  assert.equal(code(()=>f.create({until:'2026-10-20T09:00:00'})),'schedule_end_required_within_92_days');
  for(const times of [[],['9:00'],['09:00','09:00'],['25:00'],['09:00','10:00','11:00','12:00','13:00']])assert.equal(code(()=>f.create({times})),'invalid_schedule_times',JSON.stringify(times));
  assert.equal(code(()=>f.create({weekdays:[7]})),'invalid_schedule_weekdays');
  assert.equal(code(()=>f.create({retries:{count:4,minutes:30}})),'invalid_schedule_retries');
  assert.equal(code(()=>f.create({extra:true})),'invalid_schedule');
  assert.equal(code(()=>f.schedules.create(f.config.users[1],{request:f.request,times:['09:00'],until:new Date(start+86400_000).toISOString(),acknowledged:true},'viewer-key-1')),'read_only_account');
  f.store.put('contact',{...f.contact,basis:''});assert.equal(code(()=>f.create()),'schedule_contact_basis_required');f.store.put('contact',f.contact);
  f.store.suppress('home',RESIDENT,'transcript');assert.equal(code(()=>f.create()),'recipient_suppressed');
  assert.equal(f.store.list('schedule').length,0);
}));
test('the same key returns the same schedule; a changed request under that key is a conflict; the bound is stated',using(f=>{
  const a=f.create({retries:{count:2,minutes:30}}),b=f.create({retries:{count:2,minutes:30}});
  assert.equal(a.id,b.id);assert.equal(f.store.list('schedule').length,1);
  assert.equal(code(()=>f.create({times:['10:00']})),'idempotency_conflict');
  assert.equal(a.bounds.callsUpperBound,30*1*3);assert.equal(a.fingerprint,undefined);
  // Only the chosen weekdays are counted: Fridays from 2 Oct to 31 Oct 2026 are five.
  assert.deepEqual(f.create({weekdays:[5],retries:{count:1,minutes:30}},'weekday-key-1').bounds,{days:5,occurrences:5,callsUpperBound:10});
}));

test('nothing is dialled before the time; at the time one call goes through the ordinary path and is recorded',using(async f=>{
  const s=f.create();await f.pass();assert.equal(f.dialed.length,0);assert.equal(f.runs().length,0);
  f.at(start+10*min);await f.pass();
  assert.equal(f.dialed.length,1);
  const m=f.store.get('mission',f.dialed[0]);
  assert.deepEqual([m.kind,m.target.phone,m.phoneRequest.pace,m.schedule.id,m.schedule.attempt,m.schedule.final,m.answered],['phone-request',RESIDENT,'gentle',s.id,0,true,true]);
  assert.ok(m.approvedAt,'approved through the ordinary start');assert.ok(f.store.get('reservation',m.id),'counted against the daily limits like any call');
  await f.pass();assert.deepEqual(f.runs().map(r=>[r.date,r.time,r.state,r.attempts.length]),[['2026-10-02','09:00','ANSWERED',1]]);
  for(let i=0;i<5;i++){f.advance(20*min);await f.pass();}
  assert.equal(f.dialed.length,1,'one call per occurrence');
  f.at(start+10*min+86400_000);await f.pass();assert.equal(f.dialed.length,2,'the next day it calls again');
}));
test('an unanswered call is retried after the wait, up to the limit, and only the last attempt alerts',using(async f=>{
  f.create({retries:{count:2,minutes:30}});f.answers(false);
  f.at(start+10*min);await f.pass();await f.pass();assert.equal(f.dialed.length,1);assert.equal(f.alertsRaised(),0);
  f.advance(29*min);await f.pass();assert.equal(f.dialed.length,1,'not before the wait is over');
  f.advance(2*min);await f.pass();assert.equal(f.dialed.length,2);assert.equal(f.alertsRaised(),0);
  f.advance(31*min);await f.pass();assert.equal(f.dialed.length,3);
  assert.equal(f.store.get('mission',f.dialed[2]).schedule.final,true);assert.equal(f.alertsRaised(),1,'the finding is the last unanswered attempt');
  f.advance(31*min);await f.pass();await f.pass();assert.equal(f.dialed.length,3);
  assert.deepEqual(f.runs().map(r=>[r.state,r.attempts.length]),[['UNANSWERED',3]]);
}));
test('a retry that is answered settles the occurrence without an alert',using(async f=>{
  f.create({retries:{count:1,minutes:10}});f.answers(false);f.at(start+10*min);await f.pass();
  f.answers(true);f.advance(11*min);await f.pass();await f.pass();
  assert.deepEqual(f.runs().map(r=>[r.state,r.attempts.length]),[['ANSWERED',2]]);assert.equal(f.alertsRaised(),0);
}));
test('calls leave one at a time: a second schedule waits while the line is in use',using(async f=>{
  const other=f.service.contact(f.alice,{name:'佐藤 一郎',phone:'+819000000012',relationship:'customer',basis:'入居者（見守りの同意あり）'});
  f.create();f.schedules.create(f.alice,{request:{...f.request,phone:other.phone,name:other.name},times:['09:00'],until:new Date(start+30*86400_000).toISOString(),acknowledged:true},'schedule-key-2');
  f.at(start+10*min);f.schedules.tick();
  assert.equal(f.store.list('mission',undefined,'QUEUED').length,1);
  f.schedules.tick();assert.equal(f.store.list('mission',undefined,'QUEUED').length,1,'the queue is not stuffed past the five-minute approval window');
  await f.pass();await f.pass();assert.equal(f.dialed.length,2);
}));
test('a time that passed while nothing could be dialled is skipped and reported, never made up late',using(async f=>{
  f.create({windowMinutes:60});f.at(start+10*min+61*min);await f.pass();
  assert.equal(f.dialed.length,0);assert.deepEqual(f.runs().map(r=>[r.state,r.reason]),[['SKIPPED','window_passed']]);assert.equal(f.alertsRaised(),1);
  await f.pass();assert.equal(f.alertsRaised(),1);
}));
test('a schedule made after today’s time starts tomorrow; a day off the list is skipped silently',using(async f=>{
  f.at(start+2*hour);f.create({weekdays:[5,6]},'made-late-key');await f.pass();assert.equal(f.dialed.length,0);assert.equal(f.runs().length,0);
  f.at(start+10*min+86400_000);await f.pass();assert.equal(f.dialed.length,1,'Saturday');
  f.at(start+10*min+2*86400_000);await f.pass();assert.equal(f.dialed.length,1,'Sunday is not on the list');assert.equal(f.alertsRaised(),0);
}));

test('a person who asks not to be called ends the schedule for good',using(async f=>{
  const s=f.create({retries:{count:2,minutes:10}});f.answers('もう電話しないでください。');f.at(start+10*min);await f.pass();await f.pass();
  assert.equal(f.store.suppressed('home',RESIDENT),true);
  assert.deepEqual([f.store.get('schedule',s.id).status,f.store.get('schedule',s.id).endedReason],['ENDED','recipient_asked_not_to_be_called']);
  f.advance(86400_000);await f.pass();assert.equal(f.dialed.length,1);
  assert.equal(code(()=>f.schedules.set(f.alice,s.id,'ACTIVE')),'schedule_ended');
}));
test('a call whose state is unknown is never redialled',using(async f=>{
  f.create({retries:{count:2,minutes:10}});f.at(start+10*min);f.schedules.tick();
  const m=f.store.list('mission',undefined,'QUEUED')[0];f.store.put('mission',{...m,status:'UNKNOWN',finishedAt:start+11*min});
  f.advance(30*min);await f.pass();await f.pass();
  assert.equal(f.dialed.length,0);assert.deepEqual(f.runs().map(r=>[r.state,r.reason]),[['FAILED','unknown_state_needs_reconciliation']]);assert.equal(f.alertsRaised(),1);
}));
test('paused schedules do nothing; resuming and ending are the owner’s alone; the end date ends it',using(async f=>{
  const s=f.create();
  assert.equal(code(()=>f.schedules.set(f.config.users[2],s.id,'PAUSED')),'not_found');
  assert.equal(code(()=>f.schedules.set(f.config.users[1],s.id,'PAUSED')),'read_only_account');
  f.schedules.set(f.alice,s.id,'PAUSED');f.at(start+10*min);await f.pass();assert.equal(f.dialed.length,0);
  f.schedules.set(f.alice,s.id,'ACTIVE');await f.pass();assert.equal(f.dialed.length,1);
  f.at(start+31*86400_000);await f.pass();assert.equal(f.store.get('schedule',s.id).status,'ENDED');assert.equal(f.dialed.length,1);
  assert.equal(f.schedules.list(f.alice)[0].runs.length,1);assert.deepEqual(f.schedules.list(f.config.users[2]),[]);
}));
test('when the contact’s number changed or consent was withdrawn, the schedule stops instead of calling',using(async f=>{
  const s=f.create();f.store.put('contact',{...f.contact,phone:'+819000000077'});f.at(start+10*min);await f.pass();
  assert.equal(f.dialed.length,0);assert.equal(f.store.get('schedule',s.id).status,'ENDED');assert.equal(f.store.list('mission').length,0,'no draft is left behind');assert.equal(f.alertsRaised(),1);
}));

test('before a restart no new call is taken, the call in progress is allowed to finish, and approvals are refused',using(async f=>{
  f.create();f.at(start+10*min);
  let release;const held=new Promise(r=>{release=r;});const inner=f.worker.execute;
  f.worker.execute=async(m,hooks)=>{await held;return inner(m,hooks);};
  await f.worker.tick();assert.ok(f.worker.active,'a call is in progress');
  const draining=f.worker.drain(5_000);
  assert.equal(f.config.draining,true);
  assert.equal(code(()=>f.service.startTx(f.alice,'x'.repeat(40),'drain-key-1',true)),'service_restarting_try_again_shortly');
  release();const result=await draining;
  assert.deepEqual(result,{cut:false});assert.equal(f.dialed.length,1);assert.equal(f.store.get('mission',f.dialed[0]).answered,true,'it ended on its own, not by the restart');
  f.advance(86400_000);await f.worker.tick();assert.equal(f.dialed.length,1,'a draining worker starts nothing');
}));
test('a call that outlasts the grace period is cut and reported as cut',using(async f=>{
  f.create();f.at(start+10*min);
  f.worker.execute=(m,hooks)=>new Promise(resolve=>hooks.signal.addEventListener('abort',()=>resolve({})));
  await f.worker.tick();
  assert.deepEqual(await f.worker.drain(20),{cut:true});
}));

test('a voicemail greeting is not an answer: the call is retried and then reported as unanswered',using(async f=>{
  f.create({retries:{count:1,minutes:10}});f.answers('ただいま電話に出ることができません。発信音のあとにメッセージをどうぞ。');
  f.at(start+10*min);await f.pass();await f.pass();
  const first=f.store.get('mission',f.dialed[0]);assert.deepEqual([first.answered,first.machineAnswered],[false,true]);assert.equal(f.alertsRaised(),0);
  f.advance(11*min);await f.pass();await f.pass();
  assert.equal(f.dialed.length,2);assert.deepEqual(f.runs().map(r=>[r.state,r.attempts.length]),[['UNANSWERED',2]]);assert.equal(f.alertsRaised(),1);
}));

test('a wellbeing schedule needs somewhere to send its alerts, and nobody is scheduled at night',using(f=>{
  const quiet=new Schedules(f.service,new Alerts(f.service,null));
  const input={request:f.request,times:['09:00'],until:new Date(start+30*86400_000).toISOString(),acknowledged:true};
  assert.equal(code(()=>quiet.create(f.alice,input,'no-webhook-1')),'care_schedule_requires_alert_webhook');
  assert.ok(quiet.create(f.alice,{...input,request:{...f.request,pace:undefined}},'no-webhook-2').id,'an ordinary standing request does not need one');
  for(const time of ['06:59','21:00','02:00'])assert.equal(code(()=>f.create({times:[time]},'night-'+time.replace(':','-')+'-key')),'schedule_time_outside_calling_hours',time);
  f.config.callHours={sales:null,request:{from:'10:00',to:'12:00'}};
  assert.equal(code(()=>f.create({times:['09:00']},'hours-key-01')),'schedule_time_outside_calling_hours');assert.ok(f.create({times:['11:30']},'hours-key-02').id);
}));
test('a call refused before it was dialled is still reported: the last word on the occurrence alerts',using(async f=>{
  f.create();f.at(start+10*min);f.schedules.tick();
  // The approval expires in the queue (a restart, a long call ahead of it): the worker refuses it without dialling.
  f.advance(6*min);await f.pass();await f.pass();
  assert.equal(f.dialed.length,0);assert.deepEqual(f.runs().map(r=>[r.state,r.reason]),[['UNANSWERED','queued_approval_expired']]);assert.equal(f.alertsRaised(),1);
  await f.pass();assert.equal(f.alertsRaised(),1);
}));
test('retries that run out of day end the occurrence with an alert, not silently',using(async f=>{
  f.create({times:['20:30'],retries:{count:2,minutes:180},windowMinutes:60});f.answers(false);
  f.at(Date.parse('2026-10-02T20:31:00+09:00'));await f.pass();await f.pass();assert.equal(f.dialed.length,1);assert.equal(f.alertsRaised(),0);
  f.at(Date.parse('2026-10-03T00:05:00+09:00'));await f.pass();
  assert.equal(f.dialed.length,1);assert.deepEqual(f.runs().map(r=>r.state),['UNANSWERED']);assert.equal(f.alertsRaised(),1);
}));
test('a call already placed is settled even after its schedule was paused; the person who stops the calls is reported',using(async f=>{
  const s=f.create({retries:{count:1,minutes:10}});f.answers(false);f.at(start+10*min);await f.pass();
  f.schedules.set(f.alice,s.id,'PAUSED');f.advance(11*min);await f.pass();
  assert.deepEqual(f.runs().map(r=>r.state),['UNANSWERED']);assert.equal(f.dialed.length,1);assert.equal(f.alertsRaised(),1);
}));
test('when the person asks not to be called, whoever set the schedule up is told that it has stopped',using(async f=>{
  f.create();f.answers('もう電話しないでください。');f.at(start+10*min);await f.pass();await f.pass();
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='call.alert'").get().n,1);
  assert.deepEqual(f.runs().map(r=>[r.state,r.reason]),[['DECLINED','recipient_asked_not_to_be_called']]);
}));
test('a schedule keeps working when the person has more than a thousand contacts',using(async f=>{
  f.create();
  const insert=f.store.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)');
  f.store.tx(()=>{for(let i=0;i<1100;i++)insert.run('contact','bulk-'+i,f.alice.id,'',f.store.seal({id:'bulk-'+i,owner:f.alice.id,name:'x',phone:''}),start+1+i);});
  f.at(start+10*min);await f.pass();
  assert.equal(f.dialed.length,1);assert.equal(f.store.list('schedule')[0].status,'ACTIVE');
}));

test('days the service was not running are written down as skipped and reported, never silently missing',using(async f=>{
  f.create({times:['09:00','18:00']});f.at(start+10*min);await f.pass();await f.pass();assert.equal(f.dialed.length,1);
  // Friday 09:00 was called. The service is then down until Monday 08:00: Friday 18:00, Saturday and Sunday come and go.
  f.at(Date.parse('2026-10-05T08:00:00+09:00'));await f.pass();
  assert.deepEqual(f.runs().map(r=>[r.date,r.time,r.state,r.reason??null]),[
    ['2026-10-02','09:00','ANSWERED',null],['2026-10-02','18:00','SKIPPED','service_was_not_running'],
    ['2026-10-03','09:00','SKIPPED','service_was_not_running'],['2026-10-03','18:00','SKIPPED','service_was_not_running'],
    ['2026-10-04','09:00','SKIPPED','service_was_not_running'],['2026-10-04','18:00','SKIPPED','service_was_not_running']]);
  assert.equal(f.alertsRaised(),5);assert.equal(f.dialed.length,1,'nothing is made up late');
  await f.pass();assert.equal(f.runs().length,6);assert.equal(f.alertsRaised(),5,'written once');
  f.at(Date.parse('2026-10-05T09:01:00+09:00'));await f.pass();assert.equal(f.dialed.length,2,'and today goes ahead');
}));
test('a paused schedule owes nothing for the days it was paused',using(async f=>{
  const s=f.create();f.schedules.set(f.alice,s.id,'PAUSED');f.at(start+3*86400_000);f.schedules.set(f.alice,s.id,'ACTIVE');await f.pass();
  assert.deepEqual(f.runs().filter(r=>r.reason==='service_was_not_running').length,0);
}));
