/**
 * The bridge: one carrier media session + one voice engine = one core
 * CallSession the runtime can drive. All format conversion happens here, so
 * carriers and engines never see each other.
 */
import type { Action, CallContract } from "@oathra/contract";
import type { Language } from "@oathra/evidence";
import type { CallSession, MissionView, SessionEvent, SpeakInput, SpeakResult, TransportProvider } from "@oathra/core";
import { convert, OutputQueue, type VoiceEngine, type VoiceSession } from "@oathra/voice";
import type { CarrierMediaSession, CarrierTransport, DialOptions } from "./types.js";

export type BridgeOptions = {
  carrier: CarrierMediaSession;
  engine: VoiceEngine;
  contract: CallContract;
  language: Language;
  calleeName?: string;
};

export class BridgedCallSession implements CallSession {
  readonly events: AsyncIterable<SessionEvent>;
  private readonly queue = new OutputQueue<SessionEvent>();
  private voice: VoiceSession | undefined;
  private ended = false;

  constructor(private readonly opts: BridgeOptions) {
    this.events = this.queue;
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

  private async pumpCarrier(): Promise<void> {
    const { carrier } = this.opts;
    try {
      for await (const ev of carrier.events) {
        if (this.ended) break;
        switch (ev.type) {
          case "connected":
            this.queue.push({ type: "connected", ...(this.opts.calleeName ? { callee: this.opts.calleeName } : {}) });
            break;
          case "audio":
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
        if (out.type === "audio") carrier.send(convert(out.chunk, carrier.audio));
        else if (out.type === "clear") carrier.clear();
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
    return this.voice.speak(input.text);
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
    this.opts.carrier.clear();
  }

  async hangup(reason?: string): Promise<void> {
    await this.close(reason);
  }

  private async close(reason?: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
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
    private readonly opts: { callerId?: string; recordDir?: string } = {},
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
    };
    const media = await this.carrier.dial(dial);
    const session = new BridgedCallSession({
      carrier: media,
      engine: this.engine,
      contract: ctx.contract,
      language: ctx.language,
      ...(target.name ? { calleeName: target.name } : {}),
    });
    this.lastSession = session;
    await session.start();
    return session;
  }
}
