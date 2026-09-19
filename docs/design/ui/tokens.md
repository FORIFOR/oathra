# Token contract

既存トークンがあればそちらを正本にする。下記は分類であって、新しいデザインの指定ではない。

| 分類 | 役割の例 | 正本のパス |
|---|---|---|
| Color | background / surface / text / muted / accent / error / focus | Gateway: apps/gateway/public/style.css の :root（--bg --card --ink --muted --line --accent --good --bad --open --busy）。Arena: apps/arena/public/style-base.css の :root |
| Type | display / heading / body / caption、日本語fallback | Gateway: 本文17px（幅600px未満は16px）、Inter→Hiragino Sans→Noto Sans JP。Arena: style-base.css |
| Spacing | component gap / content padding / section spacing | Gateway: カード24〜28px、盤面の間隔20px（高さ960px未満は詰める）|
| Shape | small control / card / dialog / pill | Gateway: 操作部12px、カード18px、ダイアログ20px、ピル99px |
| Elevation | overlay / focus / floating | Gateway: 影はダイアログと通知だけ。focusは3pxの輪郭 |
| Motion | feedback / enter / exit / expand、easing | Gateway: 動きはスクロールのみ、reduced-motionで無効。Arena: style-base.css |
| Layout | content max width / breakpoint / safe area | Gateway: サインイン前760px、盤面1240px、1000px未満で縦積み。操作部は52px（詰めた盤面で44〜48px）、最小44px |

まず代表画面で文字と余白を確認し、採用したものをトークン化する。
探索前に大量の値を固定しない。色替えだけで別の製品の個性を作ろうとしない。
0、auto、100%、calc等の構造値や必要な光学補正を「トークン違反」にしない。
一度しか使わない装飾値をむやみにグローバルトークンへ追加しない。
