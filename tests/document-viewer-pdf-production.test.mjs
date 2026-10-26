import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { chromium, webkit } from "playwright";

const DIST = resolve("dist-production");

function createPdf(pageCount = 3) {
  const objects = [];
  const kids = Array.from({ length: pageCount }, (_, index) => `${3 + index * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let page = 1; page <= pageCount; page++) {
    const pageObject = 3 + (page - 1) * 2;
    const contentObject = pageObject + 1;
    const stream = `BT /F1 24 Tf 72 700 Td (Page de test ${page}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${pageCount * 2 + 3} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

const fixturePdf = createPdf(3);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/fixture.pdf") {
      response.writeHead(200, { "content-type": "application/pdf", "content-length": fixturePdf.length });
      response.end(fixturePdf);
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const target = resolve(DIST, `.${pathname === "/" ? "/index.html" : pathname}`);
    assert.ok(target === DIST || target.startsWith(`${DIST}\\`), "requête limitée à dist-production");
    const body = await readFile(target);
    const ext = extname(target).toLowerCase();
    const contentType = ext === ".html" ? "text/html; charset=utf-8"
      : [".js", ".mjs"].includes(ext) ? "text/javascript; charset=utf-8"
        : ext === ".css" ? "text/css; charset=utf-8" : "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("404");
  }
});

