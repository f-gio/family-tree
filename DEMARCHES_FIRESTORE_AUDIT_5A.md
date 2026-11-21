# Audit Firestore « Démarches » — Lot 5A (inventaire et préparation du nettoyage)

| Élément | Valeur |
|---|---|
| Date de l'audit | 2026-11-21 |
| Branche de travail | `recette` (HEAD `1ea2568`, working tree propre avant rapport) |
| Dernier commit production | `69540c9` (suppression du module Démarches, 2026-11-20) |
| Projets Firebase cibles | Recette `la-nostra-storia-recette` — Production `family-tree-c2fe2` |
| Nature des opérations | **Uniquement lecture** (statique + métadonnées Firestore) — aucune écriture, aucune suppression, aucun déploiement |

**Conventions** : **[F]** = fait vérifié (source indiquée) · **[H]** = hypothèse explicitement non vérifiée · **[R]** = recommandation (décision requise en 5B).

---

## 1. Résumé exécutif

1. Le module Démarches a été supprimé du code et de l'UI le 2026-11-20 (commit `69540c9`, publié en recette et en production). Les données Firestore, les règles dédiées et les sauvegardes ont été **volontairement conservées** (message du commit : « aucune suppression Firestore ; les règles procedures et les sauvegardes (sans collection procedures) restent intactes ») **[F]**.
2. Les chemins historiques sont `procedures/{dossierId}` et `procedures/{dossierId}/actions/{actionId}`. Aucun autre chemin ni nom alternatif n'a été trouvé dans l'historique Git **[F]**.
3. **Inventaire réel effectué (lecture seule, métadonnées)** :
   - Recette : **1 dossier**, sous-collection `actions` = **1 document**, **0 orphelin**.
   - Production : **1 dossier**, sous-collection `actions` = **2 documents**, **0 orphelin**.
   - Les deux environnements contiennent des documents distincts (identifiants différents) **[F]**.
4. **Aucune sauvegarde applicative existante ne couvre `procedures`** : ni le format ZIP v5, ni le format v4 historique, ni l'export de 2026-10-02. Une suppression sans sauvegarde dédiée serait **irréversible** **[F]**.
5. Dépendances résiduelles : les règles Firestore (actives dans les deux environnements, même SHA-256 que le fichier local), deux suites de tests (`firestore-rules-invariants`, `firestore-emulator`) et des mentions documentaires. **Aucun code applicatif actif** ne référence plus `procedures` **[F]**.
6. Le lot 5B est proposé en 5 phases (§10) avec une **sauvegarde dédiée validée par restauration isolée comme condition bloquante** avant toute suppression, et une séparation stricte suppression de données / publication de règles.

---

## 2. Périmètre de l'audit

### Niveau A — Analyse du dépôt (toujours autorisé, réalisé)

- `firestore.rules` (891 lignes), `js/app.js`, modules `js/*`, `firebase.json`, `package.json`.
- Historique Git : `2fe6351` (création 2026-10-02), `01456be` (2026-10-04), `1c63336` (2026-10-09), `69540c9` (retrait 2026-11-20), comparaison `main` ↔ `recette`.
- Tests : `tests/firestore-emulator.mjs`, `tests/firestore-rules-invariants.mjs`, `tests/genealogy-workspace-ui.test.mjs`, `tests/interaction-language.test.mjs`, `tests/person-detail-page.test.mjs`, `tests/person-updatedby.test.mjs`, fixtures `tests/fixtures/v16|v17|v18`.
- Documentation : `DEMARCHES_RULES.md`, `FIRESTORE_TRANSCRIPTION_RULES_QA_REPORT.md`, `docs/archive/*`, `AGENTS.md`.

### Niveau B — Inventaire des données réelles (réalisé avec les garanties exigées)

Contrôles préalables effectués avant tout accès :

| Contrôle | Résultat |
|---|---|
| Projet cible identifié | `la-nostra-storia-recette` (recette) et `family-tree-c2fe2` (production), d'après `js/firebase-environment.js:4-8` **[F]** |
| Identité du compte | Compte Google du propriétaire du dépôt, déjà connecté via la CLI Firebase (`firebase login:list`, `firebase projects:list` listant les deux projets) — aucun secret affiché ni demandé **[F]** |
| Droits nécessaires | Confirmés par les réponses API réussies (HTTP 200) sur les deux projets ; aucune élévation de privilège, aucun service account utilisé **[F]** |
| Opération non modifiable | Trois RPC **read-only** uniquement : `documents:listCollectionIds`, `documents:runAggregationQuery` (COUNT borné `upTo`), `documents:runQuery` avec projection **`__name__` uniquement** — aucun champ de document lu, aucune écriture **[F]** |
| Coûts et volumes | Métadonnées + agrégations bornées sur une collection de quelques documents : coût estimé largement inférieur à 0,01 € ; aucun export de contenu **[F]** |
| Secrets | Le jeton OAuth de la CLI n'a été utilisé qu'en mémoire dans un script temporaire hors dépôt, jamais affiché ni écrit dans le rapport **[F]** |

