// Ring Zero: draws the verdict ring from #mission-progress (one <i> per required field, .on when verified).
// Read-only: it never changes the verdict, only how it is shown. The bar stays as the fallback.
(() => {
  const host = document.getElementById("mission-progress");
  if (!host) return;
  const NS = "http://www.w3.org/2000/svg";
  const make = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
  const ring = make("svg", { class: "rz-ring", viewBox: "0 0 48 48", "aria-hidden": "true" });
  host.before(ring);
  const draw = () => {
    const segs = [...host.children];
    const n = segs.length, on = segs.filter((s) => s.classList.contains("on")).length;
    ring.replaceChildren();
    ring.hidden = n === 0;
    if (!n) return;
    const r = 19, c = 2 * Math.PI * r, q = c / n, gap = n > 1 ? Math.min(6, q * 0.25) : 0;
    const g = make("g", { transform: "rotate(-90 24 24)" });
    g.append(make("circle", { class: "rz-track", cx: 24, cy: 24, r, fill: "none" }));
    if (on === n) g.append(make("circle", { class: "rz-on rz-full", cx: 24, cy: 24, r, fill: "none" }));
    else segs.forEach((s, i) => {
      if (!s.classList.contains("on")) return;
      g.append(make("circle", { class: "rz-on", cx: 24, cy: 24, r, fill: "none", "stroke-dasharray": `${q - gap} ${c - q + gap}`, "stroke-dashoffset": -(i * q + gap / 2) }));
    });
    const label = make("text", { x: 24, y: 24, "text-anchor": "middle", "dominant-baseline": "central" });
    label.textContent = `${on}/${n}`;
    ring.append(g, label);
  };
  new MutationObserver(draw).observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  draw();
})();
