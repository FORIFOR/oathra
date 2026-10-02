/** Sales verdicts.
 *
 * Whether a meeting was agreed is decided by the Oathra evidence engine (`packages/evidence`), the same
 * deterministic check behind every other Oathra result, in its appointment mode: the caller proposes a slot
 * and the callee's clean commitment confirms it. Hedges, deferrals, scheduling conflicts and refusals never do.
 * This file only adds the sales-specific facts the engine has no field for (materials permission,
 * acknowledgement, do-not-contact) and maps the engine's result onto the mission's result shape.
 *
 * This is transcript evidence, not a guarantee of ASR correctness or of a future meeting occurring. */
import { phoneReferenceDate } from '../../../packages/core/dist/index.js';
let EvidenceEngine, evaluate, defineCall, definePhoneRequest;
try {
  ({ EvidenceEngine, evaluate } = await import('../../../packages/evidence/dist/index.js'));
  ({ defineCall, definePhoneRequest } = await import('../../../packages/contract/dist/index.js'));
} catch (error) {
  throw new Error('Oathra Gateway needs the built evidence engine. Run `pnpm install --frozen-lockfile && pnpm build` in the repository root first.', { cause: error });
}
const MEETING = defineCall({ goal: 'sales.meeting', language: 'ja', require: { date: true, time: true, confirmed: true }, confirmation: 'callee_acceptance' });

// ---------------------------------------------------------------------------------------------- phrase rules
// What the OTHER person said, matched on NFKC-normalised text. Each rule is a short list of named shapes with
// examples, not one alternation: a miss on stop-contact calls back someone who said never, a false match ends an
// ordinary call and blocks a customer. Every example here and every adversarial input is in test/phrases.node.mjs.
const normal = t => String(t ?? '').normalize('NFKC');
const R = String.raw;
const any = (...shapes) => new RegExp(shapes.join('|'), 'i');
// What makes a て-form or 〜ないで a request: ください, くれ, もらえますか, ほしい, a particle, the end of the sentence.
// Not 〜ておきます, 〜てから, 〜てもらった, 〜ないでしょう.
const REQ = R`(?=ください|下さい|くれ|おくれ|もらえ|もらいた|もらって(?:も)?(?:いい|よろしい)|いただけ|いただきた|頂け|ほしい|欲しい|ちょうだい|頂戴|けろ|けれ|お願い|頼む|ほんと|本当|よ(?![かうりく])|ね|や(?![めっ])|な(?![らいく])|って|[。、,.!?\s]|$)`;
// 〜な / 〜せ as an imperative, not 〜なら, 〜なんて, 〜なので, 〜せば, 〜せる.
const NA = R`(?![らんどのにぁ])`, E = R`(?![ばるなま])`;
// Spoken as hearsay or denied: 「かけないでと言われた」「かけるなとは言いません」「〜というわけではない」.
const NOT_A_REQUEST = /(?:と|って)(?:は|まで)?(?:言(?:って|い|わ)(?:い?ない|い?ません|おりません)|(?:聞か|言わ|頼ま)れ)|(?:という)?わけ(?:では|じゃ)(?:ない|ありません)/;
const found = (rule, s) => { const m = rule.exec(s); return m && !NOT_A_REQUEST.test(s.slice(m.index)) ? m : null; };

