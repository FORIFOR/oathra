# 実機通話検証記録

個人の電話番号、音声、文字起こし、回答内容はこの記録に含めない。

| 実施日時（JST） | シナリオ | キャリア／音声 | 通話状態 | 通話時間 | Media Streams | 文字起こし・プロファイル | 外部請求 | 根拠 |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| 2026-09-15 17:23 | `friend-profile-intake` | Twilio / GPT-Live | `canceled`（応答情報なし） | 0秒 | 未接続 | 未取得（turns 0、intake `not_started`） | Twilio price は未確定（API応答がnull）／ランタイム算定 `costUsd: 0` | `.oathra/calls/call_mu2en3wk/{events.jsonl,metrics.json,intake.json,result.json}`、Twilio Calls API取得 2026-09-15 17:24 JST。GPT-Liveの25秒無通信ウォッチドッグが接続前に発火し、Twilioへ終了処理を送ったことをコードとEvents APIで確認 |
| 2026-09-15 17:49 | `friend-profile-intake` | Twilio / GPT-Live | `no-answer`（応答情報なし） | 0秒 | 未接続 | 未取得（turns 0、intake `not_started`） | Twilio price は未確定（API応答がnull）／ランタイム算定 `costUsd: 0` | `.oathra/calls/call_mu2fkktx/{events.jsonl,metrics.json,intake.json,result.json}`、Twilio Calls API取得 2026-09-15 17:50 JST。Twilioが55秒の呼出しタイムアウト後に `no-answer` と記録し、Oathraは60秒のMedia Streams待ちで終了 |
| 2026-09-15 17:56 | `friend-profile-intake` | Twilio / GPT-Live | `completed`（相手側終了） | 184秒 | 接続（7秒後） | 文字起こしあり、同意・プロファイル未取得（turns 53、intake `not_started`、answers 0）。録音WAVは未保存 | Twilio price は未確定（API応答がnull）／ランタイム算定 `costUsd: 0` | `.oathra/calls/call_mu2ftznb/{events.jsonl,metrics.json,intake.json,result.json}`、Twilio Calls API取得 2026-09-15 18:00 JST。GPT-Liveの `Missing required parameter: delegation_id` が25回発生し、発話重複22区間（最大約7.7秒）を確認。聞き取りフローへ遷移できず |
| 2026-09-15 19:35 | `friend-profile-intake` | Twilio / GPT-Live | `completed`（相手側終了） | 47秒 | 接続（14秒後） | エージェント発話の文字起こし1件は保存されたが、`caller.wav` の実音量はほぼ無音。同意・プロファイル未取得 | Twilio料金は未確定／ランタイム算定 `costUsd: 0` | `.oathra/calls/call_mu2jc9z6/{events.jsonl,metrics.json,intake.json,result.json,caller.wav,callee.wav}`。修正前の割り込み処理が、音声デルタより先に届いた相手側文字起こしを発話開始と誤認し、未再生のエージェント音声を破棄した |
| 2026-09-15 19:39 | `friend-profile-intake` | Twilio / GPT-Live | `completed`（留守番電話検出） | 42秒 | 接続（26秒後） | 留守番電話を検出して終了。エージェント発話なし、同意・プロファイル未取得 | Twilio料金は未確定／ランタイム算定 `costUsd: 0` | `.oathra/calls/call_mu2jh7d0/{events.jsonl,metrics.json,result.json,intake.json,caller.wav,callee.wav}`。発信先が応答せず自動応答へ転送されたため、修正後の会話音声・検索・プロファイルは評価不能 |
| 2026-09-15 21:21 | `friend-profile-intake` | Twilio / GPT-Live | `completed`（留守番電話検出） | 37秒 | 接続（25秒後） | 留守番電話を検出して終了。エージェント発話なし、同意・プロファイル未取得 | Twilio料金は未確定／ランタイム算定 `costUsd: 0` | `.oathra/calls/call_mu2n4nwq/{events.jsonl,metrics.json,result.json,intake.json,transcript.json,caller.wav,callee.wav}`。発信先が応答せず自動応答へ転送されたため、修正後の会話音声・検索・プロファイルは評価不能 |
| 2026-09-15 21:23 | `friend-profile-intake` | Twilio / GPT-Live | `completed`（相手側終了） | 38秒 | 接続（10秒後） | 相手の発話5件とエージェント発話2件を文字起こし。`caller.wav` は実音量ほぼ無音（修正前の先行無音デルタ割り込み）。同意・プロファイル未取得 | Twilio料金は未確定／ランタイム算定 `costUsd: 0` | `.oathra/calls/call_mu2n6uj9/{events.jsonl,metrics.json,result.json,intake.json,transcript.json,caller.wav,callee.wav}`。修正前の `outAudioStarted` 判定が無音のPCM先行デルタで発話開始扱いとなり、実音声を破棄 |
| 2026-09-15 21:37 | `friend-profile-intake` | Twilio / GPT-Live | `completed`（留守番電話検出） | 34秒 | 接続（27秒後） | 留守番電話を検出して終了。エージェント発話なし、同意・プロファイル未取得 | Twilio料金は未確定／ランタイム算定 `costUsd: 0` | `.oathra/calls/call_mu2noo4m/{events.jsonl,metrics.json,result.json,intake.json,transcript.json,caller.wav,callee.wav}`。PCM24kHz→μ-law変換修正後の発信だが、発信先が応答せず会話音声・検索・プロファイルは評価不能 |
| 2026-09-15 21:41 | `friend-profile-intake` | Twilio / GPT-Live | `completed`（留守番電話検出） | 36秒 | 接続（25秒後） | 留守番電話を検出して終了。エージェント発話なし、同意・プロファイル未取得 | Twilio料金は未確定／ランタイム算定 `costUsd: 0` | `.oathra/calls/call_mu2ntj0n/{events.jsonl,metrics.json,result.json,intake.json,transcript.json,caller.wav,callee.wav}`。無音修正後の最終再発信だが、発信先が応答せず会話音声・検索・プロファイルは評価不能 |

