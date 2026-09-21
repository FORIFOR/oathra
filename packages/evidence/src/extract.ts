/**
 * Claim extraction: utterance -> candidate claims per clause.
 *
 * Utterances are split into clauses so that a refusal ("19時はいっぱいですが")
 * does not produce an offer for 19:00 while the following clause
 * ("19時半なら空いております") does.
 */
import { parseDates, parsePartySize, parsePhoneNumbers, parsePrices, parseSerials, parseTimes } from "./normalize.js";
import type { Language, Speaker, Utterance } from "./types.js";

export type Polarity = "positive" | "negative";

export type Clause = { text: string; polarity: Polarity; offset: number };

export type Claim = {
  field: string;
  value: unknown;
  span: string;
  semantic: number;
  polarity: Polarity;
  ambiguous?: boolean;
};

const NEGATIVE_JA =
  /いっぱい|満席|満室|空い(?:て|ており)(?:ません|おりません|ない)|できません|できかねます|難しい|無理|(?<!問題(?:は)?)ございません|(?<!問題(?:は)?)ありません|承れません|お受けできません|いたしかねます|致しかねます|お断り|なりません|なりかねます|かねます|承ることができません|不可|別の(?:会議|予定|用事|打ち?合わせ)|予定が(?:入って|あり|ござい)|先約|出張|都合が(?:悪|つきま|つかな)|埋まって|できまへん|でけへん|あきまへん|あかん/;
