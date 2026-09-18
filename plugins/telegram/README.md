# Telegram channel reference

Optional Oathra channel plugin; not enabled by default. Private text, approval callbacks, progress and
result messages are supported. Voice messages, groups and automatic prospect discovery are not.

Review this directory, run `node apps/gateway/plugins.mjs inspect plugins/telegram`, then explicitly
add it with the returned `--trust` hash. Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET on the server,
configure Telegram setWebhook with the same secret_token and `/hooks/channels/telegram`, and restart.
Generate a linking code in Web/iOS and send it to the bot in a private conversation.

This is an Oathra-native plugin, not an OpenClaw-compatible package. Unit/integration tests use HTTP
mocks; no live Telegram account or telephone call was tested by generating this source.
The host compacts approval data into encrypted, identity-scoped tokens under the callback size limit.
Treat plugin code as trusted host-process code. Do not place real tokens in this directory or README.

Official protocol: https://core.telegram.org/bots/api
