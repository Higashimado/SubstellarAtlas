# <img src="../img/mark.svg" alt="" width="39"> Substellar Atlas

[简体中文](../zh-Hans/README.md) · [繁體中文](../zh-Hant/README.md) · **English** · [Français](../fr/README.md) · [Español](../es/README.md) · [Italiano](../it/README.md) · [日本語](../ja/README.md)

<p align="center">
  <img src="../docs/demo/constellation.png" width="100%">
</p>

**Website**: https://higashimado.github.io/SubstellarAtlas/
The Substellar Atlas is a visualization built on the concept of the *substellar point*. The celestial sphere is projected onto the Earth's surface, and the two are laid together. On this map every celestial body sits at the geographic location of its substellar point, drifting with the Earth and turning slowly with a period of 23h 56m. The interplay of sky and Earth naturally reveals where each kind of astronomical event is visible across the globe: day and night, the planets, comets, deep-sky objects, eclipses, the aurora, artificial satellites and more.

## Concept

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *— Sima Qian, Records of the Grand Historian, "Treatise on the Celestial Offices" (1st c. BCE): as Mercury appears among different lunar mansions at the equinoxes and solstices, each region of the realm (Qi, Chu, Han, the Central States) is allotted its own quarter of the sky. An early articulation of fēnyě.*

<p align="center">
  <img src="../docs/demo/xingguan.png" width="100%">
</p>

The heavens have their constellations; the Earth has its regions. Linking phenomena in the sky to areas on the ground is an idea as old as astronomy and astrology themselves: ancient China mapped the twenty-eight lunar mansions onto the Nine Provinces and the feudal states through **分野** (*fēnyě*, "field-allocation"), while in the Greco-Roman world Ptolemy proposed correspondences between the twelve signs of the zodiac and nations. Some dismissed the scheme as far-fetched, yet it revealed a symmetry and an isomorphism between sky and Earth, a correspondence that has fed the imagination and inquiry of every age since.

Modern geodesy gives this linkage a rigorous form: ```lat = Dec, lon = RA − GMST```. Concretely, a body projected straight down onto the Earth meets the surface at its unique, exactly computable substellar point. Compared with a static world map, the projected star map has these characteristics:

* **Westward rotation**: the star map turns with the celestial sphere over one sidereal day, exactly opposite to the Earth's own rotation, so the stars drift slowly westward across the fixed ground beneath them.
* **East–west mirrored**: the observer looks down on the star map from outside, the opposite of gazing up at the night sky from within, so east and west are flipped relative to ordinary observation.
* **Nearer looms larger**: bodies are drawn at their apparent, not physical, size; the nearby Moon looms far larger than the distant planets.

## Features

### Layers

