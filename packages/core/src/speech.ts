/**
 * Speech Normalizer: value -> text a TTS engine will read correctly.
 * Never delegated to an LLM. Japanese readings are produced as kana.
 */
import type { Language } from "@oathra/evidence";

const JA_DIGITS = ["ゼロ", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"];

/** Reading for a positive integer below 10^8 (enough for prices). */
export function readNumberJa(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n === 0) return "ゼロ";
  const parts: string[] = [];
  const units: Array<[number, string]> = [
    [10000, "まん"],
    [1000, "せん"],
    [100, "ひゃく"],
    [10, "じゅう"],
  ];
  let rest = Math.floor(n);
  const man = Math.floor(rest / 10000);
  if (man > 0) {
    parts.push(man === 1 ? "いちまん" : `${readNumberJa(man)}まん`);
    rest %= 10000;
  }
  for (const [u, name] of units.slice(1)) {
    const d = Math.floor(rest / u);
    if (d === 0) continue;
    rest %= u;
    if (u === 1000) parts.push(d === 1 ? "せん" : d === 3 ? "さんぜん" : d === 8 ? "はっせん" : `${JA_DIGITS[d]}せん`);
    else if (u === 100) parts.push(d === 1 ? "ひゃく" : d === 3 ? "さんびゃく" : d === 6 ? "ろっぴゃく" : d === 8 ? "はっぴゃく" : `${JA_DIGITS[d]}ひゃく`);
    else parts.push(d === 1 ? "じゅう" : `${JA_DIGITS[d]}じゅう`);
  }
  if (rest > 0) parts.push(JA_DIGITS[rest]!);
  return parts.join(" ");
}

export function normalizeCurrency(amount: number, lang: Language = "ja", currency: "JPY" | "USD" = "JPY"): string {
  if (lang === "ja") {
    if (currency === "USD") return `${readNumberJa(Math.round(amount))} ドル`;
    return `${readNumberJa(amount)} えん`;
  }
  const sym = currency === "USD" ? "$" : "¥";
  return `${sym}${amount.toLocaleString("en-US")}`;
}

const JA_HOUR: Record<number, string> = {
  0: "れいじ", 1: "いちじ", 2: "にじ", 3: "さんじ", 4: "よじ", 5: "ごじ", 6: "ろくじ", 7: "しちじ", 8: "はちじ", 9: "くじ",
  10: "じゅうじ", 11: "じゅういちじ", 12: "じゅうにじ", 13: "じゅうさんじ", 14: "じゅうよじ", 15: "じゅうごじ",
  16: "じゅうろくじ", 17: "じゅうしちじ", 18: "じゅうはちじ", 19: "じゅうくじ", 20: "にじゅうじ", 21: "にじゅういちじ",
  22: "にじゅうにじ", 23: "にじゅうさんじ", 24: "にじゅうよじ",
};

/** "19:30" -> "じゅうくじ さんじゅっぷん" (ja) / "7:30 PM" (en). */
export function normalizeTime(hhmm: string, lang: Language = "ja"): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (lang === "ja") {
    const hour = JA_HOUR[h] ?? `${readNumberJa(h)}じ`;
    if (min === 0) return hour;
    if (min === 30) return `${hour} はん`;
    const minRead = min === 10 ? "じゅっぷん" : min === 20 ? "にじゅっぷん" : min === 40 ? "よんじゅっぷん" : min === 50 ? "ごじゅっぷん" : `${readNumberJa(min)}ふん`;
    return `${hour} ${minRead}`;
  }
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
}

/** "2026-09-12" -> "くがつ じゅうににち" (ja) / "September 12" (en). */
export function normalizeDate(iso: string, lang: Language = "ja"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (lang === "ja") {
    const months = ["", "いちがつ", "にがつ", "さんがつ", "しがつ", "ごがつ", "ろくがつ", "しちがつ", "はちがつ", "くがつ", "じゅうがつ", "じゅういちがつ", "じゅうにがつ"];
    const days: Record<number, string> = {
      1: "ついたち", 2: "ふつか", 3: "みっか", 4: "よっか", 5: "いつか", 6: "むいか", 7: "なのか", 8: "ようか", 9: "ここのか", 10: "とおか",
      14: "じゅうよっか", 20: "はつか", 24: "にじゅうよっか",
    };
    return `${months[month]} ${days[day] ?? `${readNumberJa(day).replace(/ /g, "")}にち`}`;
  }
  const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${names[month - 1]} ${day}`;
}

/** Digits read one by one, grouped by hyphen: "03-1234-5678" -> "ゼロ さん、いち に さん よん、ご ろく なな はち". */
export function normalizePhone(digits: string, lang: Language = "ja"): string {
  const groups = digits.replace(/[^\d-]/g, "").split("-").filter(Boolean);
  if (lang === "ja") {
    return groups.map((g) => [...g].map((d) => JA_DIGITS[Number(d)]).join(" ")).join("、");
  }
  return groups.map((g) => [...g].join(" ")).join(", ");
}

/** Serial / confirmation codes: letters and digits spelled individually. */
export function normalizeSerialNumber(code: string, lang: Language = "ja"): string {
  const chars = [...code.toUpperCase()].filter((c) => /[A-Z0-9]/.test(c));
  if (lang === "ja") return chars.map((c) => (/\d/.test(c) ? JA_DIGITS[Number(c)] : c)).join(" ");
  return chars.join(" ");
}

export function normalizeCounter(n: number, unit: "人" | "名" | "個" | "泊", lang: Language = "ja"): string {
  if (lang !== "ja") return `${n}`;
  if (unit === "人" || unit === "名") {
    if (n === 1) return "ひとり";
    if (n === 2) return "ふたり";
    return `${readNumberJa(n)}めい`;
  }
  if (unit === "個") {
    const ko: Record<number, string> = { 1: "いっこ", 6: "ろっこ", 8: "はっこ", 10: "じゅっこ" };
    return ko[n] ?? `${readNumberJa(n)}こ`;
  }
  const haku: Record<number, string> = { 1: "いっぱく", 3: "さんぱく", 4: "よんぱく", 6: "ろっぱく", 8: "はっぱく", 10: "じゅっぱく" };
  return haku[n] ?? `${readNumberJa(n)}はく`;
}

/**
 * Normalise a full sentence for TTS: replaces ISO dates, HH:MM times,
 * ¥ amounts and phone numbers in place. Everything else is left untouched.
 */
export function normalizeForSpeech(text: string, lang: Language = "ja"): string {
  let out = text;
  out = out.replace(/\d{4}-\d{2}-\d{2}/g, (m) => normalizeDate(m, lang));
  out = out.replace(/(?<!\d)\d{1,2}:\d{2}(?!\d)/g, (m) => normalizeTime(m, lang));
  out = out.replace(/(?:¥|￥)\s?(\d{1,3}(?:,\d{3})+|\d+)/g, (_m, n: string) => normalizeCurrency(Number(n.replace(/,/g, "")), lang));
  out = out.replace(/(\d{1,3}(?:,\d{3})+)円/g, (_m, n: string) => normalizeCurrency(Number(n.replace(/,/g, "")), lang));
  out = out.replace(/0\d{1,4}-\d{1,4}-\d{3,4}/g, (m) => normalizePhone(m, lang));
  return out;
}

/**
 * The first thing said on a call that is recorded. The wording is fixed here: a disclosure is never
 * left to a model's phrasing, and it must come before anything the callee might answer.
 */
export function recordingNotice(language: Language): string {
  return language === "ja" ? "この通話は録音されています。" : "This call is being recorded.";
}

/**
 * The same first words for a call that keeps a transcript but no audio. "Recorded" would
 * claim something that is not kept; saying nothing would hide that the words are.
 */
export function transcriptNotice(language: Language): string {
  return language === "ja" ? "この通話は記録されています。" : "This call is being transcribed.";
}
