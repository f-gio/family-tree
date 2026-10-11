import assert from "node:assert/strict";
import test from "node:test";
import {
  MAIN_TREE_ID,
  getPersonTreeId,
  getTreePeople,
  getTreeMemberIds,
  getTreeFamilies,
  prepareTreeTransferPlan,
  prepareIndividualTreeTransferPlan
} from "../js/tree-model.js";

const people = Object.freeze([
  Object.freeze({ id: "legacy", firstName: "Léa" }),
  Object.freeze({ id: "main-explicit", treeId: "main" }),
  Object.freeze({ id: "main-null", treeId: null }),
  Object.freeze({ id: "secondary-a", treeId: "tree-a" }),
  Object.freeze({ id: "secondary-b", treeId: "tree-a" }),
  Object.freeze({ id: "secondary-isolated", treeId: "tree-b" }),
  Object.freeze({ id: "bad-tree-id", treeId: "" }),
  Object.freeze({ id: "slash-tree-id", treeId: "tree/a" })
]);

const families = Object.freeze([
  Object.freeze({ id: "main-family", partnerIds: Object.freeze(["legacy", "main-explicit"]), childIds: Object.freeze(["main-null"]) }),
  Object.freeze({ id: "secondary-family", partnerIds: Object.freeze(["secondary-a"]), childIds: Object.freeze(["secondary-b"]), parentChildLinks: Object.freeze([Object.freeze({ parentId: "secondary-a", childId: "secondary-b", type: "biological" })]) }),
  Object.freeze({ id: "cross-family", partnerIds: Object.freeze(["secondary-a", "main-explicit"]), childIds: Object.freeze([]), parentChildLinks: Object.freeze([Object.freeze({ parentId: "secondary-a", childId: "main-explicit", type: "adoptive" })]) }),
  Object.freeze({ id: "links-only-cross-family", partnerIds: Object.freeze([]), childIds: Object.freeze([]), parentChildLinks: Object.freeze([Object.freeze({ parentId: "secondary-b", childId: "main-null", type: "uncertain" })]) }),
  Object.freeze({ id: "unresolved-family", partnerIds: Object.freeze(["secondary-a", "missing-person"]), childIds: Object.freeze([]) }),
  Object.freeze({ id: "empty-family", partnerIds: Object.freeze([]), childIds: Object.freeze([]) })
]);

test("treeId absent ou null identifie l'arbre principal sans changer les personnes", () => {
  assert.equal(MAIN_TREE_ID, "main");
  assert.equal(getPersonTreeId(people[0]), "main");
  assert.equal(getPersonTreeId(people[2]), "main");
  assert.equal(getPersonTreeId(people[3]), "tree-a");
  assert.equal(getPersonTreeId(people[6]), null, "treeId vide n'est pas reclassé silencieusement dans main");
  assert.equal(getPersonTreeId(people[7]), null, "treeId invalide n'est pas reclassé silencieusement dans main");
  assert.deepEqual(getTreePeople(people, "main").map(person => person.id), ["legacy", "main-explicit", "main-null"]);
  assert.deepEqual(getTreePeople(people, "tree-a").map(person => person.id), ["secondary-a", "secondary-b"]);
  assert.deepEqual(getTreePeople(people, "tree-b").map(person => person.id), ["secondary-isolated"]);
  assert.deepEqual(getTreePeople(people, "missing-tree"), []);
  assert.deepEqual(getTreeMemberIds(people, "tree-a"), ["secondary-a", "secondary-b"]);
  assert.deepEqual(getTreeMemberIds([{ treeId: "tree-a" }, { id: "x", treeId: "tree-a" }], "tree-a"), ["x"]);
});

test("getTreeFamilies garde seulement les familles entièrement contenues", () => {
  assert.deepEqual(getTreeFamilies(families, getTreePeople(people, "main")).map(family => family.id), ["main-family"]);
  assert.deepEqual(getTreeFamilies(families, getTreePeople(people, "tree-a")).map(family => family.id), ["secondary-family"]);
  assert.deepEqual(getTreeFamilies(families, getTreePeople(people, "tree-b")), [], "personne isolée, aucune relation inventée");
});

test("getTreeFamilies examine parentChildLinks et n'ajoute jamais de personne externe", () => {
  const onlyLinkMembers = [{ id: "secondary-b", treeId: "tree-a" }];
  assert.deepEqual(getTreeFamilies(families, onlyLinkMembers), [], "la famille inter-arbres est exclue même si elle n'a aucun partnerId/childId");
  const familyWithStaleExternalLink = [{ id: "secondary-a", treeId: "tree-a" }, { id: "secondary-b", treeId: "tree-a" }];
  assert.deepEqual(getTreeFamilies([families[1], {
    id: "stale-link",
    partnerIds: ["secondary-a"],
    childIds: ["secondary-b"],
    parentChildLinks: [{ parentId: "secondary-a", childId: "outside", type: "unknown" }]
  }], familyWithStaleExternalLink).map(family => family.id), ["secondary-family"]);
});

