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
    window.__treeWriteLog = [];
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
  deleteCurrentTree() { return deleteManagedTree(activeTreeId); },
  recoverCurrentTree() { return recoverManagedTree(activeTreeId); },
  exportCurrentSvg() {
    return treeExportSvg({ people: currentScope?.people || [], layout: currentLayout, markers: treeContextMarkers(currentScope || {}) });
  },
  removeActiveTreeFromCatalog() {
    treeMetadata = treeMetadata.filter(tree => tree.id !== activeTreeId);
    acceptTreeCatalog({ docs: treeMetadata.map(tree => ({ id: tree.id, data: () => ({ name: tree.name, description: tree.description || "" }) })) });
  },
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
  rowAction(treeId, action) { return document.querySelector('[data-tree-row-actions="' + treeId + '"] [data-tree-action="' + action + '"]'); },
  renameBtnVisible(treeId = activeTreeId) { const button = this.rowAction(treeId, "rename"); return !!button && !button.disabled; },
  createBtnVisible() { const button = document.getElementById("manageTreeCreateBtn"); return !!button && !button.hidden && !button.disabled; },
  managerButtonVisible() { const trigger = document.getElementById("treeSelectTrigger"); return !!trigger && trigger.offsetParent !== null; },
  managerContainerHidden() { return document.getElementById("manageTreeCreateBtn").hidden; },
  managerMenuOpen() { return document.getElementById("treeSelectorDetails").open; },
  deleteActionDisabled(treeId = activeTreeId) { const button = this.rowAction(treeId, "delete"); return !button || button.disabled; },
  deleteActionHidden(treeId = activeTreeId) { const button = this.rowAction(treeId, "delete"); return !button || button.hidden; },
  recoverActionHidden(treeId = activeTreeId) { const tree = treeMetadata.find(item => item.id === treeId); return !tree || getTreeLifecycleState(tree) !== TREE_LIFECYCLE_DELETING; },
  recoverActionDisabled(treeId = activeTreeId) { return !this.rowAction(treeId, "delete") || this.rowAction(treeId, "delete").disabled; },
  deleteNotice(treeId = activeTreeId) { const tree = treeMetadata.find(item => item.id === treeId); return getTreeLifecycleState(tree) === TREE_LIFECYCLE_DELETING ? "Suppression en cours ou interrompue" : "Suppression vérifiée par Firestore"; },
  openSelector() { document.getElementById("treeSelectorDetails").open = true; },
  openTreeActions(treeId = activeTreeId) { document.getElementById("treeSelectorDetails").open = true; const details = document.querySelector('[data-tree-row-actions="' + treeId + '"]'); if (details) details.open = true; },
  openTreeDialog(mode, treeId) { openTreeDialog(mode, treeId); },
  submitTreeForm() {
    const form = document.getElementById("treeForm");
    const event = new Event("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "submitter", { value: document.getElementById("saveTreeBtn") });
    form.dispatchEvent(event);
  },
  treeWriteLog() { return window.__treeWriteLog.map(({ mode, id, name, description, createdBy, hasCreatedAt }) => ({ mode, id, name, description, createdBy, hasCreatedAt })); },
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

async function runTreeRowAction(page, treeId, action) {
  if (!(await page.locator("#treeSelectorDetails").evaluate(details => details.open))) await page.locator("#treeSelectTrigger").click();
  const details = page.locator(`[data-tree-row-actions="${treeId}"]`);
  if (!(await details.evaluate(element => element.open))) await details.locator(":scope > summary").click();
  await page.locator(`[data-tree-action="${action}"][data-tree-id="${treeId}"]`).click();
}

test("le sélecteur unifié regroupe sélection, actions par arbre et création", async () => {
  const html = await (await import("node:fs/promises")).readFile(new URL("../index.html", import.meta.url), "utf8");
  const css = await (await import("node:fs/promises")).readFile(new URL("../css/design-system.css", import.meta.url), "utf8");
  assert.match(html, /id="treeSelectTrigger"[^>]*>[\s\S]*?<span class="tree-picker-prefix">Arbre<\/span>[\s\S]*?treeSelectCurrentName/);
  assert.match(html, /id="branchPickerDetails"[\s\S]*?treeBranchCurrentName/);
  assert.match(html, /id="treeSelectorRows"/);
  assert.match(html, /id="manageTreeCreateBtn"[^>]*>\+ Créer un arbre<\/button>/);
  assert.doesNotMatch(html, /id="manageTreesBtn"|id="treeManagementPopover"|id="manageTreeRenameBtn"|id="manageTreeDeleteBtn"|id="manageTreeRecoverBtn"/);
  assert.match(css, /\.tree-picker-menu/);
  assert.match(css, /\.tree-row-actions-menu/);
  assert.match(html, /class="tree-picker branch-picker"/);
  const headerActions = html.match(/<div class="hero-actions" id="headerTreeActions">([\s\S]*?)<\/div>\s*<\/section>/)?.[1] || "";
  const addIndex = headerActions.indexOf('id="addBtn"');
  assert.ok(addIndex >= 0, "CTA principal Ajouter une personne conservé");
  assert.equal((headerActions.match(/<button\b/g) || []).length, 1, "aucun menu indépendant près du CTA");
  assert.match(headerActions, /<button class="btn primary page-primary-action" id="addBtn"/);
});

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
              if (new URL(url).pathname.endsWith("/js/app.js")) {
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
                const treeTrigger = document.getElementById("treeSelectTrigger");
                const branchTrigger = document.getElementById("treeBranchTrigger");
                return {
                  labels: [treeTrigger.querySelector(".tree-picker-prefix").textContent, treeTrigger.querySelector(".tree-picker-current").textContent, branchTrigger.querySelector(".tree-picker-prefix").textContent, branchTrigger.querySelector(".tree-picker-current").textContent],
                  order: treeTrigger.compareDocumentPosition(branchTrigger) & Node.DOCUMENT_POSITION_FOLLOWING,
                  nativeSelects: tree.tagName === "SELECT" && branch.tagName === "SELECT",
                  ariaLabels: [tree.getAttribute("aria-label"), branch.getAttribute("aria-label")],
                  treeBox: treeTrigger.getBoundingClientRect().toJSON(),
                  branchBox: branchTrigger.getBoundingClientRect().toJSON(),
                  hiddenBackings: tree.hidden && branch.hidden,
                  horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
                };
              });
              assert.deepEqual(controls.labels, ["Arbre", "Familial", "Branche", "Toutes"], "libellés intégrés dans les deux champs");
              assert.ok(controls.nativeSelects && controls.hiddenBackings, "sélecteurs natifs conservés comme modèle de données caché derrière les contrôles accessibles");
              assert.deepEqual(controls.ariaLabels, ["Choisir un arbre", "Filtrer par branche familiale"]);
              assert.ok(controls.order, "sélecteur d'arbre placé avant le sélecteur de branches");
              assert.equal(controls.horizontalOverflow, 0, "aucun débordement horizontal");
              assert.ok(controls.treeBox.height >= 43 && controls.branchBox.height >= 43, "sélecteurs tactiles ≥44px");
              const treeRows = await page.locator("#treeSelectorRows .tree-picker-row").evaluateAll(rows => rows.map(row => ({ id: row.dataset.treeRow, text: row.querySelector(".tree-picker-option").textContent.replace(/\s+/g, " ").trim(), count: row.querySelector(".tree-picker-count").textContent.trim() })));
              assert.deepEqual(treeRows.map(row => row.id), ["main", "tree-conti", "tree-empty"], "ordre principal puis catalogue existant conservé");
              assert.deepEqual(treeRows.map(row => row.count), ["2 pers.", "2 pers.", "1 pers."], "compteurs calculés sur les personnes visibles dans chaque arbre");
              assert.match(treeRows[0].text, /Arbre familial\s*Principal/);

              let state = await page.evaluate(() => window.__treeSelectorHarness.state());
              assert.equal(state.activeTreeId, "main", "arbre principal sélectionné par défaut");
              assert.deepEqual(state.peopleIds, ["main-parent", "main-child"], "treeId absent appartient à main, treeId secondaire est exclu");
              assert.deepEqual(state.familyIds, ["family-main", "family-hidden-same-tree"], "foyers du principal inclus, liens inter-arbres exclus");
              assert.deepEqual(state.branchOptions.map(option => option.label), ["Toutes les branches", "Rossi"], "branches disponibles limitées au principal et personnes visibles");
              const branchRows = await page.locator("#branchPickerRows [data-branch-value]").evaluateAll(rows => rows.map(row => ({ value: row.dataset.branchValue, name: row.querySelector(".tree-picker-name").textContent.trim(), count: row.querySelector(".tree-picker-count").textContent.trim() })));
              assert.deepEqual(branchRows, [{ value: "", name: "Toutes les branches", count: "" }, { value: "Rossi", name: "Rossi", count: "2" }], "branches du principal sans pastilles, avec compteurs");

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
    if (new URL(url).pathname.endsWith("/js/app.js")) {
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
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const createCall = 'const created = await addDoc(refs.trees, { ...data, lifecycleState: TREE_LIFECYCLE_ACTIVE, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "" });';
      const renameCall = 'await updateDoc(doc(db, "trees", id), data);';
      assert.ok(source.includes(createCall), "appel Firestore de création d'arbre attendu");
      assert.ok(source.includes(renameCall), "appel Firestore de renommage attendu");
      assert.ok(source.includes("return runTransaction(db, operation);"), "transaction du cycle de vie isolée pour les tests UI");
      source = source
        .replace(createCall, 'const created = await window.__treeWriteMock("create", null, { ...data, lifecycleState: TREE_LIFECYCLE_ACTIVE, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "" });')
        .replace(renameCall, 'await window.__treeWriteMock("rename", id, data);')
        .replace("return runTransaction(db, operation);", "return window.__treeLifecycleTestMocks.runTransaction(treeRef, operation);")
        .replace("return getDocFromServer(treeRef);", "return window.__treeLifecycleTestMocks.readTree(treeRef);")
        .replace('return getDocsFromServer(query(refs.people, where("treeId", "==", treeId)));', "return window.__treeLifecycleTestMocks.readMembers(treeId);");
      const mockWrites = `
window.__treeWriteLog = [];
window.__treeWriteMock = async (mode, id, data) => {
  const treeId = id || "tree-test-" + (window.__treeWriteLog.length + 1);
  window.__treeWriteLog.push({ mode, id: treeId, name: data.name, description: data.description || "", createdBy: data.createdBy || "", hasCreatedAt: !!data.createdAt });
  const tree = treeMetadata.find(item => item.id === treeId);
  if (mode === "create" && !tree) treeMetadata.push({ id: treeId, name: data.name, description: data.description || "", lifecycleState: "active" });
  if (mode === "rename" && tree) {
    Object.assign(tree, { name: data.name, description: data.description || "" });
    updateTreeSelectorOptions();
    updateTreeBranchOptions();
    renderTree();
  }
  return { id: treeId };
};
window.__treeLifecycleTestMocks = {
  records: new Map(), members: [], transactionLog: [], readLog: [], failMemberRead: false,
  async runTransaction(ref, operation) {
    const staged = [];
    const transaction = {
      get: async target => {
        const record = this.records.get(target.id);
        return { exists: () => !!record, data: () => record ? { ...record } : undefined };
      },
      update: (target, changes) => staged.push({ kind: "update", id: target.id, changes }),
      delete: target => staged.push({ kind: "delete", id: target.id })
    };
    await operation(transaction);
    for (const write of staged) {
      this.transactionLog.push(write.kind);
      if (write.kind === "delete") this.records.delete(write.id);
      else {
        const record = { ...(this.records.get(write.id) || {}) };
        for (const [key, value] of Object.entries(write.changes)) {
          if (write.changes.lifecycleState === "active" && ["deletionToken", "deletionStartedAt", "deletionStartedBy"].includes(key)) delete record[key];
          else if (value?._methodName === "deleteField") delete record[key];
          else record[key] = value;
        }
        this.records.set(write.id, record);
        const cached = treeMetadata.find(tree => tree.id === write.id);
        if (cached) {
          Object.assign(cached, record);
          for (const key of ["deletionToken", "deletionStartedAt", "deletionStartedBy"]) if (!(key in record)) delete cached[key];
          updateTreeActionButtons();
        }
      }
    }
  },
  async readTree(ref) {
    this.readLog.push("tree");
    const record = this.records.get(ref.id);
    return { exists: () => !!record, data: () => record ? { ...record } : undefined };
  },
  async readMembers(treeId) {
    this.readLog.push("members");
    if (this.failMemberRead) throw new Error("unavailable local mock");
    const docs = this.members.filter(item => item.treeId === treeId).map(item => ({ id: item.id, data: () => ({ ...item }) }));
    return { docs, empty: docs.length === 0, metadata: { fromCache: false } };
  }
};`;
      return route.fulfill({ response, body: `${source}\n${testHooks}\n${mockWrites}` });
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
          renameVisible: window.__treeSelectorHarness.renameBtnVisible(),
          managerHidden: window.__treeSelectorHarness.managerContainerHidden()
        }));
        assert.equal(btnState.admin, false, "par défaut non-admin dans le harness");
        assert.equal(btnState.createVisible, false, "bouton Créer masqué aux membres");
        assert.equal(btnState.managerHidden, true, "conteneur masqué aux membres sans créer de ligne vide");
        await page.evaluate(() => window.__treeSelectorHarness.openTreeDialog("create"));
        assert.equal(await page.locator("#treeDialog").evaluate(dialog => dialog.open), false, "membre ne peut pas ouvrir le dialogue par appel direct");
        assert.match(await page.locator("#toastMessage").textContent(), /réservé aux administrateurs/);

        /* forcer admin */
        await page.evaluate(() => window.__treeSelectorHarness.setAdminMode(true));
        const adminBtns = await page.evaluate(() => ({
          createVisible: window.__treeSelectorHarness.createBtnVisible(),
          renameVisible: window.__treeSelectorHarness.renameBtnVisible(),
          managerHidden: window.__treeSelectorHarness.managerContainerHidden()
        }));
        assert.equal(adminBtns.createVisible, true, "admin voit le bouton Créer");
        assert.equal(adminBtns.renameVisible, false, "pas de bouton Renommer sur l'arbre principal");
        assert.equal(adminBtns.managerHidden, false, "conteneur de gestion montré aux administrateurs");

        const submitForm = () => page.locator("#treeForm").evaluate(form => {
          const event = new Event("submit", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "submitter", { value: document.getElementById("saveTreeBtn") });
          form.dispatchEvent(event);
        });
        const setFormValues = (name, description) => page.evaluate(({ name, description }) => {
          document.getElementById("treeName").value = name;
          document.getElementById("treeDescription").value = description;
        }, { name, description });
        const openCreate = async () => {
          await page.locator("#treeSelectTrigger").click();
          await page.locator("#manageTreeCreateBtn").click();
        };
        const writeLog = () => page.evaluate(() => window.__treeWriteLog.map(write => ({ ...write })));

        /* nom vide et bornes sont validés par le handler réel */
        await openCreate();
        await setFormValues("   ", "");
        await submitForm();
        assert.match(await page.locator("#toastMessage").textContent(), /nom est obligatoire/);
        assert.equal((await writeLog()).length, 0, "aucune écriture pour nom vide");
        await page.locator("#treeDialog .modal-actions [data-close=treeDialog]").click();

        await openCreate();
        await setFormValues("A".repeat(81), "");
        await submitForm();
        assert.match(await page.locator("#toastMessage").textContent(), /80 caractères/);
        assert.equal((await writeLog()).length, 0, "aucune écriture pour nom trop long");
        await page.locator("#treeDialog .modal-actions [data-close=treeDialog]").click();

        await openCreate();
        await setFormValues("Arbre Test", "D".repeat(201));
        await submitForm();
        assert.match(await page.locator("#toastMessage").textContent(), /200 caractères/);
        assert.equal((await writeLog()).length, 0, "aucune écriture pour description trop longue");
        await page.locator("#treeDialog .modal-actions [data-close=treeDialog]").click();

        /* création valide : chemin réel, écriture Firestore interceptée au bord réseau */
        await openCreate();
        await setFormValues("Branche Test", "Une description");
        assert.deepEqual(await page.evaluate(() => ({ name: document.getElementById("treeName").value, description: document.getElementById("treeDescription").value })), { name: "Branche Test", description: "Une description" }, "champs création distincts");
        await submitForm();
        await page.waitForFunction(() => window.__treeWriteLog.length === 1);
        let state = await page.evaluate(() => window.__treeSelectorHarness.state());
        const writes = await writeLog();
        assert.equal(writes[0].mode, "create");
        assert.match(writes[0].id, /^tree-test-/);
        assert.equal(writes[0].name, "Branche Test");
        assert.equal(writes[0].createdBy, "test-admin");
        assert.ok(writes[0].hasCreatedAt, "createdAt transmis à Firestore");
        assert.equal(state.activeTreeId, writes[0].id, "nouvel arbre sélectionné");
        assert.ok(state.treeOptions.some(o => o.label === "Branche Test"), "arbre dans le sélecteur");
        assert.equal(await page.locator("#treeDialog").evaluate(dialog => dialog.open), false, "dialogue fermé après sauvegarde");
        assert.equal(await page.evaluate(() => window.__treeSelectorHarness.emptyMessageVisible()), true, "arbre vide annoncé sans erreur");
        const catalogCheck = await page.evaluate(() => ({ mainCount: window.__treeSelectorHarness.mainTreeCount(), totalPeople: window.__treeSelectorHarness.totalPeopleCount() }));
        assert.equal(catalogCheck.mainCount, 2, "personnes du principal inchangées");
        assert.equal(catalogCheck.totalPeople, 6, "annuaire commun intact (inTree !== false)");

        /* doublon normalisé rejeté avant tout nouvel appel Firestore */
        await openCreate();
        await setFormValues("  BRÁNCHE   test  ", "");
        await submitForm();
        assert.match(await page.locator("#toastMessage").textContent(), /existe déjà/);
        assert.equal((await writeLog()).length, 1, "pas de second document pour le doublon");
        await page.locator("#treeDialog .modal-actions [data-close=treeDialog]").click();

        /* renommage réel : même identifiant, pas de nouvel arbre */
        await page.evaluate(() => window.__treeSelectorHarness.chooseTree("tree-empty"));
        const renameVisible = await page.evaluate(() => window.__treeSelectorHarness.renameBtnVisible());
        assert.equal(renameVisible, true, "action Renommer activée sur arbre secondaire dans le sélecteur unifié");
        await page.locator("#treeSelectTrigger").click();
        await page.locator('[data-tree-row-actions="tree-empty"] > summary').click();
        await page.locator('[data-tree-action="rename"][data-tree-id="tree-empty"]').click();
        assert.equal(await page.locator("#treeDialogTitle").textContent(), "Renommer l'arbre");
        assert.equal(await page.locator("#treeId").inputValue(), "tree-empty");
        await setFormValues("Ramo isolé Renommé", "Nouvelle desc");
        assert.deepEqual(await page.evaluate(() => ({ name: document.getElementById("treeName").value, description: document.getElementById("treeDescription").value })), { name: "Ramo isolé Renommé", description: "Nouvelle desc" }, "champs renommage distincts");
        await submitForm();
        await page.waitForFunction(() => window.__treeWriteLog.length === 2);
        state = await page.evaluate(() => window.__treeSelectorHarness.state());
        const writesAfterRename = await writeLog();
        assert.equal(writesAfterRename[1].mode, "rename");
        assert.equal(writesAfterRename[1].id, "tree-empty", "identifiant préservé");
        assert.ok(state.treeOptions.some(o => o.value === "tree-empty" && o.label === "Ramo isolé Renommé"), `nom mis à jour dans le sélecteur : ${JSON.stringify({ options: state.treeOptions, writesAfterRename })}`);
      } finally { await context.close(); }
    } finally { await browser.close(); }
  } finally { await server.close(); }
});

