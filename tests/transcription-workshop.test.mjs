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
  WORKSHOP_TRANSLATION_STATE_LABELS
} from "../js/transcription-workshop.js";
import { createTranscriptionPassage } from "../js/document-transcription.js";

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
  assert.match(app, /confirmTranscriptionWorkshopClose/, "confirmation avant fermeture");
  assert.match(app, /addEventListener\("beforeunload"/, "garde avant rechargement de la page");
  assert.match(app, /Brouillon local : ces corrections ne sont pas encore enregistrées officiellement|workshopDraftNotice/, "avertissement de brouillon local");
  assert.doesNotMatch(app, /createPageTextRevision\(\{[\s\S]{0,120}workshop/, "aucune révision créée depuis l’atelier");
  assert.ok(!/from\s+["'][^"']*firebase/.test(workshop), "aucun import Firebase dans le module pur");
  assert.ok(!/\b(setDoc|addDoc|updateDoc|deleteDoc|onSnapshot|getDoc|getDocs|writeBatch|runTransaction)\s*\(/.test(workshop), "aucun accès Firestore dans le module pur");
  assert.match(html, /id="transcriptionWorkshopDialog"/, "dialog de l’atelier présent");
  for (const tab of ["Original", "Italien", "Français"]) assert.ok(html.includes(`>${tab}</button>`), `onglet ${tab} présent`);
  assert.ok(html.includes('id="workshopPrevBtn"') && html.includes('id="workshopNextBtn"'), "navigation Précédent / Suivant");
  assert.ok(html.includes("Comparer"), "mode Comparer accessible depuis les passages");
  assert.match(html, /Brouillon local : ces corrections ne sont pas encore enregistrées officiellement\./, "notice de brouillon dans le HTML");
  assert.match(html, /data-close="transcriptionWorkshopDialog"/, "fermeture via le mécanisme data-close existant");
  assert.ok(html.includes('id="workshopAddPassageBtn"'), "bouton d’ajout de passage dans le footer");
  assert.match(html, /\+ Ajouter un passage/, "libellé d’ajout de passage");
  for (const button of html.match(/<button[^>]*id="workshop[^>]*>/g)) {
    assert.match(button, /\btype="button"/, `bouton atelier sans type explicite : ${button}`);
  }
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
  assert.match(css, /\.transcription-workshop-nav \.btn, \.transcription-workshop-actions \.btn \{ min-height: var\(--control-touch\); \}/, "boutons tactiles du footer");
  assert.match(css, /\.transcription-workshop-layout \{ display: grid; grid-template-columns: minmax\(0, 1\.15fr\)/, "layout ordinateur à trois volets");
  assert.match(css, /@media \(max-width: 760px\)[\s\S]{0,400}\.transcription-workshop-tabs \{ display: flex; \}/, "onglets mobiles");
  assert.match(css, /\.transcription-workshop-passage\.is-selected/, "sélection de passage visible");
  assert.match(css, /--control-touch/, "cibles tactiles via le token existant");
});
