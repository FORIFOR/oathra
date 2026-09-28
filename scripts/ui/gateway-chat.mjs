// Gateway workspace, 雑談: the purpose list's fourth choice is a phone request in chat mode, spoken by the standard voice or,
// where its services are set up, the acting voice. Practice (simulator) mode on a throwaway workspace: nothing dials.
// usage: node scripts/ui/gateway-chat.mjs   (needs `pnpm build`; writes artifacts/ui/gateway-chat-*.png)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checklist, freePort, launch, serve, sleep } from "./cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.env.OATHRA_UI_ARTIFACTS ? resolve(process.env.OATHRA_UI_ARTIFACTS) : join(root, "artifacts/ui");
const c = checklist("gateway chat");

// One workspace per run; `keys` are placeholders (never used: practice mode does not reach any provider).
async function workspace(keys) {
  const work = mkdtempSync(join(tmpdir(), "oathra-gateway-chat-"));
  const port = await freePort(), base = `http://localhost:${port}`;
  execFileSync("node", [join(root, "apps/gateway/setup.mjs")], { cwd: work, stdio: "ignore" });
  const envFile = join(work, ".env.gateway");
  writeFileSync(envFile, readFileSync(envFile, "utf8").replace("http://localhost:4244", base) + `PORT='${port}'\n` + Object.entries(keys).map(([k, v]) => `${k}='${v}'\n`).join(""));
  const token = readFileSync(join(work, ".oathra/operator-token.txt"), "utf8").trim();
  // Blank, not absent: serve() starts from this shell's environment, which may hold real keys.
  const env = Object.fromEntries(["DEEPGRAM_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"].filter((k) => !(k in keys)).map((k) => [k, ""]));
  const server = await serve("node", [`--env-file=${envFile}`, join(root, "apps/gateway/server.mjs")], { cwd: work, url: `${base}/healthz`, env });
  return { base, token, stop: () => { server.stop(); rmSync(work, { recursive: true, force: true }); } };
}
async function signIn(page, ws) {
  await page.goto(ws.base + "/workspace");
  await page.js(`document.querySelector('#token').value=${JSON.stringify(ws.token)};document.querySelector('#login-form').requestSubmit()`);
  await page.until("!document.querySelector('#workspace').hidden", { label: "workspace" });
  await page.js("document.querySelector('#consent').click()"); await sleep(400);
}
const chooseChat = (page) => page.click("input[name=goal][value=chat]");

let ws, page;
try {
  // Without the acting voice's services: the standard voice only, and the options say why.
  ws = await workspace({});
  page = await launch({ width: 1440, height: 900 });
  await signIn(page, ws);
  await chooseChat(page); await sleep(200);
  c.ok(await page.js("document.querySelector('#product').closest('label').hidden && !document.querySelector('#voice-field').hidden && document.querySelector('#test-me').closest('label').hidden"), "雑談 hides the product and the self-test, and shows the voice");
  c.ok(/近況/.test(await page.js("document.querySelector('#request').value")), "the suggested request follows 雑談");
  const off = await page.js("[...document.querySelectorAll('#chat-voice option')].filter(o=>o.value).map(o=>o.disabled+':'+o.textContent).join(' / ')");
  c.ok(/^true:.*未設定.* \/ true:.*未設定/.test(off), "acting voices not set up: disabled, and the option says so", off);
  // No name yet: the request stops and opens the setting instead of calling under nobody's name.
  await page.js("document.querySelector('#mission-form').requestSubmit()"); await sleep(500);
  c.ok(await page.js("document.querySelector('#s-caller').open") && /名乗る名前/.test(await page.text("#notice") ?? ""), "雑談 without a name opens 「電話で名乗る名前」 and says why");
  await page.js("{const n=document.querySelector('#caller-name');n.value='田中';n.dispatchEvent(new Event('input',{bubbles:true}))}");
  await page.click("#caller-form button[type=submit]"); await sleep(500);
  c.ok(await page.noPageScroll(), "the board still fits 1440x900 with the voice field");
  await page.js("document.querySelector('#mission-form').requestSubmit()");
  await page.until("document.querySelector('#review').open", { label: "review" });
  const review = await page.text("#review-content");
  c.ok(/雑談/.test(review) && /田中さんの代わりに/.test(review) && /標準の声/.test(review) && !/AIが説明してよいこと/.test(review), "the review says 雑談, the name the AI gives, and the voice; no product rows", review.replace(/\s+/g, " ").slice(0, 200));
  c.ok(!/simulator|\$|[a-z]+_[a-z_]+/.test(review), "no internal words or bare dollar amounts in the review");
  c.ok(await page.js("document.querySelector('#review-content').firstElementChild.classList.contains('notice')"), "practice: the notice comes first, before the rows");
  await page.screenshot(join(out, "gateway-chat-review.png"));
  await page.js("document.querySelector('#review').scrollTop=1e5; document.querySelector('#review form, #review').querySelector('#start-call').scrollIntoView({block:'end'})"); await sleep(200);
  await page.screenshot(join(out, "gateway-chat-review-end.png"));
  c.ok(await page.js("document.querySelector('#start-call').disabled") && /練習モードでは試せません/.test(review), "practice: 雑談 cannot be placed, and the review says so before anyone ticks the box");
  await page.press("Escape"); await sleep(300);
  c.ok(/雑談/.test(await page.text("#history")), "the draft is in the history as 雑談");
  // 「同じ相手にもう一度」 is for finished calls; a draft offers 「内容を確認して電話する」 instead.
  c.ok(/内容を確認して電話する/.test(await page.text("#detail .actions")), "the draft can be reviewed again from the detail");
  c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" "));
  await page.close(); page = undefined; ws.stop(); ws = undefined;

  // With the services set up: the acting voice can be chosen and the review names where the data goes.
  ws = await workspace({ DEEPGRAM_API_KEY: "placeholder", OPENAI_API_KEY: "placeholder", GEMINI_API_KEY: "placeholder" });
  page = await launch({ width: 390, height: 844 });
  await signIn(page, ws);
  await page.js("{const n=document.querySelector('#caller-name');n.value='田中';document.querySelector('#caller-form').requestSubmit()}"); await sleep(600);
  await chooseChat(page); await sleep(200);
  c.ok(await page.js("[...document.querySelectorAll('#chat-voice option')].every(o=>!o.disabled)"), "acting voices set up: they can be chosen");
  await page.js("{const s=document.querySelector('#chat-voice');s.value='character-male';s.dispatchEvent(new Event('change',{bubbles:true}))}");
  await page.js("document.querySelector('#mission-form').requestSubmit()");
  await page.until("document.querySelector('#review').open", { label: "review (acting)" });
  const acting = await page.text("#review-content");
  c.ok(/演技する声・男性/.test(acting) && /2〜3秒/.test(acting), "the review names the acting voice and its wait", acting.replace(/\s+/g, " ").slice(0, 200));
  c.ok(await page.noSidewaysScroll(), "390: no sideways scroll");
  await page.screenshot(join(out, "gateway-chat-review-mobile.png"));
  await page.js("document.querySelector('#start-call').scrollIntoView({block:'end'})"); await sleep(200);
  await page.screenshot(join(out, "gateway-chat-review-mobile-end.png"));
  c.ok(page.pageErrors.length === 0, "no page errors (390)", page.pageErrors.join(" "));
} finally {
  await page?.close(); ws?.stop();
}
c.finish();
