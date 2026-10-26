# Rapport de validation — lot 8B

Date : 20 octobre 2026
Branche : `recette`
Révision de départ : `fae1b571ff1f5096091a67f0f27eb76a4cdfaecf`

## Recommandation

**GO recommandé pour une publication en recette, après revue humaine du diff.** Les 18 échecs initiaux sont résolus ou identifiés comme effets de concurrence, les suites responsive et générale sont vertes, et la validation Emulator est passée localement. Le commit local est créé après cette revue ; aucun push ou déploiement n’a été effectué.

## Tests navigateur responsive


| Viewport | Assertions | Échecs |
| --- | ---: | ---: |
| 1440 × 900 | 72 | 0 |
| 1024 × 768 | 72 | 0 |
| 760 × 900 | 73 | 0 |
| 560 × 800 | 73 | 0 |
| 390 × 844 | 73 | 0 |
| 320 × 568 | 73 | 0 |
| 844 × 390 paysage | 77 | 0 |

Les contrôles et le menu restent dans le canvas aux deux tailles auparavant en échec. Les boutons de zoom et d’action conservent leurs cibles tactiles et les actions du menu sont exercées par clic. Le menu s’adapte à l’espace disponible sur le petit écran.

La correction CSS locale utilise des marges gauche/droite calculées à partir de la largeur du canvas de référence (776 px), uniquement pour les fenêtres de faible hauteur. Le menu n’est pas masqué par `overflow: hidden`. Les règles générales desktop ne sont pas touchées.

**Vérification visuelle manuelle : non effectuée.** Les résultats ci-dessus proviennent du navigateur automatisé Playwright/Chromium ; ils ne constituent pas une inspection visuelle humaine sur appareils physiques.

## Diagnostic des 18 échecs initiaux

Le rapport Node comptait les sous-tests et leurs parents en échec, soit 18 entrées rattachées à neuf groupes de résultats :

1. **Lot 3C Administration à 390 × 844 (2 entrées : viewport + groupe parent)** — dimensions nulles lors d’une exécution navigateur concurrente. Le même cas passe en exécution sérielle ; le run général final à concurrence 4 passe également. Cause : contention/isolation des navigateurs, sans régression persistante.
2. **Cache/versionnement (1)** — l’import map 8A ne versionnait pas dix dépendances ajoutées : `backup-archive.js`, `document-transcription.js`, `fact-conclusions.js`, `genealogy-collaboration-firestore.js`, `genealogy-collaboration.js`, `genealogy-identities.js`, `genealogy-proofs.js`, `photograph-preview.js`, `photograph-storage.js`, `source-document-model.js`. Correction : ajout de leurs entrées avec l’identifiant de publication existant.
3. **Contrat modales/formulaires (1)** — la page contient sept formulaires modaux depuis l’ajout du formulaire de contribution 8A, alors que le test en comptait six. Mise à jour du commentaire et de l’assertion afin de recenser le septième formulaire.
4. **Impression WebKit (2 entrées : viewport + groupe G1)** — l’espion `print` n’était pas appelé dans le run concurrent ; le fichier complet réussit seul/sérié et dans le run global final. Cause : ordonnanceur et contention, aucune modification du parcours d’impression.
5. **Création/affectation Annuaire (1)** — attente Playwright expirée pendant le run concurrent ; le test ciblé puis le run global final réussissent. Cause : contention, pas d’échec fonctionnel reproductible.
6. **Feature flag Recette à 390 × 844 (2 entrées : viewport + groupe parent)** — l’interface recette affiche six destinations (dont Sources & preuves, lot 8A), le test exigeait encore cinq colonnes. Test réaligné sur les six rubriques ; le cas production continue de vérifier la navigation à quatre colonnes lorsque Démarches est masqué.
7. **Responsive Arbre/Annuaire (4 entrées : trois largeurs + groupe parent)** — une règle cachait la description sur toutes les largeurs mobiles, contrairement à la hiérarchie partagée attendue ; elle est désormais conservée en portrait normal et masquée uniquement sur écran court. Le test de grille a aussi été aligné sur le layout 8B réel à deux filtres côte à côte, avec mesures d’axes, d’écart et d’occupation totale plutôt que d’exiger à tort une largeur pleine pour chaque filtre.
8. **Défilement paysage (3 entrées : deux viewports + groupe parent)** — `overflow: visible` s’appliquait même menu fermé. Le shell reprend `overflow: hidden` au repos et ne devient visible que lorsque le menu est ouvert, qui reste séparément rogné par le clip de scène.
9. **Menu paysage court 390 × 430 (2 entrées : viewport + groupe parent)** — le calcul JS de headroom bornait le menu à 15 px parce que les contrôles sont fixes au viewport. Une règle CSS ciblée sur les fenêtres tactiles ≤460 px permet au menu scrollable de conserver ses quatre actions visibles et utilisables.

Les assertions modifiées correspondent aux contrats effectivement livrés : six destinations en recette, sept formulaires présents, et filtres Arbre disposés en grille compacte. Elles vérifient maintenant ces structures et leurs dimensions au lieu de conserver des comptes historiques devenus faux.

## Re-tests et résultats finaux

- Tests ciblés des groupes précédemment en échec, exécutés en série : **74 réussis, 0 échec**.
- Suite générale : `node --test --test-concurrency=4 tests/*.test.mjs` — **775 réussis, 0 échec**, durée ~205 s.
- Navigateur responsive : `npm.cmd run test:responsive` — **513 assertions, 0 échec**, 7 viewports ; les tailles 320 × 568 et 844 × 390 restent vertes.
- Firebase Emulator local : **71 réussis, 0 échec**, projet fictif `family-tree-emulator-test`.
- Syntaxe : `node --check` sur `js/app.js` et les modules de test modifiés — réussi.
- `git diff --check` — réussi.
- Aucun contrôle visuel manuel sur appareil physique n’a été effectué ; les tailles et interactions sont vérifiées par Playwright Chromium/WebKit automatisés.

## Permissions et Firebase Emulator

Exécution locale uniquement, avec le projet fictif `family-tree-emulator-test` et les ports `127.0.0.1:8080` / `127.0.0.1:9099`. Pour ne pas toucher au journal historique du workspace, l’Emulator a été lancé depuis le dossier temporaire dédié `C:\Users\FRANOI~1\AppData\Local\Temp\opencode\family-tree-lot8b-emulator-20261020` en pointant explicitement `--config` vers le `firebase.json` du dépôt :

Commande exécutée depuis le dossier temporaire dédié :

`firebase.cmd emulators:exec --config "C:\Users\François\Documents\family-tree\firebase.json" --only firestore,auth --project family-tree-emulator-test "node C:\Users\François\Documents\family-tree\tests\firestore-emulator.mjs"` : **71 réussis, 0 échec**.

Le scénario sécurité 8B valide que :

- un compte anonyme et un membre en attente ne peuvent ni lire ni écrire les documents historiques ;
- un membre approuvé garde les droits d’écriture historiques sur `documents` et `documentChunks` ;
- ce membre ne peut pas modifier une preuve officielle de `genealogyProofs`.

Les Rules n’ont pas été modifiées. Aucun accès à Firebase distant ni aux données de production n’a eu lieu. Les lignes `PERMISSION_DENIED` émises pendant les tests correspondent aux refus attendus et assertions réussies.

## Sources & preuves, documents et sauvegardes

Les tests d’intégration disponibles couvrent les contrats automatisés des propositions, des écritures officielles et de leur historique immuable, des notifications privées et de l’atomicité. La suite de validation 8A documente les parcours d’interface « Sources & preuves », la consultation de documents historiques, et le ZIP v5 en prévisualisation sans écriture.

- Les documents historiques restent consultables via leurs ressources existantes (chunks Firestore, data URL ou lien déjà enregistré) ; aucun fichier ni champ n’est migré ou supprimé.
- Les ZIP v4 gardent leur flux de restauration historique.
- Les ZIP v5 sont inspectés en prévisualisation seule ; le lecteur contrôle l’intégrité, les ressources et les conflits sans écrire dans Firestore.
- Les tests Emulator couvrent les permissions ; aucune recette visuelle manuelle de tous les parcours Sources & preuves n’a été faite dans cette session.

## Limites techniques et risques résiduels

- Les originaux photo des sources n’ont pas de stockage durable opérationnel ; `MemoryPhotographStorage` est volatil.
- Les notifications automatiques de soumission à tous les administrateurs nécessitent un déclencheur serveur absent ; la file des propositions pending reste consultable.
- L’export ZIP v5 lit plusieurs collections sans snapshot transactionnel global et demeure donc explicitement partiel.
- La restauration ZIP v5 n’écrit rien ; la restauration des collections officielles nécessiterait un mécanisme privilégié séparément conçu et validé.
- La validation des parcours Sources & preuves repose en partie sur tests automatisés et contrats ; pas de validation visuelle humaine durant ce lot.
- **Journal Emulator du workspace :** `firestore-debug.log` est ignoré par Git (`.gitignore: *.log`) et absent de `git status`. Son empreinte était déjà `A8FB69442E52692FDFB1D91D8DFA7E29AD9A5EE37302B9ADAB14CB5B58DCA3A0` au début de cette tâche et est restée identique après les tests. Le nouveau journal est dans le dossier temporaire dédié (SHA-256 `571C1B64D4337DA899EE5440AED44EFF3FF2E9151D960F5F8D37607F00A455DB`). Le contenu historique du workspace a donc été préservé pendant cette reprise.

## Vérifications complémentaires

- `node --check js/app.js` : réussi.
- `node --check tests/responsive-real.mjs` : réussi.
- `node --check tests/firestore-emulator.mjs` : réussi.
- `git diff --check` : réussi.
- Aucun test de navigateur réel sur appareil physique ; aucune modification des Rules, push, déploiement ou migration. Le commit local est créé après cette revue.

## Fichiers modifiés

Fichiers suivis modifiés par rapport au HEAD de départ :

- `css/design-system.css` — règles responsive existantes du lot et correction ciblée de positionnement des contrôles sur écrans courts.
- `index.html` — ajout des modules 8A manquants à l’import map versionnée.
- `tests/firestore-emulator.mjs` — test de sécurité documents historiques/proof officiel présent dans le diff de travail.
- `tests/responsive-real.mjs` — remise du scroll à zéro lors du redimensionnement et détails géométriques ajoutés aux assertions canvas pour diagnostiquer les débords.
- `tests/modals-forms-ui.test.mjs` — contrat actualisé au formulaire de contribution ajouté en 8A.
- `tests/procedures-feature-flag.test.mjs` — contrat recette actualisé à six destinations de navigation.
- `tests/tree-directory-responsive.test.mjs` — contrôle de la grille compacte à deux filtres.
- `LOT8B_VALIDATION_REPORT.md` — présent rapport.

Le fichier local préexistant `firestore-debug.log` n’a pas été modifié durant cette tâche. Les journaux de cette validation sont confinés au dossier temporaire documenté ci-dessus.

Les fichiers historiques non suivis `DEMARCHES_RULES.md`, `LA_NOSTRA_STORIA_DESIGN_SYSTEM.md`, `RESPONSIVE_390_QA_REPORT.md`, `RESPONSIVE_QA_REPORT.md`, `RESPONSIVE_UX_QA_REPORT.md` et `tests/_repro-transfer-fingerprint.mjs` ont été préservés.
