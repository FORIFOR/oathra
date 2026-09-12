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
    if (v === true) return t("yes");
    if (v === false) return t("no");
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


  // ------------------------------------------------------------------ i18n
  // ?lang=ja|en, else the browser language. Every user-facing string goes through t().
  const params = new URLSearchParams(location.search);
  const LANG = (params.get("lang") === "ja" || params.get("lang") === "en") ? params.get("lang")
    : ((navigator.language || "").toLowerCase().startsWith("ja") ? "ja" : "en");

  const FIELD_LABELS = {
    ja: { date: "日付", time: "時刻", partySize: "人数", confirmed: "確定", price: "金額", breakfast: "朝食", smoking: "喫煙", serial: "シリアル番号", phone: "電話番号", name: "名前" },
    en: { date: "date", time: "time", partySize: "party size", confirmed: "confirmed", price: "price", breakfast: "breakfast", smoking: "smoking", serial: "serial", phone: "phone", name: "name" },
  };
  const END_LABELS = {
    ja: { agent_hangup: "AIが通話を終了", callee_hangup: "相手が通話を終了", voicemail: "留守番電話を検出して終了", completed: "完了", budget_exceeded: "上限に達して終了", cancelled: "中止", error: "エラー", inactivity: "無音のため終了" },
    en: { agent_hangup: "agent hung up", callee_hangup: "callee hung up", voicemail: "voicemail detected", completed: "completed", budget_exceeded: "budget exceeded", cancelled: "cancelled", error: "error", inactivity: "inactivity" },
  };
  const fieldLabel = (f) => (FIELD_LABELS[LANG] && FIELD_LABELS[LANG][f]) || f;
  const endLabel = (r) => (END_LABELS[LANG] && END_LABELS[LANG][r]) || r;
  document.documentElement.lang = LANG;
  const STR = {
    en: {
      skip: "Skip to content", arena: "Arena", transport: "Transport", simulator: "Simulator", realPhone: "Real Phone", local: "Local",
      popTitle: "Running locally.", popSub: "Everything is yours.", popNeed: "Need:", popNumbers: "phone numbers", popSip: "managed SIP", popTeam: "team deployment", popHosted: "hosted inference",
      startTitle: "Give your agent<br />a mission.", mode: "Mode", watch: "Watch", watchSub: "AI vs AI", play: "Play", playSub: "you answer the phone",
      agentSelect: "Agent", missions: "Missions", loadingMissions: "Loading missions…", noMissions: "No missions found in scenarios/.", loadMissionsFailed: "Could not load missions: {msg}",
      replays: "Past calls", loading: "Loading…", noReplays: "No saved calls yet. Finished calls are saved to .oathra/calls/.", replaysFailed: "Could not load replays: {msg}",
      connectProvider: "Connect a phone provider", provider: "Phone provider", customSip: "Custom SIP", v02: "v0.2",
      realNote: "Real calls run from the CLI today: <code>oathra setup phone</code>, then <code>oathra call --to +81…</code>. Dialing from the Arena comes next.", back: "Back", backToMissions: "Back to missions",
      partyAgent: "AGENT", partyCallee: "CALLEE", transcript: "Transcript", you: "You", agent: "Agent", system: "system",
      live: "LIVE", ended: "ENDED", error: "ERROR", offline: "OFFLINE", replay: "REPLAY",
      idle: "Idle", listening: "Listening", understanding: "Understanding", acting: "Acting", speaking: "Speaking",
      dialing: "Dialing…", replaying: "Replaying…", noTranscript: "No transcript.",
      yourMission: "YOUR MISSION", playLabel: "You are {name}. Answer the phone.", playPlaceholder: "Type what you say…", send: "Send", hangUp: "Hang up",
      foolTitle: "TRY TO FOOL IT", foolHint: "Say one of these as the shop. None of them should count as booked.",
      mission: "MISSION", evidence: "EVIDENCE", noRequired: "no required fields", noEvidence: "No evidence yet.", verified: "verified", pending: "pending", srcCallee: "callee", srcCaller: "agent", srcTool: "tool",
      latency: "Latency", cost: "Cost", details: "Details", timeline: "Timeline", events: "Events", thTurn: "turn", thTtfa: "ttfa", thBrain: "brain",
      yes: "yes", no: "no",
      stCompleted: "MISSION COMPLETE", stIncomplete: "INCOMPLETE", stViolation: "CONSTRAINT VIOLATION", stFailed: "FAILED", stFalse: "FALSE COMPLETION", stUnknown: "UNKNOWN",
      badgeOk: "VERIFIED", badgeNo: "NOT VERIFIED", missing: "(missing)",
      evidenceN: "Evidence: {n}", confidence: "Confidence: {v}", latencyP50: "Latency p50: {v}", last: "{v} ms (last)", turns: "Turns: {n}", endedReason: "Ended: {r}",
      scOutcome: "Outcome", scEvidence: "Evidence", scConversation: "Conversation", scLatency: "Latency", scEfficiency: "Efficiency", scOverall: "Overall",
      fc0: "False Completion: 0", fc1: "False Completion: 1 — reported fields disagree with the callee ({f})",
      runAgain: "Run again", newMission: "New mission", copyMd: "Copy result as Markdown", copied: "Copied", copyPrompt: "Copy:",
      startFailed: "Could not start call: {msg}", connLost: "Connection lost: {msg}", sendFailed: "Could not send: {msg}", hangupFailed: "Could not hang up: {msg}", replayFailed: "Could not load replay: {msg}", unknownScenario: "Unknown scenario \"{id}\"",
      permReq: "Permission requested: {a} — {d}", permDec: "Permission {r} ({by}): {a}", approved: "approved", denied: "denied", errLine: "Error: {msg}",
      ttTitle: "TIME TRAVEL · {t}", ttState: "agent state", ttVerified: "verified", ttPending: "pending", ttLast: "last ttfa", ttTranscript: "TRANSCRIPT SO FAR",
      diffEasy: "easy", diffNormal: "normal", diffHard: "hard", diffExtreme: "extreme", builtin: "Built-in agent",
      mdVerified: "VERIFIED", mdNotVerified: "NOT VERIFIED", mdScore: "Oathra Score",
    },
    ja: {
      skip: "本文へ移動", arena: "Arena", transport: "通話経路", simulator: "シミュレータ", realPhone: "実電話", local: "ローカル実行",
      popTitle: "この Mac の中だけで動いています。", popSub: "データも通話記録も、あなたの手元にあります。", popNeed: "次が必要になったら Oathra Cloud:", popNumbers: "電話番号", popSip: "マネージド SIP", popTeam: "チームでの運用", popHosted: "推論のホスティング",
      startTitle: "AIに、ミッションを。", mode: "モード", watch: "AI同士を見る", watchSub: "AI が店に電話する", play: "自分が電話に出る", playSub: "あなたが店員役",
      agentSelect: "エージェント", missions: "ミッション", loadingMissions: "ミッションを読み込んでいます…", noMissions: "scenarios/ にミッションがありません。", loadMissionsFailed: "ミッションを読み込めませんでした: {msg}",
      replays: "過去の通話", loading: "読み込み中…", noReplays: "保存された通話はまだありません。終了した通話は .oathra/calls/ に保存されます。", replaysFailed: "過去の通話を読み込めませんでした: {msg}",
      connectProvider: "電話会社をつなぐ", provider: "電話会社", customSip: "自前の SIP", v02: "v0.2 で対応",
      realNote: "実電話は今日から CLI で使えます。<code>oathra setup phone</code> で設定し、<code>oathra call --to +81…</code> で発信します。Arena からの発信は次の版で対応します。", back: "戻る", backToMissions: "ミッション一覧へ戻る",
      partyAgent: "AI", partyCallee: "相手", transcript: "会話", you: "あなた", agent: "AI", system: "システム",
      live: "通話中", ended: "終了", error: "エラー", offline: "接続断", replay: "再生",
      idle: "待機", listening: "聞いています", understanding: "考えています", acting: "実行中", speaking: "話しています",
      dialing: "発信中…", replaying: "再生中…", noTranscript: "会話はありません。",
      yourMission: "あなたのミッション", playLabel: "あなたは「{name}」です。電話に出てください。", playPlaceholder: "話す内容を入力…", send: "送信", hangUp: "切る",
      foolTitle: "誤完了を誘ってみる", foolHint: "店側としてこの中のどれかを言ってみてください。どれも「予約できた」にはならないはずです。",
      mission: "ミッション", evidence: "証拠", noRequired: "必須項目はありません", noEvidence: "まだ証拠はありません。", verified: "検証済み", pending: "未確定", srcCallee: "相手", srcCaller: "AI", srcTool: "ツール",
      latency: "応答", cost: "費用", details: "詳細", timeline: "タイムライン", events: "イベント", thTurn: "ターン", thTtfa: "応答", thBrain: "思考",
      yes: "はい", no: "いいえ",
      stCompleted: "ミッション完了", stIncomplete: "未完了", stViolation: "制約違反", stFailed: "失敗", stFalse: "誤った完了", stUnknown: "不明",
      badgeOk: "検証済み", badgeNo: "未検証", missing: "（未取得）",
      evidenceN: "証拠 {n} 件", confidence: "信頼度 {v}", latencyP50: "応答 p50 {v}", last: "{v} ms（直近）", turns: "ターン数 {n}", endedReason: "終了理由 {r}",
      scOutcome: "結果", scEvidence: "証拠", scConversation: "会話", scLatency: "応答速度", scEfficiency: "効率", scOverall: "総合",
      fc0: "誤った完了: 0", fc1: "誤った完了: 1 — 報告した内容が相手の発言と食い違っています（{f}）",
      runAgain: "もう一度", newMission: "別のミッション", copyMd: "結果をコピー", copied: "コピーしました", copyPrompt: "コピー:",
      startFailed: "通話を開始できませんでした: {msg}", connLost: "接続が切れました: {msg}", sendFailed: "送信できませんでした: {msg}", hangupFailed: "切断できませんでした: {msg}", replayFailed: "通話を読み込めませんでした: {msg}", unknownScenario: "シナリオ「{id}」が見つかりません",
      permReq: "許可を求めています: {a} — {d}", permDec: "許可を{r}（{by}）: {a}", approved: "承認", denied: "拒否", errLine: "エラー: {msg}",
      ttTitle: "この時点の状態 · {t}", ttState: "AI の状態", ttVerified: "検証済み", ttPending: "未確定", ttLast: "直近の応答", ttTranscript: "ここまでの会話",
      diffEasy: "かんたん", diffNormal: "ふつう", diffHard: "むずかしい", diffExtreme: "極", builtin: "組み込みエージェント",
      mdVerified: "検証済み", mdNotVerified: "未検証", mdScore: "Oathra スコア",
    },
  };
  const t = (key, vars) => {
    let s = (STR[LANG] && STR[LANG][key]) ?? STR.en[key] ?? key;
    if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
    return s;
  };
  const TITLE_JA = {
    "restaurant-reservation": "レストラン予約", "impossible-hotel": "無理難題ホテル", "bulk-buy": "まとめ買い交渉",
    "serial-number": "シリアル番号の復唱", "false-completion-trap": "満席の罠", "friend-chat": "友達と雑談",
  };
  const scenarioTitle = (s) => (s && LANG === "ja" && TITLE_JA[s.id]) ? TITLE_JA[s.id] : (s && s.title) || (s && s.id) || "";
  const scenarioTitleSub = (s) => (s && LANG === "ja" && TITLE_JA[s.id]) ? s.title : "";
  const briefOf = (s) => (LANG === "ja" ? (s.brief || s.description) : (s.description || s.brief)) || "";
  // Callee lines that must NOT settle the call (docs/launch/miscompletion-cases.md). Shown in Play mode as one-click chips.
  const FOOL = {
    ja: {
      restaurant: ["たぶん大丈夫ですが、まだ確定ではありません", "19時は満席です。19時半なら空いています", "承りました。ただ、料金は2万3500円になります"],
      hotel: ["たぶん大丈夫ですが、まだ確定ではありません", "承りました。ただ、料金は2万3500円になります", "1万8000円でご予約承りました。……失礼しました、2万3500円です"],
      default: ["たぶん大丈夫ですが、まだ確定ではありません", "確認して折り返します", "承りました。ただ、条件は変わります"],
    },
    en: {
      restaurant: ["Probably fine, but it's not confirmed yet", "7 pm is full. 7:30 is open", "Got it. But the price will be 23,500 yen"],
      hotel: ["Probably fine, but it's not confirmed yet", "Got it. But the price will be 23,500 yen", "Booked at 18,000 yen. Sorry, I mean 23,500"],
      default: ["Probably fine, but it's not confirmed yet", "Let me check and call you back", "Got it. But the terms will change"],
    },
  };
  function foolLines(s) {
    const lang = s && s.language === "en" ? "en" : "ja"; // follow the call language, not the UI language
    const id = String((s && s.id) || "");
    const kind = /hotel/.test(id) ? "hotel" : /restaurant/.test(id) ? "restaurant" : "default";
    return FOOL[lang][kind];
  }
  const langLabel = (l) => (l === "ja" ? (LANG === "ja" ? "日本語" : "Japanese") : l === "en" ? (LANG === "ja" ? "英語" : "English") : String(l || ""));
  const diffLabel = (d) => t({ easy: "diffEasy", normal: "diffNormal", hard: "diffHard", extreme: "diffExtreme" }[d] || "diffNormal");
  const brainLabel = (b) => (!b || b === "scripted") ? t("builtin") : String(b);
  const srcLabel = (src) => t(src === "callee" ? "srcCallee" : src === "caller" ? "srcCaller" : "srcTool");
  function applyStatic() {
    for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n);
    for (const n of document.querySelectorAll("[data-i18n-html]")) n.innerHTML = t(n.dataset.i18nHtml);
    for (const n of document.querySelectorAll("[data-i18n-aria]")) n.setAttribute("aria-label", t(n.dataset.i18nAria));
    for (const n of document.querySelectorAll("[data-i18n-placeholder]")) n.setAttribute("placeholder", t(n.dataset.i18nPlaceholder));
    document.title = LANG === "ja" ? "Oathra Arena — AIに電話をかけさせる" : "Oathra Arena";
  }
  applyStatic();

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
      calleeName: scenario && scenario.callee ? scenario.callee.name : t("partyCallee"),
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
      $("#scenario-list").replaceChildren(el("p", { class: "muted mono", text: t("loadMissionsFailed", { msg: e.message }) }));
      return;
    }
    const sel = $("#brain-select");
    sel.replaceChildren(...app.brains.map((b) => el("option", { value: b, text: brainLabel(b) })));
    sel.value = app.brain;
    $("#brain-row").hidden = app.brains.length < 2;
    renderScenarioList();
  }

  function renderScenarioList() {
    const list = $("#scenario-list");
    if (!app.scenarios.length) {
      list.replaceChildren(el("p", { class: "muted mono", text: t("noMissions") }));
      return;
    }
    list.replaceChildren(
      ...app.scenarios.map((s, i) => {
        const btn = el("button", { type: "button", class: "scenario-btn", style: `animation-delay:${60 + i * 50}ms` }, [
          el("div", { class: "face", "aria-hidden": "true", text: s.callee && s.callee.avatar ? s.callee.avatar : "○" }),
          el("div", {}, [
            el("div", { class: "s-title" }, [document.createTextNode(scenarioTitle(s)), scenarioTitleSub(s) ? el("span", { class: "s-title-en", text: scenarioTitleSub(s) }) : null]),
            el("div", { class: "s-brief", text: briefOf(s) }),
            el("div", { class: "s-meta", text: `${s.callee ? s.callee.name : ""} · ${langLabel(s.language)}` }),
          ]),
          el("div", { class: `s-diff ${s.difficulty}`, text: diffLabel(s.difficulty) }),
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
    ul.replaceChildren(el("li", { class: "muted mono", text: t("loading") }));
    try {
      const list = await api("/api/replays");
      if (!list.length) { ul.replaceChildren(el("li", { class: "muted mono", text: t("noReplays") })); return; }
      ul.replaceChildren(...list.slice().reverse().map((r) => el("li", {}, [
        el("button", { type: "button", class: "replay-btn", onclick: () => openReplay(r.id) }, [
          el("span", { text: r.id }),
          el("span", { class: "muted", text: `${(LANG === "ja" && TITLE_JA[r.scenario]) || r.scenario || "?"} · ${statusTitle(r.status)}${r.durationMs ? ` · ${mmss(r.durationMs)}` : ""}` }),
        ]),
      ])));
    } catch (e) {
      ul.replaceChildren(el("li", { class: "muted mono", text: t("replaysFailed", { msg: e.message }) }));
    }
  });

  // ------------------------------------------------------------------ call lifecycle
  async function startCall(scenario) {
    if (app.transport === "real") { show("real"); return; }
    closeStream();
    let created;
    try {
      created = await api("/api/calls", { method: "POST", body: JSON.stringify({ scenarioId: scenario.id, brain: app.brain, mode: app.mode }) });
    } catch (e) { toast(t("startFailed", { msg: e.message })); return; }
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
      toast(t("connLost", { msg: e.message }));
      setLive(false, t("offline"));
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
    setLive(false, c.status === "error" ? t("error") : t("ended"));
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
        pushLine(c, { turnId: `perm_${ev.seq}`, source: "sys", text: t("permReq", { a: ev.action, d: ev.detail }), t: ev.t });
        break;
      case "permission.decided":
        pushLine(c, { turnId: `permd_${ev.seq}`, source: "sys", text: t("permDec", { r: t(ev.approved ? "approved" : "denied"), by: ev.by, a: ev.action }), t: ev.t });
        break;
      case "call.ended":
        c.endReason = ev.reason;
        c.speaking = null;
        break;
      case "result":
        c.result = ev.result;
        break;
      case "error":
        pushLine(c, { turnId: `err_${ev.seq}`, source: "sys", text: t("errLine", { msg: ev.message }), t: ev.t });
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
    $("#call-title").textContent = c.scenario ? scenarioTitle(c.scenario) : c.id;
    $("#agent-name").textContent = brainLabel(c.brain);
    $("#callee-name").textContent = c.mode === "play" ? t("you") : c.calleeName;
    const avatar = c.scenario && c.scenario.callee && c.scenario.callee.avatar;
    $("#callee-avatar").textContent = c.mode === "play" ? "◉" : (avatar || "◉");
    $("#transcript").replaceChildren(el("p", { class: "transcript-empty", text: c.replay ? t("replaying") : t("dialing") }));
    $("#mission-list").replaceChildren();
    $("#evidence-list").replaceChildren();
    missionState.clear();
    $("#evidence-count").textContent = "0";
    $("#result-wrap").hidden = true; $("#result-wrap").replaceChildren();
    $("#timeline").replaceChildren(); $("#events-raw").textContent = ""; $("#snapshot").hidden = true;
    $(".timeline-wrap").classList.remove("has-snap");
    $("#latency-table tbody").replaceChildren();
    $("#m-latency").textContent = "—"; $("#m-cost").textContent = "$0.000"; $("#m-elapsed").textContent = "00:00";
    setLive(!c.replay, c.replay ? t("replay") : t("live"));
    setUx("idle");
    setSpeaking(null);
    const play = c.mode === "play" && !c.replay;
    $("#play-form").hidden = !play;
    $("#play-brief").hidden = !play;
    if (play) {
      $("#play-label").textContent = t("playLabel", { name: c.calleeName });
      $("#play-brief-text").textContent = briefOf(c.scenario);
      const row = $("#fool-row");
      row.replaceChildren(...foolLines(c.scenario).map((line) => el("button", { type: "button", class: "fool-chip", title: t("foolHint"), text: line })));
      $("#fool").hidden = false;
      setTimeout(() => $("#play-text").focus(), 50);
    } else {
      $("#fool").hidden = true;
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
      case "call.connected": $("#callee-name").textContent = c.mode === "play" ? t("you") : c.calleeName; break;
      case "result": renderResult(); break;
      default: break;
    }
    renderMetrics();
    if (!$("#drawer-body").hidden) renderDrawer();
  }

  function setLive(on, text) {
    const b = $("#live-badge");
    b.classList.toggle("is-live", !!on);
    $("#live-text").textContent = text || (on ? t("live") : t("ended"));
  }
  function setUx(ux) {
    const n = $("#ux-state");
    n.dataset.ux = ux || "idle";
    $("#ux-text").textContent = t(["listening", "understanding", "acting", "speaking"].includes(ux) ? ux : "idle");
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
      if (!empty) box.replaceChildren(el("p", { class: "transcript-empty", text: c.status === "running" ? t("dialing") : t("noTranscript") }));
      return;
    }
    if (empty) empty.remove();
    for (const l of c.transcript) {
      if (existing.has(l.turnId)) continue;
      const cls = l.source === "caller" ? "agent" : l.source === "callee" ? "callee" : "sys";
      const who = l.source === "caller" ? t("agent") : l.source === "callee" ? (c.mode === "play" ? t("you") : c.calleeName) : t("system");
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
          el("span", { text: fieldLabel(f) }),
          constraints[f] ? el("span", { class: "mc", text: `  ${constraintText(constraints[f])}` }) : null,
          el("span", { class: "sr", hidden: true, text: cls }),
        ]),
        el("span", { class: "mv", text: val }),
      ]);
    });
    ul.replaceChildren(...(rows.length ? rows : [el("li", { class: "mrow missing" }, [el("span", { class: "mk", text: "·" }), el("span", { text: t("noRequired") }), el("span")])]));
  }

  function evidenceNode(e, extraClass) {
    return el("li", { class: `erow ${e.verified ? "verified" : ""}${extraClass || ""}`, "data-eid": e.id, "data-verified": String(!!e.verified) }, [
      el("div", { class: "e-top" }, [
        el("span", { class: "e-field", text: e.field }),
        el("span", { class: "e-val", text: `= ${fmtVal(e.value)}` }),
        el("span", { class: `e-src ${e.source}`, text: srcLabel(e.source) }),
        el("span", { class: `e-ok ${e.verified ? "" : "pending"}`, text: `${e.verified ? "✓" : "○"} ${t(e.verified ? "verified" : "pending")}` }),
      ]),
      el("div", { class: "e-quote", title: e.transcript || "" }, [
        el("span", { class: "e-t", text: mmss(e.t) }),
        el("span", { class: "e-q", text: `“${e.span || e.transcript || ""}”` }),
      ]),
    ]);
  }
  // The agent restating its request ("9月12日の19時以降で2名") would otherwise add a second
  // pending row for the same field/value/speaker; keep one row per distinct claim (latest time,
  // verified if any occurrence was verified) so the count reflects distinct fields.
  function foldEvidence(list) {
    const m = new Map();
    for (const e of list) {
      const k = `${e.field}|${fmtVal(e.value)}|${e.source}`;
      const prev = m.get(k);
      if (!prev) { m.set(k, e); continue; }
      const latest = e.t >= prev.t ? e : prev;
      m.set(k, latest.verified || !(prev.verified || e.verified) ? latest : { ...latest, verified: true });
    }
    return [...m.values()].sort((a, b) => a.t - b.t);
  }
  function renderEvidence(all) {
    const c = app.call;
    const ul = $("#evidence-list");
    const items = foldEvidence(c.evidence);
    if (!items.length) {
      ul.replaceChildren(el("li", { class: "e-empty muted", text: t("noEvidence") }));
    } else {
      // Newest first: insert unseen items at the top with a slide-in; patch verified state in place;
      // drop rows that were folded into a later duplicate.
      const first = !$$(".erow", ul).length;
      const byId = new Map($$(".erow", ul).map((n) => [n.dataset.eid, n]));
      const keep = new Set(items.map((e) => e.id));
      for (const [id, node] of byId) if (!keep.has(id)) node.remove();
      for (const e of items) {
        const node = byId.get(e.id);
        if (!node) { ul.prepend(evidenceNode(e, all || first ? "" : " is-new")); continue; }
        if (node.dataset.verified !== String(!!e.verified)) {
          node.replaceWith(evidenceNode(e, e.verified ? " just-verified" : ""));
        }
      }
    }
    $("#evidence-count").textContent = items.length ? `${items.filter((e) => e.verified).length} / ${items.length}` : "0";
  }

  function renderMetrics() {
    const c = app.call;
    $("#m-latency").textContent = c.lastTtfa === null ? "—" : String(c.lastTtfa);
    $("#m-cost").textContent = `$${c.cost.toFixed(3)}`;
    $("#m-elapsed").textContent = mmss(c.elapsed);
  }

  // ------------------------------------------------------------------ result
  function statusTitle(status) {
    const k = { completed: "stCompleted", incomplete: "stIncomplete", constraint_violation: "stViolation", failed: "stFailed" }[status];
    return k ? t(k) : status ? String(status).toUpperCase() : t("stUnknown");
  }
  function resultMarkdown() {
    const c = app.call, r = c.result || {};
    const req = missionFields(c);
    const lines = [`**${c.scenario ? scenarioTitle(c.scenario) : c.id}** — ${statusTitle(r.status)}`, ""];
    for (const f of req) lines.push(`- ${r.fields && r.fields[f] !== undefined ? "✓" : "·"} ${f}: ${fmtVal(r.fields ? r.fields[f] : undefined)}`);
    const verifiedN = (r.evidence || []).filter((e) => e.verified).length;
    lines.push("", `${t(r.complete ? "mdVerified" : "mdNotVerified")} · ${t("evidenceN", { n: verifiedN })} · ${t("confidence", { v: typeof r.confidence === "number" ? r.confidence.toFixed(3) : "—" })}`);
    if (c.metrics && c.metrics.latency) lines.push(`${t("latencyP50", { v: `${c.metrics.latency.ttfaP50Ms ?? "—"} ms` })} · ${t("turns", { n: c.metrics.turns ?? c.transcript.length })}`);
    if (c.score) {
      lines.push("", t("mdScore"), `- ${t("scOutcome")} ${c.score.outcome} · ${t("scEvidence")} ${c.score.evidence} · ${t("scConversation")} ${c.score.conversation} · ${t("scLatency")} ${c.score.latency} · ${t("scEfficiency")} ${c.score.efficiency}`, `- ${t("scOverall")} **${c.score.overall}**`, `- ${c.score.falseCompletion ? t("fc1", { f: (c.score.disagreements || []).join(", ") }) : t("fc0")}`);
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
    const card = el("div", { class: `result ${cls}`, role: "region", "aria-label": LANG === "ja" ? "結果" : "Result" }, [
      el("h3", { class: "result-h", text: fc ? t("stFalse") : statusTitle(r.status) }),
      el("ul", { class: "result-lines" }, req.map((f) => {
        const has = r.fields && r.fields[f] !== undefined;
        const k = violations.has(f) ? "x" : has ? "v" : "m";
        return el("li", { class: k, text: `${fieldLabel(f)}${has ? `  ${fmtVal(r.fields[f])}` : missing.has(f) ? `  ${t("missing")}` : ""}` });
      })),
      el("div", { class: `result-badge ${r.complete && !fc ? "ok" : "no"}`, text: t(r.complete && !fc ? "badgeOk" : "badgeNo") }),
      el("div", { class: "result-meta" }, [
        el("div", { text: t("evidenceN", { n: verifiedN }) }),
        el("div", { text: t("confidence", { v: typeof r.confidence === "number" ? r.confidence.toFixed(3) : "—" }) }),
        el("div", { text: t("latencyP50", { v: c.metrics && c.metrics.latency && c.metrics.latency.ttfaP50Ms !== undefined ? `${c.metrics.latency.ttfaP50Ms} ms` : c.lastTtfa !== null ? t("last", { v: c.lastTtfa }) : "—" }) }),
        el("div", { text: t("turns", { n: c.metrics ? c.metrics.turns : c.transcript.filter((l) => l.source !== "sys").length }) }),
        c.endReason ? el("div", { text: t("endedReason", { r: endLabel(c.endReason) }) }) : null,
      ]),
      c.score ? el("div", { class: "score-grid" }, [
        el("span", { text: t("scOutcome") }), el("span", { text: `${c.score.outcome} / 100` }),
        el("span", { text: t("scEvidence") }), el("span", { text: `${c.score.evidence} / 100` }),
        el("span", { text: t("scConversation") }), el("span", { text: `${c.score.conversation} / 100` }),
        el("span", { text: t("scLatency") }), el("span", { text: `${c.score.latency} / 100` }),
        el("span", { text: t("scEfficiency") }), el("span", { text: `${c.score.efficiency} / 100` }),
        el("span", { class: "ov", text: t("scOverall") }), el("span", { class: "ov", text: String(c.score.overall) }),
      ]) : null,
      c.score ? el("div", { class: `result-fc ${fc ? "fail" : ""}`, text: fc ? t("fc1", { f: (c.score.disagreements || []).join(", ") }) : t("fc0") }) : null,
      el("div", { class: "result-actions" }, [
        !c.replay ? el("button", { type: "button", class: "btn primary", text: t("runAgain"), onclick: () => startCall(c.scenario) }) : null,
        el("button", { type: "button", class: "btn", text: t("newMission"), onclick: () => { closeStream(); show("start"); } }),
        el("button", { type: "button", class: "btn", text: t("copyMd"), onclick: async () => {
          const md = resultMarkdown();
          try { await navigator.clipboard.writeText(md); toast(t("copied")); } catch { window.prompt(t("copyPrompt"), md); }
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
    catch (err) { toast(t("sendFailed", { msg: err.message })); input.value = text; }
    input.focus();
  });
  $("#fool-row").addEventListener("click", (e) => {
    const chip = e.target.closest(".fool-chip");
    if (!chip) return;
    const input = $("#play-text");
    input.value = chip.textContent;
    input.focus();
  });
  $("#play-hangup").addEventListener("click", async () => {
    const c = app.call;
    if (!c) return;
    try { await api(`/api/calls/${encodeURIComponent(c.id)}/hangup`, { method: "POST", body: "{}" }); }
    catch (err) { toast(t("hangupFailed", { msg: err.message })); }
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
      el("h4", { text: t("ttTitle", { t: mmssms(s.t) }) }),
      el("div", { class: "kv" }, [
        el("b", { text: t("ttState") }), el("span", { text: `${s.state} (${t(["listening", "understanding", "acting", "speaking"].includes(s.ux) ? s.ux : "idle")})` }),
        el("b", { text: t("ttVerified") }), el("span", { style: "white-space:pre-line", text: kv(s.verified) }),
        el("b", { text: t("ttPending") }), el("span", { style: "white-space:pre-line", text: kv(s.pending) }),
        el("b", { text: t("ttLast") }), el("span", { text: s.lastTrace && s.lastTrace.ttfaMs !== undefined ? `${s.lastTrace.ttfaMs} ms` : "—" }),
      ]),
      el("h4", { text: t("ttTranscript") }),
      ...(s.transcript.length ? s.transcript.map((l) => el("p", { class: "sn-line" }, [el("span", { text: srcLabel(l.source) }), document.createTextNode(l.text)])) : [el("p", { class: "sn-line muted", text: "—" })]),
    );
    box.hidden = false;
    $(".timeline-wrap").classList.add("has-snap");
  }

  // ------------------------------------------------------------------ replays
  async function openReplay(id) {
    let rec;
    try { rec = await api(`/api/replays/${encodeURIComponent(id)}`); }
    catch (e) { toast(t("replayFailed", { msg: e.message })); return; }
    closeStream();
    const started = (rec.events || []).find((e) => e.type === "call.started");
    const sid = started && started.scenario;
    let scenario = app.scenarios.find((s) => s.id === sid);
    if (!scenario) {
      const ct = rec.contract || {};
      scenario = { id: sid || id, title: ct.goal || id, require: ct.require || {}, constraints: ct.constraints || {}, callee: { name: (ct.target && ct.target.name) || t("partyCallee"), avatar: null }, brief: "" };
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
    app.call.allEvents = rec.events || [];
    renderAll();
    setLive(false, t("replay"));
  }

  // Scrub an open replay to a point in time: window.oathraSeek(ms) re-renders the call as it was
  // at `ms` (also via postMessage {type:"oathra.seek", ms}). Used by the video renderer and QA.
  function seekReplay(ms) {
    const c = app.call;
    if (!c || !c.replay || !c.allEvents) return;
    const upto = c.allEvents.filter((e) => typeof e.t !== "number" || e.t <= ms);
    rebuildFromEvents(upto);
    app.call.allEvents = c.allEvents;
    const ended = upto.some((e) => e.type === "call.ended");
    app.call.status = ended ? "done" : "running";
    renderAll();
    setLive(!ended, ended ? t("ended") : t("replay"));
    if (!ended) { $("#result-wrap").hidden = true; }
  }
  window.oathraSeek = seekReplay;
  window.addEventListener("message", (e) => {
    const d = e && e.data;
    if (!d || d.type !== "oathra.seek") return;
    seekReplay(Number(d.ms) || 0);
    if (e.source && typeof e.source.postMessage === "function") e.source.postMessage({ type: "oathra.seeked", ms: d.ms, id: d.id, ok: !!(app.call && app.call.replay && app.call.allEvents) }, "*");
  });

  // ------------------------------------------------------------------ boot
  // URL params: ?lang=ja|en  ?theme=dark|light  ?present=1  ?autostart=<scenarioId>&mode=watch|play  ?replay=<callId>
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
    const replayId = params.get("replay");
    if (replayId) { openReplay(replayId); return; }
    const auto = params.get("autostart");
    if (!auto) return;
    const scenario = app.scenarios.find((s) => s.id === auto);
    if (scenario) startCall(scenario);
    else toast(t("unknownScenario", { id: auto }));
  });
})();
