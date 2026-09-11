import type { CallContract, Target } from "@oathra/contract";
import type { Language } from "@oathra/evidence";
import type { CallSession, SessionEvent, SpeakInput, SpeakResult, TransportProvider, Turn } from "@oathra/core";
import type { Scenario } from "@oathra/scenario";
import type { CalleeCharacter } from "./character.js";
import { createCharacter } from "./characters/index.js";
import { mulberry32 } from "./rng.js";

export type Pace = "realtime" | "fast";

export type SimulatorOptions = {
  scenario: Scenario;
  /** Override the scripted character (e.g. an LLM-driven or human callee). */
  character?: CalleeCharacter;
  /** realtime: speech takes real seconds (for demos). fast: virtual clock (for eval). */
  pace?: Pace;
  /** Speed multiplier for realtime pace (2 = twice as fast). */
  speed?: number;
  seed?: number;
  /** Simulated ASR confidence reported for callee speech. */
  asrConfidence?: number;
};

/** Reading speed used to turn text into a plausible speech duration. */
const CHARS_PER_SEC: Record<Language, number> = { ja: 6.5, en: 14 };

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((res) => this.waiters.push(res));
      },
    };
  }
}

export class SimulatorSession implements CallSession {
  readonly events: AsyncIterable<SessionEvent>;
  private readonly queue = new AsyncQueue<SessionEvent>();
  private readonly startWall = Date.now();
  private virtualMs = 0;
  private readonly transcript: Turn[] = [];
  private turnIndex = 0;
  private ended = false;
  private interruptFlag = false;
  private readonly rng: () => number;
  private readonly language: Language;
  private readonly pace: Pace;
  private readonly speed: number;
  private readonly asrConfidence: number;

  constructor(private readonly character: CalleeCharacter, opts: SimulatorOptions, language: Language) {
    this.events = this.queue;
    this.rng = mulberry32(opts.seed ?? opts.scenario.seed);
    this.language = language;
    this.pace = opts.pace ?? "realtime";
    this.speed = opts.speed ?? 1;
    this.asrConfidence = opts.asrConfidence ?? 0.98;
  }

  now(): number {
    return Date.now() - this.startWall + this.virtualMs;
  }

  private speechMs(text: string): number {
    const chars = text.replace(/[\s、。,.]/g, "").length;
    return Math.round((chars / CHARS_PER_SEC[this.language]) * 1000) + 250;
  }

  private async elapse(ms: number): Promise<void> {
    const rounded = Math.round(ms);
    if (this.pace === "fast") {
      this.virtualMs += rounded;
      // Yield a macrotask so the runtime can observe events (and timestamps)
      // in the same order it would in realtime.
      await new Promise<void>((r) => setImmediate(r));
      return;
    }
    await new Promise((r) => setTimeout(r, rounded / this.speed));
  }

  /** Called by the transport after connect: greeting, if any. */
  async start(): Promise<void> {
    this.queue.push({ type: "connected", callee: this.character.name });
    const greeting = this.character.greeting();
    if (greeting) {
      await this.elapse(600 + this.rng() * 400); // pick-up delay
      await this.calleeSays(greeting);
    }
  }

  private async calleeSays(text: string): Promise<void> {
    const startMs = this.now();
    this.queue.push({ type: "speech.started", startMs });
    await this.elapse(this.speechMs(text));
    const endMs = this.now();
    this.transcript.push({ id: `c${this.turnIndex++}`, source: "callee", text, t: endMs });
    this.queue.push({ type: "speech", text, startMs, endMs, asr: { primary: this.asrConfidence } });
  }

  async speak(input: SpeakInput): Promise<SpeakResult> {
    if (this.ended) return { startMs: this.now(), endMs: this.now(), interrupted: false };
    this.interruptFlag = false;
    const startMs = this.now();
    // Simulated TTS start latency.
    await this.elapse(60 + this.rng() * 40);
    const playStart = this.now();
    await this.elapse(this.speechMs(input.text));
    const endMs = this.now();
    this.transcript.push({ id: `a${this.turnIndex++}`, source: "caller", text: input.text, t: endMs });
    const result: SpeakResult = { startMs: playStart, endMs, interrupted: this.interruptFlag };
    void startMs;

    // Character reacts after a human-like pause.
    void this.react(input.text);
    return result;
  }

  private async react(agentText: string): Promise<void> {
    if (this.ended) return;
    await this.elapse(350 + this.rng() * 500);
    if (this.ended) return;
    const reply = await this.character.respond({
      transcript: [...this.transcript],
      lastAgentText: agentText,
      language: this.language,
      turnIndex: this.turnIndex,
      rng: this.rng,
    });
    await this.calleeSays(reply.text);
    if (reply.hangup) {
      await this.elapse(300);
      this.queue.push({ type: "hangup", reason: "callee_hangup" });
      this.ended = true;
      this.queue.close();
    }
  }

  interrupt(): void {
    this.interruptFlag = true;
  }

  async hangup(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.queue.close();
  }
}

export class SimulatorTransport implements TransportProvider {
  readonly name = "simulator";
  readonly kind = "simulator" as const;
  readonly deliversText = true;
  /** The character of the most recent session (exposes ground truth for eval). */
  lastCharacter: CalleeCharacter | undefined;

  constructor(private readonly opts: SimulatorOptions) {}

  async connect(_target: Target, ctx: { language: Language; contract: CallContract }): Promise<CallSession> {
    const rng = mulberry32(this.opts.seed ?? this.opts.scenario.seed);
    const character = this.opts.character ?? createCharacter(this.opts.scenario, rng);
    this.lastCharacter = character;
    const session = new SimulatorSession(character, this.opts, ctx.language);
    void session.start();
    return session;
  }
}
