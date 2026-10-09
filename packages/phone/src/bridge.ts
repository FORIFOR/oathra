/**
 * The bridge: one carrier media session + one voice engine = one core
 * CallSession the runtime can drive. All format conversion happens here, so
 * carriers and engines never see each other.
 */
import type { Action, CallContract } from "@oathra/contract";
import type { Language } from "@oathra/evidence";
import { transcriptNotice, type CallSession, type MissionView, type SessionEvent, type SpeakInput, type SpeakResult, type TransportProvider } from "@oathra/core";
import { chunkDurationMs, convert, OutputQueue, type AudioChunk, type VoiceEngine, type VoiceSession } from "@oathra/voice";
import type { CarrierMediaSession, CarrierTransport, DialOptions } from "./types.js";

export type BridgeOptions = {
  carrier: CarrierMediaSession;
  engine: VoiceEngine;
  contract: CallContract;
  language: Language;
  calleeName?: string;
  /**
   * The fixed words the callee hears first when the carrier does not say them itself (see `PhoneTransport`).
   * With `audio` the bridge plays them when the line connects and the engine's own audio waits behind them
   * (speech-to-speech engines cannot be handed fixed words); without, they open the first reply the runtime speaks.
   */
  notice?: { text: string; audio?: AudioChunk };
};

export class BridgedCallSession implements CallSession {
  readonly events: AsyncIterable<SessionEvent>;
  private readonly queue = new OutputQueue<SessionEvent>();
  private voice: VoiceSession | undefined;
  private ended = false;
  private noticeSpoken = false;
  /** Engine audio produced before the notice has finished playing. */
  private held: AudioChunk[] | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: BridgeOptions) {
    this.events = this.queue;
    if (opts.notice?.audio) this.held = [];
  }

  now(): number {
    return this.opts.carrier.now();
  }

  async start(): Promise<void> {
    const { carrier, engine, contract, language } = this.opts;
    this.voice = await engine.start(
      { contract, language, carrierAudio: carrier.audio, ...(this.opts.calleeName ? { calleeName: this.opts.calleeName } : {}) },
      { now: () => carrier.now() },
    );
    void this.pumpCarrier();
    void this.pumpEngine();
  }

  /** The line is up: the notice goes out once, before anything the engine says. */
  private playNotice(): void {
    const audio = this.opts.notice?.audio;
    if (!audio || this.noticeSpoken || this.ended) return;
    this.noticeSpoken = true;
    const { carrier } = this.opts;
    carrier.send(convert(audio, carrier.audio));
    this.noticeTimer = setTimeout(() => {
      const held = this.held ?? [];
      this.held = undefined;
      if (!this.ended) for (const chunk of held) carrier.send(chunk);
    }, chunkDurationMs(audio));
  }

  private async pumpCarrier(): Promise<void> {
    const { carrier } = this.opts;
    try {
      for await (const ev of carrier.events) {
        if (this.ended) break;
        switch (ev.type) {
          case "connected":
            this.playNotice();
            this.queue.push({ type: "connected", ...(this.opts.calleeName ? { callee: this.opts.calleeName } : {}) });
            break;
          case "audio":
            this.playNotice();
            this.voice?.input(ev.chunk);
            break;
          case "hangup":
            this.queue.push({ type: "hangup", ...(ev.reason ? { reason: ev.reason } : {}) });
            await this.close();
            return;
          case "error":
            this.queue.push({ type: "error", message: ev.message, ...(ev.fatal !== undefined ? { fatal: ev.fatal } : {}) });
            break;
          default:
            break;
        }
      }
      if (!this.ended) {
        this.queue.push({ type: "hangup", reason: "carrier_closed" });
        await this.close();
      }
    } catch (e) {
      this.queue.push({ type: "error", message: (e as Error).message, fatal: true });
      await this.close();
    }
  }

  private async pumpEngine(): Promise<void> {
    const { carrier } = this.opts;
    const voice = this.voice;
    if (!voice) return;
    try {
      for await (const out of voice.output) {
        if (this.ended) break;
        if (out.type === "audio") {
          const chunk = convert(out.chunk, carrier.audio);
          if (this.held) this.held.push(chunk);
          else carrier.send(chunk);
        } else if (out.type === "clear") {
          // A barge-in drops what the engine queued, never the notice itself.
          if (this.held) this.held = [];
          else carrier.clear();
        }
        else this.queue.push(out.event);
        if (out.type === "event" && out.event.type === "hangup") {
          await this.close();
          return;
        }
      }
    } catch (e) {
      this.queue.push({ type: "error", message: (e as Error).message, fatal: true });
      await this.close();
    }
  }

  async speak(input: SpeakInput): Promise<SpeakResult> {
    if (this.ended || !this.voice?.speak) return { startMs: this.now(), endMs: this.now(), interrupted: false };
    const notice = this.opts.notice && !this.opts.notice.audio && !this.noticeSpoken ? this.opts.notice.text : undefined;
    if (notice) this.noticeSpoken = true;
    const text = notice ? `${notice}${input.language === "ja" ? "" : " "}${input.text}` : input.text;
    const spoke = await this.voice.speak(text, input.inputUntilMs !== undefined ? { inputUntilMs: input.inputUntilMs } : undefined);
    // Nothing of it was played: the notice is still owed, and opens the next reply.
    if (notice && spoke.skipped) this.noticeSpoken = false;
    return spoke;
  }

  ack(): void {
    this.voice?.ack?.();
  }

  updateContext(view: MissionView): void {
    this.voice?.updateContext?.(view);
  }

  resolveAction(action: Action, approved: boolean): void {
    this.voice?.resolveAction?.(action, approved);
  }

  interrupt(): void {
    this.voice?.interrupt();
    if (this.held) this.held = [];
    else this.opts.carrier.clear();
  }

  async hangup(reason?: string): Promise<void> {
    await this.close(reason);
  }

  private async close(reason?: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    try {
      await this.voice?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.opts.carrier.hangup(reason);
    } catch {
      /* ignore */
    }
    this.queue.close();
  }
}

