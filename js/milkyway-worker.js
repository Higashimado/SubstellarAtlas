/**
 * milkyway-worker.js — Offscreen computation of galactic core visibility hours.
 * Receives: { lat_min, lat_max, lng_min, lng_max, step, date_iso }
 * Returns:  { grid: [{lat, lng, hours}...] }
 */

const DEG = Math.PI / 180;
const SGR_A_RA_H = 17.761; // hours
const SGR_A_DEC = -29.01; // degrees

function julianDate(d) {
  return d.getTime() / 86400000 + 2440587.5;
}

function gmstDeg(jd) {
  const T = (jd - 2451545.0) / 36525;
  return (280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000) % 360;
}

function sunAltitude(jd, lat, lng) {
  const T = (jd - 2451545.0) / 36525;
  const L = (280.46646 + 36000.76983 * T) * DEG;
  const M = (357.52911 + 35999.05029 * T) * DEG;
  const eLon = L + (1.9146 * Math.sin(M) + 0.02) * DEG;
  const eps = 23.439 * DEG;
  const sinDec = Math.sin(eps) * Math.sin(eLon);
  const dec = Math.asin(sinDec);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(eLon), Math.cos(eLon));
  const gmst = gmstDeg(jd) * DEG;
  const ha = gmst + lng * DEG - ra;
  const sinAlt = Math.sin(lat * DEG) * Math.sin(dec) + Math.cos(lat * DEG) * Math.cos(dec) * Math.cos(ha);
  return Math.asin(sinAlt) / DEG;
}

function objectAltitude(jd, lat, lng, raH, decDeg) {
  const gmst = gmstDeg(jd);
  const ha = (gmst + lng - raH * 15) * DEG;
  const sinAlt =
    Math.sin(lat * DEG) * Math.sin(decDeg * DEG) + Math.cos(lat * DEG) * Math.cos(decDeg * DEG) * Math.cos(ha);
  return Math.asin(sinAlt) / DEG;
}

function moonIllumFraction(jd) {
  const T = (jd - 2451545.0) / 36525;
  const D = (297.8501921 + 445267.1114034 * T) * DEG;
  const M = (357.5291092 + 35999.0502909 * T) * DEG;
  const Mp = (134.9633964 + 477198.8675055 * T) * DEG;
  const i = Math.acos(Math.cos(D) * Math.cos(6.289 * DEG * Math.sin(Mp)));
  return (1 - Math.cos(i)) / 2;
}

function computeCell(lat, lng, baseJD) {
  // Sample 24h from local midnight, every 15 min (96 steps)
  const steps = 96;
  const stepDays = 1 / steps;
  // Local midnight JD: subtract lng/360 days offset
  const midnightJD = Math.floor(baseJD - lng / 360 + 0.5) + lng / 360;

  let visibleHours = 0;
  const moonIllum = moonIllumFraction(midnightJD);

  for (let s = 0; s < steps; s++) {
    const jd = midnightJD + s * stepDays;
    const sunAlt = sunAltitude(jd, lat, lng);
    if (sunAlt > -18) continue; // Not astronomical night

    const coreAlt = objectAltitude(jd, lat, lng, SGR_A_RA_H, SGR_A_DEC);
    if (coreAlt < 10) continue; // Core too low

    // Penalize moonlight: if moon illumination > 40%, halve the weight
    const weight = moonIllum > 0.4 ? 0.5 : 1.0;
    visibleHours += (24 / steps) * weight;
  }

  return visibleHours;
}

self.onmessage = function (e) {
  const { lat_min, lat_max, lng_min, lng_max, step, date_iso } = e.data;
  const baseDate = new Date(date_iso);
  const baseJD = julianDate(baseDate);

  const grid = [];

  for (let lat = lat_max; lat >= lat_min; lat -= step) {
    for (let lng = lng_min; lng < lng_max; lng += step) {
      const hours = computeCell(lat, lng, baseJD);
      grid.push({ lat, lng, hours });
    }
  }

  self.postMessage({ grid, lat_min, lat_max, lng_min, lng_max, step });
};
