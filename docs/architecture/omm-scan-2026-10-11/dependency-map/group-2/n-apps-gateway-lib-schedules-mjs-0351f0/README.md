# dependency-map/group-2/n-apps-gateway-lib-schedules-mjs-0351f0

[解析トップへ戻る](../../../README.md)

確認済みファイル: `apps/gateway/lib/schedules.mjs`

解析: 字句抽出。静的なimport／export参照です。関数の実行順序やHTTP通信は表していません。

宣言: `Schedules`

- `node:crypto` → 外部・標準ライブラリ・別名など。ローカル対応先は未確定
- `../../../packages/contract/dist/index.js` → 外部・標準ライブラリ・別名など。ローカル対応先は未確定
- `./phone-service.mjs` → `apps/gateway/lib/phone-service.mjs`（内容確認済み）
- `./service.mjs` → `apps/gateway/lib/service.mjs`（一覧確認・内容未読）
- `./security.mjs` → `apps/gateway/lib/security.mjs`（一覧確認・内容未読）


```mermaid
graph TD
    source["ソース\napps/gateway/lib/schedules.mjs"]
    n-node-crypto-c7dfc5["node:crypto\n外部・別名・未解決"]
    source -->|"字句抽出: import／export"| n-node-crypto-c7dfc5
    n-packages-contract-dist-index-js-6a2376["../../../packages/contract/dist/index.js\n外部・別名・未解決"]
    source -->|"字句抽出: import／export"| n-packages-contract-dist-index-js-6a2376
    n-phone-service-mjs-707f58["./phone-service.mjs\napps/gateway/lib/phone-service.mjs"]
    source -->|"字句抽出: import／export"| n-phone-service-mjs-707f58
    n-service-mjs-20d286["./service.mjs\napps/gateway/lib/service.mjs"]
    source -->|"字句抽出: import／export"| n-service-mjs-20d286
    n-security-mjs-7b9f61["./security.mjs\napps/gateway/lib/security.mjs"]
    source -->|"字句抽出: import／export"| n-security-mjs-7b9f61
```

## 要素の説明

### n-node-crypto-c7dfc5

参照名: `node:crypto`

ローカルのソース対応先を確定できませんでした。外部ライブラリ、標準ライブラリ、型別名などを区別する追加確認が必要です。

### n-packages-contract-dist-index-js-6a2376

参照名: `../../../packages/contract/dist/index.js`

ローカルのソース対応先を確定できませんでした。外部ライブラリ、標準ライブラリ、型別名などを区別する追加確認が必要です。

### n-phone-service-mjs-707f58

参照名: `./phone-service.mjs`

対応する実在ソース: `apps/gateway/lib/phone-service.mjs`。内容確認済み。

### n-security-mjs-7b9f61

参照名: `./security.mjs`

対応する実在ソース: `apps/gateway/lib/security.mjs`。内容は未読。

### n-service-mjs-20d286

参照名: `./service.mjs`

対応する実在ソース: `apps/gateway/lib/service.mjs`。内容は未読。

### source

`apps/gateway/lib/schedules.mjs` の内容を確認しました。

