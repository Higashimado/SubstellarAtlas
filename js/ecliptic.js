/** ecliptic.js — brass ecliptic projected on Earth, with casing + ruler ticks.
 *
 * In the 'ecliptic' map pane:
 *   - twin rails  at β = ±RAIL_HALF_DEG (brass + dark casing).
 *   - ticks       zoom-tiered: z≤3 → 4 (solstices + equinoxes), z=4 → 8 (eight seasonal markers),
 *                 z≥5 → 24 (24 solar terms). Each tick is brass + dark casing,
 *                 minor (β=±0.9°) or major (β=±2.0°).
 *   - 1° micro-ticks at z≥5 — between the two rails, fine ruler graduations
 *                 (single brass layer, no casing; skips λ's already covered
 *                 by the 24 solar-term ticks).
 *   - solar-term label  at z≥4 in CJK locales, just downstream of each tick
 *                 along the curve (β=0, λ+TERM_LAMBDA_OFFSET), rotated to
 *                 match the local tangent.
 *   - degree label      at z≥4 in all locales, further downstream of the
 *                 same tick (β=0, λ+DEGREE_LAMBDA_OFFSET), same rotation.
 *                 Reading order along the curve: tick → solar term → 0°/15°/…
 *   - ecliptic label  spaced every LABEL_LNG_STEP° of map longitude on the
 *                 β=0 center curve.
 *
 * Auto-shown when Sun or Planets layer is on, hidden when both off
 * (wired in map.js, not here).
 *
 * Interactive ruler: hovering a tick label reveals the next time the Sun
 * reaches that solar-term longitude (clicking jumps there, selects the Sun,
 * and opens its card — out-of-range jumps clamp to the time wall). Hovering a
 * 1° micro-tick (z≥6) shows its longitude. The micro-tick hit bands sit on a
 * low pane ('ecliptic-hit', z=190) so stars/bodies keep click priority.
 *
 * Depends on globals: L (Leaflet), GeoUtils.subStellarPoint, I18n,
 * MAP_LNG_WEST / MAP_LNG_EAST (from map.js).
 */
