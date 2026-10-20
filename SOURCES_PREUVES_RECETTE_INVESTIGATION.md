# Investigation locale — Sources & preuves après publication en recette

Date : 20 octobre 2026  
Branche : `recette`  
HEAD conservé : `e0a7301f89f0010ca01467f909bc2234dfe81b4e`  
URL observée par l’utilisateur : `https://la-nostra-storia-recette.web.app`

## A. Chargement incomplet

### Diagnostic du code

`startData()` dans `js/app.js` installe une souscription `onSnapshot` par collection. Les collections sont d’abord représentées par des tableaux vides. Chaque callback de succès remplace son tableau par `snapshot.docs.map(...)` : un snapshot avec zéro document est donc un succès normal et vaut `[]`. Il ne déclenche aucun callback d’erreur.

Les lectures sont indépendantes : un échec partiel ne bloque pas les snapshots réussis et les éléments déjà disponibles restent rendus. La correction suit désormais l’état des onze souscriptions, y compris propositions et notifications : le chargement est complet lorsque chacune a fourni un snapshot réussi. Un succès vide compte comme une réponse réussie. Un succès ultérieur retire l’erreur mémorisée de cette collection.

En cas d’erreur, l’interface conserve le nom de la collection et distingue le code Firestore parmi : permission refusée, service/réseau indisponible, délai dépassé, index ou précondition, requête invalide, erreur générique. Les erreurs sont affichées sans être avalées ni contourner les règles.

### Collections, chemins et requêtes

Toutes les collections sont dans la base par défaut, sous leur nom de premier niveau indiqué ci-dessous. Les lectures des têtes et révisions officielles utilisent des `collection(db, nom)` directes ; la liste est reçue en entier par `onSnapshot`.

| Collection | Chemin | Requête de chargement | Droit prévu par les Rules locales | Résultat Emulator local |
| --- | --- | --- | --- | --- |
| `sourceDocuments` | `/sourceDocuments/{sourceId}` | Collection entière | `isApproved()` | Liste sans résultat autorisée pour admin et membre approuvé |
| `sourceRevisions` | `/sourceRevisions/{revisionId}` | Collection entière | `isApproved()` | Idem |
| `transcriptionHeads` | `/transcriptionHeads/{transcriptionId}` | Collection entière | `isApproved()` | Idem |
| `transcriptionRevisions` | `/transcriptionRevisions/{revisionId}` | Collection entière | `isApproved()` | Idem |
| `genealogyProofs` | `/genealogyProofs/{proofId}` | Collection entière | `isApproved()` | Idem |
| `genealogyProofRevisions` | `/genealogyProofRevisions/{revisionId}` | Collection entière | `isApproved()` | Idem |
| `factConclusions` | `/factConclusions/{conclusionId}` | Collection entière | `isApproved()` | Idem |
| `conclusionRevisions` | `/conclusionRevisions/{revisionId}` | Collection entière | `isApproved()` | Idem |
| `genealogyEvents` | `/genealogyEvents/{eventId}` | Collection entière | `isApproved()` | Idem |
| `genealogyProposals` | `/genealogyProposals/{proposalId}` | Admin : collection entière ; membre : `where("authorUid", "==", uid)` | Admin ou compte approuvé limité à l’auteur | Lecture sans résultat conforme pour le scope du membre ; tests 8A/lot 6 sur listes et isolation |
| `genealogyNotifications` | `/genealogyNotifications/{notificationId}` | Tous profils : `where("recipientUid", "==", uid)` | Compte approuvé, destinataire courant uniquement | Résultat vide du destinataire accepté ; tests lot 6 sur notifications privées |

Les chemins officiels/révisions n’exigent pas d’index composite pour les requêtes de chargement directes. Les deux requêtes filtrées n’emploient qu’un seul champ d’égalité chacune. Un `failed-precondition` est toutefois signalé distinctement, afin qu’un index manquant éventuel soit identifiable plutôt que présenté comme une permission refusée.

### Règles locales, rôles, limites du constat recette

Dans le fichier `firestore.rules` local à ce HEAD, les collections officielles, leurs révisions et les événements sont lisibles par `isApproved()` ; les propositions et notifications ont des contraintes d’auteur/destinataire explicites. Les écritures officielles restent administrateur seulement. Aucune règle n’a été modifiée ici.

Le test Emulator `lecture Sources & preuves : les requêtes sans résultat sont des snapshots réussis pour admin et membre approuvé` vérifie les lectures sans résultat pour les deux rôles. Les tests existants couvrent également l’isolation des propositions et notifications et les refus pour un compte non approuvé. Résultat Emulator complet : **72/72 réussis**.

### Comparaison distante autorisée, lecture seule

