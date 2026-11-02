import assert from "node:assert/strict";
import test from "node:test";
import {
  PALEOGRAPHIC_CONFIDENCE,
  TRANSCRIPTION_CHANGE_KINDS,
  comparePageTextRevisions,
  createPageTextRevision,
  createReadingHypothesis,
  createTranscriptionPassage,
  hasTranscriptionContent,
  orderTranscriptionRevisionHistory,
  reconstructFrenchTranslation,
  reconstructItalianTranscription,
  validateTranscriptionPassage
} from "../js/document-transcription.js";

function passage(id, overrides = {}) {
  return createTranscriptionPassage({ id, order: 0, textIt: "Carlo", translationFr: "Charles", ...overrides });
}

function revision(id, passages, overrides = {}) {
  return createPageTextRevision({
    id,
    documentId: "document-1",
    pageId: "page-1",
    passages,
    ...overrides
  });
}

test("transcription italienne conserve graphies, abréviations, ponctuation et retours à la ligne", () => {
  const passages = [
    passage("p-2", { order: 1, textIt: "q.m.", translationFr: null, separatorAfter: "\n", unreadable: true }),
    passage("p-1", { order: 0, textIt: "Carlo Rossi, fu detto\nfiglio", separatorAfter: "\n" })
  ];
  const snapshot = revision("rev-1", passages);

  assert.equal(snapshot.transcriptionIt, "Carlo Rossi, fu detto\nfiglio\nq.m.\n");
  assert.equal(reconstructItalianTranscription(snapshot.passages), snapshot.transcriptionIt);
  assert.equal(snapshot.passages[1].textIt, "q.m.");
  assert.equal(snapshot.passages[1].unreadable, true);
});

test("transcription partielle ou absente et traduction partielle ou absente restent représentables", () => {
  const partial = revision("rev-partial", [
    passage("p-1", { textIt: "Nel milleottocento", translationFr: "En mille huit cent" }),
    passage("p-2", { order: 1, textIt: "", translationFr: null, unreadable: true, hypotheses: [createReadingHypothesis({ id: "h-1", text: "...", confidence: "unknown" })] })
  ]);
  const none = revision("rev-empty", []);

  assert.equal(partial.transcriptionIt, "Nel milleottocento");
  assert.equal(partial.translationFr, "En mille huit cent");
  assert.equal(partial.passages[1].translationState, "not-started");
  assert.equal(none.transcriptionIt, "");
  assert.equal(none.translationFr, null);
});

test("la traduction française est distincte, peut être partielle et se reconstitue par ordre", () => {
  const passages = [
    passage("p-2", { order: 1, textIt: "residente", translationFr: null, separatorAfter: "\n" }),
    passage("p-1", { order: 0, textIt: "Nato a Torino", translationFr: "Né à Turin", separatorAfter: "\n" })
  ];
  assert.equal(reconstructItalianTranscription(passages), "Nato a Torino\nresidente\n");
  assert.equal(reconstructFrenchTranslation(passages), "Né à Turin\n\n");
  assert.notEqual(reconstructItalianTranscription(passages), reconstructFrenchTranslation(passages));
});

test("hypothèses paléographiques et niveaux de confiance sont explicites et qualitatifs", () => {
  const hypotheses = [
    createReadingHypothesis({ id: "lecture-principale", text: "Carlo", confidence: "medium", note: "Première lettre peu lisible" }),
    createReadingHypothesis({ id: "lecture-alternative", text: "Paolo", confidence: "low" })
  ];
  const primary = passage("p-1", { textIt: "Carlo", hypotheses, unreadable: false });
  const unreadable = passage("p-2", { order: 1, textIt: "", unreadable: true });
  const snapshot = revision("rev-paleo", [primary, unreadable]);

  assert.deepEqual(PALEOGRAPHIC_CONFIDENCE, ["high", "medium", "low", "unknown"]);
  assert.equal(snapshot.passages[0].hypotheses[1].text, "Paolo");
  assert.equal(snapshot.passages[0].hypotheses[0].confidence, "medium");
  assert.equal(snapshot.passages[1].unreadable, true);
  assert.ok(TRANSCRIPTION_CHANGE_KINDS.includes("transcription-correction"));
  assert.throws(() => createReadingHypothesis({ id: "bad", text: "X", confidence: "97%" }), /confiance/);
});

test("une zone normalisée référence une photo précise et accepte l'absence d'ancre", () => {
  const anchor = { shape: "rect", photographId: "photo-1", x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
  const valid = passage("p-1", { anchor });
  const withoutZone = passage("p-2", { order: 1, anchor: null });

  assert.equal(validateTranscriptionPassage(valid, { photographIds: ["photo-1", "photo-2"] }).valid, true);
  assert.equal(validateTranscriptionPassage(withoutZone, { photographIds: ["photo-1"] }).valid, true);
  assert.equal(validateTranscriptionPassage(valid, { photographIds: ["other-photo"] }).valid, false);
  assert.equal(validateTranscriptionPassage({ ...valid, anchor: { ...anchor, x: 0.9, width: 0.3 } }).valid, false);
  assert.equal(validateTranscriptionPassage({ ...valid, anchor: { ...anchor, width: 0 } }).valid, false);
});

test("la révision fige le contenu et garde auteur/date inconnus sans les fabriquer", () => {
  const inputPassage = { id: "p-1", order: 0, textIt: "Carlo", translationFr: null, separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "", translationState: "not-started" };
  const snap = revision("rev-1", [inputPassage], { authorUid: null, changedAt: null, justification: "" });
  inputPassage.textIt = "Autre texte";

  assert.equal(snap.passages[0].textIt, "Carlo");
  assert.equal(snap.authorUid, null);
  assert.equal(snap.changedAt, null);
  assert.ok(Object.isFrozen(snap));
  assert.ok(Object.isFrozen(snap.passages));
  assert.ok(Object.isFrozen(snap.passages[0]));
  assert.throws(() => { snap.passages[0].textIt = "Mutation"; }, TypeError);
  assert.equal(revision("rev-date", [], { changedAt: new Date("2026-10-19T12:00:00.000Z") }).changedAt, "2026-10-19T12:00:00.000Z");
});

test("les IDs de document, page, révision et passage sont fournis et validés", () => {
  assert.throws(() => createPageTextRevision({ documentId: "doc", pageId: "page" }), /revision.id/);
  assert.throws(() => createPageTextRevision({ id: "rev", documentId: "doc", pageId: "page", previousRevisionId: "rev" }), /elle-même/);
  assert.throws(() => revision("rev-duplicate", [passage("p-1"), passage("p-1", { order: 1 })]), /IDs de passage/);
  assert.throws(() => revision("rev-order", [passage("p-1"), passage("p-2")]), /ordre des passages/);
});

test("une ancre de passage ne peut pas viser une photo d'une autre page", () => {
  const anchored = passage("p-1", { anchor: { shape: "rect", photographId: "photo-not-on-page", x: 0, y: 0, width: 0.2, height: 0.2 } });
  assert.throws(() => createPageTextRevision({
    id: "rev-anchor",
    documentId: "document-1",
    pageId: "page-1",
    passages: [anchored],
    photographIds: ["photo-page-1"]
  }), /photographie absente/);
});

test("B2 : les ancres PDF sont validées rétrocompatiblement avec les ancres JPEG", () => {
  const pdfAnchor = { shape: "rect", pdfPage: 2, fileSha256: "a".repeat(64), x: 0.1, y: 0.1, width: 0.3, height: 0.2 };
  const withPdf = passage("p-pdf", { anchor: pdfAnchor });
  assert.deepEqual(validateTranscriptionPassage(withPdf, { photographIds: ["photo-page-1"] }).errors, [],
    "ancre PDF acceptée même avec une liste de photographies (l'appartenance photo ne concerne que les ancres JPEG)");
  const snapshot = revision("rev-b2-pdf", [withPdf]);
  assert.equal(snapshot.passages[0].anchor.pdfPage, 2, "l'ancre PDF survit à la création de révision");
  assert.equal(snapshot.passages[0].anchor.fileSha256, "a".repeat(64), "l'empreinte du fichier est conservée");
  assert.throws(() => passage("p-both", { anchor: { ...pdfAnchor, photographId: "photo-1" } }), /photographie ou une page PDF/,
    "jamais de cible double");
  assert.throws(() => passage("p-none", { anchor: { shape: "rect", x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }), /photographie ou une page PDF/,
    "jamais de cible absente");
  assert.throws(() => passage("p-page0", { anchor: { shape: "rect", pdfPage: 0, fileSha256: "a".repeat(64), x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }), /pdfPage/,
    "page PDF entière 1-based");
  assert.throws(() => passage("p-hash", { anchor: { shape: "rect", pdfPage: 1, fileSha256: "abc", x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }), /fileSha256/,
    "empreinte SHA-256 valide exigée");
  assert.throws(() => passage("p-oob", { anchor: { shape: "rect", pdfPage: 1, fileSha256: "a".repeat(64), x: 0.9, y: 0.1, width: 0.5, height: 0.2 } }), /limites normalisées/,
    "bornes normalisées identiques à B1");
  const jpegAnchor = { shape: "rect", photographId: "photo-1", x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
  const withJpeg = passage("p-jpeg", { anchor: jpegAnchor });
  assert.deepEqual(validateTranscriptionPassage(withJpeg, { photographIds: ["photo-1"] }).errors, [], "ancre JPEG inchangée");
});

test("une modification de mise en forme ne demande pas de réexamen de preuve", () => {
  const before = revision("rev-before-format", [passage("stable-passage", { textIt: "Carlo Rossi\nfiglio" })]);
  const after = revision("rev-after-format", [passage("stable-passage", { textIt: "  Carlo   Rossi figlio  " })], { previousRevisionId: before.id, changeKind: "formatting" });
  const changes = comparePageTextRevisions(before, after);

  assert.equal(changes.passageChanges[0].change, "formatting-only");
  assert.equal(changes.passageChanges[0].substantive, false);
  assert.deepEqual(changes.passagesRequiringProofReview, []);
});

test("une correction italienne substantielle signale la preuve et une traduction restée inchangée", () => {
  const before = revision("rev-before-text", [passage("stable-passage", { textIt: "Carlo", translationFr: "Charles" })]);
  const after = revision("rev-after-text", [passage("stable-passage", { textIt: "Paolo", translationFr: "Charles" })], { previousRevisionId: before.id, changeKind: "transcription-correction" });
  const changes = comparePageTextRevisions(before, after);

  assert.equal(changes.passageChanges[0].change, "substantive");
  assert.deepEqual(changes.passagesRequiringProofReview, ["stable-passage"]);
  assert.deepEqual(changes.passagesWithTranslationToReview, ["stable-passage"]);
  assert.equal(after.passages[0].translationState, "current", "la comparaison signale le besoin, sans muter ni suspendre les données");
});

test("une correction de traduction est distincte de la correction italienne", () => {
  const before = revision("rev-before-fr", [passage("stable-passage", { textIt: "Carlo", translationFr: "Charles" })]);
  const after = revision("rev-after-fr", [passage("stable-passage", { textIt: "Carlo", translationFr: "Karl" })], { previousRevisionId: before.id, changeKind: "translation-correction" });
  const changes = comparePageTextRevisions(before, after);

  assert.deepEqual(changes.passagesRequiringProofReview, ["stable-passage"]);
  assert.deepEqual(changes.passagesWithTranslationToReview, []);
});

test("le déplacement d'un passage conserve son ID et n'est pas substantiel", () => {
  const before = revision("rev-before-order", [
    passage("p-1", { order: 0, textIt: "Carlo" }),
    passage("p-2", { order: 1, textIt: "Rossi" })
  ]);
  const after = revision("rev-after-order", [
    passage("p-2", { order: 0, textIt: "Rossi" }),
    passage("p-1", { order: 1, textIt: "Carlo" })
  ], { previousRevisionId: before.id, changeKind: "layout" });
  const changes = comparePageTextRevisions(before, after);

  assert.deepEqual(changes.passagesRequiringProofReview, []);
  assert.ok(changes.passageChanges.every(change => change.change === "presentation-only"));
});

test("ajouter un passage ne suspend pas les références des passages préexistants", () => {
  const before = revision("rev-before-add", [passage("existing", { textIt: "Carlo" })]);
  const after = revision("rev-after-add", [
    passage("existing", { textIt: "Carlo" }),
    passage("new-passage", { order: 1, textIt: "Rossi" })
  ], { previousRevisionId: before.id });
  const changes = comparePageTextRevisions(before, after);

  assert.deepEqual(changes.passagesRequiringProofReview, []);
  assert.equal(changes.passageChanges.find(change => change.passageId === "new-passage").change, "added");
});

test("supprimer un passage ou déplacer son ancre vers une autre vue signale un réexamen", () => {
  const before = revision("rev-before-anchor", [passage("p-1", {
    textIt: "Carlo",
    anchor: { shape: "rect", photographId: "photo-1", x: 0.1, y: 0.1, width: 0.2, height: 0.1 }
  })]);
  const afterAnchor = revision("rev-after-anchor", [passage("p-1", {
    textIt: "Carlo",
    anchor: { shape: "rect", photographId: "photo-2", x: 0.1, y: 0.1, width: 0.2, height: 0.1 }
  })], { previousRevisionId: before.id });
  const afterRemove = revision("rev-after-remove", [], { previousRevisionId: before.id });

  assert.deepEqual(comparePageTextRevisions(before, afterAnchor).passagesRequiringProofReview, ["p-1"]);
  assert.deepEqual(comparePageTextRevisions(before, afterRemove).passagesRequiringProofReview, ["p-1"]);
});

test("une révision ne peut pas être comparée à une autre cible documentaire", () => {
  const before = revision("rev-a", [passage("p-1")]);
  const otherPage = revision("rev-b", [passage("p-1")], { pageId: "page-2" });
  assert.throws(() => comparePageTextRevisions(before, otherPage), /même document et la même page/);
});

test("validation : le texte italien vide est interdit, la traduction française reste facultative", () => {
  assert.equal(hasTranscriptionContent([]), false, "aucun passage : rien à valider");
  assert.equal(hasTranscriptionContent([passage("p-1", { textIt: "   ", translationFr: "Charles" })]), false,
    "italien blanc même avec une traduction présente : validation interdite");
  assert.equal(hasTranscriptionContent([passage("p-1", { textIt: "", translationFr: null })]), false, "italien vide : validation interdite");
  assert.equal(hasTranscriptionContent([passage("p-1", { textIt: "Carlo", translationFr: null })]), true,
    "italien non vide SANS traduction française : validation autorisée");
  assert.equal(hasTranscriptionContent(null), false, "entrée non tableau : rien à valider");
});

test("historique : chaîne de révisions ordonnée, immuable et robuste aux liens manquants", () => {
  const head = { version: 3, revisionId: "r-3" };
  const revisions = [
    { id: "r-3", previousRevisionId: "r-2", data: { transcriptionIt: "C" } },
    { id: "r-2", previousRevisionId: "r-1", data: { transcriptionIt: "B" } },
    { id: "r-1", previousRevisionId: null, data: { transcriptionIt: "A" } },
    { id: "orphan", previousRevisionId: "jamais-lie", data: { transcriptionIt: "?" } }
  ];
  const ordered = orderTranscriptionRevisionHistory(head, revisions);
  assert.deepEqual(ordered.map(entry => [entry.revisionId, entry.version]), [["r-3", 3], ["r-2", 2], ["r-1", 1]],
    "de la version courante à la première, numérotée en descendant");
  assert.equal(ordered.some(entry => entry.revisionId === "orphan"), false, "révision orpheline jamais présentée");
  /* Chaîne interrompue : s'arrête sans erreur, jamais de réécriture. */
  const broken = orderTranscriptionRevisionHistory(head, [{ id: "r-3", previousRevisionId: "absent", data: {} }]);
  assert.deepEqual(broken.map(entry => [entry.revisionId, entry.version]), [["r-3", 3]], "lien manquant : arrêt propre");
  /* Version plancher : un head sans version entière reste lisible. */
  const clamped = orderTranscriptionRevisionHistory({ version: undefined, revisionId: "r-1" }, [{ id: "r-1", previousRevisionId: null, data: {} }]);
  assert.deepEqual(clamped.map(entry => entry.version), [1], "version par défaut bornée à 1");
  assert.throws(() => orderTranscriptionRevisionHistory(null, []), /head/, "en-tête requis");
  assert.throws(() => orderTranscriptionRevisionHistory(head, "liste"), /revisions/, "liste de révisions requise");
});
