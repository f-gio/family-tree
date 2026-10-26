import assert from "node:assert/strict";
import test from "node:test";
import { createPhotographAsset, findExactPhotographDuplicates } from "../js/source-document-model.js";
import { generatePhotographPreview } from "../js/photograph-preview.js";
import {
  MemoryPhotographStorage,
  PhotographStorageError,
  buildPhotographResourceRef,
  createPhotographAssetManifest,
  getDocumentPagesInDisplayOrder,
  getPagePhotographs,
  loadPhotographResource,
  selectPhotographResource
} from "../js/photograph-storage.js";

const SHA_123 = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const ORIGINAL_INPUT = { documentId: "doc-1", pageId: "page-1", photographId: "photo-1", fileName: "acte-original.jpg", mimeType: "image/jpeg" };

const bytesOf = async blob => [...new Uint8Array(await blob.arrayBuffer())];

test("l'adaptateur mémoire conserve exactement les octets et vérifie SHA-256", async () => {
  const storage = new MemoryPhotographStorage();
  const imported = new Uint8Array([1, 2, 3]);
  const metadata = await storage.storeOriginal({ ...ORIGINAL_INPUT, blob: imported });
  imported.fill(0);

  assert.equal(metadata.sha256, SHA_123);
  assert.equal(metadata.sizeBytes, 3);
  assert.equal(metadata.mimeType, "image/jpeg");
  assert.deepEqual(await bytesOf(await storage.readOriginal(metadata.resourceRef)), [1, 2, 3]);
  assert.deepEqual(await storage.verifyOriginal(metadata.resourceRef, SHA_123), { valid: true, status: "verified", sha256: SHA_123 });
  assert.deepEqual(await storage.verifyOriginal(metadata.resourceRef, "f".repeat(64)), { valid: false, status: "mismatch", sha256: SHA_123 });
  await assert.rejects(storage.readOriginal(metadata.resourceRef, "f".repeat(64)), error => error.code === "INTEGRITY_MISMATCH");
});

test("un original ne peut pas être écrasé et un SHA attendu incorrect ne crée pas de ressource", async () => {
  const storage = new MemoryPhotographStorage();
  const first = await storage.storeOriginal({ ...ORIGINAL_INPUT, blob: new Uint8Array([1, 2, 3]) });
  await assert.rejects(storage.storeOriginal({ ...ORIGINAL_INPUT, blob: new Uint8Array([4, 5, 6]) }), error => error.code === "ALREADY_EXISTS");
  assert.deepEqual(await bytesOf(await storage.readOriginal(first.resourceRef)), [1, 2, 3]);

  const different = { ...ORIGINAL_INPUT, photographId: "photo-wrong-sha" };
  await assert.rejects(storage.storeOriginal({ ...different, blob: new Uint8Array([1, 2, 3]), expectedSha256: "f".repeat(64) }), error => error.code === "INTEGRITY_MISMATCH");
  const missing = await storage.verifyOriginal(buildPhotographResourceRef({ ...different, variant: "original" }), SHA_123);
  assert.equal(missing.status, "missing");
});

test("un original vide et des métadonnées MIME absentes sont refusés explicitement", async () => {
  const storage = new MemoryPhotographStorage();
  await assert.rejects(storage.storeOriginal({ ...ORIGINAL_INPUT, blob: new Uint8Array() }), error => error.code === "INVALID_FILE");
  await assert.rejects(storage.storeOriginal({ ...ORIGINAL_INPUT, mimeType: "", blob: new Uint8Array([1]) }), error => error.code === "INVALID_METADATA");
});

