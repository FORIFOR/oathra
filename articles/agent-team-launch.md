---
title: "Bot 同士を会話させるのではなく、仕事の経緯がそのままチャットになるマルチエージェントを OSS で作った"
emoji: "🧾"
type: "tech"
topics: ["ai", "python", "claudecode", "agents", "oss"]
published: true
---

「AI チームが協働する」デモの多くは、Bot 同士がチャットで盛り上がる様子を見せます。ログが主役で、成果物は添え物です。私が欲しかったのは逆でした。**一文の依頼を入れたら実ファイルが返ってきて、それがどう作られ、何を引き継ぎ、どの検証を通ったのかを後から辿れる**ものです。

それで作ったのが Agent Team です。オープンソース（MIT）、ローカルファースト。

https://github.com/FORIFOR/Multibot

サイトと 58 秒の紹介動画: https://forifor.github.io/Multibot/ja/

## 何が違うのか

- **台本の会話がない。** チャット画面は `message.sent` イベントの投影です。他の Bot の受信箱に実際に配送されたメッセージだけが並びます。Builder の質問で Researcher が起動して回答し、`reply_to` で紐付きます。相槌ではモデルを起動しません。
- **検証は revision に紐付く。** 検証結果とレビュー判定は、成果物の SHA-256 revision に紐付いたイベントです。最終報告はイベントログから組み立てるので、モデルの要約が「開始」を「合格」に書き換えることはできません。
- **制限は Runtime が強制する。** ツール権限、書込範囲、予算（実使用 + 実行中呼出の予約）、承認（hash + nonce）、停止 / 再開 / 分岐。プロンプトの文言ではなくコードで止めます。価格不明のモデルは開始できません。
- **Bot ごとに設定できる。** 共通の接続先とモデルを継承し、必要な Bot だけ接続先・モデル・effort・システムプロンプト（手動固定可）を上書き。設定したモデルと、プロバイダが実際に応答したモデルを両方表示します。無断フォールバックはしません。
- **再生はモデルを呼ばない。** チェックポイントから 1 つの Bot だけモデルを変えて分岐し、比較できます。run 全体を JSONL で書き出せます。

## Claude Code があれば API キー不要

既定の接続は、各 Bot のセッションをローカルの `claude -p` で動かします。1 セッションのループは Claude Code が回し、チームのツール（`send_message` / `publish_artifact` / `run_check` など）は小さな stdio MCP プロキシ経由で Runtime の ToolGateway に転送されます。権限・予算・イベントログは API 経路と同一で、Claude Code の組み込みツールはこのセッションでは無効です。コストと使用量は CLI の JSON 結果から、実際に使われたモデルは `modelUsage` から読みます（モデルの自己申告は使いません）。

Claude API（公式 SDK）、OpenAI 互換エンドポイント、ローカルの Ollama も Bot ごとに選べます。

## 実 run（無編集）

2026-09-13 に、次の依頼をローカルの Claude Code CLI で実行しました。「この製品説明をもとに、日本語の紹介 LP と SNS 投稿草案 3 案を作って。不足情報は前提として記録し、公開はせず草案まで。Reviewer に実検証させて。」

| | |
| --- | --- |
| モデル（プロバイダ報告） | `claude-opus-5` |
| 計画 | Master が Builder 1 + Reviewer 1 を選択、Researcher は不要と判断。前提 8 件（価格・実績数値を書かない、URL はプレースホルダ） |
| 成果物 | `index.html`（単一ファイル LP）、`posts.md`、`HANDOFF.md`、`final-report.md` |
| 検証 | プログラム検証 10 件すべて pass、Reviewer 判定 6/6、任意所見 4 件を実メッセージで返送 |
| 利用量 | 39 ターン、35 ツール呼出、$1.66（定価換算）、18 分 37 秒 |
| 状態 | completed |

生成物・最終報告・77 件のイベントログは `docs/evidence/` に無編集で置いています。4 回試行して、run 1 は `partial`（Reviewer が 2 タスクを検証すると最後の判定しか反映されないバグ → 修正）、run 2–3 は上限に当たって調整、run 4 で完走です。1 つの依頼はベンチマークではなく、プロンプトも初期版のままです。

サイトのデモ動画は、実 UI と実 Runtime を **テスト用のスクリプト provider**（画面に表示）で動かしたもので、決定論的に再現できます。

## 仕組み

1. **一文の依頼 → 検査済みの計画。** Master が成果物・前提・task DAG を構造化出力で提案し、Runtime が schema・循環・owner・tool・書込範囲・上限を検査してから動かします。
2. **独立した Bot、実配送。** 各 Bot は自分の会話状態・受信箱・task 範囲・ツール・作業領域を持ちます。Worker に渡すのは担当 task、入力成果物の参照、自分宛ての受信箱だけで、全履歴ではありません。
3. **検証 → 修正 → 証拠から報告。** Reviewer は特定 revision に対して検証を実行。不合格なら Builder が修正して再検証（回数上限あり）。最終報告はイベントログから組み立てます。

構成: Python 3.12 / FastAPI / SQLite（WAL、append-only イベント、SSE）、React + TypeScript。macOS では seatbelt サンドボックス（ネットワーク遮断、workspace 外書込禁止）。それ以外は素の subprocess で、隔離ではないことを結果に明記します。

## 試す

```bash
git clone https://github.com/FORIFOR/Multibot && cd Multibot
cd backend && uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python -e '.[dev]'
cd ../frontend && pnpm install && pnpm build && cd ../backend
.venv/bin/agentteam probe    # claude -p で実際の疎通確認
.venv/bin/agentteam serve    # http://127.0.0.1:8787
```

聞きたいことは 2 つです。revision に紐付くレビュー → 修正 → 再レビューの流れが、あなたのタスクでも成り立つか。「メッセージは少なく、証拠は多く」（Worker に全履歴を渡さない）がどこで破綻するか。
