import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const hooks = `
window.__proofPageTest = {
  show(view = "genealogy") { $("authScreen").hidden = true; setView(view); },
  seed() {
    const firestoreTimestamp = { toDate() { return new Date("2024-01-01T00:00:00Z"); } };
    const documentItem = {
      id: "proof-document-fixture", title: "Registre justificatif", type: "Acte", fileName: "registre.txt",
      mimeType: "text/plain", fileData: "data:text/plain;base64,SGVsbG8=", personIds: ["proof-person-fixture"]
    };
    const sourceData = { id: "proof-source-fixture", title: "Source de référence", status: "active", documentIds: [documentItem.id], personIds: ["proof-person-fixture"] };
    const source = { id: sourceData.id, data: sourceData };
    const proofData = {
      id: "proof-detail-fixture", factId: "birth-fixture", factType: "birth", personIds: ["proof-person-fixture"],
      documentId: documentItem.id, pageId: "folio-4", passageId: "passage-4", passageLineLabel: "Ligne 4",
      sourceValue: "1890", relation: "supports", technicalStatus: "active",
      citationIt: { textIt: "nata il quindici marzo", translationFr: "née le quinze mars" },
      citationFr: { textIt: "nata il quindici marzo", translationFr: "née le quinze mars" },
      interpretation: "La date est confirmée par l’acte."
    };
    const proof = { id: proofData.id, data: proofData, authorUid: "fixture-author" };
    const relatedProofData = { ...proofData, id: "proof-related-fixture", factId: "birth-related", relation: "contradicts", personIds: [] };
    const personRecord = {
      id: "proof-person-fixture", firstName: "Ada", middleName: "Maria", lastName: "Test", gender: "F",
      birthDate: "1890", deathDate: "1960", place: "Palermo", deathPlace: "Rome", partnerIds: [], childIds: [], inTree: true
    };
    people = [personRecord];
    documents = [documentItem];
    loadedPeople = loadedDocuments = true;
    genealogyRecords = {
      sourceDocuments: [source],
      sourceRevisions: [],
      transcriptionHeads: [], transcriptionRevisions: [],
      genealogyProofs: [proof, { id: relatedProofData.id, data: relatedProofData }],
      genealogyProofRevisions: [{ id: "proof-revision-fixture", objectId: proof.id, eventType: "proof.created", createdAt: firestoreTimestamp, authorUid: "fixture-author" }],
      factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: []
    };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin" };
    adminUsersCache = [{ id: "fixture-author", displayName: "Auteur de démonstration" }];
    renderGenealogyWorkspace();
  },
  openProof() { openGenealogyItem("proof", "proof-detail-fixture"); },
  openSource() { openGenealogyItem("source", "proof-source-fixture"); },
  async openDocumentThenProof() {
    setView("documents");
    await openStoredDocument(documents[0], "documents");
    openUnifiedProof(documents[0].id, "proof-detail-fixture");
  },
  openPerson() {
    setView("directory");
    if (!document.getElementById("proof-person-spacer")) {
      const spacer = document.createElement("div");
      spacer.id = "proof-person-spacer";
      spacer.style.height = "2600px";
      $("directoryView").append(spacer);
    }
    window.scrollTo({ top: 450, behavior: "instant" });
    openPerson(people[0], "directory");
    setPersonSection("documents");
    $("firstName").value = "Ada modifiée localement";
    const panel = document.querySelector('[data-person-panel="documents"]');
    if (panel) panel.scrollTop = 25;
  },
  setRole(role) { currentUserProfile = { role }; refreshOpenProofPage(); },
  setProofStatus(status) {
    genealogyRecords.genealogyProofs.find(item => item.id === "proof-detail-fixture").data.technicalStatus = status;
    refreshOpenProofPage();
  },
  setUnassociatedProof() {
    const proof = genealogyRecords.genealogyProofs.find(item => item.id === "proof-detail-fixture");
    proof.data.personIds = [];
    proof.data.documentId = null;
    refreshOpenProofPage();
  },
  state() {
    return {
      view: activeView,
      proofVisible: !$('proofDetailView').hidden,
      sourceVisible: !$('sourceDetailView').hidden,
      archiveVisible: !$('genealogyView').hidden,
      documentsVisible: !$('documentsView').hidden,
      personDialogOpen: $('personDialog').open,
      viewerOpen: !$('documentDetailView').hidden,
      title: $('proofPageTitle').textContent,
      returnContext: proofPageReturnContext ? { ...proofPageReturnContext } : null,
      search: $('genealogySearch').value,
      filter: $('genealogyKindFilter').value,
      archiveScroll: window.scrollY,
      personName: $('firstName').value,
      personSection: activePersonSection,
      personScroll: document.querySelector('[data-person-panel="documents"]')?.scrollTop || 0,
      primaryReviseHidden: $('proofPageReviseBtn').hidden,
      actionLabels: [...$('proofPageActionsMenu').querySelectorAll('[data-genealogy-item-action]')].map(button => button.dataset.genealogyItemAction),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      backHeight: $('proofPageBackBtn').getBoundingClientRect().height,
      reviseHeight: $('proofPageReviseBtn').getBoundingClientRect().height,
      menuHeight: document.querySelector('#proofPageActions > summary').getBoundingClientRect().height,
      reviseY: $('proofPageReviseBtn').getBoundingClientRect().y,
      menuY: document.querySelector('#proofPageActions > summary').getBoundingClientRect().y,
      documentLinkHeight: document.querySelector('#proofPageContent [data-source-document-open]')?.getBoundingClientRect().height || 0,
      personLinkHeight: document.querySelector('#proofPageContent [data-genealogy-person]')?.getBoundingClientRect().height || 0,
      sourceLinkHeight: document.querySelector('#proofPageContent [data-proof-source-open]')?.getBoundingClientRect().height || 0,
      relatedProofHeight: document.querySelector('#proofPageContent [data-open-genealogy="proof"]')?.getBoundingClientRect().height || 0,
      technicalSummaryHeight: document.querySelector('#proofPageContent .genealogy-proof-technical > summary')?.getBoundingClientRect().height || 0,
      factColumnCount: document.querySelector('#proofPageContent .document-unified-facts') ? getComputedStyle(document.querySelector('#proofPageContent .document-unified-facts')).gridTemplateColumns.split(' ').length : 0
    };
  }
};`;

