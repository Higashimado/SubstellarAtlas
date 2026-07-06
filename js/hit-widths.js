/**
 * hit-widths.js — Shared minimum hover hit-target widths (screen px).
 * Thin lines/glyphs are hard to hover because SVG/Leaflet hit area == stroke
 * width. We lay a transparent "fat" casing over the visible thin line; these are
 * the casing widths — one source of truth so every interactive layer stays
 * comfortable to hover. NOTE: these are SCREEN px; SVG that is viewBox-scaled
 * (the eclipse schematics, rendered at ~316px wide) must convert via *W/316.
 *
 * Coarse pointers get wider casings: a fingertip pad is ~7mm, so the fine
 * values undershoot WCAG 2.2's 24px target floor. Sampled once at load —
 * consumers read at render time and inherit automatically; a convertible that
 * flips input mode mid-session keeps its boot-time widths.
 */
const HIT_COARSE = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

const HitWidths = Object.freeze({
  MIN: HIT_COARSE ? 24 : 12, // baseline thin-line floor: map eclipse curves,
  // schematic moon-path/ecliptic lines, satellite ground tracks
  COMPASS: HIT_COARSE ? 28 : 16, // observer compass direction rays
  ASTERISM: HIT_COARSE ? 40 : 28, // constellation asterism lines
  VERTEX: HIT_COARSE ? 26 : 18, // asterism vertex hit circles (radius px)
});
if (typeof window !== 'undefined') window.HitWidths = HitWidths;
