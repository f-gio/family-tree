// Génère FACT_HYPOTHESES_RULES.candidate.rules — règles candidat du lot 2C.5-A
// pour une VALIDATION LOCALE sur émulateur. firestore.rules (gelé par les tests
// de fixtures) n'est ni lu en écriture ni modifié : seul un splice de bytes est
// réalisé, en conservant l'encodage exact du fichier source.
//
// Trois insertions, toutes réversibles et vérifiées (échec si le baseline drift) :
//   1. helpers additionnels après function validPerson() (avant toute utilisation) ;
//   2. les deux match factHypotheses / factHypothesisRevisions avant le catch-all ;
//   3. deux conditions sur match /people (création et mise à jour) — seul point
//      sensible : c'est l'amendement people décrit dans FACT_HYPOTHESES_RULES.md.
//
// Usage : node scripts/build-fact-hypotheses-rules-candidate.mjs

import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../firestore.rules", import.meta.url);
const target = new URL("../FACT_HYPOTHESES_RULES.candidate.rules", import.meta.url);

const BLOCK_FUNCTIONS = `

    // Hypothèses concurrentes de naissance et de décès (lot 2C.5-A) :
    // helpers additionnels pour deux collections neuves et pour la cohérence
    // de l'ancre people.retainedHypothesis. Aucune règle existante n'est
    // modifiée par ce bloc ; les deux conditions sur people sont ajoutées
    // séparément (création et mise à jour du match /people).
    function validFactHypothesisId(id) {
      return id is string && id.matches('^[A-Za-z0-9._-]{1,180}$');
    }

    function validFactHypothesisFieldKey(key) {
      return key in ['birth.date', 'birth.place', 'death.date', 'death.place'];
    }

    function validFactHypothesisValue(fieldKey, value) {
      return value is map
        && ((fieldKey in ['birth.date', 'death.date'] && validGenealogyDate(value))
          || (fieldKey in ['birth.place', 'death.place']
            && 'place' in value
            && value.place is string
            && value.place.size() <= 300
            && (!('placeInfo' in value) || value.placeInfo == null || value.placeInfo is map)));
    }

    // Les rules Firestore n'offrent ni boucle ni fonction d'ordre supérieur
    // (every/filter/map inexistants) : la structure des attestations (rôle,
    // identifiant) est validée côté client par js/fact-hypotheses.js — module
    // pur couvert par ses tests ; les rules bornent la liste.
    function validFactHypothesisAttestations(attestations) {
      return attestations is list && attestations.size() <= 50;
    }

    function factHypothesisPersonPath(personId) {
      return /databases/$(database)/documents/people/$(personId);
    }

    function factHypothesisPath(hypothesisId) {
      return /databases/$(database)/documents/factHypotheses/$(hypothesisId);
    }

    // Valeur de la fiche (après transaction) égale à la valeur de l'hypothèse.
    function peopleValueMatchesHypothesis(personData, fieldKey, value) {
      return fieldKey == 'birth.date'
        ? ('birthDateInfo' in personData && personData.birthDateInfo == value)
        : fieldKey == 'death.date'
          ? ('deathDateInfo' in personData && personData.deathDateInfo == value)
          : fieldKey == 'birth.place'
            ? ('place' in personData
              && personData.place == value.place
              && (('birthPlaceInfo' in personData ? personData.birthPlaceInfo : null)
                == ('placeInfo' in value ? value.placeInfo : null)))
            : ('deathPlace' in personData
              && personData.deathPlace == value.place
              && (('deathPlaceInfo' in personData ? personData.deathPlaceInfo : null)
                == ('placeInfo' in value ? value.placeInfo : null)));
    }

    function peopleFactMatchesAfter(personId, fieldKey, value) {
      let personPath = factHypothesisPersonPath(personId);
      return existsAfter(personPath)
        && peopleValueMatchesHypothesis(getAfter(personPath).data, fieldKey, value);
    }

    function anchoredRetainedAfter(personId, fieldKey, hypothesisId) {
      let personPath = factHypothesisPersonPath(personId);
      return existsAfter(personPath)
        && 'retainedHypothesis' in getAfter(personPath).data
        && getAfter(personPath).data.retainedHypothesis[fieldKey] == hypothesisId;
    }

    // Matrice des transitions de statut, en miroir exact de
    // ALLOWED_TRANSITIONS dans js/fact-hypotheses.js (y compris le réexamen
    // « écartée → alternative » validé en fin de lot 2C.5-A — voir
    // FACT_HYPOTHESES_RULES.md). Sans boucle : dépliage explicite.
    // Même-statut autorisé sauf deleted (aucune modification d'une
    // hypothèse supprimée).
    function validFactHypothesisStatusTransition(fromStatus, toStatus) {
      return fromStatus == toStatus
        ? fromStatus != 'deleted'
        : (fromStatus == 'alternative' && toStatus in ['retained', 'rejected', 'deleted'])
          || (fromStatus == 'rejected' && toStatus in ['retained', 'alternative', 'deleted'])
          || (fromStatus == 'retained' && toStatus == 'alternative')
          || (fromStatus == 'deleted' && toStatus == 'alternative');
    }

    // Sortie de « retenue » : l'ancre doit avoir basculé vers une AUTRE
    // hypothèse dans la même transaction — jamais une simple suppression de
    // l'ancre (aucun contournement par modification isolée).
    function retainedReplacedAfter(personId, fieldKey, oldHypothesisId) {
      let personPath = factHypothesisPersonPath(personId);
      return existsAfter(personPath)
        && 'retainedHypothesis' in getAfter(personPath).data
        && getAfter(personPath).data.retainedHypothesis.keys().hasAny([fieldKey])
        && getAfter(personPath).data.retainedHypothesis[fieldKey] != oldHypothesisId;
    }

    // Avant la transaction, une autre hypothèse était retenue pour ce champ :
    // la justification devient obligatoire (remplacement atomique uniquement).
    function replacedAnotherRetained(personId, fieldKey, hypothesisId) {
      let personPath = factHypothesisPersonPath(personId);
      return exists(personPath)
        && 'retainedHypothesis' in get(personPath).data
        && get(personPath).data.retainedHypothesis.keys().hasAny([fieldKey])
        && get(personPath).data.retainedHypothesis[fieldKey] != hypothesisId;
    }

    // Côté people : l'hypothèse visée par l'ancre existe, appartient à la
    // personne, porte le statut « retenue » et sa valeur correspond à la
    // fiche. Sans boucle dans les rules : les quatre clés possibles sont
    // dépliées et toute clé inconnue est refusée par hasOnly().
    function anchoredHypothesisValidAfter(hypothesisId, personId, fieldKey, personData) {
      let hypothesis = validFactHypothesisId(hypothesisId) && existsAfter(factHypothesisPath(hypothesisId))
        ? getAfter(factHypothesisPath(hypothesisId)).data
        : {};
      return 'personId' in hypothesis
        && hypothesis.personId == personId
        && hypothesis.fieldKey == fieldKey
        && hypothesis.status == 'retained'
        && peopleValueMatchesHypothesis(personData, fieldKey, hypothesis.value);
    }

    function validFactHypothesisAnchorAfter(personId) {
      let data = request.resource.data;
      return !('retainedHypothesis' in data)
        || (data.retainedHypothesis is map
          && data.retainedHypothesis.size() <= 4
          && data.retainedHypothesis.keys().hasOnly(['birth.date', 'birth.place', 'death.date', 'death.place'])
          && ('birth.date' in data.retainedHypothesis
            ? anchoredHypothesisValidAfter(data.retainedHypothesis['birth.date'], personId, 'birth.date', data)
            : true)
          && ('birth.place' in data.retainedHypothesis
            ? anchoredHypothesisValidAfter(data.retainedHypothesis['birth.place'], personId, 'birth.place', data)
            : true)
          && ('death.date' in data.retainedHypothesis
            ? anchoredHypothesisValidAfter(data.retainedHypothesis['death.date'], personId, 'death.date', data)
            : true)
          && ('death.place' in data.retainedHypothesis
            ? anchoredHypothesisValidAfter(data.retainedHypothesis['death.place'], personId, 'death.place', data)
            : true));
    }

    // Une hypothèse abandonnée par l'ancre ne doit plus être retenue après la
    // transaction : la rétrogradation s'écrit toujours dans la même
    // transaction que la libération de l'ancre (opération du store).
    function anchoredHypothesisReleasedAfter(hypothesisId) {
      return !validFactHypothesisId(hypothesisId)
        || !existsAfter(factHypothesisPath(hypothesisId))
        || getAfter(factHypothesisPath(hypothesisId)).data.status != 'retained';
    }

    function unanchoredRetainedReleasedAfter() {
      let before = 'retainedHypothesis' in resource.data ? resource.data.retainedHypothesis : {};
      let after = 'retainedHypothesis' in request.resource.data ? request.resource.data.retainedHypothesis : {};
      return !('retainedHypothesis' in resource.data)
        || (('birth.date' in before
            ? ((('birth.date' in after && after['birth.date'] == before['birth.date'])
              || anchoredHypothesisReleasedAfter(before['birth.date'])))
            : true)
          && ('birth.place' in before
            ? ((('birth.place' in after && after['birth.place'] == before['birth.place'])
              || anchoredHypothesisReleasedAfter(before['birth.place'])))
            : true)
          && ('death.date' in before
            ? ((('death.date' in after && after['death.date'] == before['death.date'])
              || anchoredHypothesisReleasedAfter(before['death.date'])))
            : true)
          && ('death.place' in before
            ? ((('death.place' in after && after['death.place'] == before['death.place'])
              || anchoredHypothesisReleasedAfter(before['death.place'])))
            : true));
    }

    function validFactHypothesisShape(data) {
      return data.keys().hasAll(['personId', 'fieldKey', 'value', 'status', 'initialFromFiche', 'justification', 'attestations', 'documentIds', 'sourceIds', 'proofIds', 'authorUid', 'createdAt', 'updatedAt', 'currentRevisionId'])
        && data.keys().hasOnly(['personId', 'fieldKey', 'value', 'status', 'initialFromFiche', 'justification', 'attestations', 'documentIds', 'sourceIds', 'proofIds', 'authorUid', 'createdAt', 'updatedAt', 'updatedBy', 'currentRevisionId'])
        && data.personId is string
        && data.personId.size() > 0
        && validFactHypothesisFieldKey(data.fieldKey)
        && validFactHypothesisValue(data.fieldKey, data.value)
        && data.status in ['retained', 'alternative', 'rejected', 'deleted']
        && data.initialFromFiche is bool
        && data.justification is string
        && data.justification.size() <= 2000
        && validFactHypothesisAttestations(data.attestations)
        && data.documentIds is list && data.documentIds.size() <= 100
        && data.sourceIds is list && data.sourceIds.size() <= 100
        && data.proofIds is list && data.proofIds.size() <= 100
        && data.authorUid is string
        && data.authorUid.size() > 0
        && data.createdAt is timestamp
        && data.updatedAt is timestamp
        && data.currentRevisionId is string
        && data.currentRevisionId.size() > 0
        && (!('updatedBy' in data) || data.updatedBy == request.auth.uid);
    }

    // Traçabilité obligatoire : toute écriture d'hypothèse (création,
    // transition, correction, attestations) doit être accompagnée, dans la
    // MÊME transaction ou le MÊME lot d'écritures, d'une révision NEUVE
    // (identifiant nouveau et horodatage de cette écriture) rattachée à cette
    // hypothèse. Cela refuse toute modification de statut sans révision et
    // toute révision réemployée d'une écriture antérieure.
    function freshHypothesisRevisionAfter(hypothesisId, revisionId) {
      let revisionPath = /databases/$(database)/documents/factHypothesisRevisions/$(revisionId);
      return validFactHypothesisId(revisionId)
        && existsAfter(revisionPath)
        && getAfter(revisionPath).data.createdAt == request.time
        && getAfter(revisionPath).data.authorUid == request.auth.uid
        && getAfter(revisionPath).data.objectId == hypothesisId;
    }

    function validFactHypothesisCreate(hypothesisId) {
      let data = request.resource.data;
      return validFactHypothesisId(hypothesisId)
        && validFactHypothesisShape(data)
        && data.status in ['retained', 'alternative']
        && data.authorUid == request.auth.uid
        && (!data.initialFromFiche || data.status == 'retained')
        && existsAfter(factHypothesisPersonPath(data.personId))
        && freshHypothesisRevisionAfter(hypothesisId, data.currentRevisionId)
        && (data.status != 'retained'
          || (anchoredRetainedAfter(data.personId, data.fieldKey, hypothesisId)
            && peopleFactMatchesAfter(data.personId, data.fieldKey, data.value)));
    }

    function validFactHypothesisUpdate(hypothesisId) {
      let data = request.resource.data;
      let previous = resource.data;
      return validFactHypothesisId(hypothesisId)
        && validFactHypothesisShape(data)
        && data.personId == previous.personId
        && data.fieldKey == previous.fieldKey
        && data.authorUid == previous.authorUid
        && data.initialFromFiche == previous.initialFromFiche
        && validFactHypothesisStatusTransition(previous.status, data.status)
        && (previous.status != 'deleted'
          || (data.value == previous.value
            && data.attestations == previous.attestations
            && data.justification == previous.justification))
        && (previous.status != 'rejected' || data.status != 'alternative'
          || (data.value == previous.value
            && data.attestations == previous.attestations
            && data.documentIds == previous.documentIds
            && data.sourceIds == previous.sourceIds
            && data.proofIds == previous.proofIds
            && data.justification.size() > 0))
        && freshHypothesisRevisionAfter(hypothesisId, data.currentRevisionId)
        && (data.status != 'retained'
          || (anchoredRetainedAfter(data.personId, data.fieldKey, hypothesisId)
            && peopleFactMatchesAfter(data.personId, data.fieldKey, data.value)
            && (!replacedAnotherRetained(data.personId, data.fieldKey, hypothesisId)
              || data.justification.size() > 0)))
        && (previous.status != 'retained'
          || data.status == 'retained'
          || retainedReplacedAfter(data.personId, data.fieldKey, hypothesisId));
    }

    // Révisions : création seule (immuabilité), auteur et identifiants
    // protégés, horodatage de l'écriture courante, rattachement à la tête et
    // cohérence de l'état (statut et valeur) avec l'hypothèse écrite dans la
    // même transaction. Chaînage : la révision précédente doit être la tête
    // courante avant l'écriture (ou nulle pour une création).
    function validFactHypothesisRevision(revisionId) {
      let data = request.resource.data;
      let snapshot = data.data;
      let headPath = factHypothesisPath(data.objectId);
      return validFactHypothesisId(revisionId)
        && data.keys().hasAll(['objectId', 'personId', 'fieldKey', 'operation', 'authorUid', 'createdAt', 'previousRevisionId', 'justification', 'data'])
        && data.keys().hasOnly(['objectId', 'personId', 'fieldKey', 'operation', 'authorUid', 'createdAt', 'previousRevisionId', 'justification', 'data'])
        && validFactHypothesisId(data.objectId)
        && data.personId is string
        && data.personId.size() > 0
        && validFactHypothesisFieldKey(data.fieldKey)
        && data.operation in ['created', 'retained', 'value-corrected', 'rejected', 'deleted', 'restored', 'reexamined', 'attestation-updated']
        && data.authorUid == request.auth.uid
        && data.createdAt == request.time
        && (data.previousRevisionId == null || validFactHypothesisId(data.previousRevisionId))
        && data.justification is string
        && data.justification.size() <= 2000
        && snapshot is map
        && snapshot.keys().hasOnly(['personId', 'fieldKey', 'value', 'status', 'initialFromFiche', 'justification', 'attestations', 'documentIds', 'sourceIds', 'proofIds', 'currentRevisionId'])
        && snapshot.personId == data.personId
        && snapshot.fieldKey == data.fieldKey
        && validFactHypothesisValue(snapshot.fieldKey, snapshot.value)
        && snapshot.status in ['retained', 'alternative', 'rejected', 'deleted']
        && snapshot.initialFromFiche is bool
        && existsAfter(headPath)
        && getAfter(headPath).data.personId == data.personId
        && getAfter(headPath).data.fieldKey == data.fieldKey
        && getAfter(headPath).data.currentRevisionId == revisionId
        && getAfter(headPath).data.status == snapshot.status
        && getAfter(headPath).data.value == snapshot.value
        && (data.previousRevisionId == null
          ? !exists(headPath)
          : (exists(headPath) && get(headPath).data.currentRevisionId == data.previousRevisionId));
    }
`;

const BLOCK_MATCHES = `
    // Hypothèses concurrentes de naissance et de décès (lot 2C.5-A) :
    // une seule hypothèse retenue par personne et par information, ancrée sur
    // people.retainedHypothesis ; suppressions logiques uniquement.
    match /factHypotheses/{hypothesisId} {
      allow read: if isApproved();
      allow create: if isApproved() && validFactHypothesisCreate(hypothesisId);
      allow update: if isApproved() && validFactHypothesisUpdate(hypothesisId);
      allow delete: if false;
    }

    match /factHypothesisRevisions/{revisionId} {
      allow read: if isApproved();
      allow create: if isApproved() && validFactHypothesisRevision(revisionId);
      allow update, delete: if false;
    }

`;

function fail(message) {
  throw new Error(`[fact-hypotheses-rules] ${message}`);
}

const original = readFileSync(source);
let text = original.toString("latin1");
const eol = text.includes("\r\n") ? "\r\n" : "\n";
let changes = 0;

/* 1. helpers après la fermeture de function validPerson() */
const validPersonStart = text.indexOf("function validPerson()");
if (validPersonStart < 0) fail("function validPerson() introuvable (baseline modifié).");
const validPersonEnd = text.indexOf(`${eol}    }${eol}`, validPersonStart);
if (validPersonEnd < 0) fail("fermeture de validPerson() introuvable.");
const insertFunctionsAt = validPersonEnd + eol.length + 4 + eol.length;
text = text.slice(0, insertFunctionsAt)
  + Buffer.from(BLOCK_FUNCTIONS, "utf8").toString("latin1")
  + text.slice(insertFunctionsAt);
changes++;

/* 2. amendement people — création : ancre valide après écriture */
const createMarker = "&& validPersonTreeReference() && validPersonTreeAssignmentOnCreate();";
if (text.indexOf(createMarker) < 0) fail("marqueur people create introuvable (baseline modifié).");
const createIndent = "        ";
text = text.replace(createMarker,
  `&& validPersonTreeReference() && validPersonTreeAssignmentOnCreate()${eol}`
  + `${createIndent}&& validFactHypothesisAnchorAfter(personId);`);
changes++;

/* 3. amendement people — mise à jour : ancre valide + décrochage cohérent */
const updatePattern = /&& validPersonTreeReference\(\)(\r?\n)(\s*)&& \(!request\.resource\.data\.diff/;
if (!updatePattern.test(text)) fail("marqueur people update introuvable (baseline modifié).");
text = text.replace(updatePattern, (match, nl, indent) =>
  `&& validPersonTreeReference()${nl}`
  + `${indent}&& validFactHypothesisAnchorAfter(personId)${nl}`
  + `${indent}&& unanchoredRetainedReleasedAfter()${nl}`
  + `${indent}&& (!request.resource.data.diff`);
changes++;

/* 4. les deux match avant le catch-all (avant le commentaire de clôture) */
const catchComment = text.indexOf("    // Aucun autre document");
if (catchComment < 0) fail("commentaire de clôture introuvable (baseline modifié).");
const catchLineStart = text.lastIndexOf(eol, catchComment) + eol.length;
text = text.slice(0, catchLineStart)
  + Buffer.from(BLOCK_MATCHES, "utf8").toString("latin1")
  + text.slice(catchLineStart);
changes++;

if (changes !== 4) fail(`${changes} insertions réalisées au lieu de 4.`);
writeFileSync(target, Buffer.from(text, "latin1"));
console.log(`[fact-hypotheses-rules] candidat généré : ${target.pathname} (4 insertions, baseline intacte).`);
