import assert from "node:assert/strict";
import test from "node:test";

import { enumerateJustificationTargets, JUSTIFICATION_TARGETS_SCHEMA_VERSION } from "../js/justification-targets.js";
import { buildFactIdentityId, buildLegacyParentChildIdentityId } from "../js/genealogy-identities.js";

function target(result, targetType, ownerId, memberId = null) {
  return result.targets.find(item => item.targetType === targetType
    && item.owner.id === ownerId
    && (memberId === null || item.path.fields.includes(memberId)));
}

test("les cibles Personne utilisent les identités exactes déjà prévues pour les faits canoniques", () => {
  const person = {
    id: "personne-1", firstName: "Andrea", middleName: "Luigi", lastName: "Giovannoni",
    marriedName: "Rossi", gender: "M", birthDateInfo: { type: "year", year: 1902 },
    birthDate: "", place: "Varese", birthPlaceInfo: { countryCode: "IT" },
    deathDate: "1970-02-03", deathPlace: "Como", deathPlaceInfo: null,
    branch: "branche interne", notes: "note libre", photoUrl: "data:image/png;base64,unused",
    birthAttestations: [{ id: "att-1", documentIds: ["doc-1"] }]
  };

  const result = enumerateJustificationTargets({ people: [person] });
  const given = target(result, "person.name.given", person.id);
  const surname = target(result, "person.name.birthSurname", person.id);
  const birthDate = target(result, "person.birth.date", person.id);
  const birthPlace = target(result, "person.birth.place", person.id);
  const deathDate = target(result, "person.death.date", person.id);
  const deathPlace = target(result, "person.death.place", person.id);

  assert.equal(result.schemaVersion, JUSTIFICATION_TARGETS_SCHEMA_VERSION);
  assert.equal(given.id, buildFactIdentityId("person", person.id, "name.given"));
  assert.equal(given.factId, given.id);
  assert.equal(surname.id, buildFactIdentityId("person", person.id, "name.birthSurname"));
  assert.equal(birthDate.id, buildFactIdentityId("person", person.id, "birth.date"));
  assert.equal(birthPlace.id, buildFactIdentityId("person", person.id, "birth.place"));
  assert.equal(deathDate.id, buildFactIdentityId("person", person.id, "death.date"));
  assert.equal(deathPlace.id, buildFactIdentityId("person", person.id, "death.place"));
  assert.deepEqual(birthDate.value, { structured: { type: "year", year: 1902 }, legacy: [{ key: "birthDate", value: "" }] });
  assert.equal(birthDate.valueState, "present");
  assert.equal(birthPlace.valueState, "present");
  assert.deepEqual(birthPlace.value, { text: "Varese", details: { countryCode: "IT" } });
  assert.deepEqual(deathDate.value.legacy, [{ key: "deathDate", value: "1970-02-03" }]);
  assert.equal(deathPlace.valueState, "present");
  assert.ok(!result.targets.some(item => /branch|notes|photoUrl|Attestation|attestation/.test(item.targetType)));
  assert.ok(!result.targets.some(item => item.targetType.includes("burial")), "aucun champ de sépulture n'est inventé");
});

test("valeurs absentes et inconnues restent distinguées sans fabriquer de date", () => {
  const absent = enumerateJustificationTargets({ people: [{ id: "p-absent", firstName: "" }] });
  const explicitUnknown = enumerateJustificationTargets({ people: [{
    id: "p-unknown", birthDateInfo: { type: "unknown" }, deathDateInfo: { type: "unknown" }, gender: "unknown"
  }] });

  assert.equal(target(absent, "person.birth.date", "p-absent").valueState, "absent");
  assert.equal(target(absent, "person.birth.date", "p-absent").value.structured, null);
  assert.equal(target(absent, "person.name.given", "p-absent").valueState, "absent");
  assert.equal(target(explicitUnknown, "person.birth.date", "p-unknown").valueState, "explicit-unknown");
  assert.equal(target(explicitUnknown, "person.death.date", "p-unknown").valueState, "explicit-unknown");
  assert.equal(target(explicitUnknown, "person.gender", "p-unknown").valueState, "present", "le texte littéral unknown reste une valeur textuelle");
  const conflict = enumerateJustificationTargets({ people: [{ id: "p-conflict", birthDateInfo: { type: "unknown" }, birthDate: "1900" }] });
  assert.equal(target(conflict, "person.birth.date", "p-conflict").valueState, "conflict");
});

test("les identifiants canoniques ne dépendent pas des valeurs et les types legacy larges restent ambigus", () => {
  const first = enumerateJustificationTargets({ people: [{ id: "p-1", birthDateInfo: { type: "year", year: 1900 }, place: "A" }] });
  const second = enumerateJustificationTargets({ people: [{ id: "p-1", birthDateInfo: { type: "exact", value: "1901-04-05" }, place: "B" }] });
  const firstBirth = target(first, "person.birth.date", "p-1");
  const secondBirth = target(second, "person.birth.date", "p-1");
  assert.equal(firstBirth.id, secondBirth.id);
  assert.notDeepEqual(firstBirth.value, secondBirth.value);
  assert.equal(firstBirth.factId, buildFactIdentityId("person", "p-1", "birth.date"));
  assert.deepEqual(firstBirth.legacyFactCandidates, [{
    factId: buildFactIdentityId("person", "p-1", "birth"),
    factType: "birth",
    compatibility: "ambiguous",
    reason: "Le type historique « birth » ne distingue pas cette cible précise."
  }]);
  assert.equal(firstBirth.factIdentityCompatibility, "exact");
  assert.equal(target(first, "person.birth.place", "p-1").legacyFactCandidates[0].factId, firstBirth.legacyFactCandidates[0].factId);
});

test("les dates legacy sont conservées sans inventer de précision ni modifier l'entrée", () => {
  const person = { id: "legacy", birthDate: "1901", deathDate: "" };
  const before = JSON.stringify(person);
  const result = enumerateJustificationTargets({ people: [person] });
  const birth = target(result, "person.birth.date", "legacy");
  assert.equal(birth.valueState, "present");
  assert.equal(birth.value.structured, null);
  assert.deepEqual(birth.value.legacy, [{ key: "birthDate", value: "1901" }]);
  assert.equal(target(result, "person.death.date", "legacy").valueState, "absent");
  assert.equal(JSON.stringify(person), before);
});

test("les résidences, professions et événements répétés gardent leur identité à l'ordre et à la valeur près", () => {
  const residenceA = { id: "res-a", place: "Varese", dateInfo: { type: "year", year: 1935 }, address: "Via A" };
  const residenceB = { id: "res-b", place: "Como", dateInfo: { type: "year", year: 1940 }, address: "Via B" };
  const event = { id: "event-1", kind: "census", label: "Recensement", dateInfo: { type: "year", year: 1935 }, place: "Varese" };
  const before = enumerateJustificationTargets({ people: [{ id: "p-1", residences: [residenceA, residenceB], lifeEvents: [event] }] });
  const after = enumerateJustificationTargets({ people: [{ id: "p-1", residences: [
    { ...residenceB }, { ...residenceA, place: "Varese, centre" }
  ], lifeEvents: [{ ...event, dateInfo: { type: "year", year: 1936 } }] }] });

  for (const memberId of ["res-a", "res-b"]) {
    for (const type of ["person.residence.date", "person.residence.place", "person.residence.address"]) {
      assert.equal(target(before, type, "p-1", memberId).id, target(after, type, "p-1", memberId).id);
    }
  }
  assert.notEqual(target(before, "person.residence.date", "p-1", "res-a").id,
    target(before, "person.residence.date", "p-1", "res-b").id);
  assert.equal(target(before, "person.lifeEvent.date", "p-1", "event-1").id,
    target(after, "person.lifeEvent.date", "p-1", "event-1").id);

  const profession = enumerateJustificationTargets({ people: [{ id: "p-1", professions: [{ id: "job-1", label: "Maçon", dateInfo: { type: "between", from: 1930, to: 1938 } }] }] });
  assert.ok(target(profession, "person.profession.label", "p-1", "job-1"));
  assert.equal(target(profession, "person.profession.date", "p-1", "job-1").valueState, "present");
});

test("les entrées répétées sans ID ou à ID dupliqué sont exclues, sans index de tableau", () => {
  const result = enumerateJustificationTargets({ people: [{
    id: "p-1",
    residences: [
      { place: "Sans identifiant", dateInfo: { type: "year", year: 1935 } },
      { id: "duplicate", place: "A" },
      { id: "duplicate", place: "B" }
    ],
    nameVariants: [
      { kind: "given", value: "Andy" },
      { id: "variant-dup", kind: "family", value: "Giovanoni" },
      { id: "variant-dup", kind: "family", value: "Giovannoni" }
    ]
  }] });

  assert.equal(result.targets.some(item => item.path.fields[0] === "residences"), false);
  assert.equal(result.targets.some(item => item.path.fields[0] === "nameVariants"), false);
  assert.ok(result.excluded.some(item => item.reason.includes("identifiant persistant absent")));
  assert.equal(result.excluded.filter(item => item.reason.includes("identifiant d'entrée dupliqué")).length, 2);
  assert.equal(result.excluded.filter(item => item.reason.includes("identifiant de variante dupliqué")).length, 2);
});

test("les variantes de nom sont stables par ID persistant, pas par position ou libellé", () => {
  const before = enumerateJustificationTargets({ people: [{ id: "p-1", nameVariants: [
    { id: "variant-a", kind: "given", value: "Andrea" },
    { id: "variant-b", kind: "family", value: "Giovanoni" }
  ] }] });
  const after = enumerateJustificationTargets({ people: [{ id: "p-1", nameVariants: [
    { id: "variant-b", kind: "family", value: "Giovannoni" },
    { id: "variant-a", kind: "given", value: "Andy" }
  ] }] });
  for (const [id, kind] of [["variant-a", "given"], ["variant-b", "family"]]) {
    assert.equal(target(before, `person.nameVariant.${kind}`, "p-1", id).id,
      target(after, `person.nameVariant.${kind}`, "p-1", id).id);
  }
});

test("les liens parent-enfant réutilisent la clé legacy sans la présenter comme ID persisté de relation", () => {
  const family = {
    id: "family-1", partnerIds: ["parent-a", "parent-b"], childIds: ["child-a", "child-b"],
    parentChildLinks: [{ parentId: "parent-a", childId: "child-a", type: "biological" }],
    unionDateInfo: { type: "unknown" }, endDateInfo: { type: "unknown" }
  };
  const before = enumerateJustificationTargets({ families: [family] });
  const reordered = enumerateJustificationTargets({ families: [{
    ...family, partnerIds: [...family.partnerIds].reverse(), childIds: [...family.childIds].reverse()
  }] });
  const pairId = buildLegacyParentChildIdentityId("family-1", "parent-a", "child-a");
  const relation = before.targets.find(item => item.targetType === "family.parentChild.relationship" && item.id === pairId);
  assert.ok(relation);
  assert.equal(relation.identityStrategy, "legacy-family-parent-child-tuple");
  assert.equal(relation.factId, null, "la clé de compatibilité n'est pas déclarée factId persisté");
  assert.equal(relation.value.type, "biological");
  assert.equal(relation.valueState, "present");
  assert.equal(reordered.targets.some(item => item.id === pairId), true);
  assert.equal(enumerateJustificationTargets({ families: [{ ...family, id: "family-recreated" }] }).targets
    .some(item => item.id === pairId), false, "recréation sous un nouvel ID de Foyer change la clé legacy");
  const implicit = before.targets.find(item => item.targetType === "family.parentChild.relationship"
    && item.value.parentId === "parent-b" && item.value.childId === "child-b");
  assert.equal(implicit.value.type, "unknown");
  assert.equal(implicit.value.typeValueState, "absent", "le registre ne prétend pas qu'un type de filiation est enregistré");
  assert.equal(target(before, "family.union.date", "family-1").valueState, "explicit-unknown");
});

test("les cibles union et leurs identifiants restent distincts et résistants aux séparateurs", () => {
  const result = enumerateJustificationTargets({
    people: [{ id: "person~part", firstName: "A" }, { id: "person", firstName: "B" }],
    families: [{ id: "family-a", partnerIds: ["person~part", "person"], childIds: [] }]
  });
  const personTargets = result.targets.filter(item => item.targetType === "person.name.given");
  const familyTargets = result.targets.filter(item => item.owner.kind === "family");
  assert.equal(new Set(personTargets.map(item => item.id)).size, 2);
  assert.ok(familyTargets.some(item => item.targetType === "family.union.partners"));
  assert.equal(new Set(result.targets.map(item => item.id)).size, result.targets.length);
  assert.equal(result.excluded.some(item => item.reason.includes("collision d'identifiant")), false);
});

test("des propriétaires dupliqués créent une collision signalée et aucune cible ambiguë n'est publiée", () => {
  const result = enumerateJustificationTargets({ people: [
    { id: "same-id", firstName: "A" },
    { id: "same-id", firstName: "B" }
  ] });
  assert.equal(result.targets.some(item => item.owner.id === "same-id"), false);
  assert.ok(result.excluded.some(item => item.reason.includes("collision d'identifiant")));
});

test("les cibles sont multiples, déterministes et ne mutent jamais Personne/Famille", () => {
  const input = {
    people: [{ id: "p-1", firstName: "Andrea", notes: "Note", branch: "branche", birthAttestations: [{ id: "att-1" }] }],
    families: [{ id: "family-1", partnerIds: ["p-1", "p-2"], childIds: ["p-3"] }]
  };
  const snapshot = JSON.stringify(input);
  const first = enumerateJustificationTargets(input);
  const second = enumerateJustificationTargets(input);
  assert.ok(first.targets.length > 1, "la sortie permet une sélection multiple");
  assert.deepEqual(first.targets.map(item => item.id), second.targets.map(item => item.id));
  assert.equal(JSON.stringify(input), snapshot);
  assert.ok(!first.targets.some(item => /attestation|proof|source|document|conclusion|note|description|branch/i.test(item.targetType)));
  assert.ok(!first.targets.some(item => item.path.fields.includes("birthAttestations")));
});

test("les filiations stockées en doublon ou hors des membres courants sont exclues", () => {
  const result = enumerateJustificationTargets({ families: [{
    id: "family-1", partnerIds: ["parent-1"], childIds: ["child-1"],
    parentChildLinks: [
      { parentId: "parent-1", childId: "child-1", type: "biological" },
      { parentId: "parent-1", childId: "child-1", type: "adoptive" },
      { parentId: "removed-parent", childId: "child-1", type: "uncertain" }
    ]
  }] });
  assert.equal(result.targets.some(item => item.targetType === "family.parentChild.relationship"), false);
  assert.ok(result.excluded.some(item => item.reason.includes("lien stocké en double")));
  assert.ok(result.excluded.some(item => item.reason.includes("hors des partnerIds/childIds")));
});