// ---- stopContact: the person asked not to be called again. The call ends and the number is suppressed for good.
const MARK = R`(?:今後|二度と|2度と|もう|一切|以後|以降|これから|今度から|金輪際|これ以上)`;
const ADV = R`(?:(?:もう|二度と|2度と|一切|全部|すべて|全て|これ以上|絶対に?|金輪際|今後)、?){0,3}`;
const P = R`(?:を|は|も|とか|なんか|なんて|って|、)?`;
// かける as "to phone": not 迷惑をかける, 鍵をかける, 声をかける, 出かける, 見かける, 話しかける.
const KAKE = R`(?<![出見腰っ])(?<!追い|問い|話し|呼び|働き|仕|心)(?<!(?:迷惑|心配|手間|手数|苦労|負担|面倒|鍵|カギ|かぎ|気|声|目|時間|金|保険|圧力|水|醤油|ソース|塩|布団|毛布|エンジン|ブレーキ|アイロン|掃除機|カバー|ロック|期待|疑い|情け|眼鏡|メガネ|電源|音楽|願|命|手|上|壁)(?:を|に|は|も)?)(?:かけ|掛け|架け)`;
const SALES_N = R`(?:営業|勧誘|セールス)の?お?電話|勧誘|セールス|営業(?!時間|日|所|部|担当|マン|中|さん|の|職|活動|成績|再開|開始|して(?:い|お))`;
// Contact in general. 「納品の連絡」「明日の電話」「折り返しの電話」 are one particular call, not contact: a noun before の
// disqualifies unless it is 今後の / 営業の / そちらからの / うちへの.
const N = R`(?<!(?<!今後|以後|これから|から|へ|宛|宛て|あて|一切|全て|すべて|営業|勧誘|セールス|以上|この手|そちら|おたく|お宅|御社|あなた|あんた|おまえ|お前)の(?:お|ご)?)(?:${SALES_N}|お?電話|でんわ|ご?連絡|れんらく|訪問|架電)`;
const STOP_REQ = R`(?:(?:やめ|止め|よし)て${REQ}|(?:やめ|止め)(?:ろ|なさい|てんか)|おやめ(?:ください|下さい|いただ|願|になって))`;
const NAIDE = R`(?:ないで${REQ}|ん[とど](?:いて|って)|んでくれ|んでください|んでほしい|ねで|ないように?(?:して|お願い|願))`;
const TE_END = R`(?:(?:こ|来)ないで${REQ}|(?:く|来)るな${NA}|くんな${NA}|(?:こ|来)ん[とど](?:いて|って)|(?:こ|来)んで(?:${REQ}|ええ|よか|いい|けろ|おくれ)|くれるな|(?:ほし|欲し)くな|(?:く|来)るの(?:は|を)?(?:もう)?${STOP_REQ}|(?:こ|来)られ(?:て|ると|ても)(?:は|も)?(?:困|迷惑)|(?:く|来)る?んじゃ(?:ない|ね)|(?:こ|来)ねで|くな${NA})`;
const DECLINE_MARKED = R`(?:いら(?:ん|ない|へん)|(?:い|要)りません|不要|結構|けっこう|(?:なし|無し)(?:で|に|だ|です|$)|お断り)`;
const STOP_CALL = any(
  // 1a かける in a prohibition: かけないで / かけないでください / かけてこないで / かけてくるな / かけてくんな / かけるな /
  //    かけんな / かけんといて / かけてこんといて / かけてくるのやめてもらっていいですか — with or without もう・二度と・今後
  R`${KAKE}(?:${NAIDE}|るな${NA}|んな${NA}|て${TE_END}|るの(?:は|を)?(?:もう)?${STOP_REQ})`,
  // 1b 電話・連絡・営業・勧誘・訪問 + する/かける/よこす in a prohibition: 電話しないでください / 電話してくるな / 電話するな /
  //    電話せんといて / 電話かけんな / 連絡よこすな / 連絡してこないで / 勧誘はやめてください / 架電はおやめください
  R`${N}${P}${ADV}(?:(?:し|かけ|掛け|よこさ|寄越さ|なさら|くださら|いただか|頂か)${NAIDE}|せん(?:といて|とって|でくれ|でください|でほしい)|(?:する|す|かける|掛ける|かけ|掛け|よこす|寄越す)ん?な${NA}|(?:して|かけて|掛けて|よこして|寄越して)${TE_END}|(?:する|かける|掛ける|してくる|かけてくる)の(?:は|を)?(?:もう)?${STOP_REQ}|${STOP_REQ})`,
  // 1c 〜なくていい only with もう/今後…: もう掛けてこなくていいです / もうお電話いただかなくて結構です.
  //    「〜しなくても大丈夫です」 is a kindness ("no need, it is settled"), not a stop.
  R`${MARK}[^。]{0,10}?(?:${KAKE}(?:て(?:こ|来))?|${N}${P}${ADV}(?:し|して(?:こ|来)|かけ|掛け|かけて(?:こ|来)|いただか|頂か|もらわ|くれ))なくて(?:も)?(?:いい|結構|ええ|よい|よろしい|けっこう)`,
  // 1d contact itself declined: 電話はお断りします / 営業電話は全部断ってます / 勧誘の電話は受けません /
  //    お電話はご遠慮願います / ご連絡はお控えください / 差し控えてください. Not 「遠慮なく」, not 「お断りする理由はない」.
  R`${N}${P}${ADV}(?:お断り(?!する(?:理由|つもり|わけ|こと))|断って(?:い?ます|い?る|おり)|受け(?:ません|ない|付けません|付けて(?:い|お)(?:ません|りません|ない))|ご遠慮(?:ください|下さい|願|いただ)|遠慮して${REQ}|お控え(?:ください|下さい|願|いただ)|(?:差し)?控えて${REQ}|勘弁)`,
  // 1e 不要・結構・いらない・なしで about contact need もう/今後/一切 or a sales word: 電話はもういらん / 今後、連絡は不要です /
  //    今後はメールだけにして、電話はなしで / セールスは結構です. 「連絡不要です、当日伺います」 is about one notification.
  R`${MARK}[^。]{0,14}?${N}${P}${ADV}${DECLINE_MARKED}`,
  R`${N}${P}(?:もう|二度と|2度と|一切|今後|金輪際|これ以上)、?${DECLINE_MARKED}`,
  R`(?:${SALES_N})${P}${ADV}(?:${DECLINE_MARKED}|困|迷惑)`,
  // 1f this kind of call is unwelcome: こういう電話は困ります / こんな電話迷惑です / この手の勧誘はいりません
  R`(?:こういう|こういった|こんな|この手の|この種の|そういう|そんな)(?:お?電話|勧誘|営業|セールス|の)(?:は|も|が|、)?(?:本当に|ほんまに|正直)?(?:困|迷惑|やめ|いら|結構|お断り|嫌|いや)`,
  // 1g said flat to the caller: 迷惑です。 / しつこい、切るぞ. Never 迷惑でなければ, ご迷惑を, 迷惑をかけて, 迷惑ですよね, しつこいようですが.
  R`(?:^|[、。!\s])(?:はっきり言って|正直|本当に|ほんまに)?迷惑(?:です|だ|なんです|なんだ|や)(?!よね|か|けど|が|し|ろ|っ|と)`,
  R`(?:^|[、。!\s])しつこい(?:な|よ|ぞ|わ|って|です|んだよ|ねん)*(?:[、。!]|$)`);
