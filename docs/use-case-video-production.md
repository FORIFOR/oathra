# 用途別デモ動画の収録と検証

3本とも、このリポジトリの `/demos/` を実際に操作して収録します。構想デモのUI上でフォームを入力し、確認・承認・模擬通話のボタンを押します。画面状態や通話結果を動画だけのために差し替えません。データは合成、店舗・製品・番号は架空です。

常時表示は **「構想デモ・実際の発信/予約は行いません」**。字幕とクリック位置を示すポインターがあり、音声なしで操作を追えます。実発信、予約、支出、音声生成、有料APIは使用しません。

## ローカルの必要環境

- Node.js 22 以降、既存の Chrome、FFmpeg / FFprobe（libx264）。
- 既存の `playwright-core`。パッケージをインポートできない場合は `OATHRA_PLAYWRIGHT_MODULE` にその `index.mjs` の絶対パスを指定します。
- 日本語フォント。Mac ではシステムのヒラギノを使い、外部フォントは取得しません。
- `http://127.0.0.1:4318/demos/` で静的デモを配信するローカルサーバー。

このスクリプトは依存やブラウザをダウンロードしません。Chrome は一時プロファイルで起動し、`chromiumSandbox: true` を維持します。制限環境で Chrome 起動が拒否された場合は、通常の実行承認で起動してください。`--no-sandbox` など保護を弱める回避はしません。

## 実行

```sh
# 必要な場合のみ。既存のインストールを指定します。
export OATHRA_PLAYWRIGHT_MODULE='/absolute/path/to/playwright-core/index.mjs'

node scripts/record-use-cases.mjs --base http://127.0.0.1:4318

# 1本だけの再収録
node scripts/record-use-cases.mjs --flow restaurant

# 既存の書き出しをフルデコードし、静止画と検証報告を作り直す
node scripts/record-use-cases.mjs --verify-only
```

Chrome の場所は `OATHRA_CHROME` または `--chrome`、FFmpeg は `FFMPEG`、FFprobe は `FFPROBE` で指定できます。`--help` で他の引数を確認できます。既定出力は1440×900（16:10）、25 fps、約50秒、H.264 / yuv420p、無音、BT.709、MP4 faststartです。操作領域を字幕に隠さず、縦横比を維持して収録します。

## 収録のしくみ

Playwright は実際の入力・マウス操作に使用します。動画は Chrome のネイティブ `Page.startScreencast` が返す JPEG と描画時刻から作ります。ピクセルが変化しない間は直前の実キャプチャを保持し、FFmpeg で25 fpsへ変換します。静止画を合成してUIや結果を捏造する方式ではありません。生成AI、Remotion、録画用の追加FFmpegダウンロードは使いません。

既存の Oathra `scripts/record-evidence-demo.mjs`、`scripts/capture-demo.mjs` と Launchloom のローカル収録・フルデコード方式を参考にしています。既存の録画やLaunchloomのチェックアウトは変更しません。

ループバックのHTTPサーバーだけが指定可能です。ページのネットワーク要求は同一オリジンのGET/HEADのみ許可し、他の要求は遮断して報告します。サービスワーカーは無効です。これは録画ページの要求の制限であり、OS全体のネットワーク制御を変更するものではありません。

## UIとの契約

- URL: `/demos/?flow=restaurant|stock|modify&capture=1`
- 字幕API: `window.setDemoCaption(text)`。録画の説明文だけを変え、業務状態に影響させません。
- 操作: `data-testid="review"`、`approve`、`next`、`scenario`。
- フォーム: `input-time`、`input-budget`、`input-partySize`。該当用途にある項目だけを入力します。
- 確認: `disclaimer`（常時表示文言）、`demo-caption`（字幕）、`result`（結果）。
- 読み取り専用状態: `window.demoSnapshot()` が `{stage, step, totalSteps, ...}` を返します。
- 初期scenario: 飲食店/在庫は `normal`、予約変更は `declined`。模擬返答数と最後の結果確認を合わせ、`totalSteps + 1` 回までの `next` を操作します。実UI仕様が変わった場合は収録タイムラインを合わせてください。

収録は条件入力→約9秒で確認→約18秒で承認→20〜43秒の間で返答を順に進める→最後の約7秒で結果を読み取る流れです。各動画の行動・実際の結果・表示本文・通信履歴をJSONに保存します。

## 納品とQA

公開用:

- `docs/media/use-case-restaurant.mp4` / `use-case-restaurant-poster.jpg`
- `docs/media/use-case-stock.mp4` / `use-case-stock-poster.jpg`
- `docs/media/use-case-modify.mp4` / `use-case-modify-poster.jpg`

検証証跡は `artifacts/use-cases/` に保存します。

- `*-recording.json`: 実操作時刻、結果、ページエラー、通信、文言・文字サイズ・横はみ出し検査。
- `*-qa.json`: SHA-256、FFprobe属性、フルデコード結果、確認静止画の位置。
- `*-opening.png` / `*-middle.png` / `*-ending.png`: 書き出したMP4の冒頭・中間・末尾。
- `--keep-frames` 指定時は `raw-*` に元の実キャプチャと時刻のconcatリストも残します。通常は検証成功後に削除します。

スクリプトは全編を `ffmpeg -v error -xerror -i ... -f null -` でデコードし、尺30〜60秒・1440×900・H.264・yuv420p・音声トラックなし・各ファイル8 MiB未満を確認します。要所で常時表示の位置・最小18px、字幕最小22px、横はみ出し、操作ボタンと字幕の重なりを検査します。

**自動検査のみで納品完了にしません。** 3本それぞれの冒頭・中間・末尾画像を開き、字幕と結果の一致、構想デモ表示、文字潰れ、余白、操作の見やすさを目視確認してください。必要なら中間以外の承認画面・結果画面も確認します。動画の最終確認者と判断は別途納品報告に残します。

## 今回の納品確認

3本とも50.00秒、1440×900、25 fps、1,250フレーム。全編デコードに成功し、音声トラックなし・8 MiB未満です。Codexが各動画の0.5秒・25秒・49秒、および12秒の承認画面を画像で目視確認しました。字幕・構想デモ表示は判読でき、承認ボタンや結果の文字と重なりません。

| 動画 | 実画面で確認した結果 | バイト数 |
| --- | --- | ---: |
| `use-case-restaurant.mp4` | 予算上限4,000円を本人承認。11月20日19:00・2名・参考金額3,000円の予約成立を確認（模擬） | 809,292 |
| `use-case-stock.mp4` | AZ-1000・上限10,000円・11月20日18:00を承認。6,800円、費用・購入義務なしの取り置き成立を確認（模擬） | 847,897 |
| `use-case-modify.mp4` | 19時→20時への無料変更を承認。相手に断られ、変更不成立・元の19時の予約を維持（模擬） | 785,713 |

最終MP4のSHA-256:

```text
restaurant e77550764a22150bbd8a541fc0ffce7e2b6fef94271eaeefaa89370f96e28fe4
stock      209850cf8cba048f6b9267433848ac958d0eee69a780768fbbfa7979c303497a
modify     228d9426330c12c238840dacf14243fd7ad441f9fbf109f0cdc39a358e9b913c
```

実操作の時刻と状態、最終結果、個別QAは `artifacts/use-cases/verification-summary.json` と各JSONに保存しています。録画中のページエラー・遮断対象となる予期しない通信は3本とも0件でした。この確認はローカル構想デモの操作と動画に対するもので、実店舗・電話回線・在庫や予約の実台帳への接続確認ではありません。
