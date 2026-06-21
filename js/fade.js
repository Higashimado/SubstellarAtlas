/**
 * fade.js — LayerFade: pane-level opacity fade for map layer toggles.
 *
 * Sky's private fadeLayers() animates per-marker opacity (one style write per
 * element). This module fades a whole Leaflet pane in one write — the right
 * tool when a layer owns its pane exclusively (star canvas, body markers,
 * aurora/clouds/lp/sat tiles). Shared globally so both sky.js (star canvas)
 * and map.js (layer buttons) can use it.
 *
 * - WeakMap per-pane state cancels an in-flight fade on rapid re-toggle.
 * - Respects prefers-reduced-motion (collapses to an instant set).
 * - 380ms ease-out mirrors sky.js LINE_ANIM_DURATION for a consistent feel.
 */
const LayerFade = (() => {
  const DEFAULT_MS = 380; // mirror sky.js LINE_ANIM_DURATION

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  const _state = new WeakMap(); // pane -> { timer, raf }

  function _clear(pane) {
    const s = _state.get(pane);
    if (s) {
      if (s.timer) clearTimeout(s.timer);
      if (s.raf) cancelAnimationFrame(s.raf);
    }
    const n = {};
    _state.set(pane, n);
    return n;
  }

  // Fade a single pane's opacity. on=true → 0→1 (then clear inline opacity so
  // CSS rules resume), on=false → current→0. Returns a Promise resolving when
  // the transition completes (or immediately under reduced-motion).
  function fadePane(pane, on, ms) {
    if (!pane) return Promise.resolve();
    ms = ms || DEFAULT_MS;
    const st = _clear(pane);

    if (reduced()) {
      pane.style.transition = '';
      pane.style.opacity = on ? '' : '0';
      return Promise.resolve();
    }

    pane.style.transition = 'none';
    pane.style.opacity = on ? '0' : pane.style.opacity || '';
    void pane.offsetWidth; // force reflow so the start opacity commits

    return new Promise((resolve) => {
      st.raf = requestAnimationFrame(() => {
        st.raf = null;
        pane.style.transition = 'opacity ' + (ms / 1000).toFixed(3) + 's ease-out';
        pane.style.opacity = on ? '' : '0';
        st.timer = setTimeout(() => {
          st.timer = null;
          pane.style.transition = '';
          if (on) pane.style.opacity = '';
          resolve();
        }, ms);
      });
    });
  }

  // Fade several named panes together; resolves when all complete.
  function fadePanes(map, names, on, ms) {
    if (!map) return Promise.resolve();
    const panes = names.map((n) => map.getPane(n)).filter(Boolean);
    return Promise.all(panes.map((p) => fadePane(p, on, ms)));
  }

  // Convenience wrapper encapsulating the add-then-fade-in / fade-out-then-remove
  // pattern. addFn/removeFn are called by the caller to attach/detach the actual
  // Leaflet layer(s); the pane fade brackets them. Returns a Promise.
  //   on=true  : addFn() (content must exist to fade in) → fade panes in
  //   on=false : fade panes out → removeFn()
  function toggle(map, names, on, addFn, removeFn, ms) {
    if (on) {
      if (addFn) addFn();
      return fadePanes(map, names, true, ms);
    }
    return fadePanes(map, names, false, ms).then(() => {
      if (removeFn) removeFn();
    });
  }

  return { fadePane, fadePanes, toggle, reducedMotion: reduced, DEFAULT_MS };
})();
window.LayerFade = LayerFade;