test("la page Preuve restitue chaque origine et conserve les parcours métier", async t => {
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
    await page.waitForFunction(() => typeof window.__proofPageTest === "object");
    await page.evaluate(() => { window.__proofPageTest.show(); window.__proofPageTest.seed(); });

    /* Archives → Preuve → Archives : filtres et défilement préservés. */
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "3000px";
      document.getElementById("genealogyView").append(spacer);
      document.getElementById("genealogySearch").value = "Naissance";
      document.getElementById("genealogyKindFilter").value = "proofs";
      window.scrollTo({ top: 900, behavior: "instant" });
    });
    const archiveScroll = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.__proofPageTest.openProof());
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    let state = await page.evaluate(() => window.__proofPageTest.state());
    assert.equal(state.title, "Naissance");
    assert.ok(state.archiveScroll <= 40, `fiche Preuve ouverte depuis son haut malgré Archives défilée (scrollY=${state.archiveScroll}, départ ${archiveScroll})`);
    assert.equal(await page.locator("#proofPageBackBtn").getAttribute("aria-label"), "Retour aux archives");
    assert.equal(await page.locator("#proofPageTitle").getAttribute("aria-label"), state.title, "titre complet accessible");
    assert.ok(await page.locator("#proofDetailView header.dedicated-page-header").count(), "en-tête partagé de page dédiée");
    const revisionHistory = await page.locator("#proofPageContent .source-detail-history").innerText();
    assert.doesNotMatch(revisionHistory, /Invalid Date|fixture-author|proof-revision-fixture/);
    assert.match(revisionHistory, /Auteur de démonstration/);
    assert.equal(state.factColumnCount, 2, "faits structurés en deux colonnes sur ordinateur");
    assert.match(await page.locator("#proofPageContent").innerText(), /Valeur relevée dans le document[\s\S]*1890/i);
    assert.match(await page.locator("#proofPageContent").innerText(), /née le quinze mars/);
    assert.match(await page.locator("#proofPageContent").innerText(), /La date est confirmée/);
    assert.ok(await page.locator("#proofPageContent [data-genealogy-person]").count(), "personne associée consultable");
    assert.ok(await page.locator("#proofPageContent [data-source-document-open]").count(), "document justificatif consultable");
    assert.ok(await page.locator("#proofPageContent [data-proof-source-open]").count(), "Source d'origine consultable");
    assert.ok(await page.locator("#proofPageContent .source-detail-history li").count(), "historique de révisions présenté");
    assert.equal(state.primaryReviseHidden, false, "Réviser visible pour l'administrateur");
    assert.ok(state.actionLabels.includes("proof-archive"), "archivage conservé dans les actions secondaires");
    assert.ok(state.actionLabels.includes("delete-official"), "suppression protégée par l'action existante");
    await page.evaluate(() => window.__proofPageTest.setProofStatus("historical"));
    assert.ok(!(await page.evaluate(() => window.__proofPageTest.state())).actionLabels.includes("proof-archive"), "archivage indisponible pour une Preuve déjà historique");
    await page.evaluate(() => window.__proofPageTest.setProofStatus("active"));
    await page.evaluate(() => window.__proofPageTest.setProofStatus("historical"));
    assert.ok(!(await page.evaluate(() => window.__proofPageTest.state())).actionLabels.includes("proof-archive"), "archivage absent quand déjà historique");
    await page.evaluate(() => window.__proofPageTest.setProofStatus("active"));
    assert.ok(await page.locator("#proofPageContent [data-open-genealogy=proof]").count(), "autre preuve liée consultable");
    assert.deepEqual(state.actionLabels.sort(), ["delete-official", "proof-archive"].sort(), "actions secondaires selon rôle admin");
    assert.equal(state.primaryReviseHidden, false, "révision affichée comme action principale admin");
    await page.click("#proofPageBackBtn");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(80);
    state = await page.evaluate(() => window.__proofPageTest.state());
    assert.equal(state.archiveVisible, true);
    assert.equal(state.search, "Naissance");
    assert.equal(state.filter, "proofs");
    assert.ok(Math.abs(state.archiveScroll - archiveScroll) <= 2, "défilement des Archives restauré");

    /* Source → Preuve → Source ; puis Preuve → Source → Preuve → Source. */
    await page.evaluate(() => window.__proofPageTest.show("genealogy"));
    await page.evaluate(() => window.__proofPageTest.openSource());
    await page.locator('#sourcePageContent [data-open-genealogy="proof"]').first().click();
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    assert.equal((await page.evaluate(() => window.__proofPageTest.state())).returnContext.kind, "source");
    await page.click("#proofPageBackBtn");
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    await page.locator('#sourcePageContent [data-open-genealogy="proof"]').first().click();
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    await page.locator("#proofPageContent [data-proof-source-open]").click();
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);
    await page.click("#sourcePageBackBtn");
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    await page.click("#proofPageBackBtn");
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden);

    /* Document → Preuve → Document : la page Preuve rend le document appelant
       au Retour, puis Preuve → Document → Preuve. */
    await page.evaluate(() => window.__proofPageTest.openDocumentThenProof());
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    state = await page.evaluate(() => window.__proofPageTest.state());
    assert.equal(state.returnContext.kind, "document");
    assert.equal(await page.locator("#proofPageBackBtn").getAttribute("aria-label"), "Retour au document");
    await page.click("#proofPageBackBtn");
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    await page.click("#documentPageBackBtn");
    await page.waitForFunction(() => document.getElementById("documentDetailView").hidden);
    await page.evaluate(() => window.__proofPageTest.openProof());
    await page.locator("#proofPageContent [data-source-document-open]").click();
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden);
    state = await page.evaluate(() => window.__proofPageTest.state());
    assert.equal(state.proofVisible, false, "la page Document remplace la page Preuve");
    assert.equal(state.viewerOpen, true, "lecteur de document affiché");
    await page.click("#documentPageBackBtn");
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    assert.equal((await page.evaluate(() => window.__proofPageTest.state())).proofVisible, true, "retour à la page Preuve");

    /* Personne → Preuve → retour Personne : section, brouillon et défilement restaurés. */
    await page.evaluate(() => window.__proofPageTest.openPerson());
    const personOrigin = await page.evaluate(() => window.__proofPageTest.state());
    await page.locator('#personGenealogyEvidenceList [data-view-proof="proof-detail-fixture"]').click();
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    state = await page.evaluate(() => window.__proofPageTest.state());
    assert.equal(state.personDialogOpen, false);
    assert.equal(state.returnContext.kind, "person");
    await page.click("#proofPageBackBtn");
    await page.waitForSelector("#personDialog[open]");
    await page.waitForTimeout(100);
    state = await page.evaluate(() => window.__proofPageTest.state());
    assert.equal(state.personSection, "documents");
    assert.equal(state.personName, "Ada modifiée localement");
    assert.ok(Math.abs(state.archiveScroll - personOrigin.archiveScroll) <= 2, `défilement de la vue Personne restauré (${state.archiveScroll} contre ${personOrigin.archiveScroll})`);

    /* Révision : modal existante au-dessus de la page ; permissions du menu. */
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("personDialog").open);
    await page.evaluate(() => window.__proofPageTest.openProof());
    await page.click("#proofPageReviseBtn");
    await page.waitForSelector("#genealogyContributionDialog[open]");
    assert.equal((await page.evaluate(() => window.__proofPageTest.state())).proofVisible, true);
    await page.locator('#genealogyContributionDialog [data-close="genealogyContributionDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open);
    await page.evaluate(() => window.__proofPageTest.setRole("member"));
    state = await page.evaluate(() => window.__proofPageTest.state());
    assert.equal(state.primaryReviseHidden, true, "révision masquée aux non-admins");
    assert.deepEqual(state.actionLabels, [], "actions administrateur absentes pour membre");
    await page.evaluate(() => window.__proofPageTest.setRole("admin"));

    /* Mobile étroit et courant : aucune barre horizontale, actions tactiles. */
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      state = await page.evaluate(() => window.__proofPageTest.state());
      assert.equal(state.horizontalOverflow, false, `aucun débordement à ${width}px`);
      assert.ok(state.backHeight >= 44, `Retour ≥ 44 px à ${width}px`);
      assert.ok(state.reviseHeight >= 44, `Réviser ≥ 44 px à ${width}px`);
      assert.ok(state.menuHeight >= 44, `menu ≥ 44 px à ${width}px`);
      assert.ok(Math.abs(state.reviseY - state.menuY) <= 1, `Réviser et menu restent sur la même rangée à ${width}px`);
      assert.ok(state.documentLinkHeight >= 44, `Document ≥ 44 px à ${width}px`);
      assert.ok(state.personLinkHeight >= 44, `Personne ≥ 44 px à ${width}px`);
      assert.ok(state.sourceLinkHeight >= 44, `Source ≥ 44 px à ${width}px`);
      assert.ok(state.relatedProofHeight >= 44, `Preuve liée ≥ 44 px à ${width}px`);
      assert.ok(state.technicalSummaryHeight >= 44, `Détails techniques ≥ 44 px à ${width}px`);
    }
    await page.evaluate(() => window.__proofPageTest.setUnassociatedProof());
    assert.match(await page.locator("#proofPageContent").innerText(), /Aucune personne n’est associée à cette preuve/);
    assert.match(await page.locator("#proofPageContent").innerText(), /Aucun document associé à cette preuve/);
    assert.match(await page.locator("#proofPageContent").innerText(), /Aucun document ou source d’origine n’est indiqué/);
    assert.deepEqual(errors, [], `erreurs JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
