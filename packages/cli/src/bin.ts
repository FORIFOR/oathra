#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cmdBattle, cmdCall, cmdDemo, cmdDoctor, cmdEval, cmdPhone, cmdPlay, cmdProvider, cmdReplay, cmdScenario, cmdSetup, help, parseArgs } from "./commands.js";
import { bad } from "./ui.js";

/** Load ./.env if present (values already in the environment win). */
function loadDotEnv(): void {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  try {
    const before = { ...process.env };
    process.loadEnvFile(p);
    for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
  } catch {
    /* ignore malformed .env */
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;
  if (!cmd || flags.help || cmd === "help") {
    console.log(help());
    return;
  }
  switch (cmd) {
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
