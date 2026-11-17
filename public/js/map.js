// FreshAF map. Light, like Google's default, and it moves like one: places are flown to
// rather than jumped to, the pin drops in, and "my location" is the pulsing blue dot with
// an accuracy ring that everyone already knows how to read.
//
// Shared by the customer app and FreshAF Pro so both behave the same. Loaded after
// Leaflet and before app.js / supplier.js.
//
// Two engines behind one interface (create / pin / flyTo / showMe / invalidateSize):
//
//   Google Maps  when the server hands out a browser key (/api/map-config google_key).
//                Required once addresses come from Google Places: Google's terms do not
//                allow Places or Routes results to be shown on a non-Google map.
//   Leaflet/OSM  when there is no key, the key is refused, or Google fails to load, so
//                the map is never blank and a booking can always be placed.
//
// The engine is decided by the server, so switching needs no new app build.
(function () {
  'use strict';

  const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let mapConfig = null;
  function loadMapConfig() {
    if (!mapConfig) {
      const url = typeof window.apiUrl === 'function' ? window.apiUrl('/api/map-config') : '/api/map-config';
      const fetched = fetch(url, { credentials: 'omit' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      // A slow answer must not leave a blank box: after 4 s, go with the free map.
      mapConfig = Promise.race([fetched, new Promise((r) => setTimeout(() => r({}), 4000))]);
    }
    return mapConfig;
  }

  /* ---------- Google loader ---------- */
  let googleLoad = null;
  let googleRefused = false;
  const liveMaps = new Set();

  function loadGoogle(key) {
    if (googleRefused) return Promise.reject(new Error('refused'));
    if (window.google && window.google.maps && window.google.maps.Map) return Promise.resolve();
    if (googleLoad) return googleLoad;
    googleLoad = new Promise((resolve, reject) => {
      window.__fmGoogleReady = () => resolve();
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key)
        + '&v=weekly&loading=async&region=ZA&language=en&callback=__fmGoogleReady';
      s.async = true;
      s.onerror = () => reject(new Error('Google Maps did not load'));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('Google Maps timed out')), 10000);
    });
    googleLoad.catch(() => { googleLoad = null; });
    return googleLoad;
  }

  // Google calls this when it rejects the key (wrong referrer, API not enabled, billing
  // off). Without it the customer would stare at a grey "can't load Google Maps" box.
  window.gm_authFailure = function () {
    googleRefused = true;
    console.warn('[FreshAF] Google refused the Maps key; using the OpenStreetMap map instead.');
    liveMaps.forEach((m) => m.fallBack());
  };

  /* ---------- markers (same look on both engines) ---------- */
  // Google's pin: a red teardrop with a dark core and a soft ground shadow.
  const PIN_SVG = '<svg viewBox="0 0 28 40" width="28" height="40" aria-hidden="true">'
    + '<path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 40 14 40s14-15.7 14-26.1C28 6.2 21.7 0 14 0z" fill="#EA4335"/>'
    + '<path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 40 14 40s14-15.7 14-26.1C28 6.2 21.7 0 14 0z" fill="none" stroke="#B31412" stroke-width="1"/>'
    + '<circle cx="14" cy="14" r="5" fill="#B31412"/></svg>';
  const pinHtml = (dropping) => `<div class="fm-pin${dropping ? ' fm-drop' : ''}">${PIN_SVG}</div>`
    + `<div class="fm-pin-shadow${dropping ? ' fm-drop-shadow' : ''}"></div>`;
  const ME_HTML = '<div class="fm-me"><span class="fm-me-pulse"></span><span class="fm-me-dot"></span></div>';
  const ringRadius = (accuracy) => Math.min(Math.max(Number(accuracy) || 0, 10), 1500);

  /* ---------- Leaflet engine ---------- */
  function leafletEngine(el, view, onPick) {
    const m = L.map(el, {
      zoomSnap: 0.25,             // fractional zoom, so flights and pinches end where they should
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,    // smoother scroll-wheel zoom than Leaflet's stepped default
      inertia: true,
      inertiaDeceleration: 2400,  // a flick glides and settles instead of stopping dead
      worldCopyJump: true,
    }).setView(view.center, view.zoom);

    let tiles = L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, className: 'fm-tiles' }).addTo(m);
    loadMapConfig().then((c) => {
      if (!c || !c.tiles || c.tiles === TILES) return;
      const next = L.tileLayer(c.tiles, { attribution: c.attribution || ATTRIBUTION, maxZoom: 19, className: 'fm-tiles' });
      next.addTo(m);
      m.removeLayer(tiles);
      tiles = next;
    });
    if (onPick) m.on('click', (e) => onPick(e.latlng.lat, e.latlng.lng));

    const icon = (html, size, anchor, cls) => L.divIcon({ className: cls, html, iconSize: size, iconAnchor: anchor });
    let pin = null, me = null, ring = null;
    return {
      leaflet: m,
      center: () => { const c = m.getCenter(); return [c.lat, c.lng]; },
      zoom: () => m.getZoom(),
      invalidateSize: () => m.invalidateSize(),
      pin(lat, lng, drop) {
        const i = icon(pinHtml(drop), [28, 40], [14, 40], 'fm-pin-wrap');
        if (!pin) pin = L.marker([lat, lng], { icon: i, keyboard: false }).addTo(m);
        else { pin.setLatLng([lat, lng]); pin.setIcon(i); }
      },
      flyTo(lat, lng, z) {
        const target = z ?? Math.max(m.getZoom(), 15);
        if (still()) { m.setView([lat, lng], target); return; }
        const far = m.distance(m.getCenter(), [lat, lng]) > 3000 || Math.abs(m.getZoom() - target) > 1;
        if (far) m.flyTo([lat, lng], target, { duration: 1.1, easeLinearity: 0.15 });
        else m.panTo([lat, lng], { animate: true, duration: 0.5, easeLinearity: 0.2 });
      },
      showMe(lat, lng, accuracy) {
        if (!me) {
          me = L.marker([lat, lng], { icon: icon(ME_HTML, [22, 22], [11, 11], 'fm-me-wrap'),
            keyboard: false, interactive: false, zIndexOffset: -100 }).addTo(m);
        } else me.setLatLng([lat, lng]);
        if (!ring) {
          ring = L.circle([lat, lng], { radius: ringRadius(accuracy), color: '#4285F4', weight: 1, opacity: 0.35,
            fillColor: '#4285F4', fillOpacity: 0.12, interactive: false }).addTo(m);
        } else ring.setLatLng([lat, lng]).setRadius(ringRadius(accuracy));
      },
      destroy: () => m.remove(),
    };
  }

  /* ---------- Google engine ---------- */
  function googleEngine(el, view, onPick) {
    const g = window.google.maps;
    const m = new g.Map(el, {
      center: { lat: view.center[0], lng: view.center[1] },
      zoom: Math.round(view.zoom),
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,      // a tap on a shop icon should move the pin, not open a card
      gestureHandling: 'greedy',  // one-finger drag, as the map has always behaved here
      keyboardShortcuts: false,
    });
    if (onPick) m.addListener('click', (e) => onPick(e.latLng.lat(), e.latLng.lng()));

    // Our own HTML markers, so the pin and blue dot look and animate exactly as before
    // and no Map ID is needed (the newer AdvancedMarker requires one).
    class HtmlMarker extends g.OverlayView {
      constructor(html, ax, ay, pane) {
        super();
        this.html = html; this.ax = ax; this.ay = ay; this.paneName = pane; this.pos = null;
        this.div = document.createElement('div');
        this.div.style.position = 'absolute';
        this.div.innerHTML = html;
      }
      onAdd() { this.getPanes()[this.paneName].appendChild(this.div); }
      draw() {
        const proj = this.getProjection();
        if (!proj || !this.pos) return;
        const p = proj.fromLatLngToDivPixel(this.pos);
        this.div.style.left = (p.x - this.ax) + 'px';
        this.div.style.top = (p.y - this.ay) + 'px';
      }
      onRemove() { this.div.remove(); }
      moveTo(lat, lng) { this.pos = new g.LatLng(lat, lng); this.draw(); }
      setHtml(html) { this.div.innerHTML = html; }
    }

    let pin = null, me = null, ring = null;
    return {
      leaflet: null,
      center: () => { const c = m.getCenter(); return [c.lat(), c.lng()]; },
      zoom: () => m.getZoom(),
      invalidateSize: () => {}, // Google watches its own container size
      pin(lat, lng, drop) {
        if (!pin) { pin = new HtmlMarker(pinHtml(drop), 14, 40, 'markerLayer'); pin.moveTo(lat, lng); pin.setMap(m); }
        else { pin.setHtml(pinHtml(drop)); pin.moveTo(lat, lng); }
      },
      flyTo(lat, lng, z) {
        const target = Math.round(z ?? Math.max(m.getZoom(), 15));
        const to = { lat, lng };
        if (still()) { m.setCenter(to); m.setZoom(target); return; }
        if (m.getZoom() !== target) m.setZoom(target);
        m.panTo(to); // animated when the hop is short, a clean jump when it is not
      },
      showMe(lat, lng, accuracy) {
        if (!me) { me = new HtmlMarker(ME_HTML, 11, 11, 'overlayLayer'); me.moveTo(lat, lng); me.setMap(m); }
        else me.moveTo(lat, lng);
        if (!ring) {
          ring = new g.Circle({ map: m, center: { lat, lng }, radius: ringRadius(accuracy), clickable: false,
            strokeColor: '#4285F4', strokeOpacity: 0.35, strokeWeight: 1, fillColor: '#4285F4', fillOpacity: 0.12 });
        } else { ring.setCenter({ lat, lng }); ring.setRadius(ringRadius(accuracy)); }
      },
      destroy: () => { g.event.clearInstanceListeners(m); },
    };
  }

  /* ---------- the map callers use ---------- */
  // Returned straight away; the engine arrives a moment later. Calls made before then are
  // remembered as state (view, pin, blue dot) and applied the moment it exists, so the
  // pages need no changes and a switch of engine keeps the pin where it was.
  function create(elementId, center, zoom, onPick) {
    const host = document.getElementById(elementId);
    const state = { center, zoom, pin: null, me: null };
    let engine = null;
    let inner = null;

    function mount(kind) {
      if (engine) {
        try { state.center = engine.center(); state.zoom = engine.zoom(); } catch (e) { /* keep last */ }
        try { engine.destroy(); } catch (e) { /* already gone */ }
      }
      if (inner) inner.remove();
      inner = document.createElement('div');
      inner.className = 'fm-engine fm-engine-' + kind;
      inner.style.cssText = 'position:absolute;inset:0;';
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(inner);
      engine = (kind === 'google' ? googleEngine : leafletEngine)(inner, state, onPick);
      api.engine = kind;
      api.leaflet = engine.leaflet;
      if (state.pin) engine.pin(state.pin[0], state.pin[1], false);
      if (state.me) engine.showMe(state.me[0], state.me[1], state.me[2]);
    }

    const api = {
      engine: null,
      leaflet: null,
      invalidateSize() { if (engine) engine.invalidateSize(); },
      // Drop (or re-drop) the pin. Moving it replays the drop, so the change is noticed.
      pin(lat, lng) {
        state.pin = [lat, lng];
        state.center = [lat, lng];
        if (engine) engine.pin(lat, lng, !still());
      },
      // Glide to a place. Short hops pan, longer ones zoom out and back in.
      flyTo(lat, lng, z) {
        state.center = [lat, lng];
        if (z != null) state.zoom = z;
        if (engine) engine.flyTo(lat, lng, z);
      },
      // The blue dot, with a ring showing how sure the phone is about it.
      showMe(lat, lng, accuracy) {
        state.me = [lat, lng, accuracy];
        if (engine) engine.showMe(lat, lng, accuracy);
      },
      fallBack() { if (api.engine !== 'leaflet') mount('leaflet'); },
    };
    liveMaps.add(api);

    loadMapConfig().then((c) => {
      if (!c || !c.google_key || googleRefused) { mount('leaflet'); return; }
      loadGoogle(c.google_key)
        .then(() => { if (!googleRefused) mount('google'); else mount('leaflet'); })
        .catch((e) => { console.warn('[FreshAF] ' + e.message + '; using the OpenStreetMap map.'); mount('leaflet'); });
    });
    return api;
  }

  window.FreshMap = { create };
})();
