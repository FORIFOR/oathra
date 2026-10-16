# dependency-map/foundation

[解析トップへ戻る](../README.md) ・ [ひとつ上へ](../README.md)

contract（0）→ evidence（1）→ core（2）→ scenario（3）。下の層ほど他に依存しない。

```mermaid
graph LR
    contract["@oathra/contract<br/>layer 0"]
    evidence["@oathra/evidence<br/>layer 1"]
    core["@oathra/core<br/>layer 2"]
    scenario["@oathra/scenario<br/>layer 3"]
    evidence -->|"defineCall・checkConstraints"| contract
    core -->|"証拠と結果の型"| evidence
    core -->|"Action・CallContract の型"| contract
    scenario -->|"制約・Intake のスキーマ"| contract
```

## 要素

### contract

依存先: なし（@oathra には依存しない）

[説明を見る](contract/README.md)

### core

依存先: contract、evidence

[説明を見る](core/README.md)

### evidence

依存先: contract

[説明を見る](evidence/README.md)

### scenario

依存先: contract

[説明を見る](scenario/README.md)
