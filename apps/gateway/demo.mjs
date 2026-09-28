// The Oathra app on this computer (also what `oathra demo` starts). By default: practice mode (nothing dials, no key is
// needed), opened without signing in from this computer only (OATHRA_LOCAL_OPEN: loopback + localhost). Other devices
// (LAN or a tunnel) sign in with the link printed at start. The account and its data live in .oathra/demo/.
//   node apps/gateway/demo.mjs [--port 4250] [--no-open] [--allow-remote]
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from './lib/security.mjs';

/** This computer's addresses on the local network (what another device on the same Wi-Fi opens). */
export function lanAddresses() {
  return Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
}

/**
 * Start the app; resolves once it listens.
 * - lan: listen on every interface and accept the LAN addresses as this app's pages (sign-in link required there).
 * - tunnelUrl: an https address that forwards here (cloudflared/ngrok), accepted the same way.
 * - live: real calls, with the carrier and voice keys from this environment; needs tunnelUrl (the carrier calls back).
 * - brains: extra practice AIs (name -> factory), for `--allow-models`; their keys stay in the environment.
 */
export async function startDemo({ port = 4250, open = true, dataDir = resolve('.oathra/demo'), records = resolve('.oathra/calls'), lan = false, tunnelUrl, live = false, brains } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port は 1〜65535 の数字で指定してください。');
  if (live && !/^https:\/\//.test(tunnelUrl ?? '')) throw new Error('実際の電話には、電話会社から届く公開URL（--tunnel）が必要です。');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'demo.json');
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : (() => {
    const s = { user: { id: randomUUID(), team: 'local', role: 'admin' }, token: randomBytes(32).toString('hex'), dataKey: randomBytes(32).toString('hex') };
    writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 }); return s;
  })();
  const url = `http://localhost:${port}`;
  // Only this app's settings: a real .env in the shell must not turn a practice server into one that can dial or spend.
  // Real calls keep the carrier and voice keys; --allow-models keeps only the model keys.
  const keep = live ? /^(OATHRA_GATEWAY_ROOT$)/ : brains ? /^(OATHRA_GATEWAY_ROOT$|OPENAI_|GEMINI_|GOOGLE_|ANTHROPIC_|OLLAMA_)/ : /^OATHRA_GATEWAY_ROOT$/;
  const drop = live ? /^(OATHRA_(USERS_JSON|DATA_KEY|DB|MODE|PUBLIC_URL|LOCAL_OPEN|DEPLOYMENT)$)/ : /^(OATHRA_|TWILIO_|LIVEKIT_|PLIVO_|OPENAI_|GEMINI_|GOOGLE_|DEEPGRAM_|ANTHROPIC_|OLLAMA_)/;
  for (const k of Object.keys(process.env)) if (drop.test(k) && !keep.test(k)) delete process.env[k];
  Object.assign(process.env, {
    OATHRA_MODE: live ? 'live' : 'simulator', OATHRA_LOCAL_OPEN: live ? 'false' : 'true', HOST: lan ? '0.0.0.0' : '127.0.0.1', PORT: String(port), OATHRA_PUBLIC_URL: live ? tunnelUrl : url,
    OATHRA_USERS_JSON: JSON.stringify([{ ...saved.user, tokenHash: hash(saved.token) }]), OATHRA_DATA_KEY: saved.dataKey, OATHRA_DB: join(dataDir, 'gateway.sqlite'),
  });
  const { configuration, createGateway } = await import('./server.mjs');
  const config = configuration(process.env);
  const lanUrls = lan ? lanAddresses().map(a => `http://${a}:${port}`) : [];
  config.origins = [...lanUrls, ...(tunnelUrl && !live ? [tunnelUrl] : [])];
  const app = await createGateway(config, { practice: { brains: brains ?? {}, records } });
  // One app per data folder: a second `oathra demo` here (or one stopped a moment ago) still holds the worker for 30 s.
  try { app.worker.start(); }
  catch (e) { await app.close(); if (e.code === 'another_gateway_worker_is_active' || /another_gateway_worker/.test(e.message)) throw new Error('このフォルダでは、すでに別の oathra demo が動いています。止めてから（止めた直後なら30秒ほど待って）もう一度どうぞ。'); throw e; }
  await new Promise((ok, fail) => { app.server.once('error', fail); app.server.listen(config.port, config.host, ok); });
  if (open) execFile(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [live ? signIn(tunnelUrl, saved.token) : url], () => {});
  return { url, lanUrls, tunnelUrl, live, liveReady: config.liveReady, missing: config.missing, signIn: base => signIn(base, saved.token), close: () => app.close() };
}
/** A link that signs this browser in (the app reads the token from the fragment, which never reaches a server log). */
const signIn = (base, token) => `${base.replace(/\/$/, '')}/#token=${token}`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), i = args.indexOf('--port');
  const demo = await startDemo({ port: Number(i >= 0 ? args[i + 1] : 4250), open: !args.includes('--no-open'), lan: args.includes('--allow-remote') });
  console.log(`Oathra（練習用・電話はかかりません）: ${demo.url}`);
  console.log('このパソコンからはログイン不要です。止めるには Ctrl+C。');
  for (const u of demo.lanUrls) console.log(`別の端末から（同じネットワーク）: ${demo.signIn(u)}`);
  if (demo.lanUrls.length) console.log('このリンクを知っている人は、このアプリを操作できます。共有しないでください。');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void demo.close().then(() => process.exit(0)); });
}
