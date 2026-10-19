import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import {
  BACKUP_ARCHIVE_VERSION,
  BACKUP_MANIFEST_PATH,
  addBackupEntriesToZip,
  adaptLegacyV4Archive,
  compareBackupCaptureMarkers,
  createBackupArchiveManifest,
  generateBackupZip,
  parseBackupArchiveManifestText,
  prepareBackupRestorePlan,
  readBackupZip,
  verifyBackupArchive
} from "../js/backup-archive.js";
import { BACKUP_FORMAT } from "../js/backup-utils.js";

const bytes = values => new Uint8Array(values);
const hash = async value => [...new Uint8Array(await webcrypto.subtle.digest("SHA-256", value))].map(byte => byte.toString(16).padStart(2, "0")).join("");

function completeCollections() {
  const original = bytes([1, 2, 3, 4]);
  const preview = bytes([9, 8]);
  return {
    collections: {
      people: [{ id: "person-1", birthDate: "1870" }],
      families: [{ id: "family-1", partnerIds: ["person-1"], childIds: [] }],
      trees: [],
      documents: [{ id: "doc-1", pages: [{ id: "page-1", photographs: [{
        id: "photo-1", original: { resourceRef: "ref:original", sha256: null, sizeBytes: 4 },
        preview: { id: "preview-1", resourceRef: "ref:preview", sha256: null, sizeBytes: 2 }
      }] }] }],
      tasks: [],
      sourceDocuments: [{ id: "source-1", revisionId: "source-rev-1", data: { title: "Acte" } }],
      sourceRevisions: [{ id: "source-rev-1", objectId: "source-1", previousRevisionId: null, data: { title: "Acte" } }],
      transcriptionHeads: [{ id: "transcription-1", revisionId: "trans-rev-1" }],
      transcriptionRevisions: [{ id: "trans-rev-1", objectId: "transcription-1", previousRevisionId: null, data: { passages: [{ id: "passage-1", textIt: "Nato" }] } }],
      genealogyProofs: [{ id: "proof-1", documentId: "doc-1", transcriptionRevisionId: "trans-rev-1", factId: "fact-1" }],
      genealogyProofRevisions: [{ id: "proof-rev-1", objectId: "proof-1", previousRevisionId: null, data: { technicalStatus: "active" } }],
      factConclusions: [{ id: "conclusion-1", factId: "fact-1", revisionId: "conclusion-rev-1" }],
      conclusionRevisions: [{ id: "conclusion-rev-1", objectId: "conclusion-1", previousRevisionId: null, examinedProofIds: ["proof-1"], data: { retainedValue: null } }],
      genealogyProposals: [{ id: "proposal-1", authorUid: "uid-history", status: "accepted", resolvedBy: "uid-admin" }],
      genealogyEvents: [{ id: "event-1", actorUid: "uid-former-contributor" }],
      genealogyNotifications: [{ id: "notif-1", recipientUid: "uid-absent" }]
    },
    assets: [
      { documentId: "doc-1", pageId: "page-1", photographId: "photo-1", rendition: "original", resourceRef: "ref:original", sizeBytes: 4, sha256: null, fileName: "acte.tif", mimeType: "image/tiff" },
      { documentId: "doc-1", pageId: "page-1", photographId: "photo-1", rendition: "preview", assetId: "preview-1", resourceRef: "ref:preview", sizeBytes: 2, sha256: null, mimeType: "image/webp" }
    ],
    assetBytes: new Map([["ref:original", original], ["ref:preview", preview]])
  };
}

test("v5 décrit inventaire, IDs, binaires distincts, SHA-256 et auteurs sans droits", async () => {
  const input = completeCollections();
  const result = await createBackupArchiveManifest({ ...input, capture: { consistent: true, strategy: "test-coherent" }, cryptoProvider: webcrypto });
  const { manifest, entries } = result;
  assert.equal(manifest.version, BACKUP_ARCHIVE_VERSION);
  assert.deepEqual(manifest.identifiers.people, ["person-1"]);
  assert.equal(manifest.collections.genealogyProposals[0].authorUid, "uid-history");
  assert.equal(manifest.collections.genealogyNotifications[0].recipientUid, "uid-absent");
  assert.equal(manifest.collections.users, undefined);
  assert.equal(manifest.completeness.status, "complete");
  assert.equal(manifest.assets.find(asset => asset.rendition === "original").isOriginal, true);
  assert.equal(manifest.assets.find(asset => asset.rendition === "preview").isOriginal, false);
  assert.notEqual(...entries.keys());
  const originalAsset = manifest.assets.find(asset => asset.rendition === "original");
  assert.equal(originalAsset.sha256, await hash(input.assetBytes.get("ref:original")));
  assert.equal((await verifyBackupArchive(manifest, entries, { cryptoProvider: webcrypto, requireComplete: true })).valid, true);
});

test("une capture multi-collection non atomique ou une ressource absente ne se dit pas complète", async () => {
  const input = completeCollections();
  input.assetBytes.delete("ref:original");
  const result = await createBackupArchiveManifest({ ...input, capture: { consistent: false }, cryptoProvider: webcrypto });
  assert.equal(result.manifest.completeness.status, "partial");
  assert.equal(result.manifest.missingResources.length, 1);
  assert.ok(result.manifest.completeness.warnings.some(item => item.code === "SNAPSHOT_NOT_ATOMIC"));
  assert.equal((await verifyBackupArchive(result.manifest, result.entries, { cryptoProvider: webcrypto, requireComplete: true })).valid, false);
});

test("les marqueurs de collections détectent une écriture concurrente pendant la capture", () => {
  assert.deepEqual(compareBackupCaptureMarkers({ people: "v1", documents: "v3" }, { people: "v2", documents: "v3" }), {
    consistent: false, changeDetected: true, changedCollections: ["people"], strategy: "per-collection-update-markers"
  });
  assert.equal(compareBackupCaptureMarkers({ people: "v1" }, { people: "v1" }).consistent, true);
});

test("les photos multiples gardent une entrée par version ; un WebP historique n'est jamais un original", async () => {
  const input = completeCollections();
  input.assets.push({ documentId: "doc-1", pageId: "page-1", photographId: "photo-legacy", rendition: "legacy-optimized", resourceRef: "ref:webp-only", sizeBytes: 2, sha256: null, mimeType: "image/webp", provenance: "old-document-optimized" });
  input.assets.push({ documentId: "doc-1", pageId: "page-1", photographId: "photo-2", rendition: "original", resourceRef: "ref:second-original", sizeBytes: 1, sha256: null });
  input.assetBytes.set("ref:webp-only", bytes([7, 7]));
  input.assetBytes.set("ref:second-original", bytes([6]));
  const result = await createBackupArchiveManifest({ ...input, capture: { consistent: true }, cryptoProvider: webcrypto });
  const legacy = result.manifest.assets.find(asset => asset.photographId === "photo-legacy");
  assert.equal(legacy.isOriginal, false);
  assert.equal(legacy.rendition, "legacy-optimized");
  assert.equal(legacy.provenance, "old-document-optimized");
  assert.equal(result.manifest.assets.length, 4, "deux photos distinctes de la même page gardent leurs fichiers séparés");
});

test("le contrôle d'archive distingue ressource absente, SHA invalide et référence cassée", async () => {
  const input = completeCollections();
  input.collections.genealogyProofs[0].transcriptionRevisionId = "missing-revision";
  const result = await createBackupArchiveManifest({ ...input, capture: { consistent: true }, cryptoProvider: webcrypto });
  assert.ok(result.manifest.integrity.errors.some(error => error.code === "REVISION_MISSING"));
  const badBytes = new Map(result.entries);
  badBytes.set(result.manifest.assets[0].archivePath, bytes([0, 0, 0, 0]));
  const verified = await verifyBackupArchive(result.manifest, badBytes, { cryptoProvider: webcrypto });
  assert.ok(verified.errors.some(error => error.code === "SHA256_MISMATCH"));
  badBytes.delete(result.manifest.assets[0].archivePath);
  assert.ok((await verifyBackupArchive(result.manifest, badBytes, { cryptoProvider: webcrypto })).errors.some(error => error.code === "FILE_MISSING"));
  const mismatchedInput = completeCollections();
  mismatchedInput.assets[0].sha256 = "f".repeat(64);
  await assert.rejects(createBackupArchiveManifest({ ...mismatchedInput, capture: { consistent: true }, cryptoProvider: webcrypto }), /SHA-256 incorrect/);
});

test("les révisions cassées et les références conclusion-preuve invalide sont signalées", async () => {
  const input = completeCollections();
  input.collections.sourceRevisions[0].previousRevisionId = "missing-source-revision";
  input.collections.conclusionRevisions[0].examinedProofIds = ["missing-proof"];
  const result = await createBackupArchiveManifest({ ...input, capture: { consistent: true }, cryptoProvider: webcrypto });
  const codes = result.manifest.integrity.errors.map(error => error.code);
  assert.ok(codes.includes("REVISION_CHAIN_BROKEN"));
  assert.ok(codes.includes("REFERENCE_MISSING"));
  assert.equal(result.manifest.completeness.status, "partial");
});

test("une boucle de révisions est une incohérence explicite", async () => {
  const input = completeCollections();
  input.collections.sourceRevisions.push({ id: "source-rev-2", objectId: "source-1", previousRevisionId: "source-rev-1", data: {} });
  input.collections.sourceRevisions[0].previousRevisionId = "source-rev-2";
  const result = await createBackupArchiveManifest({ ...input, capture: { consistent: true }, cryptoProvider: webcrypto });
  assert.ok(result.manifest.integrity.errors.some(error => error.code === "REVISION_CHAIN_CYCLE"));
});

