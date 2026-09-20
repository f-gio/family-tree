import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTreeQuality, QUALITY_CATEGORIES } from "../js/tree-quality.js";

const person = (overrides = {}) => ({
  id: "p1",
  firstName: "Andrea",
  lastName: "Giovannoni",
  birthDateInfo: { type: "exact", value: "1869-09-13" },
  place: "Orino",
  ...overrides
});

function category(result, name) {
  return result.diagnostics.filter(item => item.category === name);
}

test("arbre valide : aucun diagnostic", () => {
  const result = analyzeTreeQuality({ people: [person()], families: [] });
  assert.equal(result.total, 0);
});

test("informations à compléter : champs essentiels absents avec propriété field", () => {
  const result = analyzeTreeQuality({ people: [person({ firstName: "", lastName: "", birthDateInfo: { type: "unknown" }, place: "" })] });
  const missing = category(result, QUALITY_CATEGORIES.missing);
  assert.equal(missing.length, 4);
  missing.forEach(item => {
    assert.equal(item.category, "missing");
    assert.ok(item.field, "propriété field manquante");
    assert.ok(["firstName", "lastName", "birthDate", "birthPlace"].includes(item.field), `field invalide: ${item.field}`);
  });
});

test("décès explicite avec données incomplètes", () => {
  const result = analyzeTreeQuality({ people: [person({ deathDateInfo: { type: "year", year: 1930 }, deathPlace: "" })] });
  const missing = category(result, QUALITY_CATEGORIES.missing);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].field, "deathPlace");
});

test("ordre déterministe des champs manquants", () => {
  const result = analyzeTreeQuality({ people: [person({ firstName: "", lastName: "", birthDateInfo: { type: "unknown" }, place: "" })] });
  const fields = category(result, QUALITY_CATEGORIES.missing).map(item => item.field);
  const sorted = [...fields].sort((a, b) => ["firstName", "lastName", "birthDate", "birthPlace", "deathDate", "deathPlace"].indexOf(a) - ["firstName", "lastName", "birthDate", "birthPlace", "deathDate", "deathPlace"].indexOf(b));
  assert.deepEqual(fields, sorted);
});

test("le message ne détermine pas le champ (anti-parsing)", () => {
  const result = analyzeTreeQuality({ people: [person({ firstName: "" })] });
  const diagnostic = category(result, QUALITY_CATEGORIES.missing)[0];
  diagnostic.message = "Texte totalement différent sans rapport";
  assert.equal(diagnostic.field, "firstName", "field doit rester inchangé même si message modifié");
});

test("naissance certaine postérieure au décès : diagnostic", () => {
  const result = analyzeTreeQuality({ people: [person({ birthDateInfo: { type: "exact", value: "1900-01-01" }, deathDateInfo: { type: "exact", value: "1890-01-01" } })] });
  assert.equal(category(result, QUALITY_CATEGORIES.chronology).length, 1);
});

test("dates approximatives compatibles : aucun faux positif chronologique", () => {
  const result = analyzeTreeQuality({ people: [person({ birthDateInfo: { type: "about", year: 1900 }, deathDateInfo: { type: "about", year: 1900 } })] });
  assert.equal(category(result, QUALITY_CATEGORIES.chronology).length, 0);
});

test("dates between compatibles : aucun faux positif chronologique", () => {
  const result = analyzeTreeQuality({ people: [person({ birthDateInfo: { type: "between", from: 1890, to: 1900 }, deathDateInfo: { type: "between", from: 1900, to: 1910 } })] });
  assert.equal(category(result, QUALITY_CATEGORIES.chronology).length, 0);
});

test("dates unknown : aucun faux positif chronologique", () => {
  const result = analyzeTreeQuality({ people: [person({ birthDateInfo: { type: "unknown" }, deathDateInfo: { type: "unknown" } })] });
  assert.equal(category(result, QUALITY_CATEGORIES.chronology).length, 0);
});

test("union certaine avant naissance : diagnostic", () => {
  const result = analyzeTreeQuality({
    people: [person({ birthDateInfo: { type: "exact", value: "1900-01-01" } })],
    families: [{ id: "f1", partnerIds: ["p1"], childIds: [], unionDateInfo: { type: "exact", value: "1890-01-01" } }]
  });
  assert.equal(category(result, QUALITY_CATEGORIES.chronology).length, 1);
});

test("union certaine après décès : diagnostic", () => {
  const result = analyzeTreeQuality({
    people: [person({ deathDateInfo: { type: "exact", value: "1900-01-01" } })],
    families: [{ id: "f1", partnerIds: ["p1"], childIds: [], unionDateInfo: { type: "exact", value: "1910-01-01" } }]
  });
  assert.equal(category(result, QUALITY_CATEGORIES.chronology).length, 1);
});

test("doublon potentiel exact/date complète avec lieu", () => {
  const result = analyzeTreeQuality({ people: [person({ id: "a" }), person({ id: "b" })] });
  assert.equal(category(result, QUALITY_CATEGORIES.duplicates).length, 1);
  assert.deepEqual(category(result, QUALITY_CATEGORIES.duplicates)[0].peopleIds, ["a", "b"]);
});

test("doublon potentiel exact + année compatible", () => {
  const result = analyzeTreeQuality({ people: [person({ id: "a" }), person({ id: "b", birthDateInfo: { type: "year", year: 1869 }, place: "Orino" })] });
  assert.equal(category(result, QUALITY_CATEGORIES.duplicates).length, 1);
});

test("homonymes avec dates incompatibles : aucun doublon", () => {
  const result = analyzeTreeQuality({ people: [person({ id: "a" }), person({ id: "b", birthDateInfo: { type: "exact", value: "1900-01-01" }, place: "Orino" })] });
  assert.equal(category(result, QUALITY_CATEGORIES.duplicates).length, 0);
});

test("nom seul avec dates inconnues : aucun doublon", () => {
  const result = analyzeTreeQuality({ people: [person({ id: "a", birthDateInfo: { type: "unknown" }, place: "" }), person({ id: "b", birthDateInfo: { type: "unknown" }, place: "" })] });
  assert.equal(category(result, QUALITY_CATEGORIES.duplicates).length, 0);
});

test("relations : références orphelines et rôle partenaire/enfant", () => {
  const result = analyzeTreeQuality({
    people: [person()],
    families: [{ id: "f1", partnerIds: ["p1", "missing"], childIds: ["p1"], parentChildLinks: [{ parentId: "missing", childId: "p1" }] }]
  });
  assert.ok(category(result, QUALITY_CATEGORIES.relations).length >= 2);
});

test("legacy : dates en chaînes acceptées et résultat non mutatif", () => {
  const legacyPeople = [{ id: "p1", firstName: "Andrea", lastName: "Giovannoni", birthDate: "1869-09-13", place: "Orino" }];
  const before = JSON.stringify(legacyPeople);
  const result = analyzeTreeQuality({ people: legacyPeople, families: [] });
  assert.equal(result.total, 0);
  assert.equal(JSON.stringify(legacyPeople), before);
});

test("aucune mutation des personnes ou familles", () => {
  const people = [person()];
  const families = [{ id: "f1", partnerIds: ["p1"], childIds: [] }];
  const beforePeople = JSON.stringify(people), beforeFamilies = JSON.stringify(families);
  analyzeTreeQuality({ people, families });
  assert.equal(JSON.stringify(people), beforePeople);
  assert.equal(JSON.stringify(families), beforeFamilies);
});

console.log("Tree quality : tests terminés");
