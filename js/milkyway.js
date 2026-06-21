/** milkyway.js — Galactic core visibility heatmap overlay. */
const MilkyWay = (() => {
  const STEP = 5; // degrees per cell
  const MAX_HOURS = 7;

  let _map = null;
  let _overlay = null;
  let _overlayShifted = null;
  let _worker = null;
  let _pane = null;
  let _lastDateKey = '';

  function _colorStop(hours) {
    if (hours <= 0) return [0, 0, 0, 0];
    const t = Math.min(hours / MAX_HOURS, 1);
    // Deep blue → green → yellow → red
    let r, g, b;
    if (t < 0.33) {
      const u = t / 0.33;
      r = 20;
      g = Math.round(40 + u * 140);
      b = Math.round(120 - u * 80);
    } else if (t < 0.66) {
      const u = (t - 0.33) / 0.33;
      r = Math.round(20 + u * 200);
      g = Math.round(180 + u * 75);
      b = Math.round(40 - u * 30);
    } else {
      const u = (t - 0.66) / 0.34;
      r = Math.round(220 + u * 35);
      g = Math.round(255 - u * 155);
      b = Math.round(10);
    }
    const a = Math.min(0.15 + t * 0.45, 0.6);
    return [r, g, b, Math.round(a * 255)];
  }

  function _renderCanvas(grid, latMin, latMax, lngMin, lngMax, step) {
    const cols = Math.round((lngMax - lngMin) / step);
    const rows = Math.round((latMax - latMin) / step);
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(cols, rows);
    const d = imgData.data;

    for (let i = 0; i < grid.length; i++) {
      const cell = grid[i];
      const col = Math.round((cell.lng - lngMin) / step);
      const row = Math.round((latMax - cell.lat) / step);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      const [r, g, b, a] = _colorStop(cell.hours);
      const idx = (row * cols + col) * 4;
      d[idx] = r;
      d[idx + 1] = g;
      d[idx + 2] = b;
      d[idx + 3] = a;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL();
  }

  function _applyOverlay(dataURL) {
    const bounds = [
      [-90, -180],
      [90, 180],
    ];
    const boundsPlus = [
      [-90, 180],
      [90, 540],
    ];

    if (_overlay) {
      _overlay.setUrl(dataURL);
      _overlayShifted.setUrl(dataURL);
    } else {
      _overlay = L.imageOverlay(dataURL, bounds, {
        opacity: 0.8,
        pane: 'milkyway',
        interactive: false,
      });
      _overlayShifted = L.imageOverlay(dataURL, boundsPlus, {
        opacity: 0.8,
        pane: 'milkyway',
        interactive: false,
      });
    }
  }

  function _compute(date) {
    const dateKey = date.toISOString().substring(0, 10);
    if (dateKey === _lastDateKey) return;
    _lastDateKey = dateKey;

    if (!_worker) {
      _worker = new Worker('js/milkyway-worker.js');
      _worker.onmessage = function (e) {
        const { grid, lat_min, lat_max, lng_min, lng_max, step } = e.data;
        const dataURL = _renderCanvas(grid, lat_min, lat_max, lng_min, lng_max, step);
        _applyOverlay(dataURL);
        if (_map && _overlay && !_map.hasLayer(_overlay)) {
          _overlay.addTo(_map);
          _overlayShifted.addTo(_map);
        }
      };
    }

    _worker.postMessage({
      lat_min: -70,
      lat_max: 70,
      lng_min: -180,
      lng_max: 180,
      step: STEP,
      date_iso: date.toISOString(),
    });
  }

  function init(map) {
    _map = map;
    if (!_map.getPane('milkyway')) {
      _pane = _map.createPane('milkyway');
      _pane.style.zIndex = 500;
    }
  }

  function addTo(map) {
    if (_overlay) {
      _overlay.addTo(map);
      _overlayShifted.addTo(map);
    }
    _compute(TimeState.current);
  }

  function removeFrom(map) {
    if (_overlay && map.hasLayer(_overlay)) map.removeLayer(_overlay);
    if (_overlayShifted && map.hasLayer(_overlayShifted)) map.removeLayer(_overlayShifted);
  }

  function isOn() {
    return _map && _overlay && _map.hasLayer(_overlay);
  }

  function toggle(map) {
    if (isOn()) {
      removeFrom(map);
    } else {
      if (!_overlay) {
        _compute(TimeState.current);
        // Overlay will be added once worker finishes
      } else {
        addTo(map);
      }
    }
  }

  function onDateChange(date) {
    if (!_map || !isOn()) return;
    _compute(date);
  }

  return { init, addTo, removeFrom, isOn, toggle, onDateChange };
})();
