import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const [html, css, app] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../css/design-system.css", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8")
]);

const portraitSvg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="800"><rect width="200" height="800" fill="#c4b5a0"/></svg>');
const landscapeSvg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="#b8c9be"/></svg>');
const tallSvg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="2400"><rect width="120" height="2400" fill="#d9cfc0"/></svg>');
const wideSvg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="120"><rect width="2400" height="120" fill="#b8c9be"/></svg>');

const TITLES = {
  short: "Acte de naissance",
  medium: "Acte de naissance de Carlo Alberti",
  long: "Acte de mariage des Alberti - Orino 1891 avec mention marginale et annotations du service d'état civil"
};

test("Viewer : règles statiques mobile (clamp, icône, safe-area, flex, pas de 92dvh)", () => {
  /* Fullscreen conservé */
  assert.match(html, /\.viewer-dialog\{width:min\(calc\(100vw - 3rem\),94vw\);height:min\(calc\(100dvh - 3rem\),92dvh\)\}/);
  assert.match(html, /\.viewer-dialog\{width:calc\(100% - 12px\);height:calc\(100dvh - 12px\)\}/);
  assert.match(css, /\.viewer-dialog\[open\],\s*\n\s*\.data-dialog/);
  /* Viewer volontairement différent : pas de sheet 92dvh */
  assert.doesNotMatch(css, /dialog#documentViewerDialog[^{]*\{[^}]*92dvh/);
  assert.doesNotMatch(html, /documentViewerDialog[^>]*modal-mobile-sheet/);
  /* Plus de dépendance au 78px */
  assert.doesNotMatch(html, /\.viewer-dialog \.modal-body\{[^}]*calc\(100% - 78px\)/);
  assert.match(html, /\.viewer-dialog \.modal-body\{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;/);
  assert.match(html, /\.viewer-dialog\[open\]\{display:flex;flex-direction:column\}/);
  /* Clamp 2 lignes scopé viewer */
  assert.match(css, /\.viewer-dialog \.modal-head h3 \{\s*\n\s*display: -webkit-box;\s*\n\s*-webkit-box-orient: vertical;\s*\n\s*-webkit-line-clamp: 2;/);
  /* Sous-titre visible mobile (exception scopée) */
  assert.match(css, /\.viewer-dialog \.modal-head p \{\s*\n\s*display: block;[\s\S]*?text-overflow: ellipsis;/);
  /* Safe-area basse */
  assert.match(css, /\.viewer-dialog \.modal-body \{\s*\n\s*padding-bottom: max\(12px, env\(safe-area-inset-bottom\)\);\s*\n\s*\}/);
  /* Icône Nouvel onglet ≤480 */
  assert.match(css, /@media \(max-width: 480px\) \{\s*\n\s*\.viewer-dialog #viewerExternalBtn \{/);
  /* Nouvel onglet : icône seule (alignement recette), libellé legacy supprimé */
  assert.match(css, /\.viewer-open-original \{ display: inline-grid; place-items: center; width: var\(--control-touch\); min-width: var\(--control-touch\); padding: 0; \}/);
  assert.match(css, /\.viewer-open-original \.ui-icon \{ width: 1\.25rem; height: 1\.25rem; \}/);
  assert.doesNotMatch(css, /viewer-external-label/);
  /* Accessible name conservé */
  assert.match(html, /id="viewerExternalBtn"[^>]*aria-label="Ouvrir dans un nouvel onglet"[^>]*title="Ouvrir dans un nouvel onglet"/);
  assert.match(html, /id="viewerExternalBtn"[^>]*><svg class="ui-icon"[^>]*><use href="#icon-external-link"><\/use><\/svg><\/a>/);
  assert.doesNotMatch(html, /viewer-external-label/);
  /* Informations : icône panneau recette, bouton dans la barre image après Plein écran */
  assert.match(html, /id="viewerDetailsExpandBtn"[^>]*><svg class="ui-icon"[^>]*><use href="#icon-panel-expand"><\/use>/);
  assert.match(html, /<symbol id="icon-external-link"/);
  assert.match(html, /id="viewerFullscreenBtn"[\s\S]{0,400}?id="viewerExternalBtn"/);
  assert.doesNotMatch(html, /<div class="viewer-head-actions"><a /);
});

async function createViewerPage(browser, server, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "fr-FR",
    isMobile: width <= 760,
    hasTouch: width <= 760,
    reducedMotion: "reduce"
  });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
  });
  return { context, page };
}

async function openViewer(page, { title, fileName, kind = "image", src = portraitSvg }) {
  await page.evaluate(async ({ title, fileName, kind, src }) => {
    const dialog = document.getElementById("documentViewerDialog");
    window.__viewerImageController?.destroy();
    window.__viewerImageController = null;
    if (dialog.open) await new Promise(resolveClose => {
      dialog.addEventListener("close", resolveClose, { once: true });
      dialog.close();
    });
    document.getElementById("viewerTitle").textContent = title;
    document.getElementById("viewerSubtitle").textContent = fileName;
    const img = document.getElementById("viewerImage");
    const frame = document.getElementById("viewerFrame");
    const controls = document.getElementById("viewerImageControls");
    const viewport = document.getElementById("viewerImageViewport");
    const layout = document.getElementById("documentUnifiedLayout");
    const details = document.getElementById("viewerDocumentDetails");
    const expandButton = document.getElementById("viewerDetailsExpandBtn");
    const collapseButton = document.getElementById("viewerDetailsCollapseBtn");
    const detailsToggle = document.getElementById("viewerDetailsBtn");
    const external = document.getElementById("viewerExternalBtn");
    const toggles = document.getElementById("pdfPanelToggles");
    const thumbnails = document.getElementById("pdfThumbnailsBtn");
    img.hidden = true;
    frame.hidden = true;
    frame.removeAttribute("src");
    img.removeAttribute("src");
    viewport.classList.remove("viewer-pdf-active");
    document.getElementById("viewerMessage").hidden = true;
    details.hidden = true;
    layout.classList.add("is-details-collapsed");
    expandButton.hidden = false;
    collapseButton.hidden = true;
    expandButton.setAttribute("aria-expanded", "false");
    expandButton.setAttribute("aria-label", "Afficher les informations");
    detailsToggle.setAttribute("aria-expanded", "false");
    detailsToggle.setAttribute("aria-label", "Afficher les informations");
    document.getElementById("viewerDocumentDetailsContent").innerHTML = "<section class=\"document-unified-section\"><h4>Informations documentaires</h4><div class=\"document-unified-facts\"><div class=\"document-unified-fact\"><strong>Fichier</strong><span>Test.pdf</span></div></div></section>";
    external.href = src;
    external.hidden = false;
    controls.hidden = kind !== "image";
    document.getElementById("viewerPdfToolbar").hidden = true;
    document.getElementById("pdfPageNav").hidden = true;
    toggles.hidden = true;
    thumbnails.hidden = false;
    if (!expandButton.dataset.testBound) {
      const setCollapsed = collapsed => {
        layout.classList.toggle("is-details-collapsed", collapsed);
        details.hidden = collapsed;
        expandButton.hidden = false;
        collapseButton.hidden = true;
        expandButton.setAttribute("aria-expanded", String(!collapsed));
        detailsToggle.setAttribute("aria-expanded", String(!collapsed));
        const label = collapsed ? "Afficher les informations" : "Masquer les informations";
        expandButton.setAttribute("aria-label", label);
        expandButton.title = label;
        detailsToggle.setAttribute("aria-label", label);
        detailsToggle.title = label;
      };
      detailsToggle.onclick = () => setCollapsed(detailsToggle.getAttribute("aria-expanded") === "true");
      expandButton.dataset.testBound = "true";
    }
    if (kind === "image") {
      img.src = src;
      img.hidden = false;
      await img.decode();
      const originalHead = document.querySelector(".document-original-head");
      document.getElementById("viewerFullscreenBtn").hidden = false;
      document.getElementById("viewerImageModeBtn").hidden = false;
      let arrangeImageChrome = window.__viewerImageChromeArrange;
      if (!arrangeImageChrome) {
        arrangeImageChrome = () => {
          if (matchMedia("(max-width: 760px)").matches) {
            controls.append(document.getElementById("viewerFullscreenBtn"), external);
            originalHead.append(expandButton);
            document.getElementById("viewerPdfToolbar").append(thumbnails);
            thumbnails.hidden = true;
            toggles.append(detailsToggle);
            toggles.classList.add("viewer-image-panel-toggles");
            toggles.hidden = false;
            viewport.after(toggles);
          } else {
            document.getElementById("viewerPdfToolbar").append(thumbnails);
            thumbnails.hidden = false;
            toggles.classList.remove("viewer-image-panel-toggles");
            toggles.hidden = true;
            controls.append(document.getElementById("viewerFullscreenBtn"), external, expandButton);
          }
        };
        window.__viewerImageChromeArrange = arrangeImageChrome;
        const media = matchMedia("(max-width: 760px)");
        if (typeof media.addEventListener === "function") media.addEventListener("change", arrangeImageChrome);
        else if (typeof media.addListener === "function") media.addListener(arrangeImageChrome);
      }
      arrangeImageChrome();
      const { createDocumentImageViewer, selectInitialDocumentImageMode } = await import("./js/document-image-viewer.js");
      window.__viewerImageController = createDocumentImageViewer({
        viewport, image: img, controls, zoomIndicator: document.getElementById("viewerZoomIndicator"),
        modeButton: document.getElementById("viewerImageModeBtn"), fullscreenButton: document.getElementById("viewerFullscreenBtn"),
        fullscreenHost: document.querySelector(".document-original-panel"), fullscreenRoot: dialog,
        initialMode: selectInitialDocumentImageMode({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
      });
    } else {
      toggles.classList.remove("viewer-image-panel-toggles");
      const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])], { type: "application/pdf" });
      frame.src = URL.createObjectURL(blob);
      frame.hidden = false;
      document.querySelector(".viewer-head-actions").append(external);
    }
    dialog.showModal();
    dialog.getAnimations({ subtree: true }).forEach(a => a.finish());
  }, { title, fileName, kind, src });
  await page.waitForTimeout(80);
}

