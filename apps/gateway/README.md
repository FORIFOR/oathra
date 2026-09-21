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

ブラウザで `http://localhost:4244` を開き、`.oathra/operator-token.txt` の内容を貼り付けて「はじめる」を押します。画面は1枚で、ノートPCならスクロールなしで全体が見えます。上に出る「はじめに」の準備（会話データの取り扱いへの同意など）を済ませ、左の「だれに、なにを電話しますか？」で相手・商品・目的を選んで「内容を確認する」。確認画面で承認した場合だけ模擬実行し、結果は右の「いまの電話」に、ふつうの言葉と根拠になった相手の発言で表示されます。その下が「これまでの電話」です。商品・相手の登録やチャット連携は、右上の「設定」で開くパネルから行います（ページは移動しません）。トークンの場所はサインイン画面の「トークンはどこにありますか？」に書いてあります。

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

相手は登録済みの名前、または電話番号で指定できます。日本の国内番号（ハイフン・全角数字を含む）と国番号付き番号を共通Coreで正規化します。名前と番号が矛盾する依頼や複数の番号は拒否します。未登録番号は連絡先を勝手に作らず下書きに保存し、関係と連絡の根拠をWebで登録して依頼を作り直すまで発信承認を発行しません。曖昧な相手を推測して発信せず、Web/iOSで明示選択してもらいます。URLからの抽出は未確認のテキストであり、そのまま自動的に営業へ使いません。

## LINEでの利用

管理者がLINE公式アカウントのMessaging APIを用意し、`LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` をサーバーに設定します。Webhook URLは `https://<Gatewayのドメイン>/hooks/line`。Webhookを有効にし、Botとの個別チャットを使用します。

Web/iOSの「LINE / Slackとつなぐ」で作った `連携 <コード>` をBotへ送ります。コードは5分間・1回だけ有効です。その後、例えば「田中さんにデモ商品の資料送付について電話して」と送ると確認カードが返ります。**テキストを送っただけでは発信しません。** 営業電話では登録済みの商品・相手が一意に特定できることが必要です。相手は電話番号でも指定できます。商品名を指定せず「電話番号と、友人に伝えてほしい内容」を送信すると（商品未登録でも利用可能）、汎用の電話依頼として番号・本文を暗号化して30日間保存し確認返信します。この汎用下書きは営業missionとは別で、LINE/Slackからの発信操作は未接続です。発信承認ボタンは表示しません。番号と内容を送り直すと新しい下書きになります。承認カードの操作も5分以内に行います。

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

実電話では冒頭に「この通話は記録されています。」と案内し、数字の操作を待たずに音声AIへ接続します。通話中の2は再連絡停止です。AIは会話でAI代理であることを伝えます。音声ファイルは保存せず、文字起こしを保存します。案内と相手の積極的な同意は別の記録として扱います。

電話はサーバーで動作します。アプリを閉じても進行し、再表示時に最新状態を取得します。有人交代は確認済みの自分の携帯番号へのPSTN接続で、iPhone内のVoIP通話ではありません。接続要求を送った時点と、相手回線が応答した時点を区別します。人へ引き継いだ後の会話はOathraの検証対象外です。

### 料金に関する制限

時間上限と日次予約枠はサーバーで強制します。金額は**運営者が設定した上限単価に基づく推定**であり、キャリアの最終請求額を保証するものではありません。有人交代の2回線分と切り上げを見込みます。実契約の発信先別単価、音声モデル費用、税、SMS、通知料金を確認し、キャリア側の支出制限も併用してください。画面上の数値を最新の料金表とみなさないでください。

## メール・予定・CRM

`OATHRA_INTEGRATION_OWNER` に指定した1アカウントにだけ、サーバー上の外部連携資格情報を紐づけます。Googleの認可済みClient ID/Secret/Refresh Token、必要ならHubSpotのトークンを設定します。認可画面・トークン取得そのものをこの実装が代行することはありません。

通話後にWebで宛先と本文を確認し、通話とは別に承認します。SMSは追加で `OATHRA_SMS_ENABLED=true` と連絡方法の了承根拠が必要です。予定作成は `needsAction` とし、招待作成を相手の承諾とは表示しません。メールのAPI受付も到達・開封の証明ではありません。通信結果が不明な送信は `UNKNOWN` とし、自動再送しません。

## 認証・API・MCP

`OATHRA_USERS_JSON` は `id / team / role / tokenHash` の配列です。トークンは十分にランダムな値を生成し、SHA-256の16進文字列だけをサーバー設定に置きます。権限は `admin` / `operator` / `viewer` / `agent`。データはアカウント単位、連絡停止はチーム単位です。アカウント登録・課金・SSO・組織横断CRMを完成済みとは扱いません。

