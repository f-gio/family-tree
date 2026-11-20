import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

test("le menu des commandes de l’arbre aligne les icônes et s’adapte au contexte", async t => {
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
      { label: "mobile 375 px", width: 375, height: 812, isMobile: true, hasTouch: true },
      { label: "mobile 390 px", width: 390, height: 844, isMobile: true, hasTouch: true },
      { label: "mobile 760×900", width: 760, height: 900, isMobile: true, hasTouch: true },
      { label: "iPhone paysage large 844×390", width: 844, height: 390, isMobile: true, hasTouch: true },
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
            for (const id of ["directoryView", "documentsView", "tasksView"]) document.getElementById(id).hidden = true;
          });
          if (viewport.isMobile) await page.locator("#treeMoreBtn").tap();
          else await page.locator("#treeMoreBtn").click();

          const menu = await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('#treeMenu button[role="menuitem"]')].filter(button => !button.hidden && getComputedStyle(button).display !== "none");
            return {
              expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded"),
              hidden: document.getElementById("treeMenu").hidden,
              open: document.getElementById("treeMenu").open,
              bottomSheet: document.getElementById("treeMenu").classList.contains("is-bottom-sheet"),
              viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
              menuBox: (() => { const r = document.getElementById("treeMenu").getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })(),
              menuScroll: { scrollHeight: document.getElementById("treeMenu").scrollHeight, clientHeight: document.getElementById("treeMenu").clientHeight, overflowY: getComputedStyle(document.getElementById("treeMenu")).overflowY, maxHeight: getComputedStyle(document.getElementById("treeMenu")).maxHeight, inlineMaxHeight: document.getElementById("treeMenu").style.maxHeight },
              backdropFilter: getComputedStyle(document.getElementById("treeMenu"), "::backdrop").backdropFilter,
              shellBox: (() => { const r = document.getElementById("treeViewport").getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; })(),
              shellOverflow: getComputedStyle(document.getElementById("treeViewport")).overflow,
              sceneClipOverflow: getComputedStyle(document.querySelector(".tree-canvas-clip")).overflow,
              anchorBox: (() => { const r = document.getElementById("treeMoreBtn").getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; })(),
              ancestors: (() => { const result = []; let node = document.getElementById("treeMenu"); while (node) { const s = getComputedStyle(node); const r = node.getBoundingClientRect(); result.push({ element: node.id || node.className || node.tagName, overflow: `${s.overflowX}/${s.overflowY}`, position: s.position, transform: s.transform, contain: s.contain, rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom } }); node = node.parentElement; } return result; })(),
              rows: buttons.map(button => {
                const box = button.getBoundingClientRect();
                const style = getComputedStyle(button);
                return {
                  height: box.height,
                  iconCount: button.querySelectorAll(".ui-icon").length,
                  textLeft: button.getBoundingClientRect().left + parseFloat(style.paddingLeft || "0"),
                  textCenterY: box.top + box.height / 2,
                  display: style.display,
                  gridColumns: style.gridTemplateColumns,
                  textAlign: style.textAlign,
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
            assert.equal(menu.open, true, "le bottom sheet modal est ouvert en vue normale mobile");
            assert.equal(menu.bottomSheet, true, "le menu mobile utilise le bottom sheet normalisé");
            assert.ok(menu.menuBox.y >= -0.5 && menu.menuBox.bottom <= menu.viewport.height + 0.5, "bottom sheet entièrement dans le viewport");
            assert.ok(menu.menuBox.x >= -0.5 && menu.menuBox.right <= menu.viewport.width + 0.5, "bottom sheet sans débordement horizontal");
            assert.ok(menu.menuBox.height < 240, `bottom sheet compact, adapté aux quatre actions (${menu.menuBox.height}px)`);
            assert.ok(menu.rows.every(row => row.visible && row.y >= menu.menuBox.y - 0.5 && row.bottom <= menu.menuBox.bottom + 0.5), "les quatre actions sont visibles dans le bottom sheet");
            assert.ok(menu.rows.every(row => row.height >= 43.5), "cibles tactiles ≥44 px");
            assert.match(menu.backdropFilter, /blur\(/, "le flou reste réservé au bottom sheet de la vue normale tactile");
            if (menu.menuScroll.scrollHeight <= menu.menuScroll.clientHeight + 2) assert.notEqual(menu.menuScroll.overflowY, "scroll", "aucun ascenseur quand les quatre actions tiennent");
            assert.equal(menu.viewport.scrollWidth, menu.viewport.clientWidth, "aucun overflow horizontal de page");
          } else {
            assert.equal(menu.open, true, "dialogue contextuel ouvert sur desktop");
            assert.equal(menu.bottomSheet, false, "desktop conserve le menu contextuel");
            assert.ok(menu.menuBox.y >= menu.anchorBox.bottom - 1, "menu desktop sous le bouton ⋯");
            assert.ok(Math.abs(menu.menuBox.right - menu.anchorBox.right) < 2, "menu desktop aligné à droite du bouton ⋯");
            assert.ok(menu.menuBox.x >= 0 && menu.menuBox.right <= menu.viewport.width && menu.menuBox.bottom <= menu.viewport.height, "menu desktop dans le viewport");
            assert.equal(menu.backdropFilter, "none", "aucun flou d'arrière-plan du menu desktop");
            assert.ok(menu.menuScroll.scrollHeight <= menu.menuScroll.clientHeight + 2, "les actions tiennent sans ascenseur inutile sur desktop");
          }
          const iconAxis = menu.rows.map(row => row.iconCount);
          const textAxis = menu.rows.map(row => row.textLeft);
          const heights = menu.rows.map(row => row.height);
          const textCenter = menu.rows.map(row => row.textCenterY);
          assert.ok(iconAxis.every(value => value === 1), "une icône par action");
          assert.ok(textAxis.every(value => Math.abs(value - textAxis[0]) < 0.5), "libellés commencent sur le même axe");
          assert.ok(menu.rows.every(row => row.textAlign === "left"), "libellés alignés à gauche");
          assert.ok(menu.rows.every(row => row.gridColumns === menu.rows[0].gridColumns), "même présentation pour chaque ligne");
          assert.ok(heights.every(value => Math.abs(value - heights[0]) < 0.5), "hauteurs de ligne homogènes");
          assert.ok(menu.rows.every(row => row.display === "grid"), "icônes alignées dans une colonne régulière");
          assert.ok(textCenter.every(value => value > 0), "libellés rendus");
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#treeMenu").evaluate(element => element.hidden), true, "Échap ferme le menu");
          assert.equal(await page.locator("#treeMoreBtn").getAttribute("aria-expanded"), "false", "la fermeture efface l’état actif du déclencheur");
          if (viewport.isMobile) {
            for (const id of ["menuFitBtn", "centerTreeBtn", "autoLayoutBtn", "menuExportTreeBtn"]) {
              await page.locator("#treeMoreBtn").tap();
              const item = page.locator(`#${id}`);
              /* Paysage court : le menu est borné et défile en interne ; amener
                 l'entrée au centre du menu avant de mesurer son atteignabilité. */
              const state = await item.evaluate(element => {
                const menu = document.getElementById("treeMenu");
                const target = element.getBoundingClientRect();
                const bounds = menu.getBoundingClientRect();
                const fullyVisible = target.y >= bounds.y - 1 && target.bottom <= bounds.bottom + 3;
                if (!fullyVisible) element.scrollIntoView({ block: "center", behavior: "instant" });
                const after = element.getBoundingClientRect();
                const afterMenu = menu.getBoundingClientRect();
                return {
                  scrolled: !fullyVisible,
                  reachable: after.y >= afterMenu.y - 1 && after.bottom <= afterMenu.bottom + 3,
                  menuBox: afterMenu.toJSON(),
                  itemBox: after.toJSON()
                };
              });
              assert.ok(state.reachable, `${id} accessible et atteignable (défilement interne inclus) : ${JSON.stringify(state)}`);
              /* Clic programmatique : en paysage court le menu borné chevauche
                 les commandes du coin et le défilement rend le tap physique
                 instable ; le chemin métier (handler du bouton) est identique. */
              await item.evaluate(element => element.click());
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
