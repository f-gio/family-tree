import assert from "node:assert/strict";
import test from "node:test";
import {
  addDocumentPage,
  addPhotographsToPage,
  adaptLegacyDocument,
  createDocumentPage,
  createPhotographAsset,
  createSourceDocument,
  findExactPhotographDuplicates,
  normalizeSourceDocumentSearchText,
  reorderDocumentPages,
  searchLinkedDocuments,
  SOURCE_DOCUMENT_PICKER_PAGE_SIZE,
  validateDocumentDateInfo,
  validateDocumentPage,
  validatePhotographAsset,
  validateSourceDocument
} from "../js/source-document-model.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function photographInput(id, { hash = HASH_A, originalRef = `${id}-original`, previewRef = null } = {}) {
  return {
    id,
    originalFileName: `${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 1234,
    sha256: hash,
    originalRef,
    previewRef,
    importedAt: "2026-10-19T10:00:00.000Z"
  };
}

function photo(id, options) {
  return createPhotographAsset(photographInput(id, options));
}

test("un document complet accepte métadonnées archivistiques et référence brute", () => {
  const document = createSourceDocument({
    id: "source-1",
    title: "Registre des hypothèques",
    description: "Volume conservé aux archives",
    category: "registre-hypothecaire",
    languages: ["it"],
    dateInfo: { type: "year", year: 1882 },
    placeOrTerritory: "Torino",
    holdingOrganization: "Archivio di Stato",
    fondsSeries: "Ufficio ipoteche",
    cote: "IP-01",
    subCote: "vol. 2",
    archivalReferences: [
      { type: "registro-generale", value: "00037" },
      { type: "registro-particolare", value: "00008" }
    ],
    externalUrl: "https://example.invalid/source",
    researchNotes: "Vérifier le folio",
    status: "active",
    personIds: ["person-1"]
  });

  assert.equal(validateSourceDocument(document).valid, true);
  assert.equal(document.archivalReferences[0].value, "00037", "les zéros initiaux sont préservés");
  assert.equal(document.schemaVersion, 1);
});

test("métadonnées partielles, champs inconnus et état archivé sont acceptés", () => {
  const document = createSourceDocument({ id: "source-partiel", cote: "", category: "", status: "archived", customLegacyField: "préservé" });
  assert.equal(validateSourceDocument(document).valid, true);
  assert.equal(document.status, "archived");
  assert.equal(document.customLegacyField, "préservé");
});

test("documentIds est facultatif et conserve sans doublons les IDs stables de la bibliothèque", () => {
  const withoutLinks = createSourceDocument({ id: "source-without-documents" });
  assert.deepEqual(withoutLinks.documentIds, []);
  const historicalSource = { ...withoutLinks };
  delete historicalSource.documentIds;
  assert.equal(validateSourceDocument(historicalSource).valid, true, "une source existante sans documentIds reste valide");

  const linked = createSourceDocument({ id: "source-linked", documentIds: ["document-1", "document-1", "document-2"] });
  assert.deepEqual(linked.documentIds, ["document-1", "document-2"]);
  assert.equal(validateSourceDocument(linked).valid, true);
  const secondSource = createSourceDocument({ id: "source-second", documentIds: ["document-1"] });
  assert.equal(linked.documentIds.includes("document-1") && secondSource.documentIds.includes("document-1"), true,
    "le même document peut être référencé par plusieurs sources sans créer une copie");
  assert.equal(validateSourceDocument({ ...linked, documentIds: ["document-1", " "] }).valid, false);
  assert.equal(validateSourceDocument({ ...linked, documentIds: "document-1" }).valid, false, "documentIds doit être un tableau");
});

test("la recherche de documents liés gère plusieurs centaines de fiches, les accents et la pagination", () => {
  assert.equal(SOURCE_DOCUMENT_PICKER_PAGE_SIZE, 10);
  const documents = [];
  for (let index = 0; index < 300; index++) {
    documents.push({ id: `document-${index}`, title: `Acte de naissance n° ${index}`, fileName: `acte-${index}.jpg`, type: "Naissance" });
  }
  documents.push({ id: "document-photo", fileName: "photo-mariage-gérard.jpg", type: "Photographie" });

  assert.equal(searchLinkedDocuments(documents, "").length, 0, "recherche vide : aucun résultat affiché");
  assert.equal(searchLinkedDocuments([], "acte").length, 0);

  const everything = searchLinkedDocuments(documents, "naissance");
  assert.equal(everything.length, 300, "tous les résultats restent disponibles pour la pagination");
  const firstPage = everything.slice(0, SOURCE_DOCUMENT_PICKER_PAGE_SIZE);
  assert.equal(firstPage.length, 10);
  assert.deepEqual(firstPage.map(item => item.id), documents.slice(0, 10).map(item => item.id));
  assert.equal(everything.slice(SOURCE_DOCUMENT_PICKER_PAGE_SIZE, SOURCE_DOCUMENT_PICKER_PAGE_SIZE * 2).length, 10);

  assert.deepEqual(searchLinkedDocuments(documents, "ACTE DE NAISSANCE N° 7 ").map(item => item.id),
    ["document-7", "document-70", "document-71", "document-72", "document-73", "document-74", "document-75", "document-76", "document-77", "document-78", "document-79"],
    "la recherche insensible à la casse couvre aussi les sous-numéros");
  assert.deepEqual(searchLinkedDocuments(documents, "Acte de naissance n° 277").map(item => item.id), ["document-277"]);
  assert.deepEqual(searchLinkedDocuments(documents, "gerard").map(item => item.id), ["document-photo"]);
  assert.deepEqual(searchLinkedDocuments(documents, "photographie").map(item => item.id), ["document-photo"]);
  assert.equal(searchLinkedDocuments(documents, "acté de naissançe").length, 300, "la requête accentuée retrouve les titres non accentués");
  assert.deepEqual(searchLinkedDocuments(documents, "relevé inconnu").map(item => item.id), []);
  assert.equal(normalizeSourceDocumentSearchText("ÉèêÀ ÇîÏ"), "eeea cii");
});

test("la recherche couvre aussi le titre de la fiche sans nom de fichier", () => {
  const documents = [{ id: "recit", title: "Récit oral de Lucie", type: "Source narrative" }];
  assert.deepEqual(searchLinkedDocuments(documents, "lucie").map(item => item.id), ["recit"]);
  assert.deepEqual(searchLinkedDocuments(documents, "source narrative").map(item => item.id), ["recit"]);
});

test("dates documentaires acceptent année, mois, approximation, période et inconnue", () => {
  for (const dateInfo of [
    { type: "year", year: 1890 },
    { type: "month", year: 1890, month: 3 },
    { type: "about", year: 1890 },
    { type: "between", from: { year: 1890, month: 3 }, to: { year: 1891 } },
    { type: "unknown" }
  ]) assert.deepEqual(validateDocumentDateInfo(dateInfo), []);
  assert.ok(validateDocumentDateInfo({ type: "month", year: 1890, month: 13 }).length);
  assert.ok(validateDocumentDateInfo({ type: "between", from: { year: 1900 }, to: { year: 1890 } }).length);
  assert.ok(validateDocumentDateInfo({ type: "exact", value: "1890-02-30" }).length);
  assert.deepEqual(validateDocumentDateInfo(undefined), []);
});

test("un document d'une page et un document multipage valident leurs IDs et ordres", () => {
  const single = createSourceDocument({ id: "one-page", pages: [createDocumentPage({ id: "page-a", order: 0 })] });
  let multi = createSourceDocument({ id: "multi-page" });
  multi = addDocumentPage(multi, { id: "page-a", label: "recto" });
  multi = addDocumentPage(multi, { id: "page-b", label: "verso", side: "verso" });

  assert.equal(validateSourceDocument(single).valid, true);
  assert.equal(validateSourceDocument(multi).valid, true);
  assert.deepEqual(multi.pages.map(page => [page.id, page.order]), [["page-a", 0], ["page-b", 1]]);
  assert.throws(() => addDocumentPage(multi, { id: "page-c", order: 1 }), /ordre de page est déjà utilisé/);
});

test("réordonner les pages change uniquement leur ordre d'affichage, pas leur identité", () => {
  let document = createSourceDocument({ id: "source-order" });
  document = addDocumentPage(document, { id: "page-1" });
  document = addDocumentPage(document, { id: "page-2" });
  const reordered = reorderDocumentPages(document, ["page-2", "page-1"]);

  assert.deepEqual(reordered.pages.map(page => [page.id, page.order]), [["page-2", 0], ["page-1", 1]]);
  assert.deepEqual(document.pages.map(page => [page.id, page.order]), [["page-1", 0], ["page-2", 1]], "l'entrée n'est pas mutée");
  assert.throws(() => reorderDocumentPages(document, ["page-1", "page-1"]), /chaque page/);
  assert.throws(() => reorderDocumentPages(document, ["page-1"]), /chaque page/);
});

test("plusieurs photographies distinctes peuvent être rattachées à une page", () => {
  let document = addDocumentPage(createSourceDocument({ id: "source-photos" }), { id: "page-1" });
  const original = photo("photo-complete", { previewRef: "preview-webp" });
  document = addPhotographsToPage(document, "page-1", [
    photographInput("photo-complete", { previewRef: "preview-webp" }),
    photographInput("photo-detail", { hash: HASH_B })
  ]);

  assert.equal(validateDocumentPage(document.pages[0]).valid, true);
  assert.deepEqual(document.pages[0].photographs.map(item => item.id), ["photo-complete", "photo-detail"]);
  assert.notEqual(original.original.resourceRef, original.preview.resourceRef);
  assert.throws(() => addPhotographsToPage(document, "page-1", [photographInput("photo-detail")]), /existe déjà/);
  assert.equal(document.pages[0].photographs.length, 2, "l'échec n'a pas muté le document source");
});

test("les métadonnées SHA-256 valident le format et refusent les ressources original/aperçu confondues", () => {
  assert.equal(validatePhotographAsset(photo("photo-valid")).valid, true);
  const valid = photo("photo-invalid");
  assert.equal(validatePhotographAsset({ ...valid, original: { ...valid.original, sha256: "xyz" } }).valid, false);
  assert.equal(validatePhotographAsset({ ...valid, preview: { resourceRef: valid.original.resourceRef } }).valid, false);
  assert.equal(validatePhotographAsset(photo("photo-uppercase", { hash: HASH_A.toUpperCase() })).valid, true);
  assert.equal(photo("photo-uppercase", { hash: HASH_A.toUpperCase() }).original.sha256, HASH_A);
});

test("deux photographies au même SHA dans des contextes distincts sont signalées, pas fusionnées", () => {
  const docA = addPhotographsToPage(addDocumentPage(createSourceDocument({ id: "doc-a" }), { id: "page-a" }), "page-a", [photographInput("asset-a")]);
  const docB = addPhotographsToPage(addDocumentPage(createSourceDocument({ id: "doc-b" }), { id: "page-b" }), "page-b", [photographInput("asset-b", { hash: HASH_A })]);
  const duplicates = findExactPhotographDuplicates([docA, docB]);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].sha256, HASH_A);
  assert.deepEqual(duplicates[0].occurrences, [
    { documentId: "doc-a", pageId: "page-a", photographId: "asset-a" },
    { documentId: "doc-b", pageId: "page-b", photographId: "asset-b" }
  ]);
  assert.equal(docA.pages[0].photographs.length, 1);
  assert.equal(docB.pages[0].photographs.length, 1);
});

test("la validation globale refuse des IDs de page, ordres et actifs en double", () => {
  const duplicatePage = createSourceDocument({
    id: "doc-invalid",
    pages: [createDocumentPage({ id: "same-page", order: 0 }), createDocumentPage({ id: "same-page", order: 0 })]
  });
  assert.equal(validateSourceDocument(duplicatePage).valid, false);
});

test("l'adaptateur legacy préserve tous les champs et ne fabrique ni page ni original vérifié", () => {
  const legacy = {
    id: "legacy-1",
    title: "Document historique",
    personIds: ["person-1"],
    fileName: "scan.webp",
    mimeType: "image/webp",
    fileSize: 8_000_000,
    storedSize: 900_000,
    compressed: true,
    storageMode: "firestore-chunks",
    chunkVersion: "v4",
    chunkCount: 2,
    customOldField: { note: "ancien champ conservé" }
  };
  const adapted = adaptLegacyDocument(legacy);

  assert.equal(adapted.documentId, "legacy-1");
  assert.equal(adapted.metadata.customOldField.note, "ancien champ conservé");
  assert.deepEqual(adapted.fileReference, { kind: "firestore-chunks", documentId: "legacy-1", version: "v4", chunkCount: 2 });
  assert.equal(adapted.pageIdentity, "not-assigned");
  assert.equal(adapted.photographIdentity, "not-assigned");
  assert.equal(adapted.originalIntegrity, "unverified");
  assert.equal(legacy.chunkVersion, "v4", "l'objet legacy n'est pas muté");
  assert.equal("pages" in adapted, false, "aucune page persistante n'est inventée");
});

test("un document legacy incomplet sans fichier reste adaptable sans inventer de ressource", () => {
  const legacy = { id: "legacy-empty", title: "Notice sans fichier", externalUrl: "https://example.invalid/notice", place: "Torino" };
  const adapted = adaptLegacyDocument(legacy);
  assert.equal(adapted.fileReference.kind, "external-url");
  assert.equal(adapted.originalIntegrity, "unverified");
  assert.equal(adapted.metadata.place, "Torino");
  assert.equal(adapted.pageIdentity, "not-assigned");
});

test("les opérations de pages et de photos n'altèrent pas les structures fournies", () => {
  const source = createSourceDocument({ id: "immutable-doc", pages: [createDocumentPage({ id: "page-1", order: 0 })] });
  const sourceJSON = JSON.stringify(source);
  const added = addPhotographsToPage(source, "page-1", [photographInput("asset-1")]);
  assert.equal(JSON.stringify(source), sourceJSON);
  const newPage = addDocumentPage(source, { id: "page-2" });
  assert.equal(JSON.stringify(source), sourceJSON);
  assert.equal(added.pages[0].photographs.length, 1);
  assert.equal(newPage.pages.length, 2);
});
