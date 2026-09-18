import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  FILE_CHUNK_BYTES,
  MAX_FILE_BYTES,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  IMPORT_BATCH_SIZE,
  formatBytes,
  base64ToBytes,
  exportableRecord,
  importedDataFields,
  safeBackupName,
  backupFileEntryPath,
  isValidStoredDate,
  validateFamilyDataset,
  documentChunkId,
  chunkCountForBytes,
  splitBytesIntoChunks,
  concatByteArrays,
  collectChunkParts,
  sliceIntoBatches,
  buildBackupManifest,
  parseBackupManifestText
} from "../js/backup-utils.js";

const people = [
  { id: "person-grandpa-a", lastName: "Martin", firstName: "Jean", gender: "male", place: "Lyon", birthDateInfo: { type: "exact", value: "1940-05-10" }, deathDateInfo: { type: "about", year: 2015 } },
  { id: "person-grandma-a", lastName: "Martin", firstName: "Marie", gender: "female", birthDateInfo: { type: "about", year: 1942 }, notes: "née Durand" },
  { id: "person-parent-a", lastName: "Martin", firstName: "Paul", gender: "male", birthDateInfo: { type: "between", from: 1960, to: 1965 }, branch: "main" },
  { id: "person-parent-b", lastName: "Bernard", firstName: "Louise", gender: "female", birthDateInfo: { type: "year", year: 1962 }, deathDateInfo: { type: "unknown" } },
  { id: "person-child-a", lastName: "Martin", firstName: "Anna", birthDateInfo: { type: "unknown" } },
  { id: "person-legacy-child", lastName: "Martin", firstName: "Léa", marriedName: "Petit", place: "Paris", birthDate: "1975-03-02" }
];

const families = [
  {
    id: "union-grandparents",
    partnerIds: ["person-grandpa-a", "person-grandma-a"],
    relationType: "marriage",
    endType: "other",
    unionDateInfo: { type: "year", year: 1960 },
    endDateInfo: { type: "about", year: 2015 },
    childIds: ["person-parent-a"]
  },
  {
    id: "union-parents",
    partnerIds: ["person-parent-a", "person-parent-b"],
    childIds: ["person-child-a", "person-legacy-child"],
    parentChildLinks: [
      { parentId: "person-parent-a", childId: "person-child-a", type: "biological" },
      { parentId: "person-parent-b", childId: "person-child-a", type: "biological" },
      { parentId: "person-parent-a", childId: "person-legacy-child", type: "biological" },
      { parentId: "person-parent-b", childId: "person-legacy-child", type: "biological" }
    ]
  }
];

const documents = [
  {
    id: "document-a",
    title: "Extrait de naissance d’Anna",
    type: "Extrait",
    fileName: "acte naive.md",
    mimeType: "text/plain",
    fileSize: 1000,
    storedSize: 1000,
    storageMode: "firestore-chunks",
    chunkVersion: "v1",
    chunkCount: 2,
    fileData: "https://example.test/x",
    personIds: ["person-child-a"]
  },
  {
    id: "document-b",
    title: "Lien externe sans fichier",
    externalUrl: "https://example.test/lien",
    personIds: []
  }
];

const tasks = [
  { id: "task-a", title: "Reprendre le registre de Lyon", status: "todo", priority: "high", personId: "person-grandpa-a" }
];

const blobForDocumentA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

test("exportableRecord produit un clone profond sans références partagées", () => {
  const record = { id: "person-x", notes: ["a", "b"], nested: { key: "value" }, missing: undefined };
  const clone = exportableRecord(record);
  assert.deepEqual(clone, { id: "person-x", notes: ["a", "b"], nested: { key: "value" } });
  record.notes.push("c");
  record.nested.key = "changed";
  assert.deepEqual(clone.notes, ["a", "b"]);
  assert.equal(clone.nested.key, "value");
});

test("buildBackupManifest inclut exactement people, families, tasks et documents", () => {
  const blobs = new Map([["document-a", blobForDocumentA]]);
  const manifest = buildBackupManifest({ people, families, tasks, documents, blobs, exportedAt: "2026-09-18T00:00:00.000Z" });
  assert.deepEqual(Object.keys(manifest), ["format", "version", "exportedAt", "people", "families", "tasks", "documents"]);
  assert.equal(manifest.people.length, people.length);
  assert.equal(manifest.families.length, families.length);
  assert.equal(manifest.tasks.length, tasks.length);
  assert.equal(manifest.documents.length, documents.length);
  assert.equal(manifest.people[0].id, "person-grandpa-a");
  assert.equal(manifest.families[0].id, "union-grandparents");
  assert.equal(manifest.tasks[0].id, "task-a");
});

test("le manifeste porte le format et la version de sauvegarde attendus", () => {
  const manifest = buildBackupManifest({ people, families, tasks, documents });
  assert.equal(manifest.format, "family-tree-backup");
  assert.equal(BACKUP_FORMAT, "family-tree-backup");
  assert.equal(manifest.version, 3);
  assert.equal(BACKUP_VERSION, 3);
  assert.match(manifest.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("un document avec contenu obtient backupFile et perd ses métadonnées de stockage", () => {
  const blobs = new Map([["document-a", blobForDocumentA]]);
  const manifest = buildBackupManifest({ people, families, tasks, documents, blobs });
  const exported = manifest.documents.find(item => item.id === "document-a");
  assert.equal(exported.backupFile, "documents/document-a/acte_naive.md");
  assert.equal("fileData" in exported, false);
  assert.equal("fileUrl" in exported, false);
  assert.equal("storagePath" in exported, false);
  assert.equal("chunkVersion" in exported, false);
  assert.equal("chunkCount" in exported, false);
  assert.equal(exported.mimeType, "text/plain");
  assert.equal(exported.fileName, "acte naive.md");
  assert.equal(exported.personIds[0], "person-child-a");
});

test("un document sans contenu conserve toutes ses métadonnées", () => {
  const blobs = new Map([["document-a", blobForDocumentA]]);
  const manifest = buildBackupManifest({ people, families, tasks, documents, blobs });
  const exported = manifest.documents.find(item => item.id === "document-b");
  assert.equal("backupFile" in exported, false);
  assert.equal(exported.externalUrl, "https://example.test/lien");
  assert.deepEqual(exported.personIds, []);
});

test("la sauvegarde n’exporte ni users, ni droits, ni mots de passe, ni settings/access", () => {
  const fictiveUsers = [
    { uid: "user-admin-1", email: "admin@example.test", passwordHash: "hash-secret", role: "admin" },
    { uid: "user-reader-2", email: "lecteur@example.test", passwordHash: "hash-lecteur", role: "reader" }
  ];
  const fictiveSettings = { access: { openRegistration: true, adminUid: "user-admin-1" } };
  const blobs = new Map([["document-a", blobForDocumentA]]);
  const manifest = buildBackupManifest({ people, families, tasks, documents, blobs });
  assert.deepEqual(Object.keys(manifest), ["format", "version", "exportedAt", "people", "families", "tasks", "documents"]);
  const text = JSON.stringify(manifest);
  assert.equal(text.includes("user-admin-1"), false);
  assert.equal(text.includes("passwordHash"), false);
  assert.equal(text.includes("role"), false);
  assert.equal(text.includes("email"), false);
  assert.equal(text.includes("users"), false);
  assert.equal(text.includes("settings"), false);
  assert.equal(text.includes("token"), false);
  const exportedAt = "2026-09-18T00:00:00.000Z";
  const manifestWithExtras = buildBackupManifest({ people, families, tasks, documents, users: fictiveUsers, settings: fictiveSettings, blobs, exportedAt });
  assert.equal(JSON.stringify(manifestWithExtras), JSON.stringify(buildBackupManifest({ people, families, tasks, documents, blobs, exportedAt })));
});

test("backupFileEntryPath assainit le nom de fichier et retombe sur document-{id}", () => {
  assert.equal(backupFileEntryPath("document-a", "acte naive.md"), "documents/document-a/acte_naive.md");
  assert.equal(backupFileEntryPath("document-a", "acte/**.[ext"), "documents/document-a/acte_._ext");
  assert.equal(backupFileEntryPath("document-a", "…"), `documents/document-a/document-document-a`);
  assert.equal(backupFileEntryPath("document-a"), `documents/document-a/document-document-a`);
  assert.equal(safeBackupName("Nécessite / un nettoyage !"), "N_cessite_un_nettoyage");
  assert.equal(safeBackupName("…"), "document");
  assert.equal(safeBackupName(), "document");
});

test("backupFileEntryPath garantit un chemin ZIP unique même pour les noms entièrement invalides", () => {
  const first = backupFileEntryPath("document-a", "…");
  const again = backupFileEntryPath("document-a", "…");
  const otherInvalid = backupFileEntryPath("document-a", "///");
  const otherDocument = backupFileEntryPath("document-b", "…");
  assert.equal(first, `documents/document-a/document-document-a`);
  assert.equal(again, first);
  assert.equal(otherInvalid, first);
  assert.notEqual(otherDocument, first);
  assert.equal(backupFileEntryPath("document-a", "acte.pdf"), `documents/document-a/acte.pdf`);
});

test("importedDataFields retire id, createdAt, updatedAt et backupFile sans muter la source", () => {
  const record = {
    id: "document-a",
    title: "Extrait",
    fileName: "acte.pdf",
    birthDate: "1975-03-02",
    marriedName: "Petit",
    place: "Paris",
    partnerIds: ["p1", "p2"],
    chunkVersion: "v1",
    backupFile: "documents/document-a/acte.pdf",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-02T00:00:00.000Z"
  };
  const data = importedDataFields(record);
  assert.deepEqual(data, {
    title: "Extrait",
    fileName: "acte.pdf",
    birthDate: "1975-03-02",
    marriedName: "Petit",
    place: "Paris",
    partnerIds: ["p1", "p2"],
    chunkVersion: "v1"
  });
  assert.equal("id" in data, false);
  assert.equal("createdAt" in data, false);
  assert.equal("updatedAt" in data, false);
  assert.equal("backupFile" in data, false);
  assert.equal(record.id, "document-a");
  assert.equal(record.backupFile, "documents/document-a/acte.pdf");
});

test("validateFamilyDataset accepte un jeu fictif complet, y compris les filiations", () => {
  assert.doesNotThrow(() => validateFamilyDataset(people, families));
});

test("validateFamilyDataset rejette un identifiant de personne dupliqué ou contenant un slash", () => {
  assert.throws(() => validateFamilyDataset([{ id: "person-a" }, { id: "person-a" }], []), /identifiant de personne invalide ou dupliqué/);
  assert.throws(() => validateFamilyDataset([{ id: "a/b" }], []), /identifiant de personne invalide ou dupliqué/);
});

test("validateFamilyDataset rejette une référence à une personne absente", () => {
  const family = { id: "union-x", partnerIds: ["person-unknown", "person-grandma-a"], childIds: ["person-child-a"] };
  assert.throws(() => validateFamilyDataset(people, [family]), /fait référence à une personne absente/);
});

test("validateFamilyDataset rejette une boucle dans les liens parent-enfant", () => {
  const loopPeople = [
    { id: "p1" },
    { id: "p2" },
    { id: "p3" },
    { id: "p4" }
  ];
  const loopFamilies = [
    { id: "union-a", partnerIds: ["p1", "p2"], childIds: ["p3"] },
    { id: "union-b", partnerIds: ["p3", "p4"], childIds: ["p1"] }
  ];
  assert.throws(() => validateFamilyDataset(loopPeople, loopFamilies), /boucle dans les liens parent-enfant/);
});

test("validateFamilyDataset rejette une date généalogique invalide sur une personne", () => {
  const invalid = [{ id: "person-a", birthDateInfo: { type: "exact", value: "2020-13-40" } }];
  assert.throws(() => validateFamilyDataset(invalid, []), /La fiche person-a contient une date généalogique invalide/);
});

test("validateFamilyDataset rejette un enfant rattaché à deux foyers", () => {
  const splitPeople = [{ id: "za" }, { id: "zb" }, { id: "zc" }, { id: "zd" }, { id: "ze" }];
  const splitFamilies = [
    { id: "union-z1", partnerIds: ["za", "zb"], childIds: ["zc"] },
    { id: "union-z2", partnerIds: ["zd", "ze"], childIds: ["zc"] }
  ];
  assert.throws(() => validateFamilyDataset(splitPeople, splitFamilies), /rattachée comme enfant à plusieurs foyers/);
});

test("validateFamilyDataset rejette une filiation invalide ou dupliquée", () => {
  const badLink = {
    id: "union-p",
    partnerIds: ["person-parent-a", "person-parent-b"],
    childIds: ["person-child-a"],
    parentChildLinks: [{ parentId: "person-parent-a", childId: "person-child-a", type: "cousin" }]
  };
  assert.throws(() => validateFamilyDataset(people, [badLink]), /filiation invalide/);
  const dupLink = {
    id: "union-p",
    partnerIds: ["person-parent-a", "person-parent-b"],
    childIds: ["person-child-a"],
    parentChildLinks: [
      { parentId: "person-parent-a", childId: "person-child-a", type: "biological" },
      { parentId: "person-parent-a", childId: "person-child-a", type: "biological" }
    ]
  };
  assert.throws(() => validateFamilyDataset(people, [dupLink]), /filiation invalide ou dupliquée/);
});

test("validateFamilyDataset rejette une personne placée parmi ses propres parents", () => {
  const selfParent = { id: "union-p", partnerIds: ["person-parent-a", "person-grandma-a"], childIds: ["person-parent-a"] };
  assert.throws(() => validateFamilyDataset(people, [selfParent]), /parmi ses propres parents/);
});

test("validateFamilyDataset rejette les doublons dans partnerIds ou childIds", () => {
  const dupPartners = { id: "union-d", partnerIds: ["person-parent-a", "person-parent-a"], childIds: [] };
  assert.throws(() => validateFamilyDataset(people, [dupPartners]), /liens invalides/);
  const dupChildren = { id: "union-d", partnerIds: ["person-parent-a"], childIds: ["person-child-a", "person-child-a"] };
  assert.throws(() => validateFamilyDataset(people, [dupChildren]), /liens invalides/);
});

test("validateFamilyDataset accepte un jeu legacy (dates en chaîne, marriedName, place libre)", () => {
  const legacyPeople = [
    { id: "person-anc", lastName: "Petit", place: "Bourg-en-Bresse", birthDate: "1890-01-05", deathDate: "1962-09-12" },
    { id: "person-x", lastName: "Petit", bornName: "Dupont", marriedName: "Petit", birthDate: "1915-06-01" }
  ];
  const legacyFamilies = [
    { id: "union-legacy", partnerIds: ["person-anc", "person-x"], childIds: [], relationType: "marriage", unionDate: "1914-04-18" }
  ];
  assert.doesNotThrow(() => validateFamilyDataset(legacyPeople, legacyFamilies));
});

test("isValidStoredDate accepte les cinq types structurés et rejette les invalides", () => {
  assert.equal(isValidStoredDate(null), true);
  assert.equal(isValidStoredDate(undefined), true);
  assert.equal(isValidStoredDate({ type: "exact", value: "1869-03-14" }), true);
  assert.equal(isValidStoredDate({ type: "year", year: 1869 }), true);
  assert.equal(isValidStoredDate({ type: "about", year: 1869 }), true);
  assert.equal(isValidStoredDate({ type: "between", from: 1867, to: 1871 }), true);
  assert.equal(isValidStoredDate({ type: "unknown" }), true);
  assert.equal(isValidStoredDate({ type: "exact", value: "not-a-date" }), false);
  assert.equal(isValidStoredDate({ type: "fuzzy", year: 1869 }), false);
  assert.equal(isValidStoredDate("1869-03-14"), false);
  assert.equal(isValidStoredDate(1869), false);
});

test("les constantes de taille et de découpage sont celles du site", () => {
  assert.equal(FILE_CHUNK_BYTES, 700 * 1024);
  assert.equal(MAX_FILE_BYTES, 20 * 1024 * 1024);
  assert.equal(IMPORT_BATCH_SIZE, 400);
});

test("chunkCountForBytes compte correctement les blocs", () => {
  assert.equal(chunkCountForBytes(0), 0);
  assert.equal(chunkCountForBytes(1), 1);
  assert.equal(chunkCountForBytes(FILE_CHUNK_BYTES), 1);
  assert.equal(chunkCountForBytes(FILE_CHUNK_BYTES + 1), 2);
  assert.equal(chunkCountForBytes(2 * FILE_CHUNK_BYTES), 2);
  assert.equal(chunkCountForBytes(2 * FILE_CHUNK_BYTES + 1), 3);
  assert.equal(chunkCountForBytes(MAX_FILE_BYTES), Math.ceil((20 * 1024 * 1024) / (700 * 1024)));
});

test("documentChunkId numérote les blocs sur 4 chiffres et préserve l’ordre", () => {
  assert.equal(documentChunkId("document-a", "v1", 0), "document-a_v1_0000");
  assert.equal(documentChunkId("document-a", "v1", 9), "document-a_v1_0009");
  assert.equal(documentChunkId("document-a", "v1", 10), "document-a_v1_0010");
  assert.equal(documentChunkId("document-a", "v1", 99), "document-a_v1_0099");
  assert.equal(documentChunkId("document-a", "v1", 100), "document-a_v1_0100");
  assert.equal(documentChunkId("document-a", "v1", 1000), "document-a_v1_1000");
  assert.equal(documentChunkId("document-a", "v1", 9) < documentChunkId("document-a", "v1", 10), true);
  assert.equal(documentChunkId("document-a", "v1", 999) < documentChunkId("document-a", "v1", 1000), true);
});

test("round-trip octets : splitBytesIntoChunks puis concatByteArrays restitue l’octet exact", () => {
  const bytes = new Uint8Array(1500002);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256;
  const parts = splitBytesIntoChunks(bytes, FILE_CHUNK_BYTES);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].length, FILE_CHUNK_BYTES);
  assert.equal(parts[1].length, FILE_CHUNK_BYTES);
  assert.equal(parts[2].length, 1500002 - 2 * FILE_CHUNK_BYTES);
  assert.deepEqual(concatByteArrays(parts), bytes);
  assert.equal(concatByteArrays([]).length, 0);
});

test("base64ToBytes restitue les octets encodés en base64", () => {
  const original = new Uint8Array([0, 127, 128, 255, 42, 7, 19]);
  const encoded = Buffer.from(original).toString("base64");
  assert.deepEqual(base64ToBytes(encoded), original);
});

test("collectChunkParts reconstruit dans l’ordre et signale un bloc manquant", () => {
  const parts = [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5])];
  const collected = collectChunkParts(index => parts[index], 3);
  assert.deepEqual(collected, parts);
  assert.deepEqual(concatByteArrays(collected), new Uint8Array([1, 2, 3, 4, 5]));
  assert.throws(() => collectChunkParts(index => (index === 1 ? null : parts[index]), 3), /Un bloc du fichier est introuvable/);
});

