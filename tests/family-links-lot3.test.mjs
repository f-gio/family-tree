import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { AUTH_BOOTSTRAP_PATCH, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";
import { parentChildLinkType } from "../js/family-relations.js";

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
  assert.match(app, /await linkChildToParents\(activeId, parentIds, "", linkTypes, relationData \|\| \{\}\)/, "famille et détails enregistrés ensemble");
  assert.match(app, /if \(relationType !== "unknown"\) data\.relationType = relationType/);
  assert.match(app, /if \(endType !== "none"\) data\.endType = endType/);
  assert.match(app, /if \(unionDateInfo\?\.type && unionDateInfo\.type !== "unknown"\) data\.unionDateInfo = unionDateInfo/);
  assert.match(app, /if \(endDateInfo\?\.type && endDateInfo\.type !== "unknown"\) data\.endDateInfo = endDateInfo/);
  assert.match(app, /if \(!definition \|\| \$\(definition\.sections\)\?\.hidden\) return null/, "aucune écriture sans second parent");
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
  partnerWrites: [],
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
  createPartnerBatch() {
    const owner = this;
    const operations = [];
    return {
      set(ref, data) { operations.push({ kind: "create", id: ref.id, data }); return this; },
      update(ref, data) { operations.push({ kind: "update", id: ref.id, data }); return this; },
      async commit() {
        for (const operation of operations) {
          const data = { ...operation.data };
          delete data.createdAt;
          delete data.updatedAt;
          if (operation.kind === "create") families.push({ id: operation.id, ...data });
          else families = families.map(family => family.id === operation.id ? { ...family, ...data } : family);
          owner.partnerWrites.push({ kind: operation.kind, id: operation.id, data: JSON.parse(JSON.stringify(data)) });
        }
      }
    };
  },
  seed() {
    people = [
      { id: "builder-self", firstName: "Lina", lastName: "Rossi", gender: "F", inTree: true },
      { id: "builder-p1", firstName: "Giovanni", lastName: "Rossi", gender: "M", inTree: true },
      { id: "builder-p2", firstName: "Maria", lastName: "Conti", gender: "F", inTree: true },
      { id: "builder-child", firstName: "Enzo", lastName: "Rossi", gender: "M", inTree: true }
    ];
    families = [];
    documents = [{ id: "builder-doc", title: "Acte familial", type: "Acte", personIds: ["builder-self"] }];
    genealogyRecords = {
      sourceDocuments: [{ id: "builder-source", data: { id: "builder-source", title: "Registre communal", personIds: ["builder-self"] } }],
      genealogyProofs: [{ id: "builder-proof", data: { id: "builder-proof", factType: "marriage", personIds: ["builder-self"] } }],
      factConclusions: []
    };
    genealogyLoaded = true;
    genealogyLoaded = true;
    pendingRelationAttestations.parent = [];
    pendingRelationAttestations.partner = [];
    pendingRelationAttestations.addParent = [];
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
  seedSingleParentFamily() {
    this.seed();
    families = [{
      id: "builder-single-family",
      partnerIds: ["builder-self"],
      childIds: ["builder-child"],
      relationType: "unknown",
      unionDateInfo: { type: "unknown" },
      endType: "none",
      endDateInfo: { type: "unknown" },
      marriageAttestations: [{ id: "existing-union-attestation", date: { type: "year", year: 1920 }, comment: "Attestation existante" }],
      parentChildLinks: [{ parentId: "builder-self", childId: "builder-child", type: "adoptive" }]
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
  selectKind(kind) { setRelationBuilderKind(kind); },
  reopenBuilder() { setRelationBuilderOpen(true, "parent"); },
  openCreatedUnion() {
    activeId = "builder-p1";
    document.getElementById("personId").value = "builder-p1";
    openFamilyDetails("builder-family");
  },
  read() { return readParentBuilderRelationship(); },
  state() {
    return {
      sectionsHidden: document.getElementById("parentUnionSections").hidden,
      partnerSectionsHidden: document.getElementById("partnerUnionSections").hidden,
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
      families: JSON.parse(JSON.stringify(families)),
      familyWrites: JSON.parse(JSON.stringify(this.familyWrites)),
      partnerWrites: JSON.parse(JSON.stringify(this.partnerWrites)),
      familyCount: families.length,
      pendingParentAttestations: JSON.parse(JSON.stringify(pendingRelationAttestations.parent)),
      pendingPartnerAttestations: JSON.parse(JSON.stringify(pendingRelationAttestations.partner))
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

async function createPage(browser, server, { stubWrites = false, stubPartnerWrites = false } = {}) {
  const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 1280, height: 900 } });
  const replacements = stubWrites
      ? [
        ["const createdFamily = await addDoc(refs.families,", "const createdFamily = await window.__parentBuilderTest.createFamily("],
        ["await updateDoc(doc(db, \"families\", family.id), {", "await window.__parentBuilderTest.updateFamily(family.id, {"]
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
      if (stubPartnerWrites) {
        const start = source.indexOf("async function addPartner()");
        const end = source.indexOf("async function addChild()", start);
        assert.ok(start >= 0 && end > start, "parcours d'ajout du partenaire présent");
        const block = source.slice(start, end);
        assert.ok(block.includes("const batch = writeBatch(db);"), "batch partenaire remplaçable");
        source = source.slice(0, start) + block.replace("const batch = writeBatch(db);", "const batch = window.__parentBuilderTest.createPartnerBatch();") + source.slice(end);
      }
      return route.fulfill({ response, body: `${source}\n${AUTH_BOOTSTRAP_PATCH}\n${hooks}` });
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
      const parentDesktop = await page.evaluate(() => {
        const row = document.querySelector("#parentUnionSections .relation-union-date-row");
        const date = row.querySelector(".genealogy-date").getBoundingClientRect();
        const cta = row.querySelector("#parentUnionAttestationControl").getBoundingClientRect();
        const style = getComputedStyle(row);
        return {
          display: style.display,
          columns: style.gridTemplateColumns,
          dateRight: Math.round(date.right),
          ctaLeft: Math.round(cta.left),
          ctaBottom: Math.round(cta.bottom),
          dateBottom: Math.round(date.bottom),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      assert.equal(parentDesktop.display, "grid", "desktop : la ligne date du formulaire Parent est une grille");
      assert.ok(parentDesktop.columns.split(" ").length >= 2, "desktop : date et CTA sur deux colonnes");
      assert.ok(parentDesktop.ctaLeft >= parentDesktop.dateRight - 1, "desktop : le CTA est à droite du champ Date");
      assert.ok(Math.abs(parentDesktop.ctaBottom - parentDesktop.dateBottom) <= 2, "desktop : le CTA partage la ligne du champ Date");
      assert.equal(parentDesktop.overflow, 0, "desktop : aucun débordement horizontal");
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

      await page.locator('#parentUnionAttestationControl [data-pending-relation-attestation-add]').click();
      await page.waitForSelector("#personAttestationDialog[open]");
      await page.fill("#journeyAttComment", "Acte familial préparé");
      await page.locator("#personAttestationDialog [data-journey-documents-toggle]").click();
      await page.locator('[data-journey-document-pick="builder-doc"]').click();
      await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
      await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open);
      let pending = (await page.evaluate(() => window.__parentBuilderTest.state())).pendingParentAttestations;
      assert.equal(pending.length, 1, "attestation préparée sans écriture Firestore");

      await page.locator('#parentUnionAttestationControl [data-pending-relation-attestation-add]').click();
      await page.waitForSelector("#personAttestationDialog[open]");
      await page.fill("#journeyAttComment", "Attestation à retirer");
      await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
      await page.waitForFunction(() => window.__parentBuilderTest.state().pendingParentAttestations.length === 2);
      pending = (await page.evaluate(() => window.__parentBuilderTest.state())).pendingParentAttestations;
      page.once("dialog", async dialog => { await dialog.accept(); });
      await page.locator(`[data-pending-relation-attestation-remove="${pending[1].id}"]`).click();
      await page.waitForFunction(() => window.__parentBuilderTest.state().pendingParentAttestations.length === 1);

      pending = (await page.evaluate(() => window.__parentBuilderTest.state())).pendingParentAttestations;
      await page.locator(`[data-pending-relation-attestation-edit="${pending[0].id}"]`).click();
      await page.waitForSelector("#personAttestationDialog[open]");
      await page.fill("#journeyAttComment", "Acte familial corrigé");
      await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
      await page.waitForFunction(() => window.__parentBuilderTest.state().pendingParentAttestations[0]?.comment === "Acte familial corrigé");

      await page.click("#addParentBtn");
      await page.waitForFunction(() => window.__parentBuilderTest.state().familyWrites.length === 1, undefined, { timeout: 5000 });

      let state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(state.familyWrites[0].kind, "create", "foyer créé pour les deux parents");
      assert.deepEqual(state.familyWrites[0].data.partnerIds, ["builder-p1", "builder-p2"]);
      assert.deepEqual(state.familyWrites[0].data.childIds, ["builder-self"]);
      const unionWrite = state.familyWrites[0].data;
      assert.equal(unionWrite.relationType, "marriage", "type d'union enregistré");
      assert.deepEqual(unionWrite.unionDateInfo, { type: "year", year: 1925 }, "date d'union enregistrée");
      assert.equal(unionWrite.endType, "divorce", "fin de relation enregistrée");
      assert.equal(unionWrite.marriageAttestations.length, 1, "une attestation préparée associée au foyer créé");
      assert.equal(unionWrite.marriageAttestations[0].comment, "Acte familial corrigé", "modification préparée conservée");
      assert.deepEqual(unionWrite.marriageAttestations[0].documentIds, ["builder-doc"]);
      assert.deepEqual(unionWrite.marriageAttestations[0].sourceIds, [], "aucune sélection de source dans le nouveau formulaire");
      assert.deepEqual(unionWrite.marriageAttestations[0].proofIds, [], "aucune pré-sélection de preuve dans le nouveau formulaire");
      assert.equal(unionWrite.unionPlace, "", "lieu vide conservé à sa valeur neutre");
      assert.deepEqual(unionWrite.endDateInfo, { type: "unknown" }, "date de fin non renseignée reste inconnue");
      assert.deepEqual(unionWrite.parentChildLinks.map(link => link.type), ["unknown", "unknown"], "les filiations sélectionnées sont conservées à la création");
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
      assert.equal(state.familyWrites.length, 1, "aucune écriture supplémentaire pour un lien déjà existant");
      assert.equal(state.familyCount, 1, "aucun foyer dupliqué");

      await page.evaluate(() => window.__parentBuilderTest.openCreatedUnion());
      await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open);
      assert.match(await page.locator("#familyDetailsTitle").innerText(), /Union avec Maria Conti/, "réouverture de la même union");
      assert.equal(await page.locator("#familyMarriageAttestationList .life-attestation").count(), 1, "attestation conservée sur l'identifiant de famille créé");
      assert.match(await page.locator("#familyMarriageAttestationList").innerText(), /Acte familial corrigé/);

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

      await page.evaluate(() => window.__parentBuilderTest.reopenBuilder());
      await page.selectOption("#parent2Select", "builder-p2");
      await page.locator('#parentUnionAttestationControl [data-pending-relation-attestation-add]').click();
      await page.waitForSelector("#personAttestationDialog[open]");
      await page.fill("#journeyAttComment", "Préparée puis annulée");
      await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
      await page.waitForFunction(() => window.__parentBuilderTest.state().pendingParentAttestations.length === 1);
      await page.locator("#closeRelationBuilderBtn").click();
      const cancelled = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(cancelled.pendingParentAttestations.length, 0, "annulation du parcours élimine le brouillon local");
      assert.equal(cancelled.familyWrites.length, 1, "aucune attestation ou relation orpheline écrite");

      assert.deepEqual(errors, [], "aucune erreur JavaScript");
    } finally { await context.close(); }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("correction finale : création d'un partenaire enregistre union, fin et attestation préparée sur le foyer", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page, errors } = await createPage(browser, server, { stubPartnerWrites: true });
    try {
      await page.evaluate(() => {
        window.__parentBuilderTest.seed();
        window.__parentBuilderTest.openRelationsBuilder();
        window.__parentBuilderTest.selectKind("partner");
      });
      await page.selectOption("#partnerSelect", "builder-p1");
      assert.equal((await page.evaluate(() => window.__parentBuilderTest.state())).partnerSectionsHidden, false, "sections Union visibles après sélection du partenaire");
      assert.equal(await page.locator("#partnerUnionSections").isVisible(), true, "Union et fin de relation visibles après sélection");
      for (const [width, height] of [[320, 700], [375, 812], [390, 844]]) {
        await page.setViewportSize({ width, height });
        const layout = await page.evaluate(() => {
          const row = document.querySelector("#partnerUnionSections .relation-union-date-row");
          const date = row.querySelector('[data-date-panel="partnerUnion-exact"]').getBoundingClientRect();
          const control = row.querySelector("#partnerUnionAttestationControl").getBoundingClientRect();
          const switcher = row.querySelector(".date-type-switch");
          const buttons = [...switcher.querySelectorAll(".date-type-button")];
          const tops = buttons.map(button => button.getBoundingClientRect().top);
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            dateBottom: date.bottom,
            ctaTop: control.top,
            ctaRight: control.right,
            sameRow: tops.every(top => Math.abs(top - tops[0]) < 1),
            wrap: getComputedStyle(switcher).flexWrap
          };
        });
        assert.equal(layout.overflow, 0, `${width}px : création Partenaire sans débordement`);
        assert.equal(layout.sameRow, true, `${width}px : sélecteur de précision sur une seule ligne`);
        assert.equal(layout.wrap, "nowrap", `${width}px : la rangée date défile au besoin`);
        assert.ok(layout.ctaTop >= layout.dateBottom - 1, `${width}px : CTA attestation sous le champ Date`);
        assert.ok(layout.ctaRight <= width + 1, `${width}px : CTA attestation entièrement visible`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.selectOption("#partnerUnionRelationType", "civil");
      await page.locator('#partnerUnionSections [data-date-prefix="partnerUnion"][data-date-type="year"]').click();
      await page.fill("#partnerUnionYear", "1930");
      const endType = page.locator("#partnerEndType");
      await endType.selectOption("separation");
      await page.locator('#partnerEndDetailsFields [data-date-prefix="partnerEnd"][data-date-type="between"]').click();
      await page.fill("#partnerEndYearFrom", "1940");
      await page.fill("#partnerEndYearTo", "1942");

      await page.locator('#partnerUnionAttestationControl [data-pending-relation-attestation-add]').click();
      await page.waitForSelector("#personAttestationDialog[open]");
      await page.fill("#journeyAttComment", "Acte d’union préparé");
      await page.locator("#personAttestationDialog [data-journey-documents-toggle]").click();
      await page.locator('[data-journey-document-pick="builder-doc"]').click();
      await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
      await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open);
      const prepared = await page.evaluate(() => window.__parentBuilderTest.state().pendingPartnerAttestations);
      assert.equal(prepared.length, 1, "attestation gardée en mémoire jusqu'à l'ajout du partenaire");
      assert.deepEqual(prepared[0].documentIds, ["builder-doc"]);
      assert.deepEqual(prepared[0].sourceIds, [], "aucune sélection de source dans le nouveau formulaire");
      assert.deepEqual(prepared[0].proofIds, [], "aucune pré-sélection de preuve dans le nouveau formulaire");

      const partnerDesktop = await page.evaluate(() => {
        const row = document.querySelector("#partnerUnionSections .relation-union-date-row");
        const date = row.querySelector(".genealogy-date").getBoundingClientRect();
        const cta = row.querySelector("#partnerUnionAttestationControl .life-attestation-add").getBoundingClientRect();
        const list = row.querySelector("#partnerUnionAttestationList").getBoundingClientRect();
        return {
          display: getComputedStyle(row).display,
          dateRight: Math.round(date.right),
          ctaLeft: Math.round(cta.left),
          ctaBottom: Math.round(cta.bottom),
          dateBottom: Math.round(date.bottom),
          listTop: Math.round(list.top),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      assert.equal(partnerDesktop.display, "grid", "desktop : la ligne date du formulaire Partenaire est une grille");
      assert.ok(partnerDesktop.ctaLeft >= partnerDesktop.dateRight - 1, "desktop : le CTA est à droite du champ Date");
      assert.ok(partnerDesktop.ctaBottom <= partnerDesktop.dateBottom + 1, "desktop : le CTA partage la ligne du champ Date");
      assert.ok(partnerDesktop.listTop >= partnerDesktop.dateBottom - 1, "desktop : les attestations préparées restent sous l'union");
      assert.equal(partnerDesktop.overflow, 0, "desktop : aucun débordement horizontal");

      await page.click("#addPartnerBtn");
      await page.waitForFunction(() => window.__parentBuilderTest.state().partnerWrites.length === 1, undefined, { timeout: 5000 });
      const state = await page.evaluate(() => window.__parentBuilderTest.state());
      const family = state.families.find(value => state.partnerWrites[0].id === value.id);
      assert.deepEqual(family.partnerIds, ["builder-self", "builder-p1"]);
      assert.deepEqual(family.unionDateInfo, { type: "year", year: 1930 });
      assert.equal(family.relationType, "civil");
      assert.equal(family.endType, "separation");
      assert.deepEqual(family.endDateInfo, { type: "between", from: 1940, to: 1942 });
      assert.equal(family.marriageAttestations.length, 1);
      assert.equal(family.marriageAttestations[0].comment, "Acte d’union préparé");
      assert.deepEqual(family.marriageAttestations[0].documentIds, ["builder-doc"]);
      assert.deepEqual(family.marriageAttestations[0].sourceIds, [], "aucune sélection de source dans le nouveau formulaire");
      assert.deepEqual(family.marriageAttestations[0].proofIds, [], "aucune pré-sélection de preuve dans le nouveau formulaire");
      assert.deepEqual(errors, [], "aucune erreur JavaScript");
    } finally { await context.close(); }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("ajout d'un partenaire à un foyer monoparental conserve les enfants et attestations déjà associés", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page, errors } = await createPage(browser, server, { stubPartnerWrites: true });
    try {
      await page.evaluate(() => {
        window.__parentBuilderTest.seedSingleParentFamily();
        window.__parentBuilderTest.openRelationsBuilder();
        window.__parentBuilderTest.selectKind("partner");
      });
      await page.selectOption("#partnerSelect", "builder-p1");
      await page.selectOption("#partnerUnionRelationType", "civil");
      await page.locator('#partnerUnionSections [data-date-prefix="partnerUnion"][data-date-type="year"]').click();
      await page.fill("#partnerUnionYear", "1930");
      await page.locator('#partnerUnionAttestationControl [data-pending-relation-attestation-add]').click();
      await page.waitForSelector("#personAttestationDialog[open]");
      await page.fill("#journeyAttComment", "Seconde attestation");
      await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
      await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open);
      await page.click("#addPartnerBtn");
      await page.waitForFunction(() => window.__parentBuilderTest.state().partnerWrites.length === 1, undefined, { timeout: 5000 });

      const state = await page.evaluate(() => window.__parentBuilderTest.state());
      assert.equal(state.familyCount, 1, "le foyer monoparental est complété, pas dupliqué");
      const family = state.families.find(value => value.id === "builder-single-family");
      assert.deepEqual(family.partnerIds, ["builder-self", "builder-p1"]);
      assert.deepEqual(family.childIds, ["builder-child"], "enfant existant conservé");
      assert.equal(parentChildLinkType(family, "builder-self", "builder-child"), "adoptive", "type de filiation existant conservé");
      assert.equal(parentChildLinkType(family, "builder-p1", "builder-child"), "unknown", "aucun type nouveau inventé");
      assert.deepEqual(family.unionDateInfo, { type: "year", year: 1930 });
      assert.equal(family.relationType, "civil");
      assert.equal(family.marriageAttestations.length, 2, "attestation préparée ajoutée sans doublonner l'existante");
      assert.notEqual(family.marriageAttestations[1].id, "existing-union-attestation");
      assert.equal(family.marriageAttestations[0].comment, "Attestation existante", "attestation existante conservée");
      assert.equal(family.marriageAttestations[1].comment, "Seconde attestation");
      assert.deepEqual(errors, [], "aucune erreur JavaScript");
    } finally { await context.close(); }
  } finally {
    await browser.close();
    await server.close();
  }
});
