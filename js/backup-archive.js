/* Format ZIP v5, vérification d'intégrité et plan de restauration sans écriture.
   Le module est pur : l'application fournit les enregistrements, les octets et
   l'adaptateur ZIP ; aucun accès Firebase, DOM ou réseau n'est effectué ici. */

import { BACKUP_FORMAT, BACKUP_VERSION, validateFamilyDataset, validateTreeDataset } from "./backup-utils.js";
import { buildFactIdentityId, buildLegacyParentChildIdentityId } from "./genealogy-identities.js";

export const BACKUP_ARCHIVE_VERSION = 5;
export const BACKUP_MANIFEST_PATH = "family-tree.json";
export const BACKUP_COLLECTION_NAMES = Object.freeze([
  "people", "families", "trees", "documents", "tasks", "sourceDocuments", "sourceRevisions",
  "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions",
  "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"
]);

export function compareBackupCaptureMarkers(before, after) {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") {
    return { consistent: false, changeDetected: true, changedCollections: [], strategy: "markers-unavailable" };
  }
  const changedCollections = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(name => before[name] !== after[name]);
  return {
    consistent: changedCollections.length === 0,
    changeDetected: changedCollections.length > 0,
    changedCollections,
    strategy: "per-collection-update-markers"
  };
}

const REQUIRED_COLLECTIONS = Object.freeze([
  "people", "families", "trees", "documents", "tasks", "sourceDocuments", "sourceRevisions",
  "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions",
  "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"
]);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const BASE_V4_FIELDS = ["format", "version", "exportedAt", "people", "families", "trees", "tasks", "documents"];

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireCollectionEntries(collections) {
  if (!collections || typeof collections !== "object" || Array.isArray(collections)) {
    throw new TypeError("collections doit être un objet indexé par nom de collection");
  }
  for (const [name, records] of Object.entries(collections)) {
    if (!BACKUP_COLLECTION_NAMES.includes(name)) throw new Error(`Collection d'archive inconnue : ${name}`);
    if (!Array.isArray(records)) throw new TypeError(`La collection ${name} doit être un tableau`);
    const ids = new Set();
    for (const record of records) {
      if (!record || typeof record.id !== "string" || !record.id.trim() || record.id.includes("/")) {
        throw new Error(`Identifiant absent ou invalide dans ${name}`);
      }
      if (ids.has(record.id)) throw new Error(`Identifiant dupliqué dans ${name} : ${record.id}`);
      ids.add(record.id);
    }
  }
}

function bytesOf(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new TypeError("Les ressources d'archive doivent être fournies en octets")
}

async function sha256(bytes, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle?.digest) throw new Error("SHA-256 indisponible dans cet environnement");
  const digest = new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function safeSegment(value) {
  return encodeURIComponent(String(value)).replace(/%/g, "_");
}

function assetEntryPath(asset) {
  if (typeof asset.archivePath === "string" && asset.archivePath.startsWith("assets/") && !asset.archivePath.includes("..")) return asset.archivePath;
  const rendition = asset.rendition === "preview" ? `previews/${safeSegment(asset.assetId)}`
    : asset.rendition === "legacy-file" || asset.rendition === "legacy-optimized" ? `legacy/${safeSegment(asset.assetId || "file")}` : "original";
  return `assets/${safeSegment(asset.documentId)}/${safeSegment(asset.pageId)}/${safeSegment(asset.photographId)}/${rendition}`;
}

function inventoryFor(collections) {
  return Object.fromEntries(BACKUP_COLLECTION_NAMES.map(name => [name, {
    present: Object.prototype.hasOwnProperty.call(collections, name),
    recordCount: collections[name]?.length ?? 0,
    ids: (collections[name] || []).map(record => record.id)
  }]));
}

function collectReferences(collections, assets) {
  const errors = [];
  const warnings = [];
  const documents = new Map((collections.documents || []).map(item => [item.id, item]));
  const sourceDocuments = new Map((collections.sourceDocuments || []).map(item => [item.id, item]));
  const transcriptionRevisions = new Map((collections.transcriptionRevisions || []).map(item => [item.id, item]));
  const proofRevisions = new Map((collections.genealogyProofRevisions || []).map(item => [item.id, item]));
  const conclusionRevisions = new Map((collections.conclusionRevisions || []).map(item => [item.id, item]));
  const proofs = new Map((collections.genealogyProofs || []).map(item => [item.id, item]));
  const conclusions = new Map((collections.factConclusions || []).map(item => [item.id, item]));
  const peopleIds = new Set((collections.people || []).map(item => item.id));
  const relationIds = new Set();
  for (const family of collections.families || []) {
    for (const link of family.parentChildLinks || []) {
      if (link?.id) relationIds.add(link.id);
      if (family.id && link?.parentId && link?.childId) relationIds.add(buildLegacyParentChildIdentityId(family.id, link.parentId, link.childId));
    }
  }
  const assetKeys = new Set(assets.map(asset => `${asset.documentId}/${asset.pageId}/${asset.photographId}/${asset.rendition}/${asset.assetId || ""}`));

  for (const doc of collections.documents || []) {
    for (const page of doc.pages || []) {
      for (const photo of page.photographs || []) {
        for (const rendition of ["original", "preview"]) {
          const resource = photo[rendition];
          if (!resource?.resourceRef) continue;
          const assetId = rendition === "preview" ? (resource.id || resource.resourceRef.split("/").at(-1)) : "";
          const key = `${doc.id}/${page.id}/${photo.id}/${rendition}/${assetId}`;
          if (!assetKeys.has(key)) {
            errors.push({ code: "RESOURCE_MISSING", path: resource.resourceRef, message: `Ressource ${rendition} absente de l'archive pour ${doc.id}/${page.id}/${photo.id}` });
          }
        }
      }
    }
  }

  for (const proof of collections.genealogyProofs || []) {
    if (proof.documentId && !documents.has(proof.documentId) && !sourceDocuments.has(proof.documentId)) {
      errors.push({ code: "REFERENCE_MISSING", objectId: proof.id, reference: proof.documentId, message: `La preuve ${proof.id} référence une source absente` });
    }
    if (proof.transcriptionRevisionId && !transcriptionRevisions.has(proof.transcriptionRevisionId)) {
      errors.push({ code: "REVISION_MISSING", objectId: proof.id, reference: proof.transcriptionRevisionId, message: `La preuve ${proof.id} référence une révision de transcription absente` });
    } else if (proof.transcriptionRevisionId && proof.passageId) {
      const revision = transcriptionRevisions.get(proof.transcriptionRevisionId);
      const passages = revision?.data?.passages || revision?.passages || [];
      if (!passages.some(passage => passage.id === proof.passageId)) errors.push({ code: "REFERENCE_MISSING", objectId: proof.id, reference: proof.passageId, message: `Le passage cité par la preuve ${proof.id} est absent de sa révision` });
    }
    if (Array.isArray(proof.personIds)) for (const personId of proof.personIds) if (!peopleIds.has(personId)) errors.push({ code: "REFERENCE_MISSING", objectId: proof.id, reference: personId, message: `La preuve ${proof.id} référence une personne absente` });
    if (proof.relationshipId && !relationIds.has(proof.relationshipId)) errors.push({ code: "REFERENCE_UNVERIFIED", objectId: proof.id, reference: proof.relationshipId, message: `La relation ${proof.relationshipId} de la preuve ${proof.id} n'est pas vérifiable dans les collections exportées` });
    if (typeof proof.factId === "string" && proof.factType && Array.isArray(proof.personIds)
      && !proof.personIds.some(personId => buildFactIdentityId("person", personId, proof.factType) === proof.factId)) {
      warnings.push({ code: "FACT_REFERENCE_UNVERIFIED", objectId: proof.id, reference: proof.factId, message: `Le fait ${proof.factId} de la preuve ${proof.id} ne correspond pas aux identités déterministes des personnes associées` });
    }
  }

  for (const head of collections.sourceDocuments || []) {
    if (head.revisionId && !(collections.sourceRevisions || []).some(item => item.id === head.revisionId)) {
      errors.push({ code: "REVISION_MISSING", objectId: head.id, reference: head.revisionId, message: `La source ${head.id} référence une révision absente` });
    }
  }
  for (const [heads, revisions, kind] of [
    [collections.transcriptionHeads || [], collections.transcriptionRevisions || [], "transcription"],
    [collections.genealogyProofs || [], collections.genealogyProofRevisions || [], "proof"],
    [collections.factConclusions || [], collections.conclusionRevisions || [], "conclusion"]
  ]) {
    const revisionIds = new Set(revisions.map(item => item.id));
    for (const head of heads) {
      if (head.revisionId && !revisionIds.has(head.revisionId)) errors.push({ code: "REVISION_MISSING", objectId: head.id, reference: head.revisionId, message: `${kind} ${head.id} référence une révision absente` });
    }
  }
  for (const revisionSet of [collections.sourceRevisions || [], collections.transcriptionRevisions || [], collections.genealogyProofRevisions || [], collections.conclusionRevisions || []]) {
    const revisionsById = new Map(revisionSet.map(item => [item.id, item]));
    const revisionIds = new Set(revisionsById.keys());
    for (const revision of revisionSet) {
      if (revision.previousRevisionId && !revisionIds.has(revision.previousRevisionId)) {
        errors.push({ code: "REVISION_CHAIN_BROKEN", objectId: revision.id, reference: revision.previousRevisionId, message: `La chaîne de révisions est rompue à ${revision.id}` });
      } else if (revision.previousRevisionId) {
        const previous = revisionsById.get(revision.previousRevisionId);
        if (previous?.objectId !== revision.objectId && previous?.sourceId !== revision.sourceId) errors.push({ code: "REVISION_CHAIN_MISMATCH", objectId: revision.id, reference: revision.previousRevisionId, message: `La révision précédente n'appartient pas au même objet que ${revision.id}` });
      }
      const visited = new Set([revision.id]);
      let cursor = revision;
      while (cursor?.previousRevisionId && revisionsById.has(cursor.previousRevisionId)) {
        if (visited.has(cursor.previousRevisionId)) {
          errors.push({ code: "REVISION_CHAIN_CYCLE", objectId: revision.id, reference: cursor.previousRevisionId, message: `Boucle dans la chaîne de révisions à ${revision.id}` });
          break;
        }
        visited.add(cursor.previousRevisionId);
        cursor = revisionsById.get(cursor.previousRevisionId);
      }
    }
  }
  for (const conclusion of collections.factConclusions || []) {
    const revision = conclusionRevisions.get(conclusion.revisionId);
    for (const proofId of revision?.examinedProofIds || revision?.data?.examinedProofIds || []) {
      if (!proofs.has(proofId)) errors.push({ code: "REFERENCE_MISSING", objectId: conclusion.id, reference: proofId, message: `La conclusion ${conclusion.id} référence une preuve absente` });
    }
  }
  for (const notification of collections.genealogyNotifications || []) {
    if (notification.recipientUid && !(collections.users || []).some(user => user.uid === notification.recipientUid || user.id === notification.recipientUid)) {
      warnings.push({ code: "HISTORICAL_AUTHOR_UNRESOLVED", objectId: notification.id, reference: notification.recipientUid, message: `Le destinataire historique ${notification.recipientUid} n'est pas dans le catalogue des comptes actifs ; aucune identité ni autorisation n'est restaurée` });
    }
  }
  return { errors, warnings };
}

function v4Adapt(manifest) {
  const adapted = { ...manifest, version: BACKUP_ARCHIVE_VERSION, archiveSchemaVersion: BACKUP_ARCHIVE_VERSION, legacySourceVersion: manifest.version, assets: [], missingResources: [] };
  adapted.collections = {
    people: manifest.people || [], families: manifest.families || [], trees: manifest.trees || [],
    documents: (manifest.documents || []).map(record => ({ ...record })), tasks: manifest.tasks || []
  };
  adapted.inventory = inventoryFor(adapted.collections);
  adapted.completeness = {
    status: "partial",
    missingCollections: REQUIRED_COLLECTIONS.filter(name => !Object.hasOwn(adapted.collections, name)),
    missingResources: [],
    warnings: [{ code: "LEGACY_V4_ADAPTED", message: "Archive v4 adaptée en mémoire ; les données absentes de ce format ne peuvent pas être reconstituées." }]
  };
  adapted.sourceProvenance = "legacy-v4";
  return adapted;
}

export async function adaptLegacyV4Archive(manifest, entries, { cryptoProvider = globalThis.crypto } = {}) {
  if (manifest?.format !== BACKUP_FORMAT || manifest.version !== 4) throw new Error("L'adaptateur historique attend une archive v4");
  const adapted = v4Adapt(manifest);
  const entryMap = entries instanceof Map ? entries : new Map(Object.entries(entries || {}));
  for (const document of adapted.collections.documents) {
    if (!document.backupFile) continue;
    const legacyRendition = document.mimeType === "image/webp" || document.compressed === true ? "legacy-optimized" : "legacy-file";
    const value = entryMap.get(document.backupFile);
    if (value == null) {
      adapted.missingResources.push({ resourceRef: document.backupFile, documentId: document.id, rendition: legacyRendition, reason: "legacy-v4-file-missing" });
      adapted.assets.push({
        documentId: document.id, pageId: "legacy-page-unassigned", photographId: document.id,
        rendition: legacyRendition, assetId: document.id, archivePath: document.backupFile, state: "missing", isOriginal: false,
        provenance: "legacy-v4-firestore-optimized-or-unknown", sha256: null, sizeBytes: null
      });
      continue;
    }
    const bytes = bytesOf(value);
    adapted.assets.push({
      documentId: document.id, pageId: "legacy-page-unassigned", photographId: document.id,
      rendition: legacyRendition, assetId: document.id, archivePath: document.backupFile, state: "present", isOriginal: false,
      provenance: "legacy-v4-firestore-optimized-or-unknown", sha256: await sha256(bytes, cryptoProvider),
      sizeBytes: bytes.byteLength, mimeType: document.mimeType || "application/octet-stream", fileName: document.fileName || null
    });
  }
  adapted.completeness.missingResources = adapted.missingResources;
  adapted.completeness.warnings.push({
    code: "V4_ASSETS_NOT_ORIGINAL", message: "Les fichiers v4 sont conservés comme octets historiques ; leur statut d'original n'est pas attesté et ils ne sont jamais qualifiés d'originaux."
  });
  adapted.completeness.status = "partial";
  adapted.completeness.complete = false;
  return adapted;
}

export async function createBackupArchiveManifest({
  collections = {}, assets = [], assetBytes = new Map(), createdAt = new Date().toISOString(),
  capture = { consistent: false, strategy: "client-multi-read" }, collectionScopes = {}, cryptoProvider = globalThis.crypto
} = {}) {
  requireCollectionEntries(collections);
  if (collections.people && collections.families) validateFamilyDataset(collections.people, collections.families);
  if (collections.people && collections.trees) validateTreeDataset(collections.people, collections.trees);
  if (!Array.isArray(assets)) throw new TypeError("assets doit être un tableau");
  const normalizedAssets = [];
  const zipEntries = new Map();
  const missingResources = [];
  const assetIds = new Set();
  for (const asset of assets) {
    if (!asset || !["original", "preview", "legacy-optimized", "legacy-file"].includes(asset.rendition)) throw new Error("Type de ressource d'archive inconnu");
    for (const key of ["documentId", "pageId", "photographId", "resourceRef"]) {
      if (typeof asset[key] !== "string" || !asset[key].trim()) throw new Error(`Ressource sans ${key}`);
    }
    if (asset.rendition === "legacy-optimized" && asset.isOriginal === true) throw new Error("Une image optimisée historique ne peut pas être déclarée originale");
    const entryPath = assetEntryPath(asset);
    if (assetIds.has(entryPath)) throw new Error(`Chemin de ressource dupliqué : ${entryPath}`);
    assetIds.add(entryPath);
    const sourceBytes = assetBytes instanceof Map ? assetBytes.get(asset.resourceRef) : assetBytes[asset.resourceRef];
    const expectedSize = asset.sizeBytes;
    const expectedHash = typeof asset.sha256 === "string" ? asset.sha256.toLowerCase() : null;
    if (sourceBytes == null) {
      missingResources.push({ resourceRef: asset.resourceRef, documentId: asset.documentId, pageId: asset.pageId, photographId: asset.photographId, rendition: asset.rendition, reason: "resource-not-readable" });
      normalizedAssets.push({ ...structuredCloneSafe(asset), archivePath: null, state: "missing", sha256: expectedHash, sizeBytes: expectedSize ?? null, isOriginal: asset.rendition === "original" });
      continue;
    }
    const bytes = bytesOf(sourceBytes);
    const actualHash = await sha256(bytes, cryptoProvider);
    if (Number.isSafeInteger(expectedSize) && expectedSize !== bytes.byteLength) throw new Error(`Fichier de taille incorrecte : ${asset.resourceRef}`);
    if (expectedHash && !HASH_PATTERN.test(expectedHash)) throw new Error(`SHA-256 déclaré invalide : ${asset.resourceRef}`);
    if (expectedHash && expectedHash !== actualHash) throw new Error(`SHA-256 incorrect : ${asset.resourceRef}`);
    zipEntries.set(entryPath, bytes);
    normalizedAssets.push({
      ...structuredCloneSafe(asset), archivePath: entryPath, state: "present", sizeBytes: bytes.byteLength,
      sha256: actualHash, isOriginal: asset.rendition === "original", provenance: asset.provenance || (asset.rendition === "legacy-optimized" ? "historical-optimized-firestore" : "declared-resource")
    });
  }

  const references = collectReferences(collections, normalizedAssets);
  const missingCollections = REQUIRED_COLLECTIONS.filter(name => !Object.hasOwn(collections, name));
  const limitedScopes = Object.entries(collectionScopes).filter(([, scope]) => scope && scope !== "all").map(([name, scope]) => ({ collection: name, scope }));
  if (collections.documents && !collections.sourceDocuments) missingCollections.push("sourceDocuments (documents historiques non convertis)");
  if (collections.users) throw new Error("Les profils Firebase users ne doivent pas être ajoutés à une archive ; conservez les UID historiques dans leurs événements métier uniquement");
  const collectionRecords = Object.fromEntries(Object.entries(collections).map(([name, records]) => [name, structuredCloneSafe(records)]));
  for (const documentRecord of collectionRecords.documents || []) {
    const documentAssets = normalizedAssets.filter(asset => asset.documentId === documentRecord.id);
    if (!documentAssets.length) continue;
    for (const field of ["fileData", "fileUrl", "storagePath", "chunkVersion", "chunkCount", "storageMode", "storedSize", "compressed"]) delete documentRecord[field];
    documentRecord.archiveAssets = documentAssets.map(asset => ({ archivePath: asset.archivePath, state: asset.state, rendition: asset.rendition, isOriginal: asset.isOriginal, sha256: asset.sha256, sizeBytes: asset.sizeBytes }));
  }
  const complete = missingCollections.length === 0 && missingResources.length === 0 && references.errors.length === 0
    && limitedScopes.length === 0 && capture?.consistent === true && capture?.changeDetected !== true;
  const completenessWarnings = [...references.warnings];
  if (!capture?.consistent) completenessWarnings.push({ code: "SNAPSHOT_NOT_ATOMIC", message: "La capture multi-collections n'est pas garantie cohérente par une transaction globale Firestore." });
  if (capture?.changeDetected) completenessWarnings.push({ code: "CHANGES_DURING_CAPTURE", message: "Des marqueurs ont changé pendant l'export ; l'archive est signalée partielle." });
  if (missingCollections.length) completenessWarnings.push({ code: "COLLECTIONS_MISSING", message: `Collections non capturées : ${missingCollections.join(", ")}` });
  if (limitedScopes.length) completenessWarnings.push({ code: "COLLECTION_SCOPE_LIMITED", message: "Certaines collections sont limitées aux éléments visibles par le compte exportateur.", scopes: limitedScopes });
  if (missingResources.length) completenessWarnings.push({ code: "RESOURCES_MISSING", message: `${missingResources.length} ressource(s) référencée(s) ne sont pas présentes dans l'archive.` });
  if (references.errors.length) completenessWarnings.push({ code: "REFERENCES_INVALID", message: `${references.errors.length} incohérence(s) de référence ou de révision détectée(s).` });
  const ids = Object.fromEntries(Object.entries(collectionRecords).map(([name, records]) => [name, records.map(record => record.id)]));
  const manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_ARCHIVE_VERSION,
    archiveSchemaVersion: BACKUP_ARCHIVE_VERSION,
    legacyReadableVersions: [BACKUP_VERSION],
    exportedAt: createdAt,
    createdAt,
    sourceProvenance: "firestore-client-export",
    collections: collectionRecords,
    inventory: inventoryFor(collectionRecords),
    collectionScopes: Object.fromEntries(BACKUP_COLLECTION_NAMES.map(name => [name, collectionScopes[name] || "all"])),
    identifiers: ids,
    assets: normalizedAssets,
    missingResources,
    integrity: { algorithm: "SHA-256", verifiedFileCount: zipEntries.size, errors: references.errors },
    capture: {
      consistent: capture?.consistent === true,
      strategy: capture?.strategy || "client-multi-read",
      changeDetected: capture?.changeDetected === true,
      before: capture?.before ?? null,
      after: capture?.after ?? null
    },
    completeness: { status: complete ? "complete" : "partial", complete, missingCollections, warnings: completenessWarnings },
    // V4 lecteurs : conserver les champs de premier niveau attendus sans changer l'ancien format.
    people: collectionRecords.people || [],
    families: collectionRecords.families || [],
    trees: collectionRecords.trees || [],
    tasks: collectionRecords.tasks || [],
    documents: collectionRecords.documents || []
  };
  return { manifest, entries: zipEntries };
}

export function parseBackupArchiveManifestText(text) {
  const parsed = JSON.parse(text);
  if (parsed?.format !== BACKUP_FORMAT || !Array.isArray(parsed.people) || !Array.isArray(parsed.families)) {
    throw new Error("Format de sauvegarde non reconnu");
  }
  if (parsed.version === 4) return v4Adapt(parsed);
  if (parsed.version !== BACKUP_ARCHIVE_VERSION || parsed.archiveSchemaVersion !== BACKUP_ARCHIVE_VERSION) {
    throw new Error(`Version de sauvegarde non prise en charge : ${parsed.version}`);
  }
  if (!parsed.collections || !parsed.inventory || !Array.isArray(parsed.assets) || !parsed.completeness) {
    throw new Error("Manifeste v5 incomplet ou invalide");
  }
  requireCollectionEntries(parsed.collections);
  return parsed;
}

export async function verifyBackupArchive(manifest, entries, { cryptoProvider = globalThis.crypto, requireComplete = false } = {}) {
  const errors = [];
  const warnings = [...(manifest.completeness?.warnings || [])];
  const entryMap = entries instanceof Map ? entries : new Map(Object.entries(entries || {}));
  for (const asset of manifest.assets || []) {
    if (asset.state === "missing" || !asset.archivePath) {
      errors.push({ code: "RESOURCE_MISSING", path: asset.resourceRef, message: `Ressource absente : ${asset.resourceRef}` });
      continue;
    }
    const value = entryMap.get(asset.archivePath);
    if (value == null) {
      errors.push({ code: "FILE_MISSING", path: asset.archivePath, message: `Fichier absent de l'archive : ${asset.archivePath}` });
      continue;
    }
    const bytes = bytesOf(value);
    if (bytes.byteLength !== asset.sizeBytes) {
      errors.push({ code: "FILE_SIZE_MISMATCH", path: asset.archivePath, message: `Taille incorrecte : ${asset.archivePath}` });
      continue;
    }
    const actualHash = await sha256(bytes, cryptoProvider);
    if (actualHash !== asset.sha256) errors.push({ code: "SHA256_MISMATCH", path: asset.archivePath, expected: asset.sha256, actual: actualHash, message: `Empreinte SHA-256 incorrecte : ${asset.archivePath}` });
  }
  const references = collectReferences(manifest.collections || {}, manifest.assets || []);
  errors.push(...references.errors);
  warnings.push(...references.warnings);
  if (requireComplete && (manifest.completeness?.status !== "complete" || errors.length)) {
    errors.push({ code: "ARCHIVE_INCOMPLETE", message: "Archive incomplète : restauration complète refusée." });
  }
  return { valid: errors.length === 0, complete: manifest.completeness?.status === "complete" && errors.length === 0, errors, warnings };
}

