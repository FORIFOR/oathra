/**
 * @oathra/contract
 *
 * The top-level object in Oathra is not an "Agent" but a CallContract:
 * a declarative statement of what a call must achieve, what it may do,
 * and what counts as done. It is deliberately separate from any LLM prompt.
 */
import { z } from "zod";
import { parsePhoneRequest, type PhoneRequest } from "./phone-input.js";
export { ContactInputSchema, ContactUpdateSchema, ContactRecordSchema, type ContactInput, type ContactRecord } from "./contact.js";

export {
  PhoneInputError,
  normalizePhoneNumber,
  extractPhoneNumber,
  PhoneRequestSchema,
  PHONE_VOICES,
  DEFAULT_PHONE_VOICE,
  preparePhoneRequest,
  parsePhoneRequest,
  type PhoneInputErrorCode,
  type PhoneRequest,
  type PhoneRequestInput,
} from "./phone-input.js";

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

/** A rule applied to a single verified field. Values are compared as
 *  numbers when both sides are numeric, otherwise as strings (ISO dates and
 *  zero-padded HH:MM times compare correctly as strings). */
export const ConstraintRuleSchema = z
  .object({
    eq: z.union([z.string(), z.number(), z.boolean()]).optional(),
    ne: z.union([z.string(), z.number(), z.boolean()]).optional(),
    lte: z.union([z.string(), z.number()]).optional(),
    gte: z.union([z.string(), z.number()]).optional(),
    lt: z.union([z.string(), z.number()]).optional(),
    gt: z.union([z.string(), z.number()]).optional(),
    oneOf: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .strict();
export type ConstraintRule = z.infer<typeof ConstraintRuleSchema>;

export const ConstraintsSchema = z.record(z.string(), ConstraintRuleSchema);
export type Constraints = z.infer<typeof ConstraintsSchema>;

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export const ActionSchema = z.enum([
  "ask",
  "reserve",
  "cancel",
  "modify",
  "payment",
  "negotiate",
  "share_address",
  "share_phone",
  "share_name",
]);
export type Action = z.infer<typeof ActionSchema>;

/** Map of action -> allowed. Unknown actions default to false (deny). */
export const PermissionsSchema = z.record(ActionSchema, z.boolean());
export type Permissions = z.infer<typeof PermissionsSchema>;

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

export const TargetSchema = z
  .object({
    /** E.164 phone number for real calls. */
    phone: z.string().optional(),
    /** Human-readable name of the callee (shown in UI). */
    name: z.string().optional(),
    /** Scenario id when running against the simulator. */
    scenario: z.string().optional(),
  })
  .strict();
export type Target = z.infer<typeof TargetSchema>;

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export const BudgetSchema = z
  .object({
    maxDurationMs: z.number().int().positive().default(10 * 60 * 1000),
    maxTurns: z.number().int().positive().default(60),
    maxCostUsd: z.number().nonnegative().default(1),
  })
  .strict();
export type Budget = z.infer<typeof BudgetSchema>;

// ---------------------------------------------------------------------------
// Consent-based intake
// ---------------------------------------------------------------------------

/** A single non-inferred field that may be asked after the callee consents. */
export const IntakeFieldSchema = z
  .object({
    /** Stable key used in the saved intake record. */
    key: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
    /** Human-readable label shown in the decision memo. */
    label: z.string().min(1).max(120),
    /** The one-sentence question to ask, in the contract language. */
    question: z.string().min(1).max(240),
    /**
     * Ask this field only after these earlier intake fields have an explicit
     * answer. This lets a scenario branch without letting the model invent a
     * question order.
     */
    dependsOn: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/)).max(8).optional(),
    /**
     * Optional canonical answers. When present, the runtime records exactly
     * one matching choice and treats an unmatched or ambiguous reply as a
     * non-answer, so free text cannot silently become a profile value.
     */
    choices: z.array(z.string().min(1).max(120)).min(1).max(16).optional(),
  })
  .strict();
export type IntakeField = z.infer<typeof IntakeFieldSchema>;

/**
 * Optional, explicit intake. Oathra never infers a profile: every field,
 * purpose and question budget must be declared by the caller and the callee
 * must agree before any answer is recorded.
 */