async function measureViewer(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById("documentViewerDialog");
    const head = dialog.querySelector(":scope > .modal-head");
    const body = dialog.querySelector(":scope > .modal-body");
    const viewer = dialog.querySelector(".viewer-body");
    const title = document.getElementById("viewerTitle");
    const subtitle = document.getElementById("viewerSubtitle");
    const external = document.getElementById("viewerExternalBtn");
    const externalIcon = external.querySelector("use");
    const closeBtn = head.querySelector("[data-close]");
    const img = document.getElementById("viewerImage");
    const frame = document.getElementById("viewerFrame");
    const box = el => {
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1) };
    };
    const titleStyle = getComputedStyle(title);
    const subtitleStyle = getComputedStyle(subtitle);
    return {
      open: dialog.open,
      dialog: box(dialog),
      radius: getComputedStyle(dialog).borderTopLeftRadius,
      head: box(head),
      titleH: +title.getBoundingClientRect().height.toFixed(1),
      titleClamp: titleStyle.webkitLineClamp || titleStyle.getPropertyValue("-webkit-line-clamp"),
      titleOverflow: titleStyle.overflow,
      titleText: title.textContent,
      titleAccessible: dialog.getAttribute("aria-labelledby") === "viewerTitle" && title.textContent.length > 0,
      subtitleDisplay: subtitleStyle.display,
      subtitleH: +subtitle.getBoundingClientRect().height.toFixed(1),
      subtitleOverflowX: subtitleStyle.overflowX,
      subtitleEllipsis: subtitleStyle.textOverflow,
      subtitleText: subtitle.textContent,
      externalHidden: external.hidden,
      externalIconHref: externalIcon ? externalIcon.getAttribute("href") : null,
      externalText: external.textContent.trim(),
      externalAriaLabel: external.getAttribute("aria-label"),
      externalTitle: external.getAttribute("title"),
      externalBtn: box(external),
      externalMinH: getComputedStyle(external).minHeight,
      closeBtn: box(closeBtn),
      body: box(body),
      bodyDisplay: getComputedStyle(body).display,
      bodyFlex: getComputedStyle(body).flex,
      bodyMinH: getComputedStyle(body).minHeight,
      bodyPaddingBottom: getComputedStyle(body).paddingBottom,
      viewer: box(viewer),
      viewerOverflowY: getComputedStyle(viewer).overflowY,
      viewerScroll: { sh: viewer.scrollHeight, ch: viewer.clientHeight, sw: viewer.scrollWidth, cw: viewer.clientWidth },
      img: box(img),
      imgFit: img.hidden ? null : getComputedStyle(img).objectFit,
      frame: box(frame),
      viewport: { w: innerWidth, h: innerHeight },
      docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
}

