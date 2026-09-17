# Family Tree — rapport de validation finale V14

## Périmètre

Cette passe couvre exclusivement les sections 18 à 20 : tests, recherche de
régressions et nettoyage conservateur. Les fonctionnalités des sections 1 à 17
n'ont pas été réimplémentées.

## Résultat des 70 cas

| Groupe | Cas | Automatisés | Contrôlés statiquement | Validation manuelle requise |
|---|---:|---:|---:|---:|
| Personnes | 1–6 | 3 | 3 | 0 |
| Navigation de la fiche | 7–10 | 0 | 4 | 0 |
| Documents | 11–17 | 3 | 4 | 0 |
| Annuaire | 18–29 | 9 | 3 | 0 |
| Responsive | 30–34 | 0 | 0 | 5 |
| Dates généalogiques | 35–43 | 7 | 2 | 0 |
| Unions | 44–50 | 2 | 5 | 0 |
| Fin d'union | 51–55 | 2 | 3 | 0 |
| Filiations | 56–60 | 5 | 0 | 0 |
| Compatibilité | 61–65 | 4 | 1 | 0 |
| Arbre | 66–70 | 5 | 0 | 0 |
| **Total** | **1–70** | **40** | **25** | **5** |

Les contrôles statiques vérifient la présence et le raccordement du parcours
dans le HTML/JavaScript, mais ne sont pas présentés comme une écriture réelle
dans Firebase. Les cinq cas responsive ont été contrôlés au niveau des règles
CSS et des breakpoints ; le rendu pixel réel reste à confirmer dans un
navigateur, car aucun moteur de navigateur exécutable n'est disponible dans
l'environnement de test.

## Couverture automatisée

- cinq formats de dates pour naissance, décès et événements d'union ;
- conservation du format d'origine et absence de faux `01/01` ;
- dates historiques complètes de l'ancien modèle ;
- recherche, filtres nom/lieu/naissance/décès et quatre tris de l'Annuaire ;
- libellé des documents avec titre, sans titre, sans type et sans nom de fichier ;
- anciennes familles sans métadonnées et filiations non typées ;
- filiations biologique, adoptive, incertaine et non précisée ;
- coexistence d'un parent biologique et d'un parent adoptif ;
- mariage, union libre, séparation et divorce sans suppression des partenaires ;
- layout de plus de 500 personnes, sans carte manquante ni chevauchement ;
- alignement des partenaires et descente parent/enfant ;
- pan, zoom molette, boutons, pinch, ajustement et bornes de zoom ;
- rendu des cartes et connexions avec les nouvelles propriétés.

## Problèmes trouvés et corrigés

1. **Dates précises antérieures à l'an 100** : `Date.UTC` interprétait les
   années 0 à 99 comme 1900 à 1999. La validation et le formatage utilisent
   maintenant explicitement `setUTCFullYear`. L'année `0000` reste refusée.
2. **Compatibilité d'un ancien lieu de mariage** : le formulaire savait relire
   `marriagePlace`, mais le résumé de la relation ne l'affichait pas. Le résumé
   utilise maintenant `unionPlace`, puis `marriagePlace` comme fallback.
3. **Cibles tactiles mobiles** : les commandes de date, navigation, actions de
   l'arbre et boutons principaux pouvaient mesurer moins de 44 px. Leur hauteur
   minimale mobile est maintenant de 44 px et la hauteur du canvas a été
   ajustée en conséquence.

## Contrôles d'intégrité et nettoyage

- aucune migration, suppression ou réécriture en masse des données Firebase ;
- les anciens champs `birthDate`, `deathDate`, `partnerIds` et `childIds`
  restent pris en charge ;
- les champs enrichis restent facultatifs dans les règles Firestore ;
- aucun changement de collection, de quota ou de service Firebase ;
- sauvegarde V3 et restauration des anciennes archives conservées ;
- aucune référence DOM littérale manquante et aucun identifiant HTML dupliqué ;
- tous les modules JavaScript passent le contrôle de syntaxe ;
- aucun `TODO`, `FIXME`, `debugger`, faux jeu de données ou `console.log` de
  débogage dans le code de production ;
- les `console.error` et `console.warn` restants sont uniquement les remontées
  d'erreurs utiles des parcours Firebase, fichiers et authentification.

## Limites de cette exécution

Les opérations réelles avec un compte Firebase (écriture, rechargement réseau,
lecture d'un fichier distant et restauration en production) n'ont pas été
exécutées afin de ne pas modifier les données de l'utilisateur et faute de
session authentifiée. La console d'un navigateur réel n'a pas pu être inspectée
pour la même raison. Les parcours correspondants ont été contrôlés statiquement
et doivent être confirmés après déploiement avec la checklist ci-dessous.

### Vérification manuelle après déploiement

1. Créer une fiche de test, la modifier et naviguer entre les trois onglets.
2. Ajouter un document sans titre, l'ouvrir depuis la fiche puis l'Annuaire.
3. Enregistrer une date partielle, actualiser la page, puis vérifier son tri,
   son filtre et son affichage dans l'arbre.
4. Enregistrer un mariage puis un divorce et vérifier que les deux partenaires
   restent visibles après actualisation.
5. Tester une filiation adoptive et une filiation incertaine après actualisation.
6. Ouvrir l'Annuaire et l'arbre à environ 1440, 1024, 768, 390 et 320 px, puis
   vérifier l'absence d'overflow et l'accessibilité des actions tactiles.
7. Contrôler la console du navigateur pendant ces parcours.

## Fichiers modifiés pendant la passe finale

- `index.html`
- `js/app.js`
- `js/genealogy-date.js`
- `tests/genealogy-model.test.mjs`
- `tests/qa-70-cases.test.mjs`
- `QA_REPORT.md`

`firestore.rules` et le modèle Firebase n'ont pas été modifiés pendant cette
passe. Aucun service payant n'a été ajouté ; le projet reste compatible avec
Firebase Spark.
