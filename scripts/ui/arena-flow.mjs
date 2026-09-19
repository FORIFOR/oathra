// Primary flow of the Arena: pick a call, watch it happen right below, read the evidence-backed result.
// Mirrors scripts/verify-evidence-workspace.py (CI, Playwright) with the local Chrome, and adds the one-page behaviour.
// usage: node scripts/ui/arena-flow.mjs [scenarioId] [--no-capture]   (needs `pnpm build`; writes artifacts/ui/arena-*.png)
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checklist, freePort, launch, serve } from "./cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "artifacts/ui");
const scenario = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "friend-hype";
const port = await freePort(), base = `http://127.0.0.1:${port}`;
let server, page;
const c = checklist("arena primary flow");
try {
  server = await serve("node", [join(root, "packages/cli/dist/bin.js"), "demo", "--no-open", "--port", String(port)], { cwd: root, url: base + "/" });
  for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
    console.log(`\n${name} ${width}x${height}`);
    page = await launch({ width, height });
    await page.emulateReducedMotion();
    await page.goto(base + "/?lang=ja");
    await page.until("document.querySelectorAll('#scenario-list button').length>0", { label: "missions" });
    c.ok(await page.noSidewaysScroll(), "start: no sideways scroll");
    if (name === "desktop") await page.screenshot(join(out, "arena-start.png"));

    await page.click('[data-transport="real"]');
    c.ok(await page.visible("#screen-real") && await page.visible("#screen-start"), "real-phone panel opens inline, the picker stays");
    c.ok((await page.js("document.querySelectorAll('#screen-real input:disabled').length")) > 0, "real providers are disabled in the demo");
    await page.click("#real-back");

    await page.js(`[...document.querySelectorAll('#scenario-list button')].find(b=>b.dataset.scenario===${JSON.stringify(scenario)}).click()`);
    await page.until("!document.querySelector('#screen-call').hidden", { label: "call" });
    c.ok(await page.visible("#screen-start"), "the mission picker stays on the page");
    c.ok((await page.js("document.querySelector('.scenario-btn.is-current')?.dataset.scenario")) === scenario, "the playing mission is marked");
    await page.until("document.querySelectorAll('#transcript .line.agent .say').length>0 && document.querySelectorAll('#transcript .line.callee .say').length>0", { label: "both sides spoke" });
    c.ok((await page.text("#transcript .line.agent .say")).startsWith("この通話は録音されています。"), "the call opens with the recording notice");
    await page.until("document.querySelector('#result-wrap').textContent.trim().length>0", { timeout: 120_000, label: "result" });

    const turns = await page.js("document.querySelectorAll('#transcript .line').length"), evidence = await page.js("document.querySelectorAll('#evidence-list li').length");
    c.ok(turns >= 2 && evidence > 0, "transcript and evidence are populated", `${turns} turns, ${evidence} evidence items`);
    const box = async (s) => JSON.parse(await page.js(`JSON.stringify(document.querySelector(${JSON.stringify(s)}).getBoundingClientRect())`));
    const t = await box("#transcript"), e = await box(".panels");
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
    await page.click("#drawer-toggle");
    c.ok(await page.visible("#drawer-body"), "details drawer opens");
    c.ok(await page.noSidewaysScroll(), "call: no sideways scroll");
    await page.screenshot(join(out, `arena-${name}.png`), { fullPage: true });

    await page.click("#call-back");
    c.ok(!(await page.visible("#screen-call")) && await page.visible("#screen-start"), "back returns to the picker on the same page");
    c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" || "));
    await page.close(); page = undefined;
  }
} catch (error) {
  c.ok(false, "flow completed", error.message);
} finally {
  await page?.close().catch(() => {}); server?.stop();
}
c.finish();