test("l'adaptateur v4 conserve les IDs et avertit des collections absentes", async () => {
  const legacy = { format: BACKUP_FORMAT, version: 4, exportedAt: "2025-02-03T00:00:00.000Z", people: [{ id: "legacy-person", lastName: "Rossi" }], families: [], trees: [], tasks: [], documents: [{ id: "legacy-doc", backupFile: "documents/legacy-doc/acte.webp", mimeType: "image/webp" }] };
  const manifest = parseBackupArchiveManifestText(JSON.stringify(legacy));
  assert.equal(manifest.sourceProvenance, "legacy-v4");
  assert.equal(manifest.collections.people[0].id, "legacy-person");
  assert.equal(manifest.completeness.status, "partial");
  assert.ok(manifest.completeness.warnings.some(warning => warning.code === "LEGACY_V4_ADAPTED"));
  assert.ok(manifest.completeness.missingCollections.includes("genealogyEvents"));
  const upgraded = await adaptLegacyV4Archive(legacy, new Map([["documents/legacy-doc/acte.webp", bytes([4, 5])]]), { cryptoProvider: webcrypto });
  assert.equal(upgraded.assets[0].isOriginal, false);
  assert.match(upgraded.assets[0].provenance, /legacy-v4/);
  class LegacyZip {
    file(path) {
      const value = path === BACKUP_MANIFEST_PATH ? JSON.stringify(legacy) : path === "documents/legacy-doc/acte.webp" ? bytes([4, 5]) : null;
      return value == null ? null : { async: async kind => kind === "string" ? value : value };
    }
  }
  const readLegacy = await readBackupZip(new LegacyZip(), { cryptoProvider: webcrypto });
  assert.equal(readLegacy.manifest.sourceProvenance, "legacy-v4");
  assert.equal(readLegacy.manifest.assets[0].isOriginal, false);
  assert.equal(readLegacy.integrity.complete, false);
});

test("le plan de restauration est en lecture seule, exige une politique et ne restaure aucun rôle", async () => {
  const input = completeCollections();
  const { manifest } = await createBackupArchiveManifest({ ...input, capture: { consistent: true }, cryptoProvider: webcrypto });
  const partial = await createBackupArchiveManifest({ ...completeCollections(), capture: { consistent: false }, cryptoProvider: webcrypto });
  assert.throws(() => prepareBackupRestorePlan(partial.manifest), /incomplète|complete/i);
  const plan = prepareBackupRestorePlan(manifest, {
    conflictPolicy: "abort", existing: { people: ["person-1"] }, activeUserIds: ["uid-admin"], preflight: true
  });
  assert.equal(plan.preflightOnly, true);
  assert.equal(plan.writesPerformed, false);
  assert.equal(plan.blocked, true);
  assert.equal(plan.conflicts[0].policy, "abort");
  assert.equal(plan.requiresPrivilegedServerForOfficialData, true);
  assert.ok(plan.historicalAuthorUids.includes("uid-history"));
  assert.ok(!plan.operations.some(operation => operation.collection === "users"));
  assert.throws(() => prepareBackupRestorePlan(manifest, { conflictPolicy: "overwrite-everything" }), /Politique/);
  const keepPlan = prepareBackupRestorePlan(manifest, { conflictPolicy: "keep-existing", existing: { people: ["person-1"] }, activeUserIds: [] });
  const replacePlan = prepareBackupRestorePlan(manifest, { conflictPolicy: "replace-existing", existing: { people: ["person-1"] }, activeUserIds: [] });
  assert.equal(keepPlan.operations.find(item => item.id === "person-1").action, "skip");
  assert.equal(replacePlan.operations.find(item => item.id === "person-1").action, "replace");
  assert.ok(keepPlan.warnings.some(warning => warning.code === "HISTORICAL_AUTHORS_NOT_ACTIVE"));
});

test("l'adaptateur JSZip reçoit uniquement les octets et le manifeste v5", async () => {
  const input = completeCollections();
  const archive = await createBackupArchiveManifest({ ...input, capture: { consistent: true }, cryptoProvider: webcrypto });
  const files = new Map();
  const zip = { file(path, value) { files.set(path, value); } };
  addBackupEntriesToZip(zip, archive);
  assert.ok(files.has(BACKUP_MANIFEST_PATH));
  assert.ok(files.has(archive.manifest.assets[0].archivePath));
  assert.equal(JSON.parse(files.get(BACKUP_MANIFEST_PATH)).version, 5);
});

test("l'assembleur ZIP utilise JSZip injecté et le lecteur vérifie son contenu", async () => {
  const input = completeCollections();
  const archive = await createBackupArchiveManifest({ ...input, capture: { consistent: true }, cryptoProvider: webcrypto });
  class FakeZip {
    files = new Map();
    file(path, value) {
      if (value === undefined) {
        const stored = this.files.get(path);
        return stored == null ? null : { async: async type => type === "string" ? stored : stored };
      }
      this.files.set(path, typeof value === "string" ? value : new Uint8Array(value));
    }
    async generateAsync() { return new Uint8Array([1]); }
  }
  const generated = await generateBackupZip(archive, FakeZip);
  assert.deepEqual([...generated], [1]);
  const zip = new FakeZip();
  addBackupEntriesToZip(zip, archive);
  const read = await readBackupZip(zip, { cryptoProvider: webcrypto });
  assert.equal(read.manifest.version, 5);
  assert.equal(read.integrity.valid, true);
  assert.equal(read.entries.size, 2);
});
