/* Contrats purs de collaboration pour le lot 6.
   La sécurité réelle reste imposée par Firestore Rules. */

export const PROPOSAL_STATES = Object.freeze(["draft", "pending", "accepted", "rejected", "cancelled"]);
export const PROPOSAL_TYPES = Object.freeze(["source", "transcription", "correction", "proof"]);
export const GENEALOGY_EVENT_TYPES = Object.freeze([
  "proposal.created", "proposal.updated", "proposal.submitted", "proposal.cancelled", "proposal.accepted", "proposal.rejected",
  "source.created", "source.revised", "transcription.revised", "proof.created", "proof.revised",
  "proof.suspended", "proof.reassessed", "conclusion.created", "conclusion.revised",
  "proof.reexamination.required", "conclusion.reexamination.required"
]);
export const NOTIFICATION_TYPES = Object.freeze([
  "proposal-accepted", "proposal-rejected", "proposal-submitted", "proof-reexamination", "conclusion-reexamination"
]);

function nonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} doit être une chaîne non vide`);
  return value;
}

function cloneAndFreeze(value) {
  const copy = structuredClone(value);
  const freeze = item => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return item;
    Object.values(item).forEach(freeze);
    return Object.freeze(item);
  };
  return freeze(copy);
}

export function createProposalDraft({ id, type, authorUid, targetType, targetId, payload } = {}) {
  nonEmpty(id, "proposal.id");
  nonEmpty(authorUid, "proposal.authorUid");
  nonEmpty(targetType, "proposal.targetType");
  nonEmpty(targetId, "proposal.targetId");
  if (!PROPOSAL_TYPES.includes(type)) throw new TypeError("Type de proposition non reconnu");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("proposal.payload doit être un objet");
  return Object.freeze({ id, type, status: "draft", authorUid, targetType, targetId, payload: cloneAndFreeze(payload) });
}

export function transitionProposal(proposal, { to, actorUid, actorRole, payload, resolutionReason } = {}) {
  if (!proposal || !PROPOSAL_STATES.includes(proposal.status)) throw new TypeError("Proposition invalide");
  nonEmpty(actorUid, "actorUid");
  if (to === "pending" || to === "cancelled" || (to === "draft" && proposal.status === "draft")) {
    if (actorUid !== proposal.authorUid || actorRole !== "member") throw new Error("Seul l'auteur approuvé peut gérer son brouillon");
    if (proposal.status !== "draft" || !["pending", "cancelled", "draft"].includes(to)) throw new Error("Seul un brouillon peut être modifié, soumis ou annulé");
  } else if (to === "accepted" || to === "rejected") {
    if (actorRole !== "admin") throw new Error("La décision est réservée aux administrateurs");
    if (proposal.status !== "pending") throw new Error("Seule une proposition en attente peut être décidée");
    nonEmpty(resolutionReason, "resolutionReason");
  } else {
    throw new Error("Transition de proposition non autorisée");
  }
  return Object.freeze({
    ...proposal,
    ...(payload === undefined ? {} : { payload: cloneAndFreeze(payload) }),
    status: to,
    ...(to === "accepted" || to === "rejected" ? { resolvedBy: actorUid, resolutionReason } : {})
  });
}

export function createGenealogyEvent({ id, eventType, objectType, objectId, actorUid, previousVersionId = null, newVersionId = null, reason = "" } = {}) {
  for (const [value, field] of [[id, "event.id"], [eventType, "event.eventType"], [objectType, "event.objectType"], [objectId, "event.objectId"], [actorUid, "event.actorUid"]]) nonEmpty(value, field);
  if (!GENEALOGY_EVENT_TYPES.includes(eventType)) throw new TypeError("Type d'événement non reconnu");
  if (previousVersionId !== null) nonEmpty(previousVersionId, "previousVersionId");
  if (newVersionId !== null) nonEmpty(newVersionId, "newVersionId");
  if (typeof reason !== "string" || reason.length > 2000) throw new TypeError("reason doit être une chaîne de 2000 caractères maximum");
  return Object.freeze({ id, eventType, objectType, objectId, actorUid, previousVersionId, newVersionId, reason });
}

export function createGenealogyNotification({ id, recipientUid, type, objectType, objectId, eventId } = {}) {
  for (const [value, field] of [[id, "notification.id"], [recipientUid, "notification.recipientUid"], [objectType, "notification.objectType"], [objectId, "notification.objectId"], [eventId, "notification.eventId"]]) nonEmpty(value, field);
  if (!NOTIFICATION_TYPES.includes(type)) throw new TypeError("Type de notification non reconnu");
  return Object.freeze({ id, recipientUid, type, objectType, objectId, eventId, read: false });
}
