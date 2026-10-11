import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const harness = `
window.__multiData = { people: new Map(), families: new Map(), trees: new Map() };
window.__multiWrites = [];
window.__multiMode = "success";
window.__multiHarness = {
  seed({ people: persons, families: homes, trees }) {
    window.__multiData = {
      people: new Map(persons.map(item => [item.id, structuredClone(item)])),
      families: new Map(homes.map(item => [item.id, structuredClone(item)])),
      trees: new Map(trees.map(item => [item.id, structuredClone(item)]))
    };
    people = persons.map(item => ({ ...item }));
    families = homes.map(item => structuredClone(item));
    documents = []; tasks = []; treeMetadata = trees.map(item => ({ ...item }));
    activeTreeId = "main"; treeCatalogState = "ready"; treeCatalogMessage = "";
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    loadedProcedures = true;
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
    currentUserProfile = { role: "admin", status: "approved", displayName: "Admin Test" };
    primaryAdminUid = "";
    Object.defineProperty(auth, "currentUser", { value: { uid: "admin-multi-test" }, configurable: true });
    window.__multiWrites = []; window.__multiMode = "success";
    updateTreeSelectorOptions(); updateTreeBranchOptions();
    setView("directory"); renderDirectory();
  },
  setRole(role) {
    currentUserProfile = { role, status: "approved", displayName: "Test" };
    Object.defineProperty(auth, "currentUser", { value: { uid: role === "admin" ? "admin-multi-test" : "member-multi-test" }, configurable: true });
    renderDirectory();
  },
  setMode(mode) { window.__multiMode = mode; },
  snapshot() {
    return {
      open: document.getElementById("multiTreeTransferDialog").open,
      error: document.getElementById("multiTreeTransferError").textContent,
      count: document.getElementById("multiTreeTransferSelectionCount").textContent,
      preview: document.getElementById("multiTreeTransferPreview").textContent,
      people: [...window.__multiData.people.values()].map(item => structuredClone(item)),
      families: [...window.__multiData.families.values()].map(item => structuredClone(item)),
      writes: window.__multiWrites.map(item => structuredClone(item))
    };
  }
};
window.__multiFreshRead = async personIds => {
  const selected = new Set(personIds);
  if (window.__multiMode === "family-changed-before") {
    const family = window.__multiData.families.get("parents-paul");
    family.parentChildLinks = [{ parentId: "marie", childId: "paul", type: "adoptive" }];
  }
  const related = [...window.__multiData.families.values()].filter(family => familyPersonIds(family).some(id => selected.has(id)));
  const allIds = new Set([...selected, ...related.flatMap(familyPersonIds)]);
  return {
    families: related.map(item => structuredClone(item)),
    people: [...allIds].map(id => window.__multiData.people.get(id)).filter(Boolean).map(item => structuredClone(item))
  };
};
window.__multiRunTransaction = async callback => {
  if (window.__multiMode === "family-changed-in-transaction") {
    const family = window.__multiData.families.get("parents-paul");
    family.parentChildLinks = [{ parentId: "marie", childId: "paul", type: "adoptive" }];
  }
  if (window.__multiMode === "person-changed-in-transaction") window.__multiData.people.get("paul").treeId = "tree-b";
  const read = ref => {
    const [collectionName, id] = ref.path.split("/");
    if (window.__multiMode === "selected-missing-in-transaction" && collectionName === "people" && id === "paul") {
      return { id, exists: () => false, data: () => undefined };
    }
    if (window.__multiMode === "destination-missing" && collectionName === "trees" && id === "tree-a") {
      return { id, exists: () => false, data: () => undefined };
    }
    const value = window.__multiData[collectionName]?.get(id);
    return { id, exists: () => !!value, data: () => value ? structuredClone(value) : undefined };
  };
  const transaction = {
    get: async ref => read(ref),
    update: (ref, patch) => {
      const [collectionName, id] = ref.path.split("/");
      window.__multiWrites.push({ path: ref.path, changes: structuredClone(patch) });
      window.__multiData[collectionName].set(id, { ...window.__multiData[collectionName].get(id), ...structuredClone(patch) });
    }
  };
  return callback(transaction);
};`;

