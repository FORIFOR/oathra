import { OpenAITTS } from "./tts.js";
import { OpenAIRealtimeTTS } from "./realtime-tts.js";

/** Explicit opt-in. No automatic fallback/retry that could duplicate speech/cost. */
export function createOpenAITTS(env: NodeJS.ProcessEnv = process.env): OpenAITTS | OpenAIRealtimeTTS {
  const transport = env.OATHRA_TTS_TRANSPORT ?? "speech";
  if (transport === "speech") return new OpenAITTS({ apiKey: env.OPENAI_API_KEY ?? "" });
  if (transport !== "realtime") throw new Error("OATHRA_TTS_TRANSPORT must be speech or realtime");
  return new OpenAIRealtimeTTS({
    apiKey: env.OPENAI_API_KEY ?? "",
    ...(env.OATHRA_TTS_MODEL ? { model: env.OATHRA_TTS_MODEL } : {}),
    ...(env.OATHRA_TTS_VOICE ? { voice: env.OATHRA_TTS_VOICE } : {}),
  });
}
