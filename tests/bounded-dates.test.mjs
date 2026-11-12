import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

/*
 * Lot « Avant / Après » :
 *  1. enregistrement des bornes depuis la fiche Personne (naissance + décès) ;
 *  2. validation visible quand la borne est absente ;
 *  3. sélecteur de précision : natif sur mobile, boutons sur ordinateur ;
 *  4. attestations inchangées, parcours détaillé équipé du même sélecteur.
 */

const hooks = `
window.__bounded = {
  updates: [],
  trace: [],
  confirms: [],
  seed() {
    people = [
      { id: "bounded-1", firstName: "Ada", lastName: "Rossi", gender: "F", inTree: true, birthDateInfo: { type: "year", year: 1890 }, residences: [{ id: "bounded-residence", place: "Palermo", region: "", country: "", dateInfo: { type: "year", year: 1900 }, attestations: [] }] },
      { id: "bounded-2", firstName: "Carlo", lastName: "Verdi", gender: "M", inTree: true }
    ];
    families = [{ id: "bounded-family", partnerIds: ["bounded-1", "bounded-2"], childIds: [], relationType: "marriage", unionDateInfo: { type: "year", year: 1888 }, endType: "none" }];
    documents = []; tasks = []; procedures = [];
    genealogyRecords = { sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [], genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [] };
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = loadedProcedures = true;
    genealogyLoaded = true;
    currentUserProfile = { role: "admin", displayName: "Test" };
    activeDataUid = "bounded-uid";
    showAuthPanel("app");
    $("topbar").hidden = false;
    setView("directory");
  },
  openPersonForm(id) {
    personFormSaving = false;
    setButtonPending($("savePersonBtn"), false);
    openPerson(people.find(p => p.id === id), "directory");
  },
  openPersonPageForm(id) {
    personPageInlineEditing = false;
    activePersonPageItem = null;
    openPersonPage(people.find(p => p.id === id), { kind: "view", view: "directory" });
  },
  openFamilyForm() { openFamilyDetails("bounded-family"); },
  precision(kind) {
    const control = document.querySelector('#personForm [data-date-control="' + kind + '"]');
    if (!control) return null;
    const select = control.querySelector(".date-type-select");
    const switcher = control.querySelector(".date-type-switch");
    const wrap = control.querySelector(".date-type-select-wrap");
    const panel = control.querySelector('.date-value-panel:not([hidden])');
    return {
      dataset: control.dataset.dateType,
      selectValue: select ? select.value : null,
      options: select ? [...select.options].map(o => o.value) : [],
      optionLabels: select ? [...select.options].map(o => o.textContent) : [],
      selectVisible: Boolean(wrap && wrap.getBoundingClientRect().height > 0),
      switchVisible: Boolean(switcher && switcher.getBoundingClientRect().height > 0),
      selectBox: wrap ? { w: Math.round(wrap.getBoundingClientRect().width), h: Math.round(select.getBoundingClientRect().height) } : null,
      controlBox: { w: Math.round(control.getBoundingClientRect().width) },
      panelVisible: Boolean(panel),
      panelId: panel ? panel.dataset.datePanel : null
    };
  },
  reset() {
    window.__bounded.updates = [];
    window.__bounded.trace = [];
    const message = document.getElementById("toastMessage");
    if (message) message.textContent = "";
  },
  snapshot() {
    const form = $("personForm");
    return {
      updates: window.__bounded.updates,
      trace: window.__bounded.trace,
      toast: document.getElementById("toastMessage")?.textContent || "",
      toastVisible: $("toast").classList.contains("show"),
      personDialogOpen: $("personDialog").open,
      saving: personFormSaving,
      saveLabel: $("savePersonBtn").textContent,
      fieldErrors: [...form.querySelectorAll(".field-error")].map(e => ({ id: e.id, text: e.textContent, visible: e.getBoundingClientRect().height > 0 })),
      invalid: [...form.querySelectorAll(":invalid")].map(e => e.id)
    };
  }
};
$("personForm").addEventListener("submit", () => { window.__bounded.trace.push("submit-event"); });
{
  window.confirm = msg => { window.__bounded.confirms.push(String(msg).slice(0, 160)); return true; };
}
`;

async function launch(viewport) {
  const browser = await chromium.launch({ headless: true });
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR", viewport, isMobile: viewport.width <= 760, hasTouch: viewport.width <= 760, reducedMotion: "reduce" });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      return route.fetch().then(async response => {
        const original = await response.text();
        const update = 'await updateDoc(doc(db, "people", id), data);';
        const familyUpdate = "await withButtonPending(submitButton, () => updateDoc(doc(db, \"families\", familyId), data));";
        let source = original;
        if (source.includes(update)) source = source.split(update).join("await window.__bounded.record(id, data);");
        if (source.includes(familyUpdate)) source = source.split(familyUpdate).join("await window.__bounded.recordFamily(familyId, data);");
        return route.fulfill({ response, body: `${source}\n${hooks}\nwindow.__bounded.record = (id, data) => { window.__bounded.updates.push({ kind: "person", id, birthDateInfo: data.birthDateInfo, deathDateInfo: data.deathDateInfo }); const current = people.find(p => p.id === id); if (current) { if (data.birthDateInfo !== undefined) current.birthDateInfo = data.birthDateInfo; if (data.deathDateInfo !== undefined) current.deathDateInfo = data.deathDateInfo; } };\nwindow.__bounded.recordFamily = (id, data) => { window.__bounded.updates.push({ kind: "family", id, unionDateInfo: data.unionDateInfo, endDateInfo: data.endDateInfo }); const current = families.find(f => f.id === id); if (current) { if (data.unionDateInfo !== undefined) current.unionDateInfo = data.unionDateInfo; if (data.endDateInfo !== undefined) current.endDateInfo = data.endDateInfo; } };\n` });
      }).catch(() => {});
    }
    return isAllowedRequest(url, server.baseURL) ? route.continue().catch(() => {}) : route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push((e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
  page.on("dialog", async d => { await d.accept(); });
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__bounded === "object");
  await page.evaluate(() => window.__bounded.seed());
  return {
    page,
    errors,
    async close() { await context.close().catch(() => {}); await browser.close().catch(() => {}); await server.close().catch(() => {}); }
  };
}

async function setPrecision(page, kind, type) {
  await page.locator(`#personForm [data-date-prefix="${kind}"][data-date-type="${type}"]`).evaluate(b => b.click());
}

async function fillBound(page, kind, type, { year, date }) {
  const target = year !== undefined ? `#${kind}${type}Year` : `#${kind}${type}Date`;
  const value = year !== undefined ? String(year) : String(date ?? "");
  await page.locator(target).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  const readBack = await page.inputValue(target);
  assert.equal(readBack, value, `valeur conservée après saisie sur ${target}`);
}

async function save(page) {
  await page.evaluate(() => window.__bounded.reset());
  const preClick = await page.evaluate(() => ({
    type: document.querySelector('#personForm [data-date-control="birth"]')?.dataset.dateType,
    year: document.getElementById("birthafterYear")?.value,
    date: document.getElementById("birthafterDate")?.value,
    beforeYear: document.getElementById("birthbeforeYear")?.value
  }));
  await page.locator("#savePersonBtn").evaluate(b => b.click());
  await page.waitForFunction(
    () => window.__bounded.updates.length > 0
      || !document.getElementById("personDialog").open
      || [...document.querySelectorAll("#personForm .field-error")].some(e => e.textContent && e.getBoundingClientRect().height > 0)
      || Boolean(document.getElementById("toastMessage")?.textContent),
    null,
    { timeout: 6000 }
  ).catch(() => {});
  await page.waitForTimeout(300);
  const snapshot = await page.evaluate(() => window.__bounded.snapshot());
  return { ...snapshot, preClick };
}