test("collectChunkParts ne lit que chunkCount blocs et ignore les blocs surnuméraires", () => {
  const parts = [new Uint8Array([7]), new Uint8Array([8]), new Uint8Array([9])];
  const read = [];
  const collected = collectChunkParts(index => {
    read.push(index);
    return parts[index];
  }, 2);
  assert.equal(collected.length, 2);
  assert.deepEqual(read, [0, 1]);
});

test("sérialisation puis parseBackupManifestText restituent un manifeste identique", () => {
  const blobs = new Map([["document-a", blobForDocumentA]]);
  const manifest = buildBackupManifest({ people, families, tasks, documents, blobs, exportedAt: "2026-09-18T00:00:00.000Z" });
  const text = JSON.stringify(manifest, null, 2);
  assert.equal(text.startsWith("{\n  \"format\""), true);
  const parsed = parseBackupManifestText(text);
  assert.deepEqual(parsed, manifest);
});

test("parseBackupManifestText rejette un format non reconnu ou un JSON invalide", () => {
  assert.throws(() => parseBackupManifestText(JSON.stringify({ format: "autre", people: [], families: [] })), /Format de sauvegarde non reconnu/);
  assert.throws(() => parseBackupManifestText(JSON.stringify({ format: "family-tree-backup", version: 3, exportedAt: "…", people: "nope", families: [] })), /Format de sauvegarde non reconnu/);
  assert.throws(() => parseBackupManifestText("pas du json"), SyntaxError);
});

test("sliceIntoBatches découpe en lots de 400 et conserve l’ordre et les identifiants", () => {
  const records = Array.from({ length: 1000 }, (_, i) => ({ id: `record-${i}` }));
  const batches = sliceIntoBatches(records, IMPORT_BATCH_SIZE);
  assert.deepEqual(batches.map(batch => batch.length), [400, 400, 200]);
  assert.deepEqual(batches.flat().map(record => record.id), records.map(record => record.id));
  assert.equal(sliceIntoBatches([], 400).length, 0);
  assert.equal(sliceIntoBatches(records, 0).length, 0);
});

test("sliceIntoBatches préserve les identifiants dupliqués (sémantique d’écrasement par set)", () => {
  const records = [{ id: "person-x", version: 1 }, { id: "person-x", version: 2 }];
  const batches = sliceIntoBatches(records, 400);
  assert.equal(batches.flat().length, 2);
  assert.deepEqual(batches.flat().map(record => record.version), [1, 2]);
});

test("identifiants dupliqués : la validation les refuse pour personnes et foyers (blocage pur)", () => {
  const dupPeople = [
    { id: "person-a", lastName: "Première" },
    { id: "person-a", lastName: "Seconde" }
  ];
  assert.throws(() => validateFamilyDataset(dupPeople, []), /identifiant de personne invalide ou dupliqué/);
  const dupFamilies = [
    { id: "union-a", partnerIds: ["person-a"], childIds: [] },
    { id: "union-a", partnerIds: ["person-b"], childIds: [] }
  ];
  assert.throws(() => validateFamilyDataset([{ id: "person-a" }, { id: "person-b" }], dupFamilies), /identifiant de foyer invalide ou dupliqué/);
});

test("identifiants dupliqués : le pipeline pur préserve doublons (dernier écrit gagne = Firestore writeBatch.set)", () => {
  const dupTasks = [{ id: "task-a", title: "Première" }, { id: "task-a", title: "Seconde" }];
  assert.doesNotThrow(() => validateFamilyDataset(people, families));
  const manifest = buildBackupManifest({ people, families, tasks: dupTasks, documents: [] });
  assert.equal(manifest.tasks.length, 2);
  assert.deepEqual(manifest.tasks.map(task => task.title), ["Première", "Seconde"]);
  const batches = sliceIntoBatches(dupTasks, 400);
  assert.equal(batches.flat().length, 2);
  const first = importedDataFields(dupTasks[0]);
  const second = importedDataFields(dupTasks[1]);
  assert.equal(first.title, "Première");
  assert.equal(second.title, "Seconde");
  assert.equal("id" in first, false);
  assert.equal("id" in second, false);
});

test("round-trip binaire complet par représentation de stockage (split → base64 → collect → concat)", () => {
  const bytes = new Uint8Array(1500002);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131) % 256;
  const chunked = splitBytesIntoChunks(bytes, FILE_CHUNK_BYTES);
  assert.equal(chunked.length, 3);
  const storedRepresentations = chunked.map(part => Buffer.from(part).toString("base64"));
  const rebuilt = collectChunkParts(index => base64ToBytes(storedRepresentations[index]), storedRepresentations.length);
  assert.deepEqual(concatByteArrays(rebuilt), bytes);
});

test("cycle export → parse → validation → import conserve les champs métier legacy", () => {
  const blobs = new Map([["document-a", blobForDocumentA]]);
  const manifest = buildBackupManifest({ people, families, tasks, documents, blobs, exportedAt: "2026-09-18T00:00:00.000Z" });
  const parsed = parseBackupManifestText(JSON.stringify(manifest, null, 2));
  assert.doesNotThrow(() => validateFamilyDataset(parsed.people, parsed.families));

  const legacyPerson = parsed.people.find(item => item.id === "person-legacy-child");
  assert.equal(legacyPerson.birthDate, "1975-03-02");
  assert.equal(legacyPerson.marriedName, "Petit");
  assert.equal(legacyPerson.place, "Paris");

  const documentWithBlob = parsed.documents.find(item => item.id === "document-a");
  const restoredDocument = importedDataFields(documentWithBlob);
  assert.equal(restoredDocument.title, "Extrait de naissance d’Anna");
  assert.equal("id" in restoredDocument, false);
  assert.equal("backupFile" in restoredDocument, false);

  const importedAncestor = importedDataFields(parsed.people[0]);
  assert.deepEqual(importedAncestor, {
    lastName: "Martin",
    firstName: "Jean",
    gender: "male",
    place: "Lyon",
    birthDateInfo: { type: "exact", value: "1940-05-10" },
    deathDateInfo: { type: "about", year: 2015 }
  });
});

