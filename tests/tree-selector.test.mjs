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
    window.__treeSelectorHarness.treeWrites = [];
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
  treeWrites: [],
  async saveTreeForTest(mode, name, description, existingId = null) {
    if (existingId === "main") return { error: "L'arbre principal ne peut pas être renommé" };
    if (!name) return { error: "Le nom est obligatoire" };
    if (name.length > 80) return { error: "Le nom ne peut pas dépasser 80 caractères" };
    if ((description || "").length > 200) return { error: "La description ne peut pas dépasser 200 caractères" };
    if (isDuplicateTreeName(name, existingId || null)) return { error: "Un arbre portant ce nom existe déjà" };
    const id = existingId || generateTreeId(name);
    const tree = treeMetadata.find(item => item.id === id);
    if (tree) { tree.name = name; tree.description = description || ""; }
    else treeMetadata.push({ id, name, description: description || "" });
    treeMetadata.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || a.id.localeCompare(b.id));
    window.__treeSelectorHarness.treeWrites.push({ mode, id, name, description });
    if (!existingId) setActiveTree(id);
    else { updateTreeSelectorOptions(); updateTreeBranchOptions(); renderTree(); }
    return { id };
  },
  getTreeWrites() { return window.__treeSelectorHarness.treeWrites; },
  isAdminUser() { return isAdminUser(); },
  mainTreeCount() { return getTreePeople(treePeople(), "main").length; },
  totalPeopleCount() { return treePeople().length; },
  setAdminMode(isAdmin) {
    if (isAdmin) {
      currentUserProfile = { role: "admin", status: "approved", displayName: "Admin" };
      primaryAdminUid = "test-admin";
      Object.defineProperty(auth, "currentUser", { value: { uid: "test-admin" }, configurable: true });
    } else {
      currentUserProfile = { role: "member", status: "approved", displayName: "Membre" };
      primaryAdminUid = "";
      Object.defineProperty(auth, "currentUser", { value: null, configurable: true });
    }
    updateTreeActionButtons();
  },
  emptyMessageVisible() { return !document.getElementById("treeEmptyMessage").hidden; },
  renameBtnVisible() { return !document.getElementById("treeRenameBtn").hidden; },
  createBtnVisible() { return !document.getElementById("treeCreateBtn").hidden; },
  openTreeDialog(mode, treeId) { openTreeDialog(mode, treeId); },
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

async function createHarnessPage(browser, server, viewport, forcedEnv = "recette") {
  const context = await browser.newContext({ viewport, locale: "fr-FR", isMobile: viewport.width <= 760, hasTouch: viewport.width <= 760, reducedMotion: "reduce" });
  await context.addInitScript(env => { window.__forcedEnv = env; }, forcedEnv);
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
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__treeSelectorHarness === "object");
  return { context, page };
}

test("création d'arbre : admin voit les boutons, validation, sélection après création", async t => {
  const server = await startStaticServer(ROOT);
  try {
    let browser;
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
    try {
      const { context, page } = await createHarnessPage(browser, server, { width: 390, height: 844 });
      try {
        await page.evaluate(data => window.__treeSelectorHarness.setData(data), fixture);
        /* admin voit les boutons */
        const btnState = await page.evaluate(() => ({
          admin: window.__treeSelectorHarness.isAdminUser(),
          createVisible: window.__treeSelectorHarness.createBtnVisible(),
          renameVisible: window.__treeSelectorHarness.renameBtnVisible()
        }));
        assert.equal(btnState.admin, false, "par défaut non-admin dans le harness");

        /* forcer admin */
        await page.evaluate(() => window.__treeSelectorHarness.setAdminMode(true));
        const adminBtns = await page.evaluate(() => ({
          createVisible: window.__treeSelectorHarness.createBtnVisible(),
          renameVisible: window.__treeSelectorHarness.renameBtnVisible()
        }));
        assert.equal(adminBtns.createVisible, true, "admin voit le bouton Créer");
        assert.equal(adminBtns.renameVisible, false, "pas de bouton Renommer sur l'arbre principal");

        /* création valide */
        const createResult = await page.evaluate(() => window.__treeSelectorHarness.saveTreeForTest("create", "Branche Test", "Une description"));
        assert.ok(createResult.id, "création réussie");
        let state = await page.evaluate(() => window.__treeSelectorHarness.state());
        assert.equal(state.activeTreeId, createResult.id, "nouvel arbre sélectionné");
        assert.ok(state.treeOptions.some(o => o.label === "Branche Test"), "arbre dans le sélecteur");
        const writes = await page.evaluate(() => window.__treeSelectorHarness.getTreeWrites());
        assert.equal(writes.length, 1, "une écriture enregistrée");
        assert.equal(writes[0].mode, "create");

        /* arbre vide : message visible */
        const emptyVisible = await page.evaluate(() => window.__treeSelectorHarness.emptyMessageVisible());
        assert.equal(emptyVisible, true, "message arbre vide affiché");

        /* les personnes de l'annuaire ne sont pas affectées (fixture intacte) */
        const catalogCheck = await page.evaluate(() => ({
          mainCount: window.__treeSelectorHarness.mainTreeCount(),
          totalPeople: window.__treeSelectorHarness.totalPeopleCount()
        }));
        assert.equal(catalogCheck.mainCount, 2, "personnes du principal inchangées");
        assert.equal(catalogCheck.totalPeople, 6, "annuaire commun intact (inTree !== false)");

        /* bouton renommer visible sur arbre secondaire */
        const renameOnSecondary = await page.evaluate(() => window.__treeSelectorHarness.renameBtnVisible());
        assert.equal(renameOnSecondary, true, "bouton Renommer visible sur arbre secondaire");

        /* nom vide refusé */
        const emptyName = await page.evaluate(() => window.__treeSelectorHarness.saveTreeForTest("create", "", ""));
        assert.ok(emptyName.error, "nom vide refusé");
        assert.match(emptyName.error, /obligatoire/);

        /* nom trop long refusé */
        const longName = await page.evaluate(() => window.__treeSelectorHarness.saveTreeForTest("create", "A".repeat(81), ""));
        assert.ok(longName.error, "nom trop long refusé");
        assert.match(longName.error, /80/);

        /* description trop longue refusée */
        const longDesc = await page.evaluate(() => window.__treeSelectorHarness.saveTreeForTest("create", "Arbre OK", "B".repeat(201)));
        assert.ok(longDesc.error, "description trop longue refusée");
        assert.match(longDesc.error, /200/);

        /* doublon refusé (insensible accents/casse) */
        const dup = await page.evaluate(() => window.__treeSelectorHarness.saveTreeForTest("create", "branche test", ""));
        assert.ok(dup.error, "doublon refusé");
        assert.match(dup.error, /existe déjà/);

        /* renommage */
        const renameResult = await page.evaluate(() => window.__treeSelectorHarness.saveTreeForTest("rename", "Branche Test Renommée", "Nouvelle desc", "tree-empty"));
        assert.ok(renameResult.id, "renommage réussi");
        state = await page.evaluate(() => window.__treeSelectorHarness.state());
        assert.ok(state.treeOptions.some(o => o.label === "Branche Test Renommée"), "nom mis à jour");
        const writes2 = await page.evaluate(() => window.__treeSelectorHarness.getTreeWrites());
        assert.equal(writes2.length, 2, "deux écritures");
        assert.equal(writes2[1].mode, "rename");
      } finally { await context.close(); }
    } finally { await browser.close(); }
  } finally { await server.close(); }
});

