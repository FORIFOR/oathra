// Records the evidence lab actually running, frame by frame, and assembles the site and social cuts.
//
// Everything on screen is the shipped page rendering in a real browser: the chips are really clicked, the
// engine really re-runs, the verdict really changes. What the edit adds — and what this file is the record
// of — is a camera (a CSS transform on the page), a drawn cursor, and a caption bar. Nothing is sped up
// inside a reaction; the gaps between beats are simply not recorded.
//
//   node scripts/record-evidence-demo.mjs            # 16:9, site cut
//   node scripts/record-evidence-demo.mjs --vertical # 9:16, the page re-laid out at phone width
//
// Frames land in video/2026-09-22/frames-<shape>/ and are kept, so an edit can be redone without recording.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { launch as launchChrome } from "./ui/cdp.mjs";

const vertical = process.argv.includes("--vertical");
const shape = vertical ? "vertical" : "wide";
const OUT = resolve("video/2026-09-22");
const FRAMES = join(OUT, `frames-${shape}`);
const FPS = 30;
const VIEW = vertical ? { width: 540, height: 960 } : { width: 1440, height: 900 };
const SIZE = vertical ? "1080:1920" : "1920:1080";

const sh = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = ""; p.stderr.on("data", (d) => { err += d; });
  p.on("close", (code) => code === 0 ? res() : rej(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`)));
});

/** Serve site/ so the recording is of the built page, not a dev server. */
function serve(root, port) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".gif": "image/gif", ".jpg": "image/jpeg" };
  const server = createServer((req, res) => {
    const p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = existsSync(p) && extname(p) ? p : join(p, "index.html");
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "text/plain" }).end(readFileSync(file));
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

/** The camera, the cursor and the caption bar, injected into the page so Japanese text needs no font work. */
const STAGE = `(() => {
  const style = document.createElement('style');
  style.textContent = \`
    html { background: #f7f5f1; }
    /* The camera transforms a wrapper, never <body>: a transform on an ancestor turns position:fixed into
       position:absolute against it, which would drag the cursor and the captions along with the camera. */
    #rec-stage { transform-origin: 0 0; will-change: transform; }
    #rec-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; pointer-events: none;
      left: 0; top: 0; transform: translate(-100px,-100px); }
    #rec-cursor svg { display:block; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
    #rec-cursor.down svg { transform: scale(.82); }
    #rec-ring { position: fixed; z-index: 2147483646; border-radius: 999px; border: 2px solid #b3452a;
      pointer-events: none; opacity: 0; width: 0; height: 0; }
    /* Clear of where a player draws its control bar, so the caption is not read through a seek bar. */
    #rec-cap { position: fixed; z-index: 2147483645; left: 0; right: 0; bottom: 0; padding: 26px 40px 74px;
      background: linear-gradient(transparent, rgba(24,22,20,.92) 38%); color: #fff; pointer-events: none;
      font-family: system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif; text-align: center; }
    #rec-cap b { display:inline-block; font-size: 34px; line-height: 1.35; font-weight: 700; letter-spacing: .01em;
      text-shadow: 0 2px 10px rgba(0,0,0,.5); }
    #rec-cap.v { padding: 22px 26px 96px; }
    #rec-cap.v b { font-size: 40px; }
  \`;
  document.head.append(style);
  const stage = document.createElement('div'); stage.id = 'rec-stage';
  while (document.body.firstChild) stage.append(document.body.firstChild);
  document.body.append(stage);
  const cur = document.createElement('div'); cur.id = 'rec-cursor';
  cur.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l14 7.2-6.1 1.6L8.6 19z" fill="#fff" stroke="#1b1a18" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const ring = document.createElement('div'); ring.id = 'rec-ring';
  const cap = document.createElement('div'); cap.id = 'rec-cap'; cap.innerHTML = '<b></b>';
  document.body.append(cur, ring, cap);
  window.__rec = {
    camera(scale, x, y) { stage.style.transform = \`translate(\${x}px, \${y}px) scale(\${scale})\`; },
    cursor(x, y, down) { cur.style.transform = \`translate(\${x}px, \${y}px)\`; cur.classList.toggle('down', !!down); },
    ripple(x, y, t) { const r = 10 + t * 46; ring.style.width = ring.style.height = r + 'px';
      ring.style.left = (x - r / 2) + 'px'; ring.style.top = (y - r / 2) + 'px'; ring.style.opacity = String(Math.max(0, 1 - t)); },
    caption(text, vertical) { cap.querySelector('b').textContent = text || ''; cap.style.opacity = text ? '1' : '0'; cap.classList.toggle('v', !!vertical); },
    /** Where an element is on the screen right now, in screen pixels, after the camera transform. */
    at(selector, nth) { const list = [...document.querySelectorAll(selector)]; const el = list[nth ?? 0]; if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; },
    /** The same element in stage coordinates, so a camera target does not drift once the camera has moved. */
    atPage(selector, nth) { const list = [...document.querySelectorAll(selector)]; const el = list[nth ?? 0]; if (!el) return null;
      const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
      const scale = s.width / stage.offsetWidth || 1;
      return { x: (r.left + r.width / 2 - s.left) / scale, y: (r.top + r.height / 2 - s.top) / scale }; },
    click(selector, nth) { const list = [...document.querySelectorAll(selector)]; (list[nth ?? 0])?.click(); },
  };
})()`;

const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const lerp = (a, b, t) => a + (b - a) * t;

async function main() {
  mkdirSync(FRAMES, { recursive: true });
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const port = 4408 + (vertical ? 1 : 0);
  const server = await serve(resolve("site"), port);
  const page = await launchChrome(VIEW);
  let n = 0;
  const shoot = async () => { await page.screenshot(join(FRAMES, String(n++).padStart(5, "0") + ".png")); };
  const hold = async (seconds) => { for (let i = 0; i < Math.round(seconds * FPS); i++) await shoot(); };

  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await new Promise((r) => setTimeout(r, 2500));
    await page.js(STAGE);
    await page.js("window.scrollTo(0,0)");

    // Camera keyframes are in page coordinates; the body scales around its top-left.
    const cam = async (scale, cx, cy) => {
      // Keep the point (cx, cy) of the page centred on screen.
      const x = VIEW.width / 2 - cx * scale, y = VIEW.height / 2 - cy * scale;
      await page.js(`window.__rec.camera(${scale}, ${x}, ${y})`);
    };
    const camTo = async (from, to, seconds) => {
      const steps = Math.round(seconds * FPS);
      for (let i = 1; i <= steps; i++) {
        const t = easeInOut(i / steps);
        await cam(lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t));
        await shoot();
      }
    };
    const caption = (text) => page.js(`window.__rec.caption(${JSON.stringify(text)}, ${vertical})`);
    const cursorTo = async (from, to, seconds) => {
      const steps = Math.round(seconds * FPS);
      for (let i = 1; i <= steps; i++) {
        const t = easeInOut(i / steps);
        await page.js(`window.__rec.cursor(${lerp(from.x, to.x, t)}, ${lerp(from.y, to.y, t)}, false)`);
        await shoot();
      }
    };
    /** A click that really fires on the page, with the press and the ripple drawn around it. */
    const clickAt = async (selector, nth, point) => {
      await page.js(`window.__rec.cursor(${point.x}, ${point.y}, true)`);
      await shoot(); await shoot();
      await page.js(`window.__rec.click(${JSON.stringify(selector)}, ${nth})`);
      for (let i = 1; i <= 10; i++) { await page.js(`window.__rec.ripple(${point.x}, ${point.y}, ${i / 10})`); await shoot(); }
      await page.js(`window.__rec.cursor(${point.x}, ${point.y}, false)`);
    };
    const where = async (selector, nth = 0) => JSON.parse(await page.js(`JSON.stringify(window.__rec.at(${JSON.stringify(selector)}, ${nth}))`));
    const wherePage = async (selector, nth = 0) => JSON.parse(await page.js(`JSON.stringify(window.__rec.atPage(${JSON.stringify(selector)}, ${nth}))`));

    const panelAt = await wherePage("#sim");
    const panel = { x: panelAt.x, y: panelAt.y };
    const wide = [1, VIEW.width / 2, VIEW.height / 2];

    // 1. The claim, held.
    await cam(...wide);
    await caption(vertical ? "AIは「予約できました」と言った" : "AIは「ご予約承りました」と言った");
    await hold(2.2);

    // 2. Push in on the fields the engine settled, and the one it did not.
    const mission = await wherePage("#sim");
    const missionCam = [vertical ? 1.15 : 1.28, mission.x, mission.y];
    await camTo(wide, missionCam, 1.1);
    await caption("相手はまだ確定していない");
    await hold(2.0);

    // 3-5. Three replies, each really clicked, each re-running the engine.
    const beats = [
      { nth: 0, before: "店の返事を差し替える", after: "「たぶん大丈夫」は確定ではない", holdBefore: 0.6, holdAfter: 2.2 },
      { nth: 2, before: "相手がはっきり承諾すると", after: "完了。根拠は相手の発言", holdBefore: 0.5, holdAfter: 2.4 },
      { nth: 3, before: "そのあと取り消されたら", after: "完了は取り消される", holdBefore: 0.5, holdAfter: 2.4 },
    ];
    let cursor = { x: VIEW.width * 0.5, y: VIEW.height * 0.8 };
    let camNow = missionCam;
    for (const beat of beats) {
      const panelCam = [vertical ? 1.0 : 1.15, panel.x, panel.y];
      await camTo(camNow, panelCam, 0.6); camNow = panelCam;
      await caption(beat.before);
      const chip = await where("#sim .chips .chip:not(.reset)", beat.nth);
      if (!chip) throw new Error("reply chip not found: " + beat.nth);
      await cursorTo(cursor, chip, 0.7); cursor = chip;
      await hold(beat.holdBefore);
      await clickAt("#sim .chips .chip:not(.reset)", beat.nth, chip);
      await caption(beat.after);
      // Frame the whole panel, not just the field list: the transcript line that caused the change has to
      // stay in shot, and a tighter crop left half the screen showing unrelated hero text.
      const m2 = await wherePage("#sim");
      const inspect = [vertical ? 1.15 : 1.28, m2.x, m2.y];
      await camTo(camNow, inspect, 0.7); camNow = inspect;
      await hold(beat.holdAfter);
    }

    // 6. Pull back to the whole thing and say who decides.
    await caption("判定はモデルではなくコードが出す");
    await camTo(camNow, wide, 1.0);
    await hold(2.0);
    await caption("forifor.github.io/oathra · Apache-2.0");
    await hold(2.4);
    console.log(`frames: ${n} (${(n / FPS).toFixed(1)} s)`);
  } finally {
    await page.close();
    server.close();
  }

  const mp4 = join(OUT, `oathra-evidence-${shape}.mp4`);
  await sh("ffmpeg", ["-y", "-framerate", String(FPS), "-i", join(FRAMES, "%05d.png"),
    "-vf", `scale=${SIZE}:flags=lanczos`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", "-an", mp4]);
  await sh("ffmpeg", ["-y", "-i", mp4, "-vf", "select=eq(n\\,0)", "-frames:v", "1", join(OUT, `oathra-evidence-${shape}-poster.png`)]);
  console.log("wrote", mp4);
}

await main();
