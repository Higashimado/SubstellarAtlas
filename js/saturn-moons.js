/**
 * saturn-moons.js — Saturncentric positions of the major Saturnian satellites.
 *
 * astronomy-engine has no Saturn-moon analog of JupiterMoons(), so the map carries
 * its own ephemeris: the TASS 1.7 theory (Vienne & Duriez 1995), parsed into
 * data/saturn-moons/tass17.json by tools/build-saturn-moons.mjs. This module loads
 * that table once and evaluates it per frame — a drop-in counterpart to
 * Astronomy.JupiterMoons(t), returning Saturncentric vectors in AU.
 *
 * Frame note: the series live in the TASS reference frame; the tass_to_vsop87
 * rotation takes them to the VSOP87 ecliptic-J2000 frame. state() returns ECLIPTIC
 * J2000 (not equatorial) — js/planets.js rotates ECL→EQJ via Astronomy Engine so
 * the obliquity convention matches GeoVector(Saturn) exactly before summing.
 *
 * The evaluator is the exact code validated against JPL Horizons by
 * tools/verify-saturn-moons.mjs (which requires this file directly, so the shipping
 * math is the tested math).
 *
 * Public API (SaturnMoons):
 *   init()            — fetch the table once; resolves when ready (idempotent).
 *   state(time)       — { enceladus:{x,y,z}, … } Saturncentric ecliptic-J2000 AU,
 *                       or null if the table has not loaded yet. `time` is an
 *                       Astronomy Engine time (reads its .tt field).
 *   MOON_KEYS         — render order of the six bright moons.
 */
