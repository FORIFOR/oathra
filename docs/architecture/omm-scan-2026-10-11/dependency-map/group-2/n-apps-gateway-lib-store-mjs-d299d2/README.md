# dependency-map/group-2/n-apps-gateway-lib-store-mjs-d299d2

[解析トップへ戻る](../../../README.md)

確認済みファイル: `apps/gateway/lib/store.mjs`

解析: 字句抽出。静的なimport／export参照です。関数の実行順序やHTTP通信は表していません。

宣言: `Store`

- `node:sqlite` → 外部・標準ライブラリ・別名など。ローカル対応先は未確定
- `node:crypto` → 外部・標準ライブラリ・別名など。ローカル対応先は未確定
- `node:fs` → 外部・標準ライブラリ・別名など。ローカル対応先は未確定
- `node:path` → 外部・標準ライブラリ・別名など。ローカル対応先は未確定
- `./security.mjs` → `apps/gateway/lib/security.mjs`（一覧確認・内容未読）


```mermaid
graph TD
    source["ソース\napps/gateway/lib/store.mjs"]
    n-node-sqlite-f5bdc0["node:sqlite\n外部・別名・未解決"]
    source -->|"字句抽出: import／export"| n-node-sqlite-f5bdc0
    n-node-crypto-c7dfc5["node:crypto\n外部・別名・未解決"]
    source -->|"字句抽出: import／export"| n-node-crypto-c7dfc5
    n-node-fs-a15b7d["node:fs\n外部・別名・未解決"]
    source -->|"字句抽出: import／export"| n-node-fs-a15b7d
    n-node-path-78811c["node:path\n外部・別名・未解決"]
    source -->|"字句抽出: import／export"| n-node-path-78811c
    n-security-mjs-7b9f61["./security.mjs\napps/gateway/lib/security.mjs"]
    source -->|"字句抽出: import／export"| n-security-mjs-7b9f61
```

## 要素の説明

### n-node-crypto-c7dfc5

参照名: `node:crypto`

ローカルのソース対応先を確定できませんでした。外部ライブラリ、標準ライブラリ、型別名などを区別する追加確認が必要です。

### n-node-fs-a15b7d

参照名: `node:fs`

ローカルのソース対応先を確定できませんでした。外部ライブラリ、標準ライブラリ、型別名などを区別する追加確認が必要です。

### n-node-path-78811c

参照名: `node:path`

ローカルのソース対応先を確定できませんでした。外部ライブラリ、標準ライブラリ、型別名などを区別する追加確認が必要です。

### n-node-sqlite-f5bdc0

参照名: `node:sqlite`

ローカルのソース対応先を確定できませんでした。外部ライブラリ、標準ライブラリ、型別名などを区別する追加確認が必要です。

### n-security-mjs-7b9f61

参照名: `./security.mjs`

対応する実在ソース: `apps/gateway/lib/security.mjs`。内容は未読。

### source

`apps/gateway/lib/store.mjs` の内容を確認しました。

