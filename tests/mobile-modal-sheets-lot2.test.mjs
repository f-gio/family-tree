import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const mobileViewports = [[320, 700], [390, 844], [760, 900]];
const profileViewports = [[320, 844], [390, 844], [760, 900]];
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
  await page.waitForTimeout(250);
  return { context, page };
}

async function showDialog(page, id, mode = "create") {
  await page.evaluate(({ id: dialogId, mode: scenario }) => {
    for (const candidate of ["taskDialog", "familyDetailsDialog", "profileDialog", "personDialog"]) {
      const current = document.getElementById(candidate);
      if (current.open) current.close();
    }
    if (dialogId === "taskDialog") {
      document.getElementById("taskId").value = scenario === "edit" ? "fixture-task" : "";
      document.getElementById("taskDialogTitle").textContent = scenario === "edit" ? "Modifier l’action" : "Ajouter une action";
      document.getElementById("taskMenuBtn").hidden = scenario !== "edit";
      document.getElementById("deleteTaskBtn").hidden = scenario !== "edit";
    }
    if (dialogId === "familyDetailsDialog") document.getElementById("familyDetailsId").value = "fixture-family";
    if (dialogId === "profileDialog") {
      document.querySelectorAll("[data-settings-tab]").forEach((tab, index) => {
        const active = index === 0;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      document.getElementById("profileSettingsPanel").hidden = false;
      document.getElementById("securitySettingsPanel").hidden = true;
    }
    document.getElementById(dialogId).showModal();
    const dialog = document.getElementById(dialogId);
    dialog.getBoundingClientRect();
    dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish());
  }, { id, mode });
  await page.waitForTimeout(120);
}

async function settlePanel(panel) {
  await panel.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
}

async function measureFormDialog(page, id) {
  return page.evaluate(dialogId => {
    const dialog = document.getElementById(dialogId);
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const header = dialog.querySelector(":scope > .modal-head");
    const form = dialog.querySelector(":scope > .modal-body.modal-form");
    const scroller = form?.querySelector(":scope > .modal-scroll");
    const footer = form?.querySelector(":scope > .modal-actions");
    const scrollStyle = scroller && getComputedStyle(scroller);
    return {
      viewport: { width: document.documentElement.clientWidth, height: innerHeight },
      dialog: rect(dialog), maxHeight: getComputedStyle(dialog).maxHeight,
      header: header && rect(header), form: form && rect(form), scroller: scroller && rect(scroller), footer: footer && rect(footer),
      scroll: scroller && { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, scrollTop: scroller.scrollTop, overflowY: scrollStyle.overflowY, overflowX: scrollStyle.overflowX, scrollbarWidth: scrollStyle.scrollbarWidth, webkitScrollbar: getComputedStyle(scroller, "::-webkit-scrollbar").display },
      footerPaddingBottom: footer ? parseFloat(getComputedStyle(footer).paddingBottom) : 0,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      open: dialog.open
    };
  }, id);
}

async function addLongFormContent(page, selector) {
  await page.locator(selector).evaluate(scroller => {
    const filler = document.createElement("div");
    filler.dataset.lot2Filler = "true";
    filler.style.height = "1100px";
    filler.setAttribute("aria-hidden", "true");
    scroller.append(filler);
  });
}

async function compactFormFixture(page, id) {
  await page.locator(`#${id}`).evaluate(dialog => {
    if (dialog.id === "taskDialog") {
      const scroller = dialog.querySelector(".modal-scroll");
      scroller.querySelectorAll(".form-section-heading")[1].hidden = true;
      for (const fieldId of ["taskAssignee", "taskDueDate", "taskDescription", "taskComments"]) {
        dialog.querySelector(`#${fieldId}`).closest("label").hidden = true;
      }
      return;
    }
    const sections = dialog.querySelectorAll(".family-detail-section");
    sections[1].hidden = true;
    sections[2].hidden = true;
    dialog.querySelector("#unionPlace").closest("label").hidden = true;
    dialog.querySelector('[data-date-control="union"]').hidden = true;
  });
}

async function checkFormSheet(browser, server, id, width, height, mode, t, compact = false) {
  const { context, page } = await createPage(browser, server, width, height);
  try {
    await showDialog(page, id, mode);
    if (compact) await compactFormFixture(page, id);
    const before = await measureFormDialog(page, id);
    const plafond = height * 0.86;
    t.diagnostic(`${id} ${mode} short ${width}×${height}: dialog=${before.dialog.height}, max=${before.maxHeight}, scroll=${before.scroll.scrollHeight}/${before.scroll.clientHeight}`);
    assert.equal(await page.locator(`#${id}`).evaluate(dialog => dialog.open), true);
    assert.ok(Math.abs(before.dialog.bottom - height) < 1, `${id} est ancrée au bas du viewport`);
    assert.ok(before.dialog.height <= plafond + 1, `${id} respecte son plafond 86dvh`);
    assert.ok(parseFloat(before.maxHeight) <= plafond + 1, `${id} expose un max-height adaptatif de 86dvh`);
    assert.ok(before.dialog.y > 0, `${id} laisse la page visible derrière`);
    assert.ok(before.header.bottom <= before.scroller.y + 1, `${id} conserve son header fixe`);
    assert.ok(Math.abs(before.scroller.bottom - before.footer.y) < 1, `${id} réserve le footer après la zone scrollable`);
    assert.ok(before.footer.bottom <= height + 1, `${id} garde le footer dans le viewport`);
    assert.ok(before.footerPaddingBottom >= 12, `${id} réserve la safe-area sous le footer`);
    assert.equal(before.scroll.overflowY, "auto", `${id} garde le scroll vertical`);
    assert.equal(before.scroll.scrollbarWidth, "none", `${id} masque la scrollbar Firefox`);
    assert.equal(before.scroll.webkitScrollbar, "none", `${id} masque la scrollbar WebKit`);
    assert.equal(before.pageOverflow, 0, `${id} ne crée aucun overflow horizontal`);
    if (compact) assert.ok(before.dialog.height < plafond - 1, `${id} reste naturelle quand le contenu est court`);

    if (mode === "edit" && id === "taskDialog") {
      assert.equal(await page.locator("#taskMenuBtn").isVisible(), true, "le menu ⋯ reste présent en édition");
      const menuButton = await page.locator("#taskMenuBtn").boundingBox();
      assert.ok(menuButton && menuButton.y >= before.header.y && menuButton.bottom <= before.header.bottom, "le menu ⋯ reste dans le header fixe");
    }

    await addLongFormContent(page, `#${id} .modal-scroll`);
    const longBefore = await measureFormDialog(page, id);
    assert.ok(Math.abs(longBefore.dialog.height - plafond) < 1, `${id} grandit jusqu’au plafond en contenu long`);
    assert.ok(longBefore.scroll.scrollHeight > longBefore.scroll.clientHeight, `${id} fait défiler son contenu central long`);
    await page.locator(`#${id} .modal-scroll`).evaluate(scroller => { scroller.scrollTop = 260; });
    const longAfter = await measureFormDialog(page, id);
    assert.ok(longAfter.scroll.scrollTop > 0, `${id} accepte le défilement central`);
    assert.deepEqual(longAfter.header, longBefore.header, `${id} garde son header en place pendant le scroll`);
    assert.deepEqual(longAfter.footer, longBefore.footer, `${id} garde son footer en place pendant le scroll`);
    assert.equal(longAfter.pageOverflow, 0);

    await page.keyboard.press("Escape");
    assert.equal(await page.locator(`#${id}`).evaluate(dialog => dialog.open), false, `${id} reste fermable avec Escape`);
    await showDialog(page, id, mode);
    await page.locator(`#${id} .modal-actions [data-close="${id}"]`).click();
    assert.equal(await page.locator(`#${id}`).evaluate(dialog => dialog.open), false, `${id} reste fermable avec Annuler`);
    t.diagnostic(`${id} ${mode} ${width}×${height}: court=${before.dialog.height.toFixed(1)}px, long=${longBefore.dialog.height.toFixed(1)}px, max=${parseFloat(before.maxHeight).toFixed(1)}px, bande=${before.dialog.y.toFixed(1)}px, header=${before.header.height.toFixed(1)}px, contenu=${longBefore.scroller.height.toFixed(1)}px, footer=${before.footer.height.toFixed(1)}px`);
  } finally {
    await context.close();
  }
}

async function switchSettingsPanel(page, key) {
  await page.locator(`[data-settings-tab="${key}"]`).click();
  await settlePanel(page.locator(`#${key === "profile" ? "profileSettingsPanel" : "securitySettingsPanel"}`));
}

async function measureProfile(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById("profileDialog");
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const header = dialog.querySelector(":scope > .modal-head");
    const layout = dialog.querySelector(":scope > .settings-layout");
    const nav = layout.querySelector(":scope > .settings-nav");
    const panel = layout.querySelector(":scope > .settings-panel:not([hidden])");
    const actions = panel.querySelector(":scope > .settings-actions");
    const style = getComputedStyle(panel);
    return {
      viewport: { width: document.documentElement.clientWidth, height: innerHeight },
      dialog: rect(dialog), maxHeight: getComputedStyle(dialog).maxHeight,
      header: rect(header), layout: rect(layout), nav: rect(nav), panel: rect(panel), actions: rect(actions),
      navScroll: { width: nav.scrollWidth, clientWidth: nav.clientWidth, overflowX: getComputedStyle(nav).overflowX, scrollbarWidth: getComputedStyle(nav).scrollbarWidth, webkitScrollbar: getComputedStyle(nav, "::-webkit-scrollbar").display },
      tabs: [...nav.querySelectorAll("[data-settings-tab]")].map(tab => ({ label: tab.textContent.trim(), box: rect(tab), selected: tab.getAttribute("aria-selected"), active: tab.classList.contains("active"), minHeight: getComputedStyle(tab).minHeight })),
      panelScroll: { height: panel.scrollHeight, clientHeight: panel.clientHeight, scrollTop: panel.scrollTop, overflowY: style.overflowY, overflowX: style.overflowX, scrollbarWidth: style.scrollbarWidth, webkitScrollbar: getComputedStyle(panel, "::-webkit-scrollbar").display },
      actionPaddingBottom: parseFloat(getComputedStyle(actions).paddingBottom),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      open: dialog.open
    };
  });
}

