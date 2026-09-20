# 自然な開始・終了と東京イベント検索
2026-09-20。対象: a821a1f + 作業差分。
受け入れ条件（実装前）:
- 音声接続後、無音でも最初の挨拶を一度だけ生成。相手の最初の発話を必須にしない。
- end_callだけを生成しても、終了挨拶の音声を生成・再生待ちしてから終了。中断/外部切断/強制停止を優先。
- 東京の公開イベントを指定できる検索分類を追加。開催日・公式出典を確認し、ニュースの報道日制約と区別。個人情報/会話そのものを検索入力へ渡さない。
- 相槌で検索を中止しない。結果の割り込み読み上げを避け、外部切断時は中止。使用量・上限を維持。
- 音声の聴感と実回線時間短縮は実測なしでPASSとしない。限定プロトコル/検索境界fixtureは各試験で撤去、外部課金呼出なし。

## 判定と証拠
環境: macOS arm64 / Node25.2.1 / pnpm10.12.2 / Chrome153。証拠: `artifacts/quality/natural-call/`。

- PASS（ローカル境界）: 初回無音パケットで一度だけ挨拶要求。bare end_callで終了挨拶を生成して音声長に基づく再生待ち後にhangup。割込後の遅着挨拶を世代IDで破棄。再生待ちの発話が残れば、それが終わってから最後の挨拶を生成。
- PASS（ローカル境界）: 東京イベントの固定検索入力、開催日/JST当日〜14日の検証、古い/不正/報道日だけの結果を拒否。検索中の相槌で検索を取り消さず、応答中は結果読み上げを待つ。通話終了時は中止。
- PASS: `pnpm exec vitest run packages/phone/src packages/runtime/src providers/openai-realtime/src`、86件、exit0 (`related-verified.log`)。
- PASS: `pnpm build`, `pnpm typecheck`、各exit0 (`build-final.log`, `typecheck-final.log`)。
- PASS: `node --test apps/gateway/test/*.node.mjs`、297件、exit0 (`gateway.log`)。この実行後の最終変更はproviderの挨拶競合とイベント検索入力で、上記86件/build/typecheckにて再検証。
- PASS: `node --env-file=.oathra/managed-preview/.env.managed artifacts/quality/natural-call/live-ui.mjs`、exit0 (`live-ui.log`, `live-ui.json`)。稼働中の実保存済み検索結果を実Chrome/390pxで描画し、「検索が中断されました」を確認。新規発信0、履歴件数不変。秘密・会話全文は証拠に出力しない。
- BLOCKED: 実電話の初回音声までの短縮秒数、相手が最後の挨拶を聞いたこと、聴感としての自然さ。録音非保存、追加の実発信/課金API未実施。
- BLOCKED: 新しい東京イベントの検索結果の事実精度。公式な主催者・会場ページを検索プロンプトで要求するが、parserが機械的に確認するのは開催日とURL等の構造。東京都内開催・公式性自体の独立照合は未実施。

独立レビューで見つかった2件（遅着する終了挨拶の割込競合／先行音声が残ると最後の挨拶を早く切る競合）を修正し回帰試験を追加。`independent.md` に対象hashと独立結果を記録。

観測に基づく診断: 最終発話は相手の「バイバイ」でAIの挨拶記録なし。ニュース検索はverifiedが1回、次のjapan検索はcancelledであり「該当イベントがなかった」という証拠ではない。従来の検索はカテゴリだけで東京イベントを指定できず、VAD speech_startedでpending検索もabortしていた。初回挨拶は指示文だけで生成開始要求がなかった。呼出し・録音告知・接続・生成の各遅延の実測内訳は保存されておらず、全待ち時間をこの欠陥だけに帰属させない。

通話中でないことを確認してGateway再起動。検索上限2回、15秒timeout、料金集計、クレジット停止、最大600秒は維持。実回線で相手が先に切断した場合や強制停止時は挨拶を待てない。
