import { createHmac } from 'node:crypto';
import { check, equal } from '../_shared/http.mjs';
// Inbound SMS and WhatsApp through one Twilio Messaging webhook. A sender number can be spoofed more easily than a LINE
// or Telegram account, so this channel only drafts: it never asks for `approval:request`, and calls are approved on the web.
const PATHS=['/hooks/channels/twilio-messaging','/hooks/twilio-messaging'];
export default function create({env}) {
 const base=()=>(env.OATHRA_PUBLIC_URL??'').replace(/\/$/,'');
 const own=()=>[env.TWILIO_PHONE_NUMBER,env.TWILIO_WHATSAPP_NUMBER&&`whatsapp:${env.TWILIO_WHATSAPP_NUMBER}`].filter(Boolean);
 // https://www.twilio.com/docs/usage/security#validating-requests: HMAC-SHA1 over the URL plus every POST field, sorted by name.
 const sign=(url,params)=>createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(url+[...params.keys()].sort().map(k=>k+params.getAll(k).join('')).join('')).digest('base64');
 const ready=()=>env.OATHRA_MESSAGING_CHANNEL_ENABLED==='true'&&!!(env.TWILIO_AUTH_TOKEN&&env.TWILIO_ACCOUNT_SID&&base()&&own().length);
 return {
  ready,
  // The account's Twilio token is also present for voice; without the explicit opt-in this hook accepts nothing.
  verify(raw,headers){
   const actual=headers['x-twilio-signature'];if(typeof actual!=='string'||!ready())return false;
   const params=new URLSearchParams(raw.toString('utf8'));
   return PATHS.some(p=>equal(sign(base()+p,params),actual));
  },
  decode(raw){
   const p=new URLSearchParams(raw.toString('utf8')),from=p.get('From')??'',to=p.get('To')??'',sid=p.get('MessageSid')??'';
   check(/^(?:SM|MM)[0-9a-f]{32}$/.test(sid),'invalid_webhook_events');
   if(p.get('AccountSid')!==env.TWILIO_ACCOUNT_SID||!own().includes(to))return {events:[]};
   // A WhatsApp reply must come from WhatsApp, an SMS reply from a phone number; the prefix keeps the two identities apart.
   if(!/^(?:whatsapp:)?\+[1-9]\d{7,14}$/.test(from)||from.startsWith('whatsapp:')!==to.startsWith('whatsapp:'))return {events:[]};
   const body=p.get('Body')??'';if(!body.trim())return {events:[]};
   return {events:[{eventId:sid,actor:from,destination:from,sourceMessageId:sid,type:'message',text:body}]};
  },
  async send(m,{signal,fetchImpl}){
   check(env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN,'twilio_messaging_not_configured',503);
   const whatsapp=m.destination.startsWith('whatsapp:'),from=whatsapp?`whatsapp:${env.TWILIO_WHATSAPP_NUMBER}`:env.TWILIO_PHONE_NUMBER;
   check(whatsapp?!!env.TWILIO_WHATSAPP_NUMBER:!!from,'twilio_messaging_not_configured',503);
   const r=await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,{method:'POST',headers:{authorization:'Basic '+Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:from,To:m.destination,Body:m.text.slice(0,1500)}),signal,redirect:'error'});
   check(r.ok,'twilio_messaging_send_failed',502);const d=await r.json();
   return {status:'accepted',...(typeof d.sid==='string'?{providerId:d.sid}:{})};
  }
 };
}
