# 通話終了時の使用量精算

対象: Gateway managed、`provider-cost-v1` の opt-in `usage-rate-v1`。旧請求額待ちと固定クレジット契約は維持する。主要タスクは、電話終了後に使用量に連動する消費と残高、回線・音声AI・検索の内訳を確認すること。

## 先に固定する合格条件

環境: macOS / Node 25 / pnpm 10 / Chromium。実サービスの既存32秒通話、実Twilio料金API、実SQLite、ローカルGatewayとChromeを使用。根幹の請求境界・異常系のみ最小限のローカルプロトコルfixtureを許可し、実通話と区別、一時DBは削除する。再発信はしない。

| 条件 | 期待結果 | 検証・証拠 |
|---|---|---|
| 通話終了時の精算 | Call.priceがnullでも、取得済み使用量×承認時単価で精算、余剰返却 | Worker終了処理、実通話保存記録、`artifacts/quality/usage-cost/` |
| 使用量への連動 | 回線の課金単位、音声のキャッシュ別tokens、検索回数とResponses tokensを整数計算 | 数学境界テスト・実API料金照会 |
| 永続性・重複排除 | 同一response/終了通知/再起動で二重消費しない。承認上限超過なし | SQLite統合・既存並行プロセス試験 |
| 費用の透明性 | 消費と返却、実モデル名、各費目と算定単価が履歴にも残る。「暫定」のバッジなし | Desktop/390px、キーボード、200%表示、保存値と照合 |
| 異常処理 | 発信結果不明は再発信せず照会。失われたAI/検索使用量を計測済み0と偽らない | 欠落・中断・重複・単価変更テスト |
| 互換性 | 旧精算方法は明示的移行以外変更しない | 既存metered/credits/Gatewayテスト |

## 契約・費用の扱い

`usage-rate-v1` は提供者の請求確定を待たず、承認時に保存した単価と観測量をサービスの利用額として固定する。後日届く請求との差額は運営者が負担し、自動で追加徴収しない。これにより終了直後の残高が後から黙って減らない。税・月額番号・インフラ等は運営者負担。欠落した使用量は内部記録で区別し、取得できた費目だけで精算する（欠落分は運営者負担）。終了自体が不明なら精算待ちを維持する。

単価はサーバーで検証し、番号prefixの最長一致で回線単価を選び、発信承認に結び付ける。未設定の宛先には発信できない。使用量イベントはAdapterからCoreへ、UIはサーバーの計算結果を表示する。クレジットは合計USDを1credit単価で一度だけ切り上げ、確保額以下に制限する。

資料: [Twilio料金API](https://www.twilio.com/docs/voice/pricing)、[課金時間の丸め](https://help.twilio.com/articles/223132307-How-do-you-round-minutes-for-billing-)、[OpenAI検索料金](https://developers.openai.com/api/docs/pricing)、[検索モデル](https://developers.openai.com/api/docs/models/gpt-5.4-mini)。現在の音声はgpt-realtime-1.5。GPT-Liveの秒課金と委譲モデルは別契約なので本変更でモデルを切り替えない。

## 検証結果

対象: `f2696fa45439a909a8974f47d679e4bddb63680e` + 未コミット差分（最終ファイル指紋は `artifacts/quality/usage-cost/source-sha256.json`）。2026-09-20 JST、macOS 26.6.2 arm64、Node 25.2.1、pnpm 10.12.2、Chromeの実版は live-ui.json。既存変更を保持しpush/mergeなし。

| 判定 | 実行コマンド / 方法 | exit code | 観測 / 証拠 |
|---|---|---|---|
| PASS | `pnpm build` | 0 | build.log |
| PASS | `pnpm typecheck` | 0 | typecheck.log |
| PASS | `node --test apps/gateway/test/*.node.mjs` | 0 | 260件、gateway-tests.log |
| PASS | `node --test apps/gateway/test/usage-cost.node.mjs apps/gateway/test/metered.node.mjs apps/gateway/test/credits.node.mjs` | 0 | 最終会計35件、accounting-tests-final.log |
| PASS | `pnpm exec vitest run providers/openai-realtime/src/news.test.ts providers/openai-realtime/src/usage.test.ts providers/openai-realtime/src/realtime-recovery.test.ts` | 0 | 18件、provider-tests.log |
| PASS | `node scripts/ui/usage-cost.mjs` | 0 | 価格nullでも終了時23消費/377返却。再読込・履歴内訳・390px/1280px・キーボード・reduced motion・CSS 200%、ui-final.log / ui.json / PNG |
| PASS | `node scripts/ui/metered-credits.mjs` | 0 | 旧請求額待ち契約を維持、ui-legacy.log |
| PASS | 実Twilio料金API GET `/v2/Voice/Countries/JP` | 0 | アカウントのJPY建てprefix料金、carrier-rates.json |
| PASS | `node --env-file=.oathra/managed-preview/.env.managed artifacts/quality/usage-cost/check-news.mjs` | 0 | 公開分類のみを1要求。9268入力/491出力tokens、2内部検索。算術$0.0291605、news-usage.json。PSTNなし |
| PASS | 既存32秒通話をバックアップ後に明示的移行・一度だけ精算 | 0 | 回線$0.189113060、音声$0.037736、検索0回。合計$0.226849060 → 23消費、377返却。live-settlement.json |
| PASS | `node --env-file=.oathra/managed-preview/.env.managed artifacts/quality/usage-cost/live-ui.mjs` | 0 | 再起動した実サービスの画面と保存レシートを照合。23消費/377残高、履歴数4のまま、live-ui.log / live-ui.json / live-mobile.png |
| PASS | 別agentで独立検証 | 0 | 終了POST遅延、既知終話/既知拒否の再起動不具合を指摘・修正後再現でPASS。independent.md |
| BLOCKED | 新規PSTN・人間との通話で追加検証 | — | 今回は追加発信の指示なし。既存通話と実使用量・実価格の照合に限定 |
| BLOCKED | Twilio最終請求書と照合 | — | 前回Call.priceはnull。サービス利用額は単価×使用量で固定、提供者請求額と同一とは主張しない |
| BLOCKED | 実ユーザー評価・日本語IME・ネイティブ200%ブラウザー拡大 | — | 人間評価/該当手操作未実施。CSS 200%試験で代用PASSにしない |
| NOT_APPLICABLE | ネイティブOS別試験 | — | 対象はWeb Gateway |

### 運用へ反映した範囲

既存の公開トンネルと保存DB/認証を維持してローカルGatewayを再起動。`OATHRA_SETTLEMENT_MODE=usage-rate-v1` と確認済み日本向け料金表を設定し、日次上限なし・通話60秒・最大確保400creditは維持。日本外の宛先は料金表の追加が必要。秘密とDBのバックアップはgit対象外の `.oathra/managed-preview/backups/` に0600で保管。

ユーザーの今回の指示に基づき、既存の保留通話1件だけを新方式へ移行。元creditQuoteは暗号化recordの `billing.previousCreditQuote` とバックアップへ保持し、audit `credits.usage_rate_migration` を記録。旧1credit固定通話・他の依頼は変更しない。旧通話はMedia Streams時間を記録していなかったため、その費用は運営者負担（excludedに記録しUIでも明記）。新しい通話は中継時間を計測して算入する。クレジットの追加付与、新しいPSTN発信はなし。

検索APIは `max_tool_calls:1` 指定でも実応答に2個のweb_search_callがあったため、要求数を費用へ誤用せず応答に含まれる実呼出数で算定する回帰試験を追加した。

### 修正ラウンド

1. 使用量精算、単価snapshot、検索量収集、費用UI、既存保留契約との互換性を実装。
2. 独立検証で停止API待機の過大時間、2種類の再起動保留、旧UIの負担説明を修正。実APIの複数検索も算定。
3. 実保存通話への適用・再起動・実UI照合、長い単価詳細の折りたたみと未取得中継費の運営者負担表示。
