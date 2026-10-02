/**
 * Words that mean the person on the line may need help now. Deterministic and deliberately broad: a false
 * alert costs a staff member one look at the transcript, a missed one costs far more. This never diagnoses
 * and never decides what happened; it only says "a human should read this line".
 */
export type DistressLevel = "emergency" | "concern";
export type DistressSignal = { level: DistressLevel; category: "life" | "self_harm" | "fall" | "pain" | "breathing" | "illness" | "intake" | "mood"; phrase: string };

const RULES: { level: DistressLevel; category: DistressSignal["category"]; re: RegExp }[] = [
  { level: "emergency", category: "life", re: /助けて|たすけて|救急車|きゅうきゅうしゃ|119番|意識が(?:ない|遠|もうろう)|血が(?:止まら|とまら|たくさん|出て)|動けな[いく]|起き上がれな[いく]|立てな[いく]|立ち上がれな[いく]|倒れ(?:た|て|ました|ています)|(?:手|足|体|身体|からだ|腰)が(?:動か|うごか)|起き(?:られ|れ)(?:な|へん|ん)|立って(?:い)?られな|動けん|動けへん|立てん|立てへん|起き上がれ(?:ん|へん)|help me|call an ambulance|can't (?:move|get up|breathe)|cannot (?:move|get up|breathe)/i },
  { level: "emergency", category: "self_harm", re: /死にたい|しにたい|死んでしまいたい|死のうと|消えてしまいたい|消えたい|生きていたくな[いく]|生きてい(?:て)?も(?:しかたな|仕方な|しょうがな|意味がな)|死んでも(?:ええ|いい|かまわ)|死んだ(?:ほう|方)が|もう(?:終わりにしたい|おしまいにしたい)|kill myself|want to die|end my life/i },
  { level: "emergency", category: "breathing", re: /息が(?:でき|出来|苦し|くるし|吸え|すえ|止ま|とま)|呼吸が(?:でき|苦し|おかし)|胸が(?:痛|いた|苦し|くるし|締め|しめ)|ろれつ|呂律|手足?が(?:しびれ|痺れ|動かな)|顔が(?:しびれ|ゆがん|歪ん)|chest pain|can't breathe/i },
  { level: "concern", category: "fall", re: /転ん(?:だ|で|じゃ)|ころん(?:だ|で|じゃ)|転び(?:ました|まして)|転倒|つまずい|すべって|滑って|落ち(?:た|て|ました)(?!着)|ぶつけ(?:た|て|ました)|\bfell\b|fallen/i },
  { level: "concern", category: "pain", re: /痛い|いたい(?!け)|痛く(?:て|なっ)|痛みが|痛むん?|苦しい|くるしい|しんどい|つらい|辛い|hurts?\b|in pain/i },
  { level: "concern", category: "illness", re: /熱が(?:ある|あり|出|で)|めまい|目まい|ふらふら|ふらつ|吐い(?:た|て)|吐き気|はきけ|もどし(?:た|て)|下痢|震えが|ふるえが|気分が悪|気持ちが?悪|具合が悪|調子が悪|体調が悪|feel(?:ing)? (?:sick|dizzy|faint)|fever/i },
  { level: "concern", category: "intake", re: /(?:何も|なにも|ずっと|全然|ぜんぜん|昨日から|きのうから|朝から)[^。、]{0,8}(?:食べて|たべて|飲んで|のんで)(?:い?な|い?ませ)|食欲が(?:ない|なく|ありま)|食べられな|飲み込めな|薬[をは]?[^。、]{0,6}(?:飲んで(?:い?な|い?ませ)|飲み忘れ|のみ忘れ|飲めな|切らし|なくなっ)|(?:haven't|have not) eaten|missed my (?:pills|medication)/i },
  { level: "concern", category: "mood", re: /眠れな[いく]|ねむれな[いく]|寝られな[いく]|寂しい|さびしい|さみしい|淋しい|不安で|怖い|こわい(?!ろ)|誰も(?:来|こ)な[いく]|ひとりぼっち|一人ぼっち|can't sleep|lonely|scared/i },
];
// 「痛いところはないです」「転んだりはしていません」: the word is there, the trouble is denied.
// 「痛いところはないです」「転んだりはしていません」: the word is there and the trouble itself is denied. Only a denial that
// attaches to the word counts; a later 「ない」 about something else (「転んでから足が動かない」「痛くてたまらない」) does not.
const DENIED = /^(?:り|たり)?(?:ところ|とこ|こと|の)?(?:とか)?(?:は|も)?(?:特に|別に|全然|ぜんぜん)?(?:して(?:い|お)?(?:な[いく]|ません|りません)|な[いく](?!と)|ありません|ございません|なかった)/;

/** Signals in one line the other person said. Feed only their words, never the agent's own questions. */
export function detectDistress(text: string): DistressSignal[] {
  const line = String(text ?? "").normalize("NFKC");
  const found: DistressSignal[] = [];
  for (const rule of RULES) {
    const match = rule.re.exec(line);
    if (!match) continue;
    // An emergency phrase stands even next to a "no": 「助けて…いや大丈夫」 is still read by a human.
    if (rule.level === "concern" && rule.category !== "intake" && DENIED.test(line.slice(match.index + match[0].length))) continue;
    found.push({ level: rule.level, category: rule.category, phrase: match[0] });
  }
  return found;
}

/** The most serious level in a set of signals, or null. */
export function distressLevel(signals: readonly DistressSignal[]): DistressLevel | null {
  return signals.some((s) => s.level === "emergency") ? "emergency" : signals.length ? "concern" : null;
}
