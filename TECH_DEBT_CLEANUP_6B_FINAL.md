# Rapport final — Lot 6B : nettoyage technique consolidé

**Branche** : `recette` · **Base** : `18cf250` · **Date** : 2026-11-21 · **Suite de** : `TECH_DEBT_CLEANUP_6B1.md` (lot 6B.1)
**Conclusion** : Lot 6B terminé — nettoyage consolidé validé.

---

## 1. Périmètre

Achever en une seule intervention le nettoyage identifié par l'audit `TECH_DEBT_AUDIT_6A.md` (§5.4–5.5) :
CSS orphelin, ressources statiques orphelines, doublons de l'annuaire, modules photographes, autres
candidats résiduels — sans régression, sans refonte, sans toucher aux données, règles ni configuration
Firebase. Toute incertitude sur un candidat → conserver + documenter.

## 2. Candidats examinés et décisions

| Famille | Candidats | Décision |
|---|---|---|
| CSS orphelin | 32 classes/sélecteurs (groupes A–F du rapport 6A) | **Supprimés** (référence zéro vérifiée : statique `index.html`/`js`/`tests` + détection `${…}` dynamique) |
| Ressources statiques | 8 PNG `avec-texte` + `sans-texte-72` + `sans-texte-96` | **Supprimés** (0 référence HTML/CSS/JS/tests/scripts/docs/build, absents de `dist-recette`) |
| Ressources à conserver | `sans-texte-16/32/48/180` (usés), `sans-texte-192/512` (PWA), `planche-reference.png` (usage incertain), `README.txt` | **Conservés** (instruction : conserver PWA et incertains) |
| Doublons annuaire | `directory-utils.js` vs `directory-advanced.js` | **Migration des tests legacy vers l'implémentation runtime** ; le code dupliqué du module gelé est conservé (contrat octet, §5 ci-dessous) |
| Modules photographes | `photograph-storage.js`, `photograph-preview.js`, test unique, 2 entrées d'import map | **Supprimés** (fondation jamais branchée : 0 import statique/dynamique, 0 `window`/`globalThis`, aucun consommateur hors son test, jamais dans le graphe de build) |
| `vendor/pdfjs` (203 fichiers, 6,4 Mo) | A-04 | **Conservé** — usage démontré : `js/document-pdf-viewer.js:1-4` (4 constantes d'URL), 2 tests, 2 scripts de build, présent dans l'artefact |
| `directoryEventYear` + duplication `directory-utils` | J-04, J-06/J-07 | **Conservés** — module gelé par `tests/final-qa.test.mjs:21-24` (comparaison octet vs fixture v18) ; duplication = dette résiduelle documentée |
| Exports « superflus » (21) | J-08 | **Conservés** (décision 6B.1, fichiers sous contrat inchangés) |

## 3. Suppressions effectives

| Contenu | Détail | Mesure |
|---|---|---|
| `css/design-system.css` | 32 règles orphelines (ex. `.btn.is-loading`, `.life-journey-facts*`, `.document-unified-filename*`, `.print-row*`, `.print-sources*`, `.transcription-workshop-*`, `.consultation-breadcrumb-*`, `.genealogy-detail-head*`, `.person-context-actions`, … liste exacte = `git diff css/design-system.css`) | **−150 lignes, −9 463 octets** (7 954 → 7 804) |
| `La_Nostra_Storia_icons/` | 8 `la-nostra-storia-avec-texte-{16,32,48,72,96,180,192,512}.png` + `sans-texte-72.png` + `sans-texte-96.png` | **−534 995 octets (522,5 Ko)**, 18 → 7 PNG suivis |
| `js/photograph-storage.js` | module (224 lignes) | **−224 lignes** |
| `js/photograph-preview.js` | module (47 lignes) | **−47 lignes** |
| `tests/photograph-storage.test.mjs` | test exclusivement orphan (189 lignes) | **−189 lignes** |
| `index.html` | 2 entrées d'import map (`photograph-preview`, `photograph-storage`) | import map 51 → **49 entrées**, JSON validé |
| `tests/document-viewer-mobile.test.mjs` | 1 assertion statique obsolète (`.dedicated-page-heading > h2` exigée en CSS alors que la classe est absente du markup ; les assertions dynamiques du même fichier attendent `titleClamp: "none"`, contraire) | −2 lignes |

**Bilan texte : +80 / −730 lignes** (hors binaires) ; 51 → **49 modules `js/`**, 109 → **108 tests**.

## 4. Fichiers modifiés (21, tous listés ci-dessous pour l'indexation)

Supprimés (13) : 10 PNG d'icônes, `js/photograph-preview.js`, `js/photograph-storage.js`, `tests/photograph-storage.test.mjs`.
Modifiés (8) : `css/design-system.css`, `index.html`, `docs/TECHNICAL_MAP.md`, `docs/TEST_MATRIX.md`,
`tests/document-viewer-mobile.test.mjs`, `tests/genealogy-model.test.mjs`, `tests/qa-70-cases.test.mjs`
(+ ce rapport). **Aucun** autre fichier du dépôt n'est touché ; `firestore.rules`, fixtures v16-v18,
`js/directory-utils.js`, `js/app.js`, `package.json` sont intacts.

### Migration des tests legacy de l'annuaire

Le runtime n'utilise que `js/directory-advanced.js` ; les deux tests legacy appelaient
`filterAndSortDirectory` de `directory-utils.js` avec des clés que le runtime n'émet jamais.
Migration (mêmes attentes, mêmes résultats) :

- `tests/qa-70-cases.test.mjs` : import vers `directory-advanced.js` (rester `formatDirectoryDate` sur le
  module gelé) ; clés `name`→`firstName`, `place`→`birthPlace`, `birthYear`/`deathYear`→ bornes
  `birthYearFrom/To`, `deathYearFrom/To` (cas 22-25) ; `query` et tris inchangés.
- `tests/genealogy-model.test.mjs` : idem pour `birthYear`→`birthYearFrom/To`.

Couverture préservée : `tests/directory-filters.test.mjs` couvre déjà le runtime en profondeur (cas B, D, F, J, M).

## 5. Dette résiduelle documentée (volontairement non traitée)

1. **Duplication `directory-utils.js` ↔ `directory-advanced.js`** (et `normalizeDirectoryText` en double) :
   non supprimable sans casser le contrat octet de `final-qa` vs fixture v18. Exports vivants du module
   gelé : `directoryPersonName`, `formatDirectoryDate` (utilisés par `js/app.js`). Exports sans consommateur
   après migration : `filterAndSortDirectory`, `directoryEventYear`, `directoryEventSortValue`,
   `normalizeDirectoryText`. Réexamen possible si le contrat byte-compare évolue (lot 7+).
2. **Fondation photo abandonnée** : si une fonctionnalité de prévisualisation refondu un jour, restaurer
   depuis l'historique (`38da79d`). Les mentions historiques (`docs/SOURCES_PREUVES_GENEALOGIQUES.md:96`,
   rapports 6A/6B/roadmap) décrivent l'état d'origine et restent telles quelles ; les référentiels actifs
   `docs/TECHNICAL_MAP.md` (§5 et §contrats) et `docs/TEST_MATRIX.md` (zone Documents) ont été mis à jour.
3. **`sans-texte-192/512`** : conservés comme ressources PWA mais actuellement non référencés (aucun
   `manifest.webmanifest` dans le dépôt) ; `planche-reference.png` (1,6 Mo) non référencé — conservés par
   prudence conformément au mandat.

## 6. Tests exécutés (tous verts sauf échec préexistant §7)

| Famille | Commandes / fichiers | Résultat |
|---|---|---|
| Unit complet (×2, dont après bump) | `npm run test:unit` | **583/583** |
| CSS | `design-system-foundation`, `final-qa`, `interaction-language` | **3/3** |
| CSS (navigateur) | `document-viewer-mobile`, `page-headings`, `person-dialog-actions` | **39/39** |
| Annuaire | `qa-70-cases`, `genealogy-model`, `directory-filters`, `final-qa` | **47/47** (gel vérifié : `git diff js/directory-utils.js` vide) |
| Photo/cache | `hosting-cache`, `asset-release`, `source-document-model` | **27/27** puis **10/10** après bump |
| Documents / atelier (lot de 3) | `document-detail-page`, `transcription-workshop`, `genealogy-workspace-ui` | **85/85** |
| Zone mobile/responsive (lots ≤ 3) | `document-menu-edit-mobile`, `ios-webapp-header`, `mobile-fullscreen-header`, `mobile-modal-sheets-lot1/2/3a`, `person-mobile-sheet`, `tile-context-menu-responsive`, `tree-directory-responsive`, `interaction-responsive-smoke`, `document-viewer-mobile` | **12/12 + 56/56 + 37/37 + 28/28** |
| Fiches détaillées | `source-detail-page`, `person-detail-page` | **3/3** (confirmation finale post-bump) |
| Assets | `npm run check:assets` | **OK** — jeton unique, 59 refs `?v=` + meta = 60 occurrences |
| Build | `npm run build:recette` | **258/258 ressources servies**, 8 770 074 octets |

**Remarque d'exécution** : lancer5+ Chromium simultanément provoque des flakies de contention
(2 échecs non reproductibles observés puis verts en réexécution isolée : ouverture de vue et rôle
`isAdminUser()` — ni l'un ni l'autre n'est touché par ce lot). Aucun test n'a été modifié pour cela ;
les lots navigateurs ont été exécutés ≤ 3 fichiers. Le commit `9d5fe03` (« isolate concurrent browser
test scenarios ») témoigne de cette contrainte connue du dépôt.

## 7. Contrôles visuels (navigateurs réels)

- **`npm run test:responsive`** (7 viewports réels, ~500 assertions) : **identique à HEAD**.
  Échec unique préexistant et prouvé : `mobile-390 · « Ajuster » centre l'arbre (x -202.0/-200.5,
  y -3.7/-2.0)` — écart y = 1,7 px pour une tolérance de 1,5 px (`tests/responsive-real.mjs:420`).
  **Preuve de non-régression** : exécution de la même suite dans un worktree détaché à `18cf250`
  (sans ce lot) → même échec, mêmes valeurs, mêmes7 lignes de résumé. Hors périmètre 6B (géométrie
  frontière de l'arbre), à traiter séparément.
- Fichiers navigateur de la zone `design-system.css`/`index.html` : tous exécutés et verts (§6),
  ce qui couvre l'absence de régression visuelle des32 suppressions CSS sur les vues touchées
  (personne, document, transcription, workspace, source, modales mobiles, navigation, tuiles).

## 8. Version des assets

- Jeton : `24-unused-definitions-20261121-1` → **`25-tech-debt-cleanup-6b-20261121-1`**
  (`npm run bump:assets`,60 occurrences ; format conforme `^\d+-[a-z0-9]+…-\d{8}-\d+$`).
- `npm run check:assets` : OK après bump ; **rebâti** `dist-recette` (l'artefact porte le nouveau jeton —
  le test d'artefact d'`asset-release` avait justement signalé l'artefact obsolète, corrigé par le rebuild
  conforme à la procédure).
- Absents de l'artefact : photograph ×2 et les10 PNG supprimés. Présents : `vendor/pdfjs`, variantes
  PWA, `planche-reference` hors artefact (non référencée, cf. §5.3).

## 9. Risques

| Risque | Niveau | Atténuation |
|---|---|---|
| Échec `test:responsive` mobile-390 | Préexistant, non lié | Prouvé identique à HEAD ; hors lot ; capture diagnostic conservée dans le rapport ci-joint |
| Restitution future de la fondation photo | Faible | Restauration git possible (`38da79d`), zéro consommateur aujourd'hui |
| Suppression CSS sur une vue non couverte par les tests | Faible | Référence zéro vérifiée statiquement **et** dynamiquement ; suites de toutes les vues touchées exécutées |
| Flakies de parallélisme navigateur | Connexe, non lié | Lots ≤ 3 fichiers ; aucun test affaibli |
| Import map (49 entrées) | Faible | JSON validé, toutes les refs uniformes, `hosting-cache` vert |

## 10. État final avant lot 7

- Branche `recette` : lot **6B.1 + 6B final consolidé**, working tree limité aux21 fichiers du lot,
  `git diff --check` propre, aucun fichier hors périmètre modifié.
- Contrats préservés : fixtures v16-v18, `firestore.rules`, `directory-utils` (octet), signatures
  publiques, champs legacy, icône `#icon-procedures`, `vendor/pdfjs`.
- Artefact `dist-recette` au jeton `25-tech-debt-cleanup-6b-20261121-1`,258/258 ressources.
- **Aucun** changement de règles, de dépendances, de données ni de configuration Firebase.
- Le lot **7 (modularisation)** n'a pas été commencé.
