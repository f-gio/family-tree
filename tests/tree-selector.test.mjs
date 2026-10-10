import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const testHooks = `
window.__treeSelectorHarness = {
  setData({ people: personRecords = [], families: familyRecords = [], trees: treeRecords = [] } = {}) {
    people = personRecords;
    families = familyRecords;
    treeMetadata = treeRecords;
    activeTreeId = "main";
    treeCatalogState = "ready";
    treeCatalogMessage = "";
    invalidTreeMetadataCount = 0;
    branchView = null;
    lineageSurname = "";
    activeId = null;
    loadedPeople = loadedFamilies = true;
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
    for (const id of ["directoryView", "documentsView", "tasksView", "dossiersView"]) document.getElementById(id).hidden = true;
    updateTreeSelectorOptions();
    updateTreeBranchOptions();
    cameraPositioned = false;
    renderTree();
  },
  chooseTree(id) {
    const select = document.getElementById("treeSelect");
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  },
  chooseBranch(name) {
    const select = document.getElementById("treeBranchFilter");
    select.value = name;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  },
  enterPersonBranch(id) {
    branchView = { personId: id, ancestorDepth: 3 };
    lineageSurname = "";
    updateTreeBranchOptions();
    renderTree();
  },
  setCatalogError() { rejectTreeCatalog({ code: "permission-denied" }); },
  exportCurrentSvg() {
    return treeExportSvg({ people: currentScope?.people || [], layout: currentLayout, markers: treeContextMarkers(currentScope || {}) });
  },
  removeActiveTreeFromCatalog() {
    treeMetadata = treeMetadata.filter(tree => tree.id !== activeTreeId);
    acceptTreeCatalog({ docs: treeMetadata.map(tree => ({ id: tree.id, data: () => ({ name: tree.name, description: tree.description || "" }) })) });
  },
  state() {
    return {
      activeTreeId,
      lineageSurname,
      branchView: branchView && { ...branchView },
      peopleIds: currentScope?.people.map(item => item.id) || [],
      familyIds: currentScope?.families.map(item => item.id) || [],
      selectTreeValue: document.getElementById("treeSelect").value,
      activeTreeLabel: document.getElementById("treeSelect").selectedOptions[0]?.textContent || "",
      treeOptions: [...document.getElementById("treeSelect").options].map(option => ({ value: option.value, label: option.textContent })),
      branchValue: document.getElementById("treeBranchFilter").value,
      branchOptions: [...document.getElementById("treeBranchFilter").options].map(option => ({ value: option.value, label: option.textContent })),
      catalogStatusHidden: document.getElementById("treeCatalogStatus").hidden,
      catalogStatusText: document.getElementById("treeCatalogStatus").textContent
    };
  }
};`;

const fixture = {
  people: [
    { id: "main-parent", firstName: "Ada", lastName: "Rossi" },
    { id: "main-child", firstName: "Luca", lastName: "Rossi" },
    { id: "hidden-main", firstName: "Nina", lastName: "Bianchi", inTree: false },
    { id: "secondary-parent", firstName: "Mia", lastName: "Conti", treeId: "tree-conti" },
    { id: "secondary-child", firstName: "Leo", lastName: "Conti", treeId: "tree-conti" },
    { id: "isolated", firstName: "Noa", lastName: "Verdi", treeId: "tree-empty" },
    { id: "invalid-membership", firstName: "Fuga", lastName: "Nascosta", treeId: "missing-tree" }
  ],
  families: [
    { id: "family-main", partnerIds: ["main-parent"], childIds: ["main-child"] },
    { id: "family-hidden-same-tree", partnerIds: ["hidden-main"], childIds: ["main-child"] },
    { id: "family-secondary", partnerIds: ["secondary-parent"], childIds: ["secondary-child"] },
    { id: "family-cross-tree", partnerIds: ["main-parent", "secondary-parent"], childIds: ["secondary-child"], parentChildLinks: [{ parentId: "main-parent", childId: "secondary-child", type: "uncertain" }] }
  ],
  trees: [
    { id: "tree-conti", name: "Ramo Conti", description: "" },
    { id: "tree-empty", name: "Ramo isolato", description: "" }
  ]
};

