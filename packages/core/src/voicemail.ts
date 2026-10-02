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
  /るすばんでんわ(?:に|です|さーびす)|はっしんおんの(?:あと|のち)|めっせーじを(?:どうぞ|おはなし)|(?:ピー|ぴー)ッ?(?:っ)?(?:と|という)[^。]{0,12}(?:鳴|あと|後|しましたら|したら)|(?:発信音|合図(?:の音)?|信号音)(?:の|が)?[^。]{0,12}(?:あと|後|鳴りましたら|鳴ったら|しましたら|したら)/,
  // Voicemail and message services naming themselves, and what a recorder says about messages.
  /(?:留守番電話|お?留守番サービス|伝言メモ|伝言サービス|ボイスメール)(?:サービス)?(?:センター)?(?:です|でございます|(?:に|へ)(?:接続|おつなぎ|お繋ぎ|転送))|接続(?:し|いたし)ます|転送されました|(?:メッセージ|伝言|ご用件|録音)[^。]{0,16}[0-9]+(?:秒|分)(?:以内|間)|録音(?:が|を)(?:終|完了|開始)|(?:電話を)?お切りください|(?:伝言|メッセージ|ご用件|伝言メモ)(?:を|は|が)?[^。、]{0,10}(?:お預かり(?:し|いたし|でき)|お残しください|残してください|お入れください|録音)|メッセージを(?:どうぞ|お話し)|ご用件を[^。]{0,12}(?:以内|お話しください)|(?:ファ(?:ッ)?クス|FAX)(?:の方は|を)[^。]{0,8}(?:送信|お送り)/i,
  // A menu, an automatic voice, a recording notice.
  /番号を(?:押して|入力して|プッシュして)(?!も|た|み)|[0-9#*](?:番)?を(?:押して|プッシュして)(?!も|た|み)|プッシュ(?:信号|回線|ボタン)|入力(?:が|を)[^。]{0,10}(?:確認でき|してください)|もう一度入力|ナビダイヤル|[0-9]+秒ごとに|(?:シャープ|米印|こめじるし)を?押|(?:こちらは|この(?:お)?電話は)[^。]{0,12}(?:自動音声|音声案内|自動応答|音声ガイダンス)|音声ガイダンスに(?:従って|したがって|従い)|自動音声(?:で|にて)(?:ご案内|お答え|対応|お伝え)|(?:この通話|この(?:お)?電話|通話内容)は[^。]{0,18}録音(?:させて|されます|しております|いたします)|迷惑電話(?:防止|対策)[^。]{0,14}(?:録音|作動|機能)|お名前をおっしゃってください/,
  // Queue and transfer.
  /(?:混み合って|込み合って|こみあって)おります|オペレーターが[^。]{0,8}(?:ふさが|対応中)|お待たせしております|[0-9]+番目に?(?:お待ち|おつなぎ)|(?:おつなぎ|お繋ぎ|転送)(?:し|いたし)(?:ます|ております)[^。]{0,8}。?[^。]{0,6}(?:そのまま|しばらく)お待ちください|ただいまお(?:繋|つな)ぎして(?:おります|います)|電話が[^。]{0,8}(?:かかりにくく|つながりにくく)なっております|ただいま(?:、)?(?:通話中|お話し中)です|(?:順番に|オペレーターに)おつなぎ|(?:おつなぎ|お繋ぎ|転送)(?:し|いたし)(?:ます|ております)[^]*(?:そのまま|このまま(?:で)?)お待ちください/,
  // Closed.
  /(?:本日|今日)の(?:営業|受付|診療|業務)は[^。]{0,6}(?:終了|終わり)|(?:営業|診療|受付)時間外|(?:ただいま|現在|本日)[^。]{0,12}時間外|(?:営業|診療|受付)時間は[^。]{0,30}。?[^。]{0,12}おかけ直し|(?:本日|今日)は[^。]{0,4}(?:定休日|休業|休診)|(?:休業|休診|定休日?)(?:と|に)?させていただ|誠に勝手ながら/,
  // Told to call again: 「おかけ直しください」 is an announcement's imperative; a person asks (かけ直してもらえますか).
  /(?:おかけ直し|お掛け直し|おかけなおし)(?:ください|くださいますよう|願います)|186をつけて/,
  // The carrier.
  /おかけになった(?:電話|番号|電話番号)(?:は|を|への)(?![^。]{0,6}(?:合って|あって|正し|間違|まちが|違))|おかけになった$|お出になりません|(?:おつなぎ|お繋ぎ)できません|現在使われておりません|(?:電波の届かない(?:場所|ところ)に(?:ある|おられる|いらっしゃる)|電源が入っていない(?:ため|か、|か。|か$))|(?:この(?:お)?電話|非通知[^。]{0,8}電話)は(?:お受け|おつなぎ)できません|こちらは(?:NTT|エヌ・?ティ・?ティ|ドコモ|ソフトバンク|au|KDDI|楽天モバイル|ワイモバイル)[^。]{0,10}です|番号をお確かめ(?:の上|になって)[^。]{0,8}おかけ/i,
];
// A home or office recorder: 「ただいま留守にしております」 with no one named as the subject. 「母は留守にしております」 is a person.
const ABSENT = /(?:^|[。、!?\s]|はい、?)(?:ただいま|現在|あいにく)(?:、)?(?:留守にして(?:おります|います)|近くにおりません|不在にしております[^。]{0,3}。?[^。]{0,4}(?:ピー|発信音|合図)|電話に出(?:ることができません|られません))|^(?:ただいま)?電話に出ることができません/;
// A person quoting an announcement: 「…って言えばいいの？」「…って今かけ直そうとしてた」
const QUOTED = /^[^。、]{0,10}(?:って(?:言|いう|いえ|今|流れ|聞こえ|出|なに|何)|と(?:言|いう|いえば|流れ|聞こえ))|^[^。]{0,12}(?:って|と)[^。]*(?:言われ|言って|言う|流れ|聞こえ|アナウンス)/;
const ENGLISH = /voice ?mail|leave (?:a|your)(?: brief)? message|after the (?:tone|beep)|at the tone|record your message|mailbox|(?:person|party|number|customer|subscriber)[a-z ]{0,30} is (?:not available|unavailable)|not in service|no longer in service|disconnected|(?:cannot|can't|unable to) take your call|forwarded to|automated|press (?:\d|the|pound|star|hash)|(?:currently|now) closed|office (?:is|hours)|business hours|please (?:hold|stay on the line|hang up|try)|your call is important|all (?:of )?our (?:agents|operators|representatives)|try (?:your call |again )later/i;

/** True when a line the other end said is a voicemail greeting, a menu, a queue or a network announcement. */
export function isMachineGreeting(text: string): boolean {
  const line = String(text ?? "").normalize("NFKC").trim();
  if (!line) return false;
  // English announcements are judged only when the line is English; 「社長 is not available today」 is a person.
  if (/^[\x20-\x7e]+$/.test(line)) return ENGLISH.test(line);
  for (const re of [...SHAPES, ABSENT]) {
    const match = re.exec(line);
    if (match && !QUOTED.test(line.slice(match.index + match[0].length))) return true;
  }
  return false;
}
