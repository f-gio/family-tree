# Family Tree — responsive et accessibilité

Cette passe couvre uniquement les sections 23 à 29. Elle complète le Design
System existant sans modifier les données, les règles Firebase ni la logique
généalogique.

## Adaptation progressive

L’interface s’adapte désormais à cinq zones utiles plutôt qu’à un simple couple
desktop/mobile :

- au-dessus de 1 180 px : mise en page desktop complète ;
- de 761 à 1 180 px : navigation sur une ligne dédiée et marges réduites ;
- de 761 à 980 px : grilles à deux colonnes et listes simplifiées ;
- jusqu’à 760 px : navigation tactile, mini-fiches, filtres en panneau mobile et
  formulaires à une colonne ;
- jusqu’à 560 px : modales importantes en plein écran ;
- jusqu’à 390 px : actions empilées et contrôles de l’arbre condensés sans
  réduire les cibles tactiles.

Les champs et boutons conservent une taille lisible. Les zones principales
restent à 44 px minimum sur écran tactile. Les onglets Personne et Paramètres
deviennent horizontalement défilables au lieu d’être comprimés.

## Claviers mobiles

Les champs e-mail, URL, année, recherche, nom et lieu déclarent désormais les
attributs adaptés : `inputmode`, `autocomplete`, `autocapitalize`,
`enterkeyhint` et `spellcheck`. Ces indications ne changent pas les valeurs
enregistrées ; elles sélectionnent simplement un clavier plus pertinent.

## Accessibilité

- focus clavier visible et compatible avec les couleurs forcées ;
- parcours aux flèches dans le menu du compte et les onglets Paramètres ;
- rôles `tablist`, `tab` et `tabpanel` appliqués aux paramètres ;
- noms accessibles conservés lorsque le texte d’un contrôle est masqué sur
  très petit écran ;
- contraste des couleurs de texte principales vérifié selon WCAG AA ;
- libellés des actions de relation rendus explicites ;
- préférence `prefers-reduced-motion` respectée.

## Continuité et performance perçue

Les ouvertures de modale, menus, onglets et champs conditionnels utilisent des
transitions courtes. Les longues listes peuvent différer le rendu des éléments
hors écran grâce à `content-visibility`. Lors du premier chargement Firebase,
chaque vue conserve une structure stable et annonce « Chargement… » avec
`aria-busy`, puis devient interactive dès que les données dont elle dépend sont
disponibles.

## Limites de validation

Les tests automatisés contrôlent la syntaxe, les breakpoints, les cibles
tactiles, les attributs accessibles, les libellés et l’absence de changement
Firestore. Le scénario Playwright multi-largeurs est fourni mais nécessite un
binaire Chromium pour produire une validation visuelle réelle.
