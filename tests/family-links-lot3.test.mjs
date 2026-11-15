import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const [html, css, app] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../css/design-system.css", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8")
]);

test("lot 3 : le parcours Parent propose Union et Fin de relation seulement avec un second parent", () => {
  assert.match(html, /id="parentUnionSections" hidden/);
  assert.match(html, /id="parentUnionRelationType"/);
  assert.match(html, /data-date-control="parentUnion"/);
  assert.match(html, /id="parentEndType"/);
  assert.match(html, /id="parentEndDetailsFields" hidden/);
  assert.match(html, /data-date-control="parentEnd"/);
  for (const option of ["marriage", "civil", "partner", "other", "unknown"]) {
    assert.ok(html.includes(`<option value="${option}">`), `type de relation ${option} présent`);
  }
  for (const option of ["none", "separation", "divorce", "other", "unknown"]) {
    assert.ok(html.includes(`<option value="${option}">`), `situation ${option} présente`);
  }
  assert.match(css, /\.relation-add-union \{ display: grid/);
  assert.match(css, /\.relation-add-union\[hidden\] \{ display: none/);
  assert.match(app, /function updateParentUnionSectionsVisibility\(\)/);
  assert.match(app, /\$\("parent2Select"\)\.addEventListener\("change", updateParentUnionSectionsVisibility\)/);
  assert.match(app, /\$\("parentEndType"\)\.addEventListener\("change", updateParentEndDetailsVisibility\)/);
});

test("lot 3 : seules les valeurs explicitement renseignées sont écrites", () => {
  assert.match(app, /const familyId = await linkChildToParents\(activeId, parentIds, "", linkTypes\)/, "appel existant conservé");
  assert.match(app, /await applyParentBuilderRelationship\(familyId\)/);
  assert.match(app, /if \(relationType !== "unknown"\) data\.relationType = relationType/);
  assert.match(app, /if \(endType !== "none"\) data\.endType = endType/);
  assert.match(app, /if \(unionDateInfo\?\.type && unionDateInfo\.type !== "unknown"\) data\.unionDateInfo = unionDateInfo/);
  assert.match(app, /if \(endDateInfo\?\.type && endDateInfo\.type !== "unknown"\) data\.endDateInfo = endDateInfo/);
  assert.match(app, /if \(\$\("parentUnionSections"\)\?\.hidden\) return null/, "aucune écriture sans second parent");
  assert.match(app, /return createdFamily\.id;/, "le foyer créé est transmis au remplissage d'union");
  assert.match(app, /parentUnionPlace: \{ textKey: "unionPlace", infoKey: "unionPlaceInfo" \}/, "autocomplétion de lieu réutilisée");
  assert.match(app, /parentEndPlace: \{ textKey: "endPlace", infoKey: "endPlaceInfo" \}/);
});

test("lot 3 : les noms des partenaires et des enfants ouvrent leur fiche en modification", () => {
  const relations = app.slice(app.indexOf("function renderRelations()"), app.indexOf("async function addPartner"));
  assert.ok(relations.length > 0, "fonction renderRelations repérée");
  const partnerCard = relations.slice(relations.indexOf('kind: "partner",'), relations.indexOf('kind: "child",'));
  assert.match(partnerCard, /<button class="person-detail-relative-link" type="button" data-open-person-page=/, "lien partenaire");
  assert.doesNotMatch(partnerCard, /nameHtml: `<strong>/, "plus de nom en gras seul");
  const childCard = relations.slice(relations.indexOf("const childActions"));
  assert.match(childCard, /<button class="person-detail-relative-link" type="button" data-open-person-page=/, "lien enfant");
  assert.doesNotMatch(childCard, /nameHtml: `<strong>/, "plus de nom en gras seul");
  /* Les actions existantes restent distinctes du lien de navigation. */
  assert.match(childCard, /data-edit-family=/);
  assert.match(childCard, /data-remove-child=/);
  assert.match(app, /\$\("personDialog"\)\.addEventListener\("click", event => \{\s*const button = event\.target\.closest\("\[data-open-person-page\]"\);/, "navigation depuis la modale");
});

const hooks = `
window.__parentBuilderTest = {
  familyWrites: [],
  resetWrites() { this.familyWrites = []; },
  createFamily(data) {
    const copy = { ...data, id: "builder-family" };
    delete copy.updatedAt;
    delete copy.createdAt;
    families.push(copy);
    this.familyWrites.push({ kind: "create", data: JSON.parse(JSON.stringify(copy)) });
    return { id: copy.id };
  },
  updateFamily(familyId, data) {
    const copy = { ...data };
    delete copy.updatedAt;
    families = families.map(family => family.id === familyId ? { ...family, ...copy } : family);
    this.familyWrites.push({ kind: "update", familyId, data: JSON.parse(JSON.stringify(copy)) });
  },
  seed() {
    people = [
      { id: "builder-self", firstName: "Lina", lastName: "Rossi", gender: "F", inTree: true },
      { id: "builder-p1", firstName: "Giovanni", lastName: "Rossi", gender: "M", inTree: true },
      { id: "builder-p2", firstName: "Maria", lastName: "Conti", gender: "F", inTree: true },
      { id: "builder-child", firstName: "Enzo", lastName: "Rossi", gender: "M", inTree: true }
    ];
    families = [];
    loadedPeople = loadedFamilies = true;
    activeId = "builder-self";
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
  },
  seedFamily() {
    this.seed();
    families = [{
      id: "builder-family",
      partnerIds: ["builder-self", "builder-p2"],
      childIds: ["builder-child"],
      relationType: "unknown",
      unionDateInfo: { type: "unknown" },
      endType: "none",
      endDateInfo: { type: "unknown" },
      parentChildLinks: []
    }];
  },
  openRelations() {
    renderRelations();
    openPerson(people.find(person => person.id === activeId), "directory");
    setPersonSection("relations");
  },
  openRelationsBuilder() {
    this.openRelations();
    setRelationBuilderOpen(true, "parent");
  },
  reopenBuilder() { setRelationBuilderOpen(true, "parent"); },
  read() { return readParentBuilderRelationship(); },
  state() {
    return {
      sectionsHidden: document.getElementById("parentUnionSections").hidden,
      endDetailsHidden: document.getElementById("parentEndDetailsFields").hidden,
      nameLinks: [...document.querySelectorAll("#relationsList .person-detail-relative-link")].map(node => node.dataset.openPersonPage),
      strongNames: document.querySelectorAll("#relationsList .family-relation-card .relation-person-copy > strong").length,
      actions: {
        edit: document.querySelectorAll("#relationsList [data-edit-family]").length,
        removePartner: document.querySelectorAll("#relationsList [data-remove-partner]").length,
        removeChild: document.querySelectorAll("#relationsList [data-remove-child]").length
      },
      personViewVisible: !document.getElementById("personDetailView").hidden,
      personTitle: document.getElementById("personPageTitle").textContent,
      familyWrites: JSON.parse(JSON.stringify(this.familyWrites)),
      familyCount: families.length
    };
  },
  selectSecondParent(value) {
    const select = document.getElementById("parent2Select");
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  },
  setEndType(value) {
    const select = document.getElementById("parentEndType");
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
};
`;

async function createPage(browser, server, { stubWrites = false } = {}) {
  const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 1280, height: 900 } });
  const replacements = stubWrites
    ? [
        ["const createdFamily = await addDoc(refs.families,", "const createdFamily = await window.__parentBuilderTest.createFamily("],
        ["await updateDoc(doc(db, \"families\", family.id), {", "await window.__parentBuilderTest.updateFamily(family.id, {"],
        ["await updateDoc(doc(db, \"families\", familyId), data);", "await window.__parentBuilderTest.updateFamily(familyId, data);"]
      ]
    : [];
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      for (const [from, to] of replacements) {
        assert.ok(source.includes(from), `point d'écriture présent : ${from}`);
        source = source.split(from).join(to);
      }
      return route.fulfill({ response, body: `${source}\n${hooks}` });
    }
    return isAllowedRequest(url, server.baseURL) ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__parentBuilderTest === "object");
  return { context, page, errors };
}

test("lot 3 : les sections d'union apparaissent avec un second parent et n'écrasent rien par défaut", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page, errors } = await createPage(browser, server);
    try {
      await page.evaluate(() => {
        window.__parentBuilderTest.seed();
        window.__parentBuilderTest.openRelationsBuilder();
      });
      let state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(state.sectionsHidden, true, "aucune section de couple sans second parent");

      await page.evaluate(() => window.__parentBuilderTest.selectSecondParent("builder-p2"));
      state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(state.sectionsHidden, false, "sections affichées avec un second parent");
      assert.equal(await page.evaluate(() => window.__parentBuilderTest.read()), null, "aucune valeur par défaut à écrire");

      await page.selectOption("#parentUnionRelationType", "marriage");
      await page.locator('#parentUnionSections [data-date-prefix="parentUnion"][data-date-type="year"]').click();
      await page.fill("#parentUnionYear", "1925");
      await page.evaluate(() => window.__parentBuilderTest.setEndType("divorce"));
      state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(state.endDetailsHidden, false, "champs conditionnels de fin affichés pour un divorce");
      const written = await page.evaluate(() => window.__parentBuilderTest.read());
      assert.equal(written.relationType, "marriage");
      assert.deepEqual(written.unionDateInfo, { type: "year", year: 1925 });
      assert.equal(written.endType, "divorce");
      assert.equal("unionPlace" in written, false, "lieu d'union laissé vide non écrit");
      assert.equal("endDateInfo" in written, false, "date de fin non renseignée non écrite");
      assert.equal("endPlace" in written, false);

      await page.evaluate(() => window.__parentBuilderTest.selectSecondParent(""));
      state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(state.sectionsHidden, true, "sections masquées si le second parent est retiré");
      assert.equal(await page.evaluate(() => window.__parentBuilderTest.read()), null, "aucune écriture sans second parent");

      assert.deepEqual(errors, [], "aucune erreur JavaScript");
    } finally { await context.close(); }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("lot 3 : partenaires et enfants deviennent navigables en modification, actions conservées", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page, errors } = await createPage(browser, server);
    try {
      await page.evaluate(() => {
        window.__parentBuilderTest.seedFamily();
        window.__parentBuilderTest.openRelations();
      });
      let state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.ok(state.nameLinks.includes("builder-p2"), "le partenaire porte un lien de navigation");
      assert.ok(state.nameLinks.includes("builder-child"), "l'enfant porte un lien de navigation");
      assert.equal(state.nameLinks.includes("builder-p1"), false, "aucun lien fantôme");
      assert.equal(state.strongNames, 0, "aucun nom laissé en gras seul");
      assert.equal(state.actions.edit, 2, "boutons Modifier conservés (partenaire et enfant)");
      assert.equal(state.actions.removePartner, 1, "bouton Dissocier partenaire conservé");
      assert.equal(state.actions.removeChild, 1, "bouton Dissocier enfant conservé");

      await page.locator('#relationsList [data-open-person-page="builder-child"]').click();
      await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, undefined, { timeout: 5000 });
      state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.match(state.personTitle, /Enzo Rossi/, "la fiche de l'enfant s'ouvre");
      assert.equal(state.personViewVisible, true);
      assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), false, "la modale se referme");

      assert.deepEqual(errors, [], "aucune erreur JavaScript");
    } finally { await context.close(); }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("lot 3 : deux parents avec union renseignée s'enregistrent une fois, sans doublon", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page, errors } = await createPage(browser, server, { stubWrites: true });
    try {
      await page.evaluate(() => {
        window.__parentBuilderTest.seed();
        window.__parentBuilderTest.openRelationsBuilder();
      });
      await page.selectOption("#parentSelect", "builder-p1");
      await page.selectOption("#parent2Select", "builder-p2");
      assert.equal((await page.evaluate(() => window.__parentBuilderTest.state())).sectionsHidden, false, "sections visibles");
      await page.selectOption("#parentUnionRelationType", "marriage");
      await page.locator('#parentUnionSections [data-date-prefix="parentUnion"][data-date-type="year"]').click();
      await page.fill("#parentUnionYear", "1925");
      await page.evaluate(() => window.__parentBuilderTest.setEndType("divorce"));
      await page.click("#addParentBtn");
      await page.waitForFunction(() => window.__parentBuilderTest.state().familyWrites.length === 2, undefined, { timeout: 5000 });

      let state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(state.familyWrites[0].kind, "create", "foyer créé pour les deux parents");
      assert.deepEqual(state.familyWrites[0].data.partnerIds, ["builder-p1", "builder-p2"]);
      assert.deepEqual(state.familyWrites[0].data.childIds, ["builder-self"]);
      const unionWrite = state.familyWrites[1].data;
      assert.equal(unionWrite.relationType, "marriage", "type d'union enregistré");
      assert.deepEqual(unionWrite.unionDateInfo, { type: "year", year: 1925 }, "date d'union enregistrée");
      assert.equal(unionWrite.endType, "divorce", "fin de relation enregistrée");
      assert.equal("unionPlace" in unionWrite, false, "lieu vide non écrit");
      assert.equal("endDateInfo" in unionWrite, false, "date de fin non renseignée non écrite");
      assert.equal("parentChildLinks" in unionWrite, false, "les filiations ne sont pas réécrites par le remplissage d'union");
      assert.equal(state.familyCount, 1, "un seul foyer");
      assert.equal(state.sectionsHidden, true, "sections refermées après l'ajout");
      assert.equal(await page.evaluate(() => window.__parentBuilderTest.read()), null, "formulaire d'union réinitialisé");

      /* Le second parent est conservé après fermeture : la réouverture doit
         réafficher les sections d'union correspondantes. */
      await page.evaluate(() => window.__parentBuilderTest.reopenBuilder());
      state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(state.sectionsHidden, false, "sections réaffichées à la réouverture, le second parent étant conservé");

      /* Seconde tentative identique : le lien existe déjà, aucune écriture. */
      await page.click("#addParentBtn");
      await page.waitForTimeout(600);
      state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(state.familyWrites.length, 2, "aucune écriture supplémentaire pour un lien déjà existant");
      assert.equal(state.familyCount, 1, "aucun foyer dupliqué");

      assert.deepEqual(errors, [], "aucune erreur JavaScript");
    } finally { await context.close(); }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("lot 3 : un parent seul s'ajoute sans aucune écriture d'union", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page, errors } = await createPage(browser, server, { stubWrites: true });
    try {
      await page.evaluate(() => {
        window.__parentBuilderTest.seed();
        window.__parentBuilderTest.openRelationsBuilder();
      });
      await page.selectOption("#parentSelect", "builder-p1");
      const state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(state.sectionsHidden, true, "aucune section de couple pour un parent seul");
      assert.equal(await page.evaluate(() => window.__parentBuilderTest.read()), null, "aucune donnée d'union lue");

      await page.click("#addParentBtn");
      await page.waitForFunction(() => window.__parentBuilderTest.state().familyWrites.length === 1, undefined, { timeout: 5000 });
      const after = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(after.familyWrites.length, 1, "une seule écriture : la création du foyer");
      assert.equal(after.familyWrites[0].kind, "create");
      assert.deepEqual(after.familyWrites[0].data.partnerIds, ["builder-p1"], "foyer monoparental");
      assert.deepEqual(after.familyWrites[0].data.childIds, ["builder-self"]);
      assert.equal(after.familyWrites[0].data.relationType, "unknown");
      assert.deepEqual(after.familyWrites[0].data.unionDateInfo, { type: "unknown" });
      assert.equal(after.familyWrites[0].data.endType, "none");
      assert.equal(after.familyCount, 1, "un seul foyer créé");

      assert.deepEqual(errors, [], "aucune erreur JavaScript");
    } finally { await context.close(); }
  } finally {
    await browser.close();
    await server.close();
  }
});
