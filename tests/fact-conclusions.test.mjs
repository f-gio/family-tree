import assert from "node:assert/strict";
import test from "node:test";
import {
  FACT_CONCLUSION_STATUSES,
  assertAdministratorRole,
  advanceConclusionHead,
  createConclusionHead,
  createConclusionRevision,
  createFactEvidenceDossier,
  getConclusionHistory,
  getCurrentConclusion,
  groupProofsByFact,
  prepareConclusionReexamination,
  validateConclusionRevision,
  validateSingleCurrentConclusionHeads
} from "../js/fact-conclusions.js";

const FACT_ID = "fact-person-1-birth-date";

function proof({ id, relation = "supports", sourceValue = { type: "exact", value: "1870-02-03" }, technicalStatus = "active", ...overrides } = {}) {
  return {
    id,
    factId: FACT_ID,
    factType: "birth.date",
    personIds: ["person-1"],
    documentId: "document-1",
    pageId: "page-1",
    passageId: "passage-1",
    transcriptionRevisionId: "transcription-rev-1",
    relation,
    sourceValue,
    citation: { textIt: "Nato il 3 febbraio 1870", translationFr: "Né le 3 février 1870" },
    technicalStatus,
    ...overrides
  };
}

function conclusionRevision({
  id,
  conclusionId = "conclusion-1",
  factId = FACT_ID,
  factType = "birth.date",
  previousRevisionId = null,
  status = "provisional",
  retainedValue = { type: "year", year: 1870 },
  examinedProofIds = ["proof-1"],
  decisiveProofIds = [],
  contradictoryProofIds = [],
  excludedProofs = [],
  justification = "Justification documentée",
  reason = "Nouvelle révision",
  actorRole = "admin",
  ...overrides
} = {}) {
  return createConclusionRevision({
    id, conclusionId, factId, factType, subjectKind: "person", subjectId: "person-1",
    previousRevisionId, status, retainedValue, examinedProofIds, decisiveProofIds,
    contradictoryProofIds, excludedProofs, justification, reason,
    authorUid: "admin-uid", createdAt: "2026-10-19T12:00:00.000Z", actorRole, ...overrides
  });
}

test("le dossier confronte des valeurs concordantes sans produire de score ou de conclusion", () => {
  const proofs = [
    proof({ id: "proof-1", sourceValue: { type: "exact", value: "1870-02-03" } }),
    proof({ id: "proof-2", sourceValue: { type: "exact", value: "1870-02-03" }, documentId: "document-2" })
  ];
  const dossier = createFactEvidenceDossier({
    factId: FACT_ID, factType: "birth.date", treeValue: { type: "unknown" }, proofs,
    referenceChecks: { "proof-1": { status: "valid" }, "proof-2": { status: "valid" } }
  });

  assert.equal(dossier.claims.length, 1);
  assert.equal(dossier.claims[0].supports.length, 2);
  assert.equal(dossier.hasDistinctClaims, false);
  assert.equal(dossier.treeValue.type, "unknown");
  assert.equal(dossier.conclusion, null);
  assert.equal(Object.hasOwn(dossier, "score"), false);
});

test("les affirmations contradictoires restent dans des groupes séparés sans vote majoritaire", () => {
  const proofs = [
    proof({ id: "proof-sept-13", relation: "supports", sourceValue: { type: "exact", value: "1869-09-13" } }),
    proof({ id: "proof-sept-14", relation: "contradicts", sourceValue: { type: "exact", value: "1869-09-14" } }),
    proof({ id: "proof-sept", relation: "supports", sourceValue: { type: "month", year: 1869, month: 9 } })
  ];
  const dossier = createFactEvidenceDossier({
    factId: FACT_ID,
    proofs,
    referenceChecks: Object.fromEntries(proofs.map(item => [item.id, { status: "valid" }]))
  });

  assert.equal(dossier.claims.length, 3);
  assert.equal(dossier.hasDistinctClaims, true);
  assert.equal(dossier.claims.find(group => group.contradicts.length).contradicts[0].proofId, "proof-sept-14");
  assert.equal(dossier.conclusion, null);
});

