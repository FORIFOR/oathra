# 試用依頼（音声・電話 AI を作っている開発者 20 人）

目的: スターや拡散ではなく、「一つのケースの試用と感想」を依頼する。同文の一斉送信はしない。連絡は公開チャンネル優先、DM は相手が受け付けている場合のみ。**送信はユーザーの承認後に行う。** 選定基準は「電話・音声エージェントを実装している／完了条件のある業務（予約・受付・確認）を扱っている／制作物や課題を公開している」。フォロワー数では選ばない。

記録形式: 相手／活動場所／関連する公開投稿／Oathra が役立ちそうな理由／連絡状況／返信／試用したか／止まった場所／次の対応

| # | 相手 | 活動場所 | 関連する公開投稿 | Oathra が役立ちそうな理由 | 連絡手段 | 状況 |
|--|--|--|--|--|--|--|
| 1 | shineos（株式会社シャイオス） | Zenn / X @shineos_corp / GitHub shineos | 「電話でつながる音声AIエージェントを作ってみた｜Function Calling・ガードレール設計」(2026-08-07)、WebSocket 信頼性設計 (08-10) | 電話 AI を実装済みで、ガードレールに関心。完了判定を発言根拠にする設計はガードレールの延長 | X 公開リプ / Zenn コメント | 未連絡 |
| 2 | yuche | Zenn / X @pomufgd | 「Twilio + Patter + OpenAI Realtime で日本語の営業電話AIエージェントを動かすまで」(2026-05-03) | Twilio + Realtime の実装者。営業電話は「約束が取れたか」の判定が要る | X 公開リプ | 未連絡 |
| 3 | milix_m | Zenn / X @_milix_m / GitHub milix-m | 「Gemini Live API を用いて AI 架電アプリを作ってみた」(2026-04-22) | 架電アプリを自作。Gemini 系の brain を Oathra は同梱 | X 公開リプ | 未連絡 |
| 4 | tuchiyam_genax | Zenn | 「AI音声コールセンターで正確な住所を聞き取るための設計」(2026-08-13) | 聞き取り正確性＝証拠の正確性。数値・住所の決定論的抽出に関心が重なる | Zenn コメント | 未連絡 |
| 5 | kazuki_matsuda | Zenn | 「通話は聴覚UIだった ― 音声AIサーバの並行処理」(2026-07-13) | 通話サーバ設計者。判定層を分離する設計への意見が欲しい | Zenn コメント | 未連絡 |
| 6 | hakuhodo（haku） | Zenn / GitHub mst923 | 「LiveKit の preemptive generation が効かない本当の理由」(2026-07-11) | LiveKit 内部に詳しい。Oathra の LiveKit ゲートウェイ設計のレビュー相手 | Zenn コメント / GitHub | 未連絡 |
| 7 | hszk_dev | Zenn / GitHub hszk-dev | 「LiveKit × Bedrock × LangGraph の営業ロープレ AI」(2025-12-10) | LiveKit エージェント実装者。ロープレの「成立判定」に応用可能 | Zenn コメント / GitHub | 未連絡 |
| 8 | morix1500 | Zenn / X @morix1500 / GitHub | 「STT と TTS の性能比較ツール Hikaku-Voice」(2025-12-17、♥16) | 音声評価ツールの作者。「誤完了」評価の考え方に意見をもらえる | X 公開リプ | 未連絡 |
| 9 | mskbhd | Zenn | 「ChatGPT Realtime API で音声エージェントを最小構成で作る」(2026-07-19)、xAI Voice Agent | Realtime 最小構成の実装者。判定層の追加が最小構成に載るか | Zenn コメント | 未連絡 |
| 10 | sipbridge | Zenn | 「Retell AI・Vapi・ElevenLabs をどう使い分けるか」(2026-07-14) | 音声 AI スタックの比較者。OSS ランタイムとしての位置づけを聞きたい | Zenn コメント | 未連絡 |
| 11 | i_ichi（いち） | Zenn / X @axis_arcs / GitHub leven-e | 「内部 eval 98% なのに実機で死んだ — LiveKit wakeword」(2026-06-01) | 「eval と実機の乖離」を経験。シミュレータ評価の限界を率直に指摘してくれる | X 公開リプ | 未連絡 |
| 12 | haboshi | Zenn / X @haboshi / GitHub haboshi | 「音声AIは『チャットの音声版』ではなくなった」(2026-05-08) | 音声 AI の設計論を書いている。判定を分離する主張への反応 | X 公開リプ | 未連絡 |
| 13 | halapolo（Twilio Japan） | Qiita / GitHub MitsuharuNakamura | 「Twilio Agent Connect (TAC) で AI 電話アプリがここまでシンプルに」(2026-05-19) | Twilio 側の視点。Twilio 直結の実装を見てもらえる可能性 | Qiita コメント / GitHub | 未連絡 |
| 14 | unclesam-ly | Qiita / GitHub | 「LiveKit Agents 実戦導入ガイド」(2026-06-23) | LiveKit を既存電話網に組み込む話。SIP ゲートウェイ設計のレビュー相手 | Qiita コメント | 未連絡 |
| 15 | Yuya_baseball | Qiita / X @kon333_engineer | 「SaaS に音声通話を組み込むための技術選定」(2026-04-06) | SaaS への組み込み視点。結果検証だけの需要があるか聞ける | X 公開リプ | 未連絡 |
| 16 | kenimo49（Propel-Lab） | Qiita / X @kenimo49 / GitHub | 「音声AIの遅延は TTS ではなく LLM が7割 — 実測」(2026-07-13) | 実測重視。Oathra の遅延数値の妥当性を見てもらえる | X 公開リプ | 未連絡 |
| 17 | okssusucha | Qiita / GitHub | 「聞きながら話す GPT-Live、重い思考を GPT-5.5 に回す2層構成」(2026-07-12) | GPT-Live 利用者。Oathra の既定エンジンと同じ | Qiita コメント / GitHub | 未連絡 |
| 18 | sooncloud | Qiita | 「Vapi で日本語対応どこまで行けるか」(2026-07-08) | Vapi の日本語検証者。日本語の確認表現の判定に意見をもらえる | Qiita コメント | 未連絡 |
| 19 | YuinaKanno | Qiita / GitHub yuinakanno | 「LiveKit 実装の実録と改善ログ」(2026-02-05) | LiveKit 実装の改善ログを書く人。試用の脱落箇所を細かく書いてくれそう | Qiita コメント / GitHub | 未連絡 |
| 20 | spookies（スプーキーズ） | Zenn / X @spookiesjp | 「twilio と AWS Lambda で自分に電話をかけてみた」(2026-06-26) | 受託開発会社。予約受付の案件での検証相手になりうる | X 公開リプ | 未連絡 |

