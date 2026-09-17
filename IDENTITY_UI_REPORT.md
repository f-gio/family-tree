# Family Tree — onglet Identité, exécution 1/4

## Périmètre réalisé

Cette version applique uniquement les sections 1 à 11 et 22 à 24 de la demande.
L’intégration GeoNames, la nouvelle structure géographique et la QA finale des
sections suivantes ne sont pas incluses.

## Structure obtenue

Sur ordinateur, la photo occupe une zone distincte à gauche. Les champs sont
organisés à droite selon l’ordre imposé :

1. Prénom / Second prénom ;
2. Nom de naissance / Nom d’usage ;
3. Sexe / Branche familiale.

Les sections Naissance puis Décès reprennent ensuite toute la largeur. Elles
utilisent des séparateurs légers plutôt que des cartes imbriquées. Le choix du
type de date reste au-dessus des champs de date et de lieu.

Sur mobile, la photo passe au-dessus et tous les champs sont présentés sur une
colonne. Les contrôles de précision des dates reviennent à la ligne sans réduire
les zones tactiles.

## Compatibilité

Le libellé visible « Nom d’épouse » devient « Nom d’usage ». La propriété
historique `marriedName`, ses identifiants HTML et sa lecture/écriture sont
conservés : aucune migration Firebase n’est nécessaire et les anciennes valeurs
restent lisibles. Le champ est désormais visible quel que soit le sexe.

Les messages « La date sera affichée “—” » ont été retirés uniquement pour la
naissance et le décès. Le moteur de dates généalogiques et ses formats restent
inchangés.

## Vérifications exécutées

- huit suites de tests Node exécutées avec succès ;
- syntaxe de `js/app.js` et `js/form-ui.js` contrôlée avec `node --check` ;
- règles Firestore comparées octet par octet à la V19 : inchangées ;
- différences de code limitées à `index.html`, `css/design-system.css`,
  `js/app.js`, la documentation et les tests ciblés ;
- absence d’intégration GeoNames vérifiée.

Le rendu dans un navigateur graphique et le test sur un appareil tactile réel
n’ont pas pu être exécutés dans cet environnement.
