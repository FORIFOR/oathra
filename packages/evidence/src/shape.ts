/**
 * Settling shapes: what a callee utterance must look like, as a whole, before it may settle anything.
 *
 * The older rules were "settle when an agreement word appears, unless a known negative appears". The list of
 * negatives can never be completed (「はい、その日は病院です」「いえ、大丈夫です」「大丈夫ですとは言えないんですよ」), so the
 * default is the other way round here: an utterance settles ONLY when every clause of it is one of the few
 * shapes below. Anything else (new information, another subject, a condition, a reason, a question, a
 * deferral, another venue such as mail or fax, a negation of any kind) settles nothing, and the call goes to a
 * person as "not settled". That miss is the accepted cost; a false "settled" is not.
 *
 * The engine applies these shapes ON TOP of the older refusals (hedge, contrast, refusal, hold, ...): a
 * reply settles only when both agree, so nothing that was refused before can settle now.
 *
 * Clause shapes (a clause is what `splitClauses` returns: split on 、。！？ and after ですが/ますが/けど):
 *
 *  filler    「あ」「えー」「では」                        carries nothing
 *  weak      「はい」「ええ」「うん」「そうです」            a yes; it answers the caller's LAST question, whatever that was
 *  strong    「承知しました」「かしこまりました」「了解です」「わかりました」「もちろんです」
 *                                                       takes on what the caller asked for
 *  courtesy  「ありがとうございます」「助かります」「楽しみにしております」
 *                                                       carries nothing (「失礼します」「お世話になっております」 are NOT courtesy:
 *                                                       one ends the call, the other is a greeting)
 *  echo      「10月5日の15時ですね」「50ケース、」          the terms read back with no predicate: a read-back, not a commitment
 *  restate   「10月5日の15時でお願いします」「50ケース、10月20日納品で承りました」「9月25日の15時にお待ちしております」
 *            「10月20日で問題ありません」「10月5日の15時で」  the terms plus a commit predicate
 *  commit    「大丈夫です」「それでお願いします」「問題ありません」「お待ちしております」「ご予約承りました」
 *                                                       a commit predicate with no object other than the terms
 *  rider     「資料もその時にお願いします」                a request for something AT the agreed time; carries nothing
 *  other     everything else: 「その日は病院です」「メールでのご連絡をお待ちしております」「空いていれば大丈夫です」
 *            「大丈夫ですとは言えないんですよ」「了解しておりません」「5日の50時で」(50時 is not a value)
 *
 * Negative-form agreements are an explicit allow-list: 問題ありません, 間違いございません, 相違ありません, 構いません,
 * 差し支えありません. Every other negation falls into "other".
 *
 * What is in this file:
 *  - `calleeShape`      the clause shapes above;
 *  - `shapeSettles`     which mixes of them settle, given what the caller last asked;
 *  - `callerAsk`        what the caller last asked: a bare yes answers the LAST question of the caller's turn;
 *  - `confirmationFits` reservation mode: a finished, positive confirmation of the booking itself;
 *  - `unsettles`        what a later callee utterance must look like to take a settlement back;
 *  - `restatedInFittingSentences`, `trailsOff`  two narrow helpers for utterances that go on, or stop short.
 */
import { parseDates, parsePartySize, parsePhoneNumbers, parsePrices, parseQuantities, parseSerials, parseTimes } from "./normalize.js";
import { CONFIRM_REQUEST_RE, CONFIRMATION_RE, CONTRAST_RE, extractClaims, HEDGE_RE, SERIAL_CUE_RE, splitClauses, UNAVAILABLE_RE } from "./extract.js";
import type { Language } from "./types.js";

export type ClauseKind = "filler" | "weak" | "strong" | "courtesy" | "rider" | "echo" | "restate" | "commit" | "other";

export type ShapedClause = {
  text: string;
  kind: ClauseKind;
  /** The clause names a date, time, party size, price or quantity. */
  hasValue: boolean;
  /** A finished confirmation about the booking itself (「ご予約承りました」「2名様でお取りしました」). */
  confirms: boolean;
  /** 「大丈夫です」 with nothing in front of it: also the usual way to say "no thank you". */
  bareOk: boolean;
  /** 「結構です」 alone: a yes only to a yes/no question, and only after 「はい」. */
  bareFine: boolean;
  /** 「お待ちしております」: the shop expects the guest. */
  awaits: boolean;
  /** 「…でお取りします」「取っときます」: the shop will book (a future booking predicate). */
  willBook: boolean;
  /** 「50ケースは大丈夫です」: は sets the named term apart, so the commit covers that term and no other. */
  topicOnly: boolean;
  /** A product name or code, or a bare name, standing among the terms: it must be one the caller used. */
  names: string[];
};

export type UtteranceShape = {
  clauses: ShapedClause[];
  /** Every clause is one of the settling shapes, and at least one is more than a filler. */
  fits: boolean;
  weak: boolean;
  strong: boolean;
  courtesy: boolean;
  rider: boolean;
  echo: boolean;
  restate: boolean;
  commit: boolean;
  /** The only commit is a bare 「大丈夫です」. */
  bareOkOnly: boolean;
  /** Some clause says the shop expects the guest (「お待ちしております」). */
  awaits: boolean;
  /** Some clause is a future booking predicate (「お取りします」). */
  willBook: boolean;
  /** 「19時半でしたらご用意できます」: an offer on a condition; never a yes to "shall I confirm?". */
  conditional: boolean;
  /** Some clause is a finished confirmation (「お取りしました」). */
  confirms: boolean;
  /** Some restatement is 「…は大丈夫です」: only the fields restated in this utterance may settle. */
  restatedOnly: boolean;
  /** Product names, codes and bare names among the terms (see `ShapedClause.names`). */
  names: string[];
};

/** What the caller's turn left on the table for a value-less reply to answer. See `callerAsk`. */
export type AskKind = "confirm" | "question" | "request" | "soft" | "none";

const JA_RE = /[぀-ヿ一-鿿]/;
const V = "\uE000";
const SERIAL = "\uE002";

// --- Japanese vocabulary ---------------------------------------------------------------------------------

const FILLER_JA = "(?:あっ?|ああ|えー+|ええと|えっと|えーと|では|それでは|じゃあ?|ほな|ほんなら|ほいじゃあ?|んだら)";
const FILLER_ONLY_JA = new RegExp(`^${FILLER_JA}$`);
const LEADING_FILLER_JA = new RegExp(`^${FILLER_JA}(?=[、,\\s])[、,\\s]*`);

const WEAK_JA = /^(?:(?:はい){1,3}ー?|はーい|ええ|うん|そうです|そうでございます|さようでございます|その通り(?:です|でございます)|おっしゃる通りです)$/;
const STRONG_JA =
  /^(?:承知(?:いた|致)?しました|かしこまりました|畏まりました|了解(?:です|しました|いたしました|致しました)?|(?:わ|分)かりました|承りました|もちろん(?:です)?|オッケー(?:です)?|おっけー(?:です)?|オーケー(?:です)?|OK(?:です)?|ええよ|ええで|ええですよ|いいですよ|いいっすよ|よろしいですよ|よかよ|よかですよ|かまへん(?:よ|で)|わがりました|わがった|わかった|んだ|んだな|よかばい|よかです|いいがね|ええがね|かまわん|かまんよ|かまいまへん(?:で)?|いいべ|いいっしょ|よろしいで|よろしおま|あいよ|はいよ|どうぞ|喜んで|よろこんで|(?:確かに|間違いなく)承りました)$/i;
const COURTESY_JA =
  /^(?:(?:どうも|毎度|いつも)?ありがとうございます|(?:毎度)?おおきに|まいど|毎度(?:どうも)?|(?:いつも)?お世話になって(?:おり|い)?ます|お電話代わりました|(?:ご注文|お電話|ご予約)ありがとうございます|ありがとうございました|こちらこそ|助かります|楽しみ(?:にして(?:おり|い)ます|すぎる|です|だ)?|恐れ入ります|お手数(?:を)?おかけ(?:いた)?します|お待たせ(?:いた)?しました|(?:どうぞ)?お気をつけて(?:お越し|いらして)ください(?:ませ)?|やった(?:ー|あ)*|わーい|テンション上がってきた|(?:もう)?今からお腹すいてきた|最高|(?:嬉|うれ)しい(?:です)?)$/;
/** 「当日お待ちしております」「ご来店をお待ちしております」: the shop expects the guest at the agreed time. */
/** 「弊社受付まで」: where to come. A closed list; any other place is new information. */
const PLACE = "(?:(?:弊社|当社|当店|こちら|うち|本社|事務所|受付|会議室|[0-9]{1,2}階)の?)+(?:まで|に|へ|で)";
/** Sentence endings of regional speech that change nothing: 「待っとるで」「届けるけえ」「取っといたけん」「待ってっから」. */
const DE = "(?:で|よ|わ|から|がら|けん|けえ)*";
const P_WAIT = `お待ち(?:いた)?して(?:おり|い)?ます|お待ちしとります|待っ(?:とる|とう|とります|てる|てます|ています)${DE}|待ってっから`;
const AWAIT_JA = new RegExp(`^(?:当日(?:は)?)?(?:${PLACE})?(?:ご来店を?|お越しを?|お電話を?)?(?:${P_WAIT})$`);
const AWAIT_ONLY_JA = AWAIT_JA;
const AWAIT_END_JA = new RegExp(`(?:${P_WAIT})$`);
/** 「取っといたで」「入れといたでね」「取っておいだがら」「押さえた」: a finished booking in regional speech. */
const P_DONE_DIALECT = `(?:取|と)っ(?:といた|どいだ|ておいた|ておいだ|た)${DE}|入れ(?:といた|どいだ|ておいた|ておいだ|た)${DE}|押さえ(?:といた|どいだ|た)${DE}|取れました(?:で)?|お取りできました|取ら(?:せ|し)て(?:もらい|いただき)ました`;
/** 「お取りします」「取っときます」「ご用意いたします」「入れとくね」: the shop WILL book. Alone it is an intention; see engine 1b''. */
const P_BOOK_WILL = `お取り(?:いた|致)?します|お取りしておきます|(?:取|と)っ(?:とき|てお)き?ます|(?:取|と)っとく${DE}|(?:取|と)ってお(?:く|ぐ)${DE}|ご?用意(?:いた|致)?します|入れ(?:とき|てお)き?ます|入れとく${DE}|押さえ(?:てお|と)きます|ご?予約(?:を)?(?:(?:いた|致)?します|お取りします|お受けします|入れます)`;
/** 「田中取っといたで」「5,500取っといたで」: a Kansai shop's finished booking, the name or the figure in front of it. */
const DIALECT_DONE_JA = new RegExp(`^(?:([\\u4e00-\\u9fff]{1,4})|(?:[1一]泊)?[\\d,]{1,7})?(?:で)?(?:${P_DONE_DIALECT})$`);

/** 「田中様、」: the name the booking is under, or the person addressed. */
const NAME = "[\\u4e00-\\u9fffァ-ヶー]{1,6}(?:様|さま|さん)";
const NAME_ONLY_JA = new RegExp(`^(${NAME})(?:ですね?|ね)?$`);
/** 「佐藤様で承りました」「佐藤様のお名前でお取りしました」: the booking under the caller's name. */
const NAME_HEAD = `(?:${NAME}(?:のお名前)?(?:で|の)?)`;
/**
 * A rider on the agreed time: 「資料もその時にお願いします」. It asks for something AT the meeting, so it takes the
 * meeting as settled; it is the only "other subject" a settling utterance may carry.
 */
const RIDER_JA = /^(?:資料|お?見積(?:も)?り?書?|カタログ|サンプル|名刺|詳細)(?:も|は)(?:その時|その際|当日)に(?:お願い(?:いた|致)?します|お持ちください)$/;

const DID = "(?:いた|致)?し";
/** Finished, positive forms: the thing is done. Only these may confirm a booking. */
const P_DONE = `(?:確かに|間違いなく)?(?:承り|お受け${DID}|お取り${DID}|確保${DID}|確定${DID}|完了${DID}|手配${DID}|ご?用意${DID}|お?押さえ(?:${DID})?|押さえておき|ご?予約(?:を)?${DID}|ご?予約(?:を)?入れ(?:てお|と)?き?|ご?予約(?:を)?させていただき|入れ(?:てお|と)?き?|予定に入れ)ました|確定です|完了です|予約完了(?:です)?|${P_DONE_DIALECT}`;
const P_ACK = `承知${DID}ました|了解${DID}ました|了解です|承知です|かしこまりました`;
const P_OK = "(?:大丈夫|だいじょうぶ)(?:です|でした|でございます|だよ|やで)?";
/** The allow-list of agreements that are negative in form. */
const P_NEG_OK = "(?:問題|差し支え|お?間違い|相違)(?:は)?(?:ありません|ございません|ないです)|(?:構|かま)いません";
const P_REQ = "(?:ぜひ|是非)?(?:よろしく)?お願い(?:いた|致)?します";
/** 「来てください」「お越しください」: the callee asks the caller to come at the agreed time. */
const P_COME = `(?:どうぞ)?(?:${PLACE})?(?:お越し|来て|いらして|おいで)ください(?:ませ)?|来てちょう|来てくれん|来んさい|来とくなはれ|来てもろて(?:大丈夫(?:やで|です)?)?|(?:オンラインで)?参加(?:いた|致)?します`;
/** 「9日に持っていきます」「届けるよ」: the supplier's own delivery on the terms. 出荷/発送 are not delivery: they name another day. */
const P_DELIVER = `お届けに(?:上|あ)がります|届けましょう|届けさ(?:し|せ)て(?:もらい|いただき)ます|(?:お届け|お持ち|納品|お納め|配達)(?:(?:いた|致)?します|できます)${DE}|(?:届け|納め)(?:ます|る|っ)${DE}|配達する${DE}|持って(?:い|行)?(?:きます|く|ぐ)${DE}`;
/** 「在庫ございます」「間に合います」「出せます」: the supplier can meet the terms. */
const P_CAN = "在庫(?:は|が|も)?(?:ございます|あります)(?:ので)?|間に合います|出せます|出せるよ?|いけます|いける(?:で|よ)|可能です|可能でございます|お受けできます|空いて(?:おり|い)?ます(?:ので)?|空いてる";
const P_GO = `お引き受け(?:いた|致)?します|予定に入れ(?:てお|と)?きます|任せて(?:ください)?|任(?:し|せ)とき(?:や)?|(?:お伺い${DID}|伺い|参り|行き)ます|絶対(?:に)?行く|行く行く|行く|空けとく|空けときます|空けてお(?:く|きます)`;
const P_WILL = `承ります|確定とさせてください|確定(?:と(?:させていただき|いたし)|いたし|し)ます|(?:お受け|お届け|納品|お納め|手配|ご?用意|お取り|お約束|お?押さえ|ご?予約(?:を)?(?:お取り|お受け)?)(?:いた|致)?します|押さえておきます|ご?予約(?:を)?させていただきます`;
const P_STATE = "ご?用意できます|お取りできます|空いて(?:おり|い)ます|合って(?:おり|い)ます|正しいです|合うて(?:る|ます)(?:で)?|合うとる(?:で)?|ええよ|ええで";
/** Agreement only after 「で」 (「それで結構です」「15時でいいですよ」); alone these are as often a refusal. */
const P_FINE = "(?:結構|けっこう)です|(?:いい|よい|良い|よろしい|よか|ええ|オッケー|おっけー|OK)(?:です)?";
const COMMITS = `${P_BOOK_WILL}|${P_DONE}|${P_ACK}|${P_OK}|${P_NEG_OK}|${P_REQ}|${P_WAIT}|${P_COME}|${P_DELIVER}|${P_CAN}|${P_GO}|${P_WILL}|${P_STATE}`;
/** 「大丈夫ですよ」. Not ね/よね: 「承りましたよね」 asks back. */
const TAIL = "(?:よ|わ|けん|けえ)?";
/** Endings dropped before a clause is read: 「…ますね」「…ますわ」「…けんね」「…でね」. Never よね or かね, which ask back. */
const SOFT_END_JA = /(?:(?<![よか])ね|わ|けんね|けえね|でね|ばい|(?<=から|がら|とる|てる|ます)な)$/;
/** 「ええわ」「いいわ」「もうええわ」 is "never mind"; the わ is not dropped from these. */
const NEVER_MIND_JA = /^(?:もう)?(?:ええ|いい|よか)(?:わ|です|よか)$/;
/** 「午前中にお届けします」: when in the agreed day; a detail of the delivery, not other terms. */
const PART_OF_DAY_DELIVER_JA = new RegExp(`^(?:午前中|午後|朝|夕方)(?:に|には)(?:${P_DELIVER})${TAIL}$`);
const WILL_BOOK_END_JA = new RegExp(`(?:${P_BOOK_WILL})${TAIL}$`);
/** 「ご注文通り」「仰せの通り」「その通りに」: as asked. Points at the terms; commits only beside a commit. */
const AS_ASKED_JA = /^(?:ご注文|ご依頼|ご希望|仰せ|おっしゃる)(?:の)?(?:通|とお|どお)り(?:に|で)?$|^その(?:通|とお)りに$/;
/** Where the shop seats the party; said with a finished booking it is part of it. */
const SEAT = "(?:個室|テーブル席|カウンター席|お座敷|お席)";

/** 「それで」「そちらで」: only with で. 「こちらは大丈夫です」 is "we are fine without it". */
const ANAPHOR_THING = "それ|そちら|そこ|こちら";
/** 「その日は」「その日程で」: the terms themselves, by name. */
const TERM_NOUN = "日|時間|日程|日時|内容|条件|数量|納期|お時間|お日にち|日にち";
const ANAPHOR_TERM = `その(?:${TERM_NOUN})(?:と(?:${TERM_NOUN}))?|ご(?:提案|希望)の(?:日程|内容|日時|お時間)`;
const ANAPHOR_PREFIX = `(?:(?:${ANAPHOR_THING})で(?:確定で)?|確定で|オンラインで|(?:${ANAPHOR_TERM})(?:で|は|に|なら|でしたら))`;
/** 「じゃあそれで。」「ではその時間に。」: the elliptical 「…でお願いします」. It needs the lead-in; a bare 「それで。」 is "and so?". */
const LEAD_IN_JA = /^(?:じゃあ?|それでは|では(?!なく|ない|あり)|ほな|ほんなら|ほいじゃあ?|んだら)/;
const ELLIPSIS_JA = new RegExp(`^(?:${ANAPHOR_THING}|${ANAPHOR_TERM})(?:で|に)$`);
/** 「その日時で。」「その日に。」 without the lead-in: points at the terms; it commits only beside an acknowledgement. */
const POINTER_JA = new RegExp(`^(?:${ANAPHOR_TERM})(?:で|に)$`);
const BOOKING = "(?:ご?予約|お?席|お部屋|ご?注文|お手配)";

const COMMIT_CLAUSE_JA = new RegExp(`^${ANAPHOR_PREFIX}?(?:${COMMITS})${TAIL}$`, "i");
const FINE_CLAUSE_JA = new RegExp(`^(?:${ANAPHOR_THING}|${ANAPHOR_TERM})で(?:${P_FINE})${TAIL}$`, "i");
const ANAPHOR_START_JA = new RegExp(`^${ANAPHOR_PREFIX}`);
const BOOKING_HEAD = `${NAME_HEAD}?(?:${ANAPHOR_PREFIX})?(?:${SEAT}(?:で|を))?(?:${BOOKING}(?:を|は|の|として)?)`;
const NAME_DONE_JA = new RegExp(`^${NAME_HEAD}(?:${P_DONE})${TAIL}$`, "i");
const BOOKING_CLAUSE_JA = new RegExp(`^${BOOKING_HEAD}(?:ご用意して)?(?:${P_BOOK_WILL}|${P_DONE}|${P_WILL})${TAIL}$`, "i");
const BOOKING_DONE_JA = new RegExp(`^${BOOKING_HEAD}(?:${P_DONE})${TAIL}$`, "i");
const SEAT_DONE_JA = new RegExp(`^${SEAT}(?:で|を)(?:${P_DONE})${TAIL}$`, "i");
const BARE_OK_JA = new RegExp(`^(?:${P_OK})${TAIL}$`);

/**
 * A word in front of a value that is not one of the connectives: the product (「コピー用紙20箱」「小麦粉を30キロ」).
 * It is allowed only when the caller used the same word (the engine checks `names`), so another product, or
 * 「やっぱり」「たぶん」「…じゃなくて」 in that place, makes the clause no shape at all.
 */
const WORD = "[\\u4e00-\\u9fff々ァ-ヶーぁ-んA-Za-z0-9-]{1,24}?";
const WORD_RE = new RegExp(`[\\u4e00-\\u9fff々ァ-ヶーぁ-んA-Za-z0-9-]+(?=${V})`, "g");
/** What may stand between and around the restated values. */
const CONN_WORDS =
  `の|に|で|は|を|と|も|から|より|なら(?:ば)?|でしたら|[、,\\s・]|${NAME}(?:のお名前)?|さん|オンライン|その内容|ご用意して|お電話(?:を)?|[1一](?:個|本|枚|箱|ケース|台|名様?|人)(?:あたり|当たり|につき)?|[ァ-ヶー]{2,20}(?=${V})|[\\d,]{1,7}(?=(?:取|と)っといた)|シリアル番号|製造番号|型番|管理番号|お?電話番号|番号|朝|午前中|(?:テーブル|カウンター)席|納品|納期|お届け|着|ご?予約|お?打ち?合わ?せ|商談|面談|ご?訪問|ご?来店|お席|お部屋|ご?注文|お日にち|お時間|日時|日程|数量|コース|様|\\d{1,3}分(?:間)?(?:ほど)?|[A-Za-z]{1,6}-?[0-9]{1,6}(?![0-9])|[月火水木金土日]曜日?|[（(][月火水木金土日][)）]|[1一]泊`;
const CONN = `${WORD}(?=(?:を|の|は)?${V})|${CONN_WORDS}`;
const ECHO_PRED = "ですね|ですな|でんな|かい|ね|な|だ|だな|だね|だべ|だべな|じゃ|じゃね|や|です|ですわ|でございますね?|ということですね|やね|やな";
const RESTATE_RE = new RegExp(`^(?:${CONN})*(?:${V}(?:${CONN})*)+(?:(${ECHO_PRED})|((?:${COMMITS})${TAIL})|(で(?:${P_FINE})${TAIL}))?$`, "i");
const TOPIC_COMMIT_RE = new RegExp(`は(?:${COMMITS})${TAIL}$`, "i");
const RESTATE_DONE_RE = new RegExp(`(?:${P_DONE})${TAIL}$`, "i");

// --- English vocabulary ----------------------------------------------------------------------------------

