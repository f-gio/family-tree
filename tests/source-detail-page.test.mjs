import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const hooks = `
window.__sourcePageTest = {
  show(view = "genealogy") { $("authScreen").hidden = true; setView(view); },
  seed() {
    const firestoreTimestamp = { toDate() { return new Date("2024-01-01T00:00:00Z"); } };
    const source = {
      id: "source-page-fixture", title: "Registre paroissial — titre de démonstration très long pour vérifier le retour à la ligne",
      status: "active", category: "État civil", date: "1897", placeOrTerritory: "Palermo",
      holdingOrganization: "Archives communales", fondsSeries: "Registres paroissiaux", cote: "A-123", subCote: "B-4",
      archivalReferences: [{ label: "Folio", value: "18 verso" }], personIds: [], documentIds: ["document-page-fixture"],
      pages: [
        { id: "page-fixture", label: "Page 1", photographs: [
          { id: "photo-fixture", preview: { dataUrl: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" } },
          { id: "photo-fixture-2", preview: { dataUrl: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" } }
        ] },
        { id: "page-fixture-2", label: "Page 2", photographs: [] }
      ], passages: []
    };
    const documentItem = {
      id: "document-page-fixture", title: "Acte d’essai", fileName: "acte.txt", type: "Texte",
      mimeType: "text/plain", fileData: "data:text/plain;base64,SGVsbG8="
    };
    genealogyRecords = {
      sourceDocuments: [{ id: source.id, data: source }],
      sourceRevisions: [
        { id: "source-revision-timestamp", objectId: source.id, eventType: "source.created", createdAt: firestoreTimestamp, authorUid: "fixture-author" },
        { id: "source-revision-date", objectId: source.id, eventType: "source.revised", createdAt: new Date("2024-02-01T00:00:00Z") },
        { id: "source-revision-iso", objectId: source.id, eventType: "source.revised", createdAt: "2024-03-01T00:00:00.000Z" },
        { id: "source-revision-number", objectId: source.id, eventType: "source.revised", createdAt: 1711929600000 },
        { id: "source-revision-invalid", objectId: source.id, eventType: "source.revised", createdAt: "not-a-date" }
      ],
      transcriptionHeads: [{ id: "transcription-page-fixture", data: { id: "transcription-page-fixture", documentId: documentItem.id, pageId: "page-fixture", revisionId: "transcription-revision-fixture" } }],
      transcriptionRevisions: [{ id: "transcription-revision-fixture", data: { objectId: "transcription-page-fixture", data: { documentId: documentItem.id, pageId: "page-fixture", passages: [{ id: "passage-fixture", textIt: "Testo italiano", translationFr: "Texte français" }] } } }],
      genealogyProofs: [{ id: "proof-page-fixture", data: { id: "proof-page-fixture", factId: "fact-fixture", factType: "birth.date", documentId: source.id, relation: "supports", technicalStatus: "active", personIds: [] } }],
      genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: []
    };
    documents = [documentItem];
    loadedDocuments = true;
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin" };
    adminUsersCache = [{ id: "fixture-author", displayName: "Auteur de démonstration" }];
    renderGenealogyWorkspace();
  },
  openSource() { openGenealogyItem("source", "source-page-fixture"); },
  setSourceStatus(status) { genealogyRecords.sourceDocuments[0].data.status = status; refreshOpenSourcePage(); },
  async openDocumentThenSource() {
    setView("documents");
    await openStoredDocument(documents[0], "documents");
    openUnifiedSource("document-page-fixture", "source-page-fixture");
  },
  async openSourceDocument() { await openStoredDocument(documents[0], "source"); },
  returnSource() { returnFromSourcePage(); },
  state() {
    return {
      view: activeView,
      sourceVisible: !$('sourceDetailView').hidden,
      proofPageVisible: !$('proofDetailView').hidden,
      archivesVisible: !$('genealogyView').hidden,
      documentsVisible: !$('documentsView').hidden,
      workshopVisible: !$('transcriptionWorkshopView').hidden,
      viewerOpen: !$('documentDetailView').hidden,
      proofModalOpen: $('genealogyItemDialog').open,
      sourceTitle: $('sourcePageTitle').textContent,
      sourceReturn: sourcePageReturnContext ? { ...sourcePageReturnContext } : null,
      search: $('genealogySearch').value,
      filter: $('genealogyKindFilter').value,
      archiveContext: navigationContexts.load("genealogy"),
      scrollY: window.scrollY,
      actionLabels: [...(!$('sourcePageReviseBtn').hidden ? ["revise"] : []), ...$('sourcePageActionsMenu').querySelectorAll('[data-genealogy-item-action]')].map(button => typeof button === "string" ? button : button.dataset.genealogyItemAction),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      actionHeight: document.querySelector('#sourcePageActions > summary').getBoundingClientRect().height,
      reviseHeight: $("sourcePageReviseBtn").getBoundingClientRect().height,
      reviseY: $("sourcePageReviseBtn").getBoundingClientRect().y,
      menuY: document.querySelector('#sourcePageActions > summary').getBoundingClientRect().y,
      backHeight: $('sourcePageBackBtn').getBoundingClientRect().height,
      documentActionHeight: document.querySelector('[data-source-document-open]')?.getBoundingClientRect().height || 0,
      proofActionHeight: document.querySelector('#sourcePageContent [data-open-genealogy="proof"]')?.getBoundingClientRect().height || 0,
      transcriptionActionHeight: document.querySelector('#sourcePageContent [data-open-genealogy="transcription"]')?.getBoundingClientRect().height || 0,
      pageButtonHeight: document.querySelector('[data-source-page-select]')?.getBoundingClientRect().height || 0,
      photoButtonHeight: document.querySelector('[data-source-photo-select]')?.getBoundingClientRect().height || 0,
      imageToolHeight: document.querySelector('[data-source-page-zoom]')?.getBoundingClientRect().height || 0
    };
  }
};`;

