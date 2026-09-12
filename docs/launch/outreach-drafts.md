# 試用依頼 個別文面（優先 10 人、2026-09-13 作成、未送信）

方針: `outreach.md` の依頼文を土台に、相手の記事の具体的な一点に触れる冒頭を書いた。記事は Zenn / Qiita の公開 API で本文を取得して読んだ上で書いている。**どれも送っていない。** 送信は本人の「送って」があってから、公開チャンネル（記事コメント・公開リプ）で 1 通ずつ行う。X 用は 140 字以内、コメント用は 300 字前後。送ったら `outreach.md` の状況欄を更新する。

共通の末尾（コメント用）:
> スターのお願いではありません。実装している立場から「この判定が役立つ場面があるか」「どこで試すのをやめたか」を教えていただけると助かります。 https://github.com/FORIFOR/oathra

---

## 1. shineos — Zenn コメント（記事: https://zenn.dev/shineos/articles/voice-ai-agent-realtime-mini-architecture）

> 「情報が揃っているのにツールを呼ばず、口頭で『予約しておきますね』と言って終わる」のくだり、まったく同じ現象を発信側で踏みました。私は逆向き（AI が店に電話をかける側）で、「AI は判断を提案するだけ、確定はコードが行う」の線引きを相手の発言に対して適用した OSS「Oathra」を作っています。店員が「たぶん大丈夫ですが、まだ確定ではありません」と言っても確定扱いにならず、「承りました」の後に料金が変わると確定が失効します。API キーなしで `npx oathra demo`、自分が店員役として電話に出るモードがあります。
> （共通の末尾）

X 用（@shineos_corp への公開リプ、140 字）:
> 「口頭で『予約しておきますね』と言って終わる」問題、発信側でも同じでした。店側の発言だけを根拠に確定を判定する OSS を作っています。店員役として「たぶん大丈夫」と言っても確定にならない部分を見ていただけませんか。npx oathra demo（キー不要） https://github.com/FORIFOR/oathra

## 2. yuche — X 公開リプ（@pomufgd、記事: https://zenn.dev/yuche/articles/twilio-patter-openai-realtime-japanese-voice-agent）

> Patter の PascalCase→snake_case のモンキーパッチ、同じ壁に当たった人がいて救われました。営業電話 AI の次の問題は「約束が取れたと言えるか」だと思っていて、相手の発言だけを根拠に成立を判定する OSS を作っています。Twilio+Realtime の実装者として「どこで試すのをやめたか」を教えてもらえませんか。npx oathra demo https://github.com/FORIFOR/oathra

## 3. milix_m — X 公開リプ（@_milix_m、記事: https://zenn.dev/milix_m/articles/ede75fba87c10b）

> Gemini Live の架電ブリッジ、μ-law↔PCM の変換まで書かれていて参考になりました。まとめの「通話内容の要約」を、要約ではなく相手の発言に紐づく証拠で出す OSS を作っています（Gemini を店員役にも使えます）。店員役として「たぶん大丈夫」と言っても確定にならない部分を試していただけませんか。npx oathra demo https://github.com/FORIFOR/oathra

## 4. tuchiyam_genax — Zenn コメント（記事: https://zenn.dev/tuchiyam_genax/articles/1ea3eca0741017）

> 「Function Calling は『確定』ではなく『候補の提出』」という整理が、自分の設計をそのまま言葉にしてくれた気がして、コメントさせてください。私は逆向き（AI が店に電話をかけて予約を取る側）で、AI の「予約できました」を候補として扱い、確定の根拠を店側の発言にだけ置く OSS「Oathra」を作っています。日付・時刻・人数・価格の抽出は正規表現の決定論で、LLM には判定させません。住所を DB 照合で確定するのと同じ考え方を、相手の発話に対して行っている形です。API キーなしで `npx oathra demo`、自分が店員役になれるモードがあります。
> （共通の末尾）

## 5. hszk_dev — Zenn コメント（記事: https://zenn.dev/hszk_dev/articles/0c8c9f7d2f1818）

> 「会話」と「評価」の分離、特に評価を事後の LangGraph に切り出して Thinking を有効にする構成が参考になりました。私は電話予約 AI で同じ分離をしていて、ただし「成立したか」の判定だけは LLM ではなく決定論のルールにしています（相手が「承りました」と言ったか、条件が後から変わっていないか）。ロープレでも「次回アポが取れたか」のような成立判定にルールが載るのか、実装されている立場のご意見を伺いたく、OSS「Oathra」を見ていただけないでしょうか。`npx oathra demo` で API キーなしに動きます。
> （共通の末尾）

## 6. i_ichi — X 公開リプ（@axis_arcs、記事: https://zenn.dev/i_ichi/articles/wakeword-livekit-eval-vs-realmic）

> 「内部 eval 98% は Verification、実マイクは Validation」という切り分けに刺さりました。私の電話予約 OSS は「1 万通りの店員役で誤完了 0」を CI 条件にしていますが、それは Verification でしかありません。実装者として、どこで試すのをやめたかを率直に教えてもらえませんか。npx oathra demo https://github.com/FORIFOR/oathra

## 7. halapolo — Qiita コメント（記事: https://qiita.com/halapolo/items/268d8747e1a242c12bfc）

> TAC で予約受付 AI が 50 行になる例、`onMessageReady` にテキストが来る設計がきれいで、こういうのを待っていました。その先で気になっているのが「名前・日付・時間・人数が揃った後、予約が成立したと誰が決めるか」で、私は AI ではなく相手の発言を根拠に決定論で判定する OSS「Oathra」を作っています（Twilio 直結の実装も同梱、GPT-Live で実通話確認済み）。`onMessageReady` の発話列に判定層を載せる形が TAC と噛み合うか、Twilio 側の視点でご意見をいただけないでしょうか。`npx oathra demo` で API キーなしに動きます。
> （共通の末尾）

## 8. unclesam-ly — Qiita コメント（記事: https://qiita.com/unclesam-ly/items/a1ae2aa68bdd14d181db）

> 「Agent はビジネスロジックを持たず、音声↔テキストの変換のみ」「書き起こしを HTTP でメインバックエンドに書き戻す」という分離が、自分の構成と近くて読み込みました。私は AI が電話をかけて予約を取る OSS「Oathra」を作っていて、「成立したか」の判定を書き起こし列に対する決定論の関数にしています（相手の発言だけが根拠、LLM は判定しない）。LiveKit の SIP ゲートウェイ経由で実通話にも出られます。既存の通話基盤に判定層を足すという形が現実的か、導入された立場でのご意見をいただけないでしょうか。`npx oathra demo` で API キーなしに動きます。
> （共通の末尾）

## 9. kenimo49 — X 公開リプ（@kenimo49、記事: https://qiita.com/kenimo49/items/a465ba365538f727cb93）

> 「遅延の 7 割は LLM の TTFT」の実測、Realtime 系に寄せる判断の根拠にさせてもらいました。私は電話予約 OSS で `oathra phone doctor` が carrier / gateway / media / engine の層ごとに遅延を出すのですが、この切り方が実測の観点で妥当か見ていただけませんか。npx oathra demo https://github.com/FORIFOR/oathra

## 10. okssusucha — Qiita コメント（記事: https://qiita.com/okssusucha/items/d12c24530c5494b4b6aa）

> 「速い会話係と重い思考係を 2 枚に分ける」整理が腑に落ちました。私は GPT-Live を既定エンジンにした電話予約 OSS「Oathra」を作っていて、毎秒判断する全二重モデルほど「予約が成立したか」の判定をモデルの外に出す必要がある、という立場です（相手の発言だけを根拠に決定論で判定、条件が変われば確定が失効）。Realtime API で委譲パターンを組まれている方に、判定層を外に置く構成が噛み合うか見ていただけないでしょうか。`npx oathra demo` で API キーなしに動きます。
> （共通の末尾）

---

送信順の提案: 4 → 1 → 7 → 8 → 5 → 10（コメント、返信率が高い）、その後 2 → 3 → 6 → 9（X）。1 日 3〜4 通まで。返信が来たら `trial-observations.md` に「届いた／試した／止まった場所／意見」で記録する。
