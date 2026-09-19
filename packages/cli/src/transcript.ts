import { z } from "zod";
import { CallContractSchema } from "@oathra/contract";
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
