# Règles Firestore — hypothèses concurrentes de naissance et de décès (lot 2C.5-A)

Le fichier `firestore.rules` du dépôt est **gelé** (pin `tests/fixtures/v18`, testé par
`final-qa.test.mjs`). Ce lot est strictement **additif** : deux collections neuves
(`factHypotheses`, `factHypothesisRevisions`) et **deux conditions complémentaires sur
`match /people`** (validation de l'ancre `people.retainedHypothesis`). Aucune règle
existante n'est réécrite, aucune collection existante n'est touchée.

⚠️ **Ne pas modifier `firestore.rules` du dépôt.** La publication se fait manuellement
via **Firebase Console → Firestore → Règles** (process identique à
`DEMARCHES_RULES.md`) : copier les blocs ci-dessous **avant** la règle finale
`match /{document=**} { allow read, write: if false; }`, sauf l'amendement `people`
qui se place dans le `match /people/{personId}` existant. Aucun `firebase deploy`.

**État : préparé et validé localement, NON publié.** Publication en production
uniquement avec l'accord explicite de François ; publier d'abord sur le projet
recette (`la-nostra-storia-recette`), valider, puis sur `family-tree-c2fe2`.

## Source exacte du texte à publier

Le texte validé est **`FACT_HYPOTHESES_RULES.candidate.rules`** (règles complètes du
projet + blocs du lot), régénérable à tout moment depuis le baseline gelé :

```bash
node scripts/build-fact-hypotheses-rules-candidate.mjs
```

Trois insertions (repérées par leur marqueur de commentaire, jamais par numéro de
ligne) :

1. **Helpers** — bloc partant par `// Hypothèses concurrentes de naissance et de
   décès (lot 2C.5-A) :` juste **après** la fermeture de `function validPerson()`,
   jusqu'à la fin de `validFactHypothesisRevision` (fonctions définies avant tout
   usage, y compris par `match /people`).
2. **Collections** — bloc partant par `// Hypothèses concurrentes de naissance et de
   décès (lot 2C.5-A) :` contenant `match /factHypotheses/{hypothesisId}` et
   `match /factHypothesisRevisions/{revisionId}`, inséré **avant** le commentaire
   `// Aucun autre document Firestore n'est exposé.` (le catch-all reste en dernier).
3. **Amendement people (point sensible — le seul texte existant qui est touché)** :

```text
    match /people/{personId} {
      allow read, delete: if isApproved();
      allow create: if isApproved() && validPerson() && validUpdatedBy()
        && validPersonTreeReference() && validPersonTreeAssignmentOnCreate()
        && validFactHypothesisAnchorAfter(personId);
      allow update: if isApproved() && validPerson() && validUpdatedBy()
        && validPersonTreeReference()
        && validFactHypothesisAnchorAfter(personId)
        && unanchoredRetainedReleasedAfter()
        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['treeId', 'treeAssignmentState'])
          || (isAdmin() && validActivePersonTreeReference()));
    }
```

## Invariants couverts par la version candidat

- Une seule hypothèse retenue par personne et par information : toute hypothèse
  `retained` impose `getAfter(people).retainedHypothesis[fieldKey] == hypothesisId`
  **et** une fiche dont le champ structuré correspond à la valeur de l'hypothèse
  (`getAfter`, donc dans la même transaction que l'écriture de l'ancre).
- Inversement, `people.retainedHypothesis` ne peut viser qu'une hypothèse existante,
  de cette personne et de ce champ, au statut `retained`, de valeur égale à la fiche
  — **garde-fou serveur** contre une édition directe du champ retenue dans la fiche.
- Sortie de « retenue » : l'hypothèse abandonnée impose que l'ancre a **basculé
  vers une AUTRE hypothèse** dans la même transaction (`retainedReplacedAfter`) ;
  jamais une simple suppression d'ancre, jamais de modification isolée de l'ancre
  (`unanchoredRetainedReleasedAfter` côté `people`).
- **Justification obligatoire** au remplacement d'une retenue (constatée avant
  transaction par `get(people)`), facultative à la première sélection.
- **Matrice des transitions de statut appliquée côté serveur** (voir ci-dessous) :
  aucune transition hors matrice n'est acceptée, quelle que soit l'écriture
  (interface ou SDK direct).
- **Hypothèse `deleted` verrouillée** : AUCUNE écriture avec statut `deleted`
  (valeur, justification, associations, métadonnées) ; la restauration est la
  seule écriture possible et doit laisser valeur, attestations et justification
  strictement identiques (`data == previous`), pour revenir à `alternative`.
- **Réexamen (`rejected → alternative`) verrouillé côté serveur** : justification
  non vide exigée, valeur / attestations / `documentIds` / `sourceIds` /
  `proofIds` strictement identiques, révision `reexamined` neuve et cohérente —
  la retenue en cours, l'ancre et la fiche ne sont jamais touchées (aucune
  écriture `people` n'accompagne cette transition).
- **Traçabilité obligatoire** : toute écriture d'hypothèse (création, transition,
  correction, attestations) exige une **révision neuve dans la même transaction
  ou le même lot** (`freshHypothesisRevisionAfter` : identifiant nouveau,
  `createdAt == request.time`, auteur = auteur de la requête, `objectId` correct) ;
  toute révision exige l'inverse côté tête (`getAfter(tête).currentRevisionId ==
  revisionId`, statut et valeur de l'instantané identiques à la tête écrite,
  chaînage `previousRevisionId` sur la tête courante avant écriture).
- `retained → deleted` et toute suppression physique restent refusés
  (`allow delete: if false`) ; les suppressions sont logiques (`status: deleted`).
- Identité figée d'une hypothèse (`personId`, `fieldKey`, `authorUid`,
  `initialFromFiche` immuables), formes de valeur validées (dates `validGenealogyDate`,
  lieux bornés), statuts et opérations bornés, clés fermées (`hasOnly`).
- Révisions en création seule (immuables), auteur protégé
  (`authorUid == request.auth.uid`), rattachées à une hypothèse existante de
  même personne et même champ ; `updatedBy`, s'il est présent, doit appartenir
  à l'auteur de la requête (modèle `validUpdatedBy`).
- Lectures réservées aux comptes approuvés (`isApproved`), comme `people`.

## Matrice des transitions (côté serveur)

Implémentée par `validFactHypothesisStatusTransition` (dépliage sans boucle,
sans fonction d'ordre supérieur) et appliquée à **toute** mise à jour
d'hypothèse, indépendamment du client :

| Statut initial | Statut cible | Règles candidat | Remarque |
|---|---|---|---|
| alternative | retenue | **Autorisé** | ancre cohérente + justification si remplacement + révision neuve |
| alternative | écartée | **Autorisé** | révision neuve |
| alternative | supprimée | **Autorisé** | révision neuve |
| écartée | retenue | **Autorisé** | ancre cohérente + justification si remplacement + révision neuve |
| écartée | alternative | **Autorisé** | **Réexamen** : justification obligatoire, valeur/attestations/références inchangées, révision `reexamined` |
| écartée | supprimée | **Autorisé** | révision neuve |
| retenue | alternative | **Autorisé** | uniquement avec bascule d'ancre vers une autre retenue dans la même transaction |
| retenue | écartée | **Refusé** | matrice |
| retenue | supprimée | **Refusé** | matrice (aucune suppression d'une retenue) |
| supprimée | alternative | **Autorisé** | restauration : valeur, attestations et justification inchangées, révision `restored` |
| supprimée | retenue | **Refusé** | matrice |
| supprimée | écartée | **Refusé** | matrice |
| même statut (alternative / écartée / retenue) | — | **Autorisé** | champs modifiables uniquement, identité figée, révision neuve |
| même statut `deleted` | — | **Refusé** | aucun verrouillage contournable : toute écriture sur une supprimée est interdite |

**Réexamen (`rejected → alternative`, action « Réexaminer ») :** décision
validée en fin de lot 2C.5-A, alignée des deux côtés (module métier
`ALLOWED_TRANSITIONS` + matrice des règles — l'ancienne divergence documentée
est ainsi clôturée). Côté serveur, la transition est refusée si : justification
absente (`data.justification.size() > 0`), valeur, attestations ou références
documentaires (`documentIds`/`sourceIds`/`proofIds`) modifiés dans la même
opération, révision absente ou incohérente (fraîcheur, auteur, instantané,
chaînage), ancre modifiée (règles `people` inchangées), ou utilisateur non
approuvé (`isApproved`, `authorUid == request.auth.uid`). Côté client, le store
`reexamineHypothesis` exige de plus que l'état de départ soit bien `rejected`
(`operation: "reexamined"`).

## Validation locale effectuée (émulateur, règles non publiées)

```bash
node scripts/build-fact-hypotheses-rules-candidate.mjs
& ".\node_modules\.bin\firebase.cmd" emulators:exec --only firestore,auth --project family-tree-emulator-test --config firebase.fact-hypotheses.candidate.json "node --test tests/fact-hypotheses-rules.mjs"
```

Résultat : **26/26 tests OK** — parcours complets avec le vrai store
(`js/fact-hypotheses-store.js`) : promotion de la fiche, remplacement justifié,
correction, rejet, suppression logique, restauration tracée, **réexamen
(`rejected → alternative`) avec justification et conservation de la valeur, des
attestations, des références, de l'ancre et de la retenue**, association
d'attestation (ajout, remplacement de rôle sans doublon, historisation) ; matrice
autorisée écartée → retenue ; et refus vérifiés, écriture SDK directe à l'appui,
des transitions interdites (retenue → écartée/supprimée, supprimée →
retenue/écartée), du réexamen sans justification ou modifiant valeur/attestations,
d'une hypothèse `deleted` modifiée, d'une restauration accompagnée d'une
modification de valeur, d'un changement de statut sans révision fraîche ou avec
révision incohérente, d'un remplacement sans justification, d'un retrait d'ancre
sans synchronisation, d'une édition directe divergente, d'une ancre fantôme, d'un
changement d'identité, d'une suppression physique, d'une révision orpheline ou
modifiée, et de la lecture anonyme. Les écritures refusées peuvent loguer
`evaluation error` (fail-closed, ex. ternaire évaluant `getAfter` sur une
hypothèse absente) : le verdict est alors le refus, comportement voulu.

`npm run test:firestore` continue de tester le `firestore.rules` **gelé du dépôt** :
il ne couvre pas ces blocs tant qu'ils ne sont pas publiés. La couverture des blocs
candidat reste `tests/fact-hypotheses-rules.mjs` (fichier non auto-découvert,
démarrage exclusif via la commande ci-dessus).

## Limites assumées (documentées, voulues)

- **Pas de boucle dans les rules** (`every`/`filter`/`map` inexistants) : les quatre
  clés d'ancre sont dépliées ; la structure des attestations (rôle, identifiant) est
  validée côté client (`js/fact-hypotheses.js`, module pur testé) — les rules ne
  bornent que la taille de la liste. La matrice des transitions et le verrou
  `deleted` sont, eux, **appliqués côté serveur** (voir ci-dessus).
- **Justification de remplacement désormais tenue côté serveur** : la sortie de
  `retained` impose la bascule d'ancre vers une autre retenue dans la même
  transaction, et toute promotion remplaçante exige une justification non vide —
  il n'existe plus de chemin « libération seule puis promotion sans
  justification ». Restent non contrôlables par les rules : la **qualité** du
  texte de justification et la toute première promotion d'un champ vierge
  (justification facultative par conception).
- Le libellé `operation` d'une révision n'est pas recoupé avec le statut visé
  (l'instantané `data.status`/`data.value` l'est strictement avec la tête
  écrite) : c'est un résidu d'audit sémantique, sans effet sur l'intégrité.
- **Révision exigée dans la même transaction/le même lot que la tête** : aucune
  importation ne peut réécrire une hypothèse sans réécrire sa révision
  simultanément (conséquence voulue — voir « Compatibilité » ci-dessous).
- `authorUid == request.auth.uid` à la création d'hypothèse et de révision :
  une importation future devra soit réécrire l'auteur avec l'auteur courant de
  la restauration, soit faire évoluer cette règle — décision à prendre **avant**
  toute restauration serveur (aucun chemin d'écriture d'import n'existe aujourd'hui).
- Suppression d'une personne : ses hypothèses restent (détectées côté UI par
  `detectFactHypothesisConflicts`, code `FACT_HYPOTHESIS_PERSON_MISSING`).
- Sans publication des règles, **toute lecture/écriture des deux collections est
  refusée** : l'application doit décharger silencieusement (chargeur tolérant) et
  masquer les commandes de gestion des hypothèses — comportement voulu, testé côté UI.

## Compatibilité sauvegarde / restauration

- Les règles imposent que toute hypothèse `retained` soit accompagnée de l'ancre
  dans la même transaction ou d'une ancre déjà engagée : lors d'une importation
  future de `factHypotheses`, écrire **`people` d'abord** (les écritures `people`
  seules valident l'ancre grâce à `getAfter`), puis **chaque hypothèse AVEC sa
  révision dans le même lot** (fraîcheur `createdAt == request.time` et chaînage
  exigeés) ; une révision écrite dans un lot séparé serait refusée.
- Les archives actuelles (v4) ne contiennent pas ces collections et la restauration
  v5 reste en prévisualisation seule : rien à migrer aujourd'hui. La prévisualisation
  affiche les conflits d'identifiants, les erreurs d'intégrité (révisions,
  personnes, ancre, attestations manquantes) et l'avertissement
  `FACT_HYPOTHESES_RULES_UNAVAILABLE` lorsque les règles ne sont pas publiées.
- `updatedBy` retiré par l'import : les règles l'acceptent absent (comme `people`).

## Régénération

Toute évolution du baseline ou du bloc se fait par le générateur (jamais à la main,
jamais dans `firestore.rules`) :

```bash
node scripts/build-fact-hypotheses-rules-candidate.mjs   # échoue si le baseline drift
git diff --stat firestore.rules                            # doit rester vide
```
