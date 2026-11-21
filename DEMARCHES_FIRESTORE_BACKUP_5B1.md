# Sauvegarde de sécurité des anciennes données Démarches — Lot 5B.1

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche / HEAD | `recette` @ `48e2abe` (état vérifié avant lot) |
| Rapport de référence | `DEMARCHES_FIRESTORE_AUDIT_5A.md` |
| Décision en vigueur | Suppression définitive des données Démarches des deux environnements (décision utilisateur) |
| Ce lot | **Sauvegarde + vérification + préparation uniquement — aucune suppression, aucune écriture distante** |

**Conventions** : **[F]** = fait vérifié · **[R]** = recommandation / plan non exécuté.

---

## 1. Périmètre

- **Lu et sauvegardé** (portée stricte autorisée) : `procedures/{dossierId}` et `procedures/{dossierId}/actions/{actionId}` dans les deux environnements.
- **Non lu** : toute autre collection Firestore (aucune élargie de collecte).
- **Non fait** : aucune suppression, aucune écriture sur Firestore recette/production, aucune modification de règles/index/fonctions/permissions, aucun déploiement, aucune fusion, aucun changement d'assets, aucune modification du code applicatif.
- Vérifications limitées à l'export et à la restauration (aucune campagne de tests applicatifs, aucun build Hosting).

## 2. Identifiants des environnements

| Environnement | Projet Firebase | Rôle dans le lot |
|---|---|---|
| Recette | `la-nostra-storia-recette` | Source d'export (lecture seule) |
| Production | `family-tree-c2fe2` | Source d'export (lecture seule) |
| Espace local 1 | `lot5b1-recette-restore` | Espace de restauration isolé (émulateur, jamais un projet distant) |
| Espace local 2 | `lot5b1-production-restore` | Espace de restauration isolé (émulateur, jamais un projet distant) |

Identité d'accès : compte Google du propriétaire du dépôt via la CLI Firebase déjà authentifiée (`firebase login:list` / `projects:list` confirmant l'accès aux deux projets). Aucun credential de service utilisé (`GOOGLE_APPLICATION_CREDENTIALS`, ADC, `FIREBASE_CONFIG` distant : absents — vérifié avant accès).

## 3. Inventaire exact

### 3.1 Recette — `la-nostra-storia-recette`

| Indicateur | Valeur |
|---|---|
| Dossiers `procedures` | **1** (chemin `procedures/va5JB1tWhBwE9F2sCjX7`) |
| Sous-collections par dossier | `actions` uniquement (aucune autre sous-collection) |
| Documents `actions` | **1** |
| Total documents | **2** |
| Actions orphelines (dossier parent absent) | **0** |
| Chemins atypiques / hors schéma | **0** |
| Collections racine listées | 20 (contexte ; `procedures` présent) |

### 3.2 Production — `family-tree-c2fe2`

| Indicateur | Valeur |
|---|---|
| Dossiers `procedures` | **1** (chemin `procedures/1Bhrpx4cA3dJtBMgAM3Y`) |
| Sous-collections par dossier | `actions` uniquement |
| Documents `actions` | **2** |
| Total documents | **3** |
| Actions orphelines | **0** |
| Chemins atypiques / hors schéma | **0** |
| Collections racine listées | 13 (contexte) |

### 3.3 Types de valeurs Firestore rencontrés (recensement sur les valeurs exportées)

| Environnement | Types présents |
|---|---|
| Recette | `stringValue` ×33, `timestampValue` ×4, `arrayValue` ×1 |
| Production | `stringValue` ×48, `timestampValue` ×6, `arrayValue` ×1 |

Aucun `integerValue`, `doubleValue`, `booleanValue`, `nullValue`, `geoPointValue`, `referenceValue` ni `bytesValue` rencontré. Les dates `createdAt`/`updatedAt` sont des **Timestamps** (préservés tels quels), `personIds` est une **liste** (préservée).

### 3.4 Méthode d'inventaire

- `documents:listCollectionIds` (racine et par dossier) → structure, détection de sous-collections supplémentaires.
- `documents:runQuery` « collection group » sur `procedures` et sur `actions` (`allDescendants`) → dossiers, actions, orphelins, chemins atypiques.
- Recoupement exhaustif dossier ↔ collection group (aucun écart, aucun doublon).
- Lecture **uniquement** des chemins du périmètre ; toute sous-collection autre que `actions` aurait été signalée **sans être lue** (aucune rencontrée).