// 「夜はかけないでください」「仕事中は電話しないで」 limit when to call; they are not "never" unless 二度と/一切 is said too.
const WHEN_ONLY = /(?:夜|朝|昼|夕方|深夜|早朝|午前中?|午後|時間帯?|時(?:以降|過ぎ|まで|前|台)?|仕事中|勤務中|営業中|食事中|授業中|会議中|運転中|日曜日?|土曜日?|土日|休日|祝日|平日|週末|今|今日|本日)(?:に)?は、?$/;
const ALWAYS = /二度と|2度と|一切|金輪際|今後/;
// 2 removal from a list, as a request or an imperative: リストから外せ / 名簿から削除してください / 番号を消してください /
//   電話番号を削除しろ / 個人情報を消去してください / 登録を抹消して. Not a correction (削除して新しい住所に, 消してた番号を戻して),
//   not an item on an order list (商品をリストから外して), not 予約番号.
const REMOVE = R`(?:(?:削除|抹消|消去|除外)(?:し(?:て|といて|とって)${REQ}|しろ|せよ|せえ|を?お願い|願い|$|[。!])|(?:外|はず|消)(?:し(?:て|といて|とって)${REQ}|せ${E}))`;
const NO_SWAP = R`(?![^。]*(?:新し|戻し|戻す|変更|更新|入れ替|差し替|し直|代わりに|訂正))`;
const STOP_LIST = any(
  R`(?<!(?:注文|発注|商品|見積|在庫|メニュー|候補|価格|買い物|納品|配送|予約|参加者?|出席)の?)(?<!(?<!私|わたし|うち|こちら|番号|名前|当社|弊社|当店|情報)(?:を|は))(?:リスト|名簿|台帳|データベース)(?:から|より)${NO_SWAP}[^、。]{0,8}?${REMOVE}`,
  R`(?:(?<!予約|注文|受付|伝票|会員|整理|部屋)番号|個人情報|連絡先|(?<!(?<!うち|私|わたし|こちら|当社|弊社|当店|番号)の)(?:登録|データ|情報))(?:を|は|も|、)?${NO_SWAP}[^、。]{0,6}?${REMOVE}`,
  // うちの番号、どこで知ったんですか、消して
  R`(?:番号|個人情報)${NO_SWAP}[^。]*[、?]\s*(?:消して|削除して|消せ|削除しろ)(?:ください|くれ|よ|ね)*[。!]?$`);
