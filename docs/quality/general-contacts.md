# 一般連絡先: 契約と検証

Arena の「連絡先」または `?lang=ja&contacts=1` から登録する。名前または会社名が必須で、電話・メール・その他メモ・前回の電話内容は任意。前回内容は手入力であり、実施していない通話の自動要約ではない。登録は発信を許可しない。電話番号のある保存済み連絡先だけを電話依頼に転記でき、メモをAIへの指示へ自動転記しない。

Core: `@oathra/contract` の ContactInputSchema / ContactUpdateSchema / ContactRecordSchema。既存0.1.xへの追加、experimental。既存電話正規化を利用。Arena AdapterはGET/POST `/api/contacts`、GET/PUT `/api/contacts/:id`。作成201、取得更新200、入力400、未存在404、競合409、保存破損500。PUTは現行revision必須。登録だけで通話やイベントを生成しない。UIは受付と保存成功を区別し、保存失敗時は入力を維持する。

標準保存先 `.oathra/contacts`、JSONは平文、ファイル0600・新規ディレクトリ0700。置換はatomic、複数プロセスの保存はlockで排他。プロセス強制終了で`.write-lock`が残ると409で停止する。同じ保存先を使う全サーバーを停止し、保存ファイルを確認してから残存lockディレクトリを手動で取り除く。自動再試行で上書きしない。

履歴は保存済み通話の電話番号で照合し、共有番号では他人の通話を含み得る旨を表示する。日時は保存ファイル更新日時であり通話開始日時ではない。履歴読込失敗はhistoryErrorを表示し、連絡先編集を維持する。

Gateway設定画面も同じ一般項目を保存できる。Gatewayは別の保存領域で、Arenaとの自動同期はない。LINE等の名前解決で電話番号がない場合は追加を案内する。営業発信の許可は登録時必須でなくなったが、承認・実行時の検証を維持する。実LINEへの送信は今回実行していない。

## 証拠

対象HEAD `d56ec10306f70d68fd07dae1480c176a3aa7b20d` ＋ローカル差分（作業中の最新revisionへ追従）。macOS、Node 25.2.1、pnpm 10.12.2、ローカルChrome。実行ログは `artifacts/quality/general-contacts/`。一時保存先で検証し、利用者の連絡先を変更していない。

|検証|期待／観測|判定|exit code・証拠|
|---|---|---|---|
|build / typecheck|コンパイル成功|PASS|0、build.log / typecheck.log|
|pnpm test|既存回帰を含め998 passed、1 skipped|PASS|0、tests.log。skipは未実施|
|Arena実ブラウザ contacts.mjs|会社名のみ保存・メモ一致・編集・サーバー再起動後一致・電話操作無効・通話0件|PASS|0、ui.log|
|1280/390/640px、Tab、reduced motion|横溢れなし・次欄へ移動|PASS|0、ui.log、contacts-*.png（画像視認済み）|
|Gateway tests / browser|207テスト、52ブラウザ項目|PASS|0、gateway/tests.log、gateway/ui.log|
|実IME・読み上げ・実Chrome200%ズーム|今回の新フォームでは未検証。640px試験では代用しない|BLOCKED|OS入力／支援技術の手動検証が残る|
|実電話・実LINE送信|外部送信の許可がない|BLOCKED|未実施|
|ネイティブアプリ|本変更はWeb|NOT_APPLICABLE|—|

実装担当とは別の検証担当が静的レビューと実HTTP再現を実施。履歴破損で詳細500となる問題を発見し、親担当とBackend担当が修正した。実ユーザーの初見評価や競合製品との優位性を示すものではない。

## 操作改善の追記

連絡先表示中はシミュレーターの練習一覧を隠す。スマホでは一覧と編集を切り替え、初回は直接入力できる。「連絡先一覧へ」で戻っても未保存内容は保持し「入力中の内容に戻る」で復帰する。電話番号なしでは電話依頼ボタンを非表示、メールとその他メモは折りたたみ、保存は画面下へ固定。`scripts/ui/contacts.mjs` に非表示・一覧往復・未保存保持・保存ボタンの画面内配置を追加して実Chromeで確認した。今回の操作改善も人間の初見評価は未実施。
