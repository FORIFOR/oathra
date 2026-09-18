import { defineCapability } from '../../sdk/capability-sdk/index.mjs';
import { string, write } from '../_shared/http.mjs';
export default function create({env}) {return defineCapability({
 ready:()=>env.OATHRA_SMS_ENABLED==='true'&&!!env.TWILIO_AUTH_TOKEN,
 preview(input){return {body:string(input.body,500),subject:'',contactPermissionBasis:string(input.contactPermissionBasis,1000),chargeNotice:'SMS通信料が別途発生します。通話の費用上限には含みません。'};},
 execute(a,{fetchImpl,signal}){return write(fetchImpl,`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,{headers:{authorization:'Basic '+Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:env.TWILIO_PHONE_NUMBER,To:a.details.recipient,Body:a.details.body})},signal);}
});}
