/**
 * asteroids.js — Plots numbered main-belt asteroids from Keplerian elements.
 *
 * Solves each elliptical orbit, converts to geocentric RA/Dec and a sub-stellar
 * map point, and draws a magnitude-scaled point + optional label + info popup on
 * the shared sky panes. The roster is the closed set of asteroids whose peak
 * opposition brightness rivals the star catalog's depth (data/asteroids/
 * elements.json, built by tools/build-asteroids.mjs); a body fades in and out at
 * the same zoom-adaptive magnitude cutoff as a star of equal brightness, so the
 * layer stays coherent with the surrounding sky.
 *
 * Brightness uses the IAU H–G phase system (not the comet total-magnitude law),
 * so a solar-phase dimming is applied on top of the inverse-square distance term.
 *
 * Data sources: JPL Small-Body Database / MPC (orbital elements, H, G).
 */
const Asteroids = (() => {
  const _t =
    typeof I18n !== 'undefined'
      ? I18n.t.bind(I18n)
      : function (k) {
          return k;
        };
  const _glossAttr =
    typeof I18n !== 'undefined'
      ? I18n.glossAttr.bind(I18n)
      : function () {
          return '';
        };
  const DEG = Math.PI / 180;
  const GAUSS_K = 0.01720209895; // Gaussian gravitational constant (rad/day)
  const AU_KM = 149597870.7;
  const COPY_OFFSETS = [-360, 0, 360];

  // Traditional astronomical symbols for the first four numbered asteroids
  // (Unicode Miscellaneous Symbols block U+26B3–26B6).
  const SYMBOLS = { 1: '⚳', 2: '⚴', 3: '⚵', 4: '⚶' };

  // Only the brightest asteroids get a standing label; below this the roster is
  // too dense to name without clutter (the point still shows and stays clickable).
  const LABEL_MAG_MAX = 8.5;

  // High-zoom engraving reveal for Ceres/Vesta/Pallas (num ∈ {1,2,4}). The disk
  // is sized off real apparent diameter through the planets' own footprint chain
  // (diamKm → ground-footprint km → footprintPx), so it tracks distance (larger
  // near opposition) and body size (Ceres > Vesta ≈ Pallas). Asteroid true disks
  // are sub-pixel (< 1″) at every map zoom, so a fixed magnification lifts them
  // into the visible range; the factor is held well below a planet disk so an
  // asteroid never outsizes a planet. Reveal is keyed to the resulting px (not
  // zoom), so a bright near body shows its disk before a faint far one — the same
  // size-driven emergence the planet disks use.
  const EARTH_R_KM = 6371.0;
  const AST_DISK_MAGNIFY = 26;
  const AST_REVEAL_FP_LO = 3; // px: disk begins to fade in
  const AST_REVEAL_FP_HI = 10; // px: dot fully retired, engraving solo

  let _map = null;
  let _layer = null;
  let _asteroids = [];
  let _markers = [];
  let _unsub = false;
  let _loadPromise = null;

  let _popup = null;
  let _popupBuilder = null;
  let _popupAst = null; // asteroid whose popup is open (for time-driven refresh)
  let _popupOffset = 0; // world-wrap copy the popup was opened in (× 360°)

  function jdFromDate(d) {
    return d.getTime() / 86400000 + 2440587.5;
  }

  // Solve Kepler's equation for the eccentric anomaly (Newton–Raphson).
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

  // Heliocentric ecliptic rectangular coordinates from mean-anomaly elements.
  function asteroidPosition(a, jd) {
    const e = a.e;
    const inc = a.i * DEG;
    const node = a.node * DEG;
    const peri = a.peri * DEG;

    const n = GAUSS_K / (a.a * Math.sqrt(a.a)); // mean motion (rad/day)
    const M = a.ma * DEG + n * (jd - a.epoch);
    const E = solveKepler(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), e);
    const v = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    const r = a.a * (1 - e * Math.cos(E));

    const cosV = Math.cos(v + peri);
    const sinV = Math.sin(v + peri);
    const cosN = Math.cos(node);
    const sinN = Math.sin(node);
    const cosI = Math.cos(inc);
    const sinI = Math.sin(inc);

    const x = r * (cosN * cosV - sinN * sinV * cosI);
    const y = r * (sinN * cosV + cosN * sinV * cosI);
    const z = r * (sinV * sinI);
    return { x, y, z, r };
  }

  // Earth heliocentric ecliptic position (Astronomy Engine when present).
  function earthPosition(jd) {
    if (typeof Astronomy !== 'undefined') {
      const time = Astronomy.MakeTime(new Date((jd - 2440587.5) * 86400000));
      const earth = Astronomy.HelioVector('Earth', time);
      return { x: earth.x, y: earth.y, z: earth.z };
    }
    const L = (280.46 + 360.9856474 * (jd - 2451545.0)) * DEG;
    return { x: -Math.cos(L), y: -Math.sin(L), z: 0 };
  }

  // Geocentric equatorial RA/Dec (degrees). The asteroid arrives in heliocentric
  // *ecliptic* coordinates (elements are ecliptic-referenced) while `earth` is the
  // *equatorial* J2000 vector from Astronomy.HelioVector, so the asteroid must be
  // rotated into the equatorial frame before differencing — mixing the two frames
  // (subtract-then-rotate) throws the position off by tens of degrees.
  function toRaDec(hx, hy, hz, earth) {
    const eps = 23.4393 * DEG;
    const axEq = hx;
    const ayEq = hy * Math.cos(eps) - hz * Math.sin(eps);
    const azEq = hy * Math.sin(eps) + hz * Math.cos(eps);
    const gx = axEq - earth.x;
    const gy = ayEq - earth.y;
    const gz = azEq - earth.z;
    const ra = (Math.atan2(gy, gx) / DEG + 360) % 360;
    const dec = Math.atan2(gz, Math.sqrt(gx * gx + gy * gy)) / DEG;
    const dist = Math.sqrt(gx * gx + gy * gy + gz * gz);
    return { ra, dec, dist };
  }

  // IAU H–G apparent visual magnitude. The phase term dims the body away from
  // opposition; alpha is the Sun–asteroid–Earth angle (radians).
  function apparentMag(a, r, delta, alpha) {
    const t = Math.tan(alpha / 2);
    const phi1 = Math.exp(-3.33 * Math.pow(t, 0.63));
    const phi2 = Math.exp(-1.87 * Math.pow(t, 1.22));
    const G = a.G;
    return a.H + 5 * Math.log10(r * delta) - 2.5 * Math.log10((1 - G) * phi1 + G * phi2);
  }

  // Full propagated state: heliocentric position, RA/Dec, phase angle, magnitude.
  // `earth` is optional: the per-frame batch render passes it once so 90+ bodies
  // don't each recompute the same (relatively costly) Earth vector.
  function _computeState(a, date, earth) {
    const jd = jdFromDate(date);
    if (!earth) earth = earthPosition(jd);
    const pos = asteroidPosition(a, jd);
    const rd = toRaDec(pos.x, pos.y, pos.z, earth);
    const R = Math.sqrt(earth.x * earth.x + earth.y * earth.y + earth.z * earth.z);
    // Law of cosines on the Sun–asteroid–Earth triangle for the phase angle.
    const cosAlpha = (pos.r * pos.r + rd.dist * rd.dist - R * R) / (2 * pos.r * rd.dist);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));
    const mag = apparentMag(a, pos.r, rd.dist, alpha);
    return { pos, rd, alpha, mag };
  }

  function _cutoff() {
    if (typeof Sky !== 'undefined' && Sky.starMagCutoff) {
      const c = Sky.starMagCutoff();
      if (Number.isFinite(c)) return c;
    }
    return 11.0;
  }

  function _buildPopupHTML(a, st) {
    const { rd, pos, mag, alpha } = st;
    const sym = SYMBOLS[a.num];
    const locKey = 'asteroid.name.' + a.num;
    const locName = _t(locKey);
    const displayName = locName !== locKey ? locName : a.name;
    const skyInfo = GeoUtils.buildSkyInfoHTML(rd.ra, rd.dec, TimeState.current, _t);
    let diamRow = '';
    if (a.diamKm) {
      const _arcsec = (a.diamKm / (rd.dist * AU_KM)) * 206265;
      diamRow =
        '<div class="info-row"><span class="label"' +
        _glossAttr('apparent_diameter') +
        '>' +
        _t('sky.angular_diam') +
        '</span><span class="value">' +
        _arcsec.toFixed(2) +
        '″</span></div>';
    }
    return (
      '<div class="star-panel">' +
      '<h2 class="star-name">' +
      (sym || '⬡') +
      ' ' +
      displayName +
      '</h2>' +
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
      '<div class="info-row"><span class="label"' +
      _glossAttr('phase_angle') +
      '>' +
      _t('sky.phase_angle') +
      '</span><span class="value">' +
      (alpha / DEG).toFixed(1) +
      '°</span></div>' +
      diamRow +
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

  // Radius (px) of the point marker for an apparent magnitude — mirrors the star
  // sprite's core size so an asteroid reads the same as a star of equal mag.
  function _pointRadius(mag) {
    if (typeof Lum !== 'undefined' && Lum.spriteRadii && Lum.zoomScale) {
      const scale = Lum.zoomScale(_map ? _map.getZoom() : 5);
      const sr = Lum.spriteRadii(mag, scale);
      return Math.max(0.8, sr.core);
    }
    return Math.max(0.8, 3.2 - 0.28 * mag);
  }

  // Sub-stellar point {lat,lng} of asteroid `a` at `date` (null if uncomputable).
  function locate(a, date) {
    try {
      const st = _computeState(a, date);
      return GeoUtils.subStellarPoint(st.rd.ra, st.rd.dec, date);
    } catch (e) {
      return null;
    }
  }

  function _openPopup(a, latlng, offset) {
    _popupAst = a;
    _popupOffset = offset;
    _popupBuilder = function () {
      return _buildPopupHTML(a, _computeState(a, TimeState.current));
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
        _popupAst = null;
      });
    }
    _popup.setLatLng(latlng).setContent(_popupBuilder()).openOn(_map);
  }

  // Open the info popup at `latlng` (used by celestial search).
  function showSearchPopup(a, date, latlng, map) {
    const m = map || _map;
    if (!m) return;
    const ll = L.latLng(latlng);
    const base = locate(a, TimeState.current);
    const offset = base ? Math.round((ll.lng - base.lng) / 360) * 360 : 0;
    _openPopup(a, latlng, offset);
  }

  function _render(date) {
    if (!_layer || !_map) return;
    _layer.clearLayers();
    _markers = [];

    const jd = jdFromDate(date);
    const earth = earthPosition(jd);
    const cutoff = _cutoff();

    // Sub-stellar longitude uses the same GMST reduction as the star field.
    const T = (jd - 2451545.0) / 36525;
    const gmstDeg =
      (280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000) % 360;

    const zoom = _map.getZoom();

    for (const a of _asteroids) {
      try {
        const st = _computeState(a, date, earth);
        if (st.mag > cutoff) continue; // fainter than the naked-eye/zoom limit

        const lon = ((((st.rd.ra - gmstDeg) % 360) + 540) % 360) - 180;
        const lat = st.rd.dec;
        const radius = _pointRadius(st.mag);
        const showLabel = st.mag <= LABEL_MAG_MAX;

        // Ceres/Vesta/Pallas get a high-zoom engraving icon crossfade.
        const isMain = a.num === 1 || a.num === 2 || a.num === 4;
        const hasEngraving =
          isMain && typeof Planets !== 'undefined' && typeof Planets.buildEngravingIconLOD === 'function';
        const astId = a.name.toLowerCase();
        // Ground footprint (km) subtended by the disk, then screen px via the
        // planets' chain, magnified into the visible range (see constants above).
        const fpKm = hasEngraving && a.diamKm ? (EARTH_R_KM * a.diamKm) / (st.rd.dist * AU_KM) : 0;
        const fpPx = fpKm ? Math.round(Lum.footprintPx(zoom, fpKm, lat) * AST_DISK_MAGNIFY) : 0;
        const reveal = fpPx ? Lum.smoothstep(AST_REVEAL_FP_LO, AST_REVEAL_FP_HI, fpPx) : 0;

        // Shared contextmenu handler so both dot and engraving marker behave identically.
        const onCtxMenu = (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (ev.originalEvent) ev.originalEvent.preventDefault();
          if (window._showBodyContextMenu) {
            // Trajectory is supported for the three main-belt bodies (Ceres/Vesta/Pallas).
            const extraItems = isMain
              ? [
                  {
                    label: _t('sky.menu.trajectory'),
                    onClick: () => {
                      if (typeof BodyTrajectory !== 'undefined') BodyTrajectory.toggle(astId);
                    },
                  },
                ]
              : [];
            window._showBodyContextMenu(
              ev,
              () => {
                if (window.activateCelestialVis) window.activateCelestialVis(st.rd.ra, st.rd.dec);
              },
              extraItems
            );
          } else if (window.activateCelestialVis) {
            window.activateCelestialVis(st.rd.ra, st.rd.dec);
          }
        };

        for (const offset of COPY_OFFSETS) {
          const latlng = [lat, lon + offset];

          // Dot: always rendered but fades out as the engraving icon fades in.
          const dot = L.circleMarker(latlng, {
            pane: 'sky-stars',
            radius,
            color: '#d8cfbf',
            weight: 0,
            fillColor: '#d8cfbf',
            fillOpacity: 0.95 * (1 - reveal),
            interactive: reveal < 0.99,
            bubblingMouseEvents: false,
          });

          dot.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            _openPopup(a, latlng, offset);
          });
          dot.on('contextmenu', onCtxMenu);
          _layer.addLayer(dot);
          _markers.push(dot);

          // Engraving icon: fades in as the apparent-diameter footprint grows.
          if (reveal > 0.01) {
            const { html, width, height } = Planets.buildEngravingIconLOD(astId, fpPx, reveal);
            const engIcon = L.divIcon({
              className: '',
              html,
              iconSize: [width, height],
              iconAnchor: [Math.round(width / 2), Math.round(height / 2)],
            });
            const engM = L.marker(latlng, {
              icon: engIcon,
              pane: 'sky-stars',
              interactive: true,
              keyboard: false,
              bubblingMouseEvents: false,
            });

            engM.on('click', (ev) => {
              L.DomEvent.stopPropagation(ev);
              _openPopup(a, latlng, offset);
            });
            engM.on('contextmenu', onCtxMenu);
            _layer.addLayer(engM);
            _markers.push(engM);
          }

          if (showLabel) {
            // Shift label right to clear the engraving icon when fully revealed.
            const labelOffX = -(8 + Math.round(reveal * fpPx * 0.5));
            const lblIcon = L.divIcon({
              className: 'asteroid-label',
              html: a.name,
              iconSize: null,
              iconAnchor: [labelOffX, 5],
            });
            const lblM = L.marker(latlng, {
              icon: lblIcon,
              pane: 'sky-labels',
              interactive: false,
              keyboard: false,
            });
            _layer.addLayer(lblM);
            _markers.push(lblM);
          }
        }
      } catch (e) {
        /* skip failed propagation */
      }
    }
  }

  function _onTimeChange() {
    if (!_map || !_layer || !_map.hasLayer(_layer)) return;
    _render(TimeState.current);
    if (_popup && _popupBuilder && _popupAst && _map.hasLayer(_popup)) {
      const p = locate(_popupAst, TimeState.current);
      if (p) _popup.setLatLng([p.lat, p.lng + _popupOffset]);
      _popup.setContent(_popupBuilder());
    }
  }

  function _onZoom() {
    // Visibility (and point size) tracks the zoom-adaptive cutoff, so redraw.
    if (_map && _layer && _map.hasLayer(_layer)) _render(TimeState.current);
  }

  async function _loadData() {
    try {
      const resp = await fetch('data/asteroids/elements.json');
      if (!resp.ok) return;
      const data = await resp.json();
      _asteroids = Array.isArray(data) ? data : data.asteroids || [];
    } catch (e) {
      console.warn('[asteroids] load failed', e);
    }
  }

  function _ensureLoaded() {
    if (!_loadPromise) _loadPromise = _loadData();
    return _loadPromise;
  }

  // Sub-stellar point {lat,lng} for a named asteroid (by `id` = name.toLowerCase()),
  // used by Planets.getSearchLatLng for trajectory sampling and event-card jumps.
  // Returns null if the element is not in the loaded roster.
  function subPointById(id, date) {
    const a = _asteroids.find((x) => x.name.toLowerCase() === id);
    if (!a) {
      _ensureLoaded();
      return null;
    }
    return locate(a, date);
  }

  function init(map) {
    _map = map;
    _layer = L.layerGroup();
  }

  async function addTo(map) {
    if (!_layer) init(map);
    _layer.addTo(map);
    if (!_asteroids.length) await _loadData();
    _render(TimeState.current);
    if (!_unsub && typeof TimeState !== 'undefined') {
      _unsub = true;
      TimeState.subscribe(_onTimeChange);
      _map.on('zoomend', _onZoom);
      if (typeof I18n !== 'undefined') {
        I18n.subscribe(() => {
          _render(TimeState.current);
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

  // Instantaneous geocentric equatorial coordinates (degrees), for search.
  function computeRaDec(a, date) {
    try {
      const st = _computeState(a, date);
      return { ra: st.rd.ra, dec: st.rd.dec };
    } catch (e) {
      return null;
    }
  }

  // Whether the on-map dot/engraving for asteroid `id` actually paints at the
  // current instant and zoom: the layer must be shown AND the body must clear the
  // zoom-adaptive magnitude cutoff (the same gate _render applies per frame). The
  // body-trajectory overlay queries this to decide whether to draw a tick at the
  // anchor (current) date — normally suppressed so it never occludes the body's own
  // marker, but when no dot renders the ribbon would otherwise have no "you are here".
  function isDotVisible(id, date) {
    if (!isOn()) return false;
    const a = _asteroids.find((x) => x.name.toLowerCase() === id);
    if (!a) return false;
    try {
      return _computeState(a, date).mag <= _cutoff();
    } catch (e) {
      return false;
    }
  }

  return {
    init,
    addTo,
    removeFrom,
    isOn,
    toggle,
    locate,
    subPointById,
    showSearchPopup,
    computeRaDec,
    isDotVisible,
  };
})();
