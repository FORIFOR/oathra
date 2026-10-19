# 層 B: 音声の通し試験（電話会社なし）の実装と初回試験（2026-10-20）

計画: [real-call-plan.md](../launch/real-call-plan.md) の層 B。実電話ではない。相手の声は合成音声（OpenAI `tts-1`）で、回線はローカルの μ-law 8kHz ループ。

## 実装

| 変更 | ファイル |
|--|--|
| 相手役に台本キャラクター（シミュレーターの店員、敵対的な変異つき）を使えるようにした。AI の発話の文字起こしを聞いて返事する。通話後に `evaluate()` の判定、キャラクターが実際に約束した内容（`truth`）、誤完了かどうかを report に出す | `packages/cli/src/local-conversation.ts` |
| 相手側の音を悪くする: 小声（−18 dB）、騒音（指定の SNR、ピンクノイズまたは WAV）、早口（TTS の速度 1.5） | `packages/cli/src/audio-degrade.ts` |
| 変異 × 条件 × 回数をまとめて回し、誤完了・期待どおりの率・応答時間 p50/p95・費用を集計する。合計の費用上限を超える前に止まる | `packages/cli/src/conversation-batch.ts`, `packages/cli/src/phone.ts`, `packages/cli/src/commands.ts` |
| `OpenAITTS` に `speed` を追加（任意。未指定なら従来どおり） | `providers/openai/src/tts.ts` |
| 台本キャラクターが「お忙しいところ失礼いたします」を別れの挨拶と誤認して電話を切っていたのを修正 | `providers/simulator/src/character.ts` |

使い方:

```sh
pnpm oathra phone test --level conversation --engine gpt-live --scenario restaurant-reservation \
  --mutation none,tentative-hold,ask-back --condition clean,quiet,fast,noise-10db \
  --runs 5 --max-usd 0.3 --max-usd-total 20
```

結果は `--out`（既定は `.oathra/local-conversations/batch-*`）に、1 回ごとの `report.json` と `call-mixed-8k.wav`、全体の `summary.json` として保存される。誤完了があるか、上限で途中停止すると exit 1。

## 検証

| 判定 | 内容 | 結果 |
|--|--|--|
| PASS | `pnpm build` | 成功 |
| PASS | `pnpm test` | 73 ファイル、4,321 件成功 / 1 skip（追加 11 件: 音の加工 5、集計 3、キャラクター相手の通し 2、別れの挨拶 1） |
| PASS | `pnpm test:gateway` | 637 件成功 |
| PASS | `pnpm lint:deps` | dependency direction ok |
| PASS | `pnpm oathra eval` | False Completion 0（7/8 完了。未完了は意図した `false-completion-trap`） |
| PASS | `pnpm oathra eval --adversarial 10000` | False Completion: 0 / 10000 |
| 観測 | 有料の試験 2 回（gpt-live、予約、通常と騒音 10 dB）。合計の推定 $0.078 | 下記 |

## 初回試験の所見（2 回のみ。率としては扱わない）

| 回 | 条件 | 相手が実際に言ったこと | AI 側の音声認識 | 判定 |
|--|--|--|--|--|
| 1 | clean | 「…田中様でご予約**承りました**」 | 「…田中様でご予約**のおりました**」 | incomplete（誤完了ではない） |
| 2 | noise-10db | 「…田中様でご予約**承りました**」 | 2 つの発話がつながり「…ご予約**でよろしいでしょうか?**」 | incomplete（誤完了ではない） |

- 会話の流れ（日時・人数・名前の提示、満席からの代案、名前の確認）は 2 回とも成立した。
- 2 回とも相手は予約を確定したのに、**音声認識が「承りました」を聞き違え、判定エンジンが完了にしなかった**。安全側の失敗（取りこぼし）で、誤完了ではない。
- 前の試行では、「9月12日**いち**」のように余計な語が入っただけで、日付・時刻・人数がすべて未確認になった（同じ文から「いち」を除くと completed になることを、判定エンジン単体で確認した）。
- 騒音 10 dB では、聞き取り確定までの時間が 7 秒を超えた発話があった。
- 応答時間（相手が話し終えてから AI の声が出るまで）: p50 1,208 ms、p95 1,841 ms（n=13）。ローカル回線なので、実回線ではキャリアの遅延が加わる。

実電話（層 C）に進む前に、約 100 回の本番実行で「確定の言葉の聞き違い」による取りこぼしの率を測る。取りこぼしが多ければ、判定を緩めるのではなく、AI が確定内容を復唱して相手に確認させる進め方（聞き違いを会話で直す）を検討する。

## 制約

- 相手の声は合成音声で、人の声・電話回線の代わりにならない。
- 台本キャラクターは決まった言い回しで返す。人間の店員の多様さはない。
- 営業アポ（ゲートウェイの `SALES_CALL_POLICY` と `evaluateSales`）はまだ対象外。
- 試験中、OpenAI の `gpt-4o-mini-tts` が 20〜50 秒応答しない時間帯があった（`tts-1` は 1〜2 秒）。そのため相手役の声は `tts-1` に固定した。
- 証拠ファイルは `artifacts/quality/conversation-batch/smoke-20261020/`（git 管理外）。
