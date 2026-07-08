/** i18n.js — Centralized UI string translation system. */
const I18n = (() => {
  const SUPPORTED = ['zh-Hans', 'zh-Hant', 'en', 'fr', 'es', 'it', 'ja'];
  const FALLBACK = 'zh-Hans';
  // zh-Hans is the prefix-less root default, so an explicit choice of it leaves
  // no URL marker for applyFromURL to re-assert on refresh — a non-Chinese
  // navigator.language would silently win. Persist the explicit pick so
  // detectLocale can honor it across reloads regardless of browser language.
  const STORE_KEY = 'substellaratlas.locale';

  let _locale = FALLBACK;
  let _dict = {};
  let _fallbackDict = {};
  let _subs = [];
  let _ready = false;

  function t(key, params) {
    let str = _dict[key] ?? _fallbackDict[key];
    if (str == null) return key;
    if (params) {
      for (const k of Object.keys(params)) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
      }
    }
    return str;
  }

  // Glossary lookup: a single `glossary.<slug>` namespace holding short
  // encyclopedia-style term definitions, shared across panels and cards so
  // one concept (magnitude, RA, …) is defined once and reused everywhere.
  // Returns '' when the slug has no entry (so callers can no-op cleanly).
  function gloss(slug, params) {
    const key = 'glossary.' + slug;
    let str = _dict[key] ?? _fallbackDict[key];
    if (str == null) return '';
    if (params) {
      for (const k of Object.keys(params)) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
      }
    }
    return str;
  }

  // HTML attribute form of gloss(): returns ` data-gloss="…"` (escaped) for
  // inlining into a label/th/span open tag, or '' when the slug is unknown. The
  // leading space lets call sites write `'<span class="label"' + glossAttr('ra') + '>'`.
  // The custom glossary tooltip (js/glossary-tip.js) reads [data-gloss] and renders
  // a themed definition card instead of the browser's white native title tooltip.
  function glossAttr(slug, params) {
    const str = gloss(slug, params);
    if (!str) return '';
    const esc = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return ' data-gloss="' + esc + '"';
  }

  async function _loadDict(locale) {
    const url = 'data/i18n/' + locale + '/ui.json?v=7';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('i18n load failed: ' + url);
    return resp.json();
  }

  async function init(locale) {
    _locale = SUPPORTED.includes(locale) ? locale : FALLBACK;
    try {
      _dict = await _loadDict(_locale);
      if (_locale !== FALLBACK) {
        _fallbackDict = await _loadDict(FALLBACK);
      } else {
        _fallbackDict = _dict;
      }
    } catch (e) {
      console.warn('[i18n] init failed, using keys as fallback', e);
      _dict = {};
      _fallbackDict = {};
    }
    _ready = true;
  }

  async function setLocale(locale) {
    if (!SUPPORTED.includes(locale)) return;
    // Record the intent even before the dict resolves: setLocale is only ever
    // reached by an explicit act (switcher pick or a /lang/ path), so this is
    // the user's chosen locale regardless of whether the fetch below succeeds.
    try {
      localStorage.setItem(STORE_KEY, locale);
    } catch (e) {
      // Private mode or storage disabled — preference just won't persist.
    }
    if (locale === _locale && _ready) return;
    _locale = locale;
    try {
      _dict = await _loadDict(_locale);
      if (_locale !== FALLBACK) {
        if (!Object.keys(_fallbackDict).length) {
          _fallbackDict = await _loadDict(FALLBACK);
        }
      } else {
        _fallbackDict = _dict;
      }
    } catch (e) {
      console.warn('[i18n] setLocale failed for', locale, e);
    }
    document.documentElement.lang = _locale.startsWith('zh') ? 'zh' : _locale;
    _subs.forEach((fn) => {
      try {
        fn(_locale);
      } catch (e) {
        console.error(e);
      }
    });
  }

  function getLocale() {
    return _locale;
  }

  function isZh() {
    return _locale === 'zh-Hans' || _locale === 'zh-Hant';
  }

  function isZhOrJa() {
    return _locale === 'zh-Hans' || _locale === 'zh-Hant' || _locale === 'ja';
  }

  function subscribe(fn) {
    _subs.push(fn);
  }

  function applyDOM() {
    document.documentElement.lang = _locale.startsWith('zh') ? 'zh' : _locale;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    // Route control name-hints through the themed compact label tooltip
    // (data-tip, js/glossary-tip.js) instead of the white native title.
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.dataset.tip = t(el.dataset.i18nTitle);
    });
  }

  function detectLocale() {
    const params = new URLSearchParams(location.search);
    const urlLang = params.get('lang');
    if (urlLang === 'zh' || urlLang === 'zh-CN') return 'zh-Hans';
    if (urlLang && SUPPORTED.includes(urlLang)) return urlLang;
    // A previously persisted explicit choice outranks browser language, so a
    // returning visitor keeps the language they picked even when landing on the
    // bare root before _writeURL has stamped a /lang/ prefix. An explicit /lang/
    // path still wins: applyFromURL runs after init and overrides via setLocale.
    try {
      const stored = localStorage.getItem(STORE_KEY);
      if (stored && SUPPORTED.includes(stored)) return stored;
    } catch (e) {
      // Storage unavailable — fall through to navigator detection.
    }
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('zh')) {
      if (/^zh[_-](tw|hk|mo|hant)/i.test(nav)) return 'zh-Hant';
      return 'zh-Hans';
    }
    if (nav.startsWith('ja')) return 'ja';
    if (nav.startsWith('fr')) return 'fr';
    if (nav.startsWith('es')) return 'es';
    if (nav.startsWith('it')) return 'it';
    if (nav.startsWith('en')) return 'en';
    // Unrecognized browser language → English, not the FALLBACK dict locale: a
    // visitor whose language we don't speak is far more likely to read English
    // than Chinese, and would otherwise land on a fully-Chinese UI unable to
    // find the language switcher. (FALLBACK stays zh-Hans only as the string
    // gap-filler dict, since it is the most complete catalogue.)
    return 'en';
  }

  return {
    t,
    gloss,
    glossAttr,
    init,
    setLocale,
    getLocale,
    isZh,
    isZhOrJa,
    subscribe,
    detectLocale,
    applyDOM,
    SUPPORTED,
  };
})();
