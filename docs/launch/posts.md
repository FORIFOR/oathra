# Launch posts (ready to paste)

All numbers below are from our own runs (see README). No superlatives, no claims we did not measure.

## Hacker News — Show HN

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
