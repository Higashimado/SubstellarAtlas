/**
 * celestial-search.js — searchable index of celestial objects.
 *
 * Mirrors the lazy-load + index pattern of places.js, but over stars,
 * constellations (IAU + Chinese xingguan), deep-sky objects, comets, meteor-shower
 * radiants, the Sun / Moon / planets, and solar/lunar eclipses. Every category is
 * always searchable regardless of layer state; selecting a result turns on the
 * layer it lives on (see select → _ensureLayerOn) so the jump never lands blind.
 *
 * Positioning reuses GeoUtils.subStellarPoint (fixed RA/Dec objects) and the
 * owning modules for ephemeris bodies (Comet / Meteor / Planets); eclipses fly to
 * their greatest point and hand off to Eclipse.openEvent. Popups are delegated to
 * the owning modules so locale-refresh keeps working.
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
    asteroid: {},
    eclipse: {},
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
    constellation: '♈︎',
    xingguan: '▦',
    dso: '◇',
    comet: '☄',
    meteor: '✦',
    sun: '☉',
    moon: '☾',
    pmoon: '◦',
    satellite: '🛰',
  };

  const PLANET_SYM = {
    mercury: '☿',
    venus: '♀',
    mars: '♂',
    jupiter: '♃',
    saturn: '♄',
    uranus: '⛢',
    neptune: '♆',
  };

  // Traditional Unicode symbols for the first four numbered asteroids.
  const ASTEROID_SYM = { 1: '⚳', 2: '⚴', 3: '⚵', 4: '⚶' };

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
      _fetchOpt('data/asteroids/elements.json').then((d) => {
        const arr = d ? (Array.isArray(d) ? d : d.asteroids || []) : [];
        arr.forEach((a) => {
          _refs.asteroid[a.num] = a;
        });
      }),
      _fetchOpt('data/meteors/showers.json').then((d) => {
        (d || []).forEach((s) => {
          _refs.meteor[s.code] = s;
        });
      }),
      // Eclipse events load through Eclipse's own catalog fetch, not a raw JSON
      // read here — so the index shares the same parsed records openEvent drives.
      new Promise((res) => {
        if (typeof Eclipse !== 'undefined' && Eclipse.ready) Eclipse.ready(() => res());
        else res();
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

    // Asteroids: name + catalog number + symbol (for ⚳⚴⚵⚶) + per-language names.
    for (const num in _refs.asteroid) {
      const a = _refs.asteroid[num];
      const w = Math.max(0, 12 - (a.peakV != null ? a.peakV : 10));
      add(a.name, 'asteroid', num, w + 2);
      add('' + a.num, 'asteroid', num, w);
      const sym = ASTEROID_SYM[a.num];
      if (sym) add(sym, 'asteroid', num, w + 2);
      for (const lang of LANGS) {
        const nm = _ui[lang] && _ui[lang]['asteroid.name.' + num];
        if (nm && nm !== a.name) add(nm, 'asteroid', num, w + 2);
      }
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
      const sym = id === 'sun' ? '☉' : id === 'moon' ? '☾' : PLANET_SYM[id];
      if (sym) add(sym, kind, id, 12);
    }

    // Planetary moons (Galilean + Saturn): per-language names. The roster comes
    // from Planets so it tracks whatever the map actually renders. No symbol —
    // there is no single glyph per moon; the '◐' badge marks the category.
    if (typeof Planets !== 'undefined' && Planets.getMoonIds) {
      for (const id of Planets.getMoonIds()) {
        for (const lang of LANGS) {
          const nm = _ui[lang] && _ui[lang]['planet.' + id];
          if (nm) add(nm, 'pmoon', id, 12);
        }
      }
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

    // Eclipse events: ISO date + year + localized type name ("日全食") + generic
    // category words ("eclipse"/"solar"/"日食"…), so a date, a phrase, or a bare
    // "eclipse" all surface them. refKey pairs the date with the kind so a solar
    // and lunar eclipse on the same date stay distinct.
    if (typeof Eclipse !== 'undefined' && Eclipse.getAllSorted) {
      for (const e of Eclipse.getAllSorted()) {
        if (!e.date) continue;
        const grp = e._kind === 'solar' ? 'solar' : 'lunar';
        const refKey = e.date + '|' + grp;
        _refs.eclipse[refKey] = e;
        add(e.date, 'eclipse', refKey, 6);
        add(e.date.slice(0, 4), 'eclipse', refKey, 3);
        add('eclipse', 'eclipse', refKey, 1);
        add(grp, 'eclipse', refKey, 1);
        const kindKey = (e.kind || '').toLowerCase();
        for (const lang of LANGS) {
          const typeName = _ui[lang] && _ui[lang]['eclipse.type.' + grp + '.' + kindKey];
          if (typeName) add(typeName, 'eclipse', refKey, 5);
          const cat = _ui[lang] && _ui[lang]['eclipse.filter.' + grp];
          if (cat) add(cat, 'eclipse', refKey, 2);
        }
      }
    }
  }

  // ---- Gating ----
  // Everything is always searchable, independent of which layers are on: hunting
  // for an object is exactly when you can't see it yet. Selecting a result turns
  // on whatever layer it lives on (see select → _ensureLayerOn), so the jump never
  // lands on a blank map.
  const ALL_KINDS = [
    'star',
    'constellation',
    'xingguan',
    'dso',
    'comet',
    'meteor',
    'sun',
    'moon',
    'planet',
    'pmoon',
    'asteroid',
    'satellite',
    'eclipse',
  ];
  function _enabledKinds() {
    return new Set(ALL_KINDS);
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
      case 'asteroid': {
        const a = _refs.asteroid[refKey];
        if (!a) return refKey;
        return (_ui[loc] && _ui[loc]['asteroid.name.' + refKey]) || a.name;
      }
      case 'meteor': {
        const nm = _ui[loc] && _ui[loc]['meteor.name.' + refKey];
        return nm || (_refs.meteor[refKey] && _refs.meteor[refKey].name) || refKey;
      }
      case 'sun':
      case 'moon':
      case 'planet':
      case 'pmoon': {
        return (_ui[loc] && _ui[loc]['planet.' + refKey]) || refKey;
      }
      case 'satellite':
        return (_sats[refKey] && _sats[refKey].label) || '' + refKey;
      case 'eclipse': {
        const e = _refs.eclipse[refKey];
        if (!e) return refKey;
        const grp = e._kind === 'solar' ? 'solar' : 'lunar';
        const kindKey = (e.kind || '').toLowerCase();
        const typeName = (_ui[loc] && _ui[loc]['eclipse.type.' + grp + '.' + kindKey]) || e.kind || '';
        return typeName ? e.date + ' ' + typeName : e.date;
      }
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
      case 'asteroid':
        return '';
      case 'satellite': {
        const s = _sats[refKey];
        return (s && s.aliases && s.aliases[0]) || '';
      }
      case 'eclipse': {
        const e = _refs.eclipse[refKey];
        return e && e.saros ? 'Saros ' + e.saros : '';
      }
      default:
        return '';
    }
  }

  function _badge(kind, refKey) {
    if (kind === 'planet') return PLANET_SYM[refKey] || '●';
    if (kind === 'asteroid') return ASTEROID_SYM[parseInt(refKey, 10)] || '⬡';
    // Solar vs lunar can't be read off the type name in every locale (English says
    // "Total eclipse" for both), so the Sun/Moon glyph carries the distinction.
    if (kind === 'eclipse') {
      const e = _refs.eclipse[refKey];
      return e && e._kind === 'lunar' ? '☾' : '☉';
    }
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
        const geo = x.kind === 'eclipse' ? _eclipseGeo(x.refKey) : null;
        return {
          kind: x.kind,
          refKey: x.refKey,
          name: _displayName(x.kind, x.refKey),
          meta: _metaText(x.kind, x.refKey),
          badge: _badge(x.kind, x.refKey),
          ra: pos ? pos.ra : null,
          dec: pos ? pos.dec : null,
          lat: geo ? geo.lat : null,
          lng: geo ? geo.lng : null,
          isCelestial: true,
        };
      });
  }

  // Greatest-eclipse ground point for a search row. A solar eclipse's umbral
  // Greatest-eclipse sub-point (peak.lat/lng) exists for every solar kind: for a
  // partial the shadow axis misses Earth, but Astronomy Engine still reports the
  // point where it passes closest to the surface (a high-latitude spot near the
  // grazed pole), so partials carry a real position too. A lunar eclipse always
  // has a sub-lunar point at mid-eclipse (subLunar.lat/lng), penumbral included.
  function _eclipseGeo(refKey) {
    const e = _refs.eclipse[refKey];
    if (!e) return null;
    if (e._kind === 'solar') {
      const g = e.peak;
      return g && g.lat != null && g.lng != null ? { lat: g.lat, lng: g.lng } : null;
    }
    const g = e.subLunar;
    return g && g.lat != null && g.lng != null ? { lat: g.lat, lng: g.lng } : null;
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
      case 'asteroid': {
        const a = _refs.asteroid[refKey];
        if (!a || typeof Asteroids === 'undefined' || !Asteroids.computeRaDec) return null;
        return Asteroids.computeRaDec(a, date);
      }
      case 'sun':
      case 'moon':
      case 'planet':
      case 'pmoon': {
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
      case 'asteroid': {
        const a = _refs.asteroid[refKey];
        return a && typeof Asteroids !== 'undefined' ? Asteroids.locate(a, date) : null;
      }
      case 'meteor':
        return Meteor.locate(_refs.meteor[refKey], date);
      case 'sun':
      case 'moon':
      case 'planet':
      case 'pmoon':
        return Planets.getSearchLatLng(refKey, date);
      case 'satellite':
        return typeof Sat !== 'undefined' && Sat.getSearchLatLng ? Sat.getSearchLatLng(refKey, date) : null;
      case 'eclipse': {
        // Fly to the eclipse's greatest point: the central peak (solar) or the
        // sub-lunar point at mid-eclipse (lunar). The clock is reset onto this
        // instant by Eclipse.openEvent, so the shadow actually sits here.
        const e = _refs.eclipse[refKey];
        if (!e) return null;
        const p = e._kind === 'solar' ? e.peak : e.subLunar || (e.contactPoints && e.contactPoints.peak);
        return p && typeof p.lat === 'number' ? { lat: p.lat, lng: p.lng } : null;
      }
    }
    return null;
  }

  // Turn on the layer a jumped-to body lives on, so the fly never lands on an
  // empty map. Centralized here (not in callers) so the search box and the
  // sidebar share one source of truth. Deep-sky kinds wake a dormant sky; the
  // eclipse kind is handled by Eclipse.openEvent, which opens its own layers.
  function _ensureLayerOn(kind, map) {
    const setOn = (k) => {
      if (typeof AppState !== 'undefined' && AppState.setLayerOn && !AppState.isLayerOn(k))
        AppState.setLayerOn(k, true);
    };

    const skyMode = (mode) => {
      if (typeof Sky !== 'undefined' && Sky.setMode) Sky.setMode(mode);
    };
    switch (kind) {
      case 'sun':
        setOn('twilight');
        break;
      case 'moon':
        setOn('moon');
        break;
      case 'planet':
      case 'pmoon':
      case 'asteroid':
        // Asteroids ride the planet layer; moons render off the parent planet's layer.
        setOn('planets');
        break;
      case 'satellite':
        if (typeof Sat !== 'undefined' && Sat.isOn && !Sat.isOn() && Sat.toggle) Sat.toggle(map);
        break;
      case 'star':
      case 'dso':
      case 'comet':
      case 'meteor':
        // Deep-sky objects show under any non-off sky mode; only wake a dormant
        // sky, never override a mode the observer already picked (iau/cn).
        if (typeof Sky !== 'undefined' && Sky.getMode && Sky.getMode() === 'off') skyMode('stars');
        break;
      case 'constellation':
        // The IAU figure/name only renders in 'iau' mode; force it so the jump lands
        // on a labelled constellation rather than a bare star field.
        skyMode('iau');
        break;
      case 'xingguan':
        skyMode('cn');
        break;
      // eclipse: Eclipse.openEvent opens the eclipse layers itself (see select).
    }
  }

  // Clamp a fly-to center so the destination viewport stays inside maxBounds,
  // mirroring Leaflet's internal _limitCenter. Without this, a center near the
  // pole / longitude wall overshoots and maxBoundsViscosity:1 snaps it back
  // mid-flight — a jarring bounce. When the viewport is larger than the bounds
  // on an axis, fall back to the bounds midpoint (no clamp possible).
  function _clampCenter(map, lat, lng, zoom) {
    const mb = map.options.maxBounds;
    if (!mb || !mb.isValid || !mb.isValid()) return L.latLng(lat, lng);
    const half = map.getSize().divideBy(2);
    const nw = map.project(mb.getNorthWest(), zoom);
    const se = map.project(mb.getSouthEast(), zoom);
    const pt = map.project([lat, lng], zoom);
    const minX = nw.x + half.x,
      maxX = se.x - half.x;
    const minY = nw.y + half.y,
      maxY = se.y - half.y;
    pt.x = minX <= maxX ? Math.min(Math.max(pt.x, minX), maxX) : (minX + maxX) / 2;
    pt.y = minY <= maxY ? Math.min(Math.max(pt.y, minY), maxY) : (minY + maxY) / 2;
    return map.unproject(pt, zoom);
  }

  function select(r, map) {
    if (!map) return;
    const date = typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date();
    const pos = _position(r.kind, r.refKey, date);
    if (!pos) return;

    _ensureLayerOn(r.kind, map);

    const centerLng = map.getCenter().lng;
    const targetLng = pos.lng + 360 * Math.round((centerLng - pos.lng) / 360);
    // Galilean/Saturn moons only render at zoom ≥ 9 (their sub-points are sub-pixel
    // below that), so a moon jump must zoom in far enough to actually reveal them.
    const zoom = Math.max(map.getZoom(), r.kind === 'pmoon' ? 9 : 4);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Anchor the popup at the body's true position, but fly to a bounds-clamped
    // center so the viewport never overshoots the pole / longitude wall.
    const latlng = [pos.lat, targetLng];
    const center = _clampCenter(map, pos.lat, targetLng, zoom);
    map.flyTo(center, zoom, { animate: !reduced });

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
      case 'asteroid':
        if (typeof Asteroids !== 'undefined' && Asteroids.showSearchPopup) {
          Asteroids.showSearchPopup(_refs.asteroid[r.refKey], date, latlng, map);
        }
        break;
      case 'meteor':
        Meteor.showSearchPopup(_refs.meteor[r.refKey], date, latlng, map);
        break;
      case 'sun':
      case 'moon':
      case 'planet':
      case 'pmoon':
        Planets.showSearchPopup(r.refKey, date, latlng, map);
        break;
      case 'satellite':
        if (typeof Sat !== 'undefined' && Sat.showSearchPopup) Sat.showSearchPopup(r.refKey, date, latlng, map);
        break;
      case 'constellation':
      case 'xingguan':
        Sky.showConstellationPopup(r.kind, r.refKey, latlng);
        break;
      case 'eclipse':
        // The fly-to above already framed the greatest point; openEvent resets the
        // clock onto peak, opens the eclipse layers, and draws the card + curves.
        if (typeof Eclipse !== 'undefined' && Eclipse.openEvent) {
          Eclipse.openEvent(_refs.eclipse[r.refKey], { resetTime: true });
        }
        break;
    }
  }

  // Always true now: every category is searchable regardless of layer state, so
  // the search box never suppresses celestial results. Kept as a stable hook for
  // callers (places.js) that gate whether to query the celestial index at all.
  function isActive() {
    return _enabledKinds().size > 0;
  }

  return { ensureLoaded, search, select, isActive };
})();
