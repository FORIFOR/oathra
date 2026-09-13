# ACCEPTANCE — Oathra サイトの合格条件

作成 2026-09-13。公開前に全項目を確認し、結果を `docs/launch/posts.md` に記録する。未確認の項目は「未確認」と書く。

## 理解

- [ ] 初見の人が 10 秒で「誰向けで、何ができるか」を言える（見出し + サンプルだけで）
- [ ] 「AI が電話する」と「結果を相手の言葉で確かめる」の両方が最初の画面にある

## 実物

- [ ] 最初の画面に、実際の通話記録またはエンジンで検証済みのサンプルがある
- [ ] 録画・再生・サンプルに「録画」「再生」「サンプル · 実電話なし」の表示がある

## 操作

- [ ] サンプルの 3 つの返事を押すと証拠欄が変わる。3 つ目だけ確定に ✓
- [ ] 再生機の再生・停止・シーク・速度が動く
- [ ] コマンドのコピーが動き、「コピーしました」に変わる
- [ ] GitHub、Discussions、English、Zenn、dev.to のリンクが 200 を返す
- [ ] キーボードだけで主要操作に到達できる（focus-visible あり）

## モバイル（390px）

- [ ] 横スクロールが出ない
- [ ] 見出しの行末に「た。」「い。」が単独で残らない
- [ ] 本文 16px 以上、ボタン高さ 44px 以上
- [ ] サンプルと再生機が 1 カラムで読める

## 信頼

- [ ] 「0 / 10,000」の隣に「シミュレーション」の条件がある
- [ ] Plivo / SIP に「PSTN 未検証」がある
- [ ] 導入相談の実体（Discussions）が正しく書かれ、「非公開」と書いていない
- [ ] 未提供の有料プランや実績が無い

## OSS 導線

- [ ] ライセンス、`npx oathra demo`、README の「正直な現状」、Release へ辿れる

## 性能・アクセシビリティ

- [ ] LCP 2.5 秒以下、CLS 0.1 以下、INP 200 ms 以下（Lighthouse の単発値は「参考値」として記録。実利用データは未取得と書く）
- [ ] `prefers-reduced-motion` で自動再生しない
- [ ] 画像に alt、動画に字幕またはテキストの代替

## 確認方法

`node scripts/qa-arena.mjs` と同じ headless Chrome で 1440 / 390 のスクリーンショットを撮り、`docs/design/` に残す。

## Portfolio acceptance — 2026-09-13

Native in-app-browser checks of all six sites: 1440×1000 English and 390×1000 Japanese; one main H1 and one inquiry form per page, no document horizontal overflow, no autoplay attributes, no broken completed image loads. This checks local authored pages, not field Core Web Vitals.

Distinct interactions verified: Launchloom keyboard arrow tabs, Japanese kit LP/posts, actual playback and pause on tab switch; Genie keyboard workflow selection, selected-video-only load and pause on change; AI Meeting real recorded audio playback and all three scenario panels; Oathra ambiguous reply stays incomplete, alternative time stays proposed, explicit confirmed reply satisfies all four evidence fields; AISecure selected observation exposes the actual synthetic evidence; Agent Team F-1/F-2/F-3 each highlight their matching revision block.

Private form validation rejects empty required input. Browser failure preserves entered text and restores the submit control. Five production synthetic inquiries (one per newly connected product) verified allowed-origin preflight, 201 only after Firestore persistence, matching useCase, idempotent retry and denied public GET; synthetic inquiry rows were removed. Existing AI Meeting intake tests remain covered. Targeted backend tests: 8 passing; broker typecheck passing. Source and sanitized evidence are in FORIFOR/AI-meeting scripts/verification/portfolio-intake-real.mts and docs/validation-assets/portfolio-intake.json.

Counts are aggregate event/product/language only. No form fields, audio, arbitrary URLs or visitor identifiers enter these counters. lead_submit means durable intake, not a click. DNT/GPC respected. No messages were sent to personal social accounts.

Field LCP/INP/CLS at the 75th percentile, star gains, qualified leads, human first-impression studies and a full assistive-technology audit are not measured by this round. No conversion or full accessibility certification is claimed. Full 200% browser text zoom was not measured; responsive layouts were checked at the widths above. Existing narrower historical checks remain labeled as their earlier revision.
