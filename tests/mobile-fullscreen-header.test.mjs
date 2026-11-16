import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { isAllowedRequest, blockedServiceFor, ROOT, startStaticServer } from "./helpers.mjs";

const [htmlSource, cssSource] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../css/design-system.css", import.meta.url), "utf8")
]);

const HOVER_GATE = /@media \(hover:\s*hover\) and \(pointer:\s*fine\)/;

test("A — le survol des commandes de l'arbre est réservé aux pointeurs fins", () => {
  assert.match(htmlSource, new RegExp(`${HOVER_GATE.source}\\{\\.tree-controls button:hover\\{background:#eee6d8\\}\\}`),
    "le remplissage tactile de .tree-controls button:hover est derrière hover:hover / pointer:fine");
  assert.match(cssSource, new RegExp(`${HOVER_GATE.source}\\s*\\{\\s*\\.fullscreen-control button\\[aria-pressed="true"\\]:hover`),
    "le survol du bouton plein écran est derrière hover:hover / pointer:fine");
  assert.match(cssSource, /\.fullscreen-control button\[aria-pressed="true"\] \{ background: transparent; \}/,
    "l'état actif du bouton plein écran reste sans remplissage");
});

test("B — l'en-tête ne reçoit jamais un padding haut sans la safe-area", () => {
  const landscape = cssSource.match(/@media \(max-height: 620px\) and \(min-width: 761px\) \{[\s\S]*?body:has\(main#appMain:not\(\[hidden\]\)\) \.topbar \{([^}]*)\}/);
  assert.ok(landscape, "règle d'en-tête en fenêtre courte trouvée");
  assert.match(landscape[1], /padding-top:\s*max\(10px,\s*env\(safe-area-inset-top\)\)/,
    "le padding haut compact reste compatible avec la zone système iOS");
  assert.doesNotMatch(landscape[1], /padding-top:\s*10px\s*;/,
    "aucun padding haut codé en dur ne contourne la safe-area");
  assert.match(cssSource, /\.topbar \{\s*\r?\n\s*padding-top: max\(0\.5625rem, env\(safe-area-inset-top\)\)/,
    "en portrait mobile, une seule règle gouverne le padding haut de l'en-tête");
});

test("A — un appui tactile ne laisse aucun remplissage sur le bouton plein écran", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR" });
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
      if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
      return route.continue().catch(() => {});
    });
    const page = await context.newPage();
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      document.getElementById("authScreen").hidden = true;
      document.getElementById("topbar").hidden = false;
      document.getElementById("appMain").hidden = false;
      document.querySelector('[data-view="tree"]').click();
    });
    await page.waitForTimeout(400);

    const read = () => page.evaluate(() => {
      const button = document.getElementById("treeFullscreenBtn");
      const topbar = document.querySelector(".topbar");
      return {
        background: getComputedStyle(button).backgroundColor,
        pressed: button.getAttribute("aria-pressed"),
        padTop: getComputedStyle(topbar).paddingTop,
        top: Math.round(topbar.getBoundingClientRect().top),
        height: Math.round(topbar.getBoundingClientRect().height)
      };
    });

    const before = await read();
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.tap("#treeFullscreenBtn");
      await page.waitForTimeout(350);
      const opened = await read();
      assert.equal(opened.pressed, "true", `cycle ${cycle + 1} : mode plein écran actif`);
      assert.equal(opened.background, "rgba(0, 0, 0, 0)", `cycle ${cycle + 1} : le bouton « × » reste sans remplissage`);
      await page.tap("#treeFullscreenBtn");
      await page.waitForTimeout(350);
      const closed = await read();
      assert.equal(closed.pressed, "false", `cycle ${cycle + 1} : mode plein écran quitté`);
      assert.equal(closed.background, "rgba(0, 0, 0, 0)", `cycle ${cycle + 1} : le bouton d'agrandissement reste sans remplissage`);
      assert.equal(closed.padTop, before.padTop, `cycle ${cycle + 1} : padding haut de l'en-tête stable`);
      assert.equal(closed.top, before.top, `cycle ${cycle + 1} : position de l'en-tête stable`);
      assert.equal(closed.height, before.height, `cycle ${cycle + 1} : hauteur de l'en-tête stable`);
    }
  } finally {
    if (context) await context.close();
    await browser.close();
    await server.close();
  }
});

test("A — le survol souris conserve le remplissage existant sur ordinateur", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
      if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
      return route.continue().catch(() => {});
    });
    const page = await context.newPage();
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      document.getElementById("authScreen").hidden = true;
      document.getElementById("topbar").hidden = false;
      document.getElementById("appMain").hidden = false;
      document.querySelector('[data-view="tree"]').click();
    });
    await page.waitForTimeout(400);
    await page.hover("#treeFullscreenBtn");
    await page.waitForTimeout(250);
    const hovered = await page.evaluate(() => getComputedStyle(document.getElementById("treeFullscreenBtn")).backgroundColor);
    assert.equal(hovered, "rgb(238, 230, 216)", "le survol souris garde le fond historique #eee6d8");
    const topbar = await page.evaluate(() => {
      const element = document.querySelector(".topbar");
      return { padTop: getComputedStyle(element).paddingTop, height: Math.round(element.getBoundingClientRect().height) };
    });
    assert.equal(topbar.padTop, "15px", "l'en-tête desktop garde son padding historique");
    assert.equal(topbar.height, 75, "l'en-tête desktop garde sa hauteur historique");
  } finally {
    if (context) await context.close();
    await browser.close();
    await server.close();
  }
});
