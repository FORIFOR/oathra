# 電話番号入力とチャネル共通受付 — 2026-09-19

> 初回実装時点の記録です。ArenaのWeb直接発信・下書き保存とAPI拡張については [後続のWeb発信契約](web-phone.md) を参照してください。LINE/Slackの汎用実発信は引き続き未接続です。

## 実装した範囲

Arena右上の「電話番号で依頼」から、電話番号・相手名・依頼内容を入力して確認できる。入力変更で確認と保存リンクを破棄し、同じタブの再読込では入力を復元する。消去ボタンは保存入力も削除する。`?lang=ja&phone=1` は入力画面を直接開く。下書き確認はlocalhostだけで処理し、発信・課金・電話会社への照会を行わない。

番号の正規化・抽出・厳密なJSON仕様は `packages/contract/src/phone-input.ts` に集約。日本の0始まり10/11桁と国際+形式を受け付け、全角・区切りを正規化。複数番号、内線、不正形式を推測しない。これは形式確認であり、番号の割当・到達性・所有者の証明ではない。

`POST /api/phone/prepare` は `{phone,name,instruction}` を受け、`{state:"draft",execution:"cli-only",request}` を返す。不正入力は400 INVALID_INPUT。既存のlocalhost Host/Origin制限を適用する。準備で通話レコードを作らない。

保存形式はexperimental v1:

- `schemaVersion: 1`
- `kind: "oathra.phone-request"`
- `phone`: 正規化した番号
- `name`: 1〜100文字
- `instruction`: 1〜2000文字

CLI `call --request-file <json> --dry-run` は契約を表示し、外部接続しない。実行には明示的な `--approve-request` が必要。宛先・名前・シナリオの上書き併用を拒否し、依頼ファイルの実行ではキャリアへの自動フォールバックをしない。依頼のgoalは `phone.message` とし、友人になりすます雑談テンプレートへ送らず、AI代理と依頼内容を伝える。

## LINE等

LINE/Slack共通のChannels→Serviceに同じ番号契約を適用。商品名を明示しない番号入り依頼は、商品登録の有無にかかわらず汎用下書きとして扱う。専用の暗号化された期限付き保存領域を使い、番号と依頼文を確認返信としてキューへ入れる。営業商材や同意済み連絡先を勝手に作らない。複数番号・登録名との矛盾は拒否する。送信取消では対応する下書きと返信キューを削除する。

商品名を指定した営業依頼は既存契約を維持し、番号で登録済み連絡先を特定できる。未登録番号も下書きに保持するが、連絡先登録前の承認発行・実行はサーバーで拒否する。

## 明確な制約

- **Arenaからの直接発信、LINE/Slackの汎用友人依頼からの発信は未接続**。下書き入力・確認を、発信受付や通話成功とは表示しない。Webの保存JSONは既存CLIへ引き継げる。
- LINE等で利用するには、既存Gatewayとアカウント連携が必要。今回、実アカウントへの通知・Webhook配備は行っていない。
- CLIによる実発信は課金と第三者送信を伴う。テストでは未実行。料金/録音/番号を確認したうえで、利用者が明示して実行する。
- 画面の入力はsessionStorage、保存JSONは個人情報を含む。LINEの汎用下書きは30日で期限切れ。Coreから外部送信する処理はない。

## 検証

macOS 26.6.2 arm64、Node 25.2.1、pnpm 10.12.2、Chrome 153.0.8010.53。対象HEADは `d330530d6fa4e94c4160554b6b88e7d846c45fd1` と未コミット差分。証拠は `artifacts/quality/phone-input/`。

- Core境界テスト: 国内/国際/全角、複数/内線/日付/金額の区別、JSON厳密性。文字列検証であり架空の発信結果ではない。
- `node scripts/ui/phone-input.mjs`: 環境に設定済みの番号を入力値としてのみ使用し、入力・確認・保存JSON・dry-run・未承認拒否・再読込・消去・1280/390pxを実Chromeで照合。実発信なし。番号は証拠画像で非表示。番号未設定環境ではBLOCKED/exit 2となり合格を捏造しない。
- Gatewayのローカル検証: 既存fixtureを使い本物のService/Store/Channelsへイベントを渡す。追加の外部サービスmockはない。実LINE送信成功の証明ではない。
- 独立レビューで「依頼を雑談として扱って入力を無視する」「失敗時に別キャリアへ再発信する」問題を指摘・修正。実電話を使わず契約と音声指示を直接検証する。

実電話・実LINE/Slackの往復・費用照合は **BLOCKED（外部送信と課金の実行許可なし）**。公開、push、発信はしていない。単に入力を保存する操作で発信しないことはローカルで確認した。

## 実行結果

| 方法 | 判定 | 観測・exit code | 証拠 |
|---|---|---|---|
| `pnpm build` / `pnpm typecheck` | PASS | 各0 | `build.log`, `typecheck.log` |
| `pnpm test` | PASS | 992 passed / 1 skipped、0。未実行skipをPASSに含めない | `test.log` |
| `pnpm test:gateway` | PASS | 204 passed、0 | `gateway-tests.log` |
| `pnpm lint:deps` | PASS | 依存方向違反なし、0 | `deps.log` |
| `node scripts/ui/phone-input.mjs` | PASS | 実入力→確認→JSON→CLI dry-run、未承認拒否、編集/復元/消去、0 | `browser.log`, `phone-desktop.png`, `phone-mobile.png` |
| 起動済み55344の`?lang=ja&phone=1`を新規Chromeで表示 | PASS | 入力欄表示、1280/390px横溢れなし、0 | `entry-desktop.png`, `entry-mobile.png` |

独立レビューの範囲: Core担当が、自身の担当外だったArena/CLIの差分と実画面を監査した。指摘したキャリア自動再試行は親担当が修正し、再確認した。雑談テンプレートによる依頼欠落は、その後レビュー担当に修正を割り当て、両エンジンのinstructionsを直接検証する5件のテストを追加した。したがって音声指示の最終検証は実装担当によるテストであり、実電話の独立実証ではない。

既存Arena回帰 `node scripts/ui/arena-flow.mjs` は91件成功・exit 0（`arena-flow.log`）。旧「無効な電話会社選択肢がある」検査は、新仕様に合わせ「番号と内容の入力欄が利用可能で、入力だけで発信しない」検査へ置換した。期待する未実装表示を温存するために新機能を無効化してはいない。
