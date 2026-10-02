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
const YES = /^(?:はい|ええ|うん|そう(?:です|だ))|(?:飲み|のみ|食べ|たべ|いただき|眠れ|寝られ|済ませ)ました|(?:飲んだ|のんだ|食べた|たべた|眠れた|寝られた|寝た|済んだ)|ぐっすり/;
const NO = /いいえ|^いえ|いや|ううん|まだ|ない|ません|なかった|なく(?:て|な)|忘れ|抜い|あとで|後で|これから|ところ|切らし|食欲/;
const FINE = /元気|大丈夫|だいじょうぶ|変わりな|変わりあり|かわりな|問題な|調子(?:は|が)?(?:いい|良い|よい)|おかげさま|普通|ぼちぼち|まあまあ/;
const NOTHING = /特に(?:ない|ありません|なし)|別に(?:ない|ありません)?|ない(?:です|よ|ね)?$|ありません|大丈夫|だいじょうぶ|いいえ|^いえ|ございません/;

function classify(topic: CheckInTopic, text: string): CheckInAnswer {
  const line = text.normalize("NFKC").trim();
  if (!line) return "no_answer";
  if (HEDGE.test(line)) return "unclear";
  if (topic === "condition") {
    // "yes" = said they are well. Any sign of trouble makes it "no"; both at once is for a human to read.
    const troubled = detectDistress(line).length > 0, fine = FINE.test(line);
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
