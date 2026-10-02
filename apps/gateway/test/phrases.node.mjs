// The phrase rules of lib/sales.mjs, one table per rule: what the other person said, and what it must be heard as.
//   stopContact    "never call me again": the call ends and the number is suppressed for good.
//   refusal        a plain no. Sales calls only (wantsNoContact = stopContact || refusal).
//   asksForPerson  "give me a human": an answered call is transferred to staff.
// The ADVERSARY tables are every input an adversarial probe ran against the earlier rules (which missed 36 of 40
// stop requests and 34 of 40 requests for a person, and wrongly matched 18 and 22 of 24 ordinary sentences).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stopContact, refusal, wantsNoContact, asksForPerson } from '../lib/sales.mjs';

const table = (name, fn, want, lines) => test(`${name} (${lines.length})`, () => {
  const wrong = lines.filter(line => fn(line) !== want);
  assert.deepEqual(wrong, [], `${name}: expected ${want}`);
});

// ---------------------------------------------------------------------------------------------- stopContact
const ADVERSARY_STOP = ['二度とかけてくるな', 'もうかけてこんといて', '二度とかけないでください', '今後かけないで', 'もう電話してくるな', '電話はもういらん',
  // Debatable: no verb of calling. Said flat as the reply, 「しつこい」 is about being called repeatedly; it is heard as a stop.
  'しつこい、切るぞ',
  '番号を消してください', 'うちの番号、どこで知ったんですか、消して', 'リストから外せ', 'リストからはずしてください', 'かけてくんな', 'もう掛けてこなくていいです',
  '二度と電話するな', '今後一切お電話はご遠慮願います',
  // Debatable: a policy, not a request. Said to a caller, "we refuse all sales calls" leaves nothing to call back for.
  '営業電話は全部断ってます', 'こういう電話は困ります',
  '電話しないでもらえますか', 'もうお電話いただかなくて結構です', '今後のご連絡はお控えください', 'ご連絡は差し控えてください', '二度とかけてこないでくれ',
  '警察に言いますよ', '消費者センターに通報します', '着信拒否にします', '電話番号を削除しろ', '個人情報を消去してください', '以後、架電はおやめください',
  'もう電話かけんな', '電話せんといて', '二度と連絡よこすな', 'かけてくるのやめてもらっていいですか', 'セールスはお断りしてます', '勧誘の電話は受けません',
  'こちらからかけ直すことはないので、かけないで', '今後はメールだけにして、電話はなしで', '2度とかけるな', '電話してくんなって言ってるだろ',
  '亡くなりましたので、もうかけないでください'];
// The adversary expected a stop. It names no contact and no list (「入院はもう二度とごめんです」 has the same shape), so it is
// not a stop in an ordinary request; in a sales call it is a refusal, which ends the call and suppresses all the same.
const ADVERSARY_STOP_REFUSAL_ONLY = ['もう二度とごめんです'];
const ADVERSARY_NOT_STOP = ['迷惑でなければ15時でお願いします', 'ご迷惑をおかけしました', '迷惑メールに入っていたかも', 'もう一度連絡してください', '電話でやめておきます、メールで',
  '今後のご連絡はこの番号にお願いします、もう一つは不要です', '迷惑じゃないですよ', 'もう電話してもいいですか、と聞かれたので', '連絡不要です、当日伺います',
  '登録を削除して新しい住所にしてください', '営業時間をやめて…いや営業時間を教えて', 'もういいですよ、どうぞ続けて', 'お電話遠慮なくください', '連絡をお断りする理由はないです',
  '名簿から消してた番号を戻してください', '迷惑をかけてすみません、15時で大丈夫です', 'もうお電話しなくても大丈夫です、予約できましたので', '明日の電話は不要です、今日決めましょう',
  'リストを送ってください、古いのは削除して', 'お手数をおかけして迷惑でしたね', '営業の田中さんにやめてもらった件', 'してこないでしょうね、彼は', '二度と遅れないよう連絡します',
  '納品の連絡は不要です、20日で確定です'];