優先 10 人（関連性の高さ順）: 1 shineos、2 yuche、3 milix_m、13 halapolo、14 unclesam-ly、11 i_ichi、4 tuchiyam_genax、7 hszk_dev、16 kenimo49、17 okssusucha。

## 依頼文（個別に冒頭を書き換える。日本語）

> ○○さんの「（記事タイトル）」を拝見しました。（相手の記事の具体的な一点に触れる 1 文）
>
> 私は、AI電話の「予約できました」をそのまま信用せず、相手の発言を根拠に完了を判定する OSS「Oathra」を作っています。
>
> 見ていただきたいのは、店員役が「たぶん大丈夫ですが、まだ確定ではありません」と言ったときに確定扱いにならない部分です。API キーなしのデモがあり、`npx oathra demo` で自分が店員役として電話に出られます。
>
> スターのお願いではありません。実装している立場から「この判定が役立つ場面があるか」「どこで試すのをやめたか」を教えていただけないでしょうか。
>
> https://github.com/FORIFOR/oathra

## 依頼文（英語）

> I read your post on (title). (one specific sentence about their work)
>
> I'm building Oathra, an open-source runtime that does not take an AI's "you're booked" at face value: completion is decided from what the callee actually said.
>
> The part I'd like you to look at is that a clerk saying "probably fine, but not confirmed yet" never counts as confirmed. There's a no-API-key demo where you answer the phone yourself: `npx oathra demo`.
>
> Not asking for a star. As someone who has built this, could you tell me whether this kind of check would matter in your calls, and where you stopped if you tried it?

## コミュニティ投稿の下書き（各サーバーの最新ルールを参加時に確認してから）

**LiveKit Slack #show-and-tell（英語）**
> Sharing an open-source runtime built on top of the LiveKit SIP gateway: Oathra. The idea is that a phone agent's "booked" should only be true if the callee said it. Every result field is anchored to the callee's utterance and completion is decided by deterministic rules; a hedge ("probably fine") or a refusal that quotes a number never becomes a confirmation. Twilio direct is verified on real calls; Plivo/custom SIP go through LiveKit and are implemented from docs (PSTN not yet verified). I'd appreciate a look at the gateway design from people who run LiveKit in production. No API key needed to try the simulator: `npx oathra demo`. https://github.com/FORIFOR/oathra

**Twilio Discord（制作物紹介が許可された場所）**
> Built with Twilio media streams: an open-source runtime for phone agents where "booked" only counts if the callee said it. Three failures from my real test calls pushed me here: the agent said "you're booked" when the restaurant had said no, it pleaded with a voicemail for two minutes, and it accepted a price above budget. Write-up + repo: https://dev.to/forifor/i-let-an-ai-make-phone-calls-then-took-the-word-booked-away-from-it-5484

**Pipecat Discord（プロジェクト共有が許可された場所）** — 「連携済み」とは書かない
> Looking for design feedback rather than users: Oathra separates the voice pipeline from the result judgement (a deterministic evidence engine over the callee's utterances). I haven't built a Pipecat integration; I'd like to hear whether a pipeline-agnostic judgement layer makes sense to people building on Pipecat, and what interface you'd expect. https://github.com/FORIFOR/oathra
