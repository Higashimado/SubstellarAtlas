# <img src="../img/mark.svg" alt="" width="39"> Substellar Atlas

[简体中文](../zh-Hans/README.md) · [繁體中文](../zh-Hant/README.md) · [English](../en/README.md) · [Français](../fr/README.md) · [Español](../es/README.md) · **Italiano** · [日本語](../ja/README.md)

<p align="center">
  <img src="../docs/demo/constellation.png" width="100%">
</p>

**Sito web**: https://higashimado.github.io/SubstellarAtlas/
Substellar Atlas è una visualizzazione costruita sul concetto di *punto sottostellare*. La sfera celeste viene proiettata sulla superficie della Terra, e le due vengono sovrapposte. Su questa mappa ogni corpo celeste si trova nella posizione geografica del suo punto sottostellare, spostandosi con la Terra e ruotando lentamente con un periodo di 23 h 56 min. L'interazione tra cielo e Terra rivela in modo naturale dove ogni tipo di evento astronomico è visibile in tutto il globo: giorno e notte, pianeti, comete, oggetti del cielo profondo, eclissi, aurore, satelliti artificiali e altro ancora.

## Concetto

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *— Sima Qian, Memorie storiche, «Trattato degli uffici celesti» (I sec. a.C.): a seconda della dimora lunare presso cui Mercurio appare agli equinozi e ai solstizi, a ciascuna regione del regno (Qi, Chu, Han, gli Stati Centrali) viene assegnato il proprio quadrante del cielo. Una prima formulazione del fēnyě.*

<p align="center">
  <img src="../docs/demo/xingguan.png" width="100%">
</p>

Il cielo ha le sue costellazioni; la Terra ha le sue regioni. Collegare i fenomeni del cielo alle aree del suolo è un'idea antica quanto l'astronomia e l'astrologia stesse: l'antica Cina associò le ventotto dimore lunari alle Nove Province e agli stati feudali tramite il **分野** (*fēnyě*, «assegnazione dei campi»), mentre nel mondo greco-romano Tolomeo propose corrispondenze tra i dodici segni dello zodiaco e le nazioni. Alcuni giudicarono lo schema inverosimile, ma esso rivelava una simmetria e un isomorfismo tra cielo e Terra, una corrispondenza che ha nutrito l'immaginazione e la riflessione di ogni epoca successiva.

La geodesia moderna conferisce a questo legame una forma rigorosa: ```lat = Dec, lon = RA − GMST```. In concreto, un corpo proiettato verticalmente sulla Terra incontra la superficie nel suo punto sottostellare, unico e calcolabile con esattezza. Rispetto a una mappa del mondo statica, la mappa stellare proiettata presenta le caratteristiche seguenti:

* **Rotazione verso ovest**: la mappa stellare ruota con la sfera celeste nell'arco di un giorno siderale, esattamente al contrario della rotazione propria della Terra, così che le stelle si spostano lentamente verso ovest sul suolo fisso.
* **Est-ovest invertito**: l'osservatore guarda la mappa stellare dall'esterno, al contrario dello sguardo rivolto al cielo notturno dall'interno, così che est e ovest risultano invertiti rispetto all'osservazione abituale.
* **Più vicino appare più grande**: i corpi sono disegnati alla loro dimensione apparente, non fisica; la Luna, vicina alla Terra, appare assai più grande dei pianeti lontani.

## Caratteristiche

### Livelli

La mappa di base usa un tema scuro: [CARTO Dark Matter](https://github.com/cartodb/basemap-styles) come impostazione predefinita, con la possibilità di passare a [Stadia Alidade Smooth Dark](https://docs.stadiamaps.com/map-styles/alidade-smooth-dark/) dal controllo dei livelli in alto a destra. Il controllo dei livelli in alto a sinistra attiva i livelli di dati sviluppati e integrati dal sito:

| Categoria | Livelli |
|---|---|
| Stelle / Costellazioni / Xingguan | Stelle, oggetti del cielo profondo, la Via Lattea, sciami meteorici, costellazioni / xingguan / asterismi, etichette multilingue, linee di riferimento delle coordinate |
| Sole / Luna | Resa dei dischi, resa delle fasi, veli di luce solare / lunare |
| Pianeti / Comete | Resa dei dischi, resa delle fasi, lune gioviane / saturniane, asteroidi, comete, elenco degli eventi |
| Eclissi | Elenco degli eventi, area di visibilità, circostanze locali e diagrammi |
| Inquinamento luminoso | Resa dei dati (D. J. Lorenz) |
| Ovale aurorale | Resa dei dati (NOAA SWPC OVATION) |
| Satelliti | Resa dei dati (CelesTrak) |

### Bussola dell'osservatore

La **bussola dell'osservatore** è uno strumento per leggere gli azimut dei corpi celesti da un luogo determinato. Un doppio clic in un punto qualsiasi della mappa la fa comparire e la blocca. Con i livelli pertinenti attivi, una bussola bloccata può mostrare:
- le direzioni di levata e tramonto del Sole, l'azimut attuale del Sole e il suo percorso del giorno;
- le direzioni di levata e tramonto della Luna, l'azimut attuale della Luna e il suo percorso del giorno;
- l'inviluppo annuale dei percorsi giornalieri del Sole;
- gli azimut attuali dei pianeti visibili nel cielo.

Un clic su un'icona o un'etichetta della bussola estende il suo **raggio di azimut**. Mentre la bussola è visibile, un clic sul punto sottostellare di un corpo traccia il cerchio massimo che unisce la posizione dell'osservatore a quel punto. Il pannello informativo a destra fornisce informazioni dettagliate sul luogo insieme ai dati di osservazione del giorno per il Sole, la Luna e i pianeti; un clic su un orario nel pannello dati porta a quell'istante.

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### Veli di luce solare e lunare

L'attivazione del livello del Sole o della Luna fa comparire anche il suo velo di luce. Il velo solare è formato da quattro fasce di luminosità costante, corrispondenti rispettivamente al giorno pieno e ai crepuscoli civile, nautico e astronomico. Il velo lunare varia di luminosità secondo l'illuminazione della Luna: il più luminoso alla Luna piena, quasi invisibile in prossimità della Luna nuova. Durante un'eclissi di Luna assume una tinta rosso ruggine che si accentua con la magnitudine dell'ombra. Il controllo dei livelli in alto a destra attiva e disattiva i veli di luce.

<p align="center">
  <img src="../docs/demo/moonlight.png" width="100%">
</p>

### Incisioni celesti

Il Sole, la Luna, i pianeti e alcune comete (i corpi che mostrano un disco visibile) compaiono sulla mappa come icone in stile incisione, sul modello delle tavole incise che il costruttore di strumenti ottici e cartografo britannico [John Browning](https://en.wikipedia.org/wiki/John_Browning_(scientific_instrument_maker)) pubblicò nelle *Monthly Notices of the Royal Astronomical Society* nel 1870. Ogni disco sottende esattamente il suo diametro apparente sulla mappa e varia quindi con la distanza del corpo dalla Terra; l'ombra sul disco è resa a partire dal suo angolo di fase. Per i corpi del Sistema solare, la dimensione di resa sulla mappa corrisponde al diametro apparente come segue:

- il Sole e la Luna si estendono al massimo per circa 0,53°, ossia circa 60 km proiettati sulla superficie della Terra, la dimensione di una città gigante;
- Giove si estende al massimo per circa 50″, ossia circa 1 km in superficie, la dimensione di un grande quartiere;
- Urano si estende al massimo per circa 4″, ossia circa 80 m in superficie, la dimensione di un campo da calcio regolamentare.


<p align="center">
  <img src="../docs/demo/jupiter_over_hong_kong.png" width="100%">
</p>

### Traiettorie dei corpi

Il livello Pianeti e Comete offre un elenco di eventi legati a congiunzioni e opposizioni, con filtri associati a corpi specifici; un clic su un evento porta al punto in cui il corpo si trova nell'istante in cui l'evento si verifica. All'arrivo, il percorso del pianeta o della cometa nei giorni intorno all'evento si apre automaticamente, segnandone la posizione a date successive a un intervallo prestabilito. Un clic su un'etichetta oraria lungo la traiettoria porta a quell'istante. Oltre alla Luna e ai pianeti, l'elenco degli eventi copre attualmente tre dei maggiori asteroidi (Cerere, Pallade, Vesta) e le comete luminose scoperte tra il 2000 e il 2025 che raggiungono una magnitudine apparente pari o superiore a 6 (come [Tsuchinshan–ATLAS](https://it.wikipedia.org/wiki/Cometa_Tsuchinshan-ATLAS)).

<p align="center">
  <img src="../docs/demo/planet_tracks.png" width="100%">
</p>

### Interazione con le eclissi

Durante un'eclissi, la mappa mostra le curve di inviluppo precaricate della sua area di visibilità insieme all'anello di inviluppo calcolato in tempo reale per l'area di visibilità istantanea. Il pannello di sinistra presenta l'elenco delle eclissi dal 2000 al 2099; il pannello di destra presenta la prossima eclissi visibile dal luogo selezionato, insieme alle circostanze locali di qualsiasi eclissi in corso.

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

Il diagramma dell'eclissi di Luna si presenta su uno sfondo di **mappa dell'ombra** della penombra e dell'ombra della Terra, mostrando il passaggio della Luna attraverso di esse. Il diagramma dell'eclissi di Sole è un **tracciato celeste** del Sole nel corso dell'evento. Sotto ciascun diagramma sono riportati l'altezza e l'azimut della Luna o del Sole al massimo dell'eclissi e a ciascun contatto.

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>


### Ovale aurorale, inquinamento luminoso e satelliti

Oltre ai livelli astronomici, il progetto integra i dati di inquinamento luminoso, ovale aurorale e satelliti, che possono essere sovrapposti tutti insieme. Per evitare che le informazioni si confondano, un meccanismo di conflitto tra livelli chiude automaticamente i livelli incompatibili. I livelli delle costellazioni e dell'inquinamento luminoso, ad esempio, non possono essere aperti contemporaneamente. I livelli di inquinamento luminoso e di ovale aurorale seguono le convenzioni di colore dei rispettivi siti di origine. Il livello dei satelliti disegna le tracce al suolo in verde bronzo, e i tratti dorati segnalano i punti in cui il lampo di un satellite può essere osservato da terra. Le sezioni inquinamento luminoso, aurora e satelliti del pannello informativo a destra forniscono informazioni di osservazione dettagliate. I dati di ovale aurorale e di satelliti sono previsioni in tempo quasi reale: una volta scaduti i dati, il livello viene bloccato e ingrigito.

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## Set di dati

### Eclissi (2000–2099)

Il progetto utilizza i vettori di posizione del Sole e della Luna forniti da [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 per calcolare le 226 eclissi di Sole e 228 eclissi di Luna tra il 2000 e il 2099. Il set di dati contiene gli elementi di Bessel impiegati per determinare gli orari e le posizioni dei contatti di ciascuna eclissi di Sole, insieme alle curve di inviluppo al suolo che ne descrivono l'area di visibilità (linea centrale dell'ombra, limiti nord e sud dell'ombra, linee di isomagnitudine, limiti nord e sud della penombra, linee di massimo al sorgere e al tramonto del Sole, curve di levata e tramonto, ecc.); il set di dati delle eclissi di Luna contiene solo un indice.

**Nota:** l'ombra in tempo reale e l'area di visibilità di un'eclissi di Sole, così come l'area di visibilità di un'eclissi di Luna, non fanno parte del set di dati: vengono calcolate in tempo reale dagli stessi algoritmi.

**Struttura delle cartelle**

| File | Contenuto |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | Indice delle eclissi di Sole |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | Indice delle eclissi di Luna |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | Area di visibilità delle eclissi di Sole |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | Note sul formato |


### Nomi stellari tradizionali cinesi

Il progetto fornisce un set di dati multilingue di nomi stellari tradizionali cinesi indicizzati per HIP, che raccoglie attualmente 3035 nomi di stelle e 312 voci di xingguan (uffici stellari). Le voci si basano principalmente sul catalogo di nomi stellari tradizionali cinesi della comunità [Stellarium](https://stellarium.org/), con voci integrative tratte dal [sito personale di Yu Zhaohuan](https://yzhxxzxy.github.io/cn/index.html), da [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement), da Wikipedia e da altre risorse collaborative. Le linee degli xingguan cinesi provengono dai dati celesti di d3-celestial. Le traduzioni multilingue (inglese, francese, spagnolo, italiano) offrono sia una trascrizione fonetica sia una traduzione semantica.

<p align="center">
  <img src="../docs/demo/xingguan_translation_wudizuo.png" width="80%">
</p>

**Struttura delle cartelle**

| File | Contenuto |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | Informazioni sugli xingguan |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | Linee degli xingguan |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | Nomi stellari tradizionali e traduzioni |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | Nomi degli xingguan e traduzioni |


### Toponimi della Cina continentale

Il progetto si basa principalmente sulla base cities15000 di [GeoNames](https://www.geonames.org/) per la ricerca diretta e inversa, ma le sue coordinate delle città e i suoi nomi multilingue sono spesso incompleti. Per la Cina continentale, il progetto riprende l'elenco 2023 delle località di livello cantonale di [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage), lo converte in JSON e lo unisce alla banca dati delle città di GeoNames. Integra inoltre le traduzioni cinesi di alcuni toponimi di GeoNames, garantendo una copertura bilingue cinese/giapponese in Asia orientale.

<p align="center">
  <img src="../docs/demo/place_lookup.png" width="80%">
</p>

**Struttura delle cartelle**

| File | Contenuto |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | Banca dati toponomastica ampliata |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | Integrazioni di nomi cinese/giapponese |

## Crediti e licenza

Il codice proprio del progetto è rilasciato sotto [**GNU General Public License v3.0**](../LICENSE) ; il codice, i dati e i caratteri di terze parti restano sotto le rispettive licenze.

| Uso | Componente (versione) | Autore / Fonte | Licenza |
|---|---|---|---|
| Motore cartografico | [Leaflet](https://leafletjs.com/) 1.9.4 | Volodymyr Agafonkin | BSD-2-Clause |
| Tasselli mappa | [OpenStreetMap](https://www.openstreetmap.org/copyright) | comunità OpenStreetMap | ODbL |
| Terminatore giorno/notte | [Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator) 1.1.0 | Jörg Dietrich | MIT |
| Astronomia | [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 | Don Cross | MIT |
| Posizione del Sole | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 | Volodymyr Agafonkin | BSD-2-Clause |
| Calendario lunare | [lunar-javascript](https://github.com/6tail/lunar-javascript) 1.7.7 | 6tail | MIT |
| Linee delle costellazioni | [d3-celestial](https://github.com/ofrohn/d3-celestial) | Olaf Frohn | BSD |
| Dati stellari | [HYG database](https://www.astronexus.com/projects/hyg) | David Nash | CC BY-SA 4.0 |
| Dati stellari | [Gaia DR3](https://www.cosmos.esa.int/gaia) | ESA / Gaia / DPAC | CC BY-NC 3.0 IGO |
| Nomi stellari tradizionali cinesi | [Stellarium](https://stellarium.org/) | comunità Stellarium | CC BY-SA |
| Nomi stellari tradizionali cinesi | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | Guanjin0562 | GPL-2.0 |
| Lune di Saturno | [TASS 1.7](https://ftp.imcce.fr/pub/ephem/satel/tass17/) | Vienne & Duriez / J. Gajdosik | MIT |
| Comete / Asteroidi | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | Dominio pubblico |
| Oggetti del cielo profondo | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| Eclissi | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| Inquinamento luminoso | [Atlante dell'inquinamento luminoso](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| Previsione delle aurore | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | Dominio pubblico |
| Propagazione dei satelliti | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| Elementi orbitali dei satelliti (TLE) | [CelesTrak](https://celestrak.org/) | T. S. Kelso | Dominio pubblico |
| Ricerca di toponimi | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| Luoghi della Cina continentale | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| Caratteri latini | [Spectral](https://fonts.google.com/specimen/Spectral) | Production Type | OFL |
| Caratteri CJK | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| Carattere epigrafico | [Cinzel](https://fonts.google.com/specimen/Cinzel) | Natanael Gama | OFL |
| Decompressione | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |