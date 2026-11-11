// Validation locale des règles candidat du lot 2C.5-A sur l'émulateur Firestore.
// Fichier volontairement sans suffixe .test / préfixe test- : il n'est PAS
// auto-découvert par `node --test tests/` (il échouerait sans émulateur et sans
// les règles candidat). Lancement exclusif :
//   npx firebase emulators:exec --only firestore,auth --project family-tree-emulator-test --config firebase.fact-hypotheses.candidate.json "node --test tests/fact-hypotheses-rules.mjs"
// Les règles publiées (firestore.rules, gelé) ne sont JAMAIS modifiées par ce
// fichier ; le canari échoue explicitement si les règles standard sont chargées.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  initializeFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  collection, query, where, runTransaction, serverTimestamp, deleteField, writeBatch
} from "firebase/firestore";
import { createFactHypothesesStore } from "../js/fact-hypotheses-store.js";
import { assertLocalEmulator, assertFictiveProject, EMULATOR_PROJECT_ID } from "./emulator-guard.mjs";

const config = assertLocalEmulator(process.env);
assertFictiveProject(EMULATOR_PROJECT_ID);
const HOST = config.host;
const EMULATOR_PORT = config.port;
const AUTH_PORT = 9099;

const ADMIN_EMAIL = "admin-rules-candidat@test-fictif.fr";
const ADMIN_PASSWORD = "admin-fictif-123";
const MEMBER_EMAIL = "membre-rules-candidat@test-fictif.fr";
const MEMBER_PASSWORD = "membre-fictif-123";

console.log(`\n  [fact-hypotheses-rules] règles candidat — émulateur ${HOST}:${EMULATOR_PORT}\n`);

let app;
let auth;
let db;
let adminUid;
let memberUid;
let store;

async function signOutAll() {
  try { await signOut(auth); } catch { /* aucune session */ }
}

async function expectDenied(promise, label) {
  await assert.rejects(promise, error => {
    assert.match(
      error.code || "",
      /permission-denied|PERMISSION_DENIED/i,
      `${label} — code inattendu : ${error.code} — ${error.message}`
    );
    return true;
  });
}

function personRecord(id, overrides = {}) {
  return {
    lastName: "Hypothèses",
    firstName: "Cas",
    treeId: "main",
    birthDateInfo: { type: "exact", value: "1869-09-13" },
    birthDate: "1869-09-13",
    ...overrides
  };
}

const ALL_HYPOTHESIS_KEYS = ["personId", "fieldKey", "value", "status", "initialFromFiche", "justification", "attestations", "documentIds", "sourceIds", "proofIds", "authorUid", "createdAt", "updatedAt", "currentRevisionId"];

function validAlternativeDoc(personId, overrides = {}) {
  return {
    personId,
    fieldKey: "birth.date",
    value: { type: "year", year: 1872 },
    status: "alternative",
    initialFromFiche: false,
    justification: "",
    attestations: [],
    documentIds: [],
    sourceIds: [],
    proofIds: [],
    authorUid: memberUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: memberUid,
    currentRevisionId: "canary-rev-1",
    ...overrides
  };
}

/* État métier d'une hypothèse pour la révision (sans métadonnées), en miroir
   de snapshotData() du store. */
function revisionSnapshot(hypothesis) {
  const { createdAt: _c, updatedAt: _u, updatedBy: _ub, authorUid: _a, ...snapshot } = hypothesis;
  return snapshot;
}

function revisionFor(headId, hypothesis, { previousRevisionId = null, operation = "created", dataOverrides = {} } = {}) {
  return {
    objectId: headId,
    personId: hypothesis.personId,
    fieldKey: hypothesis.fieldKey,
    operation,
    authorUid: memberUid,
    createdAt: serverTimestamp(),
    previousRevisionId,
    justification: hypothesis.justification || "",
    data: { ...revisionSnapshot(hypothesis), ...dataOverrides }
  };
}

/* Écriture légitime brute : hypothèse + sa révision neuve dans le MÊME lot
   (les rules exigent la révision dans la même transaction/le même lot). */
async function writeHypothesisWithRevision(headId, hypothesis, options = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, "factHypotheses", headId), hypothesis);
  batch.set(doc(db, "factHypothesisRevisions", hypothesis.currentRevisionId), revisionFor(headId, hypothesis, options));
  await batch.commit();
}

before(async () => {
  app = initializeApp({ apiKey: "test-only-fake-api-key", projectId: EMULATOR_PROJECT_ID });
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, { disableWarnings: true });
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
  connectFirestoreEmulator(db, HOST, EMULATOR_PORT);

  const adminCred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
  adminUid = adminCred.user.uid;
  await setDoc(doc(db, "settings", "access"), { primaryAdminUid: adminUid });
  await setDoc(doc(db, "users", adminUid), {
    email: ADMIN_EMAIL, displayName: "Administrateur Candidat",
    photo: "", role: "admin", status: "approved"
  });

  await signOutAll();
  const memberCred = await createUserWithEmailAndPassword(auth, MEMBER_EMAIL, MEMBER_PASSWORD);
  memberUid = memberCred.user.uid;
  await setDoc(doc(db, "users", memberUid), {
    email: MEMBER_EMAIL, displayName: "Membre Candidat",
    photo: "", role: "member", status: "pending"
  });
  await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
  await updateDoc(doc(db, "users", memberUid), { status: "approved" });
  await signOutAll();
  await signInWithEmailAndPassword(auth, MEMBER_EMAIL, MEMBER_PASSWORD);

  store = createFactHypothesesStore(db, {
    doc, collection, query, where, getDocs, runTransaction, serverTimestamp, deleteField
  });
});

after(async () => {
  await signOutAll();
  if (app) await deleteApp(app).catch(() => {});
});

test("GARDE : règles candidat actives (canari autorisé par le bloc ajouté)", async () => {
  await setDoc(doc(db, "people", "p-canary"), personRecord("p-canary"));
  try {
    await writeHypothesisWithRevision("canary-hyp", validAlternativeDoc("p-canary"));
  } catch (error) {
    throw new Error(
      `Canari refusé (${error.code}) : les règles standard sont probablement chargées. `
      + "Vérifiez --config firebase.fact-hypotheses.candidate.json et la génération du candidat."
    );
  }
  const snapshot = await getDoc(doc(db, "factHypotheses", "canary-hyp"));
  assert.equal(snapshot.exists(), true);
  const revision = await getDoc(doc(db, "factHypothesisRevisions", "canary-rev-1"));
  assert.equal(revision.exists(), true, "révision canari écrite dans le même lot");
});

test("création d'une hypothèse pour une personne inexistante refusée", async () => {
  await expectDenied(
    writeHypothesisWithRevision("orphan-hyp", validAlternativeDoc("personne-absente", {
      currentRevisionId: "orphan-hyp-rev-1"
    })),
    "hypothèse orpheline"
  );
});

test("création d'une hypothèse retenue sans écriture d'ancre refusée", async () => {
  await setDoc(doc(db, "people", "p-sans-ancre"), personRecord("p-sans-ancre"));
  await expectDenied(
    writeHypothesisWithRevision("retained-sans-ancre", validAlternativeDoc("p-sans-ancre", {
      status: "retained",
      value: { type: "exact", value: "1869-09-13" },
      currentRevisionId: "retained-sans-ancre-rev-1"
    })),
    "retenue sans ancre"
  );
});

test("parcours complet avec le store réel : promotion, remplacement, correction, rejet", async () => {
  await setDoc(doc(db, "people", "p-promo"), personRecord("p-promo"));

  const created = await store.createHypothesis({
    personId: "p-promo", fieldKey: "birth.date",
    value: { type: "year", year: 1870 },
    justification: "Autre dépouillement", actorUid: memberUid
  });
  assert.equal(created.created.length, 2);
  const initialId = "fh_init_p-promo_birth.date";
  const alternative = created.created.find(item => item.id !== initialId);

  let person = (await getDoc(doc(db, "people", "p-promo"))).data();
  assert.equal(person.retainedHypothesis["birth.date"], initialId);
  assert.deepEqual(person.birthDateInfo, { type: "exact", value: "1869-09-13" });

  await store.setRetained({
    personId: "p-promo", fieldKey: "birth.date", hypothesisId: alternative.id,
    justification: "Acte de mariage retrouvé", actorUid: memberUid, expectedAnchor: initialId
  });
  person = (await getDoc(doc(db, "people", "p-promo"))).data();
  assert.equal(person.retainedHypothesis["birth.date"], alternative.id);
  assert.deepEqual(person.birthDateInfo, { type: "year", year: 1870 });
  assert.equal("birthDate" in person, false, "le miroir legacy exact est retiré pour une valeur année");

  await store.correctValue({
    personId: "p-promo", fieldKey: "birth.date", hypothesisId: alternative.id,
    value: { type: "year", year: 1871 }, justification: "Recoupement", actorUid: memberUid
  });
  person = (await getDoc(doc(db, "people", "p-promo"))).data();
  assert.deepEqual(person.birthDateInfo, { type: "year", year: 1871 });

  await store.rejectHypothesis({
    personId: "p-promo", fieldKey: "birth.date", hypothesisId: initialId,
    justification: "Date réfutée", actorUid: memberUid
  });
  assert.equal((await getDoc(doc(db, "factHypotheses", initialId))).data().status, "rejected");

  const revisions = await getDocs(query(collection(db, "factHypothesisRevisions"), where("personId", "==", "p-promo")));
  assert.ok(revisions.size >= 4, `révisions tracées : ${revisions.size}`);
});

test("remplacement sans justification refusé par les règles (contournement client)", async () => {
  await setDoc(doc(db, "people", "p-force"), personRecord("p-force"));
  const created = await store.createHypothesis({
    personId: "p-force", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const initialId = "fh_init_p-force_birth.date";
  const alternative = created.created.find(item => item.id !== initialId);
  const before = (await getDoc(doc(db, "people", "p-force"))).data();

  /* Transaction par ailleurs parfaitement cohérente : deux hypothèses écrites
     avec leurs révisions neuves et l'ancre basculée — seule la justification
     manquante du remplacement doit faire échouer la transaction. */
  await expectDenied(
    runTransaction(db, async transaction => {
      const initialSnapshot = await transaction.get(doc(db, "factHypotheses", initialId));
      const alternativeSnapshot = await transaction.get(doc(db, "factHypotheses", alternative.id));
      const demoted = {
        ...initialSnapshot.data(), status: "alternative",
        currentRevisionId: `${initialId}-rogue-1`,
        updatedAt: serverTimestamp(), updatedBy: memberUid
      };
      const promoted = {
        ...alternativeSnapshot.data(), status: "retained", justification: "",
        currentRevisionId: `${alternative.id}-rogue-1`,
        updatedAt: serverTimestamp(), updatedBy: memberUid
      };
      transaction.set(doc(db, "factHypotheses", initialId), demoted);
      transaction.set(doc(db, "factHypotheses", alternative.id), promoted);
      transaction.set(
        doc(db, "factHypothesisRevisions", `${initialId}-rogue-1`),
        revisionFor(initialId, demoted, { operation: "retained", previousRevisionId: initialSnapshot.data().currentRevisionId })
      );
      transaction.set(
        doc(db, "factHypothesisRevisions", `${alternative.id}-rogue-1`),
        revisionFor(alternative.id, promoted, { operation: "retained", previousRevisionId: alternativeSnapshot.data().currentRevisionId })
      );
      transaction.update(doc(db, "people", "p-force"), {
        retainedHypothesis: { "birth.date": alternative.id },
        birthDateInfo: { type: "year", year: 1872 },
        updatedAt: serverTimestamp(), updatedBy: memberUid
      });
    }),
    "remplacement sans justification"
  );

  const after = (await getDoc(doc(db, "people", "p-force"))).data();
  assert.deepEqual(after.retainedHypothesis, before.retainedHypothesis, "aucune écriture appliquée");
  assert.equal((await getDoc(doc(db, "factHypotheses", alternative.id))).data().status, "alternative");
});

test("changement d'identité d'une hypothèse refusé", async () => {
  await setDoc(doc(db, "people", "p-immuable"), personRecord("p-immuable"));
  await writeHypothesisWithRevision("hyp-immuable", validAlternativeDoc("p-immuable", {
    currentRevisionId: "hyp-immuable-rev-1"
  }));
  const snapshot = (await getDoc(doc(db, "factHypotheses", "hyp-immuable"))).data();
  /* Écriture directe avec révision neuve et par ailleurs cohérente : seul le
     gel de l'identité (personId) doit faire échouer la transaction. */
  const changed = { ...snapshot, personId: "p-autre", currentRevisionId: "hyp-immuable-rev-2", updatedAt: serverTimestamp(), updatedBy: memberUid };
  await expectDenied(
    writeHypothesisWithRevision("hyp-immuable", changed, {
      operation: "value-corrected", previousRevisionId: snapshot.currentRevisionId
    }),
    "personId modifié"
  );
  assert.equal((await getDoc(doc(db, "factHypotheses", "hyp-immuable"))).data().personId, "p-immuable", "aucune écriture appliquée");
});

test("suppression physique d'une hypothèse refusée (suppression logique uniquement)", async () => {
  await setDoc(doc(db, "people", "p-suppression"), personRecord("p-suppression"));
  await writeHypothesisWithRevision("hyp-suppression", validAlternativeDoc("p-suppression", {
    currentRevisionId: "hyp-suppression-rev-1"
  }));
  await expectDenied(
    deleteDoc(doc(db, "factHypotheses", "hyp-suppression")),
    "delete physique"
  );
  assert.equal((await getDoc(doc(db, "factHypotheses", "hyp-suppression"))).data().status, "alternative");
});

test("rétrogradation d'une retenue sans bascule d'ancre refusée", async () => {
  await setDoc(doc(db, "people", "p-retro"), personRecord("p-retro", { place: "Rome" }));
  const created = await store.createHypothesis({
    personId: "p-retro", fieldKey: "birth.place", value: { place: "Rome", placeInfo: null }, actorUid: memberUid
  });
  const initialId = "fh_init_p-retro_birth.place";
  assert.equal(created.created.some(item => item.id === initialId), true);

  /* Transition alternative permise par la matrice, révision neuve et
     cohérente écrites : seule la bascule d'ancre (retainedReplacedAfter)
     doit refuser — l'ancre reste sur la retenue sans remplacement. */
  await expectDenied(
    runTransaction(db, async transaction => {
      const snapshot = await transaction.get(doc(db, "factHypotheses", initialId));
      const demoted = {
        ...snapshot.data(), status: "alternative",
        currentRevisionId: `${initialId}-rogue-demote`,
        updatedAt: serverTimestamp(), updatedBy: memberUid
      };
      transaction.set(doc(db, "factHypotheses", initialId), demoted);
      transaction.set(
        doc(db, "factHypothesisRevisions", `${initialId}-rogue-demote`),
        revisionFor(initialId, demoted, { operation: "retained", previousRevisionId: snapshot.data().currentRevisionId })
      );
    }),
    "rétrogradation sans bascule d'ancre"
  );
  assert.equal((await getDoc(doc(db, "factHypotheses", initialId))).data().status, "retained");
});

test("création d'une révision sans hypothèse rattachée refusée", async () => {
  const { createdAt: _createdAt, updatedAt: _updatedAt, updatedBy: _updatedBy, ...snapshotData } = validAlternativeDoc("p-canary");
  await expectDenied(
    setDoc(doc(db, "factHypothesisRevisions", "rev-orpheline"), {
      objectId: "hypothese-inexistante",
      personId: "p-canary",
      fieldKey: "birth.date",
      operation: "created",
      authorUid: memberUid,
      createdAt: serverTimestamp(),
      previousRevisionId: null,
      justification: "",
      data: snapshotData
    }),
    "révision orpheline"
  );
});

test("mise à jour d'une révision existante refusée (immuabilité)", async () => {
  await store.rejectHypothesis({
    personId: "p-canary", fieldKey: "birth.date",
    hypothesisId: "canary-hyp", justification: "Écartée", actorUid: memberUid
  }).catch(() => { /* la retenue éventuelle n'importe pas : on récupère la révision */ });
  const revisions = await getDocs(query(collection(db, "factHypothesisRevisions"), where("personId", "==", "p-canary")));
  assert.ok(revisions.size >= 1, "révision disponible pour le test");
  const revision = revisions.docs[0];
  await expectDenied(
    updateDoc(doc(db, "factHypothesisRevisions", revision.id), { justification: "modifiée" }),
    "mise à jour de révision"
  );
  await expectDenied(
    deleteDoc(doc(db, "factHypothesisRevisions", revision.id)),
    "suppression de révision"
  );
});

test("garde-fou serveur : édition directe divergente du champ retenue refusée", async () => {
  const person = (await getDoc(doc(db, "people", "p-promo"))).data();
  assert.ok(person.retainedHypothesis && person.retainedHypothesis["birth.date"], "p-promo est ancrée");
  await expectDenied(
    updateDoc(doc(db, "people", "p-promo"), { birthDateInfo: { type: "year", year: 1900 } }),
    "divergence fiche/hypothèse retenue"
  );
});

test("édition d'un autre champ de la personne ancrée autorisée", async () => {
  await updateDoc(doc(db, "people", "p-promo"), { firstName: "Cas Modifié" });
  const person = (await getDoc(doc(db, "people", "p-promo"))).data();
  assert.equal(person.firstName, "Cas Modifié");
});

test("création d'une personne portant une ancre vers une hypothèse absente refusée", async () => {
  await expectDenied(
    setDoc(doc(db, "people", "p-ancre-fantome"), personRecord("p-ancre-fantome", {
      retainedHypothesis: { "birth.date": "hypothese-fantome" }
    })),
    "ancre fantôme à la création"
  );
});

test("lecture anonyme des hypothèses refusée", async () => {
  await signOutAll();
  await expectDenied(
    getDocs(query(collection(db, "factHypotheses"), where("personId", "==", "p-canary"))),
    "lecture anonyme"
  );
  await signInWithEmailAndPassword(auth, MEMBER_EMAIL, MEMBER_PASSWORD);
});

test("association d''attestation autorisée et historisée par les règles candidat", async () => {
  await setDoc(doc(db, "people", "p-att"), personRecord("p-att"));
  const created = await store.createHypothesis({
    personId: "p-att", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const alternative = created.created.find(item => item.status === "alternative");
  assert.ok(alternative, "hypothèse alternative créée");

  const attached = await store.attachAttestation({
    personId: "p-att", fieldKey: "birth.date", hypothesisId: alternative.id,
    attestationId: "att-1", role: "supports", actorUid: memberUid
  });
  assert.deepEqual(attached.updated[0].attestations, [{ attestationId: "att-1", role: "supports" }]);

  const replaced = await store.attachAttestation({
    personId: "p-att", fieldKey: "birth.date", hypothesisId: alternative.id,
    attestationId: "att-1", role: "contradicts", actorUid: memberUid
  });
  assert.equal(replaced.updated[0].attestations.length, 1, "le changement de rôle remplace, jamais de doublon");
  assert.equal(replaced.updated[0].attestations[0].role, "contradicts");

  const revisions = await getDocs(query(collection(db, "factHypothesisRevisions"), where("personId", "==", "p-att")));
  assert.ok(revisions.size >= 2, "révisions d'association enregistrées dans la même transaction");
});

/* ═══ Matrice des transitions de statut ═══
   Les écritures « rogue » ci-dessous contournent le client (SDK direct) et
   sont construites pour être PAR AILLEURS cohérentes (révisions neuves,
   ancre cohérente) : leur refus isole précisément la règle testée. */

/* Rétrogradation d'une retenue vers un statut interdit, avec bascule d'ancre
   et révisions par ailleurs parfaitement cohérentes. */
async function rogueReplaceRetained({ personId, fieldKey, fromId, toId, toStatus }) {
  return runTransaction(db, async transaction => {
    const fromSnap = await transaction.get(doc(db, "factHypotheses", fromId));
    const toSnap = await transaction.get(doc(db, "factHypotheses", toId));
    const fromNew = {
      ...fromSnap.data(), status: toStatus,
      currentRevisionId: `${fromId}-rogue-x`,
      updatedAt: serverTimestamp(), updatedBy: memberUid
    };
    const toNew = {
      ...toSnap.data(), status: "retained", justification: "Rogue",
      currentRevisionId: `${toId}-rogue-x`,
      updatedAt: serverTimestamp(), updatedBy: memberUid
    };
    transaction.set(doc(db, "factHypotheses", fromId), fromNew);
    transaction.set(doc(db, "factHypotheses", toId), toNew);
    transaction.set(
      doc(db, "factHypothesisRevisions", `${fromId}-rogue-x`),
      revisionFor(fromId, fromNew, { operation: "retained", previousRevisionId: fromSnap.data().currentRevisionId })
    );
    transaction.set(
      doc(db, "factHypothesisRevisions", `${toId}-rogue-x`),
      revisionFor(toId, toNew, { operation: "retained", previousRevisionId: toSnap.data().currentRevisionId })
    );
    transaction.update(doc(db, "people", personId), {
      retainedHypothesis: { [fieldKey]: toId },
      birthDateInfo: toNew.value,
      updatedAt: serverTimestamp(), updatedBy: memberUid
    });
  });
}

/* Écriture directe sur une hypothèse supprimée : changement de statut et,
   selon la variante, écriture de personnes pour l'ancrage. La valeur, les
   attestations et la justification restent strictement identiques (verrou de
   restauration) sauf indication contraire. */
async function rogueOnDeleted({ personId, fieldKey, hypId, targetStatus, writePeople = false, value = null }) {
  return runTransaction(db, async transaction => {
    const snap = await transaction.get(doc(db, "factHypotheses", hypId));
    const newDoc = {
      ...snap.data(), status: targetStatus,
      currentRevisionId: `${hypId}-rogue-d`,
      updatedAt: serverTimestamp(), updatedBy: memberUid
    };
    if (value) newDoc.value = value;
    transaction.set(doc(db, "factHypotheses", hypId), newDoc);
    transaction.set(
      doc(db, "factHypothesisRevisions", `${hypId}-rogue-d`),
      revisionFor(hypId, newDoc, {
        operation: targetStatus === "alternative" ? "restored" : targetStatus,
        previousRevisionId: snap.data().currentRevisionId
      })
    );
    if (writePeople) {
      transaction.update(doc(db, "people", personId), {
        retainedHypothesis: { [fieldKey]: hypId },
        birthDateInfo: newDoc.value,
        updatedAt: serverTimestamp(), updatedBy: memberUid
      });
    }
  });
}

test("matrice autorisée : écartée → retenue, suppressions logiques et restauration", async () => {
  await setDoc(doc(db, "people", "p-matrice"), personRecord("p-matrice"));
  const created = await store.createHypothesis({
    personId: "p-matrice", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const initialId = "fh_init_p-matrice_birth.date";
  const alternative = created.created.find(item => item.id !== initialId);

  /* alternative → écartée */
  await store.rejectHypothesis({
    personId: "p-matrice", fieldKey: "birth.date", hypothesisId: alternative.id,
    justification: "Source faible", actorUid: memberUid
  });
  assert.equal((await getDoc(doc(db, "factHypotheses", alternative.id))).data().status, "rejected");

  /* écartée → retenue (remplacement de la retenue initiale, ancre cohérente) */
  await store.setRetained({
    personId: "p-matrice", fieldKey: "birth.date", hypothesisId: alternative.id,
    justification: "Réexamen après acte retrouvé", actorUid: memberUid, expectedAnchor: initialId
  });
  const person = (await getDoc(doc(db, "people", "p-matrice"))).data();
  assert.equal(person.retainedHypothesis["birth.date"], alternative.id);
  assert.deepEqual(person.birthDateInfo, { type: "year", year: 1872 });
  assert.equal((await getDoc(doc(db, "factHypotheses", initialId))).data().status, "alternative", "retenue → alternative lors du remplacement");

  /* alternative → écartée → supprimée → restaurée (révision « restored ») */
  await store.rejectHypothesis({
    personId: "p-matrice", fieldKey: "birth.date", hypothesisId: initialId,
    justification: "Écartée après remplacement", actorUid: memberUid
  });
  await store.deleteHypothesis({
    personId: "p-matrice", fieldKey: "birth.date", hypothesisId: initialId,
    actorUid: memberUid, expectedAnchor: alternative.id
  });
  assert.equal((await getDoc(doc(db, "factHypotheses", initialId))).data().status, "deleted");
  const restored = await store.restoreHypothesis({
    personId: "p-matrice", fieldKey: "birth.date", hypothesisId: initialId, actorUid: memberUid
  });
  assert.equal(restored.updated[0].status, "alternative");

  /* alternative → supprimée (suppression logique) */
  await store.deleteHypothesis({
    personId: "p-matrice", fieldKey: "birth.date", hypothesisId: initialId,
    actorUid: memberUid, expectedAnchor: alternative.id
  });
  assert.equal((await getDoc(doc(db, "factHypotheses", initialId))).data().status, "deleted");
  assert.deepEqual((await getDoc(doc(db, "factHypotheses", initialId))).data().attestations, [], "les attestations ne sont jamais effacées par la suppression");

  const revisions = await getDocs(query(collection(db, "factHypothesisRevisions"), where("personId", "==", "p-matrice")));
  const operations = revisions.docs.map(item => item.data().operation);
  assert.ok(operations.includes("restored"), "restauration tracée par une révision");
  assert.ok(operations.includes("retained"), "remplacement tracé");
  assert.ok(revisions.size >= 8, `chaque transition est historisée : ${revisions.size} révisions`);
});

/* Réexamen (décision validée fin 2C.5-A) : écartée → alternative alignée des
   deux côtés — l'ancienne divergence documentée est clôturée. */
test("réexamen : écartée → alternative autorisé avec le vrai store (justification, conservation, ancre)", async () => {
  await setDoc(doc(db, "people", "p-reexam"), personRecord("p-reexam"));
  const created = await store.createHypothesis({
    personId: "p-reexam", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const initialId = "fh_init_p-reexam_birth.date";
  const alternative = created.created.find(item => item.id !== initialId);

  /* Association puis écartement : l'hypothèse retenue (initiale) ne bouge pas. */
  await store.attachAttestation({
    personId: "p-reexam", fieldKey: "birth.date", hypothesisId: alternative.id,
    attestationId: "att-rex", role: "contradicts", actorUid: memberUid
  });
  await store.rejectHypothesis({
    personId: "p-reexam", fieldKey: "birth.date", hypothesisId: alternative.id,
    justification: "Source non probante", actorUid: memberUid
  });
  assert.equal((await getDoc(doc(db, "factHypotheses", alternative.id))).data().status, "rejected");
  const personBefore = (await getDoc(doc(db, "people", "p-reexam"))).data();

  /* Réexamen avec justification : transition complète et tracée. */
  const reexamined = await store.reexamineHypothesis({
    personId: "p-reexam", fieldKey: "birth.date", hypothesisId: alternative.id,
    justification: "Second acte retrouvé", actorUid: memberUid
  });
  const afterHyp = (await getDoc(doc(db, "factHypotheses", alternative.id))).data();
  assert.equal(reexamined.updated[0].status, "alternative");
  assert.equal(afterHyp.status, "alternative");
  assert.deepEqual(afterHyp.value, { type: "year", year: 1872 }, "valeur conservée");
  assert.deepEqual(afterHyp.attestations, [{ attestationId: "att-rex", role: "contradicts" }], "attestations conservées");

  const afterPerson = (await getDoc(doc(db, "people", "p-reexam"))).data();
  assert.deepEqual(afterPerson.retainedHypothesis, personBefore.retainedHypothesis, "ancre inchangée");
  assert.deepEqual(afterPerson.birthDateInfo, personBefore.birthDateInfo, "fiche inchangée");
  assert.equal((await getDoc(doc(db, "factHypotheses", initialId))).data().status, "retained", "retenue inchangée");

  const revisions = await getDocs(query(collection(db, "factHypothesisRevisions"), where("personId", "==", "p-reexam")));
  const reexamRevision = revisions.docs.map(item => ({ id: item.id, ...item.data() }))
    .find(item => item.operation === "reexamined");
  assert.ok(reexamRevision, "révision reexamined créée");
  assert.equal(reexamRevision.objectId, alternative.id);
  assert.equal(reexamRevision.justification, "Second acte retrouvé");
  assert.equal(reexamRevision.authorUid, memberUid);
  assert.ok(reexamRevision.previousRevisionId, "révision chaînée sur la tête précédente");
});

test("réexamen refusé sans justification (validation cliente et règles)", async () => {
  await setDoc(doc(db, "people", "p-rex-nojust"), personRecord("p-rex-nojust"));
  const created = await store.createHypothesis({
    personId: "p-rex-nojust", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const alternative = created.created.find(item => item.status === "alternative");
  await store.rejectHypothesis({
    personId: "p-rex-nojust", fieldKey: "birth.date", hypothesisId: alternative.id,
    justification: "Source faible", actorUid: memberUid
  });

  /* Côté client : la validation refuse déjà. */
  await assert.rejects(
    store.reexamineHypothesis({
      personId: "p-rex-nojust", fieldKey: "birth.date", hypothesisId: alternative.id,
      justification: "   ", actorUid: memberUid
    }),
    /justification est obligatoire pour réexaminer/
  );

  /* Côté règles : écriture SDK directe, révision neuve et par ailleurs
     cohérente, mais sans justification — seule cette règle doit refuser. */
  await expectDenied(
    runTransaction(db, async transaction => {
      const snap = await transaction.get(doc(db, "factHypotheses", alternative.id));
      const back = {
        ...snap.data(), status: "alternative", justification: "",
        currentRevisionId: `${alternative.id}-rogue-rx`,
        updatedAt: serverTimestamp(), updatedBy: memberUid
      };
      transaction.set(doc(db, "factHypotheses", alternative.id), back);
      transaction.set(
        doc(db, "factHypothesisRevisions", `${alternative.id}-rogue-rx`),
        revisionFor(alternative.id, back, { operation: "reexamined", previousRevisionId: snap.data().currentRevisionId })
      );
    }),
    "réexamen sans justification"
  );
  assert.equal((await getDoc(doc(db, "factHypotheses", alternative.id))).data().status, "rejected", "aucune écriture appliquée");
});

test("réexamen refusé si la valeur ou les attestations sont modifiées (écriture SDK directe)", async () => {
  await setDoc(doc(db, "people", "p-rx-incoh"), personRecord("p-rx-incoh"));
  const created = await store.createHypothesis({
    personId: "p-rx-incoh", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const alternative = created.created.find(item => item.status === "alternative");
  await store.rejectHypothesis({
    personId: "p-rx-incoh", fieldKey: "birth.date", hypothesisId: alternative.id,
    justification: "Source faible", actorUid: memberUid
  });

  /* Valeur modifiée dans la même écriture : le verrou de conservation refuse
     (révision pourtant neuve et cohérente avec la tête écrite). */
  await expectDenied(
    runTransaction(db, async transaction => {
      const snap = await transaction.get(doc(db, "factHypotheses", alternative.id));
      const back = {
        ...snap.data(), status: "alternative", justification: "X",
        value: { type: "about", year: 1890 },
        currentRevisionId: `${alternative.id}-rogue-v`,
        updatedAt: serverTimestamp(), updatedBy: memberUid
      };
      transaction.set(doc(db, "factHypotheses", alternative.id), back);
      transaction.set(
        doc(db, "factHypothesisRevisions", `${alternative.id}-rogue-v`),
        revisionFor(alternative.id, back, { operation: "reexamined", previousRevisionId: snap.data().currentRevisionId })
      );
    }),
    "réexamen avec valeur modifiée"
  );

  /* Attestations modifiées dans la même écriture : même refus. */
  await expectDenied(
    runTransaction(db, async transaction => {
      const snap = await transaction.get(doc(db, "factHypotheses", alternative.id));
      const back = {
        ...snap.data(), status: "alternative", justification: "X",
        attestations: [{ attestationId: "att-injectee", role: "supports" }],
        currentRevisionId: `${alternative.id}-rogue-a`,
        updatedAt: serverTimestamp(), updatedBy: memberUid
      };
      transaction.set(doc(db, "factHypotheses", alternative.id), back);
      transaction.set(
        doc(db, "factHypothesisRevisions", `${alternative.id}-rogue-a`),
        revisionFor(alternative.id, back, { operation: "reexamined", previousRevisionId: snap.data().currentRevisionId })
      );
    }),
    "réexamen avec attestations modifiées"
  );

  const snapshot = (await getDoc(doc(db, "factHypotheses", alternative.id))).data();
  assert.equal(snapshot.status, "rejected", "aucune écriture appliquée");
  assert.deepEqual(snapshot.value, { type: "year", year: 1872 });
  assert.deepEqual(snapshot.attestations, []);
});

test("matrice interdite : retenue → écartée et retenue → supprimée refusées", async () => {
  await setDoc(doc(db, "people", "p-interdit"), personRecord("p-interdit"));
  const created = await store.createHypothesis({
    personId: "p-interdit", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const initialId = "fh_init_p-interdit_birth.date";
  const alternative = created.created.find(item => item.id !== initialId);

  /* Transaction par ailleurs cohérente (ancre basculée, révisions neuves,
     justification de la promotion) : seul le verrou de matrice peut refuser. */
  await expectDenied(
    rogueReplaceRetained({ personId: "p-interdit", fieldKey: "birth.date", fromId: initialId, toId: alternative.id, toStatus: "rejected" }),
    "retenue → écartée"
  );
  await expectDenied(
    rogueReplaceRetained({ personId: "p-interdit", fieldKey: "birth.date", fromId: initialId, toId: alternative.id, toStatus: "deleted" }),
    "retenue → supprimée"
  );
  assert.equal((await getDoc(doc(db, "factHypotheses", initialId))).data().status, "retained", "aucune écriture appliquée");
  const person = (await getDoc(doc(db, "people", "p-interdit"))).data();
  assert.equal(person.retainedHypothesis["birth.date"], initialId, "ancre intacte");
});

test("matrice interdite : supprimée → retenue et supprimée → écartée refusées", async () => {
  await setDoc(doc(db, "people", "p-deleted"), personRecord("p-deleted"));
  const created = await store.createHypothesis({
    personId: "p-deleted", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const alternative = created.created.find(item => item.status === "alternative");
  /* Justification non vide avant suppression : le verrou de restauration et la
     règle de justification peuvent tous deux être satisfaits, isolant ainsi le
     refus sur la seule matrice. */
  await store.correctValue({
    personId: "p-deleted", fieldKey: "birth.date", hypothesisId: alternative.id,
    value: { type: "about", year: 1875 }, justification: "Début de piste", actorUid: memberUid
  });
  await store.deleteHypothesis({
    personId: "p-deleted", fieldKey: "birth.date", hypothesisId: alternative.id, actorUid: memberUid
  });
  assert.equal((await getDoc(doc(db, "factHypotheses", alternative.id))).data().status, "deleted");

  await expectDenied(
    rogueOnDeleted({ personId: "p-deleted", fieldKey: "birth.date", hypId: alternative.id, targetStatus: "retained", writePeople: true }),
    "supprimée → retenue"
  );
  await expectDenied(
    rogueOnDeleted({ personId: "p-deleted", fieldKey: "birth.date", hypId: alternative.id, targetStatus: "rejected" }),
    "supprimée → écartée"
  );
  const snapshot = (await getDoc(doc(db, "factHypotheses", alternative.id))).data();
  assert.equal(snapshot.status, "deleted", "aucune écriture appliquée");
  assert.equal(snapshot.justification, "Début de piste", "verrou de restauration intact");
});

test("hypothèse supprimée verrouillée : aucune modification tant que le statut reste deleted", async () => {
  await setDoc(doc(db, "people", "p-lock"), personRecord("p-lock"));
  const created = await store.createHypothesis({
    personId: "p-lock", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const alternative = created.created.find(item => item.status === "alternative");
  await store.deleteHypothesis({
    personId: "p-lock", fieldKey: "birth.date", hypothesisId: alternative.id, actorUid: memberUid
  });

  /* Modification de valeur avec statut toujours deleted : refusée. */
  await expectDenied(
    rogueOnDeleted({
      personId: "p-lock", fieldKey: "birth.date", hypId: alternative.id,
      targetStatus: "deleted", value: { type: "about", year: 1880 }
    }),
    "modification d'une hypothèse supprimée"
  );
  /* Écriture « sans changement » (métadonnées seules) : refusée aussi — le
     statut deleted n'accepte AUCUNE écriture. */
  await expectDenied(
    rogueOnDeleted({ personId: "p-lock", fieldKey: "birth.date", hypId: alternative.id, targetStatus: "deleted" }),
    "réécriture d'une hypothèse supprimée"
  );
  const snapshot = (await getDoc(doc(db, "factHypotheses", alternative.id))).data();
  assert.equal(snapshot.status, "deleted");
  assert.deepEqual(snapshot.value, { type: "year", year: 1872 }, "valeur inchangée");
});

test("restauration accompagnée d'une modification de valeur refusée", async () => {
  await setDoc(doc(db, "people", "p-restore-mod"), personRecord("p-restore-mod"));
  const created = await store.createHypothesis({
    personId: "p-restore-mod", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const alternative = created.created.find(item => item.status === "alternative");
  await store.deleteHypothesis({
    personId: "p-restore-mod", fieldKey: "birth.date", hypothesisId: alternative.id, actorUid: memberUid
  });

  await expectDenied(
    rogueOnDeleted({
      personId: "p-restore-mod", fieldKey: "birth.date", hypId: alternative.id,
      targetStatus: "alternative", value: { type: "about", year: 1890 }
    }),
    "restauration avec modification de valeur"
  );
  assert.equal((await getDoc(doc(db, "factHypotheses", alternative.id))).data().status, "deleted");
});

test("changement de statut sans révision fraîche refusé", async () => {
  await setDoc(doc(db, "people", "p-sansrev"), personRecord("p-sansrev"));
  const created = await store.createHypothesis({
    personId: "p-sansrev", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const alternative = created.created.find(item => item.status === "alternative");

  /* currentRevisionId laissé à sa valeur antérieure (révision existante mais
     datant d'une écriture précédente) : la fraîcheur de la révision dans la
     même transaction est exigée. */
  await expectDenied(
    runTransaction(db, async transaction => {
      const snap = await transaction.get(doc(db, "factHypotheses", alternative.id));
      transaction.set(doc(db, "factHypotheses", alternative.id), {
        ...snap.data(), status: "rejected",
        updatedAt: serverTimestamp(), updatedBy: memberUid
      });
    }),
    "statut sans révision"
  );
  assert.equal((await getDoc(doc(db, "factHypotheses", alternative.id))).data().status, "alternative");
});

test("changement de statut avec révision incohérente refusé", async () => {
  await setDoc(doc(db, "people", "p-revincoh"), personRecord("p-revincoh"));
  const created = await store.createHypothesis({
    personId: "p-revincoh", fieldKey: "birth.date", value: { type: "year", year: 1872 }, actorUid: memberUid
  });
  const alternative = created.created.find(item => item.status === "alternative");

  /* La révision existe dans la même transaction, mais son instantané annonce
     l'ancien statut : la cohérence révision ↔ tête doit refuser. */
  await expectDenied(
    runTransaction(db, async transaction => {
      const snap = await transaction.get(doc(db, "factHypotheses", alternative.id));
      const changed = {
        ...snap.data(), status: "rejected",
        currentRevisionId: `${alternative.id}-rogue-c`,
        updatedAt: serverTimestamp(), updatedBy: memberUid
      };
      const staleRevision = revisionFor(alternative.id, changed, {
        operation: "rejected",
        previousRevisionId: snap.data().currentRevisionId,
        dataOverrides: { status: "alternative" }
      });
      transaction.set(doc(db, "factHypotheses", alternative.id), changed);
      transaction.set(doc(db, "factHypothesisRevisions", `${alternative.id}-rogue-c`), staleRevision);
    }),
    "révision incohérente"
  );
  assert.equal((await getDoc(doc(db, "factHypotheses", alternative.id))).data().status, "alternative");
});

test("retrait direct de l'ancre sans synchronisation refusé", async () => {
  const person = (await getDoc(doc(db, "people", "p-promo"))).data();
  const anchoredId = person.retainedHypothesis["birth.date"];
  assert.ok(anchoredId, "p-promo est ancrée (parcours précédent)");

  await expectDenied(
    updateDoc(doc(db, "people", "p-promo"), { retainedHypothesis: deleteField() }),
    "retrait d'ancre"
  );
  const after = (await getDoc(doc(db, "people", "p-promo"))).data();
  assert.equal(after.retainedHypothesis["birth.date"], anchoredId, "ancre intacte");
  assert.equal((await getDoc(doc(db, "factHypotheses", anchoredId))).data().status, "retained");
});
