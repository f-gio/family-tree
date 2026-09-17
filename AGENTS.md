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
- Root `*.md` = per-feature design/QA docs (DESIGN_SYSTEM, INTERACTIONS, MODALS_FORMS, RESPONSIVE_ACCESSIBILITY, GEONAMES, `*_QA_REPORT.md`). Big features are expected to ship a report + tests; follow this pattern.

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
- Syntax check: `node --check <file>.js`. Tests: `node --test tests/` or a single file, e.g. `node tests/genealogy-model.test.mjs`. Mix of plain assert scripts (print "OK") and `node:test` files.
- Tests import the pure modules directly, so `tree-*`, `family-relations`, `genealogy-date`, `directory-utils`, `document-utils`, `ui-components`, `place-format`, `location-autocomplete` must not touch `document`/`window` at import time.
- Tests regex-match exact markup/CSS/french strings (`id="..."`, button labels, tokens, file contents). Renaming an id, rewording UI text, or dropping a token breaks tests — update tests with the change.
- Pinning gotcha: `final-qa.test.mjs`, `interaction-language.test.mjs`, `responsive-accessibility.test.mjs` read sibling folders `../family-tree-v18-responsive-accessibility/`, `../family-tree-v16-modals-forms/`, `../family-tree-v17-interaction-language/` and fail (ENOENT) if those previous checkouts aren't present next to this repo. They also assert `firestore.rules` and core JS files must not drift from that pinned version — treat those files as frozen if the tests are expected to pass.
- `interaction-responsive-smoke.test.mjs` needs Playwright Chromium (env `CODEX_PRIMARY_RUNTIME_NODE_MODULES` or a local `playwright` package); it silently passes/skips when unavailable.
- Search is accent-insensitive everywhere; `filterAndSortDirectory` and date formatting are covered by tests, keep them behind the same pure-utility surface.