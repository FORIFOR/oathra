// Opens a Realtime session with the Oathra config and closes it. No audio is sent.
// usage: node --env-file=.env providers/openai-realtime/scripts/handshake.mjs [model]
import { OpenAIRealtimeAgent } from "../dist/index.js";
import { defineCall } from "../../../packages/contract/dist/index.js";
const model = process.argv[2] ?? "gpt-live-1";
const contract = defineCall({ goal: "restaurant.reservation", input: { date: "2026-09-12", partySize: 2 }, require: { date: true, time: true, partySize: true, confirmed: true }, constraints: { time: { gte: "19:00" } }, permissions: { ask: true, reserve: true, share_name: true } });
const agent = new OpenAIRealtimeAgent({ contract, model, calleeName: "テスト" });
const t0 = Date.now();
const events = [];
try {
  await agent.connect({ sendAudio: () => {}, clearAudio: () => {}, emit: (e) => events.push(e), now: () => Date.now() - t0 });
  console.log(`✓ ${model}: session.updated in ${Date.now() - t0} ms`);
} catch (e) {
  console.log(`✗ ${model}: ${e.message}`);
}
await new Promise((r) => setTimeout(r, 500));
for (const e of events) console.log("  event", JSON.stringify(e).slice(0, 300));
agent.close();