const WEAK_EN = /^(?:yes|yeah|yep|yup)$/;
const STRONG_EN = /^(?:sure(?: thing)?|of course|certainly|absolutely|okay|ok|sounds good|that works|perfect|great|no problem|correct|that'?s right|that is right|exactly|definitely|will do|all set)$/;
const COURTESY_EN = /^(?:thank you|thanks)(?: so much| very much)?$|^looking forward to it$/;
const COMMIT_EN =
  /^(?:(?:that )?works for (?:me|us)|i'?ll be there|i will be there|count me in|i'?m in|confirmed|let'?s do (?:that|it)|we can do that|we have that available|that'?s available|(?:we'?ll |we will )?see you then|(?:that|it)(?:'s| is) (?:fine|good|perfect|great|ok|okay|confirmed)(?: with me)?|you'?re (?:all set|booked)|you are (?:all set|booked)|(?:the|your) (?:table|reservation|booking|room) is (?:confirmed|booked|reserved|all set|set))$/;
const EN_BAG = new Set(
  "at on for the a an of it is it's that that's then so and table party people guests reservation booking your you you're are we we've have i i'll i've will be there see works me us fine good great perfect okay ok confirmed booked reserved set all down in pm am yes sure please this to with room night nights per got done under name".split(" "),
);
const EN_COMMIT_WORD = /\b(?:works|fine|good|perfect|confirmed|booked|reserved|set|there|down|great|sure|done)\b/;
const EN_QUESTION_START = /^(?:is|are|can|could|do|does|did|will|would|shall|should|may|was|were|have|has)\s+(?:you|we|i|it|that|they|he|she|there|the|this)\b|^(?:what|when|where|who|why|how|which)\b/;

// --- Clause classification -------------------------------------------------------------------------------

type Opts = { now: Date; language: Language };

/** Replace every date, time, party size, price and quantity in the clause with a placeholder. */
function maskValues(text: string, opts: Opts): { masked: string; count: number } {
  const spans: Array<{ index: number; length: number }> = [];
  const add = (ms: Array<{ index: number; span: string }>) => {
    for (const m of ms) {
      // parsers trim their spans; find the span at or after the reported index
      const at = text.indexOf(m.span, m.index);
      if (at >= 0) spans.push({ index: at, length: m.span.length });
    }
  };
  add(parseTimes(text, opts.language));
  add(parseDates(text, opts.now, opts.language));
  add(parsePartySize(text, opts.language));
  add(parsePrices(text));
  add(parseQuantities(text));
  add(parsePhoneNumbers(text));
  // breakfast and smoking are terms too (「朝食付き」「禁煙のお部屋」)
  for (const m of text.matchAll(/朝食(?:付き|付|込み|なし|抜き)|禁煙(?:席|ルーム|室)?|喫煙(?:席|ルーム|室|可)?/g)) spans.push({ index: m.index ?? 0, length: m[0].length });
  spans.sort((a, b) => a.index - b.index || b.length - a.length);
  let out = "";
  let pos = 0;
  let count = 0;
  for (const s of spans) {
    if (s.index < pos) {
      // overlapping parse (「2名様」 inside a longer span): extend the mask, never unmask
      if (s.index + s.length > pos) pos = s.index + s.length;
      continue;
    }
    out += text.slice(pos, s.index) + V;
    pos = s.index + s.length;
    count++;
  }
  return { masked: out + text.slice(pos), count };
}

const clause = (text: string, kind: ClauseKind, extra: Partial<ShapedClause> = {}): ShapedClause => ({ text, kind, hasValue: false, confirms: false, bareOk: false, bareFine: false, awaits: false, willBook: false, topicOnly: false, names: [], ...extra });
const other = (text: string, hasValue: boolean): ShapedClause => clause(text, "other", { hasValue });
const plain = (text: string, kind: ClauseKind): ShapedClause => clause(text, kind);

const NAME_RE = new RegExp(NAME, "g");
const bareName = (n: string) => n.replace(/(?:様|さま|さん)$/, "");
/** Names in a clause (「佐藤様」): a booking under a name the caller never gave is someone else's. */
const namesIn = (c: string): string[] => (c.match(NAME_RE) ?? []).map(bareName).filter((n) => !/^(?:お客|皆|みな|奥|旦那|お二人|お一人)$/.test(n));
const KNOWN_WORD_RE = new RegExp(`^(?:${CONN_WORDS})+$`);
/** The words in front of values that the caller must have used too. Particles and the connectives are not words. */
function wordsBeforeValues(c: string): string[] {
  const out: string[] = c.match(/[A-Za-z]{1,6}-?[0-9]{1,6}(?![0-9])/g) ?? [];
  if (/オンライン/.test(c)) out.push("オンライン");
  for (const m of c.matchAll(WORD_RE)) {
    if (KNOWN_WORD_RE.test(m[0])) continue;
    for (const piece of m[0].split(/[のにではをとも、]/)) {
      if (!piece || KNOWN_WORD_RE.test(piece)) continue;
      // a lone kana that is not a particle (「5日か6日」) is never the caller's product
      out.push(piece.length === 1 && /[ぁ-ん]/.test(piece) ? "\uE003" : piece);
    }
  }
  return out;
}

function classifyJa(raw: string, opts: Opts): ShapedClause {
  const { masked, count: n } = maskValues(raw, opts);
  const count = n + (raw.includes(SERIAL) ? 1 : 0);
  const hasValue = count > 0;
  // A question, or a sentence that trails off, is never a settling shape.
  if (/[?？]|…|‥|・・|\.\.|。。/.test(raw)) return other(raw, hasValue);
  let c = masked.split(SERIAL).join(V).replace(/^[\s「『（(]+/, "").replace(/[\s。．.!！、,;」』）)〜～]+$/, "");
  c = c.replace(LEADING_FILLER_JA, "");
  // 「じゃあ6日の2時にお願いします」「ほんならその日に来てちょう」: the lead-in runs straight into the clause.
  const lead = c.match(LEAD_IN_JA);
  if (lead && c.length > lead[0].length) c = c.slice(lead[0].length);
  if (!c) return plain(raw, "filler");
  if (/(?:ですか|ますか|でしょうか|ませんか|かな|っけ|かしら)$/.test(c)) return other(raw, hasValue);
  // 「いいですよー」「待ってますねー」: a drawn-out ending.
  if (NEVER_MIND_JA.test(c)) return other(raw, hasValue);
  if (!hasValue && STRONG_JA.test(c)) return plain(raw, "strong");
  if (!hasValue && WEAK_JA.test(c)) return plain(raw, "weak");
  c = c.replace(/(?<=[ぁ-ん])[ー〜～]+$/, "");
  if (NEVER_MIND_JA.test(c)) return other(raw, hasValue);
  if (!hasValue && STRONG_JA.test(c)) return plain(raw, "strong");
  c = c.replace(SOFT_END_JA, "");
  if (!c) return other(raw, hasValue);
  // Speech recognition often drops the comma: 「はい大丈夫です」「はい10月5日の15時でお願いします」.
  const yes = c.match(/^(?:はい|ええ)(?=[^、,\s])/);
  if (yes && !WEAK_JA.test(c) && !STRONG_JA.test(c) && !/^ええ(?:よ|で|と)/.test(c)) {
    const rest = classifyJa(raw.slice(raw.indexOf(yes[0]) + yes[0].length), opts);
    if (rest.kind === "other") return other(raw, hasValue);
    if (rest.kind === "filler") return plain(raw, "weak");
    return { ...rest, text: raw, bareOk: false };
  }
  if (!hasValue) {
    if (FILLER_ONLY_JA.test(c)) return plain(raw, "filler");
    const who = c.match(NAME_ONLY_JA);
    if (who) return clause(raw, "filler", { names: [bareName(who[1]!)] });
    if (AS_ASKED_JA.test(c)) return clause(raw, "echo");
    // 「いいよ」 is "sure" and also "never mind": like a bare 「大丈夫です」 it needs a yes or the terms beside it.
    if (/^いいよ$/.test(c)) return clause(raw, "commit", { bareFine: true });
    if (NAME_DONE_JA.test(c)) return clause(raw, "commit", { confirms: true, names: namesIn(c) });
    if (RIDER_JA.test(c)) return plain(raw, "rider");
    if (AWAIT_JA.test(c)) return clause(raw, "commit", { awaits: true });
    if (WEAK_JA.test(c)) return plain(raw, "weak");
    if (STRONG_JA.test(c)) return plain(raw, "strong");
    if (COURTESY_JA.test(c)) return plain(raw, "courtesy");
    if (BOOKING_CLAUSE_JA.test(c)) return clause(raw, "commit", { confirms: BOOKING_DONE_JA.test(c), willBook: !BOOKING_DONE_JA.test(c) && WILL_BOOK_END_JA.test(c), names: namesIn(c) });
    if (SEAT_DONE_JA.test(c)) return clause(raw, "commit", { confirms: true });
    const dialect = c.match(DIALECT_DONE_JA);
    if (dialect) return clause(raw, "commit", { confirms: true, names: dialect[1] ? [dialect[1]] : [] });
    if (c === "確定で") return clause(raw, "commit");
    if (PART_OF_DAY_DELIVER_JA.test(c)) return clause(raw, "commit");
    if (/^(?:結構|けっこう)ですよ?$/.test(c)) return clause(raw, "commit", { bareFine: true });
    if (lead && ELLIPSIS_JA.test(c)) return clause(raw, "commit");
    if (/オンライン/.test(c) && COMMIT_CLAUSE_JA.test(c)) return clause(raw, "commit", { names: ["オンライン"] });
    if (POINTER_JA.test(c)) return clause(raw, "echo");
    if (AWAIT_ONLY_JA.test(c)) return clause(raw, "commit", { awaits: true });
    if (COMMIT_CLAUSE_JA.test(c) || FINE_CLAUSE_JA.test(c)) {
      // Without the booking beside it, 「承りました」 only acknowledges; the other finished forms say it is done.
      const confirms = RESTATE_DONE_RE.test(c) && !/^(?:確かに|間違いなく)?承りました|^(?:確定|完了)です/.test(c) && !ANAPHOR_START_JA.test(c);
      return clause(raw, "commit", { confirms, bareOk: BARE_OK_JA.test(c), willBook: WILL_BOOK_END_JA.test(c) });
    }
    return other(raw, hasValue);
  }
  const m = c.match(RESTATE_RE);
  if (!m) return other(raw, hasValue);
  // 「10月5日の15時で。」: a trailing で is the elliptical 「…でお願いします」.
  const committed = Boolean(m[2] || m[3]) || (!m[1] && /で$/.test(c));
  return clause(raw, committed ? "restate" : "echo", { hasValue, confirms: Boolean(m[2]) && RESTATE_DONE_RE.test(c), awaits: Boolean(m[2]) && AWAIT_END_JA.test(c), willBook: Boolean(m[2]) && WILL_BOOK_END_JA.test(c), topicOnly: Boolean(m[2]) && TOPIC_COMMIT_RE.test(c), names: [...wordsBeforeValues(c), ...namesIn(c)] });
}

function classifyEn(raw: string, opts: Opts): ShapedClause {
  const { masked, count } = maskValues(raw, { ...opts, language: "en" });
  const hasValue = count > 0;
  if (/[?？]|…|\.\.\./.test(raw)) return other(raw, hasValue);
  const c = masked.toLowerCase().replace(/[’]/g, "'").replace(/^[\s"'(—–-]+/, "").replace(/[\s.!,;"')—–-]+$/, "").replace(/\s+/g, " ");
  if (!c) return plain(raw, "filler");
  if (EN_QUESTION_START.test(c)) return other(raw, hasValue);
  if (!hasValue) {
    if (/^(?:oh|ah|um|uh|well|so|alright|all right)$/.test(c)) return plain(raw, "filler");
    if (WEAK_EN.test(c)) return plain(raw, "weak");
    if (STRONG_EN.test(c)) return plain(raw, "strong");
    if (COURTESY_EN.test(c)) return plain(raw, "courtesy");
    if (COMMIT_EN.test(c)) return clause(raw, "commit", { confirms: /confirmed|booked|all set/.test(c) });
    return other(raw, hasValue);
  }
  const rest = c.replace(new RegExp(V, "g"), " ").replace(/\b(?:under|name is|name of|mr\.?|ms\.?|mrs\.?) [a-z]+\b/g, " ").replace(/\bfor (?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, " ");
  for (const w of rest.split(/[\s—–,-]+/)) {
    if (!w) continue;
    if (!EN_BAG.has(w) && !/^(?:th|st|nd|rd)$/.test(w)) return other(raw, hasValue);
  }
  const committed = EN_COMMIT_WORD.test(rest);
  return clause(raw, committed ? "restate" : "echo", { hasValue, confirms: /\b(?:confirmed|booked|reserved|all set)\b/.test(rest) });
}

/**
 * Speech recognition writes the closed vocabulary of agreement in kana and drops punctuation
 * (「はいだいじょうぶですおねがいします」「はい ごよやくうけたまわりました」). Only those words are put back into
 * their usual spelling, and clause breaks are restored only at the end of a polite verb; nothing else is
 * converted (no general kana-to-kanji).
 */
const KANA_VOCAB: Array<[RegExp, string]> = [
  [/うけたまわり/g, "承り"], [/しょうち(?=いたし|し)/g, "承知"], [/りょうかい/g, "了解"], [/だいじょうぶ/g, "大丈夫"],
  [/おねがい(?=いた|し)/g, "お願い"], [/ごよやく/g, "ご予約"], [/おまちして/g, "お待ちして"], [/おとり(?=し|いた|でき)/g, "お取り"],
  [/もんだい(?=あり|ござ|ない)/g, "問題"], [/さらいしゅう/g, "再来週"], [/らいしゅう/g, "来週"], [/こんしゅう/g, "今週"],
  [/げつようび?/g, "月曜日"], [/かようび?/g, "火曜日"], [/すいようび?/g, "水曜日"], [/もくようび?/g, "木曜日"], [/きんようび?/g, "金曜日"], [/どようび?/g, "土曜日"], [/にちようび?/g, "日曜日"],
  [/よやく/g, "予約"], [/(?<=[0-9])ご?めい(?:さま)?/g, "名様"], [/(?<=[0-9])けーす/g, "ケース"], [/(?<=[0-9])はこ/g, "箱"], [/おせわになって/g, "お世話になって"], [/そのじかん/g, "その時間"], [/そのにちじ/g, "その日時"], [/そのひ(?=で|に|は)/g, "その日"],
  [/かくほ(?=いた|し)/g, "確保"], [/いれ(?=とき|とい|てお)/g, "入れ"], [/おまちして/g, "お待ちして"], [/のうひん/g, "納品"], [/おとどけ/g, "お届け"], [/おせき/g, "お席"], [/(?<=[0-9名人])さま/g, "様"], [/ごご(?=[0-9])/g, "午後"], [/ごぜん(?=[0-9])/g, "午前"], [/けっこうです/g, "結構です"], [/かくてい(?=です|し|いた)/g, "確定"], [/おうけ(?=し|いた|でき)/g, "お受け"],
];
const KANA_DIGIT: Record<string, number> = { いち: 1, いっ: 1, に: 2, さん: 3, よん: 4, よ: 4, し: 4, ご: 5, ろく: 6, ろっ: 6, なな: 7, しち: 7, はち: 8, はっ: 8, きゅう: 9, く: 9 };
const KD = "いち|いっ|に|さん|よん|よ|し|ご|ろく|ろっ|なな|しち|はち|はっ|きゅう|く";
const KNUM = `(?:(?:(?:に|さん|よん|ご|ろく|なな|はち|きゅう)?(?:じゅう|じゅっ))(?:${KD})?|${KD})`;
const KANA_DAY: Record<string, number> = { ついたち: 1, ふつか: 2, みっか: 3, よっか: 4, いつか: 5, むいか: 6, なのか: 7, ようか: 8, ここのか: 9, とおか: 10, じゅうよっか: 14, はつか: 20, にじゅうよっか: 24 };
const KANA_UNIT: Record<string, string> = { けーす: "ケース", ケース: "ケース", はこ: "箱", ぱこ: "箱", ほん: "本", ぼん: "本", ぽん: "本", きろ: "キロ", キロ: "キロ", ふくろ: "袋" };
function kanaNumber(k: string): number {
  const m = k.match(new RegExp(`^(?:(に|さん|よん|ご|ろく|なな|はち|きゅう)?(?:じゅう|じゅっ))?(${KD})?$`))!;
  const tens = /じゅ/.test(k) ? (m[1] ? KANA_DIGIT[m[1]]! : 1) * 10 : 0;
  return tens + (m[2] ? KANA_DIGIT[m[2]]! : 0);
}
/**
 * Numbers spoken in kana next to a counter (「じゅうがつむいかのじゅうよじ」「よんめいさま」「じゅっけーす」): the months, days,
 * hours, party sizes and the common units only. A closed grammar, applied only to unpunctuated recogniser output.
 */
function kanaNumerals(text: string): string {
  let t = text.replace(new RegExp(`(${KNUM})がつ`, "g"), (_m, n) => `${kanaNumber(n)}月`);
  t = t.replace(new RegExp(`(?<=月)(${Object.keys(KANA_DAY).sort((a, b) => b.length - a.length).join("|")})`, "g"), (_m, d) => `${KANA_DAY[d]}日`);
  t = t.replace(new RegExp(`(${KNUM})にち`, "g"), (_m, n) => `${kanaNumber(n)}日`);
  t = t.replace(new RegExp(`(?<=^|[^ぁ-ん]|[のはにで])(${KNUM})じ(はん)?(?![ゅょゃ])`, "g"), (_m, n, half) => `${kanaNumber(n)}時${half ? "半" : ""}`);
  t = t.replace(new RegExp(`(${KNUM})(?:めい|にん)(さま)?`, "g"), (_m, n, sama) => `${kanaNumber(n)}名${sama ? "様" : ""}`);
  t = t.replace(new RegExp(`(${KNUM})(${Object.keys(KANA_UNIT).join("|")})`, "g"), (_m, n, u) => `${kanaNumber(n)}${KANA_UNIT[u]}`);
  return t;
}

export function normalizeSpeech(input: string): string {
  let text = input.normalize("NFKC");
  if (!JA_RE.test(text)) return text;
  // a pause written as a space
  // Pauses written as spaces: drop them, the breaks are restored below.
  if (!/[、。，,.!?！？…]/.test(text)) text = text.replace(/(?<=[\u3040-\u30ff\u4e00-\u9fff0-9])\s+(?=[\u3040-\u30ff\u4e00-\u9fff0-9])/g, "");
  else text = text.replace(/(?<=[\u3040-\u30ff\u4e00-\u9fff])\s+(?=[\u3040-\u30ff\u4e00-\u9fff0-9])/g, "、");
  for (const [re, to] of KANA_VOCAB) text = text.replace(re, to);
  if (!/[、。，,.!?！？…]/.test(text)) {
    text = kanaNumerals(text);
    text = text.replace(/^(はい|ええ|うん)(?=.)/, "$1、");
    text = text.replace(/(です|ます|ました|ません)((?:ね|よ)(?!ろしく))?(?=よろしく|わかりました|[^かがねよけのらっわなでしとて\s])/g, "$1$2、");
  }
  return text;
}

/** A serial is one value even when it is read out letter by letter (same rule as `extractClaims`). */
function maskSerials(input: string): string {
  let text = input;
  const cue = SERIAL_CUE_RE.test(text);
  for (const p of parseSerials(text).sort((a, b) => b.index - a.index)) {
    const groups = p.span.trim().split(/[、,\s-]+/).filter(Boolean);
    if (!cue && !(groups.length >= 4 && groups.every((g) => g.length <= 2))) continue;
    const at = text.indexOf(p.span, p.index);
    if (at >= 0) text = text.slice(0, at) + SERIAL + text.slice(at + p.span.length).replace(/^[、,\s]+/, "");
  }
  return text;
}

/** Classify every clause of a callee utterance. */
export function calleeShape(input: string, opts: Opts): UtteranceShape {
  // Half-width kana and full-width digits read the same as their plain forms; a serial read out letter by
  // letter (「R、Z、7、…」) is one value, not ten clauses.
  const text = maskSerials(normalizeSpeech(input));
  const ja = JA_RE.test(text);
  const clauses = splitClauses(text).map((cl) => (ja ? classifyJa(cl.text, opts) : classifyEn(cl.text, opts)));
  // 「お電話代わりました、佐藤です。」: the person now on the line gives a name.
  clauses.forEach((c, i) => {
    if (i > 0 && c.kind === "other" && /お電話代わりました/.test(clauses[i - 1]!.text) && /^[\u4e00-\u9fffァ-ヶー]{1,6}です[。\s]*$/.test(c.text.trim())) clauses[i] = clause(c.text, "courtesy");
  });
  const has = (k: ClauseKind) => clauses.some((c) => c.kind === k);
  const commits = clauses.filter((c) => c.kind === "commit");
  return {
    clauses,
    fits: clauses.length > 0 && !has("other") && clauses.some((c) => c.kind !== "filler" && c.kind !== "rider"),
    weak: has("weak"),
    strong: has("strong"),
    courtesy: has("courtesy"),
    rider: has("rider"),
    echo: has("echo"),
    restate: has("restate"),
    commit: commits.length > 0,
    bareOkOnly: commits.length > 0 && commits.every((c) => c.bareOk),
    restatedOnly: clauses.some((c) => c.topicOnly),
    awaits: clauses.some((c) => c.awaits),
    willBook: clauses.some((c) => c.willBook),
    conditional: clauses.some((c) => c.hasValue && /なら|でしたら/.test(c.text)),
    confirms: clauses.some((c) => c.confirms),
    names: clauses.flatMap((c) => c.names),
  };
}

/**
 * Does this utterance, as a whole, settle the terms on the table?
 *
 *  - terms restated with a commit predicate (「10月5日の15時でお願いします」): yes, whatever was asked;
 *  - terms read back and a strong acknowledgement or a commit (「10月5日の15時ですね。承知しました。」): yes;
 *  - terms only read back, even after 「はい」 (「はい、50ケース、10月20日ですね。」): no, that is a read-back;
 *  - no terms in the reply: it answers the caller's last turn, so it depends on what that turn asked:
 *      commit  (「はい、大丈夫です」「それでお願いします」)  needs the terms to have been put (question, request or soft);
 *      strong  (「承知しました」)                          needs a question or a finished request;
 *      weak    (「はい。」)                                needs a question, and nothing beside it but other yeses.
 *    A bare 「大丈夫です」 with no yes in front is also "no thank you", so it needs an acknowledgement beside it.
 */
export function shapeSettles(shape: UtteranceShape, ask: AskKind): boolean {
  if (!shape.fits) return false;
  // 「はい、結構です」 is a yes to 「…でよろしいでしょうか」 and a "no thank you" to anything else.
  // So is 「いいよ」. Beside another commit or the terms with one (「いいよ。13日の1時だな、待ってっから」) they are plain.
  const plainCommit = shape.restate || shape.strong || (shape.weak && shape.echo) || shape.clauses.some((c) => c.kind === "commit" && !c.bareFine && !c.bareOk);
  if (shape.clauses.some((c) => c.bareFine) && !(ask === "confirm" && shape.weak) && !plainCommit) return false;
  if (shape.restate) return true;
  if (shape.echo) return shape.strong || (shape.commit && !(shape.bareOkOnly && !shape.weak));
  if (shape.commit) {
    if (shape.bareOkOnly && !shape.weak && !shape.strong) return ask === "confirm";
    return ask !== "none";
  }
  if (shape.strong) return ask === "confirm" || ask === "question" || ask === "request";
  if (shape.weak) return (ask === "confirm" || ask === "question") && !shape.courtesy && !shape.rider;
  return false;
}

// --- The caller's last question --------------------------------------------------------------------------

const hasTerms = (text: string, opts: Opts): boolean =>
  extractClaims({ id: "ask", source: "caller", text, t: 0 }, opts).some((c) => c.field !== "confirmed");

/** A question that only asks "is that all right?" about what was just said. */
const GENERIC_Q_JA =
  /^(?:ご都合(?:は|のほうは)?|それで|そちらで|こちらで|その(?:内容|日程|日時|条件)で)?(?:いかがでしょうか|いかがですか|いかがでしょう|よろしいでしょうか|よろしいですか|大丈夫でしょうか|大丈夫ですか|可能でしょうか|可能ですか|お願いできますか|お願いできますでしょうか|お願いできませんか|お間違い(?:ない|ございません)(?:でしょうか|ですか)|どうですか|どうでしょうか?|どう|空いて(?:い|おり)ますか)[。？?！!\s]*$/;
/** 「その内容でよろしいでしょうか」「以上でお間違いないでしょうか」: a confirm request about terms said earlier. */
const ANAPHORIC_CONFIRM_JA =
  /^(?:はい[、。\s]*)?(?:では|それでは)?[、\s]*(?:それ|そちら|その内容|この内容|以上(?:の内容)?|こちら(?:の内容)?|上記(?:の内容)?|その(?:日程|日時|条件))で(?:ご?予約を?|ご?注文を?)?(?:確定(?:して(?:も)?|で)?|お願いして(?:も)?)?(?:よろしい|お間違い(?:ない|ございません)|大丈夫|問題(?:ない|ございません|ありません))(?:でしょうか|ですか)[。？?\s]*$/;
/** Questions about something other than the terms, even when the terms are in the same sentence. */
const OTHER_Q_JA = /変更|キャンセル|中止|延期|それとも|または|あるいは|どちら|いずれ|迷惑|難しい|厳しい|無理|悪い|だめ|ダメ|駄目|不都合|お忙しい|確認(?:して)?(?:いただ|もら|くださ)|伝え|聞いて|ご検討|相談|折り返|教えて|ご連絡|いらっしゃいますか|今(?:、|少し|少々)?(?:お時間|よろしい|大丈夫|お話)|お時間(?:は)?よろしい|聞こえ|お電話口|ご?担当|お名前|資料|メール|ファッ?クス|FAX|カタログ|録音|お送り|ご存じ|ご存知/i;
const QUESTION_END_JA = /[?？]\s*$|(?:か|かね|かな)[。]?\s*$|どう[!！?？。\s]*$|いかが(?:でしょう)?[。？?\s]*$/;
const STATEMENT_END_JA = /(?:ます|です|で|ください(?:ませ)?|ました)[。！!\s]*$/;
/** A yes/no question about the terms: its plain yes is 「大丈夫です」. 「いかがでしょうか」「どう？」 are open questions. */
const YES_NO_END_JA = /(?:よろしい|大丈夫|可能|お間違い(?:ない|ございません)|問題(?:ない|ございません|ありません))(?:でしょうか|ですか)[。？?\s]*$|(?:でき|いただけ|もらえ|くださ|願え)ます(?:でしょう)?か[。？?\s]*$|(?:でき|いただけ)ませんか[。？?\s]*$|いただけない(?:でしょう|です)か[。？?\s]*$/;
const COURTESY_SENTENCE_JA = /^(?:どうぞ)?(?:よろしく)?お願い(?:いた|致)?します[。！!\s]*$|^ありがとうございます[。！!\s]*$/;
const CONTRAST_SPLIT_JA = /が[、,]|(?:のです|んです|です|ます|でした|ました|たい)が|けれども?[、,]?|けど[、,]?/g;

const OTHER_Q_EN = /\b(?:is this|am i speaking|can you hear|do you have a (?:moment|minute)|is (?:this|now) a good time|(?:may|can|shall|should) i send|your name|who am i)\b/i;
const GENERIC_Q_EN = /^(?:so,?\s*)?(?:does|would|will) that work(?: for you)?\?*$|^is that (?:ok|okay|right|correct|fine|available|possible)(?: with you)?\?*$|^(?:can|could) (?:you|we) (?:do|confirm) that\?*$|^how (?:about|does) that(?: sound)?\?*$/i;

/**
 * What a reply WITHOUT restated terms can be answering. A bare yes answers the LAST question of the caller's
 * turn, so only that last sentence counts:
 *
 *  "question"  the last sentence asks about the terms themselves: they are in it (「10月5日の15時はいかがでしょうか」
 *              「…50ケース、10月20日納品でお願いできますか」), or it is a confirm request about them
 *              (「その内容でよろしいでしょうか」「…でご予約を確定してもよろしいでしょうか」, or 「ご都合はいかがでしょうか」 right
 *              after the sentence that named them);
 *  "request"   a finished request that names the terms (「10月5日の19時に2名で予約をお願いします。」);
 *  "soft"      the terms, trailing off (「10月5日の15時にお伺いしたいのですが。」): 「はい」 to this is only "go on";
 *  "none"      anything else, including a sentence that names the terms and then asks something different
 *              (「…15時にお伺いしたいのですが、今お時間よろしいですか」「…田中様でいらっしゃいますか」
 *              「…資料をお送りしてもよろしいですか」).
 */
export function callerAsk(text: string, opts: Opts): AskKind {
  const ja = JA_RE.test(text);
  const sentences = text.split(/(?<=[。！？!?]|\.(?=\s|$))/).map((s) => s.trim()).filter(Boolean);
  while (sentences.length > 1 && ja && COURTESY_SENTENCE_JA.test(sentences[sentences.length - 1]!)) sentences.pop();
  const last = sentences[sentences.length - 1];
  if (!last) return "none";
  const earlierTerms = sentences.slice(0, -1).some((s) => hasTerms(s, opts));
  if (!ja) {
    if (OTHER_Q_EN.test(last)) return "none";
    const q = /\?\s*$/.test(last);
    if (hasTerms(last, { ...opts, language: "en" })) return q ? "confirm" : "request";
    if (q && (GENERIC_Q_EN.test(last) || CONFIRM_REQUEST_RE.test(last))) return "confirm";
    return "none";
  }
  if (!hasTerms(last, opts)) {
    if (ANAPHORIC_CONFIRM_JA.test(last)) return "confirm";
    if (CONFIRM_REQUEST_RE.test(last) && QUESTION_END_JA.test(last) && !OTHER_Q_JA.test(last)) return "confirm";
    if (earlierTerms && GENERIC_Q_JA.test(last)) return YES_NO_END_JA.test(last) ? "confirm" : "question";
    return "none";
  }
  let tailAt = -1;
  for (const m of last.matchAll(CONTRAST_SPLIT_JA)) tailAt = (m.index ?? 0) + m[0].length;
  if (tailAt >= 0) {
    const tail = last.slice(tailAt).replace(/^[、\s]+/, "");
    if (!tail.replace(/[。！!\s]/g, "")) return "soft";
    if (!hasTerms(tail, opts)) return !GENERIC_Q_JA.test(tail) ? "none" : /空いて/.test(tail) ? "soft" : YES_NO_END_JA.test(tail) ? "confirm" : "question";
    return classifyAsk(tail, opts);
  }
  return classifyAsk(last, opts);
}

/** What may stand between the last term and the question: the occasion itself, never another subject. */
const ASK_FILL =
  "から|より|に|で|は|を|の|も|と|[、,\\s]|\\d{1,3}分(?:間)?(?:ほど)?|[月火水木金土日]曜日?|ご都合|席|まで|届けて|商談|お?打ち?合わ?せ|面談|ご?訪問|お伺い|お時間|ご説明|機会|オンライン|ご?予約|納品|納期|お届け|ご?注文|発注|お席|お部屋|ご?来店|コース|確定(?:して(?:も)?)?";
/** The questions a proposal ends in. Any other ending (「…は急でしょうか」「…駐車場をお借りしてもよろしいでしょうか」) is another question. */
const PROPOSAL_Q =
  "いかが(?:でしょうか?|ですか)?|(?:よろしい|大丈夫|可能)(?:でしょうか|ですか)|お間違い(?:ない|ございません)(?:でしょうか|ですか)|(?:お願い|お取り|ご?用意|お伺い|ご?対応)?(?:でき|いただけ|願え|もらえ)(?:ます(?:でしょう)?か|ませんか|ない(?:でしょう|です)か)|お伺いしても(?:よろしい|いい)(?:でしょうか|ですか)|どう(?:ですか|でしょうか?|かな)?|いける|行ける";
const PROPOSAL_REQ = "お願い(?:いた|致)?します|お願いしたいです|いただきたいです|お願いできればと思います";
const PROPOSAL_Q_RE = new RegExp(`^(?:${ASK_FILL})*(?:${PROPOSAL_Q})$`);
const PROPOSAL_REQ_RE = new RegExp(`^(?:${ASK_FILL})*(?:${PROPOSAL_REQ})$`);
const FREE_Q_RE = new RegExp(`^(?:${ASK_FILL})*空いて(?:い|おり|いらっしゃい)ます(?:でしょう)?か$`);
const OPEN_Q_END_JA = /(?:いかが(?:でしょうか?|ですか)?|どう(?:ですか|でしょうか?|かな)?|いける|行ける)$/;

function classifyAsk(segment: string, opts: Opts): AskKind {
  if (OTHER_Q_JA.test(segment)) return "none";
  // Only what follows the last term decides what is being asked.
  const { masked } = maskValues(maskSerials(segment.normalize("NFKC")), opts);
  const all = masked.split(SERIAL).join(V);
  const after = all.slice(all.lastIndexOf(V) + 1).replace(/[。？?！!\s]+$/, "");
  // 「その日の15時は空いていますか」 asks whether the slot is free, not for the commitment: 「はい」 says it is free.
  if (FREE_Q_RE.test(after)) return "soft";
  // A yes/no question about the terms: its plain yes is 「大丈夫です」. 「いかがでしょうか」「どう？」 are open questions.
  if (PROPOSAL_Q_RE.test(after)) return OPEN_Q_END_JA.test(after) ? "question" : "confirm";
  // A finished request that names the terms is the proposal itself (「…を300キロお願いしたいです。」): 「はい」 takes it.
  if (PROPOSAL_REQ_RE.test(after)) return "question";
  // A statement that names the terms (「7人で。」「19時半です。」): 「かしこまりました」 takes it on, 「はい」 only hears it.
  if (!QUESTION_END_JA.test(segment) && STATEMENT_END_JA.test(segment)) return "request";
  return "none";
}

// --- A shop's confirmation statement ---------------------------------------------------------------------

/**
 * Words that take a settlement back, or cast doubt on it. Deliberately broad: after a settlement, when in doubt,
 * un-settle. Policy remarks (「キャンセルの場合は前日までに」「ご変更の際はお電話ください」) are not retractions.
 */
export const DOUBT_RE =
  /やっぱり|やはり|さっきの|先ほどの|今のは|取り消|取消|なしで|無しで|なしに|無しに|だめ|ダメ|駄目|考えさせ|欠品|品切れ|売り切れ|しかな|しかあり|しかござ|ごめん|間違(?!い(?:は)?(?:ない|ありません|ございません|なければ|がなければ))|まちが|ダブルブッキング|訂正|変更(?!の(?:場合|際)|が(?:あ|ござい)|等|など|は.{0,14}(?:まで|ご連絡|お電話))|変えて|変わり|キャンセル(?!の(?:場合|際)|料|規定|ポリシー|待ち|は.{0,14}(?:まで|ご連絡|お電話)|され|なさ|する場合|される場合|し(?:て)?(?:いただ|頂|もら))|待って|撤回|白紙|見送|やめ|行けな|行けません|行かな|伺えな|伺えません|来なくて|来ないで|できなく|できて(?:おりません|いません|ない)|て(?:おり|い)ませんでした|都合が|予定が|忘れて|なかったことに|遠慮|保留|結構です|いや|あいにく|手違い|重複|誤り|誤って|改めて|また(?:ご)?連絡|別件|かどうか|次第|(?:行け|でき|空いて(?:い)?|取れ|間に合|よけ|良け)(?:たら|れば|えば)|かも|実は|考えさせ|反対|困|気が変|別の|変わっ|変更し|急用|無理|難し|厳し|断|確定(?!です|(?:いた)?しました)|聞かないと|確認しないと|じゃなく|ではなく|席が(?:な|ござ|あり)|空きが(?:な|ござ|あり)|在庫が|確認したら|閉め|休業|貸切|満席|満室|actually|sorry|mistake|cancel|double[- ]?book|can'?t|cannot|won'?t|unfortunately|on second thought|never mind|scratch that|hold on|wait/i;
/** The terms' own subject, pointed at without a value: 「その日は…」「その時間は…」. */
const SUBJECT_RE = /その日|その時間|その日程|その日時|その件|その話|that (?:day|time|date|slot)|the (?:meeting|appointment|reservation|booking|order)/i;

/** Leaving is not taking anything back. (It is not a settling shape either: 「はい、失礼します」 settles nothing.) */
const FAREWELL_RE =
  /^(?:では|それでは|じゃあ?)?(?:失礼(?:いた|致)?します|ごめんください(?:ませ)?|お疲れ様(?:です|でした)?|どうも|また(?:よろしく)?お願い(?:いた|致)?します|またね|じゃあね|バイバイ|bye|goodbye|good ?bye|see you|talk soon|take care|have a (?:good|nice|great) (?:day|one|evening))$/i;
const QUESTION_CLAUSE_RE = /[?？]|(?:ですか|ますか|でしょうか|ませんか|かな|っけ|かしら)[。．\s]*$/;

/**
 * A later callee utterance that un-settles what was settled before it. A clean repeat
 * (「10月5日の15時にお待ちしております」), plain courtesy and a goodbye never do. Otherwise:
 *
 *  - in every mode: a doubt word, the terms pointed at (「その日は…」), or a date/time/quantity in a
 *    clause that is not a clean restatement (「あ、ごめんなさい、5日は法事でした」「在庫が40しかないです」「さっきのはなしで」);
 *  - `strict` (appointment mode, where the settlement is a person's word and not a shop's record): any
 *    statement at all that is not one of the settling shapes (「悪いんだけど、気が変わった」「本当に来るんですか、困ります」).
 *    A plain question (「場所はどちらですか」) is left alone. The list of ways to back out cannot be completed
 *    either, so here too the default is the safe one.
 */
export function unsettles(text: string, shape: UtteranceShape, strict = false): boolean {
  if (shape.fits || shape.clauses.every((c) => c.kind === "filler")) return false;
  if (DOUBT_RE.test(text) || SUBJECT_RE.test(text)) return true;
  if (shape.clauses.some((c) => c.kind === "other" && c.hasValue)) return true;
  if (!strict) return false;
  if (HEDGE_RE.test(text)) return true;
  return shape.clauses.some((c) => c.kind === "other" && !QUESTION_CLAUSE_RE.test(c.text) && !FAREWELL_RE.test(c.text.replace(/^[\s「]+|[\s。．.!！、,」〜～]+$/g, "")));
}

/** 「ご予約承りました。確定のご連絡は明日いたします」: what follows puts the confirmation off. */
const LATER_RE = /後ほど|のちほど|追って|後日|明日|折り返/;
const SPOILER_AFTER_EN = /\b(?:sorry|unfortunately|actually|mistake|cancel|double[- ]?book|can'?t|cannot|but|however|wait)\b/i;
const NOT_FINISHED_EN = /\b(?:but|however|once|if|when|unless|until|waitlist|wait list|not|never|another|other|would|will be|to be)\b|n't|\?/i;

/**
 * Reservation mode: is there a finished, positive confirmation of THE booking in this utterance?
 *
 * The sentence that carries it must be made only of settling shapes and end in a finished form next to the
 * booking or its terms: 「ご予約承りました。」「10月3日19時半、2名様でお取りしました。」「かしこまりました、お席を確保しました。」
 * Never: 「ご予約を承っておりません」「ご予約承りましたらお電話します」「確定しましたらSMSを送ります」
 * 「ご予約確定には、カードの登録が要ります」「ご予約承りました、と言いたいのですが…」「別のお客様のご予約をお取りしました」
 * 「お取りしましたっけ」. Nothing after it in the same utterance may contrast, refuse or take it back.
 */
export function confirmationFits(text: string, opts: Opts): boolean {
  const sentences = text.split(/(?<=[。！？!?]|\.(?=\s|$))/).filter((s) => s.trim());
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]!;
    const after = sentences.slice(i + 1).join("");
    if (JA_RE.test(s)) {
      const shape = calleeShape(s, opts);
      if (!shape.fits || !shape.clauses.some((c) => c.confirms)) continue;
      if (CONTRAST_RE.test(after) || DOUBT_RE.test(after) || UNAVAILABLE_RE.test(after) || HEDGE_RE.test(after) || LATER_RE.test(after)) continue;
      return true;
    }
    if (!CONFIRMATION_RE.test(s) || NOT_FINISHED_EN.test(s) || SPOILER_AFTER_EN.test(after)) continue;
    return true;
  }
  return false;
}

/**
 * Fields restated inside a sentence that is, on its own, a settling shape with a commit, in an utterance that
 * goes on to say something else: 「はい、明日19時ですね。コースはお一人様8,800円となります。2名様でご予約承りました。」
 * The last sentence settles the party size it names; the utterance as a whole settles nothing else, and never
 * the fields it does not restate.
 */
export function restatedInFittingSentences(text: string, opts: Opts): Array<{ field: string; value: unknown }> {
  const out: Array<{ field: string; value: unknown }> = [];
  for (const s of text.split(/(?<=[。！？!?]|\.(?=\s|$))/)) {
    if (!s.trim()) continue;
    const shape = calleeShape(s, opts);
    if (!shape.fits || !(shape.restate || (shape.echo && shape.strong))) continue;
    for (const c of extractClaims({ id: "s", source: "callee", text: s, t: 0 }, opts)) {
      if (c.polarity === "positive" && c.field !== "confirmed" && !c.ambiguous) out.push({ field: c.field, value: c.value });
    }
  }
  return out;
}

/**
 * The utterance stops mid-sentence (「10月5日の15時で」「はい、その日は」「大丈夫ですが、」): what the same speaker says next
 * belongs to it, and the two are read as one.
 */
export function trailsOff(text: string): boolean {
  const t = text.trim();
  if (!t || /[。．！？!?]$/.test(t)) return false;
  return /(?:[、,…‥]|が|けど|けれど|て|で|ので|から|し|と|は|を|に|も|って|なら|たら|れば|の)$/.test(t);
}
