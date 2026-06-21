# <img src="img/mark.svg" alt="" width="26" valign="middle"> SubstellarAtlas

*The Substellar Atlas* — an interactive world map that projects the entire sky back onto the Earth: every celestial body is drawn at the point it stands directly above, right now.

**English** · [简体中文](zh-Hans/README.md)
<!-- Reserved: 繁體中文 / 日本語 / Français / Español / Italiano — README.<locale> to be added alongside zh-Hans -->

<!-- TODO hero screenshot -->
<!-- TODO live demo URL (GitHub Pages), e.g. https://higashimado.github.io/SubstellarAtlas/ — confirm before publishing -->

> A pure-static, no-build site. Open `index.html` and the whole sky, in real time, is laid over a Leaflet world map — day and night, the Sun, Moon and planets, the stars in both Western and Chinese traditions, eclipses, satellites and more. Available in 7 languages.

---

## Design Philosophy — The Substellar Point & 分野 (Fēnyě)

Every star, at any instant, stands directly above exactly one point on Earth. Draw a line from the star to the Earth's centre; where it pierces the surface is that star's **substellar point** — the place where the star sits at the zenith. (For the Sun this is the more familiar *subsolar point*.) Lay the whole celestial sphere onto the world map by each body's substellar point and you have the foundation of this atlas: the heavens turned inside-out and pressed onto the Earth.

Three rules are worth keeping in mind when reading the map:

- The sky drifts **west** as the Earth turns — the entire star field laps the planet roughly every 23h 56m (one sidereal day).
- Substellar points run **east–west mirrored** relative to a star chart: a chart is drawn looking *in* at the celestial sphere from outside, while we look *out* at the sky from within.
- A substellar point means only *"this body is at this place's zenith right now."* The whole facing hemisphere can see it; the point itself carries no special physical meaning.

This impulse — to ask **which place on Earth a given patch of sky belongs to** — is old. Chinese astronomers codified it as **分野** (*fēnyě*, "field-allocation"): a correspondence binding regions of the sky — the twenty-eight lunar mansions, the star officials (星官, *xīngguān*), the twelve Jupiter-stations — to regions of the realm: the nine provinces and the feudal states. A portent over a sky-region was read as an omen for its earthly counterpart.

分野 was symbolic, and fixed by canon. The substellar point is the *same intuition made exact, live, and computable*: instead of "this mansion is allotted to that province by tradition," you watch precisely which latitude and longitude each star's substellar point sweeps across, moment by moment. This atlas carries the Chinese star officials (星官) as an overlay laid **directly on the substellar grid** — so one map holds both the modern computation and the ancient instinct that anticipated it. East and West alike asked how heaven maps onto the earth; the Substellar Atlas answers in projection.

<!-- TODO 作者定稿:个人表达 / 分野措辞 — about/zh/design.html §三「个人表达」尚为留白,此段宜由作者本人定稿 -->

The visual language is a deliberate homage: multi-culture sky charts after **Stellarium**; eclipse cartography after **Fred Espenak / NASA GSFC**; the typographic grace of classical atlases after Nicholas Rougeux's **_Clavis Cælestis_**; and the information-dense discipline of **Jeppesen** aeronautical charts. The full account lives in the [Design notes](about/zh/design.html).

---

## What Makes It Distinctive

