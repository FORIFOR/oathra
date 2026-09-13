# Launch posts (ready to paste)

All numbers below are from our own runs (see README). No superlatives, no claims we did not measure.

## Hacker News — Show HN

> 注意（2026-09-13）: HN の規則は AI 生成・AI 編集の文章の投稿を禁止している。下の本文は下書きの参考にとどめ、投稿する場合は本人の言葉で書き直すこと。投票・コメントの依頼や代理投稿もしない。

> 2026-09-12: HN refused the submission from this new account: "We're temporarily restricting Show HNs because of a massive influx, mostly by users who aren't yet familiar with the site or its culture." Plain link submissions from a fresh account tend to get flagged, so HN is parked until the account has some comment history. The English article for dev.to is in `devto-oathra-launch.md` (publish via the dev.to API with DEVTO_API_KEY in .env, or paste it in the editor).

**Title**: Show HN: Oathra – give AI agents a phone, and proof of what happened

**Text**:

Oathra is an open-source (Apache-2.0) runtime for AI agents that make phone calls: call a restaurant, negotiate, book, and return a result you can trust.

The part we care most about is the "trust" part. The result is not an LLM summary. Every field (date, time, party size, price, "confirmed") is anchored to an utterance from the *other* party, and completion is decided by code — never by asking the model whether it succeeded. Refusals ("19:00 is full, but 19:30 works") never become offers; corrections supersede; hedges ("probably fine") do not confirm; a confirmation goes stale if the deal changes after it was spoken. We fuzz this with 10,000 mutated simulated callees (never-confirm, wrong restate, negate-then-offer, silent hangup, echo trap) and the count of false completions is 0.

`npx oathra demo` opens a small "arena" where two agents negotiate in your browser with no API key (there is a play mode where you answer the phone yourself). The same runtime drives real calls: Twilio direct media streams, or any SIP trunk (Plivo, custom) through a LiveKit gateway. The voice engine is separate: GPT-Live (full-duplex) was the most natural on our test calls, so it is the default; there is also an OpenAI Realtime engine and a Deepgram + LLM + TTS pipeline.

What is verified today: Twilio calls to a Japanese mobile, a 6-minute GPT-Live call, the evidence engine (0/10,000). What is not: Plivo/custom SIP over PSTN (implemented from provider docs), Telnyx/others, MCP.

Repo: https://github.com/FORIFOR/oathra · Site: https://forifor.github.io/oathra/

Happy to answer anything about the evidence rules, the phone layer, or the latency numbers.

## X / Twitter (EN)

1/ We gave AI agents a phone — and made them prove what happened.

Oathra: open-source runtime for agents that call, negotiate, book. The result is evidence, not a summary.

npx oathra demo → two agents haggle in your browser, no API key.

https://github.com/FORIFOR/oathra

2/ "予約できました" is not evidence.

Every field is anchored to the other party's words. Completion is decided by code. 10,000 mutated callees, 0 false completions.

3/ Bring your own carrier. Bring your own model.

Twilio direct · Plivo / custom SIP via LiveKit
GPT-Live (recommended) · OpenAI Realtime · Deepgram+LLM+TTS

`oathra setup phone` — 2–3 questions, guided steps for anything a human must do. `oathra phone doctor` tells you which layer is broken.

4/ Battle your models on "Impossible Hotel". Both GPT-4o-mini and Gemini Flash walked away above budget — and neither claimed success. That's the point.

[attach docs/media/battle-impossible-hotel.png]

## X / Twitter (JA)

AIエージェントに電話を持たせて、しかも「本当に予約できたか」を証明させる OSS を公開しました。

Oathra — 結果は LLM の要約ではなく、相手の発言に紐づいた証拠付きの構造化データです。完了判定はコードが行い、10,000 通りの意地悪な店員シミュレーションで False Completion は 0。

npx oathra demo で API キー無しに AI 同士の交渉を見られます。
Twilio / Plivo / 自前 SIP × GPT-Live / Realtime / パイプライン、好きに組み合わせられます。

https://github.com/FORIFOR/oathra

## Reddit — r/LocalLLaMA, r/artificial, r/programming

**Title**: Oathra: open-source runtime for AI agents that make phone calls — with verified results (0/10,000 false completions in adversarial sim)

Body: (use the HN text; add) Ollama brains are supported in the pipeline engine; the simulator and the evidence engine run fully offline.

## Product Hunt / dev.to (later)

Headline: Give AI agents a phone — and proof of what happened.
Tagline: Playable simulator · real calls · verified outcomes · bring your own carrier & model.

## Battle 動画（投稿済み 2026-09-12）

