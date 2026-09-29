# Skill導入後の再監査 — 2026-09-19

総合判定: **FAIL**。ローカル練習の成果物保存と公開SDK導入は成立したが、二重開始と進行中の通話への復帰に未達がある。今回はSkill導入と再監査であり、アプリ実装の修正は行っていない。前回報告は履歴として残す。Q4の広い合格解釈は本報告で訂正し、同一冪等キーのAPI試験成功とUIの連続操作失敗を分ける。

## 対象・環境・基準

- revision: `d330530d6fa4e94c4160554b6b88e7d846c45fd1` と既存未コミット変更。HEADだけを検証対象としない。
- 差分: `artifacts/quality/reaudit/working-tree.patch`、SHA256 `9e6b103a2e98adb1214d3f15a458903f55311b2df6e11a00b730c5cf31214456`。未追跡ファイルを含む対象16ファイルは `source-comparison.json` で識別し、前回の最終manifestとの一致を確認。
- macOS 26.6.2 (25G83), arm64, Node 25.2.1, pnpm 10.12.2, Chrome 153.0.8010.53。Node 22での再実行ではない。
- 正本は `docs/design/ui/acceptance.md` Q1–Q8。主要タスクはローカルの電話練習を選択し、相手の発話に基づく結果を読み、JSONを保存して再確認すること。実予約の成立を意味しない。
- 入力は既存の製品シナリオ・実操作・既存公開記録。新しいモック、ダミー通話記録は追加していない。既存単体テストのモックは実接続の証拠ではない。
- 比較対象は前回の同一ローカルフローと公開CLI/SDKの同一入力での一致。競合製品の同条件比較、独立採用、実ユーザーの初回成功率は未測定。今回公式資料の外部比較調査は実施しておらず、その部分のSkill手順は未完了。

## 導入したSkillと使用範囲

ユーザー指定 `/Users/horioshuuhei/Downloads/oss-quality-kit` の `2.0.0-draft` を、スクリプトを確認して `.agents/skills/` に導入。グローバル設定・AGENTSは変更していない。全同梱チェックサム、validator、導入前dry-run、導入後diffはいずれもexit 0。`SHA256SUMS.txt` 自体のSHA256は `d8f8bfade3fbe94a819bb2a9776d906c915c432f348ff867015e5379c99a1ae2`。第三者の公式標準認証ではない。キットの独立したLICENSEは確認できておらず、再配布条件を確認済みとはしない。

`skill-installer` を読んだ上でネットワークを使わない同梱installerを使用。新規Skillの自動認識は次のターンからのため、今回は導入済み文書を明示的に読んで適用した。

使用順は `oss-standard-audit` → `outcome-first-ux` → `world-class-ui`（画面監査のみ）→ `contract-first-build`（契約監査のみ）。`independent-product-verification` は実装履歴・手順を渡さない別エージェントでPass Aを実行し、その後Pass Bを実施した。添付マスタープロンプトは参考資料として読み、実装変更や外部公開の追加許可とは扱っていない。

## 優先修正（未修正）

| 優先度・対象 | 再現・影響 | 修正後に必要な受け入れ条件 |
|---|---|---|
| P1: 通話の開始・離脱管理 — `apps/arena/public/app.js:351`, `:1025` | 同じ開始を120ms間隔で2回押すと、実サーバに異なるIDの通話が2件作られる。POST受付後にボタンを再有効化し、新しいキーを作るため。同じキーのAPI冪等性では防げない。独立検証でも「戻る→別の練習」で旧通話がrunningのまま残り、未保存のため履歴から見つけにくい。実電話の重複は未試験であり主張しない。 | 進行中の通話を明示し、連続開始で同じ意図の通話を増やさない。離脱しても再接続または明示取消が可能。実サーバの件数・状態と画面を照合。並列通話を許す設計なら各通話へ戻れる導線が必要。 |
| P2: 不正JSONの契約 — `apps/arena/src/server.ts:71`, `:187` | `POST /api/calls` にJSON `null`を送ると500、内部プロパティ参照の例外を返す。入力オブジェクトを実行前に検証していない。 | null・配列・プリミティブ・構文不正は適切な4xxと安定したエラー、通話作成なし。入力境界を強化し既存正常リクエストを維持。 |
| P2: 練習の日付理解 — 既存レストランシナリオとArenaの説明 | 2026-09-19の実行でも「明日」と説明し、結果の日付は固定2026-09-12。再現可能な固定シナリオ自体は有効だが、初心者には基準日が伝わらない。 | 固定された練習の基準日を操作前に提示するか、説明を絶対日付に合わせる。再現性維持と表示・成果物の整合を確認。 |

