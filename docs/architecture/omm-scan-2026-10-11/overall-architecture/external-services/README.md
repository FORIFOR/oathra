# overall-architecture/external-services

[解析トップへ戻る](../README.md) ・ [ひとつ上へ](../README.md)

Oathra が接続する外部サービス。詳しくは external-integrations を参照。

```mermaid
graph LR
    telephony["電話会社<br/>Twilio ・ Plivo ・ LiveKit"]:::external
    ai-apis["AI API<br/>OpenAI ・ Gemini ・ Deepgram ・ ElevenLabs"]:::external
    business-apis["業務・決済<br/>Stripe ・ Google ・ HubSpot ・ LINE ・ Slack"]:::external
    classDef external fill:#585b70,stroke:#585b70,color:#cdd6f4
```

## 要素

### ai-apis

音声エンジン、STT、TTS、Brain。

[説明を見る](ai-apis/README.md)

### business-apis

購入、メール、予定、CRM、チャット。

[説明を見る](business-apis/README.md)

### telephony

発信・着信・SMS・WhatsApp。

[説明を見る](telephony/README.md)
