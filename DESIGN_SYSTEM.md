# Family Tree — audit et fondations UX/UI

Périmètre de cette version : sections 1 à 7 uniquement. Aucun changement n'a été apporté à Firebase, au modèle de données, aux relations, aux documents ou à la logique métier.

## Audit synthétique

### Conventions existantes conservées

- Identité chaleureuse : fond ivoire, surfaces crème, vert profond et accent terre cuite.
- Titres éditoriaux en Georgia et interface en police système sans sérif.
- Second prénom en italique comme accent généalogique spécifique.
- Cartes arrondies, bordures chaudes et ombres légères.
- Navigation principale explicite, onglets pour la fiche Personne et croix en haut à droite des fenêtres.
- Actions principales déjà majoritairement vertes et actions destructives rouges.

### Incohérences constatées et corrigées

- Couleurs, rayons, ombres et tailles de contrôle répétés sous plusieurs valeurs proches.
- Boutons d'une même importance ayant des hauteurs ou paddings différents.
- États focus, pressed, disabled et loading incomplets ou propres à quelques composants.
- Zones tactiles inférieures à 44 px sur certains contrôles mobiles.
- Styles typographiques équivalents exprimés avec plusieurs tailles voisines.
- Actions de remise à zéro visuellement aussi fortes que des actions alternatives.

## Tokens centralisés

Les tokens sont définis dans `css/design-system.css`.

| Famille | Règles principales |
|---|---|
| Couleurs | texte, texte secondaire, page, surface, surface douce, marque, accent, danger, succès, bordures, focus |
| Typographie | interface, titres, accent généalogique ; échelle XS à 2XL ; graisses et interlignes |
| Espacements | échelle de 4, 8, 12, 16, 20, 24, 32, 40 et 48 px |
| Rayons | 8, 11, 16, 22 px et pilule |
| Ombres | basse, moyenne, fenêtre et focus |
| Contrôles | 32 px compact, 42 px standard et 44 px tactile |
| Mouvement | transitions 140/180 ms et prise en charge de `prefers-reduced-motion` |
| Breakpoints | 760 px mobile et 980 px tablette, alignés sur l'existant |

## Hiérarchie typographique

- H1 / marque : titre du produit.
- H2 : titre principal de vue ou grande section.
- H3 / titre de fenêtre : contexte de l'action en cours.
- Titre de carte / H4 : contenu local.
- Body : texte principal de lecture.
- Label : intitulé de champ, 12 px et graisse forte.
- Secondary / metadata : couleur atténuée, 11 à 13 px selon le contexte.
- Helper : 11 px, couleur secondaire.
- Error : rouge sémantique ; Success : vert sémantique.
- Button : 14 px standard, graisse 700.
- Accent généalogique : italique réservé au second prénom.

## Hiérarchie des actions

- `btn primary` : une action principale par contexte lorsque possible.
- `btn` : action secondaire bordée.
- `btn tertiary` : action discrète, notamment remise à zéro.
- `btn icon-btn` : action iconique avec libellé accessible.
- `btn danger` : action destructive, rouge et volontairement non dominante.

Chaque famille possède des états hover, active, focus-visible, disabled et loading (`aria-busy="true"` ou `is-loading`).

## Règles d'interaction

- Zone tactile minimale de 44 px sur mobile pour les actions, onglets et contrôles importants.
- Focus clavier commun, visible et non dépendant de la couleur seule.
- Déplacement vertical de 1 px pour matérialiser l'état pressé.
- Croix de fermeture, loupe de recherche, chevrons, onglets et actions danger conservent les conventions web connues.
- Les actions fréquentes restent directement accessibles ; les fonctions existantes n'ont pas été cachées.

## Charge mentale

- L'action principale reste la plus contrastée.
- Les actions de nettoyage deviennent tertiaires.
- Les actions destructives sont distinctes sans concurrencer l'enregistrement.
- Les états et tailles communs réduisent le réapprentissage entre Arbre, Annuaire, Documents, Tâches et fenêtres.

Les sections 8 et suivantes du cahier UX/UI ne sont pas traitées dans cette version.
