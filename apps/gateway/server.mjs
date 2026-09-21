import { phonePage } from './lib/phone-ui.mjs';
import { phoneReadiness, phoneRecord, prepareManagedPhone, PHONE_PURPOSE_TEMPLATES,phoneCalendar} from './lib/phone-service.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Store } from './lib/store.mjs';
import { BrowserSessions } from './lib/browser-session.mjs';
import { Service, terminal } from './lib/service.mjs';
import { Channels } from './lib/channels.mjs';
import { loadPluginRegistry } from './lib/plugins.mjs';
import { freezeData, jsonData } from '../../sdk/plugin-kit/index.mjs';
import { Worker, simulate } from './lib/worker.mjs';
import { Followups } from './lib/followups.mjs';
import { Phone } from './lib/phone.mjs';
import { billingConfiguration, METERED } from './lib/billing.mjs';
import { assert, Fault, hash, importProduct, text } from './lib/security.mjs';

function number(env,key,fallback,min,max){const n=Number(env[key]??fallback);assert(Number.isFinite(n)&&n>=min&&n<=max,`invalid_${key}`,500);return n;}
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
  const liveReady=mode==='live'&&missing.length===0&&env.OATHRA_LIVE_POLICY_REVIEWED==='true'&&parsed.protocol==='https:'&&existsSync(new URL('../../packages/runtime/dist/index.js',import.meta.url));
  return {deployment,creditsPerCall,billing,mode,users,publicUrl,liveReady,missing,newsAvailable:true,callerId:env.TWILIO_PHONE_NUMBER,consentVersion:'2026-09-19-v1',
    dataKey:env.OATHRA_DATA_KEY,dbPath:env.OATHRA_DB??'.oathra/gateway.sqlite',port:number(env,'PORT',4244,0,65535),host:env.HOST??'127.0.0.1',
    maxSeconds:number(env,'OATHRA_MAX_SECONDS',300,30,600),maxCallUsd:number(env,'OATHRA_MAX_CALL_USD',10,0.01,100),dailyCalls:number(env,'OATHRA_DAILY_CALLS',20,0,500),dailyUsd:number(env,'OATHRA_DAILY_USD',30,0,1000),
    rateCeilingUsd:number(env,'OATHRA_RATE_CEILING_USD',1,0.001,20),setupFeeUsd:number(env,'OATHRA_SETUP_FEE_USD',0,0,10),
    // Only set this when the gateway is reachable exclusively through a reverse proxy that overwrites X-Forwarded-For.
    trustProxy:env.OATHRA_TRUST_PROXY==='true'};
}
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']],['/managed-phone.js',['managed-phone.js','text/javascript; charset=utf-8']],['/managed-phone.css',['managed-phone.css','text/css; charset=utf-8']]]);
for (const name of ['main','dom','messages','receipt','news','client','contacts','account']) assets.set(`/phone/${name}.js`,[`phone/${name}.js`,'text/javascript; charset=utf-8']);
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
  if(path.startsWith('/hooks/twilio/'))return 'hook';
  if(method==='POST'&&(/^\/v1\/missions\/[a-f0-9-]{36}\/(?:cancel|reconcile)$/.test(path)||path==='/v1/suppressions'))return 'control';
  if(method==='GET'&&(path==='/healthz'||assets.has(path)))return 'public';
  return 'api';
}
async function body(req){
  const parts=[];let size=0;
  for await(const part of req){size+=part.length;assert(size<=262144,'request_too_large',413);parts.push(part);}
  return Buffer.concat(parts);
}
async function jsonBody(req) {
  assert(String(req.headers['content-type']).startsWith('application/json'),'json_required',415);
  const raw=await body(req);let data;try{data=JSON.parse(raw.toString()||'{}');}catch{throw new Fault(400,'invalid_json');}
  assert(data&&typeof data==='object'&&!Array.isArray(data),'json_object_required');return data;
}
function send(res,status,value,type='application/json; charset=utf-8'){
  res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
    'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  res.end(type.startsWith('application/json')?JSON.stringify(value):value);
}
export async function createGateway(config,options={}){
  const env=options.env??process.env,store=options.store??new Store(config.dbPath,config.dataKey),service=new Service(store,config);
  const sessions=new BrowserSessions(service);
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
  const worker=new Worker(service,channels,execute),limits=new Map();
  const server=createServer(async(req,res)=>{
    const requestId=crypto.randomUUID();res.setHeader('x-request-id',requestId);
    try{
      const url=new URL(req.url,'http://gateway.local'),path=url.pathname,method=req.method;
      const minute=Math.floor(Date.now()/60000),kind=limitClass(method,path),key=`${minute}:${kind}:${hash(clientIp(req,config.trustProxy))}`;
      // Drop finished minutes only: clearing everything would hand every client a fresh budget.
      if(limits.size>5000)for(const k of limits.keys())if(!k.startsWith(minute+':'))limits.delete(k);
      const count=(limits.get(key)??0)+1;limits.set(key,count);assert(count<=RATE_LIMITS[kind],'rate_limited',429);
      if(config.deployment==='managed'&&method==='GET'&&path==='/')return send(res,200,phonePage(),'text/html; charset=utf-8');
      if(method==='GET'&&path==='/sales')return send(res,200,readFileSync(new URL('./public/index.html',import.meta.url)),'text/html; charset=utf-8');
      const sharedStyle=/^\/phone-style\/(style|style-base|workspace|quiet-cinema|one-page|board)\.css$/.exec(path);
      if(method==='GET'&&sharedStyle)return send(res,200,readFileSync(new URL('../arena/public/'+sharedStyle[1]+'.css',import.meta.url)),'text/css; charset=utf-8');
      if(method==='GET'&&assets.has(path)){const[file,type]=assets.get(path);return send(res,200,readFileSync(new URL('./public/'+file,import.meta.url)),type);}
      if(method==='GET'&&path==='/healthz')return send(res,200,{ok:true,mode:config.mode});
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
      if(method==='POST'&&['/v1/auth/login','/v1/auth/setup'].includes(path)){
        sessions.sameOrigin(req);
        const data=await jsonBody(req),ip=clientIp(req,config.trustProxy);
        const verified=path.endsWith('/setup')?await service.passwords.enroll(data,ip):await service.passwords.authenticate(data,ip);
        sessions.create(req,res,verified.user,verified.version);return send(res,200,{signedIn:true,expiresInSeconds:8*3600});
      }
      if(path==='/v1/session'&&method==='DELETE'){sessions.logout(req,res);return send(res,200,{signedOut:true});}
      const auth=req.headers.authorization;
      if(auth!==undefined)assert(auth.startsWith('Bearer '),'unauthorized',401);
      const u=auth!==undefined?service.auth(auth.slice(7)):sessions.authenticate(req);
      if(!auth&&req.headers['x-oathra-account'])assert(req.headers['x-oathra-account']===u.id,'session_account_changed',409);
      if(req.headers.origin)assert(req.headers.origin===config.publicUrl,'cross_origin_request_denied',403);
      const data=['POST','PATCH'].includes(method)?await jsonBody(req):{};
      if(path==='/v1/auth/password'&&method==='POST'){
        sessions.sameOrigin(req);const version=await service.passwords.change(u,data,clientIp(req,config.trustProxy));
        sessions.create(req,res,u,version);return send(res,200,{changed:true});
      }
      if(path==='/v1/session'&&method==='POST'){assert(auth?.startsWith('Bearer '),'bearer_required',401);sessions.create(req,res,u);return send(res,200,{signedIn:true,expiresInSeconds:8*3600});}
      if(method==='GET'&&path==='/v1/bootstrap')return send(res,200,{user:{id:u.id,role:u.role},login:service.passwords.profile(u.id),account:service.account(u),credits:{enabled:service.credits.enabled,...service.credits.balance(u.id),quote:service.credits.quote(config.mode)},integrations:followups.available(u),plugins:registry.list(),followups:store.list('followup',u.id),products:store.list('product',u.id),contacts:store.list('contact',u.id),missions:store.list('mission',u.id).filter(m=>m.kind!=='phone-request').map(({transcript,runtimeResult,...m})=>({...m,creditState:service.credits.status(m),creditUsage:service.credits.usage(m)})),
        ...(u.role==='admin'?{failedJobs:store.failedJobs()}:{}),
        // Lets the page hide what cannot work here instead of offering it and failing.
        available:{phoneVerification:Boolean(env.TWILIO_VERIFY_SERVICE_SID&&env.TWILIO_AUTH_TOKEN)},
        configuration:{mode:config.mode,liveReady:config.liveReady,missing:config.missing,consentVersion:config.consentVersion,callerId:config.callerId??'simulator',maxSeconds:config.maxSeconds,maxCallUsd:config.maxCallUsd,publicUrl:config.publicUrl}});
      if(method==='GET'&&path==='/v1/phone/status')return send(res,200,phoneReadiness(service,config,u));
      if(method==='GET'&&path==='/v1/phone/templates')return send(res,200,PHONE_PURPOSE_TEMPLATES);
      if(method==='GET'&&path==='/v1/phone/history')return send(res,200,store.list('mission',u.id).filter(m=>m.kind==='phone-request').map(m=>phoneRecord(service,m)));
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
      if(method==='POST'&&path==='/v1/products/import'){service.write(u);return send(res,200,await importProduct(data.url));}
      if(method==='POST'&&path==='/v1/products')return send(res,201,service.product(u,data));
      if(method==='POST'&&path==='/v1/contacts')return send(res,201,service.contact(u,data,req.headers['idempotency-key']));
      if(method==='GET'&&path==='/v1/contacts')return send(res,200,store.list('contact',u.id));
      if(method==='POST'&&path==='/v1/phone/verify')return send(res,200,await phone.verifyNumber(u,data));
      if(method==='POST'&&path==='/v1/links')return send(res,201,{message:'連携 '+service.linkCode(u),expiresInSeconds:300});
      if(method==='POST'&&path==='/v1/missions/draft')return send(res,201,service.prepare(u,data));
      if(method==='POST'&&path==='/v1/suppressions'){service.write(u);const c=service.own('contact',data.contactId,u);assert(data.acknowledged===true,'suppression_confirmation_required');store.suppress(u.team,c.phone);store.audit(u.id,'contact.suppressed',c.id);return send(res,200,{suppressed:true});}
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
