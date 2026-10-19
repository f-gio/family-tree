/* Modèle pur de preuves généalogiques (lot 4).
   Aucun accès Firebase, DOM, réseau ni modification des personnes/familles.
   Les IDs de preuve, fait, source, passage et révision sont fournis par
   l'appelant ; les fonctions de préparation retournent des propositions et
   n'appliquent aucune transition persistante.
*/

export const PROOF_RELATIONS = Object.freeze(["supports", "contradicts", "mentions", "ambiguous"]);
export const PROOF_STATUSES = Object.freeze(["active", "suspended", "historical"]);
export const REFERENCE_STATES = Object.freeze(["valid", "missing", "mismatch", "not_checked", "not_applicable", "historical"]);

function nonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} doit être une chaîne non vide`);
  return value;
}

function cloneValue(value, seen = new Map()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new TypeError("Les valeurs de preuve ne peuvent pas contenir de référence cyclique");
  seen.set(value, true);
  const result = Array.isArray(value)
    ? value.map(item => cloneValue(item, seen))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item, seen)]));
  seen.delete(value);
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function optionalString(value, label) {
  if (value !== null && (typeof value !== "string" || !value.trim())) throw new TypeError(`${label} doit être une chaîne non vide ou null`);
  return value;
}

function validateZone(zone) {
  if (zone == null) return [];
  const errors = [];
  if (!zone || typeof zone !== "object" || Array.isArray(zone)) return ["zone doit être un rectangle ou null"];
  if (typeof zone.photographId !== "string" || !zone.photographId.trim()) errors.push("zone.photographId doit identifier une photographie");
  if (zone.shape !== "rect") errors.push("zone.shape doit être rect");
  for (const key of ["x", "y", "width", "height"]) {
    if (typeof zone[key] !== "number" || !Number.isFinite(zone[key]) || zone[key] < 0 || zone[key] > 1) {
      errors.push(`zone.${key} doit être normalisé entre 0 et 1`);
    }
  }
  if (["x", "y", "width", "height"].every(key => typeof zone[key] === "number" && Number.isFinite(zone[key]))) {
    if (zone.width <= 0 || zone.height <= 0) errors.push("La largeur et la hauteur de zone doivent être positives");
    if (zone.x + zone.width > 1 || zone.y + zone.height > 1) errors.push("La zone dépasse les limites de la photographie");
  }
  return errors;
}

export function createGenealogyProof({
  id,
  factId,
  factType,
  personIds,
  relationshipId = null,
  familyId = null,
  documentId,
  pageId = null,
  passageId = null,
  transcriptionRevisionId = null,
  photographId = null,
  zone = null,
  citationIt = null,
  citationFr = null,
  sourceValue,
  relation,
  interpretation = "",
  authorUid = null,
  createdAt = null
} = {}) {
  nonEmpty(id, "proof.id");
  nonEmpty(factId, "proof.factId");
  nonEmpty(factType, "proof.factType");
  nonEmpty(documentId, "proof.documentId");
  if (pageId !== null) nonEmpty(pageId, "proof.pageId");
  if (passageId !== null) nonEmpty(passageId, "proof.passageId");
  if (transcriptionRevisionId !== null) nonEmpty(transcriptionRevisionId, "proof.transcriptionRevisionId");
  if (passageId !== null && pageId === null) throw new TypeError("Un passage cité doit référencer sa page");
  if (passageId !== null && transcriptionRevisionId === null) throw new TypeError("Un passage cité doit référencer une révision de transcription précise");
  if (relationshipId !== null) nonEmpty(relationshipId, "proof.relationshipId");
  if (familyId !== null) nonEmpty(familyId, "proof.familyId");
  if (photographId !== null) nonEmpty(photographId, "proof.photographId");
  if (photographId === null && zone !== null) throw new TypeError("Une zone doit être rattachée à une photographie");
  const zoneErrors = validateZone(zone);
  if (zoneErrors.length) throw new TypeError(zoneErrors.join("; "));
  if (zone !== null && photographId !== zone.photographId) throw new TypeError("La zone et la preuve doivent référencer la même photographie");
  if (!Array.isArray(personIds) || !personIds.length || personIds.some(personId => typeof personId !== "string" || !personId.trim())) {
    throw new TypeError("proof.personIds doit contenir au moins un identifiant de personne");
  }
  if (new Set(personIds).size !== personIds.length) throw new TypeError("proof.personIds ne peut pas contenir de doublons");
  if (citationIt !== null && typeof citationIt !== "string") throw new TypeError("citationIt doit être une chaîne ou null");
  if (citationFr !== null && typeof citationFr !== "string") throw new TypeError("citationFr doit être une chaîne ou null");
  if (!Object.prototype.hasOwnProperty.call(arguments[0] || {}, "sourceValue")) {
    throw new TypeError("sourceValue doit être fourni ; null représente une valeur source inconnue");
  }
  if (!PROOF_RELATIONS.includes(relation)) throw new TypeError("Relation entre la source et le fait non reconnue");
  if (typeof interpretation !== "string") throw new TypeError("interpretation doit être une chaîne");
  optionalString(authorUid, "authorUid");
  if (createdAt !== null && typeof createdAt !== "string" && !(createdAt instanceof Date)) throw new TypeError("createdAt doit être une chaîne, une date ou null");
  if (createdAt instanceof Date && !Number.isFinite(createdAt.getTime())) throw new TypeError("createdAt doit être une date valide");

  return deepFreeze({
    id,
    factId,
    factType,
    personIds: [...personIds],
    relationshipId,
    familyId,
    documentId,
    pageId,
    passageId,
    transcriptionRevisionId,
    photographId,
    zone: zone == null ? null : cloneValue(zone),
    citation: { textIt: citationIt, translationFr: citationFr },
    sourceValue: cloneValue(sourceValue),
    relation,
    interpretation,
    authorUid,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    technicalStatus: "active",
    suspension: null,
    statusHistory: []
  });
}

export function validateGenealogyProof(proof) {
  const errors = [];
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return { valid: false, errors: ["La preuve doit être un objet"] };
  for (const [value, label] of [[proof.id, "id"], [proof.factId, "factId"], [proof.factType, "factType"], [proof.documentId, "documentId"]]) {
    if (typeof value !== "string" || !value.trim()) errors.push(`${label} doit être une chaîne non vide`);
  }
  if (!Array.isArray(proof.personIds) || !proof.personIds.length || proof.personIds.some(id => typeof id !== "string" || !id.trim())) errors.push("personIds doit contenir au moins une personne");
  if (Array.isArray(proof.personIds) && new Set(proof.personIds).size !== proof.personIds.length) errors.push("personIds contient des doublons");
  if (proof.pageId !== null && (typeof proof.pageId !== "string" || !proof.pageId.trim())) errors.push("pageId doit être une chaîne non vide ou null");
  if (proof.passageId != null && (typeof proof.passageId !== "string" || !proof.passageId.trim())) errors.push("passageId doit être une chaîne non vide ou null");
  if (proof.passageId != null && proof.pageId == null) errors.push("Un passage cité doit référencer sa page");
  if (proof.passageId != null && (typeof proof.transcriptionRevisionId !== "string" || !proof.transcriptionRevisionId.trim())) errors.push("Un passage cité doit référencer sa révision de transcription");
  if (proof.relationshipId != null && (typeof proof.relationshipId !== "string" || !proof.relationshipId.trim())) errors.push("relationshipId doit être une chaîne non vide ou null");
  if (proof.familyId != null && (typeof proof.familyId !== "string" || !proof.familyId.trim())) errors.push("familyId doit être une chaîne non vide ou null");
  if (proof.photographId != null && (typeof proof.photographId !== "string" || !proof.photographId.trim())) errors.push("photographId doit être une chaîne non vide ou null");
  if (!Object.prototype.hasOwnProperty.call(proof, "sourceValue")) errors.push("sourceValue doit être présent ; null représente une valeur inconnue");
  if (!PROOF_RELATIONS.includes(proof.relation)) errors.push("relation non reconnue");
  if (!PROOF_STATUSES.includes(proof.technicalStatus)) errors.push("technicalStatus non reconnu");
  if (typeof proof.interpretation !== "string") errors.push("interpretation doit être une chaîne");
  if (!proof.citation || typeof proof.citation !== "object") errors.push("citation doit être présente");
  else {
    if (proof.citation.textIt !== null && typeof proof.citation.textIt !== "string") errors.push("citation.textIt doit être une chaîne ou null");
    if (proof.citation.translationFr !== null && typeof proof.citation.translationFr !== "string") errors.push("citation.translationFr doit être une chaîne ou null");
  }
  errors.push(...validateZone(proof.zone));
  if (proof.zone != null && (proof.photographId == null || proof.zone.photographId !== proof.photographId)) {
    errors.push("La zone et la preuve doivent référencer la même photographie");
  }
  if (proof.technicalStatus === "suspended" && (!proof.suspension || typeof proof.suspension.reason !== "string" || !proof.suspension.reason.trim())) {
    errors.push("Une preuve suspendue doit conserver un motif");
  }
  if (!Array.isArray(proof.statusHistory)) errors.push("statusHistory doit être un tableau");
  return { valid: errors.length === 0, errors };
}

export function listProofsForFact(proofs, factId) {
  nonEmpty(factId, "factId");
  return proofs.filter(proof => proof.factId === factId);
}

export function listFactsForSource(proofs, documentId) {
  nonEmpty(documentId, "documentId");
  const seen = new Set();
  return proofs.filter(proof => proof.documentId === documentId && !seen.has(proof.factId) && seen.add(proof.factId))
    .map(proof => ({ factId: proof.factId, factType: proof.factType }));
}

function collectionLookup(collection, id) {
  if (collection == null) return { state: "not_checked", value: null };
  const value = collection instanceof Map
    ? collection.get(id)
    : Array.isArray(collection)
      ? collection.find(item => item?.id === id)
      : Object.prototype.hasOwnProperty.call(collection, id) ? collection[id] : undefined;
  return value === undefined ? { state: "missing", value: null } : { state: "valid", value };
}

function validateProofZoneAgainstPage(zone, photographIds) {
  const errors = validateZone(zone);
  if (!errors.length && !photographIds.includes(zone.photographId)) errors.push("zone.photographId absent de la page");
  return errors;
}

/**
 * Vérifie uniquement les références dont les collections sont fournies.
 * Collection omise/null => not_checked ; collection fournie sans cible => missing.
 */
export function verifyProofReferences(proof, context = {}) {
  const checks = {
    document: "not_checked", page: proof.pageId == null ? "not_applicable" : "not_checked",
    revision: proof.transcriptionRevisionId == null ? "not_applicable" : "not_checked",
    passage: proof.passageId == null ? "not_applicable" : "not_checked",
    photograph: proof.photographId == null ? "not_applicable" : "not_checked",
    zone: proof.zone == null ? "not_applicable" : "not_checked",
    fact: "not_checked", relationship: proof.relationshipId == null ? "not_applicable" : "not_checked"
  };
  const documentResult = collectionLookup(context.documents, proof.documentId);
  checks.document = documentResult.state;
  let page = null;
  if (proof.pageId != null && documentResult.state === "valid") {
    if (!Array.isArray(documentResult.value.pages)) checks.page = "not_checked";
    else {
      page = documentResult.value.pages.find(item => item?.id === proof.pageId) || null;
      checks.page = page ? "valid" : "missing";
    }
  } else if (proof.pageId != null && documentResult.state === "missing") checks.page = "missing";

  let revision = null;
  if (proof.transcriptionRevisionId != null) {
    const result = collectionLookup(context.revisions, proof.transcriptionRevisionId);
    checks.revision = result.state;
    if (result.state === "valid") {
      revision = result.value;
      if (revision.documentId !== proof.documentId || revision.pageId !== proof.pageId) checks.revision = "mismatch";
    }
  }
  if (proof.passageId != null && checks.revision === "valid") {
    checks.passage = (revision.passages || []).some(item => item?.id === proof.passageId) ? "valid" : "missing";
  } else if (proof.passageId != null && ["missing", "mismatch"].includes(checks.revision)) checks.passage = checks.revision;

  if (proof.photographId != null && page) {
    checks.photograph = (page.photographs || []).some(item => item?.id === proof.photographId) ? "valid" : "missing";
  } else if (proof.photographId != null && checks.page === "missing") checks.photograph = "missing";
  if (proof.zone != null && page) {
    const issues = validateProofZoneAgainstPage(proof.zone, (page.photographs || []).map(item => item.id));
    checks.zone = issues.length ? "mismatch" : "valid";
  }

  const factResult = collectionLookup(context.facts, proof.factId);
  checks.fact = factResult.state;
  if (checks.fact === "valid" && factResult.value.factType && factResult.value.factType !== proof.factType) checks.fact = "mismatch";
  if (proof.relationshipId != null) {
    const relationshipResult = collectionLookup(context.relationships, proof.relationshipId);
    checks.relationship = relationshipResult.state;
    if (relationshipResult.state === "valid") {
      const state = relationshipResult.value.state;
      checks.relationship = ["invalidated", "historical"].includes(state) ? "historical" : state === "active" ? "valid" : "mismatch";
    }
  }
  const states = Object.values(checks).filter(state => state !== "not_applicable");
  const status = states.some(state => ["missing", "mismatch"].includes(state))
    ? "invalid"
    : states.includes("not_checked") ? "not_checked"
      : states.includes("historical") ? "historical" : "valid";
  return { status, checks };
}

export function transitionProofStatus(proof, { to, reason, eventId = null, actorUid = null, at = null } = {}) {
  if (!validateGenealogyProof(proof).valid) throw new TypeError("Preuve invalide");
  if (!PROOF_STATUSES.includes(to) || to === proof.technicalStatus) throw new TypeError("Transition d’état de preuve invalide");
  if (proof.technicalStatus === "historical") throw new Error("Une preuve historique ne peut pas être réactivée ou suspendue");
  nonEmpty(reason, "reason");
  optionalString(eventId, "eventId");
  optionalString(actorUid, "actorUid");
  if (at !== null && typeof at !== "string" && !(at instanceof Date)) throw new TypeError("at doit être une chaîne, une date ou null");
  if (at instanceof Date && !Number.isFinite(at.getTime())) throw new TypeError("at doit être une date valide");
  const event = {
    from: proof.technicalStatus,
    to,
    reason,
    eventId,
    actorUid,
    at: at instanceof Date ? at.toISOString() : at
  };
  const next = {
    ...cloneValue(proof),
    technicalStatus: to,
    suspension: to === "suspended" ? { reason, eventId, at: event.at } : null,
    statusHistory: [...proof.statusHistory.map(item => cloneValue(item)), event]
  };
  return deepFreeze(next);
}

export function prepareProofsForTranscriptChange(proofs, comparison) {
  const affected = new Set((comparison?.passageChanges || [])
    .filter(change => change.substantive && change.proofReviewRequired)
    .map(change => change.passageId));
  return proofs.filter(proof => proof.passageId && affected.has(proof.passageId) && proof.technicalStatus === "active")
    .map(proof => ({ proofId: proof.id, from: "active", to: "suspended", eventId: comparison.revisionId ?? null, action: "review-required" }));
}

export function prepareProofsForIdentityChange(proofs, { personId, eventId = null } = {}) {
  nonEmpty(personId, "personId");
  optionalString(eventId, "eventId");
  return proofs.filter(proof => proof.technicalStatus === "active" && proof.personIds.includes(personId))
    .map(proof => ({ proofId: proof.id, from: "active", to: "suspended", eventId, action: "identity-review-required" }));
}

export function prepareProofsForHistoricalRelationship(proofs, relationshipId) {
  nonEmpty(relationshipId, "relationshipId");
  return proofs.filter(proof => proof.relationshipId === relationshipId && proof.technicalStatus !== "historical")
    .map(proof => ({ proofId: proof.id, from: proof.technicalStatus, to: "historical", action: "preserve-historical-reference" }));
}

export function prepareProofReassessment(proof) {
  if (proof?.technicalStatus !== "suspended") throw new Error("Seule une preuve suspendue peut être proposée à la réévaluation");
  return deepFreeze({ proofId: proof.id, currentStatus: "suspended", proposedStatus: "active", requiresExplicitDecision: true });
}
