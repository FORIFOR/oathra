# 電話依頼が結果になるまで（Gateway）

1. 画面・チャネル・MCP から依頼が届き、Service が下書き（DRAFT）を作る。
2. review が内容を返し、改訂ごとに承認トークンを発行する。営業時間・停止リスト・同意も確認する。
3. 承認（POST /v1/missions/:id/start）で、トークン・冪等キー・月間上限・クレジット予約を確認して QUEUED にする。
4. Worker.tick が claimNext で依頼を取り、run で通話を始める。
5. Phone.execute が runtime・phone・voice と音声エンジンで通話し、Twilio で発信する。
6. Twilio の状態・同意フックが Phone.callback に届く。
7. 通話後、evaluateSales が EvidenceEngine と evaluate() で結果を判定する。拒否や連絡停止なら停止リストに入れる。
8. Credits が予約を確定または解放し、必要なら Alerts が職員に通知する。
9. 結果を元のチャネルに通知する。後続送信は別のプレビューと承認で行う。
