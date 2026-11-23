# Recherches — Lot R2.2 : justificatifs précis, références conservées, suppression protégée

> **Périmètre livré** : évolution du parcours « Ajouter une attestation » vers des justificatifs précis, réutilisables et traçables — conservation des références, association à des cibles R1 précises, sélection multiple de documents, création groupée de Preuves, protection des suppressions, lecture des Conclusions.
> **Aucune modification** de `firestore.rules`, du modèle Firestore, des permissions, des fixtures v16-v18 ni de `family-relations.js` (figé). Aucune migration de données. Aucune écriture en production.
> **Livraison** : commit `cc0d693` sur `recette`, poussé sur `origin/recette`, build `dist-recette` et déploiement **recette uniquement** (`https://la-nostra-storia-recette.web.app`). Production (`family-tree-c2fe2` / `lanostrastoria.web.app`) inchangée.

---

## 1. Décisions de conception retenues

| Question | Décision | Conséquence |
|---|---|---|
| Terme affiché | « Justificatif » | Les modèles techniques `Attestation`, `Preuve`, `Source`, `Conclusion` et leurs champs Firestore **ne sont pas renommés**. |
| Deux dimensions | `documentCoverage` (`none`/`owner-attestation`/`target-proof`/`target-proof-contradictory`) et `evaluation` (`not-evaluated`/`probable`/`établie`/`contestée`) strictement indépendantes | Aucune déduction automatique d'évaluation à partir de la couverture. |
| `documentId` d'une Preuve | **singulier**, jamais un tableau | Une Preuve par couple (fait, document) ; la sélection multiple est réalisée par **création groupée**. |
| `factType` d'une Preuve ciblée | `target.targetType` du registre R1 (ex. `person.birth.date`) | Affichage via `proofFactLabel` qui retombe sur `JUSTIFICATION_TARGET_LABELS`. |
| `factId` d'une Preuve ciblée | `target.factId` canonique, à défaut `target.id` stable R1 | `proofFactIdForTarget` (`js/justification-compat.js:532`). |
| Permissions | **inchangées** : création `genealogyProofs` = `isAdmin()` (`firestore.rules:673-681`) | Arbitrage **documenté**, jamais contourné : les non-administrateurs voient une mention « réservée aux administrateurs » au lieu du sélecteur. |
| Relation parent-enfant | **aucune écriture** de `relationId` | `family-relations.js` est figé (comparaison octet vs `tests/fixtures/v18`) et `normalizedParentChildLinks` écraserait toute clé inconnue. `planFamilyRelationIds` produit un plan **non exécuté**. |
| Contextes préparés | Section masquée en `pendingEntry` / `pendingRelation` | Une union en cours de création n'a pas encore de propriétaire persistant. |

---

## 2. Implémentation

### 2.1 §5 — Conservation des références d'attestation

