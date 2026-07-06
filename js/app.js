/**
 * app.js — top-level wiring + time-control panel (dark theme A).
 */
function bootTimeControl() {
  const tzAnchor = document.getElementById('tc-tz');
  const tzLabel = document.getElementById('tc-tz-label');
  const fieldsBox = document.getElementById('tc-fields');
  // Six segmented inputs, keyed by unit. FIELD_ORDER fixes tab / auto-advance
  // order; FIELD_LEN drives the leading-zero pad and the maxlength auto-jump.
  const FIELD_ORDER = ['y', 'mo', 'd', 'h', 'mi', 's'];
  const FIELD_LEN = { y: 4, mo: 2, d: 2, h: 2, mi: 2, s: 2 };
  const F = {};
  FIELD_ORDER.forEach((k) => {
    F[k] = document.getElementById('tc-in-' + k);
  });
  const lunarEl = document.getElementById('tc-lunar');
  const phaseEl = document.getElementById('tc-phase');
  const track = document.getElementById('tc-track');
  const cursor = document.getElementById('tc-cursor');

  const playBtn = document.getElementById('tc-play');
  const speedBox = document.getElementById('tc-speed');
  const nowBtn = document.getElementById('tc-now');

  const scaleWash = track.querySelector('.scale-wash');
  const scaleDaylight = track.querySelector('.scale-daylight');
  const scaleSunCurve = document.getElementById('tc-sun-curve');
  const scaleTicks = track.querySelector('.scale-ticks');
  const scaleLabels = document.getElementById('tc-labels');

  const langAnchor = document.getElementById('tc-lang');
  const langLabel = document.getElementById('tc-lang-label');

  // Dark, keyboard-navigable dropdown replacing a native <select> on the bottom
  // rail. The rail sits at the screen bottom, so the list opens upward (CSS
  // bottom:100%). getOptions() runs on every open because timezone labels are
  // DST-dynamic. Behaviour mirrors the places.js search dropdown (outside-click
  // dismissal, arrow/enter/escape keys, role=listbox/option).
  function createRailSelect(anchor, opts) {
    const align = opts.align || 'left';
    let list = null,
      items = [],
      highlightIdx = -1;

    function close() {
      if (!list) return;
      list.remove();
      list = null;
      highlightIdx = -1;
      anchor.setAttribute('aria-expanded', 'false');
    }

    function setHighlight(i) {
      const lis = list.querySelectorAll('.rail-dropdown-item');
      if (highlightIdx >= 0 && lis[highlightIdx]) lis[highlightIdx].classList.remove('is-active');
      highlightIdx = i;
      if (i >= 0 && lis[i]) {
        lis[i].classList.add('is-active');
        lis[i].scrollIntoView({ block: 'nearest' });
      }
    }

    function choose(value) {
      close();
      anchor.focus();
      opts.onSelect(value);
    }

    function open() {
      if (list) return;
      items = opts.getOptions() || [];
      const current = opts.getCurrent();
      list = document.createElement('ul');
      list.className = 'rail-dropdown';
      list.setAttribute('role', 'listbox');
      let selIdx = -1;
      items.forEach((it, i) => {
        const li = document.createElement('li');
        li.className = 'rail-dropdown-item';
        li.setAttribute('role', 'option');
        li.textContent = it.label;
        if (it.value === current) {
          li.classList.add('is-selected');
          li.setAttribute('aria-selected', 'true');
          selIdx = i;
        }
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          choose(it.value);
        });
        li.addEventListener('mouseenter', () => setHighlight(i));
        list.appendChild(li);
      });
      // Append to <body> (fixed-position) rather than inside the anchor: the rail
      // (#time-bar) clips overflow, which would hide an upward-opening child.
      const ar = anchor.getBoundingClientRect();
      list.style.minWidth = ar.width + 'px';
      document.body.appendChild(list);
      anchor.setAttribute('aria-expanded', 'true');
      // Position: open upward above the anchor, clamped into the viewport.
      const lw = list.offsetWidth,
        lh = list.offsetHeight;
      let top = ar.top - 6 - lh;
      if (top < 8) top = 8;
      let left = align === 'right' ? ar.right - lw : ar.left;
      left = Math.max(8, Math.min(left, window.innerWidth - lw - 8));
      list.style.top = Math.round(top) + 'px';
      list.style.left = Math.round(left) + 'px';
      if (selIdx >= 0) {
        setHighlight(selIdx);
        const sel = list.children[selIdx]; // centre the selection in the scroll area
        list.scrollTop = sel.offsetTop - list.clientHeight / 2 + sel.clientHeight / 2;
      }
    }

    anchor.addEventListener('click', (e) => {
      if (list && list.contains(e.target)) return; // item clicks handle themselves
      if (list) close();
      else open();
    });
    anchor.addEventListener('keydown', (e) => {
      if (!list) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          open();
          setHighlight(highlightIdx < 0 ? 0 : highlightIdx);
        }
        return;
      }
      const lis = list.querySelectorAll('.rail-dropdown-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight(Math.min(highlightIdx + 1, lis.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight(Math.max(highlightIdx - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIdx >= 0) choose(items[highlightIdx].value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
        anchor.focus();
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (list && !anchor.contains(e.target) && !list.contains(e.target)) close();
    });
    window.addEventListener('resize', close);
  }

  // ---- Language Switcher ----
  const LANG_NAMES = {
    'zh-Hans': '简体中文',
    'zh-Hant': '繁體中文',
    en: 'English',
    fr: 'Français',
    es: 'Español',
    it: 'Italiano',
    ja: '日本語',
  };

  function syncLangLabel() {
    const current = typeof I18n !== 'undefined' ? I18n.getLocale() : 'zh-Hans';
    langLabel.textContent = LANG_NAMES[current] || current;
  }
  if (typeof I18n !== 'undefined') {
    syncLangLabel();
    createRailSelect(langAnchor, {
      align: 'right',
      getOptions: () => I18n.SUPPORTED.map((loc) => ({ value: loc, label: LANG_NAMES[loc] || loc })),
      getCurrent: () => I18n.getLocale(),
      onSelect: (v) => {
        I18n.setLocale(v);
        syncLangLabel();
      },
    });
  }

  // ---- Speed Selector (1x / 10x / 60x / 360x / 3600x) ----
  let currentSpeed = 60;
  function setSpeed(s) {
    currentSpeed = s;
    speedBox.querySelectorAll('.rail-rate').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.speed) === s);
    });
    if (TimeState.isPlaying()) TimeState.setPlaySpeed(s);
  }
  speedBox.addEventListener('click', (e) => {
    const b = e.target.closest('.rail-rate[data-speed]');
    if (!b) return;
    setSpeed(Number(b.dataset.speed));
  });

  // ---- Timezone Dropdown ----
  // tz label text is kept current by the display tick (tzOffsetLabel); the list
  // rebuilds from TimeState.timezones on every open (DST-dependent labels).
  createRailSelect(tzAnchor, {
    align: 'left',
    getOptions: () => TimeState.timezones,
    getCurrent: () => TimeState.timezone,
    onSelect: (v) => TimeState.setTimezone(v),
  });

  // ---- Helpers ----
  function tzPartsAt(date) {
    const parts = Intl.DateTimeFormat('en', {
      timeZone: TimeState.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const g = (t) => parts.find((p) => p.type === t).value;
    return {
      y: +g('year'),
      mo: +g('month'),
      d: +g('day'),
      h: +g('hour'),
      mi: +g('minute'),
      s: +g('second'),
    };
  }

  function tzOffsetLabel(date) {
    const parts = Intl.DateTimeFormat('en', {
      timeZone: TimeState.timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value || 'UTC';
    // Normalise "GMT+8" / "GMT-05:30" → "UTC+8" / "UTC-5:30"
    return name.replace(/^GMT/, 'UTC').replace(/^UTC$/, 'UTC+0');
  }

  // ---- Lunar / Moon-Age Label (multilingual) ----
  const _t =
    typeof I18n !== 'undefined'
      ? I18n.t.bind(I18n)
      : function (k) {
          return k;
        };

  const CN_NUMS = [
    '零',
    '一',
    '二',
    '三',
    '四',
    '五',
    '六',
    '七',
    '八',
    '九',
    '十',
    '十一',
    '十二',
    '十三',
    '十四',
    '十五',
    '十六',
    '十七',
    '十八',
    '十九',
    '二十',
    '廿一',
    '廿二',
    '廿三',
    '廿四',
    '廿五',
    '廿六',
    '廿七',
    '廿八',
    '廿九',
    '三十',
  ];

  function getCnMonths() {
    return Array.from({ length: 12 }, (_, i) => _t('lunar.month.' + (i + 1)));
  }

  function getLunarPhaseLabel_zh(lunarDay) {
    const anchors = {
      1: _t('lunar.anchor.new_moon'),
      8: _t('lunar.anchor.first_quarter'),
      15: _t('lunar.anchor.full_moon'),
      23: _t('lunar.anchor.last_quarter'),
    };
    if (anchors[lunarDay]) return anchors[lunarDay];
    const anchorDays = [1, 8, 15, 23];
    let prev = anchorDays.filter((d) => d < lunarDay).pop();
    if (!prev) prev = 23;
    const diff = lunarDay - prev > 0 ? lunarDay - prev : lunarDay + 30 - prev;
    return _t('lunar.day_after', { anchor: anchors[prev], n: CN_NUMS[diff] || diff });
  }

  function lunarLabels(date) {
    const p = tzPartsAt(date);
    const useZhJa = typeof I18n !== 'undefined' && I18n.isZhOrJa();

    if (useZhJa) {
      try {
        if (!window.Lunar) return { md: '—', phase: '—' };
        const solar = Solar.fromYmd(p.y, p.mo, p.d);
        const lunar = solar.getLunar();
        const stem = lunar.getYearInGanZhi();
        const cnMonths = getCnMonths();
        const month = cnMonths[lunar.getMonth() - 1] || lunar.getMonthInChinese() + '月';
        const day = lunar.getDayInChinese();
        const md = `${stem}年${month}${day}`;
        const lunarDay = lunar.getDay();
        const phase = getLunarPhaseLabel_zh(lunarDay);
        const anchorKey = { 1: 'new', 8: 'first_quarter', 15: 'full', 23: 'last_quarter' };
        const phaseKey =
          anchorKey[lunarDay] ||
          (window.SunCalc && typeof moonPhaseKey === 'function'
            ? moonPhaseKey(SunCalc.getMoonIllumination(date).phase)
            : null);
        return { md, phase, phaseKey };
      } catch (e) {
        return { md: '—', phase: '—' };
      }
    }

    // en/fr/es: moon age in #tc-lunar, phase name in #tc-phase (separated by the
    // #tc-phase-dot ·). Splitting them gives each its own hover target — moon-age
    // gloss on #tc-lunar (refreshDisplay) and the phase gloss on #tc-phase.
    if (!window.SunCalc) return { md: '—', phase: '—' };
    const illum = SunCalc.getMoonIllumination(date);
    const ageDays = Math.round(illum.phase * 29.53);
    const phaseName = typeof moonPhaseName === 'function' ? moonPhaseName(illum.phase) : '';
    const md = _t('time.moon_age', { days: ageDays });
    return { md, phase: phaseName };
  }

  // ---- Responsive Ticks & Labels ----
  function renderTicksAndLabels() {
    const width = track.clientWidth;
    if (!width) return; // track hidden (collapsed drawer) — re-rendered on expand
    const intervals = [1, 2, 3, 4, 6, 12];
    const idealCount = Math.max(3, Math.round(width / 80));
    let bestInterval = 6;
    let bestDiff = Infinity;
    for (const iv of intervals) {
      const count = 24 / iv + 1;
      const diff = Math.abs(count - idealCount);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestInterval = iv;
      }
    }
    scaleLabels.innerHTML = '';
    scaleTicks.innerHTML = '';
    for (let h = 0; h <= 24; h += bestInterval) {
      const pct = (h / 24) * 100 + '%';
      const span = document.createElement('span');
      span.textContent = String(h).padStart(2, '0');
      span.style.left = pct;
      scaleLabels.appendChild(span);
      const tick = document.createElement('i');
      tick.style.left = pct;
      scaleTicks.appendChild(tick);
    }
  }
  renderTicksAndLabels();
  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(renderTicksAndLabels, 150);
  });

  // ---- SunCalc-Driven Scale Rendering ----
  // Renders night wash (two-end cool gradient) from SunCalc.
  let _lastScaleKey = '';

  function pctOfLocalTime(date) {
    const p = tzPartsAt(date);
    return ((p.h * 3600 + p.mi * 60 + p.s) / 86400) * 100;
  }

  function renderScale(date) {
    const obs = window.currentObserverLatLng ||
      (window.appMap && window.appMap.getCenter && window.appMap.getCenter()) || { lat: 35, lng: 105 };
    if (!window.SunCalc) return;

    const p = tzPartsAt(date);
    const key = p.y + '-' + p.mo + '-' + p.d + '|' + obs.lat.toFixed(2) + ',' + obs.lng.toFixed(2);
    if (key === _lastScaleKey) return;
    _lastScaleKey = key;

    // Build a Date for midnight in the display timezone
    const midnightISO = `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')} 00:00:00`;
    const midnightUTC = TimeState.parseISO(midnightISO);
    if (!midnightUTC) return;

    // SunCalc times for this day at the observer location
    const t = SunCalc.getTimes(midnightUTC, obs.lat, obs.lng);

    // ---- Night wash (two-end cool gradient): 0→nightEnd and night→100 ----
    if (t.nightEnd && !isNaN(t.nightEnd) && t.night && !isNaN(t.night)) {
      const a = pctOfLocalTime(t.nightEnd);
      const b = pctOfLocalTime(t.night);
      scaleWash.style.background = `linear-gradient(90deg,
           rgba(28,40,60,.20) 0%, rgba(40,56,82,.14) ${a.toFixed(1)}%, transparent ${a.toFixed(1)}%,
           transparent ${b.toFixed(1)}%, rgba(40,56,82,.14) ${b.toFixed(1)}%, rgba(28,40,60,.20) 100%)`;
    } else {
      const midAlt = SunCalc.getPosition(midnightUTC, obs.lat, obs.lng).altitude;
      scaleWash.style.background = midAlt < -0.314 ? 'rgba(28,40,60,.16)' : 'transparent';
    }

    // ---- Daylight overlay: sample sun altitude every 30 min ----
    const mid0 = midnightUTC.getTime();
    const stops = [];
    const altSamples = [];
    for (let i = 0; i <= 48; i++) {
      const sample = new Date(mid0 + (i / 48) * 86400000);
      const altDeg = (SunCalc.getPosition(sample, obs.lat, obs.lng).altitude * 180) / Math.PI;
      const frac = altDeg >= 0 ? 1 : altDeg <= -18 ? 0 : (altDeg + 18) / 18;
      stops.push(`rgba(231,227,218,${(0.06 * frac).toFixed(4)}) ${((i / 48) * 100).toFixed(1)}%`);
      altSamples.push({ pct: (i / 48) * 100, altDeg });
    }
    scaleDaylight.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
    renderSunCurve(altSamples);
  }

  function renderSunCurve(samples) {
    while (scaleSunCurve.firstChild) scaleSunCurve.removeChild(scaleSunCurve.firstChild);
    const segments = [];
    let cur = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.altDeg > 0) {
        if (cur.length === 0 && i > 0) {
          const prev = samples[i - 1];
          const f = -prev.altDeg / (s.altDeg - prev.altDeg);
          cur.push({ pct: prev.pct + f * (s.pct - prev.pct), altDeg: 0 });
        }
        cur.push(s);
      } else if (cur.length > 0) {
        const prev = samples[i - 1];
        const f = prev.altDeg / (prev.altDeg - s.altDeg);
        cur.push({ pct: prev.pct + f * (s.pct - prev.pct), altDeg: 0 });
        segments.push(cur);
        cur = [];
      }
    }
    if (cur.length > 0) segments.push(cur);

    const NS = 'http://www.w3.org/2000/svg';
    for (const seg of segments) {
      const pts = seg.map((p) => {
        const y = 18 - (Math.min(p.altDeg, 90) / 90) * 13; /* clamp peak to y=5 = band top */
        return `${p.pct.toFixed(2)},${y.toFixed(2)}`;
      });
      const d = `M${pts.join(' L')}`;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      scaleSunCurve.appendChild(path);
    }
  }

  // ---- Cursor Position — single SVG so line and dot share the exact same x ----
  function refreshCursor(date) {
    const p = tzPartsAt(date);
    const frac = (p.h + p.mi / 60 + p.s / 3600) / 24;
    const W = track.clientWidth || 0;
    const H = track.clientHeight || 30;
    const xc = (frac * W).toFixed(2);
    cursor.setAttribute('width', W);
    cursor.setAttribute('height', H);
    cursor.innerHTML =
      `<line x1="${xc}" y1="2" x2="${xc}" y2="18" stroke="#b0946b" stroke-width="1.2" vector-effect="non-scaling-stroke" ` +
      `style="filter:drop-shadow(0 0 2px rgba(176,148,107,0.4))"/>` +
      `<circle cx="${xc}" cy="-0.5" r="2.5" fill="#b0946b" ` +
      `style="filter:drop-shadow(0 0 3px rgba(176,148,107,0.9)) drop-shadow(0 0 6px rgba(176,148,107,0.6)) drop-shadow(0 0 11px rgba(176,148,107,0.35))"/>`;
  }

  // ---- Slider Drag/Click → set time-of-day within current local day ----
  function setTimeOfDayFromTrack(clientX) {
    const rect = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const totalSec = Math.min(86399, Math.round(f * 86400));
    const h = Math.floor(totalSec / 3600);
    const mi = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const p = tzPartsAt(TimeState.current);
    const iso =
      `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')} ` +
      `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const utc = TimeState.parseISO(iso);
    if (utc) TimeState.setTime(utc);
  }

  let dragging = false;
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    scaleDaylight.style.opacity = '1';
    setTimeOfDayFromTrack(e.clientX);
  });
  track.addEventListener('pointermove', (e) => {
    if (dragging) setTimeOfDayFromTrack(e.clientX);
  });
  track.addEventListener('pointerup', (e) => {
    dragging = false;
    try {
      track.releasePointerCapture(e.pointerId);
    } catch (_) {}
    scaleDaylight.style.opacity = '0';
  });
  track.addEventListener('pointercancel', () => {
    dragging = false;
    scaleDaylight.style.opacity = '0';
  });

  // ---- Display Refresh (subscribes to TimeState) ----
  function syncPlayBtn(isPlaying) {
    playBtn.setAttribute('aria-pressed', String(isPlaying));
    const shape = playBtn.querySelector('.play-shape');
    if (shape) shape.setAttribute('d', isPlaying ? 'M3,2 H7 V14 H3 Z M9,2 H13 V14 H9 Z' : 'M3,2 L14,8 L3,14 Z');
    const _t =
      typeof I18n !== 'undefined'
        ? I18n.t.bind(I18n)
        : function (k) {
            return k;
          };
    playBtn.setAttribute('aria-label', isPlaying ? _t('time.pause') : _t('time.play'));
  }

  function refreshDisplay(date) {
    const d = date || TimeState.current;
    const p = tzPartsAt(d);
    // Repaint every field except the one being typed in, so the 1 Hz / playback
    // refresh keeps unfocused fields live without clobbering active input.
    FIELD_ORDER.forEach((k) => {
      const el = F[k];
      if (el === document.activeElement) return;
      el.value = String(p[k]).padStart(FIELD_LEN[k], '0');
    });
    tzLabel.textContent = tzOffsetLabel(d);
    const lab = lunarLabels(d);
    lunarEl.textContent = lab.md;
    phaseEl.textContent = lab.phase;
    // Moon-age hover (Western locales only — CJK/ja show a sexagenary-lunar calendar label here,
    // which is a different concept). Plain text stays in #tc-lunar; the definition
    // rides on data-gloss (themed card, js/glossary-tip.js).
    if (lab.md && typeof I18n !== 'undefined' && !I18n.isZhOrJa()) {
      lunarEl.dataset.gloss = I18n.gloss('moon_age');
    } else {
      lunarEl.removeAttribute('data-gloss');
    }
    // Hover glossary on the phase label. For zh/ja, the display follows the
    // lunar-calendar anchor system (day 8 = 上弦 etc.), so the glossary key
    // must come from the same map (via lab.phaseKey) rather than being
    // re-derived from the SunCalc fraction, which diverges from the calendar
    // anchor on boundary days and would produce a name/definition mismatch.
    const _glossPhaseKey =
      lab.phaseKey ||
      (typeof SunCalc !== 'undefined' && SunCalc.getMoonIllumination && typeof moonPhaseKey === 'function'
        ? moonPhaseKey(SunCalc.getMoonIllumination(d).phase)
        : null);
    if (lab.phase && _glossPhaseKey && typeof I18n !== 'undefined') {
      phaseEl.dataset.gloss = I18n.gloss('moonphase.' + _glossPhaseKey);
    } else {
      phaseEl.removeAttribute('data-gloss');
    }
    const lunarDot = document.getElementById('tc-phase-dot');
    if (lunarDot) lunarDot.style.display = lab.phase ? '' : 'none';
    phaseEl.style.display = lab.phase ? '' : 'none';
    refreshCursor(d);
    renderScale(d);
  }
  TimeState.subscribe((date) => refreshDisplay(date || TimeState.current));

  // ---- Transient Toast (range / invalid-input feedback) ----
  function showTimeToast(msg) {
    let toast = document.getElementById('time-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'time-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(showTimeToast._t);
    showTimeToast._t = setTimeout(() => toast.classList.remove('visible'), 3500);
  }
  // Fired whenever any entry point clamps a date to the 2000–2099 window.
  // (`_t` is the module-scope translation helper declared above.)
  TimeState.onRangeClamp(() => {
    showTimeToast(_t('time.range.limit'));
    syncPlayBtn(TimeState.isPlaying()); // playback may have auto-stopped at the edge
  });

  // ---- Hold-To-Repeat ----
  // Shared press-and-hold: fire once on pointerdown, then after HOLD_DELAY repeat at
  // REPEAT_MS until the pointer releases/cancels/leaves. Used by both the time-field
  // steppers and the bottom-bar jump buttons. `fire(btn)` returning false suppresses
  // the repeat (one-shot controls like "Now"). Keyboard activation reports detail 0,
  // so it fires once via click; pointer-driven clicks are ignored since pointerdown
  // already fired — this keeps keyboard support without double-firing on mouse/touch.
  const HOLD_DELAY = 400,
    REPEAT_MS = 80;
  function attachHoldRepeat(container, selector, fire) {
    let timer = null,
      interval = null;
    const stop = () => {
      clearTimeout(timer);
      clearInterval(interval);
      timer = interval = null;
    };

    container.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest(selector);
      if (!btn || !container.contains(btn)) return;
      e.preventDefault(); // suppress text selection and the synthetic mouse click
      if (fire(btn) === false) return; // fire first (immediate feedback); one-shot → no repeat
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (_) {
        // Ignore — capture is a nicety for tracking the hold, not required to fire
      }
      timer = setTimeout(() => {
        interval = setInterval(() => fire(btn), REPEAT_MS);
      }, HOLD_DELAY);
    });
    container.addEventListener('pointerup', (e) => {
      stop();
      e.target.closest(selector)?.blur();
    });
    container.addEventListener('pointercancel', stop);
    container.addEventListener('pointerleave', (e) => {
      if (e.target.closest(selector)) stop();
    });
    container.addEventListener('click', (e) => {
      const btn = e.target.closest(selector);
      if (btn && container.contains(btn) && e.detail === 0) fire(btn);
    });
  }

  // ---- Jump Buttons (incl. Now) ----
  // Returns false for the one-shot "Now" (and no-op) so attachHoldRepeat won't repeat it.
  function _railJump(jump) {
    if (jump === 'now') {
      TimeState.stopPlayback();
      syncPlayBtn(false);
      TimeState.now();
      return false;
    }
    const m = jump.match(/^([+-])(\d+)([ymwdh])$/);
    if (!m) return false;
    const sign = m[1] === '+' ? 1 : -1;
    const amount = parseInt(m[2], 10) * sign;
    switch (m[3]) {
      case 'y':
        TimeState.adjustYears(amount);
        break;
      case 'm':
        TimeState.adjustMonths(amount);
        break;
      case 'w':
        TimeState.adjustDays(amount * 7);
        break;
      case 'd':
        TimeState.adjustDays(amount);
        break;
      case 'h':
        TimeState.adjustHours(amount);
        break;
    }
  }

  const railRow = document.querySelector('.rail-row2');
  if (railRow) attachHoldRepeat(railRow, '.rail-jump[data-jump]', (btn) => _railJump(btn.dataset.jump));

  // ---- Narrow-Screen Drawer: collapse/expand the timeline + extra controls ----
  // The `.rail-expanded` class only has a visual effect at ≤768px (see the CSS
  // media block). Collapsed shows just readout + play/Now/language; expanding
  // reveals the timeline, speed, and all jump buttons. State persists for the
  // session (mirrors the sidebar panel pattern in js/sidebar.js).
  const RAIL_EXPAND_KEY = 'substellaratlas.railExpanded';
  const timeBar = document.getElementById('time-bar');
  const handleBtn = document.getElementById('tc-handle');
  function _setRailExpanded(expanded, persist) {
    if (!timeBar) return;
    timeBar.classList.toggle('rail-expanded', expanded);
    if (handleBtn) handleBtn.setAttribute('aria-expanded', String(expanded));
    if (persist) {
      try {
        sessionStorage.setItem(RAIL_EXPAND_KEY, expanded ? '1' : '0');
      } catch (_) {}
    }
    // The track had zero width while collapsed; force a reflow then re-render the
    // ticks against its now-real width, and resync --rail-h so the sidebars track
    // the new bottom inset. (__syncRailHeight may not exist yet at first boot call.)
    if (timeBar) void timeBar.offsetWidth;
    renderTicksAndLabels();
    if (window.__syncRailHeight) window.__syncRailHeight();
  }

  let _railInit = false;
  try {
    _railInit = sessionStorage.getItem(RAIL_EXPAND_KEY) === '1';
  } catch (_) {}
  _setRailExpanded(_railInit, false);
  if (handleBtn) {
    handleBtn.addEventListener('click', () => {
      _setRailExpanded(!timeBar.classList.contains('rail-expanded'), true);
    });
  }

  // ---- Play / Pause ----
  playBtn.addEventListener('click', () => {
    if (TimeState.isPlaying()) {
      TimeState.stopPlayback();
      syncPlayBtn(false);
    } else {
      TimeState.startPlayback(currentSpeed);
      syncPlayBtn(true);
    }
  });
  // Double-click → "loop tonight" (preserved from previous wiring)
  playBtn.addEventListener('dblclick', () => {
    try {
      const obs = window.currentObserverLatLng ||
        (window.appMap && window.appMap.getCenter && window.appMap.getCenter()) || { lat: 0, lng: 0 };
      const info = typeof getSunMoonInfo === 'function' ? getSunMoonInfo(obs.lat, obs.lng, TimeState.current) : null;
      if (info && info.astroDusk && info.astroDawn) {
        TimeState.resetTo(info.astroDusk);
        if (!TimeState.isPlaying()) {
          TimeState.startPlayback(currentSpeed);
          syncPlayBtn(true);
        }
      }
    } catch (_) {
      /* fail silent */
    }
  });

  // ---- Segmented Date/Time Fields (per-unit input + hover steppers) ----
  // Assemble the six fields into a local ISO string and route it through the
  // existing parseISO → setTime → clamp path. Blank fields fall back to the
  // current value (revert); typed out-of-range values are clamped (day to the
  // month length), matching the previous single-field behaviour.
  function _commitFields() {
    const cur = tzPartsAt(TimeState.current);
    const read = (k, lo, hi) => {
      const raw = F[k].value.trim();
      if (raw === '') return { v: cur[k], raw: null };
      return { v: Math.max(lo, Math.min(hi, parseInt(raw, 10) || 0)), raw: parseInt(raw, 10) };
    };
    const yr = read('y', 2000, 2099);
    if (yr.raw != null && (yr.raw < 2000 || yr.raw > 2099)) showTimeToast(_t('time.range.limit'));
    const y = yr.v;
    const mo = read('mo', 1, 12).v;
    const maxD = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const d = read('d', 1, maxD).v;
    const h = read('h', 0, 23).v;
    const mi = read('mi', 0, 59).v;
    const s = read('s', 0, 59).v;
    const iso =
      `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ` +
      `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const utc = TimeState.parseISO(iso);
    if (utc) TimeState.setTime(TimeState.clampDate(utc));
    else refreshDisplay();
  }

  // Step one unit up/down, reusing the carry-correct TimeState adjusters.
  const _STEP = {
    y: (n) => TimeState.adjustYears(n),
    mo: (n) => TimeState.adjustMonths(n),
    d: (n) => TimeState.adjustDays(n),
    h: (n) => TimeState.adjustHours(n),
    mi: (n) => TimeState.adjustMinutes(n),
    s: (n) => TimeState.adjustSeconds(n),
  };
  function _step(unit, dir) {
    if (TimeState.isPlaying()) {
      TimeState.stopPlayback();
      syncPlayBtn(false);
    }
    if (_STEP[unit]) _STEP[unit](dir);
  }

  // First-digit can't be extended → auto-advance early (e.g. month "2", hour "3").
  const _MAX_FIRST = { mo: 1, d: 3, h: 2, mi: 5, s: 5 };
  function _focusField(k) {
    const el = F[k];
    if (el) {
      el.focus();
      el.select();
    }
  }

  FIELD_ORDER.forEach((k, idx) => {
    const el = F[k];
    el.addEventListener('focus', () => {
      if (TimeState.isPlaying()) {
        TimeState.stopPlayback();
        syncPlayBtn(false);
      }
      el.select();
    });
    el.addEventListener('blur', _commitFields);
    el.addEventListener('input', () => {
      const cleaned = el.value.replace(/\D/g, '').slice(0, FIELD_LEN[k]);
      if (cleaned !== el.value) el.value = cleaned;
      const next = FIELD_ORDER[idx + 1];
      const full = cleaned.length >= FIELD_LEN[k];
      const cap = cleaned.length === 1 && _MAX_FIRST[k] != null && +cleaned > _MAX_FIRST[k];
      if (next && (full || cap)) _focusField(next);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        el.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        refreshDisplay();
        el.blur();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _step(k, 1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        _step(k, -1);
      } else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && el.selectionEnd === 0 && idx > 0) {
        e.preventDefault();
        _focusField(FIELD_ORDER[idx - 1]);
      } else if (
        e.key === 'ArrowRight' &&
        el.selectionStart === el.value.length &&
        el.selectionEnd === el.value.length &&
        FIELD_ORDER[idx + 1]
      ) {
        e.preventDefault();
        _focusField(FIELD_ORDER[idx + 1]);
      }
    });
  });

  // Delegated stepper press-and-hold (see attachHoldRepeat under Jump Buttons).
  attachHoldRepeat(fieldsBox, '.tc-step', (btn) => _step(btn.dataset.unit, parseInt(btn.dataset.dir, 10)));

  // Accessible labels for the fields + steppers (re-applied on locale change).
  const _FIELD_KEY = { y: 'year', mo: 'month', d: 'day', h: 'hour', mi: 'minute', s: 'second' };
  function _applyFieldAria() {
    FIELD_ORDER.forEach((k) => {
      const name = _t('time.field.' + _FIELD_KEY[k]);
      F[k].setAttribute('aria-label', name);
      const wrap = F[k].closest('.tc-field');
      const up = wrap && wrap.querySelector('.tc-step.up');
      const dn = wrap && wrap.querySelector('.tc-step.down');
      if (up) up.setAttribute('aria-label', _t('time.step.up', { unit: name }));
      if (dn) dn.setAttribute('aria-label', _t('time.step.down', { unit: name }));
    });
  }
  _applyFieldAria();
  if (typeof I18n !== 'undefined' && I18n.subscribe) I18n.subscribe(_applyFieldAria);

  // ---- Boot ----
  async function _boot() {
    if (typeof I18n !== 'undefined') {
      await I18n.init(I18n.detectLocale());
      TimeState.initTimezone(I18n.getLocale());
      I18n.applyDOM();
      _applyFieldAria();
      syncLangLabel();
    }
    I18n.subscribe(function () {
      I18n.applyDOM();
      syncLangLabel();
      refreshDisplay(TimeState.current);
      syncPlayBtn(TimeState.isPlaying());
      if (typeof Sky !== 'undefined') Sky.setLocale(I18n.getLocale());
    });

    window.appMap = initMap();
    setSpeed(60);
    syncPlayBtn(false);
    refreshDisplay(TimeState.current);
    if (typeof AppState !== 'undefined') {
      AppState.applyFromURL();
      AppState.startWatching();
    }

    function _syncRailHeight() {
      const rail = document.getElementById('time-bar');
      if (rail) document.documentElement.style.setProperty('--rail-h', `${rail.offsetHeight}px`);
      // Measure the layer-toggle group's bottom so the sidebars can keep an
      // equal gap above (below the toggle) and below (above the rail).
      const toggle = document.querySelector('.layer-toggle-control');
      if (toggle)
        document.documentElement.style.setProperty(
          '--toggle-bottom',
          `${Math.round(toggle.getBoundingClientRect().bottom)}px`
        );
    }
    _syncRailHeight();
    window.__syncRailHeight = _syncRailHeight; // for the drawer toggle (_setRailExpanded)
    window.addEventListener('resize', _syncRailHeight);

    // Top-toolbar anti-collision (two ordered stages so the response is
    // progressive and monotonic — "icons first, search last"):
    //   1. Layer-rail Priority+ overflow drops icons one-by-one into the flyout,
    //      always measuring against the search box's FULL (360px) footprint. The
    //      search width is NOT factored back into the icon math, so it can't
    //      flood icons back onto the rail (no sawtooth).
    //   2. Once the icons can no longer make room, the search box absorbs the
    //      remaining squeeze by shrinking CONTINUOUSLY — its left edge is pinned
    //      a constant GAP from the rail's right edge, so the inter-group gap stays
    //      fixed all the way down to MIN_W instead of snapping 360→80. Because the
    //      width is derived from the live measured rail edge, the handoff from
    //      "icons dropping (width clamped at 360)" to "search shrinking" is seamless.
    function _syncToolbarCompact() {
      // Stage 1: shed rail icons first (against the constant full-search reserve).
      if (window.__syncLayerOverflow) window.__syncLayerOverflow();
      // Stage 2: drive a fluid search width from the measured geometry. The search
      // box is right-anchored, so changing its width only moves its LEFT edge —
      // its right edge is stable and independent of the width we set, making it a
      // safe reference. We want searchLeft == railRight + GAP, i.e.
      //   width = searchRight − (railRight + GAP), clamped to [MIN_W, MAX_W].
      const root = document.querySelector('.layer-toggle-root');
      const input = document.querySelector('.places-search input');
      if (!root || !input) return;
      const railRight = root.getBoundingClientRect().right;
      const searchRight = input.getBoundingClientRect().right; // right-anchored, stable
      const GAP = 16,
        MIN_W = 120,
        MAX_W = 420,
        FULL_W = 360;
      // Fluid fill: the search left edge is pinned a constant GAP from the rail's
      // right edge. Capped at MAX_W so the box doesn't grow oversized on ultra-wide
      // screens; excess space then pools between the rail and the search left edge.
      // Floored at MIN_W; by the time the box would shrink past it, stage 1 has
      // already shed icons into the flyout.
      const restW = Math.min(MAX_W, Math.max(MIN_W, Math.round(searchRight - railRight - GAP)));
      input.style.setProperty('--search-rest', restW + 'px');
      // `.toolbar-compact` means "search is squeezed below full width" — it only
      // switches the focus-expand behavior to a leftward map overlay. The resting
      // width itself comes from --search-rest above (no binary snap).
      document.documentElement.classList.toggle('toolbar-compact', restW < FULL_W);
    }
    _syncToolbarCompact();
    window.addEventListener('resize', _syncToolbarCompact);
  }
  _boot();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootTimeControl);
} else {
  bootTimeControl();
}
