(function () {
  'use strict';
  // Confirmation before destructive actions
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!window.confirm(f.dataset.confirm)) e.preventDefault(); });
  });
  // Mobile navigation
  var btn = document.querySelector('[data-admin-menu]');
  var nav = document.querySelector('[data-admin-nav]');
  if (btn && nav) btn.addEventListener('click', function () {
    var open = !nav.classList.contains('is-open');
    nav.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
  });
})();
