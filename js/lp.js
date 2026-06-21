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

        const firstNumber = 128 * data[0] + data[1];

        let change = 0;
        for (let i = 1; i < iy; i++) {
          change += data[600 * i + 1];
        }
        for (let i = 1; i < ix; i++) {
          change += data[600 * (iy - 1) + 1 + i];
        }

        const compressed = firstNumber + change;
        const ratio = compressed2full(compressed);
        const mpsas = brightnessToMpsas(ratio);
        const zi = zoneInfo(ratio);

        cb(null, {
          lat,
          lng,
          outOfBounds: false,
          ratio,
          mpsas,
          zone: zi.zone,
          zoneColor: zi.color,
          year,
        });
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

  return { fetch, ZONES, zoneInfo, roundBrightness, brightnessToMpsas };
})();