The base map uses a dark theme: [CARTO Dark Matter](https://github.com/cartodb/basemap-styles) by default, switchable to [Stadia Alidade Smooth Dark](https://docs.stadiamaps.com/map-styles/alidade-smooth-dark/) from the layer control at the top right. The layer control at the top left toggles the data layers built and integrated by the site:

| Category | Layers |
|---|---|
| Stars / Constellations / Xingguan | Stars, deep-sky objects, the Milky Way, meteor showers, constellations / star officials (xingguan) / asterisms, multilingual labels, coordinate reference lines |
| Sun / Moon | Disc rendering, phase rendering, sunlight / moonlight veils |
| Planets / Comets | Disc rendering, phase rendering, Jovian / Saturnian moons, asteroids, comets, event list |
| Eclipses | Event list, visibility range, local circumstances and diagrams |
| Light pollution | Data rendering (D. J. Lorenz) |
| Auroral oval | Data rendering (NOAA SWPC OVATION) |
| Satellites | Data rendering (CelesTrak) |

### Observer's Compass

The **observer's compass** is a tool for reading the bearings of celestial bodies from a particular place. Double-click anywhere on the map to raise and lock it. With the relevant layers turned on, a locked compass can show:
- the sunrise and sunset directions, the Sun's current bearing and its path for the day;
- the moonrise and moonset directions, the Moon's current bearing and its path for the day;
- the full-year envelope of the Sun's daily paths;
- the current bearings of the planets visible in the sky.

Click an icon or label on the compass to extend its **bearing ray**. While the compass is up, clicking a body's substellar point draws the great-circle line from the observer's location to that point. The info panel on the right gives detailed information about the place along with the day's observing data for the Sun, Moon and planets; click a time in the data panel to jump to that instant.

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### Sunlight & Moonlight Veils

Turning on the Sun or Moon layer also brings up its light veil. The sunlight veil is built from four bands of constant brightness, one each for daylight and the civil, nautical and astronomical twilight zones. The moonlight veil instead varies in brightness with the Moon's illumination (brightest at full Moon, all but invisible near the new), and during a lunar eclipse it takes on a rust-red cast that deepens with the umbral magnitude. The layer control at the top right toggles the light veils on and off.

<p align="center">
  <img src="../docs/demo/moonlight.png" width="100%">
</p>

### Celestial Engravings

The Sun, the Moon, the planets and some comets (bodies that show a visible disc) appear on the map as engraving-style icons, drawn in the manner of the engraved plates the British optical-instrument maker and mapmaker [John Browning](https://en.wikipedia.org/wiki/John_Browning_(scientific_instrument_maker)) published in the *Monthly Notices of the Royal Astronomical Society* in 1870. Each disc subtends exactly its apparent diameter on the map and so changes with the body's distance from the Earth; the shadow across the disc is rendered from its phase angle. For Solar System bodies, the rendered size corresponds to apparent diameter as follows:

- the Sun and Moon span at most about 0.53°, roughly 60 km projected onto the Earth's surface, about the size of a giant city;
- Jupiter spans at most about 50″, roughly 1 km on the surface, about the size of a large neighbourhood;
- Uranus spans at most about 4″, roughly 80 m on the surface, about the size of a regulation soccer pitch.


<p align="center">
  <img src="../docs/demo/jupiter_over_hong_kong.png" width="100%">
</p>

### Body Trajectories

The Planets & Comets layer offers a list of conjunction- and opposition-related events, with filters tied to particular bodies; clicking an event jumps to where the body sits at the moment it occurs. On arrival, the planet's or comet's path over the days around the event opens automatically, marking its position on successive dates at a set interval. Click a time label along the trajectory to jump to that instant. Beyond the Moon and the planets, the event list currently covers three of the larger asteroids (Ceres, Pallas, Vesta) and the bright comets discovered between 2000 and 2025 that reach apparent magnitude 6 or brighter (such as [Tsuchinshan–ATLAS](https://en.wikipedia.org/wiki/Comet_Tsuchinshan%E2%80%93ATLAS)).

<p align="center">
  <img src="../docs/demo/planet_tracks.png" width="100%">
</p>

### Eclipse Interaction

When an eclipse is under way, the map shows the pre-loaded envelope curves for its visibility range together with the real-time envelope ring for the instantaneous visibility range. Open the panel on the left for the 2000–2099 list of eclipses; open the panel on the right for the next eclipse visible from the selected location, along with the local circumstances of any eclipse currently in progress.

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

The lunar-eclipse diagram is set against a **shadow map** of the Earth's penumbra and umbra, showing the Moon's passage through them. The solar-eclipse diagram is a **sky-track** of the Sun over the course of the event. Below each diagram are the altitude and azimuth of the Moon or Sun at greatest eclipse and at each contact.

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### Auroral Oval, Light Pollution & Satellites

Alongside the astronomical layers, the project integrates light-pollution, auroral-oval and satellite data, all of which can be overlaid at once. To keep the information from clashing, a layer-conflict mechanism closes incompatible layers automatically. The constellation and light-pollution layers, for instance, cannot be open together. The light-pollution and auroral-oval layers follow the colour conventions of their source sites. The satellite layer draws ground tracks in bronze-green, with the gold stretches marking where a satellite's flare may be seen from the ground. The light-pollution, aurora and satellite sections of the right-hand info panel give detailed observing information. The auroral-oval and satellite data are near-real-time forecasts: once the data are out of date, the layer is locked and greyed out.

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## Datasets

### Eclipses (2000–2099)

The project uses the solar and lunar position vectors from [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 to compute the 226 solar and 228 lunar eclipses between 2000 and 2099. The dataset holds the Besselian elements used to compute each solar eclipse's contact times and positions, along with the ground-envelope curves that describe its coverage (umbral central line, northern and southern umbral limits, iso-magnitude lines, northern and southern penumbral limits, sunrise/sunset maximum-eclipse lines, sunrise/sunset curves and so on); the lunar-eclipse dataset holds only an index.

**Note:** a solar eclipse's real-time shadow and coverage, and a lunar eclipse's coverage, fall outside the dataset: they are rendered in real time by the same algorithms.

**Directory structure**

| File | Contents |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | Solar-eclipse index |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | Lunar-eclipse index |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | Solar-eclipse visibility range |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | Format notes |


### Traditional Chinese Star Names

The project provides a multilingual dataset of traditional Chinese star names indexed by HIP, currently holding 3,035 star names and 312 star-official (xingguan) entries. The entries are based primarily on the traditional Chinese star-name catalogue from the [Stellarium](https://stellarium.org/) community, with supplementary entries drawn from [Yu Zhaohuan's personal site](https://yzhxxzxy.github.io/cn/index.html), [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement), Wikipedia and other crowd-sourced material. The Chinese star-official lines are taken from d3-celestial's sky data. The multilingual translations (English, French, Spanish, Italian) offer both transliterated and meaning-based renderings.

<p align="center">
  <img src="../docs/demo/xingguan_translation_wudizuo.png" width="80%">
</p>

**Directory structure**

| File | Contents |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | Star-official information |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | Star-official lines |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | Traditional star names and translations |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | Star-official names and translations |


### Place Names in Mainland China

The project relies mainly on the cities15000 database from [GeoNames](https://www.geonames.org/) for forward and reverse lookup, but its city coordinates and multilingual names are often incomplete. For mainland China, the project takes the 2023 list of township-level towns from [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage), converts it to JSON and merges it into the GeoNames city database. It also fills in Chinese translations for some GeoNames place names, ensuring Chinese/Japanese bilingual coverage across East Asia.

<p align="center">
  <img src="../docs/demo/place_lookup.png" width="80%">
</p>

**Directory structure**

| File | Contents |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | Augmented place-name database |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | Chinese/Japanese name patches |

## Credits & License

The project's own code is released under the [**GNU General Public License v3.0**](../LICENSE); third-party code, data and fonts remain under their respective licences.

| Purpose | Component (version) | Author / Source | License |
|---|---|---|---|
| Map engine | [Leaflet](https://leafletjs.com/) 1.9.4 | Volodymyr Agafonkin | BSD-2-Clause |
| Map tiles | [OpenStreetMap](https://www.openstreetmap.org/copyright) | OpenStreetMap community | ODbL |
| Day/night terminator | [Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator) 1.1.0 | Jörg Dietrich | MIT |
| Astronomy | [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 | Don Cross | MIT |
| Solar position | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 | Volodymyr Agafonkin | BSD-2-Clause |
| Lunar calendar | [lunar-javascript](https://github.com/6tail/lunar-javascript) 1.7.7 | 6tail | MIT |
| Constellation lines | [d3-celestial](https://github.com/ofrohn/d3-celestial) | Olaf Frohn | BSD |
| Star data | [HYG database](https://www.astronexus.com/projects/hyg) | David Nash | CC BY-SA 4.0 |
| Star data | [Gaia DR3](https://www.cosmos.esa.int/gaia) | ESA / Gaia / DPAC | CC BY-NC 3.0 IGO |
| Traditional Chinese star names | [Stellarium](https://stellarium.org/) | Stellarium community | CC BY-SA |
| Traditional Chinese star names | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | Guanjin0562 | GPL-2.0 |
| Saturn's moons | [TASS 1.7](https://ftp.imcce.fr/pub/ephem/satel/tass17/) | Vienne & Duriez / J. Gajdosik | MIT |
| Comets / Asteroids | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | Public Domain |
| Deep-sky objects | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| Eclipses | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| Light pollution | [Light-pollution atlas](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| Aurora forecast | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | Public Domain |
| Satellite propagation | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| Satellite elements (TLEs) | [CelesTrak](https://celestrak.org/) | T. S. Kelso | Public Domain |
| Place-name lookup | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| Mainland China places | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| Latin fonts | [Spectral](https://fonts.google.com/specimen/Spectral) | Production Type | OFL |
| CJK fonts | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| Inscriptional font | [Cinzel](https://fonts.google.com/specimen/Cinzel) | Natanael Gama | OFL |
| Decompression | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |