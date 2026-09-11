import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import YAML from "yaml";
import { defineCall, type CallContract } from "@oathra/contract";
import { ScenarioSchema, type Scenario, type ScenarioInput } from "./schema.js";

export * from "./schema.js";

export type ValidationIssue = { path: string; message: string };

export type ValidationResult =
  | { ok: true; scenario: Scenario }
  | { ok: false; issues: ValidationIssue[] };

/** Validate a parsed YAML/JSON object. Never throws. */
export function validateScenario(input: unknown): ValidationResult {
  const r = ScenarioSchema.safeParse(input);
  if (r.success) {
    const extra = semanticChecks(r.data);
    if (extra.length) return { ok: false, issues: extra };
    return { ok: true, scenario: r.data };
  }
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
  };
}

/** Checks the schema cannot express: win fields must be required or constrained, etc. */
function semanticChecks(s: Scenario): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of Object.keys(s.win)) {
    if (!s.mission.require[field] && !s.mission.constraints[field]) {
      issues.push({
        path: `win.${field}`,
        message: `win condition on "${field}" but mission.require/constraints do not mention it`,
      });
    }
  }
  if (s.domain === "hotel" || s.domain === "shop") {
    const k = s.callee.knowledge;
    if (typeof k.standard_price === "number" && typeof k.minimum_price === "number" && k.minimum_price > k.standard_price) {
      issues.push({ path: "callee.knowledge.minimum_price", message: "minimum_price exceeds standard_price" });
    }
  }
  return issues;
}

export function parseScenario(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (e) {
    return { ok: false, issues: [{ path: "(yaml)", message: (e as Error).message }] };
  }
  return validateScenario(parsed);
}

export function loadScenarioFile(path: string): Scenario {
  const r = parseScenario(readFileSync(path, "utf8"));
  if (!r.ok) {
    throw new Error(`Invalid scenario ${path}:\n` + r.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n"));
  }
  return r.scenario;
}

/** Load every *.yaml under a directory (recursively). */
export function loadScenarioDir(dir: string): Scenario[] {
  const out: Scenario[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ya?ml$/.test(name)) out.push(loadScenarioFile(p));
    }
  };
  walk(dir);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function defineScenario(input: ScenarioInput): Scenario {
  const r = validateScenario(input);
  if (!r.ok) throw new Error(r.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  return r.scenario;
}

/** Derive the CallContract the agent runs under for a scenario. */
export function contractFromScenario(s: Scenario): CallContract {
  return defineCall({
    goal: s.mission.objective,
    target: { scenario: s.id, name: s.callee.persona.name },
    input: s.mission.input,
    require: s.mission.require,
    constraints: s.mission.constraints,
    permissions: s.mission.permissions,
    language: s.language,
  });
}

export function scenarioIdFromPath(path: string): string {
  return basename(path).replace(/\.ya?ml$/, "");
}
