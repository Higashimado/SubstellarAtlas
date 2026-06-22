# <img src="../img/mark.svg" alt="" width="39" style="vertical-align: text-bottom"> 星下点地图

**简体中文** · [繁體中文](../zh-Hant/README.md) · [English](../en/README.md) · [Français](../fr/README.md) · [Español](../es/README.md) · [Italiano](../it/README.md) · [日本語](../ja/README.md)

<p align="center">
  <img src="../docs/demo/world_map.png" width="100%">
</p>

星下点地图是以“星下点”为灵感，将天球投影到地球表面后相叠而成的地图。在星下点地图中，每个天体都处在其星下点所对应的地理位置上，跟随着地球，以 23 时 56 分为周期缓慢旋转。天球与地球的交互，可以自然地展示各类天文事件在地球上的可见范围，例如昼夜、行星、深空天体、日月食、极光和人造卫星等。

## 概念设计

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》

<p align="center">
  <img src="../docs/demo/xingguan_wuzhuhou.png" width="100%">
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
| 光污染 | 瓦片渲染（D.J. Lorenz）
| 极光卵 | 可见范围（NOAA SWPC OVATION） |
| 人造卫星 | 可见范围（CelesTrak） |

### 观测者罗盘

双击地图上的任意点可触发并锁定**观测者罗盘**，其显示日出、日落、月出、月落方向及当前时刻的太阳和月亮位置。罗盘上的黄色、蓝色曲线分别为当日的日行迹、月行迹。罗盘锁定时，单击对应天体图标或标签可显示延长**方位射线**，单击天体星下点可显示该地点到星下点的大圆连线。右侧信息栏则提供了地点的详细信息和当日观测数据，单击数据栏中的时间可跳转至对应时刻。

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### 日月食交互

打开日月食图层可拉开左侧的日月食列表，从列表跳转到对应事件发生时刻，可见由彩色渲染、表征整起事件可见范围的包络曲线，以及由灰色渲染、表征实时可见范围的包络圈。点击右下播放按钮可见日食可见范围随时间移动。

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

右侧信息栏的日月食板块提供选定地点上的**食况详情**。其中，月食食况图绘制月面穿过地影的情况，日食食况图绘制太阳从食始到食终经过天空的轨迹图。

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### 多图层叠加

本项目支持多源数据图层的同时叠加，例如光污染图层、极光卵图层和卫星图层，并引入图层冲突机制（例如，星座图层和光污染图层不可同时打开）避免信息干扰。卫星图层以绿色显示卫星轨迹，在地面曙暮光范围上可能存在卫星闪光的轨迹则以金色标示，以卫星图标为圆心的大圆则表示其可见范围。右侧信息栏的极光、光污染和卫星板块则提供了详细的观测信息。

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## 数据集

### 日月食（2000–2049 年）

本项目提供的日食数据集含用于计算日食事件接触时刻、位置的贝塞尔元素，以及表征整起事件食况范围的地面包络曲线（本影中心线、本影南北限、等食分线、半影南北线、日出/日落极大食线、日出日落圈等），月食数据集则仅含索引。现收录 2000–2049 年间的 112 次日食和 114 次月食。计算中使用到的太阳、月球位置矢量来自 [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19．

**注：**日食的实时阴影和食况范围，以及月食的食况范围在运行时计算

**目录结构**

| 文件 | 内容 |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | 日食索引 |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | 月食索引 |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | 日食见食范围 |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | 格式说明 |


### 中国传统星名

本项目提供以 HIP 为索引的多语言中国传统星名数据集，现收录 3035 条中国传统星名和 312 项星官条目。条目的来源主题为 [Stellarium](https://stellarium.org/) 社区提供的中国传统星名名录，部分补充条目参考自[余钊焕的个人网站](https://yzhxxzxy.github.io/cn/index.html)、[Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) 及维基百科等众源资料。中国星官连线取自 d3-celestial 的星空数据。多语言翻译（含英语、法语、西班牙语、意大利语）提供了音译和意译两种译法。

**目录结构**

| 文件 | 内容 |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | 星官信息 |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | 星官连线 |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | 中国传统星名及多语言翻译 |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | 中国星官名及多语言翻译 |


### 中国大陆地名

本项目主要使用 [GeoNames](https://www.geonames.org/) 提供的 cities15000 城市数据库提供正反查询功能，然而其城市坐标及多语言名称多有缺失。在中国大陆地区，本项目以 [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) 提供的 2023 年中国大陆乡镇列表为基础，将其转换至 json 格式合并入 GeoNames 城市数据库中。同时，本项目还增补了 GeoNames 城市数据库中部分地名的中文翻译，在东亚地区保证了地名的中文/日文双语互译。

| 文件 | 内容 |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | 增补后地名库 |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | 中文/日文补名 |

## 致谢和许可

本项目自有代码以 **GNU General Public License v3.0** 发布，详情参见 [LICENSE](../LICENSE)． 第三方代码、数据、字体依其许可。

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
| 彗星 / 小行星 | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | 公有领域
| 深空天体 | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| 日月食 | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| 光污染 | [光污染图集](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| 极光预报 | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | 公有领域 |
| 卫星轨道计算 | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| 卫星轨道根数 | [CelesTrak](https://celestrak.org/) | T. S. Kelso | 公有领域 |
| 地名检索 | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0
| 中国大陆地名 | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| 西文字体 | [Source Serif](https://github.com/adobe-fonts/source-serif) | Adobe | OFL |
| CJK 字体 | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| 数据解压 | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |
