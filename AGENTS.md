# AGENTS.md

Vanilla-JS, single-page genealogy app. No framework, no bundler; scripts are plain Node. The app is served as static files by Firebase Hosting (recette/production) — GitHub Pages only serves a redirect stub. All UI text, docs, and tests are in **French**.

Références rapides : `docs/TECHNICAL_MAP.md` (domaine → fichiers → contrats historiques), `docs/TEST_MATRIX.md` (fichier → commande de test), `DEMARCHES_RULES.md` (publication des règles Firestore). Les détails vivent là-bas — ne pas les dupliquer ici.

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
- `index.html` — page unique : import map versionné (meta `asset-release`), sprite SVG, markup de toutes les vues, court bloc `<style>` ; charge `js/form-ui.js` (2ᵉ entrée : validation globale des formulaires) puis `js/app.js` (orchestrateur, ~17 600 lignes).
- `js/` : 51 modules ES, purs (aucun accès DOM/Firebase à l'import) — localisation dans `docs/TECHNICAL_MAP.md`.
- `css/design-system.css` : feuille unique, tokens `--color-* / --space-* / --radius-*` (aliases historiques `--ink`, `--brand`, `--accent`…).
- `firestore.rules` : **référence unique des règles**, publiée manuellement (Firebase Console ou API Firebaserules — procédure dans `DEMARCHES_RULES.md`, jamais `firebase deploy`). Les SHA-256 des releases actives y sont consignés.
- `tests/fixtures/v16|v17|v18` : snapshots historiques (règles + modules cœur) — **jamais modifiables automatiquement**.

## Backend constraints (Spark free tier)
- Firestore only: **no Cloud Functions, no Firebase Storage**. Firebase JS SDK v12 comes from ES imports of `https://www.gstatic.com/firebasejs/12.2.1/...`; JSZip is dynamically imported from jsDelivr only during backup/restore.
- Collections : `people`, `families`, `documents`, `tasks`, `users`, `trees`, `settings/access`, `documentChunks`, plus les familles genealogy/source/transcription. File content is stored as Firestore `Bytes` chunks (20 MB cap, 700 KB chunks), not in Storage.
- Configuration Firebase résolue par origine dans `js/firebase-environment.js` (jamais d'accès direct au projet depuis `app.js`) ; GeoNames username + endpoint Cloudflare en `<meta>` dans `index.html` (username n'est pas un secret), service optionnel.

## Data-model legacy compatibility
- Old props must keep working: string `birthDate`/`deathDate`, `partnerIds`/`childIds`, `marriedName`, text-only `place` values. New structured dates go in `birthDateInfo`/`deathDateInfo`/`unionDateInfo`/`endDateInfo` with shape `{type: exact|year|about|before|after|between|unknown, ...}`; never fabricate a Jan 1 from a bare year.
- `lastName` = birth name (what tree cards show); `marriedName` is the "nom d'usage" legacy field.
- Tree: vertical axis is automatic by generation; manual moves only affect horizontal, persisted in localStorage.

## Style conventions
- One style layer is CSS tokens in `css/design-system.css`; historical aliases map to them. New CSS should use tokens.
- Every `<button>` needs an explicit `type` and mobile touch targets ≥ 44 px — enforced by tests.
- All UI strings (labels, empty states, toasts, confirmations), tests, and docs are in French.

## Environnements et interdictions Firebase
- Projets : **recette** `la-nostra-storia-recette` · **production** `family-tree-c2fe2` · **local** `family-tree-emulator-test`.
- **`.firebaserc` pointe la production par défaut** : jamais de commande Firebase sans `--project` explicite ; jamais le projet implicite comme preuve de ciblage.
- Interdits : déploiement production sans instruction distincte ; `firebase deploy` global (toujours `--only <service>`) ; écriture/lecture de données réelles depuis un test ; modification d'index, Functions ou IAM hors lot dédié.
- Publication recette Hosting : `firebase deploy --only hosting --project la-nostra-storia-recette`, uniquement si des fichiers livrés ont changé, contrôles verts et artefact à jour. Les règles Firestore ne se publient que par Console/API, avec autorisation dédiée (`DEMARCHES_RULES.md`).

## Git et livraison
- Branche de travail : **`recette`** ; `main` = production (aucun dev dessus ; merge sur accord explicite, fast-forward privilégié, cherry-pick ciblé si besoin ; après publication, réconciliation documentée puis retour sur `recette`).
- Avant chaque chantier : vérifier HEAD, `merge-base` et les différences pertinentes `main ↔ recette`.
- Interdits absolus : `git add .` / `git add -A`, `reset --hard`, `clean`, `stash`, push `--force`, rebase destructif, suppression automatique de branches, résolution automatique de conflits.
- **Aucun push ni déploiement sans autorisation explicite** ; pour une vérification purement Git, ne lancer ni build ni campagne de tests inutiles.
- Avant commit : `git diff` limité au périmètre, `git diff --check`, indexation **explicite** des seuls fichiers du lot, message `feat|fix|docs|refactor|chore|security: …` court et descriptif.
- Pousser sur `origin/recette` après contrôles verts. Ne pas déployer si seules des documents ou commandes de développement ont changé (l'artefact Hosting exclut `**/*.md`, `tests/`, `scripts/`, `package.json`, `firestore.rules`).
- Préserver tout travail local étrangère au lot ; en cas de conflit ou modification locale inattendue : s'arrêter et demander.

## Recherche ciblée
- Partir de `docs/TECHNICAL_MAP.md` : domaine → modules → tests, plutôt que de balayer le dépôt ou de relire `app.js` en entier.
- Exclure des scans : `node_modules/`, `dist-*`, `.git/`, `docs/archive/`, `tests/fixtures/` (figés).
- Une absence de référence textuelle **ne prouve pas** l'inutilisation : vérifier les constructions dynamiques (templates `${…}`, classes concaténées, `data-*`), `window`/`globalThis`, les imports dynamiques `import(…)`, les callbacks enregistrés par nom, avant de conclure.
- Dans tout rapport : distinguer fait vérifié / hypothèse ; citer `fichier:ligne` ; ne jamais présenter une suspicion comme du code mort confirmé.

## Modification minimale
- Toucher uniquement le périmètre du lot : pas de refactoring opportuniste, pas de renommage, pas de réorganisation « en passant ».
- Préserver : les contrats historiques (fichiers gelés listés dans `docs/TECHNICAL_MAP.md` §C — comparaison octet vs fixtures, contrat additif des dates), les fixtures v16-v18, l'icône partagée `#icon-procedures`, les champs legacy des données, les signatures publiques utilisées.
- Tout changement de `firestore.rules` exige `npm run test:firestore` et une publication séparée autorisée.

## Tests (sélection)
- Commandes, familles et matrice zone → tests : **`docs/TEST_MATRIX.md`**. Résumé :
  - `npm run test:unit [-- --filter <texte>]` — rapide, sans navigateur ni émulateur (57 fichiers, ≈3 s) ;
  - `npm run test:firestore` — **obligatoire** dès que `firestore.rules` ou la logique d'autorisation change (émulateur local uniquement,78 tests) ;
  - `npm run test:browser [-- --filter <texte>]` — navigateurs requis ;
  - `node --test tests/<fichier>.test.mjs` — un fichier ; `node --test tests/` — campagne complète (lourde, changements transversaux seulement).
- Trois niveaux de vérification proportionnés au risque :
  - **Niveau 1 — développement courant** : `node --check <fichier>.js` + le test homonyme du module touché (filtre de la matrice) ;
  - **Niveau 2 — avant publication recette** : niveau 1 + tests d'intégration de la zone + `final-qa` (+ tests responsive/visionneuses si ces zones sont touchées) ;
  - **Niveau 3 — avant publication production** : niveau 2 + `npm run test:firestore` si règles concernées + contrôle du build réellement publié.
- Lire tous les échecs ; **jamais** désactiver ou assouplir un test pour faire passer un changement. Sous Windows, utiliser `[\r\n]` dans les regex de test (fichiers en CRLF). Les suites à options (`document-viewer-pdf-production`, `interaction-responsive-smoke`) et les fixtures sont décrites dans la matrice.

## Build et version des assets
- `npm run build:recette` → `dist-recette/` ; `npm run build:production` → `dist-production/` (gitignorés ; le build exclut règles, tests, Markdown et manifestes npm ; reproductible).
- Jeton de cache : source unique = `<meta name="asset-release">` dans `index.html` ; **toutes** les références `?v=` doivent porter la même valeur (contrat `tests/hosting-cache.test.mjs`).
- **Ne jamais éditer les ~62 occurrences à la main** : `npm run check:assets` vérifie la cohérence ; `npm run bump:assets -- <jeton>` applique le bump de façon déterministe. Format du jeton : `<séquence>-<slug>-<AAAAMMJJ>-<révision>` (ex. `24-unused-definitions-20261121-1`) — jamais d'horodatage ni de valeur aléatoire générés automatiquement.
- Après un bump : `npm run test:unit` + `npm run check:assets`, puis build ; vérifier le jeton dans `dist-*/index.html` avant toute publication.

## Arrêt obligatoire (ne pas publier, documenter)
Suspendre l'intervention et expliquer le blocage si : échec de test ou artefact incohérent · diff dépassant le périmètre du lot · projet cible ambigu · `firestore.rules` modifié sans `test:firestore` · modification locale étrangère détectée · doute sur un contrat historique ou sur l'état réel d'un environnement distant. Conserver les journaux ; ne jamais corriger en élargissant le périmètre.
