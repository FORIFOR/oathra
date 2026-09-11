import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadScenarioDir } from "@oathra/scenario";
import { ScriptedAgent } from "@oathra/simulator";
import { evalScenarios, detectFalseCompletion } from "./index.js";
import type { CallOutcome } from "@oathra/runtime";

const scenarios = loadScenarioDir(resolve(import.meta.dirname, "../../../scenarios")).filter((s) => s.domain !== "generic");

describe("eval", () => {
  it("runs every official scenario with zero false completions", async () => {
    const s = await evalScenarios(scenarios, () => new ScriptedAgent());
    expect(s.total).toBe(scenarios.length);
    expect(s.falseCompletions).toBe(0);
    // Every non-adversarial scenario should complete with the scripted baseline.
    for (const r of s.runs) {
      const adversarial = r.scenario.tags.includes("adversarial");
      expect(r.outcome.result.complete, r.scenario.id).toBe(!adversarial);
    }
  });

  it("gives every run a fresh brain (per-call state must not leak across runs)", async () => {
    // Regression: a reused ScriptedAgent carried its price-negotiation counter
    // from bulk-buy into impossible-hotel and walked away after 3 runs.
    const s = await evalScenarios(scenarios, () => new ScriptedAgent(), { runs: 3 });
    const hotel = s.runs.filter((r) => r.scenario.id === "impossible-hotel");
    expect(hotel).toHaveLength(3);
    for (const r of hotel) expect(r.outcome.result.complete).toBe(true);
    expect(s.falseCompletions).toBe(0);
  });

  it("flags a fabricated completion as false", () => {
    const outcome = { result: { complete: true, fields: { confirmed: true, time: "19:30" } } } as unknown as CallOutcome;
    const d = detectFalseCompletion(outcome, { confirmed: false });
    expect(d.falseCompletion).toBe(true);
    expect(d.disagreements).toContain("confirmed");
  });
});
