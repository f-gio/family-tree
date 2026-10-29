import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const svg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="#b8c9be"/></svg>');

const hooks = `
window.__documentPageTest = {
  show(view = "genealogy") { $("authScreen").hidden = true; setView(view); },
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
    people = [{ id: "doc-person-fixture", firstName: "Ada", lastName: "Consult", birthDate: "1890", deathDate: "1960", place: "", deathPlace: "", partnerIds: [], childIds: [], inTree: true }];
    documents = [documentItem];
    loadedPeople = loadedDocuments = true;
    genealogyRecords = {
      sourceDocuments: [{ id: sourceData.id, data: sourceData }],
      sourceRevisions: [],
      transcriptionHeads: [], transcriptionRevisions: [],
      genealogyProofs: [{ id: proofData.id, data: proofData }],
      genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: []
    };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin" };
    renderGenealogyWorkspace();
  },
  openFromDirectory() {
    setView("directory");
    openStoredDocument(documents[0], "directory");
  },
  async openFromPerson() {
    /* Chemin réel : fiche Personne → document mini-carte → visionneuse. */
    setView("directory");
    openPerson(people[0], "directory");
    setPersonSection("documents");
    $("firstName").value = "Ada modifiée";
    await openStoredDocument(documents[0], "person");
  },
  openFromArchives() {
    /* Chemin exact de l'action « Consulter » d'une fiche historique. */
    const item = genealogyWorkspaceItems().find(value => value.kind === "legacy-source" && value.record.id === "doc-page-fixture");
    if (item) openGenealogyItem(item.kind, item.record.id);
  },
  openSourceFromPage() { openUnifiedSource("doc-page-fixture", "doc-source-fixture"); },
  openProofFromPage() { openUnifiedProof("doc-page-fixture", "doc-proof-fixture"); },
  transcribe() {
    const button = document.querySelector("#viewerDocumentDetails [data-transcribe-document]");
    if (button) button.click();
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
      returnContext: documentPageReturnContext ? { ...documentPageReturnContext } : null,
      search: $("genealogySearch").value,
      filter: $("genealogyKindFilter").value,
      scrollY: window.scrollY,
      personName: $("firstName").value,
      personSection: activePersonSection,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      backHeight: $("documentPageBackBtn").getBoundingClientRect().height,
      backLabel: $("documentPageBackBtn").getAttribute("aria-label"),
      backVisibleLabel: $("documentPageBackBtn").querySelector(".dedicated-page-back-label")?.textContent || "",
      backInsideHeader: !!document.querySelector(".dedicated-page-header #documentPageBackBtn"),
      backAboveHeader: (() => {
        const back = $("documentPageBackBtn").getBoundingClientRect();
        const header = document.querySelector("#documentDetailView .document-detail-header");
        return !header || back.bottom <= header.getBoundingClientRect().top + 1;
      })(),
      categoryBadgeText: $("viewerCategoryBadge").textContent,
      categoryBadgeHidden: $("viewerCategoryBadge").hidden,
      subtitleText: $("viewerSubtitle").textContent,
      imageVisible: !$("viewerImage").hidden,
      pageWidth: $("documentDetailView").getBoundingClientRect().width,
      pageMaxHeight: getComputedStyle($("documentDetailView")).maxHeight,
      pageBorderRadius: getComputedStyle($("documentDetailView")).borderRadius,
      titleLabel: $("viewerTitle").getAttribute("aria-label"),
      titleLineClamp: getComputedStyle($("viewerTitle")).webkitLineClamp,
      tabsVisible: getComputedStyle(document.querySelector(".document-detail-tabs")).display !== "none",
      legacyInfoToggleVisible: getComputedStyle($("viewerDetailsBtn")).display !== "none",
      infoVisible: getComputedStyle($("viewerDocumentDetails")).display !== "none",
      headerClass: $("documentDetailView").querySelector("header").className,
      detailsOverflowY: getComputedStyle($("viewerDocumentDetails")).overflowY,
      readerOverflowY: getComputedStyle($("viewerImageViewport")).overflowY,
      workshopBackHeight: $("workshopBackBtn").getBoundingClientRect().height,
      workshopBackLabel: $("workshopBackBtn").getAttribute("aria-label"),
      workshopMenuHeight: document.querySelector("#workshopActionsMenu > summary").getBoundingClientRect().height,
      workshopTitle: $("workshopDocumentTitle").textContent,
      workshopTitleLabel: $("workshopDocumentTitle").getAttribute("aria-label"),
      workshopTitleLineClamp: getComputedStyle($("workshopDocumentTitle")).webkitLineClamp,
      workshopHorizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      workshopHeaderClass: $("transcriptionWorkshopView").querySelector("header").className,
      workshopLossBannerPresent: !!$("workshopLossWarning")
    };
  },
  settle() { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
};`;

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
  page.on("pageerror", error => errors.push(error.message));
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
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    let state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.pageVisible, true, "page Document ouverte depuis Archives");
    assert.equal(state.backLabel, "Retour aux archives", "destination du Retour annoncée accessible");
    assert.equal(state.backVisibleLabel, "Retour aux archives", "destination du Retour affichée en clair");
    assert.equal(state.backInsideHeader, false, "le Retour n’est plus intégré à la grille de l’en-tête");
    assert.equal(state.backAboveHeader, true, "le Retour occupe une ligne indépendante au-dessus de l’en-tête");
    assert.equal(state.categoryBadgeText, "Registre", "badge de catégorie à côté de DOCUMENT");
    assert.equal(state.categoryBadgeHidden, false, "badge visible quand la catégorie existe");
    assert.equal(state.subtitleText.includes("registre.jpg"), false, "nom de fichier retiré du sous-titre (déjà dans Informations)");
    assert.equal(state.subtitleText.includes("Registre"), false, "type non répété dans le sous-titre (badge catégorie)");
    assert.equal(state.subtitleText.includes("1891"), true, "date de contexte conservée sous le titre");
    assert.ok(state.headerClass.includes("dedicated-page-header"), "en-tête Document partagé");
    assert.equal(state.imageVisible, true, "aperçu du document chargé");
    await page.click("#documentPageBackBtn");
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
    assert.equal(state.archiveVisible, true, "retour aux Archives");
    assert.equal(state.search, "registre");
    assert.equal(state.filter, "legacy-documents");
    assert.ok(Math.abs(restoredScroll - archiveScroll) <= 2, `défilement restauré (${restoredScroll}/${archiveScroll})`);

    /* Personne → Document → retour Personne : section et brouillon restaurés. */
    await page.evaluate(() => window.__documentPageTest.openFromPerson());
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.returnContext.kind, "person", "contexte Personne capturé");
    assert.equal(state.backLabel, "Retour à la personne", "Retour du Document précise la fiche Personne");
    assert.equal(state.personOpen, false, "la fiche Personne est refermée pour la page");
    await page.click("#documentPageBackBtn");
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
    await page.click("#sourcePageBackBtn");
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.pageVisible, true, "retour à la page Source appelante depuis l'origine");
    await page.evaluate(() => window.__documentPageTest.openProofFromPage());
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
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
    assert.equal(state.workshopBackLabel, "Retour au document", "Retour de l’Atelier précise le Document appelant");
    assert.equal(await page.locator("#workshopBackBtn .dedicated-page-back-label").textContent(), "Retour au document", "Retour Atelier nomme sa destination en clair");
    assert.ok(state.workshopBackHeight >= 44 && state.workshopMenuHeight >= 44, "Retour et menu Atelier ≥44px");
    assert.ok(state.workshopHeaderClass.includes("dedicated-page-header"), "en-tête partagé de l’Atelier");
    assert.equal(state.workshopTitleLabel, state.workshopTitle, "titre Atelier complet accessible");
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
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.horizontalOverflow, false, "aucun débordement horizontal à 320px");
    assert.equal(state.pageWidth, 320, "la page Document utilise toute la largeur à 320px");
    assert.equal(state.pageMaxHeight, "none", "aucune hauteur maximale de modale à 320px");
    assert.equal(state.pageBorderRadius, "0px", "pas de coins de modale sur la page mobile");
    assert.ok(state.backHeight >= 44, `Retour ≥ 44px (${state.backHeight})`);
    assert.equal(state.tabsVisible, true, "onglets Original et Informations visibles à 320px");
    assert.equal(state.legacyInfoToggleVisible, false, "ancien bouton Informations masqué à 320px");
    assert.equal(state.titleLineClamp, "2", "titre limité à deux lignes à 320px");
    assert.equal(state.titleLabel, state.title, "titre complet accessible à 320px");
    await page.click("#documentPageInfoTab");
    assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true, "onglet supérieur ouvre Informations à 320px");
    await page.click("#documentPageOriginalTab");
    assert.equal(await page.locator("#viewerImage").isVisible(), true, "onglet Original restaure le lecteur à 320px");
    await page.setViewportSize({ width: 390, height: 844 });
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.horizontalOverflow, false, "aucun débordement horizontal à 390px");
    assert.equal(state.pageWidth, 390, "la page Document utilise toute la largeur à 390px");
    assert.equal(state.pageMaxHeight, "none", "aucune hauteur maximale de modale à 390px");
    assert.equal(state.tabsVisible, true, "onglets visibles à 390px");
    assert.equal(state.legacyInfoToggleVisible, false, "ancien bouton Informations masqué à 390px");
    assert.equal(state.titleLineClamp, "2", "titre limité à deux lignes à 390px");
    assert.equal(state.titleLabel, state.title, "titre complet accessible à 390px");
    await page.click("#documentPageInfoTab");
    assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true, "onglet supérieur ouvre Informations à 390px");
    await page.click("#documentPageOriginalTab");
    assert.equal(await page.locator("#viewerImage").isVisible(), true, "onglet Original restaure le lecteur à 390px");
    for (const [width, height] of [[320, 844], [390, 844], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.__documentPageTest.transcribe());
      await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
      state = await page.evaluate(() => window.__documentPageTest.state());
      assert.equal(state.workshopHorizontalOverflow, false, `Atelier sans débordement à ${width}px`);
      assert.ok(state.workshopBackHeight >= 44 && state.workshopMenuHeight >= 44, `Retour et menu Atelier ≥44px à ${width}px`);
      assert.equal(state.workshopTitleLineClamp, "2", `titre Atelier limité à deux lignes à ${width}px`);
      await page.click("#workshopBackBtn");
      await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.tabsVisible, false, "onglets mobiles absents sur ordinateur");
    assert.equal(state.infoVisible, true, "panneau Informations desktop reste visible");
    assert.equal(state.detailsOverflowY, "visible", "les Informations suivent le défilement naturel de la page");
    assert.deepEqual(errors, [], `erreurs JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
