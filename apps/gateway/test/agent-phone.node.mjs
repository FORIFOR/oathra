// Delegated phone actions for external agents: real Store/Service, live mode with a fake `execute` and no carrier.
// Nothing here dials: the worker is driven by hand and the only network is the fixture server on 127.0.0.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Worker } from '../lib/worker.mjs';
import { hash } from '../lib/security.mjs';
import { grantPhone, phoneGrantDefaults, connectPhoneAgent, agentPhoneConnection, revokePhoneGrant, dispatchPhone, readAgentPhone, cancelAgentPhone, checkPhoneDelegation } from '../lib/agent-phone.mjs';
import { readConnectionFile } from '../../../sdk/gateway-client/connection-file.mjs';
import { createGateway } from '../server.mjs';

const now=Date.parse('2026-10-02T03:00:00Z');
const P1='+819000000001',P2='+819000000002',P3='+819000000003',P4='+819000000004';
const tokens={alice:'alice-token',bob:'bob-token',viewer:'viewer-token',agent:'agent-token',agentB:'agent-b-token',carol:'carol-token',outsider:'outsider-token'};
const users=()=>[
  {id:'alice',team:'one',role:'admin'},{id:'bob',team:'one',role:'operator'},{id:'viewer',team:'one',role:'viewer'},
  {id:'agent',team:'one',role:'agent'},{id:'agentB',team:'one',role:'agent'},
  {id:'carol',team:'two',role:'admin'},{id:'outsider',team:'two',role:'agent'},
].map(u=>({...u,tokenHash:hash(tokens[u.id])}));
// rateCeilingUsd 0.25 keeps the estimate exact: ceil((300+30)/60)=6 started minutes * 0.25 * 2 = 3 USD per call.
const liveConfig=(overrides={})=>({mode:'live',liveReady:true,users:users(),maxSeconds:300,maxCallUsd:10,dailyCalls:0,dailyUsd:0,rateCeilingUsd:0.25,setupFeeUsd:0,
  consentVersion:'v1',callerId:'+815000000000',publicUrl:'https://gateway.test',missing:[],...overrides});

function fixture({path=':memory:',key=randomBytes(32).toString('hex'),config=liveConfig(),seed=true}={}){
  let clock=now;
  const store=new Store(path,key,()=>clock),service=new Service(store,config),by=id=>config.users.find(u=>u.id===id);
  const alice=by('alice'),agent=by('agent');
  if(seed)for(const id of ['alice','carol']){service.saveConsent(by(id),'v1');store.put('account',{...service.account(by(id)),verifiedPhone:P1,phoneVerificationProvider:'twilio-verify'});}
  const dialed=[];
  const execute=async(m,{onEvent})=>{dialed.push(m.id);onEvent({type:'call.connected'});return {transcript:[{id:'t1',source:'callee',text:'営業時間は10時から19時です。'}]};};
  const worker=new Worker(service,{process:async()=>{},send:async()=>{}},execute);
  const grant=(input={})=>grantPhone(service,alice,{agentId:'agent',acknowledged:true,phones:[P1,P2,P3,P4],expiresAt:new Date(clock+3600_000).toISOString(),...input});
  return {config,store,service,key,by,alice,agent,worker,dialed,grant,advance(ms){clock+=ms;},missions:()=>store.list('mission'),close(){store.close();}};
}
const using=(fn,options)=>async()=>{const f=fixture(options);try{await fn(f);}finally{f.close();}};
const request=(phone=P1,extra={})=>({phone,name:'テスト店',instruction:'営業時間を確認する。',...extra});
const reservation=(extra={})=>request(P1,{task:'reservation',callerName:'堀尾',success:{required:['date','time','partySize','confirmed'],expected:{date:'2026-10-10',time:'19:00',partySize:2}},...extra});
/** The coded refusal of a call, or null when it went through. */
const refusal=fn=>{try{fn();return null;}catch(e){return {code:e.code??e.name,status:e.status};}};
const code=fn=>refusal(fn)?.code??null;
let serial=0;const opKey=()=>'operation-'+String(++serial).padStart(4,'0');

// ---------------------------------------------------------------------------------------------- grants

test('grant defaults are the server-owned trial: 10 calls, 5 minutes, 24 hours, the verified number only',using(f=>{
  const d=phoneGrantDefaults(f.service,f.alice);
  assert.deepEqual(d.defaults,{phones:[P1],maxCalls:10,maxSeconds:300,maxCallUsd:3,maxTotalUsd:30,expiresAt:new Date(now+24*3600_000).toISOString(),allowReservation:false});
  assert.equal(d.ready,true);assert.equal(d.needsRecipient,false);assert.equal(d.needsConsent,false);assert.equal(d.budgetBasis,'configured_cost_ceiling');
  // A recipient is never inferred: an operator without a carrier-verified number gets no phone and is not ready.
  const bob=phoneGrantDefaults(f.service,f.by('bob'));
  assert.deepEqual(bob.defaults.phones,[]);assert.equal(bob.needsRecipient,true);assert.equal(bob.needsConsent,true);assert.equal(bob.ready,false);
  f.store.put('account',{...f.service.account(f.alice),phoneVerificationProvider:'simulator'});
  assert.deepEqual(phoneGrantDefaults(f.service,f.alice).defaults.phones,[]);
  // Only an operator sees them.
  for(const id of ['viewer','agent'])assert.equal(code(()=>phoneGrantDefaults(f.service,f.by(id))),'read_only_account');
}));

test('grant defaults follow a shorter server limit and report when the trial does not fit the server budget',()=>{
  const short=fixture({config:liveConfig({maxSeconds:120})});
  try{const d=phoneGrantDefaults(short.service,short.alice).defaults;assert.equal(d.maxSeconds,120);assert.equal(d.maxCallUsd,1.5);assert.equal(d.maxTotalUsd,15);}finally{short.close();}
  const tight=fixture({config:liveConfig({maxCallUsd:2.99})});
  try{const d=phoneGrantDefaults(tight.service,tight.alice);assert.equal(d.budgetFitsServer,false);assert.equal(d.ready,false);}finally{tight.close();}
  const sim=fixture({config:liveConfig({mode:'simulator',liveReady:false})});
  try{const d=phoneGrantDefaults(sim.service,sim.alice);assert.equal(d.liveReady,false);assert.equal(d.ready,false);}finally{sim.close();}
});

test('a grant without numbers takes the server defaults and needs an explicit acknowledgement',using(f=>{
  assert.deepEqual(refusal(()=>grantPhone(f.service,f.alice,{agentId:'agent'})),{code:'explicit_delegation_approval_required',status:403});
  assert.equal(code(()=>grantPhone(f.service,f.alice,{agentId:'agent',acknowledged:'true'})),'explicit_delegation_approval_required');
  assert.equal(f.store.all('phone-grant','alice').length,0);
  const g=grantPhone(f.service,f.alice,{agentId:'agent',acknowledged:true});
  assert.deepEqual({phones:g.phones,maxCalls:g.maxCalls,maxSeconds:g.maxSeconds,maxCallUsd:g.maxCallUsd,maxTotalUsd:g.maxTotalUsd,allowReservation:g.allowReservation,status:g.status},
    {phones:[P1],maxCalls:10,maxSeconds:300,maxCallUsd:3,maxTotalUsd:30,allowReservation:false,status:'ACTIVE'});
  assert.equal(g.expiresAt,now+24*3600_000);assert.equal(g.owner,'alice');assert.equal(g.team,'one');assert.equal(g.agentId,'agent');
  assert.ok(f.store.audits().some(a=>a.action==='agent_phone.granted'&&a.detail.agent==='agent'));
}));

