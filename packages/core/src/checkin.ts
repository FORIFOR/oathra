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
  { topic: "medication", re: /(?:薬|くすり|お薬)[^。？?]{0,14}(?:飲|の(?:み|ん)|服用|済|すみ|すませ)/ },
  { topic: "meal", re: /(?:ご飯|ごはん|食事|朝食|昼食|夕食|朝ご飯|昼ご飯|晩ご飯|夕ご飯|お昼|召し上が|食べ(?:ました|られ|て))/ },
  { topic: "sleep", re: /(?:眠れ|ねむれ|寝られ|お休みになれ|休めました|睡眠)/ },
  { topic: "help", re: /(?:困(?:って|った|り)|お手伝い|心配な?こと|不安な?こと|伝えておきたい|伝えてほしい|気になること|相談したい|気がかり|ご相談)/ },
  { topic: "condition", re: /(?:体調|お体|お身体|具合|お加減|調子|お変わり|元気|ご気分|気分|ご機嫌|お体の様子)/ },
];
const CARRIED: { topic: CheckInTopic; noun: RegExp; verb: RegExp }[] = [
  { topic: "medication", noun: /薬|くすり/, verb: /飲|服用/ },
  { topic: "meal", noun: /ご飯|ごはん|食事|朝食|昼食|夕食/, verb: /食べ|召し上が|済ま|とられ|摂/ },
];
const QUESTION = /でしょう[。]?$|どんな(?:感じ|具合|様子)|教えて(?:ください|いただけ)|お聞かせ|聞かせてください|お済みです|[?？]|ですか|ますか|ましたか|でしょうか|ませんか|かな[?？]?$|いかが|どう(?:です|でした)/;
const HEDGE = /たぶん|多分|かな(?:あ|ぁ)?|かも|っけ|だっけ|覚えてな|おぼえてな|忘れ(?:た|ちゃ|て)|わから|分から|どうだった|さあ|はず|と思う|気がする|ような/;
// Words of having done it. They never make an answer "yes" (see DONE below); beside a negation they make it unclear.
const YES = /^(?:はい|ええ(?!と|っと|ー)|うん|そう(?:です|だ))|(?:飲み|のみ|食べ|たべ|いただき|眠れ|寝られ|済ませ)ました|(?:飲んだ|のんだ|食べた|たべた|眠れた|寝られた|寝た|済んだ)|ぐっすり/;
// Standard and dialect negations, things put off, and things half done. Broad on purpose: a wrong "no" sends a person to
// look; a wrong "yes" hides a missed medicine.
const NO = /んかった|なんだ(?:[。、\s]|$)|(?:て|で)ね(?:ぇ|え)|まへん|いいえ|^いえ|いや|ううん|まだ|ない|ません|なかった|なく(?:て|な)|忘れ|抜い|あとで|後で|これから|今から|いまから|ところ|切らし|食欲|へん|とらん|どらん|てらん|れん(?:よ|わ|の|かった|[。、\s]|$)|らん(?:よ|わ|の|かった|[。、\s]|$)|ておらん|たり[^。]{0,10}たり/;
const FINE = /元気|大丈夫|だいじょうぶ|変わりな|変わりあり|かわりな|問題な|調子(?:は|が)?(?:いい|良い|よい)|おかげさま|普通|ぼちぼち|まあまあ/;

