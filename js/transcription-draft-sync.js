/* Synchronisation des brouillons de transcription entre appareils
   (lot 2B.2, incrément 2) — couche PURE.

   Ni DOM, ni Firebase, ni stockage : ce module fournit les chemins, les
   payloads, la comparaison de versions et les décisions de réconciliation ;
   l'accès distant (Firestore côté production, substitut injecté côté tests)
   reste du côté de l'application.

   Garanties portées ici :
   - une date récente ne JAMAIS autoriser d'écrasement : seules les versions
     (comparaison atomique côté base) décident ;
   - aucun contenu n'est fusionné ni effacé silencieusement : divergences et
     bases inconnues deviennent un « conflict » à choix explicite ;
   - la suppression distante n'est planifiée qu'avec une version de référence
     connue (jamais de purge à l'aveugle). */

export const TRANSCRIPTION_DRAFT_REMOTE_COLLECTION = "transcriptionDrafts";
export const TRANSCRIPTION_DRAFT_REMOTE_VERSION = 1;
/* Synchronisation distante différée : jamais à chaque frappe. */
export const TRANSCRIPTION_DRAFT_SYNC_DELAY_MS = 5000;

export const TRANSCRIPTION_DRAFT_SYNC_LABELS = Object.freeze({
  syncing: "Synchronisation en cours…",
  synced: "Synchronisé entre appareils",
  offline: "Synchronisation impossible",
  conflict: "Conflit à résoudre"
});

export const TRANSCRIPTION_DRAFT_CONFLICT_LABELS = Object.freeze({
  local: "Version de cet appareil",
  remote: "Version distante",
  keepLocal: "Conserver la version de cet appareil",
  keepRemote: "Conserver la version distante"
});

