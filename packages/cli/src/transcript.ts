import { z } from "zod";
import { CallContractSchema, defineCall } from "@oathra/contract";
import { EvidenceEngine, evaluate, type VerifiedResult } from "@oathra/evidence";

const referenceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "referenceDate must be a valid calendar date");

/** Input contains actual, final transcripts in conversation order. */
export const TranscriptCheckSchema = z.object({
  contract: CallContractSchema.refine((c) => Object.values(c.require).some(Boolean), "At least one required field is necessary"),
  referenceDate,
  connection: z.enum(["idle", "dialing", "active", "completed", "failed"]),
  utterances: z.array(z.object({
    id: z.string().min(1),
    source: z.enum(["caller", "callee"]),
    text: z.string().trim().min(1),
    t: z.number().finite().nonnegative(),
    language: z.enum(["ja", "en"]).optional(),
    audio: z.object({ startMs: z.number().nonnegative(), endMs: z.number().nonnegative() }).strict()
      .refine((a) => a.endMs >= a.startMs, "audio end must follow start").optional(),
    asr: z.object({ primary: z.number().min(0).max(1), secondary: z.number().min(0).max(1).optional() }).strict().optional(),
  }).strict()).min(1),
}).strict().superRefine((input, ctx) => {
  const ids = new Set<string>();
  let previous = -1;
  input.utterances.forEach((u, index) => {
    if (ids.has(u.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["utterances", index, "id"], message: "Duplicate utterance id" });
    if (u.t < previous) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["utterances", index, "t"], message: "Utterances must be in conversation order" });
    ids.add(u.id);
    previous = u.t;
  });
});

export type TranscriptCheckInput = z.input<typeof TranscriptCheckSchema>;

/**
 * What people actually paste: a call log with speaker labels, one turn per line.
 *
 *   店: 9月25日19時半、2名様でご予約承りました。
 *   AI: ありがとうございました。
 *
 * The JSON form stays the precise one — it carries the contract, the reference date and ASR confidence.
 * This is the way in for someone who just wants to know whether their own log really shows an agreement,
 * so it assumes the least: the only required field is `confirmed`, and every value the callee's words
 * support still shows up in the result. Returns undefined when the text is not a labelled log.
 */
const SPEAKER_LINE = /^[\s>*-]*\[?\s*([^\]:：]{1,24}?)\s*\]?\s*[:：]\s*(.+)$/;
const CALLEE_LABEL = /^(店|お店|店員|受付|相手|先方|お客様|callee|shop|them|they|store|staff|customer|clerk|hotel|restaurant)$/i;
const CALLER_LABEL = /^(ai|エージェント|エーアイ|自分|私|僕|こちら|発信|caller|agent|bot|assistant|me|us|you)$/i;

export function parseSpokenLines(text: string, today = new Date()): TranscriptCheckInput | undefined {
  const utterances: NonNullable<TranscriptCheckInput["utterances"]> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = SPEAKER_LINE.exec(line);
    const label = match?.[1]?.trim() ?? "";
    const source = CALLEE_LABEL.test(label) ? "callee" : CALLER_LABEL.test(label) ? "caller" : undefined;
    if (!source) {
      // A wrapped continuation belongs to the turn above; anything before the first label is not this format.
      if (!utterances.length) return undefined;
      utterances[utterances.length - 1]!.text += " " + line;
      continue;
    }
    utterances.push({ id: `line-${utterances.length + 1}`, source, text: match![2]!.trim(), t: utterances.length * 1000 });
  }
  if (!utterances.some((u) => u.source === "callee") || utterances.length < 2) return undefined;
  const language = /[ぁ-んァ-ン一-龯]/.test(text) ? "ja" : "en";
  return {
    contract: defineCall({ goal: "transcript.check", language, input: {}, require: { confirmed: true }, permissions: { ask: true } }) as TranscriptCheckInput["contract"],
    referenceDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
    connection: "completed",
    utterances,
  };
}

/** Pure local evaluation. Does not dial, use an LLM, upload or save the input. */
export function verifyTranscript(input: unknown): VerifiedResult {
  const check = TranscriptCheckSchema.parse(input);
  const [year, month, day] = check.referenceDate.split("-").map(Number) as [number, number, number];
  const engine = new EvidenceEngine({
    language: check.contract.language,
    now: new Date(year, month - 1, day, 12),
    ...(check.contract.confirmation ? { confirmation: check.contract.confirmation } : {}),
  });
  for (const u of check.utterances) engine.ingest({
    id: u.id, source: u.source, text: u.text, t: u.t,
    ...(u.language ? { language: u.language } : {}),
    ...(u.audio ? { audio: u.audio } : {}),
    ...(u.asr ? { asr: { primary: u.asr.primary, ...(u.asr.secondary !== undefined ? { secondary: u.asr.secondary } : {}) } } : {}),
  });
  return evaluate(check.contract, engine, check.connection);
}
