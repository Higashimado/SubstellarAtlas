# <img src="../img/mark.svg" alt="" width="39" style="vertical-align: text-bottom"> Substellar Atlas

[简体中文](../zh-Hans/README.md) · [繁體中文](../zh-Hant/README.md) · [English](../en/README.md) · [Français](../fr/README.md) · [Español](../es/README.md) · [Italiano](../it/README.md) · **日本語**

<p align="center">
  <img src="../docs/demo/world_map.png" width="100%">
</p>

Substellar Atlas は「**直下点**（星下点）」を着想とし、天球を地球表面へ投影して重ね合わせた地図です。この地図では、すべての天体がその直下点に対応する地理的位置に置かれ、地球とともに 23 時間 56 分を周期としてゆっくりと回転します。天球と地球の相互作用は、昼夜・惑星・深宇宙天体・日月食・オーロラ・人工衛星など、さまざまな天文現象が地球上のどこで見えるかを自然に示します。

## コンセプト

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *—— 司馬遷『史記』天官書（紀元前1世紀）。辰星（水星）が二至二分の頃にどの宿のそばに現れるかに応じて、斉・楚・漢・中国といった各地域に天の一画が割り当てられる、という分野思想の初期の表現。*

<p align="center">
  <img src="../docs/demo/xingguan_wuzhuhou.png" width="100%">
</p>

天に星宿あり、地に州域あり。空の現象を地上の領域と結びつける発想は、天文学と占星術そのものと同じくらい古いものです。古代中国は二十八宿を九州や諸侯国に対応させる**分野**を体系化し、ギリシャ・ローマ世界ではプトレマイオスが黄道十二宮と諸国の対応を提唱しました。近代測地学はこの結びつきにより厳密な形を与えます。天体を鉛直に地球へ投影すると、その交わる地表点が唯一かつ厳密に計算可能な直下点となります。静止した世界地図と比べ、投影された星図には次の特徴があります。

* **西向きの回転** —— 天球を基準系とすると、地球は恒星日を周期として東から西へ回転しますが、地球自身の視点から見ると見かけの向きはちょうど逆になります。
* **東西の反転** —— 利用者は星図を外側から見下ろしており、夜空を内側から見上げる日常の観測とは逆になるため、東西が通常の観測と反転します。
* **近いものほど大きく** —— 天体は実際の大きさではなく見かけの大きさで描かれます。地球に近い月は、惑星や深宇宙天体よりはるかに大きな面積を占めます。

## 特色

### レイヤー

ベースマップは暗色テーマで、既定は CARTO Dark Matter、Stadia Alidade Smooth Dark にも切り替えられます。サイトが開発・統合したデータレイヤーは次のとおりです。

| 分類 | レイヤー |
|---|---|
| 恒星 / 星座 / 星官 | 恒星、深宇宙天体、流星群、星座 / 星官 / アステリズム、多言語ラベル、座標グリッド |
| 太陽 / 月 / 惑星 | 円面の描画、位相の描画、日光 / 月光のヴェール |
| 日月食 | イベント一覧、可視範囲、食分図 |
| 光害 | タイル描画（D. J. Lorenz） |
| オーロラオーバル | 可視範囲（NOAA SWPC OVATION） |
| 人工衛星 | 可視範囲（CelesTrak） |

### 観測者コンパス

地図上の任意の点をダブルクリックすると、**観測者コンパス**が起動・固定されます。コンパスは日の出・日の入り・月の出・月の入りの方位と、現在の太陽と月の位置を示します。黄色と青の曲線は、その日の太陽の軌跡（日行迹）と月の軌跡（月行迹）です。コンパスが固定された状態で天体のアイコンやラベルをクリックすると**方位射線**が延び、天体の直下点をクリックするとその地点から直下点までの大円が描かれます。右側の情報欄には地点の詳細情報とその日の観測データが表示され、データ欄の時刻をクリックすると対応する時刻へ移動できます。

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### 日月食インタラクション

日月食レイヤーを開くと、左側に日月食の一覧が現れます。一覧から各イベントの発生時刻へ移動すると、イベント全体の可視範囲を表す色付きの包絡曲線と、リアルタイムの可視範囲を表す灰色の包絡円が見られます。右下の再生ボタンを押すと、日食の可視範囲が時間とともに移動する様子を見られます。

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

