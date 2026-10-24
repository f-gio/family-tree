// Suite d'intégration Firestore via l'émulateur local (jamais de contact réseau avec la production).
// Lancement : npm run test:firestore (firebase emulators:exec --only firestore,auth node --test tests/firestore-emulator.mjs)
// La garde anti-production (emulator-guard.mjs) refuse tout démarrage si FIRESTORE_EMULATOR_HOST n'est pas un hôte local.
// Fichier volontairement sans suffixe .test : il n'est PAS auto-découvert par `node --test` nu — il échouerait sans émulateur.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { initializeFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, writeBatch, runTransaction, query, where, Bytes, serverTimestamp } from "firebase/firestore";
import { FILE_CHUNK_BYTES, splitBytesIntoChunks, concatByteArrays, documentChunkId, sliceIntoBatches, importedDataFields } from "../js/backup-utils.js";
import { prepareMultipleTreeTransferPlan } from "../js/tree-model.js";
import { createGenealogyCollaborationStore } from "../js/genealogy-collaboration-firestore.js";
import { createGenealogyProof, transitionProofStatus } from "../js/genealogy-proofs.js";
import { assertLocalEmulator, assertFictiveProject, EMULATOR_PROJECT_ID } from "./emulator-guard.mjs";

// GARDE ANTI-PRODUCTION : échoue (rouge) si l'émulateur n'est pas démarré ou non local.
const config = assertLocalEmulator(process.env);
assertFictiveProject(EMULATOR_PROJECT_ID);

const EMULATOR_PORT = config.port;
const AUTH_PORT = 9099;
const HOST = config.host;

const ADMIN_EMAIL = "admin-emulator@test-fictif.fr";
const ADMIN_PASSWORD = "admin-fictif-123";
const MEMBER_EMAIL = "membre-emulator@test-fictif.fr";
const MEMBER_PASSWORD = "membre-fictif-123";

console.log(`\n  [firestore-emulator] projectId=${EMULATOR_PROJECT_ID} FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST} hôte=${HOST}:${EMULATOR_PORT}\n`);

let app;
let auth;
let db;
let adminUid;
let memberUid;

function signIn(uid, email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

async function signOutAll() {
  try { await signOut(auth); } catch { /* aucune session */ }
}

async function expectDenied(promise) {
  await assert.rejects(promise, (error) => {
    assert.match(error.code || "", /permission-denied|PERMISSION_DENIED|aborted|unavailable|invalid-argument/i, `Code inattendu : ${error.code} — ${error.message}`);
    return true;
  });
}

// ─── Bootstrap émulateur ─────────────────────────────────────────────────────
before(async () => {
  // Clé API factice et dédiée aux émulateurs : jamais une clé réelle ; l'émulateur
  // ne la valide pas et tous les appels restent en localhost (garde ci-dessus).
  app = initializeApp({ apiKey: "test-only-fake-api-key", projectId: EMULATOR_PROJECT_ID });
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, { disableWarnings: true });
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
  connectFirestoreEmulator(db, HOST, EMULATOR_PORT);

  // Premier compte (admin) : crée settings/access puis son profil admin approuvé.
  const adminCred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
  adminUid = adminCred.user.uid;
  await setDoc(doc(db, "settings", "access"), { primaryAdminUid: adminUid });
  await setDoc(doc(db, "users", adminUid), {
    email: ADMIN_EMAIL,
    displayName: "Administrateur Émulateur",
    photo: "",
    role: "admin",
    status: "approved"
  });

  // Second compte (membre) : auto-inscription en attente, puis approuvé par l'admin.
  await signOutAll();
  const memberCred = await createUserWithEmailAndPassword(auth, MEMBER_EMAIL, MEMBER_PASSWORD);
  memberUid = memberCred.user.uid;
  await setDoc(doc(db, "users", memberUid), {
    email: MEMBER_EMAIL,
    displayName: "Membre Émulateur",
    photo: "",
    role: "member",
    status: "pending"
  });
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await updateDoc(doc(db, "users", memberUid), {
    email: MEMBER_EMAIL,
    displayName: "Membre Émulateur",
    photo: "",
    role: "member",
    status: "approved"
  });
  await signOutAll();
});

after(async () => {
  await signOutAll();
});

// ─── GARDE ──────────────────────────────────────────────────────────────────
test("GARDE : la configuration émulateur locale est valide", () => {
  assert.ok(["localhost", "127.0.0.1"].includes(HOST));
  assert.equal(EMULATOR_PROJECT_ID, "family-tree-emulator-test");
  assert.notEqual(EMULATOR_PROJECT_ID, "family-tree-c2fe2");
});

test("GARDE : la connexion Firestore passe par l'émulateur (pas de clé API, projectId fictif)", () => {
  assert.equal(app.options.projectId, EMULATOR_PROJECT_ID);
});

// ─── ACCÈS NON AUTHENTIFIÉ ─────────────────────────────────────────────────
test("publicConfig/auth est lisible sans connexion (rule allow read: if true)", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await setDoc(doc(db, "publicConfig", "auth"), { openRegistration: true }); // admin : isAdmin → autorisé
  await signOutAll();
  const snap = await getDoc(doc(db, "publicConfig", "auth"));
  assert.equal(snap.exists(), true);
  assert.equal(snap.data().openRegistration, true);
});

test("lecture people refusée sans utilisateur connecté", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ref = doc(db, "people", "person-refus-annonyme");
  await setDoc(ref, { lastName: "Test", firstName: "X" });
  await signOutAll();
  await expectDenied(getDoc(ref));
});

test("lecture settings/access refusée sans utilisateur connecté", async () => {
  await signOutAll();
  await expectDenied(getDoc(doc(db, "settings", "access")));
});

test("lecture users/{uid} refusée sans utilisateur connecté", async () => {
  await signOutAll();
  await expectDenied(getDoc(doc(db, "users", adminUid)));
});

// ─── PERSONNES ──────────────────────────────────────────────────────────────
test("personne valide : création, lecture, mise à jour et suppression par un admin", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ref = doc(db, "people", "person-test-valide");
  await setDoc(ref, {
    lastName: "Martin",
    firstName: "Jean",
    gender: "male",
    place: "Lyon",
    photoUrl: "data:image/jpeg;base64,AAAA",
    birthDateInfo: { type: "exact", value: "1940-05-10" },
    deathDateInfo: { type: "about", year: 2015 }
  });
  const snap = await getDoc(ref);
  assert.equal(snap.exists(), true);
  assert.equal(snap.data().birthDateInfo.value, "1940-05-10");
  await updateDoc(ref, { notes: "ancêtre" });
  assert.equal((await getDoc(ref)).data().notes, "ancêtre");
  await deleteDoc(ref);
  assert.equal((await getDoc(ref)).exists(), false);
});

test("personne valide : les cinq types structurés sont acceptés", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const cas = {
    exact: { type: "exact", value: "1869-03-14" },
    year: { type: "year", year: 1869 },
    about: { type: "about", year: 1869 },
    between: { type: "between", from: 1867, to: 1871 },
    unknown: { type: "unknown" }
  };
  for (const [nom, info] of Object.entries(cas)) {
    const ref = doc(db, "people", `person-type-${nom}`);
    await setDoc(ref, { lastName: "Test", firstName: "X", birthDateInfo: info });
    assert.deepEqual((await getDoc(ref)).data().birthDateInfo, info);
    await deleteDoc(ref);
  }
});

test("personne refusée : photoUrl dépasse 8 Ko", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ref = doc(db, "people", "person-photo-trop-grosse");
  await expectDenied(setDoc(ref, { lastName: "Test", firstName: "X", photoUrl: "A".repeat(8 * 1024 + 1) }));
});

test("personne refusée : birthDateInfo exact a une valeur mal formée", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(setDoc(doc(db, "people", "person-date-invalide"), { lastName: "Test", firstName: "X", birthDateInfo: { type: "exact", value: "pas-une-date" } }));
});

test("personne refusée : birthDateInfo year hors bornes", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(setDoc(doc(db, "people", "person-year-invalide"), { lastName: "Test", firstName: "X", birthDateInfo: { type: "year", year: 0 } }));
});

test("personne refusée : date non structurée (legacy string) en écriture directe", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(setDoc(doc(db, "people", "person-date-string"), { lastName: "Test", firstName: "X", birthDateInfo: "1940-05-10" }));
});

// ─── FAMILLES ───────────────────────────────────────────────────────────────
test("famille valide : création avec parents, enfants, relation et filiations", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const pa = "person-famille-pa", pb = "person-famille-pb", ca = "person-famille-ca";
  await setDoc(doc(db, "people", pa), { lastName: "Parent", firstName: "A" });
  await setDoc(doc(db, "people", pb), { lastName: "Parent", firstName: "B" });
  await setDoc(doc(db, "people", ca), { lastName: "Enfant", firstName: "C" });
  const ref = doc(db, "families", "famille-test-valide");
  await setDoc(ref, {
    partnerIds: [pa, pb],
    childIds: [ca],
    relationType: "marriage",
    unionDateInfo: { type: "year", year: 1960 },
    parentChildLinks: [
      { parentId: pa, childId: ca, type: "biological" },
      { parentId: pb, childId: ca, type: "biological" }
    ]
  });
  const snap = await getDoc(ref);
  assert.equal(snap.data().partnerIds.length, 2);
  assert.equal(snap.data().childIds.length, 1);
  await deleteDoc(ref);
});

test("famille refusée : partnerIds se chevauche avec childIds", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(setDoc(doc(db, "families", "famille-invalide-overlap"), {
    partnerIds: ["person-famille-pa", "person-famille-ca"],
    childIds: ["person-famille-ca"]
  }));
});

test("famille refusée : relationType hors liste", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(setDoc(doc(db, "families", "famille-invalide-relation"), {
    partnerIds: ["person-famille-pa", "person-famille-pb"],
    childIds: [],
    relationType: "concubinage-mystere"
  }));
});

test("famille refusée : partnerIds est une liste vide", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(setDoc(doc(db, "families", "famille-invalide-vide"), {
    partnerIds: [],
    childIds: []
  }));
});

// ─── DOCUMENT CHUNKS (binaire) ──────────────────────────────────────────────
test("chunks : un bloc de 700 Ko exact est accepté et relu octet pour octet", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const bytes = new Uint8Array(FILE_CHUNK_BYTES);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256;
  const chunkId = documentChunkId("doc-bordure", "v1", 0);
  await setDoc(doc(db, "documentChunks", chunkId), {
    documentId: "doc-bordure",
    version: "v1",
    index: 0,
    data: Bytes.fromUint8Array(bytes)
  });
  const snap = await getDoc(doc(db, "documentChunks", chunkId));
  assert.deepEqual(snap.data().data.toUint8Array(), bytes);
  await deleteDoc(doc(db, "documentChunks", chunkId));
});

test("chunks : un bloc de 700 Ko + 1 octet est refusé", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(setDoc(doc(db, "documentChunks", "chunk-trop-gros"), {
    documentId: "doc-x",
    version: "v1",
    index: 0,
    data: Bytes.fromUint8Array(new Uint8Array(FILE_CHUNK_BYTES + 1))
  }));
});

test("chunks : un fichier de 1,5 Mo en 3 blocs relu via le pipeline de lecture (concat/collect)", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const taille = 1_550_000;
  const bytes = new Uint8Array(taille);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131) % 256;
  const parties = splitBytesIntoChunks(bytes, FILE_CHUNK_BYTES);
  assert.equal(parties.length, Math.ceil(taille / FILE_CHUNK_BYTES));
  const documentId = "doc-multiblocs";
  const version = "v3";
  for (let index = 0; index < parties.length; index++) {
    await setDoc(doc(db, "documentChunks", documentChunkId(documentId, version, index)), {
      documentId,
      version,
      index,
      data: Bytes.fromUint8Array(parties[index])
    });
  }
  const reads = [];
  for (let index = 0; index < parties.length; index++) reads.push(getDoc(doc(db, "documentChunks", documentChunkId(documentId, version, index))));
  const snapshots = await Promise.all(reads);
  const reconstruit = concatByteArrays(snapshots.map(s => s.data().data.toUint8Array()));
  assert.deepEqual(reconstruit, bytes);
  for (let index = 0; index < parties.length; index++) await deleteDoc(doc(db, "documentChunks", documentChunkId(documentId, version, index)));
});

