/* Preserve published deep links while keeping the main introduction focused. */
(() => {
  const lab = new Set(['#sim', '#real', '#play', '#call', '#setup', '#prove', '#carriers', '#rec', '#demo-video', '#verdict-video', '#why', '#screen', '#log', '#howto', '#start', '#scope', '#player', '#p-lines', '#p-ev', '#p-res']);
  function route() {
    const hash = location.hash;
    if (lab.has(hash)) location.replace(new URL(`lab.html${hash}`, location.href));
    else if (hash === '#transcript-video') location.replace(new URL(`check.html${hash}`, location.href));
    else if (hash === '#readiness') location.replace(new URL('#availability', location.href));
    else if (hash === '#intake') location.replace(new URL('#intake-video', location.href));
  }
  addEventListener('hashchange', route);
  route();
})();
