import assert from "node:assert/strict";
import { lifeTimelineEvents } from "../js/life-timeline.js";

const BASE = { birthDate: "", deathDate: "", place: "", deathPlace: "" };

// Parcours complet : naissance, union, décès, dans l'ordre.
{
  const person = { ...BASE, id: "p1", firstName: "Marcelle", lastName: "Dupont", birthDate: "1850-03-11", place: "Orino", deathDateInfo: { type: "year", year: 1921 } };
  const people = [
    person,
    { id: "p2", firstName: "Jeanne", lastName: "Duval", ...BASE }
  ];
  const families = [
    { id: "f1", partnerIds: ["p1", "p2"], childIds: [], relationType: "marriage", unionDateInfo: { type: "about", year: 1875 }, endType: "divorce", endDateInfo: { type: "year", year: 1895 } }
  ];
  const events = lifeTimelineEvents(person, { people, families });
  assert.deepEqual(events.map(event => event.id), ["birth", "union-f1", "death"]);
  assert.deepEqual(events.map(event => event.type), ["birth", "union", "death"]);
  assert.equal(events[0].title, "Naissance");
  assert.equal(events[0].date, "11 mars 1850");
  assert.equal(events[0].detail, "Orino");
  assert.equal(events[1].title, "Mariage");
  assert.equal(events[1].date, "vers 1875");
  assert.equal(events[1].detail, "avec Jeanne Duval · divorce · 1895");
  assert.equal(events[2].title, "Décès");
  assert.equal(events[2].date, "1921");
}

// Pas de données → aucun jalon ; aucune dépendance DOM à l'import.
{
  assert.deepEqual(lifeTimelineEvents({ id: "p9", firstName: "X", lastName: "Y", ...BASE }, { people: [], families: [] }), []);
  assert.deepEqual(lifeTimelineEvents(null), []);
}

// Union sans fin connue : pas de mention de fin.
{
  const person = { ...BASE, id: "p1", firstName: "Marcelle", lastName: "Dupont", birthDate: "1850-03-11" };
  const people = [person, { ...BASE, id: "p2", firstName: "Jeanne", lastName: "Duval" }];
  const families = [{ id: "f1", partnerIds: ["p1", "p2"], childIds: [], relationType: "partner", unionDateInfo: { type: "year", year: 1880 }, endType: "none" }];
  const [union] = lifeTimelineEvents(person, { people, families }).filter(event => event.type === "union");
  assert.equal(union.title, "Union libre / partenaire");
  assert.equal(union.detail, "avec Jeanne Duval");
}

// Dates legacy : marriageDate, et personne avec seulement la mort.
{
  const person = { ...BASE, id: "p1", firstName: "Marcelle", lastName: "Dupont", marriageDate: "1874-06-02" };
  const people = [person, { ...BASE, id: "p2", firstName: "Jeanne", lastName: "Duval" }];
  const families = [{ id: "f1", partnerIds: ["p1", "p2"], childIds: [], relationType: "marriage", unionDate: "1874-06-02", endDateInfo: null }];
  const events = lifeTimelineEvents(person, { people, families });
  assert.equal(events[0].date, "2 juin 1874");

  const deadOnly = { ...BASE, id: "p3", firstName: "Louis", lastName: "Verdi", deathDate: "1910-08-14", deathPlace: "Milan" };
  const deathEvents = lifeTimelineEvents(deadOnly, { people: [deadOnly], families: [] });
  assert.deepEqual(deathEvents.map(event => event.type), ["death"]);
  assert.equal(deathEvents[0].detail, "Milan");
}

// Plusieurs unions (couples réels) triées par date croissante.
{
  const person = { ...BASE, id: "p1", firstName: "Marcelle", lastName: "Dupont" };
  const p2 = { ...BASE, id: "p2", firstName: "Jeanne", lastName: "Duval" };
  const p3 = { ...BASE, id: "p3", firstName: "Marie", lastName: "Blanc" };
  const people = [person, p2, p3];
  const families = [
    { id: "f2", partnerIds: ["p1", "p3"], childIds: [], relationType: "other", unionDateInfo: { type: "year", year: 1890 } },
    { id: "f1", partnerIds: ["p1", "p2"], childIds: [], relationType: "marriage", unionDateInfo: { type: "year", year: 1875 } }
  ];
  const unions = lifeTimelineEvents(person, { people, families }).filter(event => event.type === "union");
  assert.deepEqual(unions.map(event => event.id), ["union-f1", "union-f2"]);
  assert.equal(unions[1].title, "Autre");
  assert.equal(unions[1].detail, "avec Marie Blanc");
}

// Partenaire sans fiche personne, foyer monoparental ou foyer à plusieurs
// parents : aucun jalon d'union (cohérence avec la notion de couple réel).
{
  const person = { ...BASE, id: "p1", firstName: "Marcelle", lastName: "Dupont" };
  const people = [person, { ...BASE, id: "p7", firstName: "Tiers", lastName: "Existant" }, { ...BASE, id: "p8", firstName: "Tiers", lastName: "Aussi" }];
  const families = [
    { id: "f1", partnerIds: ["p1", "p-inconnu"], childIds: [], relationType: "marriage", unionDateInfo: { type: "year", year: 1875 } },
    { id: "f2", partnerIds: ["p1"], childIds: ["p9"], relationType: "marriage", unionDateInfo: { type: "year", year: 1885 } },
    { id: "f3", partnerIds: ["p1", "p7", "p8"], childIds: ["p9"], relationType: "marriage", unionDateInfo: { type: "year", year: 1895 } }
  ];
  const events = lifeTimelineEvents(person, { people, families });
  assert.deepEqual(events.filter(event => event.type === "union"), []);
}

// Un couple (exactement deux adultes, les deux existants) reste une union.
{
  const person = { ...BASE, id: "p1", firstName: "Marcelle", lastName: "Dupont" };
  const people = [person, { ...BASE, id: "p2", firstName: "Jeanne", lastName: "Duval" }];
  const families = [{ id: "f1", partnerIds: ["p1", "p2"], childIds: [], relationType: "marriage", unionDateInfo: { type: "year", year: 1875 } }];
  const unions = lifeTimelineEvents(person, { people, families }).filter(event => event.type === "union");
  assert.equal(unions.length, 1);
  assert.equal(unions[0].detail, "avec Jeanne Duval");
}

// Non-régression : les unions des parents, enfants, ancêtres ou tiers ne
// doivent JAMAIS apparaître dans la Timeline d'une personne — seul le foyer
// dont la personne est réellement un partenaire compte (A ↔ B).
{
  const c = { ...BASE, id: "A", firstName: "Andrea", lastName: "G.", birthDate: "1869-09-13", place: "Orino", deathDate: "1901-04-02" };
  const mere = { ...BASE, id: "Mere", firstName: "Lucie", lastName: "M." };
  const pere = { ...BASE, id: "Pere", firstName: "Dionigi", lastName: "P." };
  const parentSeul = { ...BASE, id: "ParentSeul", firstName: "Giacinta", lastName: "P." };
  const b = { ...BASE, id: "B", firstName: "Teresa", lastName: "P." };
  const enfant1 = { ...BASE, id: "C1", firstName: "Enfant", lastName: "Un" };
  const conjointC1 = { ...BASE, id: "C1S", firstName: "Jean", lastName: "Un" };
  const enfant2 = { ...BASE, id: "C2", firstName: "Enfant", lastName: "Deux" };
  const x = { ...BASE, id: "X", firstName: "Marco", lastName: "X." };
  const y = { ...BASE, id: "Y", firstName: "Jeanne", lastName: "Y." };
  const z = { ...BASE, id: "Z", firstName: "Anna", lastName: "Z." };
  const people = [c, mere, pere, parentSeul, b, enfant1, conjointC1, enfant2, x, y, z];
  const families = [
    { id: "F_parents", partnerIds: ["Mere", "Pere"], childIds: ["A"], relationType: "marriage", unionDateInfo: { type: "year", year: 1890 } },
    { id: "F_monoparental", partnerIds: ["ParentSeul"], childIds: ["A"], relationType: "marriage", unionDateInfo: { type: "year", year: 1895 } },
    { id: "F_AB", partnerIds: ["A", "B"], childIds: ["C1", "C2"], relationType: "marriage", unionDateInfo: { type: "year", year: 1898 } },
    { id: "F_C1", partnerIds: ["C1", "C1S"], childIds: [], relationType: "partner", unionDateInfo: { type: "year", year: 1920 } },
    { id: "F_XY", partnerIds: ["X", "Y"], childIds: [], relationType: "marriage", unionDateInfo: { type: "year", year: 1910 } },
    { id: "F_XZ", partnerIds: ["X", "Z"], childIds: [], relationType: "civil", unionDateInfo: { type: "year", year: 1930 } }
  ];
  const events = lifeTimelineEvents(c, { people, families });
  assert.deepEqual(events.map(event => event.id), ["birth", "union-F_AB", "death"]);
  assert.equal(events[1].title, "Mariage");
  assert.equal(events[1].detail, "avec Teresa P.");
  const leakIds = ["union-F_parents", "union-F_monoparental", "union-F_C1", "union-F_XY", "union-F_XZ"];
  for (const id of leakIds) {
    assert.ok(!events.some(event => event.id === id), `union ${id} ne doit pas apparaître`);
  }
  // Le foyer monoparental où A est enfant ne crée pas « Union avec Giacinta P. ».
  assert.ok(!events.some(event => event.type === "union" && event.detail.includes("Giacinta")), "le parent seul ne doit pas devenir un conjoint");

  // X a plusieurs unions réelles : toutes doivent rester affichées.
  const xEvents = lifeTimelineEvents(x, { people, families });
  assert.deepEqual(xEvents.map(event => event.id), ["union-F_XY", "union-F_XZ"]);
  assert.equal(xEvents[0].title, "Mariage");
  assert.equal(xEvents[1].title, "PACS / union civile");
}

console.log("life-timeline : OK");