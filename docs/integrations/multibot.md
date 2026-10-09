# Multibot / 外部エージェントからの電話（experimental v1）

Multibotの電話ボットがOathraへ目的を渡し、Oathraが電話をかけ、ボットが結果を指揮役へ返します。外部AIが音声の一往復ごとに指示する構成ではありません。音声会話はOathraが担当します。

## 既定値で試す接続

この変更を含むソースへ更新し、Oathraを`pnpm build`してGatewayを再起動します。Multibotも初回のコード反映時はバックエンドを再起動します。以降の接続ファイルの追加には再起動は不要です。電話会社・音声AI・公開HTTPSが設定済みの実発信環境が前提です。

試用枠は**10回・1通話最大5分（サーバー上限が短ければその値）・発行から24時間・予約の確定依頼は不可**です。1件のUSD枠はサーバーの費用上限単価と接続料から保守的に算出し、総額にはその10件分を設定します。1件の算出額が既存のサーバー上限を超える場合は発行を拒否します。電話代は別途発生します。接続の作成だけでは発信しません。

宛先の既定値はTwilio Verifyで確認済みの自分の番号だけです。登録がない場合は`--phone`で今回許可する番号を指定します。過去の宛先を自動で許可しません。プライバシー同意は通常のOathra画面で一度済ませます。

Oathraリポジトリで、まず設定内容を表示します。トークンファイルは既存の所有者のものです。

```sh
node apps/gateway/connect-agent.mjs --url http://127.0.0.1:4244 --token-file .oathra/operator-token.txt
```

確認した内容で接続ファイルを発行するには`--approve --output /絶対パス/oathra-connection.json`を追加します。番号未登録なら`--phone <許可する番号>`も追加します。`--approve`はこの試用枠内での自動発信を事前承認します。トークン・agent ID・委任IDは一括発行され、ファイルは0600で保存されます。既存ファイルは上書きしません。`OATHRA_USERS_JSON`の編集は不要です。

通信応答が失われた場合は、表示されたrequest keyを`--key <同じキー>`として同じ引数で再実行します。同じ資格情報・委任が復帰し、枠を重複発行しません。再実行しても期限・回数は復活しません。

Multibotのbackendで接続ファイルを取り込みます。

```sh
.venv/bin/python -m agentteam.integrations.oathra_setup \
  --url <稼働中Multibotのorigin> \
  --connection-file /絶対パス/oathra-connection.json \
  --data-dir <稼働中Multibotが使用する実際のdataディレクトリ>
```

認証付きMultibotには`--token-ref file:<アクセスキーの絶対パス>`を追加します。「電話ボット」（ID `phone`）を登録し、接続は`<data-dir>/oathra/phone.json`へ保存します。既存接続は置換しません。電話ボットをチームの参加メンバーに選び、用件を依頼すれば実行できます。`phone_connection`でボットが許可番号・残回数・費用枠・期限を確認できます。期限切れや使い切った枠は自動更新しません。継続用の枠は下記APIで明示して作成し、進行中／結果不明の通話を照合してから切り替えます。

旧設定の`AGENTTEAM_OATHRA_CONNECTIONS_JSON`も使えます。ボットIDをキーに`{connection_file:"/絶対パス/oathra-connection.json"}`、または従来の`{base_url,token_ref,grant_id}`を指定します。この環境変数の指定はdataディレクトリのファイルより優先されます。値を変える場合はMultibotの再起動が必要です。

接続はボットIDに固定されます。user_lockedの電話ボットは自動チーム編成でも別IDへ複製しません。電話ツールを実行できる利用者には、そのボットの委任枠を使う権限がある前提です。共有環境では利用者ごとにボット・接続を分けます。接続ファイルや所有者トークンをチャット・プロンプト・Gitへ含めないでください。

## GenieなどのMCPクライアント

専用の`apps/gateway/agent-mcp.mjs`を追加しました。上記の接続作成コマンドは、その端末の絶対パスを使った`mcpServers`設定も表示します。トークン値は表示せず、`OATHRA_CONNECTION_FILE`で秘密ファイルを指定します。

- `oathra_connection`: 現在の許可番号・残回数・予算・期限を確認（発信なし）。
- `oathra_phone_call`: `operationKey`と`request`で1通話を依頼。
- `oathra_phone_status`: 同じ`operationKey`で状態・証拠を確認。
- `oathra_phone_cancel`: 同じ`operationKey`の停止を要求。

MCP stdioの2025-03-26、initialize/ping/tools/list/tools/callの範囲を実装しています。各タスクのoperationKeyを発信前に保存して再利用してください。接続・許可を作成するツールはAIへ公開しません。既存の`mcp.mjs`は下書き専用のままです。この委任発信用MCPのHTTP版は未実装です。読み取り・営業下書き用には、別の[OAuth HTTP MCP](claude-chatgpt.md)を追加しています（常設公開・公式クライアント接続は未検証）。

Genieは対象製品が未特定のため、製品との実接続は未検証です。対象がローカルstdio MCPに対応していればこの接続口を設定できます。HTTPツールが使える製品は下記APIでも接続できます。製品固有の設定方式・互換性は対象確認後に検証します。

