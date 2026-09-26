/**
 * VoiceEngine adapters for the speech-to-speech agents. A carrier bridge feeds
 * chunks in any format; the adapters normalize the carrier side to μ-law 8 kHz
 * while each OpenAI agent uses its own native WebSocket format internally, then
 * publish model audio, clears and session events on the engine's output queue.
 */
import { MULAW_8K, type VoiceEngine, type VoiceSessionContext } from "@oathra/voice";
import { S2SVoiceSession } from "@oathra/voice-kit";
import { OpenAILiveAgent } from "./live.js";
import type { NewsSearch, NewsLookupEvent } from "./news.js";
import type { DeskEvent, ReservationDesk } from "@oathra/voice-kit";

export type GptLiveEngineOptions = { model?: string; voice?: string; delegateTo?: string; webSearch?: boolean; apiKey?: string; url?: string; newsSearch?: NewsSearch | false; onNews?: (event: NewsLookupEvent) => void; desk?: ReservationDesk; onDesk?: (event: DeskEvent) => void };

export function gptLiveEngine(opts: GptLiveEngineOptions = {}): VoiceEngine {
  const model = opts.model ?? "gpt-live-1";
  return {
    id: "gpt-live",
    label: `GPT-Live (${model})`,
    speaksItself: true,
    nativeAudio: MULAW_8K,
    requires: ["OPENAI_API_KEY"],
    async start(ctx: VoiceSessionContext, clock) {
      const agent = new OpenAILiveAgent({
        contract: ctx.contract,
        model,
        ...(opts.voice ? { voice: opts.voice } : {}),
        ...(opts.delegateTo ? { delegateTo: opts.delegateTo } : {}),
        ...(opts.webSearch !== undefined ? { webSearch: opts.webSearch } : {}),
        ...(opts.newsSearch !== undefined ? { newsSearch: opts.newsSearch } : {}),
        ...(opts.onNews ? { onNews: opts.onNews } : {}),
        ...(opts.desk ? { desk: opts.desk } : {}),
        ...(opts.onDesk ? { onDesk: opts.onDesk } : {}),
        ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
        ...(opts.url ? { url: opts.url } : {}),
        ...(ctx.calleeName ? { calleeName: ctx.calleeName } : {}),
      });
      const session = new S2SVoiceSession(agent, clock);
      await session.start();
      return session;
    },
  };
}