La release Firestore active du projet explicitement sélectionné `la-nostra-storia-recette` est `projects/la-nostra-storia-recette/rulesets/63956a47-a53e-4076-b592-63f89a5c7f13`, créée le **5 octobre 2026**. La source active a été récupérée par l’API Firebase Rules en lecture seule. SHA-256 distant : `06a66d260b7925e3d643813675bcfb0b0327f4a470704bfcdfa5f1d00aabee02`. SHA-256 du fichier local : `813349f62186c380c7fa2c69d41323f1c7806fba3db95bb876d8d7f13f9bdd21`. **Les règles distantes et locales ne sont pas identiques.**

La version distante inclut des règles pour les collections historiques `documents` et `documentChunks`, lisibles par `isApproved()`, mais ne contient aucun des onze blocs de collections Sources & preuves suivants :

`sourceDocuments`, `sourceRevisions`, `transcriptionHeads`, `transcriptionRevisions`, `genealogyProofs`, `genealogyProofRevisions`, `factConclusions`, `conclusionRevisions`, `genealogyProposals`, `genealogyEvents`, `genealogyNotifications`.

Ces chemins distants tombent donc sous le catch-all `allow read, write: if false`. **Cause confirmée de l’avertissement : les Firestore Rules recette sont anciennes et ne contiennent pas les règles du lot 6** ; le déploiement précédent avait effectivement publié Hosting uniquement. Cela explique que le document historique reste visible et consultable alors que les nouvelles collections échouent. Les erreurs sont des refus de permission attendus par les Rules distantes, pas des snapshots vides ni un défaut local d’index.

La lecture en lecture seule de la liste d’index Firestore du projet recette a renvoyé `indexes: []`, `fieldOverrides: []`. Les requêtes actuelles sont des lectures directes sur les neuf collections officielles/événements, et des égalités simples sur `authorUid` ou `recipientUid` pour les deux collections privées ; aucun index composite n’est demandé par ces formes de requête. Les règles locales passent les tests Emulator correspondants.

Seules les métadonnées Rules et indexes du projet recette ont été consultées. Aucun document Firestore ni contenu généalogique distant n’a été lu.

Aucun document, utilisateur ou contenu généalogique distant n’a été consulté. La production n’a pas été contactée. Aucune règle distante n’a été modifiée. Le dépôt contient de nouvelles Rules locales, mais le **déploiement de ces règles n’est pas inclus dans cette validation** et nécessiterait une autorisation distincte.

### Défaut local corrigé

Avant, `genealogyLoaded` ne comptait que neuf collections officielles ; propositions et notifications avaient des abonnements et compteurs d’erreur distincts. Les erreurs étaient stockées dans un `Set` sans code et n’étaient jamais effacées après une reconnexion réussie. Le suivi est unifié : **11 collections**, état de succès explicite, rétablissement possible après erreur, diagnostic par collection et catégorie d’erreur. Aucun accès, filtre ou droit supplémentaire n’est accordé.

## B. Cartes de documents historiques

La branche `legacy-source` de `renderGenealogyWorkspace()` affichait `${JSON.stringify(data, null, 2)}` dans le contenu de chaque carte. Cela exposait la fiche Firestore brute, y compris des champs internes comme identifiant, compression, chunks, version de stockage et tailles.

Le rendu est maintenant construit à partir de `legacyDocumentCardDetails()` dans `js/genealogy-workspace-utils.js` :

- titre renseigné, sinon type, sinon libellé générique « Document historique » ;
- date et lieu seulement si présents ;
- personnes seulement lorsqu’une fiche référencée est effectivement chargée, sans nom inventé ;
- notes uniquement si non vides ;
- badge « Photographie disponible » si le MIME ou l’extension identifie réellement une image, dont WebP ;
- aucune métadonnée de stockage ou JSON brut dans la carte historique.

Les documents structurés non historiques gardent leur détail actuel. Le bouton **Consulter** demeure rendu avec `data-genealogy-open="legacy-source"`. Le handler `openGenealogyItem()` continue d’appeler exactement `openStoredDocument(item.record)` lorsque l’enregistrement historique référence des chunks ou du contenu. Aucun code de lecture/décompression, structure chunkée, ressource ou visualiseur n’a été changé.

La fonction de résumé est testée avec un acte WebP en `firestore-chunks`, un document titré, un document sans titre avec type, et des champs facultatifs vides. Les tests statiques vérifient la présence du bouton et la conservation de son routage existant. L’ouverture réelle de l’archive recette de l’utilisateur n’a pas été exercée, car elle nécessiterait une session authentifiée et un accès distant interdits par la tâche.

## C. Tests et vérifications

- Tests ciblés de l’utilitaire, du workspace, du cache/import map : **17/17 réussis**.
- Firebase Emulator local : **72/72 réussis**, journal dans un dossier temporaire dédié.
- Responsive complet : **513 assertions, 0 échec**.
- Suite complète finale `node --test --test-concurrency=4 tests/*.test.mjs` : **779/779 réussis**, 0 échec.
- Les délais initiaux observés dans l’affectation depuis l’annuaire et le retour vers main, ainsi que des scénarios voisins, provenaient d’une course d’initialisation : les harnesses pouvaient semer les fixtures avant que l’observateur Firebase Auth anonyme termine son callback (qui appelle `stopPrivateData()`). Les harnesses de quatre fichiers d’affectation/transfert attendent `auth.authStateReady()` et la notification initiale `onAuthStateChanged(null)` avant de semer. Ensemble, les scénarios concernés passent **35/35 à concurrence 4**.
- Le test d’impression WebKit remplace son attente fixe de 150 ms par une attente conditionnelle du spy `window.print`. Il conserve l’assertion stricte d’un appel exactement.
- Le test « Annuaire en cartes » fixait un mode seulement avant redimensionnement et mesurait les cartes alors que le changement de breakpoint pouvait réappliquer la préférence liste ; `content-visibility` n’était en outre levé qu’au fil de la mesure. Le fixture fixe maintenant la préférence cartes mobile/desktop, réapplique le mode demandé après resize et rend toutes les cartes visibles avant capture de géométrie. Toutes ses assertions d’alignement restent actives.
- Un lancement concurrent avait reçu le port 6667, interdit par Chromium (`ERR_UNSAFE_PORT`). `tests/helpers.mjs` évite le port 6000 et la plage 6665–6669 et réessaie une allocation éphémère. Aucun timeout n’a été augmenté.
- Responsive complet : **513/513 assertions, 0 échec**. `npm.cmd run build:recette` : **41/41 ressources servies localement**, dont le nouvel utilitaire de présentation.
- `node --check` sur `js/app.js`, `js/genealogy-workspace-utils.js` et les tests modifiés : réussi.
- `git diff --check` : réussi.
- Aucun accès distant, aucune règle modifiée, aucun commit, push ou déploiement.

## D. État Git et fichiers

Branche `recette`, HEAD inchangé `e0a7301f89f0010ca01467f909bc2234dfe81b4e`.

Fichiers modifiés :

- `js/app.js` — suivi et diagnostic des onze listeners, retrait d’erreur sur reprise, rendu structuré des documents historiques.
- `js/genealogy-workspace-utils.js` — fonctions pures de classification d’erreur et résumé documentaire historique.
- `css/design-system.css` — espacement limité à la carte historique.
- `index.html` — import map versionnée du nouvel utilitaire.
- `tests/genealogy-workspace-utils.test.mjs` — scénarios erreurs, données historiques, champs optionnels et absence de métadonnées techniques.
- `tests/genealogy-workspace-ui.test.mjs` — assertions de souscriptions, statut, rendu, bouton et routage de consultation.
- `tests/firestore-emulator.mjs` — vérification Emulator des snapshots vides pour admin/membre.
- `tests/person-tree-assignment-ui.test.mjs` — synchronise les fixtures avec l’état initial de Firebase Auth.
- `tests/person-tree-transfer-ui.test.mjs` — même synchronisation du harness de transfert individuel.
- `tests/person-empty-tree-button.test.mjs` — même synchronisation pour les scénarios du bouton central.
- `tests/multiple-tree-transfer-ui.test.mjs` — même synchronisation pour le transfert multiple.
- `tests/person-print.test.mjs` — attend le signal du spy d’impression.
- `tests/directory-cards-layout.test.mjs` — fixe la préférence et stabilise le rendu avant mesures après resize.
- `tests/helpers.mjs` — allocation de ports Chromium acceptés avec retry si port interdit.
- `SOURCES_PREUVES_RECETTE_INVESTIGATION.md` — présent rapport, incluant le constat distant en lecture seule.

Fichiers historiques non suivis préservés : `DEMARCHES_RULES.md`, `LA_NOSTRA_STORIA_DESIGN_SYSTEM.md`, `RESPONSIVE_390_QA_REPORT.md`, `RESPONSIVE_QA_REPORT.md`, `RESPONSIVE_UX_QA_REPORT.md`, `tests/_repro-transfer-fingerprint.mjs`. `firestore-debug.log` a conservé son SHA-256 initial `A8FB69442E52692FDFB1D91D8DFA7E29AD9A5EE37302B9ADAB14CB5B58DCA3A0` ; Emulator a utilisé un dossier temporaire séparé.

## E. Recommandation

**GO pour préparer un commit local après revue/validation de François ; aucun commit n’est créé ici. NO-GO pour la prochaine publication** jusqu’à ce que les Firestore Rules de recette soient déployées et validées séparément. Les corrections locales du chargement et des cartes sont prêtes pour revue. Cause recette confirmée : les Rules actives du 5 octobre n’incluent aucun des onze chemins Sources & preuves et le catch-all refuse les lectures.

François doit autoriser explicitement l’opération distincte de déploiement des seules Firestore Rules vers le projet `la-nostra-storia-recette`. Cette tâche n’a ni effectué cette opération ni créé de commit, push ou déploiement applicatif.
