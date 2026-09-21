import { definePhoneRequest } from "@oathra/contract";
/**
 * `oathra phone …` and `oathra setup phone`: bring your own carrier, bring
 * your own voice engine. SIP details stay behind the provider protocol; the
 * user answers a few questions and the provider automates what it can.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { defineCall, parsePhoneRequest, type CallContract, type PhoneRequest } from "@oathra/contract";
import type { BrainProvider } from "@oathra/core";
import { recordingNotice } from "@oathra/core";
import { DeepgramSTT } from "@oathra/deepgram";
import { LiveKitSipGateway } from "@oathra/gateway-livekit";
import { OpenAITTS } from "@oathra/openai";
import { gptLiveEngine } from "@oathra/openai-realtime";
import {
  loadPhoneConfig,
  phoneConfigPath,
  PhoneRegistry,
  PhoneRouter,
  PhoneTransport,
  renderDoctor,
  savePhoneConfig,
  upsertEnv,
  type DoctorReport,
  type DoctorSection,
  type PhoneProvider,
  type ProvisionStep,
  type SipGateway,
} from "@oathra/phone";
import { plivo } from "@oathra/phone-plivo";
import { sip } from "@oathra/phone-sip";
import { twilio } from "@oathra/phone-twilio";
import { defaultCallsDir, saveCall } from "@oathra/replay";
import { runCall } from "@oathra/runtime";
import { contractFromScenario, loadScenarioDir, loadScenarioFile, type Scenario } from "@oathra/scenario";
import { MULAW_8K, type VoiceEngine } from "@oathra/voice";
import { pipelineEngine } from "@oathra/voice-pipeline";
import { liveModelOf, resolveBrain } from "./brains.js";
import { scenariosDir } from "./paths.js";
import { liveRenderer, resultBox } from "./render.js";
import { bad, bold, cyan, dim, green, ok, red, warn, yellow } from "./ui.js";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function buildRegistry(env: NodeJS.ProcessEnv = process.env): PhoneRegistry {
  const reg = new PhoneRegistry().addProvider(twilio).addProvider(plivo).addProvider(sip);
  if (env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
    reg.addGateway(new LiveKitSipGateway({ url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET }));
  }
  return reg;
}

export type EngineSpec = { id: "gpt-live" | "pipeline"; model?: string; brain?: string };

/** Accepts `--engine gpt-live|pipeline[:model]` and the legacy `--brain` spellings. */
export function parseEngineSpec(engine?: string, brain?: string, configDefault = "gpt-live"): EngineSpec {
  const spec = engine ?? (brain ? undefined : configDefault);
  if (spec) {
    const [id, ...rest] = spec.split(":");
    const model = rest.length ? rest.join(":") : undefined;
    if (id === "gpt-live" || id === "live") return { id: "gpt-live", ...(model ? { model } : {}) };
    if (id === "pipeline") return { id: "pipeline", ...(model ? { brain: model } : {}) };
    if (/^gpt-live/.test(spec)) return { id: "gpt-live", model: spec };
    throw new Error(`Unknown voice engine "${spec}". Use gpt-live or pipeline[:brain]`);
  }
  // legacy --brain
  const live = brain ? liveModelOf(brain) : undefined;
  if (live) return { id: "gpt-live", model: live };
  return { id: "pipeline", ...(brain ? { brain } : {}) };
}

export function buildEngine(spec: EngineSpec, env: NodeJS.ProcessEnv = process.env, voice?: string): VoiceEngine {
  if (spec.id === "gpt-live") return gptLiveEngine({ ...(spec.model ? { model: spec.model } : {}), ...(voice ? { voice } : {}), ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}) });
  const brain: BrainProvider = resolveBrain(spec.brain ?? "openai");
  return pipelineEngine({ brain, stt: new DeepgramSTT(), tts: new OpenAITTS() });
}

export function engineChoices(): Array<{ id: string; label: string; note: string }> {
  return [
    { id: "gpt-live", label: "GPT-Live", note: "Recommended · needs OPENAI_API_KEY · $0.05/min session" },
    { id: "pipeline", label: "Pipeline", note: "needs DEEPGRAM_API_KEY + OPENAI_API_KEY · customizable" },
  ];
}

// ---------------------------------------------------------------------------
// First-run credentials
// ---------------------------------------------------------------------------

type CredentialGuide = { label: string; url?: string; secret?: boolean; note?: string };

/** Keep setup prompts useful without putting provider-specific links in every provider package. */
const CREDENTIAL_GUIDES: Record<string, CredentialGuide> = {
  OPENAI_API_KEY: { label: "OpenAI API key", url: "https://platform.openai.com/api-keys", secret: true },
  GEMINI_API_KEY: { label: "Gemini API key", url: "https://aistudio.google.com/apikey", secret: true },
  DEEPGRAM_API_KEY: { label: "Deepgram API key", url: "https://console.deepgram.com/", secret: true },
  TWILIO_ACCOUNT_SID: { label: "Twilio Account SID", url: "https://console.twilio.com/", note: "starts with AC" },
  TWILIO_AUTH_TOKEN: { label: "Twilio Auth Token", url: "https://console.twilio.com/", secret: true },
  TWILIO_PHONE_NUMBER: { label: "Twilio phone number (E.164)", url: "https://console.twilio.com/us1/develop/phone-numbers/manage/search", note: "optional during setup; Oathra picks the first voice number when blank" },
  PLIVO_AUTH_ID: { label: "Plivo Auth ID", url: "https://console.plivo.com/", note: "starts with MA" },
  PLIVO_AUTH_TOKEN: { label: "Plivo Auth Token", url: "https://console.plivo.com/", secret: true },
  LIVEKIT_URL: { label: "LiveKit server URL", url: "https://cloud.livekit.io/", note: "use the wss:// URL from your LiveKit project" },
  LIVEKIT_API_KEY: { label: "LiveKit API key", url: "https://cloud.livekit.io/", secret: true },
  LIVEKIT_API_SECRET: { label: "LiveKit API secret", url: "https://cloud.livekit.io/", secret: true },
};

