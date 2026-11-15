# Rapport QA — commandes finales de l’arbre

## Corrections

- Une barre plein écran unique : Zoom −, Zoom +, Ajuster, Rechercher et ⋯ en haut à gauche ; la commande Ajuster reste distincte du zoom.
- La commande de sortie devient une croix en haut à droite, avec cible 44 × 44 px. En vue normale, l’icône expand reste en bas à droite.
- Le menu ⋯ présente les icônes scan, crosshair, git-branch et download. En vue normale desktop il reste contextuel sous son déclencheur ; en vue tactile normale il réutilise le dialogue bottom-sheet existant. Le menu contextuel reste utilisé en plein écran.
- En plein écran, Ajuster n’est affiché qu’une fois dans la barre ; Recentrer reste disponible dans le menu. La barre conserve toutes ses commandes à 320 px et suit les zones de sécurité.
- Les actions dépliées dans le menu Arbre sont désormais sans panneau encadrant ; sélection, largeur et hauteur naturelle sont conservées.
- L’identifiant d’assets est `4g-tree-final-controls-20261115-1`.

## Vérifications

- Syntaxe JavaScript et `git diff --check` : réussis.
- Tests ciblés `tree-fullscreen`, `tree-menu-layout`, `tree-selector`, `tree-directory-responsive`, `genealogy-workspace-ui` et `final-qa` : **83 tests réussis, 0 échec**.
- Chromium/WebKit simulés : barre sans chevauchement, sortie X/Échap, actions et fermetures du menu, bottom sheet aux largeurs 320, 375, 390 et paysage 844 px ; pas de débordement horizontal. Le bottom sheet conserve le zoom et le centre, ferme par arrière-plan, Échap, sélection ou balayage descendant.
- `npm run test:responsive` : **508 assertions**, un échec connu sur le centrage de « Ajuster » à 390 px (écart mesuré x = 1,5 px, y = 1,7 px). Ce calcul n’a pas été modifié ; l’écart est déjà documenté dans `TREE_COMMANDS_UX_QA_REPORT.md`. Les autres parcours et la nouvelle vérification de menu paysage passent.
- Safari iPhone réel indisponible : aucune validation sur appareil n’est revendiquée. Safari classique peut conserver ses barres système ; l’API plein écran utilisée par l’application est tentée puis le repli CSS occupe la hauteur dynamique disponible. Le mode autonome iOS garde les métadonnées existantes (`apple-mobile-web-app-capable`, `black-translucent`, `viewport-fit=cover`) ; aucun manifeste ou contournement PWA n’a été ajouté.

## Contrôles visuels conseillés sur iPhone

À 320 px en portrait puis en paysage : confirmer la barre complète et la croix en plein écran, le bottom sheet compact et ses fermetures, puis les zones de sécurité dans Safari et depuis l’icône installée. Le comportement réel des barres Safari et du mode autonome reste à vérifier sur appareil.
