// Primary flow of the Arena: pick a call, watch it happen right below, read the evidence-backed result.
// Mirrors scripts/verify-evidence-workspace.py (CI, Playwright) with the local Chrome, and adds the one-page behaviour.
// usage: node scripts/ui/arena-flow.mjs [scenarioId] [--no-capture]   (needs `pnpm build`; writes artifacts/ui/arena-*.png)
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checklist, freePort, launch, serve } from "./cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.env.OATHRA_UI_ARTIFACTS ? resolve(process.env.OATHRA_UI_ARTIFACTS) : join(root, "artifacts/ui");
const scenario = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "friend-hype";
const port = await freePort(), base = `http://127.0.0.1:${port}`;
let server, page;
const c = checklist("arena primary flow");
try {
  server = await serve("node", [join(root, "packages/cli/dist/bin.js"), "demo", "--no-open", "--port", String(port)], { cwd: root, url: base + "/" });
  const fits = () => page.js("document.documentElement.scrollHeight<=innerHeight+1 && document.body.scrollHeight<=innerHeight+1");
  for (const [name, width, height] of [["desktop", 1440, 900], ["laptop", 1280, 800], ["mobile", 390, 844]]) {
    const board = width >= 1100;
    console.log(`\n${name} ${width}x${height}`);
    page = await launch({ width, height });
    await page.emulateReducedMotion();
    await page.goto(base + "/?lang=ja&practice=1");
    await page.until("document.querySelectorAll('#scenario-list button').length>0", { label: "missions" });
    c.ok(await page.noSidewaysScroll(), "start: no sideways scroll");
    if (board) {
      c.ok(await fits(), "start: the board fits the window, the page does not scroll");
      c.ok(await page.visible("#stage-empty"), "start: the stage says where the call will appear");
      const rail = JSON.parse(await page.js("JSON.stringify((()=>{const r=document.querySelector('#screen-start');return{inner:r.scrollHeight,box:r.clientHeight,n:document.querySelectorAll('#scenario-list button').length}})())"));
      c.ok(rail.inner <= rail.box + 1, "start: every mission is visible without scrolling the rail", `${rail.n} missions, ${rail.inner}px in ${rail.box}px`);
    } else c.ok(!(await page.visible("#stage-empty")), "start: no empty stage on a phone");
    if (name !== "mobile") await page.screenshot(join(out, name === "desktop" ? "arena-start.png" : `arena-start-${name}.png`));

    await page.click('[data-transport="real"]');
    c.ok(await page.visible("#screen-real") && !await page.visible("#screen-start"), "phone preparation hides unrelated practice controls");
    c.ok(await page.visible("#phone-number") && await page.visible("#phone-instruction") && !(await page.js("document.querySelector('#phone-number').disabled")), "phone input and instruction are available without dialing");
    // Practice now has its own explicit navigation instead of competing with phone preparation.
    await page.click('[data-transport="simulator"]');

    await page.js(`[...document.querySelectorAll('#scenario-list button')].find(b=>b.dataset.scenario===${JSON.stringify(scenario)}).click()`);
    await page.until("!document.querySelector('#screen-call').hidden", { label: "call" });
    c.ok(await page.js("document.querySelector('[data-transport=simulator]').getAttribute('aria-pressed') === 'true'"), "scenario selection switches phone intake to simulator");
    c.ok(await page.visible("#screen-start"), "the mission picker stays on the page");
    c.ok((await page.js("document.querySelector('.scenario-btn.is-current')?.dataset.scenario")) === scenario, "the playing mission is marked");
    if (board) c.ok(await fits() && !(await page.visible("#stage-empty")), "call: the call replaces the empty stage and still fits the window");
    await page.until("document.querySelectorAll('#transcript .line.agent .say').length>0 && document.querySelectorAll('#transcript .line.callee .say').length>0", { label: "both sides spoke" });
    c.ok((await page.text("#transcript .line.agent .say")).startsWith("この通話は録音されています。"), "the call opens with the recording notice");
    await page.until("document.querySelector('#result-wrap').textContent.trim().length>0", { timeout: 120_000, label: "result" });

    const turns = await page.js("document.querySelectorAll('#transcript .line').length"), evidence = await page.js("document.querySelectorAll('#evidence-list li').length");
    c.ok(turns >= 2 && evidence > 0, "transcript and evidence are populated", `${turns} turns, ${evidence} evidence items`);
    const box = async (s) => JSON.parse(await page.js(`JSON.stringify(document.querySelector(${JSON.stringify(s)}).getBoundingClientRect())`));
    // Result updates can scroll the page between CDP round trips. Compare both
    // viewport rectangles in one browser task, preserving the same layout assertion.
    const { t, e } = await page.js("({t:document.querySelector('#transcript').getBoundingClientRect().toJSON(),e:document.querySelector('.panels').getBoundingClientRect().toJSON()})");
    c.ok(width > 900 ? e.x >= t.x + t.width - 1 : e.y >= t.y + t.height - 1, width > 900 ? "evidence sits beside the transcript" : "evidence stacks below the transcript");
    // Whose words settled it must be readable on every verified card, and the cards must fit their column.
    const cards = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('#evidence-list .erow')].map(n=>({verified:n.dataset.verified==='true',why:n.querySelector('.e-why')?.textContent??'',right:Math.round(n.getBoundingClientRect().right),status:Math.round(n.querySelector('.e-ok').getBoundingClientRect().right)})))"));
    const columnRight = Math.round((await box("#evidence-list")).right) + 1;
    c.ok(cards.filter((k) => k.verified).every((k) => /確定/.test(k.why)), "every verified card says whose words settled it", cards.filter((k) => k.verified).map((k) => k.why).join(" | "));
    c.ok(cards.some((k) => /相手自身の言葉で確定/.test(k.why)), "the confirmation is attributed to the callee's own words");
    const settledValues = new Set(JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('#evidence-list .erow[data-verified=true]')].map(n=>n.querySelector('.e-field').textContent+n.querySelector('.e-val').textContent))")));
    const contradictions = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('#evidence-list .erow[data-verified=false]')].map(n=>({k:n.querySelector('.e-field').textContent+n.querySelector('.e-val').textContent,why:n.querySelector('.e-why').textContent})))")).filter((k) => settledValues.has(k.k) && /まだ受けていません|了承待ち/.test(k.why));
    c.ok(contradictions.length === 0, "a pending card never claims a value is unaccepted when the same value is settled", contradictions.map((k) => k.k).join(", "));
    c.ok(cards.every((k) => k.right <= columnRight && k.status <= columnRight), "evidence cards and their status fit inside the column", `column ${columnRight}, widest ${Math.max(...cards.map((k) => Math.max(k.right, k.status)))}`);
    c.ok(/検証済み \d+ \/ 全 \d+/.test(await page.text("#evidence-count")), "the evidence counter says what it counts", await page.text("#evidence-count"));
    const panelVerified = Number((await page.text("#evidence-count")).match(/検証済み (\d+)/)[1]);
    const cardVerified = Number(((await page.text("#result-wrap")).match(/検証済みの証拠 (\d+) 件/) ?? [])[1]);
    c.ok(panelVerified === cardVerified, "the result card and the evidence panel count the same thing", `panel ${panelVerified}, card ${cardVerified}`);
    c.ok(/19:00〜21:00/.test(await page.text("#mission-list")), "a time range reads as a range");
    const chips = JSON.parse(await page.js("JSON.stringify([...document.querySelectorAll('.scenario-btn .s-title')].map(n=>({clipped:n.scrollWidth>n.clientWidth+1,ellipsis:getComputedStyle(n).textOverflow==='ellipsis'})))"));
    c.ok(chips.every((k) => !k.clipped || k.ellipsis), "folded mission names end with an ellipsis, never a cut character");
    if (board) {
      c.ok(await fits(), "result: the board still fits the window");
      const r = await box("#result-wrap"), p = await box(".panels"), a = await box(".result-actions");
      c.ok(r.x >= t.x + t.width - 1 && r.y + r.height <= p.y + 1, "the result sits on top of the evidence, beside the transcript");
      c.ok(a.y + a.height <= height, "the result's actions are on screen without scrolling", `bottom ${Math.round(a.y + a.height)} of ${height}`);
      await page.screenshot(join(out, `arena-${name}.png`));
      await page.click("#drawer-toggle");
      c.ok(await page.visible("#drawer-body") && await fits(), "details open as a sheet, the page still does not scroll");
      await page.screenshot(join(out, `arena-${name}-details.png`));
      await page.press("Escape");
      c.ok(!(await page.visible("#drawer-body")) && (await page.focused())?.id === "drawer-toggle", "Escape closes the details and focus returns to their button", JSON.stringify(await page.focused()));
      await page.click("#drawer-toggle");
      await page.click("#drawer-close");
      c.ok(!(await page.visible("#drawer-body")), "the details sheet has its own close button");
      await page.click("#drawer-toggle");
    } else await page.click("#drawer-toggle");
    c.ok(await page.visible("#drawer-body"), "details drawer opens");
    c.ok(await page.noSidewaysScroll(), "call: no sideways scroll");
    if (!board) await page.screenshot(join(out, `arena-${name}.png`), { fullPage: true });

    await page.click("#call-back");
    c.ok(!(await page.visible("#screen-call")) && await page.visible("#screen-start"), "back returns to the picker on the same page");
    if (name === "laptop") {
      // The tightest board: answer the phone yourself. The input must be on screen without scrolling, and usable from the keyboard.
      await page.click('[data-mode="play"]');
      await page.js(`[...document.querySelectorAll('#scenario-list button')].find(b=>b.dataset.scenario==='restaurant-reservation').click()`);
      await page.until("!document.querySelector('#play-form').hidden && document.querySelectorAll('#transcript .line.agent .say').length>0", { label: "play input" });
      c.ok(!(await page.visible("#drawer-body")), "play: details left open on the last call do not cover the new one");
      const input = await box("#play-text");
      c.ok(await fits() && input.y + input.height <= height, "play: the answer box is on screen, the page does not scroll", `bottom ${Math.round(input.y + input.height)} of ${height}`);
      const stage = await box("#transcript");
      c.ok(stage.height >= 240, "play: the conversation keeps most of the column", `${Math.round(stage.height)}px`);
      await page.click("#play-text"); await page.type("はい、お電話ありがとうございます。"); await page.press("Enter");
      await page.until("document.querySelectorAll('#transcript .line.callee .say').length>0", { label: "my line" });
      c.ok((await page.text("#transcript .line.callee .say")).includes("お電話ありがとう"), "play: what I typed appears as the callee's line");
      await page.screenshot(join(out, "arena-play-laptop.png"));
      await page.click("#play-hangup");
      await page.until("document.querySelector('#result-wrap').textContent.trim().length>0", { label: "play result" });
      c.ok(await fits(), "play: the result fits the window too");
      await page.click("#call-back");
      await page.click('[data-mode="watch"]');
    }
    c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" || "));
    await page.close(); page = undefined;
  }
  // The same board in English on the dark theme: longer words, other colours, same promise (it fits, nothing is cut off sideways).
  console.log("\ndesktop 1440x900 en dark");
  page = await launch({ width: 1440, height: 900 });
  await page.emulateReducedMotion();
  await page.goto(base + "/?lang=en&theme=dark&practice=1");
  await page.until("document.querySelectorAll('#scenario-list button').length>0", { label: "missions" });
  c.ok(await fits() && await page.noSidewaysScroll(), "en/dark start: fits the window");
  c.ok(/Pick a call/.test(await page.text("#stage-empty")), "en/dark start: the empty stage is in English");
  await page.js(`[...document.querySelectorAll('#scenario-list button')].find(b=>b.dataset.scenario==='false-completion-trap').click()`);
  await page.until("document.querySelector('#result-wrap').textContent.trim().length>0", { timeout: 180_000, label: "result" });
  c.ok(await fits() && await page.noSidewaysScroll(), "en/dark result (every slot is full, so the call must not complete): fits the window");
  c.ok(!/Mission complete/i.test(await page.text("#result-wrap .result-h")), "a fully booked restaurant is not reported as complete", await page.text("#result-wrap .result-h"));
  await page.screenshot(join(out, "arena-desktop-en-dark.png"));
  c.ok(page.pageErrors.length === 0, "en/dark: no page errors", page.pageErrors.join(" || "));
  await page.close(); page = undefined;
} catch (error) {
  c.ok(false, "flow completed", error.message);
} finally {
  await page?.close().catch(() => {}); server?.stop();
}
c.finish();
