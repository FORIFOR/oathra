import { defineCapability } from '../../sdk/capability-sdk/index.mjs';
import { string, write } from '../_shared/http.mjs';
// WhatsApp is a phone-addressed message, so it runs under the `sms` effect policy: call evidence and a stated basis are required.
// Outside the 24-hour customer-service window WhatsApp accepts only an approved template; set TWILIO_WHATSAPP_CONTENT_SID
// to one whose variable {{1}} is the message body.
export default function create({env}) {return defineCapability({
 ready:()=>env.OATHRA_WHATSAPP_ENABLED==='true'&&!!(env.TWILIO_AUTH_TOKEN&&env.TWILIO_ACCOUNT_SID&&env.TWILIO_WHATSAPP_NUMBER),
 preview(input){return {body:string(input.body,1000),subject:'',contactPermissionBasis:string(input.contactPermissionBasis,1000),template:env.TWILIO_WHATSAPP_CONTENT_SID??null,chargeNotice:'WhatsAppの通信料が別途発生します。通話の費用上限には含みません。'};},
 execute(a,{fetchImpl,signal}){
  const content=a.details.template?{ContentSid:a.details.template,ContentVariables:JSON.stringify({1:a.details.body})}:{Body:a.details.body};
  return write(fetchImpl,`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,{headers:{authorization:'Basic '+Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:`whatsapp:${env.TWILIO_WHATSAPP_NUMBER}`,To:`whatsapp:${a.details.recipient}`,...content})},signal);
 }
});}
