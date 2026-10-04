import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

async function createPage(browser, server, width, height, touch = false, mode = "create") {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "fr-FR",
    isMobile: touch,
    hasTouch: touch
  });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.evaluate(mode => {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
    document.getElementById("personId").value = mode === "edit" ? "fixture-person" : "";
    document.getElementById("dialogTitle").textContent = mode === "edit" ? "Ada Rossi" : "Nouvelle personne";
    document.getElementById("personDialog").showModal();
    const dialog = document.getElementById("personDialog");
    dialog.getBoundingClientRect();
    dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish());
  }, mode);
  await page.waitForTimeout(100);
  return { context, page };
}

async function activatePanel(page, key, documentCount = 0, mode = "edit") {
  await page.evaluate(({ key: active, documentCount: count, mode }) => {
    const list = document.getElementById("personDocumentsList");
    list.innerHTML = count
      ? `<div class="person-doc-gallery">${Array.from({ length: count }, (_, index) => `<article class="person-doc-card" tabindex="0" aria-label="Consulter Acte familial ${index + 1}"><div class="person-doc-thumb"><span class="person-doc-tile" aria-hidden="true">Acte</span></div><div class="person-doc-meta"><strong class="person-doc-title">Acte familial ${index + 1}</strong><span class="person-doc-subrow"><span class="person-doc-type">Acte associé</span><button class="btn small person-doc-edit" type="button"><span>Modifier</span></button></span></div></article>`).join("")}</div>`
      : `<div class="empty-state"><strong>Aucun document associé</strong><p>Les documents ajoutés pour cette personne apparaîtront ici.</p></div>`;
    document.querySelectorAll("[data-person-panel]").forEach(panel => { panel.hidden = panel.dataset.personPanel !== active; });
    document.querySelectorAll("[data-person-section]").forEach(tab => {
      const selected = tab.dataset.personSection === active;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    document.getElementById("personRelationsUnavailable").hidden = mode === "edit";
    document.getElementById("personRelationsContent").hidden = mode !== "edit";
    document.getElementById("personDocumentsUnavailable").hidden = mode === "edit";
    document.getElementById("personDocumentsSection").hidden = mode !== "edit";
  }, { key, documentCount, mode });
  await page.evaluate(() => {
    document.querySelector("[data-person-panel]:not([hidden])").getAnimations().forEach(animation => animation.finish());
  });
  await page.waitForTimeout(40);
}

async function measure(page) {
  return page.evaluate(() => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const dialog = document.getElementById("personDialog");
    const header = dialog.querySelector(":scope > .person-head");
    const tabs = dialog.querySelector(":scope > .person-section-nav");
    const form = dialog.querySelector(":scope > .person-modal-form");
    const panel = form.querySelector(".person-section-panel:not([hidden])");
    const footer = form.querySelector(":scope > .person-actions");
    const panelStyle = getComputedStyle(panel);
    const button = footer.querySelector("#savePersonBtn");
    return {
      viewport: { width: document.documentElement.clientWidth, height: innerHeight },
      dialog: rect(dialog), header: rect(header), tabs: rect(tabs), form: rect(form), panel: rect(panel), footer: rect(footer),
      maxHeight: getComputedStyle(dialog).maxHeight,
      panelScroll: { height: panel.scrollHeight, clientHeight: panel.clientHeight, top: panel.scrollTop, overflowY: panelStyle.overflowY, overflowX: panelStyle.overflowX, scrollbarWidth: panelStyle.scrollbarWidth, webkitScrollbar: getComputedStyle(panel, "::-webkit-scrollbar").display },
      footerPaddingBottom: parseFloat(getComputedStyle(footer).paddingBottom),
      saveButton: rect(button),
      rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      open: dialog.open
    };
  });
}

async function swipePanel(page, selector) {
  const panel = page.locator(selector);
  const box = await panel.boundingBox();
  assert.ok(box && box.height > 120, "zone centrale assez haute pour un geste tactile");
  const x = Math.round(box.x + box.width / 2);
  const startY = Math.round(box.y + box.height * 0.75);
  const endY = Math.round(box.y + box.height * 0.25);
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY, id: 1 }] });
  for (let step = 1; step <= 5; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: Math.round(startY + ((endY - startY) * step) / 5), id: 1 }] });
    await page.waitForTimeout(16);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
  await page.waitForTimeout(100);
}

