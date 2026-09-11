# Oathra — Product Goal

Oathraのゴールは、**AIエージェントに「電話で現実世界へ働きかける能力」を与え、それを誰でも遊びながら体験・開発・検証できる、世界最高品質のオープンソース基盤を作ること**である。

単なるAI電話受付、音声チャット、Twilioラッパー、MCPサーバーを作ることが目的ではない。

目指すのは、

**「AIが電話をかけ、相手と自然に会話・交渉し、目的を達成し、その結果が本当に達成されたことまで証明できるRuntime」**

である。

例えばユーザーが、

「明日19時以降で2人予約できるレストランに電話して予約して」

と指示すると、Oathraは実際に電話を行い、相手と会話し、条件を確認し、必要なら交渉し、予約を完了する。

最終結果は単なるLLMの要約ではなく、

* 日時
* 人数
* 金額
* 予約状態
* 相手の発言
* 音声上のEvidence
* Verification結果

を持つ、**検証可能な構造化データ**として返す。

AIが「予約できました」と幻覚するのではなく、

**Proof-Carrying Action**

を実現することをOathra最大の特徴とする。

---

## 最高品質のVoice UX

電話では精度と応答速度を最優先する。

目標は、人間同士の電話と同等に自然なテンポで、

* TTFA p50 650ms以下
* 自然な割り込み
* 相槌と訂正の区別
* 高精度日本語音声認識
* 自然な音声生成
* ノイズ環境への耐性
* 日時・金額・電話番号等の誤認識防止

を実現することである。

すべてをLLMへ任せない。

状態遷移、制約判定、日時・金額の解析、Permission、Verificationなど決定論的に解けるものはコード・状態機械・型・ルールで処理し、LLMは意味理解・会話生成・交渉など、本当に必要な部分だけに利用する。

---

## Playable OSS

Oathraは業務ツールであると同時に、**触った瞬間に面白いOSS**でなければならない。

GitHubを見た開発者が、

```bash
npx oathra demo
```

を実行するだけで、APIキーなし・電話番号なしで30〜60秒以内にAI同士の電話会話を体験できるようにする。

Arenaでは、

* レストラン予約
* ホテル値下げ交渉
* 営業
* 謎解き
* AI vs AI
* Human vs AI

などのChallengeを遊べる。

GPT、Claude、Gemini、Qwenなど複数Agentを同じ条件で戦わせ、

**Task Success / Accuracy / Latency / Cost / False Completion**

を比較できるAgent Battleを提供する。

ゲームと実電話は別システムにせず、同じCoreを利用し、Simulator TransportをSIP/PSTN Transportへ交換するだけで現実世界へ移行できる設計とする。

---

## Developer Experience

GitHubスター獲得のために最重要なのは機能数ではなく体験品質である。

目標は、

* READMEを見て10秒以内に価値が伝わる
* 1クリックでブラウザDemo
* 1コマンドでLocal Demo
* 5分以内に独自Agentを接続
* 30分以内に実電話
* MCPから1 Tool Callで電話
* Providerを簡単に交換可能

という開発者体験を実現すること。

Coreは巨大な万能Agentにせず、

* Transport
* Turn Detection
* STT
* Brain
* State Machine
* Evidence
* Verification
* TTS
* MCP
* Replay
* Eval

を小さな責務として疎結合に構成する。

LiveKit、Deepgram、ElevenLabs、Twilio、Telnyx、Google、OpenAI、Gemini、Ollamaなどを交換可能にする。

---

## OSSとしての到達点

Oathraを単なるサンプルRepositoryではなく、

**「Voice Agent / Phone Agentを作るならまずOathraを見る」**

という位置まで持っていく。

そのために、

* Apache-2.0
* 高品質README
* 15秒Demo動画
* Simulator
* Scenario DSL
* Replay
* Time Travel Debugger
* Benchmark
* Leaderboard
* Community Challenges
* MCP
* Python / TypeScript SDK
* Self-host

を提供する。

GitHubスターは1,000を最初の通過点とし、5,000〜10,000+を狙えるOSS品質を目標とする。

---

## ビジネスへの接続

OSS版を意図的に不便にしない。

OSSは本当に使える完成品として無料公開する。

収益化はOathra Cloudで行い、

* 電話番号
* Managed SIP
* Carrier Routing
* Hosted AI
* 録音保存
* 並列Call
* Team
* RBAC
* Monitoring
* Audit
* SLA

など、運用を楽にする部分を提供する。

将来的には、

* 予約代行
* 在庫確認
* 見積取得
* 調達
* 不動産確認
* カスタマーサポート
* 営業支援

へ展開する。

課金も単純な「1分いくら」だけではなく、

**Verified Action / Outcome Based Pricing**

を目指す。

---

最終的にOathraが実現するものは、

**BUILD — AIに電話能力を与える
PLAY — AI同士・人間とAIで遊ぶ
PROVE — AIが本当に成功したことを証明する
CALL — 現実世界へ働きかける**

という4つである。

Oathraは「AI Phone App」ではない。

**AIがデジタル世界から現実世界へ出ていくための、PlayableかつVerifiableなVoice Action Infrastructureを作る。**

これをプロジェクトの最上位ゴールとする。
