import { defineCapability } from '../../sdk/capability-sdk/index.mjs';
import { string, write } from '../_shared/http.mjs';
export default function create({env}) {return defineCapability({
 ready:()=>!!env.HUBSPOT_ACCESS_TOKEN,
 preview(input){return {body:string(input.body,12000)};},
 async execute(a,{fetchImpl,signal}){const escaped=a.details.body.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
 return write(fetchImpl,'https://api.hubapi.com/crm/v3/objects/notes',{headers:{authorization:`Bearer ${env.HUBSPOT_ACCESS_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({properties:{hs_timestamp:new Date().toISOString(),hs_note_body:escaped},associations:[{to:{id:a.details.recipient},types:[{associationCategory:'HUBSPOT_DEFINED',associationTypeId:202}]}]})},signal);
 }
});}
