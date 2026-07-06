/**
 * body-trajectory.js — per-body motion-trajectory overlay (analemma / ground track).
 *
 * Right-clicking a Sun / Moon / planet marker exposes a motion-trajectory toggle that
 * traces where the body's sub-point wanders over a time window, drawn as a wide
 * translucent ribbon with a thin spine, plus clickable disk+time markers at
 * intervals that jump the map clock (TimeState.setTime) to that instant.
 *
 * Two sampling modes, chosen by the body's apparent speed:
 *   'daily'  fixed-clock-time, one sample per day → the analemma figure. Sampling
 *            continuously instead would let Earth's rotation smear the sub-point
 *            across every longitude and fill the tropics into a useless blob. Every
 *            body uses it, the Moon over a short ±5-day window — its ~13°/day drift
 *            still reads as a legible daily arc, and the same-time-of-day sampling
 *            keeps it a where-is-it-each-day track rather than a diurnal ground loop.
 *   'cont'   dense continuous sampling over a short window → a ground track. No body
 *            uses it now; retained for a future body too fast for daily samples to
 *            resolve. It also selects the marker's HH:MM label (daily uses a date).
 *
 * Windows are per-body (≈half a synodic period for planets, a few days for the Moon)
 * so a fixed-clock band sweeps roughly one pass without self-overlapping into a tangle.
 *
 * Public API (BodyTrajectory): init, toggle, isOn, closeAll, activeIds, update,
 *   onViewChange, refreshLocale.
 * Depends on: L, GeoUtils, Planets.getSearchLatLng, TimeState, I18n, AppState,
 *   MAP_LNG_WEST / MAP_LNG_EAST (map.js runtime globals). Comet (optional) supplies
 *   sub-points for `comet:`-prefixed ids and gates their anchor tick.
 */
