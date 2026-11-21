# Nettoyage ciblé du JavaScript inutilisé — Lot 6B.1

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche / HEAD initial | `recette` @ `d56b3cf` (working tree propre avant lot) |
| Périmètre | Candidats JS « faible risque » du rapport 6A — aucun autre domaine touché |
| Résultat | **2 définitions supprimées,1 candidat conservé pour gel de module,1 groupe optionnel conservé** |

## 1. Candidats examinés

### Candidats prioritaires (§1 de la mission)

| ID | Élément | Emplacement vérifié | Vérifications effectuées | Décision |
|---|---|---|---|---|
| J-03 | `directoryFilterGroups` | `js/directory-advanced.js:152-164` (avant suppression) | 0 référence hors définition (repo hors `docs/` et rapports) ; aucun import de ce symbole depuis `app.js`, les tests ou scripts ; aucun `import * as` dans le dépôt ; aucun accès `window`/`globalThis` ; aucun accès par chaîne/reflection ; aucun bloc `export { … }` ; module non protégé par un comparateur de fixture | **Supprimé** |
| J-04 | `directoryEventYear` | `js/directory-utils.js:21-25` | Inutilisation confirmée (0 usage interne et externe, hors copie figée) — **mais** le module est gelé (voir §3) | **Conservé** |
| J-05 | `REFERENCE_STATES` | `js/genealogy-proofs.js:10` | 0 référence hors définition ; `tests/genealogy-proofs.test.mjs` (bloc d'import multi-lignes lu intégralement) ne l'importe pas ; aucun usage interne dans `genealogy-proofs.js` ; module non protégé par un comparateur de fixture | **Supprimé** |

### Autres candidats JS classés « faible risque » en 6A (§1 : examen autorisé)

| ID | Élément | Examen | Décision |
|---|---|---|---|
| J-08 | 21 mots-clés `export` superflus (annexe 5.6 du rapport 6A) | Revérification fraîche des 21 symboles : usage **interne uniquement** confirmé pour les 21, **0 consommateur externe** (js/tests/scripts/index.html), aucun `import * as` dans le dépôt, seul un bloc `export { REASON_CODES as TRANSFER_DIAGNOSTIC_REASON_CODES }` existe (symbole hors liste). **Toutefois** : `family-relations.js` (3 symboles concernés) et `genealogy-date.js` (1 symbole) figurent dans les contrats de non-régression de `tests/final-qa.test.mjs:21-30` — le retrait casserait la comparaison octet / le contrat additif des 7 types de dates ; le bénéfice est purement cosmétique (retrait d'un mot-clé, ni gain de charge ni changement de comportement, modules ES natifs sans bundler) ; les `export` restent conformes à la convention AGENTS.md selon laquelle les tests importent les modules purs directement | **Conservé** (indépendant mais sans bénéfice suffisant au regard des contrats de gel) |

### Exclus par la mission (§1) — non traités

`photograph-storage.js`, `photograph-preview.js`, les deux implémentations de `filterAndSortDirectory`, les tests legacy de l'annuaire, les composants CSS, les ressources statiques, les dépendances npm, toute modularisation de `app.js`.

## 2. Éléments supprimés

1. **`export const directoryFilterGroups = […]`** — table de groupes de filtres de l'annuaire (3 groupes : Identité, Naissance, Décès) définie en fin de `js/directory-advanced.js`, sans aucun consommateur (runtime comme tests).
2. **`export const REFERENCE_STATES = Object.freeze([…])`** — liste d'états de référence (6 valeurs) en tête de `js/genealogy-proofs.js`, sans aucun consommateur ni usage interne.

Aucun import devenu inutile : les imports de `directory-advanced.js` (`genealogy-date`, `person-name-variants`, `tree-model`) et de `genealogy-proofs.js` restent tous utilisés par les fonctions conservées. Aucune fonction publique utilisée n'a été touchée ; aucun renommage, aucune réorganisation.

## 3. Éléments conservés et raisons

- **`directoryEventYear` (J-04) — conservé pour gel de module.** L'inutilisation est démontrée, mais `js/directory-utils.js` fait partie des modules cœur **comparés octet à octet** à la fixture historique `tests/fixtures/v18/js/directory-utils.js` par `tests/final-qa.test.mjs:21-24` (« … ne devait pas changer »), conformément à AGENTS.md (« treat the JS files as frozen if the tests are expected to pass »). Toute modification de ce fichier ferait échouer ce test et nécessiterait de modifier le contrat de gel ou la fixture — explicitement hors du périmètre « faible risque » de ce lot et interdit sans justification explicite (AGENTS.md : la modification d'une fixture historique n'est jamais justifiée par un test qui échoue).
  - *Observation factuelle* : AGENTS.md cite aussi `interaction-language.test.mjs` et `responsive-accessibility.test.mjs` comme comparateurs ; ces deux fichiers ne référencent plus aucune fixture — seul `final-qa.test.mjs` porte effectivement la comparaison.
  - *Suite recommandée (hors 6B.1)* : lot dédié avec décision explicite — soit conserver le gel, soit remplacer le comparateur octet par un test de comportement du module, soit retirer `directory-utils.js` de la liste avec justification tracée.
- **J-08 (21 exports) — conservé** (raisons détaillées au §1).
- **Tout le reste du périmètre §1** : exclu par la mission, non examiné pour suppression.

## 4. Fichiers modifiés

| Fichier | Modification |
|---|---|
| `js/directory-advanced.js` | Suppression du bloc `directoryFilterGroups` (fin de fichier) |
| `js/genealogy-proofs.js` | Suppression de la ligne `REFERENCE_STATES` |
| `index.html` | Bump du jeton de cache (voir §7) |
| `TECH_DEBT_CLEANUP_6B1.md` | Présent rapport |

Aucun autre fichier du dépôt modifié (`git status` limité à ces4 entrées). `js/directory-utils.js` a été examiné puis **restauré à l'identique** (diff vide) après découverte du gel.

## 5. Lignes retirées

| Fichier | Insertions | Suppressions |
|---|---:|---:|
| `js/directory-advanced.js` | 0 | **14** (bloc de13 lignes +1 ligne vide) |
| `js/genealogy-proofs.js` | 0 | **1** |
| `index.html` | 62 | 62 (remplacements de jeton de version, sans perte de ligne) |
| **Total JS retiré** | — | **15 lignes** |

## 6. Tests exécutés et résultats

Cibles choisies à partir des fichiers réellement modifiés (convention AGENTS.md niveau 1 : `node --check` + tests homonymes) :

| Contrôle | Commande / fichier | Résultat |
|---|---|---|
| Syntaxe | `node --check js/directory-advanced.js js/genealogy-proofs.js` | **OK** |
| Homonymes du module annuaire | `tests/directory-filters.test.mjs` | **Vert** |
| Homonymes du module preuves | `tests/genealogy-proofs.test.mjs`, `tests/genealogy-proof-form.test.mjs` | **Verts** |
| Module `directory-utils.js` inchangé (legacy) | `tests/qa-70-cases.test.mjs`, `tests/genealogy-model.test.mjs` | **Verts** |
| Gel fixture + invariants | `tests/final-qa.test.mjs` (comparaison octet v18, invariants Firestore, boutons, IDs) | **Vert** |
| Convention de version | `tests/hosting-cache.test.mjs` (uniformité du jeton, graphes de modules, comportement navigateur) | **Vert** |
| **Agrégat** | `node --test` des7 fichiers ci-dessus | **80 tests,80 réussis,0 échec,0 ignoré** |
| Diff | `git diff --check` | **OK** |

Les tests Playwright de `hosting-cache.test.mjs` ont été exécutés (0 ignoré). Aucune suite n'a été désactivée, aucun test modifié, aucune campagne complète lancée. `npm run test:firestore` non requis : `firestore.rules` est inchangé.

## 7. Impact sur le build et le cache

### Jeton de version (bump)

- Convention du dépôt : **un jeton unique** porté par le `<meta name="asset-release">` (ligne10) et par les61 références `?v=` locales ; `tests/hosting-cache.test.mjs:35-66` échoue si une seule ressource porte un jeton différent — un bump partiel est donc **impossible**, le bump global est le comportement exigé par le dépôt (et prescrit par le commentaire `index.html:14` : « Bumper asset-release à chaque publication »).
- **`23-zone-pdf-rerender-20261121-1` → `24-unused-definitions-20261121-1`** :62 occurrences remplacées dans `index.html` (1 meta +61 `?v=`),0 occurrence de l'ancien jeton résiduelle.
- Les scripts de build ne gèrent pas le jeton (vérifié) ; seuls `index.html` et, à titre historique, `TECH_DEBT_AUDIT_6A.md` contenaient l'ancien littéral (le rapport 6A décrit l'état daté, il n'est pas modifié).

### Build de contrôle

- `npm run build:recette` : **exit0**, artefact `dist-recette/` régénéré — **258/258 ressources servies en local**,8 578 994 octets (8 573,2 Kio), exclusions de sécurité vérifiées (tests, scripts, Markdown, règles, `package.json`).
- Contrôle de l'artefact : `dist-recette/index.html` porte le nouveau meta ; `dist-recette/js/directory-advanced.js` ne contient plus `directoryFilterGroups` ; `dist-recette/js/genealogy-proofs.js` ne contient plus `REFERENCE_STATES` ; aucun jeton ancien dans l'artefact.
- `dist-recette/` reste ignoré par Git.

### Déploiement

Déploiement **Hosting Recette uniquement** effectué après le commit/push, conformément au §7 de la mission : `firebase deploy --only hosting --project la-nostra-storia-recette` (projet explicite — jamais l'alias `default` de `.firebaserc`, jamais la production, jamais les règles). La vérification du contenu servi (meta de version + absence des symboles supprimés) est consignée dans la synthèse finale.

## 8. Risques résiduels

1. **Aucun risque résiduel sur les deux suppressions** : inutilisation démontrée par plusieurs méthodes concordantes (références directes, imports/exports, HTML, dynamique, namespace, `window`/`globalThis`, tests, scripts) ; les fichiers concernés ne sont protégés par aucun comparateur de fixture ; syntaxe et80 tests verts.
2. **`directoryEventYear` toujours présent** (gel fixture) — dette documentée, à traiter en lot dédié (§3).
3. **J-08 toujours présent** (contrats `final-qa` + bénéfice cosmétique) — à réexaminer lors de la redéfinition des frontières de modules (lots6C/7).
4. La version recette n'est serveuse du nouveau contenu qu'après le déploiement Hosting (étape §7 de la mission) ; un retour arrière se ferait par republier l'artefact précédent — non nécessaire ici (suppression sans effet de comportement).

## 9. État final (au moment de la rédaction)

- `git status` : `index.html`, `js/directory-advanced.js`, `js/genealogy-proofs.js` modifiés + présent rapport à créer ; working tree sinon propre ; branche `recette` @ `d56b3cf`.
- Aucune règle Firestore, donnée, configuration, dépendance, asset, test, fixture ou rapport du lot6A modifié.
- Aucun accès à un projet Firebase distant pour ce lot (les contrôles sont locaux) ; le déploiement Hosting Recette est la seule opération distante prévue, à effectuer après le commit.

---

*Lot 6B.1 : nettoyage JavaScript ciblé. Aucun test modifié, aucune fixture touchée, aucun autre domaine du périmètre6A traité.*
