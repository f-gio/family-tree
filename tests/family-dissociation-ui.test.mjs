import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const applyCall = "await applyParentDissociation(plan);";
assert.ok(appSource.includes(applyCall), "point d'écriture de la dissociation présent");

const hooks = `
window.__familyDissociationTest = {
  applied: [],
  seed() {
    people = [
      { id: "disso-pere", firstName: "Giovanni", lastName: "Rossi", gender: "M", inTree: true },
      { id: "disso-mere", firstName: "Maria", lastName: "Conti", gender: "F", inTree: true },
      { id: "disso-enfant1", firstName: "Lina", lastName: "Rossi", gender: "F", inTree: true },
      { id: "disso-enfant2", firstName: "Enzo", lastName: "Rossi", gender: "M", inTree: true }
    ];
    families = [{
      id: "disso-family",
      partnerIds: ["disso-pere", "disso-mere"],
      childIds: ["disso-enfant1", "disso-enfant2"],
      relationType: "marriage",
      unionDateInfo: { type: "year", year: 1920 },
      unionPlace: "Orino",
      endType: "none",
      endDateInfo: { type: "unknown" },
      parentChildLinks: [
        { parentId: "disso-pere", childId: "disso-enfant1", type: "biological" },
        { parentId: "disso-pere", childId: "disso-enfant2", type: "biological" },
        { parentId: "disso-mere", childId: "disso-enfant1", type: "adoptive" },
        { parentId: "disso-mere", childId: "disso-enfant2", type: "biological" }
      ]
    }];
    loadedPeople = loadedFamilies = true;
    activeId = "disso-enfant1";
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
  },
  open() { openFamilyDetails("disso-family"); },
  openAsPartner() { activeId = "disso-pere"; openFamilyDetails("disso-family"); },
  async apply(plan) {
    this.applied.push(JSON.parse(JSON.stringify(plan)));
    const family = families.find(item => item.id === plan.familyId);
    Object.assign(family, plan.familyUpdate);
    if (plan.newFamily) families.push({ id: "disso-family-2", ...plan.newFamily });
  },
  state() {
    return {
      applied: this.applied,
      title: document.getElementById("familyDetailsTitle").textContent,
      filiationTitle: document.getElementById("filiationDetailsTitle").textContent,
      editors: [...document.querySelectorAll("#filiationEditors .filiation-editor")].map(node => node.innerText.replace(/\\s+/g, " ").trim()),
      dissociateButtons: document.querySelectorAll("[data-dissociate-parent]").length,
      dialogOpen: document.getElementById("familyDetailsDialog").open,
      families: JSON.parse(JSON.stringify(families)),
      peopleIds: people.map(person => person.id).sort()
    };
  }
};
`;

async function createPage(browser, server) {
  const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 390, height: 844 } });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      assert.ok(source.includes(applyCall), "l'appel d'écriture reste remplacable");
      source = source.split(applyCall).join("await window.__familyDissociationTest.apply(plan);");
      return route.fulfill({ response, body: `${source}\n${hooks}` });
    }
    return isAllowedRequest(url, server.baseURL) ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__familyDissociationTest === "object");
  await page.evaluate(() => window.__familyDissociationTest.seed());
  return { context, page, errors };
}

