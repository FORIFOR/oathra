# Oathra Gateway — LINE / Web / iOS から電話を任せる

実行可能な単一サーバー構成です。設計メモだけではありません。既存の電話・音声ランタイムは再利用し、商品情報、連絡先、発信承認、保存、チャネル通知をこのGatewayで管理します。既存CLIの動作は変更しません。

**実装があることと、実回線・本番運用の検証が済んだことは別です。** デフォルトは台本シミュレーターです。以下の起動手順では実際の電話も外部AI呼び出しも発生しません。

## まず操作を試す

リポジトリのルートでNode.js 22.16以降を使用します。

```sh
pnpm install --frozen-lockfile && pnpm build   # 商談成立の判定は packages/evidence の証拠エンジンが行うため、先にビルドします
node apps/gateway/setup.mjs
node --env-file=.env.gateway apps/gateway/server.mjs
```

ブラウザで `http://localhost:4244` を開き、`.oathra/operator-token.txt` の内容を貼り付けて「はじめる」を押します。画面は1枚で、上から順に進めます。最初に「はじめに」に出る準備（会話データの取り扱いへの同意など）を済ませ、「だれに、なにを電話しますか？」で相手・商品・目的を選んで「内容を確認する」。確認画面で承認した場合だけ模擬実行し、結果は同じページのすぐ下に、ふつうの言葉と根拠になった相手の発言で表示されます。商品・相手の登録やチャット連携は、ページ下部の「設定」を開いて行います。

`.env.gateway` と `.oathra/` は秘密情報です。共有、コミット、サポート投稿、Dockerイメージへの取り込みをしないでください。暗号鍵を紛失すると保存内容を復号できません。セットアップは既存の設定・DBを上書きしません。

## 実装されている範囲

| 機能 | 実装 |
|---|---|
| Web | 商品URLの取り込みと人による確認、連絡先、依頼、発信確認、通話状況、証拠、削除、連絡停止 |
| LINE | 1対1のテキスト・60秒以内の音声、アカウント連携、下書き、承認ボタン、結果通知 |
| Slack | DMでの下書き・承認・通知。イベント／操作署名を検証 |
| iOS | `../ios` のSwiftUIネイティブクライアント。依頼・確認・結果・準備 |
| 電話 | Twilio REST/Media Streams、既存Oathra Runtime/Voiceとの接続、時間上限、終了、本人番号確認、有人引き継ぎ |
| 営業結果 | 資料送付了承、商談日時の会話合意、未確定、辞退、連絡停止を区別 |
| 後続処理 | 個別承認されたGmail送信、Google Calendar招待と応答照合、SMS、HubSpotノート |
| MCP | stdioの一覧・下書き・結果取得。発信承認ツールは公開しない |
| 保存 | SQLite WAL、本文とイベントのAES-256-GCM暗号化、承認・実行・通知の永続化 |

自然言語の相手特定は登録済みの名前と商品に限定します。曖昧な相手を推測して発信せず、Web/iOSで明示選択してもらいます。URLからの抽出は未確認のテキストであり、そのまま自動的に営業へ使いません。

## LINEでの利用

管理者がLINE公式アカウントのMessaging APIを用意し、`LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` をサーバーに設定します。Webhook URLは `https://<Gatewayのドメイン>/hooks/line`。Webhookを有効にし、Botとの個別チャットを使用します。

Web/iOSの「LINE / Slackとつなぐ」で作った `連携 <コード>` をBotへ送ります。コードは5分間・1回だけ有効です。その後、例えば「田中さんにデモ商品の資料送付について電話して」と送ると確認カードが返ります。**テキストを送っただけでは発信しません。** 登録済みの商品・相手が一意に特定できることが必要です。承認カードの操作も5分以内に行います。

音声入力にはOpenAIによる文字起こしが必要で、別途API利用料が発生します。LINE/Slackへの通知にも各サービスの契約上限・料金が適用されます。全字幕をチャットへ流すのではなく、粗い進行状態と結果を返します。送信側への通知は相手先の電話品質を保証しません。

SlackはBot TokenとSigning Secretを設定し、イベントURL・Interactivity URLを `/hooks/slack` に向けます。DMメッセージ受信に必要なスコープ・イベントと `chat:write` を付与してインストールします。グループ・チャンネル・Bot自身のメッセージを営業発信の入口にしません。

