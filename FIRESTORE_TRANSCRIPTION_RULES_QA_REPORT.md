# QA — Règles Firestore de transcription : candidat définitif (`hasNonEmptyItalian` renforcé)

**Publications effectuées le 2026-11-13** (règles Firestore uniquement, sous autorisation explicite) :

- Production `family-tree-c2fe2` : ruleset **`cc8f5732-749e-41fc-a359-95536d663add`** (10:50:02Z).
- Recette `la-nostra-storia-recette` : ruleset **`21b0044f-cc2b-4579-8a39-184ed32334eb`** (10:58:04Z) — contenu **identique** à la production.

Aucun autre déploiement (Hosting/Functions/Storage), aucune écriture de données, aucune republication en production lors de l'alignement recette. Branche : `recette`.

## 1. Diff définitif des règles

**Règles réellement actives AVANT publication — contrôles préalables du 2026-11-13 (lecture seule, API Firebaserules) :**

| Élément | Valeur |
|---|---|
| Release `cloud.firestore` | `projects/family-tree-c2fe2/rulesets/87b0896d-5491-4c65-8191-2542688fc4cd` |
| Publiée le | 2026-11-12T23:20:21.981943Z |
| Contenu | **identique** (octet pour octet) à la capture de la préparation précédente et à la base committée `5993f95` |

Le candidat `firestore.rules.production-candidate` est construit **à partir de ce contenu réel** ; le diff ci-dessous est la **seule** différence entre production (avant publication) et candidat : **+15 lignes, 0 suppression**.

```diff
@@ -453,6 +453,19 @@ function validGenealogyDate(value) {
         && validCollaborationId(data.eventId) && validCollaborationId(data.revisionId);
     }
 
+    /* Une transcription officielle ne peut jamais porter un texte italien vide :
+       invariant vérifié côté base à chaque écriture (création ET révision).
+       Un texte composé uniquement de blancs (propriété Unicode
+       White_Space, identique au trim applicatif) est refusé au même
+       titre qu'un texte vide.
+       La traduction française reste facultative. */
+    function hasNonEmptyItalian(data) {
+      return data.data is map
+        && data.data.transcriptionIt is string
+        && data.data.transcriptionIt.size() > 0
+        && !data.data.transcriptionIt.matches('^[\\t\\n\\v\\f\\r \\x{0085}\\x{00A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}]*$');
+    }
+
     function officialDeletionLockPath(objectType, objectId) {
       return /databases/$(database)/documents/officialDeletionLocks/$(objectType)/objects/$(objectId);
     }
@@ -692,11 +705,13 @@ function validGenealogyDate(value) {
     match /transcriptionHeads/{transcriptionId} {
       allow read: if isApproved();
       allow create: if isAdmin() && validOfficialRecord(request.resource.data)
+        && hasNonEmptyItalian(request.resource.data)
         && request.resource.data.version == 1 && request.resource.data.createdAt == request.time
         && request.resource.data.updatedAt == request.time
         && hasOfficialEvent(request.resource.data.eventId, 'transcription', transcriptionId, request.resource.data.revisionId, null)
         && hasOfficialRevision('transcriptionRevisions', request.resource.data.revisionId, transcriptionId, request.resource.data.eventId, request.resource.data.data, null);
       allow update: if isAdmin() && validOfficialRecord(request.resource.data)
+        && hasNonEmptyItalian(request.resource.data)
         && request.resource.data.version == resource.data.version + 1
         && request.resource.data.createdAt == resource.data.createdAt
         && request.resource.data.createdBy == resource.data.createdBy
```

Inchangés : sept types de dates (7/7), permissions, règles Démarches (`procedures`), immuabilité des `transcriptionRevisions`, restrictions, validations existantes, `catch-all`. `firestore.rules` gelé, `firestore.rules.recette` et les fixtures **non modifiés**.

### Vérification de l'expression régulière (moteur réel des règles)

- **Compilation** testée contre le compilateur de l'émulateur (même langage que la production) : `\p{White_Space}` → **refusé** (« Invalid regular expression pattern ») ; `[[:space:]]`, `\s`, `\x{…}`, classes POSIX → acceptés.
- **Comportement** validé par une matrice 10 variantes × 6 entrées sur écritures réelles (projet fictif) : la variante retenue refuse `   ` (espaces), `\n`, `\t`, NBSP U+00A0 ; accepte `aaa` et `a b` — exactement le comportement attendu.
- **Cohérence applicative** : la classe couvre la propriété Unicode `White_Space` (controles ASCII + U+0085, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000) — le même ensemble que le `trim()` de `hasTranscriptionContent` (`js/document-transcription.js:170`). Double gate : l'application refuse déjà ces validations (`js/app.js:8041`, `:8087`), la règle refuse désormais tout appel direct.
- Les antislashs sont **doublés dans le fichier** (chaîne de règles `\\t` → motif RE2 `\t`), forme vérifiée octet à octet contre la variante validée.