業務用の `/v1/` はBearer認証、またはブラウザー用HttpOnlyセッション認証。Cookieで変更する場合は設定済みの同一Originを必須とし、Bearer SDKは従来どおり利用できます。主要ルートは次の通りです。以前の設計用 `src/contracts.ts` と異なり、**動作するHTTP APIの契約は `server.mjs` とテストが基準**です。

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
- **開始案内**：冒頭に「この通話は記録されています。」だけを流し、その後に音声AIへ自動接続します。「1を押す」操作は不要です。案内後の署名済みMedia Streams開始を `recording.notice` として保存し、同意を得たという `callee.consent` は作りません。記録は文字起こしで、音声ファイルの録音は無効です。
- **「2」による再連絡停止**：自動接続後の通話中も、相手の「2」を再連絡停止として扱います。旧版で発信した通話のcallbackは互換維持し、発信前に暗号化して保存した情報により、セッションを失った後の「2」も記録できます。新しい冒頭案内で数字の操作は求めません。
- **レート制限**：クライアントごと・種類ごと（電話会社のコールバック／通話停止などの操作／公開ページ／API）に別枠です。公開ページへの連打で、連絡停止のコールバックやオペレーターの通話停止が429になることはありません。リバースプロキシ配下では `OATHRA_TRUST_PROXY=true` を設定してください（同梱のCompose構成は設定済み）。Gatewayへ直接到達できる構成では設定しないでください。
- **監査記録**：`GET /v1/audit?after=<seq>&limit=<n>`（管理者のみ）。承認（誰が・どの改訂の・どの相手に・どの経路で）、発信、結果、通話中の再連絡停止、同意、番号確認、引き継ぎ、フォローアップの結果、編集、ポリシー拒否を残します。電話番号は鍵付きハッシュの参照だけで、番号そのものや会話本文は入りません。ミッションを削除しても、相手の参照・状態・承認時刻・回線IDは監査の保持期間だけ残ります。
- **フォローアップの二重送信防止**：同じ通話・同じ種類で送信済み、または結果不明（送られた可能性あり）のものがあると、新しいプレビューを作れません。プロバイダ側で未送信を確認した場合だけ `POST /v1/followups/<id>/not-delivered`（`{"acknowledged":true}`）で解除できます。
- **エラーログ**：5xx、ワーカーの失敗、5回失敗して諦めた通知は、コードと要求IDだけを標準エラーにJSONで出します（氏名・番号・本文は出しません）。諦めた件数は管理者の `/v1/bootstrap` の `failedJobs` に出ます。

通話中のRuntimeエラーは `runtime.error` イベントに `code`・`fatal`・時刻を保存します。致命エラーはミッションの `runtimeError` と標準エラーの `call.runtime_failed` にも残します。提供元のメッセージ本文は保存せず、機密を含まないコードだけを使います。GPT-Liveのセッション開始後に拒否されたコマンドは回復可能として記録して会話を継続し、開始前のエラーは致命として扱います。

イベント取得とSSEの `seq` / `Last-Event-ID` はDBの永続連番です。Runtime内の連番で上書きしないため、既存イベントもDB順で再開できます。Coreのエラーイベントには任意の `code` を追加しており、従来の `message` / `fatal` の利用は互換です。[実通話後の修正・検証](../../docs/quality/realtime-recovery.md)。

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


### 一般連絡先

設定の「連絡先を登録・編集する」から、名前または会社名だけで保存できます。電話番号、メール、メモ、前回の電話内容（手入力）は任意です。保存した連絡先から編集して、後から電話番号を追加できます。メモの保存は発信や外部送信を行いません。前回の電話内容は通話結果の自動同期ではありません。

`POST /v1/contacts` は既存の `id` を指定すると更新します。`name`（100文字）または `company`（200文字）が必須、`phone` は空または従来の国番号付き形式、`notes` と `lastCallNotes` は各4000文字までです。`relationship` / `basis` は一般登録時には省略できます。これらの追加フィールドがない既存の連絡先も利用できます。

更新では**省略した項目を保持**し、消去する項目は明示的に `""` を送ります。これにより、一般連絡先の画面で名前だけを変更しても、営業用の `relationship` / `basis` / `crmId` が消えません。experimental v1の旧実装で「省略して消去」に依存していたクライアントは、空文字を明示するよう変更してください。作成時の名前または会社名必須、所有者・入力検証は維持します。

`GET /v1/contacts` は自分の連絡先を返します（bootstrap内の既存contactsも維持）。`POST /v1/contacts` は任意の `Idempotency-Key`（8〜128文字の英数字・`_`・`-`）に対応します。応答が失われた場合は**同じキーと同じ内容**で再送すると、24時間以内は同一の保存結果を返します。キーを別の内容へ流用すると409。キー省略の既存API呼び出しも利用できます。一般画面はキーを自動で付け、保存の連打と応答喪失時の重複作成を防ぎます。保存待ちに追記した内容は上書きせず、未保存として残します。

```js
// APIトークンはサーバー側SDK/CLIで管理。ブラウザーはHttpOnlyセッションを使います。
const saveKey = crypto.randomUUID();
const update = { id: contactId, name: editedName }; // 他の項目は保持
const response = await fetch(`${gatewayOrigin}/v1/contacts`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': saveKey },
  body: JSON.stringify(update),
});
if (!response.ok) throw new Error(`Contact save failed: ${response.status}`);
const saved = await response.json();
// 応答喪失時の手動再送にはsaveKeyとupdateをそのまま使用。電話は発信されません。
```

電話番号がない相手をWeb/LINE/Slackで電話依頼に指定すると `contact_phone_required` になります。営業発信の承認・実行時には最新の連絡先について、従来の関係（`inquiry` / `customer` / `consented`）と連絡根拠を実行層が必ず検証します。登録しただけでは発信できません。会社名が複数の連絡先に一致する場合も自動で相手を決定せず、Webでの選択を求めます。

