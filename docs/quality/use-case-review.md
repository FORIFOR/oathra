# 用途別構想デモの実操作・独立レビュー

2026-10-10 UTC。対象は公開サイトの `/demos/?flow=restaurant|stock|modify`。判定は **keep**。確認した経路に P0 / P1 はない。実電話、実予約、実店舗検索、音声認識、外部プロバイダの品質を証明するものではない。

## 対象と方法

- `.claude/skills/ui-review/SKILL.md`、`CLAUDE.md`、`docs/design/ui/brief-gateway.md` の現行 Ring Zero 方針、`docs/design/ui/acceptance.md`、`docs/design/ACCEPTANCE.md` を参照。
- 独立 QA 担当が [専用ブラウザ検証](../../scripts/ui/use-cases.mjs) を作成。macOS の Google Chrome 155.0.8059.39 をサンドボックス有効で起動し、実際のフォーム入力・クリック・Tab・Enter を使用。モデルを直接操作せず、`window.demoSnapshot()` は観測だけに用いた。返却オブジェクトを書き換えてもセッションが変わらないことも確認した。
- 静的サイトを一時的な `127.0.0.1` サーバーで配信。実店舗、電話番号、認証情報、支払い方法の入力なし。ページの全ネットワーク要求とエラーを記録した。
- 1440×1000、1024×1000、390×844 で入力・本人承認・模擬通話・結果を撮影。追加で 720 CSS px の reflow と reduced motion を検証。画像は開いて読んだ。別の読み取り専用レビュー担当も、3 用途 × 1440/390 × 入力/承認/結果の代表画像と不成立結果を確認した。

## 検証結果

[最終の基本検証ログ](../../artifacts/use-cases/qa-results.json) は **48 / 48 PASS**（2026-10-10 19:00:52 UTC）。最後のフォーカス修正後に実施した [Enter で会話を最後まで進める追加検証](../../artifacts/use-cases/qa-keyboard-results.json) は **3 用途すべて PASS**、その実行の通信・エラー確認も PASS。重複する通信確認を除くと 51 個の検証ケースである。

| 相手の応答 | 飲食店予約 | 型番指定の取り置き | 19時→20時への変更 |
| --- | --- | --- | --- |
| 条件どおり成立 | completed、日時・人数・7,000円と確定発言 | completed、AZ1000・6,800円・受取期限と確定発言 | completed、合成台帳を20時へ更新 |
| 電話不通 | failed | failed | failed、19時を維持 |
| 相手が拒否 | incomplete | incomplete | incomplete、19時を維持 |
| 条件外料金 | constraint_violation | constraint_violation | constraint_violation、19時を維持 |
| 曖昧な返答 | incomplete | incomplete | incomplete、19時を維持 |
| 成立後の訂正 | incomplete | incomplete | incomplete、19時を維持 |

承認前には通話記録・結果がなく、確認画面の具体的な相手と条件が承認に固定された。各会話ステップで承認の存在を確認し、通話が終わる前に成功を返さなかった。不成立時の結果画面は、未確定・失効した数値を確定済みの結果として強調しない。

次の操作も確認した。

- 確認から戻っても入力を保持。確認時と通話中の取消は取消結果で停止し、変更用途では19時の元予約を維持。
- 通話中に戻った場合は承認と会話を破棄。予算変更後は改めて本人承認が必要で、新しい予算を承認に使用。
- 用途や相手の応答を切り替えると承認を破棄。承認の連打で別の通話を増やさず、「次の応答」の連打で会話を飛ばさない。
- 再読込は合成の初期状態へ戻り、承認も会話も復元・再送しない。保存機能はこのデモにはない。
- 空・範囲外・小数の予算、範囲外の日付、0/7/小数の人数を拒否し、未承認のまま。型番は合成データの選択肢に限定。
- 別の架空店、12月5日20:30、4名、14,000円上限の予約、および FZ-2000、12月6日17:30、9,900円上限の取り置きが、編集した条件で結果へ到達。商品価格より低い2,000円上限では成立しない。
- キーボードだけで確認・承認・中止に到達。追加確認では、繰り返し Enter で模擬通話の最後まで進み、次の応答ボタンにフォーカスを保持し、最後は結果見出しへ移った。
- 3 用途・3 幅・4 段階で文書全体の横はみ出しなし。注意書きはスクロール後も viewport 内にあり、reduced motion ではボタンの transition が 0 秒。

基本検証の 195 リクエストと追加キーボード検証の 9 リクエストは、すべて同じ loopback origin の GET。外部要求、POST、ページ例外、console error、HTTP 400以上は **0**。これはデモページの観測範囲の結果であり、ブラウザ自体のバックグラウンド通信や実サービス全体を監査した主張ではない。

## 画面の確認と指摘

次の画像を含め、実際に画像を開いて確認した。フルページ画像の sticky 注意書きがページ途中に写ることがあるため、実 viewport 画像と要素座標で位置を別確認した。[モバイルの実座標](../../artifacts/use-cases/qa-mobile-viewport.json) では注意書きは上端0〜42px、承認見出しは約68pxから表示されている。

- [予約・1024px・本人承認](../../artifacts/use-cases/qa-restaurant-1024-review.png)：電話先・開示情報・任せる範囲・費用・承認を読める。
- [予約・390px・本人承認の実 viewport](../../artifacts/use-cases/qa-restaurant-390-review-viewport.png)：日時・人数・予算を承認ボタンより前に読める。
- [取り置き・390px・入力](../../artifacts/use-cases/qa-stock-390-input.png)：型番・上限価格・受取日・期限・無料条件を縦に入力できる。
- [取り置き・1440px・成功結果](../../artifacts/use-cases/qa-stock-1440-result.png)：型番・価格・期限と相手の確定発言を結果に表示する。
- [変更・390px・本人承認](../../artifacts/use-cases/qa-modify-390-review.png)：具体的な日付・人数、19時から20時、無料・不可時の維持を読める。
- [変更・1440px・相手の訂正結果](../../artifacts/use-cases/qa-modify-correction-result.png)：不成立と元の19時の維持を表示し、訂正前の20時を確定した結果として強調しない。
- [予約・キーボード完了](../../artifacts/use-cases/qa-restaurant-keyboard-completed.png)、[取り置き・キーボード完了](../../artifacts/use-cases/qa-stock-keyboard-completed.png)、[変更・キーボード完了](../../artifacts/use-cases/qa-modify-keyboard-completed.png)：操作結果とフォーカスの実操作証拠。

レビューで見つけた「訂正結果に古い20時が大きく残る」「狭幅の承認前に日時・人数が再掲されない」「狭幅の主要本文が16px未満」「応答選択が43px」の P2 は修正され、更新した画像で再確認した。

残る P2 は、結果の補助操作 **「模擬通話の記録をすべて見る」の summary が高さ38px** で、プロジェクト推奨44pxを下回ること。主操作は失われておらず P0/P1 ではない。最小の改善は summary の min-height を44px以上にすること。再確認は3幅で当該操作の高さと展開のキーボード操作を測る。

維持する点は、常時読める「構想デモ・実際の発信/予約は行いません」、架空の非発信番号、明示承認、費用・購入義務の制限、未成立と成立の明確な区別、相手の最終発言の併記、変更できない場合の元予約の維持である。競合との優越比較はしていない。

## 再実行

```sh
pnpm build:site
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node scripts/ui/use-cases.mjs
```

`playwright-core` を通常の Node 解決範囲に導入済みなら `PLAYWRIGHT_MODULE` は不要。Chrome の自動検出に合わない環境では `CHROME_PATH` を指定する。`DEMO_BASE_URL` がなければ一時的な loopback 静的サーバーを自動起動し、終了時に閉じる。Chrome のサンドボックスは無効化しない。

追加キーボード検証を分離したコマンドは次のとおり。

```sh
QA_FILTER='keyboard-complete|no-external-requests-or-page-errors' \
QA_REPORT_NAME=qa-keyboard-results.json \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
node scripts/ui/use-cases.mjs
```

初回試行の5失敗は、フォームの blur/submit 前の古い観測値を承認値と比較していた検証スクリプト側の問題だった。比較を本人が実際に確認した review 状態へ移して再実行した。初回のもう1失敗は既存の外部静的サーバーの404 console resourceで、自己起動サーバーでは任意の favicon に204を返し、全HTTPエラーを別途監視している。最終結果はこの問題を残さず完走したもの。

## 対象コードと未確認範囲

レビュー基点の既存 HEAD: `5164eef4e7b1bdf52787830062e7aa3d0d785d2c`。作業中の用途別デモを検証した。最終フォーカス修正後の対象 SHA-256:

| ファイル | SHA-256 |
| --- | --- |
| `site/src/use-cases.ts` | `199e3334ad9eb935b1c85ef81cd6558aa583d2a163dace1c1a47dfe3984a319b` |
| `site/src/use-case-model.ts` | `3d92cd612dfec884054091e20a506b1037570180939eb4de1a3d2779ad6307de` |
| `site/demos/index.html` | `d02d705d722b0020ded14a8200dbd8c2d1aeb79a00d3e91b7c217bb68b96f5aa` |
| `site/demos/demo.css` | `63e9e5b63b7c476a2d4b91cf911587053bfbc22d39c11fe904a804d72e8ca869` |
| `site/use-cases.js` | `f66c25247fdc53f6cb42a723e051773a8e254a71607ea4ba836cf7b4757852ec` |

UNVERIFIED: 実機 iPhone / Safari、スクリーンリーダー、日本語 OS IME、真の200%文字ズーム、視覚障害のある利用者を含むユーザーテスト、フィールド性能、動画全編のデコード・字幕・尺。動画 QA と公開・転送は別担当の成果を参照する。実発信、店舗台帳、支払い、本人の実データは、この構想デモの検証対象外。取り置きの「無料・購入義務なし」は合成台本の固定条件であり、任意の実通話から抽出できる能力として証明していない。