async function testMobileViewport(browser, server, width, height, t, mode = "edit", documentVariants = true) {
  const { context, page } = await createPage(browser, server, width, height, false, mode);
  const labels = { identity: "Identité", relations: "Liens familiaux", documents: "Documents associés" };
  let stableHeight;
  try {
    for (const key of ["identity", "relations", "documents"]) {
      await t.test(`${width}×${height} : ${mode === "edit" ? "édition" : "création"}, onglet ${labels[key]}`, async () => {
        await activatePanel(page, key, 0, mode);
        const m = await measure(page);
        if (width === 390 && key === "documents") t.diagnostic(`Mesures réelles à 390×${height} : ${JSON.stringify({ viewport: m.viewport.height, fiche: m.dialog.height, bande: m.dialog.y, header: m.header.height, tabs: m.tabs.height, footer: m.footer.height, contenu: m.panel.height, maxHeight: m.maxHeight })}`);
        assert.ok(m.open, "fiche ouverte");
        assert.ok(Math.abs(m.dialog.bottom - height) < 1, "sheet ancrée en bas");
        assert.ok(Math.abs(m.dialog.height - height * 0.92) < 1, "hauteur stable de 92dvh");
        if (stableHeight == null) stableHeight = m.dialog.height;
        else assert.ok(Math.abs(m.dialog.height - stableHeight) < 0.5, "la hauteur ne varie pas en changeant d’onglet");
        assert.ok(Math.abs(m.dialog.y - height * 0.08) < 1, "bande visible stable à 8% du viewport");
        assert.ok(m.dialog.y >= height * 0.07 - 1, "bande de page perceptible au-dessus");
        assert.equal(m.panelScroll.overflowY, "auto", "seul le panneau actif défile");
        assert.equal(m.panelScroll.scrollbarWidth, "none");
        assert.equal(m.panelScroll.webkitScrollbar, "none");
        assert.ok(m.header.bottom <= m.tabs.y + 1, "header au-dessus des onglets");
        assert.ok(Math.abs(m.tabs.bottom - m.panel.y) < 1, "le contenu commence juste après les onglets fixes");
        assert.ok(Math.abs(m.panel.bottom - m.footer.y) < 1, "le contenu occupe l’espace jusqu’au footer fixe");
        assert.ok(m.footer.bottom <= height + 1, "footer visible dans le viewport");
        assert.ok(m.footer.height >= 60, "footer avec actions présent");
        assert.ok(m.footerPaddingBottom >= 12, "safe-area bas prévue dans le footer");
        assert.equal(m.rootOverflow, 0, "aucun overflow horizontal");
      });
    }
    if (width === 390 && documentVariants) {
      for (const count of [0, 3, 36]) {
        await t.test(`390×${height} : Documents associés, ${count} document(s)`, async () => {
          await activatePanel(page, "documents", count, "edit");
          const before = await measure(page);
          if (count === 36) t.diagnostic(`Mesures à 390×${height}, liste longue : ${JSON.stringify({ viewport: before.viewport.height, fiche: before.dialog.height, bande: before.dialog.y, header: before.header.height, tabs: before.tabs.height, footer: before.footer.height, contenu: before.panel.height, maxHeight: before.maxHeight })}`);
          assert.ok(Math.abs(before.dialog.bottom - height) < 1);
          assert.ok(Math.abs(before.dialog.height - height * 0.92) < 1, "la fiche conserve 92dvh quel que soit le nombre de documents");
          assert.equal(await page.locator("#personDocumentsList .person-doc-card").count(), count);
          assert.equal(before.panelScroll.overflowY, "auto");
          assert.equal(before.panelScroll.scrollbarWidth, "none");
          assert.equal(before.panelScroll.webkitScrollbar, "none");
          assert.ok(before.panel.bottom <= before.footer.y + 1, "aucun document sous le footer");
          if (count === 36) {
            assert.ok(before.panelScroll.height > before.panelScroll.clientHeight, "la liste longue déborde dans le panneau scrollable");
            await page.locator("#personDocumentsPanel").evaluate(panel => { panel.scrollTop = 180; });
            const after = await measure(page);
            assert.ok(after.panelScroll.top > 0, "scroll du panneau Document fonctionnel");
            assert.deepEqual(after.header, before.header, "header fixe pendant le scroll");
            assert.deepEqual(after.tabs, before.tabs, "onglets fixes pendant le scroll");
            assert.deepEqual(after.footer, before.footer, "footer fixe pendant le scroll");
          } else {
            assert.equal(before.panelScroll.height, before.panelScroll.clientHeight, "liste courte sans défilement superflu");
          }
        });
      }
    }
    await t.test(`${width}×${height} : fermeture Escape et Annuler`, async () => {
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), false, "Escape ferme la fiche");
      await page.locator("#personDialog").evaluate(dialog => dialog.showModal());
      await page.locator('#personDialog .person-actions [data-close="personDialog"]').click();
      assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), false, "Annuler ferme la fiche");
    });
  } finally {
    await context.close();
  }
}

