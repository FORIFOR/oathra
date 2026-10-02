/** Non-dialing integration check using existing real records. No fake carrier, model, transcript or clock.
 * Run with the real Gateway env files. Reads the source DB read-only, uses a private ephemeral DB,
 * and deliberately never starts the worker. Temporary credentials/dispatches exist only in that DB.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { configuration, createGateway } from '../apps/gateway/server.mjs';
import { Store } from '../apps/gateway/lib/store.mjs';
import { hash } from '../apps/gateway/lib/security.mjs';
import { evaluateSales } from '../apps/gateway/lib/sales.mjs';
import { Service } from '../apps/gateway/lib/service.mjs';
import { grantPhone } from '../apps/gateway/lib/agent-phone.mjs';

const cfg=configuration();
assert.equal(cfg.mode,'live','Use a real live Gateway configuration (no simulator).');
assert.equal(cfg.liveReady,true,'Real provider configuration is required; this script never invokes providers.');
const source=new DatabaseSync(cfg.dbPath,{readOnly:true}),dir=mkdtempSync(join(tmpdir(),'oathra-agent-check-'));
const store=new Store(join(dir,'gateway.sqlite'),cfg.dataKey);
const rows=source.prepare("SELECT body FROM records WHERE kind='mission' ORDER BY updated DESC LIMIT 500").all().map(r=>store.open(r.body));
const previous=rows.find(m=>m.mode==='live'&&m.kind==='phone-request'&&m.phoneRequest&&m.transcript?.length);
assert(previous,'Existing real phone request with a transcript is required; no synthetic fallback.');
const owner=cfg.users.find(u=>u.id===previous.owner&&['admin','operator'].includes(u.role));assert(owner,'Real call owner must still be configured.');
const accountRow=source.prepare("SELECT body FROM records WHERE kind='account' AND id=?").get(owner.id);
assert(accountRow,'Existing owner consent is required.');store.put('account',store.open(accountRow.body));source.close();
const ownerToken=randomBytes(32).toString('hex'),agentToken=randomBytes(32).toString('hex');
const agent={id:'verification-'+randomUUID(),team:owner.team,role:'agent',tokenHash:hash(agentToken)};
const config={...cfg,dbPath:join(dir,'gateway.sqlite'),users:[{...owner,tokenHash:hash(ownerToken)},agent]};
const app=await createGateway(config,{store});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
const request=Object.fromEntries(Object.entries(previous.phoneRequest).filter(([k])=>!['kind','schemaVersion'].includes(k)));
let checks=0;
async function api(path,{token=agentToken,method='GET',body,key,status=200}={}){
 const response=await fetch(origin+'/v1'+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();assert.equal(response.status,status,`${path}: ${value.error??response.status}`);checks++;return value;
}
const grantInput={agentId:agent.id,phones:[request.phone],maxCalls:1,maxCallUsd:cfg.maxCallUsd,maxTotalUsd:cfg.maxCallUsd,maxSeconds:cfg.maxSeconds,expiresAt:new Date(Date.now()+3600_000).toISOString(),allowReservation:request.task==='reservation',acknowledged:true};
async function nodeScript(script,args=[],input='',env={}){
 return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[script,...args],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('exit',code=>code===0?resolve(out):reject(Error(`Local script failed (${code}): ${err}`)));p.stdin.end(input);});
}
try {
 const defaults=await api('/phone/grants/defaults',{token:ownerToken});
 assert.equal(defaults.defaults.maxCalls,10);assert.equal(defaults.defaults.maxSeconds,Math.min(300,cfg.maxSeconds));
 assert(Math.abs(Date.parse(defaults.defaults.expiresAt)-Date.now()-24*3600_000)<5000);checks++;
 await api('/phone/connections',{method:'POST',body:{phones:[request.phone],acknowledged:true},key:randomUUID(),status:403});
 await api('/phone/connections',{token:ownerToken,method:'POST',body:{phones:[request.phone]},key:randomUUID(),status:403});
 const before=store.all('agent-identity',owner.id).length;
 await api('/phone/connections',{token:ownerToken,method:'POST',body:{phones:[],acknowledged:true},key:randomUUID(),status:400});
 assert.equal(store.all('agent-identity',owner.id).length,before);checks++;
 // Exercise the actual provisioning CLI, private file and MCP subprocess against this HTTP server.
 const tokenFile=join(dir,'operator-token'),connectionFile=join(dir,'trial.json'),connectionKey=randomUUID();
 writeFileSync(tokenFile,ownerToken,{mode:0o600});
 const cliArgs=['--url',origin,'--token-file',tokenFile,'--phone',request.phone];
 const preview=await nodeScript('apps/gateway/connect-agent.mjs',cliArgs);assert(!preview.includes(ownerToken));assert.equal(store.all('agent-identity',owner.id).length,before);checks++;
 const output=await nodeScript('apps/gateway/connect-agent.mjs',[...cliArgs,'--approve','--output',connectionFile,'--key',connectionKey]);
 const connection=JSON.parse(readFileSync(connectionFile,'utf8'));
 assert(!output.includes(connection.token));assert.equal(statSync(connectionFile).mode&0o777,0o600);checks++;
 const replayConnection=await api('/phone/connections',{token:ownerToken,method:'POST',body:{phones:[request.phone],acknowledged:true},key:connectionKey,status:201});
 assert.equal(connection.token,replayConnection.token);assert.equal(connection.grantId,replayConnection.grantId);checks++;
 await api('/phone/connections',{token:ownerToken,method:'POST',body:{phones:[request.phone],acknowledged:true,maxCalls:2},key:connectionKey,status:409});
 const persisted=new Store(config.dbPath,cfg.dataKey);assert.equal(new Service(persisted,config).auth(connection.token).id,connection.agentId);persisted.close();checks++;
 const trialState=await api('/agent/phone/grants/'+connection.grantId,{token:connection.token});assert.equal(trialState.ready,true);assert.equal(trialState.remainingCalls,10);
 await api('/phone/grants/defaults',{token:connection.token,status:403});
 const rpc=(id,method,params)=>JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n';
 const op=randomUUID();
 // Reuse a real request. The default trial intentionally forbids booking commits.
 const mcpRequest={...request};delete mcpRequest.task;
 const mcpInput=rpc(1,'initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'oathra-verifier',version:'1'}})+rpc(2,'tools/list')+rpc(3,'tools/call',{name:'oathra_connection'})+rpc(4,'tools/call',{name:'oathra_phone_call',arguments:{operationKey:op,request:mcpRequest}})+rpc(5,'tools/call',{name:'oathra_phone_status',arguments:{operationKey:op}})+rpc(6,'tools/call',{name:'oathra_phone_cancel',arguments:{operationKey:op}})+rpc(7,'tools/call',{name:'oathra_connection'});
 const mcpOut=await nodeScript('apps/gateway/agent-mcp.mjs',[],mcpInput,{OATHRA_CONNECTION_FILE:connectionFile});
 assert(!mcpOut.includes(connection.token));const replies=mcpOut.trim().split('\n').map(JSON.parse);assert.equal(replies.length,7);
 assert.equal(replies[0].result.protocolVersion,'2025-03-26');assert.equal(replies[1].result.tools.length,4);
 const resultAt=i=>{assert(!replies[i].result.isError);return JSON.parse(replies[i].result.content[0].text);};
 assert.equal(resultAt(2).ready,true);assert.equal(resultAt(3).state,'QUEUED');assert.equal(store.get('mission',resultAt(3).missionId).maxSeconds,Math.min(300,cfg.maxSeconds));assert.equal(connection.grant.maxTotalUsd,Math.round(connection.grant.maxCallUsd*10*100)/100);assert.equal(resultAt(4).missionId,resultAt(3).missionId);assert.equal(resultAt(5).state,'CANCELLED');assert.equal(resultAt(6).remainingCalls,9);assert.equal(resultAt(6).ready,true);checks+=7;
 await api(`/phone/grants/${connection.grantId}/revoke`,{token:ownerToken,method:'POST',body:{}});
 assert.equal((await api('/agent/phone/grants/'+connection.grantId,{token:connection.token})).ready,false);
 await api('/phone/grants',{method:'POST',body:grantInput,status:403});
 const grant=await api('/phone/grants',{token:ownerToken,method:'POST',body:grantInput,status:201});
 const body={grantId:grant.id,request},key=randomUUID();
 await api('/agent/phone/calls',{token:ownerToken,method:'POST',body,key,status:403});
 const results=await Promise.all([api('/agent/phone/calls',{method:'POST',body,key,status:202}),api('/agent/phone/calls',{method:'POST',body,key,status:202})]);
 assert.equal(results[0].missionId,results[1].missionId);assert.equal(results[0].state,'QUEUED');assert.equal(results[0].outcome,'pending');checks++;
 await api('/agent/phone/calls',{method:'POST',body:{...body,request:{...request,name:request.name+' '}},key,status:409});
 await api('/agent/phone/calls',{method:'POST',body,key:randomUUID(),status:429});
 const cancel=await api(`/agent/phone/calls/${key}/cancel`,{method:'POST',body:{}});assert.equal(cancel.state,'CANCELLED');
 const replay=await api('/agent/phone/calls',{method:'POST',body,key,status:202});assert.equal(replay.missionId,results[0].missionId);assert.equal(replay.outcome,'cancelled');
 await api(`/missions/${replay.missionId}`,{token:ownerToken,method:'DELETE'});
 await api('/agent/phone/calls',{method:'POST',body,key,status:410});
 const stopKey=randomUUID();await api(`/agent/phone/calls/${stopKey}/cancel`,{method:'POST',body:{}});
 const noCall=await api('/agent/phone/calls',{method:'POST',body,key:stopKey,status:202});assert.equal(noCall.missionId,null);assert.equal(noCall.state,'CANCELLED');
 // Revocation is checked by the real worker's claim step, without starting its event loop or executing a call.
 const grant2=await api('/phone/grants',{token:ownerToken,method:'POST',body:grantInput,status:201}),key2=randomUUID();
 await api('/agent/phone/calls',{method:'POST',body:{grantId:grant2.id,request},key:key2,status:202});
 await api(`/phone/grants/${grant2.id}/revoke`,{token:ownerToken,method:'POST',body:{}});
 assert.equal(app.worker.claimNext(),null);checks++;
 const revoked=await api(`/agent/phone/calls/${key2}`);assert.equal(revoked.state,'FAILED');
 const budgetGrant=await api('/phone/grants',{token:ownerToken,method:'POST',body:{...grantInput,maxCalls:2},status:201}),budgetKey=randomUUID();
 await api('/agent/phone/calls',{method:'POST',body:{grantId:budgetGrant.id,request},key:budgetKey,status:202});
 await api(`/agent/phone/calls/${budgetKey}/cancel`,{method:'POST',body:{}});
 const overBudget=await api('/agent/phone/calls',{method:'POST',body:{grantId:budgetGrant.id,request},key:randomUUID(),status:429});assert.equal(overBudget.error,'phone_grant_budget_exceeded');
 if(cfg.callerId!==request.phone){const notAllowed=await api('/agent/phone/calls',{method:'POST',body:{grantId:budgetGrant.id,request:{...request,phone:cfg.callerId}},key:randomUUID(),status:403});assert.equal(notAllowed.error,'recipient_not_delegated');}
 // Actual previously recorded transcript, passed through the new optional condition evaluator.
 const verified=evaluateSales(previous.transcript,{...previous,phoneRequest:{...previous.phoneRequest,success:{required:['confirmed'],expected:{}}}},true);
 assert(['COMPLETED','INCOMPLETE','DECLINED'].includes(verified.status));
 if(verified.status==='COMPLETED')assert(verified.evidence.some(e=>e.field==='confirmed'&&e.source==='callee'&&e.verified));
 const legacy=evaluateSales(previous.transcript,previous,true);assert.notEqual(legacy.status,'COMPLETED');checks++;
 // Read through a fresh encrypted store connection to prove durable identity after losing process state.
 const reopened=new Store(config.dbPath,cfg.dataKey);assert.equal(reopened.all('phone-dispatch',agent.id).length,3);reopened.close();checks++;
 if(process.env.MULTIBOT_PYTHON&&process.env.MULTIBOT_ROOT){
   // Separate integration scenario so earlier limit tests cannot spend this scenario's daily allowance.
   // Keep the real configured limits unchanged, and never start either worker.
   const fresh=new Store(join(dir,'multibot-gateway.sqlite'),cfg.dataKey);fresh.put('account',store.get('account',owner.id));
   const second=await createGateway({...config,dbPath:join(dir,'multibot-gateway.sqlite')},{store:fresh});
   try {
     await new Promise(r=>second.server.listen(0,'127.0.0.1',r));
     const secondOrigin=`http://127.0.0.1:${second.server.address().port}`,grant3=grantPhone(new Service(fresh,config),owner,grantInput);
     const descriptor=join(dir,'connection.json');writeFileSync(descriptor,JSON.stringify({origin:secondOrigin,token:agentToken,grantId:grant3.id,request}),{mode:0o600});
     const script=join(process.env.MULTIBOT_ROOT,'backend/scripts/verify_oathra.py');
     await new Promise((resolve,reject)=>{const p=spawn(process.env.MULTIBOT_PYTHON,[script,descriptor],{cwd:join(process.env.MULTIBOT_ROOT,'backend'),stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',b=>{out+=b;});p.stderr.on('data',b=>{out+=b;});p.on('error',reject);p.on('exit',code=>{if(code===0){console.log(out.trim());checks++;resolve();}else reject(new Error(`Multibot check failed (${code}): ${out}`));});});
     assert.equal(second.worker.timer,undefined);assert.equal(second.worker.active,null);
   } finally { await second.close();fresh.close(); }
 }
 assert.equal(app.worker.timer,undefined);assert.equal(app.worker.active,null);
 console.log(JSON.stringify({status:'PASS',checks,source:'existing real call request and transcript',dialed:false,workerStarted:false,temporaryData:'removed on exit'}));
}finally{await app.close();store.close();rmSync(dir,{recursive:true,force:true});}