test("buildBackupManifest ne mute pas les tableaux sources", () => {
  const frozenPeople = people.map(person => {
    const copy = { ...person };
    if (Array.isArray(copy.personIds)) copy.personIds = [...copy.personIds];
    return Object.freeze(copy);
  });
  const frozenFamilies = families.map(family => {
    const copy = { ...family };
    if (Array.isArray(copy.parentChildLinks)) copy.parentChildLinks = copy.parentChildLinks.map(link => Object.freeze({ ...link }));
    return Object.freeze(copy);
  });
  const blobs = new Map([["document-a", blobForDocumentA]]);
  const before = JSON.stringify({ people, families: families.map(family => ({ ...family, parentChildLinks: family.parentChildLinks?.map(link => ({ ...link })) })) });
  buildBackupManifest({ people: frozenPeople, families: frozenFamilies, tasks, documents, blobs });
  assert.equal(JSON.stringify({ people, families: families.map(family => ({ ...family, parentChildLinks: family.parentChildLinks?.map(link => ({ ...link })) })) }), before);
});

test("formatBytes produit les libellés français attendus", () => {
  assert.equal(formatBytes(0), "0 Ko");
  assert.equal(formatBytes(512), "1 Ko");
  assert.equal(formatBytes(2048), "2 Ko");
  assert.equal(formatBytes(1.5 * 1024 * 1024), "1,5 Mo");
  assert.equal(formatBytes(1.25 * 1024 * 1024), "1,3 Mo");
});

test("app.js est réellement câblé sur backup-utils et ne redéfinit plus les helpers déplacés", () => {
  const source = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\/backup-utils\.js"/);
  assert.match(source, /buildBackupManifest\(\{ people, families, tasks, documents, blobs \}\)/);
  assert.match(source, /parseBackupManifestText\(await manifestEntry\.async\("string"\)\)/);
  assert.doesNotMatch(source, /function validateFamilyDataset/);
  assert.doesNotMatch(source, /function exportableRecord/);
  assert.doesNotMatch(source, /function safeBackupName/);
  assert.doesNotMatch(source, /function isValidStoredDate/);
  assert.doesNotMatch(source, /function formatBytes/);
  assert.doesNotMatch(source, /function base64ToBytes/);
  assert.doesNotMatch(source, /const FILE_CHUNK_BYTES/);
  assert.doesNotMatch(source, /const MAX_FILE_BYTES/);
  assert.match(source, /file\?\.size > MAX_FILE_BYTES/);
});