# Audit de la dette technique — Lot 6A (code inutilisé et dépendances résiduelles)

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche / HEAD | `recette` @ `3d86111` (working tree propre avant rapport) |
| Objectif | Inventaire exploitable pour le lot 6B — **aucune suppression effectuée** |
| Méthode | Analyse statique ciblée (imports, références, motifs dynamiques) |

**Conventions** : **[F]** = fait vérifié par référence concrète · **[M]** = mesure · **[C]** = candidat (identifiant unique).

---

## 1. Résumé exécutif

1. **46 candidats** identifiés : **27 à confiance élevée**, **19 à confiance moyenne** ; **23 à risque faible**, **23 à risque modéré**, **0 à risque élevé** proposé pour suppression.
2. Les trois familles de gisements : **32 sélecteurs CSS orphelins** (~80 occurrences de règles), **8 éléments JavaScript** dont 3 définitions mortes et 2 modules jamais chargés en runtime, **4 ressources statiques** (~2,5 Mo d'icônes non référencées).
3. **Un défaut de couverture notable** : `filterAndSortDirectory` existe en deux implémentations (legacy dans `directory-utils.js`, courante dans `directory-advanced.js`). Le runtime utilise la courante ; **deux tests exercent la version legacy avec des clés de filtre que l'application n'envoie jamais** → faux confort de couverture [F].
4. Les **4 dépendances npm sont toutes utilisées** (runtime via CDN/vendored, build, tests) : rien à retirer a priori [F].
5. **Aucune référence Démarches obsolète dans le code actif** : seuls restent l'icône partagée `#icon-procedures`, des formulations naturelles du français, des tests de sécurité et des tests d'absence/compatibilité — tous à conserver [F].
6. La principale **dette structurelle** (traitée en 6C/7) : `js/app.js` (17 672 lignes, 63,6 % du code JS, 712 fonctions, 272 écouteurs, une seule bannière de section) et un import map de 51 entrées avec un versionnement de cache manuel (62 occurrences de la version `?v=`) [M].

## 2. Méthode

1. Vérification Git (branche, HEAD, état) puis relevé des mesures.
2. Reconstitution du graphe d'imports JS (contenu complet des fichiers, imports statiques et dynamiques) depuis les points d'entrée `index.html` → `js/form-ui.js` + `js/app.js`, fermeture transitive calculée.
3. Pour chaque suspect : recherche de références textuelles dans `index.html`, `js/` (templates inclus), `tests/`, `scripts/`, puis recherche de **motifs de construction dynamique** (`prefix${`, `prefix-'`, tiges de classes) pour exclure les faux positifs.
4. Exports : extraction des symboles exportés (351), recherche de consommateurs externes, puis comptage des usages internes pour distinguer « export superflu » de « code mort ».
5. Ressources : correspondance nom de fichier ↔ références (HTML/CSS/JS/docs/scripts/workflow).
6. Dépendances : `package.json` + lockfile confrontés aux imports réels (tests, build, scripts).
7. Exclusions : `node_modules/`, `.git/`, `vendor/` (sauf nécessité), `dist-*` (générés, ignorés), `docs/archive/`, `tests/fixtures/` (figés), archives privées hors dépôt.

Aucun test n'a été exécuté (audit documentaire), aucun outil installé, aucune donnée distante consultée.

## 3. Périmètre analysé

- Points d'entrée : `index.html` (892 lignes), `js/form-ui.js`, `js/app.js`, `css/design-system.css`.
- `js/` : 51 fichiers ; `scripts/` : 4 fichiers ; `tests/` : 113 fichiers `.mjs` + `tests/fixtures/` (9 fichiers figés) ; `pages-redirect/` (2) ; `.github/workflows/` (1).
- Ressources : `La_Nostra_Storia_icons/` (18 fichiers), `vendor/pdfjs/` (203 fichiers), `dist-recette/`, `dist-production/` (générés, ignorés par Git).
- Configs : `package.json`, `firebase.json`, `firebase.production.json`, `.firebaserc`, `.gitignore`.
- Documentation : `AGENTS.md`, 19 rapports Markdown en racine, `docs/` (11 fichiers).

## 4. Mesures initiales (état de référence pour 6C/7)

### Volume et entrées [M]

| Catégorie | Mesure |
|---|---|
| `js/app.js` | **17 672 lignes / 977 Ko** (63,6 % des 27 801 lignes de `js/`) |
| `css/design-system.css` | **7 954 lignes / 407 Ko** — feuille unique, aucun `@import` |
| `index.html` | **892 lignes** : import map 51 entrées, 71 symboles SVG inline, 1 bloc `<style>` (37 lignes) |
| `js/` après app.js | `tree-layout-engine` 780, `document-pdf-viewer` 681, `document-image-viewer` 574, `transcription-workshop` 542, `backup-archive` 483, `tree-model` 479 |
| `app.js` | 712 fonctions, 272 `addEventListener`, 839 lignes vides, ~400 lignes commentées, **1 seule bannière de section** (292 blocs de commentaires ponctuels) |
| Tests | **113 fichiers** : 51 Playwright, 62 unitaires ; `helpers.mjs` importé par 51 fichiers ; `emulator-guard.mjs` par 4 |
| Scripts npm | 5 : `build:recette`, `build:production`, `test:responsive`, `test:firestore`, `test:firestore:run` |
| Ressources | icônes 18 (2,5 Mo), `vendor/pdfjs` 203 (6,4 Mo, commité), `dist-recette` 258 (8,4 Mo) + `dist-production` 274 (10,9 Mo) ignorés |
| Docs | 19 `.md` en racine + 11 fichiers `docs/` |

### Points d'entrée et dépendances [F]

- `index.html` charge `js/form-ui.js` et `js/app.js` (modules ES) ; une **seule** feuille CSS.
- Dépendances runtime **externes** : SDK Firebase `gstatic` 12.2.1 (import direct), JSZip 3.10.1 (import dynamique CDN, `js/app.js:12974`), `vendor/pdfjs/pdf.mjs` (local, `document-pdf-viewer.js:1`).
- **4 devDependencies, toutes utilisées** : `firebase` (SDK des tests émulateur), `firebase-tools` (scripts npm), `pdfjs-dist` (recopie vers `vendor/pdfjs/` par les builds), `playwright` (51 tests).
- GitHub Pages (`.github/workflows/pages-production.yml`) ne publie que `pages-redirect/` ; l'application passe par Firebase Hosting via `dist-*` construits localement.

### Zones difficiles à analyser [M]

- `app.js` : 17 672 lignes sans découpage macro, templates HTML en littéraux dans le JS (classes générées dynamiquement), état global important.
- Import map : toute ressource JS doit y figurer avec la version `?v=` — **62 occurrences** de `23-zone-pdf-rerender-20261121-1` à mettre à jour à chaque publication (aucun script de build ne le fait).
- CSS unique : aucun découpage par composant, difficulté à isoler la portée d'une suppression.
- Tests : deux familles (Playwright navigateur vs unitaires Node) sans commande npm dédiée au sous-ensemble rapide.

## 5. Inventaire des candidats

### 5.1 JavaScript ([C] J-01 → J-08)

| ID | Élément | Emplacement | Indices d'inutilisation | Références vérifiées | Confiance | Risque | Recommandation |
|---|---|---|---|---|---|---|---|
| J-01 | `photograph-storage.js` (245 l.) | `js/` | Jamais importé par le graphe runtime | 0 import dans `js/` (statique et dynamique) ; consommé uniquement par `tests/photograph-storage.test.mjs` ; 2 entrées d'import map ; cité comme « fondation » dans `docs/SOURCES_PREUVES_GENEALOGIQUES.md:96` | Élevée (runtime) | Modéré | **Conserver en 6A** ; décision produit en 6B (abandonner la fondation photo ou la brancher) |
| J-02 | `photograph-preview.js` (49 l.) | `js/` | Idem J-01 | Idem ; ajouté par `38da79d` sans import runtime à ce jour | Élevée (runtime) | Modéré | Idem J-01, traiter ensemble |
| J-03 | `directoryFilterGroups` | `js/directory-advanced.js:152` | Définition sans consommation | 0 occurrence hors sa définition (repo hors `docs/`) | Élevée | Faible | Supprimer en 6B.1 |
| J-04 | `directoryEventYear` | `js/directory-utils.js:21` | Définition sans consommation | 0 hors définition (+ copie figée `tests/fixtures/v18/…` **non touchée**) | Élevée | Faible | Supprimer en 6B.1 |
| J-05 | `REFERENCE_STATES` | `js/genealogy-proofs.js:10` | Définition sans consommation | 0 hors définition | Élevée | Faible | Supprimer en 6B.1 |
| J-06 | `filterAndSortDirectory` **legacy** | `js/directory-utils.js:35` | Doublon : l'implémentation runtime est `directory-advanced.js:100` (différente : clés `firstName`, `birthPlace`, `birthYearFrom/To`, `treeId`, `deathInfo`) | Importée seulement par `tests/qa-70-cases.test.mjs:4` (cas 21-24 avec clés legacy `name`/`place`/`birthYear`) et `tests/genealogy-model.test.mjs:5` ; le runtime envoie les clés avancées (`app.js:4926-4931`) | Moyenne (« obsolète ») | Modéré | **Ne pas supprimer sans migrer les 2 tests** vers `directory-advanced.js` (voir 6B.4) |
| J-07 | `normalizeDirectoryText` dupliqué | `js/directory-utils.js:3` **et** `js/directory-advanced.js:15` | Copies **identiques octet à octet** (174 c.) dans deux modules ; chaque module n'utilise que la sienne | Comparaison de corps de fonction : identique | Élevée (duplication) | Modéré | Fusionner sur une source unique en 6B.4 (avec J-06) |
| J-08 | 21 mots-clés `export` superflus | plusieurs modules | Symboles utilisés uniquement en interne | Ex. `hashId` (19 usages internes), `connectionElements`, `canonicalFamilyRelationData`, `MAIN_VIEWS`, `BACKUP_COLLECTION_NAMES`, `TRANSLATION_STATES`, `RELATION_TYPES`, `PROPOSAL_*`, `SOURCE_DOCUMENT_*`, etc. (liste complète en annexe §5.6) | Élevée | Faible | Retirer le seul mot-clé `export` (petit bénéfice, réduit la surface API) — 6B.1 optionnel |

### 5.2 CSS ([C] C-01 → C-32, sélecteurs de `css/design-system.css`)

Méthode : chaque classe ci-dessous est **absente de `index.html` et de tous les `js/`** (y compris templates), et **aucune construction par interpolation `…${`** n'existe pour sa famille (vérifié famille par famille). ~80 occurrences de règles concernées.

**Groupe A — page/shell (4)** : C-01 `dedicated-page-heading` (5), C-02 `dedicated-page-return` (2), C-03 `dedicated-page-side` (1), C-04 `detail-mobile-header-spacer` (1).
*Note : les classes sœurs `dedicated-page-header`, `-back`, `-actions`, `-content` sont bien utilisées.*

**Groupe B — fiche Personne (4)** : C-05 `person-context-actions` (5) — **le test `tests/person-dialog-actions.test.mjs:80` exige que la classe soit absente du HTML** (« blocs d'actions contextuels retirés ») ; C-06 `person-page-timeline-list` (8) — le JS utilise `person-page-timeline` (`app.js:2297`), sans `-list` ; C-07 `person-detail-last-modified-mobile` (2, dont 1 en media query) ; C-08 `person-meta-info` (1).

**Groupe C — documents/visionneuses (8)** : C-09 `document-unified-facts--file` (7) — le seul motif construit est `document-unified-fact${…--wide}` (singulier, `app.js:13468`) ; C-10 `document-unified-fact--file-name` (4) ; C-11 `document-unified-filename` (4) — le JS utilise l'attribut `data-unified-filename` ; C-12 `document-unified-actions` (1) ; C-13 `document-detail-heading` (1) — seul `-row` existe (`index.html:455`) ; C-14 `document-transcription-summary` (4) — les constructions réelles sont `-progress`, `-card`, `-action--${…}` ; C-15 `print-row` (3) + C-16 `print-sources` (3) — styles d'impression orphelins (`print-head`/`print-kicker` existent côté JS).

**Groupe D — détail Généalogie (2)** : C-17 `genealogy-detail-head` (1), C-18 `genealogy-detail-head-badges` (1) — seules `genealogy-detail-grid` sont générées (`app.js:7276-7283`).

**Groupe E — atelier Transcription (4)** : C-19 `transcription-workshop-breadcrumb-document` (2), C-20 `transcription-workshop-breadcrumb-separator` (1), C-21 `transcription-workshop-head-status` (2), C-22 `transcription-workshop-compare-crop` (2) — le sélecteur `transcription-workshop-breadcrumb` (parent) est utilisé (`app.js:9474`), les variantes ne le sont pas.

**Groupe F — divers (5)** : C-23 `consultation-breadcrumb-current` (1) — les variantes `-root/-link/-intermediate/-separator/-overflow` sont générées littéralement, `-current` jamais ; C-24 `page-kicker` (4) — le JS génère `print-kicker` ; C-25 `is-loading` (2) — `setButtonPending` (`ui-components.js:24-40`) utilise `aria-busy`, jamais cette classe ; C-26 `relation-group-footer` (2) ; C-27 `life-journey-facts` (2) + C-28 `life-journey-justification-group` (2) — les classes réelles sont `life-journey-justifications` (`app.js:2846`) ; C-29 `life-entry-place` (1) ; C-30 `source-detail-heading` (3) ; C-31 `source-detail-observations` (1) — seule la variante `-body` existe (`app.js:11898`) ; C-32 `form-context-help` (1).

Confiance : **Élevée** pour les 19 classes sans sœur ambiguë ni risque media-query/print (C-05, C-06, C-09, C-10, C-11, C-12, C-14, C-15, C-16, C-17, C-18, C-23, C-24, C-25, C-26, C-27, C-28, C-29, C-32). **Moyenne** pour les 13 restantes (C-01…C-04, C-07, C-08, C-13, C-19…C-22, C-30, C-31) : composants dynamiques, media queries ou classes sœurs proches — validation visuelle obligatoire en 6B. Risque : **faible** pour les classes sans contexte d'impression/mobile, **modéré** pour les groupes C (print), B (mobile) et E (composant dynamique).

### 5.3 Ressources statiques ([C] A-01 → A-04)

| ID | Élément | Taille | Références vérifiées | Confiance | Risque | Recommandation |
|---|---|---|---|---|---|---|
| A-01 | 8 PNG `la-nostra-storia-avec-texte-*` (16→512) | ~491 Ko | **0** dans tout le dépôt (HTML/CSS/JS/docs/scripts/workflow) | Élevée | Faible | Supprimer en 6B.3 (anciens logos « avec texte » remplacés) |
| A-02 | `la-nostra-storia-planche-reference.png` | 1 626 Ko | 0 dans tout le dépôt | Moyenne (usage externe/délibéré possible) | Faible | Demander confirmation, puis supprimer ou déplacer hors VCS en 6B.3 |
| A-03 | `sans-texte-72.png`, `sans-texte-96.png` | 31 Ko | 0 ; le README documente 192/512 comme « Android/PWA **futur** » → à conserver, 72/96 non référencés | Élevée | Faible | Supprimer en 6B.3 (les 4 tailles restantes : 16/32/48/180 utilisées) |
| A-04 | `vendor/pdfjs/` (203 fichiers) | 6,4 Mo | **Artefact généré** par les builds depuis `node_modules/pdfjs-dist` (`build-*.mjs:10-11`), mais lu au runtime (`document-pdf-viewer.js:1`) **et référencé par 3 tests** | Moyenne | Modéré | Conserver en 6B ; étudier séparément si la régénération à chaque build rend le commit redondant |

### 5.4 Tests et scripts ([C] T-01 → T-02)

| ID | Élément | Indices | Confiance | Risque | Recommandation |
|---|---|---|---|---|---|
| T-01 | `tests/qa-70-cases.test.mjs` (cas 21-24) + `tests/genealogy-model.test.mjs:64-65` | Importent `filterAndSortDirectory` **legacy** (`directory-utils.js`) avec les clés `name`, `place`, `birthYear` — le runtime n'envoie que `firstName`, `marriedName`, `birthPlace`, `birthYearFrom/To` (`app.js:4926+`) → **ces cas ne couvrent pas le chemin de production** | Élevée (factuel) | Modéré | Migrer les cas vers `directory-advanced.js` puis supprimer l'implémentation legacy (6B.4) |
| T-02 | `tests/photograph-storage.test.mjs` | Seul consommateur de J-01/J-02 | Élevée | Modéré | Traiter avec la décision J-01/J-02 (6B.5) |

Aucun autre test « de fonctionnalité supprimée » n'a été trouvé : les suites Démarches ont été supprimées en 5C.1 ; il reste des **tests de sécurité** (`firestore-rules-invariants`, `firestore-emulator`), des **tests d'absence** (`genealogy-workspace-ui:221-222`, `interaction-language`, `person-detail-page`) et des **tests de compatibilité** (`navigation-state`, `navigation-detail-restore` sur l'ancienne URL `?view=dossiers`) — tous à conserver.

### 5.5 Dépendances et configuration

| Élément | Usage vérifié | Verdict |
|---|---|---|
| `firebase` (dev) | SDK des tests (`firebase/app`, `firebase/auth`, `firebase/firestore`) | Utilisé — conserver |
| `firebase-tools` (dev) | `test:firestore*`, invocation locale | Utilisé — conserver |
| `pdfjs-dist` (dev) | Recopie vers `vendor/pdfjs/` par les 2 builds | Utilisé — conserver |
| `playwright` (dev) | 51 fichiers de tests | Utilisé — conserver |
| `pages-redirect/` | Publié par le workflow GitHub Pages | Utilisé — conserver |
| `firebase.production.json` | Lu par `build-production.mjs:53` | Utilisé — conserver |
| `dist-recette/`, `dist-production/` | Générés, **ignorés** par Git | Pas une dette VCS (19 Mo locaux) |
| `.firebaserc` `default = production` | Piège documenté, jamais utilisé implicitement | Conserver, usage explicite systématique |

### 5.6 Annexes : les 21 exports superflus (J-08)

`BACKUP_COLLECTION_NAMES` (backup-archive) · `TRANSLATION_STATES` (document-transcription) · `RELATION_TYPES`, `END_TYPES`, `FILIATION_TYPES` (family-relations) · `PROPOSAL_STATES`, `PROPOSAL_TYPES`, `GENEALOGY_EVENT_TYPES`, `NOTIFICATION_TYPES` (genealogy-collaboration) · `GENEALOGY_DATE_TYPES` (genealogy-date) · `PARENT_CHILD_RELATION_STATES` (genealogy-identities) · `MAIN_VIEWS`, `DETAIL_BASE_VIEWS` (navigation-state) · `SOURCE_DOCUMENT_SCHEMA_VERSION`, `SOURCE_DOCUMENT_STATES`, `DOCUMENT_PAGE_SIDES`, `DOCUMENT_DATE_TYPES` (source-document-model) · `TRANSCRIPTION_DRAFT_STORAGE_VERSION` (transcription-draft-storage) · `hashId` (transfer-diagnostic) · `canonicalFamilyRelationData` (tree-model) · `connectionElements` (tree-renderer).

Total : 351 exports analysés, 24 sans référence externe (dont 3 morts : J-03/J-04/J-05, et J-06/J-07 traités ci-dessus).

## 6. Éléments à conserver impérativement

1. **`#icon-procedures`** (`index.html:171`), l'entrée `"procedures"` de `ui-components.js:6` et son usage `app.js:3009` (catégorie « Professions et activités » du parcours) — icône partagée, pas un reliquat Démarches [F].
2. **Tests de sécurité** : `firestore-rules-invariants.mjs`, section Démarches de `firestore-emulator.mjs` (refus 4 profils) [F].
3. **Tests d'absence Démarches** : `genealogy-workspace-ui.test.mjs:221-222`, `interaction-language.test.mjs:70`, `person-detail-page.test.mjs:251` [F].
4. **Tests de compatibilité des anciennes URLs** : `navigation-state.test.mjs:15,28`, `navigation-detail-restore.test.mjs:264-270` (repli `?view=dossiers`) [F].
5. **Fixtures figées** `tests/fixtures/v16|v17|v18` (9 fichiers, historiques, jamais modifiables) [F].
6. **Compatibilité des données anciennes** : champs legacy dans `backup-utils.js` (`birthDate`, `partnerIds`, textes nus…) — nécessaire à la restauration des archives [F, AGENTS.md].
7. **Les deux layouts** `tree-layout.js` et `tree-layout-engine.js` : tous deux appelés en runtime (`calculateTreeLayout` ×2, `calculateHybridTreeLayout` ×1) — stratégie legacy/hybride volontaire, non une duplication accidentelle [F].
8. **`form-ui.js`** : second point d'entrée autonome (validation de formulaires), sans import mais actif via `index.html` [F].
9. **`vendor/pdfjs`** et les 4 dépendances (§5.5) — voir A-04/D-01.
10. **Tailles d'icônes 192/512** documentées « PWA futur » dans `La_Nostra_Storia_icons/README.txt` [F].

## 7. Limites de l'analyse

- **Statique uniquement** : aucun test exécuté, aucun trace de couverture, aucune exécution runtime — l'inutilisation est démontrée par les références et les motifs de construction, pas par un profil d'exécution.
- Les classes générées par **concaténation pure** (`cls + "-suffix"`) ne sont pas exclusives ; les motifs `${` et `-'` ont été cherchés mais une construction atypique reste possible → d'où la validation visuelle/print en 6B.
- Les **tests n'ont pas été rejoués** : les comportements legacy avancés (T-01) sont déduits des clés de filtre, pas d'un échec observé.
- Références hors dépôt (issues, anciennes branches) non analysées ; `docs/` exclu du calcul des références (documentation historique légitime).
- Aucune donnée Firestore ni archive privée n'a été ouverte.

## 8. Priorisation pour le lot 6B

| Sous-lot | Périmètre | Fichiers | Confiance / risque | Tests ciblés | Bénéfice |
|---|---|---|---|---|---|
| **6B.1** — JS trivial | J-03, J-04, J-05 (+ J-08 optionnel) | `directory-advanced.js`, `directory-utils.js`, `genealogy-proofs.js` (+ 21 exports) | Élevée / **Faible** | `node --test tests/directory-filters.test.mjs tests/qa-70-cases.test.mjs tests/genealogy-model.test.mjs tests/genealogy-proofs.test.mjs` | −3 définitions, API plus claire |
| **6B.2** — CSS orphelines | C-01 → C-32, **par sous-lot composant** (A→F du §5.2), jamais en une passe | `css/design-system.css` | Élevée/Moyenne / **Faible-Modéré** | Relecture visuelle desktop + mobile + impression (print) ; `node --test tests/person-detail-page.test.mjs tests/person-dialog-actions.test.mjs tests/document-detail-page.test.mjs` | −~80 règles, −complexité CSS |
| **6B.3** — Assets | A-01, A-03 ; A-02 après confirmation | `La_Nostra_Storia_icons/` | Élevée / **Faible** | Contrôle des favicons après build (`npm run build:recette` puis ouverture locale) | −~520 Ko (−2,1 Mo si planche) |
| **6B.4** — Duplication annuaire | J-06 + J-07 + **T-01** (migration des cas 21-24 et du tri vers `directory-advanced`) | `directory-utils.js`, `directory-advanced.js`, 2 tests | Moyenne / **Modéré** | `tests/qa-70-cases.test.mjs`, `tests/genealogy-model.test.mjs`, `tests/directory-filters.test.mjs` | Fin du double implémenté + couverture réelle du runtime |
| **6B.5** — Modules photographes | J-01 + J-02 + T-02 (décision : abandonner la « fondation » ou la brancher) | `photograph-storage.js`, `photograph-preview.js`, 1 test, 2 entrées d'import map | Élevée (runtime) / **Modéré** | `tests/photograph-storage.test.mjs` selon la décision | −294 lignes non chargées si abandon |
| **6B.6** — Reporté / incertain | A-04 (`vendor/pdfjs`), vérification des classes du groupe E/F à l'écran | — | Moyenne / Modéré | Analyse du build + smoke visuel | À ne pas supprimer sans preuve |

**Critères de validation communs** : aucun changement de comportement visible ; `node --check` sur les fichiers touchés ; tests ciblés verts ; `git diff` limité au périmètre du sous-lot ; **jamais** de toucher aux fixtures, aux règles Firebase, aux dépendances ou aux icônes partagées ; un sous-lot = un commit.

## 9. Critères de validation du lot 6A

- Les deux rapports créés, aucun autre fichier modifié (vérifié par `git status` et `git diff --check`).
- Chaque candidat porte une référence vérifiable (fichier:ligne ou résultat de recherche).
- Aucun candidat présenté comme « mort » sans recherche de motif dynamique associée.
- Aucun élément des §6 n'est proposé à la suppression.
- Aucune donnée distante, aucun déploiement, aucun test complet exécuté.

---

*Lot 6A : audit documenté. Aucun code, test, configuration ou asset modifié.*
