import { defineCapability } from '../../sdk/capability-sdk/index.mjs';
import { string, write } from '../_shared/http.mjs';
export default function create({env}) {return defineCapability({
 ready:()=>!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_REFRESH_TOKEN),
 preview(input){return {subject:string(input.subject,150),body:string(input.body,12000),contactPermissionBasis:string(input.contactPermissionBasis,1000)};},
 async execute(a,{bearer,fetchImpl,signal}){const d=a.details,subject=Buffer.from(d.subject).toString('base64');
 const raw=Buffer.from(`To: ${d.recipient}\r\nSubject: =?UTF-8?B?${subject}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\nMessage-ID: <${a.id}@oathra.invalid>\r\n\r\n${Buffer.from(d.body).toString('base64').match(/.{1,76}/g).join('\r\n')}\r\n`).toString('base64url');
 return write(fetchImpl,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify({raw})},signal);
 }
});}
