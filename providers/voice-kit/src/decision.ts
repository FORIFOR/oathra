import type { CallContract } from "@oathra/contract";

/**
 * 任せる範囲 (the app's 電話を頼む): what the requester let the AI decide on the spot, written into the request as a
 * 【任せる範囲】 block. The AI records each such decision with `record_decision`; the report lists them as the AI's own
 * account. They never settle a field: only the other party's words do (the evidence engine).
 */
export const SCOPE_HEAD = "【任せる範囲】";
const OK_HEAD = "その場で決めてよい：";
const HOLD_HEAD = "決めずに持ち帰る（相手に「確認して折り返します」と伝える）：";

export function delegatedScope(contract: CallContract): { ok: string[]; hold: string[] } | null {
  const text = typeof contract.input?.request === "string" ? contract.input.request : "";
  const at = text.indexOf(SCOPE_HEAD);
  if (at < 0) return null;
  const lines = text.slice(at).split("\n");
  const pick = (head: string) => (lines.find((l) => l.startsWith(head))?.slice(head.length) ?? "").split("、").map((s) => s.trim()).filter(Boolean);
  return { ok: pick(OK_HEAD), hold: pick(HOLD_HEAD) };
}

/** Whether this call gets the tool: an outbound request with something the AI may decide. */
export const recordsDecisions = (contract: CallContract): boolean => contract.goal === "phone.message" && (delegatedScope(contract)?.ok.length ?? 0) > 0;

export const DECISION_TOOL = {
  name: "record_decision",
  description: "Record a decision you just made on the requester's behalf, within what they let you decide (その場で決めてよい). Call it right after you accept or choose something on your own, e.g. a different time within the allowed range. Not for anything outside that list: bring those back undecided.",
  parameters: {
    type: "object",
    properties: {
      decision: { type: "string", description: "What you decided, in one short Japanese sentence, e.g. 「19時が満席だったので、20時半で予約をお願いしました」." },
      within: { type: "string", description: "The item of その場で決めてよい this relied on, copied as written." },
    },
    required: ["decision"],
    additionalProperties: false,
  },
} as const;

export type DecisionEvent = { type: "decision.made"; decision: string; within?: string };

/** The instruction line for calls that record decisions (Japanese, like the scope it refers to). */
export function decisionInstruction(contract: CallContract): string | undefined {
  if (!recordsDecisions(contract)) return undefined;
  return "- 任せる範囲の「その場で決めてよい」に入ることを相手と決めたら、その直後に record_decision で、何を決めたかを短く記録する（どの項目に基づくかも within に）。記録したことは相手に言わない。「決めずに持ち帰る」項目や範囲の外のことは決めずに、「確認して折り返します」と伝える。";
}

/** A decision as the engines report it: trimmed and bounded, or nothing. */
export function decisionEvent(args: Record<string, unknown>): DecisionEvent | undefined {
  const decision = String(args.decision ?? "").trim().slice(0, 200);
  if (!decision) return undefined;
  const within = String(args.within ?? "").trim().slice(0, 100);
  return { type: "decision.made", decision, ...(within ? { within } : {}) };
}
