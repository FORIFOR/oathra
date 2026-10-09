import { describe, expect, it } from "vitest";
import { checkInReport, detectDistress, distressLevel, isMachineGreeting, type CheckInTopic } from "./index.js";

// Every input an adversary ran against the built code on 2026-10-02 (113 check-in answers, 127 distress lines,
// 38 ordinary sentences, 44 announcements, 20 people), with the value the adversary expected. Where that expectation
// was debatable the decision is written beside it. Do not delete or loosen a row to make a change pass.

const Q = { med: "お薬は飲みましたか？", meal: "ご飯は食べましたか？", sleep: "昨夜はよく眠れましたか？", cond: "体調はいかがですか？", help: "何か困っていることはありますか？" } as const;
const T: Record<keyof typeof Q, CheckInTopic> = { med: "medication", meal: "meal", sleep: "sleep", cond: "condition", help: "help" };
const report = (k: keyof typeof Q, lines: readonly string[]) => checkInReport([{ source: "caller", text: Q[k] }, ...lines.map((l) => (l.startsWith("A:") ? { source: "caller", text: l.slice(2) } : { source: "callee", text: l }))]);
const answer = (k: keyof typeof Q, ...lines: string[]) => report(k, lines).items.find((i) => i.topic === T[k])!.answer;
const level = (text: string) => distressLevel(detectDistress(text));
const rank = { none: 0, concern: 1, emergency: 2 } as const;

// [topic, the answer that must NOT be recorded, callee lines; "A:" marks an agent line in between]
// Decision: 「はい、全部飲んだ」 is most often "all of today's" but cannot be told from "the whole packet" in text, so it
// is unclear (staff read the quote); it raises no alarm by itself, while 「薬を全部飲んだ」 does.
const WRONG: [keyof typeof Q, "yes" | "no", ...string[]][] = [
 ['med','yes','昨日は飲んだ'],['med','yes','朝は飲んだけど昼のはね'],['med','yes','主人は飲んだ'],['med','yes','はい、飲むつもりです'],['med','yes','うん、飲もうとした'],
 ['med','yes','飲んだふりをしてる'],['med','yes','飲んだら吐いた'],['med','yes','はい、あとで'],['med','yes','そうですね…'],['med','yes','うんざりです'],['med','yes','はい？'],['med','yes','はい、何ですか'],
 ['med','yes','ええ？'],['med','yes','はい、どなた'],['med','yes','飲んだことにしといて'],['med','yes','飲んだのは一昨日が最後'],['med','yes','半分だけ飲んだ'],['med','yes','飲んだり飲まなかったり'],
 ['med','yes','はい、もしもし'],['med','yes','うん、それがね、見つからんのよ'],['med','yes','はい、飲めって言われてます'],['med','yes','飲みましたと言いたいところだけど'],['med','yes','はい、捨てました'],
 ['med','yes','ええ、飲むのをやめたんです'],['med','yes','うん、飲んどらん'],['med','yes','はい、飲んでへん'],['med','yes','飲んだ', 'A:よかったです。', 'あ、ごめん、飲んでなかった'],
 ['med','yes','はい', 'A:よかったです。', 'いや、嘘、今日はまだだ'],['med','yes','うん、二回分飲んだ'],['med','yes','はい、全部飲んだ'],['med','yes','そうだね、切れてる'],['med','yes','はい、娘が来たら飲みます'],
 ['meal','yes','食べたいんだけどね'],['meal','yes','食べたら戻した'],['meal','yes','主人は食べた'],['meal','yes','昨日は食べた'],['meal','yes','食べたのはおとといが最後'],['meal','yes','はい、お薬は飲みました'],
 ['meal','yes','一口だけ食べた'],['meal','yes','はい、作る気がしなくて'],['meal','yes','うん、お茶だけ'],['meal','yes','食べたかどうか'],['meal','yes','そうですね、喉を通らなくて'],['meal','yes','ええ、何も'],
 ['meal','yes','はい、抜きました'],['meal','yes','食べたって言えるほどじゃ'],['meal','yes','食べたくても米が切れてる'],['meal','yes','はい、ヘルパーさんが来たら'],['meal','yes','うん、もう三日食べとらん'],
 ['meal','yes','食べました', 'A:何を召し上がりましたか？', '何も食べてない'],['meal','yes','いただきますはこれからです... いただきました？'],['meal','yes','猫は食べた'],['meal','yes','食べたと思ったら吐いちゃって'],
 ['sleep','yes','寝たきりです'],['sleep','yes','寝たのは朝方'],['sleep','yes','ぐっすりとはいかんね'],['sleep','yes','眠れたらいいんだけど'],['sleep','yes','一時間だけ寝た'],['sleep','yes','はい、一睡も'],
 ['sleep','yes','うん、痛くて何度も起きた'],['sleep','yes','寝たけど何回もトイレに起きた'],['sleep','yes','はい、全然'],['sleep','yes','そうですね、夜中に目が覚めて'],['sleep','yes','ぐっすり眠りたいよ'],['sleep','yes','昼間に寝たから夜はね'],
 ['sleep','yes','ええ、睡眠薬を三錠飲んだから'],['sleep','yes','寝たのか寝てないのか'],['sleep','yes','はい、怖くて'],
 ['cond','yes','元気じゃない'],['cond','yes','元気ではありません'],['cond','yes','大丈夫とは言えない'],['cond','yes','普通じゃない'],['cond','yes','調子がいいとは言えん'],['cond','yes','問題ないとは言えません'],
 ['cond','yes','主人は元気です'],['cond','yes','昨日までは元気でした'],['cond','yes','元気だけが取り柄だったのにね'],['cond','yes','大丈夫と言いたいけどね'],['cond','yes','おかげさまで入院することになりました'],
 ['cond','yes','元気そうに見えますか'],['cond','yes','大丈夫なわけないでしょう'],['cond','yes','元気なもんか'],['cond','yes','ぼちぼち悪くなってる'],['cond','yes','普通に歩けなくなった'],['cond','yes','大丈夫、ちょっと血を吐いただけ'],
 ['cond','yes','元気ないわ'],['cond','yes','元気あらへん'],['cond','yes','大丈夫やない'],['cond','yes','まあまあ悪い'],['cond','yes','変わりないです、ずっと寝込んだまま'],['cond','yes','大丈夫、頭を打っただけ'],
 ['cond','yes','大丈夫です', 'A:それはよかったです。', 'いや、ほんとは胸がね'],['cond','yes','元気がのうて'],['cond','yes','元気出ん'],['cond','yes','大丈夫だった、昨日までは'],['cond','yes','娘は大丈夫って言うけど'],
 ['help','no','食べるものがありません'],['help','no','お米がないです'],['help','no','灯油がないよ'],['help','no','薬がありません'],['help','no','迎えに来てくれる人がいない'],['help','no','お金がなくて大丈夫じゃない'],
 ['help','no','暖房がつかないけど大丈夫'],['help','no','電気が止まって何も見えない'],['help','no','息子に叩かれるけど、いいえ、言わないで'],['help','no','別に、ただ財布を取られた'],['help','no','大丈夫、ガスの匂いがするだけ'],
 ['help','no','いいえ、でも隣の人が怒鳴り込んでくる'],['help','no','水が出ない'],['help','no','トイレまで歩けない'],['help','no','病院に行くお金がありません'],['help','no','誰も頼る人がない'],['help','no','ありませんと言いたいけど、家賃が払えない'],
];

