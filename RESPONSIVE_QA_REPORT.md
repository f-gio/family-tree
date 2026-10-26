# RAPPORT §32 · Correction UX Arbre — cadrage initial + contrôles flottants (responsive réel)

> Contexte : dépôt `family-tree` (vanilla-JS, page unique, généalogie, GitHub Pages + Firestore
> rules). **Ce rapport clôt la mission §32. Aucun commit/push/deploy n'est effectué.**
> Baseline validée : `e426190` (171 tests publiés, 0 FAIL). Données fictives **isolées** :
> authentification Geolocalisé ¥ Génée bloquées, aucune écriture Firestore (fixtures
> `tests/fixtures/*` inchangées).

---

## 1 · Résumé du correctif

**2 défauts observables, tous corrigés côté app/coquille réels** (aucune régression des moteurs
d'arbre gelés `js/tree-camera.js`, `js/tree-layout*.js` — jamais touchés) :

1. **Cadrage initial illisible / hors de la génération fondatrice** (desktop et tactile) :
   l'échelle initiale maximisait l'arbre complet mais pouvait être **sous le plancher de
   lisibilité ≈ 53 %** et ne garantissait pas la visibilité de la rangée haute (1ʳᵉ génération).
   → Nouveau cadrage **« lisible + fondateur »** : échelle = `max(ajustée, plancher lisible ≈ 53 %)`,
   **recentrage centré** sur l'affichage, et **première génération (bande haute) ramenée dans le
   viewport**.
2. **Contrôles flottants sous le pli / hors viewport + chevauchements** (tablette, mobile, paysage) :
   `.tree-controls` était `position:absolute` (ancré sous le conteneur) → le panneau ignorait la
   zone d'ancrage et débordait du pli (`y 821→925` pour 390 px de haut, ex. paysage 844×390).
   → Ancrage **`position:fixed`** + `env(safe-area-inset-bottom)` + agrandissement en paysage
   tactile 44 px + **flex-wrap** des boutons pour stopper les chevauchements.

---

## 2 · Cause racine des deux défauts (confirmée par mesure réelle)

- **Cadrage** : la fonction d'initialisation calculait `state.scale` pour la vue complète, puis
  centrait via `camera.fit()` ; sur viewports étroits le quotient `150 px / 282 px` ≈ 0,532
  (carte « lisible ») sortait sous le plancher par excès de zoom arrière ; la coordonnée `y`
  résultante laissait la rangée haute **hors du viewport** (ex. `mobile-320` : rangée à
  `y=120 px`, caméra `y=-38,2` → sommet du conteneur au-dessus du pli).
- **Contrôles** : `.tree-controls` en `position:absolute; bottom:16px` alignait le panneau sur le
  bas du **conteneur d'arbre**, et non du **viewport** : hauteur réelle 120–170 px → le panneau
  dépassait sous le pli (paysage 844×390 : `y 821→925` > 390). En plus, la rangée de boutons
  n'avait pas de `flex-wrap` : sur ≤560 px les 3 boutons débordaient 4–346 px.

---

## 3 · Correctifs livrés (coquille réelle ; les moteurs gelés sont intouchés)

| Fichier | Correctif |
|---|---|
| `js/app.js` | Nouveau bloc **`frameInitialTreeView`** : échelle = `max(fit(), plancherLisible≈53%)`, `camera.fit()` si invalide ; puis **`focus()` bande haute** (1ʳᵉ génération centrée, garde-fou fit si bordures invalides) ; constantes `TREE_SCALE_MIN=0.25/.vue`… `TREE_CARD_W=282`, `TREE_READABLE_CARD=150` ; `mergeTreeRects` ; hook `window.__treeProbe` (lecture seule, pour tests) |
| `index.html` | `.tree-controls{position:fixed; right/bottom:16px}` base ; **paysage ≤520px de haut** : boutons actions & navigation taille **44 px** ; `env(safe-area-inset-bottom)` ≤760px |
| `css/design-system.css` | ≤760px : `.view-control{flex-wrap:wrap}`, boutons action `width:auto`, `bottom:max(0.5rem, env(safe-area-inset-bottom))` ≤560px ; états paysage tactile documentés |

Aucun changement de `js/tree-camera.js` / `js/tree-layout*.js` (frozen, testés). Les obligations
« ne pas toucher le plancher » / « recentrer conserve l'échelle » / « zoom borné 25–200 % » sont
respectées (vérifié par assertions réelles).

---

## 4 · Validation exécutée (coquille + données fictives réelles)

### 4.1 Unités (Node) — commande : `node --test tests/*.test.mjs`
**147 tests / 0 FAIL** (coquille, layout, caméra gelée, dates, annuaire, documents…).

### 4.2 Responsive réel (Playwright, 7 viewports) — commande : `npm run test:responsive`
Tests navigateur **réels** par viewport (assertions / FAIL) :

| Viewport | Catégorie | Assertions | FAIL |
|---|---|---|---|
| desktop-1440 1440×900 | desktop | 47 | 0 |
| desktop-1024 1024×768 | desktop | 47 | 0 |
| tablet-760 760×900 | tactile | 47 | 0 |
| phablet-560 560×800 | tactile | 47 | 0 |
| mobile-390 390×844 | tactile | 47 | 0 |
| mobile-320 320×568 | tactile | 47 | 0 |
| landscape-844 844×390 | tactile | 52 | 0 |
| **TOTAL** | — | **334** | **0** |

Chaque viewport vérifie (assertions **réelles**, aucune sauvegarde) :

- **B1′ · Cadrage initial + géométrie des contrôles (données fictives)** :
  états de caméra **finis** (x/y/scale ≥ jamais NaN), échelle bornée **25–200 %**, **≥ 1 carte
  lisible** (largeur rendue ≥ 120 px), **première génération visible**, échelle ≥ **plancher ≈ 53 %**.
- **Interactions réelles** : boutons `+` (zoom++), `−` (retour ≈ initial), **Ajuster** = arbre complet
  calculé et **centre**, **Recentrer** conserve l'échelle, zoom affiché **synchrone** (« 25 % »).
- **Géométrie des contrôles** (chevauchennements interdits, dans le viewport, ≥ ≈44×44) :
  les 3 boutons d'action arbre, `.zoom-control`, `.view-control`, `.tree-controls` — **0 FAIL**.
- **B2 · Annuaire (coquille réelle + fiches fictives)** : sélecteur liste/cartes réel, passage
  Liste↔Cartes par clic réel, menu « Filtres » ouvert/refermé, saisie recherche « Personne »,
  aucune donnée réelle utilisée.
- **B3 · Modale personne** : contenue dans le viewport, bouton de fermeture, onglets
  « Identité/Liens familiaux » par clic réel, **saisie libre du lieu conservée** (GeoNames bloqué),
  message dégradé autocomplétion, liste suggestions vide, modale fermée par le bouton réel.

### 4.3 Firestore (emulateur) — commande : `npm run test:firestore` (JAVA Temurin 21)
**34 tests / 0 FAIL** — règles `firestore.rules` inchangées (jamais écrites).

---

## 5 · Points notables / documents

- Observations « densité desktop souris » (boutons actions 36 px) et « bouton fermeture modale
  ≈ 41,9 px » : **rapportées sans FAIL** (contrôles secondaires, densité souris/tactile documentée).
- Fermeture `safe-area` : ancrage `fixed` + `bottom:max(0.5rem, env(safe-area-inset-bottom))`
  garantit que les contrôles restent dans le viewport même sous navigateur mobile à encoche.
- Aucune modification des fixtures historiques (`tests/fixtures/v16/v17/v18`) ; aucun nœud de
  règles Firestore modifié ; aucun `firebase deploy/init/use/package.json` modifié.
- **Aucun commit/push/deploy** : conformément au protocole, le travail s'arrête à la validation
  (le §32 mandate d'arrêter après avoir fourni ce rapport, sans pousser).
