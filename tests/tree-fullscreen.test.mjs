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

async function pinchTree(page, startDistance, endDistance) {
  return page.evaluate(({ startDistance, endDistance }) => {
    const viewport = document.getElementById("treeViewport");
    const rect = viewport.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    Object.defineProperty(viewport, "setPointerCapture", { configurable: true, value() {} });
    const dispatch = (type, pointerId, clientX) => viewport.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, pointerType: "touch", isPrimary: pointerId === 1,
      clientX, clientY: centerY
    }));
    const leftStart = centerX - startDistance / 2;
    const rightStart = centerX + startDistance / 2;
    const leftEnd = centerX - endDistance / 2;
    const rightEnd = centerX + endDistance / 2;
    dispatch("pointerdown", 1, leftStart);
    dispatch("pointerdown", 2, rightStart);
    dispatch("pointermove", 1, leftEnd);
    dispatch("pointermove", 2, rightEnd);
    dispatch("pointerup", 1, leftEnd);
    dispatch("pointerup", 2, rightEnd);
    return window.__treeProbe.state.scale;
  }, { startDistance, endDistance });
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
      open: menu.open,
      bottomSheet: menu.classList.contains("is-bottom-sheet"),
      expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded"),
      text: [...menu.querySelectorAll('[role="menuitem"]')].filter(item => getComputedStyle(item).display !== "none").map(item => item.textContent.trim()),
      box: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
      viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
      clientHeight: menu.clientHeight,
      scrollHeight: menu.scrollHeight,
      backdrop: { background: getComputedStyle(menu, "::backdrop").backgroundColor, filter: getComputedStyle(menu, "::backdrop").backdropFilter },
      style: { position: getComputedStyle(menu).position, overflowY: getComputedStyle(menu).overflowY, inline: menu.getAttribute("style") }
    };
  });
  assert.equal(info.hidden, false, `${label} : le menu ⋯ s’ouvre`);
  assert.equal(info.open, true, `${label} : le dialogue de commandes est ouvert`);
  assert.equal(info.expanded, "true", `${label} : aria-expanded indique l’ouverture`);
  assert.deepEqual(info.text, expectedItems, `${label} : actions du menu sans doublon`);
  assert.ok(info.box.x >= -1 && info.box.y >= -1 && info.box.right <= info.viewport.width + 1 && info.box.bottom <= info.viewport.height + 1,
    `${label} : menu entièrement dans le viewport (${JSON.stringify(info)})`);
  assert.ok(info.clientHeight > 0 && info.scrollHeight >= info.clientHeight, `${label} : menu défilable si nécessaire`);
  if (info.scrollHeight <= info.clientHeight + 2) assert.notEqual(info.style.overflowY, "scroll", `${label} : aucun ascenseur vertical sans débordement`);
  if (info.bottomSheet) assert.match(info.backdrop.filter, /blur\(/, `${label} : flou réservé au bottom sheet normal mobile`);
  else {
    assert.equal(info.backdrop.filter, "none", `${label} : aucun flou sur menu contextuel`);
    assert.match(info.backdrop.background, /rgba\(0, 0, 0, 0\)|transparent/, `${label} : aucun voile sur menu contextuel`);
  }
  assert.equal(info.viewport.scrollWidth, info.viewport.width, `${label} : aucun overflow horizontal`);
  if (label.includes("normal mobile")) assert.equal(info.bottomSheet, true, `${label} : bottom sheet utilisé hors plein écran`);
  else assert.equal(info.bottomSheet, false, `${label} : menu contextuel conservé en plein écran`);
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
  for (let index = 1; index < visible.length; index += 1) {
    assert.ok(visible[index].x >= visible[index - 1].right - 0.5,
      `${label} : ${visible[index - 1].id} et ${visible[index].id} ne se chevauchent pas`);
  }
  const controls = await page.locator(".tree-controls").boundingBox();
  assert.ok(controls && controls.x >= -1 && controls.y >= -1
    && controls.x + controls.width <= (await page.viewportSize()).width + 1
    && controls.y + controls.height <= (await page.viewportSize()).height + 1,
  `${label} : barre entièrement dans le viewport (${JSON.stringify(controls)})`);
  return { bar, menu, visible };
}

const DESKTOP_FULLSCREEN_BAR = ["zoomOutBtn", "zoomInBtn", "fullscreenFitBtn", "treeSearchToggleBtn", "treeMoreBtn"];
const MOBILE_FULLSCREEN_BAR = ["fullscreenFitBtn", "treeSearchToggleBtn", "treeMoreBtn", "treeFullscreenBtn"];

