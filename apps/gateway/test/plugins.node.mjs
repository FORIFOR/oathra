import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginRegistry, validateManifest, validateConfig, inspectDirectory, loadExternal } from '../../../sdk/plugin-kit/index.mjs';
import { defineChannel } from '../../../sdk/channel-sdk/index.mjs';
import { defineCapability } from '../../../sdk/capability-sdk/index.mjs';
import { builtinRegistry, loadPluginRegistry } from '../lib/plugins.mjs';
import { Channels } from '../lib/channels.mjs';
import { Followups } from '../lib/followups.mjs';
import { Service } from '../lib/service.mjs';
import { Store } from '../lib/store.mjs';
import { simulate } from '../lib/worker.mjs';
import { hash } from '../lib/security.mjs';
import { createGateway } from '../server.mjs';
import { scaffold, cli } from '../plugins.mjs';
const now=Date.parse('2026-09-19T04:00:00+09:00');
const root=new URL('../../../',import.meta.url);
const manifest=id=>JSON.parse(readFileSync(new URL(`plugins/${id}/oathra.plugin.json`,root),'utf8'));
const basic=()=>({...manifest('line'),id:'custom',environment:[]});
function fixture(){
 let clock=now;const u={id:'alice',team:'one',role:'admin',tokenHash:hash('operator')};
 const config={mode:'simulator',users:[u,{id:'bob',team:'one',role:'operator',tokenHash:hash('bob')}],maxSeconds:300,maxCallUsd:10,dailyCalls:20,dailyUsd:30,rateCeilingUsd:0.1,setupFeeUsd:0,consentVersion:'v1',publicUrl:'http://localhost:4244',missing:[],liveReady:false};
 const store=new Store(':memory:',randomBytes(32).toString('hex'),()=>clock),service=new Service(store,config);
 service.saveConsent(u,'v1');const product=service.product(u,{name:'Example',facts:'Reviewed',reviewed:true});
 const contact=service.contact(u,{name:'田中さん',phone:'+819000000001',email:'tanaka@example.test',crmId:'123',relationship:'inquiry',basis:'Requested a call'});
 const draft=()=>service.prepare(u,{request:'田中さんに資料を案内',productId:product.id,contactId:contact.id});
 const env={OATHRA_INTEGRATION_OWNER:'alice',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',GOOGLE_REFRESH_TOKEN:'test',HUBSPOT_ACCESS_TOKEN:'test'};
 return {u,config,store,service,env,draft,contact,advance(ms){clock+=ms;},close(){store.close();}};
}
const withFixture=fn=>async()=>{const f=fixture();try{await fn(f);}finally{f.close();}};
function cap(registry, id='external-crm',impl={}){
 const m={...manifest('crm'),id,environment:[]};registry.register(m,defineCapability({ready:()=>true,preview:i=>({body:i.body}),execute:async()=>({id:'receipt'}),...impl}));return id;
}
function live(f){const m=f.draft();m.mode='live';m.status='COMPLETED';m.result={verified:{material_send_allowed:true,meeting_agreed_on_call:'2026-09-25T15:00:00+09:00'},doNotContact:false};f.store.put('mission',m);return m;}
const fakeChannel=()=>defineChannel({verify:()=>true,decode:raw=>JSON.parse(raw),send:async()=>({status:'accepted'})});
function lineJob(id,user,text,action){return {id,payload:{kind:'line',event:{type:action?'postback':'message',source:{type:'user',userId:user},message:{type:'text',text,id},...(action?{postback:{data:action}}:{})}}};}

test('all bundled manifests are valid and registry exposes no provider secrets',()=>{
 const r=builtinRegistry({LINE_CHANNEL_SECRET:'topsecret',OPENAI_API_KEY:'do-not-expose'});
 assert.equal(r.list().length,7);assert(!JSON.stringify(r.list()).includes('topsecret'));assert(!JSON.stringify(r.list()).includes('do-not-expose'));
 for(const p of r.list())assert.equal(p.apiVersion,1);
});
for(const [name,change] of [
 ['API mismatch',m=>m.apiVersion=2],['missing ID',m=>delete m.id],['bad ID',m=>m.id='../line'],
 ['unsupported field',m=>m.automaticApproval=true],['missing version',m=>delete m.version],
 ['unknown kind',m=>m.kind='__proto__'],['approval issuance',m=>m.permissions.push('approval:create')],
 ['channel cannot dial',m=>m.permissions.push('call:execute')],['duplicate permission',m=>m.permissions.push('channel:send')],
 ['secret store exposure',m=>m.environment.push('OATHRA_DATA_KEY')],['path traversal',m=>m.entry='../index.mjs'],
 ['remote module URL',m=>m.entry='https://attacker.test/index.mjs'],['missing schema strictness',m=>delete m.configSchema.additionalProperties],
 ['unsupported schema keyword',m=>m.configSchema.$ref='https://attacker.test/schema'],['approval without read',m=>m.permissions=m.permissions.filter(p=>p!=='mission:read')],
 ['unknown feature',m=>m.features.shell=true]
])test('manifest rejects '+name,()=>{const m=basic();change(m);assert.throws(()=>validateManifest(m));});
test('manifest validation never treats undefined as string ID',()=>assert.throws(()=>validateManifest({...basic(),id:undefined}),/invalid_plugin_id/));
test('config schema validates required fields, types, bounds and unknown keys',()=>{
 const schema={type:'object',properties:{region:{type:'string',enum:['jp','us']},limit:{type:'integer',minimum:1,maximum:5}},required:['region'],additionalProperties:false};
 assert.deepEqual(validateConfig({region:'jp',limit:3},schema),{region:'jp',limit:3});
 for(const x of [{},{region:'xx'},{region:'jp',limit:6},{region:'jp',limit:'2'},{region:'jp',extra:1}])assert.throws(()=>validateConfig(x,schema));
});
test('registry rejects duplicate IDs and ungranted permissions',()=>{const r=new PluginRegistry();r.register(basic(),fakeChannel());assert.throws(()=>r.register(basic(),fakeChannel()),/duplicate/);assert.throws(()=>new PluginRegistry().register(basic(),fakeChannel(),{grants:['channel:send']}),/not_granted/);});
test('SDK helpers reject missing runtime implementations',()=>{assert.throws(()=>defineChannel({verify(){}}));assert.throws(()=>defineCapability({preview(){}}));});
test('disabled plugin cannot be routed or executed',()=>{const r=builtinRegistry({},{disabled:['line','sms']});assert(!r.has('line'));assert.throws(()=>r.channel('line'),/not_enabled/);assert.throws(()=>r.capability('sms'),/not_enabled/);});
test('credential changes change runtime identity without exposing credential content',()=>{
 const a=builtinRegistry({LINE_CHANNEL_SECRET:'a'}),b=builtinRegistry({LINE_CHANNEL_SECRET:'b'});assert.notEqual(a.identity('line'),b.identity('line'));
});

async function withDir(fn){const dir=mkdtempSync(join(tmpdir(),'oathra-plugin-'));try{return await fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
function diskPlugin(dir,id='external',source='export default () => ({verify:()=>true,decode:()=>({events:[]}),send:async()=>({status:"accepted"})});'){
 const path=join(dir,id);mkdirSync(path);writeFileSync(join(path,'oathra.plugin.json'),JSON.stringify({...basic(),id}));writeFileSync(join(path,'index.mjs'),source);
 const i=inspectDirectory(path);return {id,path,enabled:true,integrity:i.integrity,grants:i.manifest.permissions,config:{}};
}
test('loader imports a pinned external directory without gateway edits',()=>withDir(async dir=>{const e=diskPlugin(dir);const r=await loadExternal(new PluginRegistry(),[e]);assert(r.has('external','channel'));}));
test('ungranted, changed and disabled source is rejected before code executes',()=>withDir(async dir=>{
 const marker=join(dir,'marker'),source=`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');export default()=>({});`;
 const e=diskPlugin(dir,'external',source);
 await assert.rejects(loadExternal(new PluginRegistry(),[{...e,grants:[]}]),/not_granted/);
 await assert.rejects(loadExternal(new PluginRegistry(),[{...e,integrity:'sha256-wrong'}]),/integrity/);
 const r=await loadExternal(new PluginRegistry(),[{...e,enabled:false}]);assert(!r.has(e.id));
 assert.throws(()=>readFileSync(marker),/ENOENT/);
}));
test('all manifests preflight before any plugin module executes',()=>withDir(async dir=>{
 const marker=join(dir,'marker'),source=`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');export default()=>({});`;
 const a=diskPlugin(dir,'first',source),b=diskPlugin(dir,'second');
 await assert.rejects(loadExternal(new PluginRegistry(),[a,{...b,grants:[]}]),/not_granted/);assert.throws(()=>readFileSync(marker),/ENOENT/);
}));
test('directory pin covers helper changes, not just the entry point',()=>withDir(async dir=>{const e=diskPlugin(dir);writeFileSync(join(e.path,'helper.mjs'),'export const a=1;');assert.notEqual(inspectDirectory(e.path).integrity,e.integrity);await assert.rejects(loadExternal(new PluginRegistry(),[e]),/integrity/);}));
test('symlink escape is rejected during inspection',()=>withDir(async dir=>{const e=diskPlugin(dir);symlinkSync('/etc/passwd',join(e.path,'escape'));assert.throws(()=>inspectDirectory(e.path),/symlink/);}));
test('external factory receives only declared env/config and no service or store',()=>withDir(async dir=>{
 const e=diskPlugin(dir,'external',`export default ctx=>{if('service' in ctx||'store' in ctx||'UNDECLARED_SECRET' in ctx.env)throw Error('leak');return {verify:()=>true,decode:()=>({events:[]}),send:async()=>({status:'accepted'})};};`);
 const r=await loadExternal(new PluginRegistry(),[e],{env:{UNDECLARED_SECRET:'private'}});assert(r.has(e.id));
}));
test('CLI generates safe skeleton, requires exact reviewed pin, supports disabling',()=>withDir(async dir=>{
 const path=join(dir,'new'),file=join(dir,'plugins.json');scaffold('channel','new-channel',path);
 const info=inspectDirectory(path);await assert.rejects(cli(['add',path,'--file',file]),/trust_hash/);
 await cli(['add',path,'--trust',info.integrity,'--file',file]);
 const r=await loadPluginRegistry({OATHRA_PLUGINS_FILE:file});assert(r.has('new-channel'));assert.equal(r.list().find(p=>p.id==='new-channel').configured,false);
 await cli(['disable','new-channel','--file',file]);const disabled=await loadPluginRegistry({OATHRA_PLUGINS_FILE:file});assert(!disabled.has('new-channel'));
 assert.throws(()=>scaffold('channel','new-channel',path),/exists/);
}));

test('signature failure never calls plugin decode or persists inbox',withFixture(f=>{let called=false;const r=new PluginRegistry();r.register(basic(),{verify:()=>false,decode:()=>{called=true;return {events:[]};},send:async()=>({status:'accepted'})});const c=new Channels(f.service,{},r);assert.throws(()=>c.receive('custom',Buffer.from('{}'),{}),/signature/);assert(!called);assert.equal(f.store.list('inbox').length,0);}));
test('normalised plugin events have bounded identity and body fields',withFixture(f=>{const r=new PluginRegistry();r.register(basic(),fakeChannel());const c=new Channels(f.service,{},r);f.service.link('custom','a',f.service.linkCode(f.u));
  // An out-of-bounds event is dropped on its own; the valid one delivered with it is kept.
  c.receive('custom',Buffer.from(JSON.stringify({events:[{eventId:'big',type:'message',actor:'a',destination:'d',text:'x'.repeat(2001)},{eventId:'ok',type:'message',actor:'a',destination:'d',text:'hello'}]})),{});
  assert.deepEqual(f.store.list('inbox').map(j=>j.id),['custom:ok']);}));
test('unrecognised channel fails closed instead of silently reporting sent',withFixture(async f=>{const c=new Channels(f.service,{});await assert.rejects(c.send({owner:f.u.id,payload:{channel:'not-installed'}}),/not_enabled/);}));
test('LINE review creates a draft and replayed approval enqueues only once',withFixture(async f=>{
 const c=new Channels(f.service,{});f.service.link('line','U1',f.service.linkCode(f.u));await c.process(lineJob('draft','U1','田中さんに資料を案内'));
 assert.equal(f.store.list('mission')[0].status,'DRAFT');const data=f.store.list('outbox')[0].payload.buttons[0].data;
 for(const id of ['approve1','approve2'])await c.process(lineJob(id,'U1','',data));assert.equal(f.store.list('mission',undefined,'QUEUED').length,1);
}));
test('approval copied to another linked identity cannot dial',withFixture(async f=>{
 const c=new Channels(f.service,{});for(const id of ['U1','U2'])f.service.link('line',id,f.service.linkCode(f.u));
 await c.process(lineJob('draft','U1','田中さんに資料を案内'));const data=f.store.list('outbox')[0].payload.buttons[0].data;
 await c.process(lineJob('approve','U2','',data));assert.equal(f.store.list('mission')[0].status,'DRAFT');
}));
test('pending notifications do not leak to an unlinked account',withFixture(async f=>{
 let sent=false;const r=builtinRegistry({LINE_CHANNEL_ACCESS_TOKEN:'test'});const c=new Channels(f.service,{},r,async()=>{sent=true;return {ok:true};});
 f.service.link('line','U1',f.service.linkCode(f.u));await c.process(lineJob('draft','U1','田中さんに資料を案内'));const job=f.store.list('outbox')[0];f.store.delKey('identity:line','U1');await assert.rejects(c.send(job),/unlinked/);assert(!sent);
}));
test('compact callbacks are owner-bound, encrypted at rest, and at most 64 bytes',withFixture(async f=>{
 let sent;const c=new Channels(f.service,{LINE_CHANNEL_ACCESS_TOKEN:'test'},undefined,async(_,opts)=>{sent=JSON.parse(opts.body);return {ok:true};});
 f.service.link('line','U1',f.service.linkCode(f.u));await c.process(lineJob('draft','U1','田中さんに資料を案内'));const job=f.store.list('outbox')[0];const original=job.payload.buttons[0].data;await c.send(job);
 const alias=sent.messages[0].quickReply.items[0].action.data;assert(Buffer.byteLength(alias)<=64);assert(!f.store.key('channel-action:line',alias).includes(original));await c.process(lineJob('approve','U1','',alias));assert.equal(f.store.list('mission')[0].status,'QUEUED');
}));
test('plugin changes invalidate pending channel messages and approvals',withFixture(async f=>{
 const c=new Channels(f.service,{LINE_CHANNEL_SECRET:'one'});f.service.link('line','U1',f.service.linkCode(f.u));await c.process(lineJob('draft','U1','田中さんに資料を案内'));const data=f.store.list('outbox')[0].payload.buttons[0].data;
 const changed=new Channels(f.service,{LINE_CHANNEL_SECRET:'two'});await changed.process(lineJob('approve','U1','',data));assert.equal(f.store.list('mission')[0].status,'DRAFT');
}));
test('selected call plugin identity is part of reviewed mission contract',withFixture(f=>{f.config.callPluginIdentity='one';const m=f.draft(),r=f.service.review(f.u,m.id);f.config.callPluginIdentity='two';assert.throws(()=>f.service.start(f.u,r.approvalToken,'start',true),/call_plugin_changed/);}));

test('external capability enters existing preview/approval/receipt path',withFixture(async f=>{
 const m=live(f),r=builtinRegistry(f.env);let sends=0;const kind=cap(r,'custom-crm',{execute:async a=>{sends++;assert(Object.isFrozen(a.details));return {id:'external-id',status:'COMPLETED',verified:true};}});
 const a=new Followups(f.service,f.env,fetch,r),p=a.preview(f.u,m.id,{kind,body:'Follow-up note'});assert.equal(p.details.recipient,'123');assert.equal(sends,0);
 const input={approvalToken:p.approvalToken,acknowledged:true};const result=await a.execute(f.u,p.id,input,'write');await a.execute(f.u,p.id,input,'write');assert.equal(sends,1);assert.equal(result.status,'SUBMITTED');assert.equal(result.verified,undefined);
}));
test('custom capability cannot substitute the registered recipient',withFixture(f=>{const m=live(f),r=builtinRegistry(f.env),kind=cap(r,'custom-crm',{preview:()=>({recipient:'attacker',body:'x'})});const a=new Followups(f.service,f.env,fetch,r);assert.throws(()=>a.preview(f.u,m.id,{kind,body:'x'}),/replace_recipient/);}));
test('capability cannot alter host mission through preview objects',withFixture(f=>{const m=live(f),r=builtinRegistry(f.env),kind=cap(r,'custom-crm',{preview:(i,{mission})=>{assert.throws(()=>mission.target.phone='changed',TypeError);return {body:'x'};}});new Followups(f.service,f.env,fetch,r).preview(f.u,m.id,{kind,body:'x'});assert.equal(f.store.get('mission',m.id).target.phone,f.contact.phone);}));
test('custom action is suppressed before execution and before its outgoing fetch',withFixture(async f=>{
 const m=live(f),r=builtinRegistry(f.env);let fetched=false;const kind=cap(r,'custom-crm',{execute:async(a,{fetchImpl})=>{f.store.suppress(f.u.team,m.target.phone);await fetchImpl('https://unused.invalid/');return {id:'bad'};}});
 const a=new Followups(f.service,f.env,async()=>{fetched=true;return {ok:true};},r),p=a.preview(f.u,m.id,{kind,body:'x'});
 const result=await a.execute(f.u,p.id,{approvalToken:p.approvalToken,acknowledged:true},'custom');assert.equal(result.status,'UNKNOWN');assert(!fetched);
}));
test('plugin version/config change invalidates follow-up approval',withFixture(async f=>{
 const m=live(f),r=builtinRegistry(f.env),kind=cap(r),a=new Followups(f.service,f.env,fetch,r),p=a.preview(f.u,m.id,{kind,body:'x'});
 const r2=builtinRegistry(f.env);r2.register({...manifest('crm'),id:kind,version:'0.2.0',environment:[]},defineCapability({ready:()=>true,preview:()=>({}),execute:async()=>({id:'bad'})}));a.registry=r2;
 await assert.rejects(a.execute(f.u,p.id,{approvalToken:p.approvalToken,acknowledged:true},'write'),/plugin_changed/);
}));
test('unknown custom provider result cannot be automatically retried',withFixture(async f=>{
 const m=live(f),r=builtinRegistry(f.env);let calls=0;const kind=cap(r,'custom-crm',{execute:async()=>{calls++;throw Error('network outcome uncertain');}}),a=new Followups(f.service,f.env,fetch,r),p=a.preview(f.u,m.id,{kind,body:'x'}),input={approvalToken:p.approvalToken,acknowledged:true};
 assert.equal((await a.execute(f.u,p.id,input,'custom')).status,'UNKNOWN');await a.execute(f.u,p.id,input,'custom');assert.equal(calls,1);
}));

test('Telegram external registration works over generic HTTP webhook and normal approval',withFixture(async f=>{
 const r=builtinRegistry({}, {executeCall:simulate,now:()=>f.store.now()}),info=inspectDirectory(new URL('plugins/telegram',root).pathname);const messages=[];
 const env={TELEGRAM_BOT_TOKEN:'123:fake-token',TELEGRAM_WEBHOOK_SECRET:'not-a-real-secret'};
 const fetchImpl=async(url,init)=>{const data=JSON.parse(init.body);messages.push({url,data});return {ok:true,json:async()=>({ok:true,result:{message_id:1}})};};
 await loadExternal(r,[{id:'telegram',path:info.root,enabled:true,integrity:info.integrity,grants:info.manifest.permissions,config:{}}],{env,fetchImpl,now:()=>f.store.now()});
 const app=await createGateway(f.config,{store:f.store,registry:r,env,fetchImpl});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port,headers={'content-type':'application/json','x-telegram-bot-api-secret-token':env.TELEGRAM_WEBHOOK_SECRET};
 const update=(id,text)=>({update_id:id,message:{message_id:id,date:now/1000,chat:{id:7,type:'private'},from:{id:7,is_bot:false},text}});
 try {
  const bad=await fetch(base+'/hooks/channels/telegram',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(update(1,'x'))});assert.equal(bad.status,401);
  f.service.link('telegram','7',f.service.linkCode(f.u));
  const res=await fetch(base+'/hooks/channels/telegram',{method:'POST',headers,body:JSON.stringify(update(2,'田中さんに資料を案内'))});assert.equal(res.status,200);
  await app.channels.process(f.store.list('inbox')[0]);assert.equal(f.store.list('mission')[0].status,'DRAFT');await app.channels.send(f.store.list('outbox')[0]);
  const data=messages.find(x=>x.url.endsWith('/sendMessage')).data.reply_markup.inline_keyboard[0][0].callback_data;assert(Buffer.byteLength(data)<=64);
  const callback={update_id:3,callback_query:{id:'q1',from:{id:7,is_bot:false},message:{message_id:2,chat:{id:7,type:'private'}},data}};
  const approved=await fetch(base+'/hooks/channels/telegram',{method:'POST',headers,body:JSON.stringify(callback)});assert.equal(approved.status,200);
  const approvalJob=f.store.list('inbox').find(x=>x.id==='telegram:3');await app.channels.process(approvalJob);assert.equal(f.store.list('mission')[0].status,'QUEUED');
  await app.worker.tick();await app.worker.active?.promise;assert.equal(f.store.list('mission')[0].status,'COMPLETED');assert.equal(f.store.list('mission')[0].result.verified.material_send_allowed,true);assert.equal(f.store.list('mission')[0].result.verified.meeting_agreed_on_call,undefined);
  const plugins=await fetch(base+'/v1/plugins',{headers:{authorization:'Bearer operator'}}).then(x=>x.json());assert(plugins.plugins.some(p=>p.id==='telegram'));assert(!JSON.stringify(plugins).includes(env.TELEGRAM_BOT_TOKEN));
  assert.equal((await fetch(base+'/v1/plugins',{headers:{authorization:'Bearer bob'}})).status,403);
 } finally {await app.close();}
}));
test('Telegram discards groups, bots and another user’s callbacks',async()=>{
 const create=(await import('../../../plugins/telegram/index.mjs')).default,adapter=create({env:{},now:()=>now});
 for(const d of [{update_id:1,message:{date:now/1000,chat:{id:-1,type:'group'},from:{id:1},text:'x'}},{update_id:1,callback_query:{from:{id:2},message:{chat:{id:1,type:'private'}},data:'x'}},{update_id:1,message:{date:now/1000,chat:{id:1,type:'private'},from:{id:1,is_bot:true},text:'x'}}])assert.equal(adapter.decode(Buffer.from(JSON.stringify(d))).events.length,0);
});
