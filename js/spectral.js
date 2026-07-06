/**
 * spectral.js — Decode a stellar MK spectral string into a localized reading.
 * HYG stores the raw code (e.g. "G9III+...", "A7IV-V") and the info card shows
 * it verbatim; this turns that code into a hover gloss that spells out what it
 * means — colour (main class), luminosity form, and any special modifiers —
 * as one comma-joined phrase in the active locale.
 *
 * The colour word and luminosity word are fused through an i18n template with a
 * {color} slot (e.g. "{color}巨星", "géante {color}") so word order lives in the
 * translation, letting Romance languages post-pose the adjective. The subclass
 * digit is deliberately dropped: it nudges the tint but not the colour word.
 *
 * Public API (Spectral):
 *   tip(sp)     -> localized description ('' when unparseable)
 *   tipAttr(sp) -> ` data-gloss="…"` attribute (escaped), or '' to attach none
 */
const Spectral = (() => {
  const _t =
    typeof I18n !== 'undefined'
      ? I18n.t.bind(I18n)
      : function (k) {
          return k;
        };

  // ---- MK grammar tables ----

  // Roman-numeral luminosity token -> form-template key. Ia/Ib/Iab all read as
  // supergiant; the finer bright/faint split is not worth a separate word here.
  const LUM_MAP = {
    Iab: 'supergiant',
    Ia: 'supergiant',
    Ib: 'supergiant',
    I: 'supergiant',
    II: 'bright_giant',
    III: 'giant',
    IV: 'subgiant',
    V: 'main_sequence',
    VI: 'subdwarf',
    VII: 'white_dwarf',
  };

  // Alternation ordered longest-first so "III" wins before "II"/"I" and "VII"
  // before "VI"/"V"; an optional range tail ("IV-V") is consumed whole so it
  // cannot leak into the modifier scan, but only the earlier end is named.
  const LUM_RE = /(Iab|Ia|Ib|VII|VI|IV|III|II|V|I)(?:\s*[-/]\s*(?:Iab|Ia|Ib|VII|VI|IV|III|II|V|I))?/;

  // ---- Parse ----

  function tip(sp) {
    const raw = (sp || '').trim();
    if (!raw) return '';

    // White dwarfs (DA, DB, DZ…) carry no MK colour word — name them directly.
    if (/^D/i.test(raw)) return _t('spectral.form.white_dwarf');

    const mClass = /^([OBAFGKM])(?:\d(?:\.\d)?)?/i.exec(raw);
    if (!mClass) return '';
    const color = _t('spectral.color.' + mClass[1].toUpperCase());

    // Everything past the class+digit is where luminosity and modifiers live.
    let tail = raw.slice(mClass[0].length);

    let formKey = 'plain';
    const mLum = LUM_RE.exec(tail);
    if (mLum) {
      formKey = LUM_MAP[mLum[1]] || 'plain';
      tail = tail.slice(0, mLum.index) + tail.slice(mLum.index + mLum[0].length);
    }
    const main = _t('spectral.form.' + formKey, { color });

    // Special modifiers, emitted in a fixed order for a stable reading. Strip
    // the multi-character tokens first so their inner letters (comp → c,o,m,p)
    // don't trip the single-letter flags below.
    const hasComposite = /comp/i.test(tail);
    let flags = tail.replace(/comp/gi, '');
    const hasUndetermined = flags.includes('...') || flags.includes('…');
    flags = flags.replace(/\.\.\.|…/g, '');

    const mods = [];
    if (formKey === 'plain') mods.push('unknown_luminosity');
    if (flags.includes('+')) mods.push('binary');
    if (hasComposite) mods.push('composite');
    if (/m/i.test(flags)) mods.push('metallic');
    if (/e/i.test(flags)) mods.push('emission');
    if (/p/i.test(flags)) mods.push('peculiar');
    if (/n/i.test(flags)) mods.push('broad');
    if (flags.includes(':')) mods.push('uncertain');
    if (hasUndetermined) mods.push('undetermined');

    const sep = _t('spectral.sep');
    return [main, ...mods.map((m) => _t('spectral.mod.' + m))].join(sep);
  }

  function tipAttr(sp) {
    const text = tip(sp);
    if (!text) return '';
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return ' data-gloss="' + esc + '"';
  }

  return { tip, tipAttr };
})();

if (typeof window !== 'undefined') window.Spectral = Spectral;
