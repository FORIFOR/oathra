import { defineCapability } from '../../sdk/capability-sdk/index.mjs';
import { string, check, write } from '../_shared/http.mjs';
export default function create({env}) {return defineCapability({
 ready:()=>!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_REFRESH_TOKEN),
 preview(input,{mission:m}){const start=m.result.verified.meeting_agreed_on_call,minutes=Number(input.minutes??15);check(Number.isInteger(minutes)&&minutes>=5&&minutes<=120,'invalid_meeting_duration');
 return {title:string(input.title??`${m.product.name} 打ち合わせ`,150),start,end:new Date(Date.parse(start)+minutes*60000).toISOString(),minutes,note:'日時は電話で合意。所要時間は送信者が指定した招待内容です。招待承諾はまだ確認していません。'};},
 async execute(a,{bearer,fetchImpl,signal}){const d=a.details;
 return write(fetchImpl,`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID??'primary')}/events?sendUpdates=all`,{headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify({id:a.id.replaceAll('-',''),summary:d.title,start:{dateTime:d.start},end:{dateTime:d.end},attendees:[{email:d.recipient,responseStatus:'needsAction'}],description:d.note,extendedProperties:{private:{oathraMission:a.missionId}}})},signal);
 }
});}
