# Rapport d’intégration — lot 8A

## Fonctionnalités intégrées

- Nouvelle vue « Sources & preuves » avec recherche accent-insensible sur les sources officielles et historiques, transcriptions, preuves, conclusions, propositions, événements et notifications ; filtres par catégorie.
- Abonnements Firestore aux nouvelles collections du lot 6, avec requêtes limitées aux propositions de l’auteur et aux notifications de l’utilisateur courant pour respecter les Rules.
- Consultation détaillée des documents structurés/pages, photos multiples, transcription italienne, traduction, passages, hypothèses et confiance. La consultation locale inclut navigation de pages/passages et zoom des aperçus présents en données locales.
- Accès aux preuves depuis les fiches personnes et les documents ; indications de contradiction, suspension et réexamen.
- Création de propositions brouillon, soumission, annulation, acceptation/refus admin avec notification, création et révision admin des sources/transcriptions/preuves/conclusions avec le magasin transactionnel du lot 6.
- Demande de réexamen et acquittement des notifications par le destinataire.
- Export ZIP v5 raccordé aux collections lisibles par l’utilisateur ; contrôle SHA-256, inventaire des ressources et scopes visibles ; détection de changements entre deux lectures. L’archive reste explicitement partielle car le SDK client ne fournit pas de snapshot atomique global.
- Lecture des ZIP v5 en mode prévisualisation seule : vérification, conflits et plan sans écriture. Le flux de restauration historique v4 reste compatible.

## Fichiers modifiés

- `index.html` : navigation Sources & preuves, workspace et modales de contribution/détail/prévisualisation.
- `css/design-system.css` : présentation responsive du dossier, lecteur transcription/photo et états de révision.
- `js/app.js` : abonnements, recherche, parcours de consultation, actions de collaboration, export v5 et prévisualisation v5.
- `js/backup-archive.js` : scopes de collections et liens des fichiers historiques vers leurs entrées d’archive.
- `tests/backup-archive.test.mjs` : cas de portée visible d’une archive de membre.
- `tests/backup-restore.test.mjs` : contrat d’intégration mis à jour v5/v4 et lecture Firestore.
- `tests/firestore-emulator.mjs` : test de requête sécurisée des propositions de l’auteur.
- `tests/genealogy-workspace-ui.test.mjs` : contrat UI et appels aux parcours du lot 6.
- `LOT8A_INTEGRATION_REPORT.md` : présent rapport.

## Parcours disponibles

1. Documents → Sources & preuves → recherche/filtre → consultation d’une source, d’un document historique ou d’une transcription.
2. Fiche personne → onglet Documents associés → consultation des preuves et conclusions liées.
3. Contributeur approuvé → proposer une contribution → brouillon → soumettre → suivi du statut.
4. Administrateur → accepter/refuser une proposition, créer/réviser une donnée officielle, demander un réexamen.
5. Destinataire → consulter ses notifications et les marquer comme lues.
6. Données → créer une archive ZIP v5 avec inventaire d’intégrité ; choisir un ZIP v5 → inspecter avertissements, ressources, conflits et plan sans écriture.
7. ZIP v4 → le lecteur historique et son flux d’import existant restent disponibles.

## Tests

- Tests ciblés UI, ZIP v4/v5, lots 0–6 et modèles : **156 réussis, 0 échec**.
- Firebase Emulator Firestore/Auth : **70 réussis, 0 échec**, projet fictif `family-tree-emulator-test`, hôte local `127.0.0.1`.
- `node --check` sur `app.js`, `backup-archive.js`, `firestore-emulator.mjs` et le test UI : réussi.
- `git diff --check` : réussi.
- Aucun export/restauration contre Firebase distant ; les tests Emulator et navigateurs utilisent leurs installations locales/fictives.
- Aucun accès distant, migration, push, déploiement, commit ou modification des Rules prévu par cette intégration.

## Limites et points à porter en 8B

- `MemoryPhotographStorage` reste volatil et il n’existe pas d’adaptateur durable pour ouvrir les références de photos des nouvelles sources. L’interface l’indique ; l’original n’est jamais reconstruit depuis un aperçu.
- Les documents historiques peuvent être consultés via leur fichier local Firestore chunké, data URL ou lien déjà enregistré. Les fichiers externes ne sont pas téléchargés automatiquement dans l’archive.
- Les notifications « proposition soumise » à chaque administrateur n’ont pas de déclencheur serveur ; la file des propositions pending est consultable, et la création des notifications de réexamen passe par l’opération admin autorisée.
- La restauration v5 ne réalise aucune écriture. La restauration des collections officielles exige un chemin serveur privilégié à concevoir séparément ; le client ne contourne pas les Rules.
- La capture exportée lit plusieurs collections par requêtes client, sans transaction globale ; elle est donc annoncée partielle même si les marqueurs ne changent pas.
- Les transcriptions, photos et preuves sont présentées depuis les enregistrements déjà persistés ; l’interface ne crée pas de pages ou d’originaux durables manquants.
- Les écrans de contribution structurée utilisent encore des champs JSON pour les objets métier détaillés ; la validation finale devra vérifier leurs libellés, ergonomie et scénarios de saisie.
- Les tests ciblés automatisent la structure et les modèles mais ne remplacent pas la recette manuelle des parcours, tailles d'écran, profils contributeur/admin et navigation complète.
