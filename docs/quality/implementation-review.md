# 実装・導線・責務の見直し — 2026-09-20

対象は managed Gateway の「番号・相手・目的 → 費用確認 → 発信承認 → 状況・保存履歴・使用額」です。見た目を置き換えず、初回・復帰・通信障害・所有者境界を見直しました。実電話での追加検証はユーザーが後で行う範囲です。

対象 revision: `7642235c8c7a28c6f1eaaf3164a57842718d1007` + 保護した既存作業差分 + 本修正。ファイル単位SHA-256と環境/実行結果は `artifacts/quality/implementation-review/verification.json`。最新の料金方式・雑談・一般連絡先を保持し、push / merge / 新規公開 / 新規発信 / クレジット付与は行っていません。既存ローカルGatewayを再起動しました。

## 主張・実装・成果物

| 内容 | 実装・実測 |
|---|---|
| 同じ電話フォームで準備・履歴・料金を確認 | 実Chrome、実HTTP、実SQLiteで確認。画面の受付を通話完了にしない |
| 通話終了時に使用量から消費・返却 | 既存実装を維持。実保存済み32秒の通話は23消費/377返却、残高377。再起動後のUIとAPIが一致。「暫定」ラベルなし |
| 新しい電話が実際につながる | 今回は実施していない。PSTN・音声品質・当該修正後の新規キャリア請求照合はBLOCKED（ユーザーが後で実施） |
| AIが人間より使いやすさを保証 | 主張しない。実ユーザー評価は未実施 |
| 保存 | 提出済み依頼・会話・料金は暗号化SQLite。未提出の電話/連絡先入力はowner別sessionStorage。タブを閉じる/ブラウザーの保存制限では未提出入力が失われ得る |

## 修正