test("chunks : suppression de toutes les versions quand un fichier est remplacé (miroir deleteFileChunks)", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const documentId = "doc-remplacement";
  const v1 = "v1", v2 = "v2";
  for (let index = 0; index < 3; index++) {
    await setDoc(doc(db, "documentChunks", documentChunkId(documentId, v1, index)), {
      documentId, version: v1, index, data: Bytes.fromUint8Array(new Uint8Array([index]))
    });
  }
  await setDoc(doc(db, "documents", documentId), { title: "Ancien", storageMode: "firestore-chunks", chunkVersion: v1, chunkCount: 3, storedSize: 3 });
  // Remplacement : nouvelle version, puis suppression de l'ancienne.
  await setDoc(doc(db, "documentChunks", documentChunkId(documentId, v2, 0)), {
    documentId, version: v2, index: 0, data: Bytes.fromUint8Array(new Uint8Array([42]))
  });
  await setDoc(doc(db, "documents", documentId), { title: "Nouveau", storageMode: "firestore-chunks", chunkVersion: v2, chunkCount: 1, storedSize: 1 });
  for (let index = 0; index < 3; index++) await deleteDoc(doc(db, "documentChunks", documentChunkId(documentId, v1, index)));
  // Vérifications.
  assert.equal((await getDoc(doc(db, "documents", documentId))).data().chunkVersion, v2);
  assert.equal((await getDoc(doc(db, "documentChunks", documentChunkId(documentId, v1, 0)))).exists(), false);
  assert.deepEqual((await getDoc(doc(db, "documentChunks", documentChunkId(documentId, v2, 0)))).data().data.toUint8Array(), new Uint8Array([42]));
  await deleteDoc(doc(db, "documents", documentId));
  await deleteDoc(doc(db, "documentChunks", documentChunkId(documentId, v2, 0)));
});

// ─── DOCUMENTS ──────────────────────────────────────────────────────────────
test("documents : création, lecture et suppression par un admin", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ref = doc(db, "documents", "document-test-a");
  await setDoc(ref, { title: "Extrait de naissance", type: "Extrait", fileName: "acte.pdf", mimeType: "application/pdf", personIds: ["person-test-valide"], notes: "lisible" });
  const snap = await getDoc(ref);
  assert.equal(snap.exists(), true);
  assert.equal(snap.data().fileName, "acte.pdf");
  await deleteDoc(ref);
  assert.equal((await getDoc(ref)).exists(), false);
});

test("SECURITE 8B : un contributeur garde les droits documents historiques mais ne peut pas modifier une preuve officielle", async () => {
  const legacyDocumentId = "lot8b-legacy-document-contributor";
  const legacyChunkId = documentChunkId(legacyDocumentId, "legacy-v1", 0);
  const officialProofId = "lot8b-official-proof-guard";
  const documentRef = doc(db, "documents", legacyDocumentId);
  const chunkRef = doc(db, "documentChunks", legacyChunkId);
  const proofRef = doc(db, "genealogyProofs", officialProofId);

  try {
    await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
    await setDoc(documentRef, { title: "Fixture historique de sécurité", notes: "Document témoin" });
    const store = createGenealogyCollaborationStore(db, { doc, runTransaction, serverTimestamp });
    await store.createOfficial({
      type: "proof", id: officialProofId, revisionId: "lot8b-proof-revision", eventId: "lot8b-proof-event",
      data: { id: officialProofId, factId: "fact-fixture", factType: "birth.date", technicalStatus: "active" },
      reason: "Fixture locale de sécurité", actorUid: adminUid
    });
    await signOutAll();
    await expectDenied(getDoc(documentRef));
    const pendingEmail = "documents-pending-emulator@test-fictif.fr";
    const pendingCredential = await createUserWithEmailAndPassword(auth, pendingEmail, "documents-pending-123");
    await setDoc(doc(db, "users", pendingCredential.user.uid), {
      email: pendingEmail, displayName: "Documents pending", photo: "", role: "member", status: "pending"
    });
    await expectDenied(getDoc(documentRef));
    await expectDenied(setDoc(doc(db, "documents", "lot8b-pending-document"), { title: "Création pending refusée" }));
    await expectDenied(updateDoc(documentRef, { notes: "écriture refusée" }));
    await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
    await updateDoc(documentRef, { notes: "Modifiable par un contributeur approuvé selon la règle historique" });
    await setDoc(chunkRef, { documentId: legacyDocumentId, version: "legacy-v1", index: 0, data: Bytes.fromUint8Array(new Uint8Array([1, 2, 3])) });
    assert.equal((await getDoc(documentRef)).data().notes, "Modifiable par un contributeur approuvé selon la règle historique");
    await expectDenied(updateDoc(proofRef, { data: { id: officialProofId, factId: "fact-fixture", technicalStatus: "historical" }, version: 2, revisionId: "lot8b-other-revision", updatedAt: serverTimestamp(), updatedBy: memberUid, eventId: "lot8b-other-event" }));
    await deleteDoc(documentRef);
    await deleteDoc(chunkRef);
  } finally {
    await signOutAll();
    await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
    await deleteDoc(documentRef).catch(() => {});
    await deleteDoc(chunkRef).catch(() => {});
    await deleteDoc(proofRef).catch(() => {});
  }
});

// ─── TÂCHES ─────────────────────────────────────────────────────────────────
test("tâches : création, mise à jour et suppression par un membre approuvé", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  const ref = doc(db, "tasks", "task-test-a");
  await setDoc(ref, { title: "Relancer les archives", status: "todo", priority: "high" });
  assert.equal((await getDoc(ref)).data().status, "todo");
  await updateDoc(ref, { status: "done", updatedAt: new Date().toISOString() });
  assert.equal((await getDoc(ref)).data().status, "done");
  await deleteDoc(ref);
  assert.equal((await getDoc(ref)).exists(), false);
});

// ─── UTILISATEURS / DROITS / RÔLES ─────────────────────────────────────────
test("users : un membre ne peut pas lire le profil d'un autre membre", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await expectDenied(getDoc(doc(db, "users", adminUid)));
});

test("users : un admin peut lire tous les profils", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal((await getDoc(doc(db, "users", memberUid))).data().status, "approved");
});

test("users : auto-inscription d'un nouveau membre en attente via users/{uid}", async () => {
  await signOutAll();
  const nouveau = await createUserWithEmailAndPassword(auth, "nouveau-emulator@test-fictif.fr", "nouveau-fictif-123");
  const uid = nouveau.user.uid;
  await setDoc(doc(db, "users", uid), { email: "nouveau-emulator@test-fictif.fr", displayName: "Nouveau Membre", photo: "", role: "member", status: "pending" });
  // Un membre en attente n'est pas encore approuvé.
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const personne = doc(db, "people", "person-attente-lue");
  await setDoc(personne, { lastName: "Test", firstName: "X" });
  await signOutAll();
  await signIn(uid, "nouveau-emulator@test-fictif.fr", "nouveau-fictif-123");
  await expectDenied(getDoc(personne));
  // L'admin l'approuve, puis le nouveau membre accède aux personnes.
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await updateDoc(doc(db, "users", uid), { email: "nouveau-emulator@test-fictif.fr", displayName: "Nouveau Membre", photo: "", role: "member", status: "approved" });
  await signIn(uid, "nouveau-emulator@test-fictif.fr", "nouveau-fictif-123");
  assert.equal((await getDoc(personne)).exists(), true);
});

test("users : un utilisateur ne peut pas s'auto-attribuer le rôle admin", async () => {
  await signOutAll();
  const curieux = await createUserWithEmailAndPassword(auth, "curieux-emulator@test-fictif.fr", "curieux-fictif-123");
  await setDoc(doc(db, "users", curieux.user.uid), { email: "curieux-emulator@test-fictif.fr", displayName: "Curieux", photo: "", role: "member", status: "pending" });
  await expectDenied(updateDoc(doc(db, "users", curieux.user.uid), { role: "admin", status: "approved" }));
});

test("users : le profil doit respecter validUser (role inconnu refusé)", async () => {
  await signOutAll();
  const suspect = await createUserWithEmailAndPassword(auth, "suspect-emulator@test-fictif.fr", "suspect-fictif-123");
  await expectDenied(setDoc(doc(db, "users", suspect.user.uid), { email: "suspect-emulator@test-fictif.fr", displayName: "R", photo: "", role: "superuser", status: "approved" }));
});

test("settings/access : la suppression est refusée même pour l'admin", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(deleteDoc(doc(db, "settings", "access")));
});

test("settings/access : la mise à jour est refusée même pour l'admin", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(updateDoc(doc(db, "settings", "access"), { primaryAdminUid: "quelqu-un-dautre" }));
});

test("people : un membre approuvé peut écrire une personne (règle item : isApproved => write)", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  const ref = doc(db, "people", "person-ecriture-membre");
  await setDoc(ref, { lastName: "Test", firstName: "X" });
  assert.equal((await getDoc(ref)).exists(), true);
  await deleteDoc(ref);
});

test("catch-all : écriture dans une collection inconnue refusée", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(setDoc(doc(db, "inconnue", "doc"), { nimporte: 1 }));
});

// ─── DÉMARCHES : DOSSIERS (procedures) ─────────────────────────────────────
// Dossier valide produit par l'UI : titre, type/statut whitelistés,
// personIds facultatif (absent, [] ou plusieurs), champs texte facultatifs.
const DOSSIER_VALIDE = {
  title: "Acte de décès de Rosa Conti",
  type: "correspondence",
  status: "progress"
};
const NON_APPROUVE_EMAIL = "nonapprouve-emulator@test-fictif.fr";
const NON_APPROUVE_PASSWORD = "nonappro-fictif-123";

test("procedures : non authentifié — read/create/update/delete refusés", async () => {
  await signOutAll();
  await expectDenied(getDoc(doc(db, "procedures", "dossier-anonyme")));
  await expectDenied(getDocs(collection(db, "procedures")));
  await expectDenied(setDoc(doc(db, "procedures", "dossier-anonyme"), DOSSIER_VALIDE));
  await expectDenied(updateDoc(doc(db, "procedures", "dossier-anonyme"), { status: "done" }));
  await expectDenied(deleteDoc(doc(db, "procedures", "dossier-anonyme")));
});

test("procedures : authentifié non approuvé — read/create/update/delete refusés", async () => {
  await signOutAll();
  const nonApprouve = await createUserWithEmailAndPassword(auth, NON_APPROUVE_EMAIL, NON_APPROUVE_PASSWORD);
  await setDoc(doc(db, "users", nonApprouve.user.uid), { email: NON_APPROUVE_EMAIL, displayName: "Non Approuvé", photo: "", role: "member", status: "pending" });
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const parent = doc(db, "procedures", "dossier-parent-existant");
  await setDoc(parent, DOSSIER_VALIDE);
  await signOutAll();
  await signIn(nonApprouve.user.uid, NON_APPROUVE_EMAIL, NON_APPROUVE_PASSWORD);
  await expectDenied(getDoc(parent));
  await expectDenied(getDocs(collection(db, "procedures")));
  await expectDenied(setDoc(doc(db, "procedures", "dossier-nonapprouve"), DOSSIER_VALIDE));
  await expectDenied(updateDoc(parent, { status: "done" }));
  await expectDenied(deleteDoc(parent));
  await signOutAll();
});

test("procedures : admin — read/create/update/delete autorisés", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ref = doc(db, "procedures", "dossier-admin");
  await setDoc(ref, { ...DOSSIER_VALIDE, personIds: [] });
  assert.equal((await getDoc(ref)).data().status, "progress");
  await updateDoc(ref, { status: "done", updatedBy: adminUid });
  assert.equal((await getDoc(ref)).data().status, "done");
  await deleteDoc(ref);
  assert.equal((await getDoc(ref)).exists(), false);
});

test("procedures : primary admin (mêmes droits, compte de bootstrap)", async () => {
  // Le compte de bootstrap EST le primary admin dans cette suite (settings/access.primaryAdminUid = adminUid).
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ref = doc(db, "procedures", "dossier-primary-admin");
  await setDoc(ref, DOSSIER_VALIDE);
  assert.equal((await getDoc(ref)).exists(), true);
  await deleteDoc(ref);
});

test("procedures : membre approuvé ordinaire — read/create/update/delete autorisés", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  const ref = doc(db, "procedures", "dossier-membre");
  await setDoc(ref, { ...DOSSIER_VALIDE, place: "Salle de lecture, Varese" });
  assert.equal((await getDoc(ref)).data().place, "Salle de lecture, Varese");
  await updateDoc(ref, { status: "waiting", updatedBy: memberUid });
  assert.equal((await getDoc(ref)).data().status, "waiting");
  await deleteDoc(ref);
  assert.equal((await getDoc(ref)).exists(), false);
});

test("procedures : validProcedure — refus des données invalides", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  const refuse = (id, data) => expectDenied(setDoc(doc(db, "procedures", id), data));
  await refuse("dossier-titre-manquant", { type: "research", status: "prepare" });
  await refuse("dossier-titre-vide", { ...DOSSIER_VALIDE, title: "" });
  await refuse("dossier-titre-long", { ...DOSSIER_VALIDE, title: "A".repeat(161) });
  await refuse("dossier-type-inconnu", { ...DOSSIER_VALIDE, type: "numerologie" });
  await refuse("dossier-statut-inconnu", { ...DOSSIER_VALIDE, status: "mystere" });
  await refuse("dossier-pids-string", { ...DOSSIER_VALIDE, personIds: "p1" });
  await refuse("dossier-pids-doublons", { ...DOSSIER_VALIDE, personIds: ["p1", "p1"] });
  // LIMITATION CEL : sans lambda (.every), le type de chaque élément de la
  // liste ne peut pas être validé — pas de faux test « [42] → DENY ».
  await refuse("dossier-pids-trop-long", { ...DOSSIER_VALIDE, personIds: Array.from({ length: 51 }, (_, i) => `p${i}`) });
  await refuse("dossier-next-date-slash", { ...DOSSIER_VALIDE, nextActionDate: "2026/10/02" });
  await refuse("dossier-next-date-malformee", { ...DOSSIER_VALIDE, nextActionDate: "le 25 septembre" });
});

test("procedures : validProcedure — personIds facultatif et polyvalent", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  const cree = (id, data) => setDoc(doc(db, "procedures", id), data).then(() => deleteDoc(doc(db, "procedures", id)));
  // personIds absent : ALLOW (zéro personne autorisé)
  await cree("dossier-pids-absent", { title: "Codice fiscale", type: "administrative", status: "prepare" });
  // personIds [] : ALLOW
  await cree("dossier-pids-vide", { ...DOSSIER_VALIDE, personIds: [] });
  // un ID puis plusieurs IDs : ALLOW
  await cree("dossier-pids-un", { ...DOSSIER_VALIDE, personIds: ["p1"] });
  await cree("dossier-pids-plusieurs", { ...DOSSIER_VALIDE, personIds: ["p1", "p2", "p3"] });
  // nextActionDate : absent → ALLOW ; "" → ALLOW ; date valide → ALLOW
  await cree("dossier-date-absente", { ...DOSSIER_VALIDE, objective: "sans échéance" });
  await cree("dossier-date-vide", { ...DOSSIER_VALIDE, nextActionDate: "" });
  await cree("dossier-date-valide", { ...DOSSIER_VALIDE, nextActionDate: "2026-10-02" });
});

// ─── DÉMARCHES : ACTIONS (sous-collection) ─────────────────────────────────
const ACTION_VALIDE = { type: "email-sent", date: "2026-09-18", direction: "none", title: "Demande d’informations", text: "Bonjour, …" };

test("actions : non authentifié — read/create/update/delete refusés", async () => {
  await signOutAll();
  await expectDenied(setDoc(doc(db, "procedures", "dossier-parent-existant", "actions", "a1"), ACTION_VALIDE));
  await expectDenied(getDoc(doc(db, "procedures", "dossier-parent-existant", "actions", "a1")));
  await expectDenied(deleteDoc(doc(db, "procedures", "dossier-parent-existant", "actions", "a1")));
});

test("actions : authentifié non approuvé — read/create refusés", async () => {
  await signOutAll();
  const autre = await createUserWithEmailAndPassword(auth, "np2-emulator@test-fictif.fr", "np2-fictif-123");
  await setDoc(doc(db, "users", autre.user.uid), { email: "np2-emulator@test-fictif.fr", displayName: "Autre NP", photo: "", role: "member", status: "pending" });
  await signIn(autre.user.uid, "np2-emulator@test-fictif.fr", "np2-fictif-123");
  await expectDenied(getDoc(doc(db, "procedures", "dossier-parent-existant", "actions", "aa")));
  await expectDenied(setDoc(doc(db, "procedures", "dossier-parent-existant", "actions", "aa"), ACTION_VALIDE));
  await signOutAll();
});

test("actions : création sous un dossier parent inexistant — refusée (pas d’action orpheline)", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await expectDenied(setDoc(doc(db, "procedures", "dossier-inexistant-123", "actions", "a-orpheline"), ACTION_VALIDE));
});

test("actions : membre approuvé — read/create/update/delete autorisés (dossier existant)", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  const ref = doc(db, "procedures", "dossier-parent-existant", "actions", "a-membre");
  await setDoc(ref, ACTION_VALIDE);
  assert.equal((await getDoc(ref)).data().type, "email-sent");
  await updateDoc(ref, { title: "Relance", updatedBy: memberUid });
  assert.equal((await getDoc(ref)).data().title, "Relance");
  await deleteDoc(ref);
  assert.equal((await getDoc(ref)).exists(), false);
});

test("actions : validProcedureAction — emails additifs et whitelist des types", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  const sous = (...segments) => doc(db, "procedures", "dossier-parent-existant", "actions", ...segments);
  // Email envoyé enrichi (time + expéditeur + destinataire + objet + contenu complet) : ALLOW
  await setDoc(sous("mail-envoye"), {
    type: "email-sent", date: "2026-09-18", time: "09:15", direction: "none",
    emailFrom: "François Giovannoni", emailTo: "Mairie de Turin <mairie@fictif.fr>",
    emailSubject: "Demande d’acte de décès", emailFull: "Madame, Monsieur, …"
  });
  // Email reçu enrichi : ALLOW
  await setDoc(sous("mail-recu"), {
    type: "email-received", date: "2026-09-22", time: "10:30", direction: "none",
    emailFrom: "Archivio di Stato di Varese", emailTo: "François Giovannoni",
    emailSubject: "Re: consultation des registres militaires", emailFull: "La consultation est confirmée…"
  });
  // Email sans time ni emailSubject : ALLOW (champs additifs facultatifs)
  await setDoc(sous("mail-minimal"), { type: "email-sent", date: "2026-09-24", emailFull: "sans objet" });
  // Ancienne action (écrite avant l’ajout des champs email) : ALLOW
  await setDoc(sous("mail-legacy"), { type: "email-received", date: "2026-08-01", text: "réponse du 1er août" });
  // Note sans aucun champ email : ALLOW
  await setDoc(sous("note-1"), { type: "note", date: "2026-09-25", text: "À revoir" });
  // Rendez-vous sans champs email : ALLOW
  await setDoc(sous("rdv-1"), { type: "appointment-confirmed", date: "2026-09-26" });
  // time : "" → ALLOW (UI peut écrire l'heure vide) ; "09:30" / "09:30:15" → ALLOW
  await setDoc(sous("mail-sans-time"), { type: "email-sent", date: "2026-09-24", time: "" });
  await setDoc(sous("mail-time-hm"), { type: "email-sent", date: "2026-09-24", time: "09:30" });
  await setDoc(sous("mail-time-hms"), { type: "email-sent", date: "2026-09-24", time: "09:30:15" });
  // date : absent → ALLOW (déjà couvert plus haut) ; "" → ALLOW (UI écrit toujours le champ) ;
  // date valide → ALLOW ; formats invalides → DENY ; type non-string → DENY.
  await setDoc(sous("action-sans-date"), { type: "note" });
  await setDoc(sous("action-date-vide"), { type: "note", date: "" });
  await setDoc(sous("action-date-valide"), { type: "note", date: "2026-10-02" });
  // type hors whitelist : DENY
  await expectDenied(setDoc(sous("type-inconnu"), { type: "telepathie", date: "2026-09-25" }));
  // champ email de mauvais type : DENY
  await expectDenied(setDoc(sous("mail-type-invalide"), { type: "email-sent", date: "2026-09-25", emailFull: 42 }));
  // date mal formée : DENY
  await expectDenied(setDoc(sous("date-malformee"), { type: "note", date: "le 25 septembre" }));
  // date avec slash : DENY
  await expectDenied(setDoc(sous("date-slash"), { type: "note", date: "2026/10/02" }));
  // date non-string : DENY
  await expectDenied(setDoc(sous("date-non-string"), { type: "note", date: 20261002 }));
  // direction hors liste : DENY
  await expectDenied(setDoc(sous("direction-invalide"), { type: "note", direction: "x" }));
  // time mal formé : DENY
  await expectDenied(setDoc(sous("time-malforme"), { type: "email-sent", time: "trente" }));
  // nettoyage
  for (const id of ["mail-envoye", "mail-recu", "mail-minimal", "mail-legacy", "note-1", "rdv-1", "mail-sans-time", "mail-time-hm", "mail-time-hms", "action-sans-date", "action-date-vide", "action-date-valide"]) {
    await deleteDoc(doc(db, "procedures", "dossier-parent-existant", "actions", id));
  }
});

// ─── USERS — LISTE POUR LE SÉLECTEUR RESPONSABLE ──────────────────────────
// Règle testée : allow list: if isAdmin() || (isApproved() && resource.data.status == 'approved');

test("users : membre approuvé peut lister les utilisateurs via la requête du dropdown", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  const q = query(collection(db, "users"), where("status", "==", "approved"));
  const snap = await getDocs(q);
  assert.ok(snap.size >= 1, "au moins l'admin et le membre approuvé");
  const emails = snap.docs.map(d => d.data().email);
  assert.ok(emails.includes(ADMIN_EMAIL), "admin présent");
  assert.ok(emails.includes(MEMBER_EMAIL), "membre présent");
});

test("users : membre approuvé ne récupère pas pending/suspended/rejected via la requête approved", async () => {
  // Créer un compte pending pour vérifier qu'il n'apparaît pas dans la requête approved
  await signOutAll();
  const pending = await createUserWithEmailAndPassword(auth, "pending-list-emulator@test-fictif.fr", "pending-list-123");
  await setDoc(doc(db, "users", pending.user.uid), { email: "pending-list-emulator@test-fictif.fr", displayName: "Pending List", photo: "", role: "member", status: "pending" });
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  const q = query(collection(db, "users"), where("status", "==", "approved"));
  const snap = await getDocs(q);
  const emails = snap.docs.map(d => d.data().email);
  assert.ok(!emails.includes("pending-list-emulator@test-fictif.fr"), "pending absent de la requête approved");
  assert.ok(!emails.some(e => ["suspended-emulator@test-fictif.fr", "suspect-emulator@test-fictif.fr"].includes(e)), "suspended/rejected absent");
});

test("users : admin conserve le comportement existant (peut lister tous les utilisateurs)", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const snap = await getDocs(collection(db, "users"));
  assert.ok(snap.size >= 2, "admin voit tous les utilisateurs");
});

test("users : non authentifié ne peut pas lister les utilisateurs", async () => {
  await signOutAll();
  await expectDenied(getDocs(collection(db, "users")));
  await expectDenied(getDocs(query(collection(db, "users"), where("status", "==", "approved"))));
});

test("users : compte pending ne peut pas lister les utilisateurs", async () => {
  await signOutAll();
  const np = await createUserWithEmailAndPassword(auth, "pending-nolist@test-fictif.fr", "pending-nolist-123");
  await setDoc(doc(db, "users", np.user.uid), { email: "pending-nolist@test-fictif.fr", displayName: "Pending NoList", photo: "", role: "member", status: "pending" });
  await signIn(np.user.uid, "pending-nolist@test-fictif.fr", "pending-nolist-123");
  await expectDenied(getDocs(collection(db, "users")));
  await expectDenied(getDocs(query(collection(db, "users"), where("status", "==", "approved"))));
});

test("users : compte suspended ne peut pas lister les utilisateurs", async () => {
  // Le compte crée son propre profil en pending, puis l'admin le suspend
  await signOutAll();
  const susp = await createUserWithEmailAndPassword(auth, "suspended-nolist@test-fictif.fr", "suspended-nolist-123");
  await setDoc(doc(db, "users", susp.user.uid), { email: "suspended-nolist@test-fictif.fr", displayName: "Suspended NoList", photo: "", role: "member", status: "pending" });
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await updateDoc(doc(db, "users", susp.user.uid), { status: "suspended" });
  await signIn(susp.user.uid, "suspended-nolist@test-fictif.fr", "suspended-nolist-123");
  await expectDenied(getDocs(collection(db, "users")));
  await expectDenied(getDocs(query(collection(db, "users"), where("status", "==", "approved"))));
});

test("users : compte rejected ne peut pas lister les utilisateurs", async () => {
  await signOutAll();
  const rej = await createUserWithEmailAndPassword(auth, "rejected-nolist@test-fictif.fr", "rejected-nolist-123");
  await setDoc(doc(db, "users", rej.user.uid), { email: "rejected-nolist@test-fictif.fr", displayName: "Rejected NoList", photo: "", role: "member", status: "pending" });
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await updateDoc(doc(db, "users", rej.user.uid), { status: "rejected" });
  await signIn(rej.user.uid, "rejected-nolist@test-fictif.fr", "rejected-nolist-123");
  await expectDenied(getDocs(collection(db, "users")));
});

test("users : membre approuvé peut toujours lire son propre profil (comportement existant)", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  const snap = await getDoc(doc(db, "users", memberUid));
  assert.equal(snap.exists(), true);
  assert.equal(snap.data().status, "approved");
});

test("users : membre approuvé ne peut pas lire le profil d'un autre membre (comportement existant)", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await expectDenied(getDoc(doc(db, "users", adminUid)));
});

// ─── MULTI-ARBRES — foundations (uniquement émulateur local) ───────────────
const TREE_FIXTURE_ID = "tree-multi-fixture";
const TREE_ATOMIC_ID = "tree-atomic-fixture";
const TREE_EMPTY_ID = "tree-empty-fixture";

function validTreeRecord(name = "Arbre fictif") {
  return {
    name,
    description: "Fixture émulateur uniquement",
    lifecycleState: "active",
    createdAt: new Date(),
    createdBy: adminUid,
    updatedAt: new Date(),
    updatedBy: adminUid
  };
}

async function lockTree(treeRef, token = "emulator-deletion-token-0001") {
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(treeRef);
    if (!snapshot.exists()) throw new Error("arbre absent");
    const data = snapshot.data();
    if (data.lifecycleState !== "active" && data.lifecycleState != null) throw new Error("arbre déjà verrouillé");
    transaction.update(treeRef, {
      lifecycleState: "deleting", deletionToken: token,
      deletionStartedAt: new Date(), deletionStartedBy: adminUid,
      updatedAt: new Date(), updatedBy: adminUid
    });
  });
  return token;
}

async function recoverTree(treeRef, expectedToken) {
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(treeRef);
    if (!snapshot.exists()) throw new Error("arbre absent");
    const data = snapshot.data();
    if (data.lifecycleState !== "deleting" || data.deletionToken !== expectedToken) throw new Error("jeton modifié");
    transaction.update(treeRef, {
      lifecycleState: "active", deletionToken: deleteField(),
      deletionStartedAt: deleteField(), deletionStartedBy: deleteField(),
      updatedAt: new Date(), updatedBy: adminUid
    });
  });
}

async function seedLegacyTreeWithoutLifecycle(treeId, name) {
  const timestamp = new Date().toISOString();
  const fields = {
    name: { stringValue: name },
    description: { stringValue: "Document historique de l’émulateur" },
    createdAt: { timestampValue: timestamp },
    createdBy: { stringValue: adminUid },
    updatedAt: { timestampValue: timestamp },
    updatedBy: { stringValue: adminUid }
  };
  const url = `http://${HOST}:${EMULATOR_PORT}/v1/projects/${EMULATOR_PROJECT_ID}/databases/(default)/documents/trees/${treeId}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) throw new Error(`Initialisation locale de l’arbre historique refusée : HTTP ${response.status} ${await response.text()}`);
}

test("trees : admin crée/modifie un arbre secondaire valide; main et champs invalides refusés", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await setDoc(doc(db, "trees", TREE_FIXTURE_ID), validTreeRecord());
  await updateDoc(doc(db, "trees", TREE_FIXTURE_ID), { ...validTreeRecord("Arbre renommé"), updatedAt: new Date() });
  assert.equal((await getDoc(doc(db, "trees", TREE_FIXTURE_ID))).data().name, "Arbre renommé");
  await expectDenied(setDoc(doc(db, "trees", "main"), validTreeRecord("Arbre principal")));
  await expectDenied(setDoc(doc(db, "trees", "tree-empty-name"), validTreeRecord("")));
  await expectDenied(setDoc(doc(db, "trees", "tree-long-name"), validTreeRecord("A".repeat(81))));
  await expectDenied(setDoc(doc(db, "trees", "tree-long-description"), { ...validTreeRecord(), description: "x".repeat(201) }));
  await expectDenied(setDoc(doc(db, "trees", "tree-extra-field"), { ...validTreeRecord(), unexpected: true }));
  await expectDenied(setDoc(doc(db, "trees", "tree-invalid-lifecycle"), { ...validTreeRecord(), lifecycleState: "paused" }));
  const missingLifecycle = { ...validTreeRecord() };
  delete missingLifecycle.lifecycleState;
  await expectDenied(setDoc(doc(db, "trees", "tree-new-missing-lifecycle"), missingLifecycle));
});

test("trees : lecture réservée aux comptes approuvés; membre et comptes pending/suspended refusés", async () => {
  await signOutAll();
  await expectDenied(getDoc(doc(db, "trees", TREE_FIXTURE_ID)));
  await expectDenied(getDocs(collection(db, "trees")));

  const pendingEmail = "tree-pending-emulator@test-fictif.fr";
  await createUserWithEmailAndPassword(auth, pendingEmail, "tree-pending-123");
  const pendingUid = auth.currentUser.uid;
  await setDoc(doc(db, "users", pendingUid), { email: pendingEmail, displayName: "Tree pending", photo: "", role: "member", status: "pending" });
  await expectDenied(getDoc(doc(db, "trees", TREE_FIXTURE_ID)));

  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const suspendedEmail = "tree-suspended-emulator@test-fictif.fr";
  await createUserWithEmailAndPassword(auth, suspendedEmail, "tree-suspended-123");
  const suspendedUid = auth.currentUser.uid;
  await setDoc(doc(db, "users", suspendedUid), { email: suspendedEmail, displayName: "Tree suspended", photo: "", role: "member", status: "pending" });
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await updateDoc(doc(db, "users", suspendedUid), { email: suspendedEmail, displayName: "Tree suspended", photo: "", role: "member", status: "suspended" });
  await signIn(suspendedUid, suspendedEmail, "tree-suspended-123");
  await expectDenied(getDoc(doc(db, "trees", TREE_FIXTURE_ID)));

  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  assert.equal((await getDoc(doc(db, "trees", TREE_FIXTURE_ID))).data().name, "Arbre renommé");
  assert.ok((await getDocs(collection(db, "trees"))).size >= 1, "un compte approuvé peut lister les arbres");
});

test("trees : seuls les admins peuvent créer/modifier et aucune suppression n'est permise", async () => {
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await expectDenied(setDoc(doc(db, "trees", "tree-member-create"), validTreeRecord()));
  await expectDenied(updateDoc(doc(db, "trees", TREE_FIXTURE_ID), { name: "Modification membre", updatedAt: new Date(), updatedBy: memberUid }));
  await expectDenied(deleteDoc(doc(db, "trees", TREE_FIXTURE_ID)));

  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await setDoc(doc(db, "trees", TREE_EMPTY_ID), validTreeRecord("Arbre vide"));
  // Refusé même vide : les règles seules ne savent pas vérifier qu'aucune personne
  // n'a treeId=tree-empty-fixture. Une future suppression nécessite un protocole sûr.
  await expectDenied(deleteDoc(doc(db, "trees", TREE_EMPTY_ID)));
  await expectDenied(deleteDoc(doc(db, "trees", TREE_FIXTURE_ID)));
});

test("cycle de vie : arbre vide supprimé après verrou, relecture du jeton et requête serveur exhaustive", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const treeRef = doc(db, "trees", "tree-lifecycle-empty");
  await setDoc(treeRef, validTreeRecord("Arbre vide lifecycle"));
  const token = await lockTree(treeRef, "emulator-empty-delete-token-001");
  const members = await getDocs(query(collection(db, "people"), where("treeId", "==", treeRef.id)));
  assert.equal(members.empty, true);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(treeRef);
    assert.equal(snapshot.data().lifecycleState, "deleting");
    assert.equal(snapshot.data().deletionToken, token);
    transaction.delete(treeRef);
  });
  assert.equal((await getDoc(treeRef)).exists(), false);
});

test("compatibilité Firestore : un arbre historique sans lifecycleState reste actif et verrouillable", async () => {
  const treeId = "tree-lifecycle-legacy";
  const treeRef = doc(db, "trees", treeId);
  const personRef = doc(db, "people", "tree-lifecycle-legacy-member");
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await seedLegacyTreeWithoutLifecycle(treeId, "Arbre historique sans état");
  assert.equal((await getDoc(treeRef)).data().lifecycleState, undefined);
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await setDoc(personRef, { firstName: "Historique", lastName: "Compatible", treeId });
  assert.equal((await getDoc(personRef)).data().treeId, treeId, "création historique compatible dans l’arbre sans état");
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const token = await lockTree(treeRef, "emulator-legacy-lock-token-001");
  assert.equal((await getDoc(treeRef)).data().lifecycleState, "deleting");
  await recoverTree(treeRef, token);
  assert.equal((await getDoc(treeRef)).data().lifecycleState, "active");
});

test("barrière lifecycle : bloque toute nouvelle destination, conserve les éditions ordinaires et autorise les sorties", async () => {
  const treeRef = doc(db, "trees", "tree-lifecycle-barrier");
  const memberRef = doc(db, "people", "tree-lifecycle-existing-member");
  const hiddenRef = doc(db, "people", "tree-lifecycle-hidden-member");
  const unassignedRef = doc(db, "people", "tree-lifecycle-unassigned");
  const individualTransferRef = doc(db, "people", "tree-lifecycle-individual-transfer");
  const incomingRef = doc(db, "people", "tree-lifecycle-incoming");
  const multiARef = doc(db, "people", "tree-lifecycle-multi-a");
  const multiBRef = doc(db, "people", "tree-lifecycle-multi-b");
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await setDoc(treeRef, validTreeRecord("Arbre barrière"));
  await setDoc(memberRef, { firstName: "Déjà", lastName: "Affecté", treeId: treeRef.id });
  await setDoc(hiddenRef, { firstName: "Masquée", lastName: "Affectée", treeId: treeRef.id, inTree: false });
  await setDoc(unassignedRef, { firstName: "Sans", lastName: "Arbre", treeId: "", treeAssignmentState: "unassigned" });
  await setDoc(individualTransferRef, { firstName: "Transfert", lastName: "Individuel" });
  await setDoc(multiARef, { firstName: "Multi A", lastName: "Fictif" });
  await setDoc(multiBRef, { firstName: "Multi B", lastName: "Fictif" });
  const beforeLock = await getDocs(query(collection(db, "people"), where("treeId", "==", treeRef.id)));
  assert.equal(beforeLock.size, 2, "la fiche masquée compte, la personne sans arbre ne compte pas");

  const token = await lockTree(treeRef, "emulator-barrier-token-001");
  await expectDenied(updateDoc(treeRef, { name: "Renommage interdit pendant le verrou", updatedAt: new Date(), updatedBy: adminUid }));
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await expectDenied(setDoc(incomingRef, { firstName: "Arrivée", lastName: "Refusée", treeId: treeRef.id }));
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  // 4C : main → destination verrouillée refusé avant toute écriture.
  await expectDenied(updateDoc(individualTransferRef, { treeId: treeRef.id }));
  assert.equal((await getDoc(individualTransferRef)).data().treeId, undefined);
  await updateDoc(memberRef, { firstName: "Édition permise" });
  assert.equal((await getDoc(memberRef)).data().treeId, treeRef.id, "édition métier autorisée sans changement d’appartenance");
  // Une fiche réellement dans l'arbre peut en sortir vers main ou Aucun arbre.
  await updateDoc(memberRef, { treeId: "main" });
  await updateDoc(hiddenRef, { treeId: "", treeAssignmentState: "unassigned" });
  assert.equal((await getDoc(memberRef)).data().treeId, "main");
  assert.equal((await getDoc(hiddenRef)).data().treeAssignmentState, "unassigned");

  // 4F : unassigned → arbre verrouillé refusé.
  await expectDenied(updateDoc(unassignedRef, { treeId: treeRef.id, treeAssignmentState: deleteField() }));
  // 4D : transaction multi-document entièrement refusée, aucune écriture partielle.
  await expectDenied(runTransaction(db, async transaction => {
    await Promise.all([transaction.get(multiARef), transaction.get(multiBRef)]);
    transaction.update(multiARef, { treeId: treeRef.id });
    transaction.update(multiBRef, { treeId: treeRef.id });
  }));
  assert.equal((await getDoc(multiARef)).data().treeId, undefined);
  assert.equal((await getDoc(multiBRef)).data().treeId, undefined);

  // La tentative ayant vu les deux membres réactive l'arbre uniquement avec son jeton.
  await recoverTree(treeRef, token);
  assert.equal((await getDoc(treeRef)).data().lifecycleState, "active");
  assert.equal("deletionToken" in (await getDoc(treeRef)).data(), false);
});

test("transition lifecycle : admin seulement, jeton, récupération conditionnelle et suppression finale", async () => {
  const treeRef = doc(db, "trees", "tree-lifecycle-recovery");
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await setDoc(treeRef, validTreeRecord("Arbre secondaire"));
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await expectDenied(updateDoc(treeRef, {
    lifecycleState: "deleting", deletionToken: "member-forbidden-token",
    deletionStartedAt: new Date(), deletionStartedBy: memberUid,
    updatedAt: new Date(), updatedBy: memberUid
  }));

  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const token = await lockTree(treeRef, "emulator-recovery-token-001");
  await assert.rejects(lockTree(treeRef, "emulator-recovery-token-duplicate"), /arbre déjà verrouillé/);
  await assert.rejects(recoverTree(treeRef, "jeton-perime-invalide"), /jeton modifié/);
  assert.equal((await getDoc(treeRef)).data().deletionToken, token, "un jeton incorrect ne lève pas le verrou");
  await recoverTree(treeRef, token);
  assert.equal((await getDoc(treeRef)).data().lifecycleState, "active");
  await assert.rejects(runTransaction(db, async transaction => {
    const snapshot = await transaction.get(treeRef);
    if (!snapshot.exists() || snapshot.data().lifecycleState !== "deleting" || snapshot.data().deletionToken !== token) {
      throw new Error("jeton périmé");
    }
    transaction.delete(treeRef);
  }), /jeton périmé/);

  const currentToken = await lockTree(treeRef, "emulator-recovery-token-002");
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(treeRef);
    assert.equal(snapshot.data().deletionToken, currentToken);
    transaction.delete(treeRef);
  });
  assert.equal((await getDoc(treeRef)).exists(), false);
  await assert.rejects(runTransaction(db, async transaction => {
    const snapshot = await transaction.get(treeRef);
    if (!snapshot.exists()) throw new Error("arbre absent");
    transaction.delete(treeRef);
  }), /arbre absent/);
});

test("concurrence : une création avant le verrou bloque, une affectation lue avant le verrou est réévaluée", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const treeRef = doc(db, "trees", "tree-lifecycle-concurrent");
  const targetRef = doc(db, "people", "tree-lifecycle-concurrent-target");
  const arrivingRef = doc(db, "people", "tree-lifecycle-concurrent-arriving");
  await setDoc(treeRef, validTreeRecord("Arbre concurrent"));
  await setDoc(targetRef, { firstName: "Cible", lastName: "Fictive" });

  let signalRead;
  let releaseTransaction;
  const readFinished = new Promise(resolve => { signalRead = resolve; });
  const continueTransaction = new Promise(resolve => { releaseTransaction = resolve; });
  let attempts = 0;
  const assigning = runTransaction(db, async transaction => {
    attempts++;
    const treeSnapshot = await transaction.get(treeRef);
    if (attempts === 1) { signalRead(); await continueTransaction; }
    if (treeSnapshot.data().lifecycleState !== "active") throw new Error("destination locked");
    transaction.update(targetRef, { treeId: treeRef.id });
  });
  await readFinished;
  const token = await lockTree(treeRef, "emulator-concurrent-token-001");
  releaseTransaction();
  await assert.rejects(assigning, /destination locked|permission-denied/i);
  assert.ok(attempts >= 1, "la tentative a lu la destination avant son refus conditionnel");
  assert.equal((await getDoc(targetRef)).data().treeId, undefined, "pas d’affectation après le verrou");
  await expectDenied(setDoc(arrivingRef, { firstName: "Création", lastName: "Refusée", treeId: treeRef.id }));

  // Une création déjà validée avant le verrou apparaît dans la requête serveur.
  await recoverTree(treeRef, token);
  await setDoc(arrivingRef, { firstName: "Créée avant", lastName: "Verrou", treeId: treeRef.id, inTree: false });
  const secondToken = await lockTree(treeRef, "emulator-concurrent-token-002");
  const completeRead = await getDocs(query(collection(db, "people"), where("treeId", "==", treeRef.id)));
  assert.deepEqual(completeRead.docs.map(snapshot => snapshot.id), [arrivingRef.id]);
  await recoverTree(treeRef, secondToken);
});

test("deux sessions administrateur concurrentes : une seule obtient le verrou du même arbre", async () => {
  const secondEmail = "second-admin-emulator@test-fictif.fr";
  const secondPassword = "second-admin-fictif-123";
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const secondCredential = await createUserWithEmailAndPassword(auth, secondEmail, secondPassword);
  const secondUid = secondCredential.user.uid;
  await setDoc(doc(db, "users", secondUid), {
    email: secondEmail, displayName: "Second administrateur", photo: "", role: "member", status: "pending"
  });
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await updateDoc(doc(db, "users", secondUid), {
    email: secondEmail, displayName: "Second administrateur", photo: "", role: "admin", status: "approved"
  });

  const secondApp = initializeApp({ apiKey: "test-only-fake-api-key", projectId: EMULATOR_PROJECT_ID }, "second-admin-session");
  const secondAuth = getAuth(secondApp);
  connectAuthEmulator(secondAuth, `http://${HOST}:${AUTH_PORT}`, { disableWarnings: true });
  const secondDb = initializeFirestore(secondApp, { experimentalForceLongPolling: true });
  connectFirestoreEmulator(secondDb, HOST, EMULATOR_PORT);
  try {
    await signInWithEmailAndPassword(secondAuth, secondEmail, secondPassword);
    await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
    const treeId = "tree-lifecycle-two-admins";
    const firstTreeRef = doc(db, "trees", treeId);
    const secondTreeRef = doc(secondDb, "trees", treeId);
    await setDoc(firstTreeRef, validTreeRecord("Arbre à verrouiller deux fois"));

    let readCount = 0;
    let signalBothReads;
    let releaseBoth;
    const bothRead = new Promise(resolve => { signalBothReads = resolve; });
    const gate = new Promise(resolve => { releaseBoth = resolve; });
    const beginLock = (clientDb, treeRef, uid, token) => {
      let firstAttempt = true;
      return runTransaction(clientDb, async transaction => {
        const snapshot = await transaction.get(treeRef);
        if (firstAttempt) {
          firstAttempt = false;
          readCount++;
          if (readCount === 2) signalBothReads();
          await gate;
        }
        if (!snapshot.exists() || (snapshot.data().lifecycleState !== "active" && snapshot.data().lifecycleState != null)) {
          throw new Error("un autre administrateur a verrouillé l’arbre");
        }
        transaction.update(treeRef, {
          lifecycleState: "deleting", deletionToken: token,
          deletionStartedAt: new Date(), deletionStartedBy: uid,
          updatedAt: new Date(), updatedBy: uid
        });
      });
    };

    const first = beginLock(db, firstTreeRef, adminUid, "first-admin-lock-token-001");
    const second = beginLock(secondDb, secondTreeRef, secondUid, "second-admin-lock-token-01");
    await bothRead;
    releaseBoth();
    const outcomes = await Promise.allSettled([first, second]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(result => result.status === "rejected").length, 1);
    const locked = (await getDoc(firstTreeRef)).data();
    assert.equal(locked.lifecycleState, "deleting");
    assert.ok(["first-admin-lock-token-001", "second-admin-lock-token-01"].includes(locked.deletionToken));
    await recoverTree(firstTreeRef, locked.deletionToken);
  } finally {
    await signOut(secondAuth);
    await deleteApp(secondApp);
  }
});

test("people.treeId : membre approuvé crée dans un arbre existant; seul admin déplace une fiche", async () => {
  const memberMain = doc(db, "people", "tree-person-main-member");
  const memberNullMain = doc(db, "people", "tree-person-null-main-member");
  const memberSecondary = doc(db, "people", "tree-person-secondary-member");
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await setDoc(memberMain, { firstName: "Main", lastName: "Fictif", updatedBy: memberUid, updatedByName: "Membre Émulateur" });
  await setDoc(memberNullMain, { firstName: "Main nul", lastName: "Fictif", treeId: null });
  await updateDoc(memberNullMain, { firstName: "Main nul modifié" });
  assert.equal((await getDoc(memberNullMain)).data().treeId, null, "treeId null reste compatible lors d’une édition sans déplacement");
  await setDoc(doc(db, "people", "tree-person-explicit-main"), { firstName: "Main", lastName: "Explicite", treeId: "main" });
  await setDoc(memberSecondary, { firstName: "Secondaire", lastName: "Fictif", treeId: TREE_FIXTURE_ID });
  assert.equal((await getDoc(memberSecondary)).data().treeId, TREE_FIXTURE_ID);
  await expectDenied(setDoc(doc(db, "people", "tree-person-missing-tree"), { firstName: "Absent", lastName: "Fictif", treeId: "tree-unknown" }));
  await expectDenied(setDoc(doc(db, "people", "tree-person-invalid-id"), { firstName: "Invalide", lastName: "Fictif", treeId: "tree/a" }));

  await signOutAll();
  const pendingEmail = "tree-person-pending-emulator@test-fictif.fr";
  const pending = await createUserWithEmailAndPassword(auth, pendingEmail, "tree-person-pending-123");
  await setDoc(doc(db, "users", pending.user.uid), { email: pendingEmail, displayName: "Tree pending", photo: "", role: "member", status: "pending" });
  await expectDenied(setDoc(doc(db, "people", "tree-person-pending-secondary"), { firstName: "Pending", lastName: "Fictif", treeId: TREE_FIXTURE_ID }));

  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await setDoc(doc(db, "people", "tree-person-admin-secondary"), { firstName: "Secondaire admin", lastName: "Fictif", treeId: TREE_FIXTURE_ID });
  await expectDenied(deleteDoc(doc(db, "trees", TREE_FIXTURE_ID)));
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await expectDenied(updateDoc(memberMain, { treeId: TREE_FIXTURE_ID }));
  await expectDenied(runTransaction(db, async transaction => {
    const snapshot = await transaction.get(memberMain);
    transaction.update(memberMain, { treeId: TREE_FIXTURE_ID });
    return snapshot.exists();
  }));
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(memberMain);
    assert.equal(snapshot.exists(), true);
    transaction.update(memberMain, { treeId: TREE_FIXTURE_ID, updatedBy: adminUid, updatedByName: "Administrateur Émulateur" });
  });
  assert.equal((await getDoc(memberMain)).data().treeId, TREE_FIXTURE_ID);
  await updateDoc(memberMain, { treeId: "main" });
  assert.equal((await getDoc(memberMain)).data().treeId, "main");
});

test("transaction de transfert refuse une source changée concurremment", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ref = doc(db, "people", "tree-person-transfer-concurrent");
  await setDoc(ref, { firstName: "Concurrence", lastName: "Fictive" });
  let attempts = 0;
  let signalRead;
  let releaseTransaction;
  const readFinished = new Promise(resolve => { signalRead = resolve; });
  const continueTransaction = new Promise(resolve => { releaseTransaction = resolve; });
  const transfer = runTransaction(db, async transaction => {
    attempts++;
    const snapshot = await transaction.get(ref);
    const currentTreeId = snapshot.data().treeId == null ? "main" : snapshot.data().treeId;
    if (attempts === 1) {
      signalRead();
      await continueTransaction;
    }
    if (currentTreeId !== "main") throw new Error("L'appartenance a changé depuis l'aperçu");
    transaction.update(ref, { treeId: TREE_FIXTURE_ID, updatedBy: adminUid });
  });

  await readFinished;
  await updateDoc(ref, { treeId: TREE_FIXTURE_ID, updatedBy: adminUid });
  releaseTransaction();
  await assert.rejects(transfer, /appartenance a changé/);
  assert.ok(attempts >= 2, "la transaction a relu la personne après conflit");
  assert.equal((await getDoc(ref)).data().treeId, TREE_FIXTURE_ID, "le transfert concurrent n'est pas écrasé");
});

test("transfert multiple atomique : seuls les identifiants sélectionnés changent", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ids = ["multi-emulator-jean", "multi-emulator-marie", "multi-emulator-paul", "multi-emulator-sophie"];
  const familyId = "multi-emulator-parents-paul";
  const familyRef = doc(db, "families", familyId);
  const selectedIds = [ids[0], ids[2]];
  try {
    await setDoc(doc(db, "people", ids[0]), { firstName: "Jean", lastName: "Fictif", notes: "Préservée" });
    await setDoc(doc(db, "people", ids[1]), { firstName: "Marie", lastName: "Fictif", treeId: null });
    await setDoc(doc(db, "people", ids[2]), { firstName: "Paul", lastName: "Fictif", inTree: false, notes: "Masqué conservé" });
    await setDoc(doc(db, "people", ids[3]), { firstName: "Sophie", lastName: "Fictif", treeId: TREE_FIXTURE_ID });
    await setDoc(familyRef, {
      partnerIds: [ids[0], ids[1]], childIds: [ids[2]],
      parentChildLinks: [
        { parentId: ids[0], childId: ids[2], type: "biological" },
        { parentId: ids[1], childId: ids[2], type: "biological" }
      ]
    });
    const familyBefore = (await getDoc(familyRef)).data();
    const personSnapshots = await Promise.all(ids.map(id => getDoc(doc(db, "people", id))));
    const treeSnapshot = await getDoc(doc(db, "trees", TREE_FIXTURE_ID));
    const initialPeople = personSnapshots.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
    const expected = prepareMultipleTreeTransferPlan({
      personIds: selectedIds, people: initialPeople, families: [{ id: familyId, ...familyBefore }],
      trees: [{ id: TREE_FIXTURE_ID, name: treeSnapshot.data().name }], destinationTreeId: TREE_FIXTURE_ID
    });
    const refsToRead = [...new Set([...selectedIds, ...expected.affectedFamilies.flatMap(family => family.memberIds)])];
    await runTransaction(db, async transaction => {
      const personReads = await Promise.all(refsToRead.map(id => transaction.get(doc(db, "people", id))));
      const familyReads = await Promise.all(expected.affectedFamilies.map(family => transaction.get(doc(db, "families", family.familyId))));
      const targetTree = await transaction.get(doc(db, "trees", TREE_FIXTURE_ID));
      assert.equal(targetTree.exists(), true);
      const txPeople = personReads.filter(snapshot => snapshot.exists()).map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
      const txFamilies = familyReads.filter(snapshot => snapshot.exists()).map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
      const actual = prepareMultipleTreeTransferPlan({
        personIds: selectedIds, people: txPeople, families: txFamilies,
        trees: [{ id: TREE_FIXTURE_ID, name: targetTree.data().name }], destinationTreeId: TREE_FIXTURE_ID
      });
      assert.equal(actual.fingerprint, expected.fingerprint);
      for (const id of selectedIds) transaction.update(doc(db, "people", id), { treeId: TREE_FIXTURE_ID });
    });
    for (const id of selectedIds) assert.equal((await getDoc(doc(db, "people", id))).data().treeId, TREE_FIXTURE_ID);
    assert.equal((await getDoc(doc(db, "people", ids[1]))).data().treeId, null, "Marie non sélectionnée reste dans main");
    assert.equal((await getDoc(doc(db, "people", ids[3]))).data().treeId, TREE_FIXTURE_ID, "Sophie non sélectionnée n'est pas réécrite");
    const paulAfter = (await getDoc(doc(db, "people", ids[2]))).data();
    assert.equal(paulAfter.inTree, false);
    assert.equal(paulAfter.notes, "Masqué conservé");
    assert.deepEqual((await getDoc(familyRef)).data(), familyBefore, "aucune famille ni relation n'est écrite");
  } finally {
    for (const id of ids) await deleteDoc(doc(db, "people", id));
    await deleteDoc(familyRef);
  }
});

test("transfert multiple atomique : relation modifiée durant la transaction annule tout le groupe", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const personA = "multi-emulator-conflict-a", personB = "multi-emulator-conflict-b";
  const familyRef = doc(db, "families", "multi-emulator-conflict-family");
  try {
    await setDoc(doc(db, "people", personA), { firstName: "A", lastName: "Fictif" });
    await setDoc(doc(db, "people", personB), { firstName: "B", lastName: "Fictif" });
    await setDoc(familyRef, { partnerIds: [personA, personB], childIds: [], parentChildLinks: [] });
    const initial = await Promise.all([getDoc(doc(db, "people", personA)), getDoc(doc(db, "people", personB)), getDoc(familyRef), getDoc(doc(db, "trees", TREE_FIXTURE_ID))]);
    const expected = prepareMultipleTreeTransferPlan({
      personIds: [personA, personB], people: initial.slice(0, 2).map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
      families: [{ id: familyRef.id, ...initial[2].data() }],
      trees: [{ id: TREE_FIXTURE_ID, name: initial[3].data().name }], destinationTreeId: TREE_FIXTURE_ID
    });

    let signalRead;
    let releaseTransaction;
    const readFinished = new Promise(resolve => { signalRead = resolve; });
    const continueTransaction = new Promise(resolve => { releaseTransaction = resolve; });
    let attempts = 0;
    const transfer = runTransaction(db, async transaction => {
      attempts++;
      const personReads = await Promise.all([personA, personB].map(id => transaction.get(doc(db, "people", id))));
      const familyRead = await transaction.get(familyRef);
      const treeRead = await transaction.get(doc(db, "trees", TREE_FIXTURE_ID));
      if (attempts === 1) { signalRead(); await continueTransaction; }
      const actual = prepareMultipleTreeTransferPlan({
        personIds: [personA, personB], people: personReads.filter(snapshot => snapshot.exists()).map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
        families: familyRead.exists() ? [{ id: familyRead.id, ...familyRead.data() }] : [],
        trees: treeRead.exists() ? [{ id: TREE_FIXTURE_ID, name: treeRead.data().name }] : [],
        destinationTreeId: TREE_FIXTURE_ID
      });
      if (actual.fingerprint !== expected.fingerprint) throw new Error("Relations modifiées pendant le transfert");
      transaction.update(doc(db, "people", personA), { treeId: TREE_FIXTURE_ID });
      transaction.update(doc(db, "people", personB), { treeId: TREE_FIXTURE_ID });
    });

    await readFinished;
    await updateDoc(familyRef, { parentChildLinks: [{ parentId: personA, childId: personB, type: "adoptive" }] });
    releaseTransaction();
    await assert.rejects(transfer, /Relations modifiées/);
    assert.ok(attempts >= 2, "Firestore relit la transaction après conflit");
    assert.equal((await getDoc(doc(db, "people", personA))).data().treeId, undefined, "aucune écriture partielle sur A");
    assert.equal((await getDoc(doc(db, "people", personB))).data().treeId, undefined, "aucune écriture partielle sur B");
  } finally {
    await deleteDoc(doc(db, "people", personA));
    await deleteDoc(doc(db, "people", personB));
    await deleteDoc(familyRef);
  }
});

test("limite du transfert multiple : 20 treeId se mettent à jour dans une seule transaction", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ids = Array.from({ length: 20 }, (_, index) => `multi-emulator-cap-${index}`);
  try {
    for (const id of ids) await setDoc(doc(db, "people", id), { firstName: "Test", lastName: `Groupe ${id}` });
    await runTransaction(db, async transaction => {
      const personSnapshots = await Promise.all(ids.map(id => transaction.get(doc(db, "people", id))));
      const targetTree = await transaction.get(doc(db, "trees", TREE_FIXTURE_ID));
      assert.equal(targetTree.exists(), true);
      assert.ok(personSnapshots.every(snapshot => snapshot.exists()));
      for (const id of ids) transaction.update(doc(db, "people", id), { treeId: TREE_FIXTURE_ID });
    });
    for (const id of ids) assert.equal((await getDoc(doc(db, "people", id))).data().treeId, TREE_FIXTURE_ID);
  } finally {
    for (const id of ids) await deleteDoc(doc(db, "people", id));
  }
});

test("transfert multiple : treeId sélectionnés atomiques, foyers et non-sélectionnés intacts", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ids = ["multi-emulator-jean", "multi-emulator-marie", "multi-emulator-paul", "multi-emulator-sophie"];
  const familyId = "multi-emulator-parents-paul";
  const familyRef = doc(db, "families", familyId);
  const selectedIds = [ids[0], ids[2]]; // Jean et Paul uniquement ; Marie reste dans main.
  try {
    await setDoc(doc(db, "people", ids[0]), { firstName: "Jean", lastName: "Fictif", notes: "Préservée" });
    await setDoc(doc(db, "people", ids[1]), { firstName: "Marie", lastName: "Fictif", treeId: null });
    await setDoc(doc(db, "people", ids[2]), { firstName: "Paul", lastName: "Fictif", inTree: false, notes: "Masqué conservé" });
    await setDoc(doc(db, "people", ids[3]), { firstName: "Sophie", lastName: "Fictif", treeId: TREE_FIXTURE_ID });
    await setDoc(familyRef, {
      partnerIds: [ids[0], ids[1]], childIds: [ids[2]],
      parentChildLinks: [
        { parentId: ids[0], childId: ids[2], type: "biological" },
        { parentId: ids[1], childId: ids[2], type: "biological" }
      ]
    });
    const familyBefore = (await getDoc(familyRef)).data();
    const personSnapshots = await Promise.all(ids.map(id => getDoc(doc(db, "people", id))));
    const treeSnapshot = await getDoc(doc(db, "trees", TREE_FIXTURE_ID));
    const initialPeople = personSnapshots.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
    const expected = prepareMultipleTreeTransferPlan({
      personIds: selectedIds, people: initialPeople, families: [{ id: familyId, ...familyBefore }],
      trees: [{ id: TREE_FIXTURE_ID, name: treeSnapshot.data().name }], destinationTreeId: TREE_FIXTURE_ID
    });
    const refsToRead = [...new Set([...selectedIds, ...expected.affectedFamilies.flatMap(family => family.memberIds)])];
    await runTransaction(db, async transaction => {
      const personReads = await Promise.all(refsToRead.map(id => transaction.get(doc(db, "people", id))));
      const familyReads = await Promise.all(expected.affectedFamilies.map(family => transaction.get(doc(db, "families", family.familyId))));
      const targetTree = await transaction.get(doc(db, "trees", TREE_FIXTURE_ID));
      assert.equal(targetTree.exists(), true);
      const txPeople = personReads.filter(snapshot => snapshot.exists()).map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
      const txFamilies = familyReads.filter(snapshot => snapshot.exists()).map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
      const actual = prepareMultipleTreeTransferPlan({ personIds: selectedIds, people: txPeople, families: txFamilies, trees: [{ id: TREE_FIXTURE_ID, name: targetTree.data().name }], destinationTreeId: TREE_FIXTURE_ID });
      assert.equal(actual.fingerprint, expected.fingerprint);
      for (const id of selectedIds) transaction.update(doc(db, "people", id), { treeId: TREE_FIXTURE_ID });
    });
    for (const id of selectedIds) assert.equal((await getDoc(doc(db, "people", id))).data().treeId, TREE_FIXTURE_ID);
    assert.equal((await getDoc(doc(db, "people", ids[1]))).data().treeId, null, "Marie non sélectionnée reste dans main");
    assert.equal((await getDoc(doc(db, "people", ids[3]))).data().treeId, TREE_FIXTURE_ID, "Sophie préexistante n'est pas déplacée ni réécrite");
    const paulAfter = (await getDoc(doc(db, "people", ids[2]))).data();
    assert.equal(paulAfter.inTree, false, "inTree false reste inchangé");
    assert.equal(paulAfter.notes, "Masqué conservé");
    assert.deepEqual((await getDoc(familyRef)).data(), familyBefore, "aucune relation n'est réécrite");
  } finally {
    for (const id of ids) await deleteDoc(doc(db, "people", id));
    await deleteDoc(familyRef);
  }
});

