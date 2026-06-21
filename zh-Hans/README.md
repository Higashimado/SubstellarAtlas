# <img src="../img/mark.svg" alt="" width="26" valign="middle"> 星下点地图 · SubstellarAtlas

*The Substellar Atlas*。把整幅星空投回地面的交互世界地图:每颗天体都画在它此刻正悬于头顶的那一点。

[English](../README.md) · **简体中文**
<!-- 预留:繁體中文 / 日本語 / Français / Español / Italiano,按 README.<locale> 与本文件并列补充 -->

<!-- TODO 封面截图 -->
<!-- TODO Live demo 链接(GitHub Pages),发布前确认 -->

纯静态、零构建:打开 `index.html`,整幅星空便实时铺在一张 Leaflet 世界地图上,含昼夜分界、日月行星、IAU 与中国星官两套星图、日月食、卫星等。支持 7 种语言。

## 设计理念:星下点与分野

每颗恒星此刻都恰好悬在地球某一点的正头顶。从星到地心连线,与地表的交点即该星的**星下点**(对太阳即直射点)。把全天星图按星下点铺到世界地图,就是本站的底层:相当于把天球反转过来,扣在地球上。

| 读图三则 | 说明 |
|---|---|
| 西移 | 星空随地球自转西移,整幅星图约每 23 时 56 分(一个恒星日)绕地一周。 |
| 东西镜像 | 星下点左右与天球相反:星图自天球外向内看,仰望星空则自内向外看。 |
| 仅表天顶 | 星下点只表示该天体此刻在此地天顶;整个朝向半球都能见到它,点本身无特殊物理含义。 |

「天上某片星空对应地上何处」这一追问古已有之。中国天文把它系统化为**分野**:将天区(二十八宿、星官、十二次)配属于地域(九州与列国),某天区上的天象被读作对应地域的征兆。分野是象征的、由典籍固定的;星下点则是同一直觉的精确、实时、可计算形态。本站把中国**星官**作为叠层,直接铺在星下点网格上,使现代计算与古代分野直觉并置同图。

<!-- TODO 作者定稿:个人表达 / 分野措辞 -->

视觉来路:Stellarium(多文化星图)、NASA GSFC 与 Fred Espenak(日食制图)、Nicholas Rougeux《Clavis Cælestis》(排版)、Jeppesen 航图(信息密度)。

## 独有特色

| 特色 | 说明 |
|---|---|
| 实时 Besselian 日食阴影 | 本影、半影、等食分线在浏览器内由贝塞尔元素实时求解,与离线构建管线同一求值器(锁定 Astronomy Engine 2.1.19),阴影随时钟连续移动;月食按本影深度染红月光蒙版。 |
| 两套星座体系 | IAU 88 星座与中国星官可切换,星名各自本地化。 |
| 星下点统一模型 | 日月行星、恒星、日食中心线、卫星轨迹同出一理:画在天体正头顶处。 |
| 反点带洞蒙版 | 昼夜与可见范围蒙版围绕反点挖夜帽洞,避开高纬大圆蒙版自交。 |
| 亚像素平滑播放 | Leaflet 补丁去除逐元素像素取整,时间轴拖动不抖。 |
| 浑天仪罗盘 | 观测点方位等距投影叠层,含日月连续轨迹、行星字形、可固定方向线。 |
| 蚀刻设计 | 通体衬线、表格数字、蚀刻凹槽纹理;屏上文字全部可选中复制。 |
| 七语种 + 释义卡 | 术语悬停弹出主题化释义卡(非浏览器默认提示框),七语种键集一致。 |

## 普通功能

| 类别 | 功能 |
|---|---|
| 环境图层 | 极光卵(NOAA SWPC OVATION)· 光污染(D. J. Lorenz 2022 VIIRS) |
| 天体与轨迹 | 卫星地面轨迹(ISS、CSS、哈勃)· 坐标格线(黄道含 24 节气、赤道、白道、银道) |
| 检索 | 地名搜索(GeoNames)· 天体搜索(恒星、深空天体、彗星、流星雨辐射点) |
| 其他 | 时间播放(恒星日精确)· 观测点历书面板(日月出没、曙暮光、月相、单点气象) |

计划中:云量图层(Open-Meteo 网格)已实现,尚未挂入 UI。

