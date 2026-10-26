# Lot 4G — Suppression sécurisée des arbres secondaires

## Résultat

Compte rendu des validations locales du Lot 4G, établi avant publication. La publication et ses vérifications sont suivies séparément de ce rapport de QA.

## Architecture

- Champs retenus : `lifecycleState` (`active` / `deleting`), `deletionToken`, `deletionStartedAt` et `deletionStartedBy`.
- L’absence historique de `lifecycleState` signifie `active`. Les créations d’arbres par l’application et la restauration créent explicitement l’état `active`.
- Le parcours de suppression confirme le nom avant écriture, verrouille l’arbre dans une transaction, puis utilise `getDocsFromServer` sur `people` avec `treeId == ID`. Le résultat complet inclut les fiches masquées et toute fiche qui référence l’ID, même avec une appartenance incohérente.
- Un arbre non vide est réactivé dans une transaction conditionnelle qui compare le jeton. Un arbre vide est supprimé dans une transaction finale qui relit état et jeton et ne supprime que `trees/{treeId}`.
- Une erreur de lecture conserve le verrou, sans annoncer de suppression. « Débloquer l’arbre » relit le document serveur, demande confirmation et réactive conditionnellement l’arbre en invalidant le jeton.
- Les Rules bloquent les nouvelles affectations vers un arbre `deleting`, tout en permettant les éditions ordinaires de personnes déjà affectées et les sorties vers un autre arbre ou « Aucun arbre ».

## Sauvegarde et restauration

- L’export v4 exclut `lifecycleState` et les champs transitoires du verrou.
- La restauration signale les arbres absents qui seront recréés, demande confirmation, refuse les arbres verrouillés et ne restaure jamais un état `deleting`.
- Les métadonnées d’arbre sont écrites individuellement en transactions ; les personnes ne commencent qu’après la fin de cette étape. La restauration complète reste multi-collections et non atomique : si une étape ultérieure échoue, les écritures déjà terminées sont conservées. L’erreur précise si des métadonnées d’arbre ont déjà été restaurées.

## Fichiers modifiés

- `firestore.rules` — transitions de cycle de vie, suppression admin d’un arbre verrouillé, barrière d’affectation.
- `index.html`, `js/app.js` — action de suppression et récupération, confirmations, transactions, retours d’erreur, sélecteurs, création/transferts et restauration.
- `js/tree-model.js` — états de cycle de vie, classification des membres, destinations 4C/4D.
- `js/backup-utils.js` — exclusion/normalisation des champs transitoires de sauvegarde.
- Tests : `tests/firestore-emulator.mjs`, `tests/firestore-rules-invariants.mjs`, `tests/tree-model.test.mjs`, `tests/tree-selector.test.mjs`, `tests/person-tree-assignment-ui.test.mjs`, `tests/backup-restore.test.mjs`.
- `LOT_4G_QA_REPORT.md` — présent rapport.

Les modules sensibles caméra, layout, relations et dates n’ont pas été modifiés.

## Vérifications locales

- Firestore Emulator : **69/69** tests réussis, émulateurs Auth/Firestore locaux seulement. Couvre notamment compatibilité d’un arbre historique sans état, suppression vide, verrou, membre masqué, « Aucun arbre », 4C/4D/4F, modifications ordinaires pendant le verrou, sortie, mauvais jeton, double verrou, récupération, concurrence entre deux sessions administrateur et création concurrente.
- Non-régression 4B–4F, sauvegardes, Rules invariants, annuaire, responsive et accessibilité : **189/189** tests réussis.
- Syntaxe JavaScript des fichiers modifiés : OK.
- `git diff --check` : OK (warnings CRLF Windows sans erreur de diff).
- Build `npm.cmd run build:recette` : **32/32** ressources servies localement, 845 595 octets (825,8 Kio).
- Contrôles responsive du menu : 320, 390, 760 et 1024 px ; navigation clavier/focus vérifiés.
- Recherche dans `dist-recette` : aucune référence au projet Production `family-tree-c2fe2`. La ressource d’environnement contient explicitement `la-nostra-storia-recette` et le projet fictif d’émulateur.

## Limites de sécurité et restauration

La barrière Firestore Rules protège les parcours normaux de l’application contre les affectations concurrentes. Les Rules Firestore ne peuvent pas interroger toute la collection `people` pour prouver qu’elle ne contient aucun membre. Conformément à la décision métier, la vacuité est vérifiée exhaustivement côté application après verrouillage ; un administrateur utilisant volontairement un client modifié peut contourner cette vérification et supprimer un arbre verrouillé encore occupé. Cette limite n’est pas présentée comme une garantie absolue côté serveur.

La restauration n’effectue aucune suppression en cascade. Une archive peut recréer un arbre supprimé après confirmation. Une panne peut laisser des écritures déjà réalisées ; aucun rollback global n’est tenté.

## Référence du dépôt pendant les validations locales

- Base de travail : branche `recette`, commit `83fcf6b423fb8324e4f40e6a7a9a8db6ffc27ac2`.
- Les fichiers historiques non suivis énumérés dans les consignes ont été préservés.
- Les tests et le build de ce rapport sont locaux ; aucune référence au projet Firebase Production n’est présente dans le build Recette contrôlé.
