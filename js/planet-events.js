/**
 * planet-events.js — global planetary-events catalog for the left sidebar list.
 *
 * Loads the precomputed catalog (data/planet-events/planet-events.json, built by
 * tools/build-planet-events.js) and exposes a windowed chronological controller
 * with the same contract the eclipse list uses, so js/sidebar.js can render it
 * with the same card/scroll machinery. Pure global ephemeris — no per-observer
 * visibility. See [memory: project_sidebar_eclipse_section] for the sibling
 * eclipse feature this mirrors.
 *
 * Public API (PlanetEvents): init(map), ready(cb), makeListController(), isReady().
 */
const PlanetEvents = (() => {
  let _events = [];
  let _loaded = false;
  let _callbacks = [];
  // Comet id ('comet:12p') → display label ('Pons-Brooks (12P)'), harvested from
  // the catalog's own comet events so the sidebar renders a comet's name without an
  // async roster round-trip. The label is baked into each comet event at build time.
  const _cometNames = {};

  // ---- Data Loading ----
  function loadData(cb) {
    if (_loaded) {
      cb && cb();
      return;
    }
    _callbacks.push(cb);
    if (_callbacks.length > 1) return;
    fetch('data/planet-events/planet-events.json')
      .then((r) => r.json())
      .then((arr) => {
        _events = Array.isArray(arr) ? arr : [];
        // Pre-parse the primary time once; the list cursor compares it on every
        // open, so avoid re-parsing the ISO string per event per open. Comet events
        // also seed the id→label map for the sidebar's name lookup.
        for (const e of _events) {
          e._timeMs = Date.parse(e.time);
          if (e.cname && e.bodies && e.bodies[0]) _cometNames[e.bodies[0]] = e.cname;
        }
        _events.sort((a, b) => a._timeMs - b._timeMs);
        _loaded = true;
        _callbacks.forEach((fn) => fn && fn());
        _callbacks = [];
      })
      .catch((err) => {
        console.warn('[PlanetEvents] data load failed:', err);
        _callbacks = [];
      });
  }

  function init(_map) {
    // map arg accepted for symmetry with Eclipse.init; this feature has no map
    // overlay of its own (the planet markers are drawn by js/planets.js).
    loadData();
  }

  function ready(cb) {
    loadData(cb);
  }

  // ---- List Controller ----
  // Chronological window over all events with the cursor at the event nearest to
  // the current TimeState. Identical contract to Eclipse.makeListController so the
  // sidebar's window/scroll/trim logic works unchanged.
  const INITIAL_BEFORE = 10;
  const INITIAL_AFTER = 10;
  const PAGE_SIZE = 20;
  const MAX_WINDOW = 60;

  function makeListController() {
    // `all` is the array the window indexes into: the full catalog, or the
    // matching subset once setFilter narrows it. Windowing over the subset (not
    // CSS-hiding non-matches in a full-array window) is what lets a sparse body
    // fill the panel — comet events run ~1/year against a ~237/year backdrop, so
    // a fixed-span window over the full array routinely holds zero of them.
    let all = _events;
    // Seek target. Starts at "now"; setFilter re-anchors it to the event mid-window
    // so switching filters holds the viewing position instead of snapping to now.
    let anchorMs = TimeState.current.getTime();
    let cursor = 0;
    let start = 0;
    let end = 0;

    function reseat() {
      cursor = all.findIndex((e) => e._timeMs >= anchorMs);
      if (cursor === -1) cursor = all.length;
      start = Math.max(0, cursor - INITIAL_BEFORE);
      end = Math.min(all.length, cursor + INITIAL_AFTER);
    }

    reseat();

    return {
      events: () => all.slice(start, end),
      total: () => all.length,
      cursorInWin: () => cursor - start,
      canLoadEarlier: () => start > 0,
      canLoadLater: () => end < all.length,
      loadEarlier(n = PAGE_SIZE) {
        start = Math.max(0, start - n);
      },
      loadLater(n = PAGE_SIZE) {
        end = Math.min(all.length, end + n);
      },
      windowSize: () => end - start,
      maxWindow: () => MAX_WINDOW,
      trimEarlier(n) {
        const t = Math.min(n, end - start);
        start += t;
        return t;
      },
      trimLater(n) {
        const t = Math.min(n, end - start);
        end -= t;
        return t;
      },
      // Re-window over the events passing `pred` (null = full catalog). Anchor on
      // the current window's midpoint first so a filter toggle stays roughly where
      // the user was looking rather than jumping back to now.
      setFilter(pred) {
        const anchor = all[Math.min(all.length - 1, (start + end) >> 1)];
        if (anchor) anchorMs = anchor._timeMs;
        all = pred ? _events.filter(pred) : _events;
        reseat();
      },
    };
  }

  // Comet display label for a 'comet:<designation>' id, or null before the catalog
  // has loaded / for an unknown id (the sidebar then falls back to the raw id).
  function cometName(id) {
    return _cometNames[id] || null;
  }

  return {
    init,
    ready,
    makeListController,
    isReady: () => _loaded,
    cometName,
  };
})();