export function prepareBackupRestorePlan(manifest, {
  existing = {}, conflictPolicy = "abort", activeUserIds = [],
  allowIncomplete = false, preflight = true
} = {}) {
  const policies = ["abort", "keep-existing", "replace-existing"];
  if (!policies.includes(conflictPolicy)) throw new Error(`Politique de conflit non reconnue : ${conflictPolicy}`);
  if (manifest?.format !== BACKUP_FORMAT || !manifest.collections) throw new Error("Un manifeste v5 validé est requis pour préparer la restauration");
  if (manifest.completeness?.status !== "complete" && !allowIncomplete) throw new Error("Archive incomplète : autorisez explicitement le plan partiel après examen des avertissements");
  const operations = [];
  const conflicts = [];
  const warnings = [...(manifest.completeness?.warnings || [])];
  const uidSet = new Set(activeUserIds);
  for (const [collectionName, records] of Object.entries(manifest.collections)) {
    const existingIds = new Set(existing[collectionName] || []);
    for (const record of records) {
      const conflict = existingIds.has(record.id);
      if (conflict) conflicts.push({ collection: collectionName, id: record.id, policy: conflictPolicy });
      const action = conflict
        ? conflictPolicy === "keep-existing" ? "skip" : conflictPolicy === "replace-existing" ? "replace" : "conflict"
        : "create";
      operations.push({ collection: collectionName, id: record.id, action });
    }
  }
  const historicalAuthorUids = new Set();
  for (const collectionName of ["genealogyProposals", "sourceRevisions", "transcriptionRevisions", "genealogyProofRevisions", "conclusionRevisions", "genealogyEvents"]) {
    for (const record of manifest.collections[collectionName] || []) {
      for (const field of ["authorUid", "actorUid", "createdBy", "resolvedBy"]) {
        if (typeof record[field] === "string" && record[field] && !uidSet.has(record[field])) historicalAuthorUids.add(record[field]);
      }
    }
  }
  if (historicalAuthorUids.size) warnings.push({
    code: "HISTORICAL_AUTHORS_NOT_ACTIVE",
    uids: [...historicalAuthorUids],
    message: "Les identifiants d'auteurs historiques sont conservés comme données ; aucun compte Firebase Auth ni rôle actif ne sera créé."
  });
  const blocked = operations.some(operation => operation.action === "conflict");
  return {
    kind: "read-only-restore-plan",
    preflightOnly: true,
    preflight,
    writesPerformed: false,
    conflictPolicy,
    operations,
    conflicts,
    warnings,
    historicalAuthorUids: [...historicalAuthorUids],
    blocked,
    executableByClient: false,
    requiresPrivilegedServerForOfficialData: operations.some(operation => ["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions"].includes(operation.collection)),
    reason: "Le client ne peut pas contourner les Firestore Rules ; les collections officielles nécessitent un chemin serveur privilégié contrôlé.",
    archiveCompleteness: manifest.completeness?.status || "partial"
  };
}