- **Fonction pure** `mergeAttestationReferences` (`js/justification-compat.js:675`) : distingue sélection visible, retrait explicite (`removedIds`) et **indisponibilité contextuelle**, qui **conserve** la référence et la signale.
- **Branche `pendingRelation`** (`js/app.js`, édition d'une attestation préparée) : utilisait `selected*.filter(available)` et **perdait** les références déjà enregistrées non visibles dans le contexte. Elle passe par `mergeAttestationReferences` et affiche un toast de conservation.
- **Branche principale** : `unavailableExistingSourceIds` / `unavailableExistingProofIds` étaient neutralisées (`majorTarget ? … : []`) alors que les Documents étaient toujours conservés — **asymétrie corrigée** (`js/app.js:15775`), les trois types suivent la même règle.
- Toast unique combinant enregistrement + références conservées + bilan des Preuves.

### 2.2 §6/§8 — Rubrique « Justificatif précis »

Générée dans `journeyAttestationFormMarkup` (`js/app.js:2827`, section `journeyProofPreciseSection` à `js/app.js:2980`) : **aucune modification de `index.html`** hormis l'import map et le jeton de cache.

Contenu (rôle administrateur uniquement) :

1. **Faits précis** : cibles R1 du propriétaire — `enumerateJustificationTargets({ people })` pour une Personne, `{ families }` pour une union — avec recherche texte et pagination (8 par page).
2. **Relation documentaire** : `<select>` sur `PROOF_RELATION_LABELS` (`supports` par défaut).
3. **Documents à joindre** : recherche sur **tous** les documents via `searchLinkedDocuments`, pagination, sélection multiple.
4. **Récapitulatif** : `N faits × M documents → K Preuves à créer`.

État local (`journeyProofState`, `js/app.js:2874`) : requêtes, pages et **ensembles de sélection** persistés indépendamment du rendu, donc les sélections hors page ne sont jamais perdues. Seules les listes sont redessinées lors d'une saisie : le focus et le curseur sont conservés. `journeyFormValues` / `restoreJourneyFormValues` capturent et restituent cet état.

**Création groupée** `journeyCreatePreciseProofs` (`js/app.js:15601`) :

- `planProofCreation` (`js/justification-compat.js:561`) produit un plan **pur** : une entrée par couple (cible, document), `documentId` toujours singulier ; une cible de Foyer sans participants résolus est reportée dans `unresolved` plutôt que d'inventer un sujet.
- `partitionProofPlans` (`js/justification-compat.js:638`) sépare les paires **déjà portées** (recréation interdite) de celles à créer ; aucune Preuve existante n'est modifiée.
- Chaque plan est validé par `validateGenealogyProof` puis écrit par le chemin canonique `genealogyStore.createOfficial({ type: "proof", … })` (tête + révision + événement).
- **Échec partiel** : une création en échec n'interrompt pas les suivantes et n'efface rien ; le toast annonce créés / déjà présents / échecs.

### 2.3 §10 — Protection de la suppression de Personne

`removeDirectoryPersonPermanently` (`js/app.js:15908`) :

1. `confirm(…)` **reste la première étape** — aucun changement pour `tests/person-dialog-actions.test.mjs` et `tests/modal-action-menus.test.mjs`, qui comptent exactement une confirmation.
2. `planPersonDeletionImpact` (`js/justification-compat.js:740`) évalue, **sans écrire**, les références des collections réellement chargées : `documents` (gérées), `sourceDocuments`, `genealogyProofs`, `factConclusions` (non gérées), plus les **familles emportées** (`partnerIds` réduits à vide → `batch.delete` actuel) et leurs attestations imbriquées / Preuves liées.
3. Toute référence `unmanaged` **bloque avant la moindre écriture** et le toast liste les motifs.

### 2.4 §11 — Lecture des Conclusions

`genealogyEntryBits` (`js/app.js:6670`) lit `revision.subject.kind` / `revision.subject.id` — la forme réellement persistée par `createConclusionRevision` — avec repli sur l'ancien plat `subjectKind` / `subjectId`. Les deux générations de révisions restent lisibles.

### 2.5 Libellés de faits

`proofFactLabel` (`js/app.js:6436`) : `PROOF_FACT_KIND_LABELS` → `JUSTIFICATION_TARGET_LABELS` (R1) → valeur machine. Export ajouté à `js/justification-targets.js` avec les libellés hoistés (`PERSON_RESIDENCE_TARGETS`, `PERSON_PROFESSION_TARGETS`, `PERSON_LIFE_EVENT_TARGETS`, `NAME_VARIANT_TARGET_LABELS`, `AD_HOC_TARGET_LABELS`).

---

## 3. Limites et arbitrages documentés

| Limite | Traitement |
|---|---|
| **Snapshot incomplet** : seules les collections chargées peuvent être auditées | Le blocage ne porte que sur les références **connues**. Une Preuve ou une Conclusion non chargée au moment de la suppression ne serait pas détectée. À corriger par un audit serveur dédié, hors de ce lot. |
| **`relationshipId` non persisté** | `planFamilyRelationIds` (`js/justification-compat.js:782`) expose `requiresWrite: true` et un identifiant **proposé** ; il n'est jamais exécuté. Toute écriture de `relationId` dans `families/{id}` exige une migration approuvée. |
| **Permissions `genealogyProofs` = admin** | Les non-administrateurs ne voient pas le sélecteur. Élargir les règles serait un changement `firestore.rules` exigeant `npm run test:firestore` et une publication séparée — **non fait**. |
| **Contextes préparés** (union en création, élément du Parcours) | Section masquée : pas de propriétaire persistant → pas de cible R1. Le parcours historique Documents/Sources/Preuves reste utilisable. |
| **`familyId` d'une Preuve de Foyer** | Renseigné, `personIds` dérivés de `partnerIds ∪ childIds` du Foyer. Si le Foyer n'est pas résolvable, la cible est reportée (`unresolved`) et aucune Preuve n'est créée. |

---

## 4. Tests

| Campagne | Résultat |
|---|---|
| `npm run test:unit` | **614 / 614** (dont 17 pour `justification-compat`, 12 pour `justification-targets`) |
| `npm run test:browser` (campagne complète, 1 worker) | **409 tests — 408 pass, 0 fail, 1 skipped** |
| `npm run check:assets` | OK — jeton `28-justificatifs-precis-20261123-1`, 62 références `?v=` + meta = 63 |
| `npm run build:recette` | OK — 263 ressources servies en local, jeton présent dans `dist-recette/index.html` |
| `git diff --check` | OK |

**Nouveaux tests**

- `tests/justification-compat.test.mjs` (+7) : fusion de références (sélection / retrait explicite / indisponibilité contextuelle / dédoublonnage), planification d'une Preuve par couple cible × document (dont cible de Foyer sans participants), partitionnement sans mutation, identifiant et type de fait, impact de suppression (managé / bloquant / famille emportée), plan de relation non exécuté, correspondance `factId` puis identifiant stable.
- `tests/justification-precise-association.test.mjs` (nouveau, navigateur) : rubrique réservée aux administrateurs, publication des cibles R1, 4 relations, pagination et recherche des documents, recherche des cibles, récapitulatif, **aucune Preuve sans enregistrement valide**, puis création groupée avec **non-recréation d'une paire déjà portée** (2 sélectionnées → 1 appel), `factId`/`factType`/`documentId`/`personIds`/`relation`/`sourceValue: null` vérifiés.

**Tests adaptés (attendus mis à jour, jamais affaiblis)**

- `tests/person-detail-page.test.mjs` : la liste des rubriques du formulaire d'attestation passe de 5 à **6** (ajout de « Justificatif précis »), le nombre de `.attestation-form-panel` de 5 à **6** — à deux endroits.

---

## 5. Corrections hors périmètre, justifiées

1. **`tests/family-parent-addition-ui.test.mjs`** — l'extraction du bloc `addSecondParentToCurrentFamily` cherchait `"\n}\n"` alors que Git sort `js/app.js` en **CRLF** sur Windows (`core.autocrlf=true`) : `end` valait `-1` et l'assertion échouait **y compris sur un checkout vierge de `HEAD`** (vérifié par `git checkout-index`). Remplacé par une recherche `\r?\n\}\r?\n` : même sémantique, insensible à la fin de ligne, conformément à la règle du dépôt (« sous Windows, utiliser `[\r\n]` dans les regex de test »).
2. **`index.html`** — entrées d'import map ajoutées pour `./js/justification-compat.js` et `./js/justification-targets.js` : `tests/hosting-cache.test.mjs` exige une URL versionnée pour **chaque** module de `js/` référencé par un import relatif.
3. **Jeton de cache** — bump déterministe `27-document-file-storage-20261122-1` → `28-justificatifs-precis-20261123-1` via `npm run bump:assets`, puis `check:assets` + rebuild.

---

## 6. Artefacts de livraison

| Élément | Valeur |
|---|---|
| Branche | `recette` |
| Commit | `cc0d693` — `feat(recherches): justificatifs précis, références conservées et suppression protégée` |
| Push | `origin/recette` (`ae4e51a..cc0d693`) |
| Fichiers | 9 — `css/design-system.css`, `index.html`, `js/app.js`, `js/justification-compat.js`, `js/justification-targets.js`, 3 tests adaptés, 1 test nouveau |
| Jeton assets | `28-justificatifs-precis-20261123-1` |
| Build | `dist-recette/` (263 fichiers, 8 852 454 octets) |
| Déploiement | `firebase deploy --only hosting --project la-nostra-storia-recette` — **release complete** |
| URL recette | `https://la-nostra-storia-recette.web.app` |
| Production | **non touchée** (aucun deploy, aucune règle publiée, aucune donnée écrite) |

---

## 7. Non commencé (R2.3)

Aucun travail de R2.3 n'a été entamé : ni refonte du vocabulaire global « Attestation → Justificatif », ni audit serveur des références orphelines, ni migration d'identifiants relationnels, ni évolution des règles Firestore.