const STOP = [
  // 1a かける
  'もうかけてこないでください', '二度とかけてこないで', 'かけないでください', 'うちにはもうかけんといて', 'もうかけてこんといてください', 'かけてくるなと言っただろう',
  '二度と掛けてこないでほしい', 'もうかけてくるのはやめてください', 'かけてこられても困ります', 'ここにはかけないでね',
  // 1b 電話・連絡・営業・勧誘・訪問
  'もう電話してこないでください', '今後一切連絡してこないで', '今後電話しないでください', 'もう二度と電話しないでください。', '今後は連絡しないでください',
  '電話してこないでほしいんですけど', '連絡してくるな', 'もう営業しないでください', '勧誘はやめてください', '訪問しないでください', '電話するのはやめてください',
  '二度と連絡してこないで', '電話すんな', 'もう連絡せんといて', 'お電話はやめていただけますか',
  // 1c–1f
  'もう電話してこなくて結構です', '今後、連絡は不要です', '電話は一切お断りします', '営業のお電話はお断りしています', 'セールスは結構です', '勧誘は一切受け付けていません',
  'お電話はご遠慮ください', 'こんな電話迷惑です', 'この手の勧誘はいりません',
  // 1g
  '迷惑です。やめてください', 'はっきり言って迷惑です',
  // 2 list
  'リストから削除してください', '名簿から外してください', '登録を抹消してください', 'うちの番号を消せ', '私の情報を削除してください', '電話番号、消してもらえますか',
  // 3 block / report
  '着信拒否にしました', 'これ以上かけてきたら警察に通報します', '消費者センターに相談しますよ', '訴えますよ',
  // 4 deceased / gone
  '亡くなりました', '母は他界しました', '本人はもういません', '主人は亡くなりましたので',
  // 5 English, and full-width input
  'do not call me again', 'Please take me off your list.', "Don't call this number", 'stop calling me', 'Remove my number', 'never contact us again', 'ｍｏｕ かけてこないで'];
const NOT_STOP = [
  // the existing suite's ordinary replies
  'はい、今は大丈夫です。', 'それで結構です。', 'ご迷惑をおかけしました。', '担当に代わります。', 'もう一度お願いします。', 'いえ、それは結構です。在庫はあります。',
  // 迷惑 about the speaker, or politely
  'ご迷惑でしょうが、もう一度お願いします', '迷惑ですよね、すみません', 'ご迷惑でなければ伺います', '迷惑だったら言ってくださいね',
  // 不要・結構・遠慮 about something else
  '領収書の連絡は不要ですよ', '折り返しの電話は結構です、こちらからかけます', '遠慮なくお電話ください', '配達前の電話はいりません',
  // かける that is not a phone call
  '鍵をかけないで出てしまって', '迷惑をかけないでくださいね、と孫に言いました', '今日は出かけないでいます', '時間をかけないでやりましょう', '声をかけないでくれたら自分でやります',
  // a correction, an order list, a booking number
  '登録の住所を消して新しいのにしてください', 'その商品はリストから外してください', '予約番号を消してしまいました', '古い番号は削除して、新しい番号を登録してください',
  // when to call, not whether
  '夜はかけないでください', '仕事中は電話しないでください', '日曜は電話してこないでね',
  // hearsay, a denial, a question, the past, a third party
  'かけないでと言われたので、かけていません', '電話するなとは言いませんが', '警察に相談しますか', '泥棒が入って警察に通報しました', '着信拒否になっていませんか',
  '主人は3年前に亡くなりました', '去年、犬が亡くなりました', '担当はもういません、帰りました',
  // speaker's own plan
  'こちらからは電話しないでおきます', '今日は連絡はやめておきます', 'もう電話しましたか', 'do not call it a failure', ''];

table('adversary: a stop request is heard', stopContact, true, ADVERSARY_STOP);
table('adversary: a stop request is heard in a sales call too', wantsNoContact, true, ADVERSARY_STOP);
table('adversary: "never again" with no contact named is not a stop', stopContact, false, ADVERSARY_STOP_REFUSAL_ONLY);
table('adversary: … and is a refusal in a sales call', wantsNoContact, true, ADVERSARY_STOP_REFUSAL_ONLY);
table('adversary: an ordinary sentence is not a stop', stopContact, false, ADVERSARY_NOT_STOP);
table('a stop request is heard', stopContact, true, STOP);
table('not a stop', stopContact, false, NOT_STOP);

// ---------------------------------------------------------------------------------------------- refusal (sales calls only)
const REFUSAL = ['不要です', 'いえ、不要です', 'うちは不要です', 'お断りします', 'お断りいたします', '興味がありません', '興味ないです', '興味はございません', 'いりません', '要りません',
  '必要ありません', '必要ないです', '必要としていません', '特に必要としておりません', 'うちは間に合ってます', '間に合っております', '今はいいです', 'うちはいいです', '今回はいいです',
  'やめてください', '結構です。', 'いえ、結構です。', 'もう結構です', 'いや、結構です', 'それは結構です', 'いえ、大丈夫です', 'いや、いいです', 'いえ、もういいです', 'もういいです',
  'うちは大丈夫です', '今回は見送ります', '今回は見送らせてください', '今回は見送りで', '遠慮しておきます', 'ご遠慮します', '遠慮させていただきます', '他で頼んでいます',
  '他社にお願いしてます', 'よそで契約しています', '予算がありません', '予算がないんです', 'もう二度とごめんです', 'not interested', 'No, thank you.', "we're all set"];
