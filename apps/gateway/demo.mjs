// Local practice on this computer, with no setup: the Gateway app in simulator mode (nothing dials, no key is needed),
// opened without signing in (OATHRA_LOCAL_OPEN, loopback + localhost only). The account and its data live in
// .oathra/demo/ and are kept between runs. Real calls need the full setup in README.md, not this script.
//   node apps/gateway/demo.mjs [--port 4250] [--no-open]      (also what `oathra demo` starts)
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from './lib/security.mjs';

/** Start the practice gateway; resolves once it listens. */
export async function startDemo({ port = 4250, open = true, dataDir = resolve('.oathra/demo') } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port は 1〜65535 の数字で指定してください。');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'demo.json');
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : (() => {
    const s = { user: { id: randomUUID(), team: 'local', role: 'admin' }, token: randomBytes(32).toString('hex'), dataKey: randomBytes(32).toString('hex') };
    writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 }); return s;
  })();
  const url = `http://localhost:${port}`;
  // Only this script's settings: a real .env in the shell must not turn a practice server into one that can dial or spend.
  for (const k of Object.keys(process.env)) if (/^(OATHRA_(?!GATEWAY_ROOT$)|TWILIO_|LIVEKIT_|OPENAI_|GEMINI_|GOOGLE_|DEEPGRAM_|ANTHROPIC_)/.test(k)) delete process.env[k];
  Object.assign(process.env, {
    OATHRA_MODE: 'simulator', OATHRA_LOCAL_OPEN: 'true', HOST: '127.0.0.1', PORT: String(port), OATHRA_PUBLIC_URL: url,
    OATHRA_USERS_JSON: JSON.stringify([{ ...saved.user, tokenHash: hash(saved.token) }]), OATHRA_DATA_KEY: saved.dataKey, OATHRA_DB: join(dataDir, 'gateway.sqlite'),
  });
  const { configuration, createGateway } = await import('./server.mjs');
  const config = configuration(process.env), app = await createGateway(config);
  app.worker.start();
  await new Promise((ok, fail) => { app.server.once('error', fail); app.server.listen(config.port, config.host, ok); });
  if (open) execFile(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], () => {});
  return { url, close: () => app.close() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), i = args.indexOf('--port');
  const demo = await startDemo({ port: Number(i >= 0 ? args[i + 1] : 4250), open: !args.includes('--no-open') });
  console.log(`Oathra（練習用・電話はかかりません）: ${demo.url}`);
  console.log('ログインは不要です（このパソコンから開いたときだけ）。止めるには Ctrl+C。');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void demo.close().then(() => process.exit(0)); });
}
