import type { Scenario } from "@oathra/scenario";
import { GOODBYE_RE, type CalleeCharacter, type CalleeContext, type CalleeReply } from "../character.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
/** Any chat model: takes the conversation, returns the assistant text (JSON expected). */
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

export type LlmCharacterOptions = {
  /** Shown in transcripts/results as the callee name; defaults to the persona name. */
  name?: string;
  /** Extra instructions appended to the system prompt (e.g. "be rude", "speak fast"). */
  style?: string;
};

type State = Record<string, unknown>;

/**
 * A callee played by a language model, for evaluating the evidence engine against
 * phrasing the scripted characters never produce. The model answers every turn with
 *   { "say": "...", "state": { confirmed, date, time, partySize, price, ... }, "hangup"?: bool }
 * and `state` — what the callee itself says it has committed to — is the ground truth
 * that `detectFalseCompletion` grades the caller against. The scenario's knowledge and
 * rules are the only facts the model may use.
 */
export class LlmCharacter implements CalleeCharacter {
  readonly name: string;
  private state: State = { confirmed: false };
  private turns = 0;

  constructor(private readonly scenario: Scenario, private readonly chat: ChatFn, private readonly opts: LlmCharacterOptions = {}) {
    this.name = opts.name ?? scenario.callee.persona.name;
  }

  greeting(): string {
    const g = this.scenario.callee.greeting;
    if (g) return g;
    return this.scenario.language === "ja" ? `お電話ありがとうございます、${this.name}でございます。` : `Thank you for calling ${this.name}, how can I help you?`;
  }

  truth(): Record<string, unknown> {
    return normalizeState(this.state);
  }

  async respond(ctx: CalleeContext): Promise<CalleeReply> {
    this.turns++;
    const messages: ChatMessage[] = [{ role: "system", content: this.systemPrompt() }];
    for (const t of ctx.transcript) messages.push({ role: t.source === "callee" ? "assistant" : "user", content: t.text });
    if (messages[messages.length - 1]?.role !== "user") messages.push({ role: "user", content: ctx.lastAgentText || "（無言）" });
    const raw = await this.chat(messages);
    const parsed = parseCalleeJson(raw);
    if (parsed.state) this.state = { ...this.state, ...parsed.state };
    const text = parsed.say.trim() || (this.scenario.language === "ja" ? "恐れ入ります、もう一度お願いできますか？" : "Sorry, could you say that again?");
    // a goodbye is a hang-up even when the model forgot the flag (otherwise the caller keeps talking to a dead line)
    const bye = parsed.hangup === true || (GOODBYE_RE.test(text) && /失礼|さようなら|goodbye|bye\b/i.test(text));
    return bye ? { text, hangup: true } : { text };
  }

  private systemPrompt(): string {
    const s = this.scenario;
    const ja = s.language === "ja";
    const k = JSON.stringify(s.callee.knowledge);
    const rules = s.callee.rules.length ? s.callee.rules.map((r) => `- ${r}`).join("\n") : "- (none)";
    const persona = s.callee.persona;
    const fields = Object.keys(s.mission.require);
    return [
      `You are ${this.name}, the person who ANSWERED the phone (domain: ${s.domain}). The caller is an AI agent trying to: ${s.mission.brief}`,
      `You are NOT the agent. Play the callee only: a real ${s.domain} employee on a phone line.`,
      `Language: ${ja ? "Japanese (natural spoken 丁寧語, like a real clerk)" : "English"}. Keep each reply to one or two short sentences. Vary your wording; do not repeat a fixed formula.`,
      `Persona: patience ${persona.patience}, flexibility ${persona.flexibility}${"friendliness" in persona ? `, friendliness ${(persona as { friendliness?: number }).friendliness}` : ""}.`,
      `Today is ${typeof s.callee.knowledge.now === "string" ? s.callee.knowledge.now : new Date().toISOString()}; dates the caller mentions without a year are in that year or the next.`,
      `Facts you know (never invent others): ${k}`,
      `Rules you must obey:\n${rules}`,
      this.opts.style ? `Style: ${this.opts.style}` : "",
      `Answer ONLY with JSON: {"say": "<what you say aloud>", "state": {...}, "hangup": false}`,
      `"state" is the ground truth of what YOU have actually committed to so far, used to grade the caller. Keys: "confirmed" (true only after you have told the caller the reservation/purchase/read-back is settled), plus any of ${JSON.stringify(fields)} you have agreed to (date as YYYY-MM-DD, time as HH:MM, partySize/price/quantity as numbers, breakfast/smoking as booleans, serial as the exact string, matched as boolean when the caller reads a serial back). If terms change later, update the state. Never set confirmed=true while something is still undecided.`,
      `Set "hangup": true only after the goodbye.`,
    ].filter(Boolean).join("\n");
  }
}

export function parseCalleeJson(raw: string): { say: string; state?: State; hangup?: boolean } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  if (start >= 0) {
    // first balanced object
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { try { const o = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>; return { say: typeof o.say === "string" ? o.say : "", ...(o.state && typeof o.state === "object" ? { state: o.state as State } : {}), ...(o.hangup === true ? { hangup: true } : {}) }; } catch { break; } } }
    }
    // truncated JSON: salvage the spoken part, never read JSON aloud
    const m = /"say"\s*:\s*"([^"]*)/.exec(text);
    return { say: m?.[1] ?? "" };
  }
  return { say: text };
}

function normalizeState(s: State): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === null || v === undefined || v === "") continue;
    if (k === "price" || k === "partySize" || k === "quantity") { const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, "")); if (Number.isFinite(n)) out[k] = n; continue; }
    if (k === "confirmed" || k === "breakfast" || k === "smoking" || k === "matched") { out[k] = v === true || v === "true" || v === "はい"; continue; }
    out[k] = v;
  }
  if (out.confirmed === undefined) out.confirmed = false;
  return out;
}
