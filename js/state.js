/** state.js — AppState: URL permalink serialization & layer registry. */
const AppState = (() => {
  const _layers = {};
  const _params = {};
  let _debounceTimer = null;
  let _watching = false;

  const SUPPORTED_LANGS = ['zh-Hans', 'zh-Hant', 'en', 'fr', 'es', 'it', 'ja'];
  // Path-prefix alternation for strip/detect. zh-Hans / zh-Hant are the
  // canonical Chinese segments (segment == locale code); zh / zh-CN are tolerated
  // legacy spellings → zh-Hans. The longer zh-* forms must precede bare zh so
  // they match first.
  const LANG_PATH_GROUP = '(?:zh-Hans|zh-Hant|zh-CN|zh|en|fr|es|it|ja)';

  function registerLayer(key, handlers) {
    _layers[key] = handlers;
  }

  function isLayerOn(key) {
    const h = _layers[key];
    return !!(h && h.isOn && h.isOn());
  }

  // Register a stateful URL parameter. handlers.get() returns the string value
  // to encode (null/undefined = omit from URL). handlers.set(v) restores state.
  function registerParam(key, handlers) {
    _params[key] = handlers;
  }

  function _emitParam(p, key) {
    const h = _params[key];
    if (!h || !h.get) return;
    const v = h.get();
    if (v != null && v !== '') p.set(key, v);
  }

  function serialize() {
    const map = window.appMap || window.__map;
    if (!map) return new URLSearchParams();
    const c = map.getCenter();
    const p = new URLSearchParams();

    // ---- View ----
    p.set('v', c.lat.toFixed(4) + ',' + c.lng.toFixed(4) + ',' + map.getZoom());

    // ---- Time ----
    if (typeof TimeState !== 'undefined') {
      if (!TimeState.isPlaying()) {
        // Keep sub-second precision: jump-to-instant permalinks (sunrise,
        // eclipse contacts) land on a fractional second, and the day-veil
        // terminator moves ~0.0032°/s near the horizon — integer truncation
        // here dropped up to ~0.5s, i.e. ~150m / dozens of px of terminator
        // offset at high zoom. parseFloat(toFixed(3)) quantises to ms and
        // strips trailing zeros (whole second → "…672", sunrise → "…672.33").
        const tSec = TimeState.current.getTime() / 1000;
        p.set('t', String(parseFloat(tSec.toFixed(3))));
      }
      if (TimeState.timezone) p.set('tz', TimeState.timezone);
    }

    // ---- Appearance ----
    _emitParam(p, 'base');

    if (typeof Sky !== 'undefined') {
      const m = Sky.getMode();
      if (m !== 'off') p.set('stars', m);
    }

    const on = Object.keys(_layers).filter((k) => _layers[k].isOn());
    if (on.length) p.set('layers', on.join(','));

    // ---- Interaction ----
    // Compass lock flag (c) is appended as a third comma-separated field of obs
    // (obs=lat,lng,1) so the two semantically coupled values share one URL key.
    if (window.currentObserverLatLng) {
      const o = window.currentObserverLatLng;
      const locked = _params['c'] && _params['c'].get ? _params['c'].get() : null;
      p.set('obs', o.lat.toFixed(4) + ',' + o.lng.toFixed(4) + (locked === '1' ? ',1' : ''));
    }

    _emitParam(p, 'panel');

    return p;
  }

  function applyFromURL() {
    const p = new URLSearchParams(location.search);

    // Language comes from the /lang/ path prefix (or ?lang=) and must be applied
    // even with no query params — a bare /zh-Hans/ or /fr/ link is a valid
    // language entry point, so this runs before the permalink-restoration
    // early-out. Path segment equals the locale code; zh / zh-CN are tolerated
    // as legacy spellings of zh-Hans.
    const pathForLang = location.pathname.replace(/index\.html$/, '');
    const pathLangMatch = pathForLang.match(new RegExp('/(' + LANG_PATH_GROUP + ')/?$'));
    let lang = pathLangMatch ? pathLangMatch[1] : p.get('lang');
    if (lang === 'zh' || lang === 'zh-CN') lang = 'zh-Hans';
    if (lang && SUPPORTED_LANGS.indexOf(lang) !== -1 && typeof I18n !== 'undefined') {
      I18n.setLocale(lang);
    }

    // The rest of the permalink (view, time, layers) needs query params.
    if (!p.toString()) return;

    const map = window.appMap || window.__map;

    // ---- View ----
    const v = p.get('v');
    if (v && map) {
      const parts = v.split(',').map(Number);
      const lat = parts[0];
      const lng = parts[1];
      const z = parts[2];
      if (!isNaN(lat) && !isNaN(lng)) {
        map.setView([lat, lng], isNaN(z) ? map.getZoom() : z);
      }
    }

    // ---- Time ----
    const t = parseFloat(p.get('t')); // parseFloat reads both integer and sub-second decimal forms
    if (!isNaN(t) && typeof TimeState !== 'undefined') {
      TimeState.setTime(new Date(Math.round(t * 1000))); // Math.round guards float-mult drift (…329.99 → …330)
    }

    const tz = p.get('tz');
    if (tz && typeof TimeState !== 'undefined' && TimeState.setTimezone) {
      TimeState.setTimezone(tz);
    }

    // ---- Appearance ----
    const base = p.get('base');
    if (_params['base'] && _params['base'].set) _params['base'].set(base || 'carto');

    const layerStr = p.get('layers');
    if (layerStr) {
      const want = new Set(layerStr.split(','));
      for (const [key, h] of Object.entries(_layers)) {
        if (want.has(key) && !h.isOn()) h.setOn(true);
        else if (!want.has(key) && h.isOn()) h.setOn(false);
      }
    }

    const stars = p.get('stars');
    if (stars && typeof Sky !== 'undefined') {
      Sky.setMode(stars);
      if (typeof Asterism !== 'undefined') {
        if (stars === 'off') Asterism.hide();
        else Asterism.show();
      }
    }

    // ---- Interaction ----
    // obs must be applied before the compass flag (compass attaches to the
    // observer marker) and before panel (right sidebar renders observer content).
    // The compass lock flag is the optional third field: obs=lat,lng[,1].
    // Standalone c=1 is accepted as a fallback for old-format permalinks.
    const obs = p.get('obs');
    if (obs) {
      const parts = obs.split(',');
      const oLat = Number(parts[0]);
      const oLng = Number(parts[1]);
      if (!isNaN(oLat) && !isNaN(oLng) && typeof window.enterLocationMode === 'function') {
        window.enterLocationMode(oLat, oLng);
      }
      if (parts[2] === '1' && _params['c'] && _params['c'].set) _params['c'].set('1');
    }

    if (!obs && p.get('c') === '1' && _params['c'] && _params['c'].set) _params['c'].set('1');

    const panel = p.get('panel');
    if (panel && _params['panel'] && _params['panel'].set) _params['panel'].set(panel);
  }

  function _basePath() {
    let path = location.pathname.replace(/index\.html$/, '');
    // Strip ALL trailing language segments; the (?:...)+ self-heals historically
    // accumulated nesting like /it/it/it/ → /
    path = path.replace(new RegExp('(?:/' + LANG_PATH_GROUP + ')+/?$'), '/');
    if (!path.endsWith('/')) path += '/';
    return path;
  }

  function _writeURL() {
    const qs = serialize().toString();
    const base = _basePath();
    const lang = typeof I18n !== 'undefined' ? I18n.getLocale() : 'zh-Hans';
    // Every language carries a /lang/ prefix whose segment is exactly the locale
    // code (matching the en/ fr/ ja/ zh-Hans/ zh-Hant/ entry shells); there is no
    // prefix-less root.
    const url = base + lang + '/' + (qs ? '?' + qs : '');
    history.replaceState(null, '', url);
  }

  function _scheduleWrite() {
    // Leading throttle, not a reset-on-every-call debounce. _writeURL → serialize()
    // reads live map state when the timer fires, so there's no need to clear+rearm to
    // capture "the last" event. That churn mattered: a single zoom fires thousands of
    // layeradd/layerremove (Leaflet re-fires every sublayer add on the map) and time
    // playback fires every frame, so the old clearTimeout+setTimeout pair was one of
    // the trace's top self-time costs. One pending timer per burst; the next event
    // after it fires rearms it — a throttle that still converges on the final state.
    if (_debounceTimer) return;
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      _writeURL();
    }, 500);
  }

  function startWatching() {
    if (_watching) return;
    _watching = true;
    const map = window.appMap || window.__map;
    if (map) {
      map.on('moveend zoomend', _scheduleWrite);
      map.on('layeradd layerremove', _scheduleWrite);
    }
    if (typeof TimeState !== 'undefined') {
      TimeState.subscribe(_scheduleWrite);
    }
    if (typeof I18n !== 'undefined') {
      I18n.subscribe(_scheduleWrite);
    }
  }

  function setLayerOn(key, on) {
    const h = _layers[key];
    if (h && h.setOn) h.setOn(on);
  }

  return {
    registerLayer,
    isLayerOn,
    setLayerOn,
    registerParam,
    serialize,
    applyFromURL,
    startWatching,
    touch: _scheduleWrite,
  };
})();
