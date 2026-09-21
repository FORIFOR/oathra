import { readFileSync } from 'node:fs';

/** Reuse Arena's phone/contacts view; detect contract drift before serving a broken screen. */
export function phonePage() {
  let html = readFileSync(new URL('../../arena/public/index.html', import.meta.url), 'utf8');
  const account = readFileSync(new URL('../public/phone/account.html', import.meta.url), 'utf8');
  const patch = (slot, replacement) => {
    const updated = html.replace(slot, replacement);
    if (updated === html) throw new Error('Managed phone markup slot is missing: ' + slot);
    html = updated;
  };
  // The decision stays in view while the explanation scrolls; a blocking reason sits above the button it blocks.
  const actions = inside => {
    const dial = /<button type="button" class="btn primary" id="phone-dial"[^>]*>[^<]*<\/button>/, hint = /<p id="phone-dial-hint"[^>]*><\/p>/, error = /<p id="phone-dial-error"[^>]*><\/p>/;
    const parts = [hint, error, dial].map(slot => { const found = inside.match(slot); if (!found) throw new Error('Managed phone markup slot is missing: ' + slot); inside = inside.replace(slot, ''); return found[0]; });
    return inside + '<div class="phone-review-actions">' + parts.join('') + '<button type="button" class="btn" id="phone-edit">戻って編集</button></div>';
  };
  patch('href="style.css"', 'href="/phone-style/style.css"');
  patch('</head>', '<link rel="stylesheet" href="/managed-phone.css"></head>');
  patch(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  patch(/<section id="phone-review"([\s\S]*?)<\/section>/, (_, inside) =>
    '<dialog id="phone-review"' + actions(inside.replace(/<label class="phone-consent">[\s\S]*?<\/label>/, '')) + '</dialog>');
  // Why the call ended belongs directly under the state, before any numbers.
  patch('<p id="phone-live-error" role="alert" hidden></p>', '');
  patch('<p id="phone-live-state" role="status"></p>',
    '<p id="phone-live-state" role="status"></p><p id="phone-live-error" role="alert" hidden></p><p id="phone-live-credits" role="status"></p><p id="phone-live-cost" class="note"></p><p id="phone-live-balance" class="note"></p>');
  patch('<pre id="phone-live-summary"></pre>', '<pre id="phone-live-summary"></pre><details id="phone-live-request"><summary>依頼内容</summary><p id="phone-live-request-text"></p></details>');
  patch('</head>', '<script src="/phone/main.js" type="module"></script></head>');
  patch('<body>', '<body class="focused-task managed-phone">');
  patch('<main id="main">', '<main id="main">' + account);
  patch('<div class="topbar-right">',
    '<div class="topbar-right"><button type="button" class="btn" id="managed-credit-button" hidden></button><button type="button" class="btn" id="managed-account-button" hidden>アカウント</button>');
  return html;
}
