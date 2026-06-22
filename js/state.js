/** state.js — AppState: URL permalink serialization & layer registry. */
const AppState = (() => {
  const _layers = {};
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

  function serialize() {
    const map = window.appMap || window.__map;
    if (!map) return new URLSearchParams();
    const c = map.getCenter();
    const p = new URLSearchParams();
    p.set('lat', c.lat.toFixed(4));
    p.set('lng', c.lng.toFixed(4));
    p.set('z', String(map.getZoom()));

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

    const on = Object.keys(_layers).filter((k) => _layers[k].isOn());
    if (on.length) p.set('layers', on.join(','));

    if (typeof Sky !== 'undefined') {
      const m = Sky.getMode();
      if (m !== 'off') p.set('stars', m);
    }

    if (window.currentObserverLatLng) {
      const o = window.currentObserverLatLng;
      p.set('obs', o.lat.toFixed(4) + ',' + o.lng.toFixed(4));
    }

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

    const lat = parseFloat(p.get('lat'));
    const lng = parseFloat(p.get('lng'));
    const z = parseInt(p.get('z'), 10);
    if (map && !isNaN(lat) && !isNaN(lng)) {
      map.setView([lat, lng], isNaN(z) ? map.getZoom() : z);
    }

    const t = parseFloat(p.get('t')); // parseFloat reads both legacy integer and sub-second decimal forms
    if (!isNaN(t) && typeof TimeState !== 'undefined') {
      TimeState.setTime(new Date(Math.round(t * 1000))); // Math.round guards float-mult drift (…329.99 → …330)
    }

    const tz = p.get('tz');
    if (tz && typeof TimeState !== 'undefined' && TimeState.setTimezone) {
      TimeState.setTimezone(tz);
    }

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

    const obs = p.get('obs');
    if (obs) {
      const [oLat, oLng] = obs.split(',').map(Number);
      if (!isNaN(oLat) && !isNaN(oLng) && typeof window.enterLocationMode === 'function') {
        window.enterLocationMode(oLat, oLng);
      }
    }
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
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(_writeURL, 500);
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

  return { registerLayer, isLayerOn, setLayerOn, serialize, applyFromURL, startWatching };
})();
