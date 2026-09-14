import type { CallEvent } from "@oathra/core";
import type { CallOutcome } from "@oathra/runtime";
import type { OathraScore } from "@oathra/eval";
import type { Scenario } from "@oathra/scenario";
import { bold, box, cyan, dim, green, mmss, red, yellow } from "./ui.js";

/** Live terminal rendering of a call as events arrive. */
export function liveRenderer(scenario: Scenario, opts: { quiet?: boolean } = {}) {
  const calleeName = scenario.callee.persona.name;
  return (e: CallEvent) => {
    switch (e.type) {
      case "call.connected":
        console.log(`${dim(mmss(e.t))}  📞 ${dim("connected")}  ${e.callee ?? calleeName}\n`);
        break;
      case "transcript.final": {
        const who = e.source === "caller" ? cyan("Agent ") : bold("Callee");
        console.log(`${dim(mmss(e.t))}  ${who}  ${e.text}`);
        break;
      }
      case "evidence.verified":
        if (!opts.quiet) console.log(`${dim(mmss(e.t))}  ${green("✓")} ${dim(`${e.evidence.field} = ${JSON.stringify(e.evidence.value)}`)}`);
        break;
      case "permission.requested":
        console.log(`${dim(mmss(e.t))}  ${yellow("permission?")} ${e.action}: ${e.detail}`);
        break;
      case "error":
        console.log(`${dim(mmss(e.t))}  ${red("error")} ${e.message}`);
        break;
      default:
        break;
    }
  };
}

export function resultBox(outcome: CallOutcome, score?: OathraScore): string {
  const r = outcome.result;
  const required = Object.entries(outcome.contract.require).filter(([, v]) => v).map(([k]) => k);
  if (required.length === 0) {
    // Nothing to verify (e.g. a casual chat): report the call, not a mission.
    const p50 = outcome.metrics.latency.ttfaP50Ms;
    return box([
      bold("CALL ENDED"),
      "",
      `Turns: ${outcome.metrics.turns}   Duration: ${mmss(outcome.metrics.durationMs)}`,
      `Reply latency (transcript-based): ${p50 !== undefined ? `${p50}ms p50` : "n/a"}`,
      `Ended: ${outcome.endReason}`,
    ]);
  }
  const title =
    r.status === "completed" ? green("MISSION COMPLETE")
      : r.status === "constraint_violation" ? red("CONSTRAINT VIOLATION")
        : r.status === "failed" ? red("FAILED")
          : yellow("INCOMPLETE");
  const lines: string[] = [title, ""];
  for (const f of required) {
    const v = r.fields[f];
    lines.push(v === undefined ? `${dim("·")} ${f}${dim("  (missing)")}` : `${green("✓")} ${f.padEnd(12)} ${String(v)}`);
  }
  for (const v of r.constraints.violations) lines.push(`${red("✗")} ${v.field} ${String(v.rule)} ${JSON.stringify(v.expected)} (got ${JSON.stringify(v.actual)})`);
  lines.push("");
  lines.push(r.complete ? bold("VERIFIED") : dim("NOT VERIFIED"));
  lines.push(`Evidence: ${r.evidence.filter((e) => e.verified).length}`);
  // Calls saved before consent-based intake was introduced have no intake
  // record. Replay should still render their verified decisions normally.
  if (outcome.intake && outcome.intake.status !== "disabled") {
    lines.push(`Optional intake: ${outcome.intake.status} · ${outcome.intake.answers.length} answer(s)`);
    if (outcome.intake.answers.length) lines.push(`Profile: ${outcome.intake.answers.map((a) => `${a.key}=${a.value}`).join(", ")}`);
    if (outcome.intake.skipped?.length) lines.push(`Skipped: ${outcome.intake.skipped.join(", ")}`);
  }
  lines.push(`Confidence: ${r.confidence.toFixed(3)}`);
  const p50 = outcome.metrics.latency.ttfaP50Ms;
  lines.push(`Latency: ${p50 !== undefined ? `${p50}ms p50` : "n/a"}`);
  lines.push(`Turns: ${outcome.metrics.turns}   Duration: ${mmss(outcome.metrics.durationMs)}`);
  if (score) {
    lines.push("");
    lines.push(`${dim("Oathra Score")}  ${score.overall}`);
    lines.push(`${dim("Outcome")} ${String(score.outcome).padStart(3)}  ${dim("Evidence")} ${String(score.evidence).padStart(3)}  ${dim("Conv.")} ${String(score.conversation).padStart(3)}  ${dim("Latency")} ${String(score.latency).padStart(3)}  ${dim("Eff.")} ${String(score.efficiency).padStart(3)}`);
    lines.push(score.falseCompletion ? red(`False Completion: YES (${score.disagreements.join(", ")})`) : `False Completion: 0`);
  }
  return box(lines);
}
