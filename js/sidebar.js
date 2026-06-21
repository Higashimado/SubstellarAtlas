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

  // Layer → sidebar autoOpen mapping. Currently only eclipse-list is wired;
  // others can be added without code changes elsewhere.
  const LAYERS = {
    'eclipse-list': { defaultPanel: 'left', autoOpen: true },
  };

  function onLayerToggle(layerId, isOn) {
    const meta = LAYERS[layerId];
    if (!meta || !meta.defaultPanel) return;
    if (isOn && meta.autoOpen) {
      if (sidebarState[meta.defaultPanel].manualOverride !== false) {
        setSidebar(meta.defaultPanel, true, 'auto');
      }
    } else if (!isOn) {
      // Reset override so next time the layer is toggled on, autoOpen works again
      sidebarState[meta.defaultPanel].manualOverride = null;
      setSidebar(meta.defaultPanel, false, 'auto');
    }
  }

  // Wire toggle handles after DOM ready
  function wireToggles() {
    document.querySelectorAll('.sidebar-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const aside = e.currentTarget.closest('.sidebar');
        const side = aside.classList.contains('sidebar--left') ? 'left' : 'right';
        setSidebar(side, !sidebarState[side].open, 'manual');
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

    // Legend — single row; i18n strings are abbreviated so they fit all locales
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
      `<text x="${PAD.left + 204}" y="12" font-size="13" fill="#9aa0aa"${_glossAttr('galactic_core')}>${_t('panel.galactic.legend.galactic_core')}</text>`
    );

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
    return _loadCollapse()[panelId] === true;
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
  // Lightweight toast (own element + CSS, mirrors #eclipse-toast / #time-toast —
  // the project keeps a small per-feature toast rather than one shared widget).
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
  function _altCell(h) {
    if (!h || isNaN(h.alt)) return `<td class="ecl-ct-alt"></td>`;
    const a = Math.round(h.alt);
    const altStr = (a < 0 ? '−' : '+') + Math.abs(a) + '°';
    return `<td class="ecl-ct-alt">${altStr}</td>`;
  }

  // Contact table for an in-progress eclipse: one row per contact carrying the
  // localized label, the body's azimuth degree / compass direction / altitude in
  // separate columns, and a click-to-jump time on the far right. defs is
  // [labelKey, Date|null]; absent contacts (e.g. solar C2/C3 of a partial) are
  // skipped, so callers can list every possible contact unconditionally.
  // defs entries are [labelKey, Date|null, glossSlug?]; the optional slug puts a
  // hover definition on the contact-name label (the coordinate cells stay tip-free).
  function _eclContactTable(defs, body, lat, lng) {
    const haveAzEl = typeof Astronomy !== 'undefined' && typeof bodyHorizontal === 'function';
    const rows = defs
      .map(([labelKey, date, glossSlug]) => {
        if (!date || isNaN(date.getTime())) return '';
        const h = haveAzEl ? bodyHorizontal(body, date, lat, lng) : null;
        // Below the horizon → the contact isn't observable here, so the time is
        // shown dim and plain (no accent, no hover, no click-to-jump). Text stays
        // selectable. Otherwise it's an accented click-to-jump target.
        const below = h && isFinite(h.alt) && h.alt < 0;
        const timeCell = below
          ? `<td class="ecl-ct-time ecl-ct-below">${fmtTime(date)}</td>`
          : `<td class="ecl-ct-time time-jump"${timeAttr(date)}>${fmtTime(date)}</td>`;
        // Altitude before azimuth, matching the sky-path diagram (altitude on the
        // left/y axis, azimuth on the bottom/x axis).
        return (
          `<tr>` +
          `<td class="ecl-ct-label"${glossSlug ? _glossAttr(glossSlug) : ''}>${_t(labelKey)}</td>` +
          _altCell(h) +
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
    // Outside the penumbra → not visible.
    // Inside the penumbra but Sun below horizon at every contact → also not visible
    // (Besselian geometry doesn't account for the observer's horizon).
    const haveAzEl = typeof Astronomy !== 'undefined' && typeof bodyHorizontal === 'function';
    const Sun = Astronomy.Body.Sun;
    const sunContactDates = lc
      ? [lc.c1, lc.c2, lc.c3, lc.c4, lc.maxTime].filter((d) => d instanceof Date && !isNaN(d))
      : [];
    const sunVisible =
      !haveAzEl ||
      !sunContactDates.length ||
      sunContactDates.some((d) => {
        const h = bodyHorizontal(Sun, d, lat, lng);
        return h && isFinite(h.alt) && h.alt >= 0;
      });
    if (!lc || !lc.visible || !sunVisible) {
      html += `<div class="ecl-note">${_t('panel.eclipse.not_visible_here')}</div>`;
      return html + _eclForecastBelow(lat, lng, ev);
    }
    const sgloss = {
      P1: _gloss('ecl_c_p1_solar'),
      G: _gloss('ecl_c_greatest'),
      P4: _gloss('ecl_c_p4_solar'),
      sunpath: _gloss('ecl_sunpath'),
    };
    const diagram =
      typeof EclipseGlyph !== 'undefined'
        ? EclipseGlyph.renderSchematic(ev, { observer: { lat, lng }, contacts: lc, gloss: sgloss })
        : '';
    // Solar variant stacks the stat readout as a top bar above the plot (not an
    // overlay) so it never covers the SVG's left altitude-axis labels.
    if (diagram) html += `<div class="ecl-diagram ecl-diagram--solar">${_eclSolarSchemStats(lc)}${diagram}</div>`;
    const defs = [
      ['eclipse.contact.p1', lc.c1, 'ecl_c_p1_solar'],
      ['eclipse.contact.p2', lc.c2, 'ecl_c_p2_solar'],
      ['eclipse.contact.greatest', lc.maxTime, 'ecl_c_greatest'],
      ['eclipse.contact.p3', lc.c3, 'ecl_c_p3_solar'],
      ['eclipse.contact.p4', lc.c4, 'ecl_c_p4_solar'],
    ];
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
    html += _eclContactTable(defs, Moon, lat, lng);
    return html + _eclForecastBelow(lat, lng, ev);
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
      const lbl = `<span class="label"${_glossTip(_t(labelKey + '.tooltip'))}>${_t(labelKey)}</span>`;
      if (!slot)
        return (
          `<div class="info-row">${lbl}` +
          `<span class="value data-value"${I18n.glossAttr('ecl_none_here')}>—</span></div>`
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
      '<div id="lp-section"></div>' +
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
    // uses), so longitude-wrap, reduced-motion and popup handling are shared.
    const _jumpVia = async (r) => {
      const map = window.appMap;
      if (!map || typeof CelestialSearch === 'undefined' || !CelestialSearch.select) return;
      // Auto-enable the relevant layer if it is currently off, so the jump always
      // lands with the body/satellite visible on the map.
      if (r.kind === 'satellite') {
        if (typeof Sat !== 'undefined' && !Sat.isOn()) await Sat.toggle(map);
      } else if (r.kind === 'moon') {
        if (typeof AppState !== 'undefined' && !AppState.isLayerOn('moon')) AppState.setLayerOn('moon', true);
      } else if (r.kind === 'planet') {
        if (typeof AppState !== 'undefined' && !AppState.isLayerOn('planets')) AppState.setLayerOn('planets', true);
      }
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

  // ---- Light Pollution Section ----
  function showLightPollution(data) {
    const container = document.getElementById('lp-section');
    if (!container) return;

    if (data.outOfBounds) {
      container.innerHTML = section(
        'lp',
        `<h3>${_t('panel.lp.title')}</h3>`,
        '<p class="chart-note">⚠ ' + _t('panel.lp.error.out_of_bounds') + '</p>'
      );
      wirePanelToggles(container);
      return;
    }

    if (data.error) {
      container.innerHTML = section(
        'lp',
        `<h3>${_t('panel.lp.title')}</h3>`,
        `<p class="chart-note">⚠ ${_t('panel.lp.error.fetch_failed')}：${data.error}</p>`
      );
      wirePanelToggles(container);
      return;
    }

    const mpsas = data.mpsas.toFixed(2);
    const ratio = LightPollution.roundBrightness(data.ratio);
    // Per-zone hover on the level: collapse the a/b sub-zone to its whole level
    // (0–7, e.g. "3b" → 3) and show that level's sky description. Label keeps the
    // general index.tooltip.
    const lvl = parseInt(data.zone, 10) || 0;
    const zoneVal = `<span${_glossTip(_t('panel.lp.zone.' + lvl))}>${data.zone}</span>`;

    container.innerHTML = section(
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
    wirePanelToggles(container);
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

  function _renderInlineDetail(card, { metaLine, times, durLine }, onBack) {
    _expandedCard = card;
    _expandedOnBack = onBack;
    card.setAttribute('data-expanded', 'true');
    const detail = card.querySelector('.ec-detail');
    if (!detail) return;
    detail.innerHTML =
      (metaLine ? `<div class="ec-meta-line">${metaLine}</div>` : '') +
      `<table class="ec-detail-times">` +
      times
        .map((r) => {
          const desc = r.key ? r.label.replace(new RegExp(`^${r.key}\\s*`), '') : r.label;
          return `<tr class="et-clickable" data-time="${r.val}"><td class="et-key">${r.key || ''}</td><td class="et-desc"${r.slug ? _glossAttr(r.slug) : ''}>${desc}</td><td class="et-val">${_fmtTime(r.val)}</td></tr>`;
        })
        .join('') +
      `</table>` +
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
            <div class="eclipse-filter">
              <button class="eclipse-filter-btn" data-filter="solar" aria-pressed="${_eclipseFilter === 'solar'}">${_t('eclipse.filter.solar')}</button>
              <button class="eclipse-filter-btn" data-filter="lunar" aria-pressed="${_eclipseFilter === 'lunar'}">${_t('eclipse.filter.lunar')}</button>
            </div>
          </div>
          <button class="eclipse-load-more eclipse-load-earlier" type="button">${_t('eclipse.list.load_earlier')}</button>
          <div class="eclipse-list" id="eclipse-list-cards"></div>
          <button class="eclipse-load-more eclipse-load-later" type="button">${_t('eclipse.list.load_later')}</button>
        </div>`;
    }
    // First population of the left sidebar — reveal its chevron handle.
    elLeft().dataset.hasContent = 'true';
    return content;
  }

  function showEclipseList(controller, onSelect) {
    // Browse view goes to the LEFT sidebar.  The argument is a controller
    // returned by eclipse.js makeListController() — a windowed chronological
    // view with cursorInWin pointing at the event nearest to current time.
    const content = ensureLeftStructure();
    if (!content) return;
    setSidebar('left', true, 'auto');

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
        <div class="eclipse-card" data-idx="${i}" data-kind="${e._kind}">
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

    // Trim helpers: call after expanding the window to keep DOM within MAX_WINDOW.
    // Return the number of items actually trimmed (needed to correct scroll indices).
    function _maybeTrimLater() {
      const excess = controller.windowSize() - controller.maxWindow();
      if (excess <= 0) return 0;
      return controller.trimLater(excess);
    }

    function _maybeTrimEarlier() {
      const excess = controller.windowSize() - controller.maxWindow();
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

    // The solar/lunar filter is applied purely via CSS (data-filter on the list
    // container) so toggling it never rebuilds the DOM or re-runs glyph SVG
    // generation — it only re-centers the cursor onto the nearest visible card.
    const isVisibleKind = (kind) => _eclipseFilter === 'all' || kind === _eclipseFilter;

    // Scroll to the card at window-index `idx`; if it is filtered out (CSS-
    // hidden) fall back to the nearest visible card so the view never jumps to
    // the top with nothing highlighted.
    function scrollToIdx(idx, block, markActive) {
      let node = listEl.querySelector(`.eclipse-card[data-idx="${idx}"]`);
      if (node && !isVisibleKind(node.dataset.kind)) node = null;
      if (!node) {
        let bestDist = Infinity;
        listEl.querySelectorAll('.eclipse-card').forEach((c) => {
          if (!isVisibleKind(c.dataset.kind)) return;
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

    // Wire filter buttons — CSS-only show/hide, no re-render.
    content.querySelectorAll('.eclipse-filter-btn').forEach((btn) => {
      btn.onclick = () => {
        const f = btn.dataset.filter;
        _eclipseFilter = _eclipseFilter === f ? 'all' : f;
        content.querySelectorAll('.eclipse-filter-btn').forEach((b) => {
          b.setAttribute('aria-pressed', b.dataset.filter === _eclipseFilter);
        });
        listEl.dataset.filter = _eclipseFilter;
        positionCursor();
      };
    });

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

  // Track last eclipse list controller/onSelect for i18n re-render
  let _eclipseListCtrl = null;
  let _eclipseListOnSelect = null;
  const _origShowEclipseList = showEclipseList;
  showEclipseList = function (controller, onSelect) {
    _eclipseListCtrl = controller;
    _eclipseListOnSelect = onSelect;
    _origShowEclipseList(controller, onSelect);
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
  // the target event's card isn't hidden by the solar/lunar filter (a hidden
  // cursor card makes the active-marker fall back to the nearest visible —
  // wrong-kind — card, which then receives the detail render). No-op when the
  // filter already shows this kind ('all', or already matching).
  function setEclipseListFilter(kind) {
    if (kind !== 'solar' && kind !== 'lunar') return;
    if (_eclipseFilter === 'all' || _eclipseFilter === kind) return;
    _eclipseFilter = kind;
    const content = contentLeft();
    if (content) {
      content
        .querySelectorAll('.eclipse-filter-btn')
        .forEach((b) => b.setAttribute('aria-pressed', b.dataset.filter === _eclipseFilter));
      const listEl = content.querySelector('#eclipse-list-cards');
      if (listEl) listEl.dataset.filter = _eclipseFilter;
    }
  }

  if (typeof I18n !== 'undefined') {
    I18n.subscribe(function () {
      // Re-render right sidebar if open
      if (_lat !== null && sidebarState.right.open) {
        render(_lat, _lng, TimeState.current);
      }
      // Re-render left sidebar eclipse list if present
      if (_eclipseListCtrl && sidebarState.left.open) {
        // Force rebuild of left sidebar structure with new locale
        var content = contentLeft();
        if (content) {
          var listEl = content.querySelector('#sidebar-left-list');
          if (listEl) listEl.remove();
        }
        _origShowEclipseList(_eclipseListCtrl, _eclipseListOnSelect);
      }
    });
  }

  return {
    show(lat, lng) {
      _lat = lat;
      _lng = lng;
      render(lat, lng, TimeState.current);
      // First population of the right sidebar — reveal its chevron handle.
      elRight().dataset.hasContent = 'true';
      setSidebar('right', true, 'auto');
    },

    // Re-render the current location's panels in place (e.g. after a layer's
    // async data arrives). No-op if no location is selected / right panel closed.
    refresh() {
      if (_lat !== null && sidebarState.right.open) render(_lat, _lng, TimeState.current);
    },

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
    showWeather,
    showEclipse,
    showLunarEclipse,
    showEclipseList,
    setEclipseListFilter,

    // State machine API (called by map layer toggles, time slider, etc.)
    setSidebar,
    onLayerToggle,

    hide() {
      setSidebar('right', false, 'auto');
    },
  };
})();
