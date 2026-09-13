# oathra 0.1.1

試用中に見つかった 3 件を直しました。評価ゲートはすべて通過（tests 127、`oathra eval` False Completion 0、`--adversarial 10000` 0/10000）。

## 直したこと

- **曖昧な返答に確認を求める** (#5): 相手が「たぶん大丈夫」「確認します」と言ったとき、エージェントは同じ依頼を繰り返して諦めるのではなく、「確定でよいか」を最大 2 回たずねる。
- **AI が挨拶したら通話が終わる** (#6): Play モード（人間が店役）で、エージェントが「失礼します」と言った後も相手の次の発話を待ち続けていた。エージェントの切電で即時に終了する。
- **証拠パネルの重複行をまとめる** (#7): 同じ項目・同じ値・同じ出所の未確定行を 1 行に畳み、最新時刻と検証済みフラグを保持する。
- **敵対的スイートを 5 種 → 14 種に拡張**: 仮押さえ（一応・後で確認します）、聞き返し（…でよろしいでしょうか？）、確定直後の条件訂正、確定直後の取り消し、保留、留守電、転送、聞き直し、関西弁の確定（「取っといたで」）。拡張で見つかった 2 つの穴を塞いだ。店員の「合っておりますでしょうか？」が同意扱いだった点と、「承りました。……やはりお取りできませんでした」が確定扱いだった点。
- **保留・聞き返し・転送に耐える**: 組み込みエージェントが「少々お待ちください」で待ち、「もう一度お願いします」には直前の一言をそのまま繰り返し、別の担当者に代わったら要件を最初から言い直す（#9 #10 #11）。
- **「誤完了を誘ってみる」ボタン**: Play モードの入力欄の下に、確定にしてはいけない店側の言い回し 3 つをワンクリックで用意した。

## 変わらないこと

- 完了判定は相手（店側）の発言から得た証拠のみ。AI の自己申告では完了にならない。
- スクリプト脳・シミュレータは API キー不要で動く（`npx oathra demo`）。

## Fixes

- Agent asks for a definite answer (at most twice) when the callee hedges instead of restating the request until the stall guard gives up (#5).
- With a human callee (Play mode), the call ends as soon as the agent hangs up (#6).
- Evidence panel folds duplicate unverified rows for the same field/value/source (#7).
- Adversarial suite grown from 5 to 14 mutations (tentative hold, asking back, confirm-then-change, confirm-then-retract, hold, voicemail, transfer, repeat requests, Kansai-dialect confirmations). Two gaps it exposed are closed: a callee asking "…is that right?" counted as agreement, and "booked … actually we can't" counted as confirmed.
- The built-in agent now survives holds, repeat requests and transfers: it waits on "one moment", repeats its last line verbatim on "say that again", and restates the whole request when someone else picks up (#9 #10 #11).
- "Try to fool it" chips in Play mode: three clerk lines that must not settle the call, one click each.
