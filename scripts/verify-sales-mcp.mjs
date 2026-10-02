/** Real local OAuth client against a native backup of the existing account database.
 * No invented customers, calls, payments or transcripts. No worker or external provider is started.
 * Credentials stay in memory. The isolated database is removed on completion.
 */
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {parseEnv,parseArgs} from 'node:util';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {backupDatabase} from '../apps/gateway/backup.mjs';
import {configuration,createGateway} from '../apps/gateway/server.mjs';
import {launch} from './ui/cdp.mjs';

const {values}=parseArgs({options:{env:{type:'string'},'token-file':{type:'string'},output:{type:'string'},ui:{type:'boolean',default:false}}});
assert(values.env&&values['token-file']&&values.output,'Pass --env, --token-file and --output for an existing real account.');
assert(!existsSync(values.output),'Evidence already exists; choose a new --output path.');
const source=parseEnv(readFileSync(values.env,'utf8')),sourceConfig=configuration(source);
const operatorToken=readFileSync(values['token-file'],'utf8').trim();
const owner=sourceConfig.users.find(u=>u.tokenHash===createHash('sha256').update(operatorToken).digest('hex'));
assert(owner&&['operator','admin'].includes(owner.role),'Existing real operator token required.');
const directory=mkdtempSync(join(tmpdir(),'oathra-sales-mcp-'));
const report={capturedAt:new Date().toISOString(),node:process.version,source:'Native backup of existing real operator database',workerStarted:false,providerRequests:0,checks:[],blocked:[]};
const reviewedFiles=['scripts/verify-sales-mcp.mjs','apps/gateway/server.mjs','apps/gateway/lib/mcp-oauth.mjs','apps/gateway/lib/mcp-sales.mjs','apps/gateway/public/connect/index.html','apps/gateway/public/connect/connect.js','apps/gateway/public/connect/connect.css'];
const sourceHashes=()=>Object.fromEntries(reviewedFiles.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
report.sourceHashes=sourceHashes();
let app,callback,page,lastCallback;
const ok=(name)=>report.checks.push({name,status:'PASS'});
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>s.close(r));
try {
  await backupDatabase(sourceConfig.dbPath,join(directory,'backup'));
  const reserve=createServer();await listen(reserve);const port=reserve.address().port;await close(reserve);
  const origin=`http://127.0.0.1:${port}`;
  const keys=['OATHRA_DATA_KEY','OATHRA_USERS_JSON','OATHRA_DEPLOYMENT','OATHRA_CREDITS_PER_CALL','OATHRA_CREDIT_POLICY','OATHRA_CREDIT_USD','OATHRA_LIVE_PRICES_JSON','OATHRA_CARRIER_JPY_PER_USD','OATHRA_CARRIER_FX_DATE','OATHRA_SETTLEMENT_MODE','OATHRA_USAGE_PRICES_JSON','OATHRA_VOICE_ENGINE','OATHRA_VOICE_MODEL'];
  const env=Object.fromEntries(keys.filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
  Object.assign(env,{OATHRA_MODE:'simulator',OATHRA_PUBLIC_URL:origin,OATHRA_MCP_ENABLED:'true',OATHRA_PUBLIC_SIGNUP:'false',OATHRA_RELEASE_STAGE:'prerelease',OATHRA_PRERELEASE_PAUSED:'true',OATHRA_PRERELEASE_GLOBAL_DAILY_USD:'0',OATHRA_DB:join(directory,'backup/gateway.sqlite'),PORT:String(port),HOST:'127.0.0.1'});
  app=await createGateway(configuration(env),{env});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
  const business=()=>app.store.db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all().filter(r=>!r.kind.startsWith('mcp-')).map(r=>({kind:r.kind,id:r.id,body:app.store.open(r.body)}));
  const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  report.before={rows:business().length,hash:digest(business())};
  let cookie;
  async function request(path,{method='GET',data,form,token,browser=false,status=200,headers={}}={}){
    const response=await fetch(origin+path,{method,redirect:'manual',headers:{...(token?{authorization:'Bearer '+token}:{}),...(browser?{origin,cookie,'x-oathra-account':owner.id}:{}),...(data?{'content-type':'application/json'}:{}),...(form?{'content-type':'application/x-www-form-urlencoded'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{}),...(form?{body:new URLSearchParams(form)}:{})});
    const body=await response.text();let value;try{value=body?JSON.parse(body):null;}catch{value=null;}
    assert.equal(response.status,status,`${path}: expected ${status}, got ${response.status} (${value?.error??'response'})`);
    return {response,value};
  }
  async function interruptedRequest(path,headers,data,between){
    const marker=randomUUID(),payload=JSON.stringify(data);let incoming,observedResolve;
    const observed=new Promise(r=>{observedResolve=r;});
    const observe=req=>{if(req.headers['x-oathra-verification-id']===marker){app.server.off('request',observe);observedResolve();}};
    app.server.on('request',observe);
    const response=new Promise((resolve,reject)=>{
      incoming=httpRequest(origin+path,{method:'POST',headers:{...headers,'content-type':'application/json','content-length':Buffer.byteLength(payload),'x-oathra-verification-id':marker}},res=>{
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));res.on('error',reject);
      });incoming.on('error',reject);incoming.setTimeout(10_000,()=>incoming.destroy(new Error('Partial local request timed out')));incoming.write(payload.slice(0,Math.floor(payload.length/2)));
    });
    try {
      // The ordinary server listener precedes this observer and has already reached its body await.
      await Promise.race([observed,response.then(()=>{throw new Error('Local request ended before partial body observation');})]);
      await between();incoming.end(payload.slice(Math.floor(payload.length/2)));return await response;
    }finally{app.server.off('request',observe);incoming.destroy();}
  }
  const login=await request('/v1/session',{method:'POST',token:operatorToken,data:{},headers:{origin}});
  cookie=login.response.headers.get('set-cookie').split(';')[0];assert(cookie);ok('real_operator_session');
  const s=(await request('/v1/public/mcp')).value;assert(s.enabled&&s.localOnly&&!s.publicReady);ok('local_only_status');
  assert.equal((await request('/.well-known/oauth-protected-resource/mcp')).value.resource,origin+'/mcp');
  assert.equal((await request('/.well-known/oauth-authorization-server')).value.issuer,origin);ok('discovery');
  const unauthorized=await request('/mcp',{status:401});assert(unauthorized.response.headers.get('www-authenticate').includes('/.well-known/oauth-protected-resource/mcp'));ok('unauthenticated_challenge');
  await request('/mcp',{token:operatorToken,status:401});ok('admin_token_not_mcp_token');
  callback=createServer((req,res)=>{if(req.url.startsWith('/callback?'))lastCallback=new URL(req.url,'http://127.0.0.1');res.writeHead(200,{'content-type':'text/plain'});res.end('Oathra local authorization completed.');});await listen(callback);
  const redirect=`http://127.0.0.1:${callback.address().port}/callback`;
  const client=(await request('/oauth/register',{method:'POST',data:{client_name:'Codex local Oathra verification',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},status:201})).value;
  assert(client.client_id);ok('real_local_client_registration');
  const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const params={response_type:'code',client_id:client.client_id,redirect_uri:redirect,scope:'oathra:read oathra:draft',resource:origin+'/mcp',state:randomBytes(24).toString('base64url'),code_challenge:challenge,code_challenge_method:'S256'};
  function authorizationParams(scope='oathra:read',registered=client){
    const verifier=randomBytes(32).toString('base64url');
    return {verifier,parameters:{...params,client_id:registered.client_id,scope,state:randomBytes(24).toString('base64url'),code_challenge:createHash('sha256').update(verifier).digest('base64url')}};
  }
  async function exchangeAuthorization(destination,flow,registered=client){
    assert.equal(destination.searchParams.get('state'),flow.parameters.state,'OAuth callback state mismatch');
    assert(destination.searchParams.get('code'),'OAuth callback has no code');
    const before=(await request('/v1/mcp/connections',{browser:true})).value.connections.map(c=>c.id);
    const tokens=(await request('/oauth/token',{method:'POST',form:{grant_type:'authorization_code',client_id:registered.client_id,redirect_uri:redirect,code:destination.searchParams.get('code'),code_verifier:flow.verifier,resource:origin+'/mcp'}})).value;
    const after=(await request('/v1/mcp/connections',{browser:true})).value.connections;
    const connection=after.find(c=>!before.includes(c.id));assert(connection,'New authorized connection absent');
    return {tokens,connection};
  }
  async function authorize(scope='oathra:read'){
    const flow=authorizationParams(scope);
    const consent=(await request('/v1/mcp/authorize/preview',{method:'POST',browser:true,data:{parameters:flow.parameters}})).value;
    const decision=(await request('/v1/mcp/authorize/decision',{method:'POST',browser:true,data:{requestId:consent.requestId,csrf:consent.csrf,approved:true}})).value;
    const destination=new URL(decision.redirectUrl);assert.equal((await fetch(destination,{redirect:'error'})).status,200);
    return exchangeAuthorization(destination,flow);
  }
  await request('/v1/mcp/authorize/preview',{method:'POST',data:{parameters:params},status:401});ok('consent_requires_browser_session');
  await request('/v1/mcp/authorize/preview',{method:'POST',browser:true,data:{parameters:{...params,resource:origin+'/v1'}},status:400});ok('wrong_resource_refused');
  await request('/v1/mcp/authorize/preview',{method:'POST',browser:true,data:{parameters:{...params,code_challenge_method:'plain'}},status:400});ok('plain_pkce_refused');
  const draftOnly=await request('/v1/mcp/authorize/preview',{method:'POST',browser:true,data:{parameters:{...params,scope:'oathra:draft'}},status:400});assert.equal(draftOnly.value.error,'invalid_scope');ok('draft_only_scope_refused');
  const denialFlow=authorizationParams(),denial=(await request('/v1/mcp/authorize/preview',{method:'POST',browser:true,data:{parameters:denialFlow.parameters}})).value;
  const connectionCount=(await request('/v1/mcp/connections',{browser:true})).value.connections.length;
  const denied=new URL((await request('/v1/mcp/authorize/decision',{method:'POST',browser:true,data:{requestId:denial.requestId,csrf:denial.csrf,approved:false}})).value.redirectUrl);
  assert.equal(denied.searchParams.get('error'),'access_denied');assert(!denied.searchParams.has('code'));assert.equal(denied.searchParams.get('state'),denialFlow.parameters.state);
  assert.equal((await fetch(denied,{redirect:'error'})).status,200);assert.equal((await request('/v1/mcp/connections',{browser:true})).value.connections.length,connectionCount);ok('explicit_denial_has_no_connection_or_code');
  await request('/v1/mcp/authorize/decision',{method:'POST',browser:true,data:{requestId:denial.requestId,csrf:denial.csrf,approved:true},status:400});ok('denied_consent_cannot_be_reused');
  const consent=(await request('/v1/mcp/authorize/preview',{method:'POST',browser:true,data:{parameters:params}})).value;
  assert(consent.requestId&&consent.csrf&&consent.scopes.includes('oathra:draft'));ok('consent_preview');
  await request('/v1/mcp/authorize/decision',{method:'POST',browser:true,data:{requestId:consent.requestId,approved:true},status:400});ok('consent_nonce_required');
  const approved=(await request('/v1/mcp/authorize/decision',{method:'POST',browser:true,data:{requestId:consent.requestId,csrf:consent.csrf,approved:true}})).value;
  const destination=new URL(approved.redirectUrl);assert.equal(destination.origin,new URL(redirect).origin);assert.equal(destination.searchParams.get('state'),params.state);
  assert.equal((await fetch(destination,{redirect:'error'})).status,200);ok('real_local_callback');
  const code=destination.searchParams.get('code');assert(code);
  const form={grant_type:'authorization_code',client_id:client.client_id,redirect_uri:redirect,code,code_verifier:verifier,resource:origin+'/mcp'};
  const tokens=(await request('/oauth/token',{method:'POST',form})).value;assert(tokens.access_token&&tokens.refresh_token);ok('authorization_code_exchange');
  const mcpHeaders={accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'};
  async function rpc(method,params,token=tokens.access_token){return (await request('/mcp',{method:'POST',token,data:{jsonrpc:'2.0',id:randomUUID(),method,...(params?{params}:{})},headers:mcpHeaders})).value;}
  assert.equal((await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Codex local Oathra verification',version:'1'}})).result.protocolVersion,'2025-06-18');ok('mcp_initialize');
  const toolList=(await rpc('tools/list')).result.tools;
  assert.deepEqual(toolList.map(t=>t.name),['oathra_sales_context','oathra_sales_draft','oathra_sales_status']);ok('no_dial_or_approval_tools');
  const context=await rpc('tools/call',{name:'oathra_sales_context',arguments:{}});assert(!context.result.isError);
  const contextValue=JSON.parse(context.result.content[0].text);assert.equal(contextValue.permissions.dial,false);ok('read_existing_account_context');
  const forbidden=await rpc('tools/call',{name:'oathra_start',arguments:{}});assert.equal(forbidden.result.isError,true);ok('unknown_dial_tool_refused');
  await request('/v1/bootstrap',{token:tokens.access_token,status:401});ok('mcp_token_not_gateway_token');
  await request('/mcp',{token:tokens.access_token,status:403,headers:{origin:'null'}});ok('foreign_origin_refused');
  await request('/mcp',{token:tokens.access_token,status:405});ok('unsupported_sse_method');
  await request('/mcp',{method:'POST',token:tokens.access_token,headers:mcpHeaders,data:{jsonrpc:'2.0',method:'notifications/initialized'},status:202});ok('notification_empty_202');
  const readOnly=await authorize();
  assert.deepEqual((await rpc('tools/list',null,readOnly.tokens.access_token)).result.tools.map(t=>t.name),['oathra_sales_context','oathra_sales_status']);ok('read_only_tools_list');
  const readContext=await rpc('tools/call',{name:'oathra_sales_context',arguments:{}},readOnly.tokens.access_token);assert(!readContext.result.isError);
  assert.equal(JSON.parse(readContext.result.content[0].text).permissions.draft,false);ok('read_only_real_account_context');
  const draftRejected=await rpc('tools/call',{name:'oathra_sales_draft',arguments:{}},readOnly.tokens.access_token);
  assert.equal(draftRejected.result.isError,true);assert.equal(JSON.parse(draftRejected.result.content[0].text).error,'insufficient_scope');ok('read_only_draft_scope_refused');
  const actual=app.store.all('mission',owner.id).find(m=>m.kind!=='phone-request'&&m.product?.id&&m.target?.id);
  if(actual){
    const read=await rpc('tools/call',{name:'oathra_sales_status',arguments:{missionId:actual.id}},readOnly.tokens.access_token);assert(!read.result.isError);ok('read_only_existing_sales_status');
  }else report.blocked.push({name:'read_only_existing_sales_status',reason:'No suitable existing sales record. No fabricated fallback.'});
  report.blocked.push({name:'sales_draft_success',reason:'This run creates OAuth credentials only; no sales record is created.'});
  await request('/v1/mcp/connections/'+readOnly.connection.id+'/revoke',{method:'POST',browser:true,data:{}});
  await request('/mcp',{token:readOnly.tokens.access_token,status:401});
  await request('/v1/mcp/connections/'+readOnly.connection.id+'/revoke',{method:'POST',browser:true,data:{}});ok('explicit_owner_revoke_is_effective_and_idempotent');
  const duringBody=await authorize();
  const bodyRevoked=await interruptedRequest('/mcp',{...mcpHeaders,authorization:'Bearer '+duringBody.tokens.access_token},{jsonrpc:'2.0',id:randomUUID(),method:'tools/list'},()=>request('/v1/mcp/connections/'+duringBody.connection.id+'/revoke',{method:'POST',browser:true,data:{}}));
  assert.equal(bodyRevoked.status,401);assert.equal(JSON.parse(bodyRevoked.body).error,'invalid_token');ok('revocation_during_body_rechecked_before_tool_execution');
  const clientRevoke=await authorize();
  await request('/oauth/revoke',{method:'POST',form:{client_id:client.client_id,token:clientRevoke.tokens.refresh_token,token_type_hint:'refresh_token'}});
  await request('/mcp',{token:clientRevoke.tokens.access_token,status:401});ok('oauth_revocation_endpoint_revokes_family');
  const slowConsent=(await request('/v1/mcp/authorize/preview',{method:'POST',browser:true,data:{parameters:authorizationParams().parameters}})).value;
  const consentRevoked=await interruptedRequest('/v1/mcp/authorize/decision',{origin,cookie,'x-oathra-account':owner.id},{requestId:slowConsent.requestId,csrf:slowConsent.csrf,approved:true},()=>request('/v1/session',{method:'DELETE',browser:true}));
  assert.equal(consentRevoked.status,401);ok('logout_during_consent_body_refuses_authorization');
  const newLogin=await request('/v1/session',{method:'POST',token:operatorToken,data:{},headers:{origin}});cookie=newLogin.response.headers.get('set-cookie').split(';')[0];
  const refreshed=(await request('/oauth/token',{method:'POST',form:{grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,resource:origin+'/mcp'}})).value;assert(refreshed.refresh_token!==tokens.refresh_token);ok('refresh_rotation');
  assert((await rpc('tools/list',null,refreshed.access_token)).result.tools.length);ok('refreshed_token_access');
  await request('/oauth/token',{method:'POST',form:{grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,resource:origin+'/mcp'},status:400});
  await request('/mcp',{token:refreshed.access_token,status:401});ok('refresh_reuse_revokes_connection');
  await request('/oauth/token',{method:'POST',form,status:400});ok('code_reuse_refused');
  const connections=(await request('/v1/mcp/connections',{browser:true})).value.connections;assert(connections.length>=1);assert(!JSON.stringify(connections).includes('access_token'));ok('connection_list_without_credentials');
  if(values.ui){
    page=await launch({width:1440,height:900});
    await page.goto(origin+'/connect');await page.until("document.querySelector('#mcp-endpoint').value.endsWith('/mcp')",{label:'public connection setup'});
    assert(await page.visible('#login-panel'));assert(await page.noSidewaysScroll());
    assert(await page.js("document.querySelector('#account-bar').hidden && document.querySelector('#connections-panel').hidden"));ok('ui_logged_out_desktop_private_data_hidden');
    const imageBase=join(dirname(resolve(values.output)),basename(values.output,'.json'));
    await page.screenshot(imageBase+'-connect-desktop.png');
    await page.viewport(390,844);assert(await page.noSidewaysScroll());assert(await page.visible('#login-panel'));ok('ui_logged_out_mobile_no_horizontal_overflow');
    await page.screenshot(imageBase+'-connect-mobile.png');report.screenshots=[imageBase+'-connect-desktop.png',imageBase+'-connect-mobile.png'];
    await page.viewport(1440,900);
    const browserLogin=()=>page.js(`fetch('/v1/session',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+${JSON.stringify(operatorToken)}},body:'{}'}).then(r=>r.status)`);
    assert.equal(await browserLogin(),200);ok('ui_real_operator_browser_session');
    const uiName='Codex browser Oathra verification';
    const uiClient=(await request('/oauth/register',{method:'POST',data:{client_name:uiName,redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},status:201})).value;
    const uiFlow=authorizationParams('oathra:read oathra:draft',uiClient);lastCallback=null;
    await page.goto(origin+'/oauth/authorize?'+new URLSearchParams(uiFlow.parameters));
    await page.until("!document.querySelector('#authorize-content').hidden",{label:'OAuth browser consent preview'});
    assert(await page.js("document.querySelectorAll('#authorize-scopes li').length===2 && document.querySelector('.connect-boundary').textContent.includes('電話を発信できません')"));
    await page.viewport(390,844);assert(await page.noSidewaysScroll());ok('ui_mobile_consent_scopes_and_call_boundary');
    await page.js("document.querySelector('#authorize-approve').scrollIntoView({block:'center'})");await page.tap('#authorize-approve');
    await page.until(`location.origin===${JSON.stringify(new URL(redirect).origin)} && location.pathname==='/callback'`,{label:'OAuth browser callback'});
    assert(lastCallback?.searchParams.get('code'));const uiAuthorized=await exchangeAuthorization(lastCallback,uiFlow,uiClient);ok('ui_pointer_approval_real_callback_and_token_exchange');
    await page.goto(origin+'/connect');
    await page.until(`!![...document.querySelectorAll('#connections-list article')].find(n=>n.querySelector('h3')?.textContent===${JSON.stringify(uiName)}&&n.textContent.includes('許可中'))`,{label:'authorized browser connection'});
    const index=await page.js(`[...document.querySelectorAll('#connections-list article')].findIndex(n=>n.querySelector('h3')?.textContent===${JSON.stringify(uiName)})+1`);
    const revokeButton=`#connections-list article:nth-of-type(${index}) button`;
    await page.js(`document.querySelector(${JSON.stringify(revokeButton)}).scrollIntoView({block:'center'})`);await page.tap(revokeButton);
    await page.until("document.querySelector('#revoke-dialog').open",{label:'connection revoke dialog'});await page.tap('#revoke-cancel');
    assert((await rpc('tools/list',null,uiAuthorized.tokens.access_token)).result.tools.length);ok('ui_revoke_cancel_preserves_connection');
    await page.tap(revokeButton);await page.until("document.querySelector('#revoke-dialog').open",{label:'connection revoke confirmation'});await page.tap('#revoke-confirm');
    await page.until("document.querySelector('#connections-status').textContent.includes('接続を解除しました')",{label:'connection revocation result'});
    await request('/mcp',{token:uiAuthorized.tokens.access_token,status:401});
    assert(await page.js(`[...document.querySelectorAll('#connections-list article')].find(n=>n.querySelector('h3')?.textContent===${JSON.stringify(uiName)}).textContent.includes('解除済み')`));ok('ui_pointer_revoke_displays_revoked_and_invalidates_token');
    const uiDeny=authorizationParams('oathra:read',uiClient);lastCallback=null;
    await page.goto(origin+'/oauth/authorize?'+new URLSearchParams(uiDeny.parameters));await page.until("!document.querySelector('#authorize-content').hidden",{label:'browser denial preview'});
    await page.js("document.querySelector('#authorize-deny').scrollIntoView({block:'center'})");await page.tap('#authorize-deny');
    await page.until(`location.origin===${JSON.stringify(new URL(redirect).origin)} && location.pathname==='/callback'`,{label:'browser denial callback'});
    assert.equal(lastCallback?.searchParams.get('error'),'access_denied');assert(!lastCallback.searchParams.has('code'));ok('ui_pointer_denial_returns_without_code');
    await page.goto(origin+'/connect');await page.until("!document.querySelector('#connections-panel').hidden",{label:'browser connection list before expiry'});
    assert.equal(await page.js("fetch('/v1/session',{method:'DELETE'}).then(r=>r.status)"),200);
    await page.js("document.querySelector('#connections-refresh').scrollIntoView({block:'center'})");await page.tap('#connections-refresh');
    await page.until("!document.querySelector('#login-panel').hidden && document.querySelector('#connections-panel').hidden && !document.querySelector('#connections-list').children.length",{label:'expired browser session privacy cleanup'});ok('ui_expired_session_hides_private_connections');
    report.uiConsoleErrors=page.pageErrors.length;
    // Browser console errors may contain private server responses; only their count is retained.
    assert.equal(page.pageErrors.filter(e=>!e.startsWith('console.error:')).length,0,'Unexpected browser runtime exception');ok('ui_no_runtime_exceptions');
    await page.close();page=null;
  }else report.blocked.push({name:'browser_ui',reason:'Run with --ui after UI changes are complete.'});
  report.after={rows:business().length,hash:digest(business())};assert.equal(report.after.hash,report.before.hash);ok('existing_business_records_unchanged');
  assert.deepEqual(sourceHashes(),report.sourceHashes,'Reviewed source changed during verification');ok('source_unchanged_during_verification');
  report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.message;process.exitCode=1;}
finally{
  if(page)await page.close();if(app)await app.close();if(callback)await close(callback);rmSync(directory,{recursive:true,force:true});
  report.temporaryDatabaseRemoved=true;report.blocked.push({name:'official_clients_public_call_billing',reason:'Public deployment, Claude Code/ChatGPT OAuth and paid call not exercised.'});
  mkdirSync(resolve(values.output,'..'),{recursive:true});writeFileSync(values.output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,blocked:report.blocked,error:report.error,evidence:values.output}));
}
