// Native-app bootstrap. Loaded by every page, BEFORE common.js, and a no-op on the web.
//
// The iOS and Android builds ship these same files inside the app binary, so the page
// origin is capacitor://localhost and freshaf.io is a different origin. Three things
// follow, and all three are handled here so nothing else in the app has to know:
//
//   1. API calls need an absolute base (window.FRESHAF_API_BASE, read by common.js).
//   2. The session cookie cannot travel cross-origin, so the app holds a Bearer token.
//   3. The token must outlive the app being closed, so it goes to native secure storage
//      rather than localStorage, which on iOS can be cleared by the system.
(function () {
  'use strict';

  var cap = window.Capacitor;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  window.FRESHAF_NATIVE = isNative;
  if (!isNative) return; // the website carries on exactly as before

  // Where the real API lives. The app is a client of the live service.
  window.FRESHAF_API_BASE = 'https://freshaf.io';

  var TOKEN_KEY = 'freshaf_token';
  var Preferences = cap.Plugins && cap.Plugins.Preferences;

  // Held in memory once read, because api() is called on paths where awaiting native
  // storage on every request would add latency to every screen.
  var token = null;

  window.FreshAFNative = {
    getToken: function () { return token; },
    setToken: function (t) {
      token = t || null;
      if (!Preferences) return Promise.resolve();
      return t ? Preferences.set({ key: TOKEN_KEY, value: t })
               : Preferences.remove({ key: TOKEN_KEY });
    },
    loadToken: function () {
      if (!Preferences) return Promise.resolve(null);
      return Preferences.get({ key: TOKEN_KEY }).then(function (r) {
        token = (r && r.value) || null;
        return token;
      }).catch(function () { return null; });
    },
  };

  // Block the first render until the stored token is back, otherwise the app paints a
  // signed-out screen for a moment on every cold start and then swaps it for the real
  // one. That flash is small, constant, and reads as a bug.
  window.FRESHAF_READY = window.FreshAFNative.loadToken();

  // The site uses clean URLs — /terms, /privacy, /contact, /supplier — which Express
  // maps to .html files. Inside the app there is no Express: the pages are plain files
  // in the bundle, and /terms resolves to nothing. Every one of those links would be a
  // dead tap, which is exactly the sort of thing an App Store reviewer opens first.
  var CLEAN_URLS = ['supplier', 'terms', 'privacy', 'contact', 'delete-account'];
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var name = href.replace(/^\//, '');
    if (CLEAN_URLS.indexOf(name) === -1) return;
    e.preventDefault();
    window.location.href = name + '.html';
  }, true);

  // ---- native chrome -------------------------------------------------------
  function plugin(name) { return (cap.Plugins && cap.Plugins[name]) || null; }

  var StatusBar = plugin('StatusBar');
  if (StatusBar) {
    // The app is dark by default; a light status bar on a dark header is unreadable.
    try { StatusBar.setStyle({ style: 'DARK' }); } catch (e) { /* not fatal */ }
  }

  var SplashScreen = plugin('SplashScreen');
  if (SplashScreen) {
    // Hidden once the page is actually interactive, not on a timer, so a slow first
    // load never shows a half-drawn screen.
    window.addEventListener('load', function () {
      setTimeout(function () { try { SplashScreen.hide(); } catch (e) {} }, 120);
    });
  }

  // Android's hardware back button does nothing by default in a web view, which reads
  // as the app being broken. Close any open modal first, then go back, then exit.
  var App = plugin('App');
  if (App && App.addListener) {
    App.addListener('backButton', function (ev) {
      var openModal = document.querySelector('.modal-backdrop:not([hidden]), dialog[open]');
      if (openModal) {
        var close = openModal.querySelector('[data-close], .modal-close');
        if (close) { close.click(); return; }
      }
      if (ev && ev.canGoBack) { window.history.back(); return; }
      try { App.exitApp(); } catch (e) {}
    });
  }

  // A small tap response on primary actions. Cheap, and it is one of the things that
  // makes an app feel native rather than like a page.
  var Haptics = plugin('Haptics');
  if (Haptics) {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('button.btn, .btn-primary');
      if (btn && !btn.disabled) { try { Haptics.impact({ style: 'LIGHT' }); } catch (err) {} }
    }, true);
  }
})();
