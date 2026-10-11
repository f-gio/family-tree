import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const hooks = `
window.__transferData = { people: new Map(), families: new Map(), trees: new Map() };
window.__transferWrites = [];
window.__transferMode = "success";
window.__transferHarness = {
  seed({ people: persons = [], families: homes = [], trees = [] } = {}) {
    window.__transferData = {
      people: new Map(persons.map(item => [item.id, structuredClone(item)])),
      families: new Map(homes.map(item => [item.id, structuredClone(item)])),
      trees: new Map(trees.map(item => [item.id, structuredClone(item)]))
    };
    people = persons.map(item => ({ ...item }));
    families = homes.map(item => ({ ...item }));
    documents = [{ id: "doc-person", personIds: ["paul"], title: "Acte conservé" }];
    tasks = [{ id: "task-person", personId: "paul", title: "Recherche conservée" }];
    treeMetadata = trees.map(item => ({ ...item }));
    activeTreeId = "main"; treeCatalogState = "ready"; treeCatalogMessage = "";
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
    currentUserProfile = { role: "admin", status: "approved", displayName: "Administratrice Test" };
    primaryAdminUid = "";
    Object.defineProperty(auth, "currentUser", { value: { uid: "admin-test" }, configurable: true });
    window.__transferWrites = [];
    window.__transferMode = "success";
    updateTreeSelectorOptions(); updateTreeBranchOptions();
    setView("directory"); renderDirectory();
  },
  setRole(role) {
    currentUserProfile = { role, status: "approved", displayName: role === "admin" ? "Administratrice Test" : "Membre Test" };
    primaryAdminUid = "";
    Object.defineProperty(auth, "currentUser", { value: { uid: role === "admin" ? "admin-test" : "member-test" }, configurable: true });
  },
  setMode(mode) { window.__transferMode = mode; },
  showDirectory() {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    setView("directory"); renderDirectory();
  },
  snapshot() {
    return {
      activeTreeId,
      dialogOpen: document.getElementById("personTreeTransferDialog").open,
      personDialogOpen: document.getElementById("personDialog").open,
      confirmDisabled: document.getElementById("confirmPersonTreeTransferBtn").disabled,
      source: document.getElementById("personTreeTransferSource").textContent,
      destinationOptions: [...document.getElementById("personTreeTransferDestination").options].map(option => ({ value: option.value, label: option.textContent })),
      preview: document.getElementById("personTreeTransferPreview").textContent,
      error: document.getElementById("personTreeTransferError").textContent,
      person: structuredClone(window.__transferData.people.get("paul")),
      families: [...window.__transferData.families.values()].map(item => structuredClone(item)),
      documents: documents.map(item => ({ ...item })),
      tasks: tasks.map(item => ({ ...item })),
      writes: window.__transferWrites.map(item => structuredClone(item))
    };
  }
};
window.__transferFreshRead = async personId => {
  if (window.__transferMode === "network") throw new Error("network unavailable");
  if (window.__transferMode === "family-changed-before") {
    const family = window.__transferData.families.get("parents-paul");
    family.childIds = [];
  }
  const related = [...window.__transferData.families.values()].filter(family => familyPersonIds(family).includes(personId));
  const ids = new Set([personId, ...related.flatMap(familyPersonIds)]);
  return {
    families: related.map(item => structuredClone(item)),
    people: [...ids].map(id => window.__transferData.people.get(id)).filter(Boolean).map(item => structuredClone(item))
  };
};
window.__transferRunTransaction = async updateFunction => {
  if (window.__transferMode === "source-changed-in-transaction") window.__transferData.people.get("paul").treeId = "tree-b";
  if (window.__transferMode === "family-changed-in-transaction") window.__transferData.families.get("parents-paul").childIds = [];
  const read = ref => {
    const [collectionName, id] = ref.path.split("/");
    if (window.__transferMode === "destination-missing" && collectionName === "trees" && id === "tree-a") {
      return { exists: () => false, data: () => undefined, id };
    }
    const value = window.__transferData[collectionName]?.get(id);
    return { exists: () => !!value, data: () => value ? structuredClone(value) : undefined, id };
  };
  const transaction = {
    get: async ref => read(ref),
    update: (ref, changes) => {
      const [collectionName, id] = ref.path.split("/");
      window.__transferWrites.push({ path: ref.path, changes: structuredClone(changes) });
      window.__transferData[collectionName].set(id, { ...window.__transferData[collectionName].get(id), ...structuredClone(changes) });
    }
  };
  return updateFunction(transaction);
};`;

