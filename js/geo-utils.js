/**
 * geo-utils.js — Shared geographic computation utilities.
 */
const GeoUtils = (() => {
  const DEG = Math.PI / 180;
  // ` data-gloss="…"` attribute for a term label (shared themed glossary tooltip).
  function _glossAttr(slug) {
    return typeof I18n !== 'undefined' ? I18n.glossAttr(slug) : '';
  }

  // Split a polyline at:
  //   – null-lng sentinels (a sample at the pole where lng is undefined — callers
  //     emit these so the renderer leaves a clean gap, not an arbitrary pole chord),
  //   – antimeridian crossings (|ΔLng| > 180°),
  //   – polar wraps (both ends within 15° of a pole + ΔLng > 60°).
  function splitAtAntimeridian(pts) {
    const out = [];
    let cur = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p == null || p[1] == null || !isFinite(p[1])) {
        if (cur.length >= 2) out.push(cur);
        cur = [];
        continue;
      }
      if (cur.length > 0) {
        const prev = cur[cur.length - 1];
        const dLng = Math.abs(p[1] - prev[1]);
        const polarBoth = Math.abs(p[0]) > 75 && Math.abs(prev[0]) > 75;
        if (dLng > 180 || (polarBoth && dLng > 60)) {
          if (cur.length >= 2) out.push(cur);
          cur = [];
        }
      }
      cur.push(p);
    }
    if (cur.length >= 2) out.push(cur);
    return out;
  }

  function normLng(lng) {
    return (((lng % 360) + 540) % 360) - 180;
  }

  function wrapOffsets(minLon, maxLon) {
    const offsets = [];
    for (let k = -1; k <= 2; k++) {
      const lo = k * 360 + minLon;
      const hi = k * 360 + maxLon;
      if (hi >= -200 && lo <= 520) offsets.push(k * 360);
    }
    return offsets;
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const dLat = (lat2 - lat1) * DEG;
    const dLng = (lng2 - lng1) * DEG;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }

  function destination(lat, lng, bearingDeg, distKm) {
    const R = 6371;
    const d = distKm / R;
    const br = bearingDeg * DEG;
    const lat1 = lat * DEG,
      lng1 = lng * DEG;
    const sinLat1 = Math.sin(lat1),
      cosLat1 = Math.cos(lat1);
    const sinD = Math.sin(d),
      cosD = Math.cos(d);
    const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * Math.cos(br));
    const lng2 = lng1 + Math.atan2(Math.sin(br) * sinD * cosLat1, cosD - sinLat1 * Math.sin(lat2));
    return [lat2 / DEG, normLng(lng2 / DEG)];
  }

  function subStellarPoint(raDeg, decDeg, date) {
    if (typeof Astronomy === 'undefined') return null;
    const gmst = Astronomy.SiderealTime(date) * 15;
    const lon = normLng(raDeg - gmst);
    return { lat: decDeg, lng: lon };
  }

  function skyObservation(raDeg, decDeg, date) {
    const obs = window.currentObserverLatLng;
    if (!obs || typeof Astronomy === 'undefined') return null;
    try {
      const time = Astronomy.MakeTime(date);
      const observer = new Astronomy.Observer(obs.lat, obs.lng, 0);
      const hor = Astronomy.Horizon(time, observer, raDeg / 15, decDeg, 'normal');
      return { alt: hor.altitude, az: hor.azimuth, observer: obs };
    } catch (e) {
      return null;
    }
  }

  function fmtDMS(deg) {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const mFull = (abs - d) * 60;
    const m = Math.floor(mFull);
    const s = Math.round((mFull - m) * 60);
    return d + '° ' + String(m).padStart(2, '0') + '′ ' + String(s).padStart(2, '0') + '″';
  }

  // Right ascension: degrees → "hh h mm m ss s" (sidereal hours).
  // Carries seconds → minutes → hours when rounding pushes a component to 60.
  function fmtRA(deg) {
    let h = deg / 15;
    h = ((h % 24) + 24) % 24;
    let hh = Math.floor(h);
    const mFull = (h - hh) * 60;
    let mm = Math.floor(mFull);
    let ss = Math.round((mFull - mm) * 60);
    if (ss === 60) {
      ss = 0;
      mm += 1;
    }
    if (mm === 60) {
      mm = 0;
      hh = (hh + 1) % 24;
    }
    return String(hh).padStart(2, '0') + 'h ' + String(mm).padStart(2, '0') + 'm ' + String(ss).padStart(2, '0') + 's';
  }

  // Declination: degrees → "±dd° mm′ ss″" (signed, with second/minute carry).
  function fmtDec(deg) {
    const sign = deg < 0 ? '-' : '+';
    const abs = Math.abs(deg);
    let d = Math.floor(abs);
    const mFull = (abs - d) * 60;
    let m = Math.floor(mFull);
    let s = Math.round((mFull - m) * 60);
    if (s === 60) {
      s = 0;
      m += 1;
    }
    if (m === 60) {
      m = 0;
      d += 1;
    }
    return sign + d + '° ' + String(m).padStart(2, '0') + '′ ' + String(s).padStart(2, '0') + '″';
  }

  function compassDir(az) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
  }

  function buildSkyInfoHTML(raDeg, decDeg, date, _t) {
    if (!_t)
      _t = function (k) {
        return k;
      };
    date = date || (typeof TimeState !== 'undefined' ? TimeState.current : new Date());
    let html = '';

    const sub = subStellarPoint(raDeg, decDeg, date);
    if (sub) {
      const ns = sub.lat >= 0 ? 'N' : 'S';
      const ew = sub.lng >= 0 ? 'E' : 'W';
      html +=
        '<div class="info-block">' +
        '<div class="info-block-title"' +
        _glossAttr('substellar_point') +
        '>' +
        _t('star.substellar_point') +
        '</div>' +
        '<div class="info-row"><span class="label"' +
        _glossAttr('latitude') +
        '>' +
        _t('star.latitude') +
        '</span><span class="value">' +
        fmtDMS(sub.lat) +
        ' ' +
        ns +
        '</span></div>' +
        '<div class="info-row"><span class="label"' +
        _glossAttr('longitude') +
        '>' +
        _t('star.longitude') +
        '</span><span class="value">' +
        fmtDMS(sub.lng) +
        ' ' +
        ew +
        '</span></div>' +
        '</div>';
    }

    const obs = skyObservation(raDeg, decDeg, date);
    if (obs) {
      let riseSetLine = '';
      let circumpolar = false;
      try {
        const aTime = Astronomy.MakeTime(date);
        const observer = new Astronomy.Observer(obs.observer.lat, obs.observer.lng, 0);
        Astronomy.DefineStar(Astronomy.Body.Star2, raDeg / 15, decDeg, 1000);
        const rise = Astronomy.SearchRiseSet(Astronomy.Body.Star2, observer, +1, aTime, 1);
        const set = Astronomy.SearchRiseSet(Astronomy.Body.Star2, observer, -1, aTime, 1);
        if (!rise && !set) {
          circumpolar = true;
        } else if (rise && set) {
          const tz = typeof TimeState !== 'undefined' ? TimeState.timezone : 'UTC';
          const fmtT = function (d) {
            const parts = Intl.DateTimeFormat('en', {
              timeZone: tz,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).formatToParts(d);
            return (
              parts.find(function (p) {
                return p.type === 'hour';
              }).value +
              ':' +
              parts.find(function (p) {
                return p.type === 'minute';
              }).value
            );
          };
          const riseStr = fmtT(rise.date);
          const setStr = fmtT(set.date);
          const suffix = setStr <= riseStr ? ' (' + _t('star.next_day') + ')' : '';
          riseSetLine =
            '<div class="info-row"><span class="label"' +
            _glossAttr('visible_period') +
            '>' +
            _t('star.visible_period') +
            '</span><span class="value">' +
            riseStr +
            '–' +
            setStr +
            suffix +
            '</span></div>';
        }
      } catch (_) {}
      const visTag = circumpolar
        ? obs.alt > 0
          ? _t('star.always_visible')
          : _t('star.always_invisible')
        : obs.alt > 0
          ? _t('star.visible_now')
          : _t('star.not_visible_now');
      html +=
        '<div class="info-block">' +
        '<div class="info-block-title">' +
        (function () {
          var lat = obs.observer.lat;
          var lng = normLng(obs.observer.lng);
          return (
            _t('star.from_observer') +
            ' (' +
            Math.abs(lat).toFixed(2) +
            '°' +
            (lat >= 0 ? 'N' : 'S') +
            ', ' +
            Math.abs(lng).toFixed(2) +
            '°' +
            (lng >= 0 ? 'E' : 'W') +
            ')'
          );
        })() +
        '</div>' +
        '<div class="info-row"><span class="label"' +
        _glossAttr('altitude') +
        '>' +
        _t('star.altitude') +
        '</span><span class="value">' +
        obs.alt.toFixed(1) +
        '° (' +
        visTag +
        ')</span></div>' +
        '<div class="info-row"><span class="label"' +
        _glossAttr('azimuth') +
        '>' +
        _t('star.azimuth') +
        '</span><span class="value">' +
        obs.az.toFixed(1) +
        '° (' +
        compassDir(obs.az) +
        ')</span></div>' +
        riseSetLine +
        '</div>';
    }

    return html;
  }

  // Data-source attribution footer for celestial info cards. `sources` is an
  // array of { name, url }; names are language-neutral proper nouns (catalog /
  // engine names) joined by ' · '. Falsy entries are skipped so callers can
  // pass a conditional source inline (e.g. Stellarium only in zh locales).
  function cardCredits(sources) {
    const parts = (sources || []).filter(Boolean).map(function (s) {
      return s.url ? '<a href="' + s.url + '" target="_blank" rel="noopener">' + s.name + '</a>' : s.name;
    });
    if (!parts.length) return '';
    const label = typeof I18n !== 'undefined' ? I18n.t('credits.card') : 'Source: ';
    return '<div class="card-credits">' + label + parts.join(' · ') + '</div>';
  }

  function sunAltAtPoint(lat, lng, date) {
    if (typeof window.getSubsolarLatLng !== 'function') return 0;
    const ss = window.getSubsolarLatLng(date);
    const sinAlt =
      Math.sin(lat * DEG) * Math.sin(ss.lat * DEG) +
      Math.cos(lat * DEG) * Math.cos(ss.lat * DEG) * Math.cos((lng - ss.lng) * DEG);
    return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
  }

  function dayStrength(altDeg) {
    const t = Math.max(0, Math.min(1, (altDeg + 18) / 18));
    return t * t * (3 - 2 * t);
  }

  function lerpHex(c0, c1, t) {
    const p = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    const a = p(c0),
      b = p(c1);
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }

  // Split a continuous (unwrapped) polyline into runs of near-constant day
  // strength so each run can be stroked with its own night→day lerped colour
  // (an SVG polyline has a single stroke colour). Adjacent runs share their
  // boundary vertex so there is no visual gap. Returns [{ pts, t }] where t is
  // the run's representative dayStrength (0=night .. 1=day). When the day mask
  // is hidden or no date is available, returns a single run with t=0 — i.e.
  // pixel-identical to the pre-existing fixed-colour rendering, zero extra
  // trig. The subsolar point is fetched once and the altitude formula inlined,
  // since per-point sunAltAtPoint would re-run the (expensive) astronomy ops.
  function dayStrengthRuns(pts, date, bucket) {
    bucket = bucket || 0.15;
    if (!pts || pts.length < 2 || !window._dayMaskVisible || !date || typeof window.getSubsolarLatLng !== 'function') {
      return [{ pts: pts || [], t: 0 }];
    }
    const ss = window.getSubsolarLatLng(date);
    const sinSs = Math.sin(ss.lat * DEG),
      cosSs = Math.cos(ss.lat * DEG);
    const ssLng = ss.lng * DEG;
    const strengthAt = (lat, lng) => {
      const sinAlt = Math.sin(lat * DEG) * sinSs + Math.cos(lat * DEG) * cosSs * Math.cos(lng * DEG - ssLng);
      const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
      return dayStrength(alt);
    };
    const bIdx = (p) => Math.round(strengthAt(p[0], p[1]) / bucket);
    const mkRun = (seg) => {
      const m = seg[Math.floor(seg.length / 2)];
      return { pts: seg, t: strengthAt(m[0], m[1]) };
    };
    const runs = [];
    let curIdx = bIdx(pts[0]);
    let start = 0;
    for (let i = 1; i < pts.length; i++) {
      const idx = bIdx(pts[i]);
      if (idx !== curIdx) {
        runs.push(mkRun(pts.slice(start, i + 1))); // include boundary vertex
        start = i; // next run shares it
        curIdx = idx;
      }
    }
    runs.push(mkRun(pts.slice(start)));
    return runs;
  }

  // Day strength (0..1) at a short segment's midpoint — for tick marks too
  // small to be worth splitting. Guarded like dayStrengthRuns: 0 when the day
  // mask is hidden, so callers fall back to the night colour.
  function dayStrengthAtMid(pts, date) {
    if (!pts || !pts.length || !window._dayMaskVisible || !date || typeof window.getSubsolarLatLng !== 'function')
      return 0;
    const m = pts[Math.floor(pts.length / 2)];
    return dayStrength(sunAltAtPoint(m[0], m[1], date));
  }

  // Filter [-720,-360,0,360,720] to wraps whose lng range intersects the viewport.
  // Mirrors map.js visibleWrapsFromBounds; placed here so factory modules loaded
  // before map.js can call GeoUtils.visibleWrapsFromBounds without a load-order dep.
  function visibleWrapsFromBounds(m) {
    if (!m || typeof m.getBounds !== 'function') return [0];
    const b = m.getBounds();
    const west = b.getWest(),
      east = b.getEast();
    const ALL = [-720, -360, 0, 360, 720];
    const out = [];
    for (let i = 0; i < ALL.length; i++) {
      const off = ALL[i];
      if (off + 180 >= west && off - 180 <= east) out.push(off);
    }
    return out.length ? out : [0];
  }

  // A moveend-rebuild key for viewport-culled overlays. visibleWrapsFromBounds alone is
  // too coarse: it only changes when a pan crosses a 360° world-copy boundary, so an
  // intra-wrap pan that reveals new sky was silently skipped. Longitude culling only
  // engages below a full-globe span (see sky.js viewportRaDecBox), so fold a coarse
  // viewport bucket into the key exactly when culling is live; low zoom stays
  // viewport-agnostic and negligible pans still short-circuit.
  function viewportRebuildKey(m) {
    const wraps = visibleWrapsFromBounds(m).join(',');
    if (!m || typeof m.getBounds !== 'function') return wraps;
    const b = m.getBounds();
    if (b.getEast() - b.getWest() >= 360) return wraps;
    const ctr = m.project(m.getCenter());
    return wraps + '|' + m.getZoom() + ':' + Math.round(ctr.x / 256) + ':' + Math.round(ctr.y / 256);
  }

  // ---- Great-Circle Overlay Helpers ----
  // These three were byte-identical clones inside great-circle-layer.js and
  // ecliptic.js; consolidated here so the single curve-rendering recipe has one home.

  // Project an [[ra,dec],…] table to [[lat,lng],…] sub-stellar points at `date`.
  function projectSubStellarTable(table, date) {
    const pts = new Array(table.length);
    for (let i = 0; i < table.length; i++) {
      const sp = subStellarPoint(table[i][0], table[i][1], date);
      pts[i] = [sp.lat, sp.lng];
    }
    return pts;
  }

  // Unwrap a polyline's longitudes for adjacent-point continuity (each point takes
  // the ±360 representative nearest its predecessor) so a curve crossing the
  // antimeridian stays continuous when Leaflet draws it.
  function unwrapLngContinuity(pts) {
    const out = new Array(pts.length);
    out[0] = pts[0];
    let prev = pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      let lng = pts[i][1];
      while (lng - prev > 180) lng -= 360;
      while (lng - prev < -180) lng += 360;
      out[i] = [pts[i][0], lng];
      prev = lng;
    }
    return out;
  }

  // World-copy offsets (multiples of 360°) at which `base` (an unwrapped [lat,lng]
  // table) overlaps the visible span — viewport bounds clamped to MAP_LNG_WEST/EAST.
  // `map` may be null (then only the map-span clamp applies). At z≈10 typically 1 wrap.
  function visibleWrapOffsets(base, map) {
    let W = typeof MAP_LNG_WEST !== 'undefined' ? MAP_LNG_WEST : -200;
    let E = typeof MAP_LNG_EAST !== 'undefined' ? MAP_LNG_EAST : 520;
    if (map) {
      const b = map.getBounds();
      const vw = b.getWest(),
        ve = b.getEast();
      if (vw > W) W = vw;
      if (ve < E) E = ve;
    }
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < base.length; i++) {
      const x = base[i][1];
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    const out = [];
    for (let w = -2; w <= 2; w++) {
      const off = w * 360;
      if (hi + off < W - 1 || lo + off > E + 1) continue;
      out.push(off);
    }
    return out.length ? out : [0];
  }

  return {
    splitAtAntimeridian,
    normLng,
    wrapOffsets,
    haversine,
    destination,
    subStellarPoint,
    skyObservation,
    fmtDMS,
    fmtRA,
    fmtDec,
    compassDir,
    buildSkyInfoHTML,
    cardCredits,
    sunAltAtPoint,
    dayStrength,
    lerpHex,
    dayStrengthRuns,
    dayStrengthAtMid,
    visibleWrapsFromBounds,
    viewportRebuildKey,
    projectSubStellarTable,
    unwrapLngContinuity,
    visibleWrapOffsets,
  };
})();
