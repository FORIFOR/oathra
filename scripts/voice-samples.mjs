// Records one short sample per GPT-Live voice and measures what can be measured about it, so the voice
// picker can say more than a name. Uses the real Live API (about ten seconds per voice, a few yen in all);
// nothing is dialled. Run with: node --env-file=<env with OPENAI_API_KEY> scripts/voice-samples.mjs
//
// What is measured: median fundamental frequency of the voiced frames (how high the voice is) and how long
// the same sentence takes. Whether a voice "is male" is not something a file can state: the labels below are
// derived from pitch alone and say so.
//
// `--measure` re-measures the existing recordings without recording again: each sample goes through the phone
// path (8 kHz mu-law), is transcribed, and compared with the sentence (phoneCer: 0 = heard exactly), and its
// level on the line is taken (phoneLevel). These two and the pace are what a recommendation is based on.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(resolve("providers/openai-realtime/package.json"));
const WebSocket = require("ws");
const { PHONE_VOICES } = await import(resolve("packages/contract/dist/index.js"));
const { wavFromInt16, mulawEncode, mulawDecode } = await import(resolve("providers/audio-kit/dist/index.js"));

const key = process.env.OPENAI_API_KEY;
if (!key) { console.error("BLOCKED: OPENAI_API_KEY is required"); process.exit(2); }
const out = resolve("apps/gateway/public/phone/voices");
mkdirSync(out, { recursive: true });
const LINE = "もしもし。AIによる代理のお電話です。今、少しお話しできますか？";
const RATE = 24000;

