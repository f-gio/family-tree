# Rapport technique — lot 7 : archive autonome et restauration préparatoire

## Fichiers

- `js/backup-archive.js` : manifeste v5, inventaire, intégrité SHA-256, références, adaptation v4, assembleur/lecteur ZIP injectables et plan de restauration en lecture seule.
- `tests/backup-archive.test.mjs` : scénarios ciblés v5, ressources, compatibilité v4, intégrité, cohérence et conflits.
- Le code ZIP historique v4 de `js/app.js` et `js/backup-utils.js` reste inchangé pour la non-régression.

## Format v5

L'entrée `family-tree.json` garde `format: "family-tree-backup"`, utilise `version: 5` et décrit `archiveSchemaVersion`, `createdAt`/`exportedAt`, les collections capturées, leur inventaire et leurs IDs, les fichiers binaires, leur taille, SHA-256, provenance, leur statut original/aperçu/optimisé historique, les ressources et collections absentes, les erreurs de référence, ainsi que l'état de cohérence et les avertissements de complétude.

Exemple abrégé de manifeste (les tableaux et empreintes sont des exemples de structure) :

```json
{
  "format": "family-tree-backup",
  "version": 5,
  "archiveSchemaVersion": 5,
  "createdAt": "2026-10-19T12:00:00.000Z",
  "collections": {
    "people": [{ "id": "person-1" }],
    "documents": [{ "id": "document-1" }],
    "genealogyProofs": [{ "id": "proof-1", "authorUid": "uid-historique" }]
  },
  "assets": [{
    "documentId": "document-1", "pageId": "page-1", "photographId": "photo-1",
    "rendition": "original", "archivePath": "assets/document-1/page-1/photo-1/original",
    "state": "present", "isOriginal": true, "sizeBytes": 4,
    "sha256": "...64 caractères hexadécimaux...", "provenance": "declared-resource"
  }],
  "missingResources": [],
  "capture": { "consistent": false, "strategy": "client-multi-read", "changeDetected": false },
  "completeness": {
    "status": "partial", "complete": false,
    "missingCollections": ["factConclusions"],
    "warnings": [{ "code": "SNAPSHOT_NOT_ATOMIC", "message": "..." }]
  }
}
```

Les références d'auteur/décision sont conservées comme UID historiques dans les objets de domaine. Les profils `users`, identifiants d'authentification, mots de passe et rôles actifs ne font pas partie des collections exportables.

## Données et intégrité

Le modèle accepte les enregistrements des collections historiques et les nouvelles collections officielles/révisions/propositions/événements/notifications du lot 6. Les données de personnes/familles et d'arbres sont validées avec les validateurs v4 existants. Les checks examinent les documents et pages, photos référencées, passages et révisions de transcription, sources, preuves, personnes liées, preuves examinées par une conclusion, et les chaînes de révisions (versions absentes, mauvais objet parent et cycles).

Les octets de chaque actif sont hachés avec SHA-256 au moment de la préparation et contrôlés à nouveau à la lecture du ZIP. Fichier absent, taille incorrecte, empreinte modifiée, ressource référencée mais illisible, référence cassée ou archive incomplète donnent des diagnostics explicites ; les incohérences ne sont pas réparées silencieusement. Originaux, aperçus et plusieurs photos d'une page ont des entrées d'archive distinctes. Une ressource `legacy-optimized` (par exemple un ancien WebP Firestore) a toujours `isOriginal: false` et une provenance historique.

## Capture concurrente et complétude

Firestore ne garantit pas une transaction globale de lecture multi-collections. `compareBackupCaptureMarkers` compare des marqueurs avant/après par collection ; un changement détecté rend l'état incohérent. En l'absence de marqueurs cohérents, le manifeste porte `SNAPSHOT_NOT_ATOMIC` et demeure partiel. Une collection non lue, une ressource absente ou une incohérence de référence interdit l'étiquette `complete`.

## ZIP v4 et ZIP v5

`readBackupZip` détecte v4 et v5. V4 est adapté en mémoire avec IDs et champs existants conservés ; les collections lot 6 absentes sont listées et l'archive reste partielle. Les anciens octets ZIP de documents v4 sont hachés pour détection de corruption, mais qualifiés `legacy-optimized-or-unknown`, jamais d'originaux. Aucune archive v4 n'est modifiée.

`generateBackupZip` et `readBackupZip` reçoivent un constructeur/adaptateur JSZip injecté ; l'export peut donc réutiliser la dépendance JSZip déjà chargée par l'app, sans nouveau service. Le cœur v5 est préparé et testé comme module pur : le bouton et le pipeline Firestore existants de l'interface ne sont pas encore raccordés à l'acquisition des nouvelles collections et aux ressources photographiques durables. Les nouveaux binaires doivent être fournis à `createBackupArchiveManifest` par l'adaptateur d'application.

## Restauration

`verifyBackupArchive` valide le manifeste, les binaires et les références avant préparation. `prepareBackupRestorePlan` ne réalise aucune écriture ; il exige une politique explicite (`abort`, `keep-existing`, `replace-existing`) et expose conflits, opérations prévues, UID historiques sans compte actif, avertissements et besoin de serveur privilégié pour les données officielles. Il ne restaure aucun compte ni rôle et n'accorde jamais d'administration à un UID historique.

L'exécution d'une restauration v5 n'est pas exposée par le client : les Rules du lot 6 réservent l'écriture officielle aux administrateurs et l'API client ne contourne pas ces règles. Une restauration complète des données officielles devra passer par un service serveur privilégié, approuvé séparément, ou une procédure administrateur contrôlée. La fusion v4 existante reste en place ; ses écrasements par ID sont le comportement historique et ne sont pas utilisés par le nouveau plan.

## Tests locaux

- `node --test tests/backup-archive.test.mjs tests/backup-restore.test.mjs tests/photograph-storage.test.mjs tests/source-document-model.test.mjs tests/document-transcription.test.mjs tests/genealogy-proofs.test.mjs tests/fact-conclusions.test.mjs tests/genealogy-collaboration.test.mjs` : **134 réussis, 0 échec**.
- `node --check js/backup-archive.js` et `node --check tests/backup-archive.test.mjs` : réussis.
- `git diff --check` : réussi.
- Pas de test Emulator ni d'accès Firebase distant requis pour le cœur pur de v5 ; aucun projet réel, donnée de production ou fixture v4 historique n'a été écrit ou modifié.

## Limites restantes

- Les sources officielles et collections du lot 6 ne sont pas actuellement chargées par `app.js`; le nouveau module prend les instantanés explicitement en entrée.
- Le stockage `MemoryPhotographStorage` des lots 1–2 est non durable et l'application courante ne dispose pas d'un adaptateur de lecture des originaux/aperçus durables ; leur indisponibilité doit être transmise au manifeste plutôt que remplacée par un aperçu.
- Le lecteur v4 peut signaler ce qui manque du format ancien, mais ne peut recréer les métadonnées, originaux, pages ou auteurs qui n'y ont jamais été stockés.
- L'exécution de restauration v5 nécessite un chemin privilégié serveur, non fourni ni déployé dans ce lot.
- Aucune migration, écriture distante, activation Blaze ou intégration d'interface finale n'a été faite.
