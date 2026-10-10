# dependency-map/group-2/n-apps-gateway-lib-purchases-mjs-841e54

[解析トップへ戻る](../../../README.md)

確認済みファイル: `apps/gateway/lib/purchases.mjs`

解析: 字句抽出。静的なimport／export参照です。関数の実行順序やHTTP通信は表していません。

宣言: `httpsUrl`, `stripeSignatureValid`, `Purchases`

- `node:crypto` → 外部・標準ライブラリ・別名など。ローカル対応先は未確定
- `./security.mjs` → `apps/gateway/lib/security.mjs`（一覧確認・内容未読）


```mermaid
graph TD
    source["ソース\napps/gateway/lib/purchases.mjs"]
    n-node-crypto-c7dfc5["node:crypto\n外部・別名・未解決"]
    source -->|"字句抽出: import／export"| n-node-crypto-c7dfc5
    n-security-mjs-7b9f61["./security.mjs\napps/gateway/lib/security.mjs"]
    source -->|"字句抽出: import／export"| n-security-mjs-7b9f61
```

## 要素の説明

### n-node-crypto-c7dfc5

参照名: `node:crypto`

ローカルのソース対応先を確定できませんでした。外部ライブラリ、標準ライブラリ、型別名などを区別する追加確認が必要です。

### n-security-mjs-7b9f61

参照名: `./security.mjs`

対応する実在ソース: `apps/gateway/lib/security.mjs`。内容は未読。

### source

`apps/gateway/lib/purchases.mjs` の内容を確認しました。