test("sélecteur unifié : menus accessibles, actions par arbre et cibles tactiles", async t => {
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
          const trigger = document.getElementById("treeSelectTrigger");
          const tBox = trigger.getBoundingClientRect();
          return {
            trigger: { w: tBox.width, h: tBox.height, visible: trigger.offsetParent !== null },
            add: document.getElementById("addBtn").getBoundingClientRect().toJSON(),
            addOnly: document.querySelectorAll("#headerTreeActions > button").length === 1,
            noSeparateManager: !document.getElementById("manageTreesBtn") && !document.getElementById("treeManagementPopover")
          };
        });
        assert.ok(boxes.trigger.visible, "sélecteur d'arbre visible");
        assert.ok(boxes.trigger.w >= 43 && boxes.trigger.h >= 43, `sélecteur ≥44×44px (${boxes.trigger.w}×${boxes.trigger.h})`);
        assert.ok(boxes.addOnly && boxes.noSeparateManager, "Ajouter est l'unique CTA indépendant, sans menu Gérer les arbres");
        for (const width of [320, 375, 390]) {
          await page.setViewportSize({ width, height: 844 });
          await page.locator("#treeSelectTrigger").click();
          const mobileGeometry = await page.evaluate(() => {
            const menu = document.getElementById("treeSelectorMenu");
            const trigger = document.getElementById("treeSelectTrigger");
            const box = menu.getBoundingClientRect();
            const triggerBox = trigger.getBoundingClientRect();
            const style = getComputedStyle(menu);
            return {
              viewport: { width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio },
              menu: { x: box.x, y: box.y, width: box.width, height: box.height },
              trigger: { x: triggerBox.x, y: triggerBox.y, width: triggerBox.width, height: triggerBox.height },
              computed: { width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth, left: style.left, right: style.right, position: style.position, boxSizing: style.boxSizing },
              horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
            };
          });
          assert.ok(mobileGeometry.menu.x >= 0 && mobileGeometry.menu.x + mobileGeometry.menu.width <= mobileGeometry.viewport.width,
            `menu entièrement visible à ${width}px (viewport effectif ${mobileGeometry.viewport.width}px, dSF ${mobileGeometry.viewport.deviceScaleFactor}) : ${JSON.stringify(mobileGeometry)}`);
          assert.equal(mobileGeometry.horizontalOverflow, false, `pas de défilement horizontal à ${width}px`);
          await page.locator('[data-tree-row-actions="main"] > summary').click();
          const actionGeometry = await page.evaluate(() => {
            const menu = document.querySelector('[data-tree-row-actions="main"] .tree-row-actions-menu');
            const box = menu.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, viewport: window.innerWidth, buttons: [...menu.querySelectorAll("button")].map(button => ({ text: button.textContent.trim(), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })) };
          });
          assert.ok(actionGeometry.x >= 0 && actionGeometry.right <= actionGeometry.viewport, `menu d'actions visible à ${width}px : ${JSON.stringify(actionGeometry)}`);
          assert.ok(actionGeometry.buttons.every(button => button.width >= 43 && button.height >= 43), `actions tactiles et lisibles à ${width}px : ${JSON.stringify(actionGeometry)}`);
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
        }
        await page.setViewportSize({ width: 1024, height: 768 });
        const desktopTrigger = await page.locator("#treeSelectTrigger").boundingBox();
        const desktopAdd = await page.locator("#addBtn").boundingBox();
        assert.ok(desktopTrigger && desktopAdd && desktopTrigger.width >= 44 && desktopTrigger.x >= 0 && desktopTrigger.x + desktopTrigger.width <= 1024, "sélecteur visible et dans le viewport desktop");
        await page.locator("#treeSelectTrigger").click();
        const desktopMenu = await page.locator("#treeSelectorMenu").boundingBox();
        assert.ok(desktopMenu && desktopMenu.x >= 0 && desktopMenu.y >= 0 && desktopMenu.x + desktopMenu.width <= 1024 && desktopMenu.y + desktopMenu.height <= 768, `liste unifiée ancrée dans le viewport desktop : ${JSON.stringify(desktopMenu)}`);
        await page.keyboard.press("Escape");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator("#treeSelectTrigger").click();
        assert.equal(await page.evaluate(() => window.__treeSelectorHarness.managerMenuOpen()), true, "menu de gestion ouvert");
        const mobileMenu = await page.locator("#treeSelectorMenu").boundingBox();
        const effectiveViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        assert.ok(mobileMenu && mobileMenu.x >= 0 && mobileMenu.y >= 0 && mobileMenu.x + mobileMenu.width <= effectiveViewport.width && mobileMenu.y + mobileMenu.height <= effectiveViewport.height, `menu ancré dans le viewport mobile effectif ${JSON.stringify(effectiveViewport)} : ${JSON.stringify(mobileMenu)}`);
        await page.keyboard.press("Escape");
        assert.equal(await page.evaluate(() => window.__treeSelectorHarness.managerMenuOpen()), false, "Échap ferme le menu");
        assert.equal(await page.evaluate(() => document.activeElement.id), "treeSelectTrigger", "le focus revient au déclencheur");
        await page.locator("#treeSelectTrigger").press("ArrowDown");
        assert.equal(await page.evaluate(() => document.activeElement.dataset.treeSelect), "main", "flèche bas ouvre et focalise la première ligne");
        await page.keyboard.press("Escape");
        await page.locator("#treeSelectTrigger").click();
        const createBox = await page.locator("#manageTreeCreateBtn").evaluate(button => button.getBoundingClientRect());
        assert.ok(createBox.width >= 43 && createBox.height >= 43, `action Créer ≥44×44px (${createBox.width}×${createBox.height})`);
        await page.locator("#manageTreeCreateBtn").click();
        assert.equal(await page.locator("#treeDialog").evaluate(dialog => dialog.open), true, "clic Créer ouvre le dialogue réel");
        assert.equal(await page.locator("#treeDialogTitle").textContent(), "Créer un arbre");
        await page.locator("#treeDialog .modal-actions [data-close=treeDialog]").click();
        /* Principal : export possible, suppression désactivée ; renommage
           désactivé car aucune opération persistante n'existe pour trees/main. */
        await page.locator("#treeSelectTrigger").click();
        await page.locator('[data-tree-row-actions="main"] > summary').click();
        assert.equal(await page.evaluate(() => window.__treeSelectorHarness.renameBtnVisible("main")), false, "renommage principal désactivé sans simuler une écriture");
        assert.equal(await page.evaluate(() => window.__treeSelectorHarness.deleteActionDisabled("main")), true, "suppression principale désactivée");
        assert.equal(await page.locator('[data-tree-action="export"][data-tree-id="main"]').isEnabled(), true, "export principal conservé");
        assert.deepEqual(await page.locator('[data-tree-row-actions="main"] [role="menuitem"]').allTextContents(), ["Renommer", "Exporter", "Supprimer…"], "trois actions dans l’ordre requis");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await page.evaluate(() => window.__treeSelectorHarness.chooseTree("tree-conti"));
        await page.locator("#treeSelectTrigger").click();
        await page.locator('[data-tree-row-actions="tree-conti"] > summary').click();
        const rename = page.locator('[data-tree-action="rename"][data-tree-id="tree-conti"]');
        const renameBox = await rename.evaluate(button => button.getBoundingClientRect());
        assert.equal(await rename.isEnabled(), true, "Renommer activé sur arbre secondaire");
        assert.ok(renameBox.height >= 43 && renameBox.width >= 43, "action Renommer tactile");
        assert.equal(await page.evaluate(() => window.__treeSelectorHarness.deleteActionDisabled("tree-conti")), false, "suppression activée selon les droits de l'administrateur");
        assert.deepEqual(await page.locator('[data-tree-row-actions="tree-conti"] [role="menuitem"]').allTextContents(), ["Renommer", "Exporter", "Supprimer…"]);
        await rename.click();
        const dialogOpen = await page.evaluate(() => document.getElementById("treeDialog").open);
        assert.ok(dialogOpen, "dialogue de renommage ouvert");
        const title = await page.evaluate(() => document.getElementById("treeDialogTitle").textContent);
        assert.equal(title, "Renommer l'arbre");
        assert.equal(await page.locator("#treeId").inputValue(), "tree-conti");
      } finally { await context.close(); }
    } finally { await browser.close(); }
  } finally { await server.close(); }
});

