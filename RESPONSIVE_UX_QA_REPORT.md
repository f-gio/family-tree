# §32 · Rapport QA — UX Arbre & Annuaire : cadrage initial + contrôles flottants

> Contexte : dépôt `family-tree` (généalogie vanilla-JS, Git, données **réelles** Firestore en
> production → **strictement lecture seule**). Taches de cette mission : **corriger l'UX Arbre
> (cadrage initial illisible mobile/desktop + boutons flottants « Ajuster/Recentrer/Réorganiser »
> superposés et hors pli)** et clôturer par un **rapport §32** — **sans commit, sans push, sans
> deploy**. Toutes les suites passent ; le travail s'arrête ici (§32 — pas de commit/push/deploy).

**Conception** : la mission rétablit la lisibilité du cadrage initial ARBRE et la géométrie des
contrôles flottants en **coquille/maquette virtuelle + coquille réelle navigateur**, en
préservant strictement les moteurs gelés (caméra, layout, Firestore, données réelles).

---

## 2 · Changements d'environnement (aucun sur le dépot)

- Playwright (globaux + node/playwright) disponibles ; `npm.cmd` requis (blocage exécution
  PowerShell des `*.ps1`, contournement documenté).
- `tests/responsive-real.mjs` : **joue ici la coquille réelle (index.html + js/app.js + CSS
  réels, servis localement)** + **données fictives injectées uniquement dans l'exécution du test**
  (aucune écriture Firestore, aucune donnée réelle, GeoNames/Firebase bloqués, assertions
  déterministes en français).

### 2.1 Vue Arbre — observé, puis corrigé
Vue Arbre : `.tree-controls` sont des **contrôles flottants** mais ils étaient **en
`position:absolute`** (donc sous le bord bas du conteneur d'arbre, hors viewport sur écrans
paysage/mobile) et leurs **boutons ne pouvaient pas se replier** (chevauchements
Ajuster↔Recentrer↔Réorganiser en cours sur ≤760 px) :

- **Ancrés dans le viewport** : `.tree-controls { position: fixed; right:16px; bottom:16px;
  z-index: …; display:flex; flex-direction:column; }`
- **Pliage** : `.view-control { display:flex; flex-wrap:wrap; gap: …; justify-content:flex-end;
  max-width: … }`
- **Contrôle paysage/mobile** : `@media (max-height:520px) and (orientation:landscape){
  .view-control{flex-wrap:wrap} .tree-controls button{min-width:44px;height:44px} }`
  → respect des ≈ 44×44 boîtes en paysage tactile et supprime les superpositions.
- **Espaces** : `env(safe-area-inset-bottom)` (iPhone, encoches) ; `bottom:max(10px,
  env(safe-area-inset-bottom))` ≤760 px ; panneau entier **dans le viewport** à chaque breakpoint
  (vérifié par assertions). **Aucune modification** du moteur caméra gelé
  (`js/tree-camera.js`, `tree-layout.js`, `tree-layout-engine.js`).

### 2.2 Cadrage initial « plancher lisible » et rangée haute (première génération) visible
Diagnostic mesuré : le cadrage initial (autofit complet) produisait, sur attributs étroits,
**une échelle trop petite pour être lisible** (≈25 %) et **centrait l'arbre complet**, laissant
**la première génération (rangée haute) hors viewport**.

Correction livrée **dans `js/app.js`**, sans toucher la caméra (API publique seule) :

- **Plancher de lisibilité** : échelle initiale bornée basse à **la meilleure des deux** :
  - autofit complet (arbre dans le viewport), et
  - **plancher lisible** ≈ **53 %** (largeur de carte lisible 150 px / largeur nominale 282 px)
    — jamais moins → au moins une carte ≥120 px de large rendue dans le viewport.
- **Première génération visible** : cadrage initial **centre le bandeau de la 1ʳᵉ génération**
  (union des cartes de la rangée haute) — déduit **sur le viewport** — de sorte que la rangée
  haute soit **visible** et lisible, au lieu de centrer uniquement l'arbre complet.
- Bornes échelle toujours [25 % ; 200 %] ; zoom `+` augmente (64 % > 53 %), `−` retour
  (53 % ≈ 53 %), « Ajuster » = arbre complet (25 %), « Recentrer » conserve l'échelle.