const BodyTrajectory = (function () {
  const DAY = 86400000;

  // Per-body sampling spec. span = half-window each side of the anchor; step =
  // sample spacing; markEvery = the *coarsest* (low-zoom) spacing between tick
  // markers — the actual cadence densifies toward 1 day as zoom deepens (see
  // _markEveryDays), so this is the widest a tick gap ever gets. A multiple of step,
  // so marker instants land exactly on sampled points, including the anchor.
  // Planet spans are half their original synodic-period-derived window — the full
  // window read as visually too long. The Sun window is unchanged; the Moon is a
  // short ±5-day daily analemma (was a ±24h continuous ground track), so it now
  // shows where its sub-point falls on the surrounding days at the current instant.
  const SPECS = {
    sun: { mode: 'daily', span: 183 * DAY, step: DAY, markEvery: 30 * DAY },
    moon: { mode: 'daily', span: 5 * DAY, step: DAY, markEvery: DAY },
    mercury: { mode: 'daily', span: 29 * DAY, step: DAY, markEvery: 7 * DAY },
    venus: { mode: 'daily', span: 75 * DAY, step: DAY, markEvery: 14 * DAY },
    mars: { mode: 'daily', span: 91 * DAY, step: DAY, markEvery: 30 * DAY },
    jupiter: { mode: 'daily', span: 91 * DAY, step: DAY, markEvery: 30 * DAY },
    saturn: { mode: 'daily', span: 91 * DAY, step: DAY, markEvery: 30 * DAY },
    uranus: { mode: 'daily', span: 91 * DAY, step: DAY, markEvery: 30 * DAY },
    neptune: { mode: 'daily', span: 91 * DAY, step: DAY, markEvery: 30 * DAY },
    // ±100 days shows the retrograde loop around opposition for main-belt bodies.
    ceres: { mode: 'daily', span: 100 * DAY, step: DAY, markEvery: 30 * DAY },
    pallas: { mode: 'daily', span: 100 * DAY, step: DAY, markEvery: 30 * DAY },
    vesta: { mode: 'daily', span: 100 * DAY, step: DAY, markEvery: 30 * DAY },
  };

  // Ribbon tint per body — mirrors each body's characteristic marker colour
  // (planet CONFIGS / Sun glow / Moon glow) so the trajectory reads as "belonging"
  // to that body without a legend.
  const COLORS = {
    sun: '#fde68a',
    moon: '#94a3b8',
    mercury: '#a8a29e',
    venus: '#f59e0b',
    mars: '#ef4444',
    jupiter: '#f97316',
    saturn: '#eab308',
    uranus: '#9fc9dc',
    neptune: '#6ea0d8',
    // Asteroid ribbon matches the on-map dot colour (muted warm beige).
    ceres: '#d8cfbf',
    pallas: '#d8cfbf',
    vesta: '#d8cfbf',
  };

  // Comets aren't a fixed roster like the planets/asteroids — they load from JSON at
  // runtime — so instead of a static SPECS/COLORS entry each, a comet trajectory id
  // carries a `comet:` prefix and resolves to one shared spec and tint. The prefix is
  // recognised purely syntactically (no roster lookup), so a permalink `?traj=comet:12p`
  // restores at boot before the comet data has finished loading. A ±45-day daily window
  // stays legible near perihelion, where a wider one would smear into a dense tangle.
  const COMET_SPEC = { mode: 'daily', span: 45 * DAY, step: DAY, markEvery: 15 * DAY };
  const COMET_COLOR = '#67e8f9'; // aqua — echoes the comet symbol's green, clear of the satellite bronze-green

  // Tick cadence adapts to zoom: whole-day spacings from this ladder, chosen so
  // adjacent ticks clear ~TICK_MIN_PX on screen. Densifies toward 1 day as zoom
  // deepens; never coarser than the body's SPECS.markEvery (its low-zoom cadence).
  const TICK_LADDER = [1, 2, 3, 5, 7, 10, 14, 15, 30, 60, 90];
  const TICK_MIN_PX = 80;

  function _isComet(id) {
    return typeof id === 'string' && id.slice(0, 6) === 'comet:';
  }

  function _specFor(id) {
    return SPECS[id] || (_isComet(id) ? COMET_SPEC : null);
  }

  function _colorFor(id) {
    return COLORS[id] || (_isComet(id) ? COMET_COLOR : '#cbd5e1');
  }

  const BAND_PANE = 'body-trajectory';
  const MARK_PANE = 'body-trajectory-markers';

  let _map = null;
  // id → { band, marks: LayerGroup, table: [{t,lat,lng}] (daily, drives marks),
  //        bandTable: [{lat,lng}] (densified, drives the ribbon), anchor: ms, geomKey }
  const _active = new Map();
  let _lastAnchor = null;
  let _pending = false;
  let _pendingDate = null;

  // ---- Sampling ----
  // Build the sub-point table for `id` centred on `anchor`. Daily mode steps by
  // whole days from the anchor's exact millisecond, so every sample keeps the
  // anchor's time-of-day (that fixed clock time is what makes the analemma); cont
  // mode steps by minutes. Samples outside the supported clock range are dropped.
  function _buildTable(id, anchor) {
    const spec = _specFor(id);
    const t0 = anchor.getTime();
    const out = [];
    for (let dt = -spec.span; dt <= spec.span; dt += spec.step) {
      const ms = t0 + dt;
      const d = new Date(ms);
      if (TimeState.clampDate(d).getTime() !== ms) continue; // outside 2000–2099
      const sp = Planets.getSearchLatLng(id, d);
      if (!sp) continue;
      out.push({ t: ms, lat: sp.lat, lng: sp.lng });
    }
    return out;
  }

  // ---- Band Densification ----
  // A daily sample keeps the anchor's clock time, so between two adjacent days a fast
  // comet near perihelion can sweep >10° of sky and the band draws a chain of long
  // chords with visible corners. Refine ONLY the band polyline — the marks stay on the
  // daily base table, whose tick cadence (_markEveryDays / _renderMarks) assumes exactly
  // one sample per day — by inserting sub-day points wherever a segment's on-sphere span
  // exceeds a small angle, recursing to a floor step.
  //
  // The subtlety: the sub-point band is continuous only at the fixed clock time. A
  // sample taken f of a day later sits ~f·360° off in longitude from Earth's rotation,
  // so its longitude is advanced by f·360° to undo that whole turn and land it back on
  // the same analemma between its neighbours. A full turn (not the 360.9856° sidereal
  // day) is used deliberately: it rejoins both day nodes exactly, leaving only a ≤0.5°
  // residual mid-segment that never shows — using the sidereal figure would instead
  // leave a ~1° gap at every node, a corner at each one, defeating the refinement.
  const DENSIFY_GAP_DEG = 2.5; // coarse ceiling on chord length between band points
  // Split threshold on the midpoint's deviation from its sub-chord. The deflection
  // that survives between adjacent kept vertices runs ~1.5× this (the gate measures
  // a span, the eye sees the per-vertex turn), so 1.5° here keeps every visible fold
  // under ~3° — the target — even where near-perihelion angular speed spikes.
  const DENSIFY_FOLD_DEG = 1.5;
  const DENSIFY_MIN_FRAC = 1 / 144; // never sample finer than ~10 min of a day (safety floor)
  const DENSIFY_MAX_DEPTH = 10; // and never recurse deeper than this (safety floor)

  function _angGapDeg(a, b) {
    const D2R = Math.PI / 180;
    const dLng = _wrapDiff(b.lng - a.lng) * D2R;
    const la = a.lat * D2R;
    const lb = b.lat * D2R;
    const cosd = Math.sin(la) * Math.sin(lb) + Math.cos(la) * Math.cos(lb) * Math.cos(dLng);
    return Math.acos(Math.max(-1, Math.min(1, cosd))) / D2R;
  }

  // Deflection (fold) angle of the polyline at vertex b: 180° minus the interior
  // angle a–b–c on the sphere, so 0° when the three points are collinear and rising
  // as the corner sharpens. Measuring the actual turn — not merely chord length —
  // is what lets the densifier promise "no visible corner": chord length alone
  // leaves sharp bends between short segments near perihelion.
  function _foldDeg(a, b, c) {
    const D2R = Math.PI / 180;
    const bearing = (p, q) => {
      const p1 = p.lat * D2R;
      const p2 = q.lat * D2R;
      const dL = _wrapDiff(q.lng - p.lng) * D2R;
      const y = Math.sin(dL) * Math.cos(p2);
      const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dL);
      return Math.atan2(y, x);
    };
    let interior = Math.abs(bearing(b, a) - bearing(b, c)) / D2R;
    if (interior > 180) interior = 360 - interior;
    return 180 - interior;
  }

  function _sampleBand(id, tA, aLng, f) {
    const sp = Planets.getSearchLatLng(id, new Date(tA + f * DAY));
    if (!sp) return null;
    // Undo the f·360° whole-turn of rotation, then fold into aLng's wrap copy so the
    // interior point sits beside its day-anchor, not a world away in raw longitude.
    const lng = aLng + _wrapDiff(sp.lng + f * 360 - aLng);
    return { lat: sp.lat, lng };
  }

  function _subdivideBand(id, tA, aLng, fLo, pLo, fHi, pHi, out, depth) {
    if (depth >= DENSIFY_MAX_DEPTH || fHi - fLo <= DENSIFY_MIN_FRAC) return;
    const fMid = (fLo + fHi) / 2;
    const pMid = _sampleBand(id, tA, aLng, fMid);
    if (!pMid) return;
    // Keep splitting while the span is too wide OR the midpoint bends the ribbon
    // past the fold cap; stop only once it is both short and near-straight, in
    // which case pMid adds nothing and the chord pLo–pHi stands as drawn.
    if (_angGapDeg(pLo, pHi) <= DENSIFY_GAP_DEG && _foldDeg(pLo, pMid, pHi) <= DENSIFY_FOLD_DEG) return;
    _subdivideBand(id, tA, aLng, fLo, pLo, fMid, pMid, out, depth + 1);
    out.push(pMid);
    _subdivideBand(id, tA, aLng, fMid, pMid, fHi, pHi, out, depth + 1);
  }

  // Fine polyline for the band (comets only — the sole roster with per-day sky motion
  // fast enough to corner). Returns the daily base unchanged for everything else.
  function _densifyBand(id, base) {
    if (!_isComet(id) || base.length < 2) return base;
    const out = [];
    for (let i = 0; i < base.length - 1; i++) {
      const A = base[i];
      const B = base[i + 1];
      out.push({ lat: A.lat, lng: A.lng });
      // Only refine a real one-day segment; a wider gap is a dropped out-of-range
      // sample, not a chord to smooth. B is measured in A's unwrapped frame.
      if (Math.round((B.t - A.t) / DAY) === 1) {
        const pB = { lat: B.lat, lng: A.lng + _wrapDiff(B.lng - A.lng) };
        _subdivideBand(id, A.t, A.lng, 0, { lat: A.lat, lng: A.lng }, 1, pB, out, 0);
      }
    }
    const last = base[base.length - 1];
    out.push({ lat: last.lat, lng: last.lng });
    return out;
  }

  // ---- Viewport Longitude Culling ----
  // Same rule as great-circle-layer: with noClip a full band emits every vertex
  // as one zoom-animated path regardless of zoom, so at high zoom clip each run to
  // the visible longitude window (± one viewport width) and keep one point past
  // each boundary so the stroke still reaches the edge.
  function _clipSegToSpan(seg, spanW, spanE) {
    const out = [];
    let cur = null;
    for (let i = 0; i < seg.length; i++) {
      const lng = seg[i][1];
      if (lng >= spanW && lng <= spanE) {
        if (!cur) {
          cur = [];
          if (i > 0) cur.push(seg[i - 1]);
        }
        cur.push(seg[i]);
      } else if (cur) {
        cur.push(seg[i]);
        out.push(cur);
        cur = null;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  // Split a continuity-unwrapped table into runs no wider than 360° of longitude.
  // Wrap-offset placement (both here and GeoUtils.visibleWrapOffsets) assumes a run's
  // own span is a single pass around the globe; feeding it a >360°-wide run makes
  // almost every offset look like it "overlaps" the visible window (the run's own
  // bounding box is nearly as wide as the check range), so unrelated stretches of the
  // curve get redrawn on top of each other at multiple shifts instead of each world
  // copy showing just the one real pass that belongs there. No current body's window
  // spans a full revolution now that every body samples daily (a continuous ground
  // track would — the Moon's spin-dominated ±24h track once covered ~700°), but the
  // split still earns its keep: a daily band that straddles the antimeridian unwraps
  // past ±180°. Chunks share their boundary point so consecutive runs still join
  // visually when they resolve to the same offset.
  function _chunkBySpan(pts) {
    const chunks = [];
    let start = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i][1] - pts[start][1]) > 180) {
        chunks.push(pts.slice(start, i + 1));
        start = i;
      }
    }
    chunks.push(pts.slice(start));
    return chunks;
  }

  // Longitude window markers and band segments are both kept inside — one viewport
  // width of slack past each edge, or unbounded at low zoom. Sharing this between
  // _renderBand and _renderMarks matters: visibleWrapsFromBounds/MAP_LNG_WEST/EAST
  // alone are far wider than this window at high zoom, so a marker computed against
  // them alone could survive while the band segment through the same point gets
  // clipped away by _clipSegToSpan — a tick+label floating with no ribbon under it.
  function _cullSpan() {
    const b = _map.getBounds();
    const vw = b.getEast() - b.getWest();
    const cull = vw < 90;
    return {
      cull,
      spanW: cull ? Math.floor(b.getWest() - vw) : -Infinity,
      spanE: cull ? Math.ceil(b.getEast() + vw) : Infinity,
    };
  }

  // ---- Ribbon Rendering ----
  function _renderBand(id, st) {
    st.band.clearLayers();
    const src = st.bandTable || st.table;
    if (!src || src.length < 2) return;
    const color = _colorFor(id);
    const pts = src.map((r) => [r.lat, r.lng]);
    const unw = GeoUtils.unwrapLngContinuity(pts);
    const chunks = _chunkBySpan(unw);
    const { cull, spanW, spanE } = _cullSpan();

    for (const chunk of chunks) {
      if (chunk.length < 2) continue;
      const offsets = GeoUtils.visibleWrapOffsets(chunk, _map);
      for (const off of offsets) {
        const seg = off === 0 ? chunk : chunk.map((p) => [p[0], p[1] + off]);
        const subs = cull ? _clipSegToSpan(seg, spanW, spanE) : [seg];
        for (const sub of subs) {
          if (sub.length < 2) continue;
          // A single body-tinted line: a wide, near-transparent wash for a soft
          // glow plus a fine spine for the crisp centre. Body-tinted so
          // simultaneous trajectories keep their identity.
          L.polyline(sub, {
            pane: BAND_PANE,
            color: color,
            weight: 13,
            opacity: 0.09,
            lineCap: 'round',
            lineJoin: 'round',
            smoothFactor: 0,
            noClip: true,
            interactive: false,
          }).addTo(st.band);
          L.polyline(sub, {
            pane: BAND_PANE,
            color: color,
            weight: 1.2,
            opacity: 0.7,
            lineCap: 'round',
            smoothFactor: 0,
            noClip: true,
            interactive: false,
          }).addTo(st.band);
        }
      }
    }
  }

  // ---- Marker Rendering ----
  // anchorYear is the trajectory's centre year (st.anchor's year, i.e. "now" for
  // this trajectory) — the year is only spelled out when a marker falls outside it,
  // so a window that crosses a year boundary (any planet anchored near Dec/Jan, or
  // the Moon on New Year's Eve/Day) doesn't silently mislabel which year a date is in.
  function _fmtLabel(id, ms, anchorYear) {
    const loc = typeof I18n !== 'undefined' && I18n.getLocale ? I18n.getLocale() : 'en';
    const tz = typeof TimeState !== 'undefined' ? TimeState.timezone : undefined;
    const showYear = new Date(ms).getFullYear() !== anchorYear;
    const opts =
      _specFor(id).mode === 'cont'
        ? Object.assign(
            { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false },
            showYear ? { year: 'numeric', month: 'short', day: 'numeric' } : {}
          )
        : Object.assign({ timeZone: tz, month: 'short', day: 'numeric' }, showYear ? { year: 'numeric' } : {});
    try {
      return new Intl.DateTimeFormat(loc, opts).format(new Date(ms));
    } catch (_) {
      return '';
    }
  }

  function _markerIcon(id, ms, anchorYear, angleDeg) {
    const color = _colorFor(id);
    const html =
      '<span class="btraj-tick"></span><span class="btraj-time">' + _fmtLabel(id, ms, anchorYear) + '</span>';
    // The wrap is a zero-size point anchored on the sub-point (iconAnchor [0,0]); its
    // tick and label are absolutely placed around that origin and rotated together by
    // the trajectory's on-screen tangent, so the tick crosses the ribbon perpendicularly
    // and the date runs parallel to it. --btang is pre-normalised to [-90°,90°] upstream,
    // keeping the label upright.
    return L.divIcon({
      className: 'btraj-marker',
      html:
        '<span class="btraj-disk-wrap" style="--btc:' +
        color +
        ';--btang:' +
        angleDeg.toFixed(1) +
        'deg">' +
        html +
        '</span>',
      iconSize: null,
      iconAnchor: [0, 0],
    });
  }

  // Whether the body paints a live on-map marker at its current sub-point. Sun,
  // Moon, and planets always do, so their anchor tick stays suppressed (it would only
  // occlude that marker). An asteroid dot can be absent — fainter than the zoom-
  // adaptive cutoff, or the layer off — and then the anchor tick is the ribbon's only
  // current-position cue, so keep it.
  function _bodyPaintsMarkerNow(id, anchorMs) {
    if (
      (id === 'ceres' || id === 'pallas' || id === 'vesta') &&
      typeof Asteroids !== 'undefined' &&
      Asteroids.isDotVisible
    ) {
      return Asteroids.isDotVisible(id, new Date(anchorMs));
    }
    // A comet paints its own symbol only while its layer is on; with it off the anchor
    // tick is the ribbon's sole "now" cue, so keep it.
    if (_isComet(id)) {
      return typeof Comet !== 'undefined' && Comet.isOn && Comet.isOn();
    }
    return true;
  }

  // Signed longitude delta wrapped to (-180°,180°], so a tangent taken across the
  // antimeridian (e.g. +179°→-179°) reads as the short step it visually is, not a
  // near-360° jump that would flip the marker's rotation.
  function _wrapDiff(d) {
    return ((((d + 180) % 360) + 360) % 360) - 180;
  }

  // On-screen tangent angle (deg) of the ribbon at sample index `i`, from its adjacent
  // samples projected to layer pixels (endpoints fall back to a one-sided slope). The
  // result is folded into [-90°,90°]: the tick is symmetric so a 180° flip keeps it
  // perpendicular, and the label stays upright rather than reading upside-down.
  function _markAngle(tbl, i) {
    const r = tbl[i];
    const a = tbl[i - 1] || r;
    const b = tbl[i + 1] || r;
    if (a === b) return 0;
    const la = _map.latLngToLayerPoint([a.lat, r.lng + _wrapDiff(a.lng - r.lng)]);
    const lb = _map.latLngToLayerPoint([b.lat, r.lng + _wrapDiff(b.lng - r.lng)]);
    let ang = (Math.atan2(lb.y - la.y, lb.x - la.x) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    else if (ang <= -90) ang += 180;
    return ang;
  }

  // Whole-day tick spacing for the current zoom: the finest ladder cadence whose
  // adjacent ticks still clear ~TICK_MIN_PX on screen, capped at the body's base
  // (low-zoom) markEvery and floored at 1 day. px/day is the median projected step
  // between the daily samples — the median rather than the near-anchor step so a
  // retrograde stationary point (px/day → 0 there) can't force the whole ribbon to
  // the coarsest cadence.
  function _markEveryDays(id, tbl) {
    const baseDays = Math.round(_specFor(id).markEvery / DAY);
    if (baseDays <= 1 || tbl.length < 2) return baseDays; // Moon etc. already daily
    const steps = [];
    for (let i = 1; i < tbl.length; i++) {
      const a = tbl[i - 1];
      const b = tbl[i];
      const pa = _map.latLngToLayerPoint([a.lat, a.lng]);
      const pb = _map.latLngToLayerPoint([b.lat, a.lng + _wrapDiff(b.lng - a.lng)]);
      steps.push(Math.hypot(pb.x - pa.x, pb.y - pa.y));
    }
    steps.sort((x, y) => x - y);
    const pxPerDay = steps[steps.length >> 1];
    if (!pxPerDay) return baseDays;
    const desired = TICK_MIN_PX / pxPerDay; // days needed to clear the min gap
    for (const d of TICK_LADDER) {
      if (d >= baseDays) return baseDays;
      if (d >= desired) return d;
    }
    return baseDays;
  }

  function _renderMarks(id, st) {
    st.marks.clearLayers();
    if (!st.table) return;
    const offsets = GeoUtils.visibleWrapsFromBounds(_map);
    const anchorYear = new Date(st.anchor).getFullYear();
    const { cull, spanW, spanE } = _cullSpan();
    const lo = cull ? Math.max(MAP_LNG_WEST, spanW) : MAP_LNG_WEST;
    const hi = cull ? Math.min(MAP_LNG_EAST, spanE) : MAP_LNG_EAST;
    const paintsNow = _bodyPaintsMarkerNow(id, st.anchor);
    const tbl = st.table;
    const markEveryDays = _markEveryDays(id, tbl);
    // Insert markers nearest the anchor first. The label-collider hides the lower of
    // two overlapping same-priority labels by DOM order (first placed wins), so where a
    // slow arc bunches marks on screen, this keeps the dates around "now" and drops the
    // outlying ones — more useful than letting whichever end sampled first survive.
    const order = tbl.map((_, i) => i).sort((p, q) => Math.abs(tbl[p].t - st.anchor) - Math.abs(tbl[q].t - st.anchor));
    for (const i of order) {
      const r = tbl[i];
      // A tick lands on every markEveryDays-th day out from the anchor (day 0 always
      // qualifies). Skip the anchor instant only when the body paints its own marker
      // there — the tick would just occlude it. When no dot renders (faint asteroid
      // past the zoom cutoff, or its layer off), keep the anchor tick as the "now" cue.
      const days = Math.round((r.t - st.anchor) / DAY);
      if (days % markEveryDays !== 0 || (r.t === st.anchor && paintsNow)) continue;
      // Tangent is offset-invariant (both neighbours shift by the same wrap), so it is
      // computed once per sample and reused across the visible world copies below.
      const angle = _markAngle(tbl, i);
      for (const off of offsets) {
        const wLng = r.lng + off;
        if (wLng < lo || wLng > hi) continue;
        const m = L.marker([r.lat, wLng], {
          pane: MARK_PANE,
          icon: _markerIcon(id, r.t, anchorYear, angle),
          interactive: true,
          keyboard: false,
          bubblingMouseEvents: false,
        });
        // Jump the whole map to this instant. The marker's icon opts back into
        // pointer events (its pane is pointer-events:none), so Leaflet's own click
        // wiring delivers here; setTime clamps out-of-range jumps itself.
        m.on(
          'click',
          (function (t) {
            return function (ev) {
              L.DomEvent.stop(ev);
              if (typeof TimeState !== 'undefined') TimeState.setTime(new Date(t));
            };
          })(r.t)
        );
        m.addTo(st.marks);
      }
    }
  }

  // ---- Rebuild Orchestration ----
  function _geomKey() {
    const loc = typeof I18n !== 'undefined' && I18n.getLocale ? I18n.getLocale() : '';
    return GeoUtils.viewportRebuildKey(_map) + '|' + loc;
  }

  function _rebuildOne(id, st, date, rebuildTable) {
    if (rebuildTable || !st.table) {
      st.table = _buildTable(id, date);
      st.bandTable = _densifyBand(id, st.table);
      st.anchor = date.getTime();
      st.geomKey = null; // force geometry to follow the fresh table
    }
    const gk = _geomKey();
    if (!rebuildTable && st.geomKey === gk) return; // view + locale unchanged
    st.geomKey = gk;
    _renderBand(id, st);
    _renderMarks(id, st);
  }

  function _rebuildAll(date, rebuildTable) {
    _lastAnchor = date;
    _active.forEach((st, id) => _rebuildOne(id, st, date, rebuildTable));
  }

  // ---- Public API ----
  function init(map) {
    if (_map) return;
    _map = map;
    if (!map.getPane(BAND_PANE)) {
      map.createPane(BAND_PANE);
      map.getPane(BAND_PANE).style.zIndex = '619'; // above ecliptic line (618), below its labels
      map.getPane(BAND_PANE).style.pointerEvents = 'none';
    }
    if (!map.getPane(MARK_PANE)) {
      map.createPane(MARK_PANE);
      map.getPane(MARK_PANE).style.zIndex = '760'; // above planet labels (720–752), below satellites (800)
      // Pane stays click-through; each marker icon re-enables pointer events via CSS.
      map.getPane(MARK_PANE).style.pointerEvents = 'none';
    }
    // A discrete jump (event card, ecliptic term) clears the overlay so navigating
    // to an event starts clean; the card then reopens just its own bodies. Slider
    // scrub, playback, and the markers' own click-to-jump stay on setTime, so they
    // leave open trajectories in place.
    if (typeof TimeState !== 'undefined' && TimeState.subscribeJump) {
      TimeState.subscribeJump(closeAll);
    }
    // Persist open trajectories in the permalink (?traj=mars,uranus). Registered in
    // init — which runs before AppState.applyFromURL — so a restored ?traj is honoured;
    // toggling fires layeradd/layerremove, so AppState's throttle picks up changes.
    if (typeof AppState !== 'undefined' && AppState.registerParam) {
      AppState.registerParam('traj', {
        get: () => {
          const a = activeIds();
          return a.length ? a.join(',') : null;
        },
        set: (v) => {
          v.split(',').forEach((id) => {
            if (_specFor(id) && !isOn(id)) toggle(id);
          });
        },
      });
    }
  }

  // Close every open trajectory at once (discrete-jump reset — see the subscribeJump
  // wiring in init). Clears the layers and the active map in one pass.
  function closeAll() {
    _active.forEach((st) => {
      _map.removeLayer(st.band);
      _map.removeLayer(st.marks);
    });
    _active.clear();
  }

  // Active trajectory ids in insertion order — the permalink `traj` getter's source.
  function activeIds() {
    return [..._active.keys()];
  }

  // Toggle a body's trajectory on/off. Rebuilds immediately (bypassing the
  // playback freeze / debounce) so the user gets instant feedback on the click.
  function toggle(id) {
    if (!_map || !_specFor(id)) return false;
    if (_active.has(id)) {
      const st = _active.get(id);
      _map.removeLayer(st.band);
      _map.removeLayer(st.marks);
      _active.delete(id);
      return false;
    }
    const st = { band: L.layerGroup(), marks: L.layerGroup(), table: null, anchor: 0, geomKey: null };
    _active.set(id, st);
    st.band.addTo(_map);
    st.marks.addTo(_map);
    // Establish the module anchor on open so a later onViewChange can reproject
    // this freshly built table. A jump-to-event toggles the trajectory while its
    // animated flyTo is still mid-flight (sub-point off the old screen → culled to
    // nothing); without _lastAnchor set here, onViewChange early-returns on the
    // session's first-opened trajectory and the ribbon never re-renders at the
    // settled viewport.
    _lastAnchor = TimeState.current;
    _rebuildOne(id, st, _lastAnchor, true);
    return true;
  }

  function isOn(id) {
    return _active.has(id);
  }

  // Time-change hook. Frozen during playback (a static reference band the live
  // body travels along beats recomputing hundreds of ephemeris points per frame);
  // otherwise debounced so a burst of setTime calls (slider scrub) collapses to one.
  function update(date) {
    if (_active.size === 0) return;
    if (typeof TimeState !== 'undefined' && TimeState.isPlaying && TimeState.isPlaying()) return;
    _pendingDate = date || TimeState.current;
    if (_pending) return;
    _pending = true;
    setTimeout(() => {
      _pending = false;
      _rebuildAll(_pendingDate, true);
    }, 100);
  }

  // Pan/zoom hook — geometry only, reusing cached sub-point tables (a fixed date's
  // sub-points don't move; only which wraps are visible and the clip window do).
  function onViewChange() {
    if (_active.size === 0 || !_lastAnchor) return;
    _rebuildAll(_lastAnchor, false);
  }

  // Locale hook — re-render so month/hour labels switch language (pane HTML is
  // frozen until rebuilt). geomKey carries the locale, so this is not an early return.
  function refreshLocale() {
    if (_active.size === 0) return;
    _rebuildAll(_lastAnchor || TimeState.current, false);
  }

  return { init, toggle, isOn, closeAll, activeIds, update, onViewChange, refreshLocale };
})();
