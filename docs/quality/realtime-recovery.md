# 実通話の中断と診断ログの修正（2026-09-20）

## 観測と合格条件

実サービスの記録では、01:52 JSTにパスワード再設定成功、01:53に利用者が発信を承認。Twilioの回線ID、相手の「1」による同意、音声接続、双方の文字起こしの後に `FAILED / runtime_error`。Twilioの読取照会は completed / duration25秒 / notifications空。電話は実行されており、この履歴を成功や未発信へ書き換えない。元のWorkerが原因のエラーを保存していないため、過去のエラーコード自体は復元できない。

同じ実OpenAI Realtime APIと変更前Adapterを使い、音声生成が完了した直後に `interrupt()` を呼ぶと `response_cancel_not_active` を受信し、致命的エラーとして扱う経路を再現した（before-provider.json）。再現は短い接続確認の音声だけを生成し、相手への発信・入力音声・元の電話番号や会話内容の送信を伴わない。

| 条件 | 測定環境・方法 | 期待する結果 | 証拠 |
|---|---|---|---|
| 割込み | 実APIおよびローカルWebSocket契約試験 | 完了済み応答と自動VAD取消へ重複cancelしない。実行中への手動cancelは応答IDを指定し一度だけ | before-provider.json / after-provider.json / tests.log |
| 応答の分離 | 同じAdapterのイベント順序試験 | 取消済み応答の遅着音声・文字起こし・完了タイマーが次の応答を壊さない | tests.log |
| エラー | Provider→Runtime→Worker→SQLite | 既知の取消競合だけ回復可能扱い。認証等の致命エラーを残し、機密情報を含まないコードを保存 | tests.log / gateway.log |
| ログカーソル | 実SQLiteとGateway | DBのイベント連番がRuntime内の連番に上書きされず、再開時に欠落/重複しない | gateway.log |
| UI・稼働 | 実Chrome、同じDBで再起動 | 日本語の失敗案内と保存会話・クレジット表示。既存の履歴・台帳・設定を維持 | runtime.json / live-result.png |

既存Realtime WebSocket試験方式の最小の制御イベント・音声バイト列は、取消タイミングを再現可能にするための認証/通話根幹試験に限定する暫定例外。テスト内だけで生成し、ソケット・タイマーを終了時に撤去する。実通話の成立証拠には使わず、実API試験を別記録する。実際の利用者のデータを試験用に変更しない。再発信は利用者による最終操作まで行わない。

## 結果

対象: HEAD `f2696fa45439a909a8974f47d679e4bddb63680e` ＋既存未コミット変更。macOS26.6.2 arm64、Node25.2.1、pnpm10.12.2、Chrome153。検証日時2026-09-20 01:54–02:06 JST。ファイル識別は `artifacts/quality/realtime-recovery/source-sha256.txt`。

| 判定 | 実施コマンド・方法 | 観測・exit code | 証拠（artifacts/quality/realtime-recovery/） |
|---|---|---|---|
| FAIL（修正前） | 実OpenAI WebSocketに接続し、音声生成終了直後にAdapterのinterruptを実行するNode here-doc | response_cancel_not_active → fatal=true。再現コマンド自体は観測完了で0、機能はFAIL | before-provider.json |
| PASS | `pnpm build` | TypeScript buildとCLI bundle成功、0 | build.log |
| PASS | `pnpm exec vitest run providers/openai-realtime/src packages/runtime/src packages/phone/src` | 8ファイル67件PASS、0。制御イベントを用いる根幹の境界試験を含み、実電話の証拠ではない | tests.log |
| PASS | `pnpm test:gateway` | typecheckを含み227件PASS、0。秘密を含まない診断保存、DBカーソル、既存権限・会計・認証を検証 | gateway.log |
| PASS | `node --env-file=.oathra/managed-preview/.env.managed artifacts/quality/realtime-recovery/verify-provider.mjs --allow-provider-use` | 実APIで初回音声23,200bytes→割込み→truncate受付→次の音声21,200bytes。両応答completed、provider errorなし、0 | after-provider.json |
| PASS | 別エージェントの読み取りレビュー・限定試験 | Realtime等48件とGateway40件PASS、0。初回の既存レート制限試験は1FAIL、無変更の再実行でPASS。分境界の可能性があり未断定、失敗を記録に残す | independent.md |
| PASS | 通話中0件を確認して `kill -TERM 19533`、同じenv/DBでGatewayを再起動 | 停止0、再起動プロセスは稼働継続（終了コード未確定）。履歴/台帳/ログイン/連絡先の前後ハッシュ一致 | before-runtime.json / runtime.json |
| PASS | `node artifacts/quality/realtime-recovery/verify-runtime.mjs` | 公開HTTPSを実Chromeで操作。失敗理由の日本語案内、保存会話2発話、消費1/残高0を実DBと照合、1280px/390px、例外0、0。画像を開いて確認済み | runtime.json / live-result-desktop.png / live-result-mobile.png |
| PASS | `git diff --check` | 空白エラーなし、0 | 実行ツール出力 |
| BLOCKED | 修正版による友人との実回線通話 | 自動再発信はしていない。発信は利用者の最終操作を待つ。初回の1credit消費・当日1回の利用は元の記録どおり残し、付与/上限変更はしていない | runtime.json |
| NOT_APPLICABLE | メール初期設定やパスワードの再変更 | password.reset成功を確認済みで、今回の原因ではない | 元の監査記録 |

Providerの生成中の応答IDと、電話先で再生待ちの応答を分離。生成済み応答にはcancelを送らず、VADの自動cancelにも重ねない。手動停止は対象IDを指定し、古い応答の遅着音声/文字起こし/タイマーが次の応答を上書きしないようにした。`response.done` のfailedも記録する。提供元の認証・利用枠等のエラーを正常終了へ変更せず、既知の取消競合だけ会話継続可能として扱う。

公式仕様の確認: [OpenAI Realtime client events](https://platform.openai.com/docs/api-reference/realtime-client-events) は、応答が実行中でないcancelがエラーを返してもセッション自体は維持されること、VADのinterrupt_responseによる自動取消、再生済み位置に合わせたtruncateを定義している。今回のエラーを致命扱いしていたのはAdapter側だった。実通話の元のエラー詳細は失われているため、再現した経路と全く同じ原因だったと断定していない。

GatewayはRuntimeのエラーをコードだけ永続化し、致命エラーでは同じコードを結果へ渡す。StoreのDB連番も修正し、Runtime内のseqに上書きされなくした。保存済みデータの更新は不要。SSEのカーソル改善はStore境界で確認し、今回は実HTTPのSSE再接続は再実施していない。

実UI検証の画像は番号・目的・会話本文をDOM上だけで伏せた。履歴/文字起こし/クレジット台帳には変更していない。一般利用者のパスワードは読み取り・代理変更していない。音声APIの再現試験で生成した短い音声は保存せず、使用量と状態だけ記録。実APIの使用量とアプリの1credit消費を混同しない。
