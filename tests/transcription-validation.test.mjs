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
  /* Le callback d'authentification du harnais peut réinitialiser le profil après
     le seed : ce rappel rétablit explicitement l'administrateur simulé. */
  useAdminProfile() { currentUserProfile = { role: "admin", status: "approved" }; updateWorkshopDraftIndicators(); },
  transcribe() { const button = document.querySelector("#viewerDocumentDetails [data-transcribe-document]"); if (button) button.click(); },
  badge() { return $("workshopSaveStatus").textContent; },
  officialBadge() { const el = $("workshopOfficialBadge"); return { hidden: el.hidden, text: el.textContent }; },
  fieldValue() { return document.querySelector('[data-workshop-field="textIt"]')?.value || ""; },
  localDraftCount() { return [...Array(localStorage.length).keys()].filter(index => localStorage.key(index)?.startsWith("familyTreeTranscriptionDraft:")).length; },
  versionState() {
    const head = genealogyRecords.transcriptionHeads[0];
    return { version: head?.version ?? null, revisions: genealogyRecords.transcriptionRevisions.length };
  },
  validationTarget() { return transcriptionValidationTarget ? { ...transcriptionValidationTarget } : null; },
  validationDuplicateRejections() { return transcriptionValidationDuplicateRejections; },
  openValidation() { openTranscriptionValidationDialog(); },
  confirmValidationNoChanges() {
    const dialog = document.getElementById("transcriptionValidationDialog");
    if (!dialog.open) dialog.showModal();
    transcriptionValidationTarget = { headId: "tx-seed-head", documentId: "doc-repro", pageId: "page-repro-1", nextVersion: 3 };
    return confirmTranscriptionValidation();
  },
  confirmValidationRapidly() {
    if (!transcriptionValidationTarget) {
      transcriptionValidationTarget = { headId: "tx-seed-head", documentId: "doc-repro", pageId: "page-repro-1", nextVersion: 3 };
    }
    const first = confirmTranscriptionValidation();
    const second = confirmTranscriptionValidation();
    return Promise.all([first, second]);
  },
  applyValidationForTest() {
    const head = genealogyRecords.transcriptionHeads[0];
    applyTranscriptionValidation({
      headId: head.id,
      content: { documentId: "doc-repro", pageId: "page-repro-1", passages: transcriptionWorkshopDraft.passages },
      revisionId: "test-revision-validation",
      eventId: "test-event-validation",
      freshHead: head,
      authorUid: "admin-seed"
    });
    const updated = genealogyRecords.transcriptionHeads[0];
    return { version: updated.version, revisions: genealogyRecords.transcriptionRevisions.length };
  }
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

async function openInc2Harness(t, viewport = { width: 1280, height: 900 }) {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return null; }
  const server = await startStaticServer(ROOT);
  const hooks = `${HOOKS}\n${AUTH_PATCH}`;
  const context = await browser.newContext({ viewport, locale: "fr-FR" });
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

/* Le menu « … » est le seul accès aux actions secondaires : il doit être
   ouvert avant d'activer l'une de ses entrées. */
async function clickWorkshopMenuAction(page, buttonSelector) {
  const menu = page.locator("#workshopActionsMenu");
  if (!(await menu.evaluate(element => element.open))) await page.click("#workshopActionsMenu > summary");
  await page.click(buttonSelector);
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
    await page.evaluate(() => window.__inc2.useAdminProfile());
    const initial = await page.evaluate(() => ({
      badge: window.__inc2.officialBadge(),
      validateHidden: document.getElementById("workshopValidateBtn").hidden,
      validateLabel: document.getElementById("workshopValidateLabel").textContent,
      validateDisabled: document.getElementById("workshopValidateBtn").disabled,
      validateTitle: document.getElementById("workshopValidateBtn").title,
      saveButtonCount: document.querySelectorAll("#workshopSaveDraftBtn").length,
      autoSaveHintHidden: document.getElementById("workshopAutosaveHint").hidden,
      editorDisabled: document.querySelector('[data-workshop-field="textIt"]').disabled,
      collapsed: document.getElementById("workshopLayout").classList.contains("is-document-collapsed")
    }));
    assert.equal(initial.badge.hidden, false, "badge d'état visible");
    assert.equal(initial.badge.text, "Brouillon", "sans version officielle : « Brouillon »");
    assert.equal(initial.validateHidden, false, "validation visible pour l'administrateur");
    assert.equal(initial.validateLabel, "Valider", "libellé court de validation dans le groupe d’édition");
    assert.equal(initial.validateDisabled, true, "validation désarmée tant qu'aucune différence réelle n'existe");
    assert.equal(initial.validateTitle, "Aucune modification", "cause du désarmement expliquée discrètement");
    assert.equal(initial.saveButtonCount, 0, "aucun bouton manuel « Enregistrer »");
    assert.equal(initial.autoSaveHintHidden, false, "autosauvegarde annoncée en édition");
    assert.equal(initial.editorDisabled, false, "brouillon sans version officielle directement éditable");
    assert.equal(initial.collapsed, false, "vue partagée par défaut");

    /* Modification locale : l'autosauvegarde reprend seule, sans commande. */
    await page.fill('[data-workshop-field="textIt"]', "Anno millenovecento modificato");
    assert.equal(await page.locator("#workshopSaveStatus").textContent(), "Enregistrement…", "modification en attente d’autosauvegarde");
    assert.equal(await page.evaluate(() => document.getElementById("workshopValidateBtn").disabled), false, "validation réarmée dès le premier changement réel");
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
    assert.equal(await page.locator(".transcription-workshop-mode").isVisible(), true, "sans version officielle, l’ouverture reste en édition avec le contrôle segmenté");
    await page.evaluate(() => window.__inc2.useMemberProfile());
    assert.equal(await page.locator("#workshopValidateBtn").isHidden(), true, "aucune validation officielle visible sans droit administrateur");
    assert.equal(await page.locator("#workshopCancelEditBtn").isVisible(), true, "Annuler reste disponible pour le contributeur");
    let desktopStripWidthAtOne = 0;
    const stripWidthFor = (count, slots) => Math.min(count, slots) * 44 + (Math.min(count, slots) - 1) * 4;
    for (let index = 0; index < 5; index++) {
      await page.click("#workshopAddPassageBtn");
      const count = index + 1;
      const stripWidth = await page.locator("#workshopPassagePills").evaluate(strip => strip.getBoundingClientRect().width);
      if (index === 0) desktopStripWidthAtOne = stripWidth;
      assert.ok(Math.abs(stripWidth - stripWidthFor(count, 5)) <= 1, `largeur desktop = contenu réel à ${count} passage(s) (${Math.round(stripWidth)} ≈ ${stripWidthFor(count, 5)})`);
      if (count === 1) assert.ok(desktopStripWidthAtOne <= 50, "un seul numéro : bande compacte, aucune case vide avant le +");
      if (count <= 5) {
        assert.equal(await page.locator("#workshopPassagePills [data-workshop-passage-select]").count(), count, `${count} numéro(s) présents sans emplacement fictif`);
        assert.equal(await page.locator("#workshopPassagePills [data-workshop-passage-select]").evaluateAll(buttons => {
          const strip = buttons[0].parentElement.getBoundingClientRect();
          return buttons.filter(button => { const rect = button.getBoundingClientRect(); return rect.left >= strip.left - 1 && rect.right <= strip.right + 1; }).length;
        }), count, `${count} numéro(s) réellement visibles dans les emplacements desktop`);
      }
      const plusGap = await page.evaluate(() => {
        const strip = document.getElementById("workshopPassagePills").getBoundingClientRect();
        const pills = document.querySelectorAll("#workshopPassagePills [data-workshop-passage-select]");
        const last = pills[pills.length - 1].getBoundingClientRect();
        return {
          strip: document.getElementById("workshopAddPassageBtn").getBoundingClientRect().left - strip.right,
          lastPill: document.getElementById("workshopAddPassageBtn").getBoundingClientRect().left - last.right
        };
      });
      assert.ok(plusGap.strip >= 0 && plusGap.strip <= 6, `+ immédiatement à droite du carrousel à ${count} passage(s) (${plusGap.strip}px)`);
      assert.ok(plusGap.lastPill >= 0 && plusGap.lastPill <= 6, `+ collé au dernier numéro à ${count} passage(s) (${plusGap.lastPill}px)`);
    }
    assert.equal(await page.locator("#workshopPassagePills [data-workshop-passage-select]").count(), 5, "cinq passages disponibles");
    const desktopStripWidthAtFive = await page.locator("#workshopPassagePills").evaluate(strip => strip.getBoundingClientRect().width);
    assert.equal(await page.locator("#workshopPassagePills [data-workshop-passage-select]").evaluateAll(buttons => buttons.filter(button => {
      const strip = button.parentElement.getBoundingClientRect();
      const pill = button.getBoundingClientRect();
      return pill.left >= strip.left - 1 && pill.right <= strip.right + 1;
    }).length), 5, "cinq emplacements visibles sur desktop");
    for (let index = 5; index < 20; index++) await page.click("#workshopAddPassageBtn");
    const passagePills = page.locator("#workshopPassagePills [data-workshop-passage-select]");
    assert.equal(await passagePills.count(), 20, "tous les numéros restent présents dans la navigation");
    assert.equal(await passagePills.first().textContent(), "1", "première pastille repère le début de la liste");
    assert.equal(await passagePills.last().textContent(), "20", "dernière pastille reste accessible");
    assert.equal(await page.locator("#workshopPassagePills .transcription-workshop-passage-ellipsis").count(), 0, "aucun numéro n'est remplacé par une ellipse");
    assert.equal(await page.locator("#workshopPassagePills [aria-current='step']").textContent(), "20", "passage actif repéré après les ajouts");
    assert.equal(await page.locator("[data-workshop-delete-passage]").count(), 20, "suppression contextuelle visible pour les passages créés");
    assert.equal(await page.locator("#workshopPassagePills").evaluate(strip => strip.getBoundingClientRect().width), desktopStripWidthAtFive, "largeur carrousel desktop identique avec cinq ou vingt passages");
    const desktopCarouselPlusGap = await page.evaluate(() => {
      const strip = document.getElementById("workshopPassagePills").getBoundingClientRect();
      return document.getElementById("workshopAddPassageBtn").getBoundingClientRect().left - strip.right;
    });
    assert.ok(desktopCarouselPlusGap >= 0 && desktopCarouselPlusGap <= 6, `+ toujours accolé à la bande desktop (${desktopCarouselPlusGap}px)`);
    const activePillVisible = await page.locator("#workshopPassagePills [aria-current='step']").evaluate(button => {
      const viewport = button.parentElement.getBoundingClientRect();
      const pill = button.getBoundingClientRect();
      return pill.left >= viewport.left - 1 && pill.right <= viewport.right + 1;
    });
    assert.equal(activePillVisible, true, "le passage actif à la fin reste dans les cinq positions desktop");
    const strip = page.locator("#workshopPassagePills");
    const beforeWheel = await strip.evaluate(element => element.scrollLeft);
    await strip.hover();
    await page.mouse.wheel(0, -80);
    await page.waitForTimeout(220);
    const afterWheel = await strip.evaluate(element => element.scrollLeft);
    assert.notEqual(afterWheel, beforeWheel, "molette verticale redirigée vers le carrousel horizontal desktop");
    assert.equal(await strip.evaluate(element => element.scrollLeft % 48), 0, "molette : le carrousel se recale sur la grille des pastilles");
    const visibleAfterWheel = await page.locator("#workshopPassagePills [data-workshop-passage-select]").evaluateAll(buttons => {
      const strip = buttons[0].parentElement.getBoundingClientRect();
      return buttons.filter(button => { const r = button.getBoundingClientRect(); return r.left >= strip.left - 1 && r.right <= strip.right + 1; }).length;
    });
    assert.equal(visibleAfterWheel, 5, "après aimantation : exactement cinq numéros entiers visibles, aucun coupé");
    const stripBox = await strip.boundingBox();
    await page.mouse.move(stripBox.x + stripBox.width - 12, stripBox.y + stripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(stripBox.x + stripBox.width - 82, stripBox.y + stripBox.height / 2, { steps: 5 });
    await page.mouse.up();
    const afterMouseDrag = await strip.evaluate(element => element.scrollLeft);
    assert.notEqual(afterMouseDrag, afterWheel, "glissement souris déplace les numéros desktop");
    assert.equal(await strip.evaluate(element => element.scrollLeft % 48), 0, "glissement souris : aimantation sur la grille au relâchement");
    assert.equal(await page.locator("#workshopPassagePills [aria-current='step']").textContent(), "20", "défilement manuel ne change pas la sélection");
    assert.match(await page.locator(".transcription-workshop-passage.is-selected .workshop-field-it label").textContent(), /Transcription italienne — Passage 20/, "titre de transcription italienne indexé sur desktop");
    assert.match(await page.locator(".transcription-workshop-passage.is-selected .workshop-field-fr label").textContent(), /Traduction française — Passage 20/, "titre de traduction française indexé sur desktop");
    await passagePills.nth(10).click();
    assert.match(await page.locator(".transcription-workshop-passage.is-selected .workshop-field-it label").textContent(), /Passage 11/, "les titres suivent immédiatement la sélection");
    const centeredDesktopPill = await passagePills.nth(10).evaluate(button => {
      const strip = button.parentElement.getBoundingClientRect();
      const pill = button.getBoundingClientRect();
      return Math.abs((pill.left + pill.width / 2) - (strip.left + strip.width / 2)) <= 1;
    });
    assert.equal(centeredDesktopPill, true, "passage actif centré sur desktop quand les marges le permettent");
    await passagePills.first().click();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobilePillState = await page.evaluate(() => {
      const strip = document.getElementById("workshopPassagePills");
      const active = strip.querySelector("[aria-current='step']").getBoundingClientRect();
      const viewport = strip.getBoundingClientRect();
      const add = document.getElementById("workshopAddPassageBtn").getBoundingClientRect();
      const nav = document.getElementById("workshopPassageNav").getBoundingClientRect();
      const headEnd = document.querySelector(".transcription-workshop-head-end").getBoundingClientRect();
      const overlap = nav.left < headEnd.right && nav.right > headEnd.left && nav.top < headEnd.bottom && nav.bottom > headEnd.top;
      return { scrollable: strip.scrollWidth > strip.clientWidth, activeVisible: active.left >= viewport.left - 1 && active.right <= viewport.right + 1,
        visibleSlots: [...strip.querySelectorAll("[data-workshop-passage-select]")].filter(button => { const r = button.getBoundingClientRect(); return r.left >= viewport.left - 1 && r.right <= viewport.right + 1; }).length,
        stripWidth: strip.getBoundingClientRect().width, addGap: add.left - viewport.right,
        noOverlap: !overlap,
        desktopLabelVisible: getComputedStyle(document.querySelector(".workshop-field-it .transcription-workshop-desktop-passage-number")).display !== "none" };
    });
    assert.equal(mobilePillState.scrollable, true, "navigation de vingt passages défilante horizontalement sur mobile");
    assert.equal(mobilePillState.visibleSlots, 3, "exactement trois emplacements de numéros visibles sur mobile");
    assert.equal(mobilePillState.activeVisible, true, "sélection active visible après centrage mobile");
    assert.ok(mobilePillState.addGap >= 0 && mobilePillState.addGap <= 6, `bouton + immédiatement à droite du carrousel (${mobilePillState.addGap}px)`);
    assert.ok(mobilePillState.stripWidth < 200, "carrousel mobile conserve sa largeur fixe compacte");
    assert.equal(mobilePillState.noOverlap, true, "menu et statut restent dans un groupe distinct du carrousel");
    assert.equal(mobilePillState.desktopLabelVisible, false, "titres de passage desktop masqués sur mobile");
    await passagePills.nth(10).click();
    const centeredMobilePill = await passagePills.nth(10).evaluate(button => {
      const strip = button.parentElement.getBoundingClientRect();
      const pill = button.getBoundingClientRect();
      return Math.abs((pill.left + pill.width / 2) - (strip.left + strip.width / 2)) <= 1;
    });
    const mobileVisibleCount = await page.locator("#workshopPassagePills [data-workshop-passage-select]").evaluateAll(buttons => {
      const strip = buttons[0].parentElement.getBoundingClientRect();
      return buttons.filter(button => { const pill = button.getBoundingClientRect(); return pill.left >= strip.left - 1 && pill.right <= strip.right + 1; }).length;
    });
    assert.equal(centeredMobilePill, true, "passage actif centré sur mobile quand les marges le permettent");
    assert.equal(mobileVisibleCount, 3, "trois numéros visibles autour du passage actif au milieu du carrousel");
    /* Limites strictes vérifiées à chaque largeur mobile demandée. */
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const state = await page.evaluate(() => {
        const strip = document.getElementById("workshopPassagePills");
        const viewport = strip.getBoundingClientRect();
        const pills = [...strip.querySelectorAll("[data-workshop-passage-select]")];
        const add = document.getElementById("workshopAddPassageBtn").getBoundingClientRect();
        const active = strip.querySelector("[aria-current='step']").getBoundingClientRect();
        return {
          visible: pills.filter(pill => { const r = pill.getBoundingClientRect(); return r.left >= viewport.left - 1 && r.right <= viewport.right + 1; }).length,
          partiallyVisible: pills.filter(pill => {
            const r = pill.getBoundingClientRect();
            const inside = r.right > viewport.left + 1 && r.left < viewport.right - 1;
            const fully = r.left >= viewport.left - 1 && r.right <= viewport.right + 1;
            return inside && !fully;
          }).length,
          stripToPlus: add.left - viewport.right,
          activeFullyVisible: active.left >= viewport.left - 1 && active.right <= viewport.right + 1,
          pageOverflow: document.documentElement.scrollWidth > innerWidth + 1
        };
      });
      assert.equal(state.visible, 3, `${width}px : exactement trois numéros entiers visibles`);
      assert.equal(state.partiallyVisible, 0, `${width}px : aucun numéro partiellement visible`);
      assert.ok(state.stripToPlus >= 0 && state.stripToPlus <= 6, `${width}px : bouton + accolé à la bande (${state.stripToPlus}px)`);
      assert.equal(state.activeFullyVisible, true, `${width}px : passage actif visible`);
      assert.equal(state.pageOverflow, false, `${width}px : aucun débordement horizontal de la page`);
    }
    await passagePills.first().click();
    assert.equal(await page.locator("#workshopPassagePills [aria-current='step']").textContent(), "1", "clic sur une pastille sélectionne le premier passage");
    const passageIds = await passagePills.evaluateAll(buttons => buttons.map(button => button.dataset.workshopPassageSelect));

    /* Suppression sur mobile : le bouton inline est masqué, l'action vit dans
       le menu contextuel ⋯ du passage actif. */
    assert.equal(await page.locator("[data-workshop-delete-passage]").first().isVisible(), false, "bouton inline masqué sur mobile");
    const selectedMenuSummary = page.locator(".transcription-workshop-passage.is-selected .transcription-workshop-passage-menu > summary");
    assert.equal(await selectedMenuSummary.isVisible(), true, "menu ⋯ visible sur le passage actif en édition");
    const openSelectedMenu = async () => {
      const summary = page.locator(".transcription-workshop-passage.is-selected .transcription-workshop-passage-menu > summary");
      if (!(await summary.evaluate(element => element.parentElement.open))) await summary.click();
      await page.locator(".transcription-workshop-passage.is-selected [data-workshop-delete-passage-menu]").waitFor({ state: "visible" });
    };
    /* Confirmation annulée : rien n'est supprimé. */
    await openSelectedMenu();
    page.removeAllListeners("dialog");
    page.on("dialog", dialog => dialog.dismiss().catch(() => {}));
    await page.locator(".transcription-workshop-passage.is-selected [data-workshop-delete-passage-menu]").click();
    assert.deepEqual(await passagePills.evaluateAll(buttons => buttons.map(button => button.dataset.workshopPassageSelect)), passageIds, "annulation de la confirmation : aucun passage supprimé");
    /* Confirmation acceptée : le passage sort du brouillon. */
    page.removeAllListeners("dialog");
    page.on("dialog", dialog => dialog.accept().catch(() => {}));
    await openSelectedMenu();
    await page.locator(".transcription-workshop-passage.is-selected [data-workshop-delete-passage-menu]").click();
    await page.waitForFunction(expected => document.querySelectorAll("#workshopPassagePills [data-workshop-passage-select]").length === expected, passageIds.length - 1);
    const remainingIds = await page.locator("#workshopPassagePills [data-workshop-passage-select]").evaluateAll(buttons => buttons.map(button => button.dataset.workshopPassageSelect));
    assert.deepEqual(remainingIds, passageIds.slice(1), "suppression du brouillon uniquement : les dix-neuf autres passages sont conservés");
    assert.equal(await page.locator("#workshopPassagePills [aria-current='step']").textContent(), "1", "après suppression, le passage restant suivant devient actif");
    assert.equal(await page.locator("[data-workshop-delete-passage]").count(), 19, "la commande de suppression demeure pour chaque passage créé restant");

    /* Descente jusqu'à un seul passage : la bande rétrécit au contenu et le +
       reste collé au dernier numéro visible à chaque étape. */
    let expectedCount = passageIds.length - 1;
    while (expectedCount > 1) {
      await openSelectedMenu();
      await page.locator(".transcription-workshop-passage.is-selected [data-workshop-delete-passage-menu]").click();
      expectedCount -= 1;
      await page.waitForFunction(count => document.querySelectorAll("#workshopPassagePills [data-workshop-passage-select]").length === count, expectedCount);
      const state = await page.evaluate(() => {
        const strip = document.getElementById("workshopPassagePills");
        const pills = strip.querySelectorAll("[data-workshop-passage-select]");
        const viewport = strip.getBoundingClientRect();
        const last = pills[pills.length - 1].getBoundingClientRect();
        const add = document.getElementById("workshopAddPassageBtn").getBoundingClientRect();
        return {
          count: pills.length,
          stripWidth: viewport.width,
          visible: [...pills].filter(pill => { const r = pill.getBoundingClientRect(); return r.left >= viewport.left - 1 && r.right <= viewport.right + 1; }).length,
          stripToPlus: add.left - viewport.right,
          lastToPlus: add.left - last.right
        };
      });
      assert.equal(state.count, expectedCount, `${expectedCount} passage(s) restants dans le carrousel`);
      assert.ok(state.stripToPlus >= 0 && state.stripToPlus <= 6, `+ collé à la bande après suppression (${state.stripToPlus}px)`);
      if (expectedCount <= 3) {
        assert.ok(Math.abs(state.stripWidth - stripWidthFor(expectedCount, 3)) <= 1, `largeur mobile = contenu réel à ${expectedCount} passage(s) (${Math.round(state.stripWidth)} ≈ ${stripWidthFor(expectedCount, 3)})`);
        assert.equal(state.visible, expectedCount, `${expectedCount} numéro(s) entiers visibles, aucun partiel`);
        assert.ok(state.lastToPlus >= 0 && state.lastToPlus <= 6, `+ collé au dernier numéro à ${expectedCount} passage(s) (${state.lastToPlus}px)`);
      }
    }
    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("suppression d'un passage hérité : révision locale, officiel et abandon préservés", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    await bootInc2(page);
    await page.evaluate(() => window.__inc2.seedOfficial());
    await page.evaluate(() => window.__inc2.openDoc());
    await page.waitForSelector(".document-transcription-card [data-transcribe-document]");
    await page.evaluate(() => window.__inc2.transcribe());
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    await page.click("#workshopModeBtn");
    assert.equal(await page.locator("#workshopPassagePills [data-workshop-passage-select]").count(), 3, "trois passages hérités à l'ouverture de la révision");
    assert.equal(await page.locator("[data-workshop-delete-passage]").count(), 3, "chaque passage hérité offre la suppression dans le brouillon éditable");
    const firstPassageId = await page.locator("#workshopPassagePills [data-workshop-passage-select]").first().getAttribute("data-workshop-passage-select");
    await page.locator(`[data-workshop-delete-passage="${firstPassageId}"]`).click();
    await page.waitForFunction(() => document.querySelectorAll("#workshopPassagePills [data-workshop-passage-select]").length === 2);
    assert.equal(await page.locator("#workshopPassagePills [aria-current='step']").textContent(), "1", "le passage voisin suivant devient actif");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').count(), 2, "seuls les deux passages restants sont dans la révision");
    await page.click('[data-workshop-mode="diff"]');
    assert.match(await page.locator("#workshopCompareContent").textContent(), /Supprimé du brouillon/, "la comparaison identifie le passage hérité retiré de la révision");

    /* La version officielle reste consultable inchangée tant que la révision
       n'est pas validée : le passage supprimé y demeure avec son texte. */
    await page.click('[data-workshop-mode="official"]');
    assert.equal(await page.locator(".transcription-workshop-passage").count(), 3, "la version officielle conserve ses trois passages");
    assert.equal(await page.locator('[data-workshop-passage="p-1"] [data-workshop-field="textIt"]').inputValue(), "Anno millenovecento corrente", "contenu officiel du passage préservé");

    /* Abandonner la révision restaure la copie de travail complète. */
    await page.click('[data-workshop-mode="draft"]');
    await page.click("#workshopCancelEditBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionEditCancelDialog").open);
    await page.click("#workshopCancelDiscardBtn");
    await page.waitForFunction(() => document.querySelectorAll("#workshopPassagePills [data-workshop-passage-select]").length === 3);
    assert.equal(await page.locator('[data-workshop-field="textIt"][data-workshop-passage="p-1"]').inputValue(), "Anno millenovecento corrente", "abandon restaure le passage dans le brouillon");
    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("versionnement : +0 sans changement réel, +1 par validation d'un ensemble", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    await bootInc2(page);
    await page.evaluate(() => window.__inc2.seedOfficial());
    await page.evaluate(() => window.__inc2.openDoc());
    await page.waitForSelector(".document-transcription-card [data-transcribe-document]");
    await page.evaluate(() => window.__inc2.transcribe());
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    await page.evaluate(() => window.__inc2.useAdminProfile());
    await page.click("#workshopModeBtn");

    /* Ouvrir la révision sans rien changer : v2, Valider désarmé. */
    const opened = await page.evaluate(() => ({
      version: window.__inc2.versionState(),
      disabled: document.getElementById("workshopValidateBtn").disabled,
      title: document.getElementById("workshopValidateBtn").title
    }));
    assert.deepEqual(opened.version, { version: 2, revisions: 2 }, "v2 et ses deux révisions inchangées à l'ouverture");
    assert.equal(opened.disabled, true, "Valider désarmé sans modification réelle");
    assert.equal(opened.title, "Aucune modification", "cause du désarmement affichée discrètement");

    /* Ouverture programmatique refusée : aucune cible, dialogue fermé. */
    const openAttempt = await page.evaluate(() => {
      window.__inc2.openValidation();
      return { open: document.getElementById("transcriptionValidationDialog").open, target: window.__inc2.validationTarget() };
    });
    assert.equal(openAttempt.open, false, "dialogue de validation fermé sans changement");
    assert.equal(openAttempt.target, null, "aucune cible de validation sans changement");

    /* Confirmation déclenchée hors de l'interface : même garde, +0 version. */
    await page.evaluate(() => window.__inc2.confirmValidationNoChanges());
    await page.waitForFunction(() => !document.getElementById("transcriptionValidationError").hidden);
    assert.match(await page.locator("#transcriptionValidationError").textContent(), /Aucune modification/, "confirmation hors interface bloquée sans changement");
    assert.deepEqual(await page.evaluate(() => window.__inc2.versionState()), { version: 2, revisions: 2 }, "+0 version après confirmation sans changement");
    await page.locator('[data-close="transcriptionValidationDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("transcriptionValidationDialog").open);

    /* Modifier puis remettre exactement le texte initial : +0 version. */
    await page.locator('[data-workshop-field="textIt"]').first().fill("Anno con modifica temporanea");
    assert.equal(await page.evaluate(() => document.getElementById("workshopValidateBtn").disabled), false, "validation réarmée dès le changement réel");
    await page.locator('[data-workshop-field="textIt"]').first().fill("Anno millenovecento corrente");
    assert.equal(await page.evaluate(() => document.getElementById("workshopValidateBtn").disabled), true, "texte initial restauré : validation désarmée à nouveau");

    /* Ajouter puis supprimer un passage avant validation : +0 version. */
    await page.click("#workshopAddPassageBtn");
    assert.equal(await page.evaluate(() => document.getElementById("workshopValidateBtn").disabled), false, "ajout de passage = différence réelle");
    const countBeforeRemove = await page.locator("#workshopPassagePills [data-workshop-passage-select]").count();
    const addedId = await page.locator("#workshopPassagePills [data-workshop-passage-select]").last().getAttribute("data-workshop-passage-select");
    await page.locator(`[data-workshop-delete-passage="${addedId}"]`).click();
    await page.waitForFunction(expected => document.querySelectorAll("#workshopPassagePills [data-workshop-passage-select]").length === expected, countBeforeRemove - 1);
    assert.equal(await page.evaluate(() => document.getElementById("workshopValidateBtn").disabled), true, "passage ajouté puis supprimé : validation désarmée");
    assert.deepEqual(await page.evaluate(() => window.__inc2.versionState()), { version: 2, revisions: 2 }, "+0 version après aller-retour d'ajout");

    /* Ensemble de changements + double confirmation rapide : la seconde est
       rejetée par la garde mono-instance (l'écriture échoue sur le réseau
       bloqué du harnais, jamais deux écritures concurrentes). */
    await page.locator('[data-workshop-field="textIt"]').first().fill("Anno con modifica e aggiunte");
    await page.click("#workshopAddPassageBtn");
    assert.equal(await page.evaluate(() => document.getElementById("workshopValidateBtn").disabled), false, "validation réarmée pour un ensemble de changements");
    await page.evaluate(() => window.__inc2.openValidation());
    await page.waitForFunction(() => document.getElementById("transcriptionValidationDialog").open);
    await page.evaluate(() => window.__inc2.confirmValidationRapidly());
    await page.waitForFunction(() => !document.getElementById("transcriptionValidationError").hidden);
    const confirmFailure = await page.locator("#transcriptionValidationError").textContent();
    assert.doesNotMatch(confirmFailure, /Aucune modification/, "avec changements réels, la confirmation part vers l'écriture (échec réseau attendu, pas un blocage métier)");
    assert.equal(await page.evaluate(() => window.__inc2.validationDuplicateRejections()), 1, "la seconde confirmation rapide est rejetée par la garde mono-instance");
    assert.deepEqual(await page.evaluate(() => window.__inc2.versionState()), { version: 2, revisions: 2 }, "échec réseau : aucune version créée");
    await page.locator('[data-close="transcriptionValidationDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("transcriptionValidationDialog").open);

    /* Chemin de succès (application en mémoire) : exactement +1 version pour
       l'ensemble, brouillon redevenu propre, validation désarmée. */
    const applied = await page.evaluate(() => window.__inc2.applyValidationForTest());
    assert.deepEqual(applied, { version: 3, revisions: 3 }, "une validation multi-changements = exactement +1 version");
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Validée · v3", "badge à jour après validation");
    assert.equal(await page.evaluate(() => document.getElementById("workshopValidateBtn").disabled), true, "brouillon propre : validation désarmée après validation");
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
    await page.evaluate(() => window.__inc2.useAdminProfile());
    await page.fill('[data-workshop-field="textIt"]', "Anno della conferma");

    /* Dialogue : version, historique et distinction avec Enregistrer/Comparer. */
    await page.click("#workshopValidateBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionValidationDialog").open, undefined, { timeout: 5000 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("transcriptionValidationDialog")).transform === "none", undefined, { timeout: 3000 });
    const cancelStyle = await page.locator("#transcriptionValidationDialog .modal-actions > [data-close]").evaluate(button => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return { color: style.color, borderStyle: style.borderStyle, width: box.width, height: box.height };
    });
    assert.equal(cancelStyle.color, "rgb(166, 66, 56)", "Annuler est une action textuelle rouge");
    assert.equal(cancelStyle.borderStyle, "none", "Annuler sans cadre bouton inutile");
    assert.ok(cancelStyle.width < 180 && cancelStyle.height >= 44, "Annuler compacte et tactile sur desktop");
    assert.equal(await page.locator("#transcriptionValidationConfirmBtn").evaluate(button => button.classList.contains("primary")), true, "la confirmation importante reste un vrai CTA");
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const mobileCancel = await page.locator("#transcriptionValidationDialog .modal-actions > [data-close]").boundingBox();
      const dialog = await page.locator("#transcriptionValidationDialog").boundingBox();
      assert.ok(mobileCancel && dialog && mobileCancel.width < dialog.width / 2 && mobileCancel.height >= 44,
        `Annuler compact et tactile à ${width}px (${mobileCancel?.width}×${mobileCancel?.height})`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `aucun débordement de fenêtre à ${width}px`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
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
    assert.match(await page.locator(".transcription-workshop-breadcrumb").textContent(), /Documents.*Registre Transactions Immobilières/, "fil d’Ariane compact avec le document courant");
    assert.equal(await page.locator("#workshopPageHeading").textContent(), "Transcription", "titre de page sans répétition du document");
    assert.equal(await page.locator(".topbar .main-nav").evaluate(element => getComputedStyle(element).display), "none", "méga-menu masqué uniquement dans l’atelier desktop");
    assert.notEqual(await page.locator(".topbar .brand").evaluate(element => getComputedStyle(element).display), "none", "identité La Nostra Storia conservée");
    await page.click('[data-workshop-breadcrumb="documents"]');
    await page.waitForFunction(() => document.getElementById("transcriptionWorkshopView").hidden && !document.getElementById("documentsView").hidden);
    await page.evaluate(() => window.__inc2.openDoc());
    await page.waitForSelector(".document-transcription-card [data-transcribe-document]");
    await page.evaluate(() => window.__inc2.transcribe());
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    await page.click('[data-workshop-breadcrumb="document"]');
    await page.waitForFunction(() => document.getElementById("transcriptionWorkshopView").hidden && !document.getElementById("documentDetailView").hidden);
    await page.evaluate(() => window.__inc2.transcribe());
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);

    /* L'officiel s'ouvre en lecture seule. L'activation d'une révision ne crée
       aucun brouillon avant un vrai changement de texte. */
    await page.waitForFunction(() => window.__inc2.officialBadge().text !== "", undefined, { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Validée · v2", "contenu officiel : Validée · v2");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), true, "officiel en lecture seule");
    const readonlyContrast = await page.locator(".transcription-workshop-passage.is-selected textarea").evaluateAll(fields => fields.map(field => {
      const style = getComputedStyle(field);
      return { color: style.color, fill: style.webkitTextFillColor, opacity: style.opacity, disabled: field.disabled };
    }));
    const bodyTextColor = await page.locator("body").evaluate(body => getComputedStyle(body).color);
    assert.ok(readonlyContrast.length >= 2 && readonlyContrast.every(field => field.disabled && field.color === bodyTextColor && field.fill === bodyTextColor && field.opacity === "1"), "transcriptions italienne et française lisibles en lecture seule");
    assert.equal(await page.locator("#workshopAddPassageBtn").isHidden(), true, "ajout masqué en lecture seule");
    assert.equal(await page.locator("#workshopSaveDraftBtn").count(), 0, "aucun bouton « Enregistrer »");
    assert.equal(await page.locator("#workshopValidateBtn").isHidden(), true, "Valider masqué en lecture seule");
    assert.equal(await page.locator("[data-workshop-delete-passage]").count(), 0, "aucune suppression offerte sur les passages officiels intangibles");
    assert.equal(await page.locator("#workshopActionsMenu").isHidden(), false, "menu ⋯ présent avec ses actions de consultation");
    assert.equal(await page.locator("#workshopActionsMenu #workshopHistoryBtn").evaluate(button => button.hidden), false, "Historique disponible en lecture seule");
    assert.equal(await page.locator(".transcription-workshop-mode").isHidden(), true, "contrôle segmenté entièrement masqué en consultation");
    assert.equal(await page.locator(".transcription-workshop-passage textarea").first().inputValue(), "Anno millenovecento corrente", "la consultation affiche la version officielle, jamais le brouillon");
    assert.equal(await page.locator("#workshopActionsMenu #workshopHelpBtn").evaluate(button => button.hidden), true, "aide masquée en lecture seule");
    assert.equal(await page.locator(".transcription-workshop-header #workshopValidateBtn").count(), 0, "aucun doublon de validation dans l’en-tête supérieur");
    assert.equal(await page.locator("#workshopModeBtn").textContent(), "Modifier", "action explicite pour entrer en édition");
    const consultationModeBox = await page.locator("#workshopModeBtn").boundingBox();
    assert.ok(consultationModeBox && consultationModeBox.height >= 44, `« Modifier » ≥ 44 px (${consultationModeBox?.height})`);
    const footerHeightConsultation = await page.locator(".transcription-workshop-footer").evaluate(footer => footer.getBoundingClientRect().height);
    await page.click("#workshopModeBtn");
    assert.equal(await page.locator(".transcription-workshop-mode").isVisible(), true, "contrôle segmenté visible après « Modifier »");
    assert.equal(await page.locator('[data-workshop-mode="draft"]').getAttribute("aria-pressed"), "true", "« Mon brouillon » sélectionné par défaut en édition");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), false, "édition activée explicitement");
    const footerHeightEdit = await page.locator(".transcription-workshop-footer").evaluate(footer => footer.getBoundingClientRect().height);
    assert.ok(Math.abs(footerHeightEdit - footerHeightConsultation) <= 1, `hauteur de pied stable consultation/édition (${footerHeightConsultation} → ${footerHeightEdit})`);
    assert.equal(await page.locator("#workshopSaveDraftBtn").count(), 0, "pas de commande manuelle créée par l'activation seule");
    assert.equal(await page.locator("#workshopAutosaveHint").isVisible(), true, "autosauvegarde annoncée en édition");
    assert.equal(await page.locator("#workshopActionsMenu").isHidden(), false, "menu ⋯ visible dès qu’une aide secondaire est disponible");
    assert.equal(await page.locator("#workshopModeBtn").isHidden(), true, "Modifier remplacé en mode édition");
    assert.equal(await page.locator("#workshopCancelEditBtn").textContent(), "Annuler", "action Annuler au même emplacement");
    assert.equal(await page.locator("#workshopValidateBtn").textContent(), "Valider", "action Valider alignée avec Annuler");
    await page.locator('[data-workshop-field="textIt"]').first().fill("Anno con modifica");
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Révision en cours · v3", "badge annonce la prochaine version");
    assert.equal(await page.locator("#workshopActionsMenu").isHidden(), false, "⋯ apparaît dès qu’une action secondaire est disponible");
    assert.equal(await page.locator("#workshopActionsMenu #workshopHistoryBtn").evaluate(button => button.hidden), false, "Historique conservé parmi les actions secondaires");
    await page.click('[data-workshop-mode="diff"]');
    assert.equal(await page.locator("#workshopComparePanel").isVisible(), true, "différences affichées directement dans le panneau");
    const diffMarkup = await page.locator("#workshopCompareContent").innerHTML();
    assert.match(diffMarkup, /<del class="transcription-workshop-diff-removed">/, "suppression surlignée depuis les passages officiels réellement absents du brouillon");
    assert.match(diffMarkup, /<ins class="transcription-workshop-diff-added">/, "ajout surligné depuis le texte réellement modifié");
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Révision en cours · v3", "comparaison sans altérer le brouillon ni l’officiel");
    await page.click('[data-workshop-mode="official"]');
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), true, "aperçu officiel temporaire en lecture seule");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().inputValue(), "Anno millenovecento corrente", "aperçu de la version officielle");
    assert.equal(await page.locator("#workshopModeBtn").isHidden(), true, "hors consultation : pied Annuler/Valider, sans bouton Modifier");
    assert.equal(await page.locator(".transcription-workshop-mode").isVisible(), true, "le contrôle segmenté reste accessible pendant l'édition");
    await page.click('[data-workshop-mode="draft"]');
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
    /* L'entrée des modales (150 ms, scale0.992) fausse les mesures tant
       qu'elle tourne : on attend la fin de l'animation avant de relever
       les boîtes. */
    await page.waitForFunction(() => {
      const dialog = document.getElementById("transcriptionEditCancelDialog");
      return dialog.open && getComputedStyle(dialog).transform === "none";
    }, undefined, { timeout: 3000 });
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), false, "la confirmation laisse l’édition active tant qu’un choix n’est pas fait");
    assert.equal(await page.locator("#workshopCancelKeepBtn").isVisible(), true, "choix de conservation explicite proposé");
    assert.equal(await page.locator("#workshopCancelDiscardBtn").isVisible(), true, "choix d'abandon explicite proposé");
    assert.equal(await page.locator("#workshopCancelContinueBtn").textContent(), "Continuer", "libellé court de reprise d’édition");
    assert.equal(await page.locator("#workshopCancelDiscardBtn").textContent(), "Abandonner", "libellé court d’abandon");
    assert.equal(await page.locator("#workshopCancelKeepBtn").textContent(), "Conserver le brouillon", "libellé de conservation");
    assert.match(await page.locator("#transcriptionEditCancelDescription").textContent(), /La version officielle reste inchangée/, "texte explicatif raccourci");
    const desktopCancel = await page.evaluate(() => {
      const box = id => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return { keep: box("workshopCancelKeepBtn"), cont: box("workshopCancelContinueBtn"), discard: box("workshopCancelDiscardBtn") };
    });
    assert.ok(Math.abs(desktopCancel.keep.y - desktopCancel.cont.y) <= 1 && Math.abs(desktopCancel.discard.y - desktopCancel.cont.y) <= 1, "trois actions sur une ligne en desktop");
    assert.ok(desktopCancel.cont.x < desktopCancel.discard.x && desktopCancel.discard.x < desktopCancel.keep.x, "ordre Continuer, Abandonner, Conserver");
    assert.ok(desktopCancel.keep.width >= 130 && desktopCancel.cont.width >= 90 && desktopCancel.discard.width >= 90, "largeurs équilibrées et libellés non coupés");
    assert.ok(desktopCancel.keep.height >= 44, "cibles tactiles ≥ 44 px en desktop");
    await page.click("#workshopCancelKeepBtn");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().isDisabled(), true, "conservation retourne à la consultation officielle");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().inputValue(), "Anno millenovecento corrente", "annulation affiche l'officiel sans le modifier");
    assert.equal(await page.locator("#workshopModeBtn").textContent(), "Reprendre la révision", "le brouillon conservé reste reprenable");
    await page.click("#workshopModeBtn");
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().inputValue(), "Révision à conserver", "le brouillon sauvegardé est conservé");
    await page.click('[data-workshop-breadcrumb="document"]');
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    const revisionCard = await page.locator(".document-transcription-card").textContent();
    assert.match(revisionCard, /Révision en cours · v3/, "carte Document indique la révision locale");
    assert.equal(await page.locator(".document-transcription-card [data-transcribe-document]").textContent(), "Reprendre", "CTA court de reprise de révision");
    await page.click(".document-transcription-card [data-transcribe-document]");
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    assert.equal(await page.locator('[data-workshop-field="textIt"]').first().inputValue(), "Révision à conserver", "la révision reprend sans perte depuis la carte Document");
    await page.click("#workshopCancelEditBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionEditCancelDialog").open);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const dialog = document.getElementById("transcriptionEditCancelDialog");
      return dialog.open && getComputedStyle(dialog).transform === "none";
    }, undefined, { timeout: 3000 });
    const mobileCancel = await page.evaluate(() => {
      const box = id => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        keep: box("workshopCancelKeepBtn"),
        cont: box("workshopCancelContinueBtn"),
        discard: box("workshopCancelDiscardBtn"),
        viewport: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    });
    assert.ok(mobileCancel.keep.width >= mobileCancel.viewport * 0.85, "« Conserver le brouillon » pleine largeur sur mobile");
    assert.ok(mobileCancel.keep.y < mobileCancel.cont.y - 10, "conservation en tête, au-dessus des autres actions");
    assert.ok(Math.abs(mobileCancel.cont.y - mobileCancel.discard.y) <= 1, "« Continuer » et « Abandonner » côte à côte");
    assert.ok(mobileCancel.cont.x < mobileCancel.discard.x, "Continuer à gauche, Abandonner à droite");
    assert.ok(mobileCancel.keep.height >= 44 && mobileCancel.cont.height >= 44 && mobileCancel.discard.height >= 44, "cibles tactiles ≥ 44 px sur mobile");
    assert.equal(mobileCancel.overflow, false, "fenêtre de sortie sans débordement horizontal à 390 px");
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
    assert.ok(Math.abs(mobileEditActions.cancel[3] - mobileEditActions.validate[3]) <= 1, "Annuler et Valider de même hauteur calculée");
    assert.ok(Math.abs(mobileEditActions.cancel[3] - consultationModeBox.height) <= 1, `hauteur identique à « Modifier » (${consultationModeBox.height} / ${mobileEditActions.cancel[3]})`);
    assert.notEqual(mobileEditActions.cancel[2], mobileEditActions.validate[2], "largeur des boutons adaptée à chaque libellé");
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
    await clickWorkshopMenuAction(page, "#workshopHistoryBtn");
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
    await clickWorkshopMenuAction(page, "#workshopHistoryBtn");
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
    await page.click('[data-workshop-breadcrumb="document"]');
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

