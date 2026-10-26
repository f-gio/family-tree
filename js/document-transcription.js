/* Modèle pur de transcriptions, traductions, passages et révisions (lot 3).
   Aucun accès Firebase, DOM, stockage ou réseau. Les IDs sont toujours fournis
   par l'appelant ; ce module ne les crée pas lors d'une lecture.
*/

export const PALEOGRAPHIC_CONFIDENCE = Object.freeze(["high", "medium", "low", "unknown"]);
export const TRANSCRIPTION_CHANGE_KINDS = Object.freeze([
  "initial", "transcription-correction", "translation-correction", "formatting", "layout"
]);
export const TRANSLATION_STATES = Object.freeze(["not-started", "current", "needs-review"]);

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} doit être une chaîne non vide`);
  return value;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    const copy = {};
    for (const [key, nested] of Object.entries(value)) copy[key] = cloneValue(nested);
    return copy;
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function isNormalizedCoordinate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateAnchor(anchor) {
  if (anchor == null) return [];
  const errors = [];
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return ["anchor doit être un rectangle ou null"];
  if (anchor.shape !== "rect") errors.push("anchor.shape doit être rect");
  if (typeof anchor.photographId !== "string" || !anchor.photographId.trim()) errors.push("anchor.photographId doit identifier une photographie précise");
  for (const key of ["x", "y", "width", "height"]) {
    if (!isNormalizedCoordinate(anchor[key])) errors.push(`anchor.${key} doit être une coordonnée normalisée entre 0 et 1`);
  }
  if (["x", "y", "width", "height"].every(key => isNormalizedCoordinate(anchor[key]))) {
    if (anchor.width <= 0 || anchor.height <= 0) errors.push("La largeur et la hauteur de la zone doivent être positives");
    if (anchor.x + anchor.width > 1 || anchor.y + anchor.height > 1) errors.push("La zone doit rester dans les limites normalisées de la photographie");
  }
  return errors;
}

export function createReadingHypothesis({ id, text, confidence = "unknown", note = "" } = {}) {
  nonEmptyString(id, "hypothesis.id");
  if (typeof text !== "string") throw new TypeError("hypothesis.text doit être une chaîne");
  if (!PALEOGRAPHIC_CONFIDENCE.includes(confidence)) throw new TypeError("Niveau de confiance paléographique non reconnu");
  if (typeof note !== "string") throw new TypeError("hypothesis.note doit être une chaîne");
  return { id, text, confidence, note };
}

export function createTranscriptionPassage({
  id,
  order,
  textIt = "",
  translationFr = null,
  separatorAfter = "",
  unreadable = false,
  hypotheses = [],
  anchor = null,
  lineLabel = "",
  translationState
} = {}) {
  nonEmptyString(id, "passage.id");
  if (!Number.isInteger(order) || order < 0) throw new TypeError("passage.order doit être un entier positif ou nul");
  if (typeof textIt !== "string") throw new TypeError("passage.textIt doit être une chaîne");
  if (translationFr !== null && typeof translationFr !== "string") throw new TypeError("passage.translationFr doit être une chaîne ou null");
  if (typeof separatorAfter !== "string") throw new TypeError("passage.separatorAfter doit être une chaîne");
  if (typeof unreadable !== "boolean") throw new TypeError("passage.unreadable doit être booléen");
  if (!Array.isArray(hypotheses)) throw new TypeError("passage.hypotheses doit être un tableau");
  if (typeof lineLabel !== "string") throw new TypeError("passage.lineLabel doit être une chaîne");
  const normalizedHypotheses = hypotheses.map(item => createReadingHypothesis(item));
  if (new Set(normalizedHypotheses.map(item => item.id)).size !== normalizedHypotheses.length) {
    throw new TypeError("Les IDs d'hypothèse doivent être uniques dans le passage");
  }
  const anchorErrors = validateAnchor(anchor);
  if (anchorErrors.length) throw new TypeError(anchorErrors.join("; "));
  const state = translationState ?? (translationFr == null ? "not-started" : "current");
  if (!TRANSLATION_STATES.includes(state)) throw new TypeError("État de traduction non reconnu");

  return {
    id,
    order,
    textIt,
    translationFr,
    separatorAfter,
    unreadable,
    hypotheses: normalizedHypotheses,
    anchor: anchor == null ? null : { ...anchor },
    lineLabel,
    translationState: state
  };
}

export function validateTranscriptionPassage(passage, { photographIds = null } = {}) {
  const errors = [];
  if (!passage || typeof passage !== "object" || Array.isArray(passage)) return { valid: false, errors: ["Le passage doit être un objet"] };
  if (typeof passage.id !== "string" || !passage.id.trim()) errors.push("passage.id doit être une chaîne non vide");
  if (!Number.isInteger(passage.order) || passage.order < 0) errors.push("passage.order doit être un entier positif ou nul");
  if (typeof passage.textIt !== "string") errors.push("passage.textIt doit être une chaîne");
  if (passage.translationFr !== null && passage.translationFr !== undefined && typeof passage.translationFr !== "string") errors.push("passage.translationFr doit être une chaîne ou null");
  if (typeof passage.separatorAfter !== "string") errors.push("passage.separatorAfter doit être une chaîne");
  if (typeof passage.unreadable !== "boolean") errors.push("passage.unreadable doit être booléen");
  if (!TRANSLATION_STATES.includes(passage.translationState)) errors.push("passage.translationState non reconnu");
  if (!Array.isArray(passage.hypotheses)) errors.push("passage.hypotheses doit être un tableau");
  else {
    const hypothesisIds = new Set();
    for (const hypothesis of passage.hypotheses) {
      if (!hypothesis || typeof hypothesis !== "object" || Array.isArray(hypothesis)) {
        errors.push("Chaque hypothèse doit être un objet");
        continue;
      }
      if (typeof hypothesis.id !== "string" || !hypothesis.id.trim()) errors.push("hypothesis.id doit être une chaîne non vide");
      if (typeof hypothesis.text !== "string") errors.push("hypothesis.text doit être une chaîne");
      if (!PALEOGRAPHIC_CONFIDENCE.includes(hypothesis.confidence)) errors.push("Niveau de confiance paléographique non reconnu");
      if (typeof hypothesis.note !== "string") errors.push("hypothesis.note doit être une chaîne");
      if (hypothesis.id && hypothesisIds.has(hypothesis.id)) errors.push("Les IDs d'hypothèse doivent être uniques dans le passage");
      if (hypothesis.id) hypothesisIds.add(hypothesis.id);
    }
  }
  errors.push(...validateAnchor(passage.anchor));
  if (passage.anchor && Array.isArray(photographIds) && !photographIds.includes(passage.anchor.photographId)) {
    errors.push("La zone référence une photographie absente de la page");
  }
  return { valid: errors.length === 0, errors };
}

function reassemble(passages, field) {
  const ordered = [...passages].sort((a, b) => a.order - b.order);
  return ordered.map(passage => `${passage[field] || ""}${passage.separatorAfter}`).join("");
}

export function reconstructItalianTranscription(passages = []) {
  return reassemble(passages, "textIt");
}

export function reconstructFrenchTranslation(passages = []) {
  return reassemble(passages, "translationFr");
}

/** Creates an immutable snapshot. Callers supply stable IDs and known authors/timestamps. */
export function createPageTextRevision({
  id,
  documentId,
  pageId,
  previousRevisionId = null,
  authorUid = null,
  changedAt = null,
  changeKind = "initial",
  justification = "",
  passages = [],
  photographIds = null
} = {}) {
  nonEmptyString(id, "revision.id");
  nonEmptyString(documentId, "revision.documentId");
  nonEmptyString(pageId, "revision.pageId");
  if (previousRevisionId !== null && (typeof previousRevisionId !== "string" || !previousRevisionId.trim())) throw new TypeError("previousRevisionId doit être une chaîne non vide ou null");
  if (previousRevisionId === id) throw new Error("Une révision ne peut pas se référencer elle-même comme précédente");
  if (authorUid !== null && (typeof authorUid !== "string" || !authorUid.trim())) throw new TypeError("authorUid doit être une chaîne non vide ou null");
  if (changedAt !== null && typeof changedAt !== "string" && !(changedAt instanceof Date)) throw new TypeError("changedAt doit être une chaîne, une date ou null");
  if (changedAt instanceof Date && !Number.isFinite(changedAt.getTime())) throw new TypeError("changedAt doit être une date valide");
  if (!TRANSCRIPTION_CHANGE_KINDS.includes(changeKind)) throw new TypeError("Type de révision non reconnu");
  if (typeof justification !== "string") throw new TypeError("justification doit être une chaîne");
  if (!Array.isArray(passages)) throw new TypeError("passages doit être un tableau");
  const snapshotPassages = passages.map(passage => createTranscriptionPassage(passage))
    .sort((left, right) => left.order - right.order);
  const passageIds = new Set();
  const orders = new Set();
  for (const passage of snapshotPassages) {
    if (passageIds.has(passage.id)) throw new Error("Les IDs de passage doivent être uniques dans une révision");
    if (orders.has(passage.order)) throw new Error("L'ordre des passages doit être unique dans une révision");
    passageIds.add(passage.id);
    orders.add(passage.order);
    const result = validateTranscriptionPassage(passage, { photographIds });
    if (!result.valid) throw new TypeError(result.errors.join("; "));
  }
  const revision = {
    id,
    documentId,
    pageId,
    previousRevisionId,
    authorUid,
    changedAt: changedAt instanceof Date ? changedAt.toISOString() : changedAt,
    changeKind,
    justification,
    passages: snapshotPassages,
    transcriptionIt: reconstructItalianTranscription(snapshotPassages),
    translationFr: snapshotPassages.some(passage => passage.translationFr !== null)
      ? reconstructFrenchTranslation(snapshotPassages)
      : null
  };
  return deepFreeze(cloneValue(revision));
}

function semanticText(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
}

function semanticOptionalText(value) {
  return value == null ? null : semanticText(value);
}

function canonicalHypotheses(hypotheses = []) {
  return hypotheses.map(item => ({ id: item.id, text: semanticText(item.text), confidence: item.confidence, note: semanticText(item.note) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Compares immutable revisions; reports review needs but does not suspend proofs. */
export function comparePageTextRevisions(previous, next) {
  if (!previous || !next || previous.documentId !== next.documentId || previous.pageId !== next.pageId) {
    throw new Error("Les révisions comparées doivent cibler le même document et la même page");
  }
  const previousById = new Map(previous.passages.map(passage => [passage.id, passage]));
  const nextById = new Map(next.passages.map(passage => [passage.id, passage]));
  const passageChanges = [];
  for (const id of new Set([...previousById.keys(), ...nextById.keys()])) {
    const before = previousById.get(id);
    const after = nextById.get(id);
    if (!before) {
      passageChanges.push({ passageId: id, change: "added", substantive: true, proofReviewRequired: false, translationNeedsReview: false });
      continue;
    }
    if (!after) {
      passageChanges.push({ passageId: id, change: "removed", substantive: true, proofReviewRequired: true, translationNeedsReview: false });
      continue;
    }
    const rawItalianChanged = before.textIt !== after.textIt;
    const italianChanged = semanticText(before.textIt) !== semanticText(after.textIt);
    const rawTranslationChanged = before.translationFr !== after.translationFr;
    const translationChanged = semanticOptionalText(before.translationFr) !== semanticOptionalText(after.translationFr);
    const hypothesesChanged = !sameValue(canonicalHypotheses(before.hypotheses), canonicalHypotheses(after.hypotheses));
    const anchorChanged = !sameValue(before.anchor, after.anchor);
    const unreadableChanged = before.unreadable !== after.unreadable;
    const substantive = italianChanged || translationChanged || hypothesesChanged || anchorChanged || unreadableChanged;
    const formattingOnly = !substantive && (rawItalianChanged || (before.translationFr != null && after.translationFr != null && rawTranslationChanged));
    const translationNeedsReview = italianChanged
      && (before.translationFr !== null || after.translationFr !== null)
      && !translationChanged;
    const presentationChanged = before.order !== after.order || before.lineLabel !== after.lineLabel;
    if (substantive || formattingOnly || presentationChanged) {
      passageChanges.push({
        passageId: id,
        change: substantive ? "substantive" : formattingOnly ? "formatting-only" : "presentation-only",
        substantive,
        proofReviewRequired: substantive,
        translationNeedsReview
      });
    }
  }
  return {
    previousRevisionId: previous.id,
    revisionId: next.id,
    passageChanges,
    passagesRequiringProofReview: passageChanges.filter(change => change.proofReviewRequired).map(change => change.passageId),
    passagesWithTranslationToReview: passageChanges.filter(change => change.translationNeedsReview).map(change => change.passageId)
  };
}
