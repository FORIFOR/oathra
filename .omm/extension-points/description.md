# プラグインの仕組み

sdk/plugin-kit が manifest を検証して PluginRegistry に登録し、Gateway の Channels（受信）と Followups（後続送信）が registry 経由でプラグインを呼ぶ。プラグインはサンドボックスではなく、同じプロセスで動く信頼済みのコード。
