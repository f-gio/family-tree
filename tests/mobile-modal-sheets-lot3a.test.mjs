import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const mobileViewports = [[320, 720], [390, 844], [760, 900]];
const desktopViewports = [[761, 760], [1024, 768]];

async function createPage(browser, server, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "fr-FR", isMobile: width <= 760, hasTouch: width <= 760 });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.evaluate(() => {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
  });
  await page.waitForTimeout(200);
  return { context, page };
}

async function openDialog(page, id, mode) {
  await page.evaluate(({ id: dialogId, mode: scenario }) => {
    for (const candidate of ["documentDialog", "dossierDialog"]) {
      const current = document.getElementById(candidate);
      if (current.open) current.close();
    }
    if (dialogId === "documentDialog") {
      document.getElementById("documentId").value = scenario === "edit" ? "fixture-document" : "";
      document.getElementById("documentDialogTitle").textContent = scenario === "edit" ? "Modifier le document" : "Ajouter un document";
      document.getElementById("documentType").value = "Acte de naissance";
      document.getElementById("documentMenuBtn").hidden = scenario !== "edit";
      document.getElementById("deleteDocumentBtn").hidden = scenario !== "edit";
      document.getElementById("documentCurrentFileArea").hidden = scenario !== "edit";
      document.getElementById("currentDocumentFile").textContent = scenario === "edit" ? `${"Acte_familial_tres_long_nom_".repeat(4)}.jpg · 800 Ko stockés` : "";
      document.getElementById("documentPeopleChips").innerHTML = scenario === "edit"
        ? ["Marie Rossi", "Andrea Giovannoni", "Personne historique"].map((name, index) => `<span class="person-multiselect-chip"><span class="person-multiselect-chip-label">${name}</span><button class="person-multiselect-chip-remove" type="button" aria-label="Retirer ${name}" data-remove-document-person="person-${index}">×</button></span>`).join("")
        : "";
    } else {
      document.getElementById("dossierId").value = scenario === "edit" ? "fixture-dossier" : "";
      document.getElementById("dossierDialogTitle").textContent = scenario === "edit" ? "Modifier la démarche" : "Nouvelle démarche";
      document.getElementById("dossierTitle").value = scenario === "edit" ? "Dossier de test" : "";
      document.getElementById("dossierType").value = "research";
      document.getElementById("dossierStatus").value = "progress";
    }
    document.getElementById(dialogId).showModal();
    const dialog = document.getElementById(dialogId);
    dialog.getBoundingClientRect();
    dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish());
  }, { id, mode });
  await page.waitForTimeout(80);
}

async function prepareCompactFixture(page, id) {
  await page.locator(`#${id}`).evaluate(dialog => {
    if (dialog.id === "documentDialog") {
      const grid = dialog.querySelector(".grid");
      for (const heading of grid.querySelectorAll(".form-section-heading")) {
        if (heading.querySelector("h4")?.textContent !== "Identification") heading.hidden = true;
      }
      for (const fieldId of ["documentDate", "documentPlace", "documentNotes"]) dialog.querySelector(`#${fieldId}`).closest("label").hidden = true;
      dialog.querySelector(".document-file-field").hidden = true;
      dialog.querySelector("#documentPeopleList").hidden = true;
      dialog.querySelector("#documentUrl").closest("label").hidden = true;
      return;
    }
    const grid = dialog.querySelector(".modal-scroll .grid");
    for (const heading of grid.querySelectorAll(".form-section-heading")) {
      if (heading.querySelector("h4")?.textContent !== "Objet de la démarche") heading.hidden = true;
    }
    dialog.querySelector("#dossierObjective").closest("label").hidden = true;
    for (const fieldId of ["dossierOrganization", "dossierService", "dossierContactName", "dossierEmail", "dossierPhone", "dossierPlace", "dossierNextAction", "dossierNextActionDate", "dossierNotes", "dossierResult"]) {
      dialog.querySelector(`#${fieldId}`).closest("label").hidden = true;
    }
    dialog.querySelector("#dossierPeopleList").hidden = true;
  });
}

