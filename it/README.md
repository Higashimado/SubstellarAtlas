# <img src="../img/mark.svg" alt="" width="39" style="vertical-align: text-bottom"> Substellar Atlas

[简体中文](../zh-Hans/README.md) · [繁體中文](../zh-Hant/README.md) · [English](../en/README.md) · [Français](../fr/README.md) · [Español](../es/README.md) · **Italiano** · [日本語](../ja/README.md)

<p align="center">
  <img src="../docs/demo/world_map.png" width="100%">
</p>

Il Substellar Atlas parte da un'idea guida, il *punto substellare*: proietta la sfera celeste sulla superficie della Terra e sovrappone le due. Su questa mappa ogni corpo celeste si colloca nella posizione geografica del suo punto substellare, derivando con la Terra e ruotando lentamente con un periodo di 23 h 56 min. Il gioco fra cielo e Terra rivela naturalmente dove ogni tipo di evento astronomico è visibile sull'intero globo: giorno e notte, i pianeti, gli oggetti del cielo profondo, le eclissi, l'aurora, i satelliti artificiali e molto altro.

## Concezione

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *— Sima Qian, Memorie storiche, «Trattato degli uffici celesti» (I sec. a.C.): a seconda delle dimore lunari presso cui Mercurio appare agli equinozi e ai solstizi, a ciascuna regione del regno — Qi, Chu, Han, gli Stati centrali — viene assegnata la propria porzione di cielo. Una formulazione antica del fēnyě.*

<p align="center">
  <img src="../docs/demo/xingguan_wuzhuhou.png" width="100%">
</p>

Il cielo ha le sue costellazioni; la Terra ha le sue regioni. Collegare i fenomeni del cielo ai territori del suolo è un'idea antica quanto l'astronomia e l'astrologia stesse: la Cina antica associava le ventotto dimore lunari alle Nove Province e agli Stati feudali tramite il **分野** (*fēnyě*, «assegnazione dei campi»), mentre nel mondo greco-romano Tolomeo propose corrispondenze fra i dodici segni dello zodiaco e le nazioni. La geodesia moderna conferisce a questo legame una forma rigorosa: proietta un corpo verticalmente sulla Terra e il punto di superficie che incontra è il suo punto substellare, unico ed esattamente calcolabile. Rispetto a un planisfero statico, la mappa stellare proiettata presenta queste caratteristiche:

* **Rotazione verso ovest** — Nel sistema di riferimento della sfera celeste la Terra ruota da est a ovest in un giorno siderale, ma vista dalla Terra stessa la direzione apparente è esattamente invertita.
* **Est–ovest speculare** — Si guarda la mappa stellare dall'alto e dall'esterno, al contrario di quando si alza lo sguardo al cielo notturno dall'interno; est e ovest risultano invertiti rispetto all'osservazione ordinaria.
* **Il vicino appare più grande** — I corpi sono disegnati alla loro dimensione apparente, non reale: la Luna, vicina alla Terra, occupa una superficie molto maggiore dei pianeti o degli oggetti del cielo profondo.

## Funzionalità

### Livelli

La mappa di base usa un tema scuro: CARTO Dark Matter come predefinito, con Stadia Alidade Smooth Dark come alternativa. I livelli di dati sviluppati o integrati dal sito sono:

| Categoria | Livelli |
|---|---|
| Stelle / costellazioni / xingguan | Stelle, oggetti del cielo profondo, sciami meteorici, costellazioni / uffici stellari (xingguan) / asterismi, etichette multilingue, griglie di coordinate |
| Sole / Luna / pianeti | Rendering del disco, rendering delle fasi, veli di luce solare / lunare |
| Eclissi | Elenco eventi, area di visibilità, diagrammi di magnitudine |
| Inquinamento luminoso | Rendering a tasselli (D. J. Lorenz) |
| Ovale aurorale | Area di visibilità (NOAA SWPC OVATION) |
| Satelliti | Area di visibilità (CelesTrak) |

### Bussola dell'osservatore

Fai doppio clic in un punto qualsiasi della mappa per richiamare e bloccare la **bussola dell'osservatore**, che mostra le direzioni di sorgere e tramonto del Sole e della Luna, oltre alla posizione attuale del Sole e della Luna. Le curve gialla e blu sono le traiettorie solare e lunare del giorno. Con la bussola bloccata, fare clic sull'icona o sull'etichetta di un corpo prolunga il suo **raggio di rilevamento**, e fare clic sul suo punto substellare traccia la linea di cerchio massimo dalla tua posizione a quel punto. Il pannello informativo a destra fornisce i dettagli del luogo e i dati di osservazione del giorno; fai clic su un orario nel pannello dati per saltare a quell'istante.

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### Interazione con le eclissi

Attivare il livello delle eclissi apre l'elenco delle eclissi a sinistra. Saltando dall'elenco all'istante di un evento, vedrai le curve inviluppo colorate che delimitano l'area di visibilità dell'intero evento, insieme all'anello inviluppo grigio che segna l'area di visibilità in tempo reale. Premi il pulsante di riproduzione in basso a destra per vedere l'area di visibilità di un'eclissi solare spostarsi nel tempo.

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

La sezione eclissi del pannello informativo a destra fornisce le **circostanze locali** nel luogo selezionato. Il diagramma dell'eclissi lunare disegna il passaggio della Luna nell'ombra della Terra; il diagramma dell'eclissi solare traccia il percorso del Sole nel cielo, dal primo all'ultimo contatto.

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### Sovrapposizione di livelli