## 2. Résultats des tests (émulateur local uniquement, aucune donnée réelle)

| # | Configuration | Résultat |
|---|---|---|
| 1 | **Candidat définitif** (`FIRESTORE_RULES_COMPLETE=../firestore.rules.production-candidate`) | **86/86** ✓ |
| 2 | Suite par défaut du dépôt (fichier gelé + extension de dates) | **86/86** ✓ |
| 3 | `node --test tests/final-qa.test.mjs` | **1/1** ✓ |
| 4 | Contrôle sur production actuelle (préparation précédente) | 84/85 — production accepte aujourd'hui l'officielle vide |

Scénarios couverts (`tests/firestore-emulator.mjs:2361` — LOT 2B.2 incrément 3 + incrément 2 existant) :

- Officielle avec texte italien → **acceptée** (v1) ; révision → **acceptée** (v2).
- Officielle **vide** → **refusée** (création et révision).
- Officielle **espaces / retour à la ligne / NBSP** → **refusée** (candidat ; les trois cas assertés).
- **Brouillon incomplet** (italien vide) → **accepté** (transcription progressive libre).
- **Révision traduction seule** (italien inchangé) → **acceptée** ; traduction française enregistrée, italien préservé.
- Permissions inchangées : membre refusé en écriture officielle, lecture approuvée OK, révisions immuables, head non supprimable.
- **Sept types de dates** (valides acceptés, formes invalides refusées) et Démarches : non régressés.

Aucun test supprimé ni assoupli. Le test d'espaces affirme le comportement **réellement chargé** (drapeau posé par le harnais, `tests/firestore-emulator.mjs:41` et `:88`) : refus sous le candidat, comportement historique `size() > 0` sous le fichier gelé — les deux configurations sont assertées, aucune n'est masquée. À noter : c'est ce test qui a détecté un défaut intermédiaire du motif (classe de caractères privée de ses crochets → `matches()` ne correspondait jamais), corrigé avant la validation finale — le fichier définitif est octet-identique à la variante validée par la matrice.

## 3. Compatibilité avec les données existantes

- **Release de production inchangée** pendant toute la préparation (id et contenu revérifiés, §1).
- **`transcriptionHeads` = 0 document en production ET 0 en recette** (lecture seule) : aucune transcription officielle existante ne peut être bloquée par la nouvelle exigence ; le contrôle ne vise que des écritures futures.
- Brouillons (`transcriptionDrafts`) : règles **non touchées** — sauvegardes progressives et brouillons incomplets inchangés.
- Écritures sans rapport avec l'italien (ajout de traduction, justification, horodatages) : testées, **acceptées** dès lors que l'italien courant est valide.
- Aucune donnée lue, écrite, migrée ni supprimée en production.

## 4. Risques résiduels

1. **Recette et fichier gelé du dépôt gardent l'ancienne formule** (`size() > 0` uniquement) — volontairement non modifiés (hors périmètre). En recette, un appel direct à l'API pourrait encore enregistrer un texte d'espaces seuls ; l'interface l'interdit déjà. Alignement recette = chantier séparé, à approuver.
2. **Moteur de production** : la validation a été menée sur l'émulateur (même langage de règles, RE2) ; après publication, un essai réel confirmera le refus en production (procédure §5, étape 6).
3. **`transcriptionRevisions` sans contrôle d'italien** : par conception (collection immuable, écrite dans la même transaction atomique qu'un head validé) — sans effet affiché.
4. Caractères exotiques hors propriété `White_Space` éventuellement trims côté application mais non couverts par la classe : couvert par le contrôle applicatif, jamais atteignable via l'interface.
5. Aucun commit, aucun push, aucune publication effectués — tout reste local sur `recette`.

## 5. Procédure exacte de publication (uniquement les règles Firestore)

1. **Préflight (lecture seule)** : release active = toujours `87b0896d-5491-4c65-8191-2542688fc4cd` (API Firebaserules) et `transcriptionHeads` toujours à 0 document.
2. Firebase Console → projet **`family-tree-c2fe2`** → **Firestore → Règles**.
3. Remplacer l'intégralité du contenu par le texte **exact et complet** de `firestore.rules.production-candidate` (tel quel, sans retouche ; encodage UTF-8 conservé).
4. Cliquer **Publier**, puis consigner ici le **nouvel identifiant de ruleset** et l'horodatage :
   - Ruleset publié : **`cc8f5732-749e-41fc-a359-95536d663add`** — 2026-11-13T10:50:02.893250Z (remplace `87b0896d-5491-4c65-8191-2542688fc4cd`).