test("sélecteur d'arbre : options, scope indépendant, filtres réinitialisés et familles confinées", async t => {
  const server = await startStaticServer(ROOT);
  try {
    for (const [engineName, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
      let browser;
      try { browser = await engine.launch({ headless: true }); }
      catch (error) {
        if (engineName === "WebKit") { t.diagnostic(`WebKit indisponible : ${error.message}`); continue; }
        throw error;
      }
      try {
        for (const [width, height] of [[320, 844], [390, 844], [760, 900], [1024, 768]]) {
          await t.test(`${engineName} ${width}×${height}`, async () => {
            const context = await browser.newContext({ viewport: { width, height }, locale: "fr-FR", isMobile: width <= 760, hasTouch: width <= 760, reducedMotion: "reduce" });
            await context.route("**/*", async route => {
              const url = route.request().url();
              if (url.endsWith("/js/app.js")) {
                const response = await route.fetch();
                return route.fulfill({ response, body: `${await response.text()}\n${testHooks}` });
              }
              if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
              if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
              return route.continue().catch(() => {});
            });
            const page = await context.newPage();
            try {
              await page.goto(server.baseURL, { waitUntil: "load" });
              await page.waitForFunction(() => typeof window.__treeSelectorHarness === "object");
              await page.evaluate(data => window.__treeSelectorHarness.setData(data), fixture);
              const controls = await page.evaluate(() => {
                const tree = document.getElementById("treeSelect");
                const branch = document.getElementById("treeBranchFilter");
                return {
                  labels: [tree.closest("label").textContent.trim(), branch.closest("label").textContent.trim()],
                  order: tree.compareDocumentPosition(branch) & Node.DOCUMENT_POSITION_FOLLOWING,
                  nativeSelects: tree.tagName === "SELECT" && branch.tagName === "SELECT",
                  ariaLabels: [tree.getAttribute("aria-label"), branch.getAttribute("aria-label")],
                  treeBox: tree.getBoundingClientRect().toJSON(),
                  branchBox: branch.getBoundingClientRect().toJSON(),
                  horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
                };
              });
              assert.match(controls.labels[0], /Choisir un arbre/);
              assert.match(controls.labels[1], /Filtrer par branche familiale/);
              assert.ok(controls.nativeSelects, "contrôles natifs compatibles clavier");
              assert.deepEqual(controls.ariaLabels, ["Choisir un arbre", "Filtrer par branche familiale"]);
              assert.ok(controls.order, "sélecteur d'arbre placé avant le sélecteur de branches");
              assert.equal(controls.horizontalOverflow, 0, "aucun débordement horizontal");
              assert.ok(controls.treeBox.height >= 43 && controls.branchBox.height >= 43, "sélecteurs tactiles ≥44px");

              let state = await page.evaluate(() => window.__treeSelectorHarness.state());
              assert.equal(state.activeTreeId, "main", "arbre principal sélectionné par défaut");
              assert.deepEqual(state.peopleIds, ["main-parent", "main-child"], "treeId absent appartient à main, treeId secondaire est exclu");
              assert.deepEqual(state.familyIds, ["family-main", "family-hidden-same-tree"], "foyers du principal inclus, liens inter-arbres exclus");
              assert.deepEqual(state.branchOptions.map(option => option.label), ["Toutes les branches", "Rossi"], "branches disponibles limitées au principal et personnes visibles");

              await page.evaluate(() => window.__treeSelectorHarness.chooseBranch("Rossi"));
              await page.evaluate(() => window.__treeSelectorHarness.enterPersonBranch("main-parent"));
              await page.evaluate(() => window.__treeSelectorHarness.chooseTree("tree-conti"));
              state = await page.evaluate(() => window.__treeSelectorHarness.state());
              assert.equal(state.activeTreeId, "tree-conti", "arbre secondaire activé");
              assert.equal(state.selectTreeValue, "tree-conti");
              assert.equal(state.activeTreeLabel, "Ramo Conti", "nom de l'arbre actif affiché");
              assert.equal(state.lineageSurname, "", "filtre de lignée réinitialisé au changement d'arbre");
              assert.equal(state.branchView, null, "vue de branche réinitialisée à l'arbre complet");
              assert.equal(state.branchValue, "", "sélecteur de branches revenu à Toutes");
              assert.deepEqual(state.peopleIds, ["secondary-parent", "secondary-child"], "aucune personne du principal ne fuit dans le rendu secondaire");
              assert.deepEqual(state.familyIds, ["family-secondary"], "aucune famille inter-arbres ne produit de lien graphique");
              assert.deepEqual(state.branchOptions.map(option => option.label), ["Toutes les branches", "Conti"], "branches limitées à l'arbre actif");
              const exportedActiveTree = await page.evaluate(() => window.__treeSelectorHarness.exportCurrentSvg());
              assert.match(exportedActiveTree, /Mia|Leo/);
              assert.doesNotMatch(exportedActiveTree, /Ada|Luca|Rossi/, "l'export ne reprend pas de personnes du principal");

              await page.evaluate(() => window.__treeSelectorHarness.chooseBranch("Conti"));
              state = await page.evaluate(() => window.__treeSelectorHarness.state());
              assert.equal(state.lineageSurname, "Conti", "le filtre existant fonctionne dans l'arbre actif");
              assert.ok(state.peopleIds.every(id => id.startsWith("secondary-")), "filtre lignée sans fuite d'autre arbre");

              await page.evaluate(() => window.__treeSelectorHarness.chooseTree("tree-empty"));
              state = await page.evaluate(() => window.__treeSelectorHarness.state());
              assert.deepEqual(state.peopleIds, ["isolated"], "arbre secondaire isolé correctement affiché");
              assert.deepEqual(state.familyIds, [], "aucune famille artificielle pour personne isolée");
              assert.deepEqual(state.branchOptions.map(option => option.label), ["Toutes les branches", "Verdi"]);
            } finally { await context.close(); }
          });
        }
      } finally { await browser.close(); }
    }
  } finally { await server.close(); }
});

test("catalogue Firestore refusé ou arbre supprimé : principal affiché et erreur signalée", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR", isMobile: true, hasTouch: true });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url.endsWith("/js/app.js")) {
      const response = await route.fetch();
      return route.fulfill({ response, body: `${await response.text()}\n${testHooks}` });
    }
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__treeSelectorHarness === "object");
    await page.evaluate(data => window.__treeSelectorHarness.setData(data), fixture);
    await page.evaluate(() => window.__treeSelectorHarness.chooseTree("tree-conti"));
    await page.evaluate(() => window.__treeSelectorHarness.setCatalogError());
    let state = await page.evaluate(() => window.__treeSelectorHarness.state());
    assert.equal(state.activeTreeId, "main");
    assert.deepEqual(state.peopleIds, ["main-parent", "main-child"]);
    assert.equal(state.catalogStatusHidden, false, "l'erreur de lecture est visible");
    assert.match(state.catalogStatusText, /ne peuvent pas être chargés/i);
    assert.deepEqual(state.treeOptions.map(option => option.label), ["Arbre familial"]);

    await page.evaluate(data => window.__treeSelectorHarness.setData(data), fixture);
    await page.evaluate(() => window.__treeSelectorHarness.chooseTree("tree-conti"));
    await page.evaluate(() => window.__treeSelectorHarness.removeActiveTreeFromCatalog());
    state = await page.evaluate(() => window.__treeSelectorHarness.state());
    assert.equal(state.activeTreeId, "main", "arbre disparu remplacé par le principal");
    assert.equal(state.catalogStatusHidden, false);
    assert.match(state.catalogStatusText, /n’est plus disponible/i);
  } finally { await context.close(); await browser.close(); await server.close(); }
});
