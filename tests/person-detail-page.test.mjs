import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const svg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#557a65"/></svg>');
const hooks = `
window.__personPageTest = {
  seed() {
    people = [
      { id: "person-page-a", firstName: "Ada", middleName: "Maria", lastName: "Rossi", marriedName: "Bianchi", gender: "F", branch: "Ramo Conti", birthDateInfo: { type: "year", year: 1890 }, place: "Palermo", deathDateInfo: { type: "year", year: 1931 }, deathPlace: "Metz", notes: "Note de consultation", photoUrl: "${svg}", updatedAt: { toDate: () => new Date("2026-10-24T03:30:00Z") }, updatedByName: "Archiviste", inTree: true },
      { id: "person-page-b", firstName: "Carlo", lastName: "Rossi", gender: "M", birthDateInfo: { type: "year", year: 1860 }, place: "Palermo" },
      { id: "person-page-c", firstName: "Lina", lastName: "Rossi", gender: "F" },
      { id: "person-page-d", firstName: "Rosa", middleName: "Margherita", lastName: "Conti", gender: "F", birthDateInfo: { type: "exact", value: "1904-08-25" }, place: "Esch-sur-Alzette", deathDateInfo: { type: "exact", value: "1931-07-28" }, deathPlace: "Metz", inTree: true },
      { id: "person-page-e", firstName: "Émile", lastName: "Conti", gender: "M", birthDateInfo: { type: "exact", value: "1902-02-02" }, inTree: true }
    ];
    families = [
      { id: "person-page-family", partnerIds: ["person-page-a", "person-page-b"], childIds: ["person-page-c"], relationType: "marriage", unionDateInfo: { type: "year", year: 1888 }, unionPlace: "Palermo", endType: "none", endDateInfo: { type: "unknown" }, parentChildLinks: [] },
      { id: "person-page-family-d", partnerIds: ["person-page-d", "person-page-e"], childIds: [], relationType: "marriage", unionDateInfo: { type: "exact", value: "1930-12-06" }, unionPlace: "Esch-sur-Alzette", endType: "none", endDateInfo: { type: "unknown" }, parentChildLinks: [] }
    ];
    documents = [
      { id: "person-page-document", title: "Acte de naissance d’Ada", type: "Acte", date: "1890-03-04", fileName: "acte.svg", mimeType: "image/svg+xml", externalUrl: "https://example.invalid/acte.svg", personIds: ["person-page-a"] },
      { id: "person-page-pdf", title: "Registre PDF", type: "Registre", fileName: "registre.pdf", mimeType: "application/pdf", personIds: ["person-page-a"] },
      { id: "person-page-image", title: "Photographie", type: "Photo", fileName: "portrait.jpg", mimeType: "application/octet-stream", personIds: ["person-page-a"] },
      { id: "person-page-unknown", title: "Fichier inconnu", type: "Archive", fileName: "fichier.bin", mimeType: "application/octet-stream", personIds: ["person-page-a"] }
    ];
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    genealogyRecords = {
      sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [],
      genealogyProofs: [{ id: "person-page-proof", data: { id: "person-page-proof", factId: "fact~person~person-page-a~birth", factType: "birth", personIds: ["person-page-a"], documentId: "person-page-document", relation: "supports", technicalStatus: "active", sourceValue: "1890" } }],
      genealogyProofRevisions: [],
      factConclusions: [{ id: "person-page-conclusion", data: { id: "person-page-conclusion", factId: "fact~person~person-page-a~birth", factType: "birth", revision: { status: "established", retainedValue: "1890" } } }],
      conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: []
    };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin", displayName: "Archiviste" };
    treeCatalogState = "ready";
    $("authScreen").hidden = true;
    $("topbar").hidden = false;
    renderTree();
    setView("directory");
  },
  update(id, data) {
    window.__personPageUpdates = [...(window.__personPageUpdates || []), { id, firstName: data.firstName, place: data.place, birthDateInfo: data.birthDateInfo }];
    people = people.map(item => item.id === id ? { ...item, ...data, updatedAt: { toDate: () => new Date("2026-11-04T12:00:00Z") }, updatedByName: "Archiviste" } : item);
  },
  openTree() { renderTree(); setView("tree"); },
  openDirectory() { setView("directory"); },
  state() {
    return {
      pageVisible: !$('personDetailView').hidden,
      directoryVisible: !$('directoryView').hidden,
      treeVisible: !$('appMain').hidden,
      documentVisible: !$('documentDetailView').hidden,
      title: $('personPageTitle').textContent,
      section: personPageActiveSection,
      returnKind: documentPageReturnContext?.kind || "",
      returnSection: documentPageReturnContext?.section || "",
      updateCount: (window.__personPageUpdates || []).length,
      noTechnicalJson: !$('personPageContent').querySelector("pre, code.json")
    };
  }
};
window.__personPageUpdates = [];
`;

test("la page Personne consulte les données, réutilise la modale et restaure le parcours Document", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 1280, height: 900 } });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const update = 'await updateDoc(doc(db, "people", id), data);';
      assert.ok(source.includes(update), "le point de sauvegarde personne doit rester celui de la modale existante");
      source = source.replace(update, "await window.__personPageTest.update(id, data);");
      return route.fulfill({ response, body: `${source}\n${hooks}` });
    }
    return isAllowedRequest(url, server.baseURL) || url.includes("gstatic.com")
      ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__personPageTest === "object");
    await page.evaluate(() => window.__personPageTest.seed());

    await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    assert.equal((await page.locator("#personPageTitle").textContent()).trim(), "Ada Maria Rossi");
    assert.match(await page.locator("#personPageContent").innerText(), /Nom d’usage[\s\S]*Bianchi/i);
    assert.match(await page.locator("#personPageContent").innerText(), /Parents|Partenaires et unions|Enfants/);
    assert.match(await page.locator("#personPageContent").innerText(), /Acte de naissance d’Ada/);
    assert.match(await page.locator("#personPageContent").innerText(), /Établie/);
    assert.equal(await page.locator("#personPageContent pre").count(), 0, "aucun JSON technique dans la page Personne");

    await page.locator('[data-person-page-section="family"]').click();
    await page.locator('[data-open-person-page="person-page-b"]').click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Carlo"));
    assert.equal(await page.locator("#personPageBackBtn").getAttribute("aria-label"), "Retour à la personne");
    assert.equal(await page.locator("#personPageEssentials .person-detail-status").count(), 0, "aucun badge Décédé sans date ni lieu de décès");
    await page.locator("#personPageBackBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Ada"));
    assert.equal((await page.evaluate(() => window.__personPageTest.state())).section, "family", "retour au membre précédent et à Famille");
    const adaStatus = await page.evaluate(() => {
      const badge = document.querySelector("#personPageEssentials .person-detail-status");
      const branch = document.querySelector("#personPageEssentials .person-detail-branch");
      const wrapper = document.querySelector("#personPageEssentials .person-detail-badges");
      const wrapperBox = wrapper.getBoundingClientRect();
      return {
        text: badge?.textContent.trim(),
        display: badge ? getComputedStyle(badge).display : "absent",
        sameLine: !!branch && Math.abs(branch.getBoundingClientRect().top - badge.getBoundingClientRect().top) <= 2,
        wrapperDisplay: wrapper ? getComputedStyle(wrapper).display : "absent",
        wrapperWidth: wrapperBox.width
      };
    });
    assert.equal(adaStatus.text, "Décédé", "badge Décédé affiché lorsque le décès est établi");
    assert.ok(["flex", "inline-flex"].includes(adaStatus.display), `badge Décédé visible sur desktop (${adaStatus.display})`);
    assert.equal(adaStatus.sameLine, true, "Décédé aligné sur la même ligne que le badge de l'arbre");
    assert.equal(adaStatus.wrapperDisplay, "flex", "les badges sont regroupés sur une ligne dédiée en desktop");

    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), false, "l’édition reste sur la page, sans ouvrir la modale");
    const inlineDesktop = await page.evaluate(() => {
      const panel = document.getElementById("personIdentityPanel");
      const timeline = document.getElementById("personLifeTimeline");
      const editor = document.getElementById("personPageEditHost");
      const documentCards = [...document.querySelectorAll("#personDocumentsPanel > .person-page-inline-card")];
      const relationAction = document.getElementById("toggleRelationBuilderBtn");
      const rect = element => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: box.height }; };
      return {
        panelDisplay: getComputedStyle(panel).display,
        panelWidth: panel.getBoundingClientRect().width,
        editorWidth: editor.getBoundingClientRect().width,
        timelineHidden: timeline.hidden,
        documentCards: documentCards.length,
        documentCardTitles: documentCards.map(card => card.querySelector("h3")?.textContent.trim()),
        documentCardStyles: documentCards.map(card => ({ background: getComputedStyle(card).backgroundColor, border: getComputedStyle(card).borderTopWidth, radius: getComputedStyle(card).borderTopLeftRadius })),
        documentCardRects: documentCards.map(rect),
        documentActions: [document.getElementById("linkDocumentBtn").textContent.trim(), document.getElementById("proofEntryPointLabel").textContent.trim()],
        documentActionHeaders: [document.getElementById("linkDocumentBtn"), document.getElementById("genealogyProposeProofForPersonBtn")].map(button => button.parentElement.classList.contains("person-page-inline-section-header")),
        relationHeaderAction: relationAction.parentElement.classList.contains("person-page-inline-section-header"),
        relationActionPrimary: relationAction.classList.contains("primary"),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        stickyActions: getComputedStyle(document.querySelector("#personPageEditHost .person-actions")).position
      };
    });
    assert.equal(inlineDesktop.panelDisplay, "block", "édition inline desktop : carte Identité pleine largeur");
    assert.ok(inlineDesktop.panelWidth >= inlineDesktop.editorWidth - 64, "carte Identité occupe toute la largeur utile");
    assert.equal(inlineDesktop.timelineHidden, true, "timeline masquée pendant la modification");
    assert.equal(inlineDesktop.documentCards, 2, "Documents associés et Recherches forment deux cartes distinctes");
    assert.deepEqual(inlineDesktop.documentCardTitles, ["Documents associés", "Recherches"]);
    assert.equal(inlineDesktop.documentCardStyles[0].background, inlineDesktop.documentCardStyles[1].background, "cartes Documents/Recherches sur fond identique");
    assert.equal(inlineDesktop.documentCardStyles[0].border, inlineDesktop.documentCardStyles[1].border, "cartes Documents/Recherches avec bordures identiques");
    assert.equal(inlineDesktop.documentCardStyles[0].radius, inlineDesktop.documentCardStyles[1].radius, "cartes Documents/Recherches avec arrondis identiques");
    assert.ok(inlineDesktop.documentCardRects[1].top - inlineDesktop.documentCardRects[0].bottom >= 12, "espace vertical entre les cartes Documents et Recherches");
    assert.deepEqual(inlineDesktop.documentActions, ["Ajouter un document", "Ajouter une preuve"]);
    assert.deepEqual(inlineDesktop.documentActionHeaders, [true, true], "actions d'ajout en haut de chaque carte");
    assert.equal(inlineDesktop.relationHeaderAction, true, "Ajouter un lien familial aligné sur le titre Famille");
    assert.equal(inlineDesktop.relationActionPrimary, false, "Ajouter un lien familial reste une action secondaire");
    assert.ok(inlineDesktop.overflow <= 1, `édition inline desktop sans débordement (${inlineDesktop.overflow}px)`);
    assert.equal(inlineDesktop.stickyActions, "sticky", "barre d’actions d’édition conservée");
    await page.locator("#personPageActions > summary").click();
    assert.equal(await page.locator("#personPageActionsMenu [data-person-page-action]").count(), 5, "menu ⋯ complet toujours disponible en modification");
    await page.locator('#personPageActionsMenu [data-person-page-action="print"]').focus();
    await page.keyboard.press("ArrowDown");
    const menuKeyboard = await page.evaluate(() => ({
      action: document.activeElement?.dataset.personPageAction,
      focusVisible: document.activeElement?.matches(":focus-visible"),
      outline: getComputedStyle(document.activeElement).outline
    }));
    assert.equal(menuKeyboard.action, "branch", "flèches clavier parcourent les actions du menu en modification");
    assert.equal(menuKeyboard.focusVisible, true, "la ligne active utilise le focus clavier visible");
    assert.match(menuKeyboard.outline, /solid 2px/, "contour de focus du menu visible");
    await page.keyboard.press("Escape");
    await page.locator("#personPageActions > summary").click();
    await page.locator("#toggleRelationBuilderBtn").click();
    await page.waitForFunction(() => !document.getElementById("relationBuilder").hidden);
    await page.locator("#closeRelationBuilderBtn").click();
    await page.waitForFunction(() => document.getElementById("relationBuilder").hidden);
    await page.locator("#firstName").fill("Adélaïde");
    await page.locator("#birthYear").fill("1891");
    await page.locator("#place").fill("Palermo modifiée");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Adélaïde"));
    assert.equal(await page.evaluate(() => window.__personPageTest.state().updateCount), 1, "la sauvegarde réutilise le point d’écriture existant");
    const savedInlineData = await page.evaluate(() => window.__personPageUpdates[0]);
    assert.equal(savedInlineData.place, "Palermo modifiée", "le lieu est enregistré depuis l’édition inline");
    assert.equal(savedInlineData.birthDateInfo.year, 1891, "la date est enregistrée depuis l’édition inline");
    assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), false, "la modale reste fermée après l’enregistrement en ligne");

    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.locator("#firstName").fill("Brouillon abandonné");
    await page.locator('#personPageEditHost [data-close="personDialog"]').click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    assert.match(await page.locator("#personPageTitle").textContent(), /Adélaïde/, "Annuler abandonne les valeurs locales");

    page.once("dialog", dialog => dialog.accept());
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.locator("#firstName").fill("Brouillon non enregistré");
    await page.locator("#personPageBackBtn").click();
    await page.waitForFunction(() => document.getElementById("personDetailView").hidden);

    await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    assert.match(await page.locator("#personPageTitle").textContent(), /Adélaïde/, "la sortie protégée n’enregistre pas le brouillon");
    await page.locator('[data-person-page-section="documents"]').click();
    await page.locator('#personPageDocuments [data-view-document="person-page-document"]').click();
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden, { timeout: 10000 });
    const documentState = await page.evaluate(() => window.__personPageTest.state());
    assert.equal(documentState.returnKind, "personPage");
    assert.equal(documentState.returnSection, "documents");
    await page.locator("#documentPageBackBtn").click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    assert.equal((await page.evaluate(() => window.__personPageTest.state())).section, "documents", "section d’origine restaurée après le Document");

    await page.locator('[data-person-page-section="research"]').click();
    await page.locator('#personPageContent [data-view-proof="person-page-proof"]').click();
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden, { timeout: 10000 });
    assert.equal(await page.locator("#proofPageBackBtn").getAttribute("aria-label"), "Retour à la personne");
    await page.locator("#proofPageContent [data-genealogy-person]").click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    await page.locator("#personPageBackBtn").click();
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden, { timeout: 10000 });
    await page.locator("#proofPageBackBtn").click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    assert.equal((await page.evaluate(() => window.__personPageTest.state())).section, "research", "section Recherches restaurée après la Preuve");

    for (const width of [320, 390, 430, 760, 768, 900, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => window.__personPageTest.openDirectory());
      await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
      await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
      const layout = await page.evaluate(() => {
        const isVisible = element => !!element && getComputedStyle(element).display !== "none" && element.getBoundingClientRect().height > 0;
        const rect = id => {
          const box = document.getElementById(id).getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
        };
        const desktopBack = document.getElementById("personPageBackBtn");
        const mobileBack = document.getElementById("personPageMobileBackBtn");
        const back = isVisible(desktopBack) ? desktopBack : mobileBack;
        const overview = document.getElementById("personPageOverview");
        const identity = document.getElementById("personPageIdentity");
        const timeline = document.getElementById("personPageTimeline");
        const timelineList = document.querySelector("#personPageTimeline ol");
        const timelineItems = [...timelineList.querySelectorAll(".timeline-jalon")];
        const familyCards = [...document.querySelectorAll("#personPageFamily .relation-person-row")];
        const pdfCard = document.querySelector("#personPageDocuments .person-doc-card--pdf");
        const imageCard = document.querySelector("#personPageDocuments .person-doc-card--image");
        const extensionImageCard = document.querySelector("#personPageDocuments [data-view-document='person-page-image']");
        const unknownCard = document.querySelector("#personPageDocuments .person-doc-card[data-view-document='person-page-unknown']");
        const research = document.querySelector("#personPageResearch .person-detail-research-card[role='button']");
        const header = document.getElementById("topbar");
        const account = document.getElementById("accountMenu");
        const brand = header.querySelector(".brand");
        const activeTab = document.querySelector("#personPageSectionNav [aria-current='location']");
        const personMenu = document.getElementById("personPageActionsMenu");
        const navSeparator = getComputedStyle(document.querySelector("#personPageSectionNav [data-person-page-section]:not(:last-child)"), "::after");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          viewport: document.documentElement.clientWidth,
          columns: getComputedStyle(document.getElementById("personPageContent")).gridTemplateColumns.split(" ").length,
          backCount: [desktopBack, mobileBack].filter(isVisible).length,
          backHeight: back.getBoundingClientRect().height,
          editHeight: document.getElementById("personPageEditBtn").getBoundingClientRect().height,
          mobileHeader: isVisible(document.getElementById("personPageMobileHeader")),
          overviewDisplay: getComputedStyle(overview).display,
          overviewColumns: getComputedStyle(overview).gridTemplateColumns.split(" ").length,
          overviewOrder: [...overview.children].map(section => section.id),
          identity: rect("personPageIdentity"),
          timeline: rect("personPageTimeline"),
          titleSize: getComputedStyle(document.getElementById("personPageTitle")).fontSize,
          sectionTitleSize: getComputedStyle(identity.querySelector("h3")).fontSize,
          navBackground: getComputedStyle(document.getElementById("personPageSectionNav")).backgroundColor,
          navBorderTop: getComputedStyle(document.getElementById("personPageSectionNav")).borderTopWidth,
          navBorderBottom: getComputedStyle(document.getElementById("personPageSectionNav")).borderBottomWidth,
          navHeight: document.getElementById("personPageSectionNav").getBoundingClientRect().height,
          navSeparator: { content: navSeparator.content, width: Number.parseFloat(navSeparator.width), height: Number.parseFloat(navSeparator.height) },
          activeTabBackground: getComputedStyle(activeTab).backgroundColor,
          backTop: rect("personPageBackBtn").top,
          backBottom: rect("personPageBackBtn").bottom,
          heroTop: document.querySelector(".person-detail-hero").getBoundingClientRect().top,
          globalHeaderBottom: header.getBoundingClientRect().bottom,
          actions: ["personPageEditBtn", "personPageViewTreeBtn", "personPageActions"].map(rect),
          actionDateVisible: isVisible(document.querySelector(".person-detail-modification--actions")),
          actionDateText: document.querySelector(".person-detail-modification--actions").textContent,
          actionDateDisplay: getComputedStyle(document.querySelector(".person-detail-modification--actions")).display,
          actionDateHeight: document.querySelector(".person-detail-modification--actions").getBoundingClientRect().height,
          actionDateRight: document.querySelector(".person-detail-modification--actions").getBoundingClientRect().right,
          essentialsDateVisible: isVisible(document.querySelector(".person-detail-modification--essentials")),
          genderBadgeVisible: isVisible(document.querySelector(".person-detail-gender")),
          familyWidths: familyCards.map(card => card.getBoundingClientRect().width),
          docTitleStyle: (() => {
            const style = getComputedStyle(document.querySelector("#personPageDocuments .person-doc-title"));
            return { size: Number.parseFloat(style.fontSize), weight: style.fontWeight, lineHeight: Number.parseFloat(style.lineHeight) };
          })(),
          timelineListStyle: getComputedStyle(timelineList).listStyleType,
          timelineLineDisplay: timelineItems.length ? getComputedStyle(timelineItems[0], "::after").display : "none",
          timelineDotDisplay: getComputedStyle(timelineList.querySelector(".timeline-dot")).display,
          timelineItemRects: timelineItems.map(item => {
            const itemRect = item.getBoundingClientRect();
            const dotRect = item.querySelector(".timeline-dot").getBoundingClientRect();
            const lineStyle = getComputedStyle(item, "::after");
            return { left: itemRect.left, top: itemRect.top, dotCenter: dotRect.left + dotRect.width / 2, dotTop: dotRect.top, dotHeight: dotRect.height, lineTop: Number.parseFloat(lineStyle.top), lineHeight: Number.parseFloat(lineStyle.height) };
          }),
          statusBadge: (() => {
            const badge = document.querySelector("#personPageEssentials .person-detail-status");
            return badge ? { text: badge.textContent.trim(), display: getComputedStyle(badge).display } : null;
          })(),
          timelineLayout: (() => {
            const card = timeline.getBoundingClientRect();
            const list = timelineList.getBoundingClientRect();
            const heading = timeline.querySelector("h3").getBoundingClientRect();
            const firstItem = timelineItems[0];
            const dot = firstItem.querySelector(".timeline-dot").getBoundingClientRect();
            const line = firstItem.querySelector(".timeline-line").getBoundingClientRect();
            const title = firstItem.querySelector(".timeline-title").getBoundingClientRect();
            const date = firstItem.querySelector(".timeline-date").getBoundingClientRect();
            return {
              ratio: Number((list.width / card.width).toFixed(3)),
              centeredGap: Math.abs((list.left - card.left) - (card.right - list.right)),
              headingToLine: dot.top - heading.bottom,
              lineToContent: line.top - (dot.top + dot.height / 2),
              dateBelowTitle: date.top >= title.bottom - 1,
              titleTransform: getComputedStyle(firstItem.querySelector(".timeline-title")).textTransform,
              ageCount: timelineList.querySelectorAll(".timeline-age").length
            };
          })(),
          pdfFormatDisplay: pdfCard && getComputedStyle(pdfCard.querySelector(".person-detail-document-format")).display,
          imageFormatDisplay: imageCard && getComputedStyle(imageCard.querySelector(".person-detail-document-format")).display,
          extensionImageFormatDisplay: getComputedStyle(extensionImageCard.querySelector(".person-detail-document-format")).display,
          pdfVisualDisplay: getComputedStyle(pdfCard.querySelector(".person-detail-document-format-visual")).display,
          imageVisualDisplay: getComputedStyle(extensionImageCard.querySelector(".person-detail-document-format-visual")).display,
          pdfVisualText: pdfCard.querySelector(".person-detail-document-format-visual").textContent.trim(),
          imageVisualText: extensionImageCard.querySelector(".person-detail-document-format-visual").textContent.trim(),
          unknownVisualHref: unknownCard.querySelector(".person-detail-document-format-visual use")?.getAttribute("href"),
          pdfMetadata: pdfCard.querySelector(".person-detail-document-format").textContent.trim(),
          imageMetadata: extensionImageCard.querySelector(".person-detail-document-format").textContent.trim(),
          pdfMetadataIcons: pdfCard.querySelectorAll(".person-detail-document-format .ui-icon").length,
          imageMetadataIcons: extensionImageCard.querySelectorAll(".person-detail-document-format .ui-icon").length,
          unknownFormat: unknownCard.querySelector(".person-detail-document-format"),
          researchChevron: research ? getComputedStyle(research, "::after").content : "none",
          accountRight: account.getBoundingClientRect().right,
          brandLeft: brand.getBoundingClientRect().left,
          accountColumn: getComputedStyle(account).gridColumnStart,
          brandColumn: getComputedStyle(brand).gridColumnStart,
          menuActions: [...personMenu.querySelectorAll("[data-person-page-action]")].map(button => ({ action: button.dataset.personPageAction, icon: button.querySelector("use")?.getAttribute("href"), border: getComputedStyle(button).borderTopWidth })),
          mobileMenuTransferIcon: document.querySelector("#personPageMobileActionsMenu [data-person-page-action='change-tree'] use")?.getAttribute("href"),
          menuBorder: getComputedStyle(personMenu).borderTopWidth,
          menuShadow: getComputedStyle(personMenu).boxShadow
        };
      });
      assert.ok(layout.overflow <= 1, `${width}px : aucun débordement horizontal (${layout.overflow}px)`);
      assert.equal(layout.backCount, 1, `${width}px : un seul bouton Retour visible (desktop/mobile)`);
      assert.ok(layout.backHeight >= 44 && layout.editHeight >= 44, `${width}px : cibles tactiles suffisantes`);
      assert.equal(layout.columns, 1, `${width}px : contenu de lecture en une colonne maîtrisée`);
      if (width <= 900) {
        assert.equal(layout.mobileHeader, width <= 760, `${width}px : en-tête adapté au breakpoint existant`);
        assert.deepEqual(layout.overviewOrder, ["personPageTimeline", "personPageIdentity"], `${width}px : ordre de lecture historique conservé`);
        assert.ok(layout.timeline.top < layout.identity.top, `${width}px : ordre timeline/identité conservé`);
        assert.equal(layout.pdfFormatDisplay, "none", `${width}px : nouvelle icône PDF absente sur tablette/mobile`);
        assert.equal(layout.imageFormatDisplay, "none", `${width}px : nouvelle icône image absente sur tablette/mobile`);
        assert.equal(layout.pdfVisualDisplay, "none", `${width}px : pictogramme PDF desktop absent sur tablette/mobile`);
        assert.equal(layout.imageVisualDisplay, "none", `${width}px : pictogramme image desktop absent sur tablette/mobile`);
        assert.equal(layout.researchChevron, "none", `${width}px : aucun chevron ajouté aux recherches sur tablette/mobile`);
        assert.equal(layout.navSeparator.content, "none", `${width}px : aucun séparateur vertical ajouté sur tablette/mobile`);
        assert.equal(layout.mobileMenuTransferIcon, "#icon-tree", `${width}px : menu mobile conserve son icône historique`);
        assert.equal(layout.statusBadge && layout.statusBadge.display, "none", `${width}px : badge Décédé absent sur mobile/tablette`);
        assert.equal(layout.timelineLayout.ageCount, 0, `${width}px : aucun âge affiché pour des dates incomplètes`);
        assert.notEqual(layout.docTitleStyle.size, 13, `${width}px : typographie desktop des documents non appliquée sur mobile/tablette`);
      } else {
        assert.equal(layout.mobileHeader, false, `${width}px : en-tête mobile masqué sur desktop`);
        assert.deepEqual(layout.overviewOrder, ["personPageIdentity", "personPageTimeline"], `${width}px : ordre de lecture desktop aligné sur la présentation`);
        assert.equal(layout.overviewDisplay, "grid", `${width}px : grille Identité/Parcours de vie`);
        assert.equal(layout.overviewColumns, 2, `${width}px : deux colonnes Identité/Parcours`);
        assert.ok(Math.abs(layout.identity.height - layout.timeline.height) <= 1, `${width}px : cartes Identité et Parcours de vie de même hauteur`);
        assert.ok(layout.identity.left < layout.timeline.left, `${width}px : Identité à gauche, Parcours à droite`);
        assert.equal(layout.backTop < layout.heroTop, true, `${width}px : retour au-dessus de la carte`);
        assert.ok(layout.backTop >= layout.globalHeaderBottom - 1, `${width}px : retour sous l'en-tête global`);
        assert.ok(layout.heroTop - layout.backBottom >= 8, `${width}px : espace suffisant entre le retour et la carte (${Math.round(layout.heroTop - layout.backBottom)}px)`);
        assert.ok(Number.parseFloat(layout.titleSize) >= 30, `${width}px : nom de personne ≥30px (${layout.titleSize})`);
        assert.equal(layout.sectionTitleSize, "20px", `${width}px : titre principal commun de 20px`);
        assert.equal(layout.navBackground, "rgb(247, 243, 234)", `${width}px : barre de sections sur fond ivoire`);
        assert.equal(layout.navBorderTop, "1px", `${width}px : bordure supérieure de la barre visible`);
        assert.equal(layout.navBorderBottom, "1px", `${width}px : séparateur unique sous la navigation`);
        assert.equal(layout.navSeparator.content, '""', `${width}px : séparateurs verticaux discrets visibles`);
        assert.ok(layout.navSeparator.width <= 1 && layout.navSeparator.height < layout.navHeight, `${width}px : séparateurs courts sans toucher aux bordures`);
        assert.equal(layout.activeTabBackground, "rgb(232, 239, 233)", `${width}px : onglet actif vert clair`);
        assert.deepEqual(layout.actions.map(action => Math.round(action.left)).sort((a, b) => a - b), layout.actions.map(action => Math.round(action.left)), `${width}px : ordre CTA Modifier, Voir dans l’arbre, menu ⋯`);
        assert.ok(layout.actions[0].left < layout.actions[1].left && layout.actions[1].left < layout.actions[2].left, `${width}px : ordre CTA gauche-droite`);
        assert.ok(layout.actionDateVisible && !layout.essentialsDateVisible, `${width}px : date de modification sous les CTA uniquement (${layout.actionDateDisplay}, h=${layout.actionDateHeight}, essentials=${layout.essentialsDateVisible})`);
        assert.match(layout.actionDateText, /4 novembre 2026/, `${width}px : date réelle de dernière modification affichée`);
        assert.ok(layout.actionDateRight <= layout.actions[2].right + 1, `${width}px : date alignée dans la colonne des CTA`);
        assert.equal(layout.genderBadgeVisible, false, `${width}px : badge Homme/Femme absent de l’en-tête`);
        assert.ok(layout.familyWidths.every(cardWidth => cardWidth <= 500), `${width}px : cartes Famille limitées à 500px`);
        assert.equal(layout.timelineListStyle, "none", `${width}px : aucun numéro parasite dans la timeline`);
        assert.equal(layout.timelineLineDisplay, "block", `${width}px : liaison horizontale entre événements`);
        assert.notEqual(layout.timelineDotDisplay, "none", `${width}px : pastilles visibles`);
        assert.equal(layout.timelineItemRects.length, 3, `${width}px : naissance, mariage et décès seulement`);
        assert.ok(layout.timelineItemRects[0].left < layout.timelineItemRects[1].left && layout.timelineItemRects[1].left < layout.timelineItemRects[2].left, `${width}px : événements ordonnés horizontalement`);
        assert.ok(layout.timelineItemRects.every(item => Math.abs(item.top - layout.timelineItemRects[0].top) < 1), `${width}px : pastilles sur une même rangée`);
        assert.ok(layout.timelineItemRects.every(item => Math.abs(item.dotTop + item.dotHeight / 2 - item.top - item.lineTop - item.lineHeight / 2) <= 1), `${width}px : trait horizontal centré sur les pastilles`);
        assert.ok(layout.timelineLayout.ratio >= 0.75 && layout.timelineLayout.ratio <= 0.9, `${width}px : timeline centrée sur environ 84% de la carte (ratio ${layout.timelineLayout.ratio})`);
        assert.ok(layout.timelineLayout.centeredGap <= 4, `${width}px : timeline centrée horizontalement (écart ${layout.timelineLayout.centeredGap}px)`);
        assert.ok(layout.timelineLayout.headingToLine >= 22 && layout.timelineLayout.headingToLine <= 30, `${width}px : respiration titre → ligne (${Math.round(layout.timelineLayout.headingToLine)}px)`);
        assert.ok(layout.timelineLayout.lineToContent >= 18 && layout.timelineLayout.lineToContent <= 24, `${width}px : respiration ligne → informations (${Math.round(layout.timelineLayout.lineToContent)}px)`);
        assert.equal(layout.timelineLayout.dateBelowTitle, true, `${width}px : date sur son propre niveau sous le libellé`);
        assert.equal(layout.timelineLayout.titleTransform, "uppercase", `${width}px : libellés d'événements en capitales`);
        assert.equal(layout.timelineLayout.ageCount, 0, `${width}px : aucun âge avec des dates de naissance/mariage partielles`);
        assert.equal(layout.statusBadge && ["flex", "inline-flex"].includes(layout.statusBadge.display), true, `${width}px : badge Décédé visible sur desktop (${layout.statusBadge && layout.statusBadge.display})`);
        assert.equal(layout.docTitleStyle.size, 13, `${width}px : titre documentaire à 13px`);
        assert.equal(layout.docTitleStyle.weight, "600", `${width}px : titre documentaire en graisse 600`);
        assert.ok(Math.abs(layout.docTitleStyle.lineHeight - 18.2) <= 0.5, `${width}px : interligne documentaire ≈ 1,4 (${layout.docTitleStyle.lineHeight}px)`);
        assert.match(layout.pdfFormatDisplay, /flex/, `${width}px : fichier PDF identifié par son format réel`);
        assert.match(layout.imageFormatDisplay, /flex/, `${width}px : image identifiée par son format réel`);
        assert.match(layout.extensionImageFormatDisplay, /flex/, `${width}px : extension image utilisée si le MIME est générique`);
        assert.equal(layout.pdfVisualDisplay, "grid", `${width}px : pictogramme PDF dans la partie supérieure`);
        assert.equal(layout.imageVisualDisplay, "grid", `${width}px : pictogramme Image dans la partie supérieure`);
        assert.equal(layout.pdfVisualText, "", `${width}px : aucun libellé PDF sous le pictogramme supérieur`);
        assert.equal(layout.imageVisualText, "", `${width}px : aucun libellé Image sous le pictogramme supérieur`);
        assert.equal(layout.pdfMetadata, "PDF", `${width}px : format PDF conservé en texte dans les métadonnées`);
        assert.equal(layout.imageMetadata, "Image", `${width}px : format Image conservé en texte dans les métadonnées`);
        assert.equal(layout.pdfMetadataIcons, 0, `${width}px : aucun pictogramme répété dans les métadonnées PDF`);
        assert.equal(layout.imageMetadataIcons, 0, `${width}px : aucun pictogramme répété dans les métadonnées Image`);
        assert.equal(layout.unknownVisualHref, "#icon-document", `${width}px : pictogramme générique pour format inconnu`);
        assert.equal(layout.unknownFormat, null, `${width}px : repli générique pour type inconnu`);
        assert.equal(layout.researchChevron, '"›"', `${width}px : chevron sur les recherches ouvrables`);
        assert.ok(layout.accountRight >= layout.viewport - 64 && layout.accountColumn === "3" && layout.brandColumn === "1", `${width}px : compte à droite et marque à gauche (${layout.brandLeft}/${layout.accountRight})`);
        assert.deepEqual(layout.menuActions.map(item => item.action), ["print", "branch", "change-tree", "remove-tree", "delete"], `${width}px : cinq actions dans le menu ⋯`);
        assert.deepEqual(layout.menuActions.slice(1, 4).map(item => item.icon), ["#icon-tree", "#icon-transfer", "#icon-unlink"], `${width}px : icônes distinctes pour les actions arbre`);
        assert.equal(layout.mobileMenuTransferIcon, "#icon-tree", `${width}px : icône mobile non modifiée`);
        assert.ok(layout.menuActions.every(item => item.border === "0px"), `${width}px : lignes de menu sans contours individuels`);
        assert.equal(layout.menuBorder, "1px", `${width}px : bordure unique du menu`);
        assert.notEqual(layout.menuShadow, "none", `${width}px : ombre légère du menu`);
      }
    }

    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => window.__personPageTest.openDirectory());
      await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
      await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
      await page.locator("#personPageEditBtn").click();
      await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
      const inlineResponsive = await page.evaluate(() => ({
        timelineInHost: document.getElementById("personLifeTimeline").parentElement === document.getElementById("personPageEditHost"),
        panelDisplay: getComputedStyle(document.getElementById("personIdentityPanel")).display,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        actions: getComputedStyle(document.querySelector("#personPageEditHost .person-actions")).position
      }));
      assert.equal(inlineResponsive.timelineInHost, true, `${width}px : placement historique de la timeline inline conservé`);
      assert.notEqual(inlineResponsive.panelDisplay, "grid", `${width}px : nouvelle grille desktop non appliquée au mode tablette/mobile`);
      assert.ok(inlineResponsive.overflow <= 1, `${width}px : édition sans débordement (${inlineResponsive.overflow}px)`);
      assert.equal(inlineResponsive.actions, "sticky", `${width}px : barre Enregistrer/Annuler conservée`);
      await page.locator('#personPageEditHost [data-close="personDialog"]').click();
      await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    }

    // Timeline : âges calculés uniquement lorsque les dates sont exactes.
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-d"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const exactAges = await page.evaluate(() => ({
      titles: [...document.querySelectorAll("#personPageTimeline .timeline-title")].map(node => node.textContent.trim()),
      ages: [...document.querySelectorAll("#personPageTimeline .timeline-age")].map(node => node.textContent.trim()),
      ageDisplay: getComputedStyle(document.querySelector("#personPageTimeline .timeline-age")).display
    }));
    assert.deepEqual(exactAges.titles, ["Naissance", "Mariage", "Décès"], "parcours complet : naissance, mariage, décès");
    assert.deepEqual(exactAges.ages, ["· 26 ans", "· 26 ans"], "âges au mariage et au décès, aucun à la naissance");
    assert.ok(["inline", "block"].includes(exactAges.ageDisplay), `âge visible sur desktop (${exactAges.ageDisplay})`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-d"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const mobileExact = await page.evaluate(() => ({
      age: getComputedStyle(document.querySelector("#personPageTimeline .timeline-age")).display,
      status: getComputedStyle(document.querySelector("#personPageEssentials .person-detail-status")).display,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    assert.equal(mobileExact.age, "none", "âge masqué sur mobile");
    assert.equal(mobileExact.status, "none", "badge Décédé masqué sur mobile");
    assert.ok(mobileExact.overflow <= 1, `mobile sans débordement (${mobileExact.overflow}px)`);

    // Navigation par ancres : haut de section sous la barre sticky de navigation.
    const measureAnchor = () => page.evaluate(() => {
      const nav = document.getElementById("personPageSectionNav").getBoundingClientRect();
      const active = document.querySelector("#personPageSectionNav [aria-current='location']");
      const target = {
        identity: document.getElementById("personPageOverview"),
        family: document.getElementById("personPageFamily"),
        documents: document.getElementById("personPageDocuments"),
        research: document.getElementById("personPageResearch")
      }[active.dataset.personPageSection];
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const stickyTop = Number.parseFloat(getComputedStyle(document.getElementById("personPageSectionNav")).top);
      const targetTop = target.getBoundingClientRect().top;
      return {
        gap: targetTop - (stickyTop + nav.height),
        gapNow: targetTop - nav.bottom,
        saturated: window.scrollY >= maxScroll - 1,
        scrollY: Math.round(window.scrollY),
        offsetVar: document.documentElement.style.getPropertyValue("--person-page-anchor-offset"),
        scrollMargin: getComputedStyle(target).scrollMarginTop
      };
    });
    const clickSection = async section => {
      await page.locator(`[data-person-page-section="${section}"]`).click();
      await page.waitForTimeout(800);
      return measureAnchor();
    };
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => window.__personPageTest.openDirectory());
      await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
      await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
      await page.waitForTimeout(400);
      for (const [from, to] of [["identity", "documents"], ["documents", "identity"], ["research", "identity"], ["family", "research"], ["research", "family"]]) {
        for (const [label, section] of [[from, from], [`${from} → ${to}`, to]]) {
          const result = await clickSection(section);
          assert.ok(result.gapNow >= 0, `${width}px : ${label} — titre non masqué par la barre (${Math.round(result.gapNow)}px)`);
          if (!result.saturated) assert.ok(result.gap >= 14 && result.gap <= 24, `${width}px : ${label} — section sous la barre sticky (${Math.round(result.gap)}px)`);
        }
      }
      // Retour vers une section déjà active après défilement manuel.
      await clickSection("documents");
      await page.evaluate(() => window.scrollBy({ top: 300, behavior: "instant" }));
      const afterManual = await clickSection("documents");
      assert.ok(afterManual.gapNow >= 0, `${width}px : réactivation après défilement manuel — titre non masqué (${Math.round(afterManual.gapNow)}px)`);
      if (!afterManual.saturated) assert.ok(afterManual.gap >= 14 && afterManual.gap <= 24, `${width}px : réactivation après défilement manuel (${Math.round(afterManual.gap)}px)`);
    }

    // Lien Retour : position identique en consultation et en modification (1280 px).
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const backConsultation = await page.evaluate(() => document.getElementById("personPageBackBtn").getBoundingClientRect().top);
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    const backEdition = await page.evaluate(() => document.getElementById("personPageBackBtn").getBoundingClientRect().top);
    assert.ok(Math.abs(backConsultation - backEdition) <= 1, `retour à position identique en consultation et modification (${backConsultation}px / ${backEdition}px)`);
    await page.locator('#personPageEditHost [data-close="personDialog"]').click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);

    await page.evaluate(() => window.__personPageTest.openTree());
    await page.waitForSelector("#treeScene .person");
    await page.locator('#treeScene .person[data-person-id="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    assert.equal((await page.locator("#personPageTitle").textContent()).trim(), "Adélaïde Maria Rossi", "ouverture de la page depuis l’arbre");
    assert.deepEqual(errors, [], `aucune erreur JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
