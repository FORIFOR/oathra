# 洗練されたホームページと動画にするための調査（2026-09-12）

「動画も AI 感がある。洗練させてほしい。音声はないのか」という指摘を受けて、人気のある開発者向けプロダクトの LP・紹介動画・スター獲得事例を調べ、Oathra の現状と突き合わせたメモです。結論だけ先に書きます。

## 結論

1. **今の動画は「モーショングラフィックのテンプレート」型**。人気のある開発者向け動画は逆で、**本物の画面を、操作している場所にズームしながら、音付きで見せる**（Screen Studio / OpenScreen 型）。タイトルカードとスローガンで始めず、最初の 1 秒から製品が動いている。
2. **音は必須**。ただし BGM ではなく、**実際の会話の声・キー入力・呼び出し音**といった「その場の音」。ナレーションは友達に説明する口調で短く。字幕は音なし再生（SNS の 8 割）のために必ず焼き込む。
3. **AI 感の正体**は「どの会社でも使えるもの」。抽象的な見出し（「結果。誰も嘘をつかなかった。」「あなたのモデルも、同じ土俵で。」）、均一な余白と角丸、小さすぎて読めないカード、等間隔のシーン切り替え、無音。人気サイトは製品のスクリーンショットが画面を支配し、コピーは具体的で「特定の人間が書いた」文体。
4. **スターが伸びる経路は Show HN → Zenn/Qiita の順**。本人の X アカウント単独ではほぼ動かず、Reddit・Product Hunt・awesome リストは複数の事例で「効果なし」。Oathra で残っている本当のレバーは、HN 投稿と Zenn 記事のふたつ。

## 調べた対象

### 人気 LP の構造（Linear / Screen Studio / Zed）

| サイト | ファーストビュー | 続く構成 | コピーの調子 |
|---|---|---|---|
| Linear | 具体的な一文の見出し＋製品画面の大きなスクリーンショット | 3 つの価値→機能ごとに実画面→変更履歴→顧客の声→締めの CTA | 断定的、誇張なし、動詞で始まる |
| Screen Studio | 「Beautiful Screen Recordings in Minutes」＋再生ボタン付き動画 | 使っている企業ロゴ→機能ごとに動画→価格→FAQ | 自信はあるが親しみやすい |
| Zed | 「Your last next editor」の一行＋Download / Clone source | 速い・エージェント・協働の 3 本柱→開発の活動ログ→著名開発者の声→機能ごとの動画 | 会話調、少しの冗談 |

共通点: **画面の主役は製品の実画面**。装飾的な背景やスローガン中心のセクションはない。動きは UI の状態変化そのもので、飾りのアニメーションは控えめ。

### 「AI が作った感」の判定基準（925 Studios、UX Planet）

- Inter などデフォルトの書体だけで組んである
- 紫〜青のグラデーション、全要素に同じ 16px の角丸と 24px の余白
- 「未来を作る」「オールインワン」型の、製品固有でない見出し
- ストック写真・抽象 3D、ホバーしても何も起きないボタン、同じフェードインだけのスクロール演出
- 文の長さが揃っている、接続句の使い回し

直し方として挙げられているもの: 見出し書体をひとつ決めて本文と対にする、色は意味で名付ける、**製品の実スクリーンショット**を使う、動きは「状態の変化を伝える」ためだけに使う、コピーは「本人が実際にそう言うか」で判定する。

### 動画のセオリー（ngram 2026 playbook、Clickstrike、Sonilo、Bun 1.0 の HN 反応）

