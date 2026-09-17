# Family Tree — QA finale de l’évolution Identité et lieux

## Périmètre

Validation de la modale Personne, des dates généalogiques, de GeoNames, de
l’affichage compact des lieux et des régressions générales. Aucune nouvelle
fonctionnalité ni direction graphique n’a été introduite.

## Tests réellement exécutés

- vérification syntaxique de `app.js`, `tree-renderer.js` et `place-format.js` ;
- exécution de toute la suite Node : 33 tests réussis, 0 échec ;
- contrôles de structure de la modale, des trois onglets et du footer ;
- contrôles de la grille Identité et du compact photo uploader ;
- contrôles des cinq formats de date pour Naissance et Décès ;
- tests simulés GeoNames : résultat international, petite localité, homonymes,
  cache, absence de configuration et erreur réseau ;
- vérification du maintien de la saisie libre lors d’une erreur GeoNames ;
- tests du format compact `Varese (ITA)` et de la valeur historique `Orino` ;
- vérification des 249 conversions ISO alpha-2 vers alpha-3 ;
- tests du modèle généalogique, de l’arbre, de la caméra, de l’Annuaire, des
  documents et de la compatibilité des anciennes données ;
- comparaison avec la version GeoNames précédente : `index.html`, le Design
  System, le composant GeoNames et `firestore.rules` sont identiques.

## Problèmes détectés et corrections

Aucune régression fonctionnelle reproductible n’a été détectée dans les tests
exécutables. Aucun code métier n’a donc été modifié pendant cette passe QA.

## NON TESTÉ

- rendu pixel réel aux différentes largeurs : navigateur Chromium indisponible ;
- interactions tactiles sur appareil physique : appareil non disponible ;
- sauvegarde/réouverture contre le projet Firebase réel : authentification et
  données de production non disponibles dans l’environnement de test ;
- appel réel au Worker GeoNames : le réseau de l’environnement renvoie HTTP 403 ;
- upload, remplacement et suppression réels d’une photo ;
- ouverture réelle des documents Firebase existants.

Ces points restent à valider sur le site déployé. Les implémentations et leurs
chemins de code ont néanmoins été contrôlés statiquement.

## Firebase

Cette QA n’ajoute aucun champ Firebase. Les champs structurés de lieux déjà
existants restent additifs et facultatifs : `birthPlaceInfo`, `deathPlaceInfo`,
`unionPlaceInfo`, `endPlaceInfo` et `placeInfo`. Les anciennes chaînes de texte
restent lues telles quelles.

Aucune migration, suppression ou réécriture globale de données n’a été
effectuée.
