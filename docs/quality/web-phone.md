# Web発信・目的テンプレート・履歴 — experimental

## 合格条件と範囲

主要タスクは「番号・相手・目的を入力し、確認・承認してAIに電話を依頼し、状況と結果を確認する」。成果物は保存済み依頼、文字起こし、終了結果。予約の確定・購入・支払いは対象外。CoreのPhoneRequestをCLIとWebで共用し、Arenaは状態保存と表示、CLIのPhoneDialerが音声・電話Adapterを接続する。

| 条件 | 測定環境・方法 | 期待結果・証拠 | 判定 |
| --- | --- | --- | --- |
| 入力→確認→保存 | macOS/Chrome、実ローカルHTTP/fs、設定済み自分の番号を入力値だけに使用 | 入力と保存が一致、未承認/未設定では発信拒否。browser.log、phone-input.log | PASS |
| 目的テンプレート | Core契約＋Chrome | 12種類、未置換項目は拒否、編集可。tests.log、browser.log | PASS |
| 履歴を使う | 実fs保存、再起動、Chrome | 目的だけ/相手も選択可能、再確認必須、再利用だけでは発信しない。browser.log | PASS |
| 認可・重複防止・復帰 | ローカル境界試験＋独立静的レビュー | 10分期限、同一review再発信なし、不明結果はunknown、設定変更で再確認。independent.md | PASS（実回線未検証） |
| 表示幅 | Chrome 1280px/390px | 横溢れなし。desktop.png、mobile.png | PASS |
| キーボード入力 | Chrome、phone-input.mjs | 番号・名前・目的の入力と確認。phone-input.log | PASS |
| 実OS日本語IME、200%拡大、reduced motionで新規全フロー | 今回のWeb発信画面では未実施 | 実入力・フォーカス・再配置が必要 | BLOCKED |
| 実電話の会話・切断・課金 | Twilio/OpenAI実回線 | 接続先未設定かつ実発信未承認。成功応答のテストで代用しない | BLOCKED |
| 初見の人の自力成功 | 実ユーザー | AIレビューでは代用しない | BLOCKED |
| ネイティブOS専用試験 | Web機能のみ | ネイティブアプリ変更なし | NOT_APPLICABLE |

証拠ルートは `artifacts/quality/web-phone/`。見た目や競合製品より優れているとの評価は行わない。従来のCLI経由JSON引き継ぎに対し、設定済み環境ではWeb内の入力→確認→発信へ操作を集約した。実ユーザーの所要時間比較は未測定。

## 契約と互換性

対象は0.1.18開発版の未コミット差分。既存PhoneRequest v1を拡張せず利用。未置換 `{{項目}}` のある目的は新たに入力エラーとなる。Web発信と以下のAPIはexperimental。既存CLIのrequest-file/approve-requestとJSON保存を維持する。LINE/Slackの汎用依頼は下書き受付のみ。

- `GET /api/phone/status`: ready、issues、provider、engine、recording、disclosure。ローカル設定検査であり疎通検査ではない。
- `GET /api/phone/templates`: Core定義の12種類。編集用テキストであり架空の通話履歴ではない。
- `POST /api/phone/prepare`: `{phone,name,instruction}` → request、draft、reviewId、readiness、expiresAt。発信せず、下書きを保存する。
- `POST /api/phone/calls`: `{reviewId,approved:true}` → `{record,callId}`。サーバー側の確認済み内容だけを使用。受付は通話成功ではない。
- `GET /api/phone/history`: 保存レコード配列。`GET /api/phone/calls/:id`: レコード。
- `POST /api/phone/calls/:id/hangup`: 終了要求。通信会社から終了応答がない場合、成功としない。
- `POST /api/phone/calls/:id/acknowledge`: `{confirmedEnded:true}`。利用者が通信会社側の終了を確認した記録。unknownを成功へ書き換えずresolvedAtだけ記録。

状態はdraft / starting / running / stopping / ended / failed / unknown。サーバー再起動等で実行結果が不明ならunknownへ。自動再発信なし。同一reviewは一度だけclaimし、実行前にfsync保存。同時発信と未解決unknownは他reviewの開始も拒否。未承認・不正入力400、状態競合・未設定・期限切れ409。Host/Origin制限を維持。設定のHMACが変化した場合やプロセス再起動後は再確認が必要。

履歴は既定 `.oathra/phone-history` に0600で保存される平文の個人情報。音声ファイルは保存しない。終了結果は従来のcalls保存にも接続し、連絡先から参照できる。異常終了で `.approval-lock` が残った場合、自動削除しない。すべてのArenaプロセスを停止し、通信会社側で通話終了を確認してから管理者がロックを除去する。

Web AdapterはTwilio + gpt-live/realtimeのみ。公開WSSは利用者が事前設定し、既定4243番のTwilio音声listenerへ転送する。自動トンネル・他キャリアへの自動フォールバックなし。音声接続は毎通話のランダムpath、Twilio署名、accountSid/callSid一致を検証する。旧固定 `/media` への直接接続は受け付けない。

画面にはTwilio/OpenAIへの送信、従量料金、AI代理であること、文字保存・音声非保存を承認前に表示する。3分の終了タイマーは請求額上限を保証しない。

## 組み込み

`@oathra/arena` の `startArena` に `phoneDialer: PhoneDialer` と任意の `phoneHistoryDir` を渡す。未指定時は入力・履歴のみ利用でき発信は拒否。`inspect()` は秘密を返さず設定状態を返し、`execute(request, {callId, reviewedConfigurationId, signal, onEvent})` はCoreのCallOutcomeを返す。曖昧な終了はthrowしunknownにする。AbortSignalを実際の通信会社終了処理へ接続する。認証情報はサーバーのみで扱う。実装例は `packages/cli/src/web-phone.ts`、注入例は `packages/cli/src/commands.ts`。

## 検証記録

2026-09-19、HEAD `d56ec10306f70d68fd07dae1480c176a3aa7b20d` + 未コミット差分。macOS arm64、Node25.2.1、pnpm10.12.2、Chrome153。ソース識別はsource-sha256.txt。

| 実行コマンド | exit | 観測・証拠 |
| --- | --- | --- |
| pnpm build | 0 | build.log |
| pnpm typecheck | 0 | typecheck.log |
| pnpm test | 0 | 44files、1006PASS/既存1skip。tests.log |
| pnpm test:gateway | 0 | 207PASS。gateway.log |
| pnpm lint:deps | 0 | 依存方向一致。deps.log |
| node scripts/ui/web-phone.mjs | 0 | 保存、復元、未承認拒否、履歴再利用、12テンプレート。browser.log |
| node scripts/ui/phone-input.mjs | 0 | 入力・JSON・CLI dry-run・復元。phone-input.log |
| node scripts/ui/task-entry.mjs | 0 | ホームから各用途へ移動。task-entry.log |
| pnpm test:ui | 0 | Gateway52/Arena94項目PASS。ui.log |
| 起動中55344を実Chromeで確認 | 0 | 12テンプレート、設定不足表示、Tabフォーカス、reduced motion指定時の表示。live.log、live-top.png |

全体単体テストには既存の外部応答stubが含まれる。Twilio認証修正の単体試験も既存stubを使用する限定的なプロトコル検証であり実キャリア証拠ではない。本番処理ではstubを使わず、実接続先の許可が得られ次第、実回線で置換検証する。独立レビューは別エージェントによる静的・ローカル境界検証で、実ユーザー試験ではない。詳しくはindependent.md。

### 2026-09-19 入力画面の文章削減

番号・相手・目的のラベルを維持し、操作手順の段落を削除。番号形式・テンプレート説明は「入力のヒント」、接続の技術情報は「設定方法」へ折りたたみ。未設定状態は常時表示し、発信時の費用・送信先・保存・同意は確認画面に残す。外部処理の契約変更はない。

`pnpm build`、`pnpm test`（1006PASS/既存1skip）、`pnpm test:gateway`（207PASS）、`node scripts/ui/web-phone.mjs` はexit0。実Chromeで1280/390px、設定/入力説明の展開、キーボードEnter、横溢れなし、JSエラーなしを確認。実発信なし。証拠: `artifacts/quality/phone-concise/`。OSのIME・実ユーザー評価・実回線の未確認条件は継続。

文章削減後の `pnpm test:ui` はexit0（Gateway52/Arena94項目PASS）。独立レビューも重大欠落なし。スマホ上部の発信ナビゲーション文言の折返しは軽微な残件。`artifacts/quality/phone-concise/review.md`参照。

### 2026-09-19 発信ボタンの無反応表示を修正

設定不足のときに無効な発信ボタンだけを出していたため、押しても反応がなかった。未設定時は「発信設定を確認」に置換し、クリックで不足設定を展開、フォーカス・スクロールを移動する。未発信、同意不足、期限切れ、発信処理中・既存通話の状態はボタン付近に短文表示する。サーバーの承認・設定検査は変更しない。

実ローカルHTTP/Chromeの `node scripts/ui/web-phone.mjs` に未設定時の発信ボタン非表示、設定ボタン表示、未発信説明、クリック後の詳細展開を追加しPASS/exit0。既存の下書き保存・履歴・未承認拒否も通過。`pnpm build`、`pnpm test`、`pnpm test:gateway` exit0。証拠: `artifacts/quality/phone-setup/`。起動中55344の更新済みJSをGET確認。公開WSS不足は継続し実発信はBLOCKED、発信操作はしていない。

発信ボタン修正後の `pnpm test:ui` はexit0、Gateway52/Arena94項目PASS。別エージェントによる画像・静的レビューとJS構文検査で重大欠落なし。独立ブラウザ再試験は未実施。

### 2026-09-19 全画面共通の戻る操作

ヘッダーに共通の「← 戻る」を追加。画面内の移動履歴へ戻る。直接開いた画面はホームへ戻り、起点ホームで履歴がない場合のみ無効。連絡先編集中は一覧へ戻ることを優先し、未保存入力を維持。発信・終了操作は行わず、通話/結果画面からも移動できる。既存の各画面の戻る操作は維持する。

`pnpm build`、`pnpm test`、`pnpm test:gateway` exit0。`node scripts/ui/task-entry.mjs` にホーム経由の戻り・電話入力保持・連絡先編集→一覧→ホーム・キーボード操作・練習通話継続を追加しexit0。390/640/1280pxの実Chrome画面、横溢れなし。証拠は `artifacts/quality/navigation-back/`。実電話は未実施。

独立レビューで、既存の通話内「戻る」で更新接続を閉じた後、共通「戻る」で通話へ復帰すると状態更新が再開しないP2を検出。共通「戻る」の進行中通話への復帰は状態再取得・イベント再構築・接続再開を行うよう修正。修正後のbuild/task-entryはexit0、旧戻る→共通戻る→返信→文字起こし更新の実シミュレーター検証PASS。独立静的再レビューで元P2解消、JS構文検査exit0。外部発信は行っていない。

共通戻る追加時の全体 `pnpm test:ui` はexit0（Gateway52/Arena94項目PASS）。途中で行った通話復帰修正は、別途修正後build/task-entryで対象経路を再検証済み。