test("les fonctions de sélection ne mutent pas les entrées et ne dupliquent pas les membres", () => {
  const peopleBefore = JSON.stringify(people);
  const familiesBefore = JSON.stringify(families);
  const selected = getTreePeople(people, "tree-a");
  const selectedFamilies = getTreeFamilies(families, selected);
  assert.equal(new Set(selected.map(person => person.id)).size, selected.length);
  assert.equal(new Set(selectedFamilies.map(family => family.id)).size, selectedFamilies.length);
  assert.equal(JSON.stringify(people), peopleBefore);
  assert.equal(JSON.stringify(families), familiesBefore);
});

test("le plan de transfert vers main est descriptif, détecte les liens inter-arbres et ne mute rien", () => {
  const peopleBefore = JSON.stringify(people);
  const familiesBefore = JSON.stringify(families);
  const plan = prepareTreeTransferPlan({ people, families, sourceTreeId: "tree-a" });
  assert.deepEqual(plan, {
    sourceTreeId: "tree-a",
    destinationTreeId: "main",
    personIds: ["secondary-a", "secondary-b"],
    count: 2,
    interTreeLinks: [
      { familyId: "cross-family", sourcePersonIds: ["secondary-a"], otherTreePersonIds: ["main-explicit"], unresolvedPersonIds: [] },
      { familyId: "links-only-cross-family", sourcePersonIds: ["secondary-b"], otherTreePersonIds: ["main-null"], unresolvedPersonIds: [] },
      { familyId: "unresolved-family", sourcePersonIds: ["secondary-a"], otherTreePersonIds: [], unresolvedPersonIds: ["missing-person"] }
    ]
  });
  assert.equal(JSON.stringify(people), peopleBefore);
  assert.equal(JSON.stringify(families), familiesBefore);
});

test("un arbre secondaire vide a un plan valide de zéro personne", () => {
  assert.deepEqual(prepareTreeTransferPlan({ people, families, sourceTreeId: "empty-secondary" }), {
    sourceTreeId: "empty-secondary",
    destinationTreeId: "main",
    personIds: [],
    count: 0,
    interTreeLinks: []
  });
});

test("le transfert ou la suppression de main est refusé; source et destination doivent différer", () => {
  assert.throws(() => prepareTreeTransferPlan({ people, families, sourceTreeId: "main" }), /arbre principal/);
  assert.throws(() => prepareTreeTransferPlan({ people, families, sourceTreeId: "tree-a", destinationTreeId: "tree-a" }), /différents/);
  assert.throws(() => prepareTreeTransferPlan({ people, families, sourceTreeId: "" }), /source/);
  assert.throws(() => prepareTreeTransferPlan({ people, families, sourceTreeId: "tree-a", destinationTreeId: "tree/a" }), /destination/);
});

test("transfert individuel main → secondaire prévisualise les foyers conservés et invisibles sans mutation", () => {
  const transferPeople = [
    { id: "jean", firstName: "Jean", lastName: "Rossi" },
    { id: "marie", firstName: "Marie", lastName: "Rossi", treeId: null },
    { id: "paul", firstName: "Paul", lastName: "Rossi" },
    { id: "sophie", firstName: "Sophie", lastName: "Conti", treeId: "tree-a" },
    { id: "child-a", firstName: "Enfant", lastName: "Conti", treeId: "tree-a" }
  ];
  const transferFamilies = [
    { id: "parents-paul", partnerIds: ["jean", "marie"], childIds: ["paul"], parentChildLinks: [{ parentId: "jean", childId: "paul", type: "biological" }] },
    { id: "paul-sophie", partnerIds: ["paul", "sophie"], childIds: ["child-a"], parentChildLinks: [{ parentId: "sophie", childId: "child-a", type: "biological" }] },
    { id: "unknown-link", partnerIds: ["paul", "missing"], childIds: [] }
  ];
  const beforePeople = JSON.stringify(transferPeople);
  const beforeFamilies = JSON.stringify(transferFamilies);
  const plan = prepareIndividualTreeTransferPlan({
    personId: "paul", people: transferPeople, families: transferFamilies,
    trees: [{ id: "tree-a", name: "Branche A" }], destinationTreeId: "tree-a"
  });
  assert.equal(plan.personName, "Paul Rossi");
  assert.equal(plan.sourceTreeId, MAIN_TREE_ID);
  assert.equal(plan.destinationTreeName, "Branche A");
  assert.equal(plan.personInTree, true);
  assert.deepEqual(plan.affectedFamilies.map(family => family.familyId), ["parents-paul", "paul-sophie", "unknown-link"]);
  assert.deepEqual(plan.affectedFamilies.map(family => family.visibilityChange), ["becomes-hidden", "becomes-visible", "remains-hidden"]);
  assert.deepEqual(plan.affectedFamilies[0].beforeVisibleTreeIds, ["main"]);
  assert.deepEqual(plan.affectedFamilies[0].afterVisibleTreeIds, []);
  assert.deepEqual(plan.affectedFamilies[1].beforeVisibleTreeIds, []);
  assert.deepEqual(plan.affectedFamilies[1].afterVisibleTreeIds, ["tree-a"]);
  assert.deepEqual(plan.affectedFamilies[2].unresolvedPersonIds, ["missing"]);
  assert.deepEqual(plan.summary, {
    affectedFamilyCount: 3, remainsVisibleCount: 0, becomesHiddenCount: 1,
    becomesVisibleCount: 1, unresolvedReferenceCount: 1, invalidMembershipCount: 0
  });
  assert.equal(JSON.stringify(transferPeople), beforePeople);
  assert.equal(JSON.stringify(transferFamilies), beforeFamilies);
});

