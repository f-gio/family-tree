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
      { label: "mobile 390 px", width: 390, height: 844, isMobile: true, hasTouch: true },
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
                  textAlign: getComputedStyle(button.querySelector("span")).textAlign
                };
              })
            };
          });
          assert.equal(menu.hidden, false, "menu des contrôles ouvert");
          assert.equal(menu.expanded, "true");
          assert.ok(menu.rows.length >= 3, "actions usuelles présentes");
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
