import { defineChannel } from '../../sdk/channel-sdk/index.mjs';
import { check, string, equal, hmac, jsonFetch } from '../_shared/http.mjs';
export default function create({env,now=Date.now,fetchImpl=fetch}) {
 const normalize=e=>{
  if(e.source?.type!=='user'||typeof e.source.userId!=='string')return null;
  const base={eventId:e.webhookEventId??'legacy',actor:e.source.userId,destination:e.source.userId,sourceMessageId:e.message?.id??e.unsend?.messageId};
  if(e.type==='unfollow')return {...base,type:'unlink'};
  if(e.type==='unsend')return {...base,type:'unsend'};
  if(e.postback?.data)return {...base,type:'action',action:e.postback.data};
  if(e.message?.type==='text')return {...base,type:'message',text:e.message.text};
  if(e.message?.type==='audio')return {...base,type:'message',media:{id:e.message.id,duration:e.message.duration}};
  return null;
 };
 return defineChannel({
  ready:()=>!!(env.LINE_CHANNEL_SECRET&&env.LINE_CHANNEL_ACCESS_TOKEN),
  verify(raw,headers){return !!env.LINE_CHANNEL_SECRET&&equal(hmac(env.LINE_CHANNEL_SECRET,raw),headers['x-line-signature']);},
  decode(raw){const data=JSON.parse(raw);check(Array.isArray(data.events)&&data.events.length<=100,'invalid_webhook_events');
   return {events:data.events.filter(e=>typeof e.webhookEventId==='string'&&Number.isFinite(e.timestamp)&&e.timestamp<=now()+300000&&e.timestamp>=now()-86400000).map(normalize).filter(Boolean)};},
  legacyEvent:normalize,
  async transcribe(media){
   check(env.OPENAI_API_KEY&&env.LINE_CHANNEL_ACCESS_TOKEN,'audio_transcription_not_configured',503);
   check(/^\d{1,30}$/.test(media.id)&&Number(media.duration)>0&&Number(media.duration)<=60000,'audio_must_be_under_60_seconds');
   const res=await fetchImpl(`https://api-data.line.me/v2/bot/message/${media.id}/content`,{headers:{authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`},signal:AbortSignal.timeout(12000),redirect:'error'});
   check(res.ok,'audio_download_failed',502);const reader=res.body.getReader(),chunks=[];let length=0;
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8000000){await reader.cancel();throw Error('audio_too_large');}chunks.push(value);}
   const form=new FormData();form.set('file',new Blob(chunks,{type:'audio/mp4'}),'voice.m4a');form.set('model',env.OATHRA_TRANSCRIBE_MODEL??'gpt-4o-mini-transcribe');form.set('language','ja');
   const data=await jsonFetch(fetchImpl,'https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`},body:form});return string(data.text,2000);
  },
  async send(p,{retryKey,signal,fetchImpl:sendFetch}){
   check(env.LINE_CHANNEL_ACCESS_TOKEN,'line_token_missing',503);
   const message={type:'text',text:p.text.slice(0,4900),...(p.buttons?.length?{quickReply:{items:p.buttons.map(b=>({type:'action',action:{type:'postback',label:b.label.slice(0,20),data:b.data}}))}}:{})};
   const r=await sendFetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,'content-type':'application/json','X-Line-Retry-Key':retryKey},body:JSON.stringify({to:p.destination,messages:[message]}),signal,redirect:'error'});
   check(r.ok||(r.status===409&&r.headers.has('x-line-accepted-request-id')),'line_send_failed',502);return {status:'accepted'};
  }
 });
}