// 3 blocking or reporting, as intent: 着信拒否にします / 警察に言いますよ / 消費者センターに通報します / 訴えますよ.
//   Not a past event (警察に通報しました) and not a question (警察に相談しますか).
const STOP_BLOCK = any(
  R`着信拒否(?:に|を)?(?:します|する(?!と|か(?!ら)|の|な)|しました|した(?![らのかほ方])|させて|設定)`,
  R`(?:警察|消費者(?:生活)?センター|消費生活センター|国民生活センター|消費者庁|総務省|弁護士)(?:に|へ)(?:でも)?(?:言い|言う|通報|相談|訴え|届け|報告|言いつけ)(?:ます|します|する|させて(?:いただきます|もらいます)|る|出ます)?(?:よ|ぞ|から(?:ね|な)?|わ|で)?(?:[。、!]|$)`,
  R`(?:消費者(?:生活)?センター|消費生活センター|国民生活センター|消費者庁)(?:に|へ)(?:連絡|電話)(?:します|する|させて)(?!か(?!ら))`,
  R`通報(?:します(?!か(?!ら))|するぞ|するよ|するから|させて(?:いただ|もら))`, R`訴え(?:ます(?!か(?!ら))|るぞ|るよ|てやる)`);
// 4 the person called is dead or gone, as the whole answer: 亡くなりました / 母は他界しました / 本人はもういません.
//   With a stop request (亡くなりましたので、もうかけないでください) shape 1 already applies. A long sentence, a date
//   in the past (3年前に亡くなりました) or another subject (犬が, 担当は) is talk about someone, not an answer.
const GONE = /(?:亡くなりました|亡くなって(?:い|お)ります|亡くなってます|亡くなったんです|他界(?:しました|いたしました|して(?:い|お)ります)|死にました|死んだ(?:よ|んです|んだ)?|死亡しました|永眠(?:しました|いたしました)|もう(?:この世に)?い(?:ません|ない(?:です|よ|んです)?))(?:ので|から|けど|が|よ|ね|わ)?[。、!]?$/;
const NOT_GONE = /年前|去年|昨年|先月|先週|昔|以前|頃|ころ|とき|今日|本日|今は|ただいま|時間|犬|猫|ペット|友|知人|知り合い|近所|隣|テレビ|ニュース|在庫|担当|係|[?]|か$/;
// 5 English
const STOP_EN = any(R`\b(?:do not|don'?t|never|stop|quit)\s+(?:ever\s+)?(?:call|calling|contact|contacting|phone|phoning|ring|ringing)\b(?!\s+(?:it|that)\b)`,
  R`\btake\s+(?:me|us|my \w+|this number)\s+off\b`, R`\b(?:remove|delete)\s+(?:me|us|my (?:number|name|details|info\w*)|this number)\b`,
  R`\bunsubscribe\b`, R`\b(?:block|report)(?:ing)? (?:this|your|the) number\b`, R`\bno more calls\b`, R`\blose (?:my|this) number\b`, R`\bdo[- ]not[- ]call list\b`);
// `gone: false` for ordinary requests and wellbeing calls: there 「主人は亡くなりました」 is a person talking about their life,
// not an answer that the person called is dead; only an explicit request stops those calls.
export const stopContact = (t, { gone = true } = {}) => {
  const s = normal(t).trim(), call = found(STOP_CALL, s);
  if (call && !(WHEN_ONLY.test(s.slice(0, call.index)) && !ALWAYS.test(s))) return true;
  return Boolean(found(STOP_LIST, s) || found(STOP_BLOCK, s) || STOP_EN.test(s) || (gone && s.length <= 28 && GONE.test(s) && !NOT_GONE.test(s)));
};

// ---- refusal: SALES calls only. Anything a person would read as "no" ends the call and suppresses the number.
const YES_FOLLOWS = R`(?!ね|な|か|よ?、?(?:どうぞ|お願い|続け|進め))`;
const REFUSAL = any(
  // plain declines: 不要です / お断りします / 興味がありません / いりません / 必要ありません / 必要としていません / 間に合ってます / やめてください
  R`(?:^|[、。!\s]|いえ|いや|もう|(?:うち|当社|弊社|今|今回|それ|そういうの)に?は)不要です`, R`お断り(?!する(?:理由|つもり|わけ|こと))`, R`興味(?:が|は|も)?(?:ない|無い|ありません|ございません)`, R`(?:いり|要り)ません`,
  R`必要(?:ない|ありません|ございません|として(?:い|お)?(?:ません|りません|ない))`, R`間に合って(?:い?ます|おります|る)`, R`やめて(?:ください|くれ)`,
  // 結構です in its declining sense: free-standing, or after いえ/いや/もう. 「それで結構です」「15時で結構です」 accept,
  // 「結構ですね」 approves, 「結構ですよ、どうぞ」 invites.
  R`(?<![でて])(?<!(?:はい|ええ|うん)、?)結構です${YES_FOLLOWS}`,
  // 大丈夫です / いいです only as a decline: いえ、大丈夫です / いや、いいです / うちはいいです / 今はいいです / the whole reply 「もういいです」.
  // 「はい、大丈夫です」「今は大丈夫です」「それでいいです」「もういいですよ、どうぞ続けて」 are not.
  R`(?:いえ|いや|いいえ)、?(?:もう|それは|うちは|今は|今回は)?(?:いい|結構|大丈夫)(?:です|っす)${YES_FOLLOWS}`,
  R`(?:今|うち|今回|当社|弊社|そういうの|そういったの)は(?:もう)?(?:いい|結構)(?:です|っす|わ)${YES_FOLLOWS}`,
  R`(?:うち|今回|当社|弊社|そういうの|そういったの)は(?:もう)?大丈夫(?:です|っす)${YES_FOLLOWS}`,
  R`^(?:あ、?)?もう(?:いい|結構|大丈夫)(?:です|っす|わ|よ)*[。!]?$`,
  // the common polite declines: 今回は見送ります / 見送らせてください / 遠慮しておきます / ご遠慮します / 他で頼んでいます / 予算がありません / もう二度とごめんです
  R`見送(?:り(?!に(?:行|い|来))|らせて|る)`, R`ご?遠慮(?:します|いたします|致します|させて|申し上げ|しておきます|しときます)`,
  R`(?:他|ほか|よそ|別)(?:社|所|のところ|の業者|の会社)?(?:さん)?(?:で|に)(?:もう)?(?:頼んで|お願いして|契約して|決めて|使って)(?:い?ます|おります|い?る|あります)`,
  R`予算(?:が|は|も)?(?:ありません|ない|無い|ございません|取れ(?:ません|ない)|厳し)`, R`(?:もう|二度と)(?:ごめん|御免|勘弁)(?:です|だ|して)`,
  // English
  R`\bnot interested\b`, R`\bno,? thanks?\b`, R`\bwe(?:'re| are) (?:all set|fine)\b`, R`\b(?:we|i)(?:'ll| will) pass\b`);
export const refusal = { test: t => REFUSAL.test(normal(t).trim()) };
/** Sales calls only: the callee asked not to be called again, or declined. Either way: stop this call and suppress the number. */
export const wantsNoContact = t => stopContact(t) || refusal.test(t);

// ---- asksForPerson: someone on a business line wants a person, not the AI. The call is transferred to staff.
// Always "talk to / put me through to / hand me to", never a bare 「担当者」: 「担当者に伝えてください」 is a message.
const QUAL = R`(?:わかる|分かる|話せる|話の(?:わかる|分かる|通じる)|詳しい|ちゃんとした|まともな|本物の|生身の|本当の|別の|他の|ほかの|違う|偉い|お?店の|会社の|そちらの|日本語の?(?:が|を)?(?:わかる|分かる|できる|話せる|通じる))`;
const ROLE = R`(?:ご?担当(?:者|部署)?|たんとう(?:しゃ)?|部署|(?<![関連])係員?|オペレーター|スタッフ|社員|店員|職員|従業員|責任者|代表者?|管理者|上司|上長|店長|社長|支配人|マネージャー|オーナー|院長|窓口|上の(?:人|方|者)|上(?=を(?:出|呼)))`;
// 人 as a person to talk to, not a count or part of a word: not 三人, 大人, 本人, 人数, 人気, 人間 (handled by name).
const HITO = R`(?<![0-9一二三四五六七八九十百数何大本個法老恋友知美住犯名各万商職主夫婦他達的])(?:人|ひと(?!つ|り|こ|まず|とお|息|安心|ごと|き))(?![数気生口間工類形参手件柄前物材事目並違見知達々権質情員])`;
const NINGEN = R`人間(?!ドック|関係|性|的|味)`;
const HUMAN = R`(?:${QUAL}(?:人間|人|ひと|方|かた|者|スタッフ|担当者?)|${ROLE}(?:の(?:人|方|者|かた)|の[^、。をにとは]{1,6}(?:さん|様))?(?:さん|様)?|${NINGEN}(?:の(?:人|方|スタッフ|担当者?))?|誰か|だれか|どなたか|${HITO}|real person|human)`;
const LINK = R`(?:を|に|と|へ|は|って|ば|さ|、)?(?:直接|すぐに?|早く|今すぐ|ちょっと|お?電話を?|電話口?に)?`;
const HAND_OVER = R`(?:代わ|替わ|変わ|かわ)(?:って${REQ}|れ${E}|りなさい)`;
const WANTS_PERSON = any(
  // 1 a role or a human, asked for: 人間を出して / 責任者を出せ / 店長を出してください / 担当者をお願いします / 担当の方に代わってください /
  //   上司を呼んでください / オペレーターにつないで / 店長に回してください / 人と話したい / 責任者と話をさせて.
  //   Not the speaker passing something on (店長に話しておきます, 担当に回しておきます), not a past or ongoing fact
  //   (つないでもらった, 代わりました), not a decision (社長と話してから決めます).
  R`${HUMAN}${LINK}(?:${HAND_OVER}|出(?:して${REQ}|せ${E}|しなさい|さんかい?)|呼(?:んで(?:きて|来て)?${REQ}|べ${E}|び出して${REQ}|ばんかい?)|お(?:つなぎ|繋ぎ|呼び|代わり|替わり|回し)(?:いただ|頂|ください|下さい|願|でき)|(?:つな|繋)(?:いで${REQ}|げて${REQ}|げ${E})|(?:回|まわ)(?:して${REQ}|せ${E})|お?話し?(?:が|を)?(?:し?たい|させて|できますか)|話せますか|お願い|頼(?:む|みます|んます))`,
  // 2 refusing the AI: AIとは話したくない / 機械は嫌です / ロボットとは話しません / 機械じゃ話にならない / 自動音声は結構です /
  //   AIじゃなくて人に / あなたじゃ話にならない. Not 「AIですか」, not 「機械じゃないのね、よかった」.
  R`(?:AI|エーアイ|機械|ロボット|自動音声|ボット|コンピューター?|人工知能)(?:と|とは|とか|は|じゃ|では|なんか|なんて|相手(?:に|じゃ|では)?)[^。、]{0,6}?(?:話したくな|話しません|話さない|話せない|話にならな|話しても|嫌|いや(?!、)|イヤ|やだ|ダメ|だめ|無理|困る|困ります|結構|お断り|しゃあない|わからん|通じ(?:ない|ません|へん))`,
  R`(?:AI|エーアイ|機械|ロボット|自動音声)(?:じゃ|では)なく(?:て)?、?(?:人|ひと|誰か|担当|スタッフ)`,
  R`(?:あなた|あんた|おまえ|お前|君)(?:じゃ|では)(?:話にならな|だめ|ダメ|無理|わからな|埒|らち)`,
  // 3 is there a human / anyone else / anyone who understands: 人間のスタッフはいますか / 他の人いませんか / 誰か分かる人いないの.
  //   「担当の方はいらっしゃいますか」 only asks whether the role is in, and stays out (the existing tests say so).
  R`(?:${NINGEN}|${QUAL}(?:人|方|者)|誰か|だれか)[^。、]{0,8}?(?:い(?:ない|ません|ねえ|ますか|る\?|るの(?![でにがはを])|らっしゃ)|お(?:りません|られ|らん|らへん))`,
  // 4 the bare hand-over: 電話を代わってください / 代わって. 有人対応にして.
  R`(?:お?電話を?(?:代わ|替わ|かわ)|(?:^|[、。!?\s])(?:代わ|替わ))(?:って${REQ}|れ${E})`, R`有人(?:対応|窓口|オペレーター)?(?:に|で|を|へ)`,
  // 5 English
  R`\b(?:speak|talk)\s+(?:to|with)\s+(?:a |an |the |some)?(?:real |actual |live )?(?:person|human|someone|somebody|agent|representative|staff|manager|operator)\b`,
  R`\btransfer me\b`, R`\bput me through\b`, R`\b(?:real|live|actual) (?:person|human)\b`,
  R`\b(?:get|give) me (?:a |an |the |your )?(?:human|person|manager|operator|supervisor|representative)\b`, R`\b(?:human|representative|operator|agent),? please\b`);
