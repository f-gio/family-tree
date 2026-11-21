# Feuille de route technique — Lots 6B, 6C et 7 (6A → 7B)

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche / HEAD | `recette` @ `3d86111` |
| Source | `TECH_DEBT_AUDIT_6A.md` (46 candidats, mesures initiales) |
| Statut | **Plan uniquement — aucun nettoyage, aucune modularisation commencés** |

---

## 1. Ordre recommandé et dépendances entre les étapes

```
6B.1 (JS trivial) ─┐
6B.2 (CSS par composant) ─┼─► 6C (cartographie + outillage) ─► 6B.4 (duplication annuaire) ─► 6B.5 (photo)
6B.3 (assets) ────┘                                      └─► 7A (audit architecture) ─► 7B (modularisation)
```

- **6B.1 → 6B.3 en premier** : gains immédiats, risque faible, réduisent le périmètre que la cartographie 6C doit décrire.
- **6C avant 7A** : la cartographie et les commandes de tests ciblées sont les outils dont dépend l'audit d'architecture ; elles doivent être établies sur un code déjà purgé des orphelins.
- **6B.4 et 6B.5 après 6C** : ils exigent une décision (migrations de tests, sort des modules photographes) et des commandes de tests fiables.
- **7A avant 7B** : ne jamais modulariser sans cartographie préalable des responsabilités et des frontières de données.
- Chaque sous-lot est **indépendant et committé séparément** ; aucun n'est bloquant pour un autre sauf les dépendances ci-dessus.
- Les lots 5 (Démarches) et cette feuille de route sont clos : **ne pas rouvrir** les rapports 5A-5C.

## 2. Sous-lots proposés pour le lot 6B

### 6B.1 — JavaScript trivial (priorité 1, risque faible)

- **Périmètre** : candidats J-03, J-04, J-05 de l'audit (+ J-08 en option).
- **Fichiers** : `js/directory-advanced.js` (`directoryFilterGroups`), `js/directory-utils.js` (`directoryEventYear`), `js/genealogy-proofs.js` (`REFERENCE_STATES`), éventuellement les 21 mots-clés `export` superflus (annexe 5.6).
- **Justification** : définitions sans aucune consommation, démontré par recherche repo-wide (hors `docs/`) [audit §5.1].
- **Risques** : très faibles ; J-04 a une copie dans `tests/fixtures/v18/` qui **ne doit pas être modifiée** (figée).
- **Tests** : `node --check` des fichiers + `node --test tests/directory-filters.test.mjs tests/qa-70-cases.test.mjs tests/genealogy-model.test.mjs tests/genealogy-proofs.test.mjs`.
- **Critères d'acceptation** : plus aucune occurrence des symboles hors fixtures ; tests verts ; diff limité aux définitions.
- **Bénéfice** : −3 blocs morts, surface d'export réduite (J-08).

### 6B.2 — CSS orphelin par composant (priorité 2, risque faible à modéré)

- **Périmètre** : candidats C-01 → C-32, **un composant à la fois** (groupes A→F de l'audit §5.2) : page/shell, fiche Personne, documents/impression, détail Généalogie, atelier Transcription, divers.
- **Fichiers** : `css/design-system.css` uniquement.
- **Justification** : ~80 règles dont les classes sont absentes de `index.html` et de tous les `js/`, sans construction par interpolation [audit §5.2].
- **Risques** : régression visuelle (desktop/mobile), régression d'impression (groupes C), media queries (C-07). Classes à **confiance moyenne** : validation visuelle obligatoire avant suppression.
- **Tests** : `node --test tests/person-detail-page.test.mjs tests/person-dialog-actions.test.mjs tests/document-detail-page.test.mjs tests/interaction-language.test.mjs` + contrôle manuel : fiche Personne (desktop/mobile), visionneuse document, atelier transcription, **impression PDF du parcours**.
- **Critères d'acceptation** : aucun changement visuel constaté sur les parcours listés ; `git diff` limité à `design-system.css` ; un commit par groupe de composants.
- **Bénéfice** : −~80 règles, feuille de 7 954 lignes réduite, moindre risque d'effet de bord lors des futurs changements CSS.

### 6B.3 — Ressources statiques (priorité 3, risque faible)

- **Périmètre** : A-01 (8 PNG `avec-texte`), A-03 (`sans-texte-72/96`) ; A-02 (`planche-reference`, 1,6 Mo) **après confirmation explicite**.
- **Fichiers** : `La_Nostra_Storia_icons/`.
- **Justification** : zéro référence dans tout le dépôt ; les tailles 16/32/48/180 restent utilisées, 192/512 conservées pour la « PWA futur » documentée [audit §5.3].
- **Risques** : favicons/caches navigateur (contrôler après build local), usage externe non détectable pour la planche.
- **Tests** : `npm run build:recette` puis ouverture locale vérifiant favicon + apple-touch-icon ; aucun test unitaire ciblé.
- **Critères d'acceptation** : build vert ; favicons servis ; zéro référence résiduelle.
- **Bénéfice** : −~520 Ko (−2,1 Mo avec la planche), arborescence d'icônes cohérente.

### 6B.4 — Duplication annuaire + migration de tests (priorité 4, risque modéré)

- **Périmètre** : J-06 + J-07 + T-01.
- **Fichiers** : `js/directory-utils.js`, `js/directory-advanced.js`, `tests/qa-70-cases.test.mjs` (cas 21-24), `tests/genealogy-model.test.mjs:64-65`.
- **Justification** : deux `filterAndSortDirectory` distincts (legacy vs runtime), `normalizeDirectoryText` dupliqué à l'identique ; les tests legacy exercent des clés (`name`, `place`, `birthYear`) que le runtime n'envoie jamais → couverture non représentative [audit §5.1, §5.4].
- **Risques** : perte de couverture si la migration est bâclée ; divergences de comportement entre les deux implémentations (tri identique, filtres différents).
- **Étapes** : (1) migrer les cas 21-24 et le tri vers les clés de `directory-advanced.js` en conservant la sémantique attendue ; (2) vérifier que les assertions correspondent au comportement **runtime** ; (3) supprimer l'implémentation legacy et `normalizeDirectoryText` dupliqué en fusionnant sur une source unique.
- **Tests** : `node --test tests/qa-70-cases.test.mjs tests/genealogy-model.test.mjs tests/directory-filters.test.mjs`.
- **Critères d'acceptation** : une seule implémentation de tri/filtre ; les tests importent `directory-advanced.js` ; aucun test supprimé (seulement migré) ; verts.
- **Bénéfice** : suppression du double, couverture réelle du chemin de production, base saine pour 7A.

### 6B.5 — Modules photographes : décision (priorité 5, risque modéré)

- **Périmètre** : J-01 `photograph-storage.js`, J-02 `photograph-preview.js`, T-02 `tests/photograph-storage.test.mjs`, les 2 entrées d'import map correspondantes.
- **Justification** : jamais importés en runtime (graphe complet vérifié), mais documentés comme « fondation » du modèle sources (`docs/SOURCES_PREUVES_GENEALOGIQUES.md:96`).
- **Décision requise (avant toute suppression)** : confirmer que la persistance photo « immuable » n'est pas un jalon à venir, sinon **conserver**.
- **Risques** : réintroduire un besoin futur ; casser la couverture du modèle de documents.
- **Tests** : `node --test tests/photograph-storage.test.mjs tests/source-document-model.test.mjs` (après décision).
- **Critères d'acceptation** : décision tracée dans le commit ; si abandon : graphe d'imports inchangé côté runtime, tests retirés avec la même justification, import map mise à jour.
- **Bénéfice** : −294 lignes et 2 entrées d'import map si abandon ; sinon dette clarifiée.

### 6B.6 — Reportés (aucune suppression sans preuve)

- A-04 `vendor/pdfjs/` (6,4 Mo) : regénéré par le build mais lu au runtime et référencé par 3 tests — analyse dédiée du cycle build/dev avant décision.
- Classes des groupes E/F de l'audit (atelier, divers) dont l'apparence à l'écran n'est pas prouvée.
- **Règle** : confiance élevée ≠ risque faible ; tout élément incertain reste en place.

## 3. Objectifs du lot 6C — optimisation du contexte OpenCode

1. **Cartographie technique** (livrable) : schéma des modules `js/` (51), des flux de données (objet `refs` et accès Firestore dans `app.js`), des vues (arbre, annuaire, documents, garammes, tâches, atelier, modale personne, admin, sauvegarde) et des dépendances inter-modules — pour remplacer les explorations aléatoires.
2. **AGENTS.md plus efficace** (mise à jour, après 6B) : matrice de tests ciblés par zone (unitaire vs Playwright vs émulateur), procédure d'import map/version, ownership des fichiers volumineux, rappel des fixtures figées — sans répéter les rapports d'audit.
3. **Commandes de tests ciblées** : documenter les sous-ensembles rapides (62 tests unitaires sans Playwright ; `test:firestore` ≈ 78 tests/~40 s ; suites Playwright par zone) pour éviter les campagnes complètes ; éventuellement ajouter des scripts npm dédiés (décision à prendre, ce n'est pas fait).
4. **Versionnement de cache** : les 62 occurrences de `?v=` sont bumpées manuellement — proposer un script de stamp ou une convention, pour réduire l'erreur humaine à chaque publication.
5. **Bannières de section dans `app.js`** : 1 seule bannière pour 17 672 lignes — ajouter des séparateurs de macro-zones (sans déplacer de code) pour naviguer sans relire.
6. **Import map** : 51 entrées à maintenir en parallèle des imports — documenter la règle de mise à jour (et noter que `photograph-*` y sont en double avec 6B.5).
7. **Mesures de référence** : rejouer les mesures du §4 de l'audit 6A après 6B pour quantifier réellement (sans chiffrage artificiel) la réduction.

## 4. Préparation du lot 7A — audit d'architecture

1. **S'appuyer sur la cartographie 6C** : frontières réelles entre `app.js` et les modules purs existants (`tree-*`, `genealogy-*`, `directory-*`, `backup-*`).
2. **Inventaire de l'état global** : les ~272 écouteurs et l'état partagé dans `app.js` (listes `people/families/documents/tasks`, `genealogyRecords`, flags de vue) — identifier ce qui peut être encapsulé.
3. **Couche d'accès aux données** : regrouper les accès Firestore (objet `refs`, lectures de sauvegarde, abonnements) comme frontière candidate n°1.
4. **Vues et modales** : découper par vue (déjà une convention naturelle : `dossiersView`, `tasksView`… ont été supprimés avec Démarches — la même logique s'applique aux vues restantes).
5. **Livrable 7A** : diagnostic par zone (fichier, responsabilités, dépendances, risque), ordre de extraction proposé, et critères de non-régression par zone — sans modifier le code.
6. **Réutiliser les garde-fous existants** : tests par zone déjà identifiés dans `AGENTS.md` (tableau des suites), fixtures figées, garde anti-production.

## 5. Principes de modularisation du lot 7B

1. **Extraire d'abord le pur** : suivre le modèle qui a déjà fait ses preuves (`genealogy-date.js`, `tree-model.js`, `directory-advanced.js`) — modules sans `document`/`window` à l'import, testables en Node pur.
2. **Un pas = un commit = un sous-lot** : extraction d'une seule responsabilité à la fois, aucun renommage simultané, aucun changement de comportement.
3. **Porte de sortie systématique** : `node --check` + tests de la zone + tests d'invariants concernés avant commit ; rollback simple (un commit = un revert).
4. **Ne pas toucher aux règles Firebase, aux fixtures ni aux données** dans les mêmes commits que des extractions.
5. **L'import map et la version `?v=`** doivent être mises à jour dans le même commit que tout nouveau fichier JS.
6. **Ordre d'extraction proposé** (à confirmer par 7A) : (1) couche d'accès Firestore, (2) vues restantes une par une, (3) modales, (4) sauvegarde/restauration (déjà partiellement modulaire : `backup-*`), (5) éditorial UI restant.
7. **Éviter le big-bang** : ne jamais déplacer plus d'une responsabilité majeure par lot ; `app.js` reste le point d'entrée tant que ses dépendances ne sont pas réduites.
8. **Conservation des points d'entrée** : `index.html` continue de charger `form-ui.js` + `app.js` ; tout nouveau module doit figurer dans l'import map.

## 6. Risques principaux (transverses)

| Risque | Étapes concernées | Atténuation |
|---|---|---|
| Régression visuelle d'une classe CSS réellement dynamique | 6B.2 | Validation visuelle + impression par composant, un composant par commit |
| Perte de couverture en migrant les tests legacy | 6B.4 | Migrer (jamais supprimer) les cas, comparer les comportements avant/après |
| Suppression d'une ressource encore voulue (planche, photo, PWA) | 6B.3, 6B.5 | Confirmation explicite avant suppression ; conserver si doute |
| Désynchronisation import map / version `?v=` | 6C, 7B | Procédure documentée dans AGENTS.md, vérification post-commit |
| Fixtures historiques modifiées par erreur | tous | Ne jamais toucher `tests/fixtures/*` ; rappel dans AGENTS.md |
| Conflits de fusion sur `app.js` pendant 7B | 7B | Sous-lots courts, une extraction par commit, pas de refactor global |
| Faux sentiment de sécurité (tests verts mais couverture décalée) | 6B.4, 7A | Vérifier que les tests importent l'implémentation runtime |

## 7. Dépendances entre les étapes (résumé)

- **6B.1/6B.2/6B.3** : indépendants entre eux, peuvent être menés en parallèle de la préparation 6C.
- **6C** : nécessite les purges rapides (6B.1-3) pour une cartographie stable ; fournit les commandes ciblées utilisées par 6B.4/6B.5 et 7A.
- **6B.4** : nécessite les commandes de tests de 6C (migration) ; bloque la confiance dans les tests d'annuaire pour 7A.
- **6B.5** : décision produit indépendante, mais impacte l'import map documentée en 6C.
- **7A** : nécessite 6C (cartographie) et, idéalement, 6B.4 (couverture fiable).
- **7B** : nécessite 7A (plan d'extraction) ; chaque extraction réutilise les critères de 6B (un pas, un commit, tests ciblés).

## 8. Suivi recommandé

1. Ouvrir le lot 6B.1 avec le périmètre exact de l'audit 6A (§5.1, J-03/J-04/J-05).
2. Après chaque sous-lot : rejouer les mesures du §4 de l'audit pour la traçabilité.
3. Ne pas commencer 7A tant que la cartographie 6C n'est pas livrée.

---

*Plan du lot 6A. Aucun nettoyage, aucune modification de code, test, configuration ou asset n'a été effectué.*
