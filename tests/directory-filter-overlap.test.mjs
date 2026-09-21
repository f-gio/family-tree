import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startStaticServer, isAllowedRequest, blockedServiceFor, ROOT } from "./helpers.mjs";

const root = new URL("../", import.meta.url);
const app = await readFile(new URL("js/app.js", root), "utf8");

test("invariant superposition mobile : panel > summary > backdrop", async () => {
  const browser = await chromium.launch({ headless: true });
  const server = await startStaticServer(ROOT);
  try {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 430, height: 900 },
      { width: 1440, height: 900 }
    ]) {
      const isMobile = viewport.width <= 430;
      const page = await browser.newPage({ viewport, locale: "fr-FR", hasTouch: isMobile });
      await page.route("**/*", route => {
        const url = route.request().url();
        if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
        if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
        return route.continue().catch(() => {});
      });
      await page.goto(server.baseURL, { waitUntil: "load" });
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        const set = (id, hidden) => {
          const element = document.getElementById(id);
          if (element) element.hidden = hidden;
        };
        set("authScreen", true);
        set("topbar", false);
        set("appMain", false);
        set("directoryView", false);
        set("documentsView", true);
        set("tasksView", true);
      });
      await page.waitForTimeout(200);

      // Panneau fermé : le summary reste dans le flux et cliquable.
      await page.click("#directoryFilterMenu summary");
      let open = await page.evaluate(() => document.getElementById("directoryFilterMenu").open);
      assert.ok(open, "menu Filtres ouvert");

      const styles = await page.evaluate(() => {
        const details = document.getElementById("directoryFilterMenu");
        const summary = details.querySelector("summary");
        const panel = details.querySelector(".directory-filter-panel");
        const before = getComputedStyle(details, "::before");
        return {
          menu: { position: getComputedStyle(details).position },
          summary: { position: getComputedStyle(summary).position, zIndex: getComputedStyle(summary).zIndex, display: getComputedStyle(summary).display },
          panel: { position: getComputedStyle(panel).position, zIndex: getComputedStyle(panel).zIndex, bottom: getComputedStyle(panel).bottom, maxHeight: getComputedStyle(panel).maxHeight, overflowY: getComputedStyle(panel).overflowY },
          backdrop: { position: before.position, zIndex: before.zIndex, content: before.content, pointerEvents: before.pointerEvents }
        };
      });

      const tag = `@ ${viewport.width}px`;
      if (isMobile) {
        assert.equal(styles.panel.position, "fixed", `panneau mobile fixed ${tag}`);
        assert.equal(styles.menu.position, "static", `details mobile sans restructuration ${tag}`);
        const panelZ = Number(styles.panel.zIndex);
        const summaryZ = Number(styles.summary.zIndex || 0);
        const backdropZ = Number(styles.backdrop.zIndex || 0);
        assert.ok(panelZ > summaryZ, `PANEL > SUMMARY (${panelZ} > ${summaryZ}) ${tag}`);
        assert.ok(summaryZ > backdropZ, `SUMMARY > BACKDROP (${summaryZ} > ${backdropZ}) ${tag}`);
        assert.equal(styles.summary.display, "flex", `summary reste dans la toolbar ${tag}`);
      } else {
        assert.equal(styles.panel.position, "absolute", `panneau desktop non modifié ${tag}`);
      }

      await page.click("#directoryFirstNameFilter");
      const focused = await page.evaluate(() => document.activeElement?.id || "");
      assert.equal(focused, "directoryFirstNameFilter", `champ Identité cliquable ${tag}`);

      await page.click("#clearDirectoryFiltersBtn");
      await page.click("#applyDirectoryFiltersBtn");
      open = await page.evaluate(() => document.getElementById("directoryFilterMenu").open);
      assert.ok(!open, `panneau refermé par 'Afficher les résultats' ${tag}`);
      const summaryRestored = await page.evaluate(() => {
        const summary = document.querySelector("#directoryFilterMenu summary");
        const rect = summary.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      assert.ok(summaryRestored, "summary Filtres visible de nouveau dans la toolbar");
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("aucun handler/JS de fermeture backdrop ajouté", () => {
  assert.doesNotMatch(app, /addEventListener\(["']click["'][^)]{0,120}directoryFilterMenu[^)]*open = false/);
  assert.doesNotMatch(app, /directoryFilterMenu["\]]?[^;]{0,60}pointer-events/i);
});
