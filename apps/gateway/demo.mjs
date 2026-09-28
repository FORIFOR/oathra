// Local practice on this computer, with no setup: the Gateway app in simulator mode (nothing dials, no key is needed),
// opened without signing in (OATHRA_LOCAL_OPEN, loopback + localhost only). The account and its data live in
// .oathra/demo/ and are kept between runs. Real calls need the full setup in README.md, not this script.
//   node apps/gateway/demo.mjs [--port 4250] [--no-open]
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { hash } from './lib/security.mjs';

const args = process.argv.slice(2), flag = n => args.includes(n), value = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const port = Number(value('--port', '4250'));
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('--port は 1〜65535 の数字で指定してください。'); process.exit(2); }
const dir = resolve('.oathra/demo'); mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = join(dir, 'demo.json');
const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : (() => {
  const s = { user: { id: randomUUID(), team: 'local', role: 'admin' }, token: randomBytes(32).toString('hex'), dataKey: randomBytes(32).toString('hex') };
  writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 }); return s;
})();
const url = `http://localhost:${port}`;
const env = {
  OATHRA_MODE: 'simulator', OATHRA_LOCAL_OPEN: 'true', HOST: '127.0.0.1', PORT: String(port), OATHRA_PUBLIC_URL: url,
  OATHRA_USERS_JSON: JSON.stringify([{ ...saved.user, tokenHash: hash(saved.token) }]), OATHRA_DATA_KEY: saved.dataKey, OATHRA_DB: join(dir, 'gateway.sqlite'),
};
// Only this script's settings: a real .env in the shell must not turn a practice server into one that can dial or spend.
for (const k of Object.keys(process.env)) if (/^(OATHRA_|TWILIO_|LIVEKIT_|OPENAI_|GEMINI_|GOOGLE_|DEEPGRAM_|ANTHROPIC_)/.test(k)) delete process.env[k];
Object.assign(process.env, env);
const { configuration, createGateway } = await import('./server.mjs');
const config = configuration(process.env), app = await createGateway(config);
app.worker.start();
app.server.listen(config.port, config.host, () => {
  console.log(`Oathra（練習用・電話はかかりません）: ${url}`);
  console.log('ログインは不要です（このパソコンから開いたときだけ）。止めるには Ctrl+C。');
  if (!flag('--no-open')) execFile(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], () => {});
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
