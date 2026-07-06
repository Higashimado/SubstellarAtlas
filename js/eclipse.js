/**
 * Eclipse runtime — real-time shadow computation via Astronomy Engine.
 *
 * Solar shadow: Besselian footprint shared with the cached contact curves (via
 * js/bessel-runtime.js); a legacy sphere intersection is kept as fallback only.
 *
 * Lunar visibility: render the hemisphere centered on the sub-lunar point
 * during a lunar eclipse — "where the Moon is above the horizon", NOT the
 * night side (the Sun-set criterion is unrelated).
 */
const Eclipse = (() => {
  const R_EARTH = 6371; // km, mean radius
  const R_MOON = 1737.4;
  const R_SUN = 695700;
  const AU = 1.495978707e8; // km

  let solarEvents = [];
  let lunarEvents = [];
  let besselPolys = {}; // date → NASA Besselian polynomial (bessel-poly.json)
  let _loaded = false;
  let _callbacks = [];
  // init() stashes its controller here so the sidebar-facing public API
  // (openEvent) can drive the map + browse list without re-plumbing map.js.
  let _pub = null;

  // Map reference + per-redraw viewport snapshot, used by addPolyline to skip
  // world-wrap copies that fall entirely outside the current viewport. Set once
  // per draw pass (drawContactCurves / redrawShadow) so individual addPolyline
  // calls don't each hit map.getBounds(). _curveViewport === null disables
  // culling (no map ref yet, e.g. tests) → draw every wrap as before.
  let _map = null;
  let _curveViewport = null; // { west, east } in degrees, margin already applied

  // Densification ceiling for the real-time solar shadow (umbra + iso/penumbra +
  // terminator — one family, one knob). At zoom ≥ Z_CAP the densify density and
  // umbra seed-azimuth count are frozen, so geometry is byte-identical and the
  // redraw can reuse it (redrawShadow's zoom-reuse gate shares this constant).
  const Z_CAP = 9;

  // Longitude span of the current viewport, padded by marginDeg on each side.
  function viewportLngSpan(map, marginDeg) {
    const b = map.getBounds();
    return { west: b.getWest() - marginDeg, east: b.getEast() + marginDeg };
  }

  // Half-viewport margin: a curve vertex stays drawn across a moderate pan
  // before the wrap-key flips and triggers a rebuild, so it never pops in at the
  // screen edge between rebuilds.
  function curveMargin(map) {
    const b = map.getBounds();
    return (b.getEast() - b.getWest()) * 0.5;
  }

  // Coarse viewport key (integer-degree west,east) for the moveend short-circuit.
  function curveWrapsKey(map) {
    const b = map.getBounds();
    return Math.round(b.getWest()) + ',' + Math.round(b.getEast());
  }

  // ---- Data Loading ----

  function loadData(cb) {
    if (_loaded) {
      cb && cb();
      return;
    }
    _callbacks.push(cb);
    if (_callbacks.length > 1) return;
    Promise.all([
      fetch('data/eclipses/solar.json').then((r) => r.json()),
      fetch('data/eclipses/lunar.json').then((r) => r.json()),
      // NASA Besselian polynomials for the few events that have them; everything
      // else is computed live from Astronomy Engine. Failure is non-fatal —
      // those events just fall back to the AE-direct path.
      fetch('data/eclipses/bessel-poly.json')
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    ])
      .then(([s, l, bp]) => {
        solarEvents = s;
        lunarEvents = l;
        besselPolys = bp || {};
        // Pre-parse the P1/P4 contact bounds once — findActiveSolar/findActiveLunar
        // run on every TimeState tick, so per-tick ISO re-parsing was a hot path.
        for (const e of solarEvents) {
          e._p1Ms = Date.parse(e.p1);
          e._p4Ms = Date.parse(e.p4);
        }
        for (const e of lunarEvents) {
          const t = e.times || {};
          e._p1Ms = t.p1 ? Date.parse(t.p1) : NaN;
          e._p4Ms = t.p4 ? Date.parse(t.p4) : NaN;
        }
        _loaded = true;
        _callbacks.forEach((fn) => fn && fn());
        _callbacks = [];
      })
      .catch((err) => {
        console.warn('[Eclipse] data load failed:', err);
        _callbacks = [];
      });
  }

  // ---- Solar Shadow Geometry (Real-Time) ----
  //
  // The shadow footprint uses the SAME Besselian geometry as the cached contact
  // curves (js/bessel-runtime.js), so the live umbra/antumbra and iso-mag rings
  // stay tangent to the cached curves. The legacy sphere approximation below is a
  // fallback only.

  // Besselian path — returns { b (elements), sub, isTotal }. sub is null when
  // the shadow axis doesn't intersect Earth (partial eclipses, or partial phases
  // P1→U1 / U4→P4 of total/annular eclipses); penumbra/iso-mag rings are still
  // rendered via projectRing's per-azimuth boundary search.
  function computeSolarShadow(date, event) {
    const poly = event && besselPolys[event.date];
    const b = poly
      ? BesselRT.evalBessel(poly, date) // NASA-transcribed (4 events)
      : BesselRT.coreBesselAE(Astronomy, date); // AE-direct (== build)
    const sub = BesselRT.fundamentalToGeo(b.x, b.y, b);
    return { b, sub, isTotal: b.l2 < 0 };
  }

  // Legacy sphere approximation (fallback only).
  function computeSolarShadowSphere(date) {
    const sun = Astronomy.GeoVector(Astronomy.Body.Sun, date, false);
    const moon = Astronomy.GeoMoon(date);
    const M = { x: moon.x * AU, y: moon.y * AU, z: moon.z * AU };
    const S = { x: sun.x * AU, y: sun.y * AU, z: sun.z * AU };

    // Umbra cone axis: ray from Moon away from Sun
    const dx = M.x - S.x,
      dy = M.y - S.y,
      dz = M.z - S.z;
    const dlen = Math.hypot(dx, dy, dz);
    const ax = dx / dlen,
      ay = dy / dlen,
      az = dz / dlen;

    // Earth (sphere) intersection: |M + λa|² = R_EARTH²
    const b = 2 * (M.x * ax + M.y * ay + M.z * az);
    const c = M.x * M.x + M.y * M.y + M.z * M.z - R_EARTH * R_EARTH;
    const disc = b * b - 4 * c;
    if (disc < 0) return null; // umbra has left Earth — render nothing
    const lam = (-b - Math.sqrt(disc)) / 2;
    if (lam < 0) return null;

    const P = { x: M.x + lam * ax, y: M.y + lam * ay, z: M.z + lam * az };

    // Sub-shadow lat/lng (account for Earth's sidereal rotation)
    const gast = Astronomy.SiderealTime(date) * 15;
    const lon0 = (Math.atan2(P.y, P.x) * 180) / Math.PI;
    const lat = (Math.asin(P.z / R_EARTH) * 180) / Math.PI;
    const lng = ((lon0 - gast + 540) % 360) - 180;

    // Cone half-angles (topocentric apparent angular radii)
    const dMP = Math.hypot(M.x - P.x, M.y - P.y, M.z - P.z);
    const dSP = Math.hypot(S.x - P.x, S.y - P.y, S.z - P.z);
    const moonAng = Math.atan(R_MOON / dMP);
    const sunAng = Math.atan(R_SUN / dSP);
    const isTotal = moonAng >= sunAng;

    // Surface tilt — incidence angle between umbra axis and surface normal at P
    const cosI = Math.abs(ax * P.x + ay * P.y + az * P.z) / R_EARTH;
    const tilt = Math.max(cosI, 0.2); // clamp at limb

    const umbraR = (Math.abs(moonAng - sunAng) * dMP) / tilt;
    const penumbraR = ((moonAng + sunAng) * dMP) / tilt;

    return { lat, lng, umbraKm: umbraR, penumbraKm: penumbraR, isTotal };
  }

  // ---- Helpers ----

  function findActiveSolar(date) {
    const ms = date.getTime();
    for (const e of solarEvents) {
      if (ms >= e._p1Ms && ms <= e._p4Ms) return e; // NaN bounds compare false
    }
    return null;
  }

  function findActiveLunar(date) {
    const ms = date.getTime();
    for (const e of lunarEvents) {
      if (ms >= e._p1Ms && ms <= e._p4Ms) return e; // NaN bounds compare false
    }
    return null;
  }

  // Umbral-eclipse "redness" for the moonlight veil tint (map.js reads this).
  // 0 = no umbral phase active … 1 = deepest red.
  //   Total   eclipse: FULL red throughout totality (U2..U3); linear ramp
  //                    across the partial ingress (U1..U2) and egress (U3..U4).
  //   Partial eclipse: no totality → triangular ramp peaking at the umbral
  //                    magnitude (<1) at greatest.
  //   Penumbral-only (no U contacts): 0 — too faint to tint.
  function lunarRedness(date) {
    // Lazy-load the catalog so the moonlight veil can redden during normal
    // sky viewing without the (mutually-exclusive) Eclipses overlay being on.
    // First call kicks off the fetch and returns 0; the next TimeState tick
    // (mask rebuild) picks up the loaded data.
    if (!_loaded) {
      loadData();
      return 0;
    }
    const e = findActiveLunar(date);
    if (!e) return 0;
    const t = date.getTime();
    const T = e.times || {};
    const u1 = Date.parse(T.u1),
      u4 = Date.parse(T.u4);
    if (isNaN(u1) || isNaN(u4) || t < u1 || t > u4) return 0; // penumbral / outside umbra
    const u2 = Date.parse(T.u2),
      u3 = Date.parse(T.u3);
    if (!isNaN(u2) && !isNaN(u3)) {
      // Total: plateau at full red between U2 and U3, ramp on the partial wings.
      if (t >= u2 && t <= u3) return 1;
      if (t < u2) return (t - u1) / (u2 - u1);
      return (u4 - t) / (u4 - u3);
    }
    // Partial: triangular ramp, peak = umbral magnitude (<1) at greatest.
    const peak = Date.parse(T.peak);
    const frac = t <= peak ? (t - u1) / (peak - u1) : (u4 - t) / (u4 - peak);
    const mag = Math.min(1, e.umbralMag || e.magnitude || 1);
    return Math.max(0, Math.min(1, frac)) * mag;
  }

  // Cached chronological view; rebuilt on first access after data load.
  let _allSorted = null;
  function getAllSorted() {
    if (!_allSorted) {
      _allSorted = [
        ...solarEvents.map((e) => ({ ...e, _kind: 'solar', _peakMs: new Date(e.peak.time).getTime() })),
        ...lunarEvents.map((e) => ({ ...e, _kind: 'lunar', _peakMs: new Date(e.times.peak).getTime() })),
      ].sort((a, b) => a._peakMs - b._peakMs);
    }
    return _allSorted;
  }

  // List controller: chronological window over all events, with cursor at the
  // event nearest to the current TimeState. Sidebar can extend the window in
  // either direction without re-sorting.
  const INITIAL_BEFORE = 10;
  const INITIAL_AFTER = 10;
  const PAGE_SIZE = 20;
  const MAX_WINDOW = 60;

  function makeListController() {
    const all = getAllSorted();
    const nowMs = TimeState.current.getTime();
    // First event whose peak ≥ now (i.e., upcoming). If none, cursor is past end.
    let cursor = all.findIndex((e) => e._peakMs >= nowMs);
    if (cursor === -1) cursor = all.length;
    let start = Math.max(0, cursor - INITIAL_BEFORE);
    let end = Math.min(all.length, cursor + INITIAL_AFTER);

    return {
      events: () => all.slice(start, end),
      total: () => all.length,
      cursorInWin: () => cursor - start,
      canLoadEarlier: () => start > 0,
      canLoadLater: () => end < all.length,
      loadEarlier(n = PAGE_SIZE) {
        start = Math.max(0, start - n);
      },
      loadLater(n = PAGE_SIZE) {
        end = Math.min(all.length, end + n);
      },
      windowSize: () => end - start,
      maxWindow: () => MAX_WINDOW,
      trimEarlier(n) {
        const t = Math.min(n, end - start);
        start += t;
        return t;
      },
      trimLater(n) {
        const t = Math.min(n, end - start);
        end -= t;
        return t;
      },
    };
  }

  // ---- Local Circumstances & Forecast ----
  //
  // Drives the standalone "Eclipses" panel in the right info sidebar: which
  // eclipses are next visible from the clicked location, and — when one is in
  // progress — the observer's own local contact times. All location-specific
  // solar geometry runs through BesselRT.localCircumstances (ported from the
  // build's tools/lib/bessel.mjs), evaluated with the SAME coreBesselAE the
  // real-time shadow uses, so the sidebar agrees with the drawn footprint.

  // Besselian elements at an instant: NASA polynomial when available, else
  // AE-direct (identical evaluator to computeSolarShadow / the cached curves).
  function _besselAt(event, date) {
    const poly = besselPolys[event.date];
    return poly ? BesselRT.evalBessel(poly, date) : BesselRT.coreBesselAE(Astronomy, date);
  }

  function _lcSolar(event, lat, lng, ms) {
    return BesselRT.localCircumstances(lat, lng, _besselAt(event, new Date(ms)));
  }

  // Apparent solar altitude (deg) through the SAME refraction-corrected engine the
  // sidebar read-outs, compass and sky-path use. The eclipse horizon gate runs on
  // this instead of the Besselian geometric zeta so a contact clamped at the horizon
  // agrees with the altitude printed beside it: a Sun-set-mid-eclipse contact lands at
  // apparent 0°, not the ~0.5° refraction lift that geometric zeta=0 leaves behind
  // (which rounded the "Sunset" altitude up to a misleading +1°).
  function _sunAppAlt(lat, lng, ms) {
    const h = bodyHorizontal(Astronomy.Body.Sun, new Date(ms), lat, lng);
    return h && isFinite(h.alt) ? h.alt : -90;
  }

  // Disc-overlap tests read straight from the Besselian magnitude geometry, horizon
  // aside. localCircumstances only labels phase (partial/total/annular) when the Sun is
  // geometrically up (zeta>=0); inside the ~0.5° band where the Sun is apparently up but
  // zeta<0 it returns 'below_horizon' and no class, so the gate must read these raw
  // quantities rather than lc.phase.
  function _inPartial(lc) {
    return lc.magnitude > 0;
  }

  function _inCentral(lc) {
    return lc.m < Math.abs(lc.L2p);
  }

  // Coarse magnitude sweep across [P1,P4]; tracks the sun-up maximum.
  function _scanSolar(event, lat, lng, N) {
    const p1 = event._p1Ms,
      p4 = event._p4Ms;
    let maxEff = -1,
      peakMs = p1,
      anyUp = false;
    for (let i = 0; i <= N; i++) {
      const ms = p1 + ((p4 - p1) * i) / N;
      const lc = _lcSolar(event, lat, lng, ms);
      const up = _sunAppAlt(lat, lng, ms) >= 0;
      if (up) anyUp = true;
      const eff = up && lc.magnitude > 0 ? lc.magnitude : -1;
      if (eff > maxEff) {
        maxEff = eff;
        peakMs = ms;
      }
    }
    return { maxEff, peakMs, anyUp };
  }

  // Golden-ish ternary refine of the sun-up magnitude maximum near peakMs.
  function _refineSolarPeak(event, lat, lng, peakMs, halfWin) {
    let lo = Math.max(event._p1Ms, peakMs - halfWin);
    let hi = Math.min(event._p4Ms, peakMs + halfWin);
    for (let k = 0; k < 32; k++) {
      const a = lo + (hi - lo) / 3,
        b = hi - (hi - lo) / 3;
      const la = _lcSolar(event, lat, lng, a),
        lb = _lcSolar(event, lat, lng, b);
      const va = _sunAppAlt(lat, lng, a) >= 0 ? la.magnitude : -1;
      const vb = _sunAppAlt(lat, lng, b) >= 0 ? lb.magnitude : -1;
      if (va < vb) lo = a;
      else hi = b;
    }
    const ms = (lo + hi) / 2;
    return { ms, lc: _lcSolar(event, lat, lng, ms) };
  }

  // Classify a solar event at a point: highest phase the observer would witness.
  // Returns { visible, maxPhase: 'none'|'partial'|'annular'|'total', maxMag, peakMs }.
  function classifySolar(event, lat, lng) {
    if (typeof BesselRT === 'undefined' || typeof Astronomy === 'undefined')
      return { visible: false, maxPhase: 'none' };
    if (!isFinite(event._p1Ms) || !isFinite(event._p4Ms) || event._p4Ms <= event._p1Ms)
      return { visible: false, maxPhase: 'none' };
    const N = 24;
    const coarse = _scanSolar(event, lat, lng, N);
    if (coarse.maxEff <= 0) return { visible: false, maxPhase: 'none' };
    // Only refine (and risk reading a central phase) when the coarse peak is deep
    // enough to plausibly be total/annular; off-path partials skip the cost.
    if (coarse.maxEff <= 0.8)
      return { visible: true, maxPhase: 'partial', maxMag: coarse.maxEff, peakMs: coarse.peakMs };
    const r = _refineSolarPeak(event, lat, lng, coarse.peakMs, (event._p4Ms - event._p1Ms) / N);
    // Classify from the raw geometry, not r.lc.phase: a peak sitting in the refraction
    // band (apparently up, zeta<0) would otherwise be mislabeled 'partial'.
    const maxPhase = _inCentral(r.lc) ? (r.lc.L2p < 0 ? 'total' : 'annular') : 'partial';
    return { visible: true, maxPhase, maxMag: r.lc.magnitude, peakMs: r.ms };
  }

  // Full local contact times for an in-progress solar eclipse at the observer:
  // C1/C4 (partial limits), C2/C3 (total/annular limits, null if not central), and the
  // local maximum — all GEOMETRIC disc-tangency instants. Tangency is unaffected by
  // refraction, so these are the canonical contacts and stay defined below the horizon
  // (the contact table dims the unobservable ones, matching the lunar table). The Sun
  // crossing the horizon mid-eclipse is reported separately as sunrise/sunset markers at
  // apparent altitude 0, so a "Sunset" row reads +0° while the true below-horizon fourth
  // contact still appears. classifySolar still gates overall visibility (apparent), so a
  // wholly-below-horizon eclipse shows "not visible here". Times are Dates; null absent.
  function solarLocalContacts(event, lat, lng) {
    const base = classifySolar(event, lat, lng);
    if (!base.visible) return { visible: false, maxPhase: 'none' };
    const p1 = event._p1Ms,
      p4 = event._p4Ms,
      N = 48;
    // Geometric disc overlap, no horizon gate: a contact is a true tangency of the
    // discs, which refraction never moves. Predicates take a time so they sample the
    // disc geometry at a specific instant.
    const inPartial = (ms) => _inPartial(_lcSolar(event, lat, lng, ms));
    const inCentral = (ms) => _inCentral(_lcSolar(event, lat, lng, ms));
    const bis = (msF, msT, predAt) => {
      let a = msF,
        b = msT;
      for (let k = 0; k < 32; k++) {
        const m = (a + b) / 2;
        if (predAt(m)) b = m;
        else a = m;
      }
      return new Date((a + b) / 2);
    };
    const samples = [];
    for (let i = 0; i <= N; i++) {
      const ms = p1 + ((p4 - p1) * i) / N;
      samples.push({ ms, ecl: inPartial(ms) });
    }
    let c1 = null,
      c4 = null,
      c2 = null,
      c3 = null;
    for (let i = 1; i <= N; i++)
      if (samples[i].ecl && !samples[i - 1].ecl) {
        c1 = bis(samples[i - 1].ms, samples[i].ms, inPartial);
        break;
      }
    for (let i = N; i >= 1; i--)
      if (samples[i - 1].ecl && !samples[i].ecl) {
        c4 = bis(samples[i].ms, samples[i - 1].ms, inPartial);
        break;
      }
    // Local partial phase already underway at a window edge (grazing): clamp to it.
    if (!c1 && samples[0].ecl) c1 = new Date(samples[0].ms);
    if (!c4 && samples[N].ecl) c4 = new Date(samples[N].ms);
    if (!c1 || !c4) return { visible: false, maxPhase: 'none' };
    const c1ms = c1.getTime(),
      c4ms = c4.getTime();
    // Geometric maximum: magnitude is unimodal across [c1,c4] (one closest approach to
    // the shadow axis), so ternary-search it. Anchoring c2/c3 on this known maximum
    // catches a sub-minute totality the coarse grid could step clean over.
    let lo = c1ms,
      hi = c4ms;
    for (let k = 0; k < 40; k++) {
      const a = lo + (hi - lo) / 3,
        b = hi - (hi - lo) / 3;
      if (_lcSolar(event, lat, lng, a).magnitude < _lcSolar(event, lat, lng, b).magnitude) lo = a;
      else hi = b;
    }
    const peakMs = (lo + hi) / 2;
    const peakLc = _lcSolar(event, lat, lng, peakMs);
    const maxPhase = _inCentral(peakLc) ? (peakLc.L2p < 0 ? 'total' : 'annular') : 'partial';
    if ((maxPhase === 'total' || maxPhase === 'annular') && inCentral(peakMs)) {
      const step = (p4 - p1) / (N * 4); // ~45 s for a typical window
      const edge = (dir) => {
        let last = peakMs;
        for (let i = 1; i <= 96; i++) {
          const t = peakMs + dir * step * i;
          if (t <= c1ms || t >= c4ms) return new Date(Math.max(c1ms, Math.min(c4ms, t)));
          if (!inCentral(t)) return bis(t, last, inCentral);
          last = t;
        }
        return new Date(last);
      };
      c2 = edge(-1);
      c3 = edge(1);
    }
    // Horizon crossings (apparent altitude 0) inside [c1,c4]: the Sun rising or setting
    // mid-eclipse. Reported as markers, not contacts — the table shows them as a gold
    // "Sunrise/Sunset" row (the first/last observable instant, +0°) beside the true,
    // below-horizon P1/P4. Apparent altitude keeps the read-out at exactly 0°. Rising
    // edge → sunrise, falling edge → sunset (same bisection order as C1/C4).
    const upAt = (ms) => _sunAppAlt(lat, lng, ms) >= 0;
    const M = 48;
    const up = [];
    for (let i = 0; i <= M; i++) {
      const ms = c1ms + ((c4ms - c1ms) * i) / M;
      up.push({ ms, on: upAt(ms) });
    }
    let sunrise = null,
      sunset = null;
    for (let i = 1; i <= M; i++)
      if (up[i].on && !up[i - 1].on) {
        sunrise = bis(up[i - 1].ms, up[i].ms, upAt);
        break;
      }
    for (let i = M; i >= 1; i--)
      if (up[i - 1].on && !up[i].on) {
        sunset = bis(up[i].ms, up[i - 1].ms, upAt);
        break;
      }

    return {
      visible: true,
      maxPhase,
      maxMag: peakLc.magnitude,
      maxTime: new Date(peakMs),
      c1,
      c2,
      c3,
      c4,
      sunrise,
      sunset,
    };
  }

  // Local solar contacts depend only on event + location (not the current
  // clock), but the right sidebar rebuilds every time tick during an active
  // eclipse — memoize so playback doesn't re-run the root-finder each frame.
  let _slcCache = null;
  function solarLocalContactsCached(event, lat, lng) {
    const key = event.date + ',' + lat.toFixed(2) + ',' + lng.toFixed(2);
    if (_slcCache && _slcCache.key === key) return _slcCache.val;
    const val = solarLocalContacts(event, lat, lng);
    _slcCache = { key, val };
    return val;
  }

  // Moon apparent altitude (deg) at an instant for an observer.
  function _moonAlt(date, lat, lng) {
    const obs = new Astronomy.Observer(lat, lng, 0);
    const equ = Astronomy.Equator(Astronomy.Body.Moon, date, obs, true, true);
    return Astronomy.Horizon(date, obs, equ.ra, equ.dec, 'normal').altitude;
  }

  // Classify a lunar event at a point. Contacts are global (whole-Earth
  // simultaneous); "visible" means the Moon is above the horizon during the
  // relevant phase. Penumbral-only events (no umbral contacts) are not counted.
  function classifyLunar(event, lat, lng) {
    if (typeof Astronomy === 'undefined') return { visible: false, maxPhase: 'none' };
    const t = event.times || {};
    if (isNaN(Date.parse(t.u1)) || isNaN(Date.parse(t.u4))) return { visible: false, maxPhase: 'none' };
    const moonUpIn = (aIso, bIso) => {
      const a = Date.parse(aIso),
        b = Date.parse(bIso);
      if (isNaN(a) || isNaN(b)) return false;
      for (let i = 0; i <= 6; i++) if (_moonAlt(new Date(a + ((b - a) * i) / 6), lat, lng) > 0) return true;
      return false;
    };
    if (event.kind === 'Total' && t.u2 && t.u3 && moonUpIn(t.u2, t.u3)) {
      return { visible: true, maxPhase: 'total', peakMs: Date.parse(t.peak) };
    }
    if (moonUpIn(t.u1, t.u4)) return { visible: true, maxPhase: 'partial', peakMs: Date.parse(t.peak) };
    return { visible: false, maxPhase: 'none' };
  }

  // Find the next future event visible from (lat,lng) for each of the four
  // categories. Each slot is { event, time, phase } or null. Scans forward by
  // peak time; stops once all four are filled or the catalog is exhausted.
  // No fixed scan cap: a hardcoded limit sized for the old 2000-2049 catalog
  // (226 events) would run out mid-catalog after the 2050-2099 append doubled
  // it, silently hiding rare categories (e.g. total eclipses) past that point.
  function nextVisible(lat, lng, fromDate) {
    if (!_loaded || !solarEvents || !solarEvents.length) return null;
    const all = getAllSorted();
    const fromMs = fromDate.getTime();
    const slots = { solarPartial: null, solarTotal: null, lunarPartial: null, lunarTotal: null };
    let remaining = 4,
      scanned = 0;
    for (let i = 0; i < all.length && remaining > 0 && scanned < all.length; i++) {
      const e = all[i];
      if (e._peakMs <= fromMs) continue;
      if (e._kind === 'solar') {
        if (slots.solarPartial && slots.solarTotal) continue;
        scanned++;
        const c = classifySolar(e, lat, lng);
        if (!c.visible) continue;
        const total = c.maxPhase === 'total' || c.maxPhase === 'annular';
        const slot = total ? 'solarTotal' : 'solarPartial';
        if (!slots[slot]) {
          const pk = _refineSolarPeak(e, lat, lng, c.peakMs, (e._p4Ms - e._p1Ms) / 24);
          slots[slot] = { event: e, time: new Date(pk.ms), phase: c.maxPhase };
          remaining--;
        }
      } else {
        if (slots.lunarPartial && slots.lunarTotal) continue;
        scanned++;
        const c = classifyLunar(e, lat, lng);
        if (!c.visible) continue;
        const slot = c.maxPhase === 'total' ? 'lunarTotal' : 'lunarPartial';
        if (!slots[slot]) {
          slots[slot] = { event: e, time: new Date(c.peakMs), phase: c.maxPhase };
          remaining--;
        }
      }
    }
    return slots;
  }

  // nextVisible is expensive (hundreds of ephemeris evals); memoize by rounded
  // location + day so it recomputes only when the observer moves or the date
  // rolls over, not on every time-slider tick.
  let _nvCache = null;
  function nextVisibleCached(lat, lng, fromDate) {
    const key = lat.toFixed(1) + ',' + lng.toFixed(1) + ',' + Math.floor(fromDate.getTime() / 86400000);
    if (_nvCache && _nvCache.key === key) return _nvCache.slots;
    const slots = nextVisible(lat, lng, fromDate);
    if (slots) _nvCache = { key, slots };
    return slots;
  }

  // Which eclipse (if any) is in progress at `date` — returns the getAllSorted
  // record (carries _kind) so it can be passed straight to openEvent.
  function findActive(date) {
    if (!_loaded || !solarEvents || !solarEvents.length) return null;
    const ms = date.getTime();
    for (const e of getAllSorted()) {
      if (ms >= e._p1Ms && ms <= e._p4Ms) return e; // NaN bounds compare false
    }
    return null;
  }

  // Public navigation: turn the Eclipses overlay + browser on, recenter the
  // browse list on the event, and select it (locks the time range, draws the
  // contact curves, flies to the peak, renders the left-panel detail).
  function openEvent(event, opts) {
    if (!_pub || !_loaded || !event) return;
    const map = _pub.map,
      sel = _pub.selectEvent;
    const peakTime = event._kind === 'solar' ? event.peak && event.peak.time : event.times && event.times.peak;
    // Jump "now" onto the event so the (re)built list centers on it — skipped
    // when opts.resetTime === false (e.g. clicking an active-eclipse title where
    // the user is already watching the event and doesn't want the clock moved).
    if (peakTime && TimeState.resetTo && (!opts || opts.resetTime !== false)) TimeState.resetTo(new Date(peakTime));
    // Reveal this event's kind in the browse list BEFORE the list (re)builds, so
    // its card isn't hidden by the solar/lunar filter — otherwise the active
    // marker falls back to the nearest visible (wrong-kind) card and the detail
    // renders against that neighbour instead of this event.
    if (typeof Sidebar !== 'undefined' && Sidebar.setEclipseListFilter) Sidebar.setEclipseListFilter(event._kind);
    const wasOn = map.hasLayer(_pub.soloLayer) || map.hasLayer(_pub.eclipseListLayer);
    if (!map.hasLayer(_pub.soloLayer)) map.addLayer(_pub.soloLayer);
    if (!map.hasLayer(_pub.eclipseListLayer)) map.addLayer(_pub.eclipseListLayer);
    if (typeof Sidebar !== 'undefined' && Sidebar.onLayerToggle) Sidebar.onLayerToggle('eclipse-list', true);
    // Already-open lists keep their old cursor; rebuild so it lands on the event.
    if (wasOn && typeof Sidebar !== 'undefined' && Sidebar.showEclipseList) {
      Sidebar.showEclipseList(makeListController(), sel);
    }
    sel(event, opts);
  }

  // Run cb once the catalog is loaded (kicks off the fetch if needed).
  function ready(cb) {
    loadData(cb);
  }

  // ---- Rendering ----

  // ---- Besselian Instantaneous-Footprint Renderer ----
  // Draws the umbra/antumbra, iso-magnitude rings (0.2/0.4/0.6/0.8 — matching
  // the cached magContours), and the partial-visibility (penumbra) edge by
  // projecting fundamental-plane contours through BesselRT.projectRing. Each
  // ring is laid down via addPolyline so it gets ±360° world copies, antimeridian
  // splitting and null-gap (limb-clip) handling for free.

  // Draw a closed ring with fill when it's "simple" (fully on Earth, no
  // antimeridian wrap) as an L.polygon in each world copy; otherwise fall back to
  // a stroke-only polyline (addPolyline handles wrap/split/limb-clip robustly).
  function drawFilledRing(pts, opts, layer) {
    let simple = pts.every((p) => p != null);
    if (simple) {
      for (let i = 1; i < pts.length; i++) {
        if (Math.abs(pts[i][1] - pts[i - 1][1]) > 180) {
          simple = false;
          break;
        }
      }
    }
    if (simple) {
      // smoothFactor:0 — disable Leaflet's Douglas-Peucker simplification so our
      // carefully densified vertices are all used. The default smoothFactor:1 drops
      // any vertex whose on-screen deviation from the straight chord is < 1px,
      // reducing a 34px-radius ring to ~13 sides regardless of vertex count.
      const polyOpts = Object.assign({ pane: 'eclipse-curves', interactive: false, smoothFactor: 0 }, opts);
      for (const off of [0, -360, 360]) {
        L.polygon(
          pts.map((p) => [p[0], p[1] + off]),
          polyOpts
        ).addTo(layer);
      }
    } else {
      addPolyline(pts, Object.assign({ fill: false, interactive: false }, opts), layer);
    }
  }

  // Project a fundamental-plane (ξ,η) interior-iso vertex to [lat,lng] with the
  // self-consistent SPHERICAL inverse (the field uses the spherical ζ too). Smooth
  // and defined everywhere on the disc — unlike the ellipsoid fundamentalToGeo,
  // which returns null in the thin near-limb band and makes contours break/zigzag.
  function fundToGeoSafe(xi, eta, b) {
    const g = BesselRT.fundamentalToGeoSphere(xi, eta, b);
    return [g.lat, g.lng];
  }

  // Project a fundamental-plane (ξ,η) contour chain to a [lat,lng] polyline,
  // adaptively closing the geographic facets that appear where the (ξ,η)→geo
  // projection stretches (the rise/set limb, and high latitude where sec φ blows
  // up): consecutive cell-step vertices there can be hundreds of km apart on the
  // ground even though they're ~one grid cell apart in (ξ,η). We bisect IN (ξ,η)
  // and project each sub-vertex (grid-scale segments are locally straight in ξ,η,
  // so no contour re-snap is needed) until the on-map Mercator chord ≤ maxMercDeg
  // — the same discipline as the cached densifyRiseSet (bessel.mjs:2238).
  //   The off-chord guard (build densifyByTime) does double duty: when the (ξ,η)
  // midpoint does NOT project between its endpoints, the segment isn't a stretch
  // but a PROJECTION SINGULARITY (the contour passing the geographic pole, where
  // longitude is undefined). Densifying across it would draw a slash, so we
  // insert a null break instead and let splitAtAntimeridian cut it cleanly.
  function densifyContour(chain, b, maxMercDeg) {
    const mc = BesselRT.mercatorChordDeg;
    const pj = chain.map((p) => ({ x: p, g: fundToGeoSafe(p[0], p[1], b) }));
    const out = [];
    for (let i = 1; i < pj.length; i++) {
      const A = pj[i - 1],
        B = pj[i];
      if (!A.g) continue;
      out.push(A.g);
      if (!B.g) {
        out.push(null);
        continue;
      }
      if (Math.abs(A.g[1] - B.g[1]) > 180) continue; // antimeridian: splitter handles
      const dAB = mc(A.g[0], A.g[1], B.g[0], B.g[1]);
      if (dAB <= maxMercDeg) continue;
      const mx = [(A.x[0] + B.x[0]) / 2, (A.x[1] + B.x[1]) / 2];
      const mg = fundToGeoSafe(mx[0], mx[1], b);
      if (!mg || mc(A.g[0], A.g[1], mg[0], mg[1]) > dAB * 1.5 || mc(mg[0], mg[1], B.g[0], B.g[1]) > dAB * 1.5) {
        out.push(null); // singularity → break, no slash
        continue;
      }
      (function rec(ax, ag, bx, bg, depth) {
        if (depth > 14) return;
        if (Math.abs(ag[1] - bg[1]) > 180) return;
        const dd = mc(ag[0], ag[1], bg[0], bg[1]);
        if (dd <= maxMercDeg) return;
        const cx = [(ax[0] + bx[0]) / 2, (ax[1] + bx[1]) / 2];
        const cg = fundToGeoSafe(cx[0], cx[1], b);
        if (!cg) return;
        if (mc(ag[0], ag[1], cg[0], cg[1]) > dd * 1.5 || mc(cg[0], cg[1], bg[0], bg[1]) > dd * 1.5) return;
        rec(ax, ag, cx, cg, depth + 1);
        out.push(cg);
        rec(cx, cg, bx, bg, depth + 1);
      })(A.x, A.g, B.x, B.g, 0);
    }
    const last = pj[pj.length - 1];
    if (last && last.g) out.push(last.g);
    return out;
  }

  // Time-keyed memo for the zoom-independent half of the shadow (magnitude field +
  // marching-squares chains). Reset whenever keyTime (=instant) changes.
  let _fieldCache = { key: '', chainsByMag: null };

  function renderSolarShadow(s, layer, zoom, keyTime) {
    const b = s.b;
    // Azimuth count scales with zoom so the umbra ring stays sub-pixel-smooth at
    // any zoom (the runtime point math is already meter-accurate; this only
    // controls polygon faceting). The umbra/antumbra is the hero feature → most
    // samples. The faint dashed iso/penumbra contours now come from a marching-
    // squares field (below), not the radial sweep. Redrawn on zoomend.
    const z = zoom || 4;
    const umbraNAz = Math.max(256, Math.min(1024, Math.round(64 * Math.pow(2, z / 2))));
    // Web-Mercator chord threshold derived from pixels at the current zoom: at
    // zoom z, 1° of Mercator-equivalent ≈ 256·2^z/360 px, so TARGET_PX of 4 gives
    // a sub-pixel-visible bound. Every contour densifier below (umbraLensGeo, the
    // iso-mag densifyContour, terminatorArcs) bisects and re-projects until each
    // on-map segment chord ≤ maxMercDeg — needed because sec φ stretches polar arcs
    // by ~3× @70° / ~6× @80° so a uniform parameter sweep facets at high latitude.
    // Mirrors the cached densifyRiseSet pattern (build-bessel-curves.mjs:2117).
    //   maxMercDeg shrinks as 1/2^z, so the adaptive bisection depth (and the
    // vertex count it emits) grows exponentially with zoom — at z≈12 it dominates
    // the whole shadow redraw (measured ~4.4 s, ~83% of it densification). Past
    // Z_CAP the curve is already sub-pixel-smooth and finer steps only insert
    // invisible collinear vertices, so freeze the densification density at Z_CAP's
    // value for all higher zooms. This is applied through the SINGLE maxMercDeg that
    // drives the whole contour family (umbra, iso-mag, terminator) — uniform, no
    // per-line special-casing. The contour SHAPE is set by the zoom-independent
    // magnitude field (fieldStep below), so capping cannot move/jitter any line; the
    // only visible effect is a faint facet on near-straight segments at z>Z_CAP.
    // Z_CAP=9 chosen by measurement: at z=12 the eclipse redraw is densify-dominated
    // (~160 ms @cap 10 → ~83 ms @cap 9, a clean halving), and the resulting on-map
    // vertex gap stays ≤1.5 km — identical to cap 10 at the penumbra and ~1/130th of
    // the 200 km QC ceiling, so the contours are pixel-identical at every zoom where
    // the cap engages (z≥9, where each contour's on-screen radius is already huge so
    // the coarser step is sub-pixel). 9 keeps more faceting headroom at extreme zoom
    // (z≥13) than 8 while still removing ~half the densify cost.
    // Z_CAP is module-scoped (shared with redrawShadow's zoom-reuse gate).
    const zEff = Math.min(z, Z_CAP);
    const maxMercDeg = (4 * 360) / (256 * Math.pow(2, zEff));

    // Partial-visibility contours — penumbra (mag=0) edge + iso-magnitude levels.
    // Each level is the boundary of {mag ≥ k} ∩ {sunlit disc}, drawn as TWO pieces
    // that share exact endpoints: an interior iso arc (marching squares on the
    // CONTINUOUS field, then clipChainToDisc at the exact ρ=1 root) and a rise/set
    // terminator grown from the interior arc's own clip angles (zero seam). The
    // narrow umbra (~30 km) can't be grid-resolved and is drawn by the radial
    // projector above.
    //
    // Zoom-INDEPENDENT field step: the interior arc's (ξ,η) geometry must be
    // identical at every zoom or the contour "walks" on zoom (densify only inserts
    // collinear points, never reshapes). 0.004 ≈ 25 km in (ξ,η).
    const fieldStep = 0.004;
    // mag 0 = penumbra (solid-dim, matches old penumbra style); the rest = iso
    // levels matching the cached magContours.
    const LEVELS = [
      { mag: 0, color: '#94a3b8', weight: 1, opacity: 0.55, dash: null, label: null },
      { mag: 0.2, color: '#a8a39c', weight: 0.8, opacity: 0.7, dash: '3,5', label: '0.20' },
      { mag: 0.4, color: '#bdb7a4', weight: 0.8, opacity: 0.7, dash: '5,4', label: '0.40' },
      { mag: 0.6, color: '#cbc5ac', weight: 0.8, opacity: 0.7, dash: '6,4', label: '0.60' },
      { mag: 0.8, color: '#d4cfb8', weight: 0.8, opacity: 0.7, dash: '8,3', label: '0.80' },
    ];
    // The magnitude field and per-level marching-squares chains are purely
    // time-dependent (functions of b), so memoise by keyTime: a zoom-only redraw
    // reuses them and skips the ~0.7 s field build + marching-squares. Cached
    // chains are read-only downstream, so reuse is safe.
    let chainsByMag;
    const cacheKey = keyTime != null ? String(keyTime) : '';
    if (cacheKey && _fieldCache.key === cacheKey && _fieldCache.chainsByMag) {
      chainsByMag = _fieldCache.chainsByMag;
    } else {
      const magField = BesselRT.computeMagFieldFundamental(b, { step: fieldStep });
      chainsByMag = {};
      for (const lvl of LEVELS) {
        chainsByMag[String(lvl.mag)] = BesselRT.chainSegments(
          BesselRT.marchingSquares(magField, magField.mag, lvl.mag)
        );
      }
      if (cacheKey) _fieldCache = { key: cacheKey, chainsByMag };
    }
    // Runtime QC accumulator — read by tests via window.__eclipseShadowQC so the
    // shadow is validated numerically (turn-angle + continuity), not just by eye.
    const qc = {};
    for (const lvl of LEVELS) {
      const interiorGeos = []; // interior iso arcs only (terminator limb arc excluded from labelling)
      let worstTurn = 0,
        worstGap = 0,
        nLines = 0;
      const consider = (geo) => {
        const turn = BesselRT.maxTurnDeg(geo);
        const gap = BesselRT.maxGapKm(geo);
        if (turn > worstTurn) worstTurn = turn;
        if (gap > worstGap) worstGap = gap;
        addPolyline(
          geo,
          {
            color: lvl.color,
            weight: lvl.weight,
            opacity: lvl.opacity,
            dashArray: lvl.dash,
            interactive: false,
          },
          layer
        );
        nLines++;
      };
      // Interior iso arc(s): clipChainToDisc cuts each chain at the EXACT ρ=1 root
      // and drops the off-disc part. We record each clip point's limb ANGLE and
      // feed it to terminatorArcs so the terminator grows from the interior arc's
      // own crossing (zero seam, no snap of the singularity-sensitive endpoint).
      const interiorClipGeo = []; // geo of interior-arc ends that sit on ρ=1
      const clipThetas = []; // limb angles of those ends → terminator boundaries
      const chains = chainsByMag[String(lvl.mag)];
      for (const ch of chains) {
        if (ch.length < 2) continue;
        for (const sub of BesselRT.clipChainToDisc(ch)) {
          if (sub.length < 2) continue;
          // Record sub-arc ends that lie ON the limb (clip points): their angle
          // bounds the terminator, their geo feeds the seam QC. Closed-loop ends
          // sit mid-disc (ρ<1) and are skipped.
          for (const e of [sub[0], sub[sub.length - 1]]) {
            if (Math.abs(Math.hypot(e[0], e[1]) - 1) < 1e-4) {
              clipThetas.push(Math.atan2(e[1], e[0]));
              const g = BesselRT.fundamentalToGeoSphere(e[0], e[1], b);
              interiorClipGeo.push([g.lat, g.lng]);
            }
          }
          const geo = densifyContour(sub, b, maxMercDeg);
          consider(geo);
          interiorGeos.push(geo);
        }
      }
      // Rise/set terminator arc(s) — analytic on the limb circle, spanning between
      // the interior arc's actual clip angles (zero seam) when there were any.
      const termEndGeo = [];
      for (const arc of BesselRT.terminatorArcs(b, lvl.mag, maxMercDeg, clipThetas.length >= 2 ? clipThetas : null)) {
        if (arc.length >= 2) {
          consider(arc);
          termEndGeo.push(arc[0], arc[arc.length - 1]);
        }
      }
      // Seam continuity QC: every interior clip end must coincide with a terminator
      // end. maxGapKm on a 2-pt poly = the haversine distance between the points.
      let seamKm = 0;
      for (const ic of interiorClipGeo) {
        if (!termEndGeo.length) {
          seamKm = Infinity;
          break;
        }
        let best = Infinity;
        for (const te of termEndGeo) best = Math.min(best, BesselRT.maxGapKm([ic, te]));
        if (best > seamKm) seamKm = best;
      }
      qc[lvl.mag] = {
        maxTurn: +worstTurn.toFixed(1),
        maxGap: +worstGap.toFixed(1),
        seamKm: isFinite(seamKm) ? +seamKm.toFixed(1) : -1,
        lines: nLines,
      };
      if (worstTurn > 45 || worstGap > 200 || !(seamKm <= 10)) {
        console.warn(
          '[eclipse-shadow QC] mag=' +
            lvl.mag +
            ' maxTurn=' +
            worstTurn.toFixed(1) +
            '° maxGap=' +
            worstGap.toFixed(1) +
            'km seamKm=' +
            (isFinite(seamKm) ? seamKm.toFixed(1) : '∞')
        );
      }
      if (lvl.label) {
        // Label the interior iso arc(s). Closed rings (around greatest eclipse) are
        // anchored on the vertical line through the sub-solar point so all rings
        // share the same screen column. Open arcs anchor at their midpoint.
        placeContourLabel(
          interiorGeos,
          lvl.mag.toFixed(2),
          'iso-mag-label data-value',
          layer,
          null,
          s.sub ? s.sub.lng : null
        );
      }
    }
    if (typeof window !== 'undefined') window.__eclipseShadowQC = qc;

    // Umbra (total) / antumbra (annular) — thin gold stroke + faint navy fill. The shadow
    // boundary is the m=|L2'| circle in the fundamental plane; umbraLensGeo parametrises it
    // by angle (defined for every azimuth) and closes any grazing day-side lens along the
    // terminator, so it stays smooth both when the axis is on the disc (a closed ellipse)
    // and at a sunset-terminus eclipse where the axis grazes just off-disc — the regime
    // where the old radial boundary search shredded into a sawtooth. Returns null only when
    // the shadow misses Earth entirely (partial phase / no landfall).
    const umbra = BesselRT.umbraLensGeo(b, umbraNAz, maxMercDeg);
    if (umbra) {
      drawFilledRing(
        umbra,
        {
          color: CURVE_STYLE.umbralLimit.color,
          weight: 1.2,
          fillColor: '#1a2952',
          fillOpacity: 0.35,
          className: 'eclipse-umbra',
        },
        layer
      );
    }
  }

  // Legacy sphere renderer (fallback only — paired with computeSolarShadowSphere).
  function renderSolarShadowSphere(s, layer) {
    // Iso-magnitude rings: linear approximation between umbra (mag=1) and
    // penumbra (mag=0). Placeholder for v1.0; v1.1 will replace with Bessel
    // element exact contours.
    const ISO_MAG_LEVELS = [
      { mag: 0.2, dashArray: '3,5', color: '#a8a39c' },
      { mag: 0.5, dashArray: '5,4', color: '#c0bba0' },
      { mag: 0.8, dashArray: '8,3', color: '#d4cfb8' },
    ];

    for (const offset of [0, -360, 360]) {
      const center = [s.lat, s.lng + offset];

      // Penumbra (outer soft edge)
      L.circle(center, {
        radius: s.penumbraKm * 1000,
        color: '#94a3b8',
        weight: 1,
        fillColor: '#94a3b8',
        fillOpacity: 0.1,
        dashArray: '4 4',
        interactive: false,
        pane: 'eclipse-curves',
      }).addTo(layer);

      // Iso-magnitude rings between umbra and penumbra
      for (const level of ISO_MAG_LEVELS) {
        const radiusKm = s.umbraKm + (s.penumbraKm - s.umbraKm) * (1 - level.mag);
        L.circle(center, {
          radius: radiusKm * 1000,
          color: level.color,
          weight: 0.8,
          fillOpacity: 0,
          dashArray: level.dashArray,
          opacity: 0.7,
          interactive: false,
          pane: 'eclipse-curves',
        }).addTo(layer);
        if (offset === 0) {
          // Label at north edge of each iso-mag ring (a bit outside)
          const dLatDeg = (radiusKm + 30) / 111.0; // km → degrees of latitude
          L.marker([s.lat + dLatDeg, s.lng], {
            icon: L.divIcon({
              className: 'iso-mag-label data-value',
              html: level.mag.toFixed(2),
              iconSize: [28, 14],
            }),
            interactive: false,
          }).addTo(layer);
        }
      }

      // Umbra: thin stroke + faint deep-navy fill (geometry self-explains)
      L.circle(center, {
        radius: s.umbraKm * 1000,
        color: CURVE_STYLE.umbralLimit.color,
        weight: 1.2,
        fillColor: '#1a2952',
        fillOpacity: 0.35,
        className: 'eclipse-umbra',
        interactive: false,
        pane: 'eclipse-curves',
      }).addTo(layer);
    }
  }

  // ---- Contact-Curve Rendering ----
  // P1/P4 envelope, N/S limits, central path, iso-magnitude contours, lunar
  // U1–U4 visibility hemispheres. The curves are time-independent for a given
  // event — built once at build-eclipses.js time — so we just need to lay them
  // down on the map when the user selects an eclipse, and clear when they close.

  // Solar + lunar contact-curve styles. ONE row per family — edit color /
  // weight / opacity / dashArray here, this is the single source of truth.
  // Each entry is a Leaflet polyline-options object: spread it directly into
  // addPolyline and add `interactive` at the call site (true for solar curves,
  // false for lunar visibility outlines). Colors are hard-coded (Leaflet
  // polyline color doesn't accept `var(--…)` strings directly).
  const CURVE_STYLE = {
    // ── Solar ──────────────────────────────────────────────
    centralTotal: { color: '#F7DFC1', weight: 1.5, opacity: 0.85, dashArray: '8 3' }, // total central line   (total family hue 78.5°, L* 90)
    centralAnnular: { color: '#DEE3EE', weight: 1.5, opacity: 0.95, dashArray: '8 3' }, // annular central line (annular family hue 276°, L* 90)
    umbralLimit: { color: '#B6893E', weight: 2.4, opacity: 0.9 }, // total: umbral N/S limits    (total family hue 78.5°, L* 60)
    umbralLimitAnn: { color: '#8591AB', weight: 2.4, opacity: 0.9 }, // annular: antumbral N/S limits (annular family hue 276°, L* 60)
    penumbralLimit: { color: '#529E89', weight: 2.1, opacity: 0.85 }, // penumbral N/S limits (173° — complement of rise/set, L* 60)
    riseSetLoop: { color: '#D96D9D', weight: 2.1, opacity: 0.8, dashArray: '5 3' }, // sunrise/sunset 8-loop (353° — complement of penumbral, L* 60)
    riseSetMax: { color: '#D96D9D', weight: 2.1, opacity: 0.85 }, // rise/set max-eclipse line (353°, L* 60)
    magContour: { color: '#027585', weight: 1.5, opacity: 0.8, dashArray: '4 3' }, // iso-magnitude contours (218° cyan accent, L* 45)
    // ── Lunar (visibility hemispheres) ─────────────────────
    lunarPenumbral: { color: '#f59e0b', weight: 0.9, opacity: 0.45, dashArray: '3 4' }, // P1/P4
    lunarPartial: { color: '#f59e0b', weight: 1.4, opacity: 0.85 }, // U1/U4
    lunarTotal: { color: '#FCE2C4', weight: 1.8, opacity: 0.95 }, // U2/U3
    lunarPeak: { color: '#22c55e', weight: 2.2, opacity: 1.0 }, // greatest
  };

  // Width (px) of the transparent hit-casing laid over each tooltip-bearing
  // curve so the hover target is comfortable — the visible strokes are only
  // ~1–2.5 px wide and SVG has no click tolerance. See addPolyline. Sourced from
  // the shared thin-line floor (HitWidths.MIN, js/hit-widths.js) so every layer
  // stays in sync.
  const CURVE_HIT_WEIGHT = HitWidths.MIN;

  // ---- Eclipse Curve Names — Served by the Centralized I18n Module ----
  // The hover tooltip shows ONLY the line's name (e.g. "umbral north limit",
  // "annular central line", iso-mag value), rendered as the compact name-label
  // chip (.eclipse-curve-tooltip, mirroring .glossary-tip.is-label) — no
  // encyclopedic blurb. Iso-mag contours keep their magnitude value as part of
  // the identifying name.
  function curveName(key, mag) {
    const name = typeof I18n !== 'undefined' ? I18n.t('eclipse.curve.' + key) : key;
    return mag != null ? name + ' ' + mag.toFixed(2) : name;
  }

  // splitAtAntimeridian (split a polyline at null-lng pole sentinels, antimeridian
  // crossings, and polar wraps) lives in GeoUtils — used at the addPolyline call below.

  // The Leaflet map is configured with MAP_LNG_WEST = -200, MAP_LNG_EAST = 520
  // (a ~720° span so the user can pan across the antimeridian without a void
  // edge). Each curve must be drawn in every world-copy that falls inside
  // those bounds — otherwise the eclipse only shows in one of the wraps.
  // ±360° is enough since the span is just under 2 full worlds.
  function addPolyline(pts, opts, layer, tooltip) {
    // Route all eclipse polylines through the eclipse-curves pane (z=629)
    // so they appear above the twilight-mask(612) and are visible in daylight.
    // smoothFactor:0 — keep every vertex we computed; the default Leaflet value
    // of 1 would apply Douglas-Peucker with a 1px on-screen tolerance and silently
    // discard most of the ring vertices, turning a smooth curve into a coarse polygon.
    const polyOpts = Object.assign({ pane: 'eclipse-curves', smoothFactor: 0 }, opts);
    // Normalize longitudes with ADJACENT-POINT CONTINUITY: the first point of
    // each segment goes to [-180,180); every following point takes the ±360
    // representative nearest its predecessor, so a curve that crosses the
    // antimeridian stays continuous (output lng may exceed ±180 — Leaflet draws
    // it correctly and the ±360 world copies still cover the visible span).
    // Normalizing each point independently would reintroduce a 360° jump at the
    // dateline that splitAtAntimeridian then cuts, leaving a visible gap
    // (2024-10-02 sLimit crosses 180° twice → two ~25 km breaks).
    const norm = [];
    let prevLng = null;
    for (const p of pts) {
      if (p == null || p[1] == null) {
        norm.push(p);
        prevLng = null;
        continue;
      }
      let lng = GeoUtils.normLng(p[1]);
      if (prevLng !== null) {
        while (lng - prevLng > 180) lng -= 360;
        while (lng - prevLng < -180) lng += 360;
      }
      prevLng = lng;
      norm.push([p[0], lng]);
    }
    // Draw a world-copy for every 360° shift that overlaps the map's longitude
    // span (MAP_LNG_WEST..MAP_LNG_EAST = -200..520 in map.js). The continuity
    // unwrap above can leave lng well outside [-180,180] (e.g. 2024-04-08 nLimit
    // spans -290..-129), so a fixed w∈{-1,0,1} misses copies — the 70°E arc would
    // show but its 430°E copy would not. Derive the range from the curve's own
    // extent so every visible world copy is drawn.
    const LNG_WEST = -200,
      LNG_EAST = 520;
    let lo = Infinity,
      hi = -Infinity;
    for (const p of norm) {
      if (p && p[1] != null) {
        if (p[1] < lo) lo = p[1];
        if (p[1] > hi) hi = p[1];
      }
    }
    if (!isFinite(lo)) return;
    const wMin = Math.ceil((LNG_WEST - hi) / 360);
    const wMax = Math.floor((LNG_EAST - lo) / 360);
    for (let w = wMin; w <= wMax; w++) {
      // Skip world-copies entirely outside the current viewport (perf at high
      // zoom: at z≥9 only 1 wrap overlaps a ~35° span, so we draw 1 polyline
      // instead of 3-7). _curveViewport is null when no map ref → draw all.
      if (_curveViewport) {
        const cLo = lo + w * 360,
          cHi = hi + w * 360;
        if (cHi < _curveViewport.west || cLo > _curveViewport.east) continue;
      }
      const shifted = w === 0 ? norm : norm.map((p) => (p == null || p[1] == null ? p : [p[0], p[1] + w * 360]));
      const segments = GeoUtils.splitAtAntimeridian(shifted);
      for (const seg of segments) {
        if (tooltip) {
          // SVG hit area == visible stroke width, and these curves are only
          // ~1–2.5 px wide, so they're hard to hover. Draw the visible line
          // non-interactive, then lay a transparent fat "hit casing" on top
          // (continuous — no dashArray — so the whole length is hoverable) and
          // bind the tooltip to it. interactive:true opts the casing back into
          // pointer events even though the eclipse-curves pane is none.
          const visOpts = Object.assign({}, polyOpts, { interactive: false });
          L.polyline(seg, visOpts).addTo(layer);
          const hitOpts = Object.assign({}, polyOpts, {
            interactive: true,
            opacity: 0,
            weight: CURVE_HIT_WEIGHT,
            dashArray: null,
            lineCap: 'round',
            lineJoin: 'round',
          });
          const hit = L.polyline(seg, hitOpts).addTo(layer);
          hit.bindTooltip(tooltip, { sticky: true, className: 'eclipse-curve-tooltip' });
        } else {
          L.polyline(seg, polyOpts).addTo(layer);
        }
      }
    }
  }

  // Add a single 2-point segment (from a marching-squares contour) and its
  // ±360° copies. Skips the antimeridian-split check because contour segments
  // are inherently local (≤4° cell width); they can't span the antimeridian.
  function addContourSegment(lat1, lng1, lat2, lng2, opts, layer) {
    const polyOpts = Object.assign({ pane: 'eclipse-curves' }, opts);
    for (let w = -1; w <= 1; w++) {
      L.polyline(
        [
          [lat1, lng1 + w * 360],
          [lat2, lng2 + w * 360],
        ],
        polyOpts
      ).addTo(layer);
    }
  }

  // Split a curve at `null` sentinels — the build script inserts `null`
  // between contiguous segments when the source data has a real time gap
  // (e.g., the middle line that genuinely doesn't exist near greatest
  // eclipse for inland-peak events). Returns an array of segments, each a
  // list of [lat, lng] tuples.
  function splitOnNull(pts) {
    if (!pts || !pts.length) return [];
    const segs = [];
    let cur = [];
    for (const p of pts) {
      if (p == null) {
        if (cur.length >= 2) segs.push(cur);
        cur = [];
      } else {
        cur.push(p);
      }
    }
    if (cur.length >= 2) segs.push(cur);
    return segs;
  }

  // Convert legacy {t, lat, lng} object lists into the compact [lat, lng]
  // form, so the renderer can handle both the new compactified data and any
  // legacy data still cached in old solar.json builds.
  function asCompact(pts) {
    if (!pts || !pts.length) return [];
    if (Array.isArray(pts[0])) return pts;
    return pts.map((p) => (p == null ? null : [p.lat, p.lng]));
  }

  // Add a wrapped marker (point + ±360° copies of itself).
  // tooltip (optional): string shown on hover; when provided the marker is
  // placed in eclipse-curves-points (z=630, above eclipse-curves=629) so the
  // greatest-eclipse star sits above the central-path polyline and is hittable.
  function addWrappedMarker(lat, lng, iconHtmlClass, layer, label, tooltip) {
    const hasTooltip = !!tooltip;
    for (let w = -1; w <= 1; w++) {
      const m = L.marker([lat, lng + w * 360], {
        icon: L.divIcon({
          className: iconHtmlClass,
          html: '<span aria-hidden="true">' + (label || '✶') + '</span>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
        pane: hasTooltip ? 'eclipse-curves-points' : undefined,
        interactive: hasTooltip,
      }).addTo(layer);
      if (hasTooltip) m.bindTooltip(tooltip, { sticky: true, className: 'eclipse-curve-tooltip' });
    }
  }

  // On-screen tangent (deg) of seg at index i, measured in _map's Web Mercator
  // pixel space so it matches the drawn polyline's slope EXACTLY (the polyline is
  // drawn in that same space). Zoom-invariant — Mercator scales x/y isotropically,
  // so the chord angle is independent of zoom (and of pan, which is translation),
  // letting us bake it once at render time. Computing the angle in geographic
  // (Δlat,Δlng) space instead and applying it as a screen-space CSS rotate() is the
  // classic bug (latitude stretch desyncs it from the on-screen slope) — don't.
  function contourTangentDeg(seg, i) {
    if (!_map || typeof _map.project !== 'function') return 0;
    const n = seg.length,
      K = 3;
    const a = seg[Math.max(0, i - K)],
      b = seg[Math.min(n - 1, i + K)];
    if (!a || !b) return 0;
    if (Math.abs(b[1] - a[1]) > 30) return 0; // antimeridian/seam guard → stay horizontal
    const pa = _map.project(L.latLng(a[0], a[1]));
    const pb = _map.project(L.latLng(b[0], b[1]));
    let deg = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
    while (deg > 90) deg -= 180; // keep text upright (never upside-down)
    while (deg <= -90) deg += 180;
    return deg;
  }

  // Anchor index for a contour label, decided by the segment's TOPOLOGY. A CLOSED
  // loop (a concentric iso-magnitude ring around the point of greatest eclipse) is
  // anchored at its NORTHERNMOST vertex: nested rings' top vertices line up
  // vertically, so the labels stack into a readable 0.80→0.20 ladder (and the tangent
  // there is ~horizontal, so the text sits flat). An OPEN arc (terminator-clipped, or
  // a cached ground-envelope branch) has its ends out on the limb, so its midpoint is
  // the true visual centre — anchor there (and NOT at the northernmost vertex, which
  // for an open arc is just the clipped end). Topology is judged by endpoint
  // coincidence relative to the segment's own bbox, so the test is scale-free.
  function anchorIndex(seg, refLng) {
    const n = seg.length;
    const a = seg[0],
      z = seg[n - 1];
    let latMin = Infinity,
      latMax = -Infinity,
      lngMin = Infinity,
      lngMax = -Infinity;
    for (const p of seg) {
      if (p[0] < latMin) latMin = p[0];
      if (p[0] > latMax) latMax = p[0];
      if (p[1] < lngMin) lngMin = p[1];
      if (p[1] > lngMax) lngMax = p[1];
    }
    const diag = Math.hypot(latMax - latMin, lngMax - lngMin) || 1;
    const endGap = Math.hypot(z[0] - a[0], z[1] - a[1]);
    const closed = endGap < 0.15 * diag;
    if (!closed) return Math.floor(n / 2); // open arc: midpoint

    // Closed ring: find the northernmost crossing of the vertical lng = refLng so
    // every nested ring's label shares the same screen x-column (strict ladder).
    if (refLng != null) {
      let bestLat = -Infinity,
        bestIdx = -1;
      for (let k = 0; k < n - 1; k++) {
        const p = seg[k],
          q = seg[k + 1];
        const dp = p[1] - refLng,
          dq = q[1] - refLng;
        if (dp * dq <= 0 && dp !== dq) {
          // Edge straddles refLng
          const t = dp / (dp - dq);
          const crossLat = p[0] + t * (q[0] - p[0]);
          if (crossLat > bestLat) {
            bestLat = crossLat;
            bestIdx = t < 0.5 ? k : k + 1;
          }
        }
      }
      if (bestIdx >= 0) return bestIdx;
    }
    // Fallback: global northernmost vertex (refLng absent or outside ring bbox).
    let bi = 0,
      best = -Infinity;
    for (let k = 0; k < n; k++)
      if (seg[k][0] > best) {
        best = seg[k][0];
        bi = k;
      }
    return bi;
  }

  // Drop a value label on each sufficiently-long segment in `segs`, rotated to run
  // PARALLEL to the contour's on-screen tangent at the anchor. The anchor is chosen by
  // `anchorIndex` per topology: closed iso rings get their northernmost vertex (so
  // nested rings stack into a 0.80→0.20 ladder), open arcs get their midpoint (inside
  // the drawn arc, not at a clip/limb end). Labelling every segment ≥ 0.5× the longest
  // gives one label for a single arc and one per branch when north and south arcs are
  // both substantial. `color`, when given, is applied inline (cached magContour); omit
  // it to inherit the className's CSS color (real-time grey .iso-mag-label).
  function placeContourLabel(segs, text, className, layer, color, refLng) {
    if (!segs || !segs.length) return;
    let maxLen = 0;
    for (const seg of segs) if (seg && seg.length > maxLen) maxLen = seg.length;
    if (maxLen < 6) return;
    for (const seg of segs) {
      if (!seg || seg.length < 6 || seg.length < 0.5 * maxLen) continue;
      const i = anchorIndex(seg, refLng);
      const mid = seg[i];
      if (!mid) continue;
      const deg = contourTangentDeg(seg, i);
      // Rotate the inner span (the marker div itself is owned by Leaflet for
      // positioning); the same deg serves all ±360 wrap copies (angle is invariant
      // under a longitude shift).
      const style =
        'display:inline-block;transform:rotate(' + deg.toFixed(1) + 'deg)' + (color ? ';color:' + color : '');
      const html = '<span style="' + style + '">' + text + '</span>';
      for (let w = -1; w <= 1; w++) {
        L.marker([mid[0] + 0.3, mid[1] + w * 360], {
          icon: L.divIcon({
            className,
            html,
            iconSize: [32, 14],
            iconAnchor: [16, 7],
          }),
          interactive: false,
          keyboard: false,
        }).addTo(layer);
      }
    }
  }

  function splitNorthSouth(seg, centralPath) {
    if (seg.length < 4) return [seg];
    const cp = centralPath;
    const sides = seg.map((pt) => {
      let bestI = 0,
        bestD = Infinity;
      for (let i = 0; i < cp.length; i++) {
        if (!cp[i]) continue;
        const d = (pt[0] - cp[i][0]) ** 2 + (pt[1] - cp[i][1]) ** 2;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      let p = Math.max(0, bestI - 3),
        n = Math.min(cp.length - 1, bestI + 3);
      while (p < bestI && !cp[p]) p++;
      while (n > bestI && !cp[n]) n--;
      if (p === n) return 0;
      const dx = cp[n][1] - cp[p][1],
        dy = cp[n][0] - cp[p][0];
      const px = pt[1] - cp[bestI][1],
        py = pt[0] - cp[bestI][0];
      return dx * py - dy * px;
    });
    const arcs = [];
    let arc = [seg[0]];
    let curSign = Math.sign(sides[0]);
    if (curSign === 0) {
      for (let i = 1; i < sides.length; i++) {
        if (Math.sign(sides[i]) !== 0) {
          curSign = Math.sign(sides[i]);
          break;
        }
      }
    }
    for (let i = 1; i < seg.length; i++) {
      const s = Math.sign(sides[i]);
      if (s !== 0 && curSign !== 0 && s !== curSign) {
        if (arc.length >= 4) arcs.push(arc);
        arc = [];
        curSign = s;
      } else if (s !== 0) {
        curSign = s;
      }
      arc.push(seg[i]);
    }
    if (arc.length >= 3) arcs.push(arc);
    if (arcs.length >= 2 && seg.length > 10) {
      const isClosed =
        Math.abs(seg[0][0] - seg[seg.length - 1][0]) < 0.02 && Math.abs(seg[0][1] - seg[seg.length - 1][1]) < 0.02;
      if (isClosed) {
        const fmi = seg.indexOf(arcs[0][Math.floor(arcs[0].length / 2)]);
        const lmi = seg.indexOf(arcs[arcs.length - 1][Math.floor(arcs[arcs.length - 1].length / 2)]);
        if (fmi >= 0 && lmi >= 0 && Math.sign(sides[fmi]) === Math.sign(sides[lmi])) {
          arcs[arcs.length - 1] = arcs[arcs.length - 1].concat(arcs[0]);
          arcs.shift();
        }
      }
    }
    return arcs.length ? arcs : [seg];
  }

  function splitByHybridBreaks(pts, breaks, firstPhase) {
    if (!breaks || !breaks.length || pts.length < 2) {
      return [{ phase: firstPhase || 'total', pts: pts }];
    }
    const breakIndices = [];
    for (const bp of breaks) {
      let bestIdx = -1,
        bestDist = Infinity;
      for (let i = 0; i < pts.length; i++) {
        if (!pts[i]) continue;
        const dlat = pts[i][0] - bp[0],
          dlng = pts[i][1] - bp[1];
        const d = dlat * dlat + dlng * dlng;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx > 0 && bestIdx < pts.length - 1) breakIndices.push(bestIdx);
    }
    breakIndices.sort((a, b) => a - b);
    if (!breakIndices.length) return [{ phase: firstPhase, pts: pts }];

    const result = [];
    let phase = firstPhase;
    let start = 0;
    for (const bi of breakIndices) {
      result.push({ phase, pts: pts.slice(start, bi + 1) });
      phase = phase === 'total' ? 'annular' : 'total';
      start = bi;
    }
    result.push({ phase, pts: pts.slice(start) });
    return result;
  }

  function drawSolarContactCurves(event, layer) {
    const cc = event.contactCurves;
    if (!cc) return;
    const isAnnular = event.kind === 'Annular';
    const isHybrid = event.kind === 'Hybrid';

    // 1. Equal-magnitude contours (cyan dashed, mag < 1.0 only)
    // smoothFactor omitted → inherits addPolyline's default 0 (keep every cached
    // vertex). The cached envelope for mag=0.2 has 1056+671=1727 raw points; the
    // old explicit smoothFactor:1 collapsed them to ~28, making the smooth envelope
    // look like a coarse polygon and visually mis-comparable to the live ring.
    if (cc.magContours) {
      const opts = { ...CURVE_STYLE.magContour, interactive: true };
      for (const lvl of cc.magContours) {
        if (lvl.mag >= 1.0) continue;
        const tip = curveName('magContour', lvl.mag);
        // Label each side (N=sideA, S=sideB) separately at its arc midpoint, so
        // both branches get a centred label (mirrors the real-time placement).
        for (const side of [asCompact(lvl.sideA), asCompact(lvl.sideB)]) {
          const segs = splitOnNull(side);
          for (const seg of segs) addPolyline(seg, opts, layer, tip);
          placeContourLabel(segs, lvl.mag.toFixed(2), 'iso-mag-curve-label', layer, CURVE_STYLE.magContour.color);
        }
      }
    }

    // 2. Sunrise/sunset 8-loop (pink dashed)
    if (cc.riseSetLoops) {
      const a = asCompact(cc.riseSetLoops.sideA);
      const b = asCompact(cc.riseSetLoops.sideB);
      const aSegs = splitOnNull(a);
      const bSegs = splitOnNull(b);

      const opts = { ...CURVE_STYLE.riseSetLoop, interactive: true };
      const tip = curveName('riseSetLoop');
      // Each loop of a multi-loop 8-loop (total/annular eclipses split at P2/P3
      // into two rings) is the union of a sideA "plus" arc and a sideB "minus"
      // arc that share the SAME P-cusp endpoints. The two sides do NOT store
      // their arcs in a matching order (e.g. 2006-03-29 stores them swapped),
      // so pairing aSegs[i] with bSegs[i] by array index stitches arcs from
      // different rings together and draws a line across the globe. Pair by
      // shared endpoints instead: same-ring arcs have byte-identical cusp
      // coordinates (both pinned to the same anchor), so exact coordinate
      // matching is robust and antimeridian-immune.
      const samePt = (p, q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
      const bUsed = new Array(bSegs.length).fill(false);
      const matchBSeg = (aSeg) => {
        const a0 = aSeg[0],
          a1 = aSeg[aSeg.length - 1];
        for (let j = 0; j < bSegs.length; j++) {
          if (bUsed[j]) continue;
          const bSeg = bSegs[j],
            b0 = bSeg[0],
            b1 = bSeg[bSeg.length - 1];
          // Same orientation: a0↔b0, a1↔b1 → append reverse(bSeg)
          if (samePt(a0, b0) && samePt(a1, b1)) return { j, seg: bSeg.slice().reverse() };
          // Flipped: a0↔b1, a1↔b0 → bSeg already runs back, append as-is
          if (samePt(a0, b1) && samePt(a1, b0)) return { j, seg: bSeg.slice() };
        }
        return null;
      };
      const usedA = new Array(aSegs.length).fill(false);
      for (let i = 0; i < aSegs.length; i++) {
        const m = matchBSeg(aSegs[i]);
        if (!m) continue; // unmatched → drawn as open arc below
        bUsed[m.j] = true;
        usedA[i] = true;
        const loop = aSegs[i].concat(m.seg);
        if (loop.length > 2) {
          loop.push(aSegs[i][0]);
          addPolyline(loop, opts, layer, tip);
        }
      }
      // Any arcs without an endpoint-matched partner are drawn as open polylines.
      for (let i = 0; i < aSegs.length; i++) if (!usedA[i]) addPolyline(aSegs[i], opts, layer, tip);
      for (let j = 0; j < bSegs.length; j++) if (!bUsed[j]) addPolyline(bSegs[j], opts, layer, tip);
    }

    // 3. Rise-max + set-max eclipse curves (pink solid)
    const riseMax = asCompact(cc.riseMaxEclipse);
    const setMax = asCompact(cc.setMaxEclipse);
    if (riseMax.length || setMax.length) {
      const opts = { ...CURVE_STYLE.riseSetMax, interactive: true };
      for (const seg of splitOnNull(riseMax)) addPolyline(seg, opts, layer, curveName('riseMaxEclipse'));
      for (const seg of splitOnNull(setMax)) addPolyline(seg, opts, layer, curveName('setMaxEclipse'));
    }

    // 4. Penumbral N/S limits (always green)
    const nl = asCompact(cc.nLimit);
    if (nl.length > 1) {
      const optsLim = { ...CURVE_STYLE.penumbralLimit, interactive: true };
      for (const seg of splitOnNull(nl)) addPolyline(seg, optsLim, layer, curveName('nLimit'));
    }
    const sl = asCompact(cc.sLimit);
    if (sl.length > 1) {
      const optsLim = { ...CURVE_STYLE.penumbralLimit, interactive: true };
      for (const seg of splitOnNull(sl)) addPolyline(seg, optsLim, layer, curveName('sLimit'));
    }

    // 5. Umbral/antumbral N/S limits — Total: magenta, Annular: dark orange, Hybrid: split
    const unl = asCompact(cc.umbralNLimit);
    const usl = asCompact(cc.umbralSLimit);
    if (isHybrid && cc.hybridBreaks) {
      // Umbral-limit segments are null-separated fragments whose array order
      // does NOT follow the central path's spatial order.  Instead of splitting
      // the flat array by break coordinates, project each segment's midpoint
      // onto the central path to determine its phase.
      const cp = asCompact(cc.centralPath);
      const fp = cc.hybridFirstPhase || 'annular';
      const breakIdxOnCp = cc.hybridBreaks
        .map((bp) => {
          let best = 0,
            bestD = Infinity;
          for (let i = 0; i < cp.length; i++) {
            if (!cp[i]) continue;
            const d = (cp[i][0] - bp[0]) ** 2 + (cp[i][1] - bp[1]) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          return best;
        })
        .sort((a, b) => a - b);
      for (const [pts, nOrS] of [
        [unl, 'N'],
        [usl, 'S'],
      ]) {
        if (pts.length < 2) continue;
        for (const rawSeg of splitOnNull(pts)) {
          if (rawSeg.length < 5) continue;
          for (const seg of splitNorthSouth(rawSeg, cp)) {
            const mid = seg[Math.floor(seg.length / 2)];
            let bestCpIdx = 0,
              bestD = Infinity;
            for (let i = 0; i < cp.length; i++) {
              if (!cp[i]) continue;
              const d = (cp[i][0] - mid[0]) ** 2 + (cp[i][1] - mid[1]) ** 2;
              if (d < bestD) {
                bestD = d;
                bestCpIdx = i;
              }
            }
            let crossings = 0;
            for (const bi of breakIdxOnCp) {
              if (bestCpIdx > bi) crossings++;
            }
            let phase = fp;
            for (let j = 0; j < crossings; j++) phase = phase === 'total' ? 'annular' : 'total';
            const style = phase === 'total' ? CURVE_STYLE.umbralLimit : CURVE_STYLE.umbralLimitAnn;
            const k =
              phase === 'total'
                ? nOrS === 'N'
                  ? 'umbralNLimit'
                  : 'umbralSLimit'
                : nOrS === 'N'
                  ? 'antumbralNLimit'
                  : 'antumbralSLimit';
            const o = { ...style, interactive: true };
            addPolyline(seg, o, layer, curveName(k));
          }
        }
      }
    } else {
      const uStyle = isAnnular ? CURVE_STYLE.umbralLimitAnn : CURVE_STYLE.umbralLimit;
      if (unl.length > 1) {
        const optsU = { ...uStyle, interactive: true };
        const uNKey = isAnnular ? 'antumbralNLimit' : 'umbralNLimit';
        for (const seg of splitOnNull(unl)) addPolyline(seg, optsU, layer, curveName(uNKey));
      }
      if (usl.length > 1) {
        const optsU = { ...uStyle, interactive: true };
        const uSKey = isAnnular ? 'antumbralSLimit' : 'umbralSLimit';
        for (const seg of splitOnNull(usl)) addPolyline(seg, optsU, layer, curveName(uSKey));
      }
    }

    // 6. Central path — Total: deep magenta, Annular: orange, Hybrid: split
    const cp = asCompact(cc.centralPath);
    if (cp.length > 1) {
      if (isHybrid && cc.hybridBreaks) {
        const fp = cc.hybridFirstPhase || 'annular';
        for (const { phase, pts: seg } of splitByHybridBreaks(cp, cc.hybridBreaks, fp)) {
          const style = phase === 'total' ? CURVE_STYLE.centralTotal : CURVE_STYLE.centralAnnular;
          const k = phase === 'total' ? 'centralTotal' : 'centralAnnular';
          const o = { ...style, interactive: true };
          for (const s of splitOnNull(seg)) addPolyline(s, o, layer, curveName(k));
        }
      } else {
        const cStyle = isAnnular ? CURVE_STYLE.centralAnnular : CURVE_STYLE.centralTotal;
        const cKey = isAnnular ? 'centralAnnular' : 'centralTotal';
        const optsC = { ...cStyle, interactive: true };
        for (const seg of splitOnNull(cp)) addPolyline(seg, optsC, layer, curveName(cKey));
      }
    }

    // 7. Greatest-eclipse marker — placed in eclipse-curves-points (z=630) so it
    // sits above the central-path polyline and mouse events reach it.
    if (event.peak && typeof event.peak.lat === 'number') {
      addWrappedMarker(
        event.peak.lat,
        event.peak.lng,
        'eclipse-greatest-marker',
        layer,
        '✴',
        curveName('greatestEclipse')
      );
    }
  }

  function drawLunarContactCurves(event, layer) {
    const cp = event.contactPoints;
    if (!cp) return;
    // Each contact instant gets a 91.78° great circle (visibility hemisphere
    // outline). Penumbral contacts (P1/P4) are dashed and dim; partial
    // contacts (U1/U4) are solid medium; total contacts (U2/U3) are solid
    // bright; greatest (G) is the highlight.
    const STYLE = {
      p1: CURVE_STYLE.lunarPenumbral,
      u1: CURVE_STYLE.lunarPartial,
      u2: CURVE_STYLE.lunarTotal,
      peak: CURVE_STYLE.lunarPeak,
      u3: CURVE_STYLE.lunarTotal,
      u4: CURVE_STYLE.lunarPartial,
      p4: CURVE_STYLE.lunarPenumbral,
    };

    const ORDER = ['p1', 'u1', 'u2', 'peak', 'u3', 'u4', 'p4'];
    for (const k of ORDER) {
      const pt = cp[k];
      if (!pt) continue;
      // 91.78° visibility hemisphere = small circle of radius 90−1.78 around
      // the ANTI-sub-lunar point. Reuse map.js's holed-veil arc machinery
      // (720-pt sweep + antimeridian split + polar double-arc) so the outline
      // stays smooth and geometry-correct across poles — no more 96-pt creases.
      // addPolyline handles world-wrap copies and antimeridian re-splitting.
      // interactive:true + tooltip → hover names the contact's visibility edge
      // (parity with solar curves); the path opts back into pointer events even
      // though the eclipse-curves pane is pointerEvents:'none'.
      const name = lunarRangeName(k);
      const arcs = _computeAltitudeContourArcs(-pt.lat, pt.lng + 180, 1.78);
      for (const arc of arcs) {
        if (arc.length >= 2) addPolyline(arc, { ...STYLE[k], interactive: true }, layer, name);
      }
    }
  }

  // Localized name for a lunar contact circle. These are geographic visibility
  // boundaries (Moon on the horizon at the contact instant), so they use the
  // eclipse.lunar.range.* line-names — NOT the sidebar's eclipse.lunar.contact.*
  // time-event labels. ORDER uses 'peak'; the i18n key is 'greatest'.
  function lunarRangeName(k) {
    const key = 'eclipse.lunar.range.' + (k === 'peak' ? 'greatest' : k);
    return typeof I18n !== 'undefined' ? I18n.t(key) : key;
  }

  function drawContactCurves(event, layer) {
    layer.clearLayers();
    // Snapshot the viewport once for this whole draw pass; every addPolyline
    // call below reads it to cull off-screen world-copies.
    _curveViewport = _map ? viewportLngSpan(_map, curveMargin(_map)) : null;
    if (event._kind === 'solar') drawSolarContactCurves(event, layer);
    else drawLunarContactCurves(event, layer);
  }

  // ---- Public Init ----

  function init(map) {
    _map = map; // expose for addPolyline's viewport-wrap culling
    // Create eclipse panes eagerly so drawSolarContactCurves can always use them.
    if (!map.getPane('eclipse-curves')) {
      map.createPane('eclipse-curves');
      map.getPane('eclipse-curves').style.zIndex = 629; // above twilight-mask(612) + coord grids
      // Curves are added with interactive:false; keep the pane itself click-
      // through too (it floats above grids/UI) so it never steals pointer events.
      map.getPane('eclipse-curves').style.pointerEvents = 'none';
    }
    if (!map.getPane('eclipse-curves-points')) {
      map.createPane('eclipse-curves-points');
      map.getPane('eclipse-curves-points').style.zIndex = 630; // above eclipse-curves(629) so markers are hittable
      // Allow pointer events so greatest-eclipse marker tooltip fires.
      map.getPane('eclipse-curves-points').style.pointerEvents = 'auto';
    }

    const soloLayer = L.layerGroup();
    const eclipseListLayer = L.layerGroup(); // empty hook; sidebar opens on add
    const curvesLayer = L.layerGroup().addTo(map); // contact curves of selected event

    // Currently-selected event, kept so moveend/zoomend can re-draw its contact
    // curves with viewport-restricted world-copies. _lastCurveWrapsKey short-
    // circuits redraws when the visible viewport hasn't changed enough to alter
    // the drawn wrap set (intra-wrap pans cost 0).
    let _selectedEvent = null;
    let _lastCurveWrapsKey = '';

    function redrawSelectedCurves(force) {
      if (!_selectedEvent) return;
      const key = curveWrapsKey(map);
      if (!force && key === _lastCurveWrapsKey) return;
      _lastCurveWrapsKey = key;
      drawContactCurves(_selectedEvent, curvesLayer);
    }

    // Ephemeral per-tick group (solar shadow circles). Lunar eclipses no
    // longer draw a real-time overlay here — their presence is shown by the
    // moonlight veil reddening (map.js, via Eclipse.lunarRedness).
    let _shadowGroup = null;
    let _lastShadowKey = null; // (instant|zEff|wraps) gate for the zoom-reuse skip

    soloLayer.on('add', () => {
      loadData(() => redrawShadow(soloLayer));
    });
    soloLayer.on('remove', () => {
      clearSelection();
      soloLayer.clearLayers();
      _shadowGroup = null; // dropped by clearLayers; recreate on next add
      _lastShadowKey = null; // force a full rebuild on next add
    });

    eclipseListLayer.on('add', () => {
      loadData(() => {
        if (typeof Sidebar !== 'undefined') {
          Sidebar.showEclipseList(makeListController(), selectEvent);
        }
      });
    });

    function redrawShadow(layer) {
      // Rebuild the cheap vector overlay each tick (solar shadow circles only).
      if (!_shadowGroup) _shadowGroup = L.layerGroup().addTo(layer);

      const date = TimeState.current;
      const solar = findActiveSolar(date);

      // Zoom-reuse gate. For an active solar eclipse drawn by the Bessel renderer
      // the whole shadow geometry is a pure function of (instant, zEff) — past
      // Z_CAP the densify density and the umbra seed azimuth count are frozen, so
      // a zoomend that changes neither the instant nor zEff (e.g. 9→10→…→13)
      // would rebuild the same ~140 ms of field-cached densify + projection for no
      // visible change. Skip it and let Leaflet reproject the few existing paths
      // for free. curveWrapsKey guards the (currently pan-free) case of a redraw
      // revealing a new world-copy. _lastShadowKey is cleared on layer remove and
      // whenever a non-Bessel / no-eclipse path runs below.
      const _zEff = Math.min(map.getZoom(), Z_CAP);
      const _bessel = solar && typeof BesselRT !== 'undefined' && typeof Astronomy !== 'undefined';
      const _gateKey = _bessel ? date.getTime() + '|' + _zEff + '|' + curveWrapsKey(map) : null;
      if (_gateKey && _gateKey === _lastShadowKey && _shadowGroup.getLayers().length) return;

      _shadowGroup.clearLayers();
      // Snapshot the viewport so any addPolyline below (lunar realtime visibility
      // hemisphere) culls off-screen world-copies like the contact curves do.
      _curveViewport = _map ? viewportLngSpan(_map, curveMargin(_map)) : null;

      if (solar) {
        if (_bessel) {
          const s = computeSolarShadow(date, solar);
          if (s) {
            renderSolarShadow(s, _shadowGroup, map.getZoom(), date.getTime());
            _lastShadowKey = _gateKey;
          } else _lastShadowKey = null;
        } else {
          const s = computeSolarShadowSphere(date);
          if (s) renderSolarShadowSphere(s, _shadowGroup);
          _lastShadowKey = null;
        }
        return;
      }
      _lastShadowKey = null;
      // Lunar eclipse: real-time visibility hemisphere (Moon above the horizon
      // = where the eclipse is visible right now), drawn as a dashed great
      // circle — mirrors the solar real-time penumbra-visibility edge. The
      // moonlight veil reddening (map.js) conveys "an eclipse is happening";
      // this conveys "where on Earth it's visible at this instant".
      const lunar = findActiveLunar(date);
      if (lunar && typeof Astronomy !== 'undefined' && typeof _computeAltitudeContourArcs === 'function') {
        const eq = Astronomy.Equator(Astronomy.Body.Moon, date, new Astronomy.Observer(0, 0, 0), false, true);
        const gast = Astronomy.SiderealTime(date) * 15;
        const subLat = eq.dec;
        const subLng = ((eq.ra * 15 - gast + 540) % 360) - 180;
        // 91.78° visibility hemisphere = small circle of radius 90−1.78 around
        // the anti-sub-lunar point (same machinery as drawLunarContactCurves).
        const arcs = _computeAltitudeContourArcs(-subLat, subLng + 180, 1.78);
        for (const arc of arcs) {
          if (arc.length >= 2)
            addPolyline(
              arc,
              {
                color: '#94a3b8',
                weight: 1,
                opacity: 0.55,
                dashArray: '4 4',
                interactive: false,
              },
              _shadowGroup
            );
        }
      }
    }

    function clearSelection() {
      curvesLayer.clearLayers();
      _selectedEvent = null;
      if (TimeState.unlockRange) TimeState.unlockRange();
    }

    // Solar contact curves live in per-event JSON files (data/eclipses/
    // events/<date>.json) to keep the master index small. Fetched on demand;
    // cache:'no-cache' ensures the browser revalidates (304 if unchanged)
    // so rebuilds are picked up without a hard refresh.
    function loadCurvesFor(event) {
      if (!event._curves_url) {
        return Promise.resolve(event.contactCurves || null);
      }
      const url = `data/eclipses/${event._curves_url}`;
      return fetch(url, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const cc = data ? data.contactCurves : null;
          if (cc) event.contactCurves = cc;
          return cc;
        })
        .catch(() => null);
    }

    function selectEvent(e, opts) {
      const isSolar = e._kind === 'solar';
      const peakTime = isSolar ? e.peak.time : e.times.peak;
      const p1Iso = isSolar ? e.p1 : e.times && e.times.p1;
      const p4Iso = isSolar ? e.p4 : e.times && e.times.p4;
      const doResetTime = !opts || opts.resetTime !== false;
      if (doResetTime && p1Iso && p4Iso && TimeState.lockRange) {
        TimeState.lockRange(new Date(p1Iso), new Date(p4Iso));
      } else if (doResetTime) {
        TimeState.resetTo(new Date(peakTime));
      }
      // For solar events, fetch the per-event curves file before rendering.
      if (isSolar) {
        loadCurvesFor(e).then((cc) => {
          // Splice fetched curves in, then render.
          if (cc) e.contactCurves = cc;
          _selectedEvent = e;
          _lastCurveWrapsKey = curveWrapsKey(map);
          drawContactCurves(e, curvesLayer);
        });
      } else {
        _selectedEvent = e;
        _lastCurveWrapsKey = curveWrapsKey(map);
        drawContactCurves(e, curvesLayer);
      }

      if (isSolar) {
        // Selecting an eclipse means "take me there" — always fly to the peak,
        // except when the user is watching an in-progress event in place
        // (resetTime:false). peak.lng is canonical [-180,180] but getBounds/
        // getCenter live in the projected -200°..+520° wrap span, so normalize
        // the peak to the world-copy nearest the current view — otherwise the
        // pan can sweep a needless full 360° across copies (see world-wrap).
        if (doResetTime) {
          const peakLat = e.peak.lat;
          let peakLng = e.peak.lng;
          const centerLng = map.getCenter().lng;
          while (peakLng - centerLng > 180) peakLng -= 360;
          while (peakLng - centerLng < -180) peakLng += 360;
          map.flyTo([peakLat, peakLng], Math.max(map.getZoom(), 4));
        }
        Sidebar.showEclipse(e, clearSelection);
      } else {
        Sidebar.showLunarEclipse(e, clearSelection);
      }
    }

    TimeState.subscribe((date) => {
      if (!_loaded) return;
      if (map.hasLayer(soloLayer)) redrawShadow(soloLayer);
    });

    // Re-render the shadow after a zoom so the umbra/antumbra ring picks the
    // zoom-appropriate azimuth count (keeps it smooth when zoomed in, cheap when
    // zoomed out). Only the real-time solar shadow is zoom-resolution-dependent.
    // Also force a contact-curve redraw: zoom changes both the visible wrap set
    // and the per-vertex reprojection cost, so always rebuild (the moveend that
    // follows a zoom gesture then short-circuits on the now-matching wrap key).
    map.on('zoomend', () => {
      if (_loaded && map.hasLayer(soloLayer) && findActiveSolar(TimeState.current)) {
        redrawShadow(soloLayer);
      }
      if (_loaded) redrawSelectedCurves(true);
    });

    // Pan: re-draw the selected event's contact curves so curves appear in the
    // world-copies that just scrolled into view (and drop those that left).
    // Gated by the wrap-key short-circuit so intra-wrap pans pay 0 cost.
    map.on('moveend', () => {
      if (_loaded) redrawSelectedCurves(false);
    });

    // Language switch: the curve hover tooltips (curveName → I18n.t) are baked
    // into bindTooltip at draw time, so force a redraw of the selected event's
    // contact curves to re-localize them. force=true since the wrap key is
    // unchanged by a locale change.
    if (typeof I18n !== 'undefined' && I18n.subscribe) {
      I18n.subscribe(() => {
        if (_loaded) redrawSelectedCurves(true);
      });
    }

    _pub = { map, soloLayer, eclipseListLayer, selectEvent, clearSelection };
    return { soloLayer, eclipseListLayer, selectEvent, clearSelection };
  }

  return {
    init,
    lunarRedness,
    ready,
    findActive,
    nextVisible: nextVisibleCached,
    classifySolar,
    solarLocalContacts: solarLocalContactsCached,
    classifyLunar,
    openEvent,
    getAllSorted,
  };
})();
