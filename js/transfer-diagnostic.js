/* Diagnostic temporaire du transfert individuel (Lot 4C).
   Compare deux plans de transfert pour identifier précisément la divergence.
   Module PUR : aucune lecture de window/document à l'import, aucune écriture,
   aucun accès réseau, aucune altération des plans comparés.
   Confidentialité : noms de personnes et d'arbres hachés, IDs hachés,
   fingerprints réduits à un hash. Aucune donnée personnelle en clair. */

export const TRANSFER_DIAGNOSTIC_STORAGE_KEY = "transferDiagnostic";

export const TRANSFER_DIAGNOSTIC_STAGES = Object.freeze({
  PREVIEW_VS_FRESH: "preview-vs-fresh",
  FRESH_VS_TRANSACTION: "fresh-vs-transaction",
  ERROR: "error"
});

export const TRANSFER_DIAGNOSTIC_CLASSIFICATIONS = Object.freeze({
  IDENTICAL: "identical",
  CONFIRMED_CONFLICT: "confirmed-conflict",
  UNEXPLAINED: "unexplained",
  INCONSISTENT: "inconsistent",
  ERROR: "error"
});

const REASON_CODES = Object.freeze({
  PERSON_ID: "PERSON_ID",
  PERSON_NAME: "PERSON_NAME",
  PERSON_IN_TREE: "PERSON_IN_TREE",
  SOURCE_TREE_ID: "SOURCE_TREE_ID",
  SOURCE_TREE_NAME: "SOURCE_TREE_NAME",
  DESTINATION_TREE_ID: "DESTINATION_TREE_ID",
  DESTINATION_TREE_NAME: "DESTINATION_TREE_NAME",
  FAMILY_SET: "FAMILY_SET",
  FAMILY_ORDER: "FAMILY_ORDER",
  FAMILY_MEMBER_IDS: "FAMILY_MEMBER_IDS",
  FAMILY_MEMBER_DETAIL: "FAMILY_MEMBER_DETAIL",
  FAMILY_RELATION_DATA: "FAMILY_RELATION_DATA",
  FAMILY_VISIBILITY: "FAMILY_VISIBILITY",
  FAMILY_UNRESOLVED: "FAMILY_UNRESOLVED",
  FAMILY_INVALID_MEMBERSHIP: "FAMILY_INVALID_MEMBERSHIP",
  SUMMARY_COUNT: "SUMMARY_COUNT",
  FINGERPRINT_UNEXPLAINED: "FINGERPRINT_UNEXPLAINED"
});

export { REASON_CODES as TRANSFER_DIAGNOSTIC_REASON_CODES };

const PLAIN_STRING_KEYS = new Set(["type", "relationType", "endType", "filiationType", "visibilityChange"]);
const MAIN_LITERAL = "main";
const MAX_REPORTED_DIVERGENCES = 50;

/* Activation : uniquement sur Recette, uniquement si le flag de session est à "1".
   Le storage est injecté (sessionStorage-like) pour rester pur et testable. */
export function isTransferDiagnosticAllowed(environment) {
  return environment === "recette";
}

export function resolveTransferDiagnosticEnabled({ environment, storage } = {}) {
  if (!isTransferDiagnosticAllowed(environment)) return false;
  try {
    return !!storage && storage.getItem(TRANSFER_DIAGNOSTIC_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/* Hash déterministe FNV-1a 32 bits, tronqué. Sert à comparer sans exposer. */
export function hashId(value) {
  if (value === MAIN_LITERAL) return MAIN_LITERAL;
  if (value == null) return "";
  const str = String(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return "h" + (hash >>> 0).toString(16).padStart(8, "0");
}

/* Rédaction récursive : les chaînes sont hachées sauf pour les clés énumérées
   (types de relation, visibilité) qui ne sont pas personnelles. */
function redactValue(value, key) {
  if (Array.isArray(value)) return value.map(item => redactValue(item, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) out[childKey] = redactValue(childValue, childKey);
    return out;
  }
  if (typeof value === "string") return PLAIN_STRING_KEYS.has(key) ? value : hashId(value);
  return value;
}

function scalarDivergence(reasonCode, path, expected, actual, { hash = true } = {}) {
  if (expected === actual) return null;
  return {
    reasonCode,
    path,
    fingerprintRelevant: true,
    expected: hash ? hashId(expected) : expected,
    actual: hash ? hashId(actual) : actual
  };
}

/* Compare deux plans individuels. Retourne une liste structurée de divergences.
   Chaque divergence porte un reasonCode, un chemin, si elle impacte le
   fingerprint (fingerprintRelevant) et des valeurs déjà rédigées. */
export function compareIndividualTransferPlans(expectedPlan, actualPlan) {
  const divergences = [];
  if (!expectedPlan || !actualPlan) return divergences;

  const scalarChecks = [
    { code: REASON_CODES.PERSON_ID, path: "personId" },
    { code: REASON_CODES.PERSON_NAME, path: "personName" },
    { code: REASON_CODES.PERSON_IN_TREE, path: "personInTree", hash: false },
    { code: REASON_CODES.SOURCE_TREE_ID, path: "sourceTreeId" },
    { code: REASON_CODES.SOURCE_TREE_NAME, path: "sourceTreeName" },
    { code: REASON_CODES.DESTINATION_TREE_ID, path: "destinationTreeId" },
    { code: REASON_CODES.DESTINATION_TREE_NAME, path: "destinationTreeName" }
  ];
  for (const check of scalarChecks) {
    const divergence = scalarDivergence(check.code, check.path, expectedPlan[check.path], actualPlan[check.path], { hash: check.hash !== false });
    if (divergence) divergences.push(divergence);
  }

  const expectedFamilies = expectedPlan.affectedFamilies || [];
  const actualFamilies = actualPlan.affectedFamilies || [];
  const expectedFamilyIds = expectedFamilies.map(family => family.familyId);
  const actualFamilyIds = actualFamilies.map(family => family.familyId);
  const expectedFamilySet = new Set(expectedFamilyIds);
  const actualFamilySet = new Set(actualFamilyIds);
  const missingFamilies = expectedFamilyIds.filter(id => !actualFamilySet.has(id));
  const extraFamilies = actualFamilyIds.filter(id => !expectedFamilySet.has(id));
  if (missingFamilies.length || extraFamilies.length) {
    divergences.push({
      reasonCode: REASON_CODES.FAMILY_SET,
      path: "affectedFamilies",
      fingerprintRelevant: true,
      missingInActual: missingFamilies.map(hashId),
      extraInActual: extraFamilies.map(hashId)
    });
  } else if (JSON.stringify(expectedFamilyIds) !== JSON.stringify(actualFamilyIds)) {
    divergences.push({ reasonCode: REASON_CODES.FAMILY_ORDER, path: "affectedFamilies.order", fingerprintRelevant: true });
  }

  const actualFamilyById = new Map(actualFamilies.map(family => [family.familyId, family]));
  for (const expectedFamily of expectedFamilies) {
    const actualFamily = actualFamilyById.get(expectedFamily.familyId);
    if (!actualFamily) continue;
    const familyPath = `family(${hashId(expectedFamily.familyId)})`;

    const expectedMemberIds = expectedFamily.memberIds || [];
    const actualMemberIds = actualFamily.memberIds || [];
    if (JSON.stringify(expectedMemberIds) !== JSON.stringify(actualMemberIds)) {
      const expectedMemberSet = new Set(expectedMemberIds);
      const actualMemberSet = new Set(actualMemberIds);
      const missingMembers = expectedMemberIds.filter(id => !actualMemberSet.has(id));
      const extraMembers = actualMemberIds.filter(id => !expectedMemberSet.has(id));
      divergences.push({
        reasonCode: missingMembers.length || extraMembers.length ? REASON_CODES.FAMILY_MEMBER_IDS : REASON_CODES.FAMILY_MEMBER_IDS,
        path: `${familyPath}.memberIds`,
        fingerprintRelevant: true,
        orderOnly: !missingMembers.length && !extraMembers.length,
        missingInActual: missingMembers.map(hashId),
        extraInActual: extraMembers.map(hashId)
      });
    }

    const actualMemberById = new Map((actualFamily.members || []).map(member => [member.id, member]));
    for (const expectedMember of expectedFamily.members || []) {
      const actualMember = actualMemberById.get(expectedMember.id);
      const memberPath = `${familyPath}.member(${hashId(expectedMember.id)})`;
      if (!actualMember) {
        divergences.push({ reasonCode: REASON_CODES.FAMILY_MEMBER_DETAIL, path: memberPath, fingerprintRelevant: true, issue: "missing-in-actual" });
        continue;
      }
      const memberFields = [
        { field: "name", hash: true },
        { field: "treeId", hash: true },
        { field: "inTree", hash: false },
        { field: "exists", hash: false }
      ];
      for (const { field, hash } of memberFields) {
        if (expectedMember[field] === actualMember[field]) continue;
        divergences.push({
          reasonCode: REASON_CODES.FAMILY_MEMBER_DETAIL,
          path: `${memberPath}.${field}`,
          fingerprintRelevant: true,
          expected: hash ? hashId(expectedMember[field]) : expectedMember[field],
          actual: hash ? hashId(actualMember[field]) : actualMember[field]
        });
      }
    }

    /* Les entrées affectedFamilies portent `relationData` (et non `relations`) :
       c'est bien ce champ qui alimente le fingerprint via familyReferences. */
    const expectedRelations = expectedFamily.relationData || null;
    const actualRelations = actualFamily.relationData || null;
    if (JSON.stringify(expectedRelations) !== JSON.stringify(actualRelations)) {
      const relationKeys = new Set([
        ...Object.keys(expectedRelations || {}),
        ...Object.keys(actualRelations || {})
      ]);
      const changedFields = [...relationKeys].filter(key =>
        JSON.stringify(expectedRelations?.[key] ?? null) !== JSON.stringify(actualRelations?.[key] ?? null)
      );
      divergences.push({
        reasonCode: REASON_CODES.FAMILY_RELATION_DATA,
        path: `${familyPath}.relationData`,
        fingerprintRelevant: true,
        changedFields,
        expected: redactValue(expectedRelations, "relationData"),
        actual: redactValue(actualRelations, "relationData")
      });
    }

    const visibilityFields = [
      { field: "beforeVisibleTreeIds", relevant: false },
      { field: "afterVisibleTreeIds", relevant: false },
      { field: "visibilityChange", relevant: false, plain: true }
    ];
    for (const { field, relevant, plain } of visibilityFields) {
      if (JSON.stringify(expectedFamily[field] ?? null) === JSON.stringify(actualFamily[field] ?? null)) continue;
      divergences.push({
        reasonCode: REASON_CODES.FAMILY_VISIBILITY,
        path: `${familyPath}.${field}`,
        fingerprintRelevant: relevant,
        expected: plain ? (expectedFamily[field] ?? null) : redactValue(expectedFamily[field] ?? null, field),
        actual: plain ? (actualFamily[field] ?? null) : redactValue(actualFamily[field] ?? null, field)
      });
    }

    if (JSON.stringify(expectedFamily.unresolvedPersonIds ?? null) !== JSON.stringify(actualFamily.unresolvedPersonIds ?? null)) {
      divergences.push({
        reasonCode: REASON_CODES.FAMILY_UNRESOLVED,
        path: `${familyPath}.unresolvedPersonIds`,
        fingerprintRelevant: false,
        expected: (expectedFamily.unresolvedPersonIds || []).map(hashId),
        actual: (actualFamily.unresolvedPersonIds || []).map(hashId)
      });
    }
    if (JSON.stringify(expectedFamily.invalidMembershipIds ?? null) !== JSON.stringify(actualFamily.invalidMembershipIds ?? null)) {
      divergences.push({
        reasonCode: REASON_CODES.FAMILY_INVALID_MEMBERSHIP,
        path: `${familyPath}.invalidMembershipIds`,
        fingerprintRelevant: false,
        expected: (expectedFamily.invalidMembershipIds || []).map(hashId),
        actual: (actualFamily.invalidMembershipIds || []).map(hashId)
      });
    }
  }

  if (JSON.stringify(expectedPlan.summary || null) !== JSON.stringify(actualPlan.summary || null)) {
    divergences.push({ reasonCode: REASON_CODES.SUMMARY_COUNT, path: "summary", fingerprintRelevant: false, expected: expectedPlan.summary || null, actual: actualPlan.summary || null });
  }

  return divergences;
}

/* Analyse complète : fingerprint + comparaison structurelle + classification.
   - identical            : fingerprint identique et aucune divergence.
   - confirmed-conflict   : fingerprint différent ET au moins une divergence
                            impactant le fingerprint (conflit réel identifié).
   - unexplained          : fingerprint différent mais aucune divergence
                            structurelle pertinente (cas à investiguer).
   - inconsistent         : fingerprint identique mais divergences structurelles
                            (le comparateur couvre plus que le fingerprint). */
export function analyzePlanDivergence(expectedPlan, actualPlan) {
  const fingerprintMatch = !!expectedPlan && !!actualPlan && expectedPlan.fingerprint === actualPlan.fingerprint;
  const divergences = compareIndividualTransferPlans(expectedPlan, actualPlan);
  const relevantDivergences = divergences.filter(divergence => divergence.fingerprintRelevant);

  let classification;
  if (fingerprintMatch && !divergences.length) classification = TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.IDENTICAL;
  else if (!fingerprintMatch && relevantDivergences.length) classification = TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.CONFIRMED_CONFLICT;
  else if (!fingerprintMatch) classification = TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.UNEXPLAINED;
  else classification = TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.INCONSISTENT;

  if (!fingerprintMatch && !relevantDivergences.length) {
    divergences.push({
      reasonCode: REASON_CODES.FINGERPRINT_UNEXPLAINED,
      path: "fingerprint",
      fingerprintRelevant: true,
      note: "fingerprints différents mais aucune différence structurelle pertinente détectée par le comparateur"
    });
  }

  const memberIds = new Set();
  let familyCount = 0;
  for (const family of expectedPlan?.affectedFamilies || []) {
    familyCount++;
    for (const id of family.memberIds || []) memberIds.add(id);
  }

  return {
    fingerprintMatch,
    classification,
    divergences,
    reasonCodes: [...new Set(divergences.map(divergence => divergence.reasonCode))],
    familyCount,
    memberCount: memberIds.size
  };
}

/* Rapport compact, sans données personnelles ni IDs Firestore bruts.
   stage : "preview-vs-fresh" (A), "fresh-vs-transaction" (B), "error" (C). */
export function buildTransferDiagnosticReport({ stage, expectedPlan = null, actualPlan = null, error = null } = {}) {
  const analysis = actualPlan ? analyzePlanDivergence(expectedPlan, actualPlan) : null;
  const referencePlan = actualPlan || expectedPlan;
  const truncated = analysis && analysis.divergences.length > MAX_REPORTED_DIVERGENCES;
  const report = {
    v: 1,
    at: new Date().toISOString(),
    stage,
    classification: error && !analysis ? TRANSFER_DIAGNOSTIC_CLASSIFICATIONS.ERROR : analysis?.classification,
    fingerprintMatch: analysis ? analysis.fingerprintMatch : null,
    reasonCodes: analysis ? analysis.reasonCodes : [],
    familyCount: analysis ? analysis.familyCount : 0,
    memberCount: analysis ? analysis.memberCount : 0,
    sourceTree: referencePlan ? hashId(referencePlan.sourceTreeId) : null,
    destinationTree: referencePlan ? hashId(referencePlan.destinationTreeId) : null,
    fingerprintHashes: {
      expected: expectedPlan ? hashId(expectedPlan.fingerprint) : null,
      actual: actualPlan ? hashId(actualPlan.fingerprint) : null
    },
    divergences: analysis ? (truncated ? analysis.divergences.slice(0, MAX_REPORTED_DIVERGENCES) : analysis.divergences) : []
  };
  if (truncated) report.divergencesTruncated = analysis.divergences.length - MAX_REPORTED_DIVERGENCES;
  if (error) report.error = { code: error.code || "non-firestore", stale: error.code === "tree-transfer-stale" };
  return report;
}
