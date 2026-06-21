/** weather.js — Weather data clients: 7Timer ASTRO (single-point) + Open-Meteo grid. */
const Weather = (() => {
  const CACHE_TTL = 6 * 3600 * 1000;

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) {
        localStorage.removeItem(key);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {}
  }

  function oktasToPercent(o) {
    return Math.round(Math.max(0, Math.min(100, ((o - 1) / 8) * 100)));
  }

  const SEEING_ARCSEC = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
  function seeingArcsec(s) {
    return SEEING_ARCSEC[Math.max(0, Math.min(7, s - 1))];
  }

  // ---- Open-Meteo single-point fallback (when 7Timer CORS fails) ----
  function _fetchOMSingle(lat, lng, cb) {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' +
      lat.toFixed(4) +
      '&longitude=' +
      lng.toFixed(4) +
      '&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high' +
      '&forecast_days=8&timezone=UTC';

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        var h = json.hourly;
        var times = h.time || [];
        var points = [];
        for (var i = 0; i < times.length; i += 3) {
          var low = h.cloud_cover_low[i] || 0;
          var mid = h.cloud_cover_mid[i] || 0;
          var high = h.cloud_cover_high[i] || 0;

          var cloudPct = Math.min(100, Math.round((low + mid + high) / 3));
          // Estimate seeing/transparency from cloud cover (rough heuristic)
          var clearness = 1 - cloudPct / 100;
          var seeingRaw = Math.round(1 + (1 - clearness) * 7); // 1=clear→good, 8=cloudy→bad
          var transp = Math.round(1 + clearness * 7); // 1=cloudy→bad, 8=clear→good
          points.push({
            timepoint: i,
            time: new Date(times[i] + ':00Z'),
            cloudPct: cloudPct,
            seeing: seeingArcsec(seeingRaw),
            seeingRaw: seeingRaw,
            transparency: transp,
            liftedIndex: 0,
            precType: 'none',
          });
        }
        cb(null, { init: new Date().toISOString(), points: points, fromFallback: true });
      })
      .catch(function (err) {
        cb(err);
      });
  }

  // ---- 7Timer ASTRO single-point ----
  function fetchAstro(lat, lng, cb) {
    var key = '7t:' + lat.toFixed(2) + ':' + lng.toFixed(2);
    var cached = cacheGet(key);
    if (cached) {
      cb(null, cached);
      return;
    }

    var url =
      'https://www.7timer.info/bin/api.pl' +
      '?lon=' +
      lng.toFixed(4) +
      '&lat=' +
      lat.toFixed(4) +
      '&product=astro&output=json&unit=metric';

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        var s = String(json.init); // "YYYYMMDDHH"
        var initDate = new Date(
          Date.UTC(
            parseInt(s.slice(0, 4), 10),
            parseInt(s.slice(4, 6), 10) - 1,
            parseInt(s.slice(6, 8), 10),
            parseInt(s.slice(8, 10), 10)
          )
        );
        var points = (json.dataseries || []).map(function (pt) {
          return {
            timepoint: pt.timepoint,
            time: new Date(initDate.getTime() + pt.timepoint * 3600000),
            cloudPct: oktasToPercent(pt.cloudcover),
            seeing: seeingArcsec(pt.seeing),
            seeingRaw: pt.seeing,
            transparency: pt.transparency,
            liftedIndex: pt.lifted_index,
            precType: pt.prec_type,
          };
        });
        var data = { init: initDate.toISOString(), points: points };
        cacheSet(key, data);
        cb(null, data);
      })
      .catch(function () {
        _fetchOMSingle(lat, lng, cb);
      }); // CORS fallback
  }

  // ---- bbox-dispatched model selection ----
  // Picks the best regional Open-Meteo model for a given lat/lng.
  // Higher resolution where available, falls back to GFS via best_match.
  function pickModel(lat, lng) {
    if (lat >= 33 && lat <= 43 && lng >= 124 && lng <= 132) return 'kma_ldps'; // 1.5 km Korea
    if (lat >= 22 && lat <= 47 && lng >= 120 && lng <= 150) return 'jma_msm'; // 5 km Japan + box
    if (lat >= 21 && lat <= 53 && lng >= -130 && lng <= -60) return 'gfs_hrrr'; // 3 km USA
    if (lat >= 41 && lat <= 52 && lng >= -5 && lng <= 10) return 'meteofrance_arome_france'; // 1.3 km France
    if (lat >= 30 && lat <= 73 && lng >= -25 && lng <= 45) return 'icon_d2'; // 2 km Europe
    if (lat >= 5 && lat <= 55 && lng >= 70 && lng <= 140) return 'cma_grapes_global'; // 15 km Greater China
    return 'best_match'; // global fallback
  }

  // ---- Open-Meteo grid for cloud layer (bbox-dispatched per model) ----
  function fetchCloudGrid(bounds, stepDeg, cb) {
    var latMin = Math.max(-85, bounds.getSouth());
    var latMax = Math.min(85, bounds.getNorth());
    var lngMin = Math.max(-180, bounds.getWest());
    var lngMax = Math.min(180, bounds.getEast());

    if (latMin >= latMax || lngMin >= lngMax) {
      cb(new Error('Empty bounds'));
      return;
    }

    var step = stepDeg;
    var lats, lngs;

    // Clamp to 5000 points by widening step (Open-Meteo accepts up to ~10k)
    for (var attempt = 0; attempt < 10; attempt++) {
      lats = [];
      lngs = [];
      for (var v = latMin; v <= latMax + 0.001; v += step) lats.push(+v.toFixed(2));
      for (var u = lngMin; u <= lngMax + 0.001; u += step) lngs.push(+u.toFixed(2));
      if (lats.length * lngs.length <= 5000) break;
      step *= 1.5;
    }

    if (!lats.length || !lngs.length) {
      cb(new Error('No grid points in bounds'));
      return;
    }

    var boundsKey = [latMin.toFixed(2), lngMin.toFixed(2), latMax.toFixed(2), lngMax.toFixed(2), step.toFixed(2)].join(
      ':'
    );
    var key = 'om:' + boundsKey;
    var cached = cacheGet(key);
    if (cached) {
      cb(null, cached);
      return;
    }

    // Build flat grid (row-major), bucket each point by its preferred model
    var gridLats = [],
      gridLngs = [];
    var buckets = {}; // model -> { idxs: [...], lats: [...], lngs: [...] }
    for (var li = 0; li < lats.length; li++) {
      for (var ni = 0; ni < lngs.length; ni++) {
        var lat = lats[li],
          lng = lngs[ni];
        var idx = gridLats.length;
        gridLats.push(lat);
        gridLngs.push(lng);
        var model = pickModel(lat, lng);
        if (!buckets[model]) buckets[model] = { idxs: [], lats: [], lngs: [] };
        buckets[model].idxs.push(idx);
        buckets[model].lats.push(lat);
        buckets[model].lngs.push(lng);
      }
    }

    // Pre-allocate result grid with empty arrays
    var grid = gridLats.map(function (lat, i) {
      return { lat: lat, lng: gridLngs[i], low: [], mid: [], high: [] };
    });
    var times = null;

    // Fetch each model bucket in parallel, with auto-fallback to best_match
    // when a bucket returns all-null data (some regional models are broken
    // upstream — e.g. kma_ldps was returning nulls 2026-05-07).
    var bucketKeys = Object.keys(buckets);
    var pending = bucketKeys.length;
    if (pending === 0) {
      cb(new Error('No grid points'));
      return;
    }

    var anyError = null;
    function fetchBucket(model, b, isRetry) {
      var modelParam = model === 'best_match' ? '' : '&models=' + model;
      var url =
        'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' +
        b.lats.join(',') +
        '&longitude=' +
        b.lngs.join(',') +
        '&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high' +
        modelParam +
        '&forecast_days=3&timezone=UTC';

      return fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' (' + model + ')');
          return r.json();
        })
        .then(function (json) {
          var arr = Array.isArray(json) ? json : [json];
          if (!times && arr[0] && arr[0].hourly) times = arr[0].hourly.time;

          // Detect all-null returns from broken upstream
          var allNull = arr.every(function (e) {
            var h = (e && e.hourly) || {};
            var lows = h.cloud_cover_low || [];
            return (
              lows.length === 0 ||
              lows.every(function (v) {
                return v == null;
              })
            );
          });
          if (allNull && !isRetry) {
            console.warn('[Weather] model', model, 'returned all-null; falling back to best_match');
            return fetchBucket('best_match', b, true);
          }

          for (var k = 0; k < arr.length; k++) {
            var h = (arr[k] && arr[k].hourly) || {};
            var gridIdx = b.idxs[k];
            grid[gridIdx].low = (h.cloud_cover_low || []).map(function (v) {
              return v == null ? 0 : v;
            });
            grid[gridIdx].mid = (h.cloud_cover_mid || []).map(function (v) {
              return v == null ? 0 : v;
            });
            grid[gridIdx].high = (h.cloud_cover_high || []).map(function (v) {
              return v == null ? 0 : v;
            });
          }
        });
    }

    bucketKeys.forEach(function (model) {
      fetchBucket(model, buckets[model], false)
        .catch(function (err) {
          console.warn('[Weather] bucket', model, 'failed:', err.message);
          if (!anyError) anyError = err;
        })
        .finally(function () {
          if (--pending === 0) {
            if (
              !times ||
              !grid.some(function (p) {
                return p.low.length;
              })
            ) {
              cb(anyError || new Error('No data'));
              return;
            }
            var data = { time: times, grid: grid, step: step };
            cacheSet(key, data);
            cb(null, data);
          }
        });
    });
  }

  return { fetchAstro, fetchCloudGrid, pickModel };
})();