Il progetto consente di sovrapporre contemporaneamente livelli di dati da più fonti — inquinamento luminoso, ovale aurorale e satelliti, ad esempio — con un meccanismo di conflitto fra livelli (i livelli costellazioni e inquinamento luminoso, ad esempio, non possono essere aperti insieme) che impedisce alle informazioni di confondersi. Il livello satelliti disegna le tracce al suolo in verde, segnala in oro i tratti in cui un satellite può produrre un bagliore sopra la fascia crepuscolare al suolo, e usa un cerchio massimo centrato sull'icona del satellite per indicarne l'area di visibilità. Le sezioni aurora, inquinamento luminoso e satelliti del pannello informativo a destra forniscono informazioni di osservazione dettagliate.

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## Set di dati

### Eclissi (2000–2049)

Il set di dati delle eclissi solari contiene gli elementi di Bessel usati per calcolare gli istanti e le posizioni dei contatti, insieme alle curve inviluppo al suolo che descrivono la copertura di ciascun evento (linea centrale dell'ombra, limiti nord/sud dell'ombra, linee di iso-magnitudine, limiti nord/sud della penombra, linee di magnitudine massima al sorgere/tramonto del Sole, curve di sorgere/tramonto, ecc.); il set di dati delle eclissi lunari contiene solo un indice. Attualmente copre 112 eclissi solari e 114 lunari fra il 2000 e il 2049. I vettori di posizione del Sole e della Luna usati nei calcoli provengono da [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19.

**Nota:** l'ombra in tempo reale e l'area di copertura di un'eclissi solare, così come l'area di copertura di un'eclissi lunare, sono calcolate in fase di esecuzione.

**Struttura delle cartelle**

| File | Contenuto |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | Indice delle eclissi solari |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | Indice delle eclissi lunari |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | Area di visibilità di un'eclissi solare |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | Note sul formato |


### Nomi tradizionali cinesi delle stelle

Il progetto fornisce un set di dati multilingue di nomi tradizionali cinesi delle stelle indicizzati per HIP, che attualmente raccoglie 3035 nomi tradizionali di stelle e 312 voci di uffici stellari (xingguan). Le voci si basano principalmente sul catalogo dei nomi tradizionali cinesi delle stelle fornito dalla comunità di [Stellarium](https://stellarium.org/), con voci integrative tratte dal [sito personale di Yu Zhaohuan](https://yzhxxzxy.github.io/cn/index.html), da [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement), da Wikipedia e da altre fonti collaborative. Le linee degli uffici stellari cinesi provengono dai dati celesti di d3-celestial. Le traduzioni multilingue (inglese, francese, spagnolo, italiano) offrono sia una traslitterazione sia una traduzione per significato.

**Struttura delle cartelle**

| File | Contenuto |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | Informazioni sugli uffici stellari |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | Linee degli uffici stellari |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | Nomi tradizionali delle stelle e traduzioni |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | Nomi degli uffici stellari e traduzioni |


### Toponimi della Cina continentale

Il progetto si basa principalmente sul database cities15000 di [GeoNames](https://www.geonames.org/) per la ricerca diretta e inversa, ma le sue coordinate delle città e i nomi multilingue sono spesso incompleti. Per la Cina continentale, il progetto assume come base l'elenco 2023 di borghi e comuni fornito da [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage), lo converte in formato JSON e lo unisce al database delle città GeoNames. Integra inoltre le traduzioni cinesi di alcuni toponimi di GeoNames, garantendo una copertura bilingue cinese/giapponese nell'Asia orientale.

| File | Contenuto |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | Database di toponimi ampliato |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | Integrazioni di nomi cinesi/giapponesi |

## Crediti e licenza

Il codice proprio del progetto è rilasciato sotto **GNU General Public License v3.0**; vedere [LICENSE](../LICENSE) per i dettagli. Codice, dati e font di terze parti restano sotto le rispettive licenze.

| Uso | Componente (versione) | Autore / Fonte | Licenza |
|---|---|---|---|
| Motore cartografico | [Leaflet](https://leafletjs.com/) 1.9.4 | Volodymyr Agafonkin | BSD-2-Clause |
| Tasselli cartografici | [OpenStreetMap](https://www.openstreetmap.org/copyright) | Comunità OpenStreetMap | ODbL |
| Terminatore giorno/notte | [Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator) 1.1.0 | Jörg Dietrich | MIT |
| Calcoli astronomici | [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 | Don Cross | MIT |
| Posizione del Sole | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 | Volodymyr Agafonkin | BSD-2-Clause |
| Calendario lunare | [lunar-javascript](https://github.com/6tail/lunar-javascript) 1.7.7 | 6tail | MIT |
| Linee delle costellazioni | [d3-celestial](https://github.com/ofrohn/d3-celestial) | Olaf Frohn | BSD |
| Dati stellari | [Catalogo HYG](https://www.astronexus.com/projects/hyg) | David Nash | CC BY-SA 4.0 |
| Nomi tradizionali cinesi delle stelle | [Stellarium](https://stellarium.org/) | Comunità Stellarium | CC BY-SA |
| Nomi tradizionali cinesi delle stelle | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | Guanjin0562 | GPL-2.0 |
| Comete / asteroidi | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | Pubblico dominio |
| Oggetti del cielo profondo | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| Eclissi | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| Inquinamento luminoso | [Atlante dell'inquinamento luminoso](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| Previsione delle aurore | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | Pubblico dominio |
| Propagazione dei satelliti | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| Elementi orbitali (TLE) | [CelesTrak](https://celestrak.org/) | T. S. Kelso | Pubblico dominio |
| Ricerca di toponimi | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| Toponimi della Cina continentale | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| Font latini | [Source Serif](https://github.com/adobe-fonts/source-serif) | Adobe | OFL |
| Font CJK | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| Decompressione | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |
