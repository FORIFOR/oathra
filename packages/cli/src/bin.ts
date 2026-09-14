#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cmdBattle, cmdCall, cmdDemo, cmdDoctor, cmdEval, cmdPhone, cmdPlay, cmdProvider, cmdReplay, cmdScenario, cmdSetup, help, parseArgs } from "./commands.js";
import { bad } from "./ui.js";
import { verifyTranscript } from "./transcript.js";

/** Load ./.env if present (values already in the environment win). */
function loadDotEnv(): void {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  try {
    const before = { ...process.env };
    process.loadEnvFile(p);
    for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
  } catch (e) {
    console.error(`[Oathra] .env を読み込めませんでした: ${(e as Error).message}`);
    console.error("        .env の書式を直すか、`cp .env.example .env` から作り直してください。");
  }
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;
  // Transcript checks require no provider credentials or .env loading.
  if (cmd !== "verify") loadDotEnv();
  if (!cmd || flags.help || cmd === "help") {
    console.log(help());
    return;
  }
  switch (cmd) {
    case "verify": {
      if (rest.length !== 1 || Object.keys(flags).length > 0) throw new Error("Usage: oathra verify <transcript-check.json | ->");
      const result = verifyTranscript(JSON.parse(readFileSync(rest[0] === "-" ? 0 : resolve(rest[0]!), "utf8")));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.complete ? 0 : 2;
      return;
    }
    case "demo": return cmdDemo(flags);
    case "play": return cmdPlay(rest, flags);
    case "call": return cmdCall(rest, flags);
    case "replay": return cmdReplay(rest, flags);
    case "eval": return cmdEval(rest, flags);
    case "battle": return cmdBattle(rest, flags);
    case "doctor": return cmdDoctor();
    case "scenario": return cmdScenario(rest, flags);
    case "phone": return cmdPhone(rest, flags);
    case "setup": return cmdSetup(rest, flags);
    case "provider": return cmdProvider(rest, flags);
    default:
      console.log(help());
      throw new Error(`unknown command "${cmd}"`);
  }
}

main().catch((err: Error) => {
  console.error(bad(err.message));
  process.exitCode = process.exitCode || 1;
});
