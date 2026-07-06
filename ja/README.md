# <img src="../img/mark.svg" alt="" width="39"> 星下点地図

[简体中文](../zh-Hans/README.md) · [繁體中文](../zh-Hant/README.md) · [English](../en/README.md) · [Français](../fr/README.md) · [Español](../es/README.md) · [Italiano](../it/README.md) · **日本語**

<p align="center">
  <img src="../docs/demo/constellation.png" width="100%">
</p>

**ウェブサイト**：https://higashimado.github.io/SubstellarAtlas/
星下点地図は「**直下点**（星下点）」を着想とし、天球を地球表面へ投影して重ね合わせた地図です。この地図では、すべての天体がその直下点に対応する地理的位置に置かれ、地球とともに 23 時間 56 分を周期としてゆっくりと回転します。天球と地球の相互作用は、昼夜・惑星・彗星・深宇宙天体・日月食・オーロラ・人工衛星など、さまざまな天文現象が地球上のどこで見えるかを自然に示します。

## コンセプト

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *—— 司馬遷『史記』天官書（紀元前1世紀）。辰星（水星）が二至二分の頃にどの宿のそばに現れるかに応じて、斉・楚・漢・中国といった各地域に天の一画が割り当てられる、という分野思想の初期の表現。*

<p align="center">
  <img src="../docs/demo/xingguan.png" width="100%">
</p>

天に星宿あり、地に州域あり。空の現象を地上の領域と結びつける発想は、天文学と占星術そのものと同じくらい古いものです。古代中国は二十八宿を九州や諸侯国に対応させる**分野**を体系化し、ギリシャ・ローマ世界ではプトレマイオスが黄道十二宮と諸国の対応を提唱しました。「牽強付会」との評もありますが、そこに示された天と地の対称性・同型性は、後世のさまざまな想像と思索の源であり続けています。

近代測地学は、この結びつきにより厳密な形を与えます。```lat = Dec, lon = RA − GMST```．︀すなわち、天体を鉛直に地球へ投影すると、その交わる地表点が唯一かつ厳密に計算可能な直下点となります。静止した世界地図と比べ、投影された星図には次の特徴があります。

* **西向きの回転**：星図は天球とともに恒星日を周期として西から東へ回転し、地球自身の自転とはちょうど逆向きになります。
* **東西の反転**：観測者は星図を外側から見下ろしており、夜空を内側から見上げる日常の観測とは逆になるため、東西が通常の観測と反転します。
* **近いものほど大きく**：天体は実際の大きさではなく見かけの大きさで描かれます。地球に近い月は、遠くの惑星よりはるかに大きく見えます。

## 特色

### レイヤー

