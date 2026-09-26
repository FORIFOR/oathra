/** Local Web adapter. Inspection never contacts a carrier or starts a tunnel. */
import { createHmac, randomBytes } from "node:crypto";
import { PhoneNotDialedError, type PhoneDialer, type PhoneEngineChoice, type PhoneReadiness } from "@oathra/arena";
import { ENGINE_DEFAULT_VOICE, ENGINE_VOICES, parsePhoneRequest, type PhoneEngine, type PhoneRequest } from "@oathra/contract";
import { loadPhoneConfig, PhoneRouter, PhoneTransport, type CarrierMediaSession, type CarrierTransport } from "@oathra/phone";
import { CallRuntime } from "@oathra/runtime";
import { buildEngine, buildRegistry, parseEngineSpec, phoneRequestContract, type EngineSpec } from "./phone.js";

/**
 * Whether the public URL Twilio will stream to answers at all. Before dialing nothing listens behind it yet,
 * so "the tunnel answers" is the test: an offline ngrok endpoint, a dead quick tunnel or a name that does not
 * resolve means the carrier would ring the callee and hang up two seconds later.
 */
export async function probePublicMediaUrl(wsUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  const url = new URL(wsUrl);
  url.protocol = "https:";
  let res: Response;
  try { res = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) }); }
  catch { return `公開接続先 ${url.host} に接続できません。トンネル（ngrok など）が起動しているか確認してください。`; }
  const ngrok = res.headers.get("ngrok-error-code") ?? "";
  // ERR_NGROK_3200: the endpoint is offline. (8012 = tunnel up, nothing listening yet: expected before a call.)
  if (ngrok === "ERR_NGROK_3200" || ngrok === "ERR_NGROK_3004") return `公開接続先 ${url.host} のトンネルが停止しています（${ngrok}）。ngrok を 4243 番に向けて起動し、表示された URL を OATHRA_PUBLIC_WS_URL に設定してください。`;
  if (res.status === 530) return `公開接続先 ${url.host} のトンネルが停止しています（HTTP 530）。`;
  return undefined;
}

export function buildWebPhoneDialer(options: { configPath?: string; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): PhoneDialer {
  const env = options.env ?? process.env;
  const key = randomBytes(32);
  /** Which speech-to-speech engines this machine can run, from the keys in its environment. */
  function engineChoices(configured: string | undefined): { engines: PhoneEngineChoice[]; defaultEngine: PhoneEngine } {
    const list: Array<[PhoneEngine, string, string[]]> = [["gpt-live", "GPT-Live (gpt-live-1)", ["OPENAI_API_KEY"]], ["gemini-live", "Gemini Live (gemini-3.8-live)", ["GEMINI_API_KEY"]]];
    const engines = list.map(([id, label, keys]) => ({ id, label, voices: [...ENGINE_VOICES[id]], defaultVoice: ENGINE_DEFAULT_VOICE[id], issues: keys.filter((k) => !env[k]).map((k) => `${k} が未設定です。`), ready: keys.every((k) => !!env[k]) }));
    const defaultEngine: PhoneEngine = configured === "gemini-live" ? "gemini-live" : "gpt-live";
    return { engines, defaultEngine };
  }
  function inspectConfig(request?: PhoneRequest) {
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
    const choices = engineChoices(config.voice.engine);
    let spec: EngineSpec | undefined;
    try { spec = parseEngineSpec(request?.engine ?? undefined, undefined, config.voice.engine); }
    catch { issues.push("音声AI設定を確認してください。"); }
    if (spec?.id === "pipeline") issues.push("画面からの依頼は gpt-live か gemini-live を設定してください。");
    const chosen = choices.engines.find((e) => e.id === spec?.id);
    for (const issue of chosen?.issues ?? []) issues.push(issue);
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
    const configurationId = createHmac("sha256", key).update(JSON.stringify({ config, engine: spec?.id, env: Object.fromEntries(Object.entries(env).filter(([name]) => /^(OPENAI_|GEMINI_|TWILIO_|OATHRA_PUBLIC_WS_URL)/.test(name))) })).digest("hex");
    const vendor = spec?.id === "gemini-live" ? "Google" : "OpenAI";
    const readiness: PhoneReadiness = {
      ready: issues.length === 0, issues, provider: provider?.label ?? "未設定", engine: spec ? `${spec.id}${spec.model ? `:${spec.model}` : ""}` : "未設定",
      recording: false, configurationId, engines: choices.engines, defaultEngine: choices.defaultEngine,
      disclosure: `AIが代理で電話し、最初にAIであることを伝えます。電話番号はTwilioへ、名前・目的・通話音声はTwilioと${vendor}へ送信します。通信会社・AIの従量料金が発生します。音声ファイルは保存せず、会話テキストと結果をこの端末に保存します。相手には最初に「この通話は記録されています。」と案内します。最大3分の設定は通信会社の請求上限を保証しません。接続確認は未実施です。`,
    };
    return { readiness, spec, route, publicWsUrl: provider?.id === "twilio" ? String(cfg?.publicWsUrl ?? env.OATHRA_PUBLIC_WS_URL ?? "") : "" };
  }
  let probed: { url: string; at: number; problem: string | undefined } | undefined;
  async function reachability(url: string): Promise<string | undefined> {
    if (!url) return undefined;
    if (probed && probed.url === url && Date.now() - probed.at < 15_000) return probed.problem;
    const problem = await probePublicMediaUrl(url, options.fetchImpl);
    probed = { url, at: Date.now(), problem };
    return problem;
  }
  return {
    async inspect(request?: PhoneRequest) {
      const current = inspectConfig(request);
      if (!current.readiness.ready) return current.readiness;
      const problem = await reachability(current.publicWsUrl ?? "");
      return problem ? { ...current.readiness, ready: false, issues: [problem] } : current.readiness;
    },
    async execute(input, ctx) {
      const request = parsePhoneRequest(input);
      const current = inspectConfig(request);
      if (!current.readiness.ready || !current.route || !current.spec) throw new PhoneNotDialedError("電話設定が不足しています。設定を確認してから再度内容を確認してください。");
      if (!ctx.reviewedConfigurationId || current.readiness.configurationId !== ctx.reviewedConfigurationId) throw new PhoneNotDialedError("電話設定が変更されました。発信内容をもう一度確認してください。");
      // Checked again right before dialing, never from the cache: a tunnel that died after review must not ring anyone.
      probed = undefined;
      const unreachable = await reachability(current.publicWsUrl ?? "");
      if (unreachable) throw new PhoneNotDialedError(unreachable);
      ctx.signal.throwIfAborted();
      const engine = buildEngine(current.spec, env, request.voice);
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
      const runtime = new CallRuntime({ contract: phoneRequestContract(request), transport: new PhoneTransport(carrier, engine, { transcriptNotice: true }), brain: { name: engine.id, respond: async () => { throw new Error("voice engine supplies responses"); } }, callId: ctx.callId, onEvent: ctx.onEvent, openingTimeoutMs: 4000 });
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
