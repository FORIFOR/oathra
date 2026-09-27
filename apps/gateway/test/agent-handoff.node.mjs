// Picked up by the existing Gateway node:test glob. No APIs or telephony.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, projectPhone, handleAgentRequest } from '../lib/agent-handoff.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('agent API validates explicit recipient data, not an approval',()=>{
 const request={requestId:'test-request',phone:'+12025550123',name:'Test',instruction:'Read a message'};
 assert.equal(validateDraft(request).data.phone,request.phone);
 assert.throws(()=>validateDraft({...request,approvalToken:'not-allowed'}));
});
test('call completion is not promoted into booking success',()=>{
 const r=projectPhone({id,status:'COMPLETED'},{memory:{bookingStatus:'unconfirmed',notes:[]}},{mode:'simulator',publicUrl:'http://localhost:4244'});
 assert.equal(r.state,'finished');assert.equal(r.evidence.bookingStatus,'unconfirmed');assert.match(r.interpretation,/not proof/);
});
test('existing non-agent route is not intercepted',()=>{assert.equal(handleAgentRequest({method:'GET',path:'/v1/phone/status'}),null);});
test('agent namespace has no approve/start route',()=>{assert.throws(()=>handleAgentRequest({method:'POST',path:'/v1/agent/phone/start'}),{code:'agent_operation_not_supported'});});
test('a request the phone contract rejects is a 400 for the caller, not a server error',()=>{
 const store={tx:f=>f(),key:()=>null};
 const service={write(){},store};
 const zod=Object.assign(new Error('bad voice for engine'),{name:'ZodError'});
 assert.throws(()=>handleAgentRequest({method:'POST',path:'/v1/agent/phone/draft',data:{requestId:'test-request',phone:'+12025550123',name:'Test',instruction:'Read a message',engine:'gpt-live',voice:'Kore'},user:{id:'u',role:'operator'},service,config:{mode:'simulator',publicUrl:'http://localhost:4244'},preparePhone:()=>{throw zod;},readPhone:()=>null,readiness:()=>({})}),{code:'invalid_phone_request',status:400});
});

// The real Gateway in simulator mode over HTTP, and the MCP server as a child process against it. No telephony.
import { randomBytes as rb, randomUUID as uuid } from 'node:crypto';
import { spawn } from 'node:child_process';
import { hash } from '../lib/security.mjs';
import { createGateway, configuration } from '../server.mjs';
async function liveGateway(){
 const token=rb(32).toString('hex'),other=rb(32).toString('hex');
 const config=configuration({OATHRA_USERS_JSON:JSON.stringify([{id:uuid(),team:'t',role:'operator',tokenHash:hash(token)},{id:uuid(),team:'t',role:'operator',tokenHash:hash(other)}]),OATHRA_DATA_KEY:rb(32).toString('hex'),OATHRA_DB:':memory:',OATHRA_PUBLIC_URL:'http://localhost:4244'});
 const app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;
 const call=(path,{method='GET',body,as=token}={})=>fetch(base+'/v1'+path,{method,headers:{authorization:'Bearer '+as,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}).then(async r=>({status:r.status,body:await r.json()}));
 return {app,base,token,other,call};
}
const draft={requestId:'genie-req-0001',phone:'+819012345678',name:'ゆき',instruction:'明日の集合時間を伝えてください。'};
test('agent drafts on the real Gateway: one draft per request, owner-only, never queued, no approval material',async()=>{
 const g=await liveGateway();
 try{
  const first=await g.call('/agent/phone/draft',{method:'POST',body:draft});
  assert.equal(first.status,201);assert.equal(first.body.state,'awaiting_human_approval');assert.equal(first.body.nextAction,'human_review_in_gateway');
  assert.doesNotMatch(JSON.stringify(first.body),/approvalToken|tokenHash/);
  const again=await g.call('/agent/phone/draft',{method:'POST',body:draft});
  assert.equal(again.status,200);assert.equal(again.body.replayed,true);assert.equal(again.body.missionId,first.body.missionId);
  assert.equal((await g.call('/agent/phone/draft',{method:'POST',body:{...draft,instruction:'別の内容'}})).body.error,'idempotency_conflict');
  // An engine this deployment does not offer is refused, never swapped for another.
  const acting=await g.call('/agent/phone/draft',{method:'POST',body:{...draft,requestId:'genie-req-0002',engine:'character-tts',voicePreset:'character-female'}});
  assert.equal(acting.status,400);assert.equal(acting.body.error,'voice_engine_unavailable');
  // A voice that does not belong to its engine is the caller's error, not a server failure.
  assert.equal((await g.call('/agent/phone/draft',{method:'POST',body:{...draft,requestId:'genie-req-0003',engine:'gpt-live',voice:'Kore'}})).status,400);
  const status=await g.call('/agent/phone/calls/'+first.body.missionId);
  assert.equal(status.status,200);assert.equal(status.body.canonicalStatus,'DRAFT');
  assert.equal((await g.call('/agent/phone/calls/'+first.body.missionId,{as:g.other})).status,404);
  assert.equal((await g.call('/agent/phone/start',{method:'POST',body:{}})).status,404);
  assert.equal(g.app.store.list('mission',undefined,'QUEUED').length,0);
 }finally{await g.app.close();}
});
test('MCP over stdio drafts and reads status against the real Gateway, with no start tool',async()=>{
 const g=await liveGateway();
 const child=spawn(process.execPath,[new URL('../mcp.mjs',import.meta.url).pathname],{env:{...process.env,OATHRA_GATEWAY_URL:g.base+'/',OATHRA_GATEWAY_TOKEN:g.token},stdio:['pipe','pipe','inherit']});
 const replies=[];let buf='';child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){replies.push(JSON.parse(buf.slice(0,i)));buf=buf.slice(i+1);}});
 const ask=async(id,method,params)=>{child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');for(let t=0;t<200&&!replies.find(r=>r.id===id);t++)await new Promise(r=>setTimeout(r,25));return replies.find(r=>r.id===id);};
 try{
  assert.equal((await ask(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}})).result.protocolVersion,'2025-06-18');
  const names=(await ask(2,'tools/list',{})).result.tools.map(t=>t.name);
  assert.ok(names.includes('oathra_phone_draft')&&names.includes('oathra_phone_status'));assert.ok(!names.some(n=>/start|approve|dial/.test(n)));
  const made=JSON.parse((await ask(3,'tools/call',{name:'oathra_phone_draft',arguments:{...draft,requestId:'mcp-req-0001'}})).result.content[0].text);
  assert.equal(made.state,'awaiting_human_approval');assert.doesNotMatch(JSON.stringify(made),new RegExp(g.token));
  const read=JSON.parse((await ask(4,'tools/call',{name:'oathra_phone_status',arguments:{id:made.missionId}})).result.content[0].text);
  assert.equal(read.canonicalStatus,'DRAFT');
 }finally{child.kill();await g.app.close();}
});