const people = [
  { id: "jean", firstName: "Jean", lastName: "Test", notes: "Note conservée" },
  { id: "marie", firstName: "Marie", lastName: "Test", treeId: null },
  { id: "paul", firstName: "Paul", lastName: "Test", inTree: false, notes: "Paul reste masqué" },
  { id: "sophie", firstName: "Sophie", lastName: "Test", treeId: "tree-a" },
  { id: "sans-lien", firstName: "Autre", lastName: "Test" }
];
const families = [
  { id: "parents-paul", partnerIds: ["jean", "marie"], childIds: ["paul"], parentChildLinks: [
    { parentId: "jean", childId: "paul", type: "biological" },
    { parentId: "marie", childId: "paul", type: "biological" }
  ] },
  { id: "union-paul", partnerIds: ["paul", "sophie"], childIds: [] }
];
const trees = [{ id: "tree-a", name: "Giovannoni Orino" }, { id: "tree-b", name: "Autre arbre" }];
const seed = { people, families, trees };

async function openHarness(t) {
  const server = await startStaticServer(ROOT);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { await server.close(); t.skip(`Chromium indisponible : ${error.message}`); return null; }
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, locale: "fr-FR", reducedMotion: "reduce" });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const freshRead = "await readFreshMultipleTreeTransferData(expectedPlan.personIds, expectedPlan.destinationTreeId)";
      const transaction = "await runTransaction(db, async transaction => {";
      assert.ok(source.includes(freshRead), "relecture fraîche du transfert multiple présente");
      const start = source.indexOf("async function confirmMultipleTreeTransfer()");
      source = source.replace(freshRead, "await window.__multiFreshRead(expectedPlan.personIds)");
      const offset = source.indexOf(transaction, start);
      assert.ok(start >= 0 && offset > start, "transaction du transfert multiple repérée après la confirmation");
      source = source.slice(0, offset) + source.slice(offset).replace(transaction, "await window.__multiRunTransaction(async transaction => {");
      return route.fulfill({ response, body: `${source}\n${harness}` });
    }
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__multiHarness === "object");
    await page.evaluate(data => window.__multiHarness.seed(data), seed);
    return { page, context, browser, server };
  } catch (error) {
    await context.close(); await browser.close(); await server.close(); throw error;
  }
}

async function selectPerson(page, query, id) {
  const input = page.locator("#multiTreeTransferSearch");
  await input.fill(query);
  const option = page.locator(`[data-add-tree-transfer-person="${id}"]`);
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
}

async function prepareParentFamily(page) {
  await page.locator("#multiTreeTransferOpenBtn").click();
  await selectPerson(page, "Jean", "jean");
  await selectPerson(page, "Marie", "marie");
  await selectPerson(page, "Paul", "paul");
  await page.locator("#multiTreeTransferDestination").selectOption("tree-a");
}

