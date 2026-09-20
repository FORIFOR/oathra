# 雑談・ニュースの受け入れ条件

対象: `f2696fa45439a909a8974f47d679e4bddb63680e` に対する作業ツリー。2026-09-20、macOS / Node 25 / Chrome。実装前に条件を固定。

主要タスク: 電話画面で「雑談」を選び、相手と番号を指定して確認する。相手が希望すれば近況・趣味・日常の会話を続け、ニュースの質問には公開情報を検索して回答する。通常の伝言と権限を混同しない。

| 条件 | 測定環境・期待結果 | 方法・証拠 | 判定 |
| --- | --- | --- | --- |
| 入力 | Chromeで「雑談」を選択、目的を編集可能。下書き・履歴再利用で会話モードを保持。選択取消・入力消去で誤って検索権限を残さない | UIと保存JSONを照合。ui.log / ui-result.json / live-app.json | PASS |
| 会話 | 挨拶だけで終わらず、返答に反応し一度に一問。拒否・終了希望・時間上限で終了。AIを人間と偽らない | 生成指示の契約試験・実Realtime。news.test.ts / live-voice.json | PASS（指示・API経路） |
| 最新情報 | Realtimeの雑談契約だけにニュース検索を提供。公開ニュースのカテゴリだけ送信し、電話番号・氏名・会話全文を検索に送らない。日時・出典付き結果がない場合は未確認とする | 実Responses API + 契約試験。live-news-round2.json / live-voice.json / live-voice-unverified.json | PASS（取得・未確認応答） |
| 復帰・副作用 | 検索の時間制限・回数制限・重複抑止・通話終了時の取消。中断したターンから遅れて発話しない。予約・購入等の権限は増やさない | ローカル通信プロトコル試験。tests.log / independent.md | PASS |
| 保存と費用 | ニュースの取得時刻・出典を履歴の通話詳細に保存表示。検索費は運営者負担と発信前に表示。従来の回線・音声AIのクレジット精算は維持 | Gateway API/UI、既存会計試験。ui.log / gateway-tests.log | PASS |
| 互換性 | conversationMode省略のv1は既存の伝言動作。新フィールドはexperimental。CLI/OSS Web/managedで共通契約 | build/typecheck/関連テスト、導入文書。build.log / typecheck.log / tests.log / legacy-ui.log / oss-ui.log | PASS |

今回、新たな実電話は行わない。前回の実電話を本機能の証拠として流用しない。ニュース検索だけは既存のAPI利用許可の範囲で公開トピックを実照会する。

局所的な試験例外: 外部サービスの中断・重複・失敗を安定して再現するために限定したローカルWS/HTTP応答を使用する。製品・デモには入れず、プロセス終了時に破棄。実サービス検証と区別し、API仕様変更時に更新・不要になれば撤去する。


## 利用方法と契約

画面を再読み込みし、電話画面の「テンプレート（任意）」から「雑談」を選ぶ。目的は編集可能。番号・相手を入力して内容・費用を確認し、発信を明示的に実行する。下書き作成・テンプレート選択だけでは発信もニュース照会も行わない。

- Core: `PhoneRequestSchema` の `conversationMode?: "message" | "chat"`。v1のexperimental拡張。省略は従来の伝言動作。文章から権限を推測しない。`definePhoneRequest` が共通契約を生成し、予約・購入等の権限は増やさない。旧strict parserには新フィールドを渡さず、同revisionのCLI/APIへ更新する。
- Adapter: Realtime専用`lookup_news`はgeneral/japan/world/technology/science/business/sports/entertainmentの公開カテゴリのみ受理。自由文・追加引数は拒否。最大2照会、各15秒、再試行なし。OpenAI Responsesの`web_search`、`gpt-5.4-mini`、reasoning low、出力1500token上限、検索tool最大1回、`store:false`を使用。番号・氏名・会話全文を追加の検索リクエストへ渡さない。通常の音声接続に必要な送信とは区別する。
- 結果: `news.lookup`イベントのresultにstatus/checkedAt/topicと、取得時はpublishedOn/text/sources、未確認時はreasonを返す。status=`verified`は取得結果に日付・引用等が揃った構造上の状態で、第三者による事実認定ではない。直近7日までの日付と具体的なHTTPS引用がない結果は使用しない。要約の正確さは検索プロバイダーにも依存する。自由な個人調査や指定記事の網羅的な検索は対象外。
- UI: サービス版の通話詳細に日時・検索結果・リンクを保存表示。`onNews`をengineに渡せばSDK利用者もイベントを保存できる。CLI/OSS Webは雑談契約・検索に対応するが、専用の出典パネルはGatewayのみ。GPT-Liveでは最新ニュースを確認できないと明示する。
- 費用: サービス版は検索/検索要約APIを運営者が負担。音声として結果を伝える分は従来の音声AI使用量に含む。OSSは自身のAPI従量料金が別途発生。既存の通話上限・クレジット精算・取消を維持。

[OpenAI Web search](https://developers.openai.com/api/docs/guides/tools-web-search)、[GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)、[Realtime response metadata](https://developers.openai.com/api/reference/resources/realtime/client-events#responsecreate)の公式仕様に沿う。

## 実行証拠（2026-09-20 JST）

証拠の相対基準は `artifacts/quality/chat-news/`。環境と最終ファイルhashはenvironment.json/source-sha256.txt。既存の作業ツリーを保存し、commit/pushはしていない。

| コマンド/観測 | exit | 結果と証拠 |
| --- | --- | --- |
| `pnpm build` | 0 | PASS、build.log |
| `pnpm typecheck` | 0 | PASS、typecheck.log |
| `pnpm exec vitest run providers/openai-realtime/src packages/contract/src packages/cli/src/web-phone.test.ts apps/arena/src/phone-service.test.ts` | 0 | 94件PASS、tests.log |
| `pnpm exec vitest run packages/contract/src/phone-templates.test.ts` | 0 | 最終の短い目的文も3件PASS、template-final.log |
| `node --test apps/gateway/test/*.node.mjs` | 0 | 248件PASS、gateway-tests.log |
| `node --env-file=.oathra/managed-preview/.env.managed scripts/ui/chat-news.mjs` | 0 | 雑談選択・編集・取消・下書き・履歴再利用、出典表示/再起動後保存、ログアウト消去、1280/390px・フォーカス・reduced motion・CSS 200%拡大。ui.log/ui-result.json。保存試験は一時DBへ実APIの公開検索結果を投入した局所fixtureで実通話の証拠ではない |
| 同envで `scripts/ui/managed-phone.mjs` | 0 | 既存UIと会計表示の回帰なし、legacy-ui.log |
| 同envで `scripts/ui/web-phone.mjs` | 0 | OSS入力/下書き/復帰、oss-ui.log。出力中の「12」は旧文言で実assertは13テンプレート＋空選択。出力文言も修正済み |
| 公開カテゴリを実Responses APIへ照会 | 0 | gpt-5.4-miniで記事の日付と出典を取得、7.1秒。live-news-round2.json。前段の4.1系の日付なし/カテゴリトップの回答は不採用。round1-rejected-news.json / live-news-provider.json |
| 同envで `artifacts/quality/chat-news/live-voice.mjs --live-api` | 0 | 実Realtime 1.5 → 実検索 → 日付・出典を発話 → 雑談の質問。音声143600bytes、エラー0、検索応答metadata echoを確認、電話発信0。live-voice.log/json（目的文の短縮前、実行層と音声システム指示は最終版と同一） |
| その前の国内ニュース照会 | 1 | 取得成功を要求するassertが失敗。実際には日付等の要件を満たさずunverified、音声AIは「確認できませんでした」と応答し会話に戻った。live-voice-unverified.log/json。未確認時の復帰証拠として記録し、取得成功には数えない |
| 稼働Gatewayを通話なし確認後に再起動、公開URLのChromeを確認 | 0 | 雑談・ニュース説明を表示、過去4件維持・追加通話0、live-app.json/png |

改善ラウンドは3回。1: テンプレート・明示契約・検索・保存経路。2: 実APIの報道日/記事出典不足を検出し、日付/URL検査とニュースモデル選択を修正。3: 独立検証が見つけた応答二重開始と中断後の遅着音声を、作成待ち状態とmetadataの世代照合で修正。最後に編集欄の目的文を短縮した（実行ルールは共通システム指示で保持）。

独立検証は [independent.md](../../artifacts/quality/chat-news/independent.md)。外部APIとUIは主担当、プロトコル競合・権限・会計は独立担当が検証。AIによるコードレビューを実ユーザー評価と呼ばない。

| 残る条件 | 判定 | 理由 |
| --- | --- | --- |
| 人間同士の電話における自然さ・聞き取り・実際の終了希望の評価 | BLOCKED | 今回は実電話を追加していない。実APIへの公開テキスト質問を自然さの人間評価で代用しない |
| 日本語IMEの実入力・OSの実ブラウザー200%ズーム・読み上げ機器 | BLOCKED | 今回はChrome CDPの文字入力/CSS拡大/フォーカスのみ。未実施をPASSにしない |
| ネイティブアプリOS試験 | NOT_APPLICABLE | 対象はWeb画面とNodeの音声Adapter |

現在の通話上限は従来の60秒。今回の改修は上限変更や再発信を行わない。アカウントは前回通話の400クレジットが精算待ちで、今回の機能確認では付与・消費・解放を操作していない。

後続変更: `usage-rate-v1` 有効時の検索費用は利用者の使用量精算へ変更しました。上記は当時の検証記録で、新しい契約・結果は [終了時精算](usage-cost.md) を参照してください。