test("une mention sans valeur n'est pas comptée comme affirmation du fait", () => {
  const mention = proof({ id: "mention-only", relation: "mentions", sourceValue: null });
  const dossier = createFactEvidenceDossier({
    factId: FACT_ID,
    proofs: [mention],
    referenceChecks: { "mention-only": { status: "valid" } }
  });

  assert.equal(dossier.mentions.length, 1);
  assert.equal(dossier.claims.length, 0);
  assert.equal(dossier.hasDistinctClaims, false);
});

test("les preuves ambiguës, suspendues, historiques et non vérifiées restent visibles à part", () => {
  const proofs = [
    proof({ id: "ambiguous", relation: "ambiguous" }),
    proof({ id: "suspended", technicalStatus: "suspended", suspension: { reason: "Révision" } }),
    proof({ id: "historical", technicalStatus: "historical" }),
    proof({ id: "unchecked" })
  ];
  const dossier = createFactEvidenceDossier({
    factId: FACT_ID,
    proofs,
    referenceChecks: { ambiguous: { status: "valid" }, unchecked: { status: "not_checked" } }
  });

  assert.deepEqual(dossier.ambiguous.map(item => item.proofId), ["ambiguous"]);
  assert.deepEqual(dossier.suspended.map(item => item.proofId), ["suspended"]);
  assert.deepEqual(dossier.historical.map(item => item.proofId), ["historical"]);
  assert.deepEqual(dossier.technicallyUnverified.map(item => item.proofId), ["unchecked"]);
  assert.equal(dossier.claims.length, 0);
});

test("un fait inconnu ou partiel reste représentable et l'égalité aux valeurs d'arbre n'est pas imposée", () => {
  const unknownClaim = proof({ id: "unknown-claim", sourceValue: null });
  const partialClaim = proof({ id: "partial-claim", sourceValue: { type: "year", year: 1870 } });
  const dossier = createFactEvidenceDossier({
    factId: FACT_ID,
    treeValue: { type: "exact", value: "1870-02-03" },
    proofs: [unknownClaim, partialClaim],
    referenceChecks: { "unknown-claim": { status: "valid" }, "partial-claim": { status: "valid" } }
  });

  assert.equal(dossier.claims.length, 1);
  assert.equal(dossier.claims[0].value.type, "year");
  assert.equal(dossier.excluded[0].sourceValue, null);
  assert.equal(dossier.treeValue.type, "exact");
  assert.equal(dossier.conclusion, null);
});

test("le groupement plusieurs-à-plusieurs ne mute pas les preuves et accepte plusieurs faits par source", () => {
  const a = proof({ id: "a", documentId: "document-a" });
  const b = proof({ id: "b", factId: "fact-2", factType: "birth.place", documentId: "document-a" });
  const c = proof({ id: "c", factId: "fact-2", factType: "birth.place", documentId: "document-b" });
  const input = [a, b, c];
  const grouped = groupProofsByFact(input);
  const dossier = createFactEvidenceDossier({ factId: FACT_ID, proofs: input });

  assert.deepEqual(grouped.map(group => [group.factId, group.proofs.length]), [[FACT_ID, 1], ["fact-2", 2]]);
  assert.equal(dossier.technicallyUnverified.length, 1, "références absentes des contrôles restent non vérifiées");
  assert.equal(input.length, 3);
});

test("une conclusion provisoire est explicite, justifiée et référence les preuves examinées", () => {
  const revision = conclusionRevision({
    id: "conclusion-rev-1", status: "provisional", examinedProofIds: ["proof-1", "proof-2", "proof-3"],
    decisiveProofIds: ["proof-1"], contradictoryProofIds: ["proof-2"],
    excludedProofs: [{ proofId: "proof-3", reason: "Référence de passage non vérifiée" }]
  });

  assert.equal(validateConclusionRevision(revision).valid, true);
  assert.equal(revision.status, "provisional");
  assert.deepEqual(revision.decisiveProofIds, ["proof-1"]);
  assert.deepEqual(revision.contradictoryProofIds, ["proof-2"]);
  assert.deepEqual(revision.excludedProofs[0], { proofId: "proof-3", reason: "Référence de passage non vérifiée" });
});

test("les statuts undetermined, established, disputed et reexamination_required sont explicites", () => {
  assert.deepEqual(FACT_CONCLUSION_STATUSES, ["undetermined", "provisional", "established", "disputed", "reexamination_required"]);
  for (const status of ["undetermined", "established", "disputed", "reexamination_required"]) {
    assert.equal(conclusionRevision({ id: `rev-${status}`, status }).status, status);
  }
});

test("les IDs fournis restent stables et une révision précédente ne remplace pas le snapshot", () => {
  const before = conclusionRevision({ id: "revision-1", status: "provisional" });
  const initialHead = createConclusionHead({ id: "conclusion-1", factId: FACT_ID, factType: "birth.date", firstRevision: before }, { actorRole: "admin" });
  const next = conclusionRevision({ id: "revision-2", previousRevisionId: before.id, status: "established", retainedValue: { type: "exact", value: "1870-02-03" } });
  const advanced = advanceConclusionHead(initialHead, next, { actorRole: "primary-admin" });

  assert.equal(advanced.id, initialHead.id);
  assert.equal(advanced.currentRevisionId, "revision-2");
  assert.equal(initialHead.currentRevisionId, "revision-1");
  assert.equal(before.status, "provisional");
  assert.deepEqual(getConclusionHistory([before, next], advanced.id, advanced.currentRevisionId).history.map(item => item.id), ["revision-2", "revision-1"]);
  assert.equal(getCurrentConclusion([advanced], [before, next], FACT_ID).revision.id, "revision-2");
});

test("l'absence de conclusion est distincte d'une conclusion undetermined", () => {
  const revision = conclusionRevision({ id: "undetermined-rev", conclusionId: "conclusion-undetermined", status: "undetermined", retainedValue: null, examinedProofIds: [] });
  const head = createConclusionHead({ id: "conclusion-undetermined", factId: FACT_ID, factType: "birth.date", firstRevision: revision }, { actorRole: "admin" });

  assert.equal(getCurrentConclusion([], [revision], FACT_ID), null);
  assert.equal(getCurrentConclusion([head], [revision], FACT_ID).revision.status, "undetermined");
});

test("une seule tête courante est validée par fait et une révision orpheline est signalée", () => {
  const first = createConclusionHead({ id: "c1", factId: "fact-1", factType: "birth.date", firstRevision: conclusionRevision({ id: "r1", conclusionId: "c1", factId: "fact-1" }) }, { actorRole: "admin" });
  const second = createConclusionHead({ id: "c2", factId: "fact-2", factType: "death.date", firstRevision: conclusionRevision({ id: "r2", conclusionId: "c2", factId: "fact-2", factType: "death.date" }) }, { actorRole: "admin", existingHeads: [first] });
  assert.equal(validateSingleCurrentConclusionHeads([first, second]).valid, true);
  assert.equal(validateSingleCurrentConclusionHeads([first, { ...second, factId: "fact-1" }]).valid, false);
  assert.equal(getCurrentConclusion([first], [], "fact-1").state, "missing-current-revision");
  assert.throws(() => createConclusionHead({ id: "c3", factId: "fact-1", factType: "birth.date", firstRevision: conclusionRevision({ id: "r3", conclusionId: "c3", factId: "fact-1" }) }, { actorRole: "admin", existingHeads: [first] }), /existe déjà/);
});

test("une conclusion ne peut être créée ou avancée que pour un administrateur", () => {
  assert.equal(assertAdministratorRole("admin"), true);
  assert.equal(assertAdministratorRole("primary-admin"), true);
  assert.throws(() => assertAdministratorRole("member"), /réservée aux administrateurs/);
  assert.throws(() => assertAdministratorRole(undefined), /réservée aux administrateurs/);
  assert.throws(() => conclusionRevision({ id: "member-revision", actorRole: "member" }), /réservée aux administrateurs/);
});

test("des références de preuve obsolètes empêchent d'avancer une tête de conclusion", () => {
  const current = conclusionRevision({ id: "current-revision" });
  const head = createConclusionHead({ id: current.conclusionId, factId: current.factId, factType: current.factType, firstRevision: current }, { actorRole: "admin" });
  const stale = conclusionRevision({ id: "stale-revision", previousRevisionId: "another-revision" });
  assert.throws(() => advanceConclusionHead(head, stale, { actorRole: "admin" }), /ne prolonge pas la version courante/);
  assert.equal(head.currentRevisionId, current.id);
});