const Ecliptic = (() => {
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const OBLIQUITY_DEG = 23.4393;
  const SAMPLES = 721; // 0.5° step, 0..360 inclusive
  const STEP_DEG = 360 / (SAMPLES - 1); // = 0.5°

  // Geometry:
  const RAIL_HALF_DEG = 0.4; // twin rails at β = ±0.4°
  const MINOR_HALF_DEG = 0.9; // 15° ticks
  const MAJOR_HALF_DEG = 2.0; // 45° ticks (eight seasonal markers)
  const MICRO_HALF_DEG = 0.35; // 1° micro-ticks (just inside the rails)

  // Tick label («立夏 45°» when a solar-term name exists for this locale, «45°»
  // otherwise) — anchored at the tick crossing and shifted via CSS along
  // the tangent by a fixed pixel amount so the label-to-tick distance
  // stays constant across zoom levels.
  const TICK_LABEL_PX_OFFSET = 8;

  // 「黄道」 / 「Ecliptic」 labels — anchored at fixed ecliptic-longitude
  // midpoints between the eight seasonal-marker ticks (each ±22.5° away from any
  // seasonal marker, ±7.5° away from any of the 24 solar terms). Stable, far from every tick label.
  const ECLIPTIC_LABEL_LAMBDAS = [22.5, 112.5, 202.5, 292.5];

  // Palette:
  const COLOR_BRASS = '#c9a86a';
  const COLOR_CASING = '#181d23';
  const HALO = '#181d23';
  const HALO_DAY = (window.C && C.casingDay) || '#484848';
  const COLOR_BRASS_DAY = '#d4a840';

  // Styles:
  function _S(opts) {
    return Object.assign(
      {
        pane: 'ecliptic',
        smoothFactor: 0,
        noClip: true,
        interactive: false,
      },
      opts
    );
  }
  const RAIL_CASING = _S({ color: COLOR_CASING, weight: 2.8, opacity: 1.0 });
  const RAIL_BRASS = _S({ color: COLOR_BRASS, weight: 1.0, opacity: 0.9 });
  const TICK_MINOR_CASING = _S({ color: COLOR_CASING, weight: 1.8, opacity: 1.0 });
  const TICK_MINOR_BRASS = _S({ color: COLOR_BRASS, weight: 0.7, opacity: 0.9 });
  const TICK_MAJOR_CASING = _S({ color: COLOR_CASING, weight: 2.4, opacity: 1.0 });
  const TICK_MAJOR_BRASS = _S({ color: COLOR_BRASS, weight: 1.1, opacity: 0.9 });
  const MICRO_TICK = _S({ color: COLOR_BRASS, weight: 0.4, opacity: 0.55 });

  let _map = null;
  let _group = null;
  let _lastKey = '';

  // Transient hover read-outs (micro-tick longitude labels) live in their own
  // group so they can be cleared independently of the memoized _group rebuild.
  let _hoverGroup = null;

  // ---- Solar-Term Time (hover/jump easter egg) ----
  // A tick at ecliptic longitude λ marks a solar term; the Sun sits over the
  // tick exactly when its apparent longitude equals λ. Hovering a tick label
  // reveals when that next happens, and clicking jumps there.
  function _fmtFullTime(date) {
    if (!date || isNaN(date.getTime()) || typeof TimeState === 'undefined') return '';
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: TimeState.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const g = (t) => parts.find((p) => p.type === t).value;
    // ISO calendar order with '-' separators.
    return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
  }

  // Next time (from the current app time) the Sun reaches longitude λ. AE's
  // SearchSunLongitude is a narrow-window root finder, not a wide scanner — a
  // year-wide window straddles the longitude sawtooth's ±180° wrap and skips the
  // crossing (285°/小寒 returned null). So estimate the arrival from the Sun's
  // current longitude at the mean rate, then root a tight window around it; ±5 days
  // covers the ≤2-day error from the Sun's uneven perihelion-to-aphelion speed.
  function _nextTermDate(lambda) {
    if (typeof Astronomy === 'undefined' || !Astronomy.SearchSunLongitude || !Astronomy.SunPosition) {
      return null;
    }
    const start = typeof TimeState !== 'undefined' ? TimeState.current : new Date();
    const target = ((lambda % 360) + 360) % 360;
    let ahead = (target - Astronomy.SunPosition(start).elon) % 360;
    if (ahead < 0) ahead += 360;
    const DAY_MS = 86400000;
    const estStart = new Date(start.getTime() + (ahead / (360 / 365.2422) - 5) * DAY_MS);
    const t = Astronomy.SearchSunLongitude(target, estStart, 11);
    return t ? t.date : null;
  }

  // ---- (β, λ) → (RA, Dec) ----
  const _eps = OBLIQUITY_DEG * RAD;
  const _sinE = Math.sin(_eps);
  const _cosE = Math.cos(_eps);

  function _radecAt(lamDeg, betaDeg) {
    const lam = lamDeg * RAD,
      bet = betaDeg * RAD;
    const sinL = Math.sin(lam),
      cosL = Math.cos(lam);
    const sinB = Math.sin(bet),
      cosB = Math.cos(bet),
      tanB = sinB / cosB;
    const dec = Math.asin(sinB * _cosE + cosB * _sinE * sinL) * DEG;
    let ra = Math.atan2(sinL * _cosE - tanB * _sinE, cosL) * DEG;
    if (ra < 0) ra += 360;
    return [ra, dec];
  }

  function _buildRaDecTable(betaDeg) {
    const out = new Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      out[i] = _radecAt((i * 360) / (SAMPLES - 1), betaDeg);
    }
    return out;
  }
  const _railTop = _buildRaDecTable(+RAIL_HALF_DEG);
  const _railBot = _buildRaDecTable(-RAIL_HALF_DEG);
  const _railCenter = _buildRaDecTable(0);

  // Curve-rendering helpers live in GeoUtils (shared with great-circle-layer.js);
  // these thin wrappers bind the module's _map closure so call sites stay unchanged.
  function _projectTable(table, date) {
    return GeoUtils.projectSubStellarTable(table, date);
  }

  function _unwrap(pts) {
    return GeoUtils.unwrapLngContinuity(pts);
  }

  function _visibleOffsets(base) {
    return GeoUtils.visibleWrapOffsets(base, _map);
  }

  // ---- Zoom-Tiered Tick Set ----
  function _tickSetForZoom(z) {
    if (z <= 3) {
      return [0, 90, 180, 270].map((lam) => ({ lambda: lam, isMajor: true, termIdx: lam / 15 }));
    }
    if (z === 4) {
      const out = [];
      for (let lam = 0; lam < 360; lam += 45) {
        out.push({ lambda: lam, isMajor: true, termIdx: lam / 15 });
      }
      return out;
    }
    const out = [];
    for (let k = 0; k < 24; k++) {
      const lam = k * 15;
      out.push({ lambda: lam, isMajor: lam % 45 === 0, termIdx: k });
    }
    return out;
  }

  function _showSolarTermNames(z) {
    // No CJK gate — locales that have a key for this term render it, others
    // fall through to the key-existence check in the loop.
    return z >= 4;
  }

  function _showDegreeLabels(z) {
    return z >= 4; // all locales
  }

  function _showMicroTicks(z) {
    return z >= 5;
  }

  // Micro-tick hover read-outs need a comfortable hit band; only worth wiring
  // once zoomed in far enough that the 1° ticks are visually separable.
  function _showMicroHit(z) {
    return z >= 6;
  }

  // ---- Tangent at a Lambda Offset (degrees), using centerPts0 ----
  // Returns the angle (deg) of the curve's tangent in screen-y-inverted frame.
  // The unwrapped table spans 360° monotonically — wrapping the index modulo
  // SAMPLES jumps from one end (lng = base[0]+360) to the other (lng = base[0]),
  // giving a spurious huge Δlng and a near-zero tangent. Clamp instead.
  function _tangentAtLambda(centerPts0, lamDeg) {
    const idxRaw = Math.round(lamDeg / STEP_DEG);
    const idx = Math.max(0, Math.min(SAMPLES - 1, idxRaw));
    const lo = Math.max(0, idx - 2);
    const hi = Math.min(SAMPLES - 1, idx + 2);
    const dx = centerPts0[hi][1] - centerPts0[lo][1];
    const dy = centerPts0[hi][0] - centerPts0[lo][0];
    let angle = Math.atan2(-dy, dx) * DEG;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return angle;
  }

  function _adaptAt(lat, lng, date) {
    if (window._dayMaskVisible && typeof GeoUtils !== 'undefined' && GeoUtils.sunAltAtPoint) {
      const t = GeoUtils.dayStrength(GeoUtils.sunAltAtPoint(lat, lng, date));
      return { halo: GeoUtils.lerpHex(HALO, HALO_DAY, t), text: GeoUtils.lerpHex(COLOR_BRASS, COLOR_BRASS_DAY, t) };
    }
    return { halo: HALO, text: COLOR_BRASS };
  }

  // ---- Marker Builders ----
  function _placeEclipticLabel(lat, lng, angleDeg, text, date) {
    const a = _adaptAt(lat, lng, date);
    const font = 'font-family:var(--font-serif);font-size:15px;letter-spacing:0.05em;';
    // Soft coaxial halo in the adaptive casing colour — engraved look instead
    // of the old 5px hard stroke, still separating on the bright day veil.
    const halo = 'text-shadow:0 0 6px ' + a.halo + ',0 0 3px ' + a.halo + ',0 0 1.5px ' + a.halo + ';';
    const html =
      '<span style="color:' +
      a.text +
      ';' +
      halo +
      font +
      'transform:rotate(' +
      angleDeg.toFixed(1) +
      'deg);">' +
      text +
      '</span>';
    return L.marker([lat, lng], {
      pane: 'ecliptic-labels',
      icon: L.divIcon({ className: 'ecliptic-label', html: html, iconSize: [80, 22], iconAnchor: [40, 11] }),
      interactive: false,
      keyboard: false,
    });
  }

  function _placeTickLabel(lat, lng, angleDeg, text, date) {
    const a = _adaptAt(lat, lng, date);
    // Inscription face: the solar-term degree figures render in Cinzel, the
    // CJK term name falls through to Source Han Serif inside the same stack.
    const font = 'font-family:var(--font-inscription);font-size:12px;letter-spacing:0.05em;';
    const halo = 'text-shadow:0 0 6px ' + a.halo + ',0 0 3px ' + a.halo + ',0 0 1.5px ' + a.halo + ';';
    const html =
      '<span style="color:' +
      a.text +
      ';' +
      halo +
      font +
      'transform:rotate(' +
      angleDeg.toFixed(1) +
      'deg) translateX(' +
      TICK_LABEL_PX_OFFSET +
      'px);">' +
      text +
      '</span>';
    return L.marker([lat, lng], {
      pane: 'ecliptic-labels',
      icon: L.divIcon({ className: 'ecliptic-tick-label', html: html, iconSize: [0, 0], iconAnchor: [0, 0] }),
      interactive: false,
      keyboard: false,
    });
  }

  // ---- Tick-Label Interactivity ----
  // The marker's icon div is 0×0; the visible text overflows it, so the hit
  // target must be the span itself. The pane is pointer-events:none, so we flip
  // just this span back to auto — bodies and the map keep their click priority.
  function _wireTermLabel(marker, lambda) {
    // The icon DOM exists only once the marker is on the map. At the layer's
    // toggle-on site map.js calls update() (this rebuild) *before* addTo(map),
    // so getElement() is null here on first show — defer to the marker's 'add'.
    const el = marker.getElement();
    if (!el) {
      marker.once('add', () => _wireTermLabel(marker, lambda));
      return;
    }
    const span = el.querySelector('span');
    if (!span) return;
    span.style.pointerEvents = 'auto';
    span.style.cursor = 'pointer';
    // Date line lives in a sibling element so the label span's bounding box (and
    // therefore its transform-origin) never changes on hover — no position drift.
    let dateSpan = null;
    span.addEventListener('mouseenter', () => {
      const d = _nextTermDate(lambda);
      if (!d) return;
      if (!dateSpan) {
        dateSpan = document.createElement('span');
        // Inherit visual style from the label span, then shift one line down in
        // the rotated coordinate frame (translateY in the ecliptic-local frame).
        dateSpan.style.cssText = span.style.cssText;
        dateSpan.style.pointerEvents = 'none';
        dateSpan.style.cursor = 'default';
        dateSpan.style.transform = span.style.transform + ' translateY(18px)';
        el.appendChild(dateSpan);
      }
      dateSpan.textContent = _fmtFullTime(d);
      dateSpan.style.display = '';
    });
    span.addEventListener('mouseleave', () => {
      if (dateSpan) dateSpan.style.display = 'none';
    });
    span.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const d = _nextTermDate(lambda);
      if (!d || typeof TimeState === 'undefined') return;
      // jumpTo (discrete navigation) clears open trajectories, then clamps
      // past-2099 jumps to the time wall on its own.
      TimeState.jumpTo(d);
      if (typeof CelestialSearch !== 'undefined' && CelestialSearch.select) {
        CelestialSearch.select({ kind: 'sun', refKey: 'sun' }, _map);
      }
    });
  }

  // Transient brass longitude read-out beside a hovered 1° micro-tick — same
  // brass styling/tangent/offset as a tick label, so it reads as one of the ruler.
  function _showMicroLabel(lam, centerPts0, off, date) {
    _hoverGroup.clearLayers();
    const here = centerPts0[Math.max(0, Math.min(SAMPLES - 1, Math.round(lam / STEP_DEG)))];
    const angle = _tangentAtLambda(centerPts0, lam);
    _placeTickLabel(here[0], here[1] + off, angle, lam + '°', date).addTo(_hoverGroup);
  }

  // ---- Rebuild ----
  function _rebuild(date) {
    const _z = _map ? _map.getZoom() : 0;
    const _tier = _z <= 3 ? 0 : _z <= 4 ? 1 : 2;
    // Within-world longitude culling. At high zoom the viewport spans < 1° but the
    // rail otherwise emits all 360° of ticks + 1° micro-ticks, leaving hundreds of
    // off-screen <path> elements that each still cost a reposition on every zoom
    // frame (the dominant z≥10 viewreset cost). When the viewport is narrow, draw
    // only ticks/labels whose longitude lies within the viewport ± one viewport
    // width of margin, and gate the rebuild on an integer-degree span bucket: ticks
    // sit on integer λ, so the bucket flips exactly when one could enter/leave, and
    // the integer rounding itself yields a ≥1° margin that hides any pop-in at high
    // zoom. Wide (zoomed-out) views keep the original full-globe render + wrap key,
    // so low-zoom panning still triggers no rebuild. The continuous rails are never
    // culled (a handful of paths, and clipping them would risk the day-strength
    // seams).
    const _b = _map ? _map.getBounds() : null;
    const _vw = _b ? _b.getEast() - _b.getWest() : 360;
    const _cull = !!_b && _vw < 90;
    let _spanW = -Infinity,
      _spanE = Infinity,
      _cullKey;
    if (_cull) {
      _spanW = Math.floor(_b.getWest() - _vw);
      _spanE = Math.ceil(_b.getEast() + _vw);
      _cullKey = _spanW + ',' + _spanE;
    } else {
      _cullKey = GeoUtils.visibleWrapsFromBounds(_map).join(',');
    }
    // Day-veil visibility gates label casing (_adaptAt reads _dayMaskVisible),
    // so it must be in the memo key — else toggling the veil with time/pan
    // unchanged hits the early-return and leaves labels stuck in their bright
    // daylight stroke against the now-dark map.
    // Locale is in the key so a language switch (date/view unchanged) still
    // rebuilds — the term/「黄道」 labels are I18n.t lookups, not just geometry.
    const _loc = typeof I18n !== 'undefined' ? I18n.getLocale() : '';
    const _key =
      _tier + '|' + _cull + '|' + _cullKey + '|' + date.getTime() + '|' + (window._dayMaskVisible ? 1 : 0) + '|' + _loc;
    if (_key === _lastKey) return;
    _lastKey = _key;

    _group.clearLayers();
    if (_hoverGroup) _hoverGroup.clearLayers();

    const topPts0 = _unwrap(_projectTable(_railTop, date));
    const botPts0 = _unwrap(_projectTable(_railBot, date));
    const centerPts0 = _unwrap(_projectTable(_railCenter, date));
    const offsets = _visibleOffsets(topPts0);
    if (offsets.length === 0) return;
    // A world-copy longitude is in view when culling is off or it falls in the
    // padded span. Used to drop off-screen ticks/labels without touching the rails.
    const _inView = (lng) => !_cull || (lng >= _spanW && lng <= _spanE);

    // Twin rails (day-adaptive: split once per rail by day strength, reuse
    // across world copies). Two passes so both casings sit under both brass
    // strokes, preserving the original layering. ---
    const topRuns = GeoUtils.dayStrengthRuns(topPts0, date);
    const botRuns = GeoUtils.dayStrengthRuns(botPts0, date);
    const _railSeg = (run, off) => (off === 0 ? run.pts : run.pts.map((p) => [p[0], p[1] + off]));
    for (const off of offsets) {
      for (const rail of [topRuns, botRuns])
        for (const run of rail) {
          L.polyline(
            _railSeg(run, off),
            Object.assign({}, RAIL_CASING, { color: GeoUtils.lerpHex(COLOR_CASING, HALO_DAY, run.t) })
          ).addTo(_group);
        }
      for (const rail of [topRuns, botRuns])
        for (const run of rail) {
          L.polyline(
            _railSeg(run, off),
            Object.assign({}, RAIL_BRASS, { color: GeoUtils.lerpHex(COLOR_BRASS, COLOR_BRASS_DAY, run.t) })
          ).addTo(_group);
        }
    }

    // ---- Ticks (zoom-tiered) ----
    const z = _map.getZoom();
    const ticks = _tickSetForZoom(z);
    const showTerms = _showSolarTermNames(z);
    const showDegs = _showDegreeLabels(z);

    for (const t of ticks) {
      const casing = t.isMajor ? TICK_MAJOR_CASING : TICK_MINOR_CASING;
      const brass = t.isMajor ? TICK_MAJOR_BRASS : TICK_MINOR_BRASS;
      const half = t.isMajor ? MAJOR_HALF_DEG : MINOR_HALF_DEG;
      const [raT, decT] = _radecAt(t.lambda, +half);
      const [raB, decB] = _radecAt(t.lambda, -half);
      const spT = GeoUtils.subStellarPoint(raT, decT, date);
      const spB = GeoUtils.subStellarPoint(raB, decB, date);
      // Align tick endpoint lngs with the rail's unwrap frame; otherwise
      // subStellarPoint's (-180, 180] wrap can drop a tick into the wrong
      // world copy, hiding it from the +1/−1 panel extents.
      const idx = Math.max(0, Math.min(SAMPLES - 1, Math.round(t.lambda / STEP_DEG)));
      const refLng = centerPts0[idx][1];
      let lngT = spT.lng,
        lngB = spB.lng;
      while (lngT - refLng > 180) lngT -= 360;
      while (lngT - refLng < -180) lngT += 360;
      while (lngB - lngT > 180) lngB -= 360;
      while (lngB - lngT < -180) lngB += 360;
      // Short tick → colour the whole segment by its midpoint day strength.
      const tickT = GeoUtils.dayStrengthAtMid(
        [
          [spT.lat, lngT],
          [spB.lat, lngB],
        ],
        date
      );
      const tickCs = Object.assign({}, casing, { color: GeoUtils.lerpHex(COLOR_CASING, HALO_DAY, tickT) });
      const tickBr = Object.assign({}, brass, { color: GeoUtils.lerpHex(COLOR_BRASS, COLOR_BRASS_DAY, tickT) });
      for (const off of offsets) {
        if (!_inView((lngT + lngB) / 2 + off)) continue;
        const pts = [
          [spT.lat, lngT + off],
          [spB.lat, lngB + off],
        ];
        L.polyline(pts, tickCs).addTo(_group);
        L.polyline(pts, tickBr).addTo(_group);
      }

      // Combined tick label: «立夏 45°» where the locale has a solar-term name,
      // «45°» otherwise. Anchor is the tick's exact center on β=0; the span
      // does a CSS translateX(8px) along the tangent so the visual distance
      // from the tick line is the same at any zoom.
      if (showDegs) {
        let labelText = t.lambda + '°';
        // CJK locales have all 24 solar terms; non-CJK locales only have translations
        // for the 4 cardinal terms (solstices + equinoxes). Without this gate, I18n.t falls
        // back through zh-Hans and the Chinese 立春/立夏/etc would leak into
        // en/fr/es for the cross-quarter terms.
        const isCardinal = t.lambda === 0 || t.lambda === 90 || t.lambda === 180 || t.lambda === 270;
        const hasI18n = typeof I18n !== 'undefined';
        const queryTerm = showTerms && (isCardinal || (hasI18n && I18n.isZhOrJa && I18n.isZhOrJa()));
        if (queryTerm) {
          const termText = I18n.t('solar_term.' + t.termIdx);
          if (termText && termText !== 'solar_term.' + t.termIdx) {
            labelText = termText + ' ' + labelText;
          }
        }
        // Tick center on β=0: midpoint of the two endpoints in lat, and the
        // lng of the β=0 substellar point (lngT and lngB straddle β=0
        // symmetrically by construction, so their midpoint is β=0's lng).
        const tickCenterLat = (spT.lat + spB.lat) / 2;
        const tickCenterLng = (lngT + lngB) / 2;
        const angle = _tangentAtLambda(centerPts0, t.lambda);
        for (const off of offsets) {
          if (!_inView(tickCenterLng + off)) continue;
          const mk = _placeTickLabel(tickCenterLat, tickCenterLng + off, angle, labelText, date).addTo(_group);
          _wireTermLabel(mk, t.lambda);
        }
      }
    }

    // ---- 1° micro-ticks (z ≥ 5) ----
    if (_showMicroTicks(z)) {
      for (let lam = 0; lam < 360; lam++) {
        if (lam % 15 === 0) continue; // already drawn by the major loop
        // Pre-cull off-screen micro-ticks before the (per-λ) subStellarPoint pair:
        // the tick sits at this λ on the rail, so the rail centre's already-
        // projected longitude is a sub-degree-accurate proxy, well inside the ≥1°
        // span padding. Saves the projection work for the ~99% off-screen at z≥10.
        if (_cull) {
          const _cl = centerPts0[Math.max(0, Math.min(SAMPLES - 1, Math.round(lam / STEP_DEG)))][1];
          let _any = false;
          for (const off of offsets) {
            if (_inView(_cl + off)) {
              _any = true;
              break;
            }
          }
          if (!_any) continue;
        }
        const [raT, decT] = _radecAt(lam, +MICRO_HALF_DEG);
        const [raB, decB] = _radecAt(lam, -MICRO_HALF_DEG);
        const spT = GeoUtils.subStellarPoint(raT, decT, date);
        const spB = GeoUtils.subStellarPoint(raB, decB, date);
        // Same unwrap-against-centerPts0 as the major tick loop.
        const idx = Math.max(0, Math.min(SAMPLES - 1, Math.round(lam / STEP_DEG)));
        const refLng = centerPts0[idx][1];
        let lngT = spT.lng,
          lngB = spB.lng;
        while (lngT - refLng > 180) lngT -= 360;
        while (lngT - refLng < -180) lngT += 360;
        while (lngB - lngT > 180) lngB -= 360;
        while (lngB - lngT < -180) lngB += 360;
        const microT = GeoUtils.dayStrengthAtMid(
          [
            [spT.lat, lngT],
            [spB.lat, lngB],
          ],
          date
        );
        const microStyle = Object.assign({}, MICRO_TICK, {
          color: GeoUtils.lerpHex(COLOR_BRASS, COLOR_BRASS_DAY, microT),
        });
        const wireHit = _showMicroHit(z);
        for (const off of offsets) {
          if (!_inView((lngT + lngB) / 2 + off)) continue;
          const pts = [
            [spT.lat, lngT + off],
            [spB.lat, lngB + off],
          ];
          L.polyline(pts, microStyle).addTo(_group);
          // Transparent fat hit band on a low pane (z=190): bodies/stars sit
          // above it, so they always win an overlapping point; the band only
          // catches hover where nothing celestial is on top. Hover-only —
          // bubblingMouseEvents lets clicks fall through to the map.
          if (wireHit) {
            L.polyline(pts, {
              pane: 'ecliptic-hit',
              color: '#000',
              opacity: 0,
              weight: HitWidths.MIN,
              interactive: true,
              bubblingMouseEvents: true,
              noClip: true,
              smoothFactor: 0,
            })
              .addTo(_group)
              .on('mouseover', () => _showMicroLabel(lam, centerPts0, off, date))
              .on('mouseout', () => _hoverGroup.clearLayers());
          }
        }
      }
    }

    // ---- Ecliptic labels — fixed λ between seasonal markers, repeated per world copy ----
    const labelText = typeof I18n !== 'undefined' ? I18n.t('ecliptic.label') : '黄道';
    for (const lam of ECLIPTIC_LABEL_LAMBDAS) {
      const idx = Math.round(lam / STEP_DEG);
      const here = centerPts0[Math.max(0, Math.min(SAMPLES - 1, idx))];
      const angle = _tangentAtLambda(centerPts0, lam);
      for (const off of offsets) {
        if (!_inView(here[1] + off)) continue;
        _placeEclipticLabel(here[0], here[1] + off, angle, labelText, date).addTo(_group);
      }
    }
  }

  // ---- Public API ----
  function init(map) {
    if (_map) return;
    _map = map;
    if (!map.getPane('ecliptic')) {
      map.createPane('ecliptic');
      map.getPane('ecliptic').style.zIndex = '618';
      map.getPane('ecliptic').style.pointerEvents = 'none';
    }
    if (!map.getPane('ecliptic-labels')) {
      map.createPane('ecliptic-labels');
      map.getPane('ecliptic-labels').style.zIndex = '623';
      map.getPane('ecliptic-labels').style.pointerEvents = 'none';
    }
    // Micro-tick hover hit bands live below the deep-sky/star band so stars and
    // bodies keep click/hover priority on overlapping points (see _rebuild).
    if (!map.getPane('ecliptic-hit')) {
      map.createPane('ecliptic-hit');
      map.getPane('ecliptic-hit').style.zIndex = '190';
      map.getPane('ecliptic-hit').style.pointerEvents = 'none';
    }
    _group = L.layerGroup();
    _hoverGroup = L.layerGroup().addTo(map);
  }

  function update(date) {
    if (!_group) return;
    _rebuild(date || (typeof TimeState !== 'undefined' ? TimeState.current : new Date()));
  }

  function addTo(map) {
    if (_group && !map.hasLayer(_group)) map.addLayer(_group);
  }

  function removeFrom(map) {
    if (_group && map.hasLayer(_group)) map.removeLayer(_group);
    if (_hoverGroup) _hoverGroup.clearLayers();
  }

  function isOn() {
    return !!(_map && _group && _map.hasLayer(_group));
  }

  return { init, update, addTo, removeFrom, isOn };
})();
