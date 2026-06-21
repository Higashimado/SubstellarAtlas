/**
 * hit-widths.js — Shared minimum hover hit-target widths (screen px).
 * Thin lines/glyphs are hard to hover because SVG/Leaflet hit area == stroke
 * width. We lay a transparent "fat" casing over the visible thin line; these are
 * the casing widths — one source of truth so every interactive layer stays
 * comfortable to hover. NOTE: these are SCREEN px; SVG that is viewBox-scaled
 * (the eclipse schematics, rendered at ~316px wide) must convert via *W/316.
 */
const HitWidths = Object.freeze({
  MIN: 12, // baseline thin-line floor: map eclipse curves, schematic
  // moon-path/ecliptic lines, satellite ground tracks
  COMPASS: 16, // observer compass direction rays
  ASTERISM: 28, // constellation asterism lines
});
if (typeof window !== 'undefined') window.HitWidths = HitWidths;
