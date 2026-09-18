import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Store } from './lib/store.mjs';
import { Service, terminal } from './lib/service.mjs';
import { Channels } from './lib/channels.mjs';
import { Worker, simulate } from './lib/worker.mjs';
import { Followups } from './lib/followups.mjs';
import { Phone } from './lib/phone.mjs';
import { assert, Fault, hash, importProduct, text } from './lib/security.mjs';

function number(env,key,fallback,min,max){const n=Number(env[key]??fallback);assert(Number.isFinite(n)&&n>=min&&n<=max,`invalid_${key}`,500);return n;}
export function configuration(env=process.env){
  const mode=env.OATHRA_MODE??'simulator';assert(['simulator','live'].includes(mode),'invalid_mode',500);
  let users;try{users=JSON.parse(env.OATHRA_USERS_JSON??'[]');}catch{throw new Fault(500,'invalid_users_json');}
  assert(Array.isArray(users)&&users.length>0,'configure_operator_accounts',500);
  for(const u of users)assert(/^[a-zA-Z0-9_-]{1,80}$/.test(u.id)&&/^[a-f0-9]{64}$/.test(u.tokenHash)&&typeof u.team==='string'&&['admin','operator','viewer','agent'].includes(u.role),'invalid_user_configuration',500);
  assert(new Set(users.map(u=>u.id)).size===users.length&&new Set(users.map(u=>u.tokenHash)).size===users.length,'duplicate_user_configuration',500);
  const publicUrl=(env.OATHRA_PUBLIC_URL??'http://localhost:4244').replace(/\/$/,'');
  const parsed=new URL(publicUrl);assert(!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&parsed.pathname==='/'&&(parsed.protocol==='https:'||(mode==='simulator'&&['localhost','127.0.0.1'].includes(parsed.hostname))),'public_url_must_be_https_origin',500);
  const required=['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER','OPENAI_API_KEY','OATHRA_VOICE_MODEL','OATHRA_BUSINESS_NAME','OATHRA_RATE_CEILING_USD','OATHRA_LIVE_POLICY_REVIEWED'];
  const missing=required.filter(k=>!env[k]);
  const liveReady=mode==='live'&&missing.length===0&&env.OATHRA_LIVE_POLICY_REVIEWED==='true'&&parsed.protocol==='https:'&&existsSync(new URL('../../packages/runtime/dist/index.js',import.meta.url));
  return {mode,users,publicUrl,liveReady,missing,callerId:env.TWILIO_PHONE_NUMBER,consentVersion:'2026-09-19-v1',
    dataKey:env.OATHRA_DATA_KEY,dbPath:env.OATHRA_DB??'.oathra/gateway.sqlite',port:number(env,'PORT',4244,0,65535),host:env.HOST??'127.0.0.1',
    maxSeconds:number(env,'OATHRA_MAX_SECONDS',300,30,600),maxCallUsd:number(env,'OATHRA_MAX_CALL_USD',10,0.01,100),dailyCalls:number(env,'OATHRA_DAILY_CALLS',20,1,500),dailyUsd:number(env,'OATHRA_DAILY_USD',30,0.01,1000),
    rateCeilingUsd:number(env,'OATHRA_RATE_CEILING_USD',1,0.001,20),setupFeeUsd:number(env,'OATHRA_SETUP_FEE_USD',0,0,10)};
}
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
async function body(req){
  const parts=[];let size=0;
  for await(const part of req){size+=part.length;assert(size<=262144,'request_too_large',413);parts.push(part);}
  return Buffer.concat(parts);
}
function send(res,status,value,type='application/json; charset=utf-8'){
  res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
    'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  res.end(type.startsWith('application/json')?JSON.stringify(value):value);
}
export async function createGateway(config,options={}){
  const env=options.env??process.env,store=options.store??new Store(config.dbPath,config.dataKey),service=new Service(store,config);
  const followups=new Followups(service,env);
  const channels=options.channels??new Channels(service,env),phone=options.phone??new Phone(service,env);
  const execute=options.execute??(config.mode==='simulator'?simulate:(m,hooks)=>phone.execute(m,hooks));
  const worker=new Worker(service,channels,execute),limits=new Map();
  const server=createServer(async(req,res)=>{
    const requestId=crypto.randomUUID();res.setHeader('x-request-id',requestId);
    try{
      const ip=req.socket.remoteAddress??'local',minute=Math.floor(Date.now()/60000),key=hash(ip)+':'+minute;
      if(limits.size>5000)limits.clear();const count=(limits.get(key)??0)+1;limits.set(key,count);assert(count<=1200,'rate_limited',429);
      const url=new URL(req.url,'http://gateway.local'),path=url.pathname,method=req.method;
      if(method==='GET'&&assets.has(path)){const[file,type]=assets.get(path);return send(res,200,readFileSync(new URL('./public/'+file,import.meta.url)),type);}
      if(method==='GET'&&path==='/healthz')return send(res,200,{ok:true,mode:config.mode});
      if(method==='POST'&&['/hooks/line','/hooks/slack'].includes(path)){
        const raw=await body(req);return send(res,200,channels.receive(path.endsWith('line')?'line':'slack',raw,req.headers));
      }
      if(method==='POST'&&path.startsWith('/hooks/twilio/')){
        const raw=await body(req),params=Object.fromEntries(new URLSearchParams(raw.toString()));
        return send(res,200,phone.callback(path,params,req.headers),'application/xml');
      }
      assert(path.startsWith('/v1/'),'not_found',404);
      const auth=req.headers.authorization??'';assert(auth.startsWith('Bearer '),'unauthorized',401);const u=service.auth(auth.slice(7));
      if(req.headers.origin)assert(req.headers.origin===config.publicUrl,'cross_origin_request_denied',403);
      let data={};
      if(['POST','PATCH'].includes(method)){
        assert(String(req.headers['content-type']).startsWith('application/json'),'json_required',415);
        const raw=await body(req);try{data=JSON.parse(raw.toString()||'{}');}catch{throw new Fault(400,'invalid_json');}
        assert(data&&typeof data==='object'&&!Array.isArray(data),'json_object_required');
      }
      if(method==='GET'&&path==='/v1/bootstrap')return send(res,200,{user:{id:u.id,role:u.role},account:service.account(u),integrations:followups.available(u),followups:store.list('followup',u.id),products:store.list('product',u.id),contacts:store.list('contact',u.id),missions:store.list('mission',u.id).map(({transcript,runtimeResult,...m})=>m),
        configuration:{mode:config.mode,liveReady:config.liveReady,missing:config.missing,consentVersion:config.consentVersion,callerId:config.callerId??'simulator',maxSeconds:config.maxSeconds,maxCallUsd:config.maxCallUsd,publicUrl:config.publicUrl}});
      if(method==='POST'&&path==='/v1/consent')return send(res,200,service.saveConsent(u,data.version));
      if(method==='POST'&&path==='/v1/products/import'){service.write(u);return send(res,200,await importProduct(data.url));}
      if(method==='POST'&&path==='/v1/products')return send(res,201,service.product(u,data));
      if(method==='POST'&&path==='/v1/contacts')return send(res,201,service.contact(u,data));
      if(method==='POST'&&path==='/v1/phone/verify')return send(res,200,await phone.verifyNumber(u,data));
      if(method==='POST'&&path==='/v1/links')return send(res,201,{message:'連携 '+service.linkCode(u),expiresInSeconds:300});
      if(method==='POST'&&path==='/v1/missions/draft')return send(res,201,service.prepare(u,data));
      if(method==='POST'&&path==='/v1/suppressions'){service.write(u);const c=service.own('contact',data.contactId,u);assert(data.acknowledged===true,'suppression_confirmation_required');store.suppress(u.team,c.phone);store.audit(u.id,'contact.suppressed',c.id);return send(res,200,{suppressed:true});}
      if(method==='POST'&&path==='/v1/followups/preview')return send(res,201,followups.preview(u,data.missionId,data));
      const follow=path.match(/^\/v1\/followups\/([a-f0-9-]{36})\/(execute|refresh)$/);
      if(method==='POST'&&follow)return send(res,200,follow[2]==='execute'?await followups.execute(u,follow[1],data,req.headers['idempotency-key']):await followups.refreshCalendar(u,follow[1]));
      const match=path.match(/^\/v1\/missions\/([a-f0-9-]{36})(?:\/(review|start|cancel|events|handoff|reconcile))?$/);
      if(match){
        const[,id,action]=match,m=service.own('mission',id,u);
        if(method==='GET'&&!action)return send(res,200,{...m,transcript:m.transcript??store.events(id,u.id).filter(e=>e.type==='transcript.final').map(e=>({id:e.turnId,source:e.source,text:e.text,t:e.t}))});
        if(method==='PATCH'&&!action)return send(res,200,service.edit(u,id,data));
        if(method==='DELETE'&&!action){service.write(u);assert((terminal(m.status)||m.status==='DRAFT')&&m.status!=='UNKNOWN'&&!m.stopNeedsReconciliation,'stop_and_reconcile_call_before_deletion',409);store.removeMission(m);return send(res,200,{deleted:true});}
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
          let closed=false;const poll=()=>{if(closed)return;for(const e of store.events(id,u.id,seq)){seq=e.seq;res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);}res.write(': keepalive\n\n');};
          poll();const timer=setInterval(poll,2000);res.on('close',()=>{closed=true;clearInterval(timer);});return;
        }
      }
      throw new Fault(404,'not_found');
    }catch(error){if(!res.headersSent)send(res,error.status??500,{error:error.code??'internal_error',requestId});else res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=64;
  if(config.liveReady&&!options.execute)await phone.attach(server);
  return {server,service,store,worker,phone,channels,async close(){await worker.stop();server.closeAllConnections();await new Promise(r=>server.close(r));phone.wss?.close();if(!options.store)store.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const config=configuration(),app=await createGateway(config);
  app.worker.start();app.server.listen(config.port,config.host,()=>console.log(`Oathra Gateway (${config.mode}) listening; use ${config.publicUrl}`));
  const retention=setInterval(()=>app.store.prune(),3600_000);retention.unref();
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearInterval(retention);void app.close().then(()=>process.exit(0));});
}