// --- "yes" is a shape of the WHOLE answer, never a word found inside it. -------------------------------------------
// The answer, with punctuation and spaces removed, must be: a bare affirmative alone; or (an affirmative and) the
// finished action of the topic that was asked, about the speaker and about now. Anything else in the answer — another
// person, another time, a wish, a condition, a reason, a "but" — breaks the shape and the answer is not yes.
// Katakana is read as hiragana: a transcript may come in either.
const squash = (line: string) => line.replace(/[\s、。,.!！…・「」〜~]/g, "").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const FILL = "(?:えーと|えっと|ええと|えっとね|えー|あのね|あのう?|そうねえ?|そうですね|そうだね|んー|うーん|まあ|ああ|あ)*";
const AFF = "(?:はい(?:はい)?|ええ|うん(?:うん)?|そうです(?:ね)?|そうだね|そうね|そう|おう|んだ|そうや|せや|はいよ)?";
// Sentence endings, standard and regional (ばい, がね, やで, けん …). A closed list: anything else breaks the shape.
const TAIL = "(?:よ|ね|よね|わ|わよ|わね|の|のよ|で|やで|ぞ|ぜ|さ|な|なあ|なぁ|ばい|たい|がね|がや|けん|のう|っちゃ|とよ|と|ですわ|んです|んですよ|んよ|んや|んだ|んだよ|んじゃ|でよ|がな|わい|です|ですよ|ですね|よー|よお|っしょ|しょ|だべ|べ|さー|とも|けえ|けぇ|ですわ)?";
const THANKS = "(?:ありがとう?(?:ございます|ね|な|さん)?|おおきに|おかげさまで|どうも)?";
// A time of today, before the verb: 「朝ごはんのあとに飲みました」「さっき食べた」. Never yesterday, never another person.
const TODAY = "(?:朝|昼|晩)?(?:ごはん|ご飯|食事?)の(?:あと|後)に?|食後に|朝食後に|朝いちばんに|朝一番に|朝いちに|起きてすぐに?|朝に|お昼に|昼に|さっき|ついさっき|今さっき|先ほど|今朝(?:は|も)?|けさ(?:は|も)?|今日は|今日も|きょうは|きょうも";
const HOW = "もう|ちゃんと|きちんと|しっかり|忘れずに|いつも通り|いつもどおり|ちゃあんと";
// After the verb: 「食べたよ、ちゃんと」「飲んだよ、朝いちばんに」.
// Closed elaborations that only say more of the same: a time today, 「朝も昼も」, 「腹いっぱい」, 「ほんまに」, 「安心しんさい」.
const MORE = "[0-9一二三四五六七八九十]{1,3}時(?:半)?(?:ごろ|頃|すぎ|過ぎ|前)?に?|(?:朝|あさ|昼|ひる|晩|ばん|夜)も|三食|(?:もう)?(?:腹|おなか|お腹)いっぱい|ほんまに|ほんとに|本当に|毎日欠かさ(?:ん|ず|ない)|安心し(?:てください|て|んさい|なさい)|心配(?:せんで(?:よか|ええ|いい)|いらん|いりません|ない)|(?:もう)?片付けも?(?:済ん(?:どる|でる|だ)|済みました|終わった|終わりました)|(?:今朝|今日|さっき)も?(?:散歩|体操|ラジオ体操|畑|買い物)(?:に行って|して|してきました|に行ってきました)(?:きた|きました)?";
const after = (extra: string) => `(?:(?:${TODAY}|${HOW}|${MORE}${extra ? `|${extra}` : ""})${TAIL}){0,3}(?:はい|ええ|うん)?`;
const BARE = new RegExp(`^${FILL}(?:はい(?:はい)?|ええ|うん(?:うん)?|(?:はい|ええ)?そうです(?:よ)?|うんそう(?:だよ|よ)?)${THANKS}$`);
// The finished action may be said twice (「飲んだ飲んだ」「変わりないよ、元気元気」); every part is from the closed list.
const shape = (pre: string, core: string, post = "") => new RegExp(`^${FILL}${AFF}(?:(?:${TODAY}|${HOW}|${pre})*(?:${core})${TAIL}){1,3}${after(post)}${THANKS}$`);
const DONE: Record<Exclude<CheckInTopic, "help">, RegExp> = {
  medication: shape(
    "お?(?:薬|くすり)(?:は|も|を|なら|ね)?|(?:今朝|朝|昼|夜|今日)の(?:分|ぶん)(?:は|も)?|忘れんと|忘れずに?|欠かさずに?",
    "(?:飲み|のみ|いただき|頂き|済ませ|すませ|服用し)ました|(?:飲ん|のん)(?:だ|できました|でます|でいます|でおります|どる|どります|どいた|でおいた|でおきました|どきました)|飲みましてん|済みました|済んだ|済ん(?:どる|でる|でます)"),
  meal: shape(
    "(?:朝|昼|晩|夕|夜)?(?:ご飯|ごはん|お?食事|朝食|昼食|夕食|お昼)(?:は|も|を|なら)?|全部|ぜんぶ|残さず|おいしく|美味しく|たくさん|いっぱい|よく|よう",
    "(?:食べ|たべ|いただき|頂き|済ませ|すませ|とり|摂り|完食し)ました|食べた|たべた|食べだ|食った|食っだ|くった|食うた|食べてきました|いただいた|食べましてん|済みました|済んだ|済ん(?:どる|でる|でます)|完食です|(?:食べ|たべ)たとこ(?:ろ)?(?:です)?",
    "全部|ぜんぶ|残さず|おいしく"),
  sleep: shape(
    "一度も起きずに|途中で起きずに|夜は|昨夜は?|昨日は|昨晩は?|ゆうべは?|夕べは?|よく|よう|よぐ|よーく|ぐっすり|朝まで|おかげさまで|おかげさんで|久しぶりに|たっぷり",
    "(?:眠れ|ねむれ|寝られ|ねられ|寝れ|ねれ|寝|ね|眠り|ねむり|休め|休み)ました|眠れた|ねむれた|寝られた|寝れた|寝た|寝だ|ねた|休めた|(?:眠れ|寝られ|寝れ)て(?:い)?ます|ぐっすり(?:です|でした|だ|や)?",
    "ぐっすり|よく|朝まで|夜は|昨夜は?|昨日は|昨晩は?|ゆうべは?|夕べは?"),
  condition: shape(
    "今朝は|今朝も|おかげさまで|おかげさんで|体調は|体は|調子は|具合は|特に|別に|相変わらず|とても|とっても|すごく|すこぶる|ほんまに?|ほんに|毎日|まあ|ずっと|変わらず|私は",
    "(?:元気|げんき|達者)(?:(?:に|で)(?:して|やって|過ごして|すごして)(?:(?:い|お)?(?:ます|ります)|い?る)|(?:に|で)(?:し|やっ)と(?:る|う|ります)|で(?:おります|おる|います|す)|です|だ|や|じゃ|いっぱいです)?|(?:なんも|何も|なにも)?心配(?:は)?(?:ない|ありません|いりません|いらん)|ぴんぴんし(?:て(?:い)?(?:ます|る)|と(?:る|ります))|上等|どうも(?:ない|なか|あらへん|ありません)|(?:調子|体調|具合|ぐあい|気分)(?:は|が|も)?(?:いい|良い|よい|ええ|よろしい|上々)(?:です)?|大丈夫(?:です|だ|や)?|だいじょうぶ(?:です)?|お?変わり(?:は)?(?:ありません|ないです|ない|なし|なく元気です)|かわりない(?:です)?|問題(?:は)?(?:ありません|ないです|ない|なし)|(?:調子(?:は|が)?)?(?:いい|良い|よい)(?:です)?|調子(?:は|が)?ええ(?:です)?|ええ(?:です|で|よ)|好調です|快調です|絶好調(?:です)?|ぼちぼち(?:です|や|でんな)?|まあまあ(?:です)?|普通(?:です)?|ふつう(?:です)?|悪くない(?:です)?|悪くありません|なんとも(?:ない|ねぇ|ねえ|あらへん)(?:です)?|何ともありません|どこも悪くない(?:です)?|順調(?:です)?|良好(?:です)?|おかげさまで"),
};
// 「お薬は飲み忘れていませんか」「眠れませんでしたか」: a bare はい to a negative question cannot be read either way.
const NEGATIVE_QUESTION = /ませんか|ないですか|ませんでしたか|忘れて/;
// "nothing to raise" is likewise a set phrase and nothing more.
const NOTHING_PRE = "今は|いまは|今のところは?|いまのところは?|特には?|とくには?|別に|べつに|何も|何にも|なにも|なんも|なーんも|なんにも|全然|困っていることは|困りごとは|心配事は|心配なことは|困っ(?:て(?:い)?る|とる|ちょる)こと(?:は|も|なんか|なんて)?";
const NOTHING_CORE = "ないない|あらしまへん|何もございません|困ってない(?:です)?|大丈夫だ|心配(?:せんで(?:よか|ええ|いい)|いらん|いりません|ご無用)|あらせん|ありゃあせん|ありません|ありませんわ|ないです|ない|なか(?:です)?|ねぇ|ねえ|なし|ございません|ありゃせん|ありゃしません|あらへん|ありまへん|大丈夫です|大丈夫|だいじょうぶです|だいじょうぶ|困っていません|困ってないです|困ってません|困っとらん|結構です";
// One or two set phrases in a row (「大丈夫です、ありません」「ないよ、なんもありゃせん」), with regional negatives (なか, ねぇ, ありゃせん).
const NOTHING_SHAPE = new RegExp(`^(?!.*(?:大丈夫|だいじょうぶ)(?:じゃ|では|で|や)?(?:な|あら|ありま))(?=.*(?:いいえ|いえ|ううん|特に|とくに|別に|べつに|何も|なにも|なんも|ありません|ない|なか|ねぇ|ねえ|なし|ございません|ありゃせん|あらせん|ありまへん|大丈夫|だいじょうぶ|困って|結構|あらへん))${FILL}(?:いいえ|いえいえ|いえ|いやいや|いや|ううん)?${THANKS}(?:(?:${NOTHING_PRE})*(?:${NOTHING_CORE})${TAIL}|(?:${NOTHING_PRE})+){0,3}${THANKS}$`);
// A callee line that takes an earlier answer back.
const CORRECTION = /ほんとうは|ごめん|間違|まちが|勘違い|やっぱ|実は|じつは|ほんとは|本当は|ほんまは|嘘|うそ|違(?:う|い|った)|ちがう|ちごた|(?:て|で)(?:い)?なかった|てへんかった|とらんかった|どらんかった|じゃなかった|^(?:あ、?)?(?:いや|いえ)|まだだ|まだで|忘れてた|待って|まって|つもり|というか|っていうか|てゆうか|じゃなくて|ではなくて|と思った(?:ら|けど|んだけど)|言おうと|残っ(?:て|と)/;
const BUT = /^(?:あ、?|ああ、?|まあ、?)?(?:でも|けど|だけど|けれど|ただ|しかし|ところが|とはいえ|それが|といっても|と言っても|ほんでも|せやけど|じゃけど|ばってん)/;
// A line left hanging on a contrast: 「夜通しラジオを聞いていましたがね。」
const TRAILS = /(?:けど|けども|けれど|がね|んだが|のに|けんど|やけど)(?:ね|な|なあ)?[。.…]*$/;
const TROUBLE = /けど|のに|困|分から|わから|さっぱり|でき(?:な|ん|へん)|苦情|心配|不安|どうし(?:たら|よう)|なくて|れん|せん|へん/;
const ABOUT: Record<CheckInTopic, RegExp> = { medication: /飲|の(?:ん|み|む)|薬|くすり|錠/, meal: /食|たべ|ご飯|ごはん|口に|箸/, sleep: /眠|寝|ねむ|起き|おき|目が覚|夢|夜|晩|朝方|あさまで|うとうと|横にな/, condition: /元気|調子|具合|体調|体が|気分/, help: /$^/ };
// A topic's own words. A later line that uses them with a correction, a negation or a "only" lowers that topic whenever
// it comes, even after the agent has moved on: 「あ、さっきの薬やけど、ほんまは飲んでへんわ」.
const OWN: Record<Exclude<CheckInTopic, "help">, RegExp> = { medication: /薬|くすり|飲(?:ん|み|む|ま|め)|のん(?:だ|で)|錠/, meal: /ご飯|ごはん|食べ|たべ|食っ|食事|朝食|昼食|夕食/, sleep: /眠|寝(?!込)|ねむ|目が覚|一睡/, condition: /体調|元気|具合|調子|気分/ };
const TAKES_BACK = /ほんとうは|ほんとはね|ごめん|間違|まちが|勘違い|やっぱ|実は|じつは|ほんとは|本当は|ほんまは|嘘|うそ|訂正|違(?:う|い|った)|ちがう|ちごた|(?:^|[、。.…\s])(?:いや|いえ)(?:[、。.…\s]|$)|まだ(?:だ|で|や)|忘れて|つもり|じゃなくて|ではなくて/;
const BACK_REFERENCE = /ほんとうは|さっきの|さっきは|さっき言った|先ほどの|嘘|うそ|間違|まちが|勘違い|ほんまは|本当は|ほんとは|実は|じつは|訂正/;
// 「お茶を一杯飲んだだけ」「二時間ほど」「飲んだのは昨日」: an answer to a follow-up that leaves little of the yes.
const LIMITS = /だけ|しか|ばかり|ばっか|ちょっと|少し|すこし|一口|ひとくち|半分|ほんの|ほとんど|あまり|あんまり/;
const OTHER_DAY = /昨日|きのう|おととい|一昨日|この前|こないだ|先週/;
const SHORT_SLEEP = /(?:[一二三1-3]|いち|に|さん)時間|[0-9一二三四五六七八九十]+分|うとうと|何度も|何回も/;
// How long they slept: only an answer that says long enough leaves the yes.
const LONG_SLEEP = /(?:[4-9]|1[0-2]|四|五|六|七|八|九|十)時間|朝まで|ぐっすり|たっぷり/;
const HELP_WORDS = /困|こまっ|相談|気がかり|頼みたい|お願いしたい/;
const PHYSICAL = new Set(["life", "self_harm", "breathing", "pain", "fall", "illness"]);
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
    // Two sentences about one topic are one question: 「体調はいかがですか。お元気ですか。」 can be answered はい.
    const openEnded = question.split(/(?<=[。？?])/).filter((q) => q.trim()).every((q) => /いかが|どう/.test(q));
    if (bare && !(topic === "condition" ? openEnded : NEGATIVE_QUESTION.test(question))) return "yes";
  }
  if (HEDGE.test(line)) return "unclear";
  if (topic === "condition") {
    // Any sign of trouble makes it "no"; a word for well beside it is for a human to read.
    // 「元気がないです」「大丈夫じゃないです」 contain the word for well and mean the opposite.
    const unwell = /(?:具合|ぐあい|調子|ちょうし|体調|たいちょう|気分|きぶん)(?:が|は|も)?(?:悪|わる|よくな|良くな)|元気(?:が|は|も)?(?:な|出な|でな|ありま|あらへん|のう|出ん)|元気(?:じゃ|では|や)(?:な|あり)|大丈夫(?:じゃ|では|や)(?:な|あり)|(?:よ|良)く(?:は)?(?:な|ありま)|すぐれ|優れ(?:な|ませ)|いまいち|今ひとつ|あまり(?:よ|良)|悪(?:い|く(?!な|あり))/.test(line);
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
  // The topics answered just before the question now open: what 「さっきのは嘘」 refers to.
  let previous: CheckInTopic[] = [];
  for (const turn of spoken) {
    const text = turn.text.normalize("NFKC");
    if (turn.source === "caller") {
      // Each question sentence opens the topics it names; one sentence may ask about two things.
      const asked = text.split(/(?<=[。？?！!])/).filter((s) => QUESTION.test(s)).flatMap((s) => {
        // 「今日のお薬についてうかがいます。もうお飲みになりましたか。」: the topic is named in the sentence before, the
        // question carries only its verb.
        const hit = ASKED.find((a) => a.re.test(s)) ?? CARRIED.find((c) => c.verb.test(s) && c.noun.test(text.slice(0, text.indexOf(s))));
        return hit ? [{ topic: hit.topic, question: s.trim() }] : [];
      }).reduce<{ topic: CheckInTopic; question: string }[]>((all, a) => {
        // The same topic asked in two sentences is one question; only different topics make an answer ambiguous.
        const same = all.find((x) => x.topic === a.topic);
        if (same) same.question += a.question; else all.push(a);
        return all;
      }, []);
      if (asked.length) {
        for (const a of asked) if (!items.has(a.topic) || items.get(a.topic)!.answer === "no_answer") items.set(a.topic, { topic: a.topic, answer: "no_answer", question: a.question });
        if (last.length) previous = last.map((q) => q.topic);
        open = asked;
        last = [];
      }
      continue;
    }
    if (turn.source !== "callee") continue;
    const heard = detectDistress(text);
    for (const signal of heard) signals.push({ ...signal, quote: turn.text.trim(), ...(turn.id ? { turn: turn.id } : {}) });
    // A yes survives only while nothing said later touches its topic except a plain confirmation.
    const handled = new Set<CheckInTopic>([...open, ...last].map((q) => q.topic));
    for (const topic of ["condition", "meal", "medication", "sleep"] as const) {
      const before = items.get(topic);
      if (!before || before.answer !== "yes" || handled.has(topic)) continue;
      const marked = TAKES_BACK.test(text) || LIMITS.test(text) || NO.test(text.replace(COURTESY, ""));
      // Naming the topic again is enough unless the whole line is itself a plain confirmation: when unsure, a human reads it.
      const named = OWN[topic].test(text) && (marked || !DONE[topic].test(squash(text)));
      const referred = previous.includes(topic) && BACK_REFERENCE.test(text);
      const unwell = topic === "condition" && heard.some((h) => PHYSICAL.has(h.category));
      if (!named && !referred && !unwell) continue;
      const next: CheckInAnswer = named && TAKES_BACK.test(text) && classify(topic, text, before.question) === "no" ? "no" : "unclear";
      items.set(topic, { ...before, answer: next, quote: before.quote ? `${before.quote} / ${turn.text.trim()}` : turn.text.trim(), ...(turn.id ? { turn: turn.id } : {}) });
    }
    {
      // "Nothing to raise" is taken back the same way, whenever it comes: 「困りごとね、やっぱりあるわ」「さっきの困ってることだけど…」.
      const before = items.get("help");
      if (before?.answer === "no" && !handled.has("help") && HELP_WORDS.test(text) && !NOTHING_SHAPE.test(squash(text))) items.set("help", { ...before, answer: "yes", quote: before.quote ? `${before.quote} / ${turn.text.trim()}` : turn.text.trim(), ...(turn.id ? { turn: turn.id } : {}) });
    }
    if (!open.length) {
      // No question is waiting. The line can only take back or contradict what was recorded, never improve it.
      const corrects = CORRECTION.test(text.trim());
      for (const q of last) {
        const before = items.get(q.topic)!, said = last.length > 1 ? "unclear" : classify(q.topic, text, before.question);
        let next: CheckInAnswer = before.answer;
        if (q.topic === "help") {
          // After "nothing", a line that adds something (「あ、ひとつだけ…」「そういえば…」) or states a lack is something raised.
          if (before.answer === "no" && (heard.length || (said === "yes" && (corrects || ADDS.test(text) || BUT.test(text.trim()) || TROUBLE.test(text) || NO.test(text.replace(COURTESY, "")))))) next = "yes";
        } else if (before.answer === "yes") {
          if (corrects && said === "no") next = "no";
          // Any negation after a recorded yes is for a human to read: a wrong yes hides a missed medicine, an unclear costs one look.
          // So is a line that opens with "but", and any line about the same thing that is not itself a plain confirmation:
          // 「眠れました」…「でも怖い夢を見て夜中に起きてからは、朝まで起きてた」 has no negation in it.
          else if (corrects || BUT.test(text.trim()) || TRAILS.test(text.trim()) || (q.topic !== "condition" && NO.test(text.replace(COURTESY, ""))) || (ABOUT[q.topic].test(text) && said !== "yes") || (q.topic === "condition" && (said === "no" || heard.length))) next = "unclear";
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
      // So is an answer to a follow-up that limits it or moves it to another day: 「お茶を一杯飲んだだけ」「飲んだのは昨日」「二時間ほど」.
      const retracts = q.topic !== "help" && before.answer === "yes" && answer !== "yes" && (CORRECTION.test(text.trim()) || TAKES_BACK.test(text) || NO.test(text.replace(COURTESY, "")) || LIMITS.test(text) || (q.topic === "sleep" ? SHORT_SLEEP.test(text) || (/何時間|どのくらい|どれくらい/.test(q.question) && !LONG_SLEEP.test(text)) : OTHER_DAY.test(text)));
      // Asked again as a yes/no question (「しっかり召し上がれましたか」), anything but a plain yes is for a human;
      // a follow-up for detail (「何を召し上がりましたか」→「パンと卵」) leaves the yes alone.
      const unconfirmed = q.topic !== "help" && before.answer === "yes" && answer !== "yes" && !/何を|何時|いつ|どの|どんな|どれ|いくつ|何回|どちら/.test(q.question);
      const next = before.answer === "no_answer" ? answer : retracts || unconfirmed || (before.answer !== answer && answer !== "unclear") ? "unclear" : before.answer;
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
  // Said plainly: an AI made the call on the facility's behalf; the staff member who sends this note did not speak to the person.
  // Addressed to the family about the person: the person is the subject, the reader is the relative.
  const lines = [`${who.name}さんへの電話（${who.when}）のご報告です。${who.from}の代わりに、AIがおかけしました。`];
  if (!report.answered) return [...lines, "お電話に出られなかったか、お話ができませんでした。職員が改めて様子を確かめます。", "この内容は電話での応答の記録で、ご本人の様子を確かめたものではありません。"].join("\n");
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
