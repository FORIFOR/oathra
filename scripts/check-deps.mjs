// Dependency direction lint: contract -> evidence -> core -> scenario -> runtime -> providers -> replay/eval -> apps -> cli
// A package may only depend on packages at a lower layer. Fails CI otherwise.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const LAYER = {
  "@oathra/contract": 0,
  "@oathra/evidence": 1,
  "@oathra/core": 2,
  "@oathra/scenario": 3,
  "@oathra/runtime": 4,
  "@oathra/simulator": 5,
  "@oathra/brain-kit": 4.5,
  "@oathra/audio-kit": 3.5,
  "@oathra/deepgram": 5,
  "@oathra/voice": 3.8,
  "@oathra/phone": 4.6,
  "@oathra/openai-realtime": 5,
  "@oathra/voice-pipeline": 5.5,
  "@oathra/phone-twilio": 5.5,
  "@oathra/phone-sip": 5.5,
  "@oathra/phone-plivo": 5.6,
  "@oathra/gateway-livekit": 5.5,
  "@oathra/openai": 5,
  "@oathra/gemini": 5,
  "@oathra/ollama": 5,
  "@oathra/replay": 6,
  "@oathra/eval": 6,
  "@oathra/arena": 7,
  oathra: 8,
};

let failed = false;
for (const root of ["packages", "providers", "apps"]) {
  for (const dir of readdirSync(root)) {
    const p = join(root, dir, "package.json");
    if (!existsSync(p)) continue;
    const pkg = JSON.parse(readFileSync(p, "utf8"));
    const mine = LAYER[pkg.name];
    if (mine === undefined) {
      console.error(`✗ ${pkg.name}: not assigned to a layer in scripts/check-deps.mjs`);
      failed = true;
      continue;
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
    for (const d of Object.keys(deps)) {
      if (!d.startsWith("@oathra/") && d !== "oathra") continue;
      const theirs = LAYER[d];
      if (theirs === undefined || theirs >= mine) {
        console.error(`✗ ${pkg.name} (layer ${mine}) must not depend on ${d} (layer ${theirs})`);
        failed = true;
      }
    }
    // Source-level check: no imports from a higher layer even via relative paths.
    const src = join(root, dir, "src");
    if (existsSync(src)) {
      const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [join(d, e.name)] : []));
      for (const f of walk(src)) {
        const text = readFileSync(f, "utf8");
        for (const m of text.matchAll(/from\s+"(@oathra\/[a-z-]+|oathra)"/g)) {
          const theirs = LAYER[m[1]];
          if (theirs === undefined || theirs >= mine) {
            console.error(`✗ ${f}: imports ${m[1]} from a higher or equal layer`);
            failed = true;
          }
        }
      }
    }
  }
}
if (failed) process.exit(1);
console.log("✓ dependency direction ok");
