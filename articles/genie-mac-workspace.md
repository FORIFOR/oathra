---
title: '依頼から成果物の保存までつなぐMacアプリ「Genie」を作った。LLMを組み込んで直した3つのこと'
emoji: '🧞'
type: 'tech'
topics: ['個人開発', 'ai', 'swiftui', 'llm', 'macos']
published: false
---

メモから行動計画を作る。Webサイトの見出しを考え直す。小さなHTMLを試作する。

こうした依頼をMac上で受け付け、**結果を確認し、後から開き直し、Markdownとして持ち出せる**ワークスペース「Genie」を開発しています。モデルはOllama、対応API、Codex／Claude Codeから選べます。

この記事では、実際に生成・保存したものと、実装中に直した「結果の管理」「ローカルLLMの出力形式」「意図しない追加呼び出し」を紹介します。同じようにLLMをアプリへ組み込む方の参考になればうれしいです。

https://github.com/FORIFOR/genie

:::message
2026年9月14日時点の開発者向けプレビューです。macOS 14以降に対応し、ローカルサービスとモデルの準備が必要です。DMGだけで使えるホスト型サービスではありません。旧名称はAstraで、以下の実演には旧名が残っています。
:::

## まず、実際に作れたもの

ひとつ目は、スケッチを手がかりにした、ブラウザで操作できる小さな宇宙のHTMLです。

@[youtube](xOQnOKG_Ndg)

[33秒の実演をYouTubeで見る](https://www.youtube.com/shorts/xOQnOKG_Ndg)（埋め込みが表示されない場合はこちら）

**33秒の動画ですが、生成時間は約180秒です。** 実際のMacアプリの操作を収録し、待ち時間を短縮しています。入力した画像と依頼は、接続したCodex CLIを通じて外部モデルへ送信しました。

この実演で行ったのは、次の一連の操作です。

1. Genieで依頼し、HTMLを含む結果を受け取る。
2. アプリの保存操作でMarkdown文書を保存する。
3. 保存した文書からHTML部分を取り出し、外部ブラウザで開く。

生成後のHTML／JavaScriptは手修正していません。一時停止、速度変更、惑星の説明表示を確認しました。縮尺や軌道は演出です。

[生成したHTMLを操作する](https://genie-forifor.forifor.chatgpt.site/orbit.html) · [生成・編集・検証の記録](https://github.com/FORIFOR/genie/blob/v0.1.4/docs/launch/2026-09-12/v3/PROVENANCE.md)

ここで示せたのは、**依頼から、確認して使えるファイルに到達すること**です。アプリ内でのHTML自動プレビューや、Webサイトの自動公開までを示す実演ではありません。

### ローカルモデルでは、Webサイトの文章を改善した

もうひとつは、架空のWeb制作会社のページから見出しとボタンの案を作る実演です。Ollamaの`qwen3.5:9b`を使いました。

| 項目                 | 実際の内容                               |
| -------------------- | ---------------------------------------- |
| 元の見出し           | ともに、未来へ。                         |
| 生成した見出し       | 中小企業向けコーポレートサイト制作・改善 |
| 生成したボタン       | 詳細を見る                               |
| 採用した回の生成待ち | 約23.7秒                                 |

最初の候補は、画面にない「無料相談」を作ってしまい、不採用にしました。依頼に「画面にない価格・無料・実績・保証は追加しない」と条件を書き、もう一度実行しています。この検証はローカル生成2回、外部モデルへのリクエスト0回です。

採用した見出しは指定どおり20字に収まりました。ただし、実際のサイトで問い合わせが増えるかは未検証です。条件に合う案を保存できたことと、ビジネスで効果が出ることは、別々に確認する必要があります。

[実際の保存文書](https://github.com/FORIFOR/genie/blob/v0.1.4/docs/launch/2026-09-12/v2/PROPOSAL.md) · [モデル・時間・不採用理由の記録](https://github.com/FORIFOR/genie/blob/v0.1.4/docs/launch/2026-09-12/v2/provenance.json)

スクリーンショットは、これらの依頼に資料を添えるために使いました。普段のメモ整理や文章作成は、Homeに文章を入力するところから始められます。

## 1. 依頼と結果を、同じ仕事として保存する

Genieの中心となる画面は、依頼を書くHomeと、仕事を開き直すWorkです。画面を移動しても、元の依頼と結果の対応が残るようにしました。

構成を簡略化すると、次のようになります。

```text
Macアプリ（依頼・Work・保存）
  → Gateway
  → Task Worker（Temporal）
  → Agent Host
  → 選択したモデル

結果を取得 → 依頼と一緒に保存 → Workで再表示・書き出し
```

Mac側の`TaskRequestRecord`は、依頼文、バックエンドのタスクID、成果物ID、状態、結果を保持します。空の応答や確認質問を「成果物ができました」と表示しないため、完了状態と本文の両方を判定しています。

```swift
var hasResult: Bool {
    phase == .complete &&
    !result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}
```

状態は`working`だけでなく、`needsInput`、`failed`、`unknown`などを分けました。特に、通信が切れて結果を確認できない状態で、新しい依頼を作り直さないことが大切です。

「状況を確認」は保存済みの`backendTaskID`を問い合わせます。Workで開く、コピーする、Markdown保存する操作も、保存された結果を読みます。

[TaskRequestRecordの実装](https://github.com/FORIFOR/genie/blob/v0.1.4/apps/genie-macos/Sources/GenieMac/Core/TaskRequestRecord.swift) · [既存タスクを問い合わせる処理](https://github.com/FORIFOR/genie/blob/v0.1.4/apps/genie-macos/Sources/GenieMac/VoiceHUD/VoiceHUDState.swift#L318)

保存の検証では、実際のローカルモデルが返した1,977文字の結果を別プロセスから開き直し、ネイティブの保存ダイアログから書き出した文書の一致を確認しました。これは保存経路の検証であり、回答品質の点数ではありません。

## 2. 自由な文章を、小型モデルにJSONで包ませすぎない

ローカルLLMでは、文章作成までJSON形式を強制すると、不正なJSONや短い断片が返る問題に当たりました。

そこで、HTTP経由の一般回答・文章作成はプレーンテキストを生成し、アプリケーション側で`answer`や`text`のフィールドに包むようにしました。コードを短くすると、次の形です。

```ts
const field = tool === 'llm.answer' ? 'answer' : 'text';
const text = await http.askText(prompt, creative, images);
return { [field]: text };
```

これは[実装の要点を抜き出した例](https://github.com/FORIFOR/genie/blob/v0.1.4/workers/agent-host/src/llm-steps.ts#L559)です。構造が必要な操作には、引き続き構造化された出力を使っています。

出力の形式をアプリ側で扱うことで、文章を取り出す経路は安定しました。ただし、内容の根拠や文字数制限への適合は、引き続き確認が必要です。形式の正常性だけで、仕事の完了品質まで保証することはできません。

## 3. 再表示と再生成を分け、モデルの選択を守る

履歴を開くたびに生成し直したり、ローカルモデルの失敗時に有料APIへ切り替えたりすると、利用者が想定しない課金や外部送信につながります。

Genieでは、明示的に選んだモデル経路を守り、保存済みの結果の再表示・コピー・書き出しではモデルを呼びません。ローカル指定時に有料プロバイダーへ切り替わらないことも、テストで確認しています。

| 経路               | 準備とデータの行き先                                               |
| ------------------ | ------------------------------------------------------------------ |
| Ollama             | Macにモデルを用意する。ローカルエンドポイントで処理する            |
| 対応API            | 接続先と自分の認証情報を設定する。送信内容は外部プロバイダーへ渡る |
| Codex／Claude Code | 設定済みCLIを使う。各サービスの利用条件・上限に従う                |

ライブ文字起こしなどは別の機能・接続経路です。「Ollamaを選べばGenieの全機能が外部通信なしになる」という意味ではありません。

[保存と実行の検証記録](https://github.com/FORIFOR/genie/blob/v0.1.4/docs/evidence/outcome-workspace/RESULTS.md) · [モデル選択のテスト](https://github.com/FORIFOR/genie/blob/v0.1.4/workers/agent-host/test/llm-steps.test.ts)

## 手元で試すなら、最初は文章の仕事をひとつ

現在配布しているのは**v0.1.4のMacプレビュー**です。Apple Silicon／Intelに対応し、Developer ID署名・Appleの公証を行っています。

[v0.1.4のDMG・リリース情報](https://github.com/FORIFOR/genie/releases/tag/v0.1.4)

アプリとバックエンドのバージョンを揃えるため、対応するソースを用意します。

```sh
git clone --branch v0.1.4 --depth 1 https://github.com/FORIFOR/genie.git genie-preview
cd genie-preview
```

この後は、[同じバージョンのセットアップ手順](https://github.com/FORIFOR/genie/blob/v0.1.4/docs/LOCAL_PREVIEW.md)の`pnpm install`から進めてください。Node 22以降、pnpm 10.12.2、Docker Compose、`dbmate`、`psql`、Xcodeコマンドラインツールが必要です。Gateway、Task Worker、Agent Hostを起動し続ける必要があり、モデルのダウンロードとメモリも別途必要になります。

最初の依頼には、次のような文章を使えます。

```text
アプリを試す、デモを撮る、公開文を書く。
このメモから担当者と次の行動が分かるチェックリストを作って。
未定の担当者は未定と書いて。
```

Google／Microsoftへの接続やマイクの許可は、この文章テストには不要です。

- Homeから依頼できるか。
- 3つの仕事が整理され、担当者を勝手に作っていないか。
- 別画面へ移動した後、Workから同じ結果を開けるか。
- Markdownを保存し、次の作業で使えるか。

セットアップ後のテストは10分程度を想定しています。環境構築の時間は含みません。

## 現在できている範囲と、次に改善したいこと

今回紹介したのは、文章・HTMLなどの結果を作り、保存して再利用する流れです。動画の自動制作からSNS投稿まで、旅行の予約完了まで、といった広い自動化が完成したという紹介ではありません。

まず改善したいのは、ローカルサービスを含むセットアップの重さと、モデルごとに変わる回答品質です。v0.1.4の検証結果は[リリース情報](https://github.com/FORIFOR/genie/releases/tag/v0.1.4)に記載しています。開発用アプリの権限に依存してスキップした検証もあり、製品全体の本番リリース判定とは分けています。

また、ソースはGitHubに公開していますが、現時点でプロジェクト全体のオープンソースライセンスは未設定です。

**試していただけるなら、「やりたかった仕事」と「最初につまずいた場所」を教えてください。** 起動できなかった報告も、結果が期待に届かなかった報告も歓迎します。

[日本語のテスト案内・報告フォーム](https://github.com/FORIFOR/genie/blob/main/docs/TESTING.ja.md)

Issueは公開されます。架空の例で構いませんので、認証情報や実際の顧客情報は含めないでください。まずひとつの仕事を、使える結果として持ち出せるかを確かめてもらえればと思います。
