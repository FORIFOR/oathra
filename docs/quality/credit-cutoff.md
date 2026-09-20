# 残高に応じた発信と使用上限での停止（2026-09-20）

- C1: usage-rate-v1 managed電話は最大400の一律必要条件をやめ、使用可能残高と設定上限の小さい額を承認時に確保する。377/上限400で発信キューへ進める。残高0・初回回線単位未満は理由を表示し、実行層でも拒否する。
- C2: 承認は単価/額/所有者を固定。別の承認が先に残高を確保した場合に過剰確保せず、稼働時は確保済みの額を参照し、available=0を誤って停止条件にしない。旧料金方式を維持。
- C3: 信頼できるworkerで回線時間・音声AI・検索の記録済み利用量を監視し、上限に達するとabort→既存キャリア停止経路へ一度だけ渡す。使用量通知時と定期監視、回線の次の課金単位直前を確認する。停止未確認はUNKNOWNを維持し、遅延超過を利用者に追加請求しない。
- C4: 画面に使用可能額・不足/確保中/設定未完了の理由・停止理由を表示。会話成功とは混同しない。終了時は従来どおり実計測単位で精算し余剰返却。
- 検証: 一時SQLiteの実承認/台帳、限定のusage/時間/abort境界fixture（外部発信を避けるため。終了時撤去）、実ChromeとAPI/保存照合、関連全Gateway/build/typecheck。PSTN追加試験は前回の指示どおり未実施。

## 実施結果

対象: `a821a1f03eeac2494181c45a00b4eae47d132d7a` ＋作業ツリー差分。環境: macOS 26.6.2 arm64 / Node 25.2.1 / pnpm 10.12.2 / Chrome 153。証拠は `artifacts/quality/credit-cutoff/`。独立検証の対象ファイルhashは `independent.md` に記録。

| 条件 | 判定 | 観測・証拠 |
| --- | --- | --- |
| C1 | PASS | 377で承認・377確保。0および初回単位未満20/必要21は拒否。`ui-final.log`, `377-ready.png`, `insufficient.png` |
| C2 | PASS | 確保後available=0でも実行可能、二重確保拒否、料金改定時再承認、旧料金の維持。`gateway-verified.log` |
| C3 | PASS（ローカル境界） | 使用量増加/時間単位境界で一度だけabort・消費・返却。手動停止理由の維持、停止不明はUNKNOWN/保留。円換算・6秒単位検証。`independent.md` |
| C4 | PASS | 不足・確保中・利用上限を表示。実Chromeでキーボード/390px/200%拡大、精算内訳と台帳照合。`ui-final.log`, `legacy-ui.log` |
| 稼働環境 | PASS | 再起動後、残高377・発信確認が有効・自動終了案内。保存済み通話の消費23/返却377と内訳を確認。新規発信0。`live-ui.json`, `live-ui.log` |
| 実回線で残高上限到達 | BLOCKED | 追加の実発信・課金試験は行わず、限定fixtureのworker→abortと既存回線停止経路を検証。通信会社の切断完了までの実測遅延は未確認。 |

実行コマンド（すべて最終exit 0）:

- `pnpm build` → `build.log`
- `pnpm typecheck` → `typecheck.log`
- `node --test apps/gateway/test/*.node.mjs` → `gateway-verified.log`: 295/295
- `node --test apps/gateway/test/protection.node.mjs` → `protection-rerun.log`: 41/41
- `UI_EVIDENCE_DIR=artifacts/quality/credit-cutoff node scripts/ui/usage-cost.mjs` → `ui-final.log`
- `node scripts/ui/managed-phone.mjs --no-capture` → `legacy-ui.log`
- `node --env-file=.oathra/managed-preview/.env.managed artifacts/quality/credit-cutoff/live-ui.mjs` → `live-ui.log`（認証情報は出力せず）

初回全Gateway実行は295中1失敗（exit 1、`gateway-final.log`）。既存の分単位レート制限テストで600件の送信が壁時計の分境界を跨ぐと200を返す構造があり、当該失敗もその可能性がある。期待値を変更せず単独41件と全295件を再実行し通過。初回境界試験ではSQLite行のnull prototypeと通常objectの比較が3件失敗したため、比較時のobject形状のみ合わせた。数値期待値は変更なし。

使用量の通知とキャリア停止には遅延がある。残高ゼロと完全同時の切断は保証せず、確保額を超える引落しを行わない。上限までの余剰を返却し、最大通話時間など既存の制限も維持。料金設定・ウォレット付与・実通話は変更せず、新コードでGatewayを再起動した。
