import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";
import { WORKSHOP_ZONE_MIN_SIZE } from "../js/transcription-workshop.js";

/* Lot B1 : délimitation graphique des passages sur photographie JPEG.
   Le modèle d'ancrage existant { shape, photographId, x, y, width, height }
   (normalisé 0..1) est le seul stocké ; les tests vérifient qu'aucune
   coordonnée temporaire n'est écrite avant confirmation, que les autres
   passages et les textes sont intacts, et que le rectangle reste aligné sur
   l'image affichée (zoom et redimensionnement). */

const TEST_SVG = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="#d9cfbf"/><text x="40" y="115" font-size="44" fill="#3d3227">Anno 1891</text></svg>');
const JPEG_DATA = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDEQE/Aqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQY/Aqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAQYP/Aqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAwYP/Aqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAQM/Aqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDEQM/Aqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQY/8QAFBABAAAAAAAAAAAAAAAAAAAAID/9oACAEBAAAAEP//Z";

const HOOKS = `
window.__b1 = {
  passagesFixture() {
    return [
      { id: "p-1", order: 0, textIt: "Anno millenovecento", translationFr: "L’année mille neuf cent", separatorAfter: "", unreadable: false, hypotheses: [], anchor: { shape: "rect", photographId: "photo-1", x: 0.1, y: 0.1, width: 0.3, height: 0.2 }, lineLabel: "l. 1", translationState: "current" },
      { id: "p-2", order: 1, textIt: "indici di Orino", translationFr: null, separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 2", translationState: "not-started" }
    ];
  },
  show() { $("authScreen").hidden = true; $("topbar").hidden = false; setView("directory"); },
  seed() {
    const documentItem = {
      id: "doc-b1", title: "Registre Transactions B1",
      type: "Registre", date: "1891-05-12",
      fileName: "registre.jpg", mimeType: "image/jpeg",
      fileData: "${JPEG_DATA}",
      personIds: [],
      pages: [{
        id: "page-b1", label: "Folio 1",
        photographs: [{ id: "photo-1", role: "full", preview: { dataUrl: "${TEST_SVG}" } }],
        passages: window.__b1.passagesFixture()
      }]
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
    const passages = JSON.parse(JSON.stringify(window.__b1.passagesFixture()));
    genealogyRecords.transcriptionHeads = [{
      id: "tx-b1-head",
      data: {
        documentId: "doc-b1", pageId: "page-b1", passages,
        transcriptionIt: "Anno millenovecento\\\\nindici di Orino",
        translationFr: "L’année mille neuf cent",
        changeKind: "initial", justification: "Validation de la transcription",
        authorUid: "admin-seed", previousRevisionId: null
      },
      version: 1, revisionId: "tx-b1-rev1",
      createdAt: new Date("2026-10-20T10:00:00Z"), createdBy: "admin-seed",
      updatedAt: new Date("2026-10-20T10:00:00Z"), updatedBy: "admin-seed",
      eventId: "tx-b1-ev1"
    }];
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
  toolActive() { return Boolean(workshopZoneTool); }
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

async function createB1Page(browser, server, { width = 1280, height = 900 } = {}) {
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
  await page.waitForFunction(() => typeof window.__b1 === "object");
  return { context, page, pageErrors };
}

function assertNoB1PageErrors(pageErrors) {
  const relevant = pageErrors.filter(message => /workshop|transcription|zone|anchor/i.test(message));
  assert.deepEqual(relevant, [], `aucune erreur applicative (${relevant.join(" | ")})`);
}

async function openB1Workshop(page, { official = false } = {}) {
  await page.evaluate(hasOfficial => {
    window.__b1.show();
    window.__b1.seed();
    if (hasOfficial) window.__b1.seedOfficial();
    window.__b1.openDoc();
  }, official);
  /* Sur mobile, le volet Informations est replié par défaut : la bascule réelle
     est cliquée jusqu'à ouverture stable (le rendu asynchrone de la fiche peut
     refermer le volet une dernière fois). Le défilement automatique déclenché
     par le clic réel est sans effet sur les mesures. */
  await page.waitForSelector("#viewerDetailsBtn", { state: "attached" });
  await page.waitForFunction(() => {
    const toggle = document.getElementById("viewerDetailsBtn");
    if (toggle.getAttribute("aria-expanded") === "false") {
      toggle.click();
      return false;
    }
    return Boolean(document.querySelector("#viewerDocumentDetails [data-transcribe-document]"));
  }, undefined, { timeout: 8000 });
  await page.waitForSelector("#viewerDocumentDetails [data-transcribe-document]", { state: "visible" });
  await page.evaluate(() => { window.__b1.useAdminProfile(); window.__b1.transcribe(); });
  await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
}

async function waitForImage(page) {
  await page.waitForFunction(() => {
    const image = document.getElementById("workshopPageImage");
    return image && !image.hidden && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0;
  });
}

function norm(value) { return Math.round(value * 10000) / 10000; }

test("B1 consultation : zone du passage actif affichée, aucun contrôle d’édition", { timeout: 120000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const { context, page, pageErrors } = await createB1Page(browser, server);
  try {
    await openB1Workshop(page, { official: true });
    assert.equal(await page.evaluate(() => window.__b1.status()), "Consultation officielle · v1", "ouverture en consultation de la version officielle");
    assert.equal(await page.locator("[data-workshop-zone-action]").count(), 0, "aucun contrôle de délimitation en consultation");
    await waitForImage(page);
    await page.waitForFunction(() => !document.getElementById("workshopZone").hidden, undefined, { timeout: 4000 });
    const alignment = await page.evaluate(() => {
      const image = document.getElementById("workshopPageImage").getBoundingClientRect();
      const zone = document.getElementById("workshopZone").getBoundingClientRect();
      return { image: { x: image.x, y: image.y, w: image.width, h: image.height }, zone: { x: zone.x, y: zone.y, w: zone.width, h: zone.height } };
    });
    assert.ok(Math.abs(alignment.zone.x - (alignment.image.x + 0.1 * alignment.image.w)) <= 2, "zone alignée sur l’image affichée (x)");
    assert.ok(Math.abs(alignment.zone.w - 0.3 * alignment.image.w) <= 2, "largeur de zone proportionnelle à l’image");
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();
    await page.waitForFunction(() => document.getElementById("workshopZone").hidden, undefined, { timeout: 2000 }, "passage sans zone : aucun rectangle fictif");
    assert.equal(await page.locator("[data-workshop-zone-action]").count(), 0, "toujours aucun contrôle sans zone en consultation");
    assert.equal(await page.evaluate(() => window.__b1.anchors()["p-1"].photographId), "photo-1", "consultation sans écriture de la zone officielle");
    assertNoB1PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("B1 édition : tracé, confirmation, annulation, ajustement, suppression et alignement", { timeout: 180000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const { context, page, pageErrors } = await createB1Page(browser, server, { width: 1280, height: 900 });
  try {
    await openB1Workshop(page, { official: false });
    await waitForImage(page);
    const originalAnchors = await page.evaluate(() => window.__b1.anchors());

    /* Action présente uniquement sur le passage ACTIF. */
    assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="adjust"]').count(), 1, "passage avec zone : « Ajuster » sur la carte active");
    assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="delete"]').count(), 1, "passage avec zone : « Supprimer la zone » sur la carte active");
    assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="draw"]').count(), 0, "pas de tracé proposé quand une zone existe");
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();
    assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="draw"]').count(), 1, "passage sans zone : « Délimiter ce passage »");
    assert.equal(await page.locator(".transcription-workshop-passage:not(.is-selected) [data-workshop-zone-action]").count(), 0, "aucune action de zone sur les cartes non actives");
    await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();

    /* Tracé : cliquer-glisser sur la photographie. */
    await page.click('[data-workshop-zone-action="draw"]');
    assert.equal(await page.evaluate(() => window.__b1.toolActive()), true, "mode de tracé activé");
    assert.equal(await page.evaluate(() => document.getElementById("workshopPanelOriginal").classList.contains("is-zone-editing")), true, "panneau photographie en mode tracé");
    assert.equal(await page.locator("#workshopZoneActions").isVisible(), true, "Annuler / Confirmer affichés sous la photographie");
    assert.equal(await page.locator("#workshopZoneConfirmBtn").isDisabled(), true, "confirmation indisponible sans rectangle");
    assert.equal(await page.locator("#workshopZoneEditor").isVisible(), true, "surface de tracé visible sur l’image");
    assert.equal(await page.locator("#workshopZoneEditorRect").isHidden(), true, "aucun rectangle avant le glisser");
    const imageBox = await page.locator("#workshopPageImage").boundingBox();
    assert.ok(imageBox && imageBox.width > 100, "photographie affichée pour le tracé");
    const x0 = imageBox.x + imageBox.width * 0.2;
    const y0 = imageBox.y + imageBox.height * 0.25;
    const x1 = imageBox.x + imageBox.width * 0.55;
    const y1 = imageBox.y + imageBox.height * 0.65;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 4 });
    await page.mouse.up();
    assert.equal(await page.locator("#workshopZoneEditorRect").isVisible(), true, "aperçu du rectangle pendant le tracé");
    assert.equal(await page.locator("#workshopZoneConfirmBtn").isEnabled(), true, "confirmation disponible après tracé");
    assert.equal(await page.evaluate(() => window.__b1.anchors()["p-2"]), null, "aucune écriture avant la confirmation");

    /* Annulation : rien n'est conservé. */
    await page.click("#workshopZoneCancelBtn");
    assert.equal(await page.evaluate(() => window.__b1.toolActive()), false, "mode de tracé abandonné");
    assert.equal(await page.locator("#workshopZoneEditor").isHidden(), true, "éditeur masqué après annulation");
    assert.equal(await page.locator("#workshopZoneActions").isHidden(), true, "commandes masquées après annulation");
    assert.equal(await page.evaluate(() => window.__b1.anchors()["p-2"]), null, "annulation sans aucune écriture");

    /* Tracé puis confirmation : coordonnées normalisées + photographie. */
    await page.click('[data-workshop-zone-action="draw"]');
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 6 });
    await page.mouse.up();
    await page.click("#workshopZoneConfirmBtn");
    const drawn = await page.evaluate(() => window.__b1.anchors()["p-2"]);
    assert.equal(drawn.shape, "rect", "modèle rectangle existant");
    assert.equal(drawn.photographId, "photo-1", "zone rattachée à la photographie affichée");
    assert.ok(drawn.width >= WORKSHOP_ZONE_MIN_SIZE && drawn.height >= WORKSHOP_ZONE_MIN_SIZE, "taille minimale respectée");
    assert.ok(drawn.x >= 0 && drawn.y >= 0 && norm(drawn.x + drawn.width) <= 1 && norm(drawn.y + drawn.height) <= 1, "zone contenue dans l’image normalisée");
    assert.deepEqual(await page.evaluate(() => window.__b1.anchors()["p-1"]), originalAnchors["p-1"], "la zone des autres passages n’a jamais bougé");
    assert.equal(await page.evaluate(() => window.__b1.fields()["textIt:p-2"]), "indici di Orino", "texte du passage conservé");
    await page.waitForFunction(() => window.__b1.status() === "Enregistré sur cet appareil", undefined, { timeout: 8000 });
    const storedAnchor = await page.evaluate(() => {
      const stored = window.__b1.stored();
      if (!stored.length) return null;
      const snapshot = JSON.parse(stored[0][1]).snapshot;
      return snapshot.passages.find(passage => passage.id === "p-2")?.anchor || null;
    });
    assert.ok(storedAnchor && storedAnchor.shape === "rect", "zone présente dans le brouillon sauvegardé localement");
    assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="adjust"]').count(), 1, "carte basculée sur « Ajuster » après confirmation");

    /* Ajustement : déplacement par la zone, borné et confirmé. */
    const confirmed = await page.evaluate(() => window.__b1.anchors()["p-2"]);
    await page.click('[data-workshop-zone-action="adjust"]');
    await page.waitForFunction(() => document.getElementById("workshopZoneEditorRect") && !document.getElementById("workshopZoneEditorRect").hidden);
    const rectBox = await page.locator("#workshopZoneEditorRect").boundingBox();
    await page.mouse.move(rectBox.x + rectBox.width / 2, rectBox.y + rectBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rectBox.x + rectBox.width / 2 + 40, rectBox.y + rectBox.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    await page.click("#workshopZoneConfirmBtn");
    const moved = await page.evaluate(() => window.__b1.anchors()["p-2"]);
    assert.ok(Math.abs(moved.width - confirmed.width) < 0.01 && Math.abs(moved.height - confirmed.height) < 0.01, "déplacement sans déformation");
    assert.ok(Math.abs(moved.x - confirmed.x) > 0.01 || Math.abs(moved.y - confirmed.y) > 0.01, "position réellement déplacée");
    assert.ok(moved.x >= 0 && norm(moved.x + moved.width) <= 1, "déplacement borné à l’image");

    /* Annulation d’un ajustement : restaure exactement la zone confirmée. */
    await page.click('[data-workshop-zone-action="adjust"]');
    await page.waitForFunction(() => document.getElementById("workshopZoneEditorRect") && !document.getElementById("workshopZoneEditorRect").hidden);
    const beforeCancel = JSON.stringify(await page.evaluate(() => window.__b1.anchors()["p-2"]));
    const cancelRectBox = await page.locator("#workshopZoneEditorRect").boundingBox();
    await page.mouse.move(cancelRectBox.x + cancelRectBox.width / 2, cancelRectBox.y + cancelRectBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cancelRectBox.x + cancelRectBox.width / 2 - 30, cancelRectBox.y + cancelRectBox.height / 2 - 15, { steps: 4 });
    await page.mouse.up();
    await page.click("#workshopZoneCancelBtn");
    assert.equal(JSON.stringify(await page.evaluate(() => window.__b1.anchors()["p-2"])), beforeCancel, "annulation d’ajustement restaure exactement la zone précédente");

    /* Redimensionnement par poignée + limitation aux bords. */
    await page.click('[data-workshop-zone-action="adjust"]');
    await page.waitForFunction(() => document.getElementById("workshopZoneEditorRect") && !document.getElementById("workshopZoneEditorRect").hidden);
    const seBox = await page.locator('#workshopZoneEditorRect [data-zone-handle="se"]').boundingBox();
    assert.ok(seBox && seBox.width >= 12, "poignée visible");
    await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(seBox.x + seBox.width / 2 + 50, seBox.y + seBox.height / 2 + 15, { steps: 4 });
    await page.mouse.up();
    await page.click("#workshopZoneConfirmBtn");
    const resized = await page.evaluate(() => window.__b1.anchors()["p-2"]);
    assert.ok(resized.width > moved.width || resized.height > moved.height, "redimensionnement effectif");
    assert.ok(resized.x >= 0 && resized.y >= 0 && norm(resized.x + resized.width) <= 1 && norm(resized.y + resized.height) <= 1, "redimensionnement contenu dans l’image");
    await page.click('[data-workshop-zone-action="adjust"]');
    await page.waitForFunction(() => document.getElementById("workshopZoneEditorRect") && !document.getElementById("workshopZoneEditorRect").hidden);
    const nwBox = await page.locator('#workshopZoneEditorRect [data-zone-handle="nw"]').boundingBox();
    await page.mouse.move(nwBox.x + nwBox.width / 2, nwBox.y + nwBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(imageBox.x - 200, imageBox.y - 200, { steps: 5 });
    await page.mouse.up();
    await page.click("#workshopZoneConfirmBtn");
    const clamped = await page.evaluate(() => window.__b1.anchors()["p-2"]);
    assert.ok(clamped.x >= 0 && clamped.y >= 0 && clamped.width >= WORKSHOP_ZONE_MIN_SIZE, "poignée tirée hors image : rectangle ramené dans les bornes");
    assert.ok(norm(clamped.x + clamped.width) <= 1 && norm(clamped.y + clamped.height) <= 1, "bornes après clampage");

    /* Alignement sous zoom puis redimensionnement de fenêtre (1280 → 1440). */
    const expectedAlignment = async () => page.evaluate(() => {
      const anchor = window.__b1.anchors()["p-2"];
      const image = document.getElementById("workshopPageImage").getBoundingClientRect();
      const zone = document.getElementById("workshopZone").getBoundingClientRect();
      return { anchor: { ...anchor }, image: { x: image.x, y: image.y, w: image.width, h: image.height }, zone: { x: zone.x, y: zone.y, w: zone.width, h: zone.height } };
    });
    await page.waitForFunction(() => !document.getElementById("workshopZone").hidden, undefined, { timeout: 2000 });
    await page.click('#workshopImageTools [data-viewer-image-zoom="in"]');
    await page.waitForTimeout(300);
    let aligned = await expectedAlignment();
    assert.ok(Math.abs(aligned.zone.x - (aligned.image.x + aligned.anchor.x * aligned.image.w)) <= 2, `zone alignée après zoom (Δ=${(aligned.zone.x - (aligned.image.x + aligned.anchor.x * aligned.image.w)).toFixed(1)}px)`);
    assert.ok(Math.abs(aligned.zone.w - aligned.anchor.width * aligned.image.w) <= 2, "largeur alignée après zoom");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(250);
    aligned = await expectedAlignment();
    assert.ok(Math.abs(aligned.zone.x - (aligned.image.x + aligned.anchor.x * aligned.image.w)) <= 2, "zone alignée après redimensionnement de fenêtre à 1440 px");

    /* Suppression : association retirée, transcription intacte. */
    await page.click('[data-workshop-zone-action="delete"]');
    await page.waitForFunction(() => window.__b1.anchors()["p-2"] === null, undefined, { timeout: 4000 });
    assert.equal(await page.evaluate(() => window.__b1.fields()["textIt:p-2"]), "indici di Orino", "suppression de zone sans perte de la transcription");
    assert.deepEqual(await page.evaluate(() => window.__b1.anchors()["p-1"]), originalAnchors["p-1"], "la zone des autres passages est intacte après suppression");
    assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="draw"]').count(), 1, "retour à « Délimiter ce passage »");
    assertNoB1PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("B1 mobile : tracé au doigt depuis l’onglet Original, poignées et A3 préservés", { timeout: 300000 }, async t => {
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
            const { context, page, pageErrors } = await createB1Page(browser, server, { width, height });
            try {
              await openB1Workshop(page, { official: false });
              await waitForImage(page);
              /* Onglet Italien : carte active et action de délimitation. */
              await page.click("#workshopTabItalian");
              await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();
              assert.equal(await page.locator('.transcription-workshop-passage.is-selected [data-workshop-zone-action="draw"]').count(), 1, "action de délimitation sur le passage actif");
              /* Clic depuis Italien : bascule vers l'onglet Original pour le tracé. */
              await page.click('[data-workshop-zone-action="draw"]');
              assert.equal(await page.evaluate(() => document.getElementById("workshopLayout").dataset.activePanel), "original", "bascule automatique vers l’onglet Original");
              assert.equal(await page.evaluate(() => window.__b1.toolActive()), true, "mode de tracé actif");
              assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("workshopImageTools")).pointerEvents), "none", "gestes d’image neutralisés pendant le tracé");
              const actionsBox = await page.locator("#workshopZoneActions").boundingBox();
              assert.ok(actionsBox && actionsBox.height > 0, "commandes du tracé accessibles");
              assert.ok(actionsBox.y + actionsBox.height <= height + 1, "commandes sans recouvrir la zone de travail (dans le viewport)");
              /* Tracé direct sur l'image. */
              const imageBox = await page.locator("#workshopPageImage").boundingBox();
              assert.ok(imageBox && imageBox.width > 80, "photographie affichée");
              const x0 = imageBox.x + imageBox.width * 0.2;
              const y0 = imageBox.y + imageBox.height * 0.3;
              const x1 = imageBox.x + imageBox.width * 0.6;
              const y1 = imageBox.y + imageBox.height * 0.7;
              await page.mouse.move(x0, y0);
              await page.mouse.down();
              await page.mouse.move(x1, y1, { steps: 6 });
              await page.mouse.up();
              await page.click("#workshopZoneConfirmBtn");
              const drawn = await page.evaluate(() => window.__b1.anchors()["p-2"]);
              assert.ok(drawn && drawn.shape === "rect" && drawn.photographId === "photo-1", "zone confirmée sur mobile");
              /* Hors tracé : comportement de consultation et de zoom rétabli. */
              assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("workshopImageTools")).pointerEvents), "auto", "gestes d’image rétablis après confirmation");
              const zoomBefore = await page.evaluate(() => document.getElementById("workshopPageImage").getBoundingClientRect().width);
              await page.click('#workshopImageTools [data-viewer-image-zoom="in"]');
              await page.waitForTimeout(150);
              const zoomAfter = await page.evaluate(() => document.getElementById("workshopPageImage").getBoundingClientRect().width);
              assert.ok(zoomAfter > zoomBefore, "zoom fonctionnel hors mode tracé");
              /* Ajustement : poignées tactiles visibles puis Annuler. */
              await page.click("#workshopTabItalian");
              await page.locator("#workshopPassagePills [data-workshop-passage-select]").nth(1).click();
              await page.click('[data-workshop-zone-action="adjust"]');
              assert.equal(await page.evaluate(() => document.getElementById("workshopLayout").dataset.activePanel), "original", "ajustement depuis l’onglet Original");
              await page.waitForFunction(() => {
                const rect = document.getElementById("workshopZoneEditorRect");
                return rect && !rect.hidden;
              });
              const handleBox = await page.locator('#workshopZoneEditorRect [data-zone-handle="se"]').boundingBox();
              assert.ok(handleBox && handleBox.width >= 16 && handleBox.height >= 16, `poignée tactile visible (${handleBox?.width}px)`);
              await page.click("#workshopZoneCancelBtn");
              assert.equal(await page.evaluate(() => window.__b1.toolActive()), false, "annulation propre sur mobile");
              assertNoB1PageErrors(pageErrors);
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
