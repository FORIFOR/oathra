import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { startArena } from "@oathra/arena";
import { battle, COMPLETABLE, evalScenarios, MUTATIONS, renderBattleMarkdown, renderBattleSvg, runAdversarial, runScenario } from "@oathra/eval";
import { listCalls, loadCall, renderTimeline, saveCall, snapshotAt } from "@oathra/replay";
import { loadScenarioDir, loadScenarioFile, parseScenario, type Scenario } from "@oathra/scenario";
import { brains, listBrains, resolveBrain } from "./brains.js";
import { resolveCallee } from "./callee.js";
import { phoneDoctor, phoneAdd, phoneList, phoneRemove, phoneTest, providerCreate, runPhoneCall, setupPhone } from "./phone.js";
import { arenaPublicDir, scenariosDir } from "./paths.js";
import { liveRenderer, resultBox } from "./render.js";
import { bad, bold, box, cyan, dim, green, mmss, ok, table, warn, yellow } from "./ui.js";

export type Flags = Record<string, string | boolean | string[]>;

export function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const value = next !== undefined && !next.startsWith("--") ? (i++, next) : true;
      const prev = flags[key];
      if (prev === undefined) flags[key] = value;
      else if (Array.isArray(prev)) prev.push(String(value));
      else flags[key] = [String(prev), String(value)];
    } else positional.push(a);
  }
  return { positional, flags };
}

const str = (v: Flags[string] | undefined, d?: string): string | undefined => (typeof v === "string" ? v : Array.isArray(v) ? v[0] : d);
const num = (v: Flags[string] | undefined, d: number): number => (typeof v === "string" && !Number.isNaN(Number(v)) ? Number(v) : d);
const list = (v: Flags[string] | undefined): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []);

