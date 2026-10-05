import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const root = new URL("../", import.meta.url);
const [html, app, pickerModule] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8"),
  readFile(new URL("js/person-multiselect.js", root), "utf8")
]);

test("Documents : sélecteur partagé, associations existantes et stockage personIds préservés", () => {
  const dialogStart = html.indexOf('<dialog class="modal-lg modal-mobile-sheet modal-mobile-sheet--long-form" id="documentDialog"');
  const dialog = html.slice(dialogStart, html.indexOf("</dialog>", dialogStart));
  assert.match(dialog, /<h4>Personnes éventuellement liées<\/h4><p>Facultatif : un document peut concerner aucune, une ou plusieurs personnes de l’arbre\.<\/p>/);
  assert.match(dialog, /id="documentPeopleList" data-multiselect-people/);
  assert.match(dialog, /id="documentPeopleInput" type="text" role="combobox" aria-expanded="false" aria-controls="documentPeopleResults" aria-autocomplete="list"/);
  assert.match(dialog, /id="documentPeopleChips"/);
  assert.match(dialog, /id="documentPeopleResults" role="listbox"/);
  assert.ok(dialog.indexOf("documentPeopleList") < dialog.indexOf('id="documentNotes"'), "Notes reste après le sélecteur");
  assert.doesNotMatch(dialog, /id="documentPeople"|type="checkbox"/);
  assert.match(app, /const documentPeoplePicker = createAppPersonPicker\("document"\);/);
  assert.match(app, /documentPeoplePicker\.setSelected\(item\?\.personIds \|\| \(preselectedPersonId \? \[preselectedPersonId\] : \[\]\)\);/);
  assert.match(app, /personIds: documentPeoplePicker\.getSelected\(\),/);
  assert.match(app, /kind === "document"[\s\S]*?\(\) => people\.slice\(\)\.sort\(comparePeopleBySurname\)/);
  assert.match(pickerModule, /selectedIds = new Set\(ids\);/);
  assert.match(pickerModule, /getSelected: \(\) => \[\.\.\.selectedIds\]/);
});

