# 実電話の有効化記録（2026-09-20）

冒頭案内の後続変更: 利用者の指定により数字1の操作待ちを廃止し、一文の記録案内から自動接続する実装へ変更・再起動済み。[最新の開始案内と検証](call-opening.md)。以下の「1」入力は変更前の履歴を指す。

接続設定: **PASS — 更新済みキーで認証・実音声応答を確認し、サービスへ反映済み。liveReady=true、発信設定の不足なし。** 有効化時点で公開HTTPSの実画面に「発信設定済み」「電話する」「1 クレジット」を確認した。ユーザーは2026-09-20に一時HTTPS公開・外部API利用・初期1クレジットを明示承認済み。承認の再確認は不要。

後続の実回線試験: **FAIL — 01:53 JSTに利用者が発信し、相手の同意・音声接続・双方の文字起こしまで到達した後にruntime_errorで終了。** 消費1credit、残高0。割込み処理の不具合と診断欠落を修正し、実APIで次の応答まで継続することを確認した。[修正後の最新記録](realtime-recovery.md)。修正版の実回線再発信は未実施。以下は当初の有効化時点の履歴であり、過去の未実施・残高表示を現在値として扱わない。

## 実施済み

既存 `.env` のTwilio Account SID/Auth Token/発信元番号/OpenAI API Keyを、サービスの非公開環境ファイルへローカルで読み込んだ。既存キーの値をログに出さず、利用者設定・DB・暗号鍵を保持した。更新前ファイルを同じ非公開ディレクトリに0600でバックアップし、変更後も0600を維持している。認証情報の有効性・アカウント権限は提供元へ未照会。