describe("check-in answers an adversary got recorded wrongly", () => {
  it.each(WRONG)("%s is never %s: %s", (k, wrong, ...lines) => {
    const got = answer(k, ...lines);
    expect(got).not.toBe(wrong);
    // Something raised under "anything to tell us?" is recorded as raised, not left as unclear.
    if (k === "help") expect(got).toBe("yes");
  });
  it("a correction after the agent has spoken changes the answer, and a clear one is a no", () => {
    expect(answer("med", "飲んだ", "A:よかったです。", "あ、ごめん、飲んでなかった")).toBe("no");
    expect(answer("med", "はい", "A:よかったです。", "いや、嘘、今日はまだだ")).toBe("no");
    expect(answer("cond", "大丈夫です", "A:それはよかったです。", "いや、ほんとは胸がね")).toBe("unclear");
    expect(answer("meal", "食べました", "A:何を召し上がりましたか？", "何も食べてない")).toBe("unclear");
  });
  it("a later line never improves an answer: a no stays a no after a stray はい", () => {
    expect(answer("med", "まだ飲んでいません", "A:わかりました。", "はい")).toBe("no");
    expect(answer("med", "飲みました", "A:よかったです。", "はい、ありがとう")).toBe("yes");
  });
  it("a correction window closes when another topic is asked", () => {
    const r = checkInReport([{ source: "caller", text: Q.med }, { source: "callee", text: "飲みました" }, { source: "caller", text: Q.meal }, { source: "callee", text: "いや、まだです" }]);
    expect(Object.fromEntries(r.items.map((i) => [i.topic, i.answer]))).toMatchObject({ medication: "yes", meal: "no" });
  });
  it("something raised that is also a distress signal is flagged", () => {
    expect(report("help", ["息子に叩かれるけど、いいえ、言わないで"]).attention).toBe("emergency");
    expect(report("help", ["大丈夫、ガスの匂いがするだけ"]).attention).toBe("emergency");
    expect(report("help", ["水が出ない"]).attention).toBe("concern");
  });
  it("a bare はい to a negative question, or to 「いかがですか」, says nothing", () => {
    const one = (q: string, a: string, topic: CheckInTopic) => checkInReport([{ source: "caller", text: q }, { source: "callee", text: a }]).items.find((i) => i.topic === topic)!.answer;
    expect(one("お薬は飲み忘れていませんか？", "はい", "medication")).toBe("unclear");
    expect(one("体調はいかがですか？", "はい", "condition")).toBe("unclear");
    expect(one("お変わりありませんか？", "はい", "condition")).toBe("yes");
  });
});

