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
    if (!r.ok) { const error = new Error((body && body.error) || `${r.status} ${r.statusText}`); error.status = r.status; throw error; }
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
      phoneSetupAction: "Check phone setup", phoneConsentNeeded: "Check the approval box to call.", phoneSetupNeeded: "Not called. Phone setup is incomplete.", phoneDialPending: "Starting call…", phoneBusyHint: "Check the current call before placing another.", phoneInputHelp: "Input help", phoneSetupDetails: "Setup details", phoneChecking: "Checking setup…", phoneReady: "Phone configured", phoneNotReady: "Phone setup required", phoneTemplate: "Template (optional)", phoneTemplateBlank: "None", phoneTemplateHint: "Replace every {{field}} with your details. You can edit any template. The AI introduces itself as an assistant; bookings and payments are not authorized.", phoneConsent: "I checked the recipient, purpose, providers, charges and recording policy and approve this call.", phoneDial: "Place this call", phoneProgress: "Real call status", phoneRefresh: "Check status", phoneResolve: "I confirmed the call has ended with the carrier", phoneResolveConfirm: "Have you confirmed with the carrier that this call has ended? This does not redial the request.", phoneTranscript: "Conversation transcript", phoneHistory: "Reuse a previous purpose", phoneHistoryHint: "Drafts and call attempts are shown separately by status. Reusing a purpose does not place a call.", phoneUsePurpose: "Use this purpose", phoneUseAll: "Use recipient and purpose", phoneViewRecord: "View status", phoneHistoryEmpty: "No saved requests yet. Reviewing a request saves it here.", phoneReplace: "Replace the text you are editing?", phoneNoStatus: "The call outcome is not confirmed. Check status before trying again; do not start another call.", phoneExpired: "This review has expired. Review the details again before calling.",
      phoneDeveloper: "Place a call from the saved draft (developers)", home: "Home", homeKicker: "Contacts · preparation · practice", homeTitle: "What would you like to do?", homeLead: "Choose a task to see just the tools you need.", homePhoneTitle: "Prepare a call", homePhoneText: "Choose a contact or enter a number, then write what you want to say.", phoneUnavailable: "Configure a phone connection, then review the recipient, purpose and charges before calling. Editing or reusing a request does not place a call.", homePhoneAction: "Prepare a call draft", homeContactsTitle: "Keep contacts together", homeContactsText: "Save a name, company and notes from your last conversation. A phone number is optional.", homeContactsAction: "Open contacts", homePracticeTitle: "Try a practice call", homePracticeText: "Watch two AIs talk, or type replies as the other person. No real phone call is placed.", homePracticeAction: "Choose a practice conversation",
      contacts: "Contacts", contactsIntro: "Save a name or company. Phone and email are optional. Contacts stay on this device; saving does not call or upload them.", contactNew: "New contact", contactEdit: "Edit contact", contactSearch: "Search name or company", contactsEmpty: "No contacts to show. Add a name or company to get started.", contactsReload: "Reload list",
      contactResume: "Return to unsaved changes", contactBack: "Back to contacts", contactHint: "Enter a name or company. Everything else is optional.", contactExtra: "Email and other notes", contactName: "Name", contactCompany: "Company", contactPhone: "Phone (optional)", contactEmail: "Email (optional)", contactLast: "Previous call notes (entered by you)", contactNotes: "Other notes", contactSave: "Save contact", contactUse: "Prepare a call", contactPick: "Choose a contact", contactUseNote: "Save a phone number to prepare a call. Notes and history are not sent to the AI automatically.", contactHistory: "Saved calls to this number", contactHistoryNote: "Matched by the saved phone number, not identity. Shared numbers may include someone else's calls.", contactNoHistory: "No saved calls found for this number.", contactSaved: "Saved on this device.", contactUnsaved: "Unsaved changes", contactSaving: "Saving…", contactDiscard: "Discard unsaved changes?", contactInvalid: "Enter a name or company, and check the optional phone and email.", contactConflict: "This contact was changed elsewhere. Your input remains here. Reload the contact before saving again.", contactOpenCall: "Open saved call", contactReload: "Reload saved contact",
      phoneTitle: "Prepare a call draft", phoneIntro: "1. Enter the number, recipient and purpose → 2. Review → 3. Place the call. Start from a template or a previous purpose.",
      phonePreset: "Speaking preset", phonePresetNote: "Sets the voice and the way the AI speaks together. It never changes what the AI may do or how the result is judged. Choosing a voice below overrides the preset's voice.", phonePresetNone: "None", presetCharacterFemale: "Character · female voice", presetCharacterMale: "Character · male voice", presetSalesFemale: "Business · female voice", presetSalesMale: "Business · male voice", phoneVoice: "AI voice", phoneVoiceNote: "The voice is fixed for the whole call. Gemini voices show Google's own one-word description; a phone line softens breath and closeness.", phoneVoiceDefault: "default", phoneEngine: "Voice AI", phoneEngineNote: "Which model speaks on the call. Only engines whose API key is set on this server can be chosen; the voice is fixed for the whole call.", phoneEngineUnavailable: "not set up", phoneNumber: "Recipient phone number", phoneName: "Recipient name", phoneCallerName: "Your name (optional, told to callee)", phoneInstruction: "Purpose", phoneHelp: "Japanese numbers may start with 0. For other countries, include + and the country code. One number only; no extension.",
      phoneReview: "Review call details", phoneClear: "Clear input", phoneReviewTitle: "Call draft · not sent", phoneSave: "Save call draft (JSON)",
      phonePrivacy: "This draft stays on this device. The downloaded file contains personal information. A real call sends the number to your carrier and conversation data to your voice provider; usage charges apply.",
      phoneNext: "After configuring your phone service, review the saved draft without calling:", phoneApprove: "Only after checking the recipient, recording policy and provider charges, explicitly place the call:", phoneInvalid: "Check the number, recipient and purpose, and replace every {{field}} in the template.",
      resumeCall: "Return to the current call", activeCall: "A call is still in progress. Finish or hang up before starting another.",
      unknownRequest: "This server has no record of the start request. Check Past calls before starting again; a restarted server may have lost an unsaved result.",
      sampleTitle: "Edit a practice response", sampleLabel: "Restaurant response (editable)", sampleText: "Probably, but it is not confirmed yet.", sampleRun: "Open practice with this response",
      practice: "Practice locally → inspect evidence → save a result. No real booking. Default agent: no API fees or uploads.", saved: "Saved locally. Available in Past calls.", saveFailed: "Not saved. Download the result or retry saving; do not repeat the call.", saveUnknown: "Saving has not been confirmed.", saveDisabled: "Automatic saving is off. Download to keep this result.", saveRetry: "Retry saving", download: "Download evidence JSON", recover: "Check this call again", unconfirmed: "Connection interrupted. The outcome is unconfirmed. Check the same call; do not start another.", starting: "Starting…", assessmentUnknown: "False completion: not independently assessed", external: "External model: conversation data is sent to the selected provider; API charges may apply.",
      skip: "Skip to content", arena: "Arena", transport: "Transport", simulator: "Practice", realPhone: "Call preparation", local: "Local",
      popTitle: "Running locally.", popSub: "Everything is yours.", popNeed: "Need:", popNumbers: "phone numbers", popSip: "managed SIP", popTeam: "team deployment", popHosted: "hosted inference",
      startTitle: "Pick a call. It starts right away.", emptyTitle: "Pick a call on the left. It starts here.", emptyLead: "The AI saying \"it's booked\" completes nothing. A ✓ appears only when the other side says it.", emptyStep1: "Pick a call", emptyStep2: "Watch it, or answer it yourself", emptyStep3: "The result, in the callee's words", scoreMore: "Score and breakdown", closeDetails: "Close ×", mode: "Mode", watch: "Watch", watchSub: "AI vs AI", play: "Play", playSub: "you answer the phone",
      agentSelect: "Agent", missions: "Missions", loadingMissions: "Loading missions…", noMissions: "No missions found in scenarios/.", loadMissionsFailed: "Could not load missions: {msg}",
      replays: "Past calls", loading: "Loading…", noReplays: "No saved calls yet. Finished calls are saved to .oathra/calls/.", replaysFailed: "Could not load replays: {msg}",
      connectProvider: "Connect a phone provider", provider: "Phone provider", customSip: "Custom SIP", v02: "v0.2",
      realNote: "Real calls run from the CLI today: <code>oathra setup phone</code>, then <code>oathra call --to +81…</code>. Dialing from the Arena comes next.", back: "Back", backToMissions: "Back to missions",
      partyAgent: "AGENT", partyCallee: "CALLEE", transcript: "Transcript", you: "You", agent: "Agent", system: "system",
      live: "LIVE", ended: "ENDED", error: "ERROR", offline: "OFFLINE", replay: "REPLAY",
      idle: "Idle", listening: "Listening", understanding: "Understanding", acting: "Acting", speaking: "Speaking",
      dialing: "Dialing…", replaying: "Replaying…", noTranscript: "No transcript.",
      yourMission: "YOUR MISSION", playLabel: "You are {name}. Answer the phone.", playPlaceholder: "Type what you say…", send: "Send", hangUp: "Hang up", endCall: "End call", endingCall: "Ending…", callCancelled: "Call stopped", endUnknown: "The call status could not be confirmed. Reconnect and check its status before trying again.",
      foolTitle: "TRY TO FOOL IT", foolHint: "Say one of these as the shop. None of them should count as booked.",
      mission: "MISSION", evidence: "EVIDENCE", intake: "OPTIONAL INTAKE", noRequired: "no required fields", noEvidence: "No evidence yet.", verified: "verified", pending: "pending", srcCallee: "callee", srcCaller: "agent", srcTool: "tool", saidBy: "said by {who}", whyAgreed: "the agent proposed it; the callee agreed", whyAccepted: "the callee offered it; the agent accepted", whyCallee: "settled by the callee's own words", waitCallee: "waiting for the callee to agree", waitCaller: "the agent has not accepted this yet", sameSettled: "the same value was settled through another utterance", evidenceCount: "{v} verified / {n}",
      intakeNoAnswers: "No explicit answers recorded.", intakePurpose: "Purpose: {purpose}", intakeQuestions: "Questions: {asked} / {max}", intakeConsent: "Consent: {status}", intakeStopped: "Stopped without inferring a profile.", intakeAnswer: "explicit answer", intakeDeclined: "declined", intakeSkipped: "skipped (dependency not met)",
      latency: "Latency", cost: "Cost", details: "Details", timeline: "Timeline", events: "Events", thTurn: "turn", thTtfa: "ttfa", thBrain: "brain",
      yes: "yes", no: "no",
      stCompleted: "MISSION COMPLETE", stIncomplete: "INCOMPLETE", stViolation: "CONSTRAINT VIOLATION", stFailed: "FAILED", stFalse: "FALSE COMPLETION", stUnknown: "UNKNOWN",
      badgeOk: "VERIFIED", badgeNo: "NOT VERIFIED", missing: "(missing)",
      evidenceN: "Verified evidence: {n}", confidence: "Confidence: {v}", latencyP50: "Latency p50: {v}", last: "{v} ms (last)", turns: "Turns: {n}", endedReason: "Ended: {r}",
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
      phoneSetupAction: "発信設定を確認", phoneConsentNeeded: "同意にチェックすると発信できます。", phoneSetupNeeded: "未発信：電話の接続設定が必要です。", phoneDialPending: "発信を開始しています…", phoneBusyHint: "現在の通話状況を確認してください。", phoneInputHelp: "入力のヒント", phoneSetupDetails: "設定方法", phoneChecking: "設定を確認中…", phoneReady: "発信設定済み", phoneNotReady: "発信には設定が必要です", phoneTemplate: "テンプレート（任意）", phoneTemplateBlank: "使わない", phoneTemplateHint: "{{項目}} を具体的な内容に書き換えてください。文章は自由に編集できます。AI代理であることを伝え、予約の確定・購入・支払いは行いません。", phoneConsent: "相手・目的・送信先・費用・記録方針を確認し、この電話の発信に同意します。", phoneDial: "この内容で電話をかける", phoneProgress: "実際の電話の状況", phoneRefresh: "状況を確認", phoneResolve: "通信事業者で通話の終了を確認しました", phoneResolveConfirm: "通信事業者の管理画面などで、この通話が終了したことを確認しましたか？この操作で再発信はしません。", phoneTranscript: "会話の文字起こし", phoneHistory: "履歴から使う", phoneHistoryHint: "下書き・発信した依頼を状態付きで表示します。履歴の再利用だけでは電話はかかりません。", phoneUsePurpose: "目的だけ使う", phoneUseAll: "相手と目的を使う", phoneViewRecord: "状況を見る", phoneHistoryEmpty: "まだ履歴はありません。内容を確認すると、下書きとしてここに保存されます。", phoneReplace: "編集中の内容を置き換えますか？", phoneNoStatus: "発信・終了したか確認できません。再発信せず、状況を確認してください。", phoneExpired: "確認の有効期限が切れました。内容をもう一度確認してから発信してください。",
      phoneDeveloper: "保存した下書きから発信する（開発者向け）", home: "ホーム", homeKicker: "連絡先・電話の準備・会話の練習", homeTitle: "何をしたいですか？", homeLead: "目的を選ぶと、必要な操作だけが表示されます。", homePhoneTitle: "電話をかける", homePhoneText: "連絡先を選ぶか番号を入力して、相手に伝えたい内容をまとめます。", phoneUnavailable: "電話接続の設定後、相手・目的・費用を確認して発信できます。入力や履歴の再利用だけで電話はかかりません。", homePhoneAction: "相手と伝える内容を入力", homeContactsTitle: "連絡先をまとめる", homeContactsText: "名前・会社名・前回話したことを保存できます。電話番号はなくても登録できます。", homeContactsAction: "連絡先を開く", homePracticeTitle: "会話を練習する", homePracticeText: "AI同士の会話を見るか、相手役として文字で返答します。実際の電話はかかりません。", homePracticeAction: "練習する会話を選ぶ",
      contacts: "連絡先", contactsIntro: "相手の情報と、前回話したことを一か所に。登録だけで電話はかかりません。", contactNew: "連絡先を追加", contactEdit: "連絡先を編集", contactSearch: "名前・会社名で検索", contactsEmpty: "該当する連絡先はありません。名前または会社名から登録できます。", contactsReload: "一覧を再読込",
      contactResume: "入力中の内容に戻る", contactBack: "連絡先一覧へ", contactHint: "名前か会社名のどちらかを入力してください。他は後から追加できます。", contactExtra: "メール・その他のメモを追加", contactName: "名前", contactCompany: "会社名", contactPhone: "電話番号（任意）", contactEmail: "メールアドレス（任意）", contactLast: "前回の電話内容（手入力メモ）", contactNotes: "その他のメモ", contactSave: "連絡先を保存", contactUse: "電話の依頼内容を入力", contactPick: "連絡先から選ぶ", contactUseNote: "電話番号を保存すると電話依頼に進めます。メモや履歴はAIへ自動送信しません。", contactHistory: "同じ電話番号の保存済み通話", contactHistoryNote: "保存された電話番号で照合しています。共有番号の場合は別の人の通話も含まれることがあります。", contactNoHistory: "この番号に一致する保存済み通話はありません。", contactSaved: "この端末に保存しました。", contactUnsaved: "未保存の変更があります", contactSaving: "保存中…", contactDiscard: "未保存の変更を破棄しますか？", contactInvalid: "名前か会社名を入力し、電話番号・メールの形式を確認してください。", contactConflict: "別の操作で更新されています。入力は残しています。保存済みの連絡先を再読込してから編集してください。", contactOpenCall: "保存済みの通話を開く", contactReload: "保存済みの連絡先を再読込",
      phoneTitle: "電話をかける", phoneIntro: "1. 番号・相手・目的を入力 → 2. 発信内容を確認 → 3. 電話をかける。目的はテンプレートや履歴から選べます。",
      phonePreset: "話し方プリセット", phonePresetNote: "声と話し方をまとめて設定します。AIにできることや結果の判定は変わりません。下の「AIの声」を選ぶと、声だけ上書きできます。", phonePresetNone: "指定しない", presetCharacterFemale: "キャラクター風・女性声", presetCharacterMale: "キャラクター風・男性声", presetSalesFemale: "営業・案内・女性声", presetSalesMale: "営業・案内・男性声", phoneVoice: "AIの声", phoneVoiceNote: "声は通話の途中では変えられません。Gemini の声の特徴は Google の説明によるものです。電話の音質では息づかいや近さは弱まります。", phoneVoiceDefault: "標準", phoneEngine: "音声AI", phoneEngineNote: "通話で話すモデルです。このサーバーに API キーがある音声AIだけ選べます。通話の途中では変えられません。", phoneEngineUnavailable: "未設定", phoneNumber: "電話番号", phoneName: "相手", phoneCallerName: "あなたの名前（相手に伝えます・任意）", phoneInstruction: "目的", phoneHelp: "日本の番号は0から入力できます。海外の番号は＋と国番号から入力してください。番号は1件、内線は指定できません。",
      phoneReview: "内容を確認", phoneClear: "入力を消去", phoneReviewTitle: "発信前の下書き・未送信", phoneSave: "発信依頼を保存（JSON）",
      phonePrivacy: "確認した下書きはこの端末内で扱います。保存ファイルには個人情報が含まれます。実発信時は電話会社へ番号、音声AIへ会話データが送信され、利用料金がかかります。",
      phoneNext: "電話サービスの設定後、保存した依頼を発信せずに確認できます：", phoneApprove: "宛先・録音設定・サービスの料金を確認し、実際に発信するときだけ実行してください：", phoneInvalid: "電話番号・相手・目的を確認し、テンプレートの {{項目}} を書き換えてください。",
      resumeCall: "進行中の通話に戻る", activeCall: "進行中の通話があります。終了するか「切る」を押してから次の練習を始めてください。",
      unknownRequest: "このサーバーに開始要求の記録がありません。過去の通話を確認してから新しく始めてください。再起動で未保存の結果を失った可能性があります。",
      sampleTitle: "練習の例文を編集", sampleLabel: "店員役の返答（編集できます）", sampleText: "たぶん大丈夫ですが、まだ確定ではありません。", sampleRun: "この返答で練習を開く",
      practice: "ローカルで練習 → 発話の証拠を確認 → 結果を保存。実予約は行いません。既定のエージェントはAPI費用・外部送信なし。", saved: "ローカルに保存済み。「過去の通話」から再確認できます。", saveFailed: "未保存です。結果をダウンロードするか、保存だけ再試行してください。", saveUnknown: "保存の完了は未確認です。", saveDisabled: "自動保存は無効です。結果をダウンロードしてください。", saveRetry: "保存だけ再試行", download: "証拠JSONを保存", recover: "この通話の状態を再確認", unconfirmed: "接続が途切れ、結果は未確認です。新しい通話を始めず、この通話の状態を再確認してください。", starting: "開始しています…", assessmentUnknown: "誤完了：独立した照合は未実施", external: "外部モデル：会話データが選択した提供元に送信され、API料金が発生する場合があります。",
      skip: "本文へ移動", arena: "Arena", transport: "通話経路", simulator: "電話の練習", realPhone: "電話をかける", local: "ローカル実行",
      popTitle: "この Mac の中だけで動いています。", popSub: "データも通話記録も、あなたの手元にあります。", popNeed: "次が必要になったら Oathra Cloud:", popNumbers: "電話番号", popSip: "マネージド SIP", popTeam: "チームでの運用", popHosted: "推論のホスティング",
      startTitle: "電話を選ぶと、すぐ始まります。", emptyTitle: "左から電話を選ぶと、ここで始まります。", emptyLead: "AIが「決まりました」と言っても、完了にはなりません。相手がそう言ったときだけ ✓ が付きます。", emptyStep1: "電話を選ぶ", emptyStep2: "会話を見る（自分が出てもよい）", emptyStep3: "相手の言葉で、結果が決まる", scoreMore: "スコアと内訳", closeDetails: "閉じる ×", mode: "モード", watch: "AI同士を見る", watchSub: "AI 同士の練習", play: "自分が電話に出る", playSub: "相手役で練習",
      agentSelect: "エージェント", missions: "ミッション", loadingMissions: "ミッションを読み込んでいます…", noMissions: "scenarios/ にミッションがありません。", loadMissionsFailed: "ミッションを読み込めませんでした: {msg}",
      replays: "過去の通話", loading: "読み込み中…", noReplays: "保存された通話はまだありません。終了した通話は .oathra/calls/ に保存されます。", replaysFailed: "過去の通話を読み込めませんでした: {msg}",
      connectProvider: "電話会社をつなぐ", provider: "電話会社", customSip: "自前の SIP", v02: "v0.2 で対応",
      realNote: "実電話は今日から CLI で使えます。<code>oathra setup phone</code> で設定し、<code>oathra call --to +81…</code> で発信します。Arena からの発信は次の版で対応します。", back: "戻る", backToMissions: "ミッション一覧へ戻る",
      partyAgent: "AI", partyCallee: "相手", transcript: "会話", you: "あなた", agent: "AI", system: "システム",
      live: "通話中", ended: "終了", error: "エラー", offline: "接続断", replay: "再生",
      idle: "待機", listening: "聞いています", understanding: "考えています", acting: "実行中", speaking: "話しています",
      dialing: "発信中…", replaying: "再生中…", noTranscript: "会話はありません。",
      yourMission: "あなたのミッション", playLabel: "あなたは「{name}」です。電話に出てください。", playPlaceholder: "話す内容を入力…", send: "送信", hangUp: "切る", endCall: "通話を終了", endingCall: "終了を確認中…", callCancelled: "通話を中断しました", endUnknown: "終了したか確認できません。通信が戻ったら通話の状態を確認してください。",
      foolTitle: "誤完了を誘ってみる", foolHint: "店側としてこの中のどれかを言ってみてください。どれも「予約できた」にはならないはずです。",
      mission: "ミッション", evidence: "証拠", intake: "追加の聞き取り", noRequired: "必須項目はありません", noEvidence: "まだ証拠はありません。", verified: "検証済み", pending: "未確定", srcCallee: "相手", srcCaller: "AI", srcTool: "ツール", saidBy: "{who}の発言", whyAgreed: "AIの提案を、相手が了承して確定", whyAccepted: "相手の提示を、AIが受けて確定", whyCallee: "相手自身の言葉で確定", waitCallee: "相手の了承待ち", waitCaller: "AIはまだ受けていません", sameSettled: "同じ内容が、別の発言で確定しています", evidenceCount: "検証済み {v} / 全 {n}",
      intakeNoAnswers: "明示回答はまだありません。", intakePurpose: "目的: {purpose}", intakeQuestions: "質問数: {asked} / {max}", intakeConsent: "同意: {status}", intakeStopped: "推測によるプロファイル化はせず終了しました。", intakeAnswer: "明示回答", intakeDeclined: "回答なし", intakeSkipped: "省略（前提未成立）",
      latency: "応答", cost: "費用", details: "詳細", timeline: "タイムライン", events: "イベント", thTurn: "ターン", thTtfa: "応答", thBrain: "思考",
      yes: "はい", no: "いいえ",
      stCompleted: "ミッション完了", stIncomplete: "未完了", stViolation: "制約違反", stFailed: "失敗", stFalse: "誤った完了", stUnknown: "不明",
      badgeOk: "検証済み", badgeNo: "未検証", missing: "（未取得）",
      evidenceN: "検証済みの証拠 {n} 件", confidence: "信頼度 {v}", latencyP50: "応答 p50 {v}", last: "{v} ms（直近）", turns: "ターン数 {n}", endedReason: "終了理由 {r}",
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
    "serial-number": "シリアル番号の復唱", "false-completion-trap": "満席の罠", "friend-chat": "友達と雑談", "friend-hype": "友達とテンション高めの電話",
    "restaurant-reservation-intake": "レストラン予約・追加の聞き取り",
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
      intake: {
        status: scenario && scenario.intake ? "not_started" : "disabled",
        purpose: scenario && scenario.intake ? scenario.intake.purpose : "",
        maxQuestions: scenario && scenario.intake ? scenario.intake.maxQuestions : 0,
        askedQuestions: 0,
        pendingField: null,
        answers: [],
        declined: [],
        skipped: [],
        fields: scenario && scenario.intake ? (scenario.intake.fields || []) : [],
      },
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
  const screens = { home: $("#screen-home"), contacts: $("#screen-contacts"), start: $("#screen-start"), real: $("#screen-real"), call: $("#screen-call") };
  // Wide windows get a board that fits the window (board.css): missions on the left, the call in the middle, result and evidence on the right.
  const BOARD = window.matchMedia("(min-width: 1100px) and (min-height: 600px)");
  const stageEmpty = $("#stage-empty");
  // One page: the mission picker never goes away; the call (and then its result) opens right below it.
  // Presentation mode keeps the old one-screen-at-a-time behaviour for recordings.
  let currentScreen = null;
  const screenHistory = [];
  function show(name, remember = true) {
    if (remember && currentScreen && currentScreen !== name) screenHistory.push(currentScreen);
    currentScreen = name;
    $("#navigation-back").disabled = name === "home" && screenHistory.length === 0;
    const viewUrl = new URL(location.href);
    for (const [key, screen] of [["contacts", "contacts"], ["phone", "real"], ["practice", "start"], ["home", "home"]]) {
      if (name === screen) viewUrl.searchParams.set(key, "1"); else viewUrl.searchParams.delete(key);
    }
    if (name === "home") for (const key of ["call", "replay", "autostart"]) viewUrl.searchParams.delete(key);
    history.replaceState(null, "", viewUrl);
    $$(".tt-btn").forEach(button => {
      const selected = button.dataset.transport === "real" ? name === "real" : ["start", "call"].includes(name);
      button.classList.toggle("is-on", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    stageEmpty.hidden = name !== "start";
    if (document.body.classList.contains("present")) {
      for (const k of Object.keys(screens)) screens[k].hidden = k !== name;
      window.scrollTo({ top: 0 });
      return;
    }
    screens.home.hidden = name !== "home";
    screens.start.hidden = !["start", "call"].includes(name);
    document.body.classList.toggle("focused-task", ["home", "real", "contacts"].includes(name));
    $("#home-open").setAttribute("aria-pressed", String(name === "home"));
    document.body.classList.toggle("contacts-view", name === "contacts");
    $("#contacts-open").setAttribute("aria-pressed", String(name === "contacts"));
    screens.contacts.hidden = name !== "contacts";
    screens.real.hidden = name !== "real";
    screens.call.hidden = name !== "call";
    document.body.classList.toggle("has-call", name === "call");
    if (name !== "call") $$(".scenario-btn.is-current").forEach((b) => b.classList.remove("is-current"));
    if (BOARD.matches) return; // nothing to scroll to: everything is already on screen
    const target = name === "start" ? null : screens[name];
    const smooth = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: smooth, block: "start" }));
    else window.scrollTo({ top: 0, behavior: smooth });
  }

  $("#navigation-back").addEventListener("click", async () => {
    if (currentScreen === "contacts" && screens.contacts.classList.contains("editing-contact")) {
      $("#contacts-back").click();
      return;
    }
    const previous = screenHistory.pop() || "home";
    if (previous === "call" && activeCallId() === app.call?.id) {
      try { await resumeCall(activeCallId(), false); }
      catch { screenHistory.push(previous); $("#recovery").hidden = false; }
      return;
    }
    show(previous, false);
    // Keep drafts and running calls intact; returning is not a hangup.
    const heading = screens[previous].querySelector("h1, h2, h3");
    if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({preventScroll:true}); }
  });

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
        const btn = el("button", { type: "button", class: "scenario-btn", title: briefOf(s), style: `animation-delay:${60 + i * 50}ms` }, [
          el("div", { class: "face", "aria-hidden": "true", text: s.callee && s.callee.avatar ? s.callee.avatar : "○" }),
          el("div", {}, [
            el("div", { class: "s-title" }, [document.createTextNode(scenarioTitle(s)), scenarioTitleSub(s) ? el("span", { class: "s-title-en", text: scenarioTitleSub(s) }) : null]),
            el("div", { class: "s-brief", text: briefOf(s) }),
            el("div", { class: "s-meta", text: `${s.callee ? s.callee.name : ""} · ${langLabel(s.language)}` }),
          ]),
          el("div", { class: `s-diff ${s.difficulty}`, text: diffLabel(s.difficulty) }),
        ]);
        btn.dataset.scenario = s.id;
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
  $("#home-open").addEventListener("click",()=>show("home"));
  $("#home-phone").addEventListener("click",()=>$(".tt-btn[data-transport=real]").click());
  $("#home-practice").addEventListener("click",()=>$(".tt-btn[data-transport=simulator]").click());
  $("#home-contacts").addEventListener("click",()=>openContacts());
  $("#home-resume").addEventListener("click",()=>$("#resume-call").click());
  $("#real-back").addEventListener("click", () => {
    app.transport = "simulator";
    $$(".tt-btn").forEach((x) => { const on = x.dataset.transport === "simulator"; x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", String(on)); });
    show("home");
  });

  // General contacts are stored by the local server, separately from call drafts.
  const contactKeys = ["name", "company", "phone", "email", "notes", "lastCallNotes"];
  let contacts = [], selectedContact = null, contactDirty = false, contactSaving = false, contactLoad = 0;
  const displayContact = c => c.name || c.company;
  function renderContacts() {
    const query = $("#contacts-search").value.trim().toLocaleLowerCase();
    const matches = contacts.filter(c => `${c.name} ${c.company}`.toLocaleLowerCase().includes(query));
    $("#contacts-empty").hidden = matches.length > 0;
    $("#contacts-list").replaceChildren(...matches.map(c => el("li", {}, [el("button", {type:"button", class:"contact-item", "aria-current":selectedContact?.id === c.id ? "true" : "false", onclick:()=>selectContact(c.id)}, [el("strong", {text:displayContact(c)}), el("span", {text:c.name ? c.company : ""})])])));
  }
  function contactStatus(message, error = false) {
    const node = $("#contact-save-status"); node.textContent = message; node.classList.toggle("bad", error);
  }
  function fillContact(contact, history = [], historyError = null) {
    selectedContact = contact; contactDirty = false;
    for (const key of contactKeys) $("#contact-"+key).value = contact?.[key] || "";
    $("#contact-editor-title").textContent = t(contact ? "contactEdit" : "contactNew");
    $("#contact-use").disabled = !contact?.phone;
    $("#contact-use").hidden = !contact?.phone;
    contactStatus("");
    $("#contact-history").replaceChildren(...(history.length ? history.map(h => el("details", {}, [el("summary", {text:h.recordedAt ? (LANG === "ja" ? "保存更新日時: " : "Saved file updated: ") + new Date(h.recordedAt).toLocaleString(LANG) : h.id}), el("pre", {text:h.summary}), el("button", {type:"button", class:"btn", text:t("contactOpenCall"), onclick:()=>openReplay(h.id)})])) : [el("p", {class:"note",text:historyError ? (LANG === "ja" ? "通話履歴を読み込めません。連絡先は編集できます。保存済み通話のデータを確認してください。" : "Call history could not be loaded. You can still edit this contact. Check saved call data.") : t("contactNoHistory")})]));
    $(".contact-history").hidden = !contact?.phone;
    $("#contact-extra").open = Boolean(contact?.email || contact?.notes);
    renderContacts();
  }
  async function refreshContacts() {
    $("#contacts-error").hidden = true;
    try { contacts = await api("/api/contacts"); renderContacts(); }
    catch(e) { $("#contacts-error").textContent = t("connLost",{msg:e.message}); $("#contacts-error").hidden = false; }
  }
  async function selectContact(id) {
    if (contactSaving || (contactDirty && !confirm(t("contactDiscard")))) return;
    const token = ++contactLoad;
    try { const data = await api(`/api/contacts/${encodeURIComponent(id)}`); if(token !== contactLoad) return; fillContact(data.contact, data.history, data.historyError); contactEditor(true, true); }
    catch(e) { if(token === contactLoad) contactStatus(t("connLost",{msg:e.message}),true); }
  }
  function contactEditor(open, focus = false) {
    $("#screen-contacts").classList.toggle("editing-contact", open);
    $("#contacts-resume").hidden = !contactDirty;
    if (focus) { $("#contact-name").focus(); $("#contact-form").scrollIntoView({block:"start"}); }
  }
  $("#contacts-resume").addEventListener("click",()=>contactEditor(true, true));
  $("#contacts-back").addEventListener("click",()=>{ contactEditor(false); $("#contacts-search").focus(); });
  async function openContacts() { show("contacts"); await refreshContacts(); if (!contacts.length || contactDirty) contactEditor(true); }

  $("#contacts-open").addEventListener("click",openContacts);
  $("#phone-pick-contact").addEventListener("click",openContacts);
  $("#contacts-search").addEventListener("input",renderContacts);
  $("#contacts-reload").addEventListener("click",refreshContacts);
  $("#contacts-new").addEventListener("click",()=>{if(contactSaving || (contactDirty && !confirm(t("contactDiscard")))) return; contactLoad++; fillContact(null); contactEditor(true, true);});
  $("#contact-form").addEventListener("input",()=>{contactLoad++; contactDirty=true; $("#contact-use").disabled=true; contactStatus(t("contactUnsaved"));});
  $("#contact-form").addEventListener("submit",async e=>{
    e.preventDefault(); if(contactSaving) return;
    const input = Object.fromEntries(contactKeys.map(key=>[key,$("#contact-"+key).value]));
    const current = selectedContact;
    if(current) input.revision = current.revision;
    contactSaving=true; contactLoad++; contactStatus(t("contactSaving"));
    const controls = $$("#contact-form input, #contact-form textarea, #contact-form button"); controls.forEach(n=>n.disabled=true);
    try {
      const {contact} = await api(current ? `/api/contacts/${encodeURIComponent(current.id)}` : "/api/contacts",{method:current ? "PUT" : "POST",body:JSON.stringify(input)});
      selectedContact=contact; contactDirty=false;
      contacts = [...contacts.filter(c=>c.id!==contact.id),contact];
      fillContact(contact); contactStatus(t("contactSaved"));
      // History failure must not turn a confirmed save into a false failure.
      try { const data=await api(`/api/contacts/${encodeURIComponent(contact.id)}`); fillContact(contact,data.history,data.historyError); contactStatus(t("contactSaved")); } catch { contactStatus(t("contactSaved")+" "+t("replaysFailed",{msg:t("offline")}),true); }
    } catch(error) {
      contactStatus(error.status===409 ? t("contactConflict") : error.status===400 ? t("contactInvalid") : t("connLost",{msg:error.message}),true);
      if(error.status===409 && current) $("#contact-save-status").append(el("button",{type:"button",class:"btn",text:t("contactReload"),onclick:()=>selectContact(current.id)}));
    } finally {contactSaving=false;controls.forEach(n=>n.disabled=false);$("#contact-use").disabled=contactDirty || !selectedContact?.phone;}
  });
  $("#contact-use").addEventListener("click",()=>{
    if(!selectedContact?.phone || contactDirty) return;
    $("#phone-number").value=selectedContact.phone;$("#phone-name").value=displayContact(selectedContact);
    $("#phone-instruction").value="";
    $("#phone-form").dispatchEvent(new Event("input",{bubbles:true}));
    $(".tt-btn[data-transport=real]").click();$("#phone-instruction").focus();
  });
  fillContact(null);

  // Drafts are inert; only explicit approval submits a reviewed, immutable request.
  let phoneDownloadUrl, phoneReviewData = null, webPhoneRecord = null, phonePollTimer, phoneExpiryTimer;
  let phoneDialPending = false, phoneRevision = 0, phoneTemplates = [];
  const phoneStateText = state => (LANG === "ja" ? {draft:"下書き（未発信）",starting:"発信を開始しています（接続待ち）",running:"通話中",stopping:"終了を確認中",ended:"通話終了",failed:"通話処理が失敗しました",unknown:"発信・終了の結果が未確認"} : {draft:"Draft · not called",starting:"Starting · waiting for connection",running:"In progress",stopping:"Confirming termination",ended:"Call ended",failed:"Call failed",unknown:"Outcome unknown"})[state] || state;
  const webPhoneBusy = () => phoneDialPending || (webPhoneRecord && (["starting","running","stopping"].includes(webPhoneRecord.state) || (webPhoneRecord.state === "unknown" && !webPhoneRecord.resolvedAt)));
  function syncPhoneDial() {
    const expired = phoneReviewData && Date.now() >= Date.parse(phoneReviewData.expiresAt);
    $("#phone-dial").disabled = !phoneReviewData?.readiness?.ready || !$("#phone-consent").checked || expired || Boolean(webPhoneBusy());
    const unconfigured = Boolean(phoneReviewData && !phoneReviewData.readiness?.ready);
    $("#phone-dial").hidden = unconfigured;
    $("#phone-setup").hidden = !unconfigured;
    const reason = !phoneReviewData ? "" : phoneDialPending ? t("phoneDialPending") : webPhoneBusy() ? t("phoneBusyHint") : expired ? t("phoneExpired") : unconfigured ? t("phoneSetupNeeded") : !$("#phone-consent").checked ? t("phoneConsentNeeded") : "";
    $("#phone-dial-hint").textContent = reason;
    $("#phone-dial-hint").hidden = !reason;
  }
  function clearPhoneReview() {
    phoneReviewData = null; clearTimeout(phoneExpiryTimer);
    $("#phone-review").hidden = true; $("#phone-consent").checked = false; $("#phone-dial").disabled = true;
    $("#phone-dial-error").hidden = true;
    if (phoneDownloadUrl) URL.revokeObjectURL(phoneDownloadUrl);
    phoneDownloadUrl = undefined; $("#phone-download").removeAttribute("href");
  }
  let phoneConversationMode='message',phoneSelectedTemplate='';
  function setPhoneMode(mode,selection='') {
    phoneConversationMode=mode==='chat'?'chat':'message';phoneSelectedTemplate=selection;$('#phone-template').value=selection;
    let note=$('#phone-chat-note');if(!note){note=el('p',{id:'phone-chat-note',class:'note'});$('#phone-template').after(note)}
    note.hidden=phoneConversationMode!=='chat';note.textContent=LANG==='ja'?'雑談。ニュースを聞かれたら公開ニュースを確認します（API従量料金）。':'Casual chat. News questions are checked against public headlines (API usage charges apply).';
  }
  function phoneInputChanged() {
    phoneRevision++; clearPhoneReview(); $("#phone-error").hidden = true;
    sessionStorage.setItem("oathra.phoneDraft", JSON.stringify({phone:$("#phone-number").value,name:$("#phone-name").value,callerName:$("#phone-caller-name")?.value||"",instruction:$("#phone-instruction").value,conversationMode:phoneConversationMode}));
  }
  const savedPhoneDraft = safeJSON(sessionStorage.getItem("oathra.phoneDraft"));
  if (savedPhoneDraft && typeof savedPhoneDraft === "object") {
    setPhoneMode(savedPhoneDraft.conversationMode,savedPhoneDraft.conversationMode==="chat"?"chat":"");
    for (const [key, id] of [["phone", "phone-number"], ["name", "phone-name"], ["callerName", "phone-caller-name"], ["instruction", "phone-instruction"]]) {
      if (typeof savedPhoneDraft[key] === "string" && $("#" + id)) $("#" + id).value = savedPhoneDraft[key].slice(0, $("#" + id).maxLength);
    }
  }
  $("#phone-form").addEventListener("input", phoneInputChanged);
  $("#phone-clear").addEventListener("click", () => { phoneRevision++; sessionStorage.removeItem("oathra.phoneDraft"); $("#phone-form").reset(); setPhoneMode("message"); clearPhoneReview(); $("#phone-error").hidden = true; $("#phone-number").focus(); });
  $("#phone-template").addEventListener("change",()=>{
    const template=phoneTemplates.find(item=>item.id === $("#phone-template").value); if(!template) {setPhoneMode("message");phoneInputChanged();return;}
    if($("#phone-instruction").value && !confirm(t("phoneReplace"))) { $("#phone-template").value=phoneSelectedTemplate; return; }
    setPhoneMode(template.conversationMode,template.id);
    $("#phone-instruction").value=template.instruction[LANG] || template.instruction.en;
    phoneInputChanged();$("#phone-instruction").focus();
  });
  let phoneEngineList = [], phoneDefaultEngine = "";
  const PHONE_PRESETS = [["character-female", "presetCharacterFemale"], ["character-male", "presetCharacterMale"], ["sales-female", "presetSalesFemale"], ["sales-male", "presetSalesMale"]];
  const presetLabel = id => { const found = PHONE_PRESETS.find(([key]) => key === id); return found ? t(found[1]) : id; };
  function renderPhonePresets() {
    const select = $("#phone-preset");
    if (!select || select.options.length) return;
    select.replaceChildren(el("option", { value: "", text: t("phonePresetNone") }), ...PHONE_PRESETS.map(([id, key]) => el("option", { value: id, text: t(key) })));
  }
  /** A preset brings its own voice for the chosen engine; the voice select shows it and can still override it. */
  function applyPresetVoice() {
    const preset = $("#phone-preset")?.value, select = $("#phone-voice");
    const engine = phoneEngineList.find(e => e.id === ($("#phone-engine")?.value || phoneDefaultEngine));
    if (!select || !engine) return;
    const voice = preset ? engine.presetVoices?.[preset] : engine.defaultVoice;
    if (voice && [...select.options].some(o => o.value === voice)) select.value = voice;
  }
  $("#phone-preset")?.addEventListener("change", applyPresetVoice);
  function renderPhoneVoices() {
    const select = $("#phone-voice");
    if (!select) return;
    const engine = phoneEngineList.find(e => e.id === ($("#phone-engine")?.value || phoneDefaultEngine));
    const voices = engine?.voices || [];
    const keep = select.value;
    select.replaceChildren(...voices.map(v => el("option", { value: v, text: `${v}${engine.voiceTraits?.[v] ? ` — ${engine.voiceTraits[v]}` : ""}${v === engine.defaultVoice ? `（${t("phoneVoiceDefault")}）` : ""}` })));
    select.value = voices.includes(keep) ? keep : (engine?.defaultVoice || "");
    const hide = voices.length < 2;
    for (const node of [select, $("#phone-voice-note"), select.closest("form")?.querySelector("label[for=phone-voice]")]) if (node) node.hidden = hide;
  }
  $("#phone-engine")?.addEventListener("change", () => { const v = $("#phone-voice"); if (v) v.value = ""; renderPhoneVoices(); applyPresetVoice(); });
  function renderPhoneEngines(readiness) {
    phoneEngineList = readiness.engines || []; phoneDefaultEngine = readiness.defaultEngine || "";
    const select = $("#phone-engine"), engines = readiness.engines || [];
    if (!select) return;
    const keep = select.value;
    select.replaceChildren(...engines.map(e => el("option", { value: e.id, text: `${e.label}${e.ready ? "" : `（${t("phoneEngineUnavailable")}）`}` })));
    select.value = engines.some(e => e.id === keep) ? keep : (readiness.defaultEngine || engines[0]?.id || "");
    const hide = engines.length < 2;
    for (const node of [select, $("#phone-engine-note"), select.closest("form")?.querySelector("label[for=phone-engine]")]) if (node) node.hidden = hide;
    renderPhonePresets();
    renderPhoneVoices();
  }
  function renderPhoneReadiness(readiness) {
    renderPhoneEngines(readiness);
    const issues = readiness.issues || [];
    $("#phone-readiness").replaceChildren(el("strong",{text:t(readiness.ready ? "phoneReady" : "phoneNotReady")}), ...(issues.length ? [el("details", {}, [el("summary", {text:t("phoneSetupDetails")}), ...issues.map(issue=>el("p",{text:issue}))])] : []));
  }
  async function refreshPhoneHistory() {
    try {
      const records=await api("/api/phone/history");
      $("#phone-history-error").hidden=true;
      $("#phone-history-list").replaceChildren(...(records.length ? records.map(record=>el("li",{class:"phone-history-item"},[
        el("strong",{text:record.request.name}),el("span",{text:`${new Date(record.createdAt).toLocaleString(LANG)} · ${phoneStateText(record.state)}`}),
        el("p",{text:record.request.instruction}),
        el("div",{class:"phone-live-actions"},[
          el("button",{type:"button",class:"btn",text:t("phoneUsePurpose"),onclick:()=>reusePhoneRequest(record.request,false)}),
          el("button",{type:"button",class:"btn",text:t("phoneUseAll"),onclick:()=>reusePhoneRequest(record.request,true)}),
          el("button",{type:"button",class:"btn",text:t("phoneViewRecord"),onclick:()=>{if(phoneDialPending || (webPhoneBusy() && webPhoneRecord?.id !== record.id)) { toast(t("phoneNoStatus")); return; } sessionStorage.setItem("oathra.webPhoneActive",record.id);loadWebPhone(record.id,true);}})
        ])
      ])) : [el("li",{class:"note",text:t("phoneHistoryEmpty")})]));
    } catch(error) { $("#phone-history-error").textContent=t("connLost",{msg:error.message});$("#phone-history-error").hidden=false; }
  }
  function reusePhoneRequest(request,all) {
    if($("#phone-instruction").value && !confirm(t("phoneReplace"))) return;
    if(all) {$("#phone-number").value=request.phone;$("#phone-name").value=request.name;if($("#phone-caller-name")) $("#phone-caller-name").value=request.callerName||"";}
    $("#phone-instruction").value=request.instruction;setPhoneMode(request.conversationMode,request.conversationMode==="chat"?"chat":"");
    phoneInputChanged();$("#phone-instruction").focus();$("#phone-form").scrollIntoView({block:"start"});
  }
  async function refreshPhoneResources() {
    const results=await Promise.allSettled([api("/api/phone/status"),api("/api/phone/templates")]);
    if(results[0].status === "fulfilled") renderPhoneReadiness(results[0].value);
    else $("#phone-readiness").textContent=t("connLost",{msg:results[0].reason.message});
    if(results[1].status === "fulfilled") {
      phoneTemplates=results[1].value;
      $("#phone-template").replaceChildren(el("option",{value:"",text:t("phoneTemplateBlank")}),...phoneTemplates.map(item=>el("option",{value:item.id,text:item.title[LANG] || item.title.en})));
      $("#phone-template").value=phoneSelectedTemplate;
    }
    await refreshPhoneHistory();
  }
  $("#phone-history-refresh").addEventListener("click",refreshPhoneHistory);
  $("#phone-setup").addEventListener("click", () => {
    const details = $("#phone-readiness details");
    if (details) { details.open = true; details.querySelector("summary").focus(); details.scrollIntoView({block:"center"}); }
  });
  $("#phone-consent").addEventListener("change",syncPhoneDial);
  $("#phone-form").addEventListener("submit", async e => {
    e.preventDefault();
    const revision = ++phoneRevision;
    clearPhoneReview(); $("#phone-error").hidden = true;
    const callerVal = $("#phone-caller-name")?.value.trim();
    const engineVal = $("#phone-engine")?.value;
    const voiceEngine = phoneEngineList.find(e => e.id === (engineVal || phoneDefaultEngine));
    const voiceVal = $("#phone-voice")?.value;
    const presetVal = $("#phone-preset")?.value;
    const input = { phone: $("#phone-number").value, name: $("#phone-name").value, instruction: $("#phone-instruction").value, ...(callerVal ? { callerName: callerVal } : {}), ...(engineVal ? { engine: engineVal } : {}), ...(presetVal ? { voicePreset: presetVal } : {}), ...(voiceVal && voiceVal !== (presetVal ? voiceEngine?.presetVoices?.[presetVal] : voiceEngine?.defaultVoice) ? { voice: voiceVal } : {}), ...(phoneConversationMode==="chat"?{conversationMode:"chat"}:{}) };
    try {
      const data = await api("/api/phone/prepare", { method: "POST", body: JSON.stringify(input) });
      if (revision !== phoneRevision) return;
      const {request}=data;phoneReviewData=data;
      $("#phone-review-fields").replaceChildren(...[["phoneNumber", request.phone], ["phoneName", request.name], ...(request.callerName ? [["phoneCallerName", request.callerName]] : []), ...(request.engine ? [["phoneEngine", request.engine]] : []), ...(request.voicePreset ? [["phonePreset", presetLabel(request.voicePreset)]] : []), ...(request.voice ? [["phoneVoice", request.voice]] : []), ["phoneInstruction", request.instruction]].flatMap(([label, value]) => [el("dt", {text:t(label)}), el("dd", {text:value})]));
      phoneDownloadUrl = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2)], {type:"application/json"}));
      $("#phone-download").href = phoneDownloadUrl;
      const ready=data.readiness;
      renderPhoneReadiness(ready);
      $("#phone-disclosure").replaceChildren(el("p",{text:`${ready.provider} / ${ready.engine}`}),el("p",{text:ready.disclosure+(request.conversationMode==="chat"? (LANG==="ja"?" 雑談のニュース・調べものでは、公開カテゴリまたは公開されている短い検索語をOpenAIへ送信します。氏名・電話番号・会話の文は送りません。検索は1通話8回までで、別途API料金が発生します。":" News and look-ups send a public category or a short query of public words to OpenAI, never names, numbers or the conversation, at most up to eight times per call, with additional API charges."):"")}),...(ready.issues||[]).map(issue=>el("p",{text:issue})));
      $("#phone-review").hidden = false; $("#phone-review").focus();syncPhoneDial();
      phoneExpiryTimer=setTimeout(syncPhoneDial,Math.max(0,Date.parse(data.expiresAt)-Date.now()));
      await refreshPhoneHistory();
    } catch (error) {
      if (revision !== phoneRevision) return;
      $("#phone-error").textContent = error.status === 400 ? t("phoneInvalid") : t("connLost", {msg:error.message});
      $("#phone-error").hidden = false;
    }
  });
  function renderWebPhone(record) {
    webPhoneRecord=record; $("#phone-live").hidden=false;
    $("#phone-live-state").textContent=phoneStateText(record.state);
    $("#phone-live-recipient").textContent=`${record.request.name} · ${record.request.phone}`;
    $("#phone-live-summary").textContent=record.summary || record.request.instruction;
    $("#phone-live-error").textContent=record.error || "";$("#phone-live-error").hidden=!record.error;
    $("#phone-hangup").hidden=!["starting","running","stopping"].includes(record.state);$("#phone-hangup").disabled=record.state === "stopping";
    $("#phone-resolve").hidden=record.state !== "unknown" || Boolean(record.resolvedAt);
    $("#phone-live-transcript").replaceChildren(...(record.transcript||[]).map(turn=>el("p",{text:`${turn.source === "callee" ? record.request.name : "AI"}: ${turn.text}`})));
    syncPhoneDial();
  }
  async function loadWebPhone(id,focus=false) {
    clearTimeout(phonePollTimer);
    try {
      const record=await api(`/api/phone/calls/${encodeURIComponent(id)}`);
      if(sessionStorage.getItem("oathra.webPhoneActive") !== id) return;
      renderWebPhone(record);
      if(focus) {$("#phone-live").focus();$("#phone-live").scrollIntoView({block:"start"});}
      if(["starting","running","stopping"].includes(record.state)) phonePollTimer=setTimeout(()=>loadWebPhone(id),1500);
      else await refreshPhoneHistory();
    } catch(error) {
      $("#phone-live").hidden=false;$("#phone-live-error").hidden=false;$("#phone-live-error").textContent=t("phoneNoStatus")+" "+error.message;
    }
  }
  $("#phone-dial").addEventListener("click",async()=>{
    syncPhoneDial();if($("#phone-dial").disabled || !phoneReviewData) return;
    const reviewed=phoneReviewData;phoneDialPending=true;syncPhoneDial();
    sessionStorage.setItem("oathra.webPhoneActive",reviewed.reviewId);
    $("#phone-dial-error").hidden=true;
    try {
      const {record}=await api("/api/phone/calls",{method:"POST",body:JSON.stringify({reviewId:reviewed.reviewId,approved:true})});
      sessionStorage.setItem("oathra.webPhoneActive",record.id);renderWebPhone(record);clearPhoneReview();await loadWebPhone(record.id,true);
    } catch(error) {
      const message=error.status ? error.message : t("phoneNoStatus");
      clearPhoneReview();
      // Status reads are safe; a lost POST response never triggers a second POST.
      await loadWebPhone(reviewed.reviewId,true);
      $("#phone-live-error").hidden=false;$("#phone-live-error").textContent=message;
    } finally {phoneDialPending=false;syncPhoneDial();}
  });
  $("#phone-refresh").addEventListener("click",()=>{const id=sessionStorage.getItem("oathra.webPhoneActive");if(id)loadWebPhone(id);});
  $("#phone-hangup").addEventListener("click",async()=>{
    if(!webPhoneRecord) return;const id=webPhoneRecord.id;$("#phone-hangup").disabled=true;
    try {const record=await api(`/api/phone/calls/${encodeURIComponent(id)}/hangup`,{method:"POST",body:"{}"});renderWebPhone(record);await loadWebPhone(id);}
    catch(error){$("#phone-live-error").hidden=false;$("#phone-live-error").textContent=t("phoneNoStatus")+" "+error.message;}
  });
  $("#phone-resolve").addEventListener("click",async()=>{
    if(!webPhoneRecord || !confirm(t("phoneResolveConfirm"))) return;
    try {const record=await api(`/api/phone/calls/${encodeURIComponent(webPhoneRecord.id)}/acknowledge`,{method:"POST",body:JSON.stringify({confirmedEnded:true})});renderWebPhone(record);await refreshPhoneHistory();}
    catch(error){$("#phone-live-error").hidden=false;$("#phone-live-error").textContent=error.message;}
  });
  refreshPhoneResources();
  const existingPhone=sessionStorage.getItem("oathra.webPhoneActive");if(existingPhone)loadWebPhone(existingPhone);

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
  function activeCallId() { return sessionStorage.getItem("oathra.activeCall"); }
  function setActiveCall(id) {
    if (id) sessionStorage.setItem("oathra.activeCall", id);
    else sessionStorage.removeItem("oathra.activeCall");
    $("#resume-call").hidden = !id;
    $("#home-resume").hidden = !id;
  }
  async function resumeCall(id, remember = true) {
    const full = await api(`/api/calls/${encodeURIComponent(id)}`);
    $("#recovery").hidden = true;
    clearTimeout(toastTimer); $("#toast").hidden = true;
    closeStream();
    const draft = app.call?.id === id ? $("#play-text").value : "";
    app.mode = full.mode;
    $$(".mode-btn").forEach(b => { const on = b.dataset.mode === full.mode; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
    $$(".scenario-btn").forEach(b => b.classList.toggle("is-current", b.dataset.scenario === full.scenario.id));
    app.call = newCallModel(full.scenario, full.mode, id);
    app.call.brain = full.brain;
    const url = new URL(location.href);
    url.searchParams.delete("replay"); url.searchParams.delete("autostart"); url.searchParams.set("call", id);
    history.replaceState(null, "", url);
    renderCallShell(); show("call", remember);
    $("#play-text").value = draft;
    rebuildFromEvents(full.events || []);
    if (full.status === "running") { setActiveCall(id); openStream(id); }
    else { if (activeCallId() === id) setActiveCall(null); await finish(full); }
    return full.status;
  }
  $("#resume-call").addEventListener("click", async () => {
    const id = activeCallId(); if (!id) return;
    try { await resumeCall(id); }
    catch { $("#recovery").hidden = false; }
  });
  setActiveCall(activeCallId());
  let starting = false;
  async function startCall(scenario) {
    if (starting) return;
    // Scenario cards always start local practice, even from the phone-request panel.
    app.transport = "simulator";
    $$(".tt-btn").forEach(button => {
      const selected = button.dataset.transport === "simulator";
      button.classList.toggle("is-on", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    starting = true;
    $$(".scenario-btn").forEach(b => b.disabled = true);
    // Keep the running call identity even when the user opens history or returns to the picker.
    const active = activeCallId();
    if (active) {
      try {
        const status = await resumeCall(active);
        if (status === "running") { toast(t("activeCall")); return; }
      } catch (error) {
        $("#recovery").hidden = false;
        if (error.status === 404) {
          setActiveCall(null);
          $("#recovery p").textContent = t("unknownRequest");
        }
        return; // Unknown outcome must never cause a new POST in this action.
      } finally { starting = false; $$(".scenario-btn").forEach(b => b.disabled = false); }
      starting = true; $$(".scenario-btn").forEach(b => b.disabled = true);
    }
    closeStream();
    const payload = { scenarioId: scenario.id, brain: app.brain, mode: app.mode };
    const fingerprint = JSON.stringify(payload);
    let pending = safeJSON(sessionStorage.getItem("oathra.pending"));
    if (pending) {
      starting = false; $$(".scenario-btn").forEach(b => b.disabled = false);
      $("#recovery").hidden = false;
      return;
    }
    if (!pending) pending = { fingerprint, key: crypto.randomUUID() };
    sessionStorage.setItem("oathra.pending", JSON.stringify(pending));
    let created;
    try {
      created = await api("/api/calls", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": pending.key }, body: fingerprint });
    } catch (e) { toast(t("startFailed", { msg: e.message })); $("#recovery").hidden = false; return; }
    finally { starting = false; $$(".scenario-btn").forEach(b => b.disabled = false); }
    setActiveCall(created.callId);
    sessionStorage.removeItem("oathra.pending");
    $("#recovery p").textContent = t("unconfirmed");
    $("#recovery").hidden = true;
    const url = new URL(location.href); url.searchParams.delete("replay"); url.searchParams.delete("autostart"); url.searchParams.set("call", created.callId); history.replaceState(null, "", url);
    app.call = newCallModel(created.scenario || scenario, created.mode || app.mode, created.callId);
    app.call.brain = created.brain || app.brain;
    renderCallShell();
    if (BOARD.matches) closeDrawer(false);
    show("call");
    $$(".scenario-btn").forEach((b) => b.classList.toggle("is-current", b.dataset.scenario === scenario.id));
    openStream(app.call.id);
  }

  function openStream(id) {
    closeStream();
    const es = new EventSource(`/api/calls/${encodeURIComponent(id)}/events`);
    app.es = es;
    es.addEventListener("call", (m) => {
      const ev = safeJSON(m.data);
      if (ev && app.call?.id === id) ingest(ev);
    });
    es.addEventListener("done", () => { if (app.call?.id !== id) return; closeStream(); finish(); });
    es.onerror = () => {
      if (app.call?.id !== id) return;
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
      if (!app.call || app.call.id !== id) return;
      $("#recovery").hidden = true;
      clearTimeout(toastTimer); $("#toast").hidden = true;
      rebuildFromEvents(c.events || []);
      if (c.status === "running") openStream(id);
      else finish(c);
    } catch (e) {
      setLive(false, t("offline"));
      $("#recovery").hidden = false;
    }
  }

  async function finish(fetched) {
    const c = app.call;
    if (!c) return;
    try {
      const full = fetched || (c.replay ? null : await api(`/api/calls/${encodeURIComponent(c.id)}`));
      if (full) {
        if (app.call !== c) return;
        c.persistence = full.persistence;
        c.status = full.status || "done";
        if (full.result) c.result = full.result;
        if (full.intake) c.intake = full.intake;
        if (full.score) c.score = full.score;
        if (full.metrics) c.metrics = full.metrics;
        if (full.endReason) c.endReason = full.endReason;
      }
    } catch {
      if (app.call !== c) return;
      $("#recovery").hidden = false;
      c.persistence = "unknown";
      setLive(false, t("offline"));
      renderResult();
      return;
    }
    $("#recovery").hidden = true;
    c.status = c.status === "running" ? "done" : c.status;
    if (activeCallId() === c.id) setActiveCall(null);
    setLive(false, c.status === "error" ? t("error") : t("ended"));
    setSpeaking(null);
    $("#play-form").hidden = true;
    $("#call-hangup").hidden = true;
    renderTranscript();
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
    if (typeof ev.seq === "number" && c.events.some(previous => previous.seq === ev.seq)) return;
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
      case "brain.request": c.thinking = true; break;
      case "agent.speech.started":
        c.speaking = "agent";
        c.thinking = false;
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
      case "intake.question":
        c.intake.status = ev.kind === "consent" ? "awaiting_consent" : "active";
        c.intake.pendingField = ev.field || null;
        if (ev.kind === "field") c.intake.askedQuestions += 1;
        break;
      case "intake.consent":
        c.intake.status = ev.granted ? "active" : "declined";
        c.intake.pendingField = null;
        break;
      case "intake.answer":
        c.intake.pendingField = null;
        if (ev.declined) {
          if (ev.field && !c.intake.declined.includes(ev.field)) c.intake.declined.push(ev.field);
          c.intake.status = "declined";
        } else if (ev.field) {
          c.intake.answers.push({ key: ev.field, value: ev.value, utteranceId: ev.utteranceId });
          if (c.intake.answers.length + c.intake.declined.length >= c.intake.fields.length || c.intake.askedQuestions >= c.intake.maxQuestions) c.intake.status = "complete";
        }
        break;
      case "brain.response":
        c.thinking = false;
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
        c.thinking = false;
        c.ended = true;
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
    $("#intake-list").replaceChildren();
    missionState.clear();
    $("#evidence-count").textContent = "0";
    $("#result-wrap").hidden = true; $("#result-wrap").replaceChildren();
    $("#timeline").replaceChildren(); $("#events-raw").textContent = ""; $("#snapshot").hidden = true;
    $(".timeline-wrap").classList.remove("has-snap");
    $("#latency-table tbody").replaceChildren();
    $("#m-latency").textContent = "—"; $("#m-cost").textContent = "$0.000"; $("#m-elapsed").textContent = "00:00";
    setLive(!c.replay, c.replay ? t("replay") : t("live"));
    setUx("idle");
    mountOrb();
    setSpeaking(null);
    $("#call-hangup").hidden = Boolean(c.replay) || c.status !== "running";
    for (const button of [$("#call-hangup"), $("#play-hangup")]) button.disabled = false;
    $("#call-hangup").textContent = t("endCall");
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
    $("#intake-panel").hidden = c.intake.status === "disabled";
    renderMission();
    renderIntake();
  }

  function renderAll() {
    renderTranscript();
    renderMission();
    renderIntake();
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
      case "state.changed": setUx(c.ux); syncOrb(); break;
      case "brain.request": syncOrb(); break;
      case "callee.speech.started": case "callee.speech.ended": case "agent.speech.ended": case "call.ended":
        setSpeaking(c.speaking); break;
      case "agent.speech.started": setSpeaking("agent"); renderTranscript(); break;
      case "transcript.final": case "permission.requested": case "permission.decided": case "error": renderTranscript(); break;
      case "evidence.created": case "evidence.verified": renderEvidence(); renderMission(); break;
      case "intake.question": case "intake.consent": case "intake.answer": renderIntake(); break;
      case "mission.progress": renderMission(); break;
      case "turn.trace": case "brain.response": renderMetrics(); syncOrb(); break;
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
    syncOrb();
  }

  // ------------------------------------------------------------------ agent orb
  // The agent's avatar is a liquid glass orb (orb/orb.js, WebGPU). Its state follows the call:
  // listening while the callee speaks (voice in), thinking while the brain works, speaking while
  // the agent talks (voice out). Without WebGPU the text glyph stays.
  let orb = null, orbMounting = false;
  function mountOrb() {
    const canvas = $("#agent-orb");
    if (!canvas || orb || orbMounting || !window.OathraOrb || !window.OathraOrb.supported) return;
    orbMounting = true;
    canvas.hidden = false;
    window.OathraOrb.mount(canvas, { state: "idle", onLost: () => { orb = null; canvas.hidden = true; $("#party-agent").classList.remove("has-orb"); } })
      .then((o) => { orb = o; $("#party-agent").classList.add("has-orb"); syncOrb(); })
      .catch((err) => { console.warn("orb unavailable:", err && err.message); canvas.hidden = true; })
      .finally(() => { orbMounting = false; });
  }
  function orbStateOf(c) {
    if (!c || c.ended) return "idle";
    if (c.speaking === "agent") return "speaking";
    if (c.speaking === "callee") return "listening";
    if (c.thinking || c.ux === "understanding" || c.ux === "acting") return "thinking";
    if (c.ux === "listening") return "listening";
    return "idle";
  }
  function syncOrb() { if (orb) orb.setState(orbStateOf(app.call)); }

  function renderTranscript() {
    const c = app.call;
    const box = $("#transcript");
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const existing = new Set($$(".line", box).map((n) => n.dataset.turn));
    const empty = $(".transcript-empty", box);
    if (!c.transcript.length) {
      const message = c.status === "running" ? t("dialing") : t("noTranscript");
      if (empty) empty.textContent = message;
      else box.replaceChildren(el("p", { class: "transcript-empty", text: message }));
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
    // A range reads as a range: 「19:00〜21:00」, not 「≤ 21:00 ≥ 19:00」.
    if (rule.gte !== undefined && rule.lte !== undefined && Object.keys(rule).length === 2) return `${fmtVal(rule.gte)}〜${fmtVal(rule.lte)}`;
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

  function renderIntake() {
    const c = app.call;
    const panel = $("#intake-panel");
    if (!panel || !c || !c.intake || c.intake.status === "disabled") {
      if (panel) panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const statusLabels = {
      not_started: LANG === "ja" ? "未開始" : "not started",
      awaiting_consent: LANG === "ja" ? "同意待ち" : "awaiting consent",
      active: LANG === "ja" ? "聞き取り中" : "active",
      declined: LANG === "ja" ? "停止" : "stopped",
      complete: LANG === "ja" ? "完了" : "complete",
    };
    $("#intake-status").textContent = t("intakeConsent", { status: statusLabels[c.intake.status] || c.intake.status });
    $("#intake-purpose").textContent = t("intakePurpose", { purpose: c.intake.purpose || "—" });
    $("#intake-questions").textContent = t("intakeQuestions", { asked: c.intake.askedQuestions || 0, max: c.intake.maxQuestions || "—" });
    const answerMap = new Map((c.intake.answers || []).map((a) => [a.key, a]));
    const declined = new Set(c.intake.declined || []);
    const skipped = new Set(c.intake.skipped || []);
    const rows = (c.intake.fields || []).map((field) => {
      const answer = answerMap.get(field.key);
      const answered = answer ? `✓ ${fmtVal(answer.value)}` : declined.has(field.key) ? `· ${t("intakeDeclined")}` : skipped.has(field.key) ? `· ${t("intakeSkipped")}` : c.intake.pendingField === field.key ? "…" : "—";
      return el("li", { class: `intake-row ${answer ? "answered" : declined.has(field.key) ? "declined" : skipped.has(field.key) ? "skipped" : c.intake.pendingField === field.key ? "pending" : ""}` }, [
        el("span", { class: "intake-key", text: field.label || field.key }),
        el("span", { class: "intake-value", text: answered }),
      ]);
    });
    const list = $("#intake-list");
    list.replaceChildren(...(rows.length ? rows : [el("li", { class: "intake-empty", text: t("intakeNoAnswers") })]));
    $("#intake-note").textContent = c.intake.status === "declined" || c.intake.status === "complete" ? t("intakeStopped") : "";
  }

  function evidenceNode(e, extraClass) {
    return el("li", { class: `erow ${e.verified ? "verified" : ""}${extraClass || ""}`, "data-eid": e.id, "data-verified": String(!!e.verified) }, [
      el("div", { class: "e-top" }, [
        el("span", { class: "e-field", text: fieldLabel(e.field) }),
        el("span", { class: "e-val", text: `= ${fmtVal(e.value)}` }),
        el("span", { class: `e-src ${e.source}`, text: t("saidBy", { who: srcLabel(e.source) }) }),
        el("span", { class: `e-ok ${e.verified ? "" : "pending"}`, text: `${e.verified ? "✓" : "○"} ${t(e.verified ? "verified" : "pending")}` }),
      ]),
      el("div", { class: "e-quote", title: e.transcript || "" }, [
        el("span", { class: "e-t", text: mmss(e.t) }),
        el("span", { class: "e-q", text: `“${e.span || e.transcript || ""}”` }),
      ]),
      // The tag above says who spoke. This line says whose words settled it — the point of the whole screen.
      el("div", { class: `e-why ${e.verified ? "" : "pending"}`, text: whySettled(e) }),
    ]);
  }
  function whySettled(e) {
    const note = String(e.note || "");
    if (e.verified) return t(e.source === "caller" ? "whyAgreed" : /^accepted|restates/.test(note) ? "whyAccepted" : "whyCallee");
    return t(e.source === "caller" ? "waitCallee" : "waitCaller");
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
    // The "why" line of a pending card depends on the others (the same value may have been settled through
    // another utterance), so refresh every line once the list is current.
    const settled = new Set(items.filter((e) => e.verified).map((e) => `${e.field}|${fmtVal(e.value)}`));
    for (const e of items) {
      const line = ul.querySelector(`[data-eid="${CSS.escape(String(e.id))}"] .e-why`);
      if (line) line.textContent = !e.verified && settled.has(`${e.field}|${fmtVal(e.value)}`) ? t("sameSettled") : whySettled(e);
    }
    $("#evidence-count").textContent = items.length ? t("evidenceCount", { v: items.filter((e) => e.verified).length, n: items.length }) : "0";
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
    // Count what the evidence panel shows. (result.evidence also holds the acknowledging utterances as separate nodes.)
    const verifiedN = foldEvidence(app.call && app.call.evidence && app.call.evidence.length ? app.call.evidence : r.evidence || []).filter((e) => e.verified).length;
    lines.push("", `${t(r.complete ? "mdVerified" : "mdNotVerified")} · ${t("evidenceN", { n: verifiedN })} · ${t("confidence", { v: typeof r.confidence === "number" ? r.confidence.toFixed(3) : "—" })}`);
    if (c.metrics && c.metrics.latency) lines.push(`${t("latencyP50", { v: `${c.metrics.latency.ttfaP50Ms ?? "—"} ms` })} · ${t("turns", { n: c.metrics.turns ?? c.transcript.length })}`);
    if (c.score && c.mode !== "play") {
      lines.push("", t("mdScore"), `- ${t("scOutcome")} ${c.score.outcome} · ${t("scEvidence")} ${c.score.evidence} · ${t("scConversation")} ${c.score.conversation} · ${t("scLatency")} ${c.score.latency} · ${t("scEfficiency")} ${c.score.efficiency}`, `- ${t("scOverall")} **${c.score.overall}**`, `- ${c.score.falseCompletion ? t("fc1", { f: (c.score.disagreements || []).join(", ") }) : t("fc0")}`);
    }
    if (c.intake && c.intake.status !== "disabled") {
      lines.push("", `**${t("intake")}**`, `- ${t("intakePurpose", { purpose: c.intake.purpose || "—" })}`, `- ${t("intakeQuestions", { asked: c.intake.askedQuestions || 0, max: c.intake.maxQuestions || "—" })}`);
      for (const a of c.intake.answers || []) lines.push(`- ${a.key}: ${fmtVal(a.value)} (${t("intakeAnswer")})`);
      for (const key of c.intake.declined || []) lines.push(`- ${key}: ${t("intakeDeclined")}`);
      for (const key of c.intake.skipped || []) lines.push(`- ${key}: ${t("intakeSkipped")}`);
      lines.push(`- ${t("intakeStopped")}`);
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
    // Count what the evidence panel shows. (result.evidence also holds the acknowledging utterances as separate nodes.)
    const verifiedN = foldEvidence(app.call && app.call.evidence && app.call.evidence.length ? app.call.evidence : r.evidence || []).filter((e) => e.verified).length;
    const fc = c.score && c.score.falseCompletion;
    const cls = fc || r.status === "failed" || r.status === "constraint_violation" ? "bad" : r.status === "completed" ? "" : "warn";
    const missing = new Set(r.missing || []);
    const violations = new Set(((r.constraints && r.constraints.violations) || []).map((v) => v.field));
    const card = el("div", { class: `result ${cls}`, role: "region", "aria-label": LANG === "ja" ? "結果" : "Result" }, [
      el("h3", { class: "result-h", text: fc ? t("stFalse") : c.endReason === "cancelled" ? t("callCancelled") : statusTitle(r.status) }),
      el("ul", { class: "result-lines" }, req.map((f) => {
        const has = r.fields && r.fields[f] !== undefined;
        const k = violations.has(f) ? "x" : has ? "v" : "m";
        return el("li", { class: k, text: `${fieldLabel(f)}${has ? `  ${fmtVal(r.fields[f])}` : missing.has(f) ? `  ${t("missing")}` : ""}` });
      })),
      el("div", { class: `result-badge ${r.complete && !fc ? "ok" : "no"}`, text: t(r.complete && !fc ? "badgeOk" : "badgeNo") }),
      c.score ? el("div", { class: `result-fc ${fc ? "fail" : ""}`, text: c.mode === "play" ? t("assessmentUnknown") : fc ? t("fc1", { f: (c.score.disagreements || []).join(", ") }) : t("fc0") }) : null,
      el("details", { class: "result-more", open: !BOARD.matches || document.body.classList.contains("present") }, [
      el("summary", { text: t("scoreMore") }),
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
      ]),
      el("p", { class: "save-state", role: "status", text: t(c.replay || c.persistence === "saved" ? "saved" : c.persistence === "failed" ? "saveFailed" : c.persistence === "disabled" ? "saveDisabled" : "saveUnknown") }),
      el("div", { class: "result-actions" }, [
        c.persistence === "failed" ? el("button", { type: "button", class: "btn", text: t("saveRetry"), onclick: async () => {
          try { await api(`/api/calls/${encodeURIComponent(c.id)}/save`, { method: "POST", body: "{}" }); } catch { /* status is read from the same call below */ }
          await resync(c.id);
        } }) : null,
        el("a", { class: "btn", text: t("download"), href: c.replay ? `/api/replays/${encodeURIComponent(c.id)}/artifact` : `/api/calls/${encodeURIComponent(c.id)}/artifact`, download: `${c.id}.json` }),
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

  // An editable starting point, using the same play input and runtime (no separate evaluator).
  $("#starter-text").value = t("sampleText");
  $("#starter-run").addEventListener("click", async () => {
    const scenario = app.scenarios.find(s => s.id === (LANG === "ja" ? "restaurant-reservation" : "restaurant-reservation-en")) || app.scenarios.find(s => s.id === "restaurant-reservation");
    if (!scenario || starting) return;
    const draft = $("#starter-text").value;
    app.mode = "play";
    $$(".mode-btn").forEach(b => { const on = b.dataset.mode === "play"; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
    await startCall(scenario);
    if (app.call?.scenario.id === scenario.id && app.call.mode === "play") { $("#play-text").value = draft; $("#play-text").focus(); }
  });

  // ------------------------------------------------------------------ play mode
  let composing = false;
  $("#play-text").addEventListener("compositionstart", () => { composing = true; });
  $("#play-text").addEventListener("compositionend", () => { composing = false; });
  $("#play-text").addEventListener("keydown", e => { if (e.key === "Enter" && (e.isComposing || composing || e.keyCode === 229)) e.preventDefault(); });
  $("#recover-call").addEventListener("click", async () => {
    const pending = safeJSON(sessionStorage.getItem("oathra.pending"));
    if (pending) {
      try {
        const found = await api(`/api/requests/${encodeURIComponent(pending.key)}`);
        sessionStorage.removeItem("oathra.pending");
        const url = new URL(location.href); url.searchParams.delete("replay"); url.searchParams.delete("autostart"); url.searchParams.set("call", found.callId); location.assign(url);
      } catch (error) {
        if (error.status === 404) {
          sessionStorage.removeItem("oathra.pending");
          $("#recovery p").textContent = t("unknownRequest");
        }
      }
    } else if (activeCallId()) $("#resume-call").click();
    else if (app.call) resync(app.call.id);
  });
  $("#play-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = app.call;
    const input = $("#play-text");
    const text = input.value.trim();
    if (!c || !text || composing) return;
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
  async function endCurrentCall() {
    const c = app.call;
    if (!c || c.replay || c.status !== "running" || c.ending) return;
    c.ending = true;
    const buttons = [$("#call-hangup"), $("#play-hangup")];
    buttons.forEach(button => button.disabled = true);
    $("#call-hangup").textContent = t("endingCall");
    try {
      await api(`/api/calls/${encodeURIComponent(c.id)}/hangup`, { method: "POST", body: "{}" });
      const full = await api(`/api/calls/${encodeURIComponent(c.id)}`);
      if (app.call !== c) return;
      if (full.status !== "running") await finish(full);
      // Acknowledgment alone is not completion; the event stream confirms termination.
    } catch (err) {
      if (app.call !== c) return;
      if (c.status !== "running") return;
      // A lost response can follow a successful stop. Recover by reading status, never by automatic resend.
      $("#recovery p").textContent = t("endUnknown");
      $("#recovery").hidden = false;
      toast(t("endUnknown"));
    }
  }
  $("#play-hangup").addEventListener("click", endCurrentCall);
  $("#call-hangup").addEventListener("click", endCurrentCall);
  $("#call-back").addEventListener("click", () => { closeStream(); show("start"); });

  // ------------------------------------------------------------------ drawer / time travel
  const drawerToggle = $("#drawer-toggle"), drawerBody = $("#drawer-body");
  drawerToggle.addEventListener("click", () => {
    const open = drawerBody.hidden;
    drawerBody.hidden = !open;
    drawerToggle.setAttribute("aria-expanded", String(open));
    if (open) renderDrawer();
  });
  // On the board the details open as a sheet over the call: it needs a way out, and a new call must not start underneath it.
  function closeDrawer(refocus) {
    if (drawerBody.hidden) return;
    drawerBody.hidden = true; drawerToggle.setAttribute("aria-expanded", "false");
    if (refocus) drawerToggle.focus();
  }
  $("#drawer-close").addEventListener("click", () => closeDrawer(true));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(true); });
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
      case "intake.question": return ev.kind === "consent" ? t("intakeConsent", { status: LANG === "ja" ? "同意待ち" : "awaiting consent" }) : `${t("intake")} · ${ev.field || "field"}`;
      case "intake.consent": return `${t("intakeConsent", { status: ev.granted ? (LANG === "ja" ? "同意" : "granted") : (LANG === "ja" ? "拒否" : "declined") })}`;
      case "intake.answer": return `${ev.field || "field"} · ${ev.declined ? t("intakeDeclined") : t("intakeAnswer")}`;
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
    const replayUrl = new URL(location.href); replayUrl.searchParams.delete("call"); replayUrl.searchParams.delete("autostart"); replayUrl.searchParams.set("replay", id); history.replaceState(null, "", replayUrl);
    const started = (rec.events || []).find((e) => e.type === "call.started");
    const sid = started && started.scenario;
    let scenario = app.scenarios.find((s) => s.id === sid);
    {
      const title = scenario ? scenarioTitle(scenario) : null;
      const ct = rec.contract || {};
      scenario = { id: sid || id, title: title || ct.goal || id, require: ct.require || {}, constraints: ct.constraints || {}, ...(ct.intake ? { intake: ct.intake } : {}), callee: { name: (ct.target && ct.target.name) || t("partyCallee"), avatar: null }, brief: "" };
    }
    app.call = newCallModel(scenario, "watch", rec.callId || id);
    app.call.replay = true;
    if (started && started.brain) app.call.brain = started.brain;
    renderCallShell();
    show("call");
    for (const ev of rec.events || []) ingest(ev, true);
    if (rec.result) app.call.result = rec.result;
    if (rec.intake) app.call.intake = rec.intake;
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
  else document.documentElement.classList.add("board");
  const wantMode = params.get("mode");
  if (wantMode === "play" || wantMode === "watch") {
    app.mode = wantMode;
    $$(".mode-btn").forEach((b) => { const on = b.dataset.mode === wantMode; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
  }
  window.addEventListener("beforeunload", closeStream);
  show(params.get("present") === "1" ? "start" : "home");
  loadStart().then(() => {
    if (params.get("home") === "1") return;
    if (params.get("contacts") === "1") { openContacts(); return; }
    if (params.get("phone") === "1") { $(".tt-btn[data-transport=real]").click(); return; }
    if (sessionStorage.getItem("oathra.pending")) { $("#recovery").hidden = false; return; }
    const callId = params.get("call") || (!params.get("replay") ? activeCallId() : null);
    if (callId) {
      resumeCall(callId).catch(() => openReplay(callId));
      return;
    }
    const replayId = params.get("replay");
    if (replayId) { openReplay(replayId); return; }
    const auto = params.get("autostart");
    if (!auto) { if (params.get("practice") === "1" || params.has("mode") || params.get("present") === "1") show("start"); return; }
    const scenario = app.scenarios.find((s) => s.id === auto);
    if (scenario) startCall(scenario);
    else toast(t("unknownScenario", { id: auto }));
  });
})();