Limites assumées : le Niveau B de ce lot se limite à **existence, structure et volumétrie**. Aucun champ personnel (titre, notes, e-mails, `personIds`, contenu des actions) n'a été lu. Si ces garanties n'avaient pas été réunies, l'audit se serait poursuivi en statique — ce n'a pas été nécessaire.

### Exclusions respectées

Aucune suppression, écriture, migration, création de document test, modification de règles/index/config, aucun changement de version d'assets, aucun build, aucun déploiement, aucune fusion vers `main`, aucune exécution de suites de tests. Les environnements recette et production sont strictement inchangés **[F]** (voir §13).

---

## 3. Collections et schémas historiques

### 3.1 `procedures/{dossierId}` (dossier)

Sources : `firestore.rules:241-264` (`validProcedure`), `js/app.js` version `69540c9^` (champs `dossierFields`), `js/procedures.js` (supprimé dans `69540c9`).

| Champ | Type / contrainte | Origine |
|---|---|---|
| `title` | string, 1-160 caractères (obligatoire) | rules + UI |
| `type` | whitelist : `research`, `correspondence`, `appointment`, `administrative`, `archive`, `call`, `online`, `other` | rules + UI |
| `status` | whitelist : `prepare`, `progress`, `waiting`, `reply`, `appointment`, `done`, `abandoned` | rules + UI |
| `objective`, `organization`, `service`, `contactName`, `email`, `phone`, `place`, `nextAction`, `notes`, `result` | strings facultatives (règle d'accès `data['service']` pour le token réservé) | rules + UI |
| `nextActionDate` | `""` ou `AAAA-MM-JJ` (regex) | rules + UI |
| `personIds` | liste facultative, ≤ 50 IDs uniques — **lien vers `people`** | rules + UI |
| `createdAt`, `updatedBy`, `updatedAt` | `serverTimestamp()` + `createdBy`, `createdByName`, `updatedBy`, `updatedByName` (UID + nom affiché) | UI historique |

Le schéma des règles **n'impose pas `hasOnly`** : des champs additionnels inconnus sont techniquement admissibles **[F]** (cf. §5, catégorie 4/5).

### 3.2 `procedures/{dossierId}/actions/{actionId}` (chronologie)

Sources : `firestore.rules:266-280` (`validProcedureAction`), `js/app.js` version `69540c9^` (`saveProcedureAction`).

| Champ | Type / contrainte |
|---|---|
| `type` | whitelist de 12 valeurs : `email-sent`, `email-received`, `appointment-requested`, `appointment-confirmed`, `call`, `archive-visit`, `registry-consult`, `online-search`, `note`, `document-sent`, `document-received`, `other` |
| `date` | `""`, absente ou `AAAA-MM-JJ` |
| `direction` | `none` \| `sent` \| `received` (implicite `sent`/`received` pour les e-mails côté UI) |
| `title`, `text`, `author` | strings facultatives |
| `time` | `""`, `HH:MM` ou `HH:MM:SS` |
| `emailFrom`, `emailTo`, `emailSubject`, `emailFull` | strings facultatives — **contenu potentiellement personnel (corps d'e-mails)** |
| audit | `createdAt`/`createdBy`/`createdByName`/`updatedAt`/`updatedBy`/`updatedByName` |

### 3.3 Relations et sous-collections

- **Personnes** : `procedures.personIds` → IDs de `people` (référence logique, **sans clé étrangère, sans cascade, sans index**). La suppression d'une personne ne supprime pas les dossiers et inversement **[F]**.
- **Documents / Sources / Preuves / Parcours** : **aucun champ de référence du schéma** (`documentId` absent de `dossierFields` et des validateurs) **[F]**.
- **Utilisateurs** : `createdBy`/`updatedBy` → `users.uid` (métadonnées d'audit) **[F]**.
- **Sous-collections** : les règles n'en définissent qu'une (`actions`, `firestore.rules:612-620`) ; l'inventaire distant confirme l'absence d'autres sous-collections dans les deux environnements **[F]**.
- **Chemins alternatifs / anciens noms** : recherches `git log -S` sur `firestore.rules` et `js/app.js` depuis `2fe6351` → **aucun** autre nom de collection ni sous-collection **[F]**.
- **Pas de cascade Firestore** : la règle du parent ne supprime jamais les enfants. Le message de confirmation historique de `removeDossier` (« Sa chronologie d'actions sera également supprimée ») était **inexact** — seul le document parent était supprimé **[F]**.

### 3.4 Conditions de création et de suppression (historique)

- **Création dossier** : UI → `addDoc` avec `createdAt/createdBy/createdByName` ; règle : `isApproved() && validProcedure() && validUpdatedBy()` (`firestore.rules:608`) **[F]**.
- **Création action** : règle exige en plus `exists(.../procedures/$(dossierId))` → **interdiction d'action orpheline à la création** (`firestore.rules:614-615`) ; en revanche `update`/`delete` d'une action ne vérifient plus l'existence du parent **[F]**.
- **Suppression dossier** : règle = `isApproved()` simple (`firestore.rules:609`). Côté UI : le bouton était visible à la création du module (`2fe6351`, `hidden = !item`), puis **figé à `hidden = true` dès le 2026-10-04** (`01456be`, commentaire « en attendant une suppression sûre de la sous-collection d'actions ») — la suppression de dossier était donc **inaccessible dans l'UI pendant la quasi-totalité de la vie du module** **[F]**.
- **Suppression action** : accessible avec confirmation (`removeProcedureAction`) **[F]**.
- **Désactivation du module en production** : feature flag `showProcedures: environment !== "production"` du 2026-10-09 (`1c63336`) au 2026-11-20 (`69540c9`) — la production n'a eu l'UI Démarches que du 2026-10-02 au 2026-10-09 **[F]**. Recette : visible jusqu'au 2026-11-20 **[F]**.

### 3.5 Risque de sous-collections orphelins

- Mécanique réelle : `removeDossier` ne supprimait que le parent ; la fenêtre de suppression UI (2026-10-02 → 2026-10-04) est courte ; les suppressions d'actions individuelles ne créent pas d'orphelin.
- **Inventaire réel : 0 orphelin dans les deux environnements** (aucune action dont le dossier parent est absent) **[F]**.
- **[H]** Un nettoyage futur doit néanmoins prévoir la détection d'orphelins par requête « collection group » sur `actions`, car la suppression du document parent ne peut pas être supposée récursive.

---

## 4. Inventaire réel par environnement (Niveau B — obtenu)

### 4.1 Méthode

RPC read-only via l'API Firestore v1 avec le jeton OAuth déjà présent sur la machine (compte propriétaire) :

1. `listCollectionIds` (racine, et par document dossier) → structure ;
2. `runAggregationQuery` avec `COUNT(*)` borné (`upTo: 100000`) → volumétrie des dossiers ;
3. `runQuery` avec `select: { fields: [{ fieldPath: "__name__" }] }` → **noms de documents uniquement** (aucun champ lu) ;
4. requête « collection group » sur `actions` (`allDescendants: true`) → tous les documents de la sous-collection, y compris ceux dont le dossier parent aurait disparu (détection d'orphelins).

Cohérence contrôlée : les comptes agrégés et les comptes issus des noms de documents concordent dans les deux environnements **[F]**. Aucun contenu de document n'a été retourné, lu ni enregistré **[F]**.

### 4.2 Recette — `la-nostra-storia-recette`

- Collections racine (20) : `documentChunks`, `documents`, `factHypotheses`, `factHypothesisRevisions`, `families`, `genealogyEvents`, `genealogyProofRevisions`, `genealogyProofs`, `people`, `procedures`, `publicConfig`, `settings`, `sourceDocuments`, `sourceRevisions`, `tasks`, `transcriptionDrafts`, `transcriptionHeads`, `transcriptionRevisions`, `trees`, `users`.
- `procedures` : **1 document dossier** (identifiant `va5JB1tWhBwE9F2sCjX7`, opaque).
- Sous-collections de ce dossier : **`actions` uniquement** → **1 document**.
- Actions sans dossier parent (orphelines) : **0**. Chemins atypiques (autre profondeur) : **0**.
- Requête tronquée à la limite ? **Non** (effectif < limite).

### 4.3 Production — `family-tree-c2fe2`

- Collections racine (13) : `documentChunks`, `documents`, `families`, `genealogyEvents`, `people`, `procedures`, `publicConfig`, `settings`, `tasks`, `transcriptionDrafts`, `transcriptionHeads`, `transcriptionRevisions`, `users`.
- `procedures` : **1 document dossier** (identifiant `1Bhrpx4cA3dJtBMgAM3Y`, opaque).
- Sous-collections de ce dossier : **`actions` uniquement** → **2 documents**.
- Actions orphelines : **0**. Chemins atypiques : **0**. Requête tronquée : **Non**.

### 4.4 Observations

- **Présence des données confirmée dans les deux environnements** — il ne s'agit pas d'un artefact de collection vide : deux méthodes indépendantes (agrégation et liste de noms) donnent le même résultat **[F]**.
- Les collections `factHypotheses` / `factHypothesisRevisions` (recette uniquement) ne font pas partie du périmètre Démarches ; elles sont signalées ici comme simple contexte d'inventaire racine, sans analyse **[F]**.
- **[H]** Le volume réel (2 dossiers, 3 actions au total) est cohérent avec la brièveté du module (UI accessible ~7 jours en production du 2026-10-02 au 2026-10-09, 49 jours en recette jusqu'au 2026-11-20) — confirmation qualitative, non une preuve du caractère exhaustif des saisies passées.
- Aucune donnée personnelle de contenu n'est reproduite dans ce rapport **[F]**.

---

## 5. Dépendances identifiées

Catégorisation selon la mission (§6) :

| # | Dépendance | Catégorie | Éléments |
|---|---|---|---|
| 1 | Code applicatif (`js/app.js`, `js/procedures.js`, modales, navigation) | **Historique documentée** — supprimée dans `69540c9` | `js/procedures.js` (129 lignes) supprimé ; imports, états, vues et modales retirés ; assertions d'absence : `tests/genealogy-workspace-ui.test.mjs:220-222` **[F]** |
| 2 | Navigation `?view=dossiers` | **Historique documentée** — repli actif | `js/navigation-state.js:46-48` : toute vue inconnue rejoint l'accueil (`tree`) ; `MAIN_VIEWS` ne contient plus `dossiers` (ligne 6) ; aucun `data-view="dossiers"` dans `index.html` **[F]** |
| 3 | Règles Firestore | **Réellement utilisée** (actives dans les deux environnements) | §6 **[F]** |
| 4 | Tests des règles | **Réellement utilisée** | `tests/firestore-rules-invariants.mjs:33,35,93-96` ; `tests/firestore-emulator.mjs:496-683` (12 scénarios) **[F]** |
| 5 | Icône `#icon-procedures` | **Nom partagé avec une autre fonctionnalité** | Conservée dans `index.html:171` ; utilisée par la catégorie « Professions et activités » du parcours (`js/app.js:3009`) et les tests de langage/icônes (`tests/interaction-language.test.mjs:55,70`, `tests/person-detail-page.test.mjs:251`) — **à ne pas retirer** avec les règles **[F]** |
| 6 | Mots « démarche / Dossier » ailleurs | **Nom partagé** | Libellés de la vue Actions/Tâches (`index.html:504`, `js/app.js:14262`), modale « Dossier généalogique » (`index.html:815`), variable `dossier` du module de preuves (`tests/fact-conclusions.test.mjs`) — concepts sans rapport avec `procedures` **[F]** |
| 7 | Garde de suppression de documents | **Historique documentée** | `documentDeletionBlockers(..., otherRecords)` incluait `...procedures` avant `69540c9` ; actuellement `js/app.js:14134` = `[...families, ...tasks]`. Le scan cherche les clés `documentId`/`targetId`… que le schéma Démarches ne crée jamais → **dépendance défensive, sans lien réel créé par l'application** **[F]** |
| 8 | Liens `personIds` → `people` | **Réellement créée par le schéma** | Présents dans les deux environnements (non lus dans ce lot) ; aucune lecture inverse n'est affichée dans l'UI actuelle (module supprimé) **[F]** sur l'existence du champ, **[H]** sur le contenu |
| 9 | Champs additionnels éventuels dans les dossiers | **Donnée potentiellement créée manuellement / non vérifiable sans lecture de contenu** | Les validateurs n'utilisent pas `hasOnly` : un client aurait pu écrire un champ `documentId` ou autre. **Non vérifié dans ce lot** (lecture de contenu interdite) — à vérifier en phase 1 du 5B **[F]** sur la règle, **[H]** sur l'existence |
| 10 | Liens Documents / Sources / Preuves / Parcours / pièces jointes | **Aucun lien de schéma** | Aucun champ du modèle ne référence ces entités ; le parcours détaillé n'utilise que l'icône partagée (n°5) ; `emailFull` est un texte, pas une pièce jointe **[F]** |
| 11 | Sauvegardes applicatives | **Aucune couverture** | §7 **[F]** |

**Réponse explicite** : aucune association active n'est créée ni consommée par le code actuel ; les associations **réelles** (personnes, éventuels champs manuels) ne peuvent être confirmées ou niées **que par une lecture de contenu, réservée au 5B**. L'absence de lien dans le code historique ne prouve pas l'absence de lien dans les données.

---

## 6. Règles et fonctions associées

État réel du fichier `firestore.rules` (891 lignes) **[F]** :

| Élément | Lignes | Statut |
|---|---|---|
| `function validProcedure()` | 239-264 (commentaire 239-240) | **Exclusif Démarches** |
| `function validProcedureAction()` | 266-280 | **Exclusif Démarches** |
| `match /procedures/{dossierId}` (+ sous-bloc `actions`) | 604-621 | **Exclusif Démarches** : lecture 607/613, création-màj 608/614-618, suppression 609/619, contrôle `exists(parent)` 615 |
| `function isApproved()` | 19-24 | **Partagée** (toutes collections) — à conserver |
| `function validUpdatedBy()` | 198-201 | **Partagée** (people, procedures…) — à conserver |
| `match /{document=**}` (catch-all deny) | 886-889 | **Partagée** — filet de sécurité en cas de retrait partiel |

### Vérification de publication

- SHA-256 local de `firestore.rules` calculé pendant l'audit : `8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648` — **identique** à la référence publiée documentée dans `DEMARCHES_RULES.md` (production ruleset `cc8f5732-749e-41fc-a359-95536d663add`, recette ruleset `21b0044f-cc2b-4579-8a39-184ed32334eb`) **[F]**.
- **Conséquence : les deux environnements exécutent aujourd'hui les règles Démarches** (lecture possible pour tout compte approuvé, écriture validée par `validProcedure`) **[F]**.
- Aucun index composite ni fonction cloud lié à `procedures` (pas de `firestore.indexes.json`, pas de Cloud Functions — contrainte Spark) **[F]**.

### Tests protégeant les invariants

- `tests/firestore-rules-invariants.mjs` : impose la présence et l'ordre des blocs (lignes 33, 35) et le contenu `allow read` / `validProcedure()` / `validProcedureAction()` (93-96) → **à adapter en phase 4** **[F]**.
- `tests/firestore-emulator.mjs:496-683` : permissions par rôle, validation des champs, interdiction d'action orpheline → **à supprimer/adapter en phase 4** **[F]**.
- `tests/person-updatedby.test.mjs:65` protège `validUpdatedBy` (partagée) → **inchangée** **[F]**.
- Fixtures `tests/fixtures/v16|v17|v18/firestore.rules` : issues du baseline `d58f668`, **ne contiennent aucune règle `procedures`** et restent historiques (jamais à modifier) **[F]**.

### Risques d'une suppression partielle des règles

- Retrait du seul `match /procedures` : le catch-all refuse tout accès → **aucune exposition**, mais validateurs morts + tests rouges.
- Retrait par erreur de `validUpdatedBy` ou `isApproved` : **casse toutes les autres collections** (risque majeur).
- Retrait des validateurs sans le `match` : code mort inoffensif mais dette résiduelle.
- Publication : jamais via `firebase deploy` ; uniquement Console Firebase ou API Firebaserules, avec contrôle SHA-256 avant/après et `npm run test:firestore` obligatoire (`AGENTS.md`, `DEMARCHES_RULES.md`) **[F]**.

---

## 7. Couverture des sauvegardes existantes

Vérifié sur le code actuel **et** l'historique **[F]** :

| Mécanisme | Liste de collections | `procedures` inclus ? |
|---|---|---|
| ZIP v5 — `BACKUP_COLLECTION_NAMES` (`js/backup-archive.js:10-14`) | people, families, trees, documents, tasks, sourceDocuments, sourceRevisions, transcriptionHeads, transcriptionRevisions, genealogyProofs, genealogyProofRevisions, factConclusions, conclusionRevisions, genealogyProposals, genealogyEvents, genealogyNotifications | **Non** |
| Capture serveur — `readBackupCollectionsFromServer` (`js/app.js:12990`) | mêmes 16 collections | **Non** |
| Complétude — `REQUIRED_COLLECTIONS` (`js/backup-archive.js:30-34`) | mêmes 16 collections | **Non** |
| Format v4 hérité — `BASE_V4_FIELDS` (`js/backup-archive.js:36`) | format, version, exportedAt, people, families, trees, tasks, documents | **Non** |
| Export d'origine (`2fe6351`) — `buildBackupManifest({people, families, tasks, documents, blobs})` | 4 collections + fichiers | **Non** |

Points structurels supplémentaires :

1. **Rejet explicite** : `requireCollectionEntries` lève `Collection d'archive inconnue : …` pour tout nom hors liste (`js/backup-archive.js:47`) → **une archive contenant `procedures` serait refusée par le validateur actuel** ; le format applicatif ne peut pas même représenter ces données **[F]**.
2. Le commit `69540c9` le confirme textuellement : « les sauvegardes (sans collection procedures) restent intactes » **[F]**.
3. Restauration : `prepareBackupRestorePlan` exige un manifeste v5 validé (`js/backup-archive.js:398`) — aucun chemin de restauration pour `procedures` **[F]**.
4. **Conséquence** : les sauvegardes applicatives existantes (ZIP v5 et antérieures) **ne permettent ni de conserver ni de restaurer les anciennes Démarches**. Un export JSON brut « à la main » serait insuffisant sans manifeste, typage et test de restauration (§9) **[R]**.
5. **[H]** Un export manuel éventuel via la console Firebase n'est pas documenté dans le dépôt : son existence et son emplacement sont à confirmer auprès de l'opérateur en phase 1 du 5B (non vérifiable depuis le dépôt).

---

## 8. Risques et inconnues

| # | Risque | Gravité | Éléments factuels disponibles | Informations manquantes | Prévention proposée |
|---|---|---|---|---|---|
| R1 | Suppression sans sauvegarde → perte définitive de données réelles | **Haute** | Aucune sauvegarde ne couvre `procedures` (§7) ; volumes réels : 2 dossiers, 3 actions (§4) | Existence d'éventuels exports manuels | Phase 2 bloquante : export dédié + SHA-256 + restauration de test validée avant toute suppression (§9, §10) |
| R2 | Sous-collections orphelines laissées ou créées | **Moyenne** | 0 orphelin aujourd'hui ; `removeDossier` non récursif ; bouton désactivé depuis 2026-10-04 (`01456be`) | Rien de bloquant | Inventaire « collection group `actions` » avant et après ; suppression par dossier : actions puis parent ; comptes de contrôle |
| R3 | Données liées à des personnes encore présentes | **Moyenne** | `personIds` légitime dans le schéma (≤50) ; aucune valeur lue dans ce lot | Contenu réel des `personIds` | Phase 1 : lecture des liens avec autorisation explicite ; la suppression des dossiers n'affecte **pas** `people` (contraire à confirmer) |
| R4 | Dépendances non identifiées (champs additionnels, références manuelles) | **Moyenne** | Règles sans `hasOnly` sur `procedures` (§3.1) | Contenu complet des documents | Export intégral en phase 2 + scan des clés de référence (`documentId`, `targetId`…) en phase 1 |
| R5 | Sauvegarde incomplète ou non vérifiable | **Haute** | Le mécanisme applicatif ignore `procedures` (§7) | — | Manifeste + empreintes SHA-256 + compte par collection + double vérification après transfert |
| R6 | Perte des types Firestore (Timestamps, listes, nulls) | **Moyenne** | `createdAt`/`updatedAt` en Timestamp, `personIds` en liste, champs optionnels absents plutôt que `null` | — | Export type-tagué (§9) + vérification des types dans le test de restauration |
| R7 | Restauration impossible ou fausse | **Haute** | Aucun test existant pour ce format | — | Restauration dans un environnement isolé (émulateur local ou projet vierge) avec comparaison structurelle avant validation |
| R8 | Différences recette ↔ production | **Moyenne** | 1 dossier chacun mais **IDs et actions différents** (1 vs 2) ; règles identiques (même SHA) | Contenu distinct (non lu) | Inventaire et traitement **par environnement** ; ne jamais extrapoler d'un env à l'autre |
| R9 | Droits insuffisants au moment du 5B | **Basse** | Lecture confirmée sur les deux projets avec le compte propriétaire | État exact des rôles IAM (non consulté) | Revérifier les droits avant phase 3 ; opérer avec le même compte de travail |
| R10 | Coûts et quotas | **Basse** | Inventaire métadonnées : < 0,01 € ; volumes minuscules | — | Exports/suppressions en lots ≤ 500 écritures ; estimation chiffrée en phase 1 |
| R11 | Publication de règles incorrectes ou publication accidentelle | **Haute** | Processus documenté (`DEMARCHES_RULES.md`) : Console/API uniquement, SHA-256 avant/après, anciennes copies de règles supprimées le 2026-11-13 | — | Aucun `firebase deploy` ; contrôle SHA-256 ; `npm run test:firestore` obligatoire ; autorisation spécifique (§10 phase 4) |
| R12 | Suppression d'une fonction de sécurité partagée (`isApproved`, `validUpdatedBy`) | **Haute** | Elles servent à toutes les collections (§6) | — | Ne retirer que `validProcedure`, `validProcedureAction` et le bloc `match /procedures` ; invariants de tests à jour ; vérification globale des règles |
| R13 | Lecture de contenu personnel non autorisée pendant l'audit | **Maîtrisée** | Ce lot : uniquement `__name__` et comptes (§2) | — | Réserve explicite : contenu lu uniquement en phase 1 du 5B avec autorisation |
| R14 | Existence d'exports manuels ou de copiés hors dépôt | **Inconnue** | Non documenté dans le dépôt | À confirmer avec l'opérateur | Question obligatoire en phase 1 |

---

## 9. Stratégie de sauvegarde et de restauration (proposée — non exécutée)

### 9.1 Export dédié (phase 2 du 5B)

- **Outil** : script read-only distinct du code applicatif (Node + REST Firestore ou SDK Admin dans un dossier temporaire), rédigé hors dépôt ou dans un dossier `scripts/` dédié soumis à validation ; **jamais** intégré à un build ni à un déploiement.
- **Périmètre** : `procedures` (tous documents) + `procedures/*/actions/*` (tous documents), **par environnement**, avec : `projectId`, identifiant de ruleset actif, date ISO UTC, version du script (empreinte Git).
- **Format par document** :
  ```json
  {
    "path": "procedures/<dossierId>/actions/<actionId>",
    "id": "<actionId>",
    "fields": { … valeurs typées Firestore … }
  }
  ```
  - préservation stricte des **identifiants** et des **chemins complets** (y compris sous-collections) ;
  - **Timestamps** → `{"__type":"timestamp","value":"…Z"}` (jamais de conversion silencieuse en date locale) ;
  - **listes, mapes, booléens, nombres, `null`, champ absent** distingués (le « absent » et le `null` sont sémantiquement différents dans Firestore) ;
  - aucune exécution de `serverTimestamp` à la restauration : les valeurs d'origine sont réécrites telles quelles.
- **Manifeste** (`manifeste.json`) : environnement, `projectId`, ruleset actif, date, comptes par collection, liste des chemins, SHA-256 de chaque fichier et global, outil et version, opérateur (masqué), note « données réelles — confidentialité ».
- **Empreinte** : fichier `SHA-256SUMS` séparé, recalculé après chaque transfert.

### 9.2 Conservation

- **Jamais dans le dépôt Git** (données personnelles) : stockage hors ligne chiffré + une copie distante chiffrée ; emplacement consigné dans le manifeste **[R]**.

### 9.3 Vérification d'intégrité

1. Recalcul des SHA-256 après stockage et après chaque déplacement.
2. Contrôle structurel : comptes du manifeste = comptes relus (réutilisation de la méthode Niveau B, §4).
3. Validation de schéma (présence de `title`/`type`/`status` attendus, types conformes).

### 9.4 Test de restauration isolé

- Restaurer l'archive **dans un environnement qui n'est ni la recette ni la production** (émulateur Firestore local, ou projet Firebase vierge dédié).
- Comparaison : chemins, identifiants, comptes, valeurs, **types** (Timestamp vs string), listes.
- Rapport de test de restauration daté, joint au manifeste ; **la phase 3 ne démarre que si ce test est vert**.

### 9.5 Retour arrière

- Tant que l'archive existe et que le test de restauration est valide, tout est réversible : réécriture des documents aux **mêmes chemins/IDs** (upsert), sous-collections comprises.
- Procédure : restaurer dans l'ordre **dossiers puis actions** ; re-compter ; comparer au manifeste.
- Limite connue : si plusieurs environnements sont concernés, la restauration se fait env par env avec le bon manifeste.

---

## 10. Plan détaillé proposé pour le lot 5B (à exécuter plus tard — non lancé)

### Phase 1 — Vérifications préalables (bloquante)

1. Identification explicite de l'environnement cible (recette d'abord recommandé **[R]**, puis production) et du ruleset actif (API Firebaserules, SHA-256).
2. **Inventaire exhaustif de contenu** (aujourd'hui interdit) : export complet en lecture pour vérifier les liens réels — `personIds`, éventuels champs additionnels (`documentId`…), contenu des actions — **avec autorisation explicite de François**.
3. Vérification des dépendances : scan des clés de référence dans les documents exportés ; relecture du §5.
4. Vérification des droits (lecture **et** suppression) sur l'environnement cible ; confirmation du compte opérateur.
5. Estimation des coûts/quotas (écritures de suppression : quelques documents ; lots ≤ 500).
6. Question sur les éventuels exports manuels existants (R14).
7. **Confirmation explicite de l'autorisation de suppression** (données et, séparément, règles).

### Phase 2 — Sauvegarde (bloquante)

1. Export complet selon §9 (par environnement).
2. Conservation sécurisée hors dépôt.
3. Contrôle d'intégrité (SHA-256 + comptes).
4. Vérification des sous-collections (inventaire `actions` complet, y compris orphelins).
5. **Restauration de test isolée** et rapport vert.
   → Critère d'entrée de la phase 3 : archive + manifeste + empreintes + test de restauration validés.

### Phase 3 — Suppression contrôlée (données uniquement — aucun changement de règles à ce stade)

1. Pour **chaque** environnement séparément, dans l'ordre : par dossier → toutes les `actions`, puis le dossier lui-même (lots ≤ 500, IDs explicites, jamais de `deleteCollection` en bloc non maîtrisé).
2. **Journal d'opérations** : environnement, chemin, ID, horodatage UTC, opérateur, résultat ; conservé avec l'archive.
3. Contrôles de cohérence entre chaque lot : comptes `procedures` et `actions` (méthode §4), détection d'orphelins.
4. **Arrêt immédiat en cas d'anomalie** (compte qui ne descend pas, erreur API, différence inattendue) ; reprise seulement après analyse.
5. Validation intermédiaire entre recette et production (jamais les deux en même temps sans contrôle).
6. Aucune écriture ailleurs que `procedures` et `procedures/*/actions`.

### Phase 4 — Nettoyage technique (séparé de la phase 3, après contrôle intermédiaire)

1. `firestore.rules` : retirer **uniquement** `validProcedure` (241-264), `validProcedureAction` (266-280) et le bloc `match /procedures` (604-621). **Conserver** `isApproved`, `validUpdatedBy`, le catch-all et tout le reste.
2. Tests : adapter `tests/firestore-rules-invariants.mjs` (lignes 33, 35, 93-96) ; retirer/adapter la section Démarches de `tests/firestore-emulator.mjs` (496-683) ; conserver les tests d'icônes et d'absence applicative.
3. Documentation : mettre à jour `DEMARCHES_RULES.md` (mention des règles Démarches retirées, nouveau SHA-256, ruleset post-publication) ; ne pas toucher aux fixtures `v16/v17/v18`.
4. Vérification des **autres** blocs de règles (comparaison avant/après : seule la section Démarches doit changer).
5. `npm run test:firestore` **obligatoire** + `node --test tests/final-qa.test.mjs` (contrôle de non-régression).
6. **Publication des règles uniquement après autorisation spécifique** : copie du contenu exact dans la Console Firebase ou API Firebaserules (jamais `firebase deploy`), contrôle SHA-256 avant/après, consignation des nouveaux IDs de ruleset — recette puis production.

### Phase 5 — Validation

1. Inventaire post-suppression (méthode §4) : `procedures` absent de la liste racine, 0 document, 0 orphelin, dans les deux environnements.
2. Vérification du fonctionnement des autres modules (suites ciblées : UI, emplacements, sauvegardes).
3. Vérification que la restauration depuis l'archive reste possible (re-test d'archive conservée).
4. Mise à jour du rapport de lot (bilan de clôture).

**Séparation impérative** : les opérations de suppression des données (phase 3) et les changements de règles (phase 4) ne sont jamais mélangées ; aucun nettoyage automatique dans un build ou un déploiement Hosting.

---

## 11. Conditions préalables obligatoires (5B)

1. Autorisation explicite et datée de François pour : (a) l'export de contenu complet, (b) la suppression des données, (c) la modification et publication des règles — **trois autorisations distinctes**.
2. Inventaire exhaustif de contenu obtenu et analysé (dépendances réelles).
3. Archive de sauvegarde complète, chiffrée, avec manifeste et SHA-256, stockée hors dépôt.
4. Test de restauration isolé vert et documenté.
5. Droits vérifiés sur l'environnement cible, compte opérateur identifié.
6. Estimation des coûts/quotas communiquée.
7. Confirmation sur le sort du dossier unique existant par env (conservation de l'archive seule vs restauration future).
8. `npm run test:firestore` disponible et vert avant toute modification de règles.
9. Aucun changement de version d'assets, aucun build ni déploiement lié à ce lot.

---

## 12. Décisions nécessitant une validation explicite

| # | Décision | Recommandation |
|---|---|---|
| D1 | Supprimer ou conserver définitivement les données `procedures`/`actions` | Supprimer **après** sauvegarde validée (volumes minuscules, module retiré) — décision finale à François |
| D2 | Supprimer ou conserver les règles Démarches | Supprimer en phase 4 **seulement après** suppression des données validée (les règles seules ne coûtent rien mais maintiennent la dette) |
| D3 | Environnement pilote | Recette d'abord, contrôle intermédiaire, puis production |
| D4 | Méthode d'export et emplacement de conservation | Script dédié read-only + stockage chiffré hors dépôt |
| D5 | Autoriser la lecture de contenu complet (phase 1) | Nécessaire pour closurer les catégories 8/9 du §5 |
| D6 | Moment et modalités de publication des règles | Session dédiée, SHA-256, `test:firestore`, autorisation spécifique |
| D7 | Sortie du dossier unique de chaque env (archiver ?) | Archive complète suffit ; ne rien restaurer sans décision |

---

## 13. Confirmation de l'absence d'opération destructive

Pendant tout le lot 5A :

- **Aucune écriture Firestore** (aucun create/update/delete, aucun document test, aucune migration) — seules des lectures de métadonnées (`listCollectionIds`, agrégations COUNT bornées, requêtes projetant `__name__`) **[F]**.
- **Aucune suppression** de données, de fichiers suivis, de branches ou de documents **[F]**.
- **Aucune modification** de `firestore.rules`, d'index, de fonctions, de configurations Firebase, de permissions ou de paramètres d'authentification ; SHA-256 des règles inchangé (`8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648`) **[F]**.
- **Aucun changement de version d'assets**, aucun build, aucun déploiement (recette ou production), aucune fusion vers `main` **[F]**.
- **Aucune suite de tests exécutée**, aucune campagne complète **[F]**.
- **Aucun secret ni credential** affiché, demandé ou écrit dans le rapport ; aucun service account utilisé **[F]**.
- **Aucune donnée personnelle de contenu** (titres, notes, e-mails, noms, corps d'actions) intégrée au rapport — seuls : noms de collections, comptes, identifiants opaques de documents, métadonnées de règles **[F]**.
- **Git** : seule addition = ce rapport `DEMARCHES_FIRESTORE_AUDIT_5A.md` ; branche `recette` conservée ; aucun `git add` global, aucun `reset`, `clean`, `stash` ni force push **[F]**.
- Scripts temporaires d'inventaire placés **hors du dépôt** (dossier temporaire de l'outil) et supprimés après usage **[F]**.
- Les environnements recette et production sont **strictement inchangés** **[F]**.

---

*Fin du rapport — Lot 5A. Aucune opération du lot 5B n'a été lancée.*
