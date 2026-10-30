import assert from "node:assert/strict";
import test from "node:test";
import {
  createTranscriptionWorkshopDraft,
  editTranscriptionWorkshopPassage,
  addTranscriptionWorkshopPassage,
  restoreTranscriptionWorkshopDraft
} from "../js/transcription-workshop.js";
import { createTranscriptionPassage } from "../js/document-transcription.js";
import {
  TRANSCRIPTION_DRAFT_STORAGE_PREFIX,
  transcriptionDraftStorageKey,
  buildTranscriptionDraftRecord,
  serializeTranscriptionDraftRecord,
  parseTranscriptionDraftRecord,
  readTranscriptionDraft,
  writeTranscriptionDraft,
  removeTranscriptionDraft,
  transcriptionDraftWriteBlockReason
} from "../js/transcription-draft-storage.js";

/* Stockage mémoire avec compteurs et bâtarde de panne — suffisant pour
   reproduire quota, indisponibilité et rechargement sans navigateur. */
function createFakeStorage() {
  const entries = new Map();
  let failing = false;
  let writes = 0;
  let removals = 0;
  const failure = () => {
    const error = new Error("QuotaExceededError : le stockage est plein");
    error.name = "QuotaExceededError";
    throw error;
  };
  return {
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key, value) {
      if (failing) failure();
      writes += 1;
      entries.set(key, String(value));
    },
    removeItem(key) {
      if (failing) failure();
      removals += 1;
      entries.delete(key);
    },
    fail(value = true) { failing = value; },
    entries,
    get writes() { return writes; },
    get removals() { return removals; }
  };
}

