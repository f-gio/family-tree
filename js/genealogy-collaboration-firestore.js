/* Persistance transactionnelle injectée pour rester testable sous Node et
   utilisable avec le SDK Firebase chargé par l'application statique. */

import { createGenealogyEvent, createGenealogyNotification, createProposalDraft } from "./genealogy-collaboration.js";

const OFFICIAL = Object.freeze({
  source: { heads: "sourceDocuments", revisions: "sourceRevisions", created: "source.created", revised: "source.revised" },
  transcription: { heads: "transcriptionHeads", revisions: "transcriptionRevisions", created: "transcription.revised", revised: "transcription.revised" },
  proof: { heads: "genealogyProofs", revisions: "genealogyProofRevisions", created: "proof.created", revised: "proof.revised" },
  conclusion: { heads: "factConclusions", revisions: "conclusionRevisions", created: "conclusion.created", revised: "conclusion.revised" }
});
const REVISION_EVENT_TYPES = Object.freeze({
  source: ["source.revised"],
  transcription: ["transcription.revised"],
  proof: ["proof.revised", "proof.suspended", "proof.reassessed"],
  conclusion: ["conclusion.revised"]
});

function requireSdk(sdk) {
  for (const name of ["doc", "runTransaction", "serverTimestamp", "collection", "query", "where", "getDocs"]) {
    if (typeof sdk?.[name] !== "function") throw new TypeError(`SDK Firestore incomplet : ${name}`);
  }
}

function refsFor(db, sdk) {
  return {
    proposal: id => sdk.doc(db, "genealogyProposals", id),
    event: id => sdk.doc(db, "genealogyEvents", id),
    notification: id => sdk.doc(db, "genealogyNotifications", id)
  };
}

function eventData(sdk, values) {
  const { id, ...event } = createGenealogyEvent(values);
  return { ...event, createdAt: sdk.serverTimestamp() };
}

export function createGenealogyCollaborationStore(db, sdk) {
  requireSdk(sdk);
  const refs = refsFor(db, sdk);
  const stamp = () => sdk.serverTimestamp();

  return Object.freeze({
    async createProposal({ proposal, eventId, actorUid }) {
      const draft = createProposalDraft({ ...proposal, authorUid: actorUid });
      return sdk.runTransaction(db, async transaction => {
        const proposalRef = refs.proposal(draft.id);
        if ((await transaction.get(proposalRef)).exists()) throw new Error("Cette proposition existe déjà");
        const { id: ignoredId, ...proposalData } = draft;
        transaction.set(proposalRef, { ...proposalData, createdAt: stamp(), updatedAt: stamp() });
        transaction.set(refs.event(eventId), eventData(sdk, {
          id: eventId, eventType: "proposal.created", objectType: "proposal", objectId: draft.id,
          actorUid, newVersionId: "draft", reason: "Création de la proposition"
        }));
        return draft;
      });
    },

    async updateDraft({ proposalId, payload, eventId, actorUid }) {
      return sdk.runTransaction(db, async transaction => {
        const proposalRef = refs.proposal(proposalId);
        const snapshot = await transaction.get(proposalRef);
        if (!snapshot.exists() || snapshot.data().authorUid !== actorUid || snapshot.data().status !== "draft") {
          throw new Error("Seul l'auteur peut modifier son brouillon");
        }
        transaction.update(proposalRef, { payload: structuredClone(payload), updatedAt: stamp() });
        transaction.set(refs.event(eventId), eventData(sdk, {
          id: eventId, eventType: "proposal.updated", objectType: "proposal", objectId: proposalId,
          actorUid, previousVersionId: "draft", newVersionId: "draft", reason: "Modification du brouillon"
        }));
      });
    },

    async submitProposal({ proposalId, eventId, actorUid }) {
      return sdk.runTransaction(db, async transaction => {
        const proposalRef = refs.proposal(proposalId);
        const snapshot = await transaction.get(proposalRef);
        if (!snapshot.exists() || snapshot.data().authorUid !== actorUid || snapshot.data().status !== "draft") {
          throw new Error("Seul l'auteur peut soumettre son brouillon");
        }
        transaction.update(proposalRef, { status: "pending", submittedAt: stamp(), updatedAt: stamp() });
        transaction.set(refs.event(eventId), eventData(sdk, {
          id: eventId, eventType: "proposal.submitted", objectType: "proposal", objectId: proposalId,
          actorUid, previousVersionId: "draft", newVersionId: "pending", reason: "Soumission à validation"
        }));
      });
    },

    async cancelDraft({ proposalId, eventId, actorUid }) {
      return sdk.runTransaction(db, async transaction => {
        const proposalRef = refs.proposal(proposalId);
        const snapshot = await transaction.get(proposalRef);
        if (!snapshot.exists() || snapshot.data().authorUid !== actorUid || snapshot.data().status !== "draft") {
          throw new Error("Seul l'auteur peut annuler son brouillon");
        }
        transaction.update(proposalRef, { status: "cancelled", updatedAt: stamp() });
        transaction.set(refs.event(eventId), eventData(sdk, {
          id: eventId, eventType: "proposal.cancelled", objectType: "proposal", objectId: proposalId,
          actorUid, previousVersionId: "draft", newVersionId: "cancelled", reason: "Annulation du brouillon"
        }));
      });
    },

    async decideProposal({ proposalId, decision, reason, eventId, notificationId, actorUid }) {
      if (!["accepted", "rejected"].includes(decision)) throw new TypeError("Décision de proposition non reconnue");
      if (typeof reason !== "string" || !reason.trim()) throw new TypeError("Une justification est requise");
      return sdk.runTransaction(db, async transaction => {
        const proposalRef = refs.proposal(proposalId);
        const snapshot = await transaction.get(proposalRef);
        if (!snapshot.exists() || snapshot.data().status !== "pending") throw new Error("La proposition n'est plus en attente");
        const authorUid = snapshot.data().authorUid;
        transaction.update(proposalRef, {
          status: decision, resolvedAt: stamp(), resolvedBy: actorUid, resolutionReason: reason.trim(), updatedAt: stamp()
        });
        transaction.set(refs.event(eventId), eventData(sdk, {
          id: eventId, eventType: `proposal.${decision}`, objectType: "proposal", objectId: proposalId,
          actorUid, previousVersionId: "pending", newVersionId: decision, reason: reason.trim()
        }));
        const notification = createGenealogyNotification({
          id: notificationId, recipientUid: authorUid,
          type: decision === "accepted" ? "proposal-accepted" : "proposal-rejected",
          objectType: "proposal", objectId: proposalId, eventId
        });
        const { id: ignoredId, ...notificationData } = notification;
        transaction.set(refs.notification(notificationId), { ...notificationData, createdAt: stamp() });
      });
    },

    async deleteOfficial({ type, id, actorUid }) {
      const spec = OFFICIAL[type];
      if (!spec || (type !== "proof" && type !== "source")) {
        throw new TypeError("La suppression définitive est réservée aux preuves et aux sources officielles");
      }
      if (!actorUid) throw new TypeError("Un utilisateur authentifié est requis");
      // Les requêtes par champ sont exclues de runTransaction côté SDK client
      // (Transaction.get n'accepte qu'une DocumentReference) : la collecte des
      // documents liés se fait donc avant la transaction, puis la transaction
      // relit la fiche et supprime l'ensemble d'un bloc atomique.
      if (type === "source") {
        const proofsSnapshot = await sdk.getDocs(sdk.query(sdk.collection(db, "genealogyProofs"), sdk.where("data.documentId", "==", id)));
        if (!proofsSnapshot.empty) {
          throw new Error(`Suppression impossible : ${proofsSnapshot.size} preuve(s) référencent cette source. Détachez d’abord ou modifiez ces preuves avant de supprimer la source.`);
        }
      }
      const [revisionsSnapshot, eventsSnapshot, notificationsSnapshot] = await Promise.all([
        sdk.getDocs(sdk.query(sdk.collection(db, spec.revisions), sdk.where("objectId", "==", id))),
        sdk.getDocs(sdk.query(sdk.collection(db, "genealogyEvents"), sdk.where("objectId", "==", id))),
        // Les notifications sont privées : chaque destinataire ne voit que les siennes,
        // aussi le nettoyage couvre-t-il les notifications adressées à l'acteur.
        sdk.getDocs(sdk.query(sdk.collection(db, "genealogyNotifications"),
          sdk.where("objectId", "==", id), sdk.where("recipientUid", "==", actorUid)))
      ]);
      return sdk.runTransaction(db, async transaction => {
        const headRef = sdk.doc(db, spec.heads, id);
        const headSnapshot = await transaction.get(headRef);
        if (!headSnapshot.exists()) throw new Error("Cette fiche n'existe plus.");
        transaction.delete(headRef);
        revisionsSnapshot.docs.forEach(documentSnapshot => transaction.delete(documentSnapshot.ref));
        eventsSnapshot.docs.forEach(documentSnapshot => transaction.delete(documentSnapshot.ref));
        notificationsSnapshot.docs.forEach(documentSnapshot => transaction.delete(documentSnapshot.ref));
        return {
          deleted: true,
          revisions: revisionsSnapshot.size,
          events: eventsSnapshot.size,
          notifications: notificationsSnapshot.size
        };
      });
    },

    async markNotificationRead({ notificationId, actorUid }) {
      return sdk.runTransaction(db, async transaction => {
        const notificationRef = refs.notification(notificationId);
        const snapshot = await transaction.get(notificationRef);
        if (!snapshot.exists() || snapshot.data().recipientUid !== actorUid) throw new Error("Cette notification ne vous est pas destinée");
        transaction.update(notificationRef, { read: true, readAt: stamp() });
      });
    },

    async notifyAdministrators({ type, objectType, objectId, eventId, administratorUids, notificationIds }) {
      if (!Array.isArray(administratorUids) || !Array.isArray(notificationIds) || administratorUids.length !== notificationIds.length) {
        throw new TypeError("Chaque administrateur doit avoir un identifiant de notification");
      }
      return sdk.runTransaction(db, async transaction => {
        const eventRef = refs.event(eventId);
        if (!(await transaction.get(eventRef)).exists()) throw new Error("L'événement de suivi doit déjà être enregistré");
        for (let index = 0; index < administratorUids.length; index++) {
          const notification = createGenealogyNotification({
            id: notificationIds[index], recipientUid: administratorUids[index], type, objectType, objectId, eventId
          });
          const { id: ignoredId, ...notificationData } = notification;
          transaction.set(refs.notification(notification.id), { ...notificationData, createdAt: stamp() });
        }
      });
    },

    async createReexaminationEvent({ type, objectId, eventId, reason, administratorUids, notificationIds, actorUid }) {
      if (!["proof", "conclusion"].includes(type)) throw new TypeError("Le réexamen doit concerner une preuve ou une conclusion");
      if (typeof reason !== "string" || !reason.trim()) throw new TypeError("Le motif de réexamen est requis");
      if (!Array.isArray(administratorUids) || !Array.isArray(notificationIds) || administratorUids.length !== notificationIds.length) {
        throw new TypeError("Chaque administrateur doit avoir un identifiant de notification");
      }
      return sdk.runTransaction(db, async transaction => {
        transaction.set(refs.event(eventId), eventData(sdk, {
          id: eventId, eventType: `${type}.reexamination.required`, objectType: type, objectId,
          actorUid, newVersionId: "review-required", reason: reason.trim()
        }));
        for (let index = 0; index < administratorUids.length; index++) {
          const notification = createGenealogyNotification({
            id: notificationIds[index], recipientUid: administratorUids[index],
            type: type === "proof" ? "proof-reexamination" : "conclusion-reexamination",
            objectType: type, objectId, eventId
          });
          const { id: ignoredId, ...notificationData } = notification;
          transaction.set(refs.notification(notification.id), { ...notificationData, createdAt: stamp() });
        }
      });
    },

    async createOfficial({ type, id, revisionId, eventId, data, reason = "Création officielle", actorUid }) {
      const spec = OFFICIAL[type];
      if (!spec) throw new TypeError("Type de donnée officielle non reconnu");
      return sdk.runTransaction(db, async transaction => {
        const headRef = sdk.doc(db, spec.heads, id);
        const revisionRef = sdk.doc(db, spec.revisions, revisionId);
        const eventRef = refs.event(eventId);
        if ((await transaction.get(headRef)).exists()) throw new Error("Cette donnée officielle existe déjà");
        const timestamp = stamp();
        const head = { data: structuredClone(data), version: 1, revisionId, createdAt: timestamp, createdBy: actorUid, updatedAt: timestamp, updatedBy: actorUid, eventId };
        transaction.set(headRef, head);
        transaction.set(revisionRef, { objectId: id, authorUid: actorUid, createdAt: timestamp, previousRevisionId: null, data: structuredClone(data), eventId });
        transaction.set(eventRef, eventData(sdk, {
          id: eventId, eventType: spec.created, objectType: type, objectId: id,
          actorUid, newVersionId: revisionId, reason
        }));
      });
    },

    async reviseOfficial({ type, id, revisionId, eventId, data, reason, eventType, actorUid }) {
      const spec = OFFICIAL[type];
      if (!spec) throw new TypeError("Type de donnée officielle non reconnu");
      const effectiveEventType = eventType ?? spec.revised;
      if (!REVISION_EVENT_TYPES[type].includes(effectiveEventType)) throw new TypeError("Type d'événement incompatible avec cette donnée officielle");
      if (typeof reason !== "string" || !reason.trim()) throw new TypeError("Une justification est requise");
      return sdk.runTransaction(db, async transaction => {
        const headRef = sdk.doc(db, spec.heads, id);
        const headSnapshot = await transaction.get(headRef);
        if (!headSnapshot.exists()) throw new Error("Donnée officielle introuvable");
        const previous = headSnapshot.data();
        const timestamp = stamp();
        transaction.update(headRef, {
          data: structuredClone(data), version: previous.version + 1, revisionId, updatedAt: timestamp, updatedBy: actorUid, eventId
        });
        transaction.set(sdk.doc(db, spec.revisions, revisionId), {
          objectId: id, authorUid: actorUid, createdAt: timestamp,
          previousRevisionId: previous.revisionId, data: structuredClone(data), eventId
        });
        transaction.set(refs.event(eventId), eventData(sdk, {
          id: eventId, eventType: effectiveEventType, objectType: type, objectId: id,
          actorUid, previousVersionId: previous.revisionId, newVersionId: revisionId, reason: reason.trim()
        }));
      });
    }
  });
}
