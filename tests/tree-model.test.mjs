import assert from "node:assert/strict";
import test from "node:test";
import {
  MAIN_TREE_ID,
  getPersonTreeId,
  getTreePeople,
  getTreeMemberIds,
  getTreeFamilies,
  prepareTreeTransferPlan,
  prepareIndividualTreeTransferPlan,
  MAX_MULTI_TREE_TRANSFER_PEOPLE,
  MAX_MULTI_TREE_TRANSFER_READS,
  prepareMultipleTreeTransferPlan
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

/* ─── Ordre des propriétés des objets relationnels (correctif faux conflit) ─── */

const orderPeople = [
  { id: "jean", firstName: "Jean", lastName: "Test" },
  { id: "marie", firstName: "Marie", lastName: "Test" },
  { id: "paul", firstName: "Paul", lastName: "Test" },
  { id: "sophie", firstName: "Sophie", lastName: "Giovannoni", treeId: "tree-a" },
  { id: "lea", firstName: "Léa", lastName: "Giovannoni", treeId: "tree-a" }
];
const ORDER_FAMILY_BASE = { id: "f", partnerIds: ["jean", "marie"], childIds: ["paul"], relationType: "marriage" };
const orderTrees = [{ id: "tree-a", name: "Giovannoni Orino" }];

function orderPlan(parentChildLinks, destinationTreeId = "tree-a") {
  return prepareIndividualTreeTransferPlan({
    personId: "paul", people: orderPeople,
    families: [{ ...ORDER_FAMILY_BASE, parentChildLinks }], trees: orderTrees, destinationTreeId
  });
}

test("l'ordre des propriétés d'une même relation parent-enfant ne change pas le fingerprint", () => {
  const parentFirst = orderPlan([{ parentId: "jean", childId: "paul", type: "biological" }]);
  const childFirst = orderPlan([{ childId: "paul", parentId: "jean", type: "biological" }]);
  assert.equal(parentFirst.fingerprint, childFirst.fingerprint,
    "deux relations identiques à l'ordre de propriétés près doivent produire la même empreinte");
});

test("l'ordre des propriétés dans les objets `links` ne change pas le fingerprint", () => {
  const fromFirst = prepareIndividualTreeTransferPlan({
    personId: "paul", people: orderPeople,
    families: [{ ...ORDER_FAMILY_BASE, parentChildLinks: [], links: [{ fromId: "jean", toId: "paul" }] }],
    trees: orderTrees, destinationTreeId: "tree-a"
  });
  const toFirst = prepareIndividualTreeTransferPlan({
    personId: "paul", people: orderPeople,
    families: [{ ...ORDER_FAMILY_BASE, parentChildLinks: [], links: [{ toId: "paul", fromId: "jean" }] }],
    trees: orderTrees, destinationTreeId: "tree-a"
  });
  assert.equal(fromFirst.fingerprint, toFirst.fingerprint,
    "deux objets links identiques à l'ordre de propriétés près doivent produire la même empreinte");
});

test("les vraies différences de filiation restent détectées malgré la normalisation des clés", () => {
  const reference = orderPlan([{ parentId: "jean", childId: "paul", type: "biological" }]);
  assert.notEqual(reference.fingerprint, orderPlan([{ parentId: "marie", childId: "paul", type: "biological" }]).fingerprint, "parent remplacé");
  assert.notEqual(reference.fingerprint, orderPlan([{ parentId: "jean", childId: "paul", type: "adoptive" }]).fingerprint, "type de filiation changé");
  const added = orderPlan([{ parentId: "jean", childId: "paul", type: "biological" }, { parentId: "marie", childId: "paul", type: "biological" }]);
  assert.notEqual(reference.fingerprint, added.fingerprint, "relation ajoutée");
  assert.notEqual(reference.fingerprint, orderPlan([]).fingerprint, "relation supprimée");
  const swapped = orderPlan([{ parentId: "jean", childId: "marie", type: "biological" }]);
  assert.notEqual(reference.fingerprint, swapped.fingerprint, "enfant remplacé : les valeurs ne sont pas neutralisées");
});

/* ─── Transfert multiple explicite, aperçu pur et limites atomiques ────────── */

const multiPeople = [
  { id: "jean", firstName: "Jean", lastName: "Test" },
  { id: "marie", firstName: "Marie", lastName: "Test", treeId: null },
  { id: "paul", firstName: "Paul", lastName: "Test", inTree: false, notes: "À conserver" },
  { id: "sophie", firstName: "Sophie", lastName: "Test", treeId: "tree-a" },
  { id: "sans-lien", firstName: "Autre", lastName: "Test" }
];
const multiFamilies = [
  { id: "parents-paul", partnerIds: ["jean", "marie"], childIds: ["paul"], parentChildLinks: [
    { parentId: "jean", childId: "paul", type: "biological" },
    { parentId: "marie", childId: "paul", type: "biological" }
  ] },
  { id: "union-paul", partnerIds: ["paul", "sophie"], childIds: [] }
];
const multiTrees = [{ id: "tree-a", name: "Giovannoni Orino" }, { id: "tree-b", name: "Autre arbre" }];

function multiPlan(personIds, destinationTreeId = "tree-a", peopleList = multiPeople, familiesList = multiFamilies, treesList = multiTrees) {
  return prepareMultipleTreeTransferPlan({ personIds, people: peopleList, families: familiesList, trees: treesList, destinationTreeId });
}

test("sélection multiple : zéro, doublons, personnes inconnues, arbres sources mixtes et destination invalide refusés", () => {
  assert.throws(() => multiPlan([]), /au moins une personne/);
  assert.throws(() => multiPlan(["paul", "paul"]), /double/);
  assert.throws(() => multiPlan(["absente"]), /n'existe plus/);
  assert.throws(() => multiPlan(["paul", "sophie"], "tree-b"), /même arbre source/);
  assert.throws(() => multiPlan(["paul"], "tree-gone"), /destination.*indisponible/);
  assert.throws(() => multiPlan(["paul"], "tree-a", multiPeople, multiFamilies, []), /destination.*indisponible/);
});

test("arbre principal absent/null/main est normalisé et les transferts multi couvrent les trois directions", () => {
  const historicalPeople = [
    { id: "legacy-absent" },
    { id: "legacy-null", treeId: null },
    { id: "legacy-main", treeId: MAIN_TREE_ID },
    { id: "secondary", treeId: "tree-a" },
    { id: "secondary-two", treeId: "tree-a" }
  ];
  const toSecondary = prepareMultipleTreeTransferPlan({
    personIds: ["legacy-absent", "legacy-null", "legacy-main"], people: historicalPeople,
    families: [], trees: multiTrees, destinationTreeId: "tree-a"
  });
  assert.equal(toSecondary.sourceTreeId, MAIN_TREE_ID);
  assert.equal(toSecondary.personIds.length, 3);
  const toMain = prepareMultipleTreeTransferPlan({ personIds: ["secondary", "secondary-two"], people: historicalPeople, families: [], trees: multiTrees, destinationTreeId: MAIN_TREE_ID });
  assert.equal(toMain.sourceTreeId, "tree-a");
  assert.equal(toMain.personIds.length, 2);
  const toOtherSecondary = prepareMultipleTreeTransferPlan({ personIds: ["secondary", "secondary-two"], people: historicalPeople, families: [], trees: multiTrees, destinationTreeId: "tree-b" });
  assert.equal(toOtherSecondary.destinationTreeId, "tree-b");
});

test("aperçu multi distingue liens internes, limites externes, tiers et inTree false sans mutation", () => {
  const beforePeople = JSON.stringify(multiPeople);
  const beforeFamilies = JSON.stringify(multiFamilies);
  const plan = multiPlan(["jean", "marie", "paul"]);
  assert.equal(plan.summary.selectedCount, 3);
  assert.equal(plan.summary.internalFamilyCount, 1, "foyer parental entièrement sélectionné");
  assert.equal(plan.summary.boundaryFamilyCount, 1, "union avec Sophie non sélectionnée");
  assert.equal(plan.summary.hiddenSelectionCount, 1, "inTree false est préservé et signalé");
  assert.deepEqual(plan.affectedFamilies.find(f => f.familyId === "parents-paul").selectedMemberIds.sort(), ["jean", "marie", "paul"]);
  assert.deepEqual(plan.affectedFamilies.find(f => f.familyId === "union-paul").unselectedMemberIds, ["sophie"]);
  assert.equal(plan.affectedFamilies.find(f => f.familyId === "union-paul").otherTreeMemberIds.length, 0);
  assert.equal(JSON.stringify(multiPeople), beforePeople);
  assert.equal(JSON.stringify(multiFamilies), beforeFamilies);
});

test("foyers multiples et liens déjà situés dans un troisième arbre sont exposés", () => {
  const threeTreePeople = multiPeople.concat({ id: "relative-tree-b", firstName: "Autre", lastName: "Arbre", treeId: "tree-b" });
  const threeTreeFamilies = multiFamilies.concat({ id: "paul-other-tree", partnerIds: ["paul", "relative-tree-b"], childIds: [] });
  const plan = multiPlan(["paul"], "tree-a", threeTreePeople, threeTreeFamilies);
  assert.equal(plan.affectedFamilies.length, 3, "tous les foyers liés à Paul sont pris en compte");
  assert.equal(plan.summary.otherTreeLinkCount, 1);
  assert.deepEqual(plan.affectedFamilies.find(family => family.familyId === "paul-other-tree").otherTreeMemberIds, ["relative-tree-b"]);
});

test("parent unique, couple sans enfant et famille recomposée produisent un aperçu cohérent", () => {
  const parentUniquePeople = [{ id: "parent" }, { id: "enfant" }];
  const parentUnique = { id: "parent-unique", partnerIds: ["parent"], childIds: ["enfant"], parentChildLinks: [{ parentId: "parent", childId: "enfant", type: "biological" }] };
  const childOnly = prepareMultipleTreeTransferPlan({ personIds: ["enfant"], people: parentUniquePeople, families: [parentUnique], trees: multiTrees, destinationTreeId: "tree-a" });
  assert.equal(childOnly.summary.boundaryFamilyCount, 1, "le parent non sélectionné reste dans l'arbre source");
  const parentAndChild = prepareMultipleTreeTransferPlan({ personIds: ["parent", "enfant"], people: parentUniquePeople, families: [parentUnique], trees: multiTrees, destinationTreeId: "tree-a" });
  assert.equal(parentAndChild.summary.internalFamilyCount, 1);

  const couple = { id: "couple", partnerIds: ["parent", "partenaire"], childIds: [] };
  const couplePlan = prepareMultipleTreeTransferPlan({
    personIds: ["parent", "partenaire"], people: [...parentUniquePeople, { id: "partenaire" }],
    families: [couple], trees: multiTrees, destinationTreeId: "tree-a"
  });
  assert.equal(couplePlan.summary.internalFamilyCount, 1, "un couple sans enfant reste une relation interne intacte");

  const blendedPeople = [{ id: "parent-a" }, { id: "parent-b" }, { id: "parent-c" }, { id: "child" }, { id: "stepchild" }];
  const blendedFamilies = [
    { id: "first-home", partnerIds: ["parent-a", "parent-b"], childIds: ["child"] },
    { id: "recomposed-home", partnerIds: ["parent-a", "parent-c"], childIds: ["child", "stepchild"] }
  ];
  const blended = prepareMultipleTreeTransferPlan({
    personIds: ["child"], people: blendedPeople, families: blendedFamilies,
    trees: multiTrees, destinationTreeId: "tree-a"
  });
  assert.equal(blended.summary.affectedFamilyCount, 2, "les deux foyers recomposés sont présentés");
  assert.ok(blended.affectedFamilies.every(family => family.unselectedMemberIds.length > 0));
});

test(`transfert multiple plafonné à ${MAX_MULTI_TREE_TRANSFER_PEOPLE} personnes et à ${MAX_MULTI_TREE_TRANSFER_READS} lectures`, () => {
  const manyPeople = Array.from({ length: MAX_MULTI_TREE_TRANSFER_PEOPLE + 1 }, (_, index) => ({ id: `p-${index}`, treeId: null }));
  assert.throws(() => multiPlan(manyPeople.map(p => p.id), "tree-a", manyPeople, [], multiTrees), /limitée à/);
  const exactlyMaximum = manyPeople.slice(0, MAX_MULTI_TREE_TRANSFER_PEOPLE);
  assert.equal(multiPlan(exactlyMaximum.map(p => p.id), "tree-a", exactlyMaximum, [], multiTrees).personIds.length, MAX_MULTI_TREE_TRANSFER_PEOPLE);

  const selected = [{ id: "paul" }];
  const oversizedFamily = { id: "large-family", partnerIds: ["paul"], childIds: [], memberIds: Array.from({ length: MAX_MULTI_TREE_TRANSFER_READS }, (_, i) => `ref-${i}`) };
  assert.throws(() => multiPlan(["paul"], "tree-a", selected, [oversizedFamily], multiTrees), /trop de documents/);
});

test("fingerprint multiple canonique détecte appartenance, foyer et relations réelles", () => {
  const original = multiPlan(["jean", "paul"]);
  const changedMemberTree = multiPlan(["jean", "paul"], "tree-a", multiPeople.map(p => p.id === "marie" ? { ...p, treeId: "tree-a" } : p));
  const changedRelation = multiPlan(["jean", "paul"], "tree-a", multiPeople, [{ ...multiFamilies[0], parentChildLinks: [{ parentId: "marie", childId: "paul", type: "adoptive" }] }, multiFamilies[1]]);
  assert.notEqual(original.fingerprint, changedMemberTree.fingerprint);
  assert.notEqual(original.fingerprint, changedRelation.fingerprint);
});

test("fingerprint multiple reste stable pour l'ordre des propriétés des filiations", () => {
  const firstOrder = multiFamilies.map(family => ({ ...family, parentChildLinks: family.parentChildLinks?.map(link => ({ ...link })) }));
  const reverseOrder = multiFamilies.map(family => ({ ...family, parentChildLinks: family.parentChildLinks?.map(link => ({ type: link.type, childId: link.childId, parentId: link.parentId })) }));
  assert.equal(multiPlan(["jean", "paul"], "tree-a", multiPeople, firstOrder).fingerprint,
    multiPlan(["jean", "paul"], "tree-a", multiPeople, reverseOrder).fingerprint);
});