- X（日本語、動画付き）: https://x.com/i/status/2098496503493136600
- 素材: `docs/media/oathra-battle-ja.mp4`（英語版 `oathra-battle-en.mp4`、GIF・ポスター・1:1 も同名で同梱）
- 再生成: `node scripts/render-scene.mjs --template video/battle.html --data video/.work/battle.json --lang ja --name oathra-battle-ja`

### v2（2026-09-12 05:50 JST、音声付きの画面録画に差し替え）

- X（日本語、動画付き）: https://x.com/i/status/2098513364314095620 （旧 2098496503493136600 は削除）
- 再生成: `node packages/cli/dist/bin.js demo --no-open --port 4242 &` → `node scripts/battle-to-calls.mjs`（再現通話の保存、¥0）→ `node scripts/render-battle2.mjs --name oathra-battle-ja`
- 声は `video/.work/tts/*-ft.wav`（OpenAI gpt-4o-mini-tts、数円）。効果音は `sox` で合成（`video/.work/sfx`）
- X（英語字幕版、動画付き）: https://x.com/i/status/2098517001547436180 — `node scripts/render-battle2.mjs --lang en`

## npm（2026-09-12 16:05 JST）

- `oathra@0.1.0` を公開: https://www.npmjs.com/package/oathra — `npx oathra demo` が動くようになった。レジストリからの `npx -y oathra@0.1.0 play restaurant-reservation-en --fast` で completed を確認
- X（npm 公開の告知）: 日本語 https://x.com/i/status/2098671529647366272 ／ 英語 https://x.com/i/status/2098671635201220831

## BGM（2026-09-12 22:40 JST）

- ユーザー提供の AI 生成 BGM 群（~/Downloads/bgm）からまず「I11 Quiet Momentum」で作成し、`scripts/add-bgm.sh ja|en` でナレーション付きミックスの下に敷いた（サイドチェインで会話中は −12〜18 dB 下げ、切電後のカードで持ち上げ）。曲は `video/bgm/quiet-momentum.m4a` に保存。ユーザーが試聴して「I02 Soft Circuit」を選択（22:55 JST 差し替え、`video/bgm/soft-circuit.m4a`）。フレームの再レンダリングは不要で、mp4 の映像ストリームをそのまま流用している。

## Zenn（2026-09-12 23:45 JST）

- 記事が公開: https://zenn.dev/forifori/articles/oathra-launch
- 反映しなかった原因は Zenn 側ではなく、公開履歴に残っていた `video/.work` の作業ファイル（813 MB）で clone が肥大化していたこと。`git filter-repo` で履歴から除去して force-push（071dd5b → 7a88aa0）した直後の push でデプロイが通った。書き換え前の完全バックアップは作業ディレクトリ外の bundle に保存。
- X（Zenn 公開の告知、23:46 JST）: https://x.com/i/status/2098785294816583984

## 2026-09-13 00:30 JST — 露出の追加手

- GitHub Release v0.1.0（stable、npm 0.1.0 と同一 tarball）: https://github.com/FORIFOR/oathra/releases/tag/v0.1.0
- good first issue #2 薬局シナリオ / #3 Telnyx / #4 ElevenLabs TTS
- GitHub topics を 16 個に拡張、npm keywords を 15 個に拡張（次回 publish で反映）
- awesome リスト PR 追加: caramaschiHG/awesome-ai-agents-2026#570（Open-Source Voice）、Jenqyang/Awesome-AI-Agents#486（Tools）。既存: yzfly/awesome-voice-agents#42（未反応）、e2b-dev/awesome-ai-sdks#364（CLA 署名待ち＝ユーザー操作）
- X（v0.1.0 英語告知）: https://x.com/i/status/2098794398595297406
- 未実施（アカウントが必要）: dev.to 投稿、Show HN（新規アカウント制限）、Reddit
- 2026-09-13 01:xx JST: e2b-dev/awesome-ai-sdks#364 の CLA をユーザーが署名、チェック pass、mergeState CLEAN（メンテナのレビュー待ち）

## dev.to（2026-09-13 00:39 JST）

- 英語記事を API で投稿（下書き → 内容確認 → 公開）: https://dev.to/forifor/i-let-an-ai-make-phone-calls-then-took-the-word-booked-away-from-it-5484
- README.en とサイト英語版フッターにリンク追加

## Reddit（2026-09-13 01:2x JST）

- r/LLMDevs に投稿（フレア Tools、アカウント Important-Rip-1205 はこの日に作成）: https://www.reddit.com/r/LLMDevs/comments/1wektiw/i_built_an_opensource_runtime_for_ai_agents_that/
- 投稿直後に「Reddit のフィルターによって削除されました」表示。新規アカウントの自動フィルター。モデレーターへの承認依頼（modmail）が必要。
- 01:5x JST: r/LLMDevs のモデレーターに承認依頼を送信（ユーザーの「送って」で実行、「メッセージが送信されました」を確認）。返答待ち。

