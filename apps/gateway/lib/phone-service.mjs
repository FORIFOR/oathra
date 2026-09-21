import { phoneMemory } from '../../../packages/core/dist/index.js';
import { PhoneRequestSchema, PHONE_PURPOSE_TEMPLATES, PHONE_VOICES, DEFAULT_PHONE_VOICE } from '../../../packages/contract/dist/index.js';
import { assert } from './security.mjs';
import { readFileSync } from 'node:fs';

/**
 * What was measured about each voice (scripts/voice-samples.mjs): median pitch and how long the same sentence
 * takes. The words derived from it describe how high and how fast a voice is. A file cannot say who a voice is,
 * so nothing here claims a gender; the picker offers a sample to listen to instead.
 */
function voiceDetails() {
 try {
  const measured=JSON.parse(readFileSync(new URL('../public/phone/voices/voices.json',import.meta.url),'utf8')).voices??{};
  return Object.fromEntries(PHONE_VOICES.filter(v=>Number.isFinite(measured[v]?.pitchHz)).map(v=>{const {pitchHz,seconds}=measured[v];
   return [v,{pitchHz,seconds,pitch:pitchHz<150?'low':pitchHz<195?'mid':pitchHz<250?'high':'very-high',pace:seconds<=5.2?'fast':seconds>=6.4?'slow':'medium',sample:`/phone/voices/${v}.wav`}];}));
 } catch { return {}; }
}
const VOICE_DETAILS=voiceDetails();

export function phoneReadiness(service,config,user) {
 const ready=config.mode==='live'&&config.liveReady;
 const issues=ready?[]:[config.mode==='simulator'?'確認用の環境です。実発信はできません。':'サービスの電話接続を準備中です。管理者へお問い合わせください。'];
 if(!ready&&user?.role==='admin') {
  const labels={TWILIO_ACCOUNT_SID:'電話会社のアカウント',TWILIO_AUTH_TOKEN:'電話会社の認証',TWILIO_PHONE_NUMBER:'発信元の番号',OPENAI_API_KEY:'音声AIの認証',OATHRA_VOICE_MODEL:'音声モデル',OATHRA_BUSINESS_NAME:'相手に名乗る運営者名',OATHRA_RATE_CEILING_USD:'通信費の上限単価',OATHRA_LIVE_POLICY_REVIEWED:'運営方針の確認'};
  if(!config.publicUrl.startsWith('https:'))issues.push('公開HTTPS接続の設定が必要です。');
  const missing=(config.missing??[]).map(k=>labels[k]).filter(Boolean);
  if(missing.length)issues.push('未設定：'+missing.join('、')+'。');
  issues.push('運営者の設定が整えば、利用者はこの画面から発信できます。');
 }
 return {ready,provider:'Twilio',engine:'OpenAI',recording:false,voices:[...PHONE_VOICES],defaultVoice:DEFAULT_PHONE_VOICE,voiceDetails:VOICE_DETAILS,newsAvailable:config.newsAvailable===true,
  issues,
  disclosure:'AI代理であることを相手に伝えます。電話番号・音声・文字起こしはTwilioとOpenAIへ送信し、会話と結果をサービスに保存します。音声ファイルは保存しません。'+(config.billing?.settlement==='usage-rate-v1'?'残高の範囲で上限額を確保し、使用額が上限に達すると通話を終了します。使用量の通知や停止の遅れによる超過は運営者負担です。終了時に回線時間・音声AI・検索の使用量と単価で精算、余剰を返却します。後日の追加徴収なし。文字起こし・税等と計測できなかった費用は運営者負担。':service.credits.quote(config.mode).policy==='provider-cost-v1'?'最大額を一時確保し、終了後に電話回線の料金と音声AIの使用量で精算・差額返却します。文字起こし・音声中継・税等は運営者負担。料金未取得時は精算待ちです。':'発信処理の実行確定時にクレジットを消費し、接続前の障害・不応答も対象です。実行前の取消は返却します。'),
  creditQuote:service.credits.quote(config.mode)};
}
export function phoneRecord(service,m) {
 const transcript=m.transcript??service.store.events(m.id,m.owner).filter(e=>e.type==='transcript.final').map(e=>({id:e.turnId,source:e.source,text:e.text,t:e.t,...(e.interrupted?{interrupted:true}:{})}));
 const reachedTimeLimit=!m.stopReason&&!m.stopNeedsReconciliation&&['INCOMPLETE','COMPLETED'].includes(m.status)&&m.carrierStatus==='completed'&&m.maxSeconds>0&&m.billing?.carrier?.durationSeconds>=m.maxSeconds;
 const map={DRAFT:'draft',QUEUED:'starting',DIALING:'starting',ACTIVE:'running',CANCEL_REQUESTED:'stopping',UNKNOWN:'unknown',FAILED:'failed',CANCELLED:'ended',COMPLETED:'ended',INCOMPLETE:'ended',DECLINED:'ended'};
 return {id:m.id,request:m.phoneRequest,memory:m.memory?.turnCount===transcript.length&&m.memory?.lastTurnId===(transcript.at(-1)?.id??null)?m.memory:phoneMemory(m.phoneRequest,transcript,m.approvedAt??m.createdAt),state:map[m.status]??'unknown',createdAt:new Date(m.createdAt).toISOString(),updatedAt:new Date(m.finishedAt??m.approvedAt??m.createdAt).toISOString(),creditState:service.credits.status(m),creditQuote:m.creditQuote,creditUsage:service.credits.usage(m),
  billing:m.billing?{state:m.billing.state,durationSeconds:m.billing.carrier?.durationSeconds,cost:m.billing.cost}:undefined,
  news:service.store.events(m.id,m.owner).filter(e=>e.type==='news.lookup').map(e=>e.result),
  spending:m.billing?.spending,error:m.stopReason==='credit_limit'?'credit_limit_reached':reachedTimeLimit?'call_time_limit_reached':m.error,summary:m.stopReason==='credit_limit'&&!m.stopNeedsReconciliation&&['CANCELLED','INCOMPLETE','FAILED'].includes(m.status)?'利用クレジットの上限に達したため通話を終了しました。':reachedTimeLimit?`通話時間の上限（${m.maxSeconds}秒）に達しました。`:m.result?.caveat,transcript,persistence:'saved'};
}
/**
 * A calendar entry from the call memo, for the caller's own calendar. It records what was said on the
 * phone; it is never evidence of a booking, and says so in its title and body. No account or token is
 * involved: the owner downloads the file and their own calendar app imports it.
 */
