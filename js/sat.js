/**
 * sat.js — Ground tracks for a curated set of bright satellites (ISS, CSS, HST):
 * fetches TLEs from CelesTrak, propagates with SGP4, and draws each track,
 * footprint, and live marker, plus today's visible passes for the sidebar.
 */
const Sat = (() => {
  const GROUPS = [
    {
      key: 'stations',
      url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
      label: 'Space Stations',
    },
    { key: 'visual', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle', label: 'Brightest' },
  ];
  // Curated notable satellites (NORAD id -> {label, type}). Only these are kept;
  // every other object in the fetched groups is discarded. `type` drives the
  // info-card title. Extend by adding a line (+ a data source group if needed).
  // `aliases` are extra search terms (full names / translations) so the search
  // box can find a satellite by more than its short label.
  const NOTABLE = {
    25544: {
      label: 'ISS',
      type: 'station',
      aliases: ['International Space Station', 'Zarya', '国际空间站', '國際太空站'],
    }, // (stations)
    48274: { label: 'CSS', type: 'station', aliases: ['Tiangong', 'Tianhe', '天宫', '天宮', 'Chinese Space Station'] }, // Tiangong core module (stations)
    20580: { label: 'HST', type: 'telescope', aliases: ['Hubble', 'Hubble Space Telescope', '哈勃', '哈伯'] }, // Hubble Space Telescope (visual)
  };

  const CACHE_TTL = 6 * 3600 * 1000;
  const TLE_FRESH_DAYS = 7; // SGP4 trust window: epoch ± this many days
  const TLE_FRESH_MS = TLE_FRESH_DAYS * 86400000;

  const TRACK_STEPS = 360;
  const TRACK_STEP_SEC = 15;

  const RAD2DEG = 180 / Math.PI;
  const DEG2RAD = Math.PI / 180;
  const EARTH_R = 6371;

  // Colour semantics: grey(locked) > gold(reflection window) > verdigris(default);
  // hover emphasis is layered on top of whichever base colour applies.
  const COLOR_DEFAULT = '#5BAA9E'; // verdigris teal — normal/secondary (off-blue, pairs with gold)
  const COLOR_LIT = '#FFD700'; // gold — sunlight-reflection visibility window
  const COLOR_LOCKED = '#888888'; // grey — out of TLE trust window

  const GROUND_DARK_DEG = -6; // ground "dark enough" = civil twilight
  const BASE_WEIGHT = 1.8;

  // Satellite glyph (reuses the layer-button SVG_SAT three-rectangle shape);
  // stroke=currentColor so CSS state classes recolour it.
  const SAT_ICON_SVG =
    '<span class="sat-ico">' +
    '<svg viewBox="0 0 40 40" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3">' +
    '<g transform="rotate(35 20 20)">' +
    '<rect x="3" y="19" width="10" height="12" rx="1"/>' +
    '<rect x="27" y="19" width="10" height="12" rx="1"/>' +
    '<rect x="14" y="11" width="12" height="28" rx="1"/>' +
    '</g></svg></span>';

  let _map = null;
  let _pane = null;
  let _layer = null;
  let _satrecs = [];
  let _satGroups = {}; // noradId -> { lines, circles, markers, base styles }
  let _rafPending = false;
  let _unsub = null;
  let _loading = null; // in-flight _loadData() promise (concurrency guard)
  let _valid = true; // true when current time is inside every sat's window

  let _popup = null; // reused info-card popup
  let _popupEntry = null; // satellite whose card is open (for time-driven refresh)
  let _popupBuilder = null; // () => html for the open card at the current time
  let _popupOffset = 0; // world-wrap copy the card was opened in (× 360°)

  function _cacheKey(group) {
    return 'sat_omm_' + group;
  }

  function _t(key, vars) {
    if (typeof I18n !== 'undefined') return I18n.t(key, vars);
    return key;
  }

  function _parseTLE(text) {
    const lines = text
      .trim()
      .split('\n')
      .map((l) => l.trim());
    const entries = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const name = lines[i];
      const line1 = lines[i + 1];
      const line2 = lines[i + 2];
      if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
      try {
        const satrec = satellite.twoline2satrec(line1, line2);
        entries.push({ name, satrec, noradId: parseInt(line1.substring(2, 7)) });
      } catch (e) {
        /* skip bad TLE */
      }
    }
    return entries;
  }

  async function _fetchTLE(group) {
    const cached = localStorage.getItem(_cacheKey(group.key));
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.ts < CACHE_TTL) return _parseTLE(parsed.text);
      } catch (e) {
        /* ignore */
      }
    }
    try {
      const resp = await fetch(group.url);
      if (!resp.ok) return [];
      const text = await resp.text();
      localStorage.setItem(_cacheKey(group.key), JSON.stringify({ ts: Date.now(), text }));
      return _parseTLE(text);
    } catch (e) {
      console.warn('[sat] fetch failed for', group.key, e);
      return [];
    }
  }

  // TLE epoch as Unix ms (jdsatepoch is a Julian Day number).
  function _epochMs(satrec) {
    return (satrec.jdsatepoch - 2440587.5) * 86400000;
  }

  // Clamp the propagation instant to the satellite's TLE trust window (epoch ±
  // TLE_FRESH_DAYS); outside it, freeze at the nearest edge instead of
  // extrapolating into garbage.
  function _clampToWindow(date, satrec) {
    const t = date.getTime();
    const epoch = _epochMs(satrec);
    const lo = epoch - TLE_FRESH_MS;
    const hi = epoch + TLE_FRESH_MS;
    if (t < lo) return { eff: new Date(lo), locked: true };
    if (t > hi) return { eff: new Date(hi), locked: true };
    return { eff: date, locked: false };
  }

  function _propagate(satrec, date) {
    const posVel = satellite.propagate(satrec, date);
    if (!posVel.position) return null;
    const gmst = satellite.gstime(date);
    const geo = satellite.eciToGeodetic(posVel.position, gmst);
    return {
      lat: satellite.degreesLat(geo.latitude),
      lng: satellite.degreesLong(geo.longitude),
      alt: geo.height,
      posVel,
      gmst,
    };
  }

  // Sun altitude (deg) at a ground point, infinite-sun approximation (same
  // formula as GeoUtils.sunAltAtPoint but with the subsolar point hoisted out
  // so we compute it once per frame instead of once per track point).
  function _sunAltAt(lat, lng, ss) {
    if (!ss) return 90; // no subsolar info → treat as daylight (never "lit window")
    const sinAlt =
      Math.sin(lat * DEG2RAD) * Math.sin(ss.lat * DEG2RAD) +
      Math.cos(lat * DEG2RAD) * Math.cos(ss.lat * DEG2RAD) * Math.cos((lng - ss.lng) * DEG2RAD);
    return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD2DEG;
  }

  // Horizon-dip angle from satellite altitude: the sun must be no lower than
  // -thetaH at the sub-point for the satellite to still be sunlit.
  function _horizonDip(altKm) {
    return Math.acos(EARTH_R / (EARTH_R + altKm)) * RAD2DEG;
  }

  // Reflection-visibility window: ground dark (civil twilight) AND satellite
  // still above Earth's shadow (sunlit).
  function _inLitWindow(sunAlt, thetaH) {
    return sunAlt < GROUND_DARK_DEG && sunAlt > -thetaH;
  }

  // Ground track sampled around centerDate, each point tagged with its lit flag.
  function _groundTrack(satrec, centerDate, ss, thetaH) {
    const points = [];
    const halfSteps = Math.floor(TRACK_STEPS / 2);
    for (let i = -halfSteps; i <= halfSteps; i++) {
      const t = new Date(centerDate.getTime() + i * TRACK_STEP_SEC * 1000);
      const pos = _propagate(satrec, t);
      if (!pos) continue;
      const lit = _inLitWindow(_sunAltAt(pos.lat, pos.lng, ss), thetaH);
      points.push({ lat: pos.lat, lng: pos.lng, lit });
    }
    return points;
  }

  // Adjacent-point continuity unwrap: first point to [-180,180), every later
  // point takes the ±360 representative nearest its predecessor so the track
  // stays continuous across the antimeridian (mirrors eclipse.js addPolyline).
  function _unwrap(points) {
    let prev = null;
    return points.map((p) => {
      let lng = GeoUtils.normLng(p.lng);
      if (prev !== null) {
        while (lng - prev > 180) lng -= 360;
        while (lng - prev < -180) lng += 360;
      }
      prev = lng;
      return { lat: p.lat, lng, lit: p.lit };
    });
  }

  // Split the unwrapped track into coloured segments. Breaks occur at the
  // antimeridian (hard gap) and at lit-state changes (shared boundary vertex so
  // the gold/blue runs join visually). Returns [{ lit, pts:[[lat,lng],...] }].
  function _segmentTrack(points) {
    const segs = [];
    let cur = null;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (cur && cur.pts.length > 0) {
        const prev = cur.pts[cur.pts.length - 1];
        const dLng = Math.abs(p.lng - prev[1]);
        const polarBoth = Math.abs(p.lat) > 75 && Math.abs(prev[0]) > 75;
        const amBreak = dLng > 180 || (polarBoth && dLng > 60);
        if (amBreak) {
          if (cur.pts.length >= 2) segs.push(cur);
          cur = { lit: p.lit, pts: [] };
        } else if (p.lit !== cur.lit) {
          // Colour boundary: include p in both segments for a seamless join
          cur.pts.push([p.lat, p.lng]);
          if (cur.pts.length >= 2) segs.push(cur);
          cur = { lit: p.lit, pts: [[p.lat, p.lng]] };
          continue;
        }
      }
      if (!cur) cur = { lit: p.lit, pts: [] };
      cur.pts.push([p.lat, p.lng]);
    }
    if (cur && cur.pts.length >= 2) segs.push(cur);
    return segs;
  }

  // ---- Hover Emphasis ----
  function _emphasize(noradId, on) {
    const grp = _satGroups[noradId];
    if (!grp) return;
    for (const l of grp.lines) {
      l.setStyle({ weight: on ? BASE_WEIGHT + 1.6 : BASE_WEIGHT, opacity: on ? 1 : grp.lineOpacity });
    }
    for (const c of grp.circles) {
      c.setStyle({
        weight: on ? 2 : 1,
        opacity: on ? 0.6 : grp.circleOpacity,
        fillOpacity: on ? 0.12 : grp.circleFill,
      });
    }
    for (const m of grp.markers) {
      const el = m.getElement();
      if (el) el.classList.toggle('sat-hover', on);
    }
  }

  function _bindHover(layer, noradId) {
    layer.on('mouseover', () => _emphasize(noradId, true));
    layer.on('mouseout', () => _emphasize(noradId, false));
  }

  function _render(date) {
    if (!_layer || !_map) return;
    _layer.clearLayers();
    _satGroups = {};

    const ss = typeof window.getSubsolarLatLng === 'function' ? window.getSubsolarLatLng(date) : null;
    let anyLocked = false;

    for (const entry of _satrecs) {
      const { eff, locked } = _clampToWindow(date, entry.satrec);
      if (locked) anyLocked = true;

      const pos = _propagate(entry.satrec, eff);
      if (!pos) continue; // genuinely decayed / propagation failed → skip

      const thetaH = _horizonDip(pos.alt || 0);
      const curLit = _inLitWindow(_sunAltAt(pos.lat, pos.lng, ss), thetaH);
      const markerColorClass = locked ? 'sat-locked' : curLit ? 'sat-lit' : '';

      const lineOpacity = locked ? 0.45 : 0.9;
      const circleOpacity = locked ? 0.2 : 0.4;
      const circleFill = locked ? 0.03 : 0.07;

      const grp = (_satGroups[entry.noradId] = {
        lines: [],
        circles: [],
        markers: [],
        lineOpacity,
        circleOpacity,
        circleFill,
      });

      // Ground track: unwrap → segment by antimeridian + lit-state → draw
      const track = _unwrap(_groundTrack(entry.satrec, eff, ss, thetaH));
      for (const seg of _segmentTrack(track)) {
        const color = locked ? COLOR_LOCKED : seg.lit ? COLOR_LIT : COLOR_DEFAULT;
        let lo = Infinity,
          hi = -Infinity;
        for (const pt of seg.pts) {
          if (pt[1] < lo) lo = pt[1];
          if (pt[1] > hi) hi = pt[1];
        }
        if (!isFinite(lo)) continue;
        for (const off of GeoUtils.wrapOffsets(lo, hi)) {
          const shifted = off ? seg.pts.map((p) => [p[0], p[1] + off]) : seg.pts;
          // Visible track is non-interactive; a transparent fat casing carries the
          // hover so the comfortable band (not the ~1.8px stroke) triggers it. The
          // casing stays out of grp.lines so _emphasize never restyles it. Mirrors
          // the eclipse-curve hit-casing (HitWidths.MIN, js/hit-widths.js).
          const line = L.polyline(shifted, {
            color,
            weight: BASE_WEIGHT,
            opacity: lineOpacity,
            pane: 'sat',
            interactive: false,
          });
          line.addTo(_layer);
          grp.lines.push(line);
          const hit = L.polyline(shifted, {
            color,
            weight: HitWidths.MIN,
            opacity: 0,
            pane: 'sat',
            lineCap: 'round',
            lineJoin: 'round',
          });
          hit.addTo(_layer);
          _bindHover(hit, entry.noradId);
        }
      }

      // Current-position marker (+ wrap copies), clickable + hoverable
      const className = 'sat-marker' + (markerColorClass ? ' ' + markerColorClass : '');
      const html = SAT_ICON_SVG + '<span class="sat-label">' + entry.label + '</span>';
      for (const off of GeoUtils.wrapOffsets(pos.lng, pos.lng)) {
        const marker = L.marker([pos.lat, pos.lng + off], {
          icon: L.divIcon({ className, html, iconSize: [18, 18], iconAnchor: [9, 9] }),
          pane: 'sat',
          bubblingMouseEvents: false, // icon click shows card, never places observer
        });
        marker.on('click', (ev) => {
          if (ev.originalEvent) L.DomEvent.stop(ev.originalEvent);
          _showSatPopup(entry, eff, locked, marker.getLatLng());
        });
        _bindHover(marker, entry.noradId);
        marker.addTo(_layer);
        grp.markers.push(marker);
      }

      // Visibility footprint (+ wrap copies), coloured by current lit state
      if (pos.alt) {
        const footprintRadius = EARTH_R * Math.acos(EARTH_R / (EARTH_R + pos.alt)) * 1000;
        const color = locked ? COLOR_LOCKED : curLit ? COLOR_LIT : COLOR_DEFAULT;
        for (const off of GeoUtils.wrapOffsets(pos.lng, pos.lng)) {
          const circle = L.circle([pos.lat, pos.lng + off], {
            radius: footprintRadius,
            color,
            fillColor: color,
            fillOpacity: circleFill,
            weight: 1,
            opacity: circleOpacity,
            pane: 'sat',
          });
          circle.addTo(_layer);
          grp.circles.push(circle);
          _bindHover(circle, entry.noradId);
        }
      }
    }

    // Update validity (no satellite was clamped this frame) and refresh the
    // sidebar notice if the state flipped.
    const nv = !anyLocked;
    if (nv !== _valid) {
      _valid = nv;
      _refreshSidebar();
    }
  }

  // ---- Info Card ----
  function _infoRow(label, value) {
    return '<tr><td class="label">' + label + '</td><td class="value">' + value + '</td></tr>';
  }

  // Pure builder: the card's HTML for `entry` at `effDate`. Every field
  // (altitude, velocity, sub-point, observer az/el/range) is time-dependent, so
  // this is re-run on each time change to keep an open card live. Returns '' if
  // the satellite can't be propagated at this instant.
  function _buildSatPopupHTML(entry, effDate, locked) {
    const pos = _propagate(entry.satrec, effDate);
    if (!pos) return '';
    const sr = entry.satrec;

    // Orbital data
    const velocity = pos.posVel.velocity
      ? Math.sqrt(pos.posVel.velocity.x ** 2 + pos.posVel.velocity.y ** 2 + pos.posVel.velocity.z ** 2)
      : null;
    const periodMin = sr.no ? (2 * Math.PI) / sr.no : null; // satrec.no is rad/min
    const inclDeg = sr.inclo != null ? sr.inclo * RAD2DEG : null;

    let orbit = '';
    orbit += _infoRow(_t('sat.altitude'), pos.alt.toFixed(0) + ' km');
    if (velocity != null) orbit += _infoRow(_t('sat.velocity'), velocity.toFixed(2) + ' km/s');
    if (periodMin != null) orbit += _infoRow(_t('sat.period'), periodMin.toFixed(1) + ' min');
    if (inclDeg != null) orbit += _infoRow(_t('sat.inclination'), inclDeg.toFixed(1) + '°');
    if (sr.ecco != null) orbit += _infoRow(_t('sat.eccentricity'), sr.ecco.toFixed(4));

    // Identifiers (COSPAR only — NORAD id dropped to declutter the card)
    let ids = '';
    if (sr.intldesg && String(sr.intldesg).trim()) ids += _infoRow(_t('sat.cospar'), String(sr.intldesg).trim());

    // Sub-satellite point — own block, mirroring the star card's substellar block
    // (title + latitude/longitude rows in DMS with hemisphere letters).
    const subNS = pos.lat >= 0 ? 'N' : 'S';
    const subEW = pos.lng >= 0 ? 'E' : 'W';
    const subBlock =
      '<div class="info-block"><div class="info-block-title">' +
      _t('sat.subpoint') +
      '</div>' +
      '<table class="sat-info-table">' +
      _infoRow(_t('sat.latitude'), GeoUtils.fmtDMS(pos.lat) + ' ' + subNS) +
      _infoRow(_t('sat.longitude'), GeoUtils.fmtDMS(pos.lng) + ' ' + subEW) +
      '</table></div>';

    // From observer (only when a location is set) — aligned with the star card's
    // Visibility block: title carries observer coords, elevation carries the
    // above/below tag, azimuth carries the compass direction. No separate horizon row.
    let observerBlock = '';
    const obs = window.currentObserverLatLng;
    if (obs && pos.posVel.position) {
      const obsGd = {
        longitude: obs.lng * DEG2RAD,
        latitude: obs.lat * DEG2RAD,
        height: 0,
      };
      const ecf = satellite.eciToEcf(pos.posVel.position, pos.gmst);
      const look = satellite.ecfToLookAngles(obsGd, ecf);
      const azDeg = (look.azimuth * RAD2DEG + 360) % 360;
      const elDeg = look.elevation * RAD2DEG;
      const rangeKm = look.rangeSat;
      const visTag = elDeg > 0 ? _t('sat.above_horizon') : _t('sat.below_horizon');
      let obsRows = '';
      obsRows += _infoRow(_t('sat.elevation'), elDeg.toFixed(1) + '° (' + visTag + ')');
      obsRows += _infoRow(_t('sat.azimuth'), azDeg.toFixed(0) + '° (' + GeoUtils.compassDir(azDeg) + ')');
      obsRows += _infoRow(_t('sat.range'), rangeKm.toFixed(0) + ' km');
      observerBlock =
        '<div class="info-block"><div class="info-block-title">' +
        _t('sat.from_observer') +
        ' (' +
        obs.lat.toFixed(2) +
        '°, ' +
        obs.lng.toFixed(2) +
        '°)</div>' +
        '<table class="sat-info-table">' +
        obsRows +
        '</table></div>';
    }

    // Locked note (only when outside the TLE trust window). Epoch/age rows dropped.
    const lockedNote = locked ? '<p class="chart-note">ⓘ ' + _t('sat.locked_note') + '</p>' : '';

    const html =
      '<div class="star-panel">' +
      '<h2 class="star-name">' +
      entry.label +
      ' <span class="star-bf">(' +
      _t('sat.type.' + entry.type) +
      ')</span></h2>' +
      '<div class="star-scroll">' +
      (ids ? '<div class="info-block"><table class="sat-info-table">' + ids + '</table></div>' : '') +
      '<div class="info-block"><div class="info-block-title">' +
      _t('sat.orbit_data') +
      '</div><table class="sat-info-table">' +
      orbit +
      '</table></div>' +
      subBlock +
      observerBlock +
      lockedNote +
      '</div>' +
      GeoUtils.cardCredits([{ name: 'CelesTrak', url: 'https://celestrak.org/' }]) +
      '</div>';

    return html;
  }

  function _showSatPopup(entry, effDate, locked, latlng) {
    // Rebuild from TimeState.current on each call so a later time change (or
    // locale change) refreshes the card. Remember the world copy it opened in so
    // _onTimeChange can slide the card with the moving sub-satellite point.
    _popupEntry = entry;
    _popupBuilder = function () {
      const cw = _clampToWindow(TimeState.current, entry.satrec);
      return _buildSatPopupHTML(entry, cw.eff, cw.locked);
    };
    const base = _propagate(entry.satrec, effDate);
    const ll = L.latLng(latlng);
    _popupOffset = base ? Math.round((ll.lng - GeoUtils.normLng(base.lng)) / 360) * 360 : 0;
    if (!_popup) {
      _popup = L.popup({
        className: 'sky-star-popup',
        offset: [0, -6],
        maxWidth: 280,
        autoPan: false,
        closeButton: true,
        closeOnClick: true,
      });
      _popup.on('remove', () => {
        _popupEntry = null;
        _popupBuilder = null;
      });
    }
    _popup.setLatLng(latlng).setContent(_popupBuilder()).openOn(_map);
  }

  // ---- Today's Passes ----
  // ms that `tz` runs ahead of UTC at the given instant (DST-aware).
  function _tzAheadMs(utcDate, tz) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const m = {};
    for (const p of dtf.formatToParts(utcDate)) m[p.type] = p.value;
    const hour = m.hour === '24' ? 0 : parseInt(m.hour, 10);
    const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, hour, +m.minute, +m.second);
    return asUTC - utcDate.getTime();
  }

  // UTC ms of local (observer-timezone) midnight for the calendar day of `date`.
  function _localDayStartMs(date, tz) {
    const off = _tzAheadMs(date, tz);
    const localWall = date.getTime() + off;
    const midnightWall = Math.floor(localWall / 86400000) * 86400000;
    return midnightWall - off;
  }

  let _passCache = { key: null, passes: [] };

  function _pushPass(cur, passes, entry, minPeak) {
    if (cur.maxEl < minPeak) return;
    passes.push({
      label: entry.label,
      noradId: entry.noradId,
      start: cur.start,
      end: cur.end,
      maxEl: cur.maxEl,
      azAtMax: cur.azAtMax,
      visStart: cur.visStart,
      visEnd: cur.visEnd,
    });
  }

  // All above-horizon passes during the observer-timezone calendar day of `date`,
  // each tagged with its sunlight-reflection-visible sub-window (if any). Cached
  // by (day, observer, newest-epoch) so dragging the minute slider within a day
  // doesn't re-scan. Returns [] when stale (current time outside any trust window).
  function getDayPasses(lat, lng, date) {
    if (!_satrecs.length || !_valid) return [];
    if (lat == null || lng == null) return [];
    const tz = typeof TimeState !== 'undefined' && TimeState.timezone ? TimeState.timezone : 'UTC';
    const startUTC = _localDayStartMs(date, tz);
    const endUTC = startUTC + 86400000;
    const epochKey = _satrecs.reduce((a, e) => Math.max(a, _epochMs(e.satrec)), 0);
    const key = startUTC + '|' + lat.toFixed(2) + ',' + lng.toFixed(2) + '|' + epochKey;
    if (_passCache.key === key) return _passCache.passes;

    const obsGd = { longitude: lng * DEG2RAD, latitude: lat * DEG2RAD, height: 0 };
    const STEP_MS = 60000; // 60 s scan
    const MIN_PEAK_EL = 10; // drop weak (low-culmination) passes
    const passes = [];

    for (const entry of _satrecs) {
      let cur = null;
      for (let t = startUTC; t <= endUTC; t += STEP_MS) {
        const when = new Date(t);
        const pos = _propagate(entry.satrec, when);
        if (!pos || !pos.posVel.position) {
          if (cur) {
            _pushPass(cur, passes, entry, MIN_PEAK_EL);
            cur = null;
          }
          continue;
        }
        const ecf = satellite.eciToEcf(pos.posVel.position, pos.gmst);
        const look = satellite.ecfToLookAngles(obsGd, ecf);
        const elDeg = look.elevation * RAD2DEG;
        if (elDeg > 0) {
          const ss = typeof window.getSubsolarLatLng === 'function' ? window.getSubsolarLatLng(when) : null;
          const thetaH = _horizonDip(pos.alt || 0);
          const visible =
            _sunAltAt(pos.lat, pos.lng, ss) > -thetaH && // satellite sunlit
            _sunAltAt(lat, lng, ss) < GROUND_DARK_DEG; // observer dark
          const az = (look.azimuth * RAD2DEG + 360) % 360;
          if (!cur) cur = { start: t, end: t, maxEl: elDeg, azAtMax: az, visStart: null, visEnd: null };
          cur.end = t;
          if (elDeg > cur.maxEl) {
            cur.maxEl = elDeg;
            cur.azAtMax = az;
          }
          if (visible) {
            if (cur.visStart == null) cur.visStart = t;
            cur.visEnd = t;
          }
        } else if (cur) {
          _pushPass(cur, passes, entry, MIN_PEAK_EL);
          cur = null;
        }
      }
      if (cur) _pushPass(cur, passes, entry, MIN_PEAK_EL);
    }
    passes.sort((a, b) => a.start - b.start);
    _passCache = { key, passes };
    return passes;
  }

  // Coalesce time-change bursts (e.g. dragging the time slider) into one render
  // per animation frame so satellites move in real time without flooding.
  function _onTimeChange() {
    if (!_map || !_layer || !_map.hasLayer(_layer)) return;
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
      _rafPending = false;
      _render(TimeState.current);
      // Keep an open satellite card in sync: refresh its (fast-changing) content
      // and slide it to the new sub-point, preserving the world copy it opened in.
      if (_popup && _popupEntry && _popupBuilder && _map.hasLayer(_popup)) {
        const cw = _clampToWindow(TimeState.current, _popupEntry.satrec);
        const pos = _propagate(_popupEntry.satrec, cw.eff);
        if (pos) _popup.setLatLng([pos.lat, GeoUtils.normLng(pos.lng) + _popupOffset]);
        _popup.setContent(_popupBuilder());
      }
    });
  }

  async function _loadData() {
    // Concurrency guard: if a load is already in flight, await it instead of
    // firing a second set of network requests (rapid layer toggling).
    if (_loading) return _loading;
    _loading = (async () => {
      const collected = [];
      for (const group of GROUPS) {
        const entries = await _fetchTLE(group);
        collected.push(...entries);
      }
      // Keep only curated notable satellites; dedup by NORAD id (ISS appears in
      // both the stations and visual groups).
      const seen = new Set();
      _satrecs = [];
      for (const e of collected) {
        const meta = NOTABLE[e.noradId];
        if (!meta || seen.has(e.noradId)) continue;
        seen.add(e.noradId);
        e.label = meta.label;
        e.type = meta.type;
        _satrecs.push(e);
      }
    })();
    try {
      await _loading;
    } finally {
      _loading = null;
    }
  }

  function init(map) {
    _map = map;
    if (!_map.getPane('sat')) {
      _pane = _map.createPane('sat');
      _pane.style.zIndex = 800;
    }
    _layer = L.layerGroup([], { pane: 'sat' });
  }

  function _refreshSidebar() {
    if (typeof Sidebar !== 'undefined' && Sidebar.refresh) Sidebar.refresh();
  }

  async function addTo(map) {
    if (!_layer) init(map);
    _layer.addTo(map);
    if (!_satrecs.length) await _loadData();
    _render(TimeState.current);
    if (!_unsub && typeof TimeState !== 'undefined') {
      _unsub = true;
      TimeState.subscribe(_onTimeChange);
      // Refresh an open card's labels when the locale changes (content otherwise
      // only rebuilds on time change).
      if (typeof I18n !== 'undefined') {
        I18n.subscribe(() => {
          if (_popup && _popupBuilder && _map && _map.hasLayer(_popup)) {
            _popup.setContent(_popupBuilder());
          }
        });
      }
    }
    // Layer just turned on (or reopened): surface its sidebar section now,
    // rather than waiting for the next time tick to re-render.
    _refreshSidebar();
  }

  function removeFrom(map) {
    if (_layer && map.hasLayer(_layer)) map.removeLayer(_layer);
    // Layer off: drop its sidebar section immediately (satSection() gates on
    // isOn()), instead of lingering until the next tick.
    _refreshSidebar();
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

  // ---- Public Hooks For Search / Sidebar Jump-To ----
  // Static curated catalogue (does NOT need TLE loaded) — feeds the search index.
  function getCatalog() {
    return Object.keys(NOTABLE).map((id) => ({
      noradId: +id,
      label: NOTABLE[id].label,
      type: NOTABLE[id].type,
      aliases: NOTABLE[id].aliases || [],
    }));
  }

  // Live sub-point {lat, lng} for a satellite (needs TLE loaded; the layer being
  // on has already triggered _loadData). Clamped to the trust window like the map.
  function getSearchLatLng(noradId, date) {
    const e = _satrecs.find((s) => s.noradId === noradId);
    if (!e) return null;
    const { eff } = _clampToWindow(date, e.satrec);
    const pos = _propagate(e.satrec, eff);
    return pos ? { lat: pos.lat, lng: GeoUtils.normLng(pos.lng) } : null;
  }

  // Open the same info card the marker click shows, at a chosen latlng (used by
  // the search box and the sidebar pass-list name click).
  function showSearchPopup(noradId, date, latlng, map) {
    const e = _satrecs.find((s) => s.noradId === noradId);
    if (!e) return;
    if (!_map && map) _map = map;
    const { eff, locked } = _clampToWindow(date, e.satrec);
    _showSatPopup(e, eff, locked, latlng);
  }

  // Newest TLE epoch (ms) across loaded satellites + its age vs current time.
  function getEpochInfo() {
    if (!_satrecs.length) return null;
    let newest = -Infinity;
    for (const e of _satrecs) newest = Math.max(newest, _epochMs(e.satrec));
    const ageDays = typeof TimeState !== 'undefined' ? Math.abs(TimeState.current.getTime() - newest) / 86400000 : null;
    return { epochMs: newest, ageDays };
  }

  // True when the current time sits inside every loaded satellite's trust window.
  function isFreshForCurrentTime() {
    return _valid;
  }

  return {
    init,
    addTo,
    removeFrom,
    isOn,
    toggle,
    getEpochInfo,
    isFreshForCurrentTime,
    getDayPasses,
    getCatalog,
    getSearchLatLng,
    showSearchPopup,
  };
})();
