/* Atelier de transcription (lot 2B.1) — logique pure des brouillons locaux.
   Aucun accès DOM, Firebase, réseau ou stockage. Les corrections produites ici
   restent des brouillons de session : ce module n'écrit dans aucune collection
   officielle (transcriptionHeads, transcriptionRevisions, genealogyProofs,
   factConclusions) et ne crée aucune révision. */

import { createPageTextRevision, comparePageTextRevisions, createTranscriptionPassage } from "./document-transcription.js";

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
  draft.dirty = draft.passages.some((passage, index) => !samePassageText(passage, draft.original[index]));
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
    passage.translationFr = translationFr;
    if (translationFr !== null && translationFr !== "" && passage.translationState === "not-started") {
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

/* Supprime un passage du brouillon. Seuls les passages ajoutés dans la session
   sont supprimables : les passages issus des révisions officielles sont
   intangibles tant qu'aucune révision n'est écrite. */
export function removeTranscriptionWorkshopPassage(draft, passageId) {
  if (!draft || typeof draft !== "object") throw new TypeError("Le brouillon d’atelier est requis");
  if (typeof passageId !== "string" || !passageId.trim()) throw new TypeError("passageId doit être une chaîne non vide");
  if (!draft.createdIds.includes(passageId)) {
    throw new Error("Seul un passage ajouté dans ce brouillon peut être supprimé");
  }
  draft.passages = draft.passages.filter(passage => passage.id !== passageId);
  draft.createdIds = draft.createdIds.filter(id => id !== passageId);
  if (draft.selectedPassageId === passageId) draft.selectedPassageId = draft.passages[0]?.id || null;
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
