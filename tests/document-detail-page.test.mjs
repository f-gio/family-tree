import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const svg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="#b8c9be"/></svg>');

const hooks = `
window.__documentPageTest = {
  show(view = "genealogy") { $("authScreen").hidden = true; $("topbar").hidden = false; setView(view); },
  seed() {
    const documentItem = {
      id: "doc-page-fixture", title: "Registre de consultation paroissial de la commune de Palermo — année 1891",
      type: "Registre", date: "1891-05-12",
      fileName: "registre.jpg", mimeType: "image/jpeg",
      fileData: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEQAD8kf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIDAT8kf//Z",
      personIds: ["doc-person-fixture"],
      pages: [{ id: "doc-page-1", label: "Folio 1", photographs: [{ id: "doc-photo-1", preview: { dataUrl: "${svg}" } }] }]
    };
    const sourceData = { id: "doc-source-fixture", title: "Source du registre", status: "active", documentIds: [documentItem.id], personIds: ["doc-person-fixture"] };
    const proofData = { id: "doc-proof-fixture", factId: "fact-doc", factType: "birth", personIds: ["doc-person-fixture"], documentId: documentItem.id, relation: "supports", technicalStatus: "active", sourceValue: "1891", citationIt: { textIt: "Nato nel 1891" }, citationFr: { textIt: "Nato nel 1891", translationFr: "Né en 1891" } };
    people = [{ id: "doc-person-fixture", firstName: "Ada Maria Costanza Vittoria", lastName: "Consultazione Genealogica Internazionale", birthDate: "1890", deathDate: "1960", place: "", deathPlace: "", partnerIds: [], childIds: [], inTree: true }];
    documents = [documentItem];
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = loadedProcedures = true;
    genealogyRecords = {
      sourceDocuments: [{ id: sourceData.id, data: sourceData }],
      sourceRevisions: [],
      transcriptionHeads: [], transcriptionRevisions: [],
      genealogyProofs: [{ id: proofData.id, data: proofData }],
      genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: []
    };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin" };
    renderGenealogyWorkspace();
  },
  openFromDirectory() {
    setView("directory");
    openStoredDocument(documents[0], "directory");
  },
  async openHeaderDocument(type = "Registre", title = undefined) {
    documents[0].type = type;
    if (title !== undefined) documents[0].title = title;
    await openStoredDocument(documents[0], "directory");
  },
  openHeaderSource() {
    closeDocumentPage();
    const item = genealogyWorkspaceItems().find(value => value.kind === "source" && value.record.id === "doc-source-fixture");
    if (item) renderSourcePage(item, { kind: "view", view: "documents" });
  },
  openHeaderProof() {
    closeDocumentPage();
    const item = genealogyWorkspaceItems().find(value => value.kind === "proof" && value.record.id === "doc-proof-fixture");
    if (item) renderProofPage(item, { kind: "view", view: "documents" });
  },
  async openFromPerson() {
    /* Chemin réel : fiche Personne → document mini-carte → visionneuse. */
    setView("directory");
    openPerson(people[0], "directory");
    setPersonSection("documents");
    $("firstName").value = "Ada modifiée";
    await openStoredDocument(documents[0], "person");
  },
  /* Le callback d'authentification peut vider les collections après le seed
     initial : on restaure le fixture juste avant l'ouverture, sans modifier
     les assertions de parcours. */
  ensureSeed() {
    if (!documents.length || !people.length || !genealogyRecords.sourceDocuments.length) this.seed();
  },
  debug() {
    return {
      view: activeView,
      authHidden: $("authScreen").hidden,
      syncText: $("syncText").textContent,
      documentsCount: documents.length,
      sourceCount: genealogyRecords.sourceDocuments.length,
      documentHidden: $("documentDetailView").hidden
    };
  },
  openFromArchives() {
    /* Chemin exact de l'action « Consulter » d'une fiche historique. */
    this.ensureSeed();
    const item = genealogyWorkspaceItems().find(value => value.kind === "legacy-source" && value.record.id === "doc-page-fixture");
    if (item) openGenealogyItem(item.kind, item.record.id);
    else openStoredDocument(documents[0], "archives");
  },
  openSourceFromPage() { openUnifiedSource("doc-page-fixture", "doc-source-fixture"); },
  openProofFromPage() { openUnifiedProof("doc-page-fixture", "doc-proof-fixture"); },
  transcribe() {
    const button = document.querySelector("#viewerDocumentDetails [data-transcribe-document]");
    if (button) button.click();
  },
  standalone(withPages = false) {
    documents[0].pages = withPages ? [{ id: "doc-page-direct", label: "Page 1", photographs: [{ id: "doc-photo-direct", preview: { dataUrl: "${svg}" } }] }] : [];
    genealogyRecords.sourceDocuments = [];
    genealogyRecords.genealogyProofs = [];
    genealogyCollectionErrors.delete("sourceDocuments");
    openStoredDocument(documents[0], "directory");
  },
  state() {
    return {
      view: activeView,
      pageVisible: !$("documentDetailView").hidden,
      sourceVisible: !$("sourceDetailView").hidden,
      proofVisible: !$("proofDetailView").hidden,
      personOpen: $("personDialog").open,
      workshopVisible: !$("transcriptionWorkshopView").hidden,
      archiveVisible: !$("genealogyView").hidden,
      directoryVisible: !$("directoryView").hidden,
      title: $("viewerTitle").textContent,
      titleLabel: $("viewerTitle").getAttribute("aria-label"),
      documentPageCount: documents[0]?.pages?.length || 0,
      documentsCount: documents.length,
      sourceCount: genealogyRecords.sourceDocuments.length,
      proofCount: genealogyRecords.genealogyProofs.length,
      returnContext: documentPageReturnContext ? { ...documentPageReturnContext } : null,
      search: $("genealogySearch").value,
      filter: $("genealogyKindFilter").value,
      scrollY: window.scrollY,
      personName: $("firstName").value,
      personSection: activePersonSection,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      backHeight: $("documentMobileBackBtn").getBoundingClientRect().height,
      backLabel: $("documentMobileBackBtn").getAttribute("aria-label"),
      backVisibleLabel: (() => {
        const label = document.getElementById("documentPageBackBtn")?.querySelector(".dedicated-page-back-label");
        return label && label.getClientRects().length ? label.textContent : "";
      })(),
      mobileHeaderVisible: (() => { const header = $("documentMobileHeader"); return getComputedStyle(header).display !== "none" && header.getBoundingClientRect().height > 0; })(),
      mobileBackHeight: $("documentMobileBackBtn").getBoundingClientRect().height,
      mobileTitleCenterDelta: (() => { const box = $("documentMobileHeader").querySelector("strong").getBoundingClientRect(); return Math.round((box.left + box.right) / 2 - innerWidth / 2); })(),
      mobileMenuCenterDelta: (() => { const button = document.querySelector("#documentMobileActionsSlot .tile-context-toggle"); if (!button) return null; const box = button.getBoundingClientRect(); const back = $("documentMobileBackBtn").getBoundingClientRect(); return Math.round((back.left + back.right + box.left + box.right) / 2 - innerWidth); })(),
      contentBackDisplay: (() => {
        const row = document.querySelector("#documentDetailView .document-detail-return-row");
        return row ? getComputedStyle(row).display : "none";
      })(),
      desktopBackPresent: !!$("documentPageBackBtn"),
      backInsideHeader: !!document.querySelector("#documentMobileHeader #documentMobileBackBtn"),
      backUnderActions: true,
      backRightAligned: true,
      documentActionMenuVisible: !!document.querySelector("#documentPageActionsHost .document-actions-menu, #documentMobileActionsSlot .document-actions-menu"),
      documentActionMenuClosed: !document.querySelector("#documentPageActionsHost #documentPageActions[open], #documentMobileActionsSlot #documentPageActions[open]"),
      documentActionCount: document.querySelectorAll("#documentPageActionsHost [data-document-page-action], #documentMobileActionsSlot [data-document-page-action]").length,
      documentDownloadAvailable: !!document.querySelector('#documentPageActionsHost [data-document-page-action="download"], #documentMobileActionsSlot [data-document-page-action="download"]'),
      tileMenuOpen: $("documentPageActions")?.open || false,
      returnRowPresent: !!document.querySelector("#documentDetailView .document-detail-return-row"),
      categoryBadgeText: $("viewerCategoryBadge").textContent,
      categoryBadgeHidden: $("viewerCategoryBadge").hidden,
      categoryBadgeRowHidden: $("viewerCategoryBadgeRow").hidden,
      categoryBadgeRowRect: (() => { const rect = $("viewerCategoryBadgeRow").getBoundingClientRect(); return { y: rect.y, height: rect.height }; })(),
      titleRect: (() => { const rect = $("viewerTitle").getBoundingClientRect(); return { y: rect.y, bottom: rect.bottom }; })(),
      subtitleAbsent: !document.getElementById("viewerSubtitle"),
      imageVisible: !$("viewerImage").hidden,
      pageWidth: $("documentDetailView").getBoundingClientRect().width,
      pageMaxHeight: getComputedStyle($("documentDetailView")).maxHeight,
      pageBorderRadius: getComputedStyle($("documentDetailView")).borderRadius,
      titleWhiteSpace: getComputedStyle($("viewerTitle")).whiteSpace,
      titleOverflow: getComputedStyle($("viewerTitle")).textOverflow,
      tabsAbsent: !document.querySelector(".document-detail-tabs"),
      infoToggleVisible: getComputedStyle($("viewerDetailsBtn")).display !== "none",
      infoHidden: $("viewerDocumentDetails").hidden,
      infoVisible: getComputedStyle($("viewerDocumentDetails")).display !== "none",
      headerClass: $("documentDetailView").querySelector("header").className,
      detailsOverflowY: getComputedStyle($("viewerDocumentDetails")).overflowY,
      readerOverflowY: getComputedStyle($("viewerImageViewport")).overflowY,
      workshopBackVisible: !!document.getElementById("workshopBackBtn")?.getClientRects().length,
      workshopBackLabel: document.getElementById("workshopBackBtn")?.textContent.replace(/\s+/g, " ").trim() || "",
      workshopMenuInHeader: !!document.querySelector(".transcription-workshop-header #workshopActionsMenu"),
      workshopMenuInSlot: !!document.querySelector("#transcriptionMobileActionsSlot #workshopActionsMenu"),
      workshopCtaHeight: Math.round(document.getElementById("workshopModeBtn")?.getBoundingClientRect().height || 0),
      workshopCtaHidden: document.getElementById("workshopModeBtn")?.hidden ?? true,
      workshopTitleBelowBack: (() => {
        const title = document.getElementById("workshopPageHeading");
        const back = document.getElementById("workshopBackBtn");
        if (!title || !back) return false;
        return title.getBoundingClientRect().top >= back.getBoundingClientRect().bottom - 1;
      })(),
      workshopMenuInPanel: !!document.querySelector("#workshopPanelRight #workshopActionsMenu"),
      workshopTitle: $("workshopPageHeading").textContent,
      workshopTitleWraps: getComputedStyle($("workshopPageHeading")).whiteSpace === "normal",
      workshopBreadcrumbAbsent: !document.querySelector(".transcription-workshop-breadcrumb"),
      workshopNavigationDisplay: getComputedStyle(document.querySelector(".topbar .main-nav")).display,
      workshopBrandDisplay: getComputedStyle(document.querySelector(".topbar .brand")).display,
      workshopHorizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      workshopHeaderClass: $("transcriptionWorkshopView").querySelector("header").className,
      workshopLossBannerPresent: !!$("workshopLossWarning")
    };
  },
  settle() { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
};
/* Le callback d'authentification arrive après show() et réafficherait l'écran de
   connexion par-dessus la page, interceptant les clics : neutralisé ici, le test
   masquant lui-même cet écran. */
const __realShowAuthPanel = showAuthPanel;
showAuthPanel = panel => { if (panel === "app") __realShowAuthPanel(panel); };
`;