function findScenario(idOrPath: string | undefined, fallback = "restaurant-reservation"): Scenario {
  const want = idOrPath ?? fallback;
  if (existsSync(want) && /\.ya?ml$/.test(want)) return loadScenarioFile(resolve(want));
  const all = loadScenarioDir(scenariosDir());
  const s = all.find((x) => x.id === want);
  if (!s) throw new Error(`Scenario "${want}" not found. Available: ${all.map((x) => x.id).join(", ")}`);
  return s;
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------

export async function cmdDemo(flags: Flags): Promise<void> {
  console.log(`\n${bold("Oathra")}\n`);
  console.log(ok(`Runtime        Node ${process.version}`));
  console.log(ok("Simulator      built-in characters, no API key needed"));
  const scenarios = loadScenarioDir(scenariosDir());
  console.log(ok(`Scenarios      ${scenarios.length}`));
  const port = num(flags.port, 4242);
  const arena = await startArena({ scenariosDir: scenariosDir(), publicDir: arenaPublicDir(), brains, port, host: str(flags.host, "127.0.0.1") ?? "127.0.0.1" });
  console.log(ok(`Arena          ${arena.url}`));
  console.log(`\nOpening Arena...\n\n  ${cyan(arena.url)}\n`);
  if (!flags["no-open"]) openBrowser(arena.url);
  console.log(dim("Watch two agents on a call, or choose Play and answer the phone yourself. Ctrl+C stops the server.\n"));
  await new Promise<void>((res) => {
    process.on("SIGINT", () => {
      void arena.close().then(res);
    });
  });
}

export async function cmdPlay(positional: string[], flags: Flags): Promise<void> {
  const scenario = findScenario(positional[0]);
  const brain = resolveBrain(str(flags.brain, "scripted")!);
  const fast = Boolean(flags.fast);
  console.log(`\n${bold(scenario.title)}  ${dim(`(${scenario.difficulty} · ${scenario.domain} · ${brain.name})`)}`);
  if (scenario.mission.brief) console.log(dim(scenario.mission.brief));
  console.log("");
  const run = await runScenario(scenario, {
    brain,
    pace: fast ? "fast" : "realtime",
    seed: num(flags.seed, scenario.seed),
    onEvent: liveRenderer(scenario, { quiet: Boolean(flags.quiet) }),
  });
  console.log("");
  console.log(resultBox(run.outcome, run.score));
  if (flags.save !== false && !flags["no-save"]) {
    const dir = saveCall(run.outcome);
    console.log(dim(`\nSaved: ${dir}\n  oathra replay ${run.outcome.callId}`));
  }
  if (flags.json) console.log(JSON.stringify({ result: run.outcome.result, intake: run.outcome.intake, metrics: run.outcome.metrics, score: run.score }, null, 2));
}

export async function cmdCall(_positional: string[], flags: Flags): Promise<void> {
  await runPhoneCall({
    ...(str(flags.to) ? { to: str(flags.to)! } : {}),
    ...(str(flags.scenario) ? { scenario: str(flags.scenario)! } : {}),
    ...(str(flags.engine) ? { engine: str(flags.engine)! } : {}),
    ...(str(flags.brain) ? { brain: str(flags.brain)! } : {}),
    ...(str(flags.provider) ? { provider: str(flags.provider)! } : {}),
    ...(str(flags.port) ? { port: num(flags.port, 4243) } : {}),
    ...(str(flags["public-url"]) ? { publicUrl: str(flags["public-url"])! } : {}),
    ...(str(flags.name) ? { name: str(flags.name)! } : {}),
    ...(flags["no-save"] ? { noSave: true } : {}),
  });
}

export async function cmdPhone(positional: string[], flags: Flags): Promise<void> {
  const sub = positional[0] ?? "list";
  switch (sub) {
    case "add": return phoneAdd(positional[1], flags);
    case "list": return phoneList();
    case "remove": return phoneRemove(positional[1]);
    case "doctor": {
      const ready = await phoneDoctor({ ...(str(flags.provider) ? { provider: str(flags.provider)! } : {}), ...(str(flags.to) ? { to: str(flags.to)! } : {}), ...(str(flags.engine) ? { engine: str(flags.engine)! } : {}) });
      if (!ready) process.exitCode = 1;
      return;
    }
    case "test":
      return phoneTest({ ...(str(flags.level) ? { level: str(flags.level)! } : {}), ...(str(flags.provider) ? { provider: str(flags.provider)! } : {}), ...(str(flags.to) ? { to: str(flags.to)! } : {}), ...(str(flags.engine) ? { engine: str(flags.engine)! } : {}), ...(str(flags.scenario) ? { scenario: str(flags.scenario)! } : {}) });
    default:
      throw new Error(`unknown phone subcommand "${sub}" (add | list | doctor | test | remove)`);
  }
}

export async function cmdSetup(positional: string[], flags: Flags): Promise<void> {
  if ((positional[0] ?? "phone") !== "phone") throw new Error("usage: oathra setup phone");
  await setupPhone(flags);
}

export async function cmdProvider(positional: string[], _flags: Flags): Promise<void> {
  if (positional[0] !== "create") throw new Error("usage: oathra provider create phone <id>");
  providerCreate(positional[1], positional[2]);
}

export async function cmdReplay(positional: string[], flags: Flags): Promise<void> {
  const id = positional[0];
  if (!id) {
    const calls = listCalls();
    if (!calls.length) {
      console.log(dim("No saved calls. Run `oathra play` first."));
      return;
    }
    console.log(bold("Saved calls\n"));
    for (const c of calls.slice(-20)) {
      try {
        const rec = loadCall(c);
        const started = rec.events.find((e) => e.type === "call.started");
        const scen = started && started.type === "call.started" ? started.scenario ?? "-" : "-";
        console.log(`${c}  ${scen.padEnd(28)} ${rec.result.status.padEnd(20)} ${mmss(rec.metrics.durationMs)}`);
      } catch {
        console.log(`${c}  ${dim("(unreadable)")}`);
      }
    }
    return;
  }
  const rec = loadCall(id);
  const at = str(flags.at);
  if (at !== undefined) {
    const t = /^\d+$/.test(at) ? Number(at) : parseMmSs(at);
    const snap = snapshotAt(rec.events, t);
    console.log(bold(`${mmss(t)}  state ${snap.agentState} (${snap.ux})\n`));
    for (const turn of snap.transcript) console.log(`${turn.source === "caller" ? cyan("Agent ") : bold("Callee")}  ${turn.text}`);
    console.log(`\n${dim("verified")} ${JSON.stringify(snap.verified)}\n${dim("pending ")} ${JSON.stringify(snap.pending)}`);
    if (snap.lastTrace) console.log(`${dim("last ttfa")} ${snap.lastTrace.ttfaMs ?? "?"} ms`);
    return;
  }
  console.log(bold(`Replay ${rec.callId}\n`));
  for (const line of renderTimeline(rec.events)) {
    if (!flags.verbose && /  state  /.test(line)) continue;
    console.log(line);
  }
  console.log("");
  console.log(resultBox({ ...rec, endReason: "completed", contract: rec.contract, events: rec.events, traces: rec.traces } as never));
}

function parseMmSs(s: string): number {
  const m = /^(\d+):(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`bad time "${s}" (use ms or mm:ss.mmm)`);
  return Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number((m[3] ?? "0").padEnd(3, "0"));
}

export async function cmdEval(positional: string[], flags: Flags): Promise<void> {
  const dir = positional[0] ? resolve(positional[0]) : scenariosDir();
  // Scenarios without a scripted character (domain "generic") are real-call only.
  const scenarios = loadScenarioDir(dir).filter((s) => s.domain !== "generic");
  const brainName = str(flags.brain, "scripted")!;
  const brain = () => resolveBrain(brainName);
  const runs = num(flags.runs, 1);
  if (flags.adversarial !== undefined) return cmdEvalAdversarial(scenarios, brain, brainName, flags);
  const calleeSpec = str(flags.callee);
  const character = calleeSpec ? resolveCallee(calleeSpec) : undefined;
  console.log(`\n${bold("Oathra Eval")}  ${dim(`${scenarios.length} scenarios × ${runs} runs · brain=${brainName}${calleeSpec ? ` · callee=${calleeSpec}` : ""}`)}\n`);
  const rows: string[][] = [["Scenario", "Status", "Callee says", "Score", "TTFA p50", "Turns", "FalseComp"]];
  const notes: string[] = [];
  const summary = await evalScenarios(scenarios, brain, {
    runs,
    ...(character ? { character } : {}),
    onRun: (r) => {
      const status = r.outcome.result.complete ? green("completed") : yellow(r.outcome.result.status);
      const says = r.truth?.confirmed === true ? "confirmed" : r.truth?.confirmed === false ? "not confirmed" : "-";
      const missed = r.truth?.confirmed === true && !r.outcome.result.complete;
      rows.push([
        r.scenario.id,
        status,
        missed ? yellow(says) : says,
        String(r.score.overall),
        `${r.outcome.metrics.latency.ttfaP50Ms ?? "-"} ms`,
        String(r.outcome.metrics.turns),
        r.score.falseCompletion ? bad("YES " + r.score.disagreements.join(",")) : green("0"),
      ]);
      if (r.score.falseCompletion || missed) {
        const why = r.score.falseCompletion ? `false completion on ${r.score.disagreements.join(", ")}` : `callee says confirmed but result is ${r.outcome.result.status} (missing: ${r.outcome.result.missing.join(", ") || "-"})`;
        notes.push(`${bold(r.scenario.id)}: ${why}\n  truth  ${JSON.stringify(r.truth)}\n  fields ${JSON.stringify(r.outcome.result.fields)}\n` + r.outcome.transcript.slice(-6).map((t) => `  ${t.source === "callee" ? "▸" : " "} ${t.text}`).join("\n"));
      }
    },
  });
  console.log(table(rows, ["l", "l", "r", "r", "r", "l"]));
  console.log("");
  console.log(
    box([
      `${dim("Completed")}          ${summary.completed} / ${summary.total}`,
      `${dim("Mean score")}         ${summary.meanOverall}`,
      `${dim("TTFA p50 (mean)")}    ${summary.ttfaP50Ms ?? "-"} ms`,
      summary.falseCompletions === 0 ? green(`False Completion   0`) : bad(`False Completion   ${summary.falseCompletions}`),
    ]),
  );
  if (notes.length) console.log("\n" + notes.join("\n\n") + "\n");
  if (flags.json) console.log(JSON.stringify(summary.runs.map((r) => ({ scenario: r.scenario.id, brain: r.brain, callee: calleeSpec ?? "scripted", status: r.outcome.result.status, fields: r.outcome.result.fields, missing: r.outcome.result.missing, truth: r.truth, score: r.score, metrics: r.outcome.metrics, transcript: r.outcome.transcript.map((t) => ({ source: t.source, text: t.text, t: t.t })) })), null, 2));
  if (summary.falseCompletions > 0) process.exitCode = 1;
}

/**
 * `oathra eval --adversarial N [--seed s]`: every scripted callee is wrapped
 * with a mutation designed to trick the evidence engine. The only number that
 * matters is the last line.
 */
async function cmdEvalAdversarial(scenarios: Scenario[], brain: () => import("@oathra/core").BrainProvider, brainName: string, flags: Flags): Promise<void> {
  const runs = num(flags.adversarial, 1000);
  const seed = num(flags.seed, 1);
  console.log(`\n${bold("Oathra Adversarial Eval")}  ${dim(`${runs} runs · ${scenarios.length} scenarios × ${MUTATIONS.length} mutations · brain=${brainName} · seed=${seed}`)}\n`);
  const started = Date.now();
  let done = 0;
  const tick = Math.max(1, Math.floor(runs / 20));
  const summary = await runAdversarial(scenarios, brain, {
    runs,
    seed,
    onRun: () => {
      done++;
      if (process.stdout.isTTY && done % tick === 0) process.stdout.write(`\r${dim(`${done}/${runs}`)}`);
    },
  });
  if (process.stdout.isTTY) process.stdout.write("\r");
  const rows: string[][] = [["Mutation", "Runs", "Completed", "FalseComp"]];
  for (const [m, st] of Object.entries(summary.byMutation)) {
    rows.push([m, String(st.runs), String(st.completed), st.falseCompletions === 0 ? green("0") : bad(String(st.falseCompletions))]);
  }
  console.log(table(rows, ["l", "r", "r", "r"]));
  console.log("");
  for (const leak of summary.leaks.slice(0, 5)) {
    console.log(bad(`${leak.scenario} · ${leak.mutation} · seed ${leak.seed} · disagrees on ${leak.disagreements.join(", ")}`));
    for (const line of leak.transcript) console.log(`    ${dim(line)}`);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const line = `False Completion: ${summary.falseCompletions} / ${summary.total} adversarial runs`;
  console.log(box([summary.falseCompletions === 0 ? green(line) : bad(line), dim(`${secs}s · completed ${summary.completed} (expected to complete: ${COMPLETABLE.join(", ")})`)]));
  if (flags.json) console.log(JSON.stringify({ total: summary.total, falseCompletions: summary.falseCompletions, byMutation: summary.byMutation, leaks: summary.leaks }, null, 2));
  if (summary.falseCompletions > 0) process.exitCode = 1;
}

export async function cmdBattle(positional: string[], flags: Flags): Promise<void> {
  const scenario = findScenario(positional[0], "impossible-hotel");
  const names = list(flags.agent);
  const chosen = names.length ? names : Object.keys(brains);
  const providers = chosen.map((n) => () => resolveBrain(n));
  console.log(`\n${bold(scenario.title)}\n${"━".repeat(40)}\n`);
  const entries = await battle(scenario, providers, { seed: num(flags.seed, scenario.seed) });
  const max = Math.max(1, ...entries.map((e) => Math.abs(e.points)));
  for (const e of entries) {
    const barLen = Math.max(0, Math.round((e.points / max) * 20));
    console.log(`${e.brain.padEnd(12)} ${"█".repeat(barLen).padEnd(20)} ${String(e.points).padStart(7)}`);
  }
  console.log("");
  console.log(table([["", "SUCCESS", "TIME", "COST", "SCORE"], ...entries.map((e) => [e.brain, e.success ? green("✓") : bad(" "), `${(e.durationMs / 1000).toFixed(0)}s`, `$${e.costUsd.toFixed(2)}`, String(e.overall)])], ["l", "l", "r", "r", "r"]));
  const fc = entries.filter((e) => e.falseCompletion).length;
  console.log(`\n${fc === 0 ? green("False completions: 0") : bad(`False completions: ${fc}`)}`);
  if (chosen.length === 1) console.log(dim("\nTip: compare real models — oathra battle impossible-hotel --agent scripted --agent openai --agent gemini --agent ollama:qwen2.5:7b"));
  if (flags.markdown) console.log(`\n${renderBattleMarkdown(scenario, entries)}`);
  const jsonPath = str(flags.json);
  if (jsonPath) {
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          scenario: { id: scenario.id, title: scenario.title, brief: scenario.mission.brief ?? "", constraints: scenario.mission.constraints, callee: scenario.callee.persona.name, knowledge: scenario.callee.knowledge },
          entries: entries.map((e) => ({
            brain: e.brain,
            points: e.points,
            success: e.success,
            durationMs: e.durationMs,
            costUsd: e.costUsd,
            overall: e.overall,
            falseCompletion: e.falseCompletion,
            status: e.run.outcome.result.status,
            fields: e.run.outcome.result.fields,
            transcript: e.run.outcome.transcript.map((t) => ({ source: t.source, text: t.text, t: t.t })),
          })),
        },
        null,
        2,
      ),
    );
    console.log(dim(`JSON: ${jsonPath}`));
  }
  const svgPath = str(flags.svg);
  const pngPath = str(flags.png);
  if (svgPath || pngPath) {
    const svg = renderBattleSvg(scenario, entries);
    const svgOut = svgPath ?? pngPath!.replace(/\.png$/i, ".svg");
    writeFileSync(svgOut, svg);
    console.log(dim(`\nSVG: ${svgOut}`));
    if (pngPath) {
      const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chromium", "chromium-browser"].find((c) => c.startsWith("/") ? existsSync(c) : hasCommand(c));
      if (!chrome) console.log(warn("PNG needs a Chrome/Chromium binary; the SVG above can be embedded directly."));
      else {
        try {
          execSync(`"${chrome}" --headless=new --no-sandbox --hide-scrollbars --window-size=1200,630 --screenshot="${resolve(pngPath)}" "file://${resolve(svgOut)}"`, { stdio: "ignore", timeout: 30000 });
          console.log(dim(`PNG: ${pngPath}`));
        } catch (e) {
          console.log(warn(`PNG render failed: ${(e as Error).message}`));
        }
      }
    }
  }
}

