# <img src="../img/mark.svg" alt="" width="39" style="vertical-align: text-bottom"> Substellar Atlas

[简体中文](../zh-Hans/README.md) · [繁體中文](../zh-Hant/README.md) · [English](../en/README.md) · [Français](../fr/README.md) · **Español** · [Italiano](../it/README.md) · [日本語](../ja/README.md)

<p align="center">
  <img src="../docs/demo/world_map.png" width="100%">
</p>

El Substellar Atlas parte de una idea rectora, el *punto subestelar*: proyecta la esfera celeste sobre la superficie de la Tierra y superpone ambas. En este mapa cada cuerpo celeste se sitúa en la posición geográfica de su punto subestelar, derivando con la Tierra y girando lentamente con un período de 23 h 56 min. El juego entre el cielo y la Tierra revela de forma natural dónde es visible cada tipo de evento astronómico en todo el globo: día y noche, los planetas, objetos de cielo profundo, eclipses, la aurora, satélites artificiales y mucho más.

## Concepto

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *— Sima Qian, Memorias históricas, «Tratado de los oficios celestes» (s. I a. C.): según las mansiones lunares junto a las que aparece Mercurio en los equinoccios y solsticios, a cada región del reino —Qi, Chu, Han, los Estados centrales— se le asigna su propia porción del cielo. Una formulación temprana del fēnyě.*

<p align="center">
  <img src="../docs/demo/xingguan_wuzhuhou.png" width="100%">
</p>

El cielo tiene sus constelaciones; la Tierra tiene sus regiones. Vincular los fenómenos del cielo con los territorios del suelo es una idea tan antigua como la propia astronomía y astrología: la China antigua asociaba las veintiocho mansiones lunares con las Nueve Provincias y los Estados feudales mediante el **分野** (*fēnyě*, «asignación de campos»), mientras que en el mundo grecorromano Ptolomeo propuso correspondencias entre los doce signos del zodíaco y las naciones. La geodesia moderna da a este vínculo una forma rigurosa: proyecta un cuerpo verticalmente sobre la Tierra y el punto de superficie con el que se encuentra es su punto subestelar, único y exactamente calculable. Frente a un mapamundi estático, el mapa estelar proyectado presenta estas características:

* **Rotación hacia el oeste** — En el marco de la esfera celeste, la Tierra gira de este a oeste en un día sidéreo, pero vista desde la propia Tierra la dirección aparente es exactamente la inversa.
* **Este–oeste en espejo** — Se mira el mapa estelar desde arriba y desde fuera, al contrario que al alzar la vista al cielo nocturno desde dentro; este y oeste quedan invertidos respecto a la observación ordinaria.
* **Lo cercano se ve mayor** — Los cuerpos se dibujan a su tamaño aparente, no real: la Luna, cercana a la Tierra, ocupa mucha más superficie que los planetas o los objetos de cielo profundo.

## Funciones

### Capas

El mapa base usa un tema oscuro: CARTO Dark Matter por defecto, con Stadia Alidade Smooth Dark como alternativa. Las capas de datos desarrolladas o integradas por el sitio son:

| Categoría | Capas |
|---|---|
| Estrellas / constelaciones / xingguan | Estrellas, objetos de cielo profundo, lluvias de meteoros, constelaciones / oficios estelares (xingguan) / asterismos, etiquetas multilingües, cuadrículas de coordenadas |
| Sol / Luna / planetas | Renderizado del disco, renderizado de fases, velos de luz solar / lunar |
| Eclipses | Lista de eventos, zona de visibilidad, diagramas de magnitud |
| Contaminación lumínica | Renderizado en teselas (D. J. Lorenz) |
| Óvalo auroral | Zona de visibilidad (NOAA SWPC OVATION) |
| Satélites | Zona de visibilidad (CelesTrak) |

### Brújula del observador

Haz doble clic en cualquier punto del mapa para abrir y fijar la **brújula del observador**, que muestra las direcciones de salida y puesta del Sol y de la Luna, junto con la posición actual del Sol y la Luna. Las curvas amarilla y azul son las trayectorias solar y lunar del día. Con la brújula fijada, hacer clic en el icono o la etiqueta de un cuerpo prolonga su **radio de marcación**, y hacer clic en su punto subestelar traza la línea de círculo máximo desde tu ubicación hasta ese punto. El panel de información de la derecha ofrece los detalles del lugar y los datos de observación del día; haz clic en una hora del panel de datos para saltar a ese instante.

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### Interacción con eclipses

Activar la capa de eclipses abre la lista de eclipses a la izquierda. Al saltar desde la lista al instante de un evento, verás las curvas envolventes en color que delimitan la zona de visibilidad de todo el evento, junto con el anillo envolvente gris que marca la zona de visibilidad en tiempo real. Pulsa el botón de reproducción de la esquina inferior derecha para ver cómo la zona de visibilidad de un eclipse solar se desplaza con el tiempo.

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

La sección de eclipses del panel de información de la derecha ofrece las **circunstancias locales** en el lugar seleccionado. El diagrama de eclipse lunar dibuja el paso de la Luna por la sombra de la Tierra; el diagrama de eclipse solar traza el recorrido del Sol por el cielo, del primer al último contacto.

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### Superposición de capas

