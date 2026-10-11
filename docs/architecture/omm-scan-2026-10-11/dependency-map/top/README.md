# dependency-map/top

[解析トップへ戻る](../README.md) ・ [ひとつ上へ](../README.md)

replay と eval（6）、CLI（8）。

```mermaid
graph LR
    replay["@oathra/replay<br/>layer 6"]
    eval["@oathra/eval<br/>layer 6"]
    cli-pkg["oathra（CLI）<br/>layer 8"]
    cli-pkg -->|"oathra eval"| eval
    cli-pkg -->|"oathra replay"| replay
```

## 要素

### cli-pkg

依存先: 上記すべてと providers

[説明を見る](cli-pkg/README.md)

### eval

依存先: runtime、scenario、core、contract、evidence、simulator

[説明を見る](eval/README.md)

### replay

依存先: runtime、core、contract、evidence

[説明を見る](replay/README.md)
