import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { test } from "node:test";
import { chromium, webkit } from "playwright";

const DIST = resolve("dist-recette");

function createPdf(pageCount = 3) {
  const objects = [];
  const kids = Array.from({ length: pageCount }, (_, index) => `${3 + index * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let page = 1; page <= pageCount; page++) {
    const pageObject = 3 + (page - 1) * 2;
    const contentObject = pageObject + 1;
    const text = `Page de test ${page}`;
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${pageCount * 2 + 3} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const chunks = [Buffer.from("%PDF-1.4\n%âãÏÓ\n", "binary")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "binary");
    chunks.push(chunk);
    length += chunk.length;
  });
  const xrefOffset = length;
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, "binary"));
  return Buffer.concat(chunks);
}

const fixture = createPdf(24);
const requestedPaths = [];
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    requestedPaths.push(pathname);
    if (pathname === "/fixture.pdf") {
      response.writeHead(200, { "content-type": "application/pdf", "content-length": fixture.length });
      response.end(fixture);
      return;
    }
    if (pathname === "/invalid.pdf") {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end("not a PDF");
      return;
    }
    if (pathname === "/slow.pdf") {
      setTimeout(() => {
        if (!response.destroyed) {
          response.writeHead(200, { "content-type": "application/pdf", "content-length": fixture.length });
          response.end(fixture);
        }
      }, 500);
      return;
    }
    const relative = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
    const target = resolve(join(DIST, relative));
    assert.ok(target.startsWith(`${DIST}\\`), "chemin servi dans dist-recette");
    const bytes = await readFile(target);
    response.writeHead(200, { "content-type": contentTypes[extname(target).toLowerCase()] || "application/octet-stream" });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--control-touch:44px;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--radius-sm:4px;--color-surface:#fff;--color-text:#222;--color-brand:#285a43;--color-surface-muted:#ddd;--border-default:1px solid #aaa;--shadow-low:0 1px 3px #777}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font:14px sans-serif}.document-original-panel{display:flex;flex-direction:column;height:100%;min-width:0;min-height:0}.pdf-viewer-controls{display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:center}.viewer-body{display:flex;flex:1;min-height:0;min-width:0}.pdf-viewer-surface{height:100%}.pdf-thumbnail-rail[hidden]{display:none!important}
</style><section class="document-original-panel"><div id="viewerPdfControls" class="pdf-viewer-controls" role="group"><button id="pdfThumbnailsBtn" type="button" aria-expanded="true">Miniatures</button><button id="pdfPreviousPageBtn" type="button">Précédente</button><output id="pdfPageStatus"></output><button id="pdfNextPageBtn" type="button">Suivante</button><button id="pdfZoomOutBtn" type="button">−</button><span id="pdfZoomIndicator"></span><button id="pdfZoomInBtn" type="button">+</button><button id="pdfFitModeBtn" type="button">Adapter</button><button id="pdfFullscreenBtn" type="button" aria-label="Afficher en plein écran">Plein écran</button></div><div id="viewerImageViewport" class="viewer-body"><p id="viewerMessage" hidden></p><div id="viewerPdfSurface" class="pdf-viewer-surface"><aside id="viewerPdfThumbnails" class="pdf-thumbnail-rail"><div id="viewerPdfThumbnailList" class="pdf-thumbnail-list"></div></aside><div id="viewerPdfPageViewport" class="pdf-page-viewport" tabindex="0"><canvas id="viewerPdfPageCanvas" class="pdf-page-canvas"></canvas></div></div></div></section>`;

async function makeViewer(browserType, viewportSize) {
  const browser = await browserType.launch({ headless: true });
  const page = await browser.newPage({ viewport: viewportSize });
  await page.goto(`${baseUrl}/`);
  await page.setContent(html);
  await page.addStyleTag({ url: `${baseUrl}/css/design-system.css` });
  const result = await page.evaluate(async ({ url }) => {
    const { createDocumentPdfViewer } = await import(`${url}/js/document-pdf-viewer.js`);
    const get = id => document.getElementById(id);
    const state = await createDocumentPdfViewer({
      source: `${url}/fixture.pdf`, viewer: get("viewerPdfSurface"), loadingMessage: get("viewerMessage"),
      thumbnailRail: get("viewerPdfThumbnails"), thumbnailList: get("viewerPdfThumbnailList"),
      pageViewport: get("viewerPdfPageViewport"), pageCanvas: get("viewerPdfPageCanvas"), pageStatus: get("pdfPageStatus"),
      previousButton: get("pdfPreviousPageBtn"), nextButton: get("pdfNextPageBtn"), zoomOutButton: get("pdfZoomOutBtn"), zoomInButton: get("pdfZoomInBtn"),
      fitModeButton: get("pdfFitModeBtn"), thumbnailsButton: get("pdfThumbnailsBtn"), fullscreenButton: get("pdfFullscreenBtn"),
      fullscreenHost: get("viewerPdfSurface"), fullscreenRoot: document.documentElement, zoomIndicator: get("pdfZoomIndicator")
    });
    window.pdfViewerTestState = state;
    return state.getState();
  }, { url: baseUrl });
  return { browser, page, result };
}

test("PDF.js : rendu multipage, commandes, responsive, erreurs et nettoyage Chromium/WebKit", async () => {
  try {
    for (const [engine, viewport] of [[chromium, { width: 1280, height: 900 }], [webkit, { width: 1280, height: 900 }], [chromium, { width: 390, height: 844 }], [webkit, { width: 390, height: 844 }]]) {
      const { browser, page, result } = await makeViewer(engine, viewport);
      try {
        assert.equal(result.numPages, 24, "PDF volumineux de test chargé");
        assert.ok(requestedPaths.includes("/vendor/pdfjs/pdf.worker.mjs"), "worker PDF.js chargé depuis l’artefact local");
        assert.ok(requestedPaths.includes("/fixture.pdf"), "PDF de test chargé depuis la même origine");
        await page.waitForFunction(() => document.querySelector("#viewerPdfPageCanvas").width > 0);
        assert.equal(await page.locator(".pdf-thumbnail").count(), 24);
        assert.match(await page.locator("#pdfPageStatus").textContent(), /Page 1 \/ 24/);
        const bounds = await page.evaluate(() => ({ canvas: document.querySelector("#viewerPdfPageCanvas").getBoundingClientRect().toJSON(), viewport: document.querySelector("#viewerPdfPageViewport").getBoundingClientRect().toJSON(), rail: document.querySelector("#viewerPdfThumbnails").getBoundingClientRect().toJSON(), scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth }));
        assert.ok(bounds.canvas.width > 0 && bounds.canvas.height > 0);
        assert.ok(bounds.canvas.left >= bounds.viewport.left - 1 && bounds.canvas.right <= bounds.viewport.right + 1, "page entière initialement visible");
        if (viewport.width > 600) assert.ok(bounds.rail.left < bounds.viewport.left, "miniatures verticales à gauche sur desktop");
        else assert.ok(bounds.rail.top > bounds.viewport.top, "miniatures horizontales sous le document sur mobile");
        assert.ok(bounds.scrollWidth <= bounds.innerWidth, "pas de débordement horizontal");

        await page.locator("#pdfNextPageBtn").click();
        await page.waitForFunction(() => document.querySelector("#pdfPageStatus").textContent.includes("Page 2 / 24"));
        await page.locator('.pdf-thumbnail[data-pdf-page="24"]').click();
        await page.waitForFunction(() => document.querySelector("#pdfPageStatus").textContent.includes("Page 24 / 24"));
        await page.locator("#pdfPreviousPageBtn").click();
        await page.waitForFunction(() => document.querySelector("#pdfPageStatus").textContent.includes("Page 23 / 24"));
        const beforeZoom = await page.evaluate(() => window.pdfViewerTestState.getState().zoom);
        await page.locator("#pdfZoomInBtn").click();
        await page.waitForFunction(value => window.pdfViewerTestState.getState().zoom > value, beforeZoom);
        await page.locator("#pdfFitModeBtn").click();
        await page.waitForFunction(() => window.pdfViewerTestState.getState().fitMode === "width");
        await page.locator("#pdfFitModeBtn").click();
        await page.waitForFunction(() => window.pdfViewerTestState.getState().fitMode === "page");
        await page.locator("#pdfThumbnailsBtn").click();
        assert.equal(await page.locator("#viewerPdfThumbnails").evaluate(el => el.hidden), true);
        await page.locator("#pdfThumbnailsBtn").click();

        if (viewport.width <= 600) {
          await page.setViewportSize({ width: 844, height: 390 });
          await page.waitForTimeout(100);
          const rotated = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, canvas: document.querySelector("#viewerPdfPageCanvas").getBoundingClientRect().toJSON() }));
          assert.ok(rotated.width <= rotated.viewport, "pas de débordement après rotation simulée");
          assert.ok(rotated.canvas.width > 0 && rotated.canvas.height > 0);
        }
        await page.locator("#pdfFullscreenBtn").click();
        await page.waitForFunction(() => document.documentElement.classList.contains("viewer-fullscreen-active") || document.documentElement.classList.contains("is-viewer-fullscreen"));
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.documentElement.classList.contains("viewer-fullscreen-active") && !document.documentElement.classList.contains("is-viewer-fullscreen"));
        await page.evaluate(() => window.pdfViewerTestState.destroy());
        assert.equal(await page.locator(".pdf-thumbnail").count(), 0, "miniatures nettoyées à la fermeture");
      } finally {
        await browser.close();
      }
    }
  } finally {
    // Le serveur est partagé par le test des cas d’échec plus bas.
  }
});