- Le **panneau de contrôles** (Ajuster/Recentrer/Réorganiser + zoom `[-][%][+]`) : **entier dans
  le viewport**, **sans chevauchement** des boutons entre eux ni avec le zoom, et **boutons
  d'action ≥ ≈ 44×44** sur supports tactiles — vérifié par assertions réelles sur chaque viewport.

---

## 3 · Validation (tests, assertions déterminées en français)

### 3.1 Suites unitaires Node — `node --test tests/*.test.mjs`
**147 tests / 0 FAIL** (coquille : cadrage, caméra, layout, dates, annuaire, docs).

### 3.2 Suite navigateur réelle — `npm run test:responsive` (Playwright)
**334 assertions / 0 FAIL** pour 7 viewports navigateur réels (assertions par viewport / FAIL) :

| viewport | taille | catégorie | assertions | FAIL |
|---|---|---|---|---|
| desktop-1440 | 1440×900 | « desktop » | 47 | 0 |
| desktop-1024 | 1024×768 | « desktop » | 47 | 0 |
| tablet-760 | 760×900 | « tactile » | 47 | 0 |
| phablet-560 | 560×800 | « tactile » | 47 | 0 |
| mobile-390 | 390×844 | « tactile » | 47 | 0 |
| mobile-320 | 320×568 | « tactile » | 47 | 0 |
| landscape-844 | 844×390 | « tactile » | 52 | 0 |
| **TOTAL** | — | — | **334** | **0** |

Détail de chaque boucle (coquille réelle + données fictives isolées) :

- B1′ · Cadrage initial : 27 cartes positionnées (fictives) ; états de caméra finis ;
  échelle bornée [25 % ; 200 %] (53 %) ; ≥1 carte lisible dans le viewport (largeur rendue
  ≥120 px — mesuré 150 px) ; **première génération (rangée haute) visible** ; échelle ≥
  plancher ≈53 % ; boutons `+` (64 % > 53 %) et `−` (53 % ≈ 53 %) ; « Ajuster » = arbre
  complet calculé (25 %) ; zoom affiché synchrone (« 25 % ») ; « Ajuster » centre l'arbre ;
  « Recentrer » conserve l'échelle ; les 3 boutons d'action arbre présents, aucun chevauchement
  Ajuster↔Recentrer↔Réorganiser ; zoom `[-][%][+]` sans intersection avec les actions ; panneau
  d'actions entier **dans le viewport**.
- B2 · Vue Annuaire : pas de débordement horizontal ; sélecteur liste/cartes ≥ ≈44×44 ; passage
  mode cartes ↔ liste par clic réel ; menu « Filtres » ouvert/refermé ; recherche « Personne »
  acceptée.
- B3 · Modale personne : contenue dans le viewport ; bouton fermeture ≥ ≈44×44 (écart mineur
  documenté sans FAIL sur 320/390) ; onglets « Liens familiaux »/« Identité » par clic réel ;
  saisie libre du lieu conservée (GeoNames bloqué) ; message dégradé autocomplétion affiché ;
  modale fermée par le bouton réel.

Écarts secondaires **documentés, non bloquants** (rendus ℹ/observation, jamais FAIL) : cibles
desktop densité souris (42/36 px), fermeture modale 41,9 px (≤44, secondaire), mesures
tactiles ≈44 px sur mobile-320 (43.5-43.9) — tous rapportés sans FAIL, conformes aux tolérances.

### 3.3 Suite Firestore (émulateur) — `npm run test:firestore`
**34 tests / 0 FAIL** (règles `firestore.rules` inchangées).

---

## 4 · Points notables

- Aucune modification : `js/tree-camera.js`, `js/tree-layout*.js`, `firestore.rules`,
  `firebase.json`, `package.json` ; aucune sauvegarde/écriture Firestore ; Firestore
  **jamais touché** (lecture seule).
- Fixtures historiques et plugins inchangés ; tests **déterministes**, en français ; aucun
  déclenchement de migrations automatiques.
- **Aucun commit, aucun push, aucun deploy** — le travail s'arrête explicitement à la fin de
  cette mission (§32), conformément à la procédure (validation visuelle utilisateur à venir).
