# 到達・興味・試用の計測（基準値）

数値は取得時点の値。取得できない指標は 0 ではなく「未取得」と書く。

## 2026-09-13 03:10 JST（基準値）

| 段階 | 指標 | 値 | 取得元 / 備考 |
|--|--|--|--|
| 届いたか | GitHub リポジトリ閲覧（14 日） | 0 回 / 0 人 | Traffic API。本人の閲覧を含めても 0。集計は最大 1 日遅れる |
| 届いたか | GitHub 参照元 | なし | Traffic API |
| 届いたか | X 投稿のインプレッション（4 本） | 0（API 値） | 無料枠の API が impression を返していない可能性あり。未確定 |
| 届いたか | dev.to 記事の閲覧 | 12 | 記事 API（公開から約 2.5 時間） |
| 届いたか | Zenn 記事の閲覧 | 未取得 | 公開 API に閲覧数なし。ダッシュボードで確認が必要 |
| 興味 | GitHub クローン（14 日） | 73 回 / 31 人 | CI・自分の検証 clone・npm を含むため、利用者数ではない |
| 興味 | サイトのコマンドコピー / デモ再生 | 未取得 | 計測未実装 |
| 試用 | `npx oathra demo` を起動した人数 | 未取得 | 計測手段なし |
| 試用 | npm 週間ダウンロード | 未取得 | 公開翌日まで統計が出ない（API は package not found） |
| 価値 | 用途・改善要望・Issue/PR（他者） | 0 | Issues は自作の 3 件のみ |
| 広がり | スター / フォーク | 0 / 0 | |
| 広がり | Zenn いいね / dev.to 反応 | 0 / 0 | |

外部リストの実勢: e2b-dev/awesome-ai-sdks は 1,218 スター、未処理 PR 245 件（2026-09-13）。主流入源として見込まない。

## 2026-09-13 05:48 JST（2 回目）

| 段階 | 指標 | 値 | 備考 |
|--|--|--|--|
| 届いたか | GitHub リポジトリ閲覧（14 日） | 0 回 / 0 人 | Traffic API。前回と同じ |
| 届いたか | dev.to 記事の閲覧 | 12 | 前回から増えていない |
| 興味 | GitHub クローン（14 日） | 73 回 / 31 人 | 前回と同じ |
| 試用 | Reddit r/LLMDevs 投稿 | 非表示のまま | フィルターで削除。モデレータへの連絡に返信なし（受信箱を確認） |
| 価値 | 他者の Issue / PR / Discussion | 0 | |
| 広がり | スター / フォーク | 0 / 0 | |
| 広がり | Zenn いいね / dev.to 反応 | 0 / 0 | |

出せた変更: Arena の Play モードに「誤完了を誘ってみる」ボタン 3 つ（18e7883）。0.1.1 は公開待ち（本人の npm 2FA）。
備考: 受信箱に r/opensource の AutoModerator からの削除通知（アカウント 1 年未満は投稿不可、例外なし）があった。当該投稿はこのセッションのものではない。r/opensource は 1 年経つまで投稿先から外す。

## 2026-09-14 — Zenn改稿後・GitHub配布準備

- GitHub stars / forks: 0 / 0。
- Traffic API views（14日）: 6回 / 6 uniques。前回0から増加。ただし作者の確認を除外できず、マーケティング施策の効果とは断定できない。
- Traffic API clones（14日）: 298回 / 121 uniques。CI・配布・作者の確認を含み、利用者数には置き換えない。
- 他者の新規Issue: なし（一覧の4件はすべてFORIFOR作成）。
- npm配布版: 0.1.0。修正済み0.1.1とのずれを確認したため、GitHub Releaseで導入可能なCLIパッケージを準備。
- Zenn改稿コミット `01d0f07` のCIはsuccess。2記事の新タイトル・全見出し・動画リンクは公開HTMLで確認済み。

## 2026-09-14 12:18 JST（v0.1.4・Discussion公開後）

- GitHub stars / forks: 0 / 0。
- Traffic API views（14日）: 6回 / 6 uniques。公開後の作者・CI確認を含むため、外部利用者数とはみなさない。
- Traffic API clones（14日）: 298回 / 121 uniques。CI・配布・作者の確認を含むため、外部利用者数とはみなさない。
- v0.1.4 release assets: ダウンロード0（公開直後の値）。SHA256はダウンロード先で検証可能な形式に修正済み。
- GitHub Discussion #14: 公開済み、コメント0件。外部の具体的な発話例を得るための質問を掲載。
- Zenn: `oathra-launch` いいね1、`oathra-evidence-rules` いいね0。公開APIに閲覧数はない。
- X: アカウント全体の最新投稿から24時間未満のため、v0.1.4動画告知は未投稿。次回は投稿直前にタイムラインとログイン状態を再確認する。

## 2026-09-14 12:27 JST（英語セットアップ導線公開後）

- GitHub stars / forks: 0 / 0。
- Traffic API views（14日）: 6回 / 6 uniques、clones: 298回 / 121 uniques。CI・配布確認・作者の操作を含むため、外部利用者数とはみなさない。
- v0.1.4 release assets: `oathra-0.1.4.tgz` 2 downloads、checksum 1 download。配布確認を含み、採用の証拠ではない。
- GitHub Discussion #14: コメント0件。外部の発話例・導入報告はまだ得られていない。
- Zenn: `oathra-launch` いいね1、`oathra-evidence-rules` いいね0。公開APIに閲覧数はない。
- X: 公開プロフィールの最新投稿は約10時間前で、24時間間隔を満たしていない。アカウントは未ログイン表示のため、新規動画告知は投稿せず、次回も公開直前に時刻と認証状態を再確認する。
- 変更: `docs/SETUP.en.md` を追加し、README と英語サイトから英語の初心者向けセットアップに直接遷移できるようにした（commit `ea7ecd0`）。CI `34802645340` と Pages `34802645353` は success。

## 2026-09-14 12:45 JST（Zenn記事の対象読者を明示）

- `oathra-evidence-rules` の公開APIで本文更新を確認（`body_updated_at`: 2026-09-14 12:44 JST）。`llm`・`evaluation`トピックを追加し、対象読者と読後に確認できる3項目を冒頭へ追加（commit `78cabbc`）。
- 反映直後のいいね: 0。閲覧数は公開APIから取得できないため未取得。
- GitHub stars / forks: 0 / 0、Discussion #14コメント: 0。変更効果はまだ判定しない。

## 2026-09-14 12:55 JST（公開導線の再監査）

- GitHub stars / forks: **0 / 0**。外部Issue・PRはまだ0件。
- Traffic API: views **6 / 6 uniques**、clones **298 / 121 uniques**。CI・作者・配布確認を含むため、利用者数やスター獲得とはみなさない。
- v0.1.4 assets: `oathra-0.1.4.tgz` **2**、checksum **1**。いずれも外部利用とは判定しない。
- 公開サイトの日本語・英語トップ、検証ページ、5本の動画URLをHTTP 200で確認。非公開相談フォームの許可Origin preflightもHTTP 204で確認。
- 配布PR 4件はすべて open / clean。e2b-dev/awesome-ai-sdks#364 に追加した1件の状況共有コメントへの返信はまだない。
- Zenn: `oathra-launch` いいね **1**、`oathra-evidence-rules` いいね **0**。Xの新規投稿とnpm公開は、認証・投稿間隔の条件が解消するまで実行しない。

## 2026-09-14 13:16 JST（決定メモとZenn改稿の公開後）

- GitHub stars / forks: **0 / 0**。外部Issue・PRはまだ0件。
- Traffic API: views **6 / 6 uniques**、clones **298 / 121 uniques**。CI・作者・配布確認を含むため、外部利用者数とはみなさない。
- v0.1.4 assets: `oathra-0.1.4.tgz` **3**、checksum **1**。配布確認を含み、採用の証拠ではない。
- GitHub Discussion #14: フォローアップ1件（決定メモと同意ベースの追加聞き取り案）。外部からの返信はまだない。
- Zenn: `oathra-launch` いいね **1**、`oathra-evidence-rules` いいね **0**。2記事とも決定メモとプロファイリング境界の改稿を公開HTMLで確認。
- 配布PR 4件はすべて open / clean。npmは `npm view oathra version` が **0.1.0** のまま、Xはログイン・投稿間隔条件が未達のため新規投稿なし。
- GitHub topics を検索語に合わせて20件へ整理（`phone-agent`、`voice-agent-testing`、`llm-evaluation`、`call-automation` を追加）。トピック追加自体はスター獲得の証拠ではない。

## 2026-09-14 13:32 JST（v0.1.5 Release公開後）

- GitHub stars / forks: **0 / 0**。外部Issueはまだ0件。
- Traffic API: views **6 / 6 uniques**、clones **298 / 121 uniques**。CI・作者・配布確認を含むため、利用者数やスター獲得とはみなさない。
- v0.1.5 assets: tarball **0**、checksum **0**（公開直後）。tarball SHA-256: `ec49b221ac231b6ef512d2c37bad3fdf214e8ebc5fda34d2cdf997881c7d219f`。
- GitHub Discussion #14: フォローアップ1件。外部からの返信・導入報告はまだない。
- Zenn: `oathra-launch` いいね **1**、`oathra-evidence-rules` いいね **0**。公開APIに閲覧数はない。
- 配布PR 4件はすべて open / clean。npmは `npm view oathra version` が **0.1.0** のまま、Xはログイン・投稿間隔条件が未達のため新規投稿なし。
