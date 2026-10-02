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
// Words of having done it. They never make an answer "yes" (see DONE below); beside a negation they make it unclear.
const YES = /^(?:はい|ええ(?!と|っと|ー)|うん|そう(?:です|だ))|(?:飲み|のみ|食べ|たべ|いただき|眠れ|寝られ|済ませ)ました|(?:飲んだ|のんだ|食べた|たべた|眠れた|寝られた|寝た|済んだ)|ぐっすり/;
// Standard and dialect negations, things put off, and things half done. Broad on purpose: a wrong "no" sends a person to
// look; a wrong "yes" hides a missed medicine.
const NO = /いいえ|^いえ|いや|ううん|まだ|ない|ません|なかった|なく(?:て|な)|忘れ|抜い|あとで|後で|これから|今から|いまから|ところ|切らし|食欲|へん|とらん|どらん|てらん|れん(?:よ|わ|の|かった|[。、\s]|$)|らん(?:よ|わ|の|かった|[。、\s]|$)|ておらん|たり[^。]{0,10}たり/;
const FINE = /元気|大丈夫|だいじょうぶ|変わりな|変わりあり|かわりな|問題な|調子(?:は|が)?(?:いい|良い|よい)|おかげさま|普通|ぼちぼち|まあまあ/;

// --- "yes" is a shape of the WHOLE answer, never a word found inside it. -------------------------------------------
// The answer, with punctuation and spaces removed, must be: a bare affirmative alone; or (an affirmative and) the
// finished action of the topic that was asked, about the speaker and about now. Anything else in the answer — another
// person, another time, a wish, a condition, a reason, a "but" — breaks the shape and the answer is not yes.
const squash = (line: string) => line.replace(/[\s、。,.!！…・「」〜~]/g, "");
const FILL = "(?:えーと|えっと|ええと|えー|あのね|あのう?|そうねえ?|そうですね|そうだね|んー|うーん|まあ|ああ|あ)*";
const AFF = "(?:はい(?:はい)?|ええ|うん(?:うん)?|そうです(?:ね)?|そうだね|そうね|そう)?";
const TAIL = "(?:よ|ね|よね|わ|わよ|わね|の|のよ|で|んです|んですよ|です|ですよ|ですね)?";
const THANKS = "(?:ありがとう(?:ございます)?|おかげさまで|どうも)?";
const BARE = new RegExp(`^${FILL}(?:はい(?:はい)?|ええ|うん(?:うん)?|(?:はい|ええ)?そうです(?:よ)?|うんそう(?:だよ|よ)?)${THANKS}$`);
const shape = (pre: string, core: string) => new RegExp(`^${FILL}${AFF}(?:${pre})*(?:${core})${TAIL}${THANKS}$`);
const DONE: Record<Exclude<CheckInTopic, "help">, RegExp> = {
  medication: shape(
    "お?(?:薬|くすり)(?:は|も|を|なら)?|今日は|今日も|今朝は?|けさは?|朝は?|朝の分は?|さっき|先ほど|もう|ちゃんと|きちんと|忘れずに|しっかり|食後に|ご飯の後に|朝食後に|いつも通り|いつもどおり",
    "(?:飲み|のみ|いただき|頂き|済ませ|服用し)ました|(?:飲ん|のん)(?:だ|できました|でます|でいます|でおります|どる|どります)|済みました|済んだ"),
  meal: shape(
    "(?:朝|昼|晩|夕|夜)?(?:ご飯|ごはん|お?食事|朝食|昼食|夕食|お昼)(?:は|も|を|なら)?|今日は|今日も|今朝は?|さっき|先ほど|もう|ちゃんと|きちんと|しっかり|全部|ぜんぶ|残さず|おいしく|美味しく|たくさん|いっぱい|いつも通り|いつもどおり|よく",
    "(?:食べ|たべ|いただき|頂き|済ませ|とり|摂り|完食し)ました|食べた|たべた|食べてきました|いただいた|済みました|済んだ|完食です"),
  sleep: shape(
    "夜は|昨夜は?|昨日は|昨晩は?|ゆうべは?|夕べは?|今日は|よく|ぐっすり|しっかり|ちゃんと|朝まで|おかげさまで|久しぶりに|たっぷり",
    "(?:眠れ|寝られ|寝れ|寝|眠り|休め|休み)ました|眠れた|寝られた|寝れた|寝た|休めた|(?:眠れ|寝られ|寝れ)て(?:い)?ます|ぐっすり(?:です|でした)?"),
  condition: shape(
    "おかげさまで|おかげさんで|今日は|今日も|体調は|体は|調子は|具合は|特に|別に|相変わらず|いつも通り|いつもどおり|とても|すごく|まあ|ずっと|変わらず|私は",
    "元気(?:です|だ|や|にして(?:い)?ます|にしております|にやってます|いっぱいです)?|大丈夫(?:です|だ|や)?|だいじょうぶ(?:です)?|お?変わり(?:は)?(?:ありません|ないです|ない|なし|なく元気です)|かわりない(?:です)?|問題(?:は)?(?:ありません|ないです|ない|なし)|(?:調子(?:は|が)?)?(?:いい|良い|よい)(?:です)?|好調です|快調です|絶好調(?:です)?|ぼちぼち(?:です|や|でんな)?|まあまあ(?:です)?|普通(?:です)?|ふつう(?:です)?|悪くない(?:です)?|悪くありません|なんともない(?:です)?|何ともありません|どこも悪くない(?:です)?|順調(?:です)?|良好(?:です)?|おかげさまで"),
};
// 「お薬は飲み忘れていませんか」「眠れませんでしたか」: a bare はい to a negative question cannot be read either way.
const NEGATIVE_QUESTION = /ませんか|ないですか|ませんでしたか|忘れて/;
// "nothing to raise" is likewise a set phrase and nothing more.
const NOTHING_SHAPE = new RegExp(`^(?=.*(?:いいえ|いえ|ううん|特に|とくに|別に|べつに|何も|なにも|なんも|ありません|ない|なし|ございません|大丈夫|だいじょうぶ|困って|結構|あらへん))${FILL}(?:いいえ|いえ|いや|ううん)?${THANKS}(?:今は|今のところは?|特には?|とくには?|別に|べつに|何も|なにも|なんも|全然|困っていることは|困りごとは|心配事は|心配なことは)*(?:ありません|ないです|ない|なし|ございません|大丈夫です|大丈夫|だいじょうぶです|だいじょうぶ|困っていません|困ってないです|困ってません|結構です|あらへん)?${TAIL}${THANKS}$`);
// A callee line that takes an earlier answer back.
const CORRECTION = /ごめん|間違|まちが|勘違い|やっぱ|実は|じつは|ほんとは|本当は|ほんまは|嘘|うそ|違(?:う|い|った)|ちがう|ちごた|(?:て|で)(?:い)?なかった|てへんかった|とらんかった|どらんかった|じゃなかった|^(?:あ、?)?(?:いや|いえ)|まだだ|まだで|忘れてた|待って|まって|つもり|というか|っていうか|てゆうか|じゃなくて|ではなくて|と思った(?:ら|けど|んだけど)|言おうと|残っ(?:て|と)/;
const ADDS = /ひとつ|一つ|そういえば|そういや|ただ|でも|あと(?:は|、)|それと|それから|ちょっと/;
// Courtesies that contain a negative form and deny nothing.
const COURTESY = /すみません|申し訳(?:ありません|ございません)|とんでもない|かまいません|構いません|お構いなく|変わりない|変わりありません/g;

