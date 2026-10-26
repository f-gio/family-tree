/* Modèle pur de confrontation des preuves et conclusions (lot 5).
   Aucun accès Firebase, DOM, réseau ni mutation des faits dans l'arbre.
   Les décisions sont créées explicitement et réservées ici aux rôles admin
   fournis par l'appelant ; cette vérification locale ne remplace pas les Rules.
*/

export const FACT_CONCLUSION_STATUSES = Object.freeze([
  "undetermined", "provisional", "established", "disputed", "reexamination_required"
]);

const ASSERTION_RELATIONS = new Set(["supports", "contradicts"]);

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} doit être une chaîne non vide`);
  return value;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(item => cloneValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  return value;
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checkedMapOrArray(collection, field) {
  if (!Array.isArray(collection) && !(collection instanceof Map)) throw new TypeError(`${field} doit être un tableau ou une Map`);
}

function lookupReference(collection, id) {
  if (collection instanceof Map) return collection.get(id);
  return collection.find(item => item?.id === id);
}

function referenceState(referenceChecks, proofId) {
  const result = referenceChecks instanceof Map ? referenceChecks.get(proofId) : referenceChecks?.[proofId];
  return result?.status || "not_checked";
}

function proofSummary(proof, referenceChecks) {
  return {
    proofId: proof.id,
    relation: proof.relation,
    sourceValue: proof.sourceValue,
    citation: cloneValue(proof.citation),
    documentId: proof.documentId,
    pageId: proof.pageId,
    passageId: proof.passageId,
    transcriptionRevisionId: proof.transcriptionRevisionId,
    technicalStatus: proof.technicalStatus,
    referenceStatus: referenceState(referenceChecks, proof.id),
    authorUid: proof.authorUid,
    createdAt: proof.createdAt
  };
}

/** Regroupe les preuves d'un fait sans voter ni produire de conclusion. */
export function createFactEvidenceDossier({ factId, factType = "", treeValue = null, proofs = [], referenceChecks = null } = {}) {
  requireString(factId, "factId");
  if (!Array.isArray(proofs)) throw new TypeError("proofs doit être un tableau");
  const matching = proofs.filter(proof => proof?.factId === factId).map(proof => proofSummary(proof, referenceChecks));
  const claims = new Map();
  const mentions = [];
  const ambiguous = [];
  const suspended = [];
  const historical = [];
  const technicallyUnverified = [];
  const excluded = [];

  for (const proof of matching) {
    if (proof.technicalStatus === "suspended") { suspended.push(proof); continue; }
    if (proof.technicalStatus === "historical") { historical.push(proof); continue; }
    if (proof.referenceStatus !== "valid") { technicallyUnverified.push(proof); continue; }
    if (proof.relation === "mentions") { mentions.push(proof); continue; }
    if (proof.relation === "ambiguous") { ambiguous.push(proof); continue; }
    if (!ASSERTION_RELATIONS.has(proof.relation) || proof.sourceValue == null) { excluded.push(proof); continue; }
    const key = stableValue(proof.sourceValue);
    if (!claims.has(key)) claims.set(key, { value: cloneValue(proof.sourceValue), supports: [], contradicts: [] });
    claims.get(key)[proof.relation].push(proof);
  }

  return freezeDeep({
    factId,
    factType,
    treeValue: cloneValue(treeValue),
    claims: [...claims.values()],
    hasDistinctClaims: claims.size > 1,
    mentions,
    ambiguous,
    suspended,
    historical,
    technicallyUnverified,
    excluded,
    conclusion: null
  });
}

export function groupProofsByFact(proofs = []) {
  if (!Array.isArray(proofs)) throw new TypeError("proofs doit être un tableau");
  const groups = new Map();
  for (const proof of proofs) {
    if (!proof || typeof proof.factId !== "string" || !proof.factId.trim()) continue;
    if (!groups.has(proof.factId)) groups.set(proof.factId, []);
    groups.get(proof.factId).push(proof);
  }
  return [...groups.entries()].map(([factId, items]) => ({ factId, proofs: [...items] }));
}

export function assertAdministratorRole(role) {
  if (!(["admin", "primary-admin"].includes(role))) throw new Error("Une décision de conclusion est réservée aux administrateurs");
  return true;
}

export function createConclusionRevision({
  id,
  conclusionId,
  factId,
  factType,
  subjectKind,
  subjectId,
  previousRevisionId = null,
  status,
  retainedValue = null,
  justification,
  examinedProofIds = [],
  decisiveProofIds = [],
  contradictoryProofIds = [],
  excludedProofs = [],
  authorUid = null,
  createdAt = null,
  reason,
  actorRole
} = {}) {
  assertAdministratorRole(actorRole);
  for (const [value, field] of [[id, "revision.id"], [conclusionId, "conclusionId"], [factId, "factId"], [factType, "factType"], [subjectKind, "subjectKind"], [subjectId, "subjectId"], [justification, "justification"], [reason, "reason"]]) {
    requireString(value, field);
  }
  if (!FACT_CONCLUSION_STATUSES.includes(status)) throw new TypeError("Statut de conclusion non reconnu");
  if (previousRevisionId !== null && (typeof previousRevisionId !== "string" || !previousRevisionId.trim())) throw new TypeError("previousRevisionId doit être une chaîne non vide ou null");
  if (previousRevisionId === id) throw new Error("Une révision ne peut pas se référencer elle-même");
  for (const [ids, field] of [[examinedProofIds, "examinedProofIds"], [decisiveProofIds, "decisiveProofIds"], [contradictoryProofIds, "contradictoryProofIds"]]) {
    if (!Array.isArray(ids) || ids.some(value => typeof value !== "string" || !value.trim()) || new Set(ids).size !== ids.length) {
      throw new TypeError(`${field} doit être un tableau d'identifiants uniques`);
    }
  }
  if (decisiveProofIds.some(id => !examinedProofIds.includes(id)) || contradictoryProofIds.some(id => !examinedProofIds.includes(id))) {
    throw new Error("Les preuves déterminantes ou contradictoires doivent faire partie des preuves examinées");
  }
  if (!Array.isArray(excludedProofs) || excludedProofs.some(item => !item || typeof item.proofId !== "string" || !item.proofId.trim() || typeof item.reason !== "string" || !item.reason.trim())) {
    throw new TypeError("excludedProofs doit contenir des identifiants et justifications");
  }
  if (excludedProofs.some(item => !examinedProofIds.includes(item.proofId))) throw new Error("Les preuves écartées doivent faire partie des preuves examinées");
  if (authorUid !== null && (typeof authorUid !== "string" || !authorUid.trim())) throw new TypeError("authorUid doit être une chaîne non vide ou null");
  if (createdAt !== null && typeof createdAt !== "string" && !(createdAt instanceof Date)) throw new TypeError("createdAt doit être une chaîne, une date ou null");
  if (createdAt instanceof Date && !Number.isFinite(createdAt.getTime())) throw new TypeError("createdAt doit être une date valide");

  return freezeDeep({
    id,
    conclusionId,
    factId,
    factType,
    subject: { kind: subjectKind, id: subjectId },
    previousRevisionId,
    status,
    retainedValue: cloneValue(retainedValue),
    justification,
    examinedProofIds: [...examinedProofIds],
    decisiveProofIds: [...decisiveProofIds],
    contradictoryProofIds: [...contradictoryProofIds],
    excludedProofs: cloneValue(excludedProofs),
    authorUid,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    reason
  });
}

export function validateConclusionRevision(revision) {
  const errors = [];
  if (!revision || typeof revision !== "object" || Array.isArray(revision)) return { valid: false, errors: ["La révision de conclusion doit être un objet"] };
  for (const key of ["id", "conclusionId", "factId", "factType", "reason", "justification"]) {
    if (typeof revision[key] !== "string" || !revision[key].trim()) errors.push(`${key} doit être une chaîne non vide`);
  }
  if (!FACT_CONCLUSION_STATUSES.includes(revision.status)) errors.push("Statut de conclusion non reconnu");
  if (revision.previousRevisionId !== null && (typeof revision.previousRevisionId !== "string" || !revision.previousRevisionId.trim())) errors.push("previousRevisionId invalide");
  if (!revision.subject || typeof revision.subject.kind !== "string" || !revision.subject.kind.trim()
    || typeof revision.subject.id !== "string" || !revision.subject.id.trim()) errors.push("subject doit préciser son type et son identifiant");
  for (const key of ["examinedProofIds", "decisiveProofIds", "contradictoryProofIds"]) {
    if (!Array.isArray(revision[key]) || revision[key].some(id => typeof id !== "string" || !id.trim())
      || new Set(revision[key]).size !== revision[key].length) errors.push(`${key} invalide`);
  }
  if (Array.isArray(revision.examinedProofIds)) {
    for (const key of ["decisiveProofIds", "contradictoryProofIds"]) {
      if (Array.isArray(revision[key]) && revision[key].some(id => !revision.examinedProofIds.includes(id))) errors.push(`${key} doit être inclus dans examinedProofIds`);
    }
  }
  if (!Array.isArray(revision.excludedProofs)
    || revision.excludedProofs.some(item => !item || typeof item.proofId !== "string" || !item.proofId.trim() || typeof item.reason !== "string" || !item.reason.trim())) {
    errors.push("excludedProofs invalide");
  } else if (Array.isArray(revision.examinedProofIds) && revision.excludedProofs.some(item => !revision.examinedProofIds.includes(item.proofId))) {
    errors.push("Les preuves écartées doivent faire partie des preuves examinées");
  }
  if (revision.authorUid !== null && (typeof revision.authorUid !== "string" || !revision.authorUid.trim())) errors.push("authorUid invalide");
  if (revision.createdAt !== null && (typeof revision.createdAt !== "string" || !revision.createdAt.trim())) errors.push("createdAt invalide");
  if (!Object.prototype.hasOwnProperty.call(revision, "retainedValue")) errors.push("retainedValue doit être présent ; null représente une valeur inconnue");
  return { valid: errors.length === 0, errors };
}

export function createConclusionHead({ id, factId, factType, firstRevision } = {}, { actorRole, existingHeads = [] } = {}) {
  assertAdministratorRole(actorRole);
  for (const [value, field] of [[id, "head.id"], [factId, "head.factId"], [factType, "head.factType"]]) requireString(value, field);
  if (!validateConclusionRevision(firstRevision).valid
    || firstRevision.conclusionId !== id || firstRevision.factId !== factId || firstRevision.factType !== factType
    || firstRevision.previousRevisionId !== null) {
    throw new Error("La conclusion doit démarrer depuis une première révision valide du même fait");
  }
  if (!Array.isArray(existingHeads) || existingHeads.some(head => head.factId === factId)) {
    throw new Error("Une conclusion courante existe déjà pour ce fait");
  }
  return freezeDeep({ id, factId, factType, currentRevisionId: firstRevision.id });
}

export function advanceConclusionHead(head, revision, { actorRole } = {}) {
  assertAdministratorRole(actorRole);
  if (!head || !revision || revision.conclusionId !== head.id || revision.factId !== head.factId || revision.factType !== head.factType) {
    throw new Error("La révision ne correspond pas à cette conclusion");
  }
  if (revision.previousRevisionId !== head.currentRevisionId) throw new Error("La révision ne prolonge pas la version courante ; actualisez avant de décider");
  if (!validateConclusionRevision(revision).valid) throw new TypeError("Révision de conclusion invalide");
  return freezeDeep({ ...head, currentRevisionId: revision.id });
}

export function validateSingleCurrentConclusionHeads(heads) {
  if (!Array.isArray(heads)) return { valid: false, errors: ["heads doit être un tableau"] };
  const seenFactIds = new Set();
  const seenHeadIds = new Set();
  const errors = [];
  for (const head of heads) {
    if (!head || typeof head.factId !== "string" || !head.factId.trim() || typeof head.id !== "string" || !head.id.trim()
      || typeof head.currentRevisionId !== "string" || !head.currentRevisionId.trim()) {
      errors.push("Chaque conclusion courante doit avoir un ID stable, un factId et une révision courante");
      continue;
    }
    if (seenFactIds.has(head.factId)) errors.push(`Plusieurs conclusions courantes pour le fait ${head.factId}`);
    if (seenHeadIds.has(head.id)) errors.push(`ID de conclusion dupliqué : ${head.id}`);
    seenFactIds.add(head.factId);
    seenHeadIds.add(head.id);
  }
  return { valid: errors.length === 0, errors };
}

export function getCurrentConclusion(heads, revisions, factId) {
  const head = heads.find(item => item.factId === factId);
  if (!head) return null;
  const revision = revisions.find(item => item.id === head.currentRevisionId && item.conclusionId === head.id);
  if (!revision) return { head, revision: null, state: "missing-current-revision" };
  return { head, revision, state: "current" };
}

export function getConclusionHistory(revisions, conclusionId, currentRevisionId) {
  const byId = new Map(revisions.filter(item => item.conclusionId === conclusionId).map(item => [item.id, item]));
  const history = [];
  const visited = new Set();
  let nextId = currentRevisionId;
  while (nextId) {
    if (visited.has(nextId)) throw new Error("Boucle détectée dans l'historique des conclusions");
    visited.add(nextId);
    const revision = byId.get(nextId);
    if (!revision) return { history, missingRevisionId: nextId };
    history.push(revision);
    nextId = revision.previousRevisionId;
  }
  return { history, missingRevisionId: null };
}

function sameValue(left, right) {
  return stableValue(left) === stableValue(right);
}

export function prepareConclusionReexamination({ conclusion, proofs = [], transcriptChange = null, identityChange = null, relationChange = null, newProof = null, newProofReferenceStatus = "not_checked" } = {}) {
  if (!conclusion || typeof conclusion.factId !== "string") throw new TypeError("conclusion.factId doit être fourni");
  const reasons = [];
  const examined = new Set(conclusion.examinedProofIds || []);
  const proofById = new Map(proofs.map(proof => [proof.id, proof]));

  for (const proofId of examined) {
    const proof = proofById.get(proofId);
    if (proof?.technicalStatus === "suspended") reasons.push({ kind: "proof-suspended", proofId });
    if (proof?.technicalStatus === "historical" && proof.relationshipId) reasons.push({ kind: "relation-historical", proofId, relationshipId: proof.relationshipId });
  }
  const changedPassageIds = new Set(transcriptChange?.passageChanges
    ?.filter(item => item.substantive && item.proofReviewRequired)
    .map(item => item.passageId) || []);
  for (const proofId of examined) {
    const proof = proofById.get(proofId);
    if (proof?.passageId && changedPassageIds.has(proof.passageId)) reasons.push({ kind: "cited-passage-changed", proofId, passageId: proof.passageId });
  }
  if (identityChange?.personId) {
    for (const proofId of examined) {
      const proof = proofById.get(proofId);
      if (proof?.personIds?.includes(identityChange.personId)) reasons.push({ kind: "identity-changed", proofId, personId: identityChange.personId });
    }
  }
  if (relationChange?.relationshipId) {
    for (const proofId of examined) {
      const proof = proofById.get(proofId);
      if (proof?.relationshipId === relationChange.relationshipId) reasons.push({ kind: "relation-invalidated", proofId, relationshipId: relationChange.relationshipId });
    }
  }
  if (newProof?.factId === conclusion.factId && newProof.technicalStatus === "active"
    && newProofReferenceStatus === "valid" && newProof.relation === "contradicts") {
    reasons.push({ kind: "contradictory-proof-added", proofId: newProof.id });
  } else if (newProof?.factId === conclusion.factId && newProof.relation === "supports"
    && newProof.technicalStatus === "active" && newProofReferenceStatus === "valid"
    && newProof.sourceValue != null && conclusion.retainedValue != null && !sameValue(newProof.sourceValue, conclusion.retainedValue)) {
    reasons.push({ kind: "divergent-assertion-added", proofId: newProof.id });
  }
  const uniqueReasons = [...new Map(reasons.map(reason => [JSON.stringify(reason), reason])).values()];
  return {
    conclusionId: conclusion.conclusionId,
    factId: conclusion.factId,
    currentStatus: conclusion.status,
    proposedStatus: uniqueReasons.length ? "reexamination_required" : conclusion.status,
    requiresExplicitAdminDecision: uniqueReasons.length > 0,
    reasons: uniqueReasons
  };
}
