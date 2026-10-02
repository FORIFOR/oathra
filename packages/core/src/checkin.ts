import { detectDistress, distressLevel, type DistressSignal } from "./distress.js";

/**
 * What a wellbeing call heard, topic by topic. Deterministic, and always with the person's own words beside it.
 * These are things said on the phone, never observed facts: 「飲みました」 is "said they took it", not "took it".
 * Anything hedged, contradicted or not clearly answered is `unclear`, so a staff member reads the quote.
 */
export type CheckInTopic = "condition" | "meal" | "medication" | "sleep" | "help";
export type CheckInAnswer = "yes" | "no" | "unclear" | "no_answer" | "not_asked";
export type CheckInTurn = { id?: string; source: "caller" | "callee" | string; text: string; interrupted?: boolean };
export type CheckInItem = { topic: CheckInTopic; answer: CheckInAnswer; question?: string; quote?: string; turn?: string };
export type CheckInReport = {
  version: 1;
  /** The person spoke at all. A call that reached a machine or silence is not a check-in. */
  answered: boolean;
  items: CheckInItem[];
  /** Lines a human should read (see detectDistress), in order. */
  signals: (DistressSignal & { quote: string; turn?: string })[];
  attention: "emergency" | "concern" | "none";
};

// What the agent asked about. Only a question opens a topic; a statement such as 「お薬の時間ですね」 does not.
const ASKED: { topic: CheckInTopic; re: RegExp }[] = [
  { topic: "medication", re: /(?:薬|くすり|お薬)[^。？?]{0,14}(?:飲|の(?:み|ん)|服用)/ },
  { topic: "meal", re: /(?:ご飯|ごはん|食事|朝食|昼食|夕食|朝ご飯|昼ご飯|晩ご飯|夕ご飯|お昼|召し上が|食べ(?:ました|られ|て))/ },
  { topic: "sleep", re: /(?:眠れ|ねむれ|寝られ|お休みになれ|休めました|睡眠)/ },
  { topic: "help", re: /(?:困(?:って|った|り)|お手伝い|心配な?こと|不安な?こと|伝えておきたい|伝えてほしい|気になること)/ },
  { topic: "condition", re: /(?:体調|お体|お身体|具合|お加減|調子|お変わり|元気)/ },
];
const QUESTION = /[?？]|ですか|ますか|ましたか|でしょうか|ませんか|かな[?？]?$|いかが|どう(?:です|でした)/;
const HEDGE = /たぶん|多分|かな(?:あ|ぁ)?|かも|っけ|だっけ|覚えてな|おぼえてな|忘れ(?:た|ちゃ|て)|わから|分から|どうだった|さあ|はず|と思う|気がする|ような/;
// "yes" needs words for a finished action (or a bare affirmation) and nothing that negates or postpones it.
const YES = /^(?:はい|ええ(?!と|っと|ー)|うん|そう(?:です|だ))|(?:飲み|のみ|食べ|たべ|いただき|眠れ|寝られ|済ませ)ました|(?:飲んだ|のんだ|食べた|たべた|眠れた|寝られた|寝た|済んだ)|ぐっすり/;
// Standard and dialect negations, things put off, and things half done. Broad on purpose: a wrong "no" sends a person to
// look; a wrong "yes" hides a missed medicine.
const NO = /いいえ|^いえ|いや|ううん|まだ|ない|ません|なかった|なく(?:て|な)|忘れ|抜い|あとで|後で|これから|今から|いまから|ところ|切らし|食欲|へん|とらん|どらん|てらん|れん(?:よ|わ|の|かった|[。、\s]|$)|らん(?:よ|わ|の|かった|[。、\s]|$)|ておらん|たり[^。]{0,10}たり/;
const FINE = /元気|大丈夫|だいじょうぶ|変わりな|変わりあり|かわりな|問題な|調子(?:は|が)?(?:いい|良い|よい)|おかげさま|普通|ぼちぼち|まあまあ/;
const NOTHING = /特に(?:ない|ありません|なし)|別に(?:ない|ありません)?|ない(?:です|よ|ね)?$|ありません|大丈夫|だいじょうぶ|いいえ|^いえ|ございません/;

function classify(topic: CheckInTopic, text: string): CheckInAnswer {
  const line = text.normalize("NFKC").trim();
  if (!line) return "no_answer";
  if (HEDGE.test(line)) return "unclear";
  if (topic === "condition") {
    // "yes" = said they are well. Any sign of trouble makes it "no"; both at once is for a human to read.
    // 「元気がないです」「大丈夫じゃないです」 contain the word for well and mean the opposite.
    const unwell = /元気(?:が|は|も)?(?:な|出な|でな|ありま)|大丈夫(?:じゃ|では)(?:な|あり)|(?:よ|良)く(?:は)?(?:な|ありま)|すぐれ|優れ(?:な|ませ)|いまいち|今ひとつ|あまり(?:よ|良)/.test(line);
    const troubled = unwell || detectDistress(line).length > 0, fine = !unwell && FINE.test(line);
    return troubled && fine ? "unclear" : troubled ? "no" : fine ? "yes" : "unclear";
  }
  if (topic === "help") {
    // "no" = said there is nothing to raise. Anything else they answered is something raised.
    if (detectDistress(line).length) return "yes";
    return NOTHING.test(line) ? "no" : "yes";
  }
  const yes = YES.test(line), no = NO.test(line);
  return yes && no ? "unclear" : yes ? "yes" : no ? "no" : "unclear";
}

