// Delegated sales calls and the incoming-call feed for an external agent (Genie): real Store/Service, a fake `execute`,
// no carrier. Nothing here dials; the worker is driven by hand and the only network is the fixture server on 127.0.0.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Worker } from '../lib/worker.mjs';
import { hash } from '../lib/security.mjs';
import { grantPhone, phoneGrantDefaults, dispatchSales, dispatchPhone, readAgentPhone, cancelAgentPhone, agentSalesContext, agentInbound, revokePhoneGrant } from '../lib/agent-phone.mjs';
import { gatewayClient } from '../../../sdk/gateway-client/index.mjs';
import { createGateway } from '../server.mjs';

const now=Date.parse('2026-10-02T03:00:00Z');
const P1='+819000000001',P2='+819000000002',P3='+819000000003',P4='+819000000004';
const tokens={alice:'alice-token',bob:'bob-token',agent:'agent-token',agentB:'agent-b-token',carol:'carol-token'};
const users=()=>[
  {id:'alice',team:'one',role:'admin'},{id:'bob',team:'one',role:'operator'},
  {id:'agent',team:'one',role:'agent'},{id:'agentB',team:'one',role:'agent'},{id:'carol',team:'two',role:'admin'},
].map(u=>({...u,tokenHash:hash(tokens[u.id])}));
const liveConfig=(overrides={})=>({mode:'live',liveReady:true,users:users(),maxSeconds:300,maxCallUsd:10,dailyCalls:0,dailyUsd:0,rateCeilingUsd:0.25,setupFeeUsd:0,
  consentVersion:'v1',callerId:'+815000000000',publicUrl:'https://gateway.test',missing:[],...overrides});

function fixture({config=liveConfig()}={}){
  let clock=now;
  const store=new Store(':memory:',randomBytes(32).toString('hex'),()=>clock),service=new Service(store,config),by=id=>config.users.find(u=>u.id===id);
  const alice=by('alice'),agent=by('agent');
  for(const id of ['alice','carol']){service.saveConsent(by(id),'v1');store.put('account',{...service.account(by(id)),verifiedPhone:P1,phoneVerificationProvider:'twilio-verify'});}
  const dialed=[];
  const execute=async(m,{onEvent})=>{dialed.push(m.id);onEvent({type:'call.connected'});return {transcript:[{id:'t1',source:'callee',text:'資料を送ってください。'}]};};
  const worker=new Worker(service,{process:async()=>{},send:async()=>{}},execute);
  const product=service.product(alice,{name:'デモ商品',facts:'受付の電話をAIが代わりに受けます。',reviewed:true});
  const contact=(name,phone,extra={})=>service.contact(alice,{name,phone,relationship:'customer',basis:'展示会で名刺交換し、案内の了承を得た',...extra});
  const tanaka=contact('田中',P2),sato=contact('佐藤',P3,{relationship:'',basis:''}),outside=contact('鈴木',P4);
  const grant=(input={})=>grantPhone(service,alice,{agentId:'agent',acknowledged:true,phones:[P1,P2,P3],expiresAt:new Date(clock+3600_000).toISOString(),...input});
  return {config,store,service,by,alice,agent,worker,dialed,grant,product,tanaka,sato,outside,advance(ms){clock+=ms;},missions:()=>store.list('mission'),close(){store.close();}};
}
const using=(fn,options)=>async()=>{const f=fixture(options);try{await fn(f);}finally{f.close();}};
const refusal=fn=>{try{fn();return null;}catch(e){return {code:e.code??e.name,status:e.status};}};
const code=fn=>refusal(fn)?.code??null;
let serial=0;const opKey=()=>'sales-op-'+String(++serial).padStart(4,'0');
const sales=(f,extra={})=>({contactId:f.tanaka.id,productId:f.product.id,request:'デモ商品の資料送付について案内する',goal:'materials',...extra});

// ------------------------------------------------------------------------------------ grant permissions

test('sales and inbound are separate permissions, off by default, and must be booleans',using(f=>{
  const d=phoneGrantDefaults(f.service,f.alice).defaults;assert.equal(d.allowSales,false);assert.equal(d.readInbound,false);
  const plain=f.grant();assert.equal(plain.allowSales,false);assert.equal(plain.readInbound,false);
  assert.equal(code(()=>f.grant({allowSales:'yes'})),'invalid_sales_permission');
  assert.equal(code(()=>f.grant({readInbound:1})),'invalid_inbound_permission');
  const both=f.grant({allowSales:true,readInbound:true});assert.equal(both.allowSales,true);assert.equal(both.readInbound,true);
  const audit=f.store.audits().filter(a=>a.action==='agent_phone.granted').at(-1);
  assert.equal(audit.detail.allowSales,true);assert.equal(audit.detail.readInbound,true);
}));

