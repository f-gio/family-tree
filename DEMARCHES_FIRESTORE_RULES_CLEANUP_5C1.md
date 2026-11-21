# Nettoyage local des règles Firestore Démarches — Lot 5C.1

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche | `recette` |
| HEAD initial | `668d8e5` |
| Production `main` | `69540c9` |
| Périmètre | Retrait local des autorisations Firestore historiques Démarches et tests de refus via émulateur |
| Déploiement | **Aucun** |

## 1. Objectif

Après suppression vérifiée des données en recette (5B.2) et production (5B.3), retirer du fichier local `firestore.rules` les règles et validateurs exclusivement associés à Démarches. Les anciennes routes doivent être refusées par le catch-all. Ce lot ne publie pas les règles.

## 2. État initial des règles

Au début du lot, `firestore.rules` contenait :

- `validProcedure()` pour les dossiers ;
- `validProcedureAction()` pour leur chronologie ;
- `match /procedures/{dossierId}` et son sous-bloc `match /actions/{actionId}` ;
- le catch-all final `match /{document=**}` avec `allow read, write: if false;`.

L’audit ciblé a confirmé qu’aucun autre bloc générique n’accorde de droits à `procedures` ou `actions`. Les autres blocs de règles sont des chemins nommés de collections distinctes. Le catch-all demeure l’unique `match` récursif et refuse les accès non spécifiés.

## 3. Blocs et validateurs supprimés

Retirés uniquement de `firestore.rules` :

1. `validProcedure()` (anciennement lignes 241-264) ;
2. `validProcedureAction()` (anciennement lignes 266-280) ;
3. `match /procedures/{dossierId}` et le sous-bloc `actions` (anciennement lignes 604-621), y compris les permissions read/create/update/delete et le contrôle d’existence du parent.

Aucun autre validateur ni bloc de collection n’a été modifié. La comparaison du diff ligne par ligne montre uniquement ces deux portions supprimées.

## 4. Fonctions partagées conservées

- `isApproved()` reste défini et utilisé par les autres collections.
- `validUpdatedBy()` reste défini et utilisé notamment par les règles des personnes.
- Les autres validateurs, permissions et protections générales sont conservés.
- Le catch-all `allow read, write: if false` reste en place et garantit le refus des chemins sans règle spécifique.
- L’icône `#icon-procedures` et le code applicatif n’ont pas été modifiés ; le test d’interaction confirme que l’icône partagée est conservée.

## 5. Tests historiques adaptés

### `tests/firestore-rules-invariants.mjs`

- Retrait de l’exigence d’existence du bloc `procedures` et de ses validateurs.
- Ajout d’invariants d’absence des deux validateurs et des blocs `procedures` / `actions`.
- Maintien des contrôles d’ordre des blocs conservés, de `validUpdatedBy` et du catch-all récursif de refus.

### `tests/firestore-emulator.mjs`

- Remplacement des scénarios historiques qui autorisaient les accès Démarches et validaient leurs champs.
- Ajout de quatre scénarios de refus réels : sans connexion, compte pending, admin principal, membre approuvé.
- Pour les anciens chemins, les tests couvrent `getDoc`, requêtes de liste, création, mise à jour et suppression, pour dossier et actions.
- Les fixtures dossier/action et action orpheline sont insérées et nettoyées par `Authorization: Bearer owner` **uniquement** sur l’émulateur local, afin de tester aussi lecture/mise à jour/suppression de documents existants. Les appels clients sont ensuite refusés par les règles. Le `finally` nettoie ces fixtures même en cas d’échec d’assertion.
- La suite vérifie également une action sous un parent inexistant et la requête de liste de cette sous-collection.
- Les tests d’autres collections ont été conservés.

Les anciens tests UI dédiés Démarches avaient déjà été retirés avec le module ; les tests actuels d’absence de l’UI et de l’icône partagée restent présents.

## 6. Nouveaux tests de refus des anciens chemins

Les scénarios passent par le SDK Firebase connecté à `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, avec l’ID fictif `family-tree-emulator-test`. La garde anti-production du test vérifie l’hôte local et l’ID fictif.

Les refus sont vérifiés contre les règles chargées par l’émulateur (code `permission-denied`), pas seulement par recherche textuelle. Le cas admin principal est inclus pour vérifier qu’aucun rôle applicatif ne contourne le catch-all.

## 7. Résultats exacts des tests

| Vérification | Résultat |
|---|---:|
| `npm run test:firestore -- --project family-tree-emulator-test` — émulateur local explicitement identifié | **78/78 réussis**, 0 échec, 0 ignoré |
| Scénarios de refus Démarches (anonyme, pending, admin, membre approuvé) | **4/4 réussis** |
| `node --test tests/final-qa.test.mjs tests/interaction-language.test.mjs` | **2/2 réussis**, 0 échec |
| Invariants Firestore statiques (également appelés par final QA) | **Réussis** |
| `node --check tests/firestore-emulator.mjs tests/firestore-rules-invariants.mjs` (exécuté séparément fichier par fichier) | **Réussi** |
| Chargement / syntaxe Firestore Rules par l’émulateur | **Réussi** |

Une première invocation du script sans `--project` a hérité de l’alias `default` du `.firebaserc` comme identifiant logique de l’émulateur et a émis un avertissement de projet multiple ; le garde du test indiquait néanmoins le client fictif et `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, sans endpoint distant. Pour supprimer toute ambiguïté, la suite a été relancée avec `--project family-tree-emulator-test` explicite : **cette exécution est le résultat retenu** (78/78, sans avertissement d’incohérence single-project). Les écritures de fixtures étaient adressées uniquement à l’émulateur local. Aucun projet Firebase distant ni aucune donnée réelle n’a été ciblé.

