# overall-architecture/core-packages/runtime

[解析トップへ戻る](../../README.md) ・ [ひとつ上へ](../README.md)

通話ループの本体。CallRuntime と runCall() が Brain・Transport・EvidenceEngine を回し、権限と制約を確認して CallOutcome を返す。完了の判定は evidence の evaluate() に任せる。
