import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startStaticServer, isAllowedRequest, blockedServiceFor, ROOT } from "./helpers.mjs";

test("clic sur Effacer Arbre vide la recherche et masque le bouton", async () => {
  const browser = await chromium.launch({ headless: true });
  const server = await startStaticServer(ROOT);
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport, locale: "fr-FR" });
      await page.route("**/*", route => {
        const url = route.request().url();
        if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
        if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
        return route.continue().catch(() => {});
      });
      await page.goto(server.baseURL, { waitUntil: "load" });
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        const set = (id, hidden) => {
          const element = document.getElementById(id);
          if (element) element.hidden = hidden;
        };
        set("authScreen", true);
        set("topbar", false);
        set("appMain", false);
        set("directoryView", true);
        set("documentsView", true);
        set("tasksView", true);
      });
      await page.evaluate(() => {
        const input = document.getElementById("search");
        input.value = "H";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const before = await page.evaluate(() => ({
        value: document.getElementById("search").value,
        visible: document.getElementById("clearTreeSearchBtn").classList.contains("is-visible")
      }));
      assert.deepEqual(before, { value: "H", visible: true });

      await page.evaluate(() => document.getElementById("clearTreeSearchBtn").click());
      const after = await page.evaluate(() => ({
        value: document.getElementById("search").value,
        visible: document.getElementById("clearTreeSearchBtn").classList.contains("is-visible"),
        display: getComputedStyle(document.getElementById("clearTreeSearchBtn")).display,
        focused: document.activeElement?.id === "search"
      }));
      assert.deepEqual(after, { value: "", visible: false, display: "none", focused: true });
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
});
