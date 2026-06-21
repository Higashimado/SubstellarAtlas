/**
 * galactic-equator.js — galactic equator (great circle of the Milky Way's
 * galactic plane) projected on Earth, rotating with Earth's rotation.
 *
 * The galactic equator is the great circle perpendicular to the galactic
 * pole at RA = 192.85948°, Dec = +27.12825° (J2000). Fixed in celestial
 * coordinates — the substellar projection makes it rotate with Earth's spin.
 *
 * Thin config wrapper around createGreatCircleLayer (great-circle-layer.js).
 * API: init(map), update(date), addTo(map), removeFrom(map), isOn().
 * Depends on: L, GeoUtils, I18n, createGreatCircleLayer, MAP_LNG_WEST/EAST.
 */
const GalacticEquator = (() => {
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const SAMPLES = 721;

  const GAL_POLE_RA_DEG = 192.85948;
  const GAL_POLE_DEC_DEG = 27.12825;

  let _raDecTable = null;

  function _sampleGreatCircle() {
    const pRa = GAL_POLE_RA_DEG * RAD,
      pDec = GAL_POLE_DEC_DEG * RAD;
    const pz = { x: Math.cos(pDec) * Math.cos(pRa), y: Math.cos(pDec) * Math.sin(pRa), z: Math.sin(pDec) };
    const ref = Math.abs(pz.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    const ux = ref.y * pz.z - ref.z * pz.y;
    const uy = ref.z * pz.x - ref.x * pz.z;
    const uz = ref.x * pz.y - ref.y * pz.x;
    const uNorm = Math.sqrt(ux * ux + uy * uy + uz * uz);
    const u = { x: ux / uNorm, y: uy / uNorm, z: uz / uNorm };
    const w = { x: pz.y * u.z - pz.z * u.y, y: pz.z * u.x - pz.x * u.z, z: pz.x * u.y - pz.y * u.x };
    const points = new Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const theta = (i / (SAMPLES - 1)) * 2 * Math.PI;
      const x = Math.cos(theta) * u.x + Math.sin(theta) * w.x;
      const y = Math.cos(theta) * u.y + Math.sin(theta) * w.y;
      const z = Math.cos(theta) * u.z + Math.sin(theta) * w.z;
      const dec = Math.asin(Math.max(-1, Math.min(1, z))) * DEG;
      const ra = (((Math.atan2(y, x) * DEG) % 360) + 360) % 360;
      points[i] = [ra, dec];
    }
    return points;
  }

  return createGreatCircleLayer({
    sampleFn: () => _raDecTable || (_raDecTable = _sampleGreatCircle()),
    colors: {
      line: '#b09cc4',
      lineDay: '#b898d4',
      casing: '#181d23',
      casingDay: '#484848',
    },
    pane: 'galactic-equator',
    labelPane: 'galactic-equator-labels',
    paneZ: 616,
    labelPaneZ: 621,
    labelKey: 'overlay.galactic_equator',
    labelFallback: '银道',
    labelClass: 'galactic-equator-label',
  });
})();