- **Real-time Besselian eclipse shadows.** Every solar eclipse's umbra, penumbra and iso-magnitude contours are solved *in the browser* from Besselian elements — using the **same evaluator as the offline build pipeline** (pinned bit-for-bit to Astronomy Engine 2.1.19) — so the shadow glides with the clock instead of snapping between precomputed frames. Lunar eclipses redden the moonlight veil in proportion to umbral depth.
- **Two constellation traditions.** The 88 IAU figures *and* the Chinese **星官 (xingguan)** system, switchable, each with localised star names.
- **One unifying model — the substellar point.** The Sun, Moon, planets, stars, eclipse central lines and satellite ground tracks are all the same idea: a body drawn where it stands overhead.
- **Antisolar holed-veil rendering.** Day/night and visibility masks are drawn as a world rectangle with night-caps punched out around the *anti*-body point — sidestepping the self-intersecting geometry that breaks naïve great-circle masks at high latitude.
- **Sub-pixel-smooth time playback.** A Leaflet patch removes per-element pixel rounding, so scrubbing the timeline doesn't jitter.
- **An observatory astrolabe compass.** An azimuthal-equidistant overlay at your location, with continuous Sun/Moon arcs, planet glyphs, and pinnable bearing lines.
- **Lapidary, aged-brass engraving.** Serif throughout, tabular figures, an engraved-groove texture — and **all on-screen text is selectable and copyable**.
- **Seven languages with glossary cards.** Terms carry themed, encyclopedia-style definition cards (never the browser's default tooltip), consistent across every locale.

## Features

Aurora oval (NOAA SWPC OVATION) · Light pollution (D. J. Lorenz 2022 VIIRS) · Satellite ground tracks (ISS, CSS, Hubble — CelesTrak TLEs) · Place search (GeoNames) · Celestial search (stars, deep-sky objects, comets, meteor radiants) · Coordinate grids (ecliptic with the 24 solar terms, celestial equator, lunar path, galactic equator) · Time playback with sidereal-correct sky motion · Per-location almanac panel (rise/set, twilight bands, moon, point weather forecast).

**Planned / not yet live:** cloud-cover layer (Open-Meteo grid) — implemented but not yet exposed in the UI.

## Distinctive Data

Catalogs the project **built or derived itself** (as opposed to the third-party feeds it merely cites — see [Credits](#data-sources--credits)):

- **Eclipse dataset** — 112 solar and lunar eclipses (2000–2049) with Besselian elements and four-family ground-envelope curves (umbra / penumbra / iso-magnitude / north–south limits), generated by this project's own pipeline (Astronomy Engine + in-house Besselian tooling + marching-squares). These derived curve sets aren't a download from anywhere else.
- **Multilingual & xingguan star-name corpus** — HIP→name mappings across seven languages, including Chinese star-official (星官) names, compiled here from Stellarium sky-cultures, Wikipedia and manual work.
- **Seven-language UI & glossary corpus** — interface strings plus an encyclopedia-style term glossary, authored across all seven locales.

> Note: HYG, OpenNGC, GeoNames, the Lorenz light-pollution raster, NOAA and CelesTrak feeds are *inputs*, not original data — they appear under Credits. The 24 solar terms are a computed display, not a dataset.

## Tech & Architecture

Pure HTML + CSS + JavaScript — **no build step, no framework**. Canvas + SVG hybrid rendering. Served as static files (GitHub Pages).

| Area | Library |
|---|---|
| Map engine | Leaflet 1.9.4 |
| Astronomy | Astronomy Engine 2.1.19 · SunCalc 1.9.0 |
| Twilight base | Leaflet.Terminator 1.1.0 (heavily extended) |
| Satellites | satellite.js 5.0.0 |
| Lunar calendar | lunar-javascript 1.7.7 |
| Decompression | Pako 2.1.0 |

## Running Locally

```bash
git clone https://github.com/Higashimado/SubstellarAtlas.git
cd SubstellarAtlas
python3 -m http.server 8000
# open http://localhost:8000
```

No build is required to run the site. The `npm run fetch-sky` / `build-sky` / `build` scripts under `tools/` only **regenerate the bundled datasets**.

## Repository Layout

| Path | Contents |
|---|---|
| `index.html` | App entry (root). `en/ zh-Hans/ zh-Hant/ ja/ fr/ es/ it/` are thin language-entry shims. |
| `js/` | Feature modules — map, sky, planets, eclipse, observer, compass, search, i18n… |
| `css/` | Design tokens, styles, self-hosted fonts. |
| `data/` | Star / eclipse / place / sky datasets and i18n dictionaries. |
| `img/` | Engraved planet & UI icons. |
| `about/` | Illustrated *Features · Mechanisms · Design* pages. |
| `docs/` · `tools/` | Developer notes · dataset build pipeline. |

## Data Sources & Credits

This atlas stands on the shoulders of many who shared their work freely. Each project below belongs to its authors and is used under its own license — please consult each source for exact terms.

**Software** — Volodymyr Agafonkin ([Leaflet](https://leafletjs.com/), [SunCalc](https://github.com/mourner/suncalc)) · Don Cross ([Astronomy Engine](https://github.com/cosinekitty/astronomy), MIT) · Olaf Frohn ([d3-celestial](https://github.com/ofrohn/d3-celestial)) · Jörg Dietrich ([Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator)) · Shashwat Kandadai ([satellite.js](https://github.com/shashwatak/satellite-js)) · 6tail ([lunar-javascript](https://github.com/6tail/lunar-javascript)) · [Pako](https://github.com/nodeca/pako).

**Data** — David Nash ([HYG star database](https://www.astronexus.com/projects/hyg)) · Mattia Verga ([OpenNGC](https://github.com/mattiaverga/OpenNGC)) · T. S. Kelso ([CelesTrak](https://celestrak.org/)) · David J. Lorenz ([light-pollution atlas](https://djlorenz.github.io/astronomy/lp/)) · Fred Espenak ([EclipseWise](https://www.eclipsewise.com/)) · [GeoNames](https://www.geonames.org/) (CC BY 4.0) · the [OpenStreetMap](https://www.openstreetmap.org/copyright) community (ODbL) · [NOAA SWPC](https://www.swpc.noaa.gov/) · [JPL](https://ssd.jpl.nasa.gov/) and the [Minor Planet Center](https://www.minorplanetcenter.net/) · the [Stellarium](https://stellarium.org/) sky-cultures community.

**Fonts** — [Source Serif](https://github.com/adobe-fonts/source-serif) & Source Han Serif (Adobe), the [Noto](https://fonts.google.com/noto) family (Google) — all OFL.

## License

The project's own code is released under the **MIT License** © 2026 Higashimado. Third-party code, data and fonts remain under their respective licenses (see Credits above).

## About / Further Reading

The illustrated companion pages: **[Features](about/zh/index.html)** · **[Mechanisms](about/zh/mechanisms.html)** · **[Design](about/zh/design.html)** (currently in Chinese; English editions forthcoming).