const NEGATIVE_EN =
  /\b(not available|fully booked|no availability|unavailable|can't|cannot|unable|no longer|sold out|full\b|isn't possible|not possible|don't have|do not have|already have (?:a|another) (?:meeting|appointment)|doesn't work|does not work|won't work)\b/i;

export const REFUSAL_RE = new RegExp(`${NEGATIVE_JA.source}|${NEGATIVE_EN.source}`, "i");

/** Explicit reservation confirmation by the callee. Only these phrases count. */
export const CONFIRMATION_RE =
  /ご予約(?:を)?(?:承り|お取り|お受け|確定|お受けいたし|承っ)|承りました|お取りしました|お取りいたしました|確保(?:いたし|し)ました|確定(?:いたし|し)ました|予約完了|お席をご用意|(?:ご)?予約(?:を)?(?:いたし|し|させていただき|を入れ)ました|(?:お)?押さえ(?:いたし|し|ておき)?ました|手配(?:いたし|し)ました|(?:ご)?用意(?:いたし|し)ました|(?:取|と)っといた|入れといた|押さえといた|(?:取|と)ったで|入れたで|押さえたで|(?:reservation|booking|table|room)\s+(?:is|has been)\s+(?:confirmed|booked|reserved|set)|\b(?:confirmed|booked|reserved|all set)\b|(?:you're|you are) (?:all set|booked)|I've (?:booked|reserved|confirmed)|(?:we|I) (?:have|'ve) (?:you|your (?:table|room|party)) (?:down|booked|reserved)|(?:you're|you are) down for/i;

/**
 * A commitment in the present/future tense ("…でご予約いたします"). On its own it is an intention,
 * not evidence; the engine counts it only as the answer to the caller's explicit confirmation
 * question, and only when the utterance restates the terms (date/time/price/party).
 */
export const COMMIT_RE = /(?:ご)?予約(?:を)?(?:いたします|させていただきます|お取りします|お取りいたします|お受けします|お受けいたします)|(?:お)?押さえ(?:ておき|いたし|し)ます|手配(?:いたし|し)ます|(?:I(?:'ll| will) (?:book|reserve) (?:that|it|you))/i;

/** Callee agrees to a value the caller proposed. */
export const AGREEMENT_RE =
  /かしこまりました|(?:取|と)っといた|入れといた|押さえといた|(?:取|と)ったで|入れたで|押さえたで|ええよ|ええで|大丈夫やで|合うてる|合うとる|承知(?:いたし|し)ました|大丈夫です|問題ございません|空いております|空いています|ご用意できます|お取りできます|承りました|了解|合っております|合っています|その通りです|間違いございません|間違いありません|相違(?:ございません|ありません)|正しいです|certainly|of course|sure\b|available|we can do|no problem|that works|absolutely|yes\b|sounds good|correct|that.s right|exactly|\ball set\b|(?:we|I) (?:have|'ve) (?:you|your (?:table|room|party)) (?:down|booked|reserved)/i;

/** "承知しました、ですが…": an agreement followed by a contrast is not a clean yes. */
export const CONTRAST_RE = /ですが|ますが|けど|けれど|しかし|ただし|ただ(?!いま|今|ちに)|とはいえ|と言いたいところ|\bbut\b|however|although/i;

/** Caller accepts a value the callee offered. */
export const ACCEPTANCE_RE =
  /でお願い(?:します|いたします|できますか)|で大丈夫です|で結構です|でけっこうです|で構いません|それでお願い|はい[、,]?\s*お願いします|お願いします|それで大丈夫|大丈夫です|了解です|わかりました|that works|sounds good|let's do|let's go with|yes,?\s*please|I'll take|we'll take|perfect|great,? thank/i;

/**
 * Hedges: a clause that hedges is neither a confirmation nor an agreement.
 * "予約を取れると思います" / "たぶん大丈夫です" must never settle a field.
 */
export const HEDGE_RE =
  /と思います|と思う|たぶん|多分|おそらく|恐らく|かもしれません|かもしれない|確認してみ|確認いたします|確認します|調べてみ|仮(?:の)?(?:押さえ|予約|受付|確保)|未確定|正式な確定ではありません|本予約では(?:ありません|ない)|承認待ち|確認待ち|確認が必要|確約(?:は)?(?:できません|できない)|保留扱い|調整中|確認中|確認してから|キャンセル待ち|確定前|見込み|(?:聞いて|相談して|確認して|検討して)から|折り返し|持ち帰|検討(?:し|させ|いたし)ます|それから(?:判断|決め|お返事)|判断(?:し|いたし)ます|と言いたいところ|約束(?:は)?でき|get back to you|need to (?:ask|check with)|check with my|run it by|probably|maybe|perhaps|I think|let me check|not sure|I'll check|might be/i;

/** Split text into clauses with a polarity. */
export function splitClauses(text: string): Clause[] {
  const parts: Clause[] = [];
  // Protect thousands separators ("21,100") and decimal points so they do not split a clause.
  const guarded = text.replace(/(\d)[,.](\d{3})(?!\d)/g, "$1\u0000$2").replace(/(\d)\.(\d)/g, "$1\u0001$2");
  const unguard = (s: string) => s.replace(/\u0000/g, ",").replace(/\u0001/g, ".");
  const re = /[^。．.!?！？、,;]+[。．.!?！？、,;]?/g;
  for (const m of guarded.matchAll(re)) {
    const raw = unguard(m[0]);
    if (!raw.trim()) continue;
    parts.push({ text: raw, polarity: "positive", offset: m.index ?? 0 });
  }
  // Split further on Japanese contrastive が / ですが / but so that
  // "19時はいっぱいですが19時半なら空いております" becomes two clauses.
  const out: Clause[] = [];
  for (const c of parts) {
    const sub = c.text.split(/(?<=ですが|ますが|けど|けれど|but\s)/);
    let off = c.offset;
    for (const s of sub) {
      if (s.trim()) out.push({ text: s, polarity: REFUSAL_RE.test(s) ? "negative" : "positive", offset: off });
      off += s.length;
    }
  }
  return out;
}

export const SERIAL_CUE_RE = /シリアル|serial|製造番号|型番|管理番号|S\/N|コード|code\b/i;

export type ExtractOptions = {
  now: Date;
  language: Language;
};

const BOOLEAN_FIELDS: Array<{ field: string; yes: RegExp; no: RegExp }> = [
  {
    field: "breakfast",
    yes: /朝食(?:付き|付|込み|込|あり|をお付け|をおつけ|付きで|も含|込みで)(?!ません|ておりません|ていません|ない)|朝食は(?:含まれ|付い)(?:て|ており)?(?!ません|おりません|いません|ない)|breakfast (?:is )?included|with breakfast|includes breakfast|comes with breakfast/i,
    no: /朝食(?:なし|は付き?ません|は付い(?:て|ており)?(?:ません|おりません|いません|ない)|は含まれ(?:て|ており)?(?:ません|おりません|いません|ない)|は別|別|抜き|は(?:お)?付けできません)|no breakfast|without breakfast|breakfast (?:is )?not included|breakfast(?:'s| is)? not (?:included|available)/i,
  },
  {
    field: "smoking",
    yes: /喫煙(?:席|ルーム|室|可)|smoking (?:room|section|seat)/i,
    no: /禁煙(?:席|ルーム|室)?|non-?smoking/i,
  },
];

/** Extract claims from a single utterance. */
export function extractClaims(u: Utterance, opts: ExtractOptions): Claim[] {
  const lang = u.language ?? opts.language;
  const claims: Claim[] = [];

  const clauses = splitClauses(u.text);
  const polarityAt = (index: number): Polarity =>
    clauses.find((c) => index >= c.offset && index < c.offset + c.text.length)?.polarity ?? "positive";

  // Serials are spoken with separators ("R、Z、7…"), so they are parsed on the whole utterance.
  // A bare alphanumeric token is only a serial when the utterance says so ("シリアル番号は…") or when it is
  // spelled out character by character; otherwise product names like "gpt-4o-mini" would become evidence.
  const serialCue = SERIAL_CUE_RE.test(u.text);
  for (const p of parseSerials(u.text)) {
    // spelled out = at least four one- or two-character groups ("R、Z、7、K"), not an English sentence
    const groups = p.span.trim().split(/[、,\s-]+/).filter(Boolean);
    const spelled = groups.length >= 4 && groups.every((g) => g.length <= 2);
    if (!serialCue && !spelled) continue;
    claims.push({ field: "serial", value: p.value, span: p.span, semantic: 0.9, polarity: polarityAt(p.index) });
  }

  for (const clause of clauses) {
    const text = clause.text;
    for (const t of parseTimes(text, lang)) {
      claims.push({ field: "time", value: t.ambiguous ? null : t.value, span: t.span, semantic: t.ambiguous ? 0.5 : 0.95, polarity: clause.polarity, ...(t.ambiguous ? { ambiguous: true } : {}) });
    }
    for (const d of parseDates(text, opts.now, lang)) {
      claims.push({ field: "date", value: d.value, span: d.span, semantic: /\d/.test(d.span) ? 0.95 : 0.9, polarity: clause.polarity });
    }
    for (const p of parsePartySize(text, lang)) {
      claims.push({ field: "partySize", value: p.value, span: p.span, semantic: 0.93, polarity: clause.polarity });
    }
    for (const p of parsePrices(text)) {
      claims.push({ field: "price", value: p.value, span: p.span, semantic: 0.94, polarity: clause.polarity });
    }
    for (const p of parsePhoneNumbers(text)) {
      claims.push({ field: "phone", value: p.value, span: p.span, semantic: 0.9, polarity: clause.polarity });
    }
    for (const b of BOOLEAN_FIELDS) {
      const no = text.match(b.no);
      const yes = text.match(b.yes);
      if (no) claims.push({ field: b.field, value: false, span: no[0], semantic: 0.92, polarity: clause.polarity });
      else if (yes) claims.push({ field: b.field, value: true, span: yes[0], semantic: 0.92, polarity: clause.polarity });
    }
    // a hedge anywhere in the utterance ("たぶん…、承りました") disqualifies the confirmation,
    // and so does a retraction later in the same utterance ("承りました。……やはりお取りできませんでした")
    const later = u.text.slice(clause.offset + clause.text.length);
    if (clause.polarity === "positive" && !HEDGE_RE.test(text) && !HEDGE_RE.test(u.text) && !RETRACTION_RE.test(later)) {
      const c = text.match(CONFIRMATION_RE);
      if (c) claims.push({ field: "confirmed", value: true, span: c[0], semantic: 0.97, polarity: "positive" });
    }
  }
  return claims;
}

/** The caller walks away: "わかりました" next to this is not an acceptance. */
export const DECLINE_RE =
  /見送|他の(?:ホテル|お店|店|ところ|日|所)|別の(?:ホテル|お店|店|ところ|日|所)|他を(?:当た|探)|探(?:し|させ)|遠慮|やめ|キャンセル|検討(?:し|させ)|look elsewhere|another (?:hotel|place|restaurant|time)|no,? thank|pass on|think about it/i;

export function isAcceptance(text: string, source: Speaker): boolean {
  return source === "caller" && ACCEPTANCE_RE.test(text) && !REFUSAL_RE.test(text) && !DECLINE_RE.test(text);
}

/**
 * The caller asks a yes/no question that, answered "yes", commits the callee to
 * the reservation/order: 「…でご予約を確定してもよろしいでしょうか？」
 * Statements ("その内容で予約をお願いします") are NOT requests: a polite
 * 「かしこまりました」 to a statement is an acknowledgement, not a commitment.
 */
export const CONFIRM_REQUEST_RE =
  /(?:予約|ご予約|注文|ご注文|購入)[^。！？!?]*?(?:確定|確保|お取り|お願い)[^。！？!?]*?(?:よろしい(?:でしょうか|ですか)|いい(?:でしょうか|ですか)|大丈夫(?:でしょうか|ですか)|できますか|可能でしょうか)|(?:can|could) (?:you|we) confirm (?:the|my) (?:reservation|booking|order)\??|is (?:the|my) (?:reservation|booking|order) confirmed\?/i;

/**
 * A real "yes" to a confirmation question: starts with an affirmative, carries
 * no counter-question, and is not a hedge. A re-quote such as
 * 「禁煙のお部屋でしたらご用意できます。1泊19,900円でございます。」 is not an answer.
 */
export const AFFIRMATIVE_RE =
  /^[\s「]*(?:はい|ええ|そうです|大丈夫です|問題ございません|問題ありません|かしこまりました|承知(?:いたし|し)ました|もちろん|了解(?:です|しました)|お願いします|yes|sure|of course|certainly|absolutely|that works|sounds good|correct)/i;

export function isAffirmativeAnswer(text: string): boolean {
  const t = text.trim();
  if (!t || HEDGE_RE.test(t) || REFUSAL_RE.test(t)) return false;
  if (/[?？]|いかがでしょうか|いかがですか|でしょうか$/.test(t)) return false;
  return AFFIRMATIVE_RE.test(t) || CONFIRMATION_RE.test(t);
}

export function isConfirmRequest(text: string, source: Speaker): boolean {
  return source === "caller" && CONFIRM_REQUEST_RE.test(text) && /[?？]|でしょうか|ですか/.test(text);
}

/**
 * The callee takes the booking back: 「ご予約承りました。……やはりお取りできませんでした」.
 * A confirmation followed by this (same utterance or later) is not a confirmation.
 */
export const RETRACTION_RE =
  /やはり[^。]*?(?:できません|できかね|無理|キャンセル|やめ)|キャンセル(?:して|させて|でお願い)|取り消して|(?:please )?cancel (?:it|that|the (?:meeting|appointment))|(?:予約|ご予約|注文|ご注文)(?:は|を)?(?:お受けでき(?:ません|かねます)|お取りでき(?:ません|かねます)|承れません|お受けいたしかねます|お取りいたしかねます|キャンセル|取り消し)|取り消させていただき|(?:can't|cannot|unable to|won't be able to) (?:take|honou?r|hold|keep|confirm) (?:the|that|your|this) (?:reservation|booking|order)|(?:reservation|booking|order) (?:is|has been|was) (?:cancelled|canceled|off|withdrawn)|after all,? (?:we|I) can't/i;

/**
 * The slot itself is gone. Said by the callee AFTER a confirmation, this takes the booking back even without
 * the word 予約: a table that is 満席 or 貸切 cannot still be held. Said before, it is only the usual "that time
 * is full" and never touches a later confirmation. Deliberately narrow: an availability word, not any refusal,
 * so 「カードはお受けできません」 after a booking stays a payment remark and not a cancellation.
 */
export const UNAVAILABLE_RE =
  /満席|満室|貸切|貸し切り|休業|定休|埋まって(?:しまって|おり|い)?ます|空いて(?:おりません|いません|ない)|(?:fully booked|no longer available|sold out|closed that day|closed on that day)/i;

/**
 * Appointment-style contracts (`confirmation: "callee_acceptance"`): the caller proposes a slot and
 * the callee commits to it. 「9月25日の15時でお願いします」 from the callee is that commitment; in a
 * reservation the same words from a shop would only be an offer.
 */
export const CALLEE_COMMIT_RE =
  /でお願い(?:します|いたします)|で大丈夫です|で結構です|で構いません|で問題(?:ありません|ございません)|伺います|お待ちして(?:おり)?ます|お約束(?:します|いたします)|確定です|絶対(?:に)?行く|行く行く|行きます|空けと(?:く|きます)|空けてお(?:く|きます)|(?:それ|そこ)で(?:いい|オッケー|おっけー|OK)|I'm in|count me in|I'll be there|works for me|that works|see you then|sounds good|confirmed|let's do (?:that|it)/i;

/** A clean commitment: no refusal, hedge, contrast, question or retraction anywhere in the utterance. */
export function isCalleeCommitment(text: string, source: Speaker): boolean {
  if (source !== "callee") return false;
  const t = text.trim();
  if (REFUSAL_RE.test(t) || HEDGE_RE.test(t) || CONTRAST_RE.test(t) || RETRACTION_RE.test(t)) return false;
  if (/[?？]|でしょうか|ですか|ますか|ませんか/.test(t)) return false;
  return CALLEE_COMMIT_RE.test(t) || AGREEMENT_RE.test(t) || AFFIRMATIVE_RE.test(t);
}

/** "…で合っておりますでしょうか？" is the callee asking back, not agreeing. */
export const QUESTION_RE = /[?？]\s*$|でしょうか|ですか[?？]?\s*$|ますか[?？]?\s*$/;

export function isAgreement(text: string, source: Speaker): boolean {
  return source === "callee" && AGREEMENT_RE.test(text) && !REFUSAL_RE.test(text) && !HEDGE_RE.test(text) && !QUESTION_RE.test(text.trim());
}
