# Rapport QA — commandes de l’arbre et menus

## Modifications

- Les commandes normales sont ancrées aux coins du canvas : Zoom − / Zoom + en haut à gauche sur desktop, ⋯ en haut à droite et Plein écran en bas à droite. Sur mobile, les zooms restent masqués.
- Le menu ⋯ est un panneau clair compact, sans pictogrammes, sous le déclencheur en espace suffisant, avec repli vers le haut si nécessaire. Sa hauteur est limitée à l’espace visible et son contenu défile en interne.
- Les actions d’un arbre restent intégrées sous sa ligne. Le surlignage couvre la ligne entière; le bouton ⋯ indique son état ouvert. La hauteur naturelle du menu est recalculée à l’ouverture et à la fermeture.
- Le mode plein écran garde ses commandes en barre supérieure. La logique de caméra et ses positions n’ont pas été modifiées.

## Vérifications

- `node --check js/app.js` : réussi.
- Suites ciblées Arbre, plein écran, responsive, export, workspace, QA finale et cache : **102 tests réussis, 0 échec**.
- `npm run test:responsive` : 508 assertions, une assertion manuelle échoue sur le centrage d’« Ajuster » à 390 px (écart mesuré x = 1,5 px, y = 1,7 px par rapport au calcul de la sonde). Le module caméra et le calcul de centrage n’ont pas été modifiés dans ce lot; ce point reste à vérifier sur le parcours publié.
- Safari iPhone réel indisponible dans cet environnement. Safari classique conserve ses barres système; le mode autonome de l’écran d’accueil s’appuie sur les métadonnées iOS et `viewport-fit=cover` déjà présents.

## Vérification visuelle conseillée

Sur iPhone, contrôler les trois coins des commandes en vue normale, le menu ⋯ sous ou au-dessus de son déclencheur selon l’espace, le dépliage/repliage d’une action d’arbre, puis l’entrée/sortie du plein écran en Safari classique et depuis l’icône installée sur l’écran d’accueil.
