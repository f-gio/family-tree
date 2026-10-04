import assert from "node:assert/strict";
import test from "node:test";
import { webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

test("le compteur de l’Annuaire et le contrôle de l’arbre partagent une ligne alignée", async t => {
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (error) {
    throw new Error(`WebKit indisponible : ${error.message}`);
  }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({
    locale: "fr-FR",
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 }
  });
  await context.route("**/*", route => route.request().url().startsWith(server.baseURL)
    ? route.continue()
    : route.abort("blockedbyclient"));
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    for (const width of [320, 390, 760, 1024]) {
      await t.test(`${width} px`, async tViewport => {
        await page.setViewportSize({ width, height: width <= 390 ? 844 : width === 760 ? 900 : 768 });
        const measure = await page.evaluate(() => {
          document.getElementById("authScreen").hidden = true;
          document.getElementById("topbar").hidden = false;
          for (const id of ["appMain", "documentsView", "tasksView", "dossiersView"]) document.getElementById(id).hidden = true;
          document.getElementById("directoryView").hidden = false;
          document.getElementById("directoryResultCount").textContent = "79 personnes";
          document.getElementById("treeQualityBtn").textContent = "Contrôle de l’arbre · 56";
          const row = document.querySelector(".directory-results-meta");
          const count = document.getElementById("directoryResultCount");
          const control = document.getElementById("treeQualityBtn");
          const box = element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              right: rect.right, bottom: rect.bottom,
              fontSize: style.fontSize, lineHeight: style.lineHeight,
              display: style.display, alignItems: style.alignItems
            };
          };
          const rowStyle = getComputedStyle(row);
          const toolbar = document.querySelector(".directory-toolbar").getBoundingClientRect();
          const alphabet = document.getElementById("directoryAlphabet").getBoundingClientRect();
          return {
            row: { ...box(row), flexWrap: rowStyle.flexWrap, justifyContent: rowStyle.justifyContent, gap: rowStyle.gap, topGap: row.getBoundingClientRect().top - toolbar.bottom, bottomGap: alphabet.top - row.getBoundingClientRect().bottom },
            count: box(count),
            control: box(control),
            sameParent: count.parentElement === control.parentElement,
            text: [count.textContent, control.textContent],
            overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }
          };
        });
        tViewport.diagnostic(JSON.stringify(measure));
        assert.equal(measure.sameParent, true, "les deux informations partagent le conteneur de ligne");
        assert.deepEqual(measure.text, ["79 personnes", "Contrôle de l’arbre · 56"], "libellés et compteurs inchangés");
        assert.equal(measure.row.display, "flex");
        assert.equal(measure.row.alignItems, "center");
        assert.equal(measure.row.justifyContent, "space-between");
        assert.equal(measure.count.lineHeight, measure.control.lineHeight, "line-height cohérent");
        assert.ok(Math.abs((measure.count.y + measure.count.height / 2) - (measure.control.y + measure.control.height / 2)) < 1, "centres verticaux alignés");
        assert.ok(measure.control.right <= measure.row.right + 0.1, "le contrôle reste dans la ligne");
        assert.ok(measure.overflow.scrollWidth <= measure.overflow.clientWidth, "aucun débordement horizontal");
        if (width <= 760) assert.equal(measure.row.flexWrap, "nowrap", "les informations restent sur la même rangée mobile");
        else assert.ok(measure.count.x < measure.control.x && Math.abs(measure.control.right - measure.row.right) < 0.1, "compteur à gauche, contrôle à droite");
      });
    }
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
