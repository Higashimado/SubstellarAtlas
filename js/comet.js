/**
 * comet.js — Plots comet positions from Keplerian orbital elements: solves the
 * orbit (elliptical or near-parabolic Barker), converts to geocentric RA/Dec and
 * a sub-stellar map point, and draws each comet's symbol, label, and info popup.
 */
const Comet = (() => {
  const _t =
    typeof I18n !== 'undefined'
      ? I18n.t.bind(I18n)
      : function (k) {
          return k;
        };
  // ` data-gloss="…"` attribute for a term label (shared themed glossary tooltip).
  const _glossAttr =
    typeof I18n !== 'undefined'
      ? I18n.glossAttr.bind(I18n)
      : function () {
          return '';
        };
  const DEG = Math.PI / 180;
  const AU_KM = 149597870.7;
  const COPY_OFFSETS = [-360, 0, 360];

  let _map = null;
  let _layer = null;
  let _comets = [];
  let _markers = [];
  let _unsub = false;

  let _popup = null;
  let _popupBuilder = null;
  let _popupComet = null; // comet whose popup is open (for time-driven refresh)
  let _popupOffset = 0; // world-wrap copy the popup was opened in (× 360°)

  function jdFromDate(d) {
    return d.getTime() / 86400000 + 2440587.5;
  }

  // Solve Kepler's equation for eccentric anomaly
  function solveKepler(M, e, tol) {
    tol = tol || 1e-8;
    let E = M;
    for (let i = 0; i < 50; i++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < tol) break;
    }
    return E;
  }

  // For near-parabolic orbits (e close to 1), use parabolic approximation
  function solveBarker(q, tp_jd, jd) {
    const k = 0.01720209895; // Gaussian gravitational constant
    const dt = jd - tp_jd;
    const W = (3 * k * dt) / (Math.sqrt(2) * q * Math.sqrt(q));
    const Y = Math.cbrt(W + Math.sqrt(W * W + 1));
    const tanV2 = Y - 1 / Y;
    const v = 2 * Math.atan(tanV2);
    const r = q * (1 + tanV2 * tanV2);
    return { r, v };
  }

  // Compute heliocentric ecliptic rectangular coordinates
  function cometPosition(c, jd) {
    const e = c.e;
    const q = c.q;
    const i = c.i * DEG;
    const node = c.node * DEG;
    const peri = c.peri * DEG;

    let r, v;
    if (e > 0.98) {
      // Near-parabolic
      const result = solveBarker(q, c.tp_jd, jd);
      r = result.r;
      v = result.v;
    } else {
      // Elliptical
      const a = q / (1 - e);
      const n = 0.01720209895 / (a * Math.sqrt(a)); // mean motion (rad/day)
      const M = n * (jd - c.tp_jd);
      const E = solveKepler(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), e);
      v = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
      r = a * (1 - e * Math.cos(E));
    }

    // Heliocentric ecliptic
    const cosV = Math.cos(v + peri);
    const sinV = Math.sin(v + peri);
    const cosN = Math.cos(node);
    const sinN = Math.sin(node);
    const cosI = Math.cos(i);
    const sinI = Math.sin(i);

    const x = r * (cosN * cosV - sinN * sinV * cosI);
    const y = r * (sinN * cosV + cosN * sinV * cosI);
    const z = r * (sinV * sinI);

    return { x, y, z, r };
  }

  // Earth position (simplified - use Astronomy Engine if available)
  function earthPosition(jd) {
    if (typeof Astronomy !== 'undefined') {
      const time = Astronomy.MakeTime(new Date((jd - 2440587.5) * 86400000));
      const earth = Astronomy.HelioVector('Earth', time);
      return { x: earth.x, y: earth.y, z: earth.z };
    }
    // Rough approximation
    const T = (jd - 2451545.0) / 365.25;
    const L = (280.46 + 360.9856474 * (jd - 2451545.0)) * DEG;
    return { x: -Math.cos(L), y: -Math.sin(L), z: 0 };
  }

  // Geocentric equatorial RA/Dec from heliocentric ecliptic
  function toRaDec(hx, hy, hz, earth) {
    const gx = hx - earth.x;
    const gy = hy - earth.y;
    const gz = hz - earth.z;

    // Ecliptic to equatorial (obliquity ~23.4393°)
    const eps = 23.4393 * DEG;
    const eqX = gx;
    const eqY = gy * Math.cos(eps) - gz * Math.sin(eps);
    const eqZ = gy * Math.sin(eps) + gz * Math.cos(eps);

    const ra = (Math.atan2(eqY, eqX) / DEG + 360) % 360;
    const dec = Math.atan2(eqZ, Math.sqrt(eqX * eqX + eqY * eqY)) / DEG;
    const dist = Math.sqrt(gx * gx + gy * gy + gz * gz);

    return { ra, dec, dist };
  }

  // Apparent magnitude
  function apparentMag(c, r, dist) {
    return c.h + 5 * Math.log10(dist) + c.g * 2.5 * Math.log10(r);
  }

  // Full propagated state of a comet at a given date.
  function _computeState(c, date) {
    const jd = jdFromDate(date);
    const earth = earthPosition(jd);
    const pos = cometPosition(c, jd);
    const rd = toRaDec(pos.x, pos.y, pos.z, earth);
    const mag = apparentMag(c, pos.r, rd.dist);
    return { pos, rd, mag };
  }

  function _buildPopupHTML(c, st) {
    const { rd, pos, mag } = st;
    const desig = c.designation ? '<div class="star-ids">' + c.designation + '</div>' : '';
    const skyInfo = GeoUtils.buildSkyInfoHTML(rd.ra, rd.dec, TimeState.current, _t);
    return (
      '<div class="star-panel">' +
      '<h2 class="star-name">☄ ' +
      c.name +
      '</h2>' +
      desig +
      '<div class="star-scroll">' +
      '<div class="info-block">' +
      '<div class="info-block-title">' +
      _t('sky.object_data') +
      '</div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('ra') +
      '>' +
      _t('star.ra') +
      '</span><span class="value">' +
      GeoUtils.fmtRA(rd.ra) +
      '</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('dec') +
      '>' +
      _t('star.dec') +
      '</span><span class="value">' +
      GeoUtils.fmtDec(rd.dec) +
      '</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('magnitude') +
      '>' +
      _t('comet.magnitude') +
      '</span><span class="value">' +
      mag.toFixed(1) +
      '</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('geo_distance') +
      '>' +
      _t('comet.distance') +
      '</span><span class="value">' +
      rd.dist.toFixed(2) +
      ' AU</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('helio_distance') +
      '>' +
      _t('comet.helio_dist') +
      '</span><span class="value">' +
      pos.r.toFixed(2) +
      ' AU</span></div>' +
      '</div>' +
      skyInfo +
      '</div>' +
      GeoUtils.cardCredits([
        { name: 'JPL Small-Body Database', url: 'https://ssd.jpl.nasa.gov/' },
        { name: 'MPC', url: 'https://www.minorplanetcenter.net/' },
      ]) +
      '</div>'
    );
  }

  // Public: sub-stellar point {lat,lng} of comet `c` at `date` (null if uncomputable).
  function locate(c, date) {
    try {
      const st = _computeState(c, date);
      return GeoUtils.subStellarPoint(st.rd.ra, st.rd.dec, date);
    } catch (e) {
      return null;
    }
  }

  // Public: open the comet info popup at `latlng` (used by search).
  function showSearchPopup(c, date, latlng, map) {
    const m = map || _map;
    if (!m) return;
    // Recompute state on every call so a later time change refreshes the popup.
    _popupComet = c;
    const ll = L.latLng(latlng);
    const base = locate(c, TimeState.current);
    _popupOffset = base ? Math.round((ll.lng - base.lng) / 360) * 360 : 0;
    _popupBuilder = function () {
      return _buildPopupHTML(c, _computeState(c, TimeState.current));
    };
    if (!_popup) {
      _popup = L.popup({
        className: 'sky-star-popup',
        maxWidth: 250,
        offset: [0, -6],
        closeButton: true,
        autoPan: false,
      });
      _popup.on('remove', () => {
        _popupBuilder = null;
        _popupComet = null;
      });
    }
    _popup.setLatLng(latlng).setContent(_popupBuilder()).openOn(m);
  }

  // SVG icon from comet_v2.svg: path-based nucleus + 3-ray fan tail.
  // Nucleus at viewBox (3,9) → rendered pixel (4,12); iconAnchor must be [4,12].
  function _cometSvg(color) {
    var ns = 'http://www.w3.org/2000/svg';
    var sh = 'overflow:visible;filter:drop-shadow(0 0 2px rgba(0,0,0,0.9))';
    return (
      '<svg class="comet-sym" xmlns="' +
      ns +
      '" width="16" height="16" viewBox="0 0 12 12"' +
      ' style="' +
      sh +
      '">' +
      '<path d="M3.586 6.063 6.75 1m-.813 7.414L11 5.25M11 1 5.238 6.762M5 9c0-.552-.224-1.052-.586-1.414A1.999 1.999 0 0 0 1 9a1.999 1.999 0 1 0 4 0z"' +
      ' fill="none" stroke="' +
      color +
      '" stroke-width=".6" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="5.5"/>' +
      '</svg>'
    );
  }

  function _render(date) {
    if (!_layer || !_map) return;
    _layer.clearLayers();
    _markers = [];

    const jd = jdFromDate(date);
    const earth = earthPosition(jd);
    const gmst = typeof Sky !== 'undefined' && Sky.getMode ? null : null;

    // Compute GMST for substellar point
    const T = (jd - 2451545.0) / 36525;
    const gmstDeg =
      (280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000) % 360;

    for (const c of _comets) {
      try {
        const pos = cometPosition(c, jd);
        const rd = toRaDec(pos.x, pos.y, pos.z, earth);
        const mag = apparentMag(c, pos.r, rd.dist);

        if (mag > 12) continue; // too faint

        const lon = ((((rd.ra - gmstDeg) % 360) + 540) % 360) - 180;
        const lat = rd.dec;

        const color = mag < 6 ? '#00FF88' : mag < 8 ? '#88DDAA' : '#AABBCC';
        const label = c.name;

        for (const offset of COPY_OFFSETS) {
          // Symbol marker — interactive, click shows popup
          const symIcon = L.divIcon({
            className: 'comet-marker',
            html: _cometSvg(color),
            iconSize: [16, 16],
            iconAnchor: [4, 12],
          });
          const symM = L.marker([lat, lon + offset], {
            icon: symIcon,
            pane: 'sky-stars',
            interactive: true,
            bubblingMouseEvents: false,
          });
          symM.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            // Recompute state on every call so a later time change refreshes the
            // popup; remember the world copy it was opened in to slide it later.
            _popupComet = c;
            _popupOffset = offset;
            _popupBuilder = function () {
              return _buildPopupHTML(c, _computeState(c, TimeState.current));
            };
            if (!_popup) {
              _popup = L.popup({
                className: 'sky-star-popup',
                maxWidth: 250,
                offset: [0, -6],
                closeButton: true,
                autoPan: false,
              });
              _popup.on('remove', () => {
                _popupBuilder = null;
                _popupComet = null;
              });
            }
            _popup
              .setLatLng([lat, lon + offset])
              .setContent(_popupBuilder())
              .openOn(_map);
          });
          symM.on('contextmenu', (ev) => {
            L.DomEvent.stopPropagation(ev);
            if (ev.originalEvent) ev.originalEvent.preventDefault();
            if (window._showBodyContextMenu) {
              window._showBodyContextMenu(ev, () => {
                if (window.activateCelestialVis) window.activateCelestialVis(rd.ra, rd.dec);
              });
            } else if (window.activateCelestialVis) {
              window.activateCelestialVis(rd.ra, rd.dec);
            }
          });
          _layer.addLayer(symM);
          _markers.push(symM);

          // Label marker — non-interactive, participates in collision detection
          const lblIcon = L.divIcon({
            className: 'comet-label',
            html: label + ' (Mag. ' + mag.toFixed(1) + ')',
            iconSize: null,
            iconAnchor: [-12, 5],
          });
          const lblM = L.marker([lat, lon + offset], {
            icon: lblIcon,
            pane: 'sky-labels',
            interactive: false,
            keyboard: false,
          });
          _layer.addLayer(lblM);
          _markers.push(lblM);
        }
      } catch (e) {
        /* skip failed propagation */
      }
    }
  }

  function _onTimeChange() {
    if (!_map || !_layer || !_map.hasLayer(_layer)) return;
    _render(TimeState.current);
    // Keep an open comet popup in sync: refresh its time-dependent content and
    // slide it to the comet's new sub-stellar point, preserving the world copy.
    if (_popup && _popupBuilder && _popupComet && _map.hasLayer(_popup)) {
      const p = locate(_popupComet, TimeState.current);
      if (p) _popup.setLatLng([p.lat, p.lng + _popupOffset]);
      _popup.setContent(_popupBuilder());
    }
  }

  async function _loadData() {
    try {
      const resp = await fetch('data/comets/elements.json');
      if (!resp.ok) return;
      const data = await resp.json();
      _comets = Array.isArray(data) ? data : data.comets || [];
    } catch (e) {
      console.warn('[comet] load failed', e);
    }
  }

  function init(map) {
    _map = map;
    _layer = L.layerGroup();
  }

  async function addTo(map) {
    if (!_layer) init(map);
    _layer.addTo(map);
    if (!_comets.length) await _loadData();
    _render(TimeState.current);
    if (!_unsub && typeof TimeState !== 'undefined') {
      _unsub = true;
      TimeState.subscribe(_onTimeChange);
      if (typeof I18n !== 'undefined') {
        I18n.subscribe(() => {
          if (_popup && _popupBuilder && _map && _map.hasLayer(_popup)) {
            _popup.setContent(_popupBuilder());
          }
        });
      }
    }
  }

  function removeFrom(map) {
    if (_layer && map.hasLayer(_layer)) map.removeLayer(_layer);
  }

  function isOn() {
    return _map && _layer && _map.hasLayer(_layer);
  }

  async function toggle(map) {
    if (isOn()) {
      removeFrom(map);
    } else {
      await addTo(map);
    }
  }

  // Public: instantaneous geocentric equatorial coordinates (degrees).
  function computeRaDec(c, date) {
    try {
      const st = _computeState(c, date);
      return { ra: st.rd.ra, dec: st.rd.dec };
    } catch (e) {
      return null;
    }
  }

  return { init, addTo, removeFrom, isOn, toggle, locate, showSearchPopup, computeRaDec };
})();
