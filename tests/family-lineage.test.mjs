import test from "node:test";
import assert from "node:assert/strict";
import {
  LINEAGE_SURNAMES,
  normalizeLineageName,
  lineageBirthYear,
  findLineageRoots,
  resolveLineage,
  computeLineageScope
} from "../js/family-lineage.js";

const people = [
  { id: "Groot", firstName: "Carlo", lastName: "Giovannoni" },
  { id: "Gspouse", firstName: "Angelina", lastName: "" },
  { id: "Gchild", firstName: "Andrea", lastName: "Giovannoni", birthDate: "1950" },
  { id: "Gwife", firstName: "Teresa", lastName: "Pianezza", marriedName: "Giovannoni" },
  { id: "Pfather", firstName: "Bartolomeo", lastName: "Pianezza" },
  { id: "Pother", firstName: "Giulia", lastName: "Pianezza" },
  { id: "Ggrand", firstName: "Luca", lastName: "Giovannoni" },
  { id: "Gex", firstName: "Ex", lastName: "Dupont" }
];

const families = [
  { id: "f_root", partnerIds: ["Groot", "Gspouse"], childIds: ["Gchild"] },
  { id: "f_child", partnerIds: ["Gchild", "Gwife"], childIds: ["Ggrand"] },
  { id: "f_p", partnerIds: ["Pfather"], childIds: ["Gwife"] },
  { id: "f_other", partnerIds: ["Pother"], childIds: [] },
  { id: "f_orphan", partnerIds: ["Gchild", "Gex"], childIds: [] }
];

const idsOf = result => new Set(result.people.map(item => item.id));

test("A. liste des patronymes configurable, sans identifiant de personne", () => {
  assert.deepEqual(LINEAGE_SURNAMES, ["Giovannoni", "Conti", "Pianezza", "Paglia", "Piolini"]);
  for (const surname of LINEAGE_SURNAMES) assert.equal(normalizeLineageName(surname), surname.toLowerCase());
});

test("B. normalisation insensible aux accents et à la casse", () => {
  assert.equal(normalizeLineageName("  GIOVANNONI "), "giovannoni");
  assert.equal(normalizeLineageName("Paglià"), "paglia");
  assert.equal(normalizeLineageName(""), "");
});

test("C. racine = plus ancien sans ancêtre portant le même nom de naissance", () => {
  const { rootGroups } = findLineageRoots({ people, families, surname: "Giovannoni" });
  assert.equal(rootGroups.length, 1);
  assert.deepEqual(rootGroups[0].rootIds, ["Groot"]);
});

test("D. un ancêtre sans date reste racine face à un descendant daté", () => {
  assert.equal(lineageBirthYear({ birthDate: "1950" }), 1950);
  assert.equal(lineageBirthYear({ birthDateInfo: { type: "year", year: 1899 } }), 1899);
  assert.equal(lineageBirthYear({ birthDateInfo: { type: "unknown" } }), null);
  const roots = findLineageRoots({ people, families, surname: "Giovannoni" }).rootGroups;
  assert.equal(roots[0].rootIds[0], "Groot");
});

test("E. marriedName ne détermine jamais l'appartenance à la lignée", () => {
  const { rootGroups } = findLineageRoots({ people, families, surname: "Giovannoni" });
  for (const group of rootGroups) assert.ok(!group.rootIds.includes("Gwife"));
  const scope = computeLineageScope({ people, families, surname: "Giovannoni" });
  assert.ok(idsOf(scope).has("Gwife"), "Teresa apparaît comme conjointe nécessaire");
});

test("F. conjoints affichés mais ascendance des conjoints exclue", () => {
  const scope = computeLineageScope({ people, families, surname: "Giovannoni" });
  const ids = idsOf(scope);
  for (const id of ["Groot", "Gspouse", "Gchild", "Gwife", "Ggrand"]) assert.ok(ids.has(id), `${id} attendu`);
  assert.ok(!ids.has("Pfather"), "les parents Pianezza de Teresa ne sont pas importés");
});

