/**
 * The other end is a machine: a voicemail greeting or a carrier announcement. Deterministic, from what was heard.
 * Used so that "someone picked up" is not claimed for a recording; it never decides anything else about the call.
 */
const MACHINE = /留守番電話|留守電|お留守番サービス|留守番サービス|伝言メモ|合図の音|お呼びしましたが|お出になりません|電話に出られません|(?:ピー|ぴー)ッ?と鳴(?:り|っ)|メッセージを(?:どうぞ|お預かり|録音|お話し|残して)|(?:ピー|ぴー|発信音|合図)(?:っ)?(?:と|という|の)[^。]{0,12}(?:あと|後|鳴りましたら|鳴ったら)|ただいま(?:、)?(?:電話に出ることができません|留守にして|近くにおりません)|電話に出ることができません|電波の届かない場所|電源が入っていない|おかけになった電話(?:番号)?は|現在使われておりません|お客様のご都合により|番号をお確かめ|voice ?mail|leave (?:a|your) message|after the (?:tone|beep)|is not available|cannot take your call|has been disconnected|is no longer in service/i;

/** True when a line the other end said is a voicemail greeting or a network announcement. */
export function isMachineGreeting(text: string): boolean {
  return MACHINE.test(String(text ?? "").normalize("NFKC"));
}
