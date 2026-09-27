// Arena phone form: the voice is one choice of cards. Real Arena server and the real web-phone dialer on a temp
// config with placeholder keys and no carrier: nothing can dial. Checks which engine and voice each card sends.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startArena } from "../../apps/arena/dist/index.js";
import { buildWebPhoneDialer } from "../../packages/cli/dist/web-phone.js";
import { checklist, launch, sleep } from "./cdp.mjs";

const work = mkdtempSync(join(tmpdir(), "oathra-voice-cards-"));
const out = resolve("artifacts/ui"); mkdirSync(out, { recursive: true });
const config = join(work, "phone.yaml"); writeFileSync(config, "version: 1\nvoice:\n  engine: gpt-live\n");
const arenaFor = (env) => startArena({ scenariosDir: resolve("scenarios"), brains: {}, callsDir: join(work, "calls"), phoneHistoryDir: join(work, "phone"), port: 0, phoneDialer: buildWebPhoneDialer({ configPath: config, env }) });
const c = checklist("voice cards");
const state = "[document.querySelector('#phone-engine').value,document.querySelector('#phone-voice').value,document.querySelector('#phone-preset').value].join('/')";
const pick = (value) => `document.querySelector('input[name=phone-voice-card][value="${value}"]').click()`;
let arena = await arenaFor({ OPENAI_API_KEY: "placeholder", GEMINI_API_KEY: "placeholder", DEEPGRAM_API_KEY: "placeholder" }), page;
try {
  page = await launch({ width: 1440, height: 900 });
  await page.goto(arena.url + "/?lang=ja&phone=1");
  await page.until("document.querySelectorAll('.voice-card').length===7");
  c.ok(await page.js("document.querySelectorAll('.voice-card-tag').length") === 2, "the two character cards are the acting voice");
  c.ok(await page.js("document.querySelector('input[name=phone-voice-card][value=\"\"]').checked"), "nothing chosen = the standard voice (unchanged default)");
  await page.js(pick("character-male")); c.ok(await page.js(state) === "character-tts/Puck/character-male", "character (male) speaks with the acting voice, Puck", await page.js(state));
  await page.js(pick("sales-female")); c.ok(await page.js(state) === "gpt-live/gleam/sales-female", "a business card goes back to the real-time engine", await page.js(state));
  await page.js(pick("")); c.ok(await page.js(state) === "gpt-live/marin/", "standard = the engine's default voice, no preset", await page.js(state));
  // Keyboard: the cards are one radio group.
  await page.js("document.querySelector('input[name=phone-voice-card][value=\"character-female\"]').focus()");
  await page.press("ArrowRight"); await sleep(150);
  c.ok(await page.js("document.activeElement.value") === "character-male" && await page.js(state) === "character-tts/Puck/character-male", "arrow keys move through the cards and choose", await page.js(state));
  // An engine picked by hand under "More settings" wins while it can speak the preset.
  await page.js("document.querySelector('#phone-voice-advanced').open=true;{const e=document.querySelector('#phone-engine');e.value='gemini-live';e.dispatchEvent(new Event('change',{bubbles:true}))}");
  await page.js(pick("character-female")); c.ok(await page.js(state) === "gemini-live/Leda/character-female", "a hand-picked engine is kept for the character", await page.js(state));
  c.ok(await page.js("document.querySelectorAll('.voice-card-tag').length") === 0, "…and the cards say so (no acting tag)");
  // A voice picked by hand shows on the chosen card.
  await page.js("{const v=document.querySelector('#phone-voice');v.value='Sulafat';v.dispatchEvent(new Event('change',{bubbles:true}))}");
  c.ok(/Sulafat/.test(await page.text("input[name=phone-voice-card]:checked + .voice-card-body")), "a hand-picked voice name shows on the chosen card");
  // Clearing the form goes back to 標準 everywhere: card, hidden preset, engine and voice agree.
  await page.js(pick("character-male")); await page.click("#phone-clear"); await sleep(150);
  c.ok(await page.js(state) === "gpt-live/marin/" && await page.js("document.querySelector('input[name=phone-voice-card]:checked')?.value") === "", "clear resets the voice to 標準 (card, engine, voice agree)", await page.js(state));
  // A reload keeps the chosen card with the rest of the draft.
  await page.js(pick("character-female")); await page.js("{const n=document.querySelector('#phone-name');n.value='ゆき';n.dispatchEvent(new Event('input',{bubbles:true}))}");
  await page.goto(arena.url + "/?lang=ja&phone=1"); await page.until("document.querySelectorAll('.voice-card').length===7");
  c.ok(await page.js(state) === "character-tts/Leda/character-female" && await page.js("document.querySelector('input[name=phone-voice-card]:checked')?.value") === "character-female", "reload restores the chosen card", await page.js(state));
  await page.js("document.querySelector('#phone-voice-advanced').open=true");
  // The request that is reviewed carries the choice.
  await page.js(pick("character-male"));
  await page.js("{const set=(id,v)=>{const n=document.querySelector(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}))};set('#phone-number','+819012345678');set('#phone-name','ゆき');set('#phone-instruction','最近どうしてるか聞いて、週末の予定について気軽に話してください。')}");
  await page.js("{const e=document.querySelector('#phone-engine');e.value='character-tts';e.dispatchEvent(new Event('change',{bubbles:true}))}");
  await page.click("#phone-form button[type=submit]"); await page.until("!document.querySelector('#phone-review').hidden");
  const history = await (await fetch(arena.url + "/api/phone/history")).json();
  c.ok(history[0]?.request.engine === "character-tts" && history[0]?.request.voicePreset === "character-male" && !history[0]?.request.voice, "the draft asks for the acting voice with the character preset", JSON.stringify({ engine: history[0]?.request.engine, preset: history[0]?.request.voicePreset }));
  c.ok(/演技する声/.test(await page.text("#phone-review-fields")), "the review names the engine in words, not its id");
  c.ok(await page.js("document.querySelector('#phone-dial').disabled"), "not callable without a carrier (nothing can ring)");
  for (const [label, w, h] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
    await page.viewport(w, h); await sleep(300);
    c.ok(await page.noSidewaysScroll(), `${label}: no sideways scroll`);
    await page.js("document.querySelector('#phone-voice-choice').scrollIntoView({block:'start'})"); await sleep(200);
    await page.screenshot(join(out, `phone-voice-${label}.png`));
    // On a wide window the phone screen scrolls inside the board, not the page.
    await page.js("window.scrollTo(0,0);document.querySelector('main').scrollTop=0"); await sleep(200);
    await page.screenshot(join(out, `phone-form-${label}.png`));
  }
  c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" "));
  await page.close(); page = undefined;
  // Without the speech recognition key the character cards stay real-time and the page says what is missing.
  arena.server.closeAllConnections(); await arena.close();
  arena = await arenaFor({ OPENAI_API_KEY: "placeholder", GEMINI_API_KEY: "placeholder" });
  page = await launch({ width: 390, height: 844 });
  await page.goto(arena.url + "/?lang=ja&phone=1");
  await page.until("document.querySelectorAll('.voice-card').length===7");
  await page.js(pick("character-female"));
  c.ok(await page.js(state) === "gpt-live/gleam/character-female", "acting voice not set up: the character speaks in real time", await page.js(state));
  c.ok(/Deepgram の API キー/.test(await page.text("#phone-voice-cards-note")) && !/_API_KEY/.test(await page.text("#phone-voice-cards-note")), "…and the note names the missing service in words");
  await page.js("document.querySelector('#phone-voice-choice').scrollIntoView({block:'start'})"); await sleep(200);
  await page.screenshot(join(out, "phone-voice-unconfigured-mobile.png"));
} finally {
  await page?.close(); arena.server.closeAllConnections(); await arena.close(); rmSync(work, { recursive: true, force: true });
}
c.finish();