test('a client cannot raise a grant above the server ceilings or smuggle server-owned fields',using(f=>{
  const refused=(input,expected)=>assert.equal(code(()=>f.grant(input)),expected,JSON.stringify(input));
  refused({maxSeconds:301},'invalid_grant_duration');refused({maxSeconds:29},'invalid_grant_duration');refused({maxSeconds:60.5},'invalid_grant_duration');
  refused({maxCallUsd:10.01},'invalid_grant_call_budget');refused({maxCallUsd:0},'invalid_grant_call_budget');refused({maxCallUsd:Infinity},'invalid_grant_call_budget');
  refused({maxCalls:101},'invalid_grant_call_limit');refused({maxCalls:0},'invalid_grant_call_limit');refused({maxCalls:1.5},'invalid_grant_call_limit');
  refused({maxTotalUsd:1000.01},'invalid_grant_total_budget');refused({maxCallUsd:3,maxTotalUsd:2.99},'invalid_grant_total_budget');
  refused({expiresAt:new Date(now+30*86400_000+1000).toISOString()},'grant_expiry_required_within_30_days');
  refused({expiresAt:new Date(now-1000).toISOString()},'grant_expiry_required_within_30_days');
  refused({expiresAt:'2026-10-02T13:00:00'},'grant_expiry_required_within_30_days'); // no zone: not an instant
  refused({expiresAt:now+3600_000},'grant_expiry_required_within_30_days');
  refused({phones:[]},'explicit_recipients_required');refused({phones:Array.from({length:101},(_,i)=>'+8190'+String(10000000+i))},'explicit_recipients_required');
  refused({phones:['not a number']},'invalid_grant_phone');refused({allowReservation:'yes'},'invalid_reservation_permission');
  for(const field of ['owner','team','status','id','consentVersion','createdAt','budgetBasis'])refused({[field]:'x'},'invalid_agent_phone_request');
  assert.equal(f.store.all('phone-grant','alice').length,0);
  // The exact ceilings themselves are accepted, and duplicate recipients collapse to one.
  const g=f.grant({maxSeconds:300,maxCallUsd:10,maxCalls:100,maxTotalUsd:1000,expiresAt:new Date(now+30*86400_000).toISOString(),phones:[P1,'090-0000-0001']});
  assert.deepEqual(g.phones,[P1]);assert.equal(g.maxCalls,100);
}));

test('a grant is bound to its owner and team',using(f=>{
  // The agent must be an agent identity of the owner's own team.
  assert.deepEqual(refusal(()=>f.grant({agentId:'outsider'})),{code:'agent_must_belong_to_owner_team',status:403});
  assert.equal(code(()=>f.grant({agentId:'bob'})),'agent_must_belong_to_owner_team');
  assert.equal(code(()=>f.grant({agentId:'nobody'})),'unlinked_account');
  // Only an operator grants, and only after consenting to the current policy.
  for(const id of ['viewer','agent'])assert.deepEqual(refusal(()=>grantPhone(f.service,f.by(id),{agentId:'agent',acknowledged:true,phones:[P1]})),{code:'read_only_account',status:403});
  assert.equal(code(()=>grantPhone(f.service,f.by('bob'),{agentId:'agent',acknowledged:true,phones:[P1]})),'privacy_consent_required');
  const g=f.grant();
  // Another agent of the same team, an agent of another team and the operator themselves cannot use it.
  for(const id of ['agentB','outsider'])assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.by(id),{grantId:g.id,request:request()},opKey())),{code:'phone_grant_not_found',status:404});
  assert.equal(code(()=>agentPhoneConnection(f.service,f.by('agentB'),g.id)),'phone_grant_not_found');
  // Another operator of the same team, or of another team, cannot revoke it.
  for(const id of ['bob','carol'])assert.deepEqual(refusal(()=>revokePhoneGrant(f.service,f.by(id),g.id)),{code:'not_found',status:404});
  assert.equal(code(()=>revokePhoneGrant(f.service,f.agent,g.id)),'read_only_account');
  assert.equal(f.store.get('phone-grant',g.id).status,'ACTIVE');
  // A grant whose team no longer matches its agent is not found, even with the right agent id.
  f.store.put('phone-grant',{...g,team:'two'});
  assert.equal(code(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},opKey())),'phone_grant_not_found');
  assert.equal(f.missions().length,0);
}));

test('a revoked or expired grant refuses dispatch and reports that it must be renewed',using(f=>{
  const g=f.grant(),other=f.grant();
  assert.equal(agentPhoneConnection(f.service,f.agent,g.id).ready,true);assert.equal(agentPhoneConnection(f.service,f.agent,g.id).nextAction,'submit_phone_request');
  assert.equal(revokePhoneGrant(f.service,f.alice,g.id).status,'REVOKED');
  assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},opKey())),{code:'phone_grant_expired_or_revoked',status:403});
  const c=agentPhoneConnection(f.service,f.agent,g.id);assert.equal(c.ready,false);assert.equal(c.nextAction,'renew_with_operator');
  // Expiry is exclusive: at the instant of expiry the grant is already dead.
  f.advance(3600_000-1);
  assert.equal(agentPhoneConnection(f.service,f.agent,other.id).ready,true);
  f.advance(1);
  assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.agent,{grantId:other.id,request:request()},opKey())),{code:'phone_grant_expired_or_revoked',status:403});
  assert.equal(agentPhoneConnection(f.service,f.agent,other.id).nextAction,'renew_with_operator');
  assert.equal(f.missions().length,0);
}));

test('a grant stops working when the owner withdraws consent or the policy version moves',using(f=>{
  const g=f.grant();
  f.store.put('account',{...f.service.account(f.alice),consentVersion:'v0'});
  assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},opKey())),{code:'phone_grant_scope_changed',status:403});
  f.store.put('account',{...f.service.account(f.alice),consentVersion:'v1'});
  f.config.consentVersion='v2';
  assert.equal(code(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},opKey())),'phone_grant_scope_changed');
  assert.equal(f.missions().length,0);
}));

// -------------------------------------------------------------------------------------------- dispatch

test('dispatch queues one call inside the grant and never dials by itself',using(f=>{
  const g=f.grant(),key=opKey(),r=dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},key);
  assert.equal(r.state,'QUEUED');assert.equal(r.terminal,false);assert.equal(r.outcome,'pending');assert.equal(r.nextAction,'check_status');
  const m=f.store.get('mission',r.missionId);
  assert.equal(m.owner,'alice');assert.deepEqual(m.delegation,{agentId:'agent',grantId:g.id});assert.equal(m.maxSeconds,300);assert.equal(m.maxUsd,3);assert.equal(m.target.phone,P1);
  assert.deepEqual(f.dialed,[]);
  assert.ok(f.store.audits().some(a=>a.action==='agent_phone.dispatched'&&a.detail.mission===m.id));
  assert.deepEqual(readAgentPhone(f.service,f.agent,key),r);
  const c=agentPhoneConnection(f.service,f.agent,g.id);assert.equal(c.remainingCalls,9);assert.equal(c.remainingUsd,27);
}));

