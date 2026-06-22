# <img src="img/mark.svg" alt="" width="39" style="vertical-align: text-bottom"> 星下点地图 · Substellar Atlas

[简体中文](zh-Hans/README.md) · [繁體中文](zh-Hant/README.md) · [English](en/README.md) · [Français](fr/README.md) · [Español](es/README.md) · [Italiano](it/README.md) · [日本語](ja/README.md)

<p align="center">
  <img src="docs/demo/world_map.png" width="100%">
</p>

星下点地图是以“星下点”为灵感，将天球投影到地球表面后相叠而成的地图。在星下点地图中，每个天体都处在其星下点所对应的地理位置上，跟随着地球，以 23 时 56 分为周期缓慢旋转。天球与地球的交互，可以自然地展示各类天文事件在地球上的可见范围，例如昼夜、行星、深空天体、日月食、极光和人造卫星等。

The Substellar Atlas takes the *substellar point* as its guiding idea: it projects the celestial sphere onto the Earth's surface and lays the two together. On this map every celestial body sits at the geographic location of its substellar point, drifting with the Earth and turning slowly with a period of 23h 56m. The interplay of sky and Earth naturally reveals where each kind of astronomical event is visible across the globe — day and night, the planets, deep-sky objects, eclipses, the aurora, artificial satellites and more.

## 概念设计

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》

<p align="center">
  <img src="docs/demo/xingguan_wuzhuhou.png" width="100%">
</p>

天有列宿，地有州域。将天空中的现象与地理上的区域联系起来，是天文学和占星学自起源之初就存在的概念：古代中国有二十八宿对九州郡国的“分野”，希腊-罗马的托勒密亦提出过黄道十二宫与国家的对应关系。现代测地学为这种联系给出了更严谨的对应关系：将天体沿垂线投影到地球上，其对应的点地表点便是唯一的、可精确计算的星下点。相对于静置的世界地图，被投影下的星图有如下特点：

* 向西旋转：以天球为参考系，地球自东向西以恒星日为周期旋转，但从地球的视角来看旋转方向恰好相反
* 东西反向：使用者的视角在星图外侧向下观察，与日常观测夜空时，从星空内侧向上观察的东西方向相反
* 近大远小：天体呈现的是视觉大小而非真实大小，离地球较近的月亮的面积占比要远大于行星和深空天体

## 特色功能

### 图层说明

地图图层采用暗色主题，默认 CARTO Dark Matter，可切换 Stadia Alidade Smooth Dark．网站开发/集成的数据图层则有：

| 类别 | 功能 |
|---|---|
| 星空/星座/星官 | 恒星、深空天体、流星雨、星座/星官/星群、多语言标签、坐标格网 |
| 太阳/月亮/行星 | 盘面、相位渲染、日光/月光蒙版 |
| 日月食 | 事件列表、见食范围、食况图 |
| 光污染 | 瓦片渲染（D.J. Lorenz） |
| 极光卵 | 可见范围（NOAA SWPC OVATION） |
| 人造卫星 | 可见范围（CelesTrak） |

### 观测者罗盘

双击地图上的任意点可触发并锁定**观测者罗盘**，其显示日出、日落、月出、月落方向及当前时刻的太阳和月亮位置。罗盘上的黄色、蓝色曲线分别为当日的日行迹、月行迹。罗盘锁定时，单击对应天体图标或标签可显示延长**方位射线**，单击天体星下点可显示该地点到星下点的大圆连线。右侧信息栏则提供了地点的详细信息和当日观测数据，单击数据栏中的时间可跳转至对应时刻。

<p align="center">
  <img src="docs/demo/compass_sunrise.png" width="100%">
</p>

### 日月食交互

打开日月食图层可拉开左侧的日月食列表，从列表跳转到对应事件发生时刻，可见由彩色渲染、表征整起事件可见范围的包络曲线，以及由灰色渲染、表征实时可见范围的包络圈。点击右下播放按钮可见日食可见范围随时间移动。

<p align="center">
  <img src="docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

右侧信息栏的日月食板块提供选定地点上的**食况详情**。其中，月食食况图绘制月面穿过地影的情况，日食食况图绘制太阳从食始到食终经过天空的轨迹图。

<p align="center">
  <img src="docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### 多图层叠加

本项目支持多源数据图层的同时叠加，例如光污染图层、极光卵图层和卫星图层，并引入图层冲突机制（例如，星座图层和光污染图层不可同时打开）避免信息干扰。卫星图层以绿色显示卫星轨迹，在地面曙暮光范围上可能存在卫星闪光的轨迹则以金色标示，以卫星图标为圆心的大圆则表示其可见范围。右侧信息栏的极光、光污染和卫星板块则提供了详细的观测信息。

<p align="center">
  <img src="docs/demo/multi_layers.png" width="100%">
</p>

## 数据集

### 日月食（2000–2049 年）

