# Cartographie technique — La Nostra Storia

> Objectif : localiser en une lecture les fichiers d'une fonctionnalité, ses tests et ses précautions, sans explorer tout le dépôt.
> Conventions : **[V]** vérifié sur le code · **[H]** hypothèse à confirmer · lignes `js/` = module, `tests/x` = `tests/x.test.mjs`.
> Dépend de : `docs/TEST_MATRIX.md` (commandes) et `AGENTS.md` (règles de travail). Ne pas dupliquer ce contenu ailleurs.

## A. Ossature et points d'entrée

| Élément | Référence [V] |
|---|---|
| Page unique | `index.html` (~890 lignes) : import map (51 entrées), sprite SVG (71 symboles), markup de toutes les vues, bloc `<style>` court |
| Points d'entrée JS | `js/form-ui.js` (validation globale des formulaires, autonome, sans import) + `js/app.js` (~17 670 lignes, orchestrateur) |
| Styles | `css/design-system.css` (feuille unique, aucun `@import`), tokens `--color-* / --space-* / --radius-*` |
| Version des assets | meta `asset-release` dans `index.html` + toutes les refs `?v=` (voir AGENTS.md §Build) |
| CDN / local | SDK Firebase `gstatic` 12.2.1 (import direct), JSZip (import dynamique CDN), `vendor/pdfjs/` (local, régénéré par le build depuis `pdfjs-dist`) |
| Builds | `scripts/build-recette.mjs` → `dist-recette/` (gitignoré) ; `scripts/build-production.mjs` → `dist-production/` (gitignoré, lit `firebase.production.json`) |
| Publications | Firebase Hosting (recette ou production, `--project` explicite) ; GitHub Pages ne sert que `pages-redirect/` (workflow `main`) |
| Firestore | `firestore.rules` (référence unique publiée — voir `DEMARCHES_RULES.md`), collections : people, families, documents, documentChunks, tasks, users, settings/access, trees, + collections genealogy/source/transcription |

## B. Domaines fonctionnels

### 1. Gestion des personnes
- **Entrée** : `index.html` (`personDialog`, panneaux identité/famille/documents) ; rendu et persistance dans `js/app.js`.
- **Modules** : `person-multiselect.js`, `person-name-variants.js`, `family-relations.js`, `family-dissociation.js`, `family-parent-addition.js`, `family-lineage.js`, `document-deletion-guard.js` (blocage de suppression par liens).
- **Tests** : `person-detail-page`, `person-dialog-actions`, `person-modal-layout`, `person-print`, `person-updatedby`, `person-name-variants`, `person-mobile-sheet`, `person-empty-tree-button`, `person-tree-assignment-ui`, `person-tree-transfer-ui`, `identity-ui`, `family-links-lot3`, `family-links-ui`, `family-modals-lot2`, `family-dissociation-ui`, `family-parent-addition`(+`-ui`), `family-lineage`, `multiple-tree-transfer-ui`, `transfer-diagnostic`, `bounded-dates`.
- **Précautions** : `family-relations.js` est **gelé** (comparaison octet, §C) ; champs legacy `birthDate`/`deathDate`/`partnerIds` obligatoires (compatibilité données anciennes) ; affectation `treeId` régie par les règles Firestore.

### 2. Annuaire
- **Entrée** : `index.html` (`directoryView`, `directoryFilterDialog`) ; filtres lus par `js/app.js`.
- **Modules** : `directory-advanced.js` (**implémentation runtime** : clés `firstName`, `birthPlace`, `birthYearFrom/To`, `treeId`…), `directory-utils.js` (**gelé** ; contient aussi l'implémentation legacy `filterAndSortDirectory`), `tree-model.js` (appartenance), `person-name-variants.js`.
- **Tests** : `directory-filters` (runtime), `directory-cards-layout`, `directory-filter-overlap`, `directory-results-meta`, `directory-view-preference`, `search-clear-click`, `qa-70-cases` et `genealogy-model` (**legacy** : clés `name`/`place`/`birthYear`, non envoyées par le runtime — voir rapport 6A T-01).
- **Précautions** : ne pas modifier `directory-utils.js` (gel §C) ; deux implémentations coexistent — toujours tester l'import runtime (`directory-advanced`) **[V]**.

### 3. Arbre généalogique (canvas)
- **Entrée** : `index.html` (`appMain`, zone canvas) ; état et interactions dans `js/app.js`.
- **Modules** : `tree-model.js` (modèle, lifecycle de suppression), `tree-layout.js` + `tree-layout-engine.js` (**deux stratégies**, toutes les deux appelées par `app.js`), `tree-renderer.js`, `tree-camera.js`, `tree-branch-view.js`, `tree-export.js`, `tree-export-cards.js`, `tree-quality.js`.
- **Tests** : `tree-branch-filter`, `tree-branch-view`, `tree-card-alignment`, `tree-directory-responsive`, `tree-export`, `tree-export-fidelity`, `tree-export-guard`, `tree-fullscreen`, `tree-landscape-scroll`, `tree-layout-engine`, `tree-menu-layout`, `tree-model`, `tree-quality`, `tree-quality-ui`, `tree-selector`, `tree-sync-status`, `admin-treequality-sheets-lot3c`.
- **Précautions** : `tree-camera.js` et `tree-layout.js` **gelés** ; décalages manuels persistés en localStorage (axe horizontal uniquement) ; suppression d'arbre = verrouillage puis effacement (règles + tests dédiés).

### 4. Parcours détaillé et frise
- **Entrée** : panneau personne (`personPageTimeline`) dans `js/app.js`.
- **Modules** : `life-timeline.js` (frise), `life-journey.js` (événement, résidence, profession, attestations), `place-format.js`, `genealogy-date.js`.
- **Tests** : `life-journey`, `life-timeline`, `person-detail-page` (icônes du parcours `#icon-home/#icon-procedures/#icon-calendar`).
- **Précautions** : `genealogy-date.js` a un **contrat additif** (7 types de dates vs 5 dans la fixture) ; `#icon-procedures` est une icône partagée — ne pas confondre avec l'ancien module Démarches.

### 5. Documents et preuves
- **Entrée** : `index.html` (`documentsView`, `documentDialog`, zone visionneuse) ; `genealogyView` pour les preuves.
- **Modules** : `document-types.js`, `document-utils.js`, `document-delete.js`, `document-deletion-guard.js`, `genealogy-proofs.js`, `genealogy-proof-form.js`, `genealogy-identities.js`, `fact-conclusions.js`, `photograph-storage.js` / `photograph-preview.js` (**fondation non branchée** en runtime — rapport 6A J-01/J-02).
- **Tests** : `document-types`, `document-deletion-guard`, `document-people-picker`, `document-menu-edit-mobile`, `document-detail-page`, `photograph-storage`, `genealogy-proofs`, `genealogy-proof-form`, `genealogy-identities`, `fact-conclusions`, `proof-detail-page`, `proof-association-removal`, `proof-guided-creation` (nécessite l'émulateur, se saute sinon).
- **Précautions** : suppression de document conditionnée par `documentDeletionBlockers` (liens personnes/sources/preuves) ; fichiers en chunks Firestore (700 Ko) ; modèles de preuve immuables avec révisions.

### 6. Sources officielles
- **Entrée** : `index.html` (`genealogyView`, workspace Archives) ; contributions dans `js/app.js`.
- **Modules** : `source-document-model.js`, `genealogy-collaboration.js` (modèle), `genealogy-collaboration-firestore.js` (persistance), `genealogy-workspace-utils.js`, `document-transcription.js` (textes officiels).
- **Tests** : `source-document-model`, `source-detail-page`, `genealogy-collaboration`, `genealogy-workspace-ui`, `genealogy-workspace-utils` ; sections dédiées de `firestore-emulator` (règles des 11 collections Sources & preuves).
- **Précautions** : collections immuables (`*Revisions`) + têtes officielles ; règles `isAdmin` pour l'écriture officielle ; jamais de données réelles dans les tests.

### 7. Visionneuses PDF et image
- **Entrée** : ouverture depuis `js/app.js` (`createDocumentImageViewer`, `createDocumentPdfViewer`).
- **Modules** : `document-image-viewer.js` (zoom/pan/plein écran, pur DOM), `document-pdf-viewer.js` (import dynamique `vendor/pdfjs/pdf.mjs` + worker).
- **Dépendances** : `vendor/pdfjs/` (commité, régénéré par les builds depuis `pdfjs-dist`).
- **Tests** : `document-viewer-mobile`, `pdf-viewer-validation`, `document-viewer-pdf-production` (Playwright Chromium + WebKit, serveur local), `document-detail-page`.
- **Précautions** : zones PDF redessinées (lot récent) ; ne pas régénérer `vendor/pdfjs` sans passer par le build ; les assets images passent par `resourceRef` + chunks.

### 8. Transcription et traduction
- **Entrée** : `index.html` (`transcriptionWorkshopView`) ; pilotage dans `js/app.js`.
- **Modules** : `transcription-workshop.js` (atelier), `document-transcription.js` (modèle/passage), `transcription-draft-sync.js` (synchronisation), `transcription-draft-storage.js` (localStorage — **local, pas une sauvegarde**).
- **Firestore** : `transcriptionHeads`, `transcriptionRevisions` (immuables), `transcriptionDrafts/{uid}/documents/{doc}/pages/{page}` (espace privé par propriétaire).
- **Tests** : `transcription-workshop`, `transcription-validation`, `transcription-draft-storage`, `transcription-draft-sync`, `transcription-draft-remote`, `transcription-zone-b1`, `transcription-zone-b2-pdf`, `document-transcription`.
- **Précautions** : contrôle « italien non vide » sur les revisions officielles ; immuabilité des révisions ; brouillons locaux ≠ synchronisés.

### 9. Authentification et autorisations
- **Entrée** : `index.html` (`authScreen`, écrans attente/admin) ; flux dans `js/app.js`.
- **Modules** : `firebase-environment.js` (**résolution stricte hostname → projet**, aucun accès DOM à l'import).
- **Firestore** : `firestore.rules` — `signedIn/isApproved/isAdmin`, `validUpdatedBy`, bootstrap `settings/access`, catch-all deny ; `users` avec rôles.
- **Tests** : `npm run test:firestore` (`tests/firestore-emulator.mjs`,78 tests), `emulator-guard`, `firebase-environment`, `production-environment`, `blocked-services`.
- **Précautions** : **`.firebaserc` default = production → `--project` toujours explicite** ; garde anti-production des tests (hôte local + ID fictif `family-tree-emulator-test`) ; jamais de credentials ni de données réelles dans les tests.

### 10. Firebase et stockage (persistance)
- **Entrée** : objet `refs` et abonnements dans `js/app.js`.
- **Modules** : `backup-utils.js` (validation, chunks 700 Ko / 20 Mo, constantes), `backup-archive.js` (archive ZIP v5, SHA-256, vérification).
- **Contraintes** : Spark uniquement — **pas de Storage, pas de Cloud Functions** ; fichiers = chunks Firestore.
- **Tests** : `backup-archive`, `backup-restore`, sections persistance de `firestore-emulator`.
- **Précautions** : archives privées conservées **hors dépôt** (voir `TECH_DEBT_*_5B*`) ; jamais d'écriture sur les projets réels dans les tests.

### 11. Import/export et compatibilité
- **Entrée** : panneau Données dans `js/app.js` (`exportCompleteBackup`, restauration v4/v5).
- **Modules** : `backup-utils.js` (`importedDataFields`, `parseBackupManifestText`, champs legacy), `backup-archive.js` (`adaptLegacyV4Archive`, `prepareBackupRestorePlan`, `verifyBackupArchive`).
- **Tests** : `backup-archive`, `backup-restore`.
- **Précautions** : compatibilité stricte des champs historiques (`birthDate` string, `partnerIds`, textes nus) — ne jamais « nettoyer » ces champs (AGENTS.md) ; restauration = merge contrôlé, jamais vers un projet réel sans autorisation ; mots de passe/droits hors archive.

### 12. Interfaces mobile et desktop
- **Entrée** : `index.html` (markup sémantique + `hidden`), media queries dans `design-system.css`.
- **Modules** : `navigation-state.js` (URL, repli des vues retirées dont `?view=dossiers`), `navigation-context.js`, `ui-components.js` (icônes/emptyState/attente), `form-ui.js` (2ᵉ point d'entrée, validation), `location-autocomplete.js` (GeoNames optionnel).
- **Tests** : `navigation-state`, `navigation-detail-restore`, `navigation-context`, `modals-forms-ui`, `mobile-modal-sheets-lot1|lot2|lot3a`, `ios-webapp-header`, `mobile-fullscreen-header`, `interaction-language`, `responsive-accessibility`, `design-system-foundation`, `page-headings`, `tile-interactions`, `tile-context-menu-responsive`, `tasks-ui`, `tasks-tile-visual`, `evolution-final-qa`, `interaction-responsive-smoke` (env var, skip silencieux).
- **Précautions** : classes générées dynamiquement dans les templates JS — vérifier les motifs `${…}` avant de conclure à un sélecteur CSS orphelin ; cibles tactiles ≥ 44 px (tests dédiés) ; `#icon-procedures` partagé.

## C. Contrats historiques et fichiers protégés

**Ne pas modifier sans décision explicite (AGENTS.md) :**

| Contrat | Mécanisme | Fichiers concernés |
|---|---|---|
| Comparaison octet (fins de ligne normalisées) vs fixture v18 | `tests/final-qa.test.mjs:21-24` | `js/tree-camera.js`, `js/tree-layout.js`, `js/family-relations.js`, `js/directory-utils.js`, `js/document-utils.js` |
| Contrat additif des dates (7 types vs 5 historiques) | `tests/final-qa.test.mjs:27-30` | `js/genealogy-date.js` (et fixture v18) |
| Fixtures historiques intouchables | `AGENTS.md` | `tests/fixtures/v16|v17|v18/` (snapshots de `firestore.rules` et modules) |
| Invariants de sécurité Firestore | `assertFirestoreRulesSafety` (appelé par final-qa, interaction-language, responsive-accessibility) | `firestore.rules`, `tests/firestore-rules-invariants.mjs` |
| Invariants Démarches (refus) | `firestore-rules-invariants`, section dédiée de `firestore-emulator` | règles locales (5C.1) |
| Compatibilité des anciennes URLs | `navigation-state` + tests `?view=dossiers` | repli vers l'accueil |
| Icône partagée `#icon-procedures` | tests d'icônes | `index.html`, `ui-components.js` (catégorie « Professions » du parcours) |

*Précision [V]* : seuls `final-qa.test.mjs` compare les modules cœur aux fixtures ; `interaction-language` et `responsive-accessibility` vérifient les **invariants** de règles (leur commentaire de fixture est ancien).

**Éléments conservés sur décision documentée (rapports 6A/6B.1)** : `directoryEventYear` (gel du module `directory-utils`), les 21 exports « superflus » dont `family-relations`/`genealogy-date` sont sous contrat, `photograph-storage`/`photograph-preview` (fondation non branchée), `vendor/pdfjs` (référencé par des tests).

## D. Hypothèses à confirmer [H]

- Les cas legacy de `qa-70-cases`/`genealogy-model` n'exercent pas le chemin de filtre runtime (T-01 du rapport 6A) — migration prévue en 6B.4.
- `vendor/pdfjs` pourrait être régénéré uniquement au build (A-04 du rapport 6A) — non tranché.
- Les classes CSS signalées en 6A (groupes A–F) doivent être validées à l'écran avant suppression (6B.2).
