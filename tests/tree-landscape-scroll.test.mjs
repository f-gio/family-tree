import assert from "node:assert/strict";
import test from "node:test";
import { webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

test("la page Arbre défile en paysage sans transformer le canvas en zone de scroll", async t => {
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (error) {
    throw new Error(`WebKit indisponible : ${error.message}`);
  }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({
    locale: "fr-FR",
    hasTouch: true,
    viewport: { width: 390, height: 844 }
  });
  await context.route("**/*", route => route.request().url().startsWith(server.baseURL)
    ? route.continue()
    : route.abort("blockedbyclient"));
  const page = await context.newPage();
  try {
    for (const viewport of [
      { name: "portrait 320×844", width: 320, height: 844, portrait: true },
      { name: "portrait 390×844", width: 390, height: 844, portrait: true },
      { name: "paysage 667×375", width: 667, height: 375, portrait: false },
      { name: "paysage 844×390", width: 844, height: 390, portrait: false },
      { name: "desktop 1024×768", width: 1024, height: 768, desktop: true }
    ]) {
      await t.test(viewport.name, async tViewport => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(server.baseURL, { waitUntil: "load" });
        await page.evaluate(async () => {
          document.getElementById("authScreen").hidden = true;
          document.getElementById("topbar").hidden = false;
          for (const id of ["appMain", "directoryView", "documentsView", "tasksView", "dossiersView"]) {
            document.getElementById(id).hidden = id !== "appMain";
          }
          const { createTreeCamera } = await import("./js/tree-camera.js");
          window.__testCamera = createTreeCamera({
            viewport: document.getElementById("treeViewport"),
            scene: document.getElementById("treeScene")
          });
        });
        const before = await page.evaluate(() => {
          const root = document.scrollingElement;
          const body = document.body;
          const main = document.getElementById("appMain");
          const shell = document.getElementById("treeViewport");
          const status = document.querySelector("#appMain .tree-sync-status");
          const controls = document.querySelector("#appMain .tree-controls");
          const rect = element => {
            const box = element.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
          };
          const css = element => {
            const style = getComputedStyle(element);
            return { height: style.height, minHeight: style.minHeight, overflow: style.overflow, overflowY: style.overflowY, position: style.position, touchAction: style.touchAction, overscrollBehavior: style.overscrollBehavior };
          };
          return {
            document: { height: root.scrollHeight, clientHeight: root.clientHeight, scrollTop: root.scrollTop, scrollY: window.scrollY, width: root.scrollWidth, clientWidth: root.clientWidth },
            body: css(body),
            main: { ...css(main), height: rect(main).height, scrollHeight: main.scrollHeight, clientHeight: main.clientHeight },
            shell: { ...css(shell), ...rect(shell), scrollHeight: shell.scrollHeight, clientHeight: shell.clientHeight },
            status: { ...rect(status), display: getComputedStyle(status).display },
            controls: rect(controls),
            introDisplay: getComputedStyle(document.querySelector("#appMain .intro")).display,
            canvasTouchAction: getComputedStyle(shell).touchAction
          };
        });
        assert.equal(before.canvasTouchAction, "none", "les gestes sur le canvas restent réservés au pan/zoom");
        assert.ok(before.document.width <= before.document.clientWidth, "aucun débordement horizontal");
        assert.equal(before.shell.overflow, "hidden", "le canvas n’est pas un conteneur de scroll");
        assert.ok(before.shell.scrollHeight <= before.shell.clientHeight + 1, "le canvas n’ajoute pas de scroll vertical interne");

        let landscapeScroll = null;
        if (viewport.portrait) {
          assert.ok(before.document.height <= before.document.clientHeight + 1, "aucun scroll artificiel en portrait");
          assert.ok(before.status.bottom <= viewport.height, "Synchronisé tient encore dans le viewport portrait");
        } else if (!viewport.desktop) {
          tViewport.diagnostic(`avant scroll ${JSON.stringify(before)}`);
          assert.ok(before.document.height > before.document.clientHeight, `le contenu paysage dépasse : ${JSON.stringify(before)}`);
          assert.notEqual(before.status.display, "none", "l’état Synchronisé n’est pas masqué en paysage");
          assert.notEqual(before.introDisplay, "none", "l’en-tête et son contenu ne sont pas masqués en paysage");
          assert.equal(before.main.overflow, "visible", "main#appMain ne crée pas un second scroll container");
          assert.ok(before.main.scrollHeight <= before.main.clientHeight + 1, "le défilement appartient au document, pas à main#appMain");
          await page.mouse.move(20, Math.min(20, viewport.height - 1));
          await page.mouse.wheel(0, Math.max(80, before.shell.y - 30));
          await page.waitForTimeout(80);
          landscapeScroll = await page.evaluate(() => ({
            scrollTop: document.scrollingElement.scrollTop,
            scrollY: window.scrollY,
            statusBottom: document.querySelector("#appMain .tree-sync-status").getBoundingClientRect().bottom,
            viewportHeight: window.innerHeight,
            shell: document.getElementById("treeViewport").getBoundingClientRect().toJSON(),
            documentHeight: document.scrollingElement.scrollHeight,
            clientHeight: document.scrollingElement.clientHeight
          }));
          assert.ok(landscapeScroll.scrollTop > before.document.scrollTop || landscapeScroll.scrollY > before.document.scrollY, `le scroll du document augmente : ${JSON.stringify(landscapeScroll)}`);
          assert.ok(landscapeScroll.shell.top < landscapeScroll.viewportHeight, "le canvas devient atteignable après le scroll");
          assert.ok(landscapeScroll.documentHeight > landscapeScroll.clientHeight, "le document reste naturellement plus haut que le viewport");
          assert.equal(before.canvasTouchAction, "none", "le canvas conserve son interaction tactile de pan");
          tViewport.diagnostic(`avant ${JSON.stringify(before)}; après scroll vers le canvas ${JSON.stringify(landscapeScroll)}`);
        } else {
          assert.ok(before.document.width <= before.document.clientWidth, "aucun overflow horizontal desktop");
          assert.ok(before.document.height <= before.document.clientHeight + 1, "aucun scroll desktop artificiel");
          assert.ok(before.status.bottom <= viewport.height, "état sous le canvas sans déplacement desktop");
        }

        await page.evaluate(() => window.__testCamera.zoomBy(0.5));
        const initialCamera = await page.evaluate(() => window.__testCamera.getState());
        const shellBox = await page.locator("#treeViewport").boundingBox();
        const topbarBox = await page.locator("#topbar").boundingBox();
        assert.ok(shellBox && shellBox.height > 20, "canvas présent");
        const startX = shellBox.x + shellBox.width / 2;
        const startY = Math.max(1, shellBox.y + 18, (topbarBox?.y ?? 0) + (topbarBox?.height ?? 0) + 5);
        assert.ok(startY < Math.min(shellBox.y + shellBox.height, viewport.height), "une portion du canvas est atteignable pour le pan");
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 24, startY + 18, { steps: 3 });
        await page.mouse.up();
        const afterPan = await page.evaluate(() => window.__testCamera.getState());
        await page.mouse.move(startX + 40, startY + 40);
        await page.mouse.wheel(0, -120);
        const afterZoom = await page.evaluate(() => window.__testCamera.getState());
        assert.ok(afterPan.x !== initialCamera.x || afterPan.y !== initialCamera.y, "le glisser continue de déplacer le canvas");
        assert.ok(afterZoom.scale > afterPan.scale, "la molette continue de zoomer le canvas");
        assert.ok(await page.locator("#treeMoreBtn").count(), "le menu des contrôles du canvas reste présent");
        if (landscapeScroll) {
          await page.mouse.move(20, Math.min(20, viewport.height - 1));
          await page.mouse.wheel(0, 700);
          await page.waitForTimeout(80);
          const reachableStatus = await page.evaluate(() => ({
            scrollTop: document.scrollingElement.scrollTop,
            scrollY: window.scrollY,
            statusBottom: document.querySelector("#appMain .tree-sync-status").getBoundingClientRect().bottom,
            viewportHeight: window.innerHeight
          }));
          assert.ok(reachableStatus.statusBottom <= reachableStatus.viewportHeight, `Synchronisé devient atteignable après scroll : ${JSON.stringify(reachableStatus)}`);
          assert.ok(reachableStatus.scrollTop >= landscapeScroll.scrollTop || reachableStatus.scrollY >= landscapeScroll.scrollY, "le scroll vertical reste actif après les interactions du canvas");
          tViewport.diagnostic(`Synchronisé atteignable : ${JSON.stringify(reachableStatus)}`);
        }
      });
    }
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