const NOT_REFUSAL = ['はい、大丈夫です。', 'はい、今は大丈夫です。', '大丈夫です、続けてください', 'それで結構です。', '15時で結構です', 'はい、結構です', '結構ですね、ぜひ',
  '結構ですよ、どうぞ', 'それでいいです', 'これでいいです', '15時でいいです', 'いいですね', 'いいですよ', 'もういいですよ、どうぞ続けて', '今は大丈夫です', '時間は大丈夫です',
  '納品の連絡は不要です、20日で確定です', '連絡不要です、当日伺います', 'お断りする理由はないです', '遠慮なくどうぞ', '予算はあります', '他でも頼んでみます', '見送りに行きます', '興味があります', ''];
table('a refusal is heard', t => refusal.test(t), true, REFUSAL);
table('not a refusal', t => refusal.test(t), false, NOT_REFUSAL);

// ---------------------------------------------------------------------------------------------- asksForPerson
const ADVERSARY_PERSON = ['人間を出して', '人を出してください', '担当者をお願いします', '人間の方お願いします', 'オペレーターをお願いします', '誰か分かる人いないの', 'ちゃんとした人に代わって',
  'あなたじゃ話にならない、上を出して', '責任者を出せ', '店の人を呼んで', '本物の人と話したい', '生身の人間をお願い', 'AIとは話したくない', '機械は嫌です', 'ロボットとは話しません',
  '自動音声は結構です、人をお願いします', '係の人お願いします', 'スタッフの方に替わってもらえますか', '社員の人出して', '有人対応にして', '窓口につないで', '電話を代わってください',
  // Debatable, kept as a request: unlike 「担当の方はいらっしゃいますか」 these ask for someone OTHER than the voice answering,
  // which on an AI-answered line is a request for a person.
  '他の人いませんか', '人間のスタッフはいますか',
  '日本語のわかる人をお願いします', '人間ですか？人間に代わって', 'オペレーターにつないで', '担当者出して', '店長を出してください', '上司を呼んでください', 'わかる人に代わってもらえる？',
  '人につないでください', '直接話せる方をお願いします', 'あんた機械やろ、人呼んで', 'AIはいやだ', '代表者をお願いします', '別の方に代わってください', 'お店の方と直接お話ししたいのですが',
  'real personをお願いします'];
// The adversary expected a transfer. The existing suite (concurrency.node.mjs) holds that 「担当の方はいらっしゃいますか」
// only asks whether the role is in; this is the same question without the keigo, so it is not a transfer either.
const ADVERSARY_PERSON_NOT = ['担当の方いますか'];
const ADVERSARY_NOT_PERSON = ['担当者に伝えておきます', '店長に話しておきます', '担当に話をしておきますので15時でお願いします', '社長と話してから決めます', '担当に変わりはないです',
  '上の者に話を通してあります', 'スタッフに話したら大丈夫とのことでした', '人に話すことではないので', '誰かに話したかっただけです', '店長に代わりましたが私が田中です', '担当に回しておきます、資料を',
  '責任者に話が通っていませんでした', '社員に変わったことはありません', '担当者に替わりまして、私が承ります', '人と話すのが好きでね', '職員に話を聞いてもらってます', '社長に代わって私がお受けします',
  '店員につないでもらった電話です', '係に話してあります', '人に代わってもらって買い物してます', 'AIではない方がよかったけど、まあいいです', '機械じゃないのね、よかった', '店長に確認して話を進めます',
  '担当とつながりがある会社です'];
