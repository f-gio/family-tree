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

