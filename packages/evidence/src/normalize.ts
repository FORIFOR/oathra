/**
 * Typed parsers: text -> value. These are deliberately NOT delegated to an
 * LLM. They are deterministic, testable, and language-aware.
 */
import { formatQuantity, type QuantityUnit } from "@oathra/contract";
import type { Language } from "./types.js";

const KANJI_DIGITS: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** Parse kanji numerals up to 9999 (十, 百, 千 with optional digit prefixes). */
export function kanjiToNumber(s: string): number | undefined {
  if (!s) return undefined;
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let current = 0;
  let matched = false;
  let digits = "";
  // Arabic digits before a unit ("2万3千500", "8千800") count like kanji digits.
  const flush = () => {
    if (digits) {
      current = Number(digits);
      digits = "";
    }
  };
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") {
      digits += ch;
      matched = true;
      continue;
    }
    flush();
    if (ch in KANJI_DIGITS) {
      current = KANJI_DIGITS[ch]!;
      matched = true;
    } else if (ch === "十") {
      total += (current || 1) * 10;
      current = 0;
      matched = true;
    } else if (ch === "百") {
      total += (current || 1) * 100;
      current = 0;
      matched = true;
    } else if (ch === "千") {
      total += (current || 1) * 1000;
      current = 0;
      matched = true;
    } else {
      return undefined;
    }
  }
  flush();
  return matched ? total + current : undefined;
}

const EN_WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};

export function toFullWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export type TimeMatch = { value: string; span: string; index: number; ambiguous?: boolean };

const NUM_JA = "(\\d{1,2}|[一二三四五六七八九十]{1,3})";

