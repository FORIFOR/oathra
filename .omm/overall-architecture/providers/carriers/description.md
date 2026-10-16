PhoneProvider を実装し、dial() で CarrierMediaSession を返す CarrierTransport を作る。Twilio は Media Streams の WebSocket で直接つなぎ、Plivo と汎用 SIP は SipGateway 経由でつなぐ。
