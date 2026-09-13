import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contractFromScenario, loadScenarioFile } from "@oathra/scenario";
import { verifyTranscript } from "./transcript.js";

// Replay the existing public GPT-4o mini/simulator recording. No generated
// utterances or network stand-ins. This checks replay fidelity, not PSTN quality.
const recording = JSON.parse(readFileSync(new URL("../../../site/data/call-gpt4o-mini.json", import.meta.url), "utf8"));
const contract = contractFromScenario(loadScenarioFile(new URL("../../../scenarios/hotel/impossible-hotel.yaml", import.meta.url).pathname));
const utterances = recording.events.flatMap((event: { type: string; source?: string; text?: string; t: number }, index: number) =>
  event.type === "transcript.final" ? [{ id: `recorded-${index}`, source: event.source, text: event.text, t: event.t }] : []);
const input = { contract, referenceDate: "2026-09-11", connection: "completed", utterances };

describe("verifyTranscript with the recorded hotel negotiation", () => {
  it("reproduces the recorded fields through the public checker", () => {
    const result = verifyTranscript(input);
    const original = recording.events.findLast((event: { type: string }) => event.type === "result");
    expect(result.status).toBe(original.status);
    expect(result.fields).toEqual(original.fields);
  });

  it("does not complete the actual prefix before the hotel's confirmation", () => {
    const confirmation = recording.events.find((event: { type: string; field?: string }) => event.type === "evidence.verified" && event.field === "confirmed");
    const result = verifyTranscript({ ...input, utterances: utterances.filter((u: { t: number }) => u.t < confirmation.t) });
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("confirmed");
  });
});