test("markup et CSS : barre d’icônes plein écran, menu sans doublons, panneau de recherche", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../css/design-system.css", import.meta.url), "utf8"),
    readFile(new URL("../js/app.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="fullscreenFitBtn"[^>]*hidden/);
  assert.doesNotMatch(html, /id="fullscreenCenterBtn"/, "aucun bouton Recentrer dupliqué dans la barre");
  assert.match(html, /id="treeSearchToggleBtn"[^>]*hidden/);
  assert.match(html, /id="treeFullscreenSearch"[^>]*hidden/);
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
  assert.match(html, /<link rel="apple-touch-icon"/);
  assert.doesNotMatch(html, /rel="manifest"/i, "aucun manifeste PWA nouveau n'est introduit");
  assert.match(html, /<button id="treeFullscreenBtn"[^>]*aria-label="Afficher l’arbre en plein écran"[^>]*aria-pressed="false"[^>]*title="Plein écran"><svg[^>]*><use href="#icon-expand"><\/use><\/svg><\/button>/);
  assert.match(html, /<div class="fullscreen-control">\s*<button id="treeFullscreenBtn"/, "Plein écran isolé dans son groupe bas-droit en vue normale");
  assert.match(html, /<dialog class="tree-menu" id="treeMenu"/);
  assert.match(html, /id="menuFitBtn"[^>]*role="menuitem"[^>]*>[\s\S]*?href="#icon-scan"/);
  assert.match(html, /id="centerTreeBtn"[^>]*role="menuitem"[^>]*>[\s\S]*?href="#icon-crosshair"/);
  assert.match(html, /id="autoLayoutBtn"[^>]*role="menuitem"[^>]*>[\s\S]*?href="#icon-git-branch"/);
  assert.match(html, /id="menuExportTreeBtn"[^>]*role="menuitem"[^>]*>[\s\S]*?href="#icon-download"/);
  assert.doesNotMatch(html, /id="treeFullscreenMenuBtn"/);
  assert.match(app, /function toggleTreeFullscreen\(\)/);
  assert.match(app, /function moveTreeSearchToFullscreenLayer\(/);
  assert.match(app, /function setTreeFullscreenSearch\(/);
  assert.match(app, /function resetTreeFullscreenScroll\(\)/);
  assert.match(css, /html\.tree-fullscreen-fallback #appMain > :not\(#treeViewport\) \{ display: none !important; \}/);
  assert.match(css, /#treeFullscreenBtn\s*\{[^}]*width: var\(--control-touch\);[^}]*height: var\(--control-touch\)/);
  assert.match(css, /html\.tree-fullscreen-active #appMain \.tree-controls\s*\{[^}]*inset: max\(var\(--space-2\), env\(safe-area-inset-top\)\)/);
  assert.match(css, /html:not\(\.tree-fullscreen-active\) #appMain \.tree-controls \.zoom-control \{ display: none; \}/);
  assert.match(css, /html\.tree-fullscreen-active #appMain \.tree-controls \.zoom-control \{ display: none; \}/);
  assert.match(html, /class="tree-toolbar-divider"/);
  assert.match(html, /class="tree-command-divider"/);
  assert.match(css, /\.tree-shell\.tree-fullscreen-active \.tree-toolbar\s*\{[^}]*border: var\(--border-default\);[^}]*background: var\(--color-surface-raised\)/s);
  assert.match(css, /\.tree-shell\.tree-fullscreen-active \.zoom-control\s*\{[^}]*background: transparent;[^}]*box-shadow: none;/s);
  assert.match(css, /\.tree-shell\.tree-fullscreen-active \.view-control\s*\{[^}]*background: transparent;[^}]*box-shadow: none;/s);
  assert.match(html, /\.fullscreen-control\{position:absolute;bottom:0;right:0/, "Plein écran ancré en bas à droite en vue normale");
  assert.match(app, /window\.visualViewport\?\.addEventListener\("resize", scheduleTreePickerMenuPosition/);
  assert.match(css, /\.tree-shell\.tree-fullscreen-active \.fullscreen-control \{[^}]*top: 0;[^}]*right: 0/);
  assert.match(css, /@media \(min-width: 761px\) and \(pointer: fine\) \{\s*\.tree-shell\.tree-fullscreen-active \.fullscreen-control \{ display: none; \}/);
  assert.match(css, /\.tree-menu::backdrop \{ background: transparent; backdrop-filter: none;/);
  assert.match(css, /\.tree-menu\.is-bottom-sheet::backdrop \{ background: rgb\(27 38 33 \/ 42%\); backdrop-filter: blur\(3px\);/);
  assert.match(css, /\.tree-shell\.tree-fullscreen-active \.tree-menu #menuFitBtn \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 390px\)/);
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
           assert.ok(!(await page.locator("#zoomInBtn").isVisible()) && !(await page.locator("#zoomOutBtn").isVisible()), `${name} : Zoom ± masqué en vue normale mobile`);
           assert.equal(await page.locator(".zoom-control").evaluate(element => getComputedStyle(element).display), "none", `${name} : aucun espace réservé aux zooms en vue normale`);
          assert.ok(!(await page.locator("#fullscreenFitBtn").isVisible()), `${name} : Ajuster masqué hors plein écran`);
          assert.ok(!(await page.locator("#treeSearchToggleBtn").isVisible()), `${name} : loupe masquée hors plein écran`);
           await page.locator("#treeMoreBtn").tap();
           await assertMenuInsideViewport(page, `${name} menu normal mobile`, ["Ajuster", "Recentrer", "Réorganiser", "Exporter"]);
           const sheetCenter = await centerOfView(page);
           await page.mouse.click(2, 2);
           await page.waitForFunction(() => !document.getElementById("treeMenu").open);
           assert.equal(await page.locator("#treeMoreBtn").getAttribute("aria-expanded"), "false", `${name} : fermeture du bottom sheet par l’arrière-plan`);
           const sheetClosedCenter = await centerOfView(page);
           assert.ok(Math.abs(sheetCenter.scale - sheetClosedCenter.scale) < 1e-6 && Math.abs(sheetCenter.worldX - sheetClosedCenter.worldX) < 1 && Math.abs(sheetCenter.worldY - sheetClosedCenter.worldY) < 1,
             `${name} : ouverture/fermeture du bottom sheet sans déplacer ni zoomer l’arbre`);
           await page.locator("#treeMoreBtn").tap();
           await page.keyboard.press("Escape");
           assert.equal(await page.locator("#treeMenu").evaluate(element => element.open), false, `${name} : Échap ferme le bottom sheet`);
           assert.equal(await page.locator("#treeMoreBtn").getAttribute("aria-expanded"), "false", `${name} : déclencheur désactivé après fermeture`);
           await page.locator("#treeMoreBtn").tap();
           await page.locator("#treeMenu").dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientY: 80 });
           await page.locator("#treeMenu").dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", clientY: 150 });
           assert.equal(await page.locator("#treeMenu").evaluate(element => element.open), false, `${name} : balayage vers le bas ferme le bottom sheet`);

           await page.locator("#treeFullscreenBtn").tap();
           await page.waitForFunction(() => document.documentElement.classList.contains("tree-fullscreen-fallback"));
          await page.waitForTimeout(100);
          assert.equal(await page.locator("#topbar").evaluate(element => getComputedStyle(element).display), "none", `${name} : navigation extérieure masquée`);
            assert.equal(await page.locator("#treeFullscreenBtn").getAttribute("title"), "Quitter le plein écran");
            assert.equal(await page.locator("#treeFullscreenBtn").getAttribute("aria-label"), "Quitter le plein écran de l’arbre");
            assert.equal(await page.locator("#treeFullscreenBtn use").getAttribute("href"), "#icon-close", `${name} : la croix est l’unique commande de sortie`);
           assert.equal(await page.locator("#treeFullscreenBtn").getAttribute("aria-pressed"), "true");
            assert.ok(!(await page.locator("#zoomInBtn").isVisible()) && !(await page.locator("#zoomOutBtn").isVisible()), `${name} : commandes de zoom masquées en plein écran mobile`);

            await assertFullscreenBarOrder(page, `${name} plein écran 390px`, MOBILE_FULLSCREEN_BAR);
           assert.ok(!(await page.locator("#zoomInBtn").isVisible()) && !(await page.locator("#zoomOutBtn").isVisible()), `${name} : zoom ± ne sont pas dans la barre immersive`);
           assert.equal(await page.locator("#treeFullscreenBtn").evaluate(button => button.getClientRects().length > 0), true, `${name} : croix de sortie conservée sur mobile`);
          await page.locator("#treeMoreBtn").tap();
           assert.deepEqual(await visibleMenuLabels(page), ["Recentrer", "Réorganiser", "Exporter"],
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
          await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
          assert.equal(await page.locator("#personDetailView").isVisible(), true, `${name} : page Personne ouvrable`);
          await page.locator("#personPageBackBtn:visible, #personPageMobileBackBtn:visible").first().click();
          await page.waitForFunction(() => document.getElementById("personDetailView").hidden);
          await page.waitForFunction(() => document.documentElement.classList.contains("tree-fullscreen-active"));

          // Le zoom tactile par pincement reste disponible dans le plein écran mobile.
          const zoomedScale = await pinchTree(page, 120, 200);
          const zoomed = await centerOfView(page);
          assert.ok(Math.abs(zoomed.scale - zoomedScale) < 1e-6 && zoomed.scale > before.scale, `${name} : pincement tactile zoome en plein écran sans boutons ±`);
          await page.locator("#fullscreenFitBtn").tap();
          const fitted = await centerOfView(page);
          assert.ok(fitted.scale !== zoomed.scale, `${name} : Ajuster agit depuis la barre`);
           await page.locator("#treeMoreBtn").tap();
           assert.deepEqual(await visibleMenuLabels(page), ["Recentrer", "Réorganiser", "Exporter"], `${name} : Ajuster non dupliqué, Recentrer conservé`);
           await page.locator("#centerTreeBtn").tap();
           const centeredAgain = await centerOfView(page);
           assert.ok(Math.abs(centeredAgain.scale - fitted.scale) < 1e-6, `${name} : Recentrer conserve l’échelle`);

          // Le pincement inverse atteint toujours le plancher de 10 %.
          const zoomedOutScale = await pinchTree(page, 200, 70);
          const zoomedOut = await centerOfView(page);
          assert.ok(Math.abs(zoomedOut.scale - zoomedOutScale) < 1e-6, `${name} : pincement inverse conservé en plein écran`);
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
             const expectedFullscreenBar = await page.evaluate(() => matchMedia("(pointer: coarse)").matches)
               ? MOBILE_FULLSCREEN_BAR
               : DESKTOP_FULLSCREEN_BAR;
             await assertFullscreenBarOrder(page, `${name} ${size.join("×")}`, expectedFullscreenBar);
             await page.locator("#treeMoreBtn").tap();
             const expectedMenu = ["Recentrer", "Réorganiser", "Exporter"];
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
           assert.ok(!(await page.locator("#zoomInBtn").isVisible()) && !(await page.locator("#zoomOutBtn").isVisible()), `${name} : zooms remasqués après sortie du plein écran`);
          await page.locator("#treeFullscreenBtn").tap();
          await page.waitForFunction(() => document.documentElement.classList.contains("tree-fullscreen-active"));
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => !document.documentElement.classList.contains("tree-fullscreen-active"));
          await page.locator("#treeScene .person").first().click();
          assert.equal(await page.locator("#personDetailView").isVisible(), true, `${name} : accès à la page Personne préservé`);
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
         assert.ok(await page.locator("#zoomInBtn").isVisible() && await page.locator("#zoomOutBtn").isVisible(), `${width}px : zoom conservé en vue normale desktop`);
        await page.locator("#treeFullscreenBtn").click();
        await page.waitForFunction(() => document.documentElement.classList.contains("tree-fullscreen-active"));
        await page.waitForTimeout(100);
         assert.equal(await page.evaluate(() => document.fullscreenElement === document.getElementById("treeViewport")), true, `${width}px : plein écran natif`);
         await assertFullscreenBarOrder(page, `${width}px desktop`, DESKTOP_FULLSCREEN_BAR);
         assert.equal(await page.locator("#treeFullscreenBtn").evaluate(button => button.getClientRects().length), 0, `${width}px : aucune croix X superflue en plein écran desktop`);

        // Toutes les commandes de la barre fonctionnent.
        const initial = await centerOfView(page);
        await page.locator("#zoomInBtn").click();
        assert.ok((await centerOfView(page)).scale > initial.scale, `${width}px : Zoom +`);
        await page.locator("#zoomOutBtn").click();
        assert.ok(Math.abs((await centerOfView(page)).scale - initial.scale) < 0.01, `${width}px : Zoom −`);
        await page.locator("#fullscreenFitBtn").click();
        const fitted = await centerOfView(page);
        assert.ok(fitted.scale >= 0.25 - 1e-6, `${width}px : Ajuster avec minimum 25 %`);
         await page.locator("#treeMoreBtn").click();
         assert.deepEqual(await visibleMenuLabels(page), ["Recentrer", "Réorganiser", "Exporter"], `${width}px : Ajuster absent du menu en doublon`);
         await page.locator("#centerTreeBtn").click();
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
         await assertMenuInsideViewport(page, `${width}px desktop`, ["Recentrer", "Réorganiser", "Exporter"]);
         assert.equal(await page.locator("#treeMoreBtn").evaluate(button => getComputedStyle(button).backgroundColor), "rgb(243, 238, 229)", `${width}px : fond actif pendant l’ouverture`);
         await page.mouse.click(4, 4);
         await page.waitForFunction(() => !document.getElementById("treeMenu").open);
         assert.equal(await page.locator("#treeMoreBtn").getAttribute("aria-expanded"), "false", `${width}px : clic extérieur ferme le menu`);
         assert.equal(await page.locator("#treeMoreBtn").evaluate(button => getComputedStyle(button).backgroundColor), "rgba(0, 0, 0, 0)", `${width}px : fond actif effacé immédiatement à la fermeture`);
         await page.locator("#treeMoreBtn").click();
         await assertMenuInsideViewport(page, `${width}px menu réouvert`, ["Recentrer", "Réorganiser", "Exporter"]);
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
