/* Atelier de transcription (lots 2B.1 / 2B.2) — logique pure des brouillons
   locaux. Aucun accès DOM, Firebase, réseau ou stockage : la persistance
   locale d'un brouillon est portée par l'application, qui fournit ici un
   snapshot à revalider (restoreTranscriptionWorkshopDraft). Les corrections
   produites dans ce module ne constituent pas une sauvegarde synchronisée ni
   une publication : ce module n'écrit dans aucune collection officielle
   (transcriptionHeads, transcriptionRevisions, genealogyProofs,
   factConclusions) et ne crée aucune révision.

   Exception encadrée : la préparation d'une initialisation de page JPEG
   ci-dessous construit seulement un futur objet de révision — l'écriture
   reste du côté de l'application, après validation explicite de l'utilisateur
   et par le canal admin existant (reviseOfficial). */

import { createPageTextRevision, comparePageTextRevisions, createTranscriptionPassage, validateTranscriptionPassage } from "./document-transcription.js";
import { addDocumentPage, addPhotographsToPage, validateSourceDocument } from "./source-document-model.js";

export const WORKSHOP_TRANSLATION_STATE_LABELS = Object.freeze({
  "not-started": "Traduction non commencée",
  current: "Traduction à jour",
  "needs-review": "Traduction à revoir"
});

export const WORKSHOP_CONFIDENCE_LABELS = Object.freeze({
  high: "Confiance élevée",
  medium: "Confiance moyenne",
  low: "Confiance faible",
  unknown: "Confiance non précisée"
});

function clonePassage(passage) {
  const copy = { ...passage, hypotheses: (passage.hypotheses || []).map(hypothesis => ({ ...hypothesis })) };
  if (passage.anchor) copy.anchor = { ...passage.anchor };
  return copy;
}

function clonePassages(passages = []) {
  return passages
    .filter(passage => passage && typeof passage === "object")
    .map(clonePassage)
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0));
}

function semanticText(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
}

