import { MULAW_8K, type VoiceEngine, type VoiceSessionContext } from "@oathra/voice";
import { S2SVoiceSession, type DeskEvent, type ReservationDesk } from "@oathra/voice-kit";
import { DEFAULT_GEMINI_LIVE_MODEL, GeminiLiveAgent } from "./live.js";

export type GeminiLiveEngineOptions = { model?: string; voice?: string; apiKey?: string; url?: string; desk?: ReservationDesk; onDesk?: (event: DeskEvent) => void; inactivityMs?: number; affectiveDialog?: boolean };

/** Gemini Live as a VoiceEngine: μ-law 8 kHz at the carrier boundary, 16 kHz in / 24 kHz out on the API. */
export function geminiLiveEngine(opts: GeminiLiveEngineOptions = {}): VoiceEngine {
  const model = opts.model ?? DEFAULT_GEMINI_LIVE_MODEL;
  return {
    id: "gemini-live",
    label: `Gemini Live (${model})`,
    speaksItself: true,
    nativeAudio: MULAW_8K,
    requires: ["GEMINI_API_KEY"],
    async start(ctx: VoiceSessionContext, clock) {
      const agent = new GeminiLiveAgent({
        contract: ctx.contract,
        model,
        ...(opts.voice ? { voice: opts.voice } : {}),
        ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
        ...(opts.url ? { url: opts.url } : {}),
        ...(opts.desk ? { desk: opts.desk } : {}),
        ...(opts.onDesk ? { onDesk: opts.onDesk } : {}),
        ...(opts.inactivityMs !== undefined ? { inactivityMs: opts.inactivityMs } : {}),
        ...(opts.affectiveDialog !== undefined ? { affectiveDialog: opts.affectiveDialog } : {}),
        ...(ctx.calleeName ? { calleeName: ctx.calleeName } : {}),
      });
      const session = new S2SVoiceSession(agent, clock);
      await session.start();
      return session;
    },
  };
}
