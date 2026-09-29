# 独立再監査 — ローカル電話練習

2026-09-19。別エージェントによる初見AI探索であり、人間のユーザビリティ評価ではない。Pass Aではタスク「ローカルの電話練習で相手の発言に基づく結果を確認し、成果物を保存し再確認する」、安全な起動情報、汎用CDP helper、監査Skillのみ参照した。アプリ実装・既存監査・既存flowテストはPass A終了後に読んだ。アプリコード変更なし。

主フローは成立した。相手の確定発言、結果、保存JSON、ディスク上のresult.jsonが一致し、再読込後にも履歴から再表示できた。一方、通話中の戻る操作で稼働中の通話が取り残される問題と、「明日」と固定日付の不整合が残る。

## 環境・再現条件

- revision: `d330530d6fa4e94c4160554b6b88e7d846c45fd1`＋未コミット変更。対象差分とSHA256は証拠の `reviewed.diff` / `revision-sha256.txt`。
- macOS Darwin 25.6.0、Node v25.2.1、HeadlessChrome 153.0.0.0、新規Chromeプロファイル。1440×900 / 390×844。
- 新規一時ディレクトリをcwdに `node /Users/horioshuuhei/Projects/RingZero/packages/cli/dist/bin.js demo --no-open --port 52851`。既存ビルド使用。依存物・モデルDL・アカウント準備は行っていないため導入時間に含めない。
- APIキーなし、`--allow-models`なし、実電話発信・外部モデル利用なし。製品の組み込みシミュレータを実行。追加モック、捏造通話記録なし。編集した店員返答は実UIの練習入力。
- 証拠ディレクトリ: `artifacts/quality/reaudit/independent/`。取得情報は `session-info.json`。Pass A終了: 2026-09-19T09:44:35Z。

## 証拠付き判定

以下のenvironmentは上記環境。個別差分はmethodに併記。

| id | method | expected | observed | status | evidence | environment |
|---|---|---|---|---|---|---|
| A01 | 初期画面だけから電話を選択 | 助言なしに練習開始 | レストラン予約を選び開始。会話の進捗と証拠が表示 | PASS | 01-entry.png, 02-running.png | desktop、新規cwd |
| A02 | 会話完了まで観測 | 相手の発言に基づく結果 | 約43秒で完了。相手の「ご予約承り」、19:30、2名、日付を結果と照合 | PASS | 04-completed.png/txt, saved-artifact.json | desktop、watch |
| A03 | UIの保存リンク先をHTTP取得しファイル保存、実ディスクと比較 | 証拠を保存できる | HTTP 200、attachment JSON。resultは実ディスクresult.jsonと一致 | PASS | saved-artifact.json, disk-result.json, checks.json | HTTP取得による保存。OS保存ダイアログは未試験 |
| A04 | ページ再読込→過去の通話→対象選択 | 保存結果を再確認 | 同一call IDの完了・会話・証拠が再表示 | PASS | 05-reopened.png/txt | desktop |
| A05 | 練習例文編集→練習開始→戻る→再度開始 | 入力を引き継ぐ | 編集返答をplay入力に転記、戻る後もstarter入力に保持 | PASS | checks.json, 06-cancel-dialog.png | 入力転記のみ。送信発話の成立は別途未確認 |
| A06 | play通話で明示的に「切る」 | 完了を捏造せず停止・保存 | endReason=cancelled、complete=false、ローカル保存 | PASS | 07-hangup.png/txt, hangup-artifact.json, 10-call-details.json | desktop、play |
| A07 | 通話中に←→一覧から別の練習を開始 | 稼働中の通話を把握・再確認できる | 元通話running、後続通話done。元通話は過去の通話に出ず、明示的な継続導線がない | FAIL | 10-call-states.json, 10-call-details.json | desktop、play。P2 |
| A08 | 表示ミッションと会話・成果物を照合 | 「明日」の日付が一致 | 9月19日実行で「明日」だが9月12日で完了 | FAIL | 04-completed.txt, saved-artifact.json | P2。固定シミュレーション日付の明示なし |
| A09 | 390px表示と横幅の実測、実画像確認 | 横溢れなし | 横溢れなし。結果は縦スクロール先。「スコアと内訳」は32px高 | PASS | 08-mobile-result.png | 390×844、限定レイアウト検証 |
| A10 | 編集入力からTabで次の操作へ | フォーカスが見える | starter-runに移動しoutline=true | PASS | 本報告の観測記録 | desktop、限定キーボード検証 |
| B01 | 実装照合 | 保存・取消が実状態と対応 | APIの保存読込、hangup→cancel、戻るはcloseStream＋showのみを確認 | PASS | reviewed.diff、app.js:1025、server.ts:277付近 | 静的レビュー |
| B03 | サーバー停止→同一cwdで再起動→履歴再表示 | プロセス終了後も保存結果を保持 | 復元resultがディスクと一致し、実画面の履歴から再表示 | PASS | 11-server-restarted.json/png | desktop、同一cwd、新プロセス |
| B02 | 音声実機・日本語IME・読み上げ・200%・接続切断 | 対応した実測 | この担当の限定監査では未実施 | BLOCKED | 実測証拠なし | 別途検証が必要 |

## 修正要求

**P2: 戻る操作で進行中の通話が画面から取り残される。** 編集例文から練習を開く→左上←→再度練習を開く。最初の `call_mu8790c6itzq` は後続の通話終了後にもrunningだった。`app.js:1025`はイベント購読を閉じて一覧を表示するだけ。未完了通話を一覧から再開できる導線、または終了する選択を設け、背景の通話を把握できるようにする。監査終了時は既存hangup APIで当該シミュレータ通話を停止した。

**P2: 「明日」が固定日付のまま。** 2026-09-19にレストラン予約を実行すると「明日」と説明するが2026-09-12の予約が完了になる。`scenarios/restaurant/restaurant-reservation.yaml:12-23`には相対表現のbriefと固定input/constraintsがある。シミュレーション基準日を画面で明示するか、説明を固定日付と整合させる。

## 視覚・範囲の限界

01-entry、04-completed、08-mobile-resultの画像を実際に開いて確認した。入口の主操作と結果の配置は明瞭。デスクトップの会話欄では長い相手名が狭い列で細かく改行され、証拠ラベルにconfirmed/time等の英語キーが残る。これは主タスクを阻害する欠陥とは分けた改善提案。

送信クリック後すぐの観測・取消では編集した返答の会話反映を確認できていない。入力転記・保持のPASSから送信成功を推定しない。ブラウザーのconsole errorは観測範囲で0。通話録音の再生、実通信のパケット監査、費用の独立照会は未実施。ビルド・typecheck・全体E2Eは親担当の証拠と併せて判断し、本担当は未実施をPASSにしない。競合優位・アクセシビリティ完全準拠・人間ユーザーの成功率は判定していない。

Pass A終了後に親担当から、120ms間隔の二重開始で2通話作成、JSON nullのPOST /api/callsで500となる観測の共有を受けた。本独立探索の観測には混ぜず、親担当の `artifacts/quality/reaudit/edge-results.json` / `double-start.png` を別の証拠として扱う。監査プロセスとブラウザーは終了済み。一時保存された製品成果物は証拠JSONに複写した。