## 4. Méthode d'export

- **Outil** : `tools/export-demarches.mjs` (stocké avec l'archive, empreinte §7).
- **Accès** : API Firestore v1 en HTTPS avec le jeton OAuth de la CLI Firebase (compte propriétaire). **RPC strictement read-only** : `listCollectionIds` et `runQuery` uniquement — le script ne contient aucune requête d'écriture (aucun PATCH/PUT/DELETE).
- **Portée** : seuls les documents des deux chemins autorisés, par environnement, dans deux fichiers distincts.
- **Contrôles intégrés** : jeton valide avant démarrage ; limites de requête (échec explicite si troncature possible, jamais d'export partiel silencieux) ; relecture du fichier après écriture (structure, chemins, comptes) ; **double-read source après export** avec comparaison canonique (contenu + `updateTime`) → verdict `COHÉRENT` dans les deux environnements ; aucune valeur de champ journalisée.
- **Date d'export** : recette `2026-11-21T09:36:59.963Z`, production `2026-11-21T09:37:04.526Z`.

## 5. Format des archives

- Format : `demarches-typed-firestore-export`, version **1**.
- Un fichier JSON par environnement contenant, par document :
  - `path` : chemin Firestore complet relatif (`procedures/…`, `procedures/…/actions/…`) ;
  - `id` : identifiant du document (identiques à la source) ;
  - `fields` : **valeurs typées REST Firestore d'origine** (`stringValue`, `timestampValue`, `arrayValue`, objets `mapValue` imbriqués…) — format réversible, **aucune conversion** de Timestamp en chaîne ni de référence en texte ;
  - `createTime` / `updateTime` : métadonnées source effectivement disponibles.
- Le manifeste ajoute : projet, date, comptes, format/version, liste des chemins (sans valeurs), empreintes, outil+version, méthode.
- Réversibilité démontrée : la restauration réécrit ces mêmes objets typés sans transformation (§9).

## 6. Emplacement de conservation (sans secret)

```
C:\Users\<compte-utilisateur>\Documents\family-tree-technical-archive\lot-5b1-demarches-backup\
├── tools\                     export-demarches.mjs, restore-demarches.mjs
├── recette\                   archive, manifest.json, SHA256SUMS.txt, export-journal.txt
├── production\                archive, manifest.json, SHA256SUMS.txt, export-journal.txt
└── restore-tests\             rapports de restauration, journaux émulateur, workspaces locaux
```

- **Hors du dépôt Git** (dossier sœur, aucun `.git`, non suivi — `git status` du dépôt reste vide hors rapport).
- **ACL restreintes** : héritage supprimé, accès limité au compte utilisateur et `SYSTEM`.
- Dossier `Documents` local (Known Folder **non** déplacée vers OneDrive — vérifié : `[Environment]::GetFolderPath('Personal')` pointe vers le `Documents` local de l'utilisateur, pas vers `OneDrive\Documents`) ; aucun outil de synchronisation publique détecté sur ce chemin.
- Aucun secret ni credential dans ces fichiers ; les journaux ne contiennent que chemins, comptes et empreintes (vérifié : aucune occurrence de titre/e-mail/personne dans les journaux d'émulateur).
- **Jamais versionné** : ces fichiers ne seront à aucun moment indexés par Git.

## 7. Empreintes SHA-256

| Fichier | SHA-256 |
|---|---|
| `recette/la-nostra-storia-recette-demarches-export.json` (3 855 octets) | `2357f099b1231f79d6a80356fab6e0805271faad8d6f185b9ef63536c4101b07` |
| `recette/manifest.json` | `740b9e5e3bd9b3193baefa369e99fdc1175fb66d55272daba02900828be5a22f` |
| `production/family-tree-c2fe2-demarches-export.json` (7 269 octets) | `8d2fdd018f4ffc81a27ae3ff5a36697c7cb090e43d842b4d84f7b3cf9f4c5f50` |
| `production/manifest.json` | `0bef5c88840359e8aac465811713b7d3fa31cc2c1e63baacf3d18f97da814538` |
| `tools/export-demarches.mjs` | `1c6c9a5409b4dcf4690b6ff1fe30b44bf317d61820a9411d082c93bbff87016b` |
| `tools/restore-demarches.mjs` | `fd80ea762aaa74025f48a13d83db4450ed5660c712fc9cf989ee089759cc0ea6` |

Chaque dossier contient un `SHA256SUMS.txt` ; les empreintes des archives ont été **recalculées indépendamment** (PowerShell `Get-FileHash`) et concordent.

## 8. Vérifications d'intégrité

| Contrôle | Recette | Production |
|---|---|---|
| Relecture du fichier, format et version validés | ✓ | ✓ |
| Structure : tous les `path` sous `procedures/`, `id` présents, `fields` objets | ✓ | ✓ |
| Comptes fichier = comptes manifeste = comptes source | 2 = 2 = 2 | 3 = 3 = 3 |
| Absence de troncature (JSON complet, requêtes sous la limite, `truncated=false`) | ✓ | ✓ |
| Recalcul SHA-256 conforme à `SHA256SUMS.txt` | ✓ | ✓ |
| Sous-collections présentes dans l'archive (`actions`) | ✓ | ✓ |
| **Double-read source après export** (relecture serveur, comparaison canonique contenu + `updateTime`) | `COHÉRENT` (0 écart) | `COHÉRENT` (0 écart) |

Aucune modification des données source pendant l'export n'a été détectée ; la sauvegarde est déclarée validée sur ces bases.

## 9. Résultats de restauration isolée (obligatoire)

Environnement : **Firebase Emulator local uniquement** (jar `cloud-firestore-emulator-v1.22.0` déjà en cache), lancé via `firebase emulators:exec` depuis des workspaces dédiés hors dépôt.

### Garde-fous vérifiés avant restauration

- Endpoint **codé en dur sur `127.0.0.1`** dans l'outil (aucun hôte distant possible ; refus explicite de tout domaine `firestore.googleapis.com`).
- `GOOGLE_APPLICATION_CREDENTIALS` absent ; `FIREBASE_CONFIG` accepté **uniquement** si son `projectId` est strictement l'espace de test demandé (vérifié : `lot5b1-*-restore`) ; `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT` absents ou conformes.
- Projet de test exigé au format `lot5b1-*`, distinct du projet source.
- **Espace de test vierge confirmé** avant écriture (liste des collections vide).
- SHA-256 de l'archive revérifié **avant** restauration.
- Ports dédiés (8091 / 8092, hubs 4411 / 4412), host `127.0.0.1`, UI désactivée, workspaces indépendants (`restore-tests/ws-recette`, `restore-tests/ws-production`), règles de test locales **jamais publiées**.
- Stockage : **aucune persistance** — le jar n'expose aucun mode de stockage persistant et aucun n'a été activé → les données de test existaient uniquement en mémoire et ont été détruites à l'arrêt de chaque instance (isolation maximale, aucun résidu sur disque).

### Résultats

| Contrôle | Recette (`lot5b1-recette-restore`) | Production (`lot5b1-production-restore`) |
|---|---|---|
| Documents restaurés | **2/2** | **3/3** |
| Relecture après restauration | 2 documents | 3 documents |
| Comparaison canonique archive ↔ restauré (path + fields typés) | **0 écart** | **0 écart** |
| Identifiants et chemins identiques | ✓ | ✓ |
| Sous-collections retrouvées | `actions` | `actions` |
| Types restaurés (Timestamps, listes, chaînes) | conformes | conformes |
| Rapport écrit | `restore-tests/recette-restore-report.json` | `restore-tests/production-restore-report.json` |
| **Verdict** | **RESTAURATION VALIDÉE** | **RESTAURATION VALIDÉE** |

La comparaison porte sur une sérialisation canonique (clés triées récursivement, valeurs typées intactes) : simple réussite d'écriture non suffisante — le contenu typé complet est revenu identique.

## 10. Écarts éventuels avec le lot 5A

**Aucun écart.**

| Indicateur | 5A | 5B.1 |
|---|---|---|
| Recette : dossiers / actions | 1 / 1 | 1 / 1 |
| Production : dossiers / actions | 1 / 2 | 1 / 2 |
| Orphelins | 0 | 0 |
| Sous-collections supplémentaires | aucune | aucune |
| Chemins atypiques | 0 | 0 |

## 11. Plan de suppression proposé (préparé — **NON EXÉCUTÉ**)

> Aucune commande n'est fournie ici sous une forme exécutable automatiquement ; l'exécution relèvera d'un lot distinct (5B.2), manuel, avec autorisation explicite.

### 11.1 Préalables le jour J (par environnement)

1. Re-vérifier les comptes source (méthode §3.4) : ils doivent être exactement **recette 1+1** et **production 1+2** ; tout écart → **arrêt**.
2. Re-vérifier les SHA-256 des archives (§7) et la présence des manifestes.
3. Confirmer l'autorisation explicite de suppression et l'ordre retenu (**recette d'abord**, contrôle, puis production).

### 11.2 Exécution (jamais dans un build, un test ou un déploiement)

Pour chaque environnement, dans l'ordre :

1. **Cibler uniquement les chemins** listés dans le manifeste (`procedures/1Bhrpx4cA3dJtBMgAM3Y` et ses actions ; `procedures/va5JB1tWhBwE9F2sCjX7` et son action) — **jamais** de suppression par collection entière ni par requête.
2. **Ordre** : supprimer d'abord chaque document `…/actions/{actionId}`, puis le document dossier `procedures/{dossierId}` (jamais l'inverse, pour ne jamais créer d'orphelin).
3. **Écritures** : suppression par chemin explicite, en lots bornés, projet par projet, avec **journal** (chemin, horodatage UTC, opérateur, résultat) conservé à côté des archives.
4. **Contrôle intermédiaire** : après chaque lot, re-compter ; si un compte ne diminue pas comme prévu ou qu'une erreur survient → **arrêt immédiat**.
5. **Protections hors périmètre** : aucun autre projet, aucune autre collection, aucune règle ou configuration modifiée dans le même temps ; double vérification des identifiants de projet avant écriture.

### 11.3 Vérification post-suppression

- `listCollectionIds` racine : `procedures` **absent** des deux projets.
- Comptes : `procedures` = 0, collection group `actions` = 0, orphelins = 0, chemins atypiques = 0.
- Recette contrôlée et validée **avant** de traiter la production.

### 11.4 Conditions d'arrêt

- Compte différent de l'inventaire, erreur API, donnée hors périmètre touchée, journal incomplet, perte de connectivité → arrêt, pas de reprise sans analyse ; conserver les archives (jamais les altérer).

### 11.5 Récupération depuis les archives

- Procédure documentée et déjà éprouvée localement : réécriture `PATCH` des mêmes chemins avec les `fields` typés de l'archive (outil `restore-demarches.mjs`, adapté à un ciblage distant **uniquement** sur instruction et autorisation explicites — jamais automatique).
- Déclenchement possible uniquement si une suppression est jugée fausse, dans les deux sens : restauration des documents manquants, ou (si nécessaire) ré-export puis nouvelle sauvegarde.

## 12. Conditions bloquantes avant effacement (lot 5B.2)

1. **Autorisation explicite et datée** du propriétaire du dépôt pour exécuter la suppression (décision de principe déjà exprimée, à confirmer pour le passage à l'acte).
2. Archives, manifestes et empreintes **revérifiés le jour même** (SHA-256 conformes).
3. Restaurations isolées validées — **faites et documentées (§9)**.
4. Comptes sources **reconfirmés à J-0** conformes à §10 (sinon : nouvel export et répétition des vérifications).
5. Aucune modification concurrente en cours (code, règles, données) ; branche et HEAD connus.
6. Journal de suppression prêt, fenêtre d'opération et ordre (recette → contrôle → production) validés.
7. Procédure de récupération (§11.5) relue et jugée applicable.

## 13. Confirmation de l'absence de modification distante

- **Aucune écriture** sur Firestore recette ou production : seuls `listCollectionIds` et `runQuery` (RPC read-only) ont été appelés sur l'API distante ; l'outil d'export ne contient aucune requête d'écriture **[F]**.
- Les seules écritures (`PATCH`) ont été adressées à `http://127.0.0.1:8091` et `http://127.0.0.1:8092` (émulateur local) — vérifié dans les rapports de restauration (§9) **[F]**.
- **Aucune suppression** de données distantes ; **aucune** règle, index, fonction, permission ou configuration Firebase modifié ; **aucun** déploiement ; **aucune** fusion ; **aucun** changement d'assets ; **aucune** modification du code applicatif **[F]**.
- Aucun secret ou credential ajouté, affiché ou journalisé ; aucune valeur personnelle dans ce rapport (seuls identifiants opaques de documents, comptes et empreintes) **[F]**.
- Git : seul `DEMARCHES_FIRESTORE_BACKUP_5B1.md` est ajouté au dépôt ; les archives restent hors dépôt et ne seront jamais indexées **[F]**.

---

*Sauvegardes et restaurations validées — le lot 5B.2 (suppression) n'a pas été lancé et exige une instruction et une autorisation distinctes.*
