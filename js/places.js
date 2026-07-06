/** places.js — GeoNames place search, reverse geocoding, and coordinate parsing. */
const Places = (() => {
  const _t = typeof I18n !== 'undefined' ? I18n.t.bind(I18n) : (k) => k;

  // ── State ──
  let _data = null;
  let _admin1Dict = null; // { "CN.30": ["Guangdong", "Province de...", ...] }
  let _loading = null;
  let _grid = null; // Map<"lat_lon", number[]>
  let _searchEntries = null; // [{norm, rowIdx, original}]
  let _lastReverse = null; // {row, dist, bearing, lat, lng}
  let _map = null;

  // ── Locale helpers ──
  const LANG_IDX = { en: 0, fr: 1, es: 2, ja: 3, 'zh-Hans': 4, 'zh-Hant': 5 };

  function _langIndex() {
    if (typeof I18n === 'undefined') return 0;
    const loc = I18n.getLocale();
    if (loc === 'zh-CN' || loc === 'zh-Hans') return 4;
    if (loc === 'zh-TW' || loc === 'zh-Hant') return 5;
    return LANG_IDX[loc] ?? 0;
  }

  function _cityName(row) {
    const names = row[5];
    const idx = _langIndex();
    return names[idx] || names[0] || row[6] || '';
  }

  function _admin1Name(code) {
    if (!code || !_admin1Dict || !_admin1Dict[code]) return code || '';
    const names = _admin1Dict[code];
    const idx = _langIndex();
    return names[idx] || names[0] || code;
  }

  // ── Lazy loading ──
  function ensureLoaded() {
    if (_data) return Promise.resolve();
    if (_loading) return _loading;
    _loading = _doLoad().catch((err) => {
      console.warn('[places] Load failed:', err);
      _loading = null;
      throw err;
    });
    return _loading;
  }

  async function _doLoad() {
    const resp = await fetch('data/places/cities.json.gz');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = await resp.arrayBuffer();
    const json = JSON.parse(pako.ungzip(new Uint8Array(buf), { to: 'string' }));
    _data = json;
    _admin1Dict = json.admin1 || {};
    _buildGrid();
    _buildSearchIndex();
  }

  // ── Spatial grid ──
  function _buildGrid() {
    _grid = new Map();
    const rows = _data.rows;
    for (let i = 0; i < rows.length; i++) {
      const key = Math.floor(rows[i][0]) + '_' + Math.floor(rows[i][1]);
      let bucket = _grid.get(key);
      if (!bucket) {
        bucket = [];
        _grid.set(key, bucket);
      }
      bucket.push(i);
    }
  }

  function _getCandidates(lat, lon) {
    const baseLat = Math.floor(lat);
    const baseLon = Math.floor(lon);
    const indices = [];
    const highLat = Math.abs(lat) > 70;

    if (highLat) {
      // At high latitudes, scan all longitudes in the latitude band
      for (let dLat = -1; dLat <= 1; dLat++) {
        const bLat = baseLat + dLat;
        for (let bLon = -180; bLon < 180; bLon++) {
          const b = _grid.get(bLat + '_' + bLon);
          if (b) for (const idx of b) indices.push(idx);
        }
      }
    } else {
      for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLon = -1; dLon <= 1; dLon++) {
          let bLon = baseLon + dLon;
          // Antimeridian wrap
          if (bLon > 179) bLon -= 360;
          if (bLon < -180) bLon += 360;
          const b = _grid.get(baseLat + dLat + '_' + bLon);
          if (b) for (const idx of b) indices.push(idx);
        }
      }
    }
    return indices;
  }

  // ── Reverse geocoding ──
  const COMPASS_KEYS = [
    'compass.n',
    'compass.ne',
    'compass.e',
    'compass.se',
    'compass.s',
    'compass.sw',
    'compass.w',
    'compass.nw',
  ];

  function _bearing(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const dLon = (lon2 - lon1) * toRad;
    const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
    const x =
      Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
      Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }

  function _compassDir(deg) {
    const idx = Math.round(deg / 45) % 8;
    return _t(COMPASS_KEYS[idx]);
  }

  function _compassDirWithPrefix(deg) {
    const dir = _compassDir(deg);
    const loc = typeof I18n !== 'undefined' ? I18n.getLocale() : 'en';
    if ((loc === 'zh-Hans' || loc === 'zh-CN' || loc === 'zh-Hant' || loc === 'zh-TW') && dir.length === 1) {
      return '以' + dir;
    }
    return dir;
  }

  function _formatDist(km) {
    const loc = typeof I18n !== 'undefined' ? I18n.getLocale() : 'en';
    const nf = new Intl.NumberFormat(loc, {
      maximumFractionDigits: km < 10 ? 1 : 0,
      minimumFractionDigits: 0,
    });
    return nf.format(km) + ' ' + _t('unit.km');
  }

  function reverse(lat, lng) {
    if (!_data) return null;
    const lon = GeoUtils.normLng(lng);

    let candidates = _getCandidates(lat, lon);
    // Fallback: if grid returns nothing (ocean/remote), brute-force all rows
    if (candidates.length === 0) {
      candidates = [];
      for (let i = 0; i < _data.rows.length; i++) candidates.push(i);
    }

    let bestIdx = -1,
      bestDist = Infinity;
    for (const idx of candidates) {
      const row = _data.rows[idx];
      const d = GeoUtils.haversine(lat, lon, row[0], row[1]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    }
    if (bestIdx < 0) return null;

    const row = _data.rows[bestIdx];
    const brng = _bearing(row[0], row[1], lat, lon);

    _lastReverse = { row, dist: bestDist, bearing: brng, lat, lng };
    return _lastReverse;
  }

  function getPlaceLineHtml() {
    if (!_lastReverse) return '';
    const { row, dist, bearing } = _lastReverse;
    const city = _cityName(row);

    let text;
    if (dist < 20) {
      text = city;
    } else {
      const dir = _compassDirWithPrefix(bearing);
      const loc = typeof I18n !== 'undefined' ? I18n.getLocale() : 'en';
      const isCJK = loc === 'zh-Hans' || loc === 'zh-CN' || loc === 'zh-Hant' || loc === 'zh-TW';
      const cityVal = isCJK && /[A-Za-z]$/.test(city) ? city + ' ' : city;
      text = _t('place.bearing', { city: cityVal, dir, dist: _formatDist(dist) });
    }
    return '<div class="place-name">' + text + '</div>';
  }

  function reverseAndRender(lat, lng) {
    reverse(lat, lng);
    _updatePlaceLine();
  }

  function _updatePlaceLine() {
    const el = document.getElementById('place-name-line');
    if (el) el.innerHTML = _lastReverse ? getPlaceLineHtml() : '';
  }

  // ── Search index ──
  function _normalize(str) {
    return str.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  }

  function _buildSearchIndex() {
    _searchEntries = [];
    const rows = _data.rows;
    for (let i = 0; i < rows.length; i++) {
      const names = rows[i][5];
      const ascii = rows[i][6];
      const seen = new Set();
      for (let j = 0; j < names.length; j++) {
        if (names[j] && !seen.has(names[j])) {
          seen.add(names[j]);
          _searchEntries.push({ norm: _normalize(names[j]), original: names[j], rowIdx: i });
        }
      }
      if (ascii && !seen.has(ascii)) {
        seen.add(ascii);
        _searchEntries.push({ norm: _normalize(ascii), original: ascii, rowIdx: i });
      }
      // Extra search names (native name + other languages like de, pt, etc.)
      const extras = rows[i][8];
      if (extras) {
        for (const ex of extras) {
          if (!seen.has(ex)) {
            seen.add(ex);
            _searchEntries.push({ norm: _normalize(ex), original: ex, rowIdx: i });
          }
        }
      }
    }
  }

  function _fcodeBonus(fcode) {
    if (fcode === 'PPLC') return 3;
    if (fcode && fcode.startsWith('PPLA')) return 2;
    return 0;
  }

  // ── Coordinate parsing ──
  function _deg(axis) {
    return `(?<${axis}_deg>[+-]?\\d+\\.\\d+)°?`;
  }

  function _degInt(axis) {
    return `(?<${axis}_deg>\\d+)[°\\s]+`;
  }

  function _degMin(axis) {
    return `(?<${axis}_deg>\\d+)[°\\s]+(?<${axis}_min>[\\d.]+)[′']*`;
  }

  function _degMinSec(axis) {
    return `(?<${axis}_deg>\\d+)[°\\s]+(?<${axis}_min>\\d+)[′'\\s]+(?<${axis}_sec>[\\d.]+)[″"]*`;
  }

  const _COORD_REGEXES = [
    // DMS with direction prefix:  N 35° 43′ 43″ E 109° 43′ 43″
    new RegExp(`^(?<ns>[NS])\\s*${_degMinSec('lat')}[\\s,]+(?<ew>[EW])\\s*${_degMinSec('lon')}$`, 'i'),
    // DMS with direction suffix:  35°43′43″N 109°43′43″E
    new RegExp(`^${_degMinSec('lat')}\\s*(?<ns>[NS])[\\s,]+${_degMinSec('lon')}\\s*(?<ew>[EW])$`, 'i'),
    // Deg-min with direction prefix:  N 40° 26.767′ W 79° 58.933′
    new RegExp(`^(?<ns>[NS])\\s*${_degMin('lat')}[\\s,]+(?<ew>[EW])\\s*${_degMin('lon')}$`, 'i'),
    // Deg-min with direction suffix:  40° 26.767′ N 79° 58.933′ W
    new RegExp(`^${_degMin('lat')}\\s*(?<ns>[NS])[\\s,]+${_degMin('lon')}\\s*(?<ew>[EW])$`, 'i'),
    // Decimal deg with direction prefix:  N 43.71° W 79.4°
    new RegExp(`^(?<ns>[NS])\\s*${_deg('lat')}[\\s,]+(?<ew>[EW])\\s*${_deg('lon')}$`, 'i'),
    // Decimal deg with direction suffix:  43.71°N 79.4°W
    new RegExp(`^${_deg('lat')}\\s*(?<ns>[NS])[\\s,]+${_deg('lon')}\\s*(?<ew>[EW])$`, 'i'),
    // Plain numbers:  30.5388 114.3532  or  [30.5388, 114.3532]
    new RegExp(`^\\[?(?<a_deg>[+-]?\\d+\\.\\d+)[\\s,]+(?<b_deg>[+-]?\\d+\\.\\d+)\\]?$`),
  ];

  function _dmsToDecimal(deg, min, sec) {
    return parseFloat(deg) + parseFloat(min || 0) / 60 + parseFloat(sec || 0) / 3600;
  }

  function _parseCoords(query) {
    const q = query.trim();
    for (let i = 0; i < _COORD_REGEXES.length; i++) {
      const m = q.match(_COORD_REGEXES[i]);
      if (!m) continue;
      const g = m.groups;

      // Last regex: plain numbers — no N/S/E/W
      if (i === _COORD_REGEXES.length - 1) {
        const a = parseFloat(g.a_deg);
        const b = parseFloat(g.b_deg);
        if (isNaN(a) || isNaN(b)) return null;
        const aAbs = Math.abs(a),
          bAbs = Math.abs(b);
        if (aAbs > 180 || bAbs > 180) return null;
        // One value > 90 → must be longitude
        if (aAbs > 90 && bAbs <= 90) return { lat: b, lon: a };
        if (bAbs > 90 && aAbs <= 90) return { lat: a, lon: b };
        if (aAbs > 90 && bAbs > 90) return null; // both > 90, invalid
        // Both ≤ 90 → ambiguous
        return {
          ambiguous: true,
          options: [
            { lat: a, lon: b },
            { lat: b, lon: a },
          ],
        };
      }

      // Directed formats: N/S/E/W present
      let lat = _dmsToDecimal(g.lat_deg, g.lat_min, g.lat_sec);
      let lon = _dmsToDecimal(g.lon_deg, g.lon_min, g.lon_sec);
      if (g.ns.toUpperCase() === 'S') lat = -lat;
      if (g.ew.toUpperCase() === 'W') lon = -lon;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      return { lat, lon };
    }
    return null;
  }

  function _formatCoordName(lat, lon) {
    const latAbs = Math.abs(lat).toFixed(4);
    const lonAbs = Math.abs(lon).toFixed(4);

    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';
    return `${latAbs}°${ns}, ${lonAbs}°${ew}`;
  }

  function _coordResult(lat, lon) {
    return {
      name: _formatCoordName(lat, lon),
      admin1: '',
      lat: lat,
      lng: lon,
      isCoord: true,
    };
  }

  function search(query) {
    if (!_data || !_searchEntries || !query) return [];
    const normQ = _normalize(query);
    if (!normQ) return [];

    const matchMap = new Map(); // rowIdx → {score, entry}
    for (const entry of _searchEntries) {
      const isPrefix = entry.norm.startsWith(normQ);
      const isSubstr = !isPrefix && entry.norm.includes(normQ);
      if (!isPrefix && !isSubstr) continue;

      const row = _data.rows[entry.rowIdx];
      const pop = row[4] || 1;
      const score = (isPrefix ? 5 : 0) + Math.log10(pop + 1) + _fcodeBonus(row[3]);

      const existing = matchMap.get(entry.rowIdx);
      if (!existing || score > existing.score) {
        matchMap.set(entry.rowIdx, { score, entry });
      }
    }

    const sorted = [...matchMap.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 8);

    return sorted.map(([rowIdx]) => {
      const row = _data.rows[rowIdx];
      return {
        name: _cityName(row),
        admin1: _admin1Name(row[7]),
        lat: row[0],
        lng: row[1],
      };
    });
  }

  // ── Search box UI ──
  function mountSearchBox(map) {
    _map = map;

    const SearchControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const container = L.DomUtil.create('div', 'places-search leaflet-control');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        const input = L.DomUtil.create('input', '', container);
        input.type = 'text';
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', 'places-results');
        input.setAttribute('aria-label', _t('search.placeholder'));

        // Outer box owns the visual slab (background/ring/max-height) and holds
        // two independent flex children — the scrollable option list and the
        // credit footer below it — so the footer has its own reserved space
        // instead of overlaying results that haven't scrolled into view yet.
        const wrap = L.DomUtil.create('div', 'places-results', container);
        wrap.hidden = true;

        const list = L.DomUtil.create('ul', 'places-list', wrap);
        list.id = 'places-results';
        list.setAttribute('role', 'listbox');

        let composing = false;
        let debounceTimer = null;
        let queryId = 0;
        let highlightIdx = -1;

        function closeDropdown() {
          wrap.hidden = true;
          list.innerHTML = '';
          input.setAttribute('aria-expanded', 'false');
          highlightIdx = -1;
        }

        function _fmtGeoCoord(lat, lon) {
          return (
            Math.abs(lon).toFixed(3) +
            '°' +
            (lon >= 0 ? 'E' : 'W') +
            ', ' +
            Math.abs(lat).toFixed(3) +
            '°' +
            (lat >= 0 ? 'N' : 'S')
          );
        }

        function _fmtCelCoord(ra, dec) {
          if (ra == null || dec == null) return '';
          const h = Math.floor(ra / 15);
          const m = Math.floor((ra / 15 - h) * 60);
          const sign = dec >= 0 ? '+' : '−';
          return h + 'h ' + String(m).padStart(2, '0') + 'm, ' + sign + Math.abs(dec).toFixed(3) + '°';
        }

        // Persistent GeoNames attribution — a `wrap` sibling of `list`, not a list
        // <li>, so it sits in its own reserved footer space below the scrollable
        // results rather than overlaying them. Not role="option" so keyboard
        // navigation skips it. One node reused across renders (content re-set,
        // not recreated) so a language switch mid-session still lands.
        const credit = L.DomUtil.create('div', 'places-credit', wrap);
        credit.setAttribute('aria-hidden', 'true');
        credit.hidden = true;
        function showCreditFooter() {
          const osmLink =
            '<a href="https://github.com/OSMChina/OSMChina-coverage" target="_blank" rel="noopener">OSMChina</a>';
          credit.innerHTML =
            '© <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0)' +
            ' | ' +
            _t('credits.osmchina').replace('{link}', osmLink);
          credit.hidden = false;
        }

        function renderResults(results) {
          list.innerHTML = '';
          if (results.length === 0) {
            const li = document.createElement('li');
            li.className = 'places-no-results';
            li.textContent = _t('search.noResults');
            list.appendChild(li);
            showCreditFooter();
            wrap.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            return;
          }
          results.forEach((r, i) => {
            const li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.id = 'places-opt-' + i;
            if (r.isCelestial) {
              li.className = 'places-celestial';
              const meta = r.meta ? '<span class="places-meta">（' + r.meta + '）</span>' : '';
              // Eclipses carry a ground point (umbral centre / sub-lunar point at
              // greatest eclipse), not a fixed RA/Dec — show it as a geographic coord.
              const coord =
                r.kind === 'eclipse' && r.lat != null ? _fmtGeoCoord(r.lat, r.lng) : _fmtCelCoord(r.ra, r.dec);
              li.innerHTML =
                '<span class="search-badge badge-' +
                r.kind +
                '">' +
                r.badge +
                '</span>' +
                '<span class="places-main"><span class="places-city">' +
                r.name +
                '</span>' +
                meta +
                '</span>' +
                (coord ? '<span class="places-coord">' + coord + '</span>' : '');
            } else {
              const meta = r.admin1 ? '<span class="places-meta">（' + r.admin1 + '）</span>' : '';
              const coord = r.lat != null && r.lng != null ? _fmtGeoCoord(r.lat, r.lng) : '';
              li.innerHTML =
                '<span class="places-main"><span class="places-city">' +
                r.name +
                '</span>' +
                meta +
                '</span>' +
                (coord ? '<span class="places-coord">' + coord + '</span>' : '');
            }
            li.addEventListener('mousedown', (e) => {
              e.preventDefault();
              selectResult(r);
            });
            list.appendChild(li);
          });
          showCreditFooter();
          wrap.hidden = false;
          input.setAttribute('aria-expanded', 'true');
          highlightIdx = -1;
        }

        function setHighlight(idx) {
          const items = list.querySelectorAll('li[role="option"]');
          items.forEach((li, i) => {
            li.setAttribute('aria-selected', i === idx ? 'true' : 'false');
          });
          highlightIdx = idx;
          if (idx >= 0 && items[idx]) {
            input.setAttribute('aria-activedescendant', items[idx].id);
          } else {
            input.removeAttribute('aria-activedescendant');
          }
        }

        function selectResult(r) {
          closeDropdown();
          input.value = r.name;
          input.blur();

          if (r.isCelestial) {
            if (typeof CelestialSearch !== 'undefined') CelestialSearch.select(r, map);
            return;
          }

          const centerLng = map.getCenter().lng;
          const targetLng = r.lng + 360 * Math.round((centerLng - r.lng) / 360);
          const zoom = Math.max(map.getZoom(), r.isCoord ? 10 : 8);

          const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          map.flyTo([r.lat, targetLng], zoom, { animate: !reducedMotion });

          if (typeof window.enterLocationMode === 'function') {
            window.enterLocationMode(r.lat, r.lng);
          }

          // Lock + show the compass immediately (marker placed just above). The compass
          // follows the flyTo via its own map 'move' subscription and re-syncs on moveend,
          // so deferring to moveend is unnecessary — and unsafe: a near-zero flyTo may
          // never fire moveend, leaving the observer unlocked (no c=1 in the permalink).
          if (typeof Observer !== 'undefined' && Observer.lockAndShowCompass) {
            Observer.lockAndShowCompass();
          }
          if (typeof Sidebar !== 'undefined' && Sidebar.show) {
            Sidebar.show(r.lat, r.lng);
          }
          if (typeof LightPollution !== 'undefined' && LightPollution.fetch) {
            LightPollution.fetch(r.lat, r.lng, 2024, (err, data) => {
              if (err) {
                Sidebar.showLightPollution({ outOfBounds: false, error: err.message });
              } else {
                Sidebar.showLightPollution(data);
              }
            });
          }
          // Reverse-geocode is funnelled through enterLocationMode (above) →
          // Observer.place → onPlace, so it is not duplicated here.
        }

        function doSearch() {
          const q = input.value.trim();
          if (!q) {
            closeDropdown();
            return;
          }

          const coord = _parseCoords(q);
          if (coord && !coord.ambiguous) {
            renderResults([_coordResult(coord.lat, coord.lon)]);
            return;
          }
          if (coord && coord.ambiguous) {
            renderResults(coord.options.map((o) => _coordResult(o.lat, o.lon)));
            return;
          }

          const myId = ++queryId;

          // Celestial results (gated by active layers) appear above place results.
          const celActive = typeof CelestialSearch !== 'undefined' && CelestialSearch.isActive();
          const celP = celActive
            ? CelestialSearch.ensureLoaded()
                .then(() => CelestialSearch.search(q))
                .catch(() => [])
            : Promise.resolve([]);
          const placeP = ensureLoaded()
            .then(() => search(q))
            .catch(() => null);

          Promise.all([celP, placeP]).then(([cel, places]) => {
            if (myId !== queryId) return;
            if (places === null && cel.length === 0) {
              const li = document.createElement('li');
              li.className = 'places-no-results';
              li.textContent = _t('search.unavailable');
              list.innerHTML = '';
              list.appendChild(li);
              credit.hidden = true;
              wrap.hidden = false;
              input.setAttribute('aria-expanded', 'true');
              return;
            }
            renderResults([...cel, ...(places || [])]);
          });
        }

        input.addEventListener('compositionstart', () => {
          composing = true;
        });
        input.addEventListener('compositionend', () => {
          composing = false;
          doSearch();
        });
        input.addEventListener('input', () => {
          if (composing) return;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(doSearch, 180);
        });

        input.addEventListener('focus', () => {
          ensureLoaded().catch(() => {});
          if (input.value.trim()) doSearch();
        });
        // Close on a mousedown outside the search container. NOT on input blur —
        // blur-close would wipe the dropdown the instant the user presses the mouse
        // on the credit text to select/copy it. Leaflet's disableClickPropagation
        // (applied above) stops in-dropdown mousedowns from reaching document, so
        // selecting text inside the dropdown keeps it open.
        document.addEventListener('mousedown', (e) => {
          if (!wrap.hidden && !container.contains(e.target)) closeDropdown();
        });

        input.addEventListener('keydown', (e) => {
          const items = list.querySelectorAll('li[role="option"]');
          if (!items.length) return;

          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight(Math.min(highlightIdx + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight(Math.max(highlightIdx - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightIdx >= 0 && highlightIdx < items.length) {
              items[highlightIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            }
          } else if (e.key === 'Escape') {
            closeDropdown();
            input.blur();
          }
        });

        this._input = input;
        return container;
      },
    });

    const ctrl = new SearchControl();
    ctrl.addTo(map);

    // Store ref for i18n updates
    _searchCtrl = ctrl;
  }

  let _searchCtrl = null;

  // ── i18n subscription ──
  if (typeof I18n !== 'undefined') {
    I18n.subscribe(() => {
      _updatePlaceLine();
      if (_searchCtrl && _searchCtrl._input) {
        _searchCtrl._input.setAttribute('aria-label', _t('search.placeholder'));
      }
    });
  }

  return {
    ensureLoaded,
    reverse,
    reverseAndRender,
    getPlaceLineHtml,
    search,
    mountSearchBox,
  };
})();
