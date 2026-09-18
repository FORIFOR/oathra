import { timingSafeEqual } from 'node:crypto';
// A self-contained external-reference plugin: no gateway imports and no access to approval issuance.
export default function create({env,fetchImpl=fetch,now=Date.now}) {
 const request=async(method,body,signal=AbortSignal.timeout(12000))=>{
  if(!/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN??''))throw Error('telegram_not_configured');
  const r=await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal,redirect:'error'});
  if(!r.ok)throw Error('telegram_request_failed');const d=await r.json();if(!d.ok)throw Error('telegram_request_failed');return d.result;
 };
 return {
  ready:()=>!!(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_WEBHOOK_SECRET),
  verify(raw,headers){const actual=headers['x-telegram-bot-api-secret-token'];if(typeof actual!=='string'||!env.TELEGRAM_WEBHOOK_SECRET)return false;
   const x=Buffer.from(actual),y=Buffer.from(env.TELEGRAM_WEBHOOK_SECRET);return x.length===y.length&&timingSafeEqual(x,y);},
  decode(raw){const d=JSON.parse(raw),q=d.callback_query,m=q?.message??d.message,from=q?.from??m?.from;
   if(!Number.isSafeInteger(d.update_id)||d.update_id<0||m?.chat?.type!=='private'||from?.is_bot||!Number.isSafeInteger(from?.id)||from.id<=0||m.chat.id!==from.id)return {events:[]};
   if(!q&&(!Number.isFinite(m.date)||Math.abs(m.date*1000-now())>86400000))return {events:[]};
   if(!q&&typeof m.text!=='string')return {events:[]};
   return {events:[{eventId:String(d.update_id),actor:String(from.id),destination:String(m.chat.id),sourceMessageId:String(m.message_id),type:q?'action':'message',...(q?{action:q.data,ackId:q.id}:{text:m.text})}]};
  },
  async acknowledge(e){await request('answerCallbackQuery',{callback_query_id:e.ackId});},
  async send(p,{signal}){
   const buttons=(p.buttons??[]).map(b=>{if(Buffer.byteLength(b.data)>64)throw Error('telegram_callback_too_long');return {text:b.label,callback_data:b.data};});
   const d=await request('sendMessage',{chat_id:p.destination,text:p.text.slice(0,4000),...(buttons.length?{reply_markup:{inline_keyboard:[buttons]}}:{})},signal);
   return {status:'accepted',providerId:String(d.message_id)};
  }
 };
}