test("la page Document restitue ses origines et conserve les parcours métier", async t => {
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
  const browserDialogs = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", async dialog => { browserDialogs.push(dialog.message()); await dialog.dismiss(); });
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    try { await page.waitForFunction(() => typeof window.__documentPageTest === "object", { timeout: 10000 }); }
    catch { throw new Error(`Hooks navigateur absents : ${errors.join(" | ")}`); }
    await page.evaluate(() => { window.__documentPageTest.show(); window.__documentPageTest.seed(); });

    /* Archives → Document → Archives : filtres et défilement restaurés. */
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "3000px";
      document.getElementById("genealogyView").append(spacer);
      document.getElementById("genealogySearch").value = "registre";
      document.getElementById("genealogyKindFilter").value = "legacy-documents";
      window.scrollTo({ top: 700, behavior: "instant" });
    });
    const archiveScroll = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.__documentPageTest.openFromArchives());
    try { await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden); }
    catch (error) {
      const diagnostic = await page.evaluate(() => ({
        state: window.__documentPageTest.state(),
        visibleDialogs: [...document.querySelectorAll("dialog[open]")].map(dialog => dialog.id),
        ...window.__documentPageTest.debug()
      }));
      throw new Error(`${error.message}; erreurs applicatives : ${errors.join(" | ")}; état : ${JSON.stringify(diagnostic)}`);
    }
    /* L'aperçu est chargé de façon asynchrone après l'ouverture de la page :
       on attend son montage avant de lire l'état, sans relâcher l'assertion. */
    await page.waitForFunction(() => { const img = document.getElementById("viewerImage"); return !img.hidden && img.naturalWidth > 0; });
    let state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.pageVisible, true, "page Document ouverte depuis Archives");
    assert.equal(state.backLabel, "Retour aux archives", "destination du Retour annoncée accessible");
    assert.match(state.backVisibleLabel, /^Retour\s+\S/, "lien Retour rétabli en haut à droite sur desktop, libellé contextuel");
    assert.equal(state.desktopBackPresent, true, "le lien Retour de la fiche Document existe sur desktop");
    assert.equal(state.returnRowPresent, true, "rangée Retour au-dessus de l’en-tête");
    assert.equal(state.categoryBadgeText, "Registre", "badge de catégorie renseigné");
    assert.equal(state.categoryBadgeHidden, false, "badge visible quand la catégorie existe");
    assert.equal(state.categoryBadgeRowHidden, false, "rangée de catégorie visible sous le titre");
    assert.ok(state.categoryBadgeRowRect.y >= state.titleRect.bottom, "badge placé sous le titre principal");
    assert.equal(state.subtitleAbsent, true, "aucun sous-titre sous le titre Document (lot G)");
    assert.ok(state.headerClass.includes("dedicated-page-header"), "en-tête Document partagé");
    assert.equal(state.imageVisible, true, "aperçu du document chargé");
    assert.equal(await page.locator("#viewerBreadcrumb").count(), 0, "fil d’Ariane supprimé de la fiche Document");
    assert.equal(await page.locator("#viewerTitle").textContent(), "Registre de consultation paroissial de la commune de Palermo — année 1891", "titre personnalisé prioritaire");
    assert.equal(await page.locator("#viewerEditBtn").textContent(), "Modifier", "CTA Modifier dans l’en-tête");
    assert.equal(await page.locator("#viewerDetailsExpandBtn").getAttribute("aria-label"), "Masquer les informations", "action annoncée lorsque le panneau desktop est ouvert");
    assert.equal(await page.locator("#viewerDetailsExpandBtn use").getAttribute("href"), "#icon-chevron-right", "chevron vers la droite lorsque le panneau est ouvert");
    await page.click("#viewerDetailsExpandBtn");
    await page.waitForFunction(() => document.getElementById("documentUnifiedLayout").classList.contains("is-details-collapsed"));
    assert.equal(await page.locator("#viewerDetailsExpandBtn").getAttribute("aria-label"), "Afficher les informations", "action annoncée lorsque le panneau desktop est fermé");
    assert.equal(await page.locator("#viewerDetailsExpandBtn use").getAttribute("href"), "#icon-chevron-left", "chevron vers la gauche lorsque le panneau est fermé");
    await page.click("#viewerDetailsExpandBtn");
    await page.waitForFunction(() => !document.getElementById("documentUnifiedLayout").classList.contains("is-details-collapsed"));
    await page.click("#documentPageActionsBtn");
    await page.waitForFunction(() => document.getElementById("documentPageActions")?.open === true);
    await page.waitForFunction(() => document.getElementById("documentPageActionsBtn")?.getAttribute("aria-expanded") === "true");
    assert.equal(await page.locator("#documentPageActionsBtn").getAttribute("aria-expanded"), "true", "état accessible du menu synchronisé");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("documentPageActions")?.open === false);
    await page.click("#documentPageActionsBtn");
    await page.waitForFunction(() => document.getElementById("documentPageActions")?.open === true);
    await page.waitForFunction(() => document.getElementById("documentPageActionsBtn")?.getAttribute("aria-expanded") === "true");
    assert.equal(await page.locator('#documentPageActionsMenu [data-document-page-action="download"]').isVisible(), true, "téléchargement présent uniquement dans le menu ouvert");
    const documentDownloadPromise = page.waitForEvent("download");
    await page.click('#documentPageActionsMenu [data-document-page-action="download"]');
    assert.equal((await documentDownloadPromise).suggestedFilename(), "registre.jpg", "téléchargement du fichier original avec son nom");
    assert.equal(await page.locator("#documentPageActions").evaluate(menu => menu.open), false, "menu refermé après le téléchargement");
    await page.click("#documentPageActionsBtn");
    await page.waitForFunction(() => document.getElementById("documentPageActions")?.open === true);
    await page.click('#documentMobileActionsSlot [data-document-page-action="delete"], #documentPageActionsHost [data-document-page-action="delete"]');
    await page.waitForFunction(() => document.getElementById("toastMessage").textContent.includes("référencé"));
    assert.equal(browserDialogs.length, 0, "un document associé est bloqué avant la confirmation destructive");
    assert.equal((await page.evaluate(() => window.__documentPageTest.state())).documentsCount, 1, "le document lié reste présent sans écriture");
    await page.click("#viewerEditBtn");
    await page.waitForSelector("#documentDialog[open]");
    assert.equal(await page.locator("#documentDialogTitle").textContent(), "Modifier le document", "CTA Modifier ouvre la modale existante");
    await page.click('[data-close="documentDialog"]');
    await page.waitForFunction(() => !document.getElementById("documentDialog").open);
    await page.waitForFunction(() => document.getElementById("viewerImage").naturalWidth > 0);
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.returnContext?.view, "genealogy", `contexte Archives restauré avant Échap : ${JSON.stringify({ view: state.view, returnContext: state.returnContext })}`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("documentDetailView").hidden);
    /* Le scroll se restaure dans un rAF : on attend sa stabilisation. */
    const restored = await page.evaluate(async expected => {
      let last = window.scrollY;
      for (let attempt = 0; attempt < 90; attempt++) {
        if (Math.abs(window.scrollY - expected) <= 2) return { scrollY: window.scrollY, stable: true };
        last = window.scrollY;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return { scrollY: last, stable: false };
    }, archiveScroll);
    const restoredScroll = restored.scrollY;
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.archiveVisible, true, `retour aux Archives : ${JSON.stringify({ view: state.view, directoryVisible: state.directoryVisible, search: state.search, filter: state.filter })}`);
    assert.equal(state.search, "registre");
    assert.equal(state.filter, "legacy-documents");
    assert.ok(Math.abs(restoredScroll - archiveScroll) <= 2, `défilement restauré (${restoredScroll}/${archiveScroll})`);
    await page.evaluate(() => window.__documentPageTest.openFromArchives());
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("documentDetailView").hidden);
    await page.evaluate(() => window.__documentPageTest.show("documents"));
    await page.waitForFunction(() => !document.getElementById("documentsView").hidden);

    /* Personne → Document → retour Personne : section et brouillon restaurés. */
    await page.evaluate(() => window.__documentPageTest.openFromPerson());
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.returnContext.kind, "person", "contexte Personne capturé");
    assert.equal(state.backLabel, "Retour à la personne", "Retour du Document précise la fiche Personne");
    assert.equal(state.personOpen, false, "la fiche Personne est refermée pour la page");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#personDialog[open]");
    await page.waitForTimeout(80);
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.personOpen, true, "fiche Personne restaurée");
    assert.equal(state.personSection, "documents", "section Documents restaurée");
    assert.equal(state.personName, "Ada modifiée", "brouillon de la fiche restauré");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("personDialog").open);

    /* Document → Source → retour Document ; Document → Preuve → retour Document. */
    await page.evaluate(() => window.__documentPageTest.openFromDirectory());
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    await page.evaluate(() => window.__documentPageTest.openSourceFromPage());
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    assert.match(await page.locator("#sourcePageBreadcrumb").innerText(), /Documents[\s\S]*Registre[\s\S]*Source du registre/);
    await page.click("#sourcePageBackBtn");
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.pageVisible, true, "retour à la page Source appelante depuis l'origine");
    await page.evaluate(() => window.__documentPageTest.openProofFromPage());
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    assert.match(await page.locator("#proofPageBreadcrumb").innerText(), /Documents[\s\S]*Registre[\s\S]*Naissance/);
    await page.click("#proofPageBackBtn");
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.pageVisible, true, "retour à la page Document depuis la Preuve");
    assert.ok(state.returnContext, "contexte d'origine de la page conservé à travers Source et Preuve");

    /* Document → Atelier → retour Document (contexte de page conservé). */
    await page.evaluate(() => window.__documentPageTest.transcribe());
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.pageVisible, false, "l'atelier remplace la page");
    assert.equal(state.workshopBackVisible, true, "lien Retour textuel visible dans l’en-tête de l’Atelier");
    assert.match(state.workshopBackLabel, /^←?\s*Retour\s+\S/, "libellé contextuel du lien Retour");
    assert.equal(state.workshopTitleBelowBack, true, "titre du document sous le lien Retour dans l’Atelier");
    assert.equal(state.workshopMenuInHeader, true, "menu « … » unique dans l’en-tête de l’Atelier");
    assert.equal(state.workshopMenuInPanel, false, "menu « … » quitté le panneau de transcription");
    assert.ok(state.workshopHeaderClass.includes("dedicated-page-header"), "en-tête partagé de l’Atelier");
    assert.equal(state.workshopLossBannerPresent, false, "aucun bandeau rouge redondant dans l’Atelier");
    await page.click("#workshopBackBtn");
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.pageVisible, true, "retour à la page Document depuis l'atelier");
    assert.ok(state.returnContext, "retour de l'atelier conserve le contexte de la page");

    /* Échap : retour immédiat (ancien réflexe de fermeture du lecteur). */
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("documentDetailView").hidden);
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.pageVisible, false, "Échap ferme la page Document");
    assert.ok(state.personOpen || state.archiveVisible || state.directoryVisible, "Échap rend à l'origine capturée");

    /* Mobile : aucun débordement, cibles tactiles. */
    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => window.__documentPageTest.openFromDirectory());
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    await page.waitForFunction(() => { const img = document.getElementById("viewerImage"); return !img.hidden && img.naturalWidth > 0; });
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.horizontalOverflow, false, "aucun débordement horizontal à 320px");
    assert.equal(state.pageWidth, 320, "la page Document utilise toute la largeur à 320px");
    assert.equal(state.pageMaxHeight, "none", "aucune hauteur maximale de modale à 320px");
    assert.equal(state.pageBorderRadius, "0px", "pas de coins de modale sur la page mobile");
    assert.ok(state.backHeight >= 44, `Retour ≥ 44px (${state.backHeight})`);
    assert.equal(state.backVisibleLabel, "", "retour mobile conservé sous forme de chevron, sans libellé ni doublon");
    assert.equal(state.backInsideHeader, true, "le Retour reste dans l’en-tête sur mobile");
    /* Header mobile harmonisé (modèle fiche Personne) : le chevron de la topbar
       est l'unique retour visible ; le Retour interne disparaît du contenu. */
    assert.equal(state.mobileHeaderVisible, true, "header mobile de consultation visible à 320px");
    assert.ok(state.mobileBackHeight >= 44, `chevron de retour ≥ 44px à 320px (${state.mobileBackHeight})`);
    assert.ok(Math.abs(state.mobileTitleCenterDelta) <= 1, `titre « La Nostra Storia » centré à 320px (${state.mobileTitleCenterDelta}px)`);
    assert.equal(state.contentBackDisplay, "none", "aucun Retour redondant dans le contenu à 320px");
    /* Lot G : plus d'onglets — volet Informations fermé par défaut sur mobile,
       ouvert par la bascule sous la visionneuse. */
    assert.equal(state.tabsAbsent, true, "aucun onglet Original/Informations à 320px");
    assert.equal(state.infoToggleVisible, true, "bascule Informations visible sous la visionneuse à 320px");
    assert.equal(state.infoVisible, false, "informations fermées par défaut à 320px");
    assert.equal(state.infoHidden, true, "volet replié à l'ouverture à 320px");
    assert.equal(await page.locator("#viewerImage").isVisible(), true, "le lecteur reste affiché à 320px");
    assert.equal(await page.locator("#viewerOriginalHeading").isVisible(), false, "libellé « Original » masqué sur mobile (lot corrections)");
    /* Correctif : le dépliage « Informations » amène le titre et le début du
       contenu dans la zone utile de l'écran, sans défilement manuel. La bascule
       est d'abord positionnée en bas pour reproduire un contenu ouvert sous la
       ligne de flottaison ; si le contenu est déjà visible, aucun déplacement
       n'est provoqué. */
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      const toggle = document.getElementById("viewerDetailsBtn").getBoundingClientRect();
      window.scrollBy({ top: toggle.bottom - (window.innerHeight - 8), behavior: "instant" });
    });
    const preReveal = await page.evaluate(() => {
      const toggle = document.getElementById("viewerDetailsBtn").getBoundingClientRect();
      return { scrollY: window.scrollY, toggleBottom: Math.round(toggle.bottom), viewport: innerHeight };
    });
    await page.evaluate(() => document.getElementById("viewerDetailsBtn").click());
    assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true, "la bascule ouvre le volet Informations à 320px");
    await page.waitForFunction(() => {
      const panel = document.getElementById("viewerDocumentDetails");
      if (!panel || panel.hidden) return false;
      const header = document.querySelector(".topbar");
      const stickyBottom = header && getComputedStyle(header).position === "sticky" ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      const top = panel.getBoundingClientRect().top;
      return top >= stickyBottom - 2 && top <= window.innerHeight - 64;
    }, undefined, { timeout: 4000 });
    const reveal = await page.evaluate(() => {
      const panel = document.getElementById("viewerDocumentDetails");
      const header = document.querySelector(".topbar");
      const stickyBottom = header && getComputedStyle(header).position === "sticky" ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      return { scrollY: window.scrollY, panelTop: Math.round(panel.getBoundingClientRect().top), stickyBottom: Math.round(stickyBottom), viewport: innerHeight };
    });
    assert.ok(reveal.panelTop >= reveal.stickyBottom - 2, `titre « Informations » sous l’en-tête sticky (${reveal.panelTop} ≥ ${reveal.stickyBottom})`);
    assert.ok(reveal.panelTop <= reveal.viewport - 64, `début du contenu visible sans défilement manuel (${reveal.panelTop} ≤ ${reveal.viewport - 64})`);
    if (preReveal.toggleBottom > preReveal.viewport - 64) {
      assert.ok(reveal.scrollY > preReveal.scrollY, `défilement automatique vers le contenu sous la flottaison (${preReveal.scrollY} → ${reveal.scrollY})`);
    } else if (preReveal.toggleBottom <= preReveal.viewport - 76) {
      assert.equal(reveal.scrollY, preReveal.scrollY, "aucun déplacement lorsque le début du contenu est déjà visible");
    }
    const longPersonChip = await page.locator("#viewerDocumentDetails .document-unified-people .person-chip-consult").evaluate(button => {
      const name = button.querySelector("span");
      const style = getComputedStyle(button);
      return { buttonWidth: button.getBoundingClientRect().width, nameWidth: name.clientWidth, nameScrollWidth: name.scrollWidth, fontSize: style.fontSize, justify: style.justifyContent, align: style.alignItems, textAlign: style.textAlign, gap: style.gap, background: style.backgroundColor };
    });
    assert.ok(longPersonChip.buttonWidth > 0, "nom long affiché dans une pastille mobile");
    assert.ok(longPersonChip.nameScrollWidth <= longPersonChip.nameWidth + 1, "nom long renvoyé à la ligne sans débordement mobile");
    assert.ok(parseFloat(longPersonChip.fontSize) < 16, "typographie des personnes réduite et harmonisée sur mobile");
    assert.equal(longPersonChip.justify, "center", "groupe icône + nom centré horizontalement sur mobile");
    assert.equal(longPersonChip.align, "center", "contenu centré verticalement sur mobile");
    assert.equal(longPersonChip.textAlign, "center", "nom centré dans sa capsule mobile");
    assert.notEqual(longPersonChip.gap, "0px", "espacement constant entre icône et nom");
    assert.equal(longPersonChip.background, "rgb(243, 238, 229)", "fond grège commun des capsules de personnes");
    assert.equal(await page.locator("#viewerDocumentDetailsContent .document-file-details-mobile").count(), 1, "carte de détails fichier dédiée au mobile");
    assert.equal(await page.locator("#viewerDocumentDetailsContent .document-unified-facts--file").count(), 0, "ancienne carte fichier retirée du panneau");
    assert.deepEqual(await page.locator("#viewerFileMetadata > span").allTextContents(), ["JPEG", "registre.jpg"], "bandeau desktop limité aux métadonnées demandées");
    assert.equal(await page.locator(".document-transcription-card .document-transcription-progress-track").count(), 2, "progressions italienne et française visibles");
    /* Fermeture : aucun saut superflu — seul le recalage natif du défilement
       (si le volet occupait le bas de la page) reste admis. */
    const scrollBeforeDetailsClose = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => document.getElementById("viewerDetailsBtn").click());
    assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), true, "la bascule referme le volet à 320px");
    const detailsCloseState = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      scrollY: window.scrollY,
      maxScroll: Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    })))));
    assert.ok(Math.abs(detailsCloseState.scrollY - Math.min(scrollBeforeDetailsClose, detailsCloseState.maxScroll)) <= 1,
      `fermeture sans saut de défilement (${scrollBeforeDetailsClose} → ${detailsCloseState.scrollY}, max ${detailsCloseState.maxScroll})`);
    assert.equal(state.subtitleAbsent, true, "aucun sous-titre résiduel à 320px");
    assert.equal(state.titleWhiteSpace, "normal", "titre Document long renvoyé à la ligne à 320px");
    assert.equal(state.titleLabel, state.title, "titre complet accessible à 320px");
    await page.setViewportSize({ width: 390, height: 844 });
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.horizontalOverflow, false, "aucun débordement horizontal à 390px");
    assert.equal(state.pageWidth, 390, "la page Document utilise toute la largeur à 390px");
    assert.equal(state.pageMaxHeight, "none", "aucune hauteur maximale de modale à 390px");
    assert.equal(state.tabsAbsent, true, "aucun onglet Original/Informations à 390px");
    assert.equal(state.infoToggleVisible, true, "bascule Informations visible à 390px");
    assert.equal(state.infoHidden, true, "informations fermées par défaut à 390px");
    /* Détails du fichier dans le panneau Informations mobile. */
    await page.click("#viewerDetailsBtn");
    assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true, "la bascule ouvre le volet Informations à 390px");
    assert.equal(await page.locator("#viewerDocumentDetailsContent .document-file-details-mobile").last().isVisible(), true, "Détails du fichier en dernière carte mobile");
    assert.equal(await page.locator("#viewerFileMetadata").isVisible(), false, "aucun bandeau de métadonnées sous la visionneuse mobile");
    await page.click("#viewerDetailsBtn");
    assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), true, "la bascule referme le volet à 390px");
    assert.equal(await page.locator("#viewerImage").isVisible(), true, "le lecteur reste affiché à 390px");
    assert.equal(await page.locator("#viewerOriginalHeading").isVisible(), false, "libellé « Original » masqué jusqu'à 760px");
    assert.equal(state.titleWhiteSpace, "normal", "titre long renvoyé à la ligne à 390px");
    assert.equal(state.titleLabel, state.title, "titre complet accessible à 390px");
    for (const [width, height] of [[320, 844], [390, 844], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.__documentPageTest.transcribe());
      await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
      state = await page.evaluate(() => window.__documentPageTest.state());
      assert.equal(state.workshopHorizontalOverflow, false, `Atelier sans débordement à ${width}px`);
      assert.equal(state.workshopBackVisible, width > 760, `lien Retour visible sur desktop, masqué sur mobile (${width}px)`);
      assert.equal(state.workshopMenuInHeader, width > 760, `menu « … » dans l’en-tête desktop, dans le header dédié sur mobile (${width}px)`);
      assert.equal(state.workshopMenuInSlot, width <= 760, `menu « … » dans l’en-tête dédié sur mobile (${width}px)`);
      assert.equal(state.workshopTitleBelowBack, true, `titre du document sous le lien Retour à ${width}px`);
      if (!state.workshopCtaHidden) assert.ok(state.workshopCtaHeight >= 44, `CTA vert ≥ 44 px à ${width}px (${state.workshopCtaHeight}px)`);
      assert.equal(state.workshopTitleWraps, true, `titre du document autorise les retours à la ligne à ${width}px`);
      assert.equal(state.workshopBreadcrumbAbsent, true, `fil d’Ariane supprimé de l’atelier à ${width}px`);
      assert.equal(state.workshopNavigationDisplay, "none", `navigation générale masquée dans l’atelier (${width}px)`);
      /* Logo et compte masqués dans l’en-tête dédié mobile (modèle fiche Document). */
      assert.equal(state.workshopBrandDisplay === "none", width <= 760, `identité de marque en en-tête desktop, masquée sur mobile (${width}px)`);
      if (width >= 981) {
        await page.click("#workshopBackBtn");
        await page.waitForFunction(() => document.getElementById("transcriptionWorkshopView").hidden && !document.getElementById("documentDetailView").hidden);
      } else {
        /* L'en-tête dédié porte le retour contextualisé sur mobile. */
        await page.click("#transcriptionMobileBackBtn");
        await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.tabsAbsent, true, "aucun onglet Original/Informations sur ordinateur");
    /* Image affichée : le head Original était déjà masqué sur desktop (règle
       antérieure) — le lot corrections n'a rien changé de ce côté. */
    assert.equal(await page.locator("#viewerOriginalHeading").isVisible(), false, "head « Original » masqué pour une image, desktop inchangé");
    assert.equal(state.infoVisible, true, "panneau Informations desktop reste visible");
    assert.equal(state.detailsOverflowY, "visible", "les Informations suivent le défilement naturel de la page");
    const desktopLongPerson = await page.locator("#viewerDocumentDetails .document-unified-people .person-chip-consult").evaluate(button => {
      const name = button.querySelector("span");
      const style = getComputedStyle(button);
      return { nameWidth: name.clientWidth, nameScrollWidth: name.scrollWidth, fontSize: style.fontSize, justify: style.justifyContent, align: style.alignItems, textAlign: style.textAlign, background: style.backgroundColor };
    });
    assert.ok(desktopLongPerson.nameScrollWidth <= desktopLongPerson.nameWidth + 1, "nom long renvoyé à la ligne sans débordement desktop");
    assert.ok(parseFloat(desktopLongPerson.fontSize) < 16, "typographie des personnes réduite et harmonisée sur desktop");
    assert.equal(desktopLongPerson.justify, "center", "groupe icône + nom centré horizontalement sur desktop");
    assert.equal(desktopLongPerson.align, "center", "contenu centré verticalement sur desktop");
    assert.equal(desktopLongPerson.textAlign, "center", "nom centré dans sa capsule desktop");
    assert.equal(desktopLongPerson.background, "rgb(243, 238, 229)", "fond grège commun sur desktop");

    /* Comparaison géométrique des trois en-têtes aux largeurs mobile et desktop. */
    const headerMeasure = viewId => page.evaluate(id => {
      const view = document.getElementById(id);
      const header = view.querySelector(".dedicated-page-header");
      const actions = header.querySelector(".dedicated-page-actions-row")?.getBoundingClientRect() || null;
      const backElement = header.querySelector(".dedicated-page-back");
      const back = backElement?.getBoundingClientRect() || null;
      const crumb = (id === "documentDetailView" ? header.querySelector(".document-detail-title-group") : header.querySelector(".consultation-breadcrumb")).getBoundingClientRect();
      const rect = header.getBoundingClientRect();
      const mobileHeaderId = { sourceDetailView: "sourceMobileHeader", proofDetailView: "proofMobileHeader", documentDetailView: "documentMobileHeader" }[id];
      const mobileHeader = document.getElementById(mobileHeaderId);
      const mobileBack = mobileHeader.querySelector(".detail-mobile-back").getBoundingClientRect();
      const mobileActions = mobileHeader.querySelector("#documentMobileActionsSlot .tile-context-toggle")?.getBoundingClientRect() || null;
      const titleBox = mobileHeader.querySelector("strong").getBoundingClientRect();
      const returnRow = backElement?.closest(".document-detail-return-row") || null;
      return { actionBackGap: actions && back ? back.y - actions.bottom : null, rightInset: back ? rect.right - back.right : null, returnCenterDelta: back ? Math.abs((back.y + back.height / 2) - (crumb.y + crumb.height / 2)) : null, returnFontSize: backElement ? getComputedStyle(backElement).fontSize : null, height: rect.height, contentBackDisplay: backElement ? getComputedStyle(returnRow || backElement).display : "none", backAboveTitle: back && crumb ? back.bottom <= crumb.y + 1 : null, mobileBackHeight: mobileBack.height, mobileHeaderVisible: getComputedStyle(mobileHeader).display !== "none", mobileTitleCenterDelta: Math.round((titleBox.left + titleBox.right) / 2 - innerWidth / 2), mobileActionSymmetryDelta: mobileActions ? Math.round((mobileBack.left + mobileBack.right + mobileActions.left + mobileActions.right) / 2 - innerWidth) : null, documentBackPresent: id === "documentDetailView" && !!backElement };
    }, viewId);
    for (const width of [320, 375, 390, 820, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.__documentPageTest.openHeaderSource());
      await page.evaluate(() => window.__documentPageTest.settle());
      const sourceGeometry = await headerMeasure("sourceDetailView");
      assert.equal(await page.locator(".topbar .main-nav").evaluate(element => getComputedStyle(element).display), "none", `navigation masquée dans Source à ${width}px`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `aucun débordement horizontal dans Source à ${width}px`);
      await page.evaluate(() => window.__documentPageTest.openHeaderProof());
      await page.evaluate(() => window.__documentPageTest.settle());
      const proofGeometry = await headerMeasure("proofDetailView");
      assert.equal(await page.locator(".topbar .main-nav").evaluate(element => getComputedStyle(element).display), "none", `navigation masquée dans Preuve à ${width}px`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `aucun débordement horizontal dans Preuve à ${width}px`);
      await page.evaluate(() => window.__documentPageTest.openHeaderDocument("Autre"));
      await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
      await page.evaluate(() => window.__documentPageTest.settle());
      const documentGeometry = await headerMeasure("documentDetailView");
      assert.equal(await page.locator(".topbar .main-nav").evaluate(element => getComputedStyle(element).display), "none", `navigation masquée dans Document à ${width}px`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `aucun débordement horizontal dans Document à ${width}px`);
      for (const [name, geometry] of [["Source", sourceGeometry], ["Preuve", proofGeometry], ["Document", documentGeometry]]) {
        if (width <= 760) {
          /* Header mobile harmonisé : le Retour interne disparaît, le chevron
             de la topbar prend le relais (modèle fiche Personne). */
          assert.equal(geometry.mobileHeaderVisible, true, `${width}px : header mobile de consultation visible pour ${name}`);
          assert.equal(geometry.contentBackDisplay, "none", `${width}px : aucun Retour redondant dans le contenu de ${name}`);
          assert.ok(geometry.mobileBackHeight >= 44, `${width}px : chevron de ${name} ≥ 44 px (${geometry.mobileBackHeight}px)`);
          assert.ok(Math.abs(geometry.mobileTitleCenterDelta) <= 1, `${width}px : titre centré pour ${name} (${geometry.mobileTitleCenterDelta}px)`);
          if (name === "Document") assert.ok(Math.abs(geometry.mobileActionSymmetryDelta) <= 1, `${width}px : menu ⋯ symétrique au Retour (${geometry.mobileActionSymmetryDelta}px) ${JSON.stringify(geometry.mobileActionBoxes)}`);
        } else {
          assert.ok(geometry.rightInset >= -1 && geometry.rightInset <= 3, `${width}px : Retour de ${name} aligné à droite (${geometry.rightInset}px)`);
          if (name === "Document") {
            assert.equal(geometry.documentBackPresent, true, `${width}px : lien Retour rétabli dans la fiche Document desktop`);
            assert.equal(geometry.backAboveTitle, true, `${width}px : Retour au-dessus du titre dans la fiche Document`);
            assert.equal(geometry.returnFontSize, "14px", `${width}px : Retour Document en 14 px`);
          } else {
            assert.ok(geometry.returnCenterDelta <= 1, `${width}px : Retour de ${name} centré sur le fil (${geometry.returnCenterDelta}px)`);
            assert.equal(geometry.returnFontSize, "14px", `${width}px : Retour de ${name} en 14 px`);
          }
        }
      }
      const menuHost = width <= 760 ? "#documentMobileActionsSlot" : "#documentPageActionsHost";
      assert.equal(await page.locator(`${menuHost} #documentPageActions`).count(), 1, `${width}px : menu ⋯ dans son emplacement d’en-tête`);
      assert.equal(await page.locator("#viewerEditBtn").count(), 1, `${width}px : CTA Modifier unique dans l’en-tête`);
      if (width <= 760) {
        assert.equal(await page.locator("#viewerCategoryBadgeRow #viewerEditBtn").count(), 1, `${width}px : Modifier sur la ligne de la capsule de type`);
        const mobileTitleAndCategory = await page.evaluate(() => {
          const title = document.getElementById("viewerTitle").getBoundingClientRect();
          const row = document.getElementById("viewerCategoryBadgeRow").getBoundingClientRect();
          const badge = document.getElementById("viewerCategoryBadge").getBoundingClientRect();
          const edit = document.getElementById("viewerEditBtn").getBoundingClientRect();
          return { titleBottom: title.bottom, rowTop: row.top, badgeCenter: badge.top + badge.height / 2, editCenter: edit.top + edit.height / 2, editRight: edit.right, rowRight: row.right };
        });
        assert.ok(mobileTitleAndCategory.rowTop >= mobileTitleAndCategory.titleBottom - 1, `${width}px : titre sur sa ligne avant badge/actions`);
        if (!state.categoryBadgeHidden) assert.ok(Math.abs(mobileTitleAndCategory.badgeCenter - mobileTitleAndCategory.editCenter) <= 2, `${width}px : badge et Modifier sur la même ligne (${JSON.stringify(mobileTitleAndCategory)})`);
        assert.ok(mobileTitleAndCategory.editRight <= mobileTitleAndCategory.rowRight + 1, `${width}px : CTA Modifier reste dans l’en-tête`);
      }
      assert.equal(await page.locator(`${menuHost} #documentPageActions`).evaluate(menu => menu.open), false, `${width}px : menu fermé par défaut`);
      assert.equal(await page.locator(`${menuHost} [data-document-page-action="download"]`).count(), 1, `${width}px : téléchargement seulement dans le menu fermé`);
      // Menu ouvert : entièrement contenu dans le viewport, ordre imposé.
      await page.click(`${menuHost} #documentPageActionsBtn`);
      await page.waitForFunction(host => document.querySelector(`${host} #documentPageActions`)?.open === true, menuHost);
      const openMenuBox = await page.locator(`${menuHost} #documentPageActionsMenu`).boundingBox();
      assert.ok(openMenuBox.x >= -0.5 && openMenuBox.x + openMenuBox.width <= width + 0.5,
        `${width}px : menu intégralement visible sans rognage (${JSON.stringify(openMenuBox)})`);
      const menuOrder = await page.locator(`${menuHost} #documentPageActionsMenu [role="menuitem"], ${menuHost} #documentPageActionsMenu [role="separator"]`)
        .evaluateAll(nodes => nodes.map(node => node.id || node.getAttribute("role")));
      assert.deepEqual(menuOrder, ["downloadDocumentBtn", "separator", "deleteDocumentFromPageBtn"],
        `${width}px : ordre Télécharger, séparateur, Supprimer`);
      await page.click(`${menuHost} #documentPageActionsBtn`);
      await page.waitForFunction(host => document.querySelector(`${host} #documentPageActions`)?.open === false, menuHost);
      const categoryState = await page.evaluate(() => ({
        breadcrumb: document.querySelector("#documentDetailView .consultation-breadcrumb"),
        title: document.getElementById("viewerTitle").getBoundingClientRect(),
        badge: document.getElementById("viewerCategoryBadge").getBoundingClientRect(),
        header: document.querySelector("#documentDetailView .document-detail-header").getBoundingClientRect()
      }));
      assert.equal(categoryState.breadcrumb, null, `${width}px : fil d’Ariane supprimé de la fiche Document`);
      assert.ok(categoryState.badge.y >= categoryState.title.bottom, `${width}px : « Autre » sous le titre`);
      assert.ok(categoryState.badge.bottom <= categoryState.header.bottom, `${width}px : badge contenu dans l'en-tête`);
      assert.ok(documentGeometry.height <= (width <= 390 ? 175 : 220), `${width}px : en-tête Document reste compact (${documentGeometry.height}px)`);
      const returnLabels = await page.evaluate(() => {
        const button = document.getElementById("documentPageBackBtn");
        return {
          contentBackPresent: Boolean(button),
          contentBackVisible: Boolean(button && button.getClientRects().length),
          contentBackLabel: button?.querySelector(".dedicated-page-back-label")?.textContent || "",
          mobileAria: document.getElementById("documentMobileBackBtn").getAttribute("aria-label")
        };
      });
      assert.equal(returnLabels.contentBackPresent, true, `${width}px : bouton Retour présent dans la fiche`);
      assert.equal(returnLabels.contentBackVisible, width > 760, `${width}px : Retour visible sur desktop, masqué derrière le chevron mobile`);
      if (width > 760) assert.match(returnLabels.contentBackLabel, /^Retour\s+\S/, `${width}px : libellé contextuel du Retour desktop`);
      assert.notEqual(returnLabels.mobileAria, "Retour", `${width}px : nom accessible contextuel conservé sur le bouton mobile existant`);

      if (width === 320) {
        await page.evaluate(() => window.__documentPageTest.openHeaderDocument("Autre", ""));
        assert.equal(await page.locator("#viewerTitle").textContent(), "registre.jpg", "nom de fichier utilisé quand le titre personnalisé est absent");
        await page.evaluate(() => window.__documentPageTest.openHeaderDocument("Autre", "Registre de consultation paroissial de la commune de Palermo — année 1891"));
      }

      await page.evaluate(() => window.__documentPageTest.openHeaderDocument(""));
      await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
      await page.evaluate(() => window.__documentPageTest.settle());
      state = await page.evaluate(() => window.__documentPageTest.state());
      assert.equal(state.categoryBadgeHidden, true, `${width}px : badge absent sans catégorie`);
      assert.equal(state.categoryBadgeRowHidden, width > 760, `${width}px : seule la ligne du CTA est conservée sur mobile`);
      if (width > 760) assert.equal(state.categoryBadgeRowRect.height, 0, `${width}px : aucun espace réservé sans catégorie sur desktop`);
    }
    /* Document autonome : sans Source ni Preuve, l'initialisation propose une
       page portée par le Document; une page directe existante ouvre l'atelier. */
    await page.evaluate(() => window.__documentPageTest.standalone(false));
    await page.click("#viewerDocumentDetails [data-transcribe-document]");
    await page.waitForSelector("#transcriptionPageInitDialog[open]");
    assert.equal(await page.locator("#transcriptionPageInitSourceField").isHidden(), true, "aucune Source à choisir pour un Document autonome");
    assert.equal(await page.locator("#transcriptionPageInitConfirmBtn").isDisabled(), false, "initialisation directe disponible après calcul de l’empreinte");
    assert.match(await page.locator("#transcriptionPageInitNotice").textContent(), /ajoutée à la fiche Document/);
    assert.equal((await page.evaluate(() => window.__documentPageTest.state())).documentPageCount, 0, "l’ouverture du dialogue ne modifie rien avant confirmation");
    const mobileInitGeometry = await page.locator("#transcriptionPageInitDialog").evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return { width: rect.width, right: rect.right, viewport: innerWidth, contentHeight: dialog.querySelector(".transcription-page-init-content").clientHeight, footerHeight: dialog.querySelector(".modal-actions").getBoundingClientRect().height, footerBottom: dialog.querySelector(".modal-actions").getBoundingClientRect().bottom, dialogBottom: rect.bottom };
    });
    assert.ok(mobileInitGeometry.width <= mobileInitGeometry.viewport + 1, "modale mobile sans débordement horizontal");
    assert.ok(mobileInitGeometry.contentHeight > 0 && mobileInitGeometry.footerHeight >= 44, "contenu défilant et actions tactiles visibles sur mobile");
    assert.ok(mobileInitGeometry.footerBottom <= mobileInitGeometry.dialogBottom + 1, "footer ancré dans la modale mobile");
    await page.click('[data-close="transcriptionPageInitDialog"]');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.__documentPageTest.standalone(false));
    await page.click("#viewerDocumentDetails [data-transcribe-document]");
    await page.waitForSelector("#transcriptionPageInitDialog[open]");
    const desktopInitWidth = await page.locator("#transcriptionPageInitDialog").evaluate(dialog => dialog.getBoundingClientRect().width);
    assert.ok(desktopInitWidth >= 560 && desktopInitWidth <= 600, `modale desktop entre 560 et 600px (${desktopInitWidth}px)`);
    assert.equal(await page.locator("#transcriptionPageInitFacts").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length), 2, "informations réparties sur deux colonnes desktop");
    await page.click('[data-close="transcriptionPageInitDialog"]');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.__documentPageTest.standalone(true));
    await page.click("#viewerDetailsBtn");
    await page.click("#viewerDocumentDetails [data-transcribe-document]");
    await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
    const standaloneState = await page.evaluate(() => window.__documentPageTest.state());
    assert.deepEqual([standaloneState.sourceCount, standaloneState.proofCount], [0, 0], "l’atelier fonctionne sans Source ni Preuve");
    assert.deepEqual(errors, [], `erreurs JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
