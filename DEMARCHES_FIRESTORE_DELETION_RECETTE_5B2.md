# Suppression contrôlée des données Démarches en recette — Lot 5B.2

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche | `recette` |
| HEAD avant lot | `1cf86ba` |
| Projet Firebase ciblé | `la-nostra-storia-recette` |
| Périmètre exécuté | `procedures` et sa sous-collection `actions` en recette uniquement |
| Résultat | **Deux documents supprimés individuellement, disparition vérifiée** |

Ce lot n'a supprimé aucune donnée de production et n'a pas modifié les règles Firestore.

## 1. Objet et périmètre

Exécuter l'autorisation limitée à la recette après les audits 5A et 5B.1 et après nouvelle vérification des sauvegardes, des chemins, des contenus typés et des `updateTime`.

Seuls les chemins suivants étaient autorisés :

- `procedures/va5JB1tWhBwE9F2sCjX7/actions/COs9FtTsaUGXCBtXjceP`
- `procedures/va5JB1tWhBwE9F2sCjX7`

Aucune autre collection ou donnée n'a été ciblée en écriture. Aucun nettoyage des règles n'a été entrepris.

## 2. Identification de l'environnement et contrôles de sécurité

- **Projet cible exact :** `la-nostra-storia-recette`, autorisé par ce lot.
- `js/firebase-environment.js` associe explicitement l'environnement recette à cet ID. Le `.firebaserc` local désigne la production comme projet `default` : ce défaut a été ignoré ; les URL REST étaient codées avec l'ID recette et protégées par une liste blanche contenant uniquement `la-nostra-storia-recette`.
- Identité de la CLI Firebase vérifiée (`firebase login:list`) ; compte propriétaire reconnu. Aucune valeur de credential ou jeton n'a été journalisé.
- Permissions IAM `datastore.entities.get`, `datastore.entities.list`, `datastore.entities.delete` vérifiées sur **le projet recette uniquement** ; aucune permission n'a été modifiée ou élargie.
- Variables `GOOGLE_APPLICATION_CREDENTIALS`, `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` et `FIREBASE_CONFIG` absentes avant l'opération.
- Les requêtes distantes utilisaient exclusivement l'origine HTTPS Firestore et le chemin `projects/la-nostra-storia-recette/databases/(default)/documents`. La précondition `currentDocument.updateTime` a été appliquée à chacun des deux DELETE.

## 3. Sauvegardes et restaurations vérifiées

Emplacement privé hors dépôt :

`C:\Users\<compte-utilisateur>\Documents\family-tree-technical-archive\lot-5b1-demarches-backup\`

| Environnement | SHA-256 de l'archive | Résultat de restauration isolée |
|---|---|---|
| Recette | `2357f099b1231f79d6a80356fab6e0805271faad8d6f185b9ef63536c4101b07` | Validée : 2/2 documents, 0 écart canonique |
| Production | `8d2fdd018f4ffc81a27ae3ff5a36697c7cb090e43d842b4d84f7b3cf9f4c5f50` | Validée : 3/3 documents, 0 écart canonique |

Les deux manifestes, `SHA256SUMS.txt`, les empreintes recalculées et les rapports de restauration ont été vérifiés. Les fichiers d'archive n'ont pas été modifiés. L'archive production a été vérifiée **localement seulement** ; aucune donnée du projet production n'a été lue ou modifiée dans le présent lot.

## 4. Inventaire recette avant suppression

Inventaire lu en lecture seule et comparé au manifeste recette ainsi qu'aux champs typés et `updateTime` de l'archive :

| Contrôle | Résultat |
|---|---|
| Documents de collection group `procedures` | 1 — chemin exact listé ci-dessus |
| Documents de collection group `actions` | 1 — chemin exact listé ci-dessus |
| Sous-collections du dossier | `actions` uniquement |
| Orphelins | 0 |
| Chemins atypiques ou non inventoriés | 0 |
| Champs et types Firestore vs archive | Identiques |
| `updateTime` source vs archive | Identiques pour les deux documents |
| SHA-256 de l'archive recette | Conforme : `2357f099…4101b07` |

Tous les contrôles étaient satisfaits avant la première suppression. Aucun écart ne nécessitait d'arrêt.

## 5. Chemins supprimés, ordre et résultats

1. **Action enfant** — `procedures/va5JB1tWhBwE9F2sCjX7/actions/COs9FtTsaUGXCBtXjceP` : document relu immédiatement avant suppression ; contenu typé et `updateTime` conformes à l'archive ; DELETE individuel avec précondition `updateTime` (HTTP 200) ; GET immédiat : document absent.
2. **Contrôle intermédiaire** — collection group `actions` vide ; dossier parent toujours présent, champs et `updateTime` inchangés.
3. **Dossier parent** — `procedures/va5JB1tWhBwE9F2sCjX7` : document relu immédiatement avant suppression ; contenu typé et `updateTime` conformes à l'archive ; DELETE individuel avec précondition `updateTime` (HTTP 200) ; GET immédiat : document absent.

Deux documents exactement ont été supprimés, dans l'ordre enfant puis parent. Aucun DELETE de collection, suppression récursive ou suppression par recherche générique n'a été utilisé.

## 6. Vérification post-suppression

Lecture de contrôle sur recette immédiatement après les deux suppressions :

- `listCollectionIds` racine : `procedures` absent ;
- collection group `procedures` : 0 document ;
- collection group `actions` : 0 document ;
- chemins résiduels ou sous-collections orphelines Démarches : 0.

Les seules requêtes d'écriture émises dans le lot sont les deux DELETE individuels indiqués au §5. Aucun document hors de ces chemins n'a été visé. Aucun contrôle ni appel réseau n'a ciblé le projet production.

## 7. Journal et anomalies

Journal technique expurgé, conservé hors dépôt avec ACL restreintes :

`C:\Users\<compte-utilisateur>\Documents\family-tree-technical-archive\lot-5b2-demarches-deletion\recette-deletion-journal.txt`

Le journal comprend le projet, les contrôles, les chemins, l'ordre, les heures UTC et les statuts HTTP ; il ne contient aucun champ personnel ni secret.

**Anomalies : aucune. Opération partielle : non.**

## 8. Production et règles Firestore

- **Production intacte :** aucune requête Firestore n'a été adressée à `family-tree-c2fe2` ; aucun document ni aucune ressource production n'a été modifié. La présence et l'empreinte de sa sauvegarde ont seulement été vérifiées localement.
- **Règles Firestore inchangées :** aucun endpoint Ruleset n'a été appelé, aucun déploiement n'a été lancé et `firestore.rules` n'a pas été modifié. Son SHA-256 local après l'opération reste `8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648`.
- Les règles existantes restent donc en place en recette ; leur nettoyage est hors périmètre.

## 9. Conditions restantes avant suppression en production

La suppression recette ne vaut pas autorisation pour production. Avant toute opération production, il faudra une instruction/autorisation distincte, revalider l'identité et les droits, vérifier l'archive et la restauration production, comparer à nouveau en lecture seule les données et `updateTime` source avec le manifeste production, puis supprimer uniquement les chemins production inventoriés avec préconditions. La production n'est pas traitée dans ce lot.

---

*Lot 5B.2 recette terminé. Aucun changement de règles, de code, d'assets ou de configuration Firebase ; aucun build, déploiement ni merge vers `main`.*
