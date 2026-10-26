/* Modèle pur des sources documentaires (lot 1).
   Aucun accès à Firebase, DOM, réseau, stockage ou génération d'identifiants.
   Les identifiants métier sont fournis par l'appelant et restent indépendants
   du titre, de l'ordre des pages et du nom des fichiers.
*/

export const SOURCE_DOCUMENT_SCHEMA_VERSION = 1;
export const SOURCE_DOCUMENT_STATES = Object.freeze(["active", "archived"]);
export const DOCUMENT_PAGE_SIDES = Object.freeze(["recto", "verso"]);
export const DOCUMENT_DATE_TYPES = Object.freeze(["exact", "month", "year", "about", "between", "unknown"]);
export const SHA256_HEX_PATTERN = /^[a-fA-F0-9]{64}$/;

const DOCUMENT_STRING_FIELDS = Object.freeze([
  "title", "description", "category", "placeOrTerritory", "holdingOrganization",
  "fondsSeries", "cote", "subCote", "externalUrl", "researchNotes"
]);

function nonEmptyString(value, field) {
  return typeof value === "string" && value.trim().length > 0
    ? null
    : `${field} doit être une chaîne non vide`;
}

function copyArray(value) {
  return Array.isArray(value) ? value.map(item => item && typeof item === "object" ? { ...item } : item) : [];
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return false;
  const date = new Date(Date.UTC(0, month - 1, day));
  date.setUTCFullYear(year);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validateDateBoundary(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return `${field} doit préciser une année`;
  if (!Number.isInteger(value.year) || value.year < 1 || value.year > 9999) return `${field}.year doit être une année valide`;
  if (value.month !== undefined && (!Number.isInteger(value.month) || value.month < 1 || value.month > 12)) return `${field}.month doit être compris entre 1 et 12`;
  if (value.day !== undefined) {
    if (!Number.isInteger(value.day) || value.month === undefined) return `${field}.day nécessite un mois valide`;
    const exact = `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
    if (!isCalendarDate(exact)) return `${field} ne constitue pas une date valide`;
  }
  return null;
}

export function validateDocumentDateInfo(value) {
  if (value == null) return [];
  if (!value || typeof value !== "object" || Array.isArray(value) || !DOCUMENT_DATE_TYPES.includes(value.type)) {
    return ["dateInfo doit utiliser un type de date documentaire reconnu"];
  }
  if (value.type === "unknown") return [];
  if (value.type === "exact") return isCalendarDate(value.value) ? [] : ["dateInfo.value doit être une date réelle au format AAAA-MM-JJ"];
  if (value.type === "month") {
    const errors = [];
    if (!Number.isInteger(value.year) || value.year < 1 || value.year > 9999) errors.push("dateInfo.year doit être une année valide");
    if (!Number.isInteger(value.month) || value.month < 1 || value.month > 12) errors.push("dateInfo.month doit être compris entre 1 et 12");
    return errors;
  }
  if (value.type === "year" || value.type === "about") {
    return Number.isInteger(value.year) && value.year >= 1 && value.year <= 9999
      ? []
      : ["dateInfo.year doit être une année valide"];
  }
  const errors = [
    validateDateBoundary(value.from, "dateInfo.from"),
    validateDateBoundary(value.to, "dateInfo.to")
  ].filter(Boolean);
  if (!errors.length) {
    const from = [value.from.year, value.from.month || 1, value.from.day || 1];
    const to = [value.to.year, value.to.month || 12, value.to.day || 31];
    if (from[0] > to[0] || (from[0] === to[0] && from[1] > to[1])
      || (from[0] === to[0] && from[1] === to[1] && from[2] > to[2])) {
      errors.push("dateInfo.from doit précéder ou égaler dateInfo.to");
    }
  }
  return errors;
}

export function createSourceDocument({ id, ...metadata } = {}) {
  const idError = nonEmptyString(id, "id");
  if (idError) throw new TypeError(idError);
  const languages = copyArray(metadata.languages);
  const archivalReferences = copyArray(metadata.archivalReferences);
  const personIds = copyArray(metadata.personIds);
  const documentIds = Array.isArray(metadata.documentIds) ? [...new Set(metadata.documentIds)] : metadata.documentIds === undefined ? [] : metadata.documentIds;
  const pages = copyArray(metadata.pages);
  return {
    ...metadata,
    id,
    schemaVersion: SOURCE_DOCUMENT_SCHEMA_VERSION,
    title: metadata.title ?? "",
    description: metadata.description ?? "",
    category: metadata.category ?? "",
    languages,
    dateInfo: metadata.dateInfo == null ? null : { ...metadata.dateInfo },
    placeOrTerritory: metadata.placeOrTerritory ?? "",
    holdingOrganization: metadata.holdingOrganization ?? "",
    fondsSeries: metadata.fondsSeries ?? "",
    cote: metadata.cote ?? "",
    subCote: metadata.subCote ?? "",
    archivalReferences,
    externalUrl: metadata.externalUrl ?? "",
    researchNotes: metadata.researchNotes ?? "",
    status: metadata.status ?? "active",
    personIds,
    documentIds,
    pages
  };
}

export function mergeSourceDocumentGuidedData(original = {}, guided = {}) {
  if (!original || typeof original !== "object" || Array.isArray(original)) throw new TypeError("original doit être un objet");
  if (!guided || typeof guided !== "object" || Array.isArray(guided)) throw new TypeError("guided doit être un objet");
  return { ...structuredClone(original), ...structuredClone(guided) };
}

export function createDocumentPage({ id, order, label = "", side = null } = {}) {
  const idError = nonEmptyString(id, "id");
  if (idError) throw new TypeError(idError);
  if (order !== undefined && (!Number.isInteger(order) || order < 0)) throw new TypeError("order doit être un entier positif ou nul");
  if (side !== null && !DOCUMENT_PAGE_SIDES.includes(side)) throw new TypeError("side doit être recto, verso ou null");
  if (typeof label !== "string") throw new TypeError("label doit être une chaîne");
  return { id, order: order ?? 0, label, side, photographs: [] };
}

export function createPhotographAsset({
  id,
  originalFileName,
  mimeType,
  sizeBytes,
  sha256,
  originalRef,
  previewRef = null,
  previewMimeType = null,
  previewSizeBytes = null,
  previewWidth = null,
  previewHeight = null,
  previewSha256 = null,
  importedAt = null,
  role = "full"
} = {}) {
  const errors = [];
  for (const [value, field] of [[id, "id"], [originalFileName, "originalFileName"], [mimeType, "mimeType"], [originalRef, "originalRef"]]) {
    const error = nonEmptyString(value, field);
    if (error) errors.push(error);
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) errors.push("sizeBytes doit être un entier positif ou nul");
  if (typeof sha256 !== "string" || !SHA256_HEX_PATTERN.test(sha256)) errors.push("sha256 doit contenir exactement 64 caractères hexadécimaux");
  if (previewRef !== null && (typeof previewRef !== "string" || !previewRef.trim())) errors.push("previewRef doit être une référence non vide ou null");
  if (previewRef && previewRef === originalRef) errors.push("L’aperçu doit être une ressource distincte de l’original");
  if (previewRef && previewMimeType !== null && (typeof previewMimeType !== "string" || !previewMimeType.trim())) errors.push("previewMimeType doit être une chaîne non vide");
  if (previewRef && previewSizeBytes !== null && (!Number.isSafeInteger(previewSizeBytes) || previewSizeBytes < 0)) errors.push("previewSizeBytes doit être un entier positif ou nul");
  if (previewRef && previewWidth !== null && (!Number.isInteger(previewWidth) || previewWidth < 1)) errors.push("previewWidth doit être un entier positif");
  if (previewRef && previewHeight !== null && (!Number.isInteger(previewHeight) || previewHeight < 1)) errors.push("previewHeight doit être un entier positif");
  if (previewRef && previewSha256 !== null && (typeof previewSha256 !== "string" || !SHA256_HEX_PATTERN.test(previewSha256))) errors.push("previewSha256 doit contenir exactement 64 caractères hexadécimaux");
  if (importedAt !== null && typeof importedAt !== "string" && !(importedAt instanceof Date)) errors.push("importedAt doit être une chaîne, une date ou null");
  if (typeof role !== "string" || !role.trim()) errors.push("role doit être une chaîne non vide");
  if (errors.length) throw new TypeError(errors.join("; "));
  return {
    id,
    original: { originalFileName, mimeType, sizeBytes, sha256: sha256.toLowerCase(), resourceRef: originalRef, importedAt },
    preview: previewRef ? {
      resourceRef: previewRef,
      ...(previewMimeType !== null ? { mimeType: previewMimeType } : {}),
      ...(previewSizeBytes !== null ? { sizeBytes: previewSizeBytes } : {}),
      ...(previewWidth !== null ? { width: previewWidth } : {}),
      ...(previewHeight !== null ? { height: previewHeight } : {}),
      ...(previewSha256 !== null ? { sha256: previewSha256.toLowerCase() } : {})
    } : null,
    role
  };
}

export function validatePhotographAsset(asset) {
  const errors = [];
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) return { valid: false, errors: ["La photographie doit être un objet"] };
  for (const [value, field] of [[asset.id, "id"], [asset.role, "role"]]) {
    const error = nonEmptyString(value, field);
    if (error) errors.push(error);
  }
  const original = asset.original;
  if (!original || typeof original !== "object" || Array.isArray(original)) errors.push("original doit décrire l’actif source");
  else {
    for (const [value, field] of [[original.originalFileName, "original.originalFileName"], [original.mimeType, "original.mimeType"], [original.resourceRef, "original.resourceRef"]]) {
      const error = nonEmptyString(value, field);
      if (error) errors.push(error);
    }
    if (!Number.isSafeInteger(original.sizeBytes) || original.sizeBytes < 0) errors.push("original.sizeBytes doit être un entier positif ou nul");
    if (typeof original.sha256 !== "string" || !SHA256_HEX_PATTERN.test(original.sha256)) errors.push("original.sha256 doit contenir exactement 64 caractères hexadécimaux");
  }
  if (asset.preview != null) {
    if (typeof asset.preview !== "object" || Array.isArray(asset.preview) || nonEmptyString(asset.preview.resourceRef, "preview.resourceRef")) {
      errors.push("preview doit référencer une ressource distincte");
    } else if (original?.resourceRef === asset.preview.resourceRef) {
      errors.push("L’aperçu doit être une ressource distincte de l’original");
    }
    if (asset.preview.mimeType !== undefined && (typeof asset.preview.mimeType !== "string" || !asset.preview.mimeType.trim())) errors.push("preview.mimeType doit être une chaîne non vide");
    if (asset.preview.sizeBytes !== undefined && (!Number.isSafeInteger(asset.preview.sizeBytes) || asset.preview.sizeBytes < 0)) errors.push("preview.sizeBytes doit être un entier positif ou nul");
    if (asset.preview.width !== undefined && (!Number.isInteger(asset.preview.width) || asset.preview.width < 1)) errors.push("preview.width doit être un entier positif");
    if (asset.preview.height !== undefined && (!Number.isInteger(asset.preview.height) || asset.preview.height < 1)) errors.push("preview.height doit être un entier positif");
    if (asset.preview.sha256 !== undefined && (typeof asset.preview.sha256 !== "string" || !SHA256_HEX_PATTERN.test(asset.preview.sha256))) errors.push("preview.sha256 doit contenir exactement 64 caractères hexadécimaux");
  }
  return { valid: errors.length === 0, errors };
}

export function validateDocumentPage(page) {
  const errors = [];
  if (!page || typeof page !== "object" || Array.isArray(page)) return { valid: false, errors: ["La page doit être un objet"] };
  const idError = nonEmptyString(page.id, "id");
  if (idError) errors.push(idError);
  if (!Number.isInteger(page.order) || page.order < 0) errors.push("order doit être un entier positif ou nul");
  if (typeof page.label !== "string") errors.push("label doit être une chaîne");
  if (page.side !== null && !DOCUMENT_PAGE_SIDES.includes(page.side)) errors.push("side doit être recto, verso ou null");
  if (!Array.isArray(page.photographs)) errors.push("photographs doit être un tableau");
  else {
    const ids = new Set();
    for (const photograph of page.photographs) {
      const result = validatePhotographAsset(photograph);
      errors.push(...result.errors);
      if (photograph?.id && ids.has(photograph.id)) errors.push("Les identifiants de photographies doivent être uniques dans la page");
      if (photograph?.id) ids.add(photograph.id);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateSourceDocument(document) {
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, errors: ["Le document source doit être un objet"] };
  const idError = nonEmptyString(document.id, "id");
  if (idError) errors.push(idError);
  if (document.schemaVersion !== SOURCE_DOCUMENT_SCHEMA_VERSION) errors.push("schemaVersion non reconnu");
  for (const field of DOCUMENT_STRING_FIELDS) {
    if (document[field] !== undefined && typeof document[field] !== "string") errors.push(`${field} doit être une chaîne`);
  }
  if (!SOURCE_DOCUMENT_STATES.includes(document.status)) errors.push("status doit être active ou archived");
  if (!Array.isArray(document.languages) || document.languages.some(value => typeof value !== "string" || !value.trim())) errors.push("languages doit être un tableau de chaînes non vides");
  if (!Array.isArray(document.personIds) || document.personIds.some(value => typeof value !== "string" || !value.trim())) errors.push("personIds doit être un tableau d'identifiants non vides");
  if (document.documentIds !== undefined && (!Array.isArray(document.documentIds)
    || document.documentIds.some(value => typeof value !== "string" || !value.trim())
    || new Set(document.documentIds).size !== document.documentIds.length)) {
    errors.push("documentIds doit être un tableau d'identifiants de documents uniques et non vides");
  }
  if (!Array.isArray(document.archivalReferences)) errors.push("archivalReferences doit être un tableau");
  else document.archivalReferences.forEach((reference, index) => {
    if (!reference || typeof reference !== "object" || Array.isArray(reference) || typeof reference.value !== "string") {
      errors.push(`archivalReferences[${index}] doit préserver une valeur textuelle`);
    }
  });
  errors.push(...validateDocumentDateInfo(document.dateInfo));
  if (!Array.isArray(document.pages)) errors.push("pages doit être un tableau");
  else {
    const pageIds = new Set();
    const pageOrders = new Set();
    const photographIds = new Set();
    document.pages.forEach(page => {
      const result = validateDocumentPage(page);
      errors.push(...result.errors);
      if (page?.id && pageIds.has(page.id)) errors.push("Les identifiants de pages doivent être uniques dans le document");
      if (page?.id) pageIds.add(page.id);
      if (Number.isInteger(page?.order) && pageOrders.has(page.order)) errors.push("L'ordre des pages doit être unique");
      if (Number.isInteger(page?.order)) pageOrders.add(page.order);
      for (const photograph of page?.photographs || []) {
        if (photograph?.id && photographIds.has(photograph.id)) errors.push("Les identifiants de photographies doivent être uniques dans le document");
        if (photograph?.id) photographIds.add(photograph.id);
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

export function addDocumentPage(document, pageData) {
  const page = createDocumentPage({ ...pageData, order: pageData?.order ?? document.pages.reduce((max, item) => Math.max(max, item.order), -1) + 1 });
  if (document.pages.some(existing => existing.id === page.id)) throw new Error("Cet identifiant de page existe déjà dans le document");
  if (document.pages.some(existing => existing.order === page.order)) throw new Error("Cet ordre de page est déjà utilisé");
  return { ...document, pages: [...document.pages.map(existing => ({ ...existing, photographs: [...existing.photographs] })), page] };
}

export function addPhotographsToPage(document, pageId, photographs) {
  if (!Array.isArray(photographs) || !photographs.length) throw new TypeError("Fournir au moins une photographie");
  const pageIndex = document.pages.findIndex(page => page.id === pageId);
  if (pageIndex < 0) throw new Error("Page introuvable dans le document");
  const created = photographs.map(createPhotographAsset);
  const existingIds = new Set(document.pages.flatMap(page => page.photographs.map(photo => photo.id)));
  for (const photo of created) {
    if (existingIds.has(photo.id)) throw new Error("Cet identifiant de photographie existe déjà dans le document");
    existingIds.add(photo.id);
  }
  const pages = document.pages.map((page, index) => index === pageIndex
    ? { ...page, photographs: [...page.photographs, ...created] }
    : { ...page, photographs: [...page.photographs] });
  return { ...document, pages };
}

export function reorderDocumentPages(document, orderedPageIds) {
  if (!Array.isArray(orderedPageIds)) throw new TypeError("orderedPageIds doit être un tableau");
  const currentIds = document.pages.map(page => page.id);
  if (orderedPageIds.length !== currentIds.length || new Set(orderedPageIds).size !== currentIds.length
    || currentIds.some(id => !orderedPageIds.includes(id))) {
    throw new Error("Le nouvel ordre doit contenir une fois chaque page du document");
  }
  const pageById = new Map(document.pages.map(page => [page.id, page]));
  return {
    ...document,
    pages: orderedPageIds.map((id, order) => ({ ...pageById.get(id), order, photographs: [...pageById.get(id).photographs] }))
  };
}

/**
 * Vue non persistable d'un document historique. L'ID historique est conservé,
 * les champs inconnus restent sous `legacyRecord`, mais aucune identité page ou
 * photographie n'est inventée. Les anciennes références de fichier sont
 * fournies comme pointeur à consulter par l'adaptateur UI existant, sans
 * qualification d'original : compression et intégrité sont parfois inconnues.
 */
export function adaptLegacyDocument(legacyRecord) {
  if (!legacyRecord || typeof legacyRecord !== "object" || Array.isArray(legacyRecord)) {
    throw new TypeError("legacyRecord doit être un document historique");
  }
  const fileReference = legacyRecord.chunkVersion && Number.isInteger(legacyRecord.chunkCount)
    ? { kind: "firestore-chunks", documentId: legacyRecord.id ?? null, version: legacyRecord.chunkVersion, chunkCount: legacyRecord.chunkCount }
    : legacyRecord.fileUrl
      ? { kind: "url", value: legacyRecord.fileUrl }
      : legacyRecord.fileData
        ? { kind: "data-url", value: legacyRecord.fileData }
        : legacyRecord.externalUrl
          ? { kind: "external-url", value: legacyRecord.externalUrl }
          : null;
  return {
    kind: "legacy-document-view",
    documentId: typeof legacyRecord.id === "string" ? legacyRecord.id : null,
    metadata: { ...legacyRecord },
    fileReference,
    pageIdentity: "not-assigned",
    photographIdentity: "not-assigned",
    originalIntegrity: "unverified"
  };
}

export function findExactPhotographDuplicates(documents) {
  if (!Array.isArray(documents)) throw new TypeError("documents doit être un tableau");
  const byHash = new Map();
  for (const document of documents) {
    for (const page of document?.pages || []) {
      for (const photograph of page?.photographs || []) {
        const hash = photograph?.original?.sha256;
        if (typeof hash !== "string" || !SHA256_HEX_PATTERN.test(hash)) continue;
        const normalizedHash = hash.toLowerCase();
        if (!byHash.has(normalizedHash)) byHash.set(normalizedHash, []);
        byHash.get(normalizedHash).push({ documentId: document.id, pageId: page.id, photographId: photograph.id });
      }
    }
  }
  return [...byHash.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([sha256, occurrences]) => ({ sha256, occurrences }));
}

export const SOURCE_DOCUMENT_PICKER_PAGE_SIZE = 10;

export function normalizeSourceDocumentSearchText(value = "") {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function searchLinkedDocuments(documents = [], query = "") {
  if (!Array.isArray(documents)) throw new TypeError("documents doit être un tableau");
  const needle = normalizeSourceDocumentSearchText(query);
  if (!needle) return [];
  return documents.filter(item => normalizeSourceDocumentSearchText(
    [item?.title, item?.fileName, item?.type].filter(value => typeof value === "string" && value.trim()).join(" ")
  ).includes(needle));
}

export function resolveSourceDocumentLinks(sourceData, documents = []) {
  if (!Array.isArray(documents)) throw new TypeError("documents doit être un tableau");
  const ids = [...new Set(Array.isArray(sourceData?.documentIds)
    ? sourceData.documentIds.filter(id => typeof id === "string" && id.trim())
    : [])];
  return ids.map(id => {
    const item = documents.find(documentItem => documentItem?.id === id) || null;
    if (!item) return { id, missing: true, label: "", type: "", canOpen: false };
    return {
      id,
      missing: false,
      label: String(item.title || "").trim() || String(item.type || "").trim() || String(item.fileName || "").trim() || "Document",
      type: String(item.type || "").trim() || String(item.fileName || "").trim() || "Document",
      canOpen: !!(item.chunkCount || item.fileData || item.fileUrl || item.externalUrl)
    };
  });
}
