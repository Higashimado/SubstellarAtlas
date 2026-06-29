/**
 * Besselian-element runtime — the SAME geometry as the offline curve builder
 * (tools/lib/bessel.mjs), ported to the browser so the real-time eclipse shadow
 * (js/eclipse.js) stays tangent to the cached contact curves.
 *
 * Two evaluators (mirroring the build's pickEvaluator):
 *   • evalBessel(poly, date) — NASA-transcribed polynomials (4 events,
 *                              data/eclipses/bessel-poly.json).
 *   • coreBesselAE(AE, date) — direct from Astronomy Engine for every other event.
 *
 * No time-derivatives — the instantaneous footprint marches azimuth and needs
 * only the static elements.
 */
const BesselRT = (() => {
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  // sqrt(1 − e²), WGS-84 — same constant the builder uses.
  const FLATTENING_FACTOR = 0.99664719;

  const R_EARTH_EQ_KM = 6378.137;
  const R_SUN_KM = 695700;
  const R_MOON_KM = 1737.4;

  // Horner's method.
  function polyval(coeffs, t) {
    let r = 0;
    for (let i = coeffs.length - 1; i >= 0; i--) r = r * t + coeffs[i];
    return r;
  }

  // Evaluate static Besselian elements from cached polynomials at TDT-hours t.
  function evalBesselAtT(eclipse, t) {
    // μ tracks Earth rotation (defined in UT): use t_UT = t_TDT − ΔT/3600.
    const t_for_mu = t - eclipse.delta_t_seconds / 3600;
    const p = eclipse.polynomials;
    const muDeg = polyval(p.mu, t_for_mu);
    const mu_rad = (((muDeg % 360) + 360) % 360) * DEG2RAD;
    return {
      x: polyval(p.x, t),
      y: polyval(p.y, t),
      d_rad: polyval(p.d, t) * DEG2RAD,
      mu_rad,
      l1: polyval(p.l1, t),
      l2: polyval(p.l2, t),
      tan_f1: eclipse.tan_f1,
      tan_f2: eclipse.tan_f2,
    };
  }

  // UTC instant → Besselian elements via the cached polynomial.
  function evalBessel(eclipse, utcDate) {
    const tdtMs = utcDate.getTime() + eclipse.delta_t_seconds * 1000;
    const tdtDate = new Date(tdtMs);
    const midnightMs = Date.UTC(tdtDate.getUTCFullYear(), tdtDate.getUTCMonth(), tdtDate.getUTCDate());
    const tdtHoursOfDay = (tdtMs - midnightMs) / 3600000;
    const t = tdtHoursOfDay - eclipse.t0_tdt_hours;
    return evalBesselAtT(eclipse, t);
  }

  // Direct computation of the 8 elements from Astronomy Engine ephemerides.
  // Verbatim port of _coreBesselAE (tools/lib/bessel.mjs); `AE` is the global
  // Astronomy object. No derivatives — the ring projector doesn't need them.
  function coreBesselAE(AE, utcDate) {
    const time = AE.MakeTime(utcDate);
    const sAU = AE.GeoVector(AE.Body.Sun, time, true); // aberration-corrected
    const mAU = AE.GeoMoon(time);
    const KM = AE.KM_PER_AU;
    const sx = sAU.x * KM,
      sy = sAU.y * KM,
      sz = sAU.z * KM;
    const mx = mAU.x * KM,
      my = mAU.y * KM,
      mz = mAU.z * KM;

    // EQJ → EQD (equator of date).
    const rot = AE.Rotation_EQJ_EQD(time);
    function rotate(x, y, z) {
      return {
        x: rot.rot[0][0] * x + rot.rot[1][0] * y + rot.rot[2][0] * z,
        y: rot.rot[0][1] * x + rot.rot[1][1] * y + rot.rot[2][1] * z,
        z: rot.rot[0][2] * x + rot.rot[1][2] * y + rot.rot[2][2] * z,
      };
    }
    const S = rotate(sx, sy, sz);
    const M = rotate(mx, my, mz);

    // Shadow-axis unit vector: Moon → Sun.
    const ax = S.x - M.x,
      ay = S.y - M.y,
      az = S.z - M.z;
    const D_sm = Math.hypot(ax, ay, az);
    const zx = ax / D_sm,
      zy = ay / D_sm,
      zz = az / D_sm;

    const d_rad = Math.asin(zz);
    const alpha_rad = Math.atan2(zy, zx);

    const cosD = Math.cos(d_rad);
    const xiX = -zy / cosD,
      xiY = zx / cosD,
      xiZ = 0;
    const etX = zy * xiZ - zz * xiY;
    const etY = zz * xiX - zx * xiZ;
    const etZ = zx * xiY - zy * xiX;

    const mDotZ = M.x * zx + M.y * zy + M.z * zz;
    const p0x = M.x - mDotZ * zx;
    const p0y = M.y - mDotZ * zy;
    const p0z = M.z - mDotZ * zz;
    const x_bessel = (p0x * xiX + p0y * xiY + p0z * xiZ) / R_EARTH_EQ_KM;
    const y_bessel = (p0x * etX + p0y * etY + p0z * etZ) / R_EARTH_EQ_KM;

    const gmstHours = AE.SiderealTime(utcDate);
    const gmstDeg = gmstHours * 15;
    const mu_deg = (((gmstDeg - alpha_rad * RAD2DEG) % 360) + 360) % 360;

    const tan_f1 = (R_SUN_KM + R_MOON_KM) / D_sm;
    const tan_f2 = (R_SUN_KM - R_MOON_KM) / D_sm;
    const l1_km = R_MOON_KM + mDotZ * tan_f1;
    const l2_km = mDotZ * tan_f2 - R_MOON_KM;

    return {
      x: x_bessel,
      y: y_bessel,
      d_rad,
      mu_rad: mu_deg * DEG2RAD,
      l1: l1_km / R_EARTH_EQ_KM,
      l2: l2_km / R_EARTH_EQ_KM,
      tan_f1,
      tan_f2,
    };
  }

  // Fundamental plane (ξ, η) → geographic (lat, lng, ζ) on the WGS-84 ellipsoid.
  // Sunlit-side root (ζ > 0). Returns null if (ξ, η) is off Earth. Verbatim port.
  function fundamentalToGeo(xi, eta, bessel) {
    const F = FLATTENING_FACTOR;
    const F2 = F * F;
    const sinD = Math.sin(bessel.d_rad),
      cosD = Math.cos(bessel.d_rad);
    let rho_sq = 1;
    let lat = 0,
      lng = 0,
      zeta = 0;
    for (let iter = 0; iter < 5; iter++) {
      const zsq = rho_sq - xi * xi - eta * eta;
      if (zsq < 0) return null;
      zeta = Math.sqrt(zsq);
      const rho_sin_phi_p = eta * cosD + zeta * sinD;
      const c = zeta * cosD - eta * sinD;
      const rho_cos_phi_p = Math.sqrt(xi * xi + c * c);
      const tan_phi_p = rho_sin_phi_p / rho_cos_phi_p;
      lat = Math.atan(tan_phi_p / F2) * RAD2DEG;
      const H = Math.atan2(xi, c);
      lng = (H - bessel.mu_rad) * RAD2DEG;
      lng = ((lng + 540) % 360) - 180;
      const u = Math.atan(F * Math.tan(lat * DEG2RAD));
      rho_sq = Math.cos(u) ** 2 + F2 * Math.sin(u) ** 2;
    }
    return { lat, lng, zeta };
  }

  // Geographic → fundamental plane (ξ, η, ζ). Inverse of fundamentalToGeo;
  // verbatim port of geoToFundamental (tools/lib/bessel.mjs). ξ east-of-axis,
  // η north-of-axis, ζ along the axis toward the Sun (ζ<0 ⇒ Sun below horizon).
  function geoToFundamental(latDeg, lngDeg, bessel) {
    const lat = latDeg * DEG2RAD;
    const lng = lngDeg * DEG2RAD;
    const u = Math.atan(FLATTENING_FACTOR * Math.tan(lat));
    const rho_sin_phi_p = FLATTENING_FACTOR * Math.sin(u);
    const rho_cos_phi_p = Math.cos(u);
    const H = bessel.mu_rad + lng;
    const sinH = Math.sin(H),
      cosH = Math.cos(H);
    const sinD = Math.sin(bessel.d_rad),
      cosD = Math.cos(bessel.d_rad);
    const xi = rho_cos_phi_p * sinH;
    const eta = rho_sin_phi_p * cosD - rho_cos_phi_p * sinD * cosH;
    const zeta = rho_sin_phi_p * sinD + rho_cos_phi_p * cosD * cosH;
    return { xi, eta, zeta };
  }

  // Local circumstances at a geographic point — eclipse magnitude and phase plus
  // the intermediate (m, L1', L2', ζ) values. Verbatim port of localCircumstances
  // (tools/lib/bessel.mjs). phase ∈ {below_horizon, no_eclipse, partial, total,
  // annular}. magnitude is the fraction of the Sun's diameter covered (>1 inside
  // umbra). `bessel` is whatever coreBesselAE / evalBessel returns.
  function localCircumstances(latDeg, lngDeg, bessel) {
    const { xi, eta, zeta } = geoToFundamental(latDeg, lngDeg, bessel);
    const u = bessel.x - xi;
    const v = bessel.y - eta;
    const m = Math.sqrt(u * u + v * v);
    const L1p = bessel.l1 - zeta * bessel.tan_f1;
    const L2p = bessel.l2 - zeta * bessel.tan_f2;
    const magnitude = (L1p - m) / (L1p + L2p);
    let phase;
    if (zeta < 0) phase = 'below_horizon';
    else if (m > L1p) phase = 'no_eclipse';
    else if (m < Math.abs(L2p)) phase = L2p < 0 ? 'total' : 'annular';
    else phase = 'partial';
    return { magnitude, phase, m, L1p, L2p, xi, eta, zeta, u, v };
  }

  // Closed-form SPHERICAL inverse (ζ = √(max(0, 1−ρ²)), the limb/terminator at
  // ρ≥1). Used INSTEAD of the ellipsoid fundamentalToGeo for the partial-
  // visibility contours because it is defined and smooth EVERYWHERE on the disc
  // (fundamentalToGeo returns null in a thin band near ρ=1), and the field is
  // built with spherical ζ anyway, so this is self-consistent. Residual ≈20 km
  // (sub-pixel at the low zooms that matter). Never returns null → contours stay
  // connected. The umbra ring keeps the ellipsoid fundamentalToGeo.
  function fundamentalToGeoSphere(xi, eta, bessel) {
    const F2 = FLATTENING_FACTOR * FLATTENING_FACTOR;
    const rho2 = xi * xi + eta * eta;
    const zeta = rho2 < 1 ? Math.sqrt(1 - rho2) : 0;
    const sinD = Math.sin(bessel.d_rad),
      cosD = Math.cos(bessel.d_rad);
    const rho_sin_phi_p = eta * cosD + zeta * sinD;
    const c = zeta * cosD - eta * sinD;
    const rho_cos_phi_p = Math.sqrt(xi * xi + c * c);
    const lat = Math.atan(rho_sin_phi_p / rho_cos_phi_p / F2) * RAD2DEG;
    let lng = (Math.atan2(xi, c) - bessel.mu_rad) * RAD2DEG;
    lng = ((lng + 540) % 360) - 180;
    return { lat, lng, zeta };
  }

  // Single-azimuth ring solver — the per-vertex primitive. Place the trial point
  // at (ξ,η) = (b.x + r·cosθ, b.y + r·sinθ) so the axis distance m ≡ r exactly,
  // then binary-search r to the ring boundary defined by insideTest(m,L1p,L2p,mag).
  // Each accepted (ξ,η) is projected to (lat,lng) via fundamentalToGeo on the
  // ellipsoid — identical to the build's offset-curve construction, hence tangent
  // to the cached limits. Returns [lat,lng] or null (limb-clipped / no intersect).
  //
  // Exposed so the Mercator densifier can re-solve at arbitrary midpoint
  // azimuths (re-solve, don't interpolate — keeps every inserted vertex exactly
  // on the true ring, same discipline as the cached densifyRiseSet).
  function projectAzimuth(b, insideTest, theta) {
    const ct = Math.cos(theta),
      st = Math.sin(theta);
    let lo = 0,
      hi = 2.0,
      last = null;
    for (let k = 0; k < 24; k++) {
      const r = 0.5 * (lo + hi);
      const xi = b.x + r * ct,
        eta = b.y + r * st;
      const g = fundamentalToGeo(xi, eta, b);
      let inside = false;
      if (g) {
        const L1p = b.l1 - g.zeta * b.tan_f1;
        const L2p = b.l2 - g.zeta * b.tan_f2;
        const mag = (L1p - r) / (L1p + L2p);
        inside = insideTest(r, L1p, L2p, mag);
        if (inside) last = [g.lat, g.lng];
      }
      if (inside) lo = r;
      else hi = r;
    }
    return last;
  }

  // Seed-sweep: nAz+1 evenly-spaced azimuth samples (closed ring). Returns
  // { thetas, pts } so the densifier can recurse in azimuth between adjacent
  // seeds without re-deriving them.
  function projectRing(b, insideTest, nAz) {
    nAz = nAz || 96;
    const thetas = new Array(nAz + 1);
    const pts = new Array(nAz + 1);
    for (let i = 0; i <= nAz; i++) {
      const th = (2 * Math.PI * i) / nAz;
      thetas[i] = th;
      pts[i] = projectAzimuth(b, insideTest, th);
    }
    return { thetas, pts };
  }

  // ---- Web-Mercator Helpers ----
  // The map (js/map.js) renders in Web Mercator, so on-screen smoothness is
  // governed by chord distance in (lng, mercatorY) space — NOT ground km. Near
  // the poles dy/dφ = sec φ blows up, so a short polar ground segment can still
  // be a long visible chord. The cached rise/set curves use the same metric
  // (see densifyRiseSet in build-bessel-curves.mjs:2117-2170).
  function mercatorY(lat) {
    const p = Math.max(-89.9, Math.min(89.9, lat));
    return RAD2DEG * Math.log(Math.tan(Math.PI / 4 + (p * DEG2RAD) / 2));
  }

  function mercatorChordDeg(latA, lngA, latB, lngB) {
    let dLng = lngB - lngA;
    while (dLng > 180) dLng -= 360;
    while (dLng < -180) dLng += 360;
    return Math.hypot(dLng, mercatorY(latB) - mercatorY(latA));
  }

  // Adaptive ring densification on Web-Mercator. Walks adjacent seed pairs and
  // recursively bisects in AZIMUTH wherever the on-map chord exceeds maxMercDeg,
  // re-solving each midpoint through projectAzimuth so inserted vertices land
  // exactly on the true ring (no chord interpolation — same discipline as the
  // cached densifyRiseSet). Pairs with a null endpoint are limb breaks → skipped
  // (the renderer's addPolyline/splitAtAntimeridian still cuts the segment).
  // Mirrors cached densifyRiseSet 1:1 with time→azimuth, distance→Mercator chord.
  function densifyRingMercator(b, insideTest, seedThetas, seedPts, opts) {
    opts = opts || {};
    const maxMercDeg = opts.maxMercDeg;
    const minMercDeg = opts.minMercDeg != null ? opts.minMercDeg : 0.003;
    const depthMax = opts.depthMax != null ? opts.depthMax : 8;
    if (!seedPts || seedPts.length === 0) return [];
    const out = [seedPts[0]];
    for (let i = 1; i < seedPts.length; i++) {
      const tA = seedThetas[i - 1],
        tB = seedThetas[i];
      const pA = seedPts[i - 1],
        pB = seedPts[i];
      if (pA && pB) {
        (function recurse(taA, paA, taB, paB, depth) {
          if (depth >= depthMax) return;
          if (Math.abs(taB - taA) < 1e-5) return; // azimuth floor
          if (mercatorChordDeg(paA[0], paA[1], paB[0], paB[1]) <= maxMercDeg) return;
          const tM = 0.5 * (taA + taB);
          const pm = projectAzimuth(b, insideTest, tM);
          if (!pm) return; // midpoint off-limb: keep parent segment
          // cusp guard: both sub-chords already sub-pixel → stop (avoids polar singularity overspend)
          if (
            mercatorChordDeg(paA[0], paA[1], pm[0], pm[1]) < minMercDeg &&
            mercatorChordDeg(pm[0], pm[1], paB[0], paB[1]) < minMercDeg
          )
            return;
          recurse(taA, paA, tM, pm, depth + 1);
          out.push(pm);
          recurse(tM, pm, taB, paB, depth + 1);
        })(tA, pA, tB, pB, 0);
      }
      out.push(pB);
    }
    return out;
  }

  // Pre-baked inside-tests for the rings the renderer draws.
  const insideUmbra = (m, L1p, L2p) => m < Math.abs(L2p); // umbra/antumbra
  const insidePenumbra = (m, L1p, L2p, mag) => mag > 0; // partial-visibility edge
  const insideMag = (target) => (m, L1p, L2p, mag) => mag > target;

  // ---- Instantaneous Magnitude Field + Marching Squares ----
  // The radial ring projector (projectRing) returns only the single outermost
  // intersection per azimuth, so for partial eclipses (axis off Earth, γ>1) it
  // captures the iso-magnitude arc but DROPS the rise/set terminator segment of
  // the visibility lens. Instead, build the instantaneous eclipse-magnitude
  // field on the FUNDAMENTAL PLANE (ξ,η) — naturally bounded by Earth's disc
  // ξ²+η²≤1 — and run marching squares. This is the SAME method as the cached
  // magContours (tools/lib/bessel.mjs: computeMagnitudeGrid + marchingSquares),
  // so each iso level comes out as a single connected contour that already
  // includes its terminator segment. Magnitude is purely geometric at a fixed
  // instant → only the static Besselian elements are needed (no derivatives).

  // Build the (ξ,η) magnitude field. mag[i*nX + j] is the eclipse magnitude at
  // (ξ = x0 + j·step, η = y0 + i·step). On the disc the sunlit root is ζ=√(1−ρ²);
  // OFF the disc ζ is CLAMPED to 0, so the field is C0-continuous across the limb.
  // This deliberately avoids a +Infinity off-disc sentinel (which would make
  // marchingSquares skip limb cells and leave a half-cell gap); with a continuous
  // field the contour crosses ρ=1 inside a real cell and clipChainToDisc cuts it
  // at the exact root.
  function computeMagFieldFundamental(b, opts) {
    opts = opts || {};
    const step = opts.step || 0.004;
    const R = opts.margin != null ? opts.margin : 1.04;
    const x0 = -R,
      y0 = -R;
    const nX = Math.ceil((2 * R) / step) + 1;
    const nY = nX;
    const mag = new Float32Array(nX * nY);

    const bx = b.x,
      by = b.y,
      l1 = b.l1,
      l2 = b.l2,
      tf1 = b.tan_f1,
      tf2 = b.tan_f2;
    for (let i = 0; i < nY; i++) {
      const eta = y0 + i * step;
      const eta2 = eta * eta;
      const row = i * nX;
      for (let j = 0; j < nX; j++) {
        const xi = x0 + j * step;
        const rho2 = xi * xi + eta2;
        const zeta = rho2 < 1 ? Math.sqrt(1 - rho2) : 0; // clamp ζ=0 off-disc → continuous
        const du = bx - xi,
          dv = by - eta;
        const m = Math.sqrt(du * du + dv * dv);
        const L1p = l1 - zeta * tf1;
        const L2p = l2 - zeta * tf2;
        mag[row + j] = (L1p - m) / (L1p + L2p);
      }
    }
    return { x0, y0, step, nX, nY, mag };
  }

  // Clip a marching-squares chain ([ξ,η] vertices) to Earth's disc ρ²≤1, returning
  // the visible sub-chains. Each segment crossing ρ=1 is cut at the EXACT root of
  // |p + t·(q−p)|² = 1, so the crossing coincides with the analytic terminatorArcs
  // endpoint — no seam, no snap. Spans wholly off-disc are dropped; a chain fully
  // inside passes through unchanged.
  function clipChainToDisc(chain) {
    const subs = [];
    let cur = [];
    const inside = (p) => p[0] * p[0] + p[1] * p[1] <= 1;
    // Roots of |p + t(q−p)|² = 1 in (0,1), ascending.
    const rootsOnSeg = (p, q) => {
      const dx = q[0] - p[0],
        dy = q[1] - p[1];
      const a = dx * dx + dy * dy;
      if (a < 1e-18) return [];
      const bb = 2 * (p[0] * dx + p[1] * dy);
      const c = p[0] * p[0] + p[1] * p[1] - 1;
      const disc = bb * bb - 4 * a * c;
      if (disc < 0) return [];
      const sd = Math.sqrt(disc);
      const ts = [(-bb - sd) / (2 * a), (-bb + sd) / (2 * a)].filter((t) => t > 1e-9 && t < 1 - 1e-9);
      return ts;
    };
    const at = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    if (chain.length) {
      let pIn = inside(chain[0]);
      if (pIn) cur.push(chain[0]);
      for (let i = 1; i < chain.length; i++) {
        const p = chain[i - 1],
          q = chain[i];
        const qIn = inside(q);
        if (pIn && qIn) {
          cur.push(q); // stays inside
        } else if (pIn && !qIn) {
          // Exiting: cut at ρ=1, close sub
          const ts = rootsOnSeg(p, q);
          cur.push(at(p, q, ts.length ? ts[0] : 1));
          if (cur.length >= 2) subs.push(cur);
          cur = [];
        } else if (!pIn && qIn) {
          // Entering: start sub at ρ=1 cut
          const ts = rootsOnSeg(p, q);
          cur = [at(p, q, ts.length ? ts[ts.length - 1] : 0), q];
        } else {
          // Both outside: may chord through disc
          const ts = rootsOnSeg(p, q);
          if (ts.length === 2) subs.push([at(p, q, ts[0]), at(p, q, ts[1])]);
        }
        pIn = qIn;
      }
      if (cur.length >= 2) subs.push(cur);
    }
    return subs;
  }

  // Eclipse magnitude on the rise/set terminator (Earth's limb, ζ=0) at azimuth
  // θ on the unit circle: (L1−m)/(L1+L2), m = distance from the shadow axis.
  function limbMagnitude(theta, b) {
    const m = Math.hypot(b.x - Math.cos(theta), b.y - Math.sin(theta));
    return (b.l1 - m) / (b.l1 + b.l2);
  }

  // Boundary angles on the limb circle (ρ=1) where limbMagnitude(θ) == k — i.e.
  // the analytic cusps where a partial-visibility lens of level k meets the rise/
  // set horizon. Coarse scan + 30-iter bisection. Returns {theta,xi,eta} (sorted,
  // ascending in [0,2π)). Used as terminatorArcs' DEFAULT boundaries when the
  // caller has no interior clip angles to supply (e.g. a fully-interior level).
  function limbCrossings(b, k) {
    const TWO_PI = 2 * Math.PI;
    const N = 1440;
    const v = new Array(N + 1);
    for (let i = 0; i <= N; i++) v[i] = limbMagnitude((i / N) * TWO_PI, b) - k;
    const cross = [];
    for (let i = 0; i < N; i++) {
      if (v[i] < 0 !== v[i + 1] < 0) {
        let a = (i / N) * TWO_PI,
          c = ((i + 1) / N) * TWO_PI,
          fa = v[i];
        for (let it = 0; it < 30; it++) {
          const mid = 0.5 * (a + c),
            fm = limbMagnitude(mid, b) - k;
          if (fm < 0 === fa < 0) {
            a = mid;
            fa = fm;
          } else c = mid;
        }
        const theta = 0.5 * (a + c);
        cross.push({ theta, xi: Math.cos(theta), eta: Math.sin(theta) });
      }
    }
    // v[0] flag lets terminatorArcs know whether the gap-free limb is wholly
    // above or below k when there are no crossings.
    cross.wholeAboveK = v[0] >= 0;
    return cross;
  }

  // Analytic rise/set terminator arcs for magnitude level k: the portions of the
  // limb circle (ρ=1) where limbMagnitude(θ) ≥ k that close each partial-
  // visibility lens at the horizon. Returns [lat,lng] polylines, Web-Mercator-
  // densified in θ (re-projecting every vertex, never interpolating) so the arc
  // has no facets and no inverse-projection limb singularity.
  //   `boundaryThetas` (optional): explicit limb angles to span between, instead
  // of the analytic limbCrossings. renderSolarShadow passes the angles where the
  // interior arc crossed ρ=1, so the terminator grows fresh from (and coincides
  // exactly with) the interior clip point — zero seam, no snap.
  function terminatorArcs(b, k, maxMercDeg, boundaryThetas) {
    const TWO_PI = 2 * Math.PI;
    const proj = (th) => {
      const g = fundamentalToGeoSphere(Math.cos(th), Math.sin(th), b);
      return [g.lat, g.lng];
    };

    // Mercator-adaptive θ densification between two angles (both endpoints valid).
    function densifyTheta(thA, thB) {
      const pA = proj(thA);
      const out = [pA];
      (function rec(ta, pa, tb, pb, depth) {
        if (depth > 16 || tb - ta < 1e-5) return;
        if (mercatorChordDeg(pa[0], pa[1], pb[0], pb[1]) <= maxMercDeg) return;
        const tm = 0.5 * (ta + tb);
        const pm = proj(tm);
        rec(ta, pa, tm, pm, depth + 1);
        out.push(pm);
        rec(tm, pm, tb, pb, depth + 1);
      })(thA, pA, thB, proj(thB), 0);
      out.push(proj(thB));
      return out;
    }

    // Boundary angles: caller-supplied interior clip angles when available (so the
    // terminator meets the interior arc with zero seam), else the analytic cusps.
    let thetas;
    if (boundaryThetas && boundaryThetas.length >= 2) {
      thetas = boundaryThetas.map((t) => ((t % TWO_PI) + TWO_PI) % TWO_PI).sort((a, c) => a - c);
    } else {
      const cross = limbCrossings(b, k);
      if (cross.length === 0) {
        return cross.wholeAboveK ? [densifyTheta(0, TWO_PI)] : []; // whole limb above k / none
      }
      thetas = cross.map((c) => c.theta);
    }
    const arcs = [];
    for (let i = 0; i < thetas.length; i++) {
      const a = thetas[i];
      const c = thetas[(i + 1) % thetas.length] + (i + 1 >= thetas.length ? TWO_PI : 0);
      if (c - a < 1e-9) continue;
      if (limbMagnitude(0.5 * (a + c), b) >= k) arcs.push(densifyTheta(a, c));
    }
    return arcs;
  }

  // Live umbra/antumbra outline as a fillable [lat,lng] ring. The shadow boundary is
  // exactly m = |L2'| in the fundamental plane — a circle of radius |L2'| about the axis
  // (b.x, b.y), |L2'| = |b.l2 − ζ·tan_f2| barely varying across the ~30 km shadow. We
  // parametrise that circle by ANGLE because it is defined for every azimuth, unlike the
  // radial boundary search projectAzimuth whose r∈[0,2] bisection assumes the shadow is
  // the interval [0, r_edge] — true only while the axis sits on the disc. At a sunset-
  // terminus eclipse the axis grazes just off-disc, so "inside" becomes a thin middle
  // band [r_enter, r_edge] that the power-of-two bisection hits-or-misses per azimuth, and
  // the ring shreds into a sawtooth. Here we instead build the analytic (ξ,η) circle, clip
  // it to Earth's disc (clipChainToDisc, exact ρ=1 roots) and close any grazing lens along
  // the terminator — the same disc-clip + limb-close discipline the iso-magnitude lenses
  // use. Returns a closed ring, or null when the shadow misses Earth entirely.
  function umbraLensGeo(b, nAz, maxMercDeg) {
    nAz = nAz || 256;
    const TWO_PI = 2 * Math.PI;
    const rUmbra = Math.abs(b.l2); // shadow radius at the limb (ζ=0), and fixed-point seed

    // Analytic boundary circle in (ξ,η): the shadow edge is m = |L2'(ζ)|, solved by 4
    // fixed-point passes (|L2'| moves <1% across the shadow, so it converges immediately).
    const xy = new Array(nAz);
    let anyOn = false,
      anyOff = false,
      maxRho2 = 0;
    for (let i = 0; i < nAz; i++) {
      const th = (TWO_PI * i) / nAz;
      const ct = Math.cos(th),
        st = Math.sin(th);
      let r = rUmbra,
        xi = 0,
        eta = 0,
        rho2 = 0;
      for (let k = 0; k < 4; k++) {
        xi = b.x + r * ct;
        eta = b.y + r * st;
        rho2 = xi * xi + eta * eta;
        const zeta = rho2 < 1 ? Math.sqrt(1 - rho2) : 0;
        r = Math.abs(b.l2 - zeta * b.tan_f2);
      }
      xy[i] = [xi, eta];
      if (rho2 <= 1) anyOn = true;
      else anyOff = true;
      if (rho2 > maxRho2) maxRho2 = rho2;
    }
    if (!anyOn) return null; // shadow wholly off Earth (partial phase / no landfall)

    // ONE inverse per lens, never mixed within a contour. Near the terminator the ellipsoid
    // and spherical inverses sit the same ~perpendicular distance from the true curve but up
    // to a few degrees apart ALONG it, so alternating them per vertex makes the boundary
    // double back into 180° spikes. A deep on-disc umbra (well inside ρ=0.997, where the
    // ellipsoid is both defined and tangent to the cached limits to ~metres) takes the
    // ellipsoid; anything grazing the limb takes the spherical inverse throughout — smooth
    // and defined everywhere on ρ=1, exactly as the iso-magnitude lenses do.
    const useEllipsoid = !anyOff && maxRho2 <= 0.997 * 0.997;
    const proj = useEllipsoid
      ? (p) => {
          const g = fundamentalToGeo(p[0], p[1], b);
          return [g.lat, g.lng];
        }
      : (p) => {
          const g = fundamentalToGeoSphere(p[0], p[1], b);
          return [g.lat, g.lng];
        };

    // Mercator-adaptive densifier over an open (ξ,η) chain: bisect each segment IN (ξ,η)
    // and re-project (never interpolate geo) until the on-map chord ≤ maxMercDeg. The
    // boundary is locally straight in (ξ,η), so midpoints stay on the true curve.
    const densifyXY = (chain) => {
      const pj = chain.map((p) => ({ x: p, g: proj(p) }));
      const out = [pj[0].g];
      for (let i = 1; i < pj.length; i++) {
        const A = pj[i - 1],
          B = pj[i];
        (function rec(ax, ag, bx, bg, depth) {
          if (depth > 16) return;
          if (Math.abs(ag[1] - bg[1]) > 180) return; // antimeridian: addPolyline splits it
          if (mercatorChordDeg(ag[0], ag[1], bg[0], bg[1]) <= maxMercDeg) return;
          const mx = [(ax[0] + bx[0]) / 2, (ax[1] + bx[1]) / 2];
          const mg = proj(mx);
          rec(ax, ag, mx, mg, depth + 1);
          out.push(mg);
          rec(mx, mg, bx, bg, depth + 1);
        })(A.x, A.g, B.x, B.g, 0);
        out.push(B.g);
      }
      return out;
    };

    // Axis well on the disc → the circle is a closed loop on the ground; fill it directly.
    if (!anyOff) {
      const closed = xy.slice();
      closed.push(xy[0]);
      return densifyXY(closed);
    }

    // Grazing: rotate so the chain starts off-disc, then clip to the disc. A circle meets
    // the limb in ≤2 points, so the on-disc part is a single arc with both ends on ρ=1.
    let off0 = 0;
    for (let i = 0; i < nAz; i++) {
      if (xy[i][0] * xy[i][0] + xy[i][1] * xy[i][1] > 1) {
        off0 = i;
        break;
      }
    }
    const rot = new Array(nAz + 1);
    for (let i = 0; i <= nAz; i++) rot[i] = xy[(off0 + i) % nAz];
    const subs = clipChainToDisc(rot).filter((s) => s.length >= 2);
    if (!subs.length) return null;
    const arc = subs[0]; // (ξ,η) vertices, both ends exactly on ρ=1

    // The two clip ends' limb angles bound the terminator that closes the lens. Walk ρ=1
    // from the arc's end back to its start along the side INSIDE the shadow (limb point
    // within rUmbra of the axis), so the closing curve is the true terminator, not a chord.
    const thA = Math.atan2(arc[arc.length - 1][1], arc[arc.length - 1][0]);
    const thStart = Math.atan2(arc[0][1], arc[0][0]);
    const dccw = (((thStart - thA) % TWO_PI) + TWO_PI) % TWO_PI;
    const mid = thA + dccw / 2;
    const ccwInside = Math.hypot(b.x - Math.cos(mid), b.y - Math.sin(mid)) < rUmbra;
    const thB = ccwInside ? thA + dccw : thA + dccw - TWO_PI;

    // Densify the limb arc in angle with the same (spherical, in this grazing branch)
    // inverse the shadow arc uses, so the lens closes with zero seam at the junction.
    const projTh = (th) => proj([Math.cos(th), Math.sin(th)]);
    const limb = [projTh(thA)];
    (function rec(ta, pa, tb, pb, depth) {
      if (depth > 16 || Math.abs(tb - ta) < 1e-6) return;
      if (Math.abs(pa[1] - pb[1]) > 180) return;
      if (mercatorChordDeg(pa[0], pa[1], pb[0], pb[1]) <= maxMercDeg) return;
      const tm = 0.5 * (ta + tb),
        pm = projTh(tm);
      rec(ta, pa, tm, pm, depth + 1);
      limb.push(pm);
      rec(tm, pm, tb, pb, depth + 1);
    })(thA, projTh(thA), thB, projTh(thB), 0);
    limb.push(projTh(thB));

    // Assemble: shadow arc (start→end) then the limb back (end→start). The arc's end and
    // limb[0] are the same ρ=1 point, as are the limb's end and the arc's start, so drop
    // the duplicate junction and let the polygon auto-close.
    return densifyXY(arc).concat(limb.slice(1));
  }

  // Marching squares on a generic uniform grid {x0,y0,step,nX,nY}. Returns an
  // array of [x1,y1,x2,y2] cell-edge segments at the iso `target`. Ported from
  // tools/lib/bessel.mjs:marchingSquares (lat/lng → generic x/y). Cells with any
  // non-finite corner are skipped (NaN guard; the −1 sentinel is finite so limb
  // cells survive). Saddle (4-edge) cells emit two segments, naive B↔T / L↔R.
  function marchingSquares(grid, field, target) {
    const { x0, y0, step, nX, nY } = grid;
    const segs = [];
    for (let i = 0; i < nY - 1; i++) {
      const y = y0 + i * step,
        yN = y + step;
      for (let j = 0; j < nX - 1; j++) {
        const v00 = field[i * nX + j];
        const v01 = field[i * nX + j + 1];
        const v10 = field[(i + 1) * nX + j];
        const v11 = field[(i + 1) * nX + j + 1];
        if (!isFinite(v00) || !isFinite(v01) || !isFinite(v10) || !isFinite(v11)) continue;
        const s00 = v00 >= target ? 1 : 0;
        const s01 = v01 >= target ? 1 : 0;
        const s10 = v10 >= target ? 1 : 0;
        const s11 = v11 >= target ? 1 : 0;
        const code = s00 | (s01 << 1) | (s10 << 2) | (s11 << 3);
        if (code === 0 || code === 15) continue;
        const x = x0 + j * step,
          xE = x + step;
        const eB = s00 !== s01 ? { x: x + ((target - v00) / (v01 - v00)) * step, y } : null;
        const eT = s10 !== s11 ? { x: x + ((target - v10) / (v11 - v10)) * step, y: yN } : null;
        const eL = s00 !== s10 ? { x, y: y + ((target - v00) / (v10 - v00)) * step } : null;
        const eR = s01 !== s11 ? { x: xE, y: y + ((target - v01) / (v11 - v01)) * step } : null;
        const crs = [eB, eT, eL, eR].filter(Boolean);
        if (crs.length === 2) {
          segs.push([crs[0].x, crs[0].y, crs[1].x, crs[1].y]);
        } else if (crs.length === 4) {
          segs.push([eB.x, eB.y, eT.x, eT.y]);
          segs.push([eL.x, eL.y, eR.x, eR.y]);
        }
      }
    }
    return segs;
  }

  // Stitch marching-squares segments into continuous polylines by matching
  // endpoints. Returns an array of chains, each a list of [x,y] vertices. Ported
  // verbatim from tools/lib/bessel.mjs:chainSegments (lat/lng → generic x/y).
  function chainSegments(segs) {
    const key = (x, y) => x.toFixed(5) + '|' + y.toFixed(5);
    const ends = new Map();
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k).push(i);
      }
    }
    const used = new Array(segs.length).fill(false);
    const chains = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const s0 = segs[i];
      const chain = [
        [s0[0], s0[1]],
        [s0[2], s0[3]],
      ];
      function tryExtend(headIdx) {
        const head = chain[headIdx === 0 ? 0 : chain.length - 1];
        const k = key(head[0], head[1]);
        const nbrs = ends.get(k) || [];
        for (const j of nbrs) {
          if (used[j]) continue;
          const s = segs[j];
          const k1 = key(s[0], s[1]);
          const other = k === k1 ? [s[2], s[3]] : [s[0], s[1]];
          used[j] = true;
          if (headIdx === 0) chain.unshift(other);
          else chain.push(other);
          return true;
        }
        return false;
      }
      while (tryExtend(1)) {} // extend tail
      while (tryExtend(0)) {} // extend head
      chains.push(chain);
    }
    return chains;
  }

  // ---- Runtime Quality Control ----
  // Port of the offline curve-audit metrics (tools/check-limit-nesting.mjs:99 et
  // al.) so the rendered shadow can be checked numerically — not just by eye in a
  // screenshot. A sawtooth shows up as a high maxTurnDeg; a break shows up as a
  // large maxGapKm.
  function _havKm(a, b) {
    const R = 6371;
    const dLat = (b[0] - a[0]) * DEG2RAD;
    let dLng = b[1] - a[1];
    while (dLng > 180) dLng -= 360;
    while (dLng < -180) dLng += 360;
    dLng *= DEG2RAD;
    const la = a[0] * DEG2RAD,
      lb = b[0] * DEG2RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function _bearingDeg(a, b) {
    const dLng = (b[1] - a[1]) * DEG2RAD,
      la = a[0] * DEG2RAD,
      lb = b[0] * DEG2RAD;
    const y = Math.sin(dLng) * Math.cos(lb);
    const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLng);
    return Math.atan2(y, x) * RAD2DEG;
  }

  // Max turn angle (deg) over a [lat,lng] polyline. Mirrors maxTurn in
  // check-limit-nesting.mjs: skip the poles (|lat|>88), skip antimeridian jumps
  // (|Δlng|>180), and ignore turns whose adjacent legs are shorter than
  // MIN_SEG_KM (3 km) so sub-resolution wobble isn't counted as a kink.
  function maxTurnDeg(poly, minSegKm) {
    const MIN_SEG_KM = minSegKm != null ? minSegKm : 3;
    let m = 0;
    for (let i = 2; i < poly.length; i++) {
      const p0 = poly[i - 2],
        p1 = poly[i - 1],
        p2 = poly[i];
      if (!p0 || !p1 || !p2) continue;
      if (Math.abs(p1[0]) > 88) continue;
      if (Math.abs(p1[1] - p0[1]) > 180 || Math.abs(p2[1] - p1[1]) > 180) continue;
      if (_havKm(p0, p1) < MIN_SEG_KM || _havKm(p1, p2) < MIN_SEG_KM) continue;
      const t = Math.abs(((((_bearingDeg(p0, p1) - _bearingDeg(p1, p2)) % 360) + 540) % 360) - 180);
      if (t > m) m = t;
    }
    return m;
  }

  // Max gap (km) between consecutive non-null vertices, skipping antimeridian
  // jumps (those are wrap artifacts handled by splitAtAntimeridian, not breaks).
  function maxGapKm(poly) {
    let m = 0;
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1],
        b = poly[i];
      if (!a || !b) continue;
      if (Math.abs(b[1] - a[1]) > 180) continue;
      const d = _havKm(a, b);
      if (d > m) m = d;
    }
    return m;
  }

  return {
    DEG2RAD,
    RAD2DEG,
    polyval,
    evalBessel,
    evalBesselAtT,
    coreBesselAE,
    fundamentalToGeo,
    fundamentalToGeoSphere,
    geoToFundamental,
    localCircumstances,
    projectAzimuth,
    projectRing,
    densifyRingMercator,
    mercatorY,
    mercatorChordDeg,
    insideUmbra,
    insidePenumbra,
    insideMag,
    computeMagFieldFundamental,
    clipChainToDisc,
    limbMagnitude,
    limbCrossings,
    terminatorArcs,
    umbraLensGeo,
    marchingSquares,
    chainSegments,
    maxTurnDeg,
    maxGapKm,
  };
})();