/* Header mobile de consultation (modèle fiche Personne) : chevron de retour,
   « La Nostra Storia » centré, aucun menu fantôme — uniquement en consultation ;
   l'atelier d'édition reste strictement identique à avant. */
test("transcription consultée : header mobile harmonisé, atelier d'édition intact", async t => {
  for (const width of [320, 375, 390]) {
    const harness = await openInc2Harness(t, { width, height: 844 });
    if (!harness) return;
    const { browser, server, context, page, pageErrors } = harness;
    try {
      await bootInc2(page);
      await page.evaluate(() => window.__inc2.seedOfficial());
      await page.evaluate(() => window.__inc2.openDoc());
      /* Le volet Informations est replié sur mobile : le bouton de la carte vit
         dans le DOM (état attached) — le clic DOM fonctionne même replié. */
      await page.waitForSelector(".document-transcription-card [data-transcribe-document]", { state: "attached" });
      await page.evaluate(() => window.__inc2.transcribe());
      await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
      await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").classList.contains("is-edit-session"));

      const consultation = await page.evaluate(() => {
        const header = document.getElementById("transcriptionMobileHeader");
        const contentBack = document.getElementById("workshopBackBtn");
        const mobileBack = document.getElementById("transcriptionMobileBackBtn");
        const titleBox = header.querySelector("strong").getBoundingClientRect();
        return {
          headerVisible: getComputedStyle(header).display !== "none" && header.getBoundingClientRect().height > 0,
          contentBackDisplay: getComputedStyle(contentBack).display,
          mobileBackHeight: mobileBack.getBoundingClientRect().height,
          menuCount: header.querySelectorAll("details").length,
          spacerCount: header.querySelectorAll(".detail-mobile-header-spacer").length,
          titleText: header.querySelector("strong").textContent,
          titleCenterDelta: Math.round((titleBox.left + titleBox.right) / 2 - innerWidth / 2),
          horizontalOverflow: document.documentElement.scrollWidth - innerWidth
        };
      });
      assert.equal(consultation.headerVisible, true, `${width}px : header mobile visible pendant la consultation`);
      assert.equal(consultation.contentBackDisplay, "none", `${width}px : Retour interne de l'atelier masqué en consultation`);
      assert.ok(consultation.mobileBackHeight >= 44, `${width}px : chevron de retour ≥ 44 px (${consultation.mobileBackHeight}px)`);
      assert.equal(consultation.menuCount, 0, `${width}px : aucun menu « … » fantôme : la page n'en possède pas`);
      assert.equal(consultation.spacerCount, 1, `${width}px : espaceur de centrage à droite pour équilibrer le titre`);
      assert.equal(consultation.titleText, "La Nostra Storia", `${width}px : titre de marque centré, sans logo`);
      assert.ok(Math.abs(consultation.titleCenterDelta) <= 1, `${width}px : titre centré horizontalement (${consultation.titleCenterDelta}px)`);
      assert.ok(consultation.horizontalOverflow <= 0, `${width}px : aucun débordement horizontal (${consultation.horizontalOverflow}px)`);

      /* Retour par le chevron : même contexte que l'ancien Retour interne. */
      await page.click("#transcriptionMobileBackBtn");
      await page.waitForFunction(() => document.getElementById("transcriptionWorkshopView").hidden && !document.getElementById("documentDetailView").hidden);

      /* Mode édition : l'atelier redevient strictement identique à avant. Le pied
         (Modifier) vit dans le panneau droit, affiché hors onglet Original. */
      await page.evaluate(() => window.__inc2.transcribe());
      await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
      await page.click("#workshopTabItalian");
      await page.waitForFunction(() => getComputedStyle(document.getElementById("workshopPanelRight")).display !== "none");
      await page.click("#workshopModeBtn");
      await page.waitForFunction(() => document.getElementById("transcriptionWorkshopView").classList.contains("is-edit-session"));
      const edition = await page.evaluate(() => ({
        headerHidden: getComputedStyle(document.getElementById("transcriptionMobileHeader")).display === "none",
        backVisible: getComputedStyle(document.getElementById("workshopBackBtn")).display !== "none",
        backHeight: document.getElementById("workshopBackBtn").getBoundingClientRect().height
      }));
      assert.equal(edition.headerHidden, true, `${width}px : header de consultation masqué pendant l'édition`);
      assert.equal(edition.backVisible, true, `${width}px : Retour de l'atelier conservé en édition`);
      assert.ok(edition.backHeight >= 44, `${width}px : Retour atelier ≥ 44 px en édition (${edition.backHeight}px)`);

      assertNoInc2PageErrors(pageErrors);
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    }
  }
});
