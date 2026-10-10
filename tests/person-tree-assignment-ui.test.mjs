import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const hooks = `
window.__personTreeHarness = {
  setData({ people: records = [], trees = [] } = {}) {
    people = records.map(item => ({ ...item }));
    families = []; documents = []; tasks = [];
    treeMetadata = trees.map(item => ({ ...item }));
    activeTreeId = "main"; treeCatalogState = "ready"; treeCatalogMessage = "";
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
    updateTreeSelectorOptions(); updateTreeBranchOptions();
    setView("directory"); renderTree(); renderDirectory();
  },
  chooseTree(id) { setActiveTree(id); },
  showTree() { setView("tree"); },
  setCards() { setContentMode("directory", "cards"); },
  failCatalog() { rejectTreeCatalog({ code: "permission-denied" }); },
  state() {
    return {
      activeTreeId,
      directoryTreeId: document.getElementById("directoryTreeFilter").value,
      directoryIds: [...document.querySelectorAll("#directoryList [data-directory-person]")].map(node => node.dataset.directoryPerson),
      directoryLabels: [...document.querySelectorAll("#directoryList .directory-tree-label")].map(node => node.textContent),
      treeOptions: [...document.getElementById("directoryTreeFilter").options].map(option => ({ value: option.value, label: option.textContent })),
      creationTreeId: personCreationTreeId,
      personCount: people.length
    };
  }
};
window.__personTreeWrites = [];
window.__personTreeTargetMode = "exists";
window.__personTreeWriteMode = "success";
window.__personTreeTargetMock = async id => {
  window.__personTreeTargetId = id;
  if (window.__personTreeTargetMode === "network") throw new Error("network");
  return { exists: () => window.__personTreeTargetMode !== "missing" };
};
window.__personCreateMock = async (id, data) => {
  window.__personTreeWrites.push({ id, treeId: data.treeId, firstName: data.firstName });
  if (window.__personTreeWriteMode === "delay") await new Promise(resolve => setTimeout(resolve, 150));
  if (window.__personTreeWriteMode === "fail-once") {
    window.__personTreeWriteMode = "success";
    throw new Error("offline");
  }
};`;

const people = [
  { id: "main-a", firstName: "Anna", lastName: "Rossi" },
  { id: "main-b", firstName: "Bruno", lastName: "Rossi", treeId: "main" },
  { id: "secondary-a", firstName: "Carlo", lastName: "Conti", treeId: "tree-conti" },
  { id: "unknown-a", firstName: "Dario", lastName: "Verdi", treeId: "tree-gone" },
  { id: "invalid-a", firstName: "Enzo", lastName: "Neri", treeId: "tree/bad" }
];
const trees = [{ id: "tree-conti", name: "Ramo Conti" }];

async function openHarness(t, width = 1024) {
  const server = await startStaticServer(ROOT);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { await server.close(); t.skip(`Chromium indisponible : ${error.message}`); return null; }
  const context = await browser.newContext({ viewport: { width, height: 850 }, locale: "fr-FR", isMobile: width <= 760, hasTouch: width <= 760, reducedMotion: "reduce" });
  await context.addInitScript(() => { window.__forcedEnv = "recette"; });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const lookup = 'await getDoc(doc(db, "trees", destinationTreeId))';
      const write = 'await setDoc(doc(db, "people", createdId), { ...createData, inTree: true, createdAt: serverTimestamp() });';
      assert.ok(source.includes(lookup), "la vérification en ligne de l’arbre doit être présente");
      assert.ok(source.includes(write), "la création doit être vérifiable sans Firestore distant");
      source = source.replace(lookup, 'await window.__personTreeTargetMock(destinationTreeId)')
        .replace(write, 'await window.__personCreateMock(createdId, { ...createData, inTree: true, createdAt: serverTimestamp() });');
      return route.fulfill({ response, body: `${source}\n${hooks}` });
    }
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__personTreeHarness === "object");
    await page.evaluate(data => window.__personTreeHarness.setData(data), { people, trees });
    return { page, context, browser, server };
  } catch (error) {
    await context.close(); await browser.close(); await server.close();
    throw error;
  }
}

async function fillNewPerson(page, firstName) {
  await page.locator("#firstName").fill(firstName);
  await page.locator("#lastName").fill("Test");
  await page.locator("#savePersonBtn").click();
}

