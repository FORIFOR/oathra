# 通話時間上限による途中終了（2026-09-20）

受け入れ条件（実装前）:
- 残高上限監視のあるmanaged usage-rate電話は、固定180秒の追加制限ではなく設定された通話時間を使う。旧方式は維持。
- 運用設定を60秒から600秒へ変更。新規確認画面へ反映し、既存承認を遡及延長しない。
- 電話会社の終了通知が時間上限到達を示す場合、保存済み履歴にも時間上限到達を表示。残高上限、手動取消、停止不明と混同しない。
- 既存クレジット監視・精算を維持。実発信/付与なし。

実測: 最新通話のキャリア時間60秒、契約上限60秒、記録済み利用27/上限377、残高350。credit stop=false。時間上限と一致し、クレジット枯渇ではない。会話内容・番号・秘密は証拠に記録しない。

## 最終検証

対象: `a821a1f03eeac2494181c45a00b4eae47d132d7a` ＋作業差分。macOS arm64 / Node25.2.1 / pnpm10.12.2 / Chrome153。

- PASS: `node --test apps/gateway/test/*.node.mjs`、297/297、exit0 (`artifacts/quality/call-duration/gateway-verified.log`)。
- PASS: `pnpm build` / `pnpm typecheck`、各exit0 (`build-final.log`, `typecheck-final.log`)。
- PASS: `UI_EVIDENCE_DIR=artifacts/quality/call-duration node scripts/ui/usage-cost.mjs`、exit0 (`ui-verified.log`)。600秒が確認画面へ反映、残高上限での承認・精算、モバイル等の既存画面検証を維持。
- PASS: 独立14境界試験と差分確認 (`independent.md`)。
- PASS: 実設定＋一時メモリSQLiteで既存依頼の準備のみ実行し、600秒・350確保・最大利用見込み$3.5を確認 (`config-verified.log`)。実DBへの付与・新規依頼保存・外部発信なし。
- BLOCKED: 実回線で60秒を超える継続/10分での終了。追加の有料発信は行っていない。

途中の失敗も記録: 三項演算子の編集ミスを構文検査で修正。実設定で10分の全時間分を事前請求予算として評価する旧ロジックによる拒否を検出 (`config-check.log`)。残高上限監視のある電話のみ、見込みを確保額以内へ制限した。旧方式の予算超過拒否は維持し回帰テスト追加。期待値を下げた合格ではない。

通話中でないこと（残高350・保留0）を確認してGatewayを再起動。旧60秒承認の内容は書き換えず、新規確認に600秒を適用。上限は残高または10分の早い方で、相手の切断・通信障害などによる早期終了はあり得る。

稼働後の確認: `node --env-file=.oathra/managed-preview/.env.managed artifacts/quality/call-duration/live-ui.mjs` はexit0、公開URLの実Chromeで履歴「60秒」上限到達・消費27・残高350・保存済み内訳を照合（`live-ui-verified.log`, `live-ui.json`, `live-mobile.png`）。初回は前回通話の固定金額をコピーしていたため不一致。検証スクリプトを、今回の保存済み実usageから求めた金額との照合へ修正し再実行した。通話/台帳/製品コードを合わせる変更はしていない。稼働APIのmaxSeconds600・残高350/保留0も確認（`live-config.log`）。新規発信0。
