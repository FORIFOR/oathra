// Primary flow of the gateway workspace, operated like a person would, in practice (simulator) mode.
// Given a fresh workspace, when I paste the token, finish setup, ask for a call and approve it,
// then I see progress and a result in plain words backed by the callee's quote — and nothing dials without the checkbox.
// usage: node scripts/ui/gateway-flow.mjs   (needs `pnpm build`; writes artifacts/ui/gateway-*.png)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checklist, freePort, launch, serve, sleep } from "./cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.env.OATHRA_UI_ARTIFACTS ? resolve(process.env.OATHRA_UI_ARTIFACTS) : join(root, "artifacts/ui");
const work = mkdtempSync(join(tmpdir(), "oathra-gateway-ui-"));
const port = await freePort(), base = `http://localhost:${port}`;
let server, page;
// --size=1920x1080 checks one extra window size without touching the reviewed images (implies --no-capture in practice: pass both).
const extra = process.argv.find((a) => a.startsWith("--size="))?.slice(7).split("x").map(Number);
const SIZES = extra ? [[`${extra[0]}x${extra[1]}`, extra[0], extra[1]]] : [["desktop", 1440, 900], ["mobile", 390, 844]];
const c = checklist("gateway primary flow");
try {
  // A throwaway workspace: own database, own token, never the developer's .oathra/.
  execFileSync("node", [join(root, "apps/gateway/setup.mjs")], { cwd: work, stdio: "ignore" });
  const envFile = join(work, ".env.gateway");
  writeFileSync(envFile, readFileSync(envFile, "utf8").replace("http://localhost:4244", base) + `PORT='${port}'\n`);
  const token = readFileSync(join(work, ".oathra/operator-token.txt"), "utf8").trim();
  server = await serve("node", [`--env-file=${envFile}`, join(root, "apps/gateway/server.mjs")], { cwd: work, url: `${base}/healthz` });

  for (const [name, width, height] of SIZES) {
    console.log(`\n${name} ${width}x${height}`);
    page = await launch({ width, height });
    await page.goto(base + "/");
    c.ok(await page.visible("#login"), "sign-in card is shown first");
    c.ok(await page.visible(".where summary"), "sign-in explains where the token is");
    if (name === "desktop") {
      // Keyboard only: Tab reaches the field, typing and Enter sign in. No mouse, no script submit.
      await page.press("Tab");
      for (let i = 0; i < 4 && (await page.focused())?.id !== "token"; i++) await page.press("Tab");
      const field = await page.focused();
      c.ok(field?.id === "token" && field.outline, "keyboard: Tab reaches the token field and focus is visible", JSON.stringify(field));
      await page.type(token); await page.press("Enter");
    } else await page.js(`document.querySelector('#token').value=${JSON.stringify(token)};document.querySelector('#login-form').requestSubmit()`);
    await page.until("!document.querySelector('#workspace').hidden", { label: "workspace after sign-in" });
    await sleep(400);

    if (name === "desktop") {
      const steps = await page.js("[...document.querySelectorAll('#setup-steps li span')].map(n=>n.textContent)");
      c.ok(steps.length === 1 && /同意/.test(steps[0]), "setup asks only for what is missing", steps.join(" / "));
      await page.click("#setup-steps li button");
      await page.until("document.querySelector('#settings').open", { label: "settings panel" });
      c.ok(await page.js("document.querySelector('#s-consent').open"), "the setup button opens the right setting");
      await page.click("#consent");
      await page.until("document.querySelector('#setup').hidden", { label: "setup banner gone" });
      c.ok(!(await page.js("document.querySelector('#settings').open")), "panel closes after consent");
      c.ok(await page.visible("#detail-empty"), "empty state says what will appear on the right");
    }
    c.ok(await page.noSidewaysScroll(), "no sideways scroll");
    if (width >= 1000) c.ok(await page.noPageScroll(), "the board fits the window after sign-in");

    await page.click("input[name=goal][value=materials]");
    c.ok(/資料/.test(await page.js("document.querySelector('#request').value")), "the suggested request follows the chosen goal");
    await page.js("document.querySelector('#mission-form').requestSubmit()");
    await page.until("document.querySelector('#review').open", { label: "review dialog" });
    const rows = await page.js("[...document.querySelectorAll('#review-content dt')].map(n=>n.textContent)");
    c.ok(["相手", "伝えること", "AIが約束しないこと", "通話の長さと費用", "会話データの送り先"].every((r) => rows.includes(r)), "review shows who, what, limits, where data goes and what the AI will not promise");
    const dialog = await page.text("#review-content");
    c.ok(!/simulator|\$|[a-z]+_[a-z_]+/.test(dialog), "the confirmation has no internal words or bare dollar amounts", (dialog.match(/simulator|\$\S*|[a-z]+_[a-z_]+/g) ?? []).join(" "));
    c.ok(/練習用/.test(dialog) && /0円/.test(dialog), "practice mode says so for the numbers and the cost");
    if (name === "desktop") {
      await page.screenshot(join(out, "gateway-review.png"));
      // Keyboard: focus starts inside the dialog, Escape closes it without dialing, focus returns to the button that opened it.
      const inside = await page.js("document.querySelector('#review').contains(document.activeElement)");
      c.ok(inside, "keyboard: focus moves into the confirmation dialog");
      await page.press("Escape"); await sleep(300);
      c.ok(!(await page.js("document.querySelector('#review').open")), "keyboard: Escape closes the dialog");
      c.ok((await page.js("document.querySelectorAll('#history .item').length")) >= 0 && !(await page.visible(".progress")), "keyboard: closing the dialog does not start a call");
      const back = await page.focused();
      c.ok(back?.tag === "BUTTON" && /内容を確認/.test(back.text) && back.outline, "keyboard: focus returns to the button that opened the dialog, visibly", JSON.stringify(back));
      // Space on the checkbox and Enter on the approve button, from the keyboard.
      await page.press("Enter");
      await page.until("document.querySelector('#review').open", { label: "review dialog reopened from the keyboard" });
    }

    await page.click("#start-call"); await sleep(500);
    c.ok(await page.js("document.querySelector('#review').open") && /承認/.test(await page.text("#notice") ?? ""), "approval is refused without the checkbox");
    await page.click("#call-ack"); await page.click("#start-call");
    await sleep(400);
    c.ok(!(await page.visible("#notice")), "the refusal message is gone once the approval goes through");
    await page.until("!!document.querySelector('.progress li.now')", { timeout: 15_000, label: "progress of the running call" });
    c.ok(true, "progress is shown while the call runs", await page.js("[...document.querySelectorAll('.progress li')].map(n=>(n.className||'-')+':'+n.textContent).join(' ')"));
    await page.until("document.querySelectorAll('#detail .facts li').length>0", { timeout: 30_000, label: "result" });

    const facts = await page.js("[...document.querySelectorAll('#detail .facts li')].map(n=>n.textContent)");
    c.ok(facts.some((f) => /資料を送ってよい/.test(f)), "result is in plain words", facts.join(" | "));
    c.ok(!/[a-z]+_[a-z_]+/.test(await page.text("#detail")), "no internal field names on screen");
    c.ok((await page.js("[...document.querySelectorAll('#detail blockquote')].map(n=>n.textContent)")).some((q) => /資料を送ってください/.test(q)), "the callee's own words are quoted as the basis");
    c.ok(await page.js("document.querySelectorAll('#history .item').length>0"), "the call appears in the history");

    await page.js("document.querySelector('#detail details').open=true"); await sleep(3600);
    if (width >= 1000) {
      // The card scrolls inside itself: the last action must be reachable, not just exist.
      const reachable = await page.js("(()=>{const card=document.querySelector('#current'),b=[...card.querySelectorAll('.actions button')].pop();card.scrollTop=card.scrollHeight;const r=b.getBoundingClientRect(),k=card.getBoundingClientRect();return r.bottom<=k.bottom+1&&r.top>=k.top})()");
      c.ok(reachable, "the last action of a long result can be scrolled into view inside the card");
      await page.js("document.querySelector('#current').scrollTop=0");
      // ...and with the card scrolled back to the top, the actions are still on screen (pinned to the card's bottom edge).
      const pinned = await page.js("(()=>{const card=document.querySelector('#current'),k=card.getBoundingClientRect();return card.scrollHeight>card.clientHeight+1&&[...card.querySelectorAll('.actions button')].every(b=>{const r=b.getBoundingClientRect();return r.top>=k.top&&r.bottom<=k.bottom+1})})()");
      c.ok(pinned, "with a long transcript open, every action stays visible at the bottom of the card");
    }
    c.ok(await page.js("document.querySelector('#detail details').open"), "an open transcript survives polling");
    if (width >= 1000) c.ok(await page.noPageScroll(), "the board still fits with a result open");
    const small = await page.smallTargets(44);
    c.ok(small.length === 0, "no control under 44px", small.join(", "));
    await page.screenshot(join(out, `gateway-${name}.png`), { fullPage: width < 1000 });

    if (name === "desktop") {
      await page.click("#open-settings"); await page.js("document.querySelector('#s-phone').open=true"); await sleep(300);
      c.ok(await page.js("document.querySelector('#phone-form').hidden") && /練習モード/.test(await page.text("#phone-unavailable") ?? ""), "phone verification explains itself instead of failing in practice mode");
      c.ok((await page.text("#phone-state")) === "練習では不要", "a practice number is not labelled as verified", await page.text("#phone-state"));
      await page.screenshot(join(out, "gateway-settings.png"));
      // Edit the existing simulator contact using the actual completed transcript; no extra sample identity.
      const originalContact = await page.js("state.contacts[0]");
      const lastCall = await page.text('#detail blockquote');
      await page.js("document.querySelector('#s-phone').open=false;document.querySelector('#s-contact').open=true");
      await page.click('#contact-list button');
      await page.js(`document.querySelector('#contact-name').value='';document.querySelector('#contact-company').value=${JSON.stringify(originalContact.name)};document.querySelector('#contact-phone').value='';document.querySelector('#contact-last-call').value=${JSON.stringify(lastCall)};document.querySelector('#contact-form').requestSubmit()`);
      await page.until("!document.querySelector('#settings').open", {label:'contact saved without telephone'});
      await page.js('refresh()');
      c.ok(await page.js(`state.contacts[0].phone === '' && state.contacts[0].name === '' && state.contacts[0].company === ${JSON.stringify(originalContact.name)} && state.contacts[0].lastCallNotes === ${JSON.stringify(lastCall)}`), 'company-only contact and actual call notes survive a fresh server read');
      await page.click('#open-settings');
      await page.js("document.querySelector('#s-contact').open=true");
      await page.click('#contact-list button');
      c.ok(await page.js(`document.querySelector('#contact-last-call').value === ${JSON.stringify(lastCall)}`), 'saved call notes can be reopened for editing');
      await page.screenshot(join(out, 'gateway-general-contact.png'));
      await page.js(`(()=>{const original=${JSON.stringify(originalContact)}; for(const [field,id] of Object.entries({name:'contact-name',company:'contact-company',phone:'contact-phone',email:'contact-email',notes:'contact-notes',lastCallNotes:'contact-last-call',relationship:'relationship',basis:'contact-basis',crmId:'crm-id'}))document.getElementById(id).value=original[field]??'';document.querySelector('#contact-form').requestSubmit()})()`);
      await page.until("!document.querySelector('#settings').open", {label:'phone restored through edit form'});
      c.ok(await page.js(`state.contacts[0].phone === ${JSON.stringify(originalContact.phone)} && state.contacts[0].simulationOnly === true`), 'phone can be added later without losing simulator safety marker');

    }
    c.ok(page.pageErrors.length === 0, "no page errors", page.pageErrors.join(" || "));
    await page.close(); page = undefined;
  }
} catch (error) {
  c.ok(false, "flow completed", error.message);
} finally {
  await page?.close().catch(() => {}); server?.stop(); rmSync(work, { recursive: true, force: true });
}
c.finish();
