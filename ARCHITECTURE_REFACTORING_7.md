# Rapport architectural — Lot 7 : audit et extractions sûres

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche / base | `recette` @ `68bf367` (après lots 1→6) |
| Jeton assets | `26-module-extractions-20261121-1` (bump `npm run bump:assets`) |
| Résultat | **2 modules +1 feuille CSS créés,4 extractions réalisées,1 correction responsive — aucun changement de comportement visible** |

---

## 1. Architecture initiale [V]

- **`js/app.js` :17 672 lignes /≈1 Mo** —712 fonctions de premier niveau,272 variables d'état partagées,48 imports, ~272 écouteurs ; points d'entrée `index.html` → `form-ui.js` + `app.js`.
- **`css/design-system.css` :7 804 lignes** — feuille unique (aucun `@import`), chargée par un seul `<link>` ;30+ tests lisent son contenu par assertions statiques.
- **`index.html` :890 lignes** — import map (49 entrées), sprite SVG, markup de toutes les vues.
- Blocs déjà modulaires (modèle éprouvé) : `tree-*`, `genealogy-*`, `directory-*`, `backup-*`, `transcription-draft-*`.
- Contrats : comparaison octet `final-qa` vs fixture v18 (`tree-camera`, `tree-layout`, `family-relations`, `directory-utils`, `document-utils`), fixtures v16-v18 intouchables.

## 2. Problèmes principaux identifiés [V]

1. **Génération de markup imprimé encastrée dans `app.js`** :9 fonctions (~144 lignes) couplées à l'état global `people`/`families` malgré un rôle pur (assemblage de chaînes).
2. **Persistances localStorage de l'atelier dans `app.js`** :83 lignes de marqueurs de synchronisation alors que le module `transcription-draft-storage.js` existe précisément pour cela (et impose l'injection du storage : test `transcription-workshop.test.mjs:815` — « ni DOM ni fenêtre »).
3. **Helpers de présentation partagés (`esc`, `personInitials`, `relationRole`) privés de `app.js`** : impossibilité d'extraire le gabarit d'impression sans cycle d'imports.
4. **Styles d'impression mélangés à la feuille générale** :100 lignes `.print-*` + `@media print` au milieu des styles d'écran, non isolables test par test.
5. **Bug réel de centrage de l'arbre** : double plancher d'échelle (`minScale` caméra =0,1 vs plancher visible0,25) → `zoomBy` autour du centre du **rect** (bordures) après un `centerForScale` sur le centre **client** → décalage (−1,5 ; −1,734) px à390 px.
6. **Couplage tests ↔ emplacement du code** : `person-print` greffait ~15 assertions sur le contenu de `app.js`/`design-system.css` (migration nécessaire et faite à chaque mouvement).

## 3. Extractions retenues et raisons

| # | Exstraction | Bénéfice | Complexité | Risque | Pourquoi retenu |
|---|---|---|---|---|---|
| E1 | `esc`, `personInitials`, `relationRole` → `ui-components.js` | Débloque toute extraction de markup ;1 endroit pour les helpers d'affichage | Faible | Faible | Aucun test ne greffe leur définition ; `ui-components` déjà importé partout (pas de cycle) |
| E2 | Gabarit imprimé → `js/person-print-sheet.js` (9 fonctions) | −144 lignes d'`app.js`, responsabilité document unique, testable en Node pur | Moyenne | Modéré | 100 % du bloc est pur (0 état,0 DOM,0 Firestore) ; seul `person-print.test.mjs` le greffait (migration faites : mêmes regex, nouvelle cible) |
| E3 | Marqueurs de synchronisation draft → `transcription-draft-storage.js` | −83 lignes d'`app.js`, la persistance locale rejoint son module | Moyenne | Modéré | Contrat du module respecté par **injection du storage en 1ᵉʳ paramètre** (API déjà existante `readTranscriptionDraft(storage, …)`) ;16 sites d'appel adaptés ; zéro test ne les greffait |
| E4 | Bloc impression → `css/print-sheet.css` (100 lignes) | Feuille d'impression isolée, cascade vérifiable | Faible | Modéré | **Preuve de sécurité** : accolades équilibrées (59/59),0 sélecteur partagé avec le reste de `design-system.css` (vérifié programmatiquement), chargée APRÈS la feuille générale → ordre de cascade strictement préservé ; seul `personPrintDialog:5719` reste dans la feuille générale (media query mobile) |
| E5 | Correction responsive « Ajuster » | Centrage exact à tous les viewports | Faible | Faible | Correction **dans le wrapper `app.js`** (`camera.recenter()` après la remontée à0,25) — `tree-camera.js` (gelé) intact ; tolérance du test inchangée |

Chaque extraction : `node --check` + tests de la zone immédiatement, avant de continuer.

## 4. Extractions écartées et risques

| Candidat | Motif d'écart |
|---|---|
| **Couche d'accès Firestore** (`refs`, abonnements, sauvegarde) |272 états partagés couplés à l'auth et aux vues ; frontière non démontrable sans réécriture des abonnements — risque disproportionné pour une seule intervention |
| **Vues et modales restantes** (annuaire, personne, documents pilotés par `app.js`) | état DOM + Firestore + navigation entremêlés ; chaque vue dépend de dizaines de variables globales |
| **Pilotage de l'atelier de transcription** (178 fonctions /68 états) | le plus gros bloc, mais le plus couplé (remote, drafts, menu, clavier virtuel) |
| **CSS au-delà de l'impression** |30+ tests lisent `design-system.css` ; extraire un autre groupe exigerait de re-pointer leurs greffes ET de prouver l'absence de conflit de cascade pour chaque media query — non sécurisable dans ce lot sans churn disproportionné |
| **Accéssieur `window.localStorage` dans le module draft** | **écarté puis réécrit** : contrat explicite `transcription-workshop.test.mjs:815` (« stockage injecté ») — l'injection en paramètre l'a résolu sans affaiblir le test |
| **Duplication `directory-utils`/`directory-advanced`** | gel `final-qa` (comparaison octet vs fixture v18) |
| **`tree-camera.js`** (centrage) | gelé ; la correction est portée par le wrapper applicatif |

## 5. Modules créés et responsabilités

| Fichier | Lignes | Responsabilité | Exports |
|---|---|---|---|
| `js/person-print-sheet.js` |154 | Assemblage en lecture seule de la fiche imprimable (markup A4 + écran), sans état global ni écriture | `buildPersonPrintSheet` +8 formateurs (`printPlaceDetail`, `printFiliationLabel`, `printLifeEvent`, `printLifePeriod`, `printModificationDate`, `printYear`, `printLifeSpan`, `printFullName`) |
| `css/print-sheet.css` |105 | Toutes les règles `.print-*`, `#printPortal`, `body.is-printing-person`, `@media print` (A4) et preview mobile | — (feuille chargée après `design-system.css`) |

Extensions de modules existants : `ui-components.js` (+`esc`, `personInitials`, `relationRole`), `transcription-draft-storage.js` (+accesseur non — restitué à `app.js` ; +2 préfixes,2 formateurs de clés,4 lectures/écritures de marqueurs,1 `ensure…`, tous avec `storage` injecté).

## 6. Évolution des dépendances

```
app.js ──► ui-components.js            (+ esc, personInitials, relationRole)
app.js ──► person-print-sheet.js       (nouveau) ──► ui-components, genealogy-date,
                                                     directory-utils, family-relations,
                                                     place-format
app.js ──► transcription-draft-storage.js (+4 noms ; storage injecté à16 sites)
index.html: import map49 →50 entrées ; +1 <link> print-sheet.css (après design-system)
```

- **Aucun cycle** : les modules n'importent jamais `app.js` (vérifié) ; `person-print-sheet` est une feuille de dépendances vers des modules purs existants.
- **Aucun nouvel état global** ; l'ordre d'initialisation et les hooks de test (`window.__personPrint`, `window.__treeProbe`) sont préservés (le hook `build` enveloppe désormais l'appel avec les jeux `people/families`).
- Jeton unique `?v=` sur les62 occurrences (bump déterministe), `check:assets` vert.

## 7. Réduction réelle

| Fichier | Avant | Après | Écart |
|---|---|---|---|
| `js/app.js` |17 672 lignes | **17 446** | **−226 lignes** |
| `css/design-system.css` |7 804 lignes | **7 704** | **−100 lignes** |
| Nouveaux fichiers | — |154 +105 lignes | (déplacement, pas de duplication : le code déplacé n'existe plus dans l'origine — vérifié par les tests statiques migrés) |

Modifications d'accompagnement : `ui-components` +19 lignes, `transcription-draft-storage` +72 lignes, `index.html` +2 lignes (import map + lien), tests `person-print` et `family-links-ui` : re-pointage des cibles statiques (mêmes regex, mêmes intentions — aucun test affaibli, aucune assertion supprimée).

## 8. Résultats des tests et contrôles visuels

| Contrôle | Commande / fichiers | Résultat |
|---|---|---|
| Syntaxe | `node --check` (app, ui-components, person-print-sheet, transcription-draft-storage) | **OK** |
| Unit complet (×3, dont après chaque mouvement) | `npm run test:unit` | **583/583** |
| Impression | `node --test tests/person-print.test.mjs` (+ `page-headings`) | **19/19** puis **22/22** (statique + navigateur Chromium/WebKit, émulation `@media print` : portail visible, dialog masqué, afterprint) |
| Famille liens/fiches | dans `test:unit` (`family-links-ui` migré) | **vert** |
| Drafts | `transcription-draft-storage` + `-sync` + `-remote` | **33/33** |
| Atelier + interactions | `transcription-workshop` + `person-dialog-actions` + `document-viewer-mobile` | **68/68** (dont contrat de pureté du module de stockage, hooks `__personPrint`, règle `personPrintDialog`) |
| Arbre (impact du fit) | `tree-fullscreen`, `tree-landscape-scroll`, `tree-menu-layout` | **17/17** |
| Arbre (suite) | `tree-directory-responsive`, `tree-selector`, `tree-card-alignment` | **24/24** |
| Cache & artefact | `hosting-cache` + `asset-release` + `check:assets` | **10/10**, jeton `26-module-extractions-20261121-1` cohérent (61 refs + meta) |
| **Responsive réel** | `npm run test:responsive` | **SUCCÈS —7 viewports,≈500 assertions,0 FAIL** (dont mobile-390) |
| Build recette | `npm run build:recette` | **260/260 ressources**,8 747 797 octets, jeton conforme |
| Build production (local, non déployé) | `npm run build:production` | **OK,264 fichiers**, fichiers nouveaux présents,2 liens CSS |
| Démarrage applicatif | capture `pageerror` au chargement | **aucune erreur JS** |
| Diff | `git diff --check` | **OK** |

Aucune suite n'a été désactivée ni assouplie ; les mouvements ont été validés zone par zone avant de continuer.

## 9. État du problème responsive à 390 px — RÉSOLU

**Cause réelle (mesurée, pas supposée)** :
1. La caméra est créée avec `minScale: 0.1` (`app.js`), le plancher visible étant `0.25`.
2. Fit brut <0,1 à390 px (0,077) → `camera.fit()` sort à0,1 ; le wrapper remonte à0,25 par `zoomBy`, qui zoome **autour du centre du `getBoundingClientRect()`** (rect = client +2 px en largeur, +2,3125 px en hauteur à390 px), alors que le fit avait recentré sur le centre **client**.
3. Décalage = (1 −0,25/0,1) × écart des centres = −1,5 × (1 ;1,15625) = **(−1,5 ; −1,734) px** → x exactement à la tolérance (passe), y =1,734 >1,5 (échec). À320 px les écarts rect/client valent (1 ;1) → (−1,5 ; −1,5) → passe à la limite. **Reproduit à l'identique sur `18cf250` dans un worktree détaché** (preuve de préexistence).

**Correction** (dans le wrapper applicatif, `tree-camera.js` inchangé) : après la remontée d'échelle, `camera.recenter()` recentre exactement à l'échelle cible → l'état final égale la formule d'attente au bit près (**delta0/0 mesuré** aux viewports390 et320).

**Non-régression** : la tolérance du test (`1,5 px`) et ses assertions sont **inchangées** ; `npm run test:responsive` est passé de « ÉCHEC (1 FAIL mobile-390) » à **SUCCÈS intégral**. Aucun test n'a été modifié pour cette correction.

## 10. Dette architecturale résiduelle

1. `app.js` reste à17 446 lignes : couche Firestore, vues, modales et pilotage d'atelier non extraits (cf. §4 — frontières à démontrer avant tout mouvement).
2. Couplage tests ↔ fichiers sources : les greffes statiques (`person-print`, `family-links-ui`, `transcription-workshop`, `final-qa`…) suivent le code à chaque déplacement — coût réel mais aussi filet de sécurité.
3. Double plancher d'échelle caméra (0,1 /0,25) subsiste : compensé par le wrapper ; simplifier demanderait de revoir `minScale` (gelé) et la capacité de zoom manuel bas — non entrepris.
4. Duplication `directory-utils`/`directory-advanced` : gel `final-qa`.
5. Deux feuilles CSS au lieu d'une : l'ordre des `<link>` est maintenant un contrat (ne pas insérer de feuille entre `design-system.css` et `print-sheet.css` sans analyse de cascade).
6. `AGENTS.md`/chiffres d'époque («51 modules », «~17 670 lignes ») légèrement en retard sur l'état réel — à rafraîchir au prochain lot de documentation.

## 11. Recommandations de maintenance

1. **Prochaine frontière prioritaire** : la couche d'accès données (`refs`, abonnements, lectures de sauvegarde`) — la seule dont les dépendances sont identifiées (§2.1 du roadmap7A), à traiter avec les tests `backup-*` + `firestore-emulator` comme portes de sortie.
2. Continuer le modèle « module pur + injection » (storage, datasets, scope) : c'est ce qui a rendu E2/E3 sûrs.
3. Pour tout futur déplacement : rejouer d'abord les tests statiques concernés (`--filter` de la zone) — leur migration est un signal, pas un obstacle.
4. Ne pas ajouter de feuille CSS sans re-vérifier l'absence de conflit de sélecteurs avec `design-system.css` (méthode scriptée du §3, réutilisable).
5. Maintenir `bump:assets` + build + `asset-release` dans le même lot que tout changement de fichier livré.

---

*Lot7 : aucune règle Firebase, aucune donnée, aucune fixture, aucun fichier gelé, aucune dépendance npm modifiée ; aucun déploiement production.*