async function addSettingsFiller(page, panelId) {
  await page.locator(`#${panelId}`).evaluate(panel => {
    const filler = document.createElement("div");
    filler.dataset.lot2Filler = "true";
    filler.style.height = "1000px";
    filler.setAttribute("aria-hidden", "true");
    const actions = panel.querySelector(":scope > .settings-actions");
    panel.insertBefore(filler, actions);
  });
}

async function checkProfile(browser, server, width, height, t) {
  const { context, page } = await createPage(browser, server, width, height);
  try {
    await showDialog(page, "profileDialog");
    let stableHeight;
    const positions = {};
    for (const [key, panelId] of [["profile", "profileSettingsPanel"], ["security", "securitySettingsPanel"], ["profile", "profileSettingsPanel"]]) {
      await switchSettingsPanel(page, key);
      await addSettingsFiller(page, panelId);
      const before = await measureProfile(page);
      const expected = height * 0.9;
      t.diagnostic(`${width}×${height} profil-${key}: dialog=${before.dialog.height}, max=${before.maxHeight}, rect=${JSON.stringify(before.dialog)}`);
      assert.equal(before.open, true, "Paramètres reste ouvert pendant la vérification");
      assert.ok(Math.abs(before.dialog.height - expected) < 1, `${key} conserve une hauteur de 90dvh`);
      assert.ok(Math.abs(before.dialog.bottom - height) < 1, "Paramètres reste ancrée au bas");
      assert.ok(Math.abs(before.dialog.y - height * 0.1) < 1, "la bande derrière reste constante à 10% du viewport");
      assert.deepEqual(before.tabs.map(tab => tab.label), ["Profil", "Sécurité"], "les deux onglets sont présents");
      assert.ok(before.tabs.every(tab => tab.box.width >= 44 && tab.box.height >= 44 && tab.minHeight === "44px"), "les onglets ont des cibles tactiles ≥44px");
      assert.ok(Math.abs(before.tabs[0].box.width - before.tabs[1].box.width) < 1, "les onglets partagent deux colonnes égales");
      assert.ok(before.tabs.every(tab => tab.box.x >= before.nav.x - 0.5 && tab.box.right <= before.nav.right + 0.5), "les deux onglets tiennent dans la navigation");
      assert.equal(before.navScroll.width, before.navScroll.clientWidth, "aucun débordement de navigation");
      assert.equal(before.navScroll.scrollbarWidth, "none");
      assert.equal(before.navScroll.webkitScrollbar, "none");
      assert.equal(before.tabs.find(tab => tab.selected === "true")?.label, key === "profile" ? "Profil" : "Sécurité", "l’onglet actif reste synchronisé");
      if (stableHeight == null) stableHeight = before.dialog.height;
      else assert.ok(Math.abs(before.dialog.height - stableHeight) < 0.5, "Profil et Sécurité gardent la même hauteur");
      assert.ok(before.header.bottom <= before.nav.y + 1, "header fixe au-dessus de la navigation");
      assert.ok(before.nav.bottom <= before.panel.y + 1, "navigation fixe au-dessus du panneau actif");
      assert.equal(before.panelScroll.overflowY, "auto");
      assert.equal(before.panelScroll.scrollbarWidth, "none");
      assert.equal(before.panelScroll.webkitScrollbar, "none");
      assert.ok(before.panelScroll.height > before.panelScroll.clientHeight, `${key} offre un panneau scrollable long`);
      assert.ok(before.actionPaddingBottom >= 12, "les actions respectent la safe-area basse");
      assert.ok(before.actions.bottom <= before.panel.bottom + 1, "actions du panneau actif accessibles");
      await page.locator(`#${panelId}`).evaluate(panel => { panel.scrollTop = 200; });
      const after = await measureProfile(page);
      assert.ok(after.panelScroll.scrollTop > 0, `${key} défile dans son panneau seulement`);
      assert.deepEqual(after.header, before.header, "header fixe au scroll");
      assert.deepEqual(after.nav, before.nav, "navigation fixe au scroll");
      assert.deepEqual(after.actions, before.actions, "actions sticky accessibles au scroll");
      assert.equal(after.pageOverflow, 0);
      positions[key] = { height: before.dialog.height, band: before.dialog.y, header: before.header.height, nav: before.nav.height, tabs: before.tabs.map(tab => ({ label: tab.label, x: tab.box.x, width: tab.box.width, height: tab.box.height })), panel: before.panel.height, actions: before.actions.height };
      if (key === "profile") {
        t.diagnostic(`${width}×${height} Paramètres Profil: ${JSON.stringify(positions.profile)}`);
      } else t.diagnostic(`${width}×${height} Paramètres Sécurité: ${JSON.stringify(positions.security)}`);
    }
    assert.ok(Math.abs(positions.profile.height - positions.security.height) < 0.5);
    await page.locator('[data-settings-tab="profile"]').focus();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#profileDialog").evaluate(dialog => dialog.open), false, "Paramètres fermable avec Escape");
  } finally {
    await context.close();
  }
}

