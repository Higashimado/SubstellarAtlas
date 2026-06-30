/** aurora.js — Aurora oval overlay (NOAA SWPC OVATION)
 *
 * Rendering: a bilinear-interpolated L.GridLayer (same approach as clouds.js).
 * The OVATION feed is a fixed 1°×1° equirectangular grid (360×181 points).
 * Sampling per screen pixel via map.unproject keeps the oval smooth at any
 * zoom AND places it correctly in Web Mercator — an imageOverlay would stretch
 * the equirectangular image linearly and mis-place the oval at high latitudes
 * (exactly where aurora lives).
 */
const Aurora = (() => {
  const _t =
    typeof I18n !== 'undefined'
      ? I18n.t.bind(I18n)
      : function (k) {
          return k;
        };

  const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
  const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
  const REFRESH_MS = 5 * 60 * 1000;
  // Colour ramp anchored to NOAA's "Probability of Aurora" legend stops:
  // 10% green · 50% yellow · 90% red. Below 10% holds green, ≥90% holds red,
  // values in between interpolate linearly in RGB.
  const AURORA_STOPS = [
    { p: 10, c: [25, 200, 50] }, // green
    { p: 50, c: [245, 215, 35] }, // yellow
    { p: 90, c: [235, 45, 35] }, // red
  ];
  // Opacity saturates earlier than the hue: NOAA's oval reads as a solid sheet
  // at moderate probabilities long before it turns red.
  const AURORA_OPAQUE = 40;
  // Below this probability (%) the cell is treated as model noise and skipped.
  // OVATION emits scattered 1–2% cells down to the equator; the genuine oval
  // starts well above this (lat 50+ reaches 13–20).
  const AURORA_MIN = 3;
  // The nowcast is only meaningful near its observation time. Beyond this the
  // overlay desaturates to signal "not applicable to the selected time".
  const AURORA_VALID_MS = 60 * 60 * 1000;

  let _map = null;
  let _pane = null;
  let _layer = null;
  let _refreshTimer = null;
  let _lastData = null;
  let _kpData = null;
  let _grid = null; // { w, h, data: Float32Array }  dense 360×181 grid
  let _valid = true; // is the nowcast valid for the current TimeState?

  // ---- Linear-interpolated ramp colour for a probability value (%) ----
  function _rampColor(v) {
    const s = AURORA_STOPS;
    if (v <= s[0].p) return s[0].c;
    if (v >= s[s.length - 1].p) return s[s.length - 1].c;
    for (let i = 0; i < s.length - 1; i++) {
      if (v <= s[i + 1].p) {
        const f = (v - s[i].p) / (s[i + 1].p - s[i].p);
        const a = s[i].c,
          b = s[i + 1].c;
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      }
    }
    return s[s.length - 1].c;
  }

  // ---- Colour for an interpolated probability value (null = don't paint) ----
  function _color(v, valid) {
    if (v == null || v < AURORA_MIN) return null;
    let [r, g, b] = _rampColor(v);
    if (!valid) {
      // Out-of-range: desaturate to grey (luminance), shape still visible
      const gy = 0.3 * r + 0.59 * g + 0.11 * b;
      r = g = b = gy;
    }
    // Opacity ramps on its own (earlier) scale so the oval reads as a solid
    // sheet at moderate probabilities, fading out toward the noise floor.
    const tA = Math.min(v / AURORA_OPAQUE, 1);
    const a = (0.1 + tA * 0.7) * 255;
    return [Math.round(r), Math.round(g), Math.round(b), Math.round(a)];
  }

  // ---- Build a dense lookup grid from the OVATION coordinate list ----
  function _indexGrid(coords) {
    const w = 360,
      h = 181;
    const data = new Float32Array(w * h);
    for (let i = 0; i < coords.length; i++) {
      const lon = ((coords[i][0] % 360) + 360) % 360; // 0..359
      const yi = coords[i][1] + 90; // 0..180
      if (yi < 0 || yi > 180) continue;
      data[yi * w + lon] = coords[i][2];
    }
    return { w, h, data };
  }

  // ---- Bilinear sample of probability (%) at a geographic point ----
  function _sampleAt(lat, lng) {
    if (!_grid) return null;
    const { w, data } = _grid;
    const x = ((lng % 360) + 360) % 360; // [0, 360)
    let y = lat + 90; // [0, 180]
    if (y < 0) y = 0;
    else if (y > 180) y = 180;

    const x0 = Math.floor(x),
      y0 = Math.floor(y);
    const fx = x - x0,
      fy = y - y0;
    const xa = x0 % 360,
      xb = (x0 + 1) % 360; // wrap longitude
    const yb = Math.min(y0 + 1, 180);

    const v00 = data[y0 * w + xa];
    const v10 = data[y0 * w + xb];
    const v01 = data[yb * w + xa];
    const v11 = data[yb * w + xb];
    return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
  }

  // ---- Custom Canvas GridLayer with bilinear interpolation ----
  function _makeLayer() {
    const AuroraGrid = L.GridLayer.extend({
      createTile: function (coords) {
        const tile = document.createElement('canvas');
        const size = this.getTileSize();
        tile.width = size.x;
        tile.height = size.y;
        if (!_grid) return tile;

        const ctx = tile.getContext('2d');
        const img = ctx.createImageData(size.x, size.y);
        const d = img.data;

        const z = coords.z;
        const ox = coords.x * size.x;
        const oy = coords.y * size.y;

        const STRIDE = 2; // 2px blocks — ~4× fewer lookups, matches clouds.js

        for (let py = 0; py < size.y; py += STRIDE) {
          for (let px = 0; px < size.x; px += STRIDE) {
            const ll = _map.unproject(L.point(ox + px, oy + py), z);
            const col = _color(_sampleAt(ll.lat, ll.lng), _valid);
            if (!col) continue;
            for (let dy = 0; dy < STRIDE && py + dy < size.y; dy++) {
              for (let dx = 0; dx < STRIDE && px + dx < size.x; dx++) {
                const idx = ((py + dy) * size.x + (px + dx)) * 4;
                d[idx] = col[0];
                d[idx + 1] = col[1];
                d[idx + 2] = col[2];
                d[idx + 3] = col[3];
              }
            }
          }
        }
        ctx.putImageData(img, 0, 0);
        return tile;
      },
    });
    // noWrap:false (default) → tiles repeat across the wrapped world (−200°…+520°)
    return new AuroraGrid({ pane: 'aurora', tileSize: 256, opacity: 0.85 });
  }

  function _redraw() {
    if (_layer && _map && _map.hasLayer(_layer)) _layer.redraw();
  }

  function _refreshSidebar() {
    if (typeof Sidebar !== 'undefined' && Sidebar.refresh) Sidebar.refresh();
  }

  // ---- Validity vs. the Currently Selected Time ----
  function _obsTimeMs() {
    if (!_lastData || !_lastData['Observation Time']) return null;
    return new Date(_lastData['Observation Time']).getTime();
  }

  function _recomputeValid(date) {
    const obs = _obsTimeMs();
    if (obs == null) {
      _valid = true;
      return;
    }
    const ref = date instanceof Date ? date : typeof TimeState !== 'undefined' ? TimeState.current : new Date();
    const nv = Math.abs(ref.getTime() - obs) <= AURORA_VALID_MS;
    if (nv !== _valid) {
      _valid = nv;
      _redraw();
      _refreshSidebar();
    }
  }

  async function _fetchOvation() {
    try {
      const resp = await fetch(OVATION_URL);
      if (!resp.ok) return;
      const json = await resp.json();
      _lastData = json;
      _grid = _indexGrid(json.coordinates);
      _recomputeValid();
      _redraw();
      _refreshSidebar();
    } catch (e) {
      console.warn('[aurora] OVATION fetch failed', e);
    }
  }

  async function _fetchKp() {
    try {
      const resp = await fetch(KP_URL);
      if (!resp.ok) return;
      _kpData = await resp.json();
      _refreshSidebar();
    } catch (e) {
      console.warn('[aurora] Kp fetch failed', e);
    }
  }

  function _startRefresh() {
    _stopRefresh();
    _fetchOvation();
    _fetchKp();
    _refreshTimer = setInterval(() => {
      _fetchOvation();
      _fetchKp();
    }, REFRESH_MS);
  }

  function _stopRefresh() {
    if (_refreshTimer) {
      clearInterval(_refreshTimer);
      _refreshTimer = null;
    }
  }

  function init(map) {
    _map = map;
    if (!_map.getPane('aurora')) {
      _pane = _map.createPane('aurora');
      _pane.style.zIndex = 200;
      _pane.style.pointerEvents = 'none'; // let the map receive hover/clicks
    }
    if (typeof TimeState !== 'undefined') {
      TimeState.subscribe((date) => _recomputeValid(date));
    }
  }

  function addTo(map) {
    if (!_layer) _layer = _makeLayer();
    _layer.addTo(map);
    _startRefresh();
    _refreshSidebar();
  }

  function removeFrom(map) {
    if (_layer && map.hasLayer(_layer)) map.removeLayer(_layer);
    _stopRefresh();
    _refreshSidebar();
  }

  function isOn() {
    return !!(_map && _layer && _map.hasLayer(_layer));
  }

  function toggle(map) {
    if (isOn()) removeFrom(map);
    else addTo(map);
  }

  function getCurrentKp() {
    if (!_kpData || !_kpData.length) return null;
    const now = Date.now();
    let best = null;
    // Row 0 is a header (["time_tag","kp","..."]); skip non-parseable rows.
    for (const entry of _kpData) {
      const t = new Date((entry.time_tag || entry[0]) + 'Z').getTime();
      if (!isFinite(t)) continue;
      if (t <= now) best = entry;
    }
    return best;
  }

  // Interpolated aurora probability (%) at a point, or null if no data.
  function sampleAt(lat, lng) {
    return _sampleAt(lat, lng);
  }

  // Backward-compatible nearest-ish accessor (rounded percent).
  function getAuroraProbAt(lat, lng) {
    const v = _sampleAt(lat, lng);
    return v == null ? null : Math.round(v);
  }

  function getObservationTime() {
    return _lastData ? _lastData['Observation Time'] : null;
  }

  // Is the nowcast valid for the currently selected time?
  function isValidForCurrentTime() {
    return _valid;
  }

  // CSS hex colour for a probability value (%), matching the rendered ramp.
  function colorFor(prob) {
    const [r, g, b] = _rampColor(prob);
    const h = (v) => Math.round(v).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  }

  return {
    init,
    addTo,
    removeFrom,
    isOn,
    toggle,
    getCurrentKp,
    sampleAt,
    getAuroraProbAt,
    getObservationTime,
    isValidForCurrentTime,
    colorFor,
  };
})();
