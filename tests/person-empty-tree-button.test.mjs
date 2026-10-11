import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const hooks = `
window.__btnHarness = {
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
    setView("tree"); renderTree();
  },
  chooseTree(id) { setActiveTree(id); },
  resetOpenCalls() { window.__openPersonCalls = 0; },
  openCalls() { return window.__openPersonCalls; },
  openPersonFor(id) {
    const item = people.find(p => p.id === id);
    openPerson(item || null, "tree");
  },
  state() {
    return {
      activeTreeId,
      creationTreeId: personCreationTreeId,
      dialogSource: personDialogSource,
      dialogOpen: document.getElementById("personDialog").open,
      personFormSaving,
      treeCatalogState,
      personCount: people.length,
      emptyBtnVisible: !!document.querySelector("#treeScene [data-empty-add]"),
      emptyBtnBox: (() => {
        const btn = document.querySelector("#treeScene [data-empty-add]");
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
      })()
    };
  }
};
window.__openPersonCalls = 0;
const originalOpenPerson = openPerson;
openPerson = (...args) => { window.__openPersonCalls++; return originalOpenPerson(...args); };
window.__personWrites = [];
window.__personUpdates = [];
window.__personTargetMock = async id => ({ exists: () => true });
window.__personWriteMock = async (id, data) => {
  window.__personWrites.push({ id, treeId: data.treeId, firstName: data.firstName });
};
window.__personUpdateMock = async (id, data) => {
  window.__personUpdates.push({ id, firstName: data.firstName });
};`;

const secondaryTrees = [{ id: "tree-giovannoni", name: "Giovannoni Orino" }];
const emptyPeople = [];
const peopleWithMain = [{ id: "main-a", firstName: "Anna", lastName: "Rossi" }];

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
      const update = 'await updateDoc(doc(db, "people", id), data);';
      assert.ok(source.includes(lookup), "la vérification de l'arbre cible doit être présente");
      assert.ok(source.includes(write), "la création doit passer par setDoc");
      source = source
        .replace(lookup, 'await window.__personTargetMock(destinationTreeId)')
        .replace(write, 'await window.__personWriteMock(createdId, { ...createData, inTree: true, createdAt: serverTimestamp() });')
        .replace(update, 'await window.__personUpdateMock(id, data);');
      return route.fulfill({ response, body: `${source}\n${hooks}` });
    }
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__btnHarness === "object");
    return { page, context, browser, server };
  } catch (error) {
    await context.close(); await browser.close(); await server.close();
    throw error;
  }
}