test('a recipient outside the grant is refused, however the number is written',using(f=>{
  const g=f.grant({phones:[P1]});
  assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(P2)},opKey())),{code:'recipient_not_delegated',status:403});
  assert.equal(f.missions().length,0);
  // The same delegated number in national notation is the delegated number.
  assert.equal(dispatchPhone(f.service,f.agent,{grantId:g.id,request:request('090-0000-0001')},opKey()).state,'QUEUED');
  // The request cannot carry its own grant, duration or budget.
  assert.equal(code(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(),maxSeconds:600},opKey())),'invalid_agent_phone_request');
  for(const extra of [{maxSeconds:600},{maxUsd:99},{grantId:g.id}])assert.equal(code(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(P1,extra)},opKey())),'ZodError');
}));

test('maxCalls is exact: the last allowed call goes through and the next one is refused',using(f=>{
  const g=f.grant({maxCalls:2});
  assert.equal(dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(P1)},opKey()).state,'QUEUED');
  assert.equal(agentPhoneConnection(f.service,f.agent,g.id).remainingCalls,1);
  assert.equal(dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(P2)},opKey()).state,'QUEUED');
  const c=agentPhoneConnection(f.service,f.agent,g.id);assert.equal(c.remainingCalls,0);assert.equal(c.ready,false);assert.equal(c.nextAction,'trial_exhausted_request_new_grant');
  assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(P3)},opKey())),{code:'phone_grant_call_limit',status:429});
  assert.equal(f.missions().length,2);
  // A cancelled call was still an attempt: cancelling does not hand the allowance back.
  const first=f.store.all('phone-dispatch','agent')[0];f.service.cancel(f.alice,first.missionId);
  assert.equal(code(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(P3)},opKey())),'phone_grant_call_limit');
  // Another grant of the same agent has its own count.
  const second=f.grant({maxCalls:1});
  assert.equal(dispatchPhone(f.service,f.agent,{grantId:second.id,request:request(P3)},opKey()).state,'QUEUED');
}));

test('the per-call USD limit is exact: the estimate may equal the limit, one cent less refuses',using(f=>{
  // 300 s: 6 started minutes * 0.25 * 2 = 3.00 USD.
  const exact=f.grant({maxCallUsd:3,maxTotalUsd:30});
  assert.equal(dispatchPhone(f.service,f.agent,{grantId:exact.id,request:request(P1)},opKey()).state,'QUEUED');
  const under=f.grant({maxCallUsd:2.99,maxTotalUsd:30});
  assert.equal(code(()=>dispatchPhone(f.service,f.agent,{grantId:under.id,request:request(P2)},opKey())),'estimated_cost_exceeds_budget');
  // 90 s: 2 started minutes * 0.25 * 2 = 1.00 USD.
  const short=f.grant({maxSeconds:90,maxCallUsd:1,maxTotalUsd:10});
  const r=dispatchPhone(f.service,f.agent,{grantId:short.id,request:request(P2)},opKey());
  assert.equal(f.store.get('mission',r.missionId).maxSeconds,90);assert.equal(f.store.get('mission',r.missionId).estimatedMaximumUsd,1);
  const shortUnder=f.grant({maxSeconds:90,maxCallUsd:0.99,maxTotalUsd:10});
  assert.equal(code(()=>dispatchPhone(f.service,f.agent,{grantId:shortUnder.id,request:request(P3)},opKey())),'estimated_cost_exceeds_budget');
  assert.equal(f.missions().length,2);
}));

test('the total budget is exact: calls reserve their per-call limit until the next one would pass the total',using(f=>{
  const g=f.grant({maxCallUsd:3,maxTotalUsd:8.99});
  assert.equal(dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(P1)},opKey()).state,'QUEUED');
  assert.equal(dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(P2)},opKey()).state,'QUEUED');
  const c=agentPhoneConnection(f.service,f.agent,g.id);assert.equal(c.remainingCalls,8);assert.ok(Math.abs(c.remainingUsd-2.99)<1e-9);assert.equal(c.ready,false);assert.equal(c.nextAction,'trial_exhausted_request_new_grant');
  assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(P3)},opKey())),{code:'phone_grant_budget_exceeded',status:429});
  assert.equal(f.missions().length,2);
  const nine=f.grant({maxCallUsd:3,maxTotalUsd:9,phones:['+819000000011','+819000000012','+819000000013','+819000000014']});
  for(const n of [11,12,13])assert.equal(dispatchPhone(f.service,f.agent,{grantId:nine.id,request:request('+8190000000'+n)},opKey()).state,'QUEUED');
  assert.equal(agentPhoneConnection(f.service,f.agent,nine.id).remainingUsd,0);
  assert.equal(code(()=>dispatchPhone(f.service,f.agent,{grantId:nine.id,request:request('+819000000014')},opKey())),'phone_grant_budget_exceeded');
}));

test('a call never runs longer than the grant: the grant sets maxSeconds and a longer mission is out of scope',using(f=>{
  const g=f.grant({maxSeconds:90,maxCallUsd:1,maxTotalUsd:10});
  const r=dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},opKey()),m=f.store.get('mission',r.missionId);
  assert.equal(m.maxSeconds,90); // not the server's 300
  assert.equal(code(()=>checkPhoneDelegation(f.service,m)),null);
  assert.deepEqual(refusal(()=>checkPhoneDelegation(f.service,{...m,maxSeconds:91})),{code:'phone_grant_scope_changed',status:403});
  assert.equal(code(()=>checkPhoneDelegation(f.service,{...m,maxUsd:1.01})),'phone_grant_scope_changed');
  assert.equal(code(()=>checkPhoneDelegation(f.service,{...m,owner:'bob'})),'phone_grant_scope_changed');
  // A mission that was not delegated is not this module's business.
  assert.equal(code(()=>checkPhoneDelegation(f.service,{...m,delegation:undefined,maxSeconds:9999})),null);
}));

test('reservations need allowReservation on the grant and exact conditions on the request',using(f=>{
  const plain=f.grant();
  assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.agent,{grantId:plain.id,request:reservation()},opKey())),{code:'reservation_not_delegated',status:403});
  const g=f.grant({allowReservation:true});
  const missing=[{callerName:undefined},{success:undefined},{success:{required:['confirmed'],expected:{date:'2026-10-10',time:'19:00'}}},{success:{required:['confirmed'],expected:{time:'19:00',partySize:2}}},{success:{required:['confirmed'],expected:{date:'2026-10-10',partySize:2}}}];
  for(const extra of missing)assert.equal(code(()=>dispatchPhone(f.service,f.agent,{grantId:g.id,request:reservation(extra)},opKey())),'reservation_requires_exact_conditions',JSON.stringify(extra));
  assert.equal(f.missions().length,0);
  const r=dispatchPhone(f.service,f.agent,{grantId:g.id,request:reservation()},opKey());
  assert.equal(r.state,'QUEUED');assert.deepEqual(r.successCriteria.expected,{date:'2026-10-10',time:'19:00',partySize:2});
  assert.equal(f.store.get('mission',r.missionId).phoneRequest.task,'reservation');
}));

// ----------------------------------------------------------------------------------------- idempotency

test('the same operation key and request return the same call; a changed request is a conflict',using(f=>{
  const g=f.grant(),key=opKey(),input={grantId:g.id,request:request()};
  const first=dispatchPhone(f.service,f.agent,input,key);
  assert.deepEqual(dispatchPhone(f.service,f.agent,input,key),first);
  // Property order is not a different request.
  assert.deepEqual(dispatchPhone(f.service,f.agent,{request:{instruction:'営業時間を確認する。',name:'テスト店',phone:P1},grantId:g.id},key),first);
  assert.equal(f.missions().length,1);assert.equal(agentPhoneConnection(f.service,f.agent,g.id).remainingCalls,9);
  for(const changed of [{grantId:g.id,request:request(P2)},{grantId:g.id,request:request(P1,{instruction:'定休日を確認する。'})},{grantId:f.grant().id,request:request()}])
    assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.agent,changed,key)),{code:'idempotency_conflict',status:409});
  assert.equal(f.missions().length,1);
  // A key is required and has a fixed shape.
  for(const bad of [undefined,'short','has space in it','x'.repeat(129),12345678])assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.agent,input,bad)),{code:'idempotency_key_required',status:400});
  // A replay recovers the call even after the grant was revoked; it does not dial again.
  revokePhoneGrant(f.service,f.alice,g.id);
  assert.equal(dispatchPhone(f.service,f.agent,input,key).missionId,first.missionId);
  assert.equal(f.missions().length,1);
}));

test('an operation key survives a restart of the Store on a file database',()=>{
  const dir=mkdtempSync(join(tmpdir(),'agent-phone-')),path=join(dir,'gateway.sqlite');
  try{
    let f=fixture({path});
    const connection=connectPhoneAgent(f.service,f.alice,{acknowledged:true,phones:[P1,P2]},'connect-0001'),agentId=connection.agentId,dataKey=f.key;
    const input={grantId:connection.grantId,request:request()},first=dispatchPhone(f.service,f.service.auth(connection.token),input,'restart-key-1');
    cancelAgentPhone(f.service,f.service.auth(connection.token),'restart-key-2');
    f.close();
    f=fixture({path,key:dataKey,seed:false});
    try{
      const agent=f.service.auth(connection.token);assert.equal(agent.id,agentId);assert.equal(agent.role,'agent');
      assert.deepEqual(dispatchPhone(f.service,agent,input,'restart-key-1'),first);
      assert.equal(readAgentPhone(f.service,agent,'restart-key-1').missionId,first.missionId);
      assert.equal(code(()=>dispatchPhone(f.service,agent,{...input,request:request(P2)},'restart-key-1')),'idempotency_conflict');
      // The tombstone of a call cancelled before it was submitted is durable too.
      assert.equal(dispatchPhone(f.service,agent,{...input,request:request(P2)},'restart-key-2').state,'CANCELLED');
      assert.equal(f.missions().length,1);
      // So is the connection: the same approval replays the same credential instead of minting a second agent.
      assert.deepEqual(connectPhoneAgent(f.service,f.alice,{acknowledged:true,phones:[P1,P2]},'connect-0001'),connection);
    }finally{f.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('another agent cannot read or cancel an operation key that is not its own',using(f=>{
  const g=f.grant(),key=opKey(),first=dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},key);
  for(const id of ['agentB','outsider'])assert.deepEqual(refusal(()=>readAgentPhone(f.service,f.by(id),key)),{code:'phone_dispatch_not_found',status:404});
  // The other agent's cancel only reaches its own key space: nothing about the real call is revealed or changed.
  const foreign=cancelAgentPhone(f.service,f.by('agentB'),key);
  assert.equal(foreign.missionId,null);assert.equal(foreign.record,null);
  assert.equal(f.store.get('mission',first.missionId).status,'QUEUED');
  assert.deepEqual(readAgentPhone(f.service,f.agent,key),first);
  // Operators and viewers are not agents: the agent surface refuses them outright.
  for(const id of ['alice','bob','viewer']){
    assert.deepEqual(refusal(()=>readAgentPhone(f.service,f.by(id),key)),{code:'agent_identity_required',status:403});
    assert.deepEqual(refusal(()=>cancelAgentPhone(f.service,f.by(id),key)),{code:'agent_identity_required',status:403});
    assert.deepEqual(refusal(()=>dispatchPhone(f.service,f.by(id),{grantId:g.id,request:request(P2)},opKey())),{code:'agent_identity_required',status:403});
    assert.deepEqual(refusal(()=>agentPhoneConnection(f.service,f.by(id),g.id)),{code:'agent_identity_required',status:403});
  }
  assert.equal(f.store.get('mission',first.missionId).status,'QUEUED');assert.equal(f.missions().length,1);
}));

test('connecting an agent is atomic and replayable: one credential, one grant, no second agent on retry',using(f=>{
  const input={acknowledged:true,phones:[P1]};
  assert.equal(code(()=>connectPhoneAgent(f.service,f.alice,{phones:[P1]},'connect-0001')),'explicit_delegation_approval_required');
  assert.equal(code(()=>connectPhoneAgent(f.service,f.alice,{...input,agentId:'agent'},'connect-0001')),'invalid_agent_phone_request');
  assert.equal(code(()=>connectPhoneAgent(f.service,f.by('viewer'),input,'connect-0001')),'read_only_account');
  // A grant that fails validation leaves no agent identity behind.
  assert.equal(code(()=>connectPhoneAgent(f.service,f.alice,{...input,maxSeconds:301},'connect-0001')),'invalid_grant_duration');
  assert.equal(f.store.all('agent-identity','alice').length,0);
  const c=connectPhoneAgent(f.service,f.alice,input,'connect-0001');
  assert.equal(c.kind,'oathra.agent-connection');assert.equal(c.schemaVersion,1);assert.ok(c.token.length>=32);assert.equal(c.grant.agentId,c.agentId);
  assert.deepEqual(connectPhoneAgent(f.service,f.alice,input,'connect-0001'),c);
  assert.equal(code(()=>connectPhoneAgent(f.service,f.alice,{...input,phones:[P2]},'connect-0001')),'idempotency_conflict');
  assert.equal(f.store.all('agent-identity','alice').length,1);assert.equal(f.store.all('phone-grant','alice').length,1);
  // The token is stored as a hash and authenticates as an agent of the owner's team, nothing more.
  const agent=f.service.auth(c.token);assert.equal(agent.role,'agent');assert.equal(agent.team,'one');assert.equal(agent.tokenHash,hash(c.token));assert.equal(agent.token,undefined);
  assert.equal(code(()=>grantPhone(f.service,agent,{agentId:agent.id,acknowledged:true,phones:[P2]})),'read_only_account');
  assert.equal(dispatchPhone(f.service,agent,{grantId:c.grantId,request:request()},opKey()).state,'QUEUED');
  assert.equal(code(()=>dispatchPhone(f.service,agent,{grantId:c.grantId,request:request(P2)},opKey())),'recipient_not_delegated');
}));

// ---------------------------------------------------------------------------------------------- cancel

test('cancelling before a delayed submission leaves a tombstone: the late dispatch does not dial',using(async f=>{
  const g=f.grant(),key=opKey();
  const stopped=cancelAgentPhone(f.service,f.agent,key);
  assert.deepEqual({state:stopped.state,terminal:stopped.terminal,outcome:stopped.outcome,missionId:stopped.missionId,nextAction:stopped.nextAction},{state:'CANCELLED',terminal:true,outcome:'cancelled',missionId:null,nextAction:'review_result_do_not_redial'});
  const late=dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},key);
  assert.deepEqual(late,stopped);assert.deepEqual(readAgentPhone(f.service,f.agent,key),stopped);
  assert.equal(f.missions().length,0);assert.equal(f.store.all('phone-dispatch','agent').length,0);
  assert.equal(f.worker.claimNext(),null);await f.worker.tick();assert.deepEqual(f.dialed,[]);
  // The tombstone costs nothing from the grant and holds only that key.
  assert.equal(agentPhoneConnection(f.service,f.agent,g.id).remainingCalls,10);
  assert.equal(dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},opKey()).state,'QUEUED');
}));