const ENGINE_CREDENTIALS: Record<EngineSpec["id"], string[]> = {
  "gpt-live": ["OPENAI_API_KEY"],
  pipeline: ["DEEPGRAM_API_KEY", "OPENAI_API_KEY"],
};

const SIP_GATEWAY_CREDENTIALS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];

function credentialGuide(envKey: string): CredentialGuide {
  return CREDENTIAL_GUIDES[envKey] ?? { label: envKey, secret: /TOKEN|SECRET|PASSWORD|KEY/.test(envKey) };
}

async function ensureEnvKeys(keys: string[]): Promise<void> {
  const updates: Record<string, string> = {};
  for (const envKey of keys) {
    if (process.env[envKey]) {
      const guide = credentialGuide(envKey);
      console.log(`  ${dim(guide.label)}  ${guide.secret ? "••••••••" : process.env[envKey]}  ${dim("(from .env)")}`);
      continue;
    }
    const guide = credentialGuide(envKey);
    console.log(`\n${bold(guide.label)}`);
    if (guide.note) console.log(`  ${dim(guide.note)}`);
    if (guide.url) console.log(`  ${dim("Get it at:")} ${cyan(guide.url)}`);
    const value = await ask(`${guide.label}${guide.secret ? " (入力内容は表示されません)" : ""}`, guide.secret ? { secret: true } : {});
    if (!value) throw new Error(`${envKey} is required${guide.url ? `. Get one at ${guide.url}` : ""}`);
    process.env[envKey] = value;
    updates[envKey] = value;
  }
  if (Object.keys(updates).length) upsertEnv(updates);
}

// ---------------------------------------------------------------------------
// Tunnel (Twilio direct needs a public wss:// URL)
// ---------------------------------------------------------------------------

export type Tunnel = { url: string; stop: () => void };

export function onPath(bin: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((d) => existsSync(join(d, bin)));
}