// ------------------------------------------------------------------------------------------- sales

test('a grant without allowSales neither lists sales context nor drafts a sales call',using(f=>{
  const g=f.grant();
  assert.deepEqual(refusal(()=>agentSalesContext(f.service,f.agent,g.id)),{code:'sales_not_delegated',status:403});
  assert.deepEqual(refusal(()=>dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f)},opKey())),{code:'sales_not_delegated',status:403});
  assert.equal(f.missions().length,0);
}));

test('sales context lists reviewed products and only the delegated contacts, with whether each may be called',using(f=>{
  const g=f.grant({allowSales:true}),c=agentSalesContext(f.service,f.agent,g.id);
  assert.deepEqual(c.products,[{id:f.product.id,name:'デモ商品'}]);
  assert.deepEqual(c.contacts.map(x=>[x.name,x.callPermitted]).sort(),[['佐藤',false],['田中',true]]);
  // Someone outside the grant is not even listed.
  assert.ok(!c.contacts.some(x=>x.name==='鈴木'));
  assert.equal(code(()=>agentSalesContext(f.service,f.by('agentB'),g.id)),'phone_grant_not_found');
}));

test('a sales call is queued inside the grant for a permitted contact and never dials by itself',using(f=>{
  const g=f.grant({allowSales:true}),key=opKey(),r=dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f)},key);
  assert.equal(r.state,'QUEUED');assert.equal(r.outcome,'pending');assert.equal(r.successCriteria,null);
  assert.equal(r.record.kind,'sales');assert.equal(r.record.goal,'materials');assert.deepEqual(r.record.target,{name:'田中'});assert.deepEqual(r.record.product,{name:'デモ商品'});
  const m=f.store.get('mission',r.missionId);
  assert.deepEqual(m.delegation,{agentId:'agent',grantId:g.id});assert.equal(m.kind,undefined);assert.equal(m.target.phone,P2);assert.equal(m.maxSeconds,180);assert.equal(m.maxUsd,3);
  assert.deepEqual(m.origin,{channel:'agent',agentId:'agent'});
  assert.deepEqual(f.dialed,[]);
  assert.ok(f.store.audits().some(a=>a.action==='agent_sales.dispatched'&&a.detail.mission===m.id&&a.detail.goal==='materials'));
  // The same key and input return the same call; a changed input is a conflict; status and stop use the shared key.
  assert.equal(dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f)},key).missionId,r.missionId);
  assert.equal(code(()=>dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f,{goal:'meeting'})},key)),'idempotency_conflict');
  assert.equal(readAgentPhone(f.service,f.agent,key).missionId,r.missionId);
  assert.equal(f.missions().length,1);
}));

test('a sales call refuses contacts outside the grant, without a relationship and basis, or on the do-not-call list',using(f=>{
  const g=f.grant({allowSales:true});
  assert.deepEqual(refusal(()=>dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f,{contactId:f.outside.id})},opKey())),{code:'recipient_not_delegated',status:403});
  assert.deepEqual(refusal(()=>dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f,{contactId:f.sato.id})},opKey())),{code:'contact_permission_required',status:403});
  f.store.suppress('one',P2,'asked_not_to_be_called');
  assert.equal(code(()=>dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f)},opKey())),'contact_permission_required');
  assert.equal(f.missions().length,0);
}));

test('a sales call checks its input and the grant duration, and counts toward the grant limits',using(f=>{
  const g=f.grant({allowSales:true,maxCalls:2});
  for(const [bad,expected] of [[{request:''},'invalid_sales_request'],[{goal:'close'},'invalid_goal'],[{maxSeconds:301},'invalid_grant_duration'],[{maxSeconds:29},'invalid_grant_duration']])
    assert.equal(code(()=>dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f,bad)},opKey())),expected,JSON.stringify(bad));
  assert.equal(code(()=>dispatchSales(f.service,f.agent,{grantId:g.id,sales:{...sales(f),owner:'carol'}},opKey())),'invalid_agent_phone_request');
  assert.equal(code(()=>dispatchSales(f.service,f.agent,{grantId:g.id},opKey())),'invalid_agent_phone_request');
  // One sales call and one ordinary call use up a two-call grant.
  const first=dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f)},opKey());
  cancelAgentPhone(f.service,f.agent,'sales-op-'+String(serial).padStart(4,'0'));
  dispatchPhone(f.service,f.agent,{grantId:g.id,request:{phone:P1,name:'自分',instruction:'テストです。'}},opKey());
  assert.equal(code(()=>dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f)},opKey())),'phone_grant_call_limit');
  assert.ok(first.missionId);
}));

test('claim time: a sales call whose permission was withdrawn fails instead of dialing; an unchanged one runs once',using(async f=>{
  const g=f.grant({allowSales:true}),first=dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f)},opKey());
  f.store.put('phone-grant',{...f.store.get('phone-grant',g.id),allowSales:false});
  assert.equal(f.worker.claimNext(),null);
  assert.equal(f.store.get('mission',first.missionId).error,'phone_grant_scope_changed');
  f.store.put('phone-grant',{...f.store.get('phone-grant',g.id),allowSales:true});
  const key=opKey(),second=dispatchSales(f.service,f.agent,{grantId:g.id,sales:sales(f)},key);
  await f.worker.tick();await f.worker.active?.promise;
  assert.deepEqual(f.dialed,[second.missionId]);
  const done=readAgentPhone(f.service,f.agent,key);
  assert.equal(done.terminal,true);assert.notEqual(done.outcome,'pending');
  assert.deepEqual(done.record.transcript.map(t=>t.text),['資料を送ってください。']);
  // A revoked grant leaves the result readable to the agent that placed it.
  revokePhoneGrant(f.service,f.alice,g.id);
  assert.deepEqual(readAgentPhone(f.service,f.agent,key),done);
}));

// ---------------------------------------------------------------------------------------- inbound

/** A finished incoming call as phone.mjs would leave it, with its finalized transcript as events. */
function inboundCall(f,{from=P1,status='COMPLETED',finishedAt=now,owner='alice',text='明日の会議資料を3ページでまとめておいて。'}={}){
  const m={id:randomUUID(),owner,team:owner==='carol'?'two':'one',revision:1,status,kind:'phone-request',direction:'inbound',
    phoneRequest:{schemaVersion:1,kind:'oathra.phone-request',phone:from,name:'着信',instruction:'着信。用件を聞き取って伝えます。'},
    inbound:{callSid:'CA'+randomUUID().replaceAll('-',''),token:randomUUID()},target:{name:'着信',phone:from},request:'着信の応対',goal:'phone.inbound',product:null,
    candidateSlots:[],testOnMe:false,mode:'live',maxSeconds:180,maxUsd:3,estimatedMaximumUsd:0,callerId:'+815000000000',createdAt:finishedAt-60_000,approvedAt:finishedAt-60_000,
    finishedAt:['COMPLETED','FAILED','CANCELLED','INCOMPLETE','DECLINED','UNKNOWN'].includes(status)?finishedAt:undefined,origin:null,result:null,
    transcript:[{id:'c1',source:'caller',text:'お電話ありがとうございます。ご用件を伺います。',t:0},{id:'u1',source:'callee',text,t:1200}]};
  f.store.put('mission',m);return m;
}

test('the inbound feed needs readInbound on the grant',using(f=>{
  inboundCall(f);
  assert.deepEqual(refusal(()=>agentInbound(f.service,f.agent,f.grant().id)),{code:'inbound_not_delegated',status:403});
}));

test('the inbound feed lists the owner\'s finished incoming calls oldest first, marking calls from the verified number',using(f=>{
  const g=f.grant({readInbound:true});
  const mine=inboundCall(f,{finishedAt:now-3000}),stranger=inboundCall(f,{from:P4,finishedAt:now-2000,text:'折り返しください。'});
  inboundCall(f,{status:'ACTIVE'});inboundCall(f,{status:'UNKNOWN',finishedAt:now-1000});inboundCall(f,{owner:'carol',finishedAt:now-500});
  // An outbound call is not an incoming one.
  dispatchPhone(f.service,f.agent,{grantId:g.id,request:{phone:P3,name:'佐藤',instruction:'テストです。'}},opKey());
  const page=agentInbound(f.service,f.agent,g.id);
  assert.deepEqual(page.calls.map(c=>c.callId),[mine.id,stranger.id]);
  assert.deepEqual(page.calls.map(c=>c.fromOwner),[true,false]);
  assert.deepEqual(page.calls[0].transcript.map(t=>t.source),['caller','callee']);
  assert.equal(page.calls[1].transcript[1].text,'折り返しください。');
  assert.equal(page.next,now-2000);
  assert.deepEqual(agentInbound(f.service,f.agent,g.id,page.next).calls,[]);
  assert.equal(code(()=>agentInbound(f.service,f.agent,g.id,'-1')),'invalid_cursor');
  assert.equal(code(()=>agentInbound(f.service,f.agent,g.id,'abc')),'invalid_cursor');
}));

test('a caller id is only the owner\'s while the number is carrier-verified',using(f=>{
  const g=f.grant({readInbound:true});inboundCall(f);
  f.store.put('account',{...f.service.account(f.alice),phoneVerificationProvider:'simulator'});
  assert.equal(agentInbound(f.service,f.agent,g.id).calls[0].fromOwner,false);
}));

test('the inbound cursor never splits one millisecond across pages',using(f=>{
  const g=f.grant({readInbound:true});
  for(let i=0;i<49;i++)inboundCall(f,{finishedAt:now-10_000+i});
  const tied=[inboundCall(f,{finishedAt:now}),inboundCall(f,{finishedAt:now}),inboundCall(f,{finishedAt:now})];
  inboundCall(f,{finishedAt:now+1});
  const first=agentInbound(f.service,f.agent,g.id);
  assert.equal(first.calls.length,52);assert.ok(tied.every(t=>first.calls.some(c=>c.callId===t.id)));assert.equal(first.next,now);
  assert.equal(agentInbound(f.service,f.agent,g.id,first.next).calls.length,1);
}));

// --------------------------------------------------------------------------------------------- HTTP

test('HTTP and SDK: sales and inbound routes accept only an agent bearer and keep the grant permissions',using(async f=>{
  const app=await createGateway(f.config,{store:f.store,execute:async m=>{f.dialed.push(m.id);return {transcript:[]};},channels:{process:async()=>{},send:async()=>{}},phone:{},env:{}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  const call=async(who,method,path,body,key)=>{
    const r=await fetch(base+path,{method,headers:{...(who?{authorization:'Bearer '+tokens[who]}:{}),'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(method==='POST'?{body:JSON.stringify(body??{})}:{})});
    return {status:r.status,body:await r.json()};
  };
  try{
    const plain=f.grant(),g=f.grant({allowSales:true,readInbound:true});inboundCall(f);
    assert.equal((await call(null,'GET','/v1/agent/sales/context?grantId='+g.id)).status,401);
    for(const who of ['alice','bob']){
      const r=await call(who,'GET','/v1/agent/sales/context?grantId='+g.id);assert.equal(r.status,403);assert.equal(r.body.error,'agent_identity_required');
      assert.equal((await call(who,'POST','/v1/agent/sales/calls',{grantId:g.id,sales:sales(f)},'http-sales-01')).status,403);
      assert.equal((await call(who,'GET','/v1/agent/phone/inbound?grantId='+g.id)).status,403);
    }
    assert.equal((await call('agent','GET','/v1/agent/sales/context')).status,404);
    assert.equal((await call('agentB','GET','/v1/agent/phone/inbound?grantId='+g.id)).status,404);
    assert.equal((await call('agent','GET','/v1/agent/phone/inbound?grantId='+plain.id)).body.error,'inbound_not_delegated');
    assert.equal((await call('agent','POST','/v1/agent/sales/calls',{grantId:plain.id,sales:sales(f)},'http-sales-02')).body.error,'sales_not_delegated');
    const noKey=await call('agent','POST','/v1/agent/sales/calls',{grantId:g.id,sales:sales(f)});assert.equal(noKey.status,400);assert.equal(noKey.body.error,'idempotency_key_required');

    // The SDK speaks the same routes.
    const client=gatewayClient({baseUrl:base,token:tokens.agent});
    const context=await client.agentSalesContext(g.id);assert.ok(context.contacts.some(c=>c.name==='田中'&&c.callPermitted));
    const placed=await client.agentSales({grantId:g.id,sales:sales(f),idempotencyKey:'http-sales-03'});assert.equal(placed.state,'QUEUED');assert.equal(placed.record.kind,'sales');
    assert.equal((await client.agentPhoneStatus('http-sales-03')).missionId,placed.missionId);
    const inbound=await client.agentInbound({grantId:g.id});assert.equal(inbound.calls.length,1);assert.equal(inbound.calls[0].fromOwner,true);
    assert.deepEqual((await client.agentInbound({grantId:g.id,after:inbound.next})).calls,[]);
    const stopped=await client.agentPhoneCancel('http-sales-03');assert.equal(stopped.state,'CANCELLED');
    assert.deepEqual(f.dialed,[]);
  }finally{await app.close();}
}));
