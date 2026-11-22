import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENT_COVERAGE,
  PROOF_TARGET_COMPATIBILITY,
  analyzeJustificationCoverage,
  auditAttestationCatalog,
  auditAttestationReferences,
  auditFamilyReferenceRisks,
  auditPersonReferenceRisks,
  auditProofReferences,
  classifyProofCatalog,
  classifyProofTargetCompatibility,
  collectAttestations,
  compareFamilyRelations,
  reportDocumentSelectionLoss
} from "../js/justification-compat.js";
import { enumerateJustificationTargets } from "../js/justification-targets.js";
import { buildFactIdentityId, buildLegacyParentChildIdentityId } from "../js/genealogy-identities.js";
import { createGenealogyProof } from "../js/genealogy-proofs.js";

function fixtureGraph() {
  return {
    people: [{
      id: "personne-1",
      firstName: "Andrea",
      lastName: "Giovannoni",
      birthDateInfo: { type: "year", year: 1902 },
      place: "Varese",
      birthAttestations: [{ id: "att-naissance", date: { type: "year", year: 1902 }, comment: "Acte de naissance", documentIds: ["doc-1", "doc-2"], sourceIds: ["src-1"], proofIds: ["preuve-1"] }],
      deathAttestations: [],
      residences: [{ id: "res-1", place: "Varese", dateInfo: { type: "year", year: 1935 }, attestations: [{ id: "att-res", date: { type: "unknown" }, comment: "Recensement", documentIds: ["doc-1"] }] }],
      professions: [{ id: "job-1", label: "Maçon", dateInfo: { type: "between", from: 1930, to: 1938 }, attestations: [] }],
      lifeEvents: [{ id: "event-1", kind: "census", label: "Recensement", dateInfo: { type: "year", year: 1935 }, attestations: [{ id: "att-evenement", date: { type: "year", year: 1935 }, comment: "", documentIds: ["doc-1"] }] }]
    }],
    families: [{
      id: "famille-1",
      partnerIds: ["personne-1", "personne-2"],
      childIds: ["personne-3"],
      parentChildLinks: [{ parentId: "personne-1", childId: "personne-3", type: "biological" }],
      marriageAttestations: [{ id: "att-union", date: { type: "exact", value: "1928-05-14" }, comment: "Acte de mariage", documentIds: ["doc-1"], sourceIds: [], proofIds: [] }]
    }],
    documents: [{ id: "doc-1", personIds: ["personne-1"] }, { id: "doc-2" }],
    sources: [{ id: "src-1" }],
    proofs: []
  };
}

function proofFixture(overrides = {}) {
  return createGenealogyProof({
    id: "preuve-1",
    factId: buildFactIdentityId("person", "personne-1", "birth.date"),
    factType: "birth.date",
    personIds: ["personne-1"],
    documentId: "doc-1",
    relation: "supports",
    sourceValue: { type: "year", year: 1902 },
    citationIt: "Nato nel 1902",
    ...overrides
  });
}

test("les attestations persistées des quatre emplacements sont recensées sans mutation", () => {
  const graph = fixtureGraph();
  const before = JSON.stringify(graph);
  const collected = collectAttestations(graph);

  assert.equal(collected.attestations.length, 4);
  assert.deepEqual(
    collected.attestations.map(item => [item.ownerKind, item.ownerId, item.field, item.entryId]),
    [
      ["person", "personne-1", "birthAttestations", null],
      ["person", "personne-1", "residences", "res-1"],
      ["person", "personne-1", "lifeEvents", "event-1"],
      ["family", "famille-1", "marriageAttestations", null]
    ]
  );
  const residence = collected.attestations.find(item => item.field === "residences");
  assert.deepEqual(residence.location, ["residences", "res-1", "attestations"]);
  assert.equal(residence.entryKind, null);
  const lifeEvent = collected.attestations.find(item => item.field === "lifeEvents");
  assert.equal(lifeEvent.entryKind, "census");
  assert.deepEqual(lifeEvent.attestation.documentIds, ["doc-1"]);
  assert.deepEqual(collected.excluded, []);
  assert.equal(JSON.stringify(graph), before, "aucun objet en entrée n'est muté");
});

test("les attestations incomplètes, sans identifiant d'entrée ou mal typées sont exclues", () => {
  const people = [{
    id: "personne-1",
    birthAttestations: [{ id: "att-ok", date: { type: "year", year: 1902 } }, { date: { type: "year", year: 1902 } }, { id: "att-sans-date" }],
    deathAttestations: "pas-un-tableau",
    residences: [{ place: "Sans identifiant", attestations: [] }, "entrée-invalide"],
    lifeEvents: [{ id: "event-1", kind: "census", attestations: [] }]
  }];
  const collected = collectAttestations({ people });

  assert.deepEqual(collected.excluded.map(item => item.reason), [
    "le champ d’attestations n’est pas un tableau",
    "identifiant persistant de l’entrée absent",
    "entrée de Parcours invalide"
  ]);
  assert.equal(collected.attestations.length, 3, "les trois attestations de naissance restent recensées");
  assert.ok(collected.attestations.every(item => item.field === "birthAttestations"));
  const audit = auditAttestationCatalog(collected, {});
  assert.ok(audit.issues.some(issue => issue.code === "attestation-id-invalid"));
  assert.ok(audit.issues.some(issue => issue.code === "attestation-incomplete"));
  assert.equal(audit.summary.withIssues, 2);
});

test("les références d’une attestation distinguent contexte absent, présent et manquant", () => {
  const graph = fixtureGraph();
  const attestation = graph.people[0].birthAttestations[0];
  const snapshot = JSON.stringify(attestation);

  const withoutContext = auditAttestationReferences(attestation, {});
  assert.equal(withoutContext.documentIds.state, "not-provided");
  assert.equal(withoutContext.sourceIds.state, "not-provided");
  assert.equal(withoutContext.proofIds.state, "not-provided");
  assert.deepEqual(withoutContext.issues, []);

  const withContext = auditAttestationReferences(attestation, {
    documents: graph.documents, sources: graph.sources, proofs: [{ id: "preuve-1" }]
  });
  assert.equal(withContext.documentIds.state, "present");
  assert.equal(withContext.sourceIds.state, "present");
  assert.equal(withContext.proofIds.state, "present");

  const withMissing = auditAttestationReferences(attestation, {
    documents: [{ id: "doc-1" }], sources: [], proofs: []
  });
  assert.equal(withMissing.documentIds.state, "missing");
  assert.deepEqual(withMissing.documentIds.missing, ["doc-2"]);
  assert.equal(withMissing.sourceIds.state, "missing");
  assert.deepEqual(withMissing.sourceIds.missing, ["src-1"]);
  assert.ok(withMissing.issues.length >= 2);

  const malformed = auditAttestationReferences({ ...attestation, documentIds: ["doc-1", " ", "doc-1"] }, {
    documents: graph.documents
  });
  assert.deepEqual(malformed.documentIds.ids, ["doc-1"], "les IDs vides et doublons sont normalisés sans mutation");
  assert.equal(JSON.stringify(attestation), snapshot, "l’attestation d’entrée n’est jamais modifiée");
});

test("les preuves aux types legacy génériques restent ambiguës et ne sont jamais requalifiées", () => {
  const targets = enumerateJustificationTargets({ people: [fixtureGraph().people[0]] });
  const exact = proofFixture();
  const generic = proofFixture({
    id: "preuve-generique",
    factId: buildFactIdentityId("person", "personne-1", "birth"),
    factType: "birth"
  });
  const unmapped = proofFixture({
    id: "preuve-relation",
    factId: "relationship-1",
    factType: "parentChild",
    personIds: ["personne-1", "personne-3"]
  });
  const invalid = { id: "preuve-sans-fait", factType: "birth" };

  const exactResult = classifyProofTargetCompatibility(exact, targets.targets);
  assert.equal(exactResult.status, "exact");
  assert.deepEqual(exactResult.targetIds, [buildFactIdentityId("person", "personne-1", "birth.date")]);

  const genericResult = classifyProofTargetCompatibility(generic, targets.targets);
  assert.equal(genericResult.status, "generic-ambiguous");
  assert.deepEqual(genericResult.targetIds.sort(), [
    buildFactIdentityId("person", "personne-1", "birth.date"),
    buildFactIdentityId("person", "personne-1", "birth.place")
  ].sort());
  assert.match(genericResult.reason, /trop large/);

  assert.equal(classifyProofTargetCompatibility(unmapped, targets.targets).status, "unmapped");
  assert.equal(classifyProofTargetCompatibility(invalid, targets.targets).status, "invalid");

  const objects = [exact, generic, unmapped, invalid];
  const snapshot = JSON.stringify(objects);
  const catalog = classifyProofCatalog(objects, targets.targets);
  assert.deepEqual(catalog.counts, { exact: 1, "generic-ambiguous": 1, unmapped: 1, invalid: 1, total: 4 });
  assert.equal(PROOF_TARGET_COMPATIBILITY.includes("generic-ambiguous"), true);
  assert.equal(JSON.stringify(objects), snapshot, "le catalogue ne réécrit aucune Preuve");
});

test("une sélection multiple de documents révèle silencieusement ce qui n’est pas persisté", () => {
  const loss = reportDocumentSelectionLoss({ selectedDocumentIds: ["doc-1", "doc-2", "doc-3"], persistedDocumentId: "doc-1" });
  assert.equal(loss.truncated, true);
  assert.deepEqual(loss.persistedIds, ["doc-1"]);
  assert.deepEqual(loss.droppedIds, ["doc-2", "doc-3"]);

  const complete = reportDocumentSelectionLoss({ selectedDocumentIds: ["doc-1"], persistedDocumentId: "doc-1" });
  assert.equal(complete.truncated, false);
  assert.deepEqual(complete.droppedIds, []);

  const lost = reportDocumentSelectionLoss({ selectedDocumentIds: ["doc-1", "doc-2"], persistedDocumentId: null });
  assert.equal(lost.truncated, true);
  assert.deepEqual(lost.droppedIds, ["doc-1", "doc-2"]);

  assert.throws(() => reportDocumentSelectionLoss({ selectedDocumentIds: "doc-1" }), /tableau/);
  const duplicates = reportDocumentSelectionLoss({ selectedDocumentIds: [" doc-1 ", "doc-1"], persistedDocumentId: "doc-1" });
  assert.deepEqual(duplicates.selectedIds, ["doc-1"], "espaces et doublons normalisés");
});

test("les références d’une Personne distinguent nettoyage client et références orphelines", () => {
  const graph = fixtureGraph();
  const snapshot = JSON.stringify(graph);
  const people = [...graph.people, { id: "personne-2" }, { id: "personne-3" }];
  const proofs = [{ id: "preuve-1", data: { personIds: ["personne-1"], factId: "f1" } }];
  const conclusions = [{ id: "conclusion-1", data: { revision: { subject: { kind: "person", id: "personne-1" } } } }];

  const risks = auditPersonReferenceRisks({
    personId: "personne-1",
    people, families: graph.families, documents: graph.documents,
    sources: [{ id: "src-1", data: { personIds: ["personne-1"] } }],
    proofs, conclusions
  });

  assert.deepEqual(risks.issues.map(issue => [issue.code, issue.severity]), [
    ["document-person-reference", "managed"],
    ["source-person-reference", "unmanaged"],
    ["proof-person-reference", "unmanaged"],
    ["conclusion-person-reference", "unmanaged"]
  ]);
  assert.deepEqual(risks.summary, { managed: 1, unmanaged: 3 });

  const clean = auditPersonReferenceRisks({
    personId: "personne-inconnue",
    people, families: graph.families, documents: graph.documents,
    sources: [], proofs: [], conclusions: []
  });
  assert.deepEqual(clean.issues, []);
  assert.throws(() => auditPersonReferenceRisks({ personId: "" }), /chaîne non vide/);
  assert.equal(JSON.stringify(graph), snapshot, "les diagnostics ne mutent aucune collection");
});

test("les attestations imbriquées et les Preuves du Foyer sont signalées sans simulation de suppression", () => {
  const graph = fixtureGraph();
  const snapshot = JSON.stringify(graph);
  const proofs = [
    { id: "p-famille", data: { familyId: "famille-1" } },
    { id: "p-relation", data: { relationshipId: "famille-1" } },
    { id: "p-legacy", data: { relationshipId: buildLegacyParentChildIdentityId("famille-1", "personne-1", "personne-3") } },
    { id: "p-autre", data: { familyId: "famille-autre" } }
  ];

  const risks = auditFamilyReferenceRisks({
    familyId: "famille-1", families: graph.families, proofs, people: graph.people
  });
  assert.equal(risks.found, true);
  assert.deepEqual(risks.issues.map(issue => issue.code), [
    "family-attestation-embedded",
    "proof-family-reference",
    "proof-relationship-reference",
    "proof-legacy-relationship-reference"
  ]);
  assert.equal(risks.summary.unmanaged, 4);
  assert.deepEqual(risks.peopleReferenced, ["personne-1"]);

  const absent = auditFamilyReferenceRisks({ familyId: "famille-absente", families: graph.families, proofs: [], people: [] });
  assert.equal(absent.found, false);
  assert.deepEqual(absent.issues, []);
  assert.equal(JSON.stringify(graph), snapshot, "aucune écriture ni suppression n’est simulée sur les données");
});

test("l’identité legacy des liens reste stable au réordonnement et change aux vrais événements", () => {
  const base = {
    id: "famille-1",
    partnerIds: ["parent-1", "parent-2"],
    childIds: ["enfant-1", "enfant-2"],
    parentChildLinks: [{ parentId: "parent-1", childId: "enfant-1", type: "biological" }]
  };
  const reordered = {
    ...base,
    partnerIds: [...base.partnerIds].reverse(),
    childIds: [...base.childIds].reverse()
  };
  const stable = compareFamilyRelations(base, reordered);
  assert.equal(stable.summary.retained, 4);
  assert.equal(stable.summary.unstable, 0);
  assert.deepEqual(stable.removed, []);
  assert.deepEqual(stable.added, []);

  const recreated = { ...base, id: "famille-2" };
  const changedFoyer = compareFamilyRelations(base, recreated);
  assert.equal(changedFoyer.summary.retained, 4);
  assert.equal(changedFoyer.summary.unstable, 4);
  assert.equal(changedFoyer.identities[0].state, "family-id-changed");
  assert.notEqual(changedFoyer.identities[0].beforeId, changedFoyer.identities[0].afterId);

  const corrected = { ...base, parentChildLinks: [{ parentId: "parent-1", childId: "enfant-1", type: "adoptive" }] };
  const samePair = compareFamilyRelations(base, corrected);
  assert.equal(samePair.summary.unstable, 0, "un changement de type ne change pas l’identité du triplet");
  assert.equal(samePair.retained.length, 4);
  assert.equal(samePair.retained[0].beforeId, samePair.retained[0].afterId);

  /* `normalizedParentChildLinks` dérive les paires de partnerIds × childIds :
     éditer seul `parentChildLinks` ne crée ni ne retire aucun lien. Une
     correction d’extrémité passe donc par l’appartenance aux deux listes. */
  const parentRemoved = compareFamilyRelations(base, { ...base, partnerIds: ["parent-2"] });
  assert.equal(parentRemoved.summary.removed, 2, "le parent retiré du Foyer fait disparaître ses deux liens");
  assert.equal(parentRemoved.summary.added, 0);
  assert.ok(parentRemoved.identities.filter(identity => identity.state === "relation-removed")
    .every(identity => identity.afterId === null && identity.stable === false));

  const childAdded = compareFamilyRelations(base, { ...base, childIds: [...base.childIds, "enfant-3"] });
  assert.equal(childAdded.summary.added, 2, "l’enfant ajouté au Foyer crée un lien vers chaque parent");
  assert.equal(childAdded.summary.removed, 0);
  assert.ok(childAdded.identities.filter(identity => identity.state === "relation-created")
    .every(identity => identity.beforeId === null && identity.stable === false));

  const directLinkOnly = compareFamilyRelations(base, { ...base, parentChildLinks: [] });
  assert.equal(directLinkOnly.summary.unstable, 0, "uniquement le type est perdu, jamais l’identité du lien");

  const snapshot = JSON.stringify(base);
  compareFamilyRelations(base, { ...base });
  assert.equal(JSON.stringify(base), snapshot, "aucune comparaison ne mute l’entrée");
});

test("la vérification des références de Preuve réutilise les états existants sans réinventer de statut", () => {
  const proof = proofFixture();
  const audit = auditProofReferences([proof], { documents: [{ id: "doc-1", pages: [] }], revisions: [] });
  assert.equal(audit.proofs.length, 1);
  assert.equal(audit.proofs[0].proofId, "preuve-1");
  assert.equal(audit.proofs[0].checks.document, "valid");
  assert.equal(audit.proofs[0].checks.revision, "not_applicable", "aucune révision de transcription fournie");
  assert.equal(audit.proofs[0].status, "not_checked");

  const missing = auditProofReferences([proof], { documents: [] });
  assert.equal(missing.proofs[0].checks.document, "missing");
  assert.equal(missing.proofs[0].status, "invalid");
  assert.throws(() => auditProofReferences(proof, {}), /tableau/);
});

test("la couverture distingue Preuve exacte, portée propriétaire et contradiction, sans produire d’évaluation", () => {
  const graph = fixtureGraph();
  const targets = enumerateJustificationTargets({ people: [graph.people[0]], families: [graph.families[0]] });
  const collected = collectAttestations(graph);

  const exactProof = proofFixture();
  const contradicting = proofFixture({
    id: "preuve-contre",
    relation: "contradicts",
    sourceValue: { type: "year", year: 1903 }
  });
  const generic = proofFixture({
    id: "preuve-generique",
    factId: buildFactIdentityId("person", "personne-1", "birth"),
    factType: "birth"
  });

  const coverage = analyzeJustificationCoverage({
    targets: targets.targets, proofs: [exactProof, contradicting, generic], attestations: collected.attestations
  });

  assert.equal(coverage.summary.total, coverage.targets.length);
  assert.equal(coverage.summary["target-proof-contradictory"], 1);
  assert.equal(coverage.summary["target-proof"], 0);
  assert.ok(coverage.summary["owner-attestation"] > 0);
  assert.equal(
    coverage.summary.none + coverage.summary["owner-attestation"]
      + coverage.summary["target-proof"] + coverage.summary["target-proof-contradictory"],
    coverage.summary.total
  );
  assert.ok(coverage.targets.every(item => item.evaluation === "not-evaluated"));
  assert.equal(DOCUMENT_COVERAGE.includes("target-proof-contradictory"), true);

  const birthDate = coverage.targets.find(item => item.factId === buildFactIdentityId("person", "personne-1", "birth.date"));
  assert.equal(birthDate.documentCoverage, "target-proof-contradictory");
  assert.deepEqual(birthDate.exactProofIds.sort(), ["preuve-contre", "preuve-1"].sort());
  assert.equal(birthDate.ambiguousProofIds.length, 0);
  assert.equal(birthDate.evaluation, "not-evaluated", "la couverture ne produit aucune évaluation");

  const withoutEvidence = analyzeJustificationCoverage({
    targets: [{ id: "cible-isolee", targetType: "person.name.middle", factId: null, owner: { kind: "person", id: "personne-inconnue" } }],
    proofs: [exactProof], attestations: collected.attestations
  });
  assert.equal(withoutEvidence.targets[0].documentCoverage, "none");
  assert.equal(withoutEvidence.targets[0].evaluation, "not-evaluated");

  const before = JSON.stringify([targets.targets, [exactProof, contradicting, generic], collected.attestations]);
  analyzeJustificationCoverage({ targets: targets.targets, proofs: [exactProof, contradicting, generic], attestations: collected.attestations });
  assert.equal(JSON.stringify([targets.targets, [exactProof, contradicting, generic], collected.attestations]), before,
    "l’analyse ne mute ni les cibles, ni les preuves, ni les attestations");
});
