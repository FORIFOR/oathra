# Oathra Desktop

Tauri（Rust + WebKit / WKWebView）を採用した、軽量でネイティブ動作するデスクトップクライアントです。

- **ブラウザ・デスクトップ両対応**: Web版と同じUI・判定・通話エンジンをデスクトップアプリとして快適に操作可能。
- **記録はサーバー側に**: このアプリは Oathra サーバーの画面をそのまま表示する薄いシェルです。文字起こし（`transcript.json`）・決定メモ（`summary.md`）・判定結果（`result.json`）は接続先サーバーの `.oathra/calls/` に保存されます。Web 発信は音声を保存しません。
- **どこからでもアクセス**: ローカル環境（`http://127.0.0.1:4242`）だけでなく、Cloudflare Tunnel や外出先のリモートサーバー URL（`https://*.trycloudflare.com` など）を指定してどこからでもアクセス可能です。

---

## 起動方法

### 1. サーバーの準備
デスクトップアプリを起動する前に、Oathraサーバーを起動します：

```bash
# ローカルで利用する場合
pnpm demo

# 外出先や他端末からもアクセス可能にする場合（トンネル起動）
pnpm demo --tunnel
```

`--tunnel` / `--allow-remote` のときは起動時にアクセストークンが生成され、表示される URL に `?token=…` が付きます。デスクトップアプリのサーバー URL にはその URL をそのまま貼ってください。トークンの無い URL は 401 を返します。URL を知る人は電話の発信・連絡先・通話記録にアクセスできるので、共有しないでください。

### 2. デスクトップアプリの起動（開発モード）

```bash
pnpm desktop
# または
cd apps/desktop && cargo tauri dev
```

### 3. デスクトップアプリのビルド（配布用 `.app` / `.dmg`）

```bash
pnpm desktop:build
# または
cd apps/desktop && cargo tauri build
```

ビルド完了後、`apps/desktop/src-tauri/target/release/bundle/macos/Oathra.app` が生成されます。