test("transfert individuel secondary → main et secondary → autre secondaire", () => {
  const transferPeople = [
    { id: "parent-a", firstName: "Parent", lastName: "A", treeId: "tree-a" },
    { id: "child-a", firstName: "Enfant", lastName: "A", treeId: "tree-a", inTree: false },
    { id: "other", firstName: "Autre", lastName: "B", treeId: "tree-b" }
  ];
  const transferFamilies = [{ id: "family-a", partnerIds: ["parent-a"], childIds: ["child-a"] }];
  const trees = [{ id: "tree-a", name: "Branche A" }, { id: "tree-b", name: "Branche B" }];
  const toMain = prepareIndividualTreeTransferPlan({ personId: "child-a", people: transferPeople, families: transferFamilies, trees, destinationTreeId: "main" });
  assert.equal(toMain.sourceTreeId, "tree-a");
  assert.equal(toMain.destinationTreeId, "main");
  assert.equal(toMain.personInTree, false, "inTree false est préservé et signalé");
  assert.equal(toMain.affectedFamilies[0].visibilityChange, "remains-hidden", "inTree false n'est pas rendu visible par le transfert");
  const toOtherSecondary = prepareIndividualTreeTransferPlan({ personId: "child-a", people: transferPeople, families: transferFamilies, trees, destinationTreeId: "tree-b" });
  assert.equal(toOtherSecondary.destinationTreeId, "tree-b");
  assert.equal(toOtherSecondary.affectedFamilies[0].visibilityChange, "remains-hidden");

  const visibleParents = [
    { id: "parent-1", firstName: "Jean", lastName: "Test" },
    { id: "parent-2", firstName: "Marie", lastName: "Test" },
    { id: "hidden-child", firstName: "Enfant", lastName: "Test", inTree: false }
  ];
  const recomposedFamily = { id: "parents-with-hidden-child", partnerIds: ["parent-1", "parent-2"], childIds: ["hidden-child"] };
  const hiddenPlan = prepareIndividualTreeTransferPlan({
    personId: "hidden-child", people: visibleParents, families: [recomposedFamily],
    trees: [{ id: "tree-a", name: "Branche A" }], destinationTreeId: "tree-a"
  });
  assert.equal(hiddenPlan.personInTree, false);
  assert.deepEqual(hiddenPlan.affectedFamilies[0].beforeVisibleTreeIds, ["main"], "l'union des parents reste dessinable malgré l'enfant masqué");
  assert.deepEqual(hiddenPlan.affectedFamilies[0].afterVisibleTreeIds, [], "le foyer mixte devient absent du dessin");
  assert.equal(visibleParents[2].treeId, undefined, "le plan ne mute pas l'appartenance source");
});

test("transfert individuel refuse source incohérente, destination identique ou inconnue", () => {
  const transferPeople = [{ id: "person", firstName: "Test", lastName: "A", treeId: "tree-a" }];
  const trees = [{ id: "tree-a", name: "Branche A" }];
  assert.throws(() => prepareIndividualTreeTransferPlan({ personId: "missing", people: transferPeople, trees, destinationTreeId: "main" }), /introuvable/);
  assert.throws(() => prepareIndividualTreeTransferPlan({ personId: "person", people: transferPeople, trees: [], destinationTreeId: "main" }), /arbre actuel.*indisponible/);
  assert.throws(() => prepareIndividualTreeTransferPlan({ personId: "person", people: transferPeople, trees, destinationTreeId: "tree-a" }), /différent/);
  assert.throws(() => prepareIndividualTreeTransferPlan({ personId: "person", people: transferPeople, trees, destinationTreeId: "tree-gone" }), /destination.*indisponible/);
});

test("fingerprint individuel change si l'appartenance ou les références d'un foyer changent", () => {
  const transferPeople = [{ id: "person", firstName: "Test", lastName: "A" }, { id: "relative", firstName: "Autre", lastName: "A" }];
  const family = { id: "family", partnerIds: ["person", "relative"], childIds: [] };
  const args = { personId: "person", trees: [{ id: "tree-a", name: "Branche A" }], destinationTreeId: "tree-a" };
  const first = prepareIndividualTreeTransferPlan({ ...args, people: transferPeople, families: [family] });
  const changedMembership = prepareIndividualTreeTransferPlan({ ...args, people: [transferPeople[0], { ...transferPeople[1], treeId: "tree-a" }], families: [family] });
  const changedFamily = prepareIndividualTreeTransferPlan({ ...args, people: transferPeople, families: [{ ...family, partnerIds: ["person"] }] });
  assert.notEqual(first.fingerprint, changedMembership.fingerprint);
  assert.notEqual(first.fingerprint, changedFamily.fingerprint);
});
