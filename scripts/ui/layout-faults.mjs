// Finds the layout faults a "height > 0" check cannot see: boxes outside the viewport, text clipped
// inside its own box, and <video> that reports no picture. Written after six header links shipped
// squeezed to 12px and an English <video> shipped pointing at a 404, both of which passed a visibility check.
import { launch, sleep } from "./cdp.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:4399";
let bad = 0;
for (const [w, h, tag] of [[1440, 900, "desktop"], [1280, 800, "laptop"], [390, 844, "phone"]]) {
  const page = await launch({ width: w, height: h });
  try {
    for (const [lang, path] of [["ja", "/"], ["en", "/en/"]]) {
      await page.goto(base + path); await sleep(2600);
      const found = JSON.parse(await page.js(`JSON.stringify((()=>{
        const out={overflowX:Math.round(document.documentElement.scrollWidth-innerWidth),outside:[],clipped:[],videos:[]};
        for (const e of document.querySelectorAll('body *')) {
          const cs=getComputedStyle(e); if(cs.display==='none'||cs.visibility==='hidden'||!e.offsetParent&&cs.position!=='fixed') continue;
          const r=e.getBoundingClientRect(); if(r.width===0&&r.height===0) continue;
          const tag=e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/)[0]:'');
          // Parked off-screen on purpose (spam honeypots, skip links) is not a fault.
          const parked = r.left < -1000 || cs.clip === 'rect(0px, 0px, 0px, 0px)';
          // Inside something that is meant to scroll (a <pre>, a table wrapper) is not an overflow fault.
          let scroller = false;
          for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
            const acs = getComputedStyle(a);
            if (acs.overflowX === 'auto' || acs.overflowX === 'scroll' || acs.overflow === 'auto' || acs.overflow === 'scroll') { scroller = true; break; }
          }
          if (scroller) continue;
          if (!parked && (r.right>innerWidth+1||r.left<-1)) out.outside.push({tag,left:Math.round(r.left),right:Math.round(r.right)});
          // text clipped inside its own box (the 12px-wide link case), ignoring deliberate scrollers
          if (cs.overflow==='visible'&&cs.overflowX!=='auto'&&cs.overflowY!=='auto'&&e.children.length===0&&e.textContent.trim()) {
            if (e.scrollWidth>e.clientWidth+1) out.clipped.push({tag,text:e.textContent.trim().slice(0,18),w:Math.round(r.width),need:e.scrollWidth});
          }
        }
        for (const v of document.querySelectorAll('video')) out.videos.push({url:v.currentSrc||v.querySelector('source')?.src||'',poster:v.poster||'',h:Math.round(v.getBoundingClientRect().height)});
        return out;})())`));
      // Resolve each video's source and poster from outside the page.
      for (const v of found.videos) {
        v.src = (v.url || '(none)').split('/').pop();
        for (const [what, u] of [["source", v.url], ["poster", v.poster]]) {
          if (!u) continue;
          try { const r = await fetch(u, { method: "HEAD" }); if (!r.ok) { v.status = r.status; v.what = what; } } catch { v.status = 0; v.what = what; }
        }
      }
      const problems = [];
      if (found.overflowX > 0) problems.push(`page scrolls sideways by ${found.overflowX}px`);
      for (const o of found.outside.slice(0, 4)) problems.push(`outside viewport: ${o.tag} (${o.left}..${o.right})`);
      for (const c of found.clipped.slice(0, 4)) problems.push(`clipped: ${c.tag} "${c.text}" ${c.w}px wide, needs ${c.need}`);
      // A video whose file 404s renders at the 300x150 default. Headless Chrome cannot decode h264, so
      // videoWidth is useless here; the honest check is whether the URL it asks for actually resolves.
      for (const v of found.videos) if (v.status && v.status >= 400) problems.push(`video ${v.what} ${v.status}: ${(v.what==="poster"?v.poster:v.url).split("/").slice(-2).join("/")}`);
      bad += problems.length;
      console.log(`${tag} ${lang}: ${problems.length ? problems.join(" | ") : "clean"}`);
    }
  } finally { await page.close(); }
}
console.log(bad ? `FOUND ${bad} layout faults` : "no layout faults");
process.exit(bad ? 1 : 0);
