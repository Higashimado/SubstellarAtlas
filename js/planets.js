/**
 * Celestial-body layers — unified luminosity model + phase-aware rendering.
 * IIFE pattern; exports a Planets global. Depends on Leaflet (L), Astronomy Engine
 * (Astronomy), Lum (luminosity.js), and globals defined in map.js
 * (placeWrappedPhaseIcons, placeWrappedLumBody, drawLabeledContour,
 * MAP_LNG_WEST, MAP_LNG_EAST).
 */

const Planets = (() => {
  // ---- Tiny Geometry Helpers ----
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  function rad(d) {
    return d * RAD;
  }

  function deg(r) {
    return r * DEG;
  }

  // ---- Body Position (RA / Dec in Radians) via Astronomy Engine ----
  function bodyPosition(date, body) {
    const t = Astronomy.MakeTime(date);
    const v = Astronomy.GeoVector(body, t, true);
    const d = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { alpha: Math.atan2(v.y, v.x), delta: Math.asin(v.z / d), dist: d };
  }

  // ---- Sun Altitude at a Body's Sub-Point ----
  // Sun altitude for an observer at the body's sub-point (body at zenith), used in
  // day-mode to fade body brightness across the twilight bands. The observer's LST
  // reduces to bodyRA, so the sun's hour angle H = bodyRA − sunRA (GMST and
  // observer longitude cancel out).
  function sunAltAtSubpoint(date, bodyRA, bodyDec) {
    const sun = bodyPosition(date, Astronomy.Body.Sun);
    const H = bodyRA - sun.alpha; // radians, sun's hour angle at body sub-point
    const sinAlt = Math.sin(bodyDec) * Math.sin(sun.delta) + Math.cos(bodyDec) * Math.cos(sun.delta) * Math.cos(H);
    return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
  }

  function _dayStrengthFromSunAlt(altDeg) {
    return typeof GeoUtils !== 'undefined' && GeoUtils.dayStrength
      ? GeoUtils.dayStrength(altDeg)
      : (function (a) {
          const t = Math.max(0, Math.min(1, (a + 18) / 18));
          return t * t * (3 - 2 * t);
        })(altDeg);
  }

  // ---- Geographic Sub-Point (the Point on Earth Where the Body Is at Zenith) ----
  // EQJ geocentric vector → of-date ground sub-point. The vector is EQJ (J2000
  // equator); it MUST be rotated to EQD (true equator of date) before its right
  // ascension is paired with apparent sidereal time (GAST). Pairing a raw J2000 RA
  // with of-date sidereal time trails the true sub-point by the precession
  // accumulated since J2000 (~0.4° by 2026) — the same EQJ/of-date frame mismatch the
  // day-veil terminator path corrects in map.js via _GAST + an EQJ→EQD rotation.
  function _eqjVecToSubPoint(date, vec) {
    const t = Astronomy.MakeTime(date);
    const v = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(t), vec);
    const d = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const gast = Astronomy.SiderealTime(t) * 15; // apparent sidereal time (deg) — pairs with EQD α
    const raw = deg(Math.atan2(v.y, v.x)) - gast;
    // distAU: geocentric distance — the body canvas paints far→near by this so the
    // nearer body occludes (the Moon, nearest, always lands on top).
    return { lat: deg(Math.asin(v.z / d)), lng: ((raw % 360) + 360) % 360, distAU: d };
  }

  function bodySubPoint(date, body) {
    return _eqjVecToSubPoint(date, Astronomy.GeoVector(body, Astronomy.MakeTime(date), true));
  }

  // ---- Anti-Body Sub-Point (Antipode of bodySubPoint) ----
  // Used as the centre of the "alt < 0" night cap that drawVisibilityRange
  // punches out of the rectangle to fill the visible (alt > 0) region.
  function antiBodySubPoint(date, body) {
    const sp = bodySubPoint(date, body);
    let antiLng = GeoUtils.normLng(sp.lng + 180);
    return { lat: -sp.lat, lng: antiLng };
  }

  // ---- Engraving Icon Config (High-Zoom Planet SVGs) ----
  const ENGRAVING = {
    mercury: {
      small: { src: 'img/mercury-small.svg', w: 16, h: 16 },
      large: { src: 'img/mercury-large.svg', w: 140, h: 140 },
    },
    venus: {
      small: { src: 'img/venus-small.svg', w: 16, h: 16 },
      large: { src: 'img/venus-large.svg', w: 140, h: 140 },
    },
    jupiter: {
      small: { src: 'img/jupiter-small.svg', w: 16, h: 16 },
      large: { src: 'img/jupiter-large.svg', w: 112, h: 112 },
    },
    saturn: {
      small: { src: 'img/saturn-small.svg', w: 34, h: 16 },
      large: { src: 'img/saturn-large.svg', w: 204, h: 84 },
    },
    mars: {
      small: { src: 'img/mars-small.svg', w: 16, h: 16 },
      large: { src: 'img/mars-large.svg', w: 112, h: 112 },
    },
    uranus: {
      small: { src: 'img/uranus-small.svg', w: 16, h: 16 },
      large: { src: 'img/uranus-large.svg', w: 132, h: 132 },
    },
    neptune: {
      small: { src: 'img/neptune-small.svg', w: 16, h: 16 },
      large: { src: 'img/neptune-large.svg', w: 132, h: 132 },
    },
    io: {
      small: { src: 'img/io-small.svg', w: 16, h: 16 },
      large: { src: 'img/io-large.svg', w: 124, h: 124 },
    },
    europa: {
      small: { src: 'img/europa-small.svg', w: 16, h: 16 },
      large: { src: 'img/europa-large.svg', w: 124, h: 124 },
    },
    ganymede: {
      small: { src: 'img/ganymede-small.svg', w: 16, h: 16 },
      large: { src: 'img/ganymede-large.svg', w: 124, h: 124 },
    },
    callisto: {
      small: { src: 'img/callisto-small.svg', w: 16, h: 16 },
      large: { src: 'img/callisto-large.svg', w: 124, h: 124 },
    },
    titan: {
      small: { src: 'img/titan-small.svg', w: 16, h: 16 },
      large: { src: 'img/titan-large.svg', w: 124, h: 124 },
    },
    rhea: {
      small: { src: 'img/rhea-small.svg', w: 16, h: 16 },
      large: { src: 'img/rhea-large.svg', w: 124, h: 124 },
    },
    iapetus: {
      small: { src: 'img/iapetus-small.svg', w: 16, h: 16 },
      large: { src: 'img/iapetus-large.svg', w: 124, h: 124 },
    },
    ceres: {
      small: { src: 'img/ceres-small.svg', w: 18, h: 18 },
      large: { src: 'img/ceres-large.svg', w: 126, h: 126 },
    },
    vesta: {
      small: { src: 'img/vesta-small.svg', w: 18, h: 18 },
      large: { src: 'img/vesta-large.svg', w: 126, h: 121 },
    },
    pallas: {
      small: { src: 'img/pallas-small.svg', w: 19, h: 16 },
      large: { src: 'img/pallas-large.svg', w: 131, h: 108 },
    },
  };

  // Planet equatorial diameters (km).  Saturn uses ring-inclusive extent.
  const BODY_DIAM_KM = {
    mercury: 4879,
    venus: 12104,
    mars: 6779,
    jupiter: 139822,
    saturn: 270000,
    uranus: 50724,
    neptune: 49244,
    moon: 3474,
  };

  // Disk (body-only) diameters for apparent angular diameter display. Saturn's
  // ring-inclusive BODY_DIAM_KM gives the correct icon footprint, but the
  // apparent diameter shown in the almanac should be the bare spheroid — 120536 km
  // is Saturn's IAU equatorial radius × 2.
  const BODY_DISK_DIAM_KM = {
    mercury: 4879,
    venus: 12104,
    mars: 6779,
    jupiter: 139822,
    saturn: 120536,
    uranus: 50724,
    neptune: 49244,
    moon: 3474,
  };

  // Major-moon diameters (km), used to size engraving disks by real angular
  // extent through the same footprint chain as the planets — so a moon disk is
  // always proportional to, and smaller than, its parent planet's.
  const MOON_DIAM_KM = {
    io: 3643,
    europa: 3122,
    ganymede: 5268,
    callisto: 4821,
    titan: 5150,
    rhea: 1527,
    iapetus: 1469,
  };

  const EARTH_R_KM = 6371.0;
  const AU_KM = 149597870.7;

  function footprintKmFromDist(diamKm, distAU) {
    const angDiam = diamKm / (distAU * AU_KM);
    return EARTH_R_KM * angDiam;
  }

  function bodyFootprintKm(body, bodyId, date) {
    const t = Astronomy.MakeTime(date);
    const v = Astronomy.GeoVector(body, t, true);
    const distAU = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return footprintKmFromDist(BODY_DIAM_KM[bodyId] || 1, distAU);
  }

  function bodyAngularDiamArcsec(body, bodyId, date) {
    try {
      const t = Astronomy.MakeTime(date);
      const v = Astronomy.GeoVector(body, t, true);
      const distAU = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      const diamKm = BODY_DISK_DIAM_KM[bodyId];
      if (!diamKm || !distAU) return NaN;
      return (diamKm / (distAU * AU_KM)) * 206265;
    } catch (_) {
      return NaN;
    }
  }

  // ---- Disk Rasterization Cap ----
  //
  // An SVG <image> (or <img src="….svg">) is rasterized by the browser at its
  // DISPLAY size, so a disk drawn at fpPx px paints an fpPx² bitmap. At high zoom
  // a body footprint reaches many hundreds of px — moon-xlarge.svg (1169 paths)
  // at 1000px is a ~4 MB GPU texture, multiplied by every body and every wrapped
  // world copy. That resident texture set overruns the GPU's VRAM budget and
  // thrashes (evict + re-upload) on each recomposite, which is the documented
  // high-zoom stall. Cap the rasterization at CAP px and CSS-transform:scale()
  // the disk up to its true visual size: above the cap the element size is
  // constant, so the browser rasterizes once and only the compositor transform
  // changes on zoom. The texture stays CAP²; the upscale is a cheap GPU blit.
  // Slight softening past the cap is acceptable for a stylized engraving and
  // reads like telescopic blur. Capping the render radius also collapses the
  // _phaseCache key space above the cap, so the SVG string is reused too.
  const DISK_RASTER_CAP_PX = 512;

  function diskRenderSize(fpPx) {
    return Math.min(fpPx, DISK_RASTER_CAP_PX);
  }

  // Wrap disk content (built at renderW×renderH) so it visually fills
  // visualW×visualH while its backing raster stays the render size. The uniform
  // scale preserves aspect; transform-origin 0 0 keeps the scaled box anchored at
  // the divIcon's top-left, so the visual center still lands on iconAnchor.
  function scaleDiskWrap(innerHtml, renderW, renderH, visualW, visualH) {
    if (visualW <= renderW + 0.5 && visualH <= renderH + 0.5) return innerHtml;
    const k = visualW / renderW;
    return (
      '<div style="width:' +
      renderW +
      'px;height:' +
      renderH +
      'px;transform:scale(' +
      k.toFixed(4) +
      ');transform-origin:0 0">' +
      innerHtml +
      '</div>'
    );
  }

  // Build engraving SVG icon(s) with LOD crossfade between small and large.
  // Returns { html, width, height } suitable for diskHtml in placeWrappedLumBody.
  function buildEngravingIconLOD(planetId, fpPx, diskAlpha) {
    const e = ENGRAVING[planetId];
    const lodMix = Lum.smoothstep(14, 22, fpPx); // 0 = small only, 1 = large only

    // Container sized to the dominant variant (large when lodMix>0.5, else small)
    const dom = lodMix > 0.5 ? e.large : e.small;
    const domAspect = dom.w / dom.h;
    const visualW = Math.max(6, Math.round(domAspect >= 1 ? fpPx : fpPx * domAspect));
    const visualH = Math.max(6, Math.round(domAspect >= 1 ? fpPx / domAspect : fpPx));
    // Cap rasterization: render at a scaled-down size whose larger edge ≤ CAP,
    // then transform:scale() back up (uniform scale preserves the ring aspect).
    const k = Math.max(visualW, visualH) > DISK_RASTER_CAP_PX ? Math.max(visualW, visualH) / DISK_RASTER_CAP_PX : 1;
    const renderW = Math.max(6, Math.round(visualW / k));
    const renderH = Math.max(6, Math.round(visualH / k));

    function makeImg(variant, opacity) {
      const aspect = variant.w / variant.h;
      let w, h;
      if (aspect >= 1) {
        w = renderW;
        h = Math.max(6, Math.round(renderW / aspect));
      } else {
        h = renderH;
        w = Math.max(6, Math.round(renderH * aspect));
      }
      return (
        '<img src="' +
        variant.src +
        '" width="' +
        w +
        '" height="' +
        h +
        '" style="display:block;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);opacity:' +
        opacity.toFixed(3) +
        '">'
      );
    }

    let parts = [];
    parts.push('<div style="position:relative;width:' + renderW + 'px;height:' + renderH + 'px">');

    // Snap the disc opacity ramp (6,40)→(6,20) so once the body is "visible" the
    // LOD layers are fully opaque and grid lines behind no longer bleed through.
    const dAEff = Math.min(1, diskAlpha * 2);
    if (lodMix < 0.99) parts.push(makeImg(e.small, dAEff * (1 - lodMix)));
    if (lodMix > 0.01) parts.push(makeImg(e.large, dAEff * lodMix));

    parts.push('</div>');
    const html = scaleDiskWrap(parts.join(''), renderW, renderH, visualW, visualH);
    return { html: html, width: visualW, height: visualH };
  }

  // ---- Phased Engraving Icon (LOD Crossfade + Elliptical Terminator) ----
  // For square-aspect planets (mercury/venus/mars/jupiter/uranus/neptune). Each
  // LOD variant texture is plugged into buildPhasedDiskSVG as the lit-region
  // image; small/large variants crossfade by opacity exactly like
  // buildEngravingIconLOD. Saturn is NOT routed here (rings + non-square asset).
  function buildPhasedEngravingIcon(planetId, fpPx, diskAlpha, i, chi) {
    const e = ENGRAVING[planetId];
    const lodMix = Lum.smoothstep(14, 22, fpPx);

    const visualSz = Math.max(6, Math.round(fpPx));
    const renderSz = Math.max(6, Math.round(diskRenderSize(fpPx)));
    const R = renderSz / 2;

    function makeSvg(variant, opacity) {
      const svg = buildPhasedDiskSVG(R, i, chi, {
        litImageHref: variant.src,
        darkColor: '#0a0c10',
      });
      return (
        '<div style="position:absolute;left:50%;top:50%;width:' +
        renderSz +
        'px;height:' +
        renderSz +
        'px;transform:translate(-50%,-50%);opacity:' +
        opacity.toFixed(3) +
        '">' +
        svg +
        '</div>'
      );
    }

    const parts = [];
    parts.push('<div style="position:relative;width:' + renderSz + 'px;height:' + renderSz + 'px">');
    // Same opacity ramp snap as buildEngravingIconLOD — see comment there.
    const dAEff = Math.min(1, diskAlpha * 2);
    if (lodMix < 0.99) parts.push(makeSvg(e.small, dAEff * (1 - lodMix)));
    if (lodMix > 0.01) parts.push(makeSvg(e.large, dAEff * lodMix));
    parts.push('</div>');
    const html = scaleDiskWrap(parts.join(''), renderSz, renderSz, visualSz, visualSz);
    return { html: html, width: visualSz, height: visualSz };
  }

  // ---- Body Configs ----
  const _t =
    typeof I18n !== 'undefined'
      ? I18n.t.bind(I18n)
      : function (k) {
          return k;
        };
  // ` data-gloss="…"` attribute for a term label (shared themed glossary tooltip).
  const _glossAttr =
    typeof I18n !== 'undefined'
      ? I18n.glossAttr.bind(I18n)
      : function () {
          return '';
        };

  const MOON_CORE_COLOR = '#e0dde6'; // cool silver (oklch ~0.92 0.012 250)
  const MOON_GLOW_COLOR = '#9fb4c4'; // cool silver-blue

  const CONFIGS = [
    {
      body: Astronomy.Body.Moon,
      id: 'moon',
      get name() {
        return _t('planet.moon');
      },
      symbol: '☾',
      color: '#94a3b8',
      labelColor: '#cbd5e1',
    },
    {
      body: Astronomy.Body.Mercury,
      id: 'mercury',
      get name() {
        return _t('planet.mercury');
      },
      symbol: '☿',
      color: '#a8a29e',
      labelColor: '#d6d3d1',
    },
    {
      body: Astronomy.Body.Venus,
      id: 'venus',
      get name() {
        return _t('planet.venus');
      },
      symbol: '♀',
      color: '#f59e0b',
      labelColor: '#fde68a',
    },
    {
      body: Astronomy.Body.Mars,
      id: 'mars',
      get name() {
        return _t('planet.mars');
      },
      symbol: '♂',
      color: '#ef4444',
      labelColor: '#fecaca',
    },
    {
      body: Astronomy.Body.Jupiter,
      id: 'jupiter',
      get name() {
        return _t('planet.jupiter');
      },
      symbol: '♃',
      color: '#f97316',
      labelColor: '#fed7aa',
    },
    {
      body: Astronomy.Body.Saturn,
      id: 'saturn',
      get name() {
        return _t('planet.saturn');
      },
      symbol: '♄',
      color: '#eab308',
      labelColor: '#fef08a',
    },
    {
      body: Astronomy.Body.Uranus,
      id: 'uranus',
      get name() {
        return _t('planet.uranus');
      },
      symbol: '⛢',
      color: '#9fc9dc',
      labelColor: '#bfd7e2',
    },
    {
      body: Astronomy.Body.Neptune,
      id: 'neptune',
      get name() {
        return _t('planet.neptune');
      },
      symbol: '♆',
      color: '#6ea0d8',
      labelColor: '#9eb6e0',
    },
  ];

  // ---- Position Angle of Point-2 From Point-1 (Radians, From North Through East) ----
  function positionAngle(ra1, dec1, ra2, dec2) {
    const dRA = ra2 - ra1;
    const sinPA = Math.cos(dec2) * Math.sin(dRA);
    const cosPA = Math.sin(dec2) * Math.cos(dec1) - Math.cos(dec2) * Math.sin(dec1) * Math.cos(dRA);
    return Math.atan2(sinPA, cosPA);
  }

  // ---- Unique ID Counter for SVG clipPath ----
  let _iconId = 0;

  // ---- Pick Moon SVG LOD Variant Based on Footprint Pixels ----
  // The caller floors fpPx to moonMinDiskPx (32) before painting, so the disk
  // never shrinks into the small-tier (<22px) range — only the large↔xlarge
  // crossfade is reachable here.
  function moonSvgSrc(fpPx) {
    return Lum.smoothstep(80, 160, fpPx) > 0.5 ? 'img/moon-xlarge.svg' : 'img/moon-large.svg';
  }

  // ---- Generic Phased-Disk SVG Generator (Moon + Inner/Outer Planets) ----
  //   R          disk radius (px)
  //   i          phase angle (rad). 0 = full, π = new. Terminator semi-minor = R·cos(i).
  //   chi        bright-limb position angle (rad), north through east.
  //   opts:
  //     baseImageHref   moon-only: full texture under dark overlay → earthshine look
  //     litImageHref    planet textures: clip to lit region
  //     litColor        solid lit color (used when neither image href given)
  //     darkColor       solid color drawn as disk floor (default #0e1014)
  //     darkOverlayAlpha  alpha for the dark overlay over baseImageHref (default 0.75)
  // Rotation derivation (deg = (chi − π/2) · 180/π): standard pose places lit
  // limb mid-point at (R, 0); applying SVG rotate(α) maps it to (R·cos α,
  // R·sin α). Solving for the target screen point (R·sin χ, −R·cos χ) gives
  // α = χ − π/2.
  //
  // Sweep-flag mapping (matches spec §2.2): the second arc goes from (0, R)
  // to (0, -R). In SVG y-down, sweep=1 = parameter angle increasing = visually
  // CW = the arc passes through (-|b|, 0) [left]; sweep=0 = visually CCW =
  // passes through (+|b|, 0) [right]. Closing M(0,-R)→right semi→(0,R)→arc:
  //   gibbous (b ≥ 0) + sweep=1 → encloses disk minus thin left lens (lit > 50%)
  //   crescent (b < 0) + sweep=0 → encloses thin right lens only (lit < 50%)
  //   b = 0 (quarter)       → arc degenerates to vertical line, lit = right half
  const _phaseCache = new Map();
  const _PHASE_CACHE_LIMIT = 256;

  function buildPhasedDiskSVG(R, i, chi, opts) {
    const baseHref = opts.baseImageHref || '';
    const litHref = opts.litImageHref || '';
    const litColor = opts.litColor || '#e0dde6';
    const darkColor = opts.darkColor || '#0e1014';
    const darkOverlayAlpha = opts.darkOverlayAlpha != null ? opts.darkOverlayAlpha : 0.75;
    // Moon-only extras:
    //   texRotDeg — lunar north-pole position angle. The SURFACE texture is
    //     rotated by this (a continuous, slowly-varying quantity) instead of by
    //     the bright-limb angle chi; otherwise the texture spins ~360°/synodic
    //     month and appears to flip across full/new moon. Only the terminator
    //     boundary tracks chi.
    //   shadow — live Earth-shadow geometry (EclipseGlyph.lunarShadowAt); when
    //     present, a red umbra/penumbra "bite" is clipped onto the disk.
    const texRotDeg = opts.texRotDeg || 0;
    const shadow = opts.shadow || null;

    const mode = baseHref ? 'B' : litHref ? 'L' : 'C';
    const shSig = shadow
      ? shadow.sep.toFixed(5) +
        ',' +
        shadow.pa.toFixed(3) +
        ',' +
        shadow.rho_umbra.toFixed(5) +
        ',' +
        shadow.rho_penum.toFixed(5)
      : '';
    const cacheKey =
      mode +
      '|' +
      R +
      '|' +
      (baseHref || litHref) +
      '|' +
      i.toFixed(2) +
      '|' +
      chi.toFixed(2) +
      '|' +
      texRotDeg.toFixed(1) +
      '|' +
      shSig +
      '|' +
      litColor +
      '|' +
      darkColor +
      '|' +
      darkOverlayAlpha.toFixed(2);
    const hit = _phaseCache.get(cacheKey);
    if (hit) return hit;

    const sz = 2 * R;
    const b = R * Math.cos(i);
    const absB = Math.abs(b);
    const sweep = b >= 0 ? 1 : 0; // gibbous (b≥0): arc through left  → lit>50%
    // crescent (b<0): arc through right → lit<50%
    const degLit = (chi - Math.PI / 2) * DEG; // terminator/bright-limb angle

    const litPath =
      'M0,' +
      (-R).toFixed(2) +
      ' A' +
      R.toFixed(2) +
      ',' +
      R.toFixed(2) +
      ' 0 0 1 0,' +
      R.toFixed(2) +
      ' A' +
      absB.toFixed(2) +
      ',' +
      R.toFixed(2) +
      ' 0 0 ' +
      sweep +
      ' 0,' +
      (-R).toFixed(2) +
      ' Z';

    const id = 'ph' + ++_iconId;
    const minXY = -R;
    const imgAttrs =
      'x="' +
      minXY.toFixed(2) +
      '" y="' +
      minXY.toFixed(2) +
      '" width="' +
      sz +
      '" height="' +
      sz +
      '" preserveAspectRatio="none"';

    const parts = [];
    parts.push(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        sz +
        '" height="' +
        sz +
        '" viewBox="' +
        minXY +
        ' ' +
        minXY +
        ' ' +
        sz +
        ' ' +
        sz +
        '">'
    );

    if (mode === 'B') {
      // Moon: texture oriented by lunar north-pole PA (texRotDeg), terminator
      // boundary by chi (degLit) — DECOUPLED. The clip path carries its own
      // rotate(degLit) in root user space (its referencing <g> is untransformed),
      // so the lit boundary lands at degLit regardless of the texture rotation.
      const texT = ' transform="rotate(' + texRotDeg.toFixed(2) + ')"';
      parts.push(
        '<defs><clipPath id="' +
          id +
          '"><path d="' +
          litPath +
          '" transform="rotate(' +
          degLit.toFixed(2) +
          ')"/></clipPath></defs>'
      );
      parts.push('<image href="' + baseHref + '" ' + imgAttrs + texT + '/>');
      parts.push(
        '<circle cx="0" cy="0" r="' +
          R.toFixed(2) +
          '" fill="' +
          darkColor +
          '" opacity="' +
          darkOverlayAlpha.toFixed(3) +
          '"/>'
      );
      parts.push('<g clip-path="url(#' + id + ')"><image href="' + baseHref + '" ' + imgAttrs + texT + '/></g>');
      // Live Earth-shadow bite — same geometry as the sidebar card glyph
      // (eclipse-glyph.js lunarUmbra/lunarPenumbra), in the screen-north frame,
      // clipped to the moon disk. Grows from one limb (partial) to whole disk
      // (totality, sep < rho_umbra − sd).
      if (shadow && shadow.penumbralMag > 0) {
        const sd = shadow.sd_primary;
        const amp = (R * shadow.sep) / sd;
        const bdx = (-amp * Math.sin(shadow.pa)).toFixed(2);
        const bdy = (-amp * Math.cos(shadow.pa)).toFixed(2);
        const bite = [];
        if (shadow.penumbralMag > 0) {
          const rp = ((R * shadow.rho_penum) / sd).toFixed(2);
          bite.push(
            '<circle cx="' + bdx + '" cy="' + bdy + '" r="' + rp + '" fill="var(--ecl-penumbra)" opacity="0.4"/>'
          );
        }
        if (shadow.umbralMag > 0) {
          const ru = ((R * shadow.rho_umbra) / sd).toFixed(2);
          bite.push('<circle cx="' + bdx + '" cy="' + bdy + '" r="' + ru + '" fill="var(--ecl-umbra)" opacity="0.8"/>');
        }
        const dskId = 'dsk' + _iconId;
        parts.push(
          '<defs><clipPath id="' + dskId + '"><circle cx="0" cy="0" r="' + R.toFixed(2) + '"/></clipPath></defs>'
        );
        parts.push('<g clip-path="url(#' + dskId + ')">' + bite.join('') + '</g>');
      }
    } else if (mode === 'L') {
      // Inner / outer planet textures: dark floor + lit-clipped texture.
      parts.push('<defs><clipPath id="' + id + '"><path d="' + litPath + '"/></clipPath></defs>');
      parts.push('<g transform="rotate(' + degLit.toFixed(2) + ')">');
      parts.push('<circle cx="0" cy="0" r="' + R.toFixed(2) + '" fill="' + darkColor + '"/>');
      parts.push('<image href="' + litHref + '" ' + imgAttrs + ' clip-path="url(#' + id + ')"/>');
      parts.push('</g>');
    } else {
      // Pure-color fallback (spec §2.2 default).
      parts.push('<defs><clipPath id="' + id + '"><path d="' + litPath + '"/></clipPath></defs>');
      parts.push('<g transform="rotate(' + degLit.toFixed(2) + ')">');
      parts.push('<circle cx="0" cy="0" r="' + R.toFixed(2) + '" fill="' + darkColor + '"/>');
      parts.push('<path d="' + litPath + '" fill="' + litColor + '"/>');
      parts.push('</g>');
    }

    parts.push('</svg>');
    const svg = parts.join('');

    if (_phaseCache.size >= _PHASE_CACHE_LIMIT) {
      // Simple FIFO trim — keys are ordered by insertion.
      const firstKey = _phaseCache.keys().next().value;
      if (firstKey !== undefined) _phaseCache.delete(firstKey);
    }
    _phaseCache.set(cacheKey, svg);
    return svg;
  }

  // ---- Build Phase-Aware SVG Icon String for Moon (High-Zoom Footprint Disk) ----
  function buildMoonDiskHtml(illum, paDeg, fpPx, diskAlpha, northPADeg, shadow) {
    const visualSz = Math.max(4, Math.round(fpPx));
    const renderSz = Math.max(4, Math.round(diskRenderSize(fpPx)));
    const R = renderSz / 2;
    const i = rad(illum.phase_angle);
    const chi = rad(paDeg);

    const svg = buildPhasedDiskSVG(R, i, chi, {
      baseImageHref: moonSvgSrc(fpPx),
      darkColor: '#0e1014',
      darkOverlayAlpha: 0.75,
      texRotDeg: northPADeg || 0,
      shadow: shadow || null,
    });
    // The native dA = smoothstep(6, 40, fpPxEff) often plateaus around 0.76
    // at the typical fpPxEff=32 floor, which leaves the disc permanently
    // ~76% opaque — grid lines behind it (ecliptic / lunar path) leak
    // through. Tighten the visible-disc ramp to (6, 20): once fpPxEff is
    // halfway across the original range, the disc is fully opaque.
    const wrapperOpacity = Math.min(1, diskAlpha * 2);
    const clipped =
      '<div style="width:' +
      renderSz +
      'px;height:' +
      renderSz +
      'px;border-radius:50%;overflow:hidden;opacity:' +
      wrapperOpacity.toFixed(3) +
      '">' +
      svg +
      '</div>';
    const html = scaleDiskWrap(clipped, renderSz, renderSz, visualSz, visualSz);
    return { html: html, size: visualSz };
  }

  // Saturn's ringed asset is width-fit to its ring-inclusive box, so at an event
  // icon's small size its disc renders far smaller than the square-aspect planets
  // beside it. For the sidebar cards we oversize the render so Saturn's disc reads
  // as one of the family (SAT_ICON_DISC_BOOST, tuned to ~14px — comfortably under
  // the ~20px peer disc so the ring keeps a modest footprint and does not dominate
  // the row), then tilt the whole glyph well past the ring's own spread so it runs
  // diagonally and clears the adjacent slot instead of bleeding straight across it.
  // Map markers keep the wide flat footprint (they call buildEngravingIconLOD
  // directly), so this treatment stays inside buildEventDiskIcon. The wider layout
  // footprint the tilted ring needs is reserved in CSS (.pev-card .ec-glyph /
  // .pev-glyph-slot), applied to every planet-event card so the text column starts
  // at the same x regardless of whether Saturn is present — not a Saturn-only text
  // shift.
  const SAT_ICON_DISC_BOOST = 1.8;
  const SAT_ICON_TILT_DEG = 40;
  // Asteroids have negligible phase angle (≤6°, always near-full), so the event
  // icon is a flat engraving disk at 0.8× the slot size.
  const AST_ICON_SCALE = 0.8;

  // The outer span holds a slot-sized layout footprint so the flex row is not
  // shoved by the oversized art; the inner span overflows and rotates about the
  // disc centre, which sits at the box centre of the LOD render.
  function buildSaturnEventIcon(sizePx) {
    const art = buildEngravingIconLOD('saturn', Math.round(sizePx * SAT_ICON_DISC_BOOST), 1).html;
    return (
      '<span class="pev-saturn-icon" style="position:relative;display:inline-block;vertical-align:middle;overflow:visible;width:' +
      sizePx +
      'px;height:' +
      sizePx +
      'px"><span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-' +
      SAT_ICON_TILT_DEG +
      'deg)">' +
      art +
      '</span></span>'
    );
  }

  function buildAsteroidEventIcon(bodyId, sizePx) {
    const fpPx = Math.round(sizePx * AST_ICON_SCALE);
    const { html, width, height } = buildEngravingIconLOD(bodyId, fpPx, 1);
    return (
      '<span style="display:inline-flex;align-items:center;justify-content:center;width:' +
      sizePx +
      'px;height:' +
      sizePx +
      'px">' +
      html +
      '</span>'
    );
  }

  // ---- Build a Small Phased Disk Icon for Non-Map Contexts (e.g. Sidebar Cards) ----
  // Same phase/bright-limb math as the map markers above, sized for an inline
  // fixed-size icon rather than a zoom-dependent footprint — no LOD crossfade
  // needed at these small sizes. Saturn skips the terminator (imperceptible
  // phase from Earth, same treatment as its map marker).
  function buildEventDiskIcon(bodyId, date, sizePx) {
    // Asteroids are not AE Body constants; they use a flat engraving icon.
    if (ENGRAVING[bodyId] && !CONFIGS.find((c) => c.id === bodyId)) return buildAsteroidEventIcon(bodyId, sizePx);
    const cfg = CONFIGS.find((c) => c.id === bodyId);
    if (!cfg) return '';
    const bodyPos = bodyPosition(date, cfg.body);
    const sunPos = bodyPosition(date, Astronomy.Body.Sun);
    const illum = Astronomy.Illumination(cfg.body, date);
    if (bodyId === 'moon') {
      const paDeg = deg(positionAngle(bodyPos.alpha, bodyPos.delta, sunPos.alpha, sunPos.delta));
      return buildMoonDiskHtml(illum, paDeg, sizePx, 1, 0, null).html;
    }
    if (bodyId === 'saturn') return buildSaturnEventIcon(sizePx);
    const i = rad(illum.phase_angle);
    const chi = positionAngle(bodyPos.alpha, bodyPos.delta, sunPos.alpha, sunPos.delta);
    return buildPhasedEngravingIcon(bodyId, sizePx, 1, i, chi).html;
  }

  // ---- Build Luminosity-Model Markers for Any Body ----
  function placeLumBody(lat, lng, mag, bodyColor, glowColor, zoom, group, tooltipText, onClick, diskHtml) {
    const scale = Lum.zoomScale(zoom);
    const sp = Lum.spriteRadii(mag, scale);
    const hasGlow = sp.glow > sp.core;

    const glowSpec =
      hasGlow || sp.glare > 0
        ? {
            coreR: sp.core,
            glowR: sp.glow,
            glareR: sp.glare,
            coreCol: bodyColor,
            tint: glowColor,
            alpha: 1,
          }
        : null;

    const coreOpts = {
      radius: sp.core,
      fillColor: bodyColor,
      fillOpacity: Lum.coreOpacity(sp.lnB),
      stroke: hasGlow,
      color: 'rgba(0,0,0,0.25)',
      weight: hasGlow ? 0.8 : 0,
      opacity: hasGlow ? 1 : 0,
      interactive: true,
    };

    placeWrappedLumBody(lat, lng, coreOpts, glowSpec, diskHtml, group, tooltipText, onClick);
  }

  // Module-scoped click handler
  let _onBodyClick = null;
  let _onBodyContextMenu = null;

  // ---- Create All Planet Layers (Initial Setup) ----
  function init(map, date, onBodyClick, onBodyContextMenu) {
    _onBodyClick = onBodyClick || null;
    _onBodyContextMenu = onBodyContextMenu || null;
    const sunPos = bodyPosition(date, Astronomy.Body.Sun);
    const zoom = map.getZoom();

    return CONFIGS.map((cfg) => {
      const sp = bodySubPoint(date, cfg.body);
      const entry = {
        config: cfg,
        markerLayer: null,
        contourLayer: null,
        markerGroup: null,
        linesGroup: null,
        labelsGroup: null,
      };
      const onClick = _onBodyClick ? (ev) => _onBodyClick(entry, ev) : null;
      const onContextMenu = _onBodyContextMenu ? (ev) => _onBodyContextMenu(entry, ev) : null;

      const markerGroup = L.layerGroup();
      placeBodyMarker(cfg, date, sunPos, sp, zoom, markerGroup, onClick, onContextMenu);
      const markerLayer = L.layerGroup([markerGroup]);

      // Visibility-range overlay: bold 0° altitude boundary + low-α
      // colour fill in body-vis pane (z=180).
      const linesGroup = L.layerGroup();
      const labelsGroup = L.layerGroup(); // kept for entry-shape compatibility
      const fillGroup = L.layerGroup();

      const mag = (function () {
        try {
          return Astronomy.Illumination(cfg.body, date).mag;
        } catch (_) {
          return 0;
        }
      })();
      // Planets lock fillOpacity at 0.04; moon keeps the dynamic mag-derived
      // alpha so a full moon's vis range reads visually heavier than a new one.
      const _visOpts = cfg.id === 'moon' ? undefined : { fillOpacity: 0.04 };
      drawVisibilityRange(antiBodySubPoint(date, cfg.body), cfg, mag, linesGroup, fillGroup, _visOpts);
      const contourLayer = L.layerGroup([linesGroup, fillGroup, labelsGroup]);

      entry.markerLayer = markerLayer;
      entry.contourLayer = contourLayer;
      entry.markerGroup = markerGroup;
      entry.linesGroup = linesGroup;
      entry.labelsGroup = labelsGroup;
      entry.fillGroup = fillGroup;
      return entry;
    });
  }

  // Day-mode flag — set by map.js when the white-veil dayMaskGroup goes on
  // the map. Halos desaturate toward white so they don't stack as warm
  // blobs on the bright background; the matching CSS screen-blend rule
  // (see body.day-mask-active in style.css) then fades them into the veil.
  let _dayModeActive = false;
  function setDayMode(active) {
    _dayModeActive = !!active;
  }

  // Apply day-mode tint adjustment to a colors {core, halo} pair from
  // Lum.colorForBody. Halo gets the heavy hit (0.70 toward white); core
  // gets a much lighter nudge so the body disk stays recognizable.
  function _dayTinted(colors) {
    if (!_dayModeActive) return colors;
    return {
      core: Lum.desaturateForDay(colors.core, 0.25),
      halo: Lum.desaturateForDay(colors.halo, 0.7),
      disk: colors.disk,
    };
  }

  // ---- Unified Marker Placement for a Single Body ----
  function placeBodyMarker(cfg, date, sunPos, sp, zoom, group, onClick, onContextMenu) {
    const illum = Astronomy.Illumination(cfg.body, date);
    const mag = illum.mag;

    // Label visibility: moon has obvious disk; sun handled separately in map.js.
    // Other planets follow the same zoom-adaptive mag cutoff as star labels.
    let _magCutoff = zoom <= 3 ? 2.0 : zoom <= 5 ? 3.0 : zoom <= 6 ? 4.5 : zoom <= 7 ? 5.5 : 7.0;
    // Day mode also drops planet-label cutoff 1 mag, in lockstep with sky.js
    // star-label cutoff — dim planets shouldn't be labeled when their sub-point
    // sits in bright daylight.
    if (_dayModeActive && cfg.id !== 'moon') _magCutoff -= 1.0;
    const bodyLabel = cfg.id === 'moon' ? null : mag <= _magCutoff ? cfg.name : null;

    // Day-mode brightness fade — applied to non-moon planets (moon stays
    // full strength under the day veil since it's physically visible by
    // day fairly often). Compute the sun's altitude at this body's
    // sub-point; smoothstep -18°..0° gives "day strength" ∈ [0, 1].
    // Final dayFade ∈ [0.15, 1.0]: planet on full day → 15% brightness
    // (≈ 2 mag dim), planet on night → unchanged.
    let dayFade = 1.0;
    if (_dayModeActive && cfg.id !== 'moon') {
      const bp = bodyPosition(date, cfg.body);
      const sunAlt = sunAltAtSubpoint(date, bp.alpha, bp.delta);
      const s = _dayStrengthFromSunAlt(sunAlt);
      // Coefficient 0.40 so a planet ends up brighter than a star of the same mag
      // in daylight (Venus stays visible after stars vanish). Higher = more fade.
      dayFade = 1 - 0.4 * s;
    }

    // Compute ground footprint for this body at current zoom
    const fpKm = bodyFootprintKm(cfg.body, cfg.id, date);
    const fpPx = Lum.footprintPx(zoom, fpKm, sp.lat);

    const bodyPane = 'body-' + cfg.id;

    if (cfg.id === 'moon') {
      // Stellarium-style display floor: the natural angular footprint at minZoom
      // is ~1.5px (Moon ≈ 30 arcmin), collapsing to a core dot with no phased disk.
      // Clamp to a minimum px (default 32, Lum.params.moonMinDiskPx) until natural
      // fpPx catches up (~z=6.4 at lat=0).
      const floor = (Lum.params && Lum.params.moonMinDiskPx) || 32;
      const fpPxEff = Math.max(fpPx, floor);
      const dA = Lum.smoothstep(6, 40, fpPxEff);
      let diskHtml = null;
      if (dA > 0.01) {
        const bodyPos = bodyPosition(date, cfg.body);
        const pa = deg(positionAngle(bodyPos.alpha, bodyPos.delta, sunPos.alpha, sunPos.delta));
        // Lunar north-pole position angle — orients the surface texture
        // continuously (decoupled from the bright-limb angle, which would spin
        // the texture with phase). RotationAxis.ra is in sidereal hours.
        let northPADeg = 0;
        try {
          const ax = Astronomy.RotationAxis(cfg.body, Astronomy.MakeTime(date));
          northPADeg = deg(positionAngle(bodyPos.alpha, bodyPos.delta, rad(ax.ra * 15), rad(ax.dec)));
        } catch (_) {
          /* keep texture upright if axis unavailable */
        }
        // Live Earth-shadow geometry → red umbra/penumbra bite during eclipses.
        const shadow =
          typeof EclipseGlyph !== 'undefined' && EclipseGlyph.lunarShadowAt ? EclipseGlyph.lunarShadowAt(date) : null;
        diskHtml = buildMoonDiskHtml(illum, pa, fpPxEff, dA, northPADeg, shadow);
      }
      const glowRetire = 1 - 0.7 * dA;
      const scale = Lum.zoomScale(zoom);
      const sr = Lum.spriteRadii(mag, scale);
      // Pass real-time apparent magnitude so the halo strength
      // follows phase (mag −12 full → strong bloom, mag −5 quarter → weaker).
      const colors = _dayTinted(Lum.colorForBody('Moon', scale, mag));
      const hasGlow = sr.glow > sr.core;

      const glowSpec =
        hasGlow || sr.glare > 0
          ? {
              coreR: sr.core,
              glowR: sr.glow,
              glareR: sr.glare,
              coreCol: colors.core,
              tint: colors.halo,
              alpha: glowRetire,
            }
          : null;

      const coreOpts = {
        pane: bodyPane,
        radius: sr.core,
        fillColor: colors.core,
        fillOpacity: Lum.coreOpacity(sr.lnB) * (1 - dA),
        stroke: false,
        interactive: true,
      };
      placeWrappedLumBody(
        sp.lat,
        sp.lng,
        coreOpts,
        glowSpec,
        diskHtml,
        group,
        cfg.name,
        onClick,
        onContextMenu,
        bodyLabel,
        cfg.id,
        sp.distAU
      );
    } else if (ENGRAVING[cfg.id]) {
      const scale = Lum.zoomScale(zoom);
      const sr = Lum.spriteRadii(mag, scale);
      // Reveal the disk by its size relative to the glow bloom, not absolute px:
      // a disk much smaller than the glow stays hidden so the glow's bright
      // center reads as a dense point, and only takes over as it grows to the
      // glow's scale. The glow and core dot retire by the same ramp.
      const reveal = Lum.diskGlowReveal(fpPx, sr.glow);
      const glowRetire = (1 - reveal) * dayFade;

      const bodyName = cfg.id.charAt(0).toUpperCase() + cfg.id.slice(1);
      // Pass real-time apparent magnitude. Engraving SVG disk
      // (e.g. jupiter-large.svg) is unaffected; this only controls glow
      // halo + core dot color/strength so Mercury at +3 stays golden,
      // Venus at -4.5 burns bright and white.
      const colors = _dayTinted(Lum.colorForBody(bodyName, scale, mag));
      const hasGlow = sr.glow > sr.core;

      const glowSpec =
        hasGlow || sr.glare > 0
          ? {
              coreR: sr.core,
              glowR: sr.glow,
              glareR: sr.glare,
              coreCol: colors.core,
              tint: colors.halo,
              alpha: glowRetire,
            }
          : null;

      const coreOpts = {
        pane: bodyPane,
        radius: sr.core,
        fillColor: colors.core,
        fillOpacity: Lum.coreOpacity(sr.lnB) * (1 - reveal) * dayFade,
        stroke: false,
        interactive: true,
      };

      let diskHtml = null;
      if (fpPx >= 3) {
        // Engraving SVG disk opacity comes from the reveal ramp inside the
        // helpers. Apply dayFade by scaling the value passed in: the helpers
        // multiply their output opacity by it internally, so passing
        // reveal*dayFade gives the correct fade chain.
        const dAEff = reveal * dayFade;
        if (cfg.id === 'saturn') {
          // Saturn: rings + non-square asset → keep flat engraving. Phase
          // angle stays < 6°, terminator invisible at typical zoom.
          diskHtml = buildEngravingIconLOD(cfg.id, fpPx, dAEff);
        } else {
          const bodyPos = bodyPosition(date, cfg.body);
          const i = rad(illum.phase_angle);
          const chi = positionAngle(bodyPos.alpha, bodyPos.delta, sunPos.alpha, sunPos.delta);
          diskHtml = buildPhasedEngravingIcon(cfg.id, fpPx, dAEff, i, chi);
        }
      }

      placeWrappedLumBody(
        sp.lat,
        sp.lng,
        coreOpts,
        glowSpec,
        diskHtml,
        group,
        cfg.name,
        onClick,
        onContextMenu,
        bodyLabel,
        cfg.id,
        sp.distAU
      );
    } else {
      // No engraving SVG asset (e.g. Uranus / Neptune until their texture
      // ships). Use BODY_COLORS via the same luminosity pipeline as the
      // engraving branch, just without a disk overlay. Adding an entry to
      // ENGRAVING + the matching SVGs promotes the body to the disk branch.
      const scale = Lum.zoomScale(zoom);
      const sr = Lum.spriteRadii(mag, scale);
      const bodyName = cfg.id.charAt(0).toUpperCase() + cfg.id.slice(1);
      // Pass actual mag so dim bodies (U/N) keep their hue instead of
      // getting fully clipped to white.
      const colors = _dayTinted(Lum.colorForBody(bodyName, scale, mag));
      const hasGlow = sr.glow > sr.core;

      const glowSpec =
        hasGlow || sr.glare > 0
          ? {
              coreR: sr.core,
              glowR: sr.glow,
              glareR: sr.glare,
              coreCol: colors.core,
              tint: colors.halo,
              alpha: dayFade,
            }
          : null;

      const coreOpts = {
        pane: bodyPane,
        radius: sr.core,
        fillColor: colors.core,
        fillOpacity: Lum.coreOpacity(sr.lnB) * dayFade,
        stroke: false,
        interactive: true,
      };

      placeWrappedLumBody(
        sp.lat,
        sp.lng,
        coreOpts,
        glowSpec,
        null,
        group,
        cfg.name,
        onClick,
        onContextMenu,
        bodyLabel,
        cfg.id,
        sp.distAU
      );
    }
  }

  // ---- Jupiter's Galilean Moons (Companion Dots at High Zoom) ----
  // astronomy-engine returns each moon's jovicentric vector in the EQJ frame;
  // adding Jupiter's geocentric EQJ vector yields the moon's geocentric vector,
  // which feeds the same RA/Dec→sub-point math as the planets. Because both
  // vectors share the EQJ frame, the moon-relative-to-Jupiter offset stays
  // correct even though sub-points pair EQJ right ascension with of-date GMST —
  // that absolute-frame quirk cancels out of the offset. Magnitudes follow
  // Stellarium's absolute_magnitude path, mag = V(1,0) + 5·log10(r·Δ); the phase
  // term is dropped because the Galilean phase angle seen from Earth stays below
  // 12°, contributing under 0.1 mag.
  const JUPITER_MOONS = [
    {
      id: 'io',
      key: 'io',
      get name() {
        return _t('planet.io');
      },
      v10: -1.68,
    },
    {
      id: 'europa',
      key: 'europa',
      get name() {
        return _t('planet.europa');
      },
      v10: -1.41,
    },
    {
      id: 'ganymede',
      key: 'ganymede',
      get name() {
        return _t('planet.ganymede');
      },
      v10: -2.09,
    },
    {
      id: 'callisto',
      key: 'callisto',
      get name() {
        return _t('planet.callisto');
      },
      v10: -1.05,
    },
  ];

  const _JMOON_BY_ID = Object.fromEntries(JUPITER_MOONS.map((m) => [m.id, m]));

  // Below this zoom the four sub-points collapse onto Jupiter's disk (their
  // ~0.1° spread is sub-pixel), so the dots stay hidden and then fade in over
  // the next two levels rather than popping into existence.
  const Z_JMOON_ON = 9;

  let _jmoonParent = null;
  let _jmoonGroups = null;

  // Saturn's six moons bright enough to show (mag < 12). astronomy-engine has no
  // Saturn analog of JupiterMoons(), so positions come from js/saturn-moons.js
  // (TASS 1.7). v10 are Stellarium ssystem_major.ini absolute magnitudes — the same
  // source as the Galilean v10 above.
  const SATURN_MOONS = [
    {
      id: 'enceladus',
      key: 'enceladus',
      get name() {
        return _t('planet.enceladus');
      },
      v10: 2.1,
    },
    {
      id: 'tethys',
      key: 'tethys',
      get name() {
        return _t('planet.tethys');
      },
      v10: 0.6,
    },
    {
      id: 'dione',
      key: 'dione',
      get name() {
        return _t('planet.dione');
      },
      v10: 0.8,
    },
    {
      id: 'rhea',
      key: 'rhea',
      get name() {
        return _t('planet.rhea');
      },
      v10: 0.1,
    },
    {
      id: 'titan',
      key: 'titan',
      get name() {
        return _t('planet.titan');
      },
      v10: -1.28,
    },
    {
      id: 'iapetus',
      key: 'iapetus',
      get name() {
        return _t('planet.iapetus');
      },
      v10: 1.5,
    },
  ];

  const _SMOON_BY_ID = Object.fromEntries(SATURN_MOONS.map((m) => [m.id, m]));

  // The inner Saturnian moons sit tighter to their planet than the Galileans, but
  // Titan and Iapetus swing wider; the same fade-in threshold reads well for the set.
  const Z_SMOON_ON = 9;

  let _smoonParent = null;
  let _smoonGroups = null;

  // Start loading the TASS 1.7 table immediately; state() stays null until it lands.
  if (typeof SaturnMoons !== 'undefined') SaturnMoons.init();

  // Geocentric EQJ vector → sub-point for the planetary moons (Galilean / Saturnian),
  // delegating to the shared of-date converter so the EQJ→EQD + GAST framing matches
  // bodySubPoint. Returns the geocentric distance (AU) too, so callers get Δ for the
  // magnitude model without a second pass over the vector.
  function vecSubPoint(date, vec) {
    return _eqjVecToSubPoint(date, vec);
  }

  // One pass over a Galilean moon's geometry, shared by the renderer, the info
  // card, and the search/great-circle lookups so the EQJ-offset and magnitude
  // recipe lives in exactly one place. `along` is the moon's signed depth along
  // the Earth→Jupiter line (positive = farther than Jupiter's centre, i.e. the
  // far side) and `perp` its perpendicular miss-distance (AU) from that line —
  // together they decide whether Jupiter's disk hides the moon. `ra`/`sp.lat`
  // are the geocentric equatorial coordinates; `rHelio·sp.distAU` drives the
  // V(1,0) magnitude.
  function jupiterMoonGeo(date, key, ctx) {
    ctx = ctx || jupiterMoonGeoCtx(date);
    const jv = ctx.jv;
    const jm = ctx.jmAll[key];
    const vec = { x: jv.x + jm.x, y: jv.y + jm.y, z: jv.z + jm.z };
    const sp = vecSubPoint(date, vec);
    const ra = ((deg(Math.atan2(vec.y, vec.x)) % 360) + 360) % 360;

    const along = (jm.x * jv.x + jm.y * jv.y + jm.z * jv.z) / ctx.dJup;
    const perp = Math.hypot(
      jm.x - (along * jv.x) / ctx.dJup,
      jm.y - (along * jv.y) / ctx.dJup,
      jm.z - (along * jv.z) / ctx.dJup
    );
    return { vec, sp, ra, rHelio: ctx.rHelio, along, perp };
  }

  // The per-date, moon-independent half of jupiterMoonGeo: Jupiter's geo/helio
  // vectors and the full JupiterMoons(t) table (which already returns all four
  // moons at once). Built once per updateMarkers and shared across the loop so
  // GeoVector / HelioVector / JupiterMoons aren't re-evaluated per moon — they
  // were, costing four redundant ephemeris passes on every settle/tick.
  function jupiterMoonGeoCtx(date) {
    const t = Astronomy.MakeTime(date);
    const jv = Astronomy.GeoVector(Astronomy.Body.Jupiter, t, true);
    const hv = Astronomy.HelioVector(Astronomy.Body.Jupiter, t);
    return {
      jv,
      jmAll: Astronomy.JupiterMoons(t),
      rHelio: Math.hypot(hv.x, hv.y, hv.z),
      dJup: Math.hypot(jv.x, jv.y, jv.z),
    };
  }

  // Saturn-moon counterpart of jupiterMoonGeo. SaturnMoons.state() returns
  // Saturncentric ECLIPTIC-J2000 vectors (AU); rotate ECL→EQJ through Astronomy
  // Engine so the obliquity convention matches GeoVector(Saturn) before summing.
  // `along`/`perp` are taken from the Saturncentric offset (the moon's own vector
  // relative to Saturn), exactly as the Jupiter version uses jm. Returns null until
  // the TASS table has loaded.
  function saturnMoonGeo(date, key, ctx) {
    ctx = ctx || saturnMoonGeoCtx(date);
    const stAll = ctx.stAll;
    if (!stAll || !stAll[key]) return null;
    const ecl = stAll[key];
    const sm = Astronomy.RotateVector(ctx.rotEclEqj, new Astronomy.Vector(ecl.x, ecl.y, ecl.z, ctx.t));
    const sv = ctx.sv;
    const vec = { x: sv.x + sm.x, y: sv.y + sm.y, z: sv.z + sm.z };
    const sp = vecSubPoint(date, vec);
    const ra = ((deg(Math.atan2(vec.y, vec.x)) % 360) + 360) % 360;

    const along = (sm.x * sv.x + sm.y * sv.y + sm.z * sv.z) / ctx.dSat;
    const perp = Math.hypot(
      sm.x - (along * sv.x) / ctx.dSat,
      sm.y - (along * sv.y) / ctx.dSat,
      sm.z - (along * sv.z) / ctx.dSat
    );
    return { vec, sp, ra, rHelio: ctx.rHelio, along, perp };
  }

  // Per-date, moon-independent half of saturnMoonGeo: the full TASS state table,
  // Saturn's geo/helio vectors, and the constant ECL→EQJ rotation. Built once per
  // updateMarkers so GeoVector / HelioVector / Rotation_ECL_EQJ aren't recomputed
  // for each of the six moons. SaturnMoons.state() is itself memoized by tt, so
  // calling it here vs per moon is a wash — the win is the per-moon GeoVector pair.
  function saturnMoonGeoCtx(date) {
    const t = Astronomy.MakeTime(date);
    const stAll = typeof SaturnMoons !== 'undefined' ? SaturnMoons.state(t) : null;
    const sv = Astronomy.GeoVector(Astronomy.Body.Saturn, t, true);
    const hv = Astronomy.HelioVector(Astronomy.Body.Saturn, t);
    return {
      t,
      stAll,
      sv,
      rotEclEqj: Astronomy.Rotation_ECL_EQJ(),
      rHelio: Math.hypot(hv.x, hv.y, hv.z),
      dSat: Math.hypot(sv.x, sv.y, sv.z),
    };
  }

  // The Sun's photospheric radius (km) — it never appears in BODY_DIAM_KM, whose
  function placeJupiterMoons(map, date, zoom, entries) {
    if (!_jmoonParent) {
      _jmoonParent = L.layerGroup();
      _jmoonGroups = {};
      for (const m of JUPITER_MOONS) {
        const g = L.layerGroup();
        _jmoonGroups[m.id] = g;
        _jmoonParent.addLayer(g);
      }
      _jmoonParent.addTo(map);
    }

    // Companion dots share Jupiter's visibility range: render only when
    // Jupiter's own marker layer is on and we're zoomed in far enough to
    // separate the moons from the planet.
    const jup = entries && entries.find((e) => e.config.id === 'jupiter');
    const show = zoom >= Z_JMOON_ON && jup && map.hasLayer(jup.markerLayer);
    if (!show) {
      for (const m of JUPITER_MOONS) _jmoonGroups[m.id].clearLayers();
      return;
    }

    const scale = Lum.zoomScale(zoom);
    const fade = Lum.smoothstep(Z_JMOON_ON, Z_JMOON_ON + 2, zoom);
    // Jupiter's equatorial radius as an AU miss-distance threshold: a moon on the
    // far side whose line-of-sight offset falls inside the disk is hidden by the
    // planet. Oblateness is ignored — a spherical silhouette is exact enough at
    // a four-pixel dot.
    const rJupAU = BODY_DIAM_KM.jupiter / 2 / AU_KM;

    const jctx = jupiterMoonGeoCtx(date);
    for (const m of JUPITER_MOONS) {
      const g = jupiterMoonGeo(date, m.key, jctx);
      const sp = g.sp;

      // Drop the whole moon (core, glow, label) when Jupiter's own disk covers it
      // (far side, within the silhouette). Near-side transits keep rendering,
      // drawn above the planet disk as they physically should be. Occlusion by
      // the Sun and inner planets is handled by z-order: body-jmoons (737) sits
      // below the Sun/inner-planet dynamic zone (741–749).
      if (g.along > 0 && g.perp < rJupAU) {
        _jmoonGroups[m.id].clearLayers();
        continue;
      }

      const mag = m.v10 + 5 * Math.log10(g.rHelio * sp.distAU);
      const sr = Lum.spriteRadii(mag, scale);
      const bodyName = m.id.charAt(0).toUpperCase() + m.id.slice(1);
      const colors = _dayTinted(Lum.colorForBody(bodyName, scale, mag));
      const hasGlow = sr.glow > sr.core;

      // Size the engraving disk by real angular diameter — the same footprint chain
      // the planets use (bodyFootprintKm → footprintPx) — so each moon stays
      // proportional to, and smaller than, Jupiter. The reveal then gates the disk
      // by its size relative to the glow: while the disk is much smaller than the
      // glow the moon stays a bright glow-point (dark crater texture hidden), and
      // the texture only emerges as the disk grows to the glow's scale (~z16-17).
      const fpKm = footprintKmFromDist(MOON_DIAM_KM[m.id], sp.distAU);
      const fpPx = Lum.footprintPx(zoom, fpKm, sp.lat);
      const reveal = Lum.diskGlowReveal(fpPx, sr.glow);

      const glowSpec =
        hasGlow || sr.glare > 0
          ? {
              coreR: sr.core,
              glowR: sr.glow,
              glareR: sr.glare,
              coreCol: colors.core,
              tint: colors.halo,
              alpha: fade * (1 - reveal),
            }
          : null;

      const coreOpts = {
        pane: 'body-jmoons',
        radius: sr.core,
        fillColor: colors.core,
        fillOpacity: Lum.coreOpacity(sr.lnB) * fade * (1 - reveal),
        stroke: false,
        interactive: true,
      };

      // Click opens the same info card as a planet; the moon id stands in for a
      // body config (no contour layer of its own, so pass null).
      const onClick = _onBodyClick ? (ev) => _onBodyClick({ config: { id: m.id }, contourLayer: null }, ev) : null;

      // Hold labels back until the dots are mostly faded in, so four names don't
      // crowd Jupiter right at the separation threshold.
      const label = fade > 0.5 ? m.name : null;

      const diskHtml = fpPx >= 3 && reveal > 0.01 ? buildEngravingIconLOD(m.id, fpPx, fade * reveal) : null;

      placeWrappedLumBody(
        sp.lat,
        sp.lng,
        coreOpts,
        glowSpec,
        diskHtml,
        _jmoonGroups[m.id],
        m.name,
        onClick,
        null,
        label,
        m.id,
        sp.distAU
      );
    }
  }

  function placeSaturnMoons(map, date, zoom, entries) {
    if (!_smoonParent) {
      _smoonParent = L.layerGroup();
      _smoonGroups = {};
      for (const m of SATURN_MOONS) {
        const g = L.layerGroup();
        _smoonGroups[m.id] = g;
        _smoonParent.addLayer(g);
      }
      _smoonParent.addTo(map);
    }

    // Mirror the Galilean gating: only with Saturn's marker layer on and zoomed in
    // enough to separate the moons from the planet.
    const sat = entries && entries.find((e) => e.config.id === 'saturn');
    const show = zoom >= Z_SMOON_ON && sat && map.hasLayer(sat.markerLayer);
    if (!show) {
      for (const m of SATURN_MOONS) _smoonGroups[m.id].clearLayers();
      return;
    }

    const scale = Lum.zoomScale(zoom);
    const fade = Lum.smoothstep(Z_SMOON_ON, Z_SMOON_ON + 2, zoom);
    // Saturn's ring-inclusive radius as the occulter: a far-side moon whose
    // line-of-sight offset falls inside it is hidden. Reusing the ring extent
    // (BODY_DIAM_KM.saturn) folds a coarse ring occlusion into the same test.
    const rSatAU = BODY_DIAM_KM.saturn / 2 / AU_KM;

    const sctx = saturnMoonGeoCtx(date);
    for (const m of SATURN_MOONS) {
      const g = saturnMoonGeo(date, m.key, sctx);
      // Null until the TASS table loads — clear and wait for a later tick.
      if (!g) {
        _smoonGroups[m.id].clearLayers();
        continue;
      }
      const sp = g.sp;

      // Same far-side cull as the Galileans: occlusion by the Sun and the nearer
      // planets is left to z-order (body-smoons 731 sits below the 741–749 zone).
      if (g.along > 0 && g.perp < rSatAU) {
        _smoonGroups[m.id].clearLayers();
        continue;
      }

      const mag = m.v10 + 5 * Math.log10(g.rHelio * sp.distAU);
      const sr = Lum.spriteRadii(mag, scale);
      const bodyName = m.id.charAt(0).toUpperCase() + m.id.slice(1);
      const colors = _dayTinted(Lum.colorForBody(bodyName, scale, mag));
      const hasGlow = sr.glow > sr.core;

      // Real-angular-diameter disk sizing, same footprint chain as the planets.
      // Only Titan, Rhea, and Iapetus have engraving icons — the rest stay dots.
      // The reveal gates the disk by its size relative to the glow: while small it
      // stays hidden behind a bright glow-point, emerging only as it grows to the
      // glow's scale. Icon-less moons get fpPx≈0 → reveal≈0 → glow/core unchanged.
      const fpKm = footprintKmFromDist(MOON_DIAM_KM[m.id] || 1, sp.distAU);
      const fpPx = Lum.footprintPx(zoom, fpKm, sp.lat);
      const reveal = Lum.diskGlowReveal(fpPx, sr.glow);

      const glowSpec =
        hasGlow || sr.glare > 0
          ? {
              coreR: sr.core,
              glowR: sr.glow,
              glareR: sr.glare,
              coreCol: colors.core,
              tint: colors.halo,
              alpha: fade * (1 - reveal),
            }
          : null;

      const coreOpts = {
        pane: 'body-smoons',
        radius: sr.core,
        fillColor: colors.core,
        fillOpacity: Lum.coreOpacity(sr.lnB) * fade * (1 - reveal),
        stroke: false,
        interactive: true,
      };

      const onClick = _onBodyClick ? (ev) => _onBodyClick({ config: { id: m.id }, contourLayer: null }, ev) : null;
      const label = fade > 0.5 ? m.name : null;

      const diskHtml =
        ENGRAVING[m.id] && fpPx >= 3 && reveal > 0.01 ? buildEngravingIconLOD(m.id, fpPx, fade * reveal) : null;

      placeWrappedLumBody(
        sp.lat,
        sp.lng,
        coreOpts,
        glowSpec,
        diskHtml,
        _smoonGroups[m.id],
        m.name,
        onClick,
        null,
        label,
        m.id,
        sp.distAU
      );
    }
  }

  // ---- Update Visibility-Range Overlay for Visible Entries (Time Change) ----
  function updateContours(map, entries, date) {
    for (const e of entries) {
      if (!map.hasLayer(e.contourLayer)) continue;
      e.linesGroup.clearLayers();
      e.labelsGroup.clearLayers();
      if (e.fillGroup) e.fillGroup.clearLayers();
      const mag = (function () {
        try {
          return Astronomy.Illumination(e.config.body, date).mag;
        } catch (_) {
          return 0;
        }
      })();
      // Planets lock fillOpacity at 0.04; moon keeps the dynamic mag-derived
      // alpha so a full moon's vis range reads visually heavier than a new one.
      const _visOpts = e.config.id === 'moon' ? undefined : { fillOpacity: 0.04 };
      drawVisibilityRange(antiBodySubPoint(date, e.config.body), e.config, mag, e.linesGroup, e.fillGroup, _visOpts);
    }
  }

  // ---- Update Markers for Visible Entries (Called on Time Change) ----
  function updateMarkers(map, entries, date) {
    const sunPos = bodyPosition(date, Astronomy.Body.Sun);
    const zoom = map.getZoom();

    // Drop every canvas body except the Sun before this authoritative refresh;
    // hidden planets/moons and far-side-culled satellites are simply not re-added
    // below, so their glow does not linger on the shared body canvas.
    if (typeof bodyCanvasBeginPass === 'function') bodyCanvasBeginPass();

    for (const e of entries) {
      if (!map.hasLayer(e.markerLayer)) continue;
      const sp = bodySubPoint(date, e.config.body);
      const onClick = _onBodyClick ? (ev) => _onBodyClick(e, ev) : null;
      const onContextMenu = _onBodyContextMenu ? (ev) => _onBodyContextMenu(e, ev) : null;
      placeBodyMarker(e.config, date, sunPos, sp, zoom, e.markerGroup, onClick, onContextMenu);
    }

    placeJupiterMoons(map, date, zoom, entries);
    placeSaturnMoons(map, date, zoom, entries);
  }

  function updateMarkerSizes(map, entries) {
    // Full rebuild on zoom change (sizes depend on zoom through luminosity model)
    const date = typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date();
    updateMarkers(map, entries, date);
  }

  // ---- Search Integration (Sun / Moon / Planets) ----
  const _BODY_BY_ID = {
    sun: Astronomy.Body.Sun,
    moon: Astronomy.Body.Moon,
    mercury: Astronomy.Body.Mercury,
    venus: Astronomy.Body.Venus,
    mars: Astronomy.Body.Mars,
    jupiter: Astronomy.Body.Jupiter,
    saturn: Astronomy.Body.Saturn,
    uranus: Astronomy.Body.Uranus,
    neptune: Astronomy.Body.Neptune,
  };

  const _SYM_BY_ID = {
    sun: '☉',
    moon: '☾',
    mercury: '☿',
    venus: '♀',
    mars: '♂',
    jupiter: '♃',
    saturn: '♄',
    uranus: '⛢',
    neptune: '♆',
  };

  function getSearchLatLng(id, date) {
    // Comet delegation — a `comet:`-prefixed trajectory id resolves to the Comet
    // module's own Kepler/Barker solver, keyed by the bare designation.
    if (typeof id === 'string' && id.slice(0, 6) === 'comet:' && typeof Comet !== 'undefined' && Comet.subPointById) {
      const cp = Comet.subPointById(id.slice(6), date);
      return cp ? { lat: cp.lat, lng: GeoUtils.normLng(cp.lng) } : null;
    }
    // Asteroid delegation — Asteroids module owns its own Kepler math.
    if (typeof Asteroids !== 'undefined') {
      const ast = Asteroids.subPointById(id, date);
      if (ast) return { lat: ast.lat, lng: GeoUtils.normLng(ast.lng) };
    }
    if (_JMOON_BY_ID[id]) {
      const sp = jupiterMoonGeo(date, _JMOON_BY_ID[id].key).sp;
      return { lat: sp.lat, lng: GeoUtils.normLng(sp.lng) };
    }
    if (_SMOON_BY_ID[id]) {
      const g = saturnMoonGeo(date, _SMOON_BY_ID[id].key);
      return g ? { lat: g.sp.lat, lng: GeoUtils.normLng(g.sp.lng) } : null;
    }
    const body = _BODY_BY_ID[id];
    if (!body) return null;
    const sp = bodySubPoint(date, body);
    return { lat: sp.lat, lng: GeoUtils.normLng(sp.lng) };
  }

  // Public: instantaneous geocentric equatorial coordinates (degrees) for
  // sun/moon/planet `id`, or a Galilean moon.
  function getBodyRaDec(id, date) {
    if (_JMOON_BY_ID[id]) {
      const g = jupiterMoonGeo(date, _JMOON_BY_ID[id].key);
      return { ra: g.ra, dec: g.sp.lat };
    }
    if (_SMOON_BY_ID[id]) {
      const g = saturnMoonGeo(date, _SMOON_BY_ID[id].key);
      return g ? { ra: g.ra, dec: g.sp.lat } : null;
    }
    const body = _BODY_BY_ID[id];
    if (!body) return null;
    try {
      const bp = bodyPosition(date, body);
      const ra = ((deg(bp.alpha) % 360) + 360) % 360;
      return { ra, dec: deg(bp.delta) };
    } catch (e) {
      return null;
    }
  }

  // Single source of truth for which planetary moons exist, so the celestial
  // search index never hardcodes (and drifts from) the rendered moon roster.
  function getMoonIds() {
    return [...JUPITER_MOONS, ...SATURN_MOONS].map((m) => m.id);
  }

  let _searchPopup = null;
  let _searchPopupBuilder = null;
  let _searchPopupId = null;

  // Galilean moons can't go through the planet card: they aren't Astronomy.Body
  // values, so Illumination/GeoVector(body) would throw. This mirrors the planet
  // card's layout but sources RA/Dec, Δ, and the V(1,0) magnitude from
  // jupiterMoonGeo, and adds a parent-body row pointing back to Jupiter.
  function _buildJupiterMoonInfoHTML(id, date) {
    const m = _JMOON_BY_ID[id];
    const g = jupiterMoonGeo(date, m.key);
    const raDeg = g.ra;
    const decDeg = g.sp.lat;
    const mag = m.v10 + 5 * Math.log10(g.rHelio * g.sp.distAU);

    const magRow =
      '<div class="info-row"><span class="label"' +
      _glossAttr('magnitude') +
      '>' +
      _t('star.magnitude') +
      '</span><span class="value">' +
      mag.toFixed(2) +
      '</span></div>';
    const distRow =
      '<div class="info-row"><span class="label"' +
      _glossAttr('distance') +
      '>' +
      _t('star.distance') +
      '</span><span class="value">' +
      g.sp.distAU.toFixed(3) +
      ' AU</span></div>';
    const _moonDiamKm = MOON_DIAM_KM[m.id];
    const diamRow = _moonDiamKm
      ? '<div class="info-row"><span class="label"' +
        _glossAttr('apparent_diameter') +
        '>' +
        _t('sky.angular_diam') +
        '</span><span class="value">' +
        ((_moonDiamKm / (g.sp.distAU * AU_KM)) * 206265).toFixed(2) +
        '″</span></div>'
      : '';
    const parentRow =
      '<div class="info-row"><span class="label">' +
      _t('sky.parent_body') +
      '</span><span class="value">' +
      _SYM_BY_ID.jupiter +
      ' ' +
      _t('planet.jupiter') +
      '</span></div>';

    const skyInfo = GeoUtils.buildSkyInfoHTML(raDeg, decDeg, date, _t);
    return (
      '<div class="star-panel">' +
      '<h2 class="star-name">' +
      _t('planet.' + id) +
      '</h2>' +
      '<div class="star-scroll">' +
      '<div class="info-block">' +
      '<div class="info-block-title">' +
      _t('sky.object_data') +
      '</div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('ra') +
      '>' +
      _t('star.ra') +
      '</span><span class="value">' +
      GeoUtils.fmtRA(raDeg) +
      '</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('dec') +
      '>' +
      _t('star.dec') +
      '</span><span class="value">' +
      GeoUtils.fmtDec(decDeg) +
      '</span></div>' +
      magRow +
      distRow +
      diamRow +
      parentRow +
      '</div>' +
      skyInfo +
      '</div>' +
      GeoUtils.cardCredits([{ name: 'Astronomy Engine', url: 'https://github.com/cosinekitty/astronomy' }]) +
      '</div>'
    );
  }

  // Saturn-moon card, parallel to the Galilean one. Positions come from the TASS 1.7
  // table (js/saturn-moons.js), so the credit points there; the parent row reads ♄.
  function _buildSaturnMoonInfoHTML(id, date) {
    const m = _SMOON_BY_ID[id];
    const g = saturnMoonGeo(date, m.key);
    if (!g) return '<div class="star-panel"></div>';
    const raDeg = g.ra;
    const decDeg = g.sp.lat;
    const mag = m.v10 + 5 * Math.log10(g.rHelio * g.sp.distAU);

    const magRow =
      '<div class="info-row"><span class="label"' +
      _glossAttr('magnitude') +
      '>' +
      _t('star.magnitude') +
      '</span><span class="value">' +
      mag.toFixed(2) +
      '</span></div>';
    const distRow =
      '<div class="info-row"><span class="label"' +
      _glossAttr('distance') +
      '>' +
      _t('star.distance') +
      '</span><span class="value">' +
      g.sp.distAU.toFixed(3) +
      ' AU</span></div>';
    const _smoonDiamKm = MOON_DIAM_KM[m.id];
    const diamRow = _smoonDiamKm
      ? '<div class="info-row"><span class="label"' +
        _glossAttr('apparent_diameter') +
        '>' +
        _t('sky.angular_diam') +
        '</span><span class="value">' +
        ((_smoonDiamKm / (g.sp.distAU * AU_KM)) * 206265).toFixed(2) +
        '″</span></div>'
      : '';
    const parentRow =
      '<div class="info-row"><span class="label">' +
      _t('sky.parent_body') +
      '</span><span class="value">' +
      _SYM_BY_ID.saturn +
      ' ' +
      _t('planet.saturn') +
      '</span></div>';

    const skyInfo = GeoUtils.buildSkyInfoHTML(raDeg, decDeg, date, _t);
    return (
      '<div class="star-panel">' +
      '<h2 class="star-name">' +
      _t('planet.' + id) +
      '</h2>' +
      '<div class="star-scroll">' +
      '<div class="info-block">' +
      '<div class="info-block-title">' +
      _t('sky.object_data') +
      '</div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('ra') +
      '>' +
      _t('star.ra') +
      '</span><span class="value">' +
      GeoUtils.fmtRA(raDeg) +
      '</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('dec') +
      '>' +
      _t('star.dec') +
      '</span><span class="value">' +
      GeoUtils.fmtDec(decDeg) +
      '</span></div>' +
      magRow +
      distRow +
      diamRow +
      parentRow +
      '</div>' +
      skyInfo +
      '</div>' +
      GeoUtils.cardCredits([{ name: 'TASS 1.7 (Vienne & Duriez 1995)', url: 'https://www.imcce.fr/' }]) +
      '</div>'
    );
  }

  function _buildSearchPopupHTML(id, date) {
    if (_JMOON_BY_ID[id]) return _buildJupiterMoonInfoHTML(id, date);
    if (_SMOON_BY_ID[id]) return _buildSaturnMoonInfoHTML(id, date);
    const body = _BODY_BY_ID[id];
    const bp = bodyPosition(date, body);
    const raDeg = ((deg(bp.alpha) % 360) + 360) % 360;
    const decDeg = deg(bp.delta);

    let magRow = '',
      diamRow = '',
      phaseRow = '',
      illumRow = '',
      libRow = '',
      distRow = '';
    let elonRow = '',
      elatRow = '';
    let spectralRow = '',
      tempRow = '';
    let absMagRow = '';

    try {
      const ill = Astronomy.Illumination(body, date);
      if (ill && Number.isFinite(ill.mag)) {
        const magVal = id === 'sun' ? '−26.74' : ill.mag.toFixed(2);
        magRow =
          '<div class="info-row"><span class="label"' +
          _glossAttr('magnitude') +
          '>' +
          _t('star.magnitude') +
          '</span><span class="value">' +
          magVal +
          '</span></div>';
      }
      if (ill && id !== 'sun' && Number.isFinite(ill.phase_angle)) {
        let phaseVal = ill.phase_angle.toFixed(1) + '°';
        if (id === 'moon') {
          try {
            const phaseDeg = Astronomy.MoonPhase(date);
            const _mpFrac = phaseDeg / 360;
            phaseVal +=
              ' (<span' + _glossAttr('moonphase.' + moonPhaseKey(_mpFrac)) + '>' + moonPhaseName(_mpFrac) + '</span>)';
          } catch (_) {}
        }
        phaseRow =
          '<div class="info-row"><span class="label"' +
          _glossAttr('phase_angle') +
          '>' +
          _t('sky.phase_angle') +
          '</span><span class="value">' +
          phaseVal +
          '</span></div>';
      }
      if (ill && id !== 'sun' && Number.isFinite(ill.phase_fraction)) {
        illumRow =
          '<div class="info-row"><span class="label"' +
          _glossAttr('illumination') +
          '>' +
          _t('sky.illumination') +
          '</span><span class="value">' +
          (ill.phase_fraction * 100).toFixed(1) +
          '%</span></div>';
      }
      if (id === 'moon') {
        try {
          const lib = Astronomy.Libration(date);
          const ns = lib.elat >= 0 ? 'N' : 'S';
          const ew = lib.elon >= 0 ? 'E' : 'W';
          libRow =
            '<div class="info-row"><span class="label"' +
            _glossAttr('libration') +
            '>' +
            _t('sky.libration') +
            '</span><span class="value">' +
            Math.abs(lib.elat).toFixed(1) +
            '°' +
            ns +
            ' ' +
            Math.abs(lib.elon).toFixed(1) +
            '°' +
            ew +
            '</span></div>';
        } catch (_) {}
      }
    } catch (_) {}

    try {
      const t = Astronomy.MakeTime(date);
      const v = Astronomy.GeoVector(body, t, true);
      const distAU = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (id === 'moon') {
        const distKm = distAU * 149597870.7;
        distRow =
          '<div class="info-row"><span class="label"' +
          _glossAttr('distance') +
          '>' +
          _t('star.distance') +
          '</span><span class="value">' +
          Math.round(distKm).toLocaleString('en-US') +
          ' km</span></div>';
      } else if (id === 'sun') {
        distRow =
          '<div class="info-row"><span class="label"' +
          _glossAttr('distance') +
          '>' +
          _t('star.distance') +
          '</span><span class="value">' +
          distAU.toFixed(3) +
          ' AU</span></div>';
        // The Sun's V-band absolute magnitude is the fixed +4.83 the whole
        // stellar-distance ladder is anchored to, so it is a constant, not a
        // per-date figure — shown so the −26.74 apparent value has a yardstick.
        absMagRow =
          '<div class="info-row"><span class="label"' +
          _glossAttr('absolute_magnitude') +
          '>' +
          _t('star.absolute_magnitude') +
          '</span><span class="value">+4.83</span></div>';
      } else {
        distRow =
          '<div class="info-row"><span class="label"' +
          _glossAttr('distance') +
          '>' +
          _t('star.distance') +
          '</span><span class="value">' +
          distAU.toFixed(3) +
          ' AU</span></div>';
      }
      const _SUN_DIAM_KM = 1391400;
      const _diskKm = id === 'sun' ? _SUN_DIAM_KM : BODY_DISK_DIAM_KM[id];
      if (_diskKm) {
        const _arcsec = (_diskKm / (distAU * AU_KM)) * (180 / Math.PI) * 3600;
        const _diamVal = _arcsec >= 60 ? (_arcsec / 60).toFixed(1) + '′' : _arcsec.toFixed(1) + '″';
        diamRow =
          '<div class="info-row"><span class="label"' +
          _glossAttr('apparent_diameter') +
          '>' +
          _t('sky.angular_diam') +
          '</span><span class="value">' +
          _diamVal +
          '</span></div>';
      }
      try {
        const ecl = Astronomy.Ecliptic(v);
        if (ecl && Number.isFinite(ecl.elon) && Number.isFinite(ecl.elat)) {
          elonRow =
            '<div class="info-row"><span class="label"' +
            _glossAttr('ecliptic_lon') +
            '>' +
            _t('sky.ecliptic_lon') +
            '</span><span class="value">' +
            ecl.elon.toFixed(2) +
            '°</span></div>';
          elatRow =
            '<div class="info-row"><span class="label"' +
            _glossAttr('ecliptic_lat') +
            '>' +
            _t('sky.ecliptic_lat') +
            '</span><span class="value">' +
            ecl.elat.toFixed(2) +
            '°</span></div>';
        }
      } catch (_) {}
    } catch (_) {}

    if (id === 'sun') {
      spectralRow =
        '<div class="info-row"><span class="label"' +
        _glossAttr('spectral_type') +
        '>' +
        _t('star.spectral_type') +
        '</span><span class="value"' +
        Spectral.tipAttr('G2V') +
        '>G2V</span></div>';
      tempRow =
        '<div class="info-row"><span class="label"' +
        _glossAttr('effective_temp') +
        '>' +
        _t('sky.effective_temp') +
        '</span><span class="value">5778 K</span></div>';
    }

    const skyInfo = GeoUtils.buildSkyInfoHTML(raDeg, decDeg, date, _t, body);
    return (
      '<div class="star-panel">' +
      '<h2 class="star-name">' +
      (_SYM_BY_ID[id] || '') +
      ' ' +
      _t('planet.' + id) +
      '</h2>' +
      '<div class="star-scroll">' +
      '<div class="info-block">' +
      '<div class="info-block-title">' +
      _t('sky.object_data') +
      '</div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('ra') +
      '>' +
      _t('star.ra') +
      '</span><span class="value">' +
      GeoUtils.fmtRA(raDeg) +
      '</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('dec') +
      '>' +
      _t('star.dec') +
      '</span><span class="value">' +
      GeoUtils.fmtDec(decDeg) +
      '</span></div>' +
      elonRow +
      elatRow +
      magRow +
      diamRow +
      spectralRow +
      tempRow +
      phaseRow +
      illumRow +
      libRow +
      distRow +
      absMagRow +
      '</div>' +
      skyInfo +
      '</div>' +
      GeoUtils.cardCredits([{ name: 'Astronomy Engine', url: 'https://github.com/cosinekitty/astronomy' }]) +
      '</div>'
    );
  }

  function showSearchPopup(id, date, latlng, map) {
    // Accept Galilean/Saturn moon ids too — _buildSearchPopupHTML already routes
    // them to their own info builders, only this guard kept them out.
    if (!_BODY_BY_ID[id] && !_JMOON_BY_ID[id] && !_SMOON_BY_ID[id]) return;
    const m = map;
    if (!m) return;
    _searchPopupId = id;
    _searchPopupBuilder = function () {
      return _buildSearchPopupHTML(id, TimeState.current);
    };
    if (!_searchPopup) {
      _searchPopup = L.popup({
        className: 'sky-star-popup',
        maxWidth: 250,
        offset: [0, -6],
        closeButton: true,
        autoPan: false,
      });
      _searchPopup.on('remove', () => {
        _searchPopupBuilder = null;
        _searchPopupId = null;
      });
      if (typeof I18n !== 'undefined') {
        I18n.subscribe(() => {
          if (_searchPopup && _searchPopupBuilder && _searchPopup.isOpen()) {
            _searchPopup.setContent(_searchPopupBuilder());
          }
        });
      }
      if (typeof TimeState !== 'undefined') {
        TimeState.subscribe(() => {
          if (_searchPopup && _searchPopupBuilder && _searchPopupId && _searchPopup.isOpen()) {
            const newPos = getSearchLatLng(_searchPopupId, TimeState.current);
            if (newPos) _searchPopup.setLatLng(L.latLng(newPos.lat, newPos.lng));
            _searchPopup.setContent(_searchPopupBuilder());
          }
        });
      }
    }
    _searchPopup.setLatLng(latlng).setContent(_searchPopupBuilder()).openOn(m);
  }

  return {
    init,
    updateContours,
    updateMarkers,
    updateMarkerSizes,
    CONFIGS,
    bodySubPoint,
    bodyAngularDiamArcsec,
    buildEventDiskIcon,
    buildEngravingIconLOD,
    getSearchLatLng,
    getBodyRaDec,
    getMoonIds,
    showSearchPopup,
    setDayMode,
    buildBodyInfoHTML: _buildSearchPopupHTML,
  };
})();

// Expose bodySubPoint at module scope so consumers (e.g., observer.js compass) can call it
// without going through the Planets namespace.
const bodySubPoint = Planets.bodySubPoint;
