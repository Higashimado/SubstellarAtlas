# <img src="img/mark.svg" alt="" width="39" style="vertical-align: text-bottom"> 星下点地图 · Substellar Atlas

[简体中文](zh-Hans/README.md) · [繁體中文](zh-Hant/README.md) · [English](en/README.md) · [Français](fr/README.md) · [Español](es/README.md) · [Italiano](it/README.md) · [日本語](ja/README.md)

<p align="center">
  <img src="docs/demo/world_map.png" width="100%">
</p>

**网站链接**：https://higashimado.github.io/SubstellarAtlas/

星下点地图是以“星下点”为概念来源，将天球与地球表面相叠后制成的地图。在星下点地图中，每个天体都被投影到其星下点所对应的地理位置上，跟随地球以 23 时 56 分为周期缓慢旋转。天球与地球的交互，可以自然地展示各类天文事件在地球上的可见范围，例如昼夜、行星、深空天体、日月食、极光和人造卫星等。

The Substellar Atlas is a visualization built on the concept of the *substellar point*. The celestial sphere is projected onto the Earth's surface, and the two are laid together. On this map every celestial body sits at the geographic location of its substellar point, drifting with the Earth and turning slowly with a period of 23h 56m. The interplay of sky and Earth naturally reveals where each kind of astronomical event is visible across the globe: day and night, the planets, deep-sky objects, eclipses, the aurora, artificial satellites and more.

## 概念设计

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》

<p align="center">
  <img src="docs/demo/xingguan_wuzhuhou.png" width="100%">
</p>

天有列宿，地有州域。天空中的现象和地理上的区域之间的联系，是自天文学和占星学诞生之初就存在的概念：古代中国有二十八宿对九州郡国的“分野”之说，希腊-罗马的托勒密提出过黄道十二宫与国家的对应关系。尽管有“支离穿凿”的评价，但其展示的天文与地理之间的对称和同构，仍是后世诸多想象与思考的来源。

现代测地学为天球与地球给出了一种更严谨的对应关系：```lat = Dec, lon = RA − GMST```．︀具体地说，将天体沿垂线投影到地球上，落得的地表点便是唯一的、可精确计算的星下点。相对于静置的世界地图，被投影的星图有如下特点：

* 向西旋转：星图随天球自西向东以恒星日为周期旋转，与地球自身的自转方向恰好相反
* 东西反向：使用者从星图外侧向下观察，与地面观测者从星空内侧向上的视角东西反向
* 近大远小：天体呈现的是视觉大小而非真实大小，离地球较近的月亮的面积占比要远大于行星和深空天体

## 特色功能

### 图层说明

