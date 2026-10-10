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
  renameBtnVisible() { return !document.getElementById("treeRenameBtn").hidden; },
  createBtnVisible() {
    const container = document.getElementById("treeToolbarActions");
    const button = document.getElementById("treeCreateBtn");
    return !container.hidden && !button.hidden && button.offsetParent !== null;
  },
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
      let source = await response.text();
      const createCall = 'const created = await addDoc(refs.trees, { ...data, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "" });';
      const renameCall = 'await updateDoc(doc(db, "trees", id), data);';
      assert.ok(source.includes(createCall), "appel Firestore de création d'arbre attendu");
      assert.ok(source.includes(renameCall), "appel Firestore de renommage attendu");
      source = source
        .replace(createCall, 'const created = await window.__treeWriteMock("create", null, { ...data, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "" });')
        .replace(renameCall, 'await window.__treeWriteMock("rename", id, data);');
      const mockWrites = `
window.__treeWriteLog = [];
window.__treeWriteMock = async (mode, id, data) => {
  const treeId = id || "tree-test-" + (window.__treeWriteLog.length + 1);
  window.__treeWriteLog.push({ mode, id: treeId, name: data.name, description: data.description || "", createdBy: data.createdBy || "", hasCreatedAt: !!data.createdAt });
  const tree = treeMetadata.find(item => item.id === treeId);
  if (mode === "create" && !tree) treeMetadata.push({ id: treeId, name: data.name, description: data.description || "" });
  if (mode === "rename" && tree) {
    Object.assign(tree, { name: data.name, description: data.description || "" });
    updateTreeSelectorOptions();
    updateTreeBranchOptions();
    renderTree();
  }
  return { id: treeId };
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
          renameVisible: window.__treeSelectorHarness.renameBtnVisible()
        }));
        assert.equal(btnState.admin, false, "par défaut non-admin dans le harness");
        assert.equal(btnState.createVisible, false, "bouton Créer masqué aux membres");
        await page.evaluate(() => window.__treeSelectorHarness.openTreeDialog("create"));
        assert.equal(await page.locator("#treeDialog").evaluate(dialog => dialog.open), false, "membre ne peut pas ouvrir le dialogue par appel direct");
        assert.match(await page.locator("#toastMessage").textContent(), /réservé aux administrateurs/);

        /* forcer admin */
        await page.evaluate(() => window.__treeSelectorHarness.setAdminMode(true));
        const adminBtns = await page.evaluate(() => ({
          createVisible: window.__treeSelectorHarness.createBtnVisible(),
          renameVisible: window.__treeSelectorHarness.renameBtnVisible()
        }));
        assert.equal(adminBtns.createVisible, true, "admin voit le bouton Créer");
        assert.equal(adminBtns.renameVisible, false, "pas de bouton Renommer sur l'arbre principal");

        const submitForm = () => page.locator("#treeForm").evaluate(form => {
          const event = new Event("submit", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "submitter", { value: document.getElementById("saveTreeBtn") });
          form.dispatchEvent(event);
        });
        const setFormValues = (name, description) => page.evaluate(({ name, description }) => {
          document.getElementById("treeName").value = name;
          document.getElementById("treeDescription").value = description;
        }, { name, description });
        const openCreate = async () => page.locator("#treeCreateBtn").click();
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
        assert.equal(renameVisible, true, "bouton Renommer visible sur arbre secondaire");
        await page.locator("#treeRenameBtn").click();
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
        assert.ok(boxes.create.w >= 43 && boxes.create.h >= 43, `bouton Créer ≥44×44px (${boxes.create.w}×${boxes.create.h})`);
        assert.equal(boxes.ariaCreate, "Créer un arbre");
        await page.locator("#treeCreateBtn").click();
        assert.equal(await page.locator("#treeDialog").evaluate(dialog => dialog.open), true, "clic Créer ouvre le dialogue réel");
        assert.equal(await page.locator("#treeDialogTitle").textContent(), "Créer un arbre");
        await page.locator("#treeDialog .modal-actions [data-close=treeDialog]").click();
        /* renommer masqué sur main */
        await page.evaluate(() => window.__treeSelectorHarness.chooseTree("tree-conti"));
        const renameOnConti = await page.evaluate(() => {
          const r = document.getElementById("treeRenameBtn");
          const box = r.getBoundingClientRect();
          return { visible: r.offsetParent !== null, h: box.height };
        });
        assert.ok(renameOnConti.visible, "Renommer visible sur arbre secondaire");
        assert.ok(renameOnConti.h >= 43, `Renommer hauteur ≥44px (${renameOnConti.h})`);
        const renameWidth = await page.locator("#treeRenameBtn").evaluate(button => button.getBoundingClientRect().width);
        assert.ok(renameWidth >= 43, `Renommer largeur ≥44px (${renameWidth})`);
        /* bouton Renommer ouvre le dialogue pré-rempli */
        await page.locator("#treeRenameBtn").click();
        const dialogOpen = await page.evaluate(() => document.getElementById("treeDialog").open);
        assert.ok(dialogOpen, "dialogue de renommage ouvert");
        const title = await page.evaluate(() => document.getElementById("treeDialogTitle").textContent);
        assert.equal(title, "Renommer l'arbre");
        assert.equal(await page.locator("#treeId").inputValue(), "tree-conti");
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
        /* ouverture programmatique de renommage main refusée également */
        await page.evaluate(() => window.__treeSelectorHarness.openTreeDialog("rename", "main"));
        assert.equal(await page.locator("#treeDialog").evaluate(dialog => dialog.open), false, "dialogue principal non ouvert");
        assert.match(await page.locator("#toastMessage").textContent(), /principal ne peut pas être renommé/);
      } finally { await context.close(); }
    } finally { await browser.close(); }
  } finally { await server.close(); }
});
