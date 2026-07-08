/**
 * sidebar.js — Dual location-info sidebars: the right panel inspects the clicked
 * point (sun/moon/planet almanac, galactic core, eclipses, light pollution,
 * aurora, satellites), the left panel browses the eclipse list and detail.
 */
const Sidebar = (() => {
  const _t =
    typeof I18n !== 'undefined'
      ? I18n.t.bind(I18n)
      : function (k) {
          return k;
        };
  // ` data-gloss="…"` attribute (by slug) for a term label — themed definition
  // card on hover (js/glossary-tip.js). Works on both HTML and SVG elements.
  const _glossAttr =
    typeof I18n !== 'undefined'
      ? I18n.glossAttr.bind(I18n)
      : function () {
          return '';
        };
  // Raw glossary text (for row() tips, which build the attribute themselves).
  const _gloss =
    typeof I18n !== 'undefined'
      ? I18n.gloss.bind(I18n)
      : function () {
          return '';
        };
  // ` data-gloss="…"` attribute from already-resolved text (not a slug), e.g.
  // row()/timeRow()/twilightTable() tips that are pre-translated tooltip strings.
  function _glossTip(text) {
    if (!text) return '';
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return ' data-gloss="' + esc + '"';
  }

  let _lat = null;
  let _lng = null;

  let _weatherData = null; // last fetched weather payload (for highlight updates)
  let _weatherInitDate = null;

  // Light-pollution section state. The section mirrors the lp tile layer: it is
  // emitted by render() only while the layer is on AND we hold fetched data, so
  // toggling the layer shows/hides it. Caching the data (rather than filling a
  // placeholder post-render) also keeps the section alive across time ticks —
  // render() runs every tick and would otherwise wipe a placeholder to empty.
  let _lpData = null; // last LightPollution.fetch result (outOfBounds / error / normal)
  let _lpLayerOn = false; // lp tile layer on? pushed from map.js via setLpLayerActive

  // ---- Dual-Sidebar State Machine ----
  // left  = browse/select (eclipse list, future search/index)
  // right = inspect/detail (clicked location, eclipse detail)
  // manualOverride: if user explicitly closed a side, autoOpen won't re-open it
  // until they explicitly re-open or until the layer that opened it goes off→on.
  const sidebarState = {
    left: { open: false, manualOverride: null },
    right: { open: false, manualOverride: null },
  };

  const elLeft = () => document.getElementById('sidebar-left');
  const elRight = () => document.getElementById('sidebar-right');
  const contentLeft = () => document.getElementById('sidebar-left-content');
  const contentRight = () => document.getElementById('sidebar-right-content');
  const elFor = (side) => (side === 'left' ? elLeft() : elRight());

  // Sync the chevron handle visibility for both sidebars from live state.
  // Left handle follows the eclipse layer; right handle follows the observer pin / lock.
  // A handle also stays visible whenever its panel is still open, so the user can
  // always collapse a panel that lost its content (e.g. clearing the observer) —
  // the handle then rides out with the slide and is hidden only after the panel
  // has fully retracted (see the transitionend hook in wireToggles).
  // Called at every state-change that could flip either condition.
  function _updateHandleVisibility() {
    const eclipseOn = typeof AppState !== 'undefined' && AppState.isLayerOn && AppState.isLayerOn('eclipse');
    const planetsOn = typeof AppState !== 'undefined' && AppState.isLayerOn && AppState.isLayerOn('planets');
    // The planet-events list (now "Planets & Comets": planetary events + lunar
    // phases + comet milestones) rides either the planets or the moon layer.
    const moonOn = typeof AppState !== 'undefined' && AppState.isLayerOn && AppState.isLayerOn('moon');
    const pinOn =
      !!window.currentObserverLatLng || !!(typeof Observer !== 'undefined' && Observer.isLocked && Observer.isLocked());
    const leftEl = elLeft();
    const rightEl = elRight();
    if (leftEl)
      leftEl.dataset.hasContent = eclipseOn || planetsOn || moonOn || sidebarState.left.open ? 'true' : 'false';
    if (rightEl) rightEl.dataset.hasContent = pinOn || sidebarState.right.open ? 'true' : 'false';
  }

  function setSidebar(side, open, source = 'auto') {
    const aside = elFor(side);
    if (!aside) return;

    aside.dataset.state = open ? 'open' : 'closed';
    const toggle = aside.querySelector('.sidebar-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));

    sidebarState[side].open = open;

    if (source === 'manual') {
      // User closed → suppress autoOpen; user opened → reset suppression
      sidebarState[side].manualOverride = open ? null : false;
    }

    // Mobile exclusivity: open one closes the other
    if (open && window.matchMedia('(max-width: 768px)').matches) {
      const other = side === 'left' ? 'right' : 'left';
      if (sidebarState[other].open) {
        setSidebar(other, false, 'auto');
      }
    }

    if (typeof AppState !== 'undefined') AppState.touch();

    // Render-on-open for the right panel: its time-dependent content is cached HTML
    // and the TimeState.subscribe below is gated on the panel being open, so a
    // time/timezone change while closed would show stale times on reopen.
    // Re-rendering on open covers both. Reuse the authoritative observer location.
    if (side === 'right' && open) {
      const o = typeof window !== 'undefined' ? window.currentObserverLatLng : null;
      const rLat = o ? o.lat : _lat;
      const rLng = o ? o.lng : _lng;
      if (rLat !== null) {
        _lat = rLat;
        _lng = rLng;
        render(rLat, rLng, TimeState.current);
      }
    }
  }

  // Layer → sidebar autoOpen mapping. Both eclipse-list and planet-events share
  // the left panel; the owner arbiter (below) resolves contention by priority.
  const LAYERS = {
    'eclipse-list': { defaultPanel: 'left', autoOpen: true },
    'planet-events': { defaultPanel: 'left', autoOpen: true },
  };

  function onLayerToggle(layerId, isOn) {
    const meta = LAYERS[layerId];
    if (!meta || !meta.defaultPanel) return;
    if (isOn) {
      // Turning a layer on is a fresh intent to see its content, so it always
      // pops the panel — even if the user had hand-collapsed it while another
      // layer was already on (clear the manualOverride that would suppress it).
      if (meta.autoOpen) {
        sidebarState[meta.defaultPanel].manualOverride = null;
        setSidebar(meta.defaultPanel, true, 'auto');
      }
    } else {
      // Release this layer's claim, then re-render whatever still owns the panel.
      if (layerId === 'eclipse-list') {
        _eclipseListCtrl = null;
        _eclipseListOnSelect = null;
      } else if (layerId === 'planet-events') {
        _planetListCtrl = null;
        _planetListOnSelect = null;
      }
      if (_leftFront === layerId) _leftFront = null; // released front yields to the survivor
      _renderLeftOwner();
      // Close the drawer only when no claimant remains on this panel.
      if (meta.defaultPanel === 'left' ? _leftOwner() == null : true) {
        sidebarState[meta.defaultPanel].manualOverride = null;
        setSidebar(meta.defaultPanel, false, 'auto');
      }
    }
    _updateHandleVisibility();
  }

  // Wire toggle handles after DOM ready
  function wireToggles() {
    document.querySelectorAll('.sidebar-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const aside = e.currentTarget.closest('.sidebar');
        const side = aside.classList.contains('sidebar--left') ? 'left' : 'right';
        // Tap the tab to open or close, on touch and mouse alike. An earlier
        // edge-swipe-to-open path was dropped: its inward drag from the screen
        // edge clashed with the browser's own back/forward edge gesture.
        setSidebar(side, !sidebarState[side].open, 'manual');
      });
    });

    // Once a panel finishes its collapse slide, re-evaluate handle visibility so a
    // content-less, now-retracted panel finally drops its handle. The handle stayed
    // visible through the slide (the open OR-clause above) so the user could trigger
    // the collapse in the first place.
    ['left', 'right'].forEach((side) => {
      const aside = elFor(side);
      if (!aside) return;
      aside.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'transform' && !sidebarState[side].open) _updateHandleVisibility();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireToggles);
  } else {
    wireToggles();
  }

  // ---- Coordinate Helpers ----
  function toDMS(deg, isLat) {
    // Longitude may arrive in a wrapped world copy (the map spans -200°…520°, so a
    // click east of the antimeridian reads e.g. 431°E). Fold it back to [-180,180)
    // for display. Latitude is already in range.
    if (!isLat) deg = GeoUtils.normLng(deg);
    const abs = Math.abs(deg);
    let d = Math.floor(abs);
    const mFull = (abs - d) * 60;
    let m = Math.floor(mFull);
    let s = Math.round((mFull - m) * 60);
    if (s === 60) {
      s = 0;
      m += 1;
    }
    if (m === 60) {
      m = 0;
      d += 1;
    }
    const dir = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
    return `${d}°${m}′${s}″${dir}`;
  }

  function fmtTime(date) {
    return TimeState.formatTime(date, false);
  }

  /**
   * A labelled info row.  Pass `tip` to show a native browser tooltip on
   * hover (appears below the label after the OS hover delay, like the
   * "+1 day" hint on the ±1d button).
   */
  function row(label, value, tip = '', valueClass = 'data-value') {
    const titleAttr = _glossTip(tip);
    return (
      `<div class="info-row">` +
      `<span class="label"${titleAttr}>${label}</span>` +
      `<span class="value ${valueClass}">${value}</span>` +
      `</div>`
    );
  }

  // ` data-time="<ISO>"` for a valid Date, '' otherwise — marks an element as a
  // click-to-jump target (wired in render()). No-op for polar '—' placeholders.
  function timeAttr(date) {
    return date && !isNaN(date.getTime()) ? ` data-time="${date.toISOString()}"` : '';
  }

  // Clickable-time variant of row(): the value carries data-time so clicking it
  // jumps the app clock (TimeState.resetTo) to that instant. Falls back to a
  // plain non-clickable value for null/invalid dates.
  function timeRow(label, date, tip = '') {
    const titleAttr = _glossTip(tip);
    const valid = date && !isNaN(date.getTime());
    const cls = 'value data-value' + (valid ? ' time-jump' : '');
    return (
      `<div class="info-row">` +
      `<span class="label"${titleAttr}>${label}</span>` +
      `<span class="${cls}"${timeAttr(date)}>${fmtTime(date)}</span>` +
      `</div>`
    );
  }

  // A standalone clickable time fragment (for inline use, e.g. window ranges).
  function timeJump(date) {
    const valid = date && !isNaN(date.getTime());
    return `<span class="${valid ? 'time-jump' : ''}"${timeAttr(date)}>${fmtTime(date)}</span>`;
  }

  // A clickable time RANGE rendered as one jump target: "start–end" carrying a
  // single data-time at the range midpoint, so clicking jumps the clock to the
  // middle of the interval. No nested data-time (the whole span is one target).
  // Falls back to plain non-clickable text for any invalid endpoint.
  function timeRangeJump(start, end) {
    const valid = start && end && !isNaN(start.getTime()) && !isNaN(end.getTime());
    const txt = fmtTime(start) + '–' + fmtTime(end);
    if (!valid) return `<span>${txt}</span>`;
    const mid = new Date((start.getTime() + end.getTime()) / 2);
    return `<span class="time-jump"${timeAttr(mid)}>${txt}</span>`;
  }

  // ---- Sun Panel Twilight Table ----
  function twilightTable(info) {
    const fmt = (d) => fmtTime(d) || '—'; // em-dash for polar day/night
    const rows = [
      {
        cls: 'tt-sun',
        label: _t('panel.sun.row.sun'),
        tip: _t('panel.sun.sunrise_sunset.tooltip'),
        dep: 0.833,
        dawn: info.sunrise,
        dusk: info.sunset,
      },
      {
        cls: 'tt-civil',
        label: _t('panel.sun.row.civil'),
        tip: _t('panel.sun.civil_twilight.tooltip'),
        dep: 6,
        dawn: info.civilDawn,
        dusk: info.civilDusk,
      },
      {
        cls: 'tt-nautical',
        label: _t('panel.sun.row.nautical'),
        tip: _t('panel.sun.nautical_twilight.tooltip'),
        dep: 12,
        dawn: info.nauticalDawn,
        dusk: info.nauticalDusk,
      },
      {
        cls: 'tt-astro',
        label: _t('panel.sun.row.astro'),
        tip: _t('panel.sun.astro_twilight.tooltip'),
        dep: 18,
        dawn: info.astroDawn,
        dusk: info.astroDusk,
      },
    ];
    // A time cell: real time → click-to-jump; '—' → glossary tooltip with the
    // PRECISE reason. A null time means the sun never crossed −dep today, i.e. it
    // stayed entirely above it (polar day / white night) or entirely below it
    // (polar night) — told apart by the day's sun altitude extremes.
    const timeCell = (d, dep) => {
      const txt = fmt(d);
      if (txt !== '—') return `<td class="tt-time"${timeAttr(d)}>${txt}</td>`;
      const slug = Number.isFinite(info.sunMinAlt) && info.sunMinAlt > -dep ? 'na_sun_above' : 'na_sun_below';
      return `<td class="tt-time"${_glossAttr(slug)}>—</td>`;
    };
    const tbody = rows
      .map((r) => {
        const tip = _glossTip(r.tip);
        return (
          `<tr class="${r.cls}">` +
          `<td class="tt-label"${tip}>${r.label}</td>` +
          timeCell(r.dawn, r.dep) +
          timeCell(r.dusk, r.dep) +
          `</tr>`
        );
      })
      .join('');
    return (
      `<div class="twilight-card"><table class="twilight-table">` +
      `<thead><tr><th></th>` +
      `<th>${_t('panel.sun.col.dawn')}</th>` +
      `<th>${_t('panel.sun.col.dusk')}</th>` +
      `</tr></thead>` +
      `<tbody>${tbody}</tbody>` +
      `</table></div>`
    );
  }

  // ---- Moon/Planets Almanac Table ----
  // Observe window / visual magnitude / in-window peak altitude per body. The
  // window cell is a click-to-jump range (jumps to its midpoint). Highlight is
  // driven by r.highlight (has a window AND is well placed by elongation), decoupled
  // from the window/"—" display: a body can show a time range yet stay un-highlighted
  // when it is poorly placed (near conjunction / inside the quadratures).
  function bodyAlmanacTable(rows) {
    // '—' reason code from getBodyAlmanac → glossary slug for the tooltip.
    const _REASON_SLUG = {
      no_dark: 'na_no_dark',
      below_horizon: 'na_below_horizon',
      daylight_only: 'na_daylight_only',
      moon_always_up: 'na_moon_always_up',
      moon_always_down: 'na_moon_always_down',
    };

    const tbody = rows
      .map((r) => {
        // '—' = no observable window; r.reason carries the precise cause computed
        // against the actual geometry (see _planetObserveWindow / Moon branch).
        const naAttr = _glossAttr(_REASON_SLUG[r.reason] || 'na_below_horizon');
        const winTxt = r.window
          ? `<span>${timeRangeJump(r.window.start, r.window.end)}</span>`
          : `<span${naAttr}>—</span>`;
        const magTxt = isNaN(r.mag) ? '—' : r.mag.toFixed(1);
        const altTxt = isNaN(r.peakAlt) ? `<span${naAttr}>—</span>` : Math.round(r.peakAlt) + '°';
        const jumpKind = r.id === 'moon' ? 'moon' : 'planet'; // table holds Moon + 7 planets (no Sun)
        return (
          `<tr${r.highlight ? ' class="body-observable"' : ''}>` +
          `<td class="ba-name ba-jump" data-jump-kind="${jumpKind}" data-jump-id="${r.id}">${r.name}</td>` +
          `<td class="ba-win">${winTxt}</td>` +
          `<td class="ba-mag">${magTxt}</td>` +
          `<td class="ba-alt">${altTxt}</td>` +
          `</tr>`
        );
      })
      .join('');
    return (
      `<table class="body-almanac-table"><thead><tr>` +
      `<th>${_t('panel.bodies.col.body')}</th>` +
      `<th${_glossAttr('window_almanac')}>${_t('panel.bodies.col.window')}</th>` +
      `<th${_glossAttr('magnitude')}>${_t('panel.bodies.col.mag')}</th>` +
      `<th${_glossAttr('peak_altitude')}>${_t('panel.bodies.col.alt')}</th>` +
      `</tr></thead><tbody>${tbody}</tbody></table>`
    );
  }

  // ---- Galactic Core Altitude Chart ----
  // Text width in SVG user units (= px at a given font-size), via one reused
  // offscreen canvas. The chart's <text> has no font of its own, so it inherits
  // the sidebar's — measuring with that same family keeps CJK and Latin widths
  // honest when the legend centers itself.
  let _measureCtx = null;
  function _textWidthUnits(str, px, family) {
    if (typeof document === 'undefined' || !document.createElement) return str.length * px * 0.6;
    if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
    _measureCtx.font = px + 'px ' + family;
    return _measureCtx.measureText(str).width;
  }

  function _chartFontFamily() {
    try {
      const el = (typeof contentRight === 'function' && contentRight()) || document.body;
      return (el && getComputedStyle(el).fontFamily) || 'serif';
    } catch (_) {
      return 'serif';
    }
  }

  function buildChart(points) {
    const W = 320,
      H = 168;
    const PAD = { top: 18, right: 10, bottom: 24, left: 34 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
    const altMin = -30,
      altMax = 90;
    const totalPoints = points.length; // 97

    function xOf(i) {
      return PAD.left + (i / (totalPoints - 1)) * chartW;
    }

    function yOf(alt) {
      return PAD.top + chartH - ((alt - altMin) / (altMax - altMin)) * chartH;
    }

    const moonIllum = moonIlluminationFraction(points[0].time);
    let hasAstroNight = false;
    let greenCount = 0;

    const parts = [`<svg id="galactic-chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`];

    // Clip path
    parts.push(
      `<defs><clipPath id="chart-clip">` +
        `<rect x="${PAD.left}" y="${PAD.top}" width="${chartW}" height="${chartH}"/>` +
        `</clipPath></defs>`
    );

    // Y-axis labels
    [-30, 0, 30, 60, 90].forEach((alt) => {
      const y = yOf(alt).toFixed(1);
      parts.push(
        `<text x="${PAD.left - 4}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="13" fill="#9aa0aa">${alt}°</text>`
      );
    });

    // X-axis labels + tick lines (timezone-aware)
    const xLabels = [0, 24, 48, 72, 96];
    xLabels.forEach((idx) => {
      const t = points[idx]?.time;
      if (!t) return;
      const label = TimeState.formatTimeRounded(t, 10);
      const x = xOf(idx).toFixed(1);
      parts.push(
        `<text x="${x}" y="${(PAD.top + chartH + 14).toFixed(1)}" text-anchor="middle" font-size="13" fill="#9aa0aa">${label}</text>`
      );
    });

    // Chart border
    const borderRect = `<rect x="${PAD.left}" y="${PAD.top}" width="${chartW}" height="${chartH}" fill="none" stroke="#334155" stroke-width="0.5"/>`;

    // Clipped data layer
    parts.push(`<g clip-path="url(#chart-clip)">`);

    // X-axis tick lines
    xLabels.forEach((idx) => {
      const x = xOf(idx).toFixed(1);
      parts.push(
        `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${(PAD.top + chartH).toFixed(1)}" stroke="#334155" stroke-width="0.5"/>`
      );
    });

    // Astronomical night background (sun < −18°)
    for (let i = 0; i < totalPoints - 1; i++) {
      const p = points[i];
      if (p.sunAlt < -18) {
        hasAstroNight = true;
        const x1 = xOf(i).toFixed(1),
          w = (xOf(i + 1) - xOf(i)).toFixed(1);
        parts.push(`<rect x="${x1}" y="${PAD.top}" width="${w}" height="${chartH}" fill="#0f172a" opacity="0.85"/>`);
      }
    }

    // Moon-above-horizon overlay
    for (let i = 0; i < totalPoints - 1; i++) {
      const p = points[i];
      if (p.sunAlt < -18 && p.moonAlt > 0) {
        const x1 = xOf(i).toFixed(1),
          w = (xOf(i + 1) - xOf(i)).toFixed(1);
        parts.push(`<rect x="${x1}" y="${PAD.top}" width="${w}" height="${chartH}" fill="#fef08a" opacity="0.15"/>`);
      }
    }

    // Best viewing window: sun < −18°, Sgr A* > 10°, moon < 0° OR illum < 0.3
    for (let i = 0; i < totalPoints - 1; i++) {
      const p = points[i];
      const goodMoon = p.moonAlt < 0 || moonIllum < 0.3;
      if (p.sunAlt < -18 && !isNaN(p.altitude) && p.altitude > 10 && goodMoon) {
        greenCount++;
        const x1 = xOf(i).toFixed(1),
          w = (xOf(i + 1) - xOf(i)).toFixed(1);
        parts.push(`<rect x="${x1}" y="${PAD.top}" width="${w}" height="${chartH}" fill="#22c55e" opacity="0.35"/>`);
      }
    }

    // Horizon dashed line (0°)
    const y0 = yOf(0).toFixed(1);
    parts.push(
      `<line x1="${PAD.left}" y1="${y0}" x2="${PAD.left + chartW}" y2="${y0}" stroke="#64748b" stroke-width="1" stroke-dasharray="4 3"/>`
    );

    // Galactic core altitude curve
    const validPts = points.filter((p) => !isNaN(p.altitude));
    if (validPts.length > 1) {
      const polyline = validPts
        .map((p) => {
          const i = points.indexOf(p);
          return `${xOf(i).toFixed(1)},${yOf(p.altitude).toFixed(1)}`;
        })
        .join(' ');
      parts.push(
        `<polyline points="${polyline}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/>`
      );
    }

    parts.push(`</g>`); // end clip group

    // Border on top
    parts.push(borderRect);

    // Legend — single row; i18n strings are abbreviated so they fit all locales.
    // Items keep their fixed internal offsets; the whole row is then shifted so it
    // sits centered in the box, since the abbreviated labels differ in width by
    // locale/script and a fixed left edge leaves them lopsided.
    const coreLabel = _t('panel.galactic.legend.galactic_core');
    const legendW = 204 + _textWidthUnits(coreLabel, 13, _chartFontFamily()); // last text's right edge, from PAD.left
    const legendDx = (W - legendW) / 2 - PAD.left;
    parts.push(`<g class="galactic-legend" transform="translate(${legendDx.toFixed(1)},0)">`);
    parts.push(`<rect x="${PAD.left}" y="3" width="10" height="7" fill="#0f172a" opacity="0.85"/>`);
    parts.push(
      `<text x="${PAD.left + 14}" y="12" font-size="13" fill="#9aa0aa"${_glossAttr('astro_night')}>${_t('panel.galactic.legend.astro_night')}</text>`
    );
    parts.push(`<rect x="${PAD.left + 94}" y="3" width="10" height="7" fill="#22c55e" opacity="0.6"/>`);
    parts.push(
      `<text x="${PAD.left + 108}" y="12" font-size="13" fill="#9aa0aa"${_glossAttr('window_galactic')}>${_t('panel.galactic.legend.best_window')}</text>`
    );
    parts.push(
      `<line x1="${PAD.left + 188}" y1="7" x2="${PAD.left + 200}" y2="7" stroke="#f59e0b" stroke-width="1.5"/>`
    );
    parts.push(
      `<text x="${PAD.left + 204}" y="12" font-size="13" fill="#9aa0aa"${_glossAttr('galactic_core')}>${coreLabel}</text>`
    );
    parts.push(`</g>`);

    parts.push('</svg>');

    // No-window explanation
    let msg = '';
    if (!hasAstroNight) {
      msg = _t('panel.galactic.warning.no_astro_night');
    } else if (greenCount === 0) {
      const maxAlt = validPts.length ? Math.max(...validPts.map((p) => p.altitude)) : -99;
      if (maxAlt < 10) {
        msg = _t('panel.galactic.warning.core_too_low', { maxAlt: maxAlt.toFixed(0) });
      } else if (moonIllum >= 0.3) {
        msg = _t('panel.galactic.warning.moon_too_bright', { moonIllum: Math.round(moonIllum * 100) });
      } else {
        msg = _t('panel.galactic.warning.moon_overlap');
      }
    }

    return parts.join('') + (msg ? `<p class="chart-note">${msg}</p>` : '');
  }

  // ---- Collapsible Panel State ----
  const COLLAPSE_KEY = 'substellaratlas.panelCollapsed';
  function _loadCollapse() {
    try {
      return JSON.parse(sessionStorage.getItem(COLLAPSE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function _saveCollapse(state) {
    try {
      sessionStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function _isCollapsed(panelId) {
    const state = _loadCollapse();
    // An explicit user choice always wins, on any screen.
    if (panelId in state) return state[panelId] === true;
    // Phone default: the stacked right-panel sections overwhelm a small
    // screen, so untouched panels start folded — except the Sun panel, which
    // stays open as the anchor so the sheet never opens to a wall of headers.
    return panelId !== 'sun' && window.matchMedia('(max-width: 768px)').matches;
  }

  function section(panelId, headerHtml, bodyHtml) {
    const collapsed = _isCollapsed(panelId);
    return (
      `<div class="sidebar-section panel ${collapsed ? 'panel-collapsed' : ''}" data-panel="${panelId}">` +
      `<button class="panel-toggle" type="button" aria-expanded="${!collapsed}">` +
      `<span class="panel-chevron" aria-hidden="true">▾</span>` +
      headerHtml +
      `</button>` +
      `<div class="panel-body">${bodyHtml}</div>` +
      `</div>`
    );
  }

  function wirePanelToggles(root) {
    if (!root) return;
    root.querySelectorAll('.panel-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = btn.closest('.panel');
        if (!panel) return;
        const id = panel.dataset.panel;
        const nowCollapsed = !panel.classList.contains('panel-collapsed');
        panel.classList.toggle('panel-collapsed', nowCollapsed);
        btn.setAttribute('aria-expanded', String(!nowCollapsed));
        const state = _loadCollapse();
        state[id] = nowCollapsed;
        _saveCollapse(state);
      });
    });
  }

  // ---- Aurora Panel (Only When the Aurora Layer Is On) ----
  function auroraSection() {
    if (typeof Aurora === 'undefined' || !Aurora.isOn()) return '';
    const prob = Aurora.sampleAt(_lat, _lng);
    const kp = Aurora.getCurrentKp();
    const valid = Aurora.isValidForCurrentTime();
    const obs = Aurora.getObservationTime();

    let body = '';
    const probTxt = prob == null || prob < 1 ? '—' : Math.round(prob) + '%';
    body += row(_t('panel.aurora.probability'), probTxt, _t('panel.aurora.probability.tooltip'));

    if (kp && kp.kp != null) {
      const state = kp.observed === 'observed' ? _t('panel.aurora.kp.observed') : _t('panel.aurora.kp.predicted');
      // Per-band hover on the Kp value: pick the activity band (0–2 / 3–4 / 5–6 /
      // 7–9) the current value falls into. Label keeps the general kp.tooltip.
      const k = +kp.kp;
      const band = k < 3 ? 'quiet' : k < 5 ? 'active' : k < 7 ? 'storm' : 'severe';
      const kpVal = `<span${_glossTip(_t('panel.aurora.kp.band.' + band))}>${k.toFixed(1)}</span>`;
      body += row(_t('panel.aurora.kp'), kpVal + ' · ' + state, _t('panel.aurora.kp.tooltip'));
    }

    // Source + last-update line (small, muted). Out of range → the
    // "not applicable" note replaces the update time.
    let tail = '';
    if (!valid) {
      tail = _t('aurora.out_of_range');
    } else if (obs) {
      const hhmm = new Date(obs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      });
      tail = _t('credits.updated', { time: hhmm + ' UTC' });
    }
    const auroraSrc =
      '© <a href="https://www.swpc.noaa.gov/products/aurora-30-minute-forecast" target="_blank" rel="noopener">NOAA SWPC OVATION</a>';
    body += `<div class="aurora-credits">${auroraSrc}${tail ? ' ' + tail : ''}</div>`;

    return section('aurora', `<h3>${_t('panel.aurora.title')}</h3>`, body);
  }

  // ---- Satellite Panel (Only When the Satellite Layer Is On) ----
  function satSection() {
    if (typeof Sat === 'undefined' || !Sat.isOn()) return '';
    const info = Sat.getEpochInfo && Sat.getEpochInfo();
    const fresh = Sat.isFreshForCurrentTime ? Sat.isFreshForCurrentTime() : true;

    let body = '';

    // Today's passes for this location (above-horizon; reflection-visible ones
    // are highlighted gold). Empty list / no observer → fall through to credits.
    const passes = fresh && Sat.getDayPasses && _lat != null ? Sat.getDayPasses(_lat, _lng, TimeState.current) : [];
    if (fresh && _lat != null) {
      if (passes.length) {
        let rows = '';
        for (const p of passes) {
          const win = timeRangeJump(new Date(p.start), new Date(p.end));
          const visible = p.visStart != null;
          const visWin = visible ? timeRangeJump(new Date(p.visStart), new Date(p.visEnd)) : '';
          rows +=
            `<tr${visible ? ' class="sat-pass-visible"' : ''}>` +
            `<td class="sp-name sp-jump" data-sat-id="${p.noradId}">${p.label}</td>` +
            `<td class="sp-time">${win}</td>` +
            `<td class="sp-vis">${visWin}</td>` +
            `<td class="sp-el">${Math.round(p.maxEl)}°</td>` +
            `</tr>`;
        }
        body +=
          `<table class="sat-pass-table"><thead><tr>` +
          `<th>${_t('sat.col.name')}</th>` +
          `<th${_glossAttr('sat_pass')}>${_t('sat.col.pass')}</th>` +
          `<th${_glossAttr('window_sat')}>${_t('sat.col.visible')}</th>` +
          `<th${_glossAttr('elevation')}>${_t('sat.col.el')}</th>` +
          `</tr></thead><tbody>${rows}</tbody></table>`;
      } else {
        body += `<div class="sat-no-passes">${_t('sat.no_passes')}</div>`;
      }
    }

    // Source + TLE epoch line (small, muted). When out of the trust window the
    // stale note replaces the epoch time.
    let tail = '';
    if (!fresh) {
      tail = _t('sat.stale');
    } else if (info && info.epochMs != null) {
      const iso = new Date(info.epochMs).toISOString().slice(0, 16).replace('T', ' ');
      tail = _t('sat.updated', { time: iso + ' UTC' });
    }
    const satSrc = '© <a href="https://celestrak.org/" target="_blank" rel="noopener">CelesTrak</a>';
    body += `<div class="aurora-credits">${satSrc}${tail ? ' ' + tail : ''}</div>`;

    return section('sat', `<h3>${_t('panel.sat.title')}</h3>`, body);
  }

  // ---- Geolocation ("Locate Me") ----
  // Lightweight toast (own element + CSS, mirrors #time-toast — the project
  // keeps a small per-feature toast rather than one shared widget).
  function showGeoToast(msg) {
    let toast = document.getElementById('geo-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'geo-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(showGeoToast._t);
    showGeoToast._t = setTimeout(() => toast.classList.remove('visible'), 3500);
  }

  // Ask the browser for the user's position, then fly there and place the
  // observer. Reuses the exact jump sequence as the search box's selectResult
  // (places.js): flyTo → enterLocationMode → show → light-pollution fetch.
  // Reverse-geocoding of the place name happens automatically via
  // Observer.place → onPlace → Places.reverseAndRender, so it is not repeated here.
  function _geoLocate(btn) {
    if (!navigator.geolocation) {
      showGeoToast(_t('sidebar.locate.unsupported'));
      return;
    }
    btn.classList.add('locating');
    btn.disabled = true;
    const restore = () => {
      btn.classList.remove('locating');
      btn.disabled = false;
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Success path rebuilds the header (Sidebar.show → render), replacing this
        // button, so the loading state is discarded with it — restore() here is a
        // harmless no-op safety net for the rare race where render hasn't run yet.
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const map = window.appMap;
        if (map) {
          // World-wrap: keep the target on the same world copy as the current view.
          const centerLng = map.getCenter().lng;
          const targetLng = lng + 360 * Math.round((centerLng - lng) / 360);
          const zoom = Math.max(map.getZoom(), 11);
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          map.flyTo([lat, targetLng], zoom, { animate: !reduced });
        }
        if (typeof window.enterLocationMode === 'function') window.enterLocationMode(lat, lng);
        // Lock + show the compass immediately (places marker first, above). The compass
        // follows the flyTo via its own map 'move' subscription and re-syncs on moveend,
        // so deferring to moveend is unnecessary — and unsafe: a near-zero flyTo may
        // never fire moveend, leaving the observer unlocked (no c=1 in the permalink,
        // no compass on reload), which is exactly the "locate didn't open compass" bug.
        if (typeof Observer !== 'undefined' && Observer.lockAndShowCompass) Observer.lockAndShowCompass();
        Sidebar.show(lat, lng);
        if (typeof LightPollution !== 'undefined' && LightPollution.fetch) {
          LightPollution.fetch(lat, lng, 2024, (err, data) => {
            if (err) showLightPollution({ outOfBounds: false, error: err.message });
            else showLightPollution(data);
          });
        }
        restore();
      },
      (err) => {
        restore();
        let key = 'sidebar.locate.unavailable';
        if (err.code === err.PERMISSION_DENIED) key = 'sidebar.locate.denied';
        else if (err.code === err.TIMEOUT) key = 'sidebar.locate.timeout';
        showGeoToast(_t(key));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  // Fly to a known point and open the observer compass — shared by the header's
  // place-name / coords click. Mirrors the locate-button sequence (world-wrap,
  // reduced-motion) but uses the rendered coords instead of browser geolocation.
  function _jumpAndShowCompass(lat, lng) {
    const map = window.appMap;
    if (map) {
      const centerLng = map.getCenter().lng;
      const targetLng = lng + 360 * Math.round((centerLng - lng) / 360);
      const zoom = Math.max(map.getZoom(), 11);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      map.flyTo([lat, targetLng], zoom, { animate: !reduced });
    }
    if (typeof window.enterLocationMode === 'function') window.enterLocationMode(lat, lng);
    if (typeof Observer !== 'undefined' && Observer.lockAndShowCompass) Observer.lockAndShowCompass();
  }

  // ---- Full Sidebar Render ----
  // ---- Eclipse Section (Right Info Sidebar) ----
  // Standalone "Eclipses" panel anchored on the clicked location + current time.
  // Two modes: (a) no eclipse in progress → the next of each kind visible from
  // here; (b) one in progress → its contact/maximum instants with the body's
  // az/el, plus a crossing-trajectory schematic.

  // Per-render store mapping a forecast row's dom id → its event object, so the
  // click handler (wired after innerHTML) can pass it to Eclipse.openEvent.
  let _eclipseFcEvents = {};
  let _eclipseReadyHooked = false;

  function _ensureEclipseData() {
    if (typeof Eclipse === 'undefined' || !Eclipse.ready || _eclipseReadyHooked) return;
    _eclipseReadyHooked = true;
    Eclipse.ready(() => {
      if (sidebarState.right.open && _lat !== null) render(_lat, _lng, TimeState.current);
    });
  }

  // Azimuth degree "217°" and compass direction "SW" as two separate cells.
  // These are plain coordinate read-outs — no hover definition (the contact-name
  // label carries the tip instead). Empty cells when az is absent.
  function _azCells(h) {
    if (!h || isNaN(h.az)) return `<td class="ecl-ct-az"></td><td class="ecl-ct-dir"></td>`;
    const az = Math.round(((h.az % 360) + 360) % 360);
    const compass = typeof azCompass === 'function' ? azCompass(h.az) : '';
    return `<td class="ecl-ct-az">${az}°</td>` + `<td class="ecl-ct-dir">${compass}</td>`;
  }

  // "+34°" altitude cell (plain read-out, no tip). Negative uses − per convention.
  // A horizon marker (sunrise/sunset/moonrise/moonset) sits at apparent altitude 0 by
  // construction; forceVisible clamps the tiny bisection residue so it reads +0°.
  function _altCell(h, forceVisible) {
    if (!h || isNaN(h.alt)) return `<td class="ecl-ct-alt"></td>`;
    const alt = forceVisible && Math.abs(h.alt) < 0.5 ? 0 : h.alt;
    const a = Math.round(alt);
    const altStr = (a < 0 ? '−' : '+') + Math.abs(a) + '°';
    return `<td class="ecl-ct-alt">${altStr}</td>`;
  }

  // Contact table for an in-progress eclipse: one row per contact carrying the
  // localized label, the body's azimuth degree / compass direction / altitude in
  // separate columns, and a click-to-jump time on the far right. defs is
  // [labelKey, Date|null]; absent contacts (e.g. solar C2/C3 of a partial) are
  // skipped, so callers can list every possible contact unconditionally.
  // defs entries are [labelKey, Date|null, glossSlug?, opts?]; the optional slug puts a
  // hover definition on the contact-name label (the coordinate cells stay tip-free).
  // opts.forceVisible marks a horizon-crossing marker (sunrise/sunset/moonrise/moonset)
  // as observable even though its apparent altitude is ~0 — it stays a gold click-to-jump
  // row instead of being dimmed as below-horizon.
  function _eclContactTable(defs, body, lat, lng) {
    const haveAzEl = typeof Astronomy !== 'undefined' && typeof bodyHorizontal === 'function';
    const rows = defs
      .map(([labelKey, date, glossSlug, opts]) => {
        if (!date || isNaN(date.getTime())) return '';
        const force = !!(opts && opts.forceVisible);
        const h = haveAzEl ? bodyHorizontal(body, date, lat, lng) : null;
        // Below the horizon → the contact isn't observable here, so the time is
        // shown dim and plain (no accent, no hover, no click-to-jump). Text stays
        // selectable. Otherwise it's an accented click-to-jump target.
        const below = !force && h && isFinite(h.alt) && h.alt < 0;
        const timeCell = below
          ? `<td class="ecl-ct-time ecl-ct-below">${fmtTime(date)}</td>`
          : `<td class="ecl-ct-time time-jump"${timeAttr(date)}>${fmtTime(date)}</td>`;
        // Altitude before azimuth, matching the sky-path diagram (altitude on the
        // left/y axis, azimuth on the bottom/x axis).
        const label = _t(labelKey);
        const lm = label.match(/^([A-Z]\d*)\s+(.+)$/);
        const cKey = lm ? lm[1] : '';
        const cDesc = lm ? lm[2] : label;
        return (
          `<tr>` +
          `<td class="ecl-ct-key">${cKey}</td>` +
          `<td class="ecl-ct-desc"${glossSlug ? _glossAttr(glossSlug) : ''}>${cDesc}</td>` +
          _altCell(h, force) +
          _azCells(h) +
          timeCell +
          `</tr>`
        );
      })
      .join('');
    return rows ? `<table class="ecl-contacts">${rows}</table>` : '';
  }

  // EclipseWise-style corner readout for the lunar schematic: Par./γ top-left,
  // U.Mag/P.Mag top-right, each with a localized hover definition. Overlaid (in
  // HTML) on the SVG diagram so the gloss-tip system works on the labels.
  function _eclSchemStats(ev) {
    if (typeof EclipseGlyph === 'undefined' || !EclipseGlyph.lunarStats) return '';
    const st = EclipseGlyph.lunarStats(ev);
    const kind = (ev.kind || '').toLowerCase();
    const isPenumbral =
      kind === 'penumbral' ||
      (kind !== 'partial' && kind !== 'total' && st.umbralMag != null && isFinite(st.umbralMag) && st.umbralMag < 0);
    const isTotal = kind === 'total' || (st.totalMin != null && isFinite(st.totalMin) && st.totalMin > 0);

    const f3 = (v) => (v == null || !isFinite(v) ? '—' : v.toFixed(3));
    const fmtMin = (m) => (m == null || !isFinite(m) ? '—' : Math.round(m) + 'm');
    const umag =
      !isPenumbral && st.umbralMag != null && isFinite(st.umbralMag) && st.umbralMag >= 0
        ? st.umbralMag.toFixed(3)
        : '—';
    const gam =
      st.gamma == null || !isFinite(st.gamma) ? '—' : (st.gamma < 0 ? '−' : '+') + Math.abs(st.gamma).toFixed(3);
    const item = (slug, k, v) =>
      `<span class="ss-item"${_glossAttr(slug)}><span class="ss-k">${k}</span> <span class="ss-v">${v}</span></span>`;

    let leftHtml = '';
    if (!isPenumbral) {
      leftHtml = isTotal
        ? item('ecl_total', 'Tot.', fmtMin(st.totalMin)) + item('ecl_par', 'Par.', fmtMin(st.partialMin))
        : item('ecl_par', 'Par.', fmtMin(st.partialMin));
    }
    leftHtml += item('ecl_gamma', 'γ', gam);

    let rightHtml = '';
    if (!isPenumbral) rightHtml += item('ecl_umag', 'U.Mag.', umag);
    rightHtml += item('ecl_pmag', 'P.Mag.', f3(st.penumbralMag));

    return (
      `<div class="ecl-schem-stats">` +
      `<div class="ss-tl">${leftHtml}</div>` +
      `<div class="ss-tr">${rightHtml}</div>` +
      `</div>`
    );
  }

  // Solar analogue of _eclSchemStats overlaid on the sky-path diagram. Tot.
  // (totality) or Ann. (annularity) duration is c2→c3, present only when the
  // eclipse is central at this location; Par. is c1→c4; Mag. the local maximum
  // magnitude. All fields come from the same local-contacts object the contact
  // table uses. Reuses the .ecl-schem-stats / .ss-item / .ss-k layout.
  function _eclSolarSchemStats(lc) {
    if (!lc || !lc.visible) return '';
    const item = (slug, k, v) =>
      `<span class="ss-item"${_glossAttr(slug)}><span class="ss-k">${k}</span> <span class="ss-v">${v}</span></span>`;
    const fmtMin = (ms) => (ms == null || !isFinite(ms) ? '—' : Math.round(ms / 60000) + 'm');
    const central =
      (lc.maxPhase === 'total' || lc.maxPhase === 'annular') && lc.c2 instanceof Date && lc.c3 instanceof Date;

    let leftHtml = '';
    if (central) {
      const label = lc.maxPhase === 'total' ? 'Tot.' : 'Ann.';
      leftHtml += item('ecl_s_central', label, _fmtDur((lc.c3 - lc.c2) / 1000) || '—');
    }
    if (lc.c1 instanceof Date && lc.c4 instanceof Date) leftHtml += item('ecl_s_par', 'Par.', fmtMin(lc.c4 - lc.c1));

    const mag = lc.maxMag != null && isFinite(lc.maxMag) ? lc.maxMag.toFixed(3) : '—';
    const rightHtml = item('ecl_magnitude', 'Mag.', mag);

    return (
      `<div class="ecl-schem-stats">` +
      `<div class="ss-tl">${leftHtml}</div>` +
      `<div class="ss-tr">${rightHtml}</div>` +
      `</div>`
    );
  }

  // Active-eclipse footer: a dashed divider then the next-of-each-kind forecast,
  // computed from just after this eclipse ends so the active event isn't relisted.
  function _eclForecastBelow(lat, lng, ev) {
    if (!Eclipse.nextVisible) return '';
    const endIso = ev._kind === 'lunar' ? ev.times && ev.times.p4 : ev.p4;
    const from = endIso ? new Date(new Date(endIso).getTime() + 1000) : TimeState.current;
    const slots = Eclipse.nextVisible(lat, lng, from);
    if (!slots) return '';
    return `<div class="galactic-meta galactic-meta--below">${eclipseForecastBody(slots)}</div>`;
  }

  // Clickable event title (no divider). Clicking opens the eclipse-list layer
  // and locates this event (same path as the forecast rows).
  function _eclTypeMeta(ev) {
    const kindKey = (ev.kind || '').toLowerCase();
    const label = _t((ev._kind === 'solar' ? 'eclipse.type.solar.' : 'eclipse.type.lunar.') + kindKey) || ev.kind;
    const id = ev._kind + '-' + ev.date;
    _eclipseFcEvents[id] = ev;
    return `<div class="ecl-meta-line"><span class="ecl-open" data-ecl-open="${id}" data-ecl-nojump>${ev.date} · ${label}</span></div>`;
  }

  function eclipseSolarActive(ev, lat, lng) {
    const lc = Eclipse.solarLocalContacts ? Eclipse.solarLocalContacts(ev, lat, lng) : null;
    let html = _eclTypeMeta(ev);
    const Sun = Astronomy.Body.Sun;
    // classifySolar already gates on apparent visibility (Sun above the horizon during
    // the eclipse), so lc.visible is the authoritative "observable here" test.
    if (!lc || !lc.visible) {
      html += `<div class="ecl-note">${_t('panel.eclipse.not_visible_here')}</div>`;
      return html + _eclForecastBelow(lat, lng, ev);
    }
    // Sun rose/set mid-eclipse → a sunrise/sunset marker exists; the diagram draws the Sun
    // on the horizon at that instant (the true P1/P4 are below it) and labels it
    // accordingly instead of implying the Moon had cleared.
    const sgloss = {
      P1: _gloss(lc.sunrise ? 'ecl_c_sunrise' : 'ecl_c_p1_solar'),
      G: _gloss('ecl_c_greatest'),
      P4: _gloss(lc.sunset ? 'ecl_c_sunset' : 'ecl_c_p4_solar'),
      sunpath: _gloss('ecl_sunpath'),
    };
    const slabels = {
      P1: lc.sunrise ? _t('eclipse.contact.sunrise') : undefined,
      P4: lc.sunset ? _t('eclipse.contact.sunset') : undefined,
    };
    // Diagram contacts: swap the below-horizon exterior contact for its horizon marker so
    // the sky path keeps a visible endpoint (the geometric P1/P4 stay in the table only).
    const diagContacts = {
      maxPhase: lc.maxPhase,
      maxTime: lc.maxTime,
      c1: lc.sunrise || lc.c1,
      c4: lc.sunset || lc.c4,
      c1AtHorizon: !!lc.sunrise,
      c4AtHorizon: !!lc.sunset,
    };

    const diagram =
      typeof EclipseGlyph !== 'undefined'
        ? EclipseGlyph.renderSchematic(ev, {
            observer: { lat, lng },
            contacts: diagContacts,
            gloss: sgloss,
            labels: slabels,
          })
        : '';
    // Solar variant stacks the stat readout as a top bar above the plot (not an
    // overlay) so it never covers the SVG's left altitude-axis labels.
    if (diagram) html += `<div class="ecl-diagram ecl-diagram--solar">${_eclSolarSchemStats(lc)}${diagram}</div>`;
    // Table: all five geometric contacts (dimmed when below the horizon, as the lunar
    // table does) plus a gold sunrise/sunset marker row when the Sun crossed the horizon
    // mid-eclipse. Sorted by time so markers land among the contacts they fall between.
    const defs = [
      ['eclipse.contact.p1', lc.c1, 'ecl_c_p1_solar'],
      ['eclipse.contact.p2', lc.c2, 'ecl_c_p2_solar'],
      ['eclipse.contact.greatest', lc.maxTime, 'ecl_c_greatest'],
      ['eclipse.contact.p3', lc.c3, 'ecl_c_p3_solar'],
      ['eclipse.contact.p4', lc.c4, 'ecl_c_p4_solar'],
    ];
    if (lc.sunrise) defs.push(['eclipse.contact.sunrise', lc.sunrise, 'ecl_c_sunrise', { forceVisible: true }]);
    if (lc.sunset) defs.push(['eclipse.contact.sunset', lc.sunset, 'ecl_c_sunset', { forceVisible: true }]);
    defs.sort((a, b) => (a[1] ? a[1].getTime() : Infinity) - (b[1] ? b[1].getTime() : Infinity));
    html += _eclContactTable(defs, Sun, lat, lng);
    return html + _eclForecastBelow(lat, lng, ev);
  }

  function eclipseLunarActive(ev, lat, lng) {
    const t = ev.times || {};
    let html = _eclTypeMeta(ev);
    const Moon = Astronomy.Body.Moon;

    // If the Moon is below the horizon at every named contact the eclipse is not
    // observable here — skip the diagram and table and show a brief note instead.
    const haveAzEl = typeof Astronomy !== 'undefined' && typeof bodyHorizontal === 'function';
    const contactIsos = [t.p1, t.u1, t.u2, t.peak, t.u3, t.u4, t.p4].filter(Boolean);
    const anyVisible =
      !haveAzEl ||
      contactIsos.some((iso) => {
        const h = bodyHorizontal(Moon, new Date(iso), lat, lng);
        return h && isFinite(h.alt) && h.alt >= 0;
      });
    if (!anyVisible) {
      html += `<div class="ecl-note">${_t('panel.eclipse.not_visible_here')}</div>`;
      return html + _eclForecastBelow(lat, lng, ev);
    }

    const gloss = {
      umbra: _gloss('ecl_umbra'),
      penumbra: _gloss('ecl_penumbra'),
      ecliptic: _gloss('ecl_ecliptic'),
      moonpath: _gloss('ecl_moonpath'),
      shadowcenter: _gloss('ecl_shadow_center'),
      contacts: {
        P1: _gloss('ecl_c_p1_lunar'),
        U1: _gloss('ecl_c_u1'),
        U2: _gloss('ecl_c_u2'),
        G: _gloss('ecl_c_greatest'),
        U3: _gloss('ecl_c_u3'),
        U4: _gloss('ecl_c_u4'),
        P4: _gloss('ecl_c_p4_lunar'),
      },
    };

    const diagram = typeof EclipseGlyph !== 'undefined' ? EclipseGlyph.renderSchematic(ev, { gloss }) : '';
    if (diagram) html += `<div class="ecl-diagram">${_eclSchemStats(ev)}${diagram}</div>`;
    const defs = [
      ['eclipse.lunar.contact.p1', t.p1, 'ecl_c_p1_lunar'],
      ['eclipse.lunar.contact.u1', t.u1, 'ecl_c_u1'],
      ['eclipse.lunar.contact.u2', t.u2, 'ecl_c_u2'],
      ['eclipse.lunar.contact.greatest', t.peak, 'ecl_c_greatest'],
      ['eclipse.lunar.contact.u3', t.u3, 'ecl_c_u3'],
      ['eclipse.lunar.contact.u4', t.u4, 'ecl_c_u4'],
      ['eclipse.lunar.contact.p4', t.p4, 'ecl_c_p4_lunar'],
    ].map(([k, iso, slug]) => [k, iso ? new Date(iso) : null, slug]);
    // Reciprocal of the solar markers: the Moon rising/setting mid-eclipse (within
    // P1..P4) becomes a gold moonrise/moonset row at apparent altitude 0. The lunar
    // diagram is a shadow-cone schematic with no horizon axis, so markers are table-only.
    for (const m of _lunarHorizonMarkers(t.p1, t.p4, lat, lng)) defs.push(m);
    defs.sort((a, b) => (a[1] ? a[1].getTime() : Infinity) - (b[1] ? b[1].getTime() : Infinity));
    html += _eclContactTable(defs, Moon, lat, lng);
    return html + _eclForecastBelow(lat, lng, ev);
  }

  // Moonrise/moonset instants (apparent altitude 0) that fall within an in-progress
  // lunar eclipse's [p1Iso, p4Iso] window, as forceVisible marker defs for the contact
  // table. Mirrors the solar sunrise/sunset scan: a coarse sign sweep on the Moon's
  // apparent altitude, then bisection of each rising (moonrise) / falling (moonset) edge.
  function _lunarHorizonMarkers(p1Iso, p4Iso, lat, lng) {
    const out = [];
    const haveAzEl = typeof Astronomy !== 'undefined' && typeof bodyHorizontal === 'function';
    const p1ms = Date.parse(p1Iso),
      p4ms = Date.parse(p4Iso);
    if (!haveAzEl || !isFinite(p1ms) || !isFinite(p4ms) || p4ms <= p1ms) return out;
    const Moon = Astronomy.Body.Moon;
    const upAt = (ms) => {
      const h = bodyHorizontal(Moon, new Date(ms), lat, lng);
      return !!(h && isFinite(h.alt) && h.alt >= 0);
    };

    const bis = (msF, msT) => {
      let a = msF,
        b = msT;
      for (let k = 0; k < 32; k++) {
        const m = (a + b) / 2;
        if (upAt(m)) b = m;
        else a = m;
      }
      return new Date((a + b) / 2);
    };
    const M = 48;
    const up = [];
    for (let i = 0; i <= M; i++) {
      const ms = p1ms + ((p4ms - p1ms) * i) / M;
      up.push({ ms, on: upAt(ms) });
    }
    for (let i = 1; i <= M; i++)
      if (up[i].on && !up[i - 1].on) {
        out.push([
          'eclipse.lunar.contact.moonrise',
          bis(up[i - 1].ms, up[i].ms),
          'ecl_c_moonrise',
          { forceVisible: true },
        ]);
        break;
      }
    for (let i = M; i >= 1; i--)
      if (up[i - 1].on && !up[i].on) {
        out.push([
          'eclipse.lunar.contact.moonset',
          bis(up[i].ms, up[i - 1].ms),
          'ecl_c_moonset',
          { forceVisible: true },
        ]);
        break;
      }
    return out;
  }

  function fmtFcDate(slot) {
    if (!slot || !slot.time || isNaN(slot.time.getTime())) return '—';
    try {
      const parts = new Intl.DateTimeFormat('en', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: TimeState.timezone,
      }).formatToParts(slot.time);
      const p = {};
      parts.forEach((x) => {
        p[x.type] = x.value;
      });
      return `${p.year}-${p.month}-${p.day}`;
    } catch (_) {
      return slot.time.toISOString().slice(0, 10);
    }
  }

  function eclipseForecastBody(slots) {
    const openRow = (labelKey, slot) => {
      // Per-row tooltip emphasises "next one visible from THIS location" (not the
      // next globally). Tooltip key derives from the label key + '.tooltip'.
      // Two inner spans carry full vs abbreviated text; CSS hides the full form on
      // narrow panels (≤768px) where Romance-language strings overflow the row.
      const abbr = _t(labelKey + '.abbr');
      const lbl =
        `<span class="label"${_glossTip(_t(labelKey + '.tooltip'))}>` +
        `<span class="ecl-lbl-full">${_t(labelKey)}</span>` +
        `<span class="ecl-lbl-abbr">${abbr}</span>` +
        `</span>`;
      if (!slot)
        return (
          `<div class="info-row">${lbl}` +
          `<span class="value data-value"${I18n.glossAttr('ecl_none_here', { year: TimeState.RANGE_END_YEAR_EXCLUSIVE })}>—</span></div>`
        );
      const id = slot.event._kind + '-' + slot.event.date;
      _eclipseFcEvents[id] = slot.event;
      return (
        `<div class="info-row">${lbl}` +
        `<span class="value data-value time-jump ecl-open" data-ecl-open="${id}">${fmtFcDate(slot)}</span></div>`
      );
    };
    return (
      openRow('panel.eclipse.next_solar_partial', slots.solarPartial) +
      openRow('panel.eclipse.next_solar_total', slots.solarTotal) +
      '<div class="galactic-meta galactic-meta--below">' +
      openRow('panel.eclipse.next_lunar_partial', slots.lunarPartial) +
      openRow('panel.eclipse.next_lunar_total', slots.lunarTotal) +
      '</div>'
    );
  }

  function buildEclipseSection(lat, lng, date) {
    _eclipseFcEvents = {};
    const active = Eclipse.findActive ? Eclipse.findActive(date) : null;
    const header = `<h3>${_t('panel.eclipse.title')}</h3>`;
    let body;
    if (active) {
      body = active._kind === 'solar' ? eclipseSolarActive(active, lat, lng) : eclipseLunarActive(active, lat, lng);
    } else {
      const slots = Eclipse.nextVisible ? Eclipse.nextVisible(lat, lng, date) : null;
      if (!slots) {
        _ensureEclipseData();
        body = `<div class="ecl-note">${_t('panel.eclipse.loading')}</div>`;
      } else body = eclipseForecastBody(slots);
    }
    return { header, body };
  }

  function _rectsOverlap(a, b) {
    return a.width > 0 && b.width > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  // Move each lunar stat column off the Moon discs: default to its top corner; if a
  // disc overlaps it there, drop to the bottom corner on the same side (the diagonal
  // Moon path guarantees that one is clear). The bottom offset is computed from the
  // actual contact-label positions (P4/U4 etc.) so the moved column always sits
  // above them. If both corners are blocked, keep the top (least-bad).
  // Runs after each render — render-on-open guarantees the panel is visible.
  function _placeLunarSchemStats(root) {
    if (!root) return;
    root.querySelectorAll('.ecl-diagram:not(.ecl-diagram--solar)').forEach((diagram) => {
      const discs = diagram.querySelectorAll('.ecl-schematic image');
      if (!discs.length) return;
      const dr = Array.from(discs, (d) => d.getBoundingClientRect());
      const diagR = diagram.getBoundingClientRect();

      // Find the highest contact label that sits in the bottom 40 % of the
      // schematic (P4/U4/P1/U1 rendered near whichever corner P4 falls into).
      // The column's bottom edge must clear that label by 4 px.
      let bottomClear = 4;
      diagram.querySelectorAll('.ecl-schematic text').forEach((t) => {
        if (!/^(P1|P4|U1|U4)$/.test(t.textContent.trim())) return;
        const tr = t.getBoundingClientRect();
        if (!tr.width) return;
        const fromBottom = diagR.bottom - tr.top;
        if (fromBottom > 0 && fromBottom < diagR.height * 0.4) bottomClear = Math.max(bottomClear, fromBottom + 4);
      });

      diagram.querySelectorAll('.ecl-schem-stats .ss-tl, .ecl-schem-stats .ss-tr').forEach((col) => {
        col.classList.remove('ss--bottom');
        col.style.bottom = '';
        if (!dr.some((r) => _rectsOverlap(col.getBoundingClientRect(), r))) return; // top corner clear
        col.classList.add('ss--bottom');
        col.style.bottom = bottomClear + 'px';
        if (dr.some((r) => _rectsOverlap(col.getBoundingClientRect(), r))) {
          col.classList.remove('ss--bottom');
          col.style.bottom = '';
        }
      });
    });
  }

  function render(lat, lng, date) {
    const info = getSunMoonInfo(lat, lng, date);
    const curve = typeof getGalacticCoreCurve === 'function' ? getGalacticCoreCurve(lat, lng, date) : [];
    // getMoonLibration removed from sidebar — now shown in body click popup only
    const galaxy =
      typeof getGalacticCoreSummary === 'function'
        ? getGalacticCoreSummary(lat, lng, date)
        : { points: curve, transit: null, bestWindow: null };
    const curvePts = galaxy.points || curve;

    const galacticMeta =
      (galaxy.transit
        ? timeRow(_t('panel.galactic.transit_time'), galaxy.transit.time, _t('panel.galactic.transit_time.tooltip')) +
          row(
            _t('panel.galactic.transit_altitude'),
            galaxy.transit.alt.toFixed(1) + '°',
            _t('panel.galactic.transit_altitude.tooltip')
          )
        : '') +
      // Window < 1 min (single 15-min grid sample → start==end) is dropped so it
      // never renders as a confusing "04:15–04:15".
      (galaxy.bestWindow && galaxy.bestWindow.end.getTime() - galaxy.bestWindow.start.getTime() >= 60000
        ? row(
            _t('panel.galactic.best_window'),
            timeRangeJump(galaxy.bestWindow.start, galaxy.bestWindow.end),
            _gloss('window_galactic')
          )
        : '');

    // Sun upper-transit (solar noon) — mirrors the galactic transit info block.
    const sunTransit = typeof getBodyTransit === 'function' ? getBodyTransit(Astronomy.Body.Sun, lat, lng, date) : null;
    const sunMeta = sunTransit
      ? timeRow(_t('panel.sun.transit_time'), sunTransit.time, _t('panel.sun.transit_time.tooltip')) +
        row(_t('panel.sun.transit_altitude'), sunTransit.alt.toFixed(1) + '°', _t('panel.sun.transit_altitude.tooltip'))
      : '';

    const placeHtml = typeof Places !== 'undefined' && Places.getPlaceLineHtml ? Places.getPlaceLineHtml() : '';
    const html =
      `<div class="sidebar-section coords-section">
         <div class="coords-text">
           <div id="place-name-line">${placeHtml}</div>
           <div class="coords-dms">${toDMS(lat, true)} ${toDMS(lng, false)}</div>
         </div>
         <button type="button" id="geo-locate-btn" class="geo-locate-btn"
                 aria-label="${_t('sidebar.locate')}" data-tip="${_t('sidebar.locate')}"
                 data-i18n-aria="sidebar.locate" data-i18n-title="sidebar.locate">
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                stroke-linejoin="round" aria-hidden="true">
             <polygon points="3 11 22 2 13 21 11 13 3 11"/>
           </svg>
         </button>
       </div>` +
      // Everything below the coords header scrolls independently; the header
      // (above its border-bottom = first divider) stays fixed. Emitted here in
      // the HTML string so it survives the full innerHTML rebuild on time/locale
      // changes — same rationale as the popup's .star-scroll wrapper.
      '<div class="sidebar-scroll">' +
      section(
        'sun',
        `<h3>${_t('panel.sun.title')}</h3>`,
        (sunMeta ? '<div class="galactic-meta">' + sunMeta + '</div>' : '') +
          twilightTable(info) +
          // Golden/blue hour below the twilight table, in the single-row Transit-time
          // meta style: label + a clickable HH:MM–HH:MM range (next not-yet-ended
          // occurrence). '—' when the sun never enters the band (polar day/night).
          // --below flips the dashed divider to the top so this block reads as its
          // own group under the table rather than tucked against its last row.
          '<div class="galactic-meta galactic-meta--below">' +
          row(
            _t('panel.sun.golden_hour'),
            info.goldenHour
              ? timeRangeJump(info.goldenHour.start, info.goldenHour.end)
              : `<span${_glossAttr(Number.isFinite(info.sunMinAlt) && info.sunMinAlt > 6 ? 'na_sun_above' : 'na_sun_below')}>—</span>`,
            _t('panel.sun.golden_hour.tooltip')
          ) +
          row(
            _t('panel.sun.blue_hour'),
            info.blueHour
              ? timeRangeJump(info.blueHour.start, info.blueHour.end)
              : `<span${_glossAttr(Number.isFinite(info.sunMinAlt) && info.sunMinAlt > -4 ? 'na_sun_above' : 'na_sun_below')}>—</span>`,
            _t('panel.sun.blue_hour.tooltip')
          ) +
          '</div>'
      ) +
      section(
        'moon',
        `<h3>${_t('panel.moon.title')}</h3>`,
        bodyAlmanacTable(typeof getBodyAlmanac === 'function' ? getBodyAlmanac(lat, lng, date) : [])
      ) +
      // Eclipses: next-visible forecast, or in-progress contacts + schematic.
      (typeof Eclipse !== 'undefined'
        ? (() => {
            const e = buildEclipseSection(lat, lng, date);
            return section('eclipse', e.header, e.body);
          })()
        : '') +
      section(
        'galactic',
        `<h3>${_t('panel.galactic.title')}</h3>`,
        (galacticMeta ? '<div class="galactic-meta">' + galacticMeta + '</div>' : '') + buildChart(curvePts)
      ) +
      // '<div id="weather-section"></div>' +  // WEATHER panel hidden; re-enable to restore
      lpSection() +
      auroraSection() +
      satSection() +
      '<div id="eclipse-section"></div>' +
      '</div>';

    contentRight().innerHTML = html;
    wirePanelToggles(contentRight());

    // Relocate lunar schematic stat columns so the opaque Moon discs never cover
    // them (and the readout's hover keeps working). Must run after innerHTML so the
    // disc rects exist; render-on-open guarantees the panel is visible.
    try {
      _placeLunarSchemStats(contentRight());
    } catch (_) {
      /* AE/no diagram → skip */
    }

    // Click any rendered time → jump the app clock to that instant. Same pattern
    // as the eclipse-card .et-clickable rows (TimeState.resetTo). Base (unclicked)
    // styling is unchanged; only a pointer cursor + hover hint are added in CSS.
    contentRight()
      .querySelectorAll('[data-time]')
      .forEach((el) => {
        el.addEventListener('click', () => {
          const d = new Date(el.dataset.time);
          if (!isNaN(d.getTime())) TimeState.resetTo(d);
        });
      });

    // Forecast row → open the Eclipses panel and locate that event (turns the
    // overlay on, recenters the browse list, locks the time range, draws the
    // contact curves, flies to the peak). Distinct from the [data-time] jump.
    contentRight()
      .querySelectorAll('[data-ecl-open]')
      .forEach((el) => {
        el.addEventListener('click', () => {
          const ev = _eclipseFcEvents[el.dataset.eclOpen];
          if (ev && typeof Eclipse !== 'undefined' && Eclipse.openEvent)
            Eclipse.openEvent(ev, el.hasAttribute('data-ecl-nojump') ? { resetTime: false } : undefined);
        });
      });

    // Click a body/satellite name → fly the map to its current sub-point and open
    // its info card. Reuses CelestialSearch.select (the same path the search box
    // uses), so longitude-wrap, reduced-motion, popup handling AND the auto-enable
    // of the body's layer are all shared from one place.
    const _jumpVia = (r) => {
      const map = window.appMap;
      if (!map || typeof CelestialSearch === 'undefined' || !CelestialSearch.select) return;
      CelestialSearch.select(r, map);
    };
    contentRight()
      .querySelectorAll('.ba-jump[data-jump-id]')
      .forEach((el) => {
        el.addEventListener('click', () => _jumpVia({ kind: el.dataset.jumpKind, refKey: el.dataset.jumpId }));
      });
    contentRight()
      .querySelectorAll('.sp-jump[data-sat-id]')
      .forEach((el) => {
        el.addEventListener('click', () => _jumpVia({ kind: 'satellite', refKey: parseInt(el.dataset.satId, 10) }));
      });

    // Header "locate me" button → browser geolocation, then jump there. Rebound
    // every render (the element is re-created in the innerHTML rebuild above).
    const geoBtn = contentRight().querySelector('#geo-locate-btn');
    if (geoBtn) geoBtn.addEventListener('click', () => _geoLocate(geoBtn));

    // Header place name and coords are independently clickable — each flies back
    // to this point and opens the compass. Render-time lat/lng captured in closure.
    const placeNameLine = contentRight().querySelector('.coords-section #place-name-line');
    if (placeNameLine) placeNameLine.addEventListener('click', () => _jumpAndShowCompass(lat, lng));
    const coordsDms = contentRight().querySelector('.coords-section .coords-dms');
    if (coordsDms) coordsDms.addEventListener('click', () => _jumpAndShowCompass(lat, lng));

    // Fetch weather for this location (uses 6h cache, so cheap on re-renders)
    // Disabled while the WEATHER panel is hidden; re-enable together with the section above.
    // if (typeof Weather !== 'undefined') {
    //   Weather.fetchAstro(lat, lng, function(err, data) {
    //     if (err) Sidebar.showWeather({ error: err.message });
    //     else     Sidebar.showWeather(data);
    //   });
    // }
  }

  // ---- Re-render When Time or Timezone Changes ----
  TimeState.subscribe((date) => {
    // Read the AUTHORITATIVE observer location (same source the compass/masks
    // use) rather than the stale _lat/_lng closure, so a time tick can never
    // re-render rise/set for a location the observer has since left. Fall back
    // to _lat/_lng when no observer is placed (e.g. a search-only selection).
    const o = typeof window !== 'undefined' ? window.currentObserverLatLng : null;
    const rLat = o ? o.lat : _lat;
    const rLng = o ? o.lng : _lng;
    if (rLat !== null && sidebarState.right.open) {
      _lat = rLat;
      _lng = rLng;
      render(rLat, rLng, date);
    }
    // Update weather chart highlight without re-fetching
    if (_weatherData && _weatherData.points.length) {
      var idx = _closestWeatherIdx(_weatherData.points, date);
      var barW = 280 / _weatherData.points.length;
      var hl = document.getElementById('weather-hl');
      if (hl) hl.setAttribute('x', (idx * barW).toFixed(1));
    }
  });

  // (A closed-panel timezone refresh once lived here; it's now subsumed by the
  // render-on-open path in setSidebar, which covers every change made while the
  // panel was closed — time or timezone alike. When open, the subscribe() above
  // handles tz changes live via setTimezone→_notify.)

  // ---- Weather Section ----
  function _weatherProgressBar(label, pct, gradient, slug) {
    var p = Math.round(Math.max(0, Math.min(100, pct)));
    return (
      '<div style="margin-bottom:8px">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:3px">' +
      '<span style="font-size:13px;color:var(--fg-muted,#9aa0aa)"' +
      (slug ? _glossAttr(slug) : '') +
      '>' +
      label +
      '</span>' +
      '<span style="font-size:13px;color:var(--fg-primary,#e7e3da)">' +
      p +
      '%</span>' +
      '</div>' +
      '<div style="height:8px;border-radius:4px;background:#334155;overflow:hidden">' +
      '<div style="height:100%;width:' +
      p +
      '%;background:' +
      gradient +
      ';border-radius:4px"></div>' +
      '</div>' +
      '</div>'
    );
  }

  function _closestWeatherIdx(points, date) {
    if (!points || !points.length) return 0;
    var best = 0,
      bestDist = Infinity;
    for (var i = 0; i < points.length; i++) {
      var dist = Math.abs(new Date(points[i].time).getTime() - date.getTime());
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  function showWeather(data) {
    var container = document.getElementById('weather-section');
    if (!container) return;

    if (data && data.error) {
      container.innerHTML = section(
        'weather',
        `<h3>${_t('panel.weather.title')}</h3>`,
        '<p class="chart-note">⚠ ' + _t('panel.weather.error.network') + '：' + data.error + '</p>'
      );
      wirePanelToggles(container);
      return;
    }

    if (!data || !data.points || !data.points.length) {
      container.innerHTML = section(
        'weather',
        `<h3>${_t('panel.weather.title')}</h3>`,
        '<p class="chart-note">⚠ ' + _t('panel.weather.error.no_data') + '</p>'
      );
      wirePanelToggles(container);
      return;
    }

    _weatherData = data;
    _weatherInitDate = new Date(data.init);

    var points = data.points;
    var idx = _closestWeatherIdx(points, TimeState.current);
    var pt = points[idx];

    // Progress bars
    var cloudPct = pt.cloudPct;
    var seeingPct = Math.round(((8 - pt.seeingRaw) / 7) * 100); // 1=best→100%
    var transPct = Math.round(((pt.transparency - 1) / 7) * 100); // 8=best→100%

    var bars =
      _weatherProgressBar(
        _t('panel.weather.cloud_coverage'),
        cloudPct,
        'linear-gradient(90deg,#bfdbfe,#1d4ed8)',
        'cloud_cover'
      ) +
      _weatherProgressBar(_t('panel.weather.seeing'), seeingPct, 'linear-gradient(90deg,#fca5a5,#22c55e)', 'seeing') +
      _weatherProgressBar(
        _t('panel.weather.transparency'),
        transPct,
        'linear-gradient(90deg,#fca5a5,#22c55e)',
        'transparency'
      );

    // 7-day bar chart SVG
    var svgW = 280,
      svgH = 60;
    var barW = svgW / points.length;
    var barsSvg = points
      .map(function (p, i) {
        var h = (p.cloudPct / 100) * svgH;
        var L = 100 - p.cloudPct / 2;
        return (
          '<rect x="' +
          (i * barW).toFixed(1) +
          '" y="' +
          (svgH - h).toFixed(1) +
          '" width="' +
          barW.toFixed(1) +
          '" height="' +
          h.toFixed(1) +
          '" fill="hsl(220,80%,' +
          L +
          '%)"/>'
        );
      })
      .join('');

    var hlX = (idx * barW).toFixed(1);
    var note = data.fromFallback ? '<p class="chart-note">⚠ ' + _t('panel.weather.note.fallback') + '</p>' : '';

    container.innerHTML = section(
      'weather',
      `<h3>${_t('panel.weather.title')}</h3>`,
      bars +
        '<svg id="weather-chart" viewBox="0 0 ' +
        svgW +
        ' ' +
        svgH +
        '" ' +
        'style="display:block;width:100%;margin-top:6px;border-radius:4px;overflow:hidden">' +
        '<rect width="' +
        svgW +
        '" height="' +
        svgH +
        '" fill="#0f172a"/>' +
        barsSvg +
        '<rect id="weather-hl" x="' +
        hlX +
        '" y="0" width="' +
        barW.toFixed(1) +
        '" height="' +
        svgH +
        '" fill="none" stroke="#f59e0b" stroke-width="2"/>' +
        '</svg>' +
        note
    );
    wirePanelToggles(container);
  }

  // ---- Light Pollution Section (Only When the lp Layer Is On) ----
  // Cache the freshly-fetched data and re-render; lpSection() below decides
  // whether to emit it based on the layer state. Panel toggles are wired by
  // render()'s single wirePanelToggles(contentRight()) pass, not here.
  function showLightPollution(data) {
    _lpData = data;
    refreshRight();
  }

  function lpSection() {
    if (!_lpLayerOn || !_lpData) return '';
    const data = _lpData;

    if (data.outOfBounds) {
      return section(
        'lp',
        `<h3>${_t('panel.lp.title')}</h3>`,
        '<p class="chart-note">⚠ ' + _t('panel.lp.error.out_of_bounds') + '</p>'
      );
    }

    if (data.error) {
      return section(
        'lp',
        `<h3>${_t('panel.lp.title')}</h3>`,
        `<p class="chart-note">⚠ ${_t('panel.lp.error.fetch_failed')}：${data.error}</p>`
      );
    }

    const mpsas = data.mpsas.toFixed(2);
    const ratio = LightPollution.roundBrightness(data.ratio);
    // Per-zone hover on the level: collapse the a/b sub-zone to its whole level
    // (0–7, e.g. "3b" → 3) and show that level's sky description. Label keeps the
    // general index.tooltip.
    const lvl = parseInt(data.zone, 10) || 0;
    const zoneVal = `<span${_glossTip(_t('panel.lp.zone.' + lvl))}>${data.zone}</span>`;

    return section(
      'lp',
      `<h3>${_t('panel.lp.title')}</h3>`,
      row(
        _t('panel.lp.index_level'),
        `${ratio} / ${zoneVal} <span style="color:${data.zoneColor}">■</span>`,
        _t('panel.lp.index.tooltip')
      ) +
        row(_t('panel.lp.unit_brightness'), mpsas + ' mag/arcsec²', _t('panel.lp.unit_brightness.tooltip')) +
        `<div class="aurora-credits">© <a href="https://djlorenz.github.io/astronomy/lp/" target="_blank" rel="noopener">D.J. Lorenz</a> · <a href="https://eogdata.mines.edu/products/vnl/" target="_blank" rel="noopener">VIIRS</a> ${data.year}</div>`
    );
  }

  // Layer state pushed from map.js's lp layeradd/layerremove handler. Re-renders
  // so the lp section appears/disappears in lockstep with the tile layer.
  function setLpLayerActive(isOn) {
    _lpLayerOn = isOn;
    refreshRight();
  }

  // Right-sidebar re-render entry, preserving the scroll position across the
  // full innerHTML rebuild (same save/restore as the I18n.subscribe path). Used
  // by every "async data / layer state changed" caller so a refresh never yanks
  // the reader back to the top. No-op if no location / panel closed.
  function refreshRight() {
    if (_lat === null || !sidebarState.right.open) return;
    const prev = contentRight().querySelector('.sidebar-scroll');
    const top = prev ? prev.scrollTop : 0;
    render(_lat, _lng, TimeState.current);
    const next = contentRight().querySelector('.sidebar-scroll');
    if (next && top > 0) next.scrollTop = top;
  }

  let _expandedCard = null;
  let _expandedOnBack = null;

  // runOnBack: invoke the expanded card's onBack (e.g. clearSelection, which
  // clears the contact curves + unlocks the time range). True for a genuine
  // dismiss; FALSE when we're only collapsing the old card to render a NEW
  // event's detail — otherwise the previous selection's clearSelection wipes
  // the freshly-drawn curves and unlocks the just-set range (curve-refresh bug).
  function collapseExpandedCard(runOnBack = true) {
    if (!_expandedCard) return;
    const detail = _expandedCard.querySelector('.ec-detail');
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = '';
    }
    _expandedCard.removeAttribute('data-active');
    _expandedCard.removeAttribute('data-expanded');
    if (runOnBack && _expandedOnBack) _expandedOnBack();
    _expandedCard = null;
    _expandedOnBack = null;
    _eclipseDetailEvent = null;
    _eclipseDetailOnBack = null;
    _eclipseDetailType = null;
  }

  const _fmtTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return (
      d.getUTCFullYear() +
      '-' +
      pad(d.getUTCMonth() + 1) +
      '-' +
      pad(d.getUTCDate()) +
      ' ' +
      pad(d.getUTCHours()) +
      ':' +
      pad(d.getUTCMinutes()) +
      ':' +
      pad(d.getUTCSeconds()) +
      ' UTC'
    );
  };

  const _fmtDur = (sec) => {
    if (sec == null || isNaN(sec)) return null;
    const s = Math.round(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    // Under a minute: drop the "0m" and the seconds zero-pad ("54s", not "0m 54s").
    if (m === 0) return r + 's';
    return m + 'm ' + (r < 10 ? '0' : '') + r + 's';
  };

  function _renderInlineDetail(card, { descLine, metaLine, times, durLine }, onBack) {
    _expandedCard = card;
    _expandedOnBack = onBack;
    card.setAttribute('data-expanded', 'true');
    const detail = card.querySelector('.ec-detail');
    if (!detail) return;
    detail.innerHTML =
      (descLine ? `<div class="ec-desc-line">${descLine}</div>` : '') +
      (metaLine ? `<div class="ec-meta-line">${metaLine}</div>` : '') +
      (times.length
        ? `<table class="ec-detail-times">` +
          times
            .map((r) => {
              const desc = r.key ? r.label.replace(new RegExp(`^${r.key}\\s*`), '') : r.label;
              return `<tr class="et-clickable" data-time="${r.val}"><td class="et-key">${r.key || ''}</td><td class="et-desc"${r.slug ? _glossAttr(r.slug) : ''}>${desc}</td><td class="et-val">${_fmtTime(r.val)}</td></tr>`;
            })
            .join('') +
          `</table>`
        : '') +
      (durLine ? `<div class="ec-dur-line">${durLine}</div>` : '');
    detail.hidden = false;
    detail.querySelectorAll('.et-clickable').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        TimeState.resetTo(new Date(row.dataset.time));
      });
    });
    requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  function showEclipse(event, onBack) {
    collapseExpandedCard(false);
    const card = document.querySelector('#eclipse-list-cards .eclipse-card[data-active]');
    if (!card) return;

    const totDur = _fmtDur(event.totalDurSec != null ? event.totalDurSec : event.centralDurationSec);
    const parDur = _fmtDur(
      event.partialDurSec != null
        ? event.partialDurSec
        : event.p1 && event.p4
          ? (new Date(event.p4) - new Date(event.p1)) / 1000
          : null
    );

    const metaParts = [];
    if (event.saros != null) metaParts.push(`<span${_glossAttr('saros')}>${_t('eclipse.saros')}</span> ${event.saros}`);
    metaParts.push(
      `<span${_glossAttr('obscuration')}>${_t('eclipse.obscuration')}</span> ${(event.obscuration * 100).toFixed(1)} %`
    );
    // solar.json's top-level `gamma` lost its sign for partial eclipses (baked
    // as always-positive |γ|); the correctly-signed value (north +, south −)
    // lives in peak.gamma. Prefer it, falling back to the top-level field.
    const solarGamma =
      event.peak && event.peak.gamma != null && isFinite(event.peak.gamma) ? event.peak.gamma : event.gamma;
    if (solarGamma != null && isFinite(solarGamma))
      metaParts.push(`<span${_glossAttr('gamma')}>γ</span> ${solarGamma.toFixed(3)}`);
    const metaLine = metaParts.join(' · ');

    const durParts = [];
    if (totDur) durParts.push(`<span${_glossAttr('duration_total')}>${_t('eclipse.duration.total')}</span> ${totDur}`);
    if (parDur)
      durParts.push(`<span${_glossAttr('duration_partial')}>${_t('eclipse.duration.partial')}</span> ${parDur}`);
    const durLine = durParts.join(' · ');

    const times = [
      { key: 'P1', label: _t('eclipse.contact.p1'), val: event.p1, slug: 'contact_exterior' },
      { key: 'P2', label: _t('eclipse.contact.p2'), val: event.p2, slug: 'contact_interior' },
      { key: 'G', label: _t('eclipse.contact.greatest'), val: event.peak && event.peak.time, slug: 'greatest' },
      { key: 'P3', label: _t('eclipse.contact.p3'), val: event.p3, slug: 'contact_interior' },
      { key: 'P4', label: _t('eclipse.contact.p4'), val: event.p4, slug: 'contact_exterior' },
    ].filter((r) => r.val);

    _renderInlineDetail(card, { metaLine, times, durLine }, onBack);
  }

  function showLunarEclipse(event, onBack) {
    collapseExpandedCard(false);
    const card = document.querySelector('#eclipse-list-cards .eclipse-card[data-active]');
    if (!card) return;
    const t = event.times || {};

    const totDur = _fmtDur(
      event.totalDurSec != null ? event.totalDurSec : t.u2 && t.u3 ? (new Date(t.u3) - new Date(t.u2)) / 1000 : null
    );
    const parDur = _fmtDur(
      event.partialDurSec != null ? event.partialDurSec : t.u1 && t.u4 ? (new Date(t.u4) - new Date(t.u1)) / 1000 : null
    );
    const penDur = _fmtDur(t.p1 && t.p4 ? (new Date(t.p4) - new Date(t.p1)) / 1000 : null);

    const metaParts = [];
    if (event.saros != null) metaParts.push(`<span${_glossAttr('saros')}>${_t('eclipse.saros')}</span> ${event.saros}`);
    metaParts.push(
      `<span${_glossAttr('obscuration')}>${_t('eclipse.obscuration')}</span> ${((event.obscuration || 0) * 100).toFixed(1)} %`
    );
    // lunar.json carries no gamma field — fall back to the runtime-computed γ
    // so the lunar detail mirrors the solar card's saros·obscuration·γ line.
    let gammaVal = event.gamma;
    if ((gammaVal == null || !isFinite(gammaVal)) && typeof EclipseGlyph !== 'undefined' && EclipseGlyph.lunarStats) {
      const ls = EclipseGlyph.lunarStats(event);
      if (ls && ls.gamma != null && isFinite(ls.gamma)) gammaVal = ls.gamma;
    }
    if (gammaVal != null && isFinite(gammaVal))
      metaParts.push(`<span${_glossAttr('gamma')}>γ</span> ${gammaVal.toFixed(3)}`);
    const metaLine = metaParts.join(' · ');

    const durParts = [];
    if (totDur) durParts.push(`<span${_glossAttr('duration_total')}>${_t('eclipse.duration.total')}</span> ${totDur}`);
    if (parDur)
      durParts.push(`<span${_glossAttr('duration_partial')}>${_t('eclipse.duration.partial')}</span> ${parDur}`);
    if (penDur && !parDur)
      durParts.push(`<span${_glossAttr('duration_penumbral')}>${_t('eclipse.duration.penumbral')}</span> ${penDur}`);
    const durLine = durParts.join(' · ');

    const rows = [
      { key: 'P1', label: _t('eclipse.lunar.contact.p1'), val: t.p1, slug: 'penumbral_contact' },
      { key: 'U1', label: _t('eclipse.lunar.contact.u1'), val: t.u1, slug: 'u1_first' },
      { key: 'U2', label: _t('eclipse.lunar.contact.u2'), val: t.u2, slug: 'u2_total_begin' },
      { key: 'G', label: _t('eclipse.lunar.contact.greatest'), val: t.peak, slug: 'greatest' },
      { key: 'U3', label: _t('eclipse.lunar.contact.u3'), val: t.u3, slug: 'u3_total_end' },
      { key: 'U4', label: _t('eclipse.lunar.contact.u4'), val: t.u4, slug: 'u4_last' },
      { key: 'P4', label: _t('eclipse.lunar.contact.p4'), val: t.p4, slug: 'penumbral_contact' },
    ].filter((r) => r.val);

    _renderInlineDetail(card, { metaLine, times: rows, durLine }, onBack);
  }

  let _eclipseFilter = 'solar';

  // Sub-filter armed alongside a solar/lunar primary: solar → central eclipses
  // only (total/annular/hybrid, hiding partials); lunar → total only. Resets on
  // any primary change so a forced-kind navigation never lands on a hidden card.
  let _eclipseCentralOnly = false;

  // Sync the contextual sub-seal to the active primary: label + press state when
  // a specific kind is selected, hidden entirely under the combined ('all') view.
  function updateEclipseSubSeal(content) {
    const btn = content.querySelector('.eclipse-subfilter-btn');
    if (!btn) return;
    if (_eclipseFilter === 'solar' || _eclipseFilter === 'lunar') {
      btn.hidden = false;
      btn.textContent = _t(_eclipseFilter === 'solar' ? 'eclipse.subfilter.central' : 'eclipse.subfilter.total');
      btn.setAttribute('aria-pressed', _eclipseCentralOnly);
    } else {
      btn.hidden = true;
    }
  }

  // Icon-only paging control shared by the eclipse and planet lists: a slim
  // chevron bar (up = earlier, down = later). Auto-load on wheel-to-edge is the
  // primary affordance, so these stay deliberately quiet. The i18n label rides
  // on aria-label alone (data-i18n-aria lets applyDOM relabel it on a locale
  // switch); deliberately NOT data-tip — that carries the [data-tip] glossary
  // decoration (dashed underline + help cursor), which is wrong for a button,
  // and the chevron's direction needs no visible tooltip.
  function loadMoreBtnHtml(dir) {
    const isEarlier = dir === 'earlier';
    const key = isEarlier ? 'eclipse.list.load_earlier' : 'eclipse.list.load_later';
    const label = _t(key);
    const points = isEarlier ? '6 15 12 9 18 15' : '6 9 12 15 18 9';
    return `<button class="eclipse-load-more eclipse-load-${dir}" type="button" aria-label="${label}" data-i18n-aria="${key}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="${points}"/></svg></button>`;
  }

  // Lazily construct the two stacked sub-panels of the left sidebar so that
  // showEclipseList and showEclipse/showLunarEclipse can render independently
  // without clobbering each other.
  function ensureLeftStructure() {
    const content = contentLeft();
    if (!content) return null;
    if (!content.querySelector('#sidebar-left-list')) {
      content.innerHTML = `
        <div id="sidebar-left-list">
          <div class="eclipse-list-header">
            <h3>${_t('eclipse.list.title')}</h3>
          </div>
          <div class="list-filter-row eclipse-filter-row">
            <button class="eclipse-filter-btn" data-filter="solar" aria-pressed="${_eclipseFilter === 'solar'}">${_t('eclipse.filter.solar')}</button>
            <button class="eclipse-filter-btn" data-filter="lunar" aria-pressed="${_eclipseFilter === 'lunar'}">${_t('eclipse.filter.lunar')}</button>
            <button class="eclipse-subfilter-btn" data-sub="central" aria-pressed="false" hidden></button>
          </div>
          ${loadMoreBtnHtml('earlier')}
          <div class="eclipse-list" id="eclipse-list-cards"></div>
          ${loadMoreBtnHtml('later')}
        </div>`;
    }
    _updateHandleVisibility();
    return content;
  }

  function showEclipseList(controller, onSelect) {
    // Browse view goes to the LEFT sidebar.  The argument is a controller
    // returned by eclipse.js makeListController() — a windowed chronological
    // view with cursorInWin pointing at the event nearest to current time.
    const content = ensureLeftStructure();
    if (!content) return;
    // Pure DOM builder — never touches open/closed state. Opening is the caller's
    // onLayerToggle('eclipse-list', true), which alone honours manualOverride. Opening here
    // too would force the drawer open on every re-render (locale switch, card flip,
    // sibling-layer release) and, on mobile, evict the right panel via the exclusivity rule.

    function cardHtmlFor(e, i) {
      const now = TimeState.current.getTime();
      const isSolar = e._kind === 'solar';
      const peakTime = isSolar ? e.peak.time : e.times.peak;
      const peakMs = new Date(peakTime).getTime();
      const dt = peakMs - now;
      const absDays = Math.abs(dt) / 86400000;
      const suffix = dt < 0 ? 'ago' : 'later';
      const dtLabel =
        absDays < 1
          ? _t('eclipse.time.hours_' + suffix, { n: Math.round(Math.abs(dt) / 3600000) })
          : absDays < 365
            ? _t('eclipse.time.days_' + suffix, { n: Math.round(absDays) })
            : _t('eclipse.time.years_' + suffix, { n: (absDays / 365).toFixed(1) });
      const kindKey = (e.kind || '').toLowerCase();
      const kindLabel = isSolar
        ? _t('eclipse.type.solar.' + kindKey) || e.kind
        : _t('eclipse.type.lunar.' + kindKey) || e.kind;
      // For lunar events, prefer the pre-baked subLunar point; fall back to
      // an on-the-fly Astronomy Engine call if the data lacks it.
      let lunarLoc = null;
      if (!isSolar) {
        if (e.subLunar && typeof e.subLunar.lat === 'number') {
          lunarLoc = e.subLunar;
        } else if (typeof Astronomy !== 'undefined' && Astronomy.Body && Astronomy.GeoVector) {
          try {
            const t = new Date(peakTime);
            const v = Astronomy.GeoVector(Astronomy.Body.Moon, Astronomy.MakeTime(t), true);
            const dist = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
            const dec = (Math.asin(v.z / dist) * 180) / Math.PI;
            const ra = (Math.atan2(v.y, v.x) * 180) / Math.PI;
            // GMST in degrees (matches map.js _GMST formula)
            const jd = t.getTime() / 86400000 + 2440587.5;
            const gst = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
            let lng = ra - gst;
            // gst grows unbounded with JD — wrap into [0,360) then to [-180,180]
            lng = ((lng % 360) + 360) % 360;
            if (lng > 180) lng -= 360;
            lunarLoc = { lat: dec, lng };
          } catch (_) {
            lunarLoc = null;
          }
        }
      }
      const magLabel = _t('eclipse.card.magnitude');
      // Solar magnitude is topocentric (catalog value is correct). Lunar
      // magnitude is geocentric — derive it from the glyph geometry so the
      // number agrees with the drawn glyph and penumbral events (whose catalog
      // magnitude is 0) show their real penumbral magnitude.
      let magVal = e.magnitude || 0;
      if (!isSolar && typeof EclipseGlyph !== 'undefined' && EclipseGlyph.lunarMagnitude) {
        const m = EclipseGlyph.lunarMagnitude(e);
        if (m != null && isFinite(m)) magVal = Math.max(0, m);
      }
      const magStr = `<span${_glossAttr('ecl_magnitude')}>${magLabel}</span> ${magVal.toFixed(3)}`;
      // row2 = HH:MM UTC · lat° N/S lng° E/W; row3 = kind · magStr
      const pd = new Date(peakTime);
      const hhmm =
        pd.getUTCHours().toString().padStart(2, '0') + ':' + pd.getUTCMinutes().toString().padStart(2, '0') + ' UTC';
      const loc = isSolar ? { lat: e.peak.lat, lng: e.peak.lng } : lunarLoc;
      const coordStr = loc
        ? `${Math.abs(loc.lat).toFixed(1)}° ${loc.lat >= 0 ? 'N' : 'S'} ` +
          `${Math.abs(loc.lng).toFixed(1)}° ${loc.lng >= 0 ? 'E' : 'W'}`
        : '';
      const row2 = coordStr ? `${hhmm} · ${coordStr}` : hhmm;
      const row3 = `<span class="ec-kind">${kindLabel}</span> · ${magStr}`;
      const glyphSvg =
        typeof EclipseGlyph !== 'undefined'
          ? EclipseGlyph.render(e, { size: 42, idPrefix: `eg-${e._kind}-${e.date}` })
          : '';
      return `
        <div class="eclipse-card" data-idx="${i}" data-kind="${e._kind}" data-ecltype="${kindKey}">
          <div class="ec-header">
            <span class="ec-glyph">${glyphSvg}</span>
            <div class="ec-body">
              <div class="ec-row1">
                <span class="ec-date">${e.date}</span>
                <span class="ec-dt">${dtLabel}</span>
              </div>
              <div class="ec-row2">${row2}</div>
              <div class="ec-row3">${row3}</div>
            </div>
          </div>
          <div class="ec-detail" hidden></div>
        </div>`;
    }

    // Wire load buttons (idempotent — replaces any prior listeners)
    const earlierBtn = content.querySelector('.eclipse-load-earlier');
    const laterBtn = content.querySelector('.eclipse-load-later');

    const listEl = content.querySelector('#eclipse-list-cards');
    let _winEvents = [];

    // A filtered list may hold a grown window (up to FILTER_MAX_WINDOW); paging must
    // trim back to that larger bound, not the 60-event unfiltered cap, or each page
    // would collapse the window and empty the panel again.
    const effMax = () => (_eclipseFilter !== 'all' || _eclipseCentralOnly ? FILTER_MAX_WINDOW : controller.maxWindow());

    // Trim helpers: call after expanding the window to keep DOM within the effective cap.
    // Return the number of items actually trimmed (needed to correct scroll indices).
    function _maybeTrimLater() {
      // Freeze the tail once the window reaches the true last event: trimming it
      // there would delete the cards the user just paged down to. Slide only
      // while the bottom edge is still mid-list.
      if (!controller.canLoadLater()) return 0;
      const excess = controller.windowSize() - effMax();
      if (excess <= 0) return 0;
      return controller.trimLater(excess);
    }

    function _maybeTrimEarlier() {
      // Mirror of _maybeTrimLater: keep the head frozen at the true first event.
      if (!controller.canLoadEarlier()) return 0;
      const excess = controller.windowSize() - effMax();
      if (excess <= 0) return 0;
      return controller.trimEarlier(excess);
    }

    earlierBtn.onclick = () => {
      const prevLen = controller.events().length;
      controller.loadEarlier();
      const added = controller.events().length - prevLen;
      _maybeTrimLater();
      renderCards({ scrollTo: { type: 'preserveAfterPrepend', added: added } });
    };
    laterBtn.onclick = () => {
      const prevLen = controller.events().length;
      controller.loadLater();
      const trimmed = _maybeTrimEarlier();
      renderCards({ scrollTo: { type: 'index', index: prevLen - trimmed } });
    };

    // Wheel-to-edge auto-load: detects continued scroll intent at list boundaries.
    // Uses 'wheel' (not 'scroll') because scroll events stop firing at boundary —
    // wheel fires regardless, letting us detect "keep scrolling" intent.
    let _autoLoadCooldown = false;
    const AUTO_LOAD_COOLDOWN_MS = 400;

    listEl.addEventListener(
      'wheel',
      (e) => {
        if (_autoLoadCooldown) return;

        const atTop = listEl.scrollTop <= 1;
        const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight <= 1;

        if (e.deltaY < 0 && atTop && controller.canLoadEarlier()) {
          e.preventDefault();
          _autoLoadCooldown = true;
          const prevLen = controller.events().length;
          controller.loadEarlier();
          const added = controller.events().length - prevLen;
          _maybeTrimLater();
          renderCards({
            scrollTo: { type: 'preserveAfterPrepend', added: added },
            newRange: { from: 0, to: added },
          });
          earlierBtn.classList.add('eclipse-load-flash');
          setTimeout(() => {
            earlierBtn.classList.remove('eclipse-load-flash');
            _autoLoadCooldown = false;
          }, AUTO_LOAD_COOLDOWN_MS);
        } else if (e.deltaY > 0 && atBottom && controller.canLoadLater()) {
          e.preventDefault();
          _autoLoadCooldown = true;
          const savedScrollTop = listEl.scrollTop;
          const prevLen = controller.events().length;
          controller.loadLater();
          const added = controller.events().length - prevLen;
          const trimmed = _maybeTrimEarlier();
          renderCards({
            scrollTo: { type: 'restore', scrollTop: savedScrollTop },
            newRange: { from: prevLen - trimmed, to: prevLen - trimmed + added },
          });
          laterBtn.classList.add('eclipse-load-flash');
          setTimeout(() => {
            laterBtn.classList.remove('eclipse-load-flash');
            _autoLoadCooldown = false;
          }, AUTO_LOAD_COOLDOWN_MS);
        }
      },
      { passive: false }
    );

    // Both the primary (solar/lunar) and central-only sub-filter are applied
    // purely via CSS (data-filter / data-central on the list container) so
    // toggling never rebuilds the DOM or re-runs glyph SVG generation — it only
    // re-centers the cursor onto the nearest still-visible card. This mirror of
    // the CSS rules keeps that cursor math in step with what's actually shown.
    const isVisibleCard = (node) => {
      if (_eclipseFilter !== 'all' && node.dataset.kind !== _eclipseFilter) return false;
      if (!_eclipseCentralOnly) return true;
      const t = node.dataset.ecltype;
      if (_eclipseFilter === 'solar') return t !== 'partial';
      if (_eclipseFilter === 'lunar') return t !== 'partial' && t !== 'penumbral';
      return true;
    };

    // Scroll to the card at window-index `idx`; if it is filtered out (CSS-
    // hidden) fall back to the nearest visible card so the view never jumps to
    // the top with nothing highlighted.
    function scrollToIdx(idx, block, markActive) {
      let node = listEl.querySelector(`.eclipse-card[data-idx="${idx}"]`);
      if (node && !isVisibleCard(node)) node = null;
      if (!node) {
        let bestDist = Infinity;
        listEl.querySelectorAll('.eclipse-card').forEach((c) => {
          if (!isVisibleCard(c)) return;
          const d = Math.abs(+c.dataset.idx - idx);
          if (d < bestDist) {
            bestDist = d;
            node = c;
          }
        });
      }
      if (!node) return;
      if (markActive) node.setAttribute('data-active', 'true');
      node.scrollIntoView({ block });
    }

    function positionCursor() {
      collapseExpandedCard();
      listEl.querySelectorAll('.eclipse-card[data-active]').forEach((c) => c.removeAttribute('data-active'));
      scrollToIdx(controller.cursorInWin(), 'center', true);
    }

    // Wire filter buttons — CSS-only show/hide, no re-render. Changing the
    // primary kind clears any armed central-only sub-filter (its meaning is
    // tied to the active kind) and re-syncs the contextual sub-seal.
    content.querySelectorAll('.eclipse-filter-btn').forEach((btn) => {
      btn.onclick = () => {
        const f = btn.dataset.filter;
        _eclipseFilter = _eclipseFilter === f ? 'all' : f;
        _eclipseCentralOnly = false;
        delete listEl.dataset.central;
        content.querySelectorAll('.eclipse-filter-btn').forEach((b) => {
          b.setAttribute('aria-pressed', b.dataset.filter === _eclipseFilter);
        });
        listEl.dataset.filter = _eclipseFilter;
        updateEclipseSubSeal(content);
        const before = controller.windowSize();
        const active = _eclipseFilter !== 'all' || _eclipseCentralOnly;
        if (active) autoFillWindow(controller, eclipseEventMatches, fillTarget(listEl), FILTER_MAX_WINDOW);
        else shrinkWindow(controller);
        if (controller.windowSize() !== before) renderCards();
        else positionCursor();
      };
    });

    // Contextual central-only sub-filter — an independent on/off armed on top of
    // the active primary kind. Kept off the .eclipse-filter-btn class so it never
    // trips the primary handler, which keys off data-filter.
    const subBtn = content.querySelector('.eclipse-subfilter-btn');
    if (subBtn) {
      subBtn.onclick = () => {
        _eclipseCentralOnly = !_eclipseCentralOnly;
        if (_eclipseCentralOnly) listEl.dataset.central = '1';
        else delete listEl.dataset.central;
        subBtn.setAttribute('aria-pressed', _eclipseCentralOnly);
        const before = controller.windowSize();
        const active = _eclipseFilter !== 'all' || _eclipseCentralOnly;
        if (active) autoFillWindow(controller, eclipseEventMatches, fillTarget(listEl), FILTER_MAX_WINDOW);
        else shrinkWindow(controller);
        if (controller.windowSize() !== before) renderCards();
        else positionCursor();
      };
    }
    updateEclipseSubSeal(content);
    if (_eclipseCentralOnly) listEl.dataset.central = '1';

    // Single delegated click handler (replaces the per-card listeners).
    listEl.onclick = (ev) => {
      if (ev.target.closest('.ec-detail')) return;
      const card = ev.target.closest('.eclipse-card');
      if (!card || !listEl.contains(card)) return;
      if (card === _expandedCard) {
        collapseExpandedCard();
        return;
      }
      listEl.querySelectorAll('.eclipse-card[data-active]').forEach((c) => c.removeAttribute('data-active'));
      card.setAttribute('data-active', 'true');
      if (onSelect) onSelect(_winEvents[+card.dataset.idx]);
    };

    function renderCards(opts) {
      opts = opts || { scrollTo: { type: 'cursor' } };
      const savedEvent = _eclipseDetailEvent;
      const savedType = _eclipseDetailType;
      const savedBack = _eclipseDetailOnBack;
      _expandedCard = null;
      _winEvents = controller.events();
      listEl.dataset.filter = _eclipseFilter;
      listEl.innerHTML = _winEvents.map((e, i) => cardHtmlFor(e, i)).join('');

      earlierBtn.disabled = !controller.canLoadEarlier();
      laterBtn.disabled = !controller.canLoadLater();

      const target = opts.scrollTo;
      if (!target || target.type === 'cursor') positionCursor();
      else if (target.type === 'index') scrollToIdx(target.index, 'start', false);
      else if (target.type === 'preserveAfterPrepend') scrollToIdx(target.added, 'start', false);
      else if (target.type === 'restore') listEl.scrollTop = target.scrollTop;
      // Type === 'none': intentionally no scroll

      // Mark newly loaded cards for fade-in animation.
      if (opts.newRange) {
        const { from, to } = opts.newRange;
        for (let i = from; i < to; i++) {
          const card = listEl.querySelector(`.eclipse-card[data-idx="${i}"]`);
          if (card) card.classList.add('ec-new');
        }
      }

      if (savedEvent) {
        const idx = _winEvents.findIndex((ev) => ev.date === savedEvent.date && ev._kind === savedType);
        if (idx >= 0) {
          const card = listEl.querySelector(`.eclipse-card[data-idx="${idx}"]`);
          if (card) {
            card.setAttribute('data-active', 'true');
            if (savedType === 'lunar') {
              _origShowLunarEclipse(savedEvent, savedBack);
            } else {
              _origShowEclipse(savedEvent, savedBack);
            }
          }
        }
      }
    }

    renderCards();
  }

  // ---- Planetary Events List (left sidebar) ----
  // Mirrors showEclipseList's card/scroll machinery for the global planetary
  // events catalog (js/planet-events.js). Two orthogonal, non-exclusive filters:
  // event type and body (astronomical-symbol chips). See CLAUDE.md left-panel notes.

  // Body glyphs — Uranus uses the astronomical symbol ⛢ (not astrological ♅),
  // per [memory: project_body_symbols]. Kept in sync with planets.js CONFIGS.
  const PEV_BODY_SYM = {
    sun: '☉',
    moon: '☾',
    mercury: '☿',
    venus: '♀',
    mars: '♂',
    jupiter: '♃',
    saturn: '♄',
    uranus: '⛢',
    neptune: '♆',
  };
  // Glossary slug per event type, for the type-label hover card.
  const PEV_TYPE_SLUG = {
    opposition: 'pev_opposition',
    conjunction: 'pev_conjunction',
    inferior_conjunction: 'pev_conj_inferior',
    superior_conjunction: 'pev_conj_superior',
    quadrature: 'pev_quadrature',
    greatest_elongation: 'pev_greatest_elong',
    station_retrograde: 'pev_station',
    station_direct: 'pev_station',
    appulse: 'pev_conjunction',
    appulse_star: 'pev_conjunction',
    new_moon: 'pev_moon_phase',
    first_quarter: 'pev_moon_phase',
    full_moon: 'pev_moon_phase',
    last_quarter: 'pev_moon_phase',
    comet_perihelion: 'pev_perihelion',
    comet_perigee: 'pev_perigee',
    comet_reach: 'pev_comet_milestone',
    comet_fade: 'pev_comet_milestone',
  };
  // Phenomenon symbol for single-body (Sun-relative) events — pairs with the
  // planet disk on the glyph's left slot. Plain astronomical/mathematical
  // Unicode, no bespoke SVG: opposition/conjunction reuse the same glyphs
  // this codebase already treats as astronomical (not astrological) per
  // [memory: project_body_symbols]; quadrature/elongation borrow the
  // right-angle/angle math symbols (not astrology's aspect glyphs);
  // station's arrows mirror the retrograde/direct reversal itself.
  const PEV_PHENOM_SYM = {
    opposition: '☍',
    conjunction: '☌',
    inferior_conjunction: '☌',
    superior_conjunction: '☌',
    quadrature: '∟',
    greatest_elongation: '∠',
    station_retrograde: '↺',
    station_direct: '↻',
    // Comet perihelion/perigee borrow the Sun / Earth marks; a filled star marks
    // brightening past a magnitude milestone, a hollow star fading past it. Lunar
    // phases carry no right-slot symbol — the phased disk in the left slot already
    // states the phase, so a redundant ●◐○◑ beside it only adds noise.
    comet_perihelion: '☉',
    comet_perigee: '⊕',
    comet_reach: '✦',
    comet_fade: '✧',
  };
  // Body-chip ids for the filter row.
  const PEV_BODY_CHIPS = [
    'mercury',
    'venus',
    'mars',
    'asteroids',
    'jupiter',
    'saturn',
    'uranus',
    'neptune',
    'comet',
    'star',
    'moon',
  ];
  // The three main-belt bodies collapse into a single 'asteroids' filter chip
  // (⚳). Events still carry their real per-body id in `bodies`, so the chip
  // matches any of these — mirroring how the 'star' chip matches 'star:*' ids.
  const PEV_ASTEROID_IDS = ['ceres', 'pallas', 'vesta'];
  const PEV_DISK_ICON_PX = 20;

  // Active filter set persists across re-renders (empty set = show all).
  const _pevFilterBodies = new Set();

  function pevBodyName(id) {
    if (id.indexOf('star:') === 0) {
      const s = id.slice(5);
      return _t('pev.star.' + s) || s.charAt(0).toUpperCase() + s.slice(1);
    }
    // Comet labels are proper names baked into the catalog (PlanetEvents.cometName),
    // not translated strings; before load / for an unknown id, show the bare id.
    if (id.indexOf('comet:') === 0) {
      return (typeof PlanetEvents !== 'undefined' && PlanetEvents.cometName(id)) || id.slice(6).toUpperCase();
    }
    return _t('pev.body.' + id) || id;
  }

  // Body name for the merged event+object phrase — tries a locale's short
  // form first (e.g. zh "月" for the Moon, per the user's explicit ask). Gated
  // on I18n.isZh() rather than just probing the key: pev.body_short.moon only
  // exists in zh-Hans/zh-Hant, but _t()'s fallback-to-FALLBACK-dict behavior
  // (FALLBACK is zh-Hans) would otherwise leak "月" into every other locale
  // whenever the current dict has no entry of its own.
  function pevBodyPhraseName(id) {
    if (I18n.isZh()) {
      const shortKey = 'pev.body_short.' + id;
      const s = _t(shortKey);
      if (s && s !== shortKey) return s;
    }
    return pevBodyName(id);
  }

  function pevTypeLabel(e) {
    // Directional configs (quadrature, greatest elongation) use per-direction
    // keys so each locale phrases E/W naturally ("Eastern quadrature", "东方照").
    let key = 'pev.type.' + e.type;
    if ((e.type === 'quadrature' || e.type === 'greatest_elongation') && e.elongDir) key += '_' + e.elongDir;
    // Comet brightness milestones name their threshold inline ("增亮至 3 等"); only
    // these events carry `level`, so the param is harmless on every other type.
    const params = e.level != null ? { level: e.level } : undefined;
    const s = _t(key, params);
    if (s && s !== key) return s;
    const base = _t('pev.type.' + e.type, params);
    return base && base !== 'pev.type.' + e.type ? base : e.type;
  }

  // Same directional-key-with-fallback shape as pevTypeLabel, for the
  // pev.desc.* narrative-sentence templates (single-body events only —
  // appulse/appulse_star share one template, pev.desc.conjunction_pair).
  function pevDescKey(e) {
    let key = 'pev.desc.' + e.type;
    if ((e.type === 'quadrature' || e.type === 'greatest_elongation') && e.elongDir) key += '_' + e.elongDir;
    return key;
  }

  // The non-primary body in a two-body event (primary is already picked by
  // the build script: Moon if present, else the brighter of the pair).
  function pevOtherBody(e) {
    return e.bodies[0] === e.primary ? e.bodies[1] : e.bodies[0];
  }

  // Merged "object + phenomenon" phrase (req: "木星 西方照", "月 合 金星") — a
  // locale-authored template, not JS string concatenation, so word order can
  // differ per language. Primary body leads a two-body phrase.
  function pevPhraseHtml(e) {
    const slug = PEV_TYPE_SLUG[e.type];
    const typeHtml = `<span class="ec-kind"${slug ? _glossAttr(slug) : ''}>${pevTypeLabel(e)}</span>`;
    if (e.bodies.length === 1) {
      return _t('pev.phrase.single', { body: pevBodyPhraseName(e.bodies[0]), type: typeHtml });
    }
    return _t('pev.phrase.pair', {
      body1: pevBodyPhraseName(e.primary),
      type: typeHtml,
      body2: pevBodyPhraseName(pevOtherBody(e)),
    });
  }

  // Non-star bodies in a two-body event, ordered by apparent angular
  // diameter (largest first) — the glyph draws the visually bigger disk on
  // the left. A star has no disk and always sorts last.
  function pevOrderedDiskIds(e) {
    const withSize = e.bodies.map((id) => {
      if (id.indexOf('star:') === 0) return { id, size: -1 };
      const cfg = Planets.CONFIGS.find((c) => c.id === id);
      const size = cfg ? Planets.bodyAngularDiamArcsec(cfg.body, id, new Date(e.time)) : 0;
      return { id, size: isNaN(size) ? 0 : size };
    });
    withSize.sort((a, b) => b.size - a.size);
    return withSize.map((x) => x.id);
  }

  function pevDiskOrStarHtml(id, date) {
    if (id.indexOf('star:') === 0) return '<span class="pev-glyph-star"></span>';
    if (id.indexOf('comet:') === 0) return '<span class="pev-glyph-comet">☄</span>';
    return Planets.buildEventDiskIcon(id, date, PEV_DISK_ICON_PX);
  }

  // Two-slot glyph: single-body events pair the planet disk with its
  // phenomenon symbol; two-body events pair two disks (or disk + star)
  // ordered by apparent size.
  function pevGlyphHtml(e) {
    const date = new Date(e.time);
    if (e.bodies.length === 1) {
      const rightSym = PEV_PHENOM_SYM[e.type] || '';
      const disk = `<span class="pev-glyph-slot">${pevDiskOrStarHtml(e.bodies[0], date)}</span>`;
      // Drop the empty phenom slot entirely when there is no right-hand symbol
      // (e.g. moon phases, whose left disk already shows the phase) so the lone
      // disk centres in the glyph column instead of hugging the left slot.
      if (!rightSym) return disk;
      return disk + `<span class="pev-glyph-slot pev-glyph-phenom">${rightSym}</span>`;
    }
    return pevOrderedDiskIds(e)
      .map((id) => `<span class="pev-glyph-slot">${pevDiskOrStarHtml(id, date)}</span>`)
      .join('');
  }

  // Insert a space at Latin↔CJK boundaries so a Latin proper name (a comet's
  // "ATLAS") or an Arabic numeral doesn't butt against the surrounding Chinese /
  // Japanese run ("ATLAS视亮度…" → "ATLAS 视亮度…"). Only ideographs and kana count
  // as CJK, so fullwidth punctuation stays untouched — "（0.937 AU）" keeps its own
  // spacing. A CJK body name (月 / 木星) sits CJK↔CJK and never triggers. Idempotent:
  // an already-spaced boundary has no adjacent pair to match.
  const _CJK_RUN = '\\u4e00-\\u9fff\\u3040-\\u30ff';
  const _CJK_AFTER_LATIN = new RegExp('([A-Za-z0-9])([' + _CJK_RUN + '])', 'g');
  const _CJK_BEFORE_LATIN = new RegExp('([' + _CJK_RUN + '])([A-Za-z0-9])', 'g');

  function _cjkLatinSpace(s) {
    return s.replace(_CJK_AFTER_LATIN, '$1 $2').replace(_CJK_BEFORE_LATIN, '$1 $2');
  }

  function _fmtSep(deg) {
    return deg < 1 ? deg.toFixed(2) + '°' : deg.toFixed(1) + '°';
  }

  function planetDtLabel(ms) {
    const dt = ms - TimeState.current.getTime();
    const absDays = Math.abs(dt) / 86400000;
    const suffix = dt < 0 ? 'ago' : 'later';
    return absDays < 1
      ? _t('eclipse.time.hours_' + suffix, { n: Math.round(Math.abs(dt) / 3600000) })
      : absDays < 365
        ? _t('eclipse.time.days_' + suffix, { n: Math.round(absDays) })
        : _t('eclipse.time.years_' + suffix, { n: (absDays / 365).toFixed(1) });
  }

  function planetCardHtml(e, i) {
    const dt = planetDtLabel(e._timeMs);
    const pd = new Date(e.time);
    const hhmm = String(pd.getUTCHours()).padStart(2, '0') + ':' + String(pd.getUTCMinutes()).padStart(2, '0') + ' UTC';
    const extras = [];
    if (e.con) {
      let con = e.con;
      if (I18n.isZhOrJa()) {
        const full = _t('constellation.' + e.con);
        if (full && full.indexOf('constellation.') !== 0) con = full;
      }
      extras.push(`<span${_glossAttr('pev_constellation')}>${_t('pev.card.in_constellation', { con })}</span>`);
    }
    if (e.sep != null)
      extras.push(`<span${_glossAttr('pev_separation')}>${_t('pev.card.separation')}</span> ${_fmtSep(e.sep)}`);
    else if (e.type === 'greatest_elongation')
      extras.push(`<span${_glossAttr('pev_elongation')}>${_t('pev.card.elongation')}</span> ${e.elong.toFixed(1)}°`);
    if (e.mag != null)
      extras.push(`<span${_glossAttr('magnitude')}>${_t('pev.card.magnitude')}</span> ${e.mag.toFixed(1)}`);
    return (
      `<div class="eclipse-card pev-card" data-idx="${i}" data-type="${e.cat}" data-bodies="${e.bodies.join(' ')}">` +
      `<div class="ec-header">` +
      `<span class="ec-glyph pev-glyph">${pevGlyphHtml(e)}</span>` +
      `<div class="ec-body">` +
      `<div class="ec-row1"><span class="ec-date">${e.date} ${hhmm}</span><span class="ec-dt">${dt}</span></div>` +
      `<div class="ec-row2 pev-phrase">${pevPhraseHtml(e)}</div>` +
      `<div class="ec-row3">${extras.join(' · ')}</div>` +
      `</div></div><div class="ec-detail" hidden></div></div>`
    );
  }

  function showPlanetEventDetail(e, card) {
    collapseExpandedCard(false);
    if (!card) return;
    const meta = [];
    if (e.type === 'greatest_elongation')
      meta.push(`<span${_glossAttr('pev_elongation')}>${_t('pev.card.elongation')}</span> ${e.elong.toFixed(1)}°`);

    // Descriptive sentences use each body's full name (never the short
    // "月"/"Moon" form the merged header phrase uses) — a narrative sentence
    // reads oddly with a one-character subject. Constellation and closest-
    // approach separation are already implied by the sentence itself, so the
    // card's own extras (row3) aren't repeated here.
    let descLine;
    if (e.bodies.length === 1) {
      const params = { body: pevBodyName(e.bodies[0]) };
      if (e.type === 'comet_perigee' && e.dist != null) params.dist = e.dist.toFixed(3);
      // Perihelion carries a heliocentric distance (q) rather than a geocentric one.
      if (e.type === 'comet_perihelion' && e.helioDist != null) params.dist = e.helioDist.toFixed(3);
      if (e.level != null) params.level = e.level;
      descLine = _t(pevDescKey(e), params);
    } else {
      descLine = _t('pev.desc.conjunction_pair', {
        body1: pevBodyName(e.primary),
        body2: pevBodyName(pevOtherBody(e)),
        sep: _fmtSep(e.sep),
        dir: _t('pev.dir.' + e.dir),
      });
    }
    descLine = _cjkLatinSpace(descLine);
    _renderInlineDetail(card, { descLine, metaLine: meta.join(' · '), times: [], durLine: '' }, null);
  }

  // Grow the controller window outward until `target` events pass the predicate,
  // the dataset is exhausted, or the window hits `maxSize`, then let the caller
  // re-render; the return says whether it grew. Two callers: the eclipse list,
  // whose data-filter CSS-hides non-matches in a full-array window, needs the
  // larger FILTER_MAX_WINDOW so a sparse sub-filter still fills the panel; the
  // planet list windows over its filtered subset (setFilter) and just tops up to
  // the viewport height with an always-true predicate against the 60-event cap.
  const FILTER_MAX_WINDOW = 200; // a filtered list may grow past the 60-event unfiltered cap
  const PEV_MIN_CARD_PX = 64; // conservative collapsed card height, so fillTarget overshoots the
  // real count slightly and the panel always fills rather than leaving a bottom gap

  function fillTarget(listEl) {
    return Math.ceil((listEl.clientHeight || 320) / PEV_MIN_CARD_PX) + 1;
  }

  function autoFillWindow(controller, predicate, target, maxSize) {
    const startSize = controller.windowSize();
    let guard = 0;
    while (guard++ < 128) {
      if (controller.events().filter(predicate).length >= target) break;
      if (controller.windowSize() >= maxSize) break;
      let grew = false;
      if (controller.canLoadEarlier()) {
        controller.loadEarlier();
        grew = true;
      }
      if (controller.canLoadLater()) {
        controller.loadLater();
        grew = true;
      }
      if (!grew) break;
    }
    return controller.windowSize() > startSize;
  }

  // Trim a cleared filter's oversized window back to the unfiltered cap, split across
  // both ends so the cursor stays roughly centred. Paired with autoFillWindow: grow on
  // a filter, shrink on clear.
  function shrinkWindow(controller) {
    const excess = controller.windowSize() - controller.maxWindow();
    if (excess <= 0) return;
    const half = Math.floor(excess / 2);
    controller.trimEarlier(half);
    controller.trimLater(excess - half);
  }

  // Does body id `b` satisfy the active chip set? Direct membership, plus three
  // aggregate chips: 'star' covers every 'star:*' id, 'comet' every 'comet:*' id,
  // 'asteroids' the three main-belt ids. Feeds pevEventMatches, the predicate the
  // controller windows over when a filter is active.
  function pevBodyChipMatches(b) {
    return (
      _pevFilterBodies.has(b) ||
      (b.indexOf('star:') === 0 && _pevFilterBodies.has('star')) ||
      (b.indexOf('comet:') === 0 && _pevFilterBodies.has('comet')) ||
      (PEV_ASTEROID_IDS.includes(b) && _pevFilterBodies.has('asteroids'))
    );
  }

  function pevEventMatches(e) {
    if (_pevFilterBodies.size === 0) return true;
    return e.bodies.some(pevBodyChipMatches);
  }

  function eclipseEventMatches(e) {
    if (_eclipseFilter !== 'all' && e._kind !== _eclipseFilter) return false;
    if (!_eclipseCentralOnly) return true;
    const t = (e.kind || '').toLowerCase();
    if (_eclipseFilter === 'solar') return t !== 'partial';
    if (_eclipseFilter === 'lunar') return t !== 'partial' && t !== 'penumbral';
    return true;
  }

  function ensurePlanetLeftStructure() {
    const content = contentLeft();
    if (!content) return null;
    if (!content.querySelector('#sidebar-left-plist')) {
      const bodyChips = PEV_BODY_CHIPS.map((b) => {
        const sym = b === 'star' ? '✶' : b === 'asteroids' ? '⚳' : b === 'comet' ? '☄' : PEV_BODY_SYM[b];
        const name =
          b === 'star'
            ? _t('pev.filter.star')
            : b === 'asteroids'
              ? _t('pev.filter.asteroids')
              : b === 'comet'
                ? _t('pev.filter.comet')
                : pevBodyName(b);
        return `<button class="pev-body-chip" data-body="${b}" aria-pressed="${_pevFilterBodies.has(b)}"${_glossTip(name)}>${sym}</button>`;
      }).join('');
      content.innerHTML = `
        <div id="sidebar-left-plist">
          <div class="eclipse-list-header">
            <h3>${_t('pev.list.title')}</h3>
          </div>
          <div class="list-filter-row pev-filter-bodies">${bodyChips}</div>
          ${loadMoreBtnHtml('earlier')}
          <div class="eclipse-list" id="planet-list-cards"></div>
          ${loadMoreBtnHtml('later')}
        </div>`;
    }
    _updateHandleVisibility();
    return content;
  }

  // Horizontal drag-to-scroll for the body-chip filter. On the narrow drawer the
  // row overflows with its scrollbar hidden (see .pev-filter-bodies, style.css):
  // touch pans it natively, but a mouse has nothing to grab. Translate a
  // left-button press-drag into scrollLeft, and swallow the click that closes the
  // gesture so a drag never toggles the chip it happens to end on. Skipped for
  // touch (native panning is smoother) and when the row does not overflow (wide
  // screens), so ordinary chip clicks there are untouched. Guarded to wire each
  // row element once, since the same element survives non-flip re-renders.
  function _wirePevDragScroll(row) {
    if (!row || row.dataset.pevDragWired) return;
    row.dataset.pevDragWired = '1';

    // Keep the edge-fade honest: fade a side only while there is still hidden
    // content that way. At scrollLeft 0 the left edge sits flush (no fade); at the
    // far end the right edge does. A non-overflowing row fades neither. Driven by
    // the row's own scroll event, so every frame of a smooth scroll converges here.
    const updateFade = () => {
      const max = row.scrollWidth - row.clientWidth;
      row.classList.toggle('pev-fade-l', row.scrollLeft > 1);
      row.classList.toggle('pev-fade-r', max > 1 && row.scrollLeft < max - 1);
    };
    row.addEventListener('scroll', updateFade, { passive: true });
    // A viewport resize changes overflow (wide row fits → narrow row scrolls) but
    // fires no scroll event, so recompute on resize too. Skip once the row leaves
    // the DOM so a stale rebuilt row is never touched.
    window.addEventListener('resize', () => {
      if (row.isConnected) updateFade();
    });
    updateFade();

    let down = false;
    let dragged = false;
    let startX = 0;
    let startLeft = 0;
    row.addEventListener(
      'click',
      (e) => {
        if (dragged) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );
    row.addEventListener('pointerdown', (e) => {
      dragged = false;
      if (e.pointerType === 'touch' || e.button !== 0) return;
      if (row.scrollWidth - row.clientWidth < 1) return;
      down = true;
      startX = e.clientX;
      startLeft = row.scrollLeft;
    });
    row.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      // Capture only once a real drag begins. Capturing on pointerdown would
      // redirect the closing click's target from the chip to this row, so a plain
      // click would never reach the chip's toggle. Below the threshold this stays
      // a normal click.
      if (!dragged && Math.abs(dx) > 3) {
        dragged = true;
        row.setPointerCapture(e.pointerId);
        row.classList.add('pev-dragging');
      }
      if (!dragged) return;
      row.scrollLeft = startLeft - dx;
      e.preventDefault();
    });

    const end = (e) => {
      if (!down) return;
      down = false;
      row.classList.remove('pev-dragging');
      try {
        row.releasePointerCapture(e.pointerId);
      } catch (_) {}
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);

    // Edge nudge: clicking the chip sitting at the visible left/right edge scrolls
    // the row to expose its hidden neighbour, so users who never try dragging
    // still see there is more. Runs in the bubble phase, after the chip's own
    // toggle; a drag-click is stopped in the capture phase above and never reaches
    // here. The smooth scroll doubles as the discovery cue — the row visibly
    // moves. No-op on wide screens, where the row does not overflow.
    row.addEventListener('click', (e) => {
      const chip = e.target.closest('.pev-body-chip');
      if (!chip || row.scrollWidth - row.clientWidth < 1) return;
      const rowRect = row.getBoundingClientRect();
      const visible = [...row.querySelectorAll('.pev-body-chip')].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.right > rowRect.left + 1 && r.left < rowRect.right - 1;
      });
      const inset = 24;
      // Reveal the hidden neighbour past the clicked edge chip. When the edge chip
      // is itself the first/last one (no neighbour) yet sits clipped under the fade,
      // fall back to revealing the chip itself — a clipped seal must come fully into
      // view on click, not stay half-eaten. Aiming past the true end overshoots, and
      // the browser clamps scrollLeft to [0, max], so the chip lands flush. The
      // direction guard scrolls only the way that exposes more, never jittering when
      // the edge is already flush.
      const prev = chip.previousElementSibling;
      const next = chip.nextElementSibling;
      if (chip === visible[0]) {
        const target = prev || chip;
        const d = target.getBoundingClientRect().left - (rowRect.left + inset);
        if (d < 0) row.scrollTo({ left: row.scrollLeft + d, behavior: 'smooth' });
      } else if (chip === visible[visible.length - 1]) {
        const target = next || chip;
        const d = target.getBoundingClientRect().right - (rowRect.right - inset);
        if (d > 0) row.scrollTo({ left: row.scrollLeft + d, behavior: 'smooth' });
      }
    });
  }

  // Fly the map to the event's sub-point(s) at event time, jump the clock, and
  // open trajectories for all participating planets. Stars return null from
  // getSearchLatLng and are skipped; BodyTrajectory.toggle guards star ids via
  // SPECS[id] and silently returns false, so no explicit star filter is needed.
  // jumpTo (not setTime) marks this a discrete navigation, so BodyTrajectory's
  // jump listener clears any previously-open trajectories before this event's
  // bodies are opened fresh below.
  function _jumpToPevEvent(e) {
    const map = window.appMap;
    if (!map) return;
    const t = new Date(e._timeMs);
    TimeState.jumpTo(t);
    const pts = e.bodies.map((id) => Planets.getSearchLatLng(id, t)).filter(Boolean);
    if (pts.length > 0) {
      const centerLng = map.getCenter().lng;
      const lngs = pts.map((p) => {
        let lng = p.lng;
        while (lng - centerLng > 180) lng -= 360;
        while (lng - centerLng < -180) lng += 360;
        return lng;
      });
      // Centred on the sub-point (single body) or the wrap-normalized midpoint
      // (two bodies). The two bodies of an appulse sit ≤ APPULSE_MAX_DEG (5°) apart,
      // which fits a zoom-6 viewport, so both stay framed without the trajectories
      // widening the view. Asteroids jump two steps closer (zoom 8): the dot vanishes below zoom 8
      // (mag cutoff 9 at zoom 8 clears all three main-belt bodies), so the dot
      // and its engraving icon are guaranteed visible at the landing zoom.
      const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const lng = lngs.reduce((s, l) => s + l, 0) / lngs.length;
      const jumpZoom = e.bodies.some((b) => PEV_ASTEROID_IDS.includes(b)) ? 8 : 6;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      map.flyTo([lat, lng], jumpZoom, { animate: !reduced });
    }
    if (typeof BodyTrajectory !== 'undefined') {
      e.bodies.forEach((id) => {
        if (!BodyTrajectory.isOn(id)) BodyTrajectory.toggle(id);
      });
    }
  }

  function showPlanetEventList(controller, onSelect) {
    const content = ensurePlanetLeftStructure();
    if (!content) return;
    // Pure DOM builder — see showEclipseList: opening is the caller's
    // onLayerToggle('planet-events', true), so a re-render (locale switch, card
    // flip) never forces the drawer open nor evicts the right panel on mobile.

    const earlierBtn = content.querySelector('.eclipse-load-earlier');
    const laterBtn = content.querySelector('.eclipse-load-later');
    const listEl = content.querySelector('#planet-list-cards');
    let _winEvents = [];

    // The controller windows over the filtered subset (see setFilter), so every
    // card in the window is a match — the 60-event cap holds whether or not a
    // filter is active, no larger filtered bound needed.
    const effMax = () => controller.maxWindow();

    function _maybeTrimLater() {
      // Freeze the tail once the window reaches the true last event: trimming it
      // there would delete the cards the user just paged down to. Slide only
      // while the bottom edge is still mid-list.
      if (!controller.canLoadLater()) return 0;
      const excess = controller.windowSize() - effMax();
      return excess > 0 ? controller.trimLater(excess) : 0;
    }

    function _maybeTrimEarlier() {
      // Mirror of _maybeTrimLater: keep the head frozen at the true first event.
      if (!controller.canLoadEarlier()) return 0;
      const excess = controller.windowSize() - effMax();
      return excess > 0 ? controller.trimEarlier(excess) : 0;
    }

    function scrollToIdx(idx, block, markActive) {
      let node = listEl.querySelector(`.pev-card[data-idx="${idx}"]`);
      if (node && node.style.display === 'none') node = null;
      if (!node) {
        let best = Infinity;
        listEl.querySelectorAll('.pev-card').forEach((c) => {
          if (c.style.display === 'none') return;
          const d = Math.abs(+c.dataset.idx - idx);
          if (d < best) {
            best = d;
            node = c;
          }
        });
      }
      if (!node) return;
      if (markActive) node.setAttribute('data-active', 'true');
      node.scrollIntoView({ block });
    }

    function positionCursor() {
      collapseExpandedCard();
      listEl.querySelectorAll('.pev-card[data-active]').forEach((c) => c.removeAttribute('data-active'));
      scrollToIdx(controller.cursorInWin(), 'center', true);
    }

    function renderCards(opts) {
      opts = opts || { scrollTo: { type: 'cursor' } };
      _expandedCard = null;
      _winEvents = controller.events();
      listEl.innerHTML = _winEvents.map((e, i) => planetCardHtml(e, i)).join('');
      earlierBtn.disabled = !controller.canLoadEarlier();
      laterBtn.disabled = !controller.canLoadLater();
      const target = opts.scrollTo;
      if (!target || target.type === 'cursor') positionCursor();
      else if (target.type === 'index') scrollToIdx(target.index, 'start', false);
      else if (target.type === 'preserveAfterPrepend') scrollToIdx(target.added, 'start', false);
      else if (target.type === 'restore') listEl.scrollTop = target.scrollTop;
      if (opts.newRange) {
        for (let i = opts.newRange.from; i < opts.newRange.to; i++) {
          const c = listEl.querySelector(`.pev-card[data-idx="${i}"]`);
          if (c) c.classList.add('ec-new');
        }
      }
    }

    earlierBtn.onclick = () => {
      const prevLen = controller.events().length;
      controller.loadEarlier();
      const added = controller.events().length - prevLen;
      _maybeTrimLater();
      renderCards({ scrollTo: { type: 'preserveAfterPrepend', added }, newRange: { from: 0, to: added } });
    };
    laterBtn.onclick = () => {
      const prevLen = controller.events().length;
      controller.loadLater();
      const trimmed = _maybeTrimEarlier();
      renderCards({ scrollTo: { type: 'index', index: prevLen - trimmed } });
    };

    let _cooldown = false;
    listEl.addEventListener(
      'wheel',
      (e) => {
        if (_cooldown) return;
        const atTop = listEl.scrollTop <= 1;
        const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight <= 1;
        if (e.deltaY < 0 && atTop && controller.canLoadEarlier()) {
          e.preventDefault();
          _cooldown = true;
          const prevLen = controller.events().length;
          controller.loadEarlier();
          const added = controller.events().length - prevLen;
          _maybeTrimLater();
          renderCards({ scrollTo: { type: 'preserveAfterPrepend', added }, newRange: { from: 0, to: added } });
          setTimeout(() => (_cooldown = false), 400);
        } else if (e.deltaY > 0 && atBottom && controller.canLoadLater()) {
          e.preventDefault();
          _cooldown = true;
          const savedScrollTop = listEl.scrollTop;
          const prevLen = controller.events().length;
          controller.loadLater();
          const added = controller.events().length - prevLen;
          const trimmed = _maybeTrimEarlier();
          renderCards({
            scrollTo: { type: 'restore', scrollTop: savedScrollTop },
            newRange: { from: prevLen - trimmed, to: prevLen - trimmed + added },
          });
          setTimeout(() => (_cooldown = false), 400);
        }
      },
      { passive: false }
    );

    // Body-chip filter (multi-select, non-exclusive — unlike the eclipse filter).
    content.querySelectorAll('.pev-body-chip').forEach((chip) => {
      chip.onclick = () => {
        const b = chip.dataset.body;
        if (_pevFilterBodies.has(b)) _pevFilterBodies.delete(b);
        else _pevFilterBodies.add(b);
        chip.setAttribute('aria-pressed', _pevFilterBodies.has(b));
        controller.setFilter(_pevFilterBodies.size ? pevEventMatches : null);
        autoFillWindow(controller, () => true, fillTarget(listEl), controller.maxWindow());
        renderCards();
      };
    });
    _wirePevDragScroll(content.querySelector('.pev-filter-bodies'));

    // Click a card → expand its inline detail (appulse time, extra numbers).
    listEl.onclick = (ev) => {
      if (ev.target.closest('.ec-detail')) return;
      const card = ev.target.closest('.pev-card');
      if (!card || !listEl.contains(card)) return;
      if (card === _expandedCard) {
        collapseExpandedCard();
        return;
      }
      listEl.querySelectorAll('.pev-card[data-active]').forEach((c) => c.removeAttribute('data-active'));
      card.setAttribute('data-active', 'true');
      const e = _winEvents[+card.dataset.idx];
      if (onSelect) onSelect(e);
      showPlanetEventDetail(e, card);
      _jumpToPevEvent(e);
    };

    // Land a persisted filter into the controller so it windows over the matching
    // subset, then fill the viewport on first open (the default ±10 window can be
    // shorter than the panel is tall). Reading listEl.clientHeight here forces a
    // layout, so fillTarget sees the real panel height, not the 320px fallback.
    if (_pevFilterBodies.size) controller.setFilter(pevEventMatches);
    autoFillWindow(controller, () => true, fillTarget(listEl), controller.maxWindow());

    renderCards();
  }

  // ---- Left-Panel Owner Arbiter ----
  // The eclipse list and the planetary-events list share the single left panel
  // as a flip card. The front card renders in full; when both layers claim, the
  // front header grows a flip button that turns the card over to the other list.
  // Swapping is a view concern only — it never touches the map-layer toggles. A
  // newly claimed list comes to the front; a released front yields to the
  // survivor. Each claim also drives the i18n re-render.
  let _eclipseListCtrl = null;
  let _eclipseListOnSelect = null;
  let _planetListCtrl = null;
  let _planetListOnSelect = null;
  let _leftFront = null; // which claim faces front; null = fall back to first claim
  let _leftSwapPending = false; // rapid re-click guard while the crossfade runs
  const _origShowEclipseList = showEclipseList;
  const _origShowPlanetEventList = showPlanetEventList;
  const LEFT_TITLE_KEYS = { 'eclipse-list': 'eclipse.list.title', 'planet-events': 'pev.list.title' };

  function _leftClaims() {
    const claims = [];
    if (_eclipseListCtrl) claims.push('eclipse-list');
    if (_planetListCtrl) claims.push('planet-events');
    return claims;
  }

  function _leftOwner() {
    const claims = _leftClaims();
    if (claims.length === 0) return null;
    return _leftFront && claims.indexOf(_leftFront) !== -1 ? _leftFront : claims[0];
  }

  function _clearLeftStructures() {
    const content = contentLeft();
    if (!content) return;
    const a = content.querySelector('#sidebar-left-list');
    if (a) a.remove();
    const b = content.querySelector('#sidebar-left-plist');
    if (b) b.remove();
  }

  // Render the front card in full, wiping the loser's DOM so the two list
  // structures never coexist, then graft the flip control onto the front header.
  // Called on every claim/release/swap, not on filter/scroll.
  function _renderLeftOwner() {
    const owner = _leftOwner();
    _clearLeftStructures();
    if (owner === 'eclipse-list') _origShowEclipseList(_eclipseListCtrl, _eclipseListOnSelect);
    else if (owner === 'planet-events') _origShowPlanetEventList(_planetListCtrl, _planetListOnSelect);
    _renderLeftFlip(owner);
  }

  function _renderLeftFlip(owner) {
    const content = contentLeft();
    if (!content || !owner) return;
    const back = _leftClaims().filter((c) => c !== owner)[0];
    if (!back) return;
    const list = content.querySelector('#sidebar-left-list, #sidebar-left-plist');
    const header = list && list.querySelector('.eclipse-list-header');
    if (!header) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'left-flip-btn';
    btn.setAttribute('aria-label', _t(LEFT_TITLE_KEYS[back]));
    // Two counter arrows read as "flip to the other card"; currentColor lets the
    // hover state recolour the stroke, matching the load-more chevrons. No
    // data-tip — that carries the [data-tip] dashed-underline glossary decoration,
    // wrong for a button, and the aria-label already names the switch target.
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="7 4 7 20"/><polyline points="4 7 7 4 10 7"/><polyline points="17 20 17 4"/><polyline points="14 17 17 20 20 17"/></svg>';
    btn.addEventListener('click', () => _swapLeftFront(back));
    header.appendChild(btn);
  }

  function _swapLeftFront(front) {
    if (_leftSwapPending || _leftOwner() === front) return;
    _leftSwapPending = true;
    const content = contentLeft();
    if (!content) {
      _leftSwapPending = false;
      return;
    }
    // Two-step card flip: the current front's header turns away (rotateX) while
    // its body fades, then the stack rebuilds with the new front, whose header
    // flips in from the opposite tilt. Flipping the outgoing node and animating
    // the incoming node reads as one continuous turn across the innerHTML swap.
    // The pending flag absorbs rapid re-clicks mid-flip (same hazard as the
    // LayerFade pane transitions).
    const outList = content.querySelector('#sidebar-left-list, #sidebar-left-plist');
    if (outList) outList.classList.add('left-flip-out');
    setTimeout(() => {
      _leftFront = front;
      _renderLeftOwner();
      const inList = content.querySelector('#sidebar-left-list, #sidebar-left-plist');
      if (inList) {
        inList.classList.add('left-flip-in');
        setTimeout(() => inList.classList.remove('left-flip-in'), 200);
      }
      setTimeout(() => {
        _leftSwapPending = false;
      }, 130);
    }, 130);
  }

  showEclipseList = function (controller, onSelect) {
    const isNewClaim = !_eclipseListCtrl;
    _eclipseListCtrl = controller;
    _eclipseListOnSelect = onSelect;
    if (isNewClaim) _leftFront = 'eclipse-list';
    _renderLeftOwner();
  };
  showPlanetEventList = function (controller, onSelect) {
    const isNewClaim = !_planetListCtrl;
    _planetListCtrl = controller;
    _planetListOnSelect = onSelect;
    if (isNewClaim) _leftFront = 'planet-events';
    _renderLeftOwner();
  };

  // Track last eclipse detail event for i18n re-render
  let _eclipseDetailEvent = null;
  let _eclipseDetailOnBack = null;
  let _eclipseDetailType = null; // 'solar' | 'lunar'

  const _origShowEclipse = showEclipse;
  showEclipse = function (event, onBack) {
    _eclipseDetailEvent = event;
    _eclipseDetailOnBack = onBack;
    _eclipseDetailType = 'solar';
    _origShowEclipse(event, onBack);
  };
  const _origShowLunarEclipse = showLunarEclipse;
  showLunarEclipse = function (event, onBack) {
    _eclipseDetailEvent = event;
    _eclipseDetailOnBack = onBack;
    _eclipseDetailType = 'lunar';
    _origShowLunarEclipse(event, onBack);
  };

  // Reveal a given eclipse kind in the browse list before navigating to it, so
  // the target event's card isn't hidden by the filters (a hidden cursor card
  // makes the active-marker fall back to the nearest visible — wrong-kind — card,
  // which then receives the detail render). No-op only when the kind is already
  // shown and no central-only sub-filter could still hide the target.
  function setEclipseListFilter(kind) {
    if (kind !== 'solar' && kind !== 'lunar') return;
    // A specific event was targeted, so neither the primary nor the central-only
    // sub-filter may hide it. Switch the primary unless the combined view already
    // shows this kind, and disarm central-only unconditionally — a partial target
    // of the already-active kind would otherwise stay hidden behind it.
    const needKind = _eclipseFilter !== 'all' && _eclipseFilter !== kind;
    if (!needKind && !_eclipseCentralOnly) return;
    if (needKind) _eclipseFilter = kind;
    _eclipseCentralOnly = false;
    const content = contentLeft();
    if (content) {
      content
        .querySelectorAll('.eclipse-filter-btn')
        .forEach((b) => b.setAttribute('aria-pressed', b.dataset.filter === _eclipseFilter));
      const listEl = content.querySelector('#eclipse-list-cards');
      if (listEl) {
        listEl.dataset.filter = _eclipseFilter;
        delete listEl.dataset.central;
      }
      updateEclipseSubSeal(content);
    }
  }

  function _updateAtlasInfoHref() {
    var el = document.getElementById('atlas-info-link');
    if (!el) return;
    var loc = typeof I18n !== 'undefined' ? I18n.getLocale() : 'en';
    el.href = 'https://github.com/Higashimado/SubstellarAtlas/blob/main/' + loc + '/README.md';
  }

  _updateAtlasInfoHref();

  if (typeof I18n !== 'undefined') {
    I18n.subscribe(function () {
      _updateAtlasInfoHref();
      // Re-render right sidebar if open, preserving scroll position. The full
      // innerHTML rebuild destroys and recreates .sidebar-scroll, so we save
      // scrollTop before and restore it to the new element after.
      if (_lat !== null && sidebarState.right.open) {
        var prevScroll = contentRight().querySelector('.sidebar-scroll');
        var savedScrollTop = prevScroll ? prevScroll.scrollTop : 0;
        render(_lat, _lng, TimeState.current);
        var newScroll = contentRight().querySelector('.sidebar-scroll');
        if (newScroll && savedScrollTop > 0) newScroll.scrollTop = savedScrollTop;
      }
      // Re-render whichever list owns the left sidebar with the new locale.
      // No open-state guard: rebuild even while closed so the user sees the
      // correct locale immediately on next open (without the guard, a language
      // switch with the panel closed left stale DOM — title and chips stayed in
      // the old locale because ensurePlanetLeftStructure's querySelector guard
      // skipped the rebuild, and only renderCards ran on next open).
      if (_leftOwner()) {
        _renderLeftOwner();
      }
    });
  }

  if (typeof AppState !== 'undefined') {
    AppState.registerParam('panel', {
      get: () => {
        const l = sidebarState.left.open;
        const r = sidebarState.right.open;
        return l && r ? 'lr' : l ? 'l' : r ? 'r' : null;
      },
      set: (v) => {
        setSidebar('left', v.includes('l'), 'manual');
        setSidebar('right', v.includes('r'), 'manual');
      },
    });
  }

  return {
    show(lat, lng) {
      _lat = lat;
      _lng = lng;
      render(lat, lng, TimeState.current);
      _updateHandleVisibility();
      setSidebar('right', true, 'auto');
    },

    // Re-render the current location's panels in place (e.g. after a layer's
    // async data arrives). Preserves scroll; no-op if no location / panel closed.
    refresh: refreshRight,

    // Update the panel's observer location and re-render times in place. Called
    // by EVERY observer move (Observer.place → onPlace), including marker
    // re-click / drag paths that don't go through show(). Keeps _lat/_lng and
    // the displayed rise/set in lockstep with the marker. No-op if panel closed
    // (show() will pick up the location when it next opens).
    setLocation(lat, lng) {
      _lat = lat;
      _lng = lng;
      if (sidebarState.right.open) render(lat, lng, TimeState.current);
    },

    showLightPollution,
    setLpLayerActive,
    showWeather,
    showEclipse,
    showLunarEclipse,
    showEclipseList,
    showPlanetEventList,
    setEclipseListFilter,

    // State machine API (called by map layer toggles, time slider, etc.)
    setSidebar,
    onLayerToggle,
    updateHandleVisibility: _updateHandleVisibility,

    hide() {
      setSidebar('right', false, 'auto');
    },
  };
})();
