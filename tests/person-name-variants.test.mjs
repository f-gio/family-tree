import test from "node:test";
import assert from "node:assert/strict";
import {
  NAME_VARIANT_KINDS,
  nameVariantLabel,
  normalizeNameVariantValue,
  personNameVariants,
  validateNameVariant,
  personNameVariantsSearchText,
  nameVariantsWritePlan
} from "../js/person-name-variants.js";

test("kinds et libellés", () => {
  assert.deepEqual([...NAME_VARIANT_KINDS], ["given", "family"]);
  assert.equal(nameVariantLabel("given"), "Prénom");
  assert.equal(nameVariantLabel("family"), "Nom");
  assert.equal(nameVariantLabel("unknown"), "");
});

test("champ absent ou invalide = liste vide", () => {
  assert.deepEqual(personNameVariants({}), []);
  assert.deepEqual(personNameVariants({ nameVariants: "Pinaezza" }), []);
  assert.deepEqual(personNameVariants({ nameVariants: [null, {}, { id: "x", kind: "other", value: "Y" }, { kind: "given", value: "  " }] }), []);
  assert.equal(normalizeNameVariantValue("  Pinaezza  "), "Pinaezza", "graphie conservée après simple trim");
});

test("validation : valeur vide refusée", () => {
  const result = validateNameVariant({ kind: "family", value: "   " });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Saisissez une variante.");
});

test("validation : type inconnu refusé", () => {
  const result = validateNameVariant({ kind: "maiden", value: "Pinaezza" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Prénom ou Nom/);
});

test("validation : identique au prénom ou au nom principal refusé", () => {
  const given = validateNameVariant({ kind: "given", value: "Ludovica", firstName: "Ludovica", lastName: "Pianezza" });
  assert.equal(given.ok, false);
  assert.equal(given.error, "Cette variante est identique au prénom principal.");
  const accented = validateNameVariant({ kind: "given", value: " Ludovica ", firstName: "Ludovica" });
  assert.equal(accented.ok, false, "comparaison insensible aux espaces");
  const family = validateNameVariant({ kind: "family", value: "PIANEZZA", firstName: "Ludovica", lastName: "Pianezza" });
  assert.equal(family.ok, false, "comparaison insensible à la casse");
  const crossKind = validateNameVariant({ kind: "given", value: "Pianezza", firstName: "Ludovica", lastName: "Pianezza" });
  assert.equal(crossKind.ok, true, "un nom devenu prénom reste une variante de prénom valide");
});

test("validation : doublon interdit uniquement pour le même type", () => {
  const existing = [{ id: "v1", kind: "family", value: "Pinaezza" }];
  const duplicate = validateNameVariant({ kind: "family", value: "pinaezza", existing });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, "Cette variante existe déjà pour ce type.");
  const otherKind = validateNameVariant({ kind: "given", value: "Pinaezza", existing });
  assert.equal(otherKind.ok, true, "la même graphie est acceptée pour l'autre type");
  assert.equal(otherKind.value, "Pinaezza");
});

test("validation : variante identique à celle d'une autre personne acceptée", () => {
  const result = validateNameVariant({ kind: "family", value: "Pinaezza", lastName: "Rossi", existing: [] });
  assert.equal(result.ok, true,
    "la validation ne reçoit que le draft courant : aucune comparaison inter-personnes");
});

test("texte de recherche : toutes les variantes ou filtrage par type", () => {
  const person = {
    firstName: "Ludovica", lastName: "Pianezza",
    nameVariants: [
      { id: "v1", kind: "given", value: "Lodovica" },
      { id: "v2", kind: "family", value: "Pinaezza" },
      { id: "v3", kind: "family", value: "Piolin" }
    ]
  };
  assert.equal(personNameVariantsSearchText(person), "Lodovica Pinaezza Piolin");
  assert.equal(personNameVariantsSearchText(person, "given"), "Lodovica");
  assert.equal(personNameVariantsSearchText(person, "family"), "Pinaezza Piolin");
  assert.equal(personNameVariantsSearchText({}), "", "personne sans variantes");
});

test("plan d'écriture Firestore : création, édition, suppression", () => {
  const variants = [{ id: "v1", kind: "family", value: "Pinaezza" }];

  /* 1. Création sans variante : le champ doit être omis (jamais deleteField dans setDoc). */
  assert.equal(nameVariantsWritePlan([], false).action, "omit");

  /* 2. Création avec variantes : la liste est écrite. */
  const created = nameVariantsWritePlan(variants, false);
  assert.equal(created.action, "set");
  assert.deepEqual(created.value, variants);
  assert.notEqual(created.value, variants, "valeur détachée du brouillon");

  /* 3. Édition après suppression de toutes les variantes : suppression du champ. */
  assert.equal(nameVariantsWritePlan([], true).action, "delete");

  /* 4. Édition avec variantes : la liste est écrite. */
  const updated = nameVariantsWritePlan(variants, true);
  assert.equal(updated.action, "set");
  assert.deepEqual(updated.value, variants);
});

console.log("Variantes de noms et prénoms : OK");