async function waitFor(predicate, message, timeout = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`Timeout : ${message}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test("lot 2 : dissociation individuelle d'un parent depuis la modale", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page, errors } = await createPage(browser, server);
    try {
      const confirms = [];
      let dialogMode = "dismiss";
      page.on("dialog", async dialog => {
        confirms.push(dialog.message());
        if (dialogMode === "accept") await dialog.accept();
        else await dialog.dismiss();
      });

      await page.evaluate(() => window.__familyDissociationTest.open());
      await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open);
      let state = await page.evaluate(() => window.__familyDissociationTest.state());
      assert.equal(state.title, "Parents de Lina Rossi", "titre de la modale parents");
      assert.equal(state.filiationTitle, "Liens avec les parents", "section C nommée pour les parents");
      assert.equal(state.editors.length, 2, "un bloc par parent");
      assert.equal(state.dissociateButtons, 2, "une action Dissocier par parent");
      assert.match(state.editors[0], /Giovanni Rossi/, "nom du père affiché");
      assert.match(state.editors[0], /Père/, "rôle affiché");
      assert.match(state.editors[1], /Maria Conti/, "nom de la mère affiché");
      assert.match(state.editors[1], /Mère/, "rôle affiché");

      /* Annulation : rien n'est écrit. */
      await page.locator("[data-dissociate-parent]").first().click();
      await waitFor(() => confirms.length === 1, "la confirmation doit s'afficher");
      state = await page.evaluate(() => window.__familyDissociationTest.state());
      assert.match(confirms[0], /Dissocier Giovanni Rossi de Lina Rossi \?/, "le parent et l'enfant sont identifiés");
      assert.match(confirms[0], /Seul leur lien de filiation sera retiré/, "la portée du retrait est expliquée");
      assert.equal(state.applied.length, 0, "aucune écriture après annulation");
      assert.equal(state.dialogOpen, true, "la modale reste ouverte après annulation");

      /* Confirmation : seul le lien père → enfant 1 est retiré. */
      dialogMode = "accept";
      await page.locator("[data-dissociate-parent]").first().click();
      await waitFor(() => confirms.length === 2, "la seconde confirmation doit s'afficher");
      await page.waitForFunction(() => window.__familyDissociationTest.state().applied.length === 1, undefined, { timeout: 5000 });
      await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open === false, undefined, { timeout: 5000 });

      state = await page.evaluate(() => window.__familyDissociationTest.state());
      const original = state.families.find(family => family.id === "disso-family");
      const created = state.families.find(family => family.id === "disso-family-2");
      assert.deepEqual(original.childIds, ["disso-enfant2"], "le second enfant reste chez ses deux parents");
      assert.deepEqual(original.partnerIds, ["disso-pere", "disso-mere"], "l'union des parents est conservée");
      assert.equal(original.relationType, "marriage");
      assert.deepEqual(original.unionDateInfo, { type: "year", year: 1920 });
      assert.deepEqual(
        original.parentChildLinks.map(link => `${link.parentId}:${link.childId}:${link.type}`),
        ["disso-pere:disso-enfant2:biological", "disso-mere:disso-enfant2:biological"],
        "les filiations du second enfant sont intactes"
      );
      assert.ok(created, "un foyer monoparental accueille l'enfant dissocié");
      assert.deepEqual(created.partnerIds, ["disso-mere"]);
      assert.deepEqual(created.childIds, ["disso-enfant1"]);
      assert.deepEqual(created.parentChildLinks, [{ parentId: "disso-mere", childId: "disso-enfant1", type: "adoptive" }]);
      assert.equal(created.relationType, "unknown", "aucune union fabriquée");
      assert.equal(state.families.length, 2, "aucun foyer supplémentaire");
      assert.deepEqual(state.peopleIds, ["disso-enfant1", "disso-enfant2", "disso-mere", "disso-pere"], "aucune fiche personne supprimée");
      assert.deepEqual(errors, [], "aucune erreur JavaScript");
    } finally { await context.close(); }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("lot 2 : la modale partenaire garde ses enfants sans action de dissociation", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page, errors } = await createPage(browser, server);
    try {
      await page.evaluate(() => {
        window.__familyDissociationTest.seed();
        window.__familyDissociationTest.openAsPartner();
      });
      await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open);
      const state = await page.evaluate(() => window.__familyDissociationTest.state());
      assert.equal(state.title, "Union avec Maria Conti", "titre de la modale partenaire");
      assert.equal(state.filiationTitle, "Liens avec les enfants", "section C nommée pour les enfants");
      assert.equal(state.editors.length, 2, "un bloc par enfant");
      assert.equal(state.dissociateButtons, 0, "aucune dissociation depuis la section enfants");
      assert.match(state.editors[0], /Lina Rossi/, "nom de l'enfant affiché");
      assert.match(state.editors[0], /Fille/, "lien identifié");
      assert.deepEqual(errors, [], "aucune erreur JavaScript");
    } finally { await context.close(); }
  } finally {
    await browser.close();
    await server.close();
  }
});
