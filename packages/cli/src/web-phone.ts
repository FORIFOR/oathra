/** Local Web adapter. Inspection never contacts a carrier or starts a tunnel. */
import { createHmac, randomBytes } from "node:crypto";
import type { PhoneDialer, PhoneReadiness } from "@oathra/arena";
import { parsePhoneRequest } from "@oathra/contract";
import { loadPhoneConfig, PhoneRouter, PhoneTransport, type CarrierMediaSession, type CarrierTransport } from "@oathra/phone";
import { CallRuntime } from "@oathra/runtime";
import { buildEngine, buildRegistry, parseEngineSpec, phoneRequestContract } from "./phone.js";

export function buildWebPhoneDialer(options: { configPath?: string; env?: NodeJS.ProcessEnv } = {}): PhoneDialer {
  const env = options.env ?? process.env;
  const key = randomBytes(32);
  function inspectConfig() {
    const issues: string[] = [];
    let config;
    try { config = loadPhoneConfig(options.configPath); }
    catch { return { readiness: { ready: false, issues: ["電話設定を読み込めません。oathra setup phone で設定を確認してください。"], provider: "未設定", engine: "未設定", recording: false, disclosure: "発信すると通信会社と音声AIへ情報を送信し、利用料金が発生します。" } satisfies PhoneReadiness }; }
    const providerId = config.routing.providers[0] ?? Object.keys(config.providers)[0];
    const cfg = providerId ? config.providers[providerId] : undefined;
    const registry = buildRegistry(env);
    const provider = providerId ? registry.provider(providerId) : undefined;
    if (!provider || !cfg) issues.push("通信会社が未設定です。ターミナルで oathra setup phone を実行してください。");
    // Web cancellation requires confirmed carrier hangup. Other adapters are CLI-only for now.
    if (provider && provider.id !== "twilio") issues.push("画面からの発信は現在 Twilio のみ対応しています。他の通信会社は CLI を使用してください。");
    for (const name of provider?.requires ?? []) if (!env[name]) issues.push(`${name} が未設定です。`);
    let spec;
    try { spec = parseEngineSpec(undefined, undefined, config.voice.engine); }
    catch { issues.push("音声AI設定を確認してください。"); }
    if (spec?.id === "pipeline") issues.push("画面からの依頼は gpt-live または realtime を設定してください。");
    if (!env.OPENAI_API_KEY) issues.push("OPENAI_API_KEY が未設定です。");
    if (provider?.id === "twilio") {
      if (!/^\+[1-9]\d{7,14}$/.test(String(cfg?.from ?? env.TWILIO_PHONE_NUMBER ?? ""))) issues.push("Twilio の発信元電話番号を設定してください。");
      try {
        const url = new URL(String(cfg?.publicWsUrl ?? env.OATHRA_PUBLIC_WS_URL ?? ""));
        if (url.protocol !== "wss:" || url.username || url.password || url.search || url.hash || /[<>"&]/.test(String(cfg?.publicWsUrl ?? env.OATHRA_PUBLIC_WS_URL ?? "")) || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error();
      } catch { issues.push("OATHRA_PUBLIC_WS_URL に設定済みの公開 wss:// 接続先が必要です。画面から公開トンネルは作成しません。"); }
    }
    if (cfg?.port !== undefined && (!Number.isInteger(cfg.port) || Number(cfg.port) < 1 || Number(cfg.port) > 65535)) issues.push("音声接続ポートには1〜65535を設定してください。");
    let route;
    if (provider && cfg && !issues.length) {
      route = new PhoneRouter(registry, { ...config, routing: { strategy: "preferred", providers: [provider.id] } }, env).candidates()[0];
      if (!route) issues.push("通信会社の設定が不足しています。oathra setup phone で確認してください。");
    }
    const configurationId = createHmac("sha256", key).update(JSON.stringify({ config, env: Object.fromEntries(Object.entries(env).filter(([name]) => /^(OPENAI_|TWILIO_|OATHRA_PUBLIC_WS_URL)/.test(name))) })).digest("hex");
    const readiness: PhoneReadiness = {
      ready: issues.length === 0, issues, provider: provider?.label ?? "未設定", engine: spec ? `${spec.id}${spec.model ? `:${spec.model}` : ""}` : "未設定",
      recording: false, configurationId,
      disclosure: "AIが代理で電話し、最初にAIであることを伝えます。電話番号はTwilioへ、名前・目的・通話音声はTwilioとOpenAIへ送信します。通信会社・AIの従量料金が発生します。音声ファイルは保存せず、会話テキストと結果をこの端末に保存します。最大3分の設定は通信会社の請求上限を保証しません。接続確認は未実施です。",
    };
    return { readiness, spec, route };
  }
  return {
    inspect() { return inspectConfig().readiness; },
    async execute(input, ctx) {
      const request = parsePhoneRequest(input);
      const current = inspectConfig();
      if (!current.readiness.ready || !current.route || !current.spec) throw new Error("電話設定が不足しています。設定を確認してから再度内容を確認してください。");
      if (!ctx.reviewedConfigurationId || current.readiness.configurationId !== ctx.reviewedConfigurationId) throw new Error("電話設定が変更されました。発信内容をもう一度確認してください。");
      ctx.signal.throwIfAborted();
      const engine = buildEngine(current.spec, env);
      const original = current.route.transport;
      let media: CarrierMediaSession | undefined;
      let ending: Promise<void> | undefined;
      let hangupError = false;
      const end = (reason?: string) => {
        if (!ending && media) ending = media.hangup(reason).catch(() => { hangupError = true; });
        return ending ?? Promise.resolve();
      };
      const carrier: CarrierTransport = {
        providerId: original.providerId, path: original.path, describe: () => original.describe(),
        async dial(opts) {
          ctx.signal.throwIfAborted();
          media = await original.dial(opts);
          if (ctx.signal.aborted) { await end("cancelled"); ctx.signal.throwIfAborted(); }
          return { audio: media.audio, events: media.events, send: chunk => media!.send(chunk), clear: () => media!.clear(), now: () => media!.now(), hangup: end, ...(media.mark ? { mark: (name: string) => media!.mark!(name) } : {}) };
        },
      };
      const runtime = new CallRuntime({ contract: phoneRequestContract(request), transport: new PhoneTransport(carrier, engine), brain: { name: engine.id, respond: async () => { throw new Error("voice engine supplies responses"); } }, callId: ctx.callId, onEvent: ctx.onEvent, openingTimeoutMs: 4000 });
      const abort = () => { runtime.cancel(); void end("cancelled"); };
      ctx.signal.addEventListener("abort", abort, { once: true });
      const durationLimit = setTimeout(abort, 180000);
      durationLimit.unref();
      try {
        ctx.signal.throwIfAborted();
        const outcome = await runtime.run();
        await end(outcome.endReason);
        if (!media) throw new Error("通信会社の発信結果を確認できません。管理画面で確認してください。");
        if (hangupError) throw new Error("通信会社での終了を確認できません。管理画面で通話状態を確認してください。再発信しないでください。");
        return outcome;
      } finally {
        clearTimeout(durationLimit);
        ctx.signal.removeEventListener("abort", abort);
        await end("adapter_cleanup");
      }
    },
  };
}
