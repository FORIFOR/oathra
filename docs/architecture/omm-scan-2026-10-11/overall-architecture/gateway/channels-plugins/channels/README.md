# overall-architecture/gateway/channels-plugins/channels

[解析トップへ戻る](../../../README.md) ・ [ひとつ上へ](../README.md)

receive() → inbox → process() → outbox → send()。未連携の送信者からは連携コードだけを受け付ける。
