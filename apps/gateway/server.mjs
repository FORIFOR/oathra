import { phonePage } from './lib/phone-ui.mjs';
import { grantPhone, phoneGrantDefaults, connectPhoneAgent, agentPhoneConnection, revokePhoneGrant, dispatchPhone, readAgentPhone, cancelAgentPhone } from './lib/agent-phone.mjs';
import { practiceList, practiceRun, practicePlayStart, practicePlayState, practicePlayReply, practicePlayHangup, practiceBrains, practiceRecords, practiceRecord, configurePractice } from './lib/practice.mjs';
import { parseDeskConfig, tokyoDate } from '../../packages/core/dist/index.js';
import { phoneReadiness, phoneRecord, prepareManagedPhone, PHONE_PURPOSE_TEMPLATES,phoneCalendar,PHONE_VOICES} from './lib/phone-service.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Store } from './lib/store.mjs';
import { BrowserSessions } from './lib/browser-session.mjs';
import { Alerts, alertConfiguration } from './lib/alerts.mjs';
import { PublicAccounts } from './lib/public-accounts.mjs';
import { Purchases } from './lib/purchases.mjs';
import { prereleaseConfiguration, prereleaseCallsAvailable } from './lib/prerelease.mjs';
import { McpOAuth } from './lib/mcp-oauth.mjs';
import { salesRpc } from './lib/mcp-sales.mjs';
import { Service, terminal } from './lib/service.mjs';
import { Channels } from './lib/channels.mjs';
import { loadPluginRegistry } from './lib/plugins.mjs';
import { freezeData, jsonData } from '../../sdk/plugin-kit/index.mjs';
import { Worker, simulate } from './lib/worker.mjs';
import { Followups } from './lib/followups.mjs';
import { Phone } from './lib/phone.mjs';
import { billingConfiguration, METERED } from './lib/billing.mjs';
import { assert, Fault, hash, importProduct, text } from './lib/security.mjs';
import { repoUrl } from './lib/paths.mjs';

function number(env,key,fallback,min,max){const n=Number(env[key]??fallback);assert(Number.isFinite(n)&&n>=min&&n<=max,`invalid_${key}`,500);return n;}
const isLoopback=a=>/^(127\.|::1$|::ffff:127\.)/.test(String(a??''));
export function configuration(env=process.env){
  const deployment=env.OATHRA_DEPLOYMENT??'self-hosted';assert(['self-hosted','managed'].includes(deployment),'invalid_deployment',500);
  const billing=billingConfiguration(env);
  const creditsPerCall=deployment==='managed'&&billing.policy!==METERED?Number(env.OATHRA_CREDITS_PER_CALL):0;assert(deployment!=='managed'||billing.policy===METERED||(Number.isSafeInteger(creditsPerCall)&&creditsPerCall>0&&creditsPerCall<=1000000000),'configure_credits_per_call',500);
  const mode=env.OATHRA_MODE??'simulator';assert(['simulator','live'].includes(mode),'invalid_mode',500);
  let users;try{users=JSON.parse(env.OATHRA_USERS_JSON??'[]');}catch{throw new Fault(500,'invalid_users_json');}
  assert(Array.isArray(users)&&users.length>0,'configure_operator_accounts',500);
  for(const u of users)assert(/^[a-zA-Z0-9_-]{1,80}$/.test(u.id)&&/^[a-f0-9]{64}$/.test(u.tokenHash)&&typeof u.team==='string'&&['admin','operator','viewer','agent'].includes(u.role),'invalid_user_configuration',500);
  assert(new Set(users.map(u=>u.id)).size===users.length&&new Set(users.map(u=>u.tokenHash)).size===users.length,'duplicate_user_configuration',500);
  const publicUrl=(env.OATHRA_PUBLIC_URL??'http://localhost:4244').replace(/\/$/,'');
  const parsed=new URL(publicUrl);assert(!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&parsed.pathname==='/'&&(parsed.protocol==='https:'||(mode==='simulator'&&['localhost','127.0.0.1'].includes(parsed.hostname))),'public_url_must_be_https_origin',500);
  const required=['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER','OPENAI_API_KEY','OATHRA_VOICE_MODEL','OATHRA_BUSINESS_NAME','OATHRA_RATE_CEILING_USD','OATHRA_LIVE_POLICY_REVIEWED'];
  const missing=required.filter(k=>k==='OATHRA_LIVE_POLICY_REVIEWED'?env[k]!=='true':!env[k]);
  const liveReady=mode==='live'&&missing.length===0&&env.OATHRA_LIVE_POLICY_REVIEWED==='true'&&parsed.protocol==='https:'&&(!!env.OATHRA_GATEWAY_ROOT||existsSync(new URL('../../packages/runtime/dist/index.js',import.meta.url))); // bundled: the runtime is inside
  // Answering incoming calls is off unless someone is named to receive them; whoever that is pays for them.
  let inbound=null;
  if(env.OATHRA_INBOUND_OWNER){
    assert(users.some(u=>u.id===env.OATHRA_INBOUND_OWNER),'unknown_inbound_owner',500);
    // A restaurant's line takes table bookings against its own ledger; otherwise the AI only takes messages for a person.
    let restaurant=null;
    if(env.OATHRA_RESTAURANT_JSON){try{restaurant=parseDeskConfig(JSON.parse(env.OATHRA_RESTAURANT_JSON))}catch{throw new Fault(500,'configure_restaurant_json')}}
    const name=String(env.OATHRA_INBOUND_NAME??'').trim();assert(restaurant||(name.length>0&&name.length<=40&&!/[\d@<>{}]/.test(name)),'configure_inbound_name',500);
    inbound={owner:env.OATHRA_INBOUND_OWNER,name:restaurant?restaurant.name:name,restaurant,maxSeconds:number(env,'OATHRA_INBOUND_MAX_SECONDS',180,30,600),perCallerPerHour:number(env,'OATHRA_INBOUND_PER_CALLER_PER_HOUR',3,1,60),perHour:number(env,'OATHRA_INBOUND_PER_HOUR',12,1,600)};
  }
  // Metered billing prices one voice model per minute (billing.mjs), so a second engine is only offered under the fixed per-call policy.
  const geminiReady=!!env.GEMINI_API_KEY&&billing.policy!==METERED;
  const voiceEngines=[{id:'gpt-live',label:`GPT-Live (${env.OATHRA_VOICE_MODEL??'gpt-live-1'})`,ready:!!env.OPENAI_API_KEY&&!!env.OATHRA_VOICE_MODEL},{id:'gemini-live',label:`Gemini Live (${env.OATHRA_GEMINI_LIVE_MODEL??'gemini-3.8-live'})`,ready:geminiReady},
    // The acting voice: speech recognition, a text brain and an acting TTS, for phone requests only (not sales calls).
    {id:'character-tts',label:'演技する声 (Gemini TTS)',ready:!!env.DEEPGRAM_API_KEY&&!!env.OPENAI_API_KEY&&!!env.GEMINI_API_KEY&&billing.policy!==METERED}];
  assert(['gpt-live','gemini-live',undefined].includes(env.OATHRA_VOICE_ENGINE),'unsupported_voice_engine',500);
  const defaultVoiceEngine=env.OATHRA_VOICE_ENGINE==='gemini-live'&&geminiReady?'gemini-live':'gpt-live';
  const limits={maxSeconds:number(env,'OATHRA_MAX_SECONDS',300,30,600),maxCallUsd:number(env,'OATHRA_MAX_CALL_USD',10,0.01,100),dailyCalls:number(env,'OATHRA_DAILY_CALLS',20,0,500),dailyUsd:number(env,'OATHRA_DAILY_USD',30,0,1000)};
  const prerelease=prereleaseConfiguration(env,limits);
  if(prerelease.enabled)limits.maxSeconds=prerelease.maxCallSeconds;
  return {deployment,creditsPerCall,billing,mode,users,publicUrl,liveReady,missing,inbound,prerelease,newsAvailable:true,callerId:env.TWILIO_PHONE_NUMBER,businessName:env.OATHRA_BUSINESS_NAME??null,consentVersion:'2026-09-19-v1',voiceEngines,defaultVoiceEngine,geminiLiveModel:env.OATHRA_GEMINI_LIVE_MODEL??'gemini-3.8-live',
    localOpen:env.OATHRA_LOCAL_OPEN==='true',dataKey:env.OATHRA_DATA_KEY,dbPath:env.OATHRA_DB??'.oathra/gateway.sqlite',port:number(env,'PORT',4244,0,65535),host:env.HOST??'127.0.0.1',
    ...limits,
    rateCeilingUsd:number(env,'OATHRA_RATE_CEILING_USD',1,0.001,20),setupFeeUsd:number(env,'OATHRA_SETUP_FEE_USD',0,0,10),
    // Only set this when the gateway is reachable exclusively through a reverse proxy that overwrites X-Forwarded-For.
    trustProxy:env.OATHRA_TRUST_PROXY==='true'};
}
const assets=new Map([['/',['app/index.html','text/html; charset=utf-8']],['/workspace',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']],['/managed-phone.js',['managed-phone.js','text/javascript; charset=utf-8']],['/managed-phone.css',['managed-phone.css','text/css; charset=utf-8']],['/oathra-mark.png',['oathra-mark.png','image/png']],['/oathra-mark-original.png',['oathra-mark-original.png','image/png']],['/app',['app/index.html','text/html; charset=utf-8']],['/app/',['app/index.html','text/html; charset=utf-8']],['/app/app.js',['app/app.js','text/javascript; charset=utf-8']],['/app/style.css',['app/style.css','text/css; charset=utf-8']],['/app/mark.png',['app/mark.png','image/png']]]);
for (const name of ['main','dom','messages','receipt','news','client','contacts','account','bookings']) assets.set(`/phone/${name}.js`,[`phone/${name}.js`,'text/javascript; charset=utf-8']);
for (const path of ['/connect','/connect/','/oauth/authorize']) assets.set(path,['connect/index.html','text/html; charset=utf-8']);
assets.set('/connect/connect.js',['connect/connect.js','text/javascript; charset=utf-8']);
assets.set('/connect/connect.css',['connect/connect.css','text/css; charset=utf-8']);
assets.set('/phone/public-service.js',['phone/public-service.js','text/javascript; charset=utf-8']);
assets.set('/phone/public-service.css',['phone/public-service.css','text/css; charset=utf-8']);
// One short recorded sample per voice, from the fixed voice list only; never a path taken from the request.
// Only recorded samples are served; a voice without one (the 9 added 2026-09-29) has no route.
for (const voice of PHONE_VOICES) if (existsSync(repoUrl(`apps/gateway/public/phone/voices/${voice}.wav`))) assets.set(`/phone/voices/${voice}.wav`,[`phone/voices/${voice}.wav`,'audio/wav']);
/** Behind a reverse proxy every socket belongs to the proxy; without this all clients would share one bucket. */
export function clientIp(req,trustProxy){
  const direct=req.socket?.remoteAddress??'local';if(!trustProxy)return direct;
  const forwarded=String(req.headers['x-forwarded-for']??'').split(',').map(s=>s.trim()).filter(Boolean).pop();
  return forwarded&&forwarded.length<=64?forwarded:direct;
}
/**
 * Separate budgets per client and per kind of request. A flood of page loads or API calls must never make the
 * carrier's opt-out callback, or an operator's "stop this call", answer 429.
 */
export const RATE_LIMITS={hook:6000,control:600,public:600,api:1200};
export function limitClass(method,path){
  if(path.startsWith('/hooks/twilio/')||path==='/webhooks/stripe')return 'hook';
  if(method==='POST'&&(/^\/v1\/missions\/[a-f0-9-]{36}\/(?:cancel|reconcile)$/.test(path)||/^\/v1\/agent\/phone\/calls\/[a-zA-Z0-9_-]+\/cancel$/.test(path)||path==='/v1/suppressions'))return 'control';
  if(method==='GET'&&(['/healthz','/readyz','/v1/public/service'].includes(path)||assets.has(path)))return 'public';
  return 'api';
}
async function body(req,limit=262144){
  const parts=[];let size=0;
  for await(const part of req){size+=part.length;assert(size<=limit,'request_too_large',413);parts.push(part);}
  return Buffer.concat(parts);
}
async function jsonBody(req) {
  assert(String(req.headers['content-type']).startsWith('application/json'),'json_required',415);
  const raw=await body(req);let data;try{data=JSON.parse(raw.toString()||'{}');}catch{throw new Fault(400,'invalid_json');}
  assert(data&&typeof data==='object'&&!Array.isArray(data),'json_object_required');return data;
}
async function oauthForm(req) {
  assert(String(req.headers['content-type']).split(';')[0].trim()==='application/x-www-form-urlencoded','invalid_request');
  const form=new URLSearchParams((await body(req,16384)).toString());
  const result={};
  for(const [key,value]of form){assert(!Object.hasOwn(result,key)&&!['__proto__','prototype','constructor'].includes(key),'invalid_request');result[key]=value;}
  return result;
}
// Safari (iPhone and Mac) plays a voice sample only from a server that answers byte ranges (it asks for bytes=0-1 first).
function sendAsset(req,res,body,type){
  const m=/^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range??''));
  if(!m||(!m[1]&&!m[2]))return send(res,200,body,type,{'accept-ranges':'bytes'});
  const size=body.length,start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2])),end=m[1]&&m[2]?Math.min(Number(m[2]),size-1):size-1;
  if(start>=size||start>end)return send(res,416,'',type,{'content-range':`bytes */${size}`});
  return send(res,206,body.subarray(start,end+1),type,{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${size}`});
}
function send(res,status,value,type='application/json; charset=utf-8',extra={}){
  res.writeHead(status,{...extra,'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
    'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  res.end(type.startsWith('application/json')?JSON.stringify(value):value);
}
export async function createGateway(config,options={}){
  const env=options.env??process.env,store=options.store??new Store(config.dbPath,config.dataKey),service=new Service(store,config);
  const publicAccounts=new PublicAccounts(service,env),purchases=new Purchases(service,env);
  const mcpOAuth=new McpOAuth(service,env);
  const sessions=new BrowserSessions(service);
  // The local app passes its practice AIs and records folder; a deployed gateway has neither (lib/practice.mjs).
  configurePractice(options.practice??{});
  const phone=options.phone??new Phone(service,env);
  const executeCall=options.execute??(config.mode==='simulator'?simulate:(m,hooks)=>phone.execute(m,hooks));
  const registry=options.registry??await loadPluginRegistry(env,{now:()=>store.now(),fetchImpl:options.fetchImpl??fetch,executeCall});
  const callPlugin=env.OATHRA_CALL_PLUGIN??'call';
  assert(config.billing?.policy!==METERED||callPlugin==='call','metered_requires_builtin_call',500);
  assert(registry.get(callPlugin,'capability').manifest.effect==='call','invalid_call_plugin',500);
  config.callPluginIdentity=registry.identity(callPlugin);
  const followups=new Followups(service,env,options.fetchImpl??fetch,registry);
  const channels=options.channels??new Channels(service,env,registry,options.fetchImpl??fetch);
  const execute=(m,hooks)=>{registry.demand(callPlugin,'call:execute');return registry.capability(callPlugin).execute(freezeData(jsonData(m)),{signal:hooks.signal,onEvent:hooks.onEvent,control:hooks.control});};
  const alerts=new Alerts(service,alertConfiguration(env),{fetchImpl:options.fetchImpl??fetch,...(options.resolve?{resolve:options.resolve}:{})});
  const worker=new Worker(service,channels,execute,alerts),limits=new Map();
  const server=createServer(async(req,res)=>{
    const requestId=crypto.randomUUID();res.setHeader('x-request-id',requestId);
    try{
      const url=new URL(req.url,'http://gateway.local'),path=url.pathname,method=req.method;
      const minute=Math.floor(Date.now()/60000),kind=limitClass(method,path),key=`${minute}:${kind}:${hash(clientIp(req,config.trustProxy))}`;
      // Drop finished minutes only: clearing everything would hand every client a fresh budget.
      if(limits.size>5000)for(const k of limits.keys())if(!k.startsWith(minute+':'))limits.delete(k);
      const count=(limits.get(key)??0)+1;limits.set(key,count);assert(count<=RATE_LIMITS[kind],'rate_limited',429);
      if(config.deployment==='managed'&&method==='GET'&&path==='/')return send(res,200,phonePage(),'text/html; charset=utf-8');
      if(method==='GET'&&path==='/sales')return send(res,200,readFileSync(repoUrl('apps/gateway/public/index.html')),'text/html; charset=utf-8');
      const sharedStyle=/^\/phone-style\/(style|style-base|workspace|quiet-cinema|one-page|board)\.css$/.exec(path);
      if(method==='GET'&&sharedStyle)return send(res,200,readFileSync(repoUrl('apps/gateway/public/phone/base/'+sharedStyle[1]+'.css')),'text/css; charset=utf-8');
      if(method==='GET'&&assets.has(path)){const[file,type]=assets.get(path);return sendAsset(req,res,readFileSync(repoUrl('apps/gateway/public/'+file)),type);}
      if(method==='GET'&&path==='/healthz')return send(res,200,{ok:true,mode:config.mode});
      if(method==='GET'&&path==='/v1/public/mcp')return send(res,200,{...mcpOAuth.status(),endpoint:mcpOAuth.status().resource,scopeDescriptions:{'oathra:read':'自分の商品・連絡先・電話の記録を読み取る','oathra:draft':'営業電話の下書きを作成する（発信・送信・購入は不可）'}});
      if(path.startsWith('/.well-known/oauth-')||path.startsWith('/oauth/')&&path!=='/oauth/authorize'){
        assert(mcpOAuth.status().enabled,'mcp_unavailable',503);
        if(req.headers.origin)sessions.sameOrigin(req);
        if(method==='GET'&&['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(path))return send(res,200,mcpOAuth.protectedMetadata());
        if(method==='GET'&&path==='/.well-known/oauth-authorization-server')return send(res,200,mcpOAuth.metadata());
        if(method==='POST'&&path==='/oauth/register'){
          const registrationKey=clientIp(req,config.trustProxy)+':'+Math.floor(store.now()/3600000);
          const n=Number(store.key('mcp-registration-rate',registrationKey)??0);assert(n<10,'rate_limit_exceeded',429);
          store.setKey('mcp-registration-rate',registrationKey,String(n+1),3600000);
          return send(res,201,mcpOAuth.register(await jsonBody(req)));
        }
        if(method==='POST'&&path==='/oauth/token')return send(res,200,mcpOAuth.token(await oauthForm(req),req.headers.authorization));
        if(method==='POST'&&path==='/oauth/revoke'){mcpOAuth.revoke(await oauthForm(req),req.headers.authorization);return send(res,200,{});}
        throw new Fault(404,'not_found');
      }
      if(path==='/mcp'){
        assert(mcpOAuth.status().enabled,'mcp_unavailable',503);
        if(req.headers.origin)sessions.sameOrigin(req);
        const authorization=req.headers.authorization;
        const challenge={'www-authenticate':`Bearer resource_metadata="${mcpOAuth.status().resource.replace(/\/mcp$/,'')}/.well-known/oauth-protected-resource/mcp", scope="oathra:read oathra:draft"`};
        let identity;
        try {assert(typeof authorization==='string'&&authorization.startsWith('Bearer '),'invalid_token',401);identity=mcpOAuth.authenticate(authorization.slice(7));}
        catch {return send(res,401,{error:'invalid_token'},undefined,challenge);}
        if(method!=='POST')return send(res,405,{error:'method_not_allowed'},undefined,{allow:'POST'});
        assert(!req.headers['mcp-protocol-version']||['2025-03-26','2025-06-18','2025-11-25'].includes(req.headers['mcp-protocol-version']),'unsupported_mcp_version');
        const accept=String(req.headers.accept??'');
        assert(accept.includes('application/json')&&accept.includes('text/event-stream'),'mcp_accept_required',406);
        let message;try{message=JSON.parse((await body(req,65536)).toString());}catch(e){if(e instanceof SyntaxError)return send(res,400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});throw e;}
        assert(String(req.headers['content-type']).startsWith('application/json'),'json_required',415);
        // A connection or account may have been revoked while the request body arrived.
        try {identity=mcpOAuth.authenticate(authorization.slice(7));}
        catch {return send(res,401,{error:'invalid_token'},undefined,challenge);}
        const response=salesRpc(service,identity,message);
        if(response.status===202){res.writeHead(202,{'cache-control':'no-store'});return res.end();}
        return send(res,response.status,response.body);
      }
      if(method==='GET'&&path==='/readyz'){
        const lease=store.db.prepare('SELECT holder,expires FROM lease WHERE id=1').get();
        const ready=lease?.holder===worker.holder&&lease.expires>store.now()&&(config.mode!=='live'||config.liveReady);
        return send(res,ready?200:503,{ready:Boolean(ready)});
      }
      if(method==='GET'&&path==='/v1/public/service'){
        const registration=publicAccounts.status(),pricing=await purchases.status();
        const policyUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
        return send(res,200,{
          registration:{...registration,enabled:registration.signupEnabled,recoveryEnabled:registration.passwordResetEnabled},
          purchases:{...pricing,packs:(pricing.packs??[]).map(pack=>({...pack,name:pack.name??pack.id,unitAmount:pack.amount}))},
          policies:{termsUrl:policyUrl(env.OATHRA_TERMS_URL),privacyUrl:policyUrl(env.OATHRA_PRIVACY_URL),commerceUrl:policyUrl(env.OATHRA_COMMERCE_URL),supportUrl:policyUrl(env.OATHRA_SUPPORT_URL)},
          phoneReady:config.mode==='live'&&config.liveReady&&prereleaseCallsAvailable(config),
          prerelease:config.prerelease??{enabled:false},
        });
      }
      if(method==='POST'&&path==='/webhooks/stripe')return send(res,200,await purchases.webhook(await body(req,1_000_000),req.headers['stripe-signature']));
      const channelHook=path.match(/^\/hooks\/(?:channels\/)?([a-z][a-z0-9-]{0,47})$/);
      if(method==='POST'&&channelHook){
        assert(channels.has?.(channelHook[1]),'channel_not_enabled',404);
        const raw=await body(req);return send(res,200,channels.receive(channelHook[1],raw,req.headers));
      }
      if(method==='POST'&&path.startsWith('/hooks/twilio/')){
        const raw=await body(req),params=Object.fromEntries(new URLSearchParams(raw.toString()));
        return send(res,200,phone.callback(path,params,req.headers),'application/xml');
      }
      assert(path.startsWith('/v1/'),'not_found',404);
      if(method==='POST'&&['/v1/auth/register','/v1/auth/verify','/v1/auth/forgot','/v1/auth/reset'].includes(path)){
        sessions.sameOrigin(req);
        const data=await jsonBody(req),ip=clientIp(req,config.trustProxy);
        if(path.endsWith('/register'))return send(res,202,await publicAccounts.requestSignup(data,ip));
        if(path.endsWith('/forgot'))return send(res,202,await publicAccounts.requestReset(data,ip));
        const verified=path.endsWith('/verify')?await publicAccounts.verifySignup(data,ip):await publicAccounts.reset(data,ip);
        sessions.create(req,res,verified.user,verified.version);return send(res,200,{signedIn:true,expiresInSeconds:8*3600});
      }
      if(method==='POST'&&['/v1/auth/login','/v1/auth/setup'].includes(path)){
        sessions.sameOrigin(req);
        const data=await jsonBody(req),ip=clientIp(req,config.trustProxy);
        const verified=path.endsWith('/setup')?await service.passwords.enroll(data,ip):await service.passwords.authenticate(data,ip);
        sessions.create(req,res,verified.user,verified.version);return send(res,200,{signedIn:true,expiresInSeconds:8*3600});
      }
      if(path==='/v1/session'&&method==='DELETE'){sessions.logout(req,res);return send(res,200,{signedOut:true});}
      // Browser consent and connection management never accept a model's Bearer token or local-open bypass.
      if(path.startsWith('/v1/mcp/')){
        assert(req.headers.authorization===undefined,'browser_session_required',403);
        let owner=sessions.authenticate(req);
        if(req.headers['x-oathra-account'])assert(req.headers['x-oathra-account']===owner.id,'session_account_changed',409);
        const input=method==='POST'?await jsonBody(req):{};
        if(method==='POST')owner=sessions.authenticate(req);
        if(method==='GET'&&path==='/v1/mcp/connections')return send(res,200,{connections:mcpOAuth.connections(owner)});
        if(method==='POST'&&path==='/v1/mcp/authorize/preview')return send(res,200,mcpOAuth.begin(input.parameters,owner));
        if(method==='POST'&&path==='/v1/mcp/authorize/decision')return send(res,200,mcpOAuth.approve(owner,input));
        const revoke=path.match(/^\/v1\/mcp\/connections\/([a-f0-9-]{36})\/revoke$/);
        if(method==='POST'&&revoke)return send(res,200,mcpOAuth.revokeConnection(owner,revoke[1]));
        throw new Fault(404,'not_found');
      }
      const auth=req.headers.authorization;
      if(auth!==undefined)assert(auth.startsWith('Bearer '),'unauthorized',401);
      // Local practice without signing in (OATHRA_LOCAL_OPEN=true): only in practice mode, only from this machine to a
      // localhost address, only with no credentials at all. Never on a live server or a public address.
      const localOpen=!auth&&config.localOpen&&config.mode==='simulator'&&isLoopback(req.socket.remoteAddress)&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host??''))&&!/(?:^|;\s*)(?:__Host-)?oathra_session=/.test(String(req.headers.cookie??''));
      if(localOpen&&!['GET','HEAD'].includes(method))sessions.sameOrigin(req);
      const u=auth!==undefined?service.auth(auth.slice(7)):localOpen?config.users.find(x=>x.role==='admin')??config.users[0]:sessions.authenticate(req);
      if(!auth&&req.headers['x-oathra-account'])assert(req.headers['x-oathra-account']===u.id,'session_account_changed',409);
      if(req.headers.origin)sessions.sameOrigin(req); // publicUrl, or the local app's LAN/tunnel pages (config.origins)
      const data=['POST','PATCH'].includes(method)?await jsonBody(req):{};
      if(method==='GET'&&path==='/v1/credits/packs'){
        const pricing=await purchases.status();
        return send(res,200,{...pricing,packs:(pricing.packs??[]).map(pack=>({...pack,name:pack.name??pack.id,unitAmount:pack.amount}))});
      }
      if(method==='POST'&&path==='/v1/credits/checkout'){
        const order=await purchases.checkout(u,data,req.headers['idempotency-key']);
        return send(res,200,{...order,url:order.checkoutUrl??null,orderId:order.id});
      }
      const publicOrder=order=>({...order,unitAmount:order.amount,packName:order.packName??order.packId});
      if(method==='GET'&&path==='/v1/credits/purchases')return send(res,200,{purchases:purchases.history(u).map(publicOrder)});
      const purchaseReconcile=path.match(/^\/v1\/credits\/purchases\/([a-f0-9-]{36})\/reconcile$/);
      if(method==='POST'&&purchaseReconcile)return send(res,200,publicOrder(await purchases.reconcile(u,purchaseReconcile[1])));
      if(path==='/v1/phone/grants/defaults'&&method==='GET')return send(res,200,phoneGrantDefaults(service,u));
      if(path==='/v1/phone/connections'&&method==='POST')return send(res,201,connectPhoneAgent(service,u,data,req.headers['idempotency-key']));
      if(path==='/v1/phone/grants'&&method==='POST')return send(res,201,grantPhone(service,u,data));
      if(path==='/v1/phone/grants'&&method==='GET'){service.write(u);return send(res,200,store.all('phone-grant',u.id));}
      const revokeGrant=path.match(/^\/v1\/phone\/grants\/([a-f0-9-]{36})\/revoke$/);
      if(revokeGrant&&method==='POST')return send(res,200,revokePhoneGrant(service,u,revokeGrant[1]));
      if(path.startsWith('/v1/agent/phone/')){
        assert(auth?.startsWith('Bearer '),'agent_bearer_required',401);
        const connection=path.match(/^\/v1\/agent\/phone\/grants\/([a-f0-9-]{36})$/);
        if(connection&&method==='GET')return send(res,200,agentPhoneConnection(service,u,connection[1]));
        if(path==='/v1/agent/phone/calls'&&method==='POST'){
          try{return send(res,202,dispatchPhone(service,u,data,req.headers['idempotency-key']));}
          catch(e){if(e.name==='ZodError')throw new Fault(400,'invalid_phone_request');throw e;}
        }
        const call=path.match(/^\/v1\/agent\/phone\/calls\/([a-zA-Z0-9_-]{8,128})(\/cancel)?$/);
        if(call&&method==='GET'&&!call[2])return send(res,200,readAgentPhone(service,u,call[1]));
        if(call&&method==='POST'&&call[2]){
          const result=cancelAgentPhone(service,u,call[1]);if(worker.active?.id===result.missionId)worker.active.abort.abort();return send(res,200,result);
        }
        throw new Fault(404,'not_found');
      }
      // A signed-in person sets up (or resets) email login for their own account: the code opens the setup form.
      if(path==='/v1/account/password-link'&&method==='POST'){service.write(u);const link=service.passwords.issue(u.id,{reset:service.passwords.profile(u.id).passwordLogin});return send(res,200,{code:new URL(link.url).hash.slice(7),expiresInSeconds:link.expiresInSeconds});}
      if(path==='/v1/auth/password'&&method==='POST'){
        sessions.sameOrigin(req);const version=await service.passwords.change(u,data,clientIp(req,config.trustProxy));
        sessions.create(req,res,u,version);return send(res,200,{changed:true});
      }
      if(path==='/v1/session'&&method==='POST'){assert(auth?.startsWith('Bearer '),'bearer_required',401);sessions.create(req,res,u);return send(res,200,{signedIn:true,expiresInSeconds:8*3600});}
      if(method==='GET'&&path==='/v1/bootstrap')return send(res,200,{user:{id:u.id,role:u.role},login:service.passwords.profile(u.id),account:service.account(u),credits:{enabled:service.credits.enabled,...service.credits.balance(u.id),quote:service.credits.quote(config.mode)},integrations:followups.available(u),plugins:registry.list(),followups:store.list('followup',u.id),products:store.list('product',u.id),contacts:store.list('contact',u.id),missions:store.list('mission',u.id).filter(m=>m.direction!=='inbound').map(({transcript,runtimeResult,...m})=>({...m,creditState:service.credits.status(m),creditUsage:service.credits.usage(m)})),
        ...(u.role==='admin'?{failedJobs:store.failedJobs()}:{}),
        // Lets the page hide what cannot work here instead of offering it and failing.
        available:{phoneVerification:Boolean(env.TWILIO_VERIFY_SERVICE_SID&&env.TWILIO_AUTH_TOKEN)},
        configuration:{mode:config.mode,liveReady:config.liveReady,missing:config.missing,consentVersion:config.consentVersion,callerId:config.callerId??'simulator',maxSeconds:config.maxSeconds,maxCallUsd:config.maxCallUsd,publicUrl:config.publicUrl,prerelease:config.prerelease??{enabled:false},voiceEngines:(config.voiceEngines??[]).map(({id,label,ready})=>({id,label,ready})),inbound:config.inbound?{owner:config.inbound.owner===u.id,restaurant:Boolean(config.inbound.restaurant)}:null}});
      if(method==='GET'&&path==='/v1/phone/status')return send(res,200,phoneReadiness(service,config,u));
      if(method==='GET'&&path==='/v1/phone/templates')return send(res,200,PHONE_PURPOSE_TEMPLATES);
      if(method==='GET'&&path==='/v1/phone/history')return send(res,200,store.list('mission',u.id).filter(m=>m.kind==='phone-request').map(m=>phoneRecord(service,m)));
      // The restaurant's ledger, as the desk wrote it. The caller's number stays in the call record, not here.
      if(method==='GET'&&path==='/v1/phone/bookings'){
        const desk=config.inbound?.owner===u.id?config.inbound.restaurant:null,today=tokyoDate(store.now());
        return send(res,200,{restaurant:desk?{name:desk.name,slots:desk.slots,maxParty:desk.maxParty,closedDates:desk.closedDates??[],closedWeekdays:desk.closedWeekdays??[]}:null,today,
          bookings:desk?store.all('table-booking',u.id).filter(b=>b.date>=today).map(({phone,owner,team,...b})=>b).sort((a,b)=>(a.date+a.time+a.createdAt).localeCompare(b.date+b.time+b.createdAt)):[]});
      }
      if(method==='POST'&&path==='/v1/phone/draft') {
        let m;try {m=prepareManagedPhone(service,u,data);}catch(e){if(e.name==='ZodError')throw new Fault(400,'invalid_phone_request');throw e;}
        return send(res,201,{...service.review(u,m.id),readiness:phoneReadiness(service,config,u),consentVersion:config.consentVersion});
      }
      const phoneCalendarRoute=path.match(/^\/v1\/phone\/calls\/([a-f0-9-]{36})\/calendar\.ics$/);
      if(method==='GET'&&phoneCalendarRoute){
        const m=service.own('mission',phoneCalendarRoute[1],u);assert(m.kind==='phone-request','not_found',404);
        const ics=phoneCalendar(service,m);assert(ics,'call_memo_has_no_date_and_time',409);
        res.setHeader('content-disposition','attachment; filename="oathra-phone-memo.ics"');return send(res,200,ics,'text/calendar; charset=utf-8');
      }
      const phoneRecordRoute=path.match(/^\/v1\/phone\/calls\/([a-f0-9-]{36})$/);
      if(method==='GET'&&phoneRecordRoute){const m=service.own('mission',phoneRecordRoute[1],u);assert(m.kind==='phone-request','not_found',404);return send(res,200,phoneRecord(service,m));}
      if(method==='GET'&&path==='/v1/credits')return send(res,200,{enabled:service.credits.enabled,...service.credits.balance(u.id),quote:service.credits.quote(config.mode)});
      if(method==='GET'&&path==='/v1/credits/ledger')return send(res,200,{entries:service.credits.history(u.id,Number(url.searchParams.get('after')??0))});
      // Administrators act on any owner's call here; the owner-scoped routes below would answer 404.
      const adminCall=path.match(/^\/v1\/admin\/missions\/([a-f0-9-]{36})\/(billing-waive|credits-force-release)$/);
      if(method==='POST'&&adminCall){
        assert(u.role==='admin','administrator_required',403);assert(data.acknowledged===true,'explicit_waiver_required',403);
        const target=store.get('mission',adminCall[1]);assert(target,'not_found',404);
        return send(res,200,adminCall[2]==='billing-waive'?service.credits.waive(u,target,data.reason):service.credits.forceRelease(u,target.id,data.reason,data.carrierChecked));
      }
      if(method==='POST'&&path==='/v1/admin/credits/grants')return send(res,200,service.credits.grant(u,data.owner,data.amount,req.headers['idempotency-key'],data.reason));
      if(method==='GET'&&path==='/v1/audit'){
        assert(u.role==='admin','administrator_required',403);
        const after=Number(url.searchParams.get('after')??0),limit=Number(url.searchParams.get('limit')??200);
        assert(Number.isSafeInteger(after)&&after>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=500,'invalid_audit_cursor');
        return send(res,200,{entries:store.audits({after,limit})});
      }
      if(method==='GET'&&path==='/v1/plugins'){assert(u.role==='admin','administrator_required',403);return send(res,200,{apiVersion:1,plugins:registry.list()});}
      if(method==='POST'&&path==='/v1/consent')return send(res,200,service.saveConsent(u,data.version));
      if(method==='POST'&&path==='/v1/account/caller-name')return send(res,200,service.saveCallerName(u,data.callerName));
      if(method==='POST'&&path==='/v1/account/inbound')return send(res,200,service.saveInbound(u,data));
      if(method==='POST'&&path==='/v1/account/monthly-cap')return send(res,200,service.saveMonthlyCap(u,data.capUsd));
      if(method==='GET'&&path==='/v1/account/month')return send(res,200,service.monthUsage(u));
      if(method==='POST'&&path==='/v1/products/import'){service.write(u);return send(res,200,await importProduct(data.url));}
      if(method==='POST'&&path==='/v1/products')return send(res,201,service.product(u,data));
      if(method==='POST'&&path==='/v1/contacts')return send(res,201,service.contact(u,data,req.headers['idempotency-key']));
      if(method==='GET'&&path==='/v1/contacts')return send(res,200,store.list('contact',u.id));
      const contactPath=path.match(/^\/v1\/contacts\/([a-f0-9-]{36})$/);
      if(method==='DELETE'&&contactPath)return send(res,200,service.removeContact(u,contactPath[1]));
      if(method==='POST'&&path==='/v1/phone/verify')return send(res,200,await phone.verifyNumber(u,data));
      if(method==='POST'&&path==='/v1/links')return send(res,201,{message:'連携 '+service.linkCode(u),expiresInSeconds:300});
      if(method==='POST'&&path==='/v1/missions/draft')return send(res,201,service.prepare(u,data));
      // Practice with the built-in characters (lib/practice.mjs): nothing dials and nothing is charged.
      if(method==='GET'&&path==='/v1/practice/scenarios')return send(res,200,await practiceList());
      if(method==='GET'&&path==='/v1/practice/brains')return send(res,200,practiceBrains());
      if(method==='POST'&&path==='/v1/practice/run')return send(res,200,await practiceRun(String(data.scenario??''),data.brain===undefined?undefined:String(data.brain)));
      if(method==='GET'&&path==='/v1/practice/records')return send(res,200,await practiceRecords());
      const recordPath=/^\/v1\/practice\/records\/([A-Za-z0-9_-]{1,80})$/.exec(path);
      if(recordPath&&method==='GET')return send(res,200,await practiceRecord(recordPath[1]));
      // 自分が相手役: the user answers as the shop in text; the scripted agent calls them. Held in memory, per user.
      if(method==='POST'&&path==='/v1/practice/play')return send(res,201,await practicePlayStart(u.id,String(data.scenario??''),data.brain===undefined?undefined:String(data.brain)));
      const playPath=/^\/v1\/practice\/play\/(play_[a-z0-9]{6,20})(?:\/(reply|hangup))?$/.exec(path);
      if(playPath&&method==='GET'&&!playPath[2])return send(res,200,practicePlayState(u.id,playPath[1]));
      if(playPath&&method==='POST'&&playPath[2]==='reply')return send(res,200,practicePlayReply(u.id,playPath[1],data.text));
      if(playPath&&method==='POST'&&playPath[2]==='hangup')return send(res,200,practicePlayHangup(u.id,playPath[1]));
      if(method==='POST'&&path==='/v1/suppressions'){service.write(u);const c=service.own('contact',data.contactId,u);assert(data.acknowledged===true,'suppression_confirmation_required');store.suppress(u.team,c.phone,'manual');store.audit(u.id,'contact.suppressed',c.id);return send(res,200,{suppressed:true});}
      // Undoing a suppression is an administrator's decision with a written reason; the person's own key press stays.
      if(method==='POST'&&path==='/v1/suppressions/release'){assert(u.role==='admin','admin_required',403);const c=service.own('contact',data.contactId,u),reason=typeof data.reason==='string'?data.reason.trim():'';assert(data.acknowledged===true,'suppression_confirmation_required');assert(reason.length>=5&&reason.length<=300,'release_reason_required');
        const outcome=store.unsuppress(u.team,c.phone);assert(outcome!=='opted_out_by_recipient','recipient_opted_out',403);assert(outcome!=='not_suppressed','not_suppressed',409);
        store.audit(u.id,'contact.suppression_released',c.id,{contact:c.id,target:store.phoneRef(c.phone),reason,outcome});return send(res,200,{suppressed:outcome!=='released',outcome});}
      if(method==='POST'&&path==='/v1/followups/preview')return send(res,201,followups.preview(u,data.missionId,data));
      const follow=path.match(/^\/v1\/followups\/([a-f0-9-]{36})\/(execute|refresh|not-delivered)$/);
      if(method==='POST'&&follow&&follow[2]==='not-delivered')return send(res,200,followups.markNotDelivered(u,follow[1],data.acknowledged));
      if(method==='POST'&&follow)return send(res,200,follow[2]==='execute'?await followups.execute(u,follow[1],data,req.headers['idempotency-key']):await followups.refreshCalendar(u,follow[1]));
      const match=path.match(/^\/v1\/missions\/([a-f0-9-]{36})(?:\/(review|start|cancel|events|handoff|reconcile|billing-waive))?$/);
      if(match){
        const[,id,action]=match,m=service.own('mission',id,u);
        if(method==='POST'&&action==='billing-waive'){assert(data.acknowledged===true,'explicit_waiver_required',403);return send(res,200,service.credits.waive(u,m,data.reason));}
        if(method==='GET'&&!action)return send(res,200,{...m,creditState:service.credits.status(m),creditUsage:service.credits.usage(m),transcript:m.transcript??store.events(id,u.id).filter(e=>e.type==='transcript.final').map(e=>({id:e.turnId,source:e.source,text:e.text,t:e.t}))});
        if(method==='PATCH'&&!action)return send(res,200,service.edit(u,id,data));
        if(method==='DELETE'&&!action){service.write(u);assert((terminal(m.status)||m.status==='DRAFT')&&m.status!=='UNKNOWN'&&!m.stopNeedsReconciliation,'stop_and_reconcile_call_before_deletion',409);assert(service.credits.status(m)!=='held','settle_credits_before_deletion',409);store.removeMission(m);return send(res,200,{deleted:true});}
        if(method==='POST'&&action==='review')return send(res,200,service.review(u,id));
        if(method==='POST'&&action==='start')return send(res,202,service.start(u,data.approvalToken,req.headers['idempotency-key'],data.acknowledged,id));
        if(method==='POST'&&action==='cancel'){
          const cancelled=service.cancel(u,id); if(worker.active?.id===id)worker.active.abort.abort(); if(m.status.startsWith('HANDOFF_'))await phone.reconcile(u,id,true);return send(res,200,cancelled);
        }
        if(method==='POST'&&action==='handoff'){
          service.write(u);assert(data.acknowledged===true,'handoff_confirmation_required');assert(worker.active?.id===id&&typeof worker.active.control.handoff==='function','handoff_not_available',409);
          return send(res,202,await worker.active.control.handoff());
        }
        if(method==='POST'&&action==='reconcile'){assert(data.acknowledged===true,'reconciliation_confirmation_required');return send(res,200,await phone.reconcile(u,id,data.stop===true));}
        if(method==='GET'&&action==='events'){
          let seq=Number(req.headers['last-event-id']??url.searchParams.get('after')??0);assert(Number.isSafeInteger(seq)&&seq>=0,'invalid_event_cursor');
          res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no','x-content-type-options':'nosniff'});
          let closed=false;
          const poll=()=>{
            if(closed)return;
            // A stream is an ongoing read: logout, credential rotation and expiry revoke it too.
            try {
              const current=auth!==undefined?service.auth(auth.slice(7)):sessions.authenticate(req);
              assert(current.id===u.id,'unauthorized',401);
              service.own('mission',id,current);
            } catch { closed=true;res.end();return; }
            for(const e of store.events(id,u.id,seq)){seq=e.seq;res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);}
            res.write(': keepalive\n\n');
          };
          const timer=setInterval(poll,2000);res.on('close',()=>{closed=true;clearInterval(timer);});poll();return;
        }
      }
      throw new Fault(404,'not_found');
    }catch(error){
      // 4xx are the caller's problem and would be noise; an unexplained 500 used to leave no trace at all.
      if((error.status??500)>=500)console.error(JSON.stringify({level:'error',event:'request.failed',requestId,code:error.code??error.name??'internal_error',status:error.status??500,at:new Date().toISOString()}));
      if(!res.headersSent)send(res,error.status??500,{error:error.code??'internal_error',requestId});else res.end();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=64;
  if(config.liveReady&&!options.execute){await phone.attach(server);if(config.billing?.policy===METERED)phone.startBilling();}
  return {server,service,store,worker,phone,channels,registry,async close(){await worker.stop();await phone.stopBilling?.();server.closeAllConnections();await new Promise(r=>server.close(r));phone.wss?.close();await registry.close();if(!options.store)store.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const config=configuration(),app=await createGateway(config);
  app.worker.start();app.server.listen(config.port,config.host,()=>console.log(`Oathra Gateway (${config.mode}) listening; use ${config.publicUrl}`));
  const retentionDays=number(process.env,'OATHRA_RETENTION_DAYS',30,1,3650);
  const retention=setInterval(()=>{try{app.store.prune(retentionDays);}catch(e){console.error(JSON.stringify({level:'error',event:'retention.failed',code:e.code??e.name,at:new Date().toISOString()}));}},3600_000);retention.unref();
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearInterval(retention);void app.close().then(()=>process.exit(0));});
}
