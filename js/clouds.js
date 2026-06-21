/**
 * Cloud-cover layer with bilinear-interpolated canvas rendering.
 *
 * Data source: Open-Meteo via Weather.fetchCloudGrid, which buckets points
 * by region and queries the best regional model per bucket (HRRR for USA,
 * ICON-D2 for Europe, AROME for France, KMA LDPS for Korea, JMA MSM for
 * Japan, CMA GRAPES for Greater China, GFS elsewhere).
 *
 * Rendering: each tile is a 256×256 ImageData with per-pixel alpha set by
 * bilinearly interpolating the four nearest grid points. This makes 0.25–1°
 * model output look smooth at any zoom level (Windy/meteoblue do the same).
 */
const Clouds = (() => {
  // Spatial step (degrees) for the network grid query — finer at higher zooms.
  function gridStep(zoom) {
    if (zoom < 3) return 2;
    if (zoom < 5) return 1;
    if (zoom < 7) return 0.5;
    if (zoom < 9) return 0.25;
    return 0.1;
  }

  function init(map) {
    map.createPane('clouds');
    map.getPane('clouds').style.zIndex = 300;
    map.getPane('clouds').style.pointerEvents = 'none';

    let _grid = null; // { time, grid, step, latIdx, lngIdx } indexed
    let _timeIdx = 0;
    let _fetchTimer = null;

    // ---- Bilinear Sample ----
    // Total cloud cover at (lat, lng) for time _timeIdx.
    function sampleCloud(lat, lng, useHigh) {
      if (!_grid) return 0;
      const { step, latIdx, lngIdx } = _grid;
      // Find indices into our regular grid
      const xf = (lng - _grid.lng0) / step;
      const yf = (lat - _grid.lat0) / step;
      const x0 = Math.floor(xf),
        y0 = Math.floor(yf);
      const fx = xf - x0,
        fy = yf - y0;

      function valAt(xi, yi) {
        const lngK = lngIdx[xi];
        const latK = latIdx[yi];
        if (lngK === undefined || latK === undefined) return null;
        const pt = _grid.byKey[latK + ',' + lngK];
        if (!pt) return null;
        if (useHigh) {
          return pt.high[_timeIdx] || 0;
        }
        const lo = pt.low[_timeIdx] || 0;
        const md = pt.mid[_timeIdx] || 0;
        const hi = pt.high[_timeIdx] || 0;
        return Math.min(100, lo + md + hi); // sum cap 100
      }

      const v00 = valAt(x0, y0);
      const v10 = valAt(x0 + 1, y0);
      const v01 = valAt(x0, y0 + 1);
      const v11 = valAt(x0 + 1, y0 + 1);

      // If any neighbour is missing, fall back to nearest available
      const vals = [v00, v10, v01, v11].filter((v) => v !== null);
      if (vals.length === 0) return 0;
      if (vals.length < 4) return vals.reduce((a, b) => a + b, 0) / vals.length;

      return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
    }

    // ---- Custom Canvas GridLayer ----
    const CloudLayer = L.GridLayer.extend({
      createTile: function (coords) {
        const tile = document.createElement('canvas');
        const size = this.getTileSize();
        tile.width = size.x;
        tile.height = size.y;

        if (!_grid) return tile;

        const ctx = tile.getContext('2d');
        const img = ctx.createImageData(size.x, size.y);
        const data = img.data;

        const z = coords.z;
        const tilePxX = coords.x * size.x;
        const tilePxY = coords.y * size.y;

        // Step the inner loop in 2px blocks for ~4x speedup at high zooms.
        // 256×256 with stride 2 = 64×64 lookups, replicated to neighbouring pixels.
        const STRIDE = 2;
        for (let py = 0; py < size.y; py += STRIDE) {
          for (let px = 0; px < size.x; px += STRIDE) {
            const ll = map.unproject(L.point(tilePxX + px, tilePxY + py), z);
            const cloud = sampleCloud(ll.lat, ll.lng, false);
            const high = sampleCloud(ll.lat, ll.lng, true);
            const a = Math.max(0, Math.min(220, Math.round(cloud * 2.0)));
            // High cirrus → ice-blue tint
            let r = 255,
              g = 255,
              b = 255;
            if (high > 50) {
              const blend = Math.min(1, (high - 50) / 50);
              r = Math.round(255 * (1 - blend * 0.3) + 199 * blend * 0.3);
              g = Math.round(255 * (1 - blend * 0.2) + 210 * blend * 0.2);
              b = Math.round(255 * (1 - blend * 0.0) + 254 * blend * 0.0);
            }
            // Replicate to STRIDE×STRIDE block
            for (let dy = 0; dy < STRIDE && py + dy < size.y; dy++) {
              for (let dx = 0; dx < STRIDE && px + dx < size.x; dx++) {
                const idx = ((py + dy) * size.x + (px + dx)) * 4;
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = a;
              }
            }
          }
        }
        ctx.putImageData(img, 0, 0);
        return tile;
      },
    });

    const layer = new CloudLayer({ pane: 'clouds', tileSize: 256, opacity: 0.85 });

    // ---- Update time index and redraw on TimeState change ----
    TimeState.subscribe(function (date) {
      if (!_grid || !map.hasLayer(layer)) return;
      if (!_grid.time || !_grid.time.length) return;
      const t0 = new Date(_grid.time[0] + ':00Z');
      const newIdx = Math.max(0, Math.min(_grid.time.length - 1, Math.floor((date - t0) / 3600000)));
      if (newIdx !== _timeIdx) {
        _timeIdx = newIdx;
        layer.redraw();
      }
    });

    // ---- Index a fetched grid for O(1) lookup ----
    function indexGrid(payload) {
      const lats = new Set(),
        lngs = new Set();
      const byKey = {};
      for (const pt of payload.grid) {
        lats.add(pt.lat);
        lngs.add(pt.lng);
        byKey[pt.lat + ',' + pt.lng] = pt;
      }
      const sortedLats = Array.from(lats).sort((a, b) => a - b);
      const sortedLngs = Array.from(lngs).sort((a, b) => a - b);
      // Build dense lookup arrays — index 0 = lat0/lng0, index N = latN/lngN
      const lat0 = sortedLats[0],
        lng0 = sortedLngs[0];
      return {
        time: payload.time,
        grid: payload.grid,
        step: payload.step,
        lat0,
        lng0,
        latIdx: sortedLats,
        lngIdx: sortedLngs,
        byKey,
      };
    }

    function refresh() {
      if (!map.hasLayer(layer)) return;
      const bounds = map.getBounds();
      const step = gridStep(map.getZoom());

      Weather.fetchCloudGrid(bounds, step, function (err, data) {
        if (err) {
          console.warn('[Clouds] grid fetch failed:', err.message);
          return;
        }
        _grid = indexGrid(data);

        if (data.time && data.time.length) {
          const t0 = new Date(data.time[0] + ':00Z');
          _timeIdx = Math.max(0, Math.min(data.time.length - 1, Math.floor((TimeState.current - t0) / 3600000)));
        }

        layer.redraw();
      });
    }

    map.on('moveend zoomend', function () {
      if (!map.hasLayer(layer)) return;
      clearTimeout(_fetchTimer);
      _fetchTimer = setTimeout(refresh, 500);
    });

    function destroy() {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      clearTimeout(_fetchTimer);
    }

    return { layer, refresh, destroy };
  }

  return { init };
})();
