/* Modèle pur du formulaire guidé de Preuve (lot 2A).
   Aucun accès Firebase, DOM, réseau. Compose et valide les champs guidés du
   dialogue de contribution pour produire l'entrée attendue par
   createGenealogyProof (genealogy-proofs.js) et le flux officiel existant. */

import { PROOF_RELATIONS } from "./genealogy-proofs.js";
import { buildFactIdentityId } from "./genealogy-identities.js";

export const PROOF_FACT_KINDS = Object.freeze(["birth", "marriage", "death", "burial", "residence", "other"]);

export const PROOF_FACT_KIND_LABELS = Object.freeze({
  birth: "Naissance",
  marriage: "Mariage",
  death: "Décès",
  burial: "Sépulture",
  residence: "Résidence",
  other: "Autre"
});

export const PROOF_RELATION_LABELS = Object.freeze({
  supports: "Confirme",
  contradicts: "Contredit",
  mentions: "Mentionne",
  ambiguous: "Ambiguë"
});

export function proofFactType(factKind, factOtherLabel = "") {
  if (factKind === "other") return String(factOtherLabel || "").trim();
  return factKind;
}

export function proofFactTypeLabel(factKind, factOtherLabel = "") {
  if (factKind === "other") return String(factOtherLabel || "").trim() || "Autre";
  return PROOF_FACT_KIND_LABELS[factKind] || factKind;
}

/** Une relation familiale n'a de sens que pour un fait existant qui porte déjà
    une relation, ou pour un fait de type union (mariage). */
export function showProofFamilyRelation({ factKind, existingFact } = {}) {
  if (factKind === "marriage") return true;
  return Boolean(existingFact && (existingFact.relationshipId || existingFact.familyId));
}

export function validateProofGuidedFields(fields = {}) {
  const errors = {};
  const factKind = fields.factKind;
  if (!PROOF_FACT_KINDS.includes(factKind)) errors.factKind = "Choisissez un type de fait dans la liste.";
  const factType = proofFactType(factKind, fields.factOtherLabel);
  if (factKind === "other" && !factType) errors.factOtherLabel = "Indiquez l'intitulé du fait (« Autre »).";
  const personIds = Array.isArray(fields.personIds) ? fields.personIds.filter(id => typeof id === "string" && id.trim()) : [];
  if (!personIds.length) errors.personIds = "Sélectionnez au moins une personne concernée.";
  else if (new Set(personIds).size !== personIds.length) errors.personIds = "La même personne est sélectionnée plusieurs fois.";
  if (!fields.documentId || !String(fields.documentId).trim()) errors.documentId = "Sélectionnez le document d'origine de la preuve.";
  const pageId = fields.pageId ? String(fields.pageId).trim() : "";
  const passageId = fields.passageId ? String(fields.passageId).trim() : "";
  const transcriptionRevisionId = fields.transcriptionRevisionId ? String(fields.transcriptionRevisionId).trim() : "";
  if (passageId && !pageId) errors.passage = "Un passage cité doit être rattaché à sa page.";
  if (passageId && !transcriptionRevisionId) errors.passage = "Le passage sélectionné n'est plus lié à une révision de transcription.";
  if (!PROOF_RELATIONS.includes(fields.relation)) errors.relation = "Choisissez la relation entre cette source et le fait.";
  const sourceUnknown = Boolean(fields.sourceUnknown);
  const sourceValue = fields.sourceValue == null ? "" : String(fields.sourceValue).trim();
  if (!sourceUnknown && !sourceValue) errors.sourceValue = "Indiquez la valeur relevée dans le document, ou cochez « Non relevée ».";
  if (fields.citationIt != null && typeof fields.citationIt !== "string") errors.citationIt = "La citation italienne doit être un texte.";
  if (fields.citationFr != null && typeof fields.citationFr !== "string") errors.citationFr = "La traduction doit être un texte.";
  if (factType && typeof fields.existingFactId === "string" && fields.existingFactId.trim() && fields.existingFactType && factType !== String(fields.existingFactType).trim() && factKind !== "other") {
    errors.factKind = "Le type choisi ne correspond pas au fait existant sélectionné.";
  }
  if (fields.relationshipId && !fields.familyId && factKind !== "marriage") {
    errors.factKind = "Cette relation familiale n'est pas compatible avec le fait sélectionné.";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Composition de l'entrée de preuve à partir des champs guidés.
    Les identifiants techniques ne sont jamais rendus à l'interface : le
    factId est réutilisé (fait existant) ou dérivé du tuple stable du lot 0. */
export function buildProofGuidedInput(fields = {}) {
  const personIds = Array.isArray(fields.personIds) ? [...new Set(fields.personIds.filter(id => typeof id === "string" && id.trim()))] : [];
  const existingFactId = fields.existingFactId ? String(fields.existingFactId).trim() : "";
  const existingFactType = fields.existingFactType ? String(fields.existingFactType).trim() : "";
  const factType = existingFactId && existingFactType ? existingFactType : proofFactType(fields.factKind, fields.factOtherLabel);
  if (!factType) throw new TypeError("Un type de fait est requis pour construire la preuve.");
  const stableSubject = [...personIds].sort()[0] || "";
  const factId = existingFactId || buildFactIdentityId("person", stableSubject, factType);
  const pageId = fields.pageId ? String(fields.pageId).trim() : null;
  const passageId = fields.passageId ? String(fields.passageId).trim() : null;
  const transcriptionRevisionId = fields.transcriptionRevisionId ? String(fields.transcriptionRevisionId).trim() : null;
  const sourceUnknown = Boolean(fields.sourceUnknown);
  return {
    factId,
    factType,
    personIds,
    relationshipId: fields.relationshipId ? String(fields.relationshipId).trim() : null,
    familyId: fields.familyId ? String(fields.familyId).trim() : null,
    documentId: String(fields.documentId || "").trim(),
    pageId,
    passageId,
    transcriptionRevisionId: passageId ? transcriptionRevisionId : pageId ? transcriptionRevisionId : null,
    photographId: null,
    zone: null,
    citationIt: fields.citationIt == null || !String(fields.citationIt).trim() ? null : String(fields.citationIt),
    citationFr: fields.citationFr == null || !String(fields.citationFr).trim() ? null : String(fields.citationFr),
    sourceValue: sourceUnknown ? null : String(fields.sourceValue || "").trim(),
    relation: fields.relation,
    interpretation: String(fields.interpretation || "").trim()
  };
}
