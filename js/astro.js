/**
 * astro.js — Astronomical calculations — single engine: Astronomy Engine, shared
 * with the observer compass so rise/set/twilight match (same −0.833° apparent-limb
 * horizon convention).
 */

// Sgr A* coordinates (J2000): RA = 17h45m40s, Dec = -29.0078°
const SGR_A_RA = 17 + 45 / 60 + 40 / 3600; // hours
const SGR_A_DEC = -29.0078; // degrees

// Observer's local-mean-time midnight (longitude-based, NOT app timezone) — the
// same anchor the compass searches a day's rise/set from (observer.js
// observerMidnightMs), so both subsystems bracket the identical solar day.
function _observerMidnight(lat, lng, date) {
  const lngOffsetMs = (lng / 15) * 3600000;
  const localMs = date.getTime() + lngOffsetMs;
  return new Date(Math.floor(localMs / 86400000) * 86400000 - lngOffsetMs);
}

// Rise/set via Astronomy Engine (apparent upper-limb at horizon → sun center
// ≈ −0.833°). direction: +1 rise, −1 set. Returns a Date or null (polar).
function _searchRiseSet(body, observer, direction, dateStart, limitDays = 1) {
  try {
    // limitDays sign also sets search direction in time: positive = future,
    // negative = past (used to find the rise that precedes a moment).
    const r = Astronomy.SearchRiseSet(body, observer, direction, dateStart, limitDays);
    return r && r.date ? r.date : null;
  } catch (_) {
    return null;
  }
}

// Sun crossing a fixed altitude (twilight depressions −6/−12/−18). Returns Date
// or null (depression never reached → polar day/night).
function _searchSunAltitude(observer, direction, dateStart, altDeg) {
  try {
    const r = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, direction, dateStart, 1, altDeg);
    return r && r.date ? r.date : null;
  } catch (_) {
    return null;
  }
}

// Apparent horizontal coordinates (az/alt in degrees) of a body at an instant —
// the eclipse sidebar shows these beside each contact moment. Two-step
// Equator→Horizon with the same apparent, refraction-corrected convention as the
// observer compass. `body` is an Astronomy.Body. Returns { az, alt } or null.
function bodyHorizontal(body, date, lat, lng) {
  try {
    const obs = new Astronomy.Observer(lat, lng, 0);
    const equ = Astronomy.Equator(body, date, obs, true, true);
    const hor = Astronomy.Horizon(date, obs, equ.ra, equ.dec, 'normal');
    return { az: hor.azimuth, alt: hor.altitude };
  } catch (_) {
    return null;
  }
}

// 8-point compass abbreviation for an azimuth, assembled from the four localized
// cardinal letters (rays.cardinal.*) so it needs no extra translation keys.
function azCompass(az) {
  const _t = typeof I18n !== 'undefined' ? I18n.t.bind(I18n) : (k) => k;
  const N = _t('rays.cardinal.n'),
    E = _t('rays.cardinal.e'),
    S = _t('rays.cardinal.s'),
    W = _t('rays.cardinal.w');
  const pts = [N, N + E, E, S + E, S, S + W, W, N + W];
  return pts[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}

// Next "light window" at or after `date`: the contiguous interval when the sun's
// altitude lies within [loAlt, hiAlt] that has not yet ended. Used for golden
// hour ([−4°, +6°]) and blue hour ([−6°, −4°]). Unlike the midnight-anchored
// twilight rows this searches FORWARD from `date`, so it always reports the
// upcoming — or currently-active — occurrence. Returns {start, end} Dates, or
// null when the sun never enters the band within the horizon (polar day/night).
function _nextSolarBand(observer, date, loAlt, hiAlt, horizonDays = 2) {
  const Sun = Astronomy.Body.Sun;
  try {
    // The band's next exit: rising through the top (hiAlt) ends a morning
    // window; setting through the bottom (loAlt) ends an evening window. Search
    // both forward from `date`, then take whichever exit comes first.
    const exitAscHi = Astronomy.SearchAltitude(Sun, observer, +1, date, horizonDays, hiAlt);
    const exitDescLo = Astronomy.SearchAltitude(Sun, observer, -1, date, horizonDays, loAlt);
    let end = null,
      morning = false;
    if (exitAscHi && exitDescLo) {
      morning = exitAscHi.date.getTime() <= exitDescLo.date.getTime();
      end = morning ? exitAscHi.date : exitDescLo.date;
    } else if (exitAscHi) {
      end = exitAscHi.date;
      morning = true;
    } else if (exitDescLo) {
      end = exitDescLo.date;
      morning = false;
    }
    if (!end) return null;
    // The matching entry just before `end`, found by searching BACKWARD from it
    // (negative limitDays): a morning window is entered rising through loAlt, an
    // evening window setting through hiAlt. Searching from `end` keeps the start
    // in the past when the window is already in progress.
    const entry = morning
      ? Astronomy.SearchAltitude(Sun, observer, +1, end, -horizonDays, loAlt)
      : Astronomy.SearchAltitude(Sun, observer, -1, end, -horizonDays, hiAlt);
    if (!entry || !entry.date) return null;
    return { start: entry.date, end };
  } catch (_) {
    return null;
  }
}

// Moon's illuminated fraction (0..1) via Astronomy Engine. Global so the sidebar
// chart can share the single engine. Returns 0 on failure.
function moonIlluminationFraction(date) {
  try {
    return Astronomy.Illumination(Astronomy.Body.Moon, date).phase_fraction;
  } catch (_) {
    return 0;
  }
}

// Bare moonphase slug suffix for a phase fraction (0=new, 0.5=full). Shared by
// moonPhaseName and by glossary tooltips, so name and definition stay in sync.
function moonPhaseKey(phase) {
  if (phase < 0.03 || phase > 0.97) return 'new';
  if (phase < 0.22) return 'waxing_crescent';
  if (phase < 0.28) return 'first_quarter';
  if (phase < 0.47) return 'waxing_gibbous';
  if (phase < 0.53) return 'full';
  if (phase < 0.72) return 'waning_gibbous';
  if (phase < 0.78) return 'last_quarter';
  return 'waning_crescent';
}

function moonPhaseName(phase) {
  const _t =
    typeof I18n !== 'undefined'
      ? I18n.t.bind(I18n)
      : function (k) {
          return k;
        };
  return _t('moonphase.' + moonPhaseKey(phase));
}

// Upper transit (meridian crossing, hour angle 0) of any body. Returns
// { time, alt } (alt = altitude at transit, deg) or null. SearchHourAngle's
// HourAngleEvent carries .hor (horizontal coords) so no extra Horizon call.
function getBodyTransit(body, lat, lng, date) {
  if (typeof Astronomy === 'undefined' || !Astronomy.SearchHourAngle) return null;
  try {
    const observer = new Astronomy.Observer(lat, lng, 0);
    const t = Astronomy.MakeTime(date);
    const evt = Astronomy.SearchHourAngle(body, observer, 0, t, +1);
    if (!evt || !evt.time) return null;
    return { time: evt.time.date, alt: evt.hor ? evt.hor.altitude : NaN };
  } catch (_) {
    return null;
  }
}

// Back-compat thin wrapper: just the Moon's transit time (used by getSunMoonInfo).
function getMoonTransit(lat, lng, date) {
  const tr = getBodyTransit(Astronomy.Body.Moon, lat, lng, date);
  return tr ? tr.time : null;
}

// Current geometric altitude (deg) of a body for an already-built observer.
// Same single-engine path as getGalacticCoreCurve (refraction 'normal').
function getBodyAltNow(body, observer, date) {
  try {
    const t = Astronomy.MakeTime(date);
    const equ = Astronomy.Equator(body, t, observer, true, true);
    return Astronomy.Horizon(t, observer, equ.ra, equ.dec, 'normal').altitude;
  } catch (_) {
    return NaN;
  }
}

// Body altitude (deg) at an absolute time for a pre-built observer. Lighter than
// getBodyAltNow only in that the caller supplies the AstroTime, so the grid
// sampler below can reuse one MakeTime per step across all bodies.
function _bodyAltAt(body, observer, astroTime) {
  try {
    const equ = Astronomy.Equator(body, astroTime, observer, true, true);
    return Astronomy.Horizon(astroTime, observer, equ.ra, equ.dec, 'normal').altitude;
  } catch (_) {
    return NaN;
  }
}

// Planet observe window = contiguous span on the observer's solar day where the
// planet is above the horizon (alt > 0°) AND the sun is below civil dusk (−6°).
// Sampled on the same solar-noon-anchored 15-min grid as the galactic curve, so
// the night sits centred and the window never straddles the noon seam. Edges are
// linearly refined to the minute against whichever constraint flips. Returns
// { window:{start,end}|null, peakAlt }.
const _ALMANAC_FLOOR_DEG = 0; // minimum altitude to count as "observable"
const _ALMANAC_DARK_DEG = -6; // sun must be below civil dusk for planets
const _OUTER_QUAD_DEG = 90; // outer planet "well placed" = elongation ≥ 90°
// (the eastern-quadrature → opposition → western-
// quadrature half of the orbit).
const _INNER_GE_FRAC = 0.7; // inner planet "well placed" = elongation ≥ 0.7×
// this apparition's greatest elongation (near GE).
function _planetObserveWindow(body, observer, grid) {
  // Grid: [{ ms, astroTime, sunAlt }] solar-noon → next solar-noon, 15-min steps.
  const alt = grid.map((g) => _bodyAltAt(body, observer, g.astroTime));

  // Precise civil dusk/dawn via SearchAltitude — exact crossings, no grid approximation.
  // Anchor BOTH searches at the grid's noon start (grid[0].ms): the grid spans
  // noon→noon, so the dark interval we want is this evening's dusk through the NEXT
  // morning's dawn. Anchoring at local midnight (noon − 12 h) instead made the
  // ascending dawn search resolve to the SAME morning — hours before the grid even
  // begins — producing an inverted [dusk, dawn] window that no evening body could
  // intersect, so every planet fell through to "—".
  const searchAnchor = new Date(grid[0].ms);
  const dusk = _searchSunAltitude(observer, -1, searchAnchor, _ALMANAC_DARK_DEG);
  const dawn = _searchSunAltitude(observer, +1, searchAnchor, _ALMANAC_DARK_DEG);
  const duskMs = dusk ? dusk.getTime() : null;
  const dawnMs = dawn ? dawn.getTime() : null;

  // Bail early if no dark sky exists today (polar summer / midnight sun).
  const hasDark = duskMs !== null || dawnMs !== null || grid.some((g) => g.sunAlt < _ALMANAC_DARK_DEG);
  if (!hasDark) {
    const everUp = alt.some((a) => a > _ALMANAC_FLOOR_DEG);
    return { window: null, peakAlt: NaN, reason: everUp ? 'no_dark' : 'below_horizon' };
  }

  // Dark interval bounds: use SearchAltitude results when available; fall back to
  // full grid extent for polar night (sun perpetually below threshold → always dark).
  const darkStartMs = duskMs !== null ? duskMs : grid[0].ms;
  const darkEndMs = dawnMs !== null ? dawnMs : grid[grid.length - 1].ms;

  // Body above-horizon intervals: detect alt sign changes in the coarse 15-min grid,
  // then 1-min sub-scan each 15-min bracket to pin the crossing to ±1 min. Only
  // the bracket cells (≤ 15 evals each, 1–2 brackets typical) are densified — not
  // the full grid — so the cost is ~96 coarse + ~30 fine evals per body.
  function findCrossing(msA, msB, rising) {
    // rising=true: return the first minute in [msA, msB] where body is above floor.
    // rising=false: return the last such minute (body sets within this bracket).
    let result = rising ? msB : msA;
    for (let ms = msA; ms <= msB; ms += 60000) {
      const a = _bodyAltAt(body, observer, Astronomy.MakeTime(new Date(ms)));
      if (rising && a > _ALMANAC_FLOOR_DEG) {
        result = ms;
        break;
      }
      if (!rising && a > _ALMANAC_FLOOR_DEG) result = ms;
    }
    return result;
  }

  const rises = [],
    sets = [];
  for (let i = 1; i < grid.length; i++) {
    const wasUp = alt[i - 1] > _ALMANAC_FLOOR_DEG;
    const isUp = alt[i] > _ALMANAC_FLOOR_DEG;
    if (!wasUp && isUp) rises.push(findCrossing(grid[i - 1].ms, grid[i].ms, true));
    if (wasUp && !isUp) sets.push(findCrossing(grid[i - 1].ms, grid[i].ms, false));
  }

  // Body already up at grid start or still up at end: add boundary anchors so
  // the first/last interval is properly paired.
  if (alt[0] > _ALMANAC_FLOOR_DEG) rises.unshift(grid[0].ms);
  if (alt[grid.length - 1] > _ALMANAC_FLOOR_DEG) sets.push(grid[grid.length - 1].ms);

  // Pair interleaved rises with sets to form above-horizon intervals.
  const intervals = [];
  for (let i = 0; i < Math.min(rises.length, sets.length); i++) {
    if (rises[i] < sets[i]) intervals.push({ rMs: rises[i], sMs: sets[i] });
  }

  // Longest intersection of each body interval with the dark window.
  let bestWindow = null,
    bestLen = 0;
  for (const iv of intervals) {
    const winStart = Math.max(iv.rMs, darkStartMs);
    const winEnd = Math.min(iv.sMs, darkEndMs);
    if (winEnd > winStart && winEnd - winStart > bestLen) {
      bestLen = winEnd - winStart;
      bestWindow = { start: new Date(winStart), end: new Date(winEnd) };
    }
  }

  if (!bestWindow) {
    const everUp = alt.some((a) => a > _ALMANAC_FLOOR_DEG);
    const reason = !everUp ? 'below_horizon' : 'daylight_only';
    return { window: null, peakAlt: NaN, reason };
  }

  // Peak altitude: 1-min scan within the observable window.
  let peakAlt = -Infinity;
  for (let ms = bestWindow.start.getTime(); ms <= bestWindow.end.getTime(); ms += 60000) {
    const a = _bodyAltAt(body, observer, Astronomy.MakeTime(new Date(ms)));
    if (a > peakAlt) peakAlt = a;
  }

  return { window: bestWindow, peakAlt, reason: null };
}

// Magnitude of this apparition's nearest greatest elongation for an inner planet
// (Mercury/Venus), in degrees. SearchMaxElongation only returns the NEXT one after
// the start time, so we also search from date−back to grab the preceding one and
// keep whichever is closer in time — that is the GE bounding the current apparition.
function _nearestMaxElong(body, date) {
  const back = body === Astronomy.Body.Mercury ? 90 : 300; // days, > inter-GE gap
  try {
    const next = Astronomy.SearchMaxElongation(body, date);
    const prev = Astronomy.SearchMaxElongation(body, new Date(date.getTime() - back * 86400000));
    const dn = Math.abs(next.time.date - date),
      dp = Math.abs(prev.time.date - date);
    return (dp <= dn ? prev : next).elongation;
  } catch (_) {
    return NaN;
  }
}

// Is the body well placed for observation right now (drives the gold row highlight)?
// Moon: always (brightest, always worth noting). Outer planets: elongation ≥ 90°
// (between the two quadratures, i.e. the half of the orbit around opposition). Inner
// planets: elongation ≥ 0.7× this apparition's greatest elongation (near GE) — a
// fraction-of-peak so it auto-scales to Mercury's varying GE (18°–28°) and Venus's.
function _wellPlaced(body, date) {
  if (body === Astronomy.Body.Moon) return true;
  const elong = Astronomy.AngleFromSun(body, date);
  if (body === Astronomy.Body.Mercury || body === Astronomy.Body.Venus) {
    const ge = _nearestMaxElong(body, date);
    return Number.isFinite(ge) && elong >= _INNER_GE_FRAC * ge;
  }
  return elong >= _OUTER_QUAD_DEG;
}

// Observe window + visual magnitude + in-window peak altitude for the Moon and
// the 7 planets. The Moon is special-cased: it is observable in daylight (a thin
// crescent is visible by day), so its window is the full above-horizon span
// [moonrise, moonset] with NO sun constraint — unlike the planets, which require
// a dark-enough sky. Bodies come from Planets.CONFIGS so the table stays in sync
// with what the map renders. Each row carries `window` (drives the time range vs
// "—"), `hasWindow`, and `highlight` (drives the gold row — set only when the body
// has a window AND is well placed; see _wellPlaced).
function getBodyAlmanac(lat, lng, date) {
  if (typeof Planets === 'undefined' || !Planets.CONFIGS) return [];
  const observer = new Astronomy.Observer(lat, lng, 0);
  const dayStart = _observerMidnight(lat, lng, date);

  // Solar-noon-anchored 15-min grid with the sun altitude precomputed once and
  // shared across all planets.
  const noonMs = dayStart.getTime() + 12 * 3600000;
  const grid = [];
  for (let i = 0; i <= 96; i++) {
    const ms = noonMs + i * 15 * 60000;
    const astroTime = Astronomy.MakeTime(new Date(ms));
    grid.push({ ms, astroTime, sunAlt: _bodyAltAt(Astronomy.Body.Sun, observer, astroTime) });
  }

  return Planets.CONFIGS.map((cfg) => {
    let mag = NaN;
    try {
      mag = Astronomy.Illumination(cfg.body, date).mag;
    } catch (_) {}

    let window = null,
      peakAlt = NaN,
      reason = null;
    if (cfg.body === Astronomy.Body.Moon) {
      // Full above-horizon span (day or night) — the moon is observable in
      // daylight (e.g. a thin crescent). Show the up-interval that contains, or
      // next follows, the current time so it stays coherent with the planets'
      // "tonight" windows rather than a stale earlier-today interval.
      //
      // Use event ordering rather than geometric centre altitude to avoid the
      // ~5 min window where the apparent limb has risen (per SearchRiseSet at
      // −0.833°) but the centre is still below zero, which would misclassify
      // the moon as "down" and display the next arc instead of the current one.
      const lastRise = _searchRiseSet(cfg.body, observer, +1, date, -1.5);
      const lastSet = _searchRiseSet(cfg.body, observer, -1, date, -1.5);
      const upNow = !!lastRise && (!lastSet || lastRise > lastSet);
      let rise, set;
      if (upNow) {
        rise = lastRise; // already found above
        set = _searchRiseSet(cfg.body, observer, -1, date, +1.5); // next set after now
      } else {
        rise = _searchRiseSet(cfg.body, observer, +1, date, +1.5); // next rise
        set = rise ? _searchRiseSet(cfg.body, observer, -1, rise, +1.5) : null;
      }
      if (rise && set) {
        window = { start: rise, end: set };
        const tr = getBodyTransit(cfg.body, lat, lng, rise); // culmination in this interval
        peakAlt = tr ? tr.alt : NaN;
      } else {
        // No rise+set pair today: the moon is either circumpolar (up all day —
        // actually fully observable) or never rises. Tell them apart by its
        // peak altitude over the day grid.
        let mx = -Infinity;
        for (const g of grid) {
          const a = _bodyAltAt(cfg.body, observer, g.astroTime);
          if (a > mx) mx = a;
        }
        reason = mx <= 0 ? 'moon_always_down' : 'moon_always_up';
      }
    } else {
      const w = _planetObserveWindow(cfg.body, observer, grid);
      window = w.window;
      peakAlt = w.peakAlt;
      reason = w.reason || null;
    }

    const diam =
      typeof Planets !== 'undefined' && Planets.bodyAngularDiamArcsec
        ? Planets.bodyAngularDiamArcsec(cfg.body, cfg.id, date)
        : NaN;

    return {
      id: cfg.id,
      name: cfg.name,
      symbol: cfg.symbol,
      window,
      peakAlt,
      mag,
      diam, // apparent angular diameter in arcseconds (Saturn = bare spheroid, not rings)
      reason, // null when a window exists; else why it is N/A (drives the '—' tooltip)
      hasWindow: !!window,
      // Gold-highlight only when the body both has an observable window AND is well
      // placed (elongation criterion). Decoupled from hasWindow so a planet can show
      // a time range yet stay un-highlighted (has a window but poor position).
      highlight: !!window && _wellPlaced(cfg.body, date),
    };
  });
}

function getSunMoonInfo(lat, lng, date) {
  const observer = new Astronomy.Observer(lat, lng, 0);
  const dayStart = _observerMidnight(lat, lng, date);

  const Sun = Astronomy.Body.Sun;
  const Moon = Astronomy.Body.Moon;

  // Illuminated fraction + SunCalc-compatible phase (0=new, .25=first quarter,
  // .5=full, .75=last quarter) from the moon's elongation angle.
  let illumFraction = NaN,
    phase01 = NaN;
  try {
    illumFraction = Astronomy.Illumination(Moon, date).phase_fraction;
  } catch (_) {}
  try {
    phase01 = Astronomy.MoonPhase(date) / 360;
  } catch (_) {}

  // Day's sun altitude extremes (upper/lower culmination) — lets the twilight
  // table classify each '—': if the sun stayed entirely above a depression it is
  // polar day / white night; entirely below, polar night.
  let sunMaxAlt = NaN,
    sunMinAlt = NaN;
  try {
    const up = Astronomy.SearchHourAngle(Sun, observer, 0, Astronomy.MakeTime(dayStart), +1);
    if (up && up.hor) sunMaxAlt = up.hor.altitude;
  } catch (_) {}
  try {
    const lo = Astronomy.SearchHourAngle(Sun, observer, 12, Astronomy.MakeTime(dayStart), +1);
    if (lo && lo.hor) sunMinAlt = lo.hor.altitude;
  } catch (_) {}

  return {
    sunMaxAlt,
    sunMinAlt,
    sunrise: _searchRiseSet(Sun, observer, +1, dayStart),
    sunset: _searchRiseSet(Sun, observer, -1, dayStart),
    civilDawn: _searchSunAltitude(observer, +1, dayStart, -6),
    civilDusk: _searchSunAltitude(observer, -1, dayStart, -6),
    nauticalDawn: _searchSunAltitude(observer, +1, dayStart, -12),
    nauticalDusk: _searchSunAltitude(observer, -1, dayStart, -12),
    astroDawn: _searchSunAltitude(observer, +1, dayStart, -18),
    astroDusk: _searchSunAltitude(observer, -1, dayStart, -18),
    // Golden/blue hour: next not-yet-ended window from the LIVE `date` (not
    // dayStart) so the card always shows the upcoming/active occurrence.
    goldenHour: _nextSolarBand(observer, date, -4, 6),
    blueHour: _nextSolarBand(observer, date, -6, -4),
    moonrise: _searchRiseSet(Moon, observer, +1, dayStart),
    moonset: _searchRiseSet(Moon, observer, -1, dayStart),
    moonTransit: getMoonTransit(lat, lng, date),
    moonPhase: phase01,
    moonIllumination: illumFraction,
    moonPhaseName: moonPhaseName(phase01),
  };
}

// Optical libration of the Moon (ecliptic lon/lat amplitudes + Earth-Moon
// distance) at the given date. Returns null if Astronomy Engine is missing.
function getMoonLibration(date) {
  if (typeof Astronomy === 'undefined' || !Astronomy.Libration) return null;
  try {
    const lib = Astronomy.Libration(date);
    return { elat: lib.elat, elon: lib.elon, distKm: lib.dist_km };
  } catch (_) {
    return null;
  }
}

function getGalacticCoreCurve(lat, lng, date) {
  // From the observer's solar noon to the next solar noon, every 15 min = 97 pts.
  // Anchoring on the OBSERVER's solar noon (longitude-based, via _observerMidnight)
  // — rather than the browser's local noon — keeps the night centred in the
  // sampling window. That is what stops the best-window endpoints from sliding to
  // the noon boundary and collapsing to "12:00–12:00" when the app/browser/observer
  // timezones disagree. It also matches the day the body almanac uses.
  const points = [];
  const observer = new Astronomy.Observer(lat, lng, 0);

  const startMs = _observerMidnight(lat, lng, date).getTime() + 12 * 3600000; // solar noon

  for (let i = 0; i <= 96; i++) {
    const t = new Date(startMs + i * 15 * 60000);

    // Galactic core altitude via Astronomy Engine
    let altitude = NaN;
    try {
      const astroTime = Astronomy.MakeTime(t);
      const hor = Astronomy.Horizon(astroTime, observer, SGR_A_RA, SGR_A_DEC, 'normal');
      altitude = hor.altitude;
    } catch (e) {
      altitude = NaN;
    }

    // Sun + Moon altitude via Astronomy Engine (single engine; refraction 'normal'
    // to match the Sgr A* curve above and the rest of the app).
    let sunAlt = NaN,
      moonAlt = NaN;
    try {
      const astroTime = Astronomy.MakeTime(t);
      const sEqu = Astronomy.Equator(Astronomy.Body.Sun, astroTime, observer, true, true);
      const mEqu = Astronomy.Equator(Astronomy.Body.Moon, astroTime, observer, true, true);
      sunAlt = Astronomy.Horizon(astroTime, observer, sEqu.ra, sEqu.dec, 'normal').altitude;
      moonAlt = Astronomy.Horizon(astroTime, observer, mEqu.ra, mEqu.dec, 'normal').altitude;
    } catch (e) {
      /* leave NaN */
    }

    points.push({ time: t, altitude, sunAlt, moonAlt });
  }

  return points;
}

// Same as getGalacticCoreCurve, but also returns transit info and best-viewing
// window (astronomical dark + Sgr A* above 10° + (moon below horizon OR illum < 0.3)).
function getGalacticCoreSummary(lat, lng, date) {
  const points = getGalacticCoreCurve(lat, lng, date);
  const moonIllum = moonIlluminationFraction(points[0] ? points[0].time : date);

  let transit = null;
  for (const p of points) {
    if (isNaN(p.altitude)) continue;
    if (!transit || p.altitude > transit.alt) transit = { time: p.time, alt: p.altitude };
  }

  let windowStart = null;
  let windowEnd = null;
  for (const p of points) {
    const goodMoon = p.moonAlt < 0 || moonIllum < 0.3;
    if (p.sunAlt < -18 && !isNaN(p.altitude) && p.altitude > 10 && goodMoon) {
      if (!windowStart) windowStart = p.time;
      windowEnd = p.time;
    }
  }

  return {
    points,
    transit,
    bestWindow: windowStart ? { start: windowStart, end: windowEnd } : null,
    moonIllum,
  };
}
