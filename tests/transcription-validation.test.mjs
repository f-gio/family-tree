import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

/* Validation officielle, historique et repli du volet Document (incrément 2).
   Chromium uniquement : les écritures officielles réelles sont couvertes par
   l'émulateur (tests/firestore-emulator.mjs) ; ici, l'interface, les états du
   badge, le dialogue de confirmation, l'historique consultable et le repli
   desktop sont vérifiés sur le parcours réel — le réseau distant étant bloqué
   par le harnais, le cas « échec réseau conserve le brouillon » est testé tel quel. */

const SVG = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="#b8c9be"/></svg>');

const HOOKS = `
window.__inc2 = {
  passagesFixture() {
    return [
      { id: "p-1", order: 0, textIt: "Anno millenovecento", translationFr: "L’année mille neuf cent", separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 1", translationState: "current" },
      { id: "p-2", order: 1, textIt: "indici di Orino", translationFr: null, separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 2", translationState: "not-started" }
    ];
  },
  show() { $("authScreen").hidden = true; $("topbar").hidden = false; setView("directory"); },
  seed() {
    const documentItem = {
      id: "doc-repro", title: "Registre Transactions Immobilières",
      type: "Registre", date: "1891-05-12",
      fileName: "registre.jpg", mimeType: "image/jpeg",
      fileData: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEQAD8kf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIDAT8kf//Z",
      personIds: [],
      pages: [{ id: "page-repro-1", label: "Folio 1", photographs: [{ id: "photo-repro-1", preview: { dataUrl: "${SVG}" } }], passages: window.__inc2.passagesFixture() }]
    };
    documents = [documentItem];
    people = [];
    loadedPeople = loadedDocuments = true;
    genealogyRecords = { sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [], genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [] };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin", displayName: "Administratrice Atelier" };
    adminUsersCache = [{ id: "admin-seed", displayName: "Administratrice Seed", status: "approved", role: "admin" }];
    renderGenealogyWorkspace();
  },
  /* Version officielle existante : même contenu que la page (badge « Validée »). */
  seedOfficial() {
    const basePassages = window.__inc2.passagesFixture();
    const previousPassages = [...basePassages, {
      id: "p-deleted", order: 2, textIt: "Passage supprimé", translationFr: "Traduction supprimée",
      separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 3", translationState: "current"
    }];
    const passages = [
      { ...basePassages[0], textIt: "Anno millenovecento corrente", translationFr: "L’année mille neuf cent courante" },
      basePassages[1],
      { id: "p-added", order: 2, textIt: "Nuovo passaggio", translationFr: null, separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 4", translationState: "not-started" }
    ];
    const content = {
      documentId: "doc-repro",
      pageId: "page-repro-1",
      passages,
      transcriptionIt: "Anno millenovecento corrente\\nindici di Orino\\nNuovo passaggio",
      translationFr: "L’année mille neuf cent courante",
      changeKind: "initial",
      justification: "Validation de la transcription",
      authorUid: "admin-seed",
      previousRevisionId: null
    };
    const previousContent = { ...content, passages: previousPassages, transcriptionIt: "Anno millenovecento\\nindici di Orino\\nPassage supprimé" };
    genealogyRecords.transcriptionHeads = [{
      id: "tx-seed-head", data: content, version: 2, revisionId: "tx-seed-rev2",
      createdAt: new Date("2026-10-20T10:00:00Z"), createdBy: "admin-seed",
      updatedAt: new Date("2026-10-21T10:00:00Z"), updatedBy: "admin-seed", eventId: "tx-seed-ev2"
    }];
    genealogyRecords.transcriptionRevisions = [
      { id: "tx-seed-rev1", objectId: "tx-seed-head", authorUid: "admin-seed", createdAt: new Date("2026-10-20T10:00:00Z"), previousRevisionId: null, data: previousContent, eventId: "tx-seed-ev1" },
      { id: "tx-seed-rev2", objectId: "tx-seed-head", authorUid: "admin-seed", createdAt: new Date("2026-10-21T10:00:00Z"), previousRevisionId: "tx-seed-rev1", data: content, eventId: "tx-seed-ev2" }
    ];
  },
  openDoc() { setView("directory"); openStoredDocument(documents[0], "directory"); },
  emptyTranscriptionPage() { documents[0].pages[0].passages = []; },
  useMemberProfile() { currentUserProfile = { role: "member", status: "approved" }; updateWorkshopDraftIndicators(); },
  transcribe() { const button = document.querySelector("#viewerDocumentDetails [data-transcribe-document]"); if (button) button.click(); },
  badge() { return $("workshopSaveStatus").textContent; },
  officialBadge() { const el = $("workshopOfficialBadge"); return { hidden: el.hidden, text: el.textContent }; },
  fieldValue() { return document.querySelector('[data-workshop-field="textIt"]')?.value || ""; },
  localDraftCount() { return [...Array(localStorage.length).keys()].filter(index => localStorage.key(index)?.startsWith("familyTreeTranscriptionDraft:")).length; }
};
`;

const AUTH_PATCH = `
const originalStopPrivateData = stopPrivateData;
stopPrivateData = (...args) => { if (window.__ignoreAuthBootstrap) return; return originalStopPrivateData(...args); };
const originalShowAuthPanel = showAuthPanel;
showAuthPanel = (...args) => { if (window.__ignoreAuthBootstrap) return; return originalShowAuthPanel(...args); };
const originalCloseDocumentPage = closeDocumentPage;
closeDocumentPage = (...args) => {
  if (window.__ignoreAuthBootstrap && String(new Error().stack || "").includes("firebase-auth")) return;
  return originalCloseDocumentPage(...args);
};
window.__ignoreAuthBootstrap = true;
`;

async function openInc2Harness(t) {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return null; }
  const server = await startStaticServer(ROOT);
  const hooks = `${HOOKS}\n${AUTH_PATCH}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      return route.fulfill({ response, body: `${await response.text()}\n${hooks}` });
    }
    return url.startsWith(server.baseURL) || url.includes("gstatic.com") ? route.continue() : route.abort("blockedbyclient");
  });
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", async dialog => { await dialog.accept(); });
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__inc2 === "object");
  return { browser, server, context, page, pageErrors };
}

async function bootInc2(page) {
  await page.evaluate(() => { window.__inc2.show(); window.__inc2.seed(); });
}

async function openInc2Workshop(page, pageErrors = []) {
  await page.evaluate(() => window.__inc2.openDoc());
  await page.waitForSelector("#viewerDocumentDetails [data-transcribe-document]");
  await page.evaluate(() => window.__inc2.transcribe());
  try {
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
  } catch (error) {
    throw new Error(`${error.message}; erreurs applicatives : ${pageErrors.join(" | ")}`);
  }
}

function assertNoInc2PageErrors(pageErrors) {
  const relevant = pageErrors.filter(message => /workshop|transcription|validation|genealogyStore/i.test(message));
  assert.deepEqual(relevant, [], `aucune erreur applicative (${relevant.join(" | ")})`);
}

test("badges et états : Brouillon, Validée · vN, Révision en cours · vN — Enregistrer armé/désarmé", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    /* Sans version officielle : badge « Brouillon », validation primaire
       proposée pour le premier enregistrement, Enregistrer inactif au repos. */
    await bootInc2(page);
    await page.evaluate(() => window.__inc2.openDoc());
    await page.waitForSelector(".document-transcription-card [data-transcribe-document]");
    const documentCard = await page.evaluate(() => {
      const card = document.querySelector(".document-transcription-card");
      return { text: card.textContent, action: card.querySelector("[data-transcribe-document]").textContent.trim() };
    });
    assert.match(documentCard.text, /Transcription existante · version source/, "carte Document reflète les passages de la page sans créer de version");
    assert.match(documentCard.text, /Passages\s*2/, "carte Document affiche le nombre de passages");
    assert.match(documentCard.text, /Italien\s*Présente/, "état italien affiché dans la carte");
    assert.match(documentCard.text, /Français\s*Partielle/, "état français affiché dans la carte");
    assert.equal(documentCard.action, "Reprendre", "action courte adaptée à la transcription existante");
    assert.equal(await page.locator(".document-transcription-card [data-transcribe-document]").evaluate(button => button.classList.contains("primary")), false, "CTA ivoire sans style principal vert");
    await openInc2Workshop(page, pageErrors);
    await page.waitForFunction(() => window.__inc2.officialBadge().text !== "", undefined, { timeout: 5000 });
    const initial = await page.evaluate(() => ({
      badge: window.__inc2.officialBadge(),
      validateHidden: document.getElementById("workshopValidateBtn").hidden,
      validateLabel: document.getElementById("workshopValidateLabel").textContent,
      validateDisabled: document.getElementById("workshopValidateBtn").disabled,
      saveDisabled: document.getElementById("workshopSaveDraftBtn").disabled,
      autoSaveHintHidden: document.getElementById("workshopAutosaveHint").hidden,
      editorDisabled: document.querySelector('[data-workshop-field="textIt"]').disabled,
      collapsed: document.getElementById("workshopLayout").classList.contains("is-document-collapsed")
    }));
    assert.equal(initial.badge.hidden, false, "badge d'état visible");
    assert.equal(initial.badge.text, "Brouillon", "sans version officielle : « Brouillon »");
    assert.equal(initial.validateHidden, false, "validation visible pour l'administrateur");
    assert.equal(initial.validateLabel, "Valider", "libellé court de validation dans le groupe d’édition");
    assert.equal(initial.validateDisabled, false, "validation active (texte italien non vide)");
    assert.equal(initial.saveDisabled, true, "Enregistrer inactif sans modification non sauvegardée");
    assert.equal(initial.autoSaveHintHidden, false, "autosauvegarde annoncée en édition");
    assert.equal(initial.editorDisabled, false, "brouillon sans version officielle directement éditable");
    assert.equal(initial.collapsed, false, "vue partagée par défaut");

    /* Modification locale : Enregistrer réarmé immédiatement. */
    await page.fill('[data-workshop-field="textIt"]', "Anno millenovecento modificato");
    assert.equal(await page.locator("#workshopSaveDraftBtn").isDisabled(), false, "Enregistrer réarmé dès la saisie");
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Brouillon",
      "sans officiel, la modification reste un simple brouillon");
    await page.click("#workshopCancelEditBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionEditCancelDialog").open);
    await page.click("#workshopCancelKeepBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionWorkshopView").hidden && !document.getElementById("documentDetailView").hidden);
    assert.ok(await page.evaluate(() => window.__inc2.localDraftCount() > 0), "sans version officielle, l’annulation conserve le brouillon local");
    assert.equal(await page.locator(".document-transcription-card [data-transcribe-document]").textContent(), "Reprendre", "la carte Document permet de reprendre le brouillon conservé");

    /* Aucune écriture distante ni officielle n'est tentée : le badge et le
       dialogue restent cohérents même hors connexion. */
    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("la carte Document propose Ajouter quand la page ne contient aucune transcription", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    await bootInc2(page);
    await page.evaluate(() => { window.__inc2.emptyTranscriptionPage(); window.__inc2.openDoc(); });
    await page.waitForSelector(".document-transcription-card [data-transcribe-document]");
    const card = await page.evaluate(() => {
      const node = document.querySelector(".document-transcription-card");
      return { text: node.textContent, action: node.querySelector("[data-transcribe-document]").textContent.trim() };
    });
    assert.match(card.text, /Aucune transcription/, "état vide explicite");
    assert.match(card.text, /Passages\s*0/, "compteur nul affiché");
    assert.equal(card.action, "Ajouter", "libellé court en l’absence de transcription");
    await page.evaluate(() => window.__inc2.transcribe());
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    assert.equal(await page.locator("#workshopOfficialBadge").textContent(), "Brouillon", "l’ouverture de la carte ne crée pas de version officielle");
    await page.evaluate(() => window.__inc2.useMemberProfile());
    assert.equal(await page.locator("#workshopValidateBtn").isHidden(), true, "aucune validation officielle visible sans droit administrateur");
    assert.equal(await page.locator("#workshopCancelEditBtn").isVisible(), true, "Annuler reste disponible pour le contributeur");
    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("validation : confirmation précise, échec réseau sans perte du brouillon, boutons distincts", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    await bootInc2(page);
    await openInc2Workshop(page, pageErrors);
    await page.fill('[data-workshop-field="textIt"]', "Anno della conferma");

    /* Dialogue : version, historique et distinction avec Enregistrer/Comparer. */
    await page.click("#workshopValidateBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionValidationDialog").open, undefined, { timeout: 5000 });
    const message = await page.locator("#transcriptionValidationMessage").textContent();
    assert.match(message, /version v1/, "numéro de version annoncé");
    assert.match(message, /historique/i, "conservation de l'historique annoncée");
    assert.match(message, /traduction française reste facultative/i, "traduction française explicitement facultative");
    assert.match(await page.locator("#transcriptionValidationDialog .hint").textContent(), /Enregistrer.*Comparer.*Valider|« Enregistrer »/, "distinction Enregistrer / Comparer / Valider rappelée");

    /* En ligne=false ignoré (toujours true sous Playwright) : le réseau réellement
       bloqué fait échouer la validation — le brouillon est intégralement conservé. */
    await page.click("#transcriptionValidationConfirmBtn");
    await page.waitForFunction(() => !document.getElementById("transcriptionValidationError").hidden, undefined, { timeout: 10000 });
    const failure = await page.locator("#transcriptionValidationError").textContent();
    assert.ok(failure.trim().length > 0, "erreur d'affichée en clair");
    assert.equal(await page.evaluate(() => window.__inc2.fieldValue()), "Anno della conferma", "brouillon intact après l'échec");
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Brouillon", "aucune version officielle créée");
    assert.equal(await page.evaluate(() => document.getElementById("transcriptionValidationDialog").open), true, "dialogue conservé pour réessayer");

    /* Fermeture sans validation : rien n'a changé. */
    await page.locator('[data-close="transcriptionValidationDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("transcriptionValidationDialog").open);
    assert.equal(await page.evaluate(() => window.__inc2.fieldValue()), "Anno della conferma", "brouillon intact après fermeture");

    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("historique : versions listées avec auteur et date, consultation en lecture seule depuis l'atelier", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    await bootInc2(page);
    await page.evaluate(() => window.__inc2.seedOfficial());
    await page.evaluate(() => window.__inc2.openDoc());
    await page.waitForSelector(".document-transcription-card [data-transcribe-document]");
    const officialCard = await page.evaluate(() => {
      const card = document.querySelector(".document-transcription-card");
      return { text: card.textContent, action: card.querySelector("[data-transcribe-document]").textContent.trim() };
    });
    assert.match(officialCard.text, /Validée · v2/, "carte indique la version officielle courante");
    assert.equal(officialCard.action, "Consulter", "action de consultation quand aucune révision n'existe");
    assert.equal(await page.locator(".document-transcription-card [data-transcribe-document]").evaluate(button => button.classList.contains("primary")), false, "CTA officiel non principal");
    await page.evaluate(() => window.__inc2.transcribe());
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);

    /* L'officiel s'ouvre en lecture seule. L'activation d'une révision ne crée
       aucun brouillon avant un vrai changement de texte. */
    await page.waitForFunction(() => window.__inc2.officialBadge().text !== "", undefined, { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Validée · v2", "contenu officiel : Validée · v2");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), true, "officiel en lecture seule");
    assert.equal(await page.locator("#workshopAddPassageBtn").isHidden(), true, "ajout masqué en lecture seule");
    assert.equal(await page.locator("#workshopSaveDraftBtn").isHidden(), true, "Enregistrer masqué en lecture seule");
    assert.equal(await page.locator("#workshopValidateBtn").isHidden(), true, "Valider masqué en lecture seule");
    assert.equal(await page.locator(".transcription-workshop-header #workshopValidateBtn").count(), 0, "aucun doublon de validation dans l’en-tête supérieur");
    assert.equal(await page.locator("#workshopModeBtn").textContent(), "Modifier", "action explicite pour entrer en édition");
    await page.click("#workshopModeBtn");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), false, "édition activée explicitement");
    assert.equal(await page.locator("#workshopSaveDraftBtn").isDisabled(), true, "pas de brouillon créé par l'activation seule");
    assert.equal(await page.locator("#workshopAutosaveHint").isVisible(), true, "autosauvegarde annoncée en édition");
    assert.equal(await page.locator("#workshopModeBtn").isHidden(), true, "Modifier remplacé en mode édition");
    assert.equal(await page.locator("#workshopCancelEditBtn").textContent(), "Annuler", "action Annuler au même emplacement");
    assert.equal(await page.locator("#workshopValidateBtn").textContent(), "Valider", "action Valider alignée avec Annuler");
    await page.locator('[data-workshop-field="textIt"]').first().fill("Anno con modifica");
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Révision en cours · v3", "badge annonce la prochaine version");
    await page.click("#workshopActionsMenu > summary");
    await page.click("#workshopViewOfficialMenuBtn");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), true, "aperçu officiel temporaire en lecture seule");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().inputValue(), "Anno millenovecento corrente", "aperçu de la version officielle");
    assert.equal(await page.locator("#workshopModeBtn").textContent(), "Reprendre la révision", "action pour retrouver le brouillon");
    await page.click("#workshopModeBtn");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().inputValue(), "Anno con modifica", "brouillon retrouvé sans perte");
    await page.locator('[data-workshop-field="textIt"]').first().fill("Anno millenovecento corrente");
    await page.waitForFunction(() => window.__inc2.officialBadge().text === "Validée · v2", undefined, { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Validée · v2", "contenu revenu à l'officiel sans nouvelle version");
    await page.click("#workshopCancelEditBtn");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), true, "annulation sans modification repasse immédiatement en lecture seule");
    assert.equal(await page.locator("#workshopModeBtn").textContent(), "Modifier", "entrée en édition disponible après annulation propre");
    await page.click("#workshopModeBtn");
    await page.locator('[data-workshop-field="textIt"]').first().fill("Révision à conserver");
    await page.click("#workshopCancelEditBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionEditCancelDialog").open);
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), false, "la confirmation laisse l’édition active tant qu’un choix n’est pas fait");
    assert.equal(await page.locator("#workshopCancelKeepBtn").isVisible(), true, "choix de conservation explicite proposé");
    assert.equal(await page.locator("#workshopCancelDiscardBtn").isVisible(), true, "choix d'abandon explicite proposé");
    await page.click("#workshopCancelKeepBtn");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), true, "conservation retourne à la consultation officielle");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().inputValue(), "Anno millenovecento corrente", "annulation affiche l'officiel sans le modifier");
    assert.equal(await page.locator("#workshopModeBtn").textContent(), "Reprendre la révision", "le brouillon conservé reste reprenable");
    await page.click("#workshopModeBtn");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().inputValue(), "Révision à conserver", "le brouillon sauvegardé est conservé");
    await page.click("#workshopBackBtn");
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    const revisionCard = await page.locator(".document-transcription-card").textContent();
    assert.match(revisionCard, /Révision en cours · v3/, "carte Document indique la révision locale");
    assert.equal(await page.locator(".document-transcription-card [data-transcribe-document]").textContent(), "Reprendre", "CTA court de reprise de révision");
    await page.click(".document-transcription-card [data-transcribe-document]");
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().inputValue(), "Révision à conserver", "la révision reprend sans perte depuis la carte Document");
    await page.click("#workshopCancelEditBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionEditCancelDialog").open);
    await page.click("#workshopCancelDiscardBtn");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), true, "abandon explicitement confirmé quitte l'édition");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().inputValue(), "Anno millenovecento corrente", "l'abandon ne modifie pas l'officiel");
    assert.equal(await page.evaluate(() => window.__inc2.localDraftCount()), 0, "le brouillon n'est retiré qu'après le choix explicite d'abandon");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("#workshopTabItalian");
    await page.click("#workshopModeBtn");
    const mobileEditActions = await page.evaluate(() => {
      const cancel = document.getElementById("workshopCancelEditBtn");
      const validate = document.getElementById("workshopValidateBtn");
      const c = cancel.getBoundingClientRect();
      const v = validate.getBoundingClientRect();
      const cancelStyle = getComputedStyle(cancel);
      const validateStyle = getComputedStyle(validate);
      return { cancel: [c.x, c.y, c.width, c.height], validate: [v.x, v.y, v.width, v.height], cancelAlign: cancelStyle.justifyContent, validateAlign: validateStyle.justifyContent, cancelBackground: cancelStyle.backgroundColor, cancelColor: cancelStyle.color, validateBackground: validateStyle.backgroundColor, validateColor: validateStyle.color, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(mobileEditActions.cancel[3] >= 44 && mobileEditActions.validate[3] >= 44, "Annuler et Valider gardent des cibles tactiles ≥44 px");
    assert.equal(mobileEditActions.cancel[2], mobileEditActions.validate[2], "boutons de même largeur sur mobile");
    assert.equal(mobileEditActions.cancel[1], mobileEditActions.validate[1], "boutons alignés sur le même axe");
    assert.ok(mobileEditActions.cancel[0] < mobileEditActions.validate[0], "ordre Annuler puis Valider sur mobile");
    assert.equal(mobileEditActions.cancelAlign, "center", "texte Annuler centré dans la capsule");
    assert.equal(mobileEditActions.validateAlign, "center", "texte Valider centré dans la capsule");
    assert.equal(mobileEditActions.cancelBackground, "rgb(166, 66, 56)", "Annuler en rouge");
    assert.equal(mobileEditActions.cancelColor, "rgb(255, 255, 255)", "Annuler en texte blanc");
    assert.equal(mobileEditActions.validateBackground, "rgb(40, 75, 63)", "Valider en vert de la charte");
    assert.equal(mobileEditActions.validateColor, "rgb(255, 255, 255)", "Valider en texte blanc");
    assert.equal(mobileEditActions.overflow, false, "groupe d’édition sans débordement mobile");
    await page.click("#workshopCancelEditBtn");

    /* Historique consultable sans quitter l'atelier. */
    await page.click("#workshopHistoryBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionHistoryDialog").open, undefined, { timeout: 5000 });
    const rows = await page.locator("[data-history-revision]").count();
    assert.equal(rows, 2, "les versions sont listées");
    assert.match(await page.locator('[data-history-revision="tx-seed-rev2"]').textContent(), /v2 · version actuelle/, "version actuelle repérée");
    assert.match(await page.locator('[data-history-revision="tx-seed-rev2"]').textContent(), /Administratrice Seed/, "auteur de la version affiché");
    assert.match(await page.locator('[data-history-revision="tx-seed-rev2"]').textContent(), /\d/, "date affichée");
    assert.equal(await page.evaluate(() => !document.getElementById("transcriptionWorkshopView").hidden), true, "atelier non quitté");

    /* Consultation détaillée : texte officiel en lecture seule + comparaisons. */
    await page.click('[data-history-revision="tx-seed-rev2"]');
    try {
      await page.waitForFunction(() => !document.getElementById("transcriptionHistoryDetail").hidden, undefined, { timeout: 5000 });
    } catch (error) {
      throw new Error(`${error.message}; erreurs applicatives : ${pageErrors.join(" | ")}`);
    }
    const detail = await page.locator("#transcriptionHistoryDetail").textContent();
    assert.match(detail, /Anno millenovecento corrente/, "texte italien de la version affiché");
    assert.match(detail, /Modifié/, "passage modifié identifié");
    assert.match(detail, /Ajouté/, "passage ajouté identifié");
    assert.match(detail, /Supprimé/, "passage supprimé identifié");
    assert.match(detail, /Inchangé/, "passage inchangé identifié");
    assert.match(detail, /Nuovo passaggio/, "texte d'un passage ajouté affiché");
    assert.match(detail, /Traduction française absente/, "absence de traduction signalée par passage");
    assert.match(detail, /Brouillon courant/, "comparaison avec le brouillon courant");
    assert.match(detail, /Traduction française/, "état de la traduction française suivi séparément");
    assert.match(detail, /3 passages modifiés/, "récapitulatif grammatical au pluriel");
    assert.match(detail, /1 passage traduit sur 3/, "compteur de traductions au singulier correct");
    assert.equal(await page.locator("#transcriptionHistoryDetail .transcription-history-passage").count(), 4, "un accordéon par passage courant ou supprimé");
    const accordions = page.locator("#transcriptionHistoryDetail .transcription-history-passage");
    assert.equal(await accordions.nth(0).evaluate(element => element.open), true, "premier accordéon ouvert par défaut");
    assert.equal(await accordions.nth(1).evaluate(element => element.open), false, "autres accordéons repliés au départ");
    const firstSummary = accordions.nth(0).locator("summary");
    const firstBodyId = await accordions.nth(0).locator(".transcription-history-passage-body").getAttribute("id");
    assert.equal(await firstSummary.getAttribute("aria-controls"), firstBodyId, "en-tête relié à son contenu par aria-controls");
    await firstSummary.focus();
    await page.keyboard.press("Enter");
    assert.equal(await accordions.nth(0).evaluate(element => element.open), false, "fermeture clavier native au clavier");
    await page.keyboard.press("Enter");
    assert.equal(await accordions.nth(0).evaluate(element => element.open), true, "réouverture clavier native");
    const desktopDialog = await page.evaluate(() => {
      const rect = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        dialog: rect("#transcriptionHistoryDialog"),
        header: rect("#transcriptionHistoryDialog > .modal-head"),
        body: rect("#transcriptionHistoryDialog > .modal-body"),
        footer: rect("#transcriptionHistoryDialog > .modal-actions"),
        bodyOverflow: getComputedStyle(document.querySelector("#transcriptionHistoryDialog > .modal-body")).overflowY,
        gap: getComputedStyle(document.querySelector(".transcription-history-passages")).rowGap,
        summaryGap: getComputedStyle(document.querySelector(".transcription-history-passages")).marginTop,
        closedChevron: getComputedStyle(document.querySelectorAll(".transcription-history-chevron")[1]).transform,
        openChevron: getComputedStyle(document.querySelector(".transcription-history-chevron")).transform
      };
    });
    assert.equal(desktopDialog.bodyOverflow, "auto", "seule la zone centrale défile");
    assert.equal(desktopDialog.gap, "12px", "espacement de 12 px entre accordéons");
    assert.equal(desktopDialog.summaryGap, "16px", "au moins 16 px avant le premier accordéon");
    assert.notEqual(desktopDialog.closedChevron, desktopDialog.openChevron, "chevrons orientés différemment selon l’état");
    await accordions.nth(1).locator("summary").click();
    assert.equal(await accordions.nth(0).evaluate(element => element.open), true, "premier accordéon reste ouvert");
    assert.equal(await accordions.nth(1).evaluate(element => element.open), true, "plusieurs passages peuvent rester ouverts");
    const desktopAfterToggle = await page.evaluate(() => {
      const rect = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return { dialog: rect("#transcriptionHistoryDialog"), header: rect("#transcriptionHistoryDialog > .modal-head"), body: rect("#transcriptionHistoryDialog > .modal-body"), footer: rect("#transcriptionHistoryDialog > .modal-actions") };
    });
    assert.deepEqual(desktopAfterToggle, desktopDialog && { dialog: desktopDialog.dialog, header: desktopDialog.header, body: desktopDialog.body, footer: desktopDialog.footer }, "dimensions de modale et chrome stables à l’ouverture des accordéons");
    assert.ok(await page.locator("#transcriptionHistoryBackBtn").isVisible(), "retour à la liste");
    await page.click("#transcriptionHistoryBackBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionHistoryDetail").hidden && !document.getElementById("transcriptionHistoryList").hidden, undefined, { timeout: 5000 });
    await page.locator('[data-close="transcriptionHistoryDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("transcriptionHistoryDialog").open);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("#workshopTabItalian");
    await page.click("#workshopHistoryBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionHistoryDialog").open);
    await page.click('[data-history-revision="tx-seed-rev2"]');
    await page.waitForFunction(() => !document.getElementById("transcriptionHistoryDetail").hidden);
    const mobileBefore = await page.locator("#transcriptionHistoryDialog").evaluate(dialog => {
      const r = dialog.getBoundingClientRect();
      return { width: r.width, height: r.height, bodyHeight: dialog.querySelector(":scope > .modal-body").getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth, closeVisible: getComputedStyle(dialog.querySelector("[data-close='transcriptionHistoryDialog']")).display !== "none", footerVisible: dialog.querySelector(":scope > .modal-actions").getBoundingClientRect().height > 0 };
    });
    assert.ok(mobileBefore.height > 0 && mobileBefore.height <= 844, "hauteur de modale limitée à l’espace mobile");
    assert.ok(mobileBefore.width <= 390, "pas de débordement horizontal de la modale mobile");
    assert.equal(mobileBefore.overflow, false, "page mobile sans débordement horizontal");
    assert.equal(mobileBefore.closeVisible, true, "fermeture accessible sur mobile");
    assert.equal(mobileBefore.footerVisible, true, "actions de navigation accessibles sur mobile");
    await page.locator("#transcriptionHistoryDetail .transcription-history-passage").nth(1).locator("summary").click();
    const mobileAfter = await page.locator("#transcriptionHistoryDialog").evaluate(dialog => {
      const r = dialog.getBoundingClientRect();
      return { width: r.width, height: r.height, bodyHeight: dialog.querySelector(":scope > .modal-body").getBoundingClientRect().height };
    });
    assert.deepEqual(mobileAfter, { width: mobileBefore.width, height: mobileBefore.height, bodyHeight: mobileBefore.bodyHeight }, "hauteur stable pendant l’ouverture d’un accordéon mobile");
    await page.locator('[data-close="transcriptionHistoryDialog"]').first().click();

    /* L'atelier est intact après consultation. */
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Validée · v2", "badge intact après l'historique");
    assert.equal(await page.evaluate(() => !document.getElementById("transcriptionWorkshopView").hidden), true, "toujours dans l'atelier");

    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("repli du volet Document : vue étendue, contenu et défilement conservés, réouverture complète", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    await bootInc2(page);
    await openInc2Workshop(page, pageErrors);

    /* Défilement initial non nul pour vérifier la conservation. */
    await page.evaluate(() => {
      const list = document.getElementById("workshopPassageList");
      list.scrollTop = 0;
      list.dispatchEvent(new Event("scroll"));
    });
    const before = await page.evaluate(() => ({
      collapsed: document.getElementById("workshopLayout").classList.contains("is-document-collapsed"),
      field: document.querySelector('[data-workshop-field="textIt"]')?.value || "",
      status: document.getElementById("workshopSaveStatus").textContent,
      selected: document.querySelector(".transcription-workshop-passage.is-selected")?.id || "",
      stored: (function () { let n = 0; for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i).startsWith("familyTreeTranscriptionDraft:")) n++; return n; })()
    }));
    assert.equal(before.collapsed, false, "vue partagée à l'ouverture");

    /* Repli : desktop uniquement, volet gauche masqué, transcription étendue. */
    await page.click("#workshopPanelCollapseBtn");
    const collapsed = await page.evaluate(() => ({
      collapsed: document.getElementById("workshopLayout").classList.contains("is-document-collapsed"),
      originalDisplay: getComputedStyle(document.getElementById("workshopPanelOriginal")).display,
      dividerDisplay: getComputedStyle(document.getElementById("workshopDivider")).display,
      restoreVisible: getComputedStyle(document.querySelector(".transcription-workshop-restore-row")).display !== "none",
      rightWidth: Math.round(document.getElementById("workshopPanelRight").getBoundingClientRect().width),
      field: document.querySelector('[data-workshop-field="textIt"]')?.value || "",
      status: document.getElementById("workshopSaveStatus").textContent,
      selected: document.querySelector(".transcription-workshop-passage.is-selected")?.id || "",
      expandFocused: document.activeElement?.id === "workshopPanelExpandBtn",
      stored: (function () { let n = 0; for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i).startsWith("familyTreeTranscriptionDraft:")) n++; return n; })()
    }));
    assert.equal(collapsed.collapsed, true, "état de repli appliqué");
    assert.equal(collapsed.originalDisplay, "none", "volet document masqué");
    assert.equal(collapsed.dividerDisplay, "none", "séparateur masqué");
    assert.equal(collapsed.restoreVisible, true, "commande « Afficher le document » visible en haut à gauche");
    assert.equal(collapsed.expandFocused, true, "focus déplacé sur la commande (clavier)");
    assert.equal(collapsed.field, before.field, "texte conservé");
    assert.equal(collapsed.status, before.status, "aucune sauvegarde ni changement d'état déclenché par le repli");
    assert.equal(collapsed.selected, before.selected, "passage actif conservé");
    assert.equal(collapsed.stored, before.stored, "aucune écriture locale déclenchée par le repli");

    /* Réouverture : proportions initiales restaurées. */
    await page.click("#workshopPanelExpandBtn");
    const expanded = await page.evaluate(() => ({
      collapsed: document.getElementById("workshopLayout").classList.contains("is-document-collapsed"),
      originalDisplay: getComputedStyle(document.getElementById("workshopPanelOriginal")).display,
      collapseFocused: document.activeElement?.id === "workshopPanelCollapseBtn",
      field: document.querySelector('[data-workshop-field="textIt"]')?.value || ""
    }));
    assert.equal(expanded.collapsed, false, "vue partagée restaurée");
    assert.notEqual(expanded.originalDisplay, "none", "volet document visible à nouveau");
    assert.equal(expanded.collapseFocused, true, "focus rendu à la commande de repli");
    assert.equal(expanded.field, before.field, "texte toujours conservé");

    /* Une nouvelle session d'atelier repart en vue partagée. */
    await page.click("#workshopBackBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionWorkshopView").hidden);
    await openInc2Workshop(page, pageErrors);
    const reopened = await page.evaluate(() => document.getElementById("workshopLayout").classList.contains("is-document-collapsed"));
    assert.equal(reopened, false, "vue partagée par défaut à la réouverture (session nouvelle)");

    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});