const people = [
  { id: "jean", firstName: "Jean", lastName: "Rossi" },
  { id: "marie", firstName: "Marie", lastName: "Rossi" },
  { id: "paul", firstName: "Paul", lastName: "Rossi", notes: "Notes inchangées", inTree: true, updatedBy: "old-admin", updatedByName: "Ancien auteur" },
  { id: "sophie", firstName: "Sophie", lastName: "Conti", treeId: "tree-a" },
  { id: "lea", firstName: "Léa", lastName: "Conti", treeId: "tree-a" }
];
const families = [
  { id: "parents-paul", partnerIds: ["jean", "marie"], childIds: ["paul"], parentChildLinks: [{ parentId: "jean", childId: "paul", type: "biological" }] },
  { id: "union-paul", partnerIds: ["paul", "sophie"], childIds: ["lea"], parentChildLinks: [{ parentId: "sophie", childId: "lea", type: "biological" }] }
];
const trees = [{ id: "tree-a", name: "Branche A" }, { id: "tree-b", name: "Branche B" }];

async function openTransferHarness(t, seed = { people, families, trees }) {
  const server = await startStaticServer(ROOT);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { await server.close(); t.skip(`Chromium indisponible : ${error.message}`); return null; }
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, locale: "fr-FR", reducedMotion: "reduce" });
  await context.addInitScript(() => { window.__forcedEnv = "recette"; });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const freshRead = "await readFreshPersonTreeTransferData(state.personId)";
      const transaction = "await runTransaction(db, async transaction => {";
      assert.ok(source.includes(freshRead), "relecture fraîche avant transfert présente");
      assert.ok(source.includes(transaction), "transaction Firestore utilisée pour le transfert");
      source = source.replace(freshRead, "await window.__transferFreshRead(state.personId)");
      const transferStart = source.indexOf("async function confirmPersonTreeTransfer()");
      const transactionOffset = source.indexOf(transaction, transferStart);
      assert.ok(transferStart >= 0 && transactionOffset > transferStart, "transaction du transfert repérée");
      source = source.slice(0, transactionOffset) + source.slice(transactionOffset).replace(transaction, "await window.__transferRunTransaction(async transaction => {");
      return route.fulfill({ response, body: `${source}\n${hooks}` });
    }
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__transferHarness === "object");
    await page.evaluate(data => window.__transferHarness.seed(data), seed);
    return { page, context, browser, server };
  } catch (error) {
    await context.close(); await browser.close(); await server.close();
    throw error;
  }
}

async function openPaulTransfer(page) {
  await page.evaluate(() => window.__transferHarness.showDirectory());
  const entry = page.locator('#directoryList [data-directory-person="paul"]');
  await entry.waitFor({ state: "visible", timeout: 10000 });
  await entry.click();
  await page.locator("#personMenuBtn").click();
  await page.locator("#changePersonTreeBtn").click();
}

test("action transfert réservée aux admins et destination vide par défaut", async t => {
  const harness = await openTransferHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await page.evaluate(() => window.__transferHarness.setRole("member"));
    await page.locator('#directoryList [data-directory-person="paul"]').click();
    assert.equal(await page.locator("#changePersonTreeBtn").isVisible(), false);
    await page.locator('#personDialog button.icon-btn[data-close="personDialog"]').click();

    await page.evaluate(() => window.__transferHarness.setRole("admin"));
    await openPaulTransfer(page);
    assert.equal(await page.locator("#personTreeTransferDialog").evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator("#personTreeTransferDestination").inputValue(), "");
    assert.equal(await page.locator("#confirmPersonTreeTransferBtn").isDisabled(), true);
    assert.equal(await page.locator("#personTreeTransferSource").textContent(), "Arbre familial");
    assert.deepEqual(await page.locator("#personTreeTransferDestination option").allTextContents(), ["Sélectionner un arbre…", "Branche A", "Branche B"]);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("aperçu explique foyers masqués/visibles; transaction ne change que la fiche personne", async t => {
  const harness = await openTransferHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    const before = await page.evaluate(() => window.__transferHarness.snapshot());
    await openPaulTransfer(page);
    await page.locator("#personTreeTransferDestination").selectOption("tree-a");
    assert.equal(await page.locator("#confirmPersonTreeTransferBtn").isDisabled(), false);
    const preview = await page.locator("#personTreeTransferPreview").textContent();
    assert.match(preview, /Jean Rossi/);
    assert.match(preview, /Marie Rossi/);
    assert.match(preview, /Léa Conti/);
    assert.match(preview, /ne seront plus dessinés|aucun arbre/i);
    assert.match(preview, /seront visibles|Branche A/);

    await page.locator("#confirmPersonTreeTransferBtn").click();
    await page.waitForFunction(() => window.__transferWrites.length === 1);
    const after = await page.evaluate(() => window.__transferHarness.snapshot());
    assert.equal(after.person.id, before.person.id, "l'ID de fiche ne change pas");
    assert.equal(after.person.treeId, "tree-a");
    assert.equal(after.person.notes, before.person.notes);
    assert.equal(after.person.inTree, before.person.inTree);
    assert.deepEqual(after.families, before.families, "les foyers restent inchangés");
    assert.deepEqual(after.documents, before.documents, "les documents restent inchangés");
    assert.deepEqual(after.tasks, before.tasks, "les tâches restent inchangées");
    assert.equal(after.activeTreeId, "main", "l'arbre actif ne change pas automatiquement");
    assert.equal(after.dialogOpen, false);
    assert.equal(after.personDialogOpen, false);
    assert.equal(after.writes[0].path, "people/paul");
    assert.deepEqual(after.writes[0].changes, { treeId: "tree-a", updatedBy: "admin-test", updatedByName: "Administratrice Test" });
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("retour vers main écrit treeId main et préserve inTree false", async t => {
  const hiddenPerson = { ...people[2], treeId: "tree-a", inTree: false };
  const harness = await openTransferHarness(t, { people: [...people.slice(0, 2), hiddenPerson, ...people.slice(3)], families, trees });
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await openPaulTransfer(page);
    assert.deepEqual(await page.locator("#personTreeTransferDestination option").allTextContents(), ["Sélectionner un arbre…", "Arbre familial", "Branche B"]);
    await page.locator("#personTreeTransferDestination").selectOption("main");
    assert.match(await page.locator("#personTreeTransferNote").textContent(), /masquée/);
    await page.locator("#confirmPersonTreeTransferBtn").click();
    await page.waitForFunction(() => window.__transferWrites.length === 1);
    const person = await page.evaluate(() => window.__transferHarness.snapshot().person);
    assert.equal(person.treeId, "main");
    assert.equal(person.inTree, false);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("transfert secondaire propose main et l'autre arbre secondaire, sans présélection", async t => {
  const secondaryPerson = { ...people[2], treeId: "tree-a" };
  const h = await openTransferHarness(t, { people: [...people.slice(0, 2), secondaryPerson, ...people.slice(3)], families, trees });
  if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await openPaulTransfer(page);
    assert.equal(await page.locator("#personTreeTransferSource").textContent(), "Branche A");
    assert.equal(await page.locator("#personTreeTransferDestination").inputValue(), "");
    assert.deepEqual(await page.locator("#personTreeTransferDestination option").allTextContents(), ["Sélectionner un arbre…", "Arbre familial", "Branche B"]);
    await page.locator("#personTreeTransferDestination").selectOption("main");
    await page.locator("#confirmPersonTreeTransferBtn").click();
    await page.waitForFunction(() => window.__transferWrites.length === 1);
    assert.equal((await page.evaluate(() => window.__transferHarness.snapshot())).person.treeId, "main");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("transfert secondaire → autre secondaire conserve l'ID et les liens", async t => {
  const secondaryPerson = { ...people[2], treeId: "tree-a" };
  const seed = { people: [...people.slice(0, 2), secondaryPerson, ...people.slice(3)], families, trees };
  const harness = await openTransferHarness(t, seed);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await openPaulTransfer(page);
    await page.locator("#personTreeTransferDestination").selectOption("tree-b");
    await page.locator("#confirmPersonTreeTransferBtn").click();
    await page.waitForFunction(() => window.__transferWrites.length === 1);
    const state = await page.evaluate(() => window.__transferHarness.snapshot());
    assert.equal(state.person.id, "paul");
    assert.equal(state.person.treeId, "tree-b");
    assert.equal(state.families.length, families.length);
    assert.equal(state.writes[0].path, "people/paul");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("sans arbre de destination, message explicite et confirmation désactivée", async t => {
  const h = await openTransferHarness(t, { people, families: [], trees: [] });
  if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await openPaulTransfer(page);
    assert.equal(await page.locator("#personTreeTransferDestination").inputValue(), "");
    assert.equal(await page.locator("#personTreeTransferDestination").isDisabled(), true);
    assert.equal(await page.locator("#confirmPersonTreeTransferBtn").isDisabled(), true);
    assert.match(await page.locator("#personTreeTransferPreview").textContent(), /Aucun autre arbre n'est disponible/i);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("aperçu périmé ou source modifiée bloque l'écriture", async t => {
  const harness = await openTransferHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await openPaulTransfer(page);
    await page.locator("#personTreeTransferDestination").selectOption("tree-a");
    await page.evaluate(() => window.__transferHarness.setMode("family-changed-before"));
    await page.locator("#confirmPersonTreeTransferBtn").click();
    assert.equal(await page.evaluate(() => window.__transferWrites.length), 0);
    assert.match(await page.locator("#personTreeTransferError").textContent(), /changé depuis l'aperçu/i);

    // Preview is refreshed; simulate a second session changing membership before the transaction reads it.
    await page.locator('#personTreeTransferDialog button.icon-btn[data-close="personTreeTransferDialog"]').click();
    await page.locator('#personDialog button.icon-btn[data-close="personDialog"]').click();
    await page.evaluate(data => window.__transferHarness.seed(data), { people, families, trees });
    await openPaulTransfer(page);
    await page.locator("#personTreeTransferDestination").selectOption("tree-a");
    await page.evaluate(() => window.__transferHarness.setMode("source-changed-in-transaction"));
    await page.locator("#confirmPersonTreeTransferBtn").click();
    assert.equal(await page.evaluate(() => window.__transferWrites.length), 0);
    assert.equal(await page.locator("#personTreeTransferDialog").evaluate(dialog => dialog.open), true);
    assert.match(await page.locator("#personTreeTransferError").textContent(), /a changé depuis l'aperçu/i);

    await page.locator('#personTreeTransferDialog button.icon-btn[data-close="personTreeTransferDialog"]').click();
    await page.locator('#personDialog button.icon-btn[data-close="personDialog"]').click();
    await page.evaluate(data => window.__transferHarness.seed(data), { people, families, trees });
    await openPaulTransfer(page);
    await page.locator("#personTreeTransferDestination").selectOption("tree-a");
    await page.evaluate(() => window.__transferHarness.setMode("family-changed-in-transaction"));
    await page.locator("#confirmPersonTreeTransferBtn").click();
    assert.equal(await page.evaluate(() => window.__transferWrites.length), 0);
    assert.match(await page.locator("#personTreeTransferError").textContent(), /relations ou l'appartenance ont changé/i);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("destination supprimée avant le commit garde la fenêtre ouverte sans écriture", async t => {
  const harness = await openTransferHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await openPaulTransfer(page);
    await page.locator("#personTreeTransferDestination").selectOption("tree-a");
    await page.evaluate(() => window.__transferHarness.setMode("destination-missing"));
    await page.locator("#confirmPersonTreeTransferBtn").click();
    assert.equal(await page.evaluate(() => window.__transferWrites.length), 0);
    assert.equal(await page.locator("#personTreeTransferDialog").evaluate(dialog => dialog.open), true);
    assert.match(await page.locator("#personTreeTransferError").textContent(), /destination n'existe plus/i);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("erreur réseau garde la fenêtre et n'écrit rien", async t => {
  const harness = await openTransferHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await openPaulTransfer(page);
    await page.locator("#personTreeTransferDestination").selectOption("tree-a");
    await page.evaluate(() => window.__transferHarness.setMode("network"));
    await page.locator("#confirmPersonTreeTransferBtn").click();
    assert.equal(await page.evaluate(() => window.__transferWrites.length), 0);
    assert.equal(await page.locator("#personTreeTransferDialog").evaluate(dialog => dialog.open), true);
    assert.match(await page.locator("#personTreeTransferError").textContent(), /connexion impossible/i);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("fenêtre transfert accessible et responsive 320–1440 px", async t => {
  const harness = await openTransferHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await openPaulTransfer(page);
    await page.locator("#personTreeTransferDestination").selectOption("tree-a");
    for (const width of [320, 390, 430, 760, 1024, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      const geometry = await page.evaluate(() => {
        const dialog = document.getElementById("personTreeTransferDialog");
        const rect = dialog.getBoundingClientRect();
        const buttons = [...dialog.querySelectorAll(".modal-actions button")].map(button => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
          label: button.textContent.trim()
        }));
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          visible: rect.width > 0 && rect.height > 0,
          withinViewport: rect.left >= 0 && rect.right <= innerWidth,
          buttons
        };
      });
      assert.equal(geometry.overflow, 0, `${width}px sans débordement horizontal`);
      assert.ok(geometry.visible && geometry.withinViewport, `${width}px dialogue visible dans le viewport`);
      assert.ok(geometry.buttons.every(button => button.width > 0 && button.height >= 44), `${width}px boutons ≥44px`);
    }
    assert.equal(await page.locator("#personTreeTransferDestination").getAttribute("aria-label"), "Déplacer vers");
    assert.equal(await page.locator("#confirmPersonTreeTransferBtn").getAttribute("type"), "button");
  } finally { await context.close(); await browser.close(); await server.close(); }
});
