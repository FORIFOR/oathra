// Convert the existing public model/simulator run to the standalone check format.
// It is not a real phone call or a new reliability benchmark.
import { readFileSync } from "node:fs";
import { loadScenarioFile, contractFromScenario } from "../packages/scenario/dist/index.js";
const recording = JSON.parse(readFileSync(new URL("../site/data/call-gpt4o-mini.json", import.meta.url), "utf8"));
const scenario = loadScenarioFile(new URL("../scenarios/hotel/impossible-hotel.yaml", import.meta.url).pathname);
console.log(JSON.stringify({
  contract: contractFromScenario(scenario),
  referenceDate: "2026-09-11",
  connection: recording.events.some((event) => event.type === "call.ended") ? "completed" : "active",
  utterances: recording.events.flatMap((event, index) => event.type === "transcript.final"
    ? [{ id: `recorded-${index}`, source: event.source, text: event.text, t: event.t }]
    : []),
}, null, 2));
