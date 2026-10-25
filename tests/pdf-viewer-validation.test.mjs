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
    if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
  }
});
