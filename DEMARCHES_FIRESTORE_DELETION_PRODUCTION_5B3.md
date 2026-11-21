# Suppression contrôlée des données Démarches en production — Lot 5B.3

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche de travail | `recette` |
| HEAD avant lot | `4dce519` |
| Projet Firebase effectivement ciblé | `family-tree-c2fe2` |
| Résultat | **3 documents supprimés individuellement ; absence résiduelle vérifiée** |

## 1. Périmètre et autorisation

Ce lot exécute l'autorisation explicite portant exclusivement sur les anciennes données Démarches en production. Il ne traite ni la recette, ni d'autres collections, ni les règles Firestore.

Seuls les trois chemins provenant du manifeste Production 5B.1 ont été supprimés : deux documents `actions`, puis leur dossier `procedures` parent. Aucun autre chemin n'a été ciblé en écriture.

## 2. Projet Production effectivement ciblé

Les trois sources exigées concordaient avant l'accès aux données :

| Source | Identifiant vérifié |
|---|---|
| Configuration applicative `js/firebase-environment.js` | `family-tree-c2fe2` pour Production |
| Rapport `DEMARCHES_FIRESTORE_AUDIT_5A.md` | `family-tree-c2fe2` |
| Manifeste de sauvegarde 5B.1 Production | `family-tree-c2fe2` |

Le `.firebaserc` a été examiné : son alias `default` pointe également sur `family-tree-c2fe2`, mais **aucune opération n'a reposé sur cette sélection implicite**. Les appels Firestore utilisaient une liste blanche limitée à cet ID et des URL construites explicitement pour `projects/family-tree-c2fe2/databases/(default)/documents`.

