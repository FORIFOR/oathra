import { z } from "zod";

/** Experimental input helpers. They never dial, resolve contacts, or access a network. */
export type PhoneInputErrorCode = "INVALID_PHONE_NUMBER" | "MULTIPLE_PHONE_NUMBERS";

export class PhoneInputError extends Error {
  constructor(public readonly code: PhoneInputErrorCode, message: string) {
    super(message);
    this.name = "PhoneInputError";
  }
}

const invalid = (): never => {
  throw new PhoneInputError("INVALID_PHONE_NUMBER", "電話番号を1件入力してください。日本の番号、または国番号付きの + で始まる番号が使えます。内線には対応していません。");
};

function normalizeCharacters(value: string): string {
  return value.normalize("NFKC").replace(/[‐‑‒–—−]/g, "-").trim();
}

/**
 * Normalize one telephone number to E.164-shaped text. Accepts NFKC digits,
 * spaces, hyphens and balanced parentheses. Domestic 10/11-digit numbers use
 * Japan (+81); all other countries require an explicit + country prefix.
 * Checks syntax only, not assignment, reachability, ownership or permission.
 * Throws PhoneInputError; never silently drops extensions or other text.
 */
export function normalizePhoneNumber(input: string): string {
  if (typeof input !== "string" || input.length > 128) return invalid();
  const value = normalizeCharacters(input);
  if (!/^[+\d\s()-]+$/.test(value)) return invalid();
  let depth = 0;
  for (const character of value) {
    if (character === "(" && ++depth !== 1) return invalid();
    if (character === ")" && --depth !== 0) return invalid();
  }
  if (depth !== 0 || /\(\s*\)/.test(value)) return invalid();
  const compact = value.replace(/[\s()-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  if (/^0[1-9]\d{8,9}$/.test(compact)) return `+81${compact.slice(1)}`;
  return invalid();
}

/**
 * Extract one explicit number from chat text, or null if absent. Numeric dates,
 * currency amounts and identifiers are not telephone numbers. Multiple phone
 * candidates (including repeats) and extensions require clarification instead
 * of choosing a recipient. A returned number is not authorization to dial.
 */
export function extractPhoneNumber(text: string): string | null {
  if (typeof text !== "string") return invalid();
  const value = normalizeCharacters(text);
  const candidates: string[] = [];
  // Match a whole numeric span so an oversized/invalid number is never clipped
  // into a valid recipient. Newlines separate recipients, not digit groups.
  for (const match of value.matchAll(/[+(]?\d[\d() \t-]*(?:\d|\))?/g)) {
    const raw = match[0].trim();
    const start = match.index!;
    const before = value.slice(0, start);
    const after = value.slice(start + raw.length);
    if (/[\w@.]$/.test(before) || /^(?:[\w@]|\.[\w@])/.test(after)) {
      if (/^\s*(?:ext\.?|extension|x)\s*\d/i.test(after) && /^(?:\+|\(?0)/.test(raw)) return invalid();
      continue;
    }
    if (/[¥$€£]\s*$/.test(before) || /^\s*(?:円|万円|億円|ドル|USD|JPY|EUR)/i.test(after)) continue;
    if (/^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}-\d{4})$/.test(raw) || /^\s*(?:年|月|日|時|分|秒)/.test(after)) continue;
    if (!/^(?:\+|\(?0)/.test(raw) || (raw.match(/\d/g)?.length ?? 0) < 8) continue;
    if (/\+$/.test(before)) return invalid();
    if (/^\s*(?:内線|ext\.?|extension|x)\s*[:：]?\s*\d/i.test(after)) return invalid();
    candidates.push(raw);
  }
  if (candidates.length > 1) {
    throw new PhoneInputError("MULTIPLE_PHONE_NUMBERS", "電話番号が複数あります。発信先を1件だけ指定してください。");
  }
  return candidates.length === 0 ? null : normalizePhoneNumber(candidates[0]!);
}

const PhoneNumberSchema = z.string().transform((value, ctx) => {
  try {
    return normalizePhoneNumber(value);
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "電話番号が不正です。" });
    return z.NEVER;
  }
});

/**
 * Voices the GPT-Live engine accepts (checked against the API on 2026-09-21; an unknown name is refused
 * there with "Voice session access denied"). A voice is fixed for the whole call.
 */
export const PHONE_VOICES = ["marin", "quartz", "ripple", "vesper", "willow", "stone", "gleam", "meridian", "bossa", "tempo", "beacon", "delta", "cinder"] as const;
export const DEFAULT_PHONE_VOICE = "marin";
/** Speech-to-speech engines a request may ask for. Absent keeps the server's configured engine. */
export const PHONE_ENGINES = ["gpt-live", "gemini-live"] as const;
export type PhoneEngine = (typeof PHONE_ENGINES)[number];
/** Gemini Live accepts every prebuilt TTS voice (30). Custom Voice Design voices are TTS-only and not accepted by Live. */
export const GEMINI_VOICES = [
  "Kore", "Zephyr", "Puck", "Charon", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;
export const DEFAULT_GEMINI_VOICE = "Kore";
/** Google's one-word character for each voice, in Japanese, for the voice picker. Not a measurement. */
export const GEMINI_VOICE_TRAITS: Record<(typeof GEMINI_VOICES)[number], string> = {
  Kore: "しっかり", Zephyr: "明るい", Puck: "元気", Charon: "説明向き", Fenrir: "弾む", Leda: "若々しい", Orus: "しっかり", Aoede: "軽やか",
  Callirrhoe: "ゆったり", Autonoe: "明るい", Enceladus: "息まじり", Iapetus: "はっきり", Umbriel: "気さく", Algieba: "なめらか", Despina: "なめらか",
  Erinome: "明るい", Algenib: "ハスキー", Rasalgethi: "説明向き", Laomedeia: "元気", Achernar: "やわらか", Alnilam: "しっかり", Schedar: "落ち着いた",
  Gacrux: "大人っぽい", Pulcherrima: "前向き", Achird: "親しみやすい", Zubenelgenubi: "くだけた", Vindemiatrix: "やさしい", Sadachbia: "生き生き",
  Sadaltager: "知的", Sulafat: "あたたかい",
};
export const ENGINE_VOICES: Record<PhoneEngine, readonly string[]> = { "gpt-live": PHONE_VOICES, "gemini-live": GEMINI_VOICES };
export const ENGINE_DEFAULT_VOICE: Record<PhoneEngine, string> = { "gpt-live": DEFAULT_PHONE_VOICE, "gemini-live": DEFAULT_GEMINI_VOICE };

/**
 * Voice presets: a base voice per engine plus a speaking style, chosen together. They change how the agent
 * sounds, never what it may do: permissions, disclosure and the completion verdict are the same for all four.
 */
export const VOICE_PRESETS = ["character-female", "character-male", "sales-female", "sales-male"] as const;
export type VoicePreset = (typeof VOICE_PRESETS)[number];
export const VOICE_PRESET_LABELS: Record<VoicePreset, string> = {
  "character-female": "キャラクター風・女性声", "character-male": "キャラクター風・男性声", "sales-female": "営業・案内・女性声", "sales-male": "営業・案内・男性声",
};
/** Starting choices, not yet chosen by listening: Google lists Leda/Kore as female and Puck/Orus as male; OpenAI lists gleam as feminine and meridian as masculine. */
export const PRESET_VOICES: Record<PhoneEngine, Record<VoicePreset, string>> = {
  "gemini-live": { "character-female": "Leda", "character-male": "Puck", "sales-female": "Kore", "sales-male": "Orus" },
  "gpt-live": { "character-female": "gleam", "character-male": "meridian", "sales-female": "gleam", "sales-male": "meridian" },
};
/** The voice a call speaks with: an explicit voice wins, then the preset's voice for this engine, else the engine's own default. */
export function resolvePhoneVoice(engine: string, request: { voice?: string | undefined; voicePreset?: VoicePreset | undefined }): string | undefined {
  if (request.voice) return request.voice;
  if (request.voicePreset && (engine === "gpt-live" || engine === "gemini-live")) return PRESET_VOICES[engine][request.voicePreset];
  return undefined;
}

/** Experimental v1 handoff file: preparing/parsing it does not approve a call. */
/** The fields of a phone request. `PhoneRequestSchema` adds the engine/voice consistency check on top. */
export const PhoneRequestFieldsSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("oathra.phone-request"),
  phone: PhoneNumberSchema,
  name: z.string().trim().min(1).max(100),
  // Optional experimental v1 extension; absent keeps the original message-only behavior.
  conversationMode: z.enum(["message", "chat"]).optional(),
  // Optional: whose behalf the call is on, as the callee should hear it ("堀尾"). A call that cannot say who is
  // behind it gets "誰?" and a hang-up. Letters, not contact details.
  callerName: z.string().trim().min(1).max(40).refine(value => !/[\d@<>{}]|https?:/i.test(value), "名前だけを入力してください。").optional(),
  // Optional: which speech-to-speech engine speaks. Absent keeps the server's configured engine.
  engine: z.enum(PHONE_ENGINES).optional(),
  // Optional: which voice speaks. Absent keeps the engine's default. A voice belongs to one engine.
  voice: z.enum([...PHONE_VOICES, ...GEMINI_VOICES]).optional(),
  // Optional: a base voice and a speaking style chosen together. Never changes permissions or the verdict.
  voicePreset: z.enum(VOICE_PRESETS).optional(),
  instruction: z.string().trim().min(1).max(2000).refine(value => !/\{\{[^{}]+\}\}/.test(value), "テンプレートの {{項目}} を具体的な内容に書き換えてください。"),
}).strict();

export const PhoneRequestSchema = PhoneRequestFieldsSchema.superRefine((value, ctx) => {
  if (!value.voice) return;
  const engine: PhoneEngine = value.engine ?? ((GEMINI_VOICES as readonly string[]).includes(value.voice) ? "gemini-live" : "gpt-live");
  if (!ENGINE_VOICES[engine].includes(value.voice)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["voice"], message: `この声は ${engine} では使えません。` });
});

export type PhoneRequest = z.infer<typeof PhoneRequestSchema>;
export type PhoneRequestInput = Pick<PhoneRequest, "phone" | "name" | "instruction" | "conversationMode" | "voice" | "callerName" | "engine" | "voicePreset">;

/** Validate user-entered fields and create an inert handoff. Throws ZodError. */
export function preparePhoneRequest(input: PhoneRequestInput): PhoneRequest {
  return PhoneRequestSchema.parse({ ...input, schemaVersion: 1, kind: "oathra.phone-request" });
}

/** Validate an unknown file, including its exact version/kind. Throws ZodError. */
export function parsePhoneRequest(input: unknown): PhoneRequest {
  return PhoneRequestSchema.parse(input);
}
