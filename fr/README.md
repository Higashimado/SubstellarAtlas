# <img src="../img/mark.svg" alt="" width="39" style="vertical-align: text-bottom"> Substellar Atlas

[简体中文](../zh-Hans/README.md) · [繁體中文](../zh-Hant/README.md) · [English](../en/README.md) · **Français** · [Español](../es/README.md) · [Italiano](../it/README.md) · [日本語](../ja/README.md)

<p align="center">
  <img src="../docs/demo/world_map.png" width="100%">
</p>

Le Substellar Atlas part d'une idée directrice, le *point substellaire* : il projette la sphère céleste sur la surface de la Terre et superpose les deux. Sur cette carte, chaque corps céleste se place à la position géographique de son point substellaire, dérivant avec la Terre et tournant lentement avec une période de 23 h 56 min. Le jeu entre le ciel et la Terre révèle naturellement où chaque type d'événement astronomique est visible à la surface du globe — jour et nuit, planètes, objets du ciel profond, éclipses, aurore, satellites artificiels, et bien plus.

## Concept

> 仲春春分，夕出郊奎、娄、胃东五舍，为齐；仲夏夏至，夕出郊东井、舆鬼、柳东七舍，为楚；仲秋秋分，夕出郊角、亢、氐、房东四舍，为汉；仲冬冬至，晨出郊东方，与尾、箕、斗、牵牛俱西，为中国。—— 《史记·天官书》
>
> *— Sima Qian, Mémoires historiques, « Traité des charges célestes » (Ier s. av. J.-C.) : selon les loges lunaires près desquelles Mercure apparaît aux équinoxes et aux solstices, chaque région du royaume — Qi, Chu, Han, les États centraux — se voit attribuer sa propre portion du ciel. Une formulation ancienne du fēnyě.*

<p align="center">
  <img src="../docs/demo/xingguan_wuzhuhou.png" width="100%">
</p>

Le ciel a ses constellations ; la Terre a ses régions. Relier les phénomènes du ciel aux territoires du sol est une idée aussi ancienne que l'astronomie et l'astrologie elles-mêmes : la Chine antique associait les vingt-huit loges lunaires aux Neuf Provinces et aux États féodaux par le **分野** (*fēnyě*, « attribution des champs »), tandis que dans le monde gréco-romain Ptolémée proposait des correspondances entre les douze signes du zodiaque et les nations. La géodésie moderne donne à ce lien une forme rigoureuse : projetez un corps verticalement sur la Terre, et le point de surface qu'il rencontre est son point substellaire, unique et calculable avec exactitude. Comparée à une carte du monde figée, la carte stellaire projetée présente les caractéristiques suivantes :

* **Rotation vers l'ouest** — Dans le référentiel de la sphère céleste, la Terre tourne d'est en ouest en un jour sidéral, mais vue depuis la Terre elle-même, la direction apparente est exactement inversée.
* **Est–ouest en miroir** — On regarde la carte stellaire d'au-dessus et de l'extérieur, à l'inverse du regard porté vers le ciel nocturne depuis l'intérieur ; est et ouest s'en trouvent inversés par rapport à l'observation ordinaire.
* **Le proche paraît plus grand** — Les corps sont dessinés à leur taille apparente, non réelle : la Lune, proche de la Terre, occupe une bien plus grande surface que les planètes ou les objets du ciel profond.

## Fonctionnalités

### Couches

Le fond de carte adopte un thème sombre — CARTO Dark Matter par défaut, avec Stadia Alidade Smooth Dark en alternative. Les couches de données développées ou intégrées par le site sont :

| Catégorie | Couches |
|---|---|
| Étoiles / constellations / xingguan | Étoiles, objets du ciel profond, pluies de météores, constellations / charges stellaires (xingguan) / astérismes, étiquettes multilingues, grilles de coordonnées |
| Soleil / Lune / planètes | Rendu du disque, rendu des phases, voiles de lumière solaire / lunaire |
| Éclipses | Liste d'événements, zone de visibilité, diagrammes de magnitude |
| Pollution lumineuse | Rendu en tuiles (D. J. Lorenz) |
| Ovale auroral | Zone de visibilité (NOAA SWPC OVATION) |
| Satellites | Zone de visibilité (CelesTrak) |

### Boussole de l'observateur

Double-cliquez n'importe où sur la carte pour faire apparaître et verrouiller la **boussole de l'observateur**, qui indique les directions du lever et du coucher du Soleil et de la Lune, ainsi que la position actuelle du Soleil et de la Lune. Les courbes jaune et bleue sont les trajectoires solaire et lunaire du jour. Lorsque la boussole est verrouillée, cliquer sur l'icône ou l'étiquette d'un corps prolonge son **rayon de relèvement**, et cliquer sur son point substellaire trace la ligne de grand cercle reliant votre position à ce point. Le panneau d'information de droite fournit les détails du lieu et les données d'observation du jour ; cliquez sur une heure dans le panneau de données pour vous y rendre.

