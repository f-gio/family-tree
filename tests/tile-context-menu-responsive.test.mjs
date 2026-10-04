import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const widths = [320, 390, 560, 760, 1024];
let browser;
let server;
let page;

async function ellipsisPixelCenter(target, page) {
  // Ne garder que les pixels du glyphe, pas tous les pixels contrastés du fond transparent du bouton.
  const foreground = await target.evaluate(element => getComputedStyle(element).color.match(/\d+/g).slice(0, 3).map(Number));
  const screenshot = await target.screenshot({ animations: "disabled" });
  return page.evaluate(async ({ imageBase64, foreground }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${imageBase64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const backgroundOffset = (2 * width + 2) * 4;
    const background = [...data.slice(backgroundOffset, backgroundOffset + 3)];
    let count = 0, x = 0, y = 0;
    for (let row = 5; row < height - 5; row++) {
      for (let column = 5; column < width - 5; column++) {
        const offset = (row * width + column) * 4;
        const backgroundDistance = Math.hypot(data[offset] - background[0], data[offset + 1] - background[1], data[offset + 2] - background[2]);
        const foregroundDistance = Math.hypot(data[offset] - foreground[0], data[offset + 1] - foreground[1], data[offset + 2] - foreground[2]);
        if (backgroundDistance < 45 || foregroundDistance > 55) continue;
        count++;
        x += column;
        y += row;
      }
    }
    return { width, height, x: count ? x / count : null, y: count ? y / count : null, count };
  }, { imageBase64: screenshot.toString("base64"), foreground });
}

test("tuiles et menus secondaires restent utilisables de 320 px au desktop", async t => {
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    t.skip("Chromium Playwright indisponible");
    return;
  }

  server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR" });
  await context.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(server.baseURL) || url.includes("gstatic.com")
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  page = await context.newPage();
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("authScreen") && document.querySelector("#directoryList"));

  for (const width of widths) {
    await t.test(`${width} px : listes sans débordement, menus visibles et clavier accessibles`, async () => {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => {
        const sections = ["directoryView", "documentsView", "tasksView", "dossiersView"];
        document.getElementById("authScreen").hidden = true;
        document.getElementById("topbar").hidden = false;
        document.getElementById("appMain").hidden = true;
        const menu = (kind, id) => `<div class="tile-context-actions"><button class="tile-context-toggle" type="button" data-tile-menu-toggle aria-haspopup="menu" aria-expanded="false" aria-label="Actions secondaires"><span class="tile-context-glyph" aria-hidden="true"><span class="tile-context-dot"></span><span class="tile-context-dot"></span><span class="tile-context-dot"></span></span></button><div class="tile-context-menu" role="menu" hidden><button class="tile-context-menu-item" type="button" role="menuitem" data-tile-menu-action="delete" data-tile-menu-kind="${kind}" data-tile-menu-id="${id}"><span>Supprimer</span></button></div></div>`;
        document.getElementById("directoryList").innerHTML = `<article class="directory-entry" data-primary-tile tabindex="0" role="group"><span class="directory-avatar">AB</span><div class="directory-main"><h3>Nom long de démonstration</h3><p class="directory-life">Naissance — décès</p></div><div class="directory-entry-actions"><span class="directory-action">📄 12 documents</span>${menu("directory", "fictif")}</div></article>`;
        document.getElementById("documentsList").innerHTML = `<article class="content-card document-card" data-primary-tile data-document-openable="true" tabindex="0" role="group"><div><span class="badge">Acte</span><h3>Document familial de démonstration</h3></div><p class="card-meta">1 janvier 1900 · Turin</p><div class="document-card-details"><p class="document-card-people">Associé à : Prénom Nom, Autre Prénom Autre Nom</p><p class="card-description">Note complémentaire.</p></div><div class="card-actions">${menu("document", "fictif")}</div></article>`;
        document.getElementById("tasksList").innerHTML = `<article class="task-row" data-primary-tile data-task-row="fictif" tabindex="0" role="group"><div class="task-main"><h3>Action de démonstration</h3><span class="task-note">Détail de l’action</span></div><div class="task-assignee">Responsable</div><div class="task-due">Sans date</div><span class="task-priority badge">Moyenne</span><span class="task-status">À faire</span><div class="task-actions">${menu("task", "fictif")}</div></article>`;
        document.getElementById("proceduresList").innerHTML = `<article class="procedure-item" data-primary-tile data-procedure-card="fictif" tabindex="0" role="group"><span class="procedure-updated">Aujourd’hui</span><div><h3 class="procedure-title">Démarche familiale de démonstration</h3><span class="procedure-tags"><span class="procedure-tag">Recherche</span></span></div><span class="procedure-organization">Service municipal</span><span class="procedure-context">Contexte du dossier</span><div class="procedure-tags procedure-item-status"><span class="procedure-tag procedure-status">En cours</span>${menu("procedure", "fictif")}</div></article>`;
        document.getElementById("directoryList").className = "content-grid directory-grid list-mode";
        document.getElementById("documentsList").className = "content-grid list-mode";
      });

      for (const [listId, selector] of [["directoryList", ".directory-entry"], ["documentsList", ".document-card"], ["tasksList", ".task-row"], ["proceduresList", ".procedure-item"]]) {
        await page.evaluate(currentList => {
          const currentView = { directoryList: "directoryView", documentsList: "documentsView", tasksList: "tasksView", proceduresList: "dossiersView" }[currentList];
          for (const id of ["directoryView", "documentsView", "tasksView", "dossiersView"]) {
            const view = document.getElementById(id);
            if (view) view.hidden = id !== currentView;
          }
        }, listId);
        const state = await page.locator(`#${listId}`).evaluate(list => ({
          pageWidth: document.documentElement.clientWidth,
          tile: list.querySelector("[data-primary-tile]"),
          tileRect: (() => { const rect = list.querySelector("[data-primary-tile]")?.getBoundingClientRect(); return rect ? { left: rect.left, right: rect.right, width: rect.width } : null; })(),
          menu: list.querySelector(".tile-context-toggle"),
          toggleMetrics: (() => {
            const toggle = list.querySelector(".tile-context-toggle");
            if (!toggle) return null;
            const box = toggle.getBoundingClientRect();
            const style = getComputedStyle(toggle);
            const glyph = toggle.querySelector(".tile-context-glyph");
            const glyphBox = glyph.getBoundingClientRect();
            const glyphStyle = getComputedStyle(glyph);
            const dots = [...glyph.querySelectorAll(".tile-context-dot")].map(dot => dot.getBoundingClientRect());
            return { width: box.width, height: box.height, display: style.display, alignItems: style.alignItems, justifyItems: style.justifyItems, glyphWidth: glyphBox.width, glyphHeight: glyphBox.height, glyphDisplay: glyphStyle.display, glyphAlignItems: glyphStyle.alignItems, glyphJustifyContent: glyphStyle.justifyContent, glyphCenterY: glyphBox.top + glyphBox.height / 2, buttonCenterX: box.left + box.width / 2, buttonCenterY: box.top + box.height / 2, dotCount: dots.length, dotSizes: dots.map(dot => [dot.width, dot.height]), dotCenterX: dots.map(dot => dot.left + dot.width / 2), dotCenterY: dots.map(dot => dot.top + dot.height / 2) };
          })()
        }));
        assert.ok(state.tile && state.tileRect?.width > 0, `${width}px ${listId}: tuile principale visible`);
        assert.ok(state.tileRect.left >= -1 && state.tileRect.right <= state.pageWidth + 1, `${width}px ${listId}: tuile sans débordement horizontal`);
        assert.equal(await page.locator(`#${listId} ${selector}[tabindex="0"]`).count(), 1, `${width}px ${listId}: tuile au clavier`);
        if (!state.menu) continue;
        assert.ok(state.toggleMetrics.width >= 44 && state.toggleMetrics.height >= 44, `${width}px ${listId}: cible … ≥ 44×44 px`);
        assert.equal(state.toggleMetrics.display, "grid", `${width}px ${listId}: centrage en grille`);
        assert.equal(state.toggleMetrics.alignItems, "center", `${width}px ${listId}: centrage vertical du bouton …`);
        assert.equal(state.toggleMetrics.justifyItems, "center", `${width}px ${listId}: centrage horizontal du bouton …`);
        assert.equal(state.toggleMetrics.glyphDisplay, "flex", `${width}px ${listId}: glyphe hors de la baseline typographique`);
        assert.equal(state.toggleMetrics.glyphAlignItems, "center", `${width}px ${listId}: centrage vertical interne du glyphe`);
        assert.equal(state.toggleMetrics.glyphJustifyContent, "center", `${width}px ${listId}: centrage horizontal interne du glyphe`);
        assert.equal(state.toggleMetrics.glyphWidth, 14, `${width}px ${listId}: largeur du glyphe`);
        assert.equal(state.toggleMetrics.glyphHeight, 14, `${width}px ${listId}: hauteur du glyphe`);
        assert.equal(state.toggleMetrics.dotCount, 3, `${width}px ${listId}: trois points`);
        assert.ok(state.toggleMetrics.dotSizes.every(([dotWidth, dotHeight]) => dotWidth === 3 && dotHeight === 3), `${width}px ${listId}: points circulaires de taille uniforme`);
        const dotCenterX = state.toggleMetrics.dotCenterX.reduce((sum, center) => sum + center, 0) / state.toggleMetrics.dotCenterX.length;
        assert.ok(Math.abs(dotCenterX - state.toggleMetrics.buttonCenterX) < 0.5, `${width}px ${listId}: trio centré horizontalement (${dotCenterX}; bouton ${state.toggleMetrics.buttonCenterX})`);
        assert.ok(state.toggleMetrics.dotCenterY.every(center => Math.abs(center - state.toggleMetrics.buttonCenterY) < 0.5), `${width}px ${listId}: centre géométrique du motif confondu avec celui du bouton`);
        const toggle = page.locator(`#${listId} [data-tile-menu-toggle]`);
        const pixelCenter = await ellipsisPixelCenter(toggle, page);
        assert.ok(pixelCenter.count > 0, `${width}px ${listId}: motif effectivement peint dans la capture`);
        assert.ok(Math.abs(pixelCenter.x - (pixelCenter.width - 1) / 2) <= 1, `${width}px ${listId}: points centrés horizontalement (${pixelCenter.x.toFixed(1)} px)`);
        assert.ok(Math.abs(pixelCenter.y - (pixelCenter.height - 1) / 2) <= 1, `${width}px ${listId}: pixels du glyphe centrés verticalement (${pixelCenter.y.toFixed(1)} px sur ${pixelCenter.height})`);
        await toggle.scrollIntoViewIfNeeded();
        await toggle.click();
        const menuState = await page.locator(`#${listId} .tile-context-menu`).evaluate(menu => {
          const box = menu.getBoundingClientRect();
          const anchor = menu.closest(".tile-context-actions").querySelector("[data-tile-menu-toggle]").getBoundingClientRect();
          return { hidden: menu.hidden, expanded: menu.closest(".tile-context-actions").querySelector("[data-tile-menu-toggle]").getAttribute("aria-expanded"), left: box.left, right: box.right, top: box.top, bottom: box.bottom, anchorTop: anchor.top, anchorBottom: anchor.bottom, height: window.innerHeight, scrollY: window.scrollY };
        });
        assert.equal(menuState.hidden, false, `${width}px ${listId}: menu ouvert`);
        assert.equal(menuState.expanded, "true", `${width}px ${listId}: aria-expanded synchronisé`);
        assert.ok(menuState.left >= 0 && menuState.right <= width, `${width}px ${listId}: menu dans le viewport (${menuState.left}..${menuState.right})`);
        assert.ok(menuState.top >= 0 && menuState.bottom <= 800, `${width}px ${listId}: menu dans le viewport vertical (${menuState.top}..${menuState.bottom}, bouton ${menuState.anchorTop}..${menuState.anchorBottom}, vh=${menuState.height}, scrollY=${menuState.scrollY})`);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(`#${listId} .tile-context-menu`).evaluate(menu => menu.hidden), true, `${width}px ${listId}: Échap ferme le menu`);
        assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-tile-menu-toggle")), true, `${width}px ${listId}: focus restitué au bouton`);
      }
    });
  }

  await page.context().close();
  await browser.close();
  await server.close();
});
