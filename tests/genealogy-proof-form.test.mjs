import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROOF_FACT_KINDS, PROOF_FACT_KIND_LABELS, PROOF_RELATION_LABELS,
  proofFactType, proofFactTypeLabel, showProofFamilyRelation,
  validateProofGuidedFields, buildProofGuidedInput
} from "../js/genealogy-proof-form.js";
import { PROOF_RELATIONS, createGenealogyProof, validateGenealogyProof } from "../js/genealogy-proofs.js";

const base = () => ({
  factKind: "birth",
  factOtherLabel: "",
  personIds: ["p1"],
  documentId: "doc1",
  pageId: "",
  passageId: "",
  transcriptionRevisionId: "",
  relation: "supports",
  sourceValue: "Paulo, figliu di Giovanni",
  sourceUnknown: false,
  citationIt: null,
  citationFr: null,
  interpretation: ""
});

test("les listes de faits et relations correspondent au modèle", () => {
  assert.deepEqual([...PROOF_FACT_KINDS], ["birth", "marriage", "death", "burial", "residence", "other"]);
  assert.equal(PROOF_FACT_KIND_LABELS.birth, "Naissance");
  assert.equal(PROOF_FACT_KIND_LABELS.other, "Autre");
  for (const relation of Object.keys(PROOF_RELATION_LABELS)) assert.ok(PROOF_RELATIONS.includes(relation), relation);
  assert.equal(PROOF_RELATION_LABELS.supports, "Confirme");
  assert.equal(proofFactType("birth"), "birth");
  assert.equal(proofFactType("other", "  Reconnaissance  "), "Reconnaissance");
  assert.equal(proofFactTypeLabel("death"), "Décès");
  assert.equal(proofFactTypeLabel("other", "Reconnaissance"), "Reconnaissance");
});

test("la relation familiale conditionnelle n'apparaît que pour un union ou un fait existant lié", () => {
  assert.equal(showProofFamilyRelation({ factKind: "marriage" }), true);
  assert.equal(showProofFamilyRelation({ factKind: "death" }), false);
  assert.equal(showProofFamilyRelation({ factKind: "death", existingFact: { familyId: "f1" } }), true);
  assert.equal(showProofFamilyRelation({ factKind: "death", existingFact: { relationshipId: "r1" } }), true);
  assert.equal(showProofFamilyRelation({ factKind: "death", existingFact: {} }), false);
});

test("la validation couvre les contraintes de chaque section", () => {
  assert.equal(validateProofGuidedFields(base()).valid, true);
  assert.equal(validateProofGuidedFields({ ...base(), factKind: "unknown" }).errors.factKind !== undefined, true);
  assert.equal(validateProofGuidedFields({ ...base(), factKind: "other", factOtherLabel: "" }).errors.factOtherLabel !== undefined, true);
  assert.equal(validateProofGuidedFields({ ...base(), personIds: [] }).errors.personIds, undefined, "aucune personne : associations facultatives");
  assert.equal(validateProofGuidedFields({ ...base(), personIds: ["p1", "p1"] }).errors.personIds !== undefined, true);
  assert.equal(validateProofGuidedFields({ ...base(), documentId: "" }).errors.documentId, undefined, "aucun document : associations facultatives");
  assert.equal(validateProofGuidedFields({ ...base(), documentId: "", pageId: "page1", passageId: "passage1" }).errors.passage !== undefined, true, "passage sans document refusé");
  assert.equal(validateProofGuidedFields({ ...base(), passageId: "passage1" }).errors.passage !== undefined, true);
  assert.equal(validateProofGuidedFields({ ...base(), pageId: "page1", passageId: "passage1" }).errors.passage !== undefined, true);
  assert.equal(validateProofGuidedFields({ ...base(), relation: "invented" }).errors.relation !== undefined, true);
  assert.equal(validateProofGuidedFields({ ...base(), sourceValue: "" }).errors.sourceValue !== undefined, true);
  assert.equal(validateProofGuidedFields({ ...base(), sourceValue: "", sourceUnknown: true }).valid, true, "valeur non relevée autorisée");
});

test("la preuve construite passe les validations du modèle genealogy-proofs", () => {
  const input = buildProofGuidedInput(base());
  const proof = createGenealogyProof({ ...input, id: "proof1", authorUid: "u1", createdAt: "2026-10-26T10:00:00.000Z" });
  const validation = validateGenealogyProof(proof);
  assert.equal(validation.valid, true, validation.errors ? validation.errors.join(" ; ") : "");
  assert.equal(proof.sourceValue, "Paulo, figliu di Giovanni");
  assert.equal(proof.photographId, null, "ancrage photographique reporté (lot 2B)");
  assert.equal(proof.zone, null);
});

test("passage : page et révision déduites, dépendances respectées", () => {
  const input = buildProofGuidedInput({ ...base(), pageId: "page1", passageId: "passage1", transcriptionRevisionId: "rev1", citationIt: "testo", citationFr: "texte" });
  assert.equal(input.pageId, "page1");
  assert.equal(input.passageId, "passage1");
  assert.equal(input.transcriptionRevisionId, "rev1");
  assert.equal(input.citationIt, "testo");
  assert.equal(input.citationFr, "texte");
  const proof = createGenealogyProof({ ...input, id: "p", authorUid: "u", createdAt: "2026-10-26T10:00:00.000Z" });
  assert.equal(validateGenealogyProof(proof).valid, true, validateGenealogyProof(proof).errors?.join(" ; ") || "");
  const withoutPassage = buildProofGuidedInput({ ...base(), pageId: "", passageId: "", transcriptionRevisionId: "rev1" });
  assert.equal(withoutPassage.transcriptionRevisionId, null, "la révision n'est conservée qu'avec page ou passage");
});

test("associations facultatives : neutresation des références et identifiant de repli", () => {
  // sans personne ni document : les références dérivées sont neutralisées
  const unattached = buildProofGuidedInput({ ...base(), personIds: [], documentId: "", pageId: "page1", passageId: "passage1", transcriptionRevisionId: "rev1", fallbackFactId: "proof-repli" });
  assert.deepEqual(unattached.personIds, []);
  assert.equal(unattached.documentId, null, "représentation canonique : documentId null");
  assert.equal(unattached.pageId, null, "page neutralisée sans document");
  assert.equal(unattached.passageId, null, "passage neutralisé sans document");
  assert.equal(unattached.transcriptionRevisionId, null, "révision neutralisée sans document");
  assert.equal(unattached.factId, "proof-repli", "identifiant de repli fourni par l'application");
  const proof = createGenealogyProof({ ...unattached, id: "proof-free", authorUid: "u1", createdAt: "2026-10-26T10:00:00.000Z" });
  assert.equal(validateGenealogyProof(proof).valid, true, validateGenealogyProof(proof).errors?.join(" ; ") || "");
  // personnes sans document
  const personOnly = buildProofGuidedInput({ ...base(), documentId: "" });
  assert.equal(personOnly.documentId, null);
  assert.deepEqual([...personOnly.personIds], ["p1"], "personnes conservées");
  const personOnlyProof = createGenealogyProof({ ...personOnly, id: "proof-person", authorUid: "u1", createdAt: "2026-10-26T10:00:00.000Z" });
  assert.equal(validateGenealogyProof(personOnlyProof).valid, true, validateGenealogyProof(personOnlyProof).errors?.join(" ; ") || "");
  // document sans personne
  const documentOnly = buildProofGuidedInput({ ...base(), personIds: [] });
  assert.deepEqual(documentOnly.personIds, []);
  assert.equal(documentOnly.documentId, "doc1");
  const documentOnlyProof = createGenealogyProof({ ...documentOnly, id: "proof-doc", authorUid: "u1", createdAt: "2026-10-26T10:00:00.000Z" });
  assert.equal(validateGenealogyProof(documentOnlyProof).valid, true, validateGenealogyProof(documentOnlyProof).errors?.join(" ; ") || "");
  // sans aucune association : identifiant de repli obligatoire
  assert.throws(() => buildProofGuidedInput({ ...base(), personIds: [], documentId: "" }), /factId|repli|person/i, "fallback manquant levé proprement");
});

test("fait existant réutilisé vs nouveau fait : identifiant stable du lot 0", () => {
  const existing = buildProofGuidedInput({ ...base(), existingFactId: "fact-old", existingFactType: "death" });
  assert.equal(existing.factId, "fact-old");
  assert.equal(existing.factType, "death");
  const first = buildProofGuidedInput({ ...base(), personIds: ["p1", "p2"] });
  const again = buildProofGuidedInput({ ...base(), personIds: ["p2", "p1"] });
  assert.equal(first.factId, again.factId, "identifiant stable indépendant de l'ordre des personnes");
  assert.ok(/^[A-Za-z0-9_~-]+$/.test(first.factId), "identifiant stable sans caractère inattendu");
  const other = buildProofGuidedInput({ ...base(), factKind: "other", factOtherLabel: "Naturalisation" });
  assert.equal(other.factType, "Naturalisation");
  assert.equal(other.factId, buildProofGuidedInput({ ...base(), factKind: "other", factOtherLabel: "Naturalisation" }).factId);
});

test("aucun identifiant technique n'est requis depuis l'interface", () => {
  const input = buildProofGuidedInput({ ...base(), factKind: "marriage", familyId: "fam1" });
  assert.equal(typeof input.factId, "string");
  assert.ok(!("revisionId" in input), "la révision d'écriture est produite par le flux officiel, pas par le formulaire");
  assert.ok(!("authorUid" in input) && !("createdAt" in input));
});