test("Viewer mobile : header borné, fullscreen, documents, responsive Nouvel onglet", async t => {
  const engines = [["Chromium", chromium], ["WebKit", webkit]];
  const server = await startStaticServer(ROOT);
  try {
    for (const [engineName, engine] of engines) {
      let browser;
      try { browser = await engine.launch({ headless: true }); }
      catch (error) {
        if (engineName === "WebKit") { t.diagnostic(`WebKit indisponible : ${error.message}`); continue; }
        throw error;
      }
      try {
        for (const [width, height] of [[320, 844], [390, 844], [760, 900]]) {
          await t.test(`${engineName} ${width}×${height}`, async () => {
            const { context, page } = await createViewerPage(browser, server, width, height);
            try {
              /* --- header court / moyen / long --- */
              const headers = {};
              for (const [key, title] of Object.entries(TITLES)) {
                await openViewer(page, { title, fileName: "acte-1891.pdf", src: portraitSvg });
                const m = await measureViewer(page);
                headers[key] = m;
                const target = height * 0.92;
                assert.ok(m.open, `${key} : viewer ouvert`);
                assert.ok(Math.abs(m.dialog.h - (width <= 560 ? height : height - 12)) < 2, `${key} : dialog fullscreen/quasi-fullscreen (${m.dialog.h} / ${height})`);
                assert.ok(m.dialog.h < height + 1, `${key} : dialog ≤ viewport`);
                /* fullscreen conservé, pas 92dvh */
                if (width <= 560) {
                  assert.ok(Math.abs(m.dialog.h - height) < 1, `${key} : vrai fullscreen ≤560px`);
                  assert.equal(m.radius, "0px", `${key} : radius 0 en fullscreen`);
                }
                assert.ok(m.titleAccessible, `${key} : titre complet accessible`);
                assert.ok(m.bodyDisplay === "flex", `${key} : modal-body flex`);
                assert.equal(m.bodyMinH, "0px", `${key} : modal-body min-height 0`);
                assert.equal(m.viewerOverflowY, "auto", `${key} : viewer-body scrollable`);
                assert.equal(m.docOverflowX, 0, `${key} : aucun overflow horizontal`);
                assert.ok(m.closeBtn && m.closeBtn.w >= 43.5 && m.closeBtn.h >= 43.5, `${key} : fermeture ≥44px`);
                assert.ok(m.externalAriaLabel === "Ouvrir dans un nouvel onglet", `${key} : aria-label conservé`);
                assert.ok(m.externalTitle === "Ouvrir dans un nouvel onglet", `${key} : title conservé`);
                /* sous-titre visible sur mobile */
                assert.notEqual(m.subtitleDisplay, "none", `${key} : sous-titre visible`);
                assert.equal(m.subtitleEllipsis, "ellipsis", `${key} : ellipsis sous-titre`);
                /* clamp : le header ne doit plus exploser avec un titre long */
                if (key === "long") {
                  assert.ok(m.titleH <= 2 * 40 + 2, `${key} : titre borné à 2 lignes (h=${m.titleH})`);
                  assert.ok(m.head.h <= 130, `${key} : header long borné (${m.head.h}px, avant ~185px)`);
                }
                if (key === "short") {
                  assert.ok(m.head.h <= 120, `${key} : header court borné (${m.head.h}px)`);
                }
              }
              t.diagnostic(`${engineName} ${width}×${height}: header short=${headers.short.head.h} medium=${headers.medium.head.h} long=${headers.long.head.h} ; doc long=${headers.long.viewer.h} ; dialog=${headers.long.dialog.h}`);
              /* la zone document reste majoritaire même avec un titre long */
              assert.ok(headers.long.viewer.h >= height * 0.7, `zone doc titre long ≥70% viewport (${headers.long.viewer.h} / ${height})`);

              /* --- responsive Nouvel onglet : icône seule à toutes les largeurs --- */
              for (const vw of [320, 390, 480, 481, 560, 760]) {
                await page.setViewportSize({ width: vw, height: 844 });
                await openViewer(page, { title: TITLES.short, fileName: "acte.pdf", src: portraitSvg });
                const m = await measureViewer(page);
                assert.equal(m.externalText, "", `${vw}px : icône seule, sans texte visible`);
                assert.equal(m.externalIconHref, "#icon-external-link", `${vw}px : icône externe dédiée`);
                assert.ok(m.externalBtn && m.externalBtn.w >= 43.5 && m.externalBtn.h >= 43.5, `${vw}px : cible ≥44px (${JSON.stringify(m.externalBtn)})`);
                assert.equal(m.externalAriaLabel, "Ouvrir dans un nouvel onglet", `${vw}px : nom accessible explicite`);
              }
              /* retour viewport de test pour les cas documents */
              await page.setViewportSize({ width, height });

              /* --- types de documents --- */
              for (const [label, kind, src] of [
                ["portrait", "image", portraitSvg],
                ["paysage", "image", landscapeSvg],
                ["très haut", "image", tallSvg],
                ["très large", "image", wideSvg],
                ["PDF", "pdf", null]
              ]) {
                await openViewer(page, { title: TITLES.short, fileName: "doc-" + label + ".bin", kind, src: src || portraitSvg });
                const m = await measureViewer(page);
                assert.ok(m.open, `${label} : ouvert`);
                assert.equal(m.docOverflowX, 0, `${label} : pas d'overflow horizontal`);
                if (kind === "image") {
                  assert.ok(m.img, `${label} : img présente`);
                  assert.equal(m.imgFit, "contain", `${label} : ratio conservé`);
                  assert.ok(m.viewerScroll.sh >= m.viewerScroll.ch, `${label} : scroll géré`);
                } else {
                  assert.ok(m.frame, `${label} : iframe présente`);
                  assert.ok(m.frame.w > 100 && m.frame.h > 100, `${label} : iframe visible`);
                }
              }
              /* scroll unique + dernier pixel du document consultable */
              await openViewer(page, { title: TITLES.short, fileName: "haut.pdf", kind: "image", src: tallSvg });
              const before = await measureViewer(page);
              assert.ok(before.viewerScroll.sh > before.viewerScroll.ch, "document haut défilable");
              await page.locator(".viewer-body").evaluate(el => { el.scrollTop = el.scrollHeight; });
              await page.waitForTimeout(40);
              const afterScroll = await page.evaluate(() => {
                const viewer = document.querySelector(".viewer-body");
                const body = document.querySelector("#documentViewerDialog > .modal-body");
                return { viewerTop: viewer.scrollTop, bodyTop: body.scrollTop, bodyOverflow: getComputedStyle(body).overflow };
              });
              assert.ok(afterScroll.viewerTop > 0, "scroll sur viewer-body");
              assert.equal(afterScroll.bodyTop, 0, "pas de scroll sur modal-body");
              assert.equal(afterScroll.bodyOverflow, "auto", "le modal-body peut défiler pour les informations sans empêcher le défilement du document");
              assert.deepEqual(before.head, (await measureViewer(page)).head, "header stable pendant le scroll");
            } finally { await context.close(); }
          });
        }
      } finally { await browser.close(); }
    }
  } finally { await server.close(); }
});