## 縦型動画（2026-09-13 02:2x JST、TikTok / Reels / Shorts 用）

- `docs/media/oathra-battle-{ja,en}-vertical.mp4`（1080x1920、59 秒）。横動画を 9:16 に配置し、見出し（JA: 「AIがホテルに電話して、値切る。／「予約できた」は店が言った時だけ。」）とコマンド、URL を重ねた。見出しは HTML を headless Chrome で透過 PNG に描画（ffmpeg に drawtext が無いため）。冒頭のタイピング 3.2 秒をカット。
- 投稿は未実施。TikTok / Facebook は API 投稿に審査が要るため Chrome 拡張経由で行う（ユーザーのログインと「投稿して」が必要）。

## v0.1.1 の準備（2026-09-13 05:40 JST、publish はユーザー操作）

修正内容（試用で見つかった 3 件）:
- エージェントが曖昧な返答（たぶん・確認します）に確認を求めず諦めていた（#5）
- Play モードで AI の挨拶後も通話が終わらなかった（#6）
- 証拠パネルに同じ未確定値が重複表示されていた（#7）

publish 手順（2FA コードは npm が求めたときに入力）:
```
cd packages/cli && npm publish --access public
```
publish 後にこちらで行うこと: README/サイトの「npm: oathra 0.1.0」を 0.1.1 に更新、GitHub Release v0.1.1 の作成、`npx -y oathra@0.1.1 demo` の起動確認。

## Zenn 2 本目の下書き（2026-09-13 05:50 JST、未公開）

`articles/oathra-evidence-rules.md`（`published: false`）。判定ルール 4 本（節分割・曖昧語・確定経路 2 つ・確定の失効）を実コードの引用で説明し、検証 5 ケースの表と Play モードのボタンを案内。公開するには `published: true` にして push するだけ。公開の可否は本人の判断。

## dev.to 2 本目の下書き（2026-09-13 05:53 JST、未投稿・ローカルのみ）

`docs/launch/devto-evidence-rules.md`。Zenn 2 本目の英語版。dev.to には送っていない（下書き作成も含めて未操作）。投稿は本人の指示があってから API で行う。

## X「試して騙してみて」投稿（2026-09-13 05:59 JST）

- JA: https://x.com/forio1998/status/2098879131987615895
- EN: https://x.com/forio1998/status/2098879133606727871

内容: Play モードで店員役として「たぶん大丈夫です」「承りました。ただ料金は…」を言っても確定に✓が付かないか試してもらう招待。既に使っている自分の X アカウントからの投稿で、告知の一斉送信ではなく「誤完了を誘ってみる」入口の案内として 1 本ずつ。インプレッションは API で取得できないため「未取得」。

## サイト改版 v6（2026-09-13 13:31 JST）

ファーストビューを「発言→証拠」のサンプル（店員役の返事 3 つ、証拠エンジンの実出力）に変更。見出し「AIが電話する。結果は、相手の言葉で確かめる。」、主 CTA「予約シミュレーションを試す」。実通話の再生機は 2 番目の節へ。導入相談（Discussions）を GitHub と分離。設計文書は docs/design/{PRODUCT,DESIGN,CONTENT,ACCEPTANCE}.md、比較は HERO_VARIANTS_V2.md。

## 記事 2 本目を公開（2026-09-14 00:39 JST、ユーザーの「トライアル依頼と実電話検証以外を対応して」による）

- Zenn: https://zenn.dev/forifori/articles/oathra-evidence-rules （判定ルール 4 本と失効ルール）
- dev.to: https://dev.to/forifor/four-regexes-and-a-staleness-rule-how-my-phone-agent-refuses-to-call-probably-fine-a-booking-3ech （canonical は Zenn）
- npm 0.1.1: `npm publish` は E401（ログインセッション切れ）で失敗。ユーザーの `npm login` と 2FA が必要。

## TikTok / Facebook（2026-09-14 00:45 JST）

- TikTok: Oathra の縦動画は既に 9/13 20:10 に公開されていた（別セッション、キャプション「AIに電話をかけさせたら、取れてない予約を「取れた」と言い切った…」）。私が 9/14 00:40 に投稿した同じ動画は重複になるため削除した（30 日以内なら復元可）。公開中の 1 本を残す。
- Facebook: ページ foriforapps でリール投稿を 2 回試行（動画アップロード → 次へ → 説明入力 → 投稿）。投稿後にページのタイムラインとリール一覧に表示されず、処理中か失敗かは未確認。
