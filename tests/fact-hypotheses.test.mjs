import assert from "node:assert/strict";
import test from "node:test";
import {
  FACT_HYPOTHESIS_ANCHOR_KEY,
  FACT_HYPOTHESIS_FIELDS,
  FACT_HYPOTHESIS_STATUS,
  activeFactHypotheses,
  canTransitionHypothesis,
  compareFactHypothesisValues,
  countFactHypotheses,
  countFactHypothesesForEvent,
  detectFactHypothesisConflicts,
  detectSimilarFactHypotheses,
  factHypothesisField,
  factHypothesisFieldsForEvent,
  factHypothesisValueEqual,
  formatFactHypothesisValue,
  normalizeFactHypothesisValue,
  personFactValue,
  personFactValueIsEmpty,
  personFactValuePatch,
  replacementJustificationRequired,
  retainedHypothesisAnchor,
  validateHypothesisOperation
} from "../js/fact-hypotheses.js";

test("le périmètre des hypothèses couvre uniquement date et lieu de naissance et de décès", () => {
  assert.deepEqual(FACT_HYPOTHESIS_FIELDS.map(field => field.key), [
    "birth.date", "birth.place", "death.date", "death.place"
  ]);
  assert.equal(factHypothesisField("birth.date").kind, "date");
  assert.equal(factHypothesisField("birth.place").kind, "place");
  assert.equal(factHypothesisField("filiation"), null);
  assert.deepEqual(factHypothesisFieldsForEvent("birth"), ["birth.date", "birth.place"]);
  assert.deepEqual(factHypothesisFieldsForEvent("death"), ["death.date", "death.place"]);
  assert.deepEqual(factHypothesisFieldsForEvent("marriage"), []);
  assert.equal(FACT_HYPOTHESIS_ANCHOR_KEY, "retainedHypothesis");
  assert.deepEqual([...FACT_HYPOTHESIS_STATUS], ["retained", "alternative", "rejected", "deleted"]);
});

test("les valeurs normalisées conservent la précision des dates et des lieux", () => {
  const year = normalizeFactHypothesisValue("birth.date", { type: "year", year: 1869 });
  assert.deepEqual(year, { ok: true, value: { type: "year", year: 1869 } });

  const exact = normalizeFactHypothesisValue("death.date", "1901-04-12");
  assert.deepEqual(exact, { ok: true, value: { type: "exact", value: "1901-04-12" } });

  const place = normalizeFactHypothesisValue("birth.place", "  Rome, Italie  ");
  assert.deepEqual(place, { ok: true, value: { place: "Rome, Italie", placeInfo: null } });

  const structuredPlace = normalizeFactHypothesisValue("death.place", { place: "Paris", placeInfo: { name: "Paris" } });
  assert.deepEqual(structuredPlace, { ok: true, value: { place: "Paris", placeInfo: { name: "Paris" } } });

  const unknown = normalizeFactHypothesisValue("filiation", {});
  assert.equal(unknown.ok, false);
});

test("le formatage restitue les dates et lieux en français", () => {
  assert.equal(formatFactHypothesisValue("birth.date", { type: "exact", value: "1869-03-13" }), "13 mars 1869");
  assert.equal(formatFactHypothesisValue("birth.date", { type: "about", year: 1870 }), "vers 1870");
  assert.equal(formatFactHypothesisValue("death.date", { type: "unknown" }), "—");
  assert.equal(formatFactHypothesisValue("birth.place", { place: "Rome, Italie", placeInfo: null }), "Rome, Italie");
  assert.equal(formatFactHypothesisValue("birth.place", null), "—");
  assert.equal(formatFactHypothesisValue("filiation", {}), "—");
});

test("une précision partagée n'est pas une contradiction", () => {
  const year = { type: "year", year: 1869 };
  const month = { type: "exact", value: "1869-09-01" };
  const day = { type: "exact", value: "1869-09-13" };
  assert.equal(compareFactHypothesisValues("birth.date", year, day), "precision");
  assert.equal(compareFactHypothesisValues("birth.date", month, day), "precision");
  assert.equal(compareFactHypothesisValues("birth.date", year, { type: "year", year: 1870 }), "conflict");
  assert.equal(compareFactHypothesisValues("birth.date", year, { type: "year", year: 1869 }), "identical");
  assert.equal(
    compareFactHypothesisValues("death.date", { type: "between", from: 1900, to: 1910 }, { type: "year", year: 1908 }),
    "precision"
  );
  assert.equal(
    compareFactHypothesisValues("death.date", { type: "between", from: 1900, to: 1910 }, { type: "year", year: 1920 }),
    "conflict"
  );
});

test("les lieux se comparent sans accent ni casse et distinguent précision et conflit", () => {
  const paris = { place: "Paris", placeInfo: null };
  assert.equal(compareFactHypothesisValues("birth.place", paris, { place: "  PARIS ", placeInfo: null }), "identical");
  assert.equal(
    compareFactHypothesisValues("birth.place", { place: "Paris", placeInfo: null }, { place: "Paris, France", placeInfo: null }),
    "precision"
  );
  assert.equal(
    compareFactHypothesisValues("birth.place", { place: "Rome", placeInfo: null }, { place: "Naples", placeInfo: null }),
    "conflict"
  );
  assert.equal(factHypothesisValueEqual("birth.place", paris, { place: "Paris", placeInfo: { name: "Paris" } }), false);
});

test("la détection sépare identiques, précisions et conflits sans tenir compte des supprimées", () => {
  const existing = [
    { id: "h1", fieldKey: "birth.date", status: "retained", value: { type: "year", year: 1869 } },
    { id: "h2", fieldKey: "birth.date", status: "alternative", value: { type: "exact", value: "1869-09-13" } },
    { id: "h3", fieldKey: "birth.date", status: "alternative", value: { type: "year", year: 1872 } },
    { id: "h4", fieldKey: "birth.date", status: "deleted", value: { type: "year", year: 1872 } },
    { id: "h5", fieldKey: "death.date", status: "alternative", value: { type: "year", year: 1869 } }
  ];
  const result = detectSimilarFactHypotheses("birth.date", { type: "year", year: 1869 }, existing);
  assert.deepEqual(result.identical.map(item => item.id), ["h1"]);
  assert.deepEqual(result.precisions.map(item => item.id), ["h2"]);
  assert.deepEqual(result.conflicts.map(item => item.id), ["h3"]);
});

test("les champs de la fiche se lisent depuis les valeurs legacy et structurées", () => {
  const record = {
    birthDate: "1869-09-13",
    birthDateInfo: { type: "year", year: 1869 },
    place: "Rome",
    birthPlaceInfo: { name: "Rome" },
    deathDateInfo: { type: "about", year: 1940 },
    deathPlace: "Paris"
  };
  assert.deepEqual(personFactValue("birth.date", record), { type: "year", year: 1869 });
  assert.deepEqual(personFactValue("birth.place", record), { place: "Rome", placeInfo: { name: "Rome" } });
  assert.deepEqual(personFactValue("death.date", record), { type: "about", year: 1940 });
  assert.deepEqual(personFactValue("death.place", record), { place: "Paris", placeInfo: null });
  assert.equal(personFactValue("filiation", record), null);

  assert.equal(personFactValueIsEmpty("birth.date", { birthDateInfo: { type: "unknown" } }), true);
  assert.equal(personFactValueIsEmpty("birth.date", { birthDateInfo: { type: "year", year: 1869 } }), false);
  assert.equal(personFactValueIsEmpty("birth.place", { place: "  " }), true);
  assert.equal(personFactValueIsEmpty("birth.place", { place: "Rome" }), false);
  assert.equal(personFactValueIsEmpty("death.date", {}), true);
});

test("le patch d'écriture respecte le miroir legacy", () => {
  const yearPatch = personFactValuePatch("birth.date", { type: "year", year: 1869 });
  assert.deepEqual(yearPatch.set, { birthDateInfo: { type: "year", year: 1869 } });
  assert.deepEqual(yearPatch.remove, ["birthDate"]);

  const exactPatch = personFactValuePatch("death.date", { type: "exact", value: "1940-05-02" });
  assert.deepEqual(exactPatch.set, { deathDateInfo: { type: "exact", value: "1940-05-02" } });
  assert.deepEqual(exactPatch.remove, []);

  const placePatch = personFactValuePatch("birth.place", { place: "Rome", placeInfo: { name: "Rome" } });
  assert.deepEqual(placePatch.set, { place: "Rome", birthPlaceInfo: { name: "Rome" } });
  assert.deepEqual(placePatch.remove || [], []);

  const plainPlacePatch = personFactValuePatch("death.place", { place: "Paris", placeInfo: null });
  assert.deepEqual(plainPlacePatch.set, { deathPlace: "Paris" });
  assert.deepEqual(plainPlacePatch.remove, ["deathPlaceInfo"]);

  assert.deepEqual(personFactValuePatch("filiation", {}), { set: {}, remove: [] });
});

