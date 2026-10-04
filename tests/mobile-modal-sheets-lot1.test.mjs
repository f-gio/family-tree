import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const mobileWidths = [320, 390, 760];
const desktopViewports = [[761, 760], [1024, 768]];

async function launchOrSkip(engine, t, label) {
  try {
    return await engine.launch({ headless: true });
  } catch (error) {
    await t.test(label, child => child.skip(`Navigateur indisponible : ${error.message}`));
    return null;
  }
}

async function makePage(browser, server, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "fr-FR",
    isMobile: width <= 760,
    hasTouch: width <= 760
  });
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
    for (const id of ["directoryView", "documentsView", "tasksView", "dossiersView"]) {
      document.getElementById(id).hidden = id !== "appMain";
    }
  });
  return { context, page };
}

async function measureDialog(page, id) {
  return page.evaluate(dialogId => {
    const dialog = document.getElementById(dialogId);
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const body = dialog.querySelector(":scope > .modal-body");
    const header = dialog.querySelector(":scope > .modal-head");
    const footer = dialog.querySelector(":scope > .modal-actions");
    const style = getComputedStyle(dialog);
    const bodyStyle = body ? getComputedStyle(body) : null;
    const bottomPadding = bodyStyle ? parseFloat(bodyStyle.paddingBottom) : 0;
    const footerRect = footer?.getBoundingClientRect();
    const footerButton = footer?.querySelector("button:not([hidden])");
    const footerButtonRect = footerButton?.getBoundingClientRect();
    return {
      dialog: box(dialog),
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
      background: style.backgroundColor,
      position: style.position,
      maxHeight: style.maxHeight,
      body: body ? {
        box: box(body), overflowY: bodyStyle.overflowY, overflowX: bodyStyle.overflowX,
        scrollbarWidth: bodyStyle.scrollbarWidth,
        webkitScrollbarDisplay: getComputedStyle(body, "::-webkit-scrollbar").display,
        scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
        scrollTop: body.scrollTop, paddingBottom: bottomPadding
      } : null,
      header: header ? box(header) : null,
      footer: footer ? box(footer) : null,
      footerButton: footerButtonRect ? {
        x: footerButtonRect.x, right: footerButtonRect.right, width: footerButtonRect.width,
        y: footerButtonRect.y, bottom: footerButtonRect.bottom, height: footerButtonRect.height,
        safeAreaClearance: dialog.getBoundingClientRect().bottom - footerButtonRect.bottom
      } : null,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  }, id);
}

async function settleDialogAnimation(page, id) {
  await page.evaluate(dialogId => {
    const dialog = document.getElementById(dialogId);
    dialog.getBoundingClientRect();
    dialog.getAnimations().forEach(animation => animation.finish());
  }, id);
  await page.waitForTimeout(60);
}

async function openDialog(page, id) {
  await page.evaluate(dialogId => {
    for (const candidate of ["treeExportDialog", "dataDialog", "directoryDocumentsDialog"]) {
      const dialog = document.getElementById(candidate);
      if (dialog.open) dialog.close();
    }
    document.getElementById(dialogId).showModal();
  }, id);
  await settleDialogAnimation(page, id);
  await page.waitForTimeout(120);
}

async function tapControl(page, selector) {
  const control = page.locator(selector);
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `${selector} visible pour le tap`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function testMobileViewport(browser, server, width, height, t) {
  const { context, page } = await makePage(browser, server, width, height);
  try {
    await t.test(`${width}×${height} : export compact`, async () => {
      await openDialog(page, "treeExportDialog");
      const measured = await measureDialog(page, "treeExportDialog");
      t.diagnostic(JSON.stringify(measured));
      assert.ok(Math.abs(measured.dialog.bottom - height) < 1, "panneau au bord inférieur du viewport");
      assert.ok(measured.dialog.y > height * 0.22, "la page Arbre reste largement visible");
      assert.ok(measured.dialog.height < height * 0.72, "hauteur pilotée par le contenu, non par le plafond");
      assert.ok(measured.dialog.height < parseFloat(measured.maxHeight), "plafond de sécurité sans hauteur artificielle");
      assert.ok(parseFloat(measured.maxHeight) <= height * 0.72 + 1, "plafond compact réellement à 72dvh");
      assert.deepEqual(measured.radii, ["22px", "22px", "0px", "0px"], "coins supérieurs arrondis uniquement");
      assert.equal(measured.body.overflowY, "auto", "aucun contenu perdu si le viewport est court");
      assert.equal(measured.body.scrollbarWidth, "none");
      assert.equal(measured.body.webkitScrollbarDisplay, "none");
      assert.equal(await page.locator("#treeExportDialog [data-export-format]").count(), 2, "choix PNG et SVG conservés");
      assert.ok(measured.footerButton && measured.footerButton.height >= 43.5, "Annuler reste accessible au-dessus de la zone sûre");
      assert.ok(Math.abs((measured.footerButton.x + measured.footerButton.width / 2) - width / 2) < 1, "Annuler centré horizontalement dans le footer");
      assert.ok(measured.footerButton.width < width * 0.8, "Annuler garde une largeur de bouton, sans s’étirer en pleine largeur");
      assert.equal(measured.pageOverflow, 0, "aucun overflow horizontal");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#treeExportDialog").evaluate(dialog => dialog.open), false, "Escape ferme le dialog");
    });

    await t.test(`${width}×${height} : données medium`, async () => {
      await openDialog(page, "dataDialog");
      const measured = await measureDialog(page, "dataDialog");
      t.diagnostic(JSON.stringify(measured));
      assert.ok(Math.abs(measured.dialog.bottom - height) < 1, "panneau au bord inférieur");
      assert.ok(measured.dialog.y > 0, "une bande de page reste visible");
      assert.ok(measured.dialog.height <= height * 0.78 + 1, "hauteur naturelle plafonnée à 78dvh");
      assert.ok(parseFloat(measured.maxHeight) <= height * 0.78 + 1, "plafond medium réellement à 78dvh");
      assert.deepEqual(measured.radii, ["22px", "22px", "0px", "0px"]);
      assert.equal(measured.body.overflowY, "auto");
      assert.equal(measured.body.scrollbarWidth, "none");
      assert.equal(measured.body.webkitScrollbarDisplay, "none");
      assert.ok(measured.body.paddingBottom >= 16, "zone de sécurité bas conservée dans le contenu scrollable");
      assert.equal(await page.locator("#dataDialog #exportBtn").count(), 1, "action sauvegarde présente");
      assert.equal(await page.locator("#dataDialog #importBtn").count(), 1, "action restauration présente");
      assert.equal(measured.pageOverflow, 0);
      if (measured.body.scrollHeight <= measured.body.clientHeight) {
        assert.ok(measured.dialog.height < parseFloat(measured.maxHeight), "contenu court garde une hauteur naturelle sous le plafond");
        await page.locator("#dataDialog .data-note").evaluate(note => { note.textContent = `${note.textContent} ${"Détail de sauvegarde. ".repeat(180)}`; });
      }
      await page.evaluate(() => { document.querySelector("#dataDialog .modal-body").scrollTop = 60; });
      assert.ok(await page.locator("#dataDialog .modal-body").evaluate(body => body.scrollHeight > body.clientHeight && body.scrollTop > 0), "un contenu long défile sans scrollbar visible");
      await page.locator('#dataDialog [data-close="dataDialog"]').click();
      assert.equal(await page.locator("#dataDialog").evaluate(dialog => dialog.open), false, "fermeture existante conservée");
    });

    for (const count of [1, 28]) {
      await t.test(`${width}×${height} : documents associés ${count === 1 ? "courte" : "longue"} liste`, async () => {
        await page.evaluate(rowCount => {
          const list = document.getElementById("directoryDocumentsList");
          list.innerHTML = Array.from({ length: rowCount }, (_, index) => `<div class="directory-document-item"><div><strong>Acte familial ${index + 1}</strong><small>Acte de naissance</small></div><button class="btn small primary" type="button" data-view-directory-document="document-${index}">Consulter</button></div>`).join("");
          document.getElementById("directoryDocumentsDialog").showModal();
        }, count);
        await settleDialogAnimation(page, "directoryDocumentsDialog");
        const measured = await measureDialog(page, "directoryDocumentsDialog");
        t.diagnostic(`${width}px documents=${count} ${JSON.stringify(measured)}`);
        assert.ok(Math.abs(measured.dialog.bottom - height) < 1, "panneau au bord inférieur");
        assert.deepEqual(measured.radii, ["22px", "22px", "0px", "0px"]);
        assert.equal(measured.body.overflowY, "auto");
        assert.equal(measured.body.scrollbarWidth, "none");
        assert.equal(measured.body.webkitScrollbarDisplay, "none");
        assert.equal(measured.pageOverflow, 0);
        if (count === 1) {
          assert.ok(measured.dialog.height < height * 0.4, "liste courte conserve un panneau compact, sans hauteur réservée");
          assert.equal(measured.body.scrollHeight, measured.body.clientHeight, "liste courte sans scroll superflu");
        } else {
          assert.ok(measured.dialog.height <= height * 0.78 + 1, "liste longue plafonnée à 78dvh");
          assert.ok(measured.dialog.y > 0, "la page reste visible au-dessus du panneau long");
          assert.ok(measured.body.scrollHeight > measured.body.clientHeight, "la longue liste défile dans son corps");
          await page.evaluate(() => { document.querySelector("#directoryDocumentsDialog .modal-body").scrollTop = 90; });
          assert.ok(await page.locator("#directoryDocumentsDialog .modal-body").evaluate(body => body.scrollTop > 0), "la scrollbar masquée n’empêche pas le scroll tactile");
        }
        assert.equal(await page.locator("#directoryDocumentsList [data-view-directory-document]").count(), count, "actions Consulter conservées");
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#directoryDocumentsDialog").evaluate(dialog => dialog.open), false, "Escape ferme le dialog");
      });
    }
  } finally {
    await context.close();
  }
}

async function testDesktopUnchanged(browser, server, width, height, t) {
  const { context, page } = await makePage(browser, server, width, height);
  try {
    for (const id of ["treeExportDialog", "dataDialog", "directoryDocumentsDialog"]) {
      await t.test(`${width}×${height} : ${id} desktop inchangé par les variantes mobile`, async () => {
        await openDialog(page, id);
        const withVariant = await measureDialog(page, id);
        await page.locator(`#${id}`).evaluate(dialog => {
          dialog.classList.remove("modal-mobile-sheet", "modal-mobile-sheet--compact", "modal-mobile-sheet--medium");
        });
        await page.waitForTimeout(200);
        const withoutVariant = await measureDialog(page, id);
        assert.deepEqual(withVariant.dialog, withoutVariant.dialog, "géométrie desktop identique avec/sans classes sheet");
        assert.deepEqual(withVariant.radii, withoutVariant.radii, "rayons desktop identiques");
        assert.equal(withVariant.background, withoutVariant.background, "surface desktop identique");
        assert.deepEqual(withVariant.footerButton, withoutVariant.footerButton, "position et dimensions desktop du bouton Annuler identiques");
        assert.equal(withVariant.pageOverflow, 0);
        await page.locator(`#${id}`).evaluate(dialog => dialog.close());
        await page.locator(`#${id}`).evaluate(dialog => dialog.classList.add("modal-mobile-sheet"));
        if (id === "treeExportDialog") await page.locator(`#${id}`).evaluate(dialog => dialog.classList.add("modal-mobile-sheet--compact"));
        else await page.locator(`#${id}`).evaluate(dialog => dialog.classList.add("modal-mobile-sheet--medium"));
      });
    }
  } finally {
    await context.close();
  }
}

test("Lot 1 : bottom sheets ciblés, défilement sûr mobile et desktop inchangé", async t => {
  const chromiumBrowser = await launchOrSkip(chromium, t, "Lot 1 Chrome");
  const webkitBrowser = await launchOrSkip(webkit, t, "Lot 1 WebKit tactile");
  if (!chromiumBrowser && !webkitBrowser) return;
  const server = await startStaticServer(ROOT);
  try {
    if (chromiumBrowser) {
      for (const [width, height] of [[320, 568], [390, 844], [760, 900]]) {
        await testMobileViewport(chromiumBrowser, server, width, height, t);
      }
      for (const [width, height] of desktopViewports) await testDesktopUnchanged(chromiumBrowser, server, width, height, t);
    }
    if (webkitBrowser) {
      for (const [width, height] of [[320, 568], [390, 844], [760, 900]]) {
        await t.test(`WebKit tactile ${width}×${height} : footer et zone sûre`, async () => {
          const { context, page } = await makePage(webkitBrowser, server, width, height);
          try {
            await openDialog(page, "treeExportDialog");
            const measured = await measureDialog(page, "treeExportDialog");
            assert.equal(measured.body.overflowY, "auto");
            assert.equal(measured.body.scrollbarWidth, "none");
            assert.equal(measured.body.webkitScrollbarDisplay, "none");
            assert.ok(measured.footerButton && measured.footerButton.height >= 43.5);
            assert.ok(measured.footerButton.safeAreaClearance >= 0, "Annuler reste au-dessus du bord inférieur et de la zone sûre");
            assert.ok(Math.abs(measured.dialog.bottom - height) < 1);
            await tapControl(page, '#treeExportDialog .modal-actions [data-close="treeExportDialog"]');
            assert.equal(await page.locator("#treeExportDialog").evaluate(dialog => dialog.open), false);
          } finally {
            await context.close();
          }
        });
      }
    }
  } finally {
    await chromiumBrowser?.close();
    await webkitBrowser?.close();
    await server.close();
  }
});

test("Lot 1 : l’ouverture de Consulter garde le handler DocumentViewer", () => {
  assert.match(appSource, /const button = event\.target\.closest\("\[data-view-directory-document\]"\);[\s\S]*?openStoredDocument\(documents\.find\(item => item\.id === button\.dataset\.viewDirectoryDocument\)\)/);
  assert.match(appSource, /\$\("documentViewerDialog"\)\.showModal\(\)/);
});