Identité CLI vérifiée ; le compte propriétaire est authentifié. Les permissions IAM `datastore.entities.get`, `datastore.entities.list` et `datastore.entities.delete` ont été testées sur ce projet uniquement. Les variables `GOOGLE_APPLICATION_CREDENTIALS`, `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `FIREBASE_CONFIG`, `FIRESTORE_EMULATOR_HOST` et `FIREBASE_DATABASE_EMULATOR_HOST` étaient absentes ; aucun émulateur n'écoutait sur les ports locaux vérifiés.

## 3. Références des sauvegardes

Emplacement privé hors dépôt :

`C:\Users\<compte-utilisateur>\Documents\family-tree-technical-archive\lot-5b1-demarches-backup\`

| Environnement | Archive | SHA-256 intégral | Restauration isolée |
|---|---|---|---|
| Production | `family-tree-c2fe2-demarches-export.json` | `8d2fdd018f4ffc81a27ae3ff5a36697c7cb090e43d842b4d84f7b3cf9f4c5f50` | Validée, 3/3, 0 écart |
| Recette | `la-nostra-storia-recette-demarches-export.json` | `2357f099b1231f79d6a80356fab6e0805271faad8d6f185b9ef63536c4101b07` | Validée, 2/2, 0 écart |

Présence, lisibilité, chemins, manifestes, `SHA256SUMS.txt`, hashes recalculés et résultats de restauration ont été contrôlés avant l'opération. Les deux archives sont inchangées après celle-ci. Aucune restauration distante n'a été tentée.

## 4. Inventaire Production avant suppression

Lecture seule, limitée aux métadonnées de chemins et au contenu typé des trois chemins manifestés :

| Contrôle | Résultat |
|---|---|
| Documents `procedures` | 1, chemin conforme au manifeste |
| Documents `actions` | 2, chemins conformes au manifeste |
| Sous-collections du dossier | `actions` uniquement |
| Orphelins | 0 |
| Chemins atypiques ou non manifestés | 0 |
| Contenu et types Firestore vs archive | Identiques pour les trois documents |
| `updateTime` source vs archive | Identique pour les trois documents |
| Restauration isolée | Validée, sans écart |

Le double-read 5B.1 (2026-11-21) indiquait `COHÉRENT` ; la vérification actuelle confirme qu'aucune addition, suppression ou modification n'est intervenue depuis cette sauvegarde.

## 5. Chemins exacts supprimés

Les trois documents ont été explicitement confrontés au manifeste avant écriture :

1. `procedures/1Bhrpx4cA3dJtBMgAM3Y/actions/PuAVlJlPk4iW62pMyybI`
2. `procedures/1Bhrpx4cA3dJtBMgAM3Y/actions/z54s969l8iZWptzdmpxt`
3. `procedures/1Bhrpx4cA3dJtBMgAM3Y`

## 6. Ordre et résultat des opérations

Pour chacun des documents : vérification immédiate de l'ID projet et du chemin manifesté, relecture du document, comparaison des champs typés et de l'`updateTime` avec l'archive, puis suppression individuelle avec précondition `currentDocument.updateTime` et GET de vérification.

1. Première action : DELETE HTTP 200, GET post-suppression confirme son absence ; l'autre action est le seul document restant dans son groupe et le parent reste inchangé.
2. Deuxième action : DELETE HTTP 200, GET confirme son absence ; le groupe `actions` devient vide, aucune sous-collection inattendue n'apparaît et le parent correspond toujours à l'archive.
3. Dossier parent : DELETE HTTP 200, GET confirme son absence.

**Total : 3 documents supprimés, dans l'ordre actions, actions, parent.** Aucune suppression récursive, globale, par collection ou issue d'une recherche dynamique n'a été utilisée.

## 7. Vérifications après suppression

Contrôle de lecture post-opération sur Production :

- `procedures` absent de la liste des collections racine ;
- collection group `procedures` : **0 document** ;
- collection group `actions` : **0 document** ;
- chemin résiduel, action orpheline ou sous-collection Démarches : **0**.

Les seules requêtes d'écriture émises par le lot étaient les trois DELETE des chemins ci-dessus. Aucun autre document n'a été ciblé par une écriture.

## 8. Journal et anomalies

Journal technique privé, hors dépôt, avec ACL restreintes :

`C:\Users\<compte-utilisateur>\Documents\family-tree-technical-archive\lot-5b3-demarches-production-deletion\production-deletion-journal.txt`

Il consigne le projet, les chemins, l'ordre, les `updateTime` attendus, les contrôles, les heures UTC et les statuts ; aucun champ de contenu, secret ou credential n'y figure.

**Anomalies : aucune. Échec ou opération partielle : aucun.**

## 9. Recette, autres ressources Production et règles

- **Recette inchangée par ce lot :** aucun appel Firestore n'a été adressé au projet `la-nostra-storia-recette` ; seules ses archives privées ont été vérifiées localement.
- **Autres ressources Production :** les écritures ont été limitées aux trois chemins du §5 ; aucune autre collection ou ressource n'a été ciblée en écriture.
- **Règles Firestore inchangées :** aucun endpoint Ruleset n'a été appelé, aucun déploiement n'a été effectué et aucun fichier de règles n'a été modifié. Le SHA-256 local après l'opération est toujours `8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648`.
- Les sauvegardes recette et Production restent conservées et leurs empreintes restent conformes.

## 10. Préparation du futur nettoyage des règles

Le nettoyage technique reste un lot séparé et n'a pas commencé. Avant toute modification des règles, il faudra :

1. obtenir une autorisation explicite distincte pour les règles ;
2. retirer uniquement `validProcedure`, `validProcedureAction` et le bloc `match /procedures` ; conserver les fonctions partagées (`isApproved`, `validUpdatedBy`) et le catch-all ;
3. adapter `tests/firestore-rules-invariants.mjs` et la section Démarches de `tests/firestore-emulator.mjs`, sans modifier les fixtures historiques ;
4. vérifier que les autres blocs de règles sont inchangés, puis exécuter `npm run test:firestore` et les contrôles pertinents ;
5. publier les règles séparément, après nouvelle autorisation, par le mécanisme Firebase documenté et avec vérification du SHA-256 avant/après. Aucun `firebase deploy` ne doit être utilisé.

---

*Lot 5B.3 terminé. Aucun nettoyage de règles, lot 6/7, build, déploiement Hosting ou modification de `main` n'a été effectué.*