今回の実機検証は9件。4件目と7件目は応答・Media Streamsまで成立したが、修正前の割り込み処理で発信音声が無音になった。5・6・8・9件目は留守番電話で、修正後の会話・検索・プロファイルはまだ判定できていない。

## 実機検証後の修正（2026-09-15 18:25 JST）

- GPT-Live の `session.instructions.append` を現行形式（`content` と `delegation_id: null`）に修正し、検証状態を短い更新単位で送るようにした。これにより、通話中に発生していた `Missing required parameter: delegation_id` を送信側で解消する。
- `web_search` を GPT-Live の Responses 委譲へ既定で登録し、現在情報・外部情報・明示的な「調べて」を検索へ委譲する指示を日本語・英語の両方へ追加した。検索前の待機文と、検索失敗時だけ利用不可と伝える条件も固定した。
- 相手の発話開始を検出したら、キャリア側の再生キューを消去し、Live へ「直ちに発話を止めて聞く」指示を追加する。保存されるエージェント発話には割り込みフラグを付ける。
- 音声デルタより文字起こしデルタが先に届く場合は、まだ送出していないエージェント音声を割り込み扱いにしないよう修正した。実際に送出済みの音声だけを停止対象とする回帰テストを追加した。
- Twilio の `stop` とランタイム終了が競合しても同じ終了 Promise を待つようにし、終了前に `caller.wav` と `callee.wav` を書き込む。
- 同意付き聞き取りは、未確定の同意、保留、曖昧な返答、時間不足を回答として保存せず停止する。実機での検索実行・同意・回答保存は、応答した相手との修正後通話で再確認するまで未確認とする。

## 無音再発防止修正（2026-09-15 21:34 JST）

- GPT-Liveの主WebSocketをPCM16LE・24kHzに統一し、Twilioのμ-law 8kHzと境界で相互変換するようにした。PCMU出力の無音化を回避し、変換後の実音量をテストで確認した。
- Liveが送る無音の先行デルタを発話開始として扱わず、実音量を持つPCMデルタを受け取ってから割り込み状態を有効にする。文字起こしが先に届いても、後続の実音声を破棄しない回帰テストを追加した。
- `@oathra/audio-kit`を直接依存に追加し、入力のμ-law→PCM24kHz、出力のPCM24kHz→μ-law変換を型チェックした。

修正後の型チェックと全テスト（672 passed / 1 skipped）、依存方向チェックは 2026-09-15 21:35 JST に完了した。21:23 JST の再発信では無音バグを再現し、PCM変換と先行無音デルタ判定を修正した。21:37 JST と21:41 JST の修正後再発信はいずれも留守番電話で、実電話での会話音声・検索・プロファイルは未評価である。ローカルの実音量検査ではPCM→μ-law出力のRMS 1,533、ピーク10,876を確認した。