test("G. unions orphelines écartées, couple sans enfant conservé", () => {
  const scope = computeLineageScope({ people, families, surname: "Giovannoni" });
  assert.ok(!scope.families.some(family => family.id === "f_orphan"), "union sans enfant visible exclue");
  const childless = { id: "f_childless", partnerIds: ["Groot", "Gspouse"], childIds: [] };
  const withCouple = computeLineageScope({ people, families: [...families, childless], surname: "Giovannoni" });
  assert.ok(withCouple.families.some(family => family.id === "f_childless"), "couple à 2 partenaires conservé");
});

test("H. co-racines conjointes regroupées (X + Y Paglia)", () => {
  const pagliaPeople = [
    { id: "PX", firstName: "X", lastName: "Paglia" },
    { id: "PY", firstName: "Y", lastName: "Paglia" },
    { id: "PC", firstName: "Enfant", lastName: "Paglia" }
  ];
  const pagliaFamilies = [{ id: "f_pag", partnerIds: ["PX", "PY"], childIds: ["PC"] }];
  const { rootGroups } = findLineageRoots({ people: pagliaPeople, families: pagliaFamilies, surname: "Paglia" });
  assert.equal(rootGroups.length, 1);
  assert.deepEqual([...rootGroups[0].rootIds].sort(), ["PX", "PY"]);
  const scope = computeLineageScope({ people: pagliaPeople, families: pagliaFamilies, surname: "Paglia" });
  assert.deepEqual([...scope.rootIds].sort(), ["PX", "PY"]);
  for (const id of ["PX", "PY", "PC"]) assert.ok(idsOf(scope).has(id), `${id} visible`);
});

test("I. lignées réellement déconnectées : groupes distincts, jamais fusionnés", () => {
  const splitPeople = [
    { id: "A1", lastName: "Conti" }, { id: "A2", lastName: "Conti" },
    { id: "B1", lastName: "Conti" }, { id: "B2", lastName: "Conti" }
  ];
  const splitFamilies = [
    { id: "fa1", partnerIds: ["A1"], childIds: ["A2"] },
    { id: "fb1", partnerIds: ["B1"], childIds: ["B2"] }
  ];
  const { rootGroups } = findLineageRoots({ people: splitPeople, families: splitFamilies, surname: "Conti" });
  assert.equal(rootGroups.length, 2);
  assert.equal(resolveLineage({ people: splitPeople, families: splitFamilies, surname: "Conti" }).rootId, "A1");
});

test("J. patronyme inconnu : aucune portée", () => {
  assert.equal(computeLineageScope({ people, families, surname: "Introuvable" }), null);
  assert.equal(computeLineageScope({ people, families, surname: "" }), null);
  assert.equal(resolveLineage({ people, families, surname: "Introuvable" }), null);
});

test("K. Pianezza : la racine sans descendance n'est pas retenue face à l'ascendance réelle", () => {
  const lineage = resolveLineage({ people, families, surname: "Pianezza" });
  assert.equal(lineage.rootId, "Pfather");
  const scope = computeLineageScope({ people, families, surname: "Pianezza" });
  const ids = idsOf(scope);
  for (const id of ["Pfather", "Gwife", "Gchild", "Ggrand"]) assert.ok(ids.has(id), `${id} attendu`);
  assert.ok(!ids.has("Pother"), "lignée indépendante non fusionnée");
  assert.ok(!ids.has("Groot"), "ascendance du conjoint non déroulée");
});

test("L. aucune mutation des people/families d'entrée", () => {
  const snapshot = JSON.stringify({ people, families });
  computeLineageScope({ people, families, surname: "Giovannoni" });
  computeLineageScope({ people, families, surname: "Pianezza" });
  findLineageRoots({ people, families, surname: "Paglia" });
  assert.equal(JSON.stringify({ people, families }), snapshot);
});

test("M. déterminisme de la portée", () => {
  const first = computeLineageScope({ people, families, surname: "Giovannoni" });
  const second = computeLineageScope({ people, families, surname: "Giovannoni" });
  assert.deepEqual([...first.visibleIds].sort(), [...second.visibleIds].sort());
  assert.equal(first.rootId, second.rootId);
  assert.equal(first.hiddenAncestorCounts.size, 0);
});

console.log("Filtre de branche familiale (module pur) : OK");
