// FreshAF map. Light, like Google's default, and it moves like one: places are flown to
// rather than jumped to, the pin drops in, and "my location" is the pulsing blue dot with
// an accuracy ring that everyone already knows how to read.
//
// Shared by the customer app and FreshAF Pro so both behave the same. Loaded after
// Leaflet and before app.js / supplier.js.
(function () {
  'use strict';

  const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Google's pin: a red teardrop with a dark core and a soft ground shadow.
  const PIN_SVG = '<svg viewBox="0 0 28 40" width="28" height="40" aria-hidden="true">'
    + '<path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 40 14 40s14-15.7 14-26.1C28 6.2 21.7 0 14 0z" fill="#EA4335"/>'
    + '<path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 40 14 40s14-15.7 14-26.1C28 6.2 21.7 0 14 0z" fill="none" stroke="#B31412" stroke-width="1"/>'
    + '<circle cx="14" cy="14" r="5" fill="#B31412"/></svg>';

  function pinIcon(dropping) {
    return L.divIcon({
      className: 'fm-pin-wrap',
      html: `<div class="fm-pin${dropping ? ' fm-drop' : ''}">${PIN_SVG}</div><div class="fm-pin-shadow${dropping ? ' fm-drop-shadow' : ''}"></div>`,
      iconSize: [28, 40],
      iconAnchor: [14, 40],
    });
  }

  const ME_ICON = L.divIcon({
    className: 'fm-me-wrap',
    html: '<div class="fm-me"><span class="fm-me-pulse"></span><span class="fm-me-dot"></span></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

  function create(elementId, center, zoom, onPick) {
    const m = L.map(elementId, {
      zoomSnap: 0.25,             // fractional zoom, so flights and pinches end where they should
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,    // smoother scroll-wheel zoom than Leaflet's stepped default
      inertia: true,
      inertiaDeceleration: 2400,  // a flick glides and settles instead of stopping dead
      worldCopyJump: true,
    }).setView(center, zoom);

    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, className: 'fm-tiles' }).addTo(m);

    let pin = null;
    let me = null;
    let meRing = null;

    if (onPick) m.on('click', (e) => onPick(e.latlng.lat, e.latlng.lng));

    const api = {
      leaflet: m,
      invalidateSize: () => m.invalidateSize(),

      // Drop (or re-drop) the pin. Moving it replays the drop, so the change is noticed.
      pin(lat, lng) {
        const drop = !still();
        if (!pin) {
          pin = L.marker([lat, lng], { icon: pinIcon(drop), keyboard: false }).addTo(m);
        } else {
          pin.setLatLng([lat, lng]);
          pin.setIcon(pinIcon(drop));
        }
      },

      // Glide to a place. Short hops pan, longer ones zoom out and back in, as Google does.
      flyTo(lat, lng, z) {
        const target = z ?? Math.max(m.getZoom(), 15);
        if (still()) { m.setView([lat, lng], target); return; }
        const far = m.distance(m.getCenter(), [lat, lng]) > 3000 || Math.abs(m.getZoom() - target) > 1;
        if (far) m.flyTo([lat, lng], target, { duration: 1.1, easeLinearity: 0.15 });
        else m.panTo([lat, lng], { animate: true, duration: 0.5, easeLinearity: 0.2 });
      },

      // The blue dot, with a ring showing how sure the phone is about it.
      showMe(lat, lng, accuracy) {
        if (!me) {
          me = L.marker([lat, lng], { icon: ME_ICON, keyboard: false, interactive: false, zIndexOffset: -100 }).addTo(m);
        } else {
          me.setLatLng([lat, lng]);
        }
        const r = Math.min(Math.max(Number(accuracy) || 0, 10), 1500);
        if (!meRing) {
          meRing = L.circle([lat, lng], { radius: r, color: '#4285F4', weight: 1, opacity: 0.35,
            fillColor: '#4285F4', fillOpacity: 0.12, interactive: false }).addTo(m);
        } else {
          meRing.setLatLng([lat, lng]).setRadius(r);
        }
      },
    };
    return api;
  }

  window.FreshMap = { create };
})();
