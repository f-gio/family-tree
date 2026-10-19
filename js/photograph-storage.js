/* Stockage abstrait des originaux et aperçus de photographies.
   L'adaptateur de ce lot garde les bytes en mémoire, sans Firebase ni disque.
   Les méthodes asynchrones forment le contrat qu'un futur adaptateur distant
   pourra implémenter ; une instance mémoire n'est pas une sauvegarde durable.
*/

export class PhotographStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PhotographStorageError";
    this.code = code;
  }
}

const SHA256_HEX = /^[a-fA-F0-9]{64}$/;

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new PhotographStorageError("INVALID_METADATA", `${field} doit être une chaîne non vide`);
  }
  return value;
}

function pathPart(value, field) {
  return encodeURIComponent(requireString(value, field))
    .replace(/~/g, "%7E")
    .replace(/\./g, "%2E");
}

export function buildPhotographResourceRef({ documentId, pageId, photographId, variant = "original", previewId = "" } = {}) {
  const prefix = `documents/${pathPart(documentId, "documentId")}/pages/${pathPart(pageId, "pageId")}/photographs/${pathPart(photographId, "photographId")}`;
  if (variant === "original") return `${prefix}/original`;
  if (variant === "preview") return `${prefix}/previews/${pathPart(previewId, "previewId")}`;
  throw new PhotographStorageError("INVALID_METADATA", "variant doit être original ou preview");
}

async function copyToBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (typeof Blob !== "undefined" && value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  throw new PhotographStorageError("INVALID_FILE", "Le contenu doit être un Blob ou un tableau d’octets");
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export class MemoryPhotographStorage {
  #assets = new Map();
  #crypto;

  constructor({ cryptoProvider = globalThis.crypto } = {}) {
    this.#crypto = cryptoProvider;
  }

  async #digest(bytes) {
    if (!this.#crypto?.subtle?.digest) {
      throw new PhotographStorageError("CRYPTO_UNAVAILABLE", "SHA-256 indisponible dans cet environnement");
    }
    return bytesToHex(await this.#crypto.subtle.digest("SHA-256", bytes));
  }

  #insertOnce(resourceRef, asset) {
    if (this.#assets.has(resourceRef)) {
      throw new PhotographStorageError("ALREADY_EXISTS", "Cette ressource existe déjà ; aucun écrasement effectué");
    }
    this.#assets.set(resourceRef, { ...asset, bytes: new Uint8Array(asset.bytes) });
  }

  async storeOriginal({ documentId, pageId, photographId, fileName, mimeType, blob, importedAt = null, expectedSha256 = null } = {}) {
    const id = pathPart(photographId, "photographId");
    const originalFileName = requireString(fileName, "fileName");
    const contentType = requireString(mimeType, "mimeType");
    const bytes = await copyToBytes(blob);
    if (bytes.length === 0) throw new PhotographStorageError("INVALID_FILE", "Le fichier original est vide");
    const sha256 = await this.#digest(bytes);
    if (expectedSha256 !== null && (typeof expectedSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(expectedSha256))) {
      throw new PhotographStorageError("INVALID_METADATA", "expectedSha256 doit contenir 64 caractères hexadécimaux");
    }
    if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
      throw new PhotographStorageError("INTEGRITY_MISMATCH", "L’empreinte SHA-256 fournie ne correspond pas au fichier");
    }
    if (importedAt !== null && typeof importedAt !== "string" && !(importedAt instanceof Date)) {
      throw new PhotographStorageError("INVALID_METADATA", "importedAt doit être une chaîne, une date ou null");
    }
    const resourceRef = buildPhotographResourceRef({ documentId, pageId, photographId, variant: "original" });
    const asset = { kind: "original", id, originalFileName, mimeType: contentType, sizeBytes: bytes.length, sha256, importedAt, bytes };
    this.#insertOnce(resourceRef, asset);
    return { id: photographId, originalFileName, mimeType: contentType, sizeBytes: bytes.length, sha256, resourceRef, importedAt };
  }

  async verifyOriginal(resourceRef, expectedSha256) {
    const asset = this.#assets.get(requireString(resourceRef, "resourceRef"));
    if (!asset || asset.kind !== "original") return { valid: false, status: "missing", sha256: null };
    if (typeof expectedSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(expectedSha256)) {
      return { valid: false, status: "invalid-expected-hash", sha256: asset.sha256 };
    }
    const actual = await this.#digest(asset.bytes);
    if (actual !== expectedSha256.toLowerCase() || actual !== asset.sha256) {
      return { valid: false, status: "mismatch", sha256: actual };
    }
    return { valid: true, status: "verified", sha256: actual };
  }

  async readOriginal(resourceRef, expectedSha256) {
    const asset = this.#assets.get(requireString(resourceRef, "resourceRef"));
    if (!asset || asset.kind !== "original") throw new PhotographStorageError("RESOURCE_MISSING", "Photographie originale introuvable");
    const expected = expectedSha256 ?? asset.sha256;
    const integrity = await this.verifyOriginal(resourceRef, expected);
    if (!integrity.valid) {
      const code = integrity.status === "missing" ? "RESOURCE_MISSING" : "INTEGRITY_MISMATCH";
      throw new PhotographStorageError(code, `Vérification de l’original impossible : ${integrity.status}`);
    }
    return new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType });
  }

  async storePreview({ documentId, pageId, photographId, previewId, blob, mimeType, width, height, derivedFromSha256 } = {}) {
    const contentType = requireString(mimeType, "mimeType");
    requireString(previewId, "previewId");
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new PhotographStorageError("INVALID_METADATA", "Les dimensions de l’aperçu doivent être des entiers positifs");
    }
    if (typeof derivedFromSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(derivedFromSha256)) {
      throw new PhotographStorageError("INVALID_METADATA", "derivedFromSha256 doit contenir 64 caractères hexadécimaux");
    }
    const originalRef = buildPhotographResourceRef({ documentId, pageId, photographId, variant: "original" });
    const original = this.#assets.get(originalRef);
    if (!original || original.kind !== "original") throw new PhotographStorageError("RESOURCE_MISSING", "L’original source de l’aperçu est introuvable");
    if (original.sha256 !== derivedFromSha256.toLowerCase()) {
      throw new PhotographStorageError("INTEGRITY_MISMATCH", "L’aperçu ne correspond pas à la version d’original référencée");
    }
    const bytes = await copyToBytes(blob);
    if (bytes.length === 0) throw new PhotographStorageError("INVALID_FILE", "L’aperçu est vide");
    const resourceRef = buildPhotographResourceRef({ documentId, pageId, photographId, variant: "preview", previewId });
    const sha256 = await this.#digest(bytes);
    this.#insertOnce(resourceRef, { kind: "preview", mimeType: contentType, sizeBytes: bytes.length, width, height, sha256, derivedFromSha256: original.sha256, bytes });
    return { id: previewId, resourceRef, mimeType: contentType, sizeBytes: bytes.length, width, height, sha256, derivedFromSha256: original.sha256 };
  }

  async readPreview(resourceRef, expectedSha256) {
    const asset = this.#assets.get(requireString(resourceRef, "resourceRef"));
    if (!asset || asset.kind !== "preview") throw new PhotographStorageError("RESOURCE_MISSING", "Aperçu introuvable");
    const actual = await this.#digest(asset.bytes);
    if (expectedSha256 && actual !== expectedSha256.toLowerCase() || actual !== asset.sha256) {
      throw new PhotographStorageError("INTEGRITY_MISMATCH", "L’empreinte de l’aperçu ne correspond pas au contenu");
    }
    return new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType });
  }
}

/** Choix pur de la ressource à afficher ; la lecture réelle est déléguée au stockage. */
export function selectPhotographResource(photograph, { useOriginal = false } = {}) {
  if (!photograph || typeof photograph !== "object") throw new PhotographStorageError("INVALID_METADATA", "Photographie invalide");
  if (useOriginal) {
    const original = photograph.original;
    if (!original?.resourceRef) throw new PhotographStorageError("RESOURCE_MISSING", "Référence de l’original absente");
    return { kind: "original", resourceRef: original.resourceRef, expectedSha256: original.sha256 || null, integrity: original.sha256 ? "verify" : "unverified" };
  }
  if (photograph.preview?.resourceRef) {
    return { kind: "preview", resourceRef: photograph.preview.resourceRef, expectedSha256: photograph.preview.sha256 || null, integrity: photograph.preview.sha256 ? "verify" : "unverified" };
  }
  if (photograph.original?.resourceRef) {
    return { kind: "original", resourceRef: photograph.original.resourceRef, expectedSha256: photograph.original.sha256 || null, integrity: photograph.original.sha256 ? "verify" : "unverified" };
  }
  throw new PhotographStorageError("RESOURCE_MISSING", "Aucune ressource consultable n’est référencée");
}

export function getDocumentPagesInDisplayOrder(document) {
  if (!Array.isArray(document?.pages)) return [];
  return [...document.pages].sort((left, right) => left.order - right.order);
}

export function getPagePhotographs(document, pageId) {
  const page = document?.pages?.find(item => item.id === pageId);
  if (!page) throw new PhotographStorageError("RESOURCE_MISSING", "Page introuvable dans le document");
  return Array.isArray(page.photographs) ? [...page.photographs] : [];
}

export async function loadPhotographResource(storage, photograph, { useOriginal = false } = {}) {
  const selection = selectPhotographResource(photograph, { useOriginal });
  if (!storage || typeof storage.readOriginal !== "function" || typeof storage.readPreview !== "function") {
    throw new PhotographStorageError("STORAGE_UNAVAILABLE", "L’adaptateur de stockage ne fournit pas les opérations de lecture attendues");
  }
  const blob = selection.kind === "original"
    ? await storage.readOriginal(selection.resourceRef, selection.expectedSha256 || undefined)
    : await storage.readPreview(selection.resourceRef, selection.expectedSha256 || undefined);
  return { ...selection, blob, mimeType: blob.type || "application/octet-stream" };
}

/** Manifeste de références et empreintes ; ne lit ni n'embarque les blobs. */
export function createPhotographAssetManifest(documents) {
  if (!Array.isArray(documents)) throw new PhotographStorageError("INVALID_METADATA", "documents doit être un tableau");
  const assets = [];
  for (const document of documents) {
    for (const page of document?.pages || []) {
      for (const photograph of page?.photographs || []) {
        const original = photograph?.original;
        if (!original || !SHA256_HEX.test(original.sha256) || !Number.isSafeInteger(original.sizeBytes)
          || typeof original.resourceRef !== "string" || !original.resourceRef) {
          throw new PhotographStorageError("INVALID_METADATA", "Une photographie ne possède pas les métadonnées d’intégrité requises pour l’export");
        }
        const identityPath = [document.id, page.id, photograph.id].map((value, index) => pathPart(value, ["document.id", "page.id", "photograph.id"][index]));
        const base = `assets/${identityPath.join("/")}`;
        assets.push({
          documentId: document.id,
          pageId: page.id,
          photographId: photograph.id,
          role: photograph.role,
          rendition: "original",
          resourceRef: original.resourceRef,
          backupEntry: `${base}/original`,
          fileName: original.originalFileName,
          mimeType: original.mimeType,
          sizeBytes: original.sizeBytes,
          sha256: original.sha256.toLowerCase(),
          importedAt: original.importedAt ?? null
        });
        if (photograph.preview) {
          const preview = photograph.preview;
          if (typeof preview.resourceRef !== "string" || !preview.resourceRef || !SHA256_HEX.test(preview.sha256)
            || !Number.isSafeInteger(preview.sizeBytes)) {
            throw new PhotographStorageError("INVALID_METADATA", "L’aperçu ne possède pas les métadonnées d’intégrité requises pour l’export");
          }
          assets.push({
            documentId: document.id,
            pageId: page.id,
            photographId: photograph.id,
            role: photograph.role,
            rendition: "preview",
            resourceRef: preview.resourceRef,
            backupEntry: `${base}/previews/${pathPart(preview.resourceRef.split("/").at(-1), "previewId")}`,
            mimeType: preview.mimeType,
            sizeBytes: preview.sizeBytes,
            width: preview.width ?? null,
            height: preview.height ?? null,
            sha256: preview.sha256.toLowerCase(),
            derivedFromSha256: original.sha256.toLowerCase()
          });
        }
      }
    }
  }
  return { format: "la-nostra-storia-photograph-assets", version: 1, assets };
}