// The role is the speaker: 「担当者に替わりまして、私が承ります」「社長に代わって私がお受けします」.
const SPEAKER_IS_ROLE = /(?:代わ|替わ|かわ|変わ)(?:って|りまして|り)、?(?:私|わたくし|わたし|僕|こちらで|当方)/;
export const asksForPerson = t => { const s = normal(t).trim(); return Boolean(found(WANTS_PERSON, s)) && !SPEAKER_IS_ROLE.test(s); };
const uncertain = /仮(?:予約|押さえ)?|未確定|承認待ち|多分|たぶん|かもしれ|確認してから|検討|maybe|perhaps|tentative|not sure|pending/i;
const negative = /キャンセル|取り消|無理|できません|難しい|だめ|ダメ|変更|cancel|cannot|can't|not available/i;
const question = /[?？]|ですか|でしょうか|ませんか/;

/** Parses an explicit timestamp for follow-up scheduling input. It is not used to judge what the callee agreed to. */
export function dateTime(t, now = Date.now()) {
  const iso = t.match(/\b(20\d\d)-(\d{2})-(\d{2})[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?/);
  if (iso) {
    const [_,year,month,day,hour,minute,second='00',zone='+09:00']=iso;
    const parts=[Number(month),Number(day),Number(hour),Number(minute),Number(second)];
    if(parts[0]<1||parts[0]>12||parts[1]<1||parts[1]>31||parts[2]>23||parts[3]>59||parts[4]>59)return null;
    if(zone!=='Z'&&(Number(zone.slice(1,3))>14||Number(zone.slice(4))>59))return null;
    const value=`${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`,epoch=Date.parse(value);
    const local=Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute),Number(second));
    const check=new Date(local);
    if(!Number.isFinite(epoch)||check.getUTCMonth()+1!==Number(month)||check.getUTCDate()!==Number(day)||epoch<=now||epoch-now>180*86400_000)return null;
    return value;
  }
  const d = iso ?? t.match(/(?:(20\d\d)年\s*)?(\d{1,2})月\s*(\d{1,2})日/);
  const h = iso ? [null, '', iso[4], iso[5]] : t.match(/(午前|午後)?\s*(\d{1,2})(?:時(?:(\d{1,2})分|(半))?|:(\d{2}))/);
  if (!d || !h) return null;
  const localYear = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Tokyo' }).format(now));
  const y = Number(d[1] ?? localYear), mo = Number(d[2]), day = Number(d[3]);
  let hour = iso ? Number(iso[4]) : Number(h[2]);
  const minute = iso ? Number(iso[5]) : h[4] ? 30 : Number(h[3] ?? h[5] ?? 0);
  if (!iso && h[1] === '午後' && hour < 12) hour += 12;
  if (!iso && h[1] === '午前' && hour === 12) hour = 0;
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const value = `${y}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+09:00`;
  const epoch = Date.parse(value);
  const check = new Date(epoch + 9 * 3600_000);
  if (check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== day || epoch <= now || epoch - now > 180 * 86400_000) return null;
  return value;
}
/** The agreed instant, or null when the engine has not settled date, time and the callee's commitment. */
function agreedMeeting(turns, mission, now) {
  const engine = new EvidenceEngine({ language: 'ja', now: new Date(now), confirmation: 'callee_acceptance' });
  turns.forEach((turn, index) => {
    const text = String(turn.text ?? '').normalize('NFKC').trim();
    if ((turn.source === 'caller' || turn.source === 'callee') && text) engine.ingest({ id: String(turn.id ?? `turn-${index}`), source: turn.source, text, t: index });
  });
  const result = evaluate(MEETING, engine, 'completed');
  if (!result.complete) return null;
  const value = `${result.fields.date}T${result.fields.time}:00+09:00`, epoch = Date.parse(value);
  // Evidence of a slot in the past, or implausibly far ahead, is not a meeting.
  if (!Number.isFinite(epoch) || epoch <= now || epoch - now > 180 * 86400_000) return null;
  if (mission.candidateSlots?.length && !mission.candidateSlots.some(s => Date.parse(s) === epoch)) return null;
  const commitment = [...result.evidence].reverse().find(e => e.field === 'confirmed' && e.source === 'callee' && e.verified);
  const proposal = result.evidence.find(e => e.field === 'date' && e.source === 'caller' && e.verified);
  return { value, turn: commitment?.utteranceId, quote: commitment?.transcript, proposal: proposal?.transcript };
}