// The redesign must not pass by answering "unclear" to everything: plain answers stay as said.
const PLAIN: [keyof typeof Q, string, "yes" | "no"][] = [
  ["med", "はい", "yes"], ["med", "ええ", "yes"], ["med", "うん", "yes"], ["med", "そうです", "yes"], ["med", "はい、飲みました", "yes"], ["med", "飲みました", "yes"], ["med", "ええ、飲みましたよ", "yes"],
  ["med", "うん、飲んだ", "yes"], ["med", "飲んだよ", "yes"], ["med", "もう飲みました", "yes"], ["med", "はい、今朝飲みました", "yes"], ["med", "お薬は飲みました", "yes"], ["med", "ちゃんと飲みました", "yes"],
  ["med", "はい、さっき飲みました", "yes"], ["med", "忘れずに飲みました", "yes"], ["med", "はい、ありがとうございます", "yes"], ["med", "飲んだで", "yes"], ["med", "はい、もう済ませました", "yes"],
  ["med", "まだ飲んでいません", "no"], ["med", "いいえ", "no"], ["med", "飲んでないです", "no"], ["med", "飲み忘れました", "no"], ["med", "まだです", "no"], ["med", "飲んでへん", "no"], ["med", "今日は飲んでない", "no"],
  ["meal", "はい", "yes"], ["meal", "はい、食べました", "yes"], ["meal", "食べました", "yes"], ["meal", "いただきました", "yes"], ["meal", "ええ、いただきました", "yes"], ["meal", "うん、食べた", "yes"], ["meal", "もう食べました", "yes"],
  ["meal", "全部食べました", "yes"], ["meal", "はい、しっかり食べました", "yes"], ["meal", "朝ご飯は食べました", "yes"], ["meal", "おいしくいただきました", "yes"], ["meal", "食べたよ", "yes"], ["meal", "はい、済ませました", "yes"],
  ["meal", "まだ食べていません", "no"], ["meal", "食べてないです", "no"], ["meal", "いいえ、まだです", "no"], ["meal", "食べとらん", "no"], ["meal", "今日は食べてない", "no"],
  ["sleep", "はい", "yes"], ["sleep", "はい、眠れました", "yes"], ["sleep", "よく眠れました", "yes"], ["sleep", "ぐっすり眠れました", "yes"], ["sleep", "ぐっすりです", "yes"], ["sleep", "うん、よく寝た", "yes"], ["sleep", "寝られました", "yes"],
  ["sleep", "はい、よく寝ました", "yes"], ["sleep", "昨夜はよく眠れました", "yes"], ["sleep", "朝までぐっすり", "yes"], ["sleep", "ええ、眠れましたよ", "yes"],
  ["sleep", "眠れませんでした", "no"], ["sleep", "いいえ、眠れなかった", "no"], ["sleep", "あまり眠れなかった", "no"], ["sleep", "寝られへんかった", "no"], ["sleep", "全然眠れませんでした", "no"],
  ["cond", "元気です", "yes"], ["cond", "元気ですよ", "yes"], ["cond", "はい、元気です", "yes"], ["cond", "おかげさまで元気です", "yes"], ["cond", "大丈夫です", "yes"], ["cond", "変わりありません", "yes"], ["cond", "変わりないです", "yes"],
  ["cond", "特に変わりありません", "yes"], ["cond", "調子はいいです", "yes"], ["cond", "まあまあです", "yes"], ["cond", "ぼちぼちです", "yes"], ["cond", "問題ありません", "yes"], ["cond", "相変わらず元気です", "yes"], ["cond", "いいですよ", "yes"],
  ["cond", "元気にしてます", "yes"], ["cond", "普通です", "yes"],
  ["cond", "元気がないです", "no"], ["cond", "あまりよくないです", "no"], ["cond", "調子が悪いです", "no"], ["cond", "大丈夫じゃないです", "no"], ["cond", "具合が悪いです", "no"],
  ["help", "特にありません", "no"], ["help", "ないです", "no"], ["help", "大丈夫です", "no"], ["help", "いいえ", "no"], ["help", "特にないです", "no"], ["help", "別にないよ", "no"], ["help", "いいえ、ありません", "no"],
  ["help", "今のところ大丈夫です", "no"], ["help", "何もありません", "no"], ["help", "いえ、特には", "no"],
  ["help", "電球が切れて困っています", "yes"], ["help", "買い物に行けなくて", "yes"], ["help", "はい、あります", "yes"], ["help", "病院の予約を取りたい", "yes"],
];
describe("plain check-in answers stay as said", () => {
  it.each(PLAIN)("%s: %s is %s", (k, line, expected) => expect(answer(k, line)).toBe(expected));
});

// [line, the least serious level the adversary accepts]. Where the level here is higher than the adversary's, the
// decision is from the care setting, on the rule that a missed emergency is far worse than a false alarm:
//  - a blow to the head (「頭を打った」「転んで頭を打ったけど痛くない」) is an emergency for an old person, pain or not;
//  - a wrong or double dose (「薬を間違えて二回飲んだ」) is an emergency;
//  - days without food or water (「もう三日食べてない」「水を何日も飲んでない」) is an emergency;
//  - fear of a person (「息子が怖い」「あの人が来ると怖くて」) is an emergency.
// Kept at concern: not knowing the date (「今日が何日か分からない」) and looking for someone who is not there are
// ordinary enough in old age that an alarm every time would teach staff to ignore alarms; not knowing where one
// is (「ここがどこか分からない」) is an emergency.
const SIGNALS: [string, "emergency" | "concern"][] = [
 ['ここがどこか分からない','emergency'],['頭を打って血が出た','emergency'],['頭を打った','concern'],['もう迷惑かけたくない','emergency'],['いなくなりたい','emergency'],['薬を全部飲んだ','emergency'],
 ['睡眠薬をたくさん飲んだ','emergency'],['暖房がつかない','concern'],['暑くて倒れそう','emergency'],['三日なんも食べとらん','concern'],['水も飲めない','concern'],['息子に殴られた','emergency'],
 ['嫁に叩かれる','emergency'],['知らない人が家に入ってきた','emergency'],['胸がどきどきして止まらない','emergency'],['胸が変','emergency'],['心臓が痛い','emergency'],['息切れがひどい','concern'],
 ['ぜえぜえする','concern'],['口が回らない','emergency'],['言葉が出てこない','emergency'],['片方の手に力が入らない','emergency'],['顔の半分が動かない','emergency'],['目が見えなくなった','emergency'],
 ['頭が割れるように痛む','emergency'],['血を吐いた','emergency'],['吐血した','emergency'],['便が真っ黒','concern'],['血便が出た','concern'],['出血が止まらない','emergency'],
 ['階段から落ちた','concern'],['こけた','concern'],['こけてもうた','concern'],['ひっくり返った','concern'],['尻もちをついた','concern'],['床に座り込んだまま','emergency'],['風呂で溺れかけた','emergency'],
 ['起きられん','emergency'],['歩けない','emergency'],['歩けんようになった','emergency'],['足が立たん','emergency'],['腰が抜けた','concern'],['体が言うことをきかん','emergency'],
 ['意識が飛んだ','emergency'],['気を失った','emergency'],['気絶してた','emergency'],['失神した','emergency'],['ぼーっとして何も分からない','concern'],['今日が何日か分からない','concern'],
 ['あなた誰、うちの人はどこ','concern'],['死んだ主人が迎えに来た','concern'],['早くお迎えが来てほしい','emergency'],['もう生きるのに疲れた','emergency'],['首を吊ろうかと','emergency'],
 ['楽になりたい','emergency'],['あの世に行きたい','emergency'],['死にとうなる','emergency'],['死にたか','emergency'],['もう終わりにしようと思う','emergency'],['遺書を書いた','emergency'],
 ['包丁を持ってる','emergency'],['手首を切った','emergency'],['飛び降りようかと','emergency'],['みんなに迷惑ばかりで、私なんかいない方がいい','emergency'],['生きとってもしゃあない','emergency'],
 ['火事','emergency'],['煙が出てる','emergency'],['ガスの臭いがする','emergency'],['鍋を焦がして部屋が煙だらけ','emergency'],['泥棒が入った','emergency'],['お金を取られた','concern'],
 ['寒くて震えが止まらない','concern'],['凍えそう','concern'],['エアコンが壊れて部屋が35度','concern'],['熱中症みたい','emergency'],['汗が止まらん','concern'],['水を何日も飲んでない','concern'],
 ['おしっこが出ない','concern'],['お腹がいたくてたまらん','concern'],['頭がいたか','concern'],['えらい','concern'],['えろうてかなわん','concern'],['こわい（しんどい）んよ','concern'],
 ['だるくて何もできない','concern'],['体がだるい','concern'],['咳が止まらない','concern'],['熱が38度','concern'],['熱っぽい','concern'],['のどに詰まった','emergency'],['餅がのどにつまった','emergency'],
 ['むせて息ができん','emergency'],['息がでけへん','emergency'],['息苦しい','emergency'],['呼吸が荒い','emergency'],['胸がいとうて','emergency'],['胸が押さえつけられる','emergency'],
 ['背中に激痛が','emergency'],['痙攣した','emergency'],['ひきつけを起こした','emergency'],['骨が折れたかも','emergency'],['足が腫れて歩けん','emergency'],['やけどした','concern'],
 ['薬を飲みすぎた','emergency'],['薬を間違えて二回飲んだ','concern'],['インスリンを打ち忘れた','concern'],['低血糖みたい','emergency'],['酸素が切れた','emergency'],
 ['食べとらん','concern'],['もう三日食べてない','concern'],['何も喉を通らない','concern'],['一週間風呂に入ってない','concern'],['トイレに間に合わなくて','concern'],
 ['夜中に徘徊してたらしい','concern'],['家に帰りたい（自宅にいるのに）','concern'],['息子が怖い','concern'],['あの人が来ると怖くて','concern'],['お金を渡さないと怒鳴られる','concern'],
 ['閉じ込められてる','emergency'],['ご飯をもらえない','concern'],['通帳を取られた','concern'],['オレオレ詐欺みたいな電話が来て振り込んだ','concern'],
 ['転んだけど痛くはない','concern'],['転んで頭を打ったけど痛くない','concern'],['倒れそう','concern'],['目が回る','concern'],['立ちくらみがする','concern'],['手が震える','concern'],
];
const ORDINARY: string[] = ['遠慮しないで', '孫が怖い映画を見てた', '饅頭こわいって落語を聞いた', '株が落ちたらしい', '落ち葉を掃いた', 'いたいけな子', '甘いものが痛いほど好き', '阪神がすべって負けた', 'ドラマで人が倒れてた', '試験に落ちた孫', '落ちた枝を拾った', '箸を落ちた…落とした', '辛いカレーを食べた', 'からいものが好き', '隣の犬が転んでかわいかった', '孫が滑って遊んでた', '雪ですべって遊ぶ子がいた', '味が落ちたね、あの店', '視力が落ちて', '体重が落ちてよかった', 'スピードが落ちて', '気持ちが落ち着いた', 'お化け屋敷がこわいって孫が', '日が落ちて', 'ドラマが怖い話でね', '立てないほど笑った', 'つらいものが…いや辛いもの', '助けていただいてありがとう', '娘が助けてくれるから安心', '昔、救急車の運転手だった', 'テレビで救急車を見た', '血が出てないから平気', '腕が痛いほど握手された', '苦しい時代だったね昔は', '選挙で落ちた人', '吐いて捨てるほどある', '息子が熱がある子の世話をしてる', '電池を落ちた'];

