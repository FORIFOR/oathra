# GitHubからのCLI配布 0.1.1

npmの公開は認証失効により未完了（npmは0.1.0）。GitHub Releaseに通常のnpm tarballを添付し、npxの`--package`に公開URLを渡すことで修正版を導入できるようにする。認証設定の変更や2FA回避は行わない。

- `pnpm build`、`pnpm build:site` 成功。
- `npm pack` の成果物を空の一時ディレクトリへ`npm install`し、実際のCLIからArenaを起動。ブラウザで初期画面とシナリオ一覧を確認。
- 配布物のpackage.jsonは0.1.1、CLIエントリポイントあり。rootのApache-2.0 LICENSEを同梱するようビルドを修正。
- .env・calls・.oathraを配布していないことをアーカイブ内の一覧で確認。
- 新しい電話発信、ダミーデータ作成、外部サービスへの課金なし。
- npxコピー導線とREADMEに、GitHub版0.1.1／npm版0.1.0の違いを明示。
- 実行時の検証環境はNode v25.2.1。既存CIのNode 22でもpack smokeを実施する。