async function testDesktop(browser, server, width, height, t) {
  const { context, page } = await createPage(browser, server, width, height);
  try {
    const withSheetClasses = await measure(page);
    await page.locator("#personDialog").evaluate(dialog => dialog.classList.remove("modal-mobile-sheet", "modal-mobile-sheet--long"));
    await page.locator("#personDialog").evaluate(dialog => dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
    await page.waitForTimeout(170);
    const withoutSheetClasses = await measure(page);
    assert.deepEqual(withSheetClasses, withoutSheetClasses, "géométrie, défilement et footer desktop identiques sans les classes sheet");
  } finally {
    await context.close();
  }
}

test("Fiche Personne mobile : bottom sheet, onglets fixes et seul le panneau actif défile", async t => {
  let chromiumBrowser;
  let webkitBrowser;
  try { chromiumBrowser = await chromium.launch({ headless: true }); }
  catch (error) { await t.test("Chromium", child => child.skip(`Navigateur indisponible : ${error.message}`)); }
  try { webkitBrowser = await webkit.launch({ headless: true }); }
  catch (error) { await t.test("WebKit tactile", child => child.skip(`Navigateur indisponible : ${error.message}`)); }
  if (!chromiumBrowser && !webkitBrowser) return;
  const server = await startStaticServer(ROOT);
  try {
    if (chromiumBrowser) {
      await testMobileViewport(chromiumBrowser, server, 320, 700, t, "create", false);
      await testMobileViewport(chromiumBrowser, server, 390, 844, t, "edit", true);
      await testMobileViewport(chromiumBrowser, server, 390, 844, t, "create", false);
      await testMobileViewport(chromiumBrowser, server, 760, 900, t, "create", false);
      for (const [width, height] of [[761, 760], [1024, 768]]) await t.test(`${width}×${height} : bureau inchangé`, async child => testDesktop(chromiumBrowser, server, width, height, child));
      await t.test("Chromium tactile 390×844 : geste de défilement sur Documents associés", async () => {
        const { context, page } = await createPage(chromiumBrowser, server, 390, 844, true, "edit");
        try {
          await activatePanel(page, "documents", 36);
          assert.ok((await measure(page)).panelScroll.height > (await measure(page)).panelScroll.clientHeight);
          await swipePanel(page, "#personDocumentsPanel");
          assert.ok((await measure(page)).panelScroll.top > 0, "le geste tactile fait défiler la liste sans déplacer la sheet");
        } finally { await context.close(); }
      });
    }
    if (webkitBrowser) {
      await t.test("WebKit tactile 390×844 : onglets et zone sûre", async child => {
        const { context, page } = await createPage(webkitBrowser, server, 390, 844, true, "edit");
        try {
          await activatePanel(page, "documents", 36);
          const m = await measure(page);
          assert.ok(m.panelScroll.height > m.panelScroll.clientHeight);
          assert.equal(m.panelScroll.scrollbarWidth, "none");
          assert.ok(m.footerPaddingBottom >= 12);
          await page.locator("#personDocumentsPanel").evaluate(panel => { panel.scrollTop = 160; });
          assert.ok((await measure(page)).panelScroll.top > 0, "panneau défilable au toucher");
        } finally { await context.close(); }
      });
    }
  } finally {
    await chromiumBrowser?.close();
    await webkitBrowser?.close();
    await server.close();
  }
});

test("Fiche Personne : navigation liée aux fenêtres Document et Relation préservée", () => {
  assert.match(appSource, /if \(editPersonDocument\) \{[\s\S]*?capturePersonDraft\(\)[\s\S]*?\$\("personDialog"\)\.close\(\);[\s\S]*?openDocument\(item, "", context\)/);
  assert.match(appSource, /\$\("linkDocumentBtn"\)\.onclick = \(\) => \{[\s\S]*?capturePersonDraft\(\)[\s\S]*?\$\("personDialog"\)\.close\(\);\s*openDocument\(null, personId, context\)/);
  assert.match(appSource, /\$\("documentDialog"\)\.addEventListener\("close", \(\) => \{[\s\S]*?openPerson\(item, context\.source\);\s*restorePersonDraft\(context\.draft\);\s*setPersonSection\("documents"\)/);
  assert.match(appSource, /function openFamilyDetails\([\s\S]*?familyDetailsReturnContext = \{ personId: activeId, source: personDialogSource, draft: capturePersonDraft\(\) \}[\s\S]*?\$\("personDialog"\)\.close\(\)/);
  assert.match(appSource, /\$\("familyDetailsDialog"\)\.addEventListener\("close", \(\) => \{ if \(familyDetailsReturnContext\) returnFromFamilyDetails\(\); \}\)/);
  assert.match(appSource, /document\.querySelectorAll\("\[data-person-section\]"\)\.forEach\(button => \{\s*button\.onclick = \(\) => setPersonSection\(button\.dataset\.personSection, true\)/);
});
