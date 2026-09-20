# 再監査で見つかった未達の修正 — 2026-09-19

判定: **報告されたコード・表示の不具合は修正済み（PASS）**。実機・人間・外部接続が必要な未検証項目はBLOCKEDのまま。製品全体を無条件に合格とはしない。

対象: `d330530d6fa4e94c4160554b6b88e7d846c45fd1` + 既存変更 + 今回の修正。基準は `docs/design/ui/acceptance.md` Q1–Q8、R1–R4。以前のFAIL証拠は `artifacts/quality/reaudit/` に保持し、本報告が修正後の結果を記録する。外部公開・push・発信は実施していない。

## 修正内容

- **通話の二重開始と取り残し**: 同じタブの進行中call IDをsessionStorageに保持。別の練習を押しても、まずサーバーで現在の通話を照会し、runningならその通話へ戻る。終了確認後に次を開始する。通信エラー時は新規POSTへ進まない。一覧や履歴を開いても「進行中の通話に戻る」を維持する。再読込でモード・選択・実際の通話が一致する。同一冪等キーの重複防止は引き続きサーバーが担う。
- **API入力契約**: 不正JSON、null、配列、プリミティブ、不正な入力型を400 `INVALID_INPUT`で拒否。scenarioIdは非空文字列、speedは有限正数、reply.textは非空文字列。未知の有効なscenarioIdの404は維持。副作用前の拒否を実HTTPで確認する。
- **練習日付**: 日本語・英語・追加聞き取りのレストランシナリオで、説明の「明日」を成果物と同じ2026年9月12日に変更。シミュレーションの固定時計・期待値は変更していない。
- **表示の補足指摘**: 証拠フィールド名を既存の日本語辞書で表示。スコア開閉・結果アクション・編集例文の高さを44px以上にし、狭い話者名列を本文の上に配置して細切れの改行を解消。
- **継続検証**: 実HTTP/ファイル保存試験とブラウザ復帰試験を既存CIへ接続し、失敗時の証拠を保存。実際のGitHub CI起動は公開権限を伴うため行っていない。
- README、日英セットアップ、Arena契約を同期。公開SDKの入出力・成果物schemaVersionは変更しない。

既存の画面構成・配色を維持。Skillは既に使用した監査結果を引き継ぎ、outcome-first-ux → world-class-ui → contract-first-build、repoのui-craftと指定補助frontend-designを適用。実装とは別コンテキストでindependent-product-verificationを実施。全面リライトや新しいUI依存の導入は行っていない。

## 検証環境と証拠

macOS 26.6.2 / arm64 / Node 25.2.1 / pnpm 10.12.2 / Chrome 153.0.8010.53。製品の組み込みシミュレータ、実HTTP、実ファイル、新規Chromeプロファイルを使用。架空の通話成果物や差し替え応答は作成しない。既存単体テストのモックと実接続の証明は区別する。以下はrepoルートから実行、証拠は `artifacts/quality/fixes/`。

| 方法・期待 | 観測 | 判定 | exit code・証拠 |
|---|---|---|---|
| `pnpm build` / `pnpm typecheck` | 成功 | PASS | 0, `build.log`, `typecheck.log` |
| `pnpm test` | 945 pass / 1 skipped | PASS（skip除外） | 0, `test.log` |
| `node scripts/verify-arena-outcome.mjs` | 不正入力16種類で400、通話作成0件。reply不正4種類、同一キー、取消、保存失敗/復帰、成果物照合も成功 | PASS | 0, `outcome.log` |
| `QUALITY_OUT_DIR=artifacts/quality/fixes node scripts/ui/arena-recovery.mjs` | 連続開始・別の練習選択・一覧・再読込でも同一call。通信断から復帰、取消、保存/履歴一致、320/390px・長文・キーボード・reduced motion成功 | PASS | 0, `recovery.log`, 対応PNG |
| `pnpm test:gateway` | 198 pass | PASS | 0, `gateway.log` |
| `pnpm lint:deps` | 依存方向違反なし | PASS | 0, `deps.log` |
| `pnpm oathra scenario validate scenarios/restaurant/*.yaml` | シナリオ妥当 | PASS | 0, `scenarios.log` |
| `pnpm oathra eval --adversarial 10000` | 誤完了0 / 10000 | PASS | 0, `adversarial.log` |
| `node artifacts/quality/fixes/pack-check.mjs` | 空ディレクトリにローカルtarballをoffline install。実記録入力で公開CLI/SDKが一致 | PASS | 0, `pack.log`, `pack-executions.json` |
| `pnpm test:ui` | Gateway49 / Arena91 pass。最終修正中の実行なのでArenaは固定後に別途再実行 | PASS（当該実行範囲） | 0, `ui.log` |

実Chromeの設定画面で200%を選択し、DPR1→2、CSS viewport1440×900→720×450、visualViewport.scale=1を確認した。CSS拡大やpinchの代用ではない。`QUALITY_OUT_DIR=artifacts/quality/fixes node scripts/ui/arena-zoom.mjs` で開始・入力・取消・保存・履歴一致まで確認（exit 0、`zoom.log`, `zoom/result.json`, `zoom/*.png`）。この検証もCIの実行対象へ追加した。

固定後の `node scripts/ui/arena-flow.mjs` は91件成功（exit 0、`arena-final.log`）。その実行中に追加した最後の44px CSS調整は、最新の復帰試験と独立レビューC4で再確認した。独立検証の詳細は [fixes-independent.md](fixes-independent.md)。主要タスク・R1〜R4は実施範囲でPASS、1440/390pxで44px未満の操作要素0、横はみ出し・ページエラーなし。独立担当自身が未実施の200%試験は、本報告の別担当の実測証拠で補完している。

修正ラウンド1では再接続後の通知が残り、回帰試験がexit 1になった（`recovery-round1-fail.log`）。通知消去と再読込後のモード表示を修正したラウンド2では同じ検証が成功。期待値を緩めず、失敗証拠を残している。ラウンド3では独立レビューの追加指摘に従い結果アクションと例文の44px操作領域を確保し、関連ブラウザ試験を再実行した。最終ソース識別は `source-manifest.json`、コマンド判定は `evidence.json` に記録する。

## 適用範囲と残る検証

一つのタブの練習を安全に続けるための修正であり、別タブ・外部APIクライアントによる意図的な並列実行を禁止する変更ではない。APIのプロセスを跨ぐ永続的なexactly-onceを新たに保証しない。

OS日本語IME、実機Safari/ネイティブ、スクリーンリーダーの実操作、人間の初見評価、競合製品との同条件比較、実電話/有料モデルの実結果は別途の環境・協力者・権限が必要。これらはBLOCKEDであり、ローカルの修正成功で代用しない。実ユーザーの成功率や競合への優越、製品全体のリリース可否を合格とは判定しない。

承認待ち・課金・実予約は今回のローカルシミュレータのフローではNOT_APPLICABLE。製品全体の外部モードを対象外とする意味ではない。
