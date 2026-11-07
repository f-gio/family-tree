import test from "node:test";
import assert from "node:assert/strict";
import {
  LIFE_DATE_TYPES,
  LIFE_EVENT_KINDS,
  lifeEventKindLabel,
  normalizeLifeDate,
  formatLifeDate,
  lifeDateSortValue,
  buildLifeDate,
  personLifeList,
  lifeAttestations,
  validateLifeResidence,
  validateLifeProfession,
  validateLifeEvent,
  validateLifeAttestation,
  hasSimilarLifeAttestation,
  toggleIdInList,
  compareLifeEntries
} from "../js/life-journey.js";

test("types de date et types d'événement", () => {
  assert.deepEqual([...LIFE_DATE_TYPES], ["exact", "year", "about", "before", "after", "attested", "between", "unknown"]);
  assert.deepEqual([...LIFE_EVENT_KINDS], ["census", "migration", "military", "studies", "other"]);
  assert.equal(lifeEventKindLabel("census"), "Recensement");
  assert.equal(lifeEventKindLabel("other"), "Autre événement");
  assert.equal(lifeEventKindLabel("birth"), "", "naissance n'est pas un type d'événement générique");
});

test("les huit formats de date se construisent sans conversion artificielle", () => {
  assert.deepEqual(buildLifeDate({ type: "exact", value: "1892-05-12" }), { ok: true, date: { type: "exact", value: "1892-05-12" } });
  assert.deepEqual(buildLifeDate({ type: "year", year: "1892" }), { ok: true, date: { type: "year", year: 1892 } });
  assert.deepEqual(buildLifeDate({ type: "about", year: "1892" }), { ok: true, date: { type: "about", year: 1892 } });
  assert.deepEqual(buildLifeDate({ type: "before", value: "1892-05-12" }), { ok: true, date: { type: "before", value: "1892-05-12" } });
  assert.deepEqual(buildLifeDate({ type: "after", value: "1892-05-12" }), { ok: true, date: { type: "after", value: "1892-05-12" } });
  assert.deepEqual(buildLifeDate({ type: "attested", value: "1892-05-12" }), { ok: true, date: { type: "attested", value: "1892-05-12" } });
  assert.deepEqual(buildLifeDate({ type: "between", from: "1890", to: "1895" }), { ok: true, date: { type: "between", from: 1890, to: 1895 } });
  assert.deepEqual(buildLifeDate({ type: "unknown" }), { ok: true, date: { type: "unknown" } });
  assert.equal(buildLifeDate({ type: "year", year: "" }).date, null, "champ vide = période absente, jamais de date inventée");
  assert.equal(buildLifeDate({ type: "exact", value: "" }).date, null);
});

test("validation des dates : erreurs sans invention", () => {
  assert.match(buildLifeDate({ type: "year", year: "abc" }).error, /année/i);
  assert.match(buildLifeDate({ type: "exact", value: "31/02/1892" }).error, /date valide/i);
  assert.match(buildLifeDate({ type: "between", from: "1895" }).error, /deux bornes/);
  assert.match(buildLifeDate({ type: "between", from: "1900", to: "1890" }).error, /précéder/);
  assert.equal(buildLifeDate({ type: "autre" }).ok, false);
});

test("formatage des huit types", () => {
  assert.equal(formatLifeDate({ type: "exact", value: "1892-05-12" }), "12 mai 1892");
  assert.equal(formatLifeDate({ type: "year", year: 1892 }), "1892");
  assert.equal(formatLifeDate({ type: "about", year: 1892 }), "vers 1892");
  assert.equal(formatLifeDate({ type: "before", value: "1892-05-12" }), "avant 12 mai 1892");
  assert.equal(formatLifeDate({ type: "after", value: "1892-05-12" }), "après 12 mai 1892");
  assert.equal(formatLifeDate({ type: "attested", value: "1892-05-12" }), "attesté le 12 mai 1892");
  assert.equal(formatLifeDate({ type: "between", from: 1890, to: 1895 }), "entre 1890 et 1895");
  assert.equal(formatLifeDate({ type: "unknown" }), "—");
  assert.equal(formatLifeDate(null), "—");
});

test("normalisation : une année seule n'est jamais devenue exacte", () => {
  assert.deepEqual(normalizeLifeDate({ type: "year", year: 1892 }), { type: "year", year: 1892 });
  assert.deepEqual(normalizeLifeDate({ type: "about", year: 1892 }), { type: "about", year: 1892 });
  assert.equal(normalizeLifeDate({ type: "before", value: "invalide" }).type, "unknown");
  assert.deepEqual(normalizeLifeDate({ type: "before", value: "1892-05-12" }), { type: "before", value: "1892-05-12" });
  assert.equal(lifeDateSortValue({ type: "year", year: 1892 }), 18920500, "tri par année");
  assert.equal(lifeDateSortValue({ type: "unknown" }), null, "date inconnue : fin du classement");
  assert.equal(lifeDateSortValue(null), null);
});

test("tri chronologique avec dates inconnues à la fin", () => {
  const entries = [
    { id: "c", dateInfo: null },
    { id: "a", dateInfo: { type: "year", year: 1890 } },
    { id: "d", dateInfo: { type: "unknown" } },
    { id: "b", dateInfo: { type: "exact", value: "1901-03-04" } }
  ];
  assert.deepEqual(entries.sort(compareLifeEntries).map(entry => entry.id), ["a", "b", "c", "d"]);
});

test("compatibilité : personnes anciennes sans données 2C-3", () => {
  assert.deepEqual(personLifeList({}, "residences"), []);
  assert.deepEqual(personLifeList({ residences: "invalid" }, "residences"), []);
  assert.deepEqual(personLifeList({ residences: [{ id: "r1" }] }, "residences"), [{ id: "r1" }]);
  assert.deepEqual(lifeAttestations({}), []);
  assert.deepEqual(lifeAttestations({ attestations: null }), []);
});

test("validations des entrées", () => {
  assert.equal(validateLifeResidence({ place: "" }).ok, false);
  assert.match(validateLifeResidence({ place: "" }).errors.place, /commune/);
  assert.equal(validateLifeResidence({ place: "Orino" }).ok, true, "résidence valide sans attestation ni date");
  assert.equal(validateLifeProfession({ label: "" }).ok, false);
  assert.equal(validateLifeProfession({ label: "Agriculteur" }).ok, true);
  assert.equal(validateLifeEvent({ kind: "census", label: "Recensement de Biella" }).ok, true);
  assert.equal(validateLifeEvent({ kind: "", label: "x" }).ok, false);
  assert.match(validateLifeEvent({ kind: "", label: "x" }).errors.kind, /type d'événement/);
  assert.equal(validateLifeEvent({ kind: "census", label: "" }).ok, false);
  assert.equal(validateLifeAttestation({ date: null }).ok, false);
  assert.match(validateLifeAttestation({ date: null }).errors.date, /date de l'attestation/);
  assert.equal(validateLifeAttestation({ date: { type: "year", year: 1895 } }).ok, true, "attestation datée d'une année seule");
});

test("attestations multiples et similarité", () => {
  const attestations = [
    { id: "a1", date: { type: "year", year: 1892 } },
    { id: "a2", date: { type: "year", year: 1895 } },
    { id: "a3", date: { type: "attested", value: "1901-01-01" } }
  ];
  assert.equal(hasSimilarLifeAttestation(attestations, { id: "a4", date: { type: "year", year: 1892 } }), true, "même date : similarité signalée");
  assert.equal(hasSimilarLifeAttestation(attestations, { id: "a1", date: { type: "year", year: 1892 } }), false, "la même attestation n'est jamais signalée avec elle-même");
  assert.equal(hasSimilarLifeAttestation(attestations, { id: "a4", date: { type: "year", year: 1901 } }), false, "dates différentes");
  assert.equal(hasSimilarLifeAttestation(attestations, { id: "a4", date: null }), false);
});

test("associations : ajout et retrait sans toucher la source", () => {
  const source = { id: "s1", title: "Cadastre" };
  const withSource = toggleIdInList([], source.id);
  assert.deepEqual(withSource, ["s1"]);
  assert.equal(toggleIdInList(withSource, source.id).length, 0, "retrait de l'association");
  assert.deepEqual(source, { id: "s1", title: "Cadastre" }, "l'objet source est intact");
  assert.deepEqual(toggleIdInList(null, "x"), ["x"]);
});

console.log("Parcours détaillé (life-journey) : OK");