音声モデルを `gpt-realtime-1.5`、既存のRealtime adapterと接続する案で準備。モデル名とAPI種別は [OpenAI公式モデル仕様](https://developers.openai.com/api/docs/models/gpt-realtime-1.5) で確認した。契約アカウントでの利用可否は外部接続の承認後に確認する。自動的に別モデルへ切り替えない。

実行環境はsimulatorのまま、最大60秒・1日1回、クレジット単価1を保持して準備した。`OATHRA_LIVE_POLICY_REVIEWED=false` を勝手にtrueにしていない。falseが未設定一覧から抜ける表示上の原因をserverのconfigurationで修正した。localhost:4245を同じ利用者/DBで再起動し、既存メールログインと下書き1件、残高0を保持した。台帳付与・実発信・公開接続・外部APIの照会はまだ行っていない。

## 確認する有効化案

- 既設cloudflaredによる一時HTTPS接続。ログイン画面は外部から到達でき、履歴・連絡先・残高は既存認証で保護する。HTTPS画面で再ログインし、同じownerと保存データを使う。固定ドメインの商用公開ではない。
- Twilio/OpenAIの資格情報・発信元・モデルの利用可否を確認し、ユーザーが画面で最終確認した電話だけを実行する。既存の下書きは自動実行しない。
- 相手には「OathraのAIアシスタント」と、文字起こしを保存・依頼者に共有する旨を説明。現行実装では相手が1を押した場合に音声AIを開始する。
- 最初は1回60秒・1日1回、依頼者に確認用1クレジットを付与（まだ未付与）。内部の費用見積予約枠は1回/1日4米ドル、単価仮定1米ドル/分、既存の切上げと2回線分を見込む計算。これは提供元の実請求額に対する強制上限でも、1クレジットの販売価格でもない。実通話/音声AI料金は利用するAPI契約へ発生する。
- 電話番号/音声/文字起こしはTwilio/OpenAIへ、HTTPS中継はCloudflareを通る。公開接続と外部API利用の承認後に有効化し、自動テストで相手へ電話をかけない。

[Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams) は公開された安全なWebSocket接続を必要とする。[Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) は一時的な検証用でSSE非対応。今回のmanaged電話画面はGET pollingを使うため、SSEを使う営業画面まで動作保証しない。正式サービスの公開には別途固定接続と運用検証が必要。

## 検証記録

HEAD `f2696fa45439a909a8974f47d679e4bddb63680e` と既存未コミット差分。macOS26.6.2 arm64 / Node25.2.1 / pnpm10.12.2。今回のソース変更は `apps/gateway/server.mjs` の未確認policy検出のみ。証拠は `artifacts/quality/live-activation/`。

| 判定 | 方法と期待 | 観測・exit code | 証拠 |
|---|---|---|---|
| PASS | 実ローカルenv読込、秘密値を出さず資格情報4項目を配置 | ローカルコピーのみ、simulator維持、0 | local-preparation.json |
| PASS | 実envをconfigurationで解析しfalseのpolicyを未設定表示、時間/件数の制限を照合 | false/1日1回/60秒、0 | policy-check.log |
| PASS | `node apps/gateway/test/runtime-smoke.mjs`、既存ランタイムとWebSocket依存をimport | 0、通信なし。既存試験内のダミー契約はimport試験に限定し実発信証拠にしない | runtime-smoke.log |
| PASS | `pnpm test:gateway`、既存APIと認証の回帰 | 224 PASS / 0 FAIL、0 | gateway.log |
| PASS | 起動中localhostの認証済みGET status/bootstrap/history | HTTP200、鍵/モデル未設定の表示が解消、未確認policyは表示、ログイン設定あり/下書き1/残高0/通話0、0 | runtime-check.json |
| BLOCKED | 外部認証・公開HTTPS/WebSocket到達・実回線 | 最初のユーザー指定で別途許可が必要。未実施 | この記録 |
| NOT_APPLICABLE | UI配置の変更・新規デザイン | この作業は接続設定。画面配置の変更なし | serverの1行修正のみ |


## 許可後の実接続確認（2026-09-20）

ユーザーの「利用許可を出します」を受けて、上記の一時公開案と外部APIの認証照会を実行した。期限切れの認証情報を有効扱いせず、サーバーで発信不可を維持した。ソースコード変更はこの段階ではない。

| 判定 | 実行・期待 | 観測・終了 | 証拠 |
|---|---|---|---|
| PASS | Node fetchでTwilio Account / IncomingPhoneNumbersをGET。発信元のvoice利用可否を照合 | HTTP200、account active / Full、設定済み発信元の完全一致、voice=true | provider-readiness.json |
| BLOCKED | 同じ事前確認でOpenAI `GET /v1/models/gpt-realtime-1.5` | HTTP401 / expired_secret_key。全体preflightはexit2。モデルの利用可否は認証前で未確認 | provider-readiness.json |
| PASS | `cloudflared tunnel --url http://127.0.0.1:4245 --no-autoupdate` | 一時HTTPSの公開を開始。プロセスは稼働継続、exit code未確定 | 非公開 `.oathra/managed-preview/tunnel.log`、public-connectivity.json |
| PASS | 公開URLからGET health / 未認証bootstrap | 200 / 401。ログインなしで個人データへアクセスできない。Node検証exit0 | public-connectivity.json |
| PASS | ユーザー承認に従い運営者名Oathra / policy=true / public HTTPSを設定、既知の期限切れOPENAI_API_KEYを空にして再起動 | mode=live、liveReady=false、未設定は音声AI認証だけ。既存下書き1件・パスワード設定保持 | credit-and-runtime.json |
| PASS | 既存の管理者付与APIへ1クレジット、固定idempotency-keyでPOST | HTTP200、available1 / held0。再実行しても同じ付与を増やさない | credit-and-runtime.json |
| PASS | 公開HTTPSでBearer→Cookie発行→bootstrap→他OriginのPOST拒否→試験Cookie logout | Secure / __Host / HttpOnly / SameSite=Strict。200 / 403、残高1、同ownerのメール設定あり、exit0 | https-auth.json |
| BLOCKED | 有効なOpenAIキー、実音声セッション、Twilio Media Stream、実際の友人への通話 | キー更新が必要。電話はユーザーの最終確認後であり、今回勝手にかけていない | startedCalls=0、上記キー拒否 |

新しい接続先: （非公開のローカル運用記録で管理する一時HTTPS URL） 。公開HTTPS画面をCodexに表示予約済み。localhostのセッションは転送せず、同じメールとパスワードで再ログインする。トンネルはこのMacのプロセスに依存する一時URL。

更新方法: リポジトリの `.env` の `OPENAI_API_KEY` を有効なキーへ更新してもらい、値をチャットに貼らず更新済みと知らせてもらう。承認範囲内で新しいキーを認証照会し、成功後だけmanaged環境へ反映し再起動する。現時点では `.env`・対象repo内の `.env.local/.env.gateway/.env.development`・実行シェルに別の有効候補は見つからなかった。他のrepoの秘密情報は検索しない。期限切れキーはユーザーの元 `.env` と非公開バックアップに残し、勝手に削除しない。

前段の公開接続に関するBLOCKEDはこの明示許可と実確認で解消。外部音声・実回線のBLOCKEDはキー更新と実試験が済むまで継続する。1クレジット付与は販売/決済ではなく、明示承認済みの確認用付与。消費0、実発信0。メール送信・第三者への通知・git push/mergeは行っていない。


## キー更新後の再確認（2026-09-20 01:23–01:25 JST）

ユーザーの「更新しました」を受け、`.env` の更新済み値を直接読み込み再検証した。前回の期限切れエラーとは異なり、現在の提供元の応答は `invalid_api_key`。サーバーへの反映は認証成功後に限るため、managed側は発信不可を維持する。新しいユーザー入力を勝手に削除・修正していない。

| 判定 | 実施 | 観測・exit code | 証拠 |
|---|---|---|---|
| BLOCKED | `GET https://api.openai.com/v1/models/gpt-realtime-1.5` を更新済みキーで認証 | HTTP401 / invalid_api_key、2 | updated-provider-readiness.json |
| BLOCKED | 実OpenAI Realtime WebSocketで同モデルの接続を試行 | invalid_api_key、ready=false、2。音声入力・生成要求なし | updated-realtime-handshake.json |
| PASS | 対象repoのenv候補とキー周辺書式を秘密値なしで確認 | `.env` に1定義、重複なし、余分な空白/内側の引用符/代入文混入/想定外文字なし、0。有効性は文字形式から判断しない | 実行ツールの非秘密診断 |
| PASS | 現公開URL `/healthz` | HTTPS200、mode=live。live mode設定とliveReadyは別であり、音声認証がない限り発信不可 | 実行ツールのhealth結果 |

[OpenAIの公式認証エラー案内](https://help.openai.com/en/articles/6882433-incorrect-api-key-provided) も照合。キーはチャットに要求せず、[APIキー管理](https://platform.openai.com/api-keys) で新規発行した完全な秘密キーをローカル `.env` へ再設定してもらう。[秘密キー全文は作成時だけ表示される](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key)。追加の公開/外部利用許可は要求しない。認証が通るまで、実発信・クレジット消費・音声送信は行わない。

## 有効化完了（2026-09-20 01:29–01:36 JST）

更新されたローカル `.env` のキーで実認証とRealtimeの音声応答が成功した。同じキーだけを `.oathra/managed-preview/.env.managed` へ反映し、0600の非公開バックアップを作成。利用者・DB・暗号鍵・パスワード・制限値を保持してGatewayを再起動した。ソースコードの追加変更はなく、今回の追加物は検証スクリプト・証拠・この記録である。

対象はHEAD `f2696fa45439a909a8974f47d679e4bddb63680e` と既存未コミット差分。macOS26.6.2 arm64 / Node25.2.1、実ブラウザーはHeadless Chrome153。検証ソースの識別情報は `artifacts/quality/live-activation/source-sha256.txt`。

| 判定 | コマンド・期待 | 観測・exit code | 証拠（artifacts/quality/live-activation/） |
|---|---|---|---|
| PASS | `node --input-type=module` のfetchで `/v1/models/gpt-realtime-1.5`、新しいキーで認証 | HTTP200、同モデル返却、0 | latest-provider-readiness.json |
| PASS | Node WebSocketでOpenAI Realtimeへ接続し、本番Adapterと同じPCMU形式・marin音声で短い接続確認を生成 | session.updated、response.completed、音声15,200bytes、73tokens、0。電話番号・目的・入力音声は送信していない | latest-realtime-preflight.json |
| PASS | Node `parseEnv` と `configuration` で更新対象を照合し秘密値を表示せず反映 | liveReady=true、missing=[]、60秒・1日1回・1credit、DB/利用者保持、0 | activation-config.json |
| PASS | `kill -TERM 14640` 後、`node --env-file=.oathra/managed-preview/.env.managed apps/gateway/server.mjs` | 停止0、再起動してliveで待受継続。常駐プロセスの終了コードは未確定 | 実行ツールの起動出力、activated-runtime.json |
| PASS | Node fetchで認証済みstatus/bootstrap/historyと公開health・未認証API・署名なしcallbackを照合 | liveReady=true、残高1/確保0、既存draft1件。公開health200、非公開API401、署名なしcallback401、0 | activated-runtime.json |
| PASS | `node artifacts/quality/live-activation/verify-activated-ui.mjs` で公開HTTPSを実Chromeで開く | 電話番号・相手・目的が表示、発信設定済み、操作可能な「電話する」、1credit。1280px/390pxで横あふれなし、JS例外なし、0 | activated-ui.json、activated-desktop.png、activated-mobile.png |
| BLOCKED | Twilio実着信・相手の1入力・双方向音声・実通話後の文字起こしとクレジット消費の照合 | ユーザーによる最終発信操作が未実施。通話の実行・成果物・消費を確認済みとは扱わない | 保存状態はdraft1件、消費なし |
| NOT_APPLICABLE | 今回の設定反映に対するレイアウト変更・新規ビルド | 既存ビルドを使用。画面/Adapterのコード変更なし。前段のビルドや試験結果を今回の実通話成功の根拠にしない | 上記ソース識別情報 |

最初の設定反映スクリプトは公開履歴APIのフィールドを内部の `status` と取り違え、assertでexit1となった。変更前に停止しており、公開契約の `state: 'draft'` を照合するよう修正後にexit0。通話が存在しないという期待条件は変えていない。

UI確認は既存管理者の資格情報から専用のHttpOnlyセッションを発行して行い、確認後にそのセッションだけログアウトした。利用者のパスワードは読取・変更していない。番号や目的を入力せず、発信ボタンも押していない。履歴を閉じた状態で撮影し、保存された個人情報は証拠画像に含めていない。APIキーはログ・文書・画像へ保存していない。音声生成の実API使用量は上記メタデータに記録し、アプリのクレジット消費とは区別する。

利用先は （非公開のローカル運用記録で管理する一時HTTPS URL） 。同じメールとパスワードでログインし、電話番号・相手・目的を入力して「電話する」→「同意して電話する · 1 クレジット」。相手がAI代理と文字起こし保存の案内後に1を押すと会話が始まる。現在は最大60秒、1日1回。この一時URLはMac上のGatewayとトンネルの稼働に依存する。
