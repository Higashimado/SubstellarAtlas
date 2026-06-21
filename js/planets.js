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

  function jd(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  function gmst(j) {
    return 280.46061837 + 360.98564736629 * (j - 2451545.0);
  }

  // ---- Body Position (RA / Dec in Radians) via Astronomy Engine ----
  function bodyPosition(date, body) {
    const t = Astronomy.MakeTime(date);
    const v = Astronomy.GeoVector(body, t, true);
    const d = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { alpha: Math.atan2(v.y, v.x), delta: Math.asin(v.z / d) };
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
  function bodySubPoint(date, body) {
    const j = jd(date);
    const g = gmst(j);
    const { alpha, delta } = bodyPosition(date, body);
    const raw = deg(alpha) - g;
    return {
      lat: deg(delta),
      lng: ((raw % 360) + 360) % 360,
    };
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

  const EARTH_R_KM = 6371.0;
  const AU_KM = 149597870.7;

  function bodyFootprintKm(body, bodyId, date) {
    const t = Astronomy.MakeTime(date);
    const v = Astronomy.GeoVector(body, t, true);
    const distAU = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const physDiam = BODY_DIAM_KM[bodyId] || 1;
    const angDiam = physDiam / (distAU * AU_KM);
    return EARTH_R_KM * angDiam;
  }

  // Build engraving SVG icon(s) with LOD crossfade between small and large.
  // Returns { html, width, height } suitable for diskHtml in placeWrappedLumBody.
  function buildEngravingIconLOD(planetId, fpPx, diskAlpha) {
    const e = ENGRAVING[planetId];
    const lodMix = Lum.smoothstep(14, 22, fpPx); // 0 = small only, 1 = large only

    function makeImg(variant, opacity) {
      const aspect = variant.w / variant.h;
      let w, h;
      if (aspect >= 1) {
        w = Math.max(6, Math.round(fpPx));
        h = Math.max(6, Math.round(fpPx / aspect));
      } else {
        h = Math.max(6, Math.round(fpPx));
        w = Math.max(6, Math.round(fpPx * aspect));
      }
      return {
        w,
        h,
        html:
          '<img src="' +
          variant.src +
          '" width="' +
          w +
          '" height="' +
          h +
          '" style="display:block;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);opacity:' +
          opacity.toFixed(3) +
          '">',
      };
    }

    // Container sized to the dominant variant (large when lodMix>0.5, else small)
    const dom = lodMix > 0.5 ? e.large : e.small;
    const domAspect = dom.w / dom.h;
    const cW = Math.max(6, Math.round(domAspect >= 1 ? fpPx : fpPx * domAspect));
    const cH = Math.max(6, Math.round(domAspect >= 1 ? fpPx / domAspect : fpPx));

    let parts = [];
    parts.push('<div style="position:relative;width:' + cW + 'px;height:' + cH + 'px">');

    // Snap the disc opacity ramp (6,40)→(6,20) so once the body is "visible" the
    // LOD layers are fully opaque and grid lines behind no longer bleed through.
    const dAEff = Math.min(1, diskAlpha * 2);
    if (lodMix < 0.99) {
      const s = makeImg(e.small, dAEff * (1 - lodMix));
      parts.push(s.html);
    }
    if (lodMix > 0.01) {
      const l = makeImg(e.large, dAEff * lodMix);
      parts.push(l.html);
    }

    parts.push('</div>');
    return { html: parts.join(''), width: cW, height: cH };
  }

  // ---- Phased Engraving Icon (LOD Crossfade + Elliptical Terminator) ----
  // For square-aspect planets (mercury/venus/mars/jupiter/uranus/neptune). Each
  // LOD variant texture is plugged into buildPhasedDiskSVG as the lit-region
  // image; small/large variants crossfade by opacity exactly like
  // buildEngravingIconLOD. Saturn is NOT routed here (rings + non-square asset).
  function buildPhasedEngravingIcon(planetId, fpPx, diskAlpha, i, chi) {
    const e = ENGRAVING[planetId];
    const lodMix = Lum.smoothstep(14, 22, fpPx);

    const sz = Math.max(6, Math.round(fpPx));
    const R = sz / 2;

    function makeSvg(variant, opacity) {
      const svg = buildPhasedDiskSVG(R, i, chi, {
        litImageHref: variant.src,
        darkColor: '#0a0c10',
      });
      return (
        '<div style="position:absolute;left:50%;top:50%;width:' +
        sz +
        'px;height:' +
        sz +
        'px;transform:translate(-50%,-50%);opacity:' +
        opacity.toFixed(3) +
        '">' +
        svg +
        '</div>'
      );
    }

    const parts = [];
    parts.push('<div style="position:relative;width:' + sz + 'px;height:' + sz + 'px">');
    // Same opacity ramp snap as buildEngravingIconLOD — see comment there.
    const dAEff = Math.min(1, diskAlpha * 2);
    if (lodMix < 0.99) parts.push(makeSvg(e.small, dAEff * (1 - lodMix)));
    if (lodMix > 0.01) parts.push(makeSvg(e.large, dAEff * lodMix));
    parts.push('</div>');
    return { html: parts.join(''), width: sz, height: sz };
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
      symbol: '☽',
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
      symbol: '♅',
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
    const sz = Math.max(4, Math.round(fpPx));
    const R = sz / 2;
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
    const html =
      '<div style="width:' +
      sz +
      'px;height:' +
      sz +
      'px;border-radius:50%;overflow:hidden;opacity:' +
      wrapperOpacity.toFixed(3) +
      '">' +
      svg +
      '</div>';
    return { html: html, size: sz };
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
        bodyLabel
      );
    } else if (ENGRAVING[cfg.id]) {
      const dA = Lum.smoothstep(6, 40, fpPx);
      const glowRetire = (1 - dA) * dayFade;

      const scale = Lum.zoomScale(zoom);
      const sr = Lum.spriteRadii(mag, scale);

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
        fillOpacity: Lum.coreOpacity(sr.lnB) * (1 - dA) * dayFade,
        stroke: false,
        interactive: true,
      };

      let diskHtml = null;
      if (fpPx >= 3) {
        // Engraving SVG disk opacity already comes from dA inside the
        // helpers. Apply dayFade by scaling the dA passed in: the helpers
        // multiply their output opacity by dA internally, so passing
        // dA*dayFade gives the correct fade chain.
        const dAEff = dA * dayFade;
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
        bodyLabel
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

      placeWrappedLumBody(sp.lat, sp.lng, coreOpts, glowSpec, null, group, cfg.name, onClick, onContextMenu, bodyLabel);
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

    for (const e of entries) {
      if (!map.hasLayer(e.markerLayer)) continue;
      const sp = bodySubPoint(date, e.config.body);
      const onClick = _onBodyClick ? (ev) => _onBodyClick(e, ev) : null;
      const onContextMenu = _onBodyContextMenu ? (ev) => _onBodyContextMenu(e, ev) : null;
      placeBodyMarker(e.config, date, sunPos, sp, zoom, e.markerGroup, onClick, onContextMenu);
    }
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
    moon: '☽',
    mercury: '☿',
    venus: '♀',
    mars: '♂',
    jupiter: '♃',
    saturn: '♄',
    uranus: '♅',
    neptune: '♆',
  };

  function getSearchLatLng(id, date) {
    const body = _BODY_BY_ID[id];
    if (!body) return null;
    const sp = bodySubPoint(date, body);
    return { lat: sp.lat, lng: GeoUtils.normLng(sp.lng) };
  }

  // Public: instantaneous geocentric equatorial coordinates (degrees) for
  // sun/moon/planet `id`.
  function getBodyRaDec(id, date) {
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

  let _searchPopup = null;
  let _searchPopupBuilder = null;
  let _searchPopupId = null;

  function _buildSearchPopupHTML(id, date) {
    const body = _BODY_BY_ID[id];
    const bp = bodyPosition(date, body);
    const raDeg = ((deg(bp.alpha) % 360) + 360) % 360;
    const decDeg = deg(bp.delta);

    let magRow = '',
      phaseRow = '',
      illumRow = '',
      libRow = '',
      distRow = '';
    let elonRow = '',
      elatRow = '';
    let spectralRow = '',
      tempRow = '';

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
        '</span><span class="value">G2V</span></div>';
      tempRow =
        '<div class="info-row"><span class="label"' +
        _glossAttr('effective_temp') +
        '>' +
        _t('sky.effective_temp') +
        '</span><span class="value">5778 K</span></div>';
    }

    const skyInfo = GeoUtils.buildSkyInfoHTML(raDeg, decDeg, date, _t);
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
      spectralRow +
      tempRow +
      phaseRow +
      illumRow +
      libRow +
      distRow +
      '</div>' +
      skyInfo +
      '</div>' +
      GeoUtils.cardCredits([{ name: 'Astronomy Engine', url: 'https://github.com/cosinekitty/astronomy' }]) +
      '</div>'
    );
  }

  function showSearchPopup(id, date, latlng, map) {
    if (!_BODY_BY_ID[id]) return;
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
    getSearchLatLng,
    getBodyRaDec,
    showSearchPopup,
    setDayMode,
    buildBodyInfoHTML: _buildSearchPopupHTML,
  };
})();

// Expose bodySubPoint at module scope so consumers (e.g., observer.js compass) can call it
// without going through the Planets namespace.
const bodySubPoint = Planets.bodySubPoint;
