/* Persistance transactionnelle des hypothèses concurrentes (lot 2C.5-A).
   Motif : store collaboratif js/genealogy-collaboration-firestore.js —
   SDK injecté pour rester testable sous Node, toutes les lectures sont
   réalisées avant toute écriture (règle des transactions Firestore).

   Intégrité de l'unicité « une seule retenue par personne et par information » :
   - ancre portée par people.retainedHypothesis[fieldKey] ;
   - lecture de l'ancre dans la transaction (jamais une liste lue avant) ;
   - contrôle de l'ancre attendue par l'appelant (expectedAnchor) avant
     remplacement, pour refuser un écrasement concurrent ;
   - validation des règles métier (justification, transitions) avant écriture. */

import {
  FACT_HYPOTHESIS_ANCHOR_KEY, FACT_HYPOTHESIS_ROLE,
  personFactValue, personFactValueIsEmpty, personFactValuePatch,
  retainedHypothesisAnchor, validateHypothesisOperation
} from "./fact-hypotheses.js";

const HYPOTHESES = "factHypotheses";
const REVISIONS = "factHypothesisRevisions";

function requireSdk(sdk) {
  for (const name of ["doc", "collection", "query", "where", "getDocs", "runTransaction", "serverTimestamp", "deleteField"]) {
    if (typeof sdk?.[name] !== "function") throw new TypeError(`SDK Firestore incomplet : ${name}`);
  }
}

/* État métier d'une hypothèse pour la révision (sans métadonnées de
   révision : auteur, date et chaînage sont portés par la révision). */
function snapshotData(hypothesis) {
  return {
    personId: hypothesis.personId,
    fieldKey: hypothesis.fieldKey,
    value: hypothesis.value,
    status: hypothesis.status,
    initialFromFiche: Boolean(hypothesis.initialFromFiche),
    justification: hypothesis.justification || "",
    attestations: hypothesis.attestations || [],
    documentIds: hypothesis.documentIds || [],
    sourceIds: hypothesis.sourceIds || [],
    proofIds: hypothesis.proofIds || [],
    currentRevisionId: hypothesis.currentRevisionId || null
  };
}

export function createFactHypothesesStore(db, sdk) {
  requireSdk(sdk);
  const stamp = () => sdk.serverTimestamp();
  const revisionIdFor = hypothesisId => `${hypothesisId}-r${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const hypothesisRef = id => sdk.doc(db, HYPOTHESES, id);
  const revisionRef = id => sdk.doc(db, REVISIONS, id);
  const personRef = id => sdk.doc(db, "people", id);
  const newHypothesisId = () => sdk.doc(sdk.collection(db, HYPOTHESES)).id;
  const initialHypothesisId = (personId, fieldKey) => `fh_init_${personId}_${fieldKey}`;

  function writeRevision(transaction, { id, personId, fieldKey, operation, actorUid, previousRevisionId, justification, hypothesis, revisionId }) {
    transaction.set(revisionRef(revisionId), {
      objectId: id,
      personId,
      fieldKey,
      operation,
      authorUid: actorUid,
      createdAt: stamp(),
      previousRevisionId: previousRevisionId || null,
      justification: justification || "",
      data: snapshotData(hypothesis)
    });
  }

  /* Transitions de statut communes : rejet, suppression logique, restauration.
     Lecture personne (ancre) + hypothèse avant toute écriture. */
  async function updateStatus({ operation, personId, fieldKey, hypothesisId, toStatus, justification = "", actorUid, expectedAnchor = undefined }) {
    if (!actorUid) throw new Error("Auteur de l’hypothèse requis.");
    return sdk.runTransaction(db, async transaction => {
      const personSnapshot = await transaction.get(personRef(personId));
      if (!personSnapshot.exists()) throw new Error("Cette personne est introuvable.");
      const person = personSnapshot.data();
      const anchor = person[FACT_HYPOTHESIS_ANCHOR_KEY] || {};
      const previousRetainedId = anchor[fieldKey] || null;
      if (expectedAnchor !== undefined && previousRetainedId !== (expectedAnchor || null)) {
        throw new Error("L’ancre d’unicité a changé pendant l’opération ; aucune écriture n’a été effectuée.");
      }
      const hypothesisSnapshot = await transaction.get(hypothesisRef(hypothesisId));
      if (!hypothesisSnapshot.exists()) throw new Error("Cette hypothèse est introuvable.");
      const hypothesis = hypothesisSnapshot.data();
      if (hypothesis.personId !== personId || hypothesis.fieldKey !== fieldKey) throw new Error("Cette hypothèse n’appartient pas à cette information.");
      const validation = validateHypothesisOperation({
        operation, fromStatus: hypothesis.status, toStatus,
        justification, previousRetainedId, nextHypothesisId: hypothesisId, fieldKey
      });
      if (!validation.valid) throw new Error(validation.error);
      const timestamp = stamp();
      const revisionId = revisionIdFor(hypothesisId);
      const updatedHypothesis = {
        ...hypothesis,
        status: toStatus,
        justification: justification || hypothesis.justification || "",
        currentRevisionId: revisionId,
        updatedAt: timestamp, updatedBy: actorUid
      };
      transaction.set(hypothesisRef(hypothesisId), updatedHypothesis);
      writeRevision(transaction, {
        id: hypothesisId, personId, fieldKey, operation, actorUid,
        previousRevisionId: hypothesis.currentRevisionId, justification: justification || "",
        hypothesis: updatedHypothesis, revisionId
      });
      return { updated: [{ id: hypothesisId, ...updatedHypothesis }] };
    });
  }

  return Object.freeze({

    async listForPerson(personId) {
      const snapshot = await sdk.getDocs(sdk.query(sdk.collection(db, HYPOTHESES), sdk.where("personId", "==", personId)));
      return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    },

    /* Création : uniquement au statut « alternative ». La première alternative
       provoque la promotion de la valeur courante de la fiche en hypothèse
       initialement retenue (même transaction, même ancre). */
    async createHypothesis({ personId, fieldKey, value, justification = "", actorUid }) {
      if (!actorUid) throw new Error("Auteur de l’hypothèse requis.");
      const id = newHypothesisId();
      return sdk.runTransaction(db, async transaction => {
        const personSnapshot = await transaction.get(personRef(personId));
        if (!personSnapshot.exists()) throw new Error("Cette personne est introuvable.");
        const person = personSnapshot.data();
        const anchor = person[FACT_HYPOTHESIS_ANCHOR_KEY] || {};
        const previousRetainedId = anchor[fieldKey] || null;
        const validation = validateHypothesisOperation({
          operation: "created", toStatus: "alternative", fieldKey,
          previousRetainedId, nextHypothesisId: id
        });
        if (!validation.valid) throw new Error(validation.error);

        const timestamp = stamp();
        let nextAnchor = anchor;
        let initialToWrite = null;
        let initialId = null;
        /* Miroir obligatoire : la règle côté people exige que le champ structuré
           de la fiche corresponde à l'hypothèse retenue. Pour une fiche portant
           uniquement la valeur legacy (chaîne birthDate/deathDate), la promotion
           écrit le champ structuré EN PLUS (additif, jamais de suppression). */
        let mirrorSet = null;
        if (previousRetainedId === null && !personFactValueIsEmpty(fieldKey, person)) {
          const candidateId = initialHypothesisId(personId, fieldKey);
          const initialSnapshot = await transaction.get(hypothesisRef(candidateId));
          if (!initialSnapshot.exists()) {
            initialId = candidateId;
            initialToWrite = {
              personId, fieldKey,
              value: personFactValue(fieldKey, person),
              status: "retained",
              initialFromFiche: true,
              justification: "",
              attestations: [],
              documentIds: [], sourceIds: [], proofIds: [],
              authorUid: actorUid,
              createdAt: timestamp, updatedAt: timestamp, updatedBy: actorUid,
              currentRevisionId: `${candidateId}-r1`
            };
            mirrorSet = personFactValuePatch(fieldKey, initialToWrite.value).set;
            nextAnchor = retainedHypothesisAnchor(anchor, fieldKey, candidateId);
          } else if (initialSnapshot.data().status === "retained") {
            mirrorSet = personFactValuePatch(fieldKey, initialSnapshot.data().value).set;
            nextAnchor = retainedHypothesisAnchor(anchor, fieldKey, candidateId);
          }
        }

        const hypothesis = {
          personId, fieldKey,
          value,
          status: "alternative",
          initialFromFiche: false,
          justification: justification || "",
          attestations: [],
          documentIds: [], sourceIds: [], proofIds: [],
          authorUid: actorUid,
          createdAt: timestamp, updatedAt: timestamp, updatedBy: actorUid,
          currentRevisionId: `${id}-r1`
        };
        const created = [];
        if (initialToWrite) {
          transaction.set(hypothesisRef(initialId), initialToWrite);
          writeRevision(transaction, {
            id: initialId, personId, fieldKey, operation: "created", actorUid,
            previousRevisionId: null, justification: "", hypothesis: initialToWrite, revisionId: initialToWrite.currentRevisionId
          });
          created.push({ id: initialId, ...initialToWrite });
        }
        transaction.set(hypothesisRef(id), hypothesis);
        writeRevision(transaction, {
          id, personId, fieldKey, operation: "created", actorUid,
          previousRevisionId: null, justification: justification || "", hypothesis, revisionId: hypothesis.currentRevisionId
        });
        created.push({ id, ...hypothesis });
        if (nextAnchor !== anchor) {
          transaction.update(personRef(personId), {
            ...(mirrorSet || {}),
            [FACT_HYPOTHESIS_ANCHOR_KEY]: nextAnchor,
            updatedAt: timestamp, updatedBy: actorUid
          });
        }
        return { created };
      });
    },

    /* Retenue / remplacement : contrôle de l'ancre attendue puis transition. */
    async setRetained({ personId, fieldKey, hypothesisId, justification = "", actorUid, expectedAnchor = undefined }) {
      if (!actorUid) throw new Error("Auteur de l’hypothèse requis.");
      return sdk.runTransaction(db, async transaction => {
        const personSnapshot = await transaction.get(personRef(personId));
        if (!personSnapshot.exists()) throw new Error("Cette personne est introuvable.");
        const person = personSnapshot.data();
        const anchor = person[FACT_HYPOTHESIS_ANCHOR_KEY] || {};
        const previousRetainedId = anchor[fieldKey] || null;
        if (expectedAnchor !== undefined && previousRetainedId !== (expectedAnchor || null)) {
          throw new Error("L’ancre d’unicité a changé pendant l’opération ; aucune écriture n’a été effectuée.");
        }
        if (previousRetainedId === hypothesisId) throw new Error("Cette hypothèse est déjà retenue.");
        const targetSnapshot = await transaction.get(hypothesisRef(hypothesisId));
        if (!targetSnapshot.exists()) throw new Error("Cette hypothèse est introuvable.");
        const target = targetSnapshot.data();
        if (target.personId !== personId || target.fieldKey !== fieldKey) throw new Error("Cette hypothèse n’appartient pas à cette information.");
        const validation = validateHypothesisOperation({
          operation: "retained", fromStatus: target.status, toStatus: "retained",
          justification, previousRetainedId, nextHypothesisId: hypothesisId, fieldKey
        });
        if (!validation.valid) throw new Error(validation.error);

        let previous = null;
        if (previousRetainedId && previousRetainedId !== hypothesisId) {
          const previousSnapshot = await transaction.get(hypothesisRef(previousRetainedId));
          if (previousSnapshot.exists()) previous = previousSnapshot.data();
        }
        const timestamp = stamp();
        const updated = [];

        if (previous) {
          const previousRevisionId = revisionIdFor(previousRetainedId);
          const previousHypothesis = {
            ...previous,
            status: "alternative",
            justification: justification || previous.justification || "",
            currentRevisionId: previousRevisionId,
            updatedAt: timestamp, updatedBy: actorUid
          };
          transaction.set(hypothesisRef(previousRetainedId), previousHypothesis);
          writeRevision(transaction, {
            id: previousRetainedId, personId, fieldKey, operation: "retained", actorUid,
            previousRevisionId: previous.currentRevisionId, justification: justification || "",
            hypothesis: previousHypothesis, revisionId: previousRevisionId
          });
          updated.push({ id: previousRetainedId, ...previousHypothesis });
        }

        const targetRevisionId = revisionIdFor(hypothesisId);
        const targetHypothesis = {
          ...target,
          status: "retained",
          justification: justification || target.justification || "",
          currentRevisionId: targetRevisionId,
          updatedAt: timestamp, updatedBy: actorUid
        };
        transaction.set(hypothesisRef(hypothesisId), targetHypothesis);
        writeRevision(transaction, {
          id: hypothesisId, personId, fieldKey, operation: "retained", actorUid,
          previousRevisionId: target.currentRevisionId, justification: justification || "",
          hypothesis: targetHypothesis, revisionId: targetRevisionId
        });
        updated.push({ id: hypothesisId, ...targetHypothesis });

        const patch = personFactValuePatch(fieldKey, targetHypothesis.value);
        transaction.update(personRef(personId), {
          [FACT_HYPOTHESIS_ANCHOR_KEY]: retainedHypothesisAnchor(anchor, fieldKey, hypothesisId),
          ...patch.set,
          updatedAt: timestamp, updatedBy: actorUid
        });
        for (const key of patch.remove || []) transaction.update(personRef(personId), { [key]: sdk.deleteField() });
        return { updated, personId };
      });
    },

    /* Correction de valeur (sans changement de retenue) : conserve les
       attestations et la traçabilité, réécrit le champ de la fiche. */
    async correctValue({ personId, fieldKey, hypothesisId, value, justification = "", actorUid }) {
      if (!actorUid) throw new Error("Auteur de l’hypothèse requis.");
      return sdk.runTransaction(db, async transaction => {
        const personSnapshot = await transaction.get(personRef(personId));
        if (!personSnapshot.exists()) throw new Error("Cette personne est introuvable.");
        const person = personSnapshot.data();
        const anchor = person[FACT_HYPOTHESIS_ANCHOR_KEY] || {};
        const hypothesisSnapshot = await transaction.get(hypothesisRef(hypothesisId));
        if (!hypothesisSnapshot.exists()) throw new Error("Cette hypothèse est introuvable.");
        const hypothesis = hypothesisSnapshot.data();
        if (hypothesis.personId !== personId || hypothesis.fieldKey !== fieldKey) throw new Error("Cette hypothèse n’appartient pas à cette information.");
        const validation = validateHypothesisOperation({
          operation: "value-corrected", fromStatus: hypothesis.status, toStatus: hypothesis.status, fieldKey
        });
        if (!validation.valid) throw new Error(validation.error);
        const timestamp = stamp();
        const revisionId = revisionIdFor(hypothesisId);
        const corrected = {
          ...hypothesis,
          value,
          justification: justification || hypothesis.justification || "",
          currentRevisionId: revisionId,
          updatedAt: timestamp, updatedBy: actorUid
        };
        transaction.set(hypothesisRef(hypothesisId), corrected);
        writeRevision(transaction, {
          id: hypothesisId, personId, fieldKey, operation: "value-corrected", actorUid,
          previousRevisionId: hypothesis.currentRevisionId, justification: justification || "",
          hypothesis: corrected, revisionId
        });
        if (hypothesis.status === "retained" && anchor[fieldKey] === hypothesisId) {
          const patch = personFactValuePatch(fieldKey, value);
          transaction.update(personRef(personId), { ...patch.set, updatedAt: timestamp, updatedBy: actorUid });
          for (const key of patch.remove || []) transaction.update(personRef(personId), { [key]: sdk.deleteField() });
        }
        return { updated: [{ id: hypothesisId, ...corrected }] };
      });
    },

    rejectHypothesis(input) {
      return updateStatus({ operation: "rejected", toStatus: "rejected", ...input });
    },

    deleteHypothesis(input) {
      return updateStatus({ operation: "deleted", toStatus: "deleted", ...input });
    },

    restoreHypothesis(input) {
      return updateStatus({ operation: "restored", toStatus: "alternative", ...input });
    },

    /* Réexamen : rejected → alternative avec justification obligatoire.
       Aucune écriture people (fiche et ancre intactes) ; valeur, attestations
       et références documentaires conservées par le spread de la tête. */
    reexamineHypothesis(input) {
      return updateStatus({ operation: "reexamined", toStatus: "alternative", ...input });
    },

    /* Association facultative d'une attestation (rôle Appuie/Contredit/Contexte). */
    async attachAttestation({ personId, fieldKey, hypothesisId, attestationId, role, remove = false, actorUid }) {
      if (!actorUid) throw new Error("Auteur de l’hypothèse requis.");
      if (!FACT_HYPOTHESIS_ROLE.includes(role)) throw new Error("Rôle d’attestation inconnu.");
      if (!attestationId) throw new Error("Attestation introuvable.");
      return sdk.runTransaction(db, async transaction => {
        const hypothesisSnapshot = await transaction.get(hypothesisRef(hypothesisId));
        if (!hypothesisSnapshot.exists()) throw new Error("Cette hypothèse est introuvable.");
        const hypothesis = hypothesisSnapshot.data();
        if (hypothesis.personId !== personId || hypothesis.fieldKey !== fieldKey) throw new Error("Cette hypothèse n’appartient pas à cette information.");
        const validation = validateHypothesisOperation({
          operation: "attestation-updated", fromStatus: hypothesis.status, toStatus: hypothesis.status, fieldKey
        });
        if (!validation.valid) throw new Error(validation.error);
        /* Remplacement sur place : changer un rôle ne réordonne pas les lignes
           et ne crée jamais de doublon pour le même identifiant. */
        const attestations = [...(hypothesis.attestations || [])];
        const index = attestations.findIndex(item => item.attestationId === attestationId);
        if (remove) {
          if (index >= 0) attestations.splice(index, 1);
        } else if (index >= 0) {
          attestations[index] = { attestationId, role };
        } else {
          attestations.push({ attestationId, role });
        }
        const timestamp = stamp();
        const revisionId = revisionIdFor(hypothesisId);
        const updatedHypothesis = {
          ...hypothesis,
          attestations,
          currentRevisionId: revisionId,
          updatedAt: timestamp, updatedBy: actorUid
        };
        transaction.set(hypothesisRef(hypothesisId), updatedHypothesis);
        writeRevision(transaction, {
          id: hypothesisId, personId, fieldKey, operation: "attestation-updated", actorUid,
          previousRevisionId: hypothesis.currentRevisionId, justification: "",
          hypothesis: updatedHypothesis, revisionId
        });
        return { updated: [{ id: hypothesisId, ...updatedHypothesis }] };
      });
    }
  });
}
