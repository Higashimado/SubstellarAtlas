# <img src="../img/mark.svg" alt="" width="39" style="vertical-align: text-bottom"> Substellar Atlas

[简体中文](../zh-Hans/README.md) · [繁體中文](../zh-Hant/README.md) · **English** · [Français](../fr/README.md) · [Español](../es/README.md) · [Italiano](../it/README.md) · [日本語](../ja/README.md)

<p align="center">
  <img src="../docs/demo/world_map.png" width="100%">
</p>

The Substellar Atlas takes the *substellar point* as its guiding idea: it projects the celestial sphere onto the Earth's surface and lays the two together. On this map every celestial body sits at the geographic location of its substellar point, drifting with the Earth and turning slowly with a period of 23h 56m. The interplay of sky and Earth naturally reveals where each kind of astronomical event is visible across the globe — day and night, the planets, deep-sky objects, eclipses, the aurora, artificial satellites and more.

## Concept

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *— Sima Qian, Records of the Grand Historian, "Treatise on the Celestial Offices" (1st c. BCE): as Mercury appears among different lunar mansions at the equinoxes and solstices, each region of the realm — Qi, Chu, Han, the Central States — is allotted its own quarter of the sky. An early articulation of fēnyě.*

<p align="center">
  <img src="../docs/demo/xingguan_wuzhuhou.png" width="100%">
</p>

The heavens have their constellations; the Earth has its regions. Linking phenomena in the sky to areas on the ground is an idea as old as astronomy and astrology themselves: ancient China mapped the twenty-eight lunar mansions onto the Nine Provinces and the feudal states through **分野** (*fēnyě*, "field-allocation"), while in the Greco-Roman world Ptolemy proposed correspondences between the twelve zodiacal signs and nations. Modern geodesy gives this linkage a rigorous form: project a body straight down onto the Earth, and the surface point it meets is its unique, exactly computable substellar point. Compared with a static world map, the projected star map has these characteristics:

* **Westward rotation** — In the frame of the celestial sphere the Earth turns from east to west over one sidereal day, but from the Earth's own point of view the apparent direction is exactly reversed.
* **East–west mirrored** — You look down on the star map from outside, the opposite of gazing up at the night sky from within, so east and west are flipped relative to ordinary observation.
* **Nearer looms larger** — Bodies are drawn at their apparent, not physical, size: the Moon, being close to the Earth, takes up far more area than the planets or deep-sky objects.

## Features

### Layers

The base map uses a dark theme — CARTO Dark Matter by default, with Stadia Alidade Smooth Dark as an alternative. The data layers built or integrated by the site are:

| Category | Layers |
|---|---|
| Stars / constellations / xingguan | Stars, deep-sky objects, meteor showers, constellations / star officials (xingguan) / asterisms, multilingual labels, coordinate grids |
| Sun / Moon / planets | Disc rendering, phase rendering, sunlight / moonlight veils |
| Eclipses | Event list, visibility range, magnitude diagrams |
| Light pollution | Tile rendering (D. J. Lorenz) |
| Auroral oval | Visibility range (NOAA SWPC OVATION) |
| Satellites | Visibility range (CelesTrak) |

### Observer's Compass

Double-click anywhere on the map to raise and lock the **observer's compass**, which shows the directions of sunrise, sunset, moonrise and moonset along with the current positions of the Sun and Moon. The yellow and blue curves are the day's solar and lunar paths. While the compass is locked, clicking a body's icon or label extends its **bearing ray**, and clicking a body's substellar point draws the great-circle line from your location to that point. The info panel on the right gives detailed information about the location and the day's observing data; click a time in the data panel to jump to that instant.

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### Eclipse Interaction

Turning on the eclipse layer opens the eclipse list on the left. Jump from the list to an event's moment and you will see the colored envelope curves that mark the whole event's visibility range, together with the gray envelope ring that marks the real-time visibility range. Press the play button at the bottom right to watch a solar eclipse's visibility range travel over time.

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

