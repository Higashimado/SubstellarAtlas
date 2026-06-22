/**
 * eclipse-glyph.js — inline-SVG eclipse disk glyphs for the sidebar list.
 *
 * Six variants computed from the
 * real greatest-eclipse geometry carried on `event.glyph` (built by
 * tools/lib/glyph-geom.js). Five layer a shadow onto the project's Sun/Moon
 * disk art (img/sun-large.svg, img/moon-large.svg — each a disk filling its
 * viewBox, embedded at 28×28 to land exactly at R=14 about (20,20)); a total
 * solar eclipse replaces the disk with a fixed corona glyph.
 *
 * Exposes a global `EclipseGlyph` (no module system in this project).
 */
window.EclipseGlyph = (function () {
  'use strict';

  const R = 14; // rendered primary-disk radius in the 40×40 viewBox
  const CX = 20,
    CY = 20; // disk center

  // Sky-view transform (§1.1 / §3.2): east on the left, north up. P measured
  // from celestial north counterclockwise toward east.
  const skyOffset = (amp, pa) => ({ dx: -amp * Math.sin(pa), dy: -amp * Math.cos(pa) });

  const f = (x) => (+x).toFixed(3);
  const isNum = (x) => typeof x === 'number' && isFinite(x);

  // ---- Runtime Fallback Geometry ----
  // Mirrors tools/lib/glyph-geom.js using the browser-global Astronomy engine.
  const R_SUN_KM = 695700.0,
    R_MOON_KM = 1737.4,
    R_EARTH_KM = 6378.137,
    DANJON = 1.02;

  function wrapPi(x) {
    while (x > Math.PI) x -= 2 * Math.PI;
    while (x < -Math.PI) x += 2 * Math.PI;
    return x;
  }

  function norm2Pi(x) {
    let v = x % (2 * Math.PI);
    if (v < 0) v += 2 * Math.PI;
    return v;
  }

  function eqAtPeak(body, peakIso) {
    const t = Astronomy.MakeTime(new Date(peakIso));
    const v = Astronomy.GeoVector(body, t, true);
    const dist = Math.hypot(v.x, v.y, v.z);
    return { ra: Math.atan2(v.y, v.x), dec: Math.asin(v.z / dist), dist_km: dist * Astronomy.KM_PER_AU };
  }

  // Position angle (0=N, π/2=E) of `target` relative to `origin`.
  function posAngle(origin, target) {
    const dec_avg = 0.5 * (origin.dec + target.dec);
    const dRAx = wrapPi(target.ra - origin.ra) * Math.cos(dec_avg);
    return norm2Pi(Math.atan2(dRAx, target.dec - origin.dec));
  }

  // Tangent-plane offset: angular separation (rad) + position angle in one pass.
  function skyVec(origin, target) {
    const dec_avg = 0.5 * (origin.dec + target.dec);
    const dRAx = wrapPi(target.ra - origin.ra) * Math.cos(dec_avg);
    const dDec = target.dec - origin.dec;
    return { sep: Math.hypot(dRAx, dDec), pa: norm2Pi(Math.atan2(dRAx, dDec)) };
  }

  // sep from catalog magnitude (see tools/lib/glyph-geom.js header for why).
  function runtimeSolar(peakIso, event) {
    const sun = eqAtPeak(Astronomy.Body.Sun, peakIso),
      moon = eqAtPeak(Astronomy.Body.Moon, peakIso);
    const sd_sun = Math.asin(R_SUN_KM / sun.dist_km),
      sd_moon = Math.asin(R_MOON_KM / moon.dist_km);
    const mag = event && typeof event.magnitude === 'number' ? event.magnitude : 0;
    return {
      sd_primary: sd_sun,
      sd_occluder: sd_moon,
      sep: Math.max(0, sd_sun + sd_moon - 2 * mag * sd_sun),
      pa: posAngle(sun, moon),
    };
  }

  // Lunar bite depth is geocentric, so take `sep` from the real Moon↔antisolar
  // separation (not the catalog magnitude). Mirrors tools/lib/glyph-geom.js.
  function runtimeLunar(peakIso, _event) {
    const sun = eqAtPeak(Astronomy.Body.Sun, peakIso),
      moon = eqAtPeak(Astronomy.Body.Moon, peakIso);
    const sd_sun = Math.asin(R_SUN_KM / sun.dist_km),
      sd_moon = Math.asin(R_MOON_KM / moon.dist_km);
    const pi_moon = Math.asin(R_EARTH_KM / moon.dist_km),
      pi_sun = Math.asin(R_EARTH_KM / sun.dist_km);
    const rho_umbra = DANJON * (pi_moon + pi_sun - sd_sun);
    const rho_penum = DANJON * (pi_moon + pi_sun + sd_sun);
    const anti = { ra: sun.ra + Math.PI, dec: -sun.dec };
    const { sep, pa } = skyVec(moon, anti);
    return { sd_primary: sd_moon, rho_umbra, rho_penum, sep, pa };
  }

  /**
   * Lunar eclipse magnitude (umbral for Partial/Total, penumbral for Penumbral)
   * recovered from the glyph geometry, so the card's magnitude always agrees with the
   * drawn glyph. Returns null when no geometry is available.
   */
  function lunarMagnitude(event) {
    const g = ensureGlyph(event);
    if (!g || !isNum(g.sd_primary) || g.sd_primary <= 0 || !isNum(g.sep)) return null;
    const ring = event.kind === 'Penumbral' ? g.rho_penum : g.rho_umbra;
    if (!isNum(ring)) return null;
    return (ring + g.sd_primary - g.sep) / (2 * g.sd_primary);
  }

  /**
   * EclipseWise-style summary stats for a lunar eclipse, for the schematic
   * corner readout. Returns { umbralMag, penumbralMag, gamma, partialMin,
   * totalMin } — any field null when it can't be derived.
   *   U.Mag / P.Mag : umbral / penumbral magnitude (stored field preferred,
   *                   else recovered from glyph geometry).
   *   γ (gamma)     : least distance of the Moon's centre from the shadow axis
   *                   in Earth-radii, north positive. = sep / π_moon, signed by
   *                   whether the Moon passes north (cos pa ≥ 0) of the axis.
   *   Par. / Total  : umbral-partial (U1→U4) and totality (U2→U3) durations, min.
   */
  function lunarStats(event) {
    const g = ensureGlyph(event);
    const t = event.times || {};
    const out = { umbralMag: null, penumbralMag: null, gamma: null, partialMin: null, totalMin: null };
    if (g && isNum(g.sd_primary) && g.sd_primary > 0 && isNum(g.sep)) {
      const sd = g.sd_primary;
      if (isNum(g.rho_umbra)) out.umbralMag = (g.rho_umbra + sd - g.sep) / (2 * sd);
      if (isNum(g.rho_penum)) out.penumbralMag = (g.rho_penum + sd - g.sep) / (2 * sd);
      try {
        if (typeof Astronomy !== 'undefined' && Astronomy.GeoVector && t.peak) {
          const sun = eqAtPeak(Astronomy.Body.Sun, t.peak),
            moon = eqAtPeak(Astronomy.Body.Moon, t.peak);
          const pi_moon = Math.asin(R_EARTH_KM / moon.dist_km);
          const anti = { ra: sun.ra + Math.PI, dec: -sun.dec };
          const { sep, pa } = skyVec(anti, moon);
          out.gamma = (sep / pi_moon) * (Math.cos(pa) >= 0 ? 1 : -1);
        }
      } catch (_) {
        /* leave gamma null */
      }
    }
    // Only let a positive stored value override the geometry. The build bakes
    // penumbralMag=0 (and umbralMag=0) for penumbral events from obscuration=0,
    // which would clobber the correct geometric magnitude (~0.95) with 0.
    if (isNum(event.umbralMag) && event.umbralMag > 0) out.umbralMag = event.umbralMag;
    if (isNum(event.penumbralMag) && event.penumbralMag > 0) out.penumbralMag = event.penumbralMag;
    const durSec = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : null);
    const par = isNum(event.partialDurSec) ? event.partialDurSec : durSec(t.u1, t.u4);
    const tot = isNum(event.totalDurSec) ? event.totalDurSec : durSec(t.u2, t.u3);
    if (par != null && isFinite(par)) out.partialMin = par / 60;
    if (tot != null && isFinite(tot)) out.totalMin = tot / 60;
    return out;
  }

  // Real-time Earth-shadow geometry at an arbitrary instant (reuses the same
  // runtimeLunar math as the sidebar card). Returns the glyph fields plus the
  // moon's umbral & penumbral immersion magnitudes (>0 = in contact, ≥1 = the
  // moon is fully inside that shadow). null when the engine is unavailable.
  // Used by the map moon-disk renderer to paint a live red shadow bite.
  function lunarShadowAt(date) {
    if (typeof Astronomy === 'undefined' || !Astronomy.GeoVector) return null;
    try {
      const g = runtimeLunar(date);
      const sd = g.sd_primary;
      if (!isNum(sd) || sd <= 0) return null;
      return Object.assign({}, g, {
        umbralMag: (g.rho_umbra + sd - g.sep) / (2 * sd),
        penumbralMag: (g.rho_penum + sd - g.sep) / (2 * sd),
      });
    } catch (_) {
      return null;
    }
  }

  // Resolve glyph geometry, computing + caching on the event if absent.
  function ensureGlyph(event) {
    if (event.glyph) return event.glyph;
    if (typeof Astronomy === 'undefined' || !Astronomy.GeoVector) return null;
    try {
      const isSolar = event._kind === 'solar';
      const peakIso = isSolar ? event.peak && event.peak.time : event.times && event.times.peak;
      if (!peakIso) return null;
      event.glyph = isSolar ? runtimeSolar(peakIso, event) : runtimeLunar(peakIso, event);
      return event.glyph;
    } catch (_) {
      return null;
    }
  }

  // ---- SVG Fragment Builders ----
  const svgOpen = (size) => `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">`;
  const sunDisk = (base) => `<image href="${base}img/sun-large.svg"  x="6" y="6" width="28" height="28"/>`;
  const moonDisk = (base) => `<image href="${base}img/moon-large.svg" x="6" y="6" width="28" height="28"/>`;

  // 3.3.1 / 3.3.2 — solar partial & annular: Moon silhouette over the Sun disk.
  function solarOverlay(g, size, base) {
    const r_moon = R * (g.sd_occluder / g.sd_primary);
    const amp = R * (g.sep / g.sd_primary);
    const { dx, dy } = skyOffset(amp, g.pa);
    return (
      svgOpen(size) +
      sunDisk(base) +
      `<circle cx="${f(CX + dx)}" cy="${f(CY + dy)}" r="${f(r_moon)}" fill="var(--ecl-moon-silhouette)"/>` +
      `</svg>`
    );
  }

  // 3.3.3 — Total solar (and Hybrid): fixed corona-ring + black disk + diamond bead.
  function solarTotal(size) {
    return (
      svgOpen(size) +
      `<circle cx="20" cy="20" r="13.5" fill="none" stroke="var(--ecl-corona)" stroke-width="1.1"/>` +
      `<circle cx="20" cy="20" r="10.5" fill="var(--ecl-corona-disk)"/>` +
      `<circle cx="29.55" cy="10.45" r="1.85" fill="var(--ecl-corona-bead)"/>` +
      `</svg>`
    );
  }

  // Inline corona at an arbitrary SVG centre/radius — shared by solarTotal (card)
  // and solarSkyPath (schematic G glyph). solarTotal uses literal coords (20,20,14);
  // solarSkyPath calls this with the real sky position and a scaled rPx.
  function coronaAt(cx, cy, rPx) {
    const kS = rPx / 14;
    return (
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(13.5 * kS)}" fill="none" stroke="var(--ecl-corona,#b7c2cd)" stroke-width="${f(1.1 * kS)}"/>` +
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(10.5 * kS)}" fill="var(--ecl-corona-disk,#15161a)"/>` +
      `<circle cx="${f(cx + 9.55 * kS)}" cy="${f(cy - 9.55 * kS)}" r="${f(1.85 * kS)}" fill="var(--ecl-corona-bead,#eef1f4)"/>`
    );
  }

  // 3.3.4 — Partial lunar: Earth's umbra over the Moon disk, clipped, with center hint.
  function lunarUmbra(g, size, base, cid) {
    const r_umbra = R * (g.rho_umbra / g.sd_primary);
    const amp = R * (g.sep / g.sd_primary);
    const { dx, dy } = skyOffset(amp, g.pa);
    return (
      svgOpen(size) +
      `<defs><clipPath id="${cid}"><circle cx="20" cy="20" r="14"/></clipPath></defs>` +
      moonDisk(base) +
      `<g clip-path="url(#${cid})">` +
      `<circle cx="${f(CX + dx)}" cy="${f(CY + dy)}" r="${f(r_umbra)}" fill="var(--ecl-umbra)" opacity="0.8"/>` +
      `</g></svg>`
    );
  }

  // 3.3.5 — Penumbral lunar: penumbra over the Moon disk, clipped, deep warm wash.
  function lunarPenumbra(g, size, base, cid) {
    const r_penum = R * (g.rho_penum / g.sd_primary);
    const amp = R * (g.sep / g.sd_primary);
    const { dx, dy } = skyOffset(amp, g.pa);
    return (
      svgOpen(size) +
      `<defs><clipPath id="${cid}"><circle cx="20" cy="20" r="14"/></clipPath></defs>` +
      moonDisk(base) +
      `<g clip-path="url(#${cid})">` +
      `<circle cx="${f(CX + dx)}" cy="${f(CY + dy)}" r="${f(r_penum)}" fill="var(--ecl-penumbra)" opacity="0.4"/>` +
      `</g></svg>`
    );
  }

  // 3.3.6 — Total lunar: uniform blood disk over the Moon texture, no asymmetry
  // (owner directive). Like lunarUmbra/lunarPenumbra, the moon disk is drawn
  // underneath so the texture shows through the semi-transparent blood red.
  function lunarTotal(size, base, cid) {
    return (
      svgOpen(size) +
      `<defs><clipPath id="${cid}"><circle cx="20" cy="20" r="14"/></clipPath></defs>` +
      moonDisk(base) +
      `<g clip-path="url(#${cid})"><circle cx="20" cy="20" r="14" fill="var(--ecl-bloodmoon)" opacity="0.8"/></g>` +
      `<circle cx="20" cy="20" r="14" fill="none" stroke="var(--ecl-bloodmoon-rim)" stroke-width="0.8"/>` +
      `</svg>`
    );
  }

  // Plain-disk fallback when geometry is unavailable (no glyph, no engine).
  function plainDisk(isSolar, size, base) {
    return svgOpen(size) + (isSolar ? sunDisk(base) : moonDisk(base)) + `</svg>`;
  }

  // ---- Contact-Trajectory Schematic ----
  // A larger diagram that reproduces the reference figure: the occulting body
  // drawn at every contact instant strung along its crossing trajectory, with
  // each contact labelled. Lunar is a single global figure (Moon crossing
  // Earth's penumbra+umbra rings); solar is location-specific (Moon crossing the
  // Sun, offsets computed topocentrically at the observer's own contact times).

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // Attribute-safe escape (for inlining gloss text into a data-gloss attribute).
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
  // ` data-gloss="…"` fragment for an SVG element, or '' when no text given.
  const glossAttr = (s) => (s ? ` data-gloss="${escAttr(s)}"` : '');
  // Transparent fat hit-casing for a thin schematic line, carrying its gloss so
  // the whole comfortable band — not the 1px visible stroke — triggers the
  // definition card. The SVG renders at ~316px wide regardless of viewBox W, so
  // scale the screen-px floor (HitWidths.MIN) by W/316 to keep the on-screen hit
  // band constant. Mirrors CURVE_HIT_WEIGHT (eclipse.js) and the compass
  // pointer-events:stroke transparent rays (observer.js).
  function hitCasing(x1, y1, x2, y2, W, gloss) {
    const w = f((HitWidths.MIN * W) / 316);
    return (
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" ` +
      `stroke-width="${w}" fill="none" pointer-events="stroke"${glossAttr(gloss)}/>`
    );
  }

  // Polyline form of hitCasing — a transparent fat band tracing a multi-point line
  // (the solar diurnal arc) so the whole curve, not its 1px stroke, is hoverable.
  function hitCasingPoly(points, W, gloss) {
    const w = f((HitWidths.MIN * W) / 316);
    return (
      `<polyline points="${points}" stroke="transparent" stroke-width="${w}" ` +
      `fill="none" stroke-linejoin="round" stroke-linecap="round" pointer-events="stroke"${glossAttr(gloss)}/>`
    );
  }

  // Reusable arrowhead marker (points along the line it terminates). `color`
  // defaults to the path colour; the sky-path diagram passes the axis colour for
  // its coordinate-axis arrows.
  function arrowMarker(id, color) {
    color = color || 'var(--ecl-schem-path, #8a93a3)';
    return (
      `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" ` +
      `markerWidth="5" markerHeight="5" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker></defs>`
    );
  }

  // A body disc drawn with the project's Sun/Moon disk art (a disk filling its
  // own viewBox, transparent outside) instead of a flat fill, with an optional
  // translucent depth tint layered over it and an optional rim stroke. Used by
  // the contact-trajectory schematics so the moon/sun faces show real texture.
  function texturedDisc(href, cx, cy, r, tintColor, tintOpacity, rim) {
    const d = 2 * r;
    let out = `<image href="${href}" x="${f(cx - r)}" y="${f(cy - r)}" width="${f(d)}" height="${f(d)}"/>`;
    if (tintColor && tintOpacity > 0)
      out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${tintColor}" opacity="${tintOpacity}"/>`;
    if (rim) out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${rim}" stroke-width="0.8"/>`;
    return out;
  }

  // Lunar: the Moon strung along its real crossing trajectory through Earth's
  // concentric penumbra/umbra shadow (EclipseWise "Thousand Year Canon" style).
  // Celestial north is up, east is left (sky view). Each Moon is placed at its
  // true sky offset from the antisolar point (= shadow centre) at that contact,
  // so the path tilt is real and the red umbral bite falls on the geometrically
  // correct side. opts.gloss supplies hover text for the rings/ecliptic/path.
  function lunarSchematic(event, base, gloss) {
    base = base || '';
    gloss = gloss || {};
    if (typeof Astronomy === 'undefined' || !Astronomy.GeoVector) return '';
    const g = ensureGlyph(event);
    const t = event.times || {};
    if (!g || !isNum(g.sd_primary) || g.sd_primary <= 0 || !isNum(g.rho_umbra) || !isNum(g.rho_penum)) return '';
    const sd = g.sd_primary;
    const rUm = g.rho_umbra / sd,
      rPen = g.rho_penum / sd;

    // Moon offset from the antisolar point (Moon-radii, sky view) at one instant.
    function moonAt(iso) {
      const sun = eqAtPeak(Astronomy.Body.Sun, iso),
        moon = eqAtPeak(Astronomy.Body.Moon, iso);
      const anti = { ra: sun.ra + Math.PI, dec: -sun.dec };
      const v = skyVec(anti, moon);
      const o = skyOffset(v.sep / sd, v.pa);
      return { x: o.dx, y: o.dy };
    }

    const order = [
      ['P1', t.p1],
      ['U1', t.u1],
      ['U2', t.u2],
      ['G', t.peak],
      ['U3', t.u3],
      ['U4', t.u4],
      ['P4', t.p4],
    ].filter((o) => o[1]);
    const pts = [];
    for (const [key, iso] of order) {
      try {
        const m = moonAt(iso);
        if (isFinite(m.x) && isFinite(m.y)) pts.push({ key, x: m.x, y: m.y });
      } catch (_) {
        /* skip */
      }
    }
    if (!pts.length) return '';

    // Moon-path direction (ingress→egress) and its extended, arrowed endpoints.
    const a = pts[0],
      z = pts[pts.length - 1];
    let pdx = z.x - a.x,
      pdy = z.y - a.y;
    const plen = Math.hypot(pdx, pdy) || 1;
    pdx /= plen;
    pdy /= plen;
    const EXT = 1.6;
    const path0 = { x: a.x - pdx * EXT, y: a.y - pdy * EXT };
    const path1 = { x: z.x + pdx * EXT, y: z.y + pdy * EXT };

    // Ecliptic direction through the shadow centre: two antisolar samples.
    let ecl0 = null,
      ecl1 = null;
    try {
      const pk = Date.parse(t.peak);
      const s0 = eqAtPeak(Astronomy.Body.Sun, t.peak);
      const s1 = eqAtPeak(Astronomy.Body.Sun, new Date(pk + 3600000).toISOString());
      const v = skyVec({ ra: s0.ra + Math.PI, dec: -s0.dec }, { ra: s1.ra + Math.PI, dec: -s1.dec });
      const u = skyOffset(1, v.pa);
      // Match the ecliptic line's length to the Moon-path line (plen + 2·EXT total)
      // so the two reference lines read as an aligned cross through the shadow centre.
      const L = plen / 2 + EXT;
      ecl0 = { x: u.dx * L, y: u.dy * L };
      ecl1 = { x: -u.dx * L, y: -u.dy * L };
    } catch (_) {
      /* ecliptic optional */
    }

    // ── pixel mapping (gather bounds over every element drawn) ──
    const S = 20,
      pad = 16;
    const xs = [-rPen, rPen, path0.x, path1.x],
      ys = [-rPen, rPen, path0.y, path1.y];
    if (ecl0) {
      xs.push(ecl0.x, ecl1.x);
      ys.push(ecl0.y, ecl1.y);
    }
    for (const p of pts) {
      xs.push(p.x - 1, p.x + 1);
      ys.push(p.y - 1, p.y + 1);
    }
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const W = (maxX - minX) * S + 2 * pad,
      H = (maxY - minY) * S + 2 * pad + 18;
    const Xn = (u) => (u - minX) * S + pad,
      Yn = (u) => (u - minY) * S + pad;

    const X = (u) => f(Xn(u)),
      Y = (u) => f(Yn(u));
    const cx0 = Xn(0),
      cy0 = Yn(0),
      rPenPx = rPen * S,
      rUmPx = rUm * S;
    const uid = String(event.date || 'lun').replace(/[^a-z0-9]/gi, '');
    // The SVG renders at ~the same ~316px width regardless of viewBox W, so label
    // text scales by 316/W; size it up so it never drops below the 11px floor.
    const labelFS = f(12 * Math.max(1, W / 320));
    const cg = gloss.contacts || {}; // per-contact hover definitions, keyed P1/U1/…

    let s = `<svg viewBox="0 0 ${f(W)} ${f(H)}" width="100%" class="ecl-schematic" role="img">`;
    s += arrowMarker(`arr-${uid}`);
    // Background shadow rings — neutral dark shadows (no red); red lives only on
    // the shadowed Moon faces below, matching the list-card glyph effect.
    s += `<circle cx="${X(0)}" cy="${Y(0)}" r="${f(rPenPx)}" fill="var(--ecl-schem-pen, #353b47)" opacity="0.5" stroke="var(--ecl-schem-pen-rim, #5a6373)" stroke-width="1"${glossAttr(gloss.penumbra)}/>`;
    s += `<circle cx="${X(0)}" cy="${Y(0)}" r="${f(rUmPx)}" fill="var(--ecl-schem-umb, #23262d)" opacity="0.85" stroke="var(--ecl-schem-umb-rim, #3a3f49)" stroke-width="1"${glossAttr(gloss.umbra)}/>`;
    // Ecliptic (solid, faint) and × at the shadow centre.
    if (ecl0) {
      s += `<line x1="${X(ecl0.x)}" y1="${Y(ecl0.y)}" x2="${X(ecl1.x)}" y2="${Y(ecl1.y)}" stroke="var(--ecl-schem-axis, #6f7787)" stroke-width="1" opacity="0.7" pointer-events="none"/>`;
      s += hitCasing(X(ecl0.x), Y(ecl0.y), X(ecl1.x), Y(ecl1.y), W, gloss.ecliptic);
    }
    const xr = S * 0.275;
    s +=
      `<g stroke="var(--ecl-schem-axis, #6f7787)" stroke-width="1.1" opacity="0.9" pointer-events="none">` +
      `<line x1="${f(cx0 - xr)}" y1="${f(cy0 - xr)}" x2="${f(cx0 + xr)}" y2="${f(cy0 + xr)}"/>` +
      `<line x1="${f(cx0 - xr)}" y1="${f(cy0 + xr)}" x2="${f(cx0 + xr)}" y2="${f(cy0 - xr)}"/></g>`;
    // Shadow-centre hit target (the umbra/penumbra common axis = antisolar point).
    // A transparent circle gives the point-marker a comfortable hover band; it sits
    // above the ring fills (so the centre wins over the broad umbra tip) but is
    // emitted before the Moon disks, so a disk covering the centre wins over it.
    const xHitR = f((HitWidths.MIN * W) / 316);
    s += `<circle cx="${f(cx0)}" cy="${f(cy0)}" r="${xHitR}" fill="transparent" pointer-events="all"${glossAttr(gloss.shadowcenter)}/>`;
    // Moon path (dashed, arrow at the egress end). Visible line is non-interactive;
    // a transparent fat casing (drawn next, before the opaque Moon disks) carries
    // the gloss so the whole band is hoverable.
    s += `<line x1="${X(path0.x)}" y1="${Y(path0.y)}" x2="${X(path1.x)}" y2="${Y(path1.y)}" stroke="var(--ecl-schem-path, #8a93a3)" stroke-width="1" stroke-dasharray="3 3" opacity="0.85" marker-end="url(#arr-${uid})" pointer-events="none"/>`;
    s += hitCasing(X(path0.x), Y(path0.y), X(path1.x), Y(path1.y), W, gloss.moonpath);
    // Contact labels first so the Moon disks (drawn next) occlude them on any
    // overlap in a compact diagram (#9). Each label keeps its hover definition.
    const labelY = f((maxY - minY) * S + pad + 13);
    for (const p of pts) {
      s += `<text x="${X(p.x)}" y="${labelY}" text-anchor="middle" font-size="${labelFS}" fill="var(--ecl-schem-label, #9aa4b2)"${glossAttr(cg[p.key])}>${esc(p.key)}</text>`;
    }
    // Moon at each contact: disk art (no rim) + penumbra/umbra washes clipped to
    // the disk, so each shadow wash covers exactly the Moon ∩ shadow overlap. Drawn
    // after the labels so the opaque disks sit on top.
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i],
        mx = Xn(p.x),
        my = Yn(p.y),
        cid = `eclm-${uid}-${i}`;
      // Wrap disk + shadow wash in a group carrying the same gloss as the contact
      // label, so hovering the Moon disk shows its P1/U1/U2/… explanation card
      // (glossary-tip resolves via closest(), bounding the card to the whole disk).
      s += `<g${glossAttr(cg[p.key])}>`;
      s += `<image href="${base}img/moon-large.svg" x="${f(mx - S)}" y="${f(my - S)}" width="${f(2 * S)}" height="${f(2 * S)}"/>`;
      s += `<defs><clipPath id="${cid}"><circle cx="${f(mx)}" cy="${f(my)}" r="${f(S)}"/></clipPath></defs>`;
      s +=
        `<g clip-path="url(#${cid})">` +
        `<circle cx="${f(cx0)}" cy="${f(cy0)}" r="${f(rPenPx)}" fill="var(--ecl-penumbra, #2a221c)" opacity="0.4"/>` +
        `<circle cx="${f(cx0)}" cy="${f(cy0)}" r="${f(rUmPx)}" fill="var(--ecl-umbra, #a8472e)" opacity="0.8"/>` +
        `</g>`;
      s += `</g>`;
    }
    s += `</svg>`;
    return s;
  }

  // Solar: altitude-azimuth "sky-position" diagram — the Sun's diurnal arc as seen
  // from the observer, with Sun+Moon coverage glyphs placed at each contact's real
  // sky position (alt/az). x = windowed azimuth (C1→C4 left→right in time); y =
  // altitude 0°(horizon, bottom) to 90°(zenith, top). Replaces the old celestial-
  // frame chord diagram with a view that answers "where do I look, how high?".
  function solarSkyPath(event, opts) {
    if (typeof Astronomy === 'undefined' || typeof bodyHorizontal !== 'function') return '';
    const base = opts.assetBase || '';
    const obs = opts.observer,
      c = opts.contacts || {};
    const cg = opts.gloss || {}; // per-contact hover definitions, keyed P1/G/P4
    // Optional per-key display-text overrides (e.g. a horizon-truncated P4 shown as
    // a localized "Sunset"). Falls back to the bare P1/G/P4 code when unset.
    const labels = opts.labels || {};
    if (!obs) return '';
    const lat = obs.lat,
      lng = obs.lng;
    const Sun = Astronomy.Body.Sun,
      Moon = Astronomy.Body.Moon;
    const aeObs = new Astronomy.Observer(lat, lng, 0);

    // Contacts shown on the diagram: P1 · G · P4 only (labels match the contact
    // table below, which uses P1/P2/P3/P4/G). The two central contacts C2/C3 are
    // deliberately dropped — drawing five glyphs over a narrow azimuth window is
    // too crowded; the totality/annularity interval is conveyed by the corner
    // Tot./Ann. readout instead. Partial events already have null c2/c3, so every
    // eclipse type reduces to the same three glyphs.
    const order = [
      ['P1', c.c1],
      ['G', c.maxTime],
      ['P4', c.c4],
    ].filter((o) => o[1] instanceof Date && !isNaN(o[1]));
    if (!order.length) return '';

    // Per-contact sky geometry: Sun/Moon alt-az (degrees) + angular semidiameters (degrees).
    function contactGeom(date) {
      const sunH = bodyHorizontal(Sun, date, lat, lng);
      const moonH = bodyHorizontal(Moon, date, lat, lng);
      if (!sunH || !moonH) return null;
      const se = Astronomy.Equator(Sun, date, aeObs, true, true);
      const me = Astronomy.Equator(Moon, date, aeObs, true, true);
      const sdSun = (Math.asin(R_SUN_KM / (se.dist * Astronomy.KM_PER_AU)) * 180) / Math.PI;
      const sdMoon = (Math.asin(R_MOON_KM / (me.dist * Astronomy.KM_PER_AU)) * 180) / Math.PI;
      return { sunAz: sunH.az, sunAlt: sunH.alt, moonAz: moonH.az, moonAlt: moonH.alt, sdSun, sdMoon };
    }

    const contacts = [];
    for (const [key, date] of order) {
      try {
        const g = contactGeom(date);
        if (g && isFinite(g.sunAlt) && isFinite(g.sunAz)) contacts.push({ key, date, ...g });
      } catch (_) {
        /* skip */
      }
    }
    if (!contacts.length) return '';

    // Unwrap azimuths relative to G so arcs crossing due north (0°/360°) stay continuous.
    // x = increasing unwrapped azimuth → time runs left→right (azimuth-up, not east-left).
    const gContact = contacts.find((p) => p.key === 'G') || contacts[Math.floor(contacts.length / 2)];
    const refAz = gContact.sunAz;
    const unwrap = (a) => {
      let d = a - refAz;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      return refAz + d;
    };
    for (const p of contacts) {
      p.sunAzU = unwrap(p.sunAz);
      p.moonAzU = unwrap(p.moonAz);
    }

    // Eclipse time span (P1→P4). The drawn diurnal arc (step 2) is sampled wider
    // than this and clipped to the plot box; the azimuth window below is sized by the
    // contacts alone, so the edge target stays fixed (it won't recede as the drawn
    // arc grows) and the arc can run past the discs out to the box edges.
    const tC1 = order[0][1].getTime(),
      tC4 = order[order.length - 1][1].getTime();
    const span = Math.max(tC4 - tC1, 60000);

    // Fixed viewBox 320×210. padB hosts the per-contact azimuth tick row beneath
    // the horizon (x) axis; padL hosts the right-aligned "90°"…"0°" altitude ticks.
    // FS is the SVG text size in user units; the diagram renders at ~316px wide
    // (360px sidebar − insets) so 1 unit ≈ 1px and FS=12 clears the 11px floor.
    const VBW = 320,
      VBH = 210;
    const padL = 36,
      padR = 16,
      padT = 16,
      padB = 30;
    const plotW = VBW - padL - padR; // 268
    const plotH = VBH - padT - padB; // 164
    const rPx = 16; // Sun glyph radius (also the L/R draw inset)
    const FS = 12; // → ~11.9px rendered, ≥ the 11px minimum

    // Azimuth window: the *above-horizon* contact (Sun + Moon) unwrapped azimuths
    // plus a margin, so the visible glyphs spread across the plot width (a
    // below-horizon contact contributes nothing — it isn't drawn). Fall back to all
    // contacts only if nothing is above the horizon (degenerate, shouldn't happen).
    const azVals = [];
    for (const p of contacts) if (p.sunAlt >= 0) azVals.push(p.sunAzU, p.moonAzU);
    if (!azVals.length) for (const p of contacts) azVals.push(p.sunAzU);
    let azMin = Math.min(...azVals),
      azMax = Math.max(...azVals);
    const azPad = Math.max((azMax - azMin) * 0.12, 0.6); // floor prevents zero-width window
    azMin -= azPad;
    azMax += azPad;

    // y: 90°→top, 0°→bottom. x: inset by rPx so the outermost glyph disc and its
    // label never cross the left/right axes (grid + horizon still span full width).
    const inset = rPx + 2;
    const yOf = (alt) => padT + ((90 - alt) / 90) * plotH;
    const xOf = (az) => padL + inset + ((az - azMin) / (azMax - azMin)) * (plotW - 2 * inset);

    const uid = String(event.date || 'sol').replace(/[^a-z0-9]/gi, '');
    let s = `<svg viewBox="0 0 ${VBW} ${VBH}" width="100%" class="ecl-schematic ecl-skypath" role="img">`;
    s += arrowMarker(`arr-path-${uid}`); // diurnal-arc arrow (path colour)
    s += arrowMarker(`arr-axis-${uid}`, 'var(--ecl-schem-axis,#6f7787)'); // coordinate-axis arrows

    // 1. Coordinate frame: 30° altitude grid, left axis with a zenith arrow, and
    //    degree-marked ticks. 0° is the always-on horizon (drawn in step 3), 90°
    //    the top edge; gridlines fall at 30° and 60°. No vertical azimuth grid —
    //    the windowed azimuth span is usually <30° wide, so it would never show.
    s += `<g class="ecl-skp-axis">`;
    for (const gAlt of [30, 60]) {
      const gy = f(yOf(gAlt));
      s += `<line x1="${f(padL)}" y1="${gy}" x2="${f(VBW - padR)}" y2="${gy}" stroke="var(--ecl-schem-grid,var(--ecl-schem-axis,#6f7787))" stroke-width="0.6" stroke-opacity="0.18"/>`;
    }
    // Left altitude axis, arrow pointing up toward the zenith.
    s += `<line x1="${f(padL)}" y1="${f(yOf(0))}" x2="${f(padL)}" y2="${f(yOf(90) - 4)}" stroke="var(--ecl-schem-axis,#6f7787)" stroke-width="0.8" stroke-opacity="0.5" marker-end="url(#arr-axis-${uid})"/>`;
    for (const gAlt of [0, 30, 60, 90]) {
      s += `<text x="${f(padL - 4)}" y="${f(yOf(gAlt) + FS * 0.34)}" text-anchor="end" font-size="${FS}" fill="var(--ecl-schem-label,#9aa4b2)" opacity="0.65">${gAlt}°</text>`;
    }
    s += `</g>`;

    // 2. Diurnal arc — sampled over a wider window than the contacts and stretched
    //    out to the plot-box edges (clipped to x∈[padL, VBW−padR]); above-horizon
    //    only, split into runs at the horizon. The azimuth window above is sized by
    //    the contacts, so the discs are unaffected — only the drawn path runs farther,
    //    reaching the box edge (or the bottom horizon edge if the Sun sets first).
    //    The latest run carries the direction-of-motion arrow.
    const xL = padL,
      xR = VBW - padR;
    const padMsDraw = span * 1.0;
    const ARC_DRAW_N = 56;
    const arcRuns = [];
    let run = [];
    for (let i = 0; i <= ARC_DRAW_N; i++) {
      const t = new Date(tC1 - padMsDraw + ((span + 2 * padMsDraw) * i) / ARC_DRAW_N);
      const h = bodyHorizontal(Sun, t, lat, lng);
      if (h && isFinite(h.az) && isFinite(h.alt) && h.alt >= 0) run.push({ x: xOf(unwrap(h.az)), y: yOf(h.alt) });
      else if (run.length) {
        arcRuns.push(run);
        run = [];
      }
    }
    if (run.length) arcRuns.push(run);
    // Clip each run to the box's left/right edges (the path is monotonic in x, so this
    // trims the ends, interpolating exact edge crossings). y stays in-box (alt 0..90).
    const crossX = (a, b, x) => ({ x, y: a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y) });
    const clipRunX = (pts) => {
      const outRuns = [];
      let cur = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i],
          inside = p.x >= xL && p.x <= xR;
        if (inside) {
          if (!cur.length && i > 0) {
            const q = pts[i - 1];
            cur.push(crossX(q, p, q.x < xL ? xL : xR));
          }
          cur.push(p);
        } else if (cur.length) {
          const q = cur[cur.length - 1];
          cur.push(crossX(q, p, p.x < xL ? xL : xR));
          outRuns.push(cur);
          cur = [];
        } else if (i > 0) {
          const q = pts[i - 1];
          if ((q.x < xL && p.x > xR) || (q.x > xR && p.x < xL))
            outRuns.push([crossX(q, p, q.x < xL ? xL : xR), crossX(q, p, p.x < xL ? xL : xR)]);
        }
      }
      if (cur.length) outRuns.push(cur);
      return outRuns;
    };
    const drawRuns = [];
    for (const r of arcRuns) for (const c of clipRunX(r)) if (c.length >= 2) drawRuns.push(c);
    for (let si = 0; si < drawRuns.length; si++) {
      const pts = drawRuns[si].map((p) => `${f(p.x)},${f(p.y)}`).join(' ');
      const arrow = si === drawRuns.length - 1 ? ` marker-end="url(#arr-path-${uid})"` : '';
      // Visible arc is non-interactive; a transparent fat casing carries the gloss
      // so the whole curve is hoverable. Drawn before the contact groups, so the
      // per-contact disc hit circles sit above it and win hover near the discs.
      s += `<polyline class="ecl-skp-arc" points="${pts}" fill="none" stroke="var(--ecl-schem-path,#8a93a3)" stroke-width="1.2" stroke-opacity="0.4" pointer-events="none"${arrow}/>`;
      s += hitCasingPoly(pts, VBW, cg.sunpath);
    }

    // 3. Horizon line — always on, solid (it is the azimuth/time x-axis baseline,
    //    not a soft reference line). With the altitude axis fixed at 0–90°, yOf(0)
    //    is the bottom edge; the arrow points toward increasing azimuth (later in
    //    the eclipse). It reads distinctly from the faint 30°/60° grid by opacity.
    const hy = f(yOf(0));
    s += `<line class="ecl-skp-horizon" x1="${f(padL)}" y1="${hy}" x2="${f(VBW - padR)}" y2="${hy}" stroke="var(--ecl-horizon,var(--ecl-schem-axis,#6f7787))" stroke-width="1" stroke-opacity="0.6" marker-end="url(#arr-axis-${uid})"/>`;

    // 4. Per-contact group: one <g class="ecl-skp-pt"> bundling everything for a
    //    contact so a single CSS :hover reveals its reference crosshair and
    //    highlights its read-outs. Document order = paint order, so the dashed
    //    crosshair is drawn first (sits beneath the disc), then the Sun+Moon
    //    coverage glyph at the Sun's real sky position, then the P-label, the
    //    azimuth x-axis tick, and finally a transparent hit circle on top so the
    //    whole disc area (incl. corona gaps) is hoverable. A contact whose Sun is
    //    below the horizon is skipped entirely — it still appears, dimmed, in the
    //    contact table below.
    const maxPhase = (c.maxPhase || '').toLowerCase();
    const drawn = contacts.filter((p) => p.sunAlt >= 0);
    const azRowY = f(VBH - padB + FS + 2); // azimuth tick baseline, below the axis

    // Per-contact geometry: Sun centre (gx,gy), Moon offset (mdx,mdy), and the
    // combined Sun∪Moon glyph vertical extent used to place the label clear of the
    // moon disc as well as the sun (#7).
    const geo = drawn.map((p) => {
      const gx = xOf(p.sunAzU),
        gy = yOf(p.sunAlt);
      // Moon offset in the alt-az frame (NOT celestial PA): the cos(alt) factor
      // compensates for azimuth circles converging toward the zenith.
      const k = rPx / p.sdSun;
      const dxDeg = (p.moonAzU - p.sunAzU) * Math.cos((p.sunAlt * Math.PI) / 180);
      const dyDeg = p.moonAlt - p.sunAlt;
      const mdx = k * dxDeg,
        mdy = -k * dyDeg; // +alt → −y (screen y grows downward)
      const rMoonPx = rPx * (p.sdMoon / p.sdSun);
      const glyphTop = Math.min(gy - rPx, gy + mdy - rMoonPx);
      const glyphBot = Math.max(gy + rPx, gy + mdy + rMoonPx);
      return { p, gx, gy, mdx, mdy, rMoonPx, glyphTop, glyphBot, ly: 0 };
    });

    // Label collision avoidance (#6): keep each P-label clear of the sun∪moon glyph
    // (try above, then below, then nudge outward) and of already-placed labels, so
    // neighbouring contacts in a narrow window don't print over each other. The disc
    // is drawn after the label below, so any residual overlap is occluded cleanly.
    const yMin = padT + FS,
      yMax = VBH - padB - 4;
    const STEP = FS + 6; // vertical stacking pitch (> rendered glyph height)
    const placedBoxes = [];
    const boxesOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    // ly is the text baseline; its footprint runs from ~FS above to a small descent
    // below, so box = [ly − FS, ly + 3] (≈ the actual rendered glyph height of ~FS·1.2).
    const boxAt = (ly, x0, x1) => ({ x0, x1, y0: ly - FS, y1: ly + 3 });
    for (const g of geo) {
      const w = Math.max(FS, esc(labels[g.p.key] || g.p.key).length * FS * 0.66) + 4; // +4: keep a horizontal gap
      const x0 = g.gx - w / 2,
        x1 = g.gx + w / 2;
      const cand = [];
      for (let i = 0; i < 6; i++) cand.push(g.glyphTop - 4 - i * STEP); // above the glyph
      for (let i = 0; i < 6; i++) cand.push(g.glyphBot + FS + i * STEP); // below the glyph
      let chosen = null;
      for (const ly of cand) {
        if (ly - FS < yMin || ly + 3 > yMax) continue;
        const box = boxAt(ly, x0, x1);
        if (!placedBoxes.some((b) => boxesOverlap(box, b))) {
          chosen = { ly, box };
          break;
        }
      }
      if (!chosen) {
        const ly = Math.min(yMax - 3, Math.max(yMin + FS, g.glyphTop - 4));
        chosen = { ly, box: boxAt(ly, x0, x1) };
      }
      g.ly = chosen.ly;
      placedBoxes.push(chosen.box);
    }

    // Document order inside each group = paint order. Read-outs (crosshair, hialt,
    // P-label, azimuth tick) come first, then the coverage glyph so the disc sits on
    // top and occludes any overlapping axis/label text (#5), and finally the
    // transparent hit circle so the whole disc area still triggers :hover.
    for (const g of geo) {
      const p = g.p,
        gx = g.gx,
        gy = g.gy,
        mdx = g.mdx,
        mdy = g.mdy,
        rMoonPx = g.rMoonPx;
      s += `<g class="ecl-skp-pt">`;

      // Reference crosshair (hover-only, beneath everything): vertical drop to the
      // horizon (azimuth/x), horizontal run to the altitude axis (y).
      s += `<line class="ecl-skp-cross" x1="${f(gx)}" y1="${f(gy)}" x2="${f(gx)}" y2="${hy}"/>`;
      s += `<line class="ecl-skp-cross" x1="${f(gx)}" y1="${f(gy)}" x2="${f(padL)}" y2="${f(gy)}"/>`;

      // Highlighted altitude read-out at the left axis (hover-only). Same +/−°
      // convention as the contact table; no gloss (axis read-outs stay tip-free).
      const altDeg = Math.round(p.sunAlt);
      const altStr = (altDeg < 0 ? '−' : '+') + Math.abs(altDeg) + '°';
      s += `<text class="ecl-skp-hialt" x="${f(padL - 4)}" y="${f(gy + FS * 0.34)}" text-anchor="end" font-size="${FS}">${altStr}</text>`;

      // P-label (drawn before the glyph so the disc occludes it on any overlap).
      // Carries a hover definition (opts.gloss).
      s += `<text class="ecl-skp-label" x="${f(gx)}" y="${f(g.ly)}" text-anchor="middle" font-size="${FS}" fill="var(--ecl-schem-label,#9aa4b2)"${glossAttr(cg[p.key])}>${esc(labels[p.key] || p.key)}</text>`;

      // Azimuth x-axis tick beneath the horizon (always on; no gloss).
      const azDeg = Math.round(((p.sunAz % 360) + 360) % 360);
      const ax = Math.max(FS, Math.min(VBW - FS, gx));
      s += `<text class="ecl-skp-az" x="${f(ax)}" y="${azRowY}" text-anchor="middle" font-size="${FS}" fill="var(--ecl-schem-label,#9aa4b2)" opacity="0.7">${azDeg}°</text>`;

      // Coverage glyph — on top of the read-out text (#5).
      s += `<g class="ecl-skyglyph">`;
      if (p.key === 'G') {
        if (maxPhase === 'total') {
          // Corona ring + black disk + diamond bead, scaled to rPx.
          s += coronaAt(gx, gy, rPx);
        } else if (maxPhase === 'annular') {
          // Ring-of-fire: Moon (rMoon < rSun) centred over Sun — ring remains visible.
          s += texturedDisc(`${base}img/sun-large.svg`, gx, gy, rPx, null, 0, null);
          s += `<circle cx="${f(gx + mdx)}" cy="${f(gy + mdy)}" r="${f(rMoonPx)}" fill="var(--ecl-moon-silhouette,#15161a)"/>`;
        } else {
          // Local partial or hybrid-seen-as-partial: deepest bite glyph.
          s += texturedDisc(`${base}img/sun-large.svg`, gx, gy, rPx, null, 0, null);
          s += texturedDisc(
            `${base}img/moon-large.svg`,
            gx + mdx,
            gy + mdy,
            rMoonPx,
            'var(--ecl-moon-silhouette,#15161a)',
            0.9,
            null
          );
        }
      } else {
        s += texturedDisc(`${base}img/sun-large.svg`, gx, gy, rPx, null, 0, null);
        s += texturedDisc(
          `${base}img/moon-large.svg`,
          gx + mdx,
          gy + mdy,
          rMoonPx,
          'var(--ecl-moon-silhouette,#15161a)',
          0.9,
          null
        );
      }
      s += `</g>`;

      // Transparent hit target on top → the entire disc area triggers :hover and
      // carries the same gloss definition as the contact label, so hovering the
      // disc shows the P1/G/P4 explanation card too.
      const rHit = f(Math.max(rPx, rMoonPx) + 2);
      s += `<circle class="ecl-skp-hit" cx="${f(gx)}" cy="${f(gy)}" r="${rHit}"${glossAttr(cg[p.key])}/>`;

      s += `</g>`;
    }

    s += `</svg>`;
    return s;
  }

  // Public: contact-trajectory schematic for the active-eclipse sidebar. Returns
  // '' when geometry is unavailable so the caller can omit the figure.
  function renderSchematic(event, opts) {
    opts = opts || {};
    try {
      return event._kind === 'solar' ? solarSkyPath(event, opts) : lunarSchematic(event, opts.assetBase, opts.gloss);
    } catch (_) {
      return '';
    }
  }

  /**
   * Build an inline SVG string for an eclipse-list card.
   * @param {Object} event  — record with `_kind` ('solar'/'lunar'), `kind`, `glyph`
   * @param {Object} [opts]
   * @param {number} [opts.size=42]
   * @param {string} [opts.idPrefix]  unique per card (clipPath id namespace)
   * @param {string} [opts.assetBase=''] path prefix for img/ assets
   * @returns {string}
   */
  function render(event, opts) {
    opts = opts || {};
    const size = opts.size || 42;
    const base = opts.assetBase || '';
    const idPrefix = opts.idPrefix || `eg-${event._kind || 'e'}-${event.date || 'x'}`;
    const cid = `${idPrefix}-clip`;

    const isSolar = event._kind === 'solar';
    const kind = event.kind || '';

    // Total solar / total-annular (hybrid) — fixed replacement, no geometry needed.
    if (isSolar && (kind === 'Total' || kind === 'Hybrid')) return solarTotal(size);

    const g = ensureGlyph(event);
    // A glyph object may exist but be partially populated (older build, curve-
    // only record). Validate the fields each builder dereferences so we degrade
    // to a plain disk instead of emitting <circle r="NaN"> (an invisible bite).
    const baseOk = g && isNum(g.sd_primary) && g.sd_primary > 0 && isNum(g.sep) && isNum(g.pa);

    if (isSolar) {
      // Partial & Annular share one formula; r_moon<R for annular shows a ring.
      return baseOk && isNum(g.sd_occluder) ? solarOverlay(g, size, base) : plainDisk(true, size, base);
    }

    if (kind === 'Total') return lunarTotal(size, base, cid); // geometry ignored
    if (!baseOk) return plainDisk(false, size, base);
    if (kind === 'Penumbral')
      return isNum(g.rho_penum) ? lunarPenumbra(g, size, base, cid) : plainDisk(false, size, base);
    return isNum(g.rho_umbra) ? lunarUmbra(g, size, base, cid) : plainDisk(false, size, base); // Partial
  }

  return { render, renderSchematic, lunarMagnitude, lunarStats, lunarShadowAt };
})();
