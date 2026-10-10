import assert from "node:assert/strict";

/* Contrat de sécurité durable des règles. Les snapshots v16/v17/v18 restent
   historiques; on vérifie ici les invariants utiles sans figer tout le fichier. */
export function assertFirestoreRulesSafety(rules) {
  assert.match(rules, /rules_version\s*=\s*'2'/);
  assert.match(rules, /function signedIn\(\)\s*\{\s*return request\.auth != null;/);
  assert.match(rules, /function isApproved\(\)/);
  assert.match(rules, /function isAdmin\(\)/);
  const familyValidationStart = rules.indexOf("function validFamily()");
  const chunkValidationStart = rules.indexOf("function validChunk()");
  const familyValidation = rules.slice(familyValidationStart, chunkValidationStart);
  assert.ok(familyValidationStart >= 0 && chunkValidationStart > familyValidationStart, "validation de famille présente");
  assert.match(familyValidation, /partnerIds\.size\(\) <= 2/);
  assert.match(familyValidation, /parentChildLinks/);
  const userValidationStart = rules.indexOf("function validUser()");
  const otherValidation = rules.slice(chunkValidationStart, userValidationStart);
  assert.match(otherValidation, /data\.size\(\) <= 700 \* 1024/);
  const treeValidationStart = rules.indexOf("function validTree(treeId)");
  assert.ok(treeValidationStart >= 0, "validation d'arbre présente");
  const treeValidation = rules.slice(treeValidationStart, userValidationStart);
  assert.match(treeValidation, /treeId != 'main'/, "aucun document trees/main");
  assert.match(treeValidation, /hasOnly\(\['name', 'description', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'\]\)/);

  const settingsStart = rules.indexOf("match /settings/access {");
  const usersStart = rules.indexOf("match /users/{userId}");
  const peopleStart = rules.indexOf("match /people/{personId}");
  const treesStart = rules.indexOf("match /trees/{treeId}");
  const familiesStart = rules.indexOf("match /families/{familyId}");
  const documentsStart = rules.indexOf("match /documents/{documentId}");
  const chunksStart = rules.indexOf("match /documentChunks/{chunkId}");
  const tasksStart = rules.indexOf("match /tasks/{taskId}");
  const proceduresStart = rules.indexOf("match /procedures/{dossierId}");
  const catchAllStart = rules.indexOf("match /{document=**}");
  for (const [name, index] of Object.entries({ settingsStart, usersStart, peopleStart, treesStart, familiesStart, documentsStart, chunksStart, tasksStart, proceduresStart, catchAllStart })) {
    assert.ok(index >= 0, `Bloc Firestore manquant : ${name}`);
  }

  const settings = rules.slice(settingsStart, usersStart);
  assert.match(settings, /allow update, delete: if false;/, "settings/access reste immuable après bootstrap");

  const users = rules.slice(usersStart, peopleStart);
  assert.match(users, /allow get: if signedIn\(\)/);
  assert.match(users, /allow list: if isAdmin\(\) \|\| \(isApproved\(\) && resource\.data\.status == 'approved'\);/);
  assert.match(users, /allow create: if signedIn\(\).*validUser\(\)/s);
  assert.match(users, /allow update: if validUser\(\)/);
  assert.match(users, /affectedKeys\(\)\.hasOnly\(\['displayName', 'photo', 'updatedAt'\]\)/, "auto-modification utilisateur limitée");
  assert.match(users, /allow delete: if false;/, "profils utilisateurs non supprimables");

  const people = rules.slice(peopleStart, treesStart);
  assert.match(people, /allow read, delete: if isApproved\(\);/);
  assert.match(people, /allow create: if isApproved\(\).*validPerson\(\).*validUpdatedBy\(\)/s);
  assert.match(people, /allow update: if isApproved\(\).*validPerson\(\).*validUpdatedBy\(\)/s);
  assert.match(people, /validPersonTreeReference\(\)/, "les références treeId sont contrôlées");
  assert.match(people, /hasAny\(\['treeId'\]\).*isAdmin\(\)/, "le déplacement entre arbres est contrôlé");
  const createAssignmentStart = rules.indexOf("function validPersonTreeAssignmentOnCreate()");
  const createAssignmentEnd = rules.indexOf("function validTree(treeId)");
  const createAssignment = rules.slice(createAssignmentStart, createAssignmentEnd);
  assert.match(createAssignment, /isApproved\(\)/, "un membre approuvé peut créer dans un arbre secondaire");
  assert.match(createAssignment, /existsAfter\([\s\S]*trees/,
    "la création secondaire exige un arbre cible existant");
  assert.match(createAssignment, /request\.resource\.data\.treeId == null/,
    "treeId null reste rétrocompatible");
  assert.match(rules.slice(0, createAssignmentStart), /request\.resource\.data\.treeId == null/,
    "les mises à jour gardent valides les fiches historiques avec treeId null");
  assert.doesNotMatch(createAssignment, /isAdmin\(\)/,
    "la création secondaire n'est pas réservée aux administrateurs");

  const families = rules.slice(familiesStart, documentsStart);
  assert.match(families, /allow read, delete: if isApproved\(\);/);
  assert.match(families, /allow create, update: if isApproved\(\) && validFamily\(\)/);

  const documents = rules.slice(documentsStart, chunksStart);
  assert.match(documents, /allow read, create, update, delete: if isApproved\(\);/);
  const chunks = rules.slice(chunksStart, tasksStart);
  assert.match(chunks, /allow create, update: if isApproved\(\) && validChunk\(\)/);

  const trees = rules.slice(treesStart, familiesStart);
  assert.match(trees, /allow read: if isApproved\(\);/);
  assert.match(trees, /allow create, update: if isAdmin\(\) && validTree\(treeId\)/);
  assert.match(trees, /allow delete: if false;/, "suppression différée jusqu'à l'existence d'un protocole sûr");

  const procedures = rules.slice(proceduresStart, catchAllStart);
  assert.match(procedures, /allow read: if isApproved\(\);/);
  assert.match(procedures, /validProcedure\(\)/);
  assert.match(procedures, /validProcedureAction\(\)/);

  assert.match(rules.slice(catchAllStart), /allow read, write: if false;/, "le catch-all continue de refuser l'accès");
}
