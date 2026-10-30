/* Persistance locale des brouillons de l'atelier de transcription
   (lot 2B.2, incrément 1).

   Adaptateur dédié : ni DOM, ni Firebase, ni logique métier. Le stockage est
   injecté (localStorage côté application, substitut mémoire côté tests).
   Chaque brouillon est identifié par documentId + pageId ; chaque écriture
   porte un horodatage savedAt qui interdit d'écraser silencieusement une
   version plus récente déjà présente.

   localStorage n'est PAS une sauvegarde synchronisée entre appareils : la
   publication officielle des transcriptions reste un mécanisme distinct,
   raccordé dans un incrément ultérieur. */

export const TRANSCRIPTION_DRAFT_STORAGE_PREFIX = "familyTreeTranscriptionDraft:";
export const TRANSCRIPTION_DRAFT_STORAGE_VERSION = 1;

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} doit être une chaîne non vide`);
  return value;
}

/** Clé de stockage isolée par document et par page. */
export function transcriptionDraftStorageKey(documentId, pageId) {
  requireNonEmptyString(documentId, "documentId");
  requireNonEmptyString(pageId, "pageId");
  return `${TRANSCRIPTION_DRAFT_STORAGE_PREFIX}${documentId}|${pageId}`;
}

/** Sérialise uniquement les données utiles à la reprise (textes, traductions,
    hypothèses, ancres, passages créés et sélection), jamais l'état d'interface. */
export function buildTranscriptionDraftRecord(draft, savedAt) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new TypeError("draft doit être un objet brouillon");
  requireNonEmptyString(draft.documentId, "draft.documentId");
  requireNonEmptyString(draft.pageId, "draft.pageId");
  requireNonEmptyString(savedAt, "savedAt");
  return {
    v: TRANSCRIPTION_DRAFT_STORAGE_VERSION,
    documentId: draft.documentId,
    pageId: draft.pageId,
    savedAt,
    snapshot: {
      documentId: draft.documentId,
      pageId: draft.pageId,
      original: draft.original,
      passages: draft.passages,
      createdIds: draft.createdIds,
      selectedPassageId: draft.selectedPassageId
    }
  };
}

export function serializeTranscriptionDraftRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError("record doit être un objet");
  return JSON.stringify(record);
}

/** Enregistrement valide et apparié aux identifiants attendus, sinon null.
    Un contenu corrompu, d'une autre version ou d'une autre fiche est rejeté —
    jamais interprété comme le brouillon de la page demandée. */
export function parseTranscriptionDraftRecord(raw, { documentId, pageId }) {
  if (typeof raw !== "string" || !raw) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  if (record.v !== TRANSCRIPTION_DRAFT_STORAGE_VERSION) return null;
  if (record.documentId !== documentId || record.pageId !== pageId) return null;
  if (typeof record.savedAt !== "string" || Number.isNaN(Date.parse(record.savedAt))) return null;
  const snapshot = record.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  if (snapshot.documentId !== documentId || snapshot.pageId !== pageId) return null;
  if (!Array.isArray(snapshot.original) || !Array.isArray(snapshot.passages)) return null;
  if (!Array.isArray(snapshot.createdIds)) return null;
  if (snapshot.selectedPassageId != null && typeof snapshot.selectedPassageId !== "string") return null;
  return record;
}

/** Lit le brouillon local d'une page. Un contenu corrompu est retiré du
    stockage (best effort) et rendu jamais lu ; une indisponibilité du
    stockage rend simplement null, sans effet de bord. */
export function readTranscriptionDraft(storage, documentId, pageId) {
  const key = transcriptionDraftStorageKey(documentId, pageId);
  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw == null) return null;
  const record = parseTranscriptionDraftRecord(raw, { documentId, pageId });
  if (!record) {
    try {
      storage.removeItem(key);
    } catch {
      /* Stockage indisponible : la donnée illisible n'est pas réessayée. */
    }
    return null;
  }
  return { record, raw };
}

/** Écrit l'enregistrement. Toute erreur (quota, stockage indisponible)
    remonte à l'appelant : aucun remplacement partiel n'est possible. */
export function writeTranscriptionDraft(storage, documentId, pageId, record) {
  const key = transcriptionDraftStorageKey(documentId, pageId);
  const raw = serializeTranscriptionDraftRecord(record);
  storage.setItem(key, raw);
  return raw;
}

export function removeTranscriptionDraft(storage, documentId, pageId) {
  storage.removeItem(transcriptionDraftStorageKey(documentId, pageId));
}

/** Raison d'interdire une écriture :
    - "newer" : un enregistrement plus récent que la dernière version connue de
      cette session existe déjà (autre onglet) — ne jamais l'écraser ;
    - "unknown-baseline" : un enregistrement existe alors que cette session n'a
      aucune référence d'horodatage — contenu d'origine inconnue, refusé aussi.
    null = écriture autorisée. */
export function transcriptionDraftWriteBlockReason(storage, documentId, pageId, baselineSavedAt) {
  const stored = readTranscriptionDraft(storage, documentId, pageId);
  if (!stored) return null;
  if (typeof baselineSavedAt !== "string" || !baselineSavedAt) return "unknown-baseline";
  return stored.record.savedAt > baselineSavedAt ? "newer" : null;
}
