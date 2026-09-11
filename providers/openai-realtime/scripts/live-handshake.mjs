// Opens a GPT-Live session with the Oathra config and closes it. No audio is sent.
import { OpenAILiveAgent } from "../dist/index.js";
import { defineCall } from "../../../packages/contract/dist/index.js";
const model = process.argv[2] ?? "gpt-live-1";
const contract = defineCall({ goal: "chat.casual", input: { topic: "最近ハマっていること" }, permissions: { ask: true } });
const agent = new OpenAILiveAgent({ contract, model });
const t0 = Date.now(); const events = [];
try {
  await agent.connect({ sendAudio: () => {}, clearAudio: () => {}, emit: (e) => events.push(e), now: () => Date.now() - t0 });
  console.log(`✓ ${model}: session.started in ${Date.now() - t0} ms`);
} catch (e) { console.log(`✗ ${model}: ${e.message}`); }
await new Promise((r) => setTimeout(r, 800));
for (const e of events) console.log("  event", JSON.stringify(e).slice(0, 300));
agent.close();
await new Promise((r) => setTimeout(r, 600));
