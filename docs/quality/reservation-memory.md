# テンプレートと通話情報の保持（2026-09-20）
実装前の受入条件:
- 目的欄に入力済みでもavailability選択で内容を挿入し、native confirmに依存しない。元の内容・選択をundo可能。未記入{{項目}}は従来通り発信前に拒否。
- 同じEvidenceEngineで希望と店側提案と双方確認を区別し、変更後の条件を再確認するまで成立扱いしない。根拠発言と変更履歴を保存。
- 通話中のphone.messageに現在の確認状態を渡す。Gatewayのメモと履歴は所有者認証下で保存/復元。
- 前回の条件を明示操作で次の目的へ再利用。自動発信/予約成立の主張はしない。
- 空席確認から予約確定への権限昇格は行わない（ユーザーの用途回答待ち）。

## 実施結果
対象 revision: `a821a1f03eeac2494181c45a00b4eae47d132d7a`＋作業ツリー。環境: macOS arm64 / Node25.2.1 / pnpm10.12.2 / Chrome153。
証拠: `artifacts/quality/reservation-memory/`。

| 項目 | 判定 | 観測・証拠 |
| --- | --- | --- |
| テンプレート選択 | PASS | 既存入力をavailabilityで即置換、native confirmを例外にしても動作、undoで元の入力/モード復元。`ui-final-verified.log`, `live-ui.json`, `live-template.png` |
| 条件と根拠の保持 | PASS | 希望19時/店側19:30/再変更19時を分離。現在値が未確認へ戻り旧値も履歴に残る。AI自身の確定発言・途中で遮られた復唱では確認済みにしない。`related-verified.log`, `memory-worker-final.log` |
| 保存/再構築 | PASS | Workerの発言ごとに暗号化Storeへメモ保存。snapshot欠落/発言数不一致時は保存された発言から再構築。正常終了以外でも取得でき、他ownerのAPIは404。`memory-worker-final.log`, `ui-final-verified.log` |
| 会話中の保持 | PASS（ローカル） | phone.messageも提案5項目と確認状態をモデルへ渡す。両発話方式のRunResult/イベントでもinterruptedを伝播して証拠から除外。`runtime-interruption.log` |
| 次の通話への再利用 | PASS | 明示操作で前回条件を再確認の指示付きでコピー。undo可能。入力2000字超はコピーせず案内。画面更新でも開いた変更履歴を保持。`ui-final-verified.log` |
| 実電話での条件聞き取り | BLOCKED | 課金API/実発信なし。実ASRの聞き間違いまで防げるという主張はしない。 |
| 予約確定 | BLOCKED | 空席確認と予約確定を別機能にするかユーザー回答待ち。現行のask-only契約とnot_authorizedを維持。許可なく予約成立へ昇格しない。 |

実行コマンドと最終exit code:
- `pnpm build` / `pnpm typecheck`: 各0 (`build-verified.log`, `typecheck.log`)
- `pnpm exec vitest run packages/core/src packages/runtime/src packages/evidence/src providers/openai-realtime/src`: 795 PASS、0 (`related-verified.log`)
- `node --test apps/gateway/test/*.node.mjs`: 298 PASS、0 (`gateway-verified.log`)
- `node scripts/ui/managed-phone.mjs --no-capture`: 0 (`ui-final-verified.log`)。実Chromeでモバイル幅/200%拡大/キーボード/owner分離/保存・再起動など既存フローと追加メモ/undoを検証。画像は再撮影していないので以前のスクリーンショットを今回の証拠へ流用しない。
- `node --env-file=.oathra/managed-preview/.env.managed artifacts/quality/reservation-memory/live-ui.mjs`: 0 (`live-ui-final.log`)。公開URL実画面・390pxで置換/undo、実保存履歴のメモ返却、履歴件数不変・新規発信0。

初回workerメモ試験はメモ再構築のundefined属性とJSON保存時の省略の差で失敗（`memory-worker.log`）。属性が未定義なら最初から省略する契約に揃えた。値・判定を変えて期待を緩めていない。
独立レビューでRunResultの割込フラグ欠落・通常brain方式の未除外、詳細欄の更新時閉鎖、TZによる相対日付の変化を指摘され修正。日本語電話の基準日はAsia/Tokyoの承認日で固定。年月日境界・年越しも検証。詳しくは`independent.md`。

実装上の限界: 日時/人数/料金/確認発言の自動抽出は元の言い回しによって未抽出になり得る。店名は相手欄、氏名など抽出対象外は元の依頼と文字起こしで保持。外部予約台帳や実ユーザー聴感の確認ではない。旧記録で割込情報が保存されていない部分の実聴取は復元できない。

最終UI調整: テンプレートの最初の{{項目}}を選択して冒頭を表示し、長い前回文章のスクロール位置を引き継がない。追加の再実行で連絡先リストの非同期描画待ちが不足した既存試験が一度失敗（ui-verified.log）。ボタンが実際に生成されるまで待つようにし、同じ期待値で最終UI/公開画面試験がexit0。

## 後続の実通話ログ監査（2026-09-20）

判定: **FAIL — 構造化メモの正確性**。保存された実通話の文字起こしとメモを照合したところ、人数の希望は保持される一方、1人あたり料金の「1人」を利用人数として誤抽出した。また終了挨拶の「本日」が利用日の根拠を上書きした。予約条件の自由文は文字起こしに残るが構造化対象外。元の依頼と全13発言の保存は確認できた。上記の自動テストPASSは、この実通話の意味抽出の正確性を保証しない。

このGitHub更新時点で未修正。構造化メモを次回の通話へ引き継ぐ前に原文と照合する必要がある。予約確定権限は追加していない。個人情報を含む実通話ログ・運用環境・画面キャプチャは公開対象に含めない。
