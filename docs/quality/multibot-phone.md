# Multibot電話連携の検証 — 2026-10-01

対象: Oathra `db56271`、Multibot `c39687f`を基準とする今回の未コミット変更。macOS、Node v25.2.1、Python 3.12。実際のenvと保存済み通話依頼を使い、DBは読み取り専用で取得。一時DBと一時資格情報は終了時に削除する。運用DB・通話履歴・通常の利用者の権限は変更しない。

| 検査 | 実行と観測 | 結果 |
|---|---|---|
| Oathraビルド | `pnpm build`、TypeScript＋CLIバンドル、exit 0 | PASS |
| 依存方向 | `pnpm lint:deps`、exit 0 | PASS |
| Python静的検査 | 変更したintegration/runtime/store/retentionと検証スクリプトへRuff、compileall、exit 0 | PASS |
| 専用agent認可 | agentからの委任作成拒否、operatorからの専用agent発信拒否 | PASS |
| 重複防止 | 並行した同一依頼は同じmission、内容変更は409、履歴削除後は410 | PASS |
| 委任の上限 | 回数・予算超過を429、未許可の実番号を403 | PASS |
| 取消と失効 | 待機中の取消、送信より先の取消、失効後のworker claim拒否 | PASS |
| 実データの結果判定 | 保存済みの実文字起こしを既存Evidence Engineで処理。自由文のみをCOMPLETEDにしない | PASS |
| Multibot実接続 | 本物のToolGatewayからHTTPで受付・照会・同一通話の復帰・取消 | PASS |
| 指揮役への引き継ぎ | MessageBusへ配送し、master宛ての永続メッセージに同じmissionIdが存在 | PASS |
| 完了の保護 | pending/cancelledをfinish_taskで完了にしない。自動完了経路も保護 | PASS |
| 秘密の扱い | 資格情報をバックエンドだけで解決。イベント列にtokenが含まれない | PASS |
| 初期設定の自動補完 | 回数10、最大5分、24時間後の期限、10件分の算出予算をAPI/CLIで確認。受付済みmissionも300秒となり、旧180秒に短縮されない | PASS |
| 接続の発行と保存 | 専用資格情報＋委任の原子的作成、失敗時ロールバック、同じキーで再取得、0600ファイル、再起動後の認証 | PASS |
| MCP stdio接続 | 実プロセスのinitialize/tools/list、実HTTP経由で枠の照会・受付・結果取得・取消・残枠の減算 | PASS |
| Multibot接続ファイル | 同じbundle形式の取込、二重取込の冪等性、実ToolGatewayからのファイル読込 | PASS |
| Genie固有の接続 | 対象製品未特定。stdio MCPの接続口まで | UNVERIFIED |
| 実際の発信・音声会話・予約達成 | 電話workerとモデルループを起動していない | UNVERIFIED |

再現: `MULTIBOT_PYTHON=<Multibot backendのPython> MULTIBOT_ROOT=<checkout> MULTIBOT_VERIFY_URL=<Multibot origin> node --env-file=<電話会社env> --env-file=<Gateway env> scripts/verify-agent-phone.mjs`。Oathra側50チェック、Multibot側15チェック、exit 0。チェックは既存の実データを必要とし、データがなければ架空データへ切り替えず停止する。

稼働中Multibotへ電話ボットを登録し、設定revision 4で確認した。運用環境での自動発信の委任と資格情報の発行は未実施。現行設定から試用枠は10回・1通話最大5分・1件$3.60／総額$36・24時間と算出でき、同意済みだがVerify済み自己番号は未登録。宛先だけは利用者が指定する必要がある。稼働中サービスの再起動は行っていない。コード反映と接続ファイル発行後に、許可された宛先で実電話の最終確認を行う。

初回の拡張検証ではケース間の依頼が日次上限に達し、Multibot側がHTTP 429で停止した。上限は変更せず、Multibotの独立ケースに別の一時DBを用意し、同じ実設定・実依頼で再実行してPASS。運用DBの上限／記録は変更していない。

既定値拡張後も上記の非発信連携検証は50＋15チェック、exit 0。build/依存方向検査もexit 0。ローカルGateway設定ファイルの1件上限を$3→$3.60、日次上限を$10→$36へ更新し、新規の10件枠と整合させた。稼働中プロセスへの反映は再起動後。既存の発行済み委任は変更していない。
