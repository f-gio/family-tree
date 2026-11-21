# Optimisation des workflows OpenCode et du versionnement des assets — Lot 6C

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche / HEAD initial | `recette` @ `36d25db` (working tree propre avant lot) |
| Références | `AGENTS.md`, rapports `TECH_DEBT_*_6A/6B_7/6B1` |
| Résultat | **2 scripts +1 test +2 documents créés, `AGENTS.md` resserré,4 commandes ajoutées — aucun module métier modifié** |
| Déploiement | **Non requis** (aucun fichier livré modifié — justification §11) |

## 1. Problèmes initiaux constatés [V]

1. `AGENTS.md` (107 lignes) : tableau de tests long mais incomplet, pas de stratégie de recherche ciblée, pas de convention de versionnement des assets, affirmation **fausse** selon laquelle `interaction-language` et `responsive-accessibility` comparent les modules cœur aux fixtures (seul `final-qa.test.mjs` le fait), mention d'un « no package.json » alors que le manifeste porte des scripts, référence à un déploiement GitHub Pages de l'app (Pages ne sert qu'une redirection).
2. Versionnement manuel : **62 occurrences** du jeton `?v=` dans `index.html` à éditer à la main, sous peine d'échec de `hosting-cache.test.mjs` (unicité du jeton) et de mélange de graphe de modules.
3. Aucune commande de sous-ensemble de tests : parmi **109 fichiers de test**, impossible de lancer « la famille rapide » sans en choisir les fichiers un par un ; aucune cartographie fonctionnalité → fichiers → tests.
4. Contrats historiques disséminés (fixtures, comparaison octet, gel de `directory-utils`) et non centralisés — d'où des risques de suppression hasardeuse (cf. conflit découvert en 6B.1 avec `directoryEventYear`).

## 2. Modifications apportées

| Fichier | Action | Nature |
|---|---|---|
| `scripts/bump-asset-release.mjs` | créé | Bump/vérification déterministe du jeton (aucune dépendance) |
| `scripts/run-tests.mjs` | créé | Sélecteur de familles `unit`/`browser` + `--filter` + `--list` |
| `tests/asset-release.test.mjs` | créé | Contrat du jeton : source, artefact, comportement du script |
| `package.json` | modifié | +4 scripts : `test:unit`, `test:browser`, `check:assets`, `bump:assets` (dépendances inchangées) |
| `AGENTS.md` | réécrit |107 → **87 lignes**,10/10 bullets de sécurité conservés verbatim |
| `docs/TECHNICAL_MAP.md` | créé | Carte technique (§4) |
| `docs/TEST_MATRIX.md` | créé | Matrice de tests (§4) |
| `TECH_DEBT_OPTIMIZATION_6C.md` | créé | Présent rapport |

**Aucun module `js/` métier modifié** (vérifié par `git diff --name-only`) : `directoryEventYear` et les21 exports historiques sont intacts ; fixtures, règles Firebase, données, configurations et dépendances inchangés.

## 3. Structure finale de `AGENTS.md` (87 lignes)

12 sections, dans l'ordre : **Production Data Safety** (bullets conservés mot pour mot) · Layout & entrypoints · Backend constraints (Spark) · Data-model legacy compatibility · Style conventions · **Environnements et interdictions Firebase** (3 projets, `.firebaserc` = production, `--project` obligatoire, déploiements autorisés) · **Git et livraison** (interdits, vérification `merge-base`, indexation explicite, aucun push sans autorisation) · **Recherche ciblée** (partir de la carte, exclusions de scan, preuves d'inutilisation requises) · **Modification minimale** (périmètre, contrats, fixtures, `#icon-procedures`) · **Tests (sélection)** (résumé + niveaux 1/2/3, pointeur vers la matrice) · **Build et version des assets** (artefacts, jeton, `check:assets`/`bump:assets`) · **Arrêt obligatoire** (8 conditions de blocage).

Les détails vivent désormais dans `docs/TECHNICAL_MAP.md`, `docs/TEST_MATRIX.md` et `DEMARCHES_RULES.md` — aucune consigne n'est dupliquée entre ces fichiers.

## 4. Cartographie et matrice créées