test("enregistrement des bornes Avant/Après (naissance et décès)", async t => {
  const session = await launch({ width: 1280, height: 900 });
  if (!session) return;
  try {
    const { page } = session;
    const cases = [
      { label: "Avant 1850 (année) — naissance", kind: "birth", type: "before", bound: { year: 1850 }, expected: { type: "before", year: 1850 } },
      { label: "Après 1850 (année) — naissance", kind: "birth", type: "after", bound: { year: 1850 }, expected: { type: "after", year: 1850 } },
      { label: "Avant le 12 juin 1850 — naissance", kind: "birth", type: "before", bound: { date: "1850-06-12" }, expected: { type: "before", value: "1850-06-12" } },
      { label: "Après le 12 juin 1850 — naissance", kind: "birth", type: "after", bound: { date: "1850-06-12" }, expected: { type: "after", value: "1850-06-12" } },
      { label: "Avant 1930 (année) — décès", kind: "death", type: "before", bound: { year: 1930 }, expected: { type: "before", year: 1930 } },
      { label: "Après le 12 juin 1930 — décès", kind: "death", type: "after", bound: { date: "1930-06-12" }, expected: { type: "after", value: "1930-06-12" } }
    ];

    for (const c of cases) {
      await page.evaluate(() => window.__bounded.openPersonForm("bounded-1"));
      await page.waitForFunction(() => document.getElementById("personDialog").open);
      await setPrecision(page, c.kind, c.type);
      await fillBound(page, c.kind, c.type, c.bound);
      const fieldId = `#${c.kind}${c.type}${c.bound.year !== undefined ? "Year" : "Date"}`;
      const filled = await page.inputValue(fieldId).catch(() => "<absent>");
      const res = await save(page);
      assert.equal(String(filled), String(c.bound.year ?? c.bound.date), `${c.label} : valeur présente dans le formulaire avant enregistrement`);

      assert.equal(res.updates.length, 1, `${c.label} : une écriture partie — ${JSON.stringify({ preClick: res.preClick, trace: res.trace, toast: res.toast, errors: res.fieldErrors, label: res.saveLabel, open: res.personDialogOpen })}`);
      const saved = res.updates[0][`${c.kind}DateInfo`];
      assert.deepEqual(saved, c.expected, `${c.label} : payload conservé sans conversion`);
      assert.equal(res.trace.includes("submit-event"), true, `${c.label} : l'événement d'enregistrement est bien émis`);
      assert.equal(res.personDialogOpen, false, `${c.label} : la fiche se ferme après enregistrement`);
      assert.equal(res.saving, false, `${c.label} : le bouton revient à l'état nominal`);
      assert.match(res.toast, /mise à jour/i, `${c.label} : message de succès visible`);
      assert.deepEqual(res.fieldErrors.filter(error => error.visible && error.text), [], `${c.label} : aucune erreur de champ visible`);
    }

    // Réouverture : la dernière valeur enregistrée (après, date précise) restitue le type et la précision.
    await page.evaluate(() => window.__bounded.openPersonForm("bounded-1"));
    await page.waitForFunction(() => document.getElementById("personDialog").open);
    const reopened = await page.evaluate(() => window.__bounded.precision("death"));
    assert.equal(reopened.dataset, "after", "réouverture : type après conservé");
    assert.equal(reopened.selectValue, "after", "réouverture : sélecteur cohérent");
    const deathDate = await page.inputValue("#deathafterDate");
    assert.equal(deathDate, "1930-06-12", "réouverture : date précise restituée sans conversion en année");
    const deathYear = await page.inputValue("#deathafterYear");
    assert.equal(deathYear, "", "réouverture : aucun mélange année/date");

    // Le type historique « Vers » reste fonctionnel (non régression).
    await setPrecision(page, "birth", "about");
    await page.locator("#birthYear").fill("1849");
    const aboutRes = await save(page);
    assert.deepEqual(aboutRes.updates[0].birthDateInfo, { type: "about", year: 1849 }, " Vers (à propos) toujours enregistrable");

    assert.deepEqual(session.errors, [], `aucune erreur JS : ${session.errors.join(" || ")}`);
  } finally {
    await session.close();
  }
});

