/** lunar-path.js — instantaneous lunar orbital plane projected on Earth.
 *
 * The lunar path is the great circle where the Moon's orbital plane intersects
 * the celestial sphere, projected onto Earth coordinates. Computed by
 * finding the orbital pole (r × v) and drawing the 90° great circle around it.
 *
 * Thin config wrapper around createGreatCircleLayer (great-circle-layer.js).
 * API: init(map), update(date), addTo(map), removeFrom(map), isOn().
 * Depends on: L, Astronomy (astronomy-engine), GeoUtils, I18n,
 *             createGreatCircleLayer, MAP_LNG_WEST/EAST.
 */
const LunarPath = (() => {
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const SAMPLES = 721;

  function _computeOrbitalPole(date) {
    const t0 = Astronomy.MakeTime(date);
    const dt = 60;
    const t1 = Astronomy.MakeTime(new Date(date.getTime() + dt * 1000));
    const r0 = Astronomy.GeoVector(Astronomy.Body.Moon, t0, true);
    const r1 = Astronomy.GeoVector(Astronomy.Body.Moon, t1, true);
    const vx = (r1.x - r0.x) / dt;
    const vy = (r1.y - r0.y) / dt;
    const vz = (r1.z - r0.z) / dt;
    const nx = r0.y * vz - r0.z * vy;
    const ny = r0.z * vx - r0.x * vz;
    const nz = r0.x * vy - r0.y * vx;
    const norm = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const ra = (((Math.atan2(ny, nx) * DEG) % 360) + 360) % 360;
    const dec = Math.asin(nz / norm) * DEG;
    return { ra, dec };
  }

  function _sampleGreatCircle(pole) {
    const pRa = pole.ra * RAD,
      pDec = pole.dec * RAD;
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
    sampleFn: (date) => _sampleGreatCircle(_computeOrbitalPole(date)),
    colors: {
      line: '#9fb4c4',
      lineDay: '#a8bfd0',
      casing: '#181d23',
      casingDay: '#484848',
    },
    pane: 'lunar-path',
    labelPane: 'lunar-path-labels',
    paneZ: 617,
    labelPaneZ: 622,
    labelKey: 'overlay.lunar_path',
    labelFallback: '白道',
    labelClass: 'lunar-path-label',
  });
})();