async function testDesktopUnchanged(browser, server, width, height, t) {
  const { context, page } = await createPage(browser, server, width, height);
  try {
    for (const id of ["taskDialog", "familyDetailsDialog", "profileDialog"]) {
      await t.test(`${width}×${height} : ${id} inchangée sur desktop`, async () => {
        await showDialog(page, id, "edit");
        const withClasses = id === "profileDialog" ? await measureProfile(page) : await measureFormDialog(page, id);
        await page.locator(`#${id}`).evaluate(dialog => dialog.classList.remove("modal-mobile-sheet", "modal-mobile-sheet--form", "modal-mobile-sheet--stable"));
        await page.locator(`#${id}`).evaluate(dialog => dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
        await page.waitForTimeout(170);
        const withoutClasses = id === "profileDialog" ? await measureProfile(page) : await measureFormDialog(page, id);
        assert.deepEqual(withClasses, withoutClasses, `dimensions et défilement de ${id} identiques avec/sans variantes mobiles`);
        await page.locator(`#${id}`).evaluate(dialog => dialog.close());
        await page.locator(`#${id}`).evaluate(dialog => {
          dialog.classList.add("modal-mobile-sheet");
          dialog.classList.add(dialog.id === "profileDialog" ? "modal-mobile-sheet--stable" : "modal-mobile-sheet--form");
        });
      });
    }
  } finally { await context.close(); }
}

async function testPersonRelationReturn(browser, server, t) {
  const { context, page } = await createPage(browser, server, 390, 844);
  try {
    await page.evaluate(() => {
      const personDialog = document.getElementById("personDialog");
      document.getElementById("personId").value = "fixture-person";
      document.getElementById("firstName").value = "Brouillon non enregistré";
      document.querySelectorAll("[data-person-panel]").forEach(panel => { panel.hidden = panel.dataset.personPanel !== "relations"; });
      document.querySelectorAll("[data-person-section]").forEach(tab => {
        const selected = tab.dataset.personSection === "relations";
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
      });
      personDialog.showModal();
      personDialog.getBoundingClientRect();
      personDialog.getAnimations({ subtree: true }).forEach(animation => animation.finish());
    });
    await page.waitForTimeout(80);
    const personBefore = await page.locator("#personDialog").evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return { open: dialog.open, height: rect.height, y: rect.y, draft: document.getElementById("firstName").value, section: document.querySelector('[data-person-section="relations"]').getAttribute("aria-selected") };
    });
    assert.ok(Math.abs(personBefore.height - 844 * 0.92) < 1, "Fiche Personne garde sa hauteur fixe de 92dvh");

    await page.locator("#personDialog").evaluate(dialog => dialog.close());
    await showDialog(page, "familyDetailsDialog", "edit");
    const relation = await measureFormDialog(page, "familyDetailsDialog");
    assert.ok(relation.open, "Détails de la relation s’ouvre après Personne");
    assert.ok(relation.dialog.y > 0 && relation.dialog.height <= 844 * 0.86 + 1, "Relation conserve sa géométrie de sheet adaptative");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#familyDetailsDialog").evaluate(dialog => dialog.open), false);

    await page.locator("#personDialog").evaluate(dialog => {
      dialog.showModal();
      dialog.getBoundingClientRect();
      dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish());
    });
    const personAfter = await page.locator("#personDialog").evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return { open: dialog.open, height: rect.height, y: rect.y, draft: document.getElementById("firstName").value, section: document.querySelector('[data-person-section="relations"]').getAttribute("aria-selected") };
    });
    assert.deepEqual(personAfter, personBefore, "retour Personne conserve le brouillon, l’onglet Relations et les 92dvh");
    t.diagnostic(`Personne→Relation→Personne 390×844: ${JSON.stringify({ person: personBefore, relation: { height: relation.dialog.height, maxHeight: relation.maxHeight, band: relation.dialog.y } })}`);
  } finally { await context.close(); }
}

