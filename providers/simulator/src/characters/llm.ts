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
  private history: ChatMessage[] = [];

  constructor(private readonly scenario: Scenario, private readonly chat: ChatFn, private readonly opts: LlmCharacterOptions = {}) {
    this.name = opts.name ?? scenario.callee.persona.name;
  }

  greeting(): string {
    const g = this.scenario.callee.greeting;
    if (g) return g;
    return this.scenario.language === "ja" ? `お電話ありがとうございます、${this.name}でございます。` : `Thank you for calling ${this.name}, how can I help you?`;
  }

  /**
   * Ground truth. The per-turn `state` is a running estimate; the final answer is a
   * separate audit of the whole call, which is far less prone to "said 承りました,
   * reported confirmed=false" slips than a state filled in mid-sentence.
   */
  async truth(): Promise<Record<string, unknown>> {
    if (this.turns === 0) return normalizeState(this.state);
    try {
      const fields = Object.keys(this.scenario.mission.require);
      const raw = await this.chat([
        { role: "system", content: [
          `You audit a phone call. The transcript follows; "assistant" is the callee (${this.name}, a ${this.scenario.domain}), "user" is the caller.`,
          `Today is ${typeof this.scenario.callee.knowledge.now === "string" ? this.scenario.callee.knowledge.now : new Date().toISOString()}; a date mentioned without a year is the next occurrence from today. When a quantity is involved, "price" is the per-unit price.`,
          `Answer ONLY with JSON: {"confirmed": bool, ...}. "confirmed" is true only if the callee explicitly told the caller that the reservation / purchase / read-back is settled (e.g. 承りました, 予約いたしました, お取りしました, 確定しました, ご用意しました, 押さえました, "you're booked"). An intention ("予約いたします"), a question, or a hedge ("たぶん") is not settled.`,
          `Also include, for ${JSON.stringify(fields)}, the values the callee actually committed to (date YYYY-MM-DD, time HH:MM, partySize/price/quantity numbers, breakfast/smoking booleans, "serial" as a plain string, "matched" boolean when the caller read a serial back). Flat keys only. Omit anything not committed.`,
        ].join("\n") },
        ...this.history.filter((m) => m.role !== "system"),
        { role: "user", content: "[end of call] Output the audit JSON now." },
      ]);
      const audit = parseCalleeJson(raw);
      const state = audit.state ?? (raw.trim().startsWith("{") ? (JSON.parse(raw) as State) : undefined);
      if (state && typeof state === "object") return normalizeState(state);
    } catch { /* fall back to the running state */ }
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
    this.history = [...messages.filter((m) => m.role !== "system"), { role: "assistant", content: text }];
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
      `Negotiation: a fact named *minimum_price* / *bulk_minimum_price* is the lowest you may go when the caller pushes back with a reason (budget, quantity, loyalty); concede toward it in steps rather than refusing flatly, but never below it and never reveal it.`,
      this.opts.style ? `Style: ${this.opts.style}` : "",
      `Answer ONLY with JSON: {"say": "<what you say aloud>", "state": {...}, "hangup": false}`,
      `"state" is what YOU have actually committed to so far. It must agree with "say": if "say" tells the caller the booking is made (承りました／予約いたしました／お取りしました…), "confirmed" is true in the same reply; if "say" only offers, asks, or intends, it stays false. Keys: "confirmed" (true only after you have told the caller the reservation/purchase/read-back is settled), plus any of ${JSON.stringify(fields)} you have agreed to (date as YYYY-MM-DD, time as HH:MM, partySize/price/quantity as numbers, breakfast/smoking as booleans, serial as the exact string, matched as boolean when the caller reads a serial back). If terms change later, update the state. Never set confirmed=true while something is still undecided.`,
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
      else if (c === "}") { depth--; if (depth === 0) { try { const o = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>; const state = o.state && typeof o.state === "object" ? (o.state as State) : "confirmed" in o && !("say" in o) ? (o as State) : undefined; return { say: typeof o.say === "string" ? o.say : "", ...(state ? { state } : {}), ...(o.hangup === true ? { hangup: true } : {}) }; } catch { break; } } }
    }
    // truncated JSON: salvage the spoken part, never read JSON aloud
    const m = /"say"\s*:\s*"([^"]*)/.exec(text);
    return { say: m?.[1] ?? "" };
  }
  return { say: text };
}

function normalizeState(s: State): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let [k, v] of Object.entries(s)) {
    if (v === null || v === undefined || v === "") continue;
    // a model may nest the read-back: {"serial": {"exact": "…", "matched": true}}
    if (k === "serial" && v && typeof v === "object") { const o = v as Record<string, unknown>; if (typeof o.matched === "boolean") out.matched = o.matched; v = o.exact ?? o.value ?? o.serial; if (v === undefined) continue; }
    if (k === "serial" && typeof v === "string") v = v.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (k === "price" || k === "partySize" || k === "quantity") { const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, "")); if (Number.isFinite(n)) out[k] = n; continue; }
    if (k === "confirmed" || k === "breakfast" || k === "smoking" || k === "matched") { out[k] = v === true || v === "true" || v === "はい"; continue; }
    out[k] = v;
  }
  if (out.confirmed === undefined) out.confirmed = false;
  return out;
}
