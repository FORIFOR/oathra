# 一般向け電話サービスの公開準備と検証

2026-10-02 JST（検証ログはUTC） / 基点 `db56271` と未コミットの追加実装。

**公開判定: BLOCKED。** 公開登録・メール確認・パスワード回復・Stripeクレジット購入の実装を追加した。固定ドメイン、常設サーバー、運営者の販売設定、実メール、実決済は未設定・未検証であり、一般公開が完了した状態ではない。

2026-10-02 JST の追加 UI 改善では、公開サイト・ログ検証・Gateway の入口・AI 連携画面を実ブラウザで反復確認した。[画面・操作・独立レビューの品質記録](award-craft.md)を参照。下記の初回検証後に狭幅の入口確認と OAuth 回帰も実施済みだが、実 Stripe・メール・公式 AI クライアント・実電話の公開受け入れ条件は引き続き未完了。

同日の「アプリ全体を対象にする」という追加依頼に基づき、ログイン後の依頼・報告・設定とクレジット画面も改善した。主要13画面の3幅での確認、実通信断からの復帰、遅い応答による画面の巻戻り修正、本人固定とセッション失効を[アプリ全体の品質記録](app-craft.md)に残した。この確認は停止中の実DBコピーで行っており、本番の登録・購入・発信の受け入れは引き続き未完了。

## 利用者の流れ

1. `/` または `/app` の「アカウントを作成」から自分のメールを送る。
2. 受信した30分以内・一度限りのリンクを開き、パスワードを設定して現行の利用規約とプライバシーポリシーに同意する。利用者は暗号化SQLiteへ永続化され、管理者による追加や再起動は不要。登録だけで電話用同意や無料クレジットを付与しない。
3. 残高からパックのクレジット数・実価格を確認し、Stripe Checkoutで支払う。秘密キー・カード情報はOathraのブラウザ画面へ渡さない。
4. Stripeの署名付き通知、または購入状況の照会で支払内容を再確認し、既存台帳へ一度だけ付与する。戻り先URLだけでは支払済みにしない。
5. 既存の電話画面で相手・番号・目的・上限を確認して、その通話を明示承認する。通話完了、目的達成、外部の予約成立を混同しない。

設定が欠けていれば登録や購入の操作を有効にせず、準備中と表示する。既存アカウントのログイン・残高・履歴閲覧を維持する。公開のログ検証ページ `/check.html` はこの有料電話サービスとは別の入口。

Claude Code・ChatGPT向けに、本人がログインして読み取り・営業下書きだけを許可するHTTP MCPと `/connect` 画面を追加した。[接続手順](../integrations/claude-chatgpt.md)・[検証範囲](sales-mcp.md)。初期状態では無効で、常設HTTPS配備・公式クライアント接続・実営業電話の一貫した受け入れは未検証。この追加によって一般公開判定や新規受付・購入・発信の停止は変わらない。

## 制限付き事前プレリリース

2026-10-02 JSTの明示依頼に基づき、一般公開前の制限を追加した。公開作業の権限はあるが、本番の配備・メール・販売設定は未入手であり、公開済みとは扱わない。既存のQuick Tunnelは旧プロセスで、新しい登録・購入APIは反映されていない。固定ドメイン・常設配備先は確認できていない。

`OATHRA_RELEASE_STAGE=prerelease` で次をサーバー側に適用する。`OATHRA_PUBLIC_SIGNUP=true` でstageを省略した場合もprereleaseになる。既存の自己ホスト設定はstage未指定・公開登録なしなら従来どおり。

| 制限 | 初期値 | 適用 |
| --- | --- | --- |
| 公開登録 | 10アカウント | `OATHRA_PRERELEASE_MAX_ACCOUNTS`。メール確認後の作成トランザクションで再確認。管理者発行アカウントはこの登録枠に含まない |
| 本人の発信 | 直近24時間で3回 | `OATHRA_PRERELEASE_DAILY_CALLS`。既存の日次制限がより厳しければそちらを適用 |
| 全体の発信 | 直近24時間で20回 | `OATHRA_PRERELEASE_GLOBAL_DAILY_CALLS`。承認・予約済みの発信を全利用者で合算 |
| 1通話 | 180秒 | `OATHRA_PRERELEASE_MAX_SECONDS`。既存の秒数上限がより短ければそちらを適用 |
| 全体の費用予約 | 初期値0で全発信拒否 | `OATHRA_PRERELEASE_GLOBAL_DAILY_USD`。運営者が承認した予算の設定が必要。販売価格ではなく、直近24時間の承認済み見積上限合計 |
| 着信・折り返し応答 | 無効 | 着信Webhookは応答開始・クレジット予約前にReject |
| 新規受付 | 初期状態は停止 | `OATHRA_PRERELEASE_PAUSED` を明示的に `false` にするまで、新規登録・購入・発信を拒否 |

ゼロは専用プレリリース上限では受付停止を意味する。従来の `OATHRA_DAILY_CALLS=0` は無制限を意味するため、プレリリース専用の3回上限を適用する。`OATHRA_DAILY_USD=0` の場合は明示した全体予算を本人にも適用する。登録だけで無料クレジットは付与しない。停止・取消済みでも、その24時間の承認枠は戻さない。UI・通常API・委任agentが同じ承認処理を通り、workerが発信する直前にも再確認する。

設定変更にはGatewayの再起動が必要。一時停止中もログイン・残高・履歴・既知の支払のWebhook照合と付与は維持する。すでに開始した通話の停止には既存の通話取消操作を使い、回線状態が不明なら通信会社の状態照合を行う。停止設定だけで進行中の電話が即時終了するとは表示しない。実費の通知遅延や通信会社側の費用は見積予約上限と異なるため、絶対的な請求額保証とは扱わない。

課金は現時点ではStripeでのクレジット都度購入。月額課金は未実装。販売数量・税込価格・利用するStripeアカウントはユーザー確認待ちで、架空の価格は設定していない。購入要求は表示した金額・通貨に加えてクレジット数も必須とし、変更時は再確認する。

公開準備の監査で併せて修正した事項:

- 共有電話番号への折り返しを複数顧客の最新発信へ推測で割り当てない。対象顧客が曖昧なら応答せず、別顧客の依頼文・着信・課金に結び付けない。プレリリースでは着信自体を止める。
- 月間上限の元になる承認記録を35日保持し、全件を合算。以前の48時間削除で記録が欠けた場合は残存する実通話を補完に使い、その通話を削除する際にも承認額を永続保持する。既に通話・承認の両方が削除済みの過去実績までは復元できない。

追加検証: build/lint:deps/構文・差分検査は成功。実DBのnative backupを使い、worker未起動・外部資格情報なしで13の停止/ゼロ上限境界を確認し、業務レコードのhash不変を確認した（`artifacts/quality/public-service/prerelease-boundaries.json`）。別の隔離コピーで実承認の削除・再起動・prune後も承認額を保持した（`prerelease-retention.json`）。独立レビューのP2を修正後、公開状態200、停止中の空登録POST503を独立再確認した。登録枠の実顧客同時取得、実決済・実通話、正の利用枠を消費する一貫した検証は未実施。

最初の検証ハーネスでは既存 `OATHRA_DAILY_CALLS=0` を新上限にそのままmin合成して0回になった。既存0の無制限契約を維持して専用上限へ適用するよう修正し、同じ実DBで再確認した。ダミー顧客や架空決済で結果を補っていない。

実画面はSafariで未ログインの `/` と `/app` を確認。登録10人・本人3回/24時間・最長3分・着信不可・休止表示とログイン入力を確認した。managedログインフォームが背景でのアニメーション待ちにより透明になる症状を修正し、再確認した。画像は[managed](evidence/public-service/prerelease-managed-login-desktop.png)・[app](evidence/public-service/prerelease-app-login-desktop.png)、rootも両画像を目視確認済み。今回はIAB接続が利用できず、狭幅での追加表示と購入有効時の画面は未検証。検証タブと隔離previewは終了し、元の公開プロセス・実DB・envは変更していない。

