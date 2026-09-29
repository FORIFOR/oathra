# OSS主要タスク改善・検証記録（2026-09-19）

## 対象と判定範囲

主要タスクは「ローカル練習通話 → 相手の発言に基づく結果と証拠の確認 → 保存・再確認」。入力は同梱シナリオ、または初画面で編集した店員役の返答。成果物は契約・結果・発話・証拠・決定メモを含むJSONとローカルの通話記録。実予約の成立を成功条件にしない。

基点: `25b49fb65015d6d5da3ceacaf4682c1b39e9bfc4`、ブランチ `feat/arena-one-screen`。未コミットの既存UI編集を含む。開始時差分は `artifacts/quality/user-before.patch` と `user-board-before.css` に退避。既存編集の上に限定変更し、push/merge/公開/発信/投稿/外部モデル呼出しは行っていない。途中で別作業のコミット `d330530d6fa4e94c4160554b6b88e7d846c45fd1` にHEADが進んだ。このコミットは本改善で作成していない。対象ソースの最終ハッシュは `artifacts/quality/source-manifest.json`。

環境: macOS Darwin arm64、Node v25.2.1、pnpm 10.12.2、Chrome 153.0.8010.53 headless。Node22での別ランタイム試験は未実施。ブラウザ試験は製品の実サーバと組み込みシミュレータを使用。新しいモック/スタブ/架空録音は追加していない。書込障害は一時ディレクトリ内で保存先と同名のファイルを作り実ENOTDIRを発生させた。通信断は実サーバのHTTP接続を閉じ、同じプロセスでlistenを再開して検証した。

指定Skill4件は導入済みカタログ・ローカルSkill/プラグイン探索で見つからず、未使用。独立検証は別エージェントコンテキストで行い、[独立記録](independent-review.md)に保存した。これは実ユーザー評価ではない。

## 改善ラウンド

1. [既存の合格条件](../design/ui/acceptance.md)にQ1–Q8を固定。保存エラー隠蔽、取消要求の未接続、Origin未検証を修正。既定demoをscripted限定にし、明示的 `--allow-models` を設けた。実行状態・結果判定・保存状態を分離、保存だけ再試行とJSON出力を追加。
2. 独立レビューでlive/replay出力形式と再生URLの不整合を発見・修正。保存当時の契約で再生。外部処理の未照合を「誤完了0」としない。冪等キーとURLで同じ通話に復帰する。開始応答を失った場合は要求キーを読み取り専用で照会し、再POSTや別の入力を勝手に開始しない。
3. 実画面で復帰後の古いエラートーストを発見して解消。再読込時のモード選択を同期。初画面に編集できる例文を加え、既存Play入力へ引き継ぐ（自動送信しない）。SDK例・導入・README・[互換性契約](arena-contract.md)を整合。

## 主張と実装の対応

| 主張 | 実装・観測 | 判定と限界 |
|---|---|---|
| APIキーなしで最初の結果を確認 | CLI demo→Arena→ScriptedAgent→runScenario→CallRuntime→EvidenceEngine | PASS、製品シミュレータ。実電話/LLM能力の証明ではない |
| 相手の言葉だけが証拠 | evidence/evaluate、既存実録音のCLI/SDK一致、満席シナリオの未完了 | PASS、対応する日英ルールの範囲。現実の予約台帳は未確認 |
| 保存して再確認できる | replay/saveCall、保存状態、artifact、保存失敗からの再試行 | PASS、ファイル内容まで照合。fsync/トランザクション保証なし |
| 取消・通信復帰 | Runtime.cancel、same-call GET/SSE、冪等開始 | PASS、ローカルArena。外部確定済み操作の巻戻しは主張しない |
| 他の開発者が組み込める | 公開 `oathra/evidence`、CLI exit code、実録音由来のSDK例 | PASS、対象公開APIの範囲。Arena HTTPはexperimental |
| 全外部Provider/実予約システム対応 | Provider実装と既存テストはある。予約台帳Adapterは同梱されていない | BLOCKED、外部権限/実アカウント検証なし。既存モックテストの成功を接続済みとはしない |
| 既存の優れた製品に匹敵する初回成功 | 成功・手間・復帰性の比較軸を固定した | BLOCKED、同条件での他製品実測と実ユーザー評価は未実施。優越を主張しない |

## 実行証拠

すべてリポジトリルートで実行。ログ・画像は `artifacts/quality/`。未実施はexit codeを割り当てない。

