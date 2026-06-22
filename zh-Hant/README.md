# <img src="../img/mark.svg" alt="" width="39" style="vertical-align: text-bottom"> 星下點地圖

[简体中文](../zh-Hans/README.md) · **繁體中文** · [English](../en/README.md) · [Français](../fr/README.md) · [Español](../es/README.md) · [Italiano](../it/README.md) · [日本語](../ja/README.md)

<p align="center">
  <img src="../docs/demo/world_map.png" width="100%">
</p>

星下點地圖是以「星下點」為靈感，將天球投影到地球表面後相疊而成的地圖。在星下點地圖中，每個天體都處在其星下點所對應的地理位置上，跟隨著地球，以 23 時 56 分為週期緩慢旋轉。天球與地球的互動，可以自然地展示各類天文事件在地球上的可見範圍，例如晝夜、行星、深空天體、日月食、極光和人造衛星等。

## 概念設計

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》

<p align="center">
  <img src="../docs/demo/xingguan_wuzhuhou.png" width="100%">
</p>

天有列宿，地有州域。將天空中的現象與地理上的區域聯繫起來，是天文學和占星學自起源之初就存在的概念：古代中國有二十八宿對九州郡國的「分野」，希臘-羅馬的托勒密亦提出過黃道十二宮與國家的對應關係。現代測地學為這種聯繫給出了更嚴謹的對應關係：將天體沿垂線投影到地球上，其對應的地表點便是唯一的、可精確計算的星下點。相對於靜置的世界地圖，被投影下的星圖有如下特點：

* 向西旋轉：以天球為參考系，地球自東向西以恆星日為週期旋轉，但從地球的視角來看旋轉方向恰好相反
* 東西反向：使用者的視角在星圖外側向下觀察，與日常觀測夜空時，從星空內側向上觀察的東西方向相反
* 近大遠小：天體呈現的是視覺大小而非真實大小，離地球較近的月亮的面積佔比要遠大於行星和深空天體

## 特色功能

### 圖層說明

地圖圖層採用暗色主題，預設 CARTO Dark Matter，可切換 Stadia Alidade Smooth Dark。網站開發/整合的數據圖層則有：

| 類別 | 功能 |
|---|---|
| 星空/星座/星官 | 恆星、深空天體、流星雨、星座/星官/星群、多語言標籤、座標格網 |
| 太陽/月亮/行星 | 盤面、相位渲染、日光/月光蒙版 |
| 日月食 | 事件列表、見食範圍、食況圖 |
| 光污染 | 圖磚渲染（D.J. Lorenz） |
| 極光卵 | 可見範圍（NOAA SWPC OVATION） |
| 人造衛星 | 可見範圍（CelesTrak） |

### 觀測者羅盤

雙擊地圖上的任意點可觸發並鎖定**觀測者羅盤**，其顯示日出、日落、月出、月落方向及當前時刻的太陽和月亮位置。羅盤上的黃色、藍色曲線分別為當日的日行跡、月行跡。羅盤鎖定時，點擊對應天體圖示或標籤可顯示延長**方位射線**，點擊天體星下點可顯示該地點到星下點的大圓連線。右側資訊欄則提供了地點的詳細資訊和當日觀測數據，點擊數據欄中的時間可跳轉至對應時刻。

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### 日月食互動

開啟日月食圖層可拉開左側的日月食列表，從列表跳轉到對應事件發生時刻，可見由彩色渲染、表徵整起事件可見範圍的包絡曲線，以及由灰色渲染、表徵即時可見範圍的包絡圈。點擊右下播放按鈕可見日食可見範圍隨時間移動。

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

右側資訊欄的日月食板塊提供選定地點上的**食況詳情**。其中，月食食況圖繪製月面穿過地影的情況，日食食況圖繪製太陽從食始到食終經過天空的軌跡圖。

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### 多圖層疊加

本項目支援多源數據圖層的同時疊加，例如光污染圖層、極光卵圖層和衛星圖層，並引入圖層衝突機制（例如，星座圖層和光污染圖層不可同時開啟）避免資訊干擾。衛星圖層以綠色顯示衛星軌跡，在地面曙暮光範圍上可能存在衛星閃光的軌跡則以金色標示，以衛星圖示為圓心的大圓則表示其可見範圍。右側資訊欄的極光、光污染和衛星板塊則提供了詳細的觀測資訊。

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## 數據集

