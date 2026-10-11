import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { builtinRegistry } from '../lib/plugins.mjs';
import { Channels } from '../lib/channels.mjs';
import { Followups } from '../lib/followups.mjs';
import { Service } from '../lib/service.mjs';
import { Store } from '../lib/store.mjs';
import { hash } from '../lib/security.mjs';
import { numberSetup } from '../number-setup.mjs';
import createMessaging from '../../../plugins/twilio-messaging/index.mjs';

const now=Date.parse('2026-10-11T04:00:00+09:00');
const ACCOUNT='AC'+'0'.repeat(32),SMS_NUMBER='+815000000001',WA_NUMBER='+14155550100';
const env={OATHRA_MESSAGING_CHANNEL_ENABLED:'true',OATHRA_PUBLIC_URL:'https://gateway.example.test',TWILIO_ACCOUNT_SID:ACCOUNT,TWILIO_AUTH_TOKEN:'not-a-real-token',TWILIO_PHONE_NUMBER:SMS_NUMBER,TWILIO_WHATSAPP_NUMBER:WA_NUMBER,
 OATHRA_WHATSAPP_ENABLED:'true',OATHRA_INTEGRATION_OWNER:'alice'};
const sid=n=>'SM'+String(n).padStart(32,'0');
const form=fields=>Buffer.from(new URLSearchParams({AccountSid:ACCOUNT,To:SMS_NUMBER,NumMedia:'0',...fields}).toString());
// Twilio's request signature, computed independently of the plugin: URL followed by every field sorted by name.
const sign=(raw,url=env.OATHRA_PUBLIC_URL+'/hooks/channels/twilio-messaging',token=env.TWILIO_AUTH_TOKEN)=>{const p=new URLSearchParams(raw.toString());
 return createHmac('sha1',token).update(url+[...p.keys()].sort().map(k=>k+p.get(k)).join('')).digest('base64');};
function fixture(){
 const u={id:'alice',team:'one',role:'admin',tokenHash:hash('operator')};
 const config={mode:'simulator',users:[u],maxSeconds:300,maxCallUsd:10,dailyCalls:20,dailyUsd:30,rateCeilingUsd:0.1,setupFeeUsd:0,consentVersion:'v1',publicUrl:'http://localhost:4244',missing:[],liveReady:false};
 const store=new Store(':memory:',randomBytes(32).toString('hex'),()=>now),service=new Service(store,config);service.saveConsent(u,'v1');
 return {u,store,service,close(){store.close();}};
}
const withFixture=fn=>async()=>{const f=fixture();try{await fn(f);}finally{f.close();}};

test('messaging channel accepts only Twilio-signed requests for this hook and only when enabled',()=>{
 const adapter=createMessaging({env}),raw=form({From:'+819011112222',Body:'hi',MessageSid:sid(1)});
 assert.equal(adapter.verify(raw,{'x-twilio-signature':sign(raw)}),true);
 assert.equal(adapter.verify(raw,{'x-twilio-signature':sign(raw,env.OATHRA_PUBLIC_URL+'/hooks/twilio-messaging')}),true);
 assert.equal(adapter.verify(raw,{'x-twilio-signature':sign(raw,undefined,'another-token')}),false);
 assert.equal(adapter.verify(raw,{'x-twilio-signature':sign(raw,env.OATHRA_PUBLIC_URL+'/hooks/channels/line')}),false);
 assert.equal(adapter.verify(raw,{}),false);
 const tampered=Buffer.from(raw.toString().replace('hi','call'));assert.equal(adapter.verify(tampered,{'x-twilio-signature':sign(raw)}),false);
 // The voice setup already holds the Twilio token; without the explicit opt-in the hook takes nothing.
 assert.equal(createMessaging({env:{...env,OATHRA_MESSAGING_CHANNEL_ENABLED:undefined}}).verify(raw,{'x-twilio-signature':sign(raw)}),false);
});

test('messaging channel drops other accounts, other numbers, empty bodies and SMS/WhatsApp crossovers',()=>{
 const adapter=createMessaging({env}),events=fields=>adapter.decode(form(fields)).events;
 assert.deepEqual(events({From:'+819011112222',Body:'田中さんに電話',MessageSid:sid(1)}),[{eventId:sid(1),actor:'+819011112222',destination:'+819011112222',sourceMessageId:sid(1),type:'message',text:'田中さんに電話'}]);
 assert.equal(events({From:'whatsapp:+819011112222',To:'whatsapp:'+WA_NUMBER,Body:'hi',MessageSid:sid(2)})[0].actor,'whatsapp:+819011112222');
 assert.deepEqual(events({From:'+819011112222',Body:'hi',MessageSid:sid(3),AccountSid:'AC'+'1'.repeat(32)}),[]);
 assert.deepEqual(events({From:'+819011112222',Body:'hi',MessageSid:sid(4),To:'+815099999999'}),[]);
 assert.deepEqual(events({From:'whatsapp:+819011112222',Body:'hi',MessageSid:sid(5)}),[]);
 assert.deepEqual(events({From:'+819011112222',To:'whatsapp:'+WA_NUMBER,Body:'hi',MessageSid:sid(6)}),[]);
 assert.deepEqual(events({From:'+819011112222',Body:'  ',MessageSid:sid(7)}),[]);
 assert.deepEqual(events({From:'Alice',Body:'hi',MessageSid:sid(8)}),[]);
 assert.throws(()=>adapter.decode(form({From:'+819011112222',Body:'hi',MessageSid:'x'})),/invalid_webhook_events/);
});

test('an SMS links an account, drafts a phone request without approval buttons and replies by SMS',withFixture(async f=>{
 const sent=[],fetchImpl=async(url,init)=>{sent.push({url,body:Object.fromEntries(new URLSearchParams(init.body))});return {ok:true,json:async()=>({sid:sid(99)})};};
 const c=new Channels(f.service,env,builtinRegistry(env,{now:()=>now}),fetchImpl);
 const deliver=(n,body,from='+819011112222')=>{const raw=form({From:from,Body:body,MessageSid:sid(n)});return c.receive('twilio-messaging',raw,{'x-twilio-signature':sign(raw)});};
 deliver(1,'田中さんに電話して');assert.equal(f.store.list('inbox').length,0,'an unlinked sender queues nothing but a link code');
 deliver(2,'連携 '+f.service.linkCode(f.u));
 await c.process(f.store.list('inbox').find(j=>j.id===`twilio-messaging:${sid(2)}`));
 deliver(3,'09012345678 に明日19時で2名の予約ができるか聞いて');deliver(3,'09012345678 に明日19時で2名の予約ができるか聞いて');
 assert.equal(f.store.list('inbox').filter(j=>j.id===`twilio-messaging:${sid(3)}`).length,1,'a redelivered MessageSid is processed once');
 await c.process(f.store.list('inbox').find(j=>j.id===`twilio-messaging:${sid(3)}`));
 for(const job of f.store.list('outbox'))await c.send(job);
 assert.equal(sent.length,2);
 for(const m of sent){assert.match(m.url,new RegExp(`/Accounts/${ACCOUNT}/Messages\\.json$`));assert.equal(m.body.From,SMS_NUMBER);assert.equal(m.body.To,'+819011112222');}
 assert.match(sent[1].body.Body,/下書き.*未発信/s);assert(!/oa_/.test(sent.map(m=>m.body.Body).join('')),'no approval alias is ever sent over SMS');
 assert.equal(f.store.list('mission').filter(m=>m.status!=='DRAFT').length,0,'a message alone never dials');
}));

test('a WhatsApp sender is answered over WhatsApp from the WhatsApp number',withFixture(async f=>{
 const sent=[],fetchImpl=async(url,init)=>{sent.push(Object.fromEntries(new URLSearchParams(init.body)));return {ok:true,json:async()=>({sid:sid(99)})};};
 const c=new Channels(f.service,env,builtinRegistry(env,{now:()=>now}),fetchImpl);
 const raw=form({From:'whatsapp:+819011112222',To:'whatsapp:'+WA_NUMBER,Body:'連携 '+f.service.linkCode(f.u),MessageSid:sid(1)});
 c.receive('twilio-messaging',raw,{'x-twilio-signature':sign(raw)});await c.process(f.store.list('inbox')[0]);await c.send(f.store.list('outbox')[0]);
 assert.deepEqual([sent[0].From,sent[0].To],['whatsapp:'+WA_NUMBER,'whatsapp:+819011112222']);
 assert.throws(()=>f.service.channelUser('twilio-messaging','+819011112222'),'an SMS sender is not the same identity as the WhatsApp one');
}));

test('WhatsApp follow-up uses the sms policy, the registered phone and an approved template when configured',withFixture(async f=>{
 const product=f.service.product(f.u,{name:'Example',facts:'Reviewed',reviewed:true});
 const contact=f.service.contact(f.u,{name:'田中さん',phone:'+819000000001',email:'tanaka@example.test',relationship:'inquiry',basis:'Requested a call'});
 const m=f.service.prepare(f.u,{request:'田中さんに資料を案内',productId:product.id,contactId:contact.id});
 m.mode='live';m.status='COMPLETED';m.result={verified:{material_send_allowed:true},doNotContact:false};f.store.put('mission',m);
 for(const [extra,expect] of [[{},{Body:'予約は明日19時です'}],[{TWILIO_WHATSAPP_CONTENT_SID:'HX'+'a'.repeat(32)},{ContentSid:'HX'+'a'.repeat(32),ContentVariables:JSON.stringify({1:'予約は明日19時です'})}]]){
  const sent=[],e={...env,...extra},a=new Followups(f.service,e,async(url,init)=>{sent.push({url,body:Object.fromEntries(new URLSearchParams(init.body))});return {ok:true,json:async()=>({sid:sid(5)})};},builtinRegistry(e));
  assert(a.available(f.u).includes('whatsapp'));
  assert.throws(()=>a.preview(f.u,m.id,{kind:'whatsapp',body:'予約は明日19時です'}),/invalid_text/,'a stated contact basis is required');
  const p=a.preview(f.u,m.id,{kind:'whatsapp',body:'予約は明日19時です',contactPermissionBasis:'通話でWhatsAppでの送付を依頼された'});
  assert.equal(p.details.recipient,contact.phone);assert.equal(sent.length,0,'a preview sends nothing');
  const done=await a.execute(f.u,p.id,{approvalToken:p.approvalToken,acknowledged:true},'send-'+sent.length+(extra.TWILIO_WHATSAPP_CONTENT_SID?'t':'b'));
  assert.equal(done.status,'SUBMITTED');
  assert.deepEqual(sent[0].body,{From:'whatsapp:'+WA_NUMBER,To:'whatsapp:'+contact.phone,...expect});
  f.store.db.prepare("DELETE FROM records WHERE kind='followup'").run();
 }
 const off=new Followups(f.service,{...env,OATHRA_WHATSAPP_ENABLED:undefined},fetch,builtinRegistry({...env,OATHRA_WHATSAPP_ENABLED:undefined}));
 assert(!off.available(f.u).includes('whatsapp'),'WhatsApp stays off without the explicit opt-in');
}));

test('number setup lists numbers without buying and buys only with an https gateway and --yes',async()=>{
 const calls=[],fetchImpl=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body&&Object.fromEntries(init.body)});
  return url.includes('/AvailablePhoneNumbers/')?{ok:true,json:async()=>({available_phone_numbers:[{phone_number:'+815012345678',locality:'Tokyo',capabilities:{voice:true,SMS:false},address_requirements:'local'}]})}
   :{ok:true,json:async()=>({sid:'PN1',phone_number:'+815012345678',voice_url:'v',sms_url:'s'})};};
 const quiet=()=>{};
 const listed=await numberSetup(['--country','jp','--contains','50'],env,fetchImpl,quiet);
 assert.equal(listed.code,0);assert.equal(listed.numbers[0].number,'+815012345678');assert.match(calls[0].url,/AvailablePhoneNumbers\/JP\/Local\.json\?.*Contains=50/);
 assert.equal((await numberSetup(['--buy','+815012345678'],env,fetchImpl,quiet)).code,2,'no purchase without --yes');
 assert.equal((await numberSetup(['--buy','+815012345678','--yes'],{...env,OATHRA_PUBLIC_URL:'http://localhost:4244'},fetchImpl,quiet)).code,2);
 assert.equal((await numberSetup(['--buy','+815012345678','--bundle','nope','--yes'],env,fetchImpl,quiet)).code,2);
 assert.equal((await numberSetup(['--buy','0501234','--yes'],env,fetchImpl,quiet)).code,2);
 assert.equal(calls.filter(c=>c.method==='POST').length,0);
 const bundle='BU'+'b'.repeat(32),bought=await numberSetup(['--buy','+815012345678','--bundle',bundle,'--yes'],env,fetchImpl,quiet);
 assert.equal(bought.code,0);const post=calls.find(c=>c.method==='POST');
 assert.deepEqual(post.body,{PhoneNumber:'+815012345678',VoiceUrl:'https://gateway.example.test/hooks/twilio/voice',VoiceMethod:'POST',SmsUrl:'https://gateway.example.test/hooks/channels/twilio-messaging',SmsMethod:'POST',BundleSid:bundle});
 assert.equal((await numberSetup([],{},fetchImpl,quiet)).code,2);
});