test("mobile 390px : boutons créer/renommer tactiles, dialogue accessible", async t => {
  const server = await startStaticServer(ROOT);
  try {
    let browser;
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
    try {
      const { context, page } = await createHarnessPage(browser, server, { width: 390, height: 844 });
      try {
        await page.evaluate(data => window.__treeSelectorHarness.setData(data), fixture);
        await page.evaluate(() => window.__treeSelectorHarness.setAdminMode(true));
        const boxes = await page.evaluate(() => {
          const create = document.getElementById("treeCreateBtn");
          const rename = document.getElementById("treeRenameBtn");
          const cBox = create.getBoundingClientRect();
          const rBox = rename.getBoundingClientRect();
          return {
            create: { w: cBox.width, h: cBox.height, visible: create.offsetParent !== null },
            rename: { w: rBox.width, h: rBox.height, visible: rename.offsetParent !== null },
            ariaCreate: create.getAttribute("aria-label"),
            ariaRename: rename.getAttribute("aria-label")
          };
        });
        assert.ok(boxes.create.visible, "bouton Créer visible");
        assert.ok(boxes.create.h >= 43, `bouton Créer ≥44px (${boxes.create.h})`);
        assert.equal(boxes.ariaCreate, "Créer un arbre");
        /* renommer masqué sur main */
        await page.evaluate(() => window.__treeSelectorHarness.chooseTree("tree-conti"));
        const renameOnConti = await page.evaluate(() => {
          const r = document.getElementById("treeRenameBtn");
          const box = r.getBoundingClientRect();
          return { visible: r.offsetParent !== null, h: box.height };
        });
        assert.ok(renameOnConti.visible, "Renommer visible sur arbre secondaire");
        assert.ok(renameOnConti.h >= 43, `Renommer ≥44px (${renameOnConti.h})`);
        /* dialogue ouvre */
        await page.evaluate(() => window.__treeSelectorHarness.openTreeDialog("create"));
        const dialogOpen = await page.evaluate(() => document.getElementById("treeDialog").open);
        assert.ok(dialogOpen, "dialogue de création ouvert");
        const title = await page.evaluate(() => document.getElementById("treeDialogTitle").textContent);
        assert.equal(title, "Créer un arbre");
      } finally { await context.close(); }
    } finally { await browser.close(); }
  } finally { await server.close(); }
});

test("arbre principal protégé : pas de renommage, pas de treeId main dans le catalogue", async t => {
  const server = await startStaticServer(ROOT);
  try {
    let browser;
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
    try {
      const { context, page } = await createHarnessPage(browser, server, { width: 1024, height: 768 });
      try {
        await page.evaluate(data => window.__treeSelectorHarness.setData(data), fixture);
        await page.evaluate(() => window.__treeSelectorHarness.setAdminMode(true));
        /* sur main : renommer masqué */
        const onMain = await page.evaluate(() => ({
          renameVisible: window.__treeSelectorHarness.renameBtnVisible(),
          activeTreeId: window.__treeSelectorHarness.state().activeTreeId
        }));
        assert.equal(onMain.activeTreeId, "main");
        assert.equal(onMain.renameVisible, false, "renommage impossible sur main");
        /* le catalogue ne contient pas trees/main */
        const catalog = await page.evaluate(() => window.__treeSelectorHarness.state().treeOptions);
        assert.ok(!catalog.some(o => o.value === "main" && o.label !== "Arbre familial"), "pas de doublon main dans le catalogue");
        /* rename sur main est refusé par le helper */
        const renameMain = await page.evaluate(() => window.__treeSelectorHarness.saveTreeForTest("rename", "Nouveau nom", "", "main"));
        assert.ok(renameMain.error, "renommage de main refusé");
      } finally { await context.close(); }
    } finally { await browser.close(); }
  } finally { await server.close(); }
});
