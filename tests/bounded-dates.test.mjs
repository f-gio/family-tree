import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { AUTH_BOOTSTRAP_PATCH, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

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
    documents = []; tasks = [];
    genealogyRecords = { sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [], genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [] };
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
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
  openFamilyForm() { activeId = "bounded-1"; openFamilyDetails("bounded-family"); },
  familyState() { return { activeId, personId: $("personId").value, familyIds: families.map(family => family.id), journeyEditor, dialogOpen: $("familyDetailsDialog").open, title: $("familyDetailsTitle").textContent }; },
  openRelationBuilder(kind) {
    if ($("familyDetailsDialog").open) {
      /* Neutralise le retour « Relation → Personne » : sinon le handler de
         fermeture réouvrirait la fiche et refermerait le constructeur. */
      familyDetailsReturnContext = null;
      $("familyDetailsDialog").close();
    }
    if ($("personDialog").open) $("personDialog").close();
    personFormSaving = false;
    setButtonPending($("savePersonBtn"), false);
    activeId = "bounded-1";
    openPerson(people.find(p => p.id === "bounded-1"), "directory");
    setPersonSection("relations");
    setRelationBuilderOpen(true, kind);
    const select = kind === "parent" ? $("parent2Select") : $("partnerSelect");
    select.value = "bounded-2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  },
  closeRelationBuilder() { setRelationBuilderOpen(false); },
  pendingCount(kind) { return (pendingRelationAttestations[kind] || []).length; },
  builderState(kind) {
    const root = kind === "parent" ? "#parentUnionSections" : "#partnerUnionSections";
    const sections = document.querySelector(root);
    const sw = sections?.querySelector(".date-type-switch");
    const buttons = sw ? [...sw.querySelectorAll(".date-type-button")] : [];
    const tops = buttons.map(button => Math.round(button.getBoundingClientRect().top));
    const cta = sections?.querySelector(".major-event-attestation-control .life-attestation-add");
    const date = sections?.querySelector(".genealogy-date");
    const dateRect = date ? date.getBoundingClientRect() : null;
    const ctaRect = cta ? cta.getBoundingClientRect() : null;
    if (sw) { sw.scrollLeft = sw.scrollWidth; }
    const last = buttons.at(-1);
    const lastRect = last ? last.getBoundingClientRect() : null;
    const swRect = sw ? sw.getBoundingClientRect() : null;
    return {
      rootHidden: sections ? sections.hidden : null,
      oldHintPresent: Boolean(document.querySelector('[data-relation-add-panel="partner"] p.hint')),
      types: buttons.map(button => button.dataset.dateType),
      oneRow: tops.length > 1 && tops.every(top => Math.abs(top - tops[0]) < 1),
      wrap: sw ? getComputedStyle(sw).flexWrap : null,
      overflowX: sw ? getComputedStyle(sw).overflowX : null,
      switchScroll: sw ? sw.scrollWidth : 0,
      switchClient: sw ? sw.clientWidth : 0,
      lastOptionReachable: Boolean(lastRect && swRect && lastRect.left >= swRect.left - 1 && lastRect.right <= swRect.right + 1),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ctaBelowDate: Boolean(ctaRect && dateRect) ? ctaRect.top >= dateRect.bottom - 1 : null,
      ctaVisible: Boolean(ctaRect && ctaRect.width > 0 && ctaRect.height > 0)
    };
  },
  precision(kind) {
    const control = document.querySelector('#personForm [data-date-control="' + kind + '"]');
    if (!control) return null;
    const switcher = control.querySelector(".date-type-switch");
    const buttons = switcher ? [...switcher.querySelectorAll(".date-type-button")] : [];
    const active = switcher ? switcher.querySelector(".date-type-button.active") : null;
    const panel = control.querySelector('.date-value-panel:not([hidden])');
    const strip = value => String(value || "").replace(/^"|"$/g, "");
    return {
      dataset: control.dataset.dateType,
      active: active ? active.dataset.dateType : null,
      types: buttons.map(button => button.dataset.dateType),
      labels: buttons.map(button => strip(getComputedStyle(button, "::after").content)),
      widths: buttons.map(button => Math.round(button.getBoundingClientRect().width)),
      switchVisible: Boolean(switcher && switcher.getBoundingClientRect().height > 0),
      switchScrollsInside: switcher ? switcher.scrollWidth > switcher.clientWidth + 1 : null,
      switchOverflow: switcher ? Math.max(0, switcher.scrollWidth - switcher.clientWidth) : null,
      switchBox: switcher ? { w: Math.round(switcher.getBoundingClientRect().width), h: Math.round(switcher.getBoundingClientRect().height) } : null,
      hasSelect: Boolean(control.querySelector(".date-type-select")),
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
        return route.fulfill({ response, body: `${source}\n${AUTH_BOOTSTRAP_PATCH}\n${hooks}\nwindow.__bounded.record = (id, data) => { window.__bounded.updates.push({ kind: "person", id, birthDateInfo: data.birthDateInfo, deathDateInfo: data.deathDateInfo }); const current = people.find(p => p.id === id); if (current) { if (data.birthDateInfo !== undefined) current.birthDateInfo = data.birthDateInfo; if (data.deathDateInfo !== undefined) current.deathDateInfo = data.deathDateInfo; } };\nwindow.__bounded.recordFamily = (id, data) => { window.__bounded.updates.push({ kind: "family", id, unionDateInfo: data.unionDateInfo, endDateInfo: data.endDateInfo }); const current = families.find(f => f.id === id); if (current) { if (data.unionDateInfo !== undefined) current.unionDateInfo = data.unionDateInfo; if (data.endDateInfo !== undefined) current.endDateInfo = data.endDateInfo; } };\n` });
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

/* Saisie déterministe (Playwright .fill() a montré des pertes de valeur
   sporadiques sur ces champs numériques) : pose la valeur et déclenche les
   mêmes événements qu'une frappe. */
async function fillField(page, selector, value) {
  await page.locator(selector).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(value));
  const readBack = await page.inputValue(selector);
  assert.equal(readBack, String(value), `valeur conservée après saisie sur ${selector}`);
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
    assert.equal(reopened.active, "after", "réouverture : bouton actif cohérent");
    const deathDate = await page.inputValue("#deathafterDate");
    assert.equal(deathDate, "1930-06-12", "réouverture : date précise restituée sans conversion en année");
    const deathYear = await page.inputValue("#deathafterYear");
    assert.equal(deathYear, "", "réouverture : aucun mélange année/date");

    // Le type historique « Vers » reste fonctionnel (non régression).
    await setPrecision(page, "birth", "about");
    await fillField(page, "#birthYear", 1849);
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

test("sélecteur horizontal de précision sur mobile, inchangé sur ordinateur", async t => {
  for (const width of [320, 375, 390]) {
    const session = await launch({ width, height: 844 });
    if (!session) return;
    try {
      const { page } = session;
      await page.evaluate(() => window.__bounded.openPersonForm("bounded-1"));
      await page.waitForFunction(() => document.getElementById("personDialog").open);
      await setPrecision(page, "birth", "before");

      const precision = await page.evaluate(() => window.__bounded.precision("birth"));
      assert.equal(precision.hasSelect, false, `${width}px : aucun sélecteur natif (retour au composant d'origine)`);
      assert.equal(precision.switchVisible, true, `${width}px : rangée de boutons visible`);
      assert.deepEqual(precision.types, ["exact", "year", "about", "before", "after", "between", "unknown"], `${width}px : sept précisions dans l'ordre demandé`);
      assert.deepEqual(precision.labels, ["Précise", "Année", "Vers", "Avant", "Après", "Entre", "Inconnue"], `${width}px : libellés visibles (dont Avant et Après)`);
      assert.deepEqual(precision.active, "before", `${width}px : sélection indiquée`);
      assert.ok(precision.widths.every(w => w > 0 && w >= 44), `${width}px : cibles tactiles ≥ 44 px (${precision.widths.join(",")})`);
      assert.equal(precision.panelVisible, true, `${width}px : champ conditionnel Avant affiché`);
      assert.equal(precision.panelId, "birth-before", `${width}px : bon panneau conditionnel`);
      /* La rangée défile en elle-même : aucun débordement de la page. */
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${width}px : aucun débordement horizontal de la page`);

      // changement de précision par les boutons
      await page.locator('#personForm [data-date-prefix="birth"][data-date-type="between"]').evaluate(b => b.click());
      const afterChange = await page.evaluate(() => window.__bounded.precision("birth"));
      assert.equal(afterChange.dataset, "between", `${width}px : les boutons pilotent le modèle`);
      assert.equal(afterChange.panelId, "birth-between", `${width}px : panneau Entre affiché`);
      assert.equal(afterChange.active, "between", `${width}px : sélection visuelle mise à jour`);

      // saisie + enregistrement sur mobile
      await setPrecision(page, "birth", "before");
      await fillField(page, "#birthbeforeYear", 1855);
      const res = await save(page);
      assert.deepEqual(res.updates[0].birthDateInfo, { type: "before", year: 1855 }, `${width}px : enregistrement depuis le sélecteur mobile`);

      /* Disposition avec « Inconnue » : colonne unique, Lieu dessous.
         (La fiche se referme après l'enregistrement : on la rouvre.) */
      await page.evaluate(() => window.__bounded.openPersonForm("bounded-1"));
      await page.waitForFunction(() => document.getElementById("personDialog").open);
      await setPrecision(page, "birth", "unknown");
      const unknownLayout = await page.evaluate(() => {
        const control = document.querySelector('#personForm [data-date-control="birth"]');
        const group = control.closest(".event-information-group");
        const lieu = group.querySelector(".life-place");
        const cta = group.querySelector(".major-event-attestation-control .btn") || group.querySelector(".major-event-attestation-control");
        const columns = getComputedStyle(group).gridTemplateColumns.split(" ").length;
        const rect = el => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x) }; };
        return { columns, switchX: rect(control.querySelector(".date-type-switch")).x, lieuX: rect(lieu).x, lieuW: rect(lieu).w, cta: cta ? rect(cta) : null, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      assert.equal(unknownLayout.columns, 1, `${width}px : « Inconnue » garde une colonne unique (${unknownLayout.columns})`);
      assert.equal(unknownLayout.lieuX, unknownLayout.switchX, `${width}px : Lieu aligné sous le sélecteur, pas à droite`);
      assert.ok(unknownLayout.cta === null || unknownLayout.cta.w > 120 || unknownLayout.cta.w === 0, `${width}px : bouton d'attestation non comprimé (${JSON.stringify(unknownLayout.cta)})`);
      assert.ok(unknownLayout.pageOverflow <= 1, `${width}px : aucun débordement avec « Inconnue »`);
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
    assert.equal(precision.hasSelect, false, "ordinateur : aucun sélecteur natif");
    assert.equal(precision.switchScrollsInside, false, "ordinateur : les sept boutons tiennent sans défilement");
    assert.deepEqual(desktop.errors, [], `ordinateur : aucune erreur JS (${desktop.errors.join(" || ")})`);
  } finally {
    await desktop.close();
  }
});

test("union et parcours détaillé : même rangée de boutons ; attestations inchangées", async t => {
  const session = await launch({ width: 390, height: 844 });
  if (!session) return;
  try {
    const { page } = session;

    // Union : rangée de boutons identique, Avant fonctionnel
    await page.evaluate(() => window.__bounded.openFamilyForm());
    await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open);
    const union = await page.evaluate(() => {
      const control = document.querySelector('#familyDetailsDialog [data-date-control="union"]');
      const switcher = control?.querySelector(".date-type-switch");
      const buttons = switcher ? [...switcher.querySelectorAll(".date-type-button")] : [];
      const strip = value => String(value || "").replace(/^"|"$/g, "");
      return {
        switchVisible: Boolean(switcher && switcher.getBoundingClientRect().height > 0),
        types: buttons.map(button => button.dataset.dateType),
        labels: buttons.map(button => strip(getComputedStyle(button, "::after").content)),
        active: buttons.filter(button => button.classList.contains("active")).map(button => button.dataset.dateType),
        hasSelect: Boolean(control?.querySelector(".date-type-select"))
      };
    });
    assert.equal(union.switchVisible, true, "union : rangée de boutons visible sur mobile");
    assert.deepEqual(union.types, ["exact", "year", "about", "before", "after", "between", "unknown"], "union : sept précisions");
    assert.deepEqual(union.labels, ["Précise", "Année", "Vers", "Avant", "Après", "Entre", "Inconnue"], "union : libellés lisibles");
    assert.equal(union.hasSelect, false, "union : aucun sélecteur natif");
    await page.locator('#familyDetailsDialog [data-date-prefix="union"][data-date-type="before"]').evaluate(b => b.click());
    await fillField(page, "#unionbeforeYear", 1885);
    await page.evaluate(() => window.__bounded.reset());
    await page.locator('#familyDetailsForm button[type="submit"]').evaluate(b => b.click());
    await page.waitForTimeout(600);
    const familySave = await page.evaluate(() => window.__bounded.snapshot());
    assert.equal(familySave.updates.length, 1, "union : une écriture famille partie");
    assert.deepEqual(familySave.updates[0].unionDateInfo, { type: "before", year: 1885 }, "union : borne avant enregistrée");
    await page.locator('#familyDetailsForm [data-close="familyDetailsDialog"]').evaluate(b => b.click());

    // Résidence (parcours détaillé) : même rangée de boutons
    await page.evaluate(() => window.__bounded.openPersonPageForm("bounded-1"));
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    await page.locator("#personPageEditBtn").click();
    await page.waitForSelector('#personPageDetailedJourney [data-journey-add="residence"]');
    await page.locator('#personPageDetailedJourney [data-journey-add="residence"]').click();
    await page.waitForSelector("#journeyPlace");
    const journey = await page.evaluate(() => {
      const container = document.querySelector("#personJourneyEntryDialog [data-journey-form] [data-journey-date]");
      const switcher = container?.querySelector(".date-type-switch");
      const buttons = switcher ? [...switcher.querySelectorAll("[data-journey-date-type]")] : [];
      const strip = value => String(value || "").replace(/^"|"$/g, "");
      return {
        switchVisible: Boolean(switcher && switcher.getBoundingClientRect().height > 0),
        buttons: buttons.map(button => button.dataset.journeyDateType),
        labels: buttons.map(button => strip(getComputedStyle(button, "::after").content)),
        hasSelect: Boolean(container?.querySelector(".date-type-select"))
      };
    });
    assert.equal(journey.switchVisible, true, "résidence : rangée de boutons visible sur mobile");
    assert.deepEqual(journey.buttons, ["exact", "year", "about", "between", "unknown"], "résidence : options d'origine pour une nouvelle entrée");
    assert.deepEqual(journey.labels, ["Date précise", "Année", "Vers", "Entre", "Inconnue"], "résidence : libellés visibles");
    assert.equal(journey.hasSelect, false, "résidence : aucun sélecteur natif");

    // Attestation : sélecteur inchangé
    await page.locator("#personJourneyEntryDialog [data-journey-cancel]").click();
    await page.waitForFunction(() => !document.getElementById("personJourneyEntryDialog").open);
    await page.locator("#personPageDetailedJourney [data-journey-attestation-add]").first().click();
    await page.waitForSelector("#personAttestationDialog[open]");
    await page.waitForSelector("[data-journey-attestation-save]");
    const attestation = await page.evaluate(() => {
      const form = document.querySelector("#personAttestationDialog [data-journey-form]");
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

test("sélecteurs familiaux mobiles : sept options sur une seule rangée défilable", async t => {
  for (const width of [320, 375, 390]) {
    const session = await launch({ width, height: 844 });
    if (!session) return;
    try {
      const { page } = session;
      await page.evaluate(() => window.__bounded.openFamilyForm());
      await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open);
      const initial = await page.evaluate(() => {
        const switcher = document.querySelector('#familyDetailsDialog [data-date-control="union"] .date-type-switch');
        const buttons = [...(switcher?.querySelectorAll(".date-type-button") || [])];
        const rects = buttons.map(button => button.getBoundingClientRect());
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          flexWrap: switcher && getComputedStyle(switcher).flexWrap,
          overflowX: switcher && getComputedStyle(switcher).overflowX,
          types: buttons.map(button => button.dataset.dateType),
          sameRow: rects.every(rect => Math.abs(rect.top - rects[0]?.top) < 1),
          scrollWidth: switcher?.scrollWidth || 0,
          clientWidth: switcher?.clientWidth || 0,
          buttons: rects.map(rect => ({ left: rect.left, right: rect.right, height: rect.height })),
          dateInputType: document.querySelector('#familyDetailsDialog [data-date-panel="union-exact"] input')?.type
        };
      });
      assert.deepEqual(initial.types, ["exact", "year", "about", "before", "after", "between", "unknown"], `${width}px : sept options présentes`);
      assert.equal(initial.flexWrap, "nowrap", `${width}px : aucun retour à la ligne`);
      assert.equal(initial.overflowX, "auto", `${width}px : défilement tactile horizontal`);
      assert.equal(initial.sameRow, true, `${width}px : toutes les options sur une seule rangée`);
      assert.equal(initial.pageOverflow, 0, `${width}px : la page ne déborde pas horizontalement`);
      assert.ok(initial.buttons.every(button => button.height >= 44), `${width}px : cibles tactiles suffisantes`);
      assert.equal(initial.dateInputType, "date", `${width}px : calendrier natif conservé`);

      const last = await page.evaluate(() => {
        const switcher = document.querySelector('#familyDetailsDialog [data-date-control="union"] .date-type-switch');
        switcher.scrollLeft = switcher.scrollWidth;
        const option = switcher.querySelector('[data-date-type="unknown"]');
        const box = option.getBoundingClientRect();
        const container = switcher.getBoundingClientRect();
        return { visible: box.left >= container.left - 1 && box.right <= container.right + 1, scroll: switcher.scrollLeft };
      });
      assert.ok(last.scroll > 0 || initial.scrollWidth <= initial.clientWidth, `${width}px : geste horizontal possible si la rangée dépasse`);
      assert.equal(last.visible, true, `${width}px : l’option Inconnue est accessible après défilement`);

      await page.locator('#familyDetailsDialog [data-date-prefix="union"][data-date-type="between"]').evaluate(button => button.click());
      assert.equal(await page.locator('#familyDetailsDialog [data-date-panel="union-between"]').isVisible(), true, `${width}px : la sélection affiche le bon panneau`);
      await page.selectOption("#familyEndType", "divorce");
      const end = await page.evaluate(() => {
        const control = document.querySelector('#familyDetailsDialog [data-date-control="end"]');
        const switcher = control?.querySelector(".date-type-switch");
        const buttons = [...(switcher?.querySelectorAll(".date-type-button") || [])];
        const tops = buttons.map(button => button.getBoundingClientRect().top);
        return {
          count: buttons.length,
          types: buttons.map(button => button.dataset.dateType),
          oneRow: tops.every(top => Math.abs(top - tops[0]) < 1),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scrollable: getComputedStyle(switcher).overflowX
        };
      });
      assert.deepEqual(end.types, ["exact", "year", "about", "before", "after", "between", "unknown"], `${width}px : sept précisions de fin`);
      assert.equal(end.oneRow, true, `${width}px : options de fin sur une ligne`);
      assert.equal(end.scrollable, "auto", `${width}px : défilement horizontal de fin`);
      assert.equal(end.overflow, 0, `${width}px : le sélecteur de fin ne déborde pas la page`);
      await page.locator('#familyDetailsDialog [data-date-prefix="end"][data-date-type="between"]').evaluate(button => button.click());
      assert.equal(await page.locator('#familyDetailsDialog [data-date-panel="end-between"]').isVisible(), true, `${width}px : précision Entre de fin sélectionnable`);
      assert.deepEqual(session.errors, [], `${width}px : aucune erreur JS`);
    } finally { await session.close(); }
  }
});

test("Safari WebKit mobile : modale familiale à la hauteur Personne et options défilables sans retour", async t => {
  let browser;
  try { browser = await webkit.launch({ headless: true }); }
  catch (error) { t.skip(`WebKit Playwright indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      return route.fetch().then(async response => {
        let source = await response.text();
        const update = 'await updateDoc(doc(db, "people", id), data);';
        const familyUpdate = "await withButtonPending(submitButton, () => updateDoc(doc(db, \"families\", familyId), data));";
        source = source.split(update).join("await window.__bounded.record(id, data);");
        source = source.split(familyUpdate).join("await window.__bounded.recordFamily(familyId, data);");
        return route.fulfill({ response, body: `${source}\n${AUTH_BOOTSTRAP_PATCH}\n${hooks}\nwindow.__bounded.record = () => {}; window.__bounded.recordFamily = () => {};` });
      }).catch(() => {});
    }
    return isAllowedRequest(url, server.baseURL) ? route.continue().catch(() => {}) : route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__bounded === "object");
    await page.evaluate(() => window.__bounded.seed());
    await page.evaluate(() => window.__bounded.openPersonForm("bounded-1"));
    await page.waitForFunction(() => document.getElementById("personDialog").open);
    const personHeight = await page.locator("#personDialog").evaluate(dialog => dialog.getBoundingClientRect().height);
    await page.locator('#personDialog [data-close="personDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("personDialog").open);

    await page.evaluate(() => window.__bounded.seed());
    await page.evaluate(() => window.__bounded.openFamilyForm());
    await page.waitForTimeout(300);
    const familyState = await page.evaluate(() => window.__bounded.familyState());
    assert.equal(familyState.dialogOpen, true, `la modale familiale s'ouvre sur WebKit (${JSON.stringify(familyState)}; ${errors.join(" | ")})`);
    const state = await page.evaluate(() => {
      const dialog = document.getElementById("familyDetailsDialog");
      const strip = dialog.querySelector('[data-date-control="union"] .date-type-switch');
      const buttons = [...strip.querySelectorAll(".date-type-button")];
      return {
        dialog: dialog.getBoundingClientRect().height,
        viewport: innerHeight,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        stripWidth: strip.clientWidth,
        stripScrollWidth: strip.scrollWidth,
        wrap: getComputedStyle(strip).flexWrap,
        overflowX: getComputedStyle(strip).overflowX,
        types: buttons.map(button => button.dataset.dateType),
        tops: buttons.map(button => Math.round(button.getBoundingClientRect().top)),
          inputTypeAttribute: dialog.querySelector('[data-date-panel="union-exact"] input')?.getAttribute("type")
      };
    });
    assert.ok(Math.abs(state.dialog - personHeight) < 1, "Safari : feuille familiale et Nouvelle personne ont la même hauteur");
    assert.ok(Math.abs(state.dialog - state.viewport * 0.92) < 1, "Safari : feuille familiale stable à 92dvh");
    assert.equal(state.pageOverflow, 0, "Safari : aucun débordement horizontal de la modale");
    assert.equal(state.wrap, "nowrap", "Safari : aucune seconde ligne d'options");
    assert.equal(state.overflowX, "auto", "Safari : rangée tactile horizontalement défilable");
    assert.deepEqual(state.types, ["exact", "year", "about", "before", "after", "between", "unknown"]);
    assert.equal(new Set(state.tops).size, 1, "Safari : les sept options restent sur une seule ligne");
    assert.equal(state.inputTypeAttribute, "date", "le contrôle calendrier natif reste déclaré");
    await page.locator('#familyDetailsDialog [data-date-prefix="union"][data-date-type="between"]').evaluate(button => button.click());
    assert.equal(await page.locator('#familyDetailsDialog [data-date-panel="union-between"]').isVisible(), true, "Safari : sélection des dates fonctionnelle");

    /* Formulaires de création (Parent puis Partenaire) : mêmes règles. */
    for (const kind of ["parent", "partner"]) {
      await page.evaluate(k => window.__bounded.openRelationBuilder(k), kind);
      await page.waitForFunction(() => !document.getElementById("relationBuilder").hidden);
      await page.waitForTimeout(150);
      const builder = await page.evaluate(k => window.__bounded.builderState(k), kind);
      assert.equal(builder.rootHidden, false, `Safari ${kind} : sections d'union visibles`);
      assert.equal(builder.oldHintPresent, false, `Safari ${kind} : texte obsolète absent`);
      assert.deepEqual(builder.types, ["exact", "year", "about", "before", "after", "between", "unknown"], `Safari ${kind} : sept précisions`);
      assert.equal(builder.oneRow, true, `Safari ${kind} : une seule ligne d'options`);
      assert.equal(builder.wrap, "nowrap", `Safari ${kind} : aucun retour à la ligne`);
      assert.equal(builder.overflowX, "auto", `Safari ${kind} : défilement tactile horizontal`);
      assert.equal(builder.pageOverflow, 0, `Safari ${kind} : aucun débordement de la page`);
      assert.equal(builder.ctaVisible, true, `Safari ${kind} : CTA d'attestation présent`);
      assert.equal(builder.ctaBelowDate, true, `Safari ${kind} : CTA sous le champ Date`);
      await page.locator(`${kind === "parent" ? "#parentUnionSections" : "#partnerUnionSections"} [data-pending-relation-attestation-add]`).click();
      await page.waitForSelector("#personAttestationDialog[open]", { timeout: 5000 });
      await page.locator('#personAttestationDialog [data-journey-date-type="unknown"]').click();
      await page.fill("#journeyAttComment", `Préparée ${kind}`);
      await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
      await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 5000 });
      assert.equal(await page.evaluate(k => window.__bounded.pendingCount(k), kind), 1, `Safari ${kind} : attestation préparée sans écriture Firestore`);
      await page.evaluate(() => window.__bounded.closeRelationBuilder());
      assert.equal(await page.evaluate(k => window.__bounded.pendingCount(k), kind), 0, `Safari ${kind} : fermeture sans attestation orpheline`);
    }
    assert.deepEqual(errors, [], "Safari : aucune erreur JavaScript");
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});

test("formulaires de création : sept précisions sur une ligne et CTA d'attestation sous la date", async t => {
  for (const [width, height] of [[320, 700], [375, 812], [390, 844]]) {
    const session = await launch({ width, height });
    if (!session) return;
    try {
      const { page } = session;
      for (const kind of ["parent", "partner"]) {
        await page.evaluate(k => window.__bounded.openRelationBuilder(k), kind);
        await page.waitForFunction(() => !document.getElementById("relationBuilder").hidden);
        await page.waitForTimeout(150);
        const builder = await page.evaluate(k => window.__bounded.builderState(k), kind);
        assert.equal(builder.rootHidden, false, `${width}px ${kind} : sections d'union visibles`);
        assert.equal(builder.oldHintPresent, false, `${width}px ${kind} : texte obsolète absent`);
        assert.deepEqual(builder.types, ["exact", "year", "about", "before", "after", "between", "unknown"], `${width}px ${kind} : sept précisions`);
        assert.equal(builder.oneRow, true, `${width}px ${kind} : toutes les options sur une seule ligne`);
        assert.equal(builder.wrap, "nowrap", `${width}px ${kind} : aucun retour à la ligne`);
        assert.equal(builder.overflowX, "auto", `${width}px ${kind} : défilement tactile horizontal`);
        assert.ok(builder.switchScroll >= builder.switchClient, `${width}px ${kind} : la rangée ne tronque aucune option`);
        assert.equal(builder.lastOptionReachable, true, `${width}px ${kind} : dernière option atteignable après défilement`);
        assert.equal(builder.pageOverflow, 0, `${width}px ${kind} : aucun débordement de la page`);
        assert.equal(builder.ctaVisible, true, `${width}px ${kind} : CTA d'attestation présent`);
        assert.equal(builder.ctaBelowDate, true, `${width}px ${kind} : CTA sous le champ Date`);

        const root = kind === "parent" ? "#parentUnionSections" : "#partnerUnionSections";
        await page.locator(`${root} [data-pending-relation-attestation-add]`).click();
        await page.waitForSelector("#personAttestationDialog[open]", { timeout: 5000 });
        assert.equal(await page.locator("#personAttestationDialog").evaluate(d => d.open), true, `${width}px ${kind} : modale d'attestation ouverte`);
        await page.locator('#personAttestationDialog [data-journey-date-type="unknown"]').click();
        await page.fill("#journeyAttComment", `Préparée ${kind}`);
        await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
        await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 5000 });
        assert.equal(await page.evaluate(k => window.__bounded.pendingCount(k), kind), 1, `${width}px ${kind} : attestation préparée sans écriture Firestore`);
        assert.equal(await page.locator(`${root} .major-event-attestation-list`).isVisible(), true, `${width}px ${kind} : attestation listée`);
        await page.evaluate(() => window.__bounded.closeRelationBuilder());
        assert.equal(await page.evaluate(k => window.__bounded.pendingCount(k), kind), 0, `${width}px ${kind} : fermeture sans attestation orpheline`);
      }
      assert.deepEqual(session.errors, [], `${width}px : aucune erreur JS (${session.errors.join(" || ")})`);
    } finally { await session.close(); }
  }
});
