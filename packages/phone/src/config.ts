import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";

/** .oathra/phone.yaml — never contains secrets; those stay in .env. */
export const PhoneConfigSchema = z.object({
  version: z.literal(1).default(1),
  providers: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  routing: z
    .object({
      strategy: z.enum(["preferred"]).default("preferred"),
      providers: z.array(z.string()).default([]),
    })
    .default({}),
  gateway: z.object({ id: z.string().default("livekit"), config: z.record(z.string(), z.unknown()).default({}) }).default({}),
  voice: z.object({ engine: z.string().default("gpt-live") }).default({}),
});
export type PhoneConfig = z.infer<typeof PhoneConfigSchema>;

export function phoneConfigPath(cwd = process.cwd()): string {
  return resolve(cwd, ".oathra", "phone.yaml");
}

export function loadPhoneConfig(path = phoneConfigPath()): PhoneConfig {
  if (!existsSync(path)) return PhoneConfigSchema.parse({});
  return PhoneConfigSchema.parse(YAML.parse(readFileSync(path, "utf8")) ?? {});
}

export function savePhoneConfig(config: PhoneConfig, path = phoneConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `# Oathra phone configuration. Secrets live in .env, never here.\n${YAML.stringify(config)}`);
}

/** Write or update keys in ./.env without touching other lines. */
export function upsertEnv(values: Record<string, string>, path = resolve(process.cwd(), ".env")): void {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  for (const [k, v] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    // Quote values containing dotenv syntax so SIP passwords and tokens with
    // spaces, #, quotes or backslashes survive the next CLI invocation.
    const encoded = /[\s#"'\\]/.test(v) ? `"${v.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"` : v;
    const line = `${k}=${encoded}`;
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  }
  writeFileSync(path, lines.join("\n").replace(/\n*$/, "\n"));
}
