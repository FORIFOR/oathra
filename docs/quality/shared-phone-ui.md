# 元の電話UIとサービス版の共用

対象: `f2696fa45439a909a8974f47d679e4bddb63680e` と既存未コミット変更を保護した追加差分。2026-09-20、Darwin arm64、Node25.2.1、pnpm10.12.2、Chrome153.0.8010.53。変更ソース識別・完全ログは `artifacts/quality/shared-phone-ui/`。

主要タスクは番号・相手・目的を入力し、確認内容を保存して履歴から再利用すること。live設定済みなら同じ画面から承認して発信する。UI共用のためArenaのHTML/CSSを読み込み、managed専用の認証APIアダプターを接続する。旧営業画面は `/sales`。ローカルArenaを外部公開したり、認可をブラウザーへ移したりしない。CLIとサービスの汎用電話契約はCoreの `definePhoneRequest` に共通化。

## 条件と結果

| id | 環境・検証方法 | 期待 / 観測 | 判定・証拠 |
| --- | --- | --- | --- |
| UI | 実Chrome・managed root | 元の3入力、12テンプレート、ヘッダー残高。1280/390pxで横溢れなし | PASS: phone-browser.log、desktop.png、mobile.png |
| 保存 | 実認証HTTP/SQLite、サーバー再生成 | 確認→下書き保存→履歴→目的のみ再利用、再起動後同一内容 | PASS: phone-browser.log |
| 入力 | Core strict schema、実フォーム | 未記入テンプレートを400で拒否、保存件数を増やさない | PASS: phone-browser.log |
| 互換 | CLI/GatewayのCore契約、SDK実HTTP | CLI既存試験、SDKから実保存記録・テンプレート・設定の取得 | PASS: tests.log、phone-browser.log |
| 所有者 | 実ChromeでA→ログアウト→B | 他人の詳細404・履歴空、選択済み番号消去、「この相手に電話」無効化 | PASS: phone-browser.log |
| 復帰 | 一時DBの中断状態＋実API | UNKNOWNに照合/終了導線。SID不明は管理者確認の案内、再発信なし | PASS: phone-browser.log（限定状態注入、実回線ではない） |
| 取消競合 | 実Worker/Store、限定uncertain例外 | 取消要求があってもUNKNOWNを維持、同じ相手への再発信拒否 | PASS: gateway.log、independent-cancel-test.log |
| 応答喪失 | 独立静的監査 | start応答とGET喪失時も結果欄・更新・照合導線を表示。自動POST再送なし | PASS: independent.md。実通信障害を伴う通話はBLOCKED |
| クレジット | 実Chrome/認証API/一時SQLite | 0→管理者付与→残高・台帳、重複付与なし、閉じる/ログアウト | PASS: credits-browser.log。画像は隣接managed-creditsフォルダー |
| 操作 | Chromeキーボード、CSS200%、reduced motion | Tabの次項目とフォーカス可視、横溢れなし | PASS: phone-browser.log、zoom-200.png。OS拡大/IMEとは区別 |
| 実起動 | localhost4245・127.0.0.1:55344 | 活動通話なしを照会して再起動。ログイン後同じ画面・残高0 | PASS: running.log、running-phone.png、running-login.png |
| 実回線・決済 | 外部接続・発信承認が必要 | 設定/許可不足。実発信、キャリア照合、消費と請求照合は未実施 | BLOCKED |
| IME・読み上げ・実ユーザー | 実OS・人間の評価 | 未実施。AIによるレビューで代替しない | BLOCKED |
| ネイティブ | Web/API変更のみ | OSネイティブ製品は今回の対象外 | NOT_APPLICABLE |

## 実行コマンド

すべてexit0。`commands.json`に記録。テストや期待値の緩和はなし。

- `pnpm build` / `pnpm typecheck` / `pnpm lint:deps`
- `pnpm test`: 1006 PASS、既存1 skip
- `pnpm test:gateway`: 216 PASS（uncertain取消競合の回帰含む）
- `pnpm test:ui`: Gateway52 / Arena94 PASS。後続の障害時状態修正はgateway試験とmanaged-phone試験で再確認
- `node scripts/ui/managed-credits.mjs`: 既存残高フローを共用UIで確認
- `node scripts/ui/managed-phone.mjs`: 認証・入力・履歴・所有者・再起動・SDK・復帰・幅・フォーカス
- `git diff --check`

実装後、独立レビューで取消時のUNKNOWN優先、ログアウトの宛先消去、個人電話の挨拶、未確認時の復帰表示を修正。別エージェントによる再監査は `independent.md`。同一モデルの別セッションであり、人間の初見評価ではない。

## 限定した検証用データ

課金・実回線の許可がないため、根幹の認可・障害復帰検証に限り一時アカウントID、一時DB、既存本人番号のローカル入力を使用。`scripts/ui/managed-phone.mjs` のUNKNOWN状態、`gateway.node.mjs` のuncertain例外は限定障害注入。架空の通話成功や決済履歴を作らず、発信workerを起動せず、終了時に一時DBを削除する。実回線の検証権限取得後は承認された環境で取消/通信断を確認し、この注入結果を実回線成立の根拠として使わない。

起動中の確認サービスにはクレジットや連絡先を追加していない。公開・push・発信・課金は実行していない。料金・購入決済・SSOの未確定部分は [managed仕様](managed-credits.md) を参照。