export function evaluateSales(turns, mission, connected, now = Date.now()) {
  if (mission.kind === 'phone-request') {
    const doNotContact = turns.some(t=>t.source==='callee' && stopContact(t.text,{gone:false}));
    if (mission.phoneRequest?.success && !doNotContact) {
      const contract = definePhoneRequest(mission.phoneRequest);
      const engine = new EvidenceEngine({ language: 'ja', now: phoneReferenceDate(mission.approvedAt ?? mission.createdAt ?? now), confirmation: contract.confirmation });
      turns.forEach((t, i) => { if (!t.interrupted && ['caller','callee'].includes(t.source) && t.text?.trim()) engine.ingest({ id: t.id ?? `turn-${i}`, source: t.source, text: t.text, t: i }); });
      const result = evaluate(contract, engine, connected ? 'completed' : 'failed');
      return { status: result.complete ? 'COMPLETED' : 'INCOMPLETE', verified: result.fields, evidence: result.evidence,
        missing: result.missing, constraints: result.constraints, doNotContact: false, proofLevel: 'conversation',
        caveat: '指定条件を相手の発言で検証した結果です。通話の文字起こしに基づき、相手の予約システムや実施結果の確認とは別です。' };
    }
    return {status:doNotContact?'DECLINED':'INCOMPLETE',verified:{},evidence:[],doNotContact,
      caveat:mission.goal==='phone.reception'?'予約受付の記録です。成立した予約は予約台帳の記録が正です。':mission.direction==='inbound'?'着信の記録です。用件と折り返し先は会話内容を確認してください。':'通話の記録です。依頼が達成されたかは会話内容を確認してください。'};
  }
  const evidence = []; let material = false, acknowledged = false, declined = false, dnc = false;
  for (const [index, turn] of turns.entries()) {
    const t = String(turn.text ?? '').normalize('NFKC');
    if (turn.source !== 'callee') continue;
    const ref = { turn: turn.id ?? `turn-${index}`, source: 'callee', quote: t.slice(0, 600) };
    if (stopContact(t) || refusal.test(t)) { declined = true; dnc = true; material = false; evidence.push({ ...ref, field: 'do_not_contact', value: true }); }
    if (negative.test(t) || uncertain.test(t)) material = false;
    if (!dnc && !negative.test(t) && !uncertain.test(t) && !question.test(t)) {
      if (/(?:資料|パンフレット).{0,12}(?:送ってください|送付してください|送ってもらえます)|please send (?:me )?(?:the )?(?:material|brochure|deck)/i.test(t)) { material = true; evidence.push({ ...ref, field: 'material_send_allowed', value: true }); }
      if (/説明(?:を)?(?:ありがとう|理解しました)|説明.{0,8}わかりました|thank you for (?:the )?explanation/i.test(t)) { acknowledged = true; evidence.push({ ...ref, field: 'presentation_acknowledged', value: true }); }
    }
  }
  const meeting = dnc ? null : agreedMeeting(turns, mission, now);
  if (meeting) evidence.push({ turn: meeting.turn, source: 'callee', quote: String(meeting.quote ?? '').slice(0, 600), field: 'meeting_agreed_on_call', value: meeting.value, ...(meeting.proposal ? { confirmedProposal: meeting.proposal.slice(0, 600) } : {}) });
  const verified = { ...(material ? { material_send_allowed: true } : {}), ...(acknowledged ? { presentation_acknowledged: true } : {}), ...(meeting ? { meeting_agreed_on_call: meeting.value } : {}) };
  const required = mission.goal === 'meeting' ? 'meeting_agreed_on_call' : mission.goal === 'materials' ? 'material_send_allowed' : 'presentation_acknowledged';
  return { status: declined ? 'DECLINED' : connected && verified[required] ? 'COMPLETED' : 'INCOMPLETE', verified,
    missing: verified[required] ? [] : [required], evidence, doNotContact: dnc,
    proofLevel: 'conversation', caveat: '電話の文字起こしに基づく判定です。招待承諾や実施結果とは別です。' };
}
