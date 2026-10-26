import assert from "node:assert/strict";
import test from "node:test";
import {
  PROOF_RELATIONS,
  PROOF_STATUSES,
  createGenealogyProof,
  listFactsForSource,
  listProofsForFact,
  prepareProofReassessment,
  prepareProofsForHistoricalRelationship,
  prepareProofsForIdentityChange,
  prepareProofsForTranscriptChange,
  transitionProofStatus,
  validateGenealogyProof,
  verifyProofReferences
} from "../js/genealogy-proofs.js";
import { buildFactIdentityId } from "../js/genealogy-identities.js";
import { comparePageTextRevisions, createPageTextRevision, createTranscriptionPassage } from "../js/document-transcription.js";

function makeProof({ id = "proof-1", factId, factType = "birth.date", ...overrides } = {}) {
  return createGenealogyProof({
    id,
    factId: factId || buildFactIdentityId("person", "person-1", factType),
    factType,
    personIds: ["person-1"],
    documentId: "document-1",
    pageId: "page-1",
    passageId: "passage-1",
    transcriptionRevisionId: "revision-1",
    citationIt: "Nato li 13 settembre 1869",
    citationFr: "Né le 13 septembre 1869",
    sourceValue: { type: "exact", value: "1869-09-13" },
    relation: "supports",
    ...overrides
  });
}

function revision(id, text, overrides = {}) {
  return createPageTextRevision({
    id,
    documentId: "document-1",
    pageId: "page-1",
    previousRevisionId: overrides.previousRevisionId ?? null,
    passages: [createTranscriptionPassage({ id: "passage-1", order: 0, textIt: text, translationFr: "Né le 13 septembre 1869" })],
    ...overrides
  });
}

test("création et validation séparent le fait ciblé, la valeur source et la citation figée", () => {
  const treeFactValue = { type: "unknown" };
  const proof = makeProof({ sourceValue: { type: "exact", value: "1869-09-13" } });

  assert.equal(validateGenealogyProof(proof).valid, true);
  assert.notDeepEqual(proof.sourceValue, treeFactValue);
  assert.equal(proof.citation.textIt, "Nato li 13 settembre 1869");
  assert.equal(proof.citation.translationFr, "Né le 13 septembre 1869");
  assert.equal(proof.technicalStatus, "active");
  assert.deepEqual(proof.statusHistory, []);
});

test("un fait vide peut recevoir une preuve et l'auteur ou la date restent inconnus", () => {
  const emptyFactId = buildFactIdentityId("person", "person-1", "death.place");
  const proof = makeProof({ factId: emptyFactId, factType: "death.place", sourceValue: null, authorUid: null, createdAt: null });

  assert.equal(validateGenealogyProof(proof).valid, true);
  assert.equal(proof.sourceValue, null);
  assert.equal(proof.authorUid, null);
  assert.equal(proof.createdAt, null);
});

test("les quatre appréciations sont valides et restent indépendantes d'une conclusion", () => {
  const proofs = PROOF_RELATIONS.map((relation, index) => makeProof({ id: `proof-${index}`, relation }));
  assert.deepEqual(PROOF_RELATIONS, ["supports", "contradicts", "mentions", "ambiguous"]);
  assert.ok(proofs.every(proof => validateGenealogyProof(proof).valid));
  assert.equal(proofs.filter(proof => proof.relation === "contradicts").length, 1);
  assert.ok(proofs.every(proof => !Object.hasOwn(proof, "conclusion")), "aucune conclusion n'est déduite des appréciations");
  assert.deepEqual(listProofsForFact(proofs, proofs[0].factId), proofs, "les appréciations opposées restent toutes conservées");
});

test("les associations sont plusieurs-à-plusieurs et les sélecteurs n'altèrent pas les preuves", () => {
  const factA = buildFactIdentityId("person", "person-1", "birth.date");
  const factB = buildFactIdentityId("person", "person-2", "death.date");
  const proofs = [
    makeProof({ id: "p-a1", factId: factA, documentId: "document-1", passageId: "passage-1" }),
    makeProof({ id: "p-a2", factId: factA, documentId: "document-2", passageId: "passage-2" }),
    makeProof({ id: "p-b1", factId: factB, factType: "death.date", documentId: "document-1", passageId: "passage-3", personIds: ["person-2"] })
  ];
  const snapshot = JSON.stringify(proofs);

  assert.deepEqual(listProofsForFact(proofs, factA).map(item => item.id), ["p-a1", "p-a2"]);
  assert.deepEqual(listFactsForSource(proofs, "document-1"), [
    { factId: factA, factType: "birth.date" },
    { factId: factB, factType: "death.date" }
  ]);
  assert.equal(JSON.stringify(proofs), snapshot);
});

test("une preuve de filiation porte des IDs de relation indépendants des personnes", () => {
  const proof = makeProof({
    factId: "relationship-stable-1",
    factType: "parentChild",
    personIds: ["parent-1", "child-1"],
    relationshipId: "relationship-stable-1",
    familyId: "family-legacy-1",
    sourceValue: { filiation: "biological" }
  });

  assert.equal(validateGenealogyProof(proof).valid, true);
  assert.equal(proof.relationshipId, "relationship-stable-1");
  assert.deepEqual(proof.personIds, ["parent-1", "child-1"]);
});

test("une preuve citant un passage exige et conserve l'ID précis de révision", () => {
  const proof = makeProof({ passageId: "passage-persistant", transcriptionRevisionId: "revision-v3" });
  assert.equal(proof.passageId, "passage-persistant");
  assert.equal(proof.transcriptionRevisionId, "revision-v3");
  assert.throws(() => makeProof({ passageId: "passage-persistant", transcriptionRevisionId: null }), /révision de transcription précise/);
});

test("zone photographique invalide et appréciation inconnue sont refusées", () => {
  assert.throws(() => makeProof({ relation: "accepted" }), /Relation entre la source/);
  assert.throws(() => makeProof({ photographId: null, zone: { shape: "rect" } }), /rattachée à une photographie/);
  assert.throws(() => makeProof({ photographId: "photo-1", zone: { shape: "rect", photographId: "photo-2", x: 0, y: 0, width: 0.2, height: 0.2 } }), /même photographie/);
  assert.throws(() => makeProof({ pageId: null, passageId: "passage-1" }), /référencer sa page/);
  assert.equal(validateGenealogyProof({ ...makeProof(), relation: "not-a-relation" }).valid, false);
  const { sourceValue: _sourceValue, ...missingSourceClaim } = makeProof();
  assert.equal(validateGenealogyProof(missingSourceClaim).valid, false);
});

test("un changement substantiel de transcription prépare la suspension des seules preuves du passage cité", () => {
  const before = revision("revision-1", "Carlo Rossi");
  const after = revision("revision-2", "Paolo Rossi", { previousRevisionId: before.id });
  const comparison = comparePageTextRevisions(before, after);
  const proofs = [
    makeProof({ id: "affected", passageId: "passage-1" }),
    makeProof({ id: "other-passage", passageId: "passage-2" })
  ];
  const prepared = prepareProofsForTranscriptChange(proofs, comparison);

  assert.deepEqual(prepared, [{ proofId: "affected", from: "active", to: "suspended", eventId: "revision-2", action: "review-required" }]);
  assert.equal(proofs[0].technicalStatus, "active", "aucune preuve n'est suspendue ou modifiée automatiquement");
});

test("une révision de mise en forme n'entraîne pas de suspension de preuve", () => {
  const before = revision("revision-1", "Carlo Rossi\nfiglio");
  const after = revision("revision-2", " Carlo   Rossi figlio ", { previousRevisionId: before.id });
  const comparison = comparePageTextRevisions(before, after);

  assert.deepEqual(prepareProofsForTranscriptChange([makeProof()], comparison), []);
});

test("un changement d'identification cible les preuves de la personne sans transfert silencieux", () => {
  const affected = makeProof({ id: "identity-affected" });
  const unrelated = makeProof({ id: "identity-unrelated", personIds: ["person-2"] });
  const plan = prepareProofsForIdentityChange([affected, unrelated], { personId: "person-1", eventId: "identity-event-1" });

  assert.deepEqual(plan, [{ proofId: "identity-affected", from: "active", to: "suspended", eventId: "identity-event-1", action: "identity-review-required" }]);
  assert.equal(affected.personIds[0], "person-1");
  assert.equal(affected.technicalStatus, "active");
});

test("invalidation de relation conserve et signale les preuves comme historiques", () => {
  const proof = makeProof({ relationshipId: "relationship-1", factType: "parentChild", factId: "relationship-1", personIds: ["parent-1", "child-1"] });
  const relation = { id: "relationship-1", state: "invalidated", parentId: "parent-1", childId: "child-1" };
  const verified = verifyProofReferences(proof, {
    documents: [{ id: "document-1", pages: [{ id: "page-1", photographs: [] }] }],
    facts: [{ id: proof.factId, factType: proof.factType }],
    revisions: [{ id: "revision-1", documentId: "document-1", pageId: "page-1", passages: [{ id: "passage-1" }] }],
    relationships: [relation]
  });
  const plan = prepareProofsForHistoricalRelationship([proof], relation.id);

  assert.equal(verified.checks.relationship, "historical");
  assert.equal(verified.status, "historical");
  assert.equal(proof.relationshipId, relation.id);
  assert.deepEqual(plan, [{ proofId: proof.id, from: "active", to: "historical", action: "preserve-historical-reference" }]);
});

test("les transitions logiques conservent citation et versions antérieures sans mutation", () => {
  const active = makeProof();
  const suspended = transitionProofStatus(active, { to: "suspended", reason: "Passage corrigé", eventId: "event-1", actorUid: "uid-1", at: "2026-10-19T12:00:00.000Z" });
  const reactivated = transitionProofStatus(suspended, { to: "active", reason: "Vérification terminée", actorUid: "uid-2" });

  assert.equal(active.technicalStatus, "active");
  assert.equal(suspended.technicalStatus, "suspended");
  assert.equal(suspended.suspension.eventId, "event-1");
  assert.equal(reactivated.technicalStatus, "active");
  assert.equal(reactivated.citation.textIt, active.citation.textIt);
  assert.equal(active.statusHistory.length, 0);
  assert.equal(reactivated.statusHistory.length, 2);
  assert.ok(Object.isFrozen(reactivated.statusHistory[0]));
  assert.throws(() => transitionProofStatus(reactivated, { to: "suspended", reason: "" }), /reason/);
});

test("une preuve historique reste terminale et une réévaluation demande une décision explicite", () => {
  const suspended = transitionProofStatus(makeProof(), { to: "suspended", reason: "À examiner" });
  const plan = prepareProofReassessment(suspended);
  const historical = transitionProofStatus(suspended, { to: "historical", reason: "Relation invalidée" });

  assert.deepEqual(plan, { proofId: suspended.id, currentStatus: "suspended", proposedStatus: "active", requiresExplicitDecision: true });
  assert.throws(() => transitionProofStatus(historical, { to: "active", reason: "Réactiver" }), /historique ne peut pas être réactivée/);
  assert.throws(() => prepareProofReassessment(historical), /preuve suspendue/);
});

test("les références absentes, présentes, incohérentes et non vérifiées ont des états distincts", () => {
  const proof = makeProof({ photographId: "photo-1", zone: { shape: "rect", photographId: "photo-1", x: 0.1, y: 0.1, width: 0.2, height: 0.2 } });
  const unchecked = verifyProofReferences(proof, {});
  const missing = verifyProofReferences(proof, { documents: [], facts: [], revisions: [], relationships: [] });
  const valid = verifyProofReferences(proof, {
    documents: [{ id: "document-1", pages: [{ id: "page-1", photographs: [{ id: "photo-1" }] }] }],
    facts: [{ id: proof.factId, factType: proof.factType }],
    revisions: [{ id: "revision-1", documentId: "document-1", pageId: "page-1", passages: [{ id: "passage-1" }] }]
  });
  const mismatch = verifyProofReferences(proof, {
    documents: [{ id: "document-1", pages: [{ id: "page-1", photographs: [{ id: "photo-2" }] }] }],
    facts: [{ id: proof.factId, factType: "other.fact" }],
    revisions: [{ id: "revision-1", documentId: "document-2", pageId: "page-1", passages: [] }]
  });

  assert.equal(unchecked.status, "not_checked");
  assert.equal(unchecked.checks.document, "not_checked");
  assert.equal(missing.status, "invalid");
  assert.equal(missing.checks.document, "missing");
  assert.equal(valid.status, "valid");
  assert.equal(valid.checks.zone, "valid");
  assert.equal(mismatch.checks.revision, "mismatch");
  assert.equal(mismatch.checks.photograph, "missing");
  assert.equal(mismatch.checks.fact, "mismatch");
});

test("une zone aux coordonnées incorrectes est une incohérence, pas une cible positive", () => {
  const validProof = makeProof({
    photographId: "photo-1",
    zone: { shape: "rect", photographId: "photo-1", x: 0.1, y: 0.1, width: 0.2, height: 0.2 }
  });
  const proof = { ...validProof, zone: { ...validProof.zone, x: 0.8, width: 0.4 } };
  const result = verifyProofReferences(proof, {
    documents: [{ id: "document-1", pages: [{ id: "page-1", photographs: [{ id: "photo-1" }] }] }],
    facts: [{ id: proof.factId, factType: proof.factType }],
    revisions: [{ id: "revision-1", documentId: "document-1", pageId: "page-1", passages: [{ id: "passage-1" }] }]
  });
  assert.equal(result.checks.photograph, "valid");
  assert.equal(result.checks.zone, "mismatch");
  assert.equal(result.status, "invalid");
});

test("un identifiant seul ne suffit pas à affirmer une référence valide", () => {
  const proof = makeProof({ passageId: "passage-id-only", transcriptionRevisionId: "revision-id-only" });
  const result = verifyProofReferences(proof, {
    documents: [{ id: "document-1", pages: [{ id: "page-1", photographs: [] }] }],
    facts: [{ id: proof.factId, factType: proof.factType }],
    revisions: [{ id: "revision-id-only", documentId: "document-1", pageId: "page-1", passages: [] }]
  });
  assert.equal(result.checks.revision, "valid");
  assert.equal(result.checks.passage, "missing");
  assert.equal(result.status, "invalid");
});

test("validation refuse les IDs manquants, une source vide et les relations inconnues", () => {
  assert.throws(() => makeProof({ id: "", relation: "supports" }), /proof.id/);
  assert.throws(() => makeProof({ documentId: "", relation: "supports" }), /proof.documentId/);
  assert.throws(() => makeProof({ personIds: [], relation: "supports" }), /personIds/);
  assert.throws(() => makeProof({ relation: "endorses" }), /Relation entre la source/);
  assert.throws(() => createGenealogyProof({ id: "missing-claim", factId: "f", factType: "birth.date", personIds: ["person-1"], documentId: "d", relation: "mentions" }), /sourceValue doit être fourni/);
});