test("transfert multiple : modification concurrente d'un foyer annule toutes les écritures", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const personA = "multi-emulator-conflict-a", personB = "multi-emulator-conflict-b";
  const familyId = "multi-emulator-conflict-family";
  const familyRef = doc(db, "families", familyId);
  try {
    await setDoc(doc(db, "people", personA), { firstName: "A", lastName: "Fictif" });
    await setDoc(doc(db, "people", personB), { firstName: "B", lastName: "Fictif" });
    await setDoc(familyRef, { partnerIds: [personA, personB], childIds: [], parentChildLinks: [] });
    const snapshots = await Promise.all([getDoc(doc(db, "people", personA)), getDoc(doc(db, "people", personB)), getDoc(familyRef), getDoc(doc(db, "trees", TREE_FIXTURE_ID))]);
    const expected = prepareMultipleTreeTransferPlan({
      personIds: [personA, personB], people: snapshots.slice(0, 2).map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
      families: [{ id: familyId, ...snapshots[2].data() }], trees: [{ id: TREE_FIXTURE_ID, name: snapshots[3].data().name }], destinationTreeId: TREE_FIXTURE_ID
    });
    let signalRead;
    let releaseTransaction;
    const readFinished = new Promise(resolve => { signalRead = resolve; });
    const continueTransaction = new Promise(resolve => { releaseTransaction = resolve; });
    let attempts = 0;
    const transfer = runTransaction(db, async transaction => {
      attempts++;
      const personReads = await Promise.all([personA, personB].map(id => transaction.get(doc(db, "people", id))));
      const familyRead = await transaction.get(familyRef);
      const treeRead = await transaction.get(doc(db, "trees", TREE_FIXTURE_ID));
      if (attempts === 1) { signalRead(); await continueTransaction; }
      const actual = prepareMultipleTreeTransferPlan({
        personIds: [personA, personB], people: personReads.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() })),
        families: familyRead.exists() ? [{ id: familyRead.id, ...familyRead.data() }] : [],
        trees: treeRead.exists() ? [{ id: TREE_FIXTURE_ID, name: treeRead.data().name }] : [], destinationTreeId: TREE_FIXTURE_ID
      });
      if (actual.fingerprint !== expected.fingerprint) throw new Error("Relations modifiées pendant le transfert");
      transaction.update(doc(db, "people", personA), { treeId: TREE_FIXTURE_ID });
      transaction.update(doc(db, "people", personB), { treeId: TREE_FIXTURE_ID });
    });

    await readFinished;
    await updateDoc(familyRef, { parentChildLinks: [{ parentId: personA, childId: personB, type: "adoptive" }] });
    releaseTransaction();
    await assert.rejects(transfer, /Relations modifiées/);
    assert.ok(attempts >= 2, "la transaction relit après le conflit de version Firestore");
    assert.equal((await getDoc(doc(db, "people", personA))).data().treeId, undefined, "aucune écriture partielle sur A");
    assert.equal((await getDoc(doc(db, "people", personB))).data().treeId, undefined, "aucune écriture partielle sur B");
  } finally {
    await deleteDoc(doc(db, "people", personA));
    await deleteDoc(doc(db, "people", personB));
    await deleteDoc(familyRef);
  }
});

test("trees + people : arbre et première personne peuvent être créés atomiquement", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const batch = writeBatch(db);
  batch.set(doc(db, "trees", TREE_ATOMIC_ID), validTreeRecord("Arbre atomique"));
  batch.set(doc(db, "people", "tree-person-atomic"), { firstName: "Atomique", lastName: "Fictif", treeId: TREE_ATOMIC_ID });
  await batch.commit();
  assert.equal((await getDoc(doc(db, "trees", TREE_ATOMIC_ID))).exists(), true);
  assert.equal((await getDoc(doc(db, "people", "tree-person-atomic"))).data().treeId, TREE_ATOMIC_ID);
});

test("lecture Sources & preuves : les requêtes sans résultat sont des snapshots réussis pour admin et membre approuvé", async () => {
  const officialCollections = [
    "sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions",
    "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents"
  ];
  const readEmptyCollections = async () => {
    for (const name of officialCollections) {
      const snapshot = await getDocs(query(collection(db, name), where("id", "==", "aucune-entree-fixture-emulator")));
      assert.equal(snapshot.empty, true, `requête sans résultat sur ${name} acceptée`);
    }
  };

  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await readEmptyCollections();
  assert.ok((await getDocs(collection(db, "genealogyProposals"))).docs, "admin peut lire les propositions");
  assert.equal((await getDocs(query(collection(db, "genealogyNotifications"), where("recipientUid", "==", adminUid)))).empty, true,
    "admin peut recevoir un résultat vide pour sa portée de notifications");

  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await readEmptyCollections();
  assert.ok((await getDocs(query(collection(db, "genealogyProposals"), where("authorUid", "==", memberUid)))).docs,
    "membre approuvé peut lire sa requête de propositions");
  assert.equal((await getDocs(query(collection(db, "genealogyNotifications"), where("recipientUid", "==", memberUid), where("id", "==", "aucune-entree-fixture-emulator")))).empty, true,
    "membre approuvé peut lire sa requête de notifications sans résultat");
});