## 特色数据

项目自建或自行推导的数据集(区别于仅作引用的第三方源,见致谢):

| 数据集 | 说明 |
|---|---|
| 日月食数据集 | 112 例日月食(2000 至 2049),含贝塞尔元素与四族地面包络曲线(本影、半影、等食分、南北限),由自有管线(Astronomy Engine + 自写贝塞尔工具 + marching-squares)生成。 |
| 多语言与星官星名语料 | HIP→星名跨七语种映射,含中国星官名,据 Stellarium 星空文化、维基百科与手工编纂。 |
| 七语种 UI 与 glossary 语料 | 界面文案与百科式术语释义,跨全部七语种自撰。 |

HYG、OpenNGC、GeoNames、Lorenz 栅格、NOAA、CelesTrak 等为引用输入(见致谢),非原创数据;黄道 24 节气为计算显示,非数据集。

## 技术与架构

纯 HTML、CSS、JavaScript,无构建步骤、无框架。Canvas 与 SVG 混合渲染,以静态文件部署(GitHub Pages)。

| 领域 | 库 |
|---|---|
| 地图引擎 | Leaflet 1.9.4 |
| 天文计算 | Astronomy Engine 2.1.19 · SunCalc 1.9.0 |
| 晨昏基础 | Leaflet.Terminator 1.1.0(已大幅扩展) |
| 卫星 | satellite.js 5.0.0 |
| 农历 | lunar-javascript 1.7.7 |
| 解压 | Pako 2.1.0 |

## 本地运行

```bash
git clone https://github.com/Higashimado/SubstellarAtlas.git
cd SubstellarAtlas
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

运行站点无需构建。`tools/` 下的 `npm run fetch-sky` / `build-sky` / `build` 仅用于重建打包的数据集。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `index.html` | 应用入口(根)。`en/ zh-CN/ ja/ fr/ es/ it/` 为极简语言入口壳。 |
| `js/` | 功能模块:地图、星图、行星、日月食、观测点、罗盘、搜索、i18n 等。 |
| `css/` | 设计 token、样式、自托管字体。 |
| `data/` | 恒星、日月食、地名、星空数据集与 i18n 词典。 |
| `img/` | 版刻行星与 UI 图标。 |
| `docs/` · `tools/` | 开发笔记 · 数据集构建管线。 |

## 数据来源与致谢

下列项目各归其作者所有、依其许可使用,具体条款请查各来源。

| 类别 | 项目 |
|---|---|
| 软件 | [Leaflet](https://leafletjs.com/) · [SunCalc](https://github.com/mourner/suncalc)(V. Agafonkin)· [Astronomy Engine](https://github.com/cosinekitty/astronomy)(D. Cross,MIT)· [d3-celestial](https://github.com/ofrohn/d3-celestial)(O. Frohn)· [Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator)(J. Dietrich)· [satellite.js](https://github.com/shashwatak/satellite-js)(S. Kandadai)· [lunar-javascript](https://github.com/6tail/lunar-javascript)(6tail)· [Pako](https://github.com/nodeca/pako) |
| 数据 | [HYG 星表](https://www.astronexus.com/projects/hyg)(D. Nash)· [OpenNGC](https://github.com/mattiaverga/OpenNGC)(M. Verga)· [CelesTrak](https://celestrak.org/)(T. S. Kelso)· [光污染图集](https://djlorenz.github.io/astronomy/lp/)(D. J. Lorenz)· [EclipseWise](https://www.eclipsewise.com/)(F. Espenak)· [GeoNames](https://www.geonames.org/)(CC BY 4.0)· [OpenStreetMap](https://www.openstreetmap.org/copyright)(ODbL)· [NOAA SWPC](https://www.swpc.noaa.gov/) · [JPL](https://ssd.jpl.nasa.gov/) · [小行星中心](https://www.minorplanetcenter.net/) · [Stellarium](https://stellarium.org/) 星空文化 |
| 字体 | [Source Serif](https://github.com/adobe-fonts/source-serif) · 思源宋体(Adobe)· [Noto](https://fonts.google.com/noto)(Google),均 OFL |

## 许可

项目自有代码以 MIT 许可发布,© 2026 Higashimado。第三方代码、数据、字体各依其许可,见致谢。