## 費用を抑えた配備方針

2026-10-02 JSTの依頼に基づき、[環境変数テンプレート](../../apps/gateway/.env.example)の公開用設定を10人、本人1回/直近24時間、全体5回/直近24時間、1通話180秒へ絞った。上の表はコードの省略時初期値で、テンプレートでは本人・全体の回数を明示的に小さくしている。登録時の無料クレジット付与はない。受付停止・公開登録無効・全体費用予算0を維持し、実サーバーの設定は変更していない。

固定費を抑えるため、既存の常設Linuxサーバーと管理ドメインのサブドメインを優先する。独立した有料DB・ロードバランサー・有料メールプランを追加せず、単一Gateway/worker、永続SQLite、Caddyとサーバー外バックアップで開始する。利用する既存ホスト・ドメインはまだ確定していない。

| 項目 | 費用方針と確認した料金 |
| --- | --- |
| 常設サーバー | 既存設備の再利用が第一候補。新規が必要ならLightsailのLinux/IPv4・1GBプランは月US$7。バックアップ・税・超過転送等は別。負荷検証前なので容量の十分性は未確定。[AWS公式](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html) |
| 無料サーバーの候補 | OCI Always Freeは対象枠内で無料だが、空き容量とアカウント資格が必要で、低負荷インスタンスの回収条件もある。常時提供の確約には使わず、実アカウントの確認後に比較する。[OCI公式](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| 確認メール | Resend Freeの月3,000通・日100通の範囲で開始。実際に管理する送信ドメインの検証が必要。[料金](https://resend.com/pricing)・[ドメイン設定](https://resend.com/docs/dashboard/domains/introduction) |
| 決済 | Stripe標準の都度購入。初期・月額費用なし、日本の標準カード決済は成功額の3.6%。換算等の追加条件は実アカウントで確認。有料のCheckout専用ドメインは採用しない。[Stripe公式](https://stripe.com/jp/pricing) |
| 電話・AI | 実発信の従量費、番号維持費等は別途必要。上記のサーバー料金に含めない。現在の内部精算単価を販売価格・最新実費の保証としない |

新しい有料契約・サーバー・Price・送信ドメインは作成していない。利用者向けの税込価格と付与クレジット数、運営者・販売条件、運営費の上限は引き続き実値が必要。低コストの構成選定でこれらを補ったことにはしない。

テンプレートを実際の設定パーサーで読み、10人・本人1回・全体5回・180秒・停止・予算0・着信なしを確認した。DBやネットワークは使用していない。料金表示では内部原価を円へ換算した「約N円」を残高・上限・1分目安から削除し、消費クレジットを表示する。実Stripe価格と購入履歴の表示は維持した。`main.js` / `receipt.js` の構文検査、空値境界、差分検査と独立静的レビューは成功。今回の表示修正について実画面・実決済は未検証。

## 本番で必要な情報

| 項目 | 設定と確認 |
| --- | --- |
| 常設配備 | 運営者の固定ドメイン、永続ディスクのある常設Linuxサーバー、DNS、HTTPS。現在の一時トンネルを常設公開の実績にしない |
| 運営と販売条件 | 運営者名・問い合わせ先・実際の販売価格とクレジット数・利用条件。利用規約、プライバシー、販売条件、サポートの公開HTTPS URL |
| メール | Resendの実キー、確認済み送信ドメインのアドレス、実際に受信できる本人メール |
| 決済 | Stripe liveの実キー、実際の一回払いPrice、公開Webhook endpointの署名秘密。架空Priceや試験用カードで代替しない |
| 実通話確認 | 相手の了承があり、発信費用上限を明示した通話。購入から消費・余剰返却までを実記録で照合する |

設定項目は [Gateway環境変数テンプレート](../../apps/gateway/.env.example) に追加済み。秘密はサーバーの非公開 `.env.gateway` または秘密管理機能に設定し、チャット・ブラウザコード・Gitへ保存しない。

`OATHRA_PUBLIC_SIGNUP` は配備準備中は `false` のままにする。公開検証を始める段階で `true` にし、必要な実利用の確認が終わるまで公開完了と告知しない。既存の電話会社・AI設定、利用料計算、利用上限は [Gateway README](../../apps/gateway/README.md) に従う。

登録設定の詳細: [公開アカウント契約](public-accounts.md)。Stripeの権限、Price条件、購読イベント、通信不明・返金時の扱い: [購入契約](credit-purchases.md)。SSO、MFA、自動返金・紛争解決は今回の実装に含まない。

## 配備と読み取り専用診断

単一Gateway・単一workerのDocker ComposeとCaddyを使う。作業シェルの `OATHRA_DOMAIN` に管理する実際のDNS名を設定し、`.env.gateway` の `OATHRA_PUBLIC_URL` と一致させる。Gatewayの内部ポートは4244へ固定し、外部に直接公開しない。ボリュームを削除する操作を通常の更新・再起動手順に入れない。以下はリポジトリのルートで行う新規配備の手順。

```sh
pnpm build
pnpm lint:deps
node --env-file=.env.gateway apps/gateway/public-service-check.mjs
: "${OATHRA_DOMAIN:?管理する実際のDNS名を設定してください}"
export OATHRA_DOMAIN
docker compose -p oathra -f apps/gateway/deploy/compose.yml up -d --build
node --env-file=.env.gateway apps/gateway/public-service-check.mjs --online
```

既存配備では従来のCompose project名を維持する。上の `-p oathra` はその名前へ置き換える。名前を指定せずこのComposeを使っていた場合は通常 `deploy` だが、作業前に稼働中のproject名を確認する。project名の変更は別の名前付きボリュームを参照するため、空のDBで起動することがある。更新・バックアップ・復元で同じproject名を使う。

Dockerfileの `compile` targetは依存の導入と型・bundle生成までを行う。既定の最終イメージはfixtureテストを実行する `build` stageに依存し、テストゲートを維持している。テストデータ生成禁止のため、今回の検証対象は `compile` targetのみ。既定の最終イメージとテストゲートは未実行で、コンパイル確認を公開配備の完了とは扱わない。

`public-service-check.mjs` はメール・決済作成・クレジット付与・電話を実行しない。`--online` は実Stripe価格・アカウント、Resend送信ドメイン、公開URLを読み取り確認する。メール送信専用キーでドメイン一覧を取得できなければ「不明」とし、この診断だけのために権限を広げない。失敗または未設定は終了コード2。

`/healthz` はHTTP応答、`/readyz` は現在のworkerの有効なDB leaseとlive設定を確認する。Compose healthcheckも `/readyz` を使う。電話会社への接続・実通話成功・継続稼働保証の代わりにはならない。

## バックアップと復元

Node 22.16以降のSQLite online backupを使う。単なる稼働中の `.sqlite` ファイルコピーと違い、コミット済みWALも含む。新しい出力ディレクトリのみ受け付け、既存バックアップは上書きしない。

Compose配備ではGatewayコンテナ内で実行する。コンテナには `OATHRA_DB=/data/gateway.sqlite` が設定されているため、次の手順は稼働中の名前付きボリュームを保存する。ホスト側の `.env.gateway` で指定されたローカルDBのバックアップと取り違えない。事前に `OATHRA_COMPOSE_PROJECT` を稼働中のproject名へ設定する（新規配備は `oathra`、既存配備は従来名）。`OATHRA_DOMAIN` も配備時と同じ値を使う。

```sh
(
  set -eu
  : "${OATHRA_COMPOSE_PROJECT:?稼働中のCompose project名を設定してください}"
  : "${OATHRA_DOMAIN:?配備時の実際のDNS名を設定してください}"
  export OATHRA_DOMAIN
  umask 077
  backup_name="backup-$(date -u +%Y%m%dT%H%M%SZ)"
  backup_dir=".oathra/backups/$backup_name"
  mkdir -p .oathra/backups
  chmod 0700 .oathra/backups
  mkdir "$backup_dir"
  docker compose -p "$OATHRA_COMPOSE_PROJECT" -f apps/gateway/deploy/compose.yml \
    exec -T gateway node apps/gateway/backup.mjs "/data/$backup_name"
  docker compose -p "$OATHRA_COMPOSE_PROJECT" -f apps/gateway/deploy/compose.yml \
    cp "gateway:/data/$backup_name/." "$backup_dir/"
  chmod 0700 "$backup_dir"
  chmod 0600 "$backup_dir/gateway.sqlite" "$backup_dir/manifest.json"
  node --input-type=module - "$backup_dir" <<'NODE'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const directory = process.argv[2];
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
if (manifest.file !== 'gateway.sqlite' || manifest.integrity !== 'ok' || manifest.encryptionKeyIncluded !== false) throw new Error('invalid_backup_manifest');
const digest = createHash('sha256').update(readFileSync(join(directory, 'gateway.sqlite'))).digest('hex');
if (digest !== manifest.sha256) throw new Error('backup_checksum_mismatch');
console.log('Backup checksum verified');
NODE
)
```

バックアップディレクトリは0700、`gateway.sqlite` とSHA-256・整合性検査結果の `manifest.json` は0600で扱う。取り出した2ファイルをサーバー外の管理対象ストレージへ保管し、保管先でも同じmanifestのhash照合を行う。コンテナ内や同一サーバー上だけのコピーはホスト・ボリューム喪失への備えにならない。暗号鍵はバックアップに含まないため、同じ `OATHRA_DATA_KEY` と運営者設定を別の非公開の保管先に保持する。環境ファイルの本文や鍵をログ・チャットへ出力しない。

復元はGatewayを停止し、現状のDB/WALを退避してから、manifestのhashを確認したバックアップを空の復元先へ配置する。同じ暗号鍵で再起動し、残高・購入台帳・利用者・未確定通話を照合する。実運用の復元では、バックアップ後にStripeで発生した決済を再照合し、回線状態が不明な通話は通信会社で確認する。古いDBを使って新しい購入や電話を自動再実行しない。

## 今回の証拠

macOS、Node v25.2.1、pnpm 10.12.2。変更ごとのSHA-256はローカルの `artifacts/quality/public-service/source-manifest.json` に記録。既存の未コミット変更を保持し、ダミー顧客・モック配送・架空決済イベント・有料発信を作っていない。既存のfixtureベースの全テストスイートは今回実行していない。

| 判定 | 検証 | 観測・証拠 |
| --- | --- | --- |
| PASS | build / lint:deps | ともに終了0。型・bundle生成と依存方向の検査 |
| PASS | 変更JSの構文、差分空白検査 | `node --check` / `git diff --check`、終了0 |
| PASS | 配備定義の構文 | `docker compose -f apps/gateway/deploy/compose.yml config --no-interpolate --quiet`、終了0。コンテナ起動の検証ではない |
| PASS | 独立静的レビュー | 認証、Origin、所有者、Cookie失効、決済照合と一度付与。遅延応答による購入状態の競合2件を修正後に再確認 |
| PASS | 独立HTTP拒否境界 | 公開状態200、未認証401、Originなし403、未設定登録503、不正JSON400、Content-Typeなし415、worker未起動503。`http-independent.json` |
| PASS | 最終HTTP境界 | 最新serverを再起動し公開状態・worker未起動を再確認。Stripe未設定503、実在メディアファイルによる上限超過リクエスト413、決済event作成なし。`final-http.json` |
| PASS | 既存利用者の実記録 | 実operatorの通常認証、既存25件のmission参照、購入未設定表示、購入履歴読取、ログアウト後401。業務レコードのhashは操作前後で一致。`authenticated-http-reviewed.json` |
| PASS | 実DBのバックアップ・復元 | 35業務レコードと既存パスワード1件を復号して2回の再初期化で保持。元と復元後の業務レコードhash一致、上書き拒否。`restoration.json`。新規公開利用者や支払済み台帳の復元試験ではない |
| PASS（著者UI確認） | `/` と `/app` | 実operatorでログイン、残高・購入停止表示・更新・Escape・ログアウト。390px幅とdesktop、console error/warnなし。新規登録と支払が有効な状態の操作は未検証 |
| PASS（独立画面確認） | 未ログインmanaged画面 | rootが別タブから電話受付準備中・登録停止・ログイン入力を確認 |
| BLOCKED | 本番設定診断 | 常設origin、メール、価格・Stripe、販売条件の設定が不足。`preflight.json`、終了2 |
| BLOCKED | 実メール・新規登録・回復 | 実送信元・受信先が必要。再使用・期限切れ・回復後の失効を実リンクで確認する |
| BLOCKED | 実Stripe E2E | 実価格・キー・Webhookと実支払いが必要。購入・Webhook再送・照会で台帳が一度だけ増えることを確認する |
| BLOCKED | 実顧客間の隔離 | 2人の了承済み実アカウントが必要。互いの通話・購入・残高へアクセスできないことを確認する |
| PASS（隔離コンテナ） | Linux / Node 22の起動・再起動 | 2026-10-02 JST、既存のColima contextで `compile` targetをビルド。外部通信なし、UID 1000、読取専用root、専用DB volumeで実DBの35業務レコードと既存パスワード1件を保持。起動前・起動後・再起動後の復号内容hash一致。`container-build.log` / `container-runtime.json`。default contextのsocket不在をDocker全体の利用不可としていた以前の記録を訂正する |
| BLOCKED | 本番Docker・常設公開・通話会計 | 既定最終イメージとfixtureテストは未実行。常設配備先・固定ドメインは未指定。購入から通話の消費までの実E2E、稼働監視も未実施 |

HTTPの初回確認では空の購入要求に対し503を期待したが、仕様どおり冪等キー検査の400が先に返った。確認側の期待を訂正し、空の入力を拒否し業務データを変更しないことを再確認した。初回記録 `authenticated-http.json` も保持している。

未ログインの画面証拠: [アプリ](evidence/public-service/app-login-mobile.png)、[managed](evidence/public-service/managed-login-mobile.png)。実利用者の履歴、認証情報、支払情報は画像へ保存していない。

2026-10-02 JSTの追加準備では、Dockerのビルド入力を必要なソースの許可リストに限定した。実env・DB・ローカル作業記録・以前の生成済みbundle・TypeScript build cacheを除外し、秘密や古い成果物を取り込まない。既存のテストゲートは保持し、今回のコンテナ確認は `compile` targetに限定した。実APIキーを含めず `--network none` で起動し、`/healthz` 200、電話設定不足時の `/readyz` 503、未認証API 401、公開状態の受付停止を確認した。検証用コンテナとvolumeは削除済み。元の稼働Gateway・実DB・設定は変更していない。

独立レビューで、最初の許可リストが親ディレクトリの例外を通じてdesktopや一時scriptを取り込む点を検出した。再除外を追加し、再ビルド・再起動確認後、別担当がイメージ内の `apps` はgatewayのみ、`scripts` はbundle-cliのみであることを再確認した。イメージのID、対象ソース、実行証拠のSHAは `deployment-preparation-manifest.json` と一致。外部プロバイダーのAPI鍵は渡していないが、実DBの復号と認証設定の検証に必要な既存暗号鍵・operator設定は隔離実行環境へ渡している。

Cloudflareの既存CLI認証は有効だったが、Oathra用の常設ホスト・固定ドメインは確定できなかった。Stripeはブラウザでログイン画面へ遷移し、既知のプロジェクト設定にも本番キー・Price・Webhook秘密は未設定。販売数量・税込価格・費用上限、実送信元、運営者と販売条件を確認してから設定する。設定診断では価格照合と購入受付可否を分離し、停止を維持したまま実Priceを照合できる。実Stripeの成功証拠はまだない。
