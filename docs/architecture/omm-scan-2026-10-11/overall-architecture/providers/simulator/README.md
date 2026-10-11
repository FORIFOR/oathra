# overall-architecture/providers/simulator

[解析トップへ戻る](../../README.md) ・ [ひとつ上へ](../README.md)

API キーも電話番号も使わない疑似通話。core の TransportProvider を直接実装し、Phone/Voice Layer を通らない。台本キャラクター（characters/）は truth() を実装し、eval が偽の完了を検出できるようにする。