test("PDF.js : PDF invalide et échec HTTP déclenchent le repli sans boucle", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/`);
    await page.setContent(html);
    const trySource = source => page.evaluate(async ({ url, source }) => {
      const { createDocumentPdfViewer } = await import(`${url}/js/document-pdf-viewer.js`);
      const get = id => document.getElementById(id);
      const result = await createDocumentPdfViewer({ source, viewer: get("viewerPdfSurface"), loadingMessage: get("viewerMessage"), thumbnailRail: get("viewerPdfThumbnails"), thumbnailList: get("viewerPdfThumbnailList"), pageViewport: get("viewerPdfPageViewport"), pageCanvas: get("viewerPdfPageCanvas"), pageStatus: get("pdfPageStatus"), previousButton: get("pdfPreviousPageBtn"), nextButton: get("pdfNextPageBtn"), zoomOutButton: get("pdfZoomOutBtn"), zoomInButton: get("pdfZoomInBtn"), fitModeButton: get("pdfFitModeBtn"), thumbnailsButton: get("pdfThumbnailsBtn"), fullscreenButton: get("pdfFullscreenBtn") });
      return { fallback: result.fallback, hidden: get("viewerPdfSurface").hidden };
    }, { url: baseUrl, source });
    for (const source of [`${baseUrl}/invalid.pdf`, `${baseUrl}/missing.pdf`]) {
      const fallback = await trySource(source);
      assert.equal(fallback.fallback, true);
      assert.equal(fallback.hidden, true);
    }
  } finally {
    await browser.close();
  }
});

test("PDF.js : disposition réelle du dialog Consulter (miniatures à gauche, page visible à droite)", async () => {
  const source = await readFile(new URL("../dist-recette/index.html", import.meta.url), "utf8");
  const inlineStyles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join("\n");
  const dialogStart = source.indexOf('<dialog id="documentViewerDialog"');
  const dialogEnd = source.indexOf("</dialog>", dialogStart) + "</dialog>".length;
  const dialogMarkup = source.slice(dialogStart, dialogEnd);
  const closeInViewer = page => page.evaluate(u => (async () => {
    const { createDocumentPdfViewer } = await import(`${u}/js/document-pdf-viewer.js`);
    const get = id => document.getElementById(id);
    const dialog = get("documentViewerDialog");
    dialog.showModal();
    layout: {
      const layout = get("documentUnifiedLayout");
      layout.classList.add("is-details-collapsed");
      get("viewerDocumentDetails").hidden = true;
    }
    get("viewerImageControls").hidden = false;
    get("viewerImageControls").append(get("viewerPdfControls"));
    get("viewerPdfControls").hidden = false;
    get("viewerImageControls").append(get("viewerExternalBtn"));
    get("viewerExternalBtn").hidden = false;
    get("viewerImageViewport").classList.add("viewer-pdf-active");
    get("viewerImageViewport").append(get("viewerPdfSurface"));
    get("viewerPdfSurface").hidden = false;
    get("viewerFrame").hidden = true;
    get("viewerImage").hidden = true;
    get("viewerMessage").hidden = true;
    window.pdfViewerTestState = await createDocumentPdfViewer({
      source: `${u}/fixture.pdf`, viewer: get("viewerPdfSurface"), loadingMessage: get("viewerMessage"),
      thumbnailRail: get("viewerPdfThumbnails"), thumbnailList: get("viewerPdfThumbnailList"),
      pageViewport: get("viewerPdfPageViewport"), pageCanvas: get("viewerPdfPageCanvas"), pageStatus: get("pdfPageStatus"),
      previousButton: get("pdfPreviousPageBtn"), nextButton: get("pdfNextPageBtn"), zoomOutButton: get("pdfZoomOutBtn"), zoomInButton: get("pdfZoomInBtn"),
      fitModeButton: get("pdfFitModeBtn"), thumbnailsButton: get("pdfThumbnailsBtn"), fullscreenButton: get("pdfFullscreenBtn"),
      fullscreenHost: dialog.querySelector(".document-original-panel"), fullscreenRoot: dialog, zoomIndicator: get("pdfZoomIndicator")
    });
  })(), baseUrl);
  const measureAll = page => page.evaluate(select => Object.fromEntries(select.map(id => {
    const element = document.getElementById(id);
    const rect = element.getBoundingClientRect();
    return [id, { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, width: rect.width, height: rect.height }];
  })), ["viewerPdfControls", "viewerPdfSurface", "viewerPdfThumbnails", "viewerPdfPageViewport", "viewerPdfPageCanvas", "viewerImageViewport", "pdfThumbnailsBtn", "pdfPreviousPageBtn", "pdfPageStatus", "pdfNextPageBtn", "pdfZoomOutBtn", "pdfZoomInBtn", "pdfFitModeBtn", "pdfFullscreenBtn", "viewerExternalBtn"]);
  const pageDocument = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="${baseUrl}/css/design-system.css"><style>${inlineStyles}</style></head><body>${dialogMarkup}</body></html>`;

  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.setContent(pageDocument, { waitUntil: "load" });
    await closeInViewer(page);
    await page.waitForFunction(() => document.getElementById("viewerPdfPageCanvas").width > 0, undefined, { timeout: 15000 });
    assert.equal(await page.locator(".pdf-thumbnail").count(), 24);
    const desktop = await measureAll(page);
    assert.ok(desktop.viewerPdfThumbnails.width >= 160 && desktop.viewerPdfThumbnails.width <= 200, `colonne miniatures entre 160 et 200 px (${desktop.viewerPdfThumbnails.width})`);
    assert.ok(desktop.viewerPdfThumbnails.right <= desktop.viewerPdfPageViewport.x + 1, "miniatures isolées à gauche, sans chevauchement avec la page");
    assert.ok(desktop.viewerPdfPageViewport.width >= 300, "la page principale occupe la largeur restante");
    assert.ok(desktop.viewerPdfPageCanvas.x >= desktop.viewerPdfPageViewport.x - 1 && desktop.viewerPdfPageCanvas.right <= desktop.viewerPdfPageViewport.right + 1, "canvas dans le viewport en largeur");
    assert.ok(desktop.viewerPdfPageCanvas.y >= desktop.viewerPdfPageViewport.y - 1 && desktop.viewerPdfPageCanvas.bottom <= desktop.viewerPdfPageViewport.bottom + 1, "page entière visible à droite, sans coupe");
    assert.ok(desktop.viewerPdfPageCanvas.height >= 200 && desktop.viewerPdfPageCanvas.width >= 200, "page principale lisible");
    assert.ok(desktop.viewerPdfControls.bottom <= desktop.viewerPdfPageViewport.y + 1, "barre d’outils au-dessus de la page");
    assert.ok(desktop.viewerPdfThumbnails.y >= desktop.viewerImageViewport.y - 1 && desktop.viewerPdfThumbnails.bottom <= desktop.viewerImageViewport.bottom + 1, "la colonne de miniatures tient dans le lecteur");
    const orderX = ["pdfThumbnailsBtn", "pdfPreviousPageBtn", "pdfPageStatus", "pdfNextPageBtn", "pdfZoomOutBtn", "pdfZoomInBtn", "pdfFitModeBtn", "pdfFullscreenBtn"].map(id => desktop[id].x);
    assert.deepEqual(orderX, [...orderX].sort((a, b) => a - b), "ordre des commandes : miniatures, précédente, statut, suivante, zoom, ajustement, plein écran");
    assert.ok(desktop.viewerExternalBtn.x > desktop.pdfFullscreenBtn.x - 1, "ouverture dans un nouvel onglet conservée après le plein écran");
    for (const id of ["pdfThumbnailsBtn", "pdfPreviousPageBtn", "pdfNextPageBtn", "pdfZoomOutBtn", "pdfZoomInBtn", "pdfFitModeBtn", "pdfFullscreenBtn"]) {
      assert.ok(desktop[id].height >= 43.5 && desktop[id].width >= 43.5, `${id} garde une cible tactile d’au moins 44px`);
    }
    assert.match(await page.locator("#pdfPageStatus").textContent(), /Page 1 \/ 24/);
    assert.equal(await page.locator('.pdf-thumbnail[data-pdf-page="1"]').getAttribute("aria-current"), "page");

    await page.locator('.pdf-thumbnail[data-pdf-page="24"]').click();
    await page.waitForFunction(() => document.getElementById("pdfPageStatus").textContent.includes("Page 24 / 24"));
    assert.ok(await page.evaluate(() => document.getElementById("viewerPdfThumbnails").scrollTop) > 0, "la colonne de miniatures défile indépendamment de la page");
    await page.locator("#pdfPreviousPageBtn").click();
    await page.waitForFunction(() => document.getElementById("pdfPageStatus").textContent.includes("Page 23 / 24"));
    await page.locator("#pdfNextPageBtn").click();
    await page.waitForFunction(() => document.getElementById("pdfPageStatus").textContent.includes("Page 24 / 24"));
    assert.equal(await page.locator('.pdf-thumbnail[data-pdf-page="24"]').getAttribute("aria-current"), "page");
    const canvasBefore = desktop.viewerPdfPageCanvas;
    await page.locator("#pdfZoomInBtn").click();
    await page.waitForFunction(() => window.pdfViewerTestState.getState().zoom > 1);
    const canvasZoomed = (await measureAll(page)).viewerPdfPageCanvas;
    assert.ok(canvasZoomed.width > canvasBefore.width, "le zoom agrandit la page");
    await page.evaluate(() => { const viewport = document.getElementById("viewerPdfPageViewport"); viewport.scrollTop = viewport.scrollHeight; viewport.scrollLeft = viewport.scrollWidth; });
    await page.waitForTimeout(80);
    const panned = await measureAll(page);
    assert.ok(panned.viewerPdfPageCanvas.x < panned.viewerPdfPageViewport.x || panned.viewerPdfPageCanvas.y < panned.viewerPdfPageViewport.y, "le panoramique déplace la page zoomée dans son viewport");
    await page.evaluate(() => { const viewport = document.getElementById("viewerPdfPageViewport"); viewport.scrollTop = 0; viewport.scrollLeft = 0; });
    await page.locator("#pdfThumbnailsBtn").click();
    assert.equal(await page.locator("#viewerPdfThumbnails").evaluate(el => el.hidden), true);
    await page.locator("#pdfThumbnailsBtn").click();
    await page.locator("#pdfFullscreenBtn").click();
    await page.waitForFunction(() => document.getElementById("documentViewerDialog").classList.contains("is-viewer-fullscreen"));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("documentViewerDialog").classList.contains("is-viewer-fullscreen"));
    const closed = await measureAll(page);
    assert.ok(closed.viewerPdfPageCanvas.right <= closed.viewerPdfPageViewport.right + 1, "après le plein écran, la page reste cadrée dans son viewport");
  } finally {
    await page?.close();
    await browser.close();
  }

  const mobileBrowser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 844 }]) {
      const page = await mobileBrowser.newPage({ viewport });
      await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.setContent(pageDocument, { waitUntil: "load" });
      await closeInViewer(page);
      await page.waitForFunction(() => document.getElementById("viewerPdfPageCanvas").width > 0, undefined, { timeout: 15000 });
      const mobile = await page.evaluate(() => {
        const box = id => { const rect = document.getElementById(id).getBoundingClientRect(); return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, width: rect.width, height: rect.height }; };
        const rail = document.getElementById("viewerPdfThumbnails");
        return {
          rail: box("viewerPdfThumbnails"), pageViewport: box("viewerPdfPageViewport"), canvas: box("viewerPdfPageCanvas"),
          surface: box("viewerPdfSurface"), toolbar: box("viewerPdfControls"),
          railStyle: getComputedStyle(rail), railScrollWidth: rail.scrollWidth, railClientWidth: rail.clientWidth,
          toolButtons: [...document.querySelectorAll(".pdf-viewer-controls .btn")].map(button => { const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }),
          scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth
        };
      });
      assert.ok(mobile.rail.y >= mobile.pageViewport.bottom - 1, "miniatures horizontales sous la page");
      assert.ok(mobile.rail.width <= mobile.innerWidth + 1, "les miniatures tiennent sur une seule colonne");
      assert.ok(mobile.railStyle.overflowX === "auto", "miniatures défilables horizontalement");
      assert.ok(mobile.railScrollWidth >= mobile.railClientWidth, "les 24 miniatures sont accessibles par défilement");
      assert.ok(mobile.canvas.width > 150 && mobile.canvas.height > 150, "page principale lisible sur mobile");
      assert.ok(mobile.canvas.x >= mobile.pageViewport.x - 1 && mobile.canvas.right <= mobile.pageViewport.right + 1 && mobile.canvas.y >= mobile.pageViewport.y - 1 && mobile.canvas.bottom <= mobile.pageViewport.bottom + 1, "mobile : page initialement ajustée sans coupe");
      assert.ok(mobile.toolbar.bottom <= mobile.surface.y + 1, "barre d’outils compacte au-dessus du lecteur");
      for (const box of mobile.toolButtons) assert.ok(box.height >= 43.5 && box.width >= 43.5, "commandes tactiles d’au moins 44px sur mobile");
      assert.equal(mobile.scrollWidth, viewport.width, `aucun débordement horizontal à ${viewport.width}px`);
      if (viewport.width === 390) {
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForFunction(() => document.getElementById("viewerPdfPageCanvas").height > 0);
        await page.waitForTimeout(120);
        const rotated = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth, canvas: document.getElementById("viewerPdfPageCanvas").getBoundingClientRect().toJSON() }));
        assert.ok(rotated.scrollWidth <= rotated.innerWidth + 1, "rotation : aucun débordement horizontal");
        assert.ok(rotated.canvas.width > 0 && rotated.canvas.height > 0, "rotation : page re-rendue");
      }
      await page.close();
    }
  } finally {
    await mobileBrowser.close();
  }
});

test("Serveur local des tests PDF : arrêt final", async () => {
  if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
});