地图图层采用暗色主题，默认为 [CARTO Dark Matter](https://github.com/cartodb/basemap-styles)，通过右上角的图层选项可切换 [Stadia Alidade Smooth Dark](https://docs.stadiamaps.com/map-styles/alidade-smooth-dark/)．

左上角的图层选项可用于切换网站开发/集成的数据图层，目前共有：

| 类别 | 功能 |
|---|---|
| 星空/星座/星官 | 恒星、深空天体、流星雨、星座/星官/星群、多语言标签、坐标参考线 |
| 太阳/月亮/行星 | 盘面、相位渲染、日光/月光蒙版 |
| 日月食 | 事件列表、见食范围、食况信息与食况图 |
| 光污染 | 数据渲染（D.J. Lorenz） |
| 极光卵 | 数据渲染（NOAA SWPC OVATION） |
| 人造卫星 | 数据渲染（CelesTrak） |

### 观测者罗盘

观测者罗盘是为特定地点的用户提供天体方位参考的工具，使用者可通过双击地图上的任意地点触发并锁定。在相应图层打开后，锁定后的观测者罗盘能够显示：
- 日出、日落方向、太阳的当前方位及当日运行轨迹
- 月出、月落方向、月亮的当前方位及当日运行轨迹
- 全年的太阳运行轨迹范围
- 天空中可见行星的当前方位

单击罗盘中的图标或标签可显示相应的**方位射线**。罗盘出现时，单击天体星下点可显示该地点到星下点的大圆连线。右侧信息栏则提供了详细的地点信息，以及当日的日、月、行星观测数据，单击数据栏中的时间可跳转至对应时刻。

<p align="center">
  <img src="docs/demo/compass_sunrise.png" width="100%">
</p>

### 日月食交互

日月食发生时，地图上会展示预载入的可见范围包络曲线，以及实时计算的瞬时可见范围包络圈。拉开左侧信息栏可见 2000–2049 年的日月食列表，拉开右侧信息栏则可见选定地点上下一次可见日月食的信息，以及正在发生的可见日月食的食况详情。

<p align="center">
  <img src="docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

月食的食况图以**地影图**为背景，展示月亮穿过地球半影和本影的情况。日食的食况图则是事件期间太阳在天空中的**轨迹图**。食况图下方展示了极大时刻与各接触时刻，月亮或太阳的高度角和方位角。

<p align="center">
  <img src="docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### 日月光蒙版

在打开太阳、月亮图层时，日月光蒙版也随之自动打开。日光蒙版以四层恒定的亮度叠加，分别对应白昼、民用曙光、航海曙光和天文曙光的可见范围。月光蒙版的亮度则随月照亮度线性变化，满月时最亮，亏相时接近不可见。月食发生时，月光蒙版会随本影食分的大小而染上岩红色。右上角的图层选项提供了日月光蒙版的开关。

<p align="center">
  <img src="docs/demo/moonlight.png" width="100%">
</p>

### 天体版画

太阳、月亮和各行星等可见盘面的天体在地图中以版画图标的形式展示，画风参考了英国光学仪器制造商兼制图师 [John Browning](https://en.wikipedia.org/wiki/John_Browning_(scientific_instrument_maker)) 在 1870 年发布于《皇家天文学会月报》上的版画插图。天体盘面在地图上所占的角度大小与其视直径严格一致，会随其相对地球的距离而发生变化。天体盘面上的阴影范围则按其相位角计算渲染。具体地，太阳系内天体在地图上的渲染大小与其视直径的对应关系为：

- 太阳与月亮的视直径最大约 0.53°，投影到地球表面约 60 km，相当于一座巨型城市
- 木星的视直径最大约 50″，投影到地球表面约 1 km，相当于一个大型社区
- 天王星的视直径最大约 4″，投影到地球表面约 80 m，相当于一座标准足球场


<p align="center">
  <img src="docs/demo/jupiter_over_hong_kong.png" width="100%">
</p>

### 黄道刻度

为给太阳等天体的位置提供参考，网站绘制了黄道、赤道、白道、银道等坐标参考线，可以在右上角的图层选项中选择打开或关闭。作为太阳所在的参考线，黄道以双线铜带的风格绘制，铜带中标注二十四节气对应黄经，以及间隔 1° 的黄经刻度。鼠标悬浮在节气标签上时，可见下次节气对应的具体时刻。打开星官图层，可见二十八宿围绕在黄道周围。

<p align="center">
  <img src="docs/demo/eclipse_belt.png" width="100%">
</p>

### 图层叠加

除天文图层外，本项目还集成了光污染、极光卵和人造卫星数据，并支持叠加展示。为避免信息干扰，部分图层间引入有冲突机制（例如，星座图层和光污染图层不可同时打开）。光污染图层和极光卵图层的颜色约定与数据源网站一致。卫星图层以铜绿色显示卫星轨迹，其中的金色段则是地面上可见卫星闪光的轨迹。右侧信息栏的光污染、极光和卫星板块则提供了详细的观测信息。需要注意的是，极光卵和人造卫星数据均为近实时预测，数据超期后的图层会被锁定为灰色。

<p align="center">
  <img src="docs/demo/multi_layers.png" width="100%">
</p>

## 数据集

### 日月食（2000–2049 年）

本项目以 [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 提供的太阳、月球位置矢量计算了 2000–2049 年间的 112 次日食和 114 次月食。数据集包含有用于计算日食事件接触时刻、位置的贝塞尔元素，以及表征整起事件食况范围的地面包络曲线（本影中心线、本影南北限、等食分线、半影南北线、日出/日落极大食线、日出日落圈等），月食数据集则仅含索引。

**注**：日食的实时阴影和食况范围以及月食的食况范围不在数据集范围内，其渲染是通过相同算法实时计算

**目录结构**

| 文件 | 内容 |
|---|---|
| [`data/eclipses/solar.json`](data/eclipses/solar.json) | 日食索引 |
| [`data/eclipses/lunar.json`](data/eclipses/lunar.json) | 月食索引 |
| [`data/eclipses/events/`](data/eclipses/events/) `<date>.json` | 日食见食范围 |
| [`data/eclipses/README.md`](data/eclipses/README.md) | 格式说明 |


### 中国传统星名

本项目提供以 HIP 为索引的多语言中国传统星名数据集，现收录 3035 条中国传统星名和 312 项星官条目。条目的来源主题为 [Stellarium](https://stellarium.org/) 社区提供的中国传统星名名录，部分补充条目参考自[余钊焕的个人网站](https://yzhxxzxy.github.io/cn/index.html)、[Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) 及维基百科等众源资料。中国星官连线取自 d3-celestial 的星空数据。多语言翻译（含英语、法语、西班牙语、意大利语）提供了音译和意译两种译法。

<p align="center">
  <img src="docs/demo/xingguan_translation_wudizuo.png" width="80%">
</p>

**目录结构**

| 文件 | 内容 |
|---|---|
| [`data/sky/names.cn.json`](data/sky/names.cn.json) | 星官信息 |
| [`data/sky/lines.cn.geojson`](data/sky/lines.cn.geojson) | 星官连线 |
| [`data/sky/i18n/`](data/sky/i18n/) `<locale>/stars.json` | 中国传统星名及多语言翻译 |
| [`data/sky/i18n/`](data/sky/i18n/) `<locale>/constellations.cn.json` | 中国星官名及多语言翻译 |


### 中国大陆地名

本项目的地名正反查询功能主要由 [GeoNames](https://www.geonames.org/) 提供的 cities15000 城市数据集支持。然而， cities15000 中的城市坐标及多语言名称多有缺失。为此，本项目在中国大陆地区增补了 [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) 中的 2023 年中国大陆乡镇列表，将其转换至 json 格式合并入 GeoNames 城市数据库中。此外，本项目还填补了 cities15000 中部分地名的中文翻译缺失，并在东亚地区保证了地名的中文/日文的双语互译。

<p align="center">
  <img src="docs/demo/place_lookup.png" width="80%">
</p>

**目录结构**

| 文件 | 内容 |
|---|---|
| [`data/places/cities.json.gz`](data/places/cities.json.gz) | 增补后地名库 |
| [`data/places/name-patches.json`](data/places/name-patches.json) | 中文/日文补名 |

## 致谢和许可

本项目自有代码以 [**GNU General Public License v3.0**](LICENSE) 发布，第三方代码、数据、字体依其许可。

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

## Concept

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *— Sima Qian, Records of the Grand Historian, "Treatise on the Celestial Offices" (1st c. BCE): as Mercury appears among different lunar mansions at the equinoxes and solstices, each region of the realm (Qi, Chu, Han, the Central States) is allotted its own quarter of the sky. An early articulation of fēnyě.*

<p align="center">
  <img src="docs/demo/xingguan_wuzhuhou.png" width="100%">
</p>

The heavens have their constellations; the Earth has its regions. Linking phenomena in the sky to areas on the ground is an idea as old as astronomy and astrology themselves: ancient China mapped the twenty-eight lunar mansions onto the Nine Provinces and the feudal states through **分野** (*fēnyě*, "field-allocation"), while in the Greco-Roman world Ptolemy proposed correspondences between the twelve signs of the zodiac and nations. Some dismissed the scheme as far-fetched, yet it revealed a symmetry and an isomorphism between sky and Earth, a correspondence that has fed the imagination and inquiry of every age since.

Modern geodesy gives this linkage a rigorous form: ```lat = Dec, lon = RA − GMST```. Concretely, a body projected straight down onto the Earth meets the surface at its unique, exactly computable substellar point. Compared with a static world map, the projected star map has these characteristics:

* **Westward rotation**: the star map turns with the celestial sphere over one sidereal day, exactly opposite to the Earth's own rotation, so the stars drift slowly westward across the fixed ground beneath them.
* **East–west mirrored**: the observer looks down on the star map from outside, the opposite of gazing up at the night sky from within, so east and west are flipped relative to ordinary observation.
* **Nearer looms larger**: bodies are drawn at their apparent, not physical, size. The Moon, being close to the Earth, takes up far more area than the planets or deep-sky objects.

## Features

### Layers

The base map uses a dark theme: [CARTO Dark Matter](https://github.com/cartodb/basemap-styles) by default, switchable to [Stadia Alidade Smooth Dark](https://docs.stadiamaps.com/map-styles/alidade-smooth-dark/) from the layer control at the top right. The layer control at the top left toggles the data layers built and integrated by the site:

| Category | Layers |
|---|---|
| Stars / Constellations / Xingguan | Stars, deep-sky objects, meteor showers, constellations / star officials (xingguan) / asterisms, multilingual labels, coordinate reference lines |
| Sun / Moon / Planets | Disc rendering, phase rendering, sunlight / moonlight veils |
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
  <img src="docs/demo/compass_sunrise.png" width="100%">
</p>

### Eclipse Interaction

When an eclipse is under way, the map shows the pre-loaded envelope curves for its visibility range together with the real-time envelope ring for the instantaneous visibility range. Open the panel on the left for the 2000–2049 list of eclipses; open the panel on the right for the next eclipse visible from the selected location, along with the local circumstances of any eclipse currently in progress.

<p align="center">
  <img src="docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

The lunar-eclipse diagram is set against a **shadow map** of the Earth's penumbra and umbra, showing the Moon's passage through them. The solar-eclipse diagram is a **sky-track** of the Sun over the course of the event. Below each diagram are the altitude and azimuth of the Moon or Sun at greatest eclipse and at each contact.

<p align="center">
  <img src="docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### Sunlight & Moonlight Veils

The Sun and Moon layers come with light veils that simulate their visible ranges. The sunlight veil is built from four bands of constant brightness, one each for daylight and the civil, nautical and astronomical twilight zones. The moonlight veil instead varies in brightness with the Moon's illumination (brightest at full Moon, all but invisible near the new), and during a lunar eclipse it takes on a rust-red cast that deepens with the umbral magnitude. The layer control at the top right toggles the light veils on and off.

<p align="center">
  <img src="docs/demo/moonlight.png" width="100%">
</p>

### Celestial Engravings

The Sun, the Moon and the planets (bodies that show a visible disc) appear on the map as engraving-style icons, drawn in the manner of the engraved plates the British optical-instrument maker and mapmaker [John Browning](https://en.wikipedia.org/wiki/John_Browning_(scientific_instrument_maker)) published in the *Monthly Notices of the Royal Astronomical Society* in 1870. Each disc subtends exactly its apparent diameter on the map and so changes with the body's distance from the Earth; the shadow across the disc is rendered from its phase angle. For Solar System bodies, the rendered size corresponds to apparent diameter as follows:

- the Sun and Moon span at most about 0.53°, roughly 60 km projected onto the Earth's surface, about the size of a giant city;
- Jupiter spans at most about 50″, roughly 1 km on the surface, about the size of a large neighbourhood;
- Uranus spans at most about 4″, roughly 80 m on the surface, about the size of a regulation soccer pitch.


<p align="center">
  <img src="docs/demo/jupiter_over_hong_kong.png" width="100%">
</p>

### Ecliptic Graduations

To give a reference for the positions of the Sun and the other bodies, coordinate reference lines are drawn for the ecliptic, the celestial equator, the Moon's path, the galactic equator and more, each of which can be turned on or off from the layer control at the top right. As the reference line on which the Sun lies, the ecliptic is drawn as a bronze band of twin rails; the band marks the ecliptic longitudes of the solstices and equinoxes, along with longitude ticks every 1°. Hovering over a solstice or equinox label reveals the exact time of its next occurrence. Turn on the xingguan layer to see the twenty-eight lunar mansions arrayed around the ecliptic.

<p align="center">
  <img src="docs/demo/eclipse_belt.png" width="100%">
</p>

### Data Overlays

Alongside the astronomical layers, the project integrates light-pollution, auroral-oval and satellite data, all of which can be overlaid at once. To keep the information from clashing, a layer-conflict mechanism closes incompatible layers automatically. The constellation and light-pollution layers, for instance, cannot be open together. The light-pollution and auroral-oval layers follow the colour conventions of their source sites. The satellite layer draws ground tracks in bronze-green, with the gold stretches marking where a satellite's flare may be seen from the ground. The light-pollution, aurora and satellite sections of the right-hand info panel give detailed observing information. Note that the auroral-oval and satellite data are near-real-time forecasts: once the data are out of date, the layer is locked and greyed out.

<p align="center">
  <img src="docs/demo/multi_layers.png" width="100%">
</p>

## Datasets

### Eclipses (2000–2049)

The project uses the solar and lunar position vectors from [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 to compute the 112 solar and 114 lunar eclipses between 2000 and 2049. The dataset holds the Besselian elements used to compute each solar eclipse's contact times and positions, along with the ground-envelope curves that describe its coverage (umbral central line, northern and southern umbral limits, iso-magnitude lines, northern and southern penumbral limits, sunrise/sunset maximum-eclipse lines, sunrise/sunset curves and so on); the lunar-eclipse dataset holds only an index.

**Note:** a solar eclipse's real-time shadow and coverage, and a lunar eclipse's coverage, fall outside the dataset: they are rendered in real time by the same algorithms.

**Directory structure**

| File | Contents |
|---|---|
| [`data/eclipses/solar.json`](data/eclipses/solar.json) | Solar-eclipse index |
| [`data/eclipses/lunar.json`](data/eclipses/lunar.json) | Lunar-eclipse index |
| [`data/eclipses/events/`](data/eclipses/events/) `<date>.json` | Solar-eclipse visibility range |
| [`data/eclipses/README.md`](data/eclipses/README.md) | Format notes |


### Traditional Chinese Star Names

The project provides a multilingual dataset of traditional Chinese star names indexed by HIP, currently holding 3,035 star names and 312 star-official (xingguan) entries. The entries are based primarily on the traditional Chinese star-name catalogue from the [Stellarium](https://stellarium.org/) community, with supplementary entries drawn from [Yu Zhaohuan's personal site](https://yzhxxzxy.github.io/cn/index.html), [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement), Wikipedia and other crowd-sourced material. The Chinese star-official lines are taken from d3-celestial's sky data. The multilingual translations (English, French, Spanish, Italian) offer both transliterated and meaning-based renderings.

<p align="center">
  <img src="docs/demo/xingguan_translation_wudizuo.png" width="80%">
</p>

**Directory structure**

| File | Contents |
|---|---|
| [`data/sky/names.cn.json`](data/sky/names.cn.json) | Star-official information |
| [`data/sky/lines.cn.geojson`](data/sky/lines.cn.geojson) | Star-official lines |
| [`data/sky/i18n/`](data/sky/i18n/) `<locale>/stars.json` | Traditional star names and translations |
| [`data/sky/i18n/`](data/sky/i18n/) `<locale>/constellations.cn.json` | Star-official names and translations |


### Place Names in Mainland China

The project relies mainly on the cities15000 database from [GeoNames](https://www.geonames.org/) for forward and reverse lookup, but its city coordinates and multilingual names are often incomplete. For mainland China, the project takes the 2023 list of township-level towns from [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage), converts it to JSON and merges it into the GeoNames city database. It also fills in Chinese translations for some GeoNames place names, ensuring Chinese/Japanese bilingual coverage across East Asia.

<p align="center">
  <img src="docs/demo/place_lookup.png" width="80%">
</p>

**Directory structure**

| File | Contents |
|---|---|
| [`data/places/cities.json.gz`](data/places/cities.json.gz) | Augmented place-name database |
| [`data/places/name-patches.json`](data/places/name-patches.json) | Chinese/Japanese name patches |

## Credits & License

The project's own code is released under the [**GNU General Public License v3.0**](LICENSE); third-party code, data and fonts remain under their respective licences.

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
| Comets / Asteroids | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | Public Domain |
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