## 実電話を有効にする

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
node apps/gateway/test/runtime-smoke.mjs
```

`apps/gateway/.env.example` の項目を参考に、既存の秘密鍵・ユーザー設定を保ったまま `.env.gateway` を編集します。

- `OATHRA_MODE=live`、外から到達できるHTTPSの `OATHRA_PUBLIC_URL`。
- Twilio Account SID/Auth Token/利用可能な発信元番号、SMS確認用のVerify Service SID。
- OpenAI APIキーと、契約で利用可能な音声モデルを `OATHRA_VOICE_MODEL` に明示指定。モデルは自動で推測しません。
- 発信主体の名称 `OATHRA_BUSINESS_NAME`、保守的な回線・音声費用単価、時間・日次上限。
- 利用目的、対象地域、電話勧誘・AI説明・会話データの扱い、提供元との契約を確認したうえで `OATHRA_LIVE_POLICY_REVIEWED=true`。

`liveReady` は必須設定・ビルドの確認であり、回線への疎通や実電話検証の成功を意味しません。最初は自分の実番号をSMS確認し、管理下の受電者との試験だけで検証してください。セットアップで作る模擬番号は実電話に使えず、模擬番号確認を有人引き継ぎにも転用できません。

実電話では冒頭にAI・発信者名・文字起こし共有を説明します。相手が **1を押した場合だけ** 音声AIへ接続します。2は再連絡停止、それ以外や無応答は終了です。この同意操作は利便性とのトレードオフを持つ現実装の仕様です。録音ファイルは保存しませんが、文字起こしは保存します。

電話はサーバーで動作します。アプリを閉じても進行し、再表示時に最新状態を取得します。有人交代は確認済みの自分の携帯番号へのPSTN接続で、iPhone内のVoIP通話ではありません。接続要求を送った時点と、相手回線が応答した時点を区別します。人へ引き継いだ後の会話はOathraの検証対象外です。

### 料金に関する制限

時間上限と日次予約枠はサーバーで強制します。金額は**運営者が設定した上限単価に基づく推定**であり、キャリアの最終請求額を保証するものではありません。有人交代の2回線分と切り上げを見込みます。実契約の発信先別単価、音声モデル費用、税、SMS、通知料金を確認し、キャリア側の支出制限も併用してください。画面上の数値を最新の料金表とみなさないでください。

## メール・予定・CRM

`OATHRA_INTEGRATION_OWNER` に指定した1アカウントにだけ、サーバー上の外部連携資格情報を紐づけます。Googleの認可済みClient ID/Secret/Refresh Token、必要ならHubSpotのトークンを設定します。認可画面・トークン取得そのものをこの実装が代行することはありません。

通話後にWebで宛先と本文を確認し、通話とは別に承認します。SMSは追加で `OATHRA_SMS_ENABLED=true` と連絡方法の了承根拠が必要です。予定作成は `needsAction` とし、招待作成を相手の承諾とは表示しません。メールのAPI受付も到達・開封の証明ではありません。通信結果が不明な送信は `UNKNOWN` とし、自動再送しません。

## 認証・API・MCP

`OATHRA_USERS_JSON` は `id / team / role / tokenHash` の配列です。トークンは十分にランダムな値を生成し、SHA-256の16進文字列だけをサーバー設定に置きます。権限は `admin` / `operator` / `viewer` / `agent`。データはアカウント単位、連絡停止はチーム単位です。アカウント登録・課金・SSO・組織横断CRMを完成済みとは扱いません。

すべての `/v1/` はBearer認証。主要ルートは次の通りです。以前の設計用 `src/contracts.ts` と異なり、**動作するHTTP APIの契約は `server.mjs` とテストが基準**です。

```text
POST /v1/missions/draft
POST /v1/missions/:id/review
POST /v1/missions/:id/start     {approvalToken, acknowledged:true} + Idempotency-Key
GET  /v1/missions/:id
GET  /v1/missions/:id/events    Authorization + Last-Event-ID
POST /v1/missions/:id/cancel
POST /v1/missions/:id/handoff
POST /v1/missions/:id/reconcile
POST /v1/followups/preview
POST /v1/followups/:id/execute  separate approval + Idempotency-Key
POST /v1/followups/:id/refresh
```

MCPは `node apps/gateway/mcp.mjs`。`OATHRA_GATEWAY_URL` と `OATHRA_GATEWAY_TOKEN` をMCPサーバーの非公開環境変数に設定します。LLMへトークンを貼り付けないでください。公開するのは `oathra_list` / `oathra_draft` / `oathra_status` だけです。人間による発信承認はWeb/iOS/LINE/Slackで行います。既存の `oathra mcp` とは別のGateway用コマンドです。

## 配備

永続ストレージと80/443ポートを持つLinuxサーバーに配置し、DNSをそのサーバーへ向けて実行します。

```sh
OATHRA_DOMAIN=oathra.example.com docker compose -f apps/gateway/deploy/compose.yml up -d --build
```

`.env.gateway` の `OATHRA_PUBLIC_URL` は同じHTTPSドメインにします。Dockerビルド時は同梱の `Dockerfile.dockerignore` により秘密情報を除外します。DBは名前付きボリューム、秘密鍵は設定側です。両方を安全にバックアップしてください。ローカルの試用DBをDocker側へ自動コピーしないため、空の配備先では商品・連絡先を登録し直します。

これは**単一Gateway・単一実行worker**用です。SQLiteを共有して水平増設する構成ではありません。継続稼働にはログ監視、バックアップ復元試験、トークン管理、キャリア側の費用監視が別途必要です。DB再初期化で不明な発信を消して再発信しないでください。未知状態はキャリア記録と照合します。

## 保持・評価・未完了の範囲

本文・イベントは暗号化しますが、レコードID・所有者ID・状態などの索引メタデータは平文です。完了した会話記録と放置された下書きは標準30日（`OATHRA_RETENTION_DAYS`）、監査記録は90日で削除します。未確定の回線状態は照合まで保持し、再連絡停止は別記録として残します。外部サービスに送信済みの内容はこのDBの削除だけでは消えません。

### 相手を守る仕組みと、あとから説明するための記録

- **再連絡停止**：「もうかけてこないでください」「いりません」「迷惑です」「リストから削除してください」などを通話中に検出すると、その場で通話を止めて番号を再連絡停止にします。誤検出しても番号が止まるだけなので、語彙は広めです。停止はチーム単位ではなく発信番号（このGateway）全体に効きます。
- **「2」の取りこぼし防止**：連絡停止に必要な情報は発信前に暗号化して保存します。発信要求のタイムアウトやプロセス再起動で通話の状態を失っても、相手が押した「2」は再連絡停止として記録されます。
- **レート制限**：クライアントごと・種類ごと（電話会社のコールバック／通話停止などの操作／公開ページ／API）に別枠です。公開ページへの連打で、連絡停止のコールバックやオペレーターの通話停止が429になることはありません。リバースプロキシ配下では `OATHRA_TRUST_PROXY=true` を設定してください（同梱のCompose構成は設定済み）。Gatewayへ直接到達できる構成では設定しないでください。
- **監査記録**：`GET /v1/audit?after=<seq>&limit=<n>`（管理者のみ）。承認（誰が・どの改訂の・どの相手に・どの経路で）、発信、結果、通話中の再連絡停止、同意、番号確認、引き継ぎ、フォローアップの結果、編集、ポリシー拒否を残します。電話番号は鍵付きハッシュの参照だけで、番号そのものや会話本文は入りません。ミッションを削除しても、相手の参照・状態・承認時刻・回線IDは監査の保持期間だけ残ります。
- **フォローアップの二重送信防止**：同じ通話・同じ種類で送信済み、または結果不明（送られた可能性あり）のものがあると、新しいプレビューを作れません。プロバイダ側で未送信を確認した場合だけ `POST /v1/followups/<id>/not-delivered`（`{"acknowledged":true}`）で解除できます。
- **エラーログ**：5xx、ワーカーの失敗、5回失敗して諦めた通知は、コードと要求IDだけを標準エラーにJSONで出します（氏名・番号・本文は出しません）。諦めた件数は管理者の `/v1/bootstrap` の `failedJobs` に出ます。

```sh
node --test apps/gateway/test/*.node.mjs
pnpm build
node apps/gateway/test/runtime-smoke.mjs
```

テストはWebhook偽造・再送、承認再使用、他アカウントへのアクセス、費用枠の削除回避、拒否、曖昧な合意、外部送信の不明状態等を含みます。台本試験を実電話の件数や成功率に換算しません。日時・合意抽出は限定的な表現を保守的に判定する実装で、全日本語・ASR誤り・方言を保証するものではありません。

本番公開・有料サービスの運用、App Store配信、APNs、完全な有人通話UI、自由な全営業シナリオ、カレンダー空き時間の自動調整、無条件の不通後SMS・自動再発信は未完了です。実回線、有人引き継ぎ、LINE/Slack、各外部APIの実アカウント疎通と実機QAを済ませてから対象を拡大してください。


## Channel / Capability プラグイン

LINE/Slack、電話・メール・カレンダー・SMS・CRMは共通Registryを経由します。
新規チャネル・同じ副作用種別の実行先は、ManifestとAdapterを明示登録して追加できます。
Telegramの追加例、SDK、作成・検査・有効化、承認への影響、信頼境界は
[プラグイン実装ガイド](../../docs/PLUGINS.ja.md)を参照してください。

```sh
node apps/gateway/plugins.mjs list
node apps/gateway/plugins.mjs doctor
```

この移行前の未実行の発信承認は、下書きを編集して再確認してください。
実行プラグインのコード・設定が変わった場合も未実行承認を失効させます。
プラグインの追加・有効/無効の反映にはGatewayの再起動が必要です。
実アカウントへの疎通成功や、第三者コードのサンドボックス隔離を意味しません。