| コマンド/確認 | exit code | 結果・証拠 |
|---|---|---|
| `pnpm build` | 0 | PASS `build.log` |
| `node scripts/bundle-cli.mjs`（最後のCSS修正後） | 0 | PASS `bundle.log`、最終UI試験は更新後アセットで起動 |
| 保存リンクの色（実Chrome、ダーク/ライト） | 0 | PASS `download-color.log`, `download-dark.png`, `download-light.png`。主要フロー後の表示修正。両テーマの色を再試験し、即時取消の空会話表示も追加復帰試験で確認 |
| `pnpm typecheck` | 0 | PASS `typecheck.log` |
| `pnpm test` | 0 | PASS 37ファイル、945成功・1スキップ。`test.log`。スキップを成功扱いしない |
| `pnpm lint:deps` | 0 | PASS `dependencies.log`、Core/Adapter/UIの既存依存方向を維持 |
| `node scripts/verify-arena-outcome.mjs` | 0 | PASS `outcome.log`。実HTTPでOrigin拒否、入力拒否、同時同一キー1通話、異入力409、両モード取消、終了後reply拒否、保存失敗、保存だけ復帰、ファイル・live・replay出力一致 |
| `node scripts/export-recorded-check.mjs`、CLI verify、SDK verifyTranscript比較 | 0 | PASS `recorded-input.json`, `cli-result.json`, `sdk.log`。既存GPT-4o mini/シミュレータ記録、実ホテルではない |
| `examples/verify-recording.mjs`を一時hostから実行 | 0 | PASS `sdk-example.log`。ローカル公開package exports経由、CLI結果と同一。ネットから再インストールしていない |
| `OATHRA_UI_ARTIFACTS=artifacts/quality/final node scripts/ui/arena-flow.mjs` | 0 | PASS 91項目、 `arena-flow.log`、新画像はfinal/（既存画像は上書きしない） |
| `OATHRA_UI_ARTIFACTS=artifacts/quality/primary node scripts/ui/gateway-flow.mjs` | 0 | PASS 49項目、`gateway-flow.log` |
| `node scripts/ui/arena-recovery.mjs` | 0 | PASS、 `recovery.log`、arena-disconnected/result/mobile/reflow-200/narrow.png |

試験基盤の初回2回はCDP offline指定だけではlocalhostのSSEを確実に切断できず、回復表示待ちがtimeout（exit1）。`recovery-round1.log`, `recovery-round2.log`に保持。期待値を緩めず、実サーバ切断に切り替えた。例文入口追加時の1280×800 overflowは `arena-flow-round3.log` に保持し、同じ合格条件で再検証した。

## 未達条件

- BLOCKED: OS日本語IMEの実変換確定操作。composition中送信を防ぐ実装は追加したが、CDPの日本語文字挿入はIME試験の代用にならない。
- BLOCKED: 実ブラウザの200%ズーム。720×450のreflow相当と320/390幅は実施、ズーム操作そのものの保証ではない。
- BLOCKED: 初学者の実ユーザー評価、他製品との同一タスク比較、全スクリーンリーダー/コントラスト適合、実iPhone Safari。
- BLOCKED: 実発信、外部モデル、外部認証/費用/予約台帳結果。許可・実アカウントが必要。
- NOT_APPLICABLE: このローカルシミュレータフローの外部承認待ち状態。Gatewayの既存承認は別フローで回帰確認。
- NOT_APPLICABLE: ネイティブアプリの合格判定（今回の対象はWeb Arena）。ネイティブ品質は未確認でありWeb成功から推定しない。
- 制約: 冪等キーはプロセス内のみ。再起動後の自動再実行禁止。返信POSTのexactly-once保証はない。未保存のメモリ上結果はサーバ終了で失われる。これらを公開契約に記載した。

全体の品質目標は、上記BLOCKEDを含むため全面PASSとは判定しない。ローカル主要タスクについて実行済みの項目だけをPASSとする。

## 画面の目視確認

実装担当が `arena-result.png`, `arena-disconnected.png`, `arena-mobile.png`, `arena-reflow-200.png` を画像として開いた。切断時の常設案内、保存済みと未完了の併記、スマホで折り返した保存操作を確認。追加した例文入口で1280×800の左列に12pxのoverflowを検出。判定を緩めず、例文入口と過去通話を同じ行に配置して再検証した。初回画像に残っていた古い失敗トーストは復帰時に消去する修正を入れ、最終再撮影では表示されない。画像は画面内の見え方の証拠で、保存内容の証拠は実API/ファイル照合を使う。実際に起動・取消したローカルシミュレータの成果物と保存メモも `verified-outcome.json` / `verified-summary.md` に保持した。

## 固定条件への対応

| 条件 | 判定 | 範囲 |
|---|---|---|
| Q1 | PASS | ローカル既定起動、外部モデルの明示的有効化 |
| Q2 | PASS | 初画面の説明・編集例文→実Play入力・保存操作。初心者の理解度そのものは未測定 |
| Q3 | PASS | 実保存障害・保存だけの復帰・JSON/保存メモ照合 |
| Q4 | PASS | 実HTTPの重複抑止と取消、実切断からの復帰、再読込。開始応答だけの喪失はAPIとコード確認の範囲 |
| Q5 | PASS | 既存録音で公開SDK/CLI一致、互換性説明 |
| Q6 | BLOCKED | 画面幅・キーボード・長文・reduced motionは実施。OS IME/実200%ズームは未実施 |
| Q7 | PASS | build/typecheck/testとArena91項目・Gateway49項目・追加復帰試験が成功。1 skippedは除外 |
| Q8 | BLOCKED | 独立エージェントの監査は実施。実ユーザー・外部結果は未実施 |

最終画像でブラウザ既定色の保存リンクを検出し、既存ボタンと同じ文字色へ修正した。また発話前に取消した通話に「発信中」が残る表示を修正し、「会話はありません」への更新を実ブラウザの追加回帰試験で確認した。主要フロー実行時点は `source-manifest-before-color.json`、この2件の表示修正後は `source-manifest.json`。両テーマの色と、最終コードの復帰フローを実Chromeで再確認した。実行ログの対応は `executions.json`。