test('cancelling a queued call stops it before the worker claims it, and a replay does not redial',using(async f=>{
  const g=f.grant(),key=opKey(),input={grantId:g.id,request:request()},first=dispatchPhone(f.service,f.agent,input,key);
  const stopped=cancelAgentPhone(f.service,f.agent,key);
  assert.equal(stopped.missionId,first.missionId);assert.equal(stopped.state,'CANCELLED');assert.equal(stopped.terminal,true);assert.equal(stopped.outcome,'cancelled');
  assert.equal(dispatchPhone(f.service,f.agent,input,key).state,'CANCELLED');
  await f.worker.tick();assert.deepEqual(f.dialed,[]);assert.equal(f.missions().length,1);
}));

test('cancelling a finished call does not change its result',using(async f=>{
  const g=f.grant(),key=opKey(),first=dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},key);
  await f.worker.tick();await f.worker.active?.promise;
  assert.deepEqual(f.dialed,[first.missionId]);
  const done=readAgentPhone(f.service,f.agent,key);
  assert.equal(done.terminal,true);assert.notEqual(done.outcome,'pending');assert.notEqual(done.state,'CANCELLED');
  const after=cancelAgentPhone(f.service,f.agent,key);
  assert.deepEqual(after,done);assert.deepEqual(readAgentPhone(f.service,f.agent,key),done);
  assert.equal(f.store.get('mission',first.missionId).status,done.state);
  // Still exactly one execution.
  await f.worker.tick();await f.worker.active?.promise;assert.deepEqual(f.dialed,[first.missionId]);
  // Status and stop stay readable after the grant is revoked.
  revokePhoneGrant(f.service,f.alice,g.id);
  assert.deepEqual(readAgentPhone(f.service,f.agent,key),done);
}));

// --------------------------------------------------------------------------------- claim-time recheck

const shrunk={
  'recipient removed from the grant':[(f,g)=>f.store.put('phone-grant',{...g,phones:[P2]}),'phone_grant_scope_changed'],
  'per-call budget lowered':[(f,g)=>f.store.put('phone-grant',{...g,maxCallUsd:2.99}),'phone_grant_scope_changed'],
  'duration lowered':[(f,g)=>f.store.put('phone-grant',{...g,maxSeconds:299}),'phone_grant_scope_changed'],
  'grant revoked':[(f,g)=>revokePhoneGrant(f.service,f.alice,g.id),'phone_grant_expired_or_revoked'],
  'grant handed to another agent':[(f,g)=>f.store.put('phone-grant',{...g,agentId:'agentB'}),'phone_grant_not_found'],
};
for(const [name,[shrink,expected]] of Object.entries(shrunk))test(`claim time: ${name} after dispatch fails the queued call instead of dialing`,using(async f=>{
  const g=f.grant(),key=opKey(),first=dispatchPhone(f.service,f.agent,{grantId:g.id,request:request()},key);
  shrink(f,f.store.get('phone-grant',g.id));
  assert.equal(f.worker.claimNext(),null);
  const m=f.store.get('mission',first.missionId);
  assert.equal(m.status,'FAILED');assert.equal(m.error,expected);assert.equal(m.executionId,undefined);
  await f.worker.tick();await f.worker.active?.promise;assert.deepEqual(f.dialed,[]);
  const r=readAgentPhone(f.service,f.agent,key);
  assert.equal(r.state,'FAILED');assert.equal(r.terminal,true);assert.equal(r.outcome,'failed');assert.equal(r.nextAction,'review_result_do_not_redial');
  assert.ok(f.store.audits().some(a=>a.action==='call.policy_rejected'&&a.detail.error===expected));
}));

test('claim time: a reservation whose permission was withdrawn fails; an unchanged grant is claimed',using(async f=>{
  const g=f.grant({allowReservation:true}),first=dispatchPhone(f.service,f.agent,{grantId:g.id,request:reservation()},opKey());
  f.store.put('phone-grant',{...f.store.get('phone-grant',g.id),allowReservation:false});
  assert.equal(f.worker.claimNext(),null);
  assert.equal(f.store.get('mission',first.missionId).error,'phone_grant_scope_changed');
  const second=dispatchPhone(f.service,f.agent,{grantId:g.id,request:request(P2)},opKey());
  const claimed=f.worker.claimNext();
  assert.equal(claimed.id,second.missionId);assert.equal(claimed.status,'DIALING');
}));

// -------------------------------------------------------------------------------------- HTTP and roles