await new Promise((listen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", listen);
});
after(() => new Promise(resolve => {
  server.closeAllConnections?.();
  server.close(() => resolve());
}));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const builtHtml = await readFile(join(DIST, "index.html"), "utf8");
const spriteStart = builtHtml.indexOf('<svg class="svg-sprite"');
const spriteEnd = builtHtml.indexOf("</svg>", spriteStart) + "</svg>".length;
const dialogStart = builtHtml.indexOf('<dialog id="documentViewerDialog"');
const dialogEnd = builtHtml.indexOf("</dialog>", dialogStart) + "</dialog>".length;
const inlineCss = [...builtHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join("\n");
const pageDocument = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${baseUrl}/"><link rel="stylesheet" href="${baseUrl}/css/design-system.css"><style>${inlineCss}</style></head><body>${builtHtml.slice(spriteStart, spriteEnd)}${builtHtml.slice(dialogStart, dialogEnd)}</body></html>`;

async function launchPdfViewer(page, isNarrow) {
  await page.setContent(pageDocument, { waitUntil: "load" });
  await page.evaluate(async ({ baseUrl, isNarrow }) => {
    const get = id => document.getElementById(id);
    const dialog = get("documentViewerDialog");
    dialog.showModal();
    get("viewerTitle").textContent = "PDF de test";
    get("viewerSubtitle").textContent = "archive.pdf";
    get("viewerDocumentDetailsContent").innerHTML = "<section class='document-unified-section'><h4>Informations documentaires</h4><p>Archive de test</p></section>";
    const layout = get("documentUnifiedLayout");
    const details = get("viewerDocumentDetails");
    const expandButton = get("viewerDetailsExpandBtn");
    const detailsToggle = get("viewerDetailsBtn");
    const collapse = collapsed => {
      layout.classList.toggle("is-details-collapsed", collapsed);
      details.hidden = collapsed;
      expandButton.hidden = false;
      get("viewerDetailsCollapseBtn").hidden = true;
      expandButton.setAttribute("aria-expanded", String(!collapsed));
      detailsToggle.setAttribute("aria-expanded", String(!collapsed));
      const label = collapsed ? "Afficher les informations" : "Masquer les informations";
      expandButton.setAttribute("aria-label", label);
      detailsToggle.setAttribute("aria-label", label);
    };
    expandButton.addEventListener("click", () => collapse(!layout.classList.contains("is-details-collapsed")));
    detailsToggle.addEventListener("click", () => collapse(detailsToggle.getAttribute("aria-expanded") === "true"));
    collapse(true);

    const toolbar = get("viewerPdfToolbar");
    const pagination = get("pdfPageNav");
    const toggles = get("pdfPanelToggles");
    const viewerBody = get("viewerImageViewport");
    const rail = get("viewerPdfThumbnails");
    get("viewerImage").hidden = true;
    get("viewerFrame").hidden = true;
    get("viewerImageControls").hidden = true;
    get("viewerPdfSurface").hidden = false;
    viewerBody.classList.add("viewer-pdf-active");
    toolbar.hidden = false;
    rail.hidden = isNarrow;
    if (isNarrow) {
      pagination.append(get("pdfPreviousPageBtn"), get("pdfPageStatus"), get("pdfNextPageBtn"));
      toggles.prepend(get("pdfThumbnailsBtn"));
      for (const id of ["pdfZoomOutBtn", "pdfZoomInBtn", "pdfFitModeBtn", "pdfFullscreenBtn", "viewerExternalBtn"]) toolbar.append(get(id));
      toolbar.after(viewerBody);
      viewerBody.after(pagination);
      pagination.after(toggles);
      toggles.after(rail);
      pagination.hidden = false;
      toggles.hidden = false;
    } else {
      for (const id of ["pdfThumbnailsBtn", "pdfPreviousPageBtn", "pdfPageStatus", "pdfNextPageBtn", "pdfZoomOutBtn", "pdfZoomInBtn", "pdfFitModeBtn", "pdfFullscreenBtn", "viewerExternalBtn", "viewerDetailsExpandBtn"]) toolbar.append(get(id));
      pagination.hidden = true;
      toggles.hidden = true;
    }
    get("viewerExternalBtn").href = `${baseUrl}/fixture.pdf`;
    get("viewerExternalBtn").hidden = false;
    const { createDocumentPdfViewer } = await import(`${baseUrl}/js/document-pdf-viewer.js`);
    window.__productionPdfViewer = await createDocumentPdfViewer({
      source: `${baseUrl}/fixture.pdf`, viewer: get("viewerPdfSurface"), loadingMessage: get("viewerMessage"),
      thumbnailRail: rail, thumbnailList: get("viewerPdfThumbnailList"), pageViewport: get("viewerPdfPageViewport"),
      pageCanvas: get("viewerPdfPageCanvas"), pageStatus: get("pdfPageStatus"), previousButton: get("pdfPreviousPageBtn"),
      nextButton: get("pdfNextPageBtn"), zoomOutButton: get("pdfZoomOutBtn"), zoomInButton: get("pdfZoomInBtn"),
      fitModeButton: get("pdfFitModeBtn"), thumbnailsButton: get("pdfThumbnailsBtn"), fullscreenButton: get("pdfFullscreenBtn"),
      fullscreenHost: dialog.querySelector(".document-original-panel"), fullscreenRoot: dialog,
      zoomIndicator: get("pdfZoomIndicator"), bindingRoot: dialog, maxZoom: 1.25
    });
  }, { baseUrl, isNarrow });
  await page.waitForFunction(() => document.getElementById("viewerPdfPageCanvas").width > 0);
}

test("PDF production : disposition, pagination, miniatures et commandes sur desktop et mobile 375 px", async t => {
  const cases = [["Chromium", chromium, { width: 1280, height: 900 }], ["Chromium 375 px", chromium, { width: 375, height: 812 }], ["WebKit 375 px", webkit, { width: 375, height: 812 }]];
  for (const [name, engine, viewport] of cases) {
    let browser;
    try { browser = await engine.launch({ headless: true }); }
    catch (error) {
      if (name.startsWith("WebKit")) { t.diagnostic(`WebKit indisponible : ${error.message}`); continue; }
      throw error;
    }
    try {
      const page = await browser.newPage({ viewport });
      await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
      await launchPdfViewer(page, viewport.width <= 760);
      const mobile = viewport.width <= 760;
      const measure = async () => page.evaluate(isMobile => {
        const rect = id => document.getElementById(id).getBoundingClientRect().toJSON();
        return {
          toolbar: rect("viewerPdfToolbar"), surface: rect("viewerPdfSurface"), page: rect("pdfPageNav"), toggles: rect("pdfPanelToggles"),
          rail: rect("viewerPdfThumbnails"), zoomOut: rect("pdfZoomOutBtn"), zoomIn: rect("pdfZoomInBtn"),
          fit: rect("pdfFitModeBtn"), fullscreen: rect("pdfFullscreenBtn"), external: rect("viewerExternalBtn"),
          info: rect(isMobile ? "viewerDetailsBtn" : "viewerDetailsExpandBtn"), status: rect("pdfPageStatus"),
          width: document.documentElement.scrollWidth, viewport: innerWidth
        };
      }, mobile);
      const initial = await measure();
      const joinedGap = initial.zoomIn.x - initial.zoomOut.right;
      assert.ok(Math.abs(joinedGap) <= .1, `${name} : Zoom −/+ joint sans espace ni chevauchement (${joinedGap}px)`);
      assert.equal(await page.locator("#pdfZoomOutBtn").evaluate(button => getComputedStyle(button).borderRightWidth), "0px", "la bordure commune n’est dessinée qu’une fois");
      assert.equal(await page.locator("#pdfZoomInBtn").evaluate(button => getComputedStyle(button).borderLeftWidth), "1px", "séparation centrale d’un pixel");
      assert.ok(initial.zoomOut.width >= 43.5 && initial.zoomIn.width >= 43.5 && Math.abs(initial.zoomOut.y - initial.zoomIn.y) < 1, "boutons de zoom distincts et cibles 44px");
      assert.ok(initial.width <= initial.viewport + 1, "aucun débordement horizontal");
      assert.equal(await page.locator("#viewerExternalBtn").getAttribute("target"), "_blank", "Nouvel onglet conserve son action");

      if (mobile) {
        assert.ok(initial.surface.bottom <= initial.page.y + 1, "document avant pagination");
        assert.ok(initial.page.bottom <= initial.toggles.y + 1, "pagination avant les boutons dépliants");
        assert.ok(initial.page.y >= initial.surface.bottom - 1, "pagination directement sous le document");
        assert.ok(initial.status.x > initial.page.x && initial.status.right < initial.page.right, "numéro de page centré entre les flèches");
        await page.locator("#pdfThumbnailsBtn").click();
        await page.waitForFunction(() => !document.getElementById("viewerPdfThumbnails").hidden);
        const withRail = await measure();
        assert.ok(withRail.rail.y >= withRail.toggles.bottom - 1, "miniatures ouvertes sous les boutons dépliants");
        await page.locator("#viewerDetailsBtn").click();
        await page.waitForFunction(() => !document.getElementById("viewerDocumentDetails").hidden);
        assert.ok((await measure()).page.y >= (await measure()).surface.bottom - 1, "pagination visible avec Informations ouvertes");
        assert.equal(await page.locator("#viewerDetailsCollapseBtn").evaluate(button => getComputedStyle(button).display), "none", "aucun bouton Informations redondant");
      } else {
        const toolbarBox = await page.locator("#viewerPdfToolbar").boundingBox();
        const toolbarItems = await page.locator("#viewerPdfToolbar > *").evaluateAll(elements => elements.map(element => ({ id: element.id, hidden: element.hidden, rect: element.getBoundingClientRect().toJSON() })));
        assert.ok(toolbarBox.height <= 60, `barre PDF desktop reste sur une seule ligne (${toolbarBox.height}px)`);
        assert.ok(initial.info.x >= initial.external.right && initial.info.x + initial.info.width >= toolbarBox.x + toolbarBox.width - 6, `Informations reste en bout de barre desktop (${JSON.stringify({ info: initial.info, external: initial.external, toolbarBox, toolbarItems })})`);
        assert.ok(initial.fit.x > initial.zoomIn.x && initial.fullscreen.x > initial.fit.x && initial.external.x > initial.fullscreen.x, "les autres commandes restent distinctes et accessibles");
        for (const thumbnailsOpen of [false, true]) {
          const railOpen = !await page.locator("#viewerPdfThumbnails").evaluate(element => element.hidden);
          if (railOpen !== thumbnailsOpen) {
            await page.locator("#pdfThumbnailsBtn").click();
            assert.equal(await page.locator("#viewerPdfThumbnails").evaluate(element => !element.hidden), thumbnailsOpen, `la bascule des miniatures atteint l’état ${thumbnailsOpen}`);
          }
          await page.locator("#viewerDetailsExpandBtn").click();
          await page.waitForFunction(() => !document.getElementById("viewerDocumentDetails").hidden);
          const infoOpen = await measure();
          assert.ok(infoOpen.info.x + infoOpen.info.width >= infoOpen.toolbar.x + infoOpen.toolbar.width - 2, `Informations reste à droite; miniatures=${thumbnailsOpen}`);
          assert.ok(infoOpen.info.y >= infoOpen.toolbar.y - 1 && infoOpen.info.bottom <= infoOpen.toolbar.bottom + 1, `Informations reste à l’intérieur de la barre; miniatures=${thumbnailsOpen} (${JSON.stringify({ info: infoOpen.info, toolbar: infoOpen.toolbar, surface: infoOpen.surface })})`);
          assert.ok(infoOpen.toolbar.bottom <= infoOpen.surface.y + 1, `la barre reste au-dessus de la page; miniatures=${thumbnailsOpen}`);
          assert.equal(await page.locator("#viewerDetailsExpandBtn").isVisible(), true, "le même bouton reste visible ouvert");
          await page.locator("#viewerDetailsExpandBtn").click();
          await page.waitForFunction(() => document.getElementById("viewerDocumentDetails").hidden);
          assert.equal(await page.locator("#viewerDetailsExpandBtn").isVisible(), true, "le même bouton reste visible fermé");
          if (thumbnailsOpen) await page.locator("#pdfThumbnailsBtn").click();
        }
      }

      const before = await page.evaluate(() => window.__productionPdfViewer.getState().zoom);
      await page.locator("#pdfZoomOutBtn").click();
      assert.equal(await page.evaluate(() => window.__productionPdfViewer.getState().zoom), 1, "Zoom − respecte le minimum");
      await page.locator("#pdfZoomInBtn").click();
      await page.waitForFunction(() => window.__productionPdfViewer.getState().zoom === 1.25);
      await page.locator("#pdfZoomInBtn").click();
      assert.equal(await page.evaluate(() => window.__productionPdfViewer.getState().zoom), 1.25, "Zoom + respecte le maximum");
      await page.locator("#pdfZoomOutBtn").click();
      await page.waitForFunction(() => window.__productionPdfViewer.getState().zoom === 1);
      assert.equal(before, 1, "zoom initial à la borne minimale");
      await page.locator("#pdfFitModeBtn").click();
      await page.waitForFunction(() => window.__productionPdfViewer.getState().fitMode === "width");
      assert.ok(await page.locator("#pdfNextPageBtn").isVisible(), "pagination reste accessible après Ajuster");
      await page.locator("#pdfNextPageBtn").click();
      await page.waitForFunction(() => document.getElementById("pdfPageStatus").textContent.includes("2 / 3"));
      assert.equal(await page.locator('.pdf-thumbnail[data-pdf-page="2"]').getAttribute("aria-current"), "page", "miniature active synchronisée au numéro de page");
      await page.locator("#pdfFullscreenBtn").click();
      await page.waitForFunction(() => document.getElementById("documentViewerDialog").classList.contains("is-viewer-fullscreen"));
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("documentViewerDialog").classList.contains("is-viewer-fullscreen"));
      await page.evaluate(() => window.__productionPdfViewer.destroy());
      await page.close();
      t.diagnostic(`${name} : zoom groupé, commandes indépendantes et navigation validés`);
    } finally { await browser.close(); }
  }
});

test("Build production : aucune Rules ni test inclus, configuration Production active", async () => {
  const files = await (await import("node:fs/promises")).readdir(DIST, { recursive: true });
  assert.ok(files.includes("index.html"));
  assert.ok(files.includes("css\\design-system.css") || files.includes("css/design-system.css"));
  assert.ok(files.includes("js\\app.js") || files.includes("js/app.js"));
  assert.ok(files.includes("js\\document-image-viewer.js") || files.includes("js/document-image-viewer.js"));
  assert.ok(files.includes("js\\document-pdf-viewer.js") || files.includes("js/document-pdf-viewer.js"));
  assert.ok(files.includes("vendor\\pdfjs\\pdf.mjs") || files.includes("vendor/pdfjs/pdf.mjs"));
  assert.ok(files.includes("vendor\\pdfjs\\pdf.worker.mjs") || files.includes("vendor/pdfjs/pdf.worker.mjs"));
  assert.equal(files.some(path => /firestore\.rules|tests[\\/]|package(-lock)?\.json/.test(path)), false);
  const environment = await readFile(join(DIST, "js", "firebase-environment.js"), "utf8");
  assert.match(environment, /projectId: "family-tree-c2fe2"/);
  assert.match(environment, /family-tree-c2fe2\.web\.app/);
  assert.doesNotMatch(environment, /production-unavailable-in-recette-build/);
});
