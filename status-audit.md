# 現状監査：Oathra

- 調査日時：2026-09-14 23:58:03 JST
- 対象：`/Users/horioshuuhei/Projects/RingZero`、公開リポジトリ `FORIFOR/oathra`
- 固定識別子：`oathra`
- 調査範囲：公開API、公開ページ、公開投稿、ローカル設定・運用資料の読み取りのみ。投稿、返信、いいね、フォロー、課金、フォーム送信、登録、設定変更、コード変更、デプロイは実施していない。
- 判定語：**確認済み**＝現在の公開ページ/APIで確認、**資料記載のみ**＝ローカル記録にあるが現在の公開状態を確認できない、**未確認**＝存在・接続・数値を確認できない、**取得不可**＝対象はあるが公開APIまたは未認証画面から取得できない。

## 1. 現状の要約

Oathra は、GitHub の [`FORIFOR/oathra`](https://github.com/FORIFOR/oathra)、GitHub Pages の日本語・英語サイト（いずれも HTTP 200）、ブラウザの証拠チェッカー、GitHub Release v0.1.15、npm の `oathra@0.1.0`、Zenn 2本、DEV 2本で公開されています。X は `@forifori_dev` から Oathra 関連投稿を確認でき、TikTok は `@foriforapps` の既存リールが運用資料に記録されています。Reddit の投稿はフィルター削除、Facebook のリール公開は確認できませんでした。YouTube、Instagram、LinkedIn、Qiita、Product Hunt、Hacker News、LiveKit コミュニティの Oathra 用アカウントまたは投稿は確認できませんでした。

主な発信者は GitHub ユーザー `FORIFOR`、X `@forifori_dev`、Zenn `@forifori`、DEV `@forifor`、共用動画アカウント `@foriforapps` です。訴求は「電話AIの『予約できた』を相手側の発話に紐づく証拠で検証する」「同意を一度得て、宣言済みの項目を1回に1つだけ聞き、拒否・保留・曖昧さ・忙しさで止める」です。サイトとREADMEの主要CTAはブラウザで試す、v0.1.15を導入する、GitHubでStarする、Discussion #14で用途を共有する、非公開の導入相談を送る、です。

確認できた成果は、GitHub スター 0、フォーク 0、GitHub 14日間の表示 9・ユニーク 9、クローン 530・ユニーク 199、v0.1.15リリース資産のダウンロード 3（tarball）/2（checksum）、Zennいいね 1/0、DEVのOathra記事の反応 0/0 と 0/1コメントです。GitHubのクローン、リリース資産、npmの140ダウンロード（2026-09-07〜13）は自動処理・本人確認を除外できず、外部利用者とは断定しません。XのOathra関連で現在取得できる4投稿は表示 1〜3、反応 0です。TikTokの既存リールは2026-09-14 16:10 JSTのStudio読み戻しで再生 0・いいね 0・コメント 0でした。

外部ユーザーによるIssue、PRマージ、試用報告、継続利用、問い合わせ、商談、有料利用、売上は確認できません。Pagesのイベント計測コードと非公開問い合わせエンドポイントは存在し、CORS preflight は 204 ですが、受信データや訪問者数は取得できません。実電話のAPI設定・現在の発信可否・100件規模のPSTN成績も未確認です。したがって、公開と導線は存在する一方、発信から外部試用・Star・事業成果までの因果はまだ測定できません。

## 2. プロジェクト基本情報

| 項目 | 目指している状態 | 現在確認できる状態 | 根拠 | 確認日時 |
| --- | --- | --- | --- | --- |
| 集計用の固定識別子：project_id | `oathra` を全媒体で共通利用 | `oathra`（公開リポジトリ名・package名） | [GitHub repository](https://github.com/FORIFOR/oathra)、`packages/cli/package.json` | 2026-09-14 23:58 JST |
| 現在の正式な公開名称 | Oathra | Oathra | [README.md](/Users/horioshuuhei/Projects/RingZero/README.md)、[Pages](https://forifor.github.io/oathra/) | 2026-09-14 23:58 JST |
| 旧名称、別名 | なし | ローカル作業ディレクトリ名が `RingZero`。公開資料に旧製品名は確認できない | `/Users/horioshuuhei/Projects/RingZero`、README検索 | 2026-09-14 23:58 JST |
| リポジトリ名とURL | 公開OSSの正規入口 | `oathra` / [https://github.com/FORIFOR/oathra](https://github.com/FORIFOR/oathra) | GitHub REST API | 2026-09-14 23:52 JST |
| 製品を一文で説明 | 電話AIに現実世界の操作と検証を提供 | 「電話AIの完了を、AI自身の発言ではなく相手の発話に紐づく証拠で判定するTypeScript SDK + CLI」 | [GitHub description](https://github.com/FORIFOR/oathra)、[README.md](/Users/horioshuuhei/Projects/RingZero/README.md) | 2026-09-14 23:52 JST |
| 主な想定利用者 | 電話・音声AIを開発するチーム | LiveKit、Twilio、OpenAI Realtime、Deepgram等を使う開発者として明示 | [README.md](/Users/horioshuuhei/Projects/RingZero/README.md)、[Discussion #14](https://github.com/FORIFOR/oathra/discussions/14) | 2026-09-14 23:58 JST |
| 現在、利用者に最も取ってほしい行動 | 試用後にStar、用途・失敗例の共有、必要なら導入相談 | ブラウザ証拠チェッカー、GitHub Releaseコマンド、GitHub Star、Discussion #14、非公開相談フォームへ誘導 | [日本語Pages](https://forifor.github.io/oathra/)、[英語Pages](https://forifor.github.io/oathra/en/) | 2026-09-14 23:58 JST |
| 実際に利用できる状態 | 実電話を本番導入できる状態 | ブラウザ版は即時利用可能（インストール・登録・APIキー不要）。v0.1.15 CLIはGitHub tarballから利用可能。実電話は各自のプロバイダ資格情報・番号・段階テストが必要で、現在の設定は未確認。npmのlatestは0.1.0 | [SETUP.ja.md](/Users/horioshuuhei/Projects/RingZero/docs/SETUP.ja.md)、[npm registry](https://www.npmjs.com/package/oathra)、[Release v0.1.15](https://github.com/FORIFOR/oathra/releases/tag/v0.1.15) | 2026-09-14 23:58 JST |
| プロファイリング・決定メモの実装 | 相手に配慮しつつ必要情報を集め、監査可能に保存 | `intake`契約で目的・同意・項目・上限を宣言し、同意後は1ターン1項目。`startAfter`/`dependsOn`/`choices`で分岐し、拒否・保留・曖昧・忙しさで停止。明示回答のみ `intake.json` と `summary.md` に発話ID・時刻付きで保存。属性・センシティブ情報は推測しない。実電話での現利用は未確認 | [README.md](/Users/horioshuuhei/Projects/RingZero/README.md)、[packages/runtime/src/index.ts](/Users/horioshuuhei/Projects/RingZero/packages/runtime/src/index.ts)、[packages/replay/src/index.ts](/Users/horioshuuhei/Projects/RingZero/packages/replay/src/index.ts) | 2026-09-14 23:58 JST |

## 3. アカウント台帳

| project_id | 媒体 | アカウント表示名 | ハンドルまたは取得可能なアカウントID | プロフィールURL | 種別：個人共用／組織共用／プロジェクト専用 | 共用している他のプロジェクト | 用途 | 運用担当 | 投稿方法 | 使用しているツール・実行場所 | 接続状態 | 公開済み投稿の有無 | 最終投稿日時 | 確認状態 | 根拠 | 確認日時 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| oathra | GitHub | FORIFOR / oathra | `FORIFOR` / `oathra` | [https://github.com/FORIFOR](https://github.com/FORIFOR) | プロジェクト専用（リポジトリ） | 所有者アカウントは他リポジトリも所有 | ソース、Release、Issue、Discussion、PR | 本人 + GitHub Actions | Web / git / Actions | GitHub、`.github/workflows/` | 公開API HTTP 200、Actions成功 | あり | 2026-09-14 22:03:23 JST（main最新コミット） | 確認済み | [repo API](https://github.com/FORIFOR/oathra)、[latest CI](https://github.com/FORIFOR/oathra/actions/runs/34846893873) | 2026-09-14 23:52 JST |
| oathra | X | フォリフォリ｜AIと個人開発 | `@forifori_dev` / `1278243362823270401` | [https://x.com/forifori_dev](https://x.com/forifori_dev) | 個人共用 | AI Secure等の個人開発 | Oathraの告知、動画、Release導線 | 本人 + 既存Node.js公式APIスクリプト | 公式API（過去投稿）／現在は読み取り | `scripts/publish-x-intake.mjs` | 読み取りAPI HTTP 200。最新アカウント投稿から24時間ゲート中（2026-09-15 20:20:30 JST以降） | あり（Oathra関連4件は現URL取得可、動画2件は現在取得不可） | 2026-09-14 20:20:30 JST（アカウント最新は別プロジェクト）／Oathra現存分は2026-09-14 00:52:36 JST | 確認済み（アカウント・数値）／一部取得不可（投稿） | [X read-only status script](/Users/horioshuuhei/Projects/RingZero/scripts/publish-x-intake.mjs)、[X profile](https://x.com/forifori_dev) | 2026-09-14 23:52 JST |
| oathra | Zenn | forifori | `forifori` | [https://zenn.dev/forifori](https://zenn.dev/forifori) | 個人共用 | 他記事の有無は本監査では集計対象外 | 日本語の技術記事・ローンチ記事 | 本人（記事公開） | Web（公開記事） | Zenn公開ページ・公開HTML | HTTP 200、記事本文と公開メタデータを確認 | あり（2件） | 2026-09-14 00:38:04 JST（技術記事） | 確認済み | [Zenn profile](https://zenn.dev/forifori)、[launch](https://zenn.dev/forifori/articles/oathra-launch)、[evidence](https://zenn.dev/forifori/articles/oathra-evidence-rules) | 2026-09-14 23:58 JST |
| oathra | DEV | forifor | `forifor` | [https://dev.to/forifor](https://dev.to/forifor) | 個人共用 | 他のAI記事あり | 英語の技術記事・ローンチ記事 | 本人（記事公開） | Web / DEV公開API | DEV公開API | HTTP 200、APIでOathra記事3件から対象2件を確認 | あり（Oathra対象2件） | 2026-09-14 00:38:00 JST（技術記事） | 確認済み | [DEV profile](https://dev.to/forifor)、[DEV API](https://dev.to/api/articles?username=forifor) | 2026-09-14 23:58 JST |
| oathra | TikTok | 表示名は未取得 | `@foriforapps` | [https://www.tiktok.com/@foriforapps](https://www.tiktok.com/@foriforapps) | 組織共用 | 共用範囲は未確認 | 縦型動画、既存Oathraリール | 本人（Studio） | TikTok Studio手動 | TikTok Studio（ローカルMP4選択） | プロフィール HTTP 200。Studio到達・既存リールは資料読み戻し。追加アップロードはファイル選択権限で停止 | あり（既存1件、URL/ID未取得） | 2026-09-13 20:10 JST | 部分確認（公開動画の現物URLは未取得） | [TikTok運用記録](/Users/horioshuuhei/Projects/RingZero/docs/launch/posts.md) | 2026-09-14 23:58 JST |
| oathra | Facebook | foriforapps | `foriforapps` | [https://www.facebook.com/foriforapps](https://www.facebook.com/foriforapps) | 組織共用 | 共用範囲は未確認 | Reels候補 | 本人（UI） | Facebook UI手動 | ブラウザUI | プロフィール HTTP 200。リール投稿2回の資料記録はあるが、公開タイムライン・Reels一覧で現物確認できず、追加アップロードはファイル選択権限で停止 | 未確認 | 最終公開日時未確認 | 資料記載のみ／公開結果未確認 | [Facebook運用記録](/Users/horioshuuhei/Projects/RingZero/docs/launch/posts.md) | 2026-09-14 23:58 JST |
| oathra | Reddit | 表示名は未取得 | `Important-Rip-1205` | [https://www.reddit.com/user/Important-Rip-1205/](https://www.reddit.com/user/Important-Rip-1205/) | プロジェクト専用として使用 | 共用範囲は未確認 | r/voiceagents等への技術紹介 | 本人（Web UI） | Web UI手動 | Reddit Web | 投稿URLは資料にあるが、対象投稿はフィルター削除。現在のアカウント接続・投稿権限は未確認 | あり（削除済み） | 2026-09-14 約04:19 JST | 資料記載＋削除状態確認 | [削除された投稿の記録](/Users/horioshuuhei/Projects/RingZero/docs/launch/posts.md)、[投稿URL](https://www.reddit.com/r/voiceagents/comments/1wfgy3u/i_separated_reservation_evidence_from_the_voice/) | 2026-09-14 23:58 JST |

未確認媒体は存在を推測して台帳へ追加していない。YouTube、Instagram、LinkedIn、Qiita、Product Hunt、Hacker News、LiveKitコミュニティのOathra専用アカウント・公開投稿は確認できなかった。

## 4. ホームページ・公開先台帳

| project_id | 公開先の種類 | 名称 | 正確なURL | 公開状態 | アクセスできるか | ページが伝えている価値 | 主要CTAの文言 | CTAの遷移先 | 利用開始までの手順 | 確認できたリンク切れや導線の問題 | 計測ツール | 計測の状態：コードのみ／設定済み／受信確認済み／未確認 | 確認状態 | 根拠 | 確認日時 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| oathra | 公式ホームページ（日本語） | Oathra | [https://forifor.github.io/oathra/](https://forifor.github.io/oathra/) | 公開 | HTTP 200 | 相手の発話で電話結果を検証。動画、ブラウザ体験、API設定、導入相談を一画面に集約 | 「その場で判定を試す」「v0.1.15の導入手順」「更新を追うためにGitHubでStar」 | `#sim`、GitHub Release、GitHub repo | ブラウザは入力して即判定。CLIはReleaseのnpxコマンド。実電話は資格情報と番号を設定 | npmのgeneric `npx oathra` は0.1.0のまま。サイト自身は差を明記 | `site/portfolio.js` のイベント送信 | コードあり・受信確認未確認 | 確認済み | [日本語Pages](https://forifor.github.io/oathra/)、[portfolio.js](/Users/horioshuuhei/Projects/RingZero/site/portfolio.js) | 2026-09-14 23:58 JST |
| oathra | 英語ホームページ | Oathra | [https://forifor.github.io/oathra/en/](https://forifor.github.io/oathra/en/) | 公開 | HTTP 200 | Evidence-anchored phone outcomes、consented follow-up、実演 | “Try the evidence engine”“Install v0.1.15”“Star on GitHub to follow updates” | `#sim`、GitHub Release、GitHub repo | ブラウザ→Release CLI→provider設定の順 | npm latest 0.1.0とのバージョン差 | `site/portfolio.js` | コードあり・受信確認未確認 | 確認済み | [英語Pages](https://forifor.github.io/oathra/en/)、[portfolio.js](/Users/horioshuuhei/Projects/RingZero/site/portfolio.js) | 2026-09-14 23:58 JST |
| oathra | ブラウザデモ／チェッカー（日本語） | 証拠ラボ | [https://forifor.github.io/oathra/check.html](https://forifor.github.io/oathra/check.html) | 公開 | HTTP 200 | 文字起こしをインストール・登録・APIキーなしで検証 | 「判定を試す」 | 同ページ内 | 文章入力→話者指定→証拠結果。電話は発信しない | Analytics値、外部利用者数は未取得 | siteイベント | コードあり・受信確認未確認 | 確認済み | [checker](https://forifor.github.io/oathra/check.html)、[INTEGRATION.ja.md](/Users/horioshuuhei/Projects/RingZero/docs/INTEGRATION.ja.md) | 2026-09-14 23:58 JST |
| oathra | ブラウザデモ／チェッカー（英語） | Evidence lab | [https://forifor.github.io/oathra/en/check.html](https://forifor.github.io/oathra/en/check.html) | 公開 | HTTP 200 | 自分のtranscriptをlocalで検証 | “Try it” | 同ページ内 | text input→evidence result。No call placed | Analytics値未取得 | siteイベント | コードあり・受信確認未確認 | 確認済み | [checker](https://forifor.github.io/oathra/en/check.html) | 2026-09-14 23:58 JST |
| oathra | 製品利用画面／操作デモ | 25秒transcript、30秒evidence、48秒intake、battle動画 | [Pages内の動画](https://forifor.github.io/oathra/en/#intake-video) | 公開 | MP4 HTTP 200（例：intake 48.5秒） | 実際の証拠判定、同意付き追加聞き取り、停止条件を視覚化 | “Watch”“Try it yourself” | `#sim`、scenario、integration guide | 動画視聴→ブラウザチェッカーまたはscenario | in-app browserのH.264再生は未確認（Chrome/ffmpegは確認） | `demo_start`/`demo_complete`イベント | コードあり・受信確認未確認 | 確認済み | [intake MP4](https://forifor.github.io/oathra/media/oathra-intake.mp4)、[local media](/Users/horioshuuhei/Projects/RingZero/docs/media) | 2026-09-14 23:58 JST |
| oathra | GitHubリポジトリ | Oathra | [https://github.com/FORIFOR/oathra](https://github.com/FORIFOR/oathra) | 公開 | HTTP 200 | ソース、SDK、CLI、シナリオ、Issue、Discussion | “Star”／“Code”／“Releases” | Release、README、docs、Discussion | clone→install→build→demo。APIキー不要のlocal demo | `npx oathra demo` はnpm 0.1.0を取得するためReleaseコマンドを明示する必要 | GitHub内蔵のtrafficのみ | GitHub traffic取得済み。ただし帰属不可 | 確認済み | [repo](https://github.com/FORIFOR/oathra)、[README.md](/Users/horioshuuhei/Projects/RingZero/README.md) | 2026-09-14 23:52 JST |
| oathra | GitHub Release | v0.1.15 — time-pressure safe intake | [https://github.com/FORIFOR/oathra/releases/tag/v0.1.15](https://github.com/FORIFOR/oathra/releases/tag/v0.1.15) | 公開 | HTTP 200 | シーン分岐、時間不足時停止、live context、発話 provenance | “Download source/assets” | `.tgz`、checksum | `npx --package=<tgz URL> oathra demo` | npm registryのlatestとは別配布 | GitHub asset download count | 設定済み・現在値取得済み | 確認済み | [Release API/UI](https://github.com/FORIFOR/oathra/releases/tag/v0.1.15) | 2026-09-14 23:52 JST |
| oathra | npmパッケージ | oathra | [https://www.npmjs.com/package/oathra](https://www.npmjs.com/package/oathra) | 公開 | 公開registry確認 | CLIの一般配布 | “Install / npx oathra” | npm registry | `npm install` / `npx oathra` | **latest 0.1.0**で、ドキュメントのv0.1.15と不一致 | npm downloads API | 設定済み・package/downloads取得済み | 確認済み | [npm registry](https://registry.npmjs.org/oathra)、[npm downloads API](https://api.npmjs.org/downloads/point/2026-09-07:2026-09-13/oathra) | 2026-09-14 23:58 JST |
| oathra | ドキュメント | 初心者向けセットアップ／Integration | [SETUP.ja.md](https://github.com/FORIFOR/oathra/blob/main/docs/SETUP.ja.md)、[INTEGRATION.ja.md](https://github.com/FORIFOR/oathra/blob/main/docs/INTEGRATION.ja.md) | 公開 | GitHub HTTP 200 | APIキー取得先、carrier選択、段階テスト、intake契約 | 「SETUP」「Integration」 | README、Release | Node22/pnpm→local demo→provider keys→doctor→local/gateway→PSTN | 実provider credentials・番号・課金テストは未確認 | なし | 未確認 | 確認済み（文書公開） | [SETUP.ja.md](/Users/horioshuuhei/Projects/RingZero/docs/SETUP.ja.md)、[SETUP.en.md](/Users/horioshuuhei/Projects/RingZero/docs/SETUP.en.md) | 2026-09-14 23:58 JST |
| oathra | GitHub Discussion | 技術フィードバック #14 | [https://github.com/FORIFOR/oathra/discussions/14](https://github.com/FORIFOR/oathra/discussions/14) | 公開 | HTTP 200 | 予約完了の証拠、follow-up項目、LiveKit/Twilio利用者からの意見を募集 | “Share your use case” | Discussion #14 | 公開スレッドを読む→redacted/synthetic traceを投稿（今回未投稿） | 3コメントすべてFORIFOR。外部返信なし | GitHub comments | 受信確認済み（外部返信0） | 確認済み | [Discussion #14](https://github.com/FORIFOR/oathra/discussions/14) | 2026-09-14 23:52 JST |
| oathra | 非公開問い合わせ先 | Business inquiry form | [https://forifor.github.io/oathra/#business](https://forifor.github.io/oathra/#business) | 公開 | フォーム表示・CORS preflight HTTP 204 | 業務条件を非公開で相談、範囲・料金は個別確認 | 「電話業務の試験導入を相談する」「相談を送信」 | Cloud Run `.../api/site/leads` | 氏名・メール・組織任意・相談内容・同意を入力して送信（今回未送信） | 送信成功・lead件数・返信は未確認。フォーム送信は実施していない | `leads` POST | コードあり・preflightのみ確認、受信未確認 | 確認済み（入口）／成果未確認 | [business section](https://forifor.github.io/oathra/#business)、[portfolio.js](/Users/horioshuuhei/Projects/RingZero/site/portfolio.js) | 2026-09-14 23:58 JST |
| oathra | 外部配布候補PR | Voice/AI agent lists 4件 | [#570](https://github.com/caramaschiHG/awesome-ai-agents-2026/pull/570)、[#486](https://github.com/Jenqyang/Awesome-AI-Agents/pull/486)、[#42](https://github.com/yzfly/awesome-voice-agents/pull/42)、[#364](https://github.com/e2b-dev/awesome-ai-sdks/pull/364) | PR公開・未マージ | 各GitHub HTTP 200 | 関連開発者への発見導線 | “Merge”は相手側操作 | 各PR→Oathra repo/release | maintainerがmergeするまで一覧掲載は未確定 | 4件すべてOPEN、#364はCLA botコメントあり | GitHub PR | PR状態取得済み | 確認済み（候補として公開） | [PR states](https://github.com/caramaschiHG/awesome-ai-agents-2026/pull/570) ほか | 2026-09-14 23:58 JST |

## 5. 発信履歴・運用状況

調査対象は公開開始（2026-09-11のリポジトリ作成）から2026-09-14 23:58 JST。直近30日全件を取得できる媒体APIはなく、Xは公開ページと既存の読み取りAPI、Zenn/DEVは公開HTML/API、TikTok/Facebookは運用資料、GitHubは公開APIを使った。下表の「資料記載・現URL取得不可」は公開時の記録を残すが、現在の公開状態や反応を再確認できないものを示す。

| project_id | 媒体 | 発信アカウント | 投稿IDまたは投稿URL | 公開日時 | 活動の種類 | 内容の要約 | 形式 | 使用言語 | 訴求している価値 | 読者に求める行動 | 誘導先URL | UTMなど追跡情報の有無 | 状態 | 取得できた反応数値 | 数値の取得日時 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| oathra | GitHub | FORIFOR | [v0.1.15 Release](https://github.com/FORIFOR/oathra/releases/tag/v0.1.15) | 2026-09-14 21:40:15 JST | リリース告知 | 時間圧力停止、live context、発話ID付き決定メモ | Release本文 | 日英 | 同意付きintakeの安全な停止と監査性 | Release assetを取得しdemoを実行 | tarball URL、README | UTMなし | 公開済み | tarball 3 / checksum 2（外部利用と断定不可） | 2026-09-14 23:52 JST | [Release API](https://github.com/FORIFOR/oathra/releases/tag/v0.1.15) |
| oathra | GitHub | FORIFOR | [Discussion #14](https://github.com/FORIFOR/oathra/discussions/14) | 2026-09-14 21:43:46 JST（更新） | 技術フィードバック | 完了の証拠、失敗パターン、追加聞き取り項目を募集 | Discussion | 英語 | 実装者が既存のcarrier/modelを変えずに判定を追加 | redacted/synthetic traceで回答 | Release、Integration、checker | UTMなし | 公開済み | 3コメント、全てFORIFOR、外部返信0 | 2026-09-14 23:52 JST | [GraphQL/UI](https://github.com/FORIFOR/oathra/discussions/14) |
| oathra | GitHub | FORIFOR | [awesome-ai-agents-2026#570](https://github.com/caramaschiHG/awesome-ai-agents-2026/pull/570) | 2026-09-12〜09-14（更新） | 外部配布PR | Oathra v0.1.15と直接導入コマンドを一覧候補へ追加 | PR | 英語 | 関連開発者が見つけやすい配布先 | maintainerのレビュー・merge | Release/repo | UTMなし | 公開済み・未マージ | OPEN、コメント0 | 2026-09-14 23:58 JST | [PR #570](https://github.com/caramaschiHG/awesome-ai-agents-2026/pull/570) |
| oathra | GitHub | FORIFOR | [Awesome-AI-Agents#486](https://github.com/Jenqyang/Awesome-AI-Agents/pull/486) | 2026-09-12〜09-14（更新） | 外部配布PR | Tools欄へ追加、no-API-key demoを記載 | PR | 英語 | AI agent開発者への発見 | PRレビュー・merge | Release/repo | UTMなし | 公開済み・未マージ | OPEN、コメント0 | 2026-09-14 23:58 JST | [PR #486](https://github.com/Jenqyang/Awesome-AI-Agents/pull/486) |
| oathra | GitHub | FORIFOR | [awesome-voice-agents#42](https://github.com/yzfly/awesome-voice-agents/pull/42) | 2026-09-11〜09-14（更新） | 外部配布PR | Specialized Solutionsへ追加、verified outcomeを説明 | PR | 英語 | 音声エージェント開発者への発見 | PRレビュー・merge | Release/repo | UTMなし | 公開済み・未マージ | OPEN、コメント0 | 2026-09-14 23:58 JST | [PR #42](https://github.com/yzfly/awesome-voice-agents/pull/42) |
| oathra | GitHub | FORIFOR | [awesome-ai-sdks#364](https://github.com/e2b-dev/awesome-ai-sdks/pull/364) | 2026-09-11〜09-14（更新） | 外部配布PR | SDK一覧へ追加 | PR | 英語 | SDK利用者への発見 | CLA対応とPRレビュー | Release/repo | UTMなし | 公開済み・未マージ | OPEN、bot 3 + maintainer 1コメント | 2026-09-14 23:58 JST | [PR #364](https://github.com/e2b-dev/awesome-ai-sdks/pull/364) |
| oathra | X | @forifori_dev | [2098671529647366272](https://x.com/forifori_dev/status/2098671529647366272) | 2026-09-12 16:14:18 JST | ローンチ告知 | npm公開、APIキー不要のブラウザAI通話 | 動画/文章 | 日本語 | すぐ遊べるOSS | `npx oathra demo`を試す | 短縮URL→Release/repo | UTMなし | 公開済み | views 2、likes/replies/reposts 0 | 2026-09-14 23:58 JST | 公開X HTML（`publishedTime`, `ViewCountInfo`, `ApiCounts`） |
| oathra | X | @forifori_dev | [2098671635201220831](https://x.com/forifori_dev/status/2098671635201220831) | 2026-09-12 16:14:43 JST | ローンチ告知 | npm公開、no-API-key browser call | 動画/文章 | 英語 | Playable demo | `npx oathra demo`を試す | 短縮URL→Release/repo | UTMなし | 公開済み | views 2、likes/replies/reposts 0 | 2026-09-14 23:58 JST | 公開X HTML（公開ページ） |
| oathra | X | @forifori_dev | [2099164321620340968](https://x.com/forifori_dev/status/2099164321620340968) | 2026-09-14 00:52:29 JST | 既存投稿への返信 | 修正版v0.1.1のRelease導線、曖昧返答・終了表示の修正 | 文章/リンクカード | 日本語 | 既存利用者を現行導入へ戻す | 修正版コマンドを実行 | Release短縮URL | UTMなし | 公開済み | views 1、likes/replies/reposts 0 | 2026-09-14 23:58 JST | [公開X HTML](https://x.com/forifori_dev/status/2099164321620340968) |
| oathra | X | @forifori_dev | [2099164351789965643](https://x.com/forifori_dev/status/2099164351789965643) | 2026-09-14 00:52:36 JST | 既存投稿への返信 | npm版との差、Release導入方法、英語デモ | 文章/リンクカード | 英語 | 現行Releaseへ誘導 | 修正版コマンドを実行 | Release短縮URL | UTMなし | 公開済み | views 3、likes/replies/reposts 0 | 2026-09-14 23:58 JST | [公開X HTML](https://x.com/forifori_dev/status/2099164351789965643) |
| oathra | X | @forifori_dev | [2099160731409379808](https://x.com/forifori_dev/status/2099160731409379808) | 未取得（2026-09-14の公開記録） | 動画告知 | v0.1.1の日本語30秒デモ | 動画 | 日本語 | 誤完了防止を視覚化 | 動画視聴・Release確認 | Release短縮URL | UTMなし | 資料記載・現在URL取得不可 | 反応未取得（公開ページ unavailable） | 2026-09-14 23:58 JST | [公開記録](/Users/horioshuuhei/Projects/RingZero/docs/launch/2026-09-14.md) |
| oathra | X | @forifori_dev | [2099160745091166481](https://x.com/forifori_dev/status/2099160745091166481) | 未取得（2026-09-14の公開記録） | 動画告知 | v0.1.1の英語30秒デモ | 動画 | 英語 | Evidence checkerの操作を可視化 | 動画視聴・Release確認 | Release短縮URL | UTMなし | 資料記載・現在URL取得不可 | 反応未取得（公開ページ unavailable） | 2026-09-14 23:58 JST | [公開記録](/Users/horioshuuhei/Projects/RingZero/docs/launch/2026-09-14.md) |
| oathra | Zenn | @forifori | [oathra-launch](https://zenn.dev/forifori/articles/oathra-launch) | 2026-09-12 23:41:41 JST | ローンチ記事 | 「予約できました」を相手の発言で検証する理由とOSS | 記事 | 日本語 | AIの自己申告を完了証拠にしない | 記事を読む→GitHub/デモ | GitHub、Pages | UTMなし | 公開済み | likes 1、comments 0、views未取得 | 2026-09-14 23:58 JST | [Zenn公開HTML](https://zenn.dev/forifori/articles/oathra-launch) |
| oathra | Zenn | @forifori | [oathra-evidence-rules](https://zenn.dev/forifori/articles/oathra-evidence-rules) | 2026-09-14 00:38:04 JST | 技術記事 | 「たぶん大丈夫」を予約成立にしない実装 | 記事 | 日本語 | 決定論的なEvidenceEngine | 記事を読む→checker/repo | GitHub、Pages | UTMなし | 公開済み | likes 0、comments 0、views未取得 | 2026-09-14 23:58 JST | [Zenn公開HTML](https://zenn.dev/forifori/articles/oathra-evidence-rules) |
| oathra | DEV | @forifor | [launch article](https://dev.to/forifor/i-let-an-ai-make-phone-calls-then-took-the-word-booked-away-from-it-5484) | 2026-09-13 00:39:30 JST | ローンチ記事 | 実電話で起きた誤完了から、相手の発話を証拠にする設計へ | 記事 | 英語 | 実例と設計の接続 | repo/demoを試す | repo/Pages | UTMなし | 公開済み | reactions 0、comments 0、views未取得 | 2026-09-14 23:58 JST | [DEV API](https://dev.to/api/articles?username=forifor) |
| oathra | DEV | @forifor | [technical article](https://dev.to/forifor/four-regexes-and-a-staleness-rule-how-my-phone-agent-refuses-to-call-probably-fine-a-booking-3ech) | 2026-09-14 00:38:00 JST | 技術記事 | 4つの正規表現とstalenessで曖昧な予約を拒否 | 記事 | 英語 | 再現可能な判定規則 | repo/SDKを試す | repo/Release | UTMなし | 公開済み | reactions 0、comments 1、views未取得 | 2026-09-14 23:58 JST | [DEV API](https://dev.to/api/articles?username=forifor) |
| oathra | TikTok | @foriforapps | 投稿URL/ID未取得 | 2026-09-13 20:10 JST | 縦型動画 | 「取れていない予約を取れたと言う」問題を59秒で提示 | 動画 | 日本語 | 失敗例を短時間で理解 | プロフィール/サイトを確認 | URL未取得 | UTMなし | 公開済み（Studio読み戻し） | views 0、likes 0、comments 0 | 2026-09-14 16:10 JST | [TikTok運用記録](/Users/horioshuuhei/Projects/RingZero/docs/launch/posts.md) |
| oathra | Reddit | Important-Rip-1205 | [removed post](https://www.reddit.com/r/voiceagents/comments/1wfgy3u/i_separated_reservation_evidence_from_the_voice/) | 2026-09-14 約04:19 JST | コミュニティ投稿 | transcript checker、am/pm bug、制限を説明 | 文章/リンク | 英語 | 技術的な学び付きデモ | postを読む/試す | Pages/repo | UTMなし | 公開失敗（自動フィルター削除） | 外部反応は確認できず | 2026-09-14 23:58 JST | [削除記録](/Users/horioshuuhei/Projects/RingZero/docs/launch/posts.md) |
| oathra | GitHub | FORIFOR | [open issues](https://github.com/FORIFOR/oathra/issues) | 2026-09-12〜 | Issue運用 | 既存のbug修正と、pharmacy/Telnyx/ElevenLabsの協力依頼 | Issue | 日英 | 開発参加と改善余地 | Issue/PRで報告・参加 | repo | UTMなし | 公開済み | open 3、全てFORIFOR作成、外部Issue 0 | 2026-09-14 23:52 JST | [Issue API](https://github.com/FORIFOR/oathra/issues) |
| oathra | X | @forifori_dev | `docs/launch/x-transcript-check.txt` | 未公開 | 投稿下書き | 同意1回、1問/turn、拒否・保留・曖昧・忙しさで停止するv0.1.15 | 文章+動画予定 | 英語 | intakeの実演 | Xで発信後にrepoへ誘導 | `https://github.com/FORIFOR/oathra` | UTMなし | 下書き | 反応なし（公開前） | 2026-09-14 23:52 JST | [draft](/Users/horioshuuhei/Projects/RingZero/docs/launch/x-transcript-check.txt)、[read-only status](/Users/horioshuuhei/Projects/RingZero/scripts/publish-x-intake.mjs) |
| oathra | LiveKit community | アカウント未確認 | アカウント未確認 | 未確認 | 未公開 | show-and-tell用に技術説明を準備 | 下書き | 英語 | LiveKit開発者への適合 | ルール再確認後に投稿予定 | [draft](/Users/horioshuuhei/Projects/RingZero/docs/launch/livekit-show-and-tell-draft.md) | UTMなし | 下書き | 反応なし（公開前） | 2026-09-14 23:58 JST | [LiveKit draft](/Users/horioshuuhei/Projects/RingZero/docs/launch/livekit-show-and-tell-draft.md) |

**発信頻度とテーマ**：公開開始から約3日で、確認できる公開活動はGitHub Release 1、GitHub Discussion更新1、外部配布PR 4、X現存投稿4（ほか資料記載・現在取得不可2）、Zenn 2、DEV 2、TikTok 1、Reddit削除1です。中心テーマは製品紹介・操作デモ・証拠ルール・同意付き追加聞き取り・導入手順で、利用者向けの一般情報より製品説明と実演が多いです。公開後の外部返信・コメント・Issueは確認できず、DiscussionコメントとPRコメントの大半は本人またはbotです。Xの公開ガード、TikTok/Facebookのファイル選択、LiveKit投稿の下書きは運用準備として存在しますが、下書き・失敗・削除を公開済み件数には含めていません。

## 6. 成果の実測値

数値は取得できた範囲だけを記載します。空欄は0ではなく未取得です。GitHub trafficのAPIは直近14日、npmは指定期間のパッケージ全体、SNS数値は媒体ごとの定義です。本人・CI・自動取得を除外できない値は外部成果として扱いません。

| project_id | 対象種別：アカウント／投稿／サイト／リポジトリ／製品 | 対象IDまたはURL | 指標名 | 値 | 単位 | 対象期間の開始と終了 | 数値の取得日時 | データ取得元 | 確認状態 | 補足 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| oathra | リポジトリ | [FORIFOR/oathra](https://github.com/FORIFOR/oathra) | GitHubスター | 0 | star | 累計（2026-09-14時点） | 2026-09-14 23:52 JST | GitHub REST repo API | 確認済み | 0件であることを確認。 |
| oathra | リポジトリ | [FORIFOR/oathra](https://github.com/FORIFOR/oathra) | フォーク | 0 | fork | 累計 | 2026-09-14 23:52 JST | GitHub REST repo API | 確認済み | 0件であることを確認。 |
| oathra | リポジトリ | [FORIFOR/oathra](https://github.com/FORIFOR/oathra) | GitHub表示（14日API集計） | 9 | view | 2026-08-31〜2026-09-13 | 2026-09-14 23:52 JST | `repos/FORIFOR/oathra/traffic/views` | 確認済み | GitHubの14日集計。訪問者のプロジェクト帰属は不明。 |
| oathra | リポジトリ | [FORIFOR/oathra](https://github.com/FORIFOR/oathra) | GitHubユニーク訪問者（14日API集計） | 9 | unique visitor | 2026-08-31〜2026-09-13 | 2026-09-14 23:52 JST | GitHub traffic API | 確認済み | 日別重複除去済みの14日値。誰が見たかは不明。 |
| oathra | リポジトリ | [FORIFOR/oathra](https://github.com/FORIFOR/oathra) | GitHub表示（日別値の合計） | 9 | view | 2026-09-07〜2026-09-13 | 2026-09-14 23:52 JST | GitHub traffic daily buckets | 確認済み（導出） | 7日分の表示合計。APIは7日間ユニークを返さない。 |
| oathra | リポジトリ | [FORIFOR/oathra](https://github.com/FORIFOR/oathra) | GitHubユニーク（日別値の合計） | 9 | daily unique sum | 2026-09-07〜2026-09-13 | 2026-09-14 23:52 JST | GitHub traffic daily buckets | 確認済み（制限付き） | 日をまたぐ重複除去不可。真の7日ユニークではない。 |
| oathra | リポジトリ | [FORIFOR/oathra](https://github.com/FORIFOR/oathra) | GitHub表示 |  | view | 2026-08-15〜2026-09-13 | 2026-09-14 23:52 JST | GitHub traffic API | 取得不可 | API上限が14日で30日値なし。 |
| oathra | リポジトリ | [FORIFOR/oathra](https://github.com/FORIFOR/oathra) | GitHubクローン（14日API集計） | 530 | clone | 2026-08-31〜2026-09-13 | 2026-09-14 23:52 JST | `repos/FORIFOR/oathra/traffic/clones` | 確認済み | 自動処理・本人確認を除外できない。利用者数ではない。 |
| oathra | リポジトリ | [FORIFOR/oathra](https://github.com/FORIFOR/oathra) | GitHubユニーククローン（14日API集計） | 199 | unique cloner | 2026-08-31〜2026-09-13 | 2026-09-14 23:52 JST | GitHub traffic API | 確認済み | 外部利用者数とは断定しない。 |
| oathra | リリース | [v0.1.15](https://github.com/FORIFOR/oathra/releases/tag/v0.1.15) | tarballダウンロード | 3 | download | 累計（公開〜2026-09-14） | 2026-09-14 23:52 JST | GitHub release API | 確認済み | 公開tarball検証を含む可能性があり、外部試用とは断定しない。 |
| oathra | リリース | [v0.1.15](https://github.com/FORIFOR/oathra/releases/tag/v0.1.15) | checksumダウンロード | 2 | download | 累計 | 2026-09-14 23:52 JST | GitHub release API | 確認済み | tarballと同じ制限。 |
| oathra | 製品 | [npm oathra](https://www.npmjs.com/package/oathra) | npmパッケージダウンロード | 140 | download | 2026-09-07〜2026-09-13 | 2026-09-14 23:58 JST | npm downloads point API | 確認済み | パッケージ全体の値。bot/CI/本人を除外できず、Oathra v0.1.15利用者数ではない。 |
| oathra | 製品 | [npm oathra](https://www.npmjs.com/package/oathra) | npmパッケージダウンロード | 140 | download | 2026-08-15〜2026-09-13 | 2026-09-14 23:58 JST | npm downloads point API | 確認済み | 30日範囲でも公開日以降の値しかなく、利用者帰属不可。 |
| oathra | アカウント | [@forifori_dev](https://x.com/forifori_dev) | フォロワー | 1 | follower | 現在残高 | 2026-09-14 23:52 JST | X API v2 read-only | 確認済み | アカウント全体。Oathra由来とは断定しない。 |
| oathra | アカウント | [@forifori_dev](https://x.com/forifori_dev) | 投稿数 | 41 | post | 現在残高 | 2026-09-14 23:52 JST | X API v2 read-only | 確認済み | アカウント全体。プロジェクト件数ではない。 |
| oathra | 投稿 | [X 2098671529647366272](https://x.com/forifori_dev/status/2098671529647366272) | 表示 | 2 | view | 投稿公開〜2026-09-14 | 2026-09-14 23:58 JST | 公開X HTML ViewCountInfo | 確認済み | Xの公開表示値。likes/replies/reposts 0。 |
| oathra | 投稿 | [X 2098671635201220831](https://x.com/forifori_dev/status/2098671635201220831) | 表示 | 2 | view | 投稿公開〜2026-09-14 | 2026-09-14 23:58 JST | 公開X HTML | 確認済み | Xの公開表示値。likes/replies/reposts 0。 |
| oathra | 投稿 | [X 2099164321620340968](https://x.com/forifori_dev/status/2099164321620340968) | 表示 | 1 | view | 投稿公開〜2026-09-14 | 2026-09-14 23:58 JST | 公開X HTML | 確認済み | 既存投稿への返信。likes/replies/reposts 0。 |
| oathra | 投稿 | [X 2099164351789965643](https://x.com/forifori_dev/status/2099164351789965643) | 表示 | 3 | view | 投稿公開〜2026-09-14 | 2026-09-14 23:58 JST | 公開X HTML | 確認済み | 既存投稿への返信。likes/replies/reposts 0。 |
| oathra | アカウント | [Zenn @forifori](https://zenn.dev/forifori) | launch記事いいね | 1 | like | 累計 | 2026-09-14 23:58 JST | Zenn公開HTML | 確認済み | viewsは公開API/HTMLで取得できず。 |
| oathra | アカウント | [Zenn @forifori](https://zenn.dev/forifori) | evidence記事いいね | 0 | like | 累計 | 2026-09-14 23:58 JST | Zenn公開HTML | 確認済み | 0は公開値。viewsは未取得。 |
| oathra | 投稿 | [DEV launch](https://dev.to/forifor/i-let-an-ai-make-phone-calls-then-took-the-word-booked-away-from-it-5484) | positive reactions | 0 | reaction | 累計 | 2026-09-14 23:58 JST | DEV public API | 確認済み | comments 0、viewsは未取得。 |
| oathra | 投稿 | [DEV technical](https://dev.to/forifor/four-regexes-and-a-staleness-rule-how-my-phone-agent-refuses-to-call-probably-fine-a-booking-3ech) | positive reactions | 0 | reaction | 累計 | 2026-09-14 23:58 JST | DEV public API | 確認済み | comments 1、viewsは未取得。 |
| oathra | 投稿 | [DEV technical](https://dev.to/forifor/four-regexes-and-a-staleness-rule-how-my-phone-agent-refuses-to-call-probably-fine-a-booking-3ech) | comments | 1 | comment | 累計 | 2026-09-14 23:58 JST | DEV public API | 確認済み | 外部コメントかどうかは本文の追加確認が必要。 |
| oathra | 投稿 | TikTok @foriforapps（URL/ID未取得） | 再生 | 0 | view | 公開〜2026-09-14 | 2026-09-14 16:10 JST | TikTok Studio資料読み戻し | 資料記載のみ | 59秒Oathraリール。Studioで見た値で、公開URLは未取得。 |
| oathra | 投稿 | TikTok @foriforapps（URL/ID未取得） | いいね / コメント | 0 / 0 | count | 公開〜2026-09-14 | 2026-09-14 16:10 JST | TikTok Studio資料読み戻し | 資料記載のみ | aggregate placeholderをリーチとは解釈していない。 |
| oathra | リポジトリ | [Issues](https://github.com/FORIFOR/oathra/issues) | 外部Issue | 0 | issue | 公開開始〜2026-09-14 | 2026-09-14 23:52 JST | GitHub issues API | 確認済み | open 3件はすべてFORIFOR作成。 |
| oathra | リポジトリ | 外部配布PR 4件 | マージ済みPR | 0 | PR | 公開開始〜2026-09-14 | 2026-09-14 23:58 JST | 各GitHub PR API | 確認済み | 4件すべてOPEN。 |
| oathra | 製品 | [simulator/eval](https://github.com/FORIFOR/oathra/releases/tag/v0.1.15) | adversarial false completion | 0 / 10000 | run / false completion | v0.1.15検証時 | 2026-09-14 23:52 JST | Release notes / CI | 確認済み（内部検証） | シミュレータの結果であり、外部利用・PSTN成功率ではない。 |
| oathra | サイト | [Pages](https://forifor.github.io/oathra/) | 訪問者、セッション、CTAクリック |  | count | 2026-08-15〜2026-09-14 | 2026-09-14 23:58 JST | site event backend | 未確認 | 計測コードはあるが、受信データ・ダッシュボードを取得できない。 |
| oathra | 製品 | [business form](https://forifor.github.io/oathra/#business) | 問い合わせ、商談、契約、売上 |  | count / JPY | 2026-08-15〜2026-09-14 | 2026-09-14 23:58 JST | form backend / CRM | 未確認 | フォーム送信、問い合わせ・商談・課金は今回実施していない。0件とは判定しない。 |
| oathra | 製品 | 実電話プロバイダ | 外部試用人数、継続利用、PSTN成功率 |  | user / rate | 2026-08-15〜2026-09-14 | 2026-09-14 23:58 JST | provider dashboards | 未確認 | 現在のprovider credentials・番号・課金通話・100件試験を確認していない。 |

## 7. 発信から成果までの導線

| 段階 | 存在するか | 利用可能か | 計測されているか | 実測値 | 根拠・制限 |
| --- | --- | --- | --- | --- | --- |
| X / Zenn / DEV / TikTok / GitHubからの発信 | あり | X・Zenn・DEV・GitHubは公開、TikTokはStudio記録 | 媒体ごとの一部反応のみ | X現存4件はviews 1〜3、Zenn likes 1/0、DEV reactions 0/0、TikTok 0/0/0 | 投稿ごとのUTMなし。アカウント共用値をOathraへ合算不可 |
| 発信→Pages・GitHub | あり | リンクHTTP 200 | GitHub referrer 1/1のみ。Pages CTAイベント受信は未確認 | GitHub repo views 9、referrer `github.com` 1/1 | GitHub・Pages間の訪問者単位の紐付けなし |
| Pages→ブラウザチェッカー | あり | HTTP 200、入力はブラウザ内処理 | `demo_start`/`demo_complete`コードあり、受信未確認 |  | 実利用者数・完了率は未取得 |
| Pages/README→Release CLI | あり | v0.1.15 tarballを公開、APIキー不要のdemo | GitHub asset countのみ | 3 tarball / 2 checksum | 自分の検証・botを除外できず、外部試用とは断定不可 |
| README→npm | あり | npm publicだがlatest 0.1.0 | npm downloadsは取得 | 140（9/7〜13） | v0.1.15導線とnpm latestが不一致 |
| Release/CLI→実電話 | あり（手順） | provider credentials・番号・段階テストが必要 | provider dashboard未接続 |  | 本監査では設定・発信・課金テストを実施していない |
| Pages→非公開問い合わせ | あり | フォーム表示、CORS preflight 204 | `leads`受信・CRM連携は未確認 |  | 送信していないため、問い合わせ0件とはしない |
| 試用→継続利用・Issue/PR・Star | 入口あり | 外部試用・継続は未確認 | GitHub star/issue/PRは確認 | Star 0、外部Issue 0、merge 0 | 発信からの因果を示すUTM・ユーザー報告なし |

現状の段階は「公開している／発信しているが、見られ方と利用者属性の接続が不十分」です。「見られているがクリックされていない」「クリック後に利用されていない」を分けるサイト分析値がありません。公開済みでないもの、削除されたもの、下書きは公開成果へ加算していません。

## 8. 未確認事項と取得方法

| 未確認事項 | 現在の理由 | 取得に必要な最小操作（読み取り中心） |
| --- | --- | --- |
| Pagesの訪問者、セッション、CTA、動画完了 | `portfolio.js`はイベントPOSTを持つが、受信データの読み取り口を確認できない | Cloud Runのsite-events管理画面/APIを、権限のある読み取り専用で確認。フォーム送信は不要 |
| X投稿の完全な期間内一覧とアカウント分析 | 公開ページの一部は現在unavailable、APIの利用可能フィールドに制約 | X Analyticsまたは同じアカウントのread-only timeline/exportを確認。投稿・返信は行わない |
| TikTok動画URL、視聴者属性、期間増減 | Studioの読み戻しはあるが、動画IDと分析画面を保存していない | TikTok Studioの既存動画詳細を開き、URL/ID・期間指標を転記 |
| Facebookリールの公開成否 | 投稿試行記録のみで公開一覧に現物がない | ページの既存Reels一覧を読み取り、公開URLまたは失敗状態を確認 |
| Zenn/DEVの閲覧数 | 公開API/HTMLが閲覧数を提供しない | 各サービスの本人ダッシュボードを読み取り。ログイン・編集・投稿は不要 |
| GitHubの30日トラフィックと外部帰属 | GitHub traffic APIの取得上限が14日。クローン・asset downloadは本人/自動処理を除けない | 日次スナップショットを今後保存し、外部利用者はredactedな自己申告またはUTM付き導線で確認 |
| 実電話の現在設定・発信可否・PSTN成功率 | provider資格情報・番号・課金テストを本監査で扱っていない | 利用者が自分のprovider管理画面と `phone doctor --to` の非送信診断結果を共有。100件評価は同意・予算・基準を定義してから実施 |
| 外部試用人数、アクティブユーザー、継続 | OSSの公開値からは個人を特定できず、外部報告がない | Issue/Discussion/問い合わせの報告を、個人情報を除いて記録。自動推定しない |
| 問い合わせ、商談、契約、売上、費用 | フォーム送信・CRM・決済・広告管理画面を確認していない | CRM/受信箱/請求・広告管理画面を読み取り専用で期間指定して確認。今回の監査では送信や課金をしない |
| 外部PRのmerge・掲載 | 4件とも現在OPEN | 各PRの状態とmerge commitを再確認。mergeまでは配布先掲載として数えない |

## 9. 優先して解消すべき問題、最大3件

1. **導入経路のバージョン分裂**：サイト・README・Releaseはv0.1.15、npm `latest`は0.1.0です。初心者が `npx oathra` をそのまま実行すると修正版へ到達しません。公開配布の正規コマンドを一つに揃え、npmを更新できるまでRelease導線を最上位に固定する必要があります。
2. **発信から成果への計測欠落**：サイトイベント、X/Zenn/DEVの閲覧、TikTok/Facebookの動画ID、問い合わせ受信を同じ`project_id`で結べません。UTMまたはサービスの読み取り専用分析を整えない限り、Starや試用の増減理由を判断できません。
3. **外部利用・実電話の証拠不足**：現在確認できる外部Issue・PR merge・試用報告・事業相談はありません。シミュレータの0/10,000は内部検証であり、PSTNの成功率や本番導入可否ではありません。実電話を進める場合は、同意済みの受信者・費用上限・独立した期待結果・停止条件を記録した小規模検証が必要です。