/** Extract all clock times from text. Returns "HH:MM" strings. */
export function parseTimes(text: string, lang: Language = "ja"): TimeMatch[] {
  const s = toFullWidthDigits(text);
  const out: TimeMatch[] = [];

  // ISO-ish 19:30 / 7:30pm
  const re1 = /(午前|午後|夜|朝|昼|夕方)?\s*(\d{1,2})[:：](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/gi;
  for (const m of s.matchAll(re1)) {
    let h = Number(m[2]);
    const min = Number(m[3]);
    if (h > 23 || min > 59 || (m[4] && (h < 1 || h > 12))) continue;
    // In English, a bare 7:30 does not identify morning or evening. Keep the
    // literal candidate for display, but consumers must not verify it.
    const ambiguous = lang === "en" && h >= 1 && h <= 12 && !m[1] && !m[4];
    h = applyMeridiem(h, m[1], m[4]);
    out.push({ value: `${pad2(h)}:${pad2(min)}`, span: m[0].trim(), index: m.index ?? 0, ...(ambiguous ? { ambiguous: true } : {}) });
  }

  // Japanese: 19時半 / 19時30分 / 7時 / 午後7時半
  // 「2時間制」「1時間半」 are durations, not clock times.
  const re2 = new RegExp(`(午前|午後|夜|朝|昼|夕方)?\\s*${NUM_JA}時(?!間)(半|${NUM_JA}分)?`, "g");
  for (const m of s.matchAll(re2)) {
    const hRaw = kanjiToNumber(m[2]!);
    if (hRaw === undefined || hRaw > 23) continue;
    let min = 0;
    if (m[3] === "半") min = 30;
    else if (m[4]) min = kanjiToNumber(m[4]) ?? 0;
    if (min > 59) continue;
    const h = applyMeridiem(hRaw, m[1], undefined);
    out.push({ value: `${pad2(h)}:${pad2(min)}`, span: m[0].trim(), index: m.index ?? 0 });
  }

  // English: 7 pm / seven thirty pm / 7pm
  if (lang === "en" || /\b(am|pm)\b/i.test(s)) {
    const re3 = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+(thirty|fifteen|forty-five|o'clock))?\s*(am|pm|a\.m\.|p\.m\.)\b/gi;
    for (const m of s.matchAll(re3)) {
      const raw = m[1]!.toLowerCase();
      const hRaw = EN_WORD_NUMBERS[raw] ?? Number(raw);
      if (Number.isNaN(hRaw) || hRaw < 1 || hRaw > 12) continue;
      const minWord = m[2]?.toLowerCase();
      const min = minWord === "thirty" ? 30 : minWord === "fifteen" ? 15 : minWord === "forty-five" ? 45 : 0;
      const h = applyMeridiem(hRaw, undefined, m[3]);
      // avoid duplicate with re1 (e.g. "7:30 pm" already captured)
      if (out.some((o) => o.index === m.index)) continue;
      out.push({ value: `${pad2(h)}:${pad2(min)}`, span: m[0].trim(), index: m.index ?? 0 });
    }
  }

  return dedupeByIndex(out);
}

function applyMeridiem(h: number, jaPrefix?: string, enSuffix?: string): number {
  const pm = /^(午後|夜|夕方)$/.test(jaPrefix ?? "") || /^p/i.test(enSuffix ?? "");
  const am = /^(午前|朝)$/.test(jaPrefix ?? "") || /^a/i.test(enSuffix ?? "");
  if (pm && h < 12) return h + 12;
  if (am && h === 12) return 0;
  return h;
}

/** Remove overlapping matches, keeping the earliest-starting, longest span. */
function dedupeByIndex<T extends { index: number; span: string }>(items: T[]): T[] {
  const out: T[] = [];
  let end = -1;
  for (const it of items.sort((a, b) => a.index - b.index || b.span.length - a.span.length)) {
    if (it.index < end) continue;
    out.push(it);
    end = it.index + it.span.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

export type DateMatch = { value: string; span: string; index: number };

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

/** Extract calendar dates. `now` anchors relative words (明日, tomorrow). */
export function parseDates(text: string, now: Date, lang: Language = "ja"): DateMatch[] {
  const s = toFullWidthDigits(text);
  const out: DateMatch[] = [];

  for (const m of s.matchAll(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/g)) {
    out.push({ value: `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`, span: m[0], index: m.index ?? 0 });
  }
  for (const m of s.matchAll(/(?<!\d)(\d{1,2})月(\d{1,2})日/g)) {
    if (out.some((o) => o.index <= (m.index ?? 0) && m.index! < o.index + o.span.length)) continue;
    const month = Number(m[1]);
    const day = Number(m[2]);
    let year = now.getFullYear();
    // If the date already passed this year by more than a month, assume next year.
    const candidate = new Date(year, month - 1, day);
    if (candidate.getTime() < addDays(now, -30).getTime()) year += 1;
    out.push({ value: `${year}-${pad2(month)}-${pad2(day)}`, span: m[0], index: m.index ?? 0 });
  }

  // Day-only ("14日"): the next occurrence of that day-of-month. Durations
  // ("3日間", "2日後") and counters are excluded.
  for (const m of s.matchAll(/(?<![\d月])(\d{1,2})日(?![間後前以]|\d(?!\d?(?:時|[:：]\d))|ほど|程|くらい|ぐらい|位)/g)) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) continue;
    if (out.some((o) => (m.index ?? 0) >= o.index && (m.index ?? 0) < o.index + o.span.length)) continue;
    let month = now.getMonth() + 1;
    let year = now.getFullYear();
    if (day < now.getDate()) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    out.push({ value: `${year}-${pad2(month)}-${pad2(day)}`, span: m[0], index: m.index ?? 0 });
  }

  // 「来週火曜日」「再来週の金曜」「今週木曜日」: a weekday in a named week (weeks run Monday to Sunday), anchored on `now`.
  // A bare weekday (「火曜」) is not a date on its own; the engine only checks it against the date on the table.
  for (const m of s.matchAll(/(今週|来週|再来週)の?([月火水木金土日])曜日?/g)) {
    const weeks = m[1] === "今週" ? 0 : m[1] === "来週" ? 1 : 2;
    const target = "月火水木金土日".indexOf(m[2]!); // 0 = Monday
    const today = (now.getDay() + 6) % 7;
    out.push({ value: isoDate(addDays(now, weeks * 7 + target - today)), span: m[0], index: m.index ?? 0 });
  }

  const relative: Array<[RegExp, number]> = [
    [/明後日|あさって|day after tomorrow/gi, 2],
    [/明日|あした|あす|tomorrow/gi, 1],
    [/今日|本日|きょう|today/gi, 0],
  ];
  for (const [re, n] of relative) {
    for (const m of s.matchAll(re)) {
      if (out.some((o) => o.index === m.index)) continue;
      out.push({ value: isoDate(addDays(now, n)), span: m[0], index: m.index ?? 0 });
    }
  }
  if (lang === "en") {
    const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const re = new RegExp(`\\b(${months.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi");
    for (const m of s.matchAll(re)) {
      const month = months.indexOf(m[1]!.toLowerCase()) + 1;
      const day = Number(m[2]);
      let year = now.getFullYear();
      if (new Date(year, month - 1, day).getTime() < addDays(now, -30).getTime()) year += 1;
      out.push({ value: `${year}-${pad2(month)}-${pad2(day)}`, span: m[0], index: m.index ?? 0 });
    }
  }
  return dedupeByIndex(out);
}

// ---------------------------------------------------------------------------
// Party size
// ---------------------------------------------------------------------------

export type NumberMatch = { value: number; span: string; index: number };

export function parsePartySize(text: string, lang: Language = "ja"): NumberMatch[] {
  const s = toFullWidthDigits(text);
  const out: NumberMatch[] = [];
  // 「お一人様8,800円」「3人前」「一人当たり」 are per-head prices or portions, not a party size.
  const PER_HEAD = "(?!前|分|当たり|あたり|につき|ずつ|様?\\s*[\\d一二三四五六七八九十百千万,]+\\s*円)";
  for (const m of s.matchAll(new RegExp(`(\\d{1,3}|[一二三四五六七八九十]{1,3})\\s*(名様|名|人)${PER_HEAD}`, "g"))) {
    const n = kanjiToNumber(m[1]!);
    if (n === undefined || n === 0) continue;
    out.push({ value: n, span: m[0], index: m.index ?? 0 });
  }
  const special: Array<[RegExp, number]> = [
    [new RegExp(`(?:お一人様|お一人|おひとり|ひとり)${PER_HEAD}`, "g"), 1],
    [new RegExp(`(?:お二人様|お二人|おふたり|ふたり)${PER_HEAD}`, "g"), 2],
  ];
  for (const [re, n] of special) {
    for (const m of s.matchAll(re)) {
      if (out.some((o) => o.index === m.index)) continue;
      out.push({ value: n, span: m[0], index: m.index ?? 0 });
    }
  }
  if (lang === "en" || /\b(people|guests|persons|of us|party of|table for)\b/i.test(s)) {
    const re = /\b(?:party of|table for|for)?\s*(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(people|guests|persons|of us)?\b/gi;
    for (const m of s.matchAll(re)) {
      const hasContext = /party of|table for/i.test(m[0]) || Boolean(m[2]);
      if (!hasContext) continue;
      const raw = m[1]!.toLowerCase();
      const n = EN_WORD_NUMBERS[raw] ?? Number(raw);
      if (!n) continue;
      out.push({ value: n, span: m[0].trim(), index: m.index ?? 0 });
    }
  }
  return dedupeByIndex(out);
}

// ---------------------------------------------------------------------------
// Price (JPY / USD)
// ---------------------------------------------------------------------------

export type PriceMatch = { value: number; currency: "JPY" | "USD"; span: string; index: number };

export function parsePrices(text: string): PriceMatch[] {
  const s = toFullWidthDigits(text).replace(/，/g, ",");
  const out: PriceMatch[] = [];

  // 2万円 / 1万8800円 / 2万3千500円 / 一万八千八百円
  const reMan = /(\d{1,3}|[一二三四五六七八九十]{1,3})万\s*([\d一二三四五六七八九十百千]{1,7})?\s*円/g;
  for (const m of s.matchAll(reMan)) {
    const man = kanjiToNumber(m[1]!);
    const rest = m[2] ? kanjiToNumber(m[2]) : 0;
    if (man === undefined || rest === undefined) continue;
    out.push({ value: man * 10000 + rest, currency: "JPY", span: m[0], index: m.index ?? 0 });
  }
  // 五千円 / 八千八百円 / 千円 / 5千円 / 8千800円 (must contain a kanji unit; "5千円" is 5000, never "千円")
  for (const m of s.matchAll(/(?<![\d一二三四五六七八九十百千万])(\d{0,3}[一二三四五六七八九十百千][\d一二三四五六七八九十百千]{0,7})円/g)) {
    if (out.some((o) => m.index! >= o.index && m.index! < o.index + o.span.length)) continue;
    const n = kanjiToNumber(m[1]!);
    if (n === undefined) continue;
    out.push({ value: n, currency: "JPY", span: m[0], index: m.index ?? 0 });
  }
  // ¥12,580 / 12,580円 / 12580円 / 12,580yen
  for (const m of s.matchAll(/(?:¥|￥)\s*(\d{1,3}(?:,\d{3})+|\d+)|(\d{1,3}(?:,\d{3})+|\d+)\s*(?:円|yen)/gi)) {
    if (out.some((o) => m.index! >= o.index && m.index! < o.index + o.span.length)) continue;
    const raw = (m[1] ?? m[2] ?? "").replace(/,/g, "");
    if (!raw) continue;
    out.push({ value: Number(raw), currency: "JPY", span: m[0], index: m.index ?? 0 });
  }
  // $20 / $1,250.50 / 20 dollars
  for (const m of s.matchAll(/\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?|(\d{1,3}(?:,\d{3})+|\d+)\s*dollars?/gi)) {
    const raw = (m[1] ?? m[3] ?? "").replace(/,/g, "");
    if (!raw) continue;
    const cents = m[2] ? Number(m[2]) / 100 : 0;
    out.push({ value: Number(raw) + cents, currency: "USD", span: m[0], index: m.index ?? 0 });
  }
  return dedupeByIndex(out);
}

// ---------------------------------------------------------------------------
// Quantity (a number and a counting unit)
// ---------------------------------------------------------------------------

/** `value` is the canonical text ("50ケース"): amount and unit together, so equality is plain `===`. */
export type QuantityMatch = { value: string; amount: number; unit: QuantityUnit; span: string; index: number };

const ASCII_END = "(?![A-Za-z0-9])";
/**
 * [canonical unit, spellings (regex source, longest first), what must not follow].
 * People (名/人), money (円), dates and times (日/時/分/週間), ordinals (番/階/回/第) and the generic counter
 * つ are deliberately absent: 「1つ」 carries no unit, so it is never a quantity.
 */
const QUANTITY_UNIT_TABLE: Array<[QuantityUnit, string, string?]> = [
  ["kg", `キログラム|キロ(?!メートル|バイト|ワット|ヘルツ|カロリー|リットル|先|圏)|[kK][gG]${ASCII_END}`],
  ["g", `グラム|g${ASCII_END}`],
  ["t", `トン(?!ネル)|t${ASCII_END}(?!トラック|車)`],
  ["L", `リットル|リッター|[Ll]${ASCII_END}`],
  ["m", `メートル|メーター|m${ASCII_END}`],
  ["ケース", "ケース"],
  ["セット", "セット"],
  ["ダース", "ダース"],
  ["パック", "パック"],
  ["ロット", "ロット"],
  ["梱包", "梱包|梱"],
  ["個", "個", "人|室|別|所|々|性"],
  ["箱", "箱", "根"],
  ["台", "台", "風|所|湾|本|帳|詞"],
  ["本", "本", "日|当|人|社|店|部|体|来|件|化|気|格|番|名|物|業|館|線|題|文|質|州|屋|棚|年|月|書|命|職|決|契|予"],
  ["枚", "枚"],
  ["袋", "袋"],
  ["缶", "缶", "詰"],
  ["束", "束", "ね"],
  // 「2点確認させてください」「1点ございます」 count topics, not goods.
  ["点", "点", "満|検|灯|呼|火|滴|字|線|あり|ござい|(?:ほど|だけ|ばかり)?(?:ご|お)?(?:確認|質問|伺|聞|尋|相談|連絡|報告|知らせ)"],
  ["冊", "冊", "子"],
  ["着", "着", "信|払|工|手|用|席|陸|任"],
  ["足", "足", "り|す|し|元|ら"],
  ["脚", "脚", "本|注"],
  ["基", "基", "本|準|地|礎|づ|盤|金"],
  ["式", "式", "場|典|次|辞"],
  ["反", "反", "対|応|映|省|面|則|発|論|射|転|復"],
  ["俵", "俵"],
  ["pieces", "\\s?(?:pieces?|pcs)\\b"],
  ["units", "\\s?units?\\b"],
  ["cases", "\\s?cases?\\b"],
  ["boxes", "\\s?box(?:es)?\\b"],
  ["cartons", "\\s?cartons?\\b"],
  ["pallets", "\\s?pallets?\\b"],
];
const KANJI_NUM = "〇一二三四五六七八九十百千万";
// Not the tail of a code, a model number, a longer number, a clock time or a price sign ("A-100", "ABC123", "19:30", "¥500").
const QUANTITY_HEAD = `(?<![\\dA-Za-z#№第:$¥\\-‐−${KANJI_NUM}])(?<!\\d[.,])`;
const QUANTITY_NUMBER = `(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+\\.\\d+|[\\d${KANJI_NUM}]+)`;
// 「2本目」 is an ordinal, 「台数」 a noun, 「24本入り」 a pack size, 「1個2,000円」「1ケースあたり」 a unit price.
const QUANTITY_TAIL = `(?!目|数|入り|あたり|当たり|当り|につき|ずつ|ごと|毎|単位|\\s*(?:¥|[\\d${KANJI_NUM},]+\\s*円))`;
const QUANTITY_RES: Array<[QuantityUnit, RegExp]> = QUANTITY_UNIT_TABLE.map(([unit, spellings, not]) =>
  [unit, new RegExp(`${QUANTITY_HEAD}${QUANTITY_NUMBER}\\s?(?:${spellings})${not ? `(?!${not})` : ""}${QUANTITY_TAIL}`, "g")]);

/** "50" / "1,200" / "1.5" / "五十" / "2万5千" -> number. Kanji forms go through `kanjiToNumber`. */
function quantityAmount(raw: string): number | undefined {
  const plain = raw.replace(/,/g, "");
  if (/^\d+(?:\.\d+)?$/.test(plain)) return Number(plain);
  if (raw.includes(",")) return undefined;
  const parts = raw.split("万");
  if (parts.length > 2) return undefined;
  if (parts.length === 2) {
    const man = kanjiToNumber(parts[0]!);
    const rest = parts[1] ? kanjiToNumber(parts[1]) : 0;
    return man === undefined || rest === undefined ? undefined : man * 10000 + rest;
  }
  return kanjiToNumber(raw);
}

/**
 * Extract quantities: a number directly followed by a counting unit. A bare number is never a quantity, and
 * no unit is converted into another (1ダース is not 12個; 50ケース is not 50箱).
 */
export function parseQuantities(text: string): QuantityMatch[] {
  // NFKC folds full-width digits and letters, half-width katakana (ｹｰｽ) and unit glyphs (㎏) into one spelling.
  const s = text.normalize("NFKC");
  const out: QuantityMatch[] = [];
  for (const [unit, re] of QUANTITY_RES) {
    for (const m of s.matchAll(re)) {
      const amount = quantityAmount(m[1]!);
      if (amount === undefined || !(amount > 0)) continue;
      out.push({ value: formatQuantity(amount, unit), amount, unit, span: m[0].trim(), index: m.index ?? 0 });
    }
  }
  return dedupeByIndex(out);
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

export function parsePhoneNumbers(text: string): Array<{ value: string; span: string; index: number }> {
  const s = toFullWidthDigits(text).replace(/[ー－―‐]/g, "-");
  const out: Array<{ value: string; span: string; index: number }> = [];
  for (const m of s.matchAll(/(?:\+81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g)) {
    const digits = m[0].replace(/[^\d+]/g, "");
    if (digits.replace("+81", "0").length < 10) continue;
    out.push({ value: digits, span: m[0], index: m.index ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Serial / confirmation codes
// ---------------------------------------------------------------------------

/**
 * Codes such as "RZ-7K3Q-91XA", spoken as "RZ、7、K、3、Q…" or written plainly.
 * Requires at least one letter and one digit and 6+ alphanumerics.
 */
export function parseSerials(text: string): Array<{ value: string; span: string; index: number }> {
  const s = toFullWidthDigits(text).replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const out: Array<{ value: string; span: string; index: number }> = [];
  for (const m of s.matchAll(/(?:[A-Za-z0-9]{1,6}[、,\s-]{0,2}){3,}/g)) {
    const value = m[0].replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (value.length < 6 || !/[A-Z]/.test(value) || !/\d/.test(value)) continue;
    if (/^\d+$/.test(value)) continue;
    out.push({ value, span: m[0].trim(), index: m.index ?? 0 });
  }
  return out;
}
