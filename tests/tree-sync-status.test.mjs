import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const html = readFileSync(`${ROOT}/index.html`, "utf8");
const app = readFileSync(`${ROOT}/js/app.js`, "utf8");

test("l’état de synchronisation apparaît sous l’arbre et reste responsive", async t => {
  assert.match(html, /<section class="tree-shell" id="treeViewport">[\s\S]*?<\/section>\s*<div class="status tree-sync-status"[^>]*>[\s\S]*?<span class="dot" id="syncDot"><\/span>\s*<span id="syncText">Connexion à Firebase…<\/span>\s*<\/div>\s*<\/main>/);
  const intro = html.match(/<section\b[^>]*\bclass="[^"]*"[^>]*>[\s\S]*?<\/section>/g)
    ?.find(section => section.match(/^<section\b[^>]*\bclass="([^"]*)"/)?.[1].split(/\s+/).includes("intro"));
  assert.ok(intro);
  assert.doesNotMatch(intro, /syncText|syncDot/);
  assert.match(app, /\$\("syncText"\)\.textContent = "Synchronisé";/);
  assert.match(app, /\$\("syncText"\)\.closest\("\.status"\)\?\.setAttribute\("data-state", "saved"\);/);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    t.skip("Chromium Playwright indisponible");
    return;
  }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext();
  await context.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(server.baseURL) || url.includes("gstatic.com")
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    for (const viewport of [
      { label: "mobile 390 px", width: 390, height: 844 },
      { label: "desktop 1024 px", width: 1024, height: 768 }
    ]) {
      await t.test(viewport.label, async tViewport => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const geometry = await page.evaluate(() => {
          document.getElementById("authScreen").hidden = true;
          document.getElementById("topbar").hidden = false;
          document.getElementById("appMain").hidden = false;
          const status = document.querySelector("#appMain .tree-sync-status");
          const shell = document.getElementById("treeViewport");
          const controls = document.querySelector(".tree-controls");
          const rect = element => {
            const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
            return { x, y, width, height, right, bottom };
          };
          return {
            inIntro: Boolean(status.closest(".intro")),
            afterCanvas: status.previousElementSibling === shell,
            status: rect(status),
            shell: rect(shell),
            controls: rect(controls),
            scrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
          };
        });
        assert.equal(geometry.inIntro, false, "l’état est absent de l’en-tête éditorial");
        assert.equal(geometry.afterCanvas, true, "l’état suit directement le canvas");
        assert.ok(Math.abs(geometry.status.x - geometry.shell.x) < 0.1, "l’état est aligné à gauche du canvas");
        assert.ok(geometry.status.y >= geometry.shell.bottom, "l’état apparaît sous le canvas");
        assert.ok(geometry.controls.bottom <= geometry.shell.bottom + 0.1, "les contrôles restent dans le canvas, sans chevaucher l’état");
        assert.ok(geometry.status.right <= geometry.viewportWidth, "l’état ne déborde pas horizontalement");
        assert.ok(geometry.status.bottom <= geometry.viewportHeight, "l’état reste visible dans le viewport");
        assert.ok(geometry.scrollWidth <= geometry.viewportWidth, "aucun débordement horizontal de page");
        tViewport.diagnostic(`${viewport.label}: canvas ${geometry.shell.x},${geometry.shell.y} ${geometry.shell.width}×${geometry.shell.height}; état ${geometry.status.x},${geometry.status.y} ${geometry.status.width}×${geometry.status.height}`);
      });
    }
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