/** Reads a finished or running wellbeing call. `turns` in spoken order; interrupted agent turns are ignored. */
export function checkInReport(turns: readonly CheckInTurn[]): CheckInReport {
  const spoken = turns.filter((t) => !t.interrupted && typeof t.text === "string" && t.text.trim());
  const items = new Map<CheckInTopic, CheckInItem>();
  const signals: CheckInReport["signals"] = [];
  let open: { topic: CheckInTopic; question: string }[] = [];
  for (const turn of spoken) {
    const text = turn.text.normalize("NFKC");
    if (turn.source === "caller") {
      // Each question sentence opens the topics it names; one sentence may ask about two things.
      const asked = text.split(/(?<=[。？?！!])/).filter((s) => QUESTION.test(s)).flatMap((s) => {
        const hit = ASKED.find((a) => a.re.test(s));
        return hit ? [{ topic: hit.topic, question: s.trim() }] : [];
      });
      if (asked.length) {
        for (const a of asked) if (!items.has(a.topic) || items.get(a.topic)!.answer === "no_answer") items.set(a.topic, { topic: a.topic, answer: "no_answer", question: a.question });
        open = asked;
      }
      continue;
    }
    if (turn.source !== "callee") continue;
    for (const signal of detectDistress(text)) signals.push({ ...signal, quote: turn.text.trim(), ...(turn.id ? { turn: turn.id } : {}) });
    // Two questions answered in one breath cannot be told apart by rule: both become unclear, with the quote.
    for (const q of open) {
      const answer = open.length > 1 ? "unclear" : classify(q.topic, text);
      const before = items.get(q.topic)!;
      // A later answer to the same question replaces an earlier one only by being clear, or by contradicting it.
      const next = before.answer === "no_answer" ? answer : before.answer !== answer && answer !== "unclear" ? "unclear" : before.answer;
      items.set(q.topic, { ...before, answer: next, quote: before.quote ? `${before.quote} / ${turn.text.trim()}` : turn.text.trim(), ...(turn.id ? { turn: turn.id } : {}) });
    }
    open = [];
  }
  const order: CheckInTopic[] = ["condition", "meal", "medication", "sleep", "help"];
  const level = distressLevel(signals);
  const list = order.map((topic) => items.get(topic) ?? { topic, answer: "not_asked" as const });
  const worrying = list.some((i) => (i.topic === "help" && i.answer === "yes") || (i.topic !== "help" && i.answer === "no"));
  return { version: 1, answered: spoken.some((t) => t.source === "callee"), items: list, signals,
    attention: level === "emergency" ? "emergency" : level === "concern" || worrying ? "concern" : "none" };
}

const TOPIC_JA: Record<CheckInTopic, string> = { condition: "体調", meal: "食事", medication: "お薬", sleep: "睡眠", help: "困りごと・伝えたいこと" };
/**
 * A short note in plain Japanese that a staff member can read out or send to a relative after a wellbeing call.
 * It reports what was said, in the person's own words, and says so; it never states a fact about their health,
 * never includes a line flagged as an emergency without telling the reader to ask the staff, and is only ever
 * sent by a person. `when` is already formatted for the reader (「10月2日 9時ごろ」).
 */
export function checkInNote(report: CheckInReport, who: { name: string; when: string; from: string }): string {
  const lines = [`${who.name}さんへの${who.from}からのお電話（${who.when}）のご報告です。`];
  if (!report.answered) return [...lines, "お電話に出られなかったか、お話ができませんでした。", "この内容は電話での応答の記録で、ご本人の様子を確かめたものではありません。"].join("\n");
  lines.push("お電話でお話しできました。ご本人が話されたことは次のとおりです。");
  for (const item of report.items) {
    if (item.answer === "not_asked" || item.answer === "no_answer") continue;
    const said = item.quote ? `「${item.quote.split(" / ").at(-1)}」と話されました。` : "お返事がありました。";
    lines.push(`・${TOPIC_JA[item.topic]}: ${item.answer === "unclear" ? `はっきりしたお返事ではありませんでした。${item.quote ? `（${said}）` : ""}` : said}`);
  }
  if (report.attention === "emergency") lines.push("お電話の中に、すぐに確かめたほうがよい言葉がありました。くわしくは職員にお尋ねください。");
  else if (report.attention === "concern") lines.push("気になるお返事がありましたので、職員が確かめます。");
  lines.push("この内容は電話でご本人が話されたことの記録で、ご本人の様子を確かめたものではありません。");
  return lines.join("\n");
}