function hasCommand(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function cmdDoctor(): Promise<void> {
  console.log(`\n${bold("Oathra Doctor")}\n`);
  const major = Number(process.version.slice(1).split(".")[0]);
  console.log(major >= 22 ? ok(`Node           ${process.version}`) : bad(`Node           ${process.version} (need >= 22)`));
  const has = (cmd: string) => {
    try {
      execSync(`${cmd} -version`, { stdio: "ignore" });
      return true;
    } catch {
      try {
        execSync(`${cmd} --version`, { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    }
  };
  const ffmpeg = has("ffmpeg");
  console.log(ffmpeg ? ok("ffmpeg") : warn("ffmpeg missing (needed for audio transports)\n    Fix: brew install ffmpeg"));
  try {
    const n = loadScenarioDir(scenariosDir()).length;
    console.log(ok(`Scenarios      ${n} valid`));
  } catch (e) {
    console.log(bad(`Scenarios      ${(e as Error).message}`));
  }
  const keys: Array<[string, string, string?]> = [
    ["DEEPGRAM_API_KEY", "Deepgram STT", "https://console.deepgram.com/"],
    ["ELEVENLABS_API_KEY", "ElevenLabs TTS"],
    ["OPENAI_API_KEY", "OpenAI brain", "https://platform.openai.com/api-keys"],
    ["ANTHROPIC_API_KEY", "Anthropic brain"],
    ["GEMINI_API_KEY", "Gemini brain", "https://aistudio.google.com/apikey"],
    ["LIVEKIT_URL", "LiveKit URL", "https://cloud.livekit.io/"],
    ["LIVEKIT_API_KEY", "LiveKit API key", "https://cloud.livekit.io/"],
    ["LIVEKIT_API_SECRET", "LiveKit API secret", "https://cloud.livekit.io/"],
    ["TWILIO_ACCOUNT_SID", "Twilio SID", "https://console.twilio.com/"],
    ["TWILIO_AUTH_TOKEN", "Twilio token", "https://console.twilio.com/"],
    ["PLIVO_AUTH_ID", "Plivo Auth ID", "https://console.plivo.com/"],
    ["PLIVO_AUTH_TOKEN", "Plivo token", "https://console.plivo.com/"],
  ];
  console.log("");
  for (const [env, label, url] of keys) {
    if (process.env[env]) console.log(ok(`${label.padEnd(18)} configured`));
    else {
      console.log(dim(`· ${label.padEnd(18)} not configured (${env})`));
      if (url) console.log(dim(`  Get it at: ${url}`));
    }
  }
  console.log(`\n${bold("Ready on this machine")}\n`);
  console.log(ok("Simulator       AI-vs-AI and Play mode, offline"));
  console.log(ok("Arena           browser UI (oathra demo)"));
  console.log(ok("Replay / Eval   saved calls, scoring, adversarial runs"));
  console.log(ok("Japanese        dates, times, prices, phone numbers, serials parsed deterministically"));
  console.log(ok("Verification    evidence engine decides completion, not the model"));
  console.log(dim("· Real phone     run `oathra phone doctor` for carrier, gateway, media, engine, latency and cost"));
  console.log(`\n${bold("Brains")}\n`);
  for (const b of listBrains()) {
    console.log(b.ready ? ok(`${b.name.padEnd(10)} ready${b.reason ? dim(`  ${b.reason}`) : ""}`) : dim(`· ${b.name.padEnd(10)} ${b.reason ?? "not ready"}`));
  }
  console.log("");
}

export async function cmdScenario(positional: string[], flags: Flags): Promise<void> {
  const sub = positional[0];
  if (sub === "validate") {
    const files = positional.slice(1);
    if (!files.length) throw new Error("usage: oathra scenario validate <file.yaml> [...]");
    let failed = 0;
    for (const f of files) {
      const r = parseScenario(readFileSync(f, "utf8"));
      if (r.ok) console.log(ok(`${f}  ${dim(`${r.scenario.id} · ${r.scenario.domain} · ${r.scenario.difficulty}`)}`));
      else {
        failed++;
        console.log(bad(f));
        for (const i of r.issues) console.log(`    ${yellow(i.path)}  ${i.message}`);
      }
    }
    if (failed) process.exitCode = 1;
    return;
  }
  if (sub === "list" || sub === undefined) {
    const all = loadScenarioDir(positional[1] ? resolve(positional[1]) : scenariosDir());
    console.log(table([["ID", "Title", "Difficulty", "Domain", "Tags"], ...all.map((s) => [s.id, s.title, s.difficulty, s.domain, s.tags.join(",")])]));
    return;
  }
  if (sub === "play") return cmdPlay(positional.slice(1), flags);
  throw new Error(`unknown scenario subcommand "${sub}" (validate | list | play)`);
}

export function help(): string {
  return `
${bold("Oathra")}  ${dim("Give AI agents a phone, and proof of what happened.")}

${bold("Try it")}
  oathra demo                        open the Arena: two agents on a simulated call, no API key
  oathra play [scenario]             run one scenario in the terminal        ${dim("--brain scripted|openai|gemini|ollama  --fast  --seed <n>  --json")}
  oathra battle [scenario]           several brains, same scenario, one card ${dim("--agent <brain> …  --markdown  --svg <file>  --png <file>")}

${bold("Real phone")}
  oathra setup phone                 guided API-key, voice-engine and carrier setup (.env is updated)
  oathra phone add|list|remove       manage carriers (twilio, plivo, sip)
  oathra phone doctor [--to <e164>]  which layer is broken: carrier, gateway, media, engine, latency, cost
  oathra phone test [--level …]      local (telephony ¥0, API usage) · gateway ¥0 · pstn (paid)
  oathra call --to <e164>            place a call through your carrier          ${dim("--scenario <id|yaml>  --engine gpt-live|realtime|pipeline  --provider <id>")}

${bold("Trust")}
  oathra verify <json | ->           check your final transcripts locally; JSON output, no API key
  oathra eval [dir]                  run every scenario; false completions must be 0   ${dim("--runs <n>  --json  --callee openai|gemini")}
  oathra eval --adversarial <n>      mutated callees try to fool the evidence engine   ${dim("--seed <n>  --json")}
  oathra replay [callId]             re-render a saved call; --at mm:ss.mmm for time travel

${bold("Extend")}
  oathra scenario validate <yaml>    check a community scenario
  oathra scenario list
  oathra provider create phone <id>  scaffold a carrier provider

${bold("Check")}
  oathra doctor                      runtime, keys, brains, phone readiness

${dim("Docs   https://github.com/FORIFOR/oathra")}
`;
}
