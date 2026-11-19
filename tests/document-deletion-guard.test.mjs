import assert from "node:assert/strict";
import test from "node:test";
import { deleteDocumentAndChunks } from "../js/document-delete.js";
import { documentDeletionBlockers } from "../js/document-deletion-guard.js";

const emptyRecords = () => Object.fromEntries([
  "sourceDocuments", "sourceRevisions", "genealogyProofs", "genealogyProofRevisions",
  "transcriptionHeads", "transcriptionRevisions", "factConclusions", "conclusionRevisions",
  "genealogyProposals", "genealogyEvents", "genealogyNotifications"
].map(name => [name, []]));

test("un document isolé est supprimable seulement après un instantané complet", () => {
  const documentItem = { id: "document-test-isole", personIds: [] };
  const records = emptyRecords();
  assert.deepEqual(documentDeletionBlockers({ documentItem, records, snapshotComplete: false }), [
    "Les associations ne peuvent pas toutes être vérifiées. Réessayez lorsque la synchronisation sera rétablie."
  ]);
  assert.deepEqual(documentDeletionBlockers({ documentItem, records, snapshotComplete: true }), []);
});

test("les associations personne, source, preuve, transcription et autres données bloquent la suppression", () => {
  const documentItem = { id: "document-lie", personIds: ["person-1"] };
  const records = emptyRecords();
  records.sourceDocuments.push({ data: { documentIds: [documentItem.id] } });
  records.genealogyProofRevisions.push({ data: { documentId: documentItem.id } });
  records.transcriptionHeads.push({ data: { passages: [{ anchor: { documentId: documentItem.id } }] } });
  records.genealogyProposals.push({ payload: { targetDocumentId: documentItem.id } });

  assert.deepEqual(documentDeletionBlockers({ documentItem, records, people: [], snapshotComplete: true }), [
    "des personnes ou leurs attestations", "des Sources", "des Preuves", "des transcriptions", "d’autres données ou historiques"
  ]);
});

test("les attestations imbriquées et les collections auxiliaires ne sont pas ignorées", () => {
  const documentItem = { id: "document-attestation", personIds: [] };
  const records = emptyRecords();
  assert.deepEqual(documentDeletionBlockers({
    documentItem,
    people: [{ lifeEvents: [{ attestations: [{ documentIds: [documentItem.id] }] }] }],
    records,
    otherRecords: [{ description: { documentIds: [documentItem.id] } }],
    snapshotComplete: true
  }), ["des personnes ou leurs attestations", "d’autres données ou historiques"]);
});

test("une ressource photographique héritée bloque aussi la suppression de son document porteur", () => {
  const documentItem = { id: "document-photo" };
  assert.deepEqual(documentDeletionBlockers({
    documentItem,
    records: { sourceDocuments: [{ data: { pages: [{ photographs: [{ original: { resourceRef: "legacy-document:document-photo" } }] }] } }] },
    snapshotComplete: true
  }), ["des Sources"]);
  assert.deepEqual(documentDeletionBlockers({
    documentItem,
    records: { sourceDocuments: [{ data: { pages: [{ photographs: [{ original: { resourceRef: "legacy-document:document-photo-extra" } }] }] } }] },
    snapshotComplete: true
  }), []);
});

test("un document isolé supprime sa fiche et tous ses blocs dans un seul lot", async () => {
  const operations = [];
  let commits = 0;
  const item = { id: "document-test-isole", chunkVersion: "version-test", chunkCount: 2 };
  const result = await deleteDocumentAndChunks(item, {
    createBatch: () => ({
      delete(reference) { operations.push(reference); },
      async commit() { commits++; }
    }),
    documentReference: id => `documents/${id}`,
    chunkReference: (id, version, index) => `documentChunks/${id}/${version}/${index}`
  });
  assert.equal(result, true);
  assert.deepEqual(operations, [
    "documentChunks/document-test-isole/version-test/0",
    "documentChunks/document-test-isole/version-test/1",
    "documents/document-test-isole"
  ]);
  assert.equal(commits, 1, "fichier et fiche passent dans une seule écriture atomique");
});

test("des métadonnées de chunks incohérentes ou un lot trop grand sont refusés sans écriture", async () => {
  let commits = 0;
  const createBatch = () => ({ delete() {}, async commit() { commits++; } });
  const common = { createBatch, documentReference: id => `documents/${id}`, chunkReference: () => "chunk" };
  await assert.rejects(deleteDocumentAndChunks({ id: "doc", chunkVersion: "version" }, common), /incomplètes/);
  await assert.rejects(deleteDocumentAndChunks({ id: "doc", chunkVersion: "version", chunkCount: 2 }, { ...common, maximumWrites: 2 }), /trop de blocs/);
  assert.equal(commits, 0);
});
