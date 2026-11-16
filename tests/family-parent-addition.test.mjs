import assert from "node:assert/strict";
import test from "node:test";
import { planSecondParentAddition } from "../js/family-parent-addition.js";
import { parentChildLinkType } from "../js/family-relations.js";
import { validateFamilyDataset } from "../js/backup-utils.js";

const people = ["mere", "pere", "enfant-a", "enfant-b", "enfant-c"].map(id => ({ id }));
const source = {
  id: "foyer-monoparental",
  partnerIds: ["mere"],
  childIds: ["enfant-a", "enfant-b"],
  relationType: "unknown",
  unionDateInfo: { type: "unknown" },
  endType: "none",
  endDateInfo: { type: "unknown" },
  parentChildLinks: [
    { parentId: "mere", childId: "enfant-a", type: "adoptive" },
    { parentId: "mere", childId: "enfant-b", type: "biological" }
  ]
};

test("l'ajout d'un second parent ne rattache que l'enfant explicitement choisi", () => {
  const plan = planSecondParentAddition({
    families: [source], sourceFamilyId: source.id, childId: "enfant-a", addedParentId: "pere",
    existingParentFiliation: "adoptive", addedParentFiliation: "uncertain",
    familyFields: { relationType: "partner", unionDateInfo: { type: "year", year: 1925 } }
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.sourceUpdate.childIds, ["enfant-b"]);
  assert.deepEqual(plan.sourceUpdate.parentChildLinks, [{ parentId: "mere", childId: "enfant-b", type: "biological" }]);
  assert.deepEqual(plan.createFamily.partnerIds, ["mere", "pere"]);
  assert.deepEqual(plan.createFamily.childIds, ["enfant-a"]);
  assert.deepEqual(plan.createFamily.parentChildLinks, [
    { parentId: "mere", childId: "enfant-a", type: "adoptive" },
    { parentId: "pere", childId: "enfant-a", type: "uncertain" }
  ]);
  assert.equal(plan.createFamily.relationType, "partner");
  const sourceAfter = { ...source, ...plan.sourceUpdate };
  const targetAfter = { id: "foyer-couple", ...plan.createFamily };
  validateFamilyDataset(people, [sourceAfter, targetAfter]);
  assert.equal(parentChildLinkType(targetAfter, "mere", "enfant-a"), "adoptive");
  assert.equal(parentChildLinkType(targetAfter, "pere", "enfant-a"), "uncertain");
  assert.equal(parentChildLinkType(sourceAfter, "mere", "enfant-b"), "biological");
});

test("un foyer monoparental peut ajouter un enfant à un couple existant sans déplacer ses autres enfants", () => {
  const couple = {
    id: "foyer-couple-existant",
    partnerIds: ["mere", "pere"],
    childIds: ["enfant-c"],
    relationType: "marriage",
    unionDateInfo: { type: "year", year: 1910 },
    endType: "none",
    endDateInfo: { type: "unknown" },
    marriageAttestations: [{ id: "union-existante", date: { type: "unknown" } }],
    parentChildLinks: [
      { parentId: "mere", childId: "enfant-c", type: "biological" },
      { parentId: "pere", childId: "enfant-c", type: "biological" }
    ]
  };
  const plan = planSecondParentAddition({
    families: [source, couple], sourceFamilyId: source.id, childId: "enfant-a", addedParentId: "pere",
    existingParentFiliation: "adoptive", addedParentFiliation: "biological",
    familyFields: { marriageAttestations: [
      { id: "union-existante", date: { type: "unknown" } },
      { id: "nouvelle-attestation", date: { type: "year", year: 1925 } }
    ] }
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.targetFamilyId, couple.id);
  assert.equal(plan.createFamily, null, "aucun foyer de couple dupliqué");
  assert.deepEqual(plan.familyUpdate.childIds, ["enfant-c", "enfant-a"]);
  assert.equal(parentChildLinkType({ ...couple, ...plan.familyUpdate }, "mere", "enfant-c"), "biological");
  assert.equal(parentChildLinkType({ ...couple, ...plan.familyUpdate }, "pere", "enfant-c"), "biological");
  assert.equal(parentChildLinkType({ ...couple, ...plan.familyUpdate }, "mere", "enfant-a"), "adoptive");
  assert.equal(parentChildLinkType({ ...couple, ...plan.familyUpdate }, "pere", "enfant-a"), "biological");
  assert.deepEqual(plan.familyUpdate.marriageAttestations.map(item => item.id), ["union-existante", "nouvelle-attestation"]);
  validateFamilyDataset(people, [
    { ...source, ...plan.sourceUpdate },
    { ...couple, ...plan.familyUpdate }
  ]);
});

test("refuse l'ajout si l'enfant a plusieurs foyers ou si le couple cible contient déjà cet enfant", () => {
  const otherHome = { id: "autre-foyer", partnerIds: ["pere"], childIds: ["enfant-a"] };
  assert.equal(planSecondParentAddition({ families: [source, otherHome], sourceFamilyId: source.id, childId: "enfant-a", addedParentId: "pere" }).ok, false);
  const duplicateCouple = { id: "couple", partnerIds: ["mere", "pere"], childIds: ["enfant-a"] };
  const plan = planSecondParentAddition({ families: [source, duplicateCouple], sourceFamilyId: source.id, childId: "enfant-a", addedParentId: "pere" });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /déjà rattaché/);
});
