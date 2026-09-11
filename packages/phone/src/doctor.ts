import type { DoctorCheck, DoctorReport, DoctorSection } from "./types.js";

export function section(name: string, checks: DoctorCheck[]): DoctorSection {
  return { name, checks };
}

export function check(label: string, ok: boolean, extra: Partial<DoctorCheck> = {}): DoctorCheck {
  return { label, ok, ...extra };
}

export function skipped(label: string, detail: string): DoctorCheck {
  return { label, ok: true, skipped: true, detail };
}

export function reportReady(r: Omit<DoctorReport, "ready">): DoctorReport {
  const ready = r.sections.every((s) => s.checks.every((c) => c.ok || c.skipped));
  return { ...r, ready };
}

/** Plain-text rendering shared by the CLI and the Arena. */
export function renderDoctor(r: DoctorReport, opts: { color?: (s: string, kind: "ok" | "bad" | "dim") => string } = {}): string {
  const c = opts.color ?? ((s) => s);
  const lines: string[] = ["PHONE STACK", ""];
  for (const s of r.sections) {
    lines.push(s.name);
    for (const ch of s.checks) {
      const mark = ch.skipped ? c("·", "dim") : ch.ok ? c("✓", "ok") : c("✗", "bad");
      lines.push(`  ${mark} ${ch.label}${ch.detail ? c(`  ${ch.detail}`, "dim") : ""}`);
      if (!ch.ok && ch.fix) lines.push(`      ${c(`Fix: ${ch.fix}`, "dim")}`);
    }
    lines.push("");
  }
  if (r.latency.length) {
    lines.push("Latency");
    const w = Math.max(...r.latency.map((l) => l.hop.length));
    for (const l of r.latency) lines.push(`  ${l.hop.padEnd(w)}  ${String(Math.round(l.ms)).padStart(5)} ms`);
    const total = r.latency.reduce((a, l) => a + l.ms, 0);
    lines.push(`  ${"Estimated path".padEnd(w)}  ${String(Math.round(total)).padStart(5)} ms`, "");
  }
  if (r.cost) {
    lines.push("Cost", `  Destination  ${r.cost.destination}`, `  Carrier      ${r.cost.provider}`, `  Rate         ${r.cost.currency === "USD" ? "$" : "¥"}${r.cost.ratePerMin}/min${r.cost.note ? c(`  (${r.cost.note})`, "dim") : ""}`, "");
  }
  lines.push(r.ready ? c("READY ✓", "ok") : c("NOT READY", "bad"));
  return lines.join("\n");
}