test("création depuis Arbre utilise main ou l’arbre actif, sans champ de changement", async t => {
  const harness = await openHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await page.evaluate(() => window.__personTreeHarness.showTree());
    await page.locator("#addBtn").click();
    assert.equal(await page.locator("#personTreeAssignment").textContent(), "Ajoutée à : Arbre familial");
    assert.equal(await page.locator("#personTreeSelectWrap").isVisible(), false);
    await fillNewPerson(page, "Main Créée");
    await page.waitForFunction(() => window.__personTreeWrites.length === 1);
    let writes = await page.evaluate(() => window.__personTreeWrites.map(item => ({ ...item })));
    assert.equal(writes[0].treeId, undefined, "main reste compatible sans treeId");
    assert.equal(await page.locator("#personId").inputValue(), writes[0].id);
    assert.equal(await page.locator("#personTreeAssignment").isVisible(), false, "l’indication de création disparaît en édition");

    await page.locator('#personDialog button.icon-btn[data-close="personDialog"]').click();
    await page.evaluate(() => window.__personTreeHarness.chooseTree("tree-conti"));
    await page.locator("#addBtn").click();
    assert.equal(await page.locator("#personTreeAssignment").textContent(), "Ajoutée à : Ramo Conti");
    await fillNewPerson(page, "Secondaire Créée");
    await page.waitForFunction(() => window.__personTreeWrites.length === 2);
    writes = await page.evaluate(() => window.__personTreeWrites.map(item => ({ ...item })));
    assert.equal(writes[1].treeId, "tree-conti");
    assert.equal(new Set(writes.map(item => item.id)).size, writes.length);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("création depuis l’annuaire propose main par défaut et un choix secondaire explicite", async t => {
  const harness = await openHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await page.locator("#addDirectoryPersonBtn").click();
    assert.equal(await page.locator("#personTreeSelectWrap").isVisible(), true);
    assert.equal(await page.locator("#personTreeSelect").inputValue(), "main");
    assert.deepEqual(await page.locator("#personTreeSelect option").allTextContents(), ["Arbre familial", "Ramo Conti"], JSON.stringify(await page.evaluate(() => window.__personTreeHarness.state())));
    await fillNewPerson(page, "Annuaire Principal");
    await page.waitForFunction(() => window.__personTreeWrites.length === 1);
    let writes = await page.evaluate(() => window.__personTreeWrites.map(item => ({ ...item })));
    assert.equal(writes[0].treeId, undefined);

    await page.locator('#personDialog button.icon-btn[data-close="personDialog"]').click();
    await page.locator("#addDirectoryPersonBtn").click();
    await page.locator("#personTreeSelect").selectOption("tree-conti");
    await fillNewPerson(page, "Annuaire Secondaire");
    await page.waitForFunction(() => window.__personTreeWrites.length === 2);
    writes = await page.evaluate(() => window.__personTreeWrites.map(item => ({ ...item })));
    assert.equal(writes[1].treeId, "tree-conti");
    assert.equal(await page.evaluate(() => window.__personTreeTargetId), "tree-conti");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("l’arbre secondaire est revérifié avant écriture et aucun échec ne crée de fiche", async t => {
  const harness = await openHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await page.locator("#addDirectoryPersonBtn").click();
    await page.locator("#personTreeSelect").selectOption("tree-conti");
    await page.evaluate(() => { window.__personTreeTargetMode = "missing"; });
    await page.locator("#firstName").fill("Arbre absent");
    await page.locator("#lastName").fill("Test");
    await page.locator("#savePersonBtn").click();
    assert.match(await page.locator("#toastMessage").textContent(), /n’existe plus/i);
    assert.equal(await page.evaluate(() => window.__personTreeWrites.length), 0);

    await page.evaluate(() => { window.__personTreeTargetMode = "network"; });
    await page.locator("#savePersonBtn").click();
    assert.match(await page.locator("#toastMessage").textContent(), /vérifier l’arbre choisi/i);
    assert.equal(await page.evaluate(() => window.__personTreeWrites.length), 0);

    await page.locator('#personDialog button.icon-btn[data-close="personDialog"]').click();
    await page.evaluate(data => window.__personTreeHarness.setData(data), { people, trees });
    await page.evaluate(() => window.__personTreeHarness.chooseTree("tree-conti"));
    await page.evaluate(() => window.__personTreeHarness.showTree());
    await page.locator("#addBtn").click();
    await page.evaluate(() => window.__personTreeHarness.failCatalog());
    await page.locator("#firstName").fill("Catalogue absent");
    await page.locator("#lastName").fill("Test");
    await page.locator("#savePersonBtn").click();
    assert.match(await page.locator("#toastMessage").textContent(), /n’est plus disponible/i);
    assert.equal(await page.evaluate(() => window.__personTreeWrites.length), 0);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("double soumission protégée et reprise réseau idempotente dans le même formulaire", async t => {
  const harness = await openHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    await page.locator("#addDirectoryPersonBtn").click();
    await page.locator("#firstName").fill("Reprise");
    await page.locator("#lastName").fill("Test");
    await page.evaluate(() => { window.__personTreeWriteMode = "delay"; });
    await page.locator("#savePersonBtn").click();
    await page.locator("#personForm").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await page.waitForFunction(() => window.__personTreeWrites.length === 1 && document.getElementById("personId").value);
    let writes = await page.evaluate(() => window.__personTreeWrites.map(item => ({ ...item })));
    assert.equal(writes.length, 1);

    await page.locator('#personDialog button.icon-btn[data-close="personDialog"]').click();
    await page.locator("#addDirectoryPersonBtn").click();
    await page.locator("#firstName").fill("Reprise réseau");
    await page.locator("#lastName").fill("Test");
    await page.evaluate(() => { window.__personTreeWriteMode = "fail-once"; });
    assert.equal(await page.evaluate(() => window.__personTreeWriteMode), "fail-once");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => document.getElementById("toastMessage").textContent.includes("Connexion impossible") || !!document.getElementById("personId").value);
    assert.equal(await page.evaluate(() => window.__personTreeWrites.length), 2, "la première tentative réseau a été interceptée");
    assert.match(await page.locator("#toastMessage").textContent(), /connexion impossible/i);
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => window.__personTreeWrites.length === 3 && document.getElementById("personId").value);
    writes = await page.evaluate(() => window.__personTreeWrites.map(item => ({ ...item })));
    assert.equal(writes[1].id, writes[2].id, "la reprise réutilise le même identifiant Firestore");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("annuaire global, filtre d’arbre indépendant et libellés d’appartenance", async t => {
  const harness = await openHarness(t);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    let state = await page.evaluate(() => window.__personTreeHarness.state());
    assert.equal(state.directoryTreeId, "all");
    assert.equal(state.directoryIds.length, 5, "les memberships indisponibles restent trouvables dans Tous les arbres");
    assert.deepEqual(state.directoryLabels, ["Ramo Conti", "Arbre indisponible", "Arbre familial", "Arbre familial", "Arbre indisponible"]);
    await page.evaluate(() => window.__personTreeHarness.chooseTree("tree-conti"));
    state = await page.evaluate(() => window.__personTreeHarness.state());
    assert.equal(state.directoryTreeId, "all", "le sélecteur Arbre ne touche pas au filtre Annuaire");
    await page.locator('#directoryList [data-directory-person="secondary-a"]').click();
    assert.equal(await page.locator("#personTreeSelectWrap").isVisible(), false, "aucun changement treeId dans l’édition d’une fiche existante");
    await page.locator('#personDialog button.icon-btn[data-close="personDialog"]').click();
    await page.locator("#directoryTreeFilter").selectOption("main");
    assert.deepEqual(await page.locator("#directoryList [data-directory-person]").evaluateAll(nodes => nodes.map(node => node.dataset.directoryPerson)), ["main-a", "main-b"]);
    await page.locator("#directorySearch").fill("carlo");
    assert.equal(await page.locator("#directoryList [data-directory-person]").count(), 0, "recherche combinée au filtre Arbre");
    await page.locator("#directoryTreeFilter").selectOption("tree-conti");
    assert.deepEqual(await page.locator("#directoryList [data-directory-person]").evaluateAll(nodes => nodes.map(node => node.dataset.directoryPerson)), ["secondary-a"]);
    await page.locator("#directorySearch").fill("");
    await page.locator("#directorySort").selectOption("name-desc");
    assert.deepEqual(await page.locator("#directoryList [data-directory-person]").evaluateAll(nodes => nodes.map(node => node.dataset.directoryPerson)), ["secondary-a"]);
    await page.evaluate(() => window.__personTreeHarness.setCards());
    assert.equal(await page.locator("#directoryList.cards-mode [data-directory-person]").count(), 1);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("toolbar Annuaire accessible et sans débordement aux largeurs demandées", async t => {
  const harness = await openHarness(t, 390);
  if (!harness) return;
  const { page, context, browser, server } = harness;
  try {
    for (const width of [320, 390, 430, 760, 1024]) {
      await page.setViewportSize({ width, height: 850 });
      const state = await page.evaluate(() => {
        const select = document.getElementById("directoryTreeFilter");
        const rect = select.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          label: select.getAttribute("aria-label"),
          visible: rect.width > 0 && rect.height > 0,
          touchHeight: rect.height
        };
      });
      assert.equal(state.overflow, 0, `${width}px sans débordement horizontal`);
      assert.equal(state.label, "Filtrer l’annuaire par arbre");
      assert.ok(state.visible, `${width}px filtre visible`);
      if (width <= 760) assert.ok(state.touchHeight >= 44, `${width}px cible tactile ≥44px`);
    }
  } finally { await context.close(); await browser.close(); await server.close(); }
});