async function gateway(f){
  const app=await createGateway(f.config,{store:f.store,execute:async m=>{f.dialed.push(m.id);return {transcript:[]};},channels:{process:async()=>{},send:async()=>{}},phone:{},env:{}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  const call=async(who,method,path,body,key)=>{
    const r=await fetch(base+path,{method,headers:{...(who?{authorization:'Bearer '+(tokens[who]??who)}:{}),'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(method==='POST'?{body:JSON.stringify(body??{})}:{})});
    return {status:r.status,body:await r.json()};
  };
  return {app,base,call};
}

test('HTTP: only an operator grants or connects; only an agent identity dispatches',using(async f=>{
  const {app,call}=await gateway(f);
  try{
    const grantBody={agentId:'agent',acknowledged:true,phones:[P1]};
    // No credential, a viewer and an agent's own bearer cannot create, list or revoke grants, or mint connections.
    assert.equal((await call(null,'POST','/v1/phone/grants',grantBody)).status,401);
    for(const who of ['viewer','agent']){
      const r=await call(who,'POST','/v1/phone/grants',grantBody);assert.equal(r.status,403);assert.equal(r.body.error,'read_only_account');
      assert.equal((await call(who,'POST','/v1/phone/connections',{acknowledged:true,phones:[P1]},'connect-http-1')).status,403);
      assert.equal((await call(who,'GET','/v1/phone/grants')).status,403);
      assert.equal((await call(who,'GET','/v1/phone/grants/defaults')).status,403);
    }
    assert.equal(f.store.all('phone-grant','alice').length,0);
    const defaults=await call('alice','GET','/v1/phone/grants/defaults');assert.equal(defaults.status,200);assert.equal(defaults.body.defaults.maxCalls,10);assert.equal(defaults.body.ready,true);
    // The server's ceiling holds over HTTP as well.
    const raised=await call('alice','POST','/v1/phone/grants',{...grantBody,maxSeconds:9999});assert.equal(raised.status,400);assert.equal(raised.body.error,'invalid_grant_duration');
    const created=await call('alice','POST','/v1/phone/grants',grantBody);assert.equal(created.status,201);
    const grantId=created.body.id;
    assert.deepEqual((await call('alice','GET','/v1/phone/grants')).body.map(g=>g.id),[grantId]);
    assert.deepEqual((await call('carol','GET','/v1/phone/grants')).body,[]);

    // The agent surface: a bearer is required, and it must be an agent's.
    assert.equal((await call(null,'GET','/v1/agent/phone/grants/'+grantId)).status,401);
    for(const who of ['alice','bob','viewer']){
      const r=await call(who,'POST','/v1/agent/phone/calls',{grantId,request:request()},'http-op-0001');assert.equal(r.status,403);assert.equal(r.body.error,'agent_identity_required');
      assert.equal((await call(who,'GET','/v1/agent/phone/grants/'+grantId)).status,403);
    }
    assert.equal((await call('agentB','GET','/v1/agent/phone/grants/'+grantId)).status,404);
    assert.equal((await call('outsider','POST','/v1/agent/phone/calls',{grantId,request:request()},'http-op-0001')).status,404);
    assert.equal(f.missions().length,0);
    const ready=await call('agent','GET','/v1/agent/phone/grants/'+grantId);assert.equal(ready.status,200);assert.equal(ready.body.ready,true);assert.equal(ready.body.remainingCalls,10);

    // Dispatch: key required, schema errors are coded, replays return the same call.
    const noKey=await call('agent','POST','/v1/agent/phone/calls',{grantId,request:request()});assert.equal(noKey.status,400);assert.equal(noKey.body.error,'idempotency_key_required');
    const invalid=await call('agent','POST','/v1/agent/phone/calls',{grantId,request:request(P1,{maxSeconds:600})},'http-op-0002');assert.equal(invalid.status,400);assert.equal(invalid.body.error,'invalid_phone_request');
    const outside=await call('agent','POST','/v1/agent/phone/calls',{grantId,request:request(P2)},'http-op-0003');assert.equal(outside.status,403);assert.equal(outside.body.error,'recipient_not_delegated');
    const first=await call('agent','POST','/v1/agent/phone/calls',{grantId,request:request()},'http-op-0001');assert.equal(first.status,202);assert.equal(first.body.state,'QUEUED');
    const again=await call('agent','POST','/v1/agent/phone/calls',{grantId,request:request()},'http-op-0001');assert.equal(again.status,202);assert.equal(again.body.missionId,first.body.missionId);
    const conflict=await call('agent','POST','/v1/agent/phone/calls',{grantId,request:request(P1,{name:'別の店'})},'http-op-0001');assert.equal(conflict.status,409);assert.equal(conflict.body.error,'idempotency_conflict');
    assert.equal((await call('agent','GET','/v1/agent/phone/calls/http-op-0001')).body.missionId,first.body.missionId);
    assert.equal((await call('agentB','GET','/v1/agent/phone/calls/http-op-0001')).status,404);
    assert.equal((await call('alice','GET','/v1/agent/phone/calls/http-op-0001')).status,403);
    assert.equal((await call('agentB','POST','/v1/agent/phone/calls/http-op-0001/cancel')).body.missionId,null);
    assert.equal(f.store.get('mission',first.body.missionId).status,'QUEUED');

    // Revocation: not by a colleague, not by the agent; once revoked the grant refuses new calls but status and stop still work.
    assert.equal((await call('bob','POST','/v1/phone/grants/'+grantId+'/revoke')).status,404);
    assert.equal((await call('agent','POST','/v1/phone/grants/'+grantId+'/revoke')).status,403);
    const revoked=await call('alice','POST','/v1/phone/grants/'+grantId+'/revoke');assert.equal(revoked.status,200);assert.equal(revoked.body.status,'REVOKED');
    const refused=await call('agent','POST','/v1/agent/phone/calls',{grantId,request:request()},'http-op-0004');assert.equal(refused.status,403);assert.equal(refused.body.error,'phone_grant_expired_or_revoked');
    assert.equal((await call('agent','GET','/v1/agent/phone/grants/'+grantId)).body.nextAction,'renew_with_operator');
    const stopped=await call('agent','POST','/v1/agent/phone/calls/http-op-0001/cancel');assert.equal(stopped.status,200);assert.equal(stopped.body.state,'CANCELLED');
    assert.equal((await call('agent','GET','/v1/agent/phone/unknown')).status,404);
    assert.deepEqual(f.dialed,[]);assert.equal(f.missions().length,1);
  }finally{await app.close();}
}));

test('HTTP: a connection is issued once per approval and its bearer is an agent, not an operator',using(async f=>{
  const {app,call}=await gateway(f);
  try{
    const body={acknowledged:true,phones:[P1]};
    assert.equal((await call('alice','POST','/v1/phone/connections',body)).body.error,'idempotency_key_required');
    assert.equal((await call('alice','POST','/v1/phone/connections',{phones:[P1]},'connect-http-1')).status,403);
    const c=await call('alice','POST','/v1/phone/connections',body,'connect-http-1');assert.equal(c.status,201);assert.equal(c.body.baseUrl,'https://gateway.test');
    assert.deepEqual((await call('alice','POST','/v1/phone/connections',body,'connect-http-1')).body,c.body);
    assert.equal((await call('alice','POST','/v1/phone/connections',{...body,maxCalls:5},'connect-http-1')).status,409);
    const token=c.body.token;
    // The minted bearer cannot widen itself or act as its operator.
    assert.equal((await call(token,'POST','/v1/phone/grants',{agentId:c.body.agentId,acknowledged:true,phones:[P2]})).status,403);
    assert.equal((await call(token,'POST','/v1/phone/connections',body,'connect-http-2')).status,403);
    assert.equal((await call(token,'POST','/v1/phone/grants/'+c.body.grantId+'/revoke')).status,403);
    assert.equal((await call(token,'GET','/v1/agent/phone/grants/'+c.body.grantId)).body.ready,true);
    assert.equal((await call(token,'POST','/v1/agent/phone/calls',{grantId:c.body.grantId,request:request()},'http-op-0001')).status,202);
    assert.equal((await call('not-a-real-token','GET','/v1/agent/phone/grants/'+c.body.grantId)).status,401);
    assert.deepEqual(f.dialed,[]);
  }finally{await app.close();}
}));

// -------------------------------------------------------------------------------------- connection file

function connectionDir(){const dir=mkdtempSync(join(tmpdir(),'agent-connection-'));return {dir,write(name,value,mode=0o600){const p=join(dir,name);writeFileSync(p,typeof value==='string'?value:JSON.stringify(value),{mode});chmodSync(p,mode);return p;},close(){rmSync(dir,{recursive:true,force:true});}};}
const validConnection=(extra={})=>({schemaVersion:1,kind:'oathra.agent-connection',baseUrl:'http://127.0.0.1:4244',token:randomBytes(32).toString('base64url'),agentId:'phone-agent-'+randomUUID(),grantId:randomUUID(),...extra});
const posix={skip:process.platform==='win32'&&'file modes are not enforced on Windows'};

test('connection file: a well-formed 0600 file loads and yields a client',()=>{
  const d=connectionDir();
  try{
    const value=validConnection(),{connection,client}=readConnectionFile(d.write('connection.json',value));
    assert.deepEqual(connection,value);
    for(const method of ['agentPhoneConnection','agentPhone','agentPhoneStatus','agentPhoneCancel'])assert.equal(typeof client[method],'function');
    assert.ok(readConnectionFile(d.write('readonly.json',value,0o400)));
  }finally{d.close();}
});

test('connection file: a file readable by group or others is refused',posix,()=>{
  const d=connectionDir();
  try{for(const mode of [0o644,0o640,0o604,0o660,0o666])assert.throws(()=>readConnectionFile(d.write('m'+mode.toString(8)+'.json',validConnection(),mode)),/private to the current user/,mode.toString(8));}
  finally{d.close();}
});

test('connection file: a relative or missing path, a directory and malformed contents are refused',()=>{
  const d=connectionDir();
  try{
    d.write('connection.json',validConnection());
    for(const path of ['connection.json','./connection.json','',undefined,null])assert.throws(()=>readConnectionFile(path),/must be an absolute path/,String(path));
    assert.throws(()=>readConnectionFile(join(d.dir,'absent.json')),{code:'ENOENT'});
    mkdirSync(join(d.dir,'folder'),{mode:0o700});assert.throws(()=>readConnectionFile(join(d.dir,'folder')),/private to the current user/);
    assert.throws(()=>readConnectionFile(d.write('broken.json','{not json')),/Cannot read the Oathra connection JSON/);
    const invalid={version:{schemaVersion:2},kind:{kind:'oathra.phone-request'},token:{token:'short'},missingToken:{token:undefined},grant:{grantId:'not-a-grant'}};
    for(const [name,extra] of Object.entries(invalid))assert.throws(()=>readConnectionFile(d.write(name+'.json',validConnection(extra))),/Invalid Oathra connection file/,name);
    // The secret is only ever sent to HTTPS, or HTTP on loopback.
    for(const baseUrl of ['http://example.com','https://user:pass@example.com','https://example.com/path'])assert.throws(()=>readConnectionFile(d.write('url.json',validConnection({baseUrl}))),TypeError,baseUrl);
  }finally{d.close();}
});

test('connection file: an oversized file is refused',()=>{
  const d=connectionDir();
  try{assert.throws(()=>readConnectionFile(d.write('large.json',validConnection({padding:'x'.repeat(2*1024*1024)}))));}
  finally{d.close();}
});

// ------------------------------------------------------------------------------------- MCP over stdio

const mcpPath=fileURLToPath(new URL('../agent-mcp.mjs',import.meta.url));
function mcpClient(connectionFile){
  const child=spawn(process.execPath,[mcpPath],{env:{PATH:process.env.PATH,...(connectionFile?{OATHRA_CONNECTION_FILE:connectionFile}:{})},stdio:['pipe','pipe','pipe']});
  const waiting=[],lines=[];let buffer='',stderr='';
  child.stdout.setEncoding('utf8').on('data',chunk=>{buffer+=chunk;for(let i;(i=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);const w=waiting.shift();if(w)w.resolve(line);else lines.push(line);}});
  child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;});
  const exited=new Promise(r=>child.once('exit',r));
  void exited.then(()=>{for(const w of waiting.splice(0))w.reject(new Error('agent-mcp exited: '+stderr));});
  const nextLine=()=>lines.length?Promise.resolve(lines.shift()):new Promise((resolve,reject)=>{
    const w={resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}},timer=setTimeout(()=>{waiting.splice(waiting.indexOf(w),1);reject(new Error('agent-mcp did not answer: '+stderr));},15000);
    waiting.push(w);
  });
  let id=0;
  const raw=async line=>{child.stdin.write(line+'\n');return JSON.parse(await nextLine());};
  const rpc=(method,params)=>raw(JSON.stringify({jsonrpc:'2.0',id:++id,method,...(params?{params}:{})}));
  const tool=async(name,args)=>{const r=await rpc('tools/call',{name,arguments:args});assert.equal(r.error,undefined);const text=r.result.content[0].text;return {isError:r.result.isError===true,text,value:r.result.isError?null:JSON.parse(text)};};
  return {raw,rpc,tool,notify:line=>child.stdin.write(line+'\n'),pending:()=>lines.length,stderr:()=>stderr,async close(){child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(timer);}};
}

test('MCP stdio: initialize and tools/list expose exactly the four scoped tools, none that approves or grants',async()=>{
  const mcp=mcpClient();
  try{
    const init=await mcp.rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'0'}});
    assert.equal(init.jsonrpc,'2.0');assert.equal(init.id,1);assert.equal(init.result.protocolVersion,'2025-03-26');assert.equal(init.result.serverInfo.name,'oathra-agent-phone');assert.deepEqual(init.result.capabilities,{tools:{}});
    // A notification gets no reply; the next answer belongs to the next request.
    mcp.notify(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}));
    assert.deepEqual((await mcp.rpc('ping')).result,{});assert.equal(mcp.pending(),0);
    const {tools}=(await mcp.rpc('tools/list')).result;
    assert.deepEqual(tools.map(t=>t.name).sort(),['oathra_connection','oathra_phone_call','oathra_phone_cancel','oathra_phone_status']);
    for(const t of tools){
      assert.doesNotMatch(t.name,/grant|approv|connect_|revoke|consent|credit|token|review|start/);
      assert.equal(t.inputSchema.type,'object');assert.equal(t.inputSchema.additionalProperties,false);
      // The grant and the credential come from the connection file, never from the model.
      for(const forbidden of ['grantId','token','baseUrl','acknowledged','approvalToken','maxSeconds','maxUsd','maxCalls'])assert.ok(!JSON.stringify(t.inputSchema).includes('"'+forbidden+'"'),t.name+' '+forbidden);
    }
    const byName=Object.fromEntries(tools.map(t=>[t.name,t]));
    assert.deepEqual(byName.oathra_connection.inputSchema.required,[]);assert.equal(byName.oathra_connection.annotations.readOnlyHint,true);assert.equal(byName.oathra_phone_status.annotations.readOnlyHint,true);
    assert.deepEqual(byName.oathra_phone_call.inputSchema.required,['operationKey','request']);assert.equal(byName.oathra_phone_call.annotations.destructiveHint,true);assert.equal(byName.oathra_phone_call.inputSchema.properties.request.additionalProperties,false);
    for(const name of ['oathra_phone_call','oathra_phone_status','oathra_phone_cancel'])assert.equal(byName[name].inputSchema.properties.operationKey.pattern,'^[a-zA-Z0-9_-]{8,128}$');
    // Protocol errors.
    const unknown=await mcp.rpc('resources/list');assert.equal(unknown.error.code,-32601);
    assert.equal((await mcp.raw('{not json')).error.code,-32600);
    assert.equal((await mcp.raw(JSON.stringify({id:9,method:'tools/list'}))).error.code,-32600);
  }finally{await mcp.close();}
});