- 最初の 5 秒で価値を見せる。ロゴ、自己紹介、ゆっくりした導入は禁止
- **序盤は 1〜2 秒ごとに画面上の何かが変わる**。形容詞ではなく実演
- 長さ: SNS 向けは 30〜60 秒。サイト埋め込みは 2〜5 分でも見られる
- 構成は「問題→状況→解決→機能→CTA」。CTA はひとつだけ
- 字幕は必須（音なし再生が 8 割）。1:1 は X、16:9 はサイト、9:16 は縦動画用に**作り直す**（切り抜きではなく）
- 音: BGM は入れるなら声の下で下げ、意図した無音の瞬間だけ持ち上げる。**UI の微かな音が主役なら BGM は入れない**。書き出し後に「映像なしで聴く」「スマホのスピーカーで聴く」「小音量で聴く」の 3 チェック
- 声は台本読み上げの営業口調ではなく、友達に説明する声。Bun 1.0 の動画は「要点が早い」と評価された一方、「プロンプトを読んでいるのが分かる」「目線が合わない 2 カメラが気になる」と細部を突かれた。**演出の技巧より、自然に話しているかが見られる**

### Screen Studio 型が支持される理由

クリックした場所へ自動でズーム、カーソルを大きく滑らかに、丸角のウィンドウを無地の背景に置く。「編集者を雇ったように見える画面録画」が、開発者・創業者の X 投稿で定番になった。OSS 代替の OpenScreen は 2025 年 10 月公開、1 週間で 14,396 スター、2026 年 5 月に 34,000 スター。README は「Screen Studio のオープンソース代替」の一文の直後にデモ GIF。

### スターが伸びた事例（Zenn の実録 3 本、AFFiNE）

| 事例 | 効いた | 効かなかった |
|---|---|---|
| Ephe（400+ スター） | Show HN でトレンド 1 位。影響力のある人の X シェア | 本人の X 単独、Reddit（2.4k 閲覧で 6 票）、Product Hunt、awesome リスト（「実質閲覧されていない」） |
| nuko_suke_dev（100 スター） | Show HN（1 時間でトップ、数日残留）、次点で Zenn / Qiita | Reddit（新規アカウント制限）、dev.to、Mastodon、X |
| AFFiNE（60,000 スター） | README 冒頭に一文＋GIF、3 ステップ以内のクイックスタート（改善後ペース 2.3 倍）。機能リリース時に HN / Reddit / PH / X / Discord へ同時「点火」 | — |

## Oathra の現状との差

### 動画（`docs/media/oathra-battle-ja.mp4`）

| 観察 | 該当する「AI 感」 |
|---|---|
| 0〜3 秒が黒背景に明朝の見出し、次に空の端末 | ロゴ・導入から始めている。最初の 5 秒で製品が動いていない |
| 3 列のカードは文字が小さく、実寸では読めない | 「実演」になっていない。ズームがない |
| 「結果。誰も嘘をつかなかった。」「あなたのモデルも、同じ土俵で。」 | 製品固有でないスローガン |
| シーンが等間隔、動きは同じフェード | テンプレートの動き |
| 無音 | 音なし。臨場感がない |
| 均一なダークグラデーション、同じ角丸 | 均一な余白・角丸 |

### サイト（`site/index.html`）

良い点: 日本語一次、明朝の見出し、具体的な数字、正直な現状セクション。
弱い点: ヒーローの動画が上記の通り。製品の**実画面**が少なく、散文と端末の擬似出力が中心。セクションの余白と角丸が均一。「作った理由」以外は「どの会社でも書ける」文が残る。

### 配布

やった: リポジトリ公開、Pages、rc.1、Discussions、awesome リスト PR ×2、X 投稿 ×5。
事例に照らすと、**効くはずのもの（Show HN、Zenn 記事）がふたつとも未着手**で、効かないと分かっているもの（awesome リスト、本人の X）だけが済んでいる。

## 作り直しの方針

### 動画 v2「実際の通話を、音付きで」（約 40 秒、16:9 と 1:1）