test("le composant partagé recherche, ajoute, retire, conserve les identifiants et reste responsive", async t => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    t.skip("Chromium Playwright indisponible");
    return;
  }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR" });
  await context.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(server.baseURL) || url.includes("gstatic.com")
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForSelector("#documentPeopleInput", { state: "attached" });
    await page.evaluate(async () => {
      document.getElementById("authScreen").hidden = true;
      document.getElementById("topbar").hidden = true;
      document.getElementById("appMain").hidden = true;
      const root = document.createElement("div");
      root.id = "documentPickerHarness";
      root.className = "person-multiselect";
      root.style.width = "100%";
      root.innerHTML = '<div class="person-multiselect-chips" id="pickerHarnessChips"></div><input class="field" id="pickerHarnessInput" type="text" role="combobox" aria-expanded="false" aria-controls="pickerHarnessResults" aria-autocomplete="list" placeholder="Rechercher une personne…"><div class="person-multiselect-results" id="pickerHarnessResults" role="listbox" hidden></div>';
      document.body.append(root);
      const { createPersonMultiSelect } = await import("./js/person-multiselect.js");
      const entries = [
        { id: "p-marie", firstName: "Marie", lastName: "Martin", marriedName: "Rossi", branch: "Nord" },
        { id: "p-marc", firstName: "Marc", lastName: "Moreau", branch: "Sud" },
        { id: "p-mario", firstName: "Mario", lastName: "Rossi", branch: "Nord" },
        { id: "p-other", firstName: "Lucia", lastName: "Conti", branch: "Est" }
      ];
      const normalize = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      window.__documentPickerTest = createPersonMultiSelect({
        kind: "document",
        root,
        input: root.querySelector("#pickerHarnessInput"),
        chips: root.querySelector("#pickerHarnessChips"),
        results: root.querySelector("#pickerHarnessResults"),
        minQueryLength: 2,
        findMatches: (query, selected) => entries.filter(item => !selected.has(item.id) && normalize(`${item.firstName} ${item.lastName} ${item.marriedName || ""} ${item.branch}`).includes(normalize(query))),
        suggestionFor: item => ({ label: `${item.firstName} ${item.lastName}`, context: item.branch ? `Branche ${item.branch}` : "" }),
        nameFor: id => entries.find(item => item.id === id) ? `${entries.find(item => item.id === id).firstName} ${entries.find(item => item.id === id).lastName}` : "Personne supprimée",
        escapeHtml: value => { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
      });
      window.__documentPickerTest.setSelected(["p-marie", "legacy-person"]);
    });

    const input = page.locator("#pickerHarnessInput");
    await input.fill("mart");
    assert.equal(await page.locator("#pickerHarnessResults [role=option]").count(), 0, "une association déjà présente ne revient pas dans les résultats");
    await input.fill("mar");
    assert.equal(await page.locator("#pickerHarnessResults [role=option]").count(), 2, "la recherche élargie trouve les personnes pertinentes hors sélection existante");
    await page.locator('[data-add-document-person="p-marc"]').click();
    await input.fill("rossi");
    assert.equal(await page.locator("#pickerHarnessResults [role=option]").count(), 1, "une personne déjà sélectionnée n’est pas proposée deux fois");
    await page.locator('[data-add-document-person="p-mario"]').click();
    assert.deepEqual(await page.evaluate(() => window.__documentPickerTest.getSelected()), ["p-marie", "legacy-person", "p-marc", "p-mario"]);
    assert.equal(await page.locator("#pickerHarnessChips .person-multiselect-chip").count(), 4, "les associations existantes et les nouvelles sont visibles");
    await page.locator('[data-remove-document-person="p-marc"]').click();
    assert.deepEqual(await page.evaluate(() => window.__documentPickerTest.getSelected()), ["p-marie", "legacy-person", "p-mario"], "retrait sans perte des autres identifiants");
    assert.match(await page.locator("#pickerHarnessChips").textContent(), /Personne supprimée/, "un identifiant historique non résolu reste visible");

    await input.fill("ma");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.__documentPickerTest.getSelected()), ["p-marie", "legacy-person", "p-mario", "p-marc"], "ajout clavier sans doublon");
    await input.fill("zz");
    assert.equal(await page.locator("#pickerHarnessResults").evaluate(node => node.hidden), true, "état sans résultat identique au sélecteur Démarches");
    await input.fill("conti");
    assert.equal(await page.locator("#pickerHarnessResults [role=option]").count(), 1);

    for (const width of [320, 390, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      const geometry = await page.evaluate(() => {
        const root = document.getElementById("documentPickerHarness").getBoundingClientRect();
        const inputBox = document.getElementById("pickerHarnessInput").getBoundingClientRect();
        const chips = document.getElementById("pickerHarnessChips").getBoundingClientRect();
        const result = document.querySelector("#pickerHarnessResults [role=option]").getBoundingClientRect();
        const remove = document.querySelector("#pickerHarnessChips .person-multiselect-chip-remove").getBoundingClientRect();
        return { width: document.documentElement.clientWidth, rootLeft: root.left, rootRight: root.right, inputLeft: inputBox.left, inputRight: inputBox.right, chipsRight: chips.right, resultHeight: result.height, removeWidth: remove.width, removeHeight: remove.height, scrollWidth: document.documentElement.scrollWidth };
      });
      assert.ok(geometry.inputLeft >= geometry.rootLeft - 1 && geometry.inputRight <= geometry.rootRight + 1, `${width}px : champ dans la largeur du sélecteur`);
      assert.ok(geometry.chipsRight <= geometry.rootRight + 1, `${width}px : sélection lisible sans débordement horizontal`);
      assert.ok(geometry.resultHeight >= 44, `${width}px : résultat assez grand pour être touché`);
      assert.ok(geometry.removeWidth >= 24 && geometry.removeHeight >= 24, `${width}px : bouton de retrait accessible dans la puce`);
      assert.ok(geometry.scrollWidth <= geometry.width + 1, `${width}px : aucun overflow horizontal`);
    }
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
