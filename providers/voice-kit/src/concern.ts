/**
 * A second reader for worrying speech. The deterministic word rules (`detectDistress` in @oathra/core) miss
 * dialect and unusual wording; the voice model hears the whole sentence. It reports what it heard with
 * `report_concern`; the service alerts staff when EITHER the rules or the model flag a line. A model's report
 * never diagnoses, never settles anything, and is shown as the AI's own account. It is not said to the other person.
 */
export const CONCERN_TOOL = {
  name: "report_concern",
  description: "Tell the staff, silently, that the other person just said something a human should check: illness, injury, a fall, pain, trouble breathing, confusion, not eating or drinking, a missed or wrong medicine, fear, loneliness, wanting to die or disappear, being hurt or pressured by someone, or danger at home. Call it as soon as you hear it, in any dialect or wording, even if you are not sure. Use it also when a recording or an automated voice answered instead of a person. Do not mention it to the other person and do not stop listening.",
  parameters: {
    type: "object",
    properties: {
      level: { type: "string", enum: ["emergency", "concern", "machine"], description: "emergency: may need help now. concern: a person should check. machine: a voicemail, a menu or an announcement answered." },
      heard: { type: "string", description: "What they said, as closely as you heard it, in their own words (one short line)." },
    },
    required: ["level", "heard"],
    additionalProperties: false,
  },
} as const;

export type ConcernEvent = { type: "safety.reported"; level: "emergency" | "concern" | "machine"; heard: string };

/** A report as the engines pass it on: a known level and a bounded line, or nothing. */
export function concernEvent(args: Record<string, unknown>): ConcernEvent | undefined {
  const level = String(args.level ?? "");
  const heard = String(args.heard ?? "").trim().slice(0, 300);
  if (!["emergency", "concern", "machine"].includes(level) || !heard) return undefined;
  return { type: "safety.reported", level: level as ConcernEvent["level"], heard };
}

/** The line that tells the model to use the tool. Part of every call's policy when the engine offers the tool. */
export function concernInstruction(language: string): string {
  return language === "ja"
    ? "相手の話に、体の不調・けが・転倒・痛み・息苦しさ・混乱・食事や水分がとれていない・薬の飲み忘れや飲み間違い・強い不安やさびしさ・死にたい、いなくなりたい気持ち・だれかに傷つけられている、お金を求められている・家の中の危険、のどれかが少しでも感じられたら、方言や遠回しな言い方でも、すぐに report_concern で記録してください（迷ったら記録する）。留守番電話や自動音声が出たときは level を machine にしてください。記録したことは相手に言わず、そのまま話を聞き続けてください。記録は職員に伝わりますが、あなたが助けを呼んだことにはなりません。"
    : "Whenever the other person's words suggest illness, injury, a fall, pain, trouble breathing, confusion, not eating or drinking, a missed or wrong medicine, strong fear or loneliness, wanting to die or disappear, being hurt or pressured by someone, or danger at home, in any wording, record it at once with report_concern (when unsure, record it). When a voicemail or an automated voice answers, use level machine. Do not tell them you recorded it and keep listening. The record reaches the staff; it does not mean help was summoned.";
}