export const IntakeSchema = z
  .object({
    purpose: z.string().min(1).max(240),
    consentPrompt: z.string().min(1).max(240),
    fields: z.array(IntakeFieldSchema).min(1).max(8),
    /** Maximum number of field questions (the consent prompt is separate). */
    maxQuestions: z.number().int().positive().max(8).default(3),
    /**
     * Kept for configuration compatibility. A refusal always stops optional
     * intake so a caller cannot accidentally make the agent press for more.
     */
    stopOnDecline: z.boolean().default(true),
    /**
     * Additional mission fields that must be verified before asking for
     * optional information. Required mission fields and constraints always
     * remain prerequisites as well.
     */
    startAfter: z.array(z.string().min(1)).max(8).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = new Set<string>();
    for (const [index, field] of value.fields.entries()) {
      if (keys.has(field.key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "key"], message: `duplicate intake field key: ${field.key}` });
      }
      keys.add(field.key);
      if (field.choices) {
        const choices = new Set<string>();
        for (const choice of field.choices) {
          if (choices.has(choice)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "choices"], message: `duplicate intake choice: ${choice}` });
          }
          choices.add(choice);
        }
      }
    }
    for (const [index, field] of value.fields.entries()) {
      for (const dependency of field.dependsOn ?? []) {
        if (dependency === field.key) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "dependsOn"], message: `intake field cannot depend on itself: ${dependency}` });
        } else if (!keys.has(dependency)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "dependsOn"], message: `unknown intake field dependency: ${dependency}` });
        }
      }
    }
    const dependencies = new Map(value.fields.map((field) => [field.key, field.dependsOn ?? []]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (key: string, path: string[]): void => {
      if (visited.has(key)) return;
      if (visiting.has(key)) {
        const index = value.fields.findIndex((field) => field.key === key);
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index < 0 ? 0 : index, "dependsOn"], message: `cyclic intake field dependency: ${[...path, key].join(" -> ")}` });
        return;
      }
      visiting.add(key);
      for (const dependency of dependencies.get(key) ?? []) visit(dependency, [...path, key]);
      visiting.delete(key);
      visited.add(key);
    };
    for (const field of value.fields) visit(field.key, []);
  });
export type Intake = z.infer<typeof IntakeSchema>;

/**
 * Render the consent line that is actually spoken to the callee.
 *
 * A contract keeps `purpose` and `consentPrompt` separate so callers can
 * reuse a short prompt in their UI and tests. The spoken line must still make
 * the collection purpose visible before asking permission. If the caller has
 * already included the purpose in the prompt, keep the prompt unchanged to
 * avoid repeating it.
 */
export function renderIntakeConsentPrompt(intake: Intake, language: "ja" | "en"): string {
  const purpose = intake.purpose.trim();
  const prompt = intake.consentPrompt.trim();
  const compact = (value: string) => value.replace(/[\s、。,.!?！？「」]/g, "").toLocaleLowerCase();
  if (!purpose || compact(prompt).includes(compact(purpose))) return prompt;
  return language === "ja"
    ? `追加の聞き取りの目的は「${purpose}」です。${prompt}`
    : `The purpose of the extra questions is “${purpose}.” ${prompt}`;
}

// ---------------------------------------------------------------------------
// CallContract
// ---------------------------------------------------------------------------

export const CallContractSchema = z
  .object({
    /** Dotted goal identifier, e.g. "restaurant.reservation". */
    goal: z.string().min(1),
    target: TargetSchema.default({}),
    /** Free-form inputs the agent may use (date, party size, name...). */
    input: z.record(z.string(), z.unknown()).default({}),
    /** Fields that MUST be verified with evidence before the call is complete. */
    require: z.record(z.string(), z.boolean()).default({}),
    constraints: ConstraintsSchema.default({}),
    permissions: PermissionsSchema.default({}),
    language: z.enum(["ja", "en"]).default("ja"),
    budget: BudgetSchema.default({}),
    /** Optional consent-gated, contract-declared caller information intake. */
    intake: IntakeSchema.optional(),
    /**
     * Who settles `confirmed`. Default "callee_statement": only an explicit confirmation phrase from
     * the callee (reservations, orders). "callee_acceptance" is for appointment-style calls where the
     * caller proposes a slot and the callee commits to it; hedges, deferrals and refusals still never count.
     */
    confirmation: z.enum(["callee_statement", "callee_acceptance"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const field of value.intake?.startAfter ?? []) {
      if (!value.require[field] && !value.constraints[field]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["intake", "startAfter"], message: `startAfter field must be in require or constraints: ${field}` });
      }
    }
  });

export type CallContractInput = z.input<typeof CallContractSchema>;
export type CallContract = z.infer<typeof CallContractSchema>;

/** Validate and normalise a CallContract. Throws ZodError on invalid input. */
export function defineCall(input: CallContractInput): CallContract {
  return CallContractSchema.parse(input);
}

/** Fields required by the contract, in declaration order. */
export function requiredFields(contract: CallContract): string[] {
  return Object.entries(contract.require)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

/** Whether an action is permitted. Unknown or unset actions are denied. */
export function isPermitted(contract: CallContract, action: Action): boolean {
  return contract.permissions[action] === true;
}

// ---------------------------------------------------------------------------
// Constraint evaluation (pure)
// ---------------------------------------------------------------------------

export type ConstraintViolation = {
  field: string;
  rule: keyof ConstraintRule;
  expected: unknown;
  actual: unknown;
};

export type ConstraintCheck = {
  satisfied: boolean;
  violations: ConstraintViolation[];
  /** Fields that had a constraint but no value yet (not a violation, just unknown). */
  unknown: string[];
};

type Scalar = string | number | boolean;

function compare(a: Scalar, b: Scalar): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  const sa = String(a);
  const sb = String(b);
  const na = Number(sa);
  const nb = Number(sb);
  if (sa.trim() !== "" && sb.trim() !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) {
    return na - nb;
  }
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Evaluate constraints against a map of field values (typically the verified
 * values produced by the evidence engine). Missing fields are reported as
 * `unknown`, never as violations: a constraint on a value we do not yet know
 * cannot be broken, but it also cannot be declared satisfied.
 */
export function checkConstraints(
  constraints: Constraints,
  values: Record<string, unknown>,
): ConstraintCheck {
  const violations: ConstraintViolation[] = [];
  const unknown: string[] = [];

  for (const [field, rule] of Object.entries(constraints)) {
    const actual = values[field];
    if (actual === undefined || actual === null) {
      unknown.push(field);
      continue;
    }
    if (
      typeof actual !== "string" &&
      typeof actual !== "number" &&
      typeof actual !== "boolean"
    ) {
      violations.push({ field, rule: "eq", expected: rule, actual });
      continue;
    }
    const fail = (r: keyof ConstraintRule, expected: unknown) =>
      violations.push({ field, rule: r, expected, actual });

    if (rule.eq !== undefined && compare(actual, rule.eq) !== 0) fail("eq", rule.eq);
    if (rule.ne !== undefined && compare(actual, rule.ne) === 0) fail("ne", rule.ne);
    if (rule.lte !== undefined && compare(actual, rule.lte) > 0) fail("lte", rule.lte);
    if (rule.gte !== undefined && compare(actual, rule.gte) < 0) fail("gte", rule.gte);
    if (rule.lt !== undefined && compare(actual, rule.lt) >= 0) fail("lt", rule.lt);
    if (rule.gt !== undefined && compare(actual, rule.gt) <= 0) fail("gt", rule.gt);
    if (rule.oneOf !== undefined && !rule.oneOf.some((v) => compare(actual, v) === 0)) {
      fail("oneOf", rule.oneOf);
    }
  }

  return { satisfied: violations.length === 0, violations, unknown };
}
export { PHONE_PURPOSE_TEMPLATES } from "./phone-templates.js";

/**
 * Someone rang the number. Nobody reviewed a request for this call, so the agent may do less than on an outbound
 * one: it answers on the owner's behalf, takes the message, and promises nothing. `context` is what the service
 * already knows (for example that this number was called earlier, and why); it is data, not an instruction.
 */
export function definePhoneInbound(call: { ownerName: string; callerPhone: string; callerName?: string; context?: string }, budget: Partial<CallContract["budget"]> = {}): CallContract {
  const ownerName = call.ownerName.trim().slice(0, 40), context = call.context?.trim().slice(0, 600);
  return defineCall({ goal: "phone.inbound", language: "ja",
    input: { ownerName, ...(context ? { context } : {}), policy: "着信への応対。AIであることと誰の電話かを最初に伝える。用件・名前・折り返し先を聞き取り、依頼者へ伝えると約束するだけにする。予約・購入・支払い・契約・個人情報の提供・依頼者の予定や居場所の回答は行わない。相手が切りたければ終了する。" },
    permissions: { ask: true }, budget: { maxDurationMs: 180000, maxTurns: 30, maxCostUsd: 1, ...budget },
    target: { phone: call.callerPhone, name: call.callerName?.trim().slice(0, 100) || "着信" },
  });
}

/** Shared ask-only policy for personal phone requests across CLI, OSS Web and managed Gateway. */
export function definePhoneRequest(request: PhoneRequest, budget: Partial<CallContract["budget"]> = {}): CallContract {
  const parsed = parsePhoneRequest(request);
  return defineCall({ goal: "phone.message", language: "ja",
    input: { request: parsed.instruction, ...(parsed.conversationMode ? { conversationMode: parsed.conversationMode } : {}), ...(parsed.callerName ? { callerName: parsed.callerName } : {}), policy: "AIによる代理電話であることを最初に伝える。承認された目的で会話し、相手が断ったら終了する。予約・購入・支払い・別の相手への発信を行わない。" },
    permissions: { ask: true }, budget: { maxDurationMs: 180000, maxTurns: 30, maxCostUsd: 1, ...budget },
    target: { phone: parsed.phone, name: parsed.name },
  });
}
