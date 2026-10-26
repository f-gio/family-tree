# AGENTS.md

Vanilla-JS, single-page genealogy app. No framework, no build system, no `package.json`. Deployed as static files to GitHub Pages; backend is Firestore rules published separately via Firebase Console. All UI text, docs, and tests are in **French**.

## Production Data Safety
The Firestore database holds **real production genealogical data** (people, relationships, dates, places, notes, documents). It is NEVER test data. Treat it as read-only unless the user explicitly asks for a specific write.
- Never delete, reset, clear or overwrite Firestore collections or production data.
- Never run bulk updates, migrations, cleanup scripts or destructive database operations without explicit user approval.
- Never rename or remove existing Firestore fields automatically.
- Never modify production records as part of testing; tests must NOT write to the production Firestore database.
- Never use the production database to generate test data.
- Never delete or replace existing documents or document references.
- Preserve backward compatibility with all existing records; prefer additive, backward-compatible changes to the data model.
- Any proposed data migration must be explained first and must not run without explicit approval.
- Code changes must not trigger automatic destructive migrations at app startup.
- `firestore.rules` changes are sensitive: explicitly identify them before modifying the file.

## Layout & entrypoints
- `index.html` — the only page. Contains the app's layout CSS inline in `<style>`; also links `css/design-system.css`. Loads `<script type="module" src="./js/form-ui.js">` then `js/app.js` at the bottom.
- `js/app.js` (~2200 lines) — entrypoint: Firebase init, auth, tree/directory/documents/tasks views, person modal, backup/restore, admin.
- Other `js/*.js` are ES modules imported by `app.js`: `tree-layout|tree-renderer|tree-camera` (canvas tree), `family-relations`, `genealogy-date`, `directory-utils`, `document-utils`, `ui-components`, `form-ui`, `location-autocomplete`, `place-format`.
- `firestore.rules` — copied/published via Firebase Console (Firestore → Rules), not served by the app.
- Root `*.md` = per-feature design/QA docs (`DESIGN_SYSTEM.md`, INTERACTIONS, MODALS_FORMS, RESPONSIVE_ACCESSIBILITY, GEONAMES, `*_QA_REPORT.md`). Big features are expected to ship a report + tests; follow this pattern. Historical session handovers live in `docs/archive/`.

## Backend constraints (Spark free tier)
- Firestore only: **no Cloud Functions, no Firebase Storage**. Firebase JS SDK v12 comes from ES imports of `https://www.gstatic.com/firebasejs/12.2.1/...`; JSZip is dynamically imported from jsDelivr only during backup/restore.
- Collections: `people`, `families`, `documents`, `tasks`, `users`, plus bootstrap doc `settings/access`. File content is stored as Firestore `Bytes` chunks (20 MB cap, 700 KB chunks), not in Storage.
- Firebase config is hard-coded in `js/app.js`; GeoNames username + Cloudflare Worker endpoint are `<meta>` tags in `index.html` (username is not a secret). GeoNames suggestions are optional; free-text place entry must always work without it.

## Data-model legacy compatibility
- Old props must keep working: string `birthDate`/`deathDate`, `partnerIds`/`childIds`, `marriedName`, text-only `place` values. New structured dates go in `birthDateInfo`/`deathDateInfo`/`unionDateInfo`/`endDateInfo` with shape `{type: exact|year|about|between|unknown, ...}`; never fabricate a Jan 1 from a bare year.
- `lastName` = birth name (what tree cards show); `marriedName` is the "nom d'usage" legacy field.
- Tree: vertical axis is automatic by generation; manual moves only affect horizontal, persisted in localStorage.

## Style conventions
- One style layer is CSS tokens in `css/design-system.css` (`--color-*`, `--space-*`, `--radius-*`, `--control-touch`, ...); historical aliases (`--ink`, `--brand`, `--accent`, ...) map to them. New CSS should use tokens.
- Every `<button>` needs an explicit `type` and mobile touch targets ≥ 44 px — enforced by tests.
- All UI strings (labels, empty states, toasts, confirmations), tests, and docs are French.