ベースマップは暗色テーマで、既定は [CARTO Dark Matter](https://github.com/cartodb/basemap-styles)、右上のレイヤー切り替えから [Stadia Alidade Smooth Dark](https://docs.stadiamaps.com/map-styles/alidade-smooth-dark/) にも変更できます。左上のレイヤー切り替えでは、サイトが開発・統合した次のデータレイヤーを操作できます。

| 分類 | レイヤー |
|---|---|
| 恒星 / 星座 / 星官 | 恒星、深宇宙天体、銀河、流星群、星座 / 星官 / アステリズム、多言語ラベル、座標の基準線 |
| 太陽 / 月 | 円面の描画、位相の描画、日光 / 月光のヴェール |
| 惑星 / 彗星 | 円面の描画、位相の描画、木星 / 土星の衛星、小惑星、彗星、イベント一覧 |
| 日月食 | イベント一覧、可視範囲、食況情報と食況図 |
| 光害 | データ描画（D. J. Lorenz） |
| オーロラオーバル | データ描画（NOAA SWPC OVATION） |
| 人工衛星 | データ描画（CelesTrak） |

### 観測者コンパス

**観測者コンパス**は、特定の地点における天体の方位を読み取るためのツールです。地図上の任意の点をダブルクリックすると起動・固定されます。対応するレイヤーを開いておくと、固定したコンパスは次を表示できます。
- 日の出・日の入りの方位、太陽の現在の方位とその日の運行軌跡
- 月の出・月の入りの方位、月の現在の方位とその日の運行軌跡
- 一年を通じた太陽の運行軌跡の範囲
- 空に見えている惑星の現在の方位

コンパス上のアイコンやラベルをクリックすると、対応する**方位射線**が延びます。コンパスが出ている間に天体の直下点をクリックすると、その地点から直下点までの大円が描かれます。右側の情報欄には地点の詳細情報とその日の太陽・月・惑星の観測データが表示され、データ欄の時刻をクリックすると対応する時刻へ移動できます。

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### 日光・月光のヴェール

太陽・月のレイヤーを開くと、日光・月光のヴェールも自動的に表示されます。日光のヴェールは一定の明るさの 4 層を重ねたもので、昼間と、市民・航海・天文の各薄明の範囲にそれぞれ対応します。月光のヴェールは月明かりの強さに応じて明るさが線形に変化し、満月で最も明るく、欠けるにつれてほとんど見えなくなります。月食の際には、本影食分の大きさに応じて月光のヴェールが赤錆色に染まります。右上のレイヤー切り替えで、日光・月光のヴェールのオン・オフを切り替えられます。

<p align="center">
  <img src="../docs/demo/moonlight.png" width="100%">
</p>

### 天体の版画

太陽・月・各惑星と一部の彗星など、円面が見える天体は、版画風のアイコンとして地図に描かれます。その画風は、英国の光学機器製作者であり製図家でもあった [John Browning](https://en.wikipedia.org/wiki/John_Browning_(scientific_instrument_maker)) が 1870 年に『王立天文学会月報』へ発表した版画図版に倣っています。地図上で天体の円面が占める角の大きさはその視直径と厳密に一致し、地球との距離に応じて変化します。円面の影は位相角から計算して描かれます。太陽系内の天体について、地図上の描画サイズと視直径の対応は次のとおりです。

- 太陽と月は視直径が最大で約 0.53°、地球表面に投影すると約 60 km で、巨大都市に相当します
- 木星は最大で約 50″、地表に投影すると約 1 km で、大きな住宅街に相当します
- 天王星は最大で約 4″、地表に投影すると約 80 m で、標準的なサッカー場に相当します


<p align="center">
  <img src="../docs/demo/jupiter_over_hong_kong.png" width="100%">
</p>

### 天体の軌跡

惑星・彗星レイヤーには、合や衝に関するイベントの一覧があり、特定の天体に絞り込むフィルターも備えています。イベントをクリックすると、それが起こる瞬間に天体が位置する場所へ移動します。到着すると、その前後の日々にわたる惑星や彗星の軌跡が自動的に開き、一定の間隔をおいた連続する日付ごとの位置が示されます。軌跡上の時刻ラベルをクリックすると、その時刻へ移動できます。月や惑星のほか、イベント一覧は現在、大型の小惑星 3 つ（ケレス・パラス・ベスタ）と、2000 年から 2025 年の間に発見され視等級 6 以上に達した明るい彗星（[Tsuchinshan-ATLAS 彗星](https://ja.wikipedia.org/wiki/%E7%B4%AB%E9%87%91%E5%B1%B1%E3%83%BB%E3%82%A2%E3%83%88%E3%83%A9%E3%82%B9%E5%BD%97%E6%98%9F)など）を収録しています。

<p align="center">
  <img src="../docs/demo/planet_tracks.png" width="100%">
</p>

### 日月食インタラクション

日月食の際には、事前に読み込まれた可視範囲の包絡曲線と、リアルタイムに計算される瞬間可視範囲の包絡円が地図上に表示されます。左側の情報欄を開くと 2000–2099 年の日月食一覧が、右側の情報欄を開くと選択した地点で次に見える日月食の情報に加え、現在進行中の日月食の食況詳細が見られます。

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

月食の食況図は、地球の半影・本影を描いた**地影図**を背景に、月がそこを通過する様子を示します。日食の食況図は、イベント期間中に太陽が空を通る**軌跡図**です。食況図の下には、最大食の時刻と各接触時刻における月または太陽の高度と方位が示されます。

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### オーロラオーバル／光害／人工衛星

本プロジェクトは天文レイヤーに加え、光害・オーロラオーバル・人工衛星のデータを統合し、重ねて表示できます。情報の干渉を避けるため、一部のレイヤーには競合の仕組みが設けられており（たとえば星座レイヤーと光害レイヤーは同時に開けません）、競合するレイヤーは自動的に閉じられます。光害レイヤーとオーロラオーバルレイヤーの配色は、データ提供元サイトに準じています。衛星レイヤーは衛星の軌跡を青銅色（ブロンズグリーン）で描き、金色の区間は地上から衛星のフレアが見える軌跡を示します。右側情報欄の光害・オーロラ・衛星の各セクションは、詳しい観測情報を提供します。オーロラオーバルと人工衛星のデータはいずれも準リアルタイムの予測であり、データが有効期限を過ぎるとレイヤーは灰色に固定されます。

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## データセット

### 日月食（2000–2099年）

本プロジェクトは、[Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 が提供する太陽・月の位置ベクトルを用いて、2000 年から 2099 年までの 226 回の日食と 228 回の月食を計算しています。データセットには、日食の接触時刻と位置を計算するためのベッセル要素と、イベント全体の食況範囲を表す地上の包絡曲線（本影中心線、本影南北限、等食分線、半影南北線、日の出/日の入り最大食線、日の出/日の入り円など）が含まれます。月食データセットには索引のみが含まれます。

**注**：日食のリアルタイム影と食況範囲、および月食の食況範囲はデータセットには含まれず、同じアルゴリズムでリアルタイムに計算されます。

**ディレクトリ構成**

| ファイル | 内容 |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | 日食の索引 |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | 月食の索引 |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | 日食の可視範囲 |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | フォーマット説明 |


### 中国の伝統星名

本プロジェクトは HIP を索引とする多言語の中国伝統星名データセットを提供しており、現在 3035 件の中国伝統星名と 312 項目の星官を収録しています。項目は主に [Stellarium](https://stellarium.org/) コミュニティが提供する中国伝統星名の目録を出典とし、一部の補足項目は[余钊焕の個人サイト](https://yzhxxzxy.github.io/cn/index.html)、[Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement)、ウィキペディアなどのクラウドソース資料を参照しています。中国の星官の結線は d3-celestial の星空データに基づきます。多言語翻訳（英語・フランス語・スペイン語・イタリア語を含む）では、音訳と意訳の二通りの訳を提供しています。

<p align="center">
  <img src="../docs/demo/xingguan_translation_wudizuo.png" width="80%">
</p>

**ディレクトリ構成**

| ファイル | 内容 |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | 星官の情報 |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | 星官の結線 |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | 中国伝統星名と多言語翻訳 |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | 中国星官名と多言語翻訳 |


### 中国本土の地名

本プロジェクトは主に [GeoNames](https://www.geonames.org/) の cities15000 都市データベースを用いて順引き・逆引き検索を提供していますが、その都市座標や多言語名には欠落が多くあります。中国本土については、[OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) が提供する 2023 年の中国本土の郷鎮一覧を基礎とし、JSON 形式に変換して GeoNames 都市データベースに統合しました。あわせて GeoNames 都市データベースの一部の地名の中国語訳を補い、東アジア地域で地名の中国語/日本語の相互翻訳を確保しています。

<p align="center">
  <img src="../docs/demo/place_lookup.png" width="80%">
</p>

**ディレクトリ構成**

| ファイル | 内容 |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | 補完後の地名データベース |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | 中国語/日本語の補完名 |

## クレジットとライセンス

本プロジェクトの自前コードは [**GNU General Public License v3.0**](../LICENSE) で公開しています。第三者のコード・データ・フォントは、それぞれのライセンスに従います。

| 用途 | コンポーネント（バージョン） | 作者 / 出典 | ライセンス |
|---|---|---|---|
| 地図エンジン | [Leaflet](https://leafletjs.com/) 1.9.4 | Volodymyr Agafonkin | BSD-2-Clause |
| 地図タイル | [OpenStreetMap](https://www.openstreetmap.org/copyright) | OpenStreetMap コミュニティ | ODbL |
| 昼夜境界線 | [Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator) 1.1.0 | Jörg Dietrich | MIT |
| 天文計算 | [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 | Don Cross | MIT |
| 太陽計算 | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 | Volodymyr Agafonkin | BSD-2-Clause |
| 旧暦暦法 | [lunar-javascript](https://github.com/6tail/lunar-javascript) 1.7.7 | 6tail | MIT |
| 星座結線 | [d3-celestial](https://github.com/ofrohn/d3-celestial) | Olaf Frohn | BSD |
| 恒星データ | [HYG 星表](https://www.astronexus.com/projects/hyg) | David Nash | CC BY-SA 4.0 |
| 恒星データ | [Gaia DR3](https://www.cosmos.esa.int/gaia) | ESA / Gaia / DPAC | CC BY-NC 3.0 IGO |
| 中国伝統星名 | [Stellarium](https://stellarium.org/) | Stellarium コミュニティ | CC BY-SA |
| 中国伝統星名 | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | Guanjin0562 | GPL-2.0 |
| 土星の衛星 | [TASS 1.7](https://ftp.imcce.fr/pub/ephem/satel/tass17/) | Vienne & Duriez / J. Gajdosik | MIT |
| 彗星 / 小惑星 | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | パブリックドメイン |
| 深宇宙天体 | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| 日月食 | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| 光害 | [光害アトラス](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| オーロラ予報 | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | パブリックドメイン |
| 衛星軌道計算 | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| 衛星軌道要素（TLE） | [CelesTrak](https://celestrak.org/) | T. S. Kelso | パブリックドメイン |
| 地名検索 | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| 中国本土の地名 | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| 欧文フォント | [Spectral](https://fonts.google.com/specimen/Spectral) | Production Type | OFL |
| CJK フォント | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| 刻文フォント | [Cinzel](https://fonts.google.com/specimen/Cinzel) | Natanael Gama | OFL |
| データ解凍 | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |