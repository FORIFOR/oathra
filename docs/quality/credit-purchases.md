# クレジット購入の契約と検証状態

2026-10-01 / 実装: `apps/gateway/lib/purchases.mjs` / Stripe REST API `2025-02-24.acacia`。
この記録は新しい購入adapterの範囲を示す。実決済、Webhook到達、購入者の残高反映が本番で成功した証拠ではない。

## 入出力

`new Purchases(service, env)` は既存の暗号化SQLite StoreとCredits台帳を使用する。

- `await status()` は `{enabled,provider:'stripe',live,packs,reason?}`。各packは `{id,name,credits,amount,currency}`。`amount` はStripe Priceの最小通貨単位の整数であり、円・ドル等への表示変換は画面の役割。
- `await checkout(user,{packId,amount,currency,credits},idempotencyKey)` は公開注文を返す。`amount/currency/credits` は利用者に表示済みの購入条件との一致確認にだけ使う。`credits` は1〜1,000,000,000の整数を必須とし、付与クレジット・価格IDはサーバー設定から決定する。金額が同じでも付与数量が表示後に変更されていれば、再確認するまで購入を受け付けない。既存の冪等キーと競合した要求でも数量を含めて照合する。キーは8〜128文字の英数字・`_`・`-`。
- `await reconcile(user,orderId)` は本人の注文のみStripeに照会する。公開注文と、残高付与が確認できた場合は `balance` を返す。
- `history(user)` は本人の新しい順の注文を最大100件返す。
- `await webhook(rawBuffer,stripeSignatureHeader)` は未変更の本文bytesと署名を受け取る。ブラウザ認証やCSRFではなくStripe署名で認証し、サーバーはJSONパースの前にこのメソッドへ渡す。bodyは最大1 MB。

公開注文は `{id,status,packId,credits,amount,currency,createdAt,updatedAt,checkoutUrl?,creditedAt?,reviewRequired?}`。時刻はUnixミリ秒。`checkoutUrl` はStripeの有効なOPEN注文だけに含む。

| status | 意味 |
| --- | --- |
| CREATING | ローカルに注文を保存し、Checkoutの受付結果を待っている |
| OPEN | Stripe支払いページを再開できる |
| PENDING | Checkout終了後、支払いがまだ確認できない |
| PAID | Stripeのpaidと決済内容を照合し、既存台帳にクレジット付与済み |
| EXPIRED | StripeがCheckoutの期限切れを確認した |
| UNKNOWN | Checkout作成の結果が未確認。同一注文の照会・再送で回復する |
| BLOCKED | 返金・異議申立・内容不一致・付与不能のため運営による照合が必要 |

成功と取消の戻り先はそれぞれ `OATHRA_PUBLIC_URL/?purchase=<orderId>` と同URLの `&cancelled=1`。URL・ブラウザからの成功申告だけで `PAID` にしない。UNKNOWNにcheckoutUrlがない場合も注文IDを利用者に返し、別の購入を促さない。

## 運営設定

秘密をログ・画面・リポジトリへ出さず、実環境へ以下を設定する。

| 設定 | 条件 |
| --- | --- |
| STRIPE_SECRET_KEY | 実アカウントのlive secret/restricted key。Price/Product/Session/PaymentIntent/Chargeの読取とCheckout作成権限 |
| STRIPE_WEBHOOK_SECRET | 該当公開エンドポイントの署名秘密。CLIの別endpointの秘密と混同しない |
| OATHRA_CREDIT_PACKS_JSON | 実際に用意したpack配列。各要素にid、priceId、正の整数credits、任意name。最大10pack |
| OATHRA_COMMERCE_URL | 運営者が確認して公開した販売条件・返品/返金条件のHTTPSページ |
| OATHRA_SUPPORT_URL | 運営者が応答できるサポートのHTTPSページ |
| 既存gateway設定 | managed / live / liveReadyとHTTPSのpublicUrlが必要 |

設定不足・Price読取失敗時は購入を表示せず `enabled:false` にする。Priceはactive・live・one_time・per_unit・固定整数価格・active Productのみ受け付ける。価格一覧は最大60秒キャッシュし、新規Checkout開始時はPriceを再読する。カードのみ・数量1・割引なし・自動税計算なし・通貨自動換算なし。販売価格が最終請求額となるよう、税の扱いを含めて運営者がPriceと販売条件を設定する。税務・法務適合をこのコードの存在から認定しない。

制限付きプレリリースが有効かつ一時停止中（`config.prerelease.enabled && config.prerelease.paused`）なら、公開状態は `enabled:false / reason:prerelease_paused` とし、新規CheckoutとSession未確定注文の自動再作成を停止する。Sessionが既知の購入照合と署名付きWebhook処理は継続し、停止前に支払われた購入の付与・返金確認を妨げない。

運用診断の `inspectPrices({ refresh:true })` は受付状態と独立した読取専用検査で、同じPrice/Product条件を使って実Stripe設定を確認する。公開APIには追加しない。`public-service-check.mjs --online` は一時停止中でもこの検査を実行し、価格検証の `stripe_prices` と受付可否の `purchase_admission` を別々に記録する。価格検証の成功だけでは受付を開かない。診断のAccount GETにも購入adapterと共通の固定API版を使い、読取権限が足りなければBLOCKEDとしてDashboard確認に残す。この診断のためだけに鍵の権限を広げない。

Webhookは自アカウントのsnapshot eventsを `POST /webhooks/stripe` へ配信する。Connect account events・test modeは処理しない。