test('MCP stdio: arguments are checked before the gateway is contacted',async()=>{
  // No connection file at all: a rejected call must not get as far as needing one.
  const mcp=mcpClient();
  try{
    const good={operationKey:'mcp-operation-1',request:request()};
    const rejected=async(name,args,expected)=>{const r=await mcp.tool(name,args);assert.equal(r.isError,true,name+JSON.stringify(args));assert.equal(r.text,expected,name+JSON.stringify(args));};
    await rejected('oathra_phone_call',{request:request()},'Invalid tool arguments');
    await rejected('oathra_phone_call',{operationKey:'mcp-operation-1'},'Invalid tool arguments');
    await rejected('oathra_phone_status',{},'Invalid tool arguments');
    await rejected('oathra_phone_cancel',{},'Invalid tool arguments');
    for(const operationKey of ['short','has space in it','x'.repeat(129),'',null])await rejected('oathra_phone_call',{...good,operationKey},'A stable operationKey is required');
    await rejected('oathra_phone_status',{operationKey:'../../grants'},'A stable operationKey is required');
    // Unknown arguments, including the ones that would widen the delegation.
    for(const extra of [{grantId:randomUUID()},{acknowledged:true},{token:'x'},{maxSeconds:600},{surprise:1}])await rejected('oathra_phone_call',{...good,...extra},'Invalid tool arguments');
    await rejected('oathra_connection',{grantId:randomUUID()},'Invalid tool arguments');
    await rejected('oathra_phone_status',{operationKey:'mcp-operation-1',missionId:'x'},'Invalid tool arguments');
    for(const args of [[],'text',null])assert.equal((await mcp.rpc('tools/call',{name:'oathra_phone_status',arguments:args})).result.isError,true);
    // Unknown tools, including plausible operator tools.
    for(const name of ['oathra_phone_grant','oathra_approve','oathra_connect','grantPhone',undefined])await rejected(name,{},'Invalid tool arguments');
    // Valid arguments get as far as the connection file, which is refused when unset.
    const r=await mcp.tool('oathra_connection',{});assert.equal(r.isError,true);assert.match(r.text,/absolute path/);
  }finally{await mcp.close();}
});