El proyecto admite superponer a la vez capas de datos de múltiples fuentes —contaminación lumínica, óvalo auroral y satélites, por ejemplo— con un mecanismo de conflicto de capas (las capas de constelaciones y de contaminación lumínica, por ejemplo, no pueden abrirse a la vez) que evita que la información se entremezcle. La capa de satélites dibuja las trazas terrestres en verde, señala en dorado los tramos donde un satélite puede destellar sobre la zona crepuscular del suelo, y usa un círculo máximo centrado en el icono del satélite para indicar su zona de visibilidad. Las secciones de aurora, contaminación lumínica y satélites del panel de información de la derecha ofrecen información de observación detallada.

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## Conjuntos de datos

### Eclipses (2000–2049)

El conjunto de datos de eclipses solares contiene los elementos de Bessel empleados para calcular los instantes y posiciones de los contactos, junto con las curvas envolventes en tierra que describen la cobertura de cada evento (línea central de la umbra, límites norte/sur de la umbra, líneas de isomagnitud, límites norte/sur de la penumbra, líneas de magnitud máxima en la salida/puesta del Sol, curvas de salida/puesta, etc.); el conjunto de datos de eclipses lunares solo contiene un índice. Actualmente cubre 112 eclipses solares y 114 lunares entre 2000 y 2049. Los vectores de posición del Sol y la Luna usados en el cálculo provienen de [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19.

**Nota:** la sombra en tiempo real y la zona de cobertura de un eclipse solar, así como la zona de cobertura de un eclipse lunar, se calculan en tiempo de ejecución.

**Estructura de directorios**

| Archivo | Contenido |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | Índice de eclipses solares |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | Índice de eclipses lunares |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | Zona de visibilidad de un eclipse solar |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | Notas de formato |


### Nombres de estrellas tradicionales chinos

El proyecto proporciona un conjunto de datos multilingüe de nombres de estrellas tradicionales chinos indexados por HIP, que actualmente reúne 3035 nombres de estrellas tradicionales y 312 entradas de oficios estelares (xingguan). Las entradas se basan principalmente en el catálogo de nombres de estrellas tradicionales chinos aportado por la comunidad de [Stellarium](https://stellarium.org/), con entradas complementarias procedentes del [sitio personal de Yu Zhaohuan](https://yzhxxzxy.github.io/cn/index.html), de [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement), de Wikipedia y de otras fuentes colaborativas. Las líneas de los oficios estelares chinos provienen de los datos celestes de d3-celestial. Las traducciones multilingües (inglés, francés, español, italiano) ofrecen tanto una transliteración como una traducción por el sentido.

**Estructura de directorios**

| Archivo | Contenido |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | Información de oficios estelares |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | Líneas de oficios estelares |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | Nombres de estrellas tradicionales y traducciones |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | Nombres de oficios estelares y traducciones |


### Topónimos de China continental

El proyecto se apoya principalmente en la base cities15000 de [GeoNames](https://www.geonames.org/) para la búsqueda directa e inversa, pero sus coordenadas de ciudades y nombres multilingües suelen estar incompletos. Para China continental, el proyecto toma como base la lista de 2023 de pueblos y municipios proporcionada por [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage), la convierte a formato JSON y la fusiona en la base de ciudades de GeoNames. También completa las traducciones chinas de algunos topónimos de GeoNames, garantizando una cobertura bilingüe chino/japonés en Asia Oriental.

| Archivo | Contenido |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | Base de topónimos ampliada |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | Complementos de nombres chinos/japoneses |

## Créditos y licencia

El código propio del proyecto se publica bajo **GNU General Public License v3.0**; véase [LICENSE](../LICENSE) para más detalles. El código, los datos y las fuentes de terceros se mantienen bajo sus respectivas licencias.

| Uso | Componente (versión) | Autor / Fuente | Licencia |
|---|---|---|---|
| Motor cartográfico | [Leaflet](https://leafletjs.com/) 1.9.4 | Volodymyr Agafonkin | BSD-2-Clause |
| Teselas cartográficas | [OpenStreetMap](https://www.openstreetmap.org/copyright) | Comunidad OpenStreetMap | ODbL |
| Terminador día/noche | [Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator) 1.1.0 | Jörg Dietrich | MIT |
| Cálculos astronómicos | [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 | Don Cross | MIT |
| Posición del Sol | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 | Volodymyr Agafonkin | BSD-2-Clause |
| Calendario lunar | [lunar-javascript](https://github.com/6tail/lunar-javascript) 1.7.7 | 6tail | MIT |
| Líneas de constelaciones | [d3-celestial](https://github.com/ofrohn/d3-celestial) | Olaf Frohn | BSD |
| Datos estelares | [Catálogo HYG](https://www.astronexus.com/projects/hyg) | David Nash | CC BY-SA 4.0 |
| Nombres de estrellas tradicionales chinos | [Stellarium](https://stellarium.org/) | Comunidad Stellarium | CC BY-SA |
| Nombres de estrellas tradicionales chinos | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | Guanjin0562 | GPL-2.0 |
| Cometas / asteroides | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | Dominio público |
| Objetos de cielo profundo | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| Eclipses | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| Contaminación lumínica | [Atlas de contaminación lumínica](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| Predicción de auroras | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | Dominio público |
| Propagación de satélites | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| Elementos orbitales (TLE) | [CelesTrak](https://celestrak.org/) | T. S. Kelso | Dominio público |
| Búsqueda de topónimos | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| Topónimos de China continental | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| Fuentes latinas | [Source Serif](https://github.com/adobe-fonts/source-serif) | Adobe | OFL |
| Fuentes CJK | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| Descompresión | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |
