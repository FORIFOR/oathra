# Contributing to Oathra / 開発・改善への参加

日本語・英語どちらでも歓迎します。コードを書かなくても、試した際の不具合や使いたい用途の報告が役立ちます。
Contributions can start with a real observation, a question, or a proposed change.

## 試して報告する / Try and report

- [ブラウザの証拠ラボ / Browser evidence lab](https://forifor.github.io/oathra/#sim): インストール不要。文字からの判定を試せます。Input text stays in your browser; it is not an actual phone call.
- [CLIとArena / CLI and Arena](https://github.com/FORIFOR/oathra/releases/latest): 修正版はGitHub Releaseから導入できます。Check the release notes for the package version and command.
- [判定の不具合 / Unexpected evidence result](https://github.com/FORIFOR/oathra/issues/new?template=evidence.yml): 発言の順序、話者、必要条件、期待結果、実際の結果を記載してください。
- [起動・操作の不具合 / Startup or UI error](https://github.com/FORIFOR/oathra/issues/new?template=startup.yml): 導入方法・環境・操作とエラーを記載してください。

Reports on GitHub are public. Remove names, phone numbers, credentials and private call content. No recording is required. Do not post `.env` or complete call archives.
公開Issueへ個人情報・認証情報・通話アーカイブを添付しないでください。企業固有の内容は[非公開の相談フォーム](https://forifor.github.io/oathra/#business)を利用できます。

## ソースを動かす / Run from source

Node.js 22以上と、このリポジトリの `packageManager` が指定するpnpmを使用します。

```bash
git clone https://github.com/FORIFOR/oathra.git
cd oathra
pnpm install --frozen-lockfile
pnpm build
pnpm demo
```

The built-in local demo needs no API key. Real calls and external AI providers require separate configuration and may incur charges.

## 変更を送る / Send a change

関係するIssueがあればリンクし、何が起きていたか、どう変わるか、実際に確認した範囲をPRへ記載してください。大きな設計変更は先に[Discussions](https://github.com/FORIFOR/oathra/discussions)で相談できます。

Keep claims tied to evidence. Do not introduce stubs, mock implementations, fabricated logs or dummy evaluation data. If a temporary substitute is essential to unblock verification of a core feature, document its minimal scope and removal plan. Do not call a simulator result a real-call benchmark.

既存の検証コマンドは以下です。変更に関係する確認を行い、未実施のものもPRに明記してください。

```bash
pnpm lint:deps
pnpm build:site
pnpm build
pnpm test
```

CI additionally validates the bundled scenarios, runs the existing simulator evaluations and checks installation from a packed CLI. These are software checks, not evidence of production phone reliability.

## 調べる場所 / Code map

| Concern | Source |
| --- | --- |
| 発言からの抽出 / Claim extraction | `packages/evidence/src/extract.ts` |
| 時刻・日付・数値 / Normalization | `packages/evidence/src/normalize.ts` |
| 合意・訂正・失効 / Evidence state | `packages/evidence/src/engine.ts` |
| 完了条件 / Completion check | `packages/evidence/src/evaluate.ts` |
| ブラウザ体験 / Browser evidence lab | `site/src/playground.ts` |
| ローカル画面 / Local Arena | `apps/arena/` |

[Readiness and known limits / 検証範囲と未達事項](docs/READINESS.md) · [Open issues / 未解決の不具合](https://github.com/FORIFOR/oathra/issues)
