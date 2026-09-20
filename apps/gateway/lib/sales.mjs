/** Sales verdicts.
 *
 * Whether a meeting was agreed is decided by the Oathra evidence engine (`packages/evidence`), the same
 * deterministic check behind every other Oathra result, in its appointment mode: the caller proposes a slot
 * and the callee's clean commitment confirms it. Hedges, deferrals, scheduling conflicts and refusals never do.
 * This file only adds the sales-specific facts the engine has no field for (materials permission,
 * acknowledgement, do-not-contact) and maps the engine's result onto the mission's result shape.
 *
 * This is transcript evidence, not a guarantee of ASR correctness or of a future meeting occurring. */
let EvidenceEngine, evaluate, defineCall;
try {
  ({ EvidenceEngine, evaluate } = await import('../../../packages/evidence/dist/index.js'));
  ({ defineCall } = await import('../../../packages/contract/dist/index.js'));
} catch (error) {
  throw new Error('Oathra Gateway needs the built evidence engine. Run `pnpm install --frozen-lockfile && pnpm build` in the repository root first.', { cause: error });
}
const MEETING = defineCall({ goal: 'sales.meeting', language: 'ja', require: { date: true, time: true, confirmed: true }, confirmation: 'callee_acceptance' });

// Stop-contact and refusal are deliberately broad: a false positive only suppresses a number, a false
// negative lets a person who said no be called again. Both are matched on NFKC-normalised text.
const STOP_CONTACT = /(?:今後|二度と|もう|一切).{0,12}(?:電話|連絡|営業).{0,10}(?:しない|しなくて|不要|やめ|こない|いりません|結構)|(?:電話|連絡|営業|勧誘).{0,10}(?:しないで|してこないで|こないで|不要|やめて|お断り|遠慮)|(?:かけて|掛けて|して)こないで|(?<!ご)迷惑|(?:リスト|名簿|登録).{0,8}(?:削除|外して|消して|抹消)|(?:もう|二度と)(?:いい|結構)です|do not (?:call|contact)|don't (?:call|contact)|never call|remove me|take me off|stop calling|unsubscribe/i;
const REFUSAL = /不要です|お断り|興味(?:が|は)?(?:ない|ありません|ございません)|(?<![でて])結構です|(?:いり|要り)ません|必要(?:ない|ありません|ございません)|間に合って(?:い?ます|おります)|(?:今|うち)はいいです|やめてください|not interested|no,? thank|we(?:'re| are) (?:all set|fine)/i;
const normal = t => String(t ?? '').normalize('NFKC');
export const stopContact = t => STOP_CONTACT.test(normal(t));
// 「それで結構です」 accepts; only a free-standing 「結構です」 declines.
export const refusal = { test: t => REFUSAL.test(normal(t)) };
/** The callee asked not to be called again, or declined. Either way: stop this call and suppress the number. */
export const wantsNoContact = t => stopContact(t) || refusal.test(t);
const uncertain = /仮(?:予約|押さえ)?|未確定|承認待ち|多分|たぶん|かもしれ|確認してから|検討|maybe|perhaps|tentative|not sure|pending/i;
const negative = /キャンセル|取り消|無理|できません|難しい|だめ|ダメ|変更|cancel|cannot|can't|not available/i;
const question = /[?？]|ですか|でしょうか|ませんか/;

/** Parses an explicit timestamp for follow-up scheduling input. It is not used to judge what the callee agreed to. */
export function dateTime(t, now = Date.now()) {
  const iso = t.match(/\b(20\d\d)-(\d{2})-(\d{2})[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?/);
  if (iso) {
    const [_,year,month,day,hour,minute,second='00',zone='+09:00']=iso;
    const parts=[Number(month),Number(day),Number(hour),Number(minute),Number(second)];
    if(parts[0]<1||parts[0]>12||parts[1]<1||parts[1]>31||parts[2]>23||parts[3]>59||parts[4]>59)return null;
    if(zone!=='Z'&&(Number(zone.slice(1,3))>14||Number(zone.slice(4))>59))return null;
    const value=`${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`,epoch=Date.parse(value);
    const local=Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute),Number(second));
    const check=new Date(local);
    if(!Number.isFinite(epoch)||check.getUTCMonth()+1!==Number(month)||check.getUTCDate()!==Number(day)||epoch<=now||epoch-now>180*86400_000)return null;
    return value;
  }
  const d = iso ?? t.match(/(?:(20\d\d)年\s*)?(\d{1,2})月\s*(\d{1,2})日/);
  const h = iso ? [null, '', iso[4], iso[5]] : t.match(/(午前|午後)?\s*(\d{1,2})(?:時(?:(\d{1,2})分|(半))?|:(\d{2}))/);
  if (!d || !h) return null;
  const localYear = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Tokyo' }).format(now));
  const y = Number(d[1] ?? localYear), mo = Number(d[2]), day = Number(d[3]);
  let hour = iso ? Number(iso[4]) : Number(h[2]);
  const minute = iso ? Number(iso[5]) : h[4] ? 30 : Number(h[3] ?? h[5] ?? 0);
  if (!iso && h[1] === '午後' && hour < 12) hour += 12;
  if (!iso && h[1] === '午前' && hour === 12) hour = 0;
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const value = `${y}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+09:00`;
  const epoch = Date.parse(value);
  const check = new Date(epoch + 9 * 3600_000);
  if (check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== day || epoch <= now || epoch - now > 180 * 86400_000) return null;
  return value;
}
/** The agreed instant, or null when the engine has not settled date, time and the callee's commitment. */
function agreedMeeting(turns, mission, now) {
  const engine = new EvidenceEngine({ language: 'ja', now: new Date(now), confirmation: 'callee_acceptance' });
  turns.forEach((turn, index) => {
    const text = String(turn.text ?? '').normalize('NFKC').trim();
    if ((turn.source === 'caller' || turn.source === 'callee') && text) engine.ingest({ id: String(turn.id ?? `turn-${index}`), source: turn.source, text, t: index });
  });
  const result = evaluate(MEETING, engine, 'completed');
  if (!result.complete) return null;
  const value = `${result.fields.date}T${result.fields.time}:00+09:00`, epoch = Date.parse(value);
  // Evidence of a slot in the past, or implausibly far ahead, is not a meeting.
  if (!Number.isFinite(epoch) || epoch <= now || epoch - now > 180 * 86400_000) return null;
  if (mission.candidateSlots?.length && !mission.candidateSlots.some(s => Date.parse(s) === epoch)) return null;
  const commitment = [...result.evidence].reverse().find(e => e.field === 'confirmed' && e.source === 'callee' && e.verified);
  const proposal = result.evidence.find(e => e.field === 'date' && e.source === 'caller' && e.verified);
  return { value, turn: commitment?.utteranceId, quote: commitment?.transcript, proposal: proposal?.transcript };
}

export function evaluateSales(turns, mission, connected, now = Date.now()) {
  if (mission.kind === 'phone-request') {
    const doNotContact = turns.some(t=>t.source==='callee' && wantsNoContact(t.text));
    return {status:doNotContact?'DECLINED':'INCOMPLETE',verified:{},evidence:[],doNotContact,
      caveat:'通話の記録です。依頼が達成されたかは会話内容を確認してください。'};
  }
  const evidence = []; let material = false, acknowledged = false, declined = false, dnc = false;
  for (const [index, turn] of turns.entries()) {
    const t = String(turn.text ?? '').normalize('NFKC');
    if (turn.source !== 'callee') continue;
    const ref = { turn: turn.id ?? `turn-${index}`, source: 'callee', quote: t.slice(0, 600) };
    if (stopContact(t) || refusal.test(t)) { declined = true; dnc = true; material = false; evidence.push({ ...ref, field: 'do_not_contact', value: true }); }
    if (negative.test(t) || uncertain.test(t)) material = false;
    if (!dnc && !negative.test(t) && !uncertain.test(t) && !question.test(t)) {
      if (/(?:資料|パンフレット).{0,12}(?:送ってください|送付してください|送ってもらえます)|please send (?:me )?(?:the )?(?:material|brochure|deck)/i.test(t)) { material = true; evidence.push({ ...ref, field: 'material_send_allowed', value: true }); }
      if (/説明(?:を)?(?:ありがとう|理解しました)|説明.{0,8}わかりました|thank you for (?:the )?explanation/i.test(t)) { acknowledged = true; evidence.push({ ...ref, field: 'presentation_acknowledged', value: true }); }
    }
  }
  const meeting = dnc ? null : agreedMeeting(turns, mission, now);
  if (meeting) evidence.push({ turn: meeting.turn, source: 'callee', quote: String(meeting.quote ?? '').slice(0, 600), field: 'meeting_agreed_on_call', value: meeting.value, ...(meeting.proposal ? { confirmedProposal: meeting.proposal.slice(0, 600) } : {}) });
  const verified = { ...(material ? { material_send_allowed: true } : {}), ...(acknowledged ? { presentation_acknowledged: true } : {}), ...(meeting ? { meeting_agreed_on_call: meeting.value } : {}) };
  const required = mission.goal === 'meeting' ? 'meeting_agreed_on_call' : mission.goal === 'materials' ? 'material_send_allowed' : 'presentation_acknowledged';
  return { status: declined ? 'DECLINED' : connected && verified[required] ? 'COMPLETED' : 'INCOMPLETE', verified,
    missing: verified[required] ? [] : [required], evidence, doNotContact: dnc,
    proofLevel: 'conversation', caveat: '電話の文字起こしに基づく判定です。招待承諾や実施結果とは別です。' };
}