function classify(topic: CheckInTopic, text: string, question = ""): CheckInAnswer {
  const line = text.normalize("NFKC").trim();
  if (!line) return "no_answer";
  const whole = squash(line), distressed = detectDistress(line).length > 0, bare = BARE.test(whole);
  if (topic === "help") {
    // "no" = said there is nothing to raise, and only that. A lack, something they cannot do, something done to them,
    // or anything else they answered is something raised.
    if (distressed) return "yes";
    if (bare) return NEGATIVE_QUESTION.test(question) ? "unclear" : "yes";
    if (NOTHING_SHAPE.test(whole)) return "no";
    return HEDGE.test(line) && whole.length <= 14 ? "unclear" : "yes";
  }
  if (!distressed && !HEDGE.test(line)) {
    if (DONE[topic].test(whole)) return "yes";
    // A bare はい answers a yes/no question. 「いかがですか」→「はい」 says nothing about how they are.
    if (bare && !(topic === "condition" ? /いかが|どう/.test(question) : NEGATIVE_QUESTION.test(question))) return "yes";
  }
  if (HEDGE.test(line)) return "unclear";
  if (topic === "condition") {
    // Any sign of trouble makes it "no"; a word for well beside it is for a human to read.
    // 「元気がないです」「大丈夫じゃないです」 contain the word for well and mean the opposite.
    const unwell = /元気(?:が|は|も)?(?:な|出な|でな|ありま|あらへん|のう|出ん)|元気(?:じゃ|では|や)(?:な|あり)|大丈夫(?:じゃ|では|や)(?:な|あり)|(?:よ|良)く(?:は)?(?:な|ありま)|すぐれ|優れ(?:な|ませ)|いまいち|今ひとつ|あまり(?:よ|良)|悪(?:い|く(?!な|あり))/.test(line);
    const troubled = unwell || distressed, fine = !unwell && FINE.test(line);
    return troubled && fine ? "unclear" : troubled ? "no" : "unclear";
  }
  // Not the shape of a yes. A clear negation is "no"; a negation beside words of having done it is for a human.
  const yes = YES.test(line), no = NO.test(line);
  return no && !yes ? "no" : "unclear";
}

