import { readFileSync } from 'node:fs';
import { repoUrl } from './paths.mjs';

/** Reuse Arena's phone/contacts view; detect contract drift before serving a broken screen. */
export function phonePage() {
  let html = readFileSync(repoUrl('apps/arena/public/index.html'), 'utf8');
  const account = readFileSync(repoUrl('apps/gateway/public/phone/account.html'), 'utf8');
  const bookings = readFileSync(repoUrl('apps/gateway/public/phone/bookings.html'), 'utf8');
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
  // Arena's three-step phone form and its voice cards need Arena's script; the managed page builds its own voice
  // fields (credits, engines this deployment runs) and keeps its flat form, so the steps are unwrapped here.
  patch(/<fieldset class="phone-step" id="phone-voice-choice"[\s\S]*?<\/fieldset>/, '');
  patch(/<fieldset class="phone-step">\s*<legend[^>]*>[^<]*<\/legend>/g, '');
  patch(/<\/fieldset>/g, '');
  patch(/<p id="phone-caller-hint"[^>]*><\/p>/, '');
  patch(/<div class="phone-aside" id="phone-aside"><!-- phone-aside -->[\s\S]*?<!-- \/phone-aside-head -->/, '');
  patch('</div><!-- /phone-aside -->', '');
  patch(' aria-describedby="phone-caller-hint"', '');
  patch('href="style.css"', 'href="/phone-style/style.css"');
  // Arena's v2 look is Arena-only for now; the managed page keeps its current styles until it is redesigned.
  patch(/\s*<link rel="stylesheet" href="v2.css" \/>/, '');
  // Arena's records list (practice and real calls together) is Arena-only; the managed page has its own history.
  patch(/\s*<link rel="stylesheet" href="records.css" \/>/, '');
  // The Ring Zero theme files are Arena's; the managed page keeps its own look for now.
  patch(/\s*<link rel="stylesheet" href="ringzero.css" \/>/, '');
  patch(/\s*<script src="ringzero.js"><\/script>/, '');
  patch(/\s*<button type="button" class="btn" id="records-open"[^>]*>Records<\/button>/, '');
  // The Arena's icons live under assets/; the gateway serves its own copies at the root.
  patch(/href="assets\/oathra-mark-original\.png"/, 'href="/oathra-mark-original.png"');
  patch(/href="assets\/oathra-mark-white\.png"/, 'href="/oathra-mark.png"');
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
  patch('<main id="main">', '<main id="main">' + account + bookings);
  patch('<div class="topbar-right">',
    '<div class="topbar-right"><button type="button" class="btn" id="managed-credit-button" hidden></button><button type="button" class="btn" id="managed-account-button" hidden>アカウント</button><button type="button" class="btn" id="bookings-open" aria-pressed="false" hidden>予約台帳</button>');
  return html;
}
