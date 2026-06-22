/**
 * map.js — builds the Leaflet base map and owns all celestial overlay layers.
 *
 * Initialises the map, its pane z-index bands, the day/twilight/moonlight
 * veils, sub-point markers, coordinate grids, and the layer-toggle controls.
 */

// ---- Light Pollution Tiles ----
// Verified light pollution tile URL (Lorenz 2024 VIIRS).
// Source: https://djlorenz.github.io/astronomy/lp/overlay/dark.html
const LORENZ_TILES = 'https://djlorenz.github.io/astronomy/image_tiles/tiles2024/tile_{z}_{x}_{y}.png';

// ---- Map Longitude Bounds ----
// Single source of truth. All layers (terminator polygons, fallback shapes,
// maxBounds) derive their longitude range from these two values so a one-line
// change propagates everywhere. The 2° buffer keeps polygon edges from being
// visible during normal panning.
const MAP_LNG_WEST = -200;
const MAP_LNG_EAST = 520;

const LNG_STEP = 2; // degrees between terminator sample points
const LNG_BUF = 2; // extra padding beyond map bounds for terminator loop

// Module-private Leaflet map ref, set by initMap. Don't read the bare `map`
// identifier — browsers expose elements with id="map" as window.map (an
// HTMLDivElement, not a Leaflet map), which would shadow our intent and
// crash visibleWrapsFromBounds. Wrap helpers below read _mapRef instead.
let _mapRef = null;

// ---- Viewport-Aware Popup Positioning ----
// Auto-flip direction: wraps Leaflet's _updatePosition so sky-star-popup popups
// flip to bottom / left / right when they would clip the viewport edge.
(function () {
  var _orig = L.Popup.prototype._updatePosition;
  var DIR_CLASSES = ['popup-dir-bottom', 'popup-dir-left', 'popup-dir-right'];
  var TIP_H = 20,
    GAP = 6,
    MARGIN = 10;

  L.Popup.prototype._updatePosition = function () {
    _orig.call(this);
    if (!this._map || !this._container) return;
    var el = this._container;
    if (!el.classList.contains('sky-star-popup')) return;

    var anchor = this._map.latLngToContainerPoint(this._latlng);
    var mapSz = this._map.getSize();
    var pH = el.offsetHeight,
      pW = el.offsetWidth;

    var spaceAbove = anchor.y;
    var spaceBelow = mapSz.y - anchor.y;
    var spaceRight = mapSz.x - anchor.x;
    var spaceLeft = anchor.x;

    var needV = pH + TIP_H + GAP + MARGIN;
    var needH = pW + TIP_H + GAP + MARGIN;

    var dir;
    if (spaceAbove >= needV) dir = 'top';
    else if (spaceBelow >= needV) dir = 'bottom';
    else if (spaceRight >= needH) dir = 'right';
    else if (spaceLeft >= needH) dir = 'left';
    else {
      var best = Math.max(spaceAbove, spaceBelow, spaceLeft, spaceRight);
      if (best === spaceAbove) dir = 'top';
      else if (best === spaceBelow) dir = 'bottom';
      else if (best === spaceRight) dir = 'right';
      else dir = 'left';
    }

    DIR_CLASSES.forEach(function (c) {
      el.classList.remove(c);
    });
    var tipCt = el.querySelector('.leaflet-popup-tip-container');

    if (dir === 'top') {
      // Leaflet default — just handle horizontal nudge
      if (tipCt) {
        tipCt.style.left = '';
        tipCt.style.top = '';
        tipCt.style.marginLeft = '';
      }
      _nudgeH(el, tipCt, anchor, mapSz, pW);
      return;
    }

    el.classList.add('popup-dir-' + dir);

    if (dir === 'bottom') {
      el.style.bottom = -(pH + GAP) + 'px';
      if (tipCt) {
        tipCt.style.left = '';
        tipCt.style.top = '';
        tipCt.style.marginLeft = '';
      }
      _nudgeH(el, tipCt, anchor, mapSz, pW);
    } else {
      // Left / right
      var halfH = Math.round(pH / 2);
      var curBottom = parseFloat(el.style.bottom) || 0;
      el.style.bottom = curBottom - halfH + GAP + 'px';
      if (dir === 'right') {
        var curLeft = parseFloat(el.style.left) || 0;
        el.style.left = curLeft + Math.round(pW / 2) + GAP + TIP_H + 'px';
      } else {
        var curLeft2 = parseFloat(el.style.left) || 0;
        el.style.left = curLeft2 - Math.round(pW / 2) - GAP - TIP_H + 'px';
      }
      if (tipCt) {
        tipCt.style.left = '';
        tipCt.style.marginLeft = '';
      }
      _nudgeV(el, tipCt, anchor, mapSz, pH);
    }
  };

  function _nudgeH(el, tipCt, anchor, mapSz, pW) {
    var rect = el.getBoundingClientRect();
    var mapRect = el.closest('.leaflet-container').getBoundingClientRect();
    var nudge = 0;
    if (rect.left < mapRect.left + MARGIN) nudge = mapRect.left + MARGIN - rect.left;
    else if (rect.right > mapRect.right - MARGIN) nudge = mapRect.right - MARGIN - rect.right;
    if (nudge !== 0) {
      var maxShift = pW / 2 - 24;
      nudge = Math.max(-maxShift, Math.min(maxShift, nudge));
      el.style.left = parseFloat(el.style.left) + nudge + 'px';
      if (tipCt) tipCt.style.marginLeft = parseFloat(tipCt.style.marginLeft || 0) - nudge + 'px';
    } else if (tipCt) {
      tipCt.style.marginLeft = '';
    }
  }

  function _nudgeV(el, tipCt, anchor, mapSz, pH) {
    var rect = el.getBoundingClientRect();
    var mapRect = el.closest('.leaflet-container').getBoundingClientRect();
    var nudge = 0;
    if (rect.top < mapRect.top + MARGIN) nudge = mapRect.top + MARGIN - rect.top;
    else if (rect.bottom > mapRect.bottom - MARGIN) nudge = mapRect.bottom - MARGIN - rect.bottom;
    if (nudge !== 0) {
      var maxShift = pH / 2 - 24;
      nudge = Math.max(-maxShift, Math.min(maxShift, nudge));
      el.style.bottom = parseFloat(el.style.bottom) - nudge + 'px';
      if (tipCt) tipCt.style.top = 'calc(50% - ' + nudge + 'px)';
    } else if (tipCt) {
      tipCt.style.top = '';
    }
  }
})();

// Filter [-720,-360,0,360,720] to the wraps whose lng range intersects the
// current viewport (mirrors SkyCanvasLayer._visibleWraps), so SVG path / marker
// counts stay viewport-bounded — at z=10 only 1 wrap is returned, not 3-5.
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

// Pre-compute loop endpoints for computeTerminator.
const T_LNG_START = MAP_LNG_WEST - LNG_BUF;
const T_LNG_END = MAP_LNG_EAST + LNG_BUF;
const T_FALLBACK = [
  [-90, MAP_LNG_WEST],
  [-90, MAP_LNG_EAST],
];

// Label every ~60° of longitude along each terminator line.
const LABEL_LNG_STEP = 60;

// Global font-size for contour / parallel labels (px).
function _labelFontSize() {
  return 13;
}

// ---- Solar-Position Helpers ----
// Used to compute twilight terminator polygons at arbitrary sun altitudes
// (0° / −6° / −12° / −18°).
function _rad(d) {
  return (d * Math.PI) / 180;
}

function _deg(r) {
  return (r * 180) / Math.PI;
}

function _julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Greenwich Mean Sidereal Time (degrees). Low-precision IAU formula.
 * Still used by the deep-sky generic vis-range path (which pairs it with
 * J2000 catalog coords). The Sun/Moon sub-point paths use `_GAST` instead —
 * they feed of-date (EQD, true-equator) RA/Dec, which must pair with the
 * APPARENT sidereal time for the hour angle to be self-consistent.
 */
function _GMST(jd) {
  const d = jd - 2451545.0;
  return 280.46061837 + 360.98564736629 * d; // degrees
}

/**
 * Greenwich Apparent Sidereal Time (degrees) from Astronomy Engine.
 * GMST + equation of the equinoxes (nutation). Pair this with of-date (EQD)
 * apparent RA/Dec so the hour angle H = GAST + lng − α is consistent.
 */
function _GAST(date) {
  return Astronomy.SiderealTime(Astronomy.MakeTime(date)) * 15; // hours → degrees
}

/**
 * Solar apparent equatorial position, of-date (true equator of date, EQD).
 * Returns { alpha (RA, radians), delta (declination, radians) }.
 *
 * NOTE: `GeoVector` returns J2000 (EQJ) coordinates. The sub-solar/terminator
 * consumers combine this RA with an of-date sidereal angle (`_GAST`), so we
 * MUST rotate the vector EQJ→EQD first — otherwise the result trails by the
 * accumulated precession (~0.27° in 2019, growing ~50″/yr), which dragged the
 * day-veil terminator ~80s ahead of the compass/sidebar sunrise.
 */
function _solarPosition(date) {
  const astroTime = Astronomy.MakeTime(date);
  let vec = Astronomy.GeoVector(Astronomy.Body.Sun, astroTime, true);
  vec = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(astroTime), vec);
  const dist = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);
  return {
    alpha: Math.atan2(vec.y, vec.x), // RA  (radians)
    delta: Math.asin(vec.z / dist), // Dec (radians)
  };
}

/**
 * Compute the "night-side" terminator polygon for a given sun altitude h (°).
 *
 * Hour angle: H = rad(GMST + lng) − α  (matches L.Terminator exactly)
 * Formula derivation:
 *   sin(h) = sin(lat)·sin(δ) + cos(lat)·cos(δ)·cos(H)
 *   → a=sin(δ), b=cos(δ)·cos(H), C=√(a²+b²), φ=atan2(b,a)
 *   → lat = asin(sin(h)/C) − φ
 *
 * Longitude range is derived from MAP_LNG_WEST / MAP_LNG_EAST (+ buffer).
 *
 * Returns [[lat, lng], …] for L.polygon; empty array if degenerate.
 */
// Small-circle contour around (centerLat, centerLng) with great-circle
// radius = 90° − altThresholdDeg. Interior of the cap = "body is above
// altThresholdDeg in an observer's sky at that ground point".
//   altThresholdDeg =  0 → 90° radius (the body's terminator)
//   altThresholdDeg = -6 → 96° radius (civil-twilight boundary)
//   …
// Returns [[lat, lng], …] for L.polygon. When the cap encloses a pole, the
// raw θ-sweep emits a ~360° lng jump at the antimeridian; we splice in
// pole-walk vertices so the polygon traces around the pole correctly.
function _computeAltitudeContourAround(centerLat, centerLng, altThresholdDeg, samples, thetas) {
  const dDeg = 90 - altThresholdDeg;
  if (dDeg < 0.001 || dDeg > 180 - 0.001) return [];

  const d = _rad(dDeg);
  const lat0 = _rad(centerLat);
  const lng0 = centerLng;
  const cosD = Math.cos(d);
  const sinD = Math.sin(d);
  const cosLat0 = Math.cos(lat0);
  const sinLat0 = Math.sin(lat0);

  // θ→[lat,lng] on the small circle. A caller-supplied `thetas` (ascending 0..2π,
  // viewport-densified by _densifyCapThetas) overrides the uniform sweep so high
  // zoom can refine only the arc crossing the viewport; the antimeridian-split /
  // pole-walk below is agnostic to spacing — it only inspects consecutive points.
  function _capPoint(theta) {
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const sinLat = sinLat0 * cosD + cosLat0 * sinD * cosT;
    const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
    const dlng = Math.atan2(sinT * sinD * cosLat0, cosD - sinLat0 * sinLat);
    return [_deg(lat), lng0 + _deg(dlng)];
  }

  const raw = [];
  if (thetas) {
    for (let i = 0; i < thetas.length; i++) raw.push(_capPoint(thetas[i]));
  } else {
    const N = samples || 720;
    for (let i = 0; i <= N; i++) raw.push(_capPoint((i / N) * 2 * Math.PI));
  }

  const enclosesPole = dDeg > 90 - Math.abs(centerLat);
  if (!enclosesPole) return raw;

  const poleLat = centerLat >= 0 ? 90 : -90;
  // Snap pole-walk endpoints to exactly centerLng ± 180 (raw samples land ~5°
  // short → wedge gap that breaks wrap-copy tiling at the pole), then bridge up
  // to the next sample's latitude so the cap spans a full 360° at the pole.
  const eastEdge = centerLng + 180;
  const westEdge = centerLng - 180;
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    out.push(raw[i]);
    if (i + 1 < raw.length) {
      const a = raw[i][1],
        b = raw[i + 1][1];
      if (Math.abs(b - a) > 180) {
        // Determine which side each sample is on. a near eastEdge → pole walk
        // goes east→west; a near westEdge → pole walk goes west→east.
        const aIsEast = Math.abs(a - eastEdge) < Math.abs(a - westEdge);
        const aEdge = aIsEast ? eastEdge : westEdge;
        const bEdge = aIsEast ? westEdge : eastEdge;
        out.push([poleLat, aEdge]);
        out.push([poleLat, bEdge]);
        // Bridge: rise from (poleLat, bEdge) to (raw[i+1].lat, bEdge), so the
        // polyline reaches raw[i+1].lat at the exact antimeridian before
        // continuing to raw[i+1] (which sits ~5° inside bEdge).
        out.push([raw[i + 1][0], bEdge]);
      }
    }
  }
  // Defensive end-check: if the antimeridian wrap falls on the closing edge
  // raw[N]→raw[0] (centerLat>0 float ε) rather than mid-sweep, the pole walk is
  // never inserted and auto-close leaves the polar cap exposed — insert it here.
  // (Polygon-fill only; the arcs variant below must NOT split the closing edge.)
  if (out.length >= 2) {
    const lastLng = out[out.length - 1][1];
    const firstLng = out[0][1];
    if (Math.abs(lastLng - firstLng) > 180) {
      const lastIsEast = Math.abs(lastLng - eastEdge) < Math.abs(lastLng - westEdge);
      const lastEdge = lastIsEast ? eastEdge : westEdge;
      const firstEdge = lastIsEast ? westEdge : eastEdge;
      out.push([poleLat, lastEdge]);
      out.push([poleLat, firstEdge]);
    }
  }
  return out;
}

/**
 * Raw small-circle arc(s) for boundary-line rendering — NO pole-walk
 * bridging.  Same θ-sweep as `_computeAltitudeContourAround` but instead of
 * splicing in bridge vertices at antimeridian crossings (which become
 * spurious vertical strokes when rendered as a polyline), we SPLIT the
 * sweep at those crossings and return each continuous arc piece separately.
 *
 * Returns Array<Array<[lat, lng]>>:
 *   Case A (cap doesn't enclose pole): 1 entry — a closed loop.
 *   Case B (cap encloses one pole):    2 entries — two open arcs on either
 *                                      side of the antimeridian.
 *
 * Use this for `L.polyline` boundaries.  Use `_computeAltitudeContourAround`
 * for `L.polygon` fills (which need bridge segments to close the ring around
 * the enclosed pole).
 */
function _computeAltitudeContourArcs(centerLat, centerLng, altThresholdDeg, samples, thetas) {
  const dDeg = 90 - altThresholdDeg;
  if (dDeg < 0.001 || dDeg > 180 - 0.001) return [];

  const d = _rad(dDeg);
  const lat0 = _rad(centerLat);
  const lng0 = centerLng;
  const cosD = Math.cos(d);
  const sinD = Math.sin(d);
  const cosLat0 = Math.cos(lat0);
  const sinLat0 = Math.sin(lat0);

  // θ→[lat,lng] on the small circle. A caller-supplied `thetas` (ascending 0..2π,
  // viewport-densified) overrides the uniform sweep so high zoom can refine only
  // the arc crossing the viewport; the antimeridian split below is agnostic to
  // spacing — it only inspects consecutive points.
  function _capPoint(theta) {
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const sinLat = sinLat0 * cosD + cosLat0 * sinD * cosT;
    const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
    const dlng = Math.atan2(sinT * sinD * cosLat0, cosD - sinLat0 * sinLat);
    return [_deg(lat), lng0 + _deg(dlng)];
  }

  const raw = [];
  if (thetas) {
    for (let i = 0; i < thetas.length; i++) raw.push(_capPoint(thetas[i]));
  } else {
    const N = samples || 720;
    for (let i = 0; i <= N; i++) raw.push(_capPoint((i / N) * 2 * Math.PI));
  }

  // Split at each antimeridian crossing (|Δlng| > 180°), interpolating the
  // crossing latitude so each arc ends exactly on centerLng ± 180 — stopping at
  // the last raw sample (≈ ±179°) would leave a visible gap, and the exact ±180
  // endpoints make adjacent wrap copies join into one seamless stroke.
  const eastEdge = centerLng + 180;
  const westEdge = centerLng - 180;

  function _splitAtAnti(prev, next) {
    // Returns { latCross, prevEdge, nextEdge }.  prev/next are [lat, lng];
    // |Δlng| > 180 guaranteed by caller.
    const prevIsEast = prev[1] > centerLng;
    const prevEdge = prevIsEast ? eastEdge : westEdge;
    const nextEdge = prevIsEast ? westEdge : eastEdge;
    // Unwrap next.lng onto prev's number line so linear interp is defined.
    const nextLngUnwrap = next[1] + (prevIsEast ? 360 : -360);
    const denom = nextLngUnwrap - prev[1];
    // Guard 0/0: if both samples happen to land exactly on the antimeridian
    // (denom→0), the geometric crossing IS one of those samples; use prev's
    // lat directly to avoid NaN propagating into L.polyline.
    const t = Math.abs(denom) < 1e-9 ? 0 : (prevEdge - prev[1]) / denom;
    const latCross = prev[0] + (next[0] - prev[0]) * t;
    return { latCross, prevEdge, nextEdge };
  }

  const arcs = [];
  let current = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1];
    const next = raw[i];
    if (Math.abs(next[1] - prev[1]) > 180) {
      const { latCross, prevEdge, nextEdge } = _splitAtAnti(prev, next);
      current.push([latCross, prevEdge]);
      if (current.length >= 2) arcs.push(current);
      current = [[latCross, nextEdge]];
    }
    current.push(next);
  }

  // When NO in-loop antimeridian crossing happens (anti-body in the
  // OPPOSITE hemisphere from where the sweep's atan2 branch cut lands), the
  // full sweep returns as a SINGLE continuous polyline whose lng spans the
  // entire [centerLng - 180, centerLng + 180] range monotonically.  In
  // Mercator this draws one continuous great-circle curve across the wrap
  // copy, and adjacent copies meet automatically at lng = centerLng ± 180
  // (copy w's endpoint at L-180 coincides with copy w-1's at L-180+360-360
  // = L-180, etc.).  No defensive split needed — and trying to split here
  // by interpolating raw[N]→raw[0] would degenerate to 0/0 because both
  // samples sit AT the antimeridian (±tiny floating-point offsets).
  if (current.length >= 2) arcs.push(current);
  return arcs;
}

// ---- Viewport-Local Cap Densification ----
// At high zoom one VEIL_CAP_SAMPLES step of the ~90° night-cap circle spans
// ~111 km, so its straight screen chord bows hundreds of px off the true curve
// where it crosses the viewport — the day/night terminator visibly misses a
// compass centered on the sub-point at the rise/set instant. Refine ONLY the
// θ-range whose chord intersects the padded viewport, down to a few screen px
// (the rest of the ring stays coarse), so the rendered edge tracks the small
// circle to sub-px without inflating the global vertex count. The metric is
// Mercator screen px, not ground km — the map is Web Mercator, so the screen
// chord is what bows visibly.
const VEIL_DENSIFY_ZOOM = 13;
const VEIL_DENSIFY_MAX_CHORD_PX = 96;
const VEIL_DENSIFY_MAX_DEPTH = 24;

// Liang–Barsky segment∩AABB test — true when any part of a→b lies inside r.
function _segIntersectsRect(ax, ay, bx, by, r) {
  let t0 = 0,
    t1 = 1;
  const dx = bx - ax,
    dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - r.minX, r.maxX - ax, ay - r.minY, r.maxY - ay];
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) {
      if (q[k] < 0) return false;
    } else {
      const t = q[k] / p[k];
      if (p[k] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

function _greatCircleDeg(lat1, lng1, lat2, lng2) {
  const a = _rad(lat1),
    b = _rad(lat2);
  const cosC = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(_rad(lng1 - lng2));
  return _deg(Math.acos(Math.max(-1, Math.min(1, cosC))));
}

// Ascending θ∈[0,2π] for a cap that is dense only where it crosses the padded
// viewport; null when densification is not warranted (low zoom, time playback,
// or the ring nowhere near the viewport), so callers fall back to the uniform
// sweep. Pairs with _computeAltitudeContourAround/Arcs via their `thetas` arg.
function _densifyCapThetas(centerLat, centerLng, altThresholdDeg) {
  const map = window.appMap || window.__map;
  if (!map || map.getZoom() < VEIL_DENSIFY_ZOOM) return null;
  // Playback rebuilds the veil every frame; skip the per-point reprojection then
  // (a sweeping terminator hides the coarse chord anyway) and let the next static
  // refresh re-densify.
  if (typeof TimeState !== 'undefined' && TimeState.isPlaying && TimeState.isPlaying()) return null;
  const dDeg = 90 - altThresholdDeg;
  if (dDeg < 0.001 || dDeg > 180 - 0.001) return null;

  // O(1) reject: skip bands whose ring (great-circle radius dDeg from the
  // sub-point) cannot reach the viewport. Wrap copies share the sphere point so
  // this gates per band; off-screen wrap copies are pruned by the segment∩rect
  // test below. center↔corner is the viewport's angular radius.
  const ctr = map.getCenter();
  const bnd = map.getBounds();
  const vpRadiusDeg = _greatCircleDeg(ctr.lat, ctr.lng, bnd.getNorth(), bnd.getEast()) + 0.1;
  if (Math.abs(_greatCircleDeg(ctr.lat, ctr.lng, centerLat, centerLng) - dDeg) > vpRadiusDeg) return null;

  const d = _rad(dDeg),
    lat0 = _rad(centerLat);
  const cosD = Math.cos(d),
    sinD = Math.sin(d),
    cosLat0 = Math.cos(lat0),
    sinLat0 = Math.sin(lat0);
  function project(theta) {
    const cosT = Math.cos(theta),
      sinT = Math.sin(theta);
    const sinLat = sinLat0 * cosD + cosLat0 * sinD * cosT;
    const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
    const dlng = Math.atan2(sinT * sinD * cosLat0, cosD - sinLat0 * sinLat);
    return map.latLngToContainerPoint([_deg(lat), centerLng + _deg(dlng)]);
  }

  // Pad the viewport by one full screen each side so a coarse pan bucket (the
  // refreshTimeMasks rebuild granularity) never outruns the densified band.
  const size = map.getSize();
  const rect = { minX: -size.x, minY: -size.y, maxX: 2 * size.x, maxY: 2 * size.y };
  const out = [0];
  function refine(ta, pa, tb, pb, depth) {
    if (
      depth < VEIL_DENSIFY_MAX_DEPTH &&
      Math.hypot(pa.x - pb.x, pa.y - pb.y) > VEIL_DENSIFY_MAX_CHORD_PX &&
      _segIntersectsRect(pa.x, pa.y, pb.x, pb.y, rect)
    ) {
      const tm = (ta + tb) / 2,
        pm = project(tm);
      refine(ta, pa, tm, pm, depth + 1);
      refine(tm, pm, tb, pb, depth + 1);
    } else {
      out.push(tb);
    }
  }

  let prevT = 0,
    prevP = project(0);
  for (let i = 1; i <= VEIL_CAP_SAMPLES; i++) {
    const tb = (i / VEIL_CAP_SAMPLES) * 2 * Math.PI,
      pb = project(tb);
    refine(prevT, prevP, tb, pb, 0);
    prevT = tb;
    prevP = pb;
  }
  return out;
}

function computeTerminator(date, altDeg) {
  const gst = _GAST(date); // apparent ST (pairs with EQD α below)
  const { alpha, delta } = _solarPosition(date); // both radians, of-date (EQD)
  const sinH = Math.sin(_rad(altDeg));
  const latLngs = [];

  for (let lng = T_LNG_START; lng <= T_LNG_END; lng += LNG_STEP) {
    const H = _rad(gst + lng) - alpha; // hour angle (radians)
    const a = Math.sin(delta);
    const b = Math.cos(delta) * Math.cos(H);
    const C = Math.sqrt(a * a + b * b);

    const sinLat = C > 1e-10 ? sinH / C : sinH >= 0 ? 1 : -1;

    if (sinLat > 1) continue; // perpetual light at this longitude

    let latDeg;
    if (sinLat < -1) {
      latDeg = delta > 0 ? -90 : 90;
    } else {
      const phi = Math.atan2(b, a);
      const asinVal = Math.asin(sinLat);
      let lat1 = _deg(asinVal - phi); // Branch 1
      if (lat1 >= -90 && lat1 <= 90) {
        latDeg = lat1;
      } else {
        let lat2 = _deg(Math.PI - asinVal - phi); // Branch 2
        if (lat2 > 90) lat2 -= 360;
        if (lat2 < -90) lat2 += 360;
        latDeg = Math.max(-90, Math.min(90, lat2));
      }
    }
    latLngs.push([latDeg, lng]);
  }

  if (latLngs.length < 2) return [];

  // Close polygon at the dark pole across the full computed longitude span.
  if (delta > 0) {
    latLngs.push([-90, T_LNG_END]);
    latLngs.push([-90, T_LNG_START]);
  } else {
    latLngs.push([90, T_LNG_END]);
    latLngs.push([90, T_LNG_START]);
  }
  return latLngs;
}

// ---- Terminator Line Labels ----
// Contour-style labels placed along a terminator line.
// linePts = polygon points without the two pole-closure entries.
// Returns an array of L.marker (added to the given layerGroup).
function placeLabels(linePts, text, labelGroup) {
  if (linePts.length < 2) return;

  for (let lng = MAP_LNG_WEST + LABEL_LNG_STEP; lng < MAP_LNG_EAST; lng += LABEL_LNG_STEP) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < linePts.length; i++) {
      const d = Math.abs(linePts[i][1] - lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestDist > LNG_STEP * 2) continue;

    // Tangent direction from neighbours (skip 2 points each side for smoothness).
    const prev = linePts[Math.max(0, bestIdx - 2)];
    const next = linePts[Math.min(linePts.length - 1, bestIdx + 2)];
    const dx = next[1] - prev[1];
    const dy = next[0] - prev[0];
    let perpDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    // Keep text upright (readable, not upside-down).
    if (perpDeg > 90) perpDeg -= 180;
    if (perpDeg < -90) perpDeg += 180;

    L.marker(linePts[bestIdx], {
      icon: L.divIcon({
        className: 'terminator-label',
        html: `<span style="transform:rotate(${perpDeg.toFixed(1)}deg);font-size:${_labelFontSize()}px">${text}</span>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(labelGroup);
  }
}

// ---- Subsolar / Antisolar Points and Parallels ----

function fmtLat(deg) {
  const abs = Math.abs(deg).toFixed(2);
  return deg >= 0 ? abs + '°N' : abs + '°S';
}

/** Subsolar point (sun at zenith).  Returns { lat, lng } with lng in [0, 360). */
function computeSubsolarPoint(date) {
  const gst = _GAST(date); // apparent ST (pairs with EQD α below)
  const { alpha, delta } = _solarPosition(date); // of-date (EQD)
  const raw = _deg(alpha) - gst;
  return {
    lat: _deg(delta),
    lng: ((raw % 360) + 360) % 360, // [0, 360)
  };
}

/** Antisolar point (opposite the sun). */
function computeAntisolarPoint(date) {
  const ss = computeSubsolarPoint(date);
  return { lat: -ss.lat, lng: ss.lng + 180 };
}

/**
 * Anti-sub-point for an arbitrary celestial body given its equatorial
 * coordinates and GMST (all degrees).  The sub-point (geographic position
 * where the body is at zenith) has lat = dec, lng = ra − GMST; the anti-
 * point is the antipode of that: lat = −dec, lng = sub.lng + 180.
 *
 * Used by activateCelestialVis (stars, DSOs, comets, meteor radiants) to
 * build the generic visibility-range overlay without a full ephemeris call.
 */
function antiCelestialPoint(ra, dec, gmst) {
  // ra, dec, gmst all in degrees
  let subLng = ra - gmst;
  subLng = GeoUtils.normLng(subLng);
  let antiLng = subLng + 180;
  antiLng = GeoUtils.normLng(antiLng);
  return { lat: -dec, lng: antiLng };
}

/** Subsolar parallel — fixed-latitude line spanning the full map longitude range. */
function computeSubsolarParallel(centerDate) {
  const ss = computeSubsolarPoint(centerDate);
  return [
    [ss.lat, MAP_LNG_WEST],
    [ss.lat, MAP_LNG_EAST],
  ];
}

/** Antisolar parallel — fixed-latitude line spanning the full map longitude range. */
function computeAntisolarParallel(centerDate) {
  const anti = computeAntisolarPoint(centerDate);
  return [
    [anti.lat, MAP_LNG_WEST],
    [anti.lat, MAP_LNG_EAST],
  ];
}

/**
 * Place copies of a circleMarker at every wrapped longitude that falls inside
 * the map bounds, so the user always sees it regardless of pan position.
 */
function placeWrappedCircles(lat, lng, optsCore, optsGlow, group, tooltipText, onClick) {
  group.clearLayers();
  const wraps = visibleWrapsFromBounds(_mapRef);
  for (const off of wraps) {
    const wLng = lng + off;
    if (wLng >= MAP_LNG_WEST && wLng <= MAP_LNG_EAST) {
      if (optsGlow) {
        const glowOpts = Object.assign({}, optsGlow, { interactive: false });
        L.circleMarker([lat, wLng], glowOpts).addTo(group);
      }
      const coreOpts = Object.assign({ bubblingMouseEvents: false }, optsCore);
      const core = L.circleMarker([lat, wLng], coreOpts).addTo(group);
      if (tooltipText) {
        core.bindTooltip(tooltipText, {
          direction: 'top',
          offset: [0, -8],
          opacity: 0.92,
          className: 'celestial-tooltip',
        });
      }
      if (onClick) {
        core.on('click', function (ev) {
          L.DomEvent.stopPropagation(ev);
          onClick();
        });
      }
    }
  }
}

/**
 * Place wrapped copies of a phase-planet divIcon marker (L.marker + inline SVG).
 * Same wrapping logic as placeWrappedCircles but for custom HTML icons.
 */
function placeWrappedPhaseIcons(lat, lng, iconHtml, group, tooltipText, onClick, iconSize, onContextMenu) {
  group.clearLayers();
  const sz = iconSize || [28, 28];
  // v3.2: normalize sub-point lng to [-180, 180]; see placeWrappedLumBody.
  lng = GeoUtils.normLng(lng);
  const wraps = visibleWrapsFromBounds(_mapRef);
  for (const off of wraps) {
    const wLng = lng + off;
    if (wLng >= MAP_LNG_WEST && wLng <= MAP_LNG_EAST) {
      const interactive = !!tooltipText || !!onClick || !!onContextMenu;
      const marker = L.marker([lat, wLng], {
        icon: L.divIcon({
          className: 'phase-planet-icon',
          html: iconHtml,
          iconSize: sz,
          iconAnchor: [sz[0] / 2, sz[1] / 2],
        }),
        interactive: interactive,
        keyboard: false,
        bubblingMouseEvents: false,
      }).addTo(group);
      if (tooltipText) {
        marker.bindTooltip(tooltipText, {
          direction: 'top',
          offset: [0, -(sz[1] / 2 + 4)],
          opacity: 0.92,
          className: 'celestial-tooltip',
        });
      }
      if (onClick) {
        marker.on('click', function (ev) {
          L.DomEvent.stopPropagation(ev);
          onClick(ev);
        });
      }
      if (onContextMenu) {
        marker.on('contextmenu', function (ev) {
          L.DomEvent.stopPropagation(ev);
          if (ev.originalEvent) ev.originalEvent.preventDefault();
          onContextMenu(ev);
        });
      }
    }
  }
}

/**
 * Place a luminosity-model body: core CircleMarker + radial-gradient glow/glare
 * divIcons + optional high-zoom footprint disk.  Wrapped across the date line.
 *
 * glowSpec: { coreR, glowR, glareR, coreCol, tint, alpha } or null
 * diskHtml: null, or { html, size|width+height }
 */
const BODY_RENDERERS = {};

function placeWrappedLumBody(
  lat,
  lng,
  coreOpts,
  glowSpec,
  diskHtml,
  group,
  tooltipText,
  onClick,
  onContextMenu,
  labelSymbol
) {
  group.clearLayers();
  // Glow sits one band below its core pane (glow = core − 1). The
  // legacy 'sky-glow' fallback pane was removed; if a caller omits coreOpts.pane
  // the core itself falls back to the default overlay pane, so the glow uses
  // undefined here to land in the same default neighborhood rather than pointing
  // at a non-existent pane.
  const glowPane = coreOpts.pane ? coreOpts.pane + '-glow' : undefined;
  // v3.2: callers (Planets.bodySubPoint / computeSubsolarPoint) return lng in
  // [0, 360); normalize to [-180, 180] so the wrap set from
  // visibleWrapsFromBounds (which uses the [off-180, off+180] convention,
  // mirroring SkyCanvasLayer) lines up. Without this, narrow viewports in
  // the western hemisphere lose the body because the off=-360 wrap that
  // would have mapped lng=200 down to wLng=-160 is excluded.
  lng = GeoUtils.normLng(lng);
  const wraps = visibleWrapsFromBounds(_mapRef);
  for (const off of wraps) {
    const wLng = lng + off;
    if (wLng < MAP_LNG_WEST || wLng > MAP_LNG_EAST) continue;

    // Glare sprite (bottom layer — very wide, very faint)
    if (glowSpec && glowSpec.glareR > 0) {
      const css = Lum.glareGradientCSS(glowSpec.tint, glowSpec.glareR);
      if (css) {
        const sz = Math.ceil(glowSpec.glareR * 2);
        L.marker([lat, wLng], {
          icon: L.divIcon({
            className: 'star-glare',
            html:
              '<div style="width:' +
              sz +
              'px;height:' +
              sz +
              'px;border-radius:50%;opacity:' +
              glowSpec.alpha.toFixed(3) +
              ';background:' +
              css +
              '"></div>',
            iconSize: [sz, sz],
            iconAnchor: [sz / 2, sz / 2],
          }),
          pane: glowPane,
          interactive: false,
          keyboard: false,
          bubblingMouseEvents: false,
        }).addTo(group);
      }
    }

    // Glow sprite (smooth radial gradient)
    if (glowSpec && glowSpec.glowR > glowSpec.coreR) {
      const css = Lum.glowGradientCSS(glowSpec.coreCol, glowSpec.tint, glowSpec.coreR, glowSpec.glowR);
      const sz = Math.ceil(glowSpec.glowR * 2);
      L.marker([lat, wLng], {
        icon: L.divIcon({
          className: 'star-glow',
          html:
            '<div style="width:' +
            sz +
            'px;height:' +
            sz +
            'px;border-radius:50%;opacity:' +
            glowSpec.alpha.toFixed(3) +
            ';background:' +
            css +
            '"></div>',
          iconSize: [sz, sz],
          iconAnchor: [sz / 2, sz / 2],
        }),
        pane: glowPane,
        interactive: false,
        keyboard: false,
        bubblingMouseEvents: false,
      }).addTo(group);
    }

    // Core dot (pane from coreOpts.pane, or default overlayPane)
    const mergedOpts = Object.assign({ bubblingMouseEvents: false }, coreOpts);
    if (mergedOpts.pane && BODY_RENDERERS[mergedOpts.pane]) {
      mergedOpts.renderer = BODY_RENDERERS[mergedOpts.pane];
    }
    const coreM = L.circleMarker([lat, wLng], mergedOpts).addTo(group);
    // Disk inherits the same pane as core
    const _bodyPane = coreOpts.pane || undefined;

    // Footprint disk / engraving icon (high zoom).
    // Placed BEFORE the hitter so the hitter layer sits on top in z-order
    // and can reliably intercept pointer events.
    let _diskR = 0;
    if (diskHtml) {
      const dw = diskHtml.width || diskHtml.size;
      const dh = diskHtml.height || diskHtml.size;
      _diskR = Math.max(dw || 0, dh || 0) / 2;
      const diskOpts = {
        icon: L.divIcon({
          className: 'lum-disk-icon',
          html: diskHtml.html,
          iconSize: [dw, dh],
          iconAnchor: [dw / 2, dh / 2],
        }),
        interactive: false,
        keyboard: false,
        bubblingMouseEvents: false,
      };
      if (_bodyPane) diskOpts.pane = _bodyPane;
      L.marker([lat, wLng], diskOpts).addTo(group);
    }

    // When a visible disk is present, add a transparent interactive
    // circleMarker sized to the full disk area as the click target ("hitter").
    // This makes the entire visible disc respond to clicks, not just the tiny
    // core dot.  Without a disk the core marker remains the click target.
    const _hitter = diskHtml
      ? L.circleMarker([lat, wLng], {
          pane: _bodyPane,
          radius: Math.max(coreOpts.radius || 4, _diskR),
          stroke: false,
          fill: true,
          fillOpacity: 0,
          interactive: true,
          bubblingMouseEvents: false,
        }).addTo(group)
      : null;
    const _clickTarget = _hitter || coreM;

    if (tooltipText) {
      _clickTarget.bindTooltip(tooltipText, {
        direction: 'top',
        offset: [0, -8],
        opacity: 0.92,
        className: 'celestial-tooltip',
      });
    }
    if (onClick) {
      _clickTarget.on('click', function (ev) {
        L.DomEvent.stopPropagation(ev);
        onClick(ev);
      });
    }
    if (onContextMenu) {
      _clickTarget.on('contextmenu', function (ev) {
        L.DomEvent.stopPropagation(ev);
        if (ev.originalEvent) ev.originalEvent.preventDefault();
        onContextMenu(ev);
      });
    }

    // Body name label (sits below glow in label pane)
    if (labelSymbol && _bodyPane) {
      let labelR = coreOpts.radius || 4;
      if (glowSpec) labelR = Math.max(labelR, glowSpec.glowR || 0);
      if (_diskR) labelR = Math.max(labelR, _diskR);
      const gap = 4;
      L.marker([lat, wLng], {
        icon: L.divIcon({
          className: 'body-symbol-label',
          html: labelSymbol,
          // iconSize:null lets wrapper auto-size to text content so the
          // label-collider can measure its real bounding box (iconSize:[0,0]
          // would force the wrapper to 0×0 and the collider would skip it).
          iconSize: null,
          iconAnchor: [-(labelR + gap), 7],
        }),
        pane: _bodyPane + '-label',
        interactive: false,
        keyboard: false,
        bubblingMouseEvents: false,
      }).addTo(group);
    }
  }
}

// Legacy `computeAltitudeContour` was removed; all callers use
// `_computeAltitudeContourAround` (polygon) / `_computeAltitudeContourArcs`
// (polyline).

// ---- Labelled Contour Line ----
// Draw a labelled contour line with the line breaking around each label.
// Gaps are measured in longitude degrees (not point count) so they stay
// visually consistent across latitudes under the Mercator projection.
// Labels are rotated to sit perpendicular to the contour.
//   base       = array of [lat, lng] points (closed loop, 361 points)
//   altDeg     = altitude value (used for label text & colour)
//   lineGroup  = L.layerGroup to which gapped polylines are added
//   labelGroup = L.layerGroup to which label markers are added
function drawLabeledContour(
  base,
  altDeg,
  lineGroup,
  labelGroup,
  lineColorOverride,
  labelColorOverride,
  weightOverride
) {
  if (base.length < 10) return;

  var isDay = altDeg > 0;
  var gapLngDeg = 0; // set >0 to re-enable line breaking around labels
  var fontSize = _labelFontSize();

  // Day side: dark slate.  Night side: warm violet that harmonises with
  // the cool-blue twilight gradient (analogous on the colour wheel) while
  // creating a complementary temperature contrast against the day side.
  var lineColor = lineColorOverride || (isDay ? '#334155' : '#7c3aed');
  var labelColor = labelColorOverride || (isDay ? '#1e293b' : '#c4b5fd');
  var lineOpacity = isDay ? 0.35 : 0.4;

  var style = {
    weight: weightOverride || 1,
    color: lineColor,
    opacity: lineOpacity,
    smoothFactor: 1,
    interactive: false,
  };

  for (var w = -1; w <= 1; w++) {
    var off = w * 360;
    var pts = base.map(function (p) {
      return [p[0], p[1] + off];
    });

    // Quick rejection — nothing in map bounds.
    var visible = false;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i][1] >= MAP_LNG_WEST && pts[i][1] <= MAP_LNG_EAST) {
        visible = true;
        break;
      }
    }
    if (!visible) continue;

    var N = pts.length;

    // ---- Find Label Positions at Regular Longitude Intervals ----
    var labelData = []; // { idx, pt }
    for (var lng = MAP_LNG_WEST + 60; lng < MAP_LNG_EAST; lng += 60) {
      var bestIdx = 0,
        bestDist = Infinity;
      for (var i = 0; i < N; i++) {
        var d = Math.abs(pts[i][1] - lng);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestDist > 30) continue;

      // Reject if too close to an already-accepted label.
      var tooClose = false;
      for (var k = 0; k < labelData.length; k++) {
        var diff = Math.abs(pts[bestIdx][1] - labelData[k].pt[1]);
        if (diff > 180) diff = 360 - diff;
        if (diff < gapLngDeg * 3) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) labelData.push({ idx: bestIdx, pt: pts[bestIdx] });
    }

    if (labelData.length === 0) {
      L.polyline(pts, style).addTo(lineGroup);
      continue;
    }

    // ---- Longitude-Based Gap Masking (Mercator-Consistent) ----
    var remove = new Array(N);
    for (var i = 0; i < N; i++) remove[i] = false;
    for (var k = 0; k < labelData.length; k++) {
      var labelLng = labelData[k].pt[1];
      for (var i = 0; i < N; i++) {
        var diff = Math.abs(pts[i][1] - labelLng);
        if (diff > 180) diff = 360 - diff;
        if (diff < gapLngDeg) remove[i] = true;
      }
    }

    // ---- Collect Uninterrupted Segments ----
    var segments = [];
    var cur = [];
    for (var i = 0; i < N; i++) {
      if (!remove[i]) {
        cur.push(pts[i]);
      } else {
        if (cur.length >= 2) segments.push(cur);
        cur = [];
      }
    }
    if (cur.length >= 2) segments.push(cur);

    // Merge first & last segments when the contour wraps around uncut.
    if (segments.length > 1 && !remove[0] && !remove[N - 1]) {
      segments[0] = segments[segments.length - 1].concat(segments[0]);
      segments.pop();
    }

    // ---- Draw Gapped Polylines ----
    for (var s = 0; s < segments.length; s++) {
      L.polyline(segments[s], style).addTo(lineGroup);
    }

    // ---- Place Labels Perpendicular to the Contour ----
    for (var k = 0; k < labelData.length; k++) {
      var idx = labelData[k].idx;
      var pt = labelData[k].pt;

      // Tangent direction from neighbours (±2 points for smoothness).
      var prev = pts[(idx - 2 + N) % N];
      var next = pts[(idx + 2) % N];
      var dx = next[1] - prev[1];
      var dy = next[0] - prev[0];
      var angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;

      L.marker(pt, {
        icon: L.divIcon({
          className: 'contour-label',
          html:
            '<span style="color:' +
            labelColor +
            ';font-size:' +
            fontSize +
            'px;font-weight:500;display:inline-block;transform:rotate(' +
            angle.toFixed(1) +
            'deg)">' +
            altDeg +
            '°</span>',
          iconSize: [40, 18],
          iconAnchor: [20, 9],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(labelGroup);
    }
  }
}

// ---- Visibility-Range Fill Alpha ----
// Maps apparent magnitude to a low-α fill opacity for the "where the body is
// above the horizon" mask. Bright bodies (Sun/Moon/Venus) get a deeper colour
// wash; dim ones (Uranus/Neptune) get the floor so they don't disappear
// entirely. Tuned to stay well below the twilight day-mask in saturation so
// layers compose cleanly.
function visFillAlpha(mag) {
  const FLOOR = 0.06;
  const CEIL = 0.2;
  if (!Number.isFinite(mag)) return FLOOR;
  // mag −27 → 1.0 (Sun core), +5 → 0.0 (dim outer planet)
  const t = Math.max(0, Math.min(1, (5 - mag) / 32));
  return FLOOR + (CEIL - FLOOR) * t;
}

// Module-level constants for the antisolar/anti-body night-cap-as-hole render.
// Reused by initMap()'s rebuildVeilGroup AND drawVisibilityRange below. Outer
// ring is large enough (lat ±90.5, lng −1080..+1440) that hole wrap-copies
// never spill past it, and pole-walk segments at lat=±90 stay strictly
// interior — see the long comment in initMap() near VEIL_OUTER_RING for the
// full rationale. VEIL_WRAP_RANGE=3 means w∈{−3..+3} = 7 copies, enough to
// tile the outer ring for any anti-body lng.
const VEIL_OUTER_RING = [
  [-90.5, -1080],
  [-90.5, 1440],
  [90.5, 1440],
  [90.5, -1080],
];
const VEIL_WRAP_RANGE = 3;
// Night-cap circle resolution for the veil polygons (twilight / day-brighten /
// moonlight). Each veil level draws one cap per wrap copy (7×) and Leaflet
// reprojects EVERY vertex on every viewreset — at 720 the two day-side veils
// alone carry ~40k vertices and dominate the high-zoom zoom/pan cost (~110 ms of
// reprojection per viewreset). 360 (1° spacing) keeps the terminator visually
// smooth at world zoom — it is still 2× the night-clip's proven 180 (map.js
// rebuildNightClipPaths) — while halving that reprojection. The cap geometry is
// zoom-independent (rebuilt only on time change via _lastMaskKey), so a single
// fixed count must satisfy the most-curve-visible case (low zoom); 360 does.
const VEIL_CAP_SAMPLES = 360;

// Distance-aware geocentric center-altitude threshold for "apparent upper limb
// touches the horizon", matching Astronomy.SearchRiseSet (used by the compass +
// sidebar rise/set) so veil/visibility boundaries sweep a point at the labelled
// rise/set instant. The +horizontal-parallax term reconciles our geocentric
// contour with topocentric SearchRiseSet; for the Moon it can push the threshold
// positive (cap radius >90° → needs the moonHorizonDeg pole guard).
const _EARTH_R_KM = 6378.137,
  _SUN_R_KM = 695700,
  _MOON_R_KM = 1737.4;
const _REFRACTION_DEG = 34 / 60;

// Geocentric center-altitude threshold (deg) for a body at geocentric distance
// distKm with physical radius radiusKm. See block comment above for derivation.
function _horizonDeg(distKm, radiusKm) {
  const SD = (Math.asin(radiusKm / distKm) * 180) / Math.PI; // angular semidiameter
  const HP = (Math.asin(_EARTH_R_KM / distKm) * 180) / Math.PI; // horizontal parallax
  return -_REFRACTION_DEG - SD + HP;
}

function _bodyDistKm(body, date) {
  const v = Astronomy.GeoVector(body, Astronomy.MakeTime(date), true);
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 149597870.7; // AU → km
}

// Sun threshold: ≈ −0.826°…−0.835° over the year, always negative → anti-sun
// night-cap radius 90+T ≤ 89.17° ≤ 90° → always Case-A/B safe, no guard needed.
function sunHorizonDeg(date) {
  return _horizonDeg(_bodyDistKm(Astronomy.Body.Sun, date), _SUN_R_KM);
}

// Moon threshold: ≈ +0.10° (parallax-dominated). POLE GUARD: clamp T ≤ |dec|−0.05
// so the anti-moon night-cap (radius 90+T) encloses at most ONE pole (Case B),
// never both (Case C). Bites only when |moon dec| < ~0.1° (a few ten-minute
// windows per month at the moon's equator crossings), where it degrades to ~30s
// — imperceptible on the faint milky veil. dec is taken of-date (EQD) to match
// antiMoonPoint's sub-point.
function moonHorizonDeg(date) {
  const t = Astronomy.MakeTime(date);
  let v = Astronomy.GeoVector(Astronomy.Body.Moon, t, true);
  v = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(t), v);
  const r = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const decDeg = (Math.asin(v.z / r) * 180) / Math.PI;
  const T = _horizonDeg(r * 149597870.7, _MOON_R_KM);
  return Math.min(T, Math.abs(decDeg) - 0.05);
}

// Mean-value placeholders ONLY — the first band of the static day/moon style
// arrays uses these so the literals have a sane fallback, but the actual edge is
// the distance-aware sunHorizonDeg(date)/moonHorizonDeg(date), injected per-frame
// in rebuildDayMask (_withHorizon) and _moonlightStylesFor.
const SUN_HORIZON_DEG = -0.833;
const MOON_HORIZON_DEG = -0.825;

// ---- Body Visible-From-Earth Region ----
// Draw a body's "visible-from-Earth" region (alt > 0). Two layers:
//   (1) bold 0°-altitude boundary polyline in cfg.color (lineGroup)
//   (2) translucent fill in body-vis pane covering everywhere the body IS
//       above the horizon (fillGroup)
//
// Same antisolar/anti-body night-cap-as-hole topology as the day/moon
// veils — the body's invisible-region cap is a small circle of radius 90°
// around the anti-body sub-point, so the visible region is "world rect
// minus that cap", rendered as a Leaflet polygon-with-holes (evenodd).
// Boundary line uses the SAME hole polylines (one polyline per wrap copy).
//
// antiPoint = { lat, lng } of the anti-body sub-point (antipode of the
// body's geocentric sub-point — antisolar for the Sun, anti-moon, anti-
// planet).  Caller is responsible for computing it once per frame.
function drawVisibilityRange(antiPoint, cfg, mag, lineGroup, fillGroup, opts) {
  if (!antiPoint || !Number.isFinite(antiPoint.lat) || !Number.isFinite(antiPoint.lng)) return;
  const color = cfg.color || '#cbd5e1';
  // opts.fillOpacity overrides the mag-derived alpha (used by planets to lock
  // 0.04, by the generic celestial vis range to use a fixed white wash).
  const fillOpacity = opts && opts.fillOpacity != null ? opts.fillOpacity : visFillAlpha(mag);
  const lineStyle = {
    weight: 3,
    color: color,
    opacity: 0.85,
    smoothFactor: 0,
    noClip: true,
    interactive: false,
  };
  const fillStyle = {
    pane: 'body-vis',
    stroke: false,
    fillColor: color,
    fillOpacity: fillOpacity,
    fillRule: 'evenodd',
    smoothFactor: 0,
    noClip: true, // outer ring + holes span lng −1080..+1440; clipping would chop polar extremes
    interactive: false,
  };
  // Compute night-cap geometry at each wrap copy.  Boundary altitude defaults to
  // geometric 0° (generic bodies), but the Sun passes opts.altThreshold =
  // sunHorizonDeg(date) (distance-aware ≈ −0.826°) so its visible-range edge
  // coincides with almanac sunrise (and the day-veil terminator + compass sun glyph).
  //
  // We compute TWO variants per wrap copy:
  //   - hole  (pole-walked closed ring)  — for the polygon fill, needs bridge
  //                                        vertices to close around the pole
  //   - arcs  (raw small-circle arcs)    — for the boundary polyline; NO bridge
  //                                        segments, so the antimeridian
  //                                        pole-walk doesn't render as a
  //                                        spurious vertical stroke
  const alt = opts && opts.altThreshold != null ? opts.altThreshold : 0;
  const holes = [];
  const arcs = [];
  for (let w = -VEIL_WRAP_RANGE; w <= VEIL_WRAP_RANGE; w++) {
    const cLng = antiPoint.lng + w * 360;
    const thetas = _densifyCapThetas(antiPoint.lat, cLng, alt);
    const hole = _computeAltitudeContourAround(antiPoint.lat, cLng, alt, undefined, thetas);
    if (hole.length >= 3) holes.push(hole);
    const arcSet = _computeAltitudeContourArcs(antiPoint.lat, cLng, alt, undefined, thetas);
    for (const a of arcSet) if (a.length >= 2) arcs.push(a);
  }
  if (!holes.length) return;
  // Fill: outer rect minus all hole copies = visible region (alt > 0).
  L.polygon([VEIL_OUTER_RING].concat(holes), fillStyle).addTo(fillGroup);
  // Boundary: each arc is a continuous slice of the 0°-altitude great circle
  // for one wrap copy.  Rendered as separate polylines so the pole-walk
  // bridge vertices in `holes` don't bleed into the stroke.
  for (const arc of arcs) {
    L.polyline(arc, lineStyle).addTo(lineGroup);
  }
}

// ---- Map Initialisation ----
function initMap() {
  const _t =
    typeof I18n !== 'undefined'
      ? I18n.t.bind(I18n)
      : function (k) {
          return k;
        };

  // Day-mode flag — toggled when the white-veil dayMaskGroup is on the map.
  // Read by buildSunOpts and propagated to Planets via setDayMode so all
  // body glows desaturate together; also gates the CSS screen-blend rule
  // via the body.day-mask-active class.
  let _dayModeActive = false;

  const map = L.map('map', {
    zoomControl: false,
    doubleClickZoom: false,
    maxBounds: [
      [-90, MAP_LNG_WEST],
      [90, MAP_LNG_EAST],
    ],
    maxBoundsViscosity: 1.0,
    minZoom: 3,
  }).setView([35, 105], 4);
  _mapRef = map; // v3 perf: expose for visibleWrapsFromBounds() at module scope.

  L.control.zoom({ position: 'topright' }).addTo(map);

  if (typeof Places !== 'undefined' && Places.mountSearchBox) {
    Places.mountSearchBox(map);
  }

  // Multiply overlay — suppresses baked-in basemap labels (bright pixels)
  // without darkening the already-dark landmass.
  // Placed INSIDE shadowPane (where label tiles live) with isolation so the
  // blend only affects labels, never data layers.
  const mulEl = document.createElement('div');
  mulEl.className = 'map-multiply';

  const mulTileEl = document.createElement('div');
  mulTileEl.className = 'map-multiply-tile';

  // Cold overlay mask (§2: lightened for figure-ground, polished sheen)
  const maskEl = document.createElement('div');
  maskEl.className = 'map-mask';
  map.getContainer().appendChild(maskEl);

  const sheenEl = document.createElement('div');
  sheenEl.className = 'map-sheen';
  map.getContainer().appendChild(sheenEl);

  let _lpLayerActive = false;
  function updateMaskOpacity() {
    if (_lpLayerActive) {
      maskEl.style.display = 'none';
      return;
    }
    maskEl.style.display = '';
    const z = map.getZoom();
    // z≤3 → 0.22, z≥8 → 0.06, linear ramp — much lighter than before
    const a = Math.max(0.06, Math.min(0.22, 0.22 - ((z - 3) * (0.22 - 0.06)) / 5));
    maskEl.style.backgroundColor = `rgba(6,9,18,${a.toFixed(3)})`;
  }
  updateMaskOpacity();
  map.on('zoomend', updateMaskOpacity);

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║               PANE Z-INDEX BAND ALLOCATION                    ║
  // ╠════════╦═══════════════════════════════════════════════════════╣
  // ║  Band  ║  Panes                                              ║
  // ╠════════╬═══════════════════════════════════════════════════════╣
  // ║  50    ║  tilePane (base map tiles)                           ║
  // ║  80    ║  day-brighten (soft-light blend on day-side basemap) ║
  // ║100–199 ║  overlayPane(101) shadowPane(102) lp(150)            ║
  // ║        ║  body-vis(180) celestial-body visible-range fills   ║
  // ║200–299 ║  aurora(200)                                        ║
  // ║300–399 ║  clouds(300)                                        ║
  // ║500–599 ║  Deep-sky icon/frame layer (all BELOW twilight mask) ║
  // ║        ║    milkyway(500)                                     ║
  // ║        ║    sky-bounds(505) sky-lines(505) asterism(508)      ║
  // ║        ║    sky-stars(520)                                    ║
  // ║        ║    [525–599 reserved for future comet icons]         ║
  // ║600–699 ║  Label / reference layer (split by veil trio)        ║
  // ║        ║  ── below veil (covered in daylight) ──             ║
  // ║        ║    sky-labels(600)  asterism-top(602)                ║
  // ║        ║  ── veil pair ──                                      ║
  // ║        ║    moonlight-mask(611)  twilight-mask(612)           ║
  // ║        ║  ── above veil (visible in daylight) ──             ║
  // ║        ║    equator(615) galactic-equator(616)                ║
  // ║        ║    lunar-path(617) ecliptic(618)                     ║
  // ║        ║    equator-lbl(620) galactic-lbl(621)                ║
  // ║        ║    lunar-path-lbl(622) ecliptic-lbl(623)             ║
  // ║        ║    meteor-labels(626)                                ║
  // ║        ║    observer-greatcircle(627) locked body GC lines    ║
  // ║        ║    eclipse-curves(629)                               ║
  // ║        ║    eclipse-curves-points(630)  greatest-eclipse ✶   ║
  // ║        ║    [631–699 reserved for eclipse text labels,        ║
  // ║        ║             future comet labels]                     ║
  // ║720–734 ║  outer planets + Mars, label/glow/core triples       ║
  // ║        ║    (far→near, 3 z per body)                         ║
  // ║740–748 ║  Sun/Mercury/Venus dynamic zone: sorted by          ║
  // ║        ║    geocentric distance each tick (3 z per body)      ║
  // ║760–762 ║  body-moon label/glow/core (always closest)         ║
  // ║800–899 ║  sat(800) satellites                                 ║
  // ║900–999 ║  (reserved)                                         ║
  // ║        ║  observer compass stack (bottom→top):               ║
  // ║        ║    observer-pin(943) center pin marker               ║
  // ║        ║    observer-compass(944) ring + envelope             ║
  // ║        ║    …-lines(945) traces + dir/hover rays              ║
  // ║        ║    …-cardinals(946) N/E/S/W                          ║
  // ║        ║    …-planet(947) …-moon(948) …-sun(949) glyph+rim    ║
  // ║        ║    …-fx(950) hover name + hit-targets                ║
  // ║1000    ║  markerPane (other Leaflet markers)                  ║
  // ║2000+   ║  tooltipPane(2000) popupPane(2010)                   ║
  // ╚════════╩═══════════════════════════════════════════════════════╝
  //
  // Rules:
  //   - Each body's glow pane sits exactly 1 below its core pane.
  //   - Deep-sky labels (stars, asterisms) live in 600–604 sub-band
  //     and ARE covered by the twilight day mask at 612.
  //   - day-brighten (z=80) uses mix-blend-mode: soft-light (CSS). Tied to
  //     twilightGroup (Sun layer on/off). Geometry uses antisolar holes;
  //     night/moon/sky panes unaffected.
  //   - Coordinate-grid lines + their labels sit at 615–623, ABOVE
  //     the twilight mask, so they stay readable in daylight.
  //   - Eclipse event curves (629) + visibility heatmap (628) sit
  //     above the twilight mask so solar-eclipse paths are visible.
  //   - Body name labels (body-X-label) sit alongside their bodies
  //     in 720+; clip-path on those panes hides them in daytime.
  //   - Sun/Mercury/Venus z-indices are reassigned by
  //     updateInnerBodyZOrder() every tick based on distance.

  // ---- Override Leaflet Default Pane Z-Indices ----
  // Keep tiles at the very bottom; push tooltip/popup above all custom layers.
  map.getPane('tilePane').style.zIndex = '50';
  map.getPane('overlayPane').style.zIndex = '101';
  map.getPane('shadowPane').style.zIndex = '102';
  map.getPane('markerPane').style.zIndex = '1000';
  map.getPane('tooltipPane').style.zIndex = '2000';
  map.getPane('popupPane').style.zIndex = '2010';

  // ---- Per-Body Panes with Dedicated SVG Renderers and Glow Panes ----
  // Band 700+: solar-system bodies.
  // Outer planets + Mars (720–729): static order, far → near.
  // Sun / Mercury / Venus (740–745): dynamic zone, re-sorted by distance
  //   each tick so transits / superior conjunctions layer correctly.
  // Moon (760–761): always closest, always on top.
  const BODY_PANES = [
    ['body-neptune-label', 720],
    ['body-neptune-glow', 721],
    ['body-neptune', 722],
    ['body-uranus-label', 723],
    ['body-uranus-glow', 724],
    ['body-uranus', 725],
    ['body-saturn-label', 726],
    ['body-saturn-glow', 727],
    ['body-saturn', 728],
    ['body-jupiter-label', 729],
    ['body-jupiter-glow', 730],
    ['body-jupiter', 731],
    ['body-mars-label', 732],
    ['body-mars-glow', 733],
    ['body-mars', 734],
    ['body-sun-label', 740],
    ['body-sun-glow', 741],
    ['body-sun', 742],
    ['body-mercury-label', 743],
    ['body-mercury-glow', 744],
    ['body-mercury', 745],
    ['body-venus-label', 746],
    ['body-venus-glow', 747],
    ['body-venus', 748],
    ['body-moon-label', 760],
    ['body-moon-glow', 761],
    ['body-moon', 762],
  ];
  for (const [name, z] of BODY_PANES) {
    if (!map.getPane(name)) {
      map.createPane(name);
      map.getPane(name).style.zIndex = String(z);
      if (name.endsWith('-glow') || name.endsWith('-label')) {
        map.getPane(name).style.pointerEvents = 'none';
      } else {
        BODY_RENDERERS[name] = L.svg({ pane: name }).addTo(map);
      }
    }
  }

  // ---- Custom Pane for LP Tiles (Band 100–199: Map Fundamentals) ----
  map.createPane('lp');
  map.getPane('lp').style.zIndex = '150';
  map.getPane('lp').style.pointerEvents = 'none';

  // Celestial-body visible-range coloured fills sit below everything
  // interactive so they don't intercept clicks or muddy data layers.
  map.createPane('body-vis');
  map.getPane('body-vis').style.zIndex = '180';
  map.getPane('body-vis').style.pointerEvents = 'none';

  // Day-brighten(80): warm-cream polygons (same antisolar/holed-veil geometry
  //   as twilight-mask) rendered with mix-blend-mode: soft-light via CSS, so
  //   they lift the Carto Dark Matter basemap (land + ocean) toward sunlit
  //   warmth WITHIN the daylight veil's coverage only. Pane sits between
  //   tilePane (50) and overlayPane (101): blend backdrop is restricted to
  //   base tiles, so stars/grids/moon/compass/aurora/clouds/LP are guaranteed
  //   untouched. Night region has zero fill (holes), blend is a no-op there.
  //   Tied to twilightGroup (Sun layer). Follows the Sun button with no separate checkbox.
  map.createPane('day-brighten');
  map.getPane('day-brighten').style.zIndex = '80';
  map.getPane('day-brighten').style.pointerEvents = 'none';

  // Zoom-animation gate for the soft-light brighten pane. soft-light is a
  // backdrop-reading blend that re-rasterizes the lit region every animated-zoom
  // frame; at low zoom only part of the screen is day-side so it's cheap, but at
  // high zoom the whole viewport is daylight and the per-frame re-raster makes
  // zooming janky. The pane stays visible at rest (all zoom levels); it is hidden
  // only for the duration of the animated zoom when z >= the threshold, then
  // restored on zoomend (no permanent display change).
  const DAY_BRIGHTEN_ANIM_ZOOM = 12; // hide during zoom animation at z >= this
  map.on('zoomanim', function (e) {
    const p = map.getPane('day-brighten');
    if (!p) return;
    if (e.zoom >= DAY_BRIGHTEN_ANIM_ZOOM || map.getZoom() >= DAY_BRIGHTEN_ANIM_ZOOM) {
      p.style.visibility = 'hidden';
    }
  });
  map.on('zoomend', function () {
    const p = map.getPane('day-brighten');
    if (p) p.style.visibility = '';
  });

  // ── Veil pair (600–699 band, below-veil sub-zone) ──────────────────
  // moonlight-mask(611): frosted-glass milky veil on moon-up hemisphere.
  //   Sits below twilight-mask so daylight wins in daytime regions.
  //   Pane carries backdrop-filter blur via CSS; clip-path keeps blur
  //   confined to the moon-up polygon. See .leaflet-moonlight-mask-pane.
  // twilight-mask(612): white day-side veil covering deep-sky elements
  //   (stars, asterisms, milkyway, DSO/comet labels). Coordinate grids +
  //   eclipse-event layers sit ABOVE this pane and remain visible in daylight.
  //   Geometry: outer ring = giant lat/lng rect, holes = night-cap small
  //   circles around antisolar (radius 90+T° ≤ 90° → no Case C).
  map.createPane('moonlight-mask');
  map.getPane('moonlight-mask').style.zIndex = '611';
  map.getPane('moonlight-mask').style.pointerEvents = 'none';

  map.createPane('twilight-mask');
  map.getPane('twilight-mask').style.zIndex = '612';
  map.getPane('twilight-mask').style.pointerEvents = 'none';

  // ---- Coordinate-Grid Line Panes (615–618, Above Twilight Mask) ----
  map.createPane('equator');
  map.getPane('equator').style.zIndex = '615';
  map.getPane('equator').style.pointerEvents = 'none';
  map.createPane('ecliptic');
  map.getPane('ecliptic').style.zIndex = '618';
  map.getPane('ecliptic').style.pointerEvents = 'none';

  // ---- Coordinate-Grid Label Panes (620–623, Above Twilight Mask) ----
  map.createPane('equator-labels');
  map.getPane('equator-labels').style.zIndex = '620';
  map.getPane('equator-labels').style.pointerEvents = 'none';
  map.createPane('ecliptic-labels');
  map.getPane('ecliptic-labels').style.zIndex = '623';
  map.getPane('ecliptic-labels').style.pointerEvents = 'none';

  // ---- Meteor Shower Pane (626, Above Coord Grids) ----
  map.createPane('meteor-labels');
  map.getPane('meteor-labels').style.zIndex = '626';
  map.getPane('meteor-labels').style.pointerEvents = 'none';

  // Observer-compass pane is created by Observer.init() in observer.js.

  // ---- Eclipse Event Pane (629, Above Meteor, Visible in Daylight) ----
  // eclipse-curves(629) is created lazily in eclipse.js. It sits above the
  // twilight mask so solar-eclipse paths are readable over the day-side veil.
  // (Actual createPane calls are in eclipse.js initEclipseLayer.)

  // ---- SVG Clip-Paths for Night-Side Clipping ----
  // Three clipPaths share the same geometry (current 0° altitude contour +
  // ±360° wraps) but live under different IDs so consumers can opt-in:
  //   #lp-night-clip       → light-pollution tile pane (LP only on night)
  //   #twilight-night-clip → body-X-label panes + dim planet core panes,
  //                          so they only render in the night region.
  const lpClipSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  lpClipSvg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
  const lpClipDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const lpClipPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
  lpClipPathEl.id = 'lp-night-clip';
  lpClipPathEl.setAttribute('clipPathUnits', 'userSpaceOnUse');
  lpClipDefs.appendChild(lpClipPathEl);
  const twiClipPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
  twiClipPathEl.id = 'twilight-night-clip';
  twiClipPathEl.setAttribute('clipPathUnits', 'userSpaceOnUse');
  lpClipDefs.appendChild(twiClipPathEl);
  // Pre-allocate a fixed <polygon> per wrap copy in each clipPath, so per-frame
  // pan/zoom only rewrites their `points` attribute — no SVG node create/destroy.
  // Night-cap ring latlng depends only on the antisolar point (time), so
  // `_nightRingCache` memoizes it; frames just reproject + rewrite.
  const _NIGHT_WRAPS = 2 * VEIL_WRAP_RANGE + 1;
  const _lpClipPolys = [];
  const _twiClipPolys = [];
  for (let i = 0; i < _NIGHT_WRAPS; i++) {
    const a = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    a.setAttribute('fill-rule', 'evenodd');
    lpClipPathEl.appendChild(a);
    _lpClipPolys.push(a);
    const b = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    b.setAttribute('fill-rule', 'evenodd');
    twiClipPathEl.appendChild(b);
    _twiClipPolys.push(b);
  }
  const _nightRingCache = { key: '', rings: [] };
  // Moonlight soft-edge filter — Gaussian blur on each moonlight polygon's
  // edges so the milky veil fades smoothly into the surrounding night side.
  const moonFilterEl = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  moonFilterEl.id = 'moonlight-soften';
  moonFilterEl.setAttribute('x', '-10%');
  moonFilterEl.setAttribute('y', '-10%');
  moonFilterEl.setAttribute('width', '120%');
  moonFilterEl.setAttribute('height', '120%');
  const moonBlurEl = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
  moonBlurEl.setAttribute('stdDeviation', '3');
  moonFilterEl.appendChild(moonBlurEl);
  lpClipDefs.appendChild(moonFilterEl);
  lpClipSvg.appendChild(lpClipDefs);
  map.getContainer().appendChild(lpClipSvg);
  map.getPane('lp').style.clipPath = 'url(#lp-night-clip)';

  /**
   * Return the current CSS translate offset of mapPane (px).
   * During a drag Leaflet sets transform on mapPane; the lp pane
   * inherits it, so clip-path coordinates — which are in container
   * space from latLngToContainerPoint — must be shifted back into
   * the lp pane's local coordinate system.
   */
  function _getMapPaneOffset() {
    const t = map.getPane('mapPane').style.transform;
    if (!t || t === 'none') return { x: 0, y: 0 };
    const m = t.match(/translate3d\(([^,]+),\s*([^,)]+)/);
    if (!m) return { x: 0, y: 0 };
    return { x: parseFloat(m[1]) || 0, y: parseFloat(m[2]) || 0 };
  }

  /**
   * Rebuild both night-side SVG clip polygons (LP + twilight) from the
   * current 0° altitude contour. Same geometry → fed to both clipPaths so
   * we only project / serialise once per frame.
   */
  function rebuildNightClipPaths() {
    const anti = computeAntisolarPoint(TimeState.current);
    const off = _getMapPaneOffset();

    // Antisolar/holed-veil pattern: the night cap IS the clip region — a
    // clipPath REVEALS what's inside its <polygon> children, and "night region
    // = inside night cap". One <polygon> per wrap copy (VEIL_WRAP_RANGE=3 → 7);
    // their interiors union into the visible night region. fill-rule="evenodd"
    // (set once at allocation) keeps the pole-walk bridge vertices from
    // `_computeAltitudeContourAround` from tripping the nonzero winding rule.
    //
    // Geometry (the latlng ring) depends only on the antisolar point, so it is
    // memoized by time; pan/zoom only reproject the cached rings into container
    // space and rewrite the pre-allocated polygons' `points` (no node churn).
    const key = anti.lat.toFixed(4) + ',' + anti.lng.toFixed(4);
    if (key !== _nightRingCache.key) {
      const rings = [];
      for (let w = -VEIL_WRAP_RANGE; w <= VEIL_WRAP_RANGE; w++) {
        // N=180: clip is a pixel-level mask, so 2° arc resolution is sub-pixel.
        rings.push(_computeAltitudeContourAround(anti.lat, anti.lng + w * 360, 0, 180));
      }
      _nightRingCache.key = key;
      _nightRingCache.rings = rings;
    }

    const rings = _nightRingCache.rings;
    for (let w = 0; w < rings.length; w++) {
      const ring = rings[w];
      let s = '';
      if (ring.length >= 3) {
        for (let i = 0; i < ring.length; i++) {
          const pt = map.latLngToContainerPoint([ring[i][0], ring[i][1]]);
          s += `${pt.x - off.x},${pt.y - off.y} `;
        }
      }
      _lpClipPolys[w].setAttribute('points', s);
      _twiClipPolys[w].setAttribute('points', s);
    }
  }

  // Panes whose visibility should be confined to the night region whenever
  // the twilight mask is active. Beyond the per-body name labels we also
  // clip sky-labels (star + DSO + meteor + comet labels — they all live
  // in this pane), so labels are truly hidden under the day veil rather
  // than only washed out by it. asterism-top (star-group labels) is intentionally
  // excluded — asterism lines are not clipped, so their labels stay visible.
  // sky-lines / sky-bounds are clipped (not faded) so the daylight area is
  // completely line-free, matching the labels' hard-cutoff treatment.
  const _twilightClippedLabelPanes = [
    'sky-lines',
    'sky-bounds',
    'sky-labels',
    'meteor-labels',
    'body-neptune-label',
    'body-uranus-label',
    'body-saturn-label',
    'body-jupiter-label',
    'body-mars-label',
    'body-sun-label',
    'body-mercury-label',
    'body-venus-label',
    'body-moon-label',
  ];
  // Planets whose body marker should be clipped to night when their current
  // apparent magnitude is too faint to be visible against a daylit sky.
  // (Sun/Moon/Venus are never clipped — they're naked-eye in daytime.)
  const TWILIGHT_DIM_MAG = 0.5;
  const _twilightDimCandidateCores = [
    'body-mercury',
    'body-mars',
    'body-jupiter',
    'body-saturn',
    'body-uranus',
    'body-neptune',
  ];
  let _twilightActive = false;
  // Glow checkbox state — single control for both day-mask (when Sun is on)
  // and moon-mask (when Sun is off but Moon is on). Mutually exclusive: Sun
  // takes priority. Resets to ON whenever Sun or Moon transitions OFF→ON.
  let _glowExplicitlyOn = true;

  function _setPaneClip(paneName, on) {
    const p = map.getPane(paneName);
    if (!p) return;
    p.style.clipPath = on ? 'url(#twilight-night-clip)' : 'none';
  }

  /**
   * Re-evaluate which body core panes should be night-clipped based on
   * current apparent magnitude. Called whenever the mask state or time
   * changes (delegated to syncTwilightClips below).
   */
  function _refreshDimPlanetClips() {
    const on = _twilightActive;
    const date = typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date();
    for (const paneName of _twilightDimCandidateCores) {
      const id = paneName.replace(/^body-/, '');
      let dim = false;
      if (on && typeof Planets !== 'undefined' && Astronomy && Astronomy.Body) {
        const body = Astronomy.Body[id.charAt(0).toUpperCase() + id.slice(1)];
        if (body) {
          try {
            const ill = Astronomy.Illumination(body, date);
            if (ill && Number.isFinite(ill.mag) && ill.mag > TWILIGHT_DIM_MAG) dim = true;
          } catch (_) {}
        }
      }
      _setPaneClip(paneName, dim);
    }
  }

  /** Apply / clear twilight clip on label + dim-planet panes. */
  function syncTwilightClips() {
    const on = _twilightActive;
    for (const name of _twilightClippedLabelPanes) _setPaneClip(name, on);
    _refreshDimPlanetClips();
  }

  /**
   * Enable or disable LP + body-label night-clips based on whether the daylight
   * veil is actually rendered — NOT merely whether the Sun layer is on. The clip
   * exists to confine deep-sky lines/labels/LP to the night side because the day
   * veil washes them out; if the user unchecks the Daylight/Moonlight glow
   * (dayMaskGroup absent) nothing is washing them out, so they must stay whole.
   * Keying off twilightGroup (Sun on/off) instead truncates constellation lines
   * at the day terminator even with no veil drawn. dayMaskGroup._map is the same
   * rendered-state truth used for window._dayMaskVisible below.
   */
  function syncLpClip() {
    _twilightActive = !!dayMaskGroup._map;
    window._twilightActive = _twilightActive;
    if (_twilightActive) {
      rebuildNightClipPaths();
      map.getPane('lp').style.clipPath = 'url(#lp-night-clip)';
    } else {
      map.getPane('lp').style.clipPath = 'none';
    }
    syncTwilightClips();
  }

  // rAF throttle — rebuild at most once per frame during continuous move/zoom.
  let lpClipRaf = 0;
  function scheduleNightClipUpdate() {
    if (!lpClipRaf) {
      lpClipRaf = requestAnimationFrame(() => {
        lpClipRaf = 0;
        rebuildNightClipPaths();
      });
    }
  }

  // Initial state (twilightGroup hasn't been created yet — clip is deferred).
  // After twilightGroup exists, the overlayadd handler will arm the clip.
  map.getPane('lp').style.clipPath = 'none';

  map.on('move', scheduleNightClipUpdate);
  map.on('zoom', scheduleNightClipUpdate);

  // ---- Basemaps ----
  // Default: CartoDB Dark Matter (split into nolabels base + only_labels overlay).
  // Splitting lets future "no-label screenshot" mode toggle labels independently.
  const cartoAttribution =
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>' +
    ' | Stars: <a href="https://www.astronexus.com/hyg">HYG v4</a> (CC BY-SA)' +
    ' | Constellations: <a href="https://github.com/ofrohn/d3-celestial">d3-celestial</a> (BSD)' +
    ' | Chinese asterisms: <a href="https://github.com/Stellarium/stellarium-skycultures">Stellarium</a> (GPL)';

  const baseDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: cartoAttribution,
    subdomains: 'abcd',
    maxZoom: 20,
  });

  const baseDarkLabels = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 20,
    pane: 'shadowPane',
    opacity: 0.4,
  });

  // Group the two dark layers so the layer-control treats them as one option.
  // Adding the group (not individual layers) ensures both come/go together
  // when the user switches basemaps.
  const baseDarkGroup = L.layerGroup([baseDark, baseDarkLabels]).addTo(map);

  // Inject multiply overlay into shadowPane (CartoDB labels, isolated)
  const shadowPane = map.getPane('shadowPane');
  shadowPane.style.isolation = 'isolate';
  shadowPane.appendChild(mulEl);

  // tilePane multiply — injected after Stadia .addTo(map) below
  const tilePane = map.getPane('tilePane');
  tilePane.style.isolation = 'isolate';

  // Zoom-adaptive label opacity (CartoDB only)
  function updateLabelOpacity() {
    const z = map.getZoom();
    const op = Math.max(0.15, Math.min(0.55, 0.15 + ((z - 3) * (0.55 - 0.15)) / 4));
    baseDarkLabels.setOpacity(op);
  }
  updateLabelOpacity();
  map.on('zoomend', updateLabelOpacity);

  const stadiaAttribution =
    '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  const baseStadiaSmoothDark = L.tileLayer(
    'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
    {
      attribution: stadiaAttribution,
      maxZoom: 20,
    }
  );

  // Inject multiply overlay AFTER Stadia tiles so it sits above them in DOM
  tilePane.appendChild(mulTileEl);

  // Keep the overlay anchored to the viewport regardless of map pan position.
  // tilePane lives inside _mapPane which translates with every pan, so static
  // vw-unit offsets drift off-screen when the user pans far right/left.
  function reanchorMulTile() {
    const pos = L.DomUtil.getPosition(map._mapPane);
    mulTileEl.style.left = -pos.x - window.innerWidth + 'px';
    mulTileEl.style.top = -pos.y - window.innerHeight + 'px';
    mulTileEl.style.width = 3 * window.innerWidth + 'px';
    mulTileEl.style.height = 3 * window.innerHeight + 'px';
  }
  map.on('move', reanchorMulTile);
  map.on('resize', reanchorMulTile);
  reanchorMulTile();

  const baseStadiaTonerLite = L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}{r}.png', {
    attribution: stadiaAttribution,
    maxZoom: 20,
  });

  // Legacy options re-added per request: keep the dark default but offer the
  // previously-shipped light/standard layers under their canonical names.
  const cartoPositron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: cartoAttribution,
    subdomains: 'abcd',
    maxZoom: 20,
  });

  const osmStandard = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  });

  // ---- Twilight Day-Side White Mask ----
  //
  // Four white polygons, each centred on the subsolar point, layered so that
  // overlapping fills compound into a smooth gradient from bright day to
  // true night. Stacking alpha (1 − Π(1−αᵢ)):
  //   day (alt > 0)      ≈ 0.52   — clearly readable veil
  //   civil  (-6→0)      ≈ 0.31
  //   nautical (-12→-6)  ≈ 0.17
  //   astronomical (-18→-12) ≈ 0.08
  //   true night         = 0      — no mask
  //
  // The mask sits in the `twilight-mask` pane (z=685) so it covers stars,
  // asterisms, deep-sky labels, and Milky Way, while coordinate grids
  // (686–693) and body markers (720+) remain visible above it.
  //
  // ── PRESERVED FOR LATER ──────────────────────────────────────────────────
  // Old blue night-side polygons (0°/-6°/-12°/-18° terminators) and their
  // contour labels are kept commented below — they may be useful for an
  // alternate "night atlas" view, but the current visual spec is the white
  // day mask above.
  //
  //   const style0  = { weight: 2, color: '#6677cc', opacity: 0.5, ... fillOpacity: 0 };
  //   const style6  = { weight: 0, ..., fillColor: '#5a6bc8', fillOpacity: 0.18 };
  //   const style12 = { weight: 0, ..., fillColor: '#3a4a8c', fillOpacity: 0.22 };
  //   const style18 = { weight: 0, ..., fillColor: '#1a2952', fillOpacity: 0.35 };
  //   const pts0  = computeAltitudeContour(now,   0);
  //   const pts6  = computeAltitudeContour(now,  -6);
  //   const pts12 = computeAltitudeContour(now, -12);
  //   const pts18 = computeAltitudeContour(now, -18);
  //   const terminator0/6/12/18 = L.polygon(...)
  //   placeLabels(pts0.slice(0,-2),  '0°',   labels0); ... etc.
  // NOTE: `computeAltitudeContour` was removed; to revive, use
  // `_computeAltitudeContourAround(antiSun.lat, antiSun.lng + w*360, altDeg)`
  // for w∈{-3..+3} per the antisolar/holed-veil pattern.

  const now = TimeState.current;
  const ss = computeSubsolarPoint(now);
  const anti = computeAntisolarPoint(now);

  // Shift for second subsolar copy visible within map bounds.
  let twilightShift = 0;
  if (ss.lng + 360 <= MAP_LNG_EAST) twilightShift = 360;
  else if (ss.lng - 360 >= MAP_LNG_WEST) twilightShift = -360;

  // Day-mask polygon styles — white veil that grows opaque toward the
  // subsolar point. Each fills its own concentric small circle; the alpha
  // values stack to produce the gradient shown above.
  // fillRule: 'evenodd' is critical — these polygons carry a rectangle outer
  // ring + multiple inner-ring holes. Default 'nonzero' would require outer
  // and holes to be wound opposite ways; 'evenodd' is winding-agnostic and
  // robust to whatever orientation _computeAltitudeContourAround produces.
  const dayMaskStyles = [
    // First band edge OVERRIDDEN per-frame by sunHorizonDeg(date) in
    // rebuildDayMask (distance-aware ≈ −0.826°, almanac sunrise), so the
    // terminator sweeps a point at the same instant SearchRiseSet's rise/set
    // fires (~0s). The placeholder below is the mean value; night-cap radius
    // 90 + (−0.83) ≈ 89.17° ≤ 90° → Case A/B, never Case C. Twilight bands geometric.
    {
      altThreshold: SUN_HORIZON_DEG,
      fillColor: '#f5f2ee',
      fillOpacity: 0.04,
      fillRule: 'evenodd',
      weight: 0,
      smoothFactor: 0,
      noClip: true,
      pane: 'twilight-mask',
      interactive: false,
    },
    {
      altThreshold: -6,
      fillColor: '#f5f2ee',
      fillOpacity: 0.02,
      fillRule: 'evenodd',
      weight: 0,
      smoothFactor: 0,
      noClip: true,
      pane: 'twilight-mask',
      interactive: false,
    },
    {
      altThreshold: -12,
      fillColor: '#f5f2ee',
      fillOpacity: 0.02,
      fillRule: 'evenodd',
      weight: 0,
      smoothFactor: 0,
      noClip: true,
      pane: 'twilight-mask',
      interactive: false,
    },
    {
      altThreshold: -18,
      fillColor: '#f5f2ee',
      fillOpacity: 0.01,
      fillRule: 'evenodd',
      weight: 0,
      smoothFactor: 0,
      noClip: true,
      pane: 'twilight-mask',
      interactive: false,
    },
  ];

  // Day-brighten polygon styles — warm neutral tone (#f5f2ee, HSL ~34°,26%,96%;
  // warm mirror of moonlight #eef2f5), soft-light blend (set in CSS).
  // α values are higher than twilight-mask because soft-light has a gentler
  // visual weight than direct alpha overlay on very dark Carto tiles.
  const DAY_BRIGHTEN_TINT = '#f5f2ee'; // warm neutral — HSL ~34°, 26%, 96%; mirrors moonlight #eef2f5 on the warm side
  const dayBrightenStyles = [
    {
      altThreshold: SUN_HORIZON_DEG,
      fillColor: DAY_BRIGHTEN_TINT,
      fillOpacity: 0.35,
      fillRule: 'evenodd',
      weight: 0,
      smoothFactor: 0,
      noClip: true,
      pane: 'day-brighten',
      interactive: false,
    },
    {
      altThreshold: -6,
      fillColor: DAY_BRIGHTEN_TINT,
      fillOpacity: 0.22,
      fillRule: 'evenodd',
      weight: 0,
      smoothFactor: 0,
      noClip: true,
      pane: 'day-brighten',
      interactive: false,
    },
    {
      altThreshold: -12,
      fillColor: DAY_BRIGHTEN_TINT,
      fillOpacity: 0.13,
      fillRule: 'evenodd',
      weight: 0,
      smoothFactor: 0,
      noClip: true,
      pane: 'day-brighten',
      interactive: false,
    },
    {
      altThreshold: -18,
      fillColor: DAY_BRIGHTEN_TINT,
      fillOpacity: 0.08,
      fillRule: 'evenodd',
      weight: 0,
      smoothFactor: 0,
      noClip: true,
      pane: 'day-brighten',
      interactive: false,
    },
  ];

  // The mask layers are rebuilt in place (clearLayers + repopulate) on
  // every time/zoom/move-end so the geometry tracks the subsolar point.
  const dayMaskGroup = L.layerGroup();
  const dayBrightenGroup = L.layerGroup();

  // ---- Day-Veil Renderer: Anti-Center Small Cap as Hole in a Giant Rect ----
  //
  // The "draw a body-side cap" approach (radius 90 − T° around the sub-body
  // point) breaks topologically when T<0 pushes the cap past a hemisphere
  // (dDeg > 90°): for sub-body |lat| small enough, the cap encloses BOTH
  // poles, the θ-sweep emits two antimeridian jumps, and the pole-walk
  // splice produces a self-intersecting polygon that Leaflet renders as
  // crossing/discontinuous bands. Shifting that broken polygon across wrap
  // copies further amplifies the seams.
  //
  // Instead, for every band threshold T compute the COMPLEMENTARY night cap
  // around the anti-body point with radius dDeg = 90 + T (always ≤ 90°),
  // and render the white veil as "world rectangle minus night cap" via
  // Leaflet's polygon-with-holes. The night cap stays in Case A / Case B,
  // for which _computeAltitudeContourAround is already correct, and the
  // single outer ring covers all wrap copies seamlessly with one hole per
  // visible copy of the anti-body point.
  //
  // OUTER_RING / WRAP_RANGE live at module scope (see top of file). The
  // long-comment rationale: outer ring far larger than pannable so 1) hole
  // pole-walk segments at lat=±90 stay strictly inside outer (no SVG even-odd
  // fill-rule ambiguity at coincident edges) and 2) hole wrap-copies whose
  // lng range spills past outer ring don't create spurious fills visible at
  // low zoom. 7 copies (w∈{-3..+3}) span 2520° of lng — enough to fully tile
  // the outer ring for any anti-body lng.

  function rebuildVeilGroup(group, styles, date, antiCenterFn) {
    group.clearLayers();
    const anti = antiCenterFn(date);
    for (let i = styles.length - 1; i >= 0; i--) {
      const st = styles[i];
      const T = st.altThreshold;
      // Night-cap radius dDeg = 90 + T → pass altThresholdDeg = −T to
      // _computeAltitudeContourAround (which uses dDeg = 90 − altThresholdDeg).
      if (90 + T <= 0.001) continue;
      const holes = [];
      for (let w = -VEIL_WRAP_RANGE; w <= VEIL_WRAP_RANGE; w++) {
        const cLng = anti.lng + w * 360;
        const thetas = _densifyCapThetas(anti.lat, cLng, -T);
        const hole = _computeAltitudeContourAround(anti.lat, cLng, -T, VEIL_CAP_SAMPLES, thetas);
        if (hole.length >= 3) holes.push(hole);
      }
      if (!holes.length) continue;
      L.polygon([VEIL_OUTER_RING].concat(holes), st).addTo(group);
    }
  }

  function antiSunPoint(date) {
    return computeAntisolarPoint(date);
  }

  // Anti-moon sub-point: lat/lng of the antipode of the moon's geocentric
  // sub-point, negating lat and shifting lng by 180° (normalized to (−180,180]).
  //
  // GeoVector returns J2000 (EQJ); rotate to of-date (EQD) before deriving
  // RA/Dec so it pairs with the apparent sidereal time _GAST below (same
  // precession fix as _solarPosition — see its note).
  //
  // The sub-point is GEOCENTRIC; the compass moonrise is TOPOCENTRIC (lunar
  // horizontal parallax ~55′≈0.92°). That parallax is NOT irreducible — it is
  // folded into the geocentric altitude threshold by moonHorizonDeg (+HP term),
  // bringing the veil edge to <1s of the compass moonrise. (Earlier code/docs
  // wrongly treated it as a permanent ~few-minute offset.) See moonHorizonDeg.
  function antiMoonPoint(date) {
    const t = Astronomy.MakeTime(date);
    let v = Astronomy.GeoVector(Astronomy.Body.Moon, t, true);
    v = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(t), v);
    const r = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const ra = Math.atan2(v.y, v.x);
    const dec = Math.asin(v.z / r);
    const gast = _GAST(date);
    const subLat = _deg(dec);
    let subLng = _deg(ra) - gast;
    subLng = GeoUtils.normLng(subLng);
    let antiLng = subLng + 180;
    antiLng = GeoUtils.normLng(antiLng);
    return { lat: -subLat, lng: antiLng };
  }

  // ---- Moonlight Mask ----
  // 2-band frosted veil centered on the moon's sub-point. Per-frame alpha is
  // modulated by the moon's apparent magnitude (full moon = peak, new moon
  // ≈ 0) so the veil rises/falls with the lunar cycle.
  const moonMaskGroup = L.layerGroup();
  // Style templates — per-frame fillOpacity = alphaMax × ratio.
  const moonlightStyleTemplates = [
    // Edge OVERRIDDEN per-frame by moonHorizonDeg(date) in _moonlightStylesFor
    // (distance-aware, parallax-corrected ≈ +0.10°, pole-guarded) so the veil
    // edge matches the topocentric compass moonrise to <1s — the lunar parallax
    // is folded into the threshold, NOT irreducible. Placeholder below is the
    // mean apparent-limb value. See the moonHorizonDeg / _horizonDeg block comment.
    { altThreshold: MOON_HORIZON_DEG, ratio: 1.0 },
    { altThreshold: -3, ratio: 0.35 }, // soft moonset/moonrise edge
  ];

  const MOONLIGHT_TINT = '#eef2f5'; // cool milky white
  const ECLIPSE_RED = (window.C && C.eclipseRed) || '#a8432c'; // umbral-eclipse tint (brick/rust)

  const MOON_MAG_FULL = -11.5; // gibbous reference; full moon (−12.7) is clamped to peak
  const MOONLIGHT_ALPHA_PEAK = 0.12;

  function moonlightAlphaMax(date) {
    try {
      const mag = Astronomy.Illumination(Astronomy.Body.Moon, date).mag;
      // Brightness ratio relative to full moon. Linear in flux (not mag)
      // matches "初三接近无" — flux drops 100× from full to crescent.
      const B = Math.pow(10, -0.4 * (mag - MOON_MAG_FULL));
      return Math.max(0, Math.min(MOONLIGHT_ALPHA_PEAK, MOONLIGHT_ALPHA_PEAK * B));
    } catch (e) {
      return 0;
    }
  }

  function _moonlightStylesFor(date) {
    const alphaMax = moonlightAlphaMax(date);
    // During a lunar eclipse's umbral phase, redden the moonlight veil
    // (cool milky white → blood red) by umbral depth — replaces the old
    // bright lunar-visibility raster overlay.
    let tint = MOONLIGHT_TINT;
    if (typeof Eclipse !== 'undefined' && Eclipse.lunarRedness) {
      const f = Eclipse.lunarRedness(date); // 0..1
      if (f > 0) tint = GeoUtils.lerpHex(MOONLIGHT_TINT, ECLIPSE_RED, f);
    }
    // First band (i===0) = distance-aware moonHorizonDeg (apparent limb at
    // horizon, parallax-corrected, pole-guarded). The −3° soft band stays put.
    const horizon = moonHorizonDeg(date);
    return moonlightStyleTemplates.map((t, i) => ({
      altThreshold: i === 0 ? horizon : t.altThreshold,
      fillColor: tint,
      fillOpacity: alphaMax * t.ratio,
      fillRule: 'evenodd', // multi-ring outer-rect+holes, see rebuildVeilGroup
      weight: 0,
      smoothFactor: 0,
      noClip: true, // preserve cap polygon's polar excursions across viewport edges
      pane: 'moonlight-mask',
      interactive: false,
    }));
  }

  function rebuildMoonMask(date) {
    const styles = _moonlightStylesFor(date);
    rebuildVeilGroup(moonMaskGroup, styles, date, antiMoonPoint);
  }

  // Shallow-clone a style array, overriding the first band's altThreshold (the
  // rise/set band) with the distance-aware per-frame horizon. Twilight bands
  // (−6/−12/−18) are geometric depressions and stay put.
  function _withHorizon(styles, h) {
    const out = styles.slice();
    out[0] = Object.assign({}, out[0], { altThreshold: h });
    return out;
  }

  function rebuildDayMask(date) {
    const h = sunHorizonDeg(date);
    rebuildVeilGroup(dayMaskGroup, _withHorizon(dayMaskStyles, h), date, antiSunPoint);
    rebuildVeilGroup(dayBrightenGroup, _withHorizon(dayBrightenStyles, h), date, antiSunPoint);
  }

  // One call per time/zoom/wrap refresh: each mask group checks its own
  // on-map state independently, so toggling daylight off without moonlight
  // no longer freezes moonlight at its init position.
  // The veil geometry (anti-sun holed rectangle + 7 fixed wrap copies) is a pure
  // function of date — it is built in lat/lng and Leaflet reprojects it for free on
  // zoom/pan. So gate this on (instant + each mask's on-map state): a zoom/pan at the
  // same instant short-circuits (no rebuild, Leaflet reprojects existing polygons),
  // while a time change or a layer toggle changes the key and rebuilds. Toggle paths
  // that call rebuildDayMask/_setDayMode directly bypass this gate, so their behaviour
  // is unchanged; this only suppresses the redundant zoomend/moveend rebuilds.
  let _lastMaskKey = '';
  function refreshTimeMasks(date) {
    let key = (date || now).getTime() + '|' + (dayMaskGroup._map ? 1 : 0) + (moonMaskGroup._map ? 1 : 0);
    // The veil cap is viewport-densified at high zoom (_densifyCapThetas), so the
    // dense arc must re-center on pan/zoom — fold a coarse viewport bucket (~one
    // tile) into the key so an intra-wrap pan rebuilds. Low zoom stays
    // viewport-agnostic (uniform sampling), so its pans still short-circuit.
    if (map.getZoom() >= VEIL_DENSIFY_ZOOM) {
      const ctr = map.project(map.getCenter());
      key += '|' + map.getZoom() + ':' + Math.round(ctr.x / 256) + ':' + Math.round(ctr.y / 256);
    }
    if (key === _lastMaskKey) return;
    _lastMaskKey = key;
    if (dayMaskGroup._map) rebuildDayMask(date);
    if (moonMaskGroup._map) rebuildMoonMask(date);
  }

  rebuildDayMask(now);

  // ---- Subsolar / Antisolar Point Markers ----
  // Sun uses unified luminosity model (mag −26.7).
  const SUN_MAG = -26.74;
  const SUN_CORE_COLOR = '#fdf6e3'; // warm white (oklch ~0.97 0.03 85)
  const SUN_GLOW_COLOR = '#fde68a'; // warmer, lower L
  const SUN_FOOTPRINT_KM = 59; // ~31.5′ angular → ~59 km ground

  const SUN_MIN_DISK_PX = 10;

  // Photographic-overexposure bloom for the sun under the white daylight
  // veil. Replaces the yellow sun-large/xlarge SVG disk when
  // _dayModeActive is true so the sun reads as "burning through" the veil
  // instead of "painted on top of" it.
  //
  // 4 stacked radial-gradient divs, each with mix-blend-mode: screen so
  // their brightnesses accumulate. On the white veil, screen(white, *)
  // floors at white → pure-white scorched core; on the night side
  // screen(*, near-black) ≈ source → soft white halo (still legible).
  //
  // Outer ring (L4) deliberately uses a cool tint (#f5faff → #dcebff
  // transparent) so the very edge picks up a hint of sky-blue when sitting
  // on dark night background — matches the user's reference exactly.
  function buildSunBloomHtml(fpPxEff, dA) {
    const bloomSz = Math.max(8, Math.round(fpPxEff * 2.6));
    const fade = Math.max(0, Math.min(1, dA));
    if (fade < 0.01) return null;
    // Each gradient layer's container; inset:0 stretches to wrapper, screen
    // blend composites with all layers (and the veil) below.
    const layerStyle = 'position:absolute;inset:0;border-radius:50%;mix-blend-mode:screen';
    const L1 =
      '<div style="' +
      layerStyle +
      ';background:radial-gradient(circle,' +
      'rgba(255,255,255,1) 0%,' +
      'rgba(255,255,255,1) 14%,' +
      'rgba(255,255,255,0.92) 24%,' +
      'rgba(255,255,255,0) 40%)' +
      '"></div>';
    const L2 =
      '<div style="' +
      layerStyle +
      ';background:radial-gradient(circle,' +
      'rgba(255,255,255,0) 18%,' +
      'rgba(255,255,255,0.65) 30%,' +
      'rgba(255,255,255,0.20) 55%,' +
      'rgba(255,255,255,0) 75%)' +
      '"></div>';
    const L3 =
      '<div style="' +
      layerStyle +
      ';background:radial-gradient(circle,' +
      'rgba(255,255,255,0) 35%,' +
      'rgba(255,255,255,0.30) 55%,' +
      'rgba(255,255,255,0.10) 78%,' +
      'rgba(255,255,255,0) 95%)' +
      '"></div>';
    const L4 =
      '<div style="' +
      layerStyle +
      ';background:radial-gradient(circle,' +
      'rgba(245,250,255,0) 60%,' +
      'rgba(245,250,255,0.18) 80%,' +
      'rgba(220,235,255,0) 100%)' +
      '"></div>';
    // Opaque white core disc — sized to match the original sun SVG disc
    // (≈ fpPxEff) and centered inside the bloomSz wrapper. NO screen blend,
    // NO opacity fade: this is just a flat opaque circle, the way the moon
    // disc reads. The screen-blended bloom layers behind it provide the
    // surrounding "overexposure halo"; this disc gives the solid-body
    // anchor the user expects to see — fully opaque so grid lines (ecliptic,
    // lunar path, etc.) at z=686+ behind the disc are NOT visible through it.
    const discSz = Math.max(4, Math.round(fpPxEff));
    const discInset = (bloomSz - discSz) / 2;
    const L0 =
      '<div style="position:absolute;left:' +
      discInset.toFixed(1) +
      'px;top:' +
      discInset.toFixed(1) +
      'px;width:' +
      discSz +
      'px;height:' +
      discSz +
      'px;border-radius:50%;background:#ffffff"></div>';
    // L1–L4 (bloom rings) live inside an inner faded wrapper so they
    // smoothly fade in at low zoom alongside the disc threshold. L0 sits
    // OUTSIDE this inner wrapper so it stays at opacity 1.0 whenever it
    // renders at all — keeping the disc body fully solid.
    return {
      html:
        '<div style="position:relative;width:' +
        bloomSz +
        'px;height:' +
        bloomSz +
        'px">' +
        '<div style="position:absolute;inset:0;opacity:' +
        fade.toFixed(3) +
        '">' +
        L1 +
        L2 +
        L3 +
        L4 +
        '</div>' +
        L0 +
        '</div>',
      size: bloomSz,
    };
  }

  function buildSunOpts(zoom, lat) {
    const scale = Lum.zoomScale(zoom);
    const sp = Lum.spriteRadii(SUN_MAG, scale);
    const colors = Lum.colorForBody('Sun', scale);

    const fpPx = Lum.footprintPx(zoom, SUN_FOOTPRINT_KM, lat || 0);
    const floor = (Lum.params && Lum.params.sunMinDiskPx) || 32;
    const fpPxEff = Math.max(fpPx, floor);

    const dA = Lum.smoothstep(6, 40, fpPxEff);
    const glowRetire = 1 - 0.5 * dA;

    // Day-mask veil shifts background color from dark sky to ~52%-opaque
    // white. Warm halos stack as orange blobs on that — desaturate toward
    // white so the residual color blends in (CSS screen blend below carries
    // the rest of the fade). Halo dominates the visual mismatch; core gets
    // a much lighter nudge so the sun disk stays recognizable.
    const tint = _dayModeActive ? Lum.desaturateForDay(colors.halo, 0.7) : colors.halo;
    const cCol = _dayModeActive ? Lum.desaturateForDay(colors.core, 0.25) : colors.core;

    const glowSpec = {
      coreR: sp.core,
      glowR: sp.glow,
      glareR: sp.glare,
      coreCol: cCol,
      tint: tint,
      alpha: glowRetire,
    };

    const coreOpts = {
      pane: 'body-sun',
      radius: sp.core,
      fillColor: colors.core,
      fillOpacity: Lum.coreOpacity(sp.lnB) * (1 - dA),
      stroke: false,
      interactive: true,
    };

    let diskHtml = null;
    if (fpPxEff >= SUN_MIN_DISK_PX * 0.5) {
      // Day-mode: replace the SVG sun disk with a CSS bloom that reads as
      // photographic overexposure on the bright veil instead of "yellow
      // circle painted on cloth". See buildSunBloomHtml above.
      if (_dayModeActive) {
        diskHtml = buildSunBloomHtml(fpPxEff, dA);
      } else {
        const sz = Math.max(4, Math.round(fpPxEff));
        // fpPxEff is floored to sunMinDiskPx (32), so the small (<22px) LOD
        // tier is unreachable — only the large↔xlarge crossfade applies.
        const lodMix2 = Lum.smoothstep(80, 160, fpPxEff); // 0=large, 1=xlarge
        let imgs = [];
        if (lodMix2 < 0.99) {
          // Large visible
          const op = dA * (1 - lodMix2);
          if (op > 0.01)
            imgs.push(
              '<img src="img/sun-large.svg" width="' +
                sz +
                '" height="' +
                sz +
                '" style="display:block;position:absolute;left:0;top:0;opacity:' +
                op.toFixed(3) +
                '">'
            );
        }
        if (lodMix2 > 0.01) {
          // Xlarge visible
          const op = dA * lodMix2;
          if (op > 0.01)
            imgs.push(
              '<img src="img/sun-xlarge.svg" width="' +
                sz +
                '" height="' +
                sz +
                '" style="display:block;position:absolute;left:0;top:0;opacity:' +
                op.toFixed(3) +
                '">'
            );
        }
        if (imgs.length > 0) {
          diskHtml = {
            html:
              '<div style="position:relative;width:' +
              sz +
              'px;height:' +
              sz +
              'px;border-radius:50%;overflow:hidden">' +
              imgs.join('') +
              '</div>',
            size: sz,
          };
        }
      } // else branch (non-day-mode SVG disk path) ends
    }
    return { coreOpts, glowSpec, diskHtml };
  }

  const antiOpts = { radius: 5, fillColor: '#1e293b', fillOpacity: 0.9, color: '#94a3b8', weight: 1.5 };

  const subsolarGroup = L.layerGroup();
  const antisolarGroup = L.layerGroup();

  const subParallelLine = L.polyline([], {
    weight: 4,
    color: '#f59e0b',
    opacity: 0.65,
    dashArray: '8 5',
    smoothFactor: 0,
  });
  const antiParallelLine = L.polyline([], {
    weight: 3,
    color: '#64748b',
    opacity: 0.55,
    dashArray: '6 4',
    smoothFactor: 0,
  });
  const antiParallelLabels = L.layerGroup();

  // Subsolar latitude label — fixed to screen left, bottom-aligned above line.
  // ── DISABLED: subsolar text label preserved for later but no longer
  //    rendered (the white twilight veil + sun glyph make it redundant).
  //    DOM element is still constructed so downstream references (display
  //    toggles in layeradd / TimeState callbacks) don't crash; the
  //    appendChild + positionLatLabel calls below are commented out.
  const ssLatLabel = L.DomUtil.create('div', 'ss-lat-label');
  ssLatLabel.style.cssText = [
    'position:absolute',
    'left:10px',
    'z-index:1000',
    'font-size:' + _labelFontSize() + 'px',
    'color:#f59e0b',
    'text-shadow:-1px -1px 0 rgba(255,255,255,0.8),1px -1px 0 rgba(255,255,255,0.8),-1px 1px 0 rgba(255,255,255,0.8),1px 1px 0 rgba(255,255,255,0.8)',
    'padding:2px 6px',
    'white-space:nowrap',
    'pointer-events:none',
    'transform:translateY(-100%)',
  ].join(';');
  // map.getContainer().appendChild(ssLatLabel);  // disabled — see comment above
  ssLatLabel.style.display = 'none';

  function positionLatLabel(lat) {
    if (!map.hasLayer(twilightGroup)) {
      ssLatLabel.style.display = 'none';
      return;
    }
    const pt = map.latLngToContainerPoint([lat, 0]);
    const ch = map.getContainer().clientHeight;
    if (pt.y < -30 || pt.y > ch + 30) {
      ssLatLabel.style.display = 'none';
    } else {
      ssLatLabel.style.display = '';
      ssLatLabel.style.top = pt.y - 2 + 'px';
    }
  }

  let currentSSLat = 0;
  // map.on('move zoom', function () { positionLatLabel(currentSSLat); });  // disabled with ssLatLabel

  // ---- Dynamic Z-Order for Sun / Mercury / Venus ----
  // Re-sort by geocentric distance each tick so transits (planet closer than
  // Sun → higher z) and superior conjunctions (planet behind Sun → lower z)
  // render with correct occlusion.
  const INNER_BODIES = ['sun', 'mercury', 'venus'];
  const INNER_BODY_ASTRO = {
    sun: Astronomy.Body.Sun,
    mercury: Astronomy.Body.Mercury,
    venus: Astronomy.Body.Venus,
  };

  const INNER_Z_SLOTS = [
    [740, 741, 742],
    [743, 744, 745],
    [746, 747, 748],
  ];

  function updateInnerBodyZOrder(date) {
    const t = Astronomy.MakeTime(date);
    const dists = INNER_BODIES.map((id) => {
      const v = Astronomy.GeoVector(INNER_BODY_ASTRO[id], t, true);
      return { id, dist: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) };
    });
    dists.sort((a, b) => b.dist - a.dist);
    dists.forEach((d, i) => {
      const lp = map.getPane('body-' + d.id + '-label');
      const gp = map.getPane('body-' + d.id + '-glow');
      const cp = map.getPane('body-' + d.id);
      if (lp) lp.style.zIndex = String(INNER_Z_SLOTS[i][0]);
      if (gp) gp.style.zIndex = String(INNER_Z_SLOTS[i][1]);
      if (cp) cp.style.zIndex = String(INNER_Z_SLOTS[i][2]);
    });
  }

  // Place initial sun marker.
  {
    const sunVis = buildSunOpts(map.getZoom(), ss.lat);
    placeWrappedLumBody(
      ss.lat,
      ss.lng,
      sunVis.coreOpts,
      sunVis.glowSpec,
      sunVis.diskHtml,
      subsolarGroup,
      _t('map.celestial.sun'),
      onSunLeftClick,
      onSunContextMenu,
      null
    );
    ssLatLabel.style.display = 'none';
    currentSSLat = ss.lat;
  }
  updateInnerBodyZOrder(now);

  // ── Sun "visible range" overlay — 0° boundary line + golden fill ────────
  // Previously rendered every 6° between -90° and +90° (~25 contours per
  // frame); current spec is a single bold 0° boundary plus a coloured fill
  // mask in the body-vis pane (z=180).
  //
  // PRESERVED FOR LATER — old 6° altitude grid (computeAltitudeContour was
  // removed; revive via `_computeAltitudeContourAround(antiSun.lat,
  // antiSun.lng + w*360, a)` per wrap copy w ∈ {-3..+3}):
  //   for (let a = -90; a <= 90; a += 6) {
  //     if (a === 0 || a === -6 || a === -12 || a === -18) continue;
  //     drawLabeledContour(computeAltitudeContour(now, a), a,
  //       contourLinesGroup, contourLabelsGroup);
  //   }
  const contourLinesGroup = L.layerGroup();
  const contourLabelsGroup = L.layerGroup(); // unused now — kept for layer-group structure stability
  const contourFillGroup = L.layerGroup();
  // Sun visibility-range styling: bright golden line + low-α gold fill.
  const SUN_VIS_CFG = { id: 'sun', color: '#f59e0b', labelColor: '#fde68a' };
  const SUN_VIS_MAG = -26.74;
  drawVisibilityRange(antiSunPoint(now), SUN_VIS_CFG, SUN_VIS_MAG, contourLinesGroup, contourFillGroup, {
    altThreshold: sunHorizonDeg(now),
  });

  // Separate twilight contours for mutual exclusion with planet contours.
  const twilightContourGroup = L.layerGroup([contourLinesGroup, contourFillGroup]);

  // twilightGroup now contains only the Sun marker; dayMaskGroup and
  // dayBrightenGroup are managed independently by the "glow" checkbox via
  // refreshCelestialOverlays (mutually exclusive with moonMaskGroup, with
  // Sun-side taking priority).
  const twilightGroup = L.layerGroup([subsolarGroup]);
  // Twilight + contours off by default (Uranometria spec: only stars on)
  // positionLatLabel(currentSSLat);  // ssLatLabel disabled — see §5 of plan

  // Contour mutual exclusion: only the most-recently-toggled celestial body shows contours.
  let activeContourLayer = twilightContourGroup;
  let toggleCtrl = null; // assigned later; referenced inside activate* helpers

  // Shared info popup (left-click on Sun/Moon/Planet opens this)
  let _bodyInfoPopup = null;
  let _bodyInfoBuilder = null;
  let _bodyInfoId = null;
  function _showBodyInfoPopup(bodyId, latlng) {
    if (typeof Planets === 'undefined' || !Planets.buildBodyInfoHTML) return;
    _bodyInfoId = bodyId;
    _bodyInfoBuilder = function () {
      return Planets.buildBodyInfoHTML(bodyId, TimeState.current);
    };
    if (!_bodyInfoPopup) {
      _bodyInfoPopup = L.popup({
        className: 'sky-star-popup',
        maxWidth: 280,
        offset: [0, -6],
        closeButton: true,
        autoPan: false,
      });
      _bodyInfoPopup.on('remove', () => {
        _bodyInfoBuilder = null;
        _bodyInfoId = null;
      });
      if (typeof I18n !== 'undefined') {
        I18n.subscribe(() => {
          if (_bodyInfoPopup && _bodyInfoBuilder && _bodyInfoPopup.isOpen()) {
            _bodyInfoPopup.setContent(_bodyInfoBuilder());
          }
        });
      }
      TimeState.subscribe(() => {
        if (_bodyInfoPopup && _bodyInfoBuilder && _bodyInfoId && _bodyInfoPopup.isOpen()) {
          const newPos = Planets.getSearchLatLng(_bodyInfoId, TimeState.current);
          if (newPos) _bodyInfoPopup.setLatLng(L.latLng(newPos.lat, newPos.lng));
          _bodyInfoPopup.setContent(_bodyInfoBuilder());
        }
      });
    }
    _bodyInfoPopup.setLatLng(latlng).setContent(_bodyInfoBuilder()).openOn(map);
  }

  // Close any active body contour (used when left-clicking a different body)
  function _clearActiveContour(except) {
    if (!activeContourLayer || activeContourLayer === except) return;
    map.removeLayer(activeContourLayer);
    activeContourLayer = null;
    if (toggleCtrl && toggleCtrl._update) toggleCtrl._update();
  }

  // Shared floating context menu — used by both right-click-on-marker
  // (lock/unlock/remove) and right-click-on-celestial-body (visible range)
  // so they share visual style and right-of-cursor anchoring. The original
  // location-marker handler still calls showCtxMenu (further below); having
  // the DOM + helpers set up early lets _showBodyContextMenu reuse them.
  const ctxMenu = L.DomUtil.create('div', 'map-context-menu', map.getContainer());
  ctxMenu.style.display = 'none';
  function hideCtxMenu() {
    ctxMenu.style.display = 'none';
  }
  document.addEventListener('click', hideCtxMenu);
  map.on('movestart zoomstart', hideCtxMenu);

  function showCtxMenu(containerPt, items) {
    ctxMenu.innerHTML = '';
    items.forEach((it) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-context-item';
      btn.textContent = it.label;
      btn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        hideCtxMenu();
        it.onClick();
      });
      ctxMenu.appendChild(btn);
    });
    ctxMenu.style.left = containerPt.x + 'px';
    ctxMenu.style.top = containerPt.y + 'px';
    ctxMenu.style.display = '';
  }

  // Right-click context menu (single option: "Visible range").
  // Uses the same floating .map-context-menu DIV as the location-marker
  // lock/remove menu so both look and behave identically.
  function _showBodyContextMenu(ev, onVisibleRange) {
    const _t = typeof I18n !== 'undefined' ? I18n.t.bind(I18n) : (k) => k;
    let clickPx = ev && ev.containerPoint ? ev.containerPoint : null;
    if (!clickPx && ev && ev.originalEvent) {
      try {
        clickPx = map.mouseEventToContainerPoint(ev.originalEvent);
      } catch (_) {}
    }
    if (!clickPx && ev && ev.latlng) clickPx = map.latLngToContainerPoint(ev.latlng);
    if (!clickPx) return;
    showCtxMenu(clickPx, [{ label: _t('sky.menu.visible_range'), onClick: onVisibleRange }]);
  }

  // Activate "body mode" for a planet/moon entry: ensure its marker + altitude
  // contour are the only celestial overlays, and hide the observer rays so the
  // contour reads cleanly. Idempotent — safe to call when already active.
  function activateBodyMode(entry) {
    // Re-trigger on the currently-active body clears its contour (toggle).
    if (activeContourLayer === entry.contourLayer) {
      map.removeLayer(entry.contourLayer);
      activeContourLayer = null;
      if (toggleCtrl && toggleCtrl._update) toggleCtrl._update();
      return;
    }
    if (activeContourLayer) map.removeLayer(activeContourLayer);
    if (!map.hasLayer(entry.contourLayer)) map.addLayer(entry.contourLayer);
    activeContourLayer = entry.contourLayer;
    Planets.updateContours(map, planetEntries, TimeState.current);
    if (toggleCtrl && toggleCtrl._update) toggleCtrl._update();
  }

  // Sun "visible range" → activate the twilight contour group.
  function activateSunMode() {
    if (activeContourLayer === twilightContourGroup) {
      // Toggle off if already active
      map.removeLayer(twilightContourGroup);
      activeContourLayer = null;
      if (toggleCtrl && toggleCtrl._update) toggleCtrl._update();
      return;
    }
    if (activeContourLayer) map.removeLayer(activeContourLayer);
    if (!map.hasLayer(twilightContourGroup)) map.addLayer(twilightContourGroup);
    activeContourLayer = twilightContourGroup;
    if (toggleCtrl && toggleCtrl._update) toggleCtrl._update();
  }

  // ---- Generic Celestial Visibility Range (Stars, DSOs, Comets, Meteor Radiants) ----
  // Shared groups re-used for every generic body (only one open at a time per
  // user constraint). Added to / removed from map by activateCelestialVis.
  const genericVisLineGroup = L.layerGroup();
  const genericVisFillGroup = L.layerGroup();
  const genericVisContourGroup = L.layerGroup([genericVisLineGroup, genericVisFillGroup]);

  // Closure: remembers which body's vis range is currently shown so a
  // second right-click on the same body toggles it off.
  let _currentGenericVis = null;

  // Rebuild the generic vis overlay for (ra, dec) at current time.
  function _rebuildGenericVis(ra, dec, date) {
    genericVisLineGroup.clearLayers();
    genericVisFillGroup.clearLayers();
    const gmst = _GMST(_julianDay(date));
    const anti = antiCelestialPoint(ra, dec, gmst);
    drawVisibilityRange(anti, { color: '#ffffff' }, 0, genericVisLineGroup, genericVisFillGroup, { fillOpacity: 0.04 });
  }

  // Show (or toggle off) the 0° visibility-range overlay for an arbitrary
  // celestial body identified by equatorial coords (degrees).  Color: white,
  // fillOpacity 0.04.  Participates in the same activeContourLayer mutual
  // exclusion as Sun / planet overlays.
  function activateCelestialVis(ra, dec) {
    if (
      activeContourLayer === genericVisContourGroup &&
      _currentGenericVis &&
      _currentGenericVis.ra === ra &&
      _currentGenericVis.dec === dec
    ) {
      // Same body → toggle off
      map.removeLayer(genericVisContourGroup);
      activeContourLayer = null;
      _currentGenericVis = null;
      if (toggleCtrl && toggleCtrl._update) toggleCtrl._update();
      return;
    }
    if (activeContourLayer) map.removeLayer(activeContourLayer);
    _rebuildGenericVis(ra, dec, TimeState.current);
    if (!map.hasLayer(genericVisContourGroup)) map.addLayer(genericVisContourGroup);
    activeContourLayer = genericVisContourGroup;
    _currentGenericVis = { ra, dec };
    if (toggleCtrl && toggleCtrl._update) toggleCtrl._update();
  }

  // Expose to other modules (sky.js / comet.js / meteor.js / observer.js call these via window.)
  window.activateCelestialVis = activateCelestialVis;
  window._showBodyContextMenu = _showBodyContextMenu;
  window.showCtxMenu = showCtxMenu;

  // Body left-click → open info popup, close active contour for other bodies.
  // When the observer compass is active, also toggle a great-circle line from
  // the observer to this body's ground point (no-op otherwise).
  function onBodyLeftClick(entry, ev) {
    _clearActiveContour(entry.contourLayer);
    const latlng = ev && ev.latlng ? ev.latlng : null;
    if (latlng) _showBodyInfoPopup(entry.config.id, latlng);
    if (typeof Observer !== 'undefined' && Observer.toggleGreatCircleTo) {
      Observer.toggleGreatCircleTo({ kind: 'body', id: entry.config.id });
    }
  }

  // Body right-click → context menu with "Visible range"
  function onBodyContextMenu(entry, ev) {
    if (!ev) return;
    _showBodyContextMenu(ev, () => activateBodyMode(entry));
  }

  // Sun left-click → info popup (+ great-circle toggle when compass active)
  function onSunLeftClick(ev) {
    _clearActiveContour(twilightContourGroup);
    const latlng = ev && ev.latlng ? ev.latlng : null;
    if (latlng) _showBodyInfoPopup('sun', latlng);
    if (typeof Observer !== 'undefined' && Observer.toggleGreatCircleTo) {
      Observer.toggleGreatCircleTo({ kind: 'body', id: 'sun' });
    }
  }

  // Sun right-click → context menu
  function onSunContextMenu(ev) {
    if (!ev) return;
    _showBodyContextMenu(ev, activateSunMode);
  }

  // ---- Planet / Celestial-Body Layers ----
  const planetEntries = Planets.init(map, now, onBodyLeftClick, onBodyContextMenu);
  // Moon is configured alongside planets in planets.js but the UI exposes it
  // as its own toggle, so split it out for the layer buttons.
  const moonEntry = planetEntries.find((e) => e.config.id === 'moon') || null;
  const planetsOnlyEntries = planetEntries.filter((e) => e.config.id !== 'moon');

  // ---- Celestial Overlays: Ecliptic, Lunar Path, Equator ----
  Ecliptic.init(map);
  Ecliptic.update(now);
  if (typeof LunarPath !== 'undefined') {
    LunarPath.init(map);
    LunarPath.update(now);
  }
  if (typeof GalacticEquator !== 'undefined') {
    GalacticEquator.init(map);
    GalacticEquator.update(now);
  }

  // Celestial equator = lat 0 line (Dec=0 projects to geographic equator).
  // Styled as a twin-rail ruler with ticks, mirroring the ecliptic geometry.
  const _equatorGroup = L.layerGroup();
  let _equatorZoom = -1;

  const _EQ_COLOR = '#7682a0';
  const _EQ_COLOR_DAY = '#90a4cc';
  const _EQ_CASING = '#181d23';

  const _EQ_RAIL_HALF = 0.58;
  const _EQ_MICRO_HALF = 0.35;
  function _eqS(o) {
    return Object.assign({ pane: 'equator', smoothFactor: 0, noClip: true, interactive: false }, o);
  }
  const _EQ_RAIL_CASING = _eqS({ color: _EQ_CASING, weight: 2.8, opacity: 1.0 });
  const _EQ_RAIL_LINE = _eqS({ color: _EQ_COLOR, weight: 1.0, opacity: 0.9 });
  const _EQ_TICK_MAJOR_CASING = _eqS({ color: _EQ_CASING, weight: 2.4, opacity: 1.0 });
  const _EQ_TICK_MAJOR_LINE = _eqS({ color: _EQ_COLOR, weight: 1.1, opacity: 0.9 });
  const _EQ_TICK_MINOR_CASING = _eqS({ color: _EQ_CASING, weight: 1.8, opacity: 1.0 });
  const _EQ_TICK_MINOR_LINE = _eqS({ color: _EQ_COLOR, weight: 0.7, opacity: 0.9 });
  const _EQ_MICRO_TICK = _eqS({ color: _EQ_COLOR, weight: 0.4, opacity: 0.55 });

  function _eqRaToLng(raDeg, refLng) {
    var sp = GeoUtils.subStellarPoint(raDeg, 0, _eqDate);
    var lng = sp.lng;
    while (lng - refLng > 180) lng -= 360;
    while (lng - refLng < -180) lng += 360;
    return lng;
  }

  var _eqDate = now;

  function _eqVisibleOffsets(baseLngs) {
    var W = MAP_LNG_WEST,
      E = MAP_LNG_EAST;
    var lo = Infinity,
      hi = -Infinity;
    for (var i = 0; i < baseLngs.length; i++) {
      if (baseLngs[i] < lo) lo = baseLngs[i];
      if (baseLngs[i] > hi) hi = baseLngs[i];
    }
    var out = [];
    for (var w = -2; w <= 2; w++) {
      var off = w * 360;
      if (hi + off < W - 1 || lo + off > E + 1) continue;
      out.push(off);
    }
    return out;
  }

  var _lastEquatorKey = '';
  function _rebuildEquator(date) {
    var _eqz = map.getZoom();
    var _eqTier = _eqz <= 3 ? 0 : _eqz <= 4 ? 1 : 2;
    var _eqWrapsKey = visibleWrapsFromBounds(map).join(',');
    // Day-veil visibility gates rail/tick/label casing (via _eqSS below), so it
    // is a render input and must be in the memo key — else toggling the veil
    // with zoom/wraps/time unchanged early-returns and strands the old casing.
    var _eqKey = _eqTier + '|' + _eqWrapsKey + '|' + (date || now).getTime() + '|' + (window._dayMaskVisible ? 1 : 0);
    if (_eqKey === _lastEquatorKey) return;
    _lastEquatorKey = _eqKey;

    _equatorGroup.clearLayers();
    var W = MAP_LNG_WEST,
      E = MAP_LNG_EAST;
    var z = _eqz;
    _equatorZoom = z;
    _eqDate = date || now;

    // Day-adaptive colouring shared by ticks/micro-ticks: cache the subsolar
    // point once (getSubsolarLatLng is NOT memoised) and reuse a cheap inline
    // altitude formula, since z≥5 draws hundreds of micro-ticks per rebuild.
    var _eqCasingDay = (window.C && C.casingDay) || '#484848';
    var _eqSS =
      window._dayMaskVisible && typeof GeoUtils !== 'undefined' && typeof window.getSubsolarLatLng === 'function'
        ? window.getSubsolarLatLng(_eqDate)
        : null;
    function _eqStrength(lat, lng) {
      if (!_eqSS) return 0;
      var D = Math.PI / 180;
      var sinAlt =
        Math.sin(lat * D) * Math.sin(_eqSS.lat * D) +
        Math.cos(lat * D) * Math.cos(_eqSS.lat * D) * Math.cos((lng - _eqSS.lng) * D);
      return GeoUtils.dayStrength(Math.asin(Math.max(-1, Math.min(1, sinAlt))) / D);
    }

    // Twin rails (Dec=0 → lat=0, rails span full map width). Densify along lng
    // so the day strength can vary, then split into day-adaptive runs. Two
    // passes keep both casings beneath both lines (original layering).
    var R = _EQ_RAIL_HALF;
    var EQ_RAIL_STEP = 3; // degrees of lng between densified rail vertices
    function _eqRailPts(lat) {
      var pts = [];
      for (var lng = W; lng < E; lng += EQ_RAIL_STEP) pts.push([lat, lng]);
      pts.push([lat, E]);
      return pts;
    }
    var _eqRailRuns = [
      GeoUtils.dayStrengthRuns(_eqRailPts(R), _eqDate),
      GeoUtils.dayStrengthRuns(_eqRailPts(-R), _eqDate),
    ];
    for (var rr = 0; rr < _eqRailRuns.length; rr++) {
      for (var rc = 0; rc < _eqRailRuns[rr].length; rc++) {
        var _run = _eqRailRuns[rr][rc];
        L.polyline(
          _run.pts,
          Object.assign({}, _EQ_RAIL_CASING, { color: GeoUtils.lerpHex(_EQ_CASING, _eqCasingDay, _run.t) })
        ).addTo(_equatorGroup);
      }
    }
    for (var rr2 = 0; rr2 < _eqRailRuns.length; rr2++) {
      for (var rc2 = 0; rc2 < _eqRailRuns[rr2].length; rc2++) {
        var _run2 = _eqRailRuns[rr2][rc2];
        L.polyline(
          _run2.pts,
          Object.assign({}, _EQ_RAIL_LINE, { color: GeoUtils.lerpHex(_EQ_COLOR, _EQ_COLOR_DAY, _run2.t) })
        ).addTo(_equatorGroup);
      }
    }

    // Reference lng for RA=0 (used to unwrap all other RAs into a continuous range)
    var refLng = GeoUtils.subStellarPoint(0, 0, _eqDate).lng;

    // Zoom-tiered ticks (mirrors ecliptic _tickSetForZoom)
    var ticks = [];
    if (z <= 3) {
      for (var d = 0; d < 360; d += 90) ticks.push({ ra: d, isMajor: true });
    } else if (z === 4) {
      for (var d2 = 0; d2 < 360; d2 += 45) ticks.push({ ra: d2, isMajor: true });
    } else {
      for (var d3 = 0; d3 < 360; d3 += 15) ticks.push({ ra: d3, isMajor: d3 % 45 === 0 });
    }

    // Compute base lngs for all ticks, then determine world-copy offsets
    var tickLngs = [];
    for (var i = 0; i < ticks.length; i++) {
      tickLngs.push(_eqRaToLng(ticks[i].ra, refLng));
    }
    var offsets = _eqVisibleOffsets(tickLngs);
    if (offsets.length === 0) return;

    var showLabels = z >= 4;
    var _t =
      typeof I18n !== 'undefined'
        ? I18n.t.bind(I18n)
        : function (k) {
            return k;
          };

    for (var i2 = 0; i2 < ticks.length; i2++) {
      var t = ticks[i2];
      var lng = tickLngs[i2];
      var half = _EQ_RAIL_HALF;
      var cs = t.isMajor ? _EQ_TICK_MAJOR_CASING : _EQ_TICK_MINOR_CASING;
      var ln = t.isMajor ? _EQ_TICK_MAJOR_LINE : _EQ_TICK_MINOR_LINE;
      // Short tick → one day strength at lng (lat 0), shared by line + label.
      var _eqT = _eqStrength(0, lng);
      var csCol = Object.assign({}, cs, { color: GeoUtils.lerpHex(_EQ_CASING, _eqCasingDay, _eqT) });
      var lnCol = Object.assign({}, ln, { color: GeoUtils.lerpHex(_EQ_COLOR, _EQ_COLOR_DAY, _eqT) });
      for (var j = 0; j < offsets.length; j++) {
        var x = lng + offsets[j];
        L.polyline(
          [
            [half, x],
            [-half, x],
          ],
          csCol
        ).addTo(_equatorGroup);
        L.polyline(
          [
            [half, x],
            [-half, x],
          ],
          lnCol
        ).addTo(_equatorGroup);
      }
      if (showLabels && t.ra !== 0 && t.ra !== 180) {
        var labelText = t.ra + '°';
        var tickHalo = GeoUtils.lerpHex(_EQ_CASING, _eqCasingDay, _eqT);
        var tickText = GeoUtils.lerpHex(_EQ_COLOR, _EQ_COLOR_DAY, _eqT);
        var eqTickFont = 'font-family:var(--font-serif);font-size:12px;letter-spacing:0.04em;';
        var html =
          '<span style="color:' +
          tickText +
          ';-webkit-text-stroke:5px ' +
          tickHalo +
          ';paint-order:stroke;' +
          eqTickFont +
          'transform:translateX(8px);">' +
          labelText +
          '</span>';
        for (var j2 = 0; j2 < offsets.length; j2++) {
          L.marker([0, lng + offsets[j2]], {
            pane: 'equator-labels',
            icon: L.divIcon({ className: 'equator-tick-label', html: html, iconSize: [0, 0], iconAnchor: [0, 0] }),
            interactive: false,
            keyboard: false,
          }).addTo(_equatorGroup);
        }
      }
    }

    // 1° micro-ticks (z ≥ 5), skip every 15° (already drawn above)
    if (z >= 5) {
      for (var m = 0; m < 360; m++) {
        if (m % 15 === 0) continue;
        var mLng = _eqRaToLng(m, refLng);
        var mStyle = Object.assign({}, _EQ_MICRO_TICK, {
          color: GeoUtils.lerpHex(_EQ_COLOR, _EQ_COLOR_DAY, _eqStrength(0, mLng)),
        });
        for (var j3 = 0; j3 < offsets.length; j3++) {
          var mx = mLng + offsets[j3];
          L.polyline(
            [
              [_EQ_MICRO_HALF, mx],
              [-_EQ_MICRO_HALF, mx],
            ],
            mStyle
          ).addTo(_equatorGroup);
        }
      }
    }

    // Name labels ("赤道"/"Equator") — anchored at RA midpoints, same as ecliptic
    var EQ_LABEL_RAS = [22.5, 112.5, 202.5, 292.5];
    var nameText = _t('equator.label');
    for (var k = 0; k < EQ_LABEL_RAS.length; k++) {
      var nLng = _eqRaToLng(EQ_LABEL_RAS[k], refLng);
      var _nT = _eqStrength(0, nLng);
      var nameHalo = GeoUtils.lerpHex(_EQ_CASING, _eqCasingDay, _nT);
      var nameColor = GeoUtils.lerpHex(_EQ_COLOR, _EQ_COLOR_DAY, _nT);
      var eqNameFont = 'font-family:var(--font-serif);font-size:15px;letter-spacing:0.05em;';
      var nHtml =
        '<span style="color:' +
        nameColor +
        ';-webkit-text-stroke:5px ' +
        nameHalo +
        ';paint-order:stroke;' +
        eqNameFont +
        '">' +
        nameText +
        '</span>';
      for (var j4 = 0; j4 < offsets.length; j4++) {
        L.marker([0, nLng + offsets[j4]], {
          pane: 'equator-labels',
          icon: L.divIcon({ className: 'equator-label', html: nHtml, iconSize: [80, 22], iconAnchor: [40, 11] }),
          interactive: false,
          keyboard: false,
        }).addTo(_equatorGroup);
      }
    }
  }
  _rebuildEquator(now);

  // Cross-source label overlap hider — listens to moveend/zoomend/layer
  // toggles internally; we'll also kick it from the time-tick handler below.
  if (typeof LabelCollider !== 'undefined') LabelCollider.init(map);

  const CelestialEquator = {
    addTo: function (m) {
      if (!m.hasLayer(_equatorGroup)) m.addLayer(_equatorGroup);
    },
    removeFrom: function (m) {
      if (m.hasLayer(_equatorGroup)) m.removeLayer(_equatorGroup);
    },
    isOn: function () {
      return map.hasLayer(_equatorGroup);
    },
  };

  // User-override flags: when user manually unchecks an overlay via the
  // layer-control panel, auto-show should not re-enable it until the
  // parent layer is toggled off and back on.
  let _eclipticUserOff = false;
  let _lunarPathUserOff = false;

  function _anyCelestialOn() {
    return (
      map.hasLayer(twilightGroup) ||
      (typeof Sky !== 'undefined' && Sky.getMode() !== 'off') ||
      (moonEntry && map.hasLayer(moonEntry.markerLayer)) ||
      (planetsOnlyEntries.length > 0 && map.hasLayer(planetsOnlyEntries[0].markerLayer))
    );
  }

  function refreshCelestialOverlays() {
    // Ecliptic: auto-on when sun or planets on (unless user manually unchecked)
    const wantEcl =
      map.hasLayer(twilightGroup) || (planetsOnlyEntries.length > 0 && map.hasLayer(planetsOnlyEntries[0].markerLayer));
    if (wantEcl && !_eclipticUserOff) {
      if (!Ecliptic.isOn()) {
        Ecliptic.update(TimeState.current);
        Ecliptic.addTo(map);
      }
    } else if (!wantEcl) {
      if (Ecliptic.isOn()) Ecliptic.removeFrom(map);
      _eclipticUserOff = false;
    }

    // Lunar path: auto-on when moon on (unless user manually unchecked)
    if (typeof LunarPath !== 'undefined') {
      const wantLunar = moonEntry && map.hasLayer(moonEntry.markerLayer);
      if (wantLunar && !_lunarPathUserOff) {
        if (!LunarPath.isOn()) {
          LunarPath.update(TimeState.current);
          LunarPath.addTo(map);
        }
      } else if (!wantLunar) {
        if (LunarPath.isOn()) LunarPath.removeFrom(map);
        _lunarPathUserOff = false;
      }
    }

    // Glow: mutually exclusive day/moon masks. Sun-side takes priority.
    //   Sun on              → dayMaskGroup + dayBrightenGroup; moonMaskGroup off
    //   Sun off + Moon on   → moonMaskGroup; day groups off
    //   neither, glow off, or eclipse conflict → all off
    const _eclipseMasksActive = _conflictStash.has('eclipse-masks');
    const sunOn = map.hasLayer(twilightGroup);
    const moonOn = !!(moonEntry && map.hasLayer(moonEntry.markerLayer));
    const glowOn = _glowExplicitlyOn && !_eclipseMasksActive;

    const showDay = glowOn && sunOn;
    const showMoon = glowOn && !sunOn && moonOn;

    if (showDay) {
      rebuildDayMask(TimeState.current);
      if (!dayMaskGroup._map) dayMaskGroup.addTo(map);
      if (!dayBrightenGroup._map) dayBrightenGroup.addTo(map);
    } else {
      if (dayMaskGroup._map) map.removeLayer(dayMaskGroup);
      if (dayBrightenGroup._map) map.removeLayer(dayBrightenGroup);
    }

    if (showMoon) {
      rebuildMoonMask(TimeState.current);
      if (!moonMaskGroup._map) moonMaskGroup.addTo(map);
    } else {
      if (moonMaskGroup._map) map.removeLayer(moonMaskGroup);
    }

    // syncLpClip refreshes _twilightActive + reapplies LP clipPath + calls
    // syncTwilightClips which clip-paths body labels & dim planet cores.
    syncLpClip();

    window._dayMaskVisible = !!dayMaskGroup._map;

    // Rebuild visible grids so label halos reflect mask visibility
    const _d = TimeState.current;
    if (Ecliptic.isOn()) Ecliptic.update(_d);
    if (typeof LunarPath !== 'undefined' && LunarPath.isOn()) LunarPath.update(_d);
    if (typeof GalacticEquator !== 'undefined' && GalacticEquator.isOn()) GalacticEquator.update(_d);
    if (CelestialEquator.isOn()) _rebuildEquator(_d);

    // Sync overlay checkboxes
    _syncOverlayCheckboxes();
  }

  map.on('zoomend', function () {
    Planets.updateMarkerSizes(map, planetEntries);

    // Rebuild sun marker (disk size depends on zoom via footprintPx)
    const date = typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date();
    const ss = computeSubsolarPoint(date);
    const sunVis = buildSunOpts(map.getZoom(), ss.lat);
    placeWrappedLumBody(
      ss.lat,
      ss.lng,
      sunVis.coreOpts,
      sunVis.glowSpec,
      sunVis.diskHtml,
      subsolarGroup,
      _t('map.celestial.sun'),
      onSunLeftClick,
      onSunContextMenu,
      null
    );

    // Ecliptic tick density & solar-term names are zoom-tiered.
    if (Ecliptic.isOn()) Ecliptic.update(date);
    if (typeof LunarPath !== 'undefined' && LunarPath.isOn()) LunarPath.update(date);
    if (typeof GalacticEquator !== 'undefined' && GalacticEquator.isOn()) GalacticEquator.update(date);
    if (CelestialEquator.isOn()) _rebuildEquator(date);
    refreshTimeMasks(date);
  });

  // v3.1: ecliptic / lunar-path / galactic-equator now viewport-clip their
  // wrap copies in _visibleOffsets(), so panning into a new world copy must
  // re-trigger their update() — otherwise the polylines stay anchored to
  // the previous viewport's wraps and look like they "disappeared" until
  // the user toggles the layer off→on. Constellation lines (sky.js) already
  // handle this in their own moveend handler; here we cover the rest.
  //
  // Perf: pan that stays within the SAME wrap set should NOT rebuild — each
  // .update() is 20–50ms (rebuilds hundreds of polylines). Compare the wrap
  // set to its last value and short-circuit when identical. This makes
  // intra-wrap drags feel as light as before; only crossings pay the cost.
  let _lastWrapsKey = '';
  map.on('moveend', function () {
    const wraps = visibleWrapsFromBounds(map);
    const key = wraps.join(',');
    if (key === _lastWrapsKey) return;
    _lastWrapsKey = key;
    const d = typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date();
    if (Ecliptic.isOn()) Ecliptic.update(d);
    if (typeof LunarPath !== 'undefined' && LunarPath.isOn()) LunarPath.update(d);
    if (typeof GalacticEquator !== 'undefined' && GalacticEquator.isOn()) GalacticEquator.update(d);
    // v6: planets/sun/moon also place via placeWrappedLumBody → wraps depend
    // on viewport. Without rebuild here, cross-wrap pan leaves the body's old
    // wrap copy stale and the new wrap copy absent. Same bug pattern as the
    // ecliptic v3.1 fix above, just for body markers. Gated by wraps-key so
    // intra-wrap pans (the common case) pay 0 cost.
    Planets.updateMarkers(map, planetEntries, d);
    const ss = computeSubsolarPoint(d);
    const sunVis = buildSunOpts(map.getZoom(), ss.lat);
    placeWrappedLumBody(
      ss.lat,
      ss.lng,
      sunVis.coreOpts,
      sunVis.glowSpec,
      sunVis.diskHtml,
      subsolarGroup,
      _t('map.celestial.sun'),
      onSunLeftClick,
      onSunContextMenu,
      null
    );
    refreshTimeMasks(d);
  });

  // High-zoom only: the veil cap is densified to the viewport, so an intra-wrap
  // pan — which the wrap-keyed handler above skips — must still rebuild to
  // recenter the dense arc. refreshTimeMasks' viewport bucket caps this at one
  // rebuild per ~tile of pan; below VEIL_DENSIFY_ZOOM there is nothing to recenter.
  map.on('moveend', function () {
    if (map.getZoom() < VEIL_DENSIFY_ZOOM) return;
    refreshTimeMasks(typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date());
  });

  // Arm LP night-side clipping (twilight is on by default).
  syncLpClip();

  // Day-mode setter: toggles the body class (for the CSS screen-blend
  // rule on .star-glow / .star-glare), forwards the flag to Planets, and
  // forces one redraw of sun + planets so the new tinted halos take effect
  // immediately instead of waiting for the next time/zoom tick.
  function _setDayMode(active) {
    active = !!active;
    if (_dayModeActive === active) return;
    _dayModeActive = active;
    document.body.classList.toggle('day-mask-active', active);
    // dayMaskGroup and dayBrightenGroup are twilightGroup children — they follow
    // the Sun button and are not separately managed here.
    if (typeof Planets !== 'undefined' && Planets.setDayMode) {
      Planets.setDayMode(active);
    }
    // Sky pane reads body.day-mask-active for star mag cutoff + line opacity;
    // it must re-apply now that the class flipped.
    if (typeof Sky !== 'undefined' && Sky.refreshDayMode) {
      Sky.refreshDayMode();
    }
    const date = TimeState.current;
    const ss = computeSubsolarPoint(date);
    const sunVis = buildSunOpts(map.getZoom(), ss.lat);
    placeWrappedLumBody(
      ss.lat,
      ss.lng,
      sunVis.coreOpts,
      sunVis.glowSpec,
      sunVis.diskHtml,
      subsolarGroup,
      _t('map.celestial.sun'),
      onSunLeftClick,
      onSunContextMenu,
      null
    );
    if (typeof Planets !== 'undefined') Planets.updateMarkers(map, planetEntries, date);
  }

  function _rebuildGridLabels() {
    var _d = typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date();
    if (Ecliptic.isOn()) Ecliptic.update(_d);
    if (typeof LunarPath !== 'undefined' && LunarPath.isOn()) LunarPath.update(_d);
    if (typeof GalacticEquator !== 'undefined' && GalacticEquator.isOn()) GalacticEquator.update(_d);
    if (CelestialEquator.isOn()) _rebuildEquator(_d);
  }
  map.on('overlayadd', function (e) {
    if (e.layer === twilightGroup) {
      syncLpClip();
      _rebuildGridLabels();
    }
    if (e.layer === dayMaskGroup) _setDayMode(true);
  });
  map.on('overlayremove', function (e) {
    if (e.layer === twilightGroup) {
      syncLpClip();
      _rebuildGridLabels();
    }
    if (e.layer === dayMaskGroup) _setDayMode(false);
  });

  // dayMaskGroup is a twilightGroup child — listen to layeradd/layerremove
  // on the group itself for complete _setDayMode coverage.
  map.on('layeradd', function (e) {
    if (e.layer === dayMaskGroup) _setDayMode(true);
  });
  map.on('layerremove', function (e) {
    if (e.layer === dayMaskGroup) _setDayMode(false);
  });

  // Sync all terminator layers on every time change.
  TimeState.subscribe((date) => {
    // Update subsolar point (sun marker).
    const ss = computeSubsolarPoint(date);

    const sunVis = buildSunOpts(map.getZoom(), ss.lat);
    placeWrappedLumBody(
      ss.lat,
      ss.lng,
      sunVis.coreOpts,
      sunVis.glowSpec,
      sunVis.diskHtml,
      subsolarGroup,
      _t('map.celestial.sun'),
      onSunLeftClick,
      onSunContextMenu,
      null
    );
    currentSSLat = ss.lat;

    // Sun visibility-range — bold 0° boundary + golden fill.
    // PRESERVED FOR LATER — old per-6° altitude grid loop (see comment
    // around contourLinesGroup creation above).
    contourLinesGroup.clearLayers();
    contourLabelsGroup.clearLayers();
    contourFillGroup.clearLayers();
    drawVisibilityRange(antiSunPoint(date), SUN_VIS_CFG, SUN_VIS_MAG, contourLinesGroup, contourFillGroup, {
      altThreshold: sunHorizonDeg(date),
    });

    // Rebuild day-side white veil to track the subsolar point.
    // refreshTimeMasks also re-renders the moonlight mask independently,
    // so it stays in sync with time even when daylight mask is off.
    refreshTimeMasks(date);

    Planets.updateContours(map, planetEntries, date);
    Planets.updateMarkers(map, planetEntries, date);
    // Refresh generic celestial vis range (stars/DSOs/comets/meteors) if active.
    if (activeContourLayer === genericVisContourGroup && _currentGenericVis) {
      _rebuildGenericVis(_currentGenericVis.ra, _currentGenericVis.dec, date);
    }
    updateInnerBodyZOrder(date);
    if (Ecliptic.isOn()) Ecliptic.update(date);
    if (typeof LunarPath !== 'undefined' && LunarPath.isOn()) LunarPath.update(date);
    if (typeof GalacticEquator !== 'undefined' && GalacticEquator.isOn()) GalacticEquator.update(date);
    if (CelestialEquator.isOn()) _rebuildEquator(date);
    syncLpClip(); // also re-applies twilight clip-paths
    _refreshDimPlanetClips(); // re-evaluate dim-planet visibility after mag/illum changes
    if (typeof LabelCollider !== 'undefined') LabelCollider.schedule();
  });

  // ---- Light Pollution Layer ----
  // mix-blend-mode: screen (via .lp-blend-screen class) makes city lights add
  // additively over the dark basemap, mirroring Lorenz's own black-bg site.
  const lpLayer = L.tileLayer(LORENZ_TILES, {
    pane: 'lp',
    attribution: 'Light pollution: <a href="https://djlorenz.github.io/astronomy/lp/">D.J. Lorenz 2024</a> (VIIRS)',
    opacity: 0.65,
    minZoom: 2,
    maxNativeZoom: 8,
    maxZoom: 19,
    tileSize: 1024,
    zoomOffset: -2,
    className: 'lp-blend-screen',
    errorTileUrl: 'https://djlorenz.github.io/astronomy/image_tiles/tiles2024/black.png',
  });

  // LP off by default (Uranometria spec: only stars on)

  // Layer control (basemaps only). Canonical product names so users can
  //     match what they see in tile-server documentation.
  const layerControl = L.control
    .layers(
      {
        'CARTO Dark Matter': baseDarkGroup,
        'Stadia Alidade Smooth Dark': baseStadiaSmoothDark,
      },
      null,
      { position: 'topright' }
    )
    .addTo(map);

  // Re-theme Leaflet's built-in control tooltips from the white native `title`.
  // Zoom ± get a localized dark data-tip chip (js/glossary-tip.js), refreshed on
  // language change. The layers toggle shows NO tip (the icon is self-evident) —
  // we just strip its native title. The attribution prefix link is handled below.
  (function themeLeafletControlTips() {
    const container = map.getContainer();
    // Layers toggle: no tip — strip the English native title, set nothing.
    container.querySelectorAll('.leaflet-control-layers-toggle').forEach((el) => {
      el.removeAttribute('title');
      delete el.dataset.tip;
    });
    // Zoom in/out: localized data-tip, re-applied whenever the locale changes
    // (Leaflet bakes the English title in at build time and never re-localizes).
    function applyZoomTips() {
      const tt = (k) => (typeof I18n !== 'undefined' ? I18n.t(k) : k);
      const inBtn = container.querySelector('.leaflet-control-zoom-in');
      const outBtn = container.querySelector('.leaflet-control-zoom-out');
      if (inBtn) {
        inBtn.dataset.tip = tt('map.zoom_in');
        inBtn.removeAttribute('title');
      }
      if (outBtn) {
        outBtn.dataset.tip = tt('map.zoom_out');
        outBtn.removeAttribute('title');
      }
    }
    applyZoomTips();
    if (typeof I18n !== 'undefined' && I18n.subscribe) I18n.subscribe(applyZoomTips);
    // The attribution prefix link is rebuilt on every attribution _update(), so
    // swap title→data-tip at the source (the stored prefix) to make it durable.
    const ac = map.attributionControl;
    const p = ac && ac.options && ac.options.prefix;
    if (ac && typeof ac.setPrefix === 'function' && typeof p === 'string' && /\stitle=/.test(p)) {
      ac.setPrefix(p.replace(/(\s)title=(["'])/, '$1data-tip=$2'));
    }
  })();

  // Delayed collapse — gives users time to cross the margin gap between
  // the toggle button and the dropdown list.
  (function () {
    const ctn = layerControl.getContainer();
    let collapseTimer = null;
    ctn.addEventListener('mouseenter', function () {
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
    });
    ctn.addEventListener('mouseleave', function () {
      collapseTimer = setTimeout(function () {
        layerControl.collapse();
      }, 300);
    });
    // Prevent Leaflet's default immediate collapse
    L.DomEvent.off(ctn, 'mouseleave', layerControl.collapse, layerControl);
    L.DomEvent.off(ctn, 'mouseout', layerControl.collapse, layerControl);
    // Also listen on the list itself to cancel collapse when hovering the dropdown
    const list = ctn.querySelector('.leaflet-control-layers-list');
    if (list) {
      list.addEventListener('mouseenter', function () {
        if (collapseTimer) {
          clearTimeout(collapseTimer);
          collapseTimer = null;
        }
      });
    }
  })();

  // ---- Section Titles and Celestial Overlay Checkboxes in the Layer-Control Dropdown ----
  let _overlaySection = null;
  let _lightingGroupEl = null;
  let _eclipticCb = null,
    _lunarPathCb = null,
    _equatorCb = null,
    _galacticEquatorCb = null;
  let _glowCb = null;
  let _overlaysConfig = null;
  (function () {
    const list = layerControl.getContainer().querySelector('.leaflet-control-layers-list');
    if (!list) return;
    const _t =
      typeof I18n !== 'undefined'
        ? I18n.t.bind(I18n)
        : function (k) {
            return k;
          };

    // Helper: create a section title element
    function makeTitle(i18nKey) {
      const el = document.createElement('div');
      el.className = 'layer-section-title';
      el.dataset.i18nKey = i18nKey;
      el.textContent = _t(i18nKey);
      return el;
    }

    // "Base Map" title — inserted before the native base-layer radio buttons
    const baseDiv = list.querySelector('.leaflet-control-layers-base');
    if (baseDiv) list.insertBefore(makeTitle('layerctrl.basemap'), baseDiv);

    // Outer wrapper for all celestial overlay groups (controls show/hide)
    const section = (_overlaySection = document.createElement('div'));
    section.className = 'celestial-overlays';
    section.style.display = 'none';

    const overlays = (_overlaysConfig = [
      { key: 'overlay.ecliptic', color: '#c9a86a', dash: false, group: 'grids' },
      { key: 'overlay.equator', color: '#7682a0', dash: false, group: 'grids' },
      { key: 'overlay.lunar_path', color: '#9fb4c4', dash: true, group: 'grids' },
      { key: 'overlay.galactic_equator', color: '#b09cc4', dash: true, group: 'grids' },
      {
        key: 'overlay.glow',
        dash: false,
        group: 'lighting',
        labelFn: () => _t('overlay.twilight_mask') + ' / ' + _t('overlay.moonlight_mask'),
        swatchStyle: 'linear-gradient(to right, #f5f2ee 0 50%, #eef2f5 50% 100%)',
      },
    ]);

    // Build sub-group containers
    const groups = {
      grids: { titleKey: 'layerctrl.grids', el: document.createElement('div') },
      lighting: { titleKey: 'layerctrl.lighting', el: document.createElement('div') },
    };
    for (const g of Object.values(groups)) {
      g.el.className = 'celestial-overlays overlay-group';
      g.el.appendChild(makeTitle(g.titleKey));
      section.appendChild(g.el);
    }
    _lightingGroupEl = groups.lighting.el;

    const cbs = [];
    for (const o of overlays) {
      const row = document.createElement('div');
      row.className = 'celestial-overlay-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.overlayKey = o.key;
      const swatch = document.createElement('span');
      swatch.className = 'overlay-swatch';
      if (o.swatchStyle) {
        swatch.style.background = o.swatchStyle;
        swatch.style.height = '8px';
        swatch.style.borderRadius = '1px';
      } else {
        const sw = o.dash ? '2px dashed ' + o.color : '2px solid ' + o.color;
        swatch.style.borderBottom = sw;
      }
      const span = document.createElement('span');
      span.className = 'overlay-label-text';
      span.textContent = o.labelFn ? o.labelFn() : _t(o.key);
      row.appendChild(cb);
      row.appendChild(swatch);
      row.appendChild(span);
      row.addEventListener('click', function (e) {
        if (e.target !== cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      groups[o.group].el.appendChild(row);
      cbs.push(cb);
    }
    _eclipticCb = cbs[0];
    _equatorCb = cbs[1];
    _lunarPathCb = cbs[2];
    _galacticEquatorCb = cbs[3];
    _glowCb = cbs[4];

    _eclipticCb.addEventListener('change', function () {
      if (this.checked) {
        _eclipticUserOff = false;
        Ecliptic.update(TimeState.current);
        Ecliptic.addTo(map);
      } else {
        _eclipticUserOff = true;
        Ecliptic.removeFrom(map);
      }
    });
    _lunarPathCb.addEventListener('change', function () {
      if (typeof LunarPath === 'undefined') return;
      if (this.checked) {
        _lunarPathUserOff = false;
        LunarPath.update(TimeState.current);
        LunarPath.addTo(map);
      } else {
        _lunarPathUserOff = true;
        LunarPath.removeFrom(map);
      }
    });
    _equatorCb.addEventListener('change', function () {
      if (this.checked) {
        _rebuildEquator(TimeState.current);
        CelestialEquator.addTo(map);
      } else {
        CelestialEquator.removeFrom(map);
      }
    });
    _galacticEquatorCb.addEventListener('change', function () {
      if (typeof GalacticEquator === 'undefined') return;
      if (this.checked) {
        GalacticEquator.update(TimeState.current);
        GalacticEquator.addTo(map);
      } else {
        GalacticEquator.removeFrom(map);
      }
    });
    _glowCb.addEventListener('change', function () {
      _glowExplicitlyOn = this.checked;
      refreshCelestialOverlays();
    });

    list.appendChild(section);
    L.DomEvent.disableClickPropagation(section);
    section.addEventListener('change', function (e) {
      e.stopPropagation();
    });
  })();

  function _syncOverlayCheckboxes() {
    if (_eclipticCb) _eclipticCb.checked = Ecliptic.isOn();
    if (_lunarPathCb) _lunarPathCb.checked = typeof LunarPath !== 'undefined' && LunarPath.isOn();
    if (_equatorCb) _equatorCb.checked = CelestialEquator.isOn();
    if (_galacticEquatorCb)
      _galacticEquatorCb.checked = typeof GalacticEquator !== 'undefined' && GalacticEquator.isOn();
    if (_glowCb) _glowCb.checked = _glowExplicitlyOn;
    if (_overlaySection) {
      _overlaySection.style.display = _anyCelestialOn() ? '' : 'none';
    }
    if (_lightingGroupEl) {
      const sunOn = map.hasLayer(twilightGroup);
      const moonOn = !!(moonEntry && map.hasLayer(moonEntry.markerLayer));
      _lightingGroupEl.style.display = sunOn || moonOn ? '' : 'none';
    }
    if (typeof I18n !== 'undefined' && _overlaysConfig && _overlaySection) {
      const items = _overlaySection.querySelectorAll('.overlay-label-text');
      for (let i = 0; i < items.length && i < _overlaysConfig.length; i++) {
        const o = _overlaysConfig[i];
        items[i].textContent = o.labelFn ? o.labelFn() : I18n.t(o.key);
      }
      // Refresh section titles (basemap title lives outside _overlaySection)
      const list = layerControl.getContainer().querySelector('.leaflet-control-layers-list');
      if (list) {
        for (const el of list.querySelectorAll('.layer-section-title[data-i18n-key]')) {
          el.textContent = I18n.t(el.dataset.i18nKey);
        }
      }
    }
  }

  // Manage multiply overlays when basemap changes
  function applyBasemapOverlays(name) {
    const isStadiaDark = name.includes('Stadia') && name.includes('Dark');
    const isCartoDark = name.includes('CARTO Dark');
    mulTileEl.style.display = isStadiaDark ? '' : 'none';
    mulEl.style.display = isCartoDark ? '' : 'none';
  }
  applyBasemapOverlays('CARTO Dark Matter');
  map.on('baselayerchange', function (e) {
    applyBasemapOverlays(e.name);
  });

  // ---- Cloud Layer ----
  const cloudsCtl = Clouds.init(map);

  // ---- Eclipse Layer ----
  const eclipseCtl = typeof Eclipse !== 'undefined' ? Eclipse.init(map) : null;

  // ---- Declarative Layer Conflict System ----
  // Rules are implicit (hidden from user). When a trigger layer activates,
  // victim layers are auto-closed/hidden. Checkbox rows for overlay-type
  // victims are hidden from the right-panel dropdown.
  const LAYER_CONFLICTS = [
    // TEMPORARILY DISABLED: let the day/moon glow masks coexist with the
    // Eclipses overlay so the lunar-eclipse red moonlight veil stays visible
    // while the Eclipses layer is on. Re-enable to restore mutual exclusion.
    // { id: 'eclipse-masks',   trigger: 'eclipse', victims: ['glow'], type: 'hide-overlay' },
    // Eclipse suppresses constellation/xingguan overlays (lines, bounds, labels)
    { id: 'eclipse-sky-ovl', trigger: 'eclipse', victims: ['constellation_overlays'], type: 'suppress' },
    // Stars and light pollution are mutually exclusive
    { id: 'sky-lp', trigger: 'sky', victims: ['lp'], type: 'mutual' },
    { id: 'lp-sky', trigger: 'lp', victims: ['sky'], type: 'mutual' },
  ];

  const _conflictStash = new Map();
  let _enforcingConflicts = false;

  function _isLayerActive(key) {
    if (key === 'eclipse')
      return eclipseCtl && (map.hasLayer(eclipseCtl.soloLayer) || map.hasLayer(eclipseCtl.eclipseListLayer));
    if (key === 'sky') return typeof Sky !== 'undefined' && Sky.getMode() !== 'off';
    if (key === 'lp') return map.hasLayer(lpLayer);
    if (key === 'glow')
      return _glowExplicitlyOn && (map.hasLayer(twilightGroup) || !!(moonEntry && map.hasLayer(moonEntry.markerLayer)));
    if (key === 'constellation_overlays') return typeof Sky !== 'undefined' && Sky.getMode() !== 'off';
    return false;
  }

  function _captureState(key) {
    if (key === 'glow') return { explicitlyOn: _glowExplicitlyOn };
    if (key === 'constellation_overlays') return {};
    if (key === 'lp') return { onMap: map.hasLayer(lpLayer) };
    if (key === 'sky') return { mode: typeof Sky !== 'undefined' ? Sky.getMode() : 'off' };
    return {};
  }

  function _deactivateLayer(key) {
    if (key === 'glow') {
      _glowExplicitlyOn = false;
      refreshCelestialOverlays();
    } else if (key === 'constellation_overlays') {
      if (typeof Sky !== 'undefined') Sky.suppressOverlays();
    } else if (key === 'lp') {
      if (map.hasLayer(lpLayer)) map.removeLayer(lpLayer);
    } else if (key === 'sky') {
      if (typeof Sky !== 'undefined') {
        Sky.setMode('off', { skipAnim: true });
        if (toggleCtrl && toggleCtrl._skyBtn) {
          toggleCtrl._skyBtn.dataset.skyState = 'off';
          toggleCtrl._skyBtn.setAttribute('aria-pressed', 'false');
        }
        if (typeof Asterism !== 'undefined') Asterism.hide();
        refreshCelestialOverlays();
      }
    }
  }

  function _restoreLayer(key, saved) {
    if (key === 'glow') {
      _glowExplicitlyOn = saved.explicitlyOn;
      refreshCelestialOverlays();
    } else if (key === 'constellation_overlays') {
      if (typeof Sky !== 'undefined') Sky.restoreOverlays();
    }
    // 'lp' and 'sky' are mutual-exclude victims — not restored on trigger-off
  }

  function _getOverlayRow(victimKey) {
    if (!_overlaySection) return null;
    const overlayKey = 'overlay.' + victimKey;
    const cbs = _overlaySection.querySelectorAll('input[type="checkbox"]');
    for (const cb of cbs) {
      if (cb.dataset.overlayKey === overlayKey) return cb.closest('.celestial-overlay-item');
    }
    return null;
  }

  function enforceConflicts(changedKey, isNowOn) {
    if (_enforcingConflicts) return;
    _enforcingConflicts = true;
    try {
      for (const rule of LAYER_CONFLICTS) {
        if (rule.trigger !== changedKey) continue;
        if (isNowOn && !_conflictStash.has(rule.id)) {
          // Trigger just activated — save victim state and suppress
          const saved = {};
          for (const victim of rule.victims) {
            saved[victim] = _captureState(victim);
            _deactivateLayer(victim);
            if (rule.type === 'hide-overlay') {
              const row = _getOverlayRow(victim);
              if (row) row.style.display = 'none';
            }
          }
          if (rule.type !== 'mutual') _conflictStash.set(rule.id, saved);
        } else if (!isNowOn && _conflictStash.has(rule.id)) {
          // Trigger deactivated — restore victims
          const saved = _conflictStash.get(rule.id);
          _conflictStash.delete(rule.id);
          for (const victim of rule.victims) {
            if (rule.type === 'hide-overlay') {
              const row = _getOverlayRow(victim);
              if (row) row.style.display = '';
            }
            _restoreLayer(victim, saved[victim]);
          }
          // Re-sync checkbox checked states after restoration (they may have
          // been set before the restore ran, leaving a stale false state)
          _syncOverlayCheckboxes();
        }
      }
      // After any mutual deactivation, sync button pressed states
      if (isNowOn) toggleCtrl && toggleCtrl._update && toggleCtrl._update();
    } finally {
      _enforcingConflicts = false;
    }
  }

  // ---- Custom Toggle Buttons for Twilight and Light-Pollution Overlays ----
  // Icon-only buttons; text label removed for uniform width across locales.
  // Themed name-hint (data-tip → glossary-tip.js) and aria-label provide the
  // translated layer name.
  function makeLayerBtn(opts) {
    const btn = L.DomUtil.create('button', 'layer-btn');
    btn.type = 'button';
    btn.dataset.layer = opts.id;
    btn.dataset.tip = opts.title;
    btn.setAttribute('aria-label', opts.ariaLabel || opts.title);
    btn.setAttribute('aria-pressed', 'false');
    if (opts.symbol) {
      btn.innerHTML = '<span class="planet-symbol" aria-hidden="true">' + opts.symbol + '</span>';
    } else {
      btn.innerHTML = '<span class="layer-icon" aria-hidden="true">' + (opts.iconHtml || '') + '</span>';
    }
    return btn;
  }

  // Lapidary v4 glyphs — Unicode astronomical symbols for the layer rail
  const GLYPH_SKY = '✶';
  const GLYPH_SUN = '☉';
  const GLYPH_MOON = '☾';
  const GLYPH_PLANETS = '♃';
  const GLYPH_CLOUD = '☁';
  const GLYPH_ECLIPSE = '☊';

  // Lapidary v5 SVG icons — designed in 40-unit viewBox, rendered at button size via CSS.
  // Proportions mimic Noto Sans Symbols 2 (~70% shape, thin strokes), but vectorized for
  // theming (currentColor) and pixel-independent fidelity.
  const SVG_SUN =
    '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="14" stroke-width="3"/><circle cx="20" cy="20" r="3" fill="currentColor" stroke="none"/></svg>';
  // Moon crescent = circle A (outer, r=16 @ (24,20)) minus circle B (inner cut, r=14 @ (32,20)).
  // Both arcs MUST bulge left: arc 1 goes top→bot with sweep=0 (CCW screen), arc 2 reverses bot→top
  // so it needs sweep=1 to also bulge left. Using sweep=0 on both = lens/blob shape (the bug).
  const SVG_MOON =
    '<svg viewBox="0 0 40 40" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M31.75 6 A16 16 0 1 0 31.75 34 A14 14 0 1 1 31.75 6 Z"/></svg>';
  // Satellite: 3 perpendicular rectangles (body long-axis + 2 wings) all centered on (20, 20)
  // so the icon is mirror-symmetric about both its long and short axes; the whole group is
  // then rotated 35° around (20, 20), which preserves the symmetry (the axes rotate with it).
  // Wings outlined (stroke), body filled and drawn last to cover wing-stubs at the join.
  const SVG_SAT =
    '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(35 20 20)"><rect x="3" y="19" width="10" height="12" rx="1"/><rect x="27" y="19" width="10" height="12" rx="1"/><rect x="14" y="11" width="12" height="28" rx="1"/></g></svg>';
  // Sourced from files/aurora.svg: two evenodd subpaths render the upper arch and lower ribbon
  // of an aurora curtain as filled stroke-less shapes.
  const SVG_AURORA =
    '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><path d="M20.000 6.593 C 14.495 6.176,8.933 8.439,5.018 13.254 C 2.355 17.020,0.680 22.092,1.988 21.456 C 3.385 20.045,5.358 18.707,8.561 17.057 C 14.937 12.207,25.063 12.207,31.439 17.057 C 34.642 18.707,36.615 20.045,38.012 21.456 C 39.320 22.092,37.645 17.020,34.982 13.254 C 31.067 8.439,25.505 6.176,20.000 6.593 M2.692 26.701 C 0.161 27.356,0.900 30.853,4.067 33.208 C 12.488 39.470,37.394 36.914,38.824 29.641 C 39.097 28.252,38.733 28.151,36.509 28.997 C 32.557 30.499,28.579 30.221,22.260 28.000 C 16.928 26.126,7.361 25.491,2.692 26.701" fill="currentColor" stroke="none" fill-rule="evenodd"/></svg>';
  // Saturn-style planet: r=9 disc + tilted (rx=15, ry=4) ring.
  // Single elliptical arc traces the VISIBLE portion of the ring: from upper-left intersection
  // with the disc (11.635, 16.68), wrapping CCW via left tip → bottom → right tip, to the
  // upper-right intersection (28.365, 16.68). Back-top of ring is omitted (hidden behind disc).
  // -15° rotation tilts the ring with right side up; rotation preserves disc-arc intersections.
  // r=13 planet; ring a=21.67 b=5.78 (scaled 13/9 from r=9 design); intersections at (7.92,15.21) & (32.08,15.21).
  const SVG_PLANETS =
    '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="13"/><g transform="rotate(-15 20 20)"><path d="M7.92 15.21 A21.67 5.78 0 1 0 32.08 15.21"/></g></svg>';
  // Eclipse: two equal r=11 circles overlapping diagonally (lower-left & upper-right),
  // centers offset by (10,-8) → distance 12.81, overlap depth ~9.2 (42% diameter).
  // Both centered around (20,20). B drawn after A, so B's stroke covers A at intersections.
  const SVG_ECLIPSE =
    '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><circle cx="15" cy="24" r="13" fill="currentColor" stroke="none"/><circle cx="25" cy="16" r="11"/></svg>';
  // Sky/constellation: Aries (♈) silhouette from files/aries.svg (568×540 source).
  // Scaled uniformly by 0.85 × 40/568 ≈ 0.05986 (85% of the fill-to-viewBox size) and
  // translated so the actual path bbox (x≈0.535, y=2, w≈567.28, h≈536.04) is centered
  // at (20, 20) in the 40×40 viewBox. fill-rule=evenodd preserves the inner horn-curl
  // voids from the original artwork.
  const SVG_SKY =
    '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><g transform="translate(3.99 3.84) scale(0.0598591)" fill="currentColor" fill-rule="evenodd"><path d="M81.000 3.936 C 63.356 7.663,47.045 16.756,33.768 30.269 C 17.355 46.971,6.878 67.533,2.311 92.000 C -0.072 104.764,-0.054 131.693,2.345 145.000 C 6.282 166.837,12.047 183.915,23.527 207.750 L 30.872 223.000 53.467 223.000 C 73.643 223.000,76.131 222.821,76.703 221.332 C 77.055 220.414,76.533 218.276,75.542 216.582 C 61.371 192.333,51.148 164.819,47.953 142.324 C 46.142 129.573,47.196 103.458,49.944 93.000 C 57.837 62.960,77.108 44.972,101.355 45.012 C 113.869 45.033,123.779 48.865,136.727 58.692 C 172.613 85.927,209.906 166.509,231.506 263.491 C 250.473 348.647,261.000 439.522,261.000 518.100 L 261.000 538.038 283.750 537.769 L 306.500 537.500 306.702 520.500 C 307.150 482.759,309.727 436.088,313.023 406.000 C 322.216 322.086,337.086 246.975,356.181 188.003 C 374.218 132.302,402.566 80.387,427.000 58.313 C 457.057 31.159,494.639 37.342,511.367 72.192 C 518.130 86.281,520.155 95.471,520.740 114.736 C 521.293 132.907,520.351 141.577,515.980 158.559 C 512.070 173.749,506.228 188.897,497.817 205.654 C 493.608 214.038,490.962 220.458,491.325 221.404 C 491.860 222.798,494.710 223.000,513.897 223.000 C 532.070 223.000,536.115 222.742,537.355 221.502 C 541.460 217.397,554.961 185.792,560.018 168.449 C 576.747 111.076,566.303 59.696,531.262 26.971 C 513.266 10.165,491.927 2.000,466.000 2.000 C 425.880 2.000,391.461 24.183,361.271 69.500 C 320.633 130.498,294.760 221.195,285.461 335.250 C 285.114 339.512,284.450 343.000,283.987 343.000 C 283.136 343.000,282.915 341.427,280.965 321.500 C 271.207 221.792,247.575 137.810,212.869 79.500 C 190.889 42.572,163.397 16.818,136.014 7.505 C 119.202 1.787,97.761 0.396,81.000 3.936"/></g></svg>';
  // Sourced from files/lp.svg: single evenodd compound path renders the lantern silhouette
  // in one filled stroke-less shape.
  const SVG_LP =
    '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><path d="M15.040 4.452 C 14.377 5.251,13.988 6.713,14.176 7.702 C 14.651 10.211,21.922 10.827,23.622 8.502 C 24.725 6.994,25.077 6.988,27.883 8.439 C 32.481 10.817,33.097 12.869,32.784 24.748 L 32.500 35.500 29.089 26.000 C 24.708 13.800,23.287 11.000,21.474 11.000 C 19.735 11.000,19.660 11.436,20.998 13.764 C 21.547 14.719,23.552 19.887,25.455 25.250 L 28.914 35.000 18.614 35.000 L 8.315 35.000 11.650 25.250 C 13.484 19.887,15.438 14.719,15.992 13.764 C 17.341 11.439,17.267 11.000,15.526 11.000 C 13.712 11.000,12.259 13.864,8.039 25.750 C 5.145 33.902,4.473 35.000,2.377 35.000 L 0.000 35.000 L 0.000 38.000 L 40.000 38.000 L 40.000 35.000 L 38.000 35.000 C 36.117 35.000,36.000 34.333,36.000 23.577 C 36.000 12.834,35.850 11.975,33.486 9.166 C 29.335 4.233,17.691 1.257,15.040 4.452" fill="currentColor" stroke="none" fill-rule="evenodd"/></svg>';
  const GLYPH_LP = '☆';
  const GLYPH_AURORA = '☍';
  const GLYPH_SAT = '⊛';

  const LayerToggleControl = L.Control.extend({
    options: { position: 'topleft' },

    onAdd: function () {
      const container = L.DomUtil.create('div', 'layer-toggle-control');

      // ---- Sun Button (id stays 'twilight' for legacy compass / variable refs) ----
      const _t =
        typeof I18n !== 'undefined'
          ? I18n.t.bind(I18n)
          : function (k) {
              return k;
            };
      const twBtn = (this._twBtn = makeLayerBtn({
        id: 'twilight',
        title: _t('layer.sun'),
        iconHtml: SVG_SUN,
      }));
      L.DomEvent.on(twBtn, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        if (map.hasLayer(twilightGroup)) {
          map.removeLayer(twilightGroup);
          // Still clean up the contour layer if it happens to be
          // showing — the button "off" should leave no orphans.
          if (map.hasLayer(twilightContourGroup)) map.removeLayer(twilightContourGroup);
          if (activeContourLayer === twilightContourGroup) activeContourLayer = null;
        } else {
          // Only enable the marker layer; contour is opt-in via
          // clicking the Sun marker (activateSunMode).
          map.addLayer(twilightGroup);
          // OFF→ON: auto-reset glow so the user always gets daylight back
          // when reopening the Sun layer (skip while eclipse is suppressing).
          if (!_conflictStash.has('eclipse-masks')) _glowExplicitlyOn = true;
        }
        refreshCelestialOverlays();
      });

      // ---- Moon Button (Its Own Toggle; Click Marker to Show Altitude Contour) ----
      if (moonEntry) {
        const moonBtn = (this._moonBtn = makeLayerBtn({
          id: 'moon',
          title: _t('layer.moon'),
          iconHtml: SVG_MOON,
        }));
        L.DomEvent.on(moonBtn, 'click', function (e) {
          L.DomEvent.preventDefault(e);
          L.DomEvent.stopPropagation(e);
          if (map.hasLayer(moonEntry.markerLayer)) {
            map.removeLayer(moonEntry.markerLayer);
            // Still clean up contour if showing — no orphans.
            if (map.hasLayer(moonEntry.contourLayer)) map.removeLayer(moonEntry.contourLayer);
            if (activeContourLayer === moonEntry.contourLayer) activeContourLayer = null;
          } else {
            // Marker only — contour is opt-in via clicking the moon
            // marker (activateBodyMode). Same UX as planets now.
            map.addLayer(moonEntry.markerLayer);
            Planets.updateMarkers(map, planetEntries, TimeState.current);
            // OFF→ON: auto-reset glow so moonlight (or daylight if Sun is on)
            // comes back when reopening the Moon layer.
            if (!_conflictStash.has('eclipse-masks')) _glowExplicitlyOn = true;
          }
          // refreshCelestialOverlays() centrally manages moonMaskGroup
          // add/remove via the glow precedence logic.
          refreshCelestialOverlays();
        });
      }

      // ---- Planets Button (Combined Mercury–Saturn; Markers Only, Contour on Click) ----
      const planetsBtn = (this._planetsBtn = makeLayerBtn({
        id: 'planets',
        title: _t('layer.planets'),
        iconHtml: SVG_PLANETS,
      }));
      L.DomEvent.on(planetsBtn, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        const isOn = planetsOnlyEntries.length > 0 && map.hasLayer(planetsOnlyEntries[0].markerLayer);
        if (isOn) {
          for (var i = 0; i < planetsOnlyEntries.length; i++) {
            var ent = planetsOnlyEntries[i];
            if (map.hasLayer(ent.markerLayer)) map.removeLayer(ent.markerLayer);
            if (map.hasLayer(ent.contourLayer)) map.removeLayer(ent.contourLayer);
            if (activeContourLayer === ent.contourLayer) activeContourLayer = null;
          }
        } else {
          for (var j = 0; j < planetsOnlyEntries.length; j++) {
            if (!map.hasLayer(planetsOnlyEntries[j].markerLayer)) map.addLayer(planetsOnlyEntries[j].markerLayer);
          }
          Planets.updateMarkers(map, planetEntries, TimeState.current);
        }
        refreshCelestialOverlays();
      });

      // ---- Cloud-Cover Button ----
      const cloudBtn = (this._cloudBtn = makeLayerBtn({
        id: 'cloud',
        title: _t('layer.clouds'),
        symbol: GLYPH_CLOUD,
      }));
      L.DomEvent.on(cloudBtn, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        if (map.hasLayer(cloudsCtl.layer)) {
          map.removeLayer(cloudsCtl.layer);
        } else {
          map.addLayer(cloudsCtl.layer);
          cloudsCtl.refresh();
        }
      });

      // ---- Eclipse Button (Merged: List in Left Sidebar + Shadow on Map) ----
      if (eclipseCtl) {
        const eclipseBtn = (this._eclipseBtn = makeLayerBtn({
          id: 'eclipse',
          title: _t('layer.eclipse'),
          iconHtml: SVG_ECLIPSE,
        }));
        L.DomEvent.on(eclipseBtn, 'click', function (e) {
          L.DomEvent.preventDefault(e);
          L.DomEvent.stopPropagation(e);
          const isOn = map.hasLayer(eclipseCtl.eclipseListLayer) || map.hasLayer(eclipseCtl.soloLayer);
          if (isOn) {
            if (map.hasLayer(eclipseCtl.soloLayer)) map.removeLayer(eclipseCtl.soloLayer);
            if (map.hasLayer(eclipseCtl.eclipseListLayer)) map.removeLayer(eclipseCtl.eclipseListLayer);
            Sidebar.onLayerToggle('eclipse-list', false);
          } else {
            map.addLayer(eclipseCtl.soloLayer);
            map.addLayer(eclipseCtl.eclipseListLayer);
            Sidebar.onLayerToggle('eclipse-list', true);
          }
        });
      }

      // ---- Sky Button (Three-State: Off → IAU → Chinese → Off) ----
      const skyBtn = (this._skyBtn = makeLayerBtn({
        id: 'sky',
        title: _t('layer.stars'),
        iconHtml: SVG_SKY,
      }));
      skyBtn.dataset.skyState = 'off';
      const self = this;
      L.DomEvent.on(skyBtn, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        if (typeof Sky === 'undefined') return;
        const next = Sky.cycleMode();
        skyBtn.dataset.skyState = next;
        if (typeof Asterism !== 'undefined') {
          if (next === 'off') Asterism.hide();
          else Asterism.show();
        }
        self._update();
        refreshCelestialOverlays();
        enforceConflicts('sky', next !== 'off');
        // If eclipse is active, re-suppress overlays for the newly entered sky mode
        if (next !== 'off' && _conflictStash.has('eclipse-sky-ovl') && typeof Sky !== 'undefined') {
          Sky.suppressOverlays();
        }
      });

      // ---- Light-Pollution Button ----
      const lpBtn = (this._lpBtn = makeLayerBtn({
        id: 'lp',
        title: _t('layer.lp'),
        iconHtml: SVG_LP,
      }));
      L.DomEvent.on(lpBtn, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        map.hasLayer(lpLayer) ? map.removeLayer(lpLayer) : map.addLayer(lpLayer);
      });

      // ---- Aurora Button ----
      let auroraBtn = null;
      if (typeof Aurora !== 'undefined') {
        Aurora.init(map);
        auroraBtn = this._auroraBtn = makeLayerBtn({
          id: 'aurora',
          title: _t('layer.aurora'),
          iconHtml: SVG_AURORA,
        });
        L.DomEvent.on(auroraBtn, 'click', function (e) {
          L.DomEvent.preventDefault(e);
          L.DomEvent.stopPropagation(e);
          // Aurora.toggle drives its own LayerGroup (no map layeradd event), so
          // refresh the button's aria-pressed once the toggle settles.
          Promise.resolve(Aurora.toggle(map)).then(function () {
            self._update();
          });
        });
      }

      // ---- Satellite Button ----
      let satBtn = null;
      if (typeof Sat !== 'undefined') {
        Sat.init(map);
        satBtn = this._satBtn = makeLayerBtn({
          id: 'sat',
          title: _t('layer.sat'),
          iconHtml: SVG_SAT,
        });
        L.DomEvent.on(satBtn, 'click', function (e) {
          L.DomEvent.preventDefault(e);
          L.DomEvent.stopPropagation(e);
          // Sat.toggle is async (awaits TLE load) and drives its own LayerGroup,
          // so refresh aria-pressed once the toggle settles (isOn() is true only
          // after addTo completes).
          Promise.resolve(Sat.toggle(map)).then(function () {
            self._update();
          });
        });
      }

      // Order: stars · Sun · Moon · planets · eclipses · light pollution · aurora · satellites
      const ordered = [skyBtn, twBtn];
      if (this._moonBtn) ordered.push(this._moonBtn);
      ordered.push(planetsBtn);
      if (eclipseCtl && this._eclipseBtn) ordered.push(this._eclipseBtn);
      ordered.push(lpBtn);
      if (auroraBtn) ordered.push(auroraBtn);
      if (satBtn) ordered.push(satBtn);
      this._orderedBtns = ordered;
      for (var bi = 0; bi < ordered.length; bi++) container.appendChild(ordered[bi]);

      // ---- Priority+ Overflow ----
      // A "more" (⋯) toggle appended at the rail's right end, plus a flyout
      // panel that holds the icons that don't fit. The toggle stays hidden
      // until _syncLayerOverflow() detects an overflow.
      const moreBtn = (this._moreBtn = L.DomUtil.create('button', 'layer-btn layer-more-btn', container));
      moreBtn.type = 'button';
      moreBtn.dataset.layer = 'more';
      moreBtn.style.display = 'none';
      moreBtn.dataset.tip = _t('layer.more');
      moreBtn.setAttribute('aria-label', _t('layer.more'));
      moreBtn.setAttribute('aria-haspopup', 'true');
      moreBtn.setAttribute('aria-expanded', 'false');
      // Bento 2×3 dot grid (bento menu) — fill:currentColor inherits the
      // .layer-btn muted/hover/pressed color states.
      moreBtn.innerHTML =
        '<span class="layer-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 8 12" xmlns="http://www.w3.org/2000/svg" fill="currentColor">' +
        '<circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/>' +
        '<circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/>' +
        '<circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/>' +
        '</svg></span>';

      // Root wrapper holds the rail + the (unclipped) flyout as siblings.
      const root = L.DomUtil.create('div', 'layer-toggle-root');
      root.appendChild(container);
      const panel = (this._overflowPanel = L.DomUtil.create('div', 'layer-overflow-panel', root));
      this._rail = container;

      L.DomEvent.on(moreBtn, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        const open = panel.classList.toggle('open');
        moreBtn.setAttribute('aria-expanded', String(open));
      });
      // Dismiss the flyout when clicking anywhere outside the control.
      L.DomEvent.on(document, 'pointerdown', function (e) {
        if (!panel.classList.contains('open')) return;
        if (root.contains(e.target)) return;
        panel.classList.remove('open');
        moreBtn.setAttribute('aria-expanded', 'false');
      });

      L.DomEvent.disableClickPropagation(root);

      this._update();
      return root;
    },

    // Priority+ distribution: keep as many icons on the rail as fit in the space
    // left of the right-hand control group; push the rest into the flyout. The
    // rail is left-anchored and the right group right-anchored, so moving icons
    // only shortens the rail and never re-collides — no flapping. Must run AFTER
    // _syncToolbarCompact() since the search box's width sets the right group's
    // left edge (wired via window.__syncLayerOverflow in app.js).
    _syncLayerOverflow: function () {
      const btns = this._orderedBtns;
      if (!btns || !this._moreBtn) return;
      const more = this._moreBtn,
        rail = this._rail,
        panel = this._overflowPanel;
      const root = this._container || this.getContainer();
      if (!root) return;
      // Measure against a CONSTANT reserve for the right-hand control group at its
      // FULL (expanded-search) width — always 460, even when `.toolbar-compact`
      // has visually collapsed the search. Using the full reserve regardless of
      // compact state keeps icon dropping MONOTONIC: collapsing the search never
      // frees space that floods icons back onto the rail (which would cause a
      // sawtooth at the compact threshold). The search collapse (handled in
      // app.js _syncToolbarCompact, stage 2) is purely a final overlap guard.
      // ≈460 = search 360 + zoom 22.5 + layers 45 + gaps + inset; railLeft (~65) stable.
      const RIGHT_RESERVE = 460;
      const railLeft = root.getBoundingClientRect().left;
      const GUTTER = 12;
      const BTN = (btns[0] && btns[0].offsetWidth) || 40;

      const avail = window.innerWidth - RIGHT_RESERVE - railLeft - GUTTER;
      const fit = Math.floor(avail / BTN);
      // Progressive overflow: keep as MANY icons on the rail as fit, dropping
      // them into the flyout one-by-one as the viewport narrows (not all-at-once).
      // When overflow is active the rail also carries the "more" button, so its
      // width is reserved out of `avail` before recomputing how many icons fit.
      const n = btns.length;
      let visibleN;
      if (fit >= n) {
        visibleN = n; // everything fits — no flyout
      } else {
        const MORE_W = (more && more.offsetWidth) || 26;
        visibleN = Math.max(1, Math.floor((avail - MORE_W) / BTN));
      }
      for (var i = 0; i < btns.length; i++) {
        if (i < visibleN) rail.insertBefore(btns[i], more);
        else panel.appendChild(btns[i]);
      }
      const overflowing = visibleN < btns.length;
      more.style.display = overflowing ? '' : 'none';
      if (!overflowing) {
        panel.classList.remove('open');
        more.setAttribute('aria-expanded', 'false');
      }
      // Size the flyout panel to fit its icons exactly — no trailing empty slots.
      // Cap at 4 columns; for 5+ items, a 2nd row will have at most 1 empty slot.
      const flyoutN = n - visibleN;
      panel.style.width = overflowing ? Math.min(flyoutN, 4) * BTN + 'px' : '';
      // Reflect whether any overflowed (flyout) layer is active onto the more btn.
      this._syncMoreActive();
    },

    // Light up the "more" toggle when any layer currently in the overflow flyout
    // is active, so an active-but-hidden layer is still discoverable. Called from
    // _update (layer toggled) and _syncLayerOverflow (buttons moved on resize).
    _syncMoreActive: function () {
      const more = this._moreBtn,
        panel = this._overflowPanel;
      if (!more || !panel) return;
      const anyOn = panel.querySelectorAll('.layer-btn[aria-pressed="true"]').length > 0;
      more.setAttribute('aria-pressed', String(anyOn));
    },

    _update: function () {
      function setPressed(btn, on) {
        if (btn) btn.setAttribute('aria-pressed', String(!!on));
      }
      setPressed(this._twBtn, map.hasLayer(twilightGroup));
      setPressed(this._cloudBtn, map.hasLayer(cloudsCtl.layer));
      setPressed(this._lpBtn, map.hasLayer(lpLayer));
      if (this._auroraBtn) setPressed(this._auroraBtn, typeof Aurora !== 'undefined' && Aurora.isOn());
      if (this._satBtn) setPressed(this._satBtn, typeof Sat !== 'undefined' && Sat.isOn());
      if (this._skyBtn) {
        const skyOn = typeof Sky !== 'undefined' && Sky.getMode() !== 'off';
        setPressed(this._skyBtn, skyOn);
        this._skyBtn.dataset.skyState = typeof Sky !== 'undefined' ? Sky.getMode() : 'off';
      }
      if (eclipseCtl && this._eclipseBtn) {
        setPressed(this._eclipseBtn, map.hasLayer(eclipseCtl.soloLayer) || map.hasLayer(eclipseCtl.eclipseListLayer));
      }
      if (this._planetsBtn) {
        const anyPlanetOn = planetsOnlyEntries.length > 0 && map.hasLayer(planetsOnlyEntries[0].markerLayer);
        setPressed(this._planetsBtn, anyPlanetOn);
      }
      if (this._moonBtn && moonEntry) {
        setPressed(this._moonBtn, map.hasLayer(moonEntry.markerLayer));
      }
      _syncOverlayCheckboxes();
      // Mirror active state of any overflowed layer onto the "more" button.
      this._syncMoreActive();
    },

    _refreshI18n: function () {
      const _t =
        typeof I18n !== 'undefined'
          ? I18n.t.bind(I18n)
          : function (k) {
              return k;
            };
      const titleMap = {
        twilight: 'layer.sun',
        moon: 'layer.moon',
        planets: 'layer.planets',
        cloud: 'layer.clouds',
        eclipse: 'layer.eclipse',
        sky: 'layer.stars',
        lp: 'layer.lp',
        aurora: 'layer.aurora',
        sat: 'layer.sat',
        more: 'layer.more',
      };
      var container = this._container || this.getContainer();
      if (!container) return;
      var btns = container.querySelectorAll('.layer-btn');
      for (var i = 0; i < btns.length; i++) {
        var key = titleMap[btns[i].dataset.layer];
        if (key) {
          btns[i].dataset.tip = _t(key);
          btns[i].setAttribute('aria-label', _t(key));
        }
      }
    },
  });

  toggleCtrl = new LayerToggleControl().addTo(map);

  // Expose the Priority+ overflow sync so app.js's resize handler can call it
  // right after toggling `.toolbar-compact` (search collapse changes the right
  // group's left edge, which this measures against). Run once now too.
  window.__syncLayerOverflow = function () {
    if (toggleCtrl && toggleCtrl._syncLayerOverflow) toggleCtrl._syncLayerOverflow();
  };
  window.__syncLayerOverflow();

  if (typeof I18n !== 'undefined') {
    I18n.subscribe(function () {
      toggleCtrl._refreshI18n();
    });
    I18n.subscribe(function () {
      if (Ecliptic.isOn()) Ecliptic.update(TimeState.current);
      if (typeof LunarPath !== 'undefined' && LunarPath.isOn()) LunarPath.update(TimeState.current);
      if (typeof GalacticEquator !== 'undefined' && GalacticEquator.isOn()) GalacticEquator.update(TimeState.current);
      if (CelestialEquator.isOn()) _rebuildEquator(TimeState.current);
      _syncOverlayCheckboxes();
    });
  }

  // ---- Register Layers with AppState for Permalink Serialization ----
  if (typeof AppState !== 'undefined') {
    AppState.registerLayer('twilight', {
      isOn: function () {
        return map.hasLayer(twilightGroup);
      },
      setOn: function (on) {
        on ? map.addLayer(twilightGroup) : map.removeLayer(twilightGroup);
      },
    });
    AppState.registerLayer('lp', {
      isOn: function () {
        return map.hasLayer(lpLayer);
      },
      setOn: function (on) {
        on ? map.addLayer(lpLayer) : map.removeLayer(lpLayer);
      },
    });
    AppState.registerLayer('clouds', {
      isOn: function () {
        return map.hasLayer(cloudsCtl.layer);
      },
      setOn: function (on) {
        on ? map.addLayer(cloudsCtl.layer) : map.removeLayer(cloudsCtl.layer);
      },
    });
    if (eclipseCtl) {
      AppState.registerLayer('eclipse', {
        isOn: function () {
          return map.hasLayer(eclipseCtl.soloLayer) || map.hasLayer(eclipseCtl.eclipseListLayer);
        },
        setOn: function (on) {
          if (on) {
            map.addLayer(eclipseCtl.soloLayer);
            map.addLayer(eclipseCtl.eclipseListLayer);
            Sidebar.onLayerToggle('eclipse-list', true);
          } else {
            if (map.hasLayer(eclipseCtl.soloLayer)) map.removeLayer(eclipseCtl.soloLayer);
            if (map.hasLayer(eclipseCtl.eclipseListLayer)) map.removeLayer(eclipseCtl.eclipseListLayer);
            Sidebar.onLayerToggle('eclipse-list', false);
          }
        },
      });
    }
    AppState.registerLayer('planets', {
      isOn: function () {
        return planetsOnlyEntries.length > 0 && map.hasLayer(planetsOnlyEntries[0].markerLayer);
      },
      setOn: function (on) {
        for (var i = 0; i < planetsOnlyEntries.length; i++) {
          on ? map.addLayer(planetsOnlyEntries[i].markerLayer) : map.removeLayer(planetsOnlyEntries[i].markerLayer);
        }
      },
    });
    if (moonEntry) {
      AppState.registerLayer('moon', {
        isOn: function () {
          return map.hasLayer(moonEntry.markerLayer);
        },
        setOn: function (on) {
          on ? map.addLayer(moonEntry.markerLayer) : map.removeLayer(moonEntry.markerLayer);
        },
      });
    }
    if (typeof Aurora !== 'undefined') {
      AppState.registerLayer('aurora', {
        isOn: function () {
          return Aurora.isOn();
        },
        setOn: function (on) {
          if (on && !Aurora.isOn()) Aurora.toggle(map);
          else if (!on && Aurora.isOn()) Aurora.toggle(map);
        },
      });
    }
    if (typeof Sat !== 'undefined') {
      AppState.registerLayer('sat', {
        isOn: function () {
          return Sat.isOn();
        },
        setOn: function (on) {
          if (on && !Sat.isOn()) Sat.toggle(map);
          else if (!on && Sat.isOn()) Sat.toggle(map);
        },
      });
    }
  }

  map.on('layeradd layerremove', function (e) {
    if (
      e.layer === twilightGroup ||
      e.layer === lpLayer ||
      e.layer === cloudsCtl.layer ||
      (eclipseCtl && (e.layer === eclipseCtl.soloLayer || e.layer === eclipseCtl.eclipseListLayer))
    )
      toggleCtrl._update();
    if (e.layer === twilightGroup) {
      ssLatLabel.style.display = map.hasLayer(twilightGroup) ? '' : 'none';
      refreshCelestialOverlays();
    }
    for (var m = 0; m < planetEntries.length; m++) {
      if (e.layer === planetEntries[m].markerLayer || e.layer === planetEntries[m].contourLayer) {
        toggleCtrl._update();
        if (e.layer === planetEntries[m].markerLayer) refreshCelestialOverlays();
        break;
      }
    }
    // Layer conflict enforcement
    if (eclipseCtl && (e.layer === eclipseCtl.soloLayer || e.layer === eclipseCtl.eclipseListLayer)) {
      const eclipseOn = map.hasLayer(eclipseCtl.soloLayer) || map.hasLayer(eclipseCtl.eclipseListLayer);
      enforceConflicts('eclipse', eclipseOn);
    }
    if (e.layer === lpLayer) {
      _lpLayerActive = map.hasLayer(lpLayer);
      enforceConflicts('lp', _lpLayerActive);
      updateMaskOpacity();
    }
  });

  // ---- Aurora Hover Readout (Cursor Tooltip Over the Oval) ----
  // The aurora pane has pointer-events:none, so the map still receives
  // mousemove. We show a tooltip only while the layer is on and the cursor is
  // over modelled aurora (sampled probability ≥ 1%).
  let _auroraTip = null,
    _auroraTipShown = false;
  function _hideAuroraTip() {
    if (_auroraTipShown && _auroraTip) {
      map.closeTooltip(_auroraTip);
    }
    _auroraTipShown = false;
  }
  map.on('mousemove', (e) => {
    if (typeof Aurora === 'undefined' || !Aurora.isOn()) {
      _hideAuroraTip();
      return;
    }
    const v = Aurora.sampleAt(e.latlng.lat, e.latlng.lng);
    if (v == null || v < 1) {
      _hideAuroraTip();
      return;
    }
    const _t = typeof I18n !== 'undefined' ? I18n.t.bind(I18n) : (k) => k;
    if (!_auroraTip) {
      _auroraTip = L.tooltip({
        direction: 'top',
        offset: [0, -4],
        opacity: 0.95,
        className: 'celestial-tooltip',
        sticky: true,
      });
    }
    _auroraTip.setContent(_t('tooltip.aurora.prob', { prob: Math.round(v) })).setLatLng(e.latlng);
    if (!_auroraTipShown) {
      map.openTooltip(_auroraTip);
      _auroraTipShown = true;
    }
  });
  map.on('mouseout', _hideAuroraTip);

  // Expose subsolar helper for the compass (current sun direction line). A distinct
  // name avoids shadowing the script-level `function computeSubsolarPoint` —
  // assigning to `window.computeSubsolarPoint` would recurse into itself.
  const _origSubsolar = computeSubsolarPoint;
  window.getSubsolarLatLng = function (d) {
    const sub = _origSubsolar(d);
    let lng = sub.lng;
    if (lng > 180) lng -= 360;
    return { lat: sub.lat, lng: lng };
  };

  // Initialise the Observer module (marker, pane, contextmenu, compass).
  // onPlace clears any active altitude-contour layer — that state lives here.
  if (typeof Observer !== 'undefined') {
    Observer.init(map, {
      onPlace: (lat, lng) => {
        if (activeContourLayer && map.hasLayer(activeContourLayer)) {
          map.removeLayer(activeContourLayer);
          activeContourLayer = null;
          if (toggleCtrl && toggleCtrl._update) toggleCtrl._update();
        }
        // Reverse-geocode the new observer point so the sidebar's place-name
        // line always tracks the marker. This is the single funnel for EVERY
        // placement — map click, dblclick, pin re-click, search-select and
        // deep-link restore all route through Observer.place → onPlace — so the
        // geocode lives here, not duplicated at each individual call site.
        if (typeof Places !== 'undefined' && Places.ensureLoaded) {
          Places.ensureLoaded()
            .then(() => Places.reverseAndRender(lat, lng))
            .catch(() => {});
        }
        // Keep the sidebar's rise/set times in lockstep with the marker on
        // EVERY move (marker re-click / drag included), not just map clicks.
        if (typeof Sidebar !== 'undefined' && Sidebar.setLocation) Sidebar.setLocation(lat, lng);
      },
    });
  }

  // ---- Click Handler: Location Mode — Handled by observer.js (Observer Module) ----
  // Observer.init() binds click/dblclick/contextmenu and owns all marker state.
  // map.js attaches Sidebar / Places / LP side-effects to the same click event
  // AFTER Observer.init() so they fire in the same microtask batch, with
  // observer.js's microtask running first (it was registered first).
  // This ordering is critical: observer.js sets window._observerSkipped when a
  // star was clicked (_skyClickConsumed), and map.js reads it to skip Sidebar.show.
  map.on('click', (e) => {
    if (Observer.isLocked()) return;
    Promise.resolve().then(() => {
      // _observerSkipped is set by observer.js when _skyClickConsumed was true;
      // in that case neither the marker nor the sidebar should update.
      if (window._observerSkipped) return;
      const { lat, lng } = e.latlng;
      Sidebar.show(lat, lng);
      // Reverse-geocode is funnelled through Observer.place → onPlace (above).
      LightPollution.fetch(lat, lng, 2024, (err, data) => {
        if (err) {
          Sidebar.showLightPollution({ outOfBounds: false, error: err.message });
          return;
        }
        Sidebar.showLightPollution(data);
      });
    });
  });
  map.on('dblclick', (e) => {
    const { lat, lng } = e.latlng;
    Sidebar.show(lat, lng);
    // Reverse-geocode is funnelled through Observer.place → onPlace (above).
    LightPollution.fetch(lat, lng, 2024, (err, data) => {
      if (err) {
        Sidebar.showLightPollution({ outOfBounds: false, error: err.message });
        return;
      }
      Sidebar.showLightPollution(data);
    });
  });

  // ---- Sky Layer (stars + constellations) ----
  // Star clicks open a hover-card popup near the star itself (see Sky internal
  // showStarPopup). We deliberately do NOT route star detail through the right
  // sidebar — that panel is reserved for observation-point summaries.
  if (typeof Sky !== 'undefined') {
    Sky.init(map)
      .then(async () => {
        await Sky.setMode('iau', { skipAnim: true });
        // Sky finished initializing AFTER _setDayMode may have already been
        // called (Sun layer toggle races with Sky.init). Re-apply day-mode
        // to pick up the latest body.day-mask-active state.
        if (Sky.refreshDayMode) Sky.refreshDayMode();
        if (toggleCtrl && toggleCtrl._skyBtn) {
          toggleCtrl._skyBtn.dataset.skyState = 'iau';
          toggleCtrl._update();
        }
        TimeState.subscribe((date) => {
          Sky.update(date);
          if (typeof Asterism !== 'undefined') Asterism.update(date);
          if (typeof MilkyWay !== 'undefined') MilkyWay.onDateChange(date);
        });
        if (typeof Asterism !== 'undefined') {
          Asterism.init(map)
            .then(() => Asterism.show())
            .catch((err) => console.error('[asterism] init failed:', err));
        }
      })
      .catch((err) => console.error('[sky] init failed:', err));
  }

  // Dev/debug only — gives test code (preview_eval, browser DevTools) a
  // handle on the Leaflet map without having to walk pane._map etc.
  window.__map = map;
  return map;
}
