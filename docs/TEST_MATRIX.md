# Matrice des tests ciblés — La Nostra Storia

> Objectif : choisir le bon test sans redécouvrir la structure du dépôt à chaque intervention.
> Complète `docs/TECHNICAL_MAP.md` (domaine → fichiers) et `AGENTS.md` (règles).
> **110 fichiers** `tests/*.test.mjs` au total : **58 sans Playwright** (famille `unit`), **52 avec Playwright** (famille `browser`).

## 1. Commandes

| Commande | Portée | Préparation | Mesure |
|---|---|---|---|
| `npm run test:unit` | Tous les tests **sans Playwright** (57 fichiers) | Aucune | **594 tests / ≈3 s** (mesuré) |
| `npm run test:unit -- --filter <texte>` | Sous-groupe unitaire : noms de fichiers contenant `<texte>` (ex. `person`, `tree`, `directory`) | Aucune | instantané |
| `npm run test:browser` | Tous les tests **avec Playwright** (52 fichiers), **1 fichier à la fois** | Navigateurs Playwright installés | **408 tests / ≈18 min** (mesuré) |
| `npm run test:browser -- --filter <texte>` | Sous-groupe navigateur (ex. `person` → 7 fichiers) | Navigateurs | idem |
| `npm run test:browser -- --concurrency <n>` | Jeu navigateur exécuté en parallèle (`n >= 1`) — **plus rapide mais instable** | Navigateurs | voir §3 |
| `npm run test:firestore` | Règles + intégration Firestore (**78 tests**) | Émulateurs locaux auto-lancés (JAVA requis) ; projet fictif `family-tree-emulator-test` | **≈25–40 s** (mesuré) |
| `npm run test:responsive` | Suite responsive historique (viewports réels) | Navigateurs | — |
| `node --test tests/<fichier>.test.mjs` | Un fichier précis | Selon le fichier | <1 s (unitaire) |
| `node --test tests/` | Campagne complète (109 fichiers) | Navigateurs + émulateur selon les fichiers | lourde — réservée aux changements transversaux |
| `npm run check:assets` | Cohérence du jeton de cache (`asset-release` + `?v=`) | Aucune | instantané |
| `npm run bump:assets -- <jeton>` | Bump déterministe du jeton dans `index.html` (62 occurrences) | Aucune | instantané |
| `npm run build:recette` / `npm run build:production` | Artefacts locaux **non déployés** (`dist-*`, gitignorés) | `node_modules` | quelques secondes (258 / 274 fichiers) |

Règles d'usage : le code de sortie est propagé (aucun échec masqué) ; les familles ne contactent jamais Firebase distant ; privilégier `test:unit` + le `--filter` de la zone avant toute campagne plus large. **Lancer `test:browser` sans `--concurrency`** : la concurrence 1 est la valeur validée pour une campagne complète stable (voir §3).

## 2. Matrice zone → fichiers → commandes

| Zone | Fichiers source principaux (voir carte) | Tests | Commandes recommandées |
|---|---|---|---|
| Personnes | `app.js` (modale), `person-print-sheet.js`, `person-*`, `family-*` | `person-*`, `family-*`, `identity-ui`, `multiple-tree-transfer-ui`, `transfer-diagnostic`, `bounded-dates` | `npm run test:unit -- --filter person` + `--filter family` + `--filter identity` puis `npm run test:browser -- --filter person` |
| Annuaire | `directory-advanced.js`, `directory-utils.js` (gelé) | `directory-filters` (runtime), `qa-70-cases`, `genealogy-model` (legacy), `directory-*`, `search-clear-click`, `compact-place-format` | `npm run test:unit -- --filter directory` ; puis `npm run test:browser -- --filter directory` ; legacy : `node --test tests/qa-70-cases.test.mjs tests/genealogy-model.test.mjs` |
| Arbre | `tree-*` (2 layouts), `tree-model` | `tree-*` (9 unitaires), `admin-treequality-sheets-lot3c` | `npm run test:unit -- --filter tree` + `npm run test:browser -- --filter tree` |
| Parcours / frise | `life-journey.js`, `life-timeline.js` | `life-journey`, `life-timeline`, `person-detail-page` (icônes) | `npm run test:unit -- --filter life` + `npm run test:browser -- --filter life` |
| Documents & preuves | `document-*` (dont `document-file-storage.js`), `genealogy-proof*`, `fact-conclusions` | `document-*` (dont `document-file-storage` ; hors viewers), `genealogy-proof*`, `fact-conclusions`, `proof-*` | `npm run test:unit -- --filter document` + `--filter proof` ; `npm run test:browser -- --filter document` |
| Sources officielles | `source-document-model.js`, `genealogy-collaboration*`, `genealogy-workspace*` | `source-*`, `genealogy-collaboration`, `genealogy-workspace*` | `npm run test:unit -- --filter source` + `--filter collaboration` + `--filter workspace` ; `npm run test:browser -- --filter source` |
| Visionneuses PDF/image | `document-pdf-viewer.js`, `document-image-viewer.js`, `vendor/pdfjs/` | `pdf-viewer-validation`, `document-viewer-mobile`, `document-viewer-pdf-production`, `document-detail-page` | `npm run test:browser -- --filter viewer` + `--filter pdf` |
| Transcription | `transcription-*`, `document-transcription.js` | `transcription-*` (8), `document-transcription` | `npm run test:unit -- --filter transcription` + `npm run test:browser -- --filter transcription` |
| Auth & autorisations | `firebase-environment.js`, `firestore.rules` | `firestore-emulator` (78), `emulator-guard`, `firebase-environment`, `production-environment`, `blocked-services` | **`npm run test:firestore`** (obligatoire si règles changent) ; `npm run test:unit -- --filter emulator` + `--filter firebase` + `--filter blocked` |
| Firebase / persistance | `backup-utils.js`, `backup-archive.js` | `backup-archive`, `backup-restore` | `npm run test:unit -- --filter backup` |
| Import/export & compat | `backup-*` (champs legacy), restauration v4/v5 | `backup-archive`, `backup-restore` | mêmes commandes ; restaurations réelles = interdites hors autorisation (voir rapports 5B) |
| Interfaces mobile/desktop & navigation | `index.html`, `design-system.css` + `print-sheet.css` (ordre des `<link>`), `navigation-*`, `form-ui.js`, `ui-components.js` | `navigation-*`, `modals-forms-ui`, `mobile-*`, `ios-*`, `interaction-*`, `responsive-*`, `design-system-foundation`, `page-headings`, `tile-*`, `tasks-*`, `identity-ui`, `evolution-final-qa` | `npm run test:unit -- --filter navigation` + `--filter modal` + `--filter tile` ; `npm run test:browser -- --filter mobile` + `--filter responsive` + `--filter interaction` ; `npm run test:responsive` (viewports réels) |
| Cache, version & build | `index.html` (meta), `scripts/bump-asset-release.mjs`, `scripts/build-*.mjs` | `hosting-cache`, `asset-release`, `design-system-foundation`, `build-recette-environment`, `production-environment` | `node --test tests/hosting-cache.test.mjs tests/asset-release.test.mjs` ; `npm run check:assets` ; `npm run build:recette` |
| Règles Firestore (invariants) | `firestore.rules`, `tests/firestore-rules-invariants.mjs` | `final-qa`, `interaction-language`, `responsive-accessibility` + sections de `firestore-emulator` | `npm run test:firestore` + `npm run test:unit -- --filter final` + `--filter interaction` + `--filter responsive` |

## 3. Préparations et pièges par famille

| Fichier / famille | Particularité |
|---|---|
| `firestore-emulator.mjs` | **Jamais lancé directement** : uniquement via `npm run test:firestore` (garde anti-production). Nom sans `.test` pour échapper à la découverte automatique. |
| `proof-guided-creation.test.mjs` | Nécessite l'émulateur ; se saute proprement sinon (reste dans `unit`). |
| `interaction-responsive-smoke.test.mjs` | Nécessite une variable d'environnement ; skip silencieux sinon. |
| `document-viewer-pdf-production.test.mjs` | Playwright **Chromium + WebKit** et serveur local requis. |
| `emulator-guard.test.mjs` | Pur : valide les gardes avec des environnements factices, aucun émulateur. |
| `helpers.mjs` | Non un test : serveur statique + garde réseau partagés par les tests navigateur. |
| `scripts/run-tests.mjs` | Sélecteur de familles + option `--concurrency`. **La famille `browser` tourne avec `--test-concurrency=1` par défaut** : en concurrence native (7 fichiers simultanés sur 8 cœurs), 3 campagnes complètes sur 3 ont échoué (2 à 5 échecs, toujours des tests différents, tous verts isolément). À 1 worker, la même campagne est verte : 408 tests / 0 échec / ≈18 min. La cause est la charge, pas le code — aucun test désactivé, aucun délai relevé. |
| Fixtures `tests/fixtures/v16-v18` | **Jamais exécutées, jamais modifiées** (snapshots historiques, §C de la carte). |
| Tests qui lisent des fichiers vivants | `final-qa`, `interaction-language`, `responsive-accessibility` : relisent `index.html`, `design-system.css`, `app.js`, `firestore.rules` — un changement de ces fichiers les concerne. |

## 4. Sélection recommandée par type de changement

| Changement | Minimum | Renfort |
|---|---|---|
| Module pur (`genealogy-*`, `tree-model`, `backup-*`…) | `node --check` + test homonyme (filtre) | `npm run test:unit` |
| `js/app.js` / `index.html` / `css/` | `npm run test:unit` | tests de la zone (filtres ci-dessus) + `final-qa` |
| `firestore.rules` / autorisations | **`npm run test:firestore` (obligatoire)** | `npm run test:unit -- --filter final` |
| Visionneuses / atelier | tests de la zone (famille browser) | `npm run test:unit` |
| Livraison publiable | `npm run test:unit` + `check:assets` + build | tests de la zone modifiée ; `test:browser` si UI touchée |

Ne jamais masquer un échec ni assouplir un test pour faire passer un changement ; en cas de doute, conserver et documenter (AGENTS.md §Arrêt).