## OSSとサービス版のクレジット（experimental）

managedのトップ画面はArenaの電話画面とHTML/CSSを共用します。電話番号・相手・目的、12種類のテンプレート、目的の履歴、一般連絡先を使い、ヘッダーに残高を表示します。初回は管理者が発行した設定リンクからメールアドレスとパスワードを設定し、以後はメールでログインします。通常画面にトークン入力はありません。8時間のHttpOnly/SameSite=Strict Cookieで再読込時も認証を保持します。HTTPSではSecureと__Hostプレフィックス、Path=/、Domain指定なし。認証用の元トークンをlocalStorage等へ保存しません。ログアウト、期限切れ、利用者設定の削除、tokenHash変更、パスワード変更・再設定で失効します。営業用Gateway画面は `/sales` に残しています。Arenaのlocalhost APIをサービスとして公開する構成ではありません。

入力後に「電話する」→確認画面の「同意して電話する・Nクレジット」の2操作で承認します。確認には宛先・目的・利用額と条件・送信先・文字保存を表示し、戻って編集できます。同意チェックを別操作にせず、最終ボタンで明示承認を受け取ります。最終ボタンに自動フォーカスせず確認見出しから読み始めます。未接続の環境では「下書きを保存」と表示し、発信ボタンは理由付きで無効です。

セッションAPI: `POST /v1/session` はBearer＋同一OriginでCookieを発行し、JSONには資格情報を返しません。`DELETE /v1/session` は同一OriginからCookieを失効させます（期限切れCookieの削除も可）。Cookie認証のリクエストでは任意の `X-Oathra-Account` を現在の利用者IDと照合し、別タブで利用者が変わった古い画面の操作を409で拒否します。opaqueセッション値のハッシュだけをSQLiteへ保存し、有効期間は更新されない固定8時間です。SSOや自動ユーザー登録の代わりではありません。

### メールログインの初回設定・移行（experimental v1）

`setup-managed.mjs` は秘密ディレクトリの `login-setup-url.txt` に初回リンクを作ります。起動後、ファイル内のURLを開き、ご自身のメールと8〜128文字のパスワードを設定してください。リンクは1時間・1回限りです。メールはログインIDであり、所有確認メールは送りません。

既存環境、追加した既存利用者、期限切れリンクには次を使います。`operator` は `OATHRA_USERS_JSON` の対象IDに置き換えます。出力ファイルは毎回新しい非公開パスにしてください。

```sh
node --env-file=.env.managed apps/gateway/login-setup.mjs operator .oathra/login-setup-url.txt
# パスワードを忘れた場合だけ（登録済みと同じメールで再設定）
node --env-file=.env.managed apps/gateway/login-setup.mjs operator .oathra/login-reset-url.txt --reset
```

このコマンドはアカウントを新規作成せず、対象IDのリンクを更新します。既存ID・残高・連絡先・履歴を保持します。利用者を増やす場合は管理者が `OATHRA_USERS_JSON` に固有ID・権限・十分にランダムなAPIトークンのhashを追加し再起動してからリンクを作ります。公開の自己登録、メール送信による自動再設定、メール所有確認、SSO、MFAは未実装です。リンクとAPIトークンは秘密情報として渡し、ログや公開リポジトリに貼らないでください。

通常ログイン後は「アカウント」で現在のパスワードを確認して変更できます。他の端末のセッションは失効します。リンクはURL fragmentで受け取り即座に履歴から除去し、APIにのみ送ります。サーバーはリンクのhash・期限・対象ID・設定時の資格情報versionを照合し、1回だけ消費します。初回設定で既存のトークン由来Cookieも失効しますが、APIのBearer認証は互換性を保ちます。

| API | 入力・権限 | 成功・代表的な失敗 |
| --- | --- | --- |
| `POST /v1/auth/setup` | 同一Origin、JSON `{code,email,password}`。管理者発行リンクの所有が必要 | 200 + HttpOnly Cookie、期限切れ/使用済み410、短いパスワード400、既存メール衝突409 |
| `POST /v1/auth/login` | 同一Origin、JSON `{email,password}` | 200 + HttpOnly Cookie、不一致401（メールの登録有無を区別しない） |
| `POST /v1/auth/password` | 認証＋同一Origin、JSON `{currentPassword,newPassword}` | 200 + 新Cookie。現在のパスワード必須、変更競合409 |
| `GET /v1/bootstrap` | 既存認証 | 追加の `login:{email,passwordLogin}`。hash・リンク・平文パスワードは返さない |

入力メールをtrim/小文字に正規化（最大254文字）。パスワードは8〜128 Unicode code point、UTF-8で1024byte以下、空白を削除せず貼り付け・日本語を許可します。HTTPはJSON必須、Cookie生成・パスワード操作は同一Origin必須。ログイン試行は15分枠でIDごと10回/IPごと60回まで（成功も含む、超過429）、scrypt同時実行は2まで（超過503）です。必要時は `OATHRA_TRUST_PROXY` と信頼できるproxyの設定も合わせます。

保存は新しい `password_accounts` テーブルの追加。ランダムsalt＋非同期scrypt（N=2^17,r=8,p=1）を使用し、本文を既存のAES-GCM、検索メールをHMACで保護します。[Node.js crypto](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) と [OWASPのパスワード保存指針](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)を参照。暗号鍵とDBをセットでバックアップしてください。[検証範囲](../../docs/quality/email-login.md)。

個人への伝言・確認には商品登録は不要です。目的を確認すると下書きがアカウントに保存され、発信前の確認に利用クレジットと送信先・記録方針を表示します。実発信はlive設定が整った環境のみ。初期化直後のsimulator環境では下書き・履歴の確認までで、電話成功や架空の会話は生成しません。依頼はask-onlyで、予約確定・購入・支払いを許可しません。目的達成は自動判定せず、保存された会話を確認します。

個人電話API（experimental v1）は次のとおりです。各ルートはBearerまたはCookie認証必須、下書き・履歴・結果は所有者のみ参照できます。

| API | 契約 |
| --- | --- |
| `GET /v1/phone/status` | サーバーの発信可否、開示、クレジット見積 |
| `GET /v1/phone/templates` | Coreと共通の目的テンプレート |
| `POST /v1/phone/draft` | `{phone,name,instruction}` → 保存済みmission、approvalToken、expiresInSeconds、readiness、consentVersion |
| `GET /v1/phone/history` | 自分の下書き・通話記録（目的の再利用） |
| `GET /v1/phone/calls/:id` | 保存状態、文字起こし、クレジット状態。電話録音ファイルは含まない |

発信・取消は既存mission APIと同じ認可・承認・台帳処理を使います。番号はCoreの `PhoneRequestSchema` で日本国内表記も正規化し、余分な入力項目や未記入のテンプレート項目は400。CLIとGatewayは `definePhoneRequest` で契約を共有します。HTTP受付は通話完了を意味しません。通信障害時は自動再発信せず、「更新」「通信会社の状態を確認」から照合します。回線IDも不明の場合は管理者が通信会社で確認する必要があります。結果不明のまま取消済みに変更しません。

AIの声は電話ごとに画面の「AIの声」で選べます（GPT-Liveの13種、既定は `marin`。`POST /v1/phone/draft` の `voice`、一覧は `GET /v1/phone/status` の `voices`）。声は通話の途中では変えられず、一覧に無い名前は400で拒否します。名前だけでは選べないので、各声で同じ一文を話させた録音（`public/phone/voices/*.wav`、`node --env-file=<env> scripts/voice-samples.mjs` で再生成）から声の高さ（基本周波数の中央値）と速さを測り、「低めの声（男性に多い高さ）・やや速め」のように表示して、高さごとにまとめます。性別そのものは録音からは断定できないため表示せず、「この声を試聴」で録音を聞けるようにしています。計測値は `GET /v1/phone/status` の `voiceDetails`。選んだ声は確認ダイアログに表示し、その端末に記憶します。

GPT-Liveは全二重です。回線がつながった時点で相手を待たずに「もしもし」と名乗るよう指示し、その後の発話の順番はモデルに任せます。入力音声は無音も含めて送り続けます。相づちでは返答を止めず、質問・訂正などの割り込みのときだけ回線に溜まった返答を破棄します。発話が重なった後に双方が1.5秒以上黙ったままなら、一度だけ発言を譲るよう促します（10秒以内の連発なし、相手が待つよう求めた場合と検索中は行いません）。通話中の確認状態は `session.thinking.append` で渡し、発話を中断させません。`end_call` の後は挨拶の再生を待ってから切断します。双方が無音のままなら25秒で終了し、相手の切断・取消・クレジット上限は優先します。実際に相手が聞けたことを保証するものではありません。

通話メモに日付と時刻が残った通話には「予定に追加（カレンダー用ファイル）」が出ます。`GET /v1/phone/calls/:id/calendar.ics`（所有者のみ、日時が無ければ409）が、1時間の予定を Asia/Tokyo で返します。双方が確認した日時は「【電話で確認】」、相手の提案や未確認の日時は「【未確定】・TENTATIVE」とし、本文に各項目の確認状況と根拠の発言、予約の成立を保証しない旨を入れます。外部のカレンダーへは接続せず、認証情報も使いません。

「テンプレート → 雑談」を選ぶと、近況や趣味などの会話を続けられます。ニュースの質問時には公開カテゴリ、それ以外の公開情報の調べもの（会社、株価、商品、公人、事実関係など）では `topic=search` と2〜60文字の検索語、台風・大雨・天気では固定カテゴリ `weather`（気象庁の発表を伝える日付つきの気象記事を確認）、東京のイベント・お出かけ情報では固定カテゴリ `tokyo_events`（探す→主催者等のページで開催日を確認するため検索は最大3回、25秒）をOpenAI Responses `web_search`（`gpt-5.4-mini`）へ送信します。`OPENAI_API_KEY` に同モデルと検索の利用枠が必要です。検索は1通話8回まで、1回15秒、失敗時の自動再試行なし。検索語は機械的に検査し、この通話の相手・依頼者の名前、電話番号らしい数字の並び、メールアドレス、URL、郵便番号を含むものは検索せずに拒否します（モデルの判断には任せません）。会話全文も渡しません。公開検索の答えには出典と「確認日」（その情報がいつ時点のものか）を必須とし、無ければ未確認にします。株価などは値と日付だけを伝え、予想や売買の助言はしません。ニュースは報道日・出典、東京イベントは日本時間の今日から14日以内の開催日と公式な主催者・会場ページを確認します。開催日を報道日で代用しません。複数の調べものを一度に頼まれた場合は同時に調べ、すべての結果がそろってからまとめて答えます。検索が5秒を超えたら「いま確認しているところです」と一度だけ伝えます。検索中に相手が相槌を打っても検索自体は続けます。通話終了時は検索を中止します。検索はGPT-Liveの `lookup_news` ツールから呼ばれ、Live側の汎用 `web_search` は有効にしません。

`usage-rate-v1` では検索ツールの回数と要約APIの使用トークン数もクレジットへ算入します。旧精算契約では検索・要約の費用は運営者負担です。検索結果を音声で伝える際の音声AI使用量は、その精算に含まれます。ニュースの出典は「履歴から使う → 状況を見る → 調べたニュース・イベント」で確認できます。検索結果・取得日時・出典も通話履歴と同じ所有者単位で保存・削除します。

SDKの下書き例（これだけでは発信しません）:

```js
const chat = (await client.phoneTemplates()).find(template => template.id === 'chat');
const draft = await client.phoneDraft({
  phone: recipient.phone,
  name: recipient.name,
  instruction: chat.instruction.ja, // 編集可能
  conversationMode: 'chat',
});
// 通常のreview/明示的なstart手順で相手・費用・送信先を確認する。
```

`conversationMode?: 'message' | 'chat'` はPhoneRequest v1のexperimentalな追加フィールドです。省略時は伝言モードのまま。旧バージョンのstrict parserに新フィールドは渡せません。API/SDK/CLIを同じrevisionへ更新してください。内容の文章に「雑談」と書くだけでは検索権限を付与しません。[受け入れ条件と証拠](../../docs/quality/chat-news.md)。

SDKで下書きだけを作る例（発信やクレジット消費は行いません）:

```js
import { gatewayClient } from '../../sdk/gateway-client/index.mjs';
const phone = gatewayClient({ baseUrl: process.env.OATHRA_GATEWAY_URL, token: process.env.OATHRA_USER_TOKEN });
const draft = await phone.phoneDraft({
  phone: process.env.RECIPIENT_PHONE,
  name: process.env.RECIPIENT_NAME,
  instruction: process.env.CALL_PURPOSE,
});
// draft.mission、readiness、creditQuoteを利用者へ提示した後だけ、
// consent(draft.consentVersion) と既存start APIへ進みます。
const saved = await phone.phoneRecord(draft.mission.id);
```

- **OSS / self-hosted**（既定）: 自分で電話会社・AI・公開音声接続を設定。プラットフォームのクレジットは不要。利用者の各API契約による費用が発生します。
- **サービス / managed**: 運営者が電話会社・AI・公開接続を設定。利用者はメールとパスワードでログインし、自分の残高で電話を依頼します。API/SDKは個別Bearer認証を継続できます。キーはサーバーだけに保持します。

旧固定方式を維持する場合は、既存Gateway設定へ `OATHRA_DEPLOYMENT=managed` と `OATHRA_CREDITS_PER_CALL=<正の整数>` を指定します。料金は運営者が決定し、コードでは販売価格を固定しません。空のサービス環境を作る場合は `node apps/gateway/setup-managed.mjs <環境ファイル> <1回のクレジット数>`。localhost:4245のシミュレーターモードで初期化され、デモ商品・連絡先・残高は作りません。既存ファイル/DBは上書きしません。

旧 `call-attempt-v1` の利用単位は **1発信試行**。承認時に確保し、workerが発信処理の実行を確定した時点で消費します。接続前の障害・不応答・中断・結果不明も消費対象です。実行前のキュー取消やポリシー拒否では確保を返却します。実行確定直後にクラッシュしても自動返却/再発信せず、管理者が状況を照合し必要なら補填付与を行います。シミュレーターは0クレジット。会話の成功や成果保証に対する料金ではありません。

画面の残高から、追加/確保/消費/返却の履歴を開けます。確認画面に消費量と条件を表示し、残高不足ではサーバーが402で拒否します。金額/所有者/消費量はブラウザーの値を信用しません。見積後に料金設定を変えると依頼の再作成が必要です。クレジットは正の整数、残高＋確保は最大10億です。

通話結果と電話履歴には **「今回の消費：Nクレジット」** を表示します。キュー待ちは消費0＋確保中、実行前取消は消費0＋返却額を併記。結果画面の「現在の残高」は最新の利用可能残高で、過去通話の直後残高ではありません。通話結果が未確認でも、記録済みの消費を表示し、自動返却しません。消費データを取得できない場合は「未確認」と表示します。

`GET /v1/phone/history` と `GET /v1/phone/calls/:id` は追加フィールド `creditUsage: {status,consumed,held,released}` を返します。所有者と通話IDで限定した保存済みcredit_holdsが正本で、現在の販売単価・依頼時の見積から実消費を推測しません。既存creditQuote/creditStateは維持。`call-attempt-v1` は固定額、`provider-cost-v1` は以下の従量精算です。新方式の `creditUsage.status` には `pending` / `settled` / `waived` を追加し、確定時は `cost` に通話秒数と費用内訳を含みます。既存の `creditState` は保持状態の互換値であり、金額表示には必ず `creditUsage` を使います。

### 使用量に基づく精算（provider-cost-v1）

