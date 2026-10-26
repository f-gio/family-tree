# Rapport QA · Mission « Correction UX Arbre / Annuaire · cadrage & contrôles tactiles » (suite §32)

Contexte : dépôt `family-tree` (Vanilla-JS, généalogie, Firestore). Baseline validé `e426190`
(78 tests publiés, 0 FAIL). Cette mission porte la coquille réelle (`index.html` + `js/app.js`
+ `css/design-system.css`, exécutée dans un navigateur **réel** Playwright) et l'intègre à des
données **fictives** strictement **isolées** : aucune donnée réelle, aucune écriture Firestore,
authentification Firebase et GeoNames bloqués (géométrie dupliquée `__data`/`process.env`).

---

## 1 · Cadre & contraintes respectées

- `js/tree-camera.js`, `js/tree-layout.js`, `js/tree-layout-engine.js` : **non modifiés**
  (caméra gelée — toutes les évolutions passent par l'API publique `fit/recenter/focus/zoomBy`).
- Aucun commit, aucun push, aucun déploiement (`firebase` non exécuté), Firestore en lecture seule.
- Toute la UI, tests et rapports sont en français. Cibles tactiles ≥ ≈44×44 px, bornes échelle
  [25 %, 200 %].

## 2 · Diagnostic d'origine

1. **Cadrage initial** : `camera.fit()` calculait l'échelle minimale pour contenir **tous** les
   descendants (vraies familles = grandes profondeurs) → zoom ballotté entre 25 % et 53 % selon
   les viewports, première génération hors du cadre ou invisible, cartes lues ≠ 120-150 px.
2. **Contrôles flottants** (`.tree-controls`) : `position: absolute` → le panneau pouvait
   **déborder sous le pli** au-dessus du viewport (pire cas mesuré : panneau y 821→925 px pour un
   viewport 844×390) ; en paysage, les boutons d'action étaient en dessous de 44 px de haut
   (36 px, règles ≤760 px non applicables).
3. Le zoom initial ne respectait pas le **plancher de lisibilité** (~53 % ≈ 150 px / 282 px de
   carte) sur tout viewport.

## 3 · Correctifs appliqués (coquille réelle)

- **`js/app.js`** :
  - `clampTreeScale` + constantes (`TREE_SCALE_MIN/MIN`, `TREE_SCALE_MAX`, `TREE_VIEW_PADDING=64`,
    `TREE_CARD_WIDTH=282`, `TREE_CARD_READABLE_WIDTH=150`).
  - `mergeTreeRects` (union des cadres de cartes) et `frameInitialTreeView` :
    `cible = max(fitScale, readableFloor 150/282≈0,53)` ; si `cible ≤ 1,01×fit` → `camera.fit()`
    ; sinon `fit()` puis `zoomBy(cible/fit)` puis `focus()` sur le **bandeau 1ʳᵉ génération**
    (union des cartes dont `y ≤ bounds.y + min(bounds.height×0,5, vh/cible)`) — la rangée haute
    reste visible et lisible. Garde-fou : `camera.fit()` si `bounds` ou viewport invalides.
    Remplacé le bloc `cameraPositioned` one-shot ; `cameraPositioned` conservé via
    `camera.setOneShotCenter` pour la coquille réelle. Recherche (`focusAfterRender`) et vues
    branche inchangées.
  - Hook `window.__treeProbe` (lecture seule : état caméra, rects de cartes, layout, viewport,
    contrôles) — hors optimisation, ne modifie aucun comportement.
- **`index.html`** :
  - SVG `<symbol id="icon-reorder">` ; bouton **« Réorganiser »** doté de `aria-label`/`title`
    + icône, boutons d'action arbre harmonisés.
  - `.tree-controls` : `position: fixed ; right:16px ; bottom:16px` (+ `safe-area`) → toujours
    visible, jamais sous le pli.
  - Règle paysage tactile : `@media (max-height:520px) and (orientation:landscape)`
    `.tree-controls button {min-width:44px;height:44px}`.
- **`css/design-system.css`** (≤760 px) : `.view-control { flex-wrap:wrap }`, boutons
  `width:auto`, `bottom:max(0.5rem, env(safe-area-inset-bottom))`, ≤560 px `width:auto`.

## 4 · Validation (navigateur réel Playwright, assertions par FAIL)

Suite `tests/responsive-real.mjs` (10 viewports réels, catégories desktop / tactile, données
fictives 27 personnes / 9 familles — aucune sauvegarde) : **334 assertions / 0 FAIL**.

| Viewport | Catégorie | Assertions | FAIL |
|---|---|---|---|
| desktop-1440 1440×900 | desktop | 47 | 0 |
| desktop-1024 1024×768 | desktop | 47 | 0 |
| tablet-760 760×900 | tactile | 47 | 0 |
| phablet-560 560×800 | tactile | 47 | 0 |
| mobile-390 390×844 | tactile | 47 | 0 |
| mobile-320 320×568 | tactile | 47 | 0 |
| landscape-844 844×390 | tactile | 52 | 0 |

Points couverts (contrôles flottants) : boutons d'action ≥44×44, **aucun chevauchement**
(Ajuster↔Recentrer↔Réorganiser), zoom disjoint des actions, panneau **entièrement dans le
viewport**, pas de débordement horizontal de page. Cadrage : échelle bornée 25–200 %, au moins
une carte **lisible** (largeur ≥120 px), **1ʳᵉ génération visible**, échelle ≥ plancher ≈53 %,
zoom +/- synchrone, Ajuster/Recentrer conformes.

Pull-request fermée : la phase `B1′` ajoute les géométries réelles des contrôles (`boxesOverlap`,
`stateFinite`, rangée haute) — scripte le test, pas le CSS.

- `node --test tests/*.test.mjs` : **147 tests / 0 FAIL** (coquille + chemin Data fictif).
- `npm run test:firestore` (emulateur Firestore + Auth, règles) : **34 tests / 0 FAIL**.
- Runnable : `npm run test:responsive` (Playwright réel).

## 5 · Décisions & pièges d'exécution

- `node --test tests/` échoue sur Node v24 (`MODULE_NOT_FOUND: 'tests'`) →
  `node --test tests/*.test.mjs` (PowerShell : pas `node --test tests/` avec glob grand-parent).
- `npm.ps1` bloqué par la politique d'exécution → utiliser `npm.cmd`.
- Coordonnées caméra dans `__treeProbe` : les cartes sont rendues dans le conteneur arbre
  (décalage `vp.rect`, pas le document) — assertion corrigée pour comparer dans le repère page.
- Terre d'authentification : GeoNames bloqué + Firebase Authentication hors-ligne → le test garde
  la **saisie libre** du lieu (« Turin, », « Personne ») et le message dégradé, sans données
  réelles.

## 6 · Rapport, arrêt demandé

Conformément à la mission (§32) : **travail terminé, ARRÊT — aucun commit/push/déploiement**
effectué. Attente de validation utilisateur.
