# Rapport architectural — Lot 8 : frontières documentaires

| Élément | Valeur |
|---|---|
| Branche / base | `recette` @ `7e4babb` |
| Jeton initial | `26-module-extractions-20261121-1` |
| Jeton résultat | `27-document-file-storage-20261122-1` |
| Résultat | Extraction des opérations de fichiers en chunks Firestore ; aucune modification du modèle ni des fonctionnalités |

## 1. Architecture initiale et cible

`js/app.js` regroupait orchestrateur UI, initialisation Firebase et les opérations de chunks du stockage des documents. Les routines de chunks utilisaient des fonctions Firebase partagées et y mettaient à jour directement la progression DOM. Cette frontière rendait le stockage difficile à réutiliser et à tester indépendamment.

## 2. Extraction réalisée

`js/document-file-storage.js` fournit `createDocumentFileStore`, qui reçoit explicitement les références et primitives Firestore, les conversions binaires et la taille de chunk. Le module expose écriture, lecture et suppression, avec nettoyage des chunks déjà écrits en cas d’échec. Il n’importe pas Firebase et n’accède ni au DOM ni à un état global.

`app.js` construit le store après l’initialisation Firebase et garde un mince adaptateur de progression UI. Les appels, chemins, champs stockés, codage `bytes`, tailles, erreurs et comportement de suppression sont préservés. Aucun changement à Storage, règles ou données.

## 3. Dépendances avant / après

Avant : `app.js` → primitives Firebase + formats de chunks + DOM dans les mêmes fonctions.

Après : `app.js` → `document-file-storage.js` (dépendances injectées) ; callback de progression DOM dans l’orchestrateur. Aucun cycle ni nouvel état global.

## 4. Réduction

`js/app.js` passe de 17 446 à 17 409 lignes (−37 lignes nettes). Un nouveau module rassemble les opérations persistantes sans duplication. L’objectif est la frontière de responsabilité, pas un quota de lignes.

## 5. Candidats non extraits

- Références Firestore partagées : simple objet de collections, mais leur déplacement seul apporterait peu et ne séparerait pas les opérations/UI.
- Transactions de personnes, familles et arbres : couplées à caches, validation, état de formulaire et rafraîchissement ; extraction à risque élevé.
- Synchronisation des abonnements et vues/dialogues : orchestration fortement partagée ; conservée dans `app.js`.
- Transcription et preuves : modules de modèle, synchronisation, brouillons et collaboration existent déjà ; leurs flux UI et leurs contrats restent distincts.

## 6. Vérifications

- `node --check js/app.js`, `js/document-file-storage.js` et le test : OK.
- `node --test tests/document-file-storage.test.mjs` : 2/2.
- `npm.cmd run test:unit -- --filter document` : 52/52.
- `npm.cmd run test:browser -- --filter document` : 38/38, dont parcours documents, viewers image et PDF sur Chromium/WebKit.
- `npm.cmd run test:unit` : 585/585 après reconstruction des artefacts locaux. Un premier passage avait échoué uniquement parce que `dist-recette` portait encore l’ancien jeton ; reconstruire a résolu ce décalage.
- `npm.cmd run test:unit -- --filter final` : 7/7.
- `npm.cmd run test:firestore` : 78/78 sur les émulateurs locaux (projet fictif ; aucune donnée distante).
- `npm.cmd run check:assets` : OK ; 62 références `?v=` et le meta cohérents.
- `npm.cmd run build:recette` : OK, 261 ressources ; `npm.cmd run build:production` : OK, 265 fichiers, local non déployé.
- `git diff --cached --check` : OK après revue du diff final.

## 7. Frontières du futur orchestrateur documentaire

Le stockage binaire se manipule désormais sans composant DOM ; métadonnées de documents, sources, preuves et personnes restent aux modèles/flux existants. Transcription et traduction demeurent des contenus distincts dans leurs modules et révisions ; le stockage de fichiers ne les fusionne pas avec les données généalogiques validées. Un futur orchestrateur pourra consommer un document existant au moyen de ses métadonnées et de `readChunkedFile`, sans imposer aujourd’hui d’association à une source ou preuve. Brouillons, validation humaine, révisions et traçabilité existants restent les points d’intégration ; aucun agent, service, schéma ou interface n’est introduit.

## 8. Risques résiduels et maintenance

La majorité des écritures et abonnements Firestore reste directement orchestrée par `app.js`, notamment les transactions multi-collections ; ne les déplacer qu’avec une frontière métier explicite et des tests ciblés. Le module injecte les primitives mais les tests Firestore d’intégration restent la référence pour les autorisations/règles. Les tests sont locaux et n’écrivent pas en base distante.

Recommandation : préserver `document-file-storage.js` comme couche de stockage sans UI et maintenir l’adaptateur de présentation dans `app.js`. Le prochain candidat doit disposer de tests couvrant ses opérations atomiques et ses associations avant déplacement.
