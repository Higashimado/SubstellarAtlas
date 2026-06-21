/**
 * glossary-tip.js — Custom glossary tooltip: a themed "definition card" that
 * replaces the white native `title` tooltip for term labels. Term labels carry
 * their definition on a `data-gloss="…"` attribute (emitted by I18n.glossAttr /
 * set directly elsewhere).
 *
 * A single delegated listener on the document drives one shared card element, so
 * it survives the constant re-rendering of info cards (sky/comet/planets/…) without
 * re-binding per element. The card is read-only (pointer-events:none) and styled in
 * css/style.css (.glossary-tip) deliberately distinct from the .map-context-menu so
 * the menu and the explanation never share a look.
 */
(function () {
  'use strict';

  const MARGIN = 8; // gap between the term and the card
  const EDGE = 8; // viewport edge padding for horizontal clamping

  let tip = null;
  let activeEl = null;

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'glossary-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    return tip;
  }

  function position(target) {
    const el = ensureTip();
    const r = target.getBoundingClientRect();
    // Measure after content/visibility so width/height are real.
    const tw = el.offsetWidth;
    const th = el.offsetHeight;

    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Centre horizontally over the term, clamped to the viewport.
    const centre = r.left + r.width / 2;
    let left = centre - tw / 2;
    left = Math.max(EDGE, Math.min(left, vw - tw - EDGE));

    // Prefer above the term; flip below when there isn't room.
    let top = r.top - th - MARGIN;
    const below = top < EDGE && r.bottom + MARGIN + th <= vh - EDGE;
    if (below) top = r.bottom + MARGIN;
    el.classList.toggle('is-below', below);

    // Arrow points back at the term's centre even after horizontal clamping.
    const arrow = Math.max(10, Math.min(centre - left, tw - 10));
    el.style.setProperty('--tip-arrow', arrow + 'px');
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function show(target) {
    // Data-gloss → encyclopedic definition card; data-tip → compact name-label
    // chip (control/layer names). The card style differs via .is-label.
    const text = target.getAttribute('data-gloss') || target.getAttribute('data-tip');
    if (!text) return;
    activeEl = target;
    const el = ensureTip();
    el.classList.toggle('is-label', !target.hasAttribute('data-gloss'));
    el.textContent = text;
    el.style.left = '-9999px'; // render off-screen to measure before placing
    el.classList.add('is-visible');
    position(target);
  }

  function hide() {
    activeEl = null;
    if (tip) tip.classList.remove('is-visible');
  }

  const SELECTOR = '[data-gloss],[data-tip]';

  function onOver(e) {
    const target = e.target.closest && e.target.closest(SELECTOR);
    if (!target || target === activeEl) return;
    show(target);
  }

  function onOut(e) {
    if (!activeEl) return;
    // Hide only when leaving the active term (not when moving within it).
    const to = e.relatedTarget;
    if (to && activeEl.contains(to)) return;
    if (to && to.closest && to.closest(SELECTOR) === activeEl) return;
    hide();
  }

  function init() {
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onOver, true);
    document.addEventListener('focusout', onOut, true);
    // A fixed-position card goes stale on scroll/resize — drop it.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
