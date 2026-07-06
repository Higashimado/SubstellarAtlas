/**
 * Unified luminosity pipeline v2 — lnB-driven sizing & glow for all
 * celestial bodies (stars, sun, moon, planets).  Pure functions, no DOM.
 * Consumed by sky.js, map.js, planets.js.
 */
const Lum = (() => {
  // ---- Tuneable constants ----
  const M_FAINT = 6.5;

  // Core / glow / glare sizing
  const A_CORE = 0.36;
  const R_CORE_MIN = 1.0;
  const R_CORE_MAX = 5;

  const A_GLOW = 1.0;
  const LNB_GLOW_ON = 3.0; // ~mag 3.2
  const R_GLOW_MAX = 22;

  const A_GLARE = 2.5;
  const LNB_GLARE_ON = 5.0; // ~mag -0.5 (lowered from 6.5/mag-1 so 0-1 mag stars
  // — Vega, Arcturus, Capella — also gain a faint glare, restoring bright-end
  // dynamic range that used to saturate flat above mag -1)
  const R_GLARE_MAX = 60;

  // Diffraction spikes — a four-ray cross drawn only for the very brightest
  // stars, the Stellarium cue that reads instantly as "this one is bright".
  // Onset a touch above glare so only headline stars (Sirius, planets, Vega)
  // spike, not every glaring star.
  const LNB_SPIKE_ON = 5.5; // ~mag -0.2
  const A_SPIKE = 8.0; // ray length per lnB above onset (px, ×zoomScale)
  const R_SPIKE_MAX = 60;

  // Zoom scaling — 1.15^(z-Z_REF), Z_REF anchored to map's minZoom=2.
  // Replaces prior linear 1 + 0.10·(z-3); see STAR_RENDERING_SPEC plan §4.
  const Z_REF = 2;
  const ZOOM_BASE = 1.15;
  const ZOOM_K = 0.1; // kept for API compat — not used by new zoomScale
  const ZOOM_MAX = 5.0; // 3.5 → 5.0; let z=12-13 keep growing

  // Sun / Moon disk transition zooms
  const Z_DISK_ON = 5;
  const Z_DISK_FULL = 7;

  // Eye-adaptation constants (in lnB domain)
  const ADAPT_MAG_PENALTY_MAX = 2.0;
  const LNB_FAINT = Math.log(Math.pow(10, -0.4 * (4.5 - M_FAINT))); // ~mag 4.5
  const LNB_BRIGHT = Math.log(Math.pow(10, -0.4 * (-1 - M_FAINT))); // ~mag -1

  // Core color clip constants — DEFAULT reference values only; coreColor below
  // reads Lum.params.* (cmKM/cmPM/zoomDesat) with fallback to these, so they can
  // be tuned live.
  const CM_K_M = 0.7;
  const CM_P_M = 0.07;
  const CM_ZOOM_DESAT = 0.5;

  // ---- Helpers ----
  function clamp(lo, hi, x) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp(0, 1, (x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  }

  // ---- Core pipeline ----

  function overB(mag) {
    return Math.pow(10, -0.4 * (mag - M_FAINT));
  }

  function lnB(mag) {
    return Math.log(overB(mag));
  }

  function coreRadius(ln) {
    return clamp(R_CORE_MIN, R_CORE_MAX, A_CORE * ln);
  }

  // Sub-pixel-aware core sizing (Stellarium "RCMag" trick). Returns { r, alphaK }:
  // below R_CORE_MIN the radius is locked at the floor and alphaK<1 fades the dot
  // by the lost-area ratio, giving dim stars a continuous intensity ramp instead
  // of a hard 1-px floor.
  function coreRadiusEx(ln, zS) {
    if (zS === undefined) zS = 1;
    // Clamp to non-negative: for mag > 6.5 (lnB < 0), A_CORE·ln is negative
    // and would flip sign when squared, making dim stars *brighter* (bug).
    const ideal = Math.max(0, A_CORE * ln) * zS;
    const max = R_CORE_MAX * zS;
    if (ideal >= max) return { r: max, alphaK: 1 };
    if (ideal >= R_CORE_MIN) return { r: ideal, alphaK: 1 };
    // Sub-pixel regime: lock radius at R_CORE_MIN, attenuate alpha by area
    // ratio (idealArea / minArea). Floor prevents complete disappearance —
    // very dim stars (mag > 6.5) all land here at ≈floor, looking like dust.
    // Every catalog dust star (mag 8-13) has A_CORE·ln < 0 → ideal 0 → ratio 0,
    // so alphaK collapses to exactly `floor·dustGain`; those two knobs are the
    // only levers on the whole dust field's brightness (coreOpacity's own floor
    // never bites until mag ≈ 17.6, past the V≤13 catalog).
    const floor = typeof params !== 'undefined' && params.subPxAlphaFloor !== undefined ? params.subPxAlphaFloor : 0.04;
    const gain = typeof params !== 'undefined' && params.dustGain !== undefined ? params.dustGain : 1.0;
    const ratio = ideal / R_CORE_MIN;
    return { r: R_CORE_MIN, alphaK: Math.min(1, Math.max(floor, ratio * ratio) * gain) };
  }

  function glowRadius(ln, zS) {
    if (zS === undefined) zS = 1;
    // Drop the bloom threshold as zoom increases so dim stars also bloom at high
    // zoom (Stellarium-style "more photons per pixel"); tunable via
    // Lum.params.glowZoomBoost (default 2.0).
    const boost = typeof params !== 'undefined' && params.glowZoomBoost !== undefined ? params.glowZoomBoost : 2.0;
    const threshold = LNB_GLOW_ON - boost * (zS - 1);
    return clamp(0, R_GLOW_MAX, A_GLOW * Math.max(0, ln - threshold));
  }

  function glareRadius(ln) {
    return clamp(0, R_GLARE_MAX, A_GLARE * Math.max(0, ln - LNB_GLARE_ON));
  }

  // Half-length of a diffraction-spike ray for a star of brightness `ln`. Reads
  // Lum.params (spikeOn/spikeLenK/spikeMax) each call so the effect is live
  // tunable; returns 0 for all but the brightest handful, so the canvas skips
  // the per-ray draw for ordinary stars.
  function spikeRadius(ln) {
    const on = typeof params !== 'undefined' && params.spikeOn !== undefined ? params.spikeOn : LNB_SPIKE_ON;
    const k = typeof params !== 'undefined' && params.spikeLenK !== undefined ? params.spikeLenK : A_SPIKE;
    const max = typeof params !== 'undefined' && params.spikeMax !== undefined ? params.spikeMax : R_SPIKE_MAX;
    return clamp(0, max, k * Math.max(0, ln - on));
  }

  function spriteRadii(mag, zS) {
    const ln = lnB(mag);
    const core = coreRadius(ln) * zS;
    const gr = glowRadius(ln, zS); // zoom-aware threshold
    const glow = gr > 0 ? (coreRadius(ln) + gr) * zS : 0;
    const glare = glareRadius(ln) * zS;
    return { lnB: ln, core, glow, glare };
  }

  function coreOpacity(ln, adaptFactor) {
    if (adaptFactor === undefined) adaptFactor = 1;
    // Lower clamp dropped from 0.6 → 0.15 so dim-end alpha keeps falling
    // past mag 7.5. Combined with coreRadiusEx().alphaK this is what gives a
    // continuous dim-end intensity ramp. NOTE: baseOpacity is cached in
    // buildStarEntry at catalog-load time — changing this value live requires
    // a page refresh (or Sky.rebuildStars()) to re-evaluate.
    return clamp(0.15, 1.0, 0.66 + 0.05 * ln) * adaptFactor;
  }

  function zoomScale(zoom) {
    return clamp(1.0, ZOOM_MAX, Math.pow(ZOOM_BASE, zoom - Z_REF));
  }

  // ---- Eye adaptation ----

  function adaptationFactor(ln, A) {
    return 1 - A * (1 - smoothstep(LNB_FAINT, LNB_BRIGHT, ln));
  }

  function adaptedMagCutoff(baseCutoff, A) {
    return baseCutoff - A * ADAPT_MAG_PENALTY_MAX;
  }

  // ---- Disk transition (sun / moon / planets) ----

  function diskAlpha(zoom, diskOn, diskFull) {
    if (diskOn === undefined) diskOn = Z_DISK_ON;
    if (diskFull === undefined) diskFull = Z_DISK_FULL;
    return smoothstep(diskOn, diskFull, zoom);
  }

  // Disk-vs-glow reveal: while a body's true disk is much smaller than its glow
  // bloom, the glow's bright center reads as a dense point and the (often dark)
  // engraving disk stays hidden behind it. As the disk grows toward the glow's
  // scale it takes over and the glow retires. Keyed to the disk/glow size ratio
  // so every body crosses over at the same visual proportion regardless of zoom;
  // falls back to absolute px when there is no glow to hide behind.
  function diskGlowReveal(fpPx, glowR) {
    if (!(glowR > 0)) return smoothstep(6, 40, fpPx);
    return smoothstep(0.1 * glowR, 0.6 * glowR, fpPx / 2);
  }

  const PX_PER_KM_Z0 = 256 / 40075.017;
  function footprintPx(zoom, diamKm, lat) {
    if (lat === undefined) lat = 0;
    const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    return (PX_PER_KM_Z0 * diamKm * Math.pow(2, zoom)) / cosLat;
  }

  // ---- OKLab color mixing utilities ----
  const _cl01 = (x) => Math.max(0, Math.min(1, x));
  const _lin2srgb = (c) => ((c = _cl01(c)), c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

  function oklabToHex(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_,
      m = m_ * m_ * m_,
      s = s_ * s_ * s_;
    const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    const h = (x) =>
      Math.round(_lin2srgb(x) * 255)
        .toString(16)
        .padStart(2, '0');
    return '#' + h(R) + h(G) + h(B);
  }

  function _parseColor(str) {
    str = str.trim();
    if (str.startsWith('rgb')) {
      const m = str.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
    }
    const n = parseInt(str.replace('#', ''), 16);
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
  }

  function _srgb2lin(s) {
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }

  function _rgbToOklab(colorStr) {
    const [sr, sg, sb] = _parseColor(colorStr);
    const R = _srgb2lin(sr),
      G = _srgb2lin(sg),
      B = _srgb2lin(sb);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function mixColorOklab(color1, color2, t) {
    const [L1, a1, b1] = _rgbToOklab(color1);
    const [L2, a2, b2] = _rgbToOklab(color2);
    return oklabToHex(L1 + (L2 - L1) * t, a1 + (a2 - a1) * t, b1 + (b2 - b1) * t);
  }

  // ---- Three-layer body colors ----
  // Source: Stellarium 0.9.1+ data/ssystem_major.ini `color` field.
  // Source-comment intent: "This influences the halo color and should always
  // have at least one component 1.0" — i.e. halo carries the body's RGB and the
  // white core emerges naturally from per-channel clipping in coreColor().
  // disk: more saturated synthetic value, used only when no SVG asset exists
  // (fallback placeLumBody path) — never overwrites the engraving SVGs.
  const BODY_COLORS = {
    Sun: { core: '#fffaf7', halo: '#fffaf7', disk: '#fffaf7' }, // 1.0, 0.98, 0.97
    Mercury: { core: '#fff6e9', halo: '#fff6e9', disk: '#c8baa6' }, // 1.0, 0.964, 0.914
    Venus: { core: '#fff5df', halo: '#fff5df', disk: '#e8dcc1' }, // 1.0, 0.96, 0.876
    Mars: { core: '#ffc481', halo: '#ffc481', disk: '#c97a3a' }, // 1.0, 0.768, 0.504
    Jupiter: { core: '#fffaee', halo: '#fffaee', disk: '#e0c89a' }, // 1.0, 0.983, 0.934
    Saturn: { core: '#fff3da', halo: '#fff3da', disk: '#d8c08a' }, // 1.0, 0.955, 0.858
    Uranus: { core: '#d5f4ff', halo: '#d5f4ff', disk: '#a8c8dc' }, // 0.837, 0.959, 1.0
    Neptune: { core: '#b7e8ff', halo: '#b7e8ff', disk: '#8aa8c4' }, // 0.718, 0.910, 1.0
    Moon: { core: '#fffcf7', halo: '#fffcf7', disk: null }, // 1.0, 0.986, 0.968
    // Jupiter's Galilean moons — companion dots only (no disk). Halo RGB from
    // Stellarium ssystem_major.ini `color`; Io's sulfur yellow stands out.
    Io: { core: '#ffe198', halo: '#ffe198', disk: null }, // 1.0, 0.885, 0.598
    Europa: { core: '#fff7e2', halo: '#fff7e2', disk: null }, // 1.0, 0.968, 0.887
    Ganymede: { core: '#fff5de', halo: '#fff5de', disk: null }, // 1.0, 0.962, 0.871
    Callisto: { core: '#fffae5', halo: '#fffae5', disk: null }, // 1.0, 0.979, 0.897
  };

  // ---- Per-channel clip core color (spec §5) ----
  // knobs read from Lum.params with fallback to module constants —
  // lets the A/B helper at the bottom flip behaviour live without restart.
  function coreColor(baseTintHex, mag, zS) {
    const [r, g, b] = _parseColor(baseTintHex);
    const B = overB(mag);
    const maxCh = Math.max(r, g, b, 0.001);
    const cmKM = typeof params !== 'undefined' && params.cmKM !== undefined ? params.cmKM : CM_K_M;
    const cmPM = typeof params !== 'undefined' && params.cmPM !== undefined ? params.cmPM : CM_P_M;
    const zDesat = typeof params !== 'undefined' && params.zoomDesat !== undefined ? params.zoomDesat : CM_ZOOM_DESAT;
    const M = Math.max(1 / maxCh, (cmKM * Math.pow(B, cmPM)) / Math.pow(Math.max(zS, 0.01), zDesat));
    const h = (x) => {
      const v = Math.min(255, Math.round(255 * x * M));
      return Math.max(0, v).toString(16).padStart(2, '0');
    };
    return '#' + h(r) + h(g) + h(b);
  }

  // bodyMag controls the clip strength of the emergent white core. Default
  // −5 matches the bright planets (Mercury-Saturn), Sun, Moon: their core
  // saturates to white. Pass a dimmer value (e.g. Uranus ≈ +5.7) so the
  // core keeps its actual hue and doesn't pinch to pure white.
  function colorForBody(bodyName, zS, bodyMag) {
    const c = BODY_COLORS[bodyName];
    if (!c) return { core: '#ffffff', halo: '#ffffff', disk: null };
    const m = bodyMag === undefined ? -5 : bodyMag;
    const core = coreColor(c.core, m, zS);
    return { core, halo: c.halo, disk: c.disk };
  }

  // ---- Radial gradient CSS generators (spec §3) ----

  function _rgba(hex, alpha) {
    const [r, g, b] = _parseColor(hex);
    return (
      'rgba(' +
      Math.round(r * 255) +
      ',' +
      Math.round(g * 255) +
      ',' +
      Math.round(b * 255) +
      ',' +
      alpha.toFixed(3) +
      ')'
    );
  }

  function glowGradientCSS(coreCol, tint, coreR, glowR) {
    if (glowR <= 0) return '';
    // Spec §5.2 PSF stops: solid white core out to ~35%, then taper, then
    // a thin tinted halo, then transparent. Brings clearer "solid white core + thin tinted wings"
    // separation than the prior monotonic ramp.
    const cF = Math.round((100 * coreR) / Math.max(glowR, 0.001));
    const stop1 = Math.min(cF, 35); // end of solid white core
    const stop2 = Math.min(Math.max(cF + 15, 50), 55); // transition shoulder
    return (
      'radial-gradient(circle,' +
      _rgba(coreCol, 1.0) +
      ' 0%,' +
      _rgba(coreCol, 0.95) +
      ' ' +
      stop1 +
      '%,' +
      _rgba(coreCol, 0.55) +
      ' ' +
      stop2 +
      '%,' +
      _rgba(tint, 0.18) +
      ' 78%,' +
      _rgba(tint, 0.0) +
      ' 100%)'
    );
  }

  function glareGradientCSS(tint, glareR) {
    if (glareR <= 0) return null;
    return (
      'radial-gradient(circle,' +
      _rgba(tint, 0.035) +
      ' 0%,' +
      _rgba(tint, 0.012) +
      ' 45%,' +
      _rgba(tint, 0.0) +
      ' 100%)'
    );
  }

  // Lerp a hex color toward pure white in linear RGB. factor ∈ [0,1]:
  // 0 = unchanged, 1 = '#ffffff'. Used by body renderers when the day-mask
  // veil is active so warm halos (Sun, Mercury, Venus, Mars, Jupiter) don't
  // visually clash with the ~52%-opaque white background. screen() blending
  // in CSS then carries the rest of the fade-into-veil illusion.
  function desaturateForDay(hex, factor) {
    const [r, g, b] = _parseColor(hex);
    const f = Math.max(0, Math.min(1, factor));
    const lr = r + (1 - r) * f;
    const lg = g + (1 - g) * f;
    const lb = b + (1 - b) * f;
    const h = (x) =>
      Math.max(0, Math.min(255, Math.round(255 * x)))
        .toString(16)
        .padStart(2, '0');
    return '#' + h(lr) + h(lg) + h(lb);
  }

  // ---- Runtime-tunable knobs (spec §10) ----
  // Live-editable from devtools, e.g.:
  //   Lum.params.chromaScale = 0.5; Sky.update(TimeState.current);
  // Not persisted — refresh resets to defaults.
  const params = {
    chromaScale: 0.7, // OKLab a/b multiplier for star core tints (sky.js)
    glowChromaScale: 1.0, // OKLab a/b multiplier for glow halo tints (sky.js,
    // read at buildStarEntry → catalog load; refresh
    // to recompute)
    glowZoomBoost: 2.0, // How much LNB_GLOW_ON drops per unit zS above 1
    // (glowRadius reads this each call → live editable)
    // sub-pixel intensity ramp knobs.
    coreFloor: 0.15, // coreOpacity() lower clamp (hard-coded there for perf;
    // this entry is doc-only). Note it only bites past
    // mag ≈ 17.6, so it has NO effect on the V≤13 catalog —
    // brighten dust via subPxAlphaFloor/dustGain instead.
    subPxAlphaFloor: 0.1, // Minimum alphaK returned by coreRadiusEx for the
    // faintest sub-pixel stars — the dominant lever on
    // dust-field brightness (all mag>6.5 stars pin here).
    // Live editable: lower to fade dust; raise for pop.
    dustGain: 1.0, // Multiplier on the sub-pixel alphaK (dust only),
    // clamped to 1. Bump above 1 to brighten the whole
    // dust field without touching bright-star cores.
    magEdge: 0.75, // Width (mag) of the soft cutoff over which a star
    // fades in as the zoom mag-cutoff climbs past it —
    // kills the hard pop-in, giving invisible→dust
    // continuity (read by sky-canvas-layer _doRedraw).
    // zoom-vs-color A/B knobs. coreColor reads these each call.
    // zoomDesat > 0: zoom-in preserves spectral color (current default).
    // zoomDesat = 0: zoom-independent white-core threshold.
    // zoomDesat < 0: Stellarium-style — zoom-in makes white core LARGER.
    zoomDesat: 0.5,
    cmKM: 0.7, // Brightness coefficient for white-core clip.
    cmPM: 0.07, // Brightness power for white-core clip.
    // glare halo peak alpha. 0.06 (Stellarium caps advice at 0.07 — above
    // that "large halo" bug reports; stay under).
    glareAlphaPeak: 0.06,
    // Diffraction-spike knobs (spikeRadius reads spikeOn/spikeLenK/spikeMax;
    // sky-canvas-layer reads spikeAlpha). spikeAlpha 0 disables spikes with no
    // UI toggle. spike8=true adds the 45° diagonal rays (8-point star).
    spikeAlpha: 0.5,
    spike8: false,
    // Peak opacity of the synthetic starlight underlight (StarlightCanvasLayer),
    // before the daylight + zoom-crossfade factors. 0 hides the layer.
    starlightAlpha: 0.06,
    // Moon disk display floor (px). Stellarium-style — keep the
    // moon visible as a phased disk even at low zoom instead of letting
    // the angular footprint collapse to a 1px white dot. Live editable:
    // change + Sky.update(TimeState.current) to see immediately.
    sunMinDiskPx: 32,
    moonMinDiskPx: 32,
  };

  // ---- Public API ----
  return {
    // Constants
    Z_DISK_ON,
    Z_DISK_FULL,
    R_CORE_MAX,
    R_GLOW_MAX,
    R_GLARE_MAX,
    LNB_GLOW_ON,
    LNB_GLARE_ON,

    // Tunables
    params,

    // Functions
    clamp,
    smoothstep,
    overB,
    lnB,
    coreRadius,
    coreRadiusEx,
    glowRadius,
    glareRadius,
    spikeRadius,
    spriteRadii,
    coreOpacity,
    zoomScale,
    adaptationFactor,
    adaptedMagCutoff,
    diskAlpha,
    diskGlowReveal,
    footprintPx,
    coreColor,
    colorForBody,
    desaturateForDay,
    mixColorOklab,
    oklabToHex,
    _parseColor,
    _rgba,
    glowGradientCSS,
    glareGradientCSS,
  };
})();
