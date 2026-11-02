import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createTranscriptionWorkshopDraft,
  editTranscriptionWorkshopPassage,
  addTranscriptionWorkshopPassage,
  removeTranscriptionWorkshopPassage,
  isTranscriptionWorkshopPassageCreated,
  restoreTranscriptionWorkshopDraft,
  resetTranscriptionWorkshopDraft,
  selectTranscriptionWorkshopPassage,
  isTranscriptionWorkshopPassageChanged,
  transcriptionWorkshopPassagePosition,
  transcriptionWorkshopPassageLabel,
  transcriptionWorkshopTranslationBadge,
  WORKSHOP_TRANSLATION_STATE_LABELS,
  WORKSHOP_ZONE_MIN_SIZE,
  clampWorkshopZoneRect,
  workshopZoneRectFromDrag,
  workshopZoneMoveRect,
  workshopZoneResizeRect,
  setTranscriptionWorkshopPassageAnchor,
  isTranscriptionJpegDocument,
  isTranscriptionPdfDocument,
  canInitializeLegacyJpegPage,
  findSourcePageForDocument,
  prepareLegacyDocumentPage,
  legacyDocumentResourceRef
} from "../js/transcription-workshop.js";
import { createTranscriptionPassage } from "../js/document-transcription.js";
import { createSourceDocument } from "../js/source-document-model.js";
import { chromium, webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const samplePassages = () => [
  createTranscriptionPassage({
    id: "p1", order: 0, textIt: "Anno millenovecento", translationFr: "L’année mille neuf cent",
    anchor: { shape: "rect", photographId: "photo-1", x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
    lineLabel: "l. 1-2", hypotheses: [{ id: "h1", text: "millenovecento", confidence: "medium", note: "" }]
  }),
  createTranscriptionPassage({
    id: "p2", order: 1, textIt: "indici di Orino", translationFr: null, lineLabel: "l. 3"
  })
];

test("le brouillon d’atelier clone les passages sans toucher à l’original", () => {
  const source = samplePassages();
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: source });
  assert.equal(draft.dirty, false);
  assert.equal(draft.selectedPassageId, "p1");
  assert.deepEqual(draft.translationReview, []);
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Anno millenovecentosedici" });
  assert.equal(source[0].textIt, "Anno millenovecento", "les données sources restent inchangées");
  assert.notEqual(draft.passages[0], source[0], "le brouillon ne partage pas l’objet source");
  assert.equal(draft.dirty, true);
});

test("le brouillon refuse un contexte incomplet", () => {
  assert.throws(() => createTranscriptionWorkshopDraft({ documentId: "", pageId: "p", passages: [] }), /documentId/);
  assert.throws(() => createTranscriptionWorkshopDraft({ documentId: "d", pageId: "", passages: [] }), /pageId/);
  assert.throws(() => createTranscriptionWorkshopDraft({ documentId: "d", pageId: "p", passages: "x" }), /passages/);
});

test("une correction italienne substantielle signale la traduction à revoir", () => {
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Anno millenovecentosedici" });
  assert.deepEqual(draft.translationReview, ["p1"], "traduction existante inchangée → à revoir");
  assert.equal(transcriptionWorkshopTranslationBadge(draft, draft.passages[0]), WORKSHOP_TRANSLATION_STATE_LABELS["needs-review"]);
  editTranscriptionWorkshopPassage(draft, "p1", { translationFr: "L’année mille neuf cent seize" });
  assert.deepEqual(draft.translationReview, [], "traduction mise à jour → revue levée");
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Anno millenovecento", translationFr: "L’année mille neuf cent" });
  assert.equal(draft.dirty, false, "retour aux textes initiaux → brouillon propre");
});

test("sans traduction, la correction italienne ne signale aucune revue", () => {
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  editTranscriptionWorkshopPassage(draft, "p2", { textIt: "indici di Orino e Ghiffa" });
  assert.deepEqual(draft.translationReview, [], "passage sans traduction ignoré par la revue");
  editTranscriptionWorkshopPassage(draft, "p2", { translationFr: "indices d’Orino et Ghiffa" });
  assert.equal(draft.passages[1].translationState, "current", "première traduction → état à jour");
  assert.equal(transcriptionWorkshopTranslationBadge(draft, draft.passages[1]), WORKSHOP_TRANSLATION_STATE_LABELS.current);
});

test("la comparaison de revue se rabat sur un repli textuel si le modèle refuse un passage", () => {
  const passages = samplePassages().map(passage => ({ ...passage, translationState: "état-invalide" }));
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages });
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Anno millenovecentosedici" });
  assert.deepEqual(draft.translationReview, ["p1"], "repli textuel conservé");
});

test("réinitialisation, sélection et navigation dans les passages", () => {
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  editTranscriptionWorkshopPassage(draft, "p2", { translationFr: "traduction de secours" });
  assert.equal(isTranscriptionWorkshopPassageChanged(draft, "p2"), true);
  resetTranscriptionWorkshopDraft(draft);
  assert.equal(draft.dirty, false);
  assert.equal(draft.passages[1].translationFr, null, "réinitialisation restaurée depuis l’original");
  selectTranscriptionWorkshopPassage(draft, "p2");
  const position = transcriptionWorkshopPassagePosition(draft, draft.selectedPassageId);
  assert.equal(position.index, 1);
  assert.equal(position.total, 2);
  assert.equal(position.previousId, "p1");
  assert.equal(position.nextId, null);
  assert.equal(transcriptionWorkshopPassageLabel(draft.passages[0], 0), "Passage 1 · l. 1-2");
  assert.throws(() => selectTranscriptionWorkshopPassage(draft, "inconnu"), /introuvable/);
  assert.throws(() => editTranscriptionWorkshopPassage(draft, "inconnu", { textIt: "x" }), /introuvable/);
});

test("l’ajout de passage fonctionne sur page vide et page déjà transcrite", () => {
  const empty = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-vide", passages: [] });
  addTranscriptionWorkshopPassage(empty, { id: "nouveau-1", textIt: "Anno", translationFr: "L’année" });
  assert.equal(empty.passages.length, 1, "page vide : premier passage ajouté");
  assert.equal(empty.passages[0].order, 0, "order démarré à 0");
  assert.equal(empty.selectedPassageId, "nouveau-1", "le passage ajouté est sélectionné");
  assert.equal(empty.dirty, true, "ajout non enregistré → brouillon modifié");
  assert.equal(isTranscriptionWorkshopPassageCreated(empty, "nouveau-1"), true);
  assert.equal(empty.passages[0].translationState, "current", "traduction fournie → état dérivé");

  const translated = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  addTranscriptionWorkshopPassage(translated, { id: "nouveau-2" });
  assert.equal(translated.passages.length, 3, "page transcrite : passage ajouté en fin");
  assert.equal(translated.passages[2].id, "nouveau-2");
  assert.equal(translated.passages[2].order, 2, "order = max + 1");
  assert.equal(translated.passages[2].translationFr, null, "traduction facultative");
  assert.equal(translated.passages[2].translationState, "not-started", "sans traduction → état dérivé");
  assert.deepEqual(translated.original.map(passage => passage.id), ["p1", "p2"], "l’original reste intact");
});

test("l’ajout de passage valide ses entrées", () => {
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  assert.throws(() => addTranscriptionWorkshopPassage(draft, { id: "" }), /id/);
  assert.throws(() => addTranscriptionWorkshopPassage(draft, { id: "p1" }), /existe déjà/);
  assert.throws(() => addTranscriptionWorkshopPassage(draft, { id: "n1", textIt: 42 }), /textIt/);
  assert.throws(() => addTranscriptionWorkshopPassage(draft, { id: "n1", translationFr: 7 }), /translationFr/);
  assert.throws(() => addTranscriptionWorkshopPassage(null, { id: "n1" }), /brouillon/);
  assert.equal(draft.dirty, false, "aucune entrée invalide n’a modifié le brouillon");
});

test("la suppression retire du brouillon un passage créé ou hérité sans toucher à l'original", () => {
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  const original = draft.original.map(passage => ({ ...passage, anchor: passage.anchor ? { ...passage.anchor } : null }));
  addTranscriptionWorkshopPassage(draft, { id: "nouveau-3", textIt: "Testo aggiunto" });
  draft.passages.find(passage => passage.id === "nouveau-3").anchor = {
    shape: "rect", pdfPage: 3, fileSha256: "a".repeat(64), x: 0.1, y: 0.2, width: 0.3, height: 0.2
  };
  draft.selectedPassageId = "nouveau-3";
  assert.equal(draft.passages.length, 3);
  removeTranscriptionWorkshopPassage(draft, "nouveau-3");
  assert.equal(draft.passages.length, 2, "suppression du passage créé");
  assert.equal(draft.passages.some(passage => passage.id === "nouveau-3"), false, "la zone du passage supprimé part avec son ancre");
  assert.deepEqual(draft.passages[0].anchor, samplePassages()[0].anchor, "les zones des passages restants sont conservées");
  assert.equal(draft.selectedPassageId, "p2", "la sélection passe au passage voisin après suppression");
  assert.equal(draft.dirty, false, "retour à l’état initial de la page");
  assert.equal(isTranscriptionWorkshopPassageCreated(draft, "nouveau-3"), false);
  assert.throws(() => removeTranscriptionWorkshopPassage(draft, "inconnu"), /introuvable/);

  selectTranscriptionWorkshopPassage(draft, "p1");
  removeTranscriptionWorkshopPassage(draft, "p1");
  assert.deepEqual(draft.original.map(passage => passage.id), ["p1", "p2"], "la base officielle du brouillon demeure intacte");
  assert.deepEqual(draft.original[0].anchor, original[0].anchor, "l'ancre officielle reste dans l'original historique");
  assert.deepEqual(draft.passages.map(passage => passage.id), ["p2"], "seul le passage choisi disparaît de la révision active");
  assert.equal(draft.selectedPassageId, "p2", "suppression sélectionne le passage voisin restant");
  assert.equal(draft.dirty, true, "suppression d'un passage hérité devient une modification de révision");
  const restoredRevision = restoreTranscriptionWorkshopDraft({
    documentId: draft.documentId,
    pageId: draft.pageId,
    original: draft.original,
    passages: draft.passages,
    createdIds: draft.createdIds,
    selectedPassageId: draft.selectedPassageId
  });
  assert.deepEqual(restoredRevision.original.map(passage => passage.id), ["p1", "p2"], "reprise locale conserve la base officielle historique");
  assert.deepEqual(restoredRevision.passages.map(passage => passage.id), ["p2"], "reprise locale conserve la suppression comme différence de révision");
  assert.equal(restoredRevision.dirty, true, "reprise locale ne perd pas le caractère modifié de la révision");
  resetTranscriptionWorkshopDraft(draft);
  assert.deepEqual(draft.passages.map(passage => passage.id), ["p1", "p2"], "abandon restaure tous les passages officiels");
  assert.equal(draft.dirty, false, "abandon annule la suppression dans le brouillon");
  assert.deepEqual(draft.createdIds, [], "la réinitialisation vide la liste des passages créés");
});

test("B1 : géométrie des zones et écriture de la zone du passage dans le brouillon", () => {
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  /* Bornes : coordonnées 0..1, jamais hors image, taille minimale. */
  const clamped = clampWorkshopZoneRect({ x: -0.2, y: 1.4, width: 0, height: 3 });
  assert.equal(clamped.x, 0, "x négatif ramené à 0");
  assert.ok(clamped.width >= WORKSHOP_ZONE_MIN_SIZE, "largeur minimale garantie");
  assert.ok(clamped.height >= WORKSHOP_ZONE_MIN_SIZE, "hauteur minimale garantie");
  assert.ok(clamped.x + clamped.width <= 1 && clamped.y + clamped.height <= 1, "rectangle contenu dans l’image");
  const drag = workshopZoneRectFromDrag({ x: 0.7, y: 0.6 }, { x: 0.2, y: 0.3 });
  assert.ok(Math.abs(drag.x - 0.2) < 1e-9 && Math.abs(drag.y - 0.3) < 1e-9, "origine au point le plus haut à gauche");
  assert.ok(Math.abs(drag.width - 0.5) < 1e-9 && Math.abs(drag.height - 0.3) < 1e-9, "taille = delta du glisser");
  const moved = workshopZoneMoveRect({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 0.9, 0.9);
  assert.ok(moved.x + moved.width <= 1 + 1e-9 && moved.y + moved.height <= 1 + 1e-9, "déplacement borné aux limites");
  const resized = workshopZoneResizeRect({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, "nw", -1, -1);
  assert.ok(resized.x >= 0 && resized.y >= 0, "redimensionnement ne sort jamais de l’image");
  assert.ok(resized.width >= WORKSHOP_ZONE_MIN_SIZE && resized.height >= WORKSHOP_ZONE_MIN_SIZE, "redimensionnement conserve la taille minimale");
  /* Écriture confirmée : validée par le modèle, sans toucher aux autres
     passages, et suppression = retour à l’état du brouillon d’origine. */
  const otherPassage = JSON.stringify(draft.passages[1]);
  setTranscriptionWorkshopPassageAnchor(draft, "p1", {
    shape: "rect", photographId: "photo-1", x: 0.5, y: 0.5, width: 0.2, height: 0.2
  }, { photographIds: ["photo-1"] });
  assert.equal(draft.passages[0].anchor.x, 0.5, "zone écrite sur le passage sélectionné");
  assert.equal(draft.dirty, true, "zone confirmée = brouillon modifié (autosauvegarde armée)");
  assert.equal(JSON.stringify(draft.passages[1]), otherPassage, "les autres passages ne sont jamais touchés");
  assert.throws(
    () => setTranscriptionWorkshopPassageAnchor(draft, "p1", { shape: "rect", photographId: "photo-9", x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, { photographIds: ["photo-1"] }),
    /photographie absente de la page/, "zone refusée si la photographie n’appartient pas à la page"
  );
  assert.throws(
    () => setTranscriptionWorkshopPassageAnchor(draft, "p1", { shape: "rect", photographId: "photo-1", x: 0.9, y: 0.1, width: 0.5, height: 0.2 }, { photographIds: ["photo-1"] }),
    /limites normalisées/, "zone hors limites refusée"
  );
  assert.throws(() => setTranscriptionWorkshopPassageAnchor(draft, "inconnu", null), /introuvable/, "passage inconnu refusé");
  const fresh = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  setTranscriptionWorkshopPassageAnchor(fresh, "p2", {
    shape: "rect", photographId: "photo-1", x: 0.1, y: 0.1, width: 0.3, height: 0.2
  }, { photographIds: ["photo-1"] });
  assert.equal(fresh.dirty, true, "ajout de zone = brouillon modifié");
  setTranscriptionWorkshopPassageAnchor(fresh, "p2", null, { photographIds: ["photo-1"] });
  assert.equal(fresh.passages[1].anchor, null, "suppression = association graphique retirée, texte conservé");
  assert.equal(fresh.passages[1].textIt, "indici di Orino", "la transcription italienne n’est jamais supprimée");
  assert.equal(fresh.dirty, false, "retour exact à l’état original du brouillon");
});

test("l’accès à l’atelier couvre toute source et tout document consultable", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /const workshopCompatible = kind === "transcription"\s*\|\| kind === "source/, "toute source propose Transcrire, même sans pages rattachées");
  assert.match(app, /data-transcribe-document=/, "action Transcrire dans la fiche document unifiée");
  assert.match(app, /function openTranscriptionWorkshopForDocument\(documentItem, preferredPageId = ""\)/, "ouverture depuis la fiche du document sur la page de transcription sélectionnée");
  assert.match(app, /transcriptionWorkshopNoPagesMessage/, "état explicite quand les pages sont absentes");
  assert.match(app, /rattachez d’abord ses pages et photographies à la source officielle via l’action « Réviser »/, "solution cohérente sans invention de données officielles");
  assert.match(app, /linkedDocumentIds/, "résolution élargie du contexte");
  assert.match(app, /linkedDocument\.pages\.length/, "pages récupérées chez un document lié de la source");
});

const jpegDocument = {
  id: "doc-jpeg",
  fileName: "Transaction_Immobiliere.jpg",
  mimeType: "image/jpeg",
  fileSize: 123456,
  chunkCount: 1,
  chunkVersion: 1
};

test("un JPEG est identifié et une page existante est réutilisée", () => {
  assert.equal(isTranscriptionJpegDocument(jpegDocument), true, "mimeType image/jpeg");
  assert.equal(isTranscriptionJpegDocument({ id: "d", fileName: "scan.JPG" }), true, "extension .JPG");
  assert.equal(isTranscriptionJpegDocument({ id: "d", fileName: "registre.png", mimeType: "image/png" }), false, "PNG hors périmètre de l’étape");
  assert.equal(isTranscriptionJpegDocument(null), false, "entrée invalide");
  assert.equal(legacyDocumentResourceRef("doc-jpeg"), "legacy-document:doc-jpeg");

  const source = createSourceDocument({
    id: "src-1",
    title: "Transactions Immobilières",
    pages: [{
      id: "page-1", order: 0, label: "", side: null,
      photographs: [{
        id: "photo-1", role: "full",
        original: {
          originalFileName: "Transaction_Immobiliere.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 123456,
          sha256: "a".repeat(64),
          resourceRef: legacyDocumentResourceRef("doc-jpeg"),
          importedAt: null
        },
        preview: null
      }]
    }]
  });
  const existingPage = findSourcePageForDocument(source, "doc-jpeg");
  assert.equal(existingPage?.id, "page-1", "la page officielle référençant le JPEG est trouvée");
  assert.equal(findSourcePageForDocument(source, "autre-document"), null, "aucune page pour un autre document");
  assert.equal(findSourcePageForDocument({ id: "src-sans-pages" }, "doc-jpeg"), null, "source sans pages");
  assert.equal(findSourcePageForDocument(null, "doc-jpeg"), null, "source absente");
});

test("un PDF est identifié par son type ou son extension, jamais par une image", () => {
  assert.equal(isTranscriptionPdfDocument({ id: "d", fileName: "registre.pdf", mimeType: "application/pdf" }), true, "mimeType application/pdf");
  assert.equal(isTranscriptionPdfDocument({ id: "d", fileName: "SCAN.PDF" }), true, "extension .PDF majuscule");
  assert.equal(isTranscriptionPdfDocument({ id: "d", fileName: "registre.jpg", mimeType: "image/jpeg" }), false, "JPEG hors du périmètre PDF");
  assert.equal(isTranscriptionPdfDocument({ id: "d", fileName: "notes.txt", mimeType: "text/plain" }), false, "autre type");
  assert.equal(isTranscriptionPdfDocument(null), false, "entrée invalide");
});

test("l’initialisation locale accepte les PDF en plus des JPEG, jamais un distant", () => {
  assert.equal(canInitializeLegacyJpegPage({ id: "d", fileName: "scan.jpg", mimeType: "image/jpeg", chunkCount: 1, chunkVersion: "v1" }), true, "JPEG en chunks inchangé");
  assert.equal(canInitializeLegacyJpegPage({ id: "d", fileName: "scan.jpg", mimeType: "image/jpeg", fileData: "data:image/jpeg;base64,AAAA" }), true, "JPEG en data-URL inchangé");
  assert.equal(canInitializeLegacyJpegPage({ id: "d", fileName: "registre.pdf", mimeType: "application/pdf", chunkCount: 2, chunkVersion: "v1" }), true, "PDF en chunks accepté");
  assert.equal(canInitializeLegacyJpegPage({ id: "d", fileName: "registre.pdf", mimeType: "application/pdf", fileData: "data:application/pdf;base64,AAAA" }), true, "PDF en data-URL accepté");
  assert.equal(canInitializeLegacyJpegPage({ id: "d", fileName: "registre.pdf", mimeType: "application/pdf", externalUrl: "https://exemple.test/registre.pdf" }), false, "PDF distant sans octets locaux refusé (pas d’empreinte)");
  assert.equal(canInitializeLegacyJpegPage({ id: "d", fileName: "notes.txt", mimeType: "text/plain", chunkCount: 1, chunkVersion: "v1" }), false, "autres formats refusés");
  assert.equal(canInitializeLegacyJpegPage(null), false, "entrée invalide");
});

test("l’initialisation prépare une page référençant un PDF sans dupliquer le fichier", () => {
  const baseSource = createSourceDocument({ id: "src-pdf", title: "Registre Transactions" });
  const pdfDocument = { id: "doc-pdf", fileName: "registre.pdf", mimeType: "application/pdf", fileSize: 4321, chunkCount: 1, chunkVersion: "v1" };
  const { source, page, validation } = prepareLegacyDocumentPage({
    source: baseSource,
    documentItem: pdfDocument,
    sha256: "d".repeat(64),
    pageId: "page-pdf-init",
    photographId: "photo-pdf-init",
    importedAt: "2026-10-28T00:00:00.000Z"
  });
  assert.equal(validation.valid, true, "la source préparée passe la validation du modèle");
  assert.equal(page.id, "page-pdf-init", "page technique créée");
  assert.equal(page.photographs.length, 1, "une seule référence photographique technique");
  const photo = page.photographs[0];
  assert.equal(photo.original.mimeType, "application/pdf", "type MIME PDF conservé");
  assert.equal(photo.original.resourceRef, legacyDocumentResourceRef("doc-pdf"), "référence legacy vers le document existant");
  assert.equal(photo.original.sha256, "d".repeat(64), "empreinte du fichier enregistrée");
  assert.equal(photo.preview, null, "aucun aperçu dupliqué");
  assert.equal(source.pages.length, 1, "une seule page technique pour tout le PDF (pas de page par folio)");
  const serialized = JSON.stringify(source);
  assert.ok(!serialized.includes("fileData"), "aucun octet de fichier recopié");
  assert.ok(!serialized.includes("chunkCount"), "aucun chunk de fichier recopié");
});

test("l’initialisation prépare une page référençant le JPEG sans dupliquer le fichier", () => {
  const baseSource = createSourceDocument({ id: "src-1", title: "Transactions Immobilières" });
  const { source, page, validation } = prepareLegacyDocumentPage({
    source: baseSource,
    documentItem: jpegDocument,
    sha256: "c".repeat(64),
    pageId: "page-9",
    photographId: "photo-9",
    importedAt: "2026-10-28T00:00:00.000Z"
  });
  assert.equal(validation.valid, true, "la source préparée passe la validation du modèle");
  assert.equal(source.pages.length, 1, "une page a été ajoutée");
  assert.equal(page.id, "page-9");
  assert.equal(page.order, 0, "order démarré à 0 sur source vide");
  assert.equal(page.photographs.length, 1);
  const original = page.photographs[0].original;
  assert.equal(original.resourceRef, "legacy-document:doc-jpeg", "référence vers le document existant");
  assert.equal(original.sha256, "c".repeat(64), "empreinte du fichier référencé");
  assert.equal(original.originalFileName, jpegDocument.fileName);
  assert.equal(original.sizeBytes, jpegDocument.fileSize);
  const serialized = JSON.stringify(source);
  assert.ok(!serialized.includes("fileData"), "aucun octet de fichier recopié");
  assert.ok(!serialized.includes("chunkCount"), "aucun chunk recopié");
  assert.equal(serialized.includes("doc-jpeg"), true, "seule la référence du document figure dans la source");

  const withPages = prepareLegacyDocumentPage({
    source: createSourceDocument({ id: "src-2", title: "S", pages: [{ id: "page-a", order: 0, label: "", side: null, photographs: [] }, { id: "page-b", order: 1, label: "", side: null, photographs: [] }] }),
    documentItem: jpegDocument,
    sha256: "d".repeat(64),
    pageId: "page-c",
    photographId: "photo-c"
  });
  assert.equal(withPages.page.order, 2, "order = max + 1 sur source déjà paginée");
});

test("l’initialisation refuse une ressource non vérifiable et les entrées invalides", () => {
  const baseSource = createSourceDocument({ id: "src-1", title: "S" });
  const args = overrides => ({ source: baseSource, documentItem: { ...jpegDocument, ...overrides }, sha256: "e".repeat(64), pageId: "page-9", photographId: "photo-9" });
  assert.throws(() => prepareLegacyDocumentPage(args({ fileName: "" })), /introuvable/, "fichier sans nom → ressource indisponible");
  assert.throws(() => prepareLegacyDocumentPage(args({ mimeType: "" })), /type du fichier/, "type inconnu → ressource indisponible");
  assert.throws(() => prepareLegacyDocumentPage(args({ fileSize: undefined, storedSize: undefined })), /taille du fichier/, "taille inconnue → ressource indisponible");
  assert.throws(() => prepareLegacyDocumentPage({ ...args({}), sha256: "abc" }), /sha256/, "empreinte invalide refusée");
  const sourceWithPage = createSourceDocument({ id: "src-dup", title: "S", pages: [{ id: "page-9", order: 0, label: "", side: null, photographs: [] }] });
  assert.throws(() => prepareLegacyDocumentPage({ source: sourceWithPage, documentItem: jpegDocument, sha256: "f".repeat(64), pageId: "page-9", photographId: "photo-9" }), /existe déjà/, "pageId déjà présent refusé");
  assert.throws(() => prepareLegacyDocumentPage({ source: null, documentItem: jpegDocument, sha256: "f".repeat(64), pageId: "p", photographId: "ph" }), /source doit être/, "source absente refusée");
  assert.throws(() => prepareLegacyDocumentPage({ source: { id: "s" }, documentItem: jpegDocument, sha256: "f".repeat(64), pageId: "p", photographId: "ph" }), /source\.pages/, "source sans pages refusée");
});

test("l’accès direct aux JPEG applique les portes JPEG, admin et révision explicite", async () => {
  const [app, html, workshop] = await Promise.all([
    readFile(new URL("../js/app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/transcription-workshop.js", import.meta.url), "utf8")
  ]);
  // Porte JPEG/PDF : seuls ces deux formats sont initialisables (empreinte locale exigée).
  assert.match(app, /if \(!isTranscriptionJpegDocument\(documentItem\) && !isTranscriptionPdfDocument\(documentItem\)\)/, "gate JPEG/PDF avant tout traitement");
  assert.match(app, /Seuls les documents JPEG ou PDF peuvent initialiser une nouvelle page de transcription/, "une page existante reste consultable quel que soit le format, l’initialisation reste limitée aux formats à empreinte locale");
  // Réutilisation d'une page existante (aucune sélection de source sur ce chemin).
  assert.match(app, /const existingPage = findSourcePageForDocument\(data, documentItem\.id\)/, "réutilisation de la page existante");
  // Sources : actives seulement, jamais la « première » trouvée.
  assert.match(app, /const activeSources = linkedSources\.filter\(/, "filtrage des seules sources actives");
  assert.match(app, /Toutes les sources liées à ce document sont archivées/, "blocage explicite si toutes archivées");
  assert.match(app, /Aucune source active n’est disponible pour initialiser cette page/, "blocage explicite si aucune source valide");
  assert.doesNotMatch(app, /\|\| linkedSources\[0\]/, "aucun repli silencieux sur la première source");
  assert.doesNotMatch(app, /const sourceRecord = linkedSources\.find/, "aucune pré-sélection silencieuse d'une source");
  // Une seule source active → auto-sélection affichée ; plusieurs → choix exigé.
  assert.match(app, /const multipleSources = activeSources\.length > 1/, "détection du nombre de sources actives");
  assert.match(app, /selectedSourceId: multipleSources \? null : activeSources\[0\]\.id/, "auto-seulement quand une seule source active");
  assert.match(html, /id="transcriptionPageInitSourceField"/, "champ de sélection de source présent");
  assert.match(html, /id="transcriptionPageInitSource"/, "sélecteur de source présent");
  assert.match(app, /Choisir la source…/, "aucune option présélectionnée si plusieurs sources");
  assert.match(app, /\$\("transcriptionPageInitSource"\)\.onchange/, "choix explicite de l'utilisateur");
  assert.match(app, /function renderTranscriptionPageInitDetails\(\)/, "affichage du nom de la source cible");
  assert.match(app, /\["Source", sourceTitle\]/, "source affichée dans les faits du dialogue");
  assert.match(app, /\$\("transcriptionPageInitConfirmBtn"\)\.disabled = !\(state\.selectedSourceId && state\.sha256\)/, "confirmation bloquée tant que la source n'est pas choisie");
  // Re-vérification source + droits au moment de la confirmation.
  assert.match(app, /async function confirmTranscriptionPageInit[\s\S]{0,700}if \(!state\.selectedSourceId\) return fail\(/, "choix re-vérifié à la confirmation");
  assert.match(app, /La source sélectionnée n’est plus disponible/, "source disparue détectée");
  assert.match(app, /La source sélectionnée a été archivée/, "archivage pendant la session détecté");
  assert.match(app, /La source sélectionnée n’est plus associée à ce document/, "retrait d'association détecté");
  assert.match(app, /Choisissez la source qui recevra la page avant de confirmer/, "confirmation sans choix refusée");
  // Ressource indisponible.
  assert.match(app, /Cette ressource ne peut pas être vérifiée localement/, "ressource non vérifiable explicitement refusée");
  // Utilisateur non autorisé.
  assert.match(app, /if \(!isAdminUser\(\)\) \{\s*return toast\("L’initialisation de la page de transcription est réservée aux administrateurs/, "porte admin avant le dialog");
  assert.match(app, /if \(!isAdminUser\(\)\) return toast\("L’initialisation de la page de transcription est réservée aux administrateurs\.", "error"\);\s*const confirmButton/, "re-vérification admin à la confirmation");
  // Validation explicite de l'utilisateur.
  assert.match(html, /id="transcriptionPageInitDialog"/, "dialog d'initialisation présent");
  assert.match(html, /id="transcriptionPageInitConfirmBtn">Créer la page et transcrire</, "bouton de confirmation explicite");
  assert.match(html, /fichier du document n’est pas dupliqué/, "notice de non-duplication, neutre vis-à-vis du format");
  assert.match(html, /aria-label="Fermer"[^>]*data-close="transcriptionPageInitDialog"|data-close="transcriptionPageInitDialog"[^>]*aria-label="Fermer"/, "fermeture conforme à la convention");
  // Écriture uniquement par la révision admin existante.
  assert.match(app, /await genealogyStore\.reviseOfficial\(\{[\s\S]{0,280}fichier référencé, non dupliqué/, "écriture via reviseOfficial avec justification");
  assert.match(app, /prepareLegacyDocumentPage\(\{[\s\S]{0,220}sha256/, "préparation de la page avec empreinte calculée");
  // Affichage du JPEG sans duplication de fichier.
  assert.match(app, /LEGACY_DOCUMENT_IMAGE_PREFIX/, "résolution d'image par référence");
  assert.match(app, /async function resolveWorkshopImageSource\(\)/, "chargement de l'image à l'ouverture de l'atelier");
  assert.match(app, /void resolveWorkshopImageSource\(\);/, "résolution appelée à chaque rendu");
  assert.ok(!/\bsetDoc\b|\baddDoc\b/.test(workshop), "aucune écriture directe dans le module pur");
});

test("l’atelier est déclaré sans écriture des collections officielles", async () => {
  const [app, workshop, html, css] = await Promise.all([
    readFile(new URL("../js/app.js", import.meta.url), "utf8"),
    readFile(new URL("../js/transcription-workshop.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../css/design-system.css", import.meta.url), "utf8")
  ]);
  assert.match(app, /openTranscriptionWorkshop\(\)/, "point d’entrée de l’atelier");
  assert.match(app, /controls\.push\(\{ key: "transcribe", label: "Transcrire", icon: "edit" \}\)/, "action Transcrire dans le menu de la fiche");
  assert.match(app, /action === "transcribe"/, "routage de l’action Transcrire");
  assert.match(app, /action\.startsWith\("transcribe:"\)/, "choix explicite du document pour une source multi-JPEG");
  assert.match(app, /confirmTranscriptionWorkshopClose/, "confirmation avant fermeture");
  assert.match(app, /addEventListener\("beforeunload"/, "garde avant rechargement de la page");
  assert.match(app, /addEventListener\("popstate"/, "garde du retour système du navigateur");
  assert.doesNotMatch(app, /createPageTextRevision\(\{[\s\S]{0,120}workshop/, "aucune révision créée depuis l’atelier");
  assert.ok(!/from\s+["'][^"']*firebase/.test(workshop), "aucun import Firebase dans le module pur");
  assert.ok(!/\b(setDoc|addDoc|updateDoc|deleteDoc|onSnapshot|getDoc|getDocs|writeBatch|runTransaction)\s*\(/.test(workshop), "aucun accès Firestore dans le module pur");
  // Vue dédiée intégrée à la navigation, en place de la modale.
  assert.match(html, /id="transcriptionWorkshopView"/, "vue dédiée de l’atelier présente");
  assert.doesNotMatch(html, /id="transcriptionWorkshopDialog"/, "l’atelier n’est plus une modale");
  assert.match(app, /\$\("transcriptionWorkshopView"\)\.hidden = view !== "transcriptionWorkshop"/, "vue commutée par setView");
  assert.match(app, /if \(view !== "transcriptionWorkshop" && isTranscriptionWorkshopActive\(\)\)/, "confirmation exigée pour quitter via la navigation");
  assert.match(app, /function exitTranscriptionWorkshop\(\)/, "action Retour gérée");
  assert.match(html, /id="workshopBackBtn"[^>]*aria-label="Retour à la fiche d’origine"/, "action Retour contextuelle dans le fil d’Ariane");
  assert.match(html, /class="dedicated-page-header transcription-workshop-header"/, "l’atelier réutilise l’en-tête commun");
  assert.match(html, /aria-label="Fil d’Ariane"[\s\S]*?data-workshop-breadcrumb="documents"[\s\S]*?data-workshop-breadcrumb="document"[\s\S]*?aria-current="page">Transcription/, "fil d’Ariane vers les routes Documents, Document et Transcription");
  assert.match(app, /function navigateTranscriptionWorkshopBreadcrumb\(destination\)/, "retours du fil d’Ariane branchés sur des vues réelles");
  assert.match(css, /body:has\(#transcriptionWorkshopView:not\(\[hidden\]\)\) \.topbar \.main-nav \{ display: none !important; \}/, "méga-menu masqué uniquement quand l’atelier est actif sur desktop");
  assert.match(html, /class="btn small dedicated-page-back transcription-workshop-return"[^>]*id="workshopBackBtn"/, "Retour discret intégré à la ligne du fil d’Ariane");
  /* Le retour contextuel est placé à droite du fil d’Ariane ; le menu « … »
     et le statut restent dans le panneau de transcription. */
  const breadcrumb = html.slice(html.indexOf('aria-label="Fil d’Ariane"'), html.indexOf('</nav>', html.indexOf('aria-label="Fil d’Ariane"')));
  assert.ok(breadcrumb.includes('id="workshopBackBtn"'), "Retour intégré sur la ligne du fil d’Ariane");
  assert.ok(!breadcrumb.includes('id="workshopActionsMenu"'), "menu « … » retiré du fil d’Ariane");
  assert.ok(!breadcrumb.includes('id="workshopSaveStatus"'), "statut de sauvegarde retiré du fil d’Ariane");
  assert.doesNotMatch(html, /class="dedicated-page-return"/, "aucune ligne Retour indépendante ne subsiste");
  assert.ok(html.indexOf('id="workshopActionsMenu"') > html.indexOf('id="workshopPanelRight"'), "menu « … » unique déplacé dans le panneau de transcription");
  assert.ok(html.indexOf('id="workshopActionsMenu"') < html.indexOf('id="workshopPassageList"'), "menu « … » placé avant la liste des passages");
  /* Statut de sauvegarde : pied d'atelier, en bas du panneau de transcription
     (après le contenu éditable), jamais au-dessus du document. */
  assert.match(html, /class="transcription-workshop-footer"/, "pied d’atelier présent");
  assert.ok(html.indexOf('id="workshopSaveStatus"') > html.indexOf('id="workshopPassageList"'), "statut après la liste de transcription");
  assert.ok(html.indexOf('id="workshopSaveStatus"') > html.indexOf('id="workshopComparePanel"'), "statut en fin du panneau de transcription");
  assert.ok(html.indexOf('id="workshopSaveStatus"') > html.indexOf('id="transcriptionWorkshopView"'), "statut contenu dans la vue atelier");
  /* Navigation par pastilles et menu « … » uniques ; la sauvegarde manuelle
     a disparu au profit de l'autosauvegarde à 3 secondes. */
  assert.match(html, /id="workshopPassagePills"/, "navigation numérotée des passages présente");
  assert.match(html, /id="workshopAddPassageBtn"[^>]*aria-label="Ajouter un passage"/, "+ accessible et branché sur l’ajout existant");
  assert.doesNotMatch(html, /id="workshopPrevBtn"|id="workshopNextBtn"/, "Précédent/Suivant remplacés par les pastilles");
  assert.match(app, /function renderWorkshopPassageNavigation\(displayedPassages, selectedPassageId\)/, "rendu de la navigation numérotée");
  assert.match(app, /for \(let index = 0; index < displayedPassages\.length; index\+\+\)/, "tous les numéros sont rendus dans la même piste défilante");
  assert.match(app, /container\.scrollLeft \+= pill\.right - viewport\.right/, "passage sélectionné amené dans le champ visible");
  assert.match(app, /aria-current="step"/, "pastille active exposée aux technologies d’assistance");
  assert.doesNotMatch(html, /id="workshopSaveDraftBtn"/, "bouton manuel « Enregistrer » retiré de l’interface");
  assert.doesNotMatch(app, /event\.target\.closest\("#workshopSaveDraftBtn"\)/, "aucun gestionnaire de sauvegarde manuelle résiduel");
  assert.match(app, /TRANSCRIPTION_DRAFT_SAVE_DELAY_MS = 3000/, "autosauvegarde à 3 secondes conservée");
  assert.match(html, />Afficher l’aide</, "accès à l’aide du brouillon conservé dans le menu");
  assert.match(html, />Annuler les changements</, "« Annuler les changements » conservé dans le menu");
  assert.match(html, /data-workshop-mode="draft"[^>]*>Mon brouillon</, "mode brouillon accessible depuis le contrôle segmenté");
  assert.match(app, /event\.target\.closest\("#workshopHelpBtn"\)/, "divulgateur de l’aide rebranché sur le menu");
  assert.match(app, /event\.target\.closest\("\[data-workshop-mode\]"\)/, "les trois modes sont pilotés par le contrôle segmenté");
  assert.match(app, /some\(button => !button\.hidden && !button\.disabled\)/, "menu ⋯ limité aux actions secondaires disponibles");
  assert.ok(html.indexOf('id="workshopCancelEditBtn"') > html.indexOf('id="workshopPassageList"'), "« Annuler » déplacé dans le pied");
  assert.ok(html.indexOf('id="workshopValidateBtn"') > html.indexOf('id="workshopPassageList"'), "« Valider » déplacé dans le pied");
  assert.ok(html.indexOf('id="workshopModeBtn"') > html.indexOf('id="workshopPassageList"'), "« Modifier » rejoint le pied");
  /* Pied harmonisé : les trois boutons partagent la même règle ; le contrôle
     segmenté est masqué par défaut (état de consultation). */
  assert.match(html, /class="btn small transcription-workshop-edit-cta"[^>]*id="workshopModeBtn"/, "« Modifier » partage le style des actions du pied");
  assert.match(html, /class="transcription-workshop-mode"[^>]*hidden/, "contrôle segmenté masqué par défaut (consultation)");
  assert.match(app, /querySelector\("\.transcription-workshop-mode"\)/, "contrôle segmenté piloté depuis l’état d’édition");
  assert.match(app, /modeSwitch\.hidden = !inEditSession/, "segmenté visible uniquement pendant l’édition");
  assert.match(app, /modeButton\.hidden = inEditSession \|\| !hasOfficial/, "« Modifier » réservé à la consultation");
  /* Barre d’outils de la visionneuse : même grammaire que la fiche Document,
     calée à gauche, texte « Ajusté » retiré. */
  const imageTools = html.match(/<div class="transcription-workshop-tools viewer-image-controls" id="workshopImageTools">[\s\S]*?<\/div><div class="genealogy-inline-actions" id="workshopPageNav">/)?.[0] || "";
  assert.ok(imageTools, "barre d’outils image avec la grammaire de la fiche Document");
  assert.ok(html.indexOf('id="workshopImageTools"') < html.indexOf('id="workshopPageNav"'), "outils à gauche, navigation des pages ensuite");
  assert.ok(imageTools.indexOf("#icon-zoom-out") < imageTools.indexOf("#icon-zoom-in"), "Zoom − puis Zoom +");
  assert.ok(imageTools.indexOf('class="viewer-image-zoom-group"') < imageTools.indexOf("#icon-zoom-out"), "groupe de zoom jointif englobant les deux boutons, comme la fiche Document");
  assert.ok(imageTools.indexOf("#icon-zoom-in") < imageTools.indexOf("#icon-fit-width"), "Ajuster après Zoom +");
  assert.ok(imageTools.indexOf("#icon-fit-width") < imageTools.indexOf("#icon-maximize"), "Plein écran en dernier");
  assert.doesNotMatch(html, /workshopZoomLabel/, "texte « Ajusté » retiré de la barre");
  assert.doesNotMatch(css, /\.transcription-workshop-zoom-label \{/, "règles du texte « Ajusté » supprimées");
  assert.match(css, /#workshopImageTools \{ justify-content: flex-start;/, "outils alignés à gauche, jamais centrés");
  /* Validation en ligne des passages : Annuler puis Valider dans le groupe
     d'actions existant, accès à l'officiel préservé dans le menu secondaire. */
  assert.match(html, /id="workshopCancelEditBtn"[^>]*aria-label="Annuler la révision"[^>]*hidden/, "annulation disponible en mode édition seulement");
  assert.match(html, /id="workshopValidateBtn"[^>]*aria-label="Valider la révision"[^>]*hidden/, "validation en ligne, masquée en lecture seule");
  assert.ok(html.indexOf('id="workshopCancelEditBtn"') < html.indexOf('id="workshopValidateBtn"'), "ordre Annuler puis Valider");
  assert.doesNotMatch(html, /id="workshopViewOfficialMenuBtn"/, "accès officiel redondant retiré du menu après ajout du contrôle principal");
  assert.doesNotMatch(html, /dedicated-page-actions-row">\s*<button[^>]*id="workshopValidateBtn"/, "aucune validation officielle dans l'en-tête supérieur");
  assert.match(html, /id="transcriptionValidationDialog"/, "dialogue de confirmation de validation");
  assert.match(html, /id="workshopOfficialBadge"[^>]*hidden/, "badge d'état officiel dans la barre du panneau");
  assert.match(html, /id="workshopHistoryBtn"/, "accès « Historique » conservé");
  assert.ok(html.indexOf('id="workshopHistoryBtn"') < html.indexOf('id="workshopPassageList"'), "« Historique » regroupé dans le menu « … » du panneau");
  assert.match(html, /id="workshopConflictBtn"[^>]*hidden/, "« Résoudre » présent mais masqué sans conflit");
  assert.match(html, /id="transcriptionHistoryDialog"/, "dialogue d'historique responsive");
  assert.match(app, /hasTranscriptionContent\(draft\.passages\)/, "texte italien vide interdit pour la validation");
  assert.match(app, /expectedRevisionId: freshHead\.revisionId/, "version courante revérifiée avant validation");
  assert.match(app, /navigator\.onLine/, "validation officielle réservée à la connexion");
  assert.match(app, /genealogyStore\.createOfficial\(\{\s*type: "transcription"/, "première validation via la création officielle atomique");
  assert.match(app, /genealogyStore\.reviseOfficial\(\{[\s\S]*?type: "transcription"/, "révision via la révision officielle atomique");
  /* Repli du volet Document (desktop) : état de vue pur. */
  assert.match(html, /id="workshopPanelCollapseBtn"[^>]*aria-label="Masquer le document"/, "commande de repli dans la barre du document");
  assert.match(html, />Afficher le document</, "commande de réouverture en haut de la zone de travail");
  assert.match(css, /\.transcription-workshop-layout\.is-document-collapsed \{ grid-template-columns: minmax\(0, 1fr\); \}/, "état de repli : transcription seule");
  assert.doesNotMatch(css, /#workshopValidateLabel \{ display: none;/, "libellé Valider visible sur mobile");
  assert.match(css, /\.transcription-workshop-footer-actions \.transcription-workshop-edit-cta \{[^}]*min-height: var\(--control-touch\)/, "cibles tactiles égales pour Annuler/Valider");
  assert.match(html, /id="workshopBackBtn"[^>]*aria-label="Retour à la fiche d’origine"[^>]*title="Retour à la fiche d’origine"/, "retour contextuel accessible et discret");
  assert.match(css, /\.btn\.transcription-workshop-return \{[^}]*height: var\(--control-touch\)/, "Retour en bouton secondaire de 44 px");
  assert.match(css, /\.btn\.transcription-workshop-return \{[^}]*border: 1px solid var\(--color-border\)[^}]*background: var\(--color-surface\)/, "Retour avec bordure discrète et fond clair");
  assert.match(app, /function teardownTranscriptionWorkshop\(\)/, "nettoyage du lecteur à la sortie");
  for (const tab of ["Original", "Italien", "Français"]) assert.ok(html.includes(`>${tab}</button>`), `onglet ${tab} présent`);
  assert.match(html, /id="workshopPassagePills"/, "pastilles de navigation des passages présentes");
  assert.doesNotMatch(html, /id="workshopPrevBtn"|id="workshopNextBtn"/, "commandes Précédent/Suivant retirées");
  assert.match(html, /data-workshop-mode="official"[^>]*>Version officielle</, "mode officiel dans le contrôle segmenté");
  assert.match(html, /data-workshop-mode="diff"[^>]*>Différences</, "mode différences dans le contrôle segmenté");
  assert.match(app, /comparePageTextRevisions\([\s\S]{0,260}official\.passages[\s\S]{0,180}draft\.passages/, "comparaison fondée sur les versions officielles et brouillon réellement disponibles");
  assert.match(app, /transcription-workshop-diff-added/, "ajouts différenciés en ligne");
  assert.match(app, /transcription-workshop-diff-removed/, "suppressions différenciées en ligne");
  assert.match(app, /Aucune comparaison possible : il n’existe pas encore de version officielle/, "état explicite sans version comparable");
  assert.doesNotMatch(html, /data-workshop-compare=|id="workshopCompareMenuBtn"|>Comparer</, "actions de comparaison redondantes retirées des cartes et du menu");
  assert.match(html, /id="workshopSaveStatus"[^>]*role="status"[^>]*>Brouillon local</, "statut compact « Brouillon local » annoncé comme statut");
  assert.doesNotMatch(html, /id="workshopDraftBadge"/, "l’ancienne pastille de remplacement a disparu");
  assert.match(css, /\.transcription-workshop-save-status \{[^}]*font-size: var\(--text-xs\)/, "statut compact en texte discret");
  assert.doesNotMatch(css, /\.transcription-workshop-draft \{/, "l’ancienne grande pastille n’existe plus");
  assert.match(html, /Les corrections sont enregistrées localement dans ce navigateur et reprises automatiquement à la prochaine ouverture\./, "aide mise à jour : les brouillons sont conservés, plus perdus");
  assert.match(html, /Elles ne sont pas encore enregistrées officiellement ni synchronisées entre appareils\./, "précision explicite : local seulement, pas de synchronisation entre appareils");
  assert.doesNotMatch(html, /seront perdues à la fermeture ou au rechargement/, "l'ancien avertissement de perte est retiré");
  assert.doesNotMatch(html, /id="workshopLossWarning"/, "aucun bandeau de perte permanent ne double le badge brouillon");
  assert.match(app, /classList\.toggle\("is-dirty", dirty\)/, "le badge unique signale les modifications non enregistrées");
  assert.match(app, /confirmTranscriptionWorkshopClose/, "une confirmation explicite protège toujours les brouillons à la sortie");
  assert.ok(html.includes('id="workshopAddPassageBtn"'), "bouton d’ajout de passage accessible");
  assert.match(html, /id="workshopAddPassageBtn"[^>]*aria-label="Ajouter un passage"[^>]*>\+<\/button>/, "+ est le bouton d’ajout accessible");
  assert.match(html, /id="workshopDivider"[^>]*role="separator"/, "séparateur de redimensionnement");
  for (const button of html.match(/<button[^>]*id="workshop[^>]*>/g)) {
    assert.match(button, /\btype="button"/, `bouton atelier sans type explicite : ${button}`);
  }
  // Deux panneaux sur ordinateur, onglets et filtres de champs sur mobile.
  assert.match(css, /grid-template-columns: minmax\(0, var\(--workshop-split, 55%\)\) auto minmax\(0, 1fr\)/, "deux zones de travail 55/45 redimensionnables");
  assert.doesNotMatch(css, /\.transcription-workshop-passage \{ display: grid;/, "sections de passage toujours empilées, jamais sur deux colonnes");
  assert.doesNotMatch(css, /\.transcription-workshop-passage \{[^}]*grid-template-columns/, "aucune largeur de colonne imposée aux sections italien/français");
  /* A3 mobile : toutes les nouvelles règles sont bornées au bloc atelier
     ≤ 760 px — desktop strictement inchangé au-delà de ce seuil. */
  const workshopMobileStart = css.indexOf("/* En-tête mobile compact");
  const workshopMobileEnd = css.indexOf("@media (min-width: 981px)", workshopMobileStart);
  assert.ok(workshopMobileStart >= 0 && workshopMobileEnd > workshopMobileStart, "bloc atelier mobile localisé");
  const workshopMobileA3 = css.slice(workshopMobileStart, workshopMobileEnd);
  assert.ok(workshopMobileA3.includes(".transcription-workshop-breadcrumb > span { display: none; }"), "fil d’Ariane mobile remplacé par l’en-tête dédié");
  assert.ok(workshopMobileA3.includes("body:has(#transcriptionWorkshopView:not([hidden])) .topbar .main-nav { display: none !important; }"), "navigation générale masquée uniquement dans l’atelier mobile");
  assert.ok(workshopMobileA3.includes(".transcription-workshop-passage:not(.is-selected) { display: none; }"), "un seul passage visible à la fois sur mobile");
  assert.ok(workshopMobileA3.includes("padding-bottom: max(var(--space-1), env(safe-area-inset-bottom, 0px))"), "safe area inférieure respectée sans cumul d'espace superflu");
  assert.doesNotMatch(workshopMobileA3, /is-keyboard-open \.transcription-workshop-footer-actions \{ display: none;/, "actions importantes conservées pendant le clavier virtuel");
  assert.match(app, /function bindWorkshopVirtualKeyboard\(\)/, "cycle de vie du clavier virtuel");
  assert.match(app, /visualViewport\.addEventListener\("resize", onViewportChange\)/, "écoute de visualViewport");
  assert.match(app, /removeEventListener\("resize", onViewportChange\)/, "nettoyage des listeners du clavier");
  assert.match(css, /\.transcription-workshop-menu-panel \{/, "menu secondaire d’en-tête");
  assert.match(css, /\.btn\.transcription-workshop-return \{[^}]*margin-inline-start: auto/, "Retour aligné à droite du fil d’Ariane");
  assert.match(css, /\.transcription-workshop-heading h2 \{[^}]*-webkit-line-clamp: 2/, "titre Atelier lisible sur deux lignes maximum");
  assert.match(css, /\.transcription-workshop-passage\.is-selected \{ flex: 1 0 auto; min-height: 0;/, "le passage actif utilise la hauteur disponible");
  assert.match(css, /\.transcription-workshop-passage textarea \{ width: 100%; flex: 1 1 auto; min-height: clamp\(8rem, 24dvh, 16rem\)[^}]*field-sizing: content/, "champs de hauteur adaptée au contenu avec plafond anti-scroll imbriqué");
  assert.match(app, /class="transcription-workshop-delete-passage"[^>]*data-workshop-delete-passage/, "suppression de passage visible dans son contexte");
  assert.match(app, /Supprimer le passage \$\{passageIndex \+ 1\} du brouillon \? La zone associée sera supprimée avec lui/, "confirmation précise avant suppression du passage et de sa zone");
  assert.match(css, /\.transcription-workshop-delete-passage \{[^}]*color: var\(--color-danger\)/, "suppression contextuelle discrète et distincte");
  assert.match(app, /transcription-workshop-desktop-passage-number/, "numéro inclus dans les en-têtes de transcription desktop");
  assert.match(css, /\.transcription-workshop-passage textarea:disabled \{[^}]*color: var\(--color-text\)[^}]*-webkit-text-fill-color: var\(--color-text\)/, "transcription de consultation contrastée y compris sous Safari");
  assert.match(css, /#transcriptionValidationDialog \.modal-actions > \[data-close\][\s\S]{0,300}color: var\(--color-danger\)/, "Annuler des confirmations en action textuelle rouge");
  assert.match(css, /#transcriptionDraftConflictDialog \.modal-actions > \[data-close\][\s\S]{0,300}color: var\(--color-text\)/, "Fermer du conflit en action textuelle neutre");
  assert.match(css, /\.transcription-workshop-image-viewport > img \{ position: absolute/, "zone d’ancrage suivant les offsets du lecteur");
  /* B1 : délimitation graphique — éditeur temporaire masqué au repos, écriture
     seulement après confirmation, gestes du lecteur neutralisés au tracé. */
  assert.match(html, /id="workshopZoneEditor"[^>]*hidden/, "éditeur de zone présent et masqué au repos");
  assert.match(html, /id="workshopZoneActions"[^>]*hidden/, "commandes du mode tracé masquées au repos");
  assert.match(html, /id="workshopZoneConfirmBtn"[^>]*disabled/, "confirmation indisponible sans rectangle tracé");
  assert.equal((html.match(/data-zone-handle=/g) || []).length, 8, "quatre poignées par éditeur de zone (photographie et PDF)");
  assert.match(app, /function startWorkshopZoneTool\(mode\)/, "mode de tracé piloté par l’application");
  assert.match(app, /function confirmWorkshopZoneTool\(\)/, "écriture de la zone seulement après confirmation");
  assert.match(app, /guardWorkshopZoneViewerGestures/, "gestes du lecteur neutralisés pendant le tracé");
  assert.doesNotMatch(css, /is-zone-editing #workshopPdfTools/, "pagination PDF non figée pendant le tracé (navigation en mode modification)");
  /* Sortie d'édition : texte raccourci, libellés courts et actions
     restructurées pour le responsive — mêmes identifiants, mêmes logiques. */
  assert.match(html, /id="transcriptionEditCancelDescription">Votre révision n’est pas encore validée\./, "texte de sortie d’édition raccourci");
  assert.match(html, /id="workshopCancelContinueBtn">Continuer</, "libellé « Continuer »");
  assert.match(html, /id="workshopCancelDiscardBtn">Abandonner</, "libellé « Abandonner »");
  assert.match(html, /id="workshopCancelKeepBtn">Conserver le brouillon</, "libellé « Conserver le brouillon »");
  assert.match(html, /class="modal-actions transcription-edit-cancel-actions"/, "actions de sortie structurées pour le responsive");
  /* Conflit de brouillon : libellés long et court, hiérarchie neutre,
     comparaison à hauteur adaptée avec plafond de défilement. */
  assert.match(html, /id="transcriptionDraftConflictKeepLocalBtn"><span class="conflict-label-long">Conserver la version de cet appareil<\/span><span class="conflict-label-short">Version de cet appareil<\/span>/, "libellés long et court du choix local");
  assert.match(html, /<button class="btn" type="button" id="transcriptionDraftConflictKeepLocalBtn">/, "aucun choix de conflit en action principale (hiérarchie neutre)");
  assert.match(app, /field\.rows = 1;\s*\r?\n\s*field\.style\.height = "auto";/, "hauteur de comparaison recalculée depuis le contenu");
  assert.match(css, /\.transcription-draft-conflict-version \.field \{[^}]*max-height: min\(34vh, 18rem\)/, "plafond de défilement pour les comparaisons longues");
  /* Pied compact : un seul statut (doublon Firestore retiré), libellés courts. */
  assert.doesNotMatch(html, /id="workshopRemoteStatus"/, "second statut Firestore retiré du pied");
  assert.match(css, /\.transcription-workshop-autosave-hint \{ display: none; \}/, "aide d’autosauvegarde masquée sur mobile");
  assert.match(app, /offline \? "Hors ligne"/, "statut hors ligne court");
  assert.match(app, /localFailed \? "Erreur de sauvegarde"/, "statut d’erreur de sauvegarde court");
  assert.match(app, /window\.addEventListener\("resize", \(\) => \{\s*if \(isTranscriptionWorkshopActive\(\)\) scheduleWorkshopZoneSync\(\);/, "réalignement de la zone sur redimensionnement de fenêtre");
  assert.match(css, /\.transcription-workshop-zone-editor \{ position: absolute; z-index: 12;/, "éditeur superposé à l’image");
  assert.match(css, /\.transcription-workshop-zone-actions \{/, "commandes du tracé sous la photographie");
  /* B2 : surface PDF de l'atelier — moteur PDF.js partagé, commandes scopées,
     zone épinglée à l'empreinte du fichier. */
  assert.match(html, /id="workshopPdfSurface"[^>]*hidden/, "surface PDF masquée au repos");
  assert.match(html, /id="workshopPdfTools"[^>]*hidden/, "pagination PDF masquée au repos");
  assert.match(html, /id="workshopPdfZoneEditor"[^>]*hidden/, "éditeur de zone PDF masqué au repos");
  assert.match(app, /function resolveWorkshopPdfContext\(context\)/, "résolution PDF de l’atelier");
  assert.match(app, /function createWorkshopPdfViewer\(\)/, "instance PDF dédiée à l’atelier");
  assert.match(app, /fileSha256: context\.pdf\.fileSha256/, "ancre PDF épinglée à l’empreinte du fichier");
  assert.match(app, /onPageRenderStart/, "overlay masqué pendant les rendus PDF asynchrones");
  assert.match(css, /\.transcription-workshop-pdf-surface \{/, "styles de la surface PDF atelier");
  // Brouillons multipages : conservation pendant la session, confirmation seulement à la fermeture.
  assert.match(app, /transcriptionWorkshopDrafts = new Map\(\)/, "carte de brouillons par page");
  assert.match(app, /function transcriptionWorkshopHasUnsavedChanges\(\)/, "dirty global sur toutes les pages");
  assert.match(app, /if \(existing\?\.dirty\)/, "restauration du brouillon existant au retour sur une page");
  assert.doesNotMatch(app, /function setWorkshopPage[\s\S]{0,300}confirm\(/, "aucune confirmation au changement de page");
  assert.match(app, /for \(const draft of transcriptionWorkshopDrafts\.values\(\)\) resetTranscriptionWorkshopDraft\(draft\)/, "abandon global sur toutes les pages");
  assert.match(app, /transcriptionWorkshopDrafts\.clear\(\)/, "vidage de la session à la fermeture");
  // Ajout et suppression de passages.
  assert.match(app, /addTranscriptionWorkshopPassage\(draft/, "ajout branché sur le module pur");
  assert.match(app, /removeTranscriptionWorkshopPassage\(draft, passageId\)/, "suppression branchée sur le module pur");
  assert.match(app, /data-workshop-delete-passage/, "bouton de suppression dans chaque passage éditable");
  assert.match(app, /const deleteAction = editable\s*\?/, "suppression des passages créés ou hérités dans le brouillon");
  assert.match(app, /Ajoutez un passage pour commencer/, "état vide orienté action");
  assert.match(css, /\.transcription-workshop-passage-nav \.btn[^\{]*\{ min-width: var\(--control-touch\)/, "cibles tactiles ≥ 44 px pour navigation des passages");
  assert.match(css, /\.transcription-workshop-passage-pill\.btn\.is-active \{ border-color: var\(--color-brand\); background: var\(--color-brand\); color: var\(--color-surface-raised\); \}/, "pastille active clairement repérée");
  assert.match(css, /\.transcription-workshop-passage-pill\.btn \{[^}]*border-radius: var\(--radius-md\)/, "pastilles légèrement rectangulaires");
  assert.match(css, /\.transcription-workshop-add-passage \{[^}]*border-radius: var\(--radius-md\)/, "+ aligné sur le rayon des pastilles");
  assert.match(css, /\.transcription-workshop-passage-pill\.btn \{[^}]*color: var\(--color-text\)/, "numéro des pastilles inactives en fond foncé lisible");
  /* Bloc mobile atelier : en-tête empilé + onglets dépliés. Extrait tel quel
     pour rester insensible aux longueurs de commentaires de style. */
  const workshopMobileBlock = css.match(/@media \(max-width: 760px\) \{\s*\/\* En-tête mobile compact[\s\S]*?\.transcription-workshop-tabs \{ display: flex; \}/)?.[0] || "";
  assert.ok(workshopMobileBlock, "bloc mobile de l’atelier présent");
  assert.match(workshopMobileBlock, /\.transcription-workshop-header \{ display: block;/, "en-tête atelier empilé sur mobile");
  assert.match(workshopMobileBlock, /\.transcription-workshop-tabs \{ display: flex; \}/, "onglets mobiles");
  assert.match(css, /\.transcription-workshop-passage\.is-selected/, "sélection de passage visible");
  assert.match(css, /--control-touch/, "cibles tactiles via le token existant");
});

test("les brouillons sont persistés localement et repris sans toucher aux modules purs", async () => {
  const [app, html, workshop, documentTranscription, storageAdapter] = await Promise.all([
    readFile(new URL("../js/app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/transcription-workshop.js", import.meta.url), "utf8"),
    readFile(new URL("../js/document-transcription.js", import.meta.url), "utf8"),
    readFile(new URL("../js/transcription-draft-storage.js", import.meta.url), "utf8")
  ]);
  // Reprendre automatiquement à l'ouverture : mémoire d'abord (seulement si le
  // brouillon appartient au compte courant), sinon l'espace local du compte.
  assert.match(
    app,
    /\(sessionOwned \? sessionDraft : null\) \|\| restoreTranscriptionWorkshopDraftFromStorage\(context\.documentId, page\.id, ownerUid\)/,
    "reprise du brouillon du compte courant à l'ouverture"
  );
  assert.match(app, /restoreTranscriptionWorkshopDraft\(stored\.record\.snapshot\)/, "snapshot revalidé par le module pur avant import");
  assert.match(app, /stampTranscriptionDraftOwner\(draft, ownerUid\)/, "propriétaire stampé à la restauration");
  // Sauvegarde automatique, différée et sans écriture inutile.
  assert.match(app, /scheduleTranscriptionWorkshopDraftSave\(transcriptionWorkshopDraft\)/, "programmation à chaque édition");
  assert.match(app, /const TRANSCRIPTION_DRAFT_SAVE_DELAY_MS = 3000;/, "regroupement des frappes pendant trois secondes avant écriture");
  assert.match(app, /transcriptionDraftLastSnapshots\.get\(key\) === snapshotPayload/, "dernier contenu écrit dédupliqué");
  // Horodatage et refus d'écraser une version plus récente (dans l'espace du propriétaire).
  assert.match(app, /buildTranscriptionDraftRecord\(draft, new Date\(\)\.toISOString\(\)\)/, "horodatage de dernière sauvegarde");
  assert.match(app, /transcriptionDraftWriteBlockReason\(storage, draft\.documentId, draft\.pageId, state\?\.savedAt \|\| null, ownerUid\)/, "comparaison avec la dernière version connue avant écriture, chez le propriétaire");
  assert.match(app, /writeTranscriptionDraft\(storage, draft\.documentId, draft\.pageId, record, ownerUid\)/, "écriture local dans l'espace privé du propriétaire");
  assert.match(app, /if \(\(draft\.ownerUid \?\? null\) !== ownerUid\) return;/, "jamais de synchronisation d'un brouillon qui n'appartient pas au compte courant");
  assert.match(app, /TRANSCRIPTION_DRAFT_CONFLICT_MESSAGE/, "avertissement explicite d'une version plus récente");
  // Échec de stockage : avertissement, mémoire conservée, aucune suppression.
  assert.match(app, /Sauvegarde locale impossible : le stockage du navigateur est indisponible ou complet\./, "échec annoncé en clair");
  assert.match(app, /Vos modifications restent en mémoire dans l’atelier\./, "conservation en mémoire en cas d'échec");
  assert.match(app, /function markTranscriptionWorkshopDraftSaveFailure\(key, status, message\)/, "état d'échec marqué par brouillon");
  assert.equal((app.match(/transcriptionWorkshopDrafts\.clear\(\)/g) || []).length, 1, "la mémoire des brouillons n'est vidée qu'à la fermeture de l'atelier");
  assert.match(app, /function resetTranscriptionWorkshopState[\s\S]{0,650}transcriptionWorkshopDrafts\.clear\(\)/, "effacement réservé à la fermeture de l'atelier, jamais après un échec");
  // États affichés discrètement sur le badge.
  for (const label of ["Enregistrement…", "Enregistré", "Hors ligne", "Erreur de sauvegarde"]) {
    assert.ok(app.includes(`"${label}"`), `état de sauvegarde affiché : ${label}`);
  }
  // Fermeture / rechargement : écriture avant jugement, confirmation seulement si non conservé.
  assert.match(app, /flushTranscriptionWorkshopDraftSaves\(\);\s*\n\s*if \(!transcriptionWorkshopHasUnsavedLocalChanges\(\)\) return true;/, "confirmation conditionnée aux écritures réellement échouées");
  assert.match(app, /function transcriptionWorkshopHasUnsavedLocalChanges\(\)/, "predicate dédié aux écritures non conservées");
  assert.match(app, /window\.addEventListener\("pagehide", flushTranscriptionWorkshopDraftSaves\)/, "écriture au rechargement ou à la fermeture de l'onglet");
  assert.match(app, /flushTranscriptionWorkshopDraftSaves\(\);\s*\n\s*unbindTranscriptionWorkshopMenu\(\);\s*\n\s*transcriptionWorkshopDraft = null;/, "dernière écriture et fermeture du menu avant l'effacement de la session");
  assert.match(app, /addEventListener\("beforeunload"/, "garde conservée pour les écritures non conservées");
  // Sortie : écriture immédiate avant toute navigation (bouton Retour, retour système).
  assert.match(app, /flushTranscriptionWorkshopDraftSaves\(\);\s*\n\s*const target = transcriptionWorkshopReturn;/, "Retour de l'atelier écrit les sauvegardes avant navigation");
  // Jamais de destruction sur un échec de lecture ou de restauration.
  const restoreFn = app.match(/function restoreTranscriptionWorkshopDraftFromStorage[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(restoreFn, "restauration locale présente");
  assert.equal(
    (restoreFn.match(/removeTranscriptionDraft\(/g) || []).length,
    1,
    "la seule suppression de la restauration est le nettoyage nominal d'un brouillon propre"
  );
  assert.match(app, /blockReason === "unreadable" \? TRANSCRIPTION_DRAFT_UNREADABLE_MESSAGE/, "enregistrement illisible signalé, jamais réécrit");
  assert.match(app, /Rien n’a été effacé : il reste conservé dans ce navigateur/, "restauration en échec annoncée sans perte");
  assert.match(app, /\$\("workshopSaveStatus"\)\.textContent = "Brouillon local"/, "statut réinitialisé à la fermeture");
  // Menu « … » : fermeture extérieure, Échap, action, sortie — périmètre strict.
  assert.match(app, /function onTranscriptionWorkshopMenuOutside\(event\)/, "écouteur de clic extérieur dédié");
  assert.match(app, /if \(!menu\?\.open \|\| menu\.contains\(event\.target\)\) return;/, "seul un clic hors du menu le ferme");
  assert.match(app, /function onTranscriptionWorkshopMenuKeydown\(event\)[\s\S]{0,300}menu\.open = false;/, "Échap ferme le menu et rien d'autre");
  assert.match(app, /bindTranscriptionWorkshopMenu\(\);/, "écouteurs vivant pendant l'atelier actif");
  assert.match(app, /unbindTranscriptionWorkshopMenu\(\);\s*\n\s*transcriptionWorkshopDraft = null;/, "écouteurs détachés à la sortie de l'atelier");
  assert.match(app, /closeTranscriptionWorkshopMenu\(\);\s*\n\s*if \(!transcriptionWorkshopHasUnsavedChanges\(\)\) return;/, "menu fermé après sélection d'une action");
  // Cohérence des clés : la page est indexée par le document qui la porte réellement.
  assert.match(app, /isLegacyDocumentPhotograph\(photo\)/, "résolution du document porteur de la page (clé documentId|pageId cohérente entre entrées)");
  assert.match(app, /resolvedDocumentId === record\?\.id \|\| !resolvedDocumentId/, "harmonisation depuis la fiche Source ou une transcription orpheline");
  // Abandon explicite confirmé : retrait limité aux brouillons de cet atelier.
  assert.match(app, /removeTranscriptionWorkshopDraftRecord\(draft\)/, "retrait de la copie locale après abandon confirmé");
  assert.match(app, /removeTranscriptionWorkshopDraftRecordFor\(transcriptionWorkshopContext\.documentId, page\.id\)/, "retrait aussi pour les pages jamais ouvertes du document courant");
  assert.doesNotMatch(app, /localStorage\.clear\(\)/, "aucun effacement global du stockage");
  // Périmètre : les modules purs restent exempts de stockage et de Firebase.
  assert.doesNotMatch(workshop, /localStorage/, "aucun localStorage dans le module pur d'atelier");
  assert.doesNotMatch(documentTranscription, /localStorage/, "aucun localStorage dans le module pur de transcription");
  assert.doesNotMatch(storageAdapter, /from\s+["'][^"']*firebase/i, "aucun import Firebase dans l'adaptateur de persistance");
  assert.doesNotMatch(storageAdapter, /\b(setDoc|addDoc|updateDoc|deleteDoc|runTransaction|writeBatch)\s*\(/, "aucune écriture Firestore dans l'adaptateur de persistance");
  assert.doesNotMatch(storageAdapter, /window\.|document\./, "l'adaptateur ne touche ni DOM ni fenêtre : stockage injecté");
  assert.match(html, /reprises automatiquement à la prochaine ouverture/, "aide utilisateur alignée sur la persistance");
});

/* Harnais navigateur partagé : fixture JPEG avec passages officiels, hooks
   injectés dans le scope module de js/app.js (même technique que les tests
   de pages dédiées). */
const WORKSHOP_TEST_SVG = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="#b8c9be"/></svg>');
const WORKSHOP_TEST_HOOKS = `
window.__repro = {
  show() { $("authScreen").hidden = true; $("topbar").hidden = false; setView("directory"); },
  seed() {
    const documentItem = {
      id: "doc-repro", title: "Registre Transactions Immobilières",
      type: "Registre", date: "1891-05-12",
      fileName: "registre.jpg", mimeType: "image/jpeg",
      fileData: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEQAD8kf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIDAT8kf//Z",
      personIds: [],
      pages: [{ id: "page-repro-1", label: "Folio 1", photographs: [{ id: "photo-repro-1", preview: { dataUrl: "${WORKSHOP_TEST_SVG}" } }],
        passages: [
          { id: "p-1", order: 0, textIt: "Anno millenovecento", translationFr: "L’année mille neuf cent", separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 1", translationState: "current" },
          { id: "p-2", order: 1, textIt: "indici di Orino", translationFr: null, separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 2", translationState: "not-started" }
        ]
      }]
    };
    documents = [documentItem];
    people = [];
    loadedPeople = loadedDocuments = true;
    genealogyRecords = { sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [], genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [] };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin" };
    renderGenealogyWorkspace();
  },
  openDoc() { setView("directory"); openStoredDocument(documents[0], "directory"); },
  transcribe() { const b = document.querySelector("#viewerDocumentDetails [data-transcribe-document]"); if (b) b.click(); },
  badge() { return $("workshopSaveStatus").textContent; },
  /* Le callback d'authentification du harnais peut réinitialiser le profil
     après le seed : ce rappel rétablit explicitement l'administrateur simulé. */
  useAdminProfile() { currentUserProfile = { role: "admin" }; updateWorkshopDraftIndicators(); },
  fields() { return [...document.querySelectorAll("[data-workshop-field]")].map(f => ({ p: f.dataset.workshopPassage, k: f.dataset.workshopField, v: f.value })); },
  stored() { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("familyTreeTranscriptionDraft:")) out.push([k, localStorage.getItem(k)]); } return out; },
  /* A3 : simulation du clavier virtuel — mêmes fonctions que le cycle de vie
     réel (visualViewport), pilotées depuis le scope du module applicatif. */
  keyboard: {
    setBaseline(value) { workshopViewportBaseline = value; },
    sync(viewport) { syncWorkshopKeyboardState(viewport); }
  }
};`;

/* Harnais d'auth du test mobile : sans utilisateur connecté, le callback
   onAuthStateChanged (différé, souvent plus tardif en WebKit qu'en Chromium)
   déclenche stopPrivateData/showAuthPanel et ferme la page via
   closeDocumentPage — un bootstrap sans rapport avec le comportement UX
   mesuré. Neutralisé ici uniquement, jamais dans l'application. */
const WORKSHOP_AUTH_PATCH = `
window.__ignoreAuthBootstrap = true;
const originalStopPrivateData = stopPrivateData;
stopPrivateData = (...args) => { if (window.__ignoreAuthBootstrap) return; return originalStopPrivateData(...args); };
const originalShowAuthPanel = showAuthPanel;
showAuthPanel = (...args) => { if (window.__ignoreAuthBootstrap) return; return originalShowAuthPanel(...args); };
const originalCloseDocumentPage = closeDocumentPage;
closeDocumentPage = (...args) => {
  if (window.__ignoreAuthBootstrap && String(new Error().stack || "").includes("firebase-auth")) return;
  return originalCloseDocumentPage(...args);
};
`;

/* Parcours réel en navigateur (régression des corrections) : saisie →
   enregistré → Enregistrer immédiat → position du Retour → menu « … » →
   Retour → réouverture → rechargement → abandon confirmé. */
test("régression atelier : le brouillon survit à la fermeture, à la réouverture et au rechargement", { timeout: 120000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const hooks = WORKSHOP_TEST_HOOKS;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      return route.fulfill({ response, body: `${await response.text()}\n${hooks}` });
    }
    return url.startsWith(server.baseURL) || url.includes("gstatic.com") ? route.continue() : route.abort("blockedbyclient");
  });
  const dialogs = [];
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__repro === "object");
    const boot = async () => page.evaluate(() => { window.__repro.show(); window.__repro.seed(); });
    const openWorkshop = async () => {
      await page.evaluate(() => window.__repro.openDoc());
      await page.waitForSelector("#viewerDocumentDetails [data-transcribe-document]");
      await page.evaluate(() => window.__repro.transcribe());
      await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    };
    await boot();
    await openWorkshop();
    assert.equal(await page.evaluate(() => window.__repro.badge()), "Brouillon local", "badge initial au repos");

    /* En-tête desktop compact (modèle fiche Document) et statut de sauvegarde
       en pied du panneau de transcription — jamais dans l'en-tête, jamais côté
       photographie. */
    const desktopLayout = await page.evaluate(() => {
      const header = document.querySelector(".transcription-workshop-header").getBoundingClientRect();
      const status = document.getElementById("workshopSaveStatus").getBoundingClientRect();
      const list = document.getElementById("workshopPassageList").getBoundingClientRect();
      const divider = document.getElementById("workshopDivider").getBoundingClientRect();
      const panelRight = document.getElementById("workshopPanelRight").getBoundingClientRect();
      return {
        headerHeight: Math.round(header.height),
        statusTop: Math.round(status.top),
        statusLeft: Math.round(status.left),
        statusHeight: Math.round(status.height),
        headerBottom: Math.round(header.bottom),
        listBottom: Math.round(list.bottom),
        dividerRight: Math.round(divider.right),
        panelRightTop: Math.round(panelRight.top),
        panelRightBottom: Math.round(panelRight.bottom),
        inHeader: !!document.getElementById("workshopSaveStatus").closest(".transcription-workshop-header"),
        inRightPanel: !!document.getElementById("workshopSaveStatus").closest("#workshopPanelRight"),
        inFooter: !!document.getElementById("workshopSaveStatus").closest(".transcription-workshop-footer")
      };
    });
    assert.ok(desktopLayout.headerHeight <= 105, `en-tête desktop compact (${desktopLayout.headerHeight}px ≤ 105px, 109px avant)`);
    assert.equal(desktopLayout.inHeader, false, "statut hors de l’en-tête sur desktop");
    assert.equal(desktopLayout.inRightPanel, true, "statut dans le panneau de transcription");
    assert.equal(desktopLayout.inFooter, true, "statut dans le pied d’atelier");
    assert.ok(desktopLayout.statusTop >= desktopLayout.headerBottom - 1, "statut sous l’en-tête");
    assert.ok(desktopLayout.statusTop >= desktopLayout.listBottom - 1, "statut après le contenu éditable");
    assert.ok(desktopLayout.statusLeft >= desktopLayout.dividerRight - 1, "statut à droite du séparateur, associé à la transcription");
    assert.ok(desktopLayout.statusTop >= desktopLayout.panelRightTop && desktopLayout.statusTop <= desktopLayout.panelRightBottom, "statut contenu dans le panneau de transcription");
    assert.ok(desktopLayout.statusHeight > 0, "statut visible sur desktop");

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(80);
    const desktopPageOverflow = await page.evaluate(() => {
      const box = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return [Math.round(r.top), Math.round(r.bottom), Math.round(r.height)];
      };
      return { scrollHeight: document.documentElement.scrollHeight, height: innerHeight, topbar: box("#topbar"), workshop: box("#transcriptionWorkshopView"), header: box(".transcription-workshop-header"), layout: box("#workshopLayout"), tabs: box(".transcription-workshop-tabs"), mainPadding: getComputedStyle(document.getElementById("transcriptionWorkshopView")).padding };
    });
    assert.ok(desktopPageOverflow.scrollHeight <= desktopPageOverflow.height + 2, `atelier desktop ≥981px sans scroll de page (${JSON.stringify(desktopPageOverflow)})`);
    await page.setViewportSize({ width: 1280, height: 900 });

    /* Saisie puis autosauvegarde à 3 secondes : aucune commande manuelle,
       l'état du pied reflète le résultat réel de l'écriture locale. */
    await page.fill('[data-workshop-field="textIt"]', "Anno millenovecentosedici");
    await page.fill('[data-workshop-field="translationFr"]', "L’année mille neuf cent seize");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Enregistré", undefined, { timeout: 5000 });
    let stored = await page.evaluate(() => window.__repro.stored());
    assert.equal(stored.length, 1, "une copie locale écrite");
    assert.equal(JSON.parse(stored[0][1]).snapshot.passages[0].textIt, "Anno millenovecentosedici", "texte présent en local");
    assert.equal(await page.locator("#workshopSaveDraftBtn").count(), 0, "aucun bouton manuel « Enregistrer »");
    assert.equal(await page.locator("#workshopSaveStatus").textContent(), "Enregistré", "statut local exact");

    /* Nouvelle modification : l'autosauvegarde reprend seule, sans action. */
    await page.fill('[data-workshop-field="textIt"]', "Anno senza attesa");
    assert.equal(await page.locator("#workshopSaveStatus").textContent(), "Enregistrement…", "modification en attente affichée sans faux succès");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Enregistré", undefined, { timeout: 5000 });
    stored = await page.evaluate(() => window.__repro.stored());
    assert.equal(JSON.parse(stored[0][1]).snapshot.passages[0].textIt, "Anno senza attesa", "écriture automatique du nouveau contenu");
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "le menu « … » reste fermé");

    /* Sur desktop, le fil d'Ariane remplace la flèche de retour vers le
       Document ; le menu « … » unique vit dans le panneau de transcription. */
    const layout = await page.evaluate(() => {
      const back = document.getElementById("workshopBackBtn").getBoundingClientRect();
      const menu = document.getElementById("workshopActionsMenu").getBoundingClientRect();
      const panel = document.getElementById("workshopPanelRight").getBoundingClientRect();
      return {
        back: [back.top, back.right, back.width, back.height],
        menu: [menu.top, menu.right, menu.width, menu.height],
        panel: [panel.top, panel.right, panel.bottom],
        duplicates: document.querySelectorAll("#workshopBackBtn").length,
        redundant: false
      };
    });
    assert.equal(layout.duplicates, 1, "un seul bouton Retour dans le DOM");
    assert.equal(layout.redundant, false, "retour visible même lorsque le fil d’Ariane mène au Document");
    assert.ok(layout.back[2] >= 44 && layout.back[3] >= 44, "Retour accessible à droite du fil d’Ariane");
    assert.ok(layout.menu[1] <= layout.panel[1] + 1, "menu « … » dans le panneau de transcription");
    assert.ok(layout.menu[0] >= layout.panel[0] && layout.menu[0] <= layout.panel[2], "menu contenu dans le panneau");
    assert.ok(layout.menu[3] >= 44, "menu « … » ≥ 44 px");

    /* Desktop : outils calés à gauche du panneau image, texte « Ajusté »
       retiré, quatre commandes dans l'ordre de la fiche Document ; actions
       de transcription regroupées à droite, navigation à gauche. */
    const desktopTools = await page.evaluate(() => {
      const tools = document.getElementById("workshopImageTools").getBoundingClientRect();
      const panel = document.getElementById("workshopPanelOriginal").getBoundingClientRect();
      const zoomLabelAbsent = !document.getElementById("workshopZoomLabel");
      const order = [...document.querySelectorAll("#workshopImageTools button")].map(button => button.dataset.viewerImageZoom || button.id);
      const addElement = document.getElementById("workshopAddPassageBtn");
      const add = addElement.getBoundingClientRect();
      const nav = document.querySelector(".transcription-workshop-passage-nav").getBoundingClientRect();
      const headEnd = document.querySelector(".transcription-workshop-head-end").getBoundingClientRect();
      const footerActions = document.querySelector(".transcription-workshop-footer-actions").getBoundingClientRect();
      const firstPillElement = document.querySelector("#workshopPassagePills [data-workshop-passage-select]");
      const firstPill = firstPillElement.getBoundingClientRect();
      return {
        toolsLeft: Math.round(tools.left),
        panelLeft: Math.round(panel.left),
        zoomLabelAbsent,
        order,
        addRight: Math.round(add.right),
        addLeft: Math.round(add.left),
        passagePillCount: document.querySelectorAll("#workshopPassagePills [data-workshop-passage-select]").length,
        activePassagePill: document.querySelector("#workshopPassagePills [aria-current='step']")?.textContent || "",
        navLeft: Math.round(nav.left),
        navRight: Math.round(nav.right),
        headRight: Math.round(document.querySelector("#workshopPanelRight .transcription-workshop-panel-head").getBoundingClientRect().right),
        headEndLeft: Math.round(headEnd.left),
        headEndRight: Math.round(headEnd.right),
        footerActionsHeight: Math.round(footerActions.height),
        pillRadius: getComputedStyle(firstPillElement).borderRadius,
        addRadius: getComputedStyle(addElement).borderRadius,
        sameSize: Math.round(firstPill.width) === Math.round(add.width) && Math.round(firstPill.height) === Math.round(add.height)
      };
    });
    assert.ok(desktopTools.toolsLeft <= desktopTools.panelLeft + 1, `outils à gauche du panneau (${desktopTools.toolsLeft} ≤ ${desktopTools.panelLeft})`);
    assert.equal(desktopTools.zoomLabelAbsent, true, "texte « Ajusté » retiré de la barre");
    assert.deepEqual(desktopTools.order, ["out", "in", "workshopImageModeBtn", "workshopImageFullscreenBtn"], "4 commandes dans l’ordre de la fiche Document");
    assert.equal(desktopTools.passagePillCount, 2, "une pastille numérotée par passage courant");
    assert.equal(desktopTools.activePassagePill, "1", "premier passage marqué actif");
    assert.ok(desktopTools.addRight <= desktopTools.navRight + 1 && desktopTools.addLeft >= desktopTools.navLeft - 1, "+ intégré à la navigation des passages");
    assert.equal(desktopTools.sameSize, true, "bouton + de même taille que les pastilles");
    assert.equal(desktopTools.pillRadius, desktopTools.addRadius, "rayon identique entre pastilles et +");
    assert.ok(desktopTools.headEndLeft >= desktopTools.navRight - 1, "badge et menu à droite de la navigation");
    assert.ok(desktopTools.headEndRight <= desktopTools.headRight + 1, "badge et menu contenus dans l’en-tête du panneau");
    assert.ok(desktopTools.footerActionsHeight >= 44, "actions d’édition du pied ≥ 44 px");

    /* Mobile : aucune largeur débordante avec la colonne d’actions complète. */
    await page.setViewportSize({ width: 320, height: 780 });
    await page.waitForTimeout(120);
    const mobile = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth, back: document.querySelectorAll("#workshopBackBtn").length }));
    assert.ok(mobile.scroll <= mobile.inner + 1, `en-tête atelier sans débordement à 320 px (${mobile.scroll}/${mobile.inner})`);
    assert.equal(mobile.back, 1, "toujours un seul Retour sur mobile");
    await page.setViewportSize({ width: 1280, height: 900 });

    /* Menu « … » : ouverture normale, fermeture extérieure, Échap, sortie. */
    await page.click("#workshopActionsMenu > summary");
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), true, "menu ouvert par « … »");
    await page.click("#workshopPageLabel");
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "clic extérieur ferme le menu");
    await page.click("#workshopActionsMenu > summary");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "Échap ferme le menu");
    await page.click("#workshopActionsMenu > summary");
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), true, "« … » réouvre le menu");

    /* Fermeture : aucune confirmation (tout est enregistré). Le menu ouvert
       recouvre temporairement le lien Retour (même grammaire que l'en-tête de
       la fiche Document) : une fermeture extérieure le libère. */
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), true, "menu ouvert avant la fermeture extérieure");
    await page.click("#workshopPageLabel");
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "fermeture extérieure avant navigation");
    await page.click('[data-workshop-breadcrumb="document"]');
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    assert.deepEqual(dialogs, [], "sortie sans confirmation quand le brouillon est enregistré");

    /* Réouverture : restauration exacte des champs. */
    await page.evaluate(() => window.__repro.transcribe());
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    let fields = await page.evaluate(() => window.__repro.fields());
    assert.equal(fields.find(f => f.k === "textIt" && f.p === "p-1")?.v, "Anno senza attesa", "texte italien restauré à la réouverture");
    assert.equal(fields.find(f => f.k === "translationFr" && f.p === "p-1")?.v, "L’année mille neuf cent seize", "traduction restaurée à la réouverture");
    assert.equal(await page.evaluate(() => window.__repro.badge()), "Enregistré", "état enregistré restauré");
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "menu fermé à la réouverture");

    /* Rechargement complet : le brouillon survit. */
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__repro === "object");
    await boot();
    await openWorkshop();
    fields = await page.evaluate(() => window.__repro.fields());
    assert.equal(fields.find(f => f.k === "textIt" && f.p === "p-1")?.v, "Anno senza attesa", "texte italien restauré après rechargement");
    assert.equal(fields.find(f => f.k === "translationFr" && f.p === "p-1")?.v, "L’année mille neuf cent seize", "traduction restaurée après rechargement");
    assert.deepEqual(dialogs, [], "aucune confirmation inutile après rechargement");

    /* Abandon explicite depuis le menu : confirmation exigée, menu fermé,
       copie locale retirée — puis sortie sans nouvelle confirmation. */
    await page.click("#workshopActionsMenu > summary");
    await page.click("#workshopResetBtn");
    await page.waitForTimeout(250);
    assert.equal(dialogs.length, 1, "abandon explicite confirmé");
    assert.match(dialogs[0], /Annuler toutes les modifications/, "confirmation d’abandon inchangée");
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "menu fermé après sélection de l’action");
    await page.waitForFunction(() => window.__repro.stored().length === 0, undefined, { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.__repro.badge()), "Brouillon local", "badge au repos après abandon");
    await page.click('[data-workshop-breadcrumb="document"]');
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    assert.equal(dialogs.length, 1, "aucune confirmation après un abandon déjà confirmé");

    assert.deepEqual(pageErrors, [], `erreurs JavaScript : ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});

/* En-tête mobile et ouverture en haut (correctif Safari iPhone) : Chromium
   puis WebKit à 320, 390 et 760 px — titre lisible, libellé de page compact,
   actions et Retour empilés à droite sans chevauchement ni débordement,
   cibles ≥ 44 px, menu complet, ouverture systématiquement en haut. */
test("atelier mobile : en-tête lisible sans débordement et ouverture en haut", { timeout: 240000 }, async t => {
  const server = await startStaticServer(ROOT);
  let ranAny = false;
  try {
    for (const [engineName, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
      let browser;
      try { browser = await engine.launch({ headless: true }); }
      catch (error) { t.diagnostic(`${engineName} indisponible : ${error.message}`); continue; }
      ranAny = true;
      try {
        for (const [width, height] of [[320, 780], [375, 812], [390, 844], [760, 900]]) {
          await t.test(`${engineName} ${width}×${height}`, async () => {
            const context = await browser.newContext({ viewport: { width, height }, locale: "fr-FR" });
            await context.route("**/*", async route => {
              const url = route.request().url();
              if (new URL(url).pathname.endsWith("/js/app.js")) {
                const response = await route.fetch();
                return route.fulfill({ response, body: `${await response.text()}\n${WORKSHOP_TEST_HOOKS}\n${WORKSHOP_AUTH_PATCH}` });
              }
              return url.startsWith(server.baseURL) || url.includes("gstatic.com") ? route.continue() : route.abort("blockedbyclient");
            });
            const page = await context.newPage();
            const pageErrors = [];
            const dialogs = [];
            page.on("pageerror", error => pageErrors.push(error.message));
            page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
            try {
              await page.goto(server.baseURL, { waitUntil: "load" });
              await page.waitForFunction(() => typeof window.__repro === "object");
              /* Page volontairement longue : la position de défilement de la
                 vue d'origine peut rendre l'atelier au milieu de la page. */
              await page.evaluate(() => {
                window.__repro.show();
                window.__repro.seed();
                const probe = document.createElement("div");
                probe.id = "__scrollProbe";
                probe.style.height = "4000px";
                document.body.append(probe);
              });
              await page.evaluate(() => window.__repro.openDoc());
              await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
              await page.evaluate(() => window.scrollTo({ top: 600, left: 0, behavior: "instant" }));
              await page.waitForTimeout(80);
              const scrolled = await page.evaluate(() => window.scrollY);
              assert.ok(scrolled > 0, `page scrollable avant ouverture (${scrolled})`);
              await page.evaluate(() => window.__repro.transcribe());
              await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
              await page.evaluate(() => window.__repro.useAdminProfile());
              await page.waitForTimeout(300);
              const scrollState = await page.evaluate(() => ({ y: window.scrollY, container: document.getElementById("transcriptionWorkshopView").scrollTop }));
              assert.equal(scrollState.y, 0, "fenêtre au début de l’atelier");
              assert.equal(scrollState.container, 0, "conteneur de défilement au début");

              const layout = await page.evaluate(() => {
                const header = document.querySelector(".transcription-workshop-header").getBoundingClientRect();
                const breadcrumb = document.querySelector(".transcription-workshop-breadcrumb");
                const documentCrumb = document.getElementById("workshopDocumentTitle");
                const currentCrumb = document.querySelector(".transcription-workshop-breadcrumb-current");
                const heading = document.querySelector(".transcription-workshop-heading").getBoundingClientRect();
                const label = document.getElementById("workshopPageLabel");
                const labelRect = label.getBoundingClientRect();
                const back = document.getElementById("workshopBackBtn").getBoundingClientRect();
                const tabs = [...document.querySelectorAll(".transcription-workshop-tab")].map(tab => { const r = tab.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
                const tools = [...document.querySelectorAll("#workshopImageTools button")].map(button => { const r = button.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
                const toolsRect = document.getElementById("workshopImageTools").getBoundingClientRect();
                const panelRect = document.getElementById("workshopPanelOriginal").getBoundingClientRect();
                return {
                  breadcrumbText: breadcrumb.textContent.trim(),
                  documentCrumbLabel: documentCrumb.getAttribute("aria-label"),
                  currentCrumb: currentCrumb.textContent.trim(),
                  headingWidth: Math.round(heading.width),
                  headingRight: Math.round(heading.right),
                  headingBottom: heading.bottom,
                  headerHeight: header.height,
                  headerMarkup: [...document.querySelector(".transcription-workshop-header").children].map(element => ({ tag: element.tagName, className: element.className, height: Math.round(element.getBoundingClientRect().height), display: getComputedStyle(element).display })),
                  breadcrumbHeight: Math.round(breadcrumb.getBoundingClientRect().height),
                  labelWhiteSpace: getComputedStyle(label).whiteSpace,
                  labelHeight: Math.round(labelRect.height),
                  backLeft: Math.round(back.left), backTop: back.top, backRight: back.right, backWidth: Math.round(back.width), backHeight: Math.round(back.height),
                  headerRight: header.right,
                  tabs, tools,
                  toolsLeft: Math.round(toolsRect.left),
                  panelLeft: Math.round(panelRect.left),
                  zoomLabelAbsent: !document.getElementById("workshopZoomLabel"),
                  toolOrder: [...document.querySelectorAll("#workshopImageTools button")].map(button => button.dataset.viewerImageZoom || button.id),
                  pageScroll: document.documentElement.scrollWidth,
                  viewport: innerWidth
                };
              });
              /* Fil d'Ariane : titre du document complet accessible, page courante explicite. */
              assert.match(layout.breadcrumbText, width >= 761
                ? /Documents.*Registre Transactions Immobilières.*Transcription/
                : /Registre Transactions Immobilières.*Transcription/, "fil d’Ariane compact adapté au breakpoint");
              assert.equal(layout.documentCrumbLabel, "Registre Transactions Immobilières", "nom complet du document exposé à l’accessibilité");
              assert.equal(layout.currentCrumb, "Transcription", "étape courante annoncée dans le fil d’Ariane");
              /* « Page X · Y passages » compact : une seule ligne. */
              assert.equal(layout.labelWhiteSpace, "nowrap", "libellé de page sur une seule ligne");
              assert.ok(layout.labelHeight <= 26, `libellé de page compact sans retour à la ligne (${layout.labelHeight}px)`);
              /* En-tête réellement compact, sur le modèle de la fiche Document :
                 203 px à 390 et 208 px à 320 avant correction, 121 px pour la
                 fiche Document — l'atelier doit désormais rester en dessous. */
              assert.ok(layout.headerHeight <= 130, `en-tête mobile compact (${layout.headerHeight}px ≤ 130px, jusqu'à 211px avant) ${JSON.stringify({ headerMarkup: layout.headerMarkup, breadcrumbHeight: layout.breadcrumbHeight })}`);
              /* Modèle fiche Document : titre à gauche, flèche de retour
                 contextuelle à droite sur la même rangée — sans chevauchement
                 horizontal ni cible réduite. Le menu « … » vit dans le panneau
                 de transcription, jamais dans l'en-tête général. */
              assert.ok(layout.headingRight <= layout.backLeft + 1, `titre à gauche du retour sans chevauchement (${layout.headingRight} ≤ ${layout.backLeft})`);
              assert.ok(layout.backRight <= layout.headerRight + 1, "Retour à droite de l’en-tête");
              assert.ok(layout.backWidth >= 44 && layout.backHeight >= 44, `Retour ≥ 44 px (${layout.backWidth}×${layout.backHeight})`);
              /* Aucun débordement horizontal. */
              assert.ok(layout.pageScroll <= layout.viewport + 1, `sans débordement horizontal à ${width}px (${layout.pageScroll}/${layout.viewport})`);
              /* Onglets et barre d'outils de la photographie. */
              assert.equal(layout.tabs.length, 3, "trois onglets Original / Italien / Français");
              for (const [tabWidth, tabHeight] of layout.tabs) {
                assert.ok(tabWidth >= 44 && tabHeight >= 44, `onglet ≥ 44 px (${tabWidth}×${tabHeight})`);
              }
              assert.ok(layout.tools.length >= 4, "barre d’outils de la photographie présente");
              for (const [toolWidth, toolHeight] of layout.tools) {
                assert.ok(toolWidth >= 44 && toolHeight >= 44, `outil photo ≥ 44 px (${toolWidth}×${toolHeight})`);
              }
              assert.equal(layout.zoomLabelAbsent, true, "texte « Ajusté » retiré de la barre");
              assert.ok(layout.toolsLeft <= layout.panelLeft + 1, `outils à gauche sous les onglets (${layout.toolsLeft} ≤ ${layout.panelLeft})`);
              assert.deepEqual(layout.toolOrder, ["out", "in", "workshopImageModeBtn", "workshopImageFullscreenBtn"], "4 commandes dans l’ordre de la fiche Document");

              /* Statut de sauvegarde : pied d'atelier du panneau de
                 transcription, visible après la zone de saisie — jamais dans
                 l'en-tête, jamais au-dessus de l'image. */
              const inHeader = await page.evaluate(() => !!document.getElementById("workshopSaveStatus").closest(".transcription-workshop-header"));
              assert.equal(inHeader, false, "statut absent de l’en-tête");
              await page.click("#workshopTabItalian");
              await page.waitForTimeout(150);
              await page.evaluate(() => window.__repro.useAdminProfile());
              const footerState = await page.evaluate(() => {
                const status = document.getElementById("workshopSaveStatus").getBoundingClientRect();
                const list = document.getElementById("workshopPassageList").getBoundingClientRect();
                const header = document.querySelector(".transcription-workshop-header").getBoundingClientRect();
                const add = document.getElementById("workshopAddPassageBtn").getBoundingClientRect();
                const cancel = document.getElementById("workshopCancelEditBtn");
                const cancelRect = cancel.getBoundingClientRect();
                const validateRect = document.getElementById("workshopValidateBtn").getBoundingClientRect();
                 const footerElement = document.querySelector(".transcription-workshop-footer");
                 const footer = footerElement.getBoundingClientRect();
                return {
                  statusTop: Math.round(status.top),
                  statusHeight: Math.round(status.height),
                  listBottom: Math.round(list.bottom),
                  headerBottom: Math.round(header.bottom),
                  inFooter: !!document.getElementById("workshopSaveStatus").closest(".transcription-workshop-footer"),
                  inRightPanel: !!document.getElementById("workshopSaveStatus").closest("#workshopPanelRight"),
                  addVisible: add.width > 0 && add.height > 0,
                  addHeight: Math.round(add.height),
                  saveButtonCount: document.querySelectorAll("#workshopSaveDraftBtn").length,
                  cancelHidden: cancel.hidden,
                  cancelHeight: Math.round(cancelRect.height),
                  validateHeight: Math.round(validateRect.height),
                  cancelLeft: Math.round(cancelRect.left),
                  validateLeft: Math.round(validateRect.left),
                  footerRight: Math.round(footer.right),
                  footerHeight: Math.round(footer.height),
                  footerTop: Math.round(footer.top),
                  footerBottom: Math.round(footer.bottom),
                  panel: (() => { const r = document.getElementById("workshopPanelRight").getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), scrollHeight: document.getElementById("workshopPanelRight").scrollHeight }; })(),
                  layout: (() => { const r = document.getElementById("workshopLayout").getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; })(),
                  selectedContentBottom: Math.round(document.querySelector(".transcription-workshop-passage.is-selected").getBoundingClientRect().bottom),
                  fieldHeights: [...document.querySelectorAll(".transcription-workshop-passage.is-selected textarea")].map(field => Math.round(field.getBoundingClientRect().height)),
                  fieldScrollHeights: [...document.querySelectorAll(".transcription-workshop-passage.is-selected textarea")].map(field => field.scrollHeight),
                   footerStyle: (() => { const s = getComputedStyle(footerElement); return { height: s.height, minHeight: s.minHeight, flex: s.flex, marginTop: s.marginTop, paddingTop: s.paddingTop, paddingBottom: s.paddingBottom, gap: s.gap }; })(),
                  panelStyle: (() => { const s = getComputedStyle(document.getElementById("workshopPanelRight")); return { height: s.height, minHeight: s.minHeight, flex: s.flex, gap: s.gap, justifyContent: s.justifyContent }; })(),
                   view: (() => { const view = document.getElementById("transcriptionWorkshopView"); const r = view.getBoundingClientRect(); const s = getComputedStyle(view); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), paddingBottom: s.paddingBottom, minHeight: s.minHeight, scrollHeight: view.scrollHeight }; })(),
                   bodyPaddingBottom: getComputedStyle(document.body).paddingBottom,
                   contentGap: Math.round(footer.top - document.querySelector(".transcription-workshop-passage.is-selected").getBoundingClientRect().bottom),
                   visualViewportHeight: Math.round(window.visualViewport?.height || innerHeight),
                  documentHeight: document.documentElement.scrollHeight,
                  viewport: innerWidth
                };
              });
              assert.equal(footerState.inFooter, true, "statut dans le pied d’atelier");
              assert.equal(footerState.inRightPanel, true, "statut dans le panneau de transcription");
              assert.ok(footerState.statusHeight > 0, "statut visible sur l’onglet de saisie");
              assert.ok(footerState.statusTop >= footerState.headerBottom - 1, `statut hors de l’en-tête (${footerState.statusTop} ≥ ${footerState.headerBottom})`);
              assert.ok(footerState.statusTop >= footerState.listBottom - 1, `statut après la zone de saisie (${footerState.statusTop} ≥ ${footerState.listBottom})`);
              /* Le « + » reste en tête ; les actions d'édition sont au pied et
                 aucun bouton manuel de sauvegarde ne subsiste. */
              assert.equal(footerState.addVisible, true, "« + » visible sur l’onglet de saisie");
              assert.ok(footerState.addHeight >= 44, `« + » ≥ 44 px (${footerState.addHeight})`);
              assert.equal(footerState.saveButtonCount, 0, "aucun bouton manuel « Enregistrer »");
              assert.equal(footerState.cancelHidden, false, "« Annuler » visible en mode édition");
              assert.ok(footerState.cancelHeight >= 44 && footerState.validateHeight >= 44, `actions d’édition ≥ 44 px (${footerState.cancelHeight}/${footerState.validateHeight})`);
              assert.ok(footerState.cancelLeft < footerState.validateLeft, "ordre Annuler puis Valider");
              assert.ok(footerState.footerHeight <= 56, `footer mobile intrinsèque sur une ligne (${footerState.footerHeight}px)`);
              assert.equal(footerState.panel.bottom, footerState.footerBottom, "aucun espace libre sous le footer dans son panneau");
              assert.equal(footerState.layout.bottom, footerState.footerBottom, "footer au bas de la zone mobile mesurée");
              assert.equal(footerState.view.bottom, footerState.footerBottom, "aucune réserve vide sous l’atelier en mode footer");
              assert.equal(footerState.view.paddingBottom, "0px", "aucun padding workspace en double sous le pied");
              assert.equal(footerState.bodyPaddingBottom, "0px", "safe-area non cumulée dans le body de l’atelier");
              assert.ok(footerState.contentGap <= 12, `contenu de saisie proche du footer (${footerState.contentGap}px)`);
              assert.ok(footerState.fieldHeights[0] > 0, `hauteur disponible à la transcription mesurée (${footerState.fieldHeights[0]}px)`);
              assert.ok(footerState.footerRight <= footerState.viewport + 1, "pied contenu sans débordement horizontal");

              /* Menu contextuel complet en mobile : ouverture, clic extérieur, Échap. */
              await page.click("#workshopActionsMenu > summary");
              assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), true, "menu ouvert");
              /* Clic extérieur au coin gauche du titre : le panneau du menu est
                 ancré à droite et peut recouvrir le centre du titre sur mobile. */
              await page.click("#workshopPageLabel", { position: { x: 6, y: 6 } });
              assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "clic extérieur ferme le menu");
              await page.click("#workshopActionsMenu > summary");
              await page.keyboard.press("Escape");
              assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "Échap ferme le menu");

              /* Échec de stockage : avertissement immédiat même si le statut
                 est en bas, brouillon conservé en mémoire, aucun succès
                 trompeur — puis récupération par l'autosauvegarde. */
              await page.fill('[data-workshop-field="textIt"]', "Anno sotto errore");
              await page.evaluate(() => {
                window.__nativeSetItem = Storage.prototype.setItem;
                Storage.prototype.setItem = function() {
                  const error = new Error("QuotaExceededError");
                  error.name = "QuotaExceededError";
                  throw error;
                };
              });
              await page.waitForTimeout(3500);
              const failure = await page.evaluate(() => ({
                status: document.getElementById("workshopSaveStatus").textContent,
                failedClass: document.getElementById("workshopSaveStatus").classList.contains("is-failed"),
                warningVisible: [...document.querySelectorAll(".toast")].some(toast => toast.textContent.includes("Sauvegarde locale impossible") && toast.classList.contains("show")),
                firstField: document.querySelector('[data-workshop-field="textIt"]')?.value
              }));
              assert.equal(failure.status, "Erreur de sauvegarde", "état d’échec affiché dans le pied");
              assert.equal(failure.failedClass, true, "état d’échec coloré");
              assert.equal(failure.warningVisible, true, "avertissement immédiat visible via le toast");
              assert.equal(failure.firstField, "Anno sotto errore", "brouillon conservé en mémoire malgré l’échec");
              await page.evaluate(() => { Storage.prototype.setItem = window.__nativeSetItem; });
              await page.evaluate(() => {
                const field = document.querySelector('[data-workshop-field="textIt"]');
                field.dispatchEvent(new Event("input", { bubbles: true }));
              });
              await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Enregistré", undefined, { timeout: 6000 });
              const recovered = await page.evaluate(() => ({ stored: window.__repro.stored().length, status: document.getElementById("workshopSaveStatus").textContent }));
              assert.ok(recovered.stored >= 1, "récupération écrite après rétablissement du stockage");
              assert.equal(recovered.status, "Enregistré", "retour à un état de succès réel");

              /* A3 mobile : en-tête dédié, navigation générale masquée, un seul
                 passage visible, contrôle segmenté contenu. */
              const a3State = await page.evaluate(() => {
                const visibleCards = [...document.querySelectorAll(".transcription-workshop-passage")].filter(card => card.getClientRects().length > 0);
                const crumbSpans = [...document.querySelectorAll(".transcription-workshop-breadcrumb > span")];
                const mode = document.querySelector(".transcription-workshop-mode");
                return {
                  navHidden: getComputedStyle(document.querySelector(".topbar .main-nav")).display === "none",
                  brandTaglineHidden: getComputedStyle(document.querySelector(".topbar .brand p")).display === "none",
                  crumbSpansHidden: crumbSpans.length > 0 && crumbSpans.every(span => getComputedStyle(span).display === "none"),
                  titleVisible: document.getElementById("workshopDocumentTitle").getClientRects().length > 0,
                  backHeight: Math.round(document.getElementById("workshopBackBtn").getBoundingClientRect().height),
                  pageLabelVisible: document.getElementById("workshopPageLabel").getClientRects().length > 0,
                  visibleCards: visibleCards.length,
                  modeScroll: mode ? mode.scrollWidth - mode.clientWidth : null,
                  horizontalOverflow: document.documentElement.scrollWidth > innerWidth
                };
              });
              assert.equal(a3State.navHidden, true, "navigation générale masquée dans l’atelier mobile");
              assert.equal(a3State.brandTaglineHidden, true, "sous-titre de marque masqué pour l’espace compact");
              assert.equal(a3State.crumbSpansHidden, true, "fil d’Ariane remplacé par l’en-tête dédié (chevrons et étape masqués)");
              assert.equal(a3State.titleVisible, true, "titre du document visible");
              assert.ok(a3State.backHeight >= 44, `retour contextuel ≥ 44 px (${a3State.backHeight})`);
              assert.equal(a3State.pageLabelVisible, true, "contexte de page visible");
              assert.equal(a3State.visibleCards, 1, "un seul passage visible à la fois");
              assert.ok(a3State.modeScroll <= 1, `contrôle segmenté sans débordement horizontal (${a3State.modeScroll}px)`);
              assert.equal(a3State.horizontalOverflow, false, "aucun débordement horizontal de la page");
              /* Conservation de la sélection entre onglets et changement de passage. */
              await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();
              const afterPill = await page.evaluate(() => ({
                activePill: document.querySelector("#workshopPassagePills [aria-current='step']")?.textContent,
                visibleCards: [...document.querySelectorAll(".transcription-workshop-passage")].filter(card => card.getClientRects().length > 0).map(card => card.dataset.workshopPassage),
                activePanel: document.getElementById("workshopLayout").dataset.activePanel
              }));
              assert.equal(afterPill.activePill, "2", "pastille 2 sélectionnée");
              assert.deepEqual(afterPill.visibleCards, ["p-2"], "seul le passage sélectionné reste affiché");
              assert.equal(afterPill.activePanel, "italian", "onglet Italien conservé lors du changement de passage");
              await page.click("#workshopTabFrench");
              const afterTab = await page.evaluate(() => {
                const card = [...document.querySelectorAll(".transcription-workshop-passage")].find(element => element.getClientRects().length > 0);
                return {
                  activePill: document.querySelector("#workshopPassagePills [aria-current='step']")?.textContent,
                  visibleCards: [...document.querySelectorAll(".transcription-workshop-passage")].filter(element => element.getClientRects().length > 0).map(element => element.dataset.workshopPassage),
                  frVisible: !!card && [...card.querySelectorAll(".workshop-field-fr")].some(field => field.getClientRects().length > 0),
                  itHidden: !!card && [...card.querySelectorAll(".workshop-field-it")].every(field => field.getClientRects().length === 0)
                };
              });
              assert.equal(afterTab.activePill, "2", "sélection conservée après changement d’onglet");
              assert.deepEqual(afterTab.visibleCards, ["p-2"], "seul le passage sélectionné reste affiché sur l’onglet Français");
              assert.equal(afterTab.frVisible, true, "traduction française affichée sur l’onglet Français");
              assert.equal(afterTab.itHidden, true, "transcription italienne masquée sur l’onglet Français");
               /* Clavier virtuel simulé via visualViewport : pied compacté
                  (statut et actions essentiels conservés), panneau borné au viewport
                 visible, puis restauration complète à la fermeture. */
              const keyboardTarget = await page.evaluate(() => {
                window.__repro.keyboard.setBaseline(window.innerHeight);
                const height = window.innerHeight - 300;
                window.__repro.keyboard.sync({ height, offsetTop: 0 });
                const footer = document.querySelector(".transcription-workshop-footer");
                return {
                  height,
                  open: document.getElementById("transcriptionWorkshopView").classList.contains("is-keyboard-open"),
                   actionsVisible: document.querySelector(".transcription-workshop-footer-actions").getClientRects().length > 0,
                   actionsRight: Math.round(document.querySelector(".transcription-workshop-footer-actions").getBoundingClientRect().right),
                  statusVisible: document.getElementById("workshopSaveStatus").getClientRects().length > 0,
                  footerBottom: Math.round(footer.getBoundingClientRect().bottom),
                  keyboardHeight: parseFloat(document.getElementById("workshopLayout").style.getPropertyValue("--workshop-keyboard-height"))
                };
              });
              assert.equal(keyboardTarget.open, true, "clavier virtuel simulé : état compact activé");
               assert.equal(keyboardTarget.actionsVisible, true, "actions importantes conservées pendant la saisie");
               assert.ok(keyboardTarget.actionsRight <= width + 1, "actions accessibles sans débordement avec le clavier");
              assert.equal(keyboardTarget.statusVisible, true, "statut de sauvegarde conservé pendant la saisie");
              assert.ok(keyboardTarget.keyboardHeight >= 160, `hauteur de panneau adaptée au viewport visible (${keyboardTarget.keyboardHeight}px)`);
              assert.ok(keyboardTarget.footerBottom <= keyboardTarget.height + 2, `pied compacté au-dessus du clavier (${keyboardTarget.footerBottom} ≤ ${keyboardTarget.height})`);
              const restoredKeyboard = await page.evaluate(() => {
                window.__repro.keyboard.sync(window.visualViewport);
                return {
                  open: document.getElementById("transcriptionWorkshopView").classList.contains("is-keyboard-open"),
                  actionsVisible: document.querySelector(".transcription-workshop-footer-actions").getClientRects().length > 0,
                  keyboardHeight: document.getElementById("workshopLayout").style.getPropertyValue("--workshop-keyboard-height")
                };
              });
              assert.equal(restoredKeyboard.open, false, "état compact retiré à la fermeture du clavier");
              assert.equal(restoredKeyboard.actionsVisible, true, "actions restaurées à la fermeture du clavier");
              assert.equal(restoredKeyboard.keyboardHeight, "", "hauteur forcée nettoyée à la fermeture");

              /* Sortie sans friction (brouillon enregistré), retours nets. */
              await page.click("#workshopBackBtn");
              await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
              assert.deepEqual(dialogs, [], "sortie sans confirmation");
              assert.deepEqual(pageErrors, [], `erreurs JavaScript : ${pageErrors.join(" | ")}`);
            } finally {
              await context.close();
            }
          });
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    if (!ranAny) t.skip("aucun moteur Playwright disponible");
    await server.close();
  }
});
