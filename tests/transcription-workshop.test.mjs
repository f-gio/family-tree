import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createTranscriptionWorkshopDraft,
  editTranscriptionWorkshopPassage,
  addTranscriptionWorkshopPassage,
  removeTranscriptionWorkshopPassage,
  isTranscriptionWorkshopPassageCreated,
  resetTranscriptionWorkshopDraft,
  selectTranscriptionWorkshopPassage,
  isTranscriptionWorkshopPassageChanged,
  transcriptionWorkshopPassagePosition,
  transcriptionWorkshopPassageLabel,
  transcriptionWorkshopTranslationBadge,
  WORKSHOP_TRANSLATION_STATE_LABELS,
  isTranscriptionJpegDocument,
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

test("seuls les passages ajoutés dans le brouillon sont supprimables", () => {
  const draft = createTranscriptionWorkshopDraft({ documentId: "doc-1", pageId: "page-1", passages: samplePassages() });
  assert.throws(() => removeTranscriptionWorkshopPassage(draft, "p1"), /Seul un passage ajouté/, "passage officiel intangible");
  addTranscriptionWorkshopPassage(draft, { id: "nouveau-3", textIt: "Testo aggiunto" });
  assert.equal(draft.passages.length, 3);
  removeTranscriptionWorkshopPassage(draft, "nouveau-3");
  assert.equal(draft.passages.length, 2, "suppression du passage créé");
  assert.equal(draft.dirty, false, "retour à l’état initial de la page");
  assert.equal(isTranscriptionWorkshopPassageCreated(draft, "nouveau-3"), false);
  assert.throws(() => removeTranscriptionWorkshopPassage(draft, "inconnu"), /Seul un passage ajouté/);
  addTranscriptionWorkshopPassage(draft, { id: "nouveau-4" });
  editTranscriptionWorkshopPassage(draft, "p1", { textIt: "Anno millenovecentosedici" });
  removeTranscriptionWorkshopPassage(draft, "nouveau-4");
  assert.equal(draft.dirty, true, "une correction officielle subsiste après suppression du passage créé");
  resetTranscriptionWorkshopDraft(draft);
  assert.deepEqual(draft.createdIds, [], "la réinitialisation vide la liste des passages créés");
});