export async function startNgrok(port: number): Promise<Tunnel> {
  const child: ChildProcess = spawn("ngrok", ["http", String(port), "--log=stdout", "--log-format=json"], { stdio: ["ignore", "pipe", "pipe"] });
  const stop = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  };
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://127.0.0.1:4040/api/tunnels");
      if (res.ok) {
        const data = (await res.json()) as { tunnels?: Array<{ public_url?: string; config?: { addr?: string } }> };
        const t = data.tunnels?.find((x) => x.public_url?.startsWith("https://") && (x.config?.addr ?? "").endsWith(`:${port}`)) ?? data.tunnels?.find((x) => x.public_url?.startsWith("https://"));
        if (t?.public_url) return { url: t.public_url.replace(/^https:/, "wss:"), stop };
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  stop();
  throw new Error("ngrok did not report a public URL within 15 s (is `ngrok config add-authtoken …` done?)");
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

async function askSecret(question: string, optional = false): Promise<string> {
  // Piped input is useful for CI and smoke tests; there is no terminal to mask there.
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      // readline/promises can leave question() pending when a pipe closes
      // before a response. Reject explicitly so setup cannot exit as if it
      // completed with a half-entered configuration.
      return (
        await new Promise<string>((resolve, reject) => {
          let settled = false;
          const onClose = () => {
            if (settled) return;
            settled = true;
            reject(new Error("setup input ended before a value was entered"));
          };
          rl.once("close", onClose);
          rl.question(`${question}${optional ? ` ${dim("(optional)")}` : ""}\n> `)
            .then((value) => {
              if (settled) return;
              settled = true;
              rl.off("close", onClose);
              resolve(value);
            })
            .catch((error: unknown) => {
              if (settled) return;
              settled = true;
              rl.off("close", onClose);
              reject(error);
            });
        })
      ).trim();
    } finally {
      rl.close();
    }
  }

  process.stdout.write(`${question}${optional ? ` ${dim("(optional)")}` : ""}\n> `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode?.(false);
      process.stdout.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      for (const ch of String(chunk)) {
        const code = ch.charCodeAt(0);
        if (code === 3) {
          cleanup();
          reject(new Error("setup cancelled"));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          cleanup();
          resolve(value.trim());
          return;
        }
        if (code === 8 || code === 127) {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (code >= 32 && code !== 127) {
          value += ch;
          process.stdout.write("•");
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function ask(question: string, opts: { secret?: boolean; default?: string; optional?: boolean } = {}): Promise<string> {
  if (opts.secret) return askSecret(question, Boolean(opts.optional));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = opts.default ? ` ${dim(`(${opts.default})`)}` : opts.optional ? ` ${dim("(optional)")}` : "";
    const answer = (
      await new Promise<string>((resolve, reject) => {
        let settled = false;
        const onClose = () => {
          if (settled) return;
          settled = true;
          reject(new Error("setup input ended before a choice was entered"));
        };
        rl.once("close", onClose);
        rl.question(`${question}${suffix}\n> `)
          .then((value) => {
            if (settled) return;
            settled = true;
            rl.off("close", onClose);
            resolve(value);
          })
          .catch((error: unknown) => {
            if (settled) return;
            settled = true;
            rl.off("close", onClose);
            reject(error);
          });
      })
    ).trim();
    return answer || opts.default || "";
  } finally {
    rl.close();
  }
}

async function choose(title: string, items: Array<{ id: string; label: string; note?: string }>, def = 0): Promise<string> {
  console.log(`\n${bold(title)}\n`);
  items.forEach((it, i) => console.log(`  ${i === def ? "❯" : " "} ${String(i + 1).padStart(2)}. ${it.label.padEnd(14)} ${it.note ? dim(it.note) : ""}`));
  const a = await ask("\nChoose", { default: String(def + 1) });
  const idx = Number(a) - 1;
  const it = items[idx] ?? items[def]!;
  return it.id;
}

// ---------------------------------------------------------------------------
// phone add / setup phone
// ---------------------------------------------------------------------------

export async function phoneAdd(providerId: string | undefined, flags: Record<string, unknown>): Promise<void> {
  let reg = buildRegistry();
  const providers = reg.listProviders();
  const id =
    providerId ??
    (await choose("How would you like to make calls?", [
      ...providers.map((p) => ({ id: p.id, label: p.label, note: p.capabilities.direct ? "direct media streams · verified" : "SIP via gateway" })),
      { id: "skip", label: "Skip", note: "simulator only" },
    ]));
  if (id === "skip") return;
  const provider = reg.provider(id);
  if (!provider) throw new Error(`Unknown phone provider "${id}". Available: ${providers.map((p) => p.id).join(", ")}`);

  console.log(`\n${bold(`Setting up ${provider.label}`)}\n`);
  const answers: Record<string, string> = {};
  const envUpdates: Record<string, string> = {};
  for (const q of provider.questions) {
    const existing = q.envKey ? process.env[q.envKey] : undefined;
    const fromFlag = typeof flags[q.key] === "string" ? String(flags[q.key]) : undefined;
    let value = fromFlag ?? "";
    if (!value && existing) {
      value = existing;
      console.log(`  ${dim(q.label)}  ${q.secret ? "••••••••" : existing}  ${dim("(from .env)")}`);
    }
    const guide = q.envKey ? credentialGuide(q.envKey) : undefined;
    if (!value && guide?.url) console.log(`  ${dim("Get it at:")} ${cyan(guide.url)}`);
    if (!value) value = await ask(`${q.label}${q.secret ? " (入力内容は表示されません)" : ""}`, { secret: Boolean(q.secret), ...(q.optional ? { optional: true } : {}), ...(q.placeholder ? { default: "" } : {}) });
    if (!value && !q.optional) throw new Error(`${q.label} is required${guide?.url ? `. Get one at ${guide.url}` : ""}`);
    answers[q.key] = value;
    if (q.envKey && value) {
      process.env[q.envKey] = value;
      envUpdates[q.envKey] = value;
    }
  }

  if (!provider.capabilities.direct) {
    await ensureEnvKeys(SIP_GATEWAY_CREDENTIALS);
    // The registry is built before prompts so the provider list is stable. Rebuild
    // after gateway credentials are entered so the new gateway is available now.
    reg = buildRegistry();
  }
  const gateway = provider.capabilities.direct ? undefined : requireGateway(reg);
  const plan = await provider.provision({ answers, env: process.env, ...(gateway ? { gateway } : {}) });
  console.log("");
  for (const step of plan.steps) await runStep(step);
  const result = await plan.finish();

  const config = loadPhoneConfig();
  config.providers[provider.id] = { ...result.config, ...(gateway ? { gateway: gateway.id } : {}) };
  if (!config.routing.providers.includes(provider.id)) config.routing.providers.push(provider.id);
  savePhoneConfig(config);
  if (Object.keys(envUpdates).length) upsertEnv(envUpdates);
  console.log(`\n${ok(`${provider.label} is ready.`)}  ${dim(`config: ${phoneConfigPath()} · secrets: .env`)}`);
  for (const n of result.notes ?? []) console.log(`  ${dim("·")} ${n}`);
}

function requireGateway(reg: PhoneRegistry): SipGateway {
  const g = reg.gateway("livekit");
  if (!g) {
    throw new Error(
      "SIP providers need a SIP gateway. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET (LiveKit Cloud: https://cloud.livekit.io, or self-hosted) in .env, then retry.",
    );
  }
  return g;
}

async function runStep(step: ProvisionStep): Promise<void> {
  if (step.type === "automatic") {
    process.stdout.write(`  ${dim("…")} ${step.title}`);
    const r = await step.run();
    process.stdout.write(`\r  ${r.ok ? green("✓") : red("✗")} ${step.title}${r.detail ? dim(`  ${r.detail}`) : ""}\n`);
    if (!r.ok && !step.continueOnFailure) throw new Error(`${step.title} failed${r.detail ? `: ${r.detail}` : ""}`);
    return;
  }
  // Already satisfied (e.g. the automatic check before it passed): no human needed.
  if (await step.verify()) {
    console.log(`  ${green("✓")} ${step.title}${dim("  already done")}`);
    return;
  }
  console.log(`\n  ${yellow("○")} ${bold(step.title)}\n    ${dim(step.reason)}`);
  if (step.url) console.log(`    ${cyan(step.url)}`);
  process.stdout.write(`    ${dim("Waiting for you to finish this in the browser… (checking every 5 s, Ctrl+C to abort)")}\n`);
  for (;;) {
    if (await step.verify()) {
      console.log(`  ${green("✓")} ${step.title}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

export async function setupPhone(flags: Record<string, unknown>): Promise<void> {
  console.log(`\n${bold("Oathra Phone Setup")}`);
  const requestedEngine = typeof flags.engine === "string" ? flags.engine.trim().toLowerCase() : "";
  const selectedEngine = requestedEngine
    ? engineChoices().find((choice) => choice.id === requestedEngine || (requestedEngine === "live" && choice.id === "gpt-live"))
    : undefined;
  if (requestedEngine && !selectedEngine) {
    throw new Error(`Unknown voice engine "${requestedEngine}". Use: ${engineChoices().map((choice) => choice.id).join(" | ")}`);
  }
  const requestedProvider = typeof flags.provider === "string" ? flags.provider.trim().toLowerCase() : undefined;
  if (requestedProvider) {
    const providerIds = buildRegistry().listProviders().map((provider) => provider.id);
    if (!providerIds.includes(requestedProvider)) throw new Error(`Unknown phone provider "${requestedProvider}". Use: ${providerIds.join(" | ")}`);
  }
  const engine = selectedEngine?.id ?? (await choose("Choose voice engine", engineChoices(), 0));
  if (selectedEngine) console.log(`  ${green("✓")} ${selectedEngine.label} ${dim("(from --engine)")}`);
  await ensureEnvKeys(ENGINE_CREDENTIALS[engine as EngineSpec["id"]] ?? ["OPENAI_API_KEY"]);
  const config = loadPhoneConfig();
  config.voice.engine = engine;
  savePhoneConfig(config);
  await phoneAdd(requestedProvider || undefined, flags);
  if (flags["skip-test"] || flags["no-test"]) {
    console.log(dim("\nSkipped the local test. Run `oathra phone test --level local` when ready."));
    return;
  }
  const test = await ask("Run a local test now? (y/N)", { default: "N" });
  if (/^y/i.test(test)) await phoneTest({ level: "local" });
}

// ---------------------------------------------------------------------------
// phone list / remove
// ---------------------------------------------------------------------------

export function phoneList(): void {
  const reg = buildRegistry();
  const config = loadPhoneConfig();
  console.log(`\n${bold("Phone providers")}  ${dim(phoneConfigPath())}\n`);
  for (const p of reg.listProviders()) {
    const cfg = config.providers[p.id];
    const gatewayKeys = p.capabilities.direct ? [] : SIP_GATEWAY_CREDENTIALS;
    const missing = [...p.requires, ...gatewayKeys.filter((k) => !p.requires.includes(k))].filter((k) => !process.env[k]);
    const status = !cfg ? dim("not configured") : missing.length ? yellow(`missing ${missing.join(", ")}`) : green("ready");
    const order = config.routing.providers.indexOf(p.id);
    console.log(`  ${p.id.padEnd(8)} ${p.label.padEnd(12)} ${status}${order >= 0 ? dim(`  route #${order + 1}`) : ""}${cfg?.from ? dim(`  caller id ${String(cfg.from)}`) : cfg?.callerId ? dim(`  caller id ${String(cfg.callerId)}`) : ""}`);
  }
  console.log(`\n${dim("Voice engine")}  ${config.voice.engine}   ${dim("Gateway")}  ${reg.gateway("livekit") ? "livekit (configured)" : "livekit (LIVEKIT_* not set)"}`);
  console.log(dim("\nAdd one:  oathra phone add twilio | plivo | sip\n"));
}

export async function phoneRemove(providerId: string | undefined): Promise<void> {
  if (!providerId) throw new Error("usage: oathra phone remove <provider>");
  const reg = buildRegistry();
  const config = loadPhoneConfig();
  const provider = reg.provider(providerId);
  const cfg = config.providers[providerId];
  if (provider?.remove && cfg) {
    const gateway = reg.gateway(String(cfg.gateway ?? config.gateway.id));
    await provider.remove({ config: cfg, env: process.env, ...(gateway ? { gateway } : {}) });
  }
  delete config.providers[providerId];
  config.routing.providers = config.routing.providers.filter((p) => p !== providerId);
  savePhoneConfig(config);
  console.log(ok(`removed ${providerId} from ${phoneConfigPath()} (secrets in .env were left untouched)`));
}

// ---------------------------------------------------------------------------
// phone doctor
// ---------------------------------------------------------------------------

const color = (s: string, kind: "ok" | "bad" | "dim") => (kind === "ok" ? green(s) : kind === "bad" ? red(s) : dim(s));

export async function phoneDoctor(flags: { provider?: string; to?: string; engine?: string }): Promise<boolean> {
  const reg = buildRegistry();
  const config = loadPhoneConfig();
  const ids = flags.provider ? [flags.provider] : config.routing.providers.length ? config.routing.providers : Object.keys(config.providers);
  if (!ids.length) {
    console.log(warn("No phone provider configured. Run: oathra phone add"));
    return false;
  }
  const engineSpec = parseEngineSpec(flags.engine, undefined, config.voice.engine);
  let allReady = true;
  for (const id of ids) {
    const p = reg.provider(id);
    const cfg = config.providers[id];
    if (!p || !cfg) {
      console.log(bad(`${id}: not configured`));
      allReady = false;
      continue;
    }
    const gateway = reg.gateway(String(cfg.gateway ?? config.gateway.id));
    let engine: VoiceEngine | undefined;
    let engineError: string | undefined;
    try {
      engine = buildEngine(engineSpec);
    } catch (e) {
      engine = undefined;
      engineError = (e as Error).message;
    }
    const report: DoctorReport = await p.doctor({ config: cfg, env: process.env, ...(gateway ? { gateway } : {}) }, { ...(flags.to ? { destination: flags.to } : {}), ...(engine ? { engine } : {}) });
    // Voice engine section (engine-level: env present, format supported).
    const missingEnv = engine ? engine.requires.filter((k) => !process.env[k]) : [];
    const eng: DoctorSection = engine
      ? { name: "Voice Engine", checks: [{ label: engine.label, ok: missingEnv.length === 0, ...(missingEnv.length ? { detail: `${missingEnv.join(", ")} missing` } : {}) }] }
      : { name: "Voice Engine", checks: [{ label: engineSpec.id, ok: false, detail: engineError ?? "could not construct engine", fix: "run `oathra setup phone` to add the required API key" }] };
    const full: DoctorReport = { ...report, sections: [...report.sections, eng], ready: report.ready && eng.checks.every((c) => c.ok) };
    console.log(`\n${bold(p.label)}\n`);
    console.log(renderDoctor(full, { color }).replace(/^/gm, "  "));
    allReady &&= full.ready;
  }
  return allReady;
}

// ---------------------------------------------------------------------------
// phone test — Local (telephony ¥0, model API usage) / Gateway (¥0) / PSTN (paid)
// ---------------------------------------------------------------------------

export async function phoneTest(flags: { level?: string; provider?: string; to?: string; engine?: string; scenario?: string }): Promise<void> {
  const config = loadPhoneConfig();
  const level =
    flags.level ??
    (await choose("Choose test level", [
      { id: "local", label: "Local", note: "telephony ¥0 · uses model APIs with synthesized audio" },
      { id: "gateway", label: "Gateway", note: "¥0 · SIP gateway loopback, no PSTN" },
      { id: "pstn", label: "PSTN", note: "paid · real phone call (carrier rate applies)" },
    ]));
  const engineSpec = parseEngineSpec(flags.engine, undefined, config.voice.engine);
  if (level === "local") {
    await localLoopback(engineSpec);
    return;
  }
  if (level === "gateway") {
    const reg = buildRegistry();
    const g = reg.gateway("livekit");
    if (!g?.loopback) {
      console.log(warn("Gateway loopback is not available (no SIP gateway configured, or the gateway does not support it)."));
      return;
    }
    const checks = await g.loopback(MULAW_8K);
    for (const c of checks) console.log(`  ${c.skipped ? dim("·") : c.ok ? green("✓") : red("✗")} ${c.label}${c.detail ? dim(`  ${c.detail}`) : ""}`);
    return;
  }
  if (!flags.to) throw new Error("PSTN test needs --to +81... (or set OATHRA_TEST_PHONE)");
  await runPhoneCall({ to: flags.to, ...(flags.provider ? { provider: flags.provider } : {}), ...(flags.engine ? { engine: flags.engine } : {}), scenario: flags.scenario ?? "friend-chat" });
}

/** Engine loopback: synthesized callee speech → engine → expect agent audio + transcripts. Costs a few yen of API, no telephony. */
async function localLoopback(spec: EngineSpec): Promise<void> {
  const engine = buildEngine(spec);
  console.log(`\n${bold("Local loopback")}  ${dim(engine.label)}\n`);
  const contract = defineCall({ goal: "chat.casual", input: { topic: "最近ハマっていること" }, permissions: { ask: true } });
  const t0 = Date.now();
  const clock = { now: () => Date.now() - t0 };
  const session = await engine.start({ contract, language: "ja", carrierAudio: MULAW_8K, calleeName: "テスト" }, clock);
  let outMs = 0;
  let firstOut: number | undefined;
  const transcripts: string[] = [];
  const pump = (async () => {
    for await (const o of session.output) {
      if (o.type === "audio") {
        outMs += o.chunk.data.length / 8;
        if (firstOut === undefined) firstOut = clock.now();
      } else if (o.type === "event" && (o.event.type === "speech" || o.event.type === "agent.speech")) transcripts.push(`${o.event.type === "speech" ? "callee" : "agent "}: ${o.event.text}`);
    }
  })();
  const tts = new OpenAITTS();
  const say = async (text: string) => {
    const mu = await tts.synthesizeMulaw8k(text, { language: "ja" });
    for (let i = 0; i < mu.length; i += 160) {
      session.input({ ...MULAW_8K, data: mu.subarray(i, i + 160) });
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const silence = async (ms: number) => {
    const frame = new Uint8Array(160).fill(0xff);
    for (let i = 0; i < ms / 20; i++) {
      session.input({ ...MULAW_8K, data: frame });
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  await silence(300);
  await say("もしもし、久しぶり。最近どう？");
  const spokeAt = clock.now();
  if (!engine.speaksItself && session.speak) {
    await silence(1500);
    await session.speak("元気だよ。そっちは最近どう？");
  } else await silence(6000);
  await say("そっか。じゃあね、バイバイ。");
  await silence(4000);
  await session.close();
  await pump.catch(() => undefined);
  const ttfa = firstOut !== undefined ? firstOut - spokeAt : undefined;
  console.log(`  ${outMs > 500 ? green("✓") : red("✗")} agent audio       ${Math.round(outMs)} ms`);
  console.log(`  ${transcripts.some((t) => t.startsWith("callee")) ? green("✓") : yellow("·")} callee transcript`);
  console.log(`  ${transcripts.some((t) => t.startsWith("agent")) ? green("✓") : yellow("·")} agent transcript`);
  console.log(`  ${dim("first agent audio")}  ${ttfa === undefined ? "n/a" : ttfa < 0 ? `${-ttfa} ms before the callee finished (full-duplex)` : `+${ttfa} ms after the callee finished`}`);
  for (const t of transcripts) console.log(`    ${dim(t)}`);
  console.log(`\n${outMs > 500 ? ok("Voice engine works. Telephony cost: ¥0") : bad("No agent audio received")}`);
}

// ---------------------------------------------------------------------------
// call (router)
// ---------------------------------------------------------------------------

export type PhoneCallFlags = { requestFile?: string; dryRun?: boolean; approveRequest?: boolean; to?: string; scenario?: string; engine?: string; brain?: string; provider?: string; name?: string; noSave?: boolean; port?: number; publicUrl?: string };

function findScenario(idOrPath: string): Scenario {
  if (existsSync(idOrPath) && /\.ya?ml$/.test(idOrPath)) return loadScenarioFile(resolve(idOrPath));
  const all = loadScenarioDir(scenariosDir());
  const s = all.find((x) => x.id === idOrPath);
  if (!s) throw new Error(`Scenario "${idOrPath}" not found. Available: ${all.map((x) => x.id).join(", ")}`);
  return s;
}

/** Shared personal-call policy for CLI handoffs and the local Web adapter. */
export function phoneRequestContract(request: PhoneRequest): CallContract {
  return definePhoneRequest(request);
}

export async function runPhoneCall(flags: PhoneCallFlags): Promise<void> {
  if ((flags.dryRun || flags.approveRequest) && !flags.requestFile) throw new Error("--dry-run and --approve-request require --request-file");
  if (flags.requestFile && (flags.to || flags.scenario || flags.name)) throw new Error("--request-file cannot be combined with --to, --name or --scenario; edit and review the request file instead");
  if (flags.requestFile && statSync(flags.requestFile).size > 16384) throw new Error("phone request file exceeds 16 KiB");
  const request = flags.requestFile ? parsePhoneRequest(JSON.parse(readFileSync(flags.requestFile, "utf8"))) : undefined;
  const to = request?.phone ?? flags.to ?? process.env.OATHRA_TEST_PHONE;
  if (!to || !/^\+\d{8,15}$/.test(to)) throw new Error("--to must be an E.164 number, e.g. --to +819012345678");
  const scenario = findScenario(request ? "friend-chat" : flags.scenario ?? "restaurant-reservation");
  const base = contractFromScenario(scenario);
  const contract: CallContract = request ? phoneRequestContract(request) : defineCall({ ...base,
    target: { phone: to, name: flags.name ?? scenario.callee.persona.name } });
  if (flags.dryRun) {
    console.log(JSON.stringify({ state: "draft", dialed: false, contract, recording: !flags.noSave, notice: "Real calls transmit to the configured carrier and voice provider and incur usage charges. The runtime budget is not a guaranteed carrier billing cap." + (request?.conversationMode === "chat" ? " Chat on Realtime enables public-category news lookup through OpenAI Responses web_search (gpt-5.4-mini), at most twice per call, with additional API charges. Other engines cannot verify current news." : "") }, null, 2));
    return;
  }
  if (request && !flags.approveRequest) throw new Error("Review with --dry-run first. A saved draft is not approval; use --approve-request only to explicitly place the paid call.");
  const reg = buildRegistry();
  const config = loadPhoneConfig();
  const engineSpec = parseEngineSpec(flags.engine, flags.brain, config.voice.engine);
  const engine = buildEngine(engineSpec, process.env, request?.voice);

  // Direct media-stream providers need a public URL while their transport is
  // constructed. Prepare the tunnel before routing so a ready Twilio route is
  // not discarded before the per-call transport can be injected below.
  const routeOrder = flags.provider ? [flags.provider] : config.routing.providers.length ? config.routing.providers : Object.keys(config.providers);
  const needsDirectTunnel = !flags.publicUrl && !process.env.OATHRA_PUBLIC_WS_URL && routeOrder.some((id) => {
    const provider = reg.provider(id);
    const cfg = config.providers[id];
    return Boolean(provider?.capabilities.direct && cfg && !provider.requires.some((key) => !process.env[key]));
  });
  let tunnel: Tunnel | undefined;
  const callPort = flags.port ?? 4243;
  let publicWsUrl = flags.publicUrl ?? process.env.OATHRA_PUBLIC_WS_URL;
  if (needsDirectTunnel) {
    if (!onPath("ngrok")) throw new Error("Direct media streams need a public wss:// URL: install ngrok or pass --public-url");
    process.stdout.write(dim("Starting ngrok tunnel... "));
    tunnel = await startNgrok(callPort);
    publicWsUrl = tunnel.url;
    console.log(ok(publicWsUrl));
  }

  // Pass the runtime URL into direct provider construction. The persisted
  // phone config remains unchanged and never receives credentials.
  const routeConfig = {
    ...config,
    providers: Object.fromEntries(Object.entries(config.providers).map(([id, cfg]) => [
      id,
      reg.provider(id)?.capabilities.direct && publicWsUrl ? { ...cfg, publicWsUrl, port: callPort } : cfg,
    ])),
  };
  const router = new PhoneRouter(reg, routeConfig);
  let routes: ReturnType<PhoneRouter["resolve"]>;
  try {
    routes = router.resolve({ destination: to, ...(flags.provider ? { prefer: flags.provider } : {}) });
  } catch (error) {
    tunnel?.stop();
    throw error;
  }
  if (!routes.length) {
    tunnel?.stop();
    console.log(`\n${warn("No phone provider is ready.")}  Run ${cyan("oathra phone add")} (Twilio, Plivo or custom SIP).`);
    process.exitCode = 2;
    return;
  }

  console.log(`\n${bold("Oathra · phone call")}\n`);
  console.log(`${dim("Scenario")}   ${scenario.title}  ${dim(`(${scenario.id})`)}`);
  console.log(`${dim("Engine")}     ${engine.label}`);
  console.log(`${dim("Routes")}     ${routes.map((r, i) => `${i === 0 ? "" : dim("→ ")}${r.provider.label}${r.rate ? dim(` $${r.rate.ratePerMin}/min`) : ""}`).join("  ")}`);
  console.log(`${dim("To")}         ${to}`);
  console.log(`\n${bold("Allowed actions")}`);
  for (const a of ["ask", "reserve", "negotiate", "modify", "cancel", "payment", "share_name", "share_phone", "share_address"] as const) {
    console.log(`  ${contract.permissions[a] === true ? green("✓") : red("✗")} ${a}`);
  }
  console.log("");

  const callId = `call_${Date.now().toString(36)}`;
  const recordDir = flags.noSave ? undefined : join(defaultCallsDir(), callId);
  if (recordDir) mkdirSync(recordDir, { recursive: true });

  let lastError: Error | undefined;
  for (const route of routes) {
    try {
      // Direct media-stream carriers need a public URL for the carrier to reach us.
      if (route.transport.path === "direct") {
        const port = callPort;
        publicWsUrl = flags.publicUrl ?? process.env.OATHRA_PUBLIC_WS_URL ?? tunnel?.url;
        if (!publicWsUrl) {
          if (!onPath("ngrok")) throw new Error("Direct media streams need a public wss:// URL: install ngrok or pass --public-url");
          process.stdout.write(dim("Starting ngrok tunnel... "));
          tunnel = await startNgrok(port);
          publicWsUrl = tunnel.url;
          console.log(ok(publicWsUrl));
        }
        const cfg = config.providers[route.provider.id] ?? {};
        route.transport = route.provider.transport({ config: { ...cfg, publicWsUrl, port }, env: process.env });
      }
      const transport = new PhoneTransport(route.transport, engine, { ...(recordDir ? { recordDir } : {}) });
      console.log(`${dim("Dialing via")} ${route.provider.label} ${dim(`(${route.transport.path})`)} ...`);
      // Only the direct Twilio path records audio; it announces that to the callee before anything else.
      console.log(recordDir && route.transport.path === "direct" ? dim(`The call is recorded to ${recordDir}; the callee hears "${recordingNotice(contract.language)}" first. Use --no-save to neither record nor announce.\n`) : "");
      const outcome = await runCall({
        contract,
        transport,
        brain: engine.speaksItself ? { name: engine.id, respond: async () => { throw new Error("engine speaks itself"); } } : resolveBrain(engineSpec.brain ?? "openai"),
        callId,
        scenarioId: scenario.id,
        onEvent: liveRenderer(scenario),
        // The agent opens the call as soon as the line is up; it does not wait for the callee's hello.
        openingTimeoutMs: 0,
      });
      console.log("");
      console.log(resultBox(outcome));
      if (!flags.noSave) {
        const dir = saveCall(outcome);
        writeFileSync(join(dir, "route.json"), JSON.stringify({ provider: route.provider.id, path: route.transport.path, engine: engine.id, ...(route.rate ? { rate: route.rate } : {}) }, null, 2));
        console.log(dim(`\nSaved: ${dir}\n  oathra replay ${outcome.callId}`));
      }
      lastError = undefined;
      break;
    } catch (e) {
      lastError = e as Error;
      console.log(warn(`${route.provider.label} failed: ${lastError.message}`));
      // A reviewed personal request must not ring again via another carrier after an ambiguous failure.
      if (request) break;
      if (routes.indexOf(route) < routes.length - 1) console.log(dim("Trying the next route..."));
    } finally {
      tunnel?.stop();
      tunnel = undefined;
    }
  }
  if (lastError) throw lastError;
}

// ---------------------------------------------------------------------------
// provider create phone <id>
// ---------------------------------------------------------------------------

export function providerCreate(kind: string | undefined, id: string | undefined): void {
  if (kind !== "phone" || !id || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error("usage: oathra provider create phone <id>   (lowercase id, e.g. acme)");
  const dir = resolve(process.cwd(), "providers", `phone-${id}`);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "test"), { recursive: true });
  const pkg = {
    name: `@oathra/phone-${id}`,
    version: "0.1.0",
    description: `${id} phone provider for Oathra`,
    license: "Apache-2.0",
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js", default: "./dist/index.js" } },
    files: ["dist"],
    scripts: { build: "tsc -b" },
    dependencies: { "@oathra/phone": "workspace:*", "@oathra/voice": "workspace:*", "@oathra/core": "workspace:*", "@oathra/contract": "workspace:*", "@oathra/evidence": "workspace:*" },
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: "../../tsconfig.base.json",
        compilerOptions: { rootDir: "src", outDir: "dist", tsBuildInfoFile: "dist/.tsbuildinfo" },
        include: ["src/**/*.ts"],
        exclude: ["src/**/*.test.ts"],
        references: [{ path: "../../packages/phone" }, { path: "../../packages/voice" }, { path: "../../packages/core" }, { path: "../../packages/contract" }, { path: "../../packages/evidence" }],
      },
      null,
      2,
    ) + "\n",
  );
  const cap = id.charAt(0).toUpperCase() + id.slice(1);
  writeFileSync(
    join(dir, "src", "provider.ts"),
    `import { definePhoneProvider, referenceRate } from "@oathra/phone";
import { provision } from "./provision.js";
import { doctor } from "./doctor.js";
import { ${id}Transport } from "./transport.js";

export const ${id} = definePhoneProvider({
  id: "${id}",
  label: "${cap}",
  capabilities: { sip: true, outbound: true, inbound: false },
  requires: ["${id.toUpperCase()}_API_KEY"],
  questions: [
    { key: "apiKey", label: "${cap} API key", secret: true, envKey: "${id.toUpperCase()}_API_KEY" },
    { key: "callerId", label: "Caller ID (E.164)", envKey: "${id.toUpperCase()}_CALLER_ID", optional: true },
  ],
  provision,
  transport: (ctx) => ${id}Transport(ctx),
  doctor,
  pricing: (destination) => referenceRate("${id}", destination),
});

export default ${id};
`,
  );
  writeFileSync(
    join(dir, "src", "provision.ts"),
    `import type { PhoneProvider, ProvisionStep } from "@oathra/phone";

/** Automate what the API allows; return user_action steps for anything that needs a human. */
export const provision: PhoneProvider["provision"] = async (input) => {
  const steps: ProvisionStep[] = [
    { type: "automatic", id: "auth", title: "Verify credentials", run: async () => ({ ok: Boolean(input.env["${id.toUpperCase()}_API_KEY"]) }) },
    // { type: "user_action", id: "caller-id", title: "Verify your caller ID", reason: "Required by provider", url: "https://…", verify: async () => true },
  ];
  return {
    steps,
    finish: async () => ({ config: { callerId: input.answers.callerId ?? "" }, envKeys: ["${id.toUpperCase()}_API_KEY"] }),
  };
};
`,
  );
  writeFileSync(
    join(dir, "src", "transport.ts"),
    `import type { CarrierTransport, ProviderContext } from "@oathra/phone";

/** SIP providers usually delegate to the gateway: ctx.gateway.dial(trunkId, opts). */
export function ${id}Transport(ctx: ProviderContext): CarrierTransport {
  const trunkId = String(ctx.config.trunkId ?? "");
  const gateway = ctx.gateway;
  if (!gateway) throw new Error("${cap} needs a SIP gateway (LIVEKIT_* in .env)");
  return {
    providerId: "${id}",
    path: "sip",
    dial: (opts) => gateway.dial(trunkId, opts),
    describe: () => \`${cap} via \${gateway.label} trunk \${trunkId}\`,
  };
}
`,
  );
  writeFileSync(
    join(dir, "src", "doctor.ts"),
    `import { check, referenceRate, reportReady, section, skipped, type PhoneProvider } from "@oathra/phone";

export const doctor: PhoneProvider["doctor"] = async (ctx, opts) => {
  const gateway = ctx.gateway ? await ctx.gateway.check() : [skipped("SIP gateway", "not configured")];
  const cost = opts.destination ? referenceRate("${id}", opts.destination) : undefined;
  return reportReady({
    sections: [
      section("Carrier", [check("${cap} credentials", Boolean(ctx.env["${id.toUpperCase()}_API_KEY"]))]),
      section("SIP Gateway", gateway),
      section("Media", [skipped("Audio send / receive", "requires a live call: oathra phone test")]),
    ],
    latency: [],
    ...(cost ? { cost } : {}),
  });
};
`,
  );
  writeFileSync(join(dir, "src", "index.ts"), `export { ${id}, default } from "./provider.js";\n`);
  writeFileSync(join(dir, "README.md"), `# @oathra/phone-${id}\n\n${cap} phone provider for Oathra.\n\n\`\`\`bash\noathra phone add ${id}\n\`\`\`\n\nImplements \`definePhoneProvider\` from \`@oathra/phone\`: provisioning steps, a SIP transport via the configured gateway, a doctor, and reference pricing. Add the package to \`scripts/check-deps.mjs\` (layer 5.5) and \`tsconfig.build.json\`, then register it in \`packages/cli/src/phone.ts\`.\n`);
  writeFileSync(join(dir, "test", ".gitkeep"), "");
  console.log(ok(`created providers/phone-${id}/`));
  console.log(dim("  next: add it to scripts/check-deps.mjs (layer 5.5), tsconfig.build.json, and buildRegistry() in packages/cli/src/phone.ts"));
}