describe("distress lines an adversary got past the detector", () => {
  it.each(SIGNALS)("%s is at least %s", (text, least) => expect(rank[level(text) ?? "none"]).toBeGreaterThanOrEqual(rank[least]));
  it.each(["頭を打った", "転んで頭を打ったけど痛くない", "薬を間違えて二回飲んだ", "もう三日食べてない", "三日なんも食べとらん", "水を何日も飲んでない", "息子が怖い", "あの人が来ると怖くて", "血を吐いた", "心臓が痛い", "息苦しい", "頭が割れるように痛む"])(
    "emergency by decision: %s", (text) => expect(level(text)).toBe("emergency"));
  it.each(["今日が何日か分からない", "倒れそう", "こけた", "えらい", "暖房がつかない", "お金を取られた"])("a check, not an alarm: %s", (text) => expect(level(text)).toBe("concern"));
  it.each(ORDINARY)("raises nothing: %s", (text) => expect(detectDistress(text)).toEqual([]));
  it("an exclusion never hides a real signal in the same line", () => {
    expect(level("テレビを見ていたら胸が痛くなった")).toBe("emergency");
    expect(level("助けていただいてありがとう、でも今は立てないんです")).toBe("emergency");
    expect(level("ドラマで人が倒れてたけど、私も今朝転んだ")).toBe("concern");
    expect(level("辛いカレーを食べたら吐いた")).toBe("concern");
    expect(level("孫が転んで、私も腰が痛い")).toBe("concern");
    expect(level("昔から腰が痛い")).toBe("concern");
  });
});

const QUIET = [
  "今日はいい天気ですね", "孫が遊びに来ました", "テレビで相撲を見ていました", "庭の花が咲きました", "散歩に行ってきました", "お茶を飲んでいます", "娘が昼から来ます", "朝ご飯はパンと卵でした",
  "元気ですよ", "よく眠れました", "薬は飲みました", "デイサービスは楽しかった", "洗濯をしていました", "買い物は昨日済ませました", "お電話ありがとう", "新聞を読んでいました",
  "助かりました、ありがとう", "味噌汁を作りました", "今日は病院の日ではありません", "髪を切ってもらいました", "痛いところはありません", "熱もないです", "風邪はひいていません", "お風呂は昨日入りました",
  "暖房をつけています", "隣の奥さんと話しました", "カラオケで歌いました", "血圧は普通でした", "畑で大根を抜きました", "寒くなりましたね", "ヘルパーさんが掃除してくれました", "息子が週末に来ます",
  "夕飯は煮物にします", "昼寝をしていました", "編み物をしています", "猫が膝で寝ています", "雨が降ってきました", "体操をしました", "手紙を書いていました", "来週は誕生日です", "ラジオを聞いています", "死ぬほどおいしいお饅頭でした",
];
describe("ordinary sentences raise nothing", () => {
  it.each(QUIET)("%s", (text) => expect(detectDistress(text)).toEqual([]));
});

// Decision: 「担当者におつなぎしますのでそのままお待ちください」 could be a receptionist. It is taken for a machine because of
// 「そのままお待ちください」, the phrase of a transfer announcement; a person's 「少々お待ちください」 is not.
const MACHINES: string[] = ['ただいま電話に出ることができません', 'こちらは留守番電話サービスです', 'おかけになった電話は電波の届かない場所にあるか', 'ただいま大変混み合っております。しばらくお待ちください', 'お電話ありがとうございます。本日の営業は終了いたしました', 'ご用件の番号を押してください。予約は1、その他は2', 'この通話は品質向上のため録音させていただきます', 'ただいま外出しております。ご用の方はファックスをお送りください', '営業時間は平日9時から17時までです。恐れ入りますがおかけ直しください', 'ただいま席を外しております。発信音の後にご用件をお話しください', 'はい、山田です。ただいま出かけております。ピーッという音がしましたらお名前を', 'ただいまお繋ぎしております', 'こちらは自動音声案内です', 'こちらはNTTドコモです。おかけになった', 'お客様のおかけになった番号への通話は、おつなぎできません', 'この電話はお受けできません', 'ただいま通話中です', 'しばらくたってからおかけ直しください', 'ただいま電話が大変かかりにくくなっております', '担当者におつなぎしますのでそのままお待ちください', '音声ガイダンスに従って操作してください', '本日は定休日です', 'ただいまの時間は診療時間外です', '留守です。ファックスの方は送信してください', 'メッセージが一杯でお預かりできません', '伝言をお預かりします', 'ピーと鳴ったらお話しください', 'ご用件を30秒以内でどうぞ', 'The person you are calling is unavailable', 'Please leave your message after the tone', 'The number you have dialed is not in service', 'Your call has been forwarded to an automated voice messaging system', 'Thank you for calling. Our office is currently closed', 'Press 1 for reservations', 'このお電話は迷惑電話防止のため録音されます。お名前をおっしゃってください', '迷惑電話防止機能が作動しています', '番号非通知の電話はお受けできません。186をつけておかけ直しください', 'こちらはソフトバンクです', 'ただいま近くにおりません', '恐れ入りますが、のちほどおかけ直しください', 'この電話番号は現在使われておりません', '転送します。しばらくお待ちください', 'はい、ただいま留守にしております', 'あいにく不在にしております。ピーという音のあとに'];
const PEOPLE: string[] = ['母は留守にしております', '留守番電話に入れておいてくれたら聞きます', '留守電聞きました', 'ただいま、あ、もしもし', '主人は電話に出られません、入院してて', 'メッセージを残しておいてもらえますか', '今、電波の届かない場所にいたのよ', '携帯の電源が入っていないことが多くて', '番号をお確かめになったほうがいいですよ、うちは田中じゃない', 'お客様のご都合によりキャンセルになりました', '社長 is not available today', '留守番電話サービスを解約したいんですが', 'おかけになった電話番号は合ってますよ', '伝言メモを見ました', '父はお呼びしましたが来ないですね', 'さっきお電話に出られませんですみません', 'voice mailは使ってないんです', '母は近くにおりませんが、私が聞きます', 'ただいま留守にしておりますって言えばいいの？', '番号をお確かめの上、って今かけ直そうとしてた'];
describe("recordings and people an adversary got mistaken for each other", () => {
  it.each(MACHINES)("machine: %s", (text) => expect(isMachineGreeting(text)).toBe(true));
  it.each(PEOPLE)("person: %s", (text) => expect(isMachineGreeting(text)).toBe(false));
  it.each(["担当におつなぎしますので少々お待ちください", "田中はただいま席を外しております", "これ自動音声ですか？", "営業時間は平日9時から17時までです", "ご用件をどうぞ"])("still a person: %s", (text) => expect(isMachineGreeting(text)).toBe(false));
});

