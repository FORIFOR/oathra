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
};

const NEGATIVE_JA =
  /いっぱい|満席|満室|空い(?:て|ており)(?:ません|おりません|ない)|できません|できかねます|難しい|無理|ございません|ありません|承れません|お受けできません|いたしかねます|致しかねます|お断り|なりません|なりかねます|かねます|承ることができません|不可/;
const NEGATIVE_EN =
  /\b(not available|fully booked|no availability|unavailable|can't|cannot|unable|no longer|sold out|full\b|isn't possible|not possible|don't have|do not have)\b/i;

export const REFUSAL_RE = new RegExp(`${NEGATIVE_JA.source}|${NEGATIVE_EN.source}`, "i");

/** Explicit reservation confirmation by the callee. Only these phrases count. */
export const CONFIRMATION_RE =
  /ご予約(?:を)?(?:承り|お取り|お受け|確定|お受けいたし|承っ)|承りました|お取りしました|お取りいたしました|確保(?:いたし|し)ました|確定(?:いたし|し)ました|予約完了|お席をご用意|(?:reservation|booking|table|room)\s+(?:is|has been)\s+(?:confirmed|booked|reserved|set)|\b(?:confirmed|booked|reserved|all set)\b|(?:you're|you are) (?:all set|booked)|I've (?:booked|reserved|confirmed)/i;

/** Callee agrees to a value the caller proposed. */
export const AGREEMENT_RE =
  /かしこまりました|承知(?:いたし|し)ました|大丈夫です|問題ございません|空いております|空いています|ご用意できます|お取りできます|承りました|了解|合っております|合っています|その通りです|間違いございません|certainly|of course|sure\b|available|we can do|no problem|that works|absolutely|yes\b|sounds good|correct|that.s right|exactly/i;

/** Caller accepts a value the callee offered. */
export const ACCEPTANCE_RE =
  /でお願い(?:します|いたします|できますか)|で大丈夫です|で結構です|でけっこうです|で構いません|それでお願い|はい[、,]?\s*お願いします|お願いします|それで大丈夫|大丈夫です|了解です|わかりました|that works|sounds good|let's do|let's go with|yes,?\s*please|I'll take|we'll take|perfect|great,? thank/i;

/**
 * Hedges: a clause that hedges is neither a confirmation nor an agreement.
 * "予約を取れると思います" / "たぶん大丈夫です" must never settle a field.
 */
export const HEDGE_RE =
  /と思います|と思う|たぶん|多分|おそらく|恐らく|かもしれません|かもしれない|確認してみ|確認いたします|確認します|調べてみ|probably|maybe|perhaps|I think|let me check|not sure|I'll check|might be/i;

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
    yes: /朝食(?:付き|付|込み|込|あり|をお付け|をおつけ|付きで|も含|込みで)|朝食は(?:含まれ|付い)|breakfast (?:is )?included|with breakfast|includes breakfast|comes with breakfast/i,
    no: /朝食(?:なし|は付き?ません|は別|別|抜き)|no breakfast|without breakfast|breakfast (?:is )?not included/i,
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
    const spelled = /[、,\s]/.test(p.span.trim());
    if (!serialCue && !spelled) continue;
    claims.push({ field: "serial", value: p.value, span: p.span, semantic: 0.9, polarity: polarityAt(p.index) });
  }

  for (const clause of clauses) {
    const text = clause.text;
    for (const t of parseTimes(text, lang)) {
      claims.push({ field: "time", value: t.value, span: t.span, semantic: 0.95, polarity: clause.polarity });
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
    if (clause.polarity === "positive" && !HEDGE_RE.test(text)) {
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

export function isAgreement(text: string, source: Speaker): boolean {
  return source === "callee" && AGREEMENT_RE.test(text) && !REFUSAL_RE.test(text) && !HEDGE_RE.test(text);
}
