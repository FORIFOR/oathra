import { createHash } from 'node:crypto';
import { defineChannel } from '../../sdk/channel-sdk/index.mjs';
import { check, string, equal, hmac, jsonFetch } from '../_shared/http.mjs';
export default function create({env,now=Date.now}) {
 const normalize=e=>{
  const channel=e.channel?.id??e.event?.channel??e.channel_id;
  if(e.event?.bot_id||e.event?.subtype)return null;
  if(e.type==='block_actions'){if(typeof channel!=='string'||!channel.startsWith('D'))return null;}
  else if(e.event?.channel_type!=='im'&&e.channel_name!=='directmessage')return null;
  const team=e.team_id??e.team?.id,user=e.user?.id??e.event?.user??e.user_id;
  if(typeof team!=='string'||typeof user!=='string'||typeof channel!=='string')return null;
  return {eventId:e.event_id??'legacy',actor:`${team}:${user}`,destination:channel,type:e.actions?.[0]?.value?'action':'message',text:e.event?.text??e.text??'',action:e.actions?.[0]?.value};
 };
 return defineChannel({
  ready:()=>!!(env.SLACK_SIGNING_SECRET&&env.SLACK_BOT_TOKEN),
  verify(raw,headers){const ts=headers['x-slack-request-timestamp'];return !!env.SLACK_SIGNING_SECRET&&typeof ts==='string'&&/^\d+$/.test(ts)&&Math.abs(Number(ts)*1000-now())<=300000&&equal('v0='+hmac(env.SLACK_SIGNING_SECRET,Buffer.concat([Buffer.from(`v0:${ts}:`),raw]),'hex'),headers['x-slack-signature']);},
  decode(raw,headers){let d=String(headers['content-type']).includes('application/json')?JSON.parse(raw):Object.fromEntries(new URLSearchParams(raw.toString()));if(d.payload)d=JSON.parse(d.payload);
   if(d.type==='url_verification')return {events:[],response:{challenge:string(d.challenge,200)}};
   const e=normalize(d);if(e)e.eventId=d.event_id??createHash('sha256').update(raw).digest('hex');return {events:e?[e]:[]};},
  legacyEvent:normalize,
  async send(p,{signal,fetchImpl}){check(env.SLACK_BOT_TOKEN,'slack_token_missing',503);
   const blocks=[{type:'section',text:{type:'plain_text',text:p.text.slice(0,2900)}}];
   if(p.buttons?.length)blocks.push({type:'actions',elements:p.buttons.map((b,i)=>({type:'button',text:{type:'plain_text',text:b.label},action_id:`oathra_${i}`,value:b.data}))});
   const d=await jsonFetch(fetchImpl,'https://slack.com/api/chat.postMessage',{method:'POST',headers:{authorization:`Bearer ${env.SLACK_BOT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({channel:p.destination,text:p.text.slice(0,2900),blocks}),signal});check(d.ok,'slack_send_failed',502);return {status:'accepted',providerId:d.ts};
  }
 });
}
