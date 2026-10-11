import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TRANSFER_DIAGNOSTIC_STORAGE_KEY,
  TRANSFER_DIAGNOSTIC_STAGES,
  TRANSFER_DIAGNOSTIC_CLASSIFICATIONS,
  TRANSFER_DIAGNOSTIC_REASON_CODES,
  isTransferDiagnosticAllowed,
  resolveTransferDiagnosticEnabled,
  compareIndividualTransferPlans,
  analyzePlanDivergence,
  buildTransferDiagnosticReport
} from "../js/transfer-diagnostic.js";
import { prepareIndividualTreeTransferPlan, MAIN_TREE_ID } from "../js/tree-model.js";

/* Scénario de base : Jean + Marie (parents) -> Paul, tous dans main ;
   Sophie/Léa dans l'arbre secondaire destination. */
const basePeople = [
  { id: "jean", firstName: "Jean", lastName: "Test", treeId: null },
  { id: "marie", firstName: "Marie", lastName: "Test" },
  { id: "paul", firstName: "Paul", lastName: "Test", notes: "Notes secrètes" },
  { id: "sophie", firstName: "Sophie", lastName: "Giovannoni", treeId: "tree-a" },
  { id: "lea", firstName: "Léa", lastName: "Giovannoni", treeId: "tree-a" }
];
const baseFamilies = [
  { id: "parents-paul", partnerIds: ["jean", "marie"], childIds: ["paul"], parentChildLinks: [{ parentId: "jean", childId: "paul", type: "biological" }] },
  { id: "union-paul", partnerIds: ["paul", "sophie"], childIds: ["lea"], parentChildLinks: [{ parentId: "sophie", childId: "lea", type: "biological" }] }
];
const baseTrees = [{ id: "tree-a", name: "Giovannoni Orino" }];

function buildPlan({ people = basePeople, families = baseFamilies, trees = baseTrees, personId = "paul", destinationTreeId = "tree-a" } = {}) {
  return prepareIndividualTreeTransferPlan({ personId, people, families, trees, destinationTreeId });
}

test("diagnostic désactivé par défaut et activation contrôlée par l'environnement + le flag", () => {
  assert.equal(isTransferDiagnosticAllowed("recette"), true);
  assert.equal(isTransferDiagnosticAllowed("production"), false);
  assert.equal(isTransferDiagnosticAllowed("local"), false);

  const recetteFlagOff = { getItem: key => (key === TRANSFER_DIAGNOSTIC_STORAGE_KEY ? "0" : null) };
  const recetteFlagOn = { getItem: key => (key === TRANSFER_DIAGNOSTIC_STORAGE_KEY ? "1" : null) };
  const productionFlagOn = recetteFlagOn;
  const brokenStorage = { getItem: () => { throw new Error("stockage indisponible"); } };

  assert.equal(resolveTransferDiagnosticEnabled({ environment: "recette", storage: recetteFlagOff }), false);
  assert.equal(resolveTransferDiagnosticEnabled({ environment: "recette", storage: recetteFlagOn }), true);
  assert.equal(resolveTransferDiagnosticEnabled({ environment: "production", storage: productionFlagOn }), false);
  assert.equal(resolveTransferDiagnosticEnabled({ environment: "local", storage: recetteFlagOn }), false);
  assert.equal(resolveTransferDiagnosticEnabled({ environment: "recette", storage: null }), false);
  assert.equal(resolveTransferDiagnosticEnabled({ environment: "recette", storage: brokenStorage }), false);
});

test("plans identiques : aucune divergence, classification identical", () => {
  const expected = buildPlan();
  const actual = buildPlan();
  assert.deepEqual(compareIndividualTransferPlans(expected, actual), []);
  const analysis = analyzePlanDivergence(expected, actual);
  assert.equal(analysis.fingerprintMatch, true);
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.IDENTICAL);
  assert.equal(analysis.reasonCodes.length, 0);
});

test("ordre de propriétés des filiations équivalent : plus aucune divergence ni conflit", () => {
  /* Scénario du diagnostic Recette : parentChildLinks lu avec un ordre de
     propriétés différent selon la source (cache local vs transaction). */
  const parentFirstFamilies = [
    { id: "parents-paul", partnerIds: ["jean", "marie"], childIds: ["paul"], parentChildLinks: [{ parentId: "jean", childId: "paul", type: "biological" }] },
    { id: "union-paul", partnerIds: ["paul", "sophie"], childIds: ["lea"], parentChildLinks: [{ parentId: "sophie", childId: "lea", type: "biological" }] }
  ];
  const childFirstFamilies = [
    { id: "parents-paul", partnerIds: ["jean", "marie"], childIds: ["paul"], parentChildLinks: [{ childId: "paul", parentId: "jean", type: "biological" }] },
    { id: "union-paul", partnerIds: ["paul", "sophie"], childIds: ["lea"], parentChildLinks: [{ childId: "lea", parentId: "sophie", type: "biological" }] }
  ];
  const expected = buildPlan({ families: parentFirstFamilies });
  const actual = buildPlan({ families: childFirstFamilies });
  assert.equal(expected.fingerprint, actual.fingerprint, "empreintes identiques après normalisation canonique");
  assert.deepEqual(compareIndividualTransferPlans(expected, actual), [], "aucune divergence FAMILY_RELATION_DATA");
  const analysis = analyzePlanDivergence(expected, actual);
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.IDENTICAL);
});