test("un aperçu utilise une référence distincte et ne modifie pas l'original", async () => {
  const storage = new MemoryPhotographStorage();
  const original = await storage.storeOriginal({ ...ORIGINAL_INPUT, blob: new Uint8Array([1, 2, 3]) });
  const previewBytes = new Uint8Array([9, 8]);
  const preview = await storage.storePreview({
    ...ORIGINAL_INPUT,
    previewId: "web-small-v1",
    blob: previewBytes,
    mimeType: "image/webp",
    width: 100,
    height: 80,
    derivedFromSha256: original.sha256
  });

  assert.notEqual(preview.resourceRef, original.resourceRef);
  assert.equal(preview.mimeType, "image/webp");
  assert.equal(preview.width, 100);
  assert.equal(preview.height, 80);
  assert.deepEqual(await bytesOf(await storage.readPreview(preview.resourceRef, preview.sha256)), [9, 8]);
  assert.deepEqual(await bytesOf(await storage.readOriginal(original.resourceRef)), [1, 2, 3]);
  await assert.rejects(storage.storePreview({
    ...ORIGINAL_INPUT, previewId: "bad-source", blob: new Uint8Array([7]), mimeType: "image/webp", width: 1, height: 1, derivedFromSha256: "f".repeat(64)
  }), error => error.code === "INTEGRITY_MISMATCH");
});

test("la consultation ordonne les pages et charge l'aperçu par défaut, l'original seulement sur demande", async () => {
  const storage = new MemoryPhotographStorage();
  const original = await storage.storeOriginal({ ...ORIGINAL_INPUT, blob: new Uint8Array([1, 2, 3]) });
  const preview = await storage.storePreview({ ...ORIGINAL_INPUT, previewId: "small", blob: new Uint8Array([9]), mimeType: "image/webp", width: 1, height: 1, derivedFromSha256: original.sha256 });
  const photograph = createPhotographAsset({
    id: "photo-1", originalFileName: original.originalFileName, mimeType: original.mimeType,
    sizeBytes: original.sizeBytes, sha256: original.sha256, originalRef: original.resourceRef,
    previewRef: preview.resourceRef, previewMimeType: preview.mimeType, previewSizeBytes: preview.sizeBytes,
    previewWidth: preview.width, previewHeight: preview.height, previewSha256: preview.sha256
  });
  const doc = { id: "doc-1", pages: [
    { id: "page-2", order: 1, photographs: [] },
    { id: "page-1", order: 0, photographs: [photograph] }
  ] };
  const ordered = getDocumentPagesInDisplayOrder(doc);
  const pagePhotos = getPagePhotographs(doc, "page-1");
  const chosenPreview = await loadPhotographResource(storage, pagePhotos[0]);
  const chosenOriginal = await loadPhotographResource(storage, pagePhotos[0], { useOriginal: true });

  assert.deepEqual(ordered.map(page => page.id), ["page-1", "page-2"]);
  assert.deepEqual(doc.pages.map(page => page.id), ["page-2", "page-1"], "le tri ne mutera pas l'ordre stocké");
  assert.equal(selectPhotographResource(photograph).kind, "preview");
  assert.equal(chosenPreview.kind, "preview");
  assert.deepEqual(await bytesOf(chosenPreview.blob), [9]);
  assert.equal(chosenOriginal.kind, "original");
  assert.deepEqual(await bytesOf(chosenOriginal.blob), [1, 2, 3]);
});

test("la génération d'aperçu échouée ne touche pas à l'original enregistré", async () => {
  const storage = new MemoryPhotographStorage();
  const original = await storage.storeOriginal({ ...ORIGINAL_INPUT, blob: new Uint8Array([1, 2, 3]) });
  let bitmapClosed = false;
  const fakeDocument = {
    createElement() {
      return {
        getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(_) {}, set imageSmoothingEnabled(_) {}, set imageSmoothingQuality(_) {} }),
        toBlob: callback => callback(null)
      };
    }
  };
  await assert.rejects(generatePhotographPreview(new Blob([new Uint8Array([1])]), {
    createImageBitmapImpl: async () => ({ width: 10, height: 20, close() { bitmapClosed = true; } }),
    documentRef: fakeDocument
  }), /encoder l’aperçu/);
  assert.equal(bitmapClosed, true);
  assert.deepEqual(await bytesOf(await storage.readOriginal(original.resourceRef)), [1, 2, 3]);
});

test("la génération navigateur produit un dérivé borné et ferme le bitmap", async () => {
  let drawn = null;
  let bitmapClosed = false;
  const generatedBlob = new Blob([new Uint8Array([4, 5])], { type: "image/webp" });
  const fakeDocument = {
    createElement() {
      return {
        getContext: () => ({ fillRect() {}, drawImage(_bitmap, x, y, width, height) { drawn = { width, height }; }, set fillStyle(_) {}, set imageSmoothingEnabled(_) {}, set imageSmoothingQuality(_) {} }),
        toBlob: callback => callback(generatedBlob)
      };
    }
  };
  const result = await generatePhotographPreview(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), {
    createImageBitmapImpl: async () => ({ width: 4000, height: 2000, close() { bitmapClosed = true; } }),
    documentRef: fakeDocument,
    maxDimension: 1000
  });

  assert.deepEqual(drawn, { width: 1000, height: 500 });
  assert.equal(result.blob, generatedBlob);
  assert.equal(result.mimeType, "image/webp");
  assert.equal(result.width, 1000);
  assert.equal(result.height, 500);
  assert.equal(bitmapClosed, true);
});

test("une référence absente est signalée sans fallback silencieux", async () => {
  const storage = new MemoryPhotographStorage();
  await assert.rejects(storage.readOriginal("not-found"), error => error instanceof PhotographStorageError && error.code === "RESOURCE_MISSING");
  await assert.rejects(storage.readPreview("not-found"), error => error.code === "RESOURCE_MISSING");
});

test("le manifeste exportable contient références, SHA et chemins ZIP sans données binaires", async () => {
  const storage = new MemoryPhotographStorage();
  const original = await storage.storeOriginal({ ...ORIGINAL_INPUT, blob: new Uint8Array([1, 2, 3]) });
  const preview = await storage.storePreview({ ...ORIGINAL_INPUT, previewId: "preview-1", blob: new Uint8Array([4]), mimeType: "image/webp", width: 1, height: 1, derivedFromSha256: original.sha256 });
  const photograph = createPhotographAsset({
    id: "photo-1",
    originalFileName: original.originalFileName,
    mimeType: original.mimeType,
    sizeBytes: original.sizeBytes,
    sha256: original.sha256,
    originalRef: original.resourceRef,
    importedAt: original.importedAt,
    previewRef: preview.resourceRef,
    previewMimeType: preview.mimeType,
    previewSizeBytes: preview.sizeBytes,
    previewWidth: preview.width,
    previewHeight: preview.height,
    previewSha256: preview.sha256
  });
  const doc = { id: "doc-1", pages: [{ id: "page-1", order: 0, photographs: [photograph] }] };
  const manifest = createPhotographAssetManifest([doc]);

  assert.equal(manifest.format, "la-nostra-storia-photograph-assets");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.assets.length, 2);
  assert.equal(manifest.assets[0].sha256, original.sha256);
  assert.equal(manifest.assets[0].backupEntry, "assets/doc-1/page-1/photo-1/original");
  assert.equal(manifest.assets[1].backupEntry, "assets/doc-1/page-1/photo-1/previews/preview-1");
  assert.equal("bytes" in manifest.assets[0], false, "le manifeste référence les octets mais ne les absorbe pas");
});

test("les clés d'assets séparent IDs métier et références de stockage et refusent le path traversal", () => {
  const ref = buildPhotographResourceRef({ documentId: "doc..1", pageId: "page/1", photographId: "photo-1", variant: "original" });
  assert.equal(ref, "documents/doc%2E%2E1/pages/page%2F1/photographs/photo-1/original");
  assert.throws(() => buildPhotographResourceRef({ documentId: "doc", pageId: "page", photographId: "photo", variant: "preview" }), /previewId/);
});

test("les ressources de deux photographies de même contenu restent adressées indépendamment", async () => {
  const storage = new MemoryPhotographStorage();
  const first = await storage.storeOriginal({ ...ORIGINAL_INPUT, blob: new Uint8Array([1, 2, 3]) });
  const second = await storage.storeOriginal({ ...ORIGINAL_INPUT, photographId: "photo-2", blob: new Uint8Array([1, 2, 3]) });
  assert.equal(first.sha256, second.sha256);
  assert.notEqual(first.resourceRef, second.resourceRef);
  const dupes = findExactPhotographDuplicates([
    { id: "doc-1", pages: [{ id: "page-1", photographs: [{ id: "photo-1", original: { sha256: first.sha256 } }] }] },
    { id: "doc-1", pages: [{ id: "page-1", photographs: [{ id: "photo-2", original: { sha256: second.sha256 } }] }] }
  ]);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].occurrences.length, 2);
});
