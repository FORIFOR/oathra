// Fetches every link, image, video and stylesheet the public pages reference, and reports what does not
// resolve. Written after an English <video> shipped pointing at a path that 404s, on a page whose text
// promised a recording.
import { setTimeout as sleep } from "node:timers/promises";
const SITE = process.env.SITE_URL ?? "https://forifor.github.io/oathra";
const pages = (process.env.PAGES ?? "/,/en/,/check.html,/en/check.html").split(",");
const seen = new Map();
let bad = 0;

async function status(url) {
  if (seen.has(url)) return seen.get(url);
  let s = 0;
  for (const method of ["HEAD", "GET"]) {
    try { const r = await fetch(url, { method, redirect: "follow" }); s = r.status; if (r.ok) break; } catch { s = 0; }
    if (s && s !== 405 && s !== 403) break;   // some hosts refuse HEAD
  }
  seen.set(url, s);
  return s;
}

for (const path of pages) {
  const pageUrl = SITE + path;
  const res = await fetch(pageUrl);
  if (!res.ok) { console.log(`${path}: page itself ${res.status}`); bad++; continue; }
  const html = await res.text();
  const refs = new Set();
  // preconnect and dns-prefetch name an ORIGIN to warm up, not a document to fetch; asking for the bare
  // origin returns 404 from plenty of CDNs and means nothing.
  const hints = new Set([...html.matchAll(/<link[^>]*rel="(?:preconnect|dns-prefetch)"[^>]*href="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/(?:href|src|poster)="([^"#][^"]*)"/g)) {
    const raw = m[1];
    if (/^(mailto:|tel:|javascript:|data:)/.test(raw) || hints.has(raw)) continue;
    refs.add(new URL(raw, pageUrl).toString());
  }
  const results = [];
  for (const url of refs) {
    const s = await status(url);
    if (!(s >= 200 && s < 400)) results.push(`${s || "unreachable"} ${url.replace(SITE, "")}`);
    await sleep(60);
  }
  bad += results.length;
  console.log(`${path}: ${refs.size} refs, ${results.length ? results.join(" | ") : "all resolve"}`);
}
console.log(bad ? `FOUND ${bad} dead references` : "no dead references");
process.exit(bad ? 1 : 0);