test('MCP stdio: an operationKey that is not a string is rejected',async()=>{
  const mcp=mcpClient();
  try{
    for(const operationKey of [12345678,['abcdefgh']]){const r=await mcp.tool('oathra_phone_status',{operationKey});assert.equal(r.isError,true);assert.equal(r.text,'A stable operationKey is required',JSON.stringify(operationKey));}
  }finally{await mcp.close();}
});

test('MCP stdio: the four tools work against the local gateway inside the grant and never dial',using(async f=>{
  const {app,base}=await gateway(f),d=connectionDir();
  try{
    const connection=connectPhoneAgent(f.service,f.alice,{acknowledged:true,phones:[P1]},'connect-mcp-1');
    const mcp=mcpClient(d.write('connection.json',{...connection,baseUrl:base}));
    try{
      const status=await mcp.tool('oathra_connection',{});
      assert.equal(status.isError,false,status.text);assert.equal(status.value.ready,true);assert.equal(status.value.remainingCalls,10);assert.deepEqual(status.value.grant.phones,[P1]);
      // The credential never appears in a tool result.
      assert.ok(!status.text.includes(connection.token));

      const first=await mcp.tool('oathra_phone_call',{operationKey:'mcp-operation-1',request:request()});
      assert.equal(first.isError,false,first.text);assert.equal(first.value.state,'QUEUED');assert.equal(first.value.outcome,'pending');
      assert.deepEqual(f.store.get('mission',first.value.missionId).delegation,{agentId:connection.agentId,grantId:connection.grantId});
      // A retry with the same key is the same call; changed input is refused with the gateway's code.
      assert.equal((await mcp.tool('oathra_phone_call',{operationKey:'mcp-operation-1',request:request()})).value.missionId,first.value.missionId);
      const changed=await mcp.tool('oathra_phone_call',{operationKey:'mcp-operation-1',request:request(P1,{name:'別の店'})});assert.equal(changed.isError,true);assert.equal(changed.text,'idempotency_conflict');
      const outside=await mcp.tool('oathra_phone_call',{operationKey:'mcp-operation-2',request:request(P2)});assert.equal(outside.isError,true);assert.equal(outside.text,'recipient_not_delegated');
      // Unknown fields inside the request are refused by the gateway's schema.
      const nested=await mcp.tool('oathra_phone_call',{operationKey:'mcp-operation-3',request:request(P1,{maxSeconds:600})});assert.equal(nested.isError,true);assert.equal(nested.text,'invalid_phone_request');
      const reserve=await mcp.tool('oathra_phone_call',{operationKey:'mcp-operation-4',request:reservation()});assert.equal(reserve.isError,true);assert.equal(reserve.text,'reservation_not_delegated');
      assert.equal(f.missions().length,1);

      assert.equal((await mcp.tool('oathra_phone_status',{operationKey:'mcp-operation-1'})).value.missionId,first.value.missionId);
      const missing=await mcp.tool('oathra_phone_status',{operationKey:'mcp-operation-9'});assert.equal(missing.isError,true);assert.equal(missing.text,'phone_dispatch_not_found');
      const stopped=await mcp.tool('oathra_phone_cancel',{operationKey:'mcp-operation-1'});assert.equal(stopped.value.state,'CANCELLED');assert.equal(stopped.value.missionId,first.value.missionId);
      assert.equal((await mcp.tool('oathra_phone_status',{operationKey:'mcp-operation-1'})).value.outcome,'cancelled');
      // Stop before submit, then the late submit: no call.
      assert.equal((await mcp.tool('oathra_phone_cancel',{operationKey:'mcp-operation-5'})).value.missionId,null);
      assert.equal((await mcp.tool('oathra_phone_call',{operationKey:'mcp-operation-5',request:request()})).value.state,'CANCELLED');
      assert.equal(f.missions().length,1);

      // Once the operator revokes, the tools say so and submit nothing.
      revokePhoneGrant(f.service,f.alice,connection.grantId);
      const after=await mcp.tool('oathra_connection',{});assert.equal(after.value.ready,false);assert.equal(after.value.nextAction,'renew_with_operator');
      const refused=await mcp.tool('oathra_phone_call',{operationKey:'mcp-operation-6',request:request()});assert.equal(refused.isError,true);assert.equal(refused.text,'phone_grant_expired_or_revoked');
      assert.deepEqual(f.dialed,[]);assert.equal(f.missions().length,1);
    }finally{await mcp.close();}
    // A world-readable connection file is refused by the adapter, not sent anywhere.
    if(process.platform!=='win32'){
      const open=mcpClient(d.write('open.json',{...connection,baseUrl:base},0o644));
      try{const r=await open.tool('oathra_connection',{});assert.equal(r.isError,true);assert.match(r.text,/private to the current user/);}finally{await open.close();}
    }
  }finally{d.close();await app.close();}
}));