test("ordre de propriétés + vrai changement simultané : le vrai conflit reste confirmé", () => {
  const reference = buildPlan();
  const realChange = buildPlan({
    families: [
      { id: "parents-paul", partnerIds: ["jean", "marie"], childIds: ["paul"], parentChildLinks: [{ childId: "paul", parentId: "jean", type: "adoptive" }] },
      { id: "union-paul", partnerIds: ["paul", "sophie"], childIds: ["lea"], parentChildLinks: [{ parentId: "sophie", childId: "lea", type: "biological" }] }
    ]
  });
  const analysis = analyzePlanDivergence(reference, realChange);
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.CONFIRMED_CONFLICT);
  assert.ok(analysis.reasonCodes.includes(TRANSFER_DIAGNOSTIC_REASON_CODES.FAMILY_RELATION_DATA));
});

test("différence d'appartenance de la personne : SOURCE_TREE_ID + PERSON_IN_TREE", () => {
  const expected = buildPlan();
  const movedPeople = basePeople.map(p => (p.id === "paul" ? { ...p, treeId: "tree-a" } : p));
  const actual = buildPlan({ people: movedPeople, trees: baseTrees.concat({ id: "tree-b", name: "Autre" }), destinationTreeId: "tree-b" });
  const analysis = analyzePlanDivergence(expected, actual);
  assert.equal(analysis.fingerprintMatch, false);
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.CONFIRMED_CONFLICT);
  assert.ok(analysis.reasonCodes.includes(TRANSFER_DIAGNOSTIC_REASON_CODES.SOURCE_TREE_ID));
});

test("différence de composition familiale : FAMILY_SET", () => {
  const expected = buildPlan();
  const fewerFamilies = [baseFamilies[0]];
  const actual = buildPlan({ families: fewerFamilies });
  const analysis = analyzePlanDivergence(expected, actual);
  assert.equal(analysis.fingerprintMatch, false);
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.CONFIRMED_CONFLICT);
  assert.ok(analysis.reasonCodes.includes(TRANSFER_DIAGNOSTIC_REASON_CODES.FAMILY_SET));
});

test("différence d'appartenance d'un membre : FAMILY_MEMBER_DETAIL (treeId)", () => {
  const expected = buildPlan();
  const movedParent = basePeople.map(p => (p.id === "jean" ? { ...p, treeId: "tree-a" } : p));
  const actual = buildPlan({ people: movedParent });
  const analysis = analyzePlanDivergence(expected, actual);
  assert.equal(analysis.fingerprintMatch, false);
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.CONFIRMED_CONFLICT);
  assert.ok(analysis.reasonCodes.includes(TRANSFER_DIAGNOSTIC_REASON_CODES.FAMILY_MEMBER_DETAIL));
  const memberDivergence = analysis.divergences.find(d => d.reasonCode === TRANSFER_DIAGNOSTIC_REASON_CODES.FAMILY_MEMBER_DETAIL);
  assert.ok(memberDivergence.path.includes(".treeId"));
});

test("différence de relation : FAMILY_RELATION_DATA détecte les changements de partnerIds", () => {
  const expected = buildPlan();
  const changedFamily = [{ ...baseFamilies[0], partnerIds: ["jean"] }, baseFamilies[1]];
  const actual = buildPlan({ families: changedFamily });
  const analysis = analyzePlanDivergence(expected, actual);
  assert.equal(analysis.fingerprintMatch, false);
  assert.ok(analysis.reasonCodes.includes(TRANSFER_DIAGNOSTIC_REASON_CODES.FAMILY_MEMBER_IDS)
    || analysis.reasonCodes.includes(TRANSFER_DIAGNOSTIC_REASON_CODES.FAMILY_RELATION_DATA));
});

test("différence de visibilité : FAMILY_VISIBILITY signalée sans impact fingerprint", () => {
  const expected = buildPlan();
  const hiddenParent = basePeople.map(p => (p.id === "jean" ? { ...p, inTree: false } : p));
  const actual = buildPlan({ people: hiddenParent });
  const analysis = analyzePlanDivergence(expected, actual);
  assert.ok(analysis.reasonCodes.includes(TRANSFER_DIAGNOSTIC_REASON_CODES.FAMILY_VISIBILITY)
    || analysis.reasonCodes.includes(TRANSFER_DIAGNOSTIC_REASON_CODES.FAMILY_MEMBER_DETAIL));
  const visibilityDivergence = analysis.divergences.find(d => d.reasonCode === TRANSFER_DIAGNOSTIC_REASON_CODES.FAMILY_VISIBILITY);
  if (visibilityDivergence) assert.equal(visibilityDivergence.fingerprintRelevant, false);
});

test("différence de fingerprint inexpliquée : classification unexplained + FINGERPRINT_UNEXPLAINED", () => {
  const expected = buildPlan();
  const actual = buildPlan();
  /* On altère uniquement la chaîne fingerprint sans toucher à la structure :
     le comparateur ne doit pas conclure à tort à une égalité. */
  actual.fingerprint = expected.fingerprint + "-altéré";
  const analysis = analyzePlanDivergence(expected, actual);
  assert.equal(analysis.fingerprintMatch, false);
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.UNEXPLAINED);
  assert.ok(analysis.reasonCodes.includes(TRANSFER_DIAGNOSTIC_REASON_CODES.FINGERPRINT_UNEXPLAINED));
});

test("fingerprint identique mais structure différente : classification inconsistent", () => {
  const expected = buildPlan();
  const actual = buildPlan();
  actual.summary = { ...actual.summary, affectedFamilyCount: 99 };
  const analysis = analyzePlanDivergence(expected, actual);
  assert.equal(analysis.fingerprintMatch, true);
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.INCONSISTENT);
  assert.ok(analysis.reasonCodes.includes(TRANSFER_DIAGNOSTIC_REASON_CODES.SUMMARY_COUNT));
});

test("données historiques : treeId null et treeId absent produisent le même arbre source", () => {
  const peopleNull = basePeople.map(p => (p.id === "marie" ? { ...p, treeId: null } : p));
  const peopleAbsent = basePeople.map(p => {
    if (p.id !== "marie") return p;
    const copy = { ...p };
    delete copy.treeId;
    return copy;
  });
  const planNull = buildPlan({ people: peopleNull });
  const planAbsent = buildPlan({ people: peopleAbsent });
  assert.equal(planNull.sourceTreeId, MAIN_TREE_ID);
  assert.equal(planAbsent.sourceTreeId, MAIN_TREE_ID);
  assert.equal(planNull.fingerprint, planAbsent.fingerprint);
  assert.deepEqual(compareIndividualTransferPlans(planNull, planAbsent), []);
});

test("personne isolée sans foyer : plan valide, aucune famille", () => {
  const lonelyPeople = [{ id: "paul", firstName: "Paul", lastName: "Test" }, basePeople[3], basePeople[4]];
  const plan = buildPlan({ people: lonelyPeople, families: [] });
  assert.equal(plan.affectedFamilies.length, 0);
  assert.equal(plan.summary.affectedFamilyCount, 0);
  const analysis = analyzePlanDivergence(plan, buildPlan({ people: lonelyPeople, families: [] }));
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.IDENTICAL);
});

test("foyers multiples : tous les foyers référençant la personne sont comparés", () => {
  const expected = buildPlan();
  assert.equal(expected.affectedFamilies.length, 2);
  const analysis = analyzePlanDivergence(expected, buildPlan());
  assert.equal(analysis.familyCount, 2);
  assert.ok(analysis.memberCount >= 4);
});

test("conflit concurrent réel (arbre source modifié) : classification confirmed-conflict", () => {
  const expected = buildPlan();
  const concurrentPeople = basePeople.map(p => (p.id === "paul" ? { ...p, treeId: "tree-b" } : p));
  const concurrentTrees = baseTrees.concat({ id: "tree-b", name: "Autre branche" });
  const concurrent = buildPlan({ people: concurrentPeople, trees: concurrentTrees, destinationTreeId: "tree-a" });
  const analysis = analyzePlanDivergence(expected, concurrent);
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.CONFIRMED_CONFLICT);
});

test("transfert obsolète (foyer modifié) : classification confirmed-conflict", () => {
  const expected = buildPlan();
  const stale = buildPlan({ families: [{ ...baseFamilies[1], childIds: [] }, baseFamilies[0]] });
  const analysis = analyzePlanDivergence(expected, stale);
  assert.equal(analysis.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.CONFIRMED_CONFLICT);
});

test("rapport : aucun nom, aucune note, aucun ID Firestore brut, fingerprint réduit", () => {
  const expected = buildPlan();
  const concurrentPeople = basePeople.map(p => (p.id === "paul" ? { ...p, treeId: "tree-b" } : p));
  const concurrentTrees = baseTrees.concat({ id: "tree-b", name: "Autre branche" });
  const actual = buildPlan({ people: concurrentPeople, trees: concurrentTrees, destinationTreeId: "tree-a" });
  const report = buildTransferDiagnosticReport({
    stage: TRANSFER_DIAGNOSTIC_STAGES.FRESH_VS_TRANSACTION, expectedPlan: expected, actualPlan: actual
  });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("Paul"), "le prénom ne doit pas apparaître");
  assert.ok(!serialized.includes("Test"), "le nom de famille ne doit pas apparaître");
  assert.ok(!serialized.includes("Notes secrètes"), "les notes ne doivent pas apparaître");
  assert.ok(!serialized.includes("Giovannoni"), "le nom d'arbre ne doit pas apparaître");
  assert.ok(!serialized.includes('"paul"'), "l'ID Firestore brut ne doit pas apparaître");
  assert.ok(!serialized.includes('"parents-paul"'), "l'ID de foyer brut ne doit pas apparaître");
  assert.equal(typeof report.fingerprintHashes.expected, "string");
  assert.ok(report.fingerprintHashes.expected.length < 20, "le fingerprint est réduit à un hash court");
  assert.equal(report.stage, TRANSFER_DIAGNOSTIC_STAGES.FRESH_VS_TRANSACTION);
});

test("rapport d'erreur : classification error, code Firestore conservé", () => {
  const expected = buildPlan();
  const error = new Error("permission denied");
  error.code = "permission-denied";
  const report = buildTransferDiagnosticReport({ stage: TRANSFER_DIAGNOSTIC_STAGES.ERROR, expectedPlan: expected, error });
  assert.equal(report.classification, TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.ERROR);
  assert.equal(report.error.code, "permission-denied");
  assert.equal(report.error.stale, false);
  assert.equal(report.divergences.length, 0);
});

test("les comparaisons n'altèrent pas les plans d'entrée", () => {
  const expected = buildPlan();
  const actual = buildPlan();
  const expectedSnapshot = JSON.stringify(expected);
  const actualSnapshot = JSON.stringify(actual);
  compareIndividualTransferPlans(expected, actual);
  analyzePlanDivergence(expected, actual);
  buildTransferDiagnosticReport({ stage: TRANSFER_DIAGNOSTIC_STAGES.PREVIEW_VS_FRESH, expectedPlan: expected, actualPlan: actual });
  assert.equal(JSON.stringify(expected), expectedSnapshot);
  assert.equal(JSON.stringify(actual), actualSnapshot);
});

test("le module de diagnostic n'effectue aucune écriture distante ni accès DOM", () => {
  const source = readFileSync(new URL("../js/transfer-diagnostic.js", import.meta.url), "utf8");
  assert.ok(!/\bfetch\s*\(/.test(source), "pas d'appel fetch");
  assert.ok(!/XMLHttpRequest/.test(source), "pas d'XHR");
  assert.ok(!/indexedDB/.test(source), "pas d'IndexedDB");
  assert.ok(!/\bdocument\s*\./.test(source), "pas d'accès document");
  assert.ok(!/\bwindow\s*\./.test(source), "pas d'accès window");
  assert.ok(!/navigator/.test(source), "pas de navigator");
});

test("l'instrumentation app.js est bien câblée et préserve les messages existants", () => {
  const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.ok(source.includes("resolveTransferDiagnosticEnabled"), "activation via le module de diagnostic");
  assert.ok(source.includes("TRANSFER_DIAGNOSTIC_STAGES.PREVIEW_VS_FRESH"), "instrumentation A (aperçu vs relecture)");
  assert.ok(source.includes("TRANSFER_DIAGNOSTIC_STAGES.FRESH_VS_TRANSACTION"), "instrumentation B (relecture vs transaction)");
  assert.ok(source.includes("TRANSFER_DIAGNOSTIC_STAGES.ERROR"), "instrumentation C (erreur Firestore)");
  assert.ok(source.includes("recordTransferDiagnostic"), "enregistrement des rapports");
  assert.ok(source.includes("Les relations ou l'appartenance ont changé depuis l'aperçu"), "message A inchangé");
  assert.ok(source.includes("Les relations ou l'appartenance ont changé pendant la confirmation"), "message B inchangé");
  assert.ok(source.includes("tree-transfer-stale"), "code de refus inchangé");
  assert.ok(source.includes("transaction.update(personRef, changes)"), "écriture transactionnelle inchangée");
});

test("non-régression Lot 4B : le transfert n'écrit que treeId (+ updatedBy si nécessaire)", () => {
  const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.ok(/const\s+changes\s*=\s*\{\s*treeId:\s*expectedPlan\.destinationTreeId\s*\}/.test(source),
    "les changements restent limités à treeId");
  assert.ok(!/changes\.birthDate/.test(source));
  assert.ok(!/changes\.notes/.test(source));
});
