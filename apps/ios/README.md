# Oathra for iOS

SwiftUIネイティブアプリです。WebViewでWebサイトを包む構成ではありません。電話はGateway側で実行し、iOSは依頼・確認・進行・証拠・準備を操作します。iOS 17以降が対象です。

## Macで開く

```sh
brew install xcodegen
cd apps/ios
xcodegen generate
open Oathra.xcodeproj
```

XcodeでOathraスキームとSimulatorを選びます。実機には自分のDevelopment Teamと固有Bundle IDを設定します。初回に稼働済みGatewayのHTTPS URLとアカウントトークンを入力します。HTTP例外は設けていません。Gatewayの起動・配備・実電話設定は [Gateway README](../gateway/README.md) を参照してください。

```sh
xcodebuild -quiet -project Oathra.xcodeproj -scheme Oathra \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## 画面

「お願い」は目的・商品・連絡先・時間/費用上限・候補日時を指定し、発信前の確認シートで承認します。「進行・結果」はサーバーの最新状態、文字起こし、相手の発言に基づく結果、停止、有人交代、回線照合。「準備」は商品URLの取り込みと事実確認、連絡先、SMS本人番号確認、LINE/Slack連携です。

トークンはこの端末限定のKeychainに保存し、キャリア・音声AI・外部連携の秘密鍵は保存しません。再開時はサーバーの状態を取得し、通知や画面表示だけで完了を確定しません。アプリがバックグラウンドにある間も電話自体はGatewayで進みます。

## 配信・検証の区別

CIのSimulatorビルドは署名不要のビルド検査です。実機の通話品質・アクセシビリティ・ネットワーク断復帰・外部アカウントの疎通を保証しません。App Store/TestFlightへのアップロードは実施していません。配信にはApple側の署名、アプリアイコン、プライバシー申告、実機QA等が必要です。

現時点の継続通知はLINE/Slackが担当します。APNsは未実装で、iOS画面はフォアグラウンド時に状態を更新します。有人交代は確認済み電話番号へのPSTN接続であり、CallKit内蔵VoIPではありません。メール・カレンダー・SMS・CRMの詳細承認はWeb画面を使います。無断の再発信や通知だけでの自動承認は行いません。
