import { normalizeGenealogyDate } from "./genealogy-date.js";
import { RELATION_TYPE_LABELS, END_TYPE_LABELS, FILIATION_TYPE_LABELS } from "./family-relations.js";

export const FILE_CHUNK_BYTES = 700 * 1024;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const BACKUP_FORMAT = "family-tree-backup";
export const BACKUP_VERSION = 3;
export const IMPORT_BATCH_SIZE = 400;

export function formatBytes(value = 0) {
  if (!value) return "0 Ko";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function exportableRecord(item) {
  return JSON.parse(JSON.stringify(item));
}

export function importedDataFields(item) {
  const { id, createdAt, updatedAt, backupFile, ...data } = item || {};
  return data;
}

export function safeBackupName(value = "document") {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "document";
}

export function backupFileEntryPath(documentId, fileName = "") {
  const fallback = `document-${documentId}`;
  const clean = (fileName || fallback).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return `documents/${documentId}/${clean || fallback}`;
}

export function isValidStoredDate(value) {
  if (value == null) return true;
  if (!value || typeof value !== "object" || !["exact", "year", "about", "between", "unknown"].includes(value.type)) return false;
  if (value.type === "unknown") return true;
  const normalized = normalizeGenealogyDate(value);
  return normalized.type === value.type;
}

export function validateFamilyDataset(personRecords = [], familyRecords = []) {
  const personIds = new Set();
  for (const item of personRecords) {
    if (!item?.id || item.id.includes("/") || personIds.has(item.id)) throw new Error("La sauvegarde contient un identifiant de personne invalide ou dupliqué");
    personIds.add(item.id);
    if (!isValidStoredDate(item.birthDateInfo) || !isValidStoredDate(item.deathDateInfo)) throw new Error(`La fiche ${item.id} contient une date généalogique invalide`);
  }
  const familyIds = new Set();
  const childHomes = new Map();
  const childrenByParent = new Map();
  for (const family of familyRecords) {
    if (!family?.id || family.id.includes("/") || familyIds.has(family.id)) throw new Error("La sauvegarde contient un identifiant de foyer invalide ou dupliqué");
    familyIds.add(family.id);
    const parentIds = Array.isArray(family.partnerIds) ? [...new Set(family.partnerIds)] : [];
    const childIds = Array.isArray(family.childIds) ? [...new Set(family.childIds)] : [];
    if (!parentIds.length || parentIds.length > 2 || parentIds.length !== (family.partnerIds || []).length || childIds.length !== (family.childIds || []).length) throw new Error(`Le foyer ${family.id} contient des liens invalides`);
    if ([...parentIds, ...childIds].some(id => !personIds.has(id))) throw new Error(`Le foyer ${family.id} fait référence à une personne absente`);
    if (parentIds.some(id => childIds.includes(id))) throw new Error(`Le foyer ${family.id} place une personne parmi ses propres parents`);
    if (family.relationType != null && !Object.prototype.hasOwnProperty.call(RELATION_TYPE_LABELS, family.relationType)) throw new Error(`Le foyer ${family.id} contient un type de relation invalide`);
    if (family.endType != null && !Object.prototype.hasOwnProperty.call(END_TYPE_LABELS, family.endType)) throw new Error(`Le foyer ${family.id} contient une fin de relation invalide`);
    if (!isValidStoredDate(family.unionDateInfo) || !isValidStoredDate(family.endDateInfo)) throw new Error(`Le foyer ${family.id} contient une date généalogique invalide`);
    if (family.parentChildLinks != null) {
      if (!Array.isArray(family.parentChildLinks)) throw new Error(`Le foyer ${family.id} contient des filiations invalides`);
      const seenLinks = new Set();
      for (const link of family.parentChildLinks) {
        const key = `${link?.parentId}:${link?.childId}`;
        if (!parentIds.includes(link?.parentId) || !childIds.includes(link?.childId) || !Object.prototype.hasOwnProperty.call(FILIATION_TYPE_LABELS, link?.type) || seenLinks.has(key)) throw new Error(`Le foyer ${family.id} contient une filiation invalide ou dupliquée`);
        seenLinks.add(key);
      }
    }
    for (const childId of childIds) {
      if (childHomes.has(childId) && childHomes.get(childId) !== family.id) throw new Error("Une personne est rattachée comme enfant à plusieurs foyers");
      childHomes.set(childId, family.id);
      for (const parentId of parentIds) {
        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
        childrenByParent.get(parentId).push(childId);
      }
    }
  }
  const visited = new Set(), active = new Set();
  function visit(id) {
    if (active.has(id)) throw new Error("La sauvegarde contient une boucle dans les liens parent-enfant");
    if (visited.has(id)) return;
    active.add(id);
    for (const childId of childrenByParent.get(id) || []) visit(childId);
    active.delete(id);
    visited.add(id);
  }
  personIds.forEach(visit);
}

export function documentChunkId(documentId, version, index) {
  return `${documentId}_${version}_${String(index).padStart(4, "0")}`;
}

export function chunkCountForBytes(byteLength, chunkBytes = FILE_CHUNK_BYTES) {
  return Math.ceil(byteLength / chunkBytes);
}

export function splitBytesIntoChunks(bytes, chunkBytes = FILE_CHUNK_BYTES) {
  const parts = [];
  for (let index = 0; index < chunkCountForBytes(bytes.length, chunkBytes); index++) {
    parts.push(bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes));
  }
  return parts;
}

export function concatByteArrays(parts = []) {
  const merged = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

export function collectChunkParts(readChunk, count) {
  const parts = [];
  for (let index = 0; index < count; index++) {
    const part = readChunk(index);
    if (part == null) throw new Error("Un bloc du fichier est introuvable");
    parts.push(part);
  }
  return parts;
}

export function sliceIntoBatches(records = [], size = IMPORT_BATCH_SIZE) {
  const batches = [];
  if (size <= 0) return batches;
  for (let start = 0; start < records.length; start += size) batches.push(records.slice(start, start + size));
  return batches;
}

export function buildBackupManifest({ people = [], families = [], tasks = [], documents = [], blobs = new Map(), exportedAt = new Date().toISOString() } = {}) {
  const manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    people: people.map(exportableRecord),
    families: families.map(exportableRecord),
    tasks: tasks.map(exportableRecord),
    documents: []
  };
  for (const item of documents) {
    const record = exportableRecord(item);
    const blob = blobs.get(item.id);
    if (blob) {
      record.backupFile = backupFileEntryPath(item.id, item.fileName);
      delete record.fileData;
      delete record.fileUrl;
      delete record.storagePath;
      delete record.chunkVersion;
      delete record.chunkCount;
    }
    manifest.documents.push(record);
  }
  return manifest;
}

export function parseBackupManifestText(text) {
  const manifest = JSON.parse(text);
  if (manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.people) || !Array.isArray(manifest.families)) throw new Error("Format de sauvegarde non reconnu");
  return manifest;
}