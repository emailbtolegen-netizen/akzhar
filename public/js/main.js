// Small progressive enhancements. The site works without JavaScript;
// this file adds the background video, mobile menu, lightbox, sharing and filters.
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---------- Mobile menu ----------
  var toggle = $('[data-menu-toggle]');
  var nav = $('[data-nav]');
  if (toggle && nav) {
    var setMenu = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      document.body.classList.toggle('menu-open', open);
    };
    toggle.addEventListener('click', function () { setMenu(toggle.getAttribute('aria-expanded') !== 'true'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
    $$('a', nav).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  }

  // ---------- Header over the hero: transparent until scrolled ----------
  var header = $('[data-header]');
  if (header && header.classList.contains('is-transparent')) {
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 40); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Hero background video ----------
  var video = $('[data-hero-video]');
  var heroToggle = $('[data-hero-toggle]');
  if (video) {
    var conn = navigator.connection || {};
    var slow = conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // On slow connections or with "reduce motion" the poster image stays; the video is never downloaded.
    if (!slow && !reduced) {
      var start = function () {
        var mobile = window.matchMedia('(max-width: 768px)').matches;
        video.src = mobile ? video.dataset.srcMobile : video.dataset.src;
        video.addEventListener('playing', function () {
          video.classList.add('is-playing');
          if (heroToggle) heroToggle.hidden = false;
        }, { once: true });
        video.addEventListener('error', function () { video.remove(); if (heroToggle) heroToggle.hidden = true; });
        var p = video.play();
        if (p && p.catch) p.catch(function () { /* autoplay blocked: poster stays */ });
      };
      if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
    }
    if (heroToggle) {
      heroToggle.addEventListener('click', function () {
        var paused = !video.paused;
        if (paused) video.pause(); else video.play();
        heroToggle.classList.toggle('is-paused', paused);
        heroToggle.setAttribute('aria-label', paused ? heroToggle.dataset.labelPlay : heroToggle.dataset.labelPause);
      });
    }
  }

  // ---------- "Watch video" dialog ----------
  var modal = $('[data-video-modal]');
  if (modal) {
    var full = $('[data-full-video]', modal);
    var frame = $('iframe[data-embed-src]', modal);
    $$('[data-open-video]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (typeof modal.showModal !== 'function') { if (full) window.location.href = full.querySelector('source').src; return; }
        modal.showModal();
        if (video && !video.paused) video.pause();
        if (frame) frame.src = frame.dataset.embedSrc;
        if (full) { var p = full.play(); if (p && p.catch) p.catch(function () {}); }
      });
    });
    var closeModal = function () { modal.close(); };
    $('[data-close]', modal).addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    modal.addEventListener('close', function () {
      if (full) full.pause();
      if (frame) frame.src = 'about:blank';
      if (video && video.classList.contains('is-playing') && !(heroToggle && heroToggle.classList.contains('is-paused'))) video.play();
    });
  }

  // ---------- Gallery lightbox ----------
  $$('[data-gallery]').forEach(function (gallery) {
    var box = gallery.nextElementSibling;
    if (!box || !box.matches('[data-lightbox]') || typeof box.showModal !== 'function') return;
    var items = $$('.gallery__item', gallery);
    var img = $('[data-lightbox-img]', box);
    var cap = $('[data-lightbox-cap]', box);
    var index = 0;
    var show = function (i) {
      index = (i + items.length) % items.length;
      img.src = items[index].getAttribute('href');
      img.alt = items[index].dataset.caption || '';
      cap.textContent = items[index].dataset.caption || '';
    };
    items.forEach(function (a, i) {
      a.addEventListener('click', function (e) { e.preventDefault(); show(i); box.showModal(); });
    });
    $('[data-close]', box).addEventListener('click', function () { box.close(); });
    $('[data-prev]', box).addEventListener('click', function () { show(index - 1); });
    $('[data-next]', box).addEventListener('click', function () { show(index + 1); });
    if (items.length < 2) $$('.lightbox__nav', box).forEach(function (b) { b.hidden = true; });
    box.addEventListener('click', function (e) { if (e.target === box) box.close(); });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') show(index - 1);
      if (e.key === 'ArrowRight') show(index + 1);
    });
  });

  // ---------- Share buttons ----------
  $$('[data-share]').forEach(function (el) {
    var url = el.dataset.url, title = el.dataset.title;
    var copy = $('[data-copy]', el);
    if (copy) copy.addEventListener('click', function () {
      var done = function () { var old = copy.innerHTML; copy.textContent = el.dataset.copied; setTimeout(function () { copy.innerHTML = old; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done);
      else { window.prompt('', url); }
    });
    var native = $('[data-native-share]', el);
    if (native && navigator.share) {
      native.hidden = false;
      native.addEventListener('click', function () { navigator.share({ title: title, url: url }).catch(function () {}); });
    }
  });

  // ---------- Ads: filters submit on change ----------
  $$('[data-autosubmit]').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });

  // ---------- Ad form: price field only for categories with a price; photo preview ----------
  var catSelect = $('[data-price-toggle]');
  var priceField = $('[data-price-field]');
  if (catSelect && priceField) {
    var syncPrice = function () {
      var opt = catSelect.options[catSelect.selectedIndex];
      priceField.hidden = !!(opt && opt.dataset.price === '0');
    };
    catSelect.addEventListener('change', syncPrice);
    syncPrice();
  }
  var photoInput = $('[data-photo-input]');
  var preview = $('[data-photo-preview]');
  if (photoInput && preview && window.URL) {
    photoInput.addEventListener('change', function () {
      preview.innerHTML = '';
      Array.prototype.slice.call(photoInput.files, 0, 5).forEach(function (f) {
        if (!/^image\//.test(f.type)) return;
        var im = document.createElement('img');
        im.src = URL.createObjectURL(f);
        im.alt = '';
        preview.appendChild(im);
      });
    });
  }
  var adForm = $('[data-ad-form]');
  if (adForm) adForm.addEventListener('submit', function () {
    var btn = $('[data-submit]', adForm);
    setTimeout(function () { btn.disabled = true; }, 0);
  });

  // ---------- Phones: instant search ----------
  var phoneSearch = $('[data-phone-search]');
  if (phoneSearch) {
    var emptyMsg = $('[data-phone-empty]');
    phoneSearch.addEventListener('input', function () {
      var q = phoneSearch.value.trim().toLocaleLowerCase('ru');
      var qDigits = q.replace(/\D/g, '');
      var any = false;
      $$('[data-phone-group]').forEach(function (g) {
        var visible = 0;
        $$('[data-phone-item]', g).forEach(function (item) {
          var hay = item.dataset.search;
          var ok = !q || hay.indexOf(q) !== -1 || (qDigits.length > 2 && hay.replace(/\D/g, '').indexOf(qDigits) !== -1);
          item.hidden = !ok;
          if (ok) visible++;
        });
        g.hidden = visible === 0;
        if (visible) any = true;
      });
      if (emptyMsg) emptyMsg.hidden = any;
    });
  }
})();
