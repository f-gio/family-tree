import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";
import { WORKSHOP_ZONE_MIN_SIZE } from "../js/transcription-workshop.js";

/* Lot B2 : délimitation graphique des pages PDF dans l'atelier de
   transcription. Le moteur PDF.js de la fiche Document est réutilisé ; les
   ancres portent { shape, pdfPage (1-based), fileSha256, x, y, width, height }
   avec les mêmes coordonnées normalisées que B1. L'empreinte SHA-256 des
   octets du PDF est calculée exactement comme l'application (même fixture). */

function createPdf(pageCount = 3) {
  const objects = [];
  const kids = Array.from({ length: pageCount }, (_, index) => `${3 + index * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let page = 1; page <= pageCount; page++) {
    const pageObject = 3 + (page - 1) * 2;
    const contentObject = pageObject + 1;
    const stream = `BT /F1 24 Tf 72 700 Td (Page de test ${page}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${pageCount * 2 + 3} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

const fixturePdfBytes = createPdf(3);
const fixturePdfDataUrl = `data:application/pdf;base64,${fixturePdfBytes.toString("base64")}`;
const fixturePdfSha256 = createHash("sha256").update(fixturePdfBytes).digest("hex");
const corruptPdfDataUrl = `data:application/pdf;base64,${Buffer.from("pas-un-vrai-pdf").toString("base64")}`;

const HOOKS = `
window.__b2 = {
  passagesFixture() {
    return [
      { id: "p-1", order: 0, textIt: "Anno millenovecento", translationFr: "L’année mille neuf cent", separatorAfter: "", unreadable: false, hypotheses: [], anchor: { shape: "rect", pdfPage: 1, fileSha256: "${fixturePdfSha256}", x: 0.1, y: 0.1, width: 0.3, height: 0.2 }, lineLabel: "l. 1", translationState: "current" },
      { id: "p-2", order: 1, textIt: "indici di Orino", translationFr: null, separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 2", translationState: "not-started" },
      { id: "p-3", order: 2, textIt: "rogito del notaio", translationFr: "Acte du notaire", separatorAfter: "", unreadable: false, hypotheses: [], anchor: { shape: "rect", pdfPage: 2, fileSha256: "${fixturePdfSha256}", x: 0.2, y: 0.15, width: 0.4, height: 0.3 }, lineLabel: "l. 3", translationState: "current" },
      { id: "p-4", order: 3, textIt: "marginalia antica", translationFr: null, separatorAfter: "", unreadable: false, hypotheses: [], anchor: { shape: "rect", pdfPage: 1, fileSha256: "${"f".repeat(64)}", x: 0.1, y: 0.1, width: 0.2, height: 0.1 }, lineLabel: "l. 4", translationState: "not-started" }
    ];
  },
  show() { $("authScreen").hidden = true; $("topbar").hidden = false; setView("directory"); },
  seed(fileData = "${fixturePdfDataUrl}") {
    const documentItem = {
      id: "doc-b2", title: "Registre Transactions B2",
      type: "Registre", date: "1891-05-12",
      fileName: "registre.pdf", mimeType: "application/pdf",
      fileData,
      fileSize: ${fixturePdfBytes.length},
      personIds: [],
      pages: [{ id: "page-b2-1", label: "Folio 1", photographs: [], passages: window.__b2.passagesFixture() }]
    };
    documents = [documentItem];
    people = [];
    loadedPeople = loadedDocuments = true;
    genealogyRecords = { sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [], genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [] };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin", status: "approved" };
    renderGenealogyWorkspace();
  },
  seedOfficial() {
    const passages = JSON.parse(JSON.stringify(window.__b2.passagesFixture()));
    genealogyRecords.transcriptionHeads = [{
      id: "tx-b2-head",
      data: {
        documentId: "doc-b2", pageId: "page-b2-1", passages,
        transcriptionIt: passages.map(passage => passage.textIt).join("\\n"),
        translationFr: "L’année mille neuf cent",
        changeKind: "initial", justification: "Validation de la transcription",
        authorUid: "admin-seed", previousRevisionId: null
      },
      version: 1, revisionId: "tx-b2-rev1",
      createdAt: new Date("2026-10-20T10:00:00Z"), createdBy: "admin-seed",
      updatedAt: new Date("2026-10-20T10:00:00Z"), updatedBy: "admin-seed",
      eventId: "tx-b2-ev1"
    }];
  },
  preparePdfInit() {
    /* Déclenche le chemin d'initialisation : le document PDF n'a aucune page
       de transcription et seulement une source liée. Aucune écriture réseau
       ici — la partie locale de la confirmation est rejouée par le hook
       completeInitLocally (le magasin Firestore est inaccessible dans les
       tests, cf. le paragraphe non-régression du lot). */
    const documentWithoutPages = { ...documents[0] };
    delete documentWithoutPages.pages;
    documents = [documentWithoutPages];
    genealogyRecords.sourceDocuments = [createSourceDocument({ id: "src-b2", title: "Source B2", documentIds: ["doc-b2"] })];
  },
  /* Rejoue la séquence LOCALE de confirmTranscriptionPageInit (préparation de
     la page technique + ouverture de l'atelier) — la partie réseau est couverte
     par le test de confirmation réelle ci-dessus, impossible à faire aboutir
     sans serveur Firestore dans les tests. */
  completeInitLocally() {
    const state = transcriptionPageInitState;
    const sourceRecord = transcriptionPageInitSourceRecord();
    if (!state || !sourceRecord) throw new Error("dialogue d’initialisation non actif");
    const sourceData = genealogyRecordData(sourceRecord);
    const { documentItem, sha256 } = state;
    const pageId = createGenealogyId(refs.sourceDocuments);
    const photographId = createGenealogyId(refs.sourceDocuments);
    const prepared = prepareLegacyDocumentPage({
      source: sourceData,
      documentItem,
      sha256,
      pageId,
      photographId,
      importedAt: new Date().toISOString()
    });
    close("transcriptionPageInitDialog");
    transcriptionPageInitState = null;
    return openTranscriptionWorkshopFor(
      buildTranscriptionWorkshopDocumentContext(documentItem, prepared.source.pages, prepared.source.documentIds),
      prepared.page.id,
      ""
    );
  },
  openDoc() { setView("directory"); openStoredDocument(documents[0], "directory"); },
  transcribe() { const button = document.querySelector("#viewerDocumentDetails [data-transcribe-document]"); if (button) button.click(); },
  useAdminProfile() { currentUserProfile = { role: "admin", status: "approved" }; updateWorkshopDraftIndicators(); },
  anchors() {
    const draft = transcriptionWorkshopDraft;
    return Object.fromEntries((draft?.passages || []).map(passage => [passage.id, passage.anchor ? { ...passage.anchor } : null]));
  },
  fields() { return Object.fromEntries([...document.querySelectorAll("[data-workshop-field]")].map(field => [field.dataset.workshopField + ":" + field.dataset.workshopPassage, field.value])); },
  stored() {
    const out = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key && key.startsWith("familyTreeTranscriptionDraft:")) out.push([key, localStorage.getItem(key)]);
    }
    return out;
  },
  status() { return $("workshopSaveStatus").textContent; },
  toolActive() { return Boolean(workshopZoneTool); },
  appState() {
    return {
      readOnly: transcriptionWorkshopIsReadOnly(),
      editing: transcriptionWorkshopEditing,
      mode: transcriptionWorkshopDisplayMode,
      renderedPage: workshopPdfRenderedPage,
      viewer: Boolean(workshopPdfViewer),
      editorState: transcriptionWorkshopEditorState(),
      active: isTranscriptionWorkshopActive()
    };
  },
  pdfState() {
    return {
      page: workshopPdfRenderedPage,
      viewer: Boolean(workshopPdfViewer),
      hash: transcriptionWorkshopContext?.pdf?.fileSha256 || null,
      available: Boolean(transcriptionWorkshopContext?.pdf?.available),
      viewerError: transcriptionWorkshopContext?.pdf?.viewerError || null
    };
  },
  toasts() { return [...document.querySelectorAll(".toast")].map(toast => toast.textContent); }
};
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

async function createB2Page(browser, server, { width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "fr-FR", reducedMotion: "reduce" });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      return route.fulfill({ response, body: `${await response.text()}\n${HOOKS}` });
    }
    return url.startsWith(server.baseURL) || url.includes("gstatic.com") ? route.continue() : route.abort("blockedbyclient");
  });
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", dialog => dialog.accept().catch(() => {}));
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__b2 === "object");
  return { context, page, pageErrors };
}

function assertNoB2PageErrors(pageErrors) {
  const relevant = pageErrors.filter(message => /workshop|transcription|zone|anchor|pdf/i.test(message));
  assert.deepEqual(relevant, [], `aucune erreur applicative (${relevant.join(" | ")})`);
}

async function openB2Workshop(page, { official = false, fileData = null } = {}) {
  await page.evaluate(({ official: withOfficial, fileData: dataUrl }) => {
    window.__b2.show();
    window.__b2.seed(dataUrl || undefined);
    if (withOfficial) window.__b2.seedOfficial();
    window.__b2.openDoc();
  }, { official, fileData });
  await page.waitForFunction(() => {
    const toggle = document.getElementById("viewerDetailsBtn");
    if (!toggle) return false;
    if (toggle.getAttribute("aria-expanded") === "false") {
      toggle.click();
      return false;
    }
    return Boolean(document.querySelector("#viewerDocumentDetails [data-transcribe-document]"));
  }, undefined, { timeout: 8000 });
  await page.evaluate(() => { window.__b2.useAdminProfile(); window.__b2.transcribe(); });
  await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
}

/** Attend un rendu PDF confirmé et stable : le lecteur relance des rendus au
    fil de la mise en page (ResizeObserver), pendant lesquels l'application
    masque légitimement toute zone — on attend le dernier rendu de la page. */
async function waitForPdfReady(page) {
  try {
    await page.waitForFunction(() => {
      const state = window.__b2.pdfState();
      const canvas = document.getElementById("workshopPdfCanvas");
      return state.viewer && state.page >= 1 && canvas && canvas.width > 0;
    }, undefined, { timeout: 25000 });
    for (let attempt = 0; attempt < 30; attempt++) {
      const state = await page.evaluate(() => window.__b2.pdfState());
      await page.waitForTimeout(120);
      const again = await page.evaluate(() => window.__b2.pdfState());
      if (state.page >= 1 && again.page === state.page) return;
    }
    throw new Error(`rendu PDF instable : ${JSON.stringify(await page.evaluate(() => window.__b2.pdfState()))}`);
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      pdf: window.__b2.pdfState(),
      app: window.__b2.appState(),
      message: document.getElementById("workshopPdfMessage")?.textContent,
      messageHidden: document.getElementById("workshopPdfMessage")?.hidden,
      surfaceHidden: document.getElementById("workshopPdfSurface")?.hidden
    }));
    throw new Error(`${error.message}; diagnostics PDF ${JSON.stringify(diagnostics)}`);
  }
}

async function dragOnCanvas(page, fromX, fromY, toX, toY) {
  /* L'éditeur rejoint la position du canvas après la bascule d'onglet (double
     rAF du lecteur) : on attend l'alignement avant de tracer, sinon le pointeur
     atteindrait le canvas nu (neutralisé par la garde de tracé). */
  await page.waitForFunction(() => {
    const editor = document.getElementById("workshopPdfZoneEditor");
    const canvas = document.getElementById("workshopPdfCanvas");
    if (!editor || editor.hidden || !canvas) return false;
    const editorBox = editor.getBoundingClientRect();
    const canvasBox = canvas.getBoundingClientRect();
    return editorBox.width > 40
      && Math.abs(editorBox.x - canvasBox.x) <= 2
      && Math.abs(editorBox.y - canvasBox.y) <= 2
      && Math.abs(editorBox.width - canvasBox.width) <= 2;
  }, undefined, { timeout: 5000 });
  const box = await page.locator("#workshopPdfCanvas").boundingBox();
  assert.ok(box && box.width > 80, "canvas PDF affiché");
  const x0 = box.x + box.width * fromX;
  const y0 = box.y + box.height * fromY;
  const x1 = box.x + box.width * toX;
  const y1 = box.y + box.height * toY;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
}

/** Clic sur une action de zone après stabilisation du rendu PDF (le lecteur
    relance ponctuellement des rendus sans que ce soit un changement de page). */
async function clickZoneAction(page, action) {
  await waitForPdfReady(page);
  await page.click(`[data-workshop-zone-action="${action}"]`);
}

/** Rectangle d'édition visible et dimensionné (les re-rendus PDF peuvent
    masquer transitoirement l'éditeur — on attend l'état stable). */
async function waitForZoneEditorRect(page) {
  try {
    await page.waitForFunction(() => {
      const rect = document.getElementById("workshopPdfZoneEditorRect");
      return rect && !rect.hidden && rect.getBoundingClientRect().width > 4;
    }, undefined, { timeout: 5000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const editor = document.getElementById("workshopPdfZoneEditor");
      const rect = document.getElementById("workshopPdfZoneEditorRect");
      const canvas = document.getElementById("workshopPdfCanvas");
      const editorBox = editor.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      return {
        tool: window.__b2.toolActive(),
        state: window.__b2.pdfState(),
        editorHidden: editor.hidden,
        editorBox: [Math.round(editorBox.x), Math.round(editorBox.y), Math.round(editorBox.width), Math.round(editorBox.height)],
        canvasBox: [Math.round(canvasBox.x), Math.round(canvasBox.y), Math.round(canvasBox.width), Math.round(canvasBox.height)],
        rectHidden: rect.hidden,
        rectStyle: [rect.style.left, rect.style.top, rect.style.width, rect.style.height],
        activePanel: document.getElementById("workshopLayout").dataset.activePanel
      };
    });
    throw new Error(`${error.message}; diagnostics éditeur ${JSON.stringify(diagnostics)}`);
  }
}

async function zoneAlignment(page, passageId) {
  return page.evaluate(id => {
    const anchor = window.__b2.anchors()[id];
    const zone = document.getElementById("workshopPdfZone");
    const canvas = document.getElementById("workshopPdfCanvas").getBoundingClientRect();
    if (!anchor || zone.hidden || !canvas.width) return { ok: false, reason: "masquée ou sans cible" };
    const bounds = zone.getBoundingClientRect();
    const dx = Math.abs(bounds.x - (canvas.x + anchor.x * canvas.width));
    const dy = Math.abs(bounds.y - (canvas.y + anchor.y * canvas.height));
    const dw = Math.abs(bounds.width - anchor.width * canvas.width);
    return { ok: dx <= 2 && dy <= 2 && dw <= 2, dx, dy, dw };
  }, passageId);
}

test("B2 initialisation : un PDF sans transcription ouvre le dialogue puis l’atelier", { timeout: 120000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const { context, page, pageErrors } = await createB2Page(browser, server);
  try {
    await page.evaluate(() => {
      window.__b2.show();
      window.__b2.seed();
      window.__b2.preparePdfInit();
      window.__b2.openDoc();
    });
    await page.waitForFunction(() => {
      const toggle = document.getElementById("viewerDetailsBtn");
      if (!toggle) return false;
      if (toggle.getAttribute("aria-expanded") === "false") {
        toggle.click();
        return false;
      }
      return Boolean(document.querySelector("#viewerDocumentDetails [data-transcribe-document]"));
    }, undefined, { timeout: 8000 });
    assert.match(await page.locator("#viewerDocumentDetails [data-transcribe-document]").textContent(), /Ajouter/, "aucune page de transcription : action Ajouter");
    await page.evaluate(() => { window.__b2.useAdminProfile(); window.__b2.transcribe(); });
    /* Le refus JPEG est levé : le dialogue d'initialisation s'ouvre. */
    await page.waitForFunction(() => document.getElementById("transcriptionPageInitDialog").open, undefined, { timeout: 8000 });
    await page.waitForFunction(() => !document.getElementById("transcriptionPageInitConfirmBtn").disabled, undefined, { timeout: 8000 });
    assert.match(await page.locator("#transcriptionPageInitNotice").textContent(), /fichier du document n’est pas dupliqué/, "notice de non-duplication neutre");
    assert.match(await page.locator("#transcriptionPageInitFacts").textContent(), /application\/pdf/, "format PDF affiché dans les faits du dialogue");
    /* Partie locale de l'initialisation (préparation de la page technique +
       ouverture de l'atelier) : mêmes fonctions que la confirmation réelle ;
       seule l'écriture Firestore, indisponible dans les tests, est omise. */
    await page.evaluate(() => window.__b2.completeInitLocally());
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden, undefined, { timeout: 8000 });
    await waitForPdfReady(page);
    assert.equal(await page.evaluate(() => window.__b2.pdfState().hash), fixturePdfSha256, "atelier PDF sur la page initialisée, empreinte du fichier conservée");
    assert.equal(await page.evaluate(() => document.getElementById("workshopOfficialBadge").textContent), "Brouillon", "page technique neuve : brouillon, aucune version officielle");
    assert.equal(await page.locator("#workshopAddPassageBtn").isVisible(), true, "prêt à transcrire : ajout de passage disponible");
    assertNoB2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("B2 consultation : zones PDF alignées, navigation multipage, aucun contrôle d’édition", { timeout: 120000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const { context, page, pageErrors } = await createB2Page(browser, server);
  try {
    await openB2Workshop(page, { official: true });
    assert.equal(await page.evaluate(() => window.__b2.status()), "Consultation officielle · v1", "consultation de la version officielle");
    assert.equal(await page.locator("[data-workshop-zone-action]").count(), 0, "aucun contrôle de délimitation en consultation");
    await waitForPdfReady(page);
    assert.equal(await page.evaluate(() => window.__b2.pdfState().page), 1, "page 1 affichée à l’ouverture");
    assert.equal(await page.locator("#workshopPdfStatus").textContent(), "1 / 3", "pagination PDF active");
    assert.match(await page.evaluate(() => window.__b2.pdfState().hash), /^[a-f0-9]{64}$/, "empreinte SHA-256 du fichier");
    await page.waitForFunction(() => !document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });
    let alignment = await zoneAlignment(page, "p-1");
    assert.ok(alignment.ok, `zone p-1 alignée sur le canvas (dx=${alignment.dx}, dy=${alignment.dy}, dw=${alignment.dw})`);
    /* Sélection d'un passage à zone d'une autre page : ouverture automatique. */
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(2).click();
    await page.waitForFunction(() => window.__b2.pdfState().page === 2, undefined, { timeout: 4000 });
    await page.waitForFunction(() => !document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });
    alignment = await zoneAlignment(page, "p-3");
    assert.ok(alignment.ok, `zone p-3 alignée après ouverture de la page 2 (dx=${alignment.dx}, dy=${alignment.dy})`);
    /* Passage sans zone : aucun rectangle fictif. */
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();
    await page.waitForFunction(() => document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });
    /* Changement manuel de page : la sélection du passage est conservée. */
    await page.click("#workshopPdfNextBtn");
    await page.waitForFunction(() => window.__b2.pdfState().page === 3, undefined, { timeout: 4000 });
    assert.equal(await page.locator("#workshopPassagePills [aria-current='step']").textContent(), "2", "sélection de passage conservée après changement de page");
    await page.waitForFunction(() => document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });
    /* Ancre périmée (PDF remplacé) : jamais affichée en consultation. */
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(3).click();
    await page.waitForFunction(() => window.__b2.pdfState().page === 1, undefined, { timeout: 4000 });
    await page.waitForFunction(() => document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });
    assertNoB2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("B2 édition : tracé, confirmation, ajustement, suppression, navigation et périmètre de fichier", { timeout: 180000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const { context, page, pageErrors } = await createB2Page(browser, server);
  try {
    await openB2Workshop(page, { official: false });
    await waitForPdfReady(page);
    const expectedHash = await page.evaluate(() => window.__b2.pdfState().hash);
    assert.match(expectedHash, /^[a-f0-9]{64}$/, "empreinte SHA-256 du fichier calculée à l’ouverture");

    /* Entrées sur le passage actif : Ajuster + Supprimer pour une zone valide. */
    assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="adjust"]').count(), 1, "« Ajuster » sur la carte active");
    assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="delete"]').count(), 1, "« Supprimer la zone » sur la carte active");
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();
    assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="draw"]').count(), 1, "« Délimiter ce passage » sans zone");

    /* Tracé : aucune écriture avant confirmation. */
    await clickZoneAction(page, "draw");
    assert.equal(await page.evaluate(() => window.__b2.toolActive()), true, "mode de tracé actif");
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("workshopPdfTools")).pointerEvents), "auto", "pagination utilisable pendant le tracé");
    assert.equal(await page.locator("#workshopZoneActions").isVisible(), true, "Annuler / Confirmer sous la surface PDF");
    assert.equal(await page.locator("#workshopZoneConfirmBtn").isDisabled(), true, "confirmation indisponible sans rectangle");
    await dragOnCanvas(page, 0.2, 0.25, 0.6, 0.65);
    await waitForZoneEditorRect(page);
    assert.equal(await page.evaluate(() => window.__b2.anchors()["p-2"]), null, "aucune écriture avant la confirmation");
    assert.equal(await page.locator("#workshopZoneConfirmBtn").isEnabled(), true, "aperçu du rectangle : confirmation armée");
    assert.equal(await page.evaluate(() => window.__b2.anchors()["p-2"]), null, "aucune écriture avant la confirmation");
    await page.click("#workshopZoneCancelBtn");
    assert.equal(await page.evaluate(() => window.__b2.toolActive()), false, "annulation du tracé");
    assert.equal(await page.evaluate(() => window.__b2.anchors()["p-2"]), null, "annulation sans écriture");

    await clickZoneAction(page, "draw");
    await dragOnCanvas(page, 0.2, 0.25, 0.6, 0.65);
    await page.click("#workshopZoneConfirmBtn");
    const drawn = await page.evaluate(() => window.__b2.anchors()["p-2"]);
    assert.equal(drawn.shape, "rect", "modèle rectangle");
    assert.equal(drawn.pdfPage, 1, "page PDF 1-based de la page affichée");
    assert.equal(drawn.fileSha256, expectedHash, "ancre épinglée à l’empreinte du fichier");
    assert.ok(drawn.width >= WORKSHOP_ZONE_MIN_SIZE && drawn.height >= WORKSHOP_ZONE_MIN_SIZE, "taille minimale");
    assert.ok(drawn.x >= 0 && drawn.y >= 0 && drawn.x + drawn.width <= 1 + 1e-9 && drawn.y + drawn.height <= 1 + 1e-9, "bornes normalisées");
    assert.equal(await page.evaluate(() => window.__b2.fields()["textIt:p-2"]), "indici di Orino", "texte du passage conservé");
    await page.waitForFunction(() => window.__b2.status() === "Enregistré", undefined, { timeout: 8000 });
    const storedAnchor = await page.evaluate(() => {
      const stored = window.__b2.stored();
      if (!stored.length) return null;
      const snapshot = JSON.parse(stored[0][1]).snapshot;
      return snapshot.passages.find(passage => passage.id === "p-2")?.anchor || null;
    });
    assert.ok(storedAnchor && storedAnchor.pdfPage === 1 && storedAnchor.fileSha256.length === 64, "ancre PDF dans le brouillon sauvegardé");
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("workshopPdfTools")).pointerEvents), "auto", "pagination restaurée après confirmation");

    /* Navigation pendant le mode modification : la pagination reste active,
       le passage sélectionné est conservé, l'ancre confirmée n'est ni
       déplacée ni supprimée en changeant de page — seul un nouveau tracé
       confirmé sur la page affichée remplace l'association. */
    await clickZoneAction(page, "adjust");
    await waitForZoneEditorRect(page);
    await page.click("#workshopPdfNextBtn");
    await page.waitForFunction(() => window.__b2.pdfState().page === 2, undefined, { timeout: 4000 });
    assert.equal(await page.evaluate(() => window.__b2.toolActive()), true, "changement de page sans quitter le mode édition");
    assert.equal(await page.locator("#workshopZoneActions").isVisible(), true, "commandes de délimitation conservées après navigation");
    assert.equal(await page.locator("#workshopZoneConfirmBtn").isDisabled(), true, "rectangle temporaire retiré : confirmation désarmée");
    assert.equal(await page.evaluate(() => window.__b2.anchors()["p-2"].pdfPage), 1, "ancre confirmée intacte malgré la navigation");
    assert.equal(await page.locator("#workshopPassagePills [aria-current='step']").textContent(), "2", "passage sélectionné conservé pendant la navigation");
    assert.equal(await page.evaluate(() => document.getElementById("workshopPdfZone").hidden), true, "zone de la page 1 masquée tant que sa page n'est pas affichée");
    await dragOnCanvas(page, 0.25, 0.3, 0.65, 0.7);
    await waitForZoneEditorRect(page);
    assert.equal(await page.locator("#workshopZoneConfirmBtn").isEnabled(), true, "nouveau tracé sur la page affichée : confirmation armée");
    await page.click("#workshopZoneConfirmBtn");
    const replaced = await page.evaluate(() => window.__b2.anchors()["p-2"]);
    assert.equal(replaced.pdfPage, 2, "confirmation sur une autre page : l'association existante est remplacée");
    assert.equal(replaced.fileSha256, expectedHash, "nouvelle ancre toujours épinglée à l'empreinte du fichier");
    await page.waitForFunction(() => !document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });
    const replacedAlignment = await zoneAlignment(page, "p-2");
    assert.ok(replacedAlignment.ok, `zone p-2 réalignée sur la page 2 (dx=${replacedAlignment.dx}, dy=${replacedAlignment.dy})`);
    await page.click("#workshopPdfPrevBtn");
    await page.waitForFunction(() => window.__b2.pdfState().page === 1, undefined, { timeout: 4000 });
    await page.waitForFunction(() => document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });

    /* Sélection d'une zone d'une autre page : ouverture automatique + alignement. */
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(2).click();
    await page.waitForFunction(() => window.__b2.pdfState().page === 2, undefined, { timeout: 4000 });
    await page.waitForFunction(() => !document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });
    let alignment = await zoneAlignment(page, "p-3");
    assert.ok(alignment.ok, `zone p-3 alignée sur le canvas de la page 2 (dx=${alignment.dx}, dy=${alignment.dy})`);

    /* Ajustement : déplacement confirmé puis annulation restauratrice. */
    await clickZoneAction(page, "adjust");
    await waitForZoneEditorRect(page);
    const beforeMove = JSON.stringify(await page.evaluate(() => window.__b2.anchors()["p-3"]));
    const rectBox = await page.locator("#workshopPdfZoneEditorRect").boundingBox();
    await page.mouse.move(rectBox.x + rectBox.width / 2, rectBox.y + rectBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rectBox.x + rectBox.width / 2 + 40, rectBox.y + rectBox.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    await page.click("#workshopZoneConfirmBtn");
    const moved = await page.evaluate(() => window.__b2.anchors()["p-3"]);
    assert.notEqual(JSON.stringify(moved), beforeMove, "déplacement confirmé");
    assert.ok(moved.x >= 0 && moved.y >= 0 && moved.x + moved.width <= 1 + 1e-9, "déplacement borné à la page");
    await clickZoneAction(page, "adjust");
    await waitForZoneEditorRect(page);
    const confirmed = JSON.stringify(await page.evaluate(() => window.__b2.anchors()["p-3"]));
    const cancelBox = await page.locator("#workshopPdfZoneEditorRect").boundingBox();
    await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cancelBox.x + cancelBox.width / 2 - 35, cancelBox.y + cancelBox.height / 2 - 15, { steps: 4 });
    await page.mouse.up();
    await page.click("#workshopZoneCancelBtn");
    assert.equal(JSON.stringify(await page.evaluate(() => window.__b2.anchors()["p-3"])), confirmed, "annulation d’ajustement restaure exactement la zone confirmée");

    /* Alignement sous zoom puis redimensionnement de fenêtre (1280 → 1440). */
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(0).click();
    await page.waitForFunction(() => window.__b2.pdfState().page === 1, undefined, { timeout: 4000 });
    await page.waitForFunction(() => !document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });
    await page.click("#workshopPdfZoomInBtn");
    await page.waitForTimeout(400);
    alignment = await zoneAlignment(page, "p-1");
    assert.ok(alignment.ok, `zone p-1 alignée après zoom (dx=${alignment.dx}, dy=${alignment.dy})`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    alignment = await zoneAlignment(page, "p-1");
    assert.ok(alignment.ok, `zone p-1 alignée après redimensionnement à 1440 px (dx=${alignment.dx}, dy=${alignment.dy})`);

    /* Navigation rapide : jamais de zone périmée sur une autre page. */
    await page.click("#workshopPdfNextBtn");
    await page.click("#workshopPdfNextBtn");
    await page.waitForFunction(() => window.__b2.pdfState().page === 3, undefined, { timeout: 4000 });
    assert.equal(await page.evaluate(() => document.getElementById("workshopPdfZone").hidden), true, "zone p-1 masquée sur la page 3 (pas de zone fantôme)");
    await page.click("#workshopPdfPrevBtn");
    await page.click("#workshopPdfPrevBtn");
    await page.waitForFunction(() => window.__b2.pdfState().page === 1, undefined, { timeout: 4000 });
    await page.waitForFunction(() => !document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });
    alignment = await zoneAlignment(page, "p-1");
    assert.ok(alignment.ok, `zone p-1 réalignée après navigation rapide (dx=${alignment.dx}, dy=${alignment.dy})`);

    /* Ancre périmée : non affichée, ajustement refusé, suppression autorisée
       sans perte de la transcription. */
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(3).click();
    await page.waitForFunction(() => document.getElementById("workshopPdfZone").hidden, undefined, { timeout: 4000 });
    await clickZoneAction(page, "adjust");
    assert.equal(await page.evaluate(() => window.__b2.toolActive()), false, "ajustement refusé sur une empreinte périmée");
    assert.ok(await page.evaluate(() => window.__b2.toasts().some(text => text.includes("version antérieure"))), "explication affichée");
    await clickZoneAction(page, "delete");
    await page.waitForFunction(() => window.__b2.anchors()["p-4"] === null, undefined, { timeout: 4000 });
    assert.equal(await page.evaluate(() => window.__b2.fields()["textIt:p-4"]), "marginalia antica", "suppression de zone sans perte de la transcription");
    assertNoB2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("B2 secours : PDF illisible → fallback natif explicite, aucune délimitation", { timeout: 120000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const { context, page, pageErrors } = await createB2Page(browser, server);
  try {
    await openB2Workshop(page, { fileData: corruptPdfDataUrl });
    await page.waitForFunction(() => {
      const message = document.getElementById("workshopPdfMessage");
      return message && !message.hidden && /interactif n’est pas disponible/.test(message.textContent);
    }, undefined, { timeout: 8000 });
    assert.equal(await page.locator("#workshopPdfFallback").isVisible(), true, "consultation de secours native affichée");
    assert.equal(await page.locator("#workshopPdfTools").isHidden(), true, "aucune pagination sans lecteur");
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();
    await page.click('[data-workshop-zone-action="draw"]');
    assert.equal(await page.evaluate(() => window.__b2.toolActive()), false, "aucune délimitation sans lecteur PDF");
    assertNoB2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("B2 mobile : tracé tactile depuis l’onglet Original, poignées et commandes accessibles", { timeout: 300000 }, async t => {
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
            const { context, page, pageErrors } = await createB2Page(browser, server, { width, height });
            try {
              await openB2Workshop(page, { official: false });
              await waitForPdfReady(page);
              /* Onglet Italien : carte active et action de délimitation. */
              await page.click("#workshopTabItalian");
              await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();
              assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="draw"]').count(), 1, "action de délimitation sur le passage actif");
              /* Depuis Italien : bascule automatique vers l'onglet Original. */
              await clickZoneAction(page, "draw");
              assert.equal(await page.evaluate(() => document.getElementById("workshopLayout").dataset.activePanel), "original", "bascule vers l’onglet Original");
              assert.equal(await page.evaluate(() => window.__b2.toolActive()), true, "mode de tracé actif");
              assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("workshopPdfTools")).pointerEvents), "auto", "pagination utilisable pendant le tracé");
              const actionsBox = await page.locator("#workshopZoneActions").boundingBox();
              assert.ok(actionsBox && actionsBox.height > 0 && actionsBox.y + actionsBox.height <= height + 1, "commandes accessibles dans le viewport");
              /* Tracé direct sur le canvas. */
              await dragOnCanvas(page, 0.2, 0.3, 0.6, 0.7);
              await waitForZoneEditorRect(page);
              assert.equal(await page.locator("#workshopZoneConfirmBtn").isEnabled(), true, "aperçu tactile : confirmation armée");
              await page.click("#workshopZoneConfirmBtn");
              const drawn = await page.evaluate(() => window.__b2.anchors()["p-2"]);
              assert.ok(drawn && drawn.pdfPage >= 1 && drawn.fileSha256.length === 64, "zone confirmée sur mobile");
              assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("workshopPdfTools")).pointerEvents), "auto", "pagination restaurée");
              /* Ajustement au doigt : poignées tactiles visibles. */
              await page.click("#workshopTabItalian");
              await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();
              await clickZoneAction(page, "adjust");
              await waitForZoneEditorRect(page);
              const handleBox = await page.locator('#workshopPdfZoneEditorRect [data-zone-handle="se"]').boundingBox();
              assert.ok(handleBox && handleBox.width >= 16 && handleBox.height >= 16, `poignée tactile visible (${handleBox?.width}px)`);
              await page.click("#workshopZoneCancelBtn");
              assert.equal(await page.evaluate(() => window.__b2.toolActive()), false, "annulation propre sur mobile");
              assertNoB2PageErrors(pageErrors);
            } finally {
              await context.close().catch(() => {});
            }
          });
        }
      } finally {
        await browser.close().catch(() => {});
      }
    }
    if (!ranAny) t.skip("Aucun navigateur disponible");
  } finally {
    await server.close().catch(() => {});
  }
});