test("borne absente : erreur visible sur le champ et aucune écriture", async t => {
  const session = await launch({ width: 1280, height: 900 });
  if (!session) return;
  try {
    const { page } = session;
    await page.evaluate(() => window.__bounded.openPersonForm("bounded-1"));
    await page.waitForFunction(() => document.getElementById("personDialog").open);
    await setPrecision(page, "birth", "before");
    const res = await save(page);

    assert.equal(res.updates.length, 0, "aucune écriture sans borne");
    assert.equal(res.trace.includes("submit-event"), false, "form-ui bloque l'enregistrement avant le gestionnaire de la fiche");
    assert.ok(res.fieldErrors.length >= 1, `un message de champ s'affiche (${JSON.stringify(res.fieldErrors)})`);
    const error = res.fieldErrors[0];
    assert.equal(error.visible, true, "le message est rattaché à un champ visible (pas au panneau Entre masqué)");
    assert.match(error.text, /Avant/, "le message nomme la borne attendue");
    assert.equal(res.personDialogOpen, true, "la fiche reste ouverte pour correction");
    assert.deepEqual(session.errors, [], `aucune erreur JS : ${session.errors.join(" || ")}`);
  } finally {
    await session.close();
  }
});

test("sélecteur de précision : natif sur mobile, boutons sur ordinateur", async t => {
  for (const width of [320, 375, 390]) {
    const session = await launch({ width, height: 844 });
    if (!session) return;
    try {
      const { page } = session;
      await page.evaluate(() => window.__bounded.openPersonForm("bounded-1"));
      await page.waitForFunction(() => document.getElementById("personDialog").open);
      await setPrecision(page, "birth", "before");

      const precision = await page.evaluate(() => window.__bounded.precision("birth"));
      assert.equal(precision.selectVisible, true, `${width}px : sélecteur natif visible`);
      assert.equal(precision.switchVisible, false, `${width}px : rangée de boutons masquée`);
      assert.deepEqual(precision.options, ["exact", "year", "about", "before", "after", "between", "unknown"], `${width}px : sept précisions disponibles`);
      assert.equal(precision.selectValue, "before", `${width}px : valeur sélectionnée lisible`);
      assert.equal(precision.dataset, "before", `${width}px : le modèle de données suit le sélecteur`);
      assert.equal(precision.panelVisible, true, `${width}px : champ conditionnel Avant affiché`);
      assert.equal(precision.panelId, "birth-before", `${width}px : bon panneau conditionnel`);
      assert.ok(precision.selectBox.w >= precision.controlBox.w - 2, `${width}px : sélecteur pleine largeur (${precision.selectBox.w}/${precision.controlBox.w})`);
      assert.ok(precision.selectBox.h >= 44, `${width}px : cible tactile ≥ 44 px (${precision.selectBox.h})`);

      // changement de précision par le sélecteur natif
      await page.locator('#personForm [data-date-control="birth"] .date-type-select').selectOption("between");
      const afterChange = await page.evaluate(() => window.__bounded.precision("birth"));
      assert.equal(afterChange.dataset, "between", `${width}px : le sélecteur pilote le modèle`);
      assert.equal(afterChange.panelId, "birth-between", `${width}px : panneau Entre affiché`);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${width}px : aucun débordement horizontal`);

      // saisie + enregistrement depuis le sélecteur mobile
      await page.locator('#personForm [data-date-control="birth"] .date-type-select').selectOption("before");
      await page.locator("#birthbeforeYear").fill("1855");
      const res = await save(page);
      assert.deepEqual(res.updates[0].birthDateInfo, { type: "before", year: 1855 }, `${width}px : enregistrement depuis le sélecteur mobile`);
      assert.deepEqual(session.errors, [], `${width}px : aucune erreur JS (${session.errors.join(" || ")})`);
    } finally {
      await session.close();
    }
  }

  const desktop = await launch({ width: 1280, height: 900 });
  if (!desktop) return;
  try {
    const { page } = desktop;
    await page.evaluate(() => window.__bounded.openPersonForm("bounded-1"));
    await page.waitForFunction(() => document.getElementById("personDialog").open);
    await setPrecision(page, "birth", "exact");
    const precision = await page.evaluate(() => window.__bounded.precision("birth"));
    assert.equal(precision.switchVisible, true, "ordinateur : rangée de boutons conservée");
    assert.equal(precision.selectVisible, false, "ordinateur : sélecteur natif masqué");
    assert.deepEqual(desktop.errors, [], `ordinateur : aucune erreur JS (${desktop.errors.join(" || ")})`);
  } finally {
    await desktop.close();
  }
});

test("union et parcours détaillé : même sélecteur ; attestations inchangées", async t => {
  const session = await launch({ width: 390, height: 844 });
  if (!session) return;
  try {
    const { page } = session;

    // Union : sélecteur natif présent et opérationnel
    await page.evaluate(() => window.__bounded.openFamilyForm());
    await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open);
    const union = await page.evaluate(() => {
      const control = document.querySelector('#familyDetailsDialog [data-date-control="union"]');
      const select = control?.querySelector(".date-type-select");
      return { hasSelect: Boolean(select), options: select ? [...select.options].map(o => o.value) : [], switchVisible: Boolean(control?.querySelector(".date-type-switch")?.getBoundingClientRect().height) };
    });
    assert.equal(union.hasSelect, true, "union : sélecteur natif présent");
    assert.deepEqual(union.options, ["exact", "year", "about", "before", "after", "between", "unknown"], "union : sept précisions");
    assert.equal(union.switchVisible, false, "union : boutons masqués sur mobile");
    await page.locator('#familyDetailsDialog [data-date-control="union"] .date-type-select').selectOption("before");
    await page.locator("#unionbeforeYear").fill("1885");
    await page.evaluate(() => window.__bounded.reset());
    await page.locator('#familyDetailsForm button[type="submit"]').evaluate(b => b.click());
    await page.waitForTimeout(600);
    const familySave = await page.evaluate(() => window.__bounded.snapshot());
    assert.equal(familySave.updates.length, 1, "union : une écriture famille partie");
    assert.deepEqual(familySave.updates[0].unionDateInfo, { type: "before", year: 1885 }, "union : borne avant enregistrée");
    await page.locator('#familyDetailsForm [data-close="familyDetailsDialog"]').evaluate(b => b.click());

    // Résidence (parcours détaillé) : sélecteur natif présent
    await page.evaluate(() => window.__bounded.openPersonPageForm("bounded-1"));
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    await page.locator("#personPageEditBtn").click();
    await page.waitForSelector('#personPageDetailedJourney [data-journey-add="residence"]');
    await page.locator('#personPageDetailedJourney [data-journey-add="residence"]').click();
    await page.waitForSelector("#journeyPlace");
    const journey = await page.evaluate(() => {
      const container = document.querySelector("#personPageDetailedJourney [data-journey-form] [data-journey-date]");
      const select = container?.querySelector(".date-type-select");
      return { hasSelect: Boolean(select), options: select ? [...select.options].map(o => o.value) : [], switchHidden: container ? getComputedStyle(container.querySelector(".date-type-switch")).display === "none" : null };
    });
    assert.equal(journey.hasSelect, true, "résidence : sélecteur natif présent");
    assert.ok(journey.options.includes("exact") && journey.options.includes("unknown"), "résidence : options conservées");
    assert.equal(journey.switchHidden, true, "résidence : boutons masqués sur mobile");

    // Attestation : sélecteur à boutons conservé, sans sélecteur natif
    await page.locator("#personPageDetailedJourney [data-journey-attestation-add]").first().click();
    await page.waitForSelector("[data-journey-attestation-save]");
    const attestation = await page.evaluate(() => {
      const save = document.querySelector("[data-journey-attestation-save]");
      const form = save?.closest("[data-journey-form]");
      const container = form?.querySelector("[data-journey-date]");
      if (!container) return null;
      return { hasSelect: Boolean(container.querySelector(".date-type-select")), switchDisplay: getComputedStyle(container.querySelector(".date-type-switch")).display, buttons: container.querySelectorAll("[data-journey-date-type]").length };
    });
    assert.ok(attestation, "formulaire d'attestation ouvert");
    assert.equal(attestation.hasSelect, false, "attestation : aucun sélecteur natif ajouté");
    assert.notEqual(attestation.switchDisplay, "none", "attestation : boutons conservés visibles");
    assert.equal(attestation.buttons, 5, "attestation : ses options inchangées");

    assert.deepEqual(session.errors, [], `aucune erreur JS : ${session.errors.join(" || ")}`);
  } finally {
    await session.close();
  }
});
