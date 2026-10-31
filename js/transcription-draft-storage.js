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

/* Propriétaire d'un brouillon local. Sans propriétaire (null) : clé HÉRITÉE,
   écrite avant la synchronisation entre appareils ou en session sans compte —
   jamais attribuée automatiquement à un compte connecté, jamais lue par un
   compte (reprise explicite seulement, côté application). Avec propriétaire :
   clé privée du compte, les autres comptes ni lisent ni n'écrivent. */
function requireOwnerUid(ownerUid) {
  requireNonEmptyString(ownerUid, "ownerUid");
  return ownerUid;
}

/** Clé de stockage isolée par propriétaire, document et page :
    `…:{uid encodé}|document|page` ; sans propriétaire, la clé historique
    `…:document|page` est conservée à l'identique (compatibilité, aucun déplacement
    automatique des brouillons existants). */
export function transcriptionDraftStorageKey(documentId, pageId, ownerUid = null) {
  requireNonEmptyString(documentId, "documentId");
  requireNonEmptyString(pageId, "pageId");
  if (ownerUid == null) return `${TRANSCRIPTION_DRAFT_STORAGE_PREFIX}${documentId}|${pageId}`;
  return `${TRANSCRIPTION_DRAFT_STORAGE_PREFIX}${encodeURIComponent(requireOwnerUid(ownerUid))}|${documentId}|${pageId}`;
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
  /* Champ d'interface non bloquant : un selectedPassageId hétérogène est
     rabattu à null ici puis réconcilié par la restauration — il ne motive
     jamais le rejet de tout l'enregistrement. */
  if (snapshot.selectedPassageId != null && typeof snapshot.selectedPassageId !== "string") {
    record = { ...record, snapshot: { ...snapshot, selectedPassageId: null } };
  }
  return record;
}

/** Lit le brouillon local d'une page.
    - `null` : aucune donnée (ou stockage indisponible) ;
    - `{ record, raw }` : enregistrement valide ;
    - `{ record: null, raw }` : enregistrement présent mais illisible.
    LA LECTURE NE SUPPRIME JAMAIS rien : la destruction automatique d'un
    brouillon sur un échec de lecture ou de restauration est interdite — seul
    un abandon explicite de l'utilisateur retire une donnée. */
export function readTranscriptionDraft(storage, documentId, pageId, ownerUid = null) {
  const key = transcriptionDraftStorageKey(documentId, pageId, ownerUid);
  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw == null) return null;
  const record = parseTranscriptionDraftRecord(raw, { documentId, pageId });
  if (!record) return { record: null, raw };
  return { record, raw };
}

/** Écrit l'enregistrement. Toute erreur (quota, stockage indisponible)
    remonte à l'appelant : aucun remplacement partiel n'est possible. */
export function writeTranscriptionDraft(storage, documentId, pageId, record, ownerUid = null) {
  const key = transcriptionDraftStorageKey(documentId, pageId, ownerUid);
  const raw = serializeTranscriptionDraftRecord(record);
  storage.setItem(key, raw);
  return raw;
}

/** Retrait limité à l'espace du propriétaire indiqué : un brouillon d'un autre
    compte (ou hérité sans propriétaire) n'est jamais touché. */
export function removeTranscriptionDraft(storage, documentId, pageId, ownerUid = null) {
  storage.removeItem(transcriptionDraftStorageKey(documentId, pageId, ownerUid));
}

/** Raison d'interdire une écriture :
    - "newer" : un enregistrement plus récent que la dernière version connue de
      cette session existe déjà (autre onglet) — ne jamais l'écraser ;
    - "unknown-baseline" : un enregistrement existe alors que cette session n'a
      aucune référence d'horodatage — contenu d'origine inconnue, refusé aussi ;
    - "unreadable" : un enregistrement présent est illisible — réécrire le
      ferait disparaître son contenu : refusé aussi, il reste en local.
    null = écriture autorisée. */
export function transcriptionDraftWriteBlockReason(storage, documentId, pageId, baselineSavedAt, ownerUid = null) {
  const stored = readTranscriptionDraft(storage, documentId, pageId, ownerUid);
  if (!stored) return null;
  if (!stored.record) return "unreadable";
  if (typeof baselineSavedAt !== "string" || !baselineSavedAt) return "unknown-baseline";
  return stored.record.savedAt > baselineSavedAt ? "newer" : null;
}
