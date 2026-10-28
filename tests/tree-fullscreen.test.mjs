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

async function fullscreenBar(page) {
  return page.evaluate(() => window.__treeProbe.fullscreenBar());
}

async function visibleMenuLabels(page) {
  return page.evaluate(() => [...document.querySelectorAll('#treeMenu [role="menuitem"]')]
    .filter(item => getComputedStyle(item).display !== "none")
    .map(item => item.textContent.trim()));
}

async function assertMenuInsideViewport(page, label, expectedItems) {
  const info = await page.evaluate(() => {
    const menu = document.getElementById("treeMenu");
    const box = menu.getBoundingClientRect();
    return {
      hidden: menu.hidden,
      expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded"),
      text: [...menu.querySelectorAll('[role="menuitem"]')].filter(item => getComputedStyle(item).display !== "none").map(item => item.textContent.trim()),
      box: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
      viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
      clientHeight: menu.clientHeight,
      scrollHeight: menu.scrollHeight
    };
  });
  assert.equal(info.hidden, false, `${label} : le menu ⋯ s’ouvre`);
  assert.equal(info.expanded, "true", `${label} : aria-expanded indique l’ouverture`);
  assert.deepEqual(info.text, expectedItems, `${label} : actions du menu sans doublon`);
  assert.ok(info.box.x >= -1 && info.box.y >= -1 && info.box.right <= info.viewport.width + 1 && info.box.bottom <= info.viewport.height + 1,
    `${label} : menu entièrement dans le viewport (${JSON.stringify(info)})`);
  assert.ok(info.clientHeight > 0 && info.scrollHeight >= info.clientHeight, `${label} : menu défilable si nécessaire`);
  assert.equal(info.viewport.scrollWidth, info.viewport.width, `${label} : aucun overflow horizontal`);
}

async function assertFullscreenBarOrder(page, label, expectedVisible) {
  const { bar, menu } = await fullscreenBar(page);
  const visible = bar.filter(button => button.visible);
  assert.deepEqual(visible.map(button => button.id), expectedVisible,
    `${label} : ordre de la barre d’icônes (${JSON.stringify(visible.map(button => ({ id: button.id, w: button.width, h: button.height })))})`);
  const texts = await page.evaluate(() => [...document.querySelectorAll(".tree-controls .zoom-control button, .tree-controls .view-control > button")]
    .filter(button => button.getClientRects().length > 0 && button.id !== "treeMoreBtn")
    .map(button => ({ id: button.id, text: button.textContent.trim() })));
  for (const entry of texts) {
    assert.equal(entry.text, "", `${label} : ${entry.id} est une icône seule, sans texte visible (« ${entry.text} »)`);
  }
  for (const button of visible) {
    assert.ok(button.width >= 43.5 && button.height >= 43.5, `${label} : ${button.id} ≥ 44×44 (mesuré ${button.width}×${button.height})`);
    assert.ok(button.label?.trim(), `${label} : ${button.id} conserve un nom accessible`);
  }
  const controls = await page.locator(".tree-controls").boundingBox();
  assert.ok(controls && controls.x >= -1 && controls.y >= -1
    && controls.x + controls.width <= (await page.viewportSize()).width + 1
    && controls.y + controls.height <= (await page.viewportSize()).height + 1,
  `${label} : barre entièrement dans le viewport (${JSON.stringify(controls)})`);
  return { bar, menu, visible };
}

const WIDE_BAR = ["zoomOutBtn", "zoomInBtn", "fullscreenFitBtn", "fullscreenCenterBtn", "treeSearchToggleBtn", "treeMoreBtn", "treeFullscreenBtn"];
const NARROW_BAR = ["zoomOutBtn", "zoomInBtn", "treeSearchToggleBtn", "treeMoreBtn", "treeFullscreenBtn"];

test("markup et CSS : barre d’icônes plein écran, menu sans doublons, panneau de recherche", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../css/design-system.css", import.meta.url), "utf8"),
    readFile(new URL("../js/app.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="fullscreenFitBtn"[^>]*hidden/);
  assert.match(html, /id="fullscreenCenterBtn"[^>]*hidden/);
  assert.match(html, /id="treeSearchToggleBtn"[^>]*hidden/);
  assert.match(html, /id="treeFullscreenSearch"[^>]*hidden/);
  assert.match(html, /<button id="treeFullscreenBtn"[^>]*aria-label="Afficher l’arbre en plein écran"[^>]*aria-pressed="false"[^>]*title="Plein écran"><svg[^>]*><use href="#icon-maximize"><\/use><\/svg><\/button>/);
  assert.match(html, /id="menuFitBtn"[^>]*role="menuitem"[^>]*>.*?Ajuster/s);
  assert.doesNotMatch(html, /id="treeFullscreenMenuBtn"/);
  assert.match(app, /function toggleTreeFullscreen\(\)/);
  assert.match(app, /function moveTreeSearchToFullscreenLayer\(/);
  assert.match(app, /function setTreeFullscreenSearch\(/);
  assert.match(css, /html\.tree-fullscreen-fallback #appMain > :not\(#treeViewport\) \{ display: none !important; \}/);
  assert.match(css, /#treeFullscreenBtn\s*\{[^}]*width: var\(--control-touch\);[^}]*height: var\(--control-touch\)/);
  assert.match(css, /html\.tree-fullscreen-active #appMain \.tree-controls\s*\{[^}]*inset: max\(var\(--space-2\), env\(safe-area-inset-top\)\)/);
  assert.match(css, /\.tree-shell\.tree-fullscreen-active \.view-control #fullscreenFitBtn \{ order: 1; \}/);
  assert.match(css, /\.tree-shell\.tree-fullscreen-active \.view-control #treeMoreBtn \{ order: 4; \}/);
  assert.match(css, /\.tree-shell\.tree-fullscreen-active \.view-control #treeFullscreenBtn \{ order: 5; display: inline-flex; \}/);
  assert.match(css, /\.tree-shell\.tree-fullscreen-active \.tree-menu #menuFitBtn,\s*\.tree-shell\.tree-fullscreen-active \.tree-menu #centerTreeBtn \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 371px\) \{[\s\S]*?#fullscreenFitBtn,[\s\S]*?#fullscreenCenterBtn \{ display: none; \}[\s\S]*?#menuFitBtn,[\s\S]*?#centerTreeBtn \{ display: grid; \}/);
  assert.match(css, /\.tree-shell\.tree-fullscreen-active \.tree-fullscreen-search\s*\{[^}]*position: absolute/);
  assert.match(css, /env\(safe-area-inset-(?:top|right|bottom|left)\)/);
});

test("repli mobile : barre horizontale, menu sans doublons, recherche, rotations", async t => {
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
          assert.ok(await page.locator("#treeFullscreenBtn").isVisible(), `${name} : Plein écran accessible hors plein écran`);
          assert.ok(!(await page.locator("#fullscreenFitBtn").isVisible()), `${name} : Ajuster masqué hors plein écran`);
          assert.ok(!(await page.locator("#treeSearchToggleBtn").isVisible()), `${name} : loupe masquée hors plein écran`);
          await page.locator("#treeMoreBtn").tap();
          await assertMenuInsideViewport(page, `${name} menu normal`, ["Ajuster", "Recentrer", "Réorganiser", "Exporter"]);
          await page.keyboard.press("Escape");

          await page.locator("#treeFullscreenBtn").tap();
          await page.waitForFunction(() => document.documentElement.classList.contains("tree-fullscreen-fallback"));
          await page.waitForTimeout(100);
          assert.equal(await page.locator("#topbar").evaluate(element => getComputedStyle(element).display), "none", `${name} : navigation extérieure masquée`);
          assert.equal(await page.locator("#treeFullscreenBtn").getAttribute("title"), "Quitter le plein écran");
          assert.equal(await page.locator("#treeFullscreenBtn").getAttribute("aria-pressed"), "true");

          await assertFullscreenBarOrder(page, `${name} plein écran 390px`, WIDE_BAR);
          await page.locator("#treeMoreBtn").tap();
          assert.deepEqual(await visibleMenuLabels(page), ["Réorganiser", "Exporter"],
            `${name} : le menu n’expose pas les actions déjà dans la barre`);
          await page.keyboard.press("Escape");
          const afterEntry = await centerOfView(page);
          assert.ok(Math.abs(afterEntry.scale - before.scale) < 1e-6, `${name} : zoom conservé à l’entrée`);
          assert.ok(Math.abs(afterEntry.worldX - before.worldX) < 2 && Math.abs(afterEntry.worldY - before.worldY) < 2, `${name} : centre conservé à l’entrée`);

          // Recherche : la loupe ouvre le champ existant, centrage et surlignage inchangés.
          await page.locator("#treeSearchToggleBtn").tap();
          await page.waitForFunction(() => !document.getElementById("treeFullscreenSearch").hidden);
          assert.equal(await page.evaluate(() => document.activeElement?.id), "search", `${name} : le champ de recherche reçoit le focus`);
          assert.equal(await page.locator("#treeSearchToggleBtn").getAttribute("aria-expanded"), "true");
          await page.fill("#search", "Prénom 3");
          await page.waitForTimeout(80);
          const searchState = await page.evaluate(() => ({
            matches: document.querySelectorAll("#treeScene .person.search-match").length,
            centered: (() => {
              const card = document.querySelector('#treeScene .person[data-person-id="person-3"]');
              if (!card) return null;
              const rect = card.getBoundingClientRect();
              const viewport = document.getElementById("treeViewport").getBoundingClientRect();
              return { cx: rect.x + rect.width / 2 - viewport.left, cy: rect.y + rect.height / 2 - viewport.top, vw: viewport.width, vh: viewport.height };
            })()
          }));
          assert.equal(searchState.matches, 1, `${name} : la recherche surligne le résultat`);
          assert.ok(searchState.centered && Math.abs(searchState.centered.cx - searchState.centered.vw / 2) < 60
            && Math.abs(searchState.centered.cy - searchState.centered.vh / 2) < 60,
          `${name} : la recherche centre la personne (${JSON.stringify(searchState.centered)})`);
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => document.getElementById("treeFullscreenSearch").hidden);
          assert.equal(await page.evaluate(() => document.documentElement.classList.contains("tree-fullscreen-active")), true, `${name} : Échap ferme la recherche sans quitter le plein écran`);
          await page.evaluate(() => {
            const input = document.getElementById("search");
            input.value = "";
            input.dispatchEvent(new Event("input"));
          });

          // Fiches personnes accessibles en plein écran.
          await page.locator("#treeScene .person").first().click();
          assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), true, `${name} : fiche personne ouvrable`);
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => !document.getElementById("personDialog").open);

          // Ajuster/Recentrer directement depuis la barre.
          await page.locator("#zoomInBtn").tap();
          const zoomed = await centerOfView(page);
          await page.locator("#fullscreenFitBtn").tap();
          const fitted = await centerOfView(page);
          assert.ok(fitted.scale !== zoomed.scale, `${name} : Ajuster agit depuis la barre`);
          await page.locator("#fullscreenCenterBtn").tap();
          const centeredAgain = await centerOfView(page);
          assert.ok(Math.abs(centeredAgain.scale - fitted.scale) < 1e-6, `${name} : Recentrer conserve l’échelle`);

          // Dézoom minimal à 10 %.
          for (let index = 0; index < 20; index += 1) await page.locator("#zoomOutBtn").tap();
          const zoomedOut = await centerOfView(page);
          assert.ok(zoomedOut.scale >= 0.1 && zoomedOut.scale < 0.25, `${name} : dézoom minimal 10 % (${Math.round(zoomedOut.scale * 100)} %)`);
          await page.locator("#fullscreenFitBtn").tap();
          const rotationBaseline = await centerOfView(page);

          // Rotations : barre horizontale, zoom/centre préservés, aucun débordement.
          for (const size of [[568, 320], [844, 390], [932, 430], [812, 375], [320, 568], [375, 812], [390, 844], [430, 932]]) {
            await page.setViewportSize({ width: size[0], height: size[1] });
            await page.waitForTimeout(250);
            const current = await centerOfView(page);
            assert.ok(Math.abs(current.scale - rotationBaseline.scale) < 1e-6, `${name} ${size.join("×")} : zoom non modifié`);
            assert.ok(Math.abs(current.worldX - rotationBaseline.worldX) < 2 && Math.abs(current.worldY - rotationBaseline.worldY) < 2,
              `${name} ${size.join("×")} : centre conservé`);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), size[0], `${name} ${size.join("×")} : aucun débordement horizontal`);
            const direction = await page.locator(".tree-controls").evaluate(element => getComputedStyle(element).flexDirection);
            assert.equal(direction, "row", `${name} ${size.join("×")} : barre horizontale (pas de colonne)`);
            const expected = size[0] <= 371 ? NARROW_BAR : WIDE_BAR;
            await assertFullscreenBarOrder(page, `${name} ${size.join("×")}`, expected);
            await page.locator("#treeMoreBtn").tap();
            const expectedMenu = size[0] <= 371 ? ["Ajuster", "Recentrer", "Réorganiser", "Exporter"] : ["Réorganiser", "Exporter"];
            await assertMenuInsideViewport(page, `${name} ${size.join("×")}`, expectedMenu);
            await page.keyboard.press("Escape");
            assert.equal(await page.locator("#treeMenu").evaluate(element => element.hidden), true, `${name} ${size.join("×")} : menu refermé par Échap`);
          }

          // Sortie par le bouton, puis réentrée et sortie par Échap.
          await page.locator("#treeFullscreenBtn").tap();
          await page.waitForFunction(() => !document.documentElement.classList.contains("tree-fullscreen-active"));
          await page.waitForTimeout(100);
          const afterExit = await centerOfView(page);
          assert.ok(Math.abs(afterExit.scale - rotationBaseline.scale) < 1e-6, `${name} : zoom conservé après sortie`);
          assert.ok(Math.abs(afterExit.worldX - rotationBaseline.worldX) < 2 && Math.abs(afterExit.worldY - rotationBaseline.worldY) < 2, `${name} : centre conservé après sortie`);
          assert.ok(await page.locator("#search").isVisible(), `${name} : la barre de recherche est restaurée dans la toolbar`);
          assert.ok(!(await page.locator("#treeSearchToggleBtn").isVisible()), `${name} : loupe repliée en vue normale`);
          await page.locator("#treeFullscreenBtn").tap();
          await page.waitForFunction(() => document.documentElement.classList.contains("tree-fullscreen-active"));
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => !document.documentElement.classList.contains("tree-fullscreen-active"));
          await page.locator("#treeScene .person").first().click();
          assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), true, `${name} : accès aux fiches préservé`);
        } finally { await context.close(); }
      } finally { await browser.close(); }
    }
  } finally { await server.close(); }
});

test("plein écran natif desktop : barre complète, menu réduit, recherche et Échap", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const width of [1280, 1440]) {
      const { context, page } = await openTreePage(browser, server, width, 900, false);
      try {
        assert.ok(await page.locator("#treeFullscreenBtn").isVisible(), `${width}px : Plein écran présent`);
        await page.locator("#treeFullscreenBtn").click();
        await page.waitForFunction(() => document.documentElement.classList.contains("tree-fullscreen-active"));
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => document.fullscreenElement === document.getElementById("treeViewport")), true, `${width}px : plein écran natif`);
        await assertFullscreenBarOrder(page, `${width}px desktop`, WIDE_BAR);

        // Toutes les commandes de la barre fonctionnent.
        const initial = await centerOfView(page);
        await page.locator("#zoomInBtn").click();
        assert.ok((await centerOfView(page)).scale > initial.scale, `${width}px : Zoom +`);
        await page.locator("#zoomOutBtn").click();
        assert.ok(Math.abs((await centerOfView(page)).scale - initial.scale) < 0.01, `${width}px : Zoom −`);
        await page.locator("#fullscreenFitBtn").click();
        const fitted = await centerOfView(page);
        assert.ok(fitted.scale >= 0.25 - 1e-6, `${width}px : Ajuster avec minimum 25 %`);
        await page.locator("#fullscreenCenterBtn").click();
        assert.ok(Math.abs((await centerOfView(page)).scale - fitted.scale) < 1e-6, `${width}px : Recentrer conserve l’échelle`);

        // Recherche fonctionnelle depuis la barre.
        await page.locator("#treeSearchToggleBtn").click();
        await page.waitForFunction(() => !document.getElementById("treeFullscreenSearch").hidden);
        assert.equal(await page.evaluate(() => document.activeElement?.id), "search", `${width}px : focus sur la recherche`);
        await page.fill("#search", "Famille 5");
        await page.waitForTimeout(80);
        assert.equal(await page.locator('#treeScene .person.search-match[data-person-id="person-5"]').count(), 1, `${width}px : recherche opérationnelle`);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.getElementById("treeFullscreenSearch").hidden);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains("tree-fullscreen-active")), true, `${width}px : Échap ferme la recherche`);
        await page.evaluate(() => {
          const input = document.getElementById("search");
          input.value = "";
          input.dispatchEvent(new Event("input"));
        });

        // Menu réduit et actions restantes.
        await page.locator("#treeMoreBtn").click();
        await assertMenuInsideViewport(page, `${width}px desktop`, ["Réorganiser", "Exporter"]);
        await page.locator("#menuExportTreeBtn").click();
        assert.equal(await page.locator("#treeExportDialog").evaluate(dialog => dialog.open), true, `${width}px : Exporter ouvre sa modale`);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.getElementById("treeExportDialog").open);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains("tree-fullscreen-active")), true, `${width}px : la modale ne quitte pas le plein écran`);

        // Échap sort du plein écran.
        await page.keyboard.press("Escape");
        if (await page.locator("#treeViewport").evaluate(element => element.classList.contains("tree-fullscreen-active"))) {
          await page.keyboard.press("Escape");
        }
        await page.waitForFunction(() => !document.documentElement.classList.contains("tree-fullscreen-active"));
        assert.equal(await page.locator("#topbar").evaluate(element => getComputedStyle(element).display !== "none"), true, `${width}px : vue normale restaurée`);
        assert.ok(await page.locator("#search").isVisible(), `${width}px : recherche restaurée dans la toolbar`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await server.close(); }
});