## 8. Vérification de non-régression et refus d’accès

- Les requêtes de lecture unitaire et de liste sont refusées sur `procedures/{dossierId}` et `procedures/{dossierId}/actions/{actionId}`.
- Création, mise à jour et suppression sont refusées sur les deux chemins, y compris pour l’admin principal.
- Les opérations sur une action sous un parent absent et la liste de cette sous-collection sont refusées.
- Les tests des autres collections de `firestore-emulator.mjs` restent verts dans la suite de 78 tests : personnes, familles, documents, tâches, utilisateurs, arbres, sources/preuves, propositions/événements, transcriptions et brouillons.
- `tests/final-qa.test.mjs` et `tests/interaction-language.test.mjs` passent ; le contrat de règles et l’icône `#icon-procedures` restent protégés.
- Le diff des règles ne contient aucune modification de permission pour une autre collection ; les fonctions `isApproved` et `validUpdatedBy` sont toujours présentes.

## 9. Fichiers modifiés

1. `firestore.rules` — retrait des deux validateurs et du bloc Démarches uniquement.
2. `tests/firestore-rules-invariants.mjs` — invariants actualisés.
3. `tests/firestore-emulator.mjs` — scénarios de refus par émulateur ajoutés à la place des autorisations historiques.
4. `DEMARCHES_RULES.md` — distingue désormais le candidat local non publié des rulesets actuellement actifs.
5. `DEMARCHES_FIRESTORE_RULES_CLEANUP_5C1.md` — présent rapport.

Aucun code applicatif, composant visuel, fichier de configuration Firebase, dépendance, index, fonction ou asset n’a été modifié. Les archives privées 5B.1 n’ont pas été consultées ni modifiées dans ce lot.

Le CLI a aussi laissé un journal local `firestore-debug.log`, ignoré par Git ; il n’est pas indexé ni inclus dans le commit.

## 10. Risques résiduels

- Les règles distantes en recette et production **contiennent encore les règles Démarches** : le retrait est local uniquement jusqu’à un futur lot explicitement autorisé. Les rulesets actifs documentés restent à SHA-256 `8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648` (Production `cc8f5732-749e-41fc-a359-95536d663add`, recette `21b0044f-cc2b-4579-8a39-184ed32334eb`).
- Tant qu’elles ne sont pas publiées, toute donnée Démarches réintroduite manuellement à distance pourrait encore être accessible selon les anciennes règles. Les données ont été supprimées dans les deux environnements au lot 5B.
- Le catch-all bloque désormais en local les chemins qui ne disposent plus de règle dédiée ; l’émulateur confirme ce refus.
- Aucune modification de règle partagée ou d’autre collection n’est incluse dans ce diff.

## 11. Procédure recommandée pour un déploiement futur des règles

Le déploiement est hors périmètre du lot 5C.1. Pour le futur lot 5C.2 :

1. obtenir une autorisation distincte et préciser l’environnement ;
2. relire le diff sécurité et refaire les tests pertinents, dont `npm run test:firestore` ;
3. vérifier le SHA-256 du fichier candidat contre les releases actives avant publication ;
4. publier séparément selon `DEMARCHES_RULES.md` (Firebase Console ou API Firebaserules), jamais par `firebase deploy` ;
5. vérifier et consigner le SHA-256 et le ruleset actif après publication ;
6. ne pas modifier `main`, ne pas déployer Hosting et ne pas mélanger recette et production sans autorisations explicites distinctes.

## 12. Confirmation d’absence de modification distante

- Aucun appel à l’API Firebaserules, aucun déploiement et aucune publication de règles n’ont été effectués.
- Les releases actives des deux environnements n’ont pas été modifiées ; `DEMARCHES_RULES.md` distingue maintenant leur hash du candidat local.
- Aucun accès aux données des projets Firebase recette ou production n’a été effectué par ces tests ; l’exécution retenue cible l’émulateur local à l’ID fictif explicite et à l’hôte `127.0.0.1`.
- Aucun build Hosting, changement d’assets, modification d’application ou fusion vers `main` n’a été effectué.
- SHA-256 local du nouveau `firestore.rules` : `f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd`. Cette valeur décrit le candidat local **non publié**.

---

*Lot 5C.1 : règles nettoyées dans le dépôt de travail uniquement. Aucune publication distante ; le lot 5C.2 n’a pas été lancé.*
