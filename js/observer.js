/**
 * observer.js — Observer location marker + compass renderer.
 *
 * Manages the observer pin on the map AND renders the bone-white astrolabe
 * compass at the observer location. Marker/lifecycle and the renderer (formerly
 * rays.js) live in one module since the two are tightly coupled: observer owns
 * the pane and drives the compass, the compass reads window.currentObserverLatLng.
 *
 * Compass: screen-fixed azimuthal equidistant disc at the observer:
 *   r = (1 − alt/90) × R     alt=0 → rim, alt=90 → center
 * Draw order (bottom → top): envelope, rings, ticks, sun trace, moon trace,
 * direction lines, cardinal letters, planet symbols, rim labels, hover.
 *
 * Public API:  Observer.init(map, opts)
 *              Observer.place(lat, lng)
 *              Observer.clear()
 *              Observer.lock() / unlock() / isLocked()
 *
 * opts.onPlace(lat, lng) — called each time place() runs (used by map.js to
 *   clear any active altitude-contour layer, which is map.js-private state).
 *
 * Depends on: L (Leaflet), TimeState, I18n (optional), Planets, Astronomy,
 *   showCtxMenu (map.js-global context-menu helper).
 */
const Observer = (() => {
  const _t = typeof I18n !== 'undefined' ? I18n.t.bind(I18n) : (k) => k;

  // ---- Marker / Lifecycle State ----
  let _map = null;
  let _onPlace = null;
  let _marker = null;
  let _locked = false;
  let _skipNextDblClick = false;

  // ---- Compass Renderer State ----
  let _frame = null;
  let _hidden = true;
  // Compass is split across sibling panes by celestial tier (SVG has no per-
  // element z-index). Each pane holds one <svg> with a <g class="compass-root">;
  // all roots share the same translate.
  let _svgBase = null,
    _svgPlanet = null,
    _svgMoon = null,
    _svgSun = null;
  let _rootBase = null,
    _rootPlanet = null,
    _rootMoon = null,
    _rootSun = null;
  // Lines pane (traces + direction rays + hover ray) sits BELOW the glyph/label
  // tiers so no line ever covers an icon or label; cardinals pane sits above the
  // lines but below the glyph tiers. See the pane table in init().
  let _svgLines = null,
    _rootLines = null;
  let _svgCardinals = null,
    _rootCardinals = null;
  // Top-most compass pane (z=950) carrying the body hit-targets and the hover
  // name label, so both sit above every glyph regardless of tier.
  let _svgFx = null,
    _rootFx = null;
  let _hoveredBodyId = null;
  // id → { x, y, az, alt, raDeg, dec, tint, name, glyphId, body } for every body
  // currently drawn on the compass (sun, moon, and each visible planet). Drives
  // both the hover emphasis and the click-to-lock great-circle line.
  let _bodyPositions = {};
  // Hover emphasis is split across two panes so the brightened ray sits in the
  // lines pane (below glyphs/labels) while the body name sits in the top fx pane.
  let _hoverRayGroup = null;
  let _hoverNameGroup = null;
  // Pinned (click-locked) compass direction rays — a Set of body glyphIds whose
  // azimuth line stays extended + labelled until clicked again, the compass-side
  // analogue of the locking observer pin. Rebuilt each sync into _pinRayGroup
  // (lines pane, below glyphs) + _pinLabelGroup (fx pane, above every glyph).
  let _pinnedBodyIds = new Set();
  let _pinRayGroup = null;
  let _pinLabelGroup = null;
  // Rim-barb keep-out quads (viewport px) computed once per sync, cached so the
  // pin/hover extended rays (rebuilt outside the _doSync barb scope) can truncate
  // where they run under a rim barb — not just the resting sun/moon rays.
  let _barbQuadsCache = [];
  // Locked great-circle lines on the MAP: id → { glyphId, name, body, color }.
  // Rebuilt into _lockedGroup each sync (the body — and its ground point — moves
  // with time). Cleared when the observer is relocated or the compass hides.
  let _lockedBodies = {};
  let _lockedGroup = null;
  let _R = 0; // current horizon radius (px), set each sync

  // Envelope cache: keyed by `lat_0.1|year`
  let _envCache = { key: '', summer: null, winter: null };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // SVG path data for celestial body symbols — stroke-based line art, centered at (0,0).
  const PLANET_PATHS = {
    sun: 'M0,-5 A5,5 0 1,0 0,5 A5,5 0 1,0 0,-5' + ' M0,-1.5 A1.5,1.5 0 1,0 0,1.5 A1.5,1.5 0 1,0 0,-1.5',
    moon: 'M3.5,-4.2 A4.8,4.8 0 1,0 3.5,4.2 A4.2,4.2 0 1,1 3.5,-4.2 Z',
    mercury:
      'M-2.8,-5.5 C-2.8,-4.5 -1.5,-3.7 0,-3.7 C1.5,-3.7 2.8,-4.5 2.8,-5.5' +
      ' M0,-3.7 A2.8,2.8 0 1,0 0,1.9 A2.8,2.8 0 1,0 0,-3.7' +
      ' M0,1.9 V5.5 M-2.2,3.7 H2.2',
    venus: 'M0,-5 A2.8,2.8 0 1,0 0,0.6 A2.8,2.8 0 1,0 0,-5' + ' M0,0.6 V6 M-2.2,3.3 H2.2',
    mars:
      'M-0.5,-1.6 A2.8,2.8 0 1,0 -0.5,4 A2.8,2.8 0 1,0 -0.5,-1.6' +
      ' M1.5,-0.8 L5.5,-5.5 M5.5,-5.5 L2,-5.5 M5.5,-5.5 L5.5,-2',
    jupiter:
      'M-3.9,3.0 H3.9' +
      ' M-3.9,3.0 C-3.0,3.0 -2.1,2.4 -1.4,1.1 C-0.6,-0.2 -0.3,-1.2 -0.3,-2.8' +
      ' C-0.3,-3.7 -0.5,-4.2 -0.8,-4.6 C-1.5,-5.5 -2.7,-5.5 -3.4,-4.5' +
      ' C-3.8,-4.0 -3.9,-3.4 -3.9,-2.8' +
      ' M2.0,-5.3 V5.5',
    saturn:
      'M-2.9,-4.1 H0.6' +
      ' M-1.5,-5.5 V3.1' +
      ' M2.7,4.9 C2.4,5.2 2.0,5.5 1.7,5.5 C1.5,5.5 0.9,5.2 0.9,4.6' +
      ' C0.9,4.0 1.2,3.4 1.7,2.8 C2.4,2.2 2.9,1.0 2.9,-0.2' +
      ' C2.9,-1.4 2.4,-2.6 1.2,-2.6 C0.1,-2.6 -0.9,-1.9 -1.5,-0.7',
    uranus:
      'M0,-0.1 A2.8,2.8 0 1,0 0,5.5 A2.8,2.8 0 1,0 0,-0.1' +
      ' M0,1.7 A1.0,1.0 0 1,0 0,3.7 A1.0,1.0 0 1,0 0,1.7' +
      ' M0,-0.1 V-5.5' +
      ' M-2.8,-2.8 L0,-5.5 L2.8,-2.8',
    neptune:
      'M0,5.5 V-5.5' + ' M-2.2,2.4 H2.2' + ' M-2.8,-2.7 A2.8,2.8 0 0,0 2.8,-2.7' + ' M-2.8,-2.7 V-5.5 M2.8,-2.7 V-5.5',
  };

  const GLYPH_SCALE = 1.6;
  // Black casing stroke for body glyphs (sun/moon/planets). Matches the compass
  // ring's dark casing width in drawRings so every dark outline reads the same.
  const GLYPH_CASING_WIDTH = 4.4;

  // ---- Direction-Line / Interaction Tuning ----
  // Centre→body direction lines: a casing-less dotted ray that stops short of the
  // centre (DIR_CENTER_GAP) so the hub stays clean. Hovering brightens the ray
  // and extends it to the viewport edge; clicking the body locks a dotted
  // great-circle line on the map running to the body's ground point.
  const DIR_CENTER_GAP = 18; // px gap between compass centre and ray start — clears the locked star icon tips (12px) with 6px breathing room
  const DIR_DASH = '2.2 5'; // dotted ray pattern
  const DIR_WIDTH = 2.2; // resting ray width
  const DIR_OPACITY = 0.7; // resting ray opacity (matched up to the great-circle line so the two read as one family)
  const DIR_HOVER_WIDTH = 2.6; // brightened ray width on hover
  const DIR_HOVER_OPACITY = 0.95; // brightened ray opacity on hover
  const GC_SAMPLES = 96; // great-circle polyline sample count
  const DIR_DIM_FACTOR = 0.2; // opacity multiplier where a line passes under a label
  const DIR_DROP_FACTOR = 0.12; // opacity multiplier for "drop" zones (barbs / glyph icons)
  const DIR_BRIDGE_MAX = 10; // px; a short full stub wedged between two muted runs is faded too

  const AZ_EDGE_INSET = 64; // px in from the screen edge to the azimuth-angle tag on an extended ray
  const AZ_BAR_GAP = 16; // px gap the azimuth tag keeps above the bottom rail / © credit box
  const AZ_PERP_OFFSET = 14; // px the tag hangs perpendicular beside its line/tangent (compass tag + great-circle far-end tag share this)
  const GC_END_GAP = 6; // px the great-circle far-end label keeps inside an on-screen body terminal
  const GC_BODY_MARGIN = 10; // px clearance the far-end label slides past an on-screen body glow (along the line)
  const GC_BELOW_HORIZON_FACTOR = 0.5; // opacity multiplier for a locked great-circle line whose body sits below the observer's horizon (el<0, not visible)
  // Compass SVG text labels (rim labels + cardinals) to avoid in addition to the
  // cross-source labels label-collider knows. Excludes the fx-pane hover name so
  // a ray never dims under its own label.
  const COMPASS_TEXT_SEL =
    '.leaflet-observer-compass-cardinals-pane text, .leaflet-observer-compass-sun-pane text, ' +
    '.leaflet-observer-compass-moon-pane text, .leaflet-observer-compass-planet-pane text';

  // ---- Compass Configuration ----

  const HORIZON_RADIUS_PX_BASE = 40;
  const HORIZON_RADIUS_PX_MAX = 288;
  const HORIZON_ZOOM_BASE = 2;
  const HORIZON_ZOOM_MAX = 19;

  const TRACE_STEP_HR = 0.25; // 15-min steps for day traces (96 pts/day)
  const POLAR_LAT = 66.5;
  const MOON_GLYPH_R = 8; // phase-disc moon icon radius (px) — matches sun outer radius (5×1.6)

  function horizonRadiusPx(zoom) {
    if (zoom <= HORIZON_ZOOM_BASE) return HORIZON_RADIUS_PX_BASE;
    if (zoom >= HORIZON_ZOOM_MAX) return HORIZON_RADIUS_PX_MAX;
    const t = (zoom - HORIZON_ZOOM_BASE) / (HORIZON_ZOOM_MAX - HORIZON_ZOOM_BASE);
    return HORIZON_RADIUS_PX_BASE + (HORIZON_RADIUS_PX_MAX - HORIZON_RADIUS_PX_BASE) * t;
  }

  // ---- Marker (Observer Pin) + Lifecycle ----

  // Unlocked pin — plumb bob / water-drop. Anchor at the suspension eye (0,0).
  function _makeUnlockedIcon() {
    return L.divIcon({
      className: 'observer-pin-icon',
      html:
        '<svg viewBox="-8 -7 16 24" width="24" height="36">' +
        '<g class="observer-pin-plumb">' +
        '<path d="M 0,14 L -5.42,2.57 A 6 6 0 1 1 5.42,2.57 Z"' +
        ' fill="#0e1014" opacity="0.55" transform="translate(0.5,0.7)"/>' +
        '<path d="M 0,14 L -5.42,2.57 A 6 6 0 1 1 5.42,2.57 Z"' +
        ' fill="var(--const-line)" stroke="var(--dark-casing)"' +
        ' stroke-width="0.5" stroke-linejoin="miter"/>' +
        '<circle cx="0" cy="0" r="3.0" fill="var(--bg-deep)" stroke="#cce0df" stroke-width="0.55"/>' +
        '<circle cx="0" cy="0" r="1.6" fill="#cce0df"/>' +
        '</g>' +
        '</svg>',
      iconSize: [24, 36],
      // Anchor at the pin tip (SVG y=14 → pixel (14+7)/24×36 = 31.5px from top).
      iconAnchor: [12, 32],
    });
  }

  // Locked pin — filled 4-point star with cardinal ticks (spec §3.4). 35×35, center-anchored.
  // Astroid body spans ±10 SVG units = 20px at 1:1 scale.
  function _makeLockedIcon() {
    return L.divIcon({
      className: 'observer-pin-icon',
      html:
        '<svg viewBox="-17.5 -17.5 35 35" width="42" height="42">' +
        // Star body with a centre circle punched out as a real hole (evenodd):
        // the inner circle subpath subtracts from the fill so the map shows
        // through, instead of being covered by the star's own fill.
        '<path d="M 0,-10 L 2.4,-2.4 L 10,0 L 2.4,2.4 L 0,10 L -2.4,2.4 L -10,0 L -2.4,-2.4 Z' +
        ' M -2.1,0 A 2.1,2.1 0 1,0 2.1,0 A 2.1,2.1 0 1,0 -2.1,0 Z"' +
        ' fill="var(--compass-ring)" fill-rule="evenodd" stroke="none"/>' +
        '<path d="M 0,-6 L 0,-10 M 0,6 L 0,10 M -6,0 L -10,0 M 6,0 L 10,0"' +
        ' stroke="var(--compass-ring)" stroke-width="1.2" stroke-opacity="0.9" transform="rotate(45)"/>' +
        '</svg>',
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    });
  }

  function _updateMarkerIcon() {
    if (!_marker) return;
    _marker.setIcon(_locked ? _makeLockedIcon() : _makeUnlockedIcon());
  }

  // Move or create the observer marker and update the global latlng.
  function place(lat, lng) {
    // Snap to the world copy nearest the current view. The map spans -200°…+520°,
    // so callers may pass a raw lng (geolocation, place search, a permalink's obs=
    // normalized to [-180,180)) that sits a full wrap away from the on-screen copy —
    // placing the marker there would render it (and the whole compass) off-screen.
    // A map click already arrives in the view's copy, so this is a no-op there.
    if (_map) {
      const viewLng = _map.getCenter().lng;
      lng += 360 * Math.round((viewLng - lng) / 360);
    }

    // Relocating the observer invalidates every locked great-circle line and
    // pinned azimuth line (both anchored to the old point) — clear them. A double-
    // click both relocates and locks, so this is also the "release" channel.
    _clearLockedLines();
    _pinnedBodyIds.clear();
    if (_marker) {
      _marker.setLatLng([lat, lng]);
    } else {
      // bubblingMouseEvents:false stops the click from also firing the map's
      // click handler (which would pick a slightly offset latlng from the
      // icon hit area and effectively "jump" the observer to a new point).
      _marker = L.marker([lat, lng], {
        icon: _makeUnlockedIcon(),
        bubblingMouseEvents: false,
        // Center pin sits at the BOTTOM of the compass stack (observer-pin z=943)
        // so direction lines / glyphs can layer over it. Pane name omits
        // "compass" so it isn't blanked by the zoom-anim visibility rule.
        pane: 'observer-pin',
      }).addTo(_map);

      // Clicking the pin (when unlocked) re-centers the compass on it.
      _marker.on('click', function (ev) {
        if (ev.originalEvent) {
          ev.originalEvent.stopPropagation();
          ev.originalEvent.preventDefault();
        }
        L.DomEvent.stopPropagation(ev);
        if (!_locked) {
          const ll = _marker.getLatLng();
          place(ll.lat, ll.lng);
        }
      });
    }

    window.currentObserverLatLng = { lat, lng };
    if (typeof TimeState !== 'undefined') TimeState.setTime(TimeState.current);
    if (typeof Sidebar !== 'undefined' && Sidebar.updateHandleVisibility) Sidebar.updateHandleVisibility();

    // Allow map.js to react (e.g. dismiss any active altitude-contour layer).
    if (typeof _onPlace === 'function') _onPlace(lat, lng);
  }

  // Remove the marker and reset all state.
  function clear() {
    if (_marker) {
      _map.removeLayer(_marker);
      _marker = null;
    }
    _locked = false;
    window.currentObserverLatLng = null;
    if (typeof TimeState !== 'undefined') TimeState.setTime(TimeState.current);
    _compassClear();
    if (typeof AppState !== 'undefined') AppState.touch();
    if (typeof Sidebar !== 'undefined' && Sidebar.updateHandleVisibility) Sidebar.updateHandleVisibility();
  }

  function lock() {
    _locked = true;
    _updateMarkerIcon();
    if (typeof Sidebar !== 'undefined' && Sidebar.updateHandleVisibility) Sidebar.updateHandleVisibility();
  }

  function unlock() {
    _locked = false;
    _updateMarkerIcon();
    if (typeof Sidebar !== 'undefined' && Sidebar.updateHandleVisibility) Sidebar.updateHandleVisibility();
  }

  function isLocked() {
    return _locked;
  }

  // Lock the observer at its current point and reveal the azimuth compass — the
  // same end-state as a double-click. Exposed so sidebar jumps (locate button,
  // place-name / coords click) can open the compass programmatically.
  function lockAndShowCompass() {
    _locked = true;
    _updateMarkerIcon();
    _compassShow();
    if (typeof AppState !== 'undefined') AppState.touch();
  }

  // Toggle the observer lock, opening or hiding the compass to match. Shared by
  // the right-click menu and the compass-centre hit-target so a single click on
  // the hub releases (or re-locks) the marker — the primary observer interaction.
  function _toggleLock() {
    _locked = !_locked;
    _updateMarkerIcon();
    if (_locked) _compassShow();
    else _compassHide();
    if (typeof AppState !== 'undefined') AppState.touch();
  }

  // Lock/unlock, remove, and (when any exist) clear-direction-line items for the
  // observer marker's context menu. Shared by the map-level right-click near the
  // pin and the compass-centre hit-target so both raise an identical menu.
  function _markerMenuItems() {
    const items = [
      {
        label: _locked ? _t('map.context.unlock_marker') : _t('map.context.lock_marker'),
        onClick: _toggleLock,
      },
      { label: _t('map.context.remove_marker'), onClick: clear },
    ];
    if (Object.keys(_lockedBodies).length || _pinnedBodyIds.size) {
      items.push({
        label: _t('map.context.clear_direction_lines'),
        onClick: () => {
          _clearLockedLines();
          _pinnedBodyIds.clear();
          _renderPins();
        },
      });
    }
    return items;
  }

  // Wire map events and initialise the compass.
  function init(map, opts) {
    if (_map) return;
    _map = map;
    _onPlace = (opts && opts.onPlace) || null;

    // Create the compass panes here so observer.js owns the full lifecycle.
    // Stack (bottom→top): observer-pin(943) + compass ring(944) at the bottom;
    // all lines (traces + rays) in observer-compass-lines(945), strictly below
    // the glyph/label tiers; cardinals(946) above lines; glyph tiers planet(947)
    // < moon(948) < sun(949); fx pane(950) on top (hover name + hit-targets).
    // Every SVG pane is pointer-transparent; hit-targets re-enable events.
    [
      ['observer-compass', 944],
      ['observer-compass-lines', 945],
      ['observer-compass-cardinals', 946],
      ['observer-compass-planet', 947],
      ['observer-compass-moon', 948],
      ['observer-compass-sun', 949],
      ['observer-compass-fx', 950],
    ].forEach(([name, z]) => {
      if (!map.getPane(name)) {
        map.createPane(name);
        map.getPane(name).style.zIndex = String(z);
        map.getPane(name).style.pointerEvents = 'none';
      }
    });

    // Center pin pane — bottom of the compass stack. Name omits "compass" so the
    // `.leaflet-zoom-anim [class*="leaflet-observer-compass"]` hide rule doesn't
    // blank the marker mid-zoom (Leaflet animates the marker smoothly instead).
    // Keeps default pointer events so the pin stays clickable for re-centering.
    if (!map.getPane('observer-pin')) {
      map.createPane('observer-pin');
      map.getPane('observer-pin').style.zIndex = '943';
    }

    // Locked great-circle lines live on a map pane in the reference-line band
    // (z=627: above the twilight mask at 612, meteor labels at 626 and coord
    // grids, below eclipse curves at 629) so they read over the daylight veil
    // like the ecliptic.
    if (!map.getPane('observer-greatcircle')) {
      map.createPane('observer-greatcircle');
      map.getPane('observer-greatcircle').style.zIndex = '627';
      map.getPane('observer-greatcircle').style.pointerEvents = 'none';
    }
    _lockedGroup = L.layerGroup().addTo(map);

    // Single click — place observer (unless locked); Sidebar / Places / LP
    // are handled in map.js which subscribes to the same event.
    // When _skyClickConsumed is set, skip placement AND signal map.js to skip
    // its sidebar update too, via window._observerSkipped.
    map.on('click', (e) => {
      if (_locked) return;
      Promise.resolve().then(() => {
        if (window._skyClickConsumed) {
          window._skyClickConsumed = false;
          window._observerSkipped = true;
          setTimeout(() => {
            window._observerSkipped = false;
          }, 400);
          _skipNextDblClick = true;
          setTimeout(() => {
            _skipNextDblClick = false;
          }, 400);
          return;
        }
        window._observerSkipped = false;
        place(e.latlng.lat, e.latlng.lng);
      });
    });

    // Double click — lock and show compass.
    map.on('dblclick', (e) => {
      if (_skipNextDblClick) {
        _skipNextDblClick = false;
        return;
      }
      place(e.latlng.lat, e.latlng.lng);
      _locked = true;
      _updateMarkerIcon();
      _compassShow();
    });

    // Right-click near the marker — lock/unlock/remove context menu.
    map.on('contextmenu', (e) => {
      if (!_marker) return;
      const markerPx = map.latLngToContainerPoint(_marker.getLatLng());
      const clickPx = map.latLngToContainerPoint(e.latlng);
      if (Math.hypot(markerPx.x - clickPx.x, markerPx.y - clickPx.y) > 40) return;
      L.DomEvent.preventDefault(e.originalEvent);
      if (typeof window.showCtxMenu === 'function') window.showCtxMenu(clickPx, _markerMenuItems());
    });

    // Backwards-compatible global (used by external callers, e.g. the preview
    // console, place search and deep-link / URL state restoration).
    window.enterLocationMode = place;

    // Initialise the compass after the map and pane are ready.
    _compassInit(map);

    // Register the compass permalink param here, not at module load: observer.js
    // is loaded before state.js, so AppState is undefined at module-eval time and a
    // top-level registration would silently no-op (leaving c=1 links unable to
    // restore the compass). init() runs during initMap, after state.js has defined
    // AppState and before applyFromURL, so the param is live when the URL is read.
    if (typeof AppState !== 'undefined') {
      AppState.registerParam('c', {
        get: () => (isLocked() ? '1' : null),
        set: (v) => {
          if (v === '1') lockAndShowCompass();
        },
      });
    }
  }

  // ---- Compass Renderer ----

  // ---- Helpers ----

  function fmtTime(d) {
    if (!d || isNaN(d.getTime())) return '—';
    return TimeState.formatTime(d, false);
  }

  function isLayerOn(layerId) {
    const btn = document.querySelector('.layer-btn[data-layer="' + layerId + '"]');
    return btn && btn.getAttribute('aria-pressed') === 'true';
  }

  // Azimuthal equidistant projection (spec §3.5).
  // Returns {x, y} relative to compass center (0,0).
  function projectAltAz(azDeg, altDeg) {
    const r = (1 - Math.max(0, Math.min(90, altDeg)) / 90) * _R;
    const az = (azDeg * Math.PI) / 180;
    return { x: Math.sin(az) * r, y: -Math.cos(az) * r };
  }

  // Smallest absolute angular separation between two azimuths, in degrees.
  function azSeparation(a, b) {
    let d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    return d;
  }

  // ---- SVG DOM Helpers ----

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
    return el;
  }

  function pointsToD(pts) {
    if (!pts.length) return '';
    return 'M' + pts.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join('L');
  }

  // ---- Trace Gradient Helpers (Sun/Moon Rise→Set Colour Ramp) ----
  function _clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }

  function _hexToRgb(h) {
    h = (h || '').trim().replace('#', '');
    if (h.length === 3)
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
  }

  function _resolveVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // sRGB mix — matches an SVG linearGradient's default interpolation.
  function _mixColor(hexA, hexB, t) {
    const a = _hexToRgb(hexA),
      b = _hexToRgb(hexB);
    t = _clamp01(t);
    const m = (i) => Math.round(a[i] + (b[i] - a[i]) * t);
    return 'rgb(' + m(0) + ',' + m(1) + ',' + m(2) + ')';
  }

  // Fraction of `pt` along the rise→set chord (0 at rise rim, 1 at set rim).
  function _chordFrac(grad, pt) {
    const vx = grad.setRim.x - grad.riseRim.x,
      vy = grad.setRim.y - grad.riseRim.y;
    const len2 = vx * vx + vy * vy;
    if (!len2) return 0;
    return _clamp01(((pt.x - grad.riseRim.x) * vx + (pt.y - grad.riseRim.y) * vy) / len2);
  }

  function _gradColorAt(grad, pt) {
    return _mixColor(grad.cRise, grad.cSet, _chordFrac(grad, pt));
  }

  // Append a userSpaceOnUse rise→set linear gradient to `g`; return its url(#id).
  // Endpoints come from the trace's own rim points (segs[0][0] → last seg's last point).
  function addTraceGradient(g, id, segs, cRise, cSet) {
    if (!segs.length) return null;
    const riseRim = segs[0][0];
    const lastSeg = segs[segs.length - 1];
    const setRim = lastSeg[lastSeg.length - 1];
    const lg = svgEl('linearGradient', {
      id: id,
      gradientUnits: 'userSpaceOnUse',
      x1: riseRim.x.toFixed(1),
      y1: riseRim.y.toFixed(1),
      x2: setRim.x.toFixed(1),
      y2: setRim.y.toFixed(1),
    });
    lg.appendChild(svgEl('stop', { offset: '0', 'stop-color': cRise }));
    lg.appendChild(svgEl('stop', { offset: '1', 'stop-color': cSet }));
    g.appendChild(lg);
    return { url: 'url(#' + id + ')', riseRim, setRim, cRise, cSet };
  }

  // ---- Astronomy Engine Wrappers ----

  function aeObserver(obs) {
    return new Astronomy.Observer(obs.lat, obs.lng, 0);
  }

  function bodyAzAlt(body, date, aeObs) {
    const equ = Astronomy.Equator(body, date, aeObs, true, true);
    const hor = Astronomy.Horizon(date, aeObs, equ.ra, equ.dec, 'normal');
    return { az: hor.azimuth, alt: hor.altitude };
  }

  // Like bodyAzAlt but also returns the apparent RA (deg) / Dec, used to find the
  // body's ground point for the locked great-circle line.
  function bodyRaDecAzAlt(body, date, aeObs) {
    const equ = Astronomy.Equator(body, date, aeObs, true, true);
    const hor = Astronomy.Horizon(date, aeObs, equ.ra, equ.dec, 'normal');
    return { raDeg: equ.ra * 15, dec: equ.dec, az: hor.azimuth, alt: hor.altitude };
  }

  // Localized display name for a body id via the shared `planet.*` namespace
  // (covers the sun, moon and every planet). Falls back to Planets.CONFIGS, then
  // the id, when a translation is missing.
  function bodyName(id) {
    const key = 'planet.' + id;
    const tr = _t(key);
    if (tr && tr !== key) return tr;
    if (typeof Planets !== 'undefined' && Planets.CONFIGS) {
      const c = Planets.CONFIGS.find((c) => c.id === id);
      if (c && c.name) return c.name;
    }
    return id;
  }

  function searchRiseSet(body, aeObs, direction, startDate, limitDays) {
    try {
      const r = Astronomy.SearchRiseSet(body, aeObs, direction, startDate, limitDays);
      return r ? r : null;
    } catch (_) {
      return null;
    }
  }

  // ---- Sampling ----

  function observerMidnightMs(obs, date) {
    const lngOffsetMs = (obs.lng / 15) * 3600000;
    const localMs = date.getTime() + lngOffsetMs;
    return Math.floor(localMs / 86400000) * 86400000 - lngOffsetMs;
  }

  // Sample a body's (az, alt) at TRACE_STEP_HR intervals across [00:00, 24:00]
  // local day. Returns [{az, alt, time}, ...].
  function sampleBodyPath(body, obs, date) {
    const aeObs = aeObserver(obs);
    const dayStartMs = observerMidnightMs(obs, date);
    const out = [];
    const stepMs = TRACE_STEP_HR * 3600000;
    for (let ms = 0; ms <= 24 * 3600000; ms += stepMs) {
      const t = new Date(dayStartMs + ms);
      const p = bodyAzAlt(body, t, aeObs);
      out.push({ az: p.az, alt: p.alt, time: t });
    }
    return out;
  }

  // Sample a body's (az, alt) over an arbitrary [startMs, endMs] window at
  // TRACE_STEP_HR intervals (plus an exact endpoint at endMs). Used for the
  // moon's continuous above-horizon arc, which may cross local midnight.
  function sampleBodyRange(body, obs, startMs, endMs) {
    const aeObs = aeObserver(obs);
    const stepMs = TRACE_STEP_HR * 3600000;
    const out = [];
    let ms = startMs;
    for (; ms <= endMs; ms += stepMs) {
      const t = new Date(ms);
      const p = bodyAzAlt(body, t, aeObs);
      out.push({ az: p.az, alt: p.alt, time: t });
    }
    // Ensure the exact end instant is represented (rise/set endpoint).
    if (!out.length || out[out.length - 1].time.getTime() < endMs) {
      const t = new Date(endMs);
      const p = bodyAzAlt(body, t, aeObs);
      out.push({ az: p.az, alt: p.alt, time: t });
    }
    return out;
  }

  // Continuous moon arc to display (plan A1): the above-horizon arc the moon is
  // currently in, or — if the moon is down — the next one after it rises. Avoids
  // the calendar-day split that breaks a moon arc spanning local midnight.
  // Returns { mRise, mSet, segs } where mRise/mSet are SearchRiseSet results
  // (or null) and segs is drawTrace-ready point arrays.
  function computeMoonArc(obs, date, aeObs) {
    const Moon = Astronomy.Body.Moon;

    // Determine up/down via event ordering rather than geometric centre altitude.
    // SearchRiseSet uses apparent upper-limb at −0.833°, so a centre-alt check
    // would disagree during the ~5 min window when the limb has risen but the
    // centre is still below zero, causing the arc to jump to the next day.
    const lastRise = searchRiseSet(Moon, aeObs, +1, date, -2);
    const lastSet = searchRiseSet(Moon, aeObs, -1, date, -2);
    const up = !!lastRise && (!lastSet || lastRise.date > lastSet.date);

    let mRise, mSet;
    if (up) {
      // Up now: last rise already found above; search forward for the next set.
      mRise = lastRise;
      mSet = searchRiseSet(Moon, aeObs, -1, date, 2);
    } else {
      // Down now: show the next arc — next rise, then its following set.
      mRise = searchRiseSet(Moon, aeObs, +1, date, 2);
      mSet = mRise ? searchRiseSet(Moon, aeObs, -1, mRise.date, 2) : null;
    }
    // Arc window: use event instants when available; otherwise fall back to a
    // ±12h window around now so circumpolar / never-rising cases degrade to
    // whatever portion is above the horizon (aboveHorizonSegments clips it).
    const anchor = up || !mRise ? date : mRise.date;
    const startMs = mRise ? mRise.date.getTime() : anchor.getTime() - 12 * 3600000;
    const endMs = mSet ? mSet.date.getTime() : anchor.getTime() + 12 * 3600000;
    const samples = sampleBodyRange(Moon, obs, startMs, endMs);
    return { mRise, mSet, segs: aboveHorizonSegments(samples) };
  }

  // Split samples into contiguous above-horizon segments, each with endpoint
  // forcing (prepend/append alt=0 rim point at the rise/set azimuth).
  function aboveHorizonSegments(samples) {
    const segs = [];
    let cur = [];
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].alt > 0) {
        cur.push(samples[i]);
      } else if (cur.length) {
        segs.push(cur);
        cur = [];
      }
    }
    if (cur.length) segs.push(cur);

    return segs.map((seg) => {
      const pts = [];
      // Rim start: interpolate to alt=0 before first above-horizon sample
      const first = seg[0];
      const idx0 = samples.indexOf(first);
      if (idx0 > 0) {
        const prev = samples[idx0 - 1];
        const frac = -prev.alt / (first.alt - prev.alt);
        const rimAz = prev.az + frac * (((first.az - prev.az + 540) % 360) - 180);
        pts.push({ x: projectAltAz(rimAz, 0).x, y: projectAltAz(rimAz, 0).y });
      } else {
        pts.push(projectAltAz(first.az, 0));
      }
      // Above-horizon points
      seg.forEach((s) => pts.push(projectAltAz(s.az, s.alt)));
      // Rim end: interpolate to alt=0 after last above-horizon sample
      const last = seg[seg.length - 1];
      const idxN = samples.indexOf(last);
      if (idxN < samples.length - 1) {
        const next = samples[idxN + 1];
        const frac = last.alt / (last.alt - next.alt);
        const rimAz = last.az + frac * (((next.az - last.az + 540) % 360) - 180);
        pts.push({ x: projectAltAz(rimAz, 0).x, y: projectAltAz(rimAz, 0).y });
      } else {
        pts.push(projectAltAz(last.az, 0));
      }
      return pts;
    });
  }

  // ---- Drawing Functions ----

  function drawRings(g, R) {
    // Outer dark casing
    g.appendChild(
      svgEl('circle', {
        r: R,
        fill: 'none',
        stroke: 'var(--dark-casing)',
        'stroke-width': 4.4,
        'stroke-opacity': 0.55,
      })
    );
    // Outer main
    g.appendChild(
      svgEl('circle', {
        r: R,
        fill: 'none',
        stroke: 'var(--compass-ring)',
        'stroke-width': 2.0,
        'stroke-opacity': 0.85,
      })
    );
  }

  function drawTicks(g, R) {
    for (let az = 0; az < 360; az += 5) {
      let r1, r2, sw, so, color;
      if (az % 30 === 0) {
        r1 = R;
        r2 = R - 18;
        sw = 1.7;
        so = 0.95;
        color = 'var(--fg-primary)';
      } else if (az % 15 === 0) {
        r1 = R;
        r2 = R - 13;
        sw = 1.2;
        so = 0.75;
        color = 'var(--compass-ring)';
      } else {
        r1 = R;
        r2 = R - 9;
        sw = 0.9;
        so = 0.45;
        color = 'var(--fg-muted)';
      }
      const rad = (az * Math.PI) / 180;
      const sin = Math.sin(rad),
        cos = Math.cos(rad);
      g.appendChild(
        svgEl('line', {
          x1: (sin * r1).toFixed(1),
          y1: (-cos * r1).toFixed(1),
          x2: (sin * r2).toFixed(1),
          y2: (-cos * r2).toFixed(1),
          stroke: color,
          'stroke-width': sw,
          'stroke-opacity': so,
        })
      );
    }
  }

  function drawCardinals(g, R, rimAzimuths) {
    // GAP: px from ring edge to nearest character edge, equal for all four.
    // CAP: approximate cap-height for 13px serif (used to offset S downward).
    const GAP = 8,
      CAP = 10;
    const dirs = [
      {
        az: 0,
        key: 'n',
        label: _t('rays.cardinal.n'),
        fill: 'var(--compass-cardinal-n)',
        dx: 0,
        dy: -(R + GAP),
        anchor: 'middle',
      }, // bottom of N = GAP above ring
      {
        az: 90,
        key: 'e',
        label: _t('rays.cardinal.e'),
        fill: 'var(--compass-cardinal)',
        dx: R + GAP,
        dy: CAP / 2,
        anchor: 'start',
      }, // left of E = GAP from ring
      {
        az: 180,
        key: 's',
        label: _t('rays.cardinal.s'),
        fill: 'var(--compass-cardinal)',
        dx: 0,
        dy: R + GAP + CAP,
        anchor: 'middle',
      }, // top of S = GAP below ring
      {
        az: 270,
        key: 'w',
        label: _t('rays.cardinal.w'),
        fill: 'var(--compass-cardinal)',
        dx: -(R + GAP),
        dy: CAP / 2,
        anchor: 'end',
      }, // right of W = GAP from ring
    ];
    return dirs.map((d) => {
      const txt = svgEl('text', {
        x: d.dx,
        y: d.dy,
        fill: d.fill,
        'fill-opacity': 1.0,
        'text-anchor': d.anchor,
        'font-family': 'var(--font-serif)',
        'font-size': '14px',
        'letter-spacing': '0.22em',
      });
      txt.textContent = d.label;
      g.appendChild(txt);
      return { az: d.az, key: d.key, label: d.label, fill: d.fill, el: txt };
    });
  }

  function drawTrace(g, segments, cssColor, width, casingWidth, dashArray) {
    segments.forEach((pts) => {
      const d = pointsToD(pts);
      if (!d) return;
      // Casing
      g.appendChild(
        svgEl('path', {
          d: d,
          fill: 'none',
          stroke: 'var(--dark-casing)',
          'stroke-width': casingWidth,
          'stroke-opacity': 0.55,
          'stroke-linecap': 'round',
        })
      );
      // Main
      const attrs = {
        d: d,
        fill: 'none',
        stroke: cssColor,
        'stroke-width': width,
        'stroke-linecap': 'round',
      };
      if (dashArray) attrs['stroke-dasharray'] = dashArray;
      g.appendChild(svgEl('path', attrs));
    });
  }

  // Whether `now` lies inside a rise→set arc. Returns null when either endpoint
  // is missing (polar day/night, circumpolar) so the caller falls back to a plain
  // altitude test. Handles a set instant that precedes rise (arc wraps midnight).
  function inRiseSetWindow(now, riseDate, setDate) {
    if (!riseDate || !setDate) return null;
    const t = now.getTime(),
      r = riseDate.getTime(),
      s = setDate.getTime();
    return r <= s ? t >= r && t <= s : t >= r || t <= s;
  }

  // Unit vector + centre-gap start point for a ray toward `pt`.
  function _rayGeom(pt) {
    const len = Math.hypot(pt.x, pt.y) || 1;
    const ux = pt.x / len,
      uy = pt.y / len;
    return { ux, uy, len, sx: ux * DIR_CENTER_GAP, sy: uy * DIR_CENTER_GAP };
  }

  // forceShow: true/false gates the glyph on the body's labelled rise/set arc so
  // it appears at the SAME instant the rim rise/set fires (and the day-veil /
  // visibility boundaries sweep the centre); null → fall back to alt>0.
  // Draws the dotted direction ray into `gRay` (lines pane) and the body glyph
  // into `gGlyph` (its tier pane), so the ray sits below every glyph/label while
  // the glyph stays in its sun/moon tier.
  function drawDirectionLine(
    gRay,
    gGlyph,
    body,
    date,
    aeObs,
    cssColor,
    cssOpacity,
    glyphId,
    forceShow,
    grad,
    barbQuads
  ) {
    const p = bodyRaDecAzAlt(body, date, aeObs);
    const show = forceShow == null ? p.alt > 0 : forceShow;
    if (!show) return;
    const pt = projectAltAz(p.az, p.alt);
    // When a trace gradient is supplied, the line + glyph take the gradient colour
    // sampled at the body's current position along its rise→set arc.
    const tint = grad ? _gradColorAt(grad, pt) : cssColor;
    // Casing-less dotted ray that stops short of the centre (req 1+2), dimmed
    // where it passes under a label.
    const ray = _rayGeom(pt);
    // Dim under labels (tight ink, pad 0 — so a ray grazing just outside a glyph
    // isn't falsely faded); drop where it runs under a rim barb or a body icon.
    _drawDimmedRay(
      gRay,
      ray.sx,
      ray.sy,
      pt.x,
      pt.y,
      {
        stroke: tint,
        'stroke-width': DIR_WIDTH,
        'stroke-opacity': DIR_OPACITY,
        'stroke-dasharray': DIR_DASH,
        'stroke-linecap': 'round',
      },
      _labelQuads(2, 0),
      barbQuads.concat(_glyphQuads())
    );
    // Record this body so the hover emphasis and click-to-lock can find it.
    _bodyPositions[glyphId] = {
      x: pt.x,
      y: pt.y,
      az: p.az,
      alt: p.alt,
      raDeg: p.raDeg,
      dec: p.dec,
      tint: tint,
      name: bodyName(glyphId),
      glyphId: glyphId,
      body: body,
    };
    if (glyphId === 'moon') {
      // Phase-aware disc, lit limb pointing toward the sun's position on the disc.
      const sunP = bodyAzAlt(Astronomy.Body.Sun, date, aeObs);
      const sunPt = projectAltAz(sunP.az, Math.max(0, sunP.alt));
      drawMoonPhaseGlyph(gGlyph, pt.x, pt.y, MOON_GLYPH_R, date, sunPt, tint);
      return;
    }
    const pathD = glyphId && PLANET_PATHS[glyphId];
    if (pathD) {
      // Sun: pin casing opacity to 0.55 (matches the moon disc), then cap the
      // rim with a bright edge ring mirroring the moon's disc outline so the dark
      // casing reads the same visible width at the edge.
      const isSun = glyphId === 'sun';
      drawPlanetGlyph(gGlyph, pathD, pt.x, pt.y, tint, 0.95, null, true, isSun ? 0.55 : null);
      if (isSun) {
        gGlyph.appendChild(
          svgEl('circle', {
            cx: pt.x.toFixed(1),
            cy: pt.y.toFixed(1),
            r: (5 * GLYPH_SCALE).toFixed(2), // sun disc radius = 8 = MOON_GLYPH_R
            fill: 'none',
            stroke: tint,
            'stroke-width': 0.8,
            'stroke-opacity': 1.0,
          })
        );
      }
    } else {
      gGlyph.appendChild(
        svgEl('circle', {
          cx: pt.x.toFixed(1),
          cy: pt.y.toFixed(1),
          r: 4.8,
          fill: tint,
          'fill-opacity': 0.95,
        })
      );
    }
  }

  // Phase-aware moon disc (plan B1): a bone-white "disc with a hole" — dark
  // floor + lit lens whose width follows the illuminated fraction and whose
  // bright limb points toward `sunPt` (the sun's position on the compass disc).
  // Reuses the phase geometry from js/planets.js buildPhasedDiskSVG. Near new
  // moon the lit lens vanishes, so a faint ring + halo keep the moon's position
  // legible.
  function drawMoonPhaseGlyph(parent, x, y, r, date, sunPt, tint) {
    const moonCol = tint || 'var(--moon-trace)';
    const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
    const i = (illum.phase_angle * Math.PI) / 180; // 0 = full, π = new
    const frac = illum.phase_fraction; // illuminated fraction 0..1
    const b = r * Math.cos(i),
      absB = Math.abs(b);
    const sweep = b >= 0 ? 1 : 0; // gibbous: arc through left → lit>50%; crescent: right → lit<50%
    const dx = sunPt.x - x,
      dy = sunPt.y - y;
    const limbDeg = dx === 0 && dy === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI;
    const litPath =
      'M0,' +
      (-r).toFixed(2) +
      ' A' +
      r.toFixed(2) +
      ',' +
      r.toFixed(2) +
      ' 0 0 1 0,' +
      r.toFixed(2) +
      ' A' +
      absB.toFixed(2) +
      ',' +
      r.toFixed(2) +
      ' 0 0 ' +
      sweep +
      ' 0,' +
      (-r).toFixed(2) +
      ' Z';

    const g = svgEl('g', { transform: 'translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ')' });
    // Faint halo — keeps the disc from vanishing into the dark casing.
    g.appendChild(
      svgEl('circle', {
        r: (r + 0.6).toFixed(2),
        fill: moonCol,
        'fill-opacity': 0.06,
      })
    );
    // Dark floor (the "hole" / night side).
    g.appendChild(
      svgEl('circle', {
        r: r.toFixed(2),
        fill: 'var(--dark-casing)',
        'fill-opacity': 0.5,
      })
    );
    // Dark casing ring — matches sun glyph approach: a wide --dark-casing stroke
    // drawn below the lit lens so only the outer edge remains visible.
    g.appendChild(
      svgEl('circle', {
        r: r.toFixed(2),
        fill: 'none',
        stroke: 'var(--dark-casing)',
        'stroke-width': GLYPH_CASING_WIDTH,
        'stroke-opacity': 0.55,
      })
    );
    // Disc outline — ramps up as the moon approaches new so position stays legible.
    g.appendChild(
      svgEl('circle', {
        r: r.toFixed(2),
        fill: 'none',
        stroke: moonCol,
        'stroke-width': 0.8,
        'stroke-opacity': 1.0,
      })
    );
    // Lit lens.
    g.appendChild(
      svgEl('path', {
        d: litPath,
        transform: 'rotate(' + limbDeg.toFixed(1) + ')',
        fill: moonCol,
        'fill-opacity': 0.95,
      })
    );
    parent.appendChild(g);
  }

  function drawPlanetGlyph(parent, pathD, x, y, color, opacity, scale, filled, casingOpacity) {
    const s = scale || GLYPH_SCALE;
    // Casing opacity defaults to scaling with the glyph (so dim planets get a dim
    // casing); callers can pin it (the sun passes 0.55 to match the moon's disc).
    const co = (casingOpacity != null ? casingOpacity : 0.55 * opacity).toFixed(2);
    const tx = 'translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') scale(' + s + ')';
    if (filled) {
      parent.appendChild(
        svgEl('path', {
          d: pathD,
          fill: 'var(--dark-casing)',
          'fill-opacity': co,
          stroke: 'var(--dark-casing)',
          'stroke-width': (GLYPH_CASING_WIDTH / s).toFixed(2),
          'stroke-opacity': co,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          transform: tx,
        })
      );
      parent.appendChild(
        svgEl('path', {
          d: pathD,
          fill: color,
          'fill-opacity': opacity,
          stroke: 'none',
          transform: tx,
        })
      );
    } else {
      parent.appendChild(
        svgEl('path', {
          d: pathD,
          fill: 'none',
          stroke: 'var(--dark-casing)',
          'stroke-width': (GLYPH_CASING_WIDTH / s).toFixed(2),
          'stroke-opacity': (0.55 * opacity).toFixed(2),
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          transform: tx,
        })
      );
      parent.appendChild(
        svgEl('path', {
          d: pathD,
          fill: 'none',
          stroke: color,
          'stroke-width': (1.5 / s).toFixed(2),
          'stroke-opacity': opacity,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          transform: tx,
        })
      );
    }
  }

  function drawPlanetSymbols(g, R, date, aeObs) {
    if (typeof Planets === 'undefined' || !Planets.CONFIGS) return;
    if (!isLayerOn('planets')) return;
    // Hide compass planet glyphs when zoomed out (≤6) — at that scale the disc is
    // small and the planet symbols crowd the rim. Sun/moon stay.
    if (_map && _map.getZoom() <= 6) return;
    Planets.CONFIGS.forEach((cfg) => {
      if (cfg.id === 'moon' || cfg.id === 'sun') return;
      const pathD = PLANET_PATHS[cfg.id];
      if (!pathD) return;
      const p = bodyRaDecAzAlt(cfg.body, date, aeObs);
      if (p.alt <= 0) return;
      const pt = projectAltAz(p.az, p.alt);
      _bodyPositions[cfg.id] = {
        x: pt.x,
        y: pt.y,
        az: p.az,
        alt: p.alt,
        raDeg: p.raDeg,
        dec: p.dec,
        tint: 'var(--compass-planet)',
        name: cfg.name,
        glyphId: cfg.id,
        body: cfg.body,
      };
      // Wrap in a <g> so _refreshPlanetGlyphs() can toggle opacity via the group
      // attribute instead of a full redraw — this makes hover instant.
      const active = _hoveredBodyId === cfg.id || _pinnedBodyIds.has(cfg.id);
      const wrap = svgEl('g', { 'data-glyph-id': cfg.id });
      wrap.setAttribute('opacity', active ? '1' : '0.45');
      g.appendChild(wrap);
      // Draw paths at base ratios (casing 0.55, stroke 1.0); group opacity handles dim.
      drawPlanetGlyph(wrap, pathD, pt.x, pt.y, 'var(--compass-planet)', 1.0, undefined, undefined, 0.55);
    });
  }

  // Distance (compass-local px) from the centre to the viewport edge along the
  // unit direction (ux, uy) — used to extend a hovered ray off the disc to the
  // screen edge. Optional topInset / botInset pull the effective top / bottom
  // edge inward (treating the opaque top control strip and bottom time rail as
  // edges) so the azimuth tag isn't hidden under them; the ray itself still uses
  // the true viewport (insets default 0).
  function _edgeDistance(ux, uy, topInset, botInset) {
    const obs = window.currentObserverLatLng;
    if (!_map || !obs) return _R * 3;
    const c = _map.latLngToContainerPoint(L.latLng(obs.lat, obs.lng));
    const size = _map.getSize();
    const top = topInset || 0,
      bot = botInset || 0;
    let t = Infinity;
    if (ux > 1e-6) t = Math.min(t, (size.x - c.x) / ux);
    else if (ux < -1e-6) t = Math.min(t, (0 - c.x) / ux);
    if (uy > 1e-6) t = Math.min(t, (size.y - bot - c.y) / uy);
    else if (uy < -1e-6) t = Math.min(t, (top - c.y) / uy);
    if (!isFinite(t) || t < _R) t = _R * 3;
    return t;
  }

  // Bottom screen furniture (full-width time rail + bottom-right © credit box) as
  // padded client-px quads, so the azimuth tag treats them as obstacles and keeps a
  // comfortable gap above. AZ_BAR_GAP px is padded onto the TOP edge (the side the
  // tag approaches from). Same client-px space as _textQuad / _labelQuads
  // (getBoundingClientRect → viewport px). Missing / unmeasured elements skipped.
  function _bottomFurnitureQuads() {
    const quads = [];
    const add = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      quads.push([
        { x: r.left - 4, y: r.top - AZ_BAR_GAP },
        { x: r.right + 4, y: r.top - AZ_BAR_GAP },
        { x: r.right + 4, y: r.bottom + 4 },
        { x: r.left - 4, y: r.bottom + 4 },
      ]);
    };
    add('#time-bar');
    add('.map-attribution');
    return quads;
  }

  // Heights (container px) of the opaque top control strip and bottom time rail,
  // so the azimuth tag can treat them as screen edges (req: don't hide the tag
  // under them). Missing element → that inset is 0 (fall back to the true edge).
  function _barInsets() {
    let top = 0,
      bot = 0;
    if (!_map) return { top, bot };
    const box = _map.getContainer().getBoundingClientRect();
    const rail = document.querySelector('#time-bar');
    if (rail) bot = Math.max(0, box.bottom - rail.getBoundingClientRect().top);
    const ctrl = document.querySelector('.layer-toggle-control');
    if (ctrl) top = Math.max(0, ctrl.getBoundingClientRect().bottom - box.top);
    return { top, bot };
  }

  // ---- Label-Collision Dimming for Compass/Great-Circle Lines ----
  // Lines passing under a rendered text label are drawn dimmed there so they
  // don't fight the text. Basemap place-names are raster (undetectable); only
  // our own labels (collider sources + compass rim text) are avoided.

  // Current visible label keep-out polygons in client/viewport pixels — MUST be
  // the same space as the ray's samples (_localToViewport, client px), so quads
  // use getScreenCTM, NOT getCTM. Rotated rim text uses its TRUE oriented quad
  // (getBBox corners through getScreenCTM), not an AABB (which would be larger and
  // shifted off the glyph).
  function _labelQuads(padX, padY) {
    padX = padX || 0;
    padY = padY !== undefined ? padY : padX;
    const quads = [];
    // External labels the line renderers should avoid (constellations, stars,
    // ecliptic ticks, …). collectRects(null) returns only the collider's own
    // sources — the compass text is added below as oriented quads, not boxes.
    if (window.LabelCollider && LabelCollider.collectRects) {
      LabelCollider.collectRects(null, padX).forEach((r) =>
        quads.push([
          { x: r.left, y: r.top },
          { x: r.right, y: r.top },
          { x: r.right, y: r.bottom },
          { x: r.left, y: r.bottom },
        ])
      );
    }
    // Compass rim labels + cardinals — oriented quads matching the visible glyphs.
    // padX extends along the text baseline (local x), padY perpendicular to it.
    document.querySelectorAll(COMPASS_TEXT_SEL).forEach((t) => {
      if (t.classList.contains('label-occluded')) return;
      let bb, m;
      try {
        bb = t.getBBox();
        m = t.getScreenCTM();
      } catch (_) {
        return;
      }
      if (!bb || !m || bb.width <= 0 || bb.height <= 0) return;
      const x0 = bb.x - padX,
        y0 = bb.y - padY;
      const x1 = bb.x + bb.width + padX,
        y1 = bb.y + bb.height + padY;
      quads.push(
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }))
      );
    });
    return quads;
  }

  // Compass-local (x,y) → viewport pixel point (same space as getBoundingClientRect).
  function _localToViewport(x, y) {
    const obs = window.currentObserverLatLng;
    const c = _map.latLngToContainerPoint(L.latLng(obs.lat, obs.lng));
    const box = _map.getContainer().getBoundingClientRect();
    return { x: box.left + c.x + x, y: box.top + c.y + y };
  }

  // Point inside a single convex keep-out polygon (winding-agnostic edge-sign test).
  function _ptInQuad(p, poly) {
    let pos = false,
      neg = false;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length];
      const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cr > 0) pos = true;
      else if (cr < 0) neg = true;
      if (pos && neg) return false;
    }
    return true;
  }

  function _ptInQuads(p, quads) {
    for (let i = 0; i < quads.length; i++) if (_ptInQuad(p, quads[i])) return true;
    return false;
  }

  // Convex-quad overlap test: true if any vertex of one lies inside the other.
  // Sufficient for the near-rectangular text quads we test (a vertex of the
  // smaller box falls inside the larger whenever they intersect in practice).
  function _quadsOverlap(qa, qb) {
    for (let i = 0; i < qa.length; i++) if (_ptInQuad(qa[i], qb)) return true;
    for (let i = 0; i < qb.length; i++) if (_ptInQuad(qb[i], qa)) return true;
    return false;
  }

  // Oriented VIEWPORT/client quad of an SVG text element (getBBox corners through
  // getScreenCTM) — same client-px space as _labelQuads (see why there).
  function _textQuad(el, padX, padY) {
    padX = padX || 0;
    padY = padY !== undefined ? padY : padX;
    let bb, m;
    try {
      bb = el.getBBox();
      m = el.getScreenCTM();
    } catch (_) {
      return null;
    }
    if (!bb || !m || bb.width <= 0 || bb.height <= 0) return null;
    const x0 = bb.x - padX,
      y0 = bb.y - padY;
    const x1 = bb.x + bb.width + padX,
      y1 = bb.y + bb.height + padY;
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
  }

  // Split a sampled polyline into contiguous same-state runs, INTERPOLATING the
  // exact boundary where the state flips instead of snapping to the next sample.
  // Without this a dimmed/dropped band overshoots its keep-out by up to one sample
  // spacing (≈20px on an edge-extended ray, more on a coarse great-circle).
  //   samples : [{ v:{x,y}, e:<emit> }]  — `v` viewport px (state test),
  //                                          `e` the geometry to draw/emit
  //   stateFn(v) -> state                — classify a viewport point (e.g.
  //                                          'full' | 'dim' | 'drop')
  //   lerpE(eA, eB, t) -> emit           — interpolate the emitted geometry
  // Returns [{ state, items:[emit, …] }]; boundary emits are shared by the two
  // adjacent runs so sub-segments meet without a gap.
  function _dimRuns(samples, stateFn, lerpE) {
    const st = samples.map((s) => stateFn(s.v));
    const runs = [];
    let cur = { state: st[0], items: [samples[0].e] };
    for (let i = 1; i < samples.length; i++) {
      if (st[i] === cur.state) {
        cur.items.push(samples[i].e);
        continue;
      }
      // Bisect the viewport sub-segment for the precise state crossing, then split
      // both the test point and the emitted geometry at the same parameter.
      const a = samples[i - 1].v,
        b = samples[i].v,
        aState = st[i - 1];
      let lo = 0,
        hi = 1;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        const p = { x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid };
        if (stateFn(p) === aState) lo = mid;
        else hi = mid;
      }
      const bEmit = lerpE(samples[i - 1].e, samples[i].e, (lo + hi) / 2);
      cur.items.push(bEmit);
      runs.push(cur);
      cur = { state: st[i], items: [bEmit, samples[i].e] };
    }
    runs.push(cur);
    return runs;
  }

  // Draw a straight compass ray (local coords) split into label-dimmed runs. The
  // ray is straight, so each run is one line from its first to its last point.
  // baseAttrs carries stroke / stroke-width / stroke-dasharray / stroke-linecap
  // and the un-dimmed stroke-opacity.
  // dimQuads → the ray is faded to DIR_DIM_FACTOR where it passes under them
  // (text labels). dropQuads (optional) → the ray is faded harder, to
  // DIR_DROP_FACTOR, there (a fainter band, not an actual gap) — used to mute a
  // ray's overlap with a rim barb's short solid line or a body glyph icon.
  function _drawDimmedRay(parent, ax, ay, bx, by, baseAttrs, dimQuads, dropQuads) {
    const N = 24;
    const samples = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = ax + (bx - ax) * t,
        y = ay + (by - ay) * t;
      samples.push({ v: _localToViewport(x, y), e: { x, y } });
    }
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const baseOp = parseFloat(baseAttrs['stroke-opacity']);
    const hasDrop = dropQuads && dropQuads.length;
    const stateFn = (v) => (hasDrop && _ptInQuads(v, dropQuads) ? 'drop' : _ptInQuads(v, dimQuads) ? 'dim' : 'full');
    const runs = _dimRuns(samples, stateFn, lerp);
    // Infect a short bright stub wedged between two muted neighbours (e.g. the
    // few-px gap between a rim label and its adjacent barb) so the faded band
    // reads continuous instead of leaving a stray bright dot.
    const segLen = (r) => {
      const a = r.items[0],
        b = r.items[r.items.length - 1];
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    runs.forEach((r, i) => {
      if (r.state !== 'full') return;
      const p = runs[i - 1],
        n = runs[i + 1];
      if (p && n && p.state !== 'full' && n.state !== 'full' && segLen(r) <= DIR_BRIDGE_MAX) r.state = 'dim';
    });
    runs.forEach((run) => {
      const a = run.items[0],
        b = run.items[run.items.length - 1];
      const factor = run.state === 'drop' ? DIR_DROP_FACTOR : run.state === 'dim' ? DIR_DIM_FACTOR : 1;
      parent.appendChild(
        svgEl(
          'line',
          Object.assign({}, baseAttrs, {
            x1: a.x.toFixed(1),
            y1: a.y.toFixed(1),
            x2: b.x.toFixed(1),
            y2: b.y.toFixed(1),
            'stroke-opacity': (baseOp * factor).toFixed(3),
          })
        )
      );
    });
  }

  // Keep-out quads for the rim-label barbs (the short solid radial lines drawn by
  // drawRimLabel). A resting direction ray that runs collinear with a rim barb
  // (e.g. the sun's ray at sunset and the "Sunset" barb) would double up the line;
  // these quads let _drawDimmedRay fade the ray (to DIR_DROP_FACTOR) where it
  // overlaps the barb so the two don't stack into one heavy stroke.
  // Barb geometry mirrors drawRimLabel: radial from radius R−5 to R+24 along az.
  function _barbQuads(events, R) {
    const quads = [];
    if (!events) return quads;
    const halfW = 5; // perpendicular half-thickness in viewport px (barb + ray + pad)
    events.forEach((e) => {
      if (e.az == null || isNaN(e.az)) return;
      const rad = (e.az * Math.PI) / 180;
      const sinA = Math.sin(rad),
        cosA = Math.cos(rad);
      const i0 = _localToViewport(sinA * (R - 5), -cosA * (R - 5));
      const i1 = _localToViewport(sinA * (R + 24), -cosA * (R + 24));
      const dx = i1.x - i0.x,
        dy = i1.y - i0.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * halfW,
        ny = (dx / len) * halfW;
      quads.push([
        { x: i0.x + nx, y: i0.y + ny },
        { x: i1.x + nx, y: i1.y + ny },
        { x: i1.x - nx, y: i1.y - ny },
        { x: i0.x - nx, y: i0.y - ny },
      ]);
    });
    return quads;
  }

  // Keep-out quads for the body GLYPH ICONS (sun/moon/planet symbols), so a ray
  // passing under another body's icon is faded there (to DIR_DROP_FACTOR) rather
  // than drawn at full strength across the symbol. Built geometrically from
  // _bodyPositions — the compass is a
  // screen-space overlay (translate only, no scale), so a square of half ≈ glyph
  // radius around each body's local point maps 1:1 to viewport px. Skips event
  // pseudo-bodies (rise/set rim points have no icon).
  function _glyphQuads() {
    const quads = [];
    const half = MOON_GLYPH_R + 2; // ≈ widest glyph half-extent + a little air
    Object.keys(_bodyPositions).forEach((id) => {
      const pos = _bodyPositions[id];
      if (!pos || pos.isEvent) return;
      const corners = [
        [-half, -half],
        [half, -half],
        [half, half],
        [-half, half],
      ];
      quads.push(corners.map((c) => _localToViewport(pos.x + c[0], pos.y + c[1])));
    });
    return quads;
  }

  // Oriented quads for the persistent body NAME labels (class compass-name-label,
  // in the fx pane) so a ray passing under another body's name is DIMMED there.
  // Deliberately excludes the "Az…·El…" tag (a ray's own readout sits on it; we
  // don't want the ray to fade under its own measurement).
  function _nameLabelQuads() {
    const quads = [];
    document.querySelectorAll('.compass-name-label').forEach((t) => {
      const q = _textQuad(t, 2, 0);
      if (q) quads.push(q);
    });
    return quads;
  }

  // Azimuth + elevation tag (e.g. "Az 330° · El 12°") sitting just below an
  // extended ray, a fixed AZ_EDGE_INSET px IN from where the ray exits the screen
  // — so the tag keeps a consistent distance from the (bar-inset) viewport edge
  // regardless of ray angle / screen size (clamped to stay outside the disc and
  // on-screen). Aligned with the ray and kept upright; offset to the screen-
  // downward side so it reads "below the line" like the rim time labels.
  // Skipped (removed) if it would overlap an existing rim/cardinal label so the
  // two never stack into an unreadable smear (req: collide → don't show).
  function _drawAzimuthLabel(parent, ux, uy, edge, az, alt, color) {
    // Perpendicular pointing screen-down (local +y) so the tag hangs below the ray.
    let nx = -uy,
      ny = ux;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    let deg = (Math.atan2(uy, ux) * 180) / Math.PI;
    if (ux < 0) deg += 180; // keep glyphs upright when the ray points left
    const t = svgEl('text', {
      fill: color,
      'fill-opacity': 0.95,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-family': 'var(--font-serif)',
      'font-size': '12px',
      style: 'font-variant-numeric: tabular-nums',
    });
    const azR = Math.round(((az % 360) + 360) % 360);
    t.textContent = alt == null ? 'Az ' + azR + '°' : 'Az ' + azR + '° · El ' + Math.round(alt) + '°';
    parent.appendChild(t);
    // Place the tag at distance D along the ray + a perpendicular offset. side=+1
    // hangs it below the ray (default, reads like the rim time labels); side=-1
    // lifts it above the ray (fallback when below would sit on the bottom furniture).
    const place = (D, side) => {
      const cx = ux * D + nx * AZ_PERP_OFFSET * side,
        cy = uy * D + ny * AZ_PERP_OFFSET * side;
      t.setAttribute('x', cx.toFixed(1));
      t.setAttribute('y', cy.toFixed(1));
      t.setAttribute('transform', 'rotate(' + deg.toFixed(1) + ' ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')');
    };
    // Obstacles (client px): rim/cardinal labels + the bottom time rail + © credit
    // box. The tag lives on the fx pane, which COMPASS_TEXT_SEL excludes, so
    // _labelQuads never sees itself.
    const obstacles = _labelQuads(2).concat(_bottomFurnitureQuads());
    const overlaps = () => {
      const q = _textQuad(t, 2);
      if (!q) return false;
      for (let i = 0; i < obstacles.length; i++) if (_quadsOverlap(q, obstacles[i])) return true;
      return false;
    };
    const floor = _R + 30;
    let D0 = edge - AZ_EDGE_INSET;
    if (D0 < floor) D0 = Math.max(floor, edge - 8);
    // Pull the tag inward along the ray until it clears every obstacle (sits closer
    // to centre rather than stacking on a label or the rail). Try below the ray
    // first; if it can't clear even at the disc edge, flip above the ray and retry.
    // Drop it only if neither side clears.
    for (const side of [1, -1]) {
      let D = D0,
        guard = 0;
      place(D, side);
      while (overlaps() && D > floor && guard++ < 80) {
        D = Math.max(floor, D - 12);
        place(D, side);
      }
      if (!overlaps()) return;
    }
    parent.removeChild(t);
  }

  // Build transparent hit-targets for every recorded body on the top fx pane, so
  // the hover emphasis fires for the sun, moon and planets. Clicking a body glyph
  // PINS its azimuth line (req 2): the extended ray + name + azimuth tag stay put
  // until clicked again — the compass-side analogue of the locking observer pin.
  // Right-clicking opens a Lock/Unlock direction-line menu toggling the same pin.
  // Rise/set rim pseudo-bodies (`isEvent`) drive hover only; they aren't icons.
  function _buildInteraction() {
    if (!_rootFx) return;
    // Wire a hit element to a body id: hover emphasis, click-to-pin, and the
    // Lock/Unlock direction-line context menu. Shared by the glyph/event hits and
    // the sun/moon direction-line hits so the line behaves exactly like the glyph.
    const wire = (hit, id) => {
      hit.addEventListener('mouseenter', () => {
        _hoveredBodyId = id;
        _applyHover();
      });
      hit.addEventListener('mouseleave', () => {
        if (!hit.isConnected) return;
        _hoveredBodyId = null;
        _clearHover();
      });
      hit.style.cursor = 'pointer';
      hit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.preventDefault) ev.preventDefault();
        _togglePin(id);
      });
      // Right-click → Lock/Unlock direction line menu. stopPropagation keeps the
      // event off the map's marker contextmenu handler (the sun sits within its
      // 40px hit radius); preventDefault suppresses the native browser menu.
      hit.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const pinned = _pinnedBodyIds.has(id);
        const items = [
          {
            label: _t(pinned ? 'map.context.unlock_direction_line' : 'map.context.lock_direction_line'),
            onClick: () => _togglePin(id),
          },
        ];
        if (typeof window.showCtxMenu === 'function') {
          window.showCtxMenu(_map.mouseEventToContainerPoint(ev), items);
        }
      });
      _rootFx.appendChild(hit);
    };

    // Pass 1 — sun/moon direction-line hits, appended FIRST so they sit beneath
    // every glyph/event hit (an overlapping glyph always wins). A fat transparent
    // line along the ray (centre→glyph) lets the line body hover/pin like the glyph.
    ['moon', 'sun'].forEach((id) => {
      const pos = _bodyPositions[id];
      if (!pos) return;
      const ray = _rayGeom({ x: pos.x, y: pos.y });
      const lineHit = svgEl('line', {
        x1: ray.sx.toFixed(1),
        y1: ray.sy.toFixed(1),
        x2: pos.x.toFixed(1),
        y2: pos.y.toFixed(1),
        stroke: 'transparent',
        'stroke-width': HitWidths.COMPASS,
        'stroke-linecap': 'round',
        fill: 'none',
        'pointer-events': 'stroke',
        class: 'compass-hit',
      });
      wire(lineHit, id);
    });

    // Pass 2 — glyph/event hits, appended in ascending tier rank so the sun ends
    // up on top: sun > moon > planet > event (> the line hits from pass 1).
    const rank = (id, pos) => (id === 'sun' ? 3 : id === 'moon' ? 2 : pos.isEvent ? 0 : 1);
    Object.keys(_bodyPositions)
      .sort((a, b) => rank(a, _bodyPositions[a]) - rank(b, _bodyPositions[b]))
      .forEach((id) => {
        const pos = _bodyPositions[id];
        // Rise/set pseudo-bodies use a rect spanning their whole rim label (barb +
        // text) so the trigger range covers the label, not just the rim point; real
        // bodies (and any event missing a measured bbox) keep the round glyph hit.
        let hit;
        if (pos.isEvent && pos.hitRect) {
          const r = pos.hitRect;
          hit = svgEl('rect', {
            x: r.x.toFixed(1),
            y: r.y.toFixed(1),
            width: r.w.toFixed(1),
            height: r.h.toFixed(1),
            fill: 'transparent',
            class: 'compass-hit',
          });
        } else {
          hit = svgEl('circle', {
            cx: pos.x.toFixed(1),
            cy: pos.y.toFixed(1),
            r: 18,
            fill: 'transparent',
            class: 'compass-hit',
          });
        }
        wire(hit, id);
      });

    // Centre hub hit-target, appended LAST so it sits above every glyph/ray/event
    // hit (_rootFx is translated to the compass centre, so 0,0 is the hub). Locking
    // and clearing the observer is the primary interaction, so a click in the hub
    // must never be stolen by a body glyph that happens to fall near the centre.
    const centerHit = svgEl('circle', {
      cx: '0',
      cy: '0',
      r: String(DIR_CENTER_GAP),
      fill: 'transparent',
      class: 'compass-hit',
    });
    centerHit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ev.preventDefault) ev.preventDefault();
      _toggleLock();
    });
    centerHit.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof window.showCtxMenu === 'function') {
        window.showCtxMenu(_map.mouseEventToContainerPoint(ev), _markerMenuItems());
      }
    });
    _rootFx.appendChild(centerHit);
  }

  // Toggle a body's pinned azimuth line, then redraw the pin layer + refresh the
  // hover (so a now-pinned hovered body stops double-drawing). A full sync() too,
  // so the body's glyph picks up its now-pinned bright/dim state (drawn in
  // drawPlanetSymbols / drawDirectionLine, not in _renderPins).
  function _togglePin(id) {
    if (_pinnedBodyIds.has(id)) _pinnedBodyIds.delete(id);
    else _pinnedBodyIds.add(id);
    _renderPins();
    if (_hoveredBodyId) _applyHover();
    sync();
  }

  // Persistent body name label (class compass-name-label so _nameLabelQuads can
  // pick it up). Rise/set rim points reuse their rim label's text — skip them.
  function _drawNameLabel(labelGroup, pos) {
    if (pos.isEvent) return;
    const nameText = svgEl('text', {
      x: pos.x.toFixed(1),
      y: (pos.y + 22).toFixed(1),
      fill: pos.tint,
      'fill-opacity': 0.95,
      class: 'compass-name-label',
      'text-anchor': 'middle',
      'font-family': 'var(--font-serif)',
      'font-size': '12px',
    });
    nameText.textContent = pos.name || pos.glyphId;
    labelGroup.appendChild(nameText);
  }

  // Draw the brightened, screen-edge-extended ray for a body plus its azimuth tag.
  // Shared by hover (transient) and pin (persistent). The ray is DIMMED under text
  // labels (rim/cardinal + other bodies' names, tight ink so a graze isn't faded)
  // and DROPPED under rim barbs + body icons (a clean gap). nameDrawn=true means a
  // prior pass already emitted the name label (so its quad is available to dim the
  // ray); otherwise draw it here (hover).
  function _drawExtendedRay(rayGroup, labelGroup, pos, nameDrawn) {
    if (!nameDrawn) _drawNameLabel(labelGroup, pos);
    const ray = _rayGeom({ x: pos.x, y: pos.y });
    const edge = _edgeDistance(ray.ux, ray.uy);
    _drawDimmedRay(
      rayGroup,
      ray.sx,
      ray.sy,
      ray.ux * edge,
      ray.uy * edge,
      {
        stroke: pos.tint,
        'stroke-width': DIR_HOVER_WIDTH,
        'stroke-opacity': DIR_HOVER_OPACITY,
        'stroke-dasharray': DIR_DASH,
        'stroke-linecap': 'round',
      },
      _labelQuads(2, 0).concat(_nameLabelQuads()),
      _barbQuadsCache.concat(_glyphQuads())
    );
    // Azimuth + elevation tag below the extended ray. Uses the bar-inset edge so
    // it stays clear of the top control strip / bottom time rail.
    const ins = _barInsets();
    const edgeLbl = _edgeDistance(ray.ux, ray.uy, ins.top, ins.bot);
    _drawAzimuthLabel(labelGroup, ray.ux, ray.uy, edgeLbl, pos.az, pos.alt, pos.tint);
  }

  // Rebuild the persistent pinned rays (req 2). Pinned ids that aren't currently
  // on the compass (body set, layer off) are kept in the Set but skipped, so the
  // pin reappears when the body returns. Two passes: emit ALL name labels first so
  // every pin ray can dim under any name (not just names drawn before it).
  function _renderPins() {
    if (!_pinRayGroup || !_pinLabelGroup) return;
    [_pinRayGroup, _pinLabelGroup].forEach((g) => {
      while (g.firstChild) g.removeChild(g.firstChild);
    });
    const live = [];
    _pinnedBodyIds.forEach((id) => {
      const pos = _bodyPositions[id];
      if (pos) live.push(pos);
    });
    live.forEach((pos) => _drawNameLabel(_pinLabelGroup, pos));
    live.forEach((pos) => _drawExtendedRay(_pinRayGroup, _pinLabelGroup, pos, true));
  }

  // Hover emphasis: brighten + extend the ray to the screen edge and label the
  // body. Skipped for pinned bodies — their persistent pin already shows it all.
  function _applyHover() {
    if (!_hoverRayGroup || !_hoverNameGroup || !_hoveredBodyId) return;
    _clearHover(); // also calls _refreshPlanetGlyphs()
    if (_pinnedBodyIds.has(_hoveredBodyId)) return;
    const pos = _bodyPositions[_hoveredBodyId];
    if (!pos) return;
    _drawExtendedRay(_hoverRayGroup, _hoverNameGroup, pos);
  }

  function _clearHover() {
    [_hoverRayGroup, _hoverNameGroup].forEach((g) => {
      if (g) while (g.firstChild) g.removeChild(g.firstChild);
    });
    _refreshPlanetGlyphs();
  }

  function _refreshPlanetGlyphs() {
    if (!_rootPlanet) return;
    _rootPlanet.querySelectorAll('[data-glyph-id]').forEach((wrap) => {
      const id = wrap.getAttribute('data-glyph-id');
      const active = _hoveredBodyId === id || _pinnedBodyIds.has(id);
      wrap.setAttribute('opacity', active ? '1' : '0.45');
    });
  }

  // ---- Locked Great-Circle Lines ----
  //
  // A locked line runs from the observer to a body's ground point (sub-stellar /
  // sub-solar / sub-lunar point) and is triggered by clicking that body's
  // rendering ON THE MAP (not the compass glyph). The target may be the
  // sun/moon/a planet (`kind:'body'`, sub-point via Planets.getSearchLatLng) or
  // any star / DSO (`kind:'fixed'`, sub-point via GeoUtils.subStellarPoint).
  // Each entry is `{ id, kind, name, body?|raDeg?+dec? }`, keyed by id. Only ONE
  // line is shown at a time — clicking a new body replaces the previous line;
  // re-clicking the same body toggles it off.

  // Public: toggle the great-circle line to a body. No-op (returns false) unless
  // the observer is locked and the compass is showing, so a normal body click
  // outside that mode keeps its existing behaviour untouched.
  function toggleGreatCircleTo(spec) {
    if (!_locked || _hidden) return false;
    if (!spec || !spec.id) return false;
    const wasLocked = !!_lockedBodies[spec.id];
    _lockedBodies = {}; // at most one line at a time
    if (!wasLocked) {
      if (spec.kind === 'body' && !spec.name) spec.name = bodyName(spec.id);
      _lockedBodies[spec.id] = spec;
    }
    _rebuildLockedLines();
    if (_hoveredBodyId) _applyHover(); // refresh ring locked-state
    return true;
  }

  function _clearLockedLines() {
    _lockedBodies = {};
    if (_lockedGroup) _lockedGroup.clearLayers();
  }

  function _lockedColor(spec) {
    if (spec.kind === 'body') {
      if (spec.id === 'sun') return _resolveVar('--sun-label') || '#c8c2b4';
      if (spec.id === 'moon') return _resolveVar('--moon-trace') || '#9fb4c4';
      return _resolveVar('--compass-planet') || '#cce0df';
    }
    return _resolveVar('--fg-primary') || '#e7e3da'; // stars / DSOs
  }

  // Current ground point {lat, lng} for a locked spec at `date` (recomputed each
  // sync since bodies — and the sub-stellar longitude — drift with time).
  function _subPointFor(spec, date) {
    try {
      if (spec.kind === 'fixed') {
        return GeoUtils.subStellarPoint(spec.raDeg, spec.dec, date);
      }
      if (typeof Planets !== 'undefined' && Planets.getSearchLatLng) {
        return Planets.getSearchLatLng(spec.id, date);
      }
    } catch (_) {}
    return null;
  }

  // Initial great-circle bearing (deg, 0-360, N=0 clockwise) from point 1 to
  // point 2. For the observer→sub-point line this equals the body's horizontal
  // azimuth — which is exactly what the great-circle line represents on the map.
  // Substitute {name} into a localized template, inserting a single space at any
  // CJK↔non-CJK character boundary the substitution creates. So the Chinese template
  // "指向{name}" yields "指向河鼓二" for a CJK name but "指向 Menkent" for a Latin
  // fallback, and the Japanese "{name}へ" yields "月へ" but "Menkent へ". Latin
  // templates ("To {name}") already have their own spacing and are untouched.
  function _joinLocalizedName(template, name) {
    const isCJK = (ch) => /[⺀-鿿　-〿぀-ヿ＀-￯豈-﫿]/.test(ch);
    const idx = template.indexOf('{name}');
    if (idx < 0) return template;
    const before = template.slice(0, idx);
    const after = template.slice(idx + 6);
    let sep1 = '',
      sep2 = '';
    if (name) {
      const bLast = before.slice(-1),
        nFirst = name[0];
      if (bLast && !/\s/.test(bLast) && isCJK(bLast) !== isCJK(nFirst)) sep1 = ' ';
      const nLast = name.slice(-1),
        aFirst = after[0];
      if (aFirst && !/\s/.test(aFirst) && isCJK(aFirst) !== isCJK(nLast)) sep2 = ' ';
    }
    return before + sep1 + name + sep2 + after;
  }

  function _initialBearing(lat1, lng1, lat2, lng2) {
    const D = Math.PI / 180;
    const phi1 = lat1 * D,
      phi2 = lat2 * D,
      dLng = (lng2 - lng1) * D;
    const y = Math.sin(dLng) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
    return ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
  }

  // Great-circle (slerp) sampling between two lat/lng points, anchored at the
  // observer's actual longitude and kept continuous so it doesn't tear at the
  // antimeridian.
  function _slerpLatLngs(lat1, lng1, lat2, lng2, n) {
    const D = Math.PI / 180;
    const xyz = (la, lo) => {
      const a = la * D,
        b = lo * D,
        ca = Math.cos(a);
      return [ca * Math.cos(b), ca * Math.sin(b), Math.sin(a)];
    };
    const v1 = xyz(lat1, lng1),
      v2 = xyz(lat2, lng2);
    let dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    dot = Math.max(-1, Math.min(1, dot));
    const om = Math.acos(dot);
    const raw = [];
    if (om < 1e-7) {
      raw.push([lat1, lng1], [lat2, lng2]);
    } else {
      const so = Math.sin(om);
      for (let i = 0; i <= n; i++) {
        const f = i / n,
          s1 = Math.sin((1 - f) * om) / so,
          s2 = Math.sin(f * om) / so;
        const x = s1 * v1[0] + s2 * v2[0],
          y = s1 * v1[1] + s2 * v2[1],
          z = s1 * v1[2] + s2 * v2[2];
        raw.push([Math.atan2(z, Math.hypot(x, y)) / D, Math.atan2(y, x) / D]);
      }
    }
    raw[0] = [lat1, lng1];
    const out = [raw[0].slice()];
    let prev = raw[0][1];
    for (let i = 1; i < raw.length; i++) {
      let l = raw[i][1];
      while (l - prev > 180) l -= 360;
      while (l - prev < -180) l += 360;
      out.push([raw[i][0], l]);
      prev = l;
    }
    return out;
  }

  // World-wrap copies of a polyline's longitude span that intersect the viewport.
  function _gcOffsets(base) {
    let W = -200,
      E = 520;
    if (_map) {
      const b = _map.getBounds();
      W = Math.max(W, b.getWest());
      E = Math.min(E, b.getEast());
    }
    let lo = Infinity,
      hi = -Infinity;
    for (const p of base) {
      if (p[1] < lo) lo = p[1];
      if (p[1] > hi) hi = p[1];
    }
    const out = [];
    for (let w = -2; w <= 2; w++) {
      const off = w * 360;
      if (hi + off < W - 1 || lo + off > E + 1) continue;
      out.push(off);
    }
    return out.length ? out : [0];
  }

  function _rebuildLockedLines() {
    if (!_lockedGroup) return;
    _lockedGroup.clearLayers();
    const obs = window.currentObserverLatLng;
    if (!obs || _hidden) return;
    if (typeof GeoUtils === 'undefined') return;
    const date = TimeState.current;
    const casingCol = _resolveVar('--dark-casing') || '#0e1014';
    // Great-circle lines read as a navigation/geodesic layer, not as the body
    // itself — so the line + far-end label use a dedicated neutral "drafting"
    // tone (kept outside the warm/cool/verdigris body hues). The endpoint dot
    // stays body-coloured (see below) to carry which-body identity.
    const lineCol = _resolveVar('--great-circle') || '#b6c0cf';
    const quads = _labelQuads(2);
    const box = _map.getContainer().getBoundingClientRect();
    Object.keys(_lockedBodies).forEach((id) => {
      const spec = _lockedBodies[id];
      const sub = _subPointFor(spec, date);
      if (!sub || sub.lat == null || sub.lng == null) return;
      const base = _slerpLatLngs(obs.lat, obs.lng, sub.lat, sub.lng, GC_SAMPLES);
      if (base.length < 2) return;
      const color = _lockedColor(spec);
      // Far-end label inputs (per spec; one locked body at a time). Azimuth is the
      // observer→sub-point bearing.
      const azR = Math.round(_initialBearing(obs.lat, obs.lng, sub.lat, sub.lng));
      // Elevation: report the body's apparent topocentric altitude — the value the
      // compass ray shows. A resolvable body goes through Equator/Horizon 'normal',
      // which folds in horizontal parallax (~0.9° for the Moon); the observer→sub-point
      // central angle would give the geocentric altitude, off by enough to round a
      // whole degree. Stars/DSOs and planetary moons (no Astronomy.Body, negligible
      // parallax) fall back to that central angle + refraction.
      const _D = Math.PI / 180;
      const _aeBody = spec.kind === 'body' ? Astronomy.Body[spec.id.charAt(0).toUpperCase() + spec.id.slice(1)] : null;
      let gcAlt;
      if (_aeBody != null) {
        gcAlt = Math.round(bodyAzAlt(_aeBody, date, aeObserver(obs)).alt);
      } else {
        const _sinAlt =
          Math.sin(obs.lat * _D) * Math.sin(sub.lat * _D) +
          Math.cos(obs.lat * _D) * Math.cos(sub.lat * _D) * Math.cos((sub.lng - obs.lng) * _D);
        const _geomAlt = Math.asin(Math.max(-1, Math.min(1, _sinAlt))) / _D;
        gcAlt = Math.round(_geomAlt + Astronomy.Refraction('normal', _geomAlt));
      }
      // Below the horizon (el<0) the body isn't visible from the observer, so the
      // whole line reads one notch fainter than a line pointing at a visible body.
      const elFactor = gcAlt < 0 ? GC_BELOW_HORIZON_FACTOR : 1;
      // Name: bodies via bodyName; stars/DSOs via the same resolver their info card
      // uses (Sky.starDisplayName → xingguan name in Chinese), recomputed each rebuild
      // so a language switch updates it. Falls back to the spec's static name.
      let gcName;
      if (spec.kind === 'body') {
        gcName = bodyName(spec.id);
      } else if (spec.star && typeof Sky !== 'undefined' && Sky.starDisplayName) {
        gcName = Sky.starDisplayName(spec.star) || spec.name || '';
      } else {
        gcName = spec.name || '';
      }
      // Build "指向{name}" etc. with a space inserted at any CJK↔Latin boundary so a
      // Latin fallback name in a CJK template reads "指向 Menkent" not "指向Menkent".
      const gcToText = _joinLocalizedName(_t('rays.to_body'), gcName);
      const gcSize = _map.getSize();
      const gcObsC = _map.latLngToContainerPoint(L.latLng(obs.lat, obs.lng));
      const gcInsets = _barInsets(); // opaque top strip / bottom rail
      const gcObstacles = quads.concat(_bottomFurnitureQuads()); // same set the compass tag avoids
      // Round dots: zero-length dashes + round linecap render as true circles
      // (diameter = weight), spaced by the gap — not stubby short dashes. Each
      // wrap copy is split into label-dimmed runs so the dots fade under labels.
      _gcOffsets(base).forEach((off) => {
        const samples = base.map((p2) => {
          const ll = [p2[0], p2[1] + off];
          const c = _map.latLngToContainerPoint(L.latLng(ll[0], ll[1]));
          return { v: { x: box.left + c.x, y: box.top + c.y }, c: { x: c.x, y: c.y }, e: ll };
        });
        const llLerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const stateFn = (v) => (_ptInQuads(v, quads) ? 'dim' : 'full');
        _dimRuns(samples, stateFn, llLerp).forEach((run) => {
          const seg = run.items;
          if (seg.length < 2) return;
          const om = (run.state === 'dim' ? DIR_DIM_FACTOR : 1) * elFactor;
          L.polyline(seg, {
            pane: 'observer-greatcircle',
            color: casingCol,
            weight: 5.4,
            opacity: 0.55 * om,
            dashArray: '0 11',
            lineCap: 'round',
            interactive: false,
            smoothFactor: 1,
          }).addTo(_lockedGroup);
          L.polyline(seg, {
            pane: 'observer-greatcircle',
            color: lineCol,
            weight: 3.6,
            opacity: 0.95 * om,
            dashArray: '0 11',
            lineCap: 'round',
            interactive: false,
            smoothFactor: 1,
          }).addTo(_lockedGroup);
        });
        const last = samples[samples.length - 1];
        const end = last.e;
        const endOm = (_ptInQuads(last.v, quads) ? DIR_DIM_FACTOR : 1) * elFactor;
        L.circleMarker(end, {
          pane: 'observer-greatcircle',
          radius: 3,
          color: color,
          weight: 1.4,
          opacity: 0.95 * endOm,
          fillColor: color,
          fillOpacity: 0.5 * endOm,
          interactive: false,
        }).addTo(_lockedGroup);
        _drawGcEndLabel(samples, gcSize, gcInsets, gcObsC, box, lineCol, gcToText, azR, gcAlt, gcObstacles);
      });
    });
  }

  // Live client-px radius of the body glyph/glow rendered at container point
  // (px, py) — the largest element in any `body-*` pane whose centre sits near that
  // point. Lets the far-end label clear the ACTUAL on-screen disk/halo (which grows
  // with zoom) rather than a guessed constant. 0 when nothing is drawn there (e.g. a
  // fixed star with no map glyph).
  function _bodyRadiusAt(px, py, box) {
    const cx = box.left + px,
      cy = box.top + py;
    let R = 0;
    document.querySelectorAll('.leaflet-pane[class*="body-"]').forEach((p) => {
      p.querySelectorAll('img, div').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.width > 400) return;
        const ex = r.left + r.width / 2,
          ey = r.top + r.height / 2;
        if (Math.hypot(ex - cx, ey - cy) > 64) return; // not the body at this terminal
        R = Math.max(R, r.width / 2, r.height / 2);
      });
    });
    return R;
  }

  // Walk INWARD (toward the hub) along the sampled great-circle polyline, starting
  // at the terminal point P (which lies between sample `fi` and the screen-edge, or
  // exactly on sample fi for an on-screen body), accumulating container-px segment
  // lengths until `dist` is reached. Returns { x, y, tx, ty } — the point plus the
  // unit tangent of the segment it landed on (pointing inward). null if `dist`
  // exceeds the visible inward length.
  function _walkInward(samples, fi, P, dist) {
    let cur = { x: P.x, y: P.y };
    let startIdx = fi;
    // If P coincides with sample fi (body terminal), the first inward vertex is fi-1.
    if (Math.abs(P.x - samples[fi].c.x) < 1e-6 && Math.abs(P.y - samples[fi].c.y) < 1e-6) startIdx = fi - 1;
    let remaining = dist;
    for (let i = startIdx; i >= 0; i--) {
      const nx = samples[i].c;
      const sx = nx.x - cur.x,
        sy = nx.y - cur.y;
      const segLen = Math.hypot(sx, sy);
      if (segLen < 1e-6) {
        cur = { x: nx.x, y: nx.y };
        continue;
      }
      if (remaining <= segLen) {
        const t = remaining / segLen;
        return { x: cur.x + sx * t, y: cur.y + sy * t, tx: sx / segLen, ty: sy / segLen };
      }
      remaining -= segLen;
      cur = { x: nx.x, y: nx.y };
    }
    return null;
  }

  // Far-end label for a locked great-circle line: body name on the inner
  // (observer-facing) side, azimuth on the outer side, the whole tag sitting JUST
  // INSIDE the line's visible terminal so the azimuth never overshoots past where
  // the dots stop. The terminal is the body sub-point when it's on screen, else the
  // line's crossing of the bar-inset viewport (top control strip / bottom rail
  // treated as edges). Mirrors the compass azimuth tag (`_drawAzimuthLabel`): the
  // tag HANGS BESIDE the line at a fixed AZ_PERP_OFFSET perpendicular gap (computed
  // off the local tangent at the anchor), screen-down side first then flipped above,
  // sliding inward along the line to dodge the same obstacle set; if neither side
  // clears before the hub it isn't drawn. Rotated to the line's on-screen tangent and
  // kept upright. `samples[i].c` are container points; obsC is the hub; box maps
  // container→client px.
  function _drawGcEndLabel(samples, sz, insets, obsC, box, color, toText, azR, altR, obstacles) {
    const N = samples.length;
    if (N < 2) return;
    const top = insets.top || 0,
      bot = insets.bot || 0;
    const inRect = (p) => p.x >= 0 && p.x <= sz.x && p.y >= top && p.y <= sz.y - bot;
    // Visible terminal: outermost sample inside the bar-inset rect, walking inward.
    let fi = -1;
    for (let i = N - 1; i >= 0; i--) {
      if (inRect(samples[i].c)) {
        fi = i;
        break;
      }
    }
    if (fi < 0) return; // line not visible
    let P, terminalIsEdge;
    if (fi === N - 1) {
      P = { x: samples[N - 1].c.x, y: samples[N - 1].c.y }; // body sub-point in view
      terminalIsEdge = false;
    } else {
      const a = samples[fi].c,
        b = samples[fi + 1].c; // a inside, b outside
      const dx = b.x - a.x,
        dy = b.y - a.y;
      let t = 1;
      if (dx > 1e-6) t = Math.min(t, (sz.x - a.x) / dx);
      else if (dx < -1e-6) t = Math.min(t, (0 - a.x) / dx);
      if (dy > 1e-6) t = Math.min(t, (sz.y - bot - a.y) / dy);
      else if (dy < -1e-6) t = Math.min(t, (top - a.y) / dy);
      P = { x: a.x + dx * t, y: a.y + dy * t }; // crossing of the bar-inset rect
      terminalIsEdge = true;
    }
    const floor = _R; // keep the tag's centre outside the horizon ring
    if (Math.hypot(P.x - obsC.x, P.y - obsC.y) < floor) return; // nothing to label near the hub

    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Label text: Az · El · To Name (Az on the outer/terminal side, To on the inner/hub side).
    // When reverse=true the tag rotates 180° to stay upright, so Az and To swap DOM positions
    // to keep Az at the terminal end. Both orientations read "Az X° · El Y° · To Name" from
    // the terminal end inward.
    const azElStr = 'Az ' + azR + '° · El ' + altR + '°';
    const toStr = esc(toText);
    const mk = (html, deg) =>
      '<div class="gc-end-inner" style="transform:translate(-50%,-50%) rotate(' +
      deg.toFixed(1) +
      'deg);color:' +
      color +
      '">' +
      html +
      '</div>';
    // Create once at P to measure the tag's along-line length (offsetWidth is the
    // pre-rotation layout width; rotation does not change it).
    const marker = L.marker(_map.containerPointToLatLng(L.point(P.x, P.y)), {
      icon: L.divIcon({
        className: 'gc-end-label',
        html: mk(azElStr + ' · ' + toStr, 0),
        iconSize: null,
        iconAnchor: [0, 0],
      }),
      pane: 'observer-greatcircle',
      interactive: false,
      keyboard: false,
      bubblingMouseEvents: false,
    }).addTo(_lockedGroup);
    const el = marker.getElement();
    const innerEl = el && el.querySelector('.gc-end-inner');
    const W = innerEl ? innerEl.offsetWidth : 0,
      H = innerEl ? innerEl.offsetHeight : 0;
    if (!W) {
      marker.remove();
      return;
    }
    // On-screen body: measure its glyph/glow radius live (it grows with zoom) and
    // start the tag inward enough to clear it ALONG the line. `gap` is the along-line
    // start; the perpendicular AZ_PERP_OFFSET (below) lifts it off the dots themselves.
    const Rb = terminalIsEdge ? 0 : _bodyRadiusAt(P.x, P.y, box);
    const gap = terminalIsEdge ? AZ_EDGE_INSET : Rb > 0 ? Rb + GC_BODY_MARGIN : GC_END_GAP;

    // Hang the tag BESIDE the line, exactly like the compass azimuth tag: take the
    // local tangent at each candidate anchor, offset perpendicular by AZ_PERP_OFFSET
    // (screen-down side first, then flipped above), and slide the anchor inward along
    // the line in 12px steps until the client-px AABB clears every obstacle. Drop it
    // if neither side clears before the hub. Positions are analytic — no per-step reflow.
    let chosen = null;
    for (const side of [1, -1]) {
      for (let c = W / 2 + gap, guard = 0; guard < 120; c += 12, guard++) {
        const w = _walkInward(samples, fi, P, c);
        if (!w) break; // ran past the inner end
        if (Math.hypot(w.x - obsC.x, w.y - obsC.y) < floor) break; // reached the hub → try other side
        let deg = (Math.atan2(-w.ty, -w.tx) * 180) / Math.PI; // outward = opposite the inward walk
        let reverse = false;
        if (deg > 90 || deg < -90) {
          deg += 180;
          reverse = true;
        }
        // Perpendicular pointing screen-down (local +y), same convention as the compass tag.
        let nx = -w.ty,
          ny = w.tx;
        if (ny < 0) {
          nx = -nx;
          ny = -ny;
        }
        const ctrX = w.x + nx * AZ_PERP_OFFSET * side,
          ctrY = w.y + ny * AZ_PERP_OFFSET * side;
        const th = (deg * Math.PI) / 180,
          ac = Math.abs(Math.cos(th)),
          as = Math.abs(Math.sin(th));
        const hx = (W / 2) * ac + (H / 2) * as,
          hy = (W / 2) * as + (H / 2) * ac;
        const cx = box.left + ctrX,
          cy = box.top + ctrY;
        const quad = [
          { x: cx - hx, y: cy - hy },
          { x: cx + hx, y: cy - hy },
          { x: cx + hx, y: cy + hy },
          { x: cx - hx, y: cy + hy },
        ];
        let hit = false;
        for (let i = 0; i < obstacles.length; i++)
          if (_quadsOverlap(quad, obstacles[i])) {
            hit = true;
            break;
          }
        if (!hit) {
          chosen = { ctr: { x: ctrX, y: ctrY }, deg: deg, reverse: reverse };
          break;
        }
      }
      if (chosen) break;
    }
    if (!chosen) {
      marker.remove();
      return;
    } // collide everywhere → don't show

    // Always read Az · El · To Name; `reverse` only flips the rotation to keep text upright.
    const orderHtml = azElStr + ' · ' + toStr;
    marker.setIcon(
      L.divIcon({ className: 'gc-end-label', html: mk(orderHtml, chosen.deg), iconSize: null, iconAnchor: [0, 0] })
    );
    marker.setLatLng(_map.containerPointToLatLng(L.point(chosen.ctr.x, chosen.ctr.y)));
  }

  function drawRimLabel(g, R, az, label, timeStr, cssColor) {
    if (az == null || isNaN(az)) return;
    const rad = (az * Math.PI) / 180;
    const sinA = Math.sin(rad),
      cosA = Math.cos(rad);
    const rimX = sinA * R;
    const rimY = -cosA * R;

    // Radial outward barb direction (fixes diagonal barbs near cardinals)
    const barbLen = 24;
    const dx = sinA * barbLen;
    const dy = -cosA * barbLen;
    // Inner (rim-side) end of the text is pinned to the barb tip:
    // East half (0°-180°, sinA>0): first char at tip → anchor='start'
    // West half (180°-360°, sinA<0): last char at tip → anchor='end'
    const east = !(az > 180 && az < 360);
    const anchor = east ? 'start' : 'end';

    const labelG = svgEl('g', { transform: 'translate(' + rimX.toFixed(1) + ',' + rimY.toFixed(1) + ')' });

    // Barb line: from slightly inside rim to barb tip
    labelG.appendChild(
      svgEl('line', {
        x1: (-sinA * 5).toFixed(1),
        y1: (cosA * 5).toFixed(1),
        x2: dx.toFixed(1),
        y2: dy.toFixed(1),
        stroke: cssColor,
        'stroke-width': 2.4,
        'stroke-opacity': 0.85,
        'stroke-linecap': 'round',
      })
    );

    // Pivot = barb tip + small radial gap; both text lines hang off this point.
    const pivotX = sinA * (barbLen + 6);
    const pivotY = -cosA * (barbLen + 6);
    // Baseline parallel to the spoke. East half reads outward; west half reads
    // inward (toward the disc) so glyphs stay upright instead of mirrored. The
    // two reading directions differ by 180°, which keeps text upright on both
    // sides while the baseline stays collinear with the radial direction line.
    // SVG rotate is CW (y-down): map local +x (reading dir) onto that vector.
    const deg =
      ((east
        ? Math.atan2(-cosA, sinA) // reading dir = radial outward
        : Math.atan2(cosA, -sinA)) * // reading dir = radial inward
        180) /
      Math.PI;

    const textG = svgEl('g', {
      transform: 'translate(' + pivotX.toFixed(1) + ',' + pivotY.toFixed(1) + ') ' + 'rotate(' + deg.toFixed(1) + ')',
    });

    // Label text line 1 (name) — pinned at pivot, parallel to spoke
    const t1 = svgEl('text', {
      x: 0,
      y: 4,
      fill: cssColor,
      'text-anchor': anchor,
      'font-family': 'var(--font-serif)',
      'font-size': '13px',
    });
    t1.textContent = label;
    textG.appendChild(t1);

    // Label text line 2 (time) — stacked below name, same color/font
    const t2 = svgEl('text', {
      x: 0,
      y: 18,
      fill: cssColor,
      'text-anchor': anchor,
      'font-family': 'var(--font-serif)',
      'font-size': '13px',
      style: 'font-variant-numeric: tabular-nums',
    });
    t2.textContent = timeStr;
    textG.appendChild(t2);

    labelG.appendChild(textG);
    g.appendChild(labelG);
    return labelG;
  }

  // ---- Annual Envelope ----

  function getEnvelopeData(obs, year) {
    const lat01 = Math.round(obs.lat * 10) / 10;
    const key = lat01 + '|' + year;
    if (_envCache.key === key) return _envCache;

    const seasons = Astronomy.Seasons(year);
    const isNorth = obs.lat >= 0;
    const summerDate = isNorth ? seasons.jun_solstice.date : seasons.dec_solstice.date;
    const winterDate = isNorth ? seasons.dec_solstice.date : seasons.jun_solstice.date;

    const summer = sampleBodyPath(Astronomy.Body.Sun, obs, summerDate);
    const winter = sampleBodyPath(Astronomy.Body.Sun, obs, winterDate);

    _envCache = { key, summer, winter };
    return _envCache;
  }

  function drawEnvelope(g, R, obs, year) {
    if (Math.abs(obs.lat) > POLAR_LAT) return;

    const data = getEnvelopeData(obs, year);
    const sumAbove = data.summer.filter((s) => s.alt > 0);
    const winAbove = data.winter.filter((s) => s.alt > 0);
    if (sumAbove.length < 2) return;

    // Summer arc points (projected)
    const sumPts = sumAbove.map((s) => projectAltAz(s.az, s.alt));
    // Summer rim endpoints
    const sumRiseAz = sumAbove[0].az;
    const sumSetAz = sumAbove[sumAbove.length - 1].az;
    const sumRiseRim = projectAltAz(sumRiseAz, 0);
    const sumSetRim = projectAltAz(sumSetAz, 0);

    let pathD;

    if (winAbove.length < 2) {
      // Degenerate winter: crescent = summer arc + horizon arc back
      pathD = 'M' + sumRiseRim.x.toFixed(1) + ',' + sumRiseRim.y.toFixed(1);
      sumPts.forEach((p) => {
        pathD += 'L' + p.x.toFixed(1) + ',' + p.y.toFixed(1);
      });
      pathD += 'L' + sumSetRim.x.toFixed(1) + ',' + sumSetRim.y.toFixed(1);
      // Arc along rim from sumSet back to sumRise (the "sun side" — going through S for northern hemisphere)
      const sweepFlag = shortestArcSweep(sumSetAz, sumRiseAz, obs.lat >= 0) ? 1 : 0;
      pathD +=
        'A' +
        R.toFixed(1) +
        ',' +
        R.toFixed(1) +
        ' 0 0 ' +
        sweepFlag +
        ' ' +
        sumRiseRim.x.toFixed(1) +
        ',' +
        sumRiseRim.y.toFixed(1);
      pathD += 'Z';
    } else {
      // Normal: summer arc → west rim arc → winter arc reversed → east rim arc
      const winPts = winAbove.map((s) => projectAltAz(s.az, s.alt));
      const winRiseAz = winAbove[0].az;
      const winSetAz = winAbove[winAbove.length - 1].az;
      const winRiseRim = projectAltAz(winRiseAz, 0);
      const winSetRim = projectAltAz(winSetAz, 0);

      // 1. Summer arc (sunrise → sunset)
      pathD = 'M' + sumRiseRim.x.toFixed(1) + ',' + sumRiseRim.y.toFixed(1);
      sumPts.forEach((p) => {
        pathD += 'L' + p.x.toFixed(1) + ',' + p.y.toFixed(1);
      });
      pathD += 'L' + sumSetRim.x.toFixed(1) + ',' + sumSetRim.y.toFixed(1);

      // 2. West rim arc: sumSet → winSet (short way, clockwise for northern hemisphere)
      const westSweep = rimArcSweep(sumSetAz, winSetAz);
      const westLarge = rimArcLarge(sumSetAz, winSetAz);
      pathD +=
        'A' +
        R.toFixed(1) +
        ',' +
        R.toFixed(1) +
        ' 0 ' +
        westLarge +
        ' ' +
        westSweep +
        ' ' +
        winSetRim.x.toFixed(1) +
        ',' +
        winSetRim.y.toFixed(1);

      // 3. Winter arc reversed (sunset → sunrise)
      winPts
        .slice()
        .reverse()
        .forEach((p) => {
          pathD += 'L' + p.x.toFixed(1) + ',' + p.y.toFixed(1);
        });
      pathD += 'L' + winRiseRim.x.toFixed(1) + ',' + winRiseRim.y.toFixed(1);

      // 4. East rim arc: winRise → sumRise (short way)
      const eastSweep = rimArcSweep(winRiseAz, sumRiseAz);
      const eastLarge = rimArcLarge(winRiseAz, sumRiseAz);
      pathD +=
        'A' +
        R.toFixed(1) +
        ',' +
        R.toFixed(1) +
        ' 0 ' +
        eastLarge +
        ' ' +
        eastSweep +
        ' ' +
        sumRiseRim.x.toFixed(1) +
        ',' +
        sumRiseRim.y.toFixed(1);
      pathD += 'Z';
    }

    g.appendChild(
      svgEl('path', {
        d: pathD,
        stroke: 'none',
        fill: 'var(--annual-envelope)',
        'fill-opacity': 0.07,
      })
    );
  }

  // Determine SVG arc sweep/large flags for a rim arc from azStart to azEnd.
  // In SVG coordinate space, compass N is -Y, azimuth increases clockwise
  // (matching SVG's clockwise sweep=1).
  function rimArcSweep(azStart, azEnd) {
    let delta = azEnd - azStart;
    while (delta < -180) delta += 360;
    while (delta > 180) delta -= 360;
    // Positive delta = clockwise (sweep=1), negative = counter-clockwise (sweep=0)
    return delta >= 0 ? 1 : 0;
  }

  function rimArcLarge(azStart, azEnd) {
    let delta = Math.abs(azEnd - azStart);
    if (delta > 180) delta = 360 - delta;
    return delta > 180 ? 1 : 0;
  }

  function shortestArcSweep(azFrom, azTo, isNorth) {
    // For degenerate winter crescent: arc should go through the "sun side"
    // (south for northern hemisphere, north for southern).
    const sunSideAz = isNorth ? 180 : 0;
    // Try clockwise
    let cw = azTo - azFrom;
    if (cw < 0) cw += 360;
    const midCw = (azFrom + cw / 2) % 360;
    let ccw = azFrom - azTo;
    if (ccw < 0) ccw += 360;
    const midCcw = (azTo + ccw / 2) % 360;
    function azDist(a, b) {
      let d = Math.abs(a - b);
      if (d > 180) d = 360 - d;
      return d;
    }
    return azDist(midCw, sunSideAz) < azDist(midCcw, sunSideAz);
  }

  // ---- Main Sync ----

  function _compassRoots() {
    return [_rootBase, _rootLines, _rootCardinals, _rootPlanet, _rootMoon, _rootSun, _rootFx];
  }

  function clearCompass() {
    _compassRoots().forEach((root) => {
      if (root) while (root.firstChild) root.removeChild(root.firstChild);
    });
  }

  function ensureSvg() {
    if (_rootBase) return;
    function build(paneName) {
      const pane = _map.getPane(paneName);
      if (!pane) return null;
      const svg = svgEl('svg', {
        class: 'rays-overlay-svg',
        style: 'position:absolute;left:0;top:0;overflow:visible',
      });
      const root = svgEl('g', { class: 'compass-root' });
      svg.appendChild(root);
      pane.appendChild(svg);
      return { svg, root };
    }
    const base = build('observer-compass');
    const lines = build('observer-compass-lines');
    const cards = build('observer-compass-cardinals');
    const planet = build('observer-compass-planet');
    const moon = build('observer-compass-moon');
    const sun = build('observer-compass-sun');
    const fx = build('observer-compass-fx');
    if (!base || !lines || !cards || !planet || !moon || !sun || !fx) return;
    _svgBase = base.svg;
    _rootBase = base.root;
    _svgLines = lines.svg;
    _rootLines = lines.root;
    _svgCardinals = cards.svg;
    _rootCardinals = cards.root;
    _svgPlanet = planet.svg;
    _rootPlanet = planet.root;
    _svgMoon = moon.svg;
    _rootMoon = moon.root;
    _svgSun = sun.svg;
    _rootSun = sun.root;
    _svgFx = fx.svg;
    _rootFx = fx.root;
  }

  function _doSync() {
    if (!_map) return;
    clearCompass();
    _hoverRayGroup = null;
    _hoverNameGroup = null;
    _pinRayGroup = null;
    _pinLabelGroup = null;
    _bodyPositions = {};
    if (_hidden) {
      _rebuildLockedLines();
      return;
    }
    const obs = window.currentObserverLatLng;
    if (!obs) return;
    if (typeof Astronomy === 'undefined') return;

    ensureSvg();
    const date = TimeState.current;
    _R = horizonRadiusPx(_map.getZoom());
    const R = _R;

    const cp = _map.latLngToLayerPoint(L.latLng(obs.lat, obs.lng));
    const cpTransform = 'translate(' + cp.x.toFixed(1) + ',' + cp.y.toFixed(1) + ')';
    _compassRoots().forEach((root) => root && root.setAttribute('transform', cpTransform));

    const aeObs = aeObserver(obs);
    const twilightOn = isLayerOn('twilight');
    const moonOn = isLayerOn('moon');
    const dayStart = new Date(observerMidnightMs(obs, date));

    // Moon's continuous above-horizon arc (current arc, or next one if down).
    // Computed up here so the trace, rim labels and cardinal-fade all share its
    // rise/set endpoints rather than calendar-day rise/set.
    const moonArc = moonOn ? computeMoonArc(obs, date, aeObs) : null;

    // Compute rise/set events once — shared by cardinal-fade, rim labels AND the
    // direction-line glyph gating (so glyph appearance == labelled rise instant).
    const events = []; // { az, label, timeStr, color, body }
    let sunRiseDate = null,
      sunSetDate = null;
    if (twilightOn) {
      const sunrise = searchRiseSet(Astronomy.Body.Sun, aeObs, +1, dayStart, 1);
      const sunset = searchRiseSet(Astronomy.Body.Sun, aeObs, -1, dayStart, 1);
      sunRiseDate = sunrise ? sunrise.date : null;
      sunSetDate = sunset ? sunset.date : null;
      if (sunrise) {
        const p = bodyAzAlt(Astronomy.Body.Sun, sunrise.date, aeObs);
        events.push({
          az: p.az,
          label: _t('rays.sunrise'),
          timeStr: fmtTime(sunrise.date),
          color: 'var(--sunrise-label)',
          body: 'sun',
          kind: 'rise',
        });
      }
      if (sunset) {
        const p = bodyAzAlt(Astronomy.Body.Sun, sunset.date, aeObs);
        events.push({
          az: p.az,
          label: _t('rays.sunset'),
          timeStr: fmtTime(sunset.date),
          color: 'var(--sunset-label)',
          body: 'sun',
          kind: 'set',
        });
      }
    }
    if (moonArc) {
      if (moonArc.mRise) {
        const p = bodyAzAlt(Astronomy.Body.Moon, moonArc.mRise.date, aeObs);
        events.push({
          az: p.az,
          label: _t('rays.moonrise'),
          timeStr: fmtTime(moonArc.mRise.date),
          color: 'var(--moonrise-label)',
          body: 'moon',
          kind: 'rise',
        });
      }
      if (moonArc.mSet) {
        const p = bodyAzAlt(Astronomy.Body.Moon, moonArc.mSet.date, aeObs);
        events.push({
          az: p.az,
          label: _t('rays.moonset'),
          timeStr: fmtTime(moonArc.mSet.date),
          color: 'var(--moonset-label)',
          body: 'moon',
          kind: 'set',
        });
      }
    }
    const rimAzimuths = events.map((e) => e.az);

    // Groups for z-order. The ring/envelope go to the base root (bottom); ALL
    // lines (both traces + both direction rays) go to the lines root so no line
    // covers an icon/label; cardinals go to their own root above the lines; the
    // body glyphs + rim labels are split by body so their panes stack
    // planet < moon < sun (see ensureSvg / init).
    const gEnvelope = svgEl('g', { class: 'envelope' });
    const gRings = svgEl('g', { class: 'rings' });
    const gSunTrace = svgEl('g', { class: 'sun-trace' });
    const gMoonTrace = svgEl('g', { class: 'moon-trace' });
    const gCardinals = svgEl('g', { class: 'cardinals' });
    const gSunRay = svgEl('g', { class: 'dir-lines sun-dir' });
    const gMoonRay = svgEl('g', { class: 'dir-lines moon-dir' });
    const gSunGlyph = svgEl('g', { class: 'body-glyph sun-glyph' });
    const gMoonGlyph = svgEl('g', { class: 'body-glyph moon-glyph' });
    const gPlanets = svgEl('g', { class: 'planet-symbols' });
    const gSunRim = svgEl('g', { class: 'rim-labels sun-rim' });
    const gMoonRim = svgEl('g', { class: 'rim-labels moon-rim' });

    // ---- Envelope (twilight-gated) — base ----
    if (twilightOn) {
      drawEnvelope(gEnvelope, R, obs, date.getFullYear());
    }
    _rootBase.appendChild(gEnvelope);

    // ---- Compass chrome: outer ring only (ticks + inner ring removed) — base ----
    drawRings(gRings, R);
    _rootBase.appendChild(gRings);

    // Diurnal trace colours: sun ramps sunrise→sunset, moon moonrise→moonset.
    // Resolved to hex so the gradient stops and the glyph tint stay identical.
    const cSunRise = _resolveVar('--sunrise-label'),
      cSunSet = _resolveVar('--sunset-label');
    const cMoonRise = _resolveVar('--moonrise-label'),
      cMoonSet = _resolveVar('--moonset-label');
    let sunGrad = null,
      moonGrad = null;

    // ---- Sun Trace (twilight-gated) — base ----
    // Stroke = rise→set gradient.
    if (twilightOn) {
      const sunSamples = sampleBodyPath(Astronomy.Body.Sun, obs, date);
      const sunSegs = aboveHorizonSegments(sunSamples);
      sunGrad = addTraceGradient(gSunTrace, 'obs-sun-trace-grad', sunSegs, cSunRise, cSunSet);
      drawTrace(gSunTrace, sunSegs, sunGrad ? sunGrad.url : cSunRise, 2.4, 5.2, null);
    }
    _rootLines.appendChild(gSunTrace);

    // ---- Moon Trace (moon-gated) — lines ----
    // The continuous arc, rise→set gradient. moonArc.segs is the current/next arc.
    if (moonArc) {
      moonGrad = addTraceGradient(gMoonTrace, 'obs-moon-trace-grad', moonArc.segs, cMoonRise, cMoonSet);
      drawTrace(gMoonTrace, moonArc.segs, moonGrad ? moonGrad.url : cMoonRise, 2.0, 4.8, null);
    }
    _rootLines.appendChild(gMoonTrace);

    // ---- Cardinals (always visible; faded where a rim label collides) — own pane ----
    // Above the lines so a ray never covers a cardinal letter.
    const cardinalEls = drawCardinals(gCardinals, R, rimAzimuths);
    _rootCardinals.appendChild(gCardinals);

    // ---- Direction Lines From Center → Current Sun/Moon ----
    // Gated on the labelled
    // rise/set arc (null → alt>0 fallback for polar day/night) so the glyph
    // appears exactly when the rim rise fires and the map boundaries sweep here.
    // The ray goes to the lines pane (below glyphs); the glyph to its own tier
    // pane (sun above moon).
    // Rim-barb keep-out quads: a resting direction ray is faded where it runs
    // under one of these short solid lines (e.g. the sunset ray vs the "Sunset" barb).
    const barbQuads = _barbQuads(events, R);
    // Cache for the pin/hover extended rays (rebuilt outside this scope) so they
    // fade at rim barbs too — not just the resting sun/moon rays below.
    _barbQuadsCache = barbQuads;
    if (twilightOn) {
      const sunShow = inRiseSetWindow(date, sunRiseDate, sunSetDate);
      drawDirectionLine(
        gSunRay,
        gSunGlyph,
        Astronomy.Body.Sun,
        date,
        aeObs,
        'var(--sun-trace)',
        0.7,
        'sun',
        sunShow,
        sunGrad,
        barbQuads
      );
    }
    if (moonOn) {
      const moonShow = inRiseSetWindow(
        date,
        moonArc && moonArc.mRise && moonArc.mRise.date,
        moonArc && moonArc.mSet && moonArc.mSet.date
      );
      drawDirectionLine(
        gMoonRay,
        gMoonGlyph,
        Astronomy.Body.Moon,
        date,
        aeObs,
        'var(--moon-trace)',
        0.7,
        'moon',
        moonShow,
        moonGrad,
        barbQuads
      );
    }
    _rootLines.appendChild(gMoonRay);
    _rootLines.appendChild(gSunRay);
    _rootMoon.appendChild(gMoonGlyph);
    _rootSun.appendChild(gSunGlyph);

    // ---- Planet symbols around the rim (planets-layer-gated, alt>0 only) — planet pane ----
    drawPlanetSymbols(gPlanets, R, date, aeObs);
    _rootPlanet.appendChild(gPlanets);

    // ---- Rim Labels (reuse precomputed events) ----
    // Routed by body so sun labels
    // sit above moon labels. Appended AFTER the glyphs so rim labels render on top
    // of them (original z-order). The pin/hover extended rays and the pseudo-body
    // registration below both run after this, so the rim text is already in the DOM
    // when _labelQuads queries it; the resting direction ray stops at radius R and
    // never reaches the rim text (R+30+), so it needs no rim-label quad either.
    events.forEach((e) => {
      e._labelG = drawRimLabel(e.body === 'sun' ? gSunRim : gMoonRim, R, e.az, e.label, e.timeStr, e.color);
    });
    _rootSun.appendChild(gSunRim);
    _rootMoon.appendChild(gMoonRim);

    // Register each rise/set rim point as a hover-only pseudo-body so the shared
    // hit-target + ray-extension machinery gives the sunrise/sunset/moonrise/
    // moonset directions the same screen-edge ray on hover as the body glyphs.
    events.forEach((e) => {
      const pt = projectAltAz(e.az, 0);
      // Hit area = the rim label's full extent (barb + both text lines): labelG is
      // translated to (rimX,rimY) == (pt.x,pt.y), so its local bbox shifted by pt
      // gives a compass-local rect (same space as the fx-pane hit targets). This
      // matches the ray's shadow zone (barb drop + label dim) the user wants.
      let hitRect = null;
      if (e._labelG) {
        try {
          const bb = e._labelG.getBBox();
          if (bb && bb.width > 0 && bb.height > 0)
            hitRect = { x: pt.x + bb.x - 3, y: pt.y + bb.y - 3, w: bb.width + 6, h: bb.height + 6 };
        } catch (_) {}
      }
      _bodyPositions[e.body + ':' + e.kind] = {
        x: pt.x,
        y: pt.y,
        az: e.az,
        alt: 0,
        tint: e.color,
        name: e.label,
        glyphId: e.body + ':' + e.kind,
        isEvent: true,
        hitRect: hitRect,
      };
    });

    // Register the four cardinal letters as clickable pseudo-bodies — same hover /
    // pin / lock ray machinery as the rise/set rim points, minus the elevation
    // readout (a cardinal direction has no altitude → alt:null). isEvent:true reuses
    // the rect hit-target and skips the duplicate name label (N/E/W/S already labels
    // it). gCardinals is in the DOM at this point so getBBox is available.
    cardinalEls.forEach((c) => {
      const pt = projectAltAz(c.az, 0);
      let hitRect = null;
      try {
        const bb = c.el.getBBox();
        if (bb && bb.width > 0 && bb.height > 0)
          hitRect = { x: bb.x - 4, y: bb.y - 4, w: bb.width + 8, h: bb.height + 8 };
      } catch (_) {}
      _bodyPositions['cardinal:' + c.key] = {
        x: pt.x,
        y: pt.y,
        az: c.az,
        alt: null,
        tint: c.fill,
        name: c.label,
        glyphId: 'cardinal:' + c.key,
        isEvent: true,
        hitRect: hitRect,
      };
    });

    // Interaction layer. Both the hover ray and the pinned rays go to the lines
    // pane (below glyphs/labels, like the resting rays); their names + azimuth
    // tags + the hit-targets go to the top fx pane (z=950) so they sit above every
    // glyph and label. Pins are rebuilt every sync since the bodies move with time.
    _hoverRayGroup = svgEl('g', { class: 'compass-hover-ray' });
    _hoverNameGroup = svgEl('g', { class: 'compass-hover' });
    _pinRayGroup = svgEl('g', { class: 'compass-pin-ray' });
    _pinLabelGroup = svgEl('g', { class: 'compass-pin' });
    _rootLines.appendChild(_pinRayGroup);
    _rootLines.appendChild(_hoverRayGroup);
    _rootFx.appendChild(_pinLabelGroup);
    _rootFx.appendChild(_hoverNameGroup);
    _renderPins();
    _buildInteraction();
    if (_hoveredBodyId) {
      if (_bodyPositions[_hoveredBodyId]) {
        _applyHover();
      } else {
        _hoveredBodyId = null;
      }
    }

    // ---- Locked great-circle lines on the map (rebuilt: bodies move with time) ----
    _rebuildLockedLines();
  }

  function sync() {
    if (_frame) return;
    _frame = setTimeout(() => {
      _frame = null;
      _doSync();
    }, 0);
  }

  // Lightweight reposition — only update <g> transform during drag, no rebuild
  function _reposition() {
    if (!_map || !_rootBase) return;
    const obs = window.currentObserverLatLng;
    if (!obs) return;
    const cp = _map.latLngToLayerPoint(L.latLng(obs.lat, obs.lng));
    const cpTransform = 'translate(' + cp.x.toFixed(1) + ',' + cp.y.toFixed(1) + ')';
    _compassRoots().forEach((root) => root && root.setAttribute('transform', cpTransform));
  }

  // ---- Compass Lifecycle ----

  function _compassInit(map) {
    _map = map;
    if (typeof TimeState !== 'undefined') {
      TimeState.subscribe(() => sync());
    }
    // Re-render cardinal letters + rim labels when user switches language
    if (typeof I18n !== 'undefined' && I18n.subscribe) {
      I18n.subscribe(() => sync());
    }
    map.on('move', _reposition); // smooth follow during drag
    map.on('zoomend moveend', sync);

    function watchButtons() {
      document.querySelectorAll('.layer-btn').forEach((btn) => {
        new MutationObserver(() => sync()).observe(btn, {
          attributes: true,
          attributeFilter: ['aria-pressed'],
        });
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', watchButtons);
    } else {
      setTimeout(watchButtons, 0);
    }
  }

  function _compassHide() {
    _hidden = true;
    _hoveredBodyId = null;
    _pinnedBodyIds.clear();
    _clearLockedLines();
    sync();
  }

  function _compassShow() {
    _hidden = false;
    sync();
  }

  function _compassClear() {
    _hidden = true;
    _hoveredBodyId = null;
    _pinnedBodyIds.clear();
    _hoverRayGroup = null;
    _hoverNameGroup = null;
    _pinRayGroup = null;
    _pinLabelGroup = null;
    _clearLockedLines();
    window.currentObserverLatLng = null;
    clearCompass();
  }

  return { init, place, clear, lock, unlock, isLocked, lockAndShowCompass, toggleGreatCircleTo };
})();
