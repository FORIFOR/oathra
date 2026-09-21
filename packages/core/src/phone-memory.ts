import { EvidenceEngine, extractClaims, type Utterance } from '@oathra/evidence';
import type { PhoneRequest } from '@oathra/contract';
const fields = ['date', 'time', 'partySize', 'price', 'confirmed'] as const;
/** Calendar-only reference date for Japanese phone requests, independent of host TZ. */
export function phoneReferenceDate(timestamp: number): Date {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(timestamp);
  const value=(key:string)=>Number(parts.find(p=>p.type===key)!.value);
  return new Date(value('year'),value('month')-1,value('day'),12);
}
/** Experimental v1. Evidence-backed notes, never authorization or proof of a booking. */
export function phoneMemory(request: PhoneRequest, turns: {id?: string; source: 'caller'|'callee'; text: string; t?: number; interrupted?: boolean}[], now: number) {
  const referenceDate=phoneReferenceDate(now);
  const engine = new EvidenceEngine({ now: referenceDate, language: 'ja' });
  const requested: Record<string, unknown> = {};
  const input: Utterance = {id:'request',source:'caller',text:request.instruction,t:0};
  for (const claim of extractClaims(input, {now:referenceDate,language:'ja'})) {
    if (claim.field !== 'confirmed' && fields.includes(claim.field as typeof fields[number]) && claim.polarity === 'positive') requested[claim.field] = claim.value;
  }
  // A casual chat has no conditions to keep: a date heard in a news item is not a proposed booking date.
  if(request.conversationMode==='chat')return {version:1,timeZone:'Asia/Tokyo',referenceAt:now,turnCount:turns.length,lastTurnId:turns.at(-1)?.id??null,recipient:request.name,originalRequest:request.instruction,bookingStatus:'not_authorized' as const,notes:[],history:[]};
  turns.forEach((turn,i)=>{if(turn.interrupted)return;engine.ingest({id:turn.id??`turn-${i}`,source:turn.source,text:turn.text,t:turn.t??i+1});});
  const values=engine.values();
  const notes=fields.map(field=>{
    const pending=engine.pending(field), verified=values[field];
    const latest=verified===undefined?pending:engine.latestVerified(field);
    const value=verified??pending?.value;
    return {field,...(requested[field]!==undefined?{requested:requested[field]}:{}),...(value!==undefined?{value}:{}),status:verified!==undefined?'verified':pending?'proposed':'missing',...(latest?{source:latest.source,quote:latest.transcript}:{})};
  }).filter(n=>n.requested!==undefined||n.value!==undefined);
  return {version:1,timeZone:'Asia/Tokyo',referenceAt:now,turnCount:turns.length,lastTurnId:turns.at(-1)?.id??null,recipient:request.name,originalRequest:request.instruction,bookingStatus:'not_authorized',notes,
    history:engine.graph().nodes.filter(n=>fields.includes(n.field as typeof fields[number])).map(n=>({field:n.field,value:n.value,source:n.source,quote:n.transcript,verified:n.verified,t:n.t}))};
}
