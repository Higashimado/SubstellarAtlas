/** label-collider.js
 *
 * Cross-source label overlap hider.
 *
 * Project has ~10 producers of on-map labels (constellations, stars, planets,
 * ecliptic/equator/galactic/lunar-path ticks, altitude contours, terminator).
 * Each producer dedupes within its own source but never against the others,
 * so low-zoom views end up with planet names sitting on top of constellation
 * names, ecliptic ticks crossing star names, etc.
 *
 * This module runs ONE post-render sweep per map event (moveend / zoomend /
 * layer toggle / time tick), reads every label's screen-pixel rect, and
 * hides the lower-priority side of each collision via the `.label-occluded`
 * CSS class (visibility: hidden — keeps the DOM node + Leaflet cache alive,
 * just makes it invisible and non-interactive).
 *
 * Non-invasive: producers don't know we exist. They keep rebuilding/caching
 * their markers as before. Next sweep re-evaluates fresh DOM each time.
 *
 * Performance: typical N ≤ 300, worst ≤ 1500. One rAF tick per event burst,
 * batched reads then batched writes, 64-px spatial grid for O(N) overlap
 * lookup. Never touches tile/overlay panes themselves.
 */
(function () {
  'use strict';

  // ---- Priority Table (higher = wins) ----
  // Looked up by CSS class. First match in this ordered list wins.
  // Star labels get extra resolution from their dim modifier class.
  const CLASS_PRIORITY = [
    // [selector, priority]
    ['btraj-marker', 110], // motion-trajectory date/time markers — win every overlap (they sit above all bodies)
    ['body-symbol-label', 100],
    ['ecliptic-label', 55], // spring equinox / summer solstice / autumn equinox / winter solstice — semantic anchors
    ['sky-label-iau', 72], // constellation name (rank 1-2 default)
    ['sky-label-iau-dim', 50], // rank 3 IAU (overrides above)
    ['sky-label-cn', 72], // xingguan (rank 1-2 default)
    ['sky-label-cn-minor', 50], // rank 3 xingguan (overrides above)
    ['comet-label', 48], // comet names
    ['dso-label', 45], // deep-sky object names (M31, NGC…)
    ['meteor-label', 42], // meteor shower names
    ['sky-label-star-iau', 55],
    ['sky-label-star-cn', 55],
    ['sky-label-star-stars', 55],
    ['sky-label-star-iau-dim', 38],
    ['sky-label-star-cn-dim', 38],
    ['lunar-path-label', 30],
    ['galactic-equator-label', 30],
    ['equator-label', 30],
    ['ecliptic-tick-label', 25],
    ['contour-label', 20],
    ['terminator-label', 15],
  ];
  // Build a Set per priority for fast classList scan.
  function priorityFor(el) {
    const cl = el.classList;
    // Specific dim modifier classes need to be tested first (they override base).
    // Iterate in declaration order; later entries with lower priority lose to
    // earlier matches only if both present — so we keep the MIN match (because
    // dim modifiers are listed lower with smaller priority).
    let best = -1;
    let dimSeen = false;
    for (const [sel, prio] of CLASS_PRIORITY) {
      if (cl.contains(sel)) {
        if (sel.endsWith('-dim') || sel.endsWith('-minor')) {
          // Dim modifier overrides any base sky-label priority assigned
          return prio;
        }
        if (best < 0) best = prio;
      }
    }
    return best;
  }

  // Single CSS selector for one DOM query.
  const SELECTOR = CLASS_PRIORITY.map(([s]) => '.' + s).join(', ');

  // ---- Day-Veil Coverage ----
  // Night-only labels (deep-sky: stars, constellations, DSO, comet, meteor)
  // live in panes clipped to the night region by a 0°-altitude SVG clip-path,
  // which hard-cuts any label straddling the terminator. We instead hide the
  // WHOLE label when its screen box touches daylight, so it vanishes cleanly
  // rather than appearing sliced. Grid/contour/terminator labels and body
  // (planet) labels are intentionally excluded — they sit above the veil and
  // stay visible (or have their own daylight logic).
  const VEIL_HIDDEN_CLASS = 'label-veil-hidden';
  const NIGHT_ONLY = new Set([
    'sky-label-iau',
    'sky-label-iau-dim',
    'sky-label-cn',
    'sky-label-cn-minor',
    'comet-label',
    'dso-label',
    'meteor-label',
    'sky-label-star-iau',
    'sky-label-star-cn',
    'sky-label-star-stars',
    'sky-label-star-iau-dim',
    'sky-label-star-cn-dim',
  ]);
  function _isNightOnly(el) {
    const cl = el.classList;
    for (const c of NIGHT_ONLY) if (cl.contains(c)) return true;
    return false;
  }

  // ---- Sweep ----
  let _pending = false;
  let _map = null;

  const HIDDEN_CLASS = 'label-occluded';
  const CELL = 64; // px — spatial grid cell

  // ---- Fast Screen Rect (no per-sweep layout flush) ----
  // getBoundingClientRect forces a synchronous layout; over hundreds of labels at
  // high zoom that single flush is the sweep's dominant cost. Every priority class
  // is a Leaflet divIcon className, so the matched node IS the marker icon root —
  // it carries _leaflet_pos (its layer point) and an inline margin (the iconAnchor).
  // The on-screen rect is then pure math: layerPointToContainerPoint(pos) + margin
  // + intrinsic size. Intrinsic size/margin only change with zoom-tier or locale,
  // so they're cached across pans (keyed by a generation counter bumped on every
  // non-pan event) and a pan sweep reads the DOM zero times. Nodes without
  // _leaflet_pos fall back to getBoundingClientRect — correctness over speed.
  const _sizeCache = new WeakMap();
  let _sizeGen = 0;
  let _containerOx = 0;
  let _containerOy = 0;
  // Container offset is re-read lazily in the rAF sweep, not in the (synchronous)
  // invalidation handler — see _invalidateSizes / _runSweep.
  let _offsetDirty = true;

  function _refreshContainerOffset() {
    if (!_map) return;
    const cr = _map.getContainer().getBoundingClientRect();
    _containerOx = cr.left;
    _containerOy = cr.top;
  }

  // Bumped on every event that can resize labels or move the map element — i.e.
  // everything except a pure pan, which is exactly the case the size cache is meant
  // to make free. The container-offset read used to happen here too, but as a
  // synchronous getBoundingClientRect fired inside the layeradd/layerremove burst
  // (thousands of polyline adds per zoom) it forced a fresh layout every time — the
  // sweep's dominant cost. We now just flag it dirty; _runSweep reads it once in the
  // rAF tick, after all DOM writes settle. A pure pan never flags dirty, so its sweep
  // still reads the DOM zero times.
  function _invalidateSizes() {
    _sizeGen++;
    _offsetDirty = true;
  }

  function _measureSize(el) {
    const cached = _sizeCache.get(el);
    if (cached && cached.gen === _sizeGen) return cached;
    // offsetWidth/Height force layout (one flush per cold sweep); iconSize:null
    // divIcons auto-size to text, so they give the true box. style.margin* are
    // inline reads (Leaflet writes the anchor there) and don't touch layout.
    const sz = {
      w: el.offsetWidth,
      h: el.offsetHeight,
      mx: parseFloat(el.style.marginLeft) || 0,
      my: parseFloat(el.style.marginTop) || 0,
      gen: _sizeGen,
    };
    _sizeCache.set(el, sz);
    return sz;
  }

  function _auditRect(el, fast) {
    const t = el.getBoundingClientRect();
    const d = Math.max(
      Math.abs(t.left - fast.left),
      Math.abs(t.top - fast.top),
      Math.abs(t.right - fast.right),
      Math.abs(t.bottom - fast.bottom)
    );
    if (d > (window._labelColliderAuditMax || 0)) {
      window._labelColliderAuditMax = d;
      // eslint-disable-next-line no-console
      console.log('[LabelCollider audit] max rect delta', d.toFixed(2), 'px on', el.className);
    }
  }

  // Screen-pixel rect of a label. Returns a plain {left,top,right,bottom,width,
  // height}; a zero-width result is treated as "skip" by the caller (matching the
  // old getBoundingClientRect 0×0 behaviour for hidden / empty nodes).
  function _screenRect(el) {
    const pos = el._leaflet_pos;
    if (!pos) return el.getBoundingClientRect();
    // Trajectory date markers rotate their label (CSS transform) and pin it with
    // absolute positioning, so the divIcon root collapses to a 0×0 anchor: offsetWidth
    // reads zero and the fast path would drop the marker from collision entirely. And a
    // transform is invisible to offsetWidth anyway (a pre-transform layout value), so
    // the rotated box has no correct math form here. Measure the rendered label child
    // directly — getBoundingClientRect is transform-aware and returns the same viewport
    // coordinates the fast path yields, so it slots in unchanged downstream.
    if (el.classList.contains('btraj-marker')) {
      const lbl = el.querySelector('.btraj-time');
      return lbl ? lbl.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
    const sz = _measureSize(el);
    const cp = _map.layerPointToContainerPoint(pos);
    const left = _containerOx + cp.x + sz.mx;
    const top = _containerOy + cp.y + sz.my;
    const r = { left, top, right: left + sz.w, bottom: top + sz.h, width: sz.w, height: sz.h };
    if (window._labelColliderAudit) _auditRect(el, r);
    return r;
  }

  function _runSweep() {
    _pending = false;
    if (!_map) return;
    // Refresh the container's screen offset here — once per sweep, in the rAF tick
    // after the event burst's DOM writes have settled — so the single
    // getBoundingClientRect forces at most one layout instead of one per layeradd.
    // Only when something flagged it dirty (zoom/resize/layer toggle), never on pan.
    if (_offsetDirty) {
      _refreshContainerOffset();
      _offsetDirty = false;
    }
    const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;

    const nodes = document.querySelectorAll(SELECTOR);
    if (nodes.length === 0) return;

    // WRITE PASS 1 — clear previous decisions (both collision + day-veil) so we
    // re-evaluate from scratch. remove() no-ops on absent classes.
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove(HIDDEN_CLASS, VEIL_HIDDEN_CLASS);
    }

    // Day-veil context — cache the subsolar point + map-container offset ONCE
    // per sweep (getSubsolarLatLng runs un-memoised astronomy; calling it per
    // corner per label would be costly). `_covered(r)` then tests whether any
    // corner of a viewport rect lies in daylight. Threshold is sunAlt > 0°, to
    // exactly match the twilight clip-path's 0° night contour. sunAlt > 0 ⟺
    // sin(alt) > 0 (alt ∈ [-90°,90°]), so we skip asin and test the sine.
    let _veilOn = false,
      _veilSin = 0,
      _veilCos = 0,
      _veilLngR = 0;
    const _DEG = Math.PI / 180;
    if (
      window._twilightActive &&
      typeof GeoUtils !== 'undefined' &&
      typeof window.getSubsolarLatLng === 'function' &&
      typeof TimeState !== 'undefined'
    ) {
      const ss = window.getSubsolarLatLng(TimeState.current);
      if (ss) {
        _veilOn = true;
        _veilSin = Math.sin(ss.lat * _DEG);
        _veilCos = Math.cos(ss.lat * _DEG);
        _veilLngR = ss.lng * _DEG;
      }
    }
    function _covered(r) {
      const corners = [
        [r.left, r.top],
        [r.right, r.top],
        [r.left, r.bottom],
        [r.right, r.bottom],
      ];
      for (let c = 0; c < 4; c++) {
        const ll = _map.containerPointToLatLng(L.point(corners[c][0] - _containerOx, corners[c][1] - _containerOy));
        const sinAlt =
          Math.sin(ll.lat * _DEG) * _veilSin + Math.cos(ll.lat * _DEG) * _veilCos * Math.cos(ll.lng * _DEG - _veilLngR);
        if (sinAlt > 0) return true;
      }
      return false;
    }

    // READ PASS — collect rects + priorities. Hidden / zero-area nodes skipped.
    const VW = window.innerWidth;
    const VH = window.innerHeight;
    const items = [];
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const r = _screenRect(el);
      if (r.width <= 0 || r.height <= 0) continue;
      // Off-screen nodes (Leaflet's wrap copies that fell out of viewport)
      // contribute nothing — skip to save grid work. Check all four sides:
      // a label far to the right of the viewport (Pacific wrap copy) is just
      // as irrelevant as one off the left.
      if (r.right < 0 || r.bottom < 0 || r.left > VW || r.top > VH) continue;
      // Day-veil hide: a night-only label whose box touches daylight is hidden
      // whole and dropped from collision (so it neither places nor occludes).
      if (_veilOn && _isNightOnly(el) && _covered(r)) {
        el.classList.add(VEIL_HIDDEN_CLASS);
        continue;
      }
      const prio = priorityFor(el);
      if (prio < 0) continue;
      items.push({ el, r, prio });
    }
    if (items.length === 0) return;

    // SORT — highest priority first; they get placed first and lower-prio
    // intruders lose.
    items.sort((a, b) => b.prio - a.prio);

    // PLACE — 64-px spatial grid index. For each cell touched by the rect,
    // check existing entries in that cell for AABB overlap.
    const grid = new Map(); // key "x|y" → array of indices into `placed`
    const placed = []; // winners
    const losers = []; // to be hidden

    function intersects(a, b) {
      return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const r = it.r;

      const x0 = Math.floor(r.left / CELL);
      const y0 = Math.floor(r.top / CELL);
      const x1 = Math.floor((r.right - 0.001) / CELL);
      const y1 = Math.floor((r.bottom - 0.001) / CELL);
      let hit = false;
      // Scan all cells the rect touches; early-out on first hit.
      for (let gy = y0; gy <= y1 && !hit; gy++) {
        for (let gx = x0; gx <= x1 && !hit; gx++) {
          const key = gx + '|' + gy;
          const bucket = grid.get(key);
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            if (intersects(r, placed[bucket[k]].r)) {
              hit = true;
              break;
            }
          }
        }
      }
      if (hit) {
        losers.push(it.el);
      } else {
        const idx = placed.length;
        placed.push(it);
        for (let gy = y0; gy <= y1; gy++) {
          for (let gx = x0; gx <= x1; gx++) {
            const key = gx + '|' + gy;
            let bucket = grid.get(key);
            if (!bucket) {
              bucket = [];
              grid.set(key, bucket);
            }
            bucket.push(idx);
          }
        }
      }
    }

    // WRITE PASS 2 — hide losers in one batch.
    for (let i = 0; i < losers.length; i++) {
      losers[i].classList.add(HIDDEN_CLASS);
    }

    if (t0 && performance.now() - t0 > 30) {
      // Budget breach — log once for tuning; production users won't notice.
      if (!window._labelColliderWarned) {
        window._labelColliderWarned = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[LabelCollider] sweep took',
          (performance.now() - t0).toFixed(1),
          'ms over',
          nodes.length,
          'nodes'
        );
      }
    }
  }

  function schedule() {
    if (_pending) return;
    _pending = true;
    // rAF coalesces all triggers within the next frame into one sweep.
    requestAnimationFrame(_runSweep);
  }

  function init(map) {
    if (_map) return;
    _map = map;
    map.on('moveend zoomend overlayadd overlayremove layeradd layerremove', schedule);
    // Invalidate cached label sizes + container offset on everything except a pure
    // pan (moveend with unchanged zoom): zoom changes the tiered text, layer/overlay
    // toggles add producers, resize moves the map element. A pan leaves all three
    // untouched, so its sweep reuses the cache and reads the DOM zero times.
    map.on('zoomend resize overlayadd overlayremove layeradd layerremove', _invalidateSizes);
    _refreshContainerOffset();
    // First sweep after initial layout settles.
    schedule();
  }

  // Collect the on-screen bounding rects (viewport pixels) of every currently
  // VISIBLE label — used by line renderers (observer compass rays / great-circle
  // lines) to dim line segments that pass under a label. `extraSelector` adds
  // sources outside the priority table (e.g. compass rim SVG text, which carries
  // no collider class). `pad` inflates each rect on all sides. Occluded labels
  // (.label-occluded) and zero-area / off-screen nodes are skipped.
  function collectRects(extraSelector, pad) {
    pad = pad || 0;
    const sel = extraSelector ? SELECTOR + ',' + extraSelector : SELECTOR;
    const nodes = document.querySelectorAll(sel);
    const VW = window.innerWidth,
      VH = window.innerHeight;
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.classList.contains(HIDDEN_CLASS) || el.classList.contains(VEIL_HIDDEN_CLASS)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.right < 0 || r.bottom < 0 || r.left > VW || r.top > VH) continue;
      out.push({ left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad });
    }
    return out;
  }

  // _runNow is for testing — bypasses rAF (which is throttled in unfocused
  // iframes during automated previews). Production code should use schedule().
  window.LabelCollider = { init, schedule, _runNow: _runSweep, collectRects };
})();