async function addLongContent(page, selector) {
  await page.locator(selector).evaluate(scroller => {
    const filler = document.createElement("div");
    filler.dataset.lot3aFiller = "true";
    filler.style.height = "1400px";
    filler.setAttribute("aria-hidden", "true");
    scroller.append(filler);
  });
}

async function measure(page, id) {
  return page.evaluate(dialogId => {
    const dialog = document.getElementById(dialogId);
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const header = dialog.querySelector(":scope > .modal-head");
    const form = dialog.querySelector(":scope > form.modal-body");
    const scroller = form?.querySelector(":scope > .modal-scroll");
    const footer = form?.querySelector(":scope > .modal-actions");
    const scrollStyle = scroller && getComputedStyle(scroller);
    const footerStyle = footer && getComputedStyle(footer);
    const buttons = footer ? [...footer.querySelectorAll(".right > .btn:not([hidden])")] : [];
    const primary = buttons.at(-1);
    const right = footer?.querySelector(":scope > .right");
    return {
      viewport: { width: document.documentElement.clientWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
      dialog: rect(dialog), maxHeight: getComputedStyle(dialog).maxHeight, open: dialog.open,
      header: header && rect(header), form: form && rect(form), scroller: scroller && rect(scroller), footer: footer && rect(footer), right: right && rect(right), primary: primary && rect(primary),
      scroll: scroller && { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, scrollTop: scroller.scrollTop, overflowY: scrollStyle.overflowY, overflowX: scrollStyle.overflowX, scrollbarWidth: scrollStyle.scrollbarWidth, webkitScrollbar: getComputedStyle(scroller, "::-webkit-scrollbar").display },
      footerPaddingBottom: footer ? parseFloat(footerStyle.paddingBottom) : 0,
      desktopPrimaryRightInset: footer && primary ? footer.getBoundingClientRect().right - primary.getBoundingClientRect().right : null,
      fileArea: dialogId === "documentDialog" ? { visible: !document.getElementById("documentCurrentFileArea").hidden, people: document.querySelectorAll("#documentPeopleChips .person-multiselect-chip").length } : null
    };
  }, id);
}

async function verifyMobileDialog(browser, server, id, width, height, mode, compact, t) {
  const { context, page } = await createPage(browser, server, width, height);
  try {
    await openDialog(page, id, mode);
    if (compact) await prepareCompactFixture(page, id);
    const short = await measure(page, id);
    const max = height * 0.88;
    assert.equal(short.open, true);
    assert.ok(Math.abs(short.dialog.bottom - height) < 1, `${id} ancrée au bas du viewport`);
    assert.ok(short.dialog.height <= max + 1, `${id} plafonnée à 88dvh`);
    assert.ok(parseFloat(short.maxHeight) <= max + 1, `${id} max-height de 88dvh`);
    assert.ok(short.dialog.y > 0, `${id} laisse la page visible au-dessus`);
    assert.ok(short.header.bottom <= short.scroller.y + 1, `${id} header fixe au-dessus du contenu`);
    assert.ok(Math.abs(short.scroller.bottom - short.footer.y) < 1, `${id} contenu jusqu’au footer`);
    assert.ok(short.footer.bottom <= height + 1, `${id} footer visible`);
    assert.ok(short.footerPaddingBottom >= 12, `${id} safe-area basse réservée`);
    assert.equal(short.scroll.overflowY, "auto");
    assert.equal(short.scroll.scrollbarWidth, "none");
    assert.equal(short.scroll.webkitScrollbar, "none");
    assert.equal(short.viewport.scrollWidth, short.viewport.width, "aucun overflow horizontal");
    if (compact) assert.ok(short.dialog.height < max - 1, `${id} conserve une hauteur naturelle, sans plage vide`);
    if (id === "documentDialog" && mode === "edit") {
      assert.ok(short.fileArea.visible, "le document existant reste affiché");
      assert.equal(short.fileArea.people, 3, "les personnes associées restent affichées");
      assert.equal(await page.locator("#documentMenuBtn").isVisible(), true, "le menu d’édition ⋯ reste disponible");
    }
    if (id === "dossierDialog" && mode === "edit") assert.equal(await page.locator("#deleteDossierBtn").isVisible(), false, "la suppression existante reste masquée");

    await addLongContent(page, `#${id} .modal-scroll`);
    const beforeScroll = await measure(page, id);
    assert.ok(Math.abs(beforeScroll.dialog.height - max) < 1, `${id} grandit jusqu’au plafond de 88dvh`);
    assert.ok(beforeScroll.scroll.scrollHeight > beforeScroll.scroll.clientHeight, `${id} contenu long dans un scroller interne`);
    await page.locator(`#${id} .modal-scroll`).evaluate(scroller => { scroller.scrollTop = 300; });
    const afterScroll = await measure(page, id);
    assert.ok(afterScroll.scroll.scrollTop > 0, `${id} scroll interne fonctionnel`);
    assert.deepEqual(afterScroll.header, beforeScroll.header, `${id} header fixe pendant le scroll`);
    assert.deepEqual(afterScroll.footer, beforeScroll.footer, `${id} actions fixes pendant le scroll`);
    assert.equal(afterScroll.viewport.scrollWidth, width);
    t.diagnostic(`${id} ${mode} ${width}×${height}: court=${short.dialog.height.toFixed(2)}px, long=${beforeScroll.dialog.height.toFixed(2)}px, plafond=${parseFloat(short.maxHeight).toFixed(2)}px, bande=${short.dialog.y.toFixed(2)}px, header=${short.header.height.toFixed(2)}px, zone=${beforeScroll.scroller.height.toFixed(2)}px, footer=${short.footer.height.toFixed(2)}px`);

    await page.keyboard.press("Escape");
    assert.equal(await page.locator(`#${id}`).evaluate(dialog => dialog.open), false, `${id} fermable par Escape`);
    await openDialog(page, id, mode);
    await page.locator(`#${id} .modal-actions [data-close="${id}"]`).click();
    assert.equal(await page.locator(`#${id}`).evaluate(dialog => dialog.open), false, `${id} Annuler ferme la modale`);
  } finally { await context.close(); }
}

async function desktopMetrics(browser, server, width, height, id) {
  const { context, page } = await createPage(browser, server, width, height);
  try {
    await openDialog(page, id, "create");
    const withSheetClasses = await measure(page, id);
    await page.locator(`#${id}`).evaluate(dialog => dialog.classList.remove("modal-mobile-sheet", "modal-mobile-sheet--long-form"));
    await page.locator(`#${id}`).evaluate(dialog => dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
    await page.waitForTimeout(170);
    const withoutSheetClasses = await measure(page, id);
    assert.deepEqual(withSheetClasses.dialog, withoutSheetClasses.dialog, `${id} géométrie desktop identique avec/sans classes sheet`);
    assert.deepEqual(withSheetClasses.footer, withoutSheetClasses.footer, `${id} footer desktop inchangé`);
    assert.deepEqual(withSheetClasses.primary, withoutSheetClasses.primary, `${id} bouton primaire desktop inchangé`);
    return { context, page, metrics: withoutSheetClasses };
  } catch (error) {
    await context.close();
    throw error;
  }
}

test("Lot 3A : Document et Dossier en bottom sheets mobiles", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const [width, height] of mobileViewports) {
      await t.test(`${width}×${height} Document création compacte`, async child => verifyMobileDialog(browser, server, "documentDialog", width, height, "create", true, child));
      await t.test(`${width}×${height} Document édition, associations et fichier`, async child => verifyMobileDialog(browser, server, "documentDialog", width, height, "edit", false, child));
      await t.test(`${width}×${height} Dossier création compacte`, async child => verifyMobileDialog(browser, server, "dossierDialog", width, height, "create", true, child));
      await t.test(`${width}×${height} Dossier édition longue`, async child => verifyMobileDialog(browser, server, "dossierDialog", width, height, "edit", false, child));
    }
    for (const [width, height] of desktopViewports) {
      for (const id of ["documentDialog", "dossierDialog"]) {
        const result = await desktopMetrics(browser, server, width, height, id);
        try {
          if (id === "dossierDialog") {
            t.diagnostic(`Dossier ${width}×${height} desktop : ${JSON.stringify({ footer: result.metrics.footer, rightGroup: result.metrics.right, primary: result.metrics.primary, rightInset: result.metrics.desktopPrimaryRightInset })}`);
          }
        } finally { await result.context.close(); }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("Diagnostic Dossier desktop : reproduit le hook du test d’alignement existant", async t => {
  let browser;
  try { browser = await webkit.launch({ headless: true }); }
  catch (error) { t.skip(`WebKit indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR", isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url.endsWith("/js/app.js")) {
      const response = await route.fetch();
      const hook = `window.__openDossierDiagnostic = () => { document.getElementById("authScreen").hidden = true; document.getElementById("topbar").hidden = false; openDossierForm(null); };`;
      return route.fulfill({ response, body: `${await response.text()}\n${hook}` });
    }
    if (isAllowedRequest(url, server.baseURL) || url.includes("gstatic.com")) return route.continue();
    return blockedServiceFor(url) ? route.abort("blockedbyclient") : route.continue();
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__openDossierDiagnostic === "function");
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.evaluate(() => window.__openDossierDiagnostic());
    const measureFooter = () => page.evaluate(() => {
      const dialog = document.getElementById("dossierDialog");
      const footer = dialog.querySelector(".modal-actions");
      const primary = footer.querySelector("#saveDossierBtn");
      const right = footer.querySelector(".right");
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, y: r.y, height: r.height }; };
      return { dialog: rect(dialog), footer: rect(footer), right: rect(right), primary: rect(primary), inset: footer.getBoundingClientRect().right - primary.getBoundingClientRect().right, footerPaddingRight: getComputedStyle(footer).paddingRight, display: getComputedStyle(right).display, justifyContent: getComputedStyle(right).justifyContent, viewport: { innerWidth, clientWidth: document.documentElement.clientWidth } };
    });
    const duringOpening = await measureFooter();
    await page.locator("#dossierDialog").evaluate(dialog => {
      dialog.getBoundingClientRect();
      dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish());
    });
    const settled = await measureFooter();
    await page.locator("#dossierDialog").evaluate(dialog => dialog.classList.remove("modal-mobile-sheet", "modal-mobile-sheet--long-form"));
    await page.locator("#dossierDialog").evaluate(dialog => {
      dialog.getBoundingClientRect();
      dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish());
    });
    const withoutClasses = await measureFooter();
    t.diagnostic(`Dossier WebKit 1024 px via openDossierForm: ${JSON.stringify({ duringOpening: { footer: duringOpening.footer, primary: duringOpening.primary, inset: duringOpening.inset }, settled: { footer: settled.footer, primary: settled.primary, inset: settled.inset }, withoutMobileClasses: { footer: withoutClasses.footer, primary: withoutClasses.primary, inset: withoutClasses.inset } })}`);
    assert.ok(Math.abs(settled.inset - 24) < 0.5, "le CTA est à son padding desktop une fois l’animation d’ouverture terminée");
    assert.ok(Math.abs(withoutClasses.inset - 24) < 0.5, "le footer sans classes mobiles garde le padding desktop de 24px");
    assert.ok(Math.abs(settled.footer.width - withoutClasses.footer.width) < 1.5, "largeur du footer desktop identique avec/sans variantes mobiles (tolérance fractionnaire)");
    assert.ok(Math.abs(settled.primary.x - withoutClasses.primary.x) < 1.5, "position primaire desktop identique avec/sans variantes mobiles (tolérance fractionnaire)");
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
