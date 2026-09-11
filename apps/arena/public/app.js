/* Oathra Arena — vanilla JS, no build step. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ utils
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, attrs, children) => {
    const n = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    if (children) for (const c of [].concat(children)) if (c !== null && c !== undefined) n.append(c);
    return n;
  };
  const pad = (n, w) => String(n).padStart(w || 2, "0");
  const mmss = (t) => `${pad(Math.floor((t || 0) / 60000))}:${pad(Math.floor(((t || 0) % 60000) / 1000))}`;
  const mmssms = (t) => `${mmss(t)}.${pad((t || 0) % 1000, 3)}`;
  const fmtVal = (v) => {
    if (v === true) return "yes";
    if (v === false) return "no";
    if (v === undefined || v === null) return "—";
    if (typeof v === "number") return v.toLocaleString();
    return String(v);
  };
  const safeJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const api = async (path, opts) => {
    const r = await fetch(path, Object.assign({ headers: { "content-type": "application/json" } }, opts || {}));
    const text = await r.text();
    const body = safeJSON(text);
    if (!r.ok) throw new Error((body && body.error) || `${r.status} ${r.statusText}`);
    return body;
  };
  let toastTimer;
  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  };

  // ------------------------------------------------------------------ state
  const app = {
    scenarios: [],
    brains: ["scripted"],
    brain: "scripted",
    mode: "watch",
    transport: "simulator",
    call: null, // live call view-model
    es: null,   // EventSource
  };

  function newCallModel(scenario, mode, id) {
    return {
      id, scenario, mode,
      brain: app.brain,
      status: "running",
      events: [],
      transcript: [],       // {turnId, source, text, t}
      evidence: [],         // Evidence objects (by id, updated on verify)
      mission: { verified: [], missing: [], pending: [] },
      ux: "idle",
      speaking: null,
      lastTtfa: null,
      cost: 0,
      elapsed: 0,
      traces: [],
      brainLatency: {},     // turnId -> ms
      calleeName: scenario && scenario.callee ? scenario.callee.name : "Callee",
      result: null,
      score: null,
      metrics: null,
      endReason: null,
      replay: false,
    };
  }

  // ------------------------------------------------------------------ screens
  const screens = { start: $("#screen-start"), real: $("#screen-real"), call: $("#screen-call") };
  function show(name) {
    for (const k of Object.keys(screens)) screens[k].hidden = k !== name;
    window.scrollTo({ top: 0 });
  }

  // ------------------------------------------------------------------ start screen
  async function loadStart() {
    try {
      const [scenarios, brains] = await Promise.all([api("/api/scenarios"), api("/api/brains")]);
      app.scenarios = Array.isArray(scenarios) ? scenarios : [];
      app.brains = Array.isArray(brains) && brains.length ? brains : ["scripted"];
      if (!app.brains.includes(app.brain)) app.brain = app.brains[0];
    } catch (e) {
      $("#scenario-list").replaceChildren(el("p", { class: "muted mono", text: `Could not load missions: ${e.message}` }));
      return;
    }
    const sel = $("#brain-select");
    sel.replaceChildren(...app.brains.map((b) => el("option", { value: b, text: b })));
    sel.value = app.brain;
    $("#brain-row").hidden = app.brains.length < 2;
    renderScenarioList();
  }

  function renderScenarioList() {
    const list = $("#scenario-list");
    if (!app.scenarios.length) {
      list.replaceChildren(el("p", { class: "muted mono", text: "No missions found in scenarios/." }));
      return;
    }
    list.replaceChildren(
      ...app.scenarios.map((s, i) => {
        const btn = el("button", { type: "button", class: "scenario-btn", style: `animation-delay:${60 + i * 50}ms` }, [
          el("div", { class: "face", "aria-hidden": "true", text: s.callee && s.callee.avatar ? s.callee.avatar : "○" }),
          el("div", {}, [
            el("div", { class: "s-title", text: s.title }),
            el("div", { class: "s-brief", text: s.brief || s.description || "" }),
            el("div", { class: "s-meta", text: `${s.callee ? s.callee.name : ""} · ${s.domain} · ${s.language}` }),
          ]),
          el("div", { class: `s-diff ${s.difficulty}`, text: s.difficulty }),
        ]);
        btn.addEventListener("click", () => startCall(s));
        return btn;
      }),
    );
  }

  $$(".mode-btn").forEach((b) => b.addEventListener("click", () => {
    app.mode = b.dataset.mode;
    $$(".mode-btn").forEach((x) => { const on = x === b; x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", String(on)); });
  }));
  $("#brain-select").addEventListener("change", (e) => { app.brain = e.target.value; });

  $$(".tt-btn").forEach((b) => b.addEventListener("click", () => {
    const t = b.dataset.transport;
    $$(".tt-btn").forEach((x) => { const on = x === b; x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", String(on)); });
    app.transport = t;
    if (t === "real") show("real"); else if (!screens.call.hidden) { /* stay */ } else show("start");
  }));
  $("#real-back").addEventListener("click", () => {
    app.transport = "simulator";
    $$(".tt-btn").forEach((x) => { const on = x.dataset.transport === "simulator"; x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", String(on)); });
    show("start");
  });

  // local popover
  const localBtn = $("#local-btn"), localPop = $("#local-pop");
  localBtn.addEventListener("click", () => {
    const open = localPop.hidden;
    localPop.hidden = !open;
    localBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (!localPop.hidden && !localPop.contains(e.target) && e.target !== localBtn && !localBtn.contains(e.target)) {
      localPop.hidden = true; localBtn.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !localPop.hidden) { localPop.hidden = true; localBtn.setAttribute("aria-expanded", "false"); } });

  // replays
  $("#replays-link").addEventListener("click", async () => {
    const panel = $("#replays-panel");
    const open = panel.hidden;
    panel.hidden = !open;
    $("#replays-link").setAttribute("aria-expanded", String(open));
    if (!open) return;
    const ul = $("#replay-list");
    ul.replaceChildren(el("li", { class: "muted mono", text: "Loading…" }));
    try {
      const list = await api("/api/replays");
      if (!list.length) { ul.replaceChildren(el("li", { class: "muted mono", text: "No saved calls yet. Finished calls are saved to .oathra/calls/." })); return; }
      ul.replaceChildren(...list.slice().reverse().map((r) => el("li", {}, [
        el("button", { type: "button", class: "replay-btn", onclick: () => openReplay(r.id) }, [
          el("span", { text: r.id }),
          el("span", { class: "muted", text: `${r.scenario || "?"} · ${r.status || "?"}${r.durationMs ? ` · ${mmss(r.durationMs)}` : ""}` }),
        ]),
      ])));
    } catch (e) {
      ul.replaceChildren(el("li", { class: "muted mono", text: `Could not load replays: ${e.message}` }));
    }
  });

  // ------------------------------------------------------------------ call lifecycle
  async function startCall(scenario) {
    if (app.transport === "real") { show("real"); return; }
    closeStream();
    let created;
    try {
      created = await api("/api/calls", { method: "POST", body: JSON.stringify({ scenarioId: scenario.id, brain: app.brain, mode: app.mode }) });
    } catch (e) { toast(`Could not start call: ${e.message}`); return; }
    app.call = newCallModel(created.scenario || scenario, created.mode || app.mode, created.callId);
    app.call.brain = created.brain || app.brain;
    renderCallShell();
    show("call");
    openStream(app.call.id);
  }

  function openStream(id) {
    closeStream();
    const es = new EventSource(`/api/calls/${encodeURIComponent(id)}/events`);
    app.es = es;
    es.addEventListener("call", (m) => {
      const ev = safeJSON(m.data);
      if (ev) ingest(ev);
    });
    es.addEventListener("done", () => { closeStream(); finish(); });
    es.onerror = () => {
      // Reconnect strategy: refetch full call state, rebuild, then resume if still running.
      closeStream();
      setTimeout(() => resync(id), 800);
    };
  }
  function closeStream() { if (app.es) { app.es.close(); app.es = null; } }

  async function resync(id) {
    if (!app.call || app.call.id !== id) return;
    try {
      const c = await api(`/api/calls/${encodeURIComponent(id)}`);
      rebuildFromEvents(c.events || []);
      if (c.status === "running") openStream(id);
      else finish(c);
    } catch (e) {
      toast(`Connection lost: ${e.message}`);
      setLive(false, "OFFLINE");
    }
  }

  async function finish(fetched) {
    const c = app.call;
    if (!c) return;
    try {
      const full = fetched || (c.replay ? null : await api(`/api/calls/${encodeURIComponent(c.id)}`));
      if (full) {
        c.status = full.status || "done";
        if (full.result) c.result = full.result;
        if (full.score) c.score = full.score;
        if (full.metrics) c.metrics = full.metrics;
        if (full.endReason) c.endReason = full.endReason;
      }
    } catch { /* keep what we have from events */ }
    c.status = c.status === "running" ? "done" : c.status;
    setLive(false, c.status === "error" ? "ERROR" : "ENDED");
    setSpeaking(null);
    $("#play-form").hidden = true;
    renderResult();
  }

  // ------------------------------------------------------------------ ingest events
  function rebuildFromEvents(events) {
    const c = app.call;
    const fresh = newCallModel(c.scenario, c.mode, c.id);
    fresh.brain = c.brain; fresh.replay = c.replay;
    app.call = fresh;
    renderCallShell();
    for (const ev of events) ingest(ev, true);
    renderAll();
  }

  function ingest(ev, silent) {
    const c = app.call;
    if (!c || typeof ev !== "object") return;
    c.events.push(ev);
    if (typeof ev.t === "number" && ev.t > c.elapsed) c.elapsed = ev.t;
    switch (ev.type) {
      case "call.started":
        if (ev.brain) c.brain = ev.brain;
        break;
      case "call.connected":
        if (ev.callee) c.calleeName = ev.callee;
        break;
      case "state.changed":
        c.ux = ev.ux || "idle";
        break;
      case "callee.speech.started": c.speaking = "callee"; break;
      case "callee.speech.ended": if (c.speaking === "callee") c.speaking = null; break;
      case "agent.speech.started":
        c.speaking = "agent";
        pushLine(c, { turnId: ev.turnId, source: "caller", text: ev.text, t: ev.t });
        break;
      case "agent.speech.ended": if (c.speaking === "agent") c.speaking = null; break;
      case "transcript.final":
        pushLine(c, { turnId: ev.turnId, source: ev.source, text: ev.text, t: ev.endMs });
        break;
      case "evidence.created":
      case "evidence.verified":
        upsertEvidence(c, ev.evidence);
        break;
      case "mission.progress":
        c.mission = { verified: ev.verified || [], missing: ev.missing || [], pending: ev.pending || [] };
        break;
      case "brain.response":
        if (typeof ev.costUsd === "number") c.cost += ev.costUsd;
        if (typeof ev.latencyMs === "number") c.brainLatency[ev.turnId] = ev.latencyMs;
        break;
      case "turn.trace":
        if (ev.trace) { c.traces.push(ev.trace); if (typeof ev.trace.ttfaMs === "number") c.lastTtfa = ev.trace.ttfaMs; }
        break;
      case "permission.requested":
        pushLine(c, { turnId: `perm_${ev.seq}`, source: "sys", text: `Permission requested: ${ev.action} — ${ev.detail}`, t: ev.t });
        break;
      case "permission.decided":
        pushLine(c, { turnId: `permd_${ev.seq}`, source: "sys", text: `Permission ${ev.approved ? "approved" : "denied"} (${ev.by}): ${ev.action}`, t: ev.t });
        break;
      case "call.ended":
        c.endReason = ev.reason;
        c.speaking = null;
        break;
      case "result":
        c.result = ev.result;
        break;
      case "error":
        pushLine(c, { turnId: `err_${ev.seq}`, source: "sys", text: `Error: ${ev.message}`, t: ev.t });
        if (ev.fatal) c.status = "error";
        break;
      default: break;
    }
    if (!silent) renderIncremental(ev);
  }

  function pushLine(c, line) {
    if (c.transcript.some((l) => l.turnId === line.turnId)) return;
    c.transcript.push(line);
  }
  function upsertEvidence(c, e) {
    if (!e || !e.id) return;
    const i = c.evidence.findIndex((x) => x.id === e.id);
    if (i >= 0) c.evidence[i] = e; else c.evidence.push(e);
  }

  // ------------------------------------------------------------------ rendering
  function renderCallShell() {
    const c = app.call;
    $("#call-title").textContent = c.scenario ? c.scenario.title : c.id;
    $("#agent-name").textContent = c.brain || "agent";
    $("#callee-name").textContent = c.mode === "play" ? "You" : c.calleeName;
    const avatar = c.scenario && c.scenario.callee && c.scenario.callee.avatar;
    $("#callee-avatar").textContent = c.mode === "play" ? "you" : (avatar || "◉");
    $("#transcript").replaceChildren(el("p", { class: "transcript-empty", text: c.replay ? "Replaying…" : "Dialing…" }));
    $("#mission-list").replaceChildren();
    $("#evidence-list").replaceChildren();
    missionState.clear();
    $("#evidence-count").textContent = "0";
    $("#result-wrap").hidden = true; $("#result-wrap").replaceChildren();
    $("#timeline").replaceChildren(); $("#events-raw").textContent = ""; $("#snapshot").hidden = true;
    $(".timeline-wrap").classList.remove("has-snap");
    $("#latency-table tbody").replaceChildren();
    $("#m-latency").textContent = "—"; $("#m-cost").textContent = "$0.000"; $("#m-elapsed").textContent = "00:00";
    setLive(!c.replay, c.replay ? "REPLAY" : "LIVE");
    setUx("idle");
    setSpeaking(null);
    const play = c.mode === "play" && !c.replay;
    $("#play-form").hidden = !play;
    $("#play-brief").hidden = !play;
    if (play) {
      $("#play-label").textContent = `You are ${c.calleeName}. Answer the phone.`;
      $("#play-brief-text").textContent = c.scenario.brief || c.scenario.description || "";
      setTimeout(() => $("#play-text").focus(), 50);
    }
    renderMission();
  }

  function renderAll() {
    renderTranscript();
    renderMission();
    renderEvidence(true);
    renderMetrics();
    renderDrawer();
    setUx(app.call.ux);
    setSpeaking(app.call.speaking);
    if (app.call.result) renderResult();
  }

  function renderIncremental(ev) {
    const c = app.call;
    switch (ev.type) {
      case "state.changed": setUx(c.ux); break;
      case "callee.speech.started": case "callee.speech.ended": case "agent.speech.ended": case "call.ended":
        setSpeaking(c.speaking); break;
      case "agent.speech.started": setSpeaking("agent"); renderTranscript(); break;
      case "transcript.final": case "permission.requested": case "permission.decided": case "error": renderTranscript(); break;
      case "evidence.created": case "evidence.verified": renderEvidence(); renderMission(); break;
      case "mission.progress": renderMission(); break;
      case "turn.trace": case "brain.response": renderMetrics(); break;
      case "call.connected": $("#callee-name").textContent = c.mode === "play" ? "You" : c.calleeName; break;
      case "result": renderResult(); break;
      default: break;
    }
    renderMetrics();
    if (!$("#drawer-body").hidden) renderDrawer();
  }

  function setLive(on, text) {
    const b = $("#live-badge");
    b.classList.toggle("is-live", !!on);
    $("#live-text").textContent = text || (on ? "LIVE" : "ENDED");
  }
  const UX_LABEL = { listening: "Listening", understanding: "Understanding", acting: "Acting", speaking: "Speaking", idle: "Idle" };
  function setUx(ux) {
    const n = $("#ux-state");
    n.dataset.ux = ux || "idle";
    $("#ux-text").textContent = UX_LABEL[ux] || "Idle";
  }
  function setSpeaking(side) {
    $("#party-agent").classList.toggle("is-speaking", side === "agent");
    $("#party-callee").classList.toggle("is-speaking", side === "callee");
    const bar = $("#activity-bar");
    bar.classList.toggle("agent", side === "agent");
    bar.classList.toggle("callee", side === "callee");
  }

  function renderTranscript() {
    const c = app.call;
    const box = $("#transcript");
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const existing = new Set($$(".line", box).map((n) => n.dataset.turn));
    const empty = $(".transcript-empty", box);
    if (!c.transcript.length) {
      if (!empty) box.replaceChildren(el("p", { class: "transcript-empty", text: c.status === "running" ? "Dialing…" : "No transcript." }));
      return;
    }
    if (empty) empty.remove();
    for (const l of c.transcript) {
      if (existing.has(l.turnId)) continue;
      const cls = l.source === "caller" ? "agent" : l.source === "callee" ? "callee" : "sys";
      const who = l.source === "caller" ? "Agent" : l.source === "callee" ? (c.mode === "play" ? "You" : c.calleeName) : "system";
      box.appendChild(el("div", { class: `line ${cls}`, "data-turn": l.turnId }, [
        el("div", { class: "who", text: who }),
        el("div", { class: "say", text: l.text }),
      ]));
    }
    if (atBottom || c.transcript.length <= 2) box.scrollTop = box.scrollHeight;
  }

  function missionFields(c) {
    const s = c.scenario || {};
    const keys = [];
    for (const k of Object.keys(s.require || {})) if (s.require[k]) keys.push(k);
    for (const k of Object.keys(s.constraints || {})) if (!keys.includes(k)) keys.push(k);
    return keys;
  }
  function latestVerified(c) {
    const m = {};
    for (const e of c.evidence) if (e.verified) m[e.field] = e.value;
    return m;
  }
  function latestPending(c) {
    const m = {};
    for (const e of c.evidence) if (!e.verified) m[e.field] = e.value;
    return m;
  }
  function constraintText(rule) {
    if (!rule || typeof rule !== "object") return "";
    const parts = [];
    for (const k of Object.keys(rule)) {
      const v = rule[k];
      const sym = { eq: "=", ne: "≠", lte: "≤", gte: "≥", lt: "<", gt: ">", oneOf: "∈" }[k] || k;
      parts.push(`${sym} ${Array.isArray(v) ? v.join("|") : fmtVal(v)}`);
    }
    return parts.join(" ");
  }
  function violates(rule, v) {
    if (!rule || v === undefined || v === null) return false;
    const cmp = (a, b) => (typeof a === "number" && typeof b === "number") ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    if (rule.eq !== undefined && cmp(v, rule.eq) !== 0) return true;
    if (rule.ne !== undefined && cmp(v, rule.ne) === 0) return true;
    if (rule.lte !== undefined && cmp(v, rule.lte) > 0) return true;
    if (rule.gte !== undefined && cmp(v, rule.gte) < 0) return true;
    if (rule.lt !== undefined && cmp(v, rule.lt) >= 0) return true;
    if (rule.gt !== undefined && cmp(v, rule.gt) <= 0) return true;
    if (Array.isArray(rule.oneOf) && !rule.oneOf.some((x) => cmp(v, x) === 0)) return true;
    return false;
  }

  const missionState = new Map(); // field -> last class, to animate transitions only
  function renderMission() {
    const c = app.call;
    const ul = $("#mission-list");
    const verified = latestVerified(c);
    const pending = latestPending(c);
    const constraints = (c.scenario && c.scenario.constraints) || {};
    const fields = missionFields(c);
    const rows = fields.map((f) => {
      let cls = "missing", mark = "·", val = "";
      if (verified[f] !== undefined) {
        cls = "verified"; mark = "✓"; val = fmtVal(verified[f]);
        if (violates(constraints[f], verified[f])) { cls = "violation"; mark = "✗"; }
      } else if (pending[f] !== undefined) {
        cls = "pending"; mark = "○"; val = fmtVal(pending[f]);
      }
      const prev = missionState.get(f);
      const tick = prev !== undefined && prev !== cls && cls === "verified" ? " tick" : "";
      missionState.set(f, cls);
      return el("li", { class: `mrow ${cls}${tick}`, "data-field": f }, [
        el("span", { class: "mk", "aria-hidden": "true", text: mark }),
        el("span", {}, [
          el("span", { text: f }),
          constraints[f] ? el("span", { class: "mc", text: `  ${constraintText(constraints[f])}` }) : null,
          el("span", { class: "sr", hidden: true, text: cls }),
        ]),
        el("span", { class: "mv", text: val }),
      ]);
    });
    ul.replaceChildren(...(rows.length ? rows : [el("li", { class: "mrow missing" }, [el("span", { class: "mk", text: "·" }), el("span", { text: "no required fields" }), el("span")])]));
  }

  function evidenceNode(e, extraClass) {
    return el("li", { class: `erow ${e.verified ? "verified" : ""}${extraClass || ""}`, "data-eid": e.id, "data-verified": String(!!e.verified) }, [
      el("div", { class: "e-top" }, [
        el("span", { class: "e-field", text: e.field }),
        el("span", { class: "e-val", text: `= ${fmtVal(e.value)}` }),
        el("span", { class: `e-src ${e.source}`, text: e.source }),
        el("span", { class: `e-ok ${e.verified ? "" : "pending"}`, text: e.verified ? "✓ verified" : "○ pending" }),
      ]),
      el("div", { class: "e-quote" }, [
        el("span", { class: "e-t", text: mmss(e.t) }),
        el("span", { text: `“${e.span || e.transcript || ""}”` }),
      ]),
    ]);
  }
  function renderEvidence(all) {
    const c = app.call;
    const ul = $("#evidence-list");
    if (all || !ul.children.length) {
      ul.replaceChildren(...c.evidence.slice().reverse().map((e) => evidenceNode(e)));
    } else {
      // Newest first: insert unseen items at the top with a slide-in; patch verified state in place.
      const byId = new Map($$(".erow", ul).map((n) => [n.dataset.eid, n]));
      for (const e of c.evidence) {
        const node = byId.get(e.id);
        if (!node) { ul.prepend(evidenceNode(e, " is-new")); continue; }
        if (node.dataset.verified !== String(!!e.verified)) {
          node.replaceWith(evidenceNode(e, e.verified ? " just-verified" : ""));
        }
      }
    }
    $("#evidence-count").textContent = String(c.evidence.filter((e) => e.verified).length);
  }

  function renderMetrics() {
    const c = app.call;
    $("#m-latency").textContent = c.lastTtfa === null ? "—" : String(c.lastTtfa);
    $("#m-cost").textContent = `$${c.cost.toFixed(3)}`;
    $("#m-elapsed").textContent = mmss(c.elapsed);
  }

  // ------------------------------------------------------------------ result
  function statusTitle(status) {
    return { completed: "MISSION COMPLETE", incomplete: "INCOMPLETE", constraint_violation: "CONSTRAINT VIOLATION", failed: "FAILED" }[status] || String(status || "UNKNOWN").toUpperCase();
  }
  function resultMarkdown() {
    const c = app.call, r = c.result || {};
    const req = missionFields(c);
    const lines = [`**${c.scenario ? c.scenario.title : c.id}** — ${statusTitle(r.status)}`, ""];
    for (const f of req) lines.push(`- ${r.fields && r.fields[f] !== undefined ? "✓" : "·"} ${f}: ${fmtVal(r.fields ? r.fields[f] : undefined)}`);
    const verifiedN = (r.evidence || []).filter((e) => e.verified).length;
    lines.push("", `${r.complete ? "VERIFIED" : "NOT VERIFIED"} · Evidence: ${verifiedN} · Confidence: ${typeof r.confidence === "number" ? r.confidence.toFixed(3) : "—"}`);
    if (c.metrics && c.metrics.latency) lines.push(`Latency p50: ${c.metrics.latency.ttfaP50Ms ?? "—"} ms · Turns: ${c.metrics.turns ?? c.transcript.length}`);
    if (c.score) {
      lines.push("", "Oathra Score", `- Outcome ${c.score.outcome} · Evidence ${c.score.evidence} · Conversation ${c.score.conversation} · Latency ${c.score.latency} · Efficiency ${c.score.efficiency}`, `- Overall **${c.score.overall}**`, `- False Completion: ${c.score.falseCompletion ? "1 ⚠" : "0"}`);
    }
    lines.push("", `call_id: ${c.id}`, "— Oathra");
    return lines.join("\n");
  }

  function renderResult() {
    const c = app.call;
    const r = c.result;
    const wrap = $("#result-wrap");
    if (!r) return;
    const req = missionFields(c);
    const verifiedN = (r.evidence || []).filter((e) => e.verified).length;
    const fc = c.score && c.score.falseCompletion;
    const cls = fc || r.status === "failed" || r.status === "constraint_violation" ? "bad" : r.status === "completed" ? "" : "warn";
    const missing = new Set(r.missing || []);
    const violations = new Set(((r.constraints && r.constraints.violations) || []).map((v) => v.field));
    const card = el("div", { class: `result ${cls}`, role: "region", "aria-label": "Result" }, [
      el("h3", { class: "result-h", text: fc ? "FALSE COMPLETION" : statusTitle(r.status) }),
      el("ul", { class: "result-lines" }, req.map((f) => {
        const has = r.fields && r.fields[f] !== undefined;
        const k = violations.has(f) ? "x" : has ? "v" : "m";
        return el("li", { class: k, text: `${f}${has ? `  ${fmtVal(r.fields[f])}` : missing.has(f) ? "  (missing)" : ""}` });
      })),
      el("div", { class: `result-badge ${r.complete && !fc ? "ok" : "no"}`, text: r.complete && !fc ? "VERIFIED" : "NOT VERIFIED" }),
      el("div", { class: "result-meta" }, [
        el("div", { text: `Evidence: ${verifiedN}` }),
        el("div", { text: `Confidence: ${typeof r.confidence === "number" ? r.confidence.toFixed(3) : "—"}` }),
        el("div", { text: `Latency p50: ${c.metrics && c.metrics.latency && c.metrics.latency.ttfaP50Ms !== undefined ? `${c.metrics.latency.ttfaP50Ms} ms` : c.lastTtfa !== null ? `${c.lastTtfa} ms (last)` : "—"}` }),
        el("div", { text: `Turns: ${c.metrics ? c.metrics.turns : c.transcript.filter((l) => l.source !== "sys").length}` }),
        c.endReason ? el("div", { text: `Ended: ${c.endReason}` }) : null,
      ]),
      c.score ? el("div", { class: "score-grid" }, [
        el("span", { text: "Outcome" }), el("span", { text: `${c.score.outcome} / 100` }),
        el("span", { text: "Evidence" }), el("span", { text: `${c.score.evidence} / 100` }),
        el("span", { text: "Conversation" }), el("span", { text: `${c.score.conversation} / 100` }),
        el("span", { text: "Latency" }), el("span", { text: `${c.score.latency} / 100` }),
        el("span", { text: "Efficiency" }), el("span", { text: `${c.score.efficiency} / 100` }),
        el("span", { class: "ov", text: "Overall" }), el("span", { class: "ov", text: String(c.score.overall) }),
      ]) : null,
      c.score ? el("div", { class: `result-fc ${fc ? "fail" : ""}`, text: fc ? `False Completion: 1 — reported fields disagree with the callee (${(c.score.disagreements || []).join(", ")})` : "False Completion: 0" }) : null,
      el("div", { class: "result-actions" }, [
        !c.replay ? el("button", { type: "button", class: "btn primary", text: "Run again", onclick: () => startCall(c.scenario) }) : null,
        el("button", { type: "button", class: "btn", text: "New mission", onclick: () => { closeStream(); show("start"); } }),
        el("button", { type: "button", class: "btn", text: "Copy result as Markdown", onclick: async () => {
          const md = resultMarkdown();
          try { await navigator.clipboard.writeText(md); toast("Copied"); } catch { window.prompt("Copy:", md); }
        } }),
      ]),
    ]);
    wrap.replaceChildren(card);
    wrap.hidden = false;
    if (!c.replay) card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }

  // ------------------------------------------------------------------ play mode
  $("#play-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = app.call;
    const input = $("#play-text");
    const text = input.value.trim();
    if (!c || !text) return;
    input.value = "";
    try { await api(`/api/calls/${encodeURIComponent(c.id)}/reply`, { method: "POST", body: JSON.stringify({ text }) }); }
    catch (err) { toast(`Could not send: ${err.message}`); input.value = text; }
    input.focus();
  });
  $("#play-hangup").addEventListener("click", async () => {
    const c = app.call;
    if (!c) return;
    try { await api(`/api/calls/${encodeURIComponent(c.id)}/hangup`, { method: "POST", body: "{}" }); }
    catch (err) { toast(`Could not hang up: ${err.message}`); }
  });
  $("#call-back").addEventListener("click", () => { closeStream(); show("start"); });

  // ------------------------------------------------------------------ drawer / time travel
  const drawerToggle = $("#drawer-toggle"), drawerBody = $("#drawer-body");
  drawerToggle.addEventListener("click", () => {
    const open = drawerBody.hidden;
    drawerBody.hidden = !open;
    drawerToggle.setAttribute("aria-expanded", String(open));
    if (open) renderDrawer();
  });
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    $$(".tab").forEach((x) => { const on = x === t; x.classList.toggle("is-on", on); x.setAttribute("aria-selected", String(on)); });
    $$(".tabpane").forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; });
  }));

  function summary(ev) {
    switch (ev.type) {
      case "call.started": return `${ev.transport} / ${ev.brain}${ev.scenario ? ` · ${ev.scenario}` : ""}`;
      case "call.connected": return ev.callee || "";
      case "state.changed": return `${ev.from} → ${ev.to}`;
      case "transcript.final": return `${ev.source}: ${ev.text}`;
      case "transcript.partial": return `${ev.source}: ${ev.text}`;
      case "agent.speech.started": return ev.text;
      case "evidence.created": return `${ev.evidence.field} = ${fmtVal(ev.evidence.value)} (${ev.evidence.source}${ev.evidence.verified ? ", verified" : ""})`;
      case "evidence.verified": return `${ev.evidence.field} = ${fmtVal(ev.evidence.value)}`;
      case "brain.request": return ev.brain;
      case "brain.response": return `${ev.latencyMs} ms${ev.action ? ` · ${ev.action}` : ""}`;
      case "turn.trace": return `ttfa ${ev.trace && ev.trace.ttfaMs !== undefined ? ev.trace.ttfaMs : "?"} ms`;
      case "mission.progress": return `✓${(ev.verified || []).length} ○${(ev.pending || []).length} ·${(ev.missing || []).length}`;
      case "permission.requested": return `${ev.action}: ${ev.detail}`;
      case "permission.decided": return `${ev.action} ${ev.approved ? "approved" : "denied"} by ${ev.by}`;
      case "call.ended": return ev.reason;
      case "result": return ev.result && ev.result.status;
      case "error": return ev.message;
      default: return ev.turnId || "";
    }
  }

  function renderDrawer() {
    const c = app.call;
    if (!c) return;
    const ol = $("#timeline");
    const atBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 40;
    ol.replaceChildren(...c.events.map((ev) => el("li", {}, [
      el("button", { type: "button", class: "tl-row", "data-seq": ev.seq, onclick: () => showSnapshot(ev.seq) }, [
        el("span", { class: "tl-t", text: mmssms(ev.t) }),
        el("span", { class: "tl-type", text: ev.type }),
        el("span", { class: "tl-sum", text: summary(ev) || "" }),
      ]),
    ])));
    if (atBottom) ol.scrollTop = ol.scrollHeight;
    $("#events-raw").textContent = c.events.map((e) => JSON.stringify(e)).join("\n");
    const tb = $("#latency-table tbody");
    tb.replaceChildren(...c.traces.map((t) => el("tr", {}, [
      el("td", { text: t.turnId }),
      el("td", { class: typeof t.ttfaMs === "number" && t.ttfaMs > 650 ? "over" : "", text: typeof t.ttfaMs === "number" ? `${t.ttfaMs} ms` : "—" }),
      el("td", { text: c.brainLatency[t.turnId] !== undefined ? `${c.brainLatency[t.turnId]} ms` : (typeof t.brainEndMs === "number" && typeof t.brainStartMs === "number" ? `${t.brainEndMs - t.brainStartMs} ms` : "—") }),
    ])));
  }

  function snapshotAt(events, seq) {
    const snap = { t: 0, state: "IDLE", ux: "idle", transcript: [], verified: {}, pending: {}, lastTrace: null };
    for (const e of events) {
      if (e.seq > seq) break;
      snap.t = e.t;
      switch (e.type) {
        case "state.changed": snap.state = e.to; snap.ux = e.ux; break;
        case "transcript.final": snap.transcript.push({ source: e.source, text: e.text }); break;
        case "evidence.created":
          if (e.evidence.verified) snap.verified[e.evidence.field] = e.evidence.value; else snap.pending[e.evidence.field] = e.evidence.value; break;
        case "evidence.verified": snap.verified[e.evidence.field] = e.evidence.value; delete snap.pending[e.evidence.field]; break;
        case "turn.trace": snap.lastTrace = e.trace; break;
        default: break;
      }
    }
    return snap;
  }

  function showSnapshot(seq) {
    const c = app.call;
    const s = snapshotAt(c.events, seq);
    $$(".tl-row").forEach((r) => r.classList.toggle("is-on", Number(r.dataset.seq) === seq));
    const box = $("#snapshot");
    const kv = (obj) => Object.keys(obj).length ? Object.keys(obj).map((k) => `${k} = ${fmtVal(obj[k])}`).join("\n") : "—";
    box.replaceChildren(
      el("h4", { text: `TIME TRAVEL · ${mmssms(s.t)}` }),
      el("div", { class: "kv" }, [
        el("b", { text: "agent state" }), el("span", { text: `${s.state} (${s.ux})` }),
        el("b", { text: "verified" }), el("span", { style: "white-space:pre-line", text: kv(s.verified) }),
        el("b", { text: "pending" }), el("span", { style: "white-space:pre-line", text: kv(s.pending) }),
        el("b", { text: "last ttfa" }), el("span", { text: s.lastTrace && s.lastTrace.ttfaMs !== undefined ? `${s.lastTrace.ttfaMs} ms` : "—" }),
      ]),
      el("h4", { text: "TRANSCRIPT SO FAR" }),
      ...(s.transcript.length ? s.transcript.map((l) => el("p", { class: "sn-line" }, [el("span", { text: l.source === "caller" ? "agent" : "callee" }), document.createTextNode(l.text)])) : [el("p", { class: "sn-line muted", text: "—" })]),
    );
    box.hidden = false;
    $(".timeline-wrap").classList.add("has-snap");
  }

  // ------------------------------------------------------------------ replays
  async function openReplay(id) {
    let rec;
    try { rec = await api(`/api/replays/${encodeURIComponent(id)}`); }
    catch (e) { toast(`Could not load replay: ${e.message}`); return; }
    closeStream();
    const started = (rec.events || []).find((e) => e.type === "call.started");
    const sid = started && started.scenario;
    let scenario = app.scenarios.find((s) => s.id === sid);
    if (!scenario) {
      const ct = rec.contract || {};
      scenario = { id: sid || id, title: ct.goal || id, require: ct.require || {}, constraints: ct.constraints || {}, callee: { name: (ct.target && ct.target.name) || "Callee", avatar: null }, brief: "" };
    }
    app.call = newCallModel(scenario, "watch", rec.callId || id);
    app.call.replay = true;
    if (started && started.brain) app.call.brain = started.brain;
    renderCallShell();
    show("call");
    for (const ev of rec.events || []) ingest(ev, true);
    if (rec.result) app.call.result = rec.result;
    if (rec.metrics) app.call.metrics = rec.metrics;
    app.call.status = "done";
    app.call.speaking = null;
    renderAll();
    setLive(false, "REPLAY");
  }

  // ------------------------------------------------------------------ boot
  // URL params: ?theme=dark|light  ?present=1  ?autostart=<scenarioId>&mode=watch|play
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  if (params.get("present") === "1") document.body.classList.add("present");
  const wantMode = params.get("mode");
  if (wantMode === "play" || wantMode === "watch") {
    app.mode = wantMode;
    $$(".mode-btn").forEach((b) => { const on = b.dataset.mode === wantMode; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
  }
  window.addEventListener("beforeunload", closeStream);
  show("start");
  loadStart().then(() => {
    const auto = params.get("autostart");
    if (!auto) return;
    const scenario = app.scenarios.find((s) => s.id === auto);
    if (scenario) startCall(scenario);
    else toast(`Unknown scenario "${auto}"`);
  });
})();
