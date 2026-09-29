# OSS設定とサービス版クレジット（実装前の合格条件）

後続変更: [通話時間と使用量による精算](metered-credits.md)を追加。以下は旧固定方式での実装・検証履歴。

2026-09-20追記: サービス版のトップ画面を元のArena電話UIと共用するよう変更。[共有UIの検証](shared-phone-ui.md)が現行画面の記録です。以下の2026-09-19結果は当時の会計実装の証拠として保持します。

対象: 自己管理OSSは従来の電話会社/AI設定を利用。サービス版は管理者がAPI認証情報を持ち、認証済み利用者は残高内で依頼→見積→承認→発信を行う。既存Gateway/APIを拡張し、localhost用Arenaをそのまま外部公開しない。

料金ルールは未確定のため管理者設定。最初は1発信試行あたりの固定整数クレジット。承認で確保、発信処理の開始で消費。相手不応答/途中終了/結果不明でも消費対象であることを承認前表示。キュー待ち取消/実行前の検査失敗は確保解除。シミュレーターは無料。購入決済・サービス公開・実発信は今回実行しない。

| 条件 | 環境/検証 | 期待する結果/証拠 |
| --- | --- | --- |
| OSS互換 | 既存Gateway/Arena/CLI試験 | 未指定self-hostedは残高不要、既存機能回帰なし |
| 所有者分離 | 実SQLite/HTTP API | 他人残高/履歴/付与拒否、管理者のみ付与 |
| 残高制限 | 実SQLiteトランザクション | 残高不足ではキュー/外部実行なし、整数/負数/overflow拒否 |
| 重複防止 | SQLite複数connection | 同時確保でも残高負数なし、同じgrant/startのretry二重消費なし |
| 確保と消費 | 実store/service操作 | 承認・確保は同一tx、実行claim・消費同一tx、取消/拒否で確保解除 |
| 障害復帰 | DB再起動 | 台帳と残高一致、結果不明を自動返却/再発信しない |
| API/料金改変 | HTTP/サービス境界 | クライアントの価格/owner信用なし、見積後価格変更で再確認 |
| UI | ローカルChrome | 残高・確保・消費量・消費条件・利用履歴、残高不足から復帰 |
| 実回線/決済 | 外部権限必要 | 未実施はBLOCKED。架空成功で代替しない |

料金・ログイン既存基盤についてユーザー回答待ち。未回答でもプロバイダー非依存の残高/API/管理者付与を実装し、価格の勝手な確定や決済課金はしない。

## 実装と互換性

Gateway `OATHRA_DEPLOYMENT=self-hosted|managed`（既定self-hosted）。managedのみ `OATHRA_CREDITS_PER_CALL` の正の整数が必須。利用者の個別Bearer認証は既存のまま。Arena/CLIにはクレジットを追加せず、サービスはGateway APIで提供する。新しいAPI/SDK/料金モデルはexperimental。新規SQLiteテーブルの追加migrationで既存データを保持する。

`credit_wallets` はavailable/held、`credit_holds` はmission単位のheld/captured/released、`credit_ledger` は追記のgrant/reserve/consume/release。grantはSQL一意制約で期限なく再送重複を防止。従来の通話削除/retentionは台帳を削除しない。予約・消費・返却はmission状態と同一BEGIN IMMEDIATE。Worker.claimNextはlease所有者を同トランザクションで検査。残高/額は整数・非負、quoteはfingerprintへ束縛。設定変更後は再作成を要求。

README/API/SDK例は `apps/gateway/README.md`。初期化は `setup-managed.mjs`、APIクライアントは `sdk/gateway-client/index.mjs`。販売決済/自動アカウント登録/既存SSO接続はプロバイダー未指定なので未接続。

## 検証用データの限定例外

根幹の会計トランザクション/認可/障害復帰を、課金・個人情報送信なしで検証するため、一時DBのランダムなアカウントIDと少量の整数クレジット、最小の中断queue状態を使用。使用箇所は `apps/gateway/test/credits.node.mjs` と `scripts/ui/managed-credits.mjs`。外部事業者の成功応答mock/架空の通話/架空の決済イベントは生成しない。本番DBやユーザー残高には入れず、終了時に削除する。実回線・決済権限が得られた段階で実データの統合確認を追加し、この暫定データを成立証拠として使わない。

## 検証結果（2026-09-19）

対象: HEAD `d56ec10306f70d68fd07dae1480c176a3aa7b20d` + 既存差分を保持した追加変更。macOS arm64、Node25.2.1、pnpm10.12.2、Chrome153。変更ソースの識別は `artifacts/quality/managed-credits/source-sha256.txt`。

| 判定 | コマンド/観測 | exit | 証拠（同artifactディレクトリ） |
| --- | --- | --- | --- |
| PASS | `pnpm build` | 0 | build.log |
| PASS | `pnpm typecheck` | 0 | typecheck.log |
| PASS | `pnpm test` 1006PASS/既存1skip | 0 | tests.log |
| PASS | `pnpm test:gateway` 215PASS（新会計8件含む） | 0 | gateway.log |
| PASS | `pnpm lint:deps` | 0 | deps.log |
| PASS | `pnpm test:ui` Gateway52/Arena94項目 | 0 | ui.log |
| PASS | `node scripts/ui/managed-credits.mjs` 実SQLite・認証HTTP・実Chrome、残高0→管理者付与→6/履歴、390/1280px、キーボード閉じる/ログアウト | 0 | browser.log、desktop.png、mobile.png |
| PASS | 空の一時環境でsetup-managed実行→実DB照合→上書き拒否 | 0 | setup.log |
| PASS | 2つの別Nodeプロセスから同時reserve、片方だけ成功 | 0 | gateway.log |
| BLOCKED | 実回線を伴うサービス認証→承認→消費→通話→請求照合 | — | 公開接続・外部発信未承認/未設定。会計境界試験で代用しない |
| BLOCKED | 購入決済、SSO連携 | — | 対象プロバイダー/既存サービス基盤未指定。実装・購入済みとしない |
| BLOCKED | 実OS日本語IME、200%拡大での新クレジット画面、実ユーザー評価 | — | 今回の新画面では未実施 |
| NOT_APPLICABLE | ネイティブ試験 | — | 今回はGateway Web/APIの変更 |

既存テストには従来のprovider mockが含まれ、実回線の証拠ではない。新UI検証はcarrier workerを起動せず、実API/DBの管理者付与だけを使用。課金額の見積や請求書は作成しない。8件の会計試験は認可/台帳/残高/確保/返却/排他/保持を検証し、有料Service.start→実Worker外部接続の全体をPASSにはしない。

ローカル確認用サービスを `http://localhost:4245` で起動。`.oathra/managed-preview/` 内に空のDBと管理者認証情報を作成し、残高0・練習モード・実発信なし。初期化検証用の単価1は正式な販売料金ではなく、live切替前に運営者が単価を設定し直す必要がある。公開・push・課金・購入・他者への通知は実行していない。

独立レビューは8件PASS、重大P0/P1なし（静的/ローカル境界範囲）。`independent.md`参照。最後に指摘された初期化後の起動案内の空白パスをシェル引用し、`node --check apps/gateway/setup-managed.mjs` exit0。独立ソース識別はこの案内文修正前、source-sha256.txtは修正後。
