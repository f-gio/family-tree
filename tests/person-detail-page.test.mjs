import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const svg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#557a65"/></svg>');
const hooks = `
window.__personPageTest = {
  seed() {
    people = [
      { id: "person-page-a", firstName: "Ada", middleName: "Maria", lastName: "Rossi", marriedName: "Bianchi", gender: "F", branch: "Ramo Conti", birthDateInfo: { type: "year", year: 1890 }, place: "Palermo", deathDateInfo: { type: "unknown" }, deathPlace: "", notes: "Note de consultation", photoUrl: "${svg}", updatedByName: "Archiviste" },
      { id: "person-page-b", firstName: "Carlo", lastName: "Rossi", gender: "M", birthDateInfo: { type: "year", year: 1860 }, place: "Palermo" },
      { id: "person-page-c", firstName: "Lina", lastName: "Rossi", gender: "F" }
    ];
    families = [{ id: "person-page-family", partnerIds: ["person-page-a", "person-page-b"], childIds: ["person-page-c"], relationType: "marriage", unionDateInfo: { type: "year", year: 1888 }, unionPlace: "Palermo", endType: "none", endDateInfo: { type: "unknown" }, parentChildLinks: [] }];
    documents = [{ id: "person-page-document", title: "Acte de naissance d’Ada", type: "Acte", date: "1890-03-04", fileName: "acte.svg", mimeType: "image/svg+xml", externalUrl: "https://example.invalid/acte.svg", personIds: ["person-page-a"] }];
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
    $("authScreen").hidden = true;
    $("topbar").hidden = false;
    renderTree();
    setView("directory");
  },
  update(id, data) {
    window.__personPageUpdates = [...(window.__personPageUpdates || []), { id, firstName: data.firstName }];
    people = people.map(item => item.id === id ? { ...item, ...data, updatedAt: { toDate: () => new Date("2026-11-04T12:00:00Z") }, updatedByName: "Archiviste" } : item);
  },
  openTree() { renderTree(); setView("tree"); },
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
    await page.locator("#personPageBackBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Ada"));
    assert.equal((await page.evaluate(() => window.__personPageTest.state())).section, "family", "retour au membre précédent et à Famille");

    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), false, "l’édition reste sur la page, sans ouvrir la modale");
    await page.locator("#firstName").fill("Adélaïde");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Adélaïde"));
    assert.equal(await page.evaluate(() => window.__personPageTest.state().updateCount), 1, "la sauvegarde réutilise le point d’écriture existant");
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

    for (const width of [390, 760, 1024, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      const layout = await page.evaluate(() => {
        const isVisible = element => !!element && getComputedStyle(element).display !== "none" && element.getBoundingClientRect().height > 0;
        const desktopBack = document.getElementById("personPageBackBtn");
        const mobileBack = document.getElementById("personPageMobileBackBtn");
        const back = isVisible(desktopBack) ? desktopBack : mobileBack;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          columns: getComputedStyle(document.getElementById("personPageContent")).gridTemplateColumns.split(" ").length,
          backCount: [desktopBack, mobileBack].filter(isVisible).length,
          backHeight: back.getBoundingClientRect().height,
          editHeight: document.getElementById("personPageEditBtn").getBoundingClientRect().height
        };
      });
      assert.ok(layout.overflow <= 1, `${width}px : aucun débordement horizontal (${layout.overflow}px)`);
      assert.equal(layout.backCount, 1, `${width}px : un seul bouton Retour visible (desktop/mobile)`);
      assert.ok(layout.backHeight >= 44 && layout.editHeight >= 44, `${width}px : cibles tactiles suffisantes`);
      assert.equal(layout.columns, 1, `${width}px : contenu de lecture en une colonne maîtrisée`);
    }

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
