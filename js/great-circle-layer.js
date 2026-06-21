/** great-circle-layer.js — factory for single-curve great-circle overlays.
 *
 * Produces a module with the same public API as GalacticEquator / LunarPath:
 *   init(map), update(date), addTo(map), removeFrom(map), isOn()
 *
 * Performance gate: _rebuild returns immediately when the visible-wrap set and
 * date are unchanged (pan / zoom within the same wrap band & same time → no
 * clearLayers, Leaflet auto-reprojects existing polylines).
 *
 * Rail-type layers (Ecliptic, CelestialEquator) have zoom-tiered tick geometry
 * and are not covered here; they carry their own gate inline.
 *
 * Depends on: L (Leaflet), GeoUtils, I18n, MAP_LNG_WEST / MAP_LNG_EAST (map.js globals,
 * available at runtime even though map.js loads after this file).
 *
 * config fields:
 *   sampleFn(date) → [[ra,dec],…]   called each rebuild; galactic caches internally
 *   colors: { line, lineDay, casing, casingDay }
 *   pane, labelPane          Leaflet pane names
 *   paneZ, labelPaneZ        z-index strings
 *   labelKey                 I18n key (e.g. 'overlay.galactic_equator')
 *   labelFallback            fallback string when I18n is absent
 *   labelClass               CSS class for L.divIcon (for per-layer CSS targeting)
 *   labelCount               label copies per world (default 4)
 *   dashArray, weight, opacity  polyline style (optional, have sensible defaults)
 */
function createGreatCircleLayer(cfg) {
  const DEG = 180 / Math.PI;
  const LABEL_COUNT = cfg.labelCount || 4;

  let _map = null;
  let _group = null;
  let _lastKey = '';

  const CASING_STYLE = {
    pane: cfg.pane,
    smoothFactor: 0,
    noClip: true,
    interactive: false,
    color: cfg.colors.casing,
    weight: 3.0,
    opacity: 1.0,
    dashArray: cfg.dashArray || '6 4',
  };
  const LINE_STYLE = {
    pane: cfg.pane,
    smoothFactor: 0,
    noClip: true,
    interactive: false,
    color: cfg.colors.line,
    weight: cfg.weight || 1.1,
    opacity: cfg.opacity || 0.55,
    dashArray: cfg.dashArray || '6 4',
  };

  // Curve-rendering helpers live in GeoUtils (shared with ecliptic.js); these thin
  // wrappers bind the module's _map closure so call sites stay unchanged.
  function _projectTable(table, date) {
    return GeoUtils.projectSubStellarTable(table, date);
  }

  function _unwrap(pts) {
    return GeoUtils.unwrapLngContinuity(pts);
  }

  function _visibleOffsets(base) {
    return GeoUtils.visibleWrapOffsets(base, _map);
  }

  function _tangentAt(pts, idx) {
    const lo = Math.max(0, idx - 3);
    const hi = Math.min(pts.length - 1, idx + 3);
    const dx = pts[hi][1] - pts[lo][1];
    const dy = pts[hi][0] - pts[lo][0];
    let angle = Math.atan2(-dy, dx) * DEG;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return angle;
  }

  function _adaptAt(lat, lng, date) {
    if (window._dayMaskVisible && date && typeof GeoUtils !== 'undefined' && GeoUtils.sunAltAtPoint) {
      const t = GeoUtils.dayStrength(GeoUtils.sunAltAtPoint(lat, lng, date));
      return {
        halo: GeoUtils.lerpHex(cfg.colors.casing, cfg.colors.casingDay, t),
        text: GeoUtils.lerpHex(cfg.colors.line, cfg.colors.lineDay, t),
      };
    }
    return { halo: cfg.colors.casing, text: cfg.colors.line };
  }

  function _placeLabel(lat, lng, angleDeg, text, date) {
    const a = _adaptAt(lat, lng, date);
    const font = 'font-family:var(--font-serif);font-size:15px;letter-spacing:0.05em;';
    const html =
      '<span style="color:' +
      a.text +
      ';-webkit-text-stroke:5px ' +
      a.halo +
      ';paint-order:stroke;' +
      font +
      'transform:rotate(' +
      angleDeg.toFixed(1) +
      'deg);">' +
      text +
      '</span>';
    return L.marker([lat, lng], {
      pane: cfg.labelPane,
      icon: L.divIcon({ className: cfg.labelClass || '', html, iconSize: [80, 22], iconAnchor: [40, 11] }),
      interactive: false,
      keyboard: false,
    });
  }

  function _rebuild(date) {
    const wrapsKey = GeoUtils.visibleWrapsFromBounds(_map).join(',');
    const key = wrapsKey + '|' + date.getTime();
    if (key === _lastKey) return;
    _lastKey = key;

    _group.clearLayers();

    const raDecTable = cfg.sampleFn(date);
    if (!raDecTable || raDecTable.length < 2) return;
    const pts0 = _unwrap(_projectTable(raDecTable, date));
    const offsets = _visibleOffsets(pts0);
    if (offsets.length === 0) return;

    const runs = GeoUtils.dayStrengthRuns(pts0, date);
    for (const off of offsets) {
      for (const run of runs) {
        const seg = off === 0 ? run.pts : run.pts.map((p) => [p[0], p[1] + off]);
        L.polyline(
          seg,
          Object.assign({}, CASING_STYLE, { color: GeoUtils.lerpHex(cfg.colors.casing, cfg.colors.casingDay, run.t) })
        ).addTo(_group);
        L.polyline(
          seg,
          Object.assign({}, LINE_STYLE, { color: GeoUtils.lerpHex(cfg.colors.line, cfg.colors.lineDay, run.t) })
        ).addTo(_group);
      }
    }

    const n = raDecTable.length;
    const labelText = typeof I18n !== 'undefined' ? I18n.t(cfg.labelKey) : cfg.labelFallback;
    const step = Math.floor((n - 1) / LABEL_COUNT);
    for (let k = 0; k < LABEL_COUNT; k++) {
      const idx = Math.round(step * k + step / 2);
      const pt = pts0[Math.min(idx, pts0.length - 1)];
      const angle = _tangentAt(pts0, Math.min(idx, pts0.length - 1));
      for (const off of offsets) {
        _placeLabel(pt[0], pt[1] + off, angle, labelText, date).addTo(_group);
      }
    }
  }

  function init(map) {
    if (_map) return;
    _map = map;
    if (!map.getPane(cfg.pane)) {
      map.createPane(cfg.pane);
      map.getPane(cfg.pane).style.zIndex = String(cfg.paneZ);
      map.getPane(cfg.pane).style.pointerEvents = 'none';
    }
    if (!map.getPane(cfg.labelPane)) {
      map.createPane(cfg.labelPane);
      map.getPane(cfg.labelPane).style.zIndex = String(cfg.labelPaneZ);
      map.getPane(cfg.labelPane).style.pointerEvents = 'none';
    }
    _group = L.layerGroup();
  }

  function update(date) {
    if (!_group) return;
    _rebuild(date || (typeof TimeState !== 'undefined' ? TimeState.current : new Date()));
  }

  function addTo(map) {
    if (_group && !map.hasLayer(_group)) map.addLayer(_group);
  }

  function removeFrom(map) {
    if (_group && map.hasLayer(_group)) map.removeLayer(_group);
  }

  function isOn() {
    return !!(_map && _group && _map.hasLayer(_group));
  }

  return { init, update, addTo, removeFrom, isOn };
}
