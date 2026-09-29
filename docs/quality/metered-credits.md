# 通話の使用量に基づくクレジット精算

後続の実確認: 利用者の明示依頼で[UIから1回実発信](user-ui-call.md)し、32秒の通話、会話7発話の保存、AI使用量取得を確認。回線料金は未確定のため最終精算は継続確認中。以下は実装時点の検証記録。

ユーザー依頼: 残高不足なら付与し、通話時間と実際のコストに消費を連動させる。既存データと旧料金の履歴は保持する。実発信は利用者の最終操作に限る。

## 実装前の合格条件

| 条件 | 環境・検証 | 期待 | 証拠 |
|---|---|---|---|
| 残高不足解消 | 稼働APIと永続台帳 | 0を確認した場合だけ、固定idempotency-keyで確認用400を付与 | grant.json |
| 発信前の確認 | 実Service/SQLite/ブラウザー | 換算率と最大確保を提示、承認時に確保。実行開始を消費としない | tests / UI |
| 従量精算 | 実SQLite・Adapter境界 | Twilio接続料金・秒数（USD/設定済JPY換算）とOpenAI usageの料金換算。上限内だけ一度消費、残り返却 | tests |
| 不明と復帰 | 欠損・遅延・再起動・重複の限定境界試験 | null/欠測を0としない。精算待ちのまま照会、電話は再実行しない | tests |
| 互換性 | 既存全Gateway試験 | 旧固定料金の保存済み履歴とself-hostedを保持。料金変更前の承認は拒否 | gateway.log |
| 結果表示 | 実Chrome 1280/390px、キーボード | 使用クレジット・時間・内訳・未確定状態を表示 | UI evidence |
| 稼働反映 | 同じenv/DBで再起動 | ログイン・履歴を保持、追加残高と新料金を取得 | runtime.json |

新方式はexperimental `provider-cost-v1`、既存の `call-attempt-v1` は互換維持。初期換算は1credit = 0.01 USD、切上げは合計に一度だけ。承認済み上限を超えた費用は運営者負担。税・番号月額・割引・インフラ等の請求書全体との一致は主張しない。Twilioの接続料金は提供元のCall.price（JPYは承認時固定の換算率でUSDへ換算）、音声AIは実使用量と承認時の単価から計算し、文字起こし・ストリーム費用は運営者が負担する。料金不明は精算待ち。旧通話にはusageがないため後付けの架空精算を行わない。

根幹の課金境界検証だけに、ローカル一時DB/HTTP/WebSocketの制御値を使う。外部発信・架空の本番取引は作らず終了時に破棄。これらを実通話・実請求の検証に置き換えて報告しない。

公式資料: [Twilio Call resource](https://www.twilio.com/docs/voice/api/call-resource)、[Twilio Voice pricing](https://www.twilio.com/en-us/voice/pricing/us)、[GPT-Realtime-1.5](https://developers.openai.com/api/docs/models/gpt-realtime-1.5)。2026-09-20確認。料金は運営者の設定とsnapshotを用い、モデル名から未確認の単価を推測しない。

## 結果

対象はHEAD `f2696fa45439a909a8974f47d679e4bddb63680e` と既存未コミット差分。macOS 26.6.2 arm64 / Node 25.2.1 / pnpm 10.12.2 / Chrome 153。対象ソースのSHA-256は `artifacts/quality/metered-credits/source-sha256.txt`。実行ディレクトリはリポジトリのルート。証拠は以下すべて `artifacts/quality/metered-credits/` 内。

| 判定 | コマンド・測定方法 | exit code / 観測 | 証拠 |
|---|---|---|---|
| PASS | 認証済みGET credits、同じadmin grant APIへ固定idempotency-keyでPOST | 0、残高0→400/確保0。確認用付与であり購入・決済なし | grant.json |
| PASS | `pnpm build` | 0、型検査とbundle成功 | build.log |
| PASS | `pnpm test:gateway` | 0、248件PASS。並行精算・切上げ・二重請求防止・上限・返却・不明価格・認証・旧DB/旧固定方式を含む | gateway.log |
| PASS | `pnpm test` | 0、1013件PASS、既存条件付き1件skip。下記の未実施とは区別 | all-tests.log |
| PASS | `node --test apps/gateway/test/metered.node.mjs apps/gateway/test/credits.node.mjs` | 0、最終23件PASS。terminal保存後/finally前のクラッシュも復帰 | final-accounting.log |
| PASS | 実装担当と別エージェントによる独立レビュー・試験 | 最終課金14件PASS、音声Provider9件PASS、復帰probe3件。各exit0。古いpending/同期再入/sales表示の指摘を修正し再確認 | independent.md、independent-*.log/json |
| PASS | `node scripts/ui/metered-credits.mjs` | 0、実Chrome/SQLite/APIで400確保→精算待ち→3消費/397返却、秒数/内訳/残高一致。1280/390px・キーボード・200%CSS拡大・reduced motion、例外なし | ui.log / ui.json / confirmation.png / pending.png / settled-*.png |
| PASS | `UI_EVIDENCE_DIR=artifacts/quality/metered-credits/legacy-ui node scripts/ui/managed-phone.mjs` | 0、旧固定料金の承認/取消/消費表示・保存・認証のUI回帰 | legacy-ui.log / legacy-ui/ |
| PASS | `node --env-file=.oathra/managed-preview/.env.managed artifacts/quality/metered-credits/verify-provider-records.mjs` | 0、既存の実Twilio通話はcompleted/25秒/JPY。別の保存済み実OpenAI応答usageの変換を確認。両者を同じ通話の請求として合算しない | provider-records.json |
| PASS | `node artifacts/quality/metered-credits/configure-runtime.mjs`、同じenv/DBで再起動 | 0、日次件数/金額は利用者指定で0（制限なし）。1回60秒/最大4 USD維持。停止0、PID30434で待受継続、常駐終了code未確定 | before-runtime.json、起動出力 |
| PASS | `node artifacts/quality/metered-credits/verify-runtime.mjs` | 0、公開実画面は400credit/電話する、liveReady=true。ログイン設定・連絡先・既存履歴3件のhash一致、旧消費1を保持。公開health200/未認証API401 | runtime.json / live-ready.png |
| BLOCKED | 新方式による実回線→最終費用→消費の一貫照合 | 新しい実発信は行っていない。既存通話のTwilio priceはnull、旧通話のAI usageは保存前のため遡及精算しない。未実施を実回線PASSにしない | provider-records.json / runtime.json |
| BLOCKED | LiveKitの実資格情報によるoutbound trunks照会 | 既存の `skipIf(!LIVE)`。今回のTwilio経路と別であり未実施、テストのskip条件は変更なし | all-tests.log |
| BLOCKED | 実OSの日本語IME・実ユーザー評価 | 今回の数値/状態表示の変更では実施していない | この記録 |
| NOT_APPLICABLE | ネイティブ、購入決済、税・月額等の全請求書照合 | Web/Gateway/APIの従量計算が対象。購入や請求書連携は実装対象外 | READMEの対応範囲 |

実サービスのTwilio通貨はJPYだったため、FXを設定した。2026-09-18の[ECB参照値](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)は1 EUR = 1.1460 USD / 180.94 JPY、そこから1 USD = 157.888307 JPYと算出してサービスの換算基準として保存。決済の実為替手数料ではない。換算率・基準日を電話画面、営業画面、チャネルの承認文へ表示し、通話ごとのsnapshotを精算時にも使う。

3ラウンド以内で実装、独立レビュー指摘修正、実サービス通貨への対応を実施した。外部回線へ再発信、購入・決済、既存履歴の再課金、push/mergeは実施していない。
