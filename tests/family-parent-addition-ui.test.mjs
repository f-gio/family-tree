import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const source = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const start = source.indexOf("async function addSecondParentToCurrentFamily()");
/* Fin de fonction : le dépôt est converti en CRLF à la sortie Git sur Windows,
   la recherche accepte les deux fins de ligne sans modifier l'assertion. */
const relativeEnd = start >= 0 ? source.slice(start).search(/\r?\n\}\r?\n/) : -1;
const end = relativeEnd >= 0 ? start + relativeEnd : -1;
assert.ok(start >= 0 && end > start, "parcours d'ajout du second parent repéré");
const block = source.slice(start, end);
assert.ok(block.includes("await batch.commit();"), "batch familial présent");

const hooks = `
window.__secondParentTest = {
  seed() {
    people = [
      { id: "mere", firstName: "Maria", lastName: "Conti", gender: "F", inTree: true },
      { id: "pere", firstName: "Giovanni", lastName: "Rossi", gender: "M", inTree: true },
      { id: "enfant-a", firstName: "Lina", lastName: "Rossi", gender: "F", inTree: true },
      { id: "enfant-b", firstName: "Enzo", lastName: "Rossi", gender: "M", inTree: true }
    ];
    families = [{
      id: "foyer-source",
      partnerIds: ["mere"],
      childIds: ["enfant-a", "enfant-b"],
      relationType: "unknown",
      unionDateInfo: { type: "unknown" },
      endType: "none",
      endDateInfo: { type: "unknown" },
      parentChildLinks: [
        { parentId: "mere", childId: "enfant-a", type: "adoptive" },
        { parentId: "mere", childId: "enfant-b", type: "biological" }
      ]
    }];
    documents = [];
    genealogyRecords = { sourceDocuments: [], genealogyProofs: [], factConclusions: [] };
    loadedPeople = loadedFamilies = loadedDocuments = true;
    genealogyLoaded = true;
    activeId = "enfant-a";
    document.getElementById("personId").value = "enfant-a";
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
  },
  open() { openFamilyDetails("foyer-source"); },
  apply(plan, targetRef) {
    families = families.map(family => family.id === plan.sourceFamilyId
      ? { ...family, ...plan.sourceUpdate }
      : plan.targetFamilyId && family.id === plan.targetFamilyId
        ? { ...family, ...plan.familyUpdate }
        : family);
    if (!plan.targetFamilyId) families.push({ id: targetRef.id, ...plan.createFamily });
  },
  state() {
    return {
      sections: [...document.querySelectorAll("#filiationEditors .filiation-editor")].map(row => row.innerText.replace(/\\s+/g, " ").trim()),
      addSectionHidden: document.getElementById("addSecondParentSection").hidden,
      selectOptions: [...document.getElementById("addSecondParentSelect").options].map(option => option.value),
      addDisabled: document.getElementById("addSecondParentBtn").disabled,
      dialogOpen: document.getElementById("familyDetailsDialog").open,
      families: JSON.parse(JSON.stringify(families)),
      peopleIds: people.map(person => person.id).sort()
    };
  }
};
`;

test("ajout d'un second parent depuis Modifier les parents ne rattache aucun autre enfant", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium Playwright indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 390, height: 844 } });
    const errors = [];
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (new URL(url).pathname.endsWith("/js/app.js")) {
        const response = await route.fetch();
        let app = await response.text();
        const patched = app.slice(start, end).replace("await batch.commit();", "await window.__secondParentTest.apply(plan, createdTargetRef);");
        app = app.slice(0, start) + patched + app.slice(end);
        return route.fulfill({ response, body: `${app}\n${hooks}` });
      }
      return isAllowedRequest(url, server.baseURL) ? route.continue().catch(() => {})
        : route.abort("blockedbyclient").catch(() => {});
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(server.baseURL, { waitUntil: "load" });
      await page.waitForFunction(() => typeof window.__secondParentTest === "object");
      await page.evaluate(() => { window.__secondParentTest.seed(); window.__secondParentTest.open(); });
      await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open);
      let state = await page.evaluate(() => window.__secondParentTest.state());
      assert.equal(state.addSectionHidden, false, "zone d'ajout visible avec un parent enregistré");
      assert.equal(state.sections.length, 1, "carte du parent existant conservée");
      assert.match(state.sections[0], /Maria Conti/);
      assert.match(state.sections[0], /Mère/);
      assert.deepEqual(state.selectOptions.slice(0, 1), [""], "le sélecteur conserve son placeholder");
      assert.equal(state.addDisabled, true, "ajout facultatif désactivé avant sélection");

      await page.selectOption("#addSecondParentSelect", "pere");
      assert.equal(await page.locator("#addSecondParentBtn").isDisabled(), false, "ajout activé après sélection");
      await page.selectOption("#addSecondParentFiliationType", "biological");
      await page.selectOption("#familyRelationType", "civil");
      await page.locator('#familyDetailsDialog [data-date-prefix="union"][data-date-type="year"]').click();
      await page.fill("#unionYear", "1925");
      await page.locator('#addParentUnionAttestationControl [data-pending-relation-attestation-add]').click();
      await page.waitForSelector("#personAttestationDialog[open]");
      await page.locator('#personAttestationDialog [data-journey-date-type="unknown"]').click();
      await page.fill("#journeyAttComment", "Acte ajout seconde parenté");
      await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
      await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open);
      await page.locator("#addSecondParentBtn").click();
      await page.waitForFunction(() => !document.getElementById("familyDetailsDialog").open, undefined, { timeout: 5000 });

      state = await page.evaluate(() => window.__secondParentTest.state());
      const sourceFamily = state.families.find(family => family.id === "foyer-source");
      const coupleFamily = state.families.find(family => family.id !== "foyer-source");
      assert.deepEqual(sourceFamily.childIds, ["enfant-b"], "l'autre enfant reste uniquement avec le parent existant");
      assert.deepEqual(sourceFamily.partnerIds, ["mere"], "le foyer monoparental d'origine est conservé");
      assert.ok(coupleFamily, "nouveau foyer créé pour l'enfant explicitement choisi");
      assert.deepEqual(coupleFamily.partnerIds, ["mere", "pere"]);
      assert.deepEqual(coupleFamily.childIds, ["enfant-a"], "aucun autre enfant n'est rattaché automatiquement");
      assert.equal(coupleFamily.relationType, "civil");
      assert.deepEqual(coupleFamily.unionDateInfo, { type: "year", year: 1925 });
      assert.equal(coupleFamily.marriageAttestations.length, 1, "attestation préparée attachée au foyer parent ajouté");
      assert.equal(coupleFamily.marriageAttestations[0].comment, "Acte ajout seconde parenté");
      assert.deepEqual(coupleFamily.parentChildLinks.map(link => `${link.parentId}:${link.childId}:${link.type}`), ["mere:enfant-a:adoptive", "pere:enfant-a:biological"]);
      assert.deepEqual(state.peopleIds, ["enfant-a", "enfant-b", "mere", "pere"], "aucune fiche personne supprimée");
      assert.deepEqual(errors, [], "aucune erreur JavaScript");
    } finally { await context.close(); }
  } finally {
    await browser.close();
    await server.close();
  }
});