/** Reads a finished or running wellbeing call. `turns` in spoken order; interrupted agent turns are ignored. */
export function checkInReport(turns: readonly CheckInTurn[]): CheckInReport {
  const spoken = turns.filter((t) => !t.interrupted && typeof t.text === "string" && t.text.trim());
  const items = new Map<CheckInTopic, CheckInItem>();
  const signals: CheckInReport["signals"] = [];
  let open: { topic: CheckInTopic; question: string }[] = [];
  // The topics last answered stay open for a correction (「あ、ごめん、飲んでなかった」) until another topic is asked,
  // whatever the agent says in between.
  let last: { topic: CheckInTopic; question: string }[] = [];
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
        last = [];
      }
      continue;
    }
    if (turn.source !== "callee") continue;
    const heard = detectDistress(text);
    for (const signal of heard) signals.push({ ...signal, quote: turn.text.trim(), ...(turn.id ? { turn: turn.id } : {}) });
    if (!open.length) {
      // No question is waiting. The line can only take back or contradict what was recorded, never improve it.
      const corrects = CORRECTION.test(text.trim());
      for (const q of last) {
        const before = items.get(q.topic)!, said = last.length > 1 ? "unclear" : classify(q.topic, text, before.question);
        let next: CheckInAnswer = before.answer;
        if (q.topic === "help") {
          // After "nothing", a line that adds something (「あ、ひとつだけ…」「そういえば…」) or states a lack is something raised.
          if (before.answer === "no" && (heard.length || (said === "yes" && (corrects || ADDS.test(text) || NO.test(text.replace(COURTESY, "")))))) next = "yes";
        } else if (before.answer === "yes") {
          if (corrects && said === "no") next = "no";
          // Any negation after a recorded yes is for a human to read: a wrong yes hides a missed medicine, an unclear costs one look.
          else if (corrects || (q.topic !== "condition" && NO.test(text.replace(COURTESY, ""))) || (q.topic === "condition" && (said === "no" || heard.length))) next = "unclear";
        } else if (before.answer === "no" && corrects && said !== "no") next = "unclear";
        if (next !== before.answer) items.set(q.topic, { ...before, answer: next, quote: before.quote ? `${before.quote} / ${turn.text.trim()}` : turn.text.trim(), ...(turn.id ? { turn: turn.id } : {}) });
      }
      continue;
    }
    // Two questions answered in one breath cannot be told apart by rule: both become unclear, with the quote.
    for (const q of open) {
      const before = items.get(q.topic)!;
      const answer = open.length > 1 ? "unclear" : classify(q.topic, text, q.question);
      // A later answer to the same question replaces an earlier one only by being clear, or by contradicting it.
      // Asked again after a yes (「何を召し上がりましたか」), a hedged line that takes it back or negates is not a yes any more.
      const retracts = q.topic !== "help" && before.answer === "yes" && answer === "unclear" && (CORRECTION.test(text.trim()) || /[、。\s]いや[、。\s]/.test(text) || NO.test(text.replace(COURTESY, "")));
      const next = before.answer === "no_answer" ? answer : retracts || (before.answer !== answer && answer !== "unclear") ? "unclear" : before.answer;
      items.set(q.topic, { ...before, answer: next, quote: before.quote ? `${before.quote} / ${turn.text.trim()}` : turn.text.trim(), ...(turn.id ? { turn: turn.id } : {}) });
    }
    last = open;
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