### 日月食（2000–2049 年）

本項目提供的日食數據集含用於計算日食事件接觸時刻、位置的貝塞爾元素，以及表徵整起事件食況範圍的地面包絡曲線（本影中心線、本影南北限、等食分線、半影南北線、日出/日落極大食線、日出日落圈等），月食數據集則僅含索引。現收錄 2000–2049 年間的 112 次日食和 114 次月食。計算中使用到的太陽、月球位置向量來自 [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19。

**註：**日食的即時陰影和食況範圍，以及月食的食況範圍在執行時計算

**目錄結構**

| 檔案 | 內容 |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | 日食索引 |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | 月食索引 |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | 日食見食範圍 |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | 格式說明 |


### 中國傳統星名

本項目提供以 HIP 為索引的多語言中國傳統星名數據集，現收錄 3035 條中國傳統星名和 312 項星官條目。條目的來源主題為 [Stellarium](https://stellarium.org/) 社群提供的中國傳統星名名錄，部分補充條目參考自[余釗煥的個人網站](https://yzhxxzxy.github.io/cn/index.html)、[Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) 及維基百科等眾源數據。中國星官連線取自 d3-celestial 的星空數據。多語言翻譯（含英語、法語、西班牙語、意大利語）提供了音譯和意譯兩種譯法。

**目錄結構**

| 檔案 | 內容 |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | 星官資訊 |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | 星官連線 |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | 中國傳統星名及多語言翻譯 |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | 中國星官名及多語言翻譯 |


### 中國大陸地名

本項目主要使用 [GeoNames](https://www.geonames.org/) 提供的 cities15000 城市數據庫提供正反查詢功能，然而其城市座標及多語言名稱多有缺失。在中國大陸地區，本項目以 [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) 提供的 2023 年中國大陸鄉鎮列表為基礎，將其轉換至 json 格式合併入 GeoNames 城市數據庫中。同時，本項目還增補了 GeoNames 城市數據庫中部分地名的中文翻譯，在東亞地區保證了地名的中文/日文雙語互譯。

| 檔案 | 內容 |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | 增補後地名庫 |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | 中文/日文補名 |

## 致謝與授權

本項目自有程式碼以 **GNU General Public License v3.0** 發佈，詳情參見 [LICENSE](../LICENSE)。第三方程式碼、數據、字型依其授權。

| 用途 | 組件 (版本) | 作者 / 來源 | 授權 |
|---|---|---|---|
| 地圖引擎 | [Leaflet](https://leafletjs.com/) 1.9.4 | Volodymyr Agafonkin | BSD-2-Clause |
| 地圖圖磚 | [OpenStreetMap](https://www.openstreetmap.org/copyright) | OpenStreetMap 社群 | ODbL |
| 蒙版分割 | [Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator) 1.1.0 | Jörg Dietrich | MIT |
| 天文計算 | [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 | Don Cross | MIT |
| 太陽計算 | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 | Volodymyr Agafonkin | BSD-2-Clause |
| 農曆曆法 | [lunar-javascript](https://github.com/6tail/lunar-javascript) 1.7.7 | 6tail | MIT |
| 星座連線 | [d3-celestial](https://github.com/ofrohn/d3-celestial) | Olaf Frohn | BSD |
| 恆星數據 | [HYG 星表](https://www.astronexus.com/projects/hyg) | David Nash | CC BY-SA 4.0 |
| 中國傳統星名 | [Stellarium](https://stellarium.org/) | Stellarium 社群 | CC BY-SA |
| 中國傳統星名 | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | 觀津邀月 | GPL-2.0 |
| 彗星 / 小行星 | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | 公有領域 |
| 深空天體 | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| 日月食 | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| 光污染 | [光污染圖集](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| 極光預報 | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | 公有領域 |
| 衛星軌道計算 | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| 衛星軌道根數 | [CelesTrak](https://celestrak.org/) | T. S. Kelso | 公有領域 |
| 地名檢索 | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| 中國大陸地名 | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| 西文字型 | [Source Serif](https://github.com/adobe-fonts/source-serif) | Adobe | OFL |
| CJK 字型 | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| 數據解壓縮 | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |
