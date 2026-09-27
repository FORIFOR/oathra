# Oathra × Genie 連携パッケージ

**状態：連携コード実装済み・ローカルのアダプターテスト済み。両リポジトリ／稼働中アプリには未適用。**

Genieから電話依頼の下書きを作り、利用者がOathraで発信内容を確認・承認し、後からGenieへ通話状態と会話の根拠を戻す連携です。ほかのAIにはMCPまたは限定HTTP APIを提供します。電話の発信、購入、課金、メール送信をAIツールへ解放する変更ではありません。

このパッケージを作る過程で、実電話、モデルAPI、外部メッセージ、GitHubへのpush、サービスの再起動は行っていません。テスト用HTTPサーバーとダミー資格情報は隔離されたローカルの試験です。

## できること

| 操作 | Genie | 他のMCPクライアント | 誰が承認するか |
| --- | --- | --- | --- |
| Gatewayの対応エンジン・準備状況を取得 | `oathra.phone.capabilities` | `oathra_phone_capabilities` | 接続時の読み取り許可 |
| 電話下書きを作成 | `oathra.phone.prepare` | `oathra_phone_draft` | Genieは下書きデータ送信前にも承認を要求 |
| 電話の状態・会話の根拠を取得 | `oathra.phone.status` | `oathra_phone_status` | 自分の通話のみ |
| 発信 | **AIツールなし** | **AIツールなし** | Oathraの認証済み画面で利用者本人 |

**下書き作成のタスク終了 ≠ 発信 ≠ 通話終了 ≠ 予約・購入成立。** `state`と`canonicalStatus`、シミュレーターモード、根拠の限界を保持します。結果はGenieの既存の成果物へMarkdownで出します。

## 含まれる変更

- Oathra：下書き・状態・対応範囲の専用API、依頼の冪等化、本人用の確認画面。
- Oathra：既存3ツールを維持したMCPの拡張。`2025-06-18`と`2025-03-26`のハンドシェイク。
- Genie：Local Agent HostへOathra実行アダプターを登録。
- Genie：取り外し可能な同梱プラグイン、3エージェント、`phone.draft`／`phone.read`の権限表示。
- 本番スキーマ・ポリシーは迂回しません。Oathraの既存の発信、費用、所有者検査を使います。

一般のHome入力から新しい電話意図を自動ルーティングする変更、専用のネイティブTaskDockカード、通話の自動ポーリングや完了プッシュ通知は含みません。まず既存のインストール済みプラグイン・エージェント実行経路へ接続し、状態は明示的に取得します。macOSの画面を起動しての確認は未実施です。

## 1. 適用前に確認

対象は会話中に取得したOathra `feat/gemini-live`系列とGenieの`main`のソースです。正確な対象ファイルのGit blob IDを`docs/BASES.json`と`scripts/edits.json`に固定しています。古いnpm版へ適用するものではありません。

既存のチェックアウトを用意し、作業中の変更を安全に保存してください。適用スクリプトはブランチ操作、commit、push、依存導入、API呼び出しをしません。

```bash
python3 oathra-genie-integration/apply.py \
  --oathra /absolute/path/to/oathra \
  --genie /absolute/path/to/genie \
  --check --diff
```

全対象ファイルと新規ファイルを検査し、差分を表示するだけです。違う版や既存変更が見つかれば停止します。**`Base changed`を無視してハッシュを書き換えたり、ファイル全体を強制上書きしたりしないでください。** 新しいソースで同じ変更を個別レビューする必要があります。

内容を確認した後だけ適用します。

```bash
python3 oathra-genie-integration/apply.py \
  --oathra /absolute/path/to/oathra \
  --genie /absolute/path/to/genie \
  --apply
```

再度実行しても同じ変更を重ねません。途中のエラーではこの処理が書き込んだファイルを戻します。`.env`、DB、音声データ、認証情報は変更しません。両リポジトリで通常のビルドと回帰テストを実行し、差分をレビューしてから稼働環境へ適用してください。このパッケージでは両プロジェクト全体のビルド・既存全テストは実行できていません。

## 2. Gatewayを準備

既存OathraのGatewayセットアップ・認証を使用します。最初はシミュレーター環境で確認してください。新しい公開トンネルや電話番号をこのパッケージが作ることはありません。

既存のGateway起動をやり直すと、`/v1/agent/phone/*`と`/agent-review.html`が利用できます。Gatewayのユーザーと、本人がログインするアカウントは同じものを使用してください。

**Gatewayが提供する音声だけが対象です。現在のGatewayにはArena限定の`character-tts`はありません。非対応指定は拒否し、Liveや別の声へ自動置換しません。** この連携のために音声設定・モデル・演技を変更することもありません。

## 3. Genie Local Agent Hostを設定

利用者本人のGateway接続先とトークンを、Genieのローカルホストの環境または既存SecretStoreへ設定します。モデルのプロンプト、通常のチャット、プラグインmanifestへトークンを書かないでください。

```dotenv
OATHRA_GATEWAY_URL=http://localhost:4244
# OATHRA_GATEWAY_TOKEN は本人のGatewayの既存トークンをローカルに設定。
# または同じホストのSecretStoreに oathra.gateway.token というキーで保存。
```

`OATHRA_GATEWAY_URL`はGatewayの`OATHRA_PUBLIC_URL`と同じoriginにしてください。`localhost`と`127.0.0.1`、異なるポート、リバースプロキシの内側と外側のURLは別originです。Genieは異なるoriginの承認リンクを拒否します。遠隔GatewayではHTTPSが必須です。URLにユーザー名、パスワード、トークン、パスを混ぜることはできません。

既存`ASTRA_GRANTED_SCOPES`を消さず、次の権限を追加します。

```text
com.astra.oathra=phone.draft,phone.read
```

この版ではOAuthによる接続画面は追加していません。Genie側のプラグインインストールの許可と、端末側の実行許可の両方が必要です。ホスト起動時に`OATHRA_GATEWAY_TOKEN`を取り込み、子プロセスのモデルCLIへ継承されないよう環境から除去します。

**これはOathraの新しい制限付きトークンを発行する実装ではありません。** 既存operator/admin資格情報を狭いアダプター内で使用します。同じ資格情報を複数人・複数テナントで共有しないでください。Genie側の利用者切り替え時は対応するホスト設定も切り替え、別のOathra利用者として稼働させない運用が必要です。

Genie API側で同梱プラグインを読み込む通常の起動処理を実行し、`com.astra.oathra`を既存のプラグインインストール操作で追加してください。Local Agent Hostも再起動が必要です。作者の代わりにここで再起動は実行していません。

## 4. Genieから使う

インストール済みOathraプラグインのprepareエージェントを使います。既存タスク実行のkindは次です。

```text
plugin:com.astra.oathra:prepare
plugin:com.astra.oathra:status
plugin:com.astra.oathra:capabilities
```

prepareの`message`に、明示した相手と用件を渡します。電話番号は例示用です。実在する送信先へ置換する前に本人の意図を確認してください。

```text
電話: +12025550123
相手: テスト担当
依頼者: テスト利用者
用件: 来週の打ち合わせ候補を確認してください。
```

同じ`message`へJSONを渡す形式にも対応します。

```json
{
  "phone": "+12025550123",
  "name": "テスト担当",
  "instruction": "候補の日程を確認してください。確定しなければ未確定と伝えてください。",
  "callerName": "テスト利用者",
  "conversationMode": "message",
  "engine": "gemini-live",
  "voicePreset": "guide-female",
  "voice": "Kore"
}
```

不足する項目があれば`needs_input`になり、下書きも発信も行いません。名前から電話番号を勝手に探して補いません。新規LLM呼び出しで曖昧さを解消する機能も追加していません。

Genieが下書きデータの送信の承認を取得すると、Oathraに`DRAFT`が作られ、本人用のreviewUrlと依頼IDが成果物に残ります。**Genieのタスクが完了しても、この時点では未発信**です。

本人がreviewUrlを開き、Gatewayへログインして相手・用件・音声・送信先・保存・費用を確認します。最終のチェックとボタンでのみ既存の発信承認へ進みます。Genieのcomputer useや別AIでこのボタンを代わりに押す運用にはしません。

状態を知るにはstatusエージェントへ依頼IDを渡します。下書き、接続中、通話中、停止要求中、結果未確認などをそのまま表示します。`finished`は予約の成立ではありません。未知の状態や証拠は補完しません。

## 5. 他のAIからMCPで使う

ローカルstdioのMCPサーバーを起動できます。クライアントの環境変数やSecretStoreへ既存Gatewayの資格情報を設定します。

```json
{
  "mcpServers": {
    "oathra": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/oathra/apps/gateway/mcp.mjs"],
      "env": {
        "OATHRA_GATEWAY_URL": "http://localhost:4244",
        "OATHRA_GATEWAY_TOKEN": "<configure locally; never paste into chat>"
      }
    }
  }
}
```

これは一般的なMCPホスト向けの例で、GenieのUIへそのまま取り込める設定ファイルという意味ではありません。Genie用は前述のネイティブLocal Agent Hostアダプターを使います。MCPはstdioと限定ツールのみで、HTTP MCPサーバーやOAuthフローは今回追加していません。

`oathra_phone_draft`には同じ論理依頼で固定の`requestId`を付けます。同じID・同じ内容の再送は同じ下書きを返し、同じIDで別の内容は409になります。結果不明の場合も新しいIDで自動作成し直しません。保持期限は30日です。

既存の`oathra_list`、`oathra_draft`、`oathra_status`も維持しています。旧営業下書きツールは新しい電話下書きと異なり、冪等だとは案内していません。

## 実行した検証と未確認

`TEST_REPORT.json`と`tests/*results*`を参照してください。再実行は以下です。

```bash
node oathra-genie-integration/scripts/test.mjs
python3 oathra-genie-integration/tests/apply_test.py
```

Nodeテストは実際のstdio子プロセスとループバックHTTPを含みますが、接続先はテスト用Gatewayの代役です。実際のOathra DB／既存全ルート、Genie API／Temporal／macOS UIを通した試験ではありません。ブラウザ処理は最小DOMでのJavaScript検証であり、実ブラウザの見た目、スクリーンリーダー、IME等は未確認です。

実回線、実API資格情報、数分の会話、他社MCP製品の画面操作、macOS TaskDock上での一連の操作は未確認です。承認画面へ到達できることを確認しただけで、電話できた・予約できたとは報告しないでください。