## 委任の入力

`GET /v1/phone/grants/defaults`で既定値・番号登録／同意の不足を確認できます。`POST /v1/phone/connections`は専用agent資格情報と委任を一括発行します。Idempotency-Key必須、本文は以下のagentId以外の項目です。

`POST /v1/phone/grants`（既存agentへの委任、operator/admin所有者のみ）:

| フィールド | 内容 |
|---|---|
| `agentId` | 同じteamのagent利用者ID |
| `phones` | 具体的な番号の配列。省略時はVerify済みの自分の番号。ワイルドカード不可 |
| `maxCalls` | この委任全体での回数、1〜100。既定10 |
| `maxCallUsd` | 1件の見積上限（Gatewayの上限以下）。省略時は試用枠の算出値 |
| `maxTotalUsd` | 委任全体の予算枠。既定は算出した1件枠の10件分。各依頼でmaxCallUsdを消費し、取消でも復活しない |
| `maxSeconds` | 1通話の時間上限（Gateway上限以下）。既定は最大5分 |
| `expiresAt` | タイムゾーン付き日時。現在より先、30日以内。省略時は24時間後 |
| `allowReservation` | 予約を任せる場合だけtrue（既定false） |
| `acknowledged` | 内容を確認した所有者がtrueを指定 |

USDの上限はGatewayで設定した費用上限単価に基づきます。self-hostedでは電話会社・AI事業者の最終請求のハードリミットではありません。managedのusage-rate-v1では委任金額以内のクレジットに絞り、既存の残高停止処理も使います。電話代はMultibotのモデル予算とは別です。

`GET /v1/phone/grants`で自分の委任一覧を取得、`POST /v1/phone/grants/:id/revoke`で失効します。待機中の電話は発信直前にも再検査します。すでに会話中の電話は別途停止してください。

## 外部AIのHTTP契約

専用agentのBearer認証を使います。HTTP・SDK・専用MCPは同じ委任を使用します。

- `GET /v1/agent/phone/grants/:grantId` — 自分の委任と残枠。readyは委任枠の準備状態で、発信時には残高・日次上限等も検査します。
- `POST /v1/agent/phone/calls` — `{grantId,request}`、必須`Idempotency-Key`（8〜128文字、英数字/ハイフン/アンダースコア）。requestは既存PhoneRequest入力（phone/name/instruction等）。応答202は受付です。
- `GET /v1/agent/phone/calls/:key` — 同じキーで状態と結果を取得。
- `POST /v1/agent/phone/calls/:key/cancel` — 停止要求。送信途中の開始要求より先に届いた場合も、そのキーの将来の発信を止めます。

同じキー・同じ内容は同じmissionを返します。違う内容は409。同じキーの通話記録が保存期間で削除されても410とし、新規発信しません。権限・期限・予算不足は発信前に拒否します。委任が失効しても、発信したagentの状態確認と停止は可能です。

SDK入口は`sdk/gateway-client/index.mjs`の`grantPhone` / `agentPhone` / `agentPhoneStatus` / `agentPhoneCancel`。

## 達成条件と結果

任意のPhoneRequestへ`success`を追加できます（同revisionのCore/CLI/Gatewayが必要）。`required`は`date,time,partySize,price,confirmed`の配列、`expected`はdate（YYYY-MM-DD）、time（HH:MM）、partySize（整数）、price（数値）の任意フィールドです。期待値は既存Evidence Engineの等値制約として照合します。

予約の自動依頼では`task:"reservation"`、`callerName`、`success.expected.date/time/partySize`が必須です。予約の日時・確約はrequiredから省略しても確認対象となります。条件は音声AIにも渡します。

応答は`schemaVersion:1`と、`missionId/state/terminal/outcome/successCriteria/result/record/nextAction`を含みます。

| outcome | 扱い |
|---|---|
| pending | 受付・発信・通話中。状態を照会する |
| succeeded | 指定した構造化条件が会話上の証拠で揃った |
| needs_review | 条件が未達、または自由文だけの依頼。成功扱いにしない |
| declined / failed / cancelled | 拒否・失敗・取消。自動再発信しない |
| unknown | 発信／停止結果が不明。人が回線状態を照合する |

証拠は文字起こしに基づきます。予約台帳への登録・履行の証明ではありません。任意の自由文目標を万能に達成判定する機能はありません。

Multibotは1タスク1通話とし、run/task/botから固定キーを作りSQLiteへ入力・結果を保存します。プロセスが再起動しても照会して復帰します。未確認・失敗結果をfinish_taskや自動完了で成功にせず、指揮役へ引き継いでreport_blockerに進みます。ユーザーのrun取消時は通話停止を要求し、停止確認できない場合はunknownを残します。

## 検証

`pnpm build`、`pnpm lint:deps`に加え、実データを使用した非発信検証は`node --env-file=<実環境env> scripts/verify-agent-phone.mjs`。本番DBは読み取り専用で、過去の実通話依頼とアカウントを一時DBへコピーします。workerは起動しません。外部通話・課金の疎通証明ではありません。架空の通話や文字起こしは作成しません。

実電話の最終検証は、既定値または明示した委任を確認した後に、本人が許可した宛先で行います。
