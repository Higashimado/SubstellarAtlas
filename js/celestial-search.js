/**
 * celestial-search.js — searchable index of celestial objects.
 *
 * Mirrors the lazy-load + index pattern of places.js, but over stars,
 * constellations (IAU + Chinese xingguan), deep-sky objects, comets, meteor-shower
 * radiants, and the Sun / Moon / planets. Results are layer-gated: a category
 * is only searchable while its map layer is on (see _enabledKinds).
 *
 * Positioning reuses GeoUtils.subStellarPoint (fixed RA/Dec objects) and the
 * owning modules for ephemeris bodies (Comet / Meteor / Planets). Popups are
 * delegated to the owning modules so locale-refresh keeps working.
 */
const CelestialSearch = (() => {
  const LANGS = ['en', 'fr', 'es', 'it', 'ja', 'zh-Hans', 'zh-Hant'];

  // ---- State ----
  let _loaded = false;
  let _loading = null;

  let _entries = []; // [{norm, kind, refKey, weight}]
  const _refs = {
    // refKey → source object, per kind
    star: {},
    dso: {},
    comet: {},
    meteor: {},
  };

  let _stars = [];
  let _sats = {}; // noradId → {label, type, aliases} (from Sat.getCatalog)
  let _namesWest = {}; // IAU code → {display:[ra,dec], name_la, gen, rank}
  let _namesCn = {}; // cn id → {display:[ra,dec], name, pinyin, en, rank}

  const _i18nStars = {}; // lang → {hip: "pinyin|meaning"}
  const _i18nIau = {}; // lang → {code: name}
  const _i18nCn = {}; // lang → {cnId: name}
  const _ui = {}; // lang → ui.json dict (for planet/meteor names)

  // ---- Glyph Badges (One Per Category; Planets Use Body Symbol) ----
  const BADGE = {
    star: '★',
    constellation: '⬡',
    xingguan: '✴',
    dso: '◇',
    comet: '☄',
    meteor: '✦',
    sun: '☉',
    moon: '☽',
    satellite: '🛰',
  };

  const PLANET_SYM = {
    mercury: '☿',
    venus: '♀',
    mars: '♂',
    jupiter: '♃',
    saturn: '♄',
    uranus: '♅',
    neptune: '♆',
  };

  // ---- Locale Helpers ----
  function _locale() {
    let loc = typeof I18n !== 'undefined' ? I18n.getLocale() : 'en';
    if (loc === 'zh-CN') loc = 'zh-Hans';
    if (loc === 'zh-TW') loc = 'zh-Hant';
    return LANGS.indexOf(loc) >= 0 ? loc : 'en';
  }

  function _isCJK(loc) {
    return loc === 'zh-Hans' || loc === 'zh-Hant' || loc === 'ja';
  }

  function _normalize(str) {
    return String(str).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  }

  // Pinyin/native part (before "|") and meaning part (after "|"); each may carry
  // comma-joined alternates ("，"). Returns the first segment of the native part.
  function _firstName(raw) {
    if (!raw) return null;
    const bar = raw.indexOf('|');
    let v = bar >= 0 ? raw.substring(0, bar) : raw;
    const c = v.indexOf('，');
    return c >= 0 ? v.substring(0, c) : v;
  }

  // All searchable name segments from a "pinyin|meaning，alt" dict value.
  function _nameForms(raw) {
    if (!raw) return [];
    const out = [];
    const bar = raw.indexOf('|');
    const py = bar >= 0 ? raw.substring(0, bar) : raw;
    const mn = bar >= 0 ? raw.substring(bar + 1) : null;
    py.split('，').forEach((s) => {
      if (s) out.push(s);
    });
    if (mn)
      mn.split('，').forEach((s) => {
        if (s) out.push(s);
      });
    return out;
  }

  // ---- Lazy Loading ----
  function ensureLoaded() {
    if (_loaded) return Promise.resolve();
    if (_loading) return _loading;
    _loading = _doLoad().catch((err) => {
      console.warn('[celestial-search] load failed:', err);
      _loading = null;
      throw err;
    });
    return _loading;
  }

  async function _fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.json();
  }

  function _fetchOpt(url) {
    return _fetchJson(url).catch(() => null);
  }

  async function _doLoad() {
    const jobs = [
      _fetchJson('data/sky/stars.json').then((d) => {
        _stars = d;
      }),
      _fetchOpt('data/sky/names.west.json').then((d) => {
        if (d) _namesWest = d;
      }),
      _fetchOpt('data/sky/names.cn.json').then((d) => {
        if (d) _namesCn = d;
      }),
      _fetchOpt('data/dso/catalog.json').then((d) => {
        (d || []).forEach((o) => {
          _refs.dso[o.id] = o;
        });
      }),
      _fetchOpt('data/comets/elements.json').then((d) => {
        const arr = d ? (Array.isArray(d) ? d : d.comets || []) : [];
        arr.forEach((c) => {
          _refs.comet[c.designation || c.name] = c;
        });
      }),
      _fetchOpt('data/meteors/showers.json').then((d) => {
        (d || []).forEach((s) => {
          _refs.meteor[s.code] = s;
        });
      }),
    ];
    for (const lang of LANGS) {
      jobs.push(
        _fetchOpt('data/sky/i18n/' + lang + '/stars.json').then((d) => {
          _i18nStars[lang] = d || {};
        })
      );
      jobs.push(
        _fetchOpt('data/sky/i18n/' + lang + '/constellations.iau.json').then((d) => {
          _i18nIau[lang] = d || {};
        })
      );
      jobs.push(
        _fetchOpt('data/sky/i18n/' + lang + '/constellations.cn.json').then((d) => {
          _i18nCn[lang] = d || {};
        })
      );
      jobs.push(
        _fetchOpt('data/i18n/' + lang + '/ui.json').then((d) => {
          _ui[lang] = d || {};
        })
      );
    }
    await Promise.all(jobs);
    _buildIndex();
    _loaded = true;
  }

  // ---- Index ----
  function _buildIndex() {
    _entries = [];
    const add = (text, kind, refKey, weight) => {
      const n = _normalize(text);
      if (n) _entries.push({ norm: n, kind, refKey, weight });
    };

    // Stars: multilingual xingguan names + proper + Bayer/Flamsteed + catalog numbers.
    for (const s of _stars) {
      _refs.star[s.id] = s;
      const w = Math.max(0, 8 - (s.mag != null ? s.mag : 8));
      if (s.proper) add(s.proper, 'star', s.id, w + 2);
      if (s.bf) add(s.bf, 'star', s.id, w);
      if (s.hip != null) {
        add('hip ' + s.hip, 'star', s.id, w);
        add('hip' + s.hip, 'star', s.id, w);
        add('' + s.hip, 'star', s.id, w);
      }
      if (s.hd != null) {
        add('hd ' + s.hd, 'star', s.id, w);
        add('hd' + s.hd, 'star', s.id, w);
        add('' + s.hd, 'star', s.id, w);
      }
      if (s.hr != null) {
        add('hr ' + s.hr, 'star', s.id, w);
        add('hr' + s.hr, 'star', s.id, w);
        add('' + s.hr, 'star', s.id, w);
      }
      if (s.hip != null) {
        for (const lang of LANGS) {
          const raw = _i18nStars[lang] && _i18nStars[lang][s.hip];
          for (const form of _nameForms(raw)) add(form, 'star', s.id, w + 1);
        }
      }
    }

    // IAU constellations: code + Latin name + per-language translations.
    for (const code in _namesWest) {
      const info = _namesWest[code];
      const w = 7 - (info.rank || 3);
      add(code, 'constellation', code, w);
      if (info.name_la) add(info.name_la, 'constellation', code, w + 1);
      if (info.gen) add(info.gen, 'constellation', code, w);
      for (const lang of LANGS) {
        const nm = _i18nIau[lang] && _i18nIau[lang][code];
        if (nm) add(nm, 'constellation', code, w + 1);
      }
    }

    // Chinese xingguan (asterisms): pinyin + English meaning + per-language names.
    for (const id in _namesCn) {
      const info = _namesCn[id];
      const w = 6 - (info.rank || 3);
      if (info.name) add(info.name, 'xingguan', id, w + 1);
      if (info.pinyin) add(info.pinyin, 'xingguan', id, w);
      if (info.en) add(info.en, 'xingguan', id, w);
      for (const lang of LANGS) {
        const raw = _i18nCn[lang] && _i18nCn[lang][id];
        for (const form of _nameForms(raw)) add(form, 'xingguan', id, w);
      }
    }

    // Deep-sky objects: id (NGC…) + Messier + common name.
    for (const id in _refs.dso) {
      const d = _refs.dso[id];
      const w = Math.max(0, 10 - (d.mag != null ? d.mag : 10));
      add(d.id, 'dso', id, w);
      if (d.messier) {
        const mi = parseInt(d.messier, 10);
        add('m' + mi, 'dso', id, w + 1);
        add('m ' + mi, 'dso', id, w + 1);
        add('messier ' + mi, 'dso', id, w);
      }
      if (d.common) add(d.common, 'dso', id, w + 1);
    }

    // Comets: name + designation.
    for (const key in _refs.comet) {
      const c = _refs.comet[key];
      const w = Math.max(0, 12 - (c.h != null ? c.h : 12));
      if (c.name) add(c.name, 'comet', key, w + 1);
      if (c.designation) add(c.designation, 'comet', key, w);
    }

    // Meteor showers: English name + code + per-language names.
    for (const code in _refs.meteor) {
      const s = _refs.meteor[code];
      const w = Math.min(8, (s.zhr || 0) / 15);
      if (s.name) add(s.name, 'meteor', code, w + 1);
      add(s.code, 'meteor', code, w);
      for (const lang of LANGS) {
        const nm = _ui[lang] && _ui[lang]['meteor.name.' + code];
        if (nm) add(nm, 'meteor', code, w + 1);
      }
    }

    // Sun / Moon / planets: per-language names + symbol.
    const bodies = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
    for (const id of bodies) {
      const kind = id === 'sun' || id === 'moon' ? id : 'planet';
      for (const lang of LANGS) {
        const nm = _ui[lang] && _ui[lang]['planet.' + id];
        if (nm) add(nm, kind, id, 12);
      }
      const sym = id === 'sun' ? '☉' : id === 'moon' ? '☽' : PLANET_SYM[id];
      if (sym) add(sym, kind, id, 12);
    }

    // Satellites (curated): label + aliases + NORAD id. Positions are live (SGP4),
    // so nothing is precomputed here; the static catalogue needs no TLE load.
    if (typeof Sat !== 'undefined' && Sat.getCatalog) {
      for (const s of Sat.getCatalog()) {
        _sats[s.noradId] = s;
        add(s.label, 'satellite', s.noradId, 12);
        add('' + s.noradId, 'satellite', s.noradId, 8);
        for (const a of s.aliases) add(a, 'satellite', s.noradId, 11);
      }
    }
  }

  // ---- Gating ----
  function _enabledKinds() {
    const set = new Set();
    const skyOn = typeof Sky !== 'undefined' && Sky.getMode && Sky.getMode() !== 'off';
    if (skyOn) ['star', 'constellation', 'xingguan', 'dso', 'comet', 'meteor'].forEach((k) => set.add(k));
    const on = (k) => typeof AppState !== 'undefined' && AppState.isLayerOn && AppState.isLayerOn(k);
    if (on('twilight')) set.add('sun');
    if (on('moon')) set.add('moon');
    if (on('planets')) set.add('planet');
    if (typeof Sat !== 'undefined' && Sat.isOn && Sat.isOn()) set.add('satellite');
    return set;
  }

  // ---- Display ----
  function _displayName(kind, refKey) {
    const loc = _locale();
    switch (kind) {
      case 'star': {
        const s = _refs.star[refKey];
        const localized = s.hip != null ? _firstName(_i18nStars[loc] && _i18nStars[loc][s.hip]) : null;
        if (_isCJK(loc)) return localized || s.proper || s.bf || 'HIP ' + s.hip;
        return s.proper || localized || s.bf || 'HIP ' + s.hip;
      }
      case 'constellation': {
        const nm = _i18nIau[loc] && _i18nIau[loc][refKey];
        return nm || (_namesWest[refKey] && _namesWest[refKey].name_la) || refKey;
      }
      case 'xingguan': {
        const localized = _firstName(_i18nCn[loc] && _i18nCn[loc][refKey]);
        return localized || (_namesCn[refKey] && _namesCn[refKey].name) || refKey;
      }
      case 'dso': {
        const d = _refs.dso[refKey];
        const label = d.messier ? 'M' + parseInt(d.messier, 10) : d.id;
        return d.common ? d.common : label;
      }
      case 'comet':
        return _refs.comet[refKey].name || refKey;
      case 'meteor': {
        const nm = _ui[loc] && _ui[loc]['meteor.name.' + refKey];
        return nm || (_refs.meteor[refKey] && _refs.meteor[refKey].name) || refKey;
      }
      case 'sun':
      case 'moon':
      case 'planet': {
        return (_ui[loc] && _ui[loc]['planet.' + refKey]) || refKey;
      }
      case 'satellite':
        return (_sats[refKey] && _sats[refKey].label) || '' + refKey;
    }
    return refKey;
  }

  function _metaText(kind, refKey) {
    switch (kind) {
      case 'star': {
        const s = _refs.star[refKey];
        return s.bf || (s.hip != null ? 'HIP ' + s.hip : '');
      }
      case 'constellation':
        return (_namesWest[refKey] && _namesWest[refKey].name_la) || '';
      case 'xingguan':
        return (_namesCn[refKey] && _namesCn[refKey].en) || '';
      case 'dso': {
        const d = _refs.dso[refKey];
        const m = d.messier ? 'M' + parseInt(d.messier, 10) : '';
        return [m, d.id].filter((x) => x && x !== _displayName(kind, refKey)).join(' · ');
      }
      case 'comet':
        return _refs.comet[refKey].designation || '';
      case 'satellite': {
        const s = _sats[refKey];
        return (s && s.aliases && s.aliases[0]) || '';
      }
      default:
        return '';
    }
  }

  function _badge(kind, refKey) {
    if (kind === 'planet') return PLANET_SYM[refKey] || '●';
    return BADGE[kind] || '✦';
  }

  // ---- Search ----
  function search(query) {
    if (!_loaded || !query) return [];
    const norm = _normalize(query);
    if (!norm) return [];
    const enabled = _enabledKinds();
    if (enabled.size === 0) return [];

    const best = new Map(); // "kind|refKey" → {score, kind, refKey}
    for (const e of _entries) {
      if (!enabled.has(e.kind)) continue;
      const isPrefix = e.norm.startsWith(norm);
      const isSubstr = !isPrefix && e.norm.includes(norm);
      if (!isPrefix && !isSubstr) continue;
      const score = (isPrefix ? 10 : 0) + (e.norm === norm ? 6 : 0) + e.weight;
      const key = e.kind + '|' + e.refKey;
      const cur = best.get(key);
      if (!cur || score > cur.score) best.set(key, { score, kind: e.kind, refKey: e.refKey });
    }

    const date = typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date();
    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 9)
      .map((x) => {
        const pos = _getRADec(x.kind, x.refKey, date);
        return {
          kind: x.kind,
          refKey: x.refKey,
          name: _displayName(x.kind, x.refKey),
          meta: _metaText(x.kind, x.refKey),
          badge: _badge(x.kind, x.refKey),
          ra: pos ? pos.ra : null,
          dec: pos ? pos.dec : null,
          isCelestial: true,
        };
      });
  }

  function _getRADec(kind, refKey, date) {
    switch (kind) {
      case 'star': {
        const s = _refs.star[refKey];
        return s ? { ra: s.ra, dec: s.dec } : null;
      }
      case 'dso': {
        const d = _refs.dso[refKey];
        return d ? { ra: d.ra * 15, dec: d.dec } : null;
      }
      case 'meteor': {
        const s = _refs.meteor[refKey];
        return s ? { ra: s.ra, dec: s.dec } : null;
      }
      case 'constellation': {
        const c = _namesWest[refKey];
        return c ? { ra: c.display[0], dec: c.display[1] } : null;
      }
      case 'xingguan': {
        const c = _namesCn[refKey];
        return c ? { ra: c.display[0], dec: c.display[1] } : null;
      }
      case 'comet': {
        const c = _refs.comet[refKey];
        if (!c || typeof Comet === 'undefined' || !Comet.computeRaDec) return null;
        return Comet.computeRaDec(c, date);
      }
      case 'sun':
      case 'moon':
      case 'planet': {
        if (typeof Planets === 'undefined' || !Planets.getBodyRaDec) return null;
        return Planets.getBodyRaDec(refKey, date);
      }
      case 'satellite':
        return null; // no fixed RA/Dec — live sub-point only
    }
    return null;
  }

  // ---- Select (Pan + Popup) ----
  function _position(kind, refKey, date) {
    switch (kind) {
      case 'star': {
        const s = _refs.star[refKey];
        return GeoUtils.subStellarPoint(s.ra, s.dec, date);
      }
      case 'dso': {
        const d = _refs.dso[refKey];
        return GeoUtils.subStellarPoint(d.ra * 15, d.dec, date);
      }
      case 'constellation': {
        const c = _namesWest[refKey];
        return c && GeoUtils.subStellarPoint(c.display[0], c.display[1], date);
      }
      case 'xingguan': {
        const c = _namesCn[refKey];
        return c && GeoUtils.subStellarPoint(c.display[0], c.display[1], date);
      }
      case 'comet':
        return Comet.locate(_refs.comet[refKey], date);
      case 'meteor':
        return Meteor.locate(_refs.meteor[refKey], date);
      case 'sun':
      case 'moon':
      case 'planet':
        return Planets.getSearchLatLng(refKey, date);
      case 'satellite':
        return typeof Sat !== 'undefined' && Sat.getSearchLatLng ? Sat.getSearchLatLng(refKey, date) : null;
    }
    return null;
  }

  function select(r, map) {
    if (!map) return;
    const date = typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date();
    const pos = _position(r.kind, r.refKey, date);
    if (!pos) return;

    const centerLng = map.getCenter().lng;
    const targetLng = pos.lng + 360 * Math.round((centerLng - pos.lng) / 360);
    const zoom = Math.max(map.getZoom(), 4);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const latlng = [pos.lat, targetLng];
    map.flyTo(latlng, zoom, { animate: !reduced });

    switch (r.kind) {
      case 'star':
        Sky.showStarPopup(_refs.star[r.refKey], latlng);
        break;
      case 'dso':
        Sky.showDSOPopup(_refs.dso[r.refKey], latlng);
        break;
      case 'comet':
        Comet.showSearchPopup(_refs.comet[r.refKey], date, latlng, map);
        break;
      case 'meteor':
        Meteor.showSearchPopup(_refs.meteor[r.refKey], date, latlng, map);
        break;
      case 'sun':
      case 'moon':
      case 'planet':
        Planets.showSearchPopup(r.refKey, date, latlng, map);
        break;
      case 'satellite':
        if (typeof Sat !== 'undefined' && Sat.showSearchPopup) Sat.showSearchPopup(r.refKey, date, latlng, map);
        break;
      case 'constellation':
      case 'xingguan':
        Sky.showConstellationPopup(r.kind, r.refKey, latlng);
        break;
    }
  }

  // True when at least one celestial category is currently searchable (its
  // layer is on). Cheap — does not require the index to be loaded.
  function isActive() {
    return _enabledKinds().size > 0;
  }

  return { ensureLoaded, search, select, isActive };
})();
