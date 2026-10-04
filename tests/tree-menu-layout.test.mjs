import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

test("le menu des contrôles de l’arbre aligne les icônes et les libellés", async t => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    t.skip("Chromium Playwright indisponible");
    return;
  }
  const server = await startStaticServer(ROOT);
  try {
    for (const viewport of [
      { label: "mobile 320×844", width: 320, height: 844, isMobile: true, hasTouch: true },
      { label: "mobile 390 px", width: 390, height: 844, isMobile: true, hasTouch: true },
      { label: "mobile 760×900", width: 760, height: 900, isMobile: true, hasTouch: true },
      { label: "mobile paysage court 390×430", width: 390, height: 430, isMobile: true, hasTouch: true },
      { label: "desktop 1024 px", width: 1024, height: 768, isMobile: false, hasTouch: false }
    ]) {
      await t.test(viewport.label, async () => {
        const context = await browser.newContext({ locale: "fr-FR", viewport, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch });
        await context.route("**/*", route => {
          const url = route.request().url();
          return url.startsWith(server.baseURL) || url.includes("gstatic.com")
            ? route.continue()
            : route.abort("blockedbyclient");
        });
        const page = await context.newPage();
        try {
          await page.goto(server.baseURL, { waitUntil: "load" });
          await page.waitForSelector("#treeMoreBtn", { state: "attached" });
          await page.waitForTimeout(120);
          await page.evaluate(() => {
            document.getElementById("authScreen").hidden = true;
            document.getElementById("topbar").hidden = false;
            document.getElementById("appMain").hidden = false;
            for (const id of ["directoryView", "documentsView", "tasksView", "dossiersView"]) document.getElementById(id).hidden = true;
          });
          if (viewport.isMobile) await page.locator("#treeMoreBtn").tap();
          else await page.locator("#treeMoreBtn").click();

          const menu = await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('#treeMenu button[role="menuitem"]')].filter(button => !button.hidden && getComputedStyle(button).display !== "none");
            return {
              expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded"),
              hidden: document.getElementById("treeMenu").hidden,
              viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
              menuBox: (() => { const r = document.getElementById("treeMenu").getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })(),
              menuScroll: { scrollHeight: document.getElementById("treeMenu").scrollHeight, clientHeight: document.getElementById("treeMenu").clientHeight, overflowY: getComputedStyle(document.getElementById("treeMenu")).overflowY, maxHeight: getComputedStyle(document.getElementById("treeMenu")).maxHeight, inlineMaxHeight: document.getElementById("treeMenu").style.maxHeight },
              shellBox: (() => { const r = document.getElementById("treeViewport").getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; })(),
              shellOverflow: getComputedStyle(document.getElementById("treeViewport")).overflow,
              sceneClipOverflow: getComputedStyle(document.querySelector(".tree-canvas-clip")).overflow,
              anchorBox: (() => { const r = document.getElementById("treeMoreBtn").getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; })(),
              ancestors: (() => { const result = []; let node = document.getElementById("treeMenu"); while (node) { const s = getComputedStyle(node); const r = node.getBoundingClientRect(); result.push({ element: node.id || node.className || node.tagName, overflow: `${s.overflowX}/${s.overflowY}`, position: s.position, transform: s.transform, contain: s.contain, rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom } }); node = node.parentElement; } return result; })(),
              rows: buttons.map(button => {
                const box = button.getBoundingClientRect();
                const icon = button.querySelector(".ui-icon").getBoundingClientRect();
                const text = button.querySelector("span").getBoundingClientRect();
                const style = getComputedStyle(button);
                return {
                  height: box.height,
                  iconCenterX: icon.left + icon.width / 2,
                  iconCenterY: icon.top + icon.height / 2,
                  textLeft: text.left,
                  textCenterY: text.top + text.height / 2,
                  gridColumns: style.gridTemplateColumns,
                  textAlign: getComputedStyle(button.querySelector("span")).textAlign,
                  label: button.textContent.trim(), x: box.x, y: box.y, right: box.right, bottom: box.bottom,
                  visible: box.width > 0 && box.height > 0 && getComputedStyle(button).visibility === "visible"
                };
              })
            };
          });
          assert.equal(menu.hidden, false, "menu des contrôles ouvert");
          t.diagnostic(`${viewport.label}: ${JSON.stringify(menu)}`);
          assert.equal(menu.expanded, "true");
          assert.ok(menu.rows.length >= 3, "actions usuelles présentes");
          if (viewport.isMobile) {
            assert.deepEqual(menu.rows.map(row => row.label), ["Ajuster", "Recentrer", "Réorganiser", "Exporter"], "toutes les entrées du menu sont rendues");
            assert.ok(menu.rows.every(row => row.visible && row.y >= -0.5 && row.bottom <= menu.viewport.height + 0.5), "première et dernière entrées entièrement dans le viewport");
            assert.ok(menu.menuBox.y >= -0.5 && menu.menuBox.bottom <= menu.viewport.height + 0.5, "menu entier visible sans clipping du viewport");
            assert.ok(menu.rows.every(row => row.y >= menu.menuBox.y - 0.5 && row.bottom <= menu.menuBox.bottom + 0.5), "aucune entrée coupée par le conteneur du menu");
            assert.ok(Math.abs(menu.menuBox.right - menu.anchorBox.right) <= 6, "menu conservé près du bouton d’ancrage ⋯");
            assert.equal(menu.menuScroll.scrollHeight, menu.menuScroll.clientHeight, "aucun scroll interne nécessaire aux hauteurs testées");
            assert.equal(menu.shellOverflow, "visible", "le shell laisse le menu sortir du clip du canvas quand il est ouvert");
            assert.equal(menu.sceneClipOverflow, "hidden", "le contenu graphique garde son clipping d’origine");
            assert.equal(menu.viewport.scrollWidth, menu.viewport.clientWidth, "aucun overflow horizontal de page");
          }
          const iconAxis = menu.rows.map(row => row.iconCenterX);
          const textAxis = menu.rows.map(row => row.textLeft);
          const heights = menu.rows.map(row => row.height);
          const iconTextCenter = menu.rows.map(row => Math.abs(row.iconCenterY - row.textCenterY));
          assert.ok(iconAxis.every(value => Math.abs(value - iconAxis[0]) < 0.5), "icônes centrées sur la même colonne");
          assert.ok(textAxis.every(value => Math.abs(value - textAxis[0]) < 0.5), "libellés commencent sur le même axe");
          assert.ok(menu.rows.every(row => row.textAlign === "left"), "libellés alignés à gauche");
          assert.ok(menu.rows.every(row => row.gridColumns === menu.rows[0].gridColumns), "même grille pour chaque ligne");
          assert.ok(heights.every(value => Math.abs(value - heights[0]) < 0.5), "hauteurs de ligne homogènes");
          assert.ok(iconTextCenter.every(value => value < 1), "icônes et libellés centrés verticalement");
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#treeMenu").evaluate(element => element.hidden), true, "Échap ferme le menu");
          if (viewport.isMobile) {
            for (const id of ["menuFitBtn", "centerTreeBtn", "autoLayoutBtn", "menuExportTreeBtn"]) {
              await page.locator("#treeMoreBtn").tap();
              const item = page.locator(`#${id}`);
              const box = await item.boundingBox();
              assert.ok(box && box.width > 0 && box.height > 0 && box.y >= 0 && box.y + box.height <= viewport.height, `${id} accessible et atteignable`);
              await item.tap();
              if (id === "menuExportTreeBtn") {
                assert.equal(await page.locator("#treeExportDialog").evaluate(dialog => dialog.open), true, "Exporter déclenche toujours sa modale");
                await page.keyboard.press("Escape");
              }
              await page.waitForTimeout(60);
            }
          }
        } finally {
          await context.close();
        }
      });
    }
  } finally {
    await browser.close();
    await server.close();
  }
});