test("Lot 2 : Action, Relation et Paramètres en sheets mobiles", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium Playwright indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const [width, height] of mobileViewports) {
      await t.test(`${width}×${height} : Action création, formulaire court`, async child => checkFormSheet(browser, server, "taskDialog", width, height, "create", child, true));
      await t.test(`${width}×${height} : Action édition longue`, async child => {
        const { context, page } = await createPage(browser, server, width, height);
        try {
          await showDialog(page, "taskDialog", "edit");
          await addLongFormContent(page, "#taskDialog .modal-scroll");
          const before = await measureFormDialog(page, "taskDialog");
          const plafond = height * 0.86;
          assert.ok(Math.abs(before.dialog.height - plafond) < 1);
          assert.ok(before.scroll.scrollHeight > before.scroll.clientHeight);
          assert.equal(await page.locator("#taskMenuBtn").isVisible(), true, "menu d’édition ⋯ conservé");
          await page.locator("#taskDialog .modal-scroll").evaluate(scroller => { scroller.scrollTop = 220; });
          const after = await measureFormDialog(page, "taskDialog");
          assert.ok(after.scroll.scrollTop > 0);
          assert.deepEqual(after.header, before.header);
          assert.deepEqual(after.footer, before.footer);
          assert.ok(before.footerPaddingBottom >= 12);
          assert.equal(after.pageOverflow, 0);
        } finally { await context.close(); }
      });
      await t.test(`${width}×${height} : Détails de la relation, contenu court`, async child => checkFormSheet(browser, server, "familyDetailsDialog", width, height, "edit", child, true));
    }
    for (const [width, height] of profileViewports) await t.test(`${width}×${height} : Paramètres, Profil et Sécurité`, async child => checkProfile(browser, server, width, height, child));
    for (const [width, height] of desktopViewports) await testDesktopUnchanged(browser, server, width, height, t);
    await testPersonRelationReturn(browser, server, t);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("Lot 2 : le retour Relation conserve le brouillon et l’onglet Personne existants", () => {
  assert.match(appSource, /familyDetailsReturnContext = \{ personId: activeId, source: personDialogSource, draft: capturePersonDraft\(\) \}[\s\S]*?\$\("personDialog"\)\.close\(\);\s*\$\("familyDetailsDialog"\)\.showModal\(\)/);
  assert.match(appSource, /function returnFromFamilyDetails\(\) \{[\s\S]*?openPerson\(item, context\.source\);\s*restorePersonDraft\(context\.draft\);\s*setPersonSection\("relations"\)/);
  assert.match(appSource, /\$\("familyDetailsDialog"\)\.addEventListener\("close", \(\) => \{ if \(familyDetailsReturnContext\) returnFromFamilyDetails\(\); \}\)/);
  assert.match(appSource, /async function saveFamilyDetails\(event\) \{[\s\S]*?\$\("familyDetailsDialog"\)\.close\(\);[\s\S]*?returnFromFamilyDetails\(\)/);
  assert.match(appSource, /document\.querySelectorAll\("\[data-settings-tab\]"\)\.forEach\(button => \{\s*button\.onclick = \(\) => selectSettingsTab\(button\.dataset\.settingsTab\)/);
});
