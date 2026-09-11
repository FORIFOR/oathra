import type { Language } from "@oathra/evidence";
import type { Turn } from "@oathra/core";
import type { Scenario } from "@oathra/scenario";

export type CalleeContext = {
  transcript: Turn[];
  lastAgentText: string;
  language: Language;
  turnIndex: number;
  rng: () => number;
};

export type CalleeReply = { text: string; hangup?: boolean };

/** A scripted or model-driven character answering the phone. */
export interface CalleeCharacter {
  readonly name: string;
  /** What the character says when picking up. `undefined` = waits for the caller. */
  greeting(): string | undefined;
  respond(ctx: CalleeContext): Promise<CalleeReply> | CalleeReply;
  /**
   * Ground truth from the callee's side, used by eval to detect false
   * completions: what the callee actually committed to.
   */
  truth?(): Record<string, unknown>;
}

export type CharacterFactory = (scenario: Scenario, rng: () => number) => CalleeCharacter;

// Shared phrase helpers -------------------------------------------------------

export const GOODBYE_RE = /失礼(?:します|いたします)|ありがとうございました|では[、,]?また|さようなら|それでは失礼|goodbye|bye\b|thank you,? (?:that's all|goodbye)/i;
export const NAME_ASK_RE = /お名前|ご予約者|your name|name for the/i;
export const QUESTION_RE = /[?？]|でしょうか|ますか|ませんか|いかがです|いかがでしょう|could you|can you|do you|is there|are there/i;

export function extractName(text: string): string | undefined {
  const m =
    /(?:名前は|名義は|予約者は)?\s*([^\s、。,\.]{1,12}?)\s*(?:と申します|といいます|と言います|で(?:お願いします|す)$)/.exec(text.trim()) ??
    /(?:my name is|it's|this is|under)\s+([A-Za-z][A-Za-z\-']{1,20})/i.exec(text);
  const n = m?.[1];
  if (!n) return undefined;
  if (/^(はい|いいえ|それ|これ|そちら)$/.test(n)) return undefined;
  return n.replace(/様$|さん$/, "");
}

export function jaDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

export function jaTime(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min === 0) return `${h}時`;
  if (min === 30) return `${h}時半`;
  return `${h}時${min}分`;
}

export function jaPrice(n: number): string {
  return `${n.toLocaleString("ja-JP")}円`;
}

/** Turn a serial code into a spoken form: "RZ-7K3Q" -> "R、Z、7、K、3、Q". */
export function spellSerial(code: string): string {
  return [...code.replace(/[^A-Za-z0-9]/g, "").toUpperCase()].join("、");
}

/**
 * A human on the callee side (Play mode). `respond` waits until `reply()` is
 * called by the UI. `hangup()` ends the call from the human side.
 */
export class HumanCharacter implements CalleeCharacter {
  private waiter: ((r: CalleeReply) => void) | undefined;
  private queued: CalleeReply[] = [];

  constructor(
    readonly name: string,
    private readonly greetingText?: string,
  ) {}

  greeting(): string | undefined {
    return this.greetingText;
  }

  respond(): Promise<CalleeReply> {
    const q = this.queued.shift();
    if (q) return Promise.resolve(q);
    return new Promise((res) => (this.waiter = res));
  }

  reply(text: string): void {
    const r: CalleeReply = { text };
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w(r);
    } else this.queued.push(r);
  }

  hangup(text = "失礼します。"): void {
    const r: CalleeReply = { text, hangup: true };
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w(r);
    } else this.queued.push(r);
  }
}