- **`docs/TECHNICAL_MAP.md`** : ossature (points d'entrée, import map, builds, publications, Firestore) ; **12 domaines** (personnes, annuaire, arbre, parcours, documents/preuves, sources, visionneuses, transcription, auth, persistance, import/export, interfaces) chacun avec entrée / modules / dépendances / tests / précautions ; section **contrats historiques** (comparaison octet `final-qa` vs v18 sur `tree-camera`, `tree-layout`, `family-relations`, `directory-utils`, `document-utils` ; contrat additif de `genealogy-date` ; fixtures ; icône partagée ; URL `?view=dossiers`) ; section hypothèses `[H]` distincte des faits `[V]`.
- **`docs/TEST_MATRIX.md`** : table des9+ commandes avec portée/préparation/mesures ; matrice **zone → fichiers source → tests → commandes** (13 zones) ; pièges par famille (émulateur, suites à options, fixtures) ; sélection recommandée par type de changement.

## 5. Commandes de tests disponibles

| Commande | Portée | Résultat mesuré |
|---|---|---|
| `npm run test:unit [-- --filter <texte>]` |57 fichiers sans Playwright (+filtre par nom) | **594 tests / 0 échec / ≈3 s** ; `--filter navigation` =14 tests /0,1 s |
| `npm run test:browser [-- --filter <texte>]` |52 fichiers Playwright (ex. `person` →7, `transcription` →5) | liste vérifiée ; exécution complète non chronométrée dans ce lot |
| `npm run test:firestore` |78 tests, émulateur local `family-tree-emulator-test` | inchangée (historique :25–40 s) |
| `npm run check:assets` | cohérence des62 occurrences du jeton | OK (instantané) |
| `npm run bump:assets -- <jeton>` | bump déterministe | testé sur copie (§6) |
| `node --test tests/<fichier>` / `node --test tests/` | un fichier / campagne complète | inchangées |
| `npm run build:recette` / `build:production` | artefacts locaux | §8 |

Le script propage le code de sortie du sous-processus (`spawnSync` sans shell — Windows-compatible) et n'accède jamais à Firebase ; `package.json` ne contient toujours que les4 dépendances d'origine.

## 6. Solution de versionnement retenue

**Retenu : script déterministe de bump sur la source** (`scripts/bump-asset-release.mjs`), source de vérité unique = la meta `asset-release`.

- `--check` : vérifie meta présente, format `<séquence>-<slug>-<AAAAMMJJ>-<révision>`, et que **toutes** les références `?v=` portent la même valeur — code0/1.
- `<jeton>` : remplace l'ancien jeton (meta + toutes les références) d'une traite, avec vérifications de comptage après transformation ; refuse un format invalide ou un jeton identique.
- **Déterminisme** : aucun horodatage ni valeur aléatoire (le jeton est fourni, conforme à la convention existante).

**Alternative évaluée puis écartée** : génération du jeton à la construction dans `dist-*`. Rejetée parce que (a) `hosting-cache.test.mjs` exige la cohérence du **fichier source**, que les tests Playwright servent directement le dépôt (`tests/helpers.mjs`), donc source et artefact doivent rester identiques ; (b) une divergence source/artefact rendrait les références d'assets non vérifiables sur le code versionné ; (c) elle complexifierait les deux builds sans supprimer la décision humaine sur le jeton. La solution retenue remplace **62 éditions manuelles par1 commande vérifiée**, sans transformation cachée.

Contraintes satisfaites : URLs et import map préservées, garanties anti-cache intactes, meta cohérente, tests de cache non affaiblis (seulement complétés), aucune dépendance, aucun fichier source modifié par un simple test (le test agit sur une copie temporaire), builds inchangés.

## 7. Contrats historiques préservés

- **Aucun fichier gelé modifié** : `directory-utils.js`, `family-relations.js`, `tree-camera.js`, `tree-layout.js`, `document-utils.js`, `genealogy-date.js`, fixtures `v16/v17/v18` — absents du diff.
- `directoryEventYear` **non supprimé** (consignation 6B.1 : module sous comparaison octet `final-qa`).
- **Aucun export historique modifié** (les21 exports superflus sont conservés, rapport 6B.1).
- Tests de sécurité et d'absence inchangés : `firestore-rules-invariants`, section Démarches de `firestore-emulator`, tests `?view=dossiers`, `#icon-procedures`.
- Les nouveaux contrats du jeton **ajoutent** sans remplacer : `hosting-cache` reste la référence de l'unicité du jeton.

## 8. Tests et builds exécutés

| Contrôle | Commande | Résultat |
|---|---|---|
| Syntaxe des nouveaux fichiers | `node --check` (2 scripts +1 test) + parse JSON `package.json` | **OK** |
| Nouveau test de versionnement | `node --test tests/asset-release.test.mjs` | **3/3** (source, artefact, transformation sur copie + refus de jeton invalide) |
| Famille rapide complète | `npm run test:unit` | **594/594,0 échec,0 ignoré,≈3 s** |
| Filtre + passthrough npm | `npm run test:unit -- --filter navigation` | **14/14** |
| Contrat cache | `node --test tests/hosting-cache.test.mjs tests/asset-release.test.mjs` | **10/10** |
| Jeton cohérent | `npm run check:assets` | **OK** (61 refs + meta =62) |
| Artefact recette | `npm run build:recette` | **exit0**,258/258 ressources servies, meta = source |
| Reproductibilité | 2 exécutions de `build:recette` + comparaison SHA-256 des258 fichiers | **0 écart** |
| Artefact production (local, non déployé) | `npm run build:production` | **exit0**,274 fichiers,11 390 798 octets |
| Diff | `git diff --check` | **OK** |

Aucune campagne applicative complète exécutée, aucun test modifié ou désactivé, aucun accès à un projet Firebase distant.

## 9. Gains mesurés et attendus

**Mesurés (avant → après) :**

| Indicateur | Avant | Après | Statut |
|---|---|---|---|
| Occurrences du jeton à modifier manuellement | **62** (édition à la main) | **1 commande** (`bump:assets`), vérifiée automatiquement | **démontré** |
| Commande « famille rapide » | inexistante (choix parmi109 fichiers) | `npm run test:unit` = **594 tests en ≈3 s** ; `--filter` pour un groupe de zone | **démontré** |
| Documents de référence pour localiser une fonctionnalité | 0 (exploration + lecture de `AGENTS.md`/rapports) |2 (`docs/TECHNICAL_MAP.md`, `docs/TEST_MATRIX.md`) +1 resserré | **démontré** |
| Commandes disponibles dans `package.json` |5 |9 | **démontré** |
| Taille d'`AGENTS.md` |107 lignes |**87 lignes** (5 nouvelles sections,10/10 règles de sécurité conservées) | **démontré** |

**Attendus (non mesurables dans ce lot)** : réduction des tokens et du temps des futures interventions OpenCode (moins d'exploration de `app.js`, de balayages de dépôt et d'essais de commandes) — évaluable seulement après plusieurs lots6B/7 ; **aucun chiffre de réduction n'est annoncé**.

**Non mesurés** : durée de la famille `browser` (exécution complète non lancée, réservée aux validations d'UI).

## 10. Limites et risques résiduels

1. Le filtre `--filter` cible des **noms de fichiers** ; un fichier peut couvrir plusieurs zones — la matrice indique les ensembles, à ajuster au cas par cas.
2. La famille `unit` inclut des tests qui lisent `index.html`/CSS (assertions statiques) : ils échoueront légitimement si le markup change — c'est voulu.
3. `AGENTS.md` a été réécrit : ses règles de sécurité sont conservées mot pour mot, mais une relecture humaine du condensé Git est recommandée avant le prochain lot sensible.
4. Carte et matrice sont des **documents à maintenir** : tout lot déplaçant des fonctions doit les mettre à jour (sinon dérive documentaire).
5. Le test d'artefact se met en échec si `dist-recette/` existe et diffère de la source — comportement voulu (signal « rebuild avant publication »), mais il faudra s'y conformer.
6. `hosting-cache` et `asset-release` se recouvrent partiellement sur l'unicité du jeton (volontaire : le second ajoute le format, l'artefact et le script).

## 11. Recommandations pour le nettoyage restant du lot 6B

- **6B.2** — CSS orphelin par composant (32 sélecteurs du rapport 6A) : validation visuelle + impression à chaque sous-lot ; commandes via la matrice (familles `unit`/`browser` des zones concernées).
- **6B.3** — ressources statiques :8 PNG « avec texte » + tailles72/96 (≈520 Ko), planche après confirmation.
- **6B.4** — duplication annuaire : migrer les cas legacy de `qa-70-cases`/`genealogy-model` vers `directory-advanced` (couverture du chemin runtime), puis fusionner `normalizeDirectoryText`.
- **6B.5** — décision sur `photograph-storage`/`photograph-preview` (fondation non branchée) avec son test.
- **6B.6** — `vendor/pdfjs` (6,4 Mo committé et régénéré par le build) : analyse du cycle build/dev avant décision.

## 12. Préparation du lot 7

- **7A (audit d'architecture)** : partir de `docs/TECHNICAL_MAP.md` ; inventaire de l'état global de `app.js` (~272 écouteurs, listes partagées), frontière « accès Firestore » (`refs`, abonnements, sauvegarde), découpage par vue — livrable = diagnostic par zone + ordre d'extraction, sans changement de code. Les commandes de la matrice serviront de portes de sortie non-régression par zone.
- **7B (modularisation)** : principes du roadmap — extraire le pur d'abord (modèle déjà éprouvé), un pas = un commit = une zone, `node --check` + tests de la zone, mise à jour de l'import map et du jeton dans le même commit (`npm run bump:assets -- <jeton>`), aucune règle/fixtures touchées, jamais de big-bang ; conserver `form-ui.js` + `app.js` comme points d'entrée tant que `app.js` n'est pas vidé.

---

*Lot 6C : aucune donnée Firestore, règle, configuration ni module métier touché ; aucun déploiement.*
