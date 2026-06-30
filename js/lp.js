/**
 * lp.js — Light pollution data extraction from Lorenz binary tiles.
 * Each 5deg x 5deg tile has 600x600 grid points (1/120deg resolution).
 * Data is stored as gzip-compressed Int8 deltas.
 */
const LightPollution = (() => {
  const BINARY_BASE = 'https://djlorenz.github.io/astronomy/binary_tiles';

  // LP Zone thresholds (brightness ratio)
  const ZONES = [
    { zone: '0', min: 0, max: 0.01, color: '#000000' },
    { zone: '1a', min: 0.01, max: 0.06, color: '#222222' },
    { zone: '1b', min: 0.06, max: 0.11, color: '#424242' },
    { zone: '2a', min: 0.11, max: 0.19, color: '#142f72' },
    { zone: '2b', min: 0.19, max: 0.33, color: '#2154d8' },
    { zone: '3a', min: 0.33, max: 0.58, color: '#0f5714' },
    { zone: '3b', min: 0.58, max: 1.0, color: '#1fa12a' },
    { zone: '4a', min: 1.0, max: 1.73, color: '#6e641e' },
    { zone: '4b', min: 1.73, max: 3.0, color: '#b8a625' },
    { zone: '5a', min: 3.0, max: 5.2, color: '#bf641e' },
    { zone: '5b', min: 5.2, max: 9.0, color: '#fd9650' },
    { zone: '6a', min: 9.0, max: 15.59, color: '#fb5a49' },
    { zone: '6b', min: 15.59, max: 27.0, color: '#fb998a' },
    { zone: '7a', min: 27.0, max: 46.77, color: '#a0a0a0' },
    { zone: '7b', min: 46.77, max: Infinity, color: '#f2f2f2' },
  ];

  // Tile cache: key `${tileX}_${tileY}_${year}` → ungzipped Int8Array.
  // Caching the raw tile (not a single decoded point) lets sampleAt serve any
  // coordinate within that 5°×5° tile on subsequent mouse-moves without a round-trip.
  const _tileCache = new Map();
  const _tilePending = new Set();

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  function zoneInfo(br) {
    for (const z of ZONES) {
      if (br < z.max) return z;
    }
    return ZONES[ZONES.length - 1];
  }

  function roundBrightness(b) {
    if (b < 0.1) return b.toFixed(3);
    if (b < 3) return b.toFixed(2);
    return b.toFixed(1);
  }

  function compressed2full(x) {
    return (5.0 / 195.0) * (Math.exp(0.0195 * x) - 1.0);
  }

  function brightnessToMpsas(br) {
    return 22.0 - 2.5 * Math.log10(1.0 + br);
  }

  // Decode one point from a cached tile's Int8Array by cumulative delta sum.
  // ix and iy are 1-based grid indices (1..600). Cost: O(ix + iy) ≈ O(1200).
  function _valueAt(data, ix, iy) {
    const firstNumber = 128 * data[0] + data[1];
    let change = 0;
    for (let i = 1; i < iy; i++) change += data[600 * i + 1];
    for (let i = 1; i < ix; i++) change += data[600 * (iy - 1) + 1 + i];
    return firstNumber + change;
  }

  function _tileKey(tileX, tileY, year) {
    return `${tileX}_${tileY}_${year}`;
  }

  function _decodeResult(data, ix, iy, lat, lng, year) {
    const compressed = _valueAt(data, ix, iy);
    const ratio = compressed2full(compressed);
    const mpsas = brightnessToMpsas(ratio);
    const zi = zoneInfo(ratio);
    return { lat, lng, outOfBounds: false, ratio, mpsas, zone: zi.zone, zoneColor: zi.color, year };
  }

  function _tileCoords(lat, lng) {
    const lonFromDateLine = mod(lng + 180.0, 360.0);
    const latFromStart = lat + 65.0;
    const tileX = Math.floor(lonFromDateLine / 5.0) + 1;
    const tileY = Math.floor(latFromStart / 5.0) + 1;
    const ix = Math.round(120 * (lonFromDateLine - 5.0 * (tileX - 1) + 1 / 240));
    const iy = Math.round(120 * (latFromStart - 5.0 * (tileY - 1) + 1 / 240));
    return { tileX, tileY, ix, iy };
  }

  // Synchronous point sample. Returns a result object on cache hit, null on miss
  // (a background fetch is triggered so the next mouse-move will hit the cache).
  // Returns null also for out-of-bounds locations.
  function sampleAt(lat, lng, year) {
    const lonFromDateLine = mod(lng + 180.0, 360.0);
    const latFromStart = lat + 65.0;
    const tileX = Math.floor(lonFromDateLine / 5.0) + 1;
    const tileY = Math.floor(latFromStart / 5.0) + 1;
    if (tileY < 1 || tileY > 28) return null;

    const key = _tileKey(tileX, tileY, year);
    const cached = _tileCache.get(key);
    if (cached) {
      const ix = Math.round(120 * (lonFromDateLine - 5.0 * (tileX - 1) + 1 / 240));
      const iy = Math.round(120 * (latFromStart - 5.0 * (tileY - 1) + 1 / 240));
      return _decodeResult(cached, ix, iy, lat, lng, year);
    }

    // Cache miss — trigger background fetch so subsequent mouse-moves get a hit.
    if (!_tilePending.has(key)) {
      _tilePending.add(key);
      const url = `${BINARY_BASE}/${year}/binary_tile_${tileX}_${tileY}.dat.gz`;
      const xhr = new XMLHttpRequest();
      xhr.responseType = 'arraybuffer';
      xhr.onload = function () {
        if (xhr.status === 200) {
          try {
            _tileCache.set(key, new Int8Array(pako.ungzip(xhr.response)));
          } catch (_) {}
        }
        _tilePending.delete(key);
      };
      xhr.onerror = function () {
        _tilePending.delete(key);
      };
      xhr.open('GET', url, true);
      xhr.send();
    }
    return null;
  }

  /**
   * Fetch LP data for a given lat/lng.
   * @param {number} lat   Latitude (-90 to 90)
   * @param {number} lng   Longitude (-180 to 180)
   * @param {number} year  Dataset year (2016, 2020, 2022, 2023, 2024)
   * @param {function} cb  Callback: cb(err, data) where data = { lat, lng, ratio, mpsas, zone, zoneColor, year }
   */
  function fetch(lat, lng, year, cb) {
    const lonFromDateLine = mod(lng + 180.0, 360.0);
    const latFromStart = lat + 65.0;

    const tileX = Math.floor(lonFromDateLine / 5.0) + 1;
    const tileY = Math.floor(latFromStart / 5.0) + 1;

    // Out of bounds check (atlas covers 65S to 75N)
    if (tileY < 1 || tileY > 28) {
      cb(null, { lat, lng, outOfBounds: true });
      return;
    }

    // Grid point index within the tile (1-based, 1..600)
    const ix = Math.round(120 * (lonFromDateLine - 5.0 * (tileX - 1) + 1 / 240));
    const iy = Math.round(120 * (latFromStart - 5.0 * (tileY - 1) + 1 / 240));

    // Serve from cache if available — avoids a second network round-trip.
    const key = _tileKey(tileX, tileY, year);
    const cached = _tileCache.get(key);
    if (cached) {
      cb(null, _decodeResult(cached, ix, iy, lat, lng, year));
      return;
    }

    const url = `${BINARY_BASE}/${year}/binary_tile_${tileX}_${tileY}.dat.gz`;

    const xhr = new XMLHttpRequest();
    xhr.responseType = 'arraybuffer';
    xhr.onload = function () {
      if (xhr.status !== 200) {
        cb(new Error(`HTTP ${xhr.status} fetching LP tile`));
        return;
      }
      try {
        const data = new Int8Array(pako.ungzip(xhr.response));
        _tileCache.set(key, data);
        cb(null, _decodeResult(data, ix, iy, lat, lng, year));
      } catch (e) {
        cb(e);
      }
    };
    xhr.onerror = function () {
      cb(new Error('Network error fetching LP tile'));
    };
    xhr.open('GET', url, true);
    xhr.send();
  }

  // True when a tile fetch for this point is in flight (sampleAt returned null
  // for an in-bounds location). Lets callers distinguish "tile pending" from
  // "genuinely out of coverage" without duplicating the bounds check.
  function isPending(lat, lng, year) {
    const lonFromDateLine = mod(lng + 180.0, 360.0);
    const latFromStart = lat + 65.0;
    const tileX = Math.floor(lonFromDateLine / 5.0) + 1;
    const tileY = Math.floor(latFromStart / 5.0) + 1;
    if (tileY < 1 || tileY > 28) return false;
    return _tilePending.has(_tileKey(tileX, tileY, year));
  }

  return { fetch, sampleAt, isPending, ZONES, zoneInfo, roundBrightness, brightnessToMpsas };
})();