## Tests (Node only; no npm/lint tooling)
- Syntax check: `node --check <file>.js`. Tests: `node --test tests/` or a single file, e.g. `node --test tests/genealogy-model.test.mjs`. Mix of plain assert scripts (print "OK") and `node:test` files.
- Tests import the pure modules directly, so `tree-*`, `family-relations`, `genealogy-date`, `directory-utils`, `document-utils`, `ui-components`, `place-format`, `location-autocomplete` must not touch `document`/`window` at import time.
- Tests regex-match exact markup/CSS/french strings (`id="..."`, button labels, tokens, file contents). Renaming an id, rewording UI text, or dropping a token breaks tests — update tests with the change.
- Non-regression fixtures: `tests/fixtures/v16/`, `tests/fixtures/v17/`, `tests/fixtures/v18/` hold **historical snapshots** (`firestore.rules`; v18 also pins `js/tree-camera.js`, `js/tree-layout.js`, `js/family-relations.js`, `js/genealogy-date.js`, `js/directory-utils.js`, `js/document-utils.js`). They were extracted from the Git baseline `d58f668` and are read with relative paths (no external sibling folders). `final-qa.test.mjs`, `interaction-language.test.mjs` and `responsive-accessibility.test.mjs` assert `firestore.rules` and those core JS files must not drift from the pinned version — treat those files as frozen if the tests are expected to pass. Fixtures must never be updated automatically when current code evolves; modifying a historical fixture requires an explicit justification and is **never** justified by a failing test.
- `interaction-responsive-smoke.test.mjs` needs Playwright Chromium (env `CODEX_PRIMARY_RUNTIME_NODE_MODULES` or a local `playwright` package); it silently passes/skips when unavailable.
- Search is accent-insensitive everywhere; `filterAndSortDirectory` and date formatting are covered by tests, keep them behind the same pure-utility surface.

### Trois niveaux de vérification (tests proportionnés au risque)
- **Niveau 1 — développement courant** (à chaque modification) : `node --check` sur les fichiers modifiés + les suites ciblées du module touché (tableau ci-dessous). Ajouter les tests d'interface concernés uniquement si le changement d'UI le justifie. Ne jamais lancer toute la suite systématiquement ni faire de build complet.
- **Niveau 2 — avant publication en recette** : Niveau 1 + tests d'intégration des parcours modifiés + suites responsive/visionneuses **si** ces zones sont touchées + contrôles de sécurité pertinents (`final-qa`).
- **Niveau 3 — avant publication en production** : Niveau 2 + parcours critiques et dépendances impactées + `npm run test:firestore` si les règles ou l'autorisation sont concernées + contrôle du build réellement publié. Réserver la campagne complète (`node --test tests/`) aux changements transversaux, migrations ou risques élevés.
- **Correspondance modules → suites** :
  | Modifié | Lancer |
  |---|---|
  | module pur (`genealogy-date`, `source-document-model`, `genealogy-proofs`, `backup-*`, `directory-*`, `tree-model`, …) | `node --check` + le test homonyme |
  | `js/app.js` / `index.html` / `css/` | `node --test tests/genealogy-workspace-ui.test.mjs tests/final-qa.test.mjs` + les suites des zones UI touchées |
  | visionneuses (`document-*-viewer.js`) | `node --test --test-force-exit tests/document-viewer-mobile.test.mjs tests/pdf-viewer-validation.test.mjs` |
  | `firestore.rules` / logique d'autorisation | **`npm run test:firestore` (obligatoire)** + `tests/final-qa.test.mjs` |
  | modales / responsive | les suites `*-sheets-*`, `modals-forms-ui`, `*-responsive` concernées |
  | sauvegardes | `node --test tests/backup-archive.test.mjs tests/backup-restore.test.mjs` |
- **Règles complémentaires** :
  - `npm run test:firestore` est **obligatoire** dès que `firestore.rules` ou la logique d'autorisation change : c'est la seule couverture réelle des règles (l'émulateur local, jamais les données Firestore distantes).
  - Privilégier les assertions comportementales aux regex dépendant du formatage interne ; ne pinoter que les invariants (ids publics, noms accessibles), pas l'indentation ou l'ordre décoratif.
  - Sous Windows, les working trees sont souvent **CRLF** : utiliser `\r?\n` (ou `[\r\n]`) dans les regex de test ; un échec de regex isolé peut être un artefact d'encodage, pas un bug.
  - Suites à options : `document-viewer-pdf-production.test.mjs` (serveur local, Playwright Chromium + WebKit), `interaction-responsive-smoke.test.mjs` (env var, skip silencieux), fichiers sous `tests/fixtures/` (jamais modifiables automatiquement).
  - Ne jamais supprimer un test parce qu'il semble redondant : le regrouper ou le documenter d'abord.
  - Les tests qui échouent déjà sur `recette` stable doivent être documentés comme connus avant toute publication (jamais ignorés silencieusement).

## Workflow Git recette → production
- `recette` est la branche normale de travail et de validation ; tout développement commence sur `recette`.
- `main` est la branche de production ; ne jamais y développer directement.
- Une publication en production ou un merge vers `main` nécessite l’accord explicite de François.
- Après chaque publication/merge vers `main`, revenir systématiquement sur `recette` et la synchroniser avec la version publiée avant le chantier suivant.
- Aucun force push et aucune opération Git destructive (`reset --hard`, `clean`, restauration globale ou rebase destructif).
- Le workflow de recette ne doit jamais publier vers Firebase Production ; tout déploiement de recette cible explicitement le projet Recette et Hosting uniquement.

### Développement
- Les modifications peuvent être réalisées sur des branches dédiées issues de `recette` ; ne jamais développer directement sur `main`.
- Avant chaque chantier, vérifier les HEAD, le `merge-base` et les différences fonctionnelles pertinentes entre `recette` et `main`.

### Publication en recette
- Intégrer uniquement les modifications validées ; vérifier le diff et exécuter les tests proportionnés au changement (niveaux 1-2 ci-dessus).
- Push de `recette` et déploiement Firebase Hosting **cible `la-nostra-storia-recette` uniquement**, jamais en mode « tout projet », et uniquement après autorisation explicite.
- Ne jamais modifier les données ou règles Firebase sans autorisation spécifique.

### Publication en production
- `main` est exclusivement destinée à la production ; ne publier que des modifications explicitement validées.
- Privilégier une intégration conservant un historique commun et un **fast-forward** lorsque le périmètre le permet (cas `recette` → `main` après validation globale).
- Si certaines fonctionnalités de recette ne sont pas validées, **ne pas les publier** simplement pour synchroniser les branches : utiliser un **cherry-pick ciblé** (après vérification des dépendances), comme fait pour les corrections Sources (`3032db6`, `0e3fa54`).
- Ne jamais effectuer de merge global sans en contrôler le contenu ; le déploiement GitHub Pages est automatique au push de `main` (aucun workflow CI) : toujours revérifier `git log` avant le push.

### Réconciliation après publication
Après chaque publication en production :
1. Comparer `main` et `recette` : historique (`git log --graph`) et contenu (`git diff main recette`).
2. Identifier les commits équivalents issus des cherry-picks.
3. Si nécessaire, préparer une réconciliation `main` → `recette` par **merge** (jamais rebase), sans réintroduire de modifications ni perdre de travail.
4. Vérifier que la réconciliation ne produit aucun changement fonctionnel inattendu : comparer les arbres (`git rev-parse recette^{tree}` avant/après, ou `git diff` vide).
5. Effectuer les opérations Git distantes uniquement avec l'autorisation appropriée.
6. Revenir systématiquement sur la branche locale `recette`.

Une divergence temporaire est acceptable lorsqu'une fonctionnalité reste volontairement en recette ; une divergence non maîtrisée ne l'est pas.

### Interdictions
- Aucun force-push ; aucun rebase destructif ; aucune suppression automatique de branches ou de fichiers.
- Aucune résolution automatique de conflits sans analyse préalable.
- Aucun push ni déploiement sans autorisation explicite.
- Pour les vérifications purement Git, ne pas lancer de build ni de tests applicatifs inutiles.
