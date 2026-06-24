# <img src="../img/mark.svg" alt="" width="39"> Substellar Atlas

[简体中文](../zh-Hans/README.md) · [繁體中文](../zh-Hant/README.md) · [English](../en/README.md) · [Français](../fr/README.md) · **Español** · [Italiano](../it/README.md) · [日本語](../ja/README.md)

<p align="center">
  <img src="../docs/demo/world_map.png" width="100%">
</p>

Substellar Atlas es una visualización construida sobre el concepto del *punto subestelar*. La esfera celeste se proyecta sobre la superficie de la Tierra, y ambas se superponen. En este mapa, cada cuerpo celeste se sitúa en la ubicación geográfica de su punto subestelar, desplazándose con la Tierra y girando lentamente con un período de 23 h 56 min. La interacción entre el cielo y la Tierra revela de forma natural dónde es visible cada tipo de evento astronómico en todo el globo: día y noche, planetas, objetos de cielo profundo, eclipses, auroras, satélites artificiales y más.

## Concepto

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *— Sima Qian, Memorias históricas, «Tratado de los oficios celestes» (siglo I a. C.): según la mansión lunar junto a la que aparece Mercurio en los equinoccios y los solsticios, a cada región del reino (Qi, Chu, Han, los Estados Centrales) se le asigna su propio cuadrante del cielo. Una formulación temprana del fēnyě.*

<p align="center">
  <img src="../docs/demo/xingguan_wuzhuhou.png" width="100%">
</p>

El cielo tiene sus constelaciones; la Tierra tiene sus regiones. Vincular los fenómenos del cielo con las áreas del suelo es una idea tan antigua como la astronomía y la astrología mismas: la antigua China asoció las veintiocho mansiones lunares con las Nueve Provincias y los estados feudales mediante el **分野** (*fēnyě*, «asignación de campos»), mientras que en el mundo grecorromano Ptolomeo propuso correspondencias entre los doce signos del zodíaco y las naciones. Algunos tacharon el esquema de descabellado, pero revelaba una simetría y un isomorfismo entre el cielo y la Tierra, una correspondencia que ha alimentado la imaginación y la reflexión de todas las épocas desde entonces.

La geodesia moderna da a este vínculo una forma rigurosa: ```lat = Dec, lon = RA − GMST```. En concreto, un cuerpo proyectado verticalmente sobre la Tierra encuentra la superficie en su punto subestelar, único y calculable con exactitud. Comparado con un mapa del mundo estático, el mapa estelar proyectado presenta las siguientes características:

* **Rotación hacia el oeste**: el mapa estelar gira con la esfera celeste a lo largo de un día sidéreo, exactamente al revés que la rotación propia de la Tierra, de modo que las estrellas se desplazan lentamente hacia el oeste sobre el suelo fijo.
* **Este-oeste invertido**: el observador mira el mapa estelar desde fuera, lo contrario de mirar el cielo nocturno desde dentro, de modo que el este y el oeste quedan invertidos respecto a la observación habitual.
* **Lo más cercano se ve más grande**: los cuerpos se dibujan a su tamaño aparente, no físico. La Luna, cercana a la Tierra, ocupa un área mucho mayor que los planetas o los objetos de cielo profundo.

## Características

### Capas

El mapa base usa un tema oscuro: [CARTO Dark Matter](https://github.com/cartodb/basemap-styles) por defecto, con la opción de cambiar a [Stadia Alidade Smooth Dark](https://docs.stadiamaps.com/map-styles/alidade-smooth-dark/) desde el control de capas en la esquina superior derecha. El control de capas en la esquina superior izquierda activa las capas de datos desarrolladas e integradas por el sitio:

| Categoría | Capas |
|---|---|
| Estrellas / Constelaciones / Xingguan | Estrellas, objetos de cielo profundo, lluvias de meteoros, constelaciones / xingguan / asterismos, etiquetas multilingües, líneas de referencia de coordenadas |
| Sol / Luna / Planetas | Renderizado de discos, renderizado de fases, velos de luz solar / lunar |
| Eclipses | Lista de eventos, zona de visibilidad, circunstancias locales y diagramas |
| Contaminación lumínica | Renderizado de datos (D. J. Lorenz) |
| Óvalo auroral | Renderizado de datos (NOAA SWPC OVATION) |
| Satélites | Renderizado de datos (CelesTrak) |

### Brújula del observador

La **brújula del observador** es una herramienta para leer los azimutes de los cuerpos celestes desde un lugar concreto. Un doble clic en cualquier punto del mapa la hace aparecer y la fija. Con las capas correspondientes activadas, una brújula fijada puede mostrar:
- las direcciones de salida y puesta del Sol, el azimut actual del Sol y su trayectoria del día;
- las direcciones de salida y puesta de la Luna, el azimut actual de la Luna y su trayectoria del día;
- la envolvente anual de las trayectorias diarias del Sol;
- los azimutes actuales de los planetas visibles en el cielo.

Un clic en un icono o una etiqueta de la brújula extiende su **rayo de azimut**. Mientras la brújula está visible, un clic en el punto subestelar de un cuerpo traza el círculo máximo que une la ubicación del observador con ese punto. El panel de información de la derecha ofrece datos detallados sobre el lugar junto con los datos de observación del día para el Sol, la Luna y los planetas; un clic en una hora del panel de datos lleva a ese instante.

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### Interacción con los eclipses

Durante un eclipse, el mapa muestra las curvas envolventes precargadas de su zona de visibilidad junto con el anillo envolvente calculado en tiempo real para la zona de visibilidad instantánea. El panel de la izquierda presenta la lista de eclipses de 2000 a 2049; el panel de la derecha presenta el próximo eclipse visible desde el lugar seleccionado, junto con las circunstancias locales de cualquier eclipse en curso.

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

El diagrama de eclipse de Luna se presenta sobre un fondo de **mapa de la sombra** de la penumbra y la umbra de la Tierra, mostrando el paso de la Luna a través de ellas. El diagrama de eclipse de Sol es un **trazado celeste** del Sol a lo largo del evento. Bajo cada diagrama figuran la altura y el azimut de la Luna o el Sol en el máximo del eclipse y en cada contacto.

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### Grabados celestes

El Sol, la Luna y los planetas (los cuerpos que muestran un disco visible) aparecen en el mapa como iconos al estilo de grabado, al modo de las láminas grabadas que el fabricante de instrumentos ópticos y cartógrafo británico [John Browning](https://en.wikipedia.org/wiki/John_Browning_(scientific_instrument_maker)) publicó en *Monthly Notices of the Royal Astronomical Society* en 1870. Cada disco subtiende exactamente su diámetro aparente en el mapa y varía, por tanto, con la distancia del cuerpo a la Tierra; la sombra sobre el disco se representa a partir de su ángulo de fase. Para los cuerpos del Sistema Solar, el tamaño de representación en el mapa corresponde al diámetro aparente como sigue:

- el Sol y la Luna abarcan como máximo unos 0,53°, es decir, alrededor de 60 km proyectados sobre la superficie de la Tierra, el tamaño de una ciudad gigante;
- Júpiter abarca como máximo unos 50″, es decir, alrededor de 1 km en la superficie, el tamaño de un barrio grande;
- Urano abarca como máximo unos 4″, es decir, alrededor de 80 m en la superficie, el tamaño de un campo de fútbol reglamentario.


<p align="center">
  <img src="../docs/demo/jupiter_over_hong_kong.png" width="100%">
</p>

### Velos de luz solar y lunar

Al activar la capa del Sol o de la Luna también aparece su velo de luz. El velo solar se compone de cuatro bandas de brillo constante, correspondientes respectivamente al día pleno y a los crepúsculos civil, náutico y astronómico. El velo lunar varía en brillo según la iluminación de la Luna: el más brillante en la Luna llena, casi invisible cerca de la Luna nueva. Durante un eclipse de Luna, adquiere un tono rojo herrumbre que se intensifica con la magnitud de la umbra. El control de capas en la esquina superior derecha activa y desactiva los velos de luz.

<p align="center">
  <img src="../docs/demo/moonlight.png" width="100%">
</p>

### Superposición de datos

Además de las capas astronómicas, el proyecto integra datos de contaminación lumínica, óvalo auroral y satélites, que pueden superponerse todos simultáneamente. Para evitar que la información se mezcle, un mecanismo de conflicto de capas cierra automáticamente las capas incompatibles. Las capas de constelaciones y de contaminación lumínica, por ejemplo, no pueden estar abiertas a la vez. Las capas de contaminación lumínica y de óvalo auroral siguen las convenciones de color de sus sitios de origen. La capa de satélites dibuja las trazas en tierra en verde bronce, y los tramos dorados marcan los lugares donde puede verse el destello de un satélite desde el suelo. Las secciones de contaminación lumínica, aurora y satélites del panel de información de la derecha ofrecen datos de observación detallados. Téngase en cuenta que los datos de óvalo auroral y de satélites son predicciones casi en tiempo real: una vez caducados los datos, la capa queda bloqueada y en gris.

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## Conjuntos de datos

### Eclipses (2000–2049)

El proyecto utiliza los vectores de posición del Sol y la Luna proporcionados por [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 para calcular los 112 eclipses de Sol y 114 eclipses de Luna entre 2000 y 2049. El conjunto de datos contiene los elementos de Bessel empleados para determinar las horas y posiciones de los contactos de cada eclipse de Sol, junto con las curvas envolventes en tierra que describen su zona de visibilidad (línea central de la umbra, límites norte y sur de la umbra, líneas de isomagnitud, límites norte y sur de la penumbra, líneas de máximo en la salida y la puesta del Sol, curvas de salida y puesta, etc.); el conjunto de datos de eclipses de Luna solo contiene un índice.

**Nota:** la sombra en tiempo real y la zona de visibilidad de un eclipse de Sol, así como la zona de visibilidad de un eclipse de Luna, quedan fuera del conjunto de datos: se representan en tiempo real mediante los mismos algoritmos.

**Estructura de directorios**

| Archivo | Contenido |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | Índice de eclipses de Sol |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | Índice de eclipses de Luna |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | Zona de visibilidad de eclipses de Sol |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | Notas de formato |


### Nombres tradicionales chinos de estrellas

El proyecto ofrece un conjunto de datos multilingüe de nombres tradicionales chinos de estrellas indexados por HIP, que reúne actualmente 3035 nombres de estrellas y 312 entradas de xingguan (oficios estelares). Las entradas se basan principalmente en el catálogo de nombres tradicionales chinos de estrellas de la comunidad [Stellarium](https://stellarium.org/), con entradas complementarias tomadas del [sitio personal de Yu Zhaohuan](https://yzhxxzxy.github.io/cn/index.html), de [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement), de Wikipedia y de otros recursos colaborativos. Las líneas de los xingguan chinos provienen de los datos celestes de d3-celestial. Las traducciones multilingües (inglés, francés, español, italiano) ofrecen tanto una transcripción fonética como una traducción semántica.

**Estructura de directorios**

| Archivo | Contenido |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | Información de los xingguan |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | Líneas de los xingguan |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | Nombres tradicionales de estrellas y traducciones |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | Nombres de los xingguan y traducciones |


### Topónimos de China continental

El proyecto se apoya principalmente en la base cities15000 de [GeoNames](https://www.geonames.org/) para la búsqueda directa e inversa, pero sus coordenadas de ciudades y sus nombres multilingües suelen estar incompletos. Para China continental, el proyecto toma la lista de 2023 de localidades de nivel cantonal de [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage), la convierte a JSON y la fusiona en la base de datos de ciudades de GeoNames. También completa las traducciones al chino de algunos topónimos de GeoNames, garantizando una cobertura bilingüe chino/japonés en Asia Oriental.

| Archivo | Contenido |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | Base de topónimos ampliada |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | Complementos de nombres chino/japonés |

## Créditos y licencia

El código propio del proyecto se publica bajo [**GNU General Public License v3.0**](../LICENSE); el código, los datos y las fuentes de terceros se mantienen bajo sus respectivas licencias.

| Uso | Componente (versión) | Autor / Fuente | Licencia |
|---|---|---|---|
| Motor cartográfico | [Leaflet](https://leafletjs.com/) 1.9.4 | Volodymyr Agafonkin | BSD-2-Clause |
| Teselas de mapa | [OpenStreetMap](https://www.openstreetmap.org/copyright) | comunidad OpenStreetMap | ODbL |
| Terminador día/noche | [Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator) 1.1.0 | Jörg Dietrich | MIT |
| Astronomía | [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 | Don Cross | MIT |
| Posición del Sol | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 | Volodymyr Agafonkin | BSD-2-Clause |
| Calendario lunar | [lunar-javascript](https://github.com/6tail/lunar-javascript) 1.7.7 | 6tail | MIT |
| Líneas de constelaciones | [d3-celestial](https://github.com/ofrohn/d3-celestial) | Olaf Frohn | BSD |
| Datos estelares | [HYG database](https://www.astronexus.com/projects/hyg) | David Nash | CC BY-SA 4.0 |
| Nombres tradicionales chinos de estrellas | [Stellarium](https://stellarium.org/) | comunidad Stellarium | CC BY-SA |
| Nombres tradicionales chinos de estrellas | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | Guanjin0562 | GPL-2.0 |
| Cometas / Asteroides | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | Dominio público |
| Objetos de cielo profundo | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| Eclipses | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| Contaminación lumínica | [Atlas de contaminación lumínica](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| Predicción de auroras | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | Dominio público |
| Propagación de satélites | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| Elementos orbitales de satélites (TLE) | [CelesTrak](https://celestrak.org/) | T. S. Kelso | Dominio público |
| Búsqueda de topónimos | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| Lugares de China continental | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| Fuentes latinas | [Source Serif](https://github.com/adobe-fonts/source-serif) | Adobe | OFL |
| Fuentes CJK | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| Descompresión | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |
