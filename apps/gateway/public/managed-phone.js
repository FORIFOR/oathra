// Compatibility entry for previously loaded managed pages. The maintained UI is in phone/.
import('/phone/main.js').catch(() => {
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  error.textContent = '画面を読み込めませんでした。再読み込みしてください。';
  document.body.prepend(error);
});
