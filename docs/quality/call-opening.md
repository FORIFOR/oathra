# 通話開始の音声案内（2026-09-20）

ユーザー指定により、Gatewayの冒頭案内を「この通話は記録されています。」の一文に変更する。数字1の操作待ちは廃止し、案内後に音声AIへ接続する。保存するのは文字起こしであり音声ファイルではない。案内と同意を混同せず、接続だけで相手の同意を取得した記録を作らない。

## 合格条件

| 条件 | 環境・方法 | 期待 | 証拠 |
|---|---|---|---|
| 短い開始案内 | 実Adapterが作るTwiMLとローカルHTTP境界を照合 | Sayの文言が指定の一文、直後にConnect/Stream、Gatherと数字の操作要求なし | gateway.log |
| 自動接続と認証 | ローカルの実WebSocketサーバー、署名検証、CallSid/AccountSid照合 | 有効なセッションだけ接続。1入力不要。偽署名/他通話/他アカウントを拒否 | gateway.log |
| 記録の正確さ | Adapter/Worker/SQLite | 案内のイベントを保存、callee.consentを捏造しない。元の承認・履歴・課金は維持 | gateway.log / runtime.json |
| 停止と互換性 | 同上、既存保護試験 | 自然言語の拒否、通話終了、旧callback、通話中の2による再連絡停止を保持 | gateway.log |
| 稼働反映 | 同じenv/DBで再起動しstatusと保存データを照合 | liveReadyを維持、通話/残高/台帳の前後一致 | runtime.json |

外部回線へ勝手に電話せずに必須の接続・署名境界を検証するため、テスト内のローカルキャリアREST応答とMedia Streamsイベントだけを暫定的な制御データとする。実際のHTTP/WebSocket/署名/Adapter/SQLiteを使い、終了時にソケット・一時DB・タイマーを廃棄。実回線の再生試験とは区別する。

公式仕様: [Twilio Say](https://www.twilio.com/docs/voice/twiml/say)、[Twilio Connect/Stream](https://www.twilio.com/docs/voice/twiml/stream)。既存のTwiMLを使い、独自の電話プロトコルは増やさない。

## 結果

対象: HEAD `f2696fa45439a909a8974f47d679e4bddb63680e` と既存未コミット差分。macOS 26.6.2 arm64 / Node v25.2.1 / pnpm 10.12.2。作業ディレクトリは `/Users/horioshuuhei/Projects/RingZero`。最終ファイルのSHA-256は `artifacts/quality/call-opening/source-sha256.txt`。証拠は以下すべて `artifacts/quality/call-opening/` 内。

| 判定 | コマンド・方法 | exit code / 観測 | 証拠 |
|---|---|---|---|
| PASS | `pnpm build` | 0、TypeScriptのビルド・型検査とCLI bundle成功 | build.log |
| PASS | `pnpm test:gateway` | 0、型検査と234件PASS / 0 FAIL。指定の案内・1なし接続・署名/識別子/音声形式拒否・記録・停止・既存APIの回帰を確認 | gateway.log |
| PASS | 独立担当の `node --test apps/gateway/test/call-opening.node.mjs apps/gateway/test/protection.node.mjs` と最終差分後の `node --test apps/gateway/test/call-opening.node.mjs` | 各0。初回46件、指摘修正後の開始案内6件PASS。streamSid欠落時に接続を成功扱いする問題は修正し再確認 | independent.md / independent-tests.log / independent-streamsid.log |
| PASS | `node artifacts/quality/call-opening/verify-runtime.mjs before` | 0、処理中・結果不明の通話なしを確認 | before-runtime.json |
| PASS | `kill -TERM 22264` 後、`node --env-file=.oathra/managed-preview/.env.managed apps/gateway/server.mjs` | 停止0、PID24858で同じenv/DBを使い待受開始。常駐プロセスの終了コードは未確定 | この記録・起動出力 |
| PASS | `node artifacts/quality/call-opening/verify-runtime.mjs` | 0、liveReady=true。ログイン設定・連絡先・履歴・クレジット台帳のSHA-256一致。既存履歴2件、残高0/確保0。公開health200、未認証API401 | runtime.json |
| BLOCKED | 実回線での案内再生・双方向会話 | 未実施。発信は利用者が画面で最終確認した場合に限る。現在の確認用クレジットは消費済み。追加付与・自動再発信は行っていない | runtime.json |
| NOT_APPLICABLE | 今回の画面レイアウト、スマホ幅、IME、拡大、モーション | 音声Adapterと記録処理のみの変更。画面の変更なし。既存の画面試験を今回の実回線の成功証拠にはしない | 変更対象と上記証拠 |

初回レビューの指摘を含めて2ラウンドで確認。`recording.notice` は案内に続く認証済みstream開始の記録であり、相手が実際に聞き取ったことや同意したことの証明ではない。実機上の聞き取り評価を自動試験で代用していない。ローカルの境界fixtureはテスト実行時だけ生成・破棄し、稼働環境へは投入しない。実回線の案内再生の判定にはfixtureを使わず、利用者の確認後に実通話の証拠で置き換える。