右側情報欄の日月食セクションは、選択した地点での**食の状況の詳細**を提供します。月食の食況図は月面が地球の影を通過する様子を描き、日食の食況図は太陽が食の始まりから終わりまで空を通過する軌跡を描きます。

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### 多レイヤー重ね合わせ

本プロジェクトは、光害レイヤー・オーロラオーバルレイヤー・衛星レイヤーなど、複数のソースのデータレイヤーを同時に重ね合わせられます。情報の干渉を避けるためにレイヤー競合の仕組みを導入しており（たとえば星座レイヤーと光害レイヤーは同時に開けません）。衛星レイヤーは衛星の軌跡を緑で表示し、地上の薄明範囲上で衛星のフレアが起こりうる軌跡を金色で示し、衛星アイコンを中心とする大円でその可視範囲を表します。右側情報欄のオーロラ・光害・衛星の各セクションは、詳しい観測情報を提供します。

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## データセット

### 日月食（2000–2049年）

日食データセットには、食の接触時刻と位置を計算するためのベッセル要素と、イベント全体の食況範囲を表す地上の包絡曲線（本影中心線、本影南北限、等食分線、半影南北線、日の出/日の入り最大食線、日の出/日の入り円など）が含まれます。月食データセットには索引のみが含まれます。現在、2000年から2049年までの 112 回の日食と 114 回の月食を収録しています。計算に用いる太陽と月の位置ベクトルは [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 によります。

**注**：日食のリアルタイム影と食況範囲、および月食の食況範囲は実行時に計算されます。

**ディレクトリ構成**

| ファイル | 内容 |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | 日食の索引 |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | 月食の索引 |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | 日食の可視範囲 |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | フォーマット説明 |


### 中国の伝統星名

本プロジェクトは HIP を索引とする多言語の中国伝統星名データセットを提供しており、現在 3035 件の中国伝統星名と 312 項目の星官を収録しています。項目は主に [Stellarium](https://stellarium.org/) コミュニティが提供する中国伝統星名の目録を出典とし、一部の補足項目は[余钊焕の個人サイト](https://yzhxxzxy.github.io/cn/index.html)、[Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement)、ウィキペディアなどのクラウドソース資料を参照しています。中国の星官の結線は d3-celestial の星空データに基づきます。多言語翻訳（英語・フランス語・スペイン語・イタリア語を含む）では、音訳と意訳の二通りの訳を提供しています。

**ディレクトリ構成**

| ファイル | 内容 |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | 星官の情報 |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | 星官の結線 |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | 中国伝統星名と多言語翻訳 |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | 中国星官名と多言語翻訳 |


### 中国本土の地名

本プロジェクトは主に [GeoNames](https://www.geonames.org/) の cities15000 都市データベースを用いて順引き・逆引き検索を提供していますが、その都市座標や多言語名には欠落が多くあります。中国本土については、[OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) が提供する 2023 年の中国本土の郷鎮一覧を基礎とし、JSON 形式に変換して GeoNames 都市データベースに統合しました。あわせて GeoNames 都市データベースの一部の地名の中国語訳を補い、東アジア地域で地名の中国語/日本語の相互翻訳を確保しています。

| ファイル | 内容 |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | 補完後の地名データベース |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | 中国語/日本語の補完名 |

## クレジットとライセンス

本プロジェクトの自前コードは **GNU General Public License v3.0** で公開しています。詳細は [LICENSE](../LICENSE) を参照してください。第三者のコード・データ・フォントは、それぞれのライセンスに従います。

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
| 中国伝統星名 | [Stellarium](https://stellarium.org/) | Stellarium コミュニティ | CC BY-SA |
| 中国伝統星名 | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | Guanjin0562 | GPL-2.0 |
| 彗星 / 小惑星 | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | パブリックドメイン |
| 深宇宙天体 | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| 日月食 | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| 光害 | [光害アトラス](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| オーロラ予報 | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | パブリックドメイン |
| 衛星軌道計算 | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| 衛星軌道要素（TLE） | [CelesTrak](https://celestrak.org/) | T. S. Kelso | パブリックドメイン |
| 地名検索 | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| 中国本土の地名 | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| 欧文フォント | [Source Serif](https://github.com/adobe-fonts/source-serif) | Adobe | OFL |
| CJK フォント | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| データ解凍 | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |
