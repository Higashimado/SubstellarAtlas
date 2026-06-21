/**
 * asterism.js — Catalog and rendering of named star-pattern figures
 * (seasonal triangles, the Big Dipper, the crosses, etc.) on the map.
 */
const Asterism = (() => {
  // ---- Greek letter → HYG Bayer abbreviation ----
  const GREEK = {
    α: 'Alp',
    β: 'Bet',
    γ: 'Gam',
    δ: 'Del',
    ε: 'Eps',
    ζ: 'Zet',
    η: 'Eta',
    θ: 'The',
    ι: 'Iot',
    κ: 'Kap',
    λ: 'Lam',
    μ: 'Mu',
    ν: 'Nu',
    ξ: 'Xi',
    ο: 'Omi',
    π: 'Pi',
    ρ: 'Rho',
    σ: 'Sig',
    τ: 'Tau',
    υ: 'Ups',
    φ: 'Phi',
    χ: 'Chi',
    ψ: 'Psi',
    ω: 'Ome',
  };

  // ---- Asterism catalog (spec §2.1) ----
  const ASTERISMS = [
    {
      id: 'spring-triangle',
      season: 'spring',
      name: {
        'zh-Hans': '春季大三角',
        'zh-Hant': '春季大三角',
        en: 'Spring Triangle',
        fr: 'Triangle de printemps',
        es: 'Triángulo de primavera',
        ja: '春の大三角形',
      },
      stars: ['αBoo', 'αVir', 'βLeo'],
      segments: [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    },
    {
      id: 'virgo-diamond',
      season: 'spring',
      name: {
        'zh-Hans': '春季大钻石',
        'zh-Hant': '春季大鑽石',
        en: 'Diamond of Virgo',
        fr: 'Diamant de la Vierge',
        es: 'Diamante de Virgo',
        ja: 'おとめ座のダイヤモンド',
      },
      stars: ['αBoo', 'αVir', 'βLeo', 'αCVn'],
      segments: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
    },
    {
      id: 'summer-triangle',
      season: 'summer',
      name: {
        'zh-Hans': '夏季大三角',
        'zh-Hant': '夏季大三角',
        en: 'Summer Triangle',
        fr: "Triangle d'été",
        es: 'Triángulo de verano',
        ja: '夏の大三角形',
      },
      stars: ['αLyr', 'αAql', 'αCyg'],
      segments: [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    },
    {
      id: 'great-square',
      season: 'autumn',
      name: {
        'zh-Hans': '秋季四边形',
        'zh-Hant': '秋季四邊形',
        en: 'Great Square of Pegasus',
        fr: 'Grand Carré de Pégase',
        es: 'Gran Cuadrado de Pegaso',
        ja: 'ペガスス四辺形',
      },
      stars: ['αPeg', 'βPeg', 'γPeg', 'αAnd'],
      segments: [
        [0, 1],
        [1, 3],
        [3, 2],
        [2, 0],
      ],
    },
    {
      id: 'autumn-s-triangle',
      season: 'autumn',
      name: {
        'zh-Hans': '秋季南三角',
        'zh-Hant': '秋季南三角',
        en: 'Southern Autumn Triangle',
        fr: "Triangle austral d'automne",
        es: 'Triángulo austral de otoño',
        ja: '秋の南の三角形',
      },
      stars: ['αPsA', 'βCet', 'αPhe'],
      segments: [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    },
    {
      id: 'winter-triangle',
      season: 'winter',
      name: {
        'zh-Hans': '冬季大三角',
        'zh-Hant': '冬季大三角',
        en: 'Winter Triangle',
        fr: "Triangle d'hiver",
        es: 'Triángulo de invierno',
        ja: '冬の大三角形',
      },
      stars: ['αCMa', 'αCMi', 'αOri'],
      segments: [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    },
    {
      id: 'winter-hexagon',
      season: 'winter',
      name: {
        'zh-Hans': '冬季六边形',
        'zh-Hant': '冬季六邊形',
        en: 'Winter Hexagon',
        fr: "Hexagone d'hiver",
        es: 'Hexágono de invierno',
        ja: '冬のダイヤモンド',
      },
      stars: ['βOri', 'αTau', 'αAur', 'βGem', 'αCMi', 'αCMa'],
      segments: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 0],
      ],
    },
    {
      id: 'spring-arc',
      season: 'spring',
      open: true,
      name: {
        'zh-Hans': '春季大弧线',
        'zh-Hant': '春季大弧線',
        en: 'Spring Arc',
        fr: 'Arc de printemps',
        es: 'Arco de primavera',
        ja: '春の大曲線',
      },
      stars: ['εUMa', 'ζUMa', 'ηUMa', 'αBoo', 'αVir'],
      segments: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
      ],
    },
    {
      id: 'false-cross',
      season: 'south',
      name: {
        'zh-Hans': '伪十字',
        'zh-Hant': '偽十字',
        en: 'False Cross',
        fr: 'Fausse Croix',
        es: 'Cruz Falsa',
        ja: 'にせ十字',
      },
      stars: ['εCar', 'κVel', 'δVel', 'ιCar'],
      segments: [
        [0, 1],
        [2, 3],
      ],
    },
    {
      id: 'southern-cross',
      season: 'south',
      name: {
        'zh-Hans': '南十字',
        'zh-Hant': '南十字',
        en: 'Southern Cross',
        fr: 'Croix du Sud',
        es: 'Cruz del Sur',
        ja: '南十字',
      },
      stars: ['αCru', 'γCru', 'βCru', 'δCru'],
      segments: [
        [0, 1],
        [2, 3],
      ],
    },
    {
      id: 'northern-cross',
      season: 'summer',
      name: {
        'zh-Hans': '北十字',
        'zh-Hant': '北十字',
        en: 'Northern Cross',
        fr: 'Croix du Nord',
        es: 'Cruz del Norte',
        ja: '北十字',
      },
      stars: ['αCyg', 'βCyg', 'γCyg', 'δCyg', 'εCyg'],
      segments: [
        [0, 1],
        [3, 4],
      ],
    },
    {
      id: 'big-dipper',
      season: 'spring',
      open: true,
      name: {
        'zh-Hans': '北斗七星',
        'zh-Hant': '北斗七星',
        en: 'Big Dipper',
        fr: 'Grande Casserole',
        es: 'Gran Carro',
        ja: '北斗七星',
      },
      stars: ['αUMa', 'βUMa', 'γUMa', 'δUMa', 'εUMa', 'ζUMa', 'ηUMa'],
      segments: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 6],
      ],
    },
  ];

  // ---- World-wrap constants (mirror map.js / sky.js) ----
  const MAP_LNG_WEST = -200;
  const MAP_LNG_EAST = 520;
  // Panel spans 720° (2 world copies). Sky labels use wrapOffsets() to pick
  // 4 dynamic offsets per feature; asterism uses fixed offsets to keep the
  // marker count stable at build time. 5 symmetric copies (−720..+720) cover
  // any centroid in (−180, 180] across the full panel.
  const COPY_OFFSETS = [-720, -360, 0, +360, +720];

  // ---- Visibility thresholds ----
  const PAD = 0.12;
  const MIN_SPAN_PX = 120;

  // ---- State ----
  let _map = null;
  let _layer = null;
  let _visible = false;
  let _gmst = 0;
  let _bayerIndex = null;

  // ---- Math helpers (duplicated from sky.js — pure, stable) ----
  function wrap180(x) {
    return ((x + 540) % 360) - 180;
  }

  function subStellar(raDeg, decDeg, gmst) {
    return [decDeg, wrap180(raDeg - gmst)];
  }

  function unwrapLons(points) {
    if (points.length < 2) return points.map((p) => p.slice());
    const out = [points[0].slice()];
    let prev = out[0][1];
    for (let i = 1; i < points.length; i++) {
      let lon = points[i][1];
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
      out.push([points[i][0], lon]);
      prev = lon;
    }
    return out;
  }

  function wrapOffsets(minLon, maxLon) {
    // v3 perf: clamp to viewport ∩ MAP_LNG_WEST/EAST. See js/sky.js wrapOffsets.
    let west = MAP_LNG_WEST,
      east = MAP_LNG_EAST;
    if (_map) {
      const b = _map.getBounds();
      const vw = b.getWest(),
        ve = b.getEast();
      if (vw > west) west = vw;
      if (ve < east) east = ve;
    }
    const kMin = Math.floor((west - maxLon) / 360);
    const kMax = Math.ceil((east - minLon) / 360);
    const ks = [];
    for (let k = kMin; k <= kMax; k++) ks.push(k * 360);
    return ks.length ? ks : [0];
  }

  function shiftLatLngs(points, dLon) {
    if (dLon === 0) return points;
    return points.map((p) => [p[0], p[1] + dLon]);
  }

  // ---- Bayer resolution ----
  function parseBayer(notation) {
    const m = notation.match(/^([α-ω])(.+)$/);
    if (!m) return null;
    const abbr = GREEK[m[1]];
    if (!abbr) return null;
    return abbr + ' ' + m[2];
  }

  function buildBayerIndex(stars) {
    const idx = new Map();
    for (const s of stars) {
      if (!s.bf) continue;
      const bf = s.bf.trim();
      const m = bf.match(/^\d*\s*([A-Z][a-z]{1,3})\d?\s*(\w{2,3})\s*$/);
      if (!m) continue;
      const key = m[1] + ' ' + m[2];
      const existing = idx.get(key);
      if (!existing || s.mag < existing.mag) idx.set(key, s);
    }
    return idx;
  }

  function resolveAsterism(a) {
    a._resolved = a.stars.map((bayer) => {
      const key = parseBayer(bayer);
      if (!key) {
        console.warn('[asterism] bad Bayer:', bayer);
        return null;
      }
      const star = _bayerIndex.get(key);
      if (!star) {
        console.warn('[asterism] star not found:', bayer, '→', key);
        return null;
      }
      return { ra: star.ra, dec: star.dec, mag: star.mag };
    });
    return a._resolved.every((s) => s !== null);
  }

  // ---- Centroid with special cases ----
  function centroid(a, positions) {
    if (a.open) {
      const midIdx = Math.floor(a.segments.length / 2);
      const [i, j] = a.segments[midIdx];
      return [(positions[i][0] + positions[j][0]) / 2, (positions[i][1] + positions[j][1]) / 2];
    }
    if (a.id === 'false-cross') {
      const n = positions.length;
      const cx = positions.reduce((s, p) => s + p[0], 0) / n;
      const cy = positions.reduce((s, p) => s + p[1], 0) / n;

      const dx = positions[1][1] - positions[0][1];
      const dy = positions[1][0] - positions[0][0];
      const len = Math.hypot(dx, dy) || 1;
      return [cx + (dy / len) * 0.3, cy - (dx / len) * 0.3];
    }
    const n = positions.length;
    return [positions.reduce((s, p) => s + p[0], 0) / n, positions.reduce((s, p) => s + p[1], 0) / n];
  }

  // ---- Build Leaflet primitives ----
  function buildPrimitives() {
    _layer = L.layerGroup();

    for (const a of ASTERISMS) {
      if (!a._resolved) continue;
      a._fit = false;
      a._revealed = false;

      // Per-segment visible + hit polylines
      a._lines = [];
      a._hits = [];
      for (let si = 0; si < a.segments.length; si++) {
        for (const dk of COPY_OFFSETS) {
          const line = L.polyline(
            [
              [0, 0],
              [0, 0],
            ],
            {
              pane: 'asterism',
              className: 'aster-line',
              interactive: false,
            }
          );
          line._copyOffset = dk;
          line._segIdx = si;
          a._lines.push(line);
          _layer.addLayer(line);

          const hit = L.polyline(
            [
              [0, 0],
              [0, 0],
            ],
            {
              pane: 'asterism',
              weight: HitWidths.ASTERISM,
              opacity: 0,
              interactive: true,
              color: 'transparent',
              fill: false,
            }
          );
          hit._copyOffset = dk;
          hit._segIdx = si;
          a._hits.push(hit);
          _layer.addLayer(hit);
        }
      }

      // Vertex rings + hit circles
      a._verts = [];
      a._hitVerts = [];
      for (let vi = 0; vi < a._resolved.length; vi++) {
        const mag = a._resolved[vi].mag;
        const r = Lum.coreRadius(Lum.lnB(mag)) + 4;
        for (const dk of COPY_OFFSETS) {
          const vert = L.circleMarker([0, 0], {
            pane: 'asterism',
            className: 'aster-vertex',
            radius: r,
            interactive: false,
          });
          vert._copyOffset = dk;
          vert._starIdx = vi;
          a._verts.push(vert);
          _layer.addLayer(vert);

          const hitV = L.circleMarker([0, 0], {
            pane: 'asterism',
            radius: 18,
            opacity: 0,
            fillOpacity: 0,
            interactive: true,
            fill: true,
            stroke: false,
          });
          hitV._copyOffset = dk;
          hitV._starIdx = vi;
          a._hitVerts.push(hitV);
          _layer.addLayer(hitV);
        }
      }

      // Label
      a._labels = [];
      for (const dk of COPY_OFFSETS) {
        const label = L.marker([0, 0], {
          pane: 'asterism-top',
          interactive: false,
          icon: L.divIcon({
            className: '',
            iconSize: [0, 0],
            html: '<div class="aster-label">' + labelText(a) + '</div>',
          }),
        });
        label._copyOffset = dk;
        a._labels.push(label);
        _layer.addLayer(label);
      }

      // v4-2: mark as initially attached (buildPrimitives added all primitives).
      // refreshFit() will detach those that don't fit on next pan/zoom.
      a._attached = true;

      // Hover events — gated by a._fit flag, per-asterism timer
      a._revealTimer = null;
      const allHits = a._hits.concat(a._hitVerts);
      for (const h of allHits) {
        h.on('mouseover', () => {
          if (!a._fit) return;
          if (a._revealTimer) {
            clearTimeout(a._revealTimer);
            a._revealTimer = null;
          }
          setReveal(a, true);
        });
        h.on('mouseout', () => {
          if (a._revealTimer) {
            clearTimeout(a._revealTimer);
            a._revealTimer = null;
          }
          a._revealTimer = setTimeout(() => setReveal(a, false), 50);
        });
      }
    }
  }

  function labelText(a) {
    const locale = typeof I18n !== 'undefined' ? I18n.getLocale() : 'zh-Hans';
    return a.name[locale] || a.name.en;
  }

  // ---- Position update ----
  function updatePositions() {
    for (const a of ASTERISMS) {
      if (!a._resolved) continue;

      const positions = a._resolved.map((s) => subStellar(s.ra, s.dec, _gmst));
      const unwrapped = unwrapLons(positions);
      a._currentPositions = unwrapped;

      // Update segment polylines
      for (const line of a._lines) {
        const [i, j] = a.segments[line._segIdx];
        const seg = [unwrapped[i], unwrapped[j]];
        line.setLatLngs(shiftLatLngs(seg, line._copyOffset));
      }
      for (const hit of a._hits) {
        const [i, j] = a.segments[hit._segIdx];
        const seg = [unwrapped[i], unwrapped[j]];
        hit.setLatLngs(shiftLatLngs(seg, hit._copyOffset));
      }

      // Update vertex positions
      for (const v of a._verts) {
        const p = unwrapped[v._starIdx];
        v.setLatLng([p[0], p[1] + v._copyOffset]);
      }
      for (const hv of a._hitVerts) {
        const p = unwrapped[hv._starIdx];
        hv.setLatLng([p[0], p[1] + hv._copyOffset]);
      }

      // Update label position (centroid)
      const c = centroid(a, unwrapped);
      for (const label of a._labels) {
        label.setLatLng([c[0], c[1] + label._copyOffset]);
      }
    }
  }

  // ---- Visibility ----
  function fits(a) {
    if (!a._currentPositions) return false;
    if (_map.getZoom() <= 5) return true;
    for (const dk of COPY_OFFSETS) {
      const shifted = a._currentPositions.map((p) => [p[0], p[1] + dk]);
      const b = L.latLngBounds(shifted).pad(PAD);
      if (!_map.getBounds().contains(b)) continue;
      const ne = _map.latLngToContainerPoint(b.getNorthEast());
      const sw = _map.latLngToContainerPoint(b.getSouthWest());
      if (Math.hypot(ne.x - sw.x, ne.y - sw.y) >= MIN_SPAN_PX) return true;
    }
    return false;
  }

  // v4-2: detach asterism primitives from layer when they don't fit the
  // viewport. Each asterism has its own per-wrap polylines + verts + labels
  // all created upfront in buildPrimitives. Even though `fits()` already
  // returns false out-of-viewport, the DOM nodes still exist and Leaflet's
  // SVG renderer pays per-path transform cost on every pan. Detaching cuts
  // the live path count when only 1–2 asterisms are visible.
  function detachAsterism(a) {
    if (!a._attached) return;
    for (const l of a._lines) _layer.removeLayer(l);
    for (const h of a._hits) _layer.removeLayer(h);
    for (const v of a._verts) _layer.removeLayer(v);
    for (const hv of a._hitVerts) _layer.removeLayer(hv);
    for (const lb of a._labels) _layer.removeLayer(lb);
    a._attached = false;
  }

  function attachAsterism(a) {
    if (a._attached) return;
    for (const l of a._lines) _layer.addLayer(l);
    for (const h of a._hits) _layer.addLayer(h);
    for (const v of a._verts) _layer.addLayer(v);
    for (const hv of a._hitVerts) _layer.addLayer(hv);
    for (const lb of a._labels) _layer.addLayer(lb);
    a._attached = true;
  }

  function refreshFit() {
    for (const a of ASTERISMS) {
      if (!a._resolved) continue;
      a._fit = fits(a);
      if (!a._fit && a._revealed) setReveal(a, false);
      if (a._fit) attachAsterism(a);
      else detachAsterism(a);
    }
  }

  function setReveal(a, on) {
    a._revealed = on;
    for (const l of a._lines) l.getElement()?.classList.toggle('reveal', on);
    for (const v of a._verts) v.getElement()?.classList.toggle('reveal', on);
    for (const lb of a._labels) {
      const el = lb.getElement();
      if (el) {
        const div = el.querySelector('.aster-label');
        if (div) div.classList.toggle('reveal', on);
      }
    }
  }

  // ---- i18n ----
  function updateLabels() {
    for (const a of ASTERISMS) {
      if (!a._labels) continue;
      const text = labelText(a);
      const html = '<div class="aster-label">' + text + '</div>';
      for (const lb of a._labels) {
        // Sync the HTML stored on the icon so a Leaflet re-render can't revert to the old language.
        lb.options.icon.options.html = html;
        const el = lb.getElement();
        if (el) {
          const div = el.querySelector('.aster-label');
          if (div) div.textContent = text;
        }
      }
    }
  }

  // ---- Lifecycle ----
  async function init(map) {
    _map = map;

    if (!_map.getPane('asterism')) {
      _map.createPane('asterism');
      _map.getPane('asterism').style.zIndex = '508';
    }
    if (!_map.getPane('asterism-top')) {
      _map.createPane('asterism-top');
      _map.getPane('asterism-top').style.zIndex = '602';
      _map.getPane('asterism-top').style.pointerEvents = 'none';
    }

    const resp = await fetch('data/sky/stars.json');
    const stars = await resp.json();
    _bayerIndex = buildBayerIndex(stars);

    for (const a of ASTERISMS) {
      if (!resolveAsterism(a)) {
        console.warn('[asterism] failed to resolve:', a.id);
      }
    }

    buildPrimitives();

    _map.on('zoomend moveend', refreshFit);

    if (typeof I18n !== 'undefined') {
      I18n.subscribe(() => updateLabels());
    }
  }

  function update(date) {
    if (!_layer || !_visible) return;
    _gmst = Astronomy.SiderealTime(date) * 15;
    updatePositions();
    refreshFit();
  }

  function show() {
    if (!_map || !_layer) return;
    if (!_visible) {
      _map.addLayer(_layer);
      _visible = true;
      const date = typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date();
      update(date);
    }
  }

  function hide() {
    if (!_map || !_layer) return;
    if (_visible) {
      _map.removeLayer(_layer);
      _visible = false;
    }
  }

  return { init, update, show, hide };
})();
