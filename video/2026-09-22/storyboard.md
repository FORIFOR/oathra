# Storyboard — "the agent said booked; the engine did not" (recorded 2026-09-22)

Subject: the only thing this product does that a competitor cannot show without a sales call —
a verdict that disagrees with the agent, derived from the callee's words.

Recorded from the shipped site's evidence lab (the production engine compiled to the browser) at
1440x900, real clicks, real render. No mockups, no re-enactment, no stock footage.

| t | what is on screen | caption (burned in, readable without sound) |
| --- | --- | --- |
| 0.0-2.5 | The panel already mid-call: the agent's line "ご予約承りました" and, beside it, 3/4 with 確定 open | AIは「予約できました」と言った |
| 2.5-5.0 | Slow push to the mission list; ✓ on 日付/時刻/人数, ○ on 確定 | 相手はまだ確定していない |
| 5.0-9.0 | Cursor moves to the reply chips; hovers 「たぶん大丈夫ですが、まだ確定ではありません。」 | 店の返事を差し替える |
| 9.0-13.0 | Click. The line lands in the transcript, the panel re-renders, 確定 stays ○ | 「たぶん大丈夫」は確定ではない |
| 13.0-17.0 | Cursor to 「はい、9月12日19時半に2名様でご予約承りました。」, click | 相手がはっきり承諾すると |
| 17.0-21.0 | Push to the verdict: ✓ 完了条件を満たしています, 4/4, evidence quote visible | 完了。根拠は相手の発言 |
| 21.0-25.0 | Cursor to 「申し訳ありません、やはりご予約をお取りできませんでした。」, click, verdict falls back to 未完了 | 取り消されたら、完了は取り消される |
| 25.0-29.0 | Pull back to the whole panel, hold | 判定はモデルではなくコードが出す |
| 29.0-32.0 | End card over the last frame: URL | forifor.github.io/oathra · Apache-2.0 |

X cut (15-30 s): 0-2.5, 5-13, 17-21, 25-29 + end card ≈ 22 s, same source frames.

Honesty constraints applied to the edit:
- No speed-up inside a reaction; the engine's re-render really is immediate. Any trimmed pause is a hard
  cut between chips, never a ramp that implies the product is faster than it is.
- The 1万件 adversarial figure is not shown in the video; it is a claim that belongs in text with its command.
- Captions state what happened, never a benefit.