購読するイベント:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`
- `refund.created`
- `refund.updated`

## 付与・障害回復の境界

注文・ユーザー・pack・credits・amount・currency・サービスorigin識別をStripe metadataと照合する。Sessionの金額・通貨・1行のPrice・数量も照合し、paidの場合はPaymentIntentのsucceededと受取額、Chargeの成功・captured・非返金・非紛争を確認する。

重複event IDはSQLiteへ保存し、Session/PaymentIntentとローカル注文の対応に一意制約を設ける。既存 `Credits.grant()` のreferenceを `stripe:<sessionId>` に固定するため、Webhookとブラウザ照会が並行しても二重付与しない。grant完了後・注文表示状態の保存前にプロセスが停止した場合も同referenceで照合して復帰する。

Checkout要求はネットワーク送信前に保存する。通信エラーはUNKNOWNとして残し、同じ注文IDから同じStripe冪等キー・同じ要求を再送する。Stripeが24時間後にキーを破棄しうるため、23時間以上経った未確認注文の自動再作成は禁止する。未完了注文がある間、異なるキーによる追加購入は拒否する。

23時間以上のUNKNOWNは運営者がStripe Dashboardで `oathra_order` のmetadataを照合し、既存Sessionのイベントを再送して回復する。決済が存在しないと確認できるまで新しい購入を作らない。確実な未成立の確認と注文解除の運営操作は別途監査対象であり、このadapterには無条件リセットAPIを設けていない。

refund/dispute通知は注文をBLOCKEDにし、accountの `purchaseBlocked` を永続化する。部分返金・返金処理中・紛争解決通知も運営確認まで停止を維持する。既に使ったクレジットを無理に減算せず、残高を負にしない。新規発信の実行側でもこのaccount停止を検査する。未使用残高の調整、返金額、紛争判断、停止解除は運営者の照合が必要であり、自動返金・自動解除は未対応。受信不能期間と即時発信の間の競合までなくす保証はない。

実運用ではHTTPS endpoint到達性・Stripe delivery失敗の監視・DB/暗号鍵のバックアップと復元・返金問い合わせ対応を用意する。SQLite単一ノードの設計であり、多拠点の同時書込み運用は対象外。

## 今回の証拠

実行環境: macOS / Node v25.2.1。

- PASS: `node --check apps/gateway/lib/purchases.mjs` / exit 0。構文確認のみ。
- PASS: 実在する `purchases.mjs` と `credits.mjs` のbytesを用いた署名境界9件 / exit 0。実行時に生成した暗号鍵で現時刻のHMACを計算し、正しい署名、別bytes、過去/未来301秒、v0、重複timestamp、欠落秘密/署名、Buffer以外の拒否を確認。Stripeイベントを模造したものではなく、Webhook配信・決済の成功証拠ではない。
- 対象SHA-256（上記実行時）: `cbedb4c6ceab750d9207f79e1a673fdd9eb43aa652908c5011b282d82c1721c2`。
- PASS（独立静的レビュー）: `/root/distribution_rules` が非同期応答の順序逆転を指摘。注文ごとのGET直列化と、遅延create失敗による既知Sessionの上書き防止を実装し、再レビューで指摘解消を確認。後続Webhookは先行GETの結果を共有せず、新しいGETで状態を取得する。実Stripeの並行配送を実行した証拠ではない。
- BLOCKED: 実Price読取、実Checkoutの作成と決済、Stripeからの実Webhook、実購入者の残高反映、実イベントの重複再送・返金/紛争。実環境のStripe設定が未提供のため未実行。
- 実決済、実電話、テストカード、架空イベント、モックfetchは実行していない。純粋な境界確認を行った場合も本番決済成功とは別に記録する。

2026-10-02の追加変更: 表示済み数量とサーバー数量の一致確認、およびプレリリース一時停止中の購入受付停止を追加した。`node --check apps/gateway/lib/purchases.mjs` と対象ファイルの `git diff --check` はexit 0。入力境界・保存済み注文・競合注文の3箇所で数量を照合し、既知Sessionの照合とWebhookは一時停止判定に依存しないことをソースで確認した。この時点のSHA-256は `fc29d316e25460cf6447f206ea35b9ee99cd817a3abd504e2ae2e8a9dcd89ddc`。変更後の実決済・再起動をまたぐ購入条件変更・停止中の実Webhookは未検証。

2026-10-02の診断分離: 上記2つのソースの `node --check` はexit 0。実managed環境のStripe未設定を秘密非表示で確認し、空設定の価格検査拒否・公開状態拒否・直接requestの事前拒否・一時停止優先・診断と受付理由の分離・記録未作成・固定API版・local checker出力の8項目を検証した（exit 0）。受付制御だけを一時停止にした空のメモリDBを用い、利用者・Price・決済イベントは作成していない。独立静的レビューで公開受付の迂回につながる新規P1/P2は未検出。実キーと承認済みPriceが未設定のため、停止中の実Price検証成功とAccount GETはBLOCKED。ソースSHA-256は `purchases.mjs:9a16b3a6b9f855f101167d39e9f7dc4e5195d8cff1f7d17e6ed3d112d9d01943`、`public-service-check.mjs:01931a91eea47b63ee3f48b2ed6cf807c7683c400a64771e2e3a86ca944444b5`。

参照した一次資料（2026-10-01）: [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)、[Webhookの署名・順序・重複](https://docs.stripe.com/webhooks)、[冪等キーの有効期間](https://docs.stripe.com/api/idempotent_requests)、[Price取得](https://docs.stripe.com/api/prices/retrieve)、[Session取得](https://docs.stripe.com/api/checkout/sessions/retrieve)、[固定版のCheckout作成パラメーター](https://github.com/stripe/stripe-node/blob/v17.7.0/types/Checkout/SessionsResource.d.ts)。
