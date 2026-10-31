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
  async openHeaderDocument(type = "Registre") {
    documents[0].type = type;
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
      backUnderActions: (() => {
        const back = $("documentPageBackBtn").getBoundingClientRect();
        const actions = document.querySelector("#documentDetailView .dedicated-page-actions-row");
        return !actions || back.y >= actions.getBoundingClientRect().bottom - 1;
      })(),
      backRightAligned: (() => {
        const back = $("documentPageBackBtn").getBoundingClientRect();
        const header = document.querySelector("#documentDetailView .document-detail-header");
        return !!header && back.right <= header.getBoundingClientRect().right + 1;
      })(),
      returnRowAbsent: !document.querySelector("#documentDetailView .dedicated-page-return"),
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
      titleLabel: $("viewerTitle").getAttribute("aria-label"),
      titleLineClamp: getComputedStyle($("viewerTitle")).webkitLineClamp,
      tabsAbsent: !document.querySelector(".document-detail-tabs"),
      infoToggleVisible: getComputedStyle($("viewerDetailsBtn")).display !== "none",
      infoHidden: $("viewerDocumentDetails").hidden,
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
    assert.equal(state.backInsideHeader, true, "le Retour est intégré à l’en-tête (sous les actions)");
    assert.ok(state.backUnderActions, "le Retour est directement sous le groupe d’actions");
    assert.ok(state.backRightAligned, "le Retour est aligné à droite de l’en-tête");
    assert.equal(state.returnRowAbsent, true, "aucune ligne Retour résiduelle au-dessus de l’en-tête");
    assert.equal(state.categoryBadgeText, "Registre", "badge de catégorie renseigné");
    assert.equal(state.categoryBadgeHidden, false, "badge visible quand la catégorie existe");
    assert.equal(state.categoryBadgeRowHidden, false, "rangée de catégorie visible sous le titre");
    assert.ok(state.categoryBadgeRowRect.y >= state.titleRect.bottom, "badge placé sous le titre principal");
    assert.equal(state.subtitleAbsent, true, "aucun sous-titre sous le titre Document (lot G)");
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
    assert.equal(state.backVisibleLabel, "Retour", "libellé mobile « Retour » seul, sans destination (lot corrections)");
    assert.equal(state.backInsideHeader, true, "le Retour reste dans l’en-tête sur mobile");
    /* Lot G : plus d'onglets — volet Informations fermé par défaut sur mobile,
       ouvert par la bascule sous la visionneuse. */
    assert.equal(state.tabsAbsent, true, "aucun onglet Original/Informations à 320px");
    assert.equal(state.infoToggleVisible, true, "bascule Informations visible sous la visionneuse à 320px");
    assert.equal(state.infoVisible, false, "informations fermées par défaut à 320px");
    assert.equal(state.infoHidden, true, "volet replié à l'ouverture à 320px");
    assert.equal(await page.locator("#viewerImage").isVisible(), true, "le lecteur reste affiché à 320px");
    assert.equal(await page.locator("#viewerOriginalHeading").isVisible(), false, "libellé « Original » masqué sur mobile (lot corrections)");
    await page.click("#viewerDetailsBtn");
    assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true, "la bascule ouvre le volet Informations à 320px");
    /* Carte « Informations fichier » compacte : métadonnées sur deux colonnes
       (Type/Format, Taille/Date d'ajout), libellé et valeur sur une ligne,
       nom du fichier sur toute la largeur sous les métadonnées, bouton
       Transcrire compact avec cible ≥ 44 px. */
    const fileCard = await page.evaluate(() => {
      const section = [...document.querySelectorAll("#viewerDocumentDetailsContent .document-unified-section")].find(item => item.querySelector("h4")?.textContent === "Informations fichier");
      const facts = section.querySelector(".document-unified-facts--file");
      const cols = getComputedStyle(facts).gridTemplateColumns.split(" ").filter(value => value && value !== "none").length;
      const metadataFacts = [...facts.querySelectorAll(".document-unified-fact")].filter(item => !item.classList.contains("document-unified-fact--file-name"));
      const firstFact = metadataFacts[0];
      const lastFact = metadataFacts[metadataFacts.length - 1];
      const name = facts.querySelector(".document-unified-filename");
      const transcribe = section.querySelector("[data-transcribe-document]");
      const transcribeRect = transcribe.getBoundingClientRect();
      const factsRect = facts.getBoundingClientRect();
      return {
        cols,
        factDisplay: getComputedStyle(firstFact).display,
        factHeight: Math.round(firstFact.getBoundingClientRect().height),
        cardHeight: Math.round(section.getBoundingClientRect().height),
        nameAfterMetadata: Math.round(name.getBoundingClientRect().top - lastFact.getBoundingClientRect().bottom),
        nameOverflow: name.scrollWidth > name.clientWidth + 1,
        trWidth: Math.round(transcribeRect.width),
        trHeight: Math.round(transcribeRect.height),
        overflow: document.documentElement.scrollWidth > innerWidth,
        factsWidth: Math.round(factsRect.width)
      };
    });
    assert.equal(fileCard.cols, 2, "métadonnées sur deux colonnes (Type/Format, Taille/Date d’ajout)");
    assert.equal(fileCard.factDisplay, "flex", "libellé et valeur sur une ligne");
    assert.ok(fileCard.factHeight <= 24, `fait compact sur une ligne (${fileCard.factHeight}px)`);
    assert.ok(fileCard.cardHeight <= 280, `carte « Informations fichier » compacte (${fileCard.cardHeight}px, 388px avant)`);
    assert.ok(fileCard.nameAfterMetadata >= -1, `nom du fichier sous les métadonnées (${fileCard.nameAfterMetadata}px)`);
    assert.ok(fileCard.trHeight >= 44, `bouton Transcrire ≥ 44 px (${fileCard.trHeight}px)`);
    assert.ok(fileCard.trWidth < 81, `bouton Transcrire plus compact (${fileCard.trWidth}px, 81px avant)`);
    assert.equal(fileCard.overflow, false, "aucun débordement horizontal avec la carte compacte");
    /* Dépliage accessible du nom complet : clic = aria-expanded + dépliement,
       second clic = repli ellipsé — sans débordement horizontal. */
    await page.click(".document-unified-filename");
    const expanded = await page.locator(".document-unified-filename").first().evaluate(button => ({ expanded: button.getAttribute("aria-expanded"), cls: button.classList.contains("is-expanded") }));
    assert.equal(expanded.expanded, "true", "nom déplié au clic (aria-expanded)");
    assert.equal(expanded.cls, true, "classe de dépliage appliquée");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "aucun débordement en déplié");
    await page.click(".document-unified-filename");
    assert.equal(await page.locator(".document-unified-filename").first().getAttribute("aria-expanded"), "false", "nom replié au second clic");
    await page.click("#viewerDetailsBtn");
    assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), true, "la bascule referme le volet à 320px");
    assert.equal(state.subtitleAbsent, true, "aucun sous-titre résiduel à 320px");
    assert.equal(state.titleLineClamp, "2", "titre limité à deux lignes à 320px");
    assert.equal(state.titleLabel, state.title, "titre complet accessible à 320px");
    await page.setViewportSize({ width: 390, height: 844 });
    state = await page.evaluate(() => window.__documentPageTest.state());
    assert.equal(state.horizontalOverflow, false, "aucun débordement horizontal à 390px");
    assert.equal(state.pageWidth, 390, "la page Document utilise toute la largeur à 390px");
    assert.equal(state.pageMaxHeight, "none", "aucune hauteur maximale de modale à 390px");
    assert.equal(state.tabsAbsent, true, "aucun onglet Original/Informations à 390px");
    assert.equal(state.infoToggleVisible, true, "bascule Informations visible à 390px");
    assert.equal(state.infoHidden, true, "informations fermées par défaut à 390px");
    assert.equal(await page.locator("#viewerImage").isVisible(), true, "le lecteur reste affiché à 390px");
    assert.equal(await page.locator("#viewerOriginalHeading").isVisible(), false, "libellé « Original » masqué jusqu'à 760px");
    assert.equal(state.titleLineClamp, "2", "titre limité à deux lignes à 390px");
    assert.equal(state.titleLabel, state.title, "titre complet accessible à 390px");
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
    assert.equal(state.tabsAbsent, true, "aucun onglet Original/Informations sur ordinateur");
    /* Image affichée : le head Original était déjà masqué sur desktop (règle
       antérieure) — le lot corrections n'a rien changé de ce côté. */
    assert.equal(await page.locator("#viewerOriginalHeading").isVisible(), false, "head « Original » masqué pour une image, desktop inchangé");
    assert.equal(state.infoVisible, true, "panneau Informations desktop reste visible");
    assert.equal(state.detailsOverflowY, "visible", "les Informations suivent le défilement naturel de la page");

    /* Comparaison géométrique des trois en-têtes aux largeurs mobile et desktop. */
    const headerMeasure = viewId => page.evaluate(id => {
      const view = document.getElementById(id);
      const header = view.querySelector(".dedicated-page-header");
      const actions = header.querySelector(".dedicated-page-actions-row").getBoundingClientRect();
      const back = header.querySelector(".dedicated-page-back").getBoundingClientRect();
      const rect = header.getBoundingClientRect();
      return { actionBackGap: back.y - actions.bottom, rightInset: rect.right - back.right, height: rect.height };
    }, viewId);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.__documentPageTest.openHeaderSource());
      await page.evaluate(() => window.__documentPageTest.settle());
      const sourceGeometry = await headerMeasure("sourceDetailView");
      await page.evaluate(() => window.__documentPageTest.openHeaderProof());
      await page.evaluate(() => window.__documentPageTest.settle());
      const proofGeometry = await headerMeasure("proofDetailView");
      await page.evaluate(() => window.__documentPageTest.openHeaderDocument("Autre"));
      await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
      await page.evaluate(() => window.__documentPageTest.settle());
      const documentGeometry = await headerMeasure("documentDetailView");
      for (const [name, geometry] of [["Source", sourceGeometry], ["Preuve", proofGeometry]]) {
        assert.ok(Math.abs(documentGeometry.actionBackGap - geometry.actionBackGap) <= 1, `${width}px : espacement Retour/actions identique à ${name}`);
        assert.ok(Math.abs(documentGeometry.rightInset - geometry.rightInset) <= 1, `${width}px : alignement droit identique à ${name}`);
      }
      const categoryState = await page.evaluate(() => ({
        kicker: document.querySelector("#documentDetailView .document-detail-kicker").textContent.trim(),
        title: document.getElementById("viewerTitle").getBoundingClientRect(),
        badge: document.getElementById("viewerCategoryBadge").getBoundingClientRect(),
        header: document.querySelector("#documentDetailView .document-detail-header").getBoundingClientRect()
      }));
      assert.equal(categoryState.kicker, "Document", `${width}px : « DOCUMENT » seul au-dessus du titre`);
      assert.ok(categoryState.badge.y >= categoryState.title.bottom, `${width}px : « Autre » sous le titre`);
      assert.ok(categoryState.badge.bottom <= categoryState.header.bottom, `${width}px : badge contenu dans l'en-tête`);
      assert.ok(documentGeometry.height <= (width <= 390 ? 175 : 180), `${width}px : en-tête Document reste compact (${documentGeometry.height}px)`);
      const returnLabels = await page.evaluate(() => ({ visible: document.querySelector("#documentPageBackBtn .dedicated-page-back-label").textContent, aria: document.getElementById("documentPageBackBtn").getAttribute("aria-label") }));
      assert.equal(returnLabels.visible, width <= 760 ? "Retour" : returnLabels.aria, `${width}px : texte visible contextualisé uniquement sur desktop`);
      assert.notEqual(returnLabels.aria, "Retour", `${width}px : nom accessible contextualisé conservé`);

      await page.evaluate(() => window.__documentPageTest.openHeaderDocument(""));
      await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
      await page.evaluate(() => window.__documentPageTest.settle());
      state = await page.evaluate(() => window.__documentPageTest.state());
      assert.equal(state.categoryBadgeHidden, true, `${width}px : badge absent sans catégorie`);
      assert.equal(state.categoryBadgeRowHidden, true, `${width}px : rangée masquée sans catégorie`);
      assert.equal(state.categoryBadgeRowRect.height, 0, `${width}px : aucun espace réservé sans catégorie`);
    }
    assert.deepEqual(errors, [], `erreurs JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
