import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const hooks = `
window.__sourcePageTest = {
  show(view = "genealogy") { $("authScreen").hidden = true; $("topbar").hidden = false; setView(view); },
  seed() {
    const firestoreTimestamp = { toDate() { return new Date("2024-01-01T00:00:00Z"); } };
    const source = {
      id: "source-page-fixture", title: "Registre paroissial — titre de démonstration très long pour vérifier le retour à la ligne",
      status: "active", category: "État civil", date: "1897", placeOrTerritory: "Palermo",
      holdingOrganization: "Archives communales", fondsSeries: "Registres paroissiaux", cote: "A-123", subCote: "B-4",
      archivalReferences: [{ label: "Folio", value: "18 verso" }], personIds: ["person-source-fixture"], documentIds: ["document-page-fixture"],
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
    people = [{ id: "person-source-fixture", firstName: "Marie", middleName: "", lastName: "Rossi", birthDate: "1880", deathDate: "", place: "", partnerIds: [], childIds: [] }];
    loadedPeople = true;
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin" };
    adminUsersCache = [{ id: "fixture-author", displayName: "Auteur de démonstration" }];
    renderGenealogyWorkspace();
  },
  openSource() { openGenealogyItem("source", "source-page-fixture"); },
  setSourceTitleToDocument() {
    genealogyRecords.sourceDocuments[0].data.title = documents[0].title;
    refreshOpenSourcePage();
  },
  removeSourceDocumentAssociation() {
    genealogyRecords.sourceDocuments[0].data.documentIds = [];
    refreshOpenSourcePage();
  },
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
      actionHeight: (() => { const pageMenu = document.querySelector('#sourcePageActions > summary'); const box = pageMenu.getBoundingClientRect(); return box.height > 0 && getComputedStyle(pageMenu).display !== "none" ? box.height : document.querySelector('#sourceMobileActions > summary').getBoundingClientRect().height; })(),
      reviseHeight: $("sourcePageReviseBtn").getBoundingClientRect().height,
      reviseY: $("sourcePageReviseBtn").getBoundingClientRect().y,
      menuY: (() => { const pageMenu = document.querySelector('#sourcePageActions > summary'); const box = pageMenu.getBoundingClientRect(); return box.height > 0 && getComputedStyle(pageMenu).display !== "none" ? box.y : document.querySelector('#sourceMobileActions > summary').getBoundingClientRect().y; })(),
      backHeight: (() => { const pageBack = document.querySelector('#sourcePageBackBtn'); const box = pageBack.getBoundingClientRect(); return box.height > 0 && getComputedStyle(pageBack).display !== "none" ? box.height : document.querySelector('#sourceMobileBackBtn').getBoundingClientRect().height; })(),
      backVisibleLabel: document.querySelector('#sourcePageBackBtn .dedicated-page-back-label')?.textContent || "",
      mobileHeaderVisible: (() => { const header = document.querySelector('#sourceMobileHeader'); return getComputedStyle(header).display !== "none" && header.getBoundingClientRect().height > 0; })(),
      mobileBackHeight: document.querySelector('#sourceMobileBackBtn').getBoundingClientRect().height,
      mobileBackLabel: document.querySelector('#sourceMobileBackBtn').getAttribute("aria-label") || "",
      mobileTitleCenterDelta: (() => { const box = document.querySelector('#sourceMobileHeader > strong').getBoundingClientRect(); return Math.round((box.left + box.right) / 2 - innerWidth / 2); })(),
      contentBackDisplay: getComputedStyle(document.querySelector('#sourcePageBackBtn')).display,
      pageMenuDisplay: getComputedStyle(document.querySelector('#sourcePageActions')).display,
      mobileMenuHeight: document.querySelector('#sourceMobileActions > summary').getBoundingClientRect().height,
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
    /* Personnes associées : pastille commune ivoire, centrée et cliquable. */
    const personChip = page.locator("#sourcePageContent .document-unified-people .person-chip-consult").first();
    assert.equal(await personChip.count(), 1, "section personnes commune présente sur la Source");
    assert.match(await personChip.textContent(), /Rossi Marie/);
    assert.equal(await personChip.getAttribute("data-genealogy-person"), "person-source-fixture");
    const chipStyle = await personChip.evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, justify: style.justifyContent, align: style.alignItems, textAlign: style.textAlign };
    });
    assert.equal(chipStyle.background, "rgb(255, 253, 248)", "fond ivoire du design system");
    assert.equal(chipStyle.justify, "center", "icône + nom centrés ensemble horizontalement");
    assert.equal(chipStyle.align, "center", "contenu centré verticalement");
    assert.equal(chipStyle.textAlign, "center", "texte centré dans la pastille");
    assert.equal(await page.locator("#sourcePageContent .source-detail-fact strong", { hasText: "Personnes concernées" }).count(), 0, "plus de fait texte brut pour les personnes");
    assert.equal(await page.locator("#sourcePageBackBtn").getAttribute("aria-label"), "Retour aux archives");
    assert.equal(await page.locator("#sourcePageBackBtn .dedicated-page-back-label").textContent(), "Retour aux archives", "destination réelle affichée en clair (desktop)");
    assert.equal(await page.locator("#sourcePageBackBtn").evaluate(element => getComputedStyle(element).fontSize), "14px", "Retour commun en 14 px");
    const restingDecoration = await page.locator("#sourcePageBackBtn").evaluate(element => ({ arrow: getComputedStyle(element.querySelector(".dedicated-page-back-arrow")).textDecorationLine, label: getComputedStyle(element.querySelector(".dedicated-page-back-label")).textDecorationLine }));
    assert.equal(restingDecoration.arrow, "none", "flèche Retour non soulignée au repos");
    assert.equal(restingDecoration.label, "none", "texte Retour non souligné au repos");
    await page.locator("#sourcePageBackBtn").hover();
    const returnDecoration = await page.locator("#sourcePageBackBtn").evaluate(element => ({ arrow: getComputedStyle(element.querySelector(".dedicated-page-back-arrow")).textDecorationLine, label: getComputedStyle(element.querySelector(".dedicated-page-back-label")).textDecorationLine }));
    assert.equal(returnDecoration.arrow, "none", "flèche Retour jamais soulignée");
    assert.ok(returnDecoration.label.includes("underline"), "seul le texte Retour est souligné au survol");
    await page.locator("#sourcePageBackBtn").focus();
    assert.equal(await page.locator("#sourcePageBackBtn").evaluate(element => getComputedStyle(element).outlineStyle), "solid", "lien Retour conserve un focus clavier visible");
    assert.equal(await page.locator(".topbar .main-nav").evaluate(element => getComputedStyle(element).display), "none", "navigation masquée dans la fiche Source");
    assert.match(await page.locator("#sourceDetailView .consultation-breadcrumb").innerText(), /Documents[\s\S]*Acte d’essai[\s\S]*Registre paroissial/);
    assert.equal(await page.locator("#sourcePageBreadcrumb [aria-current='page']").count(), 1, "le dernier niveau du fil reste la Source courante, non cliquable");
    assert.ok(await page.locator("#sourcePageBreadcrumb .consultation-breadcrumb-intermediate[data-consultation-breadcrumb-action='document']").isVisible(), "document associé réellement cliquable dans le fil");
    await page.click("#sourcePageBreadcrumb [data-consultation-breadcrumb-action='document']");
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    assert.equal(await page.locator("#viewerTitle").textContent(), "Acte d’essai", "le niveau Document ouvre sa fiche réelle");
    await page.click("#documentPageBackBtn");
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    /* Retour sur la première ligne, Réviser/actions avec les pastilles sur la seconde. */
    const backGeometry = await page.evaluate(() => {
      const back = document.getElementById("sourcePageBackBtn").getBoundingClientRect();
      const header = document.querySelector("#sourceDetailView .dedicated-page-header");
      const headerRect = header.getBoundingClientRect();
      const actions = header.querySelector(".dedicated-page-actions-row").getBoundingClientRect();
      const breadcrumb = header.querySelector(".consultation-breadcrumb").getBoundingClientRect();
      const badges = header.querySelector("#sourcePageBadges").getBoundingClientRect();
      return {
        inside: !!header.querySelector("#sourcePageBackBtn"),
        sameTopLine: Math.abs(back.y - breadcrumb.y) < 2,
        centerAligned: Math.abs((back.y + back.height / 2) - (breadcrumb.y + breadcrumb.height / 2)) < 1,
        badgesWithActions: Math.abs((badges.y + badges.height / 2) - (actions.y + actions.height / 2)) < 2,
        rightAligned: back.right <= headerRect.right + 1,
        returnRowAbsent: !document.querySelector("#sourceDetailView .dedicated-page-return")
      };
    });
    assert.equal(backGeometry.inside, true, "le Retour est dans l'en-tête");
    assert.ok(backGeometry.sameTopLine, "le Retour est aligné sur le fil d’Ariane");
    assert.ok(backGeometry.centerAligned, "le Retour est centré verticalement sur le fil");
    assert.ok(backGeometry.badgesWithActions, "pastilles et actions partagent la seconde ligne");
    assert.ok(backGeometry.rightAligned, "le Retour est aligné à droite de l'en-tête");
    assert.equal(backGeometry.returnRowAbsent, true, "aucune ligne Retour résiduelle au-dessus de l'en-tête");
    const revisionHistory = await page.locator("#sourcePageContent .source-detail-history").innerText();
    assert.doesNotMatch(revisionHistory, /Invalid Date|fixture-author|source-revision-/);
    assert.match(revisionHistory, /Auteur de démonstration/);
    assert.match(revisionHistory, /Date non renseignée/);
    assert.equal(await page.locator("#sourcePageContent .source-detail-history time").count(), 5, "dates historiques rendues en éléments time");
    await page.click("#sourcePageBackBtn");
    await page.waitForFunction(() => document.getElementById("sourceDetailView").hidden);
    assert.notEqual(await page.locator(".topbar .main-nav").evaluate(element => getComputedStyle(element).display), "none", "navigation générale rétablie après le retour aux Archives");

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
    assert.ok(state.scrollY <= 40, `fiche Source ouverte depuis son haut malgré Archives défilée (scrollY=${state.scrollY}, départ ${initialScroll})`);
    assert.equal(await page.locator("#sourcePageBackBtn").getAttribute("aria-label"), "Retour aux archives");
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
    assert.equal(await page.locator("#documentPageBackBtn").getAttribute("aria-label"), "Retour à la source");
    state = await page.evaluate(() => window.__sourcePageTest.state());
    assert.equal(state.sourceVisible, false, "la page Document remplace la page Source");
    assert.equal(state.viewerOpen, true, "lecteur de document affiché");
    await page.click("#documentPageBackBtn");
    await page.waitForFunction(() => document.getElementById("documentDetailView").hidden);
    assert.equal((await page.evaluate(() => window.__sourcePageTest.state())).sourceVisible, true, "retour direct à la Source");

    /* Source → Preuve → Source : retour contextuel vers la page Source. */
    await page.locator('#sourcePageContent [data-open-genealogy="proof"]').click();
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    assert.equal(await page.locator("#proofPageBackBtn").getAttribute("aria-label"), "Retour à la source");
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
    for (const width of [320, 375, 390, 760]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.__sourcePageTest.openSource());
      state = await page.evaluate(() => window.__sourcePageTest.state());
      assert.equal(state.horizontalOverflow, false, `aucun défilement horizontal à ${width}px`);
      assert.equal(await page.locator("#sourcePageTitle").evaluate(element => getComputedStyle(element).whiteSpace), "nowrap", `titre de Source jamais coupé en milieu de mot à ${width}px`);
      if (width <= 480) {
        assert.equal(await page.locator("#sourcePageBreadcrumb .consultation-breadcrumb-intermediate").isVisible(), false, `titre intermédiaire remplacé par … à ${width}px`);
        assert.equal(await page.locator("#sourcePageBreadcrumb .consultation-breadcrumb-overflow summary").isVisible(), true, `niveau intermédiaire accessible via le menu à ${width}px`);
        await page.locator("#sourcePageBreadcrumb .consultation-breadcrumb-overflow summary").click();
        await page.locator("#sourcePageBreadcrumb .consultation-breadcrumb-overflow-menu [data-consultation-breadcrumb-action='document']").click();
        await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
        await page.click("#documentMobileBackBtn");
        await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
      }
      /* Header mobile harmonisé (modèle fiche Personne) : chevron à gauche,
         titre centré, menu monté dans la topbar, plus aucun Retour en page. */
      assert.equal(state.mobileHeaderVisible, true, `header mobile de consultation visible à ${width}px`);
      assert.ok(state.mobileBackHeight >= 44, `chevron de retour à 44 px à ${width}px (${state.mobileBackHeight}px)`);
      assert.match(state.mobileBackLabel, /^Retour/, `libellé contextuel du chevron à ${width}px`);
      assert.ok(Math.abs(state.mobileTitleCenterDelta) <= 1, `titre centré horizontalement à ${width}px (${state.mobileTitleCenterDelta}px)`);
      assert.equal(state.contentBackDisplay, "none", `aucun Retour redondant dans le contenu à ${width}px`);
      assert.equal(state.pageMenuDisplay, "none", `menu en page masqué au profit du header à ${width}px`);
      assert.ok(state.actionHeight >= 44, `cible tactile menu à ${width}px (${state.actionHeight}px)`);
      assert.ok(state.backHeight >= 44, `cible tactile Retour à ${width}px (${state.backHeight}px)`);
      assert.ok(state.reviseHeight >= 44, `action Réviser visible à ${width}px (${state.reviseHeight}px)`);
      assert.ok(state.documentActionHeight >= 44, `cible tactile document à ${width}px (${state.documentActionHeight}px)`);
      assert.ok(state.proofActionHeight >= 44, `cible tactile preuve à ${width}px (${state.proofActionHeight}px)`);
      assert.ok(state.transcriptionActionHeight >= 44, `cible tactile transcription à ${width}px (${state.transcriptionActionHeight}px)`);
      assert.ok(state.pageButtonHeight >= 44, `cible tactile navigation page à ${width}px (${state.pageButtonHeight}px)`);
      assert.ok(state.photoButtonHeight >= 44, `cible tactile navigation photo à ${width}px (${state.photoButtonHeight}px)`);
      assert.ok(state.imageToolHeight >= 44, `cible tactile zoom à ${width}px (${state.imageToolHeight}px)`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click("#sourcePageBreadcrumb .consultation-breadcrumb-root");
    await page.waitForFunction(() => document.getElementById("sourceDetailView").hidden && !document.getElementById("documentsView").hidden);
    await page.evaluate(() => window.__sourcePageTest.openSource());
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    await page.evaluate(() => window.__sourcePageTest.setSourceTitleToDocument());
    assert.equal(await page.locator("#sourcePageTitle").textContent(), "Source : Acte d’essai", "préfixe Source quand Source et Document portent le même titre");
    await page.evaluate(() => window.__sourcePageTest.removeSourceDocumentAssociation());
    assert.equal(await page.locator("#sourcePageBreadcrumb .consultation-breadcrumb-root").textContent(), "Archives", "chemin adapté quand aucun Document associé n’existe");
    assert.equal(await page.locator("#sourcePageBreadcrumb .consultation-breadcrumb-intermediate").count(), 0, "aucun niveau intermédiaire inventé");
    assert.deepEqual(errors, [], `erreurs JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
