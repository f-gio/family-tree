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
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font:14px sans-serif}.document-original-panel{height:100%;min-width:0;min-height:0}[hidden]{display:none!important}
.document-original-panel:has(.viewer-body.viewer-pdf-active) .pdf-viewer-toolbar{grid-column:2;grid-row:1;display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:center}
.document-original-panel:has(.viewer-body.viewer-pdf-active) .viewer-body{grid-column:2;grid-row:2;display:flex;min-height:0;min-width:0}
.document-original-panel:has(.viewer-body.viewer-pdf-active) .pdf-thumbnail-rail{grid-column:1;grid-row:1/span 3;min-width:0;min-height:0;overflow-y:auto;overflow-x:hidden}
.document-original-panel:has(.viewer-body.viewer-pdf-active) .pdf-pagination{grid-column:2;grid-row:3;display:grid;grid-template-columns:44px 1fr 44px;align-items:center;gap:4px}
@media (max-width:760px){.document-original-panel:has(.viewer-body.viewer-pdf-active){display:flex;flex-direction:column;gap:8px}.document-original-panel:has(.viewer-body.viewer-pdf-active) .pdf-thumbnail-rail{flex:0 0 auto;height:7rem}}
.pdf-page-region{position:relative;display:grid;min-width:0;min-height:0}
</style><section class="document-original-panel"><div id="viewerPdfToolbar" class="pdf-viewer-toolbar" role="group"><button id="pdfThumbnailsBtn" type="button" aria-expanded="true" aria-controls="viewerPdfThumbnails">Miniatures</button><button id="pdfPreviousPageBtn" type="button">Précédente</button><output id="pdfPageStatus"></output><button id="pdfNextPageBtn" type="button">Suivante</button><button id="pdfZoomOutBtn" type="button">−</button><button id="pdfZoomInBtn" type="button">+</button><button id="pdfFitModeBtn" type="button">Adapter</button><button id="pdfFullscreenBtn" type="button" aria-label="Afficher en plein écran">Plein écran</button></div><div id="viewerImageViewport" class="viewer-body"><p id="viewerMessage" hidden></p><div id="viewerPdfSurface" class="pdf-page-region" hidden><div id="viewerPdfPageViewport" class="pdf-page-viewport" tabindex="0"><canvas id="viewerPdfPageCanvas" class="pdf-page-canvas"></canvas></div><span id="pdfZoomIndicator" class="pdf-zoom-indicator"></span></div></div><div id="pdfPageNav" class="pdf-pagination" role="group" hidden></div><div id="pdfPanelToggles" hidden><button id="viewerDetailsBtn" type="button" aria-expanded="false" aria-controls="viewerDocumentDetails">Informations</button></div><aside id="viewerPdfThumbnails" class="pdf-thumbnail-rail" hidden><div id="viewerPdfThumbnailList"></div></aside></section>`;

async function makeViewer(browserType, viewportSize) {
  const browser = await browserType.launch({ headless: true });
  const page = await browser.newPage({ viewport: viewportSize });
  await page.goto(`${baseUrl}/`);
  await page.setContent(html);
  await page.addStyleTag({ url: `${baseUrl}/css/design-system.css` });
  const result = await page.evaluate(async ({ url, wide }) => {
    const { createDocumentPdfViewer } = await import(`${url}/js/document-pdf-viewer.js`);
    const get = id => document.getElementById(id);
    if (wide) {
      const toolbar = get("viewerPdfToolbar");
      for (const id of ["pdfThumbnailsBtn", "pdfPreviousPageBtn", "pdfPageStatus", "pdfNextPageBtn", "pdfZoomOutBtn", "pdfZoomInBtn", "pdfFitModeBtn"]) toolbar.append(get(id));
      get("pdfPageNav").hidden = true;
      get("pdfPanelToggles").hidden = true;
      get("viewerPdfThumbnails").hidden = false;
    } else {
      get("pdfPageNav").append(get("pdfPreviousPageBtn"), get("pdfPageStatus"), get("pdfNextPageBtn"));
      get("pdfPanelToggles").prepend(get("pdfThumbnailsBtn"));
      get("pdfPageNav").hidden = false;
      get("pdfPanelToggles").hidden = false;
      get("viewerPdfThumbnails").hidden = true;
    }
    get("viewerPdfSurface").hidden = false;
    get("viewerImageViewport").classList.add("viewer-pdf-active");
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
  }, { url: baseUrl, wide: viewportSize.width > 760 });
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
        assert.match(await page.locator("#pdfPageStatus").textContent(), /1 \/ 24/);
        const bounds = await page.evaluate(() => ({ canvas: document.querySelector("#viewerPdfPageCanvas").getBoundingClientRect().toJSON(), viewport: document.querySelector("#viewerPdfPageViewport").getBoundingClientRect().toJSON(), railRect: document.querySelector("#viewerPdfThumbnails").getBoundingClientRect().toJSON(), railHidden: document.querySelector("#viewerPdfThumbnails").hidden, scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth }));
        assert.ok(bounds.canvas.width > 0 && bounds.canvas.height > 0);
        assert.ok(bounds.canvas.left >= bounds.viewport.left - 1 && bounds.canvas.right <= bounds.viewport.right + 1, "page entière initialement visible");
        if (viewport.width > 760) assert.ok(bounds.railRect.left < bounds.viewport.left, "miniatures verticales à gauche sur desktop");
        else assert.ok(bounds.railHidden, "miniatures fermées par défaut sur mobile");
        assert.ok(bounds.scrollWidth <= bounds.innerWidth, "pas de débordement horizontal");

        await page.locator("#pdfNextPageBtn").click();
        await page.waitForFunction(() => document.querySelector("#pdfPageStatus").textContent.includes("2 / 24"));
        if (viewport.width > 760) {
          await page.evaluate(() => window.pdfViewerTestState.selectPage(24));
          await page.waitForFunction(() => document.querySelector("#pdfPageStatus").textContent.includes("24 / 24"));
        } else {
          const nextTwice = 22;
          for (let index = 0; index < nextTwice; index++) {
            await page.locator("#pdfNextPageBtn").click();
          }
          await page.waitForFunction(() => document.querySelector("#pdfPageStatus").textContent.includes("24 / 24"));
        }
        await page.locator("#pdfPreviousPageBtn").click();
        await page.waitForFunction(() => document.querySelector("#pdfPageStatus").textContent.includes("23 / 24"));
        const beforeZoom = await page.evaluate(() => window.pdfViewerTestState.getState().zoom);
        await page.locator("#pdfZoomInBtn").click();
        await page.waitForFunction(value => window.pdfViewerTestState.getState().zoom > value, beforeZoom);
        await page.locator("#pdfFitModeBtn").click();
        await page.waitForFunction(() => window.pdfViewerTestState.getState().fitMode === "width");
        await page.locator("#pdfFitModeBtn").click();
        await page.waitForFunction(() => window.pdfViewerTestState.getState().fitMode === "page");
        await page.locator("#pdfThumbnailsBtn").click();
        if (viewport.width > 760) assert.equal(await page.locator("#viewerPdfThumbnails").evaluate(el => el.hidden), true);
        await page.locator("#pdfThumbnailsBtn").click();

        if (viewport.width <= 760) {
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
      get("viewerPdfSurface").hidden = false;
      get("viewerImageViewport").classList.add("viewer-pdf-active");
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

test("PDF.js : organisation finale desktop et mobile du dialog Consulter", async () => {
  const source = await readFile(new URL("../dist-recette/index.html", import.meta.url), "utf8");
  const inlineStyles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join("\n");
  const dialogStart = source.indexOf('<dialog id="documentViewerDialog"');
  const dialogEnd = source.indexOf("</dialog>", dialogStart) + "</dialog>".length;
  const dialogMarkup = source.slice(dialogStart, dialogEnd);
  const pageDocument = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="${baseUrl}/css/design-system.css"><style>${inlineStyles}</style></head><body>${dialogMarkup}</body></html>`;

  const measureAll = page => page.evaluate(select => Object.fromEntries(select.map(id => {
    const element = document.getElementById(id);
    if (!element) return [id, null];
    const hidden = element.hidden || (element.closest("[hidden]") !== null);
    const rect = element.getBoundingClientRect();
    return [id, { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, width: rect.width, height: rect.height, visible: !hidden && rect.width > 0 && rect.height > 0 }];
  })), ["viewerPdfToolbar", "pdfPageNav", "pdfPanelToggles", "viewerPdfThumbnails", "viewerPdfSurface", "viewerPdfPageViewport", "viewerPdfPageCanvas", "pdfThumbnailsBtn", "pdfPreviousPageBtn", "pdfPageStatus", "pdfNextPageBtn", "pdfZoomOutBtn", "pdfZoomInBtn", "pdfFitModeBtn", "viewerDetailsExpandBtn", "pdfFullscreenBtn", "viewerExternalBtn", "viewerDetailsBtn", "viewerDetailsCollapseBtn", "viewerImageViewport", "viewerDocumentDetails", "documentUnifiedLayout"]);
  const measureDesktopPlacement = page => page.evaluate(() => {
    const panel = document.querySelector(".document-original-panel");
    const toolbar = document.getElementById("viewerPdfToolbar");
    const pageViewport = document.getElementById("viewerPdfPageViewport");
    const canvas = document.getElementById("viewerPdfPageCanvas");
    const panelRect = panel.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const pageRect = pageViewport.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const activeToolbarItems = [...toolbar.children].filter(element => !element.hidden && element.getBoundingClientRect().width > 0);
    const itemsRect = activeToolbarItems.reduce((result, element) => {
      const rect = element.getBoundingClientRect();
      result.left = Math.min(result.left, rect.left);
      result.right = Math.max(result.right, rect.right);
      return result;
    }, { left: Infinity, right: -Infinity });
    return {
      panel: { left: panelRect.left, right: panelRect.right, width: panelRect.width },
      toolbar: { left: toolbarRect.left, right: toolbarRect.right, width: toolbarRect.width, gridColumn: getComputedStyle(toolbar).gridColumnStart, justify: getComputedStyle(toolbar).justifyContent },
      rail: { hidden: document.getElementById("viewerPdfThumbnails").hidden, left: document.getElementById("viewerPdfThumbnails").getBoundingClientRect().left, right: document.getElementById("viewerPdfThumbnails").getBoundingClientRect().right },
      page: { left: pageRect.left, right: pageRect.right, width: pageRect.width, center: (pageRect.left + pageRect.right) / 2 },
      canvas: { left: canvasRect.left, right: canvasRect.right, center: (canvasRect.left + canvasRect.right) / 2, width: canvasRect.width },
      controlsCenter: (itemsRect.left + itemsRect.right) / 2,
      itemsWidth: itemsRect.right - itemsRect.left
    };
  });

  const openViewer = async page => page.evaluate(async url => {
    const { createDocumentPdfViewer } = await import(`${url}/js/document-pdf-viewer.js`);
    const get = id => document.getElementById(id);
    const dialog = get("documentViewerDialog");
    dialog.showModal();
    const detailsToggle = get("viewerDetailsBtn");
    const toggleDetails = collapsed => {
      const layout = get("documentUnifiedLayout");
      layout.classList.toggle("is-details-collapsed", collapsed);
      get("viewerDocumentDetails").hidden = collapsed;
      get("viewerDetailsCollapseBtn").hidden = collapsed;
      get("viewerDetailsExpandBtn").hidden = !collapsed;
      detailsToggle.setAttribute("aria-expanded", String(!collapsed));
      detailsToggle.setAttribute("aria-label", collapsed ? "Afficher les informations" : "Masquer les informations");
      detailsToggle.title = detailsToggle.getAttribute("aria-label");
    };
    get("viewerDetailsCollapseBtn").addEventListener("click", () => toggleDetails(true));
    get("viewerDetailsExpandBtn").addEventListener("click", () => toggleDetails(false));
    detailsToggle.addEventListener("click", () => toggleDetails(detailsToggle.getAttribute("aria-expanded") === "true"));
    toggleDetails(true);
    const infoContent = get("viewerDocumentDetailsContent");
    for (let index = 1; index <= 3; index++) {
      const card = document.createElement("section");
      card.className = "document-unified-section";
      if (index === 3) card.classList.add("pdf-test-last-detail");
      const heading = document.createElement("h4");
      heading.textContent = `Information de test ${index}`;
      const detail = document.createElement("p");
      detail.textContent = "Texte documentaire de test, sans donnée privée. ".repeat(10);
      card.append(heading, detail);
      infoContent.append(card);
    }
    const isNarrow = window.matchMedia("(max-width: 760px)").matches;
    const toolbar = get("viewerPdfToolbar");
    const pagination = get("pdfPageNav");
    const toggles = get("pdfPanelToggles");
    const moveTo = (id, container) => { const element = get(id); if (element && container && element.parentElement !== container) container.append(element); };
    if (isNarrow) {
      moveTo("pdfPreviousPageBtn", pagination);
      moveTo("pdfPageStatus", pagination);
      moveTo("pdfNextPageBtn", pagination);
      toggles.prepend(get("pdfThumbnailsBtn"));
    } else {
      for (const id of ["pdfThumbnailsBtn", "pdfPreviousPageBtn", "pdfPageStatus", "pdfNextPageBtn", "pdfZoomOutBtn", "pdfZoomInBtn", "pdfFitModeBtn", "pdfFullscreenBtn"]) toolbar.append(get(id));
    }
    toolbar.append(get("viewerExternalBtn"));
    if (!isNarrow) toolbar.append(get("viewerDetailsExpandBtn"));
    const viewerBody = get("viewerImageViewport");
    viewerBody.classList.add("viewer-pdf-active");
    get("viewerImageControls").hidden = true;
    document.querySelectorAll("#documentViewerDialog .viewer-image-only").forEach(control => { control.hidden = true; });
    get("viewerPdfSurface").hidden = false;
    get("viewerFrame").hidden = true;
    get("viewerImage").hidden = true;
    get("viewerMessage").hidden = true;
    toolbar.hidden = false;
    pagination.hidden = !isNarrow;
    toggles.hidden = !isNarrow;
    get("viewerPdfThumbnails").hidden = isNarrow;
    const external = get("viewerExternalBtn");
    external.hidden = false;
    window.pdfViewerTestState = await createDocumentPdfViewer({
      source: `${url}/fixture.pdf`, viewer: get("viewerPdfSurface"), loadingMessage: get("viewerMessage"),
      thumbnailRail: get("viewerPdfThumbnails"), thumbnailList: get("viewerPdfThumbnailList"),
      pageViewport: get("viewerPdfPageViewport"), pageCanvas: get("viewerPdfPageCanvas"), pageStatus: get("pdfPageStatus"),
      previousButton: get("pdfPreviousPageBtn"), nextButton: get("pdfNextPageBtn"), zoomOutButton: get("pdfZoomOutBtn"), zoomInButton: get("pdfZoomInBtn"),
      fitModeButton: get("pdfFitModeBtn"), thumbnailsButton: get("pdfThumbnailsBtn"), fullscreenButton: get("pdfFullscreenBtn"),
      fullscreenHost: dialog.querySelector(".document-original-panel"), fullscreenRoot: dialog, zoomIndicator: get("pdfZoomIndicator"),
      bindingRoot: dialog
    });
  }, baseUrl);

  let page;
  const browser = await chromium.launch({ headless: true });
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.setContent(pageDocument, { waitUntil: "load" });
    await openViewer(page);
    await page.waitForFunction(() => document.getElementById("viewerPdfPageCanvas").width > 0, undefined, { timeout: 15000 });
    assert.equal(await page.locator(".pdf-thumbnail").count(), 24);
    const desktop = await measureAll(page);
    assert.ok(desktop.pdfPageNav != null && !desktop.pdfPageNav.visible, "la navigation dédiée reste masquée sur desktop");
    assert.ok(desktop.pdfPanelToggles != null && !desktop.pdfPanelToggles.visible, "la rangée de bascules reste masquée sur desktop");
    assert.ok(desktop.viewerPdfThumbnails.visible, "miniatures ouvertes par défaut sur desktop");
    assert.ok(desktop.viewerPdfThumbnails.width >= 160 && desktop.viewerPdfThumbnails.width <= 200, `colonne miniatures entre 160 et 200 px (${desktop.viewerPdfThumbnails.width})`);
    assert.ok(desktop.viewerPdfThumbnails.right <= desktop.viewerPdfPageViewport.x + 1, "miniatures isolées à gauche, sans chevauchement");
    assert.ok(desktop.viewerPdfPageViewport.width >= 300, "la page occupe le reste de la largeur");
    assert.ok(desktop.viewerPdfPageCanvas.x >= desktop.viewerPdfPageViewport.x - 1 && desktop.viewerPdfPageCanvas.right <= desktop.viewerPdfPageViewport.right + 1, "canvas dans le viewport en largeur");
    assert.ok(desktop.viewerPdfPageCanvas.y >= desktop.viewerPdfPageViewport.y - 1 && desktop.viewerPdfPageCanvas.bottom <= desktop.viewerPdfPageViewport.bottom + 1, "page entière visible, sans coupe");
    assert.ok(desktop.viewerPdfPageCanvas.height >= 200 && desktop.viewerPdfPageCanvas.width >= 200, "page principale lisible");
    assert.ok(desktop.viewerPdfToolbar.bottom <= desktop.viewerPdfPageViewport.y + 1, "barre d’outils au-dessus de la page");
    assert.ok(desktop.viewerPdfToolbar.height <= 60, `barre d’outils desktop sur une seule ligne (${desktop.viewerPdfToolbar.height}px)`);
    const orderX = ["pdfThumbnailsBtn", "pdfPreviousPageBtn", "pdfPageStatus", "pdfNextPageBtn", "pdfZoomOutBtn", "pdfZoomInBtn", "pdfFitModeBtn", "pdfFullscreenBtn", "viewerExternalBtn", "viewerDetailsExpandBtn"].map(id => desktop[id].x);
    assert.deepEqual(orderX, [...orderX].sort((a, b) => a - b), "ordre desktop : miniatures, navigation, lecture puis Informations isolée à droite");
    assert.ok(desktop.pdfFitModeBtn.right < desktop.viewerDetailsExpandBtn.x, "les commandes de lecture restent groupées avant Informations");
    assert.ok(desktop.viewerDetailsExpandBtn.right >= desktop.viewerPdfToolbar.right - 2, "Informations est placée complètement à droite de la barre");
    assert.ok(desktop.pdfFitModeBtn.x - desktop.pdfZoomInBtn.right >= 14, "espacement visuel entre le groupe zoom et les actions de lecture");
    const thumbnailsCenter = (desktop.pdfThumbnailsBtn.y + desktop.pdfThumbnailsBtn.bottom) / 2;
    const detailsCenter = (desktop.viewerDetailsExpandBtn.y + desktop.viewerDetailsExpandBtn.bottom) / 2;
    assert.ok(Math.abs(thumbnailsCenter - detailsCenter) < 2, "les commandes miniatures et informations partagent la même ligne");
    assert.match(await page.locator("#pdfPageStatus").textContent(), /1 \/ 24/);
    assert.match(await page.locator("#pdfPageStatus").getAttribute("aria-label"), /Page 1 sur 24/);
    assert.equal(await page.locator("#pdfPreviousPageBtn").isDisabled(), true, "précédente désactivée sur la première page");
    assert.equal(await page.locator("#pdfNextPageBtn").isDisabled(), false, "suivante active sur la première page");
    assert.match(await page.locator("#pdfPageStatus").textContent(), /1 \/ 24/);
    assert.match(await page.locator("#pdfPageStatus").getAttribute("aria-label"), /Page 1 sur 24/);
    assert.equal(await page.locator('.pdf-thumbnail[data-pdf-page="1"]').getAttribute("aria-current"), "page");

    await page.locator("#pdfThumbnailsBtn").click();
    await page.waitForFunction(() => document.getElementById("viewerPdfThumbnails").hidden);
    const desktopNoRail = await measureDesktopPlacement(page);
    assert.equal(desktopNoRail.toolbar.gridColumn, "1", "toolbar déplacée dans l'unique colonne quand le rail est masqué");
    assert.ok(desktopNoRail.page.width > desktop.viewerPdfPageViewport.width + 150, "le lecteur récupère la largeur du rail masqué");
    assert.ok(Math.abs(desktopNoRail.canvas.center - desktopNoRail.page.center) < 2, "la page reste centrée dans l'espace élargi");
    assert.equal(desktopNoRail.toolbar.justify, "flex-start", "les commandes restent groupées à gauche quand les miniatures sont masquées");
    const noRailInfoButton = await page.locator("#viewerDetailsExpandBtn").boundingBox();
    assert.ok(noRailInfoButton.x >= desktopNoRail.toolbar.right - noRailInfoButton.width - 2, "Informations reste à droite sans miniatures");
    assert.ok(Math.abs(desktopNoRail.controlsCenter - desktopNoRail.page.center) < 16, "le groupe de commandes suit le centre de la page");
    await page.locator("#viewerDetailsExpandBtn").click();
    await page.waitForFunction(() => !document.getElementById("viewerDocumentDetails").hidden);
    const noRailInfoOpen = await measureDesktopPlacement(page);
    assert.equal(noRailInfoOpen.toolbar.gridColumn, "1", "les commandes restent dans la colonne unique avec Informations ouvert");
    assert.ok(Math.abs(noRailInfoOpen.canvas.center - noRailInfoOpen.page.center) < 2, "page centrée dans la largeur restante du panneau");
    const noRailInfoOpenState = await measureAll(page);
    assert.ok(noRailInfoOpenState.viewerDetailsCollapseBtn.visible, "la commande Masquer apparaît avec le panneau ouvert");
    assert.ok(noRailInfoOpenState.viewerDetailsCollapseBtn.x >= noRailInfoOpenState.viewerDocumentDetails.x && noRailInfoOpenState.viewerDetailsCollapseBtn.right <= noRailInfoOpenState.viewerDocumentDetails.right + 1, "Masquer reste dans l’angle droit du panneau Informations ouvert");
    await page.locator("#viewerDetailsCollapseBtn").click();
    await page.waitForFunction(() => document.getElementById("viewerDocumentDetails").hidden);
    await page.locator("#pdfThumbnailsBtn").click();
    await page.waitForFunction(() => !document.getElementById("viewerPdfThumbnails").hidden);
    const restoredRail = await measureDesktopPlacement(page);
    assert.equal(restoredRail.toolbar.gridColumn, "2", "la disposition à deux colonnes est restaurée avec les miniatures");
    assert.ok(restoredRail.rail.right <= restoredRail.page.left + 1, "le rail réapparaît à gauche de la page");
    const restoredInfoButton = await page.locator("#viewerDetailsExpandBtn").boundingBox();
    assert.ok(restoredInfoButton.x >= restoredRail.toolbar.right - restoredInfoButton.width - 2, "Informations reste à droite avec les miniatures rétablies");

    const thumbnailsBoxBefore = desktop.pdfThumbnailsBtn;
    await page.locator("#viewerDetailsExpandBtn").click();
    await page.waitForFunction(() => !document.getElementById("viewerDocumentDetails").hidden);
    const desktopExpanded = await measureAll(page);
    assert.ok(desktopExpanded.viewerDetailsCollapseBtn?.visible, "le volet ouvert expose sa commande de repli");
    assert.ok(desktopExpanded.viewerDetailsCollapseBtn.x >= desktopExpanded.viewerDocumentDetails.x && desktopExpanded.viewerDetailsCollapseBtn.right <= desktopExpanded.viewerDocumentDetails.right + 1, "Masquer reste dans l’angle droit du panneau Informations ouvert");
    assert.ok(Math.abs(desktopExpanded.pdfThumbnailsBtn.x - thumbnailsBoxBefore.x) < 1 && Math.abs(desktopExpanded.pdfThumbnailsBtn.y - thumbnailsBoxBefore.y) < 1, "la commande miniatures reste en place à l’ouverture des informations");
    await page.locator("#viewerDetailsCollapseBtn").click();
    await page.waitForFunction(() => document.getElementById("viewerDocumentDetails").hidden);
    const collapsedThumbnailButton = (await measureAll(page)).pdfThumbnailsBtn;
    assert.ok(Math.abs(collapsedThumbnailButton.x - thumbnailsBoxBefore.x) < 1 && Math.abs(collapsedThumbnailButton.y - thumbnailsBoxBefore.y) < 1, "la commande miniatures reste en place au repli des informations");

    await page.locator('.pdf-thumbnail[data-pdf-page="24"]').click();
    await page.waitForFunction(() => document.getElementById("pdfPageStatus").textContent.includes("24 / 24"));
    assert.ok(await page.evaluate(() => document.getElementById("viewerPdfThumbnails").scrollTop) > 0, "la colonne de miniatures défile indépendamment");
    assert.equal(await page.locator("#pdfNextPageBtn").isDisabled(), true, "suivante désactivée sur la dernière page");
    await page.locator("#pdfPreviousPageBtn").click();
    await page.waitForFunction(() => document.getElementById("pdfPageStatus").textContent.includes("23 / 24"));
    await page.locator("#pdfNextPageBtn").click();
    await page.waitForFunction(() => document.getElementById("pdfPageStatus").textContent.includes("24 / 24"));
    await page.locator("#pdfZoomOutBtn").click();
    await page.waitForFunction(() => window.pdfViewerTestState.getState().zoom === 1);
    const zoomedBox = await measureAll(page).then(result => result.viewerPdfPageCanvas);
    await page.locator("#pdfZoomInBtn").click();
    await page.waitForFunction(() => window.pdfViewerTestState.getState().zoom > 1);
    const canvasZoomed = (await measureAll(page)).viewerPdfPageCanvas;
    assert.ok(canvasZoomed.width > zoomedBox.width, "le zoom agrandit la page");
    const indicatorShown = await page.evaluate(() => {
      const indicator = document.getElementById("pdfZoomIndicator");
      return { visible: indicator.classList.contains("is-visible"), text: indicator.textContent, pointerEvents: getComputedStyle(indicator).pointerEvents };
    });
    assert.ok(indicatorShown.visible && /125 %/.test(indicatorShown.text), "indicateur de zoom temporaire");
    assert.equal(indicatorShown.pointerEvents, "none");
    assert.deepEqual((await measureAll(page)).pdfThumbnailsBtn, desktop.pdfThumbnailsBtn, "l’indicateur ne déplace pas les commandes");
    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(() => document.getElementById("pdfZoomIndicator").classList.contains("is-visible")), false, "indicateur masqué automatiquement");
    await page.evaluate(() => { const viewport = document.getElementById("viewerPdfPageViewport"); viewport.scrollTop = viewport.scrollHeight; viewport.scrollLeft = viewport.scrollWidth; });
    await page.waitForTimeout(120);
    const panned = await measureAll(page);
    assert.ok(panned.viewerPdfPageCanvas.x < panned.viewerPdfPageViewport.x || panned.viewerPdfPageCanvas.y < panned.viewerPdfPageViewport.y, "le panoramique déplace la page zoomée");
    await page.evaluate(() => { const viewport = document.getElementById("viewerPdfPageViewport"); viewport.scrollTop = 0; viewport.scrollLeft = 0; });
    await page.locator("#pdfFullscreenBtn").click();
    await page.waitForFunction(() => document.getElementById("documentViewerDialog").classList.contains("is-viewer-fullscreen"));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("documentViewerDialog").classList.contains("is-viewer-fullscreen"));
    await page.waitForTimeout(500);
    await page.evaluate(() => { const viewport = document.getElementById("viewerPdfPageViewport"); viewport.scrollTop = 0; viewport.scrollLeft = 0; });
    await page.waitForTimeout(300);
    const closed = await measureAll(page);
    assert.ok(closed.viewerPdfPageCanvas.right <= closed.viewerPdfPageViewport.right + 1, "après le plein écran la page reste cadrée");
  } finally {
    await page?.close();
    await browser.close();
  }

  const mobileBrowser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 812 }, { width: 320, height: 844 }, { width: 760, height: 1024 }]) {
      const page = await mobileBrowser.newPage({ viewport });
      await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.setContent(pageDocument, { waitUntil: "load" });
      await openViewer(page);
      await page.waitForFunction(() => document.getElementById("viewerPdfPageCanvas").width > 0, undefined, { timeout: 15000 });
      if (viewport.width === 320) {
        await page.locator("#viewerTitle").evaluate(element => { element.textContent = "Dossier Militaire Giovannoni — Archive historique complète"; });
      }
      const mobile = await measureAll(page);
      const mobileHeader = await page.evaluate(() => {
        const get = selector => {
          const element = document.querySelector(selector);
          const rect = element.getBoundingClientRect();
          return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const title = document.getElementById("viewerTitle");
        const titleStyle = getComputedStyle(title);
        return {
          header: get("#documentViewerDialog > .modal-head"),
          title: get("#viewerTitle"),
          titleStyle: { whiteSpace: titleStyle.whiteSpace, textOverflow: titleStyle.textOverflow, overflow: titleStyle.overflow, lineClamp: titleStyle.webkitLineClamp },
          actions: get("#documentViewerDialog .viewer-head-actions"),
          menu: get("#viewerActionsBtn"),
          close: get('#documentViewerDialog [data-close="documentViewerDialog"]')
        };
      });
      if (viewport.width <= 390) {
        assert.ok(mobileHeader.header.height <= 70, `en-tête mobile compact (${mobileHeader.header.height}px)`);
        assert.equal(mobileHeader.titleStyle.whiteSpace, "nowrap", "titre mobile sur une seule ligne");
        assert.equal(mobileHeader.titleStyle.textOverflow, "ellipsis", "titre tronqué avec ellipsis");
        assert.ok(mobileHeader.title.right <= mobileHeader.actions.x + 1, "le titre ne chevauche pas les actions");
        assert.ok(Math.abs(mobileHeader.menu.y - mobileHeader.close.y) <= 1, "menu et fermeture alignés sur la même ligne");
        assert.ok(mobileHeader.menu.height >= 43.5 && mobileHeader.menu.width >= 43.5, "menu général avec cible 44px");
        assert.ok(mobileHeader.close.height >= 43.5 && mobileHeader.close.width >= 43.5, "fermeture avec cible 44px");
      }
      if (viewport.width === 320) {
        const truncation = await page.locator("#viewerTitle").evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
        assert.ok(truncation.clientWidth > 0 && truncation.scrollWidth > truncation.clientWidth, "titre long tronqué sans déplacer le menu ni la fermeture");
      }
      assert.ok(mobile.viewerPdfThumbnails != null && !mobile.viewerPdfThumbnails.visible, "miniatures fermées par défaut sur mobile");
      assert.equal(await page.locator("#viewerDetailsBtn").getAttribute("aria-expanded"), "false", "bascule Informations fermée par défaut sur mobile");
      assert.ok(mobile.viewerDocumentDetails == null || !mobile.viewerDocumentDetails.visible, "les informations documentaires sont fermées par défaut");
      assert.ok(mobile.viewerPdfToolbar.bottom <= mobile.viewerPdfSurface.y + 1, `barre au-dessus du document (toolbar ${JSON.stringify(mobile.viewerPdfToolbar)} surface ${JSON.stringify(mobile.viewerPdfSurface)})`);
      assert.ok(mobile.viewerPdfToolbar.height <= 60, `barre d’outils sur une seule ligne (${mobile.viewerPdfToolbar.height}px)`);
      const toolOrder = ["pdfZoomOutBtn", "pdfZoomInBtn", "pdfFitModeBtn", "pdfFullscreenBtn", "viewerExternalBtn"].map(id => mobile[id].x);
      assert.deepEqual(toolOrder, [...toolOrder].sort((a, b) => a - b), "outils drills : zoom, ajustement, plein écran, nouvel onglet");
      assert.ok(mobile.pdfFullscreenBtn.x >= mobile.pdfFitModeBtn.right - 1 && mobile.pdfFullscreenBtn.x - mobile.pdfFitModeBtn.right <= 4, `Plein écran reste groupé près d’Ajuster (${mobile.pdfFitModeBtn.right} → ${mobile.pdfFullscreenBtn.x})`);
      assert.ok(Math.abs(mobile.viewerExternalBtn.right - mobile.viewerPdfToolbar.right) <= 2, "nouvel onglet aligné sur le bord droit de la barre");
      assert.ok(mobile.pdfThumbnailsBtn.width + mobile.viewerDetailsBtn.width > 200, "les bascules occupent la largeur de la rangée");
      assert.ok(mobile.pdfPageNav.y >= mobile.viewerPdfSurface.bottom - 1, "pagination sous le document");
      assert.ok(mobile.pdfPanelToggles.y >= mobile.pdfPageNav.bottom - 1, "bascules sous la pagination");
    assert.ok(mobile.pdfPreviousPageBtn.x < mobile.pdfPageStatus.x && mobile.pdfPageStatus.x < mobile.pdfNextPageBtn.x, "compteur entre les flèches");
      const toolButtons = await page.evaluate(() => [...document.querySelectorAll("#viewerPdfToolbar .btn")].map(button => { const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }));
      for (const button of toolButtons) assert.ok(button.height >= 43.5 && button.width >= 43.5, "cibles tactiles d’au moins 44px dans la barre d’outils");
      const toggleButtons = await page.evaluate(() => [...document.querySelectorAll("#pdfPanelToggles .btn")].map(button => { const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }));
      for (const button of toggleButtons) assert.ok(button.height >= 43.5, "cibles tactiles d’au moins 44px dans les bascules");
      const overflowState = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth }));
      assert.ok(overflowState.scrollWidth <= overflowState.innerWidth + 1, `aucun débordement horizontal à ${viewport.width}px (mesuré ${overflowState.scrollWidth})`);
      if (overflowState.scrollWidth > overflowState.innerWidth + 1) {
        const overflows = await page.evaluate(() => [...document.querySelectorAll("#documentViewerDialog *")].filter(element => { const rect = element.getBoundingClientRect(); return rect.right > innerWidth + 1 && rect.width > 0; }).slice(0, 6).map(element => `${element.tagName}.${element.className}#${element.id} w=${Math.round(element.getBoundingClientRect().width)} right=${Math.round(element.getBoundingClientRect().right)}`));
        assert.fail(`débordement : ${overflows.join(" | ")}`);
      }
      assert.equal((await page.evaluate(() => document.documentElement.scrollWidth)), viewport.width, "pas de scroll recto global");
      assert.equal(await page.locator("#pdfNextPageBtn").isDisabled(), false, "suivante active");
      assert.equal(await page.locator("#pdfThumbnailsBtn").getAttribute("aria-expanded"), "false", "miniatures fermées au départ");
      assert.equal(await page.locator("#viewerDetailsBtn").getAttribute("aria-expanded"), "false", "informations fermées au départ");
      assert.ok(mobile.viewerPdfPageCanvas.width > 150 && mobile.viewerPdfPageCanvas.height > 150, "page principale lisible");
      assert.ok(mobile.viewerPdfPageCanvas.x >= mobile.viewerPdfPageViewport.x - 1 && mobile.viewerPdfPageCanvas.right <= mobile.viewerPdfPageViewport.right + 1 && mobile.viewerPdfPageCanvas.bottom <= mobile.viewerPdfPageViewport.bottom + 1, "cadrage initial sans coupe");
      await page.evaluate(() => { const rail = document.getElementById("viewerPdfThumbnails"); rail.scrollLeft = rail.scrollWidth; });

      await page.locator("#pdfThumbnailsBtn").click();
      await page.waitForFunction(() => !document.getElementById("viewerPdfThumbnails").hidden);
      const railOpen = await measureAll(page);
      assert.ok(railOpen.viewerPdfThumbnails.visible, "galerie visible après bascule");
      assert.ok(railOpen.viewerPdfThumbnails.y >= railOpen.pdfPanelToggles.bottom - 1, "galerie sous les bascules");
      assert.ok(railOpen.viewerPdfThumbnails.bottom <= railOpen.viewerImageViewport.bottom + Math.max(1, railOpen.viewerImageViewport.height), "galerie contenue dans le lecteur sans coupe basse");
      assert.ok(await page.evaluate(() => document.getElementById("viewerPdfThumbnails").scrollWidth >= document.getElementById("viewerPdfThumbnails").clientWidth), "galerie horizontale défilable");
      await page.evaluate(() => { const rail = document.getElementById("viewerPdfThumbnails"); rail.scrollLeft = rail.scrollWidth; });
      await page.waitForTimeout(150);
      await page.locator('.pdf-thumbnail[data-pdf-page="24"]').click();
      await page.waitForFunction(() => document.getElementById("pdfPageStatus").textContent.includes("24 / 24"));
      assert.equal(await page.locator('.pdf-thumbnail[data-pdf-page="24"]').getAttribute("aria-current"), "page", "dernière miniature synchronisée");
      const chevron = await page.evaluate(() => getComputedStyle(document.querySelector("#pdfThumbnailsBtn .pdf-panels-chevron")).transform);
      assert.ok(chevron.includes("matrix(-1") || chevron.includes("180deg"), "chevron retourné quand le panneau est ouvert");
       await page.locator("#viewerDetailsBtn").click();
       await page.waitForFunction(() => !document.getElementById("viewerDocumentDetails").hidden);
       assert.equal(await page.locator("#viewerDetailsCollapseBtn").evaluate(element => getComputedStyle(element).display), "none", "mobile : aucun second bouton Informations dans l’en-tête du panneau déplié");
       const bothOpen = await measureAll(page);
      assert.ok(bothOpen.viewerDocumentDetails?.visible, "panneau informations ouvert");
      assert.ok(bothOpen.viewerPdfThumbnails.y < bothOpen.viewerDocumentDetails.y, "ordre vertical : miniatures puis informations");
      assert.ok(bothOpen.viewerPdfThumbnails.bottom <= bothOpen.viewerDocumentDetails.y + 1, "les deux panneaux restent séparés sans imbrication");
      const modalBody = page.locator("#documentViewerDialog > .modal-body");
      await modalBody.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const lastDetailCard = page.locator("#viewerDocumentDetailsContent .pdf-test-last-detail");
      await lastDetailCard.scrollIntoViewIfNeeded();
      const lastDetailBox = await lastDetailCard.boundingBox();
      assert.ok(lastDetailBox && lastDetailBox.y < viewport.height && lastDetailBox.y + lastDetailBox.height <= viewport.height + 1, "le bas du panneau Informations reste accessible par défilement mobile");
      await page.locator("#pdfThumbnailsBtn").click();
      await page.waitForFunction(() => document.getElementById("viewerPdfThumbnails").hidden);
      assert.ok((await measureAll(page)).viewerDocumentDetails.visible, "le panneau informations reste ouvert quand les miniatures se ferment");
      await page.locator("#viewerDetailsBtn").click();
      await page.waitForFunction(() => document.getElementById("viewerDocumentDetails").hidden);
      assert.equal(await page.locator("#viewerDetailsBtn").getAttribute("aria-expanded"), "false", "etat resynchronisé à la fermeture");
      await page.locator("#pdfFullscreenBtn").click();
      await page.waitForFunction(() => document.getElementById("documentViewerDialog").classList.contains("is-viewer-fullscreen"));
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("documentViewerDialog").classList.contains("is-viewer-fullscreen"));
      await page.close();
    }
  } finally {
    await mobileBrowser.close();
  }
});

test("Serveur local des tests PDF : arrêt final", async () => {
  if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
});