test("Sécurité Sources & preuves : matrice des accès sur les 11 collections", async () => {
  const allCollections = [
    "sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions",
    "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions",
    "genealogyProposals", "genealogyEvents", "genealogyNotifications"
  ];

  // ── Visiteur non authentifié : aucune lecture, aucune écriture ──
  await signOutAll();
  for (const name of allCollections.filter(n => n !== "genealogyNotifications")) {
    await expectDenied(getDocs(collection(db, name)));
  }
  await expectDenied(getDocs(query(collection(db, "genealogyNotifications"), where("recipientUid", "==", "anonyme"))));
  await expectDenied(setDoc(doc(db, "genealogyProposals", "securite-anon-proposal"), {
    type: "source", status: "draft", authorUid: "anon", targetType: "source", targetId: "x",
    payload: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));

  // ── Utilisateur authentifié non approuvé : aucune lecture, aucune écriture ──
  const unapprovedEmail = "non-approuve-securite@test-fictif.fr";
  const unapprovedCred = await createUserWithEmailAndPassword(auth, unapprovedEmail, "non-approuve-sec");
  await setDoc(doc(db, "users", unapprovedCred.user.uid), {
    email: unapprovedEmail, displayName: "Non Approuvé", photo: "", role: "member", status: "pending"
  });
  await signIn(unapprovedCred.user.uid, unapprovedEmail, "non-approuve-sec");
  for (const name of allCollections.filter(n => n !== "genealogyNotifications")) {
    await expectDenied(getDocs(collection(db, name)));
  }
  await expectDenied(getDocs(query(collection(db, "genealogyNotifications"), where("recipientUid", "==", unapprovedCred.user.uid))));
  await expectDenied(setDoc(doc(db, "genealogyProposals", "securite-unapproved-proposal"), {
    type: "source", status: "draft", authorUid: unapprovedCred.user.uid, targetType: "source",
    targetId: "x", payload: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await signOutAll();

  // ── Membre approuvé : lecture autorisée (portée restreinte), écriture officielle interdite ──
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  for (const name of allCollections.filter(n => n !== "genealogyProposals" && n !== "genealogyNotifications")) {
    const snap = await getDocs(query(collection(db, name), where("eventId", "==", "inexistant-emulator")));
    assert.equal(snap.empty, true, `membre : lecture vide acceptée sur ${name}`);
  }
  const myProposals = await getDocs(query(collection(db, "genealogyProposals"), where("authorUid", "==", memberUid)));
  assert.ok(myProposals.docs !== undefined, "membre : lecture de ses propositions acceptée");

  await expectDenied(setDoc(doc(db, "sourceDocuments", "securite-member-source"), {
    data: { title: "Interdite" }, version: 1, revisionId: "rev-sec", createdAt: serverTimestamp(),
    createdBy: memberUid, updatedAt: serverTimestamp(), updatedBy: memberUid, eventId: "evt-sec"
  }));
  await expectDenied(setDoc(doc(db, "factConclusions", "securite-member-conclusion"), {
    data: { status: "established" }, version: 1, revisionId: "rev-sec", createdAt: serverTimestamp(),
    createdBy: memberUid, updatedAt: serverTimestamp(), updatedBy: memberUid, eventId: "evt-sec"
  }));
  await expectDenied(setDoc(doc(db, "genealogyEvents", "securite-member-event"), {
    eventType: "source.created", objectType: "source", objectId: "x", actorUid: memberUid,
    createdAt: serverTimestamp(), previousVersionId: null, newVersionId: "r", reason: "test"
  }));
  await expectDenied(setDoc(doc(db, "genealogyNotifications", "securite-member-notif"), {
    recipientUid: memberUid, type: "proposal-accepted", objectType: "proposal", objectId: "x",
    eventId: "evt", createdAt: serverTimestamp(), read: false
  }));
  await signOutAll();

  // ── Administrateur : lecture complète des 11 collections ──
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  for (const name of allCollections.filter(n => n !== "genealogyNotifications")) {
    const snap = await getDocs(collection(db, name));
    assert.ok(snap !== null, `admin : lecture acceptée sur ${name}`);
  }
  const adminNotifs = await getDocs(query(collection(db, "genealogyNotifications"), where("recipientUid", "==", adminUid)));
  assert.ok(adminNotifs !== null, "admin : lecture acceptée sur genealogyNotifications");
  await signOutAll();

  // ── Accès croisé : un membre ne lit pas les propositions ni les notifications d'autrui ──
  const otherEmail = "autre-securite-emulator@test-fictif.fr";
  const otherCred = await createUserWithEmailAndPassword(auth, otherEmail, "autre-securite-123");
  await setDoc(doc(db, "users", otherCred.user.uid), {
    email: otherEmail, displayName: "Autre Membre", photo: "", role: "member", status: "pending"
  });
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await updateDoc(doc(db, "users", otherCred.user.uid), { status: "approved" });
  await signIn(otherCred.user.uid, otherEmail, "autre-securite-123");
  await expectDenied(getDocs(query(collection(db, "genealogyProposals"), where("authorUid", "==", memberUid))));
  await signOutAll();
});

test("LOT 6 : propositions, données officielles, historique immuable, notifications privées et atomicité", async () => {
  const store = createGenealogyCollaborationStore(db, { doc, runTransaction, serverTimestamp });
  const proposalId = "lot6-proposal-member";
  const rejectedProposalId = "lot6-proposal-rejected";
  const proposalEventId = "lot6-proposal-created";
  const decisionEventId = "lot6-proposal-accepted-event";
  const notificationId = "lot6-proposal-notification";

  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await store.createProposal({
    proposal: { id: proposalId, type: "source", targetType: "source", targetId: "source-example", payload: { title: "Source proposée" } },
    eventId: proposalEventId, actorUid: memberUid
  });
  await store.submitProposal({ proposalId, eventId: "lot6-proposal-submitted", actorUid: memberUid });
  await store.createProposal({
    proposal: { id: rejectedProposalId, type: "proof", targetType: "proof", targetId: "proof-rejected-example", payload: { relation: "ambiguous" } },
    eventId: "lot6-rejected-proposal-created", actorUid: memberUid
  });
  await store.submitProposal({ proposalId: rejectedProposalId, eventId: "lot6-rejected-proposal-submitted", actorUid: memberUid });
  const ownProposals = await getDocs(query(collection(db, "genealogyProposals"), where("authorUid", "==", memberUid)));
  assert.deepEqual(new Set(ownProposals.docs.map(snapshot => snapshot.id)), new Set([proposalId, rejectedProposalId]));
  await expectDenied(setDoc(doc(db, "sourceDocuments", "lot6-member-source"), {
    data: { title: "Interdite" }, version: 1, revisionId: "rev", createdAt: new Date(), createdBy: memberUid,
    updatedAt: new Date(), updatedBy: memberUid, eventId: "event"
  }));
  await expectDenied(store.decideProposal({
    proposalId, decision: "accepted", reason: "Fraude", eventId: "lot6-fraud-decision", notificationId: "lot6-fraud-notification", actorUid: memberUid
  }));
  await expectDenied(store.createReexaminationEvent({
    type: "proof", objectId: "proof-example", eventId: "lot6-member-review-event", reason: "Faux réexamen",
    administratorUids: [adminUid], notificationIds: ["lot6-member-review-notification"], actorUid: memberUid
  }));
  await expectDenied(setDoc(doc(db, "factConclusions", "lot6-member-conclusion"), {
    data: { status: "established" }, version: 1, revisionId: "member-conclusion-revision",
    createdAt: serverTimestamp(), createdBy: memberUid, updatedAt: serverTimestamp(), updatedBy: memberUid,
    eventId: "member-conclusion-event"
  }));

  await signOutAll();
  const otherEmail = "autre-membre-emulator@test-fictif.fr";
  const otherCredential = await createUserWithEmailAndPassword(auth, otherEmail, "autre-fictif-123");
  const otherUid = otherCredential.user.uid;
  await setDoc(doc(db, "users", otherUid), {
    email: otherEmail, displayName: "Autre membre", photo: "", role: "member", status: "pending"
  });
  await signOutAll();
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await updateDoc(doc(db, "users", otherUid), { status: "approved" });
  await signIn(otherUid, otherEmail, "autre-fictif-123");
  await expectDenied(getDoc(doc(db, "genealogyProposals", proposalId)));
  await expectDenied(getDocs(query(collection(db, "genealogyProposals"), where("authorUid", "==", memberUid))));
  assert.equal((await getDocs(query(collection(db, "genealogyProposals"), where("authorUid", "==", otherUid)))).size, 0);
  await expectDenied(updateDoc(doc(db, "genealogyProposals", proposalId), { payload: { title: "Volée" }, updatedAt: serverTimestamp() }));
  await expectDenied(updateDoc(doc(db, "genealogyProposals", rejectedProposalId), { payload: { relation: "supports" }, updatedAt: serverTimestamp() }));
  await signOutAll();

  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await store.notifyAdministrators({
    type: "proposal-submitted", objectType: "proposal", objectId: proposalId,
    eventId: "lot6-proposal-submitted", administratorUids: [adminUid],
    notificationIds: ["lot6-submitted-notification"]
  });
  assert.equal((await getDoc(doc(db, "genealogyNotifications", "lot6-submitted-notification"))).data().recipientUid, adminUid);
  await store.decideProposal({
    proposalId, decision: "accepted", reason: "Vérification éditoriale terminée", eventId: decisionEventId,
    notificationId, actorUid: adminUid
  });
  await store.decideProposal({
    proposalId: rejectedProposalId, decision: "rejected", reason: "Preuve source insuffisante",
    eventId: "lot6-proposal-rejected-event", notificationId: "lot6-proposal-rejected-notification", actorUid: adminUid
  });
  const proposal = await getDoc(doc(db, "genealogyProposals", proposalId));
  assert.equal(proposal.data().status, "accepted");
  assert.equal(proposal.data().resolvedBy, adminUid);
  assert.equal((await getDoc(doc(db, "genealogyProposals", rejectedProposalId))).data().status, "rejected");
  await expectDenied(updateDoc(doc(db, "genealogyProposals", proposalId), {
    status: "rejected", updatedAt: serverTimestamp(), resolvedAt: serverTimestamp(), resolvedBy: adminUid, resolutionReason: "réécriture"
  }));
  await expectDenied(updateDoc(doc(db, "genealogyProposals", rejectedProposalId), {
    status: "accepted", updatedAt: serverTimestamp(), resolvedAt: serverTimestamp(), resolvedBy: adminUid, resolutionReason: "réécriture"
  }));
  await signOutAll();
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await expectDenied(updateDoc(doc(db, "genealogyProposals", proposalId), { payload: { title: "modification après acceptation" }, updatedAt: serverTimestamp() }));
  await expectDenied(updateDoc(doc(db, "genealogyProposals", rejectedProposalId), { payload: { relation: "supports" }, updatedAt: serverTimestamp() }));
  const notification = await getDoc(doc(db, "genealogyNotifications", notificationId));
  assert.equal(notification.data().recipientUid, memberUid);
  assert.equal(notification.data().read, false);
  await signOutAll();
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(getDoc(doc(db, "genealogyNotifications", notificationId)));
  await signOutAll();
  await signIn(otherUid, otherEmail, "autre-fictif-123");
  await expectDenied(getDoc(doc(db, "genealogyNotifications", notificationId)));
  await signOutAll();
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectDenied(deleteDoc(doc(db, "genealogyEvents", decisionEventId)));
  await expectDenied(updateDoc(doc(db, "genealogyEvents", decisionEventId), { reason: "altération" }));
  await expectDenied(updateDoc(doc(db, "sourceRevisions", "lot6-source-revision"), { data: { title: "altération" } }));

  const linkedDocumentIds = ["lot6-link-document-a", "lot6-link-document-b"];
  for (const [index, documentId] of linkedDocumentIds.entries()) {
    await setDoc(doc(db, "documents", documentId), { title: `Document de bibliothèque ${index + 1}`, type: "Acte de naissance" });
  }
  await store.createOfficial({
    type: "source", id: "lot6-official-source", revisionId: "lot6-source-revision", eventId: "lot6-source-created-event",
    data: { title: "Source officielle", schemaVersion: 1, documentIds: linkedDocumentIds }, reason: "Création documentée", actorUid: adminUid
  });
  await store.createOfficial({
    type: "source", id: "lot6-official-source-second", revisionId: "lot6-source-second-revision",
    eventId: "lot6-source-second-event", data: { title: "Autre analyse du même document", schemaVersion: 1, documentIds: [linkedDocumentIds[0]] },
    reason: "Document réutilisé sans copie", actorUid: adminUid
  });
  const official = await getDoc(doc(db, "sourceDocuments", "lot6-official-source"));
  assert.equal(official.data().revisionId, "lot6-source-revision");
  assert.deepEqual(official.data().data.documentIds, linkedDocumentIds, "une source conserve plusieurs IDs de documents existants");
  await store.reviseOfficial({
    type: "source", id: "lot6-official-source", revisionId: "lot6-source-revision-2", eventId: "lot6-source-revised-event",
    data: { title: "Source corrigée", schemaVersion: 1, documentIds: [linkedDocumentIds[1]] }, reason: "Correction de cote", actorUid: adminUid
  });
  assert.deepEqual((await getDoc(doc(db, "sourceRevisions", "lot6-source-revision"))).data().data.documentIds, linkedDocumentIds,
    "la révision précédente reste immuable avec ses références originales");
  const revision = await getDoc(doc(db, "sourceRevisions", "lot6-source-revision-2"));
  assert.equal(revision.data().previousRevisionId, "lot6-source-revision");
  assert.deepEqual(revision.data().data.documentIds, [linkedDocumentIds[1]]);
  assert.deepEqual((await getDoc(doc(db, "sourceDocuments", "lot6-official-source-second"))).data().data.documentIds, [linkedDocumentIds[0]],
    "la suppression du lien d'une source n'altère pas l'association d'une autre source");
  await store.reviseOfficial({
    type: "source", id: "lot6-official-source", revisionId: "lot6-source-revision-3", eventId: "lot6-source-unlinked-event",
    data: { title: "Source corrigée", schemaVersion: 1, documentIds: [] }, reason: "Retrait du dernier document lié", actorUid: adminUid
  });
  assert.deepEqual((await getDoc(doc(db, "sourceDocuments", "lot6-official-source"))).data().data.documentIds, [],
    "le dernier lien peut être retiré sans supprimer la source");
  assert.deepEqual((await getDoc(doc(db, "sourceRevisions", "lot6-source-revision-2"))).data().data.documentIds, [linkedDocumentIds[1]],
    "la révision précédente reste immuable après le retrait du dernier lien");
  assert.equal((await getDoc(doc(db, "genealogyEvents", "lot6-source-unlinked-event"))).data().eventType, "source.revised");
  assert.deepEqual((await getDoc(doc(db, "documents", linkedDocumentIds[0]))).data(), { title: "Document de bibliothèque 1", type: "Acte de naissance" },
    "la création et la révision des sources ne copient ni ne modifient la fiche/fichier Documents");
  await expectDenied(updateDoc(doc(db, "sourceRevisions", "lot6-source-revision-2"), { data: { title: "effacée" } }));
  await store.createOfficial({
    type: "conclusion", id: "lot6-official-conclusion", revisionId: "lot6-conclusion-revision",
    eventId: "lot6-conclusion-created-event", data: { status: "provisional", retainedValue: null },
    reason: "Conclusion documentée", actorUid: adminUid
  });
  await signOutAll();
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await expectDenied(updateDoc(doc(db, "factConclusions", "lot6-official-conclusion"), { data: { status: "established" } }));
  await signOutAll();
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);

  await store.createReexaminationEvent({
    type: "proof", objectId: "proof-reexamination-example", eventId: "lot6-proof-review-event",
    reason: "Une transcription liée a changé", administratorUids: [adminUid], notificationIds: ["lot6-proof-review-notification"], actorUid: adminUid
  });
  const reviewEvent = await getDoc(doc(db, "genealogyEvents", "lot6-proof-review-event"));
  assert.equal(reviewEvent.data().eventType, "proof.reexamination.required");
  const reviewNotification = await getDoc(doc(db, "genealogyNotifications", "lot6-proof-review-notification"));
  assert.equal(reviewNotification.data().type, "proof-reexamination");
  assert.equal(reviewNotification.data().read, false);

  await store.createOfficial({
    type: "proof", id: "lot6-official-proof", revisionId: "lot6-proof-revision", eventId: "lot6-proof-created-event",
    data: { technicalStatus: "active", relation: "supports" }, reason: "Création de preuve", actorUid: adminUid
  });
  await store.reviseOfficial({
    type: "proof", id: "lot6-official-proof", revisionId: "lot6-proof-suspended-revision", eventId: "lot6-proof-suspended-event",
    data: { technicalStatus: "suspended", relation: "supports" }, eventType: "proof.suspended",
    reason: "Le passage cité est à vérifier", actorUid: adminUid
  });
  assert.equal((await getDoc(doc(db, "genealogyEvents", "lot6-proof-suspended-event"))).data().eventType, "proof.suspended");

  const archivableProof = createGenealogyProof({
    id: "lot6-proof-archivable", factId: "lot6-fact-archivable", factType: "birthDate", personIds: ["lot6-person-archivable"],
    documentId: linkedDocumentIds[0], sourceValue: null, relation: "supports", authorUid: adminUid
  });
  await store.createOfficial({
    type: "proof", id: "lot6-proof-archivable", revisionId: "lot6-proof-archivable-rev-1", eventId: "lot6-proof-archivable-created-event",
    data: archivableProof, reason: "Preuve créée pour test d’archivage", actorUid: adminUid
  });
  await signOutAll();
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await expectDenied(store.reviseOfficial({
    type: "proof", id: "lot6-proof-archivable", revisionId: "lot6-proof-member-rev", eventId: "lot6-proof-member-event",
    data: { ...archivableProof, technicalStatus: "historical" }, reason: "Tentative membre", actorUid: memberUid
  }));
  await signOutAll();
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const archiveEventId = "lot6-proof-archivable-event";
  const archivedProof = transitionProofStatus(archivableProof, {
    to: "historical", reason: "Preuve erronée archivée", eventId: archiveEventId, actorUid: adminUid, at: new Date().toISOString()
  });
  await store.reviseOfficial({
    type: "proof", id: "lot6-proof-archivable", revisionId: "lot6-proof-archivable-rev-2", eventId: archiveEventId,
    data: archivedProof, reason: "Preuve erronée archivée", actorUid: adminUid
  });
  assert.equal((await getDoc(doc(db, "genealogyProofs", "lot6-proof-archivable"))).data().data.technicalStatus, "historical");
  assert.equal((await getDoc(doc(db, "genealogyProofRevisions", "lot6-proof-archivable-rev-1"))).data().data.technicalStatus, "active",
    "l’ancienne révision de preuve reste immuable");
  assert.equal((await getDoc(doc(db, "genealogyEvents", archiveEventId))).data().eventType, "proof.revised");

  await signOutAll();
  await signIn(memberUid, MEMBER_EMAIL, MEMBER_PASSWORD);
  await store.markNotificationRead({ notificationId, actorUid: memberUid });
  assert.equal((await getDoc(doc(db, "genealogyNotifications", notificationId))).data().read, true);
  await expectDenied(updateDoc(doc(db, "genealogyNotifications", notificationId), { read: false, readAt: null }));
  await signOutAll();
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);

  await expectDenied(setDoc(doc(db, "genealogyEvents", "lot6-falsified-event"), {
    eventType: "source.created", objectType: "source", objectId: "fake", actorUid: memberUid,
    createdAt: new Date(), previousVersionId: null, newVersionId: "fake-revision", reason: "faux"
  }));
  await expectDenied(setDoc(doc(db, "genealogyEvents", "lot6-falsified-date-event"), {
    eventType: "source.created", objectType: "source", objectId: "fake", actorUid: adminUid,
    createdAt: new Date(0), previousVersionId: null, newVersionId: "fake-revision", reason: "date falsifiée"
  }));

  // Une collision d'événement fait échouer la transaction entière : aucun brouillon orphelin.
  await expectDenied(store.createProposal({
    proposal: { id: "lot6-atomicity-proposal", type: "proof", targetType: "proof", targetId: "proof", payload: {} },
    eventId: decisionEventId, actorUid: adminUid
  }));
  assert.equal((await getDoc(doc(db, "genealogyProposals", "lot6-atomicity-proposal"))).exists(), false);

  await signOutAll();
  const unapprovedEmail = "sans-validation-emulator@test-fictif.fr";
  await createUserWithEmailAndPassword(auth, unapprovedEmail, "sans-validation-123");
  await expectDenied(getDocs(collection(db, "sourceDocuments")));
  await expectDenied(getDocs(collection(db, "genealogyEvents")));
  await expectDenied(setDoc(doc(db, "genealogyProposals", "lot6-unapproved-proposal"), {
    type: "source", status: "draft", authorUid: auth.currentUser.uid, targetType: "source", targetId: "x", payload: {},
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});