test("Bug A : le bouton central d'un arbre secondaire vide ouvre le formulaire", async t => {
  const h = await openHarness(t);
  if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.evaluate(data => window.__btnHarness.setData(data), { people: emptyPeople, trees: secondaryTrees });
    await page.evaluate(() => window.__btnHarness.chooseTree("tree-giovannoni"));

    let state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.activeTreeId, "tree-giovannoni");
    assert.equal(state.emptyBtnVisible, true, "le bouton Ajouter une personne est rendu dans l'arbre vide");
    assert.ok(state.emptyBtnBox && state.emptyBtnBox.visible, "le bouton a une taille non nulle");

    // Clic réel sur le bouton central
    await page.evaluate(() => window.__btnHarness.resetOpenCalls());
    await page.locator("#treeScene [data-empty-add]").click();
    state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.dialogOpen, true, "le formulaire s'ouvre après clic sur le bouton central");
    assert.equal(await page.evaluate(() => window.__btnHarness.openCalls()), 1, "le clic souris ne déclenche qu'une ouverture");
    assert.equal(state.creationTreeId, "tree-giovannoni", "la destination est l'arbre secondaire actif");
    assert.equal(state.dialogSource, "tree");

    // Le formulaire affiche le bon arbre
    const assignment = await page.locator("#personTreeAssignment").textContent();
    assert.match(assignment, /Giovannoni Orino/, "le formulaire indique le bon arbre");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("bouton central : Entrée, Espace et tactile ouvrent une seule fois; clic voisin ne l'ouvre pas", async t => {
  const h = await openHarness(t, 390);
  if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.evaluate(data => window.__btnHarness.setData(data), { people: emptyPeople, trees: secondaryTrees });
    await page.evaluate(() => window.__btnHarness.chooseTree("tree-giovannoni"));
    const button = page.locator("#treeScene [data-empty-add]");

    for (const key of ["Enter", "Space"]) {
      await page.evaluate(() => window.__btnHarness.resetOpenCalls());
      await button.focus();
      await page.keyboard.press(key);
      assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), true, `${key} ouvre le formulaire`);
      assert.equal(await page.evaluate(() => window.__btnHarness.openCalls()), 1, `${key} n'ouvre qu'une fois`);
      await page.evaluate(() => { const dialog = document.getElementById("personDialog"); if (dialog.open) dialog.close(); });
    }

    await page.evaluate(() => window.__btnHarness.resetOpenCalls());
    const rect = await button.boundingBox();
    await page.mouse.click(rect.x + rect.width + 8, rect.y + rect.height / 2);
    assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), false, "un clic à proximité ne l'ouvre pas");
    assert.equal(await page.evaluate(() => window.__btnHarness.openCalls()), 0);

    await page.evaluate(() => window.__btnHarness.resetOpenCalls());
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
    assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), true, "le tap tactile ouvre le formulaire");
    assert.equal(await page.evaluate(() => window.__btnHarness.openCalls()), 1, "le tap n'ouvre qu'une fois");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("Bug A : le bouton central fonctionne aussi dans l'arbre principal vide", async t => {
  const h = await openHarness(t);
  if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.evaluate(data => window.__btnHarness.setData(data), { people: emptyPeople, trees: secondaryTrees });
    // arbre principal actif par défaut
    let state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.activeTreeId, "main");
    assert.equal(state.emptyBtnVisible, true, "le bouton est rendu dans l'arbre principal vide");

    await page.locator("#treeScene [data-empty-add]").click();
    state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.dialogOpen, true);
    assert.equal(state.creationTreeId, "main");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("Bug A : le bouton central fonctionne après changement d'arbre", async t => {
  const h = await openHarness(t);
  if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.evaluate(data => window.__btnHarness.setData(data), { people: peopleWithMain, trees: secondaryTrees });
    // Arbre principal non vide
    let state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.emptyBtnVisible, false, "pas de bouton central quand l'arbre a des personnes");

    // Bascule vers arbre secondaire vide
    await page.evaluate(() => window.__btnHarness.chooseTree("tree-giovannoni"));
    state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.emptyBtnVisible, true, "le bouton apparaît sur l'arbre secondaire vide");

    await page.locator("#treeScene [data-empty-add]").click();
    state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.dialogOpen, true);
    assert.equal(state.creationTreeId, "tree-giovannoni");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("Bug B : la création depuis un arbre secondaire affecte bien cet arbre", async t => {
  const h = await openHarness(t);
  if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.evaluate(data => window.__btnHarness.setData(data), { people: peopleWithMain, trees: secondaryTrees });
    await page.evaluate(() => window.__btnHarness.chooseTree("tree-giovannoni"));

    // Clic sur le bouton supérieur Ajouter une personne
    await page.locator("#addBtn").click();
    let state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.dialogOpen, true);
    assert.equal(state.creationTreeId, "tree-giovannoni", "la destination est l'arbre secondaire");

    // Le formulaire indique le bon arbre
    const assignment = await page.locator("#personTreeAssignment").textContent();
    assert.match(assignment, /Giovannoni Orino/);

    // Remplir et soumettre
    await page.locator("#firstName").fill("Giuseppe");
    await page.locator("#lastName").fill("Giovannoni");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => window.__personWrites.length === 1 && document.getElementById("personId").value && !window.__btnHarness.state().personFormSaving);

    const writes = await page.evaluate(() => window.__personWrites.map(item => ({ ...item })));
    assert.equal(writes[0].treeId, "tree-giovannoni", "la personne est créée dans l'arbre secondaire");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("Bug B : la création depuis le bouton central d'un arbre secondaire vide affecte cet arbre", async t => {
  const h = await openHarness(t);
  if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.evaluate(data => window.__btnHarness.setData(data), { people: emptyPeople, trees: secondaryTrees });
    await page.evaluate(() => window.__btnHarness.chooseTree("tree-giovannoni"));

    // Clic sur le bouton central
    await page.locator("#treeScene [data-empty-add]").click();
    let state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.dialogOpen, true);
    assert.equal(state.creationTreeId, "tree-giovannoni");

    await page.locator("#firstName").fill("Maria");
    await page.locator("#lastName").fill("Giovannoni");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => window.__personWrites.length === 1);

    const writes = await page.evaluate(() => window.__personWrites.map(item => ({ ...item })));
    assert.equal(writes[0].treeId, "tree-giovannoni");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("Bug B : après édition et fermeture, une nouvelle création garde le bon arbre", async t => {
  const h = await openHarness(t);
  if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.evaluate(data => window.__btnHarness.setData(data), { people: peopleWithMain, trees: secondaryTrees });
    await page.evaluate(() => window.__btnHarness.chooseTree("tree-giovannoni"));

    // Créer une première personne
    await page.locator("#addBtn").click();
    await page.locator("#firstName").fill("Premier");
    await page.locator("#lastName").fill("Test");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => window.__personWrites.length === 1 && document.getElementById("personId").value && !window.__btnHarness.state().personFormSaving);

    // Fermer la fiche (elle est passée en mode édition)
    await page.locator('#personDialog button.icon-btn[data-close="personDialog"]').click();

    // Ouvrir à nouveau la création
    await page.locator("#addBtn").click();
    const state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.creationTreeId, "tree-giovannoni", "la deuxième création garde le même arbre");
    assert.equal(await page.locator("#personId").inputValue(), "", "le second formulaire est bien en création");
    assert.equal(await page.locator("#savePersonBtn").textContent(), "Continuer");

    await page.locator("#firstName").fill("Second");
    await page.locator("#lastName").fill("Test");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => window.__personWrites.length === 2 && document.getElementById("personId").value && !window.__btnHarness.state().personFormSaving);

    const writes = await page.evaluate(() => window.__personWrites.map(item => ({ ...item })));
    assert.equal(writes[1].treeId, "tree-giovannoni");
    assert.notEqual(writes[0].id, writes[1].id, "deux identifiants différents");
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("Bug B : l'édition d'une personne existante ne modifie jamais treeId", async t => {
  const h = await openHarness(t);
  if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.evaluate(data => window.__btnHarness.setData(data), { people: peopleWithMain, trees: secondaryTrees });
    await page.evaluate(() => window.__btnHarness.chooseTree("tree-giovannoni"));

    // Ouvrir la fiche d'une personne existante (main-a) via le hook
    await page.evaluate(() => window.__btnHarness.openPersonFor("main-a"));
    const state = await page.evaluate(() => window.__btnHarness.state());
    assert.equal(state.dialogOpen, true);
    assert.equal(state.creationTreeId, "main", "l'édition ne change pas la destination de création");

    // L'indication d'ajout est masquée en édition
    const assignmentVisible = await page.locator("#personTreeAssignment").isVisible();
    assert.equal(assignmentVisible, false, "pas d'indication Ajoutée à en édition");

    // Modifier le prénom et enregistrer
    await page.locator("#firstName").fill("Anna Modifiée");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => !document.getElementById("personDialog").open);

    // Vérifier qu'aucune écriture de création n'a eu lieu
    const writes = await page.evaluate(() => window.__personWrites);
    assert.equal(writes.length, 0, "aucune création lors d'une édition");
  } finally { await context.close(); await browser.close(); await server.close(); }
});
