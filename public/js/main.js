// Small progressive enhancements. The site works without JavaScript;
// this file adds the background video, mobile menu, lightbox, sharing and filters.
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---------- Mobile menu ----------
  // Two buttons open the same menu: the burger in the header and "Menu" in the bottom tab bar.
  var toggles = $$('[data-menu-toggle]');
  var nav = $('[data-nav]');
  if (toggles.length && nav) {
    var setMenu = function (open) {
      toggles.forEach(function (t) { t.setAttribute('aria-expanded', String(open)); });
      nav.classList.toggle('is-open', open);
      document.body.classList.toggle('menu-open', open); // CSS locks page scroll behind the menu
    };
    toggles.forEach(function (t) {
      t.addEventListener('click', function () { setMenu(!nav.classList.contains('is-open')); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
    $$('a', nav).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    // Back to desktop width: close the menu so the scroll lock is released.
    window.matchMedia('(min-width: 1360px)').addEventListener('change', function (m) { if (m.matches) setMenu(false); });
  }

  // ---------- Header over the hero: transparent until scrolled ----------
  var header = $('[data-header]');
  if (header && header.classList.contains('is-transparent')) {
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 40); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Site-wide background video ----------
  // The same short drone clip loops behind every page. It is downloaded once and then
  // comes from the browser cache. On slow connections, with "save data" or "reduce motion"
  // only the poster photo is shown and the video is never downloaded.
  var video = $('[data-bg-video]');
  // Two controls: a floating button (tablets/desktop) and an item in the mobile menu
  var bgToggles = $$('[data-bg-toggle]');
  var PREF = 'akz-bg-paused';
  var userPaused = false;
  try { userPaused = localStorage.getItem(PREF) === '1'; } catch (e) { /* storage blocked: default = playing */ }
  var showToggles = function (show) { bgToggles.forEach(function (b) { b.hidden = !show; }); };
  var setToggle = function (paused) {
    bgToggles.forEach(function (b) {
      b.classList.toggle('is-paused', paused);
      var label = paused ? b.dataset.labelPlay : b.dataset.labelPause;
      b.setAttribute('aria-label', label);
      b.title = label;
      var text = $('[data-bg-toggle-label]', b);
      if (text) text.textContent = label;
    });
  };
  if (video) {
    var conn = navigator.connection || {};
    var slow = conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!slow && !reduced) {
      var start = function () {
        var mobile = window.matchMedia('(max-width: 768px)').matches;
        video.src = mobile ? video.dataset.srcMobile : video.dataset.src;
        showToggles(true); setToggle(userPaused);  // controls are available as soon as the video is requested
        video.addEventListener('loadeddata', function () {
          if (userPaused) video.classList.add('is-playing'); // show the first frame, do not move
        }, { once: true });
        video.addEventListener('playing', function () { video.classList.add('is-playing'); }, { once: true });
        video.addEventListener('error', function () { video.remove(); showToggles(false); });
        if (userPaused) { video.load(); return; }
        var p = video.play();
        if (p && p.catch) p.catch(function () { /* autoplay blocked: poster stays */ });
      };
      if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
      // Do not decode video in a background tab (saves battery on phones)
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) video.pause();
        else if (!userPaused && video.src) video.play().catch(function () {});
      });
    }
    bgToggles.forEach(function (b) {
      b.addEventListener('click', function () {
        userPaused = !userPaused;
        if (userPaused) video.pause(); else video.play().catch(function () {});
        setToggle(userPaused);
        try { localStorage.setItem(PREF, userPaused ? '1' : '0'); } catch (e) { /* ignore */ }
      });
    });
  }

  // ---------- Phones: hide the bottom tab bar while the on-screen keyboard is open ----------
  // Otherwise on Android it jumps up above the keyboard and covers the field being typed in.
  var isField = function (el) { return el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select'); };
  document.addEventListener('focusin', function (e) { if (isField(e.target)) document.body.classList.add('kb-open'); });
  document.addEventListener('focusout', function (e) {
    if (isField(e.target)) setTimeout(function () { if (!isField(document.activeElement)) document.body.classList.remove('kb-open'); }, 100);
  });

  // ---------- Offline support + "add to home screen" (service worker) ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
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
      if (video && video.src && !userPaused) video.play().catch(function () {});
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
    // Touch gestures: swipe left/right — next/previous photo, swipe down — close.
    // Passive listeners never block scrolling, so the gesture costs nothing on slow phones.
    var sx = 0, sy = 0, tracking = false;
    box.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) show(index + (dx < 0 ? 1 : -1));
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.3) box.close();
    }, { passive: true });
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

  // ---------- After a form: open WhatsApp with the prepared message (once) ----------
  // The button is the fallback; the "seen" flag stops WhatsApp re-opening if the visitor comes back.
  var wa = $('[data-wa-auto]');
  if (wa) {
    var key = 'akz-wa-' + wa.dataset.waKey, seen = false;
    try { seen = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch (e) { /* storage blocked */ }
    if (!seen) {
      var label = wa.innerHTML;
      wa.textContent = wa.dataset.waOpening;
      setTimeout(function () { window.location.href = wa.href; wa.innerHTML = label; }, 900);
    }
  }

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
    // Phone cameras produce 4–8 MB photos: shrink them in the browser to ≤ 1600px JPEG
    // before upload (≈ 300–500 KB) — faster on mobile internet, never hits the 8 MB limit.
    // If anything is unsupported the original files are sent unchanged.
    var MAX = 1600;
    var shrink = function (file) {
      return new Promise(function (resolve) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024) return resolve(file);
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
          var c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(img.src);
          c.toBlob(function (blob) {
            if (!blob || blob.size >= file.size) return resolve(file);
            resolve(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
          }, 'image/jpeg', 0.82);
        };
        img.onerror = function () { resolve(file); };
        img.src = URL.createObjectURL(file);
      });
    };
    var busy = false;
    photoInput.addEventListener('change', function () {
      if (busy) return;
      var files = Array.prototype.slice.call(photoInput.files, 0, 5);
      preview.innerHTML = '';
      files.forEach(function (f) {
        if (!/^image\//.test(f.type)) return;
        var im = document.createElement('img');
        im.src = URL.createObjectURL(f);
        im.alt = '';
        preview.appendChild(im);
      });
      if (typeof DataTransfer === 'undefined' || !window.Promise) return;
      var submit = $('[data-submit]');
      if (submit) submit.disabled = true;   // wait until the photos are ready
      Promise.all(files.map(shrink)).then(function (small) {
        try {
          var dt = new DataTransfer();
          small.forEach(function (f) { dt.items.add(f); });
          busy = true; photoInput.files = dt.files; busy = false;
        } catch (e) { /* keep originals */ }
        if (submit) submit.disabled = false;
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
