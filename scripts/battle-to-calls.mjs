// Re-enacts the calls of a saved `oathra battle --json` run through the real runtime, so the
// Arena can replay them with real evidence/mission events. The caller lines and the callee lines
// are the recorded ones; the evidence engine is the real one; nothing is generated. ¥0.
// usage: pnpm build && node scripts/battle-to-calls.mjs video/.work/battle.json scenarios/hotel/impossible-hotel.yaml
import { readFileSync } from "node:fs";
import { saveCall } from "../packages/replay/dist/index.js";
import { runCall } from "../packages/runtime/dist/index.js";
import { contractFromScenario, loadScenarioFile } from "../packages/scenario/dist/index.js";
import { SimulatorTransport } from "../providers/simulator/dist/index.js";

const [, , jsonPath = "video/.work/battle.json", scenarioPath = "scenarios/hotel/impossible-hotel.yaml"] = process.argv;
const data = JSON.parse(readFileSync(jsonPath, "utf8"));
const scenario = loadScenarioFile(scenarioPath);
const contract = contractFromScenario(scenario);
const knowledgeNow = scenario.callee.knowledge.now;
const now = typeof knowledgeNow === "string" ? new Date(knowledgeNow) : new Date();

for (const entry of data.entries) {
  const caller = entry.transcript.filter((l) => l.source === "caller").map((l) => l.text);
  const callee = entry.transcript.filter((l) => l.source === "callee").map((l) => l.text);
  let ci = 0, ki = 1;
  const brain = {
    name: entry.brain,
    async respond() { const text = caller[ci++] ?? ""; return { text, action: ci >= caller.length ? "hangup" : "continue" }; },
  };
  const character = {
    name: scenario.callee.persona.name,
    greeting: () => callee[0],
    respond: () => ({ text: callee[ki++] ?? "……" }),
    truth: () => (entry.success ? { confirmed: true, ...entry.fields } : { confirmed: false }),
  };
  const transport = new SimulatorTransport({ scenario, pace: "fast", character });
  const slug = entry.brain.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const outcome = await runCall({ contract, transport, brain, now, scenarioId: scenario.id, openingTimeoutMs: 50, callId: `battle_${slug}` });
  const dir = saveCall(outcome);
  console.log(`${entry.brain}: ${outcome.result.status} confirmed=${String(outcome.result.fields.confirmed)} price=${String(outcome.result.fields.price)} turns=${outcome.transcript.length} -> ${dir}`);
}
