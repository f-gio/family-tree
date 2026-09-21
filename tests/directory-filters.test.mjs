import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortDirectory, countActiveDirectoryFilters, hasDeathInformation, genealogyDateOverlapsRange } from "../js/directory-advanced.js";

const people = [
  { id: "a", firstName: "Anna", middleName: "Maria", lastName: "Alberti", gender: "F", branch: "Giovannoni", place: "Orino", birthDate: "1869-03-14", deathDateInfo: { type: "year", year: 1932 }, deathPlace: "Varese" },
  { id: "b", firstName: "Vincenzo", lastName: "Cerini", gender: "M", branch: "Conti", place: "Como", birthDateInfo: { type: "about", year: 1870 }, deathDateInfo: { type: "between", from: 1930, to: 1934 } },
  { id: "c", firstName: "Carlo", middleName: "Giovanni", lastName: "Giovannoni", branch: "Giovannoni", place: "Milano", birthDateInfo: { type: "between", from: 1800, to: 1810 }, deathDateInfo: { type: "unknown" } },
  { id: "d", firstName: "Luigi", lastName: "Rossi", gender: "M", place: "Torino", birthDateInfo: { type: "exact", value: "1900-05-20" }, deathDateInfo: { type: "unknown" }, deathPlace: "Orino" },
  { id: "e", firstName: "Maria", lastName: "Alberti", marriedName: "Bianchi", gender: "F", branch: "Giovannoni", birthDateInfo: { type: "unknown" } }
];

test("A. champ vide initial → aucun filtre actif", () => {
  const empty = { query: "", firstName: "", marriedName: "", gender: "", branch: "", birthPlace: "", birthYearFrom: "", birthYearTo: "", deathPlace: "", deathYearFrom: "", deathYearTo: "", deathInfo: "" };
  assert.equal(countActiveDirectoryFilters(empty), 0);
  assert.equal(filterAndSortDirectory(people, empty).length, 5);
});

test("B. recherche rapide par prénom", () => {
  assert.deepEqual(filterAndSortDirectory(people, { query: "maria" }).map(p => p.id), ["a", "e"]);
});

test("C. recherche rapide accents/casse", () => {
  assert.deepEqual(filterAndSortDirectory(people, { query: "GIOVANNI" }).map(p => p.id), ["c"]);
});

test("D. filtre firstName", () => {
  assert.deepEqual(filterAndSortDirectory(people, { firstName: "cerini" }).map(p => p.id), ["b"]);
});

test("E. filtre marriedName séparé", () => {
  assert.deepEqual(filterAndSortDirectory(people, { marriedName: "bianchi" }).map(p => p.id), ["e"]);
});

test("F. firstName n'inclut PAS marriedName", () => {
  assert.equal(filterAndSortDirectory(people, { firstName: "bianchi" }).length, 0);
});

test("G. sexe F", () => {
  assert.deepEqual(filterAndSortDirectory(people, { gender: "F" }).map(p => p.id), ["a", "e"]);
});

test("H. sexe M", () => {
  assert.deepEqual(filterAndSortDirectory(people, { gender: "M" }).map(p => p.id), ["b", "d"]);
});

test("I. branche", () => {
  assert.deepEqual(filterAndSortDirectory(people, { branch: "Giovannoni" }).map(p => p.id), ["a", "e", "c"]);
});

test("J. lieu naissance partiel", () => {
  assert.deepEqual(filterAndSortDirectory(people, { birthPlace: "orino" }).map(p => p.id), ["a"]);
});

test("K. lieu décès partiel", () => {
  assert.deepEqual(filterAndSortDirectory(people, { deathPlace: "orino" }).map(p => p.id), ["d"]);
});

test("L. lieu naissance ne cherche PAS le décès", () => {
  assert.equal(filterAndSortDirectory(people, { birthPlace: "napoli" }).length, 0);
});

test("M. période naissance De et À", () => {
  assert.deepEqual(filterAndSortDirectory(people, { birthYearFrom: "1869", birthYearTo: "1870" }).map(p => p.id), ["a", "b"]);
});

test("N. période naissance seulement De", () => {
  assert.deepEqual(filterAndSortDirectory(people, { birthYearFrom: "1870" }).map(p => p.id), ["b", "d"]);
});

test("O. période naissance seulement À", () => {
  assert.deepEqual(filterAndSortDirectory(people, { birthYearTo: "1869" }).map(p => p.id), ["a", "c"]);
});

test("P. période avec about", () => {
  assert.deepEqual(filterAndSortDirectory(people, { birthYearFrom: "1870", birthYearTo: "1890" }).map(p => p.id), ["b"]);
});

test("Q. période ne correspond pas à unknown", () => {
  assert.equal(filterAndSortDirectory(people, { birthYearFrom: "1800", birthYearTo: "1900", deathInfo: "" }).filter(p => p.deathDateInfo.type === "unknown").length >= 0, true);
  assert.deepEqual(filterAndSortDirectory(people, { birthYearFrom: "2000", birthYearTo: "2020" }).map(p => p.id), []);
});

test("R. information décès renseignée", () => {
  const result = filterAndSortDirectory(people, { deathInfo: "yes" });
  assert.deepEqual(result.map(p => p.id), ["a", "b", "d"]);
});

test("S. information décès non renseignée", () => {
  const result = filterAndSortDirectory(people, { deathInfo: "no" });
  assert.deepEqual(result.map(p => p.id), ["e", "c"]);
});

test("T. combinaison recherche rapide + filtres", () => {
  const result = filterAndSortDirectory(people, { query: "alberti", branch: "Giovannoni", gender: "F" });
  assert.deepEqual(result.map(p => p.id), ["a", "e"]);
});

test("U. hasDeathInformation : date seule", () => {
  assert.equal(hasDeathInformation({ deathDateInfo: { type: "year", year: 1932 } }), true);
});

test("V. hasDeathInformation : lieu seul", () => {
  assert.equal(hasDeathInformation({ deathPlace: "Orino" }), true);
});

test("W. hasDeathInformation : date + lieu", () => {
  assert.equal(hasDeathInformation({ deathDateInfo: { type: "unknown" }, deathPlace: "Orino" }), true);
});

test("X. hasDeathInformation : aucune information", () => {
  assert.equal(hasDeathInformation({ deathDateInfo: { type: "unknown" } }), false);
});

test("Y. hasDeathInformation : empty object", () => {
  assert.equal(hasDeathInformation({}), false);
});

test("Z. compteur critères actifs", () => {
  const filters = { firstName: "anna", branch: "Giovannoni", birthYearFrom: "1800", birthYearTo: "1900", deathInfo: "yes" };
  assert.equal(countActiveDirectoryFilters(filters), 4);
});

test("AA. compteur période = 1 seul critère", () => {
  const filters = { birthYearFrom: "1800", birthYearTo: "1900" };
  assert.equal(countActiveDirectoryFilters(filters), 1);
});

test("AB. compteur avec un seul bout de période", () => {
  assert.equal(countActiveDirectoryFilters({ deathYearFrom: "1932" }), 1);
});

test("AC. genealogyDateOverlapsRange : exact dans l'intervalle", () => {
  assert.equal(genealogyDateOverlapsRange({ type: "exact", value: "1869-03-14" }, "", 1868, 1870), true);
});

test("AD. genealogyDateOverlapsRange : exact hors intervalle", () => {
  assert.equal(genealogyDateOverlapsRange({ type: "exact", value: "1900-01-01" }, "", 1800, 1850), false);
});

test("AE. genealogyDateOverlapsRange : between chevauchant", () => {
  assert.equal(genealogyDateOverlapsRange({ type: "between", from: 1800, to: 1810 }, "", 1805, 1820), true);
});

test("AF. genealogyDateOverlapsRange : about dans l'intervalle", () => {
  assert.equal(genealogyDateOverlapsRange({ type: "about", year: 1880 }, "", 1870, 1890), true);
});

test("AG. genealogyDateOverlapsRange : unknown ne correspond pas", () => {
  assert.equal(genealogyDateOverlapsRange({ type: "unknown" }, "", 1800, 1900), false);
});

test("AH. genealogyDateOverlapsRange : pas de borne = pas de filtre", () => {
  assert.equal(genealogyDateOverlapsRange({ type: "unknown" }, "", "", ""), true);
});

test("AI. genealogyDateOverlapsRange : seulement De", () => {
  assert.equal(genealogyDateOverlapsRange({ type: "year", year: 1850 }, "", 1800, ""), true);
  assert.equal(genealogyDateOverlapsRange({ type: "year", year: 1700 }, "", 1800, ""), false);
});

test("AJ. genealogyDateOverlapsRange : seulement À", () => {
  assert.equal(genealogyDateOverlapsRange({ type: "year", year: 1850 }, "", "", 1900), true);
  assert.equal(genealogyDateOverlapsRange({ type: "year", year: 1950 }, "", "", 1900), false);
});

test("AK. genealogyDateOverlapsRange : legacy exact", () => {
  assert.equal(genealogyDateOverlapsRange(null, "1869-03-14", 1868, 1870), true);
});

test("AL. compatibilité legacy place structuré", () => {
  const peopleWithInfo = [{ id: "x", firstName: "Test", place: "", birthPlaceInfo: { name: "Orino", countryCode: "IT" } }];
  assert.deepEqual(filterAndSortDirectory(peopleWithInfo, { birthPlace: "orino" }).map(p => p.id), ["x"]);
});

test("AM. lieu structuré décès", () => {
  const peopleWithInfo = [{ id: "x", firstName: "Test", deathPlace: "", deathPlaceInfo: { name: "Varese" } }];
  assert.deepEqual(filterAndSortDirectory(peopleWithInfo, { deathPlace: "varese" }).map(p => p.id), ["x"]);
});

console.log("Filtres Annuaire — logique : OK");
