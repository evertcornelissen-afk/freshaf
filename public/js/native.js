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
  var CLEAN_URLS = ['supplier', 'terms', 'privacy', 'contact', 'delete-account', 'reset-password'];
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

  // ---- push notifications ---------------------------------------------------
  // Permission is asked for only when the person taps "Enable job alerts", never at launch:
  // Apple's guidance, and a prompt with no context is the one people refuse. Nothing is
  // asked at all until the server confirms it can send to this platform.
  var Push = plugin('PushNotifications');
  var PUSH_OFF_KEY = 'freshaf_push_off';
  function localFlag(k) { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }
  function setLocalFlag(k, on) { try { on ? localStorage.setItem(k, '1') : localStorage.removeItem(k); } catch (e) {} }

  // ---- location permission (Settings screen and the pro's first-run setup) ----
  var Geo = plugin('Geolocation');
  window.FreshAFNative.location = {
    available: !!Geo,
    // 'granted' | 'denied' | 'prompt' | 'unavailable'
    status: function () {
      if (!Geo) return Promise.resolve('unavailable');
      return Geo.checkPermissions().then(function (p) {
        var s = (p && (p.location || p.coarseLocation)) || '';
        return s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'prompt';
      }).catch(function () { return 'unavailable'; });
    },
    request: function () {
      if (!Geo) return Promise.resolve('unavailable');
      return Geo.requestPermissions().then(function (p) {
        var s = (p && (p.location || p.coarseLocation)) || '';
        return s === 'granted' ? 'granted' : 'denied';
      }).catch(function () { return 'denied'; });
    },
  };

  // Opens this app's page in the phone's Settings (Android: App info), the only place a
  // permission that was refused can be switched back on. Native code in AppSettingsPlugin.
  var AppSettings = (cap.registerPlugin ? cap.registerPlugin('AppSettings') : plugin('AppSettings'));
  window.FreshAFNative.openPhoneSettings = function () {
    if (!AppSettings || !AppSettings.open) return Promise.resolve(false);
    return AppSettings.open().then(function () { return true; }).catch(function () { return false; });
  };
  var platform = cap.getPlatform ? cap.getPlatform() : '';
  var pushToken = null;
  var listening = false;

  function openFromNotification(url) {
    if (!url) return;
    // '/supplier?job=12' -> 'supplier.html?job=12': the page names map as for links,
    // and the query string survives so the notification opens the right job or order.
    var m = /^\/?([^?#]*)(.*)$/.exec(String(url));
    var name = m ? m[1] : '';
    var rest = m ? m[2] : '';
    window.location.href = (CLEAN_URLS.indexOf(name) !== -1 ? name + '.html' : 'index.html') + rest;
  }

  function listen() {
    if (listening || !Push) return;
    listening = true;
    Push.addListener('registration', function (t) {
      pushToken = t && t.value;
      if (!pushToken || typeof api !== 'function') return;
      api('/api/push/device', { method: 'POST', body: { platform: platform, token: pushToken } })
        .catch(function () { /* retried on next launch */ });
    });
    Push.addListener('registrationError', function () { pushToken = null; });
    Push.addListener('pushNotificationActionPerformed', function (a) {
      var data = (a && a.notification && a.notification.data) || {};
      openFromNotification(data.url);
    });
  }

  window.FreshAFNative.push = {
    available: !!Push && (platform === 'ios' || platform === 'android'),
    // 'granted' | 'denied' | 'prompt' | 'unavailable'
    status: function () {
      if (!this.available) return Promise.resolve('unavailable');
      return Push.checkPermissions().then(function (p) {
        return p.receive === 'granted' ? 'granted' : p.receive === 'denied' ? 'denied' : 'prompt';
      }).catch(function () { return 'unavailable'; });
    },
    // ask=false only refreshes an existing grant (on every launch, so the token stays current).
    // Returns 'off' when the person switched alerts off in Settings: the phone permission
    // may still be granted, but this phone is not registered until they switch it back on.
    enable: function (ask) {
      var self = this;
      if (!self.available) return Promise.resolve('unavailable');
      if (!ask && localFlag(PUSH_OFF_KEY)) return Promise.resolve('off');
      if (ask) setLocalFlag(PUSH_OFF_KEY, false);
      return fetch(window.FRESHAF_API_BASE + '/api/push/native-config')
        .then(function (r) { return r.json(); })
        .then(function (cfg) {
          if (!cfg || !cfg[platform]) return 'unavailable';
          return self.status().then(function (st) {
            if (st === 'granted') return 'granted';
            if (st === 'denied' || !ask) return st;
            return Push.requestPermissions().then(function (p) { return p.receive === 'granted' ? 'granted' : 'denied'; });
          }).then(function (st) {
            if (st === 'granted') { listen(); Push.register(); }
            return st;
          });
        })
        .catch(function () { return 'unavailable'; });
    },
    // Settings > Job alerts off: unlink this phone and drop its push token, and remember
    // the choice so the next launch does not quietly register it again.
    disable: function () {
      setLocalFlag(PUSH_OFF_KEY, true);
      var done = this.forget();
      try { if (Push && Push.unregister) Push.unregister().catch(function () {}); } catch (e) {}
      return done;
    },
    isOff: function () { return localFlag(PUSH_OFF_KEY); },
    // Unlink this phone from the account before signing out.
    forget: function () {
      if (!pushToken || typeof api !== 'function') return Promise.resolve();
      var t = pushToken;
      pushToken = null;
      return api('/api/push/device/remove', { method: 'POST', body: { token: t } }).catch(function () {});
    },
  };
  // Taps on a notification that launched the app arrive before anything asks for push.
  listen();

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
