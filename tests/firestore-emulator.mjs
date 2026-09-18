// Suite d'intégration Firestore via l'émulateur local (jamais de contact réseau avec la production).
// Lancement : npm run test:firestore (firebase emulators:exec --only firestore,auth node --test tests/firestore-emulator.mjs)
// La garde anti-production (emulator-guard.mjs) refuse tout démarrage si FIRESTORE_EMULATOR_HOST n'est pas un hôte local.
// Fichier volontairement sans suffixe .test : il n'est PAS auto-découvert par `node --test` nu — il échouerait sans émulateur.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { initializeFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, query, where, Bytes } from "firebase/firestore";
import { FILE_CHUNK_BYTES, splitBytesIntoChunks, concatByteArrays, documentChunkId, sliceIntoBatches, importedDataFields } from "../js/backup-utils.js";
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

// ─── BATCH / RESTAURATION ────────────────────────────────────────────────────
test("batch : writeBatch.set avec identifiants dupliqués = dernier-écrit-gagne (sémantique set)", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ref = doc(db, "people", "person-chevauchenment");
  const batch = writeBatch(db);
  batch.set(ref, { lastName: "Première", firstName: "X" });
  batch.set(ref, { lastName: "Seconde", firstName: "X" });
  await batch.commit();
  assert.equal((await getDoc(ref)).data().lastName, "Seconde");
  await deleteDoc(ref);
});

test("writeImportedRecords : > 400 enregistrements découpés et écrits par lots de 400", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const enregistrements = Array.from({ length: 950 }, (_, i) => ({
    id: `person-batch-${String(i).padStart(4, "0")}`,
    lastName: "Import",
    firstName: `Personne ${i}`,
    importBatch: "lots-950"
  }));
  for (const lot of sliceIntoBatches(enregistrements, 400)) {
    const batch = writeBatch(db);
    for (const item of lot) batch.set(doc(db, "people", item.id), importedDataFields(item));
    await batch.commit();
  }
  const lectures = await getDocs(query(collection(db, "people"), where("importBatch", "==", "lots-950")));
  assert.equal(lectures.size, 950);
  const dernier = doc(db, "people", "person-batch-0949");
  assert.equal((await getDoc(dernier)).data().firstName, "Personne 949");
  for (const item of enregistrements) await deleteDoc(doc(db, "people", item.id));
});

test("cycle restauration : set chunks puis set documents avec mêmes métadonnées", async () => {
  await signIn(adminUid, ADMIN_EMAIL, ADMIN_PASSWORD);
  const documentId = "doc-restaure";
  const version = "rst-2026-001";
  const donnees = new TextEncoder().encode("contenu du document restauré");
  const parties = splitBytesIntoChunks(donnees, FILE_CHUNK_BYTES);
  for (let index = 0; index < parties.length; index++) {
    await setDoc(doc(db, "documentChunks", documentChunkId(documentId, version, index)), {
      documentId, version, index, data: Bytes.fromUint8Array(parties[index])
    });
  }
  await setDoc(doc(db, "documents", documentId), {
    title: "Document restauré",
    storageMode: "firestore-chunks",
    chunkVersion: version,
    chunkCount: parties.length,
    storedSize: donnees.length
  });
  const meta = (await getDoc(doc(db, "documents", documentId))).data();
  assert.equal(meta.chunkCount, parties.length);
  const lu = concatByteArrays([(await getDoc(doc(db, "documentChunks", documentChunkId(documentId, version, 0)))).data().data.toUint8Array()]);
  assert.deepEqual(new TextDecoder().decode(lu), "contenu du document restauré");
  for (let index = 0; index < parties.length; index++) await deleteDoc(doc(db, "documentChunks", documentChunkId(documentId, version, index)));
  await deleteDoc(doc(db, "documents", documentId));
});