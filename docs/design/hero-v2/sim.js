// Sample: pick what the shop says, watch the evidence panel. States are the evidence engine's own output
// for these exact lines (scratchpad/hero-sim.mjs, 2026-09-13); nothing is computed in the browser.
(() => {
  const root = document.getElementById("sim"); if (!root) return;
  const OPEN = [["callee", "お電話ありがとうございます、トラットリア・リンゴでございます。"], ["agent", "恐れ入ります、9月12日の19時以降で2名、予約をお願いしたいのですが、空いていますでしょうか？"]];
  const P = (f, v, src) => ({ f, v, src, ok: false }), V = (f, v, src) => ({ f, v, src, ok: true });
  const base = [P("date", "2026-09-12", "AI"), P("time", "19:00", "AI"), P("partySize", "2", "AI")];
  const S = {
    0: { lines: [], ev: base, res: null },
    1: { lines: [["callee", "たぶん大丈夫ですが、まだ確定ではありません。"], ["agent", "念のため確認させてください。9月12日、19時以降、2名でご予約は確定とさせていただけますでしょうか？"]], ev: base, res: "未完了 · 曖昧な返事は同意にも確定にもならない。証拠は増えない" },
    2: { lines: [["callee", "19時は満席です。19時半なら空いています。"]], ev: [...base, P("time", "19:30", "相手")], res: "未完了 · 19:00 は採用されない。19:30 は AI が受けるまで「提案」のまま" },
    3: { lines: [["callee", "19時は満席です。19時半なら空いています。"], ["agent", "では19時半でお願いします。"], ["callee", "はい、19時半に2名様でご予約承りました。"]], ev: [V("confirmed", "はい", "相手"), V("time", "19:30", "相手"), V("partySize", "2", "相手"), V("date", "2026-09-12", "相手")], res: "完了 · 日付 2026-09-12 · 時刻 19:30 · 人数 2 · 確定（相手の「ご予約承りました」）", ok: true },
  };
  const CHIPS = [[1, "たぶん大丈夫ですが、まだ確定ではありません"], [2, "19時は満席です。19時半なら空いています"], [3, "（19時半を受けた後）はい、19時半に2名様でご予約承りました"]];
  const FIELDS = [["date", "日付", "= 2026-09-12"], ["time", "時刻", "≥ 19:00"], ["partySize", "人数", "= 2"], ["confirmed", "確定", ""]];
  const L = { date: "日付", time: "時刻", partySize: "人数", confirmed: "確定" };
  root.innerHTML = `<div class="ph"><span><b>レストラン予約</b> · 店員役はあなた</span><span class="tag">サンプル · 実際の電話は発信されません</span></div>
  <div class="body"><div><div class="tx" id="s-tx"></div><div class="chips"><p>店員として、どれかを言ってみてください</p><div class="row" id="s-chips"></div></div></div>
  <aside><div><h4>ミッション</h4><ul id="s-m"></ul></div><div><h4>証拠<b id="s-n">0</b></h4><div class="ev" id="s-ev"></div></div></aside></div>
  <p class="res" id="s-res">未完了 · 相手の発言が根拠になるまで、何も確定しない</p>
  <p class="note">判定結果は、同じ証拠エンジンにこの発話列を流した記録です。ブラウザ内で計算はしていません。</p>`;
  const $ = (id) => document.getElementById(id);
  const chips = $("s-chips");
  for (const [k, text] of CHIPS) { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.dataset.k = k; b.textContent = text; chips.append(b); }
  const r = document.createElement("button"); r.type = "button"; r.className = "chip reset"; r.dataset.k = 0; r.textContent = "最初から"; chips.append(r);
  chips.addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (c) show(Number(c.dataset.k)); });
  function show(k) {
    const s = S[k];
    for (const c of chips.children) c.classList.toggle("on", Number(c.dataset.k) === k && k !== 0);
    const tx = $("s-tx"); tx.replaceChildren();
    for (const [who, text] of [...OPEN, ...s.lines]) { const d = document.createElement("div"); d.className = "ln " + who; d.innerHTML = "<b>" + (who === "callee" ? "あなた（店）" : "AI") + "</b><span></span>"; d.lastChild.textContent = text; tx.append(d); }
    const ul = $("s-m"); ul.replaceChildren();
    for (const [f, label, rule] of FIELDS) { const hits = s.ev.filter((e) => e.f === f); const ok = hits.some((e) => e.ok), pend = !ok && hits.length > 0;
      const li = document.createElement("li"); li.className = ok ? "ok" : pend ? "pend" : "";
      const val = hits.find((e) => e.ok) || hits[hits.length - 1];
      li.innerHTML = "<i>" + (ok ? "✓" : pend ? "○" : "·") + "</i><span>" + label + (rule ? "<em>" + rule + "</em>" : "") + "</span><span class='v'>" + (val ? val.v : "") + "</span>"; ul.append(li); }
    const ev = $("s-ev"); ev.replaceChildren();
    for (const e of s.ev) { const d = document.createElement("div"); d.className = e.src === "相手" ? "callee" : "ai"; d.innerHTML = "<span>" + L[e.f] + " = " + e.v + "<span class='t'>" + e.src + "</span></span><small>" + (e.ok ? "確認済み" : "未確定") + "</small>"; ev.append(d); }
    $("s-n").textContent = s.ev.filter((e) => e.ok).length + " / " + FIELDS.length;
    const res = $("s-res"); res.textContent = s.res || "未完了 · 相手の発言が根拠になるまで、何も確定しない"; res.className = "res" + (s.ok ? " ok" : "");
  }
  show(0);
})();