const samplePassages = () => [
  createTranscriptionPassage({
    id: "p1", order: 0, textIt: "Anno millenovecento", translationFr: "L’année mille neuf cent",
    anchor: { shape: "rect", photographId: "photo-1", x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
    lineLabel: "l. 1-2", hypotheses: [{ id: "h1", text: "millenovecento", confidence: "medium", note: "lecture douteuse" }]
  }),
  createTranscriptionPassage({
    id: "p2", order: 1, textIt: "indici di Orino", translationFr: null, lineLabel: "l. 3"
  })
];

test("la clé de stockage isole chaque document et chaque page", () => {
  assert.equal(
    transcriptionDraftStorageKey("doc-a", "page-1"),
    `${TRANSCRIPTION_DRAFT_STORAGE_PREFIX}doc-a|page-1`
  );
  assert.notEqual(transcriptionDraftStorageKey("doc-a", "page-1"), transcriptionDraftStorageKey("doc-a", "page-2"), "pages distinctes");
  assert.notEqual(transcriptionDraftStorageKey("doc-a", "page-1"), transcriptionDraftStorageKey("doc-b", "page-1"), "documents distincts");
  assert.throws(() => transcriptionDraftStorageKey("", "page-1"), /documentId/);
  assert.throws(() => transcriptionDraftStorageKey("doc-a", " "), /pageId/);
});

test("aller-retour de stockage : textes, traductions, hypothèses, ancres et horodatage conservés", () => {
  const storage = createFakeStorage();
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Anno millenovecentosedici" });
  editTranscriptionWorkshopPassage(draft, "p2", { translationFr: "Indices d’Orino" });
  addTranscriptionWorkshopPassage(draft, { id: "nouveau-1", textIt: "Secondo passo", translationFr: "Deuxième passage", lineLabel: "l. 4" });
  const savedAt = "2026-10-30T10:00:00.000Z";
  const record = buildTranscriptionDraftRecord(draft, savedAt);
  writeTranscriptionDraft(storage, "doc-1", "page-1", record);

  const stored = readTranscriptionDraft(storage, "doc-1", "page-1");
  assert.equal(stored.record.savedAt, savedAt, "horodatage de dernière sauvegarde conservé");
  assert.equal(storage.writes, 1, "une seule écriture");

  const restored = restoreTranscriptionWorkshopDraft(stored.record.snapshot);
  assert.equal(restored.dirty, true, "brouillon modifié toujours marqué à la reprise");
  assert.equal(restored.documentId, "doc-1");
  assert.equal(restored.pageId, "page-1");
  assert.equal(restored.passages[0].textIt, "Anno millenovecentosedici", "texte italien conservé");
  assert.equal(restored.passages[0].lineLabel, "l. 1-2", "libellé de ligne conservé");
  assert.deepEqual(restored.passages[0].hypotheses, draft.passages[0].hypotheses, "hypothèses paléographiques conservées");
  assert.deepEqual(restored.passages[0].anchor, draft.passages[0].anchor, "ancre photographique conservée");
  assert.equal(restored.passages[1].translationFr, "Indices d’Orino", "traduction française conservée");
  assert.equal(restored.passages[1].translationState, "current", "état de traduction conservé");
  assert.deepEqual(restored.createdIds, ["nouveau-1"], "passages créés suivis");
  assert.equal(restored.passages[2].textIt, "Secondo passo", "passage ajouté restauré avec son texte");
  assert.equal(restored.passages[2].lineLabel, "l. 4", "libellé du passage ajouté conservé");
  assert.equal(restored.selectedPassageId, draft.selectedPassageId, "sélection restaurée");
  assert.deepEqual(restored.translationReview, ["p1"], "revue de traduction recalculée depuis le snapshot");
  assert.deepEqual(restored.original.map(passage => passage.id), ["p1", "p2"], "original intact pour les futures comparaisons");
});

test("rechargement simulé : une nouvelle session reprend le brouillon local", () => {
  const storage = createFakeStorage();
  const sessionOne = createTranscriptionWorkshopDraft({ documentId: "doc-r", pageId: "page-r", passages: samplePassages() });
  editTranscriptionWorkshopPassage(sessionOne, "p1", { textIt: "Testo dopo ricarica" });
  writeTranscriptionDraft(storage, "doc-r", "page-r", buildTranscriptionDraftRecord(sessionOne, "2026-10-30T11:00:00.000Z"));

  /* Nouvelle session : plus aucun brouillon en mémoire, seul le stockage
     subsiste — exactement l'état après un rechargement de l'application. */
  const stored = readTranscriptionDraft(storage, "doc-r", "page-r");
  const sessionTwo = restoreTranscriptionWorkshopDraft(stored.record.snapshot);
  assert.equal(sessionTwo.dirty, true, "le brouillon repris reste marqué modifié");
  assert.equal(sessionTwo.passages[0].textIt, "Testo dopo ricarica", "modification reprise après rechargement");
  assert.equal(sessionTwo.original[0].textIt, "Anno millenovecento", "référence d'origine reprise avec le brouillon");
  assert.notEqual(sessionTwo.original[0], sessionTwo.passages[0], "brouillon cloné, aucune référence partagée");

  /* Brouillon redevenu propre : retiré du stockage, la reprise n'en importe plus. */
  editTranscriptionWorkshopPassage(sessionTwo, "p1", { textIt: "Anno millenovecento" });
  assert.equal(sessionTwo.dirty, false, "retour à l'original");
  removeTranscriptionDraft(storage, "doc-r", "page-r");
  assert.equal(readTranscriptionDraft(storage, "doc-r", "page-r"), null, "brouillon propre retiré");
  assert.equal(sessionTwo.dirty, false, "aucune donnée artificiellement réintroduite");
});

test("deux documents ou deux pages ne partagent jamais leur brouillon", () => {
  const storage = createFakeStorage();
  const docOne = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  editTranscriptionWorkshopPassage(docOne, "p1", { textIt: "Contenu du document un" });
  writeTranscriptionDraft(storage, "doc-1", "page-1", buildTranscriptionDraftRecord(docOne, "2026-10-30T12:00:00.000Z"));

  assert.equal(readTranscriptionDraft(storage, "doc-1", "page-2"), null, "autre page du même document : rien");
  assert.equal(readTranscriptionDraft(storage, "doc-2", "page-1"), null, "autre document : rien");

  const docOnePageTwo = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-2", passages: samplePassages() });
  editTranscriptionWorkshopPassage(docOnePageTwo, "p1", { textIt: "Contenu de la page deux" });
  writeTranscriptionDraft(storage, "doc-1", "page-2", buildTranscriptionDraftRecord(docOnePageTwo, "2026-10-30T12:05:00.000Z"));

  const first = restoreTranscriptionWorkshopDraft(readTranscriptionDraft(storage, "doc-1", "page-1").record.snapshot);
  const second = restoreTranscriptionWorkshopDraft(readTranscriptionDraft(storage, "doc-1", "page-2").record.snapshot);
  assert.equal(first.passages[0].textIt, "Contenu du document un");
  assert.equal(second.passages[0].textIt, "Contenu de la page deux");
});

test("un enregistrement corrompu ou d'une autre fiche est écarté, jamais interprété", () => {
  const storage = createFakeStorage();
  const key = transcriptionDraftStorageKey("doc-1", "page-1");
  storage.setItem(key, "{ceci-n-est-pas-du-json");
  assert.equal(readTranscriptionDraft(storage, "doc-1", "page-1"), null, "JSON invalide : rien n'est lu");
  assert.equal(storage.entries.has(key), false, "donnée corrompue retirée du stockage");

  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Anno verificato" });
  const raw = serializeTranscriptionDraftRecord(buildTranscriptionDraftRecord(draft, "2026-10-30T13:00:00.000Z"));
  assert.equal(parseTranscriptionDraftRecord(raw, { documentId: "doc-1", pageId: "page-1" })?.documentId, "doc-1", "appariement exact accepté");
  assert.equal(parseTranscriptionDraftRecord(raw, { documentId: "doc-2", pageId: "page-1" }), null, "enregistrement d'un autre document rejeté");
  assert.equal(parseTranscriptionDraftRecord(raw, { documentId: "doc-1", pageId: "page-autre" }), null, "enregistrement d'une autre page rejeté");
  assert.equal(parseTranscriptionDraftRecord("42", { documentId: "doc-1", pageId: "page-1" }), null, "type non objet rejeté");
});

test("une version plus récente déjà stockée bloque l'écriture", () => {
  const storage = createFakeStorage();
  assert.equal(transcriptionDraftWriteBlockReason(storage, "doc-1", "page-1", null), null, "stockage vide : écriture autorisée");

  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Version de référence" });
  writeTranscriptionDraft(storage, "doc-1", "page-1", buildTranscriptionDraftRecord(draft, "2026-10-30T14:00:00.000Z"));
  assert.equal(transcriptionDraftWriteBlockReason(storage, "doc-1", "page-1", "2026-10-30T14:00:00.000Z"), null, "sa propre dernière version : réécriture autorisée");

  /* Un autre onglet écrit entre-temps une version plus récente. */
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Version plus récente d’un autre onglet" });
  writeTranscriptionDraft(storage, "doc-1", "page-1", buildTranscriptionDraftRecord(draft, "2026-10-30T14:05:00.000Z"));
  assert.equal(
    transcriptionDraftWriteBlockReason(storage, "doc-1", "page-1", "2026-10-30T14:00:00.000Z"),
    "newer",
    "l'écriture d'une baseline plus ancienne est refusée"
  );
  assert.equal(
    transcriptionDraftWriteBlockReason(storage, "doc-1", "page-1", null),
    "unknown-baseline",
    "présence sans référence connue : contenu d'origine inconnue, refusé"
  );

  /* L'enregistrement plus récent est toujours intact après refus. */
  const stored = restoreTranscriptionWorkshopDraft(readTranscriptionDraft(storage, "doc-1", "page-1").record.snapshot);
  assert.equal(stored.passages[0].textIt, "Version plus récente d’un autre onglet", "version récente non écrasée");
});

test("un échec du stockage ne remplace ni ne supprime la version précédente", () => {
  const storage = createFakeStorage();
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-q", pageId: "page-q", passages: samplePassages() });
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Prima versione" });
  writeTranscriptionDraft(storage, "doc-q", "page-q", buildTranscriptionDraftRecord(draft, "2026-10-30T15:00:00.000Z"));

  storage.fail(true);
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Seconda versione" });
  assert.throws(
    () => writeTranscriptionDraft(storage, "doc-q", "page-q", buildTranscriptionDraftRecord(draft, "2026-10-30T15:01:00.000Z")),
    /QuotaExceededError/,
    "l'échec d'écriture remonte à l'application (avertissement attendu)"
  );
  assert.throws(() => removeTranscriptionDraft(storage, "doc-q", "page-q"), /QuotaExceededError/, "aucun retrait silencieux pendant l'indisponibilité");

  storage.fail(false);
  const stored = readTranscriptionDraft(storage, "doc-q", "page-q");
  assert.equal(stored.record.savedAt, "2026-10-30T15:00:00.000Z", "la version précédente reste en place");
  assert.equal(restoreTranscriptionWorkshopDraft(stored.record.snapshot).passages[0].textIt, "Prima versione", "le contenu antérieur n'a pas été perdu");
  assert.equal(storage.writes, 1, "aucune écriture n'a réussi pendant la panne");
});

test("la restauration refuse un snapshot incohérent au lieu d'importer des données douteuses", () => {
  const valid = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  const base = {
    documentId: "doc-1",
    pageId: "page-1",
    original: valid.original,
    passages: valid.passages,
    createdIds: [],
    selectedPassageId: "p1"
  };
  assert.equal(restoreTranscriptionWorkshopDraft(base).passages.length, 2, "snapshot valide accepté");
  assert.throws(() => restoreTranscriptionWorkshopDraft(null), /objet/);
  assert.throws(() => restoreTranscriptionWorkshopDraft({ ...base, documentId: "" }), /documentId/);
  assert.throws(() => restoreTranscriptionWorkshopDraft({ ...base, passages: [...valid.passages, { id: "fantome", order: 2 }] }), /passage inconnu/, "passage hors original et hors créés");
  assert.throws(() => restoreTranscriptionWorkshopDraft({ ...base, passages: [valid.passages[0]] }), /passage original/, "perte d'un passage original");
  assert.throws(() => restoreTranscriptionWorkshopDraft({ ...base, createdIds: ["inexistant"] }), /createdIds/, "passage créé fantôme");
  const withBadSelection = restoreTranscriptionWorkshopDraft({ ...base, selectedPassageId: "inconnu" });
  assert.equal(withBadSelection.selectedPassageId, "p1", "sélection inconnue rabattue sur un passage valide");
});