const SaturnMoons = (() => {
  const TWO_PI = 2 * Math.PI;

  // Bright moons rendered by the map, in tass17.json body-index order
  // (index 0 is Mimas, kept only as a fundamental argument and not returned here).
  const MOON_KEYS = ['enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus'];

  // ---- TASS 1.7 Evaluation (pure; shared by browser and verify tool) ----

  function mod2pi(x) {
    return x - TWO_PI * Math.floor(x / TWO_PI);
  }

  // Solve the TASS elliptic motion for one satellite at the evaluated elements,
  // returning Saturncentric rectangular coordinates in the TASS frame (AU).
  // elem = [n, L, K=e·cos ϖ, H=e·sin ϖ, Q=sin(i/2)·cos Ω, P=sin(i/2)·sin Ω].
  // This is EllipticToRectangularN with dt = 0 (elements already at the target time);
  // velocity terms are dropped — only the position is needed.
  function ellipticToRectangular(mu, elem) {
    const n = elem[0];
    const a = Math.cbrt(mu / (n * n));
    const L = mod2pi(elem[1]);

    // Kepler's equation by Newton iteration (eccentricity well below 1).
    let Le = L - elem[2] * Math.sin(L) + elem[3] * Math.cos(L);
    for (;;) {
      const cLe = Math.cos(Le);
      const sLe = Math.sin(Le);
      const dLe = (L - Le + elem[2] * sLe - elem[3] * cLe) / (1 - elem[2] * cLe - elem[3] * sLe);
      Le += dLe;
      if (Math.abs(dLe) <= 1e-14) break;
    }

    const cLe = Math.cos(Le);
    const sLe = Math.sin(Le);
    const dlf = -elem[2] * sLe + elem[3] * cLe;
    const phi = Math.sqrt(1 - elem[2] * elem[2] - elem[3] * elem[3]);
    const psi = 1 / (1 + phi);

    const x1 = a * (cLe - elem[2] - psi * dlf * elem[3]);
    const y1 = a * (sLe - elem[3] + psi * dlf * elem[2]);

    const q2 = elem[4] * elem[4];
    const p2 = elem[5] * elem[5];
    const dwho = 2 * Math.sqrt(1 - q2 - p2);
    const rtp = 1 - p2 - p2;
    const rtq = 1 - q2 - q2;
    const rdg = 2 * elem[5] * elem[4];

    return [x1 * rtp + y1 * rdg, x1 * rdg + y1 * rtq, (-x1 * elem[5] + y1 * elem[4]) * dwho];
  }

  // Accumulate Σ i[k]·lon[k] — the proper-longitude combination that becomes a term's
  // argument, encoding the mutual resonances between satellites.
  function argCombo(iCoeffs, lon) {
    let arg = 0;
    for (let k = 0; k < lon.length; k++) arg += iCoeffs[k] * lon[k];
    return arg;
  }

  // Evaluate the whole table at Julian Date (TT) jdTT → Saturncentric ecliptic-J2000
  // vectors (AU) for the six bright moons.
  function computeState(data, jdTT) {
    const T = jdTT - data.epoch_jd;
    const bodies = data.bodies;

    // Fundamental proper mean longitudes (one per body 0…6): the first multiterm of
    // each body's longitude series, summed as sines. These drive every other term's
    // argument, so all seven — including the unrendered Mimas — are required.
    const lon = new Array(bodies.length);
    for (let i = 0; i < bodies.length; i++) {
      const terms = bodies[i].series[1][0].terms;
      let s = 0;
      for (let k = 0; k < terms.length; k++) {
        s += terms[k][0] * Math.sin(terms[k][1] + terms[k][2] * T);
      }
      lon[i] = s;
    }

    const out = {};
    for (let b = 1; b <= 6; b++) {
      const body = bodies[b];
      const elem = body.s0.slice();

      // series[0] → mean motion: n = aam · (1 + Σ amp·cos(arg)).
      let acc = 0;
      for (const mt of body.series[0]) {
        const arg = argCombo(mt.i, lon);
        for (const tm of mt.terms) acc += tm[0] * Math.cos(tm[1] + tm[2] * T + arg);
      }
      elem[0] = body.aam * (1 + acc);

      // series[1] → mean longitude L: first multiterm already summed as lon[b];
      // remaining multiterms add as sines, plus the secular aam·T.
      const lonSeries = body.series[1];
      elem[1] += lon[b];
      for (let j = 1; j < lonSeries.length; j++) {
        const mt = lonSeries[j];
        const arg = argCombo(mt.i, lon);
        for (const tm of mt.terms) elem[1] += tm[0] * Math.sin(tm[1] + tm[2] * T + arg);
      }
      elem[1] += body.aam * T;

      // series[2] → z = K + iH (eccentricity vector).
      for (const mt of body.series[2]) {
        const arg = argCombo(mt.i, lon);
        for (const tm of mt.terms) {
          const x = tm[1] + tm[2] * T + arg;
          elem[2] += tm[0] * Math.cos(x);
          elem[3] += tm[0] * Math.sin(x);
        }
      }

      // series[3] → ζ = Q + iP (inclination vector).
      for (const mt of body.series[3]) {
        const arg = argCombo(mt.i, lon);
        for (const tm of mt.terms) {
          const x = tm[1] + tm[2] * T + arg;
          elem[4] += tm[0] * Math.cos(x);
          elem[5] += tm[0] * Math.sin(x);
        }
      }

      const xt = ellipticToRectangular(body.mu, elem);
      const m = data.tass_to_vsop87;
      out[body.name.toLowerCase()] = {
        x: m[0] * xt[0] + m[1] * xt[1] + m[2] * xt[2],
        y: m[3] * xt[0] + m[4] * xt[1] + m[5] * xt[2],
        z: m[6] * xt[0] + m[7] * xt[1] + m[8] * xt[2],
      };
    }
    return out;
  }

  // ---- Browser Loading and Public Entry ----

  let _data = null;
  let _loading = null;

  function init() {
    if (_data) return Promise.resolve();
    if (_loading) return _loading;
    _loading = fetch('data/saturn-moons/tass17.json')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((d) => {
        _data = d;
      })
      .catch((e) => {
        console.warn('[saturn-moons] load failed', e);
        _loading = null;
      });
    return _loading;
  }

  // `time` is an Astronomy Engine time; .tt is TT days past J2000. Memoize the last
  // epoch: each frame asks for all six moons (plus info-card/search lookups), all at
  // the same instant, so one full evaluation per tick is enough.
  let _cacheTT = NaN;
  let _cacheState = null;

  function state(time) {
    if (!_data) return null;
    if (time.tt === _cacheTT) return _cacheState;
    _cacheState = computeState(_data, time.tt + 2451545.0);
    _cacheTT = time.tt;
    return _cacheState;
  }

  const api = { init, state, MOON_KEYS, _computeState: computeState };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SaturnMoons = api;
  return api;
})();