test("arbre principal : export actif, suppression protégée, renommage non pris en charge", async t => {
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
        const onMain = await page.evaluate(() => ({ activeTreeId: window.__treeSelectorHarness.state().activeTreeId }));
        assert.equal(onMain.activeTreeId, "main");
        await page.locator("#treeSelectTrigger").click();
        await page.locator('[data-tree-row-actions="main"] > summary').click();
        assert.equal(await page.locator('[data-tree-action="rename"][data-tree-id="main"]').isDisabled(), true, "pas d'opération de renommage persistante pour trees/main");
        assert.equal(await page.locator('[data-tree-action="delete"][data-tree-id="main"]').isDisabled(), true, "suppression principale désactivée");
        assert.equal(await page.locator('[data-tree-action="export"][data-tree-id="main"]').isEnabled(), true, "export principal actif");
        /* le catalogue ne contient pas trees/main */
        const catalog = await page.evaluate(() => window.__treeSelectorHarness.state().treeOptions);
        assert.ok(!catalog.some(o => o.value === "main" && o.label !== "Arbre familial"), "pas de doublon main dans le catalogue");
        /* L'appel direct reste bloqué : le sélecteur n'invente pas une opération métier. */
        await page.evaluate(() => window.__treeSelectorHarness.openTreeDialog("rename", "main"));
        assert.equal(await page.locator("#treeDialog").evaluate(dialog => dialog.open), false, "dialogue principal non ouvert");
        assert.match(await page.locator("#toastMessage").textContent(), /principal ne peut pas être renommé/);
      } finally { await context.close(); }
    } finally { await browser.close(); }
  } finally { await server.close(); }
});

