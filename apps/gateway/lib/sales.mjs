/** Conservative transcript evaluation. Supported expressions are intentionally bounded and tested.
 * This is transcript evidence, not a guarantee of ASR correctness or of a future meeting occurring. */
export const stopContact = t => /(?:今後|二度と|もう).{0,12}(?:電話|連絡).{0,8}(?:しない|しなくて|不要|やめ)|(?:電話|連絡).{0,8}(?:しないで|不要|やめて)|do not (?:call|contact)|don't (?:call|contact)|remove me|stop calling/i.test(t);
export const refusal = /(?:不要です|お断り|興味(?:が)?(?:ない|ありません)|結構です|not interested)/i;
const uncertain = /仮(?:予約|押さえ)?|未確定|承認待ち|多分|たぶん|かもしれ|確認してから|検討|maybe|perhaps|tentative|not sure|pending/i;
const negative = /キャンセル|取り消|無理|できません|難しい|だめ|ダメ|変更|cancel|cannot|can't|not available/i;
const agreement = /お願いします|承知(?:しました|いたしました)|大丈夫です|確定です|お待ちしています|お約束します|confirmed|works for me|sounds good/i;
const bareYes = /^(?:はい|ええ|承知しました|お願いします|大丈夫です|yes|confirmed|sounds good)[。.!！\s]*$/i;
const question = /[?？]|ですか|でしょうか|ませんか/;

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
export function evaluateSales(turns, mission, connected, now = Date.now()) {
  const evidence = []; let meeting = null, material = false, acknowledged = false, declined = false, dnc = false;
  let previous = null;
  for (const [index, turn] of turns.entries()) {
    const t = String(turn.text ?? '').normalize('NFKC');
    if (turn.source === 'callee') {
      const ref = { turn: turn.id ?? `turn-${index}`, source: 'callee', quote: t.slice(0, 600) };
      if (stopContact(t) || refusal.test(t)) { declined = true; dnc = true; meeting = null; material = false; evidence.push({ ...ref, field: 'do_not_contact', value: true }); }
      if (negative.test(t) || uncertain.test(t)) { meeting = null; material = false; }
      if (!dnc && !negative.test(t) && !uncertain.test(t) && !question.test(t)) {
        if (/(?:資料|パンフレット).{0,12}(?:送ってください|送付してください|送ってもらえます)|please send (?:me )?(?:the )?(?:material|brochure|deck)/i.test(t)) { material = true; evidence.push({ ...ref, field: 'material_send_allowed', value: true }); }
        if (/説明(?:を)?(?:ありがとう|理解しました)|説明.{0,8}わかりました|thank you for (?:the )?explanation/i.test(t)) { acknowledged = true; evidence.push({ ...ref, field: 'presentation_acknowledged', value: true }); }
        let dt = agreement.test(t) ? dateTime(t, now) : null;
        if (!dt && bareYes.test(t.trim()) && previous?.source === 'caller' && /商談|打ち合わせ|お打合せ|meeting/i.test(previous.text) && !uncertain.test(previous.text) && !negative.test(previous.text)) dt = dateTime(previous.text, now);
        if (dt && (!mission.candidateSlots?.length || mission.candidateSlots.some(s => Date.parse(s) === Date.parse(dt)))) {
          meeting = dt; evidence.push({ ...ref, field: 'meeting_agreed_on_call', value: dt, ...(bareYes.test(t.trim()) ? { confirmedProposal: previous?.text?.slice(0, 600) } : {}) });
        }
      }
    }
    previous = turn;
  }
  const verified = { ...(material ? { material_send_allowed: true } : {}), ...(acknowledged ? { presentation_acknowledged: true } : {}), ...(meeting ? { meeting_agreed_on_call: meeting } : {}) };
  const required = mission.goal === 'meeting' ? 'meeting_agreed_on_call' : mission.goal === 'materials' ? 'material_send_allowed' : 'presentation_acknowledged';
  return { status: declined ? 'DECLINED' : connected && verified[required] ? 'COMPLETED' : 'INCOMPLETE', verified,
    missing: verified[required] ? [] : [required], evidence, doNotContact: dnc,
    proofLevel: 'conversation', caveat: '電話の文字起こしに基づく判定です。招待承諾や実施結果とは別です。' };
}
