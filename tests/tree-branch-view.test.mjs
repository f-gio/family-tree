import test from "node:test";
import assert from "node:assert/strict";
import { computeBranchView, DEFAULT_ANCESTOR_DEPTH, ALL_ANCESTORS } from "../js/tree-branch-view.js";

const people = [
  { id: "R", firstName: "Racine", lastName: "Test" },
  { id: "P1", firstName: "Père", lastName: "Test" },
  { id: "P2", firstName: "Mère", lastName: "Test" },
  { id: "GP1", firstName: "Grand-père 1", lastName: "Test" },
  { id: "GP2", firstName: "Grand-mère 1", lastName: "Test" },
  { id: "GP3", firstName: "Grand-père 2", lastName: "Test" },
  { id: "GP4", firstName: "Grand-mère 2", lastName: "Test" },
  { id: "GGP1", firstName: "Arrière-grand-père", lastName: "Test" },
  { id: "GGP2", firstName: "Arrière-grand-mère", lastName: "Test" },
  { id: "S", firstName: "Conjoint", lastName: "Test" },
  { id: "C1", firstName: "Enfant 1", lastName: "Test" },
  { id: "C2", firstName: "Enfant 2", lastName: "Test" },
  { id: "C1S", firstName: "Conjoint enfant", lastName: "Test" },
  { id: "GC1", firstName: "Petit-enfant 1", lastName: "Test" },
  { id: "GC2", firstName: "Petit-enfant 2", lastName: "Test" },
  { id: "U", firstName: "Oncle", lastName: "Test" },
  { id: "UX", firstName: "Tante", lastName: "Test" },
  { id: "Cousin", firstName: "Cousin", lastName: "Test" },
  { id: "SP", firstName: "Parent conjoint", lastName: "Test" },
  { id: "SPX", firstName: "Autre parent conjoint", lastName: "Test" },
  { id: "X", firstName: "Ancien conjoint", lastName: "Test" },
  { id: "SChild", firstName: "Enfant du conjoint", lastName: "Test" }
];

const families = [
  { id: "f_parents", partnerIds: ["P1", "P2"], childIds: ["R", "U"] },
  { id: "f_gp1", partnerIds: ["GP1", "GP2"], childIds: ["P1"] },
  { id: "f_gp2", partnerIds: ["GP3", "GP4"], childIds: ["P2"] },
  { id: "f_ggp", partnerIds: ["GGP1", "GGP2"], childIds: ["GP1"] },
  { id: "f_root", partnerIds: ["R", "S"], childIds: ["C1", "C2"] },
  { id: "f_c1", partnerIds: ["C1", "C1S"], childIds: ["GC1"] },
  { id: "f_c2", partnerIds: ["C2"], childIds: ["GC2"] },
  { id: "f_u", partnerIds: ["U", "UX"], childIds: ["Cousin"] },
  { id: "f_sp", partnerIds: ["SP", "SPX"], childIds: ["S"] },
  { id: "f_s_other", partnerIds: ["S", "X"], childIds: ["SChild"] }
];

const analyze = depth => computeBranchView({ people, families, rootId: "R", ancestorDepth: depth });
const idsOf = result => new Set(result.people.map(item => item.id));

test("A. profondeur 1 : uniquement les parents nécessaires", () => {
  const ids = idsOf(analyze(1));
  for (const id of ["R", "P1", "P2", "S", "C1", "C2", "C1S", "GC1", "GC2"]) assert.ok(ids.has(id), `${id} attendu`);
  for (const id of ["GP1", "GP2", "GP3", "GP4", "GGP1", "GGP2"]) assert.ok(!ids.has(id), `${id} exclu (au-delà de la profondeur)`);
  const frontier = analyze(1).hiddenAncestorCounts;
  assert.equal(frontier.get("P1"), 4);
  assert.equal(frontier.get("P2"), 2);
});

test("B. profondeur 3 : parents, grands-parents et arrière-grands-parents", () => {
  const ids = idsOf(analyze(3));
  for (const id of ["P1", "P2", "GP1", "GP2", "GP3", "GP4", "GGP1", "GGP2"]) assert.ok(ids.has(id), `${id} attendu`);
  assert.equal(DEFAULT_ANCESTOR_DEPTH, 3);
  assert.equal(analyze(undefined).hiddenAncestorCounts.size, 0);
  assert.equal(idsOf(analyze(2)).has("GGP1"), false);
});

test("C. Tous : toute l'ascendance disponible", () => {
  const ids = idsOf(analyze(ALL_ANCESTORS));
  for (const id of ["P1", "P2", "GP1", "GP2", "GP3", "GP4", "GGP1", "GGP2"]) assert.ok(ids.has(id), `${id} attendu`);
  assert.equal(analyze(ALL_ANCESTORS).hiddenAncestorCounts.size, 0);
});

test("D. toute la descendance de R est conservée", () => {
  for (const depth of [1, 2, 3, ALL_ANCESTORS]) {
    const ids = idsOf(analyze(depth));
    for (const id of ["C1", "C2", "GC1", "GC2"]) assert.ok(ids.has(id), `${id} attendu (descendance illimitée)`);
  }
});

test("E. conjoint nécessaire à une filiation visible conservé, famille du conjoint exclue", () => {
  const ids = idsOf(analyze(1));
  assert.ok(ids.has("S"), "le conjoint de la racine est visible");
  assert.ok(ids.has("C1S"), "le co-parent d'un petit-enfant est visible");
  assert.ok(!ids.has("SP") && !ids.has("SPX"), "les parents du conjoint ne sont pas importés");
  assert.ok(!ids.has("X") && !ids.has("SChild"), "l'union antérieure du conjoint n'est pas importée");
});

test("F. branche collatérale non pertinente non développée", () => {
  for (const depth of [1, 2, 3, ALL_ANCESTORS]) {
    const ids = idsOf(analyze(depth));
    for (const id of ["U", "UX", "Cousin"]) assert.ok(!ids.has(id), `${id} exclu (fratrie/demi-fratrie non pertinente)`);
  }
});

test("G. aucune mutation des people/families d'entrée", () => {
  const snapshot = JSON.stringify({ people, families });
  analyze(3);
  analyze(1);
  analyze(ALL_ANCESTORS);
  assert.equal(JSON.stringify({ people, families }), snapshot);
});

test("H. filtre désactivé : ensemble initial restitué", () => {
  const result = computeBranchView({ people, families, rootId: null });
  assert.equal(result.people.length, people.length);
  assert.equal(result.families.length, families.length);
  assert.deepEqual(result.people, people);
  assert.equal(result.visibleIds.size, people.length);
  assert.equal(result.hiddenAncestorCounts.size, 0);
  const unknown = computeBranchView({ people, families, rootId: "inconnu" });
  assert.equal(unknown.people.length, people.length);
});

test("I. les familles renvoyées ne concernent que des personnes visibles", () => {
  const result = analyze(1);
  const visible = new Set(result.people.map(item => item.id));
  for (const family of result.families) {
    const touches = [...(family.partnerIds || []), ...(family.childIds || [])];
    assert.ok(touches.some(id => visible.has(id)), `famille ${family.id} sans membre visible`);
  }
});

test("J. chaîne de 5 niveaux : ensembles strictement croissants 1 ⊂ 2 ⊂ 3 ⊂ Tous", () => {
  const chain = [
    { id: "P", firstName: "Personne" },
    { id: "Parent", firstName: "Parent" },
    { id: "GrandParent", firstName: "Grand-parent" },
    { id: "ArriereGrandParent", firstName: "Arrière-grand-parent" },
    { id: "ArriereArriereGrandParent", firstName: "Arrière-arrière-grand-parent" }
  ];
  const chainFamilies = [
    { id: "c1", partnerIds: ["Parent"], childIds: ["P"] },
    { id: "c2", partnerIds: ["GrandParent"], childIds: ["Parent"] },
    { id: "c3", partnerIds: ["ArriereGrandParent"], childIds: ["GrandParent"] },
    { id: "c4", partnerIds: ["ArriereArriereGrandParent"], childIds: ["ArriereGrandParent"] }
  ];
  const view = depth => computeBranchView({ people: chain, families: chainFamilies, rootId: "P", ancestorDepth: depth });
  const v1 = view(1), v2 = view(2), v3 = view(3), vAll = view(ALL_ANCESTORS);

  assert.deepEqual([...v1.visibleIds].sort(), ["P", "Parent"]);
  assert.deepEqual([...v2.visibleIds].sort(), ["GrandParent", "P", "Parent"]);
  assert.deepEqual([...v3.visibleIds].sort(), ["ArriereGrandParent", "GrandParent", "P", "Parent"]);
  assert.deepEqual([...vAll.visibleIds].sort(), ["ArriereArriereGrandParent", "ArriereGrandParent", "GrandParent", "P", "Parent"]);

  const strictlyIncreasing = (small, large) =>
    small.visibleIds.size < large.visibleIds.size &&
    [...small.visibleIds].every(id => large.visibleIds.has(id));
  assert.ok(strictlyIncreasing(v1, v2), "1 doit être un sous-ensemble STRICT de 2");
  assert.ok(strictlyIncreasing(v2, v3), "2 doit être un sous-ensemble STRICT de 3");
  assert.ok(strictlyIncreasing(v3, vAll), "3 doit être un sous-ensemble STRICT de Tous");

  assert.equal(v1.hiddenAncestorCounts.get("Parent"), 3);
  assert.equal(v2.hiddenAncestorCounts.get("GrandParent"), 2);
  assert.equal(v3.hiddenAncestorCounts.get("ArriereGrandParent"), 1);
  assert.equal(vAll.hiddenAncestorCounts.size, 0);

  console.log(`[J] tailles 1=${v1.visibleIds.size} 2=${v2.visibleIds.size} 3=${v3.visibleIds.size} Tous=${vAll.visibleIds.size}`);
  console.log(`[J] 1 = ${[...v1.visibleIds].sort().join(", ")}`);
  console.log(`[J] 2 = ${[...v2.visibleIds].sort().join(", ")}`);
  console.log(`[J] 3 = ${[...v3.visibleIds].sort().join(", ")}`);
  console.log(`[J] Tous = ${[...vAll.visibleIds].sort().join(", ")}`);
});

console.log("Filtre « Voir la branche » : OK");
