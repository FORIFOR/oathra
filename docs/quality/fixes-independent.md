# 修正の独立検証 — 2026-09-19

判定: 今回の修正条件 R1〜R4 と主要タスクは、下記の実施範囲で PASS。P0/P1は観測しなかった。全製品・全アクセシビリティの合格を意味しない。

実装担当と別コンテキストのAIが検証した。実ユーザー評価ではない。アプリの変更は行っていない。Pass Aでは実装、既存報告、専用flowを読まず、ユーザータスク、起動方法、汎用CDPのみから探索した。Pass Bでacceptanceと差分を確認した。新規モック・架空通話記録は加えていない。同梱の製品シミュレータとその実出力を使用。

## 環境と再現

- 対象 HEAD: `d330530d6fa4e94c4160554b6b88e7d846c45fd1` + 未コミット差分。最終差分とSHA256は `artifacts/quality/fixes/independent/reviewed.diff` / `revision-sha256.txt`。
- Darwin 25.6.0、Node v25.2.1、Google Chrome 153.0.8010.53 headless、CDP。1440×900 / 1280×800 / 390×844 / 640×800。
- 新規一時cwd: `/var/folders/qy/086ttpq57jsd36jnc1jffst00000gn/T/ringzero-independent-85FPSs`。
- 起動: `node /Users/horioshuuhei/Projects/RingZero/packages/cli/dist/bin.js demo --no-open --port 53673`。APIキー、`--allow-models`なし。既存build/依存物を使用し、依存物DL・モデルDL・アカウント準備の時間は含まない。
- 最初の探索中に実装担当からUI更新の連絡があり、結果保存後の再読込以降は最新アプリ。最終復帰確認でも再読込した。その後、タッチ領域だけのCSS修正を受け、1440px/390pxで再読込して再測定・画像確認した。
- コマンド、HTTP応答、画面テキスト、時刻は `artifacts/quality/fixes/independent/exploration.jsonl`。一般のDOM操作で探索した。途中の探索スクリプト失敗（非同期履歴表示前のクリック、保存ファイルのパス誤認）は製品不具合ではなく、待機・実ディレクトリ確認後にやり直した。

## チェック

以下の証拠パスはすべて `artifacts/quality/fixes/independent/` 基準。環境は上記。

| ID | method | expected | observed | status | evidence |
|---|---|---|---|---|---|
| A1 / Q1 | 新規cwd起動、実HTTP brains照会 | キー不要、既定で外部モデルなし | 起動成功、brainsはscriptedのみ | PASS | environment.json、exploration.jsonl |
| A2 | 初画面からレストランを選択、完了まで観察 | 相手の了承前は未確定、了承後に完了 | 開始時証拠0、AI提案は未確定、相手の予約承り後に完了 | PASS | 01-initial.png、02-call.png、03-switch-protected.png、downloaded-artifact.json |
| A3 / R1 | 通話途中に戻る→別シナリオ選択 | 元の通話を失わず新規開始を抑止 | レストラン通話へ復帰、進行中通知 | PASS | 03-switch-protected.png、exploration.jsonl |
| A4 | 保存リンク先の実HTTP取得、保存ファイル照合、再読込→履歴再生 | JSONと保存結果一致、再確認可能 | 200 attachment、result完全一致。履歴で同じ会話・2026-09-12 / 19:30 / 2名 / 確定を再表示 | PASS | downloaded-artifact.json、persisted-call/、05-history.png、06-reopened.png |
| B1 / R1 | play開始を120ms間隔で2回、API件数確認 | 稼働通話が1件のみ | 総数2: 過去の完了1 + 稼働play1 | PASS | exploration.jsonl、07-resumed.png |
| B2 / R1 | 再読込、戻る→過去通話閲覧→進行中へ戻る→再読込 | 同じIDとモードを復元 | call_mu87r3g1sccmを維持、play選択true / watch false、シナリオ選択一致 | PASS | 07-resumed.png、exploration.jsonl |
| B3 / R2 | null / array / malformed JSON / number / scenarioId数値 / speed文字列 / 未知modeを実HTTP送信 | 4xx、通話増加なし | 全7件400 INVALID_INPUT、前後2件 | PASS | exploration.jsonl |
| B4 / R3 | 日本語UIと成果物、英語の実シミュレータ実行を照合 | 説明と結果の日付一致 | 日本語・英語とも2026-09-12。英語の結果もcomplete、19:30 / 2名 / confirmed | PASS | downloaded-artifact.json、english-call.json、06-reopened.png |
| B5 / R4 | CIとpackage scriptsの静的確認 | 新設回帰がCI実行対象 | CIにpnpm test:arena-outcome、そのscriptはbuild/HTTP検証/ブラウザ回復検証を含む | PASS（静的） | reviewed.diff |
| B6 | pnpm typecheck | exit 0 | exit 0、全出力確認 | PASS | typecheck.log、typecheck.exit |
| C1 | 実画像を開いて確認 | 読める会話、証拠、復帰・終了表示 | 初画面、最新再生、復帰、狭幅、中止画面を目視。文字の重なりなし | PASS（当該画像） | 01、05〜11のPNG |
| C2 | 390px / 640px CSS幅、reduced motion有効、Tab/Enter実キー | 横はみ出しなし、送信可能 | 横スクロールなし、送信ボタンへTab、focus outlineあり、Enterで相手発話開始イベント発生 | PASS（限定） | 08-mobile.png、10-reflow.png、exploration.jsonl |
| C3 | 切るをクリック、サーバー結果確認 | 取消を完了成功と誤表示しない | done / saved / endReason cancelled / result incomplete、画面は未完了 | PASS | 09-cancelled.png、exploration.jsonl |
| C4 | 操作要素の実測→修正後再読込 | プロジェクト推奨44px | 当初40px/20pxを報告。修正後は例文summary・スコアsummary・DL・3ボタンすべて44px。1440/390幅で44px未満0、横はみ出しなし | PASS（修正後） | exploration.jsonl、11-save-actions.png（修正前）、12-final-desktop.png / 13-final-mobile.png（修正後） |
| L1 | 未実施領域の明示 | 未実施を合格にしない | OS日本語IME、読み上げ、実ユーザー、実電話、実機Safari、実際のブラウザ200%ズーム未実施 | BLOCKED | 本報告 |
| L2 | 今回の担当範囲 | 全CI、build、全test、通信断・保存障害を独自再実行 | typecheck以外は本独立検証では再実行していない。実装担当の結果と混同しない | NOT_APPLICABLE（今回の独立検証範囲外） | 本報告 |

## 所見

主タスクは成立した。既存callの確認に戻る導線が残り、120ms連打、別シナリオ、履歴閲覧、再読込によって通話が増殖する挙動は今回観測しなかった。取消結果と保存状態も区別される。

タッチ領域の軽微な指摘は実装担当の修正後に解消を確認した。44pxはプロジェクト推奨であり、この測定だけでWCAG全体への適合とは断定しない。狭幅の長いシナリオ名は省略されるため、初見の選びやすさは人間での確認を残す。競合との同条件比較はしておらず、優位性を判定していない。

JSON保存は画面のリンク先を実HTTPで取得して証拠ディレクトリへ保存し、ディスクの保存結果と比較した。OSの保存ダイアログやブラウザのダウンロード履歴までを操作した試験ではない。