function samePassageText(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/* Compare les passages modifiés sans dépendre de la validité des données
   officielles : la voie officielle (révisions figées) sert de référence, avec
   un repli textuel si un passage existant échoue à la validation du modèle. */
function computeTranslationReview(draft) {
  if (!draft.original.length) return [];
  try {
    const before = createPageTextRevision({
      id: "workshop-comparison-before",
      documentId: draft.documentId,
      pageId: draft.pageId,
      passages: draft.original
    });
    const after = createPageTextRevision({
      id: "workshop-comparison-after",
      documentId: draft.documentId,
      pageId: draft.pageId,
      passages: draft.passages
    });
    return comparePageTextRevisions(before, after).passagesWithTranslationToReview;
  } catch {
    return draft.passages.filter(passage => {
      const before = draft.original.find(item => item.id === passage.id);
      if (!before) return false;
      const italianChanged = semanticText(before.textIt) !== semanticText(passage.textIt);
      const translationUnchanged = semanticText(before.translationFr) === semanticText(passage.translationFr);
      const hasTranslation = before.translationFr != null || passage.translationFr != null;
      return italianChanged && translationUnchanged && hasTranslation;
    }).map(passage => passage.id);
  }
}

function recomputeDraftState(draft) {
  draft.translationReview = computeTranslationReview(draft);
  draft.dirty = draft.passages.length !== draft.original.length
    || draft.passages.some((passage, index) => !samePassageText(passage, draft.original[index]));
}

export function createTranscriptionWorkshopDraft({ documentId, pageId, passages = [] } = {}) {
  if (typeof documentId !== "string" || !documentId.trim()) throw new TypeError("workshop.documentId doit être une chaîne non vide");
  if (typeof pageId !== "string" || !pageId.trim()) throw new TypeError("workshop.pageId doit être une chaîne non vide");
  if (!Array.isArray(passages)) throw new TypeError("workshop.passages doit être un tableau");
  const original = clonePassages(passages);
  const draft = {
    documentId,
    pageId,
    original,
    passages: clonePassages(original),
    createdIds: [],
    selectedPassageId: original[0]?.id || null,
    dirty: false,
    translationReview: []
  };
  recomputeDraftState(draft);
  return draft;
}

/* Reprend un brouillon sauvegardé localement (lot 2B.2) : le snapshot est
   reconstruit, revalidé et les indicateurs (dirty, traduction à revoir)
   recalculés — l'état stocké n'est jamais tellement cru.

   La restauration RÉPARE au lieu d'abandonner : un identifiant absent, vide ou
   dupliqué (données officielles hétérogènes, anciennes sources ou imports)
   reçoit un identifiant local stable, et un passage créé disparu des
   déclarations est reclassé dans les passages créés. Aucun contenu n'est
   jamais écarté : seule une structure de base absente (snapshot non objet,
   identifiants de document ou de page manquants) lève une erreur —
   l'application conserve alors le record en local sans l'effacer. */

const RESTORED_PASSAGE_ID_PREFIX = "restored-passage-";

function isUsablePassageId(value) {
  return typeof value === "string" && Boolean(value.trim());
}

/** Conserve un identifiant sain non encore pris ; sinon attribue le suivant
    libre du préfixe local, sans jamais rejeter l'entrée. */
function reservePassageId(candidate, usedIds) {
  if (isUsablePassageId(candidate) && !usedIds.has(candidate)) {
    usedIds.add(candidate);
    return candidate;
  }
  let index = 0;
  let reserved = `${RESTORED_PASSAGE_ID_PREFIX}${++index}`;
  while (usedIds.has(reserved)) reserved = `${RESTORED_PASSAGE_ID_PREFIX}${++index}`;
  usedIds.add(reserved);
  return reserved;
}

export function restoreTranscriptionWorkshopDraft(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new TypeError("workshop.snapshot doit être un objet");
  if (typeof snapshot.documentId !== "string" || !snapshot.documentId.trim()) throw new TypeError("workshop.snapshot.documentId doit être une chaîne non vide");
  if (typeof snapshot.pageId !== "string" || !snapshot.pageId.trim()) throw new TypeError("workshop.snapshot.pageId doit être une chaîne non vide");
  if (!Array.isArray(snapshot.original)) throw new TypeError("workshop.snapshot.original doit être un tableau");
  if (!Array.isArray(snapshot.passages)) throw new TypeError("workshop.snapshot.passages doit être un tableau");
  if (!Array.isArray(snapshot.createdIds)) throw new TypeError("workshop.snapshot.createdIds doit être un tableau");

  /* Réparation de l'original : chaque entrée devient un passage exploitable,
     les identifiants invalides étant mappés (valeur brute → identifiant
     réparé) pour être appliqués à l'identique côté passages. */
  const originalEntries = snapshot.original.filter(passage => passage && typeof passage === "object");
  const usedOriginalIds = new Set();
  const repairedOriginalIds = new Map();
  const original = originalEntries.map(passage => {
    const rawKey = JSON.stringify(passage.id ?? null);
    const id = reservePassageId(passage.id, usedOriginalIds);
    if (!isUsablePassageId(passage.id)) repairedOriginalIds.set(rawKey, id);
    return { ...clonePassage(passage), id };
  });
  const originalIds = new Set(original.map(passage => passage.id));

  /* Alignement des passages : sains conservés, réparations de l'original
     appliquées à l'entrée correspondante, tout le reste reçoit un identifiant
     local et se retrouve, par différence, dans les passages créés. */
  const usedPassageIds = new Set();
  const passages = snapshot.passages.filter(passage => passage && typeof passage === "object").map(passage => {
    const rawKey = JSON.stringify(passage.id ?? null);
    let id = null;
    const repairedId = repairedOriginalIds.get(rawKey);
    if (repairedId && !usedPassageIds.has(repairedId)) id = repairedId;
    else if (isUsablePassageId(passage.id) && !usedPassageIds.has(passage.id)) id = passage.id;
    if (id == null) id = reservePassageId(null, usedPassageIds);
    else usedPassageIds.add(id);
    return { ...clonePassage(passage), id };
  });
  const createdIds = passages.filter(passage => !originalIds.has(passage.id)).map(passage => passage.id);

  let selectedPassageId = snapshot.selectedPassageId ?? null;
  if (selectedPassageId != null && !passages.some(passage => passage.id === selectedPassageId)) {
    const repairedSelection = repairedOriginalIds.get(JSON.stringify(selectedPassageId));
    selectedPassageId = (repairedSelection && passages.some(passage => passage.id === repairedSelection))
      ? repairedSelection
      : passages[0]?.id ?? null;
  }
  const draft = {
    documentId: snapshot.documentId,
    pageId: snapshot.pageId,
    original,
    passages,
    createdIds,
    selectedPassageId,
    dirty: false,
    translationReview: []
  };
  recomputeDraftState(draft);
  return draft;
}

export function selectTranscriptionWorkshopPassage(draft, passageId) {
  if (!draft || typeof draft !== "object") throw new TypeError("Le brouillon d’atelier est requis");
  if (passageId == null) {
    draft.selectedPassageId = null;
    return draft;
  }
  if (!draft.passages.some(passage => passage.id === passageId)) throw new Error("Passage introuvable dans le brouillon");
  draft.selectedPassageId = passageId;
  return draft;
}

export function editTranscriptionWorkshopPassage(draft, passageId, { textIt, translationFr } = {}) {
  if (!draft || typeof draft !== "object") throw new TypeError("Le brouillon d’atelier est requis");
  const passage = draft.passages.find(item => item.id === passageId);
  if (!passage) throw new Error("Passage introuvable dans le brouillon");
  if (textIt !== undefined) {
    if (typeof textIt !== "string") throw new TypeError("textIt doit être une chaîne");
    passage.textIt = textIt;
  }
  if (translationFr !== undefined) {
    if (translationFr !== null && typeof translationFr !== "string") throw new TypeError("translationFr doit être une chaîne ou null");
    const cleared = translationFr == null || translationFr === "";
    passage.translationFr = cleared ? null : translationFr;
    if (cleared) {
      /* Effacer la traduction restaure l'état d'ouverture : la comparaison de
         révision ne voit pas de faux changement quand on revient exactement au
         texte initial (null + « non commencée »). */
      passage.translationState = draft.original.find(item => item.id === passageId)?.translationState || "not-started";
    } else if (passage.translationState === "not-started") {
      passage.translationState = "current";
    }
  }
  recomputeDraftState(draft);
  return draft;
}

/* Ajoute un passage au brouillon (page vide ou déjà transcrite). L'identifiant
   est fourni par l'appelant, conformément à document-transcription.js ; la
   validation du modèle est réutilisée telle quelle. */
export function addTranscriptionWorkshopPassage(draft, { id, textIt = "", translationFr = null, lineLabel = "" } = {}) {
  if (!draft || typeof draft !== "object") throw new TypeError("Le brouillon d’atelier est requis");
  if (typeof id !== "string" || !id.trim()) throw new TypeError("passage.id doit être une chaîne non vide");
  if (draft.passages.some(passage => passage.id === id)) throw new Error("Cet identifiant de passage existe déjà dans le brouillon");
  if (typeof textIt !== "string") throw new TypeError("textIt doit être une chaîne");
  if (translationFr !== null && typeof translationFr !== "string") throw new TypeError("translationFr doit être une chaîne ou null");
  if (typeof lineLabel !== "string") throw new TypeError("lineLabel doit être une chaîne");
  const order = draft.passages.length
    ? Math.max(...draft.passages.map(passage => Number(passage.order) || 0)) + 1
    : 0;
  const passage = createTranscriptionPassage({ id, order, textIt, translationFr, lineLabel, hypotheses: [], anchor: null });
  draft.passages.push(passage);
  draft.createdIds.push(id);
  if (!draft.selectedPassageId) draft.selectedPassageId = id;
  recomputeDraftState(draft);
  return draft;
}

/* Supprime un passage de la copie de travail uniquement. L'original reste
   intact pour comparaison, abandon et historique ; la suppression d'un
   passage hérité devient une simple différence de révision, jamais un effacement
   de l'officiel. */
export function removeTranscriptionWorkshopPassage(draft, passageId) {
  if (!draft || typeof draft !== "object") throw new TypeError("Le brouillon d’atelier est requis");
  if (typeof passageId !== "string" || !passageId.trim()) throw new TypeError("passageId doit être une chaîne non vide");
  const removedIndex = draft.passages.findIndex(passage => passage.id === passageId);
  if (removedIndex < 0) throw new Error("Passage introuvable dans le brouillon");
  draft.passages = draft.passages.filter(passage => passage.id !== passageId);
  draft.createdIds = draft.createdIds.filter(id => id !== passageId);
  if (draft.selectedPassageId === passageId) {
    draft.selectedPassageId = draft.passages[Math.min(removedIndex, draft.passages.length - 1)]?.id || null;
  }
  recomputeDraftState(draft);
  return draft;
}

export function isTranscriptionWorkshopPassageCreated(draft, passageId) {
  return Boolean(draft?.createdIds?.includes(passageId));
}

export function resetTranscriptionWorkshopDraft(draft) {
  if (!draft || typeof draft !== "object") throw new TypeError("Le brouillon d’atelier est requis");
  draft.passages = clonePassages(draft.original);
  draft.createdIds = [];
  const stillExists = draft.passages.some(passage => passage.id === draft.selectedPassageId);
  if (!stillExists) draft.selectedPassageId = draft.passages[0]?.id || null;
  recomputeDraftState(draft);
  return draft;
}

export function isTranscriptionWorkshopPassageChanged(draft, passageId) {
  if (!draft) return false;
  const passage = draft.passages.find(item => item.id === passageId);
  const before = draft.original.find(item => item.id === passageId);
  if (!passage || !before) return false;
  return !samePassageText(passage, before);
}

/* ---- B1 : zones graphiques des passages (JPEG) ----------------------------
   Modèle existant strictement réutilisé : { shape: "rect", photographId, x,
   y, width, height } en coordonnées normalisées 0..1, une zone par passage.
   Les helpers de géométrie sont purs (testables sans DOM) ; l'écriture passe
   par setTranscriptionWorkshopPassageAnchor, qui valide avec le modèle de
   document-transcription (coordonnées, taille positive, limites et photo de
   LA page) avant de toucher au brouillon. Aucune écriture hors brouillon. */

export const WORKSHOP_ZONE_MIN_SIZE = 0.015;

function zonePoint(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

/** Ramène un rectangle dans l'image avec une taille minimale garantie. */
export function clampWorkshopZoneRect(rect) {
  if (!rect || typeof rect !== "object") throw new TypeError("Le rectangle de zone est requis");
  const min = WORKSHOP_ZONE_MIN_SIZE;
  let width = Math.max(min, Math.min(1, Number(rect.width) || 0));
  let height = Math.max(min, Math.min(1, Number(rect.height) || 0));
  let x = zonePoint(rect.x);
  let y = zonePoint(rect.y);
  x = Math.min(x, 1 - width);
  y = Math.min(y, 1 - height);
  return { x, y, width, height };
}

/** Rectangle tracé entre deux points normalisés (cliquer-glisser). */
export function workshopZoneRectFromDrag(start, current) {
  const from = { x: zonePoint(start?.x), y: zonePoint(start?.y) };
  const to = { x: zonePoint(current?.x), y: zonePoint(current?.y) };
  return clampWorkshopZoneRect({
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y)
  });
}

/** Déplacement borné : le rectangle ne sort jamais de l'image. */
export function workshopZoneMoveRect(rect, dx, dy) {
  const base = clampWorkshopZoneRect(rect);
  return clampWorkshopZoneRect({
    x: base.x + (Number(dx) || 0),
    y: base.y + (Number(dy) || 0),
    width: base.width,
    height: base.height
  });
}

/** Redimensionnement par poignée (nw|ne|sw|se), taille minimale garantie. */
export function workshopZoneResizeRect(rect, handle, dx, dy) {
  const base = clampWorkshopZoneRect(rect);
  const deltaX = Number(dx) || 0;
  const deltaY = Number(dy) || 0;
  const left = base.x;
  const top = base.y;
  const right = base.x + base.width;
  const bottom = base.y + base.height;
  if (handle === "nw" || handle === "sw") {
    const nextLeft = Math.max(0, Math.min(right - WORKSHOP_ZONE_MIN_SIZE, left + deltaX));
    if (handle === "nw") {
      const nextTop = Math.max(0, Math.min(bottom - WORKSHOP_ZONE_MIN_SIZE, top + deltaY));
      return clampWorkshopZoneRect({ x: nextLeft, y: nextTop, width: right - nextLeft, height: bottom - nextTop });
    }
    const nextBottom = Math.min(1, Math.max(top + WORKSHOP_ZONE_MIN_SIZE, bottom + deltaY));
    return clampWorkshopZoneRect({ x: nextLeft, y: top, width: right - nextLeft, height: nextBottom - top });
  }
  if (handle === "ne" || handle === "se") {
    const nextRight = Math.min(1, Math.max(left + WORKSHOP_ZONE_MIN_SIZE, right + deltaX));
    if (handle === "ne") {
      const nextTop = Math.max(0, Math.min(bottom - WORKSHOP_ZONE_MIN_SIZE, top + deltaY));
      return clampWorkshopZoneRect({ x: left, y: nextTop, width: nextRight - left, height: bottom - nextTop });
    }
    const nextBottom = Math.min(1, Math.max(top + WORKSHOP_ZONE_MIN_SIZE, bottom + deltaY));
    return clampWorkshopZoneRect({ x: left, y: top, width: nextRight - left, height: nextBottom - top });
  }
  return base;
}

/** Écrit (ou supprime avec null) la zone du passage dans le brouillon.
    Aucune écriture si la validation du modèle échoue : le brouillon reste
    intact et l'erreur est levée pour être annoncée par l'application. */
export function setTranscriptionWorkshopPassageAnchor(draft, passageId, anchor, { photographIds = null } = {}) {
  if (!draft || typeof draft !== "object") throw new TypeError("Le brouillon d’atelier est requis");
  const passage = draft.passages.find(item => item.id === passageId);
  if (!passage) throw new Error("Passage introuvable dans le brouillon");
  if (anchor == null) {
    passage.anchor = null;
    recomputeDraftState(draft);
    return draft;
  }
  if (typeof anchor !== "object" || Array.isArray(anchor)) throw new TypeError("anchor doit être un rectangle ou null");
  const candidate = { ...passage, anchor: { ...anchor } };
  const validation = validateTranscriptionPassage(candidate, { photographIds });
  if (!validation.valid) throw new TypeError(validation.errors.join("; "));
  passage.anchor = { ...anchor };
  recomputeDraftState(draft);
  return draft;
}

export function transcriptionWorkshopPassagePosition(draft, passageId) {
  const passages = draft?.passages || [];
  const index = passages.findIndex(passage => passage.id === passageId);
  return {
    index,
    total: passages.length,
    previousId: index > 0 ? passages[index - 1].id : null,
    nextId: index >= 0 && index < passages.length - 1 ? passages[index + 1].id : null
  };
}

export function transcriptionWorkshopPassageLabel(passage, index) {
  const position = Number.isInteger(index) ? index : 0;
  const base = `Passage ${position + 1}`;
  const line = passage?.lineLabel ? ` · ${passage.lineLabel}` : "";
  return `${base}${line}`;
}

/** État d’affichage du bloc de traduction : revue calculée > état officiel. */
export function transcriptionWorkshopTranslationBadge(draft, passage) {
  if (draft?.translationReview?.includes(passage?.id)) return WORKSHOP_TRANSLATION_STATE_LABELS["needs-review"];
  return WORKSHOP_TRANSLATION_STATE_LABELS[passage?.translationState] || WORKSHOP_TRANSLATION_STATE_LABELS["not-started"];
}

/* ---- Page d'atelier à partir d'un JPEG existant (lot 2B.1) ----------------
   Une page officielle est réutilisée si elle existe déjà ; sinon, une
   préparation explicite est construite ici et n'est écrite qu'ensuite par
   l'application, après validation de l'utilisateur, via la révision admin
   existante. Le fichier original n'est jamais dupliqué : seule sa référence
   (legacy-document:{id}) et son empreinte sont portées par la source. */

export const LEGACY_DOCUMENT_IMAGE_PREFIX = "legacy-document:";

export function legacyDocumentResourceRef(documentId) {
  if (typeof documentId !== "string" || !documentId.trim()) throw new TypeError("documentId doit être une chaîne non vide");
  return `${LEGACY_DOCUMENT_IMAGE_PREFIX}${documentId}`;
}

export function isLegacyDocumentPhotograph(photograph, documentId = null) {
  const resourceRef = photograph?.original?.resourceRef;
  if (typeof resourceRef !== "string" || !resourceRef.startsWith(LEGACY_DOCUMENT_IMAGE_PREFIX)) return false;
  if (documentId == null) return true;
  return resourceRef === legacyDocumentResourceRef(documentId);
}

/** Périmètre lot 2B.1 : JPEG uniquement (mimeType ou extension). */
export function isTranscriptionJpegDocument(documentItem) {
  if (!documentItem || typeof documentItem !== "object" || Array.isArray(documentItem)) return false;
  const mimeType = String(documentItem.mimeType || "").trim().toLowerCase();
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return true;
  return /\.jpe?g$/i.test(String(documentItem.fileName || "").trim());
}

/** Lot B2 : document PDF (mimeType ou extension), comme le JPEG ci-dessus. */
export function isTranscriptionPdfDocument(documentItem) {
  if (!documentItem || typeof documentItem !== "object" || Array.isArray(documentItem)) return false;
  const mimeType = String(documentItem.mimeType || "").trim().toLowerCase();
  if (mimeType === "application/pdf") return true;
  return /\.pdf$/i.test(String(documentItem.fileName || "").trim());
}

/** JPEG ou PDF exploitables localement (empreinte exigée) : fichier importé
    en chunks ou encodé en data-URL — un lien distant ne l'est pas. Le PDF
    rejoint le JPEG pour l'initialisation d'une transcription (lot B2) : même
    mécanisme de page technique, même vérification d'identité du fichier. */
export function canInitializeLegacyJpegPage(documentItem) {
  if (!isTranscriptionJpegDocument(documentItem) && !isTranscriptionPdfDocument(documentItem)) return false;
  const hasChunks = Boolean(documentItem.chunkCount && documentItem.chunkVersion);
  const hasDataUrl = typeof documentItem.fileData === "string" && documentItem.fileData.startsWith("data:");
  return hasChunks || hasDataUrl;
}

/** Page officielle existante qui référence déjà le fichier du document. */
export function findSourcePageForDocument(source, documentId) {
  if (!source || typeof source !== "object" || !Array.isArray(source.pages)) return null;
  if (typeof documentId !== "string" || !documentId.trim()) return null;
  for (const page of source.pages) {
    if (!page || !Array.isArray(page.photographs)) continue;
    if (page.photographs.some(photograph => isLegacyDocumentPhotograph(photograph, documentId))) return page;
  }
  return null;
}

/* Construit la prochaine source (brouillon de révision) : une page portant une
   photographie qui référence le JPEG existant. Aucun octet du fichier n'est
   recopié ; le SHA-256 fourni atteste du contenu référencé. */
function prepareLegacyDocumentPageAssets({ pages, documentItem, sha256, pageId, photographId, importedAt = null, pageLabel = "" } = {}) {
  if (!Array.isArray(pages)) throw new TypeError("pages doit être un tableau");
  if (!documentItem || typeof documentItem !== "object" || Array.isArray(documentItem)) throw new TypeError("documentItem doit être un document historique");
  if (typeof pageId !== "string" || !pageId.trim()) throw new TypeError("pageId doit être une chaîne non vide");
  if (typeof photographId !== "string" || !photographId.trim()) throw new TypeError("photographId doit être une chaîne non vide");
  const fileName = String(documentItem.fileName || "").trim();
  if (!fileName) throw new Error("Le fichier du document est introuvable : la page ne peut pas être initialisée.");
  const mimeType = String(documentItem.mimeType || "").trim();
  if (!mimeType) throw new Error("Le type du fichier est inconnu : la page ne peut pas être initialisée.");
  const sizeBytes = documentItem.fileSize ?? documentItem.storedSize;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error("La taille du fichier est inconnue : la page ne peut pas être initialisée.");
  }
  if (typeof pageLabel !== "string") throw new TypeError("pageLabel doit être une chaîne");
  const withPage = addDocumentPage({ pages }, { id: pageId, label: pageLabel });
  const prepared = addPhotographsToPage(withPage, pageId, [{
    id: photographId,
    originalFileName: fileName,
    mimeType,
    sizeBytes,
    sha256,
    originalRef: legacyDocumentResourceRef(documentItem.id),
    importedAt
  }]);
  const page = prepared.pages.find(value => value.id === pageId);
  if (!page) throw new Error("La page préparée est introuvable après construction");
  return { pages: prepared.pages, page };
}

/* Prépare une page portant le fichier existant, sans créer de source. Cette
   variante réutilise le champ pages déjà pris en charge par les documents. */
export function prepareLegacyDocumentPageForDocument({ documentItem, sha256, pageId, photographId, importedAt = null, pageLabel = "" } = {}) {
  const prepared = prepareLegacyDocumentPageAssets({
    pages: Array.isArray(documentItem?.pages) ? documentItem.pages : [],
    documentItem, sha256, pageId, photographId, importedAt, pageLabel
  });
  return { document: { ...documentItem, pages: prepared.pages }, page: prepared.page };
}

export function prepareLegacyDocumentPage({ source, documentItem, sha256, pageId, photographId, importedAt = null, pageLabel = "" } = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError("source doit être un objet source");
  if (!Array.isArray(source.pages)) throw new TypeError("source.pages doit être un tableau");
  const prepared = prepareLegacyDocumentPageAssets({ pages: source.pages, documentItem, sha256, pageId, photographId, importedAt, pageLabel });
  const nextSource = { ...source, pages: prepared.pages };
  const validation = validateSourceDocument(nextSource);
  if (!validation.valid) throw new TypeError(`La source préparée est invalide : ${validation.errors.join("; ")}`);
  return { source: nextSource, page: prepared.page, validation };
}
