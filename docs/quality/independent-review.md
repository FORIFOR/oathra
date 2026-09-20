# 独立した製品検証

実施日: 2026-09-19。実装担当とは別の子エージェントによる監査。`independent-product-verification` Skill は未導入で、使用していない。実装ファイルは変更せず、この証拠文書だけを追加した。

対象: HEAD `25b49fb65015d6d5da3ceacaf4682c1b39e9bfc4` と未コミットの Arena 改善。環境: macOS 26.6.2 (25G83)、Node v25.2.1、Google Chrome 153.0.8010.53。ブラウザは実際の Chrome の headless モード。製品付属の ScriptedAgent と SimulatorTransport、実際のローカル HTTP サーバー・ファイルシステムを使用。外部モデル、実発信、第三者データ送信なし。モックは追加していない。

## 第1ラウンドの指摘と再判定

| 項目 | 初回 | 再判定 | 観測・方法 |
|---|---|---|---|
| 保存失敗が完了として隠れる | FAIL | PASS | 書込先を実ファイルで塞ぎ、persistence=failed を確認。障害を解除して保存だけ再試行。通話件数を増やさずディスク result.json、summary.md、再生結果が一致。 |
| watch の hangup が何もしない | FAIL | PASS | 修正前は200の後もrunning、終了理由agent_hangup。修正後はplay/watch両方でendReason=cancelled。 |
| foreign Origin の開始要求を受け入れる | FAIL | PASS | 修正前はforeign Originとtext/plainの開始要求が201。修正後は403。既定CLIのbrain登録をscriptedのみに変更したこともコード確認。 |
| 過去通話に現在のシナリオ契約を適用する | FAIL | PASS | openReplayが保存contractのrequire/constraints/intakeを優先することをコード確認。Chromeで保存済み通話を再生できることも確認。シナリオファイルを改変する試験は未実施。 |
| 人間応答で独立照合未実施なのに誤完了0と表示 | FAIL | PASS | 390×844の実Chromeでplayを開始・取消し、結果に「独立した照合は未実施」が表示されることを確認。これはUI表示の是正であり、評価エンジン全体にtruthの存在状態を追加したという意味ではない。 |

## 実行記録

1. `node scripts/verify-arena-outcome.mjs` — exit 0。独立担当として2回実行。第2回にはlive/replay artifactの全体一致検証も含む。stdout: `PASS: origin, validation, concurrent idempotency, conflict, play/watch cancellation, ended reply, failed save, download, save-only recovery, disk and replay equality`。
2. `node --input-type=module` の一時スクリプト — exit 0。`startArena`、`ScriptedAgent`、`scripts/ui/cdp.mjs` の `launch({width:390,height:844})` を使用。`?lang=ja` を開き、playモード、restaurant-reservation、hangupをUIから操作。保存表示、未照合表示、横スクロールなし、APIの終了理由、ダウンロード結果の一致、`?replay=<id>`で結果表示をassert。`pageErrors=[]`。対象通話: `call_mu868pfwl6dm`。一時保存領域は終了時削除。
3. `node --input-type=module` の別の一時スクリプト — exit 0。2件の実ローカル通話を作成・取消・保存し、Chromeでlive画面から過去通話を開く。更新後のURLに`replay=<表示中ID>`、成果物リンクに`/api/replays/<同ID>/artifact`が反映されることを観測。対象ID: `call_mu869dpy51as`。一時保存領域は終了時削除。

ツール出力の証拠: 初回実再現 `0d565a` / `782ac9` / `f95196`、第1ラウンドAPI検証 `7c9f36` / `e5eaad`、Chrome検証 `94ff08`、再生URL確認 `35704a`、成果物統一後のAPI再検証 `63c2e3` / `77f90e`。出力をこの文書に要約して保存した。スクリーンショットによる成果物一致の代用はしていない。

## 改善中に追加で見つかった項目

- PASS: 同じ「証拠JSONを保存」がliveとreplayで異なる形状を返していた。共通形状のreplay artifactが追加され、第2回API検証で全体一致を確認。
- PASS: 過去通話を選択してもURLが以前のcall IDのまま残る経路があった。openReplay成功時のURL更新が追加され、Chromeで表示中IDとの整合を確認。
- PASS（コード確認＋ローカルAPI再検証）: replay artifactのtransport固定は修正済み。保存された`call.started.transport`を返し、開始イベントがなければ`unknown`となる。TypeScriptと実行対象distの両方で確認。実ローカルSimulator通話のlive/replay成果物全体一致も再確認した。実電話の保存記録による動作試験は権限範囲外で未実施。

## 最終独立監査

最終確認時のHEADは `d330530d6fa4e94c4160554b6b88e7d846c45fd1` と未コミット変更。先の監査後にHEADが移動していたため、先のrevisionを最終対象として流用しない。環境はmacOS 26.6.2、Node v25.2.1。

- PASS: `node scripts/verify-arena-outcome.mjs` — exit 0。実ローカルHTTPサーバー、製品付属Simulator、実ファイルシステムで再実行。既知の`GET /api/requests/outcome-run-0001`が作成済みcall IDを返し、未知キーが404となる。並行した同一キーのPOSTでも通話件数1件、異なる入力は409。保存障害と保存のみの復帰、取消、ディスクとlive/replay成果物全体一致も通過。証拠: ツール出力`f87320`（stdout）と`5eb7a9`（exit 0）。
- PASS（コード確認）: 開始応答不明時の再確認ボタンは`GET /api/requests/:key`のみを送る。既知キーはcall URLへ移動して既存通話を読む。404時はpendingを解除して過去通話の確認を案内するだけで、自動POSTしない。pendingがある間は`startCall`がPOST前にreturnし、ページ初期化もautostart前にreturnする。開始応答を実ネットワークで喪失させるブラウザ故障注入は、この最終監査では実施していない。
- 新しいモック、外部通信、実発信、実装変更なし。この最終担当が更新したのは本報告文書のみ。

監査対象ファイルのSHA-256（最終確認時）:

```text
330cd8be3eabcd8196a2c65b6688ce62ee6eb38519fd3ed0e544db5ae5b86e81  apps/arena/src/server.ts
4f6020363c3f21db9b1489ae0112c854637e8bd25c82b02bbf7a13af67bf8ddb  apps/arena/public/app.js
c5c371b09a9b5ea7d5b7bf0e3527f5e653299f45d41c2b1bf90ab89cdd0c5ba2  scripts/verify-arena-outcome.mjs
```

## 検証の限界

- BLOCKED: 日本語IMEの実入力装置・実OS入力モードでの検証。この独立担当は実IME操作を行っていない。
- BLOCKED: 実ユーザーによる初回成功・既存製品との同条件の比較。AI評価で代替していない。
- BLOCKED: 外部モデル、実電話、課金や外部権限を必要とする処理。今回の権限範囲外。
- NOT_APPLICABLE: ネイティブアプリの品質判定。今回の主要タスクはWeb Arena。
- この独立監査は全UI条件の網羅判定ではない。200%拡大、長文、キーボード全経路、reduced motionなどの本体検証は実装担当の別証拠を参照し、この文書では未実施をPASSとして扱わない。