5. **Interdits** : aucun `firebase deploy`, aucun push (`main`/`recette`), aucune modification de `firestore.rules`, des règles de recette ou des données.
6. **Contrôles après publication** :
   - API : nouvelle release active ≠ `87b0896d…` et son contenu = le candidat.
   - Application réelle : création officielle avec texte italien valide → acceptée ; tentative avec texte vide **et** texte d'espaces → refus `permission-denied` attendu ; sauvegarde d'un brouillon et révision de traduction → toujours acceptées.
7. **Recette** : aucun déploiement dans le cadre de la publication en production. Alignement de recette réalisé ultérieurement sous autorisation distincte — voir « Alignement recette — 2026-11-13 » ci-dessous.

## Publication effectuée — 2026-11-13

**Contrôles préalables (lecture seule,14/14 au vert)** avant toute écriture :

1. Release active = `87b0896d-5491-4c65-8191-2542688fc4cd` et son contenu = base committée `5993f95`.
2. Candidat sha256 `8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648` (892 lignes) ; retrait de **ses seuls ajouts** (bloc `hasNonEmptyItalian` +2 gardes) redonne **exactement** le contenu actif → diff prouvé = +15/0.
3. Invariants présents : 7 types de dates, Démarches, catch-all, brouillons, `delete` des heads refusé.
4. `transcriptionHeads` = **0 document** en production.
5. **Contrôle comportemental sur les octets exacts du candidat** (émulateur, `FIRESTORE_RULES_COMPLETE`) : **86/86**, sha256 inchangé avant/après.

**Méthode de publication** : API Firebaserules v1 (le même plan de contrôle que le bouton « Publier » de la console) — `POST /v1/projects/family-tree-c2fe2/rulesets` avec le contenu exact du candidat, puis `PATCH …/releases/cloud.firestore` (corps enveloppé sous `release`, forme utilisée par firebase-tools). **Aucun `firebase deploy`**, aucun autre service, `firestore.rules` du dépôt non utilisé (5 types de dates), règles de recette non touchées.

**Vérification post-publication (lecture seule,13/13 au vert)** :

- Release active : `cc8f5732-749e-41fc-a359-95536d663add` (2026-11-13T10:50:02.893250Z).
- Contenu réellement actif : **sha256 identique au candidat** (`8237de11…`) — publication octet pour octet.
- Présents dans le contenu actif : `hasNonEmptyItalian` (×3), ses 2 gardes, motif de blancs, 7 types de dates, Démarches, catch-all, permissions, brouillons.
- Release de recette inchangée : `fc88c0f2-771c-4f3b-9753-295c8399cba8`.
- `transcriptionHeads` toujours à **0 document** : aucune donnée créée ni modifiée.

## Alignement recette — 2026-11-13 (sous autorisation distincte)

**Préalignement (lecture seule,18/18 au vert)** :

- Releases relevées : production `cc8f5732-749e-41fc-a359-95536d663add` (inchangée), recette `fc88c0f2-771c-4f3b-9753-295c8399cba8` (inchangée depuis le 2026-11-12).
- Contenu de production == candidat versionné (sha256 `8237de11…`) ; contenu de recette actif == fichier `firestore.rules.recette` (avant mise à jour).
- **Diff production ↔ recette** : après retrait de la partie transcription, **0 différence fonctionnelle** —10 lignes d'indentation seule sur `validGenealogyDate` (cosmétique, identique sémantiquement). Seule différence fonctionnelle : **`hasNonEmptyItalian`** (recette = ancienne formule `size() > 0`, production = formule renforcée avec motif de blancs). Les deux environnements avaient déjà les7 types de dates, Démarches et le catch-all.
- `transcriptionHeads` =0 document dans les deux environnements.

**Préparation** : `firestore.rules.recette` mis à jour par copie **octet pour octet** du contenu publié en production (sha256 `8237de11…`,892 lignes) — les deux environnements appliquent désormais exactement les mêmes règles. Le fichier `firestore.rules` gelé n'a **pas** été touché.

**Tests ciblés avec les règles finales de recette** (`FIRESTORE_RULES_COMPLETE=../firestore.rules.recette`) : **86/86** ✓ — sha256 inchangé pendant les tests (transcriptions valides/invalides, espaces/tabulations/lignes/NBSP refusés, brouillons, révisions de traduction,7 types de dates, permissions). `final-qa` : **1/1** ✓.

**Publication recette** : API Firebaserules (même méthode qu'en production), contenu exact de `firestore.rules.recette` :

- Nouveau ruleset actif recette : **`21b0044f-cc2b-4579-8a39-184ed32334eb`** — 2026-11-13T10:58:04.387642Z (remplace `fc88c0f2…`).
- **Vérification post-publication (10/10 au vert)** : contenu actif == contenu testé (sha256 `8237de11…`) == fichier versionné == **contenu de production (identique octet pour octet)** ; production inchangée (`cc8f5732…`) ; `hasNonEmptyItalian` +2 gardes + motif de blancs,7 types de dates, Démarches, catch-all présents ; `transcriptionHeads` =0 document dans les deux environnements (aucune donnée écrite).
- Aucun déploiement Hosting/Functions/Storage ; production non republiée.

## Organisation des fichiers de règles — clôture du 2026-11-13

**Référence unique : `firestore.rules`** — contenu strictement identique aux règles actives des deux environnements (SHA-256 `8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648`,892 lignes) : sept types de dates, `hasNonEmptyItalian` renforcé, permissions, Démarches, restrictions et `catch-all`. Le commit précédent `26ed7ab` avait placé le contenu publié dans les fichiers candidat ; cette clôture l'unifie dans la référence unique.

| Fichier | Statut |
|---|---|
| `firestore.rules` | **Référence unique** = contenu publié (production `cc8f5732…`, recette `21b0044f…`) |
| `firestore.rules.recette` | **Supprimé** — copie redondante (contenu identique) ; historique conservé dans git |
| `firestore.rules.production-candidate` | **Supprimé** — copie redondante ; historique conservé dans git (`26ed7ab`, `5993f95`) |
| `firestore.rules.candidate` | **Supprimé** — fragment d'extension des dates devenu obsolète (`firestore.rules` contient les sept types) |
| `tests/fixtures/v16/v17/v18` | Inchangés — snapshots historiques (jamais modifiés) |

Aucune dépendance technique ne nécessitait de conserver les trois fichiers supprimés : le harnais de tests a été adapté pour charger `firestore.rules` directement, et `firebase.json` (`"firestore.rules": "firestore.rules"`) ainsi que les scripts de build (exclusion du Hosting) restent valides sans modification. `AGENTS.md` et `DEMARCHES_RULES.md` ont été mis à jour : référence unique, publication manuelle (Console ou API Firebaserules, jamais un `firebase deploy` depuis une version historique), SHA-256 à revérifier avant toute publication.

**Harnais de tests** (`tests/firestore-emulator.mjs`) : la branche par défaut charge `firestore.rules` tel quel et vérifie la présence des sept types de dates et de `hasNonEmptyItalian` ; le mécanisme `FIRESTORE_RULES_COMPLETE` est conservé pour valider un futur fichier complet. Aucun test supprimé ni assoupli.

### Vérifications de clôture

- SHA-256 local `firestore.rules` = contenu actif production = contenu actif recette (relevés API du 2026-11-13, rulesets inchangés) : **identique**.
- `npm run test:firestore` (chemin par défaut) : **86/86** — sept types de dates, transcriptions valides/invalides (vide, espaces, tabulations, lignes, NBSP refusés), brouillons, révisions de traduction, permissions.
- Suites liant les règles (`final-qa`, `interaction-language`, `responsive-accessibility`, `person-updatedby`, `qa-70-cases`, `family-links-ui`, `transcription-draft-sync`, `evolution-final-qa`) : **43/44** — invariants de sécurité, Démarches, catch-all, brouillons : tous verts.
- Échec connu **préexistant et hors périmètre** : `evolution-final-qa.test.mjs` — « la sauvegarde reste additive et sans migration globale » : la regex `/migration/i` appliquée à `js/app.js` (non modifié par cette maintenance) correspond aux clés d'icônes `emigration:` / `immigration:` et aux commentaires de brouillon (« migration non destructive »). Aucun lien avec les règles ; ni le test ni `js/app.js` ne sont touchés ici — à traiter comme chantier séparé.
- Aucun déploiement, aucune modification des règles actives (production `cc8f5732…`, recette `21b0044f…` inchangées), aucune donnée Firestore touchée, aucun push vers `main`.

## État des fichiers — commit de clôture

Fichiers regroupés dans le commit de clôture (uniquement ceux-ci) :

- `firestore.rules` — reçoit le contenu publié (référence unique).
- `firestore.rules.recette`, `firestore.rules.production-candidate`, `firestore.rules.candidate` — suppressions (copies redondantes).
- `tests/firestore-emulator.mjs` — harnais : chargement direct de la référence.
- `AGENTS.md`, `DEMARCHES_RULES.md` — documentation de référence.
- `FIRESTORE_TRANSCRIPTION_RULES_QA_REPORT.md` — ce rapport.

Hors commit, **préservés inchangés** (modifications étrangères locales) : `js/firebase-environment.js`, `tests/firebase-environment.test.mjs`, `DOCUMENT_DETAIL_PAGE_QA_REPORT.md`, `PROOF_DETAIL_PAGE_QA_REPORT.md`, `SOURCE_DETAIL_PAGE_QA_REPORT.md`, `tests/_repro-transfer-fingerprint.mjs`. Inchangés : fixtures, `js/app.js`, `firebase.json`, `package.json`, aucune règle republiée.