1. ブラウザー処理を電話フロー、認証/残高、連絡先編集、HTTP、料金、ニュース、表示文言に分割。サーバーの電話サービスとHTML組立ても分離しました。新しいframeworkや二重の課金ロジックは追加していません。ArenaとのHTML接合部が変わると明示的に検出します。[依存図](../ARCHITECTURE.md#managed-phone-application-experimental-gateway-v1)。
2. 同一ownerのタブ内入力・表示中通話を再読込/再認証後に復元。最新の未完了通話へ復帰し、startを再送しません。古い非同期応答、途中の認証失効、通信障害が別の画面/相手を上書きしないようにしました。
3. 連絡先の保存前に古い番号を利用しない、保存連打で重複しない、保存中の追加入力を消さない、未保存の相手切替を確認する処理を追加。応答喪失時は同じ保存キー・内容で確認し、実行層で24時間の重複防止を保証します。失効時の未保存連絡先・未確認保存キーも同じownerに復元します。
4. 発信受付前の明確な拒否と、受付済み/受付結果未確認を区別。202後の状態読込が429でも「未受付」と断定しません。障害後に再試行するのは読み取りのみです。
5. 別ownerを含む同番号の進行中・終了確認中・結果未確認への重複承認を防止。最新1000件の表示範囲外も確認します。SSEは接続時だけでなく配信時にも認証と所有権を再確認します。
6. 一般画面で連絡先を編集しても、営業用の関係・連絡根拠・CRM識別子を消しません。省略保持/明示空文字消去の変更を[API文書](../../apps/gateway/README.md)に記載しました。旧「省略して消去」に依存するexperimentalクライアントは更新が必要です。

## 固定条件と判定

[事前条件 I1–I6](../design/ui/acceptance.md)に対する結果です。最終ラウンドでは独立検証で見つかった応答喪失と再認証の境界も修正しました。

| 条件 | 判定 | 観測・証拠（`artifacts/quality/implementation-review/`） |
|---|---|---|
| I1 責務・公開契約 | PASS | 8つの小さなブラウザーモジュール、phone-service/renderer分離、build/typecheck/dependency検査。構造文書、`build.log`, `typecheck.log`, `dependencies.log` |
| I2 入力・同一通話・所有者の復帰 | PASS | 再読込で入力と同じ通話、終了結果を復元。失効/再認証で電話・連絡先入力を復元。ログアウトで消去、別ownerへ混入なし。`recovery-final.log`, `managed-phone-final.log`, 独立UIプローブ |
| I3 連絡先保存 | PASS | 連打・遅延応答・応答喪失後の手動再保存・保存中追記をDB件数と内容で照合。破棄ダイアログでキャンセル可能。`recovery-final.log`, `contact-idempotency-tests.log`, `ui-fault-after.log` |
| I4 認可・副作用・失敗復帰 | PASS | 全owner/1000件超の重複防止、SSE失効、実202後429、start応答喪失時の同一通話照会。追加発信なし。`gateway-final.log`, `ui-fault-after.log`, 独立報告 |
| I5 操作・状態・費用・表示 | PASS | 390/1280px、キーボード/フォーカス、200%拡大、reduced motion。現行サービスの保存済み23消費/377返却がUIとAPIで一致。`original-phone/`, `recovery-*.png`, `live-ui.json`, `live-*.png`, `usage-ui.log` |
| I6 契約・従来機能・文書 | PASS | Gateway 283件、Vitest 1025件、Arena成果物/復帰/拡大、既存UI、メールログイン、旧固定クレジット/現行使用量方式。省略保持の互換変更は明示。`gateway-final.log`, `tests.log`, `arena.log`, `ui-regression.log`, `arena-ui-final.log`, `email-login.log` |

I5は下記未実施項目を含めて全プラットフォーム合格とするものではありません。

| 未実施 | 判定 | 理由 |
|---|---|---|
| 新規PSTN発信・通話品質・新しい請求の照合 | BLOCKED | ユーザー指示で実電話試験は後で実施。既存保存結果の読取確認のみ |
| LiveKit実資格によるoutbound trunks照会 | BLOCKED | 元から明示opt-inの実資格試験1件をskip。合格件数に含めない |
| macOSの日本語IME変換・支援技術の実機評価 | BLOCKED | Headless Chromeの日本語入力をOS IME/スクリーンリーダー実測の代わりにしない |
| 初心者の実ユーザー評価 | BLOCKED | 独立AIレビューを人間のユーザビリティ試験とは呼ばない |
| ネイティブ製品のOS別検証 | NOT_APPLICABLE | 今回はWeb Gateway。ネイティブアプリは変更していない |

## 実行環境・コマンド

macOS 26.6.2 arm64 / Node 25.2.1 / pnpm 10.12.2 / Chrome 153。各コマンドのexit codeとログは `verification.json` に記録します。

- `pnpm build` / `pnpm typecheck` / `pnpm lint:deps`
- `pnpm test` — 47 files、1025 pass、外部LiveKit用1 skip
- `node --test apps/gateway/test/*.node.mjs` — 283 pass、0 fail/skip
- `node scripts/ui/managed-recovery.mjs`
- `UI_EVIDENCE_DIR=artifacts/quality/implementation-review/original-phone node scripts/ui/managed-phone.mjs`
- `node scripts/ui/email-login.mjs`
- `node scripts/ui/usage-cost.mjs`
- `pnpm test:arena-outcome` / `pnpm test:ui`
- `node --env-file=.oathra/managed-preview/.env.managed artifacts/quality/implementation-review/live-ui.mjs` — 既存記録の読取。新規通話0、電話会社/AI APIへの新規実行0
- `git diff --check`

最初のGateway全体試験は278/279でした。1件は旧「項目省略で消去」の入力を使っており、省略保持の修正に合わせ消去対象を明示空文字へ変更しました。期待値・検証項目は変更していません。独立担当が妥当性を確認し、最終283件は全PASSです。初回ログ `gateway-tests.log` を残しています。

既存UI全体試験の初回はGateway52/52、Arena93/94でした。Arenaのモバイル配置比較1件は、別々のCDP呼出でviewport座標を取得していました。同じ製品JS/CSSでの単独再実測は27/27で正常な18pxの縦余白を確認。結果更新時のスクロールを挟んで座標を比較しないよう、両矩形を同じブラウザー処理で測る試験修正を行いました。判定式・許容値は変更せず、独立担当も静的確認しています。最終の全viewport再実行は94/94 PASS、exit 0（`arena-ui-final.log`）。初回FAILを `ui-regression.log` に保持し、測定競合の可能性と製品の欠陥を区別しています。

## 独立検証とfixtureの範囲

[独立報告](../../artifacts/quality/implementation-review/independent.md)は実装担当とは別agentが作成しました。初回のFAIL、静的指摘と実測の区別、修正後のPASS、対象ハッシュを保持しています。

実電話禁止のため、承認キュー・通信障害・認証失効だけを一時環境で再現しました。実HTTPの応答を遅らせる/破棄するfixture、停止したworkerへの一時live-ready設定、UNKNOWN状態、期限切れセッションを限定使用しています。成功したキャリア応答や新しい会話・使用量を作って実運用成功と報告していません。新しいE2Eは入力に設定済み本人番号を使い、試験DB/認証情報/Chromeプロファイルをfinallyで削除します。実装にはfixtureを残さず、回帰用試験だけを保持します。画像では実番号・会話を非表示にしています。
