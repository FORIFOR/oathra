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
  patch('href="style.css"', 'href="/phone-style/style.css"');
  patch('</head>', '<link rel="stylesheet" href="/managed-phone.css"></head>');
  patch(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  patch(/<section id="phone-review"([\s\S]*?)<\/section>/, (_, inside) =>
    '<dialog id="phone-review"' + inside.replace(/<label class="phone-consent">[\s\S]*?<\/label>/, '') +
    '<button type="button" class="btn" id="phone-edit">戻って編集</button></dialog>');
  patch('<p id="phone-live-state" role="status"></p>',
    '<p id="phone-live-state" role="status"></p><p id="phone-live-credits" role="status"></p><p id="phone-live-cost" class="note"></p><p id="phone-live-balance" class="note"></p>');
  patch('</head>', '<script src="/phone/main.js" type="module"></script></head>');
  patch('<body>', '<body class="focused-task managed-phone">');
  patch('<main id="main">', '<main id="main">' + account);
  patch('<div class="topbar-right">',
    '<div class="topbar-right"><button type="button" class="btn" id="managed-credit-button" hidden></button><button type="button" class="btn" id="managed-account-button" hidden>アカウント</button><button type="button" class="btn" id="managed-logout" hidden>ログアウト</button>');
  return html;
}