The eclipse section of the right-hand info panel provides the **local circumstances** at the selected location. The lunar-eclipse diagram draws the Moon's passage through the Earth's shadow; the solar-eclipse diagram traces the Sun's track across the sky from first to last contact.

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### Layered Overlays

The project supports overlaying data layers from multiple sources at once — light pollution, the auroral oval and satellites, for example — with a layer-conflict mechanism (the constellation and light-pollution layers, say, cannot be open together) that keeps the information from clashing. The satellite layer draws ground tracks in green, marks in gold the stretches where a satellite may flare over the ground twilight zone, and uses a great circle centered on the satellite icon to show its visibility range. The aurora, light-pollution and satellite sections of the right-hand info panel provide detailed observing information.

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## Datasets

### Eclipses (2000–2049)

The solar-eclipse dataset contains the Besselian elements used to compute contact times and positions, along with the ground-envelope curves that describe each event's coverage (umbral central line, northern/southern umbral limits, iso-magnitude lines, northern/southern penumbral limits, sunrise/sunset maximum-eclipse lines, sunrise/sunset curves and so on); the lunar-eclipse dataset holds only an index. It currently covers 112 solar and 114 lunar eclipses between 2000 and 2049. The solar and lunar position vectors used in the computation come from [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19.

**Note:** a solar eclipse's real-time shadow and coverage range, and a lunar eclipse's coverage range, are computed at run time.

**Directory structure**

| File | Contents |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | Solar-eclipse index |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | Lunar-eclipse index |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | Solar-eclipse visibility range |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | Format notes |


### Traditional Chinese Star Names

The project provides a multilingual dataset of traditional Chinese star names indexed by HIP, currently holding 3,035 traditional star names and 312 star-official (xingguan) entries. The entries are based primarily on the traditional Chinese star-name catalog from the [Stellarium](https://stellarium.org/) community, with supplementary entries drawn from [Yu Zhaohuan's personal site](https://yzhxxzxy.github.io/cn/index.html), [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement), Wikipedia and other crowd-sourced material. The Chinese star-official lines are taken from d3-celestial's sky data. The multilingual translations (English, French, Spanish, Italian) offer both transliterated and meaning-based renderings.

**Directory structure**

| File | Contents |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | Star-official information |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | Star-official lines |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | Traditional star names and translations |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | Star-official names and translations |


### Place Names in Mainland China

The project relies mainly on the cities15000 database from [GeoNames](https://www.geonames.org/) for forward and reverse lookup, but its city coordinates and multilingual names are often incomplete. For mainland China, the project takes the 2023 list of towns and townships from [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) as a base, converts it to JSON and merges it into the GeoNames city database. It also fills in Chinese translations for some GeoNames place names, ensuring Chinese/Japanese bilingual coverage across East Asia.

| File | Contents |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | Augmented place-name database |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | Chinese/Japanese name patches |

## Credits & License

The project's own code is released under the **GNU General Public License v3.0**; see [LICENSE](../LICENSE) for details. Third-party code, data and fonts remain under their respective licenses.

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
| Traditional Chinese star names | [Stellarium](https://stellarium.org/) | Stellarium community | CC BY-SA |
| Traditional Chinese star names | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | Guanjin0562 | GPL-2.0 |
| Comets / asteroids | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | Public Domain |
| Deep-sky objects | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| Eclipses | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| Light pollution | [Light-pollution atlas](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| Aurora forecast | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | Public Domain |
| Satellite propagation | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| Satellite elements (TLEs) | [CelesTrak](https://celestrak.org/) | T. S. Kelso | Public Domain |
| Place-name lookup | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| Mainland China places | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| Latin fonts | [Source Serif](https://github.com/adobe-fonts/source-serif) | Adobe | OFL |
| CJK fonts | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| Decompression | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |
