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

// Plusieurs unions triées par date croissante ; partenaires joints par « et ».
{
  const person = { ...BASE, id: "p1", firstName: "Marcelle", lastName: "Dupont" };
  const p2 = { ...BASE, id: "p2", firstName: "Jeanne", lastName: "Duval" };
  const p3 = { ...BASE, id: "p3", firstName: "Marie", lastName: "Blanc" };
  const p4 = { ...BASE, id: "p4", firstName: "Louise", lastName: "Roux" };
  const people = [person, p2, p3, p4];
  const families = [
    { id: "f2", partnerIds: ["p1", "p3", "p4"], childIds: [], relationType: "other", unionDateInfo: { type: "year", year: 1890 } },
    { id: "f1", partnerIds: ["p1", "p2"], childIds: [], relationType: "marriage", unionDateInfo: { type: "year", year: 1875 } }
  ];
  const unions = lifeTimelineEvents(person, { people, families }).filter(event => event.type === "union");
  assert.deepEqual(unions.map(event => event.id), ["union-f1", "union-f2"]);
  assert.equal(unions[1].title, "Autre");
  assert.equal(unions[1].detail, "avec Marie Blanc et Louise Roux");
}

// Personne inconnue dans les familles : les partenaires absents sont ignorés.
{
  const person = { ...BASE, id: "p1", firstName: "Marcelle", lastName: "Dupont" };
  const people = [person];
  const families = [{ id: "f1", partnerIds: ["p1", "p-inconnu"], childIds: [], relationType: "marriage", unionDateInfo: { type: "year", year: 1875 } }];
  const [union] = lifeTimelineEvents(person, { people, families }).filter(event => event.type === "union");
  assert.equal(union.detail, "");
}

console.log("life-timeline : OK");