test("transfert multiple : foyer parental explicitement sélectionné, aucune autre personne écrite", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    const before = await page.evaluate(() => window.__multiHarness.snapshot());
    await prepareParentFamily(page);
    assert.match(await page.locator("#multiTreeTransferSelectionCount").textContent(), /3 personnes sélectionnées/);
    const preview = await page.locator("#multiTreeTransferPreview").textContent();
    assert.match(preview, /Jean Test/);
    assert.match(preview, /Paul Test/);
    assert.match(preview, /Relation entre personnes transférées/);
    assert.match(preview, /Marie Test/);
    assert.match(preview, /Sophie Test|personne non transférée/);
    assert.equal((await page.evaluate(() => window.__multiWrites.length)), 0, "la sélection et l'aperçu n'écrivent rien");
    await page.locator("#confirmMultiTreeTransferBtn").click();
    await page.waitForFunction(() => window.__multiWrites.length === 3);
    const after = await page.evaluate(() => window.__multiHarness.snapshot());
    assert.deepEqual(after.writes.map(write => write.path).sort(), ["people/jean", "people/marie", "people/paul"]);
    assert.ok(after.writes.every(write => Object.keys(write.changes).every(key => ["treeId", "updatedBy", "updatedByName"].includes(key))));
    assert.equal(after.people.find(item => item.id === "jean").treeId, "tree-a");
    assert.equal(after.people.find(item => item.id === "paul").treeId, "tree-a");
    assert.equal(after.people.find(item => item.id === "paul").inTree, false, "la fiche masquée reste masquée");
    assert.equal(after.people.find(item => item.id === "paul").notes, "Paul reste masqué");
    assert.equal(after.people.find(item => item.id === "sophie").treeId, "tree-a", "Sophie non sélectionnée n'est pas réécrite");
    assert.deepEqual(after.families, before.families, "aucune relation ni famille n'est écrite");
    assert.equal(after.open, false);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("transfert multiple : l'offre de sélection se limite au même arbre source", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.locator("#multiTreeTransferOpenBtn").click();
    await selectPerson(page, "Jean", "jean");
    await page.locator("#multiTreeTransferSearch").fill("Sophie");
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-add-tree-transfer-person="sophie"]').count(), 0);
    assert.match(await page.locator("#multiTreeTransferSelectionNote").textContent(), /même arbre source/);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("le sélecteur d'interface bloque l'ajout au-delà de 20 personnes", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    const manyPeople = Array.from({ length: 21 }, (_, index) => ({ id: `limite-${index}`, firstName: "Membre", lastName: `Groupe ${String(index).padStart(2, "0")}` }));
    await page.evaluate(data => window.__multiHarness.seed(data), { people: manyPeople, families: [], trees });
    await page.locator("#multiTreeTransferOpenBtn").click();
    for (let index = 0; index < 20; index++) await selectPerson(page, `Groupe ${String(index).padStart(2, "0")}`, `limite-${index}`);
    assert.match(await page.locator("#multiTreeTransferSelectionCount").textContent(), /20 personnes sélectionnées/);
    assert.match(await page.locator("#multiTreeTransferSelectionNote").textContent(), /Limite de 20 personnes atteinte/);
    await page.locator("#multiTreeTransferSearch").fill("Groupe 20");
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-add-tree-transfer-person="limite-20"]').count(), 0);
    assert.equal(await page.evaluate(() => window.__multiHarness.snapshot().writes.length), 0);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("la sélection est retirée individuellement ou vidée sans déclencher de transfert", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.locator("#multiTreeTransferOpenBtn").click();
    await selectPerson(page, "Jean", "jean");
    await selectPerson(page, "Paul", "paul");
    await page.locator('[data-remove-tree-transfer-person="jean"]').click();
    assert.match(await page.locator("#multiTreeTransferSelectionCount").textContent(), /^1 personne sélectionnée/);
    assert.equal(await page.locator("#multiTreeTransferChips [data-remove-tree-transfer-person='jean']").count(), 0);
    await page.locator("#clearMultiTreeTransferSelectionBtn").click();
    assert.match(await page.locator("#multiTreeTransferSelectionCount").textContent(), /^0 personne sélectionnée/);
    assert.equal(await page.locator("#confirmMultiTreeTransferBtn").isDisabled(), true);
    assert.equal((await page.evaluate(() => window.__multiHarness.snapshot())).writes.length, 0);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("conflit de foyer détecté dans la transaction : aucune écriture partielle", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await prepareParentFamily(page);
    await page.evaluate(() => window.__multiHarness.setMode("family-changed-in-transaction"));
    await page.locator("#confirmMultiTreeTransferBtn").click();
    await page.waitForFunction(() => document.getElementById("multiTreeTransferError").textContent.length > 0);
    const after = await page.evaluate(() => window.__multiHarness.snapshot());
    assert.equal(after.writes.length, 0, "aucune écriture partielle");
    assert.equal(after.people.find(item => item.id === "jean").treeId, undefined);
    assert.equal(after.people.find(item => item.id === "paul").treeId, undefined);
    assert.match(after.error, /changé pendant la confirmation/i);
    assert.equal(after.open, true);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("aperçu obsolète bloque le transfert multiple avant toute écriture", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await prepareParentFamily(page);
    await page.evaluate(() => window.__multiHarness.setMode("family-changed-before"));
    await page.locator("#confirmMultiTreeTransferBtn").click();
    const snapshot = await page.evaluate(() => window.__multiHarness.snapshot());
    assert.equal(snapshot.writes.length, 0);
    assert.match(snapshot.error, /changé depuis l’aperçu/);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("appartenance d'une personne modifiée dans la transaction bloque le groupe", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await prepareParentFamily(page);
    await page.evaluate(() => window.__multiHarness.setMode("person-changed-in-transaction"));
    await page.locator("#confirmMultiTreeTransferBtn").click();
    await page.waitForFunction(() => document.getElementById("multiTreeTransferError").textContent.length > 0);
    const snapshot = await page.evaluate(() => window.__multiHarness.snapshot());
    assert.equal(snapshot.writes.length, 0, "l'appartenance concurrente ne produit aucune écriture partielle");
    assert.equal(snapshot.people.find(item => item.id === "jean").treeId, undefined);
    assert.equal(snapshot.people.find(item => item.id === "marie").treeId, null);
    assert.equal(snapshot.people.find(item => item.id === "paul").treeId, "tree-b", "la modification concurrente n'est pas écrasée");
    assert.match(snapshot.error, /appartenance d’une personne sélectionnée a changé/i);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("destination supprimée dans la transaction : aucune personne n'est transférée", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await prepareParentFamily(page);
    await page.evaluate(() => window.__multiHarness.setMode("destination-missing"));
    await page.locator("#confirmMultiTreeTransferBtn").click();
    await page.waitForFunction(() => document.getElementById("multiTreeTransferError").textContent.length > 0);
    const after = await page.evaluate(() => window.__multiHarness.snapshot());
    assert.equal(after.writes.length, 0);
    assert.match(after.error, /destination n.existe plus/i);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("personne sélectionnée supprimée avant la transaction : aucune autre personne ne bouge", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await prepareParentFamily(page);
    await page.evaluate(() => window.__multiHarness.setMode("selected-missing-in-transaction"));
    await page.locator("#confirmMultiTreeTransferBtn").click();
    await page.waitForFunction(() => document.getElementById("multiTreeTransferError").textContent.length > 0);
    const after = await page.evaluate(() => window.__multiHarness.snapshot());
    assert.equal(after.writes.length, 0);
    assert.match(after.error, /personne sélectionnée a été supprimée/i);
    assert.equal(after.people.find(item => item.id === "jean").treeId, undefined);
    assert.equal(after.people.find(item => item.id === "marie").treeId, null);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("bouton transfert multiple réservé aux administrateurs et dialogue responsive à 390 px", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.evaluate(() => window.__multiHarness.setRole("member"));
    assert.equal(await page.locator("#multiTreeTransferOpenBtn").isVisible(), false);
    await page.evaluate(() => window.__multiHarness.setRole("admin"));
    assert.equal(await page.locator("#multiTreeTransferOpenBtn").isVisible(), true);
    await page.locator("#multiTreeTransferOpenBtn").click();
    await page.locator("#multiTreeTransferSearch").fill("Jean");
    await page.locator('[data-add-tree-transfer-person="jean"]').waitFor({ state: "visible" });
    await page.locator('[data-add-tree-transfer-person="jean"]').click();
    await page.locator("#multiTreeTransferDestination").selectOption("tree-a");
    await page.setViewportSize({ width: 390, height: 844 });
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialog: document.getElementById("multiTreeTransferDialog").getBoundingClientRect(),
      buttons: [...document.querySelectorAll("#multiTreeTransferDialog .modal-actions button")].map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height }))
    }));
    assert.equal(layout.overflow, 0);
    assert.ok(layout.dialog.width > 0 && layout.dialog.right <= 390);
    assert.ok(layout.buttons.every(button => button.width > 0 && button.height >= 44));
    await page.locator('[data-close="multiTreeTransferDialog"]').first().click();
    assert.equal(await page.locator("#multiTreeTransferDialog").evaluate(dialog => dialog.open), false);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("reproduction Lot 4D : Entrée synchronise chips, compteur, aperçu et IDs transmis", async t => {
  const h = await openHarness(t); if (!h) return;
  const { page, context, browser, server } = h;
  try {
    await page.locator("#multiTreeTransferOpenBtn").click();
    await selectPerson(page, "Jean", "jean");
    await page.locator("#multiTreeTransferDestination").selectOption("tree-a");

    const search = page.locator("#multiTreeTransferSearch");
    await search.fill("Paul");
    await page.locator('[data-add-tree-transfer-person="paul"]').waitFor({ state: "visible" });
    await search.press("Enter"); // Ajout clavier : aucun événement click ne doit être requis.

    const selectionBeforeConfirm = await page.evaluate(() => ({
      chipNames: [...document.querySelectorAll("#multiTreeTransferChips .person-multiselect-chip-label")].map(node => node.textContent.trim()),
      counter: document.getElementById("multiTreeTransferSelectionCount").textContent.trim(),
      previewNames: [...(document.querySelector("#multiTreeTransferPreview ul")?.querySelectorAll("strong") || [])].map(node => node.textContent.trim()),
      confirmEnabled: !document.getElementById("confirmMultiTreeTransferBtn").disabled
    }));
    await page.locator("#confirmMultiTreeTransferBtn").click();
    await page.waitForFunction(() => window.__multiWrites.length > 0 || !document.getElementById("multiTreeTransferDialog").open);
    const writtenIds = await page.evaluate(() => window.__multiWrites.map(write => write.path.split("/")[1]).sort());

    assert.deepEqual({ selectionBeforeConfirm, writtenIds }, {
      selectionBeforeConfirm: {
        chipNames: ["Test Jean", "Test Paul"],
        counter: "2 personnes sélectionnées sur 20 maximum",
        previewNames: ["Jean Test", "Paul Test"],
        confirmEnabled: true
      },
      writtenIds: ["jean", "paul"]
    }, "une sélection ajoutée au clavier doit être cohérente jusqu'aux IDs transmis à la transaction");
  } finally { await context.close(); await browser.close(); await server.close(); }
});