async function record(voice) {
  const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${key}` } });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  const chunks = [];
  let timer, lastAudible = 0, started = 0;
  const done = new Promise((res) => {
    const finish = () => { clearInterval(timer); try { ws.send(JSON.stringify({ type: "session.close" })); } catch { /* closing */ } setTimeout(() => { ws.close(); res(); }, 300); };
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "error") console.error(voice, "error", m.error?.code, String(m.error?.message ?? "").slice(0, 120));
      if (m.type === "session.started") {
        started = Date.now();
        // Context is applied on the audio timeline, so the line has to be running before the words are sent.
        const frame = () => { const b = Buffer.alloc(960); for (let i = 0; i < 960; i += 2) b.writeInt16LE(Math.round((Math.random() - 0.5) * 40), i); return b.toString("base64"); };
        timer = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "session.input_audio.append", audio: frame() })); if (Date.now() - started > 14000 || (lastAudible && Date.now() - lastAudible > 1300)) finish(); }, 20);
        setTimeout(() => ws.send(JSON.stringify({ type: "session.commentary.append", event_id: `sample_${voice}`, delegation_id: null, content: LINE })), 600);
      }
      if (m.type === "session.output_audio.delta" && m.delta) {
        const b = Buffer.from(m.delta, "base64"), pcm = new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
        chunks.push(Int16Array.from(pcm));
        for (const s of pcm) if (Math.abs(s) >= 600) { lastAudible = Date.now(); break; }
      }
    });
  });
  ws.send(JSON.stringify({ type: "session.start", event_id: "s", session: { model: "gpt-live-1", instructions: "渡された文を、落ち着いた自然な日本語でそのまま一度だけ話してください。言い換えや付け足しはしないでください。", audio: { format: { type: "audio/pcm", rate: RATE }, output: { voice } }, delegation: { type: "client" } } }));
  await done;
  const total = chunks.reduce((n, c) => n + c.length, 0), pcm = new Int16Array(total);
  let at = 0; for (const c of chunks) { pcm.set(c, at); at += c.length; }
  // Trim leading and trailing silence.
  let a = 0, z = pcm.length - 1;
  while (a < pcm.length && Math.abs(pcm[a]) < 600) a++;
  while (z > a && Math.abs(pcm[z]) < 600) z--;
  return pcm.slice(Math.max(0, a - RATE * 0.05), Math.min(pcm.length, z + RATE * 0.15));
}

/** Median F0 of voiced 40 ms frames by normalized autocorrelation, 70-400 Hz. */
function pitchHz(pcm) {
  const size = Math.round(RATE * 0.04), hop = Math.round(RATE * 0.02), minLag = Math.floor(RATE / 400), maxLag = Math.ceil(RATE / 70), found = [];
  for (let start = 0; start + size + maxLag < pcm.length; start += hop) {
    let energy = 0; for (let i = 0; i < size; i++) energy += pcm[start + i] ** 2;
    if (Math.sqrt(energy / size) < 900) continue;
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0, d1 = 0, d2 = 0;
      for (let i = 0; i < size; i++) { const x = pcm[start + i], y = pcm[start + i + lag]; num += x * y; d1 += x * x; d2 += y * y; }
      const r = num / Math.sqrt(d1 * d2 || 1);
      if (r > best) { best = r; bestLag = lag; }
    }
    if (best > 0.6 && bestLag) found.push(RATE / bestLag);
  }
  found.sort((x, y) => x - y);
  return found.length ? found[Math.floor(found.length / 2)] : null;
}

/** How the sample survives the phone line: character error rate of its transcription, and its level there. */
async function onThePhone(voice) {
  const wav = readFileSync(join(out, `${voice}.wav`)), pcm16k = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1);
  const pcm8k = new Int16Array(pcm16k.length >> 1);
  for (let i = 0; i < pcm8k.length; i++) pcm8k[i] = (pcm16k[2 * i] + pcm16k[2 * i + 1]) >> 1;
  const line = mulawDecode(mulawEncode(pcm8k));
  const form = new FormData();
  form.append("model", "gpt-4o-mini-transcribe"); form.append("language", "ja");
  form.append("file", new Blob([wavFromInt16(line, 8000)], { type: "audio/wav" }), `${voice}.wav`);
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
  if (!r.ok) throw new Error(`transcription ${r.status}`);
  const norm = (t) => t.normalize("NFKC").replace(/[\s、。，．！？!?「」・…]/g, "");
  const a = norm(LINE), b = norm((await r.json()).text ?? ""), d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  let sum = 0, n = 0;
  for (const v of line) if (Math.abs(v) > 600) { sum += v * v; n++; }
  return { phoneCer: Number((d[a.length][b.length] / a.length).toFixed(2)), phoneLevel: Math.round(Math.sqrt(sum / Math.max(1, n))) };
}

if (process.argv.includes("--measure")) {
  const file = join(out, "voices.json"), saved = JSON.parse(readFileSync(file, "utf8"));
  for (const voice of Object.keys(saved.voices)) { Object.assign(saved.voices[voice], await onThePhone(voice)); console.log(voice.padEnd(10), JSON.stringify(saved.voices[voice])); }
  saved.note = "pitchHz: median fundamental frequency of one sample. phoneCer/phoneLevel: the same sample after the 8 kHz mu-law phone path, transcribed and compared with the sentence (0 = heard exactly; a paraphrase by the model also counts as error), and its RMS level there. Labels derived from these describe a voice, not a person.";
  writeFileSync(file, JSON.stringify(saved, null, 1) + "\n");
  process.exit(0);
}

const results = {};
for (const voice of PHONE_VOICES) {
  const pcm = await record(voice), seconds = pcm.length / RATE, hz = pitchHz(pcm);
  if (seconds < 1 || !hz) { console.error(`${voice}: no usable sample (${seconds.toFixed(1)} s)`); continue; }
  // 16 kHz is plenty for a preview and keeps each file near 100 KB.
  const down = new Int16Array(Math.floor(pcm.length * 2 / 3));
  for (let i = 0; i < down.length; i++) { const p = i * 1.5, i0 = Math.floor(p), f = p - i0; down[i] = Math.round(pcm[i0] * (1 - f) + (pcm[Math.min(pcm.length - 1, i0 + 1)]) * f); }
  writeFileSync(join(out, `${voice}.wav`), wavFromInt16(down, 16000));
  results[voice] = { pitchHz: Math.round(hz), seconds: Number(seconds.toFixed(1)), ...(await onThePhone(voice)) };
  console.log(voice.padEnd(10), `${Math.round(hz)} Hz`, `${seconds.toFixed(1)} s`);
}
writeFileSync(join(out, "voices.json"), JSON.stringify({ measuredOn: new Date().toISOString().slice(0, 10), line: LINE, note: "pitchHz is the median fundamental frequency of one sample; labels derived from it describe pitch, not a person.", voices: results }, null, 1) + "\n");
console.log("written:", Object.keys(results).length, "voices ->", out);
process.exit(0);
