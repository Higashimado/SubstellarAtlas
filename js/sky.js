/**
 * Sky layer — IAU constellations + Chinese xingguan, toggled by a single
 * three-state button (off → IAU → Chinese → off). Stars are drawn at their
 * substellar points (where each star is at zenith), so the entire sky
 * sheet rotates westward at 15°/h as the Earth rotates.
 *
 * Data sources (built under data/sky/ by tools/build-*.mjs):
 *   stars.json              HYG v4.1 filtered to mag ≤ 6
 *   lines.west.geojson      IAU 88 stick figures
 *   lines.cn.geojson        Chinese xingguan stick figures
 *   bounds.west.geojson     IAU 88 boundary polygons
 *   names.west.json         IAU id → { display, name_la, gen, rank }
 *   names.cn.json           Xingguan id → { name, pinyin, en, display, rank }
 *   i18n/{locale}/...       Per-locale name dictionaries (zh-Hans first)
 *
 * Public API (window.Sky):
 *   await Sky.init(map)                  load data, create layer groups
 *   Sky.setMode('off'|'stars'|'iau'|'cn') idempotent switch
 *   Sky.cycleMode()                      off → stars → iau → cn → stars → off (returns new mode)
 *   Sky.getMode()
 *   Sky.update(date)                     recompute geometry for new time
 *   Sky.onStarClick(cb)                  register click handler (called with star)
 *   Sky.setLocale(locale)                async; falls back to zh-Hans if missing
 *   Sky.renderStarPanel(star)            HTML string for sidebar
 */
const Sky = (() => {
  const _t =
    typeof I18n !== 'undefined'
      ? I18n.t.bind(I18n)
      : function (k) {
          return k;
        };
  // ` data-gloss="…"` attribute for a term label (shared themed glossary tooltip).
  const _glossAttr =
    typeof I18n !== 'undefined'
      ? I18n.glossAttr.bind(I18n)
      : function () {
          return '';
        };

  // ---- Pane & state ----
  let _map = null;
  let _mode = 'off';
  let _prevMode = 'off';
  const _loaded = { iau: false, cn: false };
  let _starClickCb = null;
  let _animating = false;
  let _overlaysSuppressed = false;
  // Separate CSS rules owned by the conflict system — independent of setMode animation rules
  let _conflictIauHideStyle = null;
  let _conflictCnHideStyle = null;

  // ---- Shared-segment detection (IAU ↔ CN) ----
  let _iauSegKeys = null; // Set<string>
  let _cnSegKeys = null;
  let _sharedSegKeys = null; // intersection

  // ---- Line animation constants ----
  const LINE_ANIM_DURATION = 380; // ms

  // Persistent CSS hide rules for line layers (kept on map, toggled via CSS)
  let _iauLineHideStyle = null;
  let _cnLineHideStyle = null;
  let _cnLabelHideStyle = null; // hides pre-created CN labels until iau→cn Phase 3
  let _cnPreloaded = false; // true when CN preload (lines + labels) is done

  // Raw data caches
  let _stars = []; // tier-0 only: mag ≤ 6 (always loaded, sorted asc by mag)
  let _starById = new Map(); // id -> star (tier-0 + currently-loaded tile stars)
  let _dsos = []; // [{id,type,ra,dec,mag,size,messier,common}, ...]

  // Tile-based tier-1/2 cache. Each entry:
  //   { tier, key, stars, entries (parallel to stars), attached (bool), lastUsed }
  // `entries` is null until built; once built, each element is the same shape
  // as a _starMarkers entry (see buildStarEntry).
  const _tileCache = new Map(); // key = `${tier}:${ra}-${dec}`
  let _tileManifest = null; // { raBins, decBins, raStep, decStep, tiers:{1:{...},2:{...}} }
  const _tileInFlight = new Map(); // key -> Promise (dedup concurrent fetches)
  const TILE_LRU_LIMIT = 96; // max cached tiles across all tiers

  let _linesW = null; // GeoJSON FC
  let _linesC = null;
  let _boundsW = null;
  let _namesW = null;
  let _namesC = null;

  // Leaflet primitives
  let _starsLayer = null; // L.LayerGroup of CircleMarker
  let _dsoLayer = null; // L.LayerGroup of DSO markers

  let _iauLines = null;
  let _iauBounds = null;
  let _iauNames = null; // constellation labels (rank ≤ 3)
  let _iauStarLabels = null; // per-star Latin labels (Sirius, Vega, …)

  let _cnLines = null;
  let _cnNames = null; // xingguan labels
  let _cnStarLabels = null; // per-star Chinese labels (天狼星, 织女一, …)

  let _starsStarLabels = null; // proper-name labels for stars-only mode (Pollux / 北河三)
  let _currentZoom = null; // updated from map.zoomend; drives label density

  // Star marker metadata: parallel array index aligned with _stars order
  const _starMarkers = [];
  // Per-feature Leaflet primitive caches (kept across update() calls)
  const _iauLineCache = new Map(); // featureId -> [Polyline, ...]
  const _cnLineCache = new Map();
  const _iauBoundsCache = new Map(); // featureId -> [Polygon, ...]
  const _iauNameCache = new Map(); // constellation labels
  const _cnNameCache = new Map();
  const _iauStarLabelCache = new Map(); // star index -> [Marker copies]
  const _cnStarLabelCache = new Map();
  const _starsStarLabelCache = new Map();

  // ---- i18n ----
  const I18N = { locale: 'zh-Hans', dicts: { iau: {}, cn: {}, stars: {} }, locales: ['zh-Hans'] };
  // Sorted xingguan name prefixes (longest first) for stripping in map labels.
  let _xgPrefixes = [];
  let _xgSuppressed = new Set();
  // Maps localized xingguan meaning → pinyin, built from the cn constellation dict.
  // Used to convert alias display from "2 Northern Pole" → "2 Beiji" in parentheticals.
  let _cnMeaningToPinyin = {};

  async function loadLocale(locale) {
    const target = locale || 'zh-Hans';
    // Helper: try locale-specific file, fall back to zh-Hans.
    async function fetchOrFallback(path, fallbackPath) {
      try {
        const r = await fetch(path);
        if (r.ok) return r.json();
      } catch (_) {}
      return fetch(fallbackPath).then((r) => r.json());
    }
    // IAU constellation names only exist for zh-Hans; other locales fall back.
    // CN constellation labels and star names have per-locale files.
    const [iau, cn, stars] = await Promise.all([
      fetchOrFallback(
        `data/sky/i18n/${target}/constellations.iau.json`,
        'data/sky/i18n/zh-Hans/constellations.iau.json'
      ),
      fetchOrFallback(
        `data/sky/i18n/${target}/constellations.cn.json?v=1`,
        'data/sky/i18n/zh-Hans/constellations.cn.json?v=1'
      ),
      fetchOrFallback(`data/sky/i18n/${target}/stars.json?v=1`, 'data/sky/i18n/zh-Hans/stars.json?v=1'),
    ]);
    I18N.locale = target;
    I18N.dicts = { iau, cn, stars };
    // Build sorted xingguan prefix list (longest first) for label stripping.
    // Include both constellation labels (from cn dict) and pinyin prefixes
    // extracted from star names (handles non-CJK locales where cn dict has
    // English names like "Wall" but star names use pinyin like "Bi").
    const names = new Set(Object.values(cn).map((v) => _pinyinOf(v)));
    for (const sv of Object.values(stars)) {
      const pv = _pinyinOf(sv);
      // "N Prefix" → extract Prefix
      const m1 = pv.match(/^\d+[A-Za-z]?\s+(.+)$/);
      if (m1) {
        names.add(m1[1]);
        continue;
      }
      // "Added N Prefix" → extract Prefix
      const m2 = pv.match(/^(?:Added|Ajouté|Añadido)\s+\d+\s+(.+)$/);
      if (m2) {
        names.add(m2[1]);
        continue;
      }
    }
    _xgPrefixes = [...names].sort((a, b) => b.length - a.length);
    // Build meaning→pinyin reverse map for alias display ("Northern Pole"→"Beiji").
    // Only populated for locales where cn dict uses "Pinyin|Meaning" format.
    _cnMeaningToPinyin = {};
    for (const v of Object.values(cn)) {
      const bar = v.indexOf('|');
      if (bar >= 0) _cnMeaningToPinyin[v.substring(bar + 1)] = v.substring(0, bar);
    }
    // Xingguan names that also appear verbatim as a star name — the star label
    // already covers these, so the xingguan constellation label is redundant.
    const starNameSet = new Set();
    for (const v of Object.values(stars)) {
      const pv = _pinyinOf(v);
      starNameSet.add(pv);
      const c = pv.indexOf('，');
      if (c >= 0) starNameSet.add(pv.substring(0, c));
    }
    _xgSuppressed = new Set();
    for (const [id, xgName] of Object.entries(cn)) {
      if (starNameSet.has(_pinyinOf(xgName))) _xgSuppressed.add(id);
    }
  }

  // Translate IAU 3-letter code → localized name.
  function tConst(code) {
    return (code && I18N.dicts.iau[code]) || code || '';
  }

  // Extract pinyin (before |) or meaning (after |) from "pinyin|meaning" values.
  // Plain values (no pipe) are returned as-is from either accessor.
  function _pinyinOf(val) {
    if (!val) return val;
    const p = val.indexOf('|');
    return p >= 0 ? val.substring(0, p) : val;
  }

  function _meaningOf(val) {
    if (!val) return null;
    const p = val.indexOf('|');
    return p >= 0 ? val.substring(p + 1) : null;
  }

  function tXingguan(id) {
    return _pinyinOf((id && I18N.dicts.cn[id]) || id || '');
  }

  function tXingguanMeaning(id) {
    return _meaningOf(id && I18N.dicts.cn[id]);
  }

  // Latin / scientific designation: proper name (Sirius) → Bayer-Flamsteed
  // with localized constellation (大犬座 α) → catalog ID. Always returns a
  // non-empty string.
  const BAYER_FULL = {
    Alp: 'Alpha',
    Bet: 'Beta',
    Gam: 'Gamma',
    Del: 'Delta',
    Eps: 'Epsilon',
    Zet: 'Zeta',
    Eta: 'Eta',
    The: 'Theta',
    Iot: 'Iota',
    Kap: 'Kappa',
    Lam: 'Lambda',
    Mu: 'Mu',
    Nu: 'Nu',
    Xi: 'Xi',
    Omi: 'Omicron',
    Pi: 'Pi',
    Rho: 'Rho',
    Sig: 'Sigma',
    Tau: 'Tau',
    Ups: 'Upsilon',
    Phi: 'Phi',
    Chi: 'Chi',
    Psi: 'Psi',
    Ome: 'Omega',
  };

  const CONST_GEN = {
    And: 'Andromedae',
    Ant: 'Antliae',
    Aps: 'Apodis',
    Aqr: 'Aquarii',
    Aql: 'Aquilae',
    Ara: 'Arae',
    Ari: 'Arietis',
    Aur: 'Aurigae',
    Boo: 'Boötis',
    Cae: 'Caeli',
    Cam: 'Camelopardalis',
    Cnc: 'Cancri',
    CVn: 'Canum Venaticorum',
    CMa: 'Canis Majoris',
    CMi: 'Canis Minoris',
    Cap: 'Capricorni',
    Car: 'Carinae',
    Cas: 'Cassiopeiae',
    Cen: 'Centauri',
    Cep: 'Cephei',
    Cet: 'Ceti',
    Cha: 'Chamaeleontis',
    Cir: 'Circini',
    Col: 'Columbae',
    Com: 'Comae Berenices',
    CrA: 'Coronae Australis',
    CrB: 'Coronae Borealis',
    Crv: 'Corvi',
    Crt: 'Crateris',
    Cru: 'Crucis',
    Cyg: 'Cygni',
    Del: 'Delphini',
    Dor: 'Doradus',
    Dra: 'Draconis',
    Equ: 'Equulei',
    Eri: 'Eridani',
    For: 'Fornacis',
    Gem: 'Geminorum',
    Gru: 'Gruis',
    Her: 'Herculis',
    Hor: 'Horologii',
    Hya: 'Hydrae',
    Hyi: 'Hydri',
    Ind: 'Indi',
    Lac: 'Lacertae',
    Leo: 'Leonis',
    LMi: 'Leonis Minoris',
    Lep: 'Leporis',
    Lib: 'Librae',
    Lup: 'Lupi',
    Lyn: 'Lyncis',
    Lyr: 'Lyrae',
    Men: 'Mensae',
    Mic: 'Microscopii',
    Mon: 'Monocerotis',
    Mus: 'Muscae',
    Nor: 'Normae',
    Oct: 'Octantis',
    Oph: 'Ophiuchi',
    Ori: 'Orionis',
    Pav: 'Pavonis',
    Peg: 'Pegasi',
    Per: 'Persei',
    Phe: 'Phoenicis',
    Pic: 'Pictoris',
    Psc: 'Piscium',
    PsA: 'Piscis Austrini',
    Pup: 'Puppis',
    Pyx: 'Pyxidis',
    Ret: 'Reticuli',
    Sge: 'Sagittae',
    Sgr: 'Sagittarii',
    Sco: 'Scorpii',
    Scl: 'Sculptoris',
    Sct: 'Scuti',
    Ser: 'Serpentis',
    Sex: 'Sextantis',
    Tau: 'Tauri',
    Tel: 'Telescopii',
    Tri: 'Trianguli',
    TrA: 'Trianguli Australis',
    Tuc: 'Tucanae',
    UMa: 'Ursae Majoris',
    UMi: 'Ursae Minoris',
    Vel: 'Velorum',
    Vir: 'Virginis',
    Vol: 'Volantis',
    Vul: 'Vulpeculae',
  };

  function tStarLatin(star) {
    if (!star) return '';
    if (star.proper) return star.proper;
    if (star.bf) {
      const m = star.bf.match(/^\s*(\d*)\s*([A-Z][a-z]{1,3})?\s*(\d*)\s*(\w{2,3})\s*$/);
      if (m) {
        const [, flam, bayer, suffix, code] = m;
        const gen = CONST_GEN[code];
        if (gen) {
          if (bayer && BAYER_FULL[bayer]) {
            const sup = suffix ? suffix.replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]) : '';
            return `${BAYER_FULL[bayer]}${sup} ${gen}`;
          }
          if (flam) return `${flam} ${gen}`;
        }
      }
      // Lowercase single-letter Bayer (Lacaille): "p Car", "9i  Per"
      const lc = star.bf.match(/^\s*(\d*)\s*([a-z])\d?\s+(\w{2,3})\s*$/);
      if (lc) {
        const gen = CONST_GEN[lc[3]];
        if (gen) return lc[1] ? `${lc[2]} ${gen} (${lc[1]})` : `${lc[2]} ${gen}`;
      }
      const fb = star.bf.match(/^(\S+)\s+(\w{3})\s*$/);
      if (fb) return `${tConst(fb[2])} ${fb[1]}`;
      return star.bf;
    }
    if (star.hip) return `HIP ${star.hip}`;
    if (star.hd) return `HD ${star.hd}`;
    return `★${star.id}`;
  }

  // CJK-formatted designation: "巨蟹座 σ³" / "御夫座 16"
  function tStarCJKDesig(star) {
    if (!star || !star.bf) return null;
    const m = star.bf.match(/^\s*(\d*)\s*([A-Z][a-z]{1,3})?\s*(\d*)\s*(\w{2,3})\s*$/);
    if (m) {
      const [, flam, bayer, suffix, code] = m;
      const constName = tConst(code);
      if (!constName || constName === code) return null;
      if (bayer && BAYER_ABBR[bayer]) {
        const sup = suffix ? suffix.replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]) : '';
        return `${constName} ${BAYER_ABBR[bayer]}${sup}`;
      }
      if (flam) return `${constName} ${flam}`;
      return null;
    }
    // Lowercase single-letter Bayer (Lacaille): "p Car", "9i  Per"
    const lc = star.bf.match(/^\s*(\d*)\s*([a-z])\d?\s+(\w{2,3})\s*$/);
    if (lc) {
      const constName = tConst(lc[3]);
      if (constName && constName !== lc[3]) return `${constName} ${lc[2]}`;
    }
    return null;
  }

  // Bayer-letter only (single Greek char) extracted from HYG's `bf` field.
  // HYG encodes Bayer-Flamsteed designations as ASCII abbreviations like
  // "9Alp CMa" (= Flamsteed 9, α CMa) or "10Bet CMi" (= 10, β CMi). We want
  // just the Greek letter for on-map labels. Returns null when the star has
  // no Bayer designation (Flamsteed-only entries like "60 Tau" yield null).
  const BAYER_ABBR = {
    Alp: 'α',
    Bet: 'β',
    Gam: 'γ',
    Del: 'δ',
    Eps: 'ε',
    Zet: 'ζ',
    Eta: 'η',
    The: 'θ',
    Iot: 'ι',
    Kap: 'κ',
    Lam: 'λ',
    Mu: 'μ',
    Nu: 'ν',
    Xi: 'ξ',
    Omi: 'ο',
    Pi: 'π',
    Rho: 'ρ',
    Sig: 'σ',
    Tau: 'τ',
    Ups: 'υ',
    Phi: 'φ',
    Chi: 'χ',
    Psi: 'ψ',
    Ome: 'ω',
  };

  const SUPERSCRIPT_DIGITS = { 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  function tStarBayer(star) {
    if (!star || !star.bf) return null;
    // Pattern A: optional Flamsteed digits + Bayer abbr + optional component digit + IAU code
    // e.g. "Alp Cen", "Alp1Cen", "Alp2Cen"
    const m = star.bf.match(/^\s*\d*\s*([A-Z][a-z]{1,3})(\d?)\s*\w{3}\s*$/);
    if (m && BAYER_ABBR[m[1]]) {
      const sup = m[2] ? SUPERSCRIPT_DIGITS[m[2]] || '' : '';
      return BAYER_ABBR[m[1]] + sup;
    }
    // Pattern B: already a single Greek letter (some HYG entries)
    const g = star.bf.match(/^\s*([α-ω])(\d?)\s*\w{3}\s*$/);
    if (g) {
      const sup = g[2] ? SUPERSCRIPT_DIGITS[g[2]] || '' : '';
      return g[1] + sup;
    }
    // Pattern C: lowercase single-letter Bayer (Lacaille), e.g. "p Car", "9i Per"
    const lc = star.bf.match(/^\s*\d*\s*([a-z])\d?\s+\w{3}\s*$/);
    if (lc) return lc[1];
    // Pattern D: Flamsteed number only, e.g. "27    Tau"
    const fl = star.bf.match(/^\s*(\d+)\s+\w{3}\s*$/);
    if (fl) return fl[1];
    return null;
  }

  // Star name from locale dict (pinyin half of "pinyin|meaning", or plain zh-Hans).
  // Comma-joined entries ("西上相，太微右垣五") → return only the first part.
  function tStarChinese(star) {
    if (!star || !star.hip) return null;
    const raw = I18N.dicts.stars[star.hip] || null;
    if (!raw) return null;
    const val = _pinyinOf(raw);
    const comma = val.indexOf('，');
    return comma >= 0 ? val.substring(0, comma) : val;
  }

  // Meaning half of the star dict entry (after |), or null.
  function tStarMeaning(star) {
    if (!star || !star.hip) return null;
    const raw = I18N.dicts.stars[star.hip] || null;
    if (!raw) return null;
    const m = _meaningOf(raw);
    if (!m) return null;
    const comma = m.indexOf('，');
    return comma >= 0 ? m.substring(0, comma) : m;
  }

  // Return the xingguan-numbered suffix after "，" (e.g. "太微右垣五"),
  // or null if the entry has no comma-joined alternate name.
  // NOTE: must search for ，in the raw string *before* applying _pinyinOf,
  // because non-CJK entries have the format "pinyin|meaning，alias" where
  // _pinyinOf would truncate at "|" and miss everything after "，".
  function tStarXingguanSuffix(star) {
    if (!star || !star.hip) return null;
    const raw = I18N.dicts.stars[star.hip] || null;
    if (!raw) return null;
    const comma = raw.indexOf('，');
    if (comma < 0) return null;
    // Return the pinyin/display form of each alias segment joined by ，
    return (
      raw
        .substring(comma + 1)
        .split('，')
        .map((s) => _pinyinOf(s.trim()))
        .join('，') || null
    );
  }

  // Convert a single alias segment from its meaning form to pinyin for display
  // in the star-name parenthetical. Works for Latin locales only; CJK aliases
  // (no \d+ prefix) pass through unchanged.
  // Examples: "2 Northern Pole" → "2 Beiji", "Added 14 Net" → "Added 14 Bi"
  function _aliasDisplayPinyin(alias) {
    const m =
      alias.match(/^(\d+[A-Za-z]?)\s+(.+)$/) || alias.match(/^((?:Added|Ajouté|Añadido)\s+\d+[A-Za-z]?)\s+(.+)$/);
    if (!m) return alias;
    const py = _cnMeaningToPinyin[m[2]];
    return py ? `${m[1]} ${py}` : alias;
  }

  // Short label for CN-mode map display: strip the xingguan name prefix,
  // returning only the number suffix (e.g. "参宿三"→"三", "Bond 1"→"1").
  // Stars without a recognisable xingguan+number pattern (e.g. "西上相",
  // For map labels: strip xingguan prefix, return only the number/suffix.
  // Handles both Chinese ("参宿三"→"三") and pinyin ("2 Bi"→"2") formats.
  function tStarCnLabel(star) {
    let full = tStarChinese(star);
    if (!full) return null;
    const comma = full.indexOf('，');
    if (comma >= 0) full = full.substring(0, comma);

    // Pinyin format: "N Prefix" or "NA Prefix" — number(+letter) before prefix
    const numFirst = full.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
    if (numFirst) {
      for (const prefix of _xgPrefixes) {
        if (numFirst[2] === prefix) return numFirst[1];
      }
    }
    // "Added N Prefix" format — strip trailing xingguan name
    const zengMatch = full.match(/^((?:Added|Ajouté|Añadido)\s+\d+)\s+(.+)$/);
    if (zengMatch) {
      for (const prefix of _xgPrefixes) {
        if (zengMatch[2] === prefix) return zengMatch[1];
      }
    }

    // Chinese format: prefix + numeral suffix (optional Latin letter, e.g. 二A)
    for (const prefix of _xgPrefixes) {
      if (!full.startsWith(prefix)) continue;
      const rest = full.substring(prefix.length);
      if (!rest) break;
      const trimmed = rest.replace(/^\s+/, '');
      if (!trimmed) break;
      if (/^[增一二三四五六七八九十廿卅]+[A-Za-z]?$/.test(trimmed)) return trimmed;
      if (/^(Added\s+)?\d+[A-Za-z]?$/.test(trimmed)) return trimmed;
      break;
    }
    return full;
  }

  function tStar(star) {
    const preferCJK = typeof I18n !== 'undefined' && I18n.isZhOrJa();
    if (preferCJK) return tStarChinese(star) || tStarLatin(star);
    // For non-CJK: prefer proper name, then xingguan English name (from
    // locale-specific stars dict), then Bayer/Flamsteed, then catalog ID.
    if (star && star.proper) return star.proper;
    return tStarChinese(star) || tStarLatin(star) || '';
  }

  // ---- Core math ----
  function gmstDeg(date) {
    // Astronomy Engine returns Greenwich Apparent Sidereal Time (hours) — close
    // enough to true GMST for sub-arcminute work.
    return Astronomy.SiderealTime(date) * 15;
  }

  function wrap180(x) {
    return ((x + 540) % 360) - 180;
  }

  function subStellar(raDeg, decDeg, gmst) {
    return [decDeg, wrap180(raDeg - gmst)];
  }

  // Feature-level viewport culling for updateLineFC / updateBoundsFC: pre-bake an
  // (RA, Dec) bbox onto each GeoJSON feature so the per-frame skip is a cheap
  // 4-number comparison instead of projecting every segment.
  //
  // RA-wrap handling: a feature like Pisces spans RA=350°..15° (crosses 0°), where
  // bare min/max would say [0, 360] (whole sky). Detect it via the largest gap in
  // sorted RA; the wrap case is stored with raLo > raHi as the convention.
  function _bakeBboxOnFeature(f) {
    if (!f || !f.geometry) return;
    const raVals = [];
    let decLo = +Infinity,
      decHi = -Infinity;
    function walkRing(ring) {
      for (const pt of ring) {
        // v5: source GeoJSON stores RA in [-180, 180] (Stellarium / d3-celestial
        // convention). Normalize to [0, 360) so the gap-finding wrap detector
        // below and the viewport RA range (also normalized) use the same domain.
        // Without this, the bbox of Sco (RA -120..-93) never overlaps viewport
        // RA [214, 311] → entire Pacific viewport loses constellations.
        let ra = pt[0];
        if (ra < 0) ra += 360;
        const dec = pt[1];
        raVals.push(ra);
        if (dec < decLo) decLo = dec;
        if (dec > decHi) decHi = dec;
      }
    }

    const g = f.geometry;
    if (g.type === 'MultiLineString' || g.type === 'Polygon') {
      for (const ring of g.coordinates) walkRing(ring);
    } else if (g.type === 'LineString') {
      walkRing(g.coordinates);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) for (const ring of poly) walkRing(ring);
    }
    if (!raVals.length) return;
    raVals.sort((a, b) => a - b);
    let maxGap = 0,
      maxGapIdx = -1;
    for (let i = 1; i < raVals.length; i++) {
      const g2 = raVals[i] - raVals[i - 1];
      if (g2 > maxGap) {
        maxGap = g2;
        maxGapIdx = i;
      }
    }
    const wrapGap = raVals[0] + 360 - raVals[raVals.length - 1];
    let raLo, raHi;
    if (wrapGap >= maxGap) {
      raLo = raVals[0];
      raHi = raVals[raVals.length - 1];
    } else {
      // Feature wraps; bbox is [raLo, 360] ∪ [0, raHi] with raLo > raHi.
      raLo = raVals[maxGapIdx];
      raHi = raVals[maxGapIdx - 1];
    }
    f._bbox = { raLo, raHi, decLo, decHi };
  }

  function bakeFeatureBBoxes(fc) {
    if (!fc || !fc.features) return;
    for (const f of fc.features) _bakeBboxOnFeature(f);
  }

  // Compute viewport's RA/Dec bbox via inverse subStellar: ra = lng + gmst.
  // Returns {raLo, raHi, decLo, decHi, all?}. raLo>raHi means viewport wraps
  // RA=0. `all` set when lng span ≥ 360° (low zoom, whole sky).
  function viewportRaDecBox(gmst) {
    if (!_map) return null;
    const b = _map.getBounds();
    const decLo = b.getSouth() - 2;
    const decHi = b.getNorth() + 2;
    const lngSpan = b.getEast() - b.getWest();
    if (lngSpan >= 360) return { raLo: 0, raHi: 360, decLo, decHi, all: true };
    const raLo = (((b.getWest() + gmst) % 360) + 360) % 360;
    const raHi = (((b.getEast() + gmst) % 360) + 360) % 360;
    return { raLo, raHi, decLo, decHi };
  }

  function _bboxOverlaps(fb, vp) {
    if (!fb || !vp) return true; // safety: no bbox → don't cull
    if (vp.all) return fb.decLo <= vp.decHi && fb.decHi >= vp.decLo;
    if (fb.decLo > vp.decHi || fb.decHi < vp.decLo) return false;
    function segs(box) {
      return box.raLo <= box.raHi
        ? [[box.raLo, box.raHi]]
        : [
            [box.raLo, 360],
            [0, box.raHi],
          ];
    }
    const fs = segs(fb),
      vs = segs(vp);
    for (let i = 0; i < fs.length; i++) {
      for (let j = 0; j < vs.length; j++) {
        if (fs[i][0] <= vs[j][1] && fs[i][1] >= vs[j][0]) return true;
      }
    }
    return false;
  }

  // Haversine in degrees.
  function gcDeg(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r;
    const dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / r;
  }

  // World-wrap constants — mirror of js/map.js:15-16. Sky features are
  // rendered as N copies offset by k*360° to cover the wrapped longitude
  // range used by the main map (Carto basemap also tiles across this range).
  const MAP_LNG_WEST = -200;
  const MAP_LNG_EAST = +520;

  // Unwrap a polyline's longitudes so that no two adjacent points differ by
  // more than 180°. Output lons may go outside [-180, +180). This is the
  // core fix for "ghost lines" across the map after substellar transform.
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

  // Return the set of k*360 longitude offsets needed to cover the *visible*
  // wrapped range given a geometry whose longitudes span [minLon, maxLon]
  // after unwrap. R11 §3 viewport culling extended to SVG path renderers:
  // clamp west/east to map viewport ∩ MAP_LNG_WEST/EAST, so at high zoom we
  // only emit polylines for wraps actually visible (z=10: 1 wrap; z=2: 3).
  // Previously this was always ~3 regardless of zoom, which piled up to
  // ~14.7k constellation-line paths at z≥10 — the dominant pan-time cost.
  function wrapOffsets(minLon, maxLon) {
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
    const out = new Array(points.length);
    for (let i = 0; i < points.length; i++) out[i] = [points[i][0], points[i][1] + dLon];
    return out;
  }

  // ---- Style (unified luminosity model v2 — see luminosity.js) ----
  function starRadius(mag) {
    return Lum.coreRadius(Lum.lnB(mag));
  }

  function starOpacity(mag, adaptFactor) {
    return Lum.coreOpacity(Lum.lnB(mag), adaptFactor);
  }

  // ---- OKLab Utilities (Shared by bvTint + spectralTint) ----
  const _cl01 = (x) => Math.max(0, Math.min(1, x));
  const _lin2srgb = (c) => ((c = _cl01(c)), c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  function _oklabToHex(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_,
      m = m_ * m_ * m_,
      s = s_ * s_ * s_;
    const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    const h = (x) =>
      Math.round(_lin2srgb(x) * 255)
        .toString(16)
        .padStart(2, '0');
    return '#' + h(R) + h(G) + h(B);
  }

  function _oklchToLab(L, C, H) {
    const r = (H * Math.PI) / 180;
    return [L, C * Math.cos(r), C * Math.sin(r)];
  }

  function _interpAnchors(anchors, x, chromaScale) {
    x = Math.max(anchors[0][0], Math.min(anchors[anchors.length - 1][0], x));
    let lo = anchors[0],
      hi = anchors[anchors.length - 1];
    for (let i = 0; i < anchors.length - 1; i++) {
      if (x >= anchors[i][0] && x <= anchors[i + 1][0]) {
        lo = anchors[i];
        hi = anchors[i + 1];
        break;
      }
    }
    const t = hi[0] > lo[0] ? (x - lo[0]) / (hi[0] - lo[0]) : 0;
    const L = lo[1] + (hi[1] - lo[1]) * t;
    const a = (lo[2] + (hi[2] - lo[2]) * t) * chromaScale;
    const b = (lo[3] + (hi[3] - lo[3]) * t) * chromaScale;
    return _oklabToHex(L, a, b);
  }

  // ---- Primary: B-V Color Index → Tint via OKLab Interpolation ----
  // Anchors pinned at real B-V breakpoints so K→M spans correctly.
  const _BV_ANCHORS = [
    [-0.35, ..._oklchToLab(0.84, 0.13, 256)],
    [-0.15, ..._oklchToLab(0.88, 0.09, 252)],
    [0.0, ..._oklchToLab(0.94, 0.035, 244)],
    [0.3, ..._oklchToLab(0.95, 0.022, 108)],
    [0.58, ..._oklchToLab(0.92, 0.085, 95)],
    [0.81, ..._oklchToLab(0.83, 0.125, 68)],
    [1.4, ..._oklchToLab(0.74, 0.15, 50)],
    [2.0, ..._oklchToLab(0.66, 0.165, 36)],
  ];

  function bvTint(bv, chromaScale) {
    if (chromaScale === undefined) chromaScale = (Lum.params && Lum.params.chromaScale) || 0.7;
    return _interpAnchors(_BV_ANCHORS, bv, chromaScale);
  }

  // Ballesteros (2012) B-V → effective temperature
  function bvToTeff(bv) {
    return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  }

  // ---- Fallback: Spectral Type String → Tint (for Stars Without B-V) ----
  const _SP_BASE = { W: 0, O: 1, B: 2, A: 3, F: 4, G: 5, K: 6, M: 7 };
  const _SP_ANCH = [
    [0, ..._oklchToLab(0.85, 0.085, 278)],
    [1, ..._oklchToLab(0.84, 0.08, 256)],
    [2, ..._oklchToLab(0.88, 0.055, 252)],
    [3, ..._oklchToLab(0.93, 0.022, 246)],
    [4, ..._oklchToLab(0.94, 0.016, 110)],
    [5, ..._oklchToLab(0.91, 0.055, 96)],
    [6, ..._oklchToLab(0.83, 0.085, 70)],
    [7, ..._oklchToLab(0.75, 0.1, 52)],
    [8, ..._oklchToLab(0.68, 0.11, 38)],
  ];

  function spectralTint(type, chromaScale) {
    if (chromaScale === undefined) chromaScale = (Lum.params && Lum.params.chromaScale) || 0.7;
    const mt = /^([WOBAFGKM])\s*(\d)?/i.exec((type || '').trim());
    if (!mt) return '#e7e3da';
    const letter = mt[1].toUpperCase();
    const n = mt[2] !== undefined ? +mt[2] : 5;
    const p = Math.max(0, Math.min(8, (letter === 'M' ? 7 : _SP_BASE[letter]) + n / 10));
    return _interpAnchors(_SP_ANCH, p, chromaScale);
  }

  // ---- Unified Entry: B-V Preferred, Spectral Type Fallback ----
  function starTint(star, chromaScale) {
    if (chromaScale === undefined) chromaScale = (Lum.params && Lum.params.chromaScale) || 0.7;
    if (Number.isFinite(star.ci)) return bvTint(star.ci, chromaScale);
    if (star.sp) return spectralTint(star.sp, chromaScale);
    return '#e7e3da';
  }

  function starCoreColor(tintHex, mag, zS) {
    if (zS === undefined) zS = 1;
    return Lum.coreColor(tintHex, mag, zS);
  }

  // ---- Data load ----
  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }

  const _dsoMarkers = []; // parallel array aligned with _dsos

  async function loadCore() {
    const [stars, namesW, dsos, manifest] = await Promise.all([
      fetchJson('data/sky/stars.json'),
      fetchJson('data/sky/names.west.json'),
      fetchJson('data/dso/catalog.json').catch(() => []),
      fetchJson('data/sky/tiles/manifest.json').catch(() => null),
    ]);
    _stars = stars;
    _tileManifest = manifest;
    _starById.clear();
    for (const s of stars) _starById.set(s.id, s);
    _namesW = namesW;
    _dsos = dsos;
    const initLocale = typeof I18n !== 'undefined' ? I18n.getLocale() : 'zh-Hans';
    await loadLocale(initLocale);
  }

  async function loadIau() {
    if (_loaded.iau) return;
    const [lines, bounds] = await Promise.all([
      fetchJson('data/sky/lines.west.geojson'),
      fetchJson('data/sky/bounds.west.geojson'),
    ]);
    _linesW = lines;
    _boundsW = bounds;
    bakeFeatureBBoxes(_linesW);
    bakeFeatureBBoxes(_boundsW);
    _loaded.iau = true;
  }

  async function loadCn() {
    if (_loaded.cn) return;
    const [lines, names] = await Promise.all([
      fetchJson('data/sky/lines.cn.geojson'),
      fetchJson('data/sky/names.cn.json'),
    ]);
    _linesC = lines;
    _namesC = names;
    bakeFeatureBBoxes(_linesC);
    _loaded.cn = true;
  }

  // World-wrap copies for star markers: we materialise N CircleMarkers per
  // star (one per k*360 offset) so the same star appears at lon, lon±360, …
  // matching the main map's [-200°, +520°] wrap.
  // 5 wraps cover the full map maxBounds (-200° to +520°, i.e. 720°).
  // 3 wraps left a gap near the east/west edges of the map's pannable range.
  const STAR_COPY_OFFSETS = [-720, -360, 0, +360, +720];

  // Zoom-adaptive magnitude cutoff for STAR DOTS. Mirrors the label cutoff
  // but is one magnitude more permissive — dots fill in before names appear.
  // Above zoom 6 we cross into tier-1 (mag 6–8) and tier-2 (mag 8–10), which
  // are viewport-loaded — see refreshViewTiles().
  // Day-mode reads body.day-mask-active set by map.js when the white
  // day-veil overlay is on the map. Used to drop both star and label
  // mag cutoffs by 1 — the dim end disappears in daylight, matching the
  // physical "sky brightness washes out the faintest stars first".
  function _isDayMode() {
    return typeof document !== 'undefined' && document.body && document.body.classList.contains('day-mask-active');
  }

  function magCutoffForStarMarkers(zoom) {
    // Low-zoom cutoff 6.0 (naked-eye dark-sky limit). tier-0 covers mag≤6, so no
    // extra network fetch; ~3300 dim-end stars become attached at z=2-4.
    let base;
    if (zoom == null || zoom <= 5) base = 6.0;
    else if (zoom <= 6) base = 6.0;
    else if (zoom <= 7) base = 7.5;
    else if (zoom <= 8) base = 9.0;
    else base = 10.0;
    // Day veil cuts the dimmest tier — dim stars wash out first in a bright sky
    // (the mask gradient handles the soft twilight falloff; this is the hard tail).
    if (_isDayMode()) base -= 1.0;
    return base;
  }

  // Click-mag cutoff by zoom: stars dimmer than this are drawn but excluded from
  // the canvas hit table (so "dust" stars at low zoom don't eat pointer events).
  function magCutoffForStarClicks(zoom) {
    if (zoom == null || zoom <= 5) return 4.0;
    if (zoom <= 6) return 5.0;
    if (zoom <= 7) return 7.5;
    return magCutoffForStarMarkers(zoom);
  }

  // Prefix length: _starMarkers[0..count) currently have their copies attached
  // to _starsLayer. Since _stars is sorted ascending by magnitude, the
  // mag-≤-cutoff working set is always a prefix — no per-star scanning needed.
  let _attachedCount = 0;

  function applyStarVisibility(cutoff) {
    if (!_starsLayer || _starMarkers.length === 0) return;
    // Binary search for the first star with mag > cutoff.
    let lo = 0,
      hi = _starMarkers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (_starMarkers[mid].star.mag <= cutoff) lo = mid + 1;
      else hi = mid;
    }
    const newCount = lo;
    if (newCount === _attachedCount) return;
    // No DOM mutation — canvas reads _attachedCount on next redraw.
    _attachedCount = newCount;
    _redrawCanvas();
  }

  // ---- Tile-Based Loading for Tier-1 (mag 6-8) and Tier-2 (mag 8-10) ----

  // RA window covered by viewport (in 0..360 degrees), computed from lng+gmst.
  // Returns one or two [raLo, raHi] segments; two when the window wraps the
  // 360→0 boundary. raLo < raHi always.
  function _viewportRaSegments(lngMin, lngMax, gmst) {
    const span = lngMax - lngMin;
    if (span >= 360) return [[0, 360]];
    let lo = (((lngMin + gmst) % 360) + 360) % 360;
    let hi = lo + span;
    if (hi <= 360) return [[lo, hi]];
    return [
      [lo, 360],
      [0, hi - 360],
    ];
  }

  function tilesIntersecting(bounds, gmst) {
    if (!_tileManifest) return [];
    const { raBins, decBins, raStep, decStep } = _tileManifest;
    const pad = 5;
    const latMin = Math.max(-90, bounds.getSouth() - pad);
    const latMax = Math.min(90, bounds.getNorth() + pad);
    const lngMin = bounds.getWest() - pad;
    const lngMax = bounds.getEast() + pad;

    let decLo = Math.floor((latMin + 90) / decStep);
    let decHi = Math.floor((latMax + 90) / decStep);
    if (decLo < 0) decLo = 0;
    if (decHi >= decBins) decHi = decBins - 1;

    const segs = _viewportRaSegments(lngMin, lngMax, gmst);
    const raIdxSet = new Set();
    for (const [a, b] of segs) {
      let lo = Math.floor(a / raStep);
      let hi = Math.floor((b - 1e-9) / raStep);
      if (lo < 0) lo = 0;
      if (hi >= raBins) hi = raBins - 1;
      for (let i = lo; i <= hi; i++) raIdxSet.add(i);
    }

    const out = [];
    for (const ra of raIdxSet) {
      for (let dec = decLo; dec <= decHi; dec++) out.push([ra, dec]);
    }
    return out;
  }

  function _tileKey(tier, ra, dec) {
    return `${tier}:${ra}-${dec}`;
  }

  async function _fetchTile(tier, ra, dec) {
    const key = _tileKey(tier, ra, dec);
    if (_tileInFlight.has(key)) return _tileInFlight.get(key);
    const tierInfo = _tileManifest.tiers[tier];
    const tileKey2 = `${ra}-${dec}`;
    if (!tierInfo || !tierInfo.tiles[tileKey2]) return null; // empty/missing tile
    const p = fetchJson(`data/sky/tiles/m${tier}/${tileKey2}.json`)
      .then((stars) => {
        const entry = {
          tier,
          key,
          stars,
          entries: null, // marker entries built lazily
          attached: false,
          lastUsed: performance.now(),
        };
        _tileCache.set(key, entry);
        for (const s of stars) _starById.set(s.id, s);
        return entry;
      })
      .catch((err) => {
        console.warn('tile fetch failed', key, err);
        return null;
      })
      .finally(() => {
        _tileInFlight.delete(key);
      });
    _tileInFlight.set(key, p);
    return p;
  }

  // Partial build. tile.entries is a sparse array parallel to tile.stars,
  // null where the star is above the current cutoff. Lazily filled as cutoff
  // expands. Cuts first-attach cost roughly in half on tier-2 tiles.
  function _attachTileEntry(tileEntry, cutoff) {
    if (!tileEntry.entries) {
      tileEntry.entries = new Array(tileEntry.stars.length).fill(null);
    }
    const justAttached = [];
    // Tile stars are mag-sorted (ascending) so we can short-circuit once we
    // pass the cutoff — but still need to walk further to detach previously-
    // attached entries that are now above cutoff. Two-pass keeps it simple.
    for (let i = 0; i < tileEntry.stars.length; i++) {
      const s = tileEntry.stars[i];
      let e = tileEntry.entries[i];
      if (s.mag > cutoff) {
        // Detach if previously attached at a more permissive cutoff.
        if (e && e._attached) {
          for (const m of e.copies) _starsLayer.removeLayer(m);
          if (e.glowMarkers) for (const m of e.glowMarkers) _starsLayer.removeLayer(m);
          if (e.glareMarkers) for (const m of e.glareMarkers) _starsLayer.removeLayer(m);
          e._attached = false;
        }
        continue;
      }
      if (!e) {
        e = buildStarEntry(s);
        tileEntry.entries[i] = e;
      }
      if (e._attached) continue;
      if (e.glareMarkers) for (const m of e.glareMarkers) _starsLayer.addLayer(m);
      if (e.glowMarkers) for (const m of e.glowMarkers) _starsLayer.addLayer(m);
      for (const m of e.copies) _starsLayer.addLayer(m);
      e._attached = true;
      justAttached.push(e);
    }
    tileEntry.attached = true;
    tileEntry.lastUsed = performance.now();
    if (justAttached.length) _redrawCanvas();
  }

  function _detachTileEntry(tileEntry) {
    if (!tileEntry.attached || !tileEntry.entries) {
      tileEntry.attached = false;
      return;
    }
    for (const e of tileEntry.entries) {
      if (!e || !e._attached) continue; // entries are sparse
      e._attached = false;
    }
    tileEntry.attached = false;
    _redrawCanvas();
  }

  function _evictLRU() {
    if (_tileCache.size <= TILE_LRU_LIMIT) return;
    const arr = [..._tileCache.values()].filter((e) => !e.attached);
    arr.sort((a, b) => a.lastUsed - b.lastUsed);
    let toDrop = _tileCache.size - TILE_LRU_LIMIT;
    for (const e of arr) {
      if (toDrop <= 0) break;
      // Free entries so GC can reclaim
      if (e.entries) {
        for (const ent of e.entries) {
          if (!ent) continue; // entries are sparse
          for (const m of ent.copies) m.off();
          if (ent.glowMarkers) ent.glowMarkers.length = 0;
          if (ent.glareMarkers) ent.glareMarkers.length = 0;
        }
      }
      // Drop _starById entries that came from this tile
      for (const s of e.stars) {
        if (_starById.get(s.id) === s) _starById.delete(s.id);
      }
      _tileCache.delete(e.key);
      toDrop--;
    }
  }

  // Tier required to satisfy given mag cutoff: 0 if cutoff<=6, 1 if <=8, else 2.
  function _maxTierForCutoff(cutoff) {
    if (cutoff <= 6) return 0;
    if (cutoff <= 8) return 1;
    return 2;
  }

  let _refreshSeq = 0;

  // Called from update(): ensure all (tier, tile) cells intersecting the
  // current viewport are loaded and attached, with marker prefix matching
  // the current adapted mag cutoff. Detaches tiles that have moved out.
  function refreshViewTiles(cutoff, gmst) {
    if (!_map || !_starsLayer || !_tileManifest) return;
    const maxTier = _maxTierForCutoff(cutoff);

    // Which tiles do we need right now?
    const need = new Set();
    if (maxTier >= 1) {
      const tiles = tilesIntersecting(_map.getBounds(), gmst);
      for (const [ra, dec] of tiles) {
        need.add(_tileKey(1, ra, dec));
        if (maxTier >= 2) need.add(_tileKey(2, ra, dec));
      }
    }

    // Detach tiles no longer needed
    for (const entry of _tileCache.values()) {
      if (entry.tier > maxTier || !need.has(entry.key)) {
        if (entry.attached) _detachTileEntry(entry);
      }
    }

    // Attach + fetch tiles we need. For cached tiles, attach immediately.
    const toFetch = [];
    for (const key of need) {
      const cached = _tileCache.get(key);
      if (cached) {
        _attachTileEntry(cached, cutoff);
      } else if (!_tileInFlight.has(key)) {
        const [tierStr, raDec] = key.split(':');
        const [ra, dec] = raDec.split('-').map(Number);
        toFetch.push([Number(tierStr), ra, dec]);
      }
    }

    if (toFetch.length) {
      const mySeq = ++_refreshSeq;
      Promise.all(toFetch.map(([t, r, d]) => _fetchTile(t, r, d))).then((results) => {
        // Stale-guard: if another refresh fired since, skip eager-attach entirely
        // and let the trailing update() below run a fresh refreshViewTiles, which
        // will attach from cache only what the current view actually wants and
        // detach the rest (preventing dim tiles from leaking onto low-zoom views).
        const stale = mySeq !== _refreshSeq;
        for (const entry of results) {
          if (!entry) continue;
          if (stale || !need.has(entry.key)) continue;
          _attachTileEntry(entry, cutoff);
        }
        _evictLRU();
        // Just request a canvas redraw; the canvas reads _lastGmst and walks
        // attached entries itself.
        _redrawCanvas();
      });
    }

    _evictLRU();
  }

  // Coalesce rapid update() calls into one refresh per animation frame — without
  // this, repeated zoom/move/time events each trigger a full refreshViewTiles.
  let _refreshHandle = null;
  let _pendingRefresh = null;
  function scheduleRefreshViewTiles(cutoff, gmst) {
    _pendingRefresh = { cutoff, gmst };
    if (_refreshHandle != null) return;
    _refreshHandle = requestAnimationFrame(() => {
      _refreshHandle = null;
      const p = _pendingRefresh;
      _pendingRefresh = null;
      if (p) refreshViewTiles(p.cutoff, p.gmst);
    });
  }

  // Iterate every currently-attached tile marker entry (callback receives the
  // entry, identical shape to _starMarkers items).
  function forEachAttachedTileEntry(cb) {
    for (const tile of _tileCache.values()) {
      if (!tile.attached || !tile.entries) continue;
      for (const e of tile.entries) if (e && e._attached) cb(e); // sparse
    }
  }

  // ---- Zoom-adaptive visibility (declutter spec) ----
  // Hide secondary elements at low zoom to keep the sky skeleton clean.
  function applyZoomVisibility() {
    const z = _currentZoom;
    // Boundaries: hide at z < 4
    if (_iauBounds) {
      if (z < 4 && _map.hasLayer(_iauBounds)) _map.removeLayer(_iauBounds);
      else if (z >= 4 && _mode === 'iau' && !_map.hasLayer(_iauBounds) && !_overlaysSuppressed)
        _map.addLayer(_iauBounds);
    }
    // DSO: hide at z < 5
    if (_dsoLayer) {
      if (z < 5 && _map.hasLayer(_dsoLayer)) _map.removeLayer(_dsoLayer);
      else if (z >= 5 && _mode !== 'off' && !_map.hasLayer(_dsoLayer)) _map.addLayer(_dsoLayer);
    }
    // Constellation name labels + star labels: hide at z < 4
    if (_iauNames) {
      if (z < 4 && _map.hasLayer(_iauNames)) _map.removeLayer(_iauNames);
      else if (z >= 4 && _mode === 'iau' && !_map.hasLayer(_iauNames) && !_overlaysSuppressed) _map.addLayer(_iauNames);
    }
    if (_iauStarLabels) {
      if (z < 4 && _map.hasLayer(_iauStarLabels)) _map.removeLayer(_iauStarLabels);
      else if (z >= 4 && _mode === 'iau' && !_map.hasLayer(_iauStarLabels) && !_overlaysSuppressed)
        _map.addLayer(_iauStarLabels);
    }
    if (_cnNames) {
      if (z < 4 && _map.hasLayer(_cnNames)) _map.removeLayer(_cnNames);
      else if (z >= 4 && _mode === 'cn' && !_map.hasLayer(_cnNames) && !_overlaysSuppressed) _map.addLayer(_cnNames);
    }
    if (_cnStarLabels) {
      if (z < 4 && _map.hasLayer(_cnStarLabels)) _map.removeLayer(_cnStarLabels);
      else if (z >= 4 && _mode === 'cn' && !_map.hasLayer(_cnStarLabels) && !_overlaysSuppressed)
        _map.addLayer(_cnStarLabels);
    }
    if (_starsStarLabels) {
      if (z < 4 && _map.hasLayer(_starsStarLabels)) _map.removeLayer(_starsStarLabels);
      else if (z >= 4 && _mode === 'stars' && !_map.hasLayer(_starsStarLabels) && !_overlaysSuppressed)
        _map.addLayer(_starsStarLabels);
    }
  }

  // ---- Build / update Leaflet primitives ----

  // PSF sprite cache: each unique glow tint hex maps to one pre-rasterized 64×64
  // sprite, so many <img> with shared srcs composite far cheaper than unique CSS
  // gradients. Cache stays small (OKLab tints quantize to ~200-300 unique hex).
  const PSF_SPRITE_SIZE = 64;
  const _glowSpriteCache = new Map(); // tintHex → dataURL

  function _getGlowSpriteURL(glowTint) {
    let url = _glowSpriteCache.get(glowTint);
    if (url) return url;
    const c = document.createElement('canvas');
    c.width = c.height = PSF_SPRITE_SIZE;
    const ctx = c.getContext('2d');
    const cx = PSF_SPRITE_SIZE / 2,
      cy = cx,
      r = cx;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    // All-tint sprite, alpha-driven. Bright stars' SVG core dot (clipped to
    // white by Lum.coreColor) draws underneath at high alpha and punches
    // through to provide the white core.
    const [r0, g0, b0] = Lum._parseColor(glowTint);
    const R = Math.round(r0 * 255),
      G = Math.round(g0 * 255),
      B = Math.round(b0 * 255);
    grad.addColorStop(0, 'rgba(' + R + ',' + G + ',' + B + ',1)');
    grad.addColorStop(0.35, 'rgba(' + R + ',' + G + ',' + B + ',0.95)');
    grad.addColorStop(0.55, 'rgba(' + R + ',' + G + ',' + B + ',0.55)');
    grad.addColorStop(0.78, 'rgba(' + R + ',' + G + ',' + B + ',0.18)');
    grad.addColorStop(1, 'rgba(' + R + ',' + G + ',' + B + ',0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PSF_SPRITE_SIZE, PSF_SPRITE_SIZE);
    url = c.toDataURL();
    _glowSpriteCache.set(glowTint, url);
    return url;
  }

  // coreCol and coreR retained for signature compat (still used to size the
  // wrapping element), but the sprite itself is tint-only.
  function _makeGlowIcon(coreCol, tint, coreR, glowR, alpha) {
    const url = _getGlowSpriteURL(tint);
    const sz = Math.ceil(glowR * 2);
    return L.divIcon({
      className: 'star-glow',
      html:
        '<img src="' +
        url +
        '" width="' +
        sz +
        '" height="' +
        sz +
        '" style="display:block;opacity:' +
        alpha.toFixed(3) +
        '">',
      iconSize: [sz, sz],
      iconAnchor: [sz / 2, sz / 2],
    });
  }

  function _makeGlareIcon(tint, glareR) {
    const css = Lum.glareGradientCSS(tint, glareR);
    if (!css) return null;
    const sz = Math.ceil(glareR * 2);
    return L.divIcon({
      className: 'star-glare',
      html: '<div style="width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;background:' + css + '"></div>',
      iconSize: [sz, sz],
      iconAnchor: [sz / 2, sz / 2],
    });
  }

  // Construct one star's data entry (canvas-rendered — no marker DOM).
  // Subsequent canvas redraws read these fields each frame.
  // baseOpacity NO LONGER cached — canvas-layer calls Lum.coreOpacity
  // live each redraw so coreFloor changes take effect without reload.
  function buildStarEntry(s) {
    const ln = Lum.lnB(s.mag);
    const visualR = Lum.coreRadius(ln);
    const tint = starTint(s);
    const glowTint = starTint(s, (Lum.params && Lum.params.glowChromaScale) || 1.0);
    const glrR = Lum.glareRadius(ln);
    // Empty arrays / null make all `for (const m of e.copies)` and
    // `if (e.glowMarkers)` branches in legacy code paths no-op without
    // requiring those callsites to be touched.
    return {
      star: s,
      visualR,
      copies: [],
      glowMarkers: null,
      glareMarkers: null,
      _lnB: ln,
      _glareR: glrR,
      _tint: tint,
      _glowTint: glowTint,
      _adaptAf: 1,
    };
  }

  function buildStars() {
    if (!_starsLayer) _starsLayer = _createStarsCanvas();
    if (_starMarkers.length > 0 || _stars.length === 0) return;
    for (let i = 0; i < _stars.length; i++) {
      _starMarkers.push(buildStarEntry(_stars[i]));
    }
    if (_starsLayer && typeof _starsLayer.redraw === 'function') _starsLayer.redraw();
  }

  // Factory for the SkyCanvasLayer instance that replaces the SVG
  // LayerGroup. iterEntries walks tier-0 + tier-1/2 in one shot; getContext
  // pulls the live cutoff / scale / gmst each redraw.
  function _createStarsCanvas() {
    if (typeof SkyCanvasLayer !== 'function' && typeof SkyCanvasLayer !== 'object') {
      // Fallback to LayerGroup if canvas layer didn't load (shouldn't happen).
      console.warn('SkyCanvasLayer unavailable; falling back to LayerGroup');
      return L.layerGroup();
    }
    return new SkyCanvasLayer({
      paneName: 'sky-stars',
      blendMode: 'lighter',
      iterEntries: (cb) => {
        const n = _attachedCount;
        for (let i = 0; i < n; i++) cb(_starMarkers[i]);
        forEachAttachedTileEntry(cb);
      },
      getContext: () => ({
        gmst: _lastGmst,
        cutoff: _lastCutoff,
        scale: _starScale,
        clickMagCutoff: _lastClickCutoff,
      }),
      onClick: (entry, ev) => {
        // Click-merge: prefer brighter co-located tier-0 star.
        let best = entry.star;
        for (let j = 0; j < _stars.length; j++) {
          const o = _stars[j];
          if (o === best) continue;
          if (o.mag >= best.mag) break;
          if (Math.abs(o.ra - best.ra) < 0.01 && Math.abs(o.dec - best.dec) < 0.01) {
            best = o;
            break;
          }
        }
        if (_starClickCb) _starClickCb(best);
        showStarPopup(best, ev.latlng);
        // When the observer compass is active, toggle a great-circle line from
        // the observer to this star's sub-stellar point. (best.ra is in degrees.)
        if (typeof Observer !== 'undefined' && Observer.toggleGreatCircleTo) {
          Observer.toggleGreatCircleTo({
            kind: 'fixed',
            id: 'star:' + best.ra.toFixed(4) + ',' + best.dec.toFixed(4),
            name: best.proper || best.bf || best.name || '',
            star: best, // resolved to the card name (xingguan) at draw time
            raDeg: best.ra,
            dec: best.dec,
          });
        }
      },
      onContextMenu: (entry, ev) => {
        // Same click-merge as onClick — prefer brighter co-located star.
        let best = entry.star;
        for (let j = 0; j < _stars.length; j++) {
          const o = _stars[j];
          if (o === best) continue;
          if (o.mag >= best.mag) break;
          if (Math.abs(o.ra - best.ra) < 0.01 && Math.abs(o.dec - best.dec) < 0.01) {
            best = o;
            break;
          }
        }
        // Show "Visible range" context menu and activate on click.
        if (window._showBodyContextMenu) {
          window._showBodyContextMenu(ev, () => {
            if (window.activateCelestialVis) window.activateCelestialVis(best.ra, best.dec);
          });
        } else if (window.activateCelestialVis) {
          window.activateCelestialVis(best.ra, best.dec);
        }
      },
    });
  }

  // Live context fields read by the canvas getContext callback. Updated by
  // update() / applyStarScale / applyStarVisibility.
  let _lastGmst = 0;
  let _lastCutoff = 6;
  // Separate click-mag cutoff: stars dimmer than this threshold are excluded
  // from the canvas hit table and become non-interactive at low zoom.
  // See magCutoffForStarClicks() and Task 13 of the vis-range plan.
  let _lastClickCutoff = 3.0;

  function _redrawCanvas() {
    if (_starsLayer && typeof _starsLayer.redraw === 'function') _starsLayer.redraw();
  }

  let _starScale = 1;
  // No-op. Canvas reads scale at redraw time; no per-entry DOM mutation.
  function _applyScaleToEntry(e, scale) {
    /* intentionally empty */
  }

  function applyStarScale(zoom) {
    const scale = Lum.zoomScale(zoom);
    if (scale === _starScale) return;
    _starScale = scale;
    // Canvas reads _starScale on next redraw — no need to walk entries.
    // Legacy _applyScaleToEntry walks are no-ops (copies/glowMarkers empty).
    _redrawCanvas();
  }

  // ---- DSO markers ----
  // DSO color by type. GCl must be checked before the generic startsWith('G') guard.
  function dsoColor(type) {
    if (type === 'GCl') return '#FFAA55';
    if (type === 'OCl' || type === 'Cl+N' || type === '*Ass') return '#80C0FF';
    if (type === 'PN') return '#80FFCC';
    if (type === 'G' || (type && type.startsWith('G'))) return '#FFD080';
    return '#AABBDD'; // Neb, HII, SNR, RfN, Other
  }

  // DSO SVG icon HTML string. All icons share stroke-width 1.3 and overflow:visible.
  // Drop-shadow provides the dark outline that text-shadow gave the old Unicode chars.
  function _dsoSvgHtml(type, color) {
    var c = color;
    var ns = 'http://www.w3.org/2000/svg';
    var sh = 'overflow:visible;filter:drop-shadow(0 0 2px rgba(0,0,0,0.9))';
    var sw = ' stroke-width="1.3"';
    // Open cluster / stellar association / cluster+nebula — dashed circle
    if (type === 'OCl' || type === 'Cl+N' || type === '*Ass')
      return (
        '<svg class="dso-sym" xmlns="' +
        ns +
        '" width="14" height="14" viewBox="0 0 14 14" style="' +
        sh +
        '">' +
        '<circle cx="7" cy="7" r="5.5" fill="none" stroke="' +
        c +
        '"' +
        sw +
        ' stroke-dasharray="2.8,1.8"/>' +
        '</svg>'
      );
    // Globular cluster — solid circle + interior cross
    if (type === 'GCl')
      return (
        '<svg class="dso-sym" xmlns="' +
        ns +
        '" width="14" height="14" viewBox="0 0 14 14" style="' +
        sh +
        '">' +
        '<circle cx="7" cy="7" r="5.5" fill="none" stroke="' +
        c +
        '"' +
        sw +
        '/>' +
        '<line x1="7" y1="1.5" x2="7" y2="12.5" stroke="' +
        c +
        '" stroke-width="1"/>' +
        '<line x1="1.5" y1="7" x2="12.5" y2="7" stroke="' +
        c +
        '" stroke-width="1"/>' +
        '</svg>'
      );
    // Galaxy — wide flat ellipse tilted 30° CCW (upper-right to lower-left)
    if (type === 'G' || type === 'GGroup' || type === 'GPair' || type === 'GTripl')
      return (
        '<svg class="dso-sym" xmlns="' +
        ns +
        '" width="16" height="10" viewBox="0 0 16 10" style="' +
        sh +
        '">' +
        '<ellipse cx="8" cy="5" rx="7" ry="3.5" fill="none" stroke="' +
        c +
        '"' +
        sw +
        ' transform="rotate(-30,8,5)"/>' +
        '</svg>'
      );
    // Planetary nebula — small circle + 4 outward spokes
    if (type === 'PN')
      return (
        '<svg class="dso-sym" xmlns="' +
        ns +
        '" width="14" height="14" viewBox="0 0 14 14" style="' +
        sh +
        '">' +
        '<circle cx="7" cy="7" r="3" fill="none" stroke="' +
        c +
        '"' +
        sw +
        '/>' +
        '<line x1="7" y1="0.5" x2="7"  y2="4"    stroke="' +
        c +
        '"' +
        sw +
        ' stroke-linecap="round"/>' +
        '<line x1="7" y1="10"  x2="7"  y2="13.5" stroke="' +
        c +
        '"' +
        sw +
        ' stroke-linecap="round"/>' +
        '<line x1="0.5" y1="7" x2="4"  y2="7"    stroke="' +
        c +
        '"' +
        sw +
        ' stroke-linecap="round"/>' +
        '<line x1="10"  y1="7" x2="13.5" y2="7"  stroke="' +
        c +
        '"' +
        sw +
        ' stroke-linecap="round"/>' +
        '</svg>'
      );
    // Nebulae (emission, HII, SNR, reflection) — square
    if (type === 'Neb' || type === 'HII' || type === 'SNR' || type === 'RfN')
      return (
        '<svg class="dso-sym" xmlns="' +
        ns +
        '" width="12" height="12" viewBox="0 0 12 12" style="' +
        sh +
        '">' +
        '<rect x="1" y="1" width="10" height="10" fill="none" stroke="' +
        c +
        '"' +
        sw +
        '/>' +
        '</svg>'
      );
    // Fallback / Other — diamond
    return (
      '<svg class="dso-sym" xmlns="' +
      ns +
      '" width="12" height="12" viewBox="0 0 12 12" style="' +
      sh +
      '">' +
      '<path d="M6,1 L11,6 L6,11 L1,6 Z" fill="none" stroke="' +
      c +
      '"' +
      sw +
      '/>' +
      '</svg>'
    );
  }

  function buildDSOs() {
    if (_dsoLayer || !_dsos.length) return;
    _dsoLayer = L.layerGroup();
    for (let i = 0; i < _dsos.length; i++) {
      const d = _dsos[i];
      const color = dsoColor(d.type);
      const label = d.messier ? 'M' + parseInt(d.messier) : d.id;
      // Galaxy uses a wider icon (16×10); all others use 14×14
      const isGalaxy = d.type === 'G' || d.type === 'GGroup' || d.type === 'GPair' || d.type === 'GTripl';
      const symSize = isGalaxy ? [16, 10] : [14, 14];
      const symAnchor = isGalaxy ? [8, 5] : [7, 7];
      const lblAnchor = isGalaxy ? [-9, 5] : [-9, 7];

      const symCopies = STAR_COPY_OFFSETS.map(() => {
        const symIcon = L.divIcon({
          className: 'dso-marker',
          html: _dsoSvgHtml(d.type, color),
          iconSize: symSize,
          iconAnchor: symAnchor,
        });
        const m = L.marker([0, 0], {
          icon: symIcon,
          pane: 'sky-stars',
          interactive: true,
          bubblingMouseEvents: false,
        });
        m.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          showDSOPopup(d, ev.latlng || m.getLatLng());
          // Great-circle toggle when the observer compass is active (d.ra in hours).
          if (typeof Observer !== 'undefined' && Observer.toggleGreatCircleTo) {
            Observer.toggleGreatCircleTo({
              kind: 'fixed',
              id: 'dso:' + d.id,
              name: d.messier ? 'M' + parseInt(d.messier) : d.id,
              raDeg: d.ra * 15,
              dec: d.dec,
            });
          }
        });
        m.on('contextmenu', (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (ev.originalEvent) ev.originalEvent.preventDefault();
          if (window._showBodyContextMenu) {
            window._showBodyContextMenu(ev, () => {
              if (window.activateCelestialVis) window.activateCelestialVis(d.ra * 15, d.dec);
            });
          } else if (window.activateCelestialVis) {
            window.activateCelestialVis(d.ra * 15, d.dec);
          }
        });
        return m;
      });
      const lblCopies = STAR_COPY_OFFSETS.map(() => {
        const lblIcon = L.divIcon({
          className: 'dso-label',
          html: label,
          iconSize: null,
          iconAnchor: lblAnchor,
        });
        return L.marker([0, 0], {
          icon: lblIcon,
          pane: 'sky-labels',
          interactive: false,
          keyboard: false,
        });
      });
      for (const m of symCopies) _dsoLayer.addLayer(m);
      for (const m of lblCopies) _dsoLayer.addLayer(m);
      _dsoMarkers.push({ dso: d, symCopies, lblCopies });
    }
  }

  function updateDSOPositions(gmst) {
    for (let i = 0; i < _dsoMarkers.length; i++) {
      const entry = _dsoMarkers[i];
      const d = entry.dso;
      const raDeg = d.ra * 15;
      const lon0 = wrap180(raDeg - gmst);
      for (let k = 0; k < STAR_COPY_OFFSETS.length; k++) {
        const ll = [d.dec, lon0 + STAR_COPY_OFFSETS[k]];
        entry.symCopies[k].setLatLng(ll);
        entry.lblCopies[k].setLatLng(ll);
      }
    }
  }

  let _dsoPopup = null;
  let _dsoPopupData = null;
  function showDSOPopup(dso, latlng) {
    _dsoPopupData = { dso, latlng };
    if (_dsoPopup && _map.hasLayer(_dsoPopup)) _map.removeLayer(_dsoPopup);
    const label = dso.messier ? 'M' + parseInt(dso.messier) : dso.id;
    const typeName = _t('dso.type.' + dso.type) !== 'dso.type.' + dso.type ? _t('dso.type.' + dso.type) : dso.type;
    const i18nKey = dso.messier ? 'dso.name.M' + parseInt(dso.messier) : null;
    const commonName = i18nKey && _t(i18nKey) !== i18nKey ? _t(i18nKey) : dso.common ? dso.common.split(',')[0] : null;
    const common = commonName ? '<div class="star-ids">' + commonName + '</div>' : '';
    const magRow =
      dso.mag != null
        ? '<div class="info-row"><span class="label"' +
          _glossAttr('magnitude') +
          '>' +
          _t('dso.magnitude') +
          '</span><span class="value">' +
          dso.mag.toFixed(1) +
          '</span></div>'
        : '';
    const sizeRow = dso.size
      ? '<div class="info-row"><span class="label"' +
        _glossAttr('dso_size') +
        '>' +
        _t('dso.size') +
        '</span><span class="value">' +
        dso.size.toFixed(1) +
        '′</span></div>'
      : '';
    const raDeg = dso.ra * 15;
    const date = typeof TimeState !== 'undefined' ? TimeState.current : new Date();
    const skyInfo = GeoUtils.buildSkyInfoHTML(raDeg, dso.dec, date, _t);
    const html =
      '<div class="star-panel">' +
      '<h2 class="star-name">' +
      label +
      ' <span class="star-bf"' +
      _glossAttr('dso_type.' + dso.type) +
      '>(' +
      typeName +
      ')</span></h2>' +
      common +
      '<div class="star-scroll">' +
      '<div class="info-block">' +
      '<div class="info-block-title">' +
      _t('sky.object_data') +
      '</div>' +
      magRow +
      sizeRow +
      '</div>' +
      skyInfo +
      '</div>' +
      GeoUtils.cardCredits([{ name: 'OpenNGC', url: 'https://github.com/mattiaverga/OpenNGC' }]) +
      '</div>';
    _dsoPopup = L.popup({
      className: 'sky-star-popup',
      offset: [0, -6],
      maxWidth: 250,
      closeButton: true,
      autoPan: false,
    })
      .setLatLng(latlng)
      .setContent(html)
      .openOn(_map);
  }

  // ---- Constellation / Xingguan popup ----
  // Opened by clicking an on-map IAU / xingguan label, or by selecting one from
  // the search box. `kind` is 'iau' | 'constellation' (IAU) or 'cn' | 'xingguan'.
  let _constPopup = null;
  let _constPopupRef = null; // {kind:'iau'|'cn', id, latlng}
  function showConstellationPopup(kind, id, latlng) {
    const isIau = kind === 'iau' || kind === 'constellation';
    const data = isIau ? _namesW && _namesW[id] : _namesC && _namesC[id];
    if (!data || !data.display) return;
    const k = isIau ? 'iau' : 'cn';
    const date = typeof TimeState !== 'undefined' ? TimeState.current : new Date();
    const title = isIau ? tConst(id) : tXingguan(id);
    let titleHtml,
      subHtml = '';
    if (isIau) {
      // "Title (Code)" — IAU code (CMi / And / Cyg / …) is the universal
      // catalog ID, shown as faint inline label. When the localized title
      // diverges from the Latin name (fr Cygne / es Cisne / zh 天鹅座 etc.),
      // surface the Latin name as a sub line — it's the canonical astronomical
      // identifier across all literature.
      titleHtml = title + ' <span class="star-bf">(' + id + ')</span>';
      const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase();
      if (data.name_la && norm(data.name_la) !== norm(title)) {
        subHtml = '<div class="star-ids">' + data.name_la + '</div>';
      }
    } else {
      titleHtml = title;
      // Xingguan: CJK locales (where the title is the native name) show no
      // sub. Non-CJK shows the *opposite* of the title — if title is the
      // pinyin (PartA of a "pinyin|meaning" dict value), sub is the localized
      // meaning (PartB); if title is the localized meaning (dict value with no
      // pipe), sub is the standard pinyin from names.cn.json.
      const isCJK = typeof I18n !== 'undefined' && I18n.isZhOrJa();
      if (!isCJK) {
        const raw = I18N.dicts.cn && I18N.dicts.cn[id];
        const partB = _meaningOf(raw);
        const stdPinyin = data.pinyin;
        const sub = partB || stdPinyin;
        // Skip sub when it's just the title respaced (e.g. "Xizhong" / "Xi Zhong"),
        // a common pattern for proper-noun xingguan in our i18n dicts.
        const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase();
        if (sub && norm(sub) !== norm(title)) {
          subHtml = '<div class="star-ids">' + sub + '</div>';
        }
      }
    }
    const raDeg = data.display[0];
    const decDeg = data.display[1];
    const skyInfo = GeoUtils.buildSkyInfoHTML(raDeg, decDeg, date, _t);
    const html =
      '<div class="star-panel">' +
      '<h2 class="star-name">' +
      titleHtml +
      '</h2>' +
      subHtml +
      '<div class="star-scroll">' +
      '<div class="info-block">' +
      '<div class="info-block-title">' +
      _t('sky.object_data') +
      '</div>' +
      '<div class="info-row"><span class="label">' +
      _t('star.ra') +
      '</span><span class="value">' +
      GeoUtils.fmtRA(raDeg) +
      '</span></div>' +
      '<div class="info-row"><span class="label">' +
      _t('star.dec') +
      '</span><span class="value">' +
      GeoUtils.fmtDec(decDeg) +
      '</span></div>' +
      '</div>' +
      skyInfo +
      '</div>' +
      (isIau
        ? GeoUtils.cardCredits([{ name: 'd3-celestial', url: 'https://github.com/ofrohn/d3-celestial' }])
        : GeoUtils.cardCredits([{ name: 'Stellarium', url: 'https://stellarium.org/' }])) +
      '</div>';
    if (!_constPopup) {
      _constPopup = L.popup({
        className: 'sky-star-popup',
        maxWidth: 280,
        offset: [0, -6],
        closeButton: true,
        autoPan: false,
      });
      _constPopup.on('remove', () => {
        _constPopupRef = null;
      });
    }
    _constPopup.setLatLng(latlng).setContent(html).openOn(_map);
    _constPopupRef = { kind: k, id, latlng };
  }

  // ---- Segment key for shared-segment detection ----
  function segKey(ra1, dec1, ra2, dec2) {
    const a = [((ra1 % 360) + 360) % 360, dec1].map((v) => v.toFixed(2));
    const b = [((ra2 % 360) + 360) % 360, dec2].map((v) => v.toFixed(2));
    const sa = a.join(','),
      sb = b.join(',');
    return sa < sb ? sa + '|' + sb : sb + '|' + sa;
  }

  function buildSegKeySet(fc) {
    const keys = new Set();
    for (const f of fc.features) {
      for (const line of f.geometry.coordinates) {
        for (let i = 0; i + 1 < line.length; i++) {
          keys.add(segKey(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]));
        }
      }
    }
    return keys;
  }

  function computeSharedSegments() {
    if (!_iauSegKeys || !_cnSegKeys) return;
    _sharedSegKeys = new Set();
    for (const k of _iauSegKeys) {
      if (_cnSegKeys.has(k)) _sharedSegKeys.add(k);
    }
  }

  // ---- Line grow/shrink animation ----
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Inject a CSS rule that hides newly-built paths by classBase, preventing a pre-animation flash.
  // Returns the <style> element to pass as animateLines' hideStyleEl argument.
  function injectHideRule(classBase) {
    var style = document.createElement('style');
    style.textContent = '.' + classBase + ', .' + classBase + '-shadow { opacity: 0 !important; }';
    document.head.appendChild(style);
    return style;
  }

  function removeHideRule(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // Persistent line layer visibility helpers
  function hideLines(classBase) {
    if (classBase === 'sky-line-iau') {
      if (!_iauLineHideStyle) _iauLineHideStyle = injectHideRule('sky-line-iau');
    } else {
      if (!_cnLineHideStyle) _cnLineHideStyle = injectHideRule('sky-line-cn');
    }
  }

  function showLines(classBase) {
    if (classBase === 'sky-line-iau') {
      removeHideRule(_iauLineHideStyle);
      _iauLineHideStyle = null;
    } else {
      removeHideRule(_cnLineHideStyle);
      _cnLineHideStyle = null;
    }
  }

  function collectPaths(cache, segKeySet, exclude) {
    const paths = [];
    for (const [, arr] of cache) {
      for (const entry of arr) {
        if (!entry._isShadowPair) continue;
        if (segKeySet) {
          const inSet = segKeySet.has(entry._segKey);
          if (exclude ? inSet : !inSet) continue;
        }
        if (entry.line._path) paths.push(entry.line._path);
        if (entry.shadow._path) paths.push(entry.shadow._path);
      }
    }
    return paths;
  }

  // Wait one frame so Leaflet's renderer creates SVG <path> elements.
  function waitFrame() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 20);
    });
  }

  /** Pre-compute and cache getTotalLength() on all SVG paths in a line cache.
   *  Stored as path._cachedLen so animateLines can skip the expensive call. */
  function cachePathLengths(cache) {
    for (const [, arr] of cache) {
      for (const entry of arr) {
        if (!entry._isShadowPair) continue;
        if (entry.line._path) {
          try {
            entry.line._path._cachedLen = entry.line._path.getTotalLength();
          } catch (e) {}
        }
        if (entry.shadow._path) {
          try {
            entry.shadow._path._cachedLen = entry.shadow._path.getTotalLength();
          } catch (e) {}
        }
      }
    }
  }

  function animateLines(paths, open, durationMs, hideStyleEl) {
    if (!paths.length) {
      removeHideRule(hideStyleEl);
      return Promise.resolve();
    }
    durationMs = durationMs || LINE_ANIM_DURATION;

    if (prefersReducedMotion()) {
      removeHideRule(hideStyleEl);
      paths.forEach(function (p) {
        p.style.transition = 'none';
        p.style.strokeDasharray = '';
        p.style.strokeDashoffset = '';
        p.style.opacity = open ? '' : '0';
      });
      return Promise.resolve();
    }

    var items = [];
    paths.forEach(function (path) {
      var len = path._cachedLen || 0;
      if (!len) {
        try {
          len = path.getTotalLength();
        } catch (e) {}
      }
      if (len) items.push({ path: path, len: len });
    });
    if (!items.length) {
      removeHideRule(hideStyleEl);
      return Promise.resolve();
    }

    // Pass 1: set the start state (dashoffset takes over the hiding).
    items.forEach(function (it) {
      it.path.style.opacity = '';
      it.path.style.transition = 'none';
      it.path.style.strokeDasharray = it.len;
      it.path.style.strokeDashoffset = open ? it.len : 0;
    });

    // The CSS hide rule has done its job (paths are now hidden by dashoffset) — remove it.
    removeHideRule(hideStyleEl);

    void items[0].path.ownerSVGElement.getBoundingClientRect();

    var dur = (durationMs / 1000).toFixed(3);
    var doneCount = 0;
    return new Promise(function (resolve) {
      items.forEach(function (it) {
        var path = it.path,
          len = it.len;
        path.style.transition = 'stroke-dashoffset ' + dur + 's ease-out';
        path.style.transitionDelay = '0s';
        path.style.strokeDashoffset = open ? 0 : len;

        function cleanup(ev) {
          if (ev.propertyName !== 'stroke-dashoffset') return;
          path.removeEventListener('transitionend', cleanup);
          path.style.transition = 'none';
          path.style.strokeDasharray = '';
          path.style.strokeDashoffset = '';
          if (!open) path.style.opacity = '0';
          doneCount++;
          if (doneCount >= items.length) resolve();
        }
        path.addEventListener('transitionend', cleanup);
      });
      setTimeout(function () {
        items.forEach(function (it) {
          it.path.style.transition = 'none';
          it.path.style.strokeDasharray = '';
          it.path.style.strokeDashoffset = '';
          if (!open) it.path.style.opacity = '0';
        });
        resolve();
      }, durationMs + 100);
    });
  }

  // Fade all DOM elements in one or more Leaflet layerGroups.
  // fadeIn=true: opacity 0→1; fadeIn=false: opacity 1→0.
  // Returns a promise that resolves after the transition completes.
  function fadeLayers(layerGroups, fadeIn, durationMs) {
    var els = [];
    layerGroups.forEach(function (lg) {
      if (!lg) return;
      lg.eachLayer(function (layer) {
        var el = layer.getElement ? layer.getElement() : layer._path || null;
        if (el) els.push(el);
      });
    });
    if (!els.length) return Promise.resolve();
    durationMs = durationMs || LINE_ANIM_DURATION;
    if (prefersReducedMotion()) {
      els.forEach(function (el) {
        el.style.opacity = fadeIn ? '' : '0';
      });
      return Promise.resolve();
    }
    var dur = (durationMs / 1000).toFixed(3);
    els.forEach(function (el) {
      el.style.transition = 'none';
      el.style.opacity = fadeIn ? '0' : '';
    });
    void els[0].getBoundingClientRect();
    els.forEach(function (el) {
      el.style.transition = 'opacity ' + dur + 's ease-out';
      el.style.opacity = fadeIn ? '' : '0';
    });
    return new Promise(function (resolve) {
      setTimeout(resolve, durationMs);
    });
  }

  // Compute [lonMin, lonMax] over a set of unwrapped lat/lon arrays.
  function lonExtent(rings) {
    let lo = +Infinity,
      hi = -Infinity;
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const v = r[i][1];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return [lo, hi];
  }

  // Update the MultiLineString features in `fc` into `layerGroup`, using
  // `cache` (Map: featureId -> [Polyline,...]) to avoid full rebuilds.
  // For each sub-line we unwrap longitudes (no antimeridian splits) and
  // then materialise N copies at k*360° offsets to fill the world-wrap range.
  function updateLineFC(fc, layerGroup, cache, gmst, classBase) {
    // v4-1: feature-level viewport cull. Skip features whose RA/Dec bbox
    // doesn't intersect viewport — and detach their cached polylines so
    // they don't keep paying Leaflet SVG _update transform cost.
    const vpBox = viewportRaDecBox(gmst);
    for (const f of fc.features) {
      const id = f.id;
      if (vpBox && f._bbox && !_bboxOverlaps(f._bbox, vpBox)) {
        const arr = cache.get(id);
        if (arr) {
          for (const p of arr) {
            if (p._isShadowPair) {
              layerGroup.removeLayer(p.shadow);
              layerGroup.removeLayer(p.line);
            } else layerGroup.removeLayer(p);
          }
          cache.delete(id);
        }
        continue;
      }
      const segs = []; // { latlngs, key }
      for (const line of f.geometry.coordinates) {
        for (let si = 0; si + 1 < line.length; si++) {
          const pair = [line[si], line[si + 1]];
          const projected = pair.map(([ra, dec]) => subStellar(ra, dec, gmst));
          const unwrapped = unwrapLons(projected);
          const [lo, hi] = lonExtent([unwrapped]);
          const key = segKey(pair[0][0], pair[0][1], pair[1][0], pair[1][1]);
          for (const dLon of wrapOffsets(lo, hi)) {
            segs.push({ latlngs: shiftLatLngs(unwrapped, dLon), key });
          }
        }
      }
      let arr = cache.get(id);
      if (_animating || (arr && arr.length === segs.length)) {
        if (arr) {
          for (let i = 0; i < segs.length && i < arr.length; i++) {
            arr[i].shadow.setLatLngs(segs[i].latlngs);
            arr[i].line.setLatLngs(segs[i].latlngs);
          }
        }
      } else {
        if (arr)
          for (const p of arr) {
            if (p._isShadowPair) {
              layerGroup.removeLayer(p.shadow);
              layerGroup.removeLayer(p.line);
            } else layerGroup.removeLayer(p);
          }
        arr = [];
        for (const seg of segs) {
          const shadow = L.polyline(seg.latlngs, {
            pane: 'sky-lines',
            className: `${classBase}-shadow`,
            color: '#0e1014',
            weight: 2.6,
            opacity: 0.8,
            interactive: false,
            smoothFactor: 1.2,
          });
          const line = L.polyline(seg.latlngs, {
            pane: 'sky-lines',
            className: `${classBase} ${classBase}-${id}`,
            color: '#dad6ca',
            weight: 1.4,
            opacity: 0.85,
            interactive: false,
            smoothFactor: 1.2,
          });
          arr.push({ shadow, line, _isShadowPair: true, _segKey: seg.key });
        }
        for (const pair of arr) {
          layerGroup.addLayer(pair.shadow);
          layerGroup.addLayer(pair.line);
        }
        cache.set(id, arr);
      }
    }
  }

  function updateBoundsFC(fc, layerGroup, cache, gmst) {
    // v4-1: feature-level viewport cull (see updateLineFC).
    const vpBox = viewportRaDecBox(gmst);
    for (const f of fc.features) {
      const id = f.id;
      if (vpBox && f._bbox && !_bboxOverlaps(f._bbox, vpBox)) {
        const arr = cache.get(id);
        if (arr) {
          for (const p of arr) layerGroup.removeLayer(p);
          cache.delete(id);
        }
        continue;
      }
      // GeoJSON polygon hierarchy: Polygon = [ring], MultiPolygon = [poly, …].
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const outPolys = [];
      for (const poly of polys) {
        // Each poly is [outerRing, ...holes]. Transform + unwrap each ring
        // independently using the OUTER ring's wrap reference, so the holes
        // stay in the same lon offset as the outer.
        const transformedRings = poly.map((ring) => unwrapLons(ring.map(([ra, dec]) => subStellar(ra, dec, gmst))));
        const [lo, hi] = lonExtent(transformedRings);
        for (const dLon of wrapOffsets(lo, hi)) {
          outPolys.push(transformedRings.map((r) => shiftLatLngs(r, dLon)));
        }
      }
      let arr = cache.get(id);
      if (!arr || arr.length !== outPolys.length) {
        if (arr) for (const p of arr) layerGroup.removeLayer(p);
        arr = outPolys.map((rings) =>
          L.polygon(rings, {
            pane: 'sky-bounds',
            className: `sky-bound lyr-const-bounds sky-bound-${id}`,
            color: '#9aa0b8',
            weight: 1.3,
            opacity: 0.92,
            dashArray: '1.5 3.5',
            lineCap: 'round',
            lineJoin: 'round',
            fill: false,
            interactive: false,
          })
        );
        for (const p of arr) layerGroup.addLayer(p);
        cache.set(id, arr);
      } else {
        for (let i = 0; i < outPolys.length; i++) arr[i].setLatLngs(outPolys[i]);
      }
    }
  }

  function updateNames(layerGroup, cache, namesObj, gmst, kind) {
    // IAU: show all 88 (rank ≤ 3), rank 3 styled dimmer via .sky-label-iau-dim.
    // CN:  show all 312 xingguan, rank 3 (individual xingguan like 五车、南船)
    //      styled smaller via .sky-label-cn-minor; rank 1–2 (mansions + walls)
    //      stay at full size.
    // Sort by rank so higher-priority labels (rank 1) are placed first.
    const ids = Object.keys(namesObj);
    ids.sort((a, b) => (namesObj[a].rank || 1) - (namesObj[b].rank || 1));

    const minSep = _labelMinSepDeg(_currentZoom);
    const minSep2 = minSep * minSep;
    const placed = [];
    const wanted = new Set();

    for (const id of ids) {
      const meta = namesObj[id];
      const display = meta.display;
      if (!display) continue;
      const rank = meta.rank || 1;

      if (rank >= 3 && _currentZoom < 5) {
        const copies = cache.get(id);
        if (copies) {
          for (const m of copies) layerGroup.removeLayer(m);
          cache.delete(id);
        }
        continue;
      }

      const [lat, lon0] = subStellar(display[0], display[1], gmst);
      const text = kind === 'iau' ? tConst(id) : tXingguan(id);
      if (kind === 'cn' && _xgSuppressed.has(id)) {
        const copies = cache.get(id);
        if (copies) {
          for (const m of copies) layerGroup.removeLayer(m);
          cache.delete(id);
        }
        continue;
      }
      // v4-1+v5: skip only if no wrap copy of the display point lands in
      // viewport (+pad). Enumerate all wraps — picking only the nearest can
      // miss labels whose physical position appears in viewport via a
      // different wrap copy (Pacific viewport bug).
      if (_map) {
        const bb = _map.getBounds();
        const pad = 5;
        if (lat < bb.getSouth() - pad || lat > bb.getNorth() + pad) {
          const copies = cache.get(id);
          if (copies) {
            for (const m of copies) layerGroup.removeLayer(m);
            cache.delete(id);
          }
          continue;
        }
        let anyVisible = false;
        const vw = bb.getWest() - pad,
          ve = bb.getEast() + pad;
        for (let kw = -2; kw <= 2; kw++) {
          const wlon = lon0 + kw * 360;
          if (wlon >= vw && wlon <= ve) {
            anyVisible = true;
            break;
          }
        }
        if (!anyVisible) {
          const copies = cache.get(id);
          if (copies) {
            for (const m of copies) layerGroup.removeLayer(m);
            cache.delete(id);
          }
          continue;
        }
      }

      let collides = false;
      for (let p = 0; p < placed.length; p++) {
        const dLat = lat - placed[p].dec;
        let dLon = lon0 - placed[p].lon0;
        if (dLon > 180) dLon -= 360;
        else if (dLon < -180) dLon += 360;
        if (dLat * dLat + dLon * dLon < minSep2) {
          collides = true;
          break;
        }
      }
      if (collides) {
        const copies = cache.get(id);
        if (copies) {
          for (const m of copies) layerGroup.removeLayer(m);
          cache.delete(id);
        }
        continue;
      }
      placed.push({ dec: lat, lon0 });
      wanted.add(id);

      const offsets = wrapOffsets(lon0, lon0);
      const dimIau = kind === 'iau' && rank >= 3;
      const minorCn = kind === 'cn' && rank >= 3;
      const cls = `sky-label sky-label-${kind}${dimIau ? ' sky-label-iau-dim' : ''}${minorCn ? ' sky-label-cn-minor' : ''}`;
      let copies = cache.get(id);

      if (!copies || copies.length !== offsets.length) {
        if (copies) for (const m of copies) layerGroup.removeLayer(m);
        copies = offsets.map((dLon) => {
          const m = L.marker([lat, lon0 + dLon], {
            pane: 'sky-labels',
            icon: L.divIcon({ className: cls, html: `<span>${text}</span>`, iconSize: null }),
            interactive: true,
            keyboard: false,
            bubblingMouseEvents: false,
          });
          m.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            showConstellationPopup(kind, id, (ev && ev.latlng) || m.getLatLng());
          });
          return m;
        });
        for (const m of copies) layerGroup.addLayer(m);
        cache.set(id, copies);
      } else {
        for (let i = 0; i < copies.length; i++) {
          copies[i].setLatLng([lat, lon0 + offsets[i]]);
        }
      }
    }
    for (const [id, copies] of cache) {
      if (!wanted.has(id)) {
        for (const m of copies) layerGroup.removeLayer(m);
        cache.delete(id);
      }
    }
    return placed;
  }

  // Positions are computed at canvas draw time from gmst, not stored on
  // markers (markers no longer exist). These are kept as no-ops so callers
  // (update(), refreshViewTiles then-block) don't need changes.
  function _positionEntry(entry, gmst) {
    /* no-op */
  }

  function updateStarPositions(gmst) {
    /* no-op */
  }

  // Zoom-adaptive magnitude cutoff for on-map star labels. Keeps the map
  // legible at low zoom and rewards zoom-in with more named stars.
  function magCutoffForStarLabels(zoom) {
    let base;
    if (zoom == null || zoom <= 3) base = 2.0;
    else if (zoom <= 5) base = 3.0;
    else if (zoom <= 6) base = 4.5;
    else if (zoom <= 7) base = 5.5;
    else base = 7.0;
    if (_isDayMode()) base -= 1.0;
    return base;
  }

  function _labelMinSepDeg(zoom) {
    if (zoom == null || zoom <= 3) return 4;
    if (zoom <= 5) return 2;
    if (zoom <= 6) return 1;
    if (zoom <= 8) return 0.3;
    return 0.1;
  }

  // Render single-star name labels for the current mode. In IAU mode each
  // labeled star shows its Latin/proper name; in CN mode, its Chinese
  // xingguan single-star name (skipped silently if dict has no entry).
  // _stars is sorted brightest-first, so collision suppresses the fainter star.
  function updateStarLabels(layerGroup, cache, gmst, kind, namePlaced) {
    const cutoff = magCutoffForStarLabels(_currentZoom);
    const minSep = _labelMinSepDeg(_currentZoom);
    const minSep2 = minSep * minSep;
    // Viewport culling: only process stars visible on screen (with padding).
    const bounds = _map.getBounds();
    const pad = 5;
    const latMin = bounds.getSouth() - pad,
      latMax = bounds.getNorth() + pad;
    const lngMin = bounds.getWest() - pad,
      lngMax = bounds.getEast() + pad;
    // Seed with constellation label positions so star labels yield to them.
    const placed = namePlaced ? namePlaced.slice() : [];
    const wanted = new Set();
    for (let i = 0; i < _stars.length; i++) {
      const s = _stars[i];
      if (s.mag > cutoff) continue;
      const lon0 = wrap180(s.ra - gmst);
      if (s.dec < latMin || s.dec > latMax) continue;
      // Snap lon0 to the world copy nearest viewport before culling, so a
      // star whose k=+1 / k=−1 wrap falls inside the viewport isn't dropped
      // just because its canonical (-180, 180] lon0 sits in a different copy.
      if (lngMax - lngMin < 350) {
        const k = Math.round(((lngMin + lngMax) / 2 - lon0) / 360);
        const wlon0 = lon0 + k * 360;
        if (wlon0 < lngMin || wlon0 > lngMax) continue;
      }
      let name;
      if (kind === 'stars') {
        const isCJK = typeof I18n !== 'undefined' && I18n.isZhOrJa();
        if (isCJK) {
          name = tStarChinese(s); // full xingguan name (e.g. 河鼓二, 天狼星)
          if (!name) name = s.proper || null; // fall back to the IAU proper name when there's no xingguan name
        } else {
          if (!s.proper) continue;
          name = s.proper;
        }
      } else {
        name = kind === 'iau' ? tStarBayer(s) : tStarCnLabel(s);
      }
      if (!name) continue;
      // Collision check: skip if too close to any brighter star's label
      let collides = false;
      for (let p = 0; p < placed.length; p++) {
        const dLat = s.dec - placed[p].dec;
        let dLon = lon0 - placed[p].lon0;
        if (dLon > 180) dLon -= 360;
        else if (dLon < -180) dLon += 360;
        if (dLat * dLat + dLon * dLon < minSep2) {
          collides = true;
          break;
        }
      }
      if (collides) continue;
      placed.push({ dec: s.dec, lon0 });
      wanted.add(i);
      let dim = false;
      if (kind === 'iau') {
        dim = s.bf && /^\s*\d+\s+\w{3}\s*$/.test(s.bf);
      } else if (kind === 'cn') {
        dim = /^(?:Added|Ajouté|Añadido)\s/.test(name) || /^增/.test(name);
      }
      const cls = `sky-label sky-label-star sky-label-star-${kind}${dim ? ` sky-label-star-${kind}-dim` : ''}`;
      const offsets = wrapOffsets(lon0, lon0);
      // Gap is measured from the glow's outer edge (not the core), so the label
      // stays clear of the bloom as it grows with zoom. spriteRadii uses the
      // same _starScale the canvas renders the glow with, so the offset tracks
      // the actual on-screen glow radius; glow=0 (dim, un-bloomed stars) falls
      // back to the core radius. Mirrors the body-label gap in map.js.
      const GAP = 4;
      const sr = Lum.spriteRadii(s.mag, _starScale);
      const gapX = Math.max(sr.glow, sr.core) + GAP;
      let copies = cache.get(i);
      if (!copies || copies.length !== offsets.length || (copies._cls && copies._cls !== cls)) {
        if (copies) for (const m of copies) layerGroup.removeLayer(m);
        copies = offsets.map((dLon) =>
          L.marker([s.dec, lon0 + dLon], {
            pane: 'sky-labels',
            icon: L.divIcon({
              className: cls,
              html: `<span>${name}</span>`,
              iconSize: null,
              iconAnchor: [-gapX, 7], // 7 ≈ vertically centre text on the star
            }),
            interactive: false,
            keyboard: false,
          })
        );
        copies._cls = cls;
        for (const m of copies) layerGroup.addLayer(m);
        cache.set(i, copies);
      } else {
        for (let k = 0; k < copies.length; k++) {
          copies[k].setLatLng([s.dec, lon0 + offsets[k]]);
        }
      }
      // Re-apply the glow-relative offset every frame: cached markers keep
      // their creation-time iconAnchor, so on zoom we update the element's
      // margins directly (Leaflet implements iconAnchor as margins — this is
      // the same mechanism, minus an expensive setIcon, and doesn't clash with
      // Leaflet's positioning transform).
      for (const m of copies) {
        const el = m.getElement();
        if (el) {
          el.style.marginLeft = gapX + 'px';
          el.style.marginTop = '-7px';
        }
      }
    }
    // Purge stars that should no longer have labels (zoom-out / mode switch).
    for (const [i, copies] of cache) {
      if (!wanted.has(i)) {
        for (const m of copies) layerGroup.removeLayer(m);
        cache.delete(i);
      }
    }
  }

  // ---- Eye adaptation (replaces old binary sun-angle dimming) ----
  // Smoothed adaptation level A ∈ [0,1]; updated each frame.
  let _adaptA = 0;
  let _lastAdaptTime = 0;

  function updateEyeAdaptation(date) {
    // 1. Compute raw adaptation from sun + moon presence
    let A_sun = 0,
      A_moon = 0;
    let sunRa, sunDec;
    try {
      const eq = Astronomy.Equator(Astronomy.Body.Sun, date, null, true, true);
      sunRa = eq.ra * 15;
      sunDec = eq.dec;
    } catch (e) {
      /* no sun data */
    }

    const g = gmstDeg(date);
    if (sunRa !== undefined) {
      const [sLat, sLon] = subStellar(sunRa, sunDec, g);
      // Sun in dayside → adaptation.  Use viewport centre distance as proxy.
      if (_map) {
        const c = _map.getCenter();
        const sep = gcDeg(c.lat, c.lng, sLat, sLon);
        A_sun = 1 - Lum.smoothstep(0, 120, sep);
      }
    }

    try {
      const meq = Astronomy.Equator(Astronomy.Body.Moon, date, null, true, true);
      const moonRa = meq.ra * 15,
        moonDec = meq.dec;
      const [mLat, mLon] = subStellar(moonRa, moonDec, g);
      const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
      const frac = illum.phase_fraction;
      if (_map) {
        const c = _map.getCenter();
        const msep = gcDeg(c.lat, c.lng, mLat, mLon);
        const moonPresence = 1 - Lum.smoothstep(0, 90, msep);
        A_moon = frac * moonPresence;
      }
    } catch (e) {
      /* no moon data */
    }

    const A_raw = Lum.clamp(0, 1, Math.max(A_sun, 0.6 * A_moon));

    // 2. Exponential smoothing (τ ≈ 500ms)
    const now = Date.now();
    const dt = _lastAdaptTime ? now - _lastAdaptTime : 500;
    _lastAdaptTime = now;
    const alpha = Math.min(1, dt / 500);
    _adaptA += (A_raw - _adaptA) * alpha;

    // 3. Apply to stars — per-star adaptation factor based on luminosity
    const A = _adaptA;
    let sunSubLat = null,
      sunSubLon = null;
    if (sunRa !== undefined) {
      const [sLat, sLon] = subStellar(sunRa, sunDec, g);
      sunSubLat = sLat;
      sunSubLon = sLon;
    }
    // Only writes entry._adaptAf; canvas redraw consumes it. No DOM
    // touching here — that was the biggest single perf cost at z=10.
    function applyAdaptToEntry(entry) {
      const s = entry.star;
      const lon = wrap180(s.ra - g);
      let starA = A;
      if (sunSubLat !== null) {
        const sep = gcDeg(s.dec, lon, sunSubLat, sunSubLon);
        if (sep < 90) starA = Math.max(A, Lum.smoothstep(90, 0, sep));
      }
      entry._adaptAf = Lum.adaptationFactor(entry._lnB || Lum.lnB(s.mag), starA);
    }

    const n = _attachedCount;
    for (let i = 0; i < n; i++) applyAdaptToEntry(_starMarkers[i]);
    forEachAttachedTileEntry(applyAdaptToEntry);

    return A;
  }

  // ---- Mode switching ----
  function ensurePanes() {
    // Panes are layered z-index'd; bounds at the bottom, lines mid, stars
    // above, labels on top. Markers (tooltip-divs) live in the labels pane.
    const defs = [
      ['sky-bounds', 505],
      ['sky-lines', 505],
      ['sky-stars', 520],
      ['sky-labels', 600],
    ];
    for (const [name, z] of defs) {
      if (!_map.getPane(name)) {
        _map.createPane(name);
        _map.getPane(name).style.zIndex = String(z);
        _map.getPane(name).style.pointerEvents = name === 'sky-stars' ? 'auto' : 'none';
      }
    }
    applyLineOpacity();
    applyBoundsOpacity();
  }

  // Zoom-driven opacity for constellation lines (IAU + CN, shadows included).
  // At low zoom the full-sky line web crowds the view; fade the entire
  // sky-lines pane toward the background so stars stay legible. Multiplies
  // into per-polyline opacity automatically — no per-line iteration needed.
  function lineOpacityForZoom(z) {
    if (z == null || z >= 6) return 1.0;
    if (z <= 3) return 0.4; // 3 is the map's minZoom
    return 0.4 + ((z - 3) / 3) * 0.6;
  }

  function applyLineOpacity() {
    if (!_map) return;
    const pane = _map.getPane('sky-lines');
    if (!pane) return;
    // Day-mode hiding is handled by clip-path on the sky-lines pane (see
    // _twilightClippedLabelPanes in map.js) — daylight area is hard-cut, not
    // faded. This function only controls zoom-driven opacity for the
    // night-side portion.
    pane.style.opacity = String(lineOpacityForZoom(_currentZoom));
  }

  // Called from map.js _setDayMode when the white day-veil is toggled.
  // Re-runs star visibility (mag cutoff dropped 1 in day-mode) + a full
  // update tick so star labels rebuild with the new cutoff. Line/bounds
  // panes are clip-pathed by map.js, not opacity-faded here.
  function refreshDayMode() {
    if (!_map || _mode === 'off') return;
    applyStarVisibility(magCutoffForStarMarkers(_currentZoom));
    if (typeof TimeState !== 'undefined' && TimeState.current) {
      update(TimeState.current);
    }
  }

  // Same idea for constellation boundaries. They're only added at z >= 4 by
  // applyZoomVisibility; ramp the pane opacity from 0.6 → 1.0 across z=4..6.
  function boundsOpacityForZoom(z) {
    if (z == null || z >= 6) return 1.0;
    if (z <= 4) return 0.6;
    return 0.6 + ((z - 4) / 2) * 0.4;
  }

  function applyBoundsOpacity() {
    if (!_map) return;
    const pane = _map.getPane('sky-bounds');
    if (!pane) return;
    pane.style.opacity = String(boundsOpacityForZoom(_currentZoom));
  }

  // Bring up shared star/DSO/comet/meteor layers (used by stars, iau, cn modes).
  function ensureSharedLayers() {
    buildStars();
    buildDSOs();
    if (!_map.hasLayer(_starsLayer)) _map.addLayer(_starsLayer);
    if (_dsoLayer && !_map.hasLayer(_dsoLayer)) _map.addLayer(_dsoLayer);
    applyStarScale(_currentZoom); // see R3 init-load fix above
    applyStarVisibility(magCutoffForStarMarkers(_currentZoom));
    if (typeof Comet !== 'undefined' && !Comet.isOn()) Comet.addTo(_map);
    if (typeof Meteor !== 'undefined' && !Meteor.isOn()) Meteor.addTo(_map);
  }

  function teardownSharedLayers() {
    if (_starsLayer && _map.hasLayer(_starsLayer)) _map.removeLayer(_starsLayer);
    if (_dsoLayer && _map.hasLayer(_dsoLayer)) _map.removeLayer(_dsoLayer);
    if (typeof Comet !== 'undefined' && Comet.isOn()) Comet.removeFrom(_map);
    if (typeof Meteor !== 'undefined' && Meteor.isOn()) Meteor.removeFrom(_map);
  }

  function addIauLayers() {
    if (!_iauLines) _iauLines = L.layerGroup();
    if (!_iauBounds) _iauBounds = L.layerGroup();
    if (!_iauNames) _iauNames = L.layerGroup();
    if (!_iauStarLabels) _iauStarLabels = L.layerGroup();
    // Lines: persistent on map, visibility via CSS
    if (!_map.hasLayer(_iauLines)) _map.addLayer(_iauLines);
    // Non-line layers: skip if overlays are suppressed by layer conflict
    if (_overlaysSuppressed) return;
    // z<4: bounds + labels are gated (see applyZoomVisibility). Skip adding them
    // here so we never add-then-remove on the same tick (avoids flash + churn).
    if (_currentZoom < 4) return;
    if (!_map.hasLayer(_iauBounds)) _map.addLayer(_iauBounds);
    if (!_map.hasLayer(_iauNames)) _map.addLayer(_iauNames);
    if (!_map.hasLayer(_iauStarLabels)) _map.addLayer(_iauStarLabels);
  }

  function removeIauLayers() {
    // Lines stay on map (persistent DOM), hidden via CSS
    hideLines('sky-line-iau');
    // Non-line layers: remove normally (cheap DOM)
    if (_iauBounds && _map.hasLayer(_iauBounds)) _map.removeLayer(_iauBounds);
    if (_iauNames && _map.hasLayer(_iauNames)) _map.removeLayer(_iauNames);
    if (_iauStarLabels && _map.hasLayer(_iauStarLabels)) _map.removeLayer(_iauStarLabels);
  }

  /** Fully remove IAU lines from map + clear cache (only for 'off' teardown). */
  function destroyIauLines() {
    removeHideRule(_iauLineHideStyle);
    _iauLineHideStyle = null;
    if (_iauLines && _map.hasLayer(_iauLines)) _map.removeLayer(_iauLines);
    _iauLines = null;
    _iauLineCache.clear();
  }

  function addCnLayers() {
    if (!_cnLines) _cnLines = L.layerGroup();
    if (!_cnNames) _cnNames = L.layerGroup();
    if (!_cnStarLabels) _cnStarLabels = L.layerGroup();
    // Lines: persistent on map, visibility via CSS
    if (!_map.hasLayer(_cnLines)) _map.addLayer(_cnLines);
    // Non-line layers: skip if overlays are suppressed by layer conflict
    if (_overlaysSuppressed) return;
    // z<4: labels are gated (see applyZoomVisibility). Skip adding them here so
    // we never add-then-remove on the same tick (avoids flash + churn).
    if (_currentZoom < 4) return;
    if (!_map.hasLayer(_cnNames)) _map.addLayer(_cnNames);
    if (!_map.hasLayer(_cnStarLabels)) _map.addLayer(_cnStarLabels);
  }

  function removeCnLayers() {
    // Lines stay on map (persistent DOM), hidden via CSS
    hideLines('sky-line-cn');
    // Non-line layers: remove normally
    if (_cnNames && _map.hasLayer(_cnNames)) _map.removeLayer(_cnNames);
    if (_cnStarLabels && _map.hasLayer(_cnStarLabels)) _map.removeLayer(_cnStarLabels);
    removeHideRule(_cnLabelHideStyle);
    _cnLabelHideStyle = null;
    _cnPreloaded = false;
  }

  /** Fully remove CN lines from map + clear cache (only for 'off' teardown). */
  function destroyCnLines() {
    removeHideRule(_cnLineHideStyle);
    _cnLineHideStyle = null;
    removeHideRule(_cnLabelHideStyle);
    _cnLabelHideStyle = null;
    _cnPreloaded = false;
    if (_cnLines && _map.hasLayer(_cnLines)) _map.removeLayer(_cnLines);
    _cnLines = null;
    _cnLineCache.clear();
  }

  async function setMode(mode, opts) {
    // Two code paths: animated transition (adjacent modes) vs direct-jump fallback;
    // z<4 label gating must be done in both.
    var _skipAnim = opts && opts.skipAnim;
    if (mode === _mode) return;
    if (!['off', 'stars', 'iau', 'cn'].includes(mode)) throw new Error(`bad mode: ${mode}`);
    // URL setView(...,z) updates the map zoom synchronously but fires zoomend
    // asynchronously; refresh from the live zoom so the z<4 label gate below
    // doesn't run against a stale construction-time zoom (which would briefly
    // show then hide labels at z<4 — the "flash" bug).
    if (_map) _currentZoom = _map.getZoom();
    const from = _mode;
    _prevMode = _mode;
    _mode = mode;
    const date = TimeState && TimeState.current ? TimeState.current : new Date();

    // ---- off → stars: show star dots only ----
    if (from === 'off' && mode === 'stars') {
      ensureSharedLayers();
      // Fade the star-dot canvas (sky-stars pane) in. Works at all zooms incl.
      // z<4 where labels are gated — gives a real star-point transition there.
      if (!_skipAnim && window.LayerFade) LayerFade.fadePane(_map.getPane('sky-stars'), true);
      if (!_starsStarLabels) _starsStarLabels = L.layerGroup();
      if (!_overlaysSuppressed) _map.addLayer(_starsStarLabels);
      update(date);
      applyZoomVisibility();
      if (!_skipAnim) fadeLayers([_starsStarLabels], true);
      // Background-preload IAU data and pre-create the IAU line DOM (hidden).
      loadIau().then(function () {
        if (!_iauSegKeys) _iauSegKeys = buildSegKeySet(_linesW);
        // Pre-create the IAU line layer (hidden).
        if (!_iauLines) _iauLines = L.layerGroup();
        hideLines('sky-line-iau');
        if (!_map.hasLayer(_iauLines)) _map.addLayer(_iauLines);
        var preGmst = gmstDeg(TimeState.current || new Date());
        updateLineFC(_linesW, _iauLines, _iauLineCache, preGmst, 'sky-line-iau');
        cachePathLengths(_iauLineCache);
      });
      return;
    }

    // ---- stars → iau: grow IAU lines ----
    if (from === 'stars' && mode === 'iau') {
      // Finish the heavy work (load + build DOM) before starting the visible
      // transition, so a first-switch fetch/parse/build can't steal frames and stutter the fade.
      await loadIau();
      if (!_iauSegKeys) {
        _iauSegKeys = buildSegKeySet(_linesW);
      }
      // Ensure the IAU lines are CSS-hidden (prevents a pre-animation flash; they may already be on the map).
      hideLines('sky-line-iau');
      addIauLayers();
      update(date);
      applyZoomVisibility();
      // Only fade the stars labels out after build completes (no await; runs parallel with the line animation).
      var starsLabelFade =
        !_skipAnim && _starsStarLabels && _map.hasLayer(_starsStarLabels)
          ? fadeLayers([_starsStarLabels], false)
          : Promise.resolve();
      if (!_skipAnim) {
        // Fade labels/bounds in: set opacity=0 synchronously before the await to avoid a flash.
        fadeLayers([_iauBounds, _iauNames, _iauStarLabels], true);
        await waitFrame();
        const paths = collectPaths(_iauLineCache);
        _animating = true;
        // animateLines' Pass 1 removes the CSS hide rule itself once it sets dashoffset.
        await animateLines(paths, true, undefined, _iauLineHideStyle);
        _iauLineHideStyle = null; // animateLines already removed the <style> element
        _animating = false;
      } else {
        showLines('sky-line-iau'); // skipAnim: show immediately
      }
      // Clean up the faded-out stars labels.
      starsLabelFade.then(function () {
        if (_starsStarLabels && _map.hasLayer(_starsStarLabels)) _map.removeLayer(_starsStarLabels);
      });
      // Background-preload all CN layers (lines + labels) so the iau→cn stage is near-zero cost.
      loadCn().then(function () {
        if (_mode !== 'iau') return; // already switched away — abort the preload
        if (!_cnSegKeys) _cnSegKeys = buildSegKeySet(_linesC);
        if (!_sharedSegKeys) computeSharedSegments();
        var preGmst = gmstDeg(TimeState.current || new Date());
        // Pre-create the CN lines (hidden).
        if (!_cnLines) _cnLines = L.layerGroup();
        hideLines('sky-line-cn');
        if (!_map.hasLayer(_cnLines)) _map.addLayer(_cnLines);
        updateLineFC(_linesC, _cnLines, _cnLineCache, preGmst, 'sky-line-cn');
        cachePathLengths(_cnLineCache);
        // Pre-create the CN labels (hidden via a CSS rule).
        if (!_cnNames) _cnNames = L.layerGroup();
        if (!_cnStarLabels) _cnStarLabels = L.layerGroup();
        if (!_map.hasLayer(_cnNames)) _map.addLayer(_cnNames);
        if (!_map.hasLayer(_cnStarLabels)) _map.addLayer(_cnStarLabels);
        var cnPlaced = updateNames(_cnNames, _cnNameCache, _namesC, preGmst, 'cn');
        updateStarLabels(_cnStarLabels, _cnStarLabelCache, preGmst, 'cn', cnPlaced);
        // Hide the CN labels with a single CSS rule (covers all of them, no per-marker walk).
        if (!_cnLabelHideStyle) {
          var s = document.createElement('style');
          s.textContent = '.sky-label-cn, .sky-label-star-cn { opacity: 0 !important; }';
          document.head.appendChild(s);
          _cnLabelHideStyle = s;
        }
        _cnPreloaded = true;
      });
      return;
    }

    // ---- iau → cn: shared segments stay, IAU-only shrink, CN-only grow ----
    if (from === 'iau' && mode === 'cn') {
      try {
        // Ensure the shared data is available (usually already done by preload — returns immediately).
        await loadCn();
        if (!_cnSegKeys) {
          _cnSegKeys = buildSegKeySet(_linesC);
        }
        if (!_sharedSegKeys) computeSharedSegments();
        const shared = _sharedSegKeys;

        const iauOnlyPaths = collectPaths(_iauLineCache, shared, true);

        if (_cnPreloaded && !_skipAnim) {
          // ---- Fast path: preload done, parallel collapse/expand ----

          // Prime the CN-only dashoffset (the CN paths are CSS-hidden, invisible).
          var cnOnlyPaths = collectPaths(_cnLineCache, shared, true);
          cnOnlyPaths.forEach(function (p) {
            var len = p._cachedLen || 0;
            if (!len) {
              try {
                len = p.getTotalLength();
              } catch (e) {}
            }
            if (len) {
              p.style.transition = 'none';
              p.style.strokeDasharray = len;
              p.style.strokeDashoffset = len;
            }
          });

          // Hand off the shared segments (done before the animation starts; visually identical, no flash).
          if (shared && shared.size > 0) {
            collectPaths(_cnLineCache, shared).forEach(function (p) {
              p.style.opacity = '';
            });
            collectPaths(_iauLineCache, shared).forEach(function (p) {
              p.style.opacity = '0';
            });
          }
          showLines('sky-line-cn');
          // z<4: gate CN label layers out of the map BEFORE the reveal below, so
          // removeHideRule + fadeLayers(...,true) act on detached markers (no
          // flash during the ~380ms animation). At z>=4 the preloaded label
          // layers are already on the map, so this is a no-op. See applyZoomVisibility.
          applyZoomVisibility();
          removeHideRule(_cnLabelHideStyle);
          _cnLabelHideStyle = null;

          // Start every animation together (a single 380ms window).
          _animating = true;
          var iauLabelFade = fadeLayers([_iauBounds, _iauNames, _iauStarLabels], false);
          fadeLayers([_cnNames, _cnStarLabels], true);
          await Promise.all([animateLines(iauOnlyPaths, false), animateLines(cnOnlyPaths, true)]);
          _animating = false;
        } else {
          // ---- Fallback path: preload incomplete or skipAnim ----
          var iauLabelFade = !_skipAnim
            ? fadeLayers([_iauBounds, _iauNames, _iauStarLabels], false)
            : Promise.resolve();

          // Build the CN layers on the spot.
          if (!_cnLines) _cnLines = L.layerGroup();
          if (!_map.hasLayer(_cnLines)) _map.addLayer(_cnLines);
          hideLines('sky-line-cn');
          var gmst = gmstDeg(date);
          updateLineFC(_linesC, _cnLines, _cnLineCache, gmst, 'sky-line-cn');
          cachePathLengths(_cnLineCache);
          if (!_cnNames) _cnNames = L.layerGroup();
          if (!_cnStarLabels) _cnStarLabels = L.layerGroup();
          if (!_map.hasLayer(_cnNames)) _map.addLayer(_cnNames);
          if (!_map.hasLayer(_cnStarLabels)) _map.addLayer(_cnStarLabels);
          var cnPlaced = updateNames(_cnNames, _cnNameCache, _namesC, gmst, 'cn');
          updateStarLabels(_cnStarLabels, _cnStarLabelCache, gmst, 'cn', cnPlaced);
          applyZoomVisibility();

          var cnOnlyPaths = collectPaths(_cnLineCache, shared, true);
          if (!_skipAnim) {
            // Hide the CN labels (faded in later).
            if (!_cnLabelHideStyle) {
              var s = document.createElement('style');
              s.textContent = '.sky-label-cn, .sky-label-star-cn { opacity: 0 !important; }';
              document.head.appendChild(s);
              _cnLabelHideStyle = s;
            }
            await waitFrame();
            // Prime the CN-only dashoffset.
            cnOnlyPaths.forEach(function (p) {
              var len = p._cachedLen || 0;
              if (!len) {
                try {
                  len = p.getTotalLength();
                } catch (e) {}
              }
              if (len) {
                p.style.transition = 'none';
                p.style.strokeDasharray = len;
                p.style.strokeDashoffset = len;
              }
            });
          }

          // Hand off the shared segments.
          if (shared && shared.size > 0) {
            collectPaths(_cnLineCache, shared).forEach(function (p) {
              p.style.opacity = '';
            });
            collectPaths(_iauLineCache, shared).forEach(function (p) {
              p.style.opacity = '0';
            });
          }
          showLines('sky-line-cn');

          if (!_skipAnim) {
            removeHideRule(_cnLabelHideStyle);
            _cnLabelHideStyle = null;
            // Collapse and expand in parallel.
            _animating = true;
            fadeLayers([_cnNames, _cnStarLabels], true);
            await Promise.all([animateLines(iauOnlyPaths, false), animateLines(cnOnlyPaths, true)]);
            _animating = false;
          } else {
            removeHideRule(_cnLabelHideStyle);
            _cnLabelHideStyle = null;
          }
        }
        // Ensure every CN path is visible (off-screen world copies may skip the animation).
        collectPaths(_cnLineCache).forEach(function (p) {
          p.style.opacity = '';
        });
        _cnPreloaded = false;

        // Correct positions after the animation (preloaded positions may be slightly off).
        update(date);

        // Cleanup: IAU lines stay on the map (CSS-hidden); only the non-line layers are removed.
        await iauLabelFade;
        // Reset the IAU paths' inline styles (the shared segments' opacity='0').
        collectPaths(_iauLineCache).forEach(function (p) {
          p.style.opacity = '';
        });
        hideLines('sky-line-iau'); // CSS-hide the IAU lines
        if (_iauBounds && _map.hasLayer(_iauBounds)) _map.removeLayer(_iauBounds);
        if (_iauNames && _map.hasLayer(_iauNames)) _map.removeLayer(_iauNames);
        if (_iauStarLabels && _map.hasLayer(_iauStarLabels)) _map.removeLayer(_iauStarLabels);
        applyZoomVisibility();
      } catch (e) {
        console.error('[sky] iau→cn error:', e);
      }
      return;
    }

    // ---- cn → stars: shrink CN lines ----
    if (from === 'cn' && mode === 'stars') {
      if (!_skipAnim) {
        // Fade the CN labels out (in parallel with the line collapse).
        var cnLabelFade = fadeLayers([_cnNames, _cnStarLabels], false);
        await waitFrame();
        const paths = collectPaths(_cnLineCache);
        _animating = true;
        await animateLines(paths, false);
        _animating = false;
        await cnLabelFade;
      }
      // CN lines stay on the map (CSS-hidden); after the collapse, reset inline styles and hide.
      collectPaths(_cnLineCache).forEach(function (p) {
        p.style.transition = '';
        p.style.strokeDasharray = '';
        p.style.strokeDashoffset = '';
        p.style.opacity = '';
      });
      removeCnLayers(); // hides lines via CSS, removes labels
      if (!_starsStarLabels) _starsStarLabels = L.layerGroup();
      if (!_map.hasLayer(_starsStarLabels) && !_overlaysSuppressed) _map.addLayer(_starsStarLabels);
      update(date);
      applyZoomVisibility();
      if (!_skipAnim) fadeLayers([_starsStarLabels], true);
      return;
    }

    // ---- stars → off: hide everything ----
    if (from === 'stars' && mode === 'off') {
      // Fade the star-dot canvas out alongside the star labels, then teardown.
      if (!_skipAnim && window.LayerFade) {
        await Promise.all([
          _starsStarLabels && _map.hasLayer(_starsStarLabels)
            ? fadeLayers([_starsStarLabels], false)
            : Promise.resolve(),
          LayerFade.fadePane(_map.getPane('sky-stars'), false),
        ]);
      } else if (_starsStarLabels && _map.hasLayer(_starsStarLabels)) {
        await fadeLayers([_starsStarLabels], false);
      }
      if (_starsStarLabels && _map.hasLayer(_starsStarLabels)) _map.removeLayer(_starsStarLabels);
      // Fully remove the persistent line DOM (off = full teardown).
      destroyIauLines();
      destroyCnLines();
      teardownSharedLayers();
      // Reset pane opacity (fade-out left it at 0) so the next off→stars cycle
      // starts clean.
      var _sp = _map.getPane('sky-stars');
      if (_sp) _sp.style.opacity = '';
      return;
    }

    // ---- Fallback for direct setMode calls (e.g. startup setMode('iau')) ----
    if (mode === 'off') {
      if (_starsStarLabels && _map.hasLayer(_starsStarLabels)) _map.removeLayer(_starsStarLabels);
      removeIauLayers();
      removeCnLayers();
      // Fully remove the persistent line DOM.
      destroyIauLines();
      destroyCnLines();
      teardownSharedLayers();
      return;
    }

    // Direct jump to stars/iau/cn from any state
    if (from !== 'off' && from !== 'stars') {
      removeIauLayers();
      removeCnLayers();
    }
    if (_starsStarLabels && _map.hasLayer(_starsStarLabels)) _map.removeLayer(_starsStarLabels);
    ensureSharedLayers();
    if (mode === 'iau') {
      await loadIau();
      if (!_iauSegKeys) {
        _iauSegKeys = buildSegKeySet(_linesW);
      }
      if (!_skipAnim) hideLines('sky-line-iau');
      addIauLayers();
    } else if (mode === 'cn') {
      await loadCn();
      if (!_cnSegKeys) {
        _cnSegKeys = buildSegKeySet(_linesC);
      }
      if (!_skipAnim) hideLines('sky-line-cn');
      addCnLayers();
    }
    update(date);
    applyZoomVisibility();
    var fbHideRef = mode === 'iau' ? _iauLineHideStyle : _cnLineHideStyle;
    if (!_skipAnim && fbHideRef) {
      await waitFrame();
      const cache = mode === 'iau' ? _iauLineCache : _cnLineCache;
      const paths = collectPaths(cache);
      _animating = true;
      await animateLines(paths, true, undefined, fbHideRef);
      if (mode === 'iau') _iauLineHideStyle = null;
      else _cnLineHideStyle = null;
      _animating = false;
    } else if (!_skipAnim) {
      // No hide rule — show directly.
      showLines(mode === 'iau' ? 'sky-line-iau' : 'sky-line-cn');
    } else {
      showLines(mode === 'iau' ? 'sky-line-iau' : 'sky-line-cn');
    }
  }

  function cycleMode() {
    let next;
    if (_mode === 'off') next = 'stars';
    else if (_mode === 'stars' && _prevMode === 'off') next = 'iau';
    else if (_mode === 'stars' && _prevMode === 'cn') next = 'off';
    else if (_mode === 'iau') next = 'cn';
    else if (_mode === 'cn') next = 'stars';
    else next = 'off';
    setMode(next);
    return next;
  }

  function update(date) {
    if (_mode === 'off' || !_starsLayer) return;
    const gmst = gmstDeg(date);
    updateStarPositions(gmst);
    if (_dsoLayer) updateDSOPositions(gmst);

    if (_mode === 'iau' && _loaded.iau) {
      if (_iauLines) updateLineFC(_linesW, _iauLines, _iauLineCache, gmst, 'sky-line-iau');
      if (_iauBounds) updateBoundsFC(_boundsW, _iauBounds, _iauBoundsCache, gmst);
      const iauPlaced = _iauNames ? updateNames(_iauNames, _iauNameCache, _namesW, gmst, 'iau') : false;
      if (_iauStarLabels) updateStarLabels(_iauStarLabels, _iauStarLabelCache, gmst, 'iau', iauPlaced);
    } else if (_mode === 'cn' && _loaded.cn) {
      updateLineFC(_linesC, _cnLines, _cnLineCache, gmst, 'sky-line-cn');
      const cnPlaced = updateNames(_cnNames, _cnNameCache, _namesC, gmst, 'cn');
      updateStarLabels(_cnStarLabels, _cnStarLabelCache, gmst, 'cn', cnPlaced);
    } else if (_mode === 'stars' && _starsStarLabels) {
      updateStarLabels(_starsStarLabels, _starsStarLabelCache, gmst, 'stars', null);
    }
    const A = updateEyeAdaptation(date);
    // Apply adapted magnitude cutoff
    const baseCutoff = magCutoffForStarMarkers(_currentZoom);
    const adaptedCutoff = Lum.adaptedMagCutoff(baseCutoff, A);
    applyStarVisibility(adaptedCutoff);
    scheduleRefreshViewTiles(adaptedCutoff, gmst); // R4.F2
    // publish live context for canvas redraw + trigger one frame.
    _lastGmst = gmst;
    _lastCutoff = adaptedCutoff;
    _lastClickCutoff = magCutoffForStarClicks(_currentZoom);
    _redrawCanvas();
  }

  // ---- Star detail panel ----
  function fmtRA(deg) {
    let h = deg / 15;
    h = ((h % 24) + 24) % 24;
    const hh = Math.floor(h);
    const mFull = (h - hh) * 60;
    const mm = Math.floor(mFull);
    const ss = Math.round((mFull - mm) * 60);
    return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s`;
  }

  function fmtDec(deg) {
    const sign = deg < 0 ? '-' : '+';
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const mFull = (abs - d) * 60;
    const m = Math.floor(mFull);
    const s = Math.round((mFull - m) * 60);
    return `${sign}${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
  }

  function fmtDMS(deg) {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const mFull = (abs - d) * 60;
    const m = Math.floor(mFull);
    const s = Math.round((mFull - m) * 60);
    return `${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
  }

  function fmtLatLng(lat, lng) {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew}`;
  }

  function localObservation(star, date) {
    const obs = window.currentObserverLatLng;
    if (!obs || typeof Astronomy === 'undefined') return null;
    try {
      const time = Astronomy.MakeTime(date);
      const observer = new Astronomy.Observer(obs.lat, obs.lng, 0);
      // star.ra is in degrees; Horizon wants RA in hours.
      const hor = Astronomy.Horizon(time, observer, star.ra / 15, star.dec, 'normal');
      return { alt: hor.altitude, az: hor.azimuth, observer: obs };
    } catch (e) {
      return null;
    }
  }

  function compassDir(az) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
  }

  // ---- Hover popup (replaces sidebar-right star detail) ----
  let _starPopup = null;
  let _starPopupStar = null;

  function showStarPopup(star, latlng) {
    // Toggle: clicking the same star closes the popup.
    if (_starPopupStar === star && _starPopup && _map.hasLayer(_starPopup)) {
      closeStarPopup();
      return;
    }
    if (!_starPopup) {
      _starPopup = L.popup({
        className: 'sky-star-popup',
        offset: [0, -6],
        maxWidth: 300,
        autoPan: false,
        closeButton: true,
        closeOnClick: true,
      });
      _starPopup.on('remove', () => {
        _starPopupStar = null;
      });
    }
    _starPopup.setLatLng(latlng).setContent(renderStarCardHTML(star)).openOn(_map);
    _starPopupStar = star;
  }

  function closeStarPopup() {
    if (_starPopup && _map.hasLayer(_starPopup)) _map.closePopup(_starPopup);
    _starPopupStar = null;
  }

  // Build a compact card HTML for the popup. Same field set as the former
  // sidebar panel — kept under one selector (.sky-star-popup) so layout
  // adapts to popup width (≤ 300 px) automatically.
  function renderStarCardHTML(star, date) {
    return renderStarPanel(star, date);
  }

  // Primary display name for a star — the title shown on the info card: the Chinese
  // xingguan name (then a CJK designation) under CJK locales or the `cn` label mode,
  // the Latin proper/Bayer name otherwise. Exported so other modules (e.g. the
  // observer's great-circle label) name a star exactly as its card does.
  function starDisplayName(star) {
    const isCJK = typeof I18n !== 'undefined' && I18n.isZhOrJa();
    return isCJK || _mode === 'cn' ? tStarChinese(star) || tStarCJKDesig(star) || tStarLatin(star) : tStarLatin(star);
  }

  function renderStarPanel(star, date) {
    date = date || (typeof TimeState !== 'undefined' ? TimeState.current : new Date());
    const isCJK = typeof I18n !== 'undefined' && I18n.isZhOrJa();
    const primary = starDisplayName(star);
    const xgSuffix = _mode === 'cn' ? tStarXingguanSuffix(star) : null;
    const showBf = star.bf && (star.proper || tStarChinese(star));
    // Merge Bayer designation and xingguan alias into a single parenthetical.
    // Multiple aliases (joined by ，) are split and each converted to pinyin form:
    //   "Di (7β UMi · 2 Beiji)"  rather than "Di / 2 Northern Pole (7β UMi)"
    const xgDisplay = xgSuffix
      ? xgSuffix
          .split('，')
          .map((a) => _aliasDisplayPinyin(a.trim()))
          .join(' · ')
      : null;
    const _detailParts = [showBf ? star.bf : null, xgDisplay || null].filter(Boolean);
    const subtitle = _detailParts.length ? ` <span class="star-bf">(${_detailParts.join(' · ')})</span>` : '';
    const meaning = _mode === 'cn' ? tStarMeaning(star) : null;

    const ids = [];
    if (star.hip) ids.push(`<span${_glossAttr('catalog.hip')}>HIP ${star.hip}</span>`);
    if (star.hd) ids.push(`<span${_glossAttr('catalog.hd')}>HD ${star.hd}</span>`);
    if (star.hr) ids.push(`<span${_glossAttr('catalog.hr')}>HR ${star.hr}</span>`);

    const gmst = gmstDeg(date);
    const [subLat, subLon] = subStellar(star.ra, star.dec, gmst);
    const obs = localObservation(star, date);

    const distLine =
      star.d != null
        ? `<div class="info-row"><span class="label"${_glossAttr('distance')}>${_t('star.distance')}</span><span class="value">${(star.d * 3.26156).toFixed(2)} ly</span></div>`
        : '';

    let obsBlock = '';
    if (obs) {
      let riseSetLines = '';
      let circumpolar = false;
      try {
        const aTime = Astronomy.MakeTime(date);
        const observer = new Astronomy.Observer(obs.observer.lat, obs.observer.lng, 0);
        Astronomy.DefineStar(Astronomy.Body.Star1, star.ra / 15, star.dec, star.d != null ? star.d * 3.26156 : 1000);
        const rise = Astronomy.SearchRiseSet(Astronomy.Body.Star1, observer, +1, aTime, 1);
        const set = Astronomy.SearchRiseSet(Astronomy.Body.Star1, observer, -1, aTime, 1);
        if (!rise && !set) {
          circumpolar = true;
        } else if (rise && set) {
          const tz = typeof TimeState !== 'undefined' ? TimeState.timezone : 'UTC';
          const fmtT = (d) => {
            const parts = Intl.DateTimeFormat('en', {
              timeZone: tz,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).formatToParts(d);
            return parts.find((p) => p.type === 'hour').value + ':' + parts.find((p) => p.type === 'minute').value;
          };
          const riseStr = fmtT(rise.date);
          const setStr = fmtT(set.date);
          const suffix = setStr <= riseStr ? ' (' + _t('star.next_day') + ')' : '';
          riseSetLines = `
            <div class="info-row"><span class="label"${_glossAttr('visible_period')}>${_t('star.visible_period')}</span><span class="value">${riseStr}–${setStr}${suffix}</span></div>`;
        }
      } catch (_) {}
      const visTag = circumpolar
        ? obs.alt > 0
          ? _t('star.always_visible')
          : _t('star.always_invisible')
        : obs.alt > 0
          ? _t('star.visible_now')
          : _t('star.not_visible_now');
      obsBlock = `
        <div class="info-block">
          <div class="info-block-title">${_t('star.from_observer')} (${obs.observer.lat.toFixed(2)}°, ${obs.observer.lng.toFixed(2)}°)</div>
          <div class="info-row"><span class="label"${_glossAttr('altitude')}>${_t('star.altitude')}</span><span class="value">${obs.alt.toFixed(1)}° (${visTag})</span></div>
          <div class="info-row"><span class="label"${_glossAttr('azimuth')}>${_t('star.azimuth')}</span><span class="value">${obs.az.toFixed(1)}° (${compassDir(obs.az)})</span></div>
          ${riseSetLines}
        </div>`;
    }

    const nsLabel = subLat >= 0 ? 'N' : 'S';
    const ewLabel = subLon >= 0 ? 'E' : 'W';

    // Source: HYG catalog (positions/mag) always; Stellarium only in zh, where
    // the displayed Chinese star name is the sole Stellarium-derived content.
    const credits = GeoUtils.cardCredits([
      { name: 'HYG Database', url: 'https://github.com/astronexus/HYG-Database' },
      typeof I18n !== 'undefined' && I18n.isZh() ? { name: 'Stellarium', url: 'https://stellarium.org/' } : null,
    ]);

    return `
      <div class="star-panel">
        <h2 class="star-name">${primary}${subtitle}</h2>
        ${meaning ? `<div class="star-meaning">${meaning}</div>` : ''}
        ${ids.length ? `<div class="star-ids">${ids.join(' · ')}</div>` : ''}
        <div class="star-scroll">
        <div class="info-block">
          <div class="info-block-title">${_t('sky.object_data')}</div>
          <div class="info-row"><span class="label"${_glossAttr('ra')}>${_t('star.ra')}</span><span class="value">${fmtRA(star.ra)}</span></div>
          <div class="info-row"><span class="label"${_glossAttr('dec')}>${_t('star.dec')}</span><span class="value">${fmtDec(star.dec)}</span></div>
          <div class="info-row"><span class="label"${_glossAttr('magnitude')}>${_t('star.magnitude')}</span><span class="value">${star.mag.toFixed(2)}</span></div>
          ${star.sp ? `<div class="info-row"><span class="label"${_glossAttr('spectral_type')}>${_t('star.spectral_type')}</span><span class="value">${star.sp}</span></div>` : ''}
          ${Number.isFinite(star.ci) ? `<div class="info-row"><span class="label"${_glossAttr('color_index')}>B−V</span><span class="value">${star.ci.toFixed(3)}  ≈ ${Math.round(bvToTeff(star.ci))} K</span></div>` : ''}
          ${distLine}
        </div>
        <div class="info-block">
          <div class="info-block-title"${_glossAttr('substellar_point')}>${_t('star.substellar_point')}</div>
          <div class="info-row"><span class="label"${_glossAttr('latitude')}>${_t('star.latitude')}</span><span class="value">${fmtDMS(subLat)} ${nsLabel}</span></div>
          <div class="info-row"><span class="label"${_glossAttr('longitude')}>${_t('star.longitude')}</span><span class="value">${fmtDMS(subLon)} ${ewLabel}</span></div>
        </div>
        ${obsBlock}
        </div>
        ${credits}
      </div>`;
  }

  // ---- Public init ----
  async function init(map) {
    _map = map;
    _currentZoom = map.getZoom();
    ensurePanes();
    // Recompute label density on zoom change. Star-label set depends on the
    // adaptive magnitude cutoff; constellation labels and star positions are
    // unchanged but re-running update() is cheap enough.
    map.on('zoomend', () => {
      _currentZoom = map.getZoom();
      applyLineOpacity();
      applyBoundsOpacity();
      if (_mode !== 'off') {
        applyStarScale(_currentZoom);
        applyStarVisibility(magCutoffForStarMarkers(_currentZoom));
        applyZoomVisibility();
        if (typeof TimeState !== 'undefined') {
          update(TimeState.current || new Date());
        }
      }
    });
    let _lastSkyWrapsKey = '';
    map.on('moveend', () => {
      if (_mode !== 'off' && typeof TimeState !== 'undefined') {
        const _wk = GeoUtils.visibleWrapsFromBounds(map).join(',');
        if (_wk === _lastSkyWrapsKey) return;
        _lastSkyWrapsKey = _wk;
        update(TimeState.current || new Date());
      }
    });
    await loadCore();
    // If setMode was called before loadCore finished (race with AppState),
    // stars data was empty. Now it's loaded — rebuild and draw.
    if (_mode !== 'off' && _starMarkers.length === 0 && _stars.length > 0) {
      buildStars();
      buildDSOs();
      if (!_map.hasLayer(_starsLayer)) _map.addLayer(_starsLayer);
      if (_dsoLayer && !_map.hasLayer(_dsoLayer)) _map.addLayer(_dsoLayer);
      // Scale to current zoom BEFORE applying visibility — entries are built
      // at zS=1; without this, an initial-load at high zoom (e.g. URL ?z=10)
      // would leave _starScale=1 and dim stars wouldn't gain glow until the
      // user manually changes zoom.
      applyStarScale(_currentZoom);
      applyStarVisibility(magCutoffForStarMarkers(_currentZoom));
      update(TimeState && TimeState.current ? TimeState.current : new Date());
      applyZoomVisibility();
    }
    // Labels created during the setMode/loadCore race used an empty dict.
    // Flush and rebuild so every label gets correct locale text.
    {
      function flushInit(cache, lg) {
        if (!lg) return;
        for (const [, copies] of cache) for (const m of copies) lg.removeLayer(m);
        cache.clear();
      }
      flushInit(_iauNameCache, _iauNames);
      flushInit(_cnNameCache, _cnNames);
      flushInit(_iauStarLabelCache, _iauStarLabels);
      flushInit(_cnStarLabelCache, _cnStarLabels);
      if (_mode !== 'off') {
        update(TimeState && TimeState.current ? TimeState.current : new Date());
      }
    }
    if (typeof I18n !== 'undefined') {
      I18n.subscribe((loc) => {
        loadLocale(loc).then(() => {
          // Flush all label caches so update() recreates them with new text.
          // A textContent patch misses off-screen markers (getElement → null).
          function flushCache(cache, lg) {
            for (const [, copies] of cache) for (const m of copies) lg.removeLayer(m);
            cache.clear();
          }
          if (_iauNames) flushCache(_iauNameCache, _iauNames);
          if (_cnNames) flushCache(_cnNameCache, _cnNames);
          if (_iauStarLabels) flushCache(_iauStarLabelCache, _iauStarLabels);
          if (_cnStarLabels) flushCache(_cnStarLabelCache, _cnStarLabels);
          // Rebuild labels immediately with new locale text.
          if (_mode !== 'off') {
            update(typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date());
          }
          // Refresh open star popup with new locale
          if (_starPopupStar && _starPopup && _map && _map.hasLayer(_starPopup)) {
            _starPopup.setContent(renderStarCardHTML(_starPopupStar));
          }
          // Refresh open DSO popup with new locale
          if (_dsoPopupData && _dsoPopup && _map && _map.hasLayer(_dsoPopup)) {
            showDSOPopup(_dsoPopupData.dso, _dsoPopupData.latlng);
          }
          // Refresh open constellation / xingguan popup with new locale
          if (_constPopupRef && _constPopup && _map && _map.hasLayer(_constPopup)) {
            const ref = _constPopupRef;
            _constPopupRef = null; // bypass toggle-close
            showConstellationPopup(ref.kind, ref.id, ref.latlng);
          }
        });
      });
    }
    // Refresh the open star popup whenever time changes — its altitude/azimuth
    // and rise/set fields are time-dependent. renderStarCardHTML defaults its
    // date to TimeState.current, so re-running it picks up the new instant.
    // (DSO/constellation popups carry only static catalog data, so they're not
    // refreshed here.) Content-only: the popup stays anchored at the click point.
    if (typeof TimeState !== 'undefined') {
      TimeState.subscribe(() => {
        if (_starPopupStar && _starPopup && _map && _map.hasLayer(_starPopup)) {
          _starPopup.setContent(renderStarCardHTML(_starPopupStar));
        }
      });
    }
    // Warm IAU + CN constellation data during browser idle so the first
    // interactive stars→iau (and iau→cn) switch hits a parsed cache instead of
    // blocking the fade on fetch + JSON.parse + bakeFeatureBBoxes (the main
    // cause of first-switch stutter). Data only — line DOM stays viewport-built.
    _scheduleWarmPreload();
    return true;
  }

  let _warmScheduled = false;
  function _scheduleWarmPreload() {
    if (_warmScheduled) return;
    _warmScheduled = true;
    const run = async () => {
      try {
        await loadIau();
        if (!_iauSegKeys) _iauSegKeys = buildSegKeySet(_linesW);
      } catch (e) {}
      try {
        await loadCn();
        if (!_cnSegKeys) _cnSegKeys = buildSegKeySet(_linesC);
      } catch (e) {}
    };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 1200);
  }

  return {
    init,
    setMode,
    cycleMode,
    getMode: () => _mode,
    update,
    refreshDayMode,
    onStarClick: (cb) => {
      _starClickCb = cb;
    },
    setLocale: async (locale) => {
      await loadLocale(locale);
      // Flush all label caches so update() recreates them with new text.
      function flushCache(cache, lg) {
        for (const [, copies] of cache) for (const m of copies) lg.removeLayer(m);
        cache.clear();
      }
      if (_iauNames) flushCache(_iauNameCache, _iauNames);
      if (_cnNames) flushCache(_cnNameCache, _cnNames);
      if (_iauStarLabels) flushCache(_iauStarLabelCache, _iauStarLabels);
      if (_cnStarLabels) flushCache(_cnStarLabelCache, _cnStarLabels);
      if (_starsStarLabels) flushCache(_starsStarLabelCache, _starsStarLabels);
      if (_mode !== 'off') {
        update(typeof TimeState !== 'undefined' && TimeState.current ? TimeState.current : new Date());
      }
    },
    renderStarPanel,
    starDisplayName,
    tStar,
    tConst,
    tXingguan,
    showStarPopup,
    showDSOPopup,
    showConstellationPopup,
    // Live chromaScale / glowChromaScale. Recompute every entry's
    // cached _tint/_glowTint, drop the sprite cache (whose keys are derived
    // from those tint hexes), then redraw.
    setChromaScale: function (core, glow) {
      if (core !== undefined) Lum.params.chromaScale = core;
      if (glow !== undefined) Lum.params.glowChromaScale = glow;
      const gcs = Lum.params.glowChromaScale !== undefined ? Lum.params.glowChromaScale : 1.0;
      const visit = (e) => {
        if (!e || !e.star) return;
        e._tint = starTint(e.star);
        e._glowTint = starTint(e.star, gcs);
      };
      for (const e of _starMarkers) visit(e);
      forEachAttachedTileEntry(visit);
      if (_starsLayer && typeof _starsLayer.rebuildSpriteCache === 'function') {
        _starsLayer.rebuildSpriteCache();
      } else if (_starsLayer && typeof _starsLayer.redraw === 'function') {
        _starsLayer.redraw();
      }
    },
    // Glare alpha peak. Only the sprite cache needs invalidation —
    // entry tints unchanged.
    setGlareAlphaPeak: function (v) {
      Lum.params.glareAlphaPeak = v;
      if (_starsLayer && typeof _starsLayer.rebuildSpriteCache === 'function') {
        _starsLayer.rebuildSpriteCache();
      }
    },

    // Layer conflict API: hide/restore constellation overlays without changing _mode.
    // Used by enforceConflicts in map.js when eclipse layer activates.
    suppressOverlays: function () {
      _overlaysSuppressed = true;
      // Use separate conflict CSS rules — independent of setMode's animation hide rules
      // so that setMode animations removing _iauLineHideStyle don't break suppression.
      if (!_conflictIauHideStyle) {
        _conflictIauHideStyle = document.createElement('style');
        _conflictIauHideStyle.textContent = '.sky-line-iau, .sky-line-iau-shadow { opacity: 0 !important; }';
        document.head.appendChild(_conflictIauHideStyle);
      }
      if (!_conflictCnHideStyle) {
        _conflictCnHideStyle = document.createElement('style');
        _conflictCnHideStyle.textContent = '.sky-line-cn, .sky-line-cn-shadow { opacity: 0 !important; }';
        document.head.appendChild(_conflictCnHideStyle);
      }
      // Remove non-line layers from map
      if (_iauBounds && _map && _map.hasLayer(_iauBounds)) _map.removeLayer(_iauBounds);
      if (_iauNames && _map && _map.hasLayer(_iauNames)) _map.removeLayer(_iauNames);
      if (_iauStarLabels && _map && _map.hasLayer(_iauStarLabels)) _map.removeLayer(_iauStarLabels);
      if (_cnNames && _map && _map.hasLayer(_cnNames)) _map.removeLayer(_cnNames);
      if (_cnStarLabels && _map && _map.hasLayer(_cnStarLabels)) _map.removeLayer(_cnStarLabels);
      if (_starsStarLabels && _map && _map.hasLayer(_starsStarLabels)) _map.removeLayer(_starsStarLabels);
    },

    restoreOverlays: function () {
      _overlaysSuppressed = false;
      // Remove the conflict-owned CSS rules
      if (_conflictIauHideStyle) {
        _conflictIauHideStyle.remove();
        _conflictIauHideStyle = null;
      }
      if (_conflictCnHideStyle) {
        _conflictCnHideStyle.remove();
        _conflictCnHideStyle = null;
      }
      if (!_map || _mode === 'off') return;
      if (_mode === 'iau') {
        if (_iauBounds && !_map.hasLayer(_iauBounds)) _map.addLayer(_iauBounds);
        if (_iauNames && !_map.hasLayer(_iauNames)) _map.addLayer(_iauNames);
        if (_iauStarLabels && !_map.hasLayer(_iauStarLabels)) _map.addLayer(_iauStarLabels);
      } else if (_mode === 'cn') {
        if (_cnNames && !_map.hasLayer(_cnNames)) _map.addLayer(_cnNames);
        if (_cnStarLabels && !_map.hasLayer(_cnStarLabels)) _map.addLayer(_cnStarLabels);
      } else if (_mode === 'stars') {
        if (_starsStarLabels && !_map.hasLayer(_starsStarLabels)) _map.addLayer(_starsStarLabels);
      }
      applyZoomVisibility();
    },
  };
})();
