import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

async function openTreePage(browser, server, width, height, mobile = false) {
  const context = await browser.newContext({
    viewport: { width, height }, locale: "fr-FR", isMobile: mobile, hasTouch: mobile,
    reducedMotion: "reduce"
  });
  await context.route("**/*", route => {
    const url = route.request().url();
    return isAllowedRequest(url, server.baseURL) || url.includes("gstatic.com")
      ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForSelector("#treeMoreBtn", { state: "attached" });
  await page.waitForTimeout(180);
  await page.evaluate(() => {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
    for (const id of ["directoryView", "documentsView", "tasksView", "dossiersView"]) {
      const view = document.getElementById(id);
      if (view) view.hidden = true;
    }
    const people = Array.from({ length: 8 }, (_, index) => ({
      id: `person-${index}`, firstName: `Prénom ${index}`, lastName: `Famille ${index}`,
      birthDateInfo: { type: "year", year: 1780 + index * 10 }, treeId: null, inTree: true
    }));
    const families = [
      { id: "family-1", partnerIds: ["person-0", "person-1"], childIds: ["person-2", "person-3"] },
      { id: "family-2", partnerIds: ["person-2", "person-4"], childIds: ["person-5"] },
      { id: "family-3", partnerIds: ["person-3", "person-6"], childIds: ["person-7"] }
    ];
    window.__treeProbe.render(people, families);
  });
  await page.waitForTimeout(100);
  return { context, page };
}

async function centerOfView(page) {
  return page.evaluate(() => {
    const state = window.__treeProbe.state;
    const viewport = window.__treeProbe.viewport();
    return {
      scale: state.scale,
      worldX: (viewport.width / 2 - state.x) / state.scale,
      worldY: (viewport.height / 2 - state.y) / state.scale,
      viewport: { width: viewport.width, height: viewport.height, rect: viewport.rect }
    };
  });
}

async function assertMenuInsideViewport(page, label) {
  const info = await page.evaluate(() => {
    const menu = document.getElementById("treeMenu");
    const box = menu.getBoundingClientRect();
    return {
      hidden: menu.hidden,
      expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded"),
      text: [...menu.querySelectorAll('[role="menuitem"]')].filter(item => getComputedStyle(item).display !== "none").map(item => item.textContent.trim()),
      box: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
      anchor: (() => { const rect = document.getElementById("treeMoreBtn").getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }; })(),
      shell: (() => { const rect = document.getElementById("treeViewport").getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, position: getComputedStyle(document.getElementById("treeViewport")).position, fullscreen: document.fullscreenElement === document.getElementById("treeViewport"), fallback: document.documentElement.classList.contains("tree-fullscreen-fallback") }; })(),
      ancestors: (() => { const items = []; for (let node = menu; node && items.length < 8; node = node.parentElement) { const style = getComputedStyle(node), rect = node.getBoundingClientRect(); items.push({ id: node.id, cls: typeof node.className === "string" ? node.className : "", transform: style.transform, position: style.position, rect: { x: rect.x, y: rect.y } }); } return items; })(),
      menuStyle: { position: getComputedStyle(menu).position, top: menu.style.top, left: menu.style.left, bottom: menu.style.bottom, maxHeight: menu.style.maxHeight },
      computedMenu: { top: getComputedStyle(menu).top, left: getComputedStyle(menu).left, scrollY: scrollY, visualTop: visualViewport?.offsetTop },
      viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
      maxHeight: getComputedStyle(menu).maxHeight,
      scrollHeight: menu.scrollHeight,
      clientHeight: menu.clientHeight
    };
  });
  assert.equal(info.hidden, false, `${label} : le menu ⋯ s’ouvre en plein écran`);
  assert.equal(info.expanded, "true", `${label} : aria-expanded indique l’ouverture`);
  assert.deepEqual(info.text, ["Quitter le plein écran", "Recentrer", "Réorganiser", "Exporter"]);
  assert.ok(info.box.x >= -1 && info.box.y >= -1 && info.box.right <= info.viewport.width + 1 && info.box.bottom <= info.viewport.height + 1,
    `${label} : menu entièrement dans le viewport (${JSON.stringify(info)})`);
  assert.ok(info.clientHeight > 0 && info.scrollHeight >= info.clientHeight, `${label} : menu défilable si nécessaire`);
  assert.equal(info.viewport.scrollWidth, info.viewport.width, `${label} : aucun overflow horizontal`);
}

test("le menu remplace Ajuster par Plein écran, Ajuster reste en barre et l’état suit aria-pressed", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../css/design-system.css", import.meta.url), "utf8"),
    readFile(new URL("../js/app.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="fitTreeBtn"[^>]*>.*?Ajuster/s);
  assert.match(html, /id="treeFullscreenMenuBtn"[^>]*aria-pressed="false"[^>]*>.*?Plein écran/s);
  assert.doesNotMatch(html, /id="menuFitBtn"/);
  assert.match(app, /function toggleTreeFullscreen\(\)/);
  assert.match(css, /html\.tree-fullscreen-fallback #appMain > :not\(#treeViewport\) \{ display: none !important; \}/);
  assert.match(css, /\.tree-controls #fitTreeBtn \{ display: inline-flex; \}/);
  assert.match(css, /env\(safe-area-inset-(?:top|right|bottom|left)\)/);
});

test("le repli plein écran mobile préserve le centre à chaque rotation et se ferme avec Échap", async t => {
  const server = await startStaticServer(ROOT);
  try {
    for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
      let browser;
      try { browser = await engine.launch({ headless: true }); }
      catch (error) {
        if (name === "WebKit") { t.diagnostic(`WebKit indisponible : ${error.message}`); continue; }
        throw error;
      }
      try {
        const { context, page } = await openTreePage(browser, server, 390, 844, true);
        try {
          await page.evaluate(() => {
            const viewport = document.getElementById("treeViewport");
            Object.defineProperty(viewport, "requestFullscreen", { configurable: true, value: undefined });
            Object.defineProperty(viewport, "webkitRequestFullscreen", { configurable: true, value: undefined });
          });
          const before = await centerOfView(page);
          assert.ok(await page.locator("#fitTreeBtn").isVisible(), `${name} : Ajuster directement accessible hors plein écran`);
          await page.locator("#treeMoreBtn").tap();
          assert.equal(await page.locator("#treeFullscreenMenuBtn").textContent(), "Plein écran");
          await page.locator("#treeFullscreenMenuBtn").tap();
          await page.waitForFunction(() => document.documentElement.classList.contains("tree-fullscreen-fallback"));
          await page.waitForTimeout(100);
          assert.equal(await page.locator("#topbar").evaluate(element => getComputedStyle(element).display), "none", `${name} : navigation extérieure masquée`);
          assert.ok(await page.locator("#fitTreeBtn").isVisible(), `${name} : Ajuster accessible dans la barre plein écran`);
          assert.ok(await page.locator("#treeMoreBtn").isVisible(), `${name} : menu ⋯ toujours accessible`);
          const afterEntry = await centerOfView(page);
          assert.ok(Math.abs(afterEntry.scale - before.scale) < 1e-6, `${name} : zoom conservé à l’entrée`);
          assert.ok(Math.abs(afterEntry.worldX - before.worldX) < 2 && Math.abs(afterEntry.worldY - before.worldY) < 2, `${name} : centre conservé à l’entrée (${JSON.stringify({ before, afterEntry })})`);
          await page.locator("#treeScene .person").first().click();
          assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), true, `${name} : une fiche reste ouvrable en plein écran`);
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => !document.getElementById("personDialog").open);
          assert.equal(await page.locator("#treeViewport").evaluate(element => element.classList.contains("tree-fullscreen-active")), true, `${name} : fermer la fiche garde le plein écran`);

          await page.locator("#zoomInBtn").tap();
          const zoomed = await centerOfView(page);
          assert.ok(zoomed.scale > afterEntry.scale, `${name} : zoom utilisable en plein écran`);
          const panStart = await page.evaluate(() => {
            const viewport = document.getElementById("treeViewport").getBoundingClientRect();
            const controls = document.querySelector(".tree-controls").getBoundingClientRect();
            const cards = [...document.querySelectorAll("#treeScene .person")].map(card => card.getBoundingClientRect());
            const candidates = [[18, 18], [18, viewport.height / 2], [viewport.width / 2, 18], [viewport.width - 18, 18], [18, viewport.height - 80]];
            return candidates.map(([x, y]) => ({ x: viewport.left + x, y: viewport.top + y }))
              .find(point => point.x < controls.left - 4 || point.x > controls.right + 4 || point.y < controls.top - 4 || point.y > controls.bottom + 4)
              && candidates.map(([x, y]) => ({ x: viewport.left + x, y: viewport.top + y }))
                .find(point => !cards.some(card => point.x >= card.left && point.x <= card.right && point.y >= card.top && point.y <= card.bottom)
                  && !(point.x >= controls.left && point.x <= controls.right && point.y >= controls.top && point.y <= controls.bottom));
          });
          assert.ok(panStart, `${name} : une zone vide du canvas reste disponible pour le déplacement`);
          const stateBeforePan = await page.evaluate(() => window.__treeProbe.state);
          await page.mouse.move(panStart.x, panStart.y);
          await page.mouse.down();
          await page.mouse.move(panStart.x + 18, panStart.y + 14, { steps: 3 });
          await page.mouse.up();
          await page.waitForTimeout(50);
          const stateAfterPan = await page.evaluate(() => window.__treeProbe.state);
          assert.ok(Math.abs(stateAfterPan.x - stateBeforePan.x) > 5 || Math.abs(stateAfterPan.y - stateBeforePan.y) > 5, `${name} : déplacement du canvas toujours actif`);
          const rotationBaseline = await centerOfView(page);

          for (const size of [[568, 320], [844, 390], [932, 430], [812, 375], [320, 568], [375, 812], [390, 844], [430, 932]]) {
            await page.setViewportSize({ width: size[0], height: size[1] });
            await page.waitForTimeout(250);
            const current = await centerOfView(page);
            assert.ok(Math.abs(current.scale - rotationBaseline.scale) < 1e-6, `${name} ${size.join("×")} : zoom non modifié`);
            assert.ok(Math.abs(current.worldX - rotationBaseline.worldX) < 2 && Math.abs(current.worldY - rotationBaseline.worldY) < 2,
              `${name} ${size.join("×")} : centre conservé après rotation/redimensionnement`);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), size[0], `${name} ${size.join("×")} : aucun débordement horizontal`);
            const control = await page.locator(".tree-controls").boundingBox();
            if (control) assert.ok(control.x >= -1 && control.y >= -1 && control.x + control.width <= size[0] + 1 && control.y + control.height <= size[1] + 1, `${name} ${size.join("×")} : commandes visibles`);
            if (size[0] > size[1] && size[1] <= 600) {
              const direction = await page.locator(".view-control").evaluate(element => getComputedStyle(element).flexDirection);
              assert.equal(direction, "column", `${name} ${size.join("×")} : commandes en pile compacte paysage`);
            }
            if (size[0] > size[1]) {
              await page.locator("#treeMoreBtn").tap();
              await assertMenuInsideViewport(page, `${name} ${size.join("×")} plein écran paysage`);
              await page.keyboard.press("Escape");
              assert.equal(await page.locator("#treeMenu").evaluate(element => element.hidden), true, `${name} ${size.join("×")} : menu paysage refermé par Échap`);
            }
          }

          await page.locator("#treeMoreBtn").tap();
          await assertMenuInsideViewport(page, `${name} plein écran portrait`);
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#treeMenu").evaluate(element => element.hidden), true, `${name} : Échap ferme le menu en premier`);
          assert.equal(await page.locator("#treeViewport").evaluate(element => element.classList.contains("tree-fullscreen-active")), true, `${name} : le menu ne quitte pas encore le plein écran`);
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => !document.documentElement.classList.contains("tree-fullscreen-active"));
          await page.waitForTimeout(100);
          const afterExit = await centerOfView(page);
          assert.ok(Math.abs(afterExit.scale - rotationBaseline.scale) < 1e-6, `${name} : zoom conservé après sortie`);
          assert.ok(Math.abs(afterExit.worldX - rotationBaseline.worldX) < 2 && Math.abs(afterExit.worldY - rotationBaseline.worldY) < 2, `${name} : centre conservé après sortie (${JSON.stringify({ rotationBaseline, afterExit })})`);
          await page.locator("#treeScene .person").first().click();
          assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), true, `${name} : accès aux fiches personne préservé`);
        } finally { await context.close(); }
      } finally { await browser.close(); }
    }
  } finally { await server.close(); }
});

test("le mode natif desktop conserve menu, Ajuster et sortie par Échap", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const width of [1280, 1440]) {
      const { context, page } = await openTreePage(browser, server, width, 900, false);
      try {
        assert.ok(await page.locator("#fitTreeBtn").isVisible(), `${width}px : Ajuster présent dans la barre`);
        await page.locator("#treeMoreBtn").click();
        await page.locator("#treeFullscreenMenuBtn").click();
        await page.waitForFunction(() => document.documentElement.classList.contains("tree-fullscreen-active"));
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => document.fullscreenElement === document.getElementById("treeViewport")), true, `${width}px : Chromium emploie le plein écran natif`);
        assert.ok(await page.locator("#fitTreeBtn").isVisible(), `${width}px : Ajuster reste directement accessible`);
        assert.ok(await page.locator("#treeMoreBtn").isVisible(), `${width}px : menu ⋯ reste accessible`);
        await page.locator("#treeMoreBtn").click();
        await assertMenuInsideViewport(page, `${width}px desktop`);
        await page.keyboard.press("Escape");
        if (await page.locator("#treeViewport").evaluate(element => element.classList.contains("tree-fullscreen-active"))) {
          await page.keyboard.press("Escape");
        }
        await page.waitForFunction(() => !document.documentElement.classList.contains("tree-fullscreen-active"));
        assert.equal(await page.locator("#topbar").evaluate(element => getComputedStyle(element).display !== "none"), true, `${width}px : vue normale restaurée`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await server.close(); }
});