test("la page Source conserve les parcours, les associations et l'ergonomie mobile", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 1280, height: 900 } });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      return route.fulfill({ response, body: `${await response.text()}\n${hooks}` });
    }
    return url.startsWith(server.baseURL) || url.includes("gstatic.com") ? route.continue() : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    try { await page.waitForFunction(() => typeof window.__sourcePageTest === "object", { timeout: 10000 }); }
    catch { throw new Error(`Hooks navigateur absents : ${errors.join(" | ")}`); }
    await page.evaluate(() => { window.__sourcePageTest.show(); window.__sourcePageTest.seed(); });

    /* Ouverture réelle depuis la tuile Archives et retour. */
    await page.locator('[data-genealogy-tile-id="source-page-fixture"]').evaluate(tile => tile.click());
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    assert.match(await page.locator("#sourcePageTitle").textContent(), /Registre paroissial/);
    assert.equal(await page.locator("#sourcePageBackBtn").getAttribute("aria-label"), "Retour aux Archives");
    const revisionHistory = await page.locator("#sourcePageContent .source-detail-history").innerText();
    assert.doesNotMatch(revisionHistory, /Invalid Date|fixture-author|source-revision-/);
    assert.match(revisionHistory, /Auteur de démonstration/);
    assert.match(revisionHistory, /Date non renseignée/);
    assert.equal(await page.locator("#sourcePageContent .source-detail-history time").count(), 5, "dates historiques rendues en éléments time");
    await page.click("#sourcePageBackBtn");
    await page.waitForFunction(() => document.getElementById("sourceDetailView").hidden);

    /* Archives → Source → Archives, filtres et défilement inclus. */
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "3200px";
      document.getElementById("genealogyView").append(spacer);
      document.getElementById("genealogySearch").value = "paroissial";
      document.getElementById("genealogyKindFilter").value = "sources";
      window.scrollTo({ top: 1100, behavior: "instant" });
    });
    const initialScroll = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.__sourcePageTest.openSource());
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    let state = await page.evaluate(() => window.__sourcePageTest.state());
    assert.equal(state.sourceVisible, true);
    assert.match(state.sourceTitle, /Registre paroissial/);
    assert.equal(await page.locator("#sourcePageBackBtn").getAttribute("aria-label"), "Retour aux Archives");
    assert.equal(await page.locator("#sourcePageTitle").getAttribute("aria-label"), state.sourceTitle, "titre complet accessible");
    assert.ok(await page.locator("#sourceDetailView header.dedicated-page-header").count(), "en-tête partagé de page dédiée");
    assert.ok(await page.getByText("Institution de conservation", { exact: true }).count());
    assert.ok(await page.locator("#sourcePageContent [data-source-document-open]").count(), "document associé consultable");
    assert.ok(await page.locator("#sourcePageImage").count(), "aperçu de photographie associé affiché");
    await page.locator('[data-source-page-select="page-fixture-2"]').click();
    assert.ok(await page.getByText("Aucune photographie n’est associée à cette page.", { exact: true }).count(), "page sans photo explicitement indiquée");
    await page.locator('[data-source-page-select="page-fixture"]').click();
    await page.locator('[data-source-photo-select="photo-fixture-2"]').click();
    assert.ok(await page.locator('#sourcePageContent [data-open-genealogy="transcription"]').count(), "transcription associée présentée");
    assert.ok(await page.locator('#sourcePageContent [data-open-genealogy="proof"]').count(), "preuve liée présentée");
    assert.ok(await page.locator("#sourcePageContent .source-detail-history li").count(), "historique disponible affiché");
    assert.ok(["revise", "source-archive", "delete-official", "transcribe"].every(action => state.actionLabels.includes(action)), "actions réservées à l'administrateur conservées");
    await page.evaluate(() => window.__sourcePageTest.setSourceStatus("archived"));
    assert.ok((await page.evaluate(() => window.__sourcePageTest.state())).actionLabels.includes("source-restore"), "action Restaurer disponible pour une source archivée");
    await page.evaluate(() => window.__sourcePageTest.setSourceStatus("active"));
    await page.click("#sourcePageBackBtn");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(100);
    state = await page.evaluate(() => window.__sourcePageTest.state());
    assert.equal(state.archivesVisible, true, "retour à Archives");
    assert.equal(state.search, "paroissial");
    assert.equal(state.filter, "sources");
    assert.equal(state.archiveContext.scrollY, initialScroll, "position mémorisée avant la navigation");
    assert.ok(Math.abs(state.scrollY - initialScroll) <= 2, `défilement Archives restauré (${state.scrollY}, départ ${initialScroll})`);

    /* Source → Document → retour à la Source : la page Document remplace la
       Source, son Retour restaure la Source avec son contexte. */
    await page.evaluate(() => window.__sourcePageTest.openSource());
    await page.locator("#sourcePageContent [data-source-document-open]").click();
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    assert.equal(await page.locator("#documentPageBackBtn").getAttribute("aria-label"), "Retour à la Source");
    state = await page.evaluate(() => window.__sourcePageTest.state());
    assert.equal(state.sourceVisible, false, "la page Document remplace la page Source");
    assert.equal(state.viewerOpen, true, "lecteur de document affiché");
    await page.click("#documentPageBackBtn");
    await page.waitForFunction(() => document.getElementById("documentDetailView").hidden);
    assert.equal((await page.evaluate(() => window.__sourcePageTest.state())).sourceVisible, true, "retour direct à la Source");

    /* Source → Preuve → Source : retour contextuel vers la page Source. */
    await page.locator('#sourcePageContent [data-open-genealogy="proof"]').click();
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    assert.equal(await page.locator("#proofPageBackBtn").getAttribute("aria-label"), "Retour à la Source");
    state = await page.evaluate(() => window.__sourcePageTest.state());
    assert.equal(state.proofPageVisible, true, "page Preuve affichée");
    assert.equal(state.sourceVisible, false, "la Source est remplacée par la page Preuve");
    await page.click("#proofPageBackBtn");
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    assert.equal((await page.evaluate(() => window.__sourcePageTest.state())).sourceVisible, true, "retour à la page Source");

    /* Document → Source → Document : le bouton Retour rouvre le document appelant. */
    await page.evaluate(() => window.__sourcePageTest.openDocumentThenSource());
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    state = await page.evaluate(() => window.__sourcePageTest.state());
    assert.equal(state.sourceReturn?.kind, "document");
    assert.equal(state.viewerOpen, false, "le document appelant est remplacé par la page Source");
    await page.click("#sourcePageBackBtn");
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    state = await page.evaluate(() => window.__sourcePageTest.state());
    assert.equal(state.viewerOpen, true, "retour au document appelant");
    await page.click("#documentPageBackBtn");
    await page.waitForFunction(() => document.getElementById("documentDetailView").hidden);

    /* Source → Atelier → retour à la Source, sans altérer son contexte. */
    await page.evaluate(() => window.__sourcePageTest.show("genealogy"));
    await page.evaluate(() => window.__sourcePageTest.openSource());
    await page.click("#sourcePageActions > summary");
    await page.click('#sourcePageActionsMenu [data-genealogy-item-action="transcribe"]');
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    await page.click("#workshopBackBtn");
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    assert.equal((await page.evaluate(() => window.__sourcePageTest.state())).sourceVisible, true, "retour atelier à la Source");
    await page.click("#sourcePageActions > summary");
    await page.click('#sourcePageActionsMenu [data-genealogy-item-action="transcribe"]');
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    await page.goBack();
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    assert.equal((await page.evaluate(() => window.__sourcePageTest.state())).sourceVisible, true, "retour navigateur atelier à la Source");

    /* Révision inchangée : le formulaire existant s'ouvre au-dessus de la page. */
    await page.click("#sourcePageActions > summary");
    await page.click("#sourcePageReviseBtn");
    await page.waitForSelector("#genealogyContributionDialog[open]");
    assert.equal((await page.evaluate(() => window.__sourcePageTest.state())).sourceVisible, true);
    await page.locator('#genealogyContributionDialog [data-close="genealogyContributionDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open);

    /* Mobile : pas de débordement horizontal, header/actions atteignent 44 px. */
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.__sourcePageTest.openSource());
      state = await page.evaluate(() => window.__sourcePageTest.state());
      assert.equal(state.horizontalOverflow, false, `aucun défilement horizontal à ${width}px`);
       assert.ok(state.actionHeight >= 44, `cible tactile menu à ${width}px (${state.actionHeight}px)`);
       assert.ok(state.backHeight >= 44, `cible tactile Retour à ${width}px (${state.backHeight}px)`);
       assert.ok(state.reviseHeight >= 44, `action Réviser visible à ${width}px (${state.reviseHeight}px)`);
       assert.ok(Math.abs(state.reviseY - state.menuY) <= 1, `Réviser et menu sur la même rangée à ${width}px`);
      assert.ok(state.documentActionHeight >= 44, `cible tactile document à ${width}px (${state.documentActionHeight}px)`);
      assert.ok(state.proofActionHeight >= 44, `cible tactile preuve à ${width}px (${state.proofActionHeight}px)`);
      assert.ok(state.transcriptionActionHeight >= 44, `cible tactile transcription à ${width}px (${state.transcriptionActionHeight}px)`);
      assert.ok(state.pageButtonHeight >= 44, `cible tactile navigation page à ${width}px (${state.pageButtonHeight}px)`);
      assert.ok(state.photoButtonHeight >= 44, `cible tactile navigation photo à ${width}px (${state.photoButtonHeight}px)`);
      assert.ok(state.imageToolHeight >= 44, `cible tactile zoom à ${width}px (${state.imageToolHeight}px)`);
    }
    assert.deepEqual(errors, [], `erreurs JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