export function phoneCalendar(service,m,now=service.store.now()) {
 const record=phoneRecord(service,m),note=field=>record.memory?.notes.find(n=>n.field===field),date=note('date'),time=note('time');
 const day=String(date?.value??''),clock=String(time?.value??'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}$/.test(clock))return null;
 // RFC 5545 text: escape separators, fold nothing by hand beyond newlines (clients accept long lines).
 const text=value=>String(value).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/([,;])/g,'\\$1');
 const local=(d,t)=>d.replaceAll('-','')+'T'+t.replace(':','')+'00';
 const [h,min]=clock.split(':').map(Number),end=new Date(Date.UTC(2000,0,1,h,min)+3600000),endDay=end.getUTCDate()===1?day:new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const settled=date.status==='verified'&&time.status==='verified',labels={date:'日付',time:'時刻',partySize:'人数',price:'料金',confirmed:'相手の確認発言'},state={verified:'会話で確認',proposed:'提案・未確認',missing:'未確認'};
 const lines=['電話で話した内容の記録です。予約の成立を保証するものではありません。',...(settled?[]:['日時は相手の提案または未確認の内容です。確定していません。']),'',
  ...record.memory.notes.map(n=>`${labels[n.field]??n.field}：${state[n.status]}${n.value!==undefined?' '+n.value:''}${n.quote?`（「${n.quote}」）`:''}`),'','依頼内容：'+m.request];
 const stamp=new Date(now).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Oathra//Phone memo//JA','CALSCALE:GREGORIAN','METHOD:PUBLISH',
  'BEGIN:VTIMEZONE','TZID:Asia/Tokyo','BEGIN:STANDARD','DTSTART:19700101T000000','TZOFFSETFROM:+0900','TZOFFSETTO:+0900','TZNAME:JST','END:STANDARD','END:VTIMEZONE',
  'BEGIN:VEVENT','UID:'+m.id+'@oathra','DTSTAMP:'+stamp,'DTSTART;TZID=Asia/Tokyo:'+local(day,clock),'DTEND;TZID=Asia/Tokyo:'+local(endDay,String(end.getUTCHours()).padStart(2,'0')+':'+String(end.getUTCMinutes()).padStart(2,'0')),
  'SUMMARY:'+text(`${settled?'【電話で確認】':'【未確定】'}${m.target.name}`),'DESCRIPTION:'+text(lines.join('\n')),'STATUS:'+(settled?'CONFIRMED':'TENTATIVE'),'TRANSP:'+(settled?'OPAQUE':'TRANSPARENT'),'END:VEVENT','END:VCALENDAR',''].join('\r\n');
}
export function prepareManagedPhone(service,u,input) {
 service.write(u);const request=PhoneRequestSchema.parse({...input,schemaVersion:1,kind:'oathra.phone-request'});
 const config=service.config;
 const balanceLimited=service.credits.enabled&&config.mode==='live'&&config.billing?.settlement==='usage-rate-v1';
 const maxSeconds=balanceLimited?config.maxSeconds:Math.min(180,config.maxSeconds);
 const m={id:crypto.randomUUID(),owner:u.id,team:u.team,revision:1,status:'DRAFT',kind:'phone-request',phoneRequest:request,
  target:{name:request.name,phone:request.phone},request:request.instruction,goal:'phone.message',product:null,candidateSlots:[],testOnMe:false,mode:config.mode,
  maxSeconds,maxUsd:config.maxCallUsd,estimatedMaximumUsd:config.mode==='live'?Math.ceil((maxSeconds+30)/60)*config.rateCeilingUsd*2+config.setupFeeUsd:0,
  creditQuote:service.credits.quote(config.mode,request.phone,balanceLimited?service.credits.balance(u.id).available:undefined),callerId:config.callerId??'simulator',callPluginIdentity:config.callPluginIdentity??null,createdAt:service.store.now(),origin:null,result:null};
 // Balance-limited calls stop at their held budget; the full time ceiling is not prepaid.
 if(balanceLimited)m.estimatedMaximumUsd=Math.min(m.estimatedMaximumUsd,m.maxUsd,m.creditQuote.amount*m.creditQuote.creditUsd);
 assert(m.estimatedMaximumUsd<=m.maxUsd,'estimated_cost_exceeds_budget');service.store.put('mission',m);return m;
}
export { PHONE_PURPOSE_TEMPLATES, PHONE_VOICES };