// What two fresh probes of the redesign (written blind to the code, 2026-10-02) still got wrong, kept as regressions.
const TOPIC_Q: Record<CheckInTopic, string> = { medication: Q.med, meal: Q.meal, sleep: Q.sleep, condition: Q.cond, help: Q.help };
const OWN_CHECKIN: [CheckInTopic, "yes" | "no", ...string[]][] = [["medication", "yes", "ええ、飲みました", "A:よかったです。", "飲んだつもりやったけど、ここに残っとる"], ["sleep", "yes", "はい", "A:よかったです。", "というか、夜中じゅう起きてたんだけどね"], ["sleep", "yes", "うん", "A:承知しました。", "うん、じゃなくて、眠れなかったって言おうとしたの"], ["meal", "yes", "はい食べました", "A:よかったです。何を召し上がりましたか。", "ええと、何だったかな、いや、食べたのは昨日の晩だわ、今日はまだ"], ["help", "no", "特にありません", "A:承知しました。", "あ、ひとつだけ、ガスコンロの火がつかないのよ"], ["medication", "yes", "はい", "A:承知しました。", "待って、朝のはまだ袋に入ってるわ"]];
const OWN_SIGNALS: [string, "emergency" | "concern"][] = [["目の前が真っ暗になって、気がついたら床に寝てた", "emergency"], ["ここ、うちじゃないみたい、どこなんでしょう", "emergency"], ["息子の顔が分からんようになった", "emergency"], ["急に片目が見えんようになった", "emergency"], ["息がしづらくて、肩で息をしとる", "emergency"], ["鼻血が一時間止まらない", "emergency"], ["真っ赤な血をようけ吐いた", "emergency"], ["血圧の薬を倍飲んでしまった", "emergency"], ["もうこれ以上、子どもらに迷惑をかけとうない", "emergency"], ["いっそ楽になれたらと思う", "emergency"], ["川に入ろうかと思うた", "emergency"], ["首をくくろうかと思うて、縄を出した", "emergency"], ["薬をためてある、いっぺんに飲もうと思って", "emergency"], ["夫が暴れて物を投げてくる", "emergency"], ["殺されるかもしれん", "emergency"], ["玄関を誰かがどんどん叩いて、怖い", "emergency"], ["ストーブの火が布団に燃え移った", "emergency"], ["四日間、水も食べ物も口にしてない", "emergency"], ["喉が腫れて息が通らん", "emergency"], ["もう目が覚めなければいいのに", "emergency"], ["こぼした灯油に火がついた", "emergency"], ["自分の名前が出てこない", "concern"], ["熱が三十七度八分ある", "concern"], ["誰とも話さん日が続いとる", "concern"], ["冷蔵庫が壊れた", "concern"], ["通帳がなくなった、誰かが持っていった", "concern"], ["鍋を火にかけたまま忘れることが増えた", "concern"], ["耳鳴りがひどい", "concern"], ["知らない会社にお金を振り込んでしまった", "concern"], ["たいしたことないんやけど、左の腕がだらんとして茶碗が持てへんのよ", "emergency"], ["息がね、吸うても吸うても入ってこんのよ", "emergency"], ["いぎ くるしくてよ ねでらんねえんだ", "emergency"], ["咳したら真っ赤な血がようけ出てね", "emergency"], ["コーヒーみたいな黒いもんをどっさり吐いたんです、血じゃろうか", "emergency"], ["風呂場ですべって頭をごつんとやってね、それから吐き気がするんよ", "emergency"], ["後ろ頭をタンスの角にぶつけて、たんこぶから血がにじんどる", "emergency"], ["転んでから足が全然動かせんで、朝からずっと廊下に寝たまんまです", "emergency"], ["立ぢあがらんねくて、はってトイレさ行ってる", "emergency"], ["血圧の薬をね、飲んだか忘れてまた飲んで、三回くらい飲んだかもしれん", "emergency"], ["早うじいさんのとこへ行きたいわ、もう十分生きた", "emergency"], ["ロープは納屋に用意してあるけえ、もうええんよ", "emergency"], ["ヘルパーの男の人に体を触られて、怖くて誰にも言えなかった", "emergency"], ["コンロの火を消し忘れて鍋から火が上がっとる", "emergency"], ["ストーブつけたら頭が痛うなって、変なにおいがして気分が悪い", "emergency"], ["急に片方の目が幕がかかったみたいに見えんようになった", "emergency"], ["顔がね、鏡見たら片っぽだけ下がっとるんよ", "emergency"], ["むねんにきが痛うして、冷や汗の出よると", "emergency"], ["知らん男が庭に立っとって、戸をがたがたやっとる、怖い", "emergency"], ["名前が出てこんのよ、自分の名前が、ここがどこかも", "emergency"], ["けさ起きたら知らん家におって、帰り道が分からん", "emergency"], ["たいしたことないけど、布団のへりに足ひっかけて、どてっとね", "concern"], ["歯がうずいて、ゆうべはごはんも噛めんかった", "concern"], ["立ち上がるたんびに、くらくらっとするんよ", "concern"], ["ここ二、三日、おかゆを二口三口しか入らん", "concern"], ["ばんげの薬、三日ばかり飲み忘れてた", "concern"], ["血圧の薬がもう一週間前に切れとる", "concern"], ["ばあさんが死んでから、話し相手がおらんで涙ばっかり出る", "concern"], ["たんすに入れとった現金がのうなっとる、誰かに盗られたんじゃ", "concern"], ["知らん業者が来て、屋根を直す言うて五十万払わされた", "concern"], ["おしっこに血がまじっとる", "concern"], ["最近よう物忘れして、鍋を何べんも焦がす", "concern"], ["ごはんの味がせんのよ、何食べても砂かんどるみたいで食が進まん", "concern"], ["あだまいでくてよ、ゆうべがらずっとだ", "concern"]];
const OWN_ORDINARY: string[] = ["痛み入ります", "倒れた植木鉢を起こした", "詐欺に気をつけましょうって回覧板が来た", "相撲で大関が土俵際で倒れてね、惜しかったわあ", "孫の運動会でね、かけっこの子が転んでも泣かずに走ってえらかった", "えらいべっぴんさんが役場に来たんよ", "こわいごはんが好きでね、やわらかいのは好かんのよ", "きのうの祭りは花火がどーんと上がって、煙がきれいに流れてね", "目が回るほど忙しかったのは若いころの話でね", "耳が痛い話だねえ、片づけなさいって娘に言われて", "骨が折れる仕事だったねえ、昔の田植えは", "泥棒役の役者さんが上手でねえ、あの舞台", "怖いもの知らずの孫でね、木登りばっかりしてる", "編み物は今日で終わりにしようと思うの、もう仕上がるから", "朝ドラで主人公が泣いててね、ええ話やったわ"];
const OWN_MACHINES: string[] = ["誠に勝手ながら、年末年始は休業とさせていただきます", "伝言メモに接続します", "お預かりできるメッセージは3分以内です", "録音が終わりましたら、そのまま電話をお切りください", "お待たせしております。まもなく担当者におつなぎします。このままでお待ちください", "ボイスメールセンターに転送されました", "現在、オペレーターが全員ふさがっております", "お待たせしております。お客様は3番目にお待ちです", "年末年始のため12月29日から1月3日まで休業させていただきます", "プッシュ信号の出ない電話機をお使いのお客様は、そのままお待ちください", "入力が確認できませんでした。もう一度入力してください", "ナビダイヤルでおつなぎします。この通話は20秒ごとに10円でご利用いただけます", "るすばんでんわにせつぞくします はっしんおんのあとに めっせーじをどうぞ"];
const OWN_PEOPLE: string[] = ["番号を押してくださいって機械に言われるのがいやで、直接かけてもらうほうがええ", "本日の営業は終了しましたって、昨日スーパーに電話したら言われたのよ", "1番を押したのに何も起きんかったよ、こないだの役所の電話"];
describe("found by the redesign's own probes", () => {
  it.each(OWN_CHECKIN)("%s is never %s: %s", (topic, wrong, ...lines) => {
    const r = checkInReport([{ source: "caller", text: TOPIC_Q[topic] }, ...lines.map((l) => (l.startsWith("A:") ? { source: "caller", text: l.slice(2) } : { source: "callee", text: l }))]);
    expect(r.items.find((i) => i.topic === topic)!.answer).not.toBe(wrong);
  });
  it.each(OWN_SIGNALS)("%s is at least %s", (text, least) => expect(rank[level(text) ?? "none"]).toBeGreaterThanOrEqual(rank[least]));
  it.each(OWN_ORDINARY)("raises nothing: %s", (text) => expect(detectDistress(text)).toEqual([]));
  // Accepted false alarm: 「迷惑かけたくないから、回覧板はすぐ隣に回すようにしてるの」 is ordinary, but the same words are how an old
  // person says they want to be gone. It stays an emergency: one look by staff against a missed one.
  it("not wanting to be a burden is always read by a person", () => expect(level("迷惑かけたくないから、回覧板はすぐ隣に回すようにしてるの")).toBe("emergency"));
  it.each(OWN_MACHINES)("machine: %s", (text) => expect(isMachineGreeting(text)).toBe(true));
  it.each(OWN_PEOPLE)("person: %s", (text) => expect(isMachineGreeting(text)).toBe(false));
});