1. **0〜4 秒**: タイトルなし。本物のターミナルに `npx oathra battle impossible-hotel --agent scripted --agent openai --agent gemini` が打鍵音付きで打たれ、Enter。呼び出し音が 3 つ重なる。字幕:「定価 23,500 円のホテルに、2 万円以下で取れと 3 つの AI に頼んだ」
2. **4〜28 秒**: Arena の実画面（`?present=1`）を CDP で録画し、Screen Studio 型に**動いている列へズーム**。会話は実データを OpenAI TTS（`gpt-4o-mini-tts`、ホテル役と AI 役で別の声）で読み上げ、聞こえるのは常に 1 列だけ。他の列は動いたまま小さく見える。字幕はその発話そのもの。値切りの往復→「ご予約承りました」
3. **28〜34 秒**: 証拠パネルにズーム。`confirmed` を反転させたホテルの一文がハイライトされる。字幕:「完了は AI が決めない。相手のこの一言で決まる」
4. **34〜40 秒**: 実際の `oathra battle` の出力（3 者とも成立、False completions: 0）→ コマンドとリポジトリ URL。スローガンなし
- **音**: BGM なし。声・打鍵・呼び出し音・受話器を置く音だけ。声の下は静かな部屋のノイズ。書き出しは -16 LUFS 前後のモノラル互換で、映像なし・スマホ・小音量の 3 チェック
- **費用**: TTS は約 1,500 文字で数円。電話はかけない
- **ナレーション**: 入れない。入れるなら本人の声で 2 文まで。合成の営業口調は入れない

### サイト v2「実画面が主役」

- ヒーロー: 上の動画（音ありボタン付き）。見出しは一文で製品固有に。「電話をかける AI エージェント。ただし『予約できました』は、相手がそう言った時だけ」
- 直後に Arena の実スクリーンショットを大きく 1 枚。文章より先に画面
- セクションごとに余白と幅を変える（均一な 2 カラムをやめる）。角丸は端末と動画だけ
- 端末の擬似出力を、実際の出力のスクリーンショットに置き換える
- 「どの会社でも書ける」文を削る。残すのは、作った理由、実際の対戦、実際に電話した記録、正直な現状
- 英語版は Show HN 向けに、見出しを「Phone calls for AI agents, where 'booked' is only true if the callee said it」型の比較・具体表現に

### 配布 v2

- **Show HN**（英語、タイトル案: `Show HN: Oathra – AI phone agents where "booked" is only true if the callee said it`）。投稿は HN アカウントが要るのでユーザーの操作
- **Zenn 記事**（`articles/oathra-launch.md` は下書き済み。GitHub 連携でそのまま公開）
- README は「一文＋GIF＋3 ステップ」の順に組み替える
- awesome リスト PR の追加はしない（効果が確認できない）

## 出典

- 925 Studios, "AI Slop Web Design: Complete Guide" — https://www.925studios.co/blog/ai-slop-web-design-guide
- UX Planet, "How To Spot AI-Generated Design" — https://uxplanet.org/how-to-spot-ai-generated-design-697aaabe76c8
- ngram, "Product Launch Video: The Complete Playbook for 2026" — https://www.ngram.com/blog/product-launch-video-complete-playbook-2026
- Clickstrike, "How to Make a Product Launch Video Go Viral in 2026" — https://clickstrike.com/blog/product-launch-video-guide/
- Sonilo, "Background Music for Software Demo Videos" — https://sonilo.com/blog/guides/background-music-software-demo-videos
- Hacker News, Bun 1.0 announcement video thread — https://news.ycombinator.com/item?id=37422106
- Screen Studio — https://screen.studio/ ／ Linear — https://linear.app/ ／ Zed — https://zed.dev/
- Qiita, "openscreen：Screen Studio キラーが 1 週間で 14,396 Star を獲得した理由" — https://qiita.com/nogataka/items/7a1f666e41a51efaa48f
- Zenn, "弱小 OSS が GitHub Star を集める方法" — https://zenn.dev/kirohi/articles/227345b7ed54d5
- Zenn, "GitHub Star 100 獲得するまでにやったこと" — https://zenn.dev/nuko_suke_dev/articles/a02ebfb0b5ab4b
- Zenn, "GitHub スターを増やす方法：AFFiNE が 6 万スターを達成した戦略" — https://zenn.dev/gingiris/articles/github-stars-increase-guide
- レバテック LAB, catnose インタビュー — https://levtech.jp/media/article/interview/detail_283/