test("l'ancre d'unicité ne porte qu'une retenue par information", () => {
  const anchor = retainedHypothesisAnchor({}, "birth.date", "h1");
  assert.deepEqual(anchor, { "birth.date": "h1" });
  const replaced = retainedHypothesisAnchor(anchor, "birth.date", "h2");
  assert.deepEqual(replaced, { "birth.date": "h2" });
  const removed = retainedHypothesisAnchor(replaced, "birth.date", null);
  assert.deepEqual(removed, {});
  assert.equal(replacementJustificationRequired(null, "h2"), false);
  assert.equal(replacementJustificationRequired("h1", "h1"), false);
  assert.equal(replacementJustificationRequired("h1", "h2"), true);
});

test("les transitions de statut interdisent la suppression d'une retenue et la promotion directe d'une supprimée", () => {
  assert.equal(canTransitionHypothesis("alternative", "retained"), true);
  assert.equal(canTransitionHypothesis("alternative", "deleted"), true);
  assert.equal(canTransitionHypothesis("rejected", "retained"), true);
  assert.equal(canTransitionHypothesis("rejected", "alternative"), true, "réexamen : écartée → alternative");
  assert.equal(canTransitionHypothesis("rejected", "deleted"), true);
  assert.equal(canTransitionHypothesis("deleted", "alternative"), true);
  assert.equal(canTransitionHypothesis("deleted", "retained"), false);
  assert.equal(canTransitionHypothesis("retained", "deleted"), false);
  assert.equal(canTransitionHypothesis("retained", "rejected"), false);
  assert.equal(canTransitionHypothesis("retained", "alternative"), true);
  assert.equal(canTransitionHypothesis("alternative", "alternative"), true);
  assert.equal(canTransitionHypothesis("deleted", "deleted"), false, "aucune écriture sur une supprimée");
  assert.equal(canTransitionHypothesis("unknown", "retained"), false);
});

test("la validation métier exige une justification uniquement au remplacement d'une retenue", () => {
  const base = { operation: "retained", fromStatus: "alternative", toStatus: "retained", fieldKey: "birth.date" };

  const firstSelection = validateHypothesisOperation({ ...base, previousRetainedId: null, nextHypothesisId: "h2" });
  assert.equal(firstSelection.valid, true);

  const replacementWithoutJustification = validateHypothesisOperation({
    ...base, previousRetainedId: "h1", nextHypothesisId: "h2", justification: "  "
  });
  assert.equal(replacementWithoutJustification.valid, false);
  assert.match(replacementWithoutJustification.error, /justification est obligatoire/);

  const replacementWithJustification = validateHypothesisOperation({
    ...base, previousRetainedId: "h1", nextHypothesisId: "h2", justification: "Acte retrouvé"
  });
  assert.equal(replacementWithJustification.valid, true);

  const retainedDeletion = validateHypothesisOperation({
    operation: "deleted", fromStatus: "retained", toStatus: "deleted",
    fieldKey: "birth.date", previousRetainedId: "h1", nextHypothesisId: "h1"
  });
  assert.equal(retainedDeletion.valid, false);
  assert.match(retainedDeletion.error, /remplacez-la/);

  const directPromotion = validateHypothesisOperation({
    operation: "retained", fromStatus: "deleted", toStatus: "retained", fieldKey: "birth.date"
  });
  assert.equal(directPromotion.valid, false);
  assert.match(directPromotion.error, /jamais directement retenue/);

  const creationOnTopOfRetained = validateHypothesisOperation({
    operation: "created", toStatus: "retained", fieldKey: "birth.date",
    previousRetainedId: "h1", nextHypothesisId: "h2"
  });
  assert.equal(creationOnTopOfRetained.valid, false);

  const unknownField = validateHypothesisOperation({ ...base, fieldKey: "filiation" });
  assert.equal(unknownField.valid, false);

  const correctionOnDeleted = validateHypothesisOperation({
    operation: "value-corrected", fromStatus: "deleted", toStatus: "deleted", fieldKey: "birth.date"
  });
  assert.equal(correctionOnDeleted.valid, false);
  assert.match(correctionOnDeleted.error, /supprimée ne peut pas être modifiée/);
});

