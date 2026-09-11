// Local end-to-end without Twilio: synthesized callee speech -> GPT-Live (responses delegation) -> expect audio, a web_search answer, and end_call.
import { OpenAILiveAgent } from "../dist/index.js";
import { OpenAITTS } from "../../openai/dist/index.js";
import { defineCall } from "../../../packages/contract/dist/index.js";
import { mulawSilence } from "../../audio-kit/dist/index.js";
const contract = defineCall({ goal: "chat.casual", input: { topic: "最近ハマっていること" }, permissions: { ask: true } });
const agent = new OpenAILiveAgent({ contract, model: process.argv[2] ?? "gpt-live-1" });
const t0 = Date.now(); const events = []; let outBytes = 0;
await agent.connect({ sendAudio: (b) => { outBytes += b.length; }, clearAudio: () => {}, emit: (e) => events.push({ at: Date.now() - t0, ...e }), now: () => Date.now() - t0 });
console.log("session started", Date.now() - t0, "ms");
const tts = new OpenAITTS();
const say = async (text) => {
  const speech = await tts.synthesizeMulaw8k(text, { language: "ja" });
  for (let i = 0; i < speech.length; i += 160) { agent.pushAudio(speech.subarray(i, i + 160)); await new Promise((r) => setTimeout(r, 20)); }
  console.log(`  [callee said] ${text} @${Date.now() - t0}`);
};
const silence = async (ms) => { for (let i = 0; i < ms / 20; i++) { agent.pushAudio(mulawSilence(20)); await new Promise((r) => setTimeout(r, 20)); } };
await silence(400);
await say("もしもし、久しぶり。最近のAIのニュースで何か面白いのあった？調べて教えて。");
await silence(14000);
await say("ありがとう。じゃあね、バイバイ。");
await silence(9000);
agent.close();
await new Promise((r) => setTimeout(r, 800));
console.log(`model audio ${Math.round(outBytes / 8)} ms`);
for (const e of events) console.log(" ", e.at, e.type, (e.text ?? e.message ?? e.reason ?? "").slice(0, 120));