/** Adapts a carrier transport + voice engine to the core TransportProvider protocol. */
export class PhoneTransport implements TransportProvider {
  readonly name: string;
  readonly kind = "sip" as const;
  readonly deliversText = true;
  readonly speaksItself: boolean;
  lastSession: BridgedCallSession | undefined;

  constructor(
    private readonly carrier: CarrierTransport,
    private readonly engine: VoiceEngine,
    private readonly opts: {
      callerId?: string;
      recordDir?: string;
      transcriptNotice?: boolean;
      /** Synthesizes the notice for engines that speak for themselves; needed when the carrier does not play it. */
      noticeAudio?: (text: string, language: Language) => Promise<AudioChunk>;
    } = {},
  ) {
    this.name = `${carrier.providerId}:${carrier.path}+${engine.id}`;
    this.speaksItself = engine.speaksItself;
  }

  async connect(target: { phone?: string; name?: string }, ctx: { language: Language; contract: CallContract }): Promise<CallSession> {
    if (!target.phone) throw new Error("target.phone (E.164) is required for phone calls");
    const dial: DialOptions = {
      to: target.phone,
      language: ctx.language,
      contract: ctx.contract,
      ...(this.opts.callerId ? { callerId: this.opts.callerId } : {}),
      ...(this.opts.recordDir ? { recordDir: this.opts.recordDir } : {}),
      ...(this.opts.transcriptNotice ? { transcriptNotice: true } : {}),
    };
    // Something of this call is kept, and the carrier does not say so itself (only Twilio direct does, and only it
    // records audio): the callee hears the transcript notice on the line, exactly once. The wording is never left
    // to a model, so a speech-to-speech engine needs the words as audio, and without them the call is not placed.
    const kept = Boolean(this.opts.recordDir || this.opts.transcriptNotice);
    let notice: { text: string; audio?: AudioChunk } | undefined;
    if (kept && !this.carrier.playsNotice) {
      const text = transcriptNotice(ctx.language);
      if (!this.engine.speaksItself) notice = { text };
      else if (this.opts.noticeAudio) notice = { text, audio: await this.opts.noticeAudio(text, ctx.language) };
      else throw new Error(`${this.carrier.providerId} does not announce that the call is kept and ${this.engine.id} cannot be handed fixed words: pass noticeAudio, or keep nothing of the call`);
    }
    const media = await this.carrier.dial(dial);
    const session = new BridgedCallSession({
      carrier: media,
      engine: this.engine,
      contract: ctx.contract,
      language: ctx.language,
      ...(target.name ? { calleeName: target.name } : {}),
      ...(notice ? { notice } : {}),
    });
    this.lastSession = session;
    await session.start();
    return session;
  }
}