終了時に直ちに精算するには、以下の基本設定に加えて [終了時精算](#終了時精算usage-rate-v1) を有効にしてください。追加設定がない場合の旧方式は、従来どおり回線の請求額取得を待ちます。

既存DBのまま次を設定して再起動します。単価は公式料金と運営者の契約を確認して更新し、`version` を変更してください。これはクレジット販売・購入決済の価格設定ではありません。

```dotenv
OATHRA_CREDIT_POLICY=provider-cost-v1
OATHRA_CREDIT_USD=0.01
# 円建て回線: 運営者が確認したJPY/USD換算率と基準日を別途設定
# OATHRA_CARRIER_JPY_PER_USD=<確認した1米ドルあたりの円額>
# OATHRA_CARRIER_FX_DATE=YYYY-MM-DD
OATHRA_VOICE_ENGINE=gpt-live
OATHRA_VOICE_MODEL=gpt-live-1
# セッション1分あたりのUSD。ご自身の契約単価を確認して設定してください。modelはOATHRA_VOICE_MODELと一致が必要です。
OATHRA_LIVE_PRICES_JSON='{"model":"gpt-live-1","version":"2026-09-20","perMinute":"0.05"}'
# 0 disables each daily limit. Per-call time/cost ceilings and prepaid balance remain enforced.
OATHRA_DAILY_CALLS=0
OATHRA_DAILY_USD=0
```

円建ての回線は承認時の換算率を固定して米ドル相当額へ換算し、元の円額・換算率・基準日も保存/表示します。換算率はサービスの算定用で、決済カードや提供元請求書の実換算手数料とは一致を保証しません。設定更新は新しい発信だけに適用します。

音声エンジンはGPT-Liveのみです（`OATHRA_VOICE_ENGINE` は省略可、`gpt-live` 以外は500 `unsupported_voice_engine`）。GPT-Liveはtoken使用量を通知しないため、音声AIは「Media Stream接続時間を分へ切り上げ×セッション分単価」で計算します。分単価はご自身の契約で確認してください。外部call plugin・有人転送はこの方式では未対応で、設定または操作を拒否します。OSSのself-hostedや旧固定方式は維持します。

旧方式（`OATHRA_SETTLEMENT_MODE` 未設定）では承認時に `ceil(OATHRA_MAX_CALL_USD / OATHRA_CREDIT_USD)` を確保します。終了後、[Twilio Call.price](https://www.twilio.com/docs/voice/api/call-resource)の接続料金（USDまたは換算率を設定したJPY）と、GPT-Liveの接続時間（分へ切り上げ）×承認時の分単価を合算し、最後に一度だけクレジット単位へ切り上げます。電話会社の通話時間も結果と履歴へ表示します。承認上限以上は引き落とさず、超過額は運営者負担です。

文字起こし・Media Streams・番号月額・税・インフラ費用は運営者負担とし、利用者へ加算しません。AI金額は報告使用量と設定単価による算定で、提供元の請求書全体を取り込んだ額ではありません。割引・契約変更は運営者が単価設定へ反映してください。

Call.price未取得・換算未設定の通貨・使用量欠測・通信断では **精算待ち** のまま確保を保持し、無料や消費済みと表示しません。5秒周期で対象を確認し、同じ通話への価格照会は最大1分に1回、発信の自動再実行はありません。再起動後も継続します。欠けたAI usageは復元したと仮定せず、管理者が回線終了を確認して `POST /v1/missions/:id/billing-waive` に `{acknowledged:true,reason}` を送れば、費用を運営者負担として一度だけ全額返却できます。未精算の履歴は削除/保持期限の対象外です。

発信要求がタイムアウトした、または回線IDを保存する前にworkerが停止した通話は、回線へ照会する手段がなく、通常の精算にも `billing-waive` にも進めません。管理者が通信会社の管理画面でその番号への通話が無いことを確認したうえで、`POST /v1/admin/missions/:id/credits-force-release` に `{acknowledged:true,carrierChecked:true,reason}` を送ると、確保分を全額返却して通話を「完了しませんでした」に確定します（一度だけ、監査ログ `credits.force_released`）。回線IDがある通話は 409 `reconcile_call_instead` です。管理者が他の利用者の通話を運営者負担にする場合は `POST /v1/admin/missions/:id/billing-waive` を使います（利用者向けの `/v1/missions/:id/billing-waive` は所有者本人の通話だけが対象）。精算で例外が出た通話は起動時に記録して残りを続行し、確保が無い予約はその1件だけ失敗にして後続の発信を止めません。

旧固定方式の通話は遡及再計算しません。新しい料金で古い承認を使うと409になり、入力を確認し直す必要があります。SDKの `phoneRecord(id).creditUsage` / `status(id).creditUsage` で確保・精算待ち・消費・返却を取得できます。管理者SDKには `waiveBilling({missionId,reason,acknowledged:true})` を追加しています。[受け入れ条件と実行証拠](../../docs/quality/metered-credits.md)。

### 終了時精算（usage-rate-v1）

`provider-cost-v1` の追加設定です。回線の請求額取得を待たず、終了時にサービス利用額を固定し、消費・返却・残高と内訳を保存します。後の提供者請求との差額は運営者負担で、利用者への自動追加徴収はありません。UIは「今回の消費」「利用額」「利用内訳」と表示します。

```dotenv
OATHRA_SETTLEMENT_MODE=usage-rate-v1
# 下記は2026-09-20確認の料金設定例。ご自身のアカウント/発信元/宛先の契約料金を確認・更新してください。
OATHRA_USAGE_PRICES_JSON='{"version":"2026-09-20","carrier":[{"prefix":"+8190","currency":"JPY","perMinute":"29.858741","incrementSeconds":60,"source":"https://pricing.twilio.com/v2/Voice/Countries/JP"}],"mediaPerMinute":"0.0044","search":{"model":"gpt-5.4-mini","perCall":"0.01","input":"0.75","cached":"0.075","output":"4.5"}}'
```

回線単価は [Twilio Pricing API](https://www.twilio.com/docs/voice/pricing) の `outbound_prefix_prices` / `current_price` で確認できます。発信元が限定された料金は `origination_prefixes` も照合してください。`carrier` に宛先prefixを列挙し最長一致で選択します。この設定例のみでは +8190 以外は409 `carrier_rate_not_configured` です。JPY建てなら前述の換算率と日付が必須です。単価は承認時にコピー保存し、宛先・単価変更後には再確認が必要です。

managed電話の新しい承認は `spendingLimit: "balance-v1"` とし、利用可能残高と設定上限の小さい額を確保します（残高377・設定上限400なら377）。最初の回線課金単位＋中継費を賄えない残高は、確認画面と実行層で拒否します。旧承認・旧料金方式の確保額は変えません。通話中の追加付与で承認済み上限は増えません。

workerは250ms周期と使用量通知時に同じ精算式で使用額を確認し、上限到達または次の回線課金単位での超過前に停止を要求します。音声AI・検索の使用量通知と通信会社の停止には遅延があるため、残高ゼロと完全同時の切断は保証できません。超過額は運営者負担で、利用者の引落しは確保額以内です。停止未確認はUNKNOWN・精算待ちを維持します。別途設定された最大通話時間 `OATHRA_MAX_SECONDS`（30〜600秒）も適用されます。残高上限監視のあるmanaged電話はこの設定値を使い、従来の180秒への切り詰めを行いません。新しい設定は新規確認に適用し、既存承認を延長しません。電話会社の終了時間が上限に到達した履歴には、その旨を表示します。[受け入れ条件と検証](../../docs/quality/credit-cutoff.md)。

計算式: 回線は課金単位へ切り上げた接続秒数×分単価、音声中継は接続分数×単価、GPT-Liveは接続分数×セッション分単価、検索は実際の `web_search_call` 数×呼出単価＋Responsesモデルのtoken使用量×単価。すべて整数nanodollarで合算し、合計をcredit単価で一度だけ切り上げます。確認要求は最大8回ですが、1要求の内部検索呼出数は複数の場合があり、APIが返した数で計算します。

残高上限の監視・最初の1分の最低残高にも同じ分単価を含めます。接続したのに接続時間を記録できなかった通話の音声AI費用は、終了時精算では `cost.excluded` に記録して運営者負担、旧方式では精算待ちのままにします。GPT-Liveの裏側で使う推論モデル（delegation）の費用は計測せず運営者負担です。

終了時間は署名付きTwilio終了通知/Call.durationを優先、まだ届かなければ記録した応答開始〜停止時刻（応答開始未取得時はMedia Stream接続時間）を使います。停止HTTP応答待ち時間は含めません。取得できなかったAI/検索使用量は `cost.excluded` に記録し運営者負担にします。未知の発信・停止結果は **精算待ち** のまま照会し、再発信しません。STT・税・番号月額・インフラ費用も運営者負担です。これは請求書そのものではなく、使用量と設定単価によるサービス利用額です。

`creditUsage.cost` の互換追加フィールド: `basis: "usage-rate-v1"`, `carrierNanoUsd`, `mediaNanoUsd`, `aiNanoUsd`, `searchNanoUsd`, `searchCalls`, `voiceModel`, `searchModel`, `durationSeconds`, `quantities`, `unitRates`, `excluded`。未設定時の旧cost形式は維持します。旧承認・旧通話に自動遡及しません。GPT-Liveは秒単価に加え委譲先モデルの別計測が必要なので、この精算方式では引き続き未対応（設定エラー）です。

```js
const record = await client.phoneRecord(savedCallId);
const { consumed, released, held, cost } = record.creditUsage;
console.log({ consumed, released, held }); // wallet movements; never derive them from a new quote
if (cost?.basis === 'usage-rate-v1') {
  console.log({ twilioUsd: (cost.carrierNanoUsd + cost.mediaNanoUsd) / 1e9,
    voiceModel: cost.voiceModel, voiceUsd: cost.aiNanoUsd / 1e9,
    searchCalls: cost.searchCalls, searchUsd: cost.searchNanoUsd / 1e9 });
}
```

[受け入れ条件・証拠](../../docs/quality/usage-cost.md)。外部請求書との最終一致や新規PSTN通話での再検証とは区別しています。

| API（Bearer認証必須） | 用途 |
| --- | --- |
| `GET /v1/credits` | 自分のavailable/heldと現在のquote |
| `GET /v1/credits/ledger?after=<seq>` | 自分の台帳。昇順最大100件、最終seqで続ける |
| `POST /v1/admin/credits/grants` | 管理者付与。JSON `{owner,amount,reason}` と `Idempotency-Key` 必須 |
| 既存`/v1/missions/:id/review` | creditQuoteを含む確認内容と承認token |
| 既存`/v1/missions/:id/start` | 確保とキュー登録を同一トランザクションで処理 |
| 既存`/v1/missions/:id/cancel` | 実行前は取消と確保解除を同一トランザクションで処理 |

付与APIのキーは永続的に重複検出します。同じキーで違う利用者/額/理由を指定すると409。決済イベントと接続する場合、サービス側で決済事業者の署名と支払完了を検証してから、決済イベントの一意IDをキーに管理者APIを呼びます。**決済接続・クレジット購入UI・自動ユーザー登録/SSOは含みません。** 管理者キーをブラウザーへ渡さず、通常利用者にはoperator権限の個別トークンを発行してください。払い戻し/販売単価/税務の処理を実装済みと扱わないでください。

SDK入口は `sdk/gateway-client/index.mjs`。管理対象は既存Gatewayのmission APIで、localhostのArena `/api/phone/*` を公開する方式ではありません。既存サービスは利用者IDをGatewayのownerへ対応付け、バックエンドで個別トークンを管理できます。

```js
import { gatewayClient } from '../../sdk/gateway-client/index.mjs';
const client = gatewayClient({ baseUrl: process.env.OATHRA_SERVICE_URL, token: process.env.OATHRA_USER_TOKEN });
const balance = await client.credits();
// preparedMissionId は既存 /v1/missions/draft で作成した依頼ID。
const review = await client.review(preparedMissionId);
// 相手/内容/送信先/消費量を利用者へ表示した後、明示的な承認時だけ呼ぶ。
await client.start({ missionId: preparedMissionId, approvalToken: review.approvalToken,
  idempotencyKey: approvalAttemptId, acknowledged: true });
// 応答不明なら start を新しいキーで再送せず、status で確認する。
const current = await client.status(preparedMissionId);
```

保存は単一SQLite/WAL。残高・確保・台帳・mission変更をBEGIN IMMEDIATEで直列化し、台帳は通話履歴の削除/保持期限とは独立して保持します。台帳金額/owner/一意参照はDB内の通常列、理由は既存AES-GCMで暗号化。参照へ電話番号やカード情報を入れないでください。分散DB・複数リージョンへの適合は未検証です。[受け入れ条件と検証](../../docs/quality/managed-credits.md)。

### 画面の復帰と保守

電話・連絡先の未保存入力と表示中の通話は同じタブで再読込して復元できます。未完了通話があれば状況を再取得し、再発信はしません。入力はユーザー別のsessionStorage、送信済み下書き・履歴・料金はサーバーに保存します。タブを閉じると未送信の入力は失われる場合があります。ログアウトすると入力を消し、期限切れなら再ログイン後に同じユーザーの入力を戻します。

画面は認証・連絡先編集・電話・料金表示・HTTP通信に分割しています。[構造](../../docs/ARCHITECTURE.md#managed-phone-application-experimental-gateway-v1)と[監査・検証結果](../../docs/quality/implementation-review.md)を参照してください。ローカルの復帰試験は `node scripts/ui/managed-recovery.mjs`。`PHONE_INPUT_TEST_NUMBER` または `.env` の `TWILIO_PHONE_NUMBER` を入力値として使い、一時DBとloopbackサーバーのみで動かします。workerは起動せず、電話や有料APIは呼びません。Chromeが必要です。


### 通話条件の保持（experimental v1）

テンプレートは選択直後に目的欄へ入り、「前の入力に戻す」で置換前へ戻せます。`{{項目}}` は具体的な値への編集が必要です。テンプレート選択は発信承認ではありません。

`phoneRecord(id).memory` / `phoneHistory()` の追加フィールドは、`recipient`（相手）、`originalRequest`（元の依頼）、`notes`（日付・時刻・人数・料金・確認発言）、`history`（根拠と変更履歴）です。各noteの `requested` は入力由来、`value` は現在の会話由来、`status` は `missing` / `proposed` / `verified`。`verified` は双方の会話で確認できた条件であり、外部の予約台帳への登録を意味しません。現行の電話依頼は `bookingStatus: "not_authorized"` の空席確認・伝言です。

CoreのEvidenceEngineを再利用して、変更や撤回により古い確定を無効にします。途中で遮られたAI発話は確認証拠にせず、文字起こしには `interrupted: true` を残します。希望条件を実際に話した証拠へ混ぜません。通話中にSQLiteへメモを保存し、古い履歴は保存済みの発言と承認日時（なければ作成日時）から復元します。従来の記録では割込フラグがない場合があり、その履歴から実際に相手が聞いたことは証明できません。

画面の「通話メモ」で根拠と変更履歴を開けます。「前回の内容を引き継ぐ」は、条件を再確認する指示とともに次の目的欄へコピーする明示操作です。長すぎる場合はコピーせず編集を案内します。所有者の認証・暗号化保存・削除/保持期限は既存の通話記録と共通です。氏名など抽出対象外の条件は元の依頼と文字起こしを参照してください。

日本語の電話メモの相対日付は、承認日時（なければ作成日時）の日本時間を基準に固定します。`memory.timeZone` は `Asia/Tokyo`、`referenceAt` は基準のUnixミリ秒です。サーバーのTZや閲覧日が変わっても同じ値を再構築します。`turnCount` / `lastTurnId` が保存済み発言と一致しない古いメモは再構築します。
