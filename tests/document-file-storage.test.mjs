import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentFileStore } from "../js/document-file-storage.js";

function setup({ failAt = -1 } = {}) {
  const records = new Map();
  const deleted = [];
  const ref = (id, version, index) => `${id}/${version}/${index}`;
  const store = createDocumentFileStore({
    chunkReference: ref,
    setDoc: async (key, data) => {
      const index = data.index;
      if (index === failAt) throw new Error("échec simulé");
      records.set(key, data);
    },
    deleteDoc: async key => { deleted.push(key); records.delete(key); },
    getDoc: async key => ({ exists: () => records.has(key), data: () => records.get(key) }),
    Bytes: { fromUint8Array: value => ({ toUint8Array: () => value }) },
    splitBytesIntoChunks: (bytes, size) => Array.from({ length: Math.ceil(bytes.length / size) }, (_, index) => bytes.slice(index * size, (index + 1) * size)),
    collectChunkParts: (readPart, count) => Array.from({ length: count }, (_, index) => readPart(index)),
    concatByteArrays: parts => Uint8Array.from(parts.flatMap(part => [...part])),
    base64ToBytes: value => Uint8Array.from(Buffer.from(value, "base64")),
    chunkSize: 2
  });
  return { store, records, deleted };
}

test("écrit, signale la progression et relit des chunks sans perte d’octets", async () => {
  const { store } = setup();
  const progress = [];
  const count = await store.writeFileChunks("doc", "v1", new Blob([Uint8Array.from([1, 2, 3, 4, 5])]), value => progress.push(value));
  assert.equal(count, 3);
  assert.deepEqual(progress, [33, 67, 100]);
  const blob = await store.readChunkedFile({ id: "doc", chunkVersion: "v1", chunkCount: 3, mimeType: "image/png" });
  assert.equal(blob.type, "image/png");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 4, 5]);
});

test("supprime les chunks écrits si l’envoi échoue et propage l’erreur", async () => {
  const { store, records, deleted } = setup({ failAt: 1 });
  await assert.rejects(store.writeFileChunks("doc", "v2", new Blob([Uint8Array.from([1, 2, 3, 4])])), /échec simulé/);
  assert.equal(records.size, 0);
  assert.deepEqual(deleted, ["doc/v2/0"]);
});
