/** meteor.js — Meteor shower radiant markers. */
const Meteor = (() => {
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
  const COPY_OFFSETS = [-360, 0, 360];

  let _map = null;
  let _layer = null;
  let _showers = [];
  let _unsub = false;

  let _popup = null;
  let _popupBuilder = null;
  let _popupShower = null; // shower whose popup is open (for time-driven refresh)
  let _popupOffset = 0; // world-wrap copy the popup was opened in (× 360°)

  function solarLongitude(date) {
    if (typeof Astronomy !== 'undefined') {
      const time = Astronomy.MakeTime(date);
      return Astronomy.SunPosition(time).elon;
    }
    // Rough approximation
    const jd = date.getTime() / 86400000 + 2440587.5;
    const T = (jd - 2451545.0) / 36525;
    const L = (280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360;
    return (L + 360) % 360;
  }

  function gmstDeg(date) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const T = (jd - 2451545.0) / 36525;
    return (280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000) % 360;
  }

  function isActive(shower, solLon) {
    let start = shower.start_sol;
    let end = shower.end_sol;
    if (start > end) {
      // Wraps around 0°
      return solLon >= start || solLon <= end;
    }
    return solLon >= start && solLon <= end;
  }

  // Ember-crimson intensity ramp: monotonic dim -> bright, so ZHR reads as
  // colour intensity. Crimson is the one hue lane no other sky object uses
  // (comets=green, DSOs=amber/blue, satellites=verdigris/gold), and echoes the
  // red nitrogen-oxygen airglow of bright meteors. Bright tier doubles as the
  // peak-label/peak-tag apex colour (see .meteor-peak in style.css).
  function zhrColor(zhr) {
    if (zhr >= 100) return '#FFB0C0'; // bright  — blush flare
    if (zhr >= 20) return '#DA7889'; // medium  — rose-red
    if (zhr >= 5) return '#B45F6D'; // faint   — dusky rose
    return '#8E4A54'; // dim     — garnet ember (recedes)
  }

  function _displayName(s) {
    const i18nKey = 'meteor.name.' + s.code;
    return _t(i18nKey) !== i18nKey ? _t(i18nKey) : s.name;
  }

  function _buildPopupHTML(s, date) {
    const solLon = solarLongitude(date);
    let distFromPeak = Math.abs(solLon - s.sol_lon);
    if (distFromPeak > 180) distFromPeak = 360 - distFromPeak;
    const nearPeak = distFromPeak < 3;
    const dn = _displayName(s);
    const sym = nearPeak ? '✦ ' : '✧ ';
    const parentRow = s.parent
      ? '<div class="info-row"><span class="label"' +
        _glossAttr('parent_body') +
        '>' +
        _t('meteor.parent') +
        '</span><span class="value">' +
        s.parent +
        '</span></div>'
      : '';
    const skyInfo = GeoUtils.buildSkyInfoHTML(s.ra, s.dec, TimeState.current, _t);
    return (
      '<div class="star-panel">' +
      '<h2 class="star-name">' +
      sym +
      dn +
      '</h2>' +
      '<div class="star-scroll">' +
      '<div class="info-block">' +
      '<div class="info-block-title">' +
      _t('sky.object_data') +
      '</div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('ra') +
      '>' +
      _t('star.ra') +
      '</span><span class="value">' +
      GeoUtils.fmtRA(s.ra) +
      '</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('dec') +
      '>' +
      _t('star.dec') +
      '</span><span class="value">' +
      GeoUtils.fmtDec(s.dec) +
      '</span></div>' +
      parentRow +
      '<div class="info-row"><span class="label"' +
      _glossAttr('zhr') +
      '>' +
      _t('meteor.zhr') +
      '</span><span class="value">' +
      s.zhr +
      '</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('velocity') +
      '>' +
      _t('meteor.velocity') +
      '</span><span class="value">' +
      s.v +
      ' km/s</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('solar_longitude') +
      '>' +
      _t('meteor.peak_sol') +
      '</span><span class="value">' +
      s.sol_lon.toFixed(1) +
      '°</span></div>' +
      '<div class="info-row"><span class="label"' +
      _glossAttr('solar_longitude') +
      '>' +
      _t('meteor.current_sol') +
      '</span><span class="value">' +
      solLon.toFixed(1) +
      '°</span></div>' +
      '</div>' +
      skyInfo +
      '</div>' +
      GeoUtils.cardCredits([{ name: 'IMO', url: 'https://www.imo.net/' }]) +
      '</div>'
    );
  }

  // Public: radiant sub-stellar point {lat,lng} at `date`.
  function locate(s, date) {
    return GeoUtils.subStellarPoint(s.ra, s.dec, date);
  }

  // Public: open the radiant info popup at `latlng` (used by search).
  function showSearchPopup(s, date, latlng, map) {
    const m = map || _map;
    if (!m) return;
    // Build from TimeState.current (not the frozen `date`) so a later time
    // change refreshes the current-solar-longitude / peak / alt-az fields.
    _popupShower = s;
    const ll = L.latLng(latlng);
    const base = locate(s, TimeState.current);
    _popupOffset = base ? Math.round((ll.lng - base.lng) / 360) * 360 : 0;
    _popupBuilder = function () {
      return _buildPopupHTML(s, TimeState.current);
    };
    if (!_popup) {
      _popup = L.popup({
        className: 'sky-star-popup',
        maxWidth: 250,
        offset: [0, -6],
        closeButton: true,
        autoPan: false,
      });
      _popup.on('remove', () => {
        _popupBuilder = null;
        _popupShower = null;
      });
    }
    _popup.setLatLng(latlng).setContent(_popupBuilder()).openOn(m);
  }

  // SVG icon matching Unicode ✧/✦ shapes, no glow.
  // Both use outer R=6.5 with inner notches at 45°, inner r≈2.6 (ratio ~0.4, per Unicode glyph).
  // nearPeak (✦): solid filled.  normal (✧): hollow stroke-only outline.
  function _meteorSvg(nearPeak, color) {
    var ns = 'http://www.w3.org/2000/svg';
    var c = color;
    // Inner (8.8,5.2) etc: center(7,7) ± 2.6*cos45 ≈ ±1.84 → (8.84,5.16) rounded to (8.8,5.2)
    var path = 'M7,0.5 L8.8,5.2 L13.5,7 L8.8,8.8 L7,13.5 L5.2,8.8 L0.5,7 L5.2,5.2 Z';
    if (nearPeak) {
      // ✦ solid filled star
      return (
        '<svg class="meteor-sym" xmlns="' +
        ns +
        '" width="14" height="14" viewBox="0 0 14 14"' +
        ' style="overflow:visible">' +
        '<path d="' +
        path +
        '" fill="' +
        c +
        '"/>' +
        '</svg>'
      );
    } else {
      // ✧ hollow outline star
      return (
        '<svg class="meteor-sym" xmlns="' +
        ns +
        '" width="14" height="14" viewBox="0 0 14 14"' +
        ' style="overflow:visible">' +
        '<path d="' +
        path +
        '" fill="none" stroke="' +
        c +
        '" stroke-width="1.2" stroke-linejoin="round"/>' +
        '</svg>'
      );
    }
  }

  function _render(date) {
    if (!_layer || !_map) return;
    _layer.clearLayers();

    const solLon = solarLongitude(date);
    const gmst = gmstDeg(date);

    for (const s of _showers) {
      if (!isActive(s, solLon)) continue;

      const lon = ((((s.ra - gmst) % 360) + 540) % 360) - 180;
      const lat = s.dec;
      const color = zhrColor(s.zhr);

      // Distance from peak (in degrees of solar longitude)
      let distFromPeak = Math.abs(solLon - s.sol_lon);
      if (distFromPeak > 180) distFromPeak = 360 - distFromPeak;
      const nearPeak = distFromPeak < 3;

      const i18nKey = 'meteor.name.' + s.code;
      const displayName = _t(i18nKey) !== i18nKey ? _t(i18nKey) : s.name;

      const symHtml = _meteorSvg(nearPeak, color);
      const lblRaw = displayName + (nearPeak ? ' ' + _t('meteor.peak') : '');
      const lblText = nearPeak && s.zhr >= 20 ? '<span style="color:' + color + '">' + lblRaw + '</span>' : lblRaw;

      for (const offset of COPY_OFFSETS) {
        // Symbol marker — interactive, click shows popup
        const symIcon = L.divIcon({
          className: 'meteor-marker' + (nearPeak ? ' meteor-peak' : ''),
          html: symHtml,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const symM = L.marker([lat, lon + offset], {
          icon: symIcon,
          pane: 'meteor-labels',
          interactive: true,
          bubblingMouseEvents: false,
        });
        symM.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          _popupShower = s;
          _popupOffset = offset;
          _popupBuilder = function () {
            return _buildPopupHTML(s, TimeState.current);
          };
          if (!_popup) {
            _popup = L.popup({
              className: 'sky-star-popup',
              maxWidth: 250,
              offset: [0, -6],
              closeButton: true,
              autoPan: false,
            });
            _popup.on('remove', () => {
              _popupBuilder = null;
              _popupShower = null;
            });
          }
          _popup
            .setLatLng([lat, lon + offset])
            .setContent(_popupBuilder())
            .openOn(_map);
        });
        symM.on('contextmenu', (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (ev.originalEvent) ev.originalEvent.preventDefault();
          if (window._showBodyContextMenu) {
            window._showBodyContextMenu(ev, () => {
              if (window.activateCelestialVis) window.activateCelestialVis(s.ra, s.dec);
            });
          } else if (window.activateCelestialVis) {
            window.activateCelestialVis(s.ra, s.dec);
          }
        });
        _layer.addLayer(symM);

        // Label marker — non-interactive, participates in collision detection
        const lblIcon = L.divIcon({
          className: 'meteor-label' + (nearPeak ? ' meteor-peak' : ''),
          html: lblText,
          iconSize: null,
          iconAnchor: [-10, 7],
        });
        const lblM = L.marker([lat, lon + offset], {
          icon: lblIcon,
          pane: 'meteor-labels',
          interactive: false,
          keyboard: false,
        });
        _layer.addLayer(lblM);
      }
    }
  }

  function _onTimeChange() {
    if (!_map || !_layer || !_map.hasLayer(_layer)) return;
    _render(TimeState.current);
    // Keep an open radiant popup in sync: refresh its time-dependent content and
    // slide it to the radiant's new sub-stellar point, preserving the world copy.
    if (_popup && _popupBuilder && _popupShower && _map.hasLayer(_popup)) {
      const p = locate(_popupShower, TimeState.current);
      if (p) _popup.setLatLng([p.lat, p.lng + _popupOffset]);
      _popup.setContent(_popupBuilder());
    }
  }

  async function _loadData() {
    try {
      const resp = await fetch('data/meteors/showers.json');
      if (!resp.ok) return;
      _showers = await resp.json();
    } catch (e) {
      console.warn('[meteor] load failed', e);
    }
  }

  function init(map) {
    _map = map;
    _layer = L.layerGroup();
  }

  async function addTo(map) {
    if (!_layer) init(map);
    _layer.addTo(map);
    if (!_showers.length) await _loadData();
    _render(TimeState.current);
    if (!_unsub && typeof TimeState !== 'undefined') {
      _unsub = true;
      TimeState.subscribe(_onTimeChange);
      if (typeof I18n !== 'undefined') {
        I18n.subscribe(() => {
          if (_map && _layer && _map.hasLayer(_layer)) _render(TimeState.current);
          if (_popup && _popupBuilder && _map && _map.hasLayer(_popup)) {
            _popup.setContent(_popupBuilder());
          }
        });
      }
    }
  }

  function removeFrom(map) {
    if (_layer && map.hasLayer(_layer)) map.removeLayer(_layer);
  }

  function isOn() {
    return _map && _layer && _map.hasLayer(_layer);
  }

  async function toggle(map) {
    if (isOn()) {
      removeFrom(map);
    } else {
      await addTo(map);
    }
  }

  return { init, addTo, removeFrom, isOn, toggle, locate, showSearchPopup };
})();