test("une modification d'une preuve examinée prépare un réexamen sans changer la conclusion", () => {
  const conclusion = conclusionRevision({ id: "established-rev", status: "established", examinedProofIds: ["examined"], retainedValue: "value-a" });
  const suspended = proof({ id: "examined", technicalStatus: "suspended", suspension: { reason: "Citation modifiée" } });
  const candidate = prepareConclusionReexamination({ conclusion, proofs: [suspended] });

  assert.equal(candidate.proposedStatus, "reexamination_required");
  assert.equal(candidate.requiresExplicitAdminDecision, true);
  assert.equal(candidate.reasons[0].kind, "proof-suspended");
  assert.equal(conclusion.status, "established");
});

test("un passage substantiellement modifié prépare un réexamen mais le format seul non", () => {
  const conclusion = conclusionRevision({ id: "c-rev", status: "provisional", examinedProofIds: ["p1"] });
  const substantive = prepareConclusionReexamination({
    conclusion,
    proofs: [proof({ id: "p1" })],
    transcriptChange: { passageChanges: [{ passageId: "passage-1", substantive: true, proofReviewRequired: true }] }
  });
  const formatting = prepareConclusionReexamination({
    conclusion,
    proofs: [proof({ id: "p1" })],
    transcriptChange: { passageChanges: [{ passageId: "passage-1", substantive: false, proofReviewRequired: false }] }
  });

  assert.equal(substantive.reasons[0].kind, "cited-passage-changed");
  assert.equal(formatting.requiresExplicitAdminDecision, false);
  assert.equal(formatting.proposedStatus, "provisional");
});

test("un changement d'identité ou l'invalidation d'une relation prépare un réexamen", () => {
  const personConclusion = conclusionRevision({ id: "person-rev", status: "established", examinedProofIds: ["person-proof"] });
  const personProof = proof({ id: "person-proof" });
  const identity = prepareConclusionReexamination({ conclusion: personConclusion, proofs: [personProof], identityChange: { personId: "person-1" } });

  const relationConclusion = conclusionRevision({ id: "relation-rev", factId: "relationship-1", factType: "parentChild", subjectKind: "relationship", subjectId: "relationship-1", examinedProofIds: ["relation-proof"] });
  const relationProof = proof({ id: "relation-proof", factId: "relationship-1", factType: "parentChild", relationshipId: "relationship-1" });
  const relation = prepareConclusionReexamination({ conclusion: relationConclusion, proofs: [relationProof], relationChange: { relationshipId: "relationship-1" } });

  assert.equal(identity.reasons[0].kind, "identity-changed");
  assert.equal(relation.reasons[0].kind, "relation-invalidated");
});

test("une nouvelle preuve contradictoire ou divergente signale un réexamen seulement si elle est vérifiée", () => {
  const conclusion = conclusionRevision({ id: "c-established", status: "established", retainedValue: { year: 1870 } });
  const contradiction = proof({ id: "new-contradiction", factId: FACT_ID, relation: "contradicts", sourceValue: { year: 1871 } });
  const checked = prepareConclusionReexamination({ conclusion, newProof: contradiction, newProofReferenceStatus: "valid" });
  const unchecked = prepareConclusionReexamination({ conclusion, newProof: contradiction });

  assert.equal(checked.reasons[0].kind, "contradictory-proof-added");
  assert.equal(unchecked.requiresExplicitAdminDecision, false);
});

test("une conclusion n'infère pas de statut depuis le nombre de preuves", () => {
  const proofs = [proof({ id: "one" }), proof({ id: "two" }), proof({ id: "three" })];
  const dossier = createFactEvidenceDossier({ factId: FACT_ID, proofs, referenceChecks: Object.fromEntries(proofs.map(item => [item.id, { status: "valid" }])) });
  assert.equal(dossier.claims[0].supports.length, 3);
  assert.equal(dossier.conclusion, null);
  assert.equal(FACT_CONCLUSION_STATUSES.includes("established"), true);
});