追加の静的指摘: 新設 `test:arena-outcome` / `verify-arena-outcome` / `arena-recovery` は `.github/` のCIから直接参照されていない。今回実行して成功したことと継続的な回帰防止は別。CI接続は上記修正時に検討する。

## 主張・契約・検証

| 主張 | 実装・文書 | 今回の確認と限界 |
|---|---|---|
| キー不要のローカル練習 | CLI demo、Arena、同梱ScriptedAgent | 実プロセス・新規cwd・新規ブラウザで実行。製品シミュレータでありPSTN/モデル実接続の確認ではない。 |
| 相手の証拠から結果を保存・再確認 | Arena artifact/replays、evidence core | 独立ブラウザで結果・JSON・再表示を確認。HTTP/ファイル試験でも保存障害と保存だけの再試行を確認。 |
| 同一入力でCLI/SDKが一致 | `examples/verify-recording.mjs`、`oathra`公開exports | ローカルtarballを空ディレクトリにoffline installし一致。npm公開済みパッケージの検証ではない。 |
| 二重操作を防ぐ | API Idempotency-Key / UI startCall | 同一キー試験PASS、UI連続操作FAIL。プロセスを跨ぐ永続冪等性は契約で保証していない。 |
| 安全な組み込み契約 | `docs/quality/arena-contract.md`, INTEGRATION, SECURITY, CONTRIBUTING, Apache-2.0 | 静的確認＋上記SDK実行。Arena experimentalと公開SDKの区別あり。外部の独立実装・採用は未確認。 |

標準化の最小境界は既存の公開SDK入力・結果とバージョン付き成果物。JSON、HTTP、SSEをそのまま使用し、外部モデル/電話は既存Adapterへ閉じ込める。CoreをUIなしで使えることはCLI/SDK一致で確認した。新たなMCP等の仕様や別プロセス分割は今回必要と判断していない。過去バージョン間の互換性全体、外部Adapter実接続までPASSにはしない。

## 実行証拠

すべて2026-09-19、repoルートから実施（pack script内部の一時cwdは `pack-executions.json` 参照）。下記の証拠は `artifacts/quality/reaudit/`。

| コマンド/方法 | exit code | 判定・観測 | 証拠 |
|---|---:|---|---|
| `pnpm build` | 0 | PASS | `build.log` |
| `pnpm typecheck` | 0 | PASS | `typecheck.log` |
| `pnpm test` | 0 | PASS、945 passed / 1 skipped。skipをPASS件数に含めない | `test.log` |
| `node scripts/verify-arena-outcome.mjs` | 0 | PASS、Origin・同一キー冪等性・取消・保存失敗/復帰・成果物照合 | `outcome.log` |
| `node artifacts/quality/reaudit/pack-check.mjs` | 0 | PASS、pack→offline install→公開CLI/SDKの結果一致 | `pack.log`, `pack-executions.json` |
| `node artifacts/quality/reaudit/edge-check.mjs` | 0 | **FAIL**、連続操作2件作成・null入力500。exit 0は観測収集完了であり製品合格ではない | `edge-results.json`, `edge.log`, `double-start.png` |
| 独立ブラウザ操作・API/保存照合 | 個別記録 | 主要フロー成功、離脱復帰に未達 | `independent/`, `docs/quality/reaudit-independent.md` |

`build`と既存回帰の成功だけで製品を合格にしていない。前回のArena91/Gateway49チェックは今回の再実行数として加算していない。

## 未達・対象外

- **BLOCKED**: OS日本語IME、実機Safari/ネイティブ、実ユーザー評価、競合との同条件比較、外部モデル/PSTNの実処理。今回のブラウザ/シミュレータ試験で代用していない。
- **BLOCKED**: ブラウザ自体の200%ズームの実証。幅を狭くするreflowを同じ試験とは扱わない。アクセシビリティ全面適合も未証明。
- **NOT_APPLICABLE**: 今回のキー不要ローカル練習における課金・実予約・承認待ち外部処理。製品全体の外部モードには適用しない。
- 人間の評価・競合優越は未確認。製品の普及、契約の普及とも達成したとは判定しない。

既存アプリコード・期待値・テストを変更せず、1回の再監査として終了。修正すべき内容と受け入れ条件を上記に残す。公開・push・発信・外部モデル呼び出しは実施していない。
