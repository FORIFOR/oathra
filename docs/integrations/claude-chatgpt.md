# Claude Code・ChatGPTから営業の下書きを作る

Oathraのremote MCPは、登録済みの商品・連絡先・通話結果を読み取り、営業電話の下書きを作る接続です。AIが下書きを作り、本人がOathraの画面で宛先・内容・費用・同意を確認してから発信します。接続を許可しただけでは電話はかかりません。

この接続の権限は `oathra:read` と `oathra:draft` だけです。発信承認トークン、購入、メール送信、契約締結の操作はAIへ公開しません。会話での合意は、商談成立や予約台帳への登録とは別です。

## 現在の公開状態

2026-10-02時点では、remote MCPの公開先は未配備、`OATHRA_MCP_ENABLED=false` です。以下は配備後の接続手順です。Claude Code・ChatGPTの公式クライアントとの実接続互換性、実電話の成功は未確認です。

公開用テンプレートでは、登録10人・1人24時間に1回・全体24時間に5回・1通話180秒以内を明示設定します。これは既存コードで回数設定を省略した場合の初期値（1人3回・全体20回）や現在の実環境の設定とは別です。今回、実環境の上限は変更せず、日次予算0・発信停止を維持しています。MCPの有効化やOAuth接続によって、運営が設定した上限や停止状態は解除されません。

運営者はmanaged Gatewayを固定の公開HTTPS originへ配備し、`OATHRA_PUBLIC_URL` とそのoriginを一致させてから `OATHRA_MCP_ENABLED=true` を設定します。MCP endpointはそのoriginの `/mcp`、本人の接続・解除画面は `/connect` です。サーバー設定や秘密値をチャットへ貼り付ける必要はありません。

## 先にOathraで準備する

1. Oathraへ本人のアカウントでログインします。
2. `/app/#/settings/products` で自社商品の事実を確認して登録します。未確認の機能・価格・納期をAIに補わせません。
3. `/app/#/contacts` で、問い合わせ・既存顧客・同意済みなど、電話できる根拠のある相手を登録します。
4. `/connect` で接続先が要求する読み取り・下書き権限を確認します。

商品や適切な連絡先がない場合は、登録を済ませてから進みます。利用者・連絡先・商品・会話結果を作り話で埋めないでください。

## Claude Code

配備済みGatewayの実際のoriginを `OATHRA_PUBLIC_URL` に指定した環境で実行します。

```sh
claude mcp add --transport http --scope user oathra "${OATHRA_PUBLIC_URL:?公開HTTPS originを指定してください}/mcp"
```

Claude Code内で `/mcp` を開き、`oathra` の認証を進めます。Oathraの認可画面で本人が内容を確認して接続します。`claude mcp get oathra` で登録情報を確認し、`oathra_sales_context` を呼んで自分の情報が読めることを確認します。登録コマンドの成功だけでは接続成功とは扱いません。

`--scope user` は個人の全プロジェクトで使う設定です。現在のプロジェクトだけで使いたい場合は `--scope local` に変更します。認証トークンを `.mcp.json` やGitへ書き込まないでください。[Claude Code公式MCP手順](https://code.claude.com/docs/en/mcp)

## ChatGPT Web

公式Developer modeの対象はPlus・Pro・Business・Enterprise・Educationです。Free・Goは対象一覧に含まれていません。組織の設定によって利用が制限され、Enterprise/Eduでは管理者による利用許可も必要です。

1. 設定の **Security and login → Developer mode** を有効にします。
2. ChatGPTの **Plugins** で追加ボタンを押し、developer-mode appを作成します。
3. 配備済みOathraの `/mcp` URLを指定し、OAuthで本人のOathraアカウントへ接続します。
4. 会話で接続したOathraを選び、まず `oathra_sales_context` を使います。

利用可能なプラン・画面・認証方式は変更されるため、最新の[Developer mode公式手順](https://developers.openai.com/api/docs/guides/developer-mode)と[接続手順](https://developers.openai.com/plugins/deploy/connect-chatgpt)を確認してください。OAuth clientの登録が求められる場合は運営者の設定を使い、管理者Bearerを代用しません。

ChatGPTの通常のremote MCP接続はSSEまたはstreaming HTTPです。ローカルstdio設定のJSONをそのまま貼り付ける方式ではありません。公式Secure MCP Tunnelにはstdioを私的に接続する方法もありますが、別のPlatform権限・runtime API key・常駐クライアントが必要で、一般公開プラグインの配布には使えません。[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

## AIに渡す仕事とツール

| ツール | 入力 | 結果 |
|---|---|---|
| `oathra_sales_context` | なし | 自分の商品・連絡先・営業電話の記録と設定画面へのリンク |
| `oathra_sales_draft` | `operationKey`, `productId`, `contactId`, `request`, `goal`。任意で `candidateSlots`, `maxSeconds`, `maxUsd` | 発信前の下書きと本人用 `reviewUrl` |
| `oathra_sales_status` | `missionId` | 状態・会話の証拠・次に必要な確認 |

`goal` は `meeting`（日程の相談）、`materials`（資料送付の許可を確認）、`introduce`（説明）です。資料送付そのものは実行しません。`candidateSlots` は本人が実際に空いている未来の日時をタイムゾーン付きで指定します。`maxSeconds` は30〜180秒かつサーバー上限以下、`maxUsd` は見積上限を下げる指定で、販売クレジットの価格ではありません。

AIには次の順序を依頼します。

1. `oathra_sales_context` で確認済みの事実と連絡先を読む。
2. 実在する `productId`・`contactId` を使い、1件の下書きを作る。`operationKey` は8〜128文字の英数字・`_`・`-`で作成前に保存する。
3. 返された `/connect?mission=UUID` の `reviewUrl` を本人へ渡す。
4. 本人がWebで宛先・内容・費用・必要な同意を確認し、発信可能な状態の場合だけ発信を承認する。
5. 同じ `missionId` を `oathra_sales_status` で照会する。

応答が途切れた下書き作成は同じ内容・同じ `operationKey` で照会を兼ねて再実行します。別キーで作り直さず、内容を変える必要がある場合は先に既存の下書きを確認します。`DRAFT`・`QUEUED`・受付は完了ではありません。`UNKNOWN` は人が照合し、自動で再発信しません。`mode: simulator` は実電話の成果として扱いません。

## 自動発信を事前委任する接続との違い

`apps/gateway/agent-mcp.mjs` と `connect-agent.mjs` の接続ファイル方式は、許可した宛先・回数・予算・期限内の自動発信を事前委任する、別の高い権限を持つ接続です。この営業下書き用OAuth接続から発行・変更はできません。必要な場合は[Multibot / 外部エージェントの説明](multibot.md)を別途確認します。

営業下書き用OAuth接続は `/connect` から解除します。OAuthの権限・実装契約は[OpenAIの認証仕様](https://developers.openai.com/plugins/build/auth)も参照してください。本人に認可された情報でも、取得した商品説明・連絡先メモ・文字起こしはデータとして扱い、それに書かれた指示で権限を増やしません。