const PERSON = ['担当の方に代わってください', '人と話したいんですが', 'オペレーターにつないでください', '責任者と話をさせて', 'AIじゃなくて人に代わって', '誰か人間に代わってもらえますか',
  '店長に回してください', 'ｓｐｅａｋ　ｔｏ　ａ　ｐｅｒｓｏｎ', 'please transfer me', '担当者に代わっていただけますか', '担当の方をお願いします', '店長をお願いします', '社長を出せ', '責任者を出してください',
  '上の人に代わって', '上の者を出しなさい', 'スタッフに繋いでください', '店員さんを呼んでください', '職員の方と話したいです', '人間と話がしたい', '人間に代わってくれ', '誰かに代わってもらえますか',
  'どなたか出してください', '詳しい人に代わってください', '話のわかる人を出して', '日本語が話せる人に代わって', '担当の田中さんをお願いします', '店長に電話を代わってください', 'オペレーターと話せますか',
  '機械じゃ話にならない', '自動音声は嫌です', 'ロボットは困ります', 'AIとか無理', 'AIではなく人をお願いします', 'お前じゃだめだ、店長を呼べ', '電話代わってくれ', '代わってください',
  '人をお願いします', 'マネージャーを呼んでください', '上司に代われ', '係の方につないでいただけますか', 'I need to talk to a real person', 'Can I speak with a manager?', 'put me through to someone', 'operator, please'];
const NOT_PERSON = ['担当者に伝えてください', '担当の方はいらっしゃいますか', '予約をお願いします', 'AIですか', '人数は三人です', '担当者から折り返してください', 'スタッフの対応がよかったです', '',
  '私が担当です', '担当の田中です', '店長は不在です', '店長に伝えておきます', '担当に確認します', '大人2人でお願いします', '3人で予約をお願いします', '二人お願いします', 'スタッフの手配をお願いします',
  '受付をお願いします', 'お電話代わりました、田中です', '担当が変わりました', '人が足りなくて', '人に聞いてみます', '誰かに頼んでおきます', '社長に相談してから連絡します', '責任者に確認して折り返します',
  '本人に代わって私が聞いています', '人気のメニューをお願いします', '人間ドックの予約をお願いします', 'AIでも大丈夫です', '機械に詳しくなくて'];
table('adversary: a request for a person is heard', asksForPerson, true, ADVERSARY_PERSON);
table('adversary: asking whether the role is in is not a transfer', asksForPerson, false, ADVERSARY_PERSON_NOT);
table('adversary: an ordinary sentence is not a request for a person', asksForPerson, false, ADVERSARY_NOT_PERSON);
table('a request for a person is heard', asksForPerson, true, PERSON);
table('not a request for a person', asksForPerson, false, NOT_PERSON);

// ---------------------------------------------------------------------------------------------- none of the three
const ORDINARY = [
  // a sales call
  'はい、田中です。', 'はい、今は大丈夫です。', 'はい、9月25日の15時でお願いします。', '資料を送ってください。', '少々お待ちください。', '来週の火曜日なら空いています', '詳しく聞かせてください',
  'それはおいくらですか', '検討して、こちらから連絡します', 'メールでも送ってもらえますか', '15時で結構です', '迷惑でなければ15時でお願いします', '迷惑をかけてすみません、15時で大丈夫です',
  'もういいですよ、どうぞ続けて', 'お電話遠慮なくください', '社長と話してから決めます', '店長に話しておきます', '担当に回しておきます、資料を', '担当者に替わりまして、私が承ります',
  // a supplier call
  '在庫はあります、20箱で大丈夫です', '納品は20日で確定です', '数量は50個で承りました', '金曜の午前中に届けます', '伝票番号は後で連絡します', '請求書は月末にお送りします',
  '担当に確認して折り返します', '配送はヤマトでお願いします', '注文はFAXでもいただけます', 'その商品は入荷待ちです', '納期は一週間ほどかかります', '送料は別途かかります',
  // a reservation
  '19時から4名で承りました', '当日の変更はお電話ください', 'アレルギーはありますか', 'コースは5000円からです', '予約は田中様で取りました',
  // a wellbeing call
  '元気ですよ、ありがとう', '今日は散歩に出かけました', '薬は飲みました', '朝ごはんは食べました', '昨日は娘が電話をかけてきてくれました', '膝が少し痛いけど大丈夫', '夜はよく眠れました',
  'また明日も電話してくださいね', '心配をかけてすみませんね', 'デイサービスの人が来てくれました', '孫と話すのが楽しみです', 'いつも連絡ありがとうね'];
test(`an ordinary sentence matches none of the three rules (${ORDINARY.length})`, () => {
  const wrong = ORDINARY.flatMap(line => [['stopContact', stopContact], ['refusal', t => refusal.test(t)], ['asksForPerson', asksForPerson]].filter(([, fn]) => fn(line)).map(([rule]) => `${rule}: ${line}`));
  assert.deepEqual(wrong, []);
});
test('non-text input is never a match', () => { for (const v of [null, undefined, 0, {}]) { assert.equal(stopContact(v), false); assert.equal(wantsNoContact(v), false); assert.equal(asksForPerson(v), false); } });
