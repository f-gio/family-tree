# Recherches — Lot R2.1 : consolidation attestations, preuves et références

> **Périmètre livré** : analyse + fonctions pures de diagnostic et de compatibilité + tests.
> Aucune modification de `firestore.rules`, d'opération de suppression persistante, de parcours UI, de modèle Firestore ni de données. Aucun renommage « Attestation → Justificatif ». Aucun déploiement nécessaire : `js/justification-compat.js` n'est importé ni par `index.html`, ni par aucun module de `js/` consommé par le graphe d'import de l'application (vérifié), donc l'artefact Hosting est inchangé.

---

## 1. Cartographie des parcours « Ajouter une attestation »

### 1.1 Points d'entrée réellement implémentés

| Parcours | Déclencheur | Cible d'écriture |
|---|---|---|
| Naissance (fiche Personne) | `birthAttestationControl` (`index.html:602-603`) | `people/{id}.birthAttestations` |
| Décès (fiche Personne) | `deathAttestationControl` (`index.html:609-610`) | `people/{id}.deathAttestations` |
| Union (détails Famille + création de relation) | `familyMarriageAttestationControl` / `data-pending-relation-attestation-add` | `families/{id}.marriageAttestations`, ou tableaux en mémoire pendant la création |
| Résidence, Profession, Événement de vie (Parcours détaillé) | `data-journey-attestation-add` (`app.js:2576`, `app.js:2734`) | `people/{id}.residences/professions/lifeEvents[*].attestations` |

- Le bouton générique est produit par `journeyAttestationAddButtonMarkup` (`js/app.js:2575-2577`) ; la navigation des événements du Parcours affiche aussi le compteur et les liens d'une attestation existante (`js/app.js:3783-3851`).
- Le dispatch est unique : `handlePersonPageContentClick` → `data-journey-attestation-add|edit|save|delete` (`js/app.js:3617-3637`).
- La résolution de la cible majeure est faite par `majorEventAttestationTarget` (`js/app.js:2584-2599`), qui refuse de proposer une attestation d'union si la personne n'a pas d'événement `union-{familyId}` réel.

### 1.2 Formulaire et modale

Un **seul** formulaire est partagé : `journeyAttestationFormMarkup` (`js/app.js:2825-2869`). Il compose :
- la **date de l'attestation** (`journeyDateFormMarkup`, types `LIFE_DATE_TYPES` issus de `life-journey.js:3`) ;
- un **commentaire** libre (300 caractères) ;
- trois groupes d'associations à cases à cocher : **Documents**, **Sources**, **Preuves**, alimentés respectivement par `documents`, `sourceDocuments` et `genealogyProofs` **déjà liés à la personne courante** (`js/app.js:2826-2844`).

La modale physique est `personAttestationDialog` (`index.html:688-698`), ouverte par `openJourneyAttestationDialog` (`js/app.js:2919-2944`) ou `openPendingRelationAttestation` (`js/app.js:2960-2983`). La classe `modal-mobile-sheet--long` porte le rendu mobile ; les mêmes composants servent en desktop.

### 1.3 Lecture, modification, suppression

- **Lecture** : `lifeAttestations(entry)` (`js/life-journey.js:103-105`) ne renvoie que des tableaux ; `journeyAttestationRowsMarkup` affiche date, commentaire, liens Documents/Sources/Preuves et boutons Modifier/Supprimer (`js/app.js:2564-2573`).
- **Écriture/modification** : `journeySaveAttestation` (`js/app.js:15381-15498`) avec trois branches : `pendingRelation`, `pendingEntry`, puis écriture directe. Elle détecte les doublons de date via `hasSimilarLifeAttestation` (`js/life-journey.js:133-138`) et demande une confirmation explicite.
- **Suppression** : `journeyDeleteAttestation` (`js/app.js:15527-15553`) — confirmation, puis réécriture du tableau, **jamais** de suppression des Documents/Sources/Preuves référencés (message explicite `js/app.js:15723`).
- **Mécanismes de persistance** : `journeyWriteSnapshot` (`js/app.js:15555-15569`, `updateDoc` sur le champ de la Personne) et `lifeEventWriteAttestations` (`js/app.js:15571-15590`, `updateDoc` sur `people`/`families`).
- **Sauvegarde** : `people` et `families` figurent dans `BACKUP_COLLECTION_NAMES` (`js/backup-archive.js:10-14`), donc les attestations sont incluses dans l'archive v5.

### 1.4 Permissions et règles

Les attestations ne possèdent **aucune collection ni règle propre** : elles sont des champs imbriqués.

| Cible | Règle | Contrôle réel |
|---|---|---|
| `people/{id}` | `firestore.rules:512-520` — `isApproved()`, `validUpdatedBy()` | `validPerson()` ne contrôle que `photoUrl`, `birthDateInfo`, `deathDateInfo` (`firestore.rules:49-54`) |
| `families/{id}` | `firestore.rules:539-542` — `isApproved()`, `validFamily()` | `validFamily()` contrôle partenaires, enfants, union, fin, `parentChildLinks` (`firestore.rules:203-217`) |

**Fait vérifié** : aucune règle Firestore ne valide la structure, la date ni les références d'une attestation. La protection repose entièrement sur le formulaire applicatif.

### 1.5 Différences entre les parcours (constat, non corrigé)

1. **Écriture différente** : majeurs → `lifeEventWriteAttestations` (tableau du champ) ; Parcours → `journeyWriteSnapshot` (tableau de l'entrée).
2. **Conservation asymétrique des références** : lors d'une modification, les `documentIds` « non disponibles » sont **conservés** (`js/app.js:15471,15474`), alors que `sourceIds` et `proofIds` non disponibles ne le sont que si `majorTarget` est défini (`js/app.js:15472-15473`). Sur un élément du Parcours, une Source/Preuve devenue non disponible serait donc retirée silencieusement.
3. **Parcours en attente** : `pendingRelation` et `pendingEntry` filtrent strictement sur les références disponibles et **ne conservent pas** les références non disponibles d'une attestation en cours d'édition (`js/app.js:15411-15418`, `15440-15447`).
4. Les attestation en attente ne sont persistées nulle part : ce sont des tableaux mémoire (`pendingRelationAttestations`, `journeyPendingEntryAttestations`, `js/app.js:285-290`).

Ces trois différences sont **documentées, non modifiées** : elles touchent au parcours existant et à des données persistées.

---

## 2. Distinction Attestation · Preuve · Source · Conclusion · Justificatif

| | Attestation | Preuve | Source | Conclusion | Justificatif (cible UI) |
|---|---|---|---|---|---|
| Stockage | champ imbriqué dans `people`/`families`/entrée de Parcours | collection `genealogyProofs` + `genealogyProofRevisions` | collection `sourceDocuments` + `sourceRevisions` | collection `factConclusions` + `conclusionRevisions` | **non implémenté** |
| Valeur portée | aucune — date + commentaire + listes de références | `sourceValue` + `citation` + `relation` (`supports`/`contradicts`/`mentions`/`ambiguous`) | métadonnées archivistiques, pas de valeur de fait | `retainedValue` = décision humaine | à définir en R2.2 |
| Fait visé | non — portée événement/personne/foyer | `factId` + `factType` (`genealogy-proofs.js:56-135`) | aucun | `factId`/`factType` | informations précises via cibles R1 |
| Écriture | tout compte approuvé, sans validation serveur de la structure | admin, head + révision immuable + événement (`firestore.rules:673-710`) | admin, head + révision immuable + événement (`firestore.rules:606-641`) | admin, head + révision immuable + événement (`firestore.rules:744-770`) | — |
| Historique | réécriture du tableau, pas de révision | révisions append-only + `statusHistory` | révisions append-only | révisions append-only + réexamen | — |
| Hiérarchie | **ne conclut jamais** d'un fait | **ne modifie jamais** l'arbre (principe `SOURCES_PREUVES_GENEALOGIQUES.md:22`) | contexte/provenance | décision explicite et versionnée | aggregation future |

**Incompatibilités démontrées** :
- Une Attestation ne porte ni `factId`, ni `sourceValue`, ni `relation`, ni ancrage page/passage/révision → elle ne peut pas remplacer une Preuve pour répondre à « date précise vs lieu ».
- Une Preuve n'a ni date de pertinence propre, ni commentaire libre, ni portée « événement du Parcours » → elle ne peut pas remplacer une Attestation.
- Aucune des deux n'est une Source : le contexte archivistique et les pages y sont portés par `sourceDocuments`/`documents`.
- `Justificatif` est un **terme utilisateur futur** ; aucun renommage technique n'a été fait dans ce lot.

---

## 3. Compatibilité avec le registre R1

R1 expose des cibles `{id, targetType, owner, path, value, valueState, factId, legacyFactCandidates}` (`js/justification-targets.js`).

| Mécanisme existant | Passerelle livrée en R2.1 | Portée |
|---|---|---|
| Attestations imbriquées | `collectAttestations({people, families})` | recense les 4 emplacements réels (`birthAttestations`, `deathAttestations`, `marriageAttestations`, `*.attestations` du Parcours) avec `ownerKind`, `ownerId`, `field`, `entryId`, `location` ; exclut les entrées sans ID persistant |
| Attestation → cible | `analyzeJustificationCoverage` | **portée propriétaire uniquement** (`owner-attestation`) : jamais rattachée à une cible de champ précise, car le modèle ne le permet pas |
| Preuve → cible | `classifyProofTargetCompatibility` | `exact` si `factId` = `target.factId` ; `generic-ambiguous` si `factId` correspond à un `legacyFactCandidate` (`birth`/`death`) ; `unmapped` sinon ; `invalid` si `factId` absent |
| Couverture | `analyzeJustificationCoverage` | `none` / `owner-attestation` / `target-proof` / `target-proof-contradictory` ; **`evaluation` est toujours `not-evaluated`** |
| Références de Preuve | `auditProofReferences` | réutilise `verifyProofReferences` (`js/genealogy-proofs.js:209-266`) sans redéfinir d'état |

**Règles respectées** : aucune Preuve `birth` n'est requalifiée en Preuve de date ou de lieu ; aucune attestation n'est créée pour représenter une Preuve existante ; aucune date, commentaire ou association n'est perdue ; les entrées sans correspondance sont explicitement `unmapped`.

**Constat de compatibilité** : `verifyProofReferences` est **exportée et testée mais jamais appelée par `js/app.js`** (recherche vérifiée : uniquement `js/genealogy-proofs.js` et `tests/genealogy-proofs.test.mjs`). Elle devient accessible aux futurs lots via `auditProofReferences`, sans être branchée à une suppression.

---

## 4. Associations entre documents et informations

**Fait vérifié** : la multi-sélection existe déjà là où le champ est un tableau, et se perd là où il est singulier.

| Objet | Référence documentaire | Comportement |
|---|---|---|
| Attestation | `documentIds` **tableau** | Plusieurs documents sans duplication du fichier (`js/app.js:15474`) |
| Source | `documentIds` **tableau**, dédoublonné (`js/source-document-model.js:90`) | Plusieurs documents sans copie — testé (`tests/source-document-model.test.mjs:100-114`) |
| Preuve | `documentId` **singulier** (`js/genealogy-proofs.js:63`) | une seule provenance par Preuve |

**Dérive identifiée** : le sélecteur partagé de documents de la contribution officielle est une vraie multisélection (`selectedGenealogySourceDocumentIds`, `js/app.js:11559-11624`), réutilisée en mode Preuve (`js/app.js:11572-11576`). Or `readProofGuidedFields()` ne conserve que le premier identifiant : `documentId: [...selectedGenealogySourceDocumentIds][0]` (`js/app.js:12288`). **Une sélection multiple est donc réduite silencieusement au premier document.**

`reportDocumentSelectionLoss({selectedDocumentIds, persistedDocumentId})` rend cette perte explicite (`selectedIds`, `persistedIds`, `droppedIds`, `truncated`) sans toucher au formulaire.

**Adaptation à arbitrer en R2.2** — deux options, aucune implémentée :
1. restreindre le picker à une seule sélection lorsque le type de contribution est `proof` (cohérent avec le modèle actuel) ;
2. accepter plusieurs documents et créer plusieurs Preuves liées au même `factId` dans une même opération (préserve le modèle sans le migrer).

Transformer `documentId` en tableau est explicitement **exclu** : il toucherait `genealogyProofs`, ses révisions, `backup-archive` (`js/backup-archive.js:128-145`) et les règles.

---

## 5. Limites des identifiants familiaux

`normalizedParentChildLinks(family)` dérive les paires de **`partnerIds × childIds`** et ne lit dans `parentChildLinks` que le `type` (`js/family-relations.js:12-20`).

Conséquences, toutes couvertes par `compareFamilyRelations(familyBefore, familyAfter)` :

| Situation | Identité legacy | Résultat du diagnostic |
|---|---|---|
| Réordonnement de `partnerIds`/`childIds` | inchangée | `unchanged`, 0 instable |
| Changement du `type` dans `parentChildLinks` | inchangée (seul le type varie) | `unchanged`, 0 instable |
| Suppression du contenu de `parentChildLinks` | inchangée (type → `unknown`) | `unchanged`, 0 instable |
| **Changement de `family.id`** (recréation, transfert) | **change** | `family-id-changed`, 4 instables |
| **Retrait d'un parent** de `partnerIds` | 2 relations disparaissent | `relation-removed` |
| **Ajout d'un enfant** à `childIds` | 2 relations apparaissent | `relation-created` |
| Édition seule de `parentChildLinks` | aucun lien ni créé ni retiré | 0 added, 0 removed — **le modèle n'autorise pas de corriger une extrémité par ce champ** |

Le code confirme la limite : `createParentChildRelationRecord` et `invalidateParentChildRelation` produisent un ID relationnel persistable, mais **rien ne l'écrit** — le commentaire du module le dit explicitement (`js/genealogy-identities.js:1-8, 62-64`).

Autre point vérifié : les Preuves guidées nouvelles ont toujours `relationshipId: ""` et portent l'union dans `familyId` (`js/app.js:12286-12287`). Seules les Preuves manuelles saisies en JSON peuvent porter un `relationshipId` arbitraire — `auditFamilyReferenceRisks` traite les deux cas (`proof-family-reference`, `proof-relationship-reference`, `proof-legacy-relationship-reference`).

**Aucune migration d'identifiant n'est faite dans R2.1.** La stratégie additive proposée pour R2.2/R2.3 : persister un `relationId` alloué une fois par lien, conservé par recréation sous un autre Foyer, avec période de coexistence pendant laquelle la clé legacy reste acceptée en lecture. Elle exige un arbitrage et des tests de transfert/dissociation préalables.

---

## 6. Risques d'intégrité et de suppression

### 6.1 Suppression de Personne — références orphelines

`removeDirectoryPersonPermanently` (`js/app.js:15594-15611`) écrit dans un `writeBatch` :
- supprime `people/{id}` ;
- reconstruit `partnerIds`/`childIds`/`parentChildLinks` des Familles et **supprime une Famille devenue sans partenaire** ;
- retire `id` de `documents[*].personIds` ;
- vide `tasks[*].personId`.

**Elle ne touche pas** `sourceDocuments.personIds`, `genealogyProofs.data.personIds` ni le sujet des `factConclusions`. `auditPersonReferenceRisks` distingue :
- `document-person-reference` → `managed` (traité par l'application) ;
- `source-person-reference`, `proof-person-reference`, `conclusion-person-reference` → `unmanaged` (**références orphelines potentielles**).

Côté serveur, `people` autorise `delete` à tout compte approuvé (`firestore.rules:513`) : le nettoyage n'est pas non plus garanti par les règles.

### 6.2 Suppression de Famille — perte d'attestations

`js/app.js:15598-15603` : si `partnerIds` devient vide, le `writeBatch` fait `batch.delete(famille)` — les `marriageAttestations` imbriquées sont alors perdues avec le document. `auditFamilyReferenceRisks` signale `family-attestation-embedded` avant toute opération, ainsi que les Preuves encore liées.

### 6.3 Suppression de Document

`removeDocument` (`js/app.js:13861-13909`) impose un instantané complet puis `documentDeletionBlockers` (`js/document-deletion-guard.js:18-46`) : **protection purement client**. Les règles `match /documents/{documentId}` autorisent `delete` à tout compte approuvé (`firestore.rules:545-547`), sans vérification de référence.

À l'inverse, les suppressions **officielles** sont protégées : `sourceDocuments` et `genealogyProofs` exigent `officialDeletionLockOwned` (`firestore.rules:623, 691`) et `deleteOfficial` interdit la suppression d'une Source référencée par une Preuve (`js/genealogy-collaboration-firestore.js:163-172`).

### 6.4 Dérive de lecture sur le sujet des Conclusions

**Fait vérifié** : `createConclusionRevision` ne persiste que `subject: {kind, id}` (`js/fact-conclusions.js:169-187`, validé à `:197-198`). Or `genealogyEntryBits` lit `revision.subjectKind` et `revision.subjectId` (`js/app.js:6472-6473`). Ces propriétés ne sont **jamais créées** : le nom de la personne n'entre donc pas dans le texte de recherche des Conclusions dans la vue Archives.

Impact limité mais réel : `personPageResearchMarkup` retrouve les Conclusions par `factId` de Preuve, pas par sujet (`js/app.js:2486-2487`), donc la fiche Personne reste correcte ; c'est la **recherche transverse dans Archives** qui est incomplète.

**Non corrigé dans R2.1** : la correction modifie un comportement de recherche visible, concerne `js/app.js` (donc l'artefact) et suppose de décider si l'on lit `subject.kind` ou si l'on complète le modèle. → **arbitrage demandé**.

### 6.5 Ce qui n'a pas été touché

Aucune modification de : `firestore.rules`, `document-deletion-guard.js`, `removeDocument`, `removeDirectoryPersonPermanently`, `journeySaveAttestation`, `journeyDeleteAttestation`, `lifeEventWriteAttestations`, `journeyWriteSnapshot`, du formulaire d'attestation, ni d'aucune collection.

Les fonctions de diagnostic sont **volontairement non branchées** : les intégrer à une suppression exige de décider ensemble du blocage, du détachement contrôlé et de la confirmation utilisateur, avec `npm run test:firestore` et des tests dédiés.

---

## 7. Fonctions techniques développées

Module unique, pur : **`js/justification-compat.js`** (aucun accès DOM/Firebase/réseau, aucune mutation des entrées).

| Fonction | Rôle |
|---|---|
| `collectAttestations({people, families})` | Recense les attestations persistées avec leur emplacement exact ; rapporte les champs mal typés, entrées sans ID ou invalides dans `excluded` |
| `auditAttestationReferences(attestation, context)` | Vérifie `documentIds`/`sourceIds`/`proofIds` : `present`, `missing`, `not-provided` (contexte absent ≠ référence manquante) + `issues` (`*-invalid`, `*-missing`, `attestation-id-invalid`, `attestation-incomplete`) |
| `auditAttestationCatalog(collected, context)` | Agrège le recensement et les audits par propriétaire/emplacement |
| `classifyProofTargetCompatibility(proof, targets)` | `exact` / `generic-ambiguous` / `unmapped` / `invalid` — ne requalifie jamais un type legacy |
| `classifyProofCatalog(proofs, targets)` | Comptes par statut, sans réécriture des Preuves |
| `reportDocumentSelectionLoss({selectedDocumentIds, persistedDocumentId})` | Révèle la réduction silencieuse d'une sélection multiple |
| `auditPersonReferenceRisks({…})` | Références d'une Personne, séparées `managed` / `unmanaged` |
| `auditFamilyReferenceRisks({familyId, families, proofs, people})` | Attestations imbriquées + Preuves familiales/relations, `found:false` si Foyer absent |
| `compareFamilyRelations(familyBefore, familyAfter)` | Identité legacy des liens : `unchanged`, `family-id-changed`, `relation-created`, `relation-removed` |
| `auditProofReferences(proofs, context)` | Passe-plat typé vers `verifyProofReferences`, états existants préservés |
| `analyzeJustificationCoverage({targets, proofs, attestations})` | Couverture en deux niveaux ; `evaluation` toujours `not-evaluated` |

Constantes exportées : `JUSTIFICATION_COMPAT_SCHEMA_VERSION`, `PROOF_TARGET_COMPATIBILITY`, `DOCUMENT_COVERAGE`, `REFERENCE_STATE`, `REFERENCE_SEVERITY`, `RELATION_IDENTITY_STATE`.

Aucune nouvelle collection Firestore, aucun branchement à `app.js`, aucun changement d'artefact.

---

## 8. Tests et résultats

**Nouveau fichier : `tests/justification-compat.test.mjs` — 10 tests, 10 réussis.**

Couverture :
1. recensement des 4 emplacements + non-mutation de l'entrée ;
2. attestations sans ID / sans date / champ non-tableau → `excluded` + `issues` ;
3. références : contexte absent (`not-provided`), présent (`present`), manquant (`missing` + `issues`) et normalisation sans mutation ;
4. Preuves `birth` génériques → `generic-ambiguous` avec les deux cibles candidates, `unmapped`, `invalid` ; catalogue sans réécriture ;
5. sélection multiple de documents → `truncated` / `droppedIds`, cas complet et cas « rien persisté » ;
6. références de Personne → `managed` vs `unmanaged`, sans mutation ;
7. attestations imbriquées et Preuves du Foyer → 4 codes, `found:false` pour un Foyer absent, sans simulation de suppression ;
8. identité legacy → réordonnement/type stables, changement de Foyer instable, retrait/ajout de membre, `parentChildLinks` seul sans effet ;
9. `auditProofReferences` → réutilise `valid`/`missing`/`not_checked` sans nouveau statut ;
10. couverture → `target-proof-contradictory`, `owner-attestation`, `none`, `evaluation` toujours `not-evaluated`, non-mutation.

Contrôles exécutés pour le lot :
- `node --check` sur `js/justification-compat.js` et `tests/justification-compat.test.mjs` : OK.
- `node --test tests/justification-compat.test.mjs` : **10/10**.
- `npm run test:unit` (suite complète) : **607/607, 0 échec**.
- `npm run check:assets` : OK, jeton `27-document-file-storage-20261122-1`.
- `git diff --check` : OK.

Aucun test n'a été désactivé, assoupli ou retempsé.

---

## 9. Fichiers modifiés

| Fichier | Action |
|---|---|
| `js/justification-compat.js` | **créé** — module pur de diagnostic/compatibilité |
| `tests/justification-compat.test.mjs` | **créé** — 10 tests |
| `docs/RECHERCHES_R2_1_AUDIT.md` | **créé** — le présent rapport |

**Aucun autre fichier modifié.** En particulier inchangés : `js/app.js`, `index.html`, `js/life-journey.js`, `js/genealogy-proofs.js`, `js/fact-conclusions.js`, `js/document-deletion-guard.js`, `js/family-relations.js`, `js/genealogy-identities.js`, `firestore.rules`, `js/justification-targets.js`, `tests/*` existants.

### État du déploiement recette

**Aucun déploiement effectué, et aucun n'est nécessaire.** `js/justification-compat.js` n'est référencé ni dans l'import map de `index.html`, ni par un import de `js/app.js` ou d'un module consommé par lui : le `collectFrontendFiles` de `scripts/build-recette.mjs:65-94` suit les références depuis les entrypoints et n'atteint donc pas ce fichier. L'artefact `dist-recette` est identique à celui déjà publié ; `npm run check:assets` reste OK sans bump.

Contraintes respectées : aucun accès ni écriture Firebase, aucune migration, aucune modification de données généalogiques, aucun changement d'interface, aucun renommage, aucun composant supprimé, aucun changement de règle, aucune modification d'opération de suppression, aucun moteur IA/HTR, aucun développement R2.2/R2.3, aucun déploiement ni merge vers `main`.

---

## 10. Arbitrages nécessaires avant R2.2

1. **Vocabulaire UI « Justificatif »** : confirmer s'il désigne une agrégation (Attestation + Preuve) ou remplace progressivement les deux libellés dans les écrans, sans toucher aux noms de collections.
2. **Conservation des références lors d'une modification d'attestation** : trancher l'asymétrie `documentIds` conservés vs `sourceIds`/`proofIds` retirés sur les éléments du Parcours (`js/app.js:15472-15473`), et le cas `pendingEntry`/`pendingRelation`. Décider si la règle est « conserver toujours », « filtrer toujours » ou « demander explicitement ».
3. **Multi-document d'une Preuve** : restreindre le picker à 1 sélection, ou créer plusieurs Preuves liées au même `factId` dans une opération (§4).
4. **Sujet des Conclusions** : lire `subject.kind/id` ou compléter le modèle, et couvrir par un test de recherche (`§6.4`).
5. **Intégrité des suppressions** : définir ensemble blocage / confirmation / détachement contrôlé pour `people`, `families` et `documents`, avec `npm run test:firestore` et tests d'émulateur — et seulement ensuite brancher `auditPersonReferenceRisks` et `auditFamilyReferenceRisks`.
6. **ID relationnel persistant** : arbitrer le champ `relationId` et son coexistence avec la clé legacy (§5), avec tests de transfert/dissociation.
7. **Couverture documentaire vs évaluation** : confirmer les libellés des états `none` / `owner-attestation` / `target-proof` / `target-proof-contradictory` et le fait qu'aucune évaluation ne soit déduite avant une décision humaine.
8. **Indexation des transcriptions** : condition préalable à toute recherche transversale (toujours hors périmètre R2.1).

**R2.2 et R2.3 non commencés.** En attente des décisions ci-dessus.