test("l’accès à l’atelier couvre toute source et tout document consultable", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /const workshopCompatible = kind === "transcription"\s*\|\| kind === "source/, "toute source propose Transcrire, même sans pages rattachées");
  assert.match(app, /data-transcribe-document=/, "action Transcrire dans la fiche document unifiée");
  assert.match(app, /function openTranscriptionWorkshopForDocument\(documentItem\)/, "ouverture depuis la fiche du document");
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
  // Porte JPEG (périmètre de l'étape).
  assert.match(app, /if \(!isTranscriptionJpegDocument\(documentItem\)\)/, "gate JPEG avant tout traitement");
  assert.match(app, /Seuls les documents JPEG peuvent ouvrir l’atelier de transcription à cette étape/, "message hors périmètre explicite");
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
  assert.match(html, /fichier JPEG n’est pas dupliqué/, "notice de non-duplication");
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
  assert.match(html, /id="workshopBackBtn"[^>]*aria-label="Retour"/, "action Retour dans l’en-tête");
  assert.match(html, /class="dedicated-page-header transcription-workshop-header"/, "l’atelier réutilise l’en-tête commun");
  assert.match(html, /class="btn dedicated-page-back"[^>]*id="workshopBackBtn"/, "Retour Atelier utilise la cible tactile partagée");
  /* Modèle de la fiche Document : le Retour vit dans la colonne d'actions de
     l'en-tête, à droite, SOUS le menu « … » — plus de ligne indépendante. */
  const headStatus = html.match(/<div class="dedicated-page-actions dedicated-page-side transcription-workshop-head-status">[\s\S]*?<\/header>/)?.[0] || "";
  assert.ok(headStatus, "colonne d’actions de l’en-tête présente");
  assert.ok(headStatus.includes('id="workshopBackBtn"'), "Retour placé dans la colonne d’actions de l’en-tête");
  assert.ok(headStatus.indexOf('id="workshopBackBtn"') > headStatus.indexOf('id="workshopActionsMenu"'), "Retour positionné sous le menu « … »");
  assert.ok(!headStatus.includes('id="workshopSaveStatus"'), "statut de sauvegarde retiré de l’en-tête");
  assert.doesNotMatch(html, /class="dedicated-page-return"/, "aucune ligne Retour indépendante ne subsiste");
  /* Statut de sauvegarde : pied d'atelier, en bas du panneau de transcription
     (après le contenu éditable), jamais au-dessus du document. */
  assert.match(html, /class="transcription-workshop-footer"/, "pied d’atelier présent");
  assert.ok(html.indexOf('id="workshopSaveStatus"') > html.indexOf('id="workshopPassageList"'), "statut après la liste de transcription");
  assert.ok(html.indexOf('id="workshopSaveStatus"') > html.indexOf('id="workshopComparePanel"'), "statut en fin du panneau de transcription");
  assert.ok(html.indexOf('id="workshopSaveStatus"') > html.indexOf('id="transcriptionWorkshopView"'), "statut contenu dans la vue atelier");
  /* Sauvegarde manuelle : action secondaire du menu « … », jamais un gros
     bouton dans l'en-tête — l'autosauvegarde reste le fonctionnement principal. */
  assert.match(html, /id="workshopActionsMenu"[\s\S]{0,800}id="workshopSaveDraftBtn"/, "« Enregistrer maintenant » vit dans le panneau du menu");
  assert.match(html, />Enregistrer maintenant</, "action de sauvegarde manuelle libellée « Enregistrer maintenant »");
  assert.match(html, /id="workshopSaveDraftBtn"[^>]*title="Écrire le brouillon dans le stockage local de ce navigateur"/, "but explicite : sauvegarde locale, pas de publication officielle");
  assert.doesNotMatch(html, /class="btn small" type="button" id="workshopSaveDraftBtn"/, "plus de gros bouton Enregistrer dans l’en-tête");
  assert.match(html, />Afficher l’aide</, "accès à l’aide du brouillon conservé dans le menu");
  assert.match(app, /event\.target\.closest\("#workshopSaveDraftBtn"\)/, "clic branché sur l’écriture immédiate");
  assert.match(app, /event\.target\.closest\("#workshopHelpBtn"\)/, "divulgateur de l’aide rebranché sur le menu");
  assert.doesNotMatch(html, />Valider la transcription</, "aucun bouton de validation fictif avant l’incrément 2");
  assert.match(html, /Emplacement de la validation officielle \(incrément 2\)/, "place réservée à la validation officielle dans la hiérarchie");
  assert.match(html, /id="workshopBackBtn"[^>]*aria-label="Retour"[^>]*><span class="dedicated-page-back-arrow"/, "flèche décorative et libellé de destination");
  assert.match(app, /function teardownTranscriptionWorkshop\(\)/, "nettoyage du lecteur à la sortie");
  for (const tab of ["Original", "Italien", "Français"]) assert.ok(html.includes(`>${tab}</button>`), `onglet ${tab} présent`);
  assert.ok(html.includes('id="workshopPrevBtn"') && html.includes('id="workshopNextBtn"'), "navigation Précédent / Suivant");
  assert.ok(html.includes("Comparer"), "mode Comparer accessible depuis les passages");
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
  assert.match(html, /\+ Ajouter un passage/, "libellé d’ajout de passage");
  assert.match(html, /id="workshopDivider"[^>]*role="separator"/, "séparateur de redimensionnement");
  for (const button of html.match(/<button[^>]*id="workshop[^>]*>/g)) {
    assert.match(button, /\btype="button"/, `bouton atelier sans type explicite : ${button}`);
  }
  // Deux panneaux sur ordinateur, onglets et filtres de champs sur mobile.
  assert.match(css, /grid-template-columns: minmax\(0, var\(--workshop-split, 55%\)\) auto minmax\(0, 1fr\)/, "deux zones de travail 55/45 redimensionnables");
  assert.match(css, /\.transcription-workshop-menu-panel \{/, "menu secondaire d’en-tête");
  assert.match(css, /\.dedicated-page-back \{[^}]*min-width: var\(--control-touch\)[^}]*min-height: var\(--control-touch\)/, "Retour commun ≥44px");
  assert.match(css, /\.transcription-workshop-heading h2 \{[^}]*-webkit-line-clamp: 2/, "titre Atelier lisible sur deux lignes maximum");
  assert.match(css, /\.transcription-workshop-passage\.is-selected \{ flex: 1 0 auto; min-height: 0;/, "le passage actif utilise la hauteur disponible");
  assert.match(css, /\.transcription-workshop-passage textarea \{ width: 100%; flex: 1 1 auto; min-height: clamp\(8rem, 24dvh, 16rem\)/, "champs de transcription agrandis selon la hauteur d’écran");
  assert.match(css, /\.transcription-workshop-passage-menu-panel \{/, "menu discret des actions de passage");
  assert.match(css, /\.transcription-workshop-image-viewport > img \{ position: absolute/, "zone d’ancrage suivant les offsets du lecteur");
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
  assert.match(app, /data-workshop-delete-passage/, "bouton de suppression des passages créés");
  assert.match(app, /isTranscriptionWorkshopPassageCreated\(draft, passage\.id\)/, "suppression réservée aux passages créés");
  assert.match(app, /Ajoutez un passage pour commencer/, "état vide orienté action");
  assert.match(css, /#workshopPageNav \.btn, #workshopPhotoNav \.btn \{ min-width: var\(--control-touch\)/, "cibles tactiles ≥ 44 px");
  /* Bloc mobile atelier : en-tête empilé + onglets dépliés. Extrait tel quel
     pour rester insensible aux longueurs de commentaires de style. */
  const workshopMobileBlock = css.match(/@media \(max-width: 760px\) \{\s*\/\* En-tête atelier[\s\S]*?\.transcription-workshop-tabs \{ display: flex; \}/)?.[0] || "";
  assert.ok(workshopMobileBlock, "bloc mobile de l’atelier présent");
  assert.match(workshopMobileBlock, /grid-template-columns: minmax\(0, 1fr\)/, "en-tête atelier empilé sur mobile");
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
  // Reprendre automatiquement à l'ouverture (mémoire d'abord, sinon localStorage).
  assert.match(app, /transcriptionWorkshopDrafts\.get\(key\) \|\| restoreTranscriptionWorkshopDraftFromStorage\(context\.documentId, page\.id\)/, "reprise du brouillon local à l'ouverture");
  assert.match(app, /restoreTranscriptionWorkshopDraft\(stored\.record\.snapshot\)/, "snapshot revalidé par le module pur avant import");
  // Sauvegarde automatique, différée et sans écriture inutile.
  assert.match(app, /scheduleTranscriptionWorkshopDraftSave\(transcriptionWorkshopDraft\)/, "programmation à chaque édition");
  assert.match(app, /const TRANSCRIPTION_DRAFT_SAVE_DELAY_MS = 400;/, "regroupement des frappes avant écriture");
  assert.match(app, /transcriptionDraftLastSnapshots\.get\(key\) === snapshotPayload/, "dernier contenu écrit dédupliqué");
  // Horodatage et refus d'écraser une version plus récente.
  assert.match(app, /buildTranscriptionDraftRecord\(draft, new Date\(\)\.toISOString\(\)\)/, "horodatage de dernière sauvegarde");
  assert.match(app, /transcriptionDraftWriteBlockReason\(storage, draft\.documentId, draft\.pageId, state\?\.savedAt \|\| null\)/, "comparaison avec la dernière version connue avant écriture");
  assert.match(app, /TRANSCRIPTION_DRAFT_CONFLICT_MESSAGE/, "avertissement explicite d'une version plus récente");
  // Échec de stockage : avertissement, mémoire conservée, aucune suppression.
  assert.match(app, /Sauvegarde locale impossible : le stockage du navigateur est indisponible ou complet\./, "échec annoncé en clair");
  assert.match(app, /Vos modifications restent en mémoire dans l’atelier\./, "conservation en mémoire en cas d'échec");
  assert.match(app, /function markTranscriptionWorkshopDraftSaveFailure\(key, status, message\)/, "état d'échec marqué par brouillon");
  assert.equal((app.match(/transcriptionWorkshopDrafts\.clear\(\)/g) || []).length, 1, "la mémoire des brouillons n'est vidée qu'à la fermeture de l'atelier");
  assert.match(app, /function resetTranscriptionWorkshopState[\s\S]{0,400}transcriptionWorkshopDrafts\.clear\(\)/, "effacement réservé à la fermeture de l'atelier, jamais après un échec");
  // États affichés discrètement sur le badge.
  for (const label of ["Enregistrement…", "Enregistré localement", "Échec de sauvegarde"]) {
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
  fields() { return [...document.querySelectorAll("[data-workshop-field]")].map(f => ({ p: f.dataset.workshopPassage, k: f.dataset.workshopField, v: f.value })); },
  stored() { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("familyTreeTranscriptionDraft:")) out.push([k, localStorage.getItem(k)]); } return out; }
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
      await page.evaluate(() => { window.__repro.openDoc(); window.__repro.transcribe(); });
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

    /* Saisie puis autosauvegarde : état écrit réellement. */
    await page.fill('[data-workshop-field="textIt"]', "Anno millenovecentosedici");
    await page.fill('[data-workshop-field="translationFr"]', "L’année mille neuf cent seize");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Enregistré localement", undefined, { timeout: 5000 });
    let stored = await page.evaluate(() => window.__repro.stored());
    assert.equal(stored.length, 1, "une copie locale écrite");
    assert.equal(JSON.parse(stored[0][1]).snapshot.passages[0].textIt, "Anno millenovecentosedici", "texte présent en local");

    /* Enregistrer maintenant : action du menu « … », écriture immédiate sans
       attendre le délai d'autosauvegarde. */
    await page.fill('[data-workshop-field="textIt"]', "Anno senza attesa");
    await page.click("#workshopActionsMenu > summary");
    await page.click("#workshopSaveDraftBtn");
    stored = await page.evaluate(() => window.__repro.stored());
    assert.equal(JSON.parse(stored[0][1]).snapshot.passages[0].textIt, "Anno senza attesa", "écriture immédiate au clic, avant le délai d’autosauvegarde");
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "le menu se ferme après l’action d’enregistrement");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Enregistré localement", undefined, { timeout: 1500 });
    await page.click("#workshopActionsMenu > summary");
    assert.equal(await page.locator("#workshopSaveDraftBtn").isDisabled(), false, "action Enregistrer réutilisable après de nouvelles modifications");
    await page.keyboard.press("Escape");

    /* Position du Retour : modèle de la fiche Document — à droite, sous le menu « … ». */
    const layout = await page.evaluate(() => {
      const back = document.getElementById("workshopBackBtn").getBoundingClientRect();
      const menu = document.getElementById("workshopActionsMenu").getBoundingClientRect();
      const header = document.querySelector(".transcription-workshop-header").getBoundingClientRect();
      return { back: [back.top, back.right, back.width, back.height], menuBottom: menu.bottom, headerRight: header.right, duplicates: document.querySelectorAll("#workshopBackBtn").length };
    });
    assert.equal(layout.duplicates, 1, "un seul bouton Retour");
    assert.ok(layout.back[0] >= layout.menuBottom - 1, `Retour positionné sous le menu « … » (${layout.back[0]} ≥ ${layout.menuBottom})`);
    assert.ok(layout.back[1] <= layout.headerRight + 1, "Retour aligné à droite de l’en-tête");
    assert.ok(layout.back[2] >= 44 && layout.back[3] >= 44, "Retour ≥ 44 px");

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
    await page.click("#workshopDocumentTitle");
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
    await page.click("#workshopDocumentTitle");
    assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "fermeture extérieure avant navigation");
    await page.click("#workshopBackBtn");
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    assert.deepEqual(dialogs, [], "sortie sans confirmation quand le brouillon est enregistré");

    /* Réouverture : restauration exacte des champs. */
    await page.evaluate(() => window.__repro.transcribe());
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    let fields = await page.evaluate(() => window.__repro.fields());
    assert.equal(fields.find(f => f.k === "textIt" && f.p === "p-1")?.v, "Anno senza attesa", "texte italien restauré à la réouverture");
    assert.equal(fields.find(f => f.k === "translationFr" && f.p === "p-1")?.v, "L’année mille neuf cent seize", "traduction restaurée à la réouverture");
    assert.equal(await page.evaluate(() => window.__repro.badge()), "Enregistré localement", "état enregistré restauré");
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
    await page.click("#workshopBackBtn");
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
        for (const [width, height] of [[320, 780], [390, 844], [760, 900]]) {
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
              await page.waitForTimeout(300);
              const scrollState = await page.evaluate(() => ({ y: window.scrollY, container: document.getElementById("transcriptionWorkshopView").scrollTop }));
              assert.equal(scrollState.y, 0, "fenêtre au début de l’atelier");
              assert.equal(scrollState.container, 0, "conteneur de défilement au début");

              const layout = await page.evaluate(() => {
                const header = document.querySelector(".transcription-workshop-header").getBoundingClientRect();
                const kicker = document.querySelector(".transcription-workshop-heading .page-kicker");
                const heading = document.querySelector(".transcription-workshop-heading").getBoundingClientRect();
                const label = document.getElementById("workshopPageLabel");
                const labelRect = label.getBoundingClientRect();
                const menu = document.getElementById("workshopActionsMenu").getBoundingClientRect();
                const back = document.getElementById("workshopBackBtn").getBoundingClientRect();
                const tabs = [...document.querySelectorAll(".transcription-workshop-tab")].map(tab => { const r = tab.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
                const tools = [...document.querySelectorAll("#workshopImageTools button")].map(button => { const r = button.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
                return {
                  kickerText: kicker.textContent.trim(),
                  kickerScroll: kicker.scrollWidth,
                  headingWidth: Math.round(heading.width),
                  headingBottom: heading.bottom,
                  headerHeight: header.height,
                  labelWhiteSpace: getComputedStyle(label).whiteSpace,
                  labelHeight: Math.round(labelRect.height),
                  menuTop: menu.top, menuRight: menu.right, menuHeight: Math.round(menu.height),
                  backTop: back.top, backRight: back.right, backWidth: Math.round(back.width), backHeight: Math.round(back.height),
                  headerRight: header.right,
                  tabs, tools,
                  pageScroll: document.documentElement.scrollWidth,
                  viewport: innerWidth
                };
              });
              /* Titre « Atelier de transcription » entièrement lisible. */
              assert.equal(layout.kickerText, "Atelier de transcription", "titre du métier intact");
              assert.ok(layout.kickerScroll <= layout.headingWidth + 1, `titre sans troncature (${layout.kickerScroll} ≤ ${layout.headingWidth})`);
              /* « Page X · Y passages » compact : une seule ligne. */
              assert.equal(layout.labelWhiteSpace, "nowrap", "libellé de page sur une seule ligne");
              assert.ok(layout.labelHeight <= 26, `libellé de page compact sans retour à la ligne (${layout.labelHeight}px)`);
              /* En-tête compact : moins haut qu'auparavant (211 px max à 390,
                 208 px à 320 dans la version précédente). */
              assert.ok(layout.headerHeight <= 205, `en-tête mobile compact (${layout.headerHeight}px ≤ 205px)`);
              /* Empilement : actions (menu) sous le titre, sans chevauchement —
                 le statut de sauvegarde n'est plus dans l'en-tête. */
              assert.ok(layout.headingBottom <= layout.menuTop + 1, `menu sous le titre sans chevauchement (${layout.headingBottom} ≤ ${layout.menuTop})`);
              /* Menu à droite ; Retour à droite, sous le menu ; cibles ≥ 44 px. */
              assert.ok(layout.menuRight <= layout.headerRight + 1, "menu « … » à droite de l’en-tête");
              assert.ok(layout.backRight <= layout.headerRight + 1, "Retour à droite de l’en-tête");
              assert.ok(layout.backTop >= layout.menuTop + layout.menuHeight - 1, `Retour sous le menu « … » (${layout.backTop} ≥ ${layout.menuTop + layout.menuHeight - 1})`);
              assert.ok(layout.backWidth >= 44 && layout.backHeight >= 44, `Retour ≥ 44 px (${layout.backWidth}×${layout.backHeight})`);
              assert.ok(layout.menuHeight >= 44, `menu « … » ≥ 44 px (${layout.menuHeight})`);
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

              /* Statut de sauvegarde : pied d'atelier du panneau de
                 transcription, visible après la zone de saisie — jamais dans
                 l'en-tête, jamais au-dessus de l'image. */
              const inHeader = await page.evaluate(() => !!document.getElementById("workshopSaveStatus").closest(".transcription-workshop-header"));
              assert.equal(inHeader, false, "statut absent de l’en-tête");
              await page.click("#workshopTabItalian");
              await page.waitForTimeout(150);
              const footerState = await page.evaluate(() => {
                const status = document.getElementById("workshopSaveStatus").getBoundingClientRect();
                const list = document.getElementById("workshopPassageList").getBoundingClientRect();
                const header = document.querySelector(".transcription-workshop-header").getBoundingClientRect();
                return {
                  statusTop: Math.round(status.top),
                  statusHeight: Math.round(status.height),
                  listBottom: Math.round(list.bottom),
                  headerBottom: Math.round(header.bottom),
                  inFooter: !!document.getElementById("workshopSaveStatus").closest(".transcription-workshop-footer"),
                  inRightPanel: !!document.getElementById("workshopSaveStatus").closest("#workshopPanelRight")
                };
              });
              assert.equal(footerState.inFooter, true, "statut dans le pied d’atelier");
              assert.equal(footerState.inRightPanel, true, "statut dans le panneau de transcription");
              assert.ok(footerState.statusHeight > 0, "statut visible sur l’onglet de saisie");
              assert.ok(footerState.statusTop >= footerState.headerBottom - 1, `statut hors de l’en-tête (${footerState.statusTop} ≥ ${footerState.headerBottom})`);
              assert.ok(footerState.statusTop >= footerState.listBottom - 1, `statut après la zone de saisie (${footerState.statusTop} ≥ ${footerState.listBottom})`);

              /* Menu contextuel complet en mobile : ouverture, clic extérieur, Échap. */
              await page.click("#workshopActionsMenu > summary");
              assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), true, "menu ouvert");
              await page.click("#workshopDocumentTitle");
              assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "clic extérieur ferme le menu");
              await page.click("#workshopActionsMenu > summary");
              await page.keyboard.press("Escape");
              assert.equal(await page.evaluate(() => document.getElementById("workshopActionsMenu").open), false, "Échap ferme le menu");

              /* Échec de stockage : avertissement immédiat même si le statut
                 est en bas, brouillon conservé en mémoire, aucun succès
                 trompeur — puis récupération par « Enregistrer maintenant ». */
              await page.fill('[data-workshop-field="textIt"]', "Anno sotto errore");
              await page.evaluate(() => {
                window.__nativeSetItem = Storage.prototype.setItem;
                Storage.prototype.setItem = function() {
                  const error = new Error("QuotaExceededError");
                  error.name = "QuotaExceededError";
                  throw error;
                };
              });
              await page.waitForTimeout(700);
              const failure = await page.evaluate(() => ({
                status: document.getElementById("workshopSaveStatus").textContent,
                failedClass: document.getElementById("workshopSaveStatus").classList.contains("is-failed"),
                warningVisible: [...document.querySelectorAll(".toast")].some(toast => toast.textContent.includes("Sauvegarde locale impossible") && toast.classList.contains("show")),
                firstField: document.querySelector('[data-workshop-field="textIt"]')?.value
              }));
              assert.equal(failure.status, "Échec de sauvegarde", "état d’échec affiché dans le pied");
              assert.equal(failure.failedClass, true, "état d’échec coloré");
              assert.equal(failure.warningVisible, true, "avertissement immédiat visible via le toast");
              assert.equal(failure.firstField, "Anno sotto errore", "brouillon conservé en mémoire malgré l’échec");
              await page.evaluate(() => { Storage.prototype.setItem = window.__nativeSetItem; });
              await page.click("#workshopActionsMenu > summary");
              await page.click("#workshopSaveDraftBtn");
              await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Enregistré localement", undefined, { timeout: 3000 });
              const recovered = await page.evaluate(() => ({ stored: window.__repro.stored().length, status: document.getElementById("workshopSaveStatus").textContent }));
              assert.ok(recovered.stored >= 1, "récupération écrite après rétablissement du stockage");
              assert.equal(recovered.status, "Enregistré localement", "retour à un état de succès réel");

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