test("Viewer desktop 1024×768 : inchangé (texte, titre, sous-titre, modale centrée)", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page } = await createViewerPage(browser, server, 1024, 768);
    try {
      await openViewer(page, { title: TITLES.medium, fileName: "acte-1891.pdf", src: landscapeSvg });
      const m = await measureViewer(page);
      assert.ok(m.open, "viewer ouvert");
      assert.equal(m.externalText, "", "l’action externe reste une icône seule sur desktop");
      assert.equal(m.externalIconHref, "#icon-external-link", "icône externe dédiée sur desktop");
      assert.equal(m.subtitleDisplay, "block", "sous-titre visible sur desktop");
      assert.equal(m.titleClamp, "none", "pas de clamp 2 lignes sur desktop");
      /* modale centrée et non plein écran */
      assert.ok(m.dialog.w < 1024 - 40, `modale non pleine largeur (${m.dialog.w})`);
      assert.ok(m.dialog.y > 10, `modale centrée verticalement (y=${m.dialog.y})`);
      assert.ok(parseFloat(m.radius) > 0, `radius desktop conservé (${m.radius})`);
      assert.ok(m.imgFit === "contain", "ratio conservé desktop");
      assert.equal(m.docOverflowX, 0);
      t.diagnostic(`desktop 1024×768: dialog=${m.dialog.w}×${m.dialog.h} y=${m.dialog.y} head=${m.head.h} external=${m.externalIconHref}`);
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});

test("Viewer : non-régression des sheets 92dvh (CSS inchangé)", () => {
  assert.match(css, /dialog#documentDialog\.modal-mobile-sheet,\s*\n\s*dialog#dossierDialog\.modal-mobile-sheet/);
  assert.match(css, /dialog\.modal-mobile-sheet--long-form \{ height: 92dvh; max-height: 92dvh; \}/);
  assert.match(css, /dialog#taskDialog\.modal-mobile-sheet--form \{\s*\n\s*height: 92dvh;\s*\n\s*max-height: 92dvh;/);
  assert.match(css, /dialog#procedureActionDialog\.modal-mobile-sheet--form,\s*\n\s*dialog#personPrintDialog\.modal-mobile-sheet--form/);
  assert.match(css, /#procedureDetailDialog\.modal-mobile-sheet--stable \{\s*\n\s*height: 92dvh;/);
  /* viewer volontairement hors du pattern sheet */
  assert.doesNotMatch(html, /id="documentViewerDialog"[^>]*modal-mobile-sheet/);
});

test("Les points d’ouverture des documents existants conservent le flux vers la visionneuse", () => {
  assert.match(app, /function renderDocuments\(\)[\s\S]*?data-document-card/);
  assert.match(app, /function setupViewerImage\(item\)[\s\S]*?createDocumentImageViewer/);
  assert.match(app, /async function openStoredDocument\(item\)[\s\S]*?readChunkedFile\(item\)[\s\S]*?setupViewerImage\(item\)/);
  assert.match(app, /const isPdf = mimeType\.toLowerCase\(\)\.includes\("pdf"\)[\s\S]*?setupViewerPdf\(source, item\.id\)/);
  assert.match(app, /\$\("documentsList"\)\.onclick = event => \{[\s\S]*?openStoredDocument\(item\);/);
  assert.match(app, /\$\("personDocumentsList"\)\.addEventListener\("keydown",[\s\S]*?openStoredDocument\(item\);/);
  assert.match(app, /\$\("directoryDocumentsList"\)\.addEventListener\("click",[\s\S]*?openStoredDocument\(documents\.find/);
});

test("JPEG/PNG : contrôles réels, Informations et plein écran desktop/mobile", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const [width, height] of [[1280, 900], [375, 812]]) {
      const { context, page } = await createViewerPage(browser, server, width, height);
      try {
        await openViewer(page, { title: "Acte de naissance", fileName: "acte-1891.svg", src: landscapeSvg });
        const measurements = await page.evaluate(isNarrow => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
          const controls = document.getElementById("viewerImageControls");
          const reader = document.getElementById("viewerImageViewport");
          return {
            controls: rect("#viewerImageControls"), reader: rect("#viewerImageViewport"),
            zoomOut: rect('[data-viewer-image-zoom="out"]'), zoomIn: rect('[data-viewer-image-zoom="in"]'),
            fit: rect("#viewerImageModeBtn"), fullscreen: rect("#viewerFullscreenBtn"), external: rect("#viewerExternalBtn"),
            info: rect(isNarrow ? "#viewerDetailsBtn" : "#viewerDetailsExpandBtn"),
            scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
            readerOverflow: getComputedStyle(reader).overflowY, controlsWidth: controls.getBoundingClientRect().width
          };
        }, width <= 760);
        const infoButton = page.locator(width <= 760 ? "#viewerDetailsBtn" : "#viewerDetailsExpandBtn");
        const readControls = await page.locator("#viewerImageControls .btn:visible:not(#viewerDetailsExpandBtn)").all();
        assert.equal(readControls.length, 5, `${width}px : zoom −/+, Ajuster, Plein écran et Nouvel onglet visibles`);
        assert.ok(Math.abs(measurements.zoomIn.x - measurements.zoomOut.right + 1) <= 1, `${width}px : boutons de zoom JPEG/PNG accolés`);
        assert.ok(measurements.fit.x > measurements.zoomIn.x && measurements.fullscreen.x > measurements.fit.x && measurements.external.x > measurements.fullscreen.x, `${width}px : commandes accessibles dans l’ordre`);
        assert.ok(measurements.external.width >= 43.5 && measurements.external.height >= 43.5, `${width}px : Nouvel onglet reste une cible tactile`);
        assert.equal(measurements.scrollWidth, measurements.viewportWidth, `${width}px : aucun débordement horizontal`);
        if (width > 760) {
          assert.ok(measurements.info.right >= measurements.controls.right - 2, "Informations reste à droite de la barre desktop");
          assert.ok(Math.abs(measurements.reader.y - measurements.controls.bottom - 12) <= 1, "espacement image desktop de 12px inchangé");
        } else {
          assert.ok(measurements.info.width >= measurements.controlsWidth - 2 && measurements.info.height >= 43.5, "bouton Informations mobile large et tactile");
          assert.ok(measurements.info.y >= measurements.reader.bottom - 1, "bouton Informations sous l’image");
        }
        const zoomStart = await page.evaluate(() => window.__viewerImageController.getState().zoom);
        await page.locator('[data-viewer-image-zoom="in"]').click();
        assert.equal(await page.evaluate(() => window.__viewerImageController.getState().zoom), zoomStart * 1.25, `${width}px : Zoom + fonctionne`);
        await page.locator('[data-viewer-image-zoom="out"]').click();
        assert.equal(await page.evaluate(() => window.__viewerImageController.getState().zoom), zoomStart, `${width}px : Zoom − fonctionne indépendamment`);
        await page.locator("#viewerImageModeBtn").click();
        assert.equal(await page.evaluate(() => window.__viewerImageController.getState().mode), "width", `${width}px : Ajuster fonctionne`);
        await infoButton.click();
        assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true, `${width}px : Informations s’ouvre`);
        await infoButton.click();
        assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), true, `${width}px : le même bouton ferme Informations`);
        await infoButton.click();
        assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true, `${width}px : Informations se rouvre`);
        if (width <= 760) {
          await page.setViewportSize({ width: 844, height: 390 });
          await page.waitForTimeout(80);
          assert.equal(await page.locator("#pdfPanelToggles").isHidden(), true, "en paysage, le dépliant mobile quitte la ligne de lecture");
          assert.equal(await page.locator("#viewerDetailsExpandBtn").isVisible(), true, "en paysage, le bouton desktop Informations revient dans la barre");
          await page.setViewportSize({ width: 375, height: 812 });
          await page.waitForTimeout(80);
          assert.equal(await page.locator("#viewerDetailsBtn").isVisible(), true, "en portrait, le bouton dépliant Informations revient sous l’image");
        }
        await page.locator("#viewerFullscreenBtn").click();
        await page.waitForFunction(() => document.getElementById("documentViewerDialog").classList.contains("is-viewer-fullscreen"));
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.getElementById("documentViewerDialog").classList.contains("is-viewer-fullscreen"));
        assert.equal(await page.locator("#viewerImage").evaluate(image => image.naturalWidth / image.naturalHeight), 4, `${width}px : proportions originales conservées`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await server.close(); }
});
