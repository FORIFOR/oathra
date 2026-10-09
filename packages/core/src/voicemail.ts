/**
 * The other end is a machine: a voicemail greeting, a menu, a queue or a carrier announcement. Deterministic, from
 * what was heard. Used so that "someone picked up" is not claimed for a recording; it never decides anything else
 * about the call.
 *
 * It reads the shape of the whole line, not single words: an instruction addressed to a caller (番号を押して,
 * 発信音のあとに, おかけ直しください), a self-introduction of a service (こちらは…です), a closed-hours notice. A person
 * who merely mentions voicemail or a message (「留守電聞きました」「メッセージを残しておいてもらえますか」), or who says
 * someone else cannot come to the phone, is a person.
 */
const SHAPES: RegExp[] = [
  // The tone, and what to do after it.
  /るすばんでんわ(?:に|です|さーびす)|はっしんおんの(?:あと|のち)|めっせーじを(?:どうぞ|おはなし)|おかけになったでんわ(?:ばんごう)?は|でんぱのとどかない(?:ばしょ|ところ)に|でんげんがはいっていない(?:ため|か)|げんざいつかわれておりません|ただいまでんわにでることができません|(?:メッセージ|伝言|用件)を?(?:入れ|残し)(?:といて|ておいて(?!もらえ|いただけ|くれ)|てや|てな|てください)|(?:ピー|ぴー)(?!マ)ッ?(?:っ)?(?:と|という|って|て|の|が)?[^。]{0,12}(?:鳴|あと|後|しましたら|したら)|(?:発信音|合図(?:の音)?|信号音)(?:の|が)?[^。]{0,12}(?:あと|後|鳴りましたら|鳴ったら|しましたら|したら)/,
  // Voicemail and message services naming themselves, and what a recorder says about messages.
  /(?:留守番電話|お?留守番サービス|伝言メモ|伝言サービス|ボイスメール)(?:サービス)?(?:センター)?(?:です|でございます|(?:に|へ)(?:接続|おつなぎ|お繋ぎ|転送|切り替))|ファクシミリ|ボタンを押してください|自動で?応答|迷惑電話(?:防止|対策)のため|接続(?:し|いたし)ます|転送されました|(?:メッセージ|伝言|ご用件|録音)[^。]{0,16}[0-9]+(?:秒|分)(?:以内|間)|録音(?:が|を)(?:終|完了|開始)|(?:電話を)?お切りください|(?:伝言|メッセージ|ご用件|伝言メモ)(?:を|は|が)?[^。、]{0,10}(?:お預かり(?:し|いたし|でき)|お残しください|残してください|お入れください|録音)|メッセージを(?:どうぞ|お話し)|ご用件を[^。]{0,12}(?:以内|お話しください)|(?:ファ(?:ッ)?クス|FAX)(?:の方は|を)[^。]{0,8}(?:送信|お送り)/i,
  // A menu, an automatic voice, a recording notice.
  /番号を(?:押して|入力して|プッシュして)(?!も|た|み)|[0-9#*](?:番)?を(?:押して|プッシュして)(?!も|た|み)|プッシュ(?:信号|回線|ボタン)|入力(?:が|を)[^。]{0,10}(?:確認でき|してください)|もう一度入力|ナビダイヤル|[0-9]+秒ごとに|(?:シャープ|米印|こめじるし)を?押|(?:こちらは|この(?:お)?電話は)[^。]{0,12}(?:自動音声|音声案内|自動応答|音声ガイダンス)|音声ガイダンスに(?:従って|したがって|従い)|自動音声(?:で|にて)(?:ご案内|お答え|対応|お伝え)|(?:この通話|この(?:お)?電話|通話内容)は[^。]{0,18}録音(?:させて|されます|しております|いたします)|迷惑電話(?:防止|対策)[^。]{0,14}(?:録音|作動|機能)|お名前をおっしゃってください/,
  // Queue and transfer.
  /(?:混み合って|込み合って|こみあって)おります|(?:電話に出るまで|音楽を(?:聴|聞)きながら)[^。]{0,12}お待ちください|待ち時間は|オペレーターが[^。]{0,8}(?:ふさが|対応中)|お待たせしております|[0-9]+番目に?(?:お待ち|おつなぎ)|(?:おつなぎ|お繋ぎ|転送)(?:し|いたし)(?:ます|ております)[^。]{0,8}。?[^。]{0,6}(?:そのまま|しばらく)お待ちください|ただいまお(?:繋|つな)ぎして(?:おります|います)|電話が[^。]{0,8}(?:かかりにくく|つながりにくく)なっております|ただいま(?:、)?(?:通話中|お話し中)です|(?:順番に|オペレーターに)おつなぎ|(?:おつなぎ|お繋ぎ|転送)(?:し|いたし)(?:ます|ております)[^]*(?:そのまま|このまま(?:で)?)お待ちください/,
  // Closed.
  /(?:本日|今日)の[^。]{0,8}(?:営業|受付|診療|業務)[^。]{0,4}は[^。]{0,6}(?:終了|終わり)|休業期間|通常(?:どおり|通り)営業(?:いたし|し)ます|(?:営業|診療|受付)時間外|(?:ただいま|現在|本日)[^。]{0,12}時間外|(?:営業|診療|受付)時間は[^。]{0,30}。?[^。]{0,12}おかけ直し|(?:本日|今日)は[^。]{0,4}(?:定休日|休業|休診)|(?:ただいま|現在|本日)(?:の時間)?は[^。]{0,10}(?:業務|営業|受付|診療|窓口)[^。]{0,8}(?:行っておりません|しておりません|いたしておりません|終了)|(?:休業|休診|定休日?)(?:と|に)?させていただ|誠に勝手ながら/,
  // Told to call again: 「おかけ直しください」 is an announcement's imperative; a person asks (かけ直してもらえますか).
  /(?:おかけ直し|お掛け直し|おかけなおし)(?:ください|くださいますよう|願います)|186をつけて/,
  // The carrier.
  /おかけになった(?:電話|番号|電話番号)(?:は|を|への)(?![^。]{0,6}(?:合って|あって|正し|間違|まちが|違))|おかけになった$|お出になりません|(?:おつなぎ|お繋ぎ)できません|お客様のご都合により[^。]{0,4}(?:通話|お繋ぎ|おつなぎ|ご利用)[^。]{0,6}(?:でき|いただけ)|現在使われておりません|(?:電波の届かない(?:場所|ところ)に(?:ある|おられる|いらっしゃる)|電源が入っていない(?:ため|か、|か。|か$))|(?:この(?:お)?電話|非通知[^。]{0,8}電話)は(?:お受け|おつなぎ)できません|こちらは(?:NTT|エヌ・?ティ・?ティ|ドコモ|ソフトバンク|au|KDDI|楽天モバイル|ワイモバイル)[^。]{0,10}です|番号をお確かめ(?:の上|になって)[^。]{0,8}おかけ/i,
];
// A home or office recorder: 「ただいま留守にしております」 with no one named as the subject. 「母は留守にしております」 is a person.
const ABSENT = /(?:^|[。、!?\s]|はい、?)(?:ただいま|現在|あいにく)(?:、)?(?:留守にして(?:おります|います)|近くにおりません|不在にしております[^。]{0,3}。?[^。]{0,4}(?:ピー|発信音|合図)|電話に出(?:ることができません|られません))|^(?:ただいま)?電話に出ることができません|(?:ため|ので|により|につき)、?(?:お)?電話に出(?:ることができません|られません)/;
// A person quoting an announcement: 「…って言えばいいの？」「…って今かけ直そうとしてた」
const QUOTED = /^[^。、]{0,10}(?:って(?:言|いう|いえ|今|流れ|聞こえ|出|なに|何)|と(?:言|いう(?!音|発信音|はっしんおん|合図)|いえば|流れ|聞こえ))|^[^。]{0,12}(?:って|と)[^。]*(?:言われ|言って|言う|流れ|聞こえ|アナウンス)/;
const ENGLISH = /you(?:'ve| have) reached|press (?:one|two|three|four|five|six|seven|eight|nine|zero)|cannot be completed|check the number|to hear these options|(?:we|i) can(?:'|no)t come to the phone|away from (?:my|the) phone|leave your name|enter your|pound key|wait time|thank you for your patience|after the beep|voice ?mail|leave (?:a|your)(?: brief)? message|after the (?:tone|beep)|at the tone|record your message|mailbox|(?:person|party|number|customer|subscriber)[a-z ]{0,30} is (?:not available|unavailable)|not in service|no longer in service|disconnected|(?:cannot|can't|unable to) take your call|forwarded to|automated|press (?:\d|the|pound|star|hash)|(?:currently|now) closed|office (?:is|hours)|business hours|please (?:hold|stay on the line|hang up|try)|your call is important|all (?:of )?our (?:agents|operators|representatives)|try (?:your call |again )later/i;

// --- The shape of an announcement, for the ones no list knows. ----------------------------------------------------
// A person in conversation: reporting what a recording said, explaining, asking, speaking for themselves.
const CONVERSATION = /言われ|って(?:言|聞こえ|流れ|ばっかり|ばかり)|と(?:流れ|聞こえ|言って|言われ)|「[^」]*」|でしょ[、。?？]|でしょ$|分かって|わかって|(?:なん|ん)ですけど|ですけど、|私が|わたしが|たまたま|つながら(?:ん|ない)(?:の|ん)|(?:ん|の)です[よね]?。?$|のよ。?$|かしら|[?？]\s*$|どちら様|どなた/;
// Speaking as or about a particular person, or to the caller as one person to another.
const PERSONAL = /承り|受付の[一-龠]|担当の[一-龠]|私|わたくし|わたし|うち|主人|母|父|息子|娘|[一-龠]{1,4}は(?:ただいま|本日|今|あいにく)|もしもし|あ、|[ねよ][。、]|[ねよ]$|です(?:が|けど)|ですか|ますか|でしょうか|少々お待ち/;
const OPENER = /^(?:おかけになった|お客様|こちらは|この(?:お)?電話は|ただいま|本日|現在|お電話ありがとう|おでんわありがとう)/;
const REGISTER = /おります|いたします|いただ(?:き|い)|ください|ございます|できません|かねます|されます|願います|申し上げ/;
// An instruction or a status about the call itself.
const CALLING = /伝言|メッセージ|お預かり|応答|お知らせ|放送|おかけ直し|かけ直し|お待ち|押して|発信音|営業時間|受付時間|診療時間|つなが|混み合|留守|不在|出られ|出ることが|通話|接続|番号|着信|圏外|電源|録音|休み|休業|休診|時間外|自動音声|案内|転送|じどうおんせい|じかんがい|おかけなおし|おまち|はっしんおん|えいぎょうじかん|るす/;
// 「たけしです。いま電話に出られないので、メッセージお願いします。」: a name, an absence and what to leave. The name alone is a person.
const GREETING = /^(?:はい、?|もしもし、?)?[^。、]{1,10}(?:です|やけど|ですたい|じゃけど)[。、][^。]*(?:出られ|留守|不在|おりません|おらん|出かけ)[^。]*。?[^。]*(?:メッセージ|伝言|ご用件|用件|用事|ピー|発信音)/;

/** True when a line the other end said is a voicemail greeting, a menu, a queue or a network announcement. */
export function isMachineGreeting(text: string): boolean {
  const line = String(text ?? "").normalize("NFKC").trim();
  if (!line) return false;
  // English announcements are judged only when the line is English; 「社長 is not available today」 is a person.
  if (/^[\x20-\x7e]+$/.test(line)) return ENGLISH.test(line);
  if (GREETING.test(line)) return true;
  // Someone telling what a recording said is a person, whatever words of the recording they repeat.
  if (CONVERSATION.test(line)) return false;
  if ((OPENER.test(line) || REGISTER.test(line)) && CALLING.test(line) && !PERSONAL.test(line)) return true;
  for (const re of [...SHAPES, ABSENT]) {
    // Every place the shape occurs is tried: one quoted phrase does not hide an instruction later in the line.
    for (const match of line.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
      if (!QUOTED.test(line.slice(match.index + match[0].length))) return true;
    }
  }
  return false;
}