/** Ajoute les entrées déjà vérifiées à une instance JSZip injectée ; aucun téléchargement de dépendance ici. */
export function addBackupEntriesToZip(zip, archive) {
  if (!zip || typeof zip.file !== "function" || !(archive?.entries instanceof Map)) throw new TypeError("Une instance ZIP et les entrées préparées sont requises");
  for (const [path, bytes] of archive.entries) zip.file(path, bytes, { binary: true });
  zip.file(BACKUP_MANIFEST_PATH, JSON.stringify(archive.manifest, null, 2));
  return zip;
}

export async function generateBackupZip(archive, ZipConstructor, options = {}) {
  if (typeof ZipConstructor !== "function") throw new TypeError("Le constructeur JSZip doit être fourni par l'adaptateur d'application");
  const zip = addBackupEntriesToZip(new ZipConstructor(), archive);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, ...options });
}

export async function readBackupZip(zip, { cryptoProvider = globalThis.crypto } = {}) {
  if (!zip || typeof zip.file !== "function") throw new TypeError("Une archive ZIP ouverte est requise");
  const manifestEntry = zip.file(BACKUP_MANIFEST_PATH);
  if (!manifestEntry) throw new Error("Archive incomplète : manifeste family-tree.json absent");
  const rawManifest = JSON.parse(await manifestEntry.async("string"));
  const zipAssets = new Map();
  const assetPaths = rawManifest.version === 4
    ? (rawManifest.documents || []).map(document => document.backupFile).filter(Boolean)
    : (rawManifest.assets || []).map(asset => asset.archivePath).filter(Boolean);
  for (const path of assetPaths) {
    const entry = zip.file(path);
    if (entry) zipAssets.set(path, new Uint8Array(await entry.async("uint8array")));
  }
  const manifest = rawManifest.version === 4
    ? await adaptLegacyV4Archive(rawManifest, zipAssets, { cryptoProvider })
    : parseBackupArchiveManifestText(JSON.stringify(rawManifest));
  const resources = new Map();
  for (const asset of manifest.assets || []) if (asset.archivePath && zipAssets.has(asset.archivePath)) resources.set(asset.resourceRef, zipAssets.get(asset.archivePath));
  const integrity = rawManifest.version === 4
    ? { valid: manifest.missingResources.length === 0, complete: false, errors: manifest.missingResources.map(item => ({ code: "FILE_MISSING", path: item.resourceRef, message: `Fichier absent de l'archive : ${item.resourceRef}` })), warnings: manifest.completeness.warnings }
    : await verifyBackupArchive(manifest, zipAssets, { cryptoProvider });
  return { manifest, entries: resources, zipEntries: zipAssets, integrity };
}
