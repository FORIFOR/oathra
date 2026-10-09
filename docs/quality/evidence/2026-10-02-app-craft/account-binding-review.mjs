import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {launch,sleep} from '../../../../scripts/ui/cdp.mjs';
const base=process.cwd(),origin='http://127.0.0.1:61758';
const token=readFileSync(base+'/.oathra/managed-preview/.oathra-managed/admin-token.txt','utf8').trim();
const files=['apps/gateway/public/app.js','apps/gateway/public/app/app.js'];
const hashes=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(base+'/'+f)).digest('hex')]));
const report={at:new Date().toISOString(),method:'Real Chrome CDP network observation and real isolated-server session cookie; existing operator only. No fetch interception, fabricated responses, business-record mutations, provider calls or screenshots.',environment:{origin},sourceHashes:hashes(),checks:[],requests:[],limits:['Cross-account transition not executed: no second real account credential used.','Browser document reload tested with real own-session revocation (HTTP 401), not fabricated HTTP 409.','Provider/payment behavior outside scope.'],privacy:'Tokens, cookies, owner IDs, email, request bodies and response bodies are never serialized.'};
const p=await launch(); let socket,owner=null,stage='setup',seq=0;const pending=new Map(),requestRows=new Map();
const check=(condition,id,observed)=>{report.checks.push({id,method:'real Chrome / isolated HTTP',expected:true,observed:observed??!!condition,status:condition?'PASS':'FAIL'});assert(condition,id)};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('CDP command timeout: '+method))},10000);pending.set(id,m=>{clearTimeout(timeout);m.error?reject(new Error(m.error.message)):resolve(m.result)});socket.send(JSON.stringify({id,method,params}))});
const login=()=>p.js(`fetch('/v1/session',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+${JSON.stringify(token)}},body:'{}'}).then(r=>r.status)`);
const revoke=()=>p.js("fetch('/v1/session',{method:'DELETE'}).then(r=>r.status)");
const signedWorkspace=()=>p.until("!!document.getElementById('workspace')&&!document.getElementById('workspace').hidden",{timeout:12000,label:'workspace authenticated'});
try {
 const command=execFileSync('ps',['-ax','-o','ppid=,command='],{encoding:'utf8'}).split('\n').find(x=>x.trimStart().startsWith(process.pid+' ')&&x.includes('--remote-debugging-port='));
 const port=/--remote-debugging-port=(\d+)/.exec(command)[1];
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x=>x.type==='page');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
 socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){const done=pending.get(m.id);pending.delete(m.id);done(m)}
  if(m.method==='Network.requestWillBeSent'&&stage!=='setup'){
   const r=m.params.request,u=new URL(r.url);if(u.origin!==origin||!u.pathname.startsWith('/v1/'))return;
   const headers=Object.fromEntries(Object.entries(r.headers).map(([k,v])=>[k.toLowerCase(),v]));
   const row={stage,path:u.pathname,method:r.method,hasOwnerBinding:typeof headers['x-oathra-account']==='string',matchesExpectedOwner:headers['x-oathra-account']===owner,hasBearer:!!headers.authorization};
   report.requests.push(row);requestRows.set(m.params.requestId,row);
  }
  if(m.method==='Network.responseReceived'){const row=requestRows.get(m.params.requestId);if(row)row.status=m.params.response.status}
 };
 await send('Network.enable'); report.environment.browser=(await send('Browser.getVersion')).product;
 report.environment.os=execFileSync('sw_vers',['-productVersion'],{encoding:'utf8'}).trim();
 await p.goto(origin+'/workspace');check(await login()===200,'existing_operator_real_session_created');
 owner=await p.js("fetch('/v1/bootstrap').then(r=>r.json()).then(b=>b.user.id)");check(typeof owner==='string'&&owner.length>0,'real_owner_resolved_in_memory_only');
 stage='workspace_initial';await p.goto(origin+'/workspace');await signedWorkspace();
 stage='workspace_refresh';await p.tap('#refresh');await sleep(800);
 const wr=report.requests.filter(r=>r.stage==='workspace_refresh'&&r.path==='/v1/bootstrap');check(wr.length>0&&wr.every(r=>r.matchesExpectedOwner&&r.status===200&&!r.hasBearer),'workspace_refresh_bound_to_authenticated_owner',{requests:wr.length,allBound:wr.every(r=>r.matchesExpectedOwner),statuses:wr.map(r=>r.status)});
 stage='setup';check(await revoke()===200,'workspace_session_really_revoked');
 stage='workspace_expired';await p.tap('#refresh');await p.until("location.pathname==='/app/'&&location.hash==='#login'",{timeout:12000,label:'workspace expiry to app login'});
 check(report.requests.some(r=>r.stage==='workspace_expired'&&r.path==='/v1/bootstrap'&&r.matchesExpectedOwner&&r.status===401),'workspace_expired_request_retained_old_owner_and_was_denied');
 check(await p.visible('.public-access'),'workspace_expiry_shows_shared_login');
 stage='setup';check(await login()===200,'existing_operator_second_real_session_created');
 stage='app_initial';await p.goto(origin+'/app/#/settings/cost');await p.until("!!document.querySelector('.public-order-heading button')&&!document.querySelector('.public-order-heading button').disabled",{timeout:12000,label:'app cost page loaded'});
 const ar=report.requests.filter(r=>r.stage==='app_initial');
 for(const path of ['/v1/phone/history','/v1/account/month','/v1/phone/status','/v1/credits/ledger','/v1/public/service','/v1/credits/purchases']){
  const rows=ar.filter(r=>r.path===path);check(rows.length>0&&rows.every(r=>r.matchesExpectedOwner&&!r.hasBearer&&r.status===200),'app_bound_'+path,{requests:rows.length,statuses:rows.map(r=>r.status)})
 }
 const firstBootstrap=ar.findIndex(r=>r.path==='/v1/bootstrap');check(firstBootstrap>=0&&ar.findIndex(r=>r.path==='/v1/phone/history')>firstBootstrap&&ar.findIndex(r=>r.path==='/v1/account/month')>firstBootstrap,'app_bootstrap_precedes_owner_scoped_reads');
 stage='app_refresh';await p.js("document.querySelector('.public-order-heading button').scrollIntoView({block:'center'})");await p.tap('.public-order-heading button');await sleep(600);
 check(report.requests.some(r=>r.stage==='app_refresh'&&r.path==='/v1/credits/purchases'&&r.matchesExpectedOwner&&r.status===200&&!r.hasBearer),'app_purchase_refresh_bound_to_authenticated_owner');
 const priorTimeOrigin=await p.js('performance.timeOrigin');
 stage='setup';check(await revoke()===200,'app_session_really_revoked');
 stage='app_expired';await p.tap('.public-order-heading button');await p.until("!!document.querySelector('.public-access')",{timeout:12000,label:'app expiry to shared login'});
 const navigation=await p.js("({recreated:performance.timeOrigin!=="+priorTimeOrigin+",type:performance.getEntriesByType('navigation')[0]?.type,tabsHidden:document.querySelector('#tabs').hidden,barHidden:document.querySelector('#bar-right').hidden,noPurchaseForm:!document.querySelector('.public-purchase')})");
 check(report.requests.some(r=>r.stage==='app_expired'&&r.path==='/v1/credits/purchases'&&r.matchesExpectedOwner&&r.status===401),'app_expired_request_retained_old_owner_and_was_denied');
 check(navigation.recreated&&navigation.type==='reload','app_expiry_recreates_document_with_full_reload',{recreated:navigation.recreated,type:navigation.type});
 check(navigation.tabsHidden&&navigation.barHidden&&navigation.noPurchaseForm,'app_expiry_removes_old_forms_and_authenticated_navigation',navigation);
 check(p.pageErrors.filter(x=>!x.startsWith('console.error:')).length===0,'no_runtime_exceptions');
 check(JSON.stringify(report.sourceHashes)===JSON.stringify(hashes()),'reviewed_source_unchanged_during_verification');
 report.result='PASS';
} catch(e) { report.result='FAIL';report.failure=String(e.message).replaceAll(token,'[redacted]').replaceAll(owner??'NOTOWNER','[owner]');process.exitCode=1; }
finally {if(socket)socket.close();await p.close();writeFileSync(base+'/docs/quality/evidence/2026-10-02-app-craft/account-binding-review.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,checks:report.checks.length,failed:report.checks.filter(c=>c.status==='FAIL').map(c=>c.id),failure:report.failure,evidence:'docs/quality/evidence/2026-10-02-app-craft/account-binding-review.json'}))}