本项目提供的日食数据集含用于计算日食事件接触时刻、位置的贝塞尔元素，以及表征整起事件食况范围的地面包络曲线（本影中心线、本影南北限、等食分线、半影南北线、日出/日落极大食线、日出日落圈等），月食数据集则仅含索引。现收录 2000–2049 年间的 112 次日食和 114 次月食。计算中使用到的太阳、月球位置矢量来自 [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19．

**注**：日食的实时阴影和食况范围，以及月食的食况范围在运行时计算

**目录结构**

| 文件 | 内容 |
|---|---|
| [`data/eclipses/solar.json`](data/eclipses/solar.json) | 日食索引 |
| [`data/eclipses/lunar.json`](data/eclipses/lunar.json) | 月食索引 |
| [`data/eclipses/events/`](data/eclipses/events/) `<date>.json` | 日食见食范围 |
| [`data/eclipses/README.md`](data/eclipses/README.md) | 格式说明 |


### 中国传统星名

本项目提供以 HIP 为索引的多语言中国传统星名数据集，现收录 3035 条中国传统星名和 312 项星官条目。条目的来源主题为 [Stellarium](https://stellarium.org/) 社区提供的中国传统星名名录，部分补充条目参考自[余钊焕的个人网站](https://yzhxxzxy.github.io/cn/index.html)、[Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) 及维基百科等众源资料。中国星官连线取自 d3-celestial 的星空数据。多语言翻译（含英语、法语、西班牙语、意大利语）提供了音译和意译两种译法。

**目录结构**

| 文件 | 内容 |
|---|---|
| [`data/sky/names.cn.json`](data/sky/names.cn.json) | 星官信息 |
| [`data/sky/lines.cn.geojson`](data/sky/lines.cn.geojson) | 星官连线 |
| [`data/sky/i18n/`](data/sky/i18n/) `<locale>/stars.json` | 中国传统星名及多语言翻译 |
| [`data/sky/i18n/`](data/sky/i18n/) `<locale>/constellations.cn.json` | 中国星官名及多语言翻译 |


### 中国大陆地名

本项目主要使用 [GeoNames](https://www.geonames.org/) 提供的 cities15000 城市数据库提供正反查询功能，然而其城市坐标及多语言名称多有缺失。在中国大陆地区，本项目以 [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) 提供的 2023 年中国大陆乡镇列表为基础，将其转换至 json 格式合并入 GeoNames 城市数据库中。同时，本项目还增补了 GeoNames 城市数据库中部分地名的中文翻译，在东亚地区保证了地名的中文/日文双语互译。

| 文件 | 内容 |
|---|---|
| [`data/places/cities.json.gz`](data/places/cities.json.gz) | 增补后地名库 |
| [`data/places/name-patches.json`](data/places/name-patches.json) | 中文/日文补名 |

## 致谢和许可

本项目自有代码以 **GNU General Public License v3.0** 发布，详情参见 [LICENSE](LICENSE)． 第三方代码、数据、字体依其许可。

| 用途 | 组件 (版本) | 作者 / 来源 | 许可 |
|---|---|---|---|
| 地图引擎 | [Leaflet](https://leafletjs.com/) 1.9.4 | Volodymyr Agafonkin | BSD-2-Clause |
| 地图瓦片 | [OpenStreetMap](https://www.openstreetmap.org/copyright) | OpenStreetMap 社区 | ODbL |
| 蒙版分割 | [Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator) 1.1.0 | Jörg Dietrich | MIT |
| 天文计算 | [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 | Don Cross | MIT |
| 太阳计算 | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 | Volodymyr Agafonkin | BSD-2-Clause |
| 农历历法 | [lunar-javascript](https://github.com/6tail/lunar-javascript) 1.7.7 | 6tail | MIT |
| 星座连线 | [d3-celestial](https://github.com/ofrohn/d3-celestial) | Olaf Frohn | BSD |
| 恒星数据 | [HYG 星表](https://www.astronexus.com/projects/hyg) | David Nash | CC BY-SA 4.0 |
| 中国传统星名 | [Stellarium](https://stellarium.org/) | Stellarium 社区 | CC BY-SA |
| 中国传统星名 | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | 观津邀月 | GPL-2.0 |
| 彗星 / 小行星 | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | 公有领域 |
| 深空天体 | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| 日月食 | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| 光污染 | [光污染图集](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| 极光预报 | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | 公有领域 |
| 卫星轨道计算 | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| 卫星轨道根数 | [CelesTrak](https://celestrak.org/) | T. S. Kelso | 公有领域 |
| 地名检索 | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| 中国大陆地名 | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| 西文字体 | [Source Serif](https://github.com/adobe-fonts/source-serif) | Adobe | OFL |
| CJK 字体 | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| 数据解压 | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |

---

<p align="center">
  <img src="docs/demo/world_map.png" width="100%">
</p>

The Substellar Atlas takes the *substellar point* as its guiding idea: it projects the celestial sphere onto the Earth's surface and lays the two together. On this map every celestial body sits at the geographic location of its substellar point, drifting with the Earth and turning slowly with a period of 23h 56m. The interplay of sky and Earth naturally reveals where each kind of astronomical event is visible across the globe — day and night, the planets, deep-sky objects, eclipses, the aurora, artificial satellites and more.

### Concept

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *— Sima Qian, Records of the Grand Historian, "Treatise on the Celestial Offices" (1st c. BCE): as Mercury appears among different lunar mansions at the equinoxes and solstices, each region of the realm — Qi, Chu, Han, the Central States — is allotted its own quarter of the sky. An early articulation of fēnyě.*

<p align="center">
  <img src="docs/demo/xingguan_wuzhuhou.png" width="100%">
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
  <img src="docs/demo/compass_sunrise.png" width="100%">
</p>

### Eclipse Interaction

Turning on the eclipse layer opens the eclipse list on the left. Jump from the list to an event's moment and you will see the colored envelope curves that mark the whole event's visibility range, together with the gray envelope ring that marks the real-time visibility range. Press the play button at the bottom right to watch a solar eclipse's visibility range travel over time.

<p align="center">
  <img src="docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

The eclipse section of the right-hand info panel provides the **local circumstances** at the selected location. The lunar-eclipse diagram draws the Moon's passage through the Earth's shadow; the solar-eclipse diagram traces the Sun's track across the sky from first to last contact.

<p align="center">
  <img src="docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### Layered Overlays

The project supports overlaying data layers from multiple sources at once — light pollution, the auroral oval and satellites, for example — with a layer-conflict mechanism (the constellation and light-pollution layers, say, cannot be open together) that keeps the information from clashing. The satellite layer draws ground tracks in green, marks in gold the stretches where a satellite may flare over the ground twilight zone, and uses a great circle centered on the satellite icon to show its visibility range. The aurora, light-pollution and satellite sections of the right-hand info panel provide detailed observing information.

<p align="center">
  <img src="docs/demo/multi_layers.png" width="100%">
</p>

## Datasets

### Eclipses (2000–2049)

The solar-eclipse dataset contains the Besselian elements used to compute contact times and positions, along with the ground-envelope curves that describe each event's coverage (umbral central line, northern/southern umbral limits, iso-magnitude lines, northern/southern penumbral limits, sunrise/sunset maximum-eclipse lines, sunrise/sunset curves and so on); the lunar-eclipse dataset holds only an index. It currently covers 112 solar and 114 lunar eclipses between 2000 and 2049. The solar and lunar position vectors used in the computation come from [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19.

**Note:** a solar eclipse's real-time shadow and coverage range, and a lunar eclipse's coverage range, are computed at run time.

**Directory structure**

| File | Contents |
|---|---|
| [`data/eclipses/solar.json`](data/eclipses/solar.json) | Solar-eclipse index |
| [`data/eclipses/lunar.json`](data/eclipses/lunar.json) | Lunar-eclipse index |
| [`data/eclipses/events/`](data/eclipses/events/) `<date>.json` | Solar-eclipse visibility range |
| [`data/eclipses/README.md`](data/eclipses/README.md) | Format notes |


### Traditional Chinese Star Names

The project provides a multilingual dataset of traditional Chinese star names indexed by HIP, currently holding 3,035 traditional star names and 312 star-official (xingguan) entries. The entries are based primarily on the traditional Chinese star-name catalog from the [Stellarium](https://stellarium.org/) community, with supplementary entries drawn from [Yu Zhaohuan's personal site](https://yzhxxzxy.github.io/cn/index.html), [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement), Wikipedia and other crowd-sourced material. The Chinese star-official lines are taken from d3-celestial's sky data. The multilingual translations (English, French, Spanish, Italian) offer both transliterated and meaning-based renderings.

**Directory structure**

| File | Contents |
|---|---|
| [`data/sky/names.cn.json`](data/sky/names.cn.json) | Star-official information |
| [`data/sky/lines.cn.geojson`](data/sky/lines.cn.geojson) | Star-official lines |
| [`data/sky/i18n/`](data/sky/i18n/) `<locale>/stars.json` | Traditional star names and translations |
| [`data/sky/i18n/`](data/sky/i18n/) `<locale>/constellations.cn.json` | Star-official names and translations |


### Place Names in Mainland China

The project relies mainly on the cities15000 database from [GeoNames](https://www.geonames.org/) for forward and reverse lookup, but its city coordinates and multilingual names are often incomplete. For mainland China, the project takes the 2023 list of towns and townships from [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) as a base, converts it to JSON and merges it into the GeoNames city database. It also fills in Chinese translations for some GeoNames place names, ensuring Chinese/Japanese bilingual coverage across East Asia.

| File | Contents |
|---|---|
| [`data/places/cities.json.gz`](data/places/cities.json.gz) | Augmented place-name database |
| [`data/places/name-patches.json`](data/places/name-patches.json) | Chinese/Japanese name patches |

## Credits & License

The project's own code is released under the **GNU General Public License v3.0**; see [LICENSE](LICENSE) for details. Third-party code, data and fonts remain under their respective licenses.

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
