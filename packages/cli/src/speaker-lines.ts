/** Speaker attribution is a trust boundary. Unknown labelled turns must never inherit a speaker. */
export interface SpokenTurn { id: string; source: 'caller' | 'callee'; text: string; t: number }
const SPEAKER_LINE = /^[\s>*-]*\[?\s*([^\]:：]{1,24}?)\s*\]?\s*[:：]\s*(.+)$/;
const CALLEE_LABEL = /^(店|お店|店員|受付|相手|先方|お客様|callee|shop|them|they|store|staff|customer|clerk|hotel|restaurant)$/i;
const CALLER_LABEL = /^(ai|エージェント|エーアイ|自分|私|僕|こちら|発信|caller|agent|bot|assistant|me|us|you)$/i;


export function parseSpeakerTurns(text: string): SpokenTurn[] | undefined {
  const utterances: SpokenTurn[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = SPEAKER_LINE.exec(line);
    const label = match?.[1]?.trim() ?? "";
    const source = CALLEE_LABEL.test(label) ? "callee" : CALLER_LABEL.test(label) ? "caller" : undefined;
    if (!source) {
      // A colon may introduce an unsupported or malformed speaker label. Fail closed,
      // including long labels and empty turns. Label wrapped times explicitly or use JSON.
      if (!utterances.length || /[:：]/.test(line)) return undefined;
      utterances[utterances.length - 1]!.text += " " + line;
      continue;
    }
    utterances.push({ id: `line-${utterances.length + 1}`, source, text: match![2]!.trim(), t: utterances.length * 1000 });
  }
  return utterances.some(u => u.source === "callee") && utterances.length >= 2 ? utterances : undefined;
}
