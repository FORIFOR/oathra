import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWebPhoneDialer } from "./web-phone.js";

// Real local config parsing only. No carrier, voice-engine or network doubles.
describe("Web phone local inspection", () => {
  it("blocks an unconfigured machine without trying discovery or a tunnel", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oathra-web-phone-"));
    try {
      const dialer = buildWebPhoneDialer({ configPath: join(dir, "phone.yaml"), env: {} });
      const state = await dialer.inspect();
      expect(state.ready).toBe(false);
      expect(state.issues.join(" ")).toContain("oathra setup phone");
      expect(state.issues.join(" ")).toContain("OPENAI_API_KEY");
      expect(state.recording).toBe(false);
      expect(state.disclosure).toContain("従量料金");
      expect(state.disclosure).toContain("会話テキスト");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("detects edited local configuration without exposing its contents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oathra-web-phone-"));
    const file = join(dir, "phone.yaml");
    try {
      writeFileSync(file, 'version: 1\nvoice:\n  engine: pipeline\n');
      const dialer = buildWebPhoneDialer({ configPath: file, env: {} });
      const before = await dialer.inspect();
      expect((await dialer.inspect()).configurationId).toBe(before.configurationId);
      writeFileSync(file, 'version: 1\nvoice:\n  engine: gpt-live\n');
      const after = await dialer.inspect();
      expect(after.configurationId).not.toBe(before.configurationId);
      expect(after.engine).toBe("gpt-live");
      writeFileSync(file, 'version: [');
      const invalid = await dialer.inspect();
      expect(invalid.ready).toBe(false);
      expect(invalid.issues).toEqual(["電話設定を読み込めません。oathra setup phone で設定を確認してください。"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("the public media URL is checked before anyone is rung", () => {
  const reply = (status: number, headers: Record<string, string> = {}) => (async () => new Response("", { status, headers })) as unknown as typeof fetch;
  it("an offline ngrok endpoint, a dead quick tunnel or an unreachable host is a reason not to dial", async () => {
    const { probePublicMediaUrl } = await import("./web-phone.js");
    expect(await probePublicMediaUrl("wss://gone.ngrok-free.app", reply(404, { "ngrok-error-code": "ERR_NGROK_3200" }))).toContain("停止");
    expect(await probePublicMediaUrl("wss://gone.trycloudflare.com", reply(530))).toContain("停止");
    expect(await probePublicMediaUrl("wss://nowhere.invalid", (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch)).toContain("接続できません");
  });
  it("a live tunnel with nothing listening yet is fine: the media server only starts when the call is placed", async () => {
    const { probePublicMediaUrl } = await import("./web-phone.js");
    expect(await probePublicMediaUrl("wss://live.ngrok-free.app", reply(502, { "ngrok-error-code": "ERR_NGROK_8012" }))).toBeUndefined();
    expect(await probePublicMediaUrl("wss://live.example.com", reply(426))).toBeUndefined();
  });
});