function requireSegment(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} doit être une chaîne non vide`);
  if (value.includes("/")) throw new TypeError(`${label} ne doit contenir ni « / »`);
  return value;
}

/** Identifiants validés (propriétaire, document, page) — rejet d'une cible
    incomplète avant toute lecture ou écriture distante. */
export function validateTranscriptionDraftTarget({ ownerUid, documentId, pageId } = {}) {
  return {
    ownerUid: requireSegment(ownerUid, "ownerUid"),
    documentId: requireSegment(documentId, "documentId"),
    pageId: requireSegment(pageId, "pageId")
  };
}

/** Clé d'horodatage de stockage : segments encodés, jamais de collision de
    séparateur (utilisée par le substitut de test, jamais par Firestore). */
export function transcriptionDraftRemoteKey(target) {
  const validated = validateTranscriptionDraftTarget(target);
  return [
    TRANSCRIPTION_DRAFT_REMOTE_COLLECTION,
    validated.ownerUid,
    validated.documentId,
    validated.pageId
  ].map(segment => encodeURIComponent(segment)).join("|");
}

export function transcriptionDraftNowIso() {
  return new Date().toISOString();
}

/** Comparaison profonde des snapshots : indépendante de l'ordre des clés
    (les maps Firestore ne garantissent aucun ordre). */
export function transcriptionDraftSnapshotsEqual(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => transcriptionDraftSnapshotsEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key)
    && transcriptionDraftSnapshotsEqual(left[key], right[key]));
}

function isValidSnapshotShape(snapshot, documentId, pageId) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  if (snapshot.documentId !== documentId || snapshot.pageId !== pageId) return false;
  if (!Array.isArray(snapshot.original) || !Array.isArray(snapshot.passages) || !Array.isArray(snapshot.createdIds)) return false;
  if (snapshot.selectedPassageId != null && typeof snapshot.selectedPassageId !== "string") return false;
  return true;
}

/** Snapshot destiné à la synchronisation : le contenu du brouillon actuel
    uniquement (jamais l'état d'interface), null si le brouillon est propre. */
export function transcriptionDraftSnapshotFromDraft(draft) {
  if (!draft || typeof draft !== "object") throw new TypeError("draft doit être un objet brouillon");
  if (!draft.dirty) return null;
  return JSON.parse(JSON.stringify({
    documentId: draft.documentId,
    pageId: draft.pageId,
    original: draft.original,
    passages: draft.passages,
    createdIds: draft.createdIds,
    selectedPassageId: draft.selectedPassageId ?? null
  }));
}

/** Charge un document distant : normalisé, sinon null (structure inattendue
    jamais interprétée comme un brouillon). */
export function parseTranscriptionDraftRemoteData(data, { documentId, pageId, ownerUid }) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data.ownerUid !== ownerUid) return null;
  if (data.documentId !== documentId || data.pageId !== pageId) return null;
  if (!Number.isSafeInteger(data.version) || data.version < TRANSCRIPTION_DRAFT_REMOTE_VERSION) return null;
  if (typeof data.createdAt !== "string" || typeof data.updatedAt !== "string") return null;
  if (typeof data.updatedBy !== "string" || !data.updatedBy) return null;
  if (!isValidSnapshotShape(data.snapshot, documentId, pageId)) return null;
  return {
    ownerUid: data.ownerUid,
    documentId: data.documentId,
    pageId: data.pageId,
    version: data.version,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy,
    snapshot: data.snapshot
  };
}

/** Construit le payload distant à écrire (create ou update). */
export function buildTranscriptionDraftRemotePayload({ target, snapshot, version, createdAt, updatedAt }) {
  const validated = validateTranscriptionDraftTarget(target);
  if (!isValidSnapshotShape(snapshot, validated.documentId, validated.pageId)) {
    throw new TypeError("snapshot invalide pour cette cible");
  }
  if (!Number.isSafeInteger(version) || version < TRANSCRIPTION_DRAFT_REMOTE_VERSION) throw new TypeError("version invalide");
  if (typeof createdAt !== "string" || !createdAt) throw new TypeError("createdAt invalide");
  if (typeof updatedAt !== "string" || !updatedAt) throw new TypeError("updatedAt invalide");
  return {
    ownerUid: validated.ownerUid,
    documentId: validated.documentId,
    pageId: validated.pageId,
    snapshot: JSON.parse(JSON.stringify(snapshot)),
    version,
    createdAt,
    updatedAt,
    updatedBy: validated.ownerUid
  };
}

/** Réconciliation à l'ouverture de l'atelier (lecture ponctuelle du distant).
    - "none"    : rien à faire ;
    - "push"    : aucun distant ET aucune référence connue : migration du local ;
    - "restore" : distant sans local : charger sa version ;
    - "confirm" : contenus identiques : seule la version de référence change ;
    - "conflict": divergences OU suppression distante d'une version connue :
      jamais republiée silencieusement, choix explicite requis. */
export function reconcileTranscriptionDraftOnOpen({ localSnapshot = null, remote = null, baseVersion = null } = {}) {
  if (!remote) {
    if (!localSnapshot) return { operation: "none" };
    if (baseVersion != null) return { operation: "conflict" };
    return { operation: "push" };
  }
  if (!localSnapshot) return { operation: "restore" };
  if (transcriptionDraftSnapshotsEqual(remote.snapshot, localSnapshot)) return { operation: "confirm" };
  return { operation: "conflict" };
}

/** Plan d'une écriture distante, contre l'état observé de la base.
    Aucune base inconnue ni version dépassée ne donne un écrasement :
    - "create" / "update" : versions strictement croissantes (vérifiées aussi
      côté Firestore) — create seulement sans aucune référence connue ;
    - "adopt"  : le distant porte déjà ce contenu : seule la référence bouge ;
    - "delete" : nettoyage explicite SANS perte (version de référence connue) ;
    - "conflict": divergences, base inconnue, version dépassée OU suppression
      distante d'une version connue — jamais écrit ;
    - "none"   : rien à écrire. */
export function planTranscriptionDraftWrite({ localSnapshot = null, remote = null, baseVersion = null } = {}) {
  if (localSnapshot == null) {
    if (!remote) return { operation: "none" };
    if (baseVersion == null) return { operation: "none" };
    if (remote.version === baseVersion) return { operation: "delete" };
    return { operation: "conflict" };
  }
  if (!remote) {
    /* Version connue mais distante absent : suppression observée à distance —
       jamais republiée silencieusement. base remise à null = choix explicite
       de l'utilisateur de recréer (première publication = base inconnue). */
    if (baseVersion != null) return { operation: "conflict" };
    return { operation: "create", version: TRANSCRIPTION_DRAFT_REMOTE_VERSION };
  }
  if (baseVersion != null && remote.version === baseVersion) return { operation: "update", version: baseVersion + 1 };
  if (transcriptionDraftSnapshotsEqual(remote.snapshot, localSnapshot)) return { operation: "adopt", version: remote.version };
  return { operation: "conflict" };
}

/** Aperçu textuel des deux côtés d'un conflit (jamais de fusion) : passages,
    traductions et ancres du brouillon, tronqués pour la comparaison. */
export function transcriptionDraftSnapshotPreview(snapshot, { maxChars = 4000 } = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "";
  const passages = Array.isArray(snapshot.passages) ? snapshot.passages : [];
  const parts = passages.map((passage, index) => {
    const label = passage?.lineLabel ? `Passage ${index + 1} (${passage.lineLabel})` : `Passage ${index + 1}`;
    const text = typeof passage?.textIt === "string" && passage.textIt.trim() ? passage.textIt : "(vide)";
    const translation = typeof passage?.translationFr === "string" && passage.translationFr.trim()
      ? `\nTraduction : ${passage.translationFr}` : "";
    return `${label} : ${text}${translation}`;
  });
  const preview = parts.length ? parts.join("\n\n") : "(aucun passage)";
  return preview.length > maxChars ? `${preview.slice(0, maxChars)}…` : preview;
}
