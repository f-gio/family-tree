/* Compatibilité des attestations, preuves et références documentaires
   avec les cibles structurées du registre R1 (lots R2.1 et R2.2).

   Module pur : aucune dépendance DOM, Firebase ou réseau ; aucune écriture,
   aucune mutation des entrées, aucune transformation des modèles persistés.

   Les fonctions de diagnostic restent utilisables hors de l'interface. Les
   fonctions de fusion et de planification sont appelées par l'application pour
   conserver les références, planifier des créations de Preuves et bloquer des
   suppressions dangereuses — elles ne déclenchent jamais d'écriture elles-mêmes. */

import { buildLegacyParentChildIdentityId } from "./genealogy-identities.js";
import { normalizedParentChildLinks } from "./family-relations.js";
import { PROOF_RELATIONS, verifyProofReferences } from "./genealogy-proofs.js";
import { lifeAttestations, validateLifeAttestation } from "./life-journey.js";

export const JUSTIFICATION_COMPAT_SCHEMA_VERSION = 1;

export const PROOF_TARGET_COMPATIBILITY = Object.freeze([
  "exact", "generic-ambiguous", "unmapped", "invalid"
]);

export const DOCUMENT_COVERAGE = Object.freeze([
  "none", "owner-attestation", "target-proof", "target-proof-contradictory"
]);

export const REFERENCE_STATE = Object.freeze(["present", "missing", "not-provided"]);

export const REFERENCE_SEVERITY = Object.freeze(["managed", "unmanaged"]);

export const RELATION_IDENTITY_STATE = Object.freeze([
  "unchanged", "family-id-changed", "relation-created", "relation-removed"
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidId(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function attestationIssues(attestation) {
  const issues = [];
  if (!isRecord(attestation)) return [{ code: "attestation-invalid", message: "Attestation absente ou non structurée" }];
  if (!isValidId(attestation.id)) issues.push({ code: "attestation-id-invalid", message: "Identifiant d’attestation absent" });
  const validation = validateLifeAttestation(attestation);
  if (!validation.ok) {
    for (const message of Object.values(validation.errors)) issues.push({ code: "attestation-incomplete", message });
  }
  return issues;
}

function referenceCollection(context, key) {
  const value = context?.[key];
  if (value === undefined || value === null) return { provided: false, values: [] };
  if (!Array.isArray(value)) throw new TypeError(`${key} doit être un tableau ou être omis`);
  return { provided: true, values: value };
}

function rawList(owner, field, location, ownerKind, ownerId, excluded) {
  const value = owner[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    excluded.push({ ownerKind, ownerId, field, location, reason: "le champ d’attestations n’est pas un tableau" });
    return [];
  }
  return value;
}

function collectOwnerAttestations(source, options, excluded) {
  const { ownerKind, ownerId, field, key = field, entryId = null, entryKind = null, location } = options;
  const collected = [];
  for (const attestation of rawList(source, key, location, ownerKind, ownerId, excluded)) {
    collected.push({ ownerKind, ownerId, field, entryId, entryKind, location, attestation });
  }
  return collected;
}

/**
 * Recense les attestations imbriquées réellement persistées : elles vivent dans
 * `people`, `families` ou dans une entrée du Parcours. Les attestations en
 * attente dans le formulaire ne sont pas persistées et ne sont pas recensées.
 */
export function collectAttestations({ people = [], families = [] } = {}) {
  if (!Array.isArray(people)) throw new TypeError("people doit être un tableau");
  if (!Array.isArray(families)) throw new TypeError("families doit être un tableau");
  const attestations = [];
  const excluded = [];

  for (const person of people) {
    if (!isRecord(person) || !isValidId(person.id)) {
      excluded.push({ ownerKind: "person", ownerId: null, field: "people", location: ["people"], reason: "identifiant Personne absent ou invalide" });
      continue;
    }
    const ownerId = person.id;
    attestations.push(...collectOwnerAttestations(person, { ownerKind: "person", ownerId, field: "birthAttestations", location: ["birthAttestations"] }, excluded));
    attestations.push(...collectOwnerAttestations(person, { ownerKind: "person", ownerId, field: "deathAttestations", location: ["deathAttestations"] }, excluded));

    for (const field of ["residences", "professions", "lifeEvents"]) {
      const value = person[field];
      if (value === undefined || value === null) continue;
      if (!Array.isArray(value)) {
        excluded.push({ ownerKind: "person", ownerId, field, location: [field], reason: "le champ de Parcours n’est pas un tableau" });
        continue;
      }
      value.forEach((entry, index) => {
        const path = [field, String(index)];
        if (!isRecord(entry)) {
          excluded.push({ ownerKind: "person", ownerId, field, location: path, reason: "entrée de Parcours invalide" });
          return;
        }
        if (!isValidId(entry.id)) {
          excluded.push({ ownerKind: "person", ownerId, field, location: path, reason: "identifiant persistant de l’entrée absent" });
          return;
        }
        attestations.push(...collectOwnerAttestations(entry, {
          ownerKind: "person",
          ownerId,
          field,
          key: "attestations",
          entryId: entry.id,
          entryKind: field === "lifeEvents" && isValidId(entry.kind) ? entry.kind : null,
          location: [field, entry.id, "attestations"]
        }, excluded));
      });
    }
  }

  for (const family of families) {
    if (!isRecord(family) || !isValidId(family.id)) {
      excluded.push({ ownerKind: "family", ownerId: null, field: "families", location: ["families"], reason: "identifiant Foyer absent ou invalide" });
      continue;
    }
    attestations.push(...collectOwnerAttestations(family, {
      ownerKind: "family", ownerId: family.id, field: "marriageAttestations", location: ["marriageAttestations"]
    }, excluded));
  }

  return { schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION, attestations, excluded };
}

/**
 * Vérifie les références d'une attestation sans les modifier. Une collection
 * omise reste `not-provided` : l'absence de contexte n'est jamais confondue
 * avec une référence manquante.
 */
export function auditAttestationReferences(attestation, context = {}) {
  if (!isRecord(attestation)) throw new TypeError("attestation doit être un objet");
  const issues = attestationIssues(attestation);

  const auditField = (field, collection) => {
    const values = attestation[field];
    if (values !== undefined && values !== null && !Array.isArray(values)) {
      issues.push({ code: `${field}-invalid`, message: `${field} doit être un tableau` });
      return { ids: [], state: "missing", missing: [] };
    }
    const ids = [];
    for (const value of values ?? []) {
      if (isValidId(value)) {
        const id = value.trim();
        if (!ids.includes(id)) ids.push(id);
      } else {
        issues.push({ code: `${field}-invalid`, message: `Référence ${field} vide ou non textuelle` });
      }
    }
    if (!collection.provided) return { ids, state: "not-provided", missing: [] };
    const known = new Set(collection.values.map(item => item?.id).filter(id => typeof id === "string" && id));
    const missing = ids.filter(id => !known.has(id));
    if (missing.length) {
      issues.push({
        code: `${field}-missing`,
        message: `${missing.length} référence(s) ${field} introuvable(s) dans le contexte fourni`,
        missing
      });
    }
    return { ids, state: missing.length ? "missing" : "present", missing };
  };

  return {
    attestationId: isValidId(attestation.id) ? attestation.id : null,
    documentIds: auditField("documentIds", referenceCollection(context, "documents")),
    sourceIds: auditField("sourceIds", referenceCollection(context, "sources")),
    proofIds: auditField("proofIds", referenceCollection(context, "proofs")),
    issues
  };
}

export function auditAttestationCatalog(collected, context = {}) {
  if (!isRecord(collected) || !Array.isArray(collected.attestations)) {
    throw new TypeError("collected doit être la sortie de collectAttestations");
  }
  const entries = collected.attestations.map(item => ({
    ...item,
    audit: auditAttestationReferences(item.attestation, context)
  }));
  const issues = [...(Array.isArray(collected.excluded) ? collected.excluded : [])];
  for (const entry of entries) {
    for (const issue of entry.audit.issues) {
      issues.push({ ...issue, ownerKind: entry.ownerKind, ownerId: entry.ownerId, location: entry.location });
    }
  }
  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    attestations: entries,
    excluded: collected.excluded,
    issues,
    summary: {
      attestations: entries.length,
      withIssues: entries.filter(entry => entry.audit.issues.length > 0).length,
      excluded: collected.excluded.length
    }
  };
}

/**
 * Rapproche un `factId` de Preuve des cibles R1. Un type legacy large reste
 * explicitement ambigu : aucune cible précise n'est choisie automatiquement.
 */
export function classifyProofTargetCompatibility(proof, targets = []) {
  if (!Array.isArray(targets)) throw new TypeError("targets doit être un tableau");
  if (!isRecord(proof)) return { status: "invalid", proofId: null, factId: null, factType: null, targetIds: [], reason: "Preuve absente ou non structurée" };
  const proofId = isValidId(proof.id) ? proof.id : null;
  const factId = isValidId(proof.factId) ? proof.factId.trim() : null;
  const factType = isValidId(proof.factType) ? proof.factType.trim() : null;
  if (!factId) {
    return { status: "invalid", proofId, factId, factType, targetIds: [], reason: "factId absent ou non textuel" };
  }
  const exact = targets
    .filter(target => target?.factId === factId || (!target?.factId && target?.id === factId))
    .map(target => target.id);
  if (exact.length) {
    return { status: "exact", proofId, factId, factType, targetIds: exact, reason: "Le factId correspond exactement à une cible R1." };
  }
  const ambiguous = targets
    .filter(target => (Array.isArray(target?.legacyFactCandidates) ? target.legacyFactCandidates : []).some(candidate => candidate?.factId === factId))
    .map(target => target.id);
  if (ambiguous.length) {
    return {
      status: "generic-ambiguous", proofId, factId, factType, targetIds: ambiguous,
      reason: "Le type legacy est trop large pour distinguer les cibles candidates ; correspondance humaine requise."
    };
  }
  return {
    status: "unmapped", proofId, factId, factType, targetIds: [],
    reason: "Aucune cible R1 ne correspond à ce factId ; correspondance humaine requise."
  };
}

export function classifyProofCatalog(proofs = [], targets = []) {
  if (!Array.isArray(proofs)) throw new TypeError("proofs doit être un tableau");
  const classified = proofs.map(proof => classifyProofTargetCompatibility(proof, targets));
  const counts = Object.fromEntries(PROOF_TARGET_COMPATIBILITY.map(status => [status, 0]));
  for (const item of classified) counts[item.status] += 1;
  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    counts: { ...counts, total: classified.length },
    proofs: classified
  };
}

/**
 * Décrit silencieusement la perte de documents sélectionnés lorsqu'une
 * structure persiste un `documentId` singulier.
 */
export function reportDocumentSelectionLoss({ selectedDocumentIds = [], persistedDocumentId = null } = {}) {
  if (selectedDocumentIds !== undefined && !Array.isArray(selectedDocumentIds)) {
    throw new TypeError("selectedDocumentIds doit être un tableau");
  }
  const ids = [];
  for (const value of selectedDocumentIds) {
    if (isValidId(value)) {
      const id = value.trim();
      if (!ids.includes(id)) ids.push(id);
    }
  }
  const persistedIds = isValidId(persistedDocumentId) ? [persistedDocumentId.trim()] : [];
  const droppedIds = ids.filter(id => !persistedIds.includes(id));
  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    selectedIds: ids,
    persistedIds,
    droppedIds,
    truncated: droppedIds.length > 0
  };
}

function referenceIssue(code, severity, path, message, referenceId = null) {
  return { code, severity, path, message, ...(referenceId ? { referenceId } : {}) };
}

/**
 * Détecte les références d'une Personne qui ne sont pas reconduites par le
 * nettoyage applicatif actuel (`removeDirectoryPersonPermanently`). Diagnostic
 * pur : aucune suppression ni mise à jour n'est proposée ni effectuée.
 */
export function auditPersonReferenceRisks({
  personId, people = [], families = [], documents = [], sources = [], proofs = [], conclusions = []
} = {}) {
  if (!isValidId(personId)) throw new TypeError("personId doit être une chaîne non vide");
  if (![people, families, documents, sources, proofs, conclusions].every(value => Array.isArray(value))) {
    throw new TypeError("toutes les collections doivent être des tableaux");
  }
  const issues = [];
  const includesPerson = ids => Array.isArray(ids) && ids.includes(personId);

  for (const document of documents) {
    if (isRecord(document) && includesPerson(document.personIds)) {
      issues.push(referenceIssue("document-person-reference", "managed", ["documents", document.id],
        "Le document référence la Personne ; le nettoyage applicatif retire ce seul identifiant."));
    }
  }
  for (const source of sources) {
    const data = isRecord(source?.data) ? source.data : source;
    if (isRecord(data) && includesPerson(data.personIds)) {
      issues.push(referenceIssue("source-person-reference", "unmanaged", ["sourceDocuments", source?.id ?? "?"],
        "La Source référence la Personne ; aucun nettoyage applicatif n’est prévu pour ce champ."));
    }
  }
  for (const proof of proofs) {
    const data = isRecord(proof?.data) ? proof.data : proof;
    if (isRecord(data) && includesPerson(data.personIds)) {
      issues.push(referenceIssue("proof-person-reference", "unmanaged", ["genealogyProofs", proof?.id ?? "?"],
        "La Preuve référence la Personne ; elle resterait après suppression."));
    }
  }
  for (const conclusion of conclusions) {
    const data = isRecord(conclusion?.data) ? conclusion.data : conclusion;
    const revision = isRecord(data?.revision) ? data.revision : null;
    const subject = revision?.subject;
    if (subject && subject.kind === "person" && subject.id === personId) {
      issues.push(referenceIssue("conclusion-person-reference", "unmanaged", ["factConclusions", conclusion?.id ?? "?"],
        "La Conclusion désigne la Personne comme sujet ; elle resterait après suppression."));
    }
  }
  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    personId,
    issues,
    summary: {
      managed: issues.filter(issue => issue.severity === "managed").length,
      unmanaged: issues.filter(issue => issue.severity === "unmanaged").length
    }
  };
}

/**
 * Détecte les références portées par un Foyer : attestations imbriquées
 * potentiellement perdues et Preuves encore liées. Diagnostic pur.
 */
export function auditFamilyReferenceRisks({ familyId, families = [], proofs = [], people = [] } = {}) {
  if (!isValidId(familyId)) throw new TypeError("familyId doit être une chaîne non vide");
  if (![families, proofs, people].every(value => Array.isArray(value))) {
    throw new TypeError("toutes les collections doivent être des tableaux");
  }
  const family = families.find(item => isRecord(item) && item.id === familyId) || null;
  const issues = [];
  if (!family) {
    return { schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION, familyId, found: false, issues: [], summary: { managed: 0, unmanaged: 0 } };
  }
  const attestations = lifeAttestations({ attestations: family.marriageAttestations });
  if (attestations.length) {
    issues.push(referenceIssue("family-attestation-embedded", "unmanaged", ["families", familyId, "marriageAttestations"],
      `${attestations.length} attestation(s) d’union sont imbriquées dans le Foyer et seraient perdues avec lui.`));
  }
  const legacyRelationshipIds = new Set(
    (Array.isArray(family.partnerIds) && Array.isArray(family.childIds) ? normalizedParentChildLinks(family) : [])
      .map(link => buildLegacyParentChildIdentityId(family.id, link.parentId, link.childId))
  );
  for (const proof of proofs) {
    const data = isRecord(proof?.data) ? proof.data : proof;
    if (!isRecord(data)) continue;
    if (data.familyId === familyId) {
      issues.push(referenceIssue("proof-family-reference", "unmanaged", ["genealogyProofs", proof?.id ?? "?"],
        "La Preuve référence ce Foyer ; elle resterait après suppression.", proof?.id ?? null));
    } else if (data.relationshipId === familyId) {
      issues.push(referenceIssue("proof-relationship-reference", "unmanaged", ["genealogyProofs", proof?.id ?? "?"],
        "La Preuve utilise l’identifiant du Foyer comme relation ; elle resterait après suppression.", proof?.id ?? null));
    } else if (isValidId(data.relationshipId) && legacyRelationshipIds.has(data.relationshipId)) {
      issues.push(referenceIssue("proof-legacy-relationship-reference", "unmanaged", ["genealogyProofs", proof?.id ?? "?"],
        "La Preuve référence la clé legacy calculée d’un lien de ce Foyer.", proof?.id ?? null));
    }
  }
  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    familyId,
    found: true,
    issues,
    summary: {
      managed: issues.filter(issue => issue.severity === "managed").length,
      unmanaged: issues.filter(issue => issue.severity === "unmanaged").length
    },
    peopleReferenced: [...new Set(family.partnerIds || [])].filter(id => people.some(person => isRecord(person) && person.id === id))
  };
}

/**
 * Compare l'identité legacy des liens parent-enfant entre deux états de Foyer.
 * `buildLegacyParentChildIdentityId` n'est stable que pour un même triplet
 * (Foyer, parent, enfant) : elle change à la recréation sous un autre Foyer et
 * ne survit pas à une correction d’extrémité, qui produit deux relations
 * distinctes. Aucun ID n'est persisté par cette fonction.
 */
export function compareFamilyRelations(familyBefore, familyAfter) {
  if (!isRecord(familyBefore) || !isRecord(familyAfter)) {
    throw new TypeError("familyBefore et familyAfter doivent être des objets");
  }
  const pairsOf = family => new Map(
    (Array.isArray(family?.partnerIds) && Array.isArray(family?.childIds) ? normalizedParentChildLinks(family) : [])
      .map(link => [JSON.stringify([link.parentId, link.childId]), link])
  );
  const before = pairsOf(familyBefore);
  const after = pairsOf(familyAfter);
  const retained = [];
  const added = [];
  const removed = [];
  const identities = [];

  const identityOf = (family, link) => isRecord(family) && isValidId(family.id)
    ? buildLegacyParentChildIdentityId(family.id, link.parentId, link.childId)
    : null;

  for (const [key, link] of before) {
    const other = after.get(key);
    if (!other) {
      const beforeId = identityOf(familyBefore, link);
      removed.push({ parentId: link.parentId, childId: link.childId, beforeId, afterId: null });
      identities.push({ parentId: link.parentId, childId: link.childId, beforeId, afterId: null, stable: false, state: "relation-removed" });
      continue;
    }
    const beforeId = identityOf(familyBefore, link);
    const afterId = identityOf(familyAfter, other);
    const stable = Boolean(beforeId) && beforeId === afterId;
    retained.push({ parentId: link.parentId, childId: link.childId, beforeId, afterId, stable });
    identities.push({
      parentId: link.parentId, childId: link.childId, beforeId, afterId, stable,
      state: stable ? "unchanged" : "family-id-changed"
    });
  }
  for (const [key, link] of after) {
    if (before.has(key)) continue;
    const afterId = identityOf(familyAfter, link);
    added.push({ parentId: link.parentId, childId: link.childId, afterId, beforeId: null });
    identities.push({ parentId: link.parentId, childId: link.childId, beforeId: null, afterId, stable: false, state: "relation-created" });
  }

  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    familyBeforeId: isValidId(familyBefore.id) ? familyBefore.id : null,
    familyAfterId: isValidId(familyAfter.id) ? familyAfter.id : null,
    retained, added, removed, identities,
    summary: {
      retained: retained.length,
      added: added.length,
      removed: removed.length,
      unstable: identities.filter(identity => !identity.stable).length
    }
  };
}

/**
 * Encapsule `verifyProofReferences` sans rien changer à son contrat : les
 * références absentes, incohérentes ou non fournies restent distinguées.
 */
export function auditProofReferences(proofs = [], context = {}) {
  if (!Array.isArray(proofs)) throw new TypeError("proofs doit être un tableau");
  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    proofs: proofs.map(proof => ({
      proofId: isRecord(proof) && isValidId(proof.id) ? proof.id : null,
      ...verifyProofReferences(proof, context)
    }))
  };
}

/**
 * Couverture documentaire d'une cible R1, en deux niveaux : les Preuves
 * rattachées au `factId` exact, et les attestations rattachées au propriétaire
 * (portée large, jamais à la cible précise).
 *
 * `evaluation` reste toujours `not-evaluated` : la présence d'un document ne
 * produit aucune évaluation de fiabilité. Cette fonction est un diagnostic de
 * lecture, pas une source de décision.
 */
export function analyzeJustificationCoverage({ targets = [], proofs = [], attestations = [] } = {}) {
  if (![targets, proofs, attestations].every(value => Array.isArray(value))) {
    throw new TypeError("targets, proofs et attestations doivent être des tableaux");
  }
  const entries = targets.map(target => {
    const factId = isValidId(target?.factId) ? target.factId.trim() : null;
    /* Cible sans factId canonique (Foyer, entrée du Parcours) : son identifiant
       R1 stable sert de clé de rapprochement avec le factId de la Preuve. */
    const matchId = factId || (isValidId(target?.id) ? target.id.trim() : null);
    const exactProofs = matchId ? proofs.filter(proof => isRecord(proof) && proof.factId === matchId) : [];
    const ambiguousProofs = factId
      ? proofs.filter(proof => isRecord(proof) && (Array.isArray(target?.legacyFactCandidates) ? target.legacyFactCandidates : [])
        .some(candidate => candidate?.factId === factId))
      : [];
    const owner = isRecord(target?.owner) ? target.owner : null;
    const ownerAttestations = owner
      ? attestations.filter(item => isRecord(item) && item.ownerKind === owner.kind && item.ownerId === owner.id)
      : [];
    const relations = new Set(exactProofs.map(proof => proof.relation).filter(Boolean));
    const documentCoverage = exactProofs.length
      ? (relations.has("supports") && relations.has("contradicts") ? "target-proof-contradictory" : "target-proof")
      : ownerAttestations.length ? "owner-attestation" : "none";
    return {
      targetId: target?.id ?? null,
      targetType: target?.targetType ?? null,
      owner,
      factId,
      documentCoverage,
      exactProofIds: exactProofs.map(proof => proof.id).filter(Boolean),
      ambiguousProofIds: ambiguousProofs.map(proof => proof.id).filter(Boolean),
      ownerAttestationCount: ownerAttestations.length,
      evaluation: "not-evaluated"
    };
  });
  const summary = Object.fromEntries(DOCUMENT_COVERAGE.map(state => [state, 0]));
  for (const entry of entries) summary[entry.documentCoverage] += 1;
  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    targets: entries,
    summary: { ...summary, total: entries.length }
  };
}

/* ---------------------------------------------- R2.2 : association ciblée */

/** Identifiant de fait employé par une Preuve ciblée : le `factId` canonique
 *  du registre R1, ou à défaut l'identifiant stable de la cible. */
export function proofFactIdForTarget(target) {
  if (!isRecord(target)) throw new TypeError("La cible doit être un objet");
  if (isValidId(target.factId)) return target.factId.trim();
  if (isValidId(target.id)) return target.id.trim();
  throw new TypeError("La cible ne fournit ni factId ni identifiant stable.");
}

/** Type de fait machine d'une Preuve ciblée : le `targetType` du registre R1. */
export function proofFactTypeForTarget(target) {
  if (!isRecord(target) || !isValidId(target.targetType)) {
    throw new TypeError("La cible doit porter un targetType stable.");
  }
  return target.targetType.trim();
}

function proofPlanKey(factId, documentId) {
  return factId + "|" + documentId;
}

/**
 * Clé d'une association explicite : le couple (fait, document) la désigne de
 * façon unique. Le sujet est porté par l'association elle-même ; pour un fait
 * du registre R1 son identifiant encode déjà la Personne ou le Foyer.
 */
export function justificationAssociationKey(association) {
  if (!isRecord(association)) throw new TypeError("L'association doit être un objet");
  if (!isValidId(association.factId)) throw new TypeError("L'association doit porter un fait.");
  if (!isValidId(association.documentId)) throw new TypeError("L'association doit porter un document.");
  return proofPlanKey(association.factId.trim(), association.documentId.trim());
}

/**
 * Valide une association explicite : document justificatif, sujet (Personne ou
 * Foyer), fait précis et qualification documentaire — **une qualification par
 * association**, jamais globale.
 */
export function createJustificationAssociation(input = {}) {
  if (!isRecord(input)) throw new TypeError("L'association doit être un objet");
  const documentId = isValidId(input.documentId) ? input.documentId.trim() : "";
  if (!documentId) throw new TypeError("Une association exige un document justificatif.");
  const factId = isValidId(input.factId) ? input.factId.trim() : "";
  if (!factId) throw new TypeError("Une association exige un fait précis.");
  const factType = isValidId(input.factType) ? input.factType.trim() : "";
  if (!factType) throw new TypeError("Une association exige le type du fait.");
  if (!PROOF_RELATIONS.includes(input.relation)) {
    throw new TypeError("Une association exige sa qualification documentaire.");
  }
  const subjectKind = input.subjectKind === "person" || input.subjectKind === "family" ? input.subjectKind : null;
  if (!subjectKind) throw new TypeError("Une association exige un sujet : Personne ou Foyer.");
  const subjectId = isValidId(input.subjectId) ? input.subjectId.trim() : "";
  if (!subjectId) throw new TypeError("Une association exige l’identifiant de son sujet.");
  let personIds;
  let familyId;
  if (subjectKind === "person") {
    personIds = [subjectId];
    familyId = null;
  } else {
    personIds = [...new Set((Array.isArray(input.personIds) ? input.personIds : [])
      .filter(id => isValidId(id)).map(id => id.trim()))];
    if (!personIds.length) throw new TypeError("Une association de Foyer exige ses participants.");
    familyId = subjectId;
  }
  const relationshipId = isValidId(input.relationshipId) ? input.relationshipId.trim() : null;
  if (relationshipId && !familyId) throw new TypeError("Une relation familiale exige un Foyer.");
  return {
    documentId: documentId,
    factId: factId,
    factType: factType,
    subjectKind: subjectKind,
    subjectId: subjectId,
    personIds: personIds,
    familyId: familyId,
    relationshipId: relationshipId,
    relation: input.relation,
    factLabel: typeof input.factLabel === "string" && input.factLabel.trim() ? input.factLabel.trim() : factType
  };
}

function proofAsRecord(proof) {
  return isRecord(proof?.data) ? proof.data : (isRecord(proof) ? proof : null);
}

/**
 * Planifie la création des Preuves correspondant à des associations
 * **explicites** : aucune combinaison fait × document n'est produite à la
 * volée. Chaque association devient au plus une Preuve ; les couples déjà
 * portés sont préservés et les répétitions internes sont écartées.
 */
export function planAssociationProofs({ associations = [], existingProofs = [] } = {}) {
  if (!Array.isArray(associations)) throw new TypeError("associations doit être un tableau");
  if (!Array.isArray(existingProofs)) throw new TypeError("existingProofs doit être un tableau");

  const known = new Map();
  for (const proof of existingProofs) {
    const data = proofAsRecord(proof);
    if (data && isValidId(data.factId) && isValidId(data.documentId)) {
      const key = proofPlanKey(data.factId.trim(), data.documentId.trim());
      if (!known.has(key)) known.set(key, isValidId(proof?.id) ? proof.id : null);
    }
  }

  const plans = [];
  const duplicates = [];
  const existing = [];
  const invalid = [];
  const seen = new Set();
  for (const entry of associations) {
    let association;
    try {
      association = createJustificationAssociation(entry);
    } catch (error) {
      invalid.push({ association: isRecord(entry) ? { ...entry } : null, reason: error.message });
      continue;
    }
    const key = justificationAssociationKey(association);
    if (seen.has(key)) {
      duplicates.push({ ...association, key: key });
      continue;
    }
    seen.add(key);
    if (known.has(key)) {
      existing.push({ ...association, key: key, proofId: known.get(key) });
      continue;
    }
    plans.push({ ...association, key: key });
  }

  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    plans: plans,
    duplicates: duplicates,
    existing: existing,
    invalid: invalid,
    summary: {
      associations: associations.length,
      plans: plans.length,
      duplicates: duplicates.length,
      existing: existing.length,
      invalid: invalid.length
    }
  };
}

/**
 * Fusionne les références d'une attestation lors d'une modification.
 *
 * - une référence **visible** dans le sélecteur suit l'intention de
 *   l'utilisateur : cochée conservée, décochée retirée ;
 * - une référence **non disponible** dans le contexte courant est conservée
 *   puis signalée : une indisponibilité contextuelle n'est pas une suppression ;
 * - `removedIds` ne contient que des retraits explicites de l'utilisateur ;
 * - doublons et entrées vides sont éliminés sans perdre d'ordre ni de valeur.
 */
export function mergeAttestationReferences(options = {}) {
  if (!isRecord(options)) throw new TypeError("options doit être un objet");
  const { previousIds = [], selectedIds = [], availableIds = [], removedIds = [] } = options;
  for (const [name, value] of Object.entries({ previousIds, selectedIds, availableIds, removedIds })) {
    if (!Array.isArray(value)) throw new TypeError(name + " doit être un tableau");
  }
  const normalize = values => {
    const ids = [];
    for (const value of values) {
      if (isValidId(value)) {
        const id = value.trim();
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids;
  };
  const previous = normalize(previousIds);
  const selected = normalize(selectedIds);
  const available = new Set(normalize(availableIds));
  const removed = new Set(normalize(removedIds));
  const wanted = new Set(selected);

  const ids = [];
  const preservedUnavailable = [];
  const removedVisible = [];
  const removedExplicit = [];
  for (const id of previous) {
    if (removed.has(id)) {
      removedExplicit.push(id);
      continue;
    }
    if (available.has(id)) {
      if (!wanted.has(id)) {
        removedVisible.push(id);
        continue;
      }
      ids.push(id);
      continue;
    }
    ids.push(id);
    preservedUnavailable.push(id);
  }
  const added = [];
  for (const id of selected) {
    if (!ids.includes(id)) {
      ids.push(id);
      added.push(id);
    }
  }
  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    ids: ids,
    preservedUnavailable: preservedUnavailable,
    removedVisible: removedVisible,
    removedExplicit: removedExplicit,
    added: added
  };
}

/**
 * Évalue ce qu'une suppression de Personne emporterait avec elle, à partir des
 * collections réellement chargées. Diagnostic pur : aucune suppression n'est
 * effectuée. Les références `unmanaged` bloquent ; les références `managed`
 * (documents) restent à la charge du parcours existant.
 */
export function planPersonDeletionImpact({
  personId, people = [], families = [], documents = [], sources = [], proofs = [], conclusions = []
} = {}) {
  if (!isValidId(personId)) throw new TypeError("personId doit être une chaîne non vide");
  if (![people, families, documents, sources, proofs, conclusions].every(Array.isArray)) {
    throw new TypeError("toutes les collections doivent être des tableaux");
  }
  const base = auditPersonReferenceRisks({ personId, people, families, documents, sources, proofs, conclusions });
  const issues = [...base.issues];
  const familiesAtRisk = [];

  for (const family of families) {
    if (!isRecord(family) || !isValidId(family.id) || !Array.isArray(family.partnerIds)) continue;
    if (!family.partnerIds.includes(personId)) continue;
    if (family.partnerIds.filter(id => id !== personId).length > 0) continue;
    familiesAtRisk.push(family.id);
    issues.push(...auditFamilyReferenceRisks({
      familyId: family.id, families: families, proofs: proofs, people: people
    }).issues);
  }

  const unmanaged = issues.filter(issue => issue.severity === "unmanaged");
  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    personId: personId,
    issues: issues,
    familiesAtRisk: familiesAtRisk,
    blocked: unmanaged.length > 0,
    summary: {
      managed: issues.filter(issue => issue.severity === "managed").length,
      unmanaged: unmanaged.length,
      familiesAtRisk: familiesAtRisk.length
    }
  };
}

/**
 * Planifie un identifiant persistant pour les liens parent-enfant. Aucune
 * écriture n'est proposée : ajouter `relationId` à `families.parentChildLinks`
 * exige une migration approuvée, et `normalizedParentChildLinks` écrase les
 * clés inconnues lors de la réécriture d'un Foyer.
 */
export function planFamilyRelationIds(family) {
  if (!isRecord(family) || !isValidId(family.id)) {
    throw new TypeError("Le Foyer doit porter un identifiant stable");
  }
  const links = Array.isArray(family.partnerIds) && Array.isArray(family.childIds)
    ? normalizedParentChildLinks(family)
    : [];
  return {
    schemaVersion: JUSTIFICATION_COMPAT_SCHEMA_VERSION,
    familyId: family.id,
    requiresWrite: true,
    reason: "Aucun identifiant relationnel n'est persisté aujourd'hui ; toute écriture de relationId dans families/{id} est une migration et doit être approuvée avant exécution.",
    relations: links.map(link => ({
      parentId: link.parentId,
      childId: link.childId,
      state: link.type,
      currentId: null,
      proposedId: buildLegacyParentChildIdentityId(family.id, link.parentId, link.childId)
    })),
    summary: { relations: links.length, persisted: 0 }
  };
}