test("un arbre verrouillé conserve la récupération dans l'action de suppression contextualisée", async t => {
  const server = await startStaticServer(ROOT);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  try {
    const { context, page } = await createHarnessPage(browser, server, { width: 390, height: 844 });
    try {
      const lockedFixture = structuredClone(fixture);
      lockedFixture.trees[0].lifecycleState = "deleting";
      lockedFixture.trees[0].deletionToken = "emulator-token-locked-tree";
      await page.evaluate(data => window.__treeSelectorHarness.setData(data), lockedFixture);
      await page.evaluate(() => window.__treeSelectorHarness.setAdminMode(true));
      await page.evaluate(() => window.__treeSelectorHarness.chooseTree("tree-conti"));

      for (const width of [320, 390, 760, 1024]) {
        await page.setViewportSize({ width, height: 844 });
        await page.locator("#treeSelectTrigger").click();
        await page.locator('[data-tree-row-actions="tree-conti"] > summary').click();
        const state = await page.evaluate(() => ({
          deleteHidden: window.__treeSelectorHarness.deleteActionHidden("tree-conti"),
          deleteDisabled: window.__treeSelectorHarness.deleteActionDisabled("tree-conti"),
          label: document.getElementById("treeSelect").selectedOptions[0]?.textContent,
          actionLabel: document.querySelector('[data-tree-action="delete"][data-tree-id="tree-conti"]').textContent,
          actionTitle: document.querySelector('[data-tree-action="delete"][data-tree-id="tree-conti"]').title,
          actions: [...document.querySelectorAll('[data-tree-row-actions="tree-conti"] [role="menuitem"]')].map(item => item.textContent)
        }));
        assert.equal(state.deleteHidden, false, `action contextuelle présente à ${width}px`);
        assert.equal(state.deleteDisabled, false, `action de récupération accessible via le slot Supprimer à ${width}px`);
        assert.match(state.label, /Suppression en cours/);
        assert.equal(state.actionLabel, "Supprimer…", "le menu reste limité à l'action prévue");
        assert.match(state.actionTitle, /récupération existante/);
        assert.deepEqual(state.actions, ["Renommer", "Exporter", "Supprimer…"], "aucune quatrième action Débloquer dans le menu");
        await page.keyboard.press("Escape");
        assert.equal(await page.evaluate(() => document.activeElement.id), "treeSelectTrigger", "Échap ferme les menus et rend le focus au sélecteur");
      }
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});

test("suppression UI : annulation sans verrou puis suppression vide via requête serveur et transaction finale", async t => {
  const server = await startStaticServer(ROOT);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  try {
    const { context, page } = await createHarnessPage(browser, server, { width: 390, height: 844 });
    try {
      await page.evaluate(data => window.__treeSelectorHarness.setData(data), fixture);
      await page.evaluate(() => {
        window.__treeSelectorHarness.setAdminMode(true);
        window.__treeSelectorHarness.chooseTree("tree-empty");
        window.__confirmMessages = [];
        window.__confirmResult = false;
        window.confirm = message => { window.__confirmMessages.push(message); return window.__confirmResult; };
        window.__treeLifecycleTestMocks.records.set("tree-empty", { name: "Ramo isolato", lifecycleState: "active" });
      });
      await runTreeRowAction(page, "tree-empty", "delete");
      assert.equal(await page.evaluate(() => window.__treeLifecycleTestMocks.transactionLog.length), 0, "annulation sans verrou ni écriture");
      assert.match(await page.evaluate(() => window.__confirmMessages[0]), /Ramo isolato/);

      await page.evaluate(() => { window.__confirmResult = true; });
      await runTreeRowAction(page, "tree-empty", "delete");
      await page.waitForFunction(() => !window.__treeLifecycleTestMocks.records.has("tree-empty"));
      const result = await page.evaluate(() => ({
        activeTreeId: window.__treeSelectorHarness.state().activeTreeId,
        treeIds: [...document.getElementById("treeSelect").options].map(option => option.value),
        reads: window.__treeLifecycleTestMocks.readLog,
        writes: window.__treeLifecycleTestMocks.transactionLog,
        toast: document.getElementById("toastMessage").textContent
      }));
      assert.equal(result.activeTreeId, "main", "l’arbre sélectionné est remplacé par le principal");
      assert.ok(!result.treeIds.includes("tree-empty"), "catalogue et sélecteur actualisés");
      assert.deepEqual(result.reads, ["members"], "vacuité vérifiée par lecture serveur, pas par cache UI");
      assert.deepEqual(result.writes, ["update", "delete"], "verrou puis suppression transactionnelle");
      assert.match(result.toast, /a été supprimé/);
      assert.equal(await page.evaluate(() => window.__treeSelectorHarness.mainTreeCount()), 2, "les personnes du principal restent intactes");
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});

test("suppression UI : une fiche masquée bloque et l’échec de lecture laisse un verrou récupérable", async t => {
  const server = await startStaticServer(ROOT);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  try {
    const { context, page } = await createHarnessPage(browser, server, { width: 390, height: 844 });
    try {
      await page.evaluate(data => window.__treeSelectorHarness.setData(data), fixture);
      await page.evaluate(() => {
        window.__treeSelectorHarness.setAdminMode(true);
        window.__treeSelectorHarness.chooseTree("tree-empty");
        window.__confirmMessages = [];
        window.confirm = message => { window.__confirmMessages.push(message); return true; };
        const mocks = window.__treeLifecycleTestMocks;
        mocks.records.set("tree-empty", { name: "Ramo isolato", lifecycleState: "active" });
        mocks.members = [
          { id: "hidden-member", treeId: "tree-empty", inTree: false },
          { id: "invalid-member", treeId: "tree-empty", treeAssignmentState: "unassigned" }
        ];
      });
      await runTreeRowAction(page, "tree-empty", "delete");
      await page.waitForFunction(() => window.__treeLifecycleTestMocks.transactionLog.length >= 2);
      let state = await page.evaluate(() => ({
        tree: window.__treeLifecycleTestMocks.records.get("tree-empty"),
        writes: window.__treeLifecycleTestMocks.transactionLog,
        toast: document.getElementById("toastMessage").textContent
      }));
      assert.equal(state.tree.lifecycleState, "active", "arbre non supprimé et verrou réactivé");
      assert.deepEqual(state.writes, ["update", "update"]);
      assert.match(state.toast, /contient encore des personnes/);
      assert.match(state.toast, /appartenance incohérente référence aussi cet arbre/);
      assert.equal(state.tree.name, "Ramo isolato");

      await page.evaluate(() => {
        const mocks = window.__treeLifecycleTestMocks;
        mocks.members = [];
        mocks.failMemberRead = true;
        mocks.transactionLog = [];
      });
      await runTreeRowAction(page, "tree-empty", "delete");
      await page.waitForFunction(() => window.__treeLifecycleTestMocks.records.get("tree-empty")?.lifecycleState === "deleting");
      state = await page.evaluate(() => ({
        tree: window.__treeLifecycleTestMocks.records.get("tree-empty"),
        recoverHidden: window.__treeSelectorHarness.recoverActionHidden(),
        recoverDisabled: window.__treeSelectorHarness.recoverActionDisabled(),
        toast: document.getElementById("toastMessage").textContent
      }));
      assert.equal(state.recoverHidden, false);
      assert.equal(state.recoverDisabled, false);
      assert.match(state.toast, /Débloquer l’arbre/);
      const staleToken = state.tree.deletionToken;
      await runTreeRowAction(page, "tree-empty", "delete");
      assert.match(await page.evaluate(() => window.__confirmMessages.at(-1)), /invalidera le jeton actuel/);
      await page.waitForFunction(() => window.__treeLifecycleTestMocks.records.get("tree-empty")?.lifecycleState === "active");
      state = await page.evaluate(() => window.__treeLifecycleTestMocks.records.get("tree-empty"));
      assert.notEqual(state.deletionToken, staleToken, "le jeton périmé est invalidé par la récupération");
      assert.equal(state.deletionToken, undefined);
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});