<p align="center">
  <img src="../docs/demo/compass_sunrise.png" width="100%">
</p>

### Interaction avec les éclipses

Activer la couche des éclipses ouvre la liste des éclipses à gauche. En sautant depuis la liste vers l'instant d'un événement, vous voyez les courbes-enveloppes colorées qui délimitent la zone de visibilité de tout l'événement, ainsi que l'anneau-enveloppe gris qui marque la zone de visibilité en temps réel. Appuyez sur le bouton de lecture en bas à droite pour voir la zone de visibilité d'une éclipse solaire se déplacer dans le temps.

<p align="center">
  <img src="../docs/demo/total_solar_eclipse_envelope.png" width="100%">
</p>

La section éclipses du panneau d'information de droite fournit les **circonstances locales** au lieu sélectionné. Le diagramme d'éclipse lunaire dessine le passage de la Lune dans l'ombre de la Terre ; le diagramme d'éclipse solaire trace la course du Soleil dans le ciel, du premier au dernier contact.

<p align="center">
  <img src="../docs/demo/lunar_eclipse_diagram.png" width="36%">
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="../docs/demo/solar_eclipse_diagram.png" width="36%">
  <br>
</p>

### Superposition de couches

Le projet permet de superposer simultanément des couches de données de sources multiples — pollution lumineuse, ovale auroral et satellites, par exemple — avec un mécanisme de conflit de couches (les couches constellations et pollution lumineuse, par exemple, ne peuvent être ouvertes ensemble) qui évite que les informations se brouillent. La couche satellites dessine les traces au sol en vert, signale en or les portions où un satellite peut produire un éclat au-dessus de la zone crépusculaire au sol, et utilise un grand cercle centré sur l'icône du satellite pour indiquer sa zone de visibilité. Les sections aurore, pollution lumineuse et satellites du panneau d'information de droite fournissent des informations d'observation détaillées.

<p align="center">
  <img src="../docs/demo/multi_layers.png" width="100%">
</p>

## Jeux de données

### Éclipses (2000–2049)

Le jeu de données des éclipses solaires contient les éléments de Bessel servant à calculer les instants et les positions des contacts, ainsi que les courbes-enveloppes au sol qui décrivent la couverture de chaque événement (ligne centrale de l'ombre, limites nord/sud de l'ombre, lignes d'iso-magnitude, limites nord/sud de la pénombre, lignes de magnitude maximale au lever/coucher du Soleil, courbes de lever/coucher, etc.) ; le jeu de données des éclipses lunaires ne contient qu'un index. Il couvre actuellement 112 éclipses solaires et 114 éclipses lunaires entre 2000 et 2049. Les vecteurs de position du Soleil et de la Lune utilisés dans les calculs proviennent d'[Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19.

**Note :** l'ombre en temps réel et la zone de couverture d'une éclipse solaire, ainsi que la zone de couverture d'une éclipse lunaire, sont calculées à l'exécution.

**Structure des dossiers**

| Fichier | Contenu |
|---|---|
| [`data/eclipses/solar.json`](../data/eclipses/solar.json) | Index des éclipses solaires |
| [`data/eclipses/lunar.json`](../data/eclipses/lunar.json) | Index des éclipses lunaires |
| [`data/eclipses/events/`](../data/eclipses/events/) `<date>.json` | Zone de visibilité d'une éclipse solaire |
| [`data/eclipses/README.md`](../data/eclipses/README.md) | Notes sur le format |


### Noms d'étoiles traditionnels chinois

Le projet fournit un jeu de données multilingue de noms d'étoiles traditionnels chinois indexés par HIP, comptant actuellement 3 035 noms d'étoiles traditionnels et 312 entrées de charges stellaires (xingguan). Les entrées reposent principalement sur le catalogue de noms d'étoiles traditionnels chinois fourni par la communauté [Stellarium](https://stellarium.org/), avec des entrées complémentaires tirées du [site personnel de Yu Zhaohuan](https://yzhxxzxy.github.io/cn/index.html), de [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement), de Wikipédia et d'autres sources participatives. Les lignes des charges stellaires chinoises proviennent des données célestes de d3-celestial. Les traductions multilingues (anglais, français, espagnol, italien) proposent à la fois une translittération et une traduction par le sens.

**Structure des dossiers**

| Fichier | Contenu |
|---|---|
| [`data/sky/names.cn.json`](../data/sky/names.cn.json) | Informations sur les charges stellaires |
| [`data/sky/lines.cn.geojson`](../data/sky/lines.cn.geojson) | Lignes des charges stellaires |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/stars.json` | Noms d'étoiles traditionnels et traductions |
| [`data/sky/i18n/`](../data/sky/i18n/) `<locale>/constellations.cn.json` | Noms des charges stellaires et traductions |


### Toponymes de Chine continentale

Le projet s'appuie principalement sur la base cities15000 de [GeoNames](https://www.geonames.org/) pour la recherche directe et inverse, mais ses coordonnées de villes et ses noms multilingues sont souvent incomplets. Pour la Chine continentale, le projet prend pour base la liste 2023 des bourgs et cantons fournie par [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage), la convertit au format JSON et la fusionne dans la base de villes GeoNames. Il complète aussi les traductions chinoises de certains toponymes de GeoNames, garantissant une couverture bilingue chinois/japonais en Asie de l'Est.

| Fichier | Contenu |
|---|---|
| [`data/places/cities.json.gz`](../data/places/cities.json.gz) | Base de toponymes enrichie |
| [`data/places/name-patches.json`](../data/places/name-patches.json) | Compléments de noms chinois/japonais |

## Crédits & licence

Le code propre au projet est publié sous **GNU General Public License v3.0** ; voir [LICENSE](../LICENSE) pour les détails. Le code, les données et les polices tiers restent sous leurs licences respectives.

| Usage | Composant (version) | Auteur / Source | Licence |
|---|---|---|---|
| Moteur cartographique | [Leaflet](https://leafletjs.com/) 1.9.4 | Volodymyr Agafonkin | BSD-2-Clause |
| Tuiles cartographiques | [OpenStreetMap](https://www.openstreetmap.org/copyright) | Communauté OpenStreetMap | ODbL |
| Terminateur jour/nuit | [Leaflet.Terminator](https://github.com/joergdietrich/Leaflet.Terminator) 1.1.0 | Jörg Dietrich | MIT |
| Calculs astronomiques | [Astronomy Engine](https://github.com/cosinekitty/astronomy) 2.1.19 | Don Cross | MIT |
| Position du Soleil | [SunCalc](https://github.com/mourner/suncalc) 1.9.0 | Volodymyr Agafonkin | BSD-2-Clause |
| Calendrier lunaire | [lunar-javascript](https://github.com/6tail/lunar-javascript) 1.7.7 | 6tail | MIT |
| Lignes de constellations | [d3-celestial](https://github.com/ofrohn/d3-celestial) | Olaf Frohn | BSD |
| Données stellaires | [Catalogue HYG](https://www.astronexus.com/projects/hyg) | David Nash | CC BY-SA 4.0 |
| Noms d'étoiles traditionnels chinois | [Stellarium](https://stellarium.org/) | Communauté Stellarium | CC BY-SA |
| Noms d'étoiles traditionnels chinois | [Guanjin0562](https://github.com/Guanjin0562/stellarium/tree/chinese-skyculture-enhancement) | Guanjin0562 | GPL-2.0 |
| Comètes / astéroïdes | [JPL](https://ssd.jpl.nasa.gov/) · [MPC](https://www.minorplanetcenter.net/) | JPL · MPC | Domaine public |
| Objets du ciel profond | [OpenNGC](https://github.com/mattiaverga/OpenNGC) | Mattia Verga | CC BY-SA 4.0 |
| Éclipses | [EclipseWise](https://www.eclipsewise.com/) | Fred Espenak | © Espenak |
| Pollution lumineuse | [Atlas de pollution lumineuse](https://djlorenz.github.io/astronomy/lp/) | David J. Lorenz | © Lorenz |
| Prévision des aurores | [NOAA SWPC](https://www.swpc.noaa.gov/) | NOAA | Domaine public |
| Propagation des satellites | [satellite.js](https://github.com/shashwatak/satellite-js) 5.0.0 | Shashwat Kandadai | MIT |
| Éléments orbitaux (TLE) | [CelesTrak](https://celestrak.org/) | T. S. Kelso | Domaine public |
| Recherche de toponymes | [GeoNames](https://www.geonames.org/) | GeoNames | CC BY 4.0 |
| Toponymes de Chine continentale | [OSMChina-coverage](https://github.com/OSMChina/OSMChina-coverage) | OSMChina | GPL-3.0 |
| Polices latines | [Source Serif](https://github.com/adobe-fonts/source-serif) | Adobe | OFL |
| Polices CJK | [Source Han Serif](https://github.com/adobe-fonts/source-han-serif) | Adobe | OFL |
| Décompression | [Pako](https://github.com/nodeca/pako) 2.1.0 | Nodeca | MIT |