test("le réexamen exige une hypothèse écartée et une justification non vide", () => {
  const base = { operation: "reexamined", fromStatus: "rejected", toStatus: "alternative", fieldKey: "birth.date" };

  const valid = validateHypothesisOperation({ ...base, justification: "Acte de naissance retrouvé" });
  assert.equal(valid.valid, true);

  const withoutJustification = validateHypothesisOperation({ ...base, justification: "   " });
  assert.equal(withoutJustification.valid, false);
  assert.match(withoutJustification.error, /justification est obligatoire pour réexaminer/);

  const wrongStatus = validateHypothesisOperation({ ...base, fromStatus: "alternative", justification: "X" });
  assert.equal(wrongStatus.valid, false);
  assert.match(wrongStatus.error, /Seule une hypothèse écartée/);

  const wrongTarget = validateHypothesisOperation({ ...base, toStatus: "retained", justification: "X" });
  assert.equal(wrongTarget.valid, false);
  assert.match(wrongTarget.error, /Seule une hypothèse écartée/);

  /* La restauration reste réservée aux hypothèses supprimées. */
  const restoreRejected = validateHypothesisOperation({
    operation: "restored", fromStatus: "rejected", toStatus: "alternative",
    fieldKey: "birth.date", justification: "X"
  });
  assert.equal(restoreRejected.valid, false);
  assert.match(restoreRejected.error, /Seule une hypothèse supprimée/);
});

test("les compteurs ignorent les hypothèses supprimées", () => {
  const hypotheses = [
    { id: "h1", fieldKey: "birth.date", status: "retained" },
    { id: "h2", fieldKey: "birth.date", status: "alternative" },
    { id: "h3", fieldKey: "death.place", status: "rejected" },
    { id: "h4", fieldKey: "birth.date", status: "deleted" }
  ];
  assert.equal(countFactHypotheses(hypotheses), 3);
  assert.equal(countFactHypotheses(hypotheses, ["birth.date"]), 2);
  assert.equal(countFactHypothesesForEvent(hypotheses, "birth"), 2);
  assert.equal(countFactHypothesesForEvent(hypotheses, "death"), 1);
  assert.equal(activeFactHypotheses(hypotheses, ["birth.date"]).length, 2);
});

test("la détection d'incohérences repère ancre orpheline, statut et divergence de valeur", () => {
  const coherent = detectFactHypothesisConflicts({
    peopleRecords: [{ id: "p1", birthDateInfo: { type: "year", year: 1869 }, retainedHypothesis: { "birth.date": "h1" } }],
    hypotheses: [{ id: "h1", personId: "p1", fieldKey: "birth.date", status: "retained", value: { type: "year", year: 1869 } }]
  });
  assert.deepEqual(coherent, []);

  const dangling = detectFactHypothesisConflicts({
    peopleRecords: [{ id: "p1", retainedHypothesis: { "birth.date": "missing" } }],
    hypotheses: []
  });
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].code, "FACT_HYPOTHESIS_ANCHOR_DANGLING");

  const wrongStatus = detectFactHypothesisConflicts({
    peopleRecords: [{ id: "p1", retainedHypothesis: { "birth.date": "h1" } }],
    hypotheses: [{ id: "h1", personId: "p1", fieldKey: "birth.date", status: "alternative", value: { type: "year", year: 1869 } }]
  });
  assert.equal(wrongStatus.length, 1);
  assert.equal(wrongStatus[0].code, "FACT_HYPOTHESIS_ANCHOR_STATUS");

  const divergence = detectFactHypothesisConflicts({
    peopleRecords: [{ id: "p1", birthDateInfo: { type: "year", year: 1872 }, retainedHypothesis: { "birth.date": "h1" } }],
    hypotheses: [{ id: "h1", personId: "p1", fieldKey: "birth.date", status: "retained", value: { type: "year", year: 1869 } }]
  });
  assert.equal(divergence.length, 1);
  assert.equal(divergence[0].code, "FACT_HYPOTHESIS_VALUE_DIVERGENCE");

  const orphan = detectFactHypothesisConflicts({
    peopleRecords: [],
    hypotheses: [{ id: "h1", personId: "p1", fieldKey: "birth.date", status: "retained", value: { type: "year", year: 1869 } }]
  });
  assert.equal(orphan.length, 1);
  assert.equal(orphan[0].code, "FACT_HYPOTHESIS_PERSON_MISSING");
});
