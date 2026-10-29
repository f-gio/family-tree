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
  assert.match(html, /class="dedicated-page-return"/, "Retour Atelier sur sa ligne indépendante hors en-tête");
  assert.match(html, /id="workshopBackBtn"[^>]*aria-label="Retour"[^>]*><span class="dedicated-page-back-arrow"/, "flèche décorative et libellé de destination");
  assert.match(app, /function teardownTranscriptionWorkshop\(\)/, "nettoyage du lecteur à la sortie");
  for (const tab of ["Original", "Italien", "Français"]) assert.ok(html.includes(`>${tab}</button>`), `onglet ${tab} présent`);
  assert.ok(html.includes('id="workshopPrevBtn"') && html.includes('id="workshopNextBtn"'), "navigation Précédent / Suivant");
  assert.ok(html.includes("Comparer"), "mode Comparer accessible depuis les passages");
  assert.match(html, /id="workshopDraftBadge"[^>]*>Brouillon local</, "indicateur compact « Brouillon local »");
  assert.match(html, /Les corrections ne sont pas encore enregistrées officiellement et seront perdues à la fermeture ou au rechargement\./, "explication détaillée consultable");
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
  assert.match(css, /@media \(max-width: 760px\)[\s\S]{0,500}\.transcription-workshop-tabs \{ display: flex; \}/, "onglets mobiles");
  assert.match(css, /\.transcription-workshop-passage\.is-selected/, "sélection de passage visible");
  assert.match(css, /--control-touch/, "cibles tactiles via le token existant");
});
