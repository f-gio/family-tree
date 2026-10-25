import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";
import { selectInitialDocumentImageMode } from "../js/document-image-viewer.js";

const [html, css] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../css/design-system.css", import.meta.url), "utf8")
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

test("Le mode initial privilégie la largeur pour les photographies portrait très verticales", () => {
  assert.equal(selectInitialDocumentImageMode({ naturalWidth: 200, naturalHeight: 800 }), "width");
  assert.equal(selectInitialDocumentImageMode({ naturalWidth: 1000, naturalHeight: 1400 }), "fit");
  assert.equal(selectInitialDocumentImageMode({ naturalWidth: 1200, naturalHeight: 600 }), "fit");
  assert.equal(selectInitialDocumentImageMode({ naturalWidth: 0, naturalHeight: 600 }), "fit");
});

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
  assert.match(css, /\.viewer-dialog #viewerExternalBtn \.viewer-external-label \{ display: none; \}/);
  /* Accessible name conservé */
  assert.match(html, /id="viewerExternalBtn"[^>]*aria-label="Ouvrir l’original dans un nouvel onglet"[^>]*title="Ouvrir dans un nouvel onglet"/);
  assert.match(html, /class="viewer-image-controls"[\s\S]*?id="viewerImageModeBtn"[\s\S]*?id="viewerExternalBtn"/);
  assert.doesNotMatch(html.match(/id="viewerActionsMenu"[\s\S]*?<\/div>/)?.[0] || "", /viewerExternalBtn/);
  assert.match(html, /id="viewerExternalBtn"[^>]*><svg class="ui-icon"[^>]*><use href="#icon-link"><\/use><\/svg><span class="viewer-external-label">Nouvel onglet<\/span><\/a>/);
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
  await page.evaluate(({ title, fileName, kind, src }) => {
    const dialog = document.getElementById("documentViewerDialog");
    if (dialog.open) dialog.close();
    document.getElementById("viewerTitle").textContent = title;
    document.getElementById("viewerSubtitle").textContent = fileName;
    const img = document.getElementById("viewerImage");
    const frame = document.getElementById("viewerFrame");
    img.hidden = true;
    frame.hidden = true;
    frame.removeAttribute("src");
    img.removeAttribute("src");
    document.getElementById("viewerMessage").hidden = true;
    document.getElementById("viewerImageControls").hidden = false;
    document.querySelectorAll("#viewerImageControls .viewer-image-only").forEach(control => { control.hidden = kind !== "image"; });
    document.getElementById("viewerExternalBtn").hidden = false;
    document.getElementById("viewerExternalBtn").href = src;
    document.getElementById("viewerDocumentDetailsContent").innerHTML = `<section class="document-unified-section"><h4>Informations documentaires</h4><div class="document-unified-facts">${Array.from({ length: 4 }, (_, index) => `<div class="document-unified-fact"><strong>Métadonnée ${index + 1}</strong><span>Valeur de démonstration ${index + 1}</span></div>`).join("")}</div></section><section class="document-unified-section"><h4>Personnes concernées</h4><p>Marie Rossi et Jean Rossi</p></section><section class="document-unified-section"><h4>Sources et provenance</h4>${Array.from({ length: 2 }, (_, index) => `<details class="document-unified-source" open><summary>Source liée ${index + 1}</summary><p>Cote archivistique de démonstration</p></details>`).join("")}</section>`;
    document.getElementById("viewerDetailsCollapseBtn").hidden = innerWidth <= 760;
    if (kind === "image") {
      img.src = src;
      img.hidden = false;
    } else {
      const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])], { type: "application/pdf" });
      frame.src = URL.createObjectURL(blob);
      frame.hidden = false;
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
    const layout = dialog.querySelector(".document-unified-layout");
    const originalPanel = dialog.querySelector(".document-original-panel");
    const detailsPanel = dialog.querySelector(".document-unified-details");
    const viewer = dialog.querySelector(".viewer-body");
    const title = document.getElementById("viewerTitle");
    const subtitle = document.getElementById("viewerSubtitle");
    const external = document.getElementById("viewerExternalBtn");
    const actionsButton = document.getElementById("viewerActionsBtn");
    const label = external.querySelector(".viewer-external-label");
    const closeBtn = head.querySelector("[data-close]");
    const editBtn = document.getElementById("viewerEditBtn");
    const img = document.getElementById("viewerImage");
    const frame = document.getElementById("viewerFrame");
    const box = el => {
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) };
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
      externalLabelDisplay: label ? getComputedStyle(label).display : null,
      externalLabelText: label ? label.textContent : null,
      externalAriaLabel: external.getAttribute("aria-label"),
      externalTitle: external.getAttribute("title"),
      externalBtn: box(external),
      actionsBtn: box(actionsButton),
      externalMinH: getComputedStyle(external).minHeight,
      closeBtn: box(closeBtn),
      backButtonCount: dialog.querySelectorAll("#viewerBackBtn").length,
      editMinHeight: getComputedStyle(editBtn).minHeight,
      body: box(body),
      bodyDisplay: getComputedStyle(body).display,
      bodyFlex: getComputedStyle(body).flex,
      bodyMinH: getComputedStyle(body).minHeight,
      bodyPaddingBottom: getComputedStyle(body).paddingBottom,
      layout: box(layout),
      layoutColumns: getComputedStyle(layout).gridTemplateColumns,
      originalPanel: box(originalPanel),
      detailsPanel: box(detailsPanel),
      detailsCollapseHidden: document.getElementById("viewerDetailsCollapseBtn").hidden,
      detailsExpandHidden: document.getElementById("viewerDetailsExpandBtn").hidden,
      detailsOverflowY: getComputedStyle(detailsPanel).overflowY,
      sourceSections: detailsPanel.querySelectorAll(".document-unified-source").length,
      detailSectionCount: detailsPanel.querySelectorAll(".document-unified-section").length,
      viewer: box(viewer),
       viewerOverflowY: getComputedStyle(viewer).overflowY,
       viewerScroll: { sh: viewer.scrollHeight, ch: viewer.clientHeight, sw: viewer.scrollWidth, cw: viewer.clientWidth },
       bodyScroll: { sh: body.scrollHeight, ch: body.clientHeight, sw: body.scrollWidth, cw: body.clientWidth, overflowY: getComputedStyle(body).overflowY },
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
                await page.locator("#viewerActionsBtn").click();
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
                assert.ok(m.layout && m.originalPanel && m.detailsPanel, `${key} : fiche unifiée contient original et informations`);
                assert.equal(m.detailSectionCount, 3, `${key} : informations, personnes et sources rendues`);
                assert.equal(m.sourceSections, 2, `${key} : plusieurs sources restent visibles séparément`);
                if (width <= 760) {
                  assert.ok(m.originalPanel.y < m.detailsPanel.y, `${width}px : original avant les informations sur mobile`);
                  assert.equal(m.detailsOverflowY, "visible", `${width}px : défilement vertical unique de la fiche`);
                  assert.equal(m.detailsCollapseHidden, true, `${width}px : aucun bouton de panneau desktop sur mobile`);
                } else {
                  assert.ok(m.originalPanel.x < m.detailsPanel.x, `${width}px : original à gauche des informations`);
                  assert.ok(m.originalPanel.right <= m.detailsPanel.x + 1, `${width}px : panneaux desktop non chevauchés`);
                  assert.equal(m.detailsOverflowY, "auto", `${width}px : panneau d’informations défilant indépendamment`);
                }
                assert.equal(m.viewerOverflowY, width <= 760 ? "hidden" : "auto", `${key} : original contenu dans son panneau mobile`);
                assert.equal(m.docOverflowX, 0, `${key} : aucun overflow horizontal`);
                assert.ok(m.closeBtn && m.closeBtn.w >= 43.5 && m.closeBtn.h >= 43.5, `${key} : fermeture ≥44px`);
                assert.equal(m.backButtonCount, 0, `${key} : bouton Retour supprimé`);
                assert.ok(m.closeBtn && m.actionsBtn, `${key} : fermeture X et menu d’actions accessibles`);
                if (width <= 760) assert.ok(m.actionsBtn.h >= 43.5, `${key} : menu tactile`);
                assert.ok(m.externalBtn && await page.locator("#viewerExternalBtn").getAttribute("href") === await page.locator("#viewerImage").getAttribute("src"), `${key} : nouvel onglet pointe sur la source exacte de l’image`);
                assert.equal(await page.locator("#viewerActionsMenu").isVisible(), true, `${key} : menu d’actions ouvrable`);
                assert.equal(await page.locator('#viewerActionsMenu [role="menuitem"]').count(), 1, `${key} : Modifier seule reste dans le menu`);
                assert.ok(m.externalBtn, `${key} : Nouvel onglet est accessible dans la barre du lecteur`);
                await page.keyboard.press("Escape");
                assert.ok(m.externalAriaLabel === "Ouvrir l’original dans un nouvel onglet", `${key} : aria-label conservé`);
                assert.ok(m.externalTitle === "Ouvrir dans un nouvel onglet", `${key} : title conservé`);
                /* sous-titre fileName visible tablette, masqué sur téléphone pour préserver l'espace de lecture */
                if (width <= 560) assert.equal(m.subtitleDisplay, "none", `${key} : sous-titre masqué pour libérer l'espace mobile`);
                else {
                  assert.notEqual(m.subtitleDisplay, "none", `${key} : sous-titre visible`);
                  assert.equal(m.subtitleEllipsis, "ellipsis", `${key} : ellipsis sous-titre`);
                }
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
                assert.ok(headers.long.viewer.h >= height * 0.38, `original suffisamment grand avant les informations documentaires (${headers.long.viewer.h} / ${height})`);

              /* --- responsive Nouvel onglet --- */
              for (const [vw, expectIcon] of [[320, true], [390, true], [480, true], [481, false], [560, false], [760, false]]) {
                await page.setViewportSize({ width: vw, height: 844 });
                await openViewer(page, { title: TITLES.short, fileName: "acte.pdf", src: portraitSvg });
                await page.locator("#viewerActionsBtn").click();
                const m = await measureViewer(page);
                if (expectIcon) {
                  assert.equal(m.externalLabelDisplay, "none", `${vw}px : libellé masqué (icône seule)`);
                  assert.ok(m.externalBtn && m.externalBtn.w >= 43.5 && m.externalBtn.h >= 43.5, `${vw}px : cible ≥44px (${JSON.stringify(m.externalBtn)})`);
                  assert.equal(m.externalAriaLabel, "Ouvrir l’original dans un nouvel onglet", `${vw}px : accessible name`);
                } else {
                  assert.notEqual(m.externalLabelDisplay, "none", `${vw}px : libellé texte visible`);
                  assert.equal(m.externalLabelText, "Nouvel onglet", `${vw}px : libellé « Nouvel onglet »`);
                }
                await page.keyboard.press("Escape");
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
                  assert.ok(m.bodyScroll.sh >= m.bodyScroll.ch, `${label} : fiche complète défilable dans son conteneur`);
                } else {
                  assert.ok(m.frame, `${label} : iframe présente`);
                  assert.ok(m.frame.w > 100 && m.frame.h > 100, `${label} : iframe visible`);
                }
              }
               /* Le panneau fiche est le scroller mobile unique ; l'original reste contenu dans son cadre. */
               await openViewer(page, { title: TITLES.short, fileName: "haut.pdf", kind: "image", src: tallSvg });
               const before = await measureViewer(page);
               assert.ok(before.bodyScroll.sh > before.bodyScroll.ch, "informations complètes défilables");
               await page.locator("#documentViewerDialog > .modal-body").evaluate(el => { el.scrollTop = el.scrollHeight; });
               await page.waitForTimeout(40);
               const afterScroll = await page.evaluate(() => {
                 const viewer = document.querySelector(".viewer-body");
                 const body = document.querySelector("#documentViewerDialog > .modal-body");
                 return { viewerTop: viewer.scrollTop, bodyTop: body.scrollTop, bodyOverflow: getComputedStyle(body).overflow };
               });
               assert.equal(afterScroll.viewerTop, 0, "l’original reste contenu dans son panneau");
               assert.ok(afterScroll.bodyTop > 0, "la fiche entière défile dans le panneau principal");
               assert.equal(afterScroll.bodyOverflow, "auto", "modal-body est le scroller unique");
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
      assert.notEqual(m.externalLabelDisplay, "none", "texte « Nouvel onglet » visible sur desktop");
      assert.equal(m.externalLabelText, "Nouvel onglet");
      assert.equal(m.subtitleDisplay, "block", "sous-titre visible sur desktop");
      assert.equal(m.titleClamp, "none", "pas de clamp 2 lignes sur desktop");
      /* modale centrée et non plein écran */
      assert.ok(m.dialog.w < 1024 - 40, `modale non pleine largeur (${m.dialog.w})`);
      assert.ok(m.dialog.y > 10, `modale centrée verticalement (y=${m.dialog.y})`);
      assert.ok(parseFloat(m.radius) > 0, `radius desktop conservé (${m.radius})`);
      assert.ok(m.imgFit === "contain", "ratio conservé desktop");
      assert.equal(m.docOverflowX, 0);
      t.diagnostic(`desktop 1024×768: dialog=${m.dialog.w}×${m.dialog.h} y=${m.dialog.y} head=${m.head.h} external=${m.externalLabelDisplay}`);
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});

test("Zoom tactile image : affichage ajusté, pincement, déplacement, reset et resize", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page } = await createViewerPage(browser, server, 390, 844);
    try {
      const result = await page.evaluate(async () => {
        document.body.insertAdjacentHTML("beforeend", `<div id="gestureViewport" style="position:relative;width:360px;height:280px;overflow:hidden;touch-action:pan-y"><img id="gestureImage" alt="Registre de test"></div><div id="gestureControls"><button type="button" data-viewer-image-zoom="out">−</button><span id="gestureZoomLabel"></span><button type="button" data-viewer-image-zoom="reset">Ajuster</button><button type="button" data-viewer-image-zoom="in">+</button></div>`);
        const { createDocumentImageViewer, selectInitialDocumentImageMode } = await import("./js/document-image-viewer.js");
        const image = document.getElementById("gestureImage");
        image.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="#b8c9be"/></svg>');
        await image.decode();
        const controller = createDocumentImageViewer({ viewport: document.getElementById("gestureViewport"), image, controls: document.getElementById("gestureControls"), zoomLabel: document.getElementById("gestureZoomLabel") });
        const initial = controller.getState();
        const viewport = document.getElementById("gestureViewport");
        const touch = (identifier, clientX, clientY) => new Touch({ identifier, target: viewport, clientX, clientY });
        const start = new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(1, 120, 120), touch(2, 240, 120)] });
        viewport.dispatchEvent(start);
        const move = new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [touch(1, 60, 120), touch(2, 300, 120)] });
        viewport.dispatchEvent(move);
        const zoomed = controller.getState();
        viewport.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [] }));
        viewport.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(3, 180, 120)] }));
        viewport.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [touch(3, 220, 140)] }));
        const panned = controller.getState();
        viewport.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [] }));
        controller.reset();
        const reset = controller.getState();
        viewport.style.width = "300px";
        await new Promise(resolve => setTimeout(resolve, 80));
        const resized = controller.getState();
        controller.destroy();
        return { initial, zoomed, panned, reset, resized, prevented: move.defaultPrevented, natural: [image.naturalWidth, image.naturalHeight] };
      });
      assert.deepEqual(result.natural, [800, 200]);
      assert.equal(result.initial.zoom, 1);
      assert.ok(result.initial.fitWidth <= 360 && result.initial.fitHeight <= 280, "l’image entière tient dans le viewport au départ");
      assert.ok(result.zoomed.zoom > 1.9, "le pincement à deux doigts zoome l’image");
      assert.equal(result.prevented, true, "le pincement empêche le zoom de page pendant le geste image");
      assert.ok(Math.abs(result.panned.offsetX) > 0 || Math.abs(result.panned.offsetY) > 0, "le déplacement tactile agit sur l’image agrandie");
      assert.equal(result.reset.zoom, 1);
      assert.equal(result.reset.offsetX, 0);
      assert.equal(result.reset.offsetY, 0);
      assert.equal(result.resized.fitWidth, 300, "ResizeObserver réajuste l’image à la nouvelle largeur disponible");
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

test("Zoom image : pincement tactile synthétique, panoramique, reset et adaptation au redimensionnement", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page } = await createViewerPage(browser, server, 390, 844);
    try {
      const states = await page.evaluate(async () => {
        document.body.insertAdjacentHTML("beforeend", `<div id="gestureViewport" style="position:fixed;left:10px;top:10px;width:360px;height:280px;overflow:auto;touch-action:pan-y"><img id="gestureImage" alt="Photographie de registre"></div><div id="gestureControls"><button type="button" data-viewer-image-zoom="out">−</button><span id="gestureZoomLabel"></span><button type="button" data-viewer-image-mode-toggle>Ajuster à la largeur</button><button type="button" data-viewer-image-zoom="reset">Réinitialiser le zoom</button><button type="button" data-viewer-image-zoom="in">+</button></div>`);
        const { createDocumentImageViewer, selectInitialDocumentImageMode } = await import("./js/document-image-viewer.js");
        const image = document.getElementById("gestureImage");
        image.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="800"><rect width="200" height="800" fill="#b8c9be"/></svg>');
        await image.decode();
        const viewport = document.getElementById("gestureViewport");
        const modeButton = document.querySelector("#gestureControls [data-viewer-image-mode-toggle]");
        const initialMode = selectInitialDocumentImageMode({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
        const controller = createDocumentImageViewer({ viewport, image, controls: document.getElementById("gestureControls"), zoomLabel: document.getElementById("gestureZoomLabel"), modeButton, initialMode });
        const initial = controller.getState();
        modeButton.click();
        const windowFit = controller.getState();
        modeButton.click();
        const widthMode = controller.getState();
        const widthScrollRange = viewport.scrollHeight - viewport.clientHeight;
        viewport.scrollTop = 80;
        const widthScrollPosition = viewport.scrollTop;
        viewport.scrollTop = 0;
        const touch = (identifier, clientX, clientY) => new Touch({ identifier, target: viewport, clientX, clientY });
        const pinchStart = new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(1, 100, 120), touch(2, 220, 120)] });
        viewport.dispatchEvent(pinchStart);
        const pinchMove = new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [touch(1, 40, 120), touch(2, 280, 120)] });
        viewport.dispatchEvent(pinchMove);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const zoomed = controller.getState();
        const zoomRender = { layoutWidth: Number.parseFloat(image.style.width), layoutHeight: Number.parseFloat(image.style.height), cssWidth: image.style.width, cssHeight: image.style.height, cssTransform: image.style.transform };
        viewport.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [] }));
        viewport.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(3, 150, 120)] }));
        viewport.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [touch(3, 185, 140)] }));
        const panned = controller.getState();
        viewport.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [] }));
        controller.reset();
        const reset = controller.getState();
        viewport.style.width = "280px";
        await new Promise(resolve => setTimeout(resolve, 100));
        const resized = controller.getState();
        modeButton.click();
        const windowMode = controller.getState();
        controller.destroy();
        return { natural: [image.naturalWidth, image.naturalHeight], initial, initialMode, windowFit, widthMode, widthModeLabel: modeButton.textContent, widthScrollRange, widthScrollPosition, zoomed, zoomRender, panned, reset, resized, windowMode, pinchPrevented: pinchMove.defaultPrevented };
      });
      assert.deepEqual(states.natural, [200, 800]);
      assert.equal(states.initialMode, "width", "le portrait long démarre en mode largeur");
      assert.equal(states.initial.zoom, 1);
      assert.equal(states.initial.fitWidth, 360);
      assert.equal(states.initial.fitHeight, 1440);
      assert.equal(states.initial.mode, "width");
      assert.equal(states.windowFit.mode, "fit");
      assert.equal(states.windowFit.fitWidth, 70, "ajuster à la fenêtre montre l'image entière sans la recadrer");
      assert.equal(states.windowFit.fitHeight, 280);
      assert.equal(states.widthMode.mode, "width", `mode actif après toggle (${states.widthMode.mode}; label=${states.widthModeLabel})`);
      assert.equal(states.widthMode.fitWidth, 360, "mode largeur utilise toute la largeur disponible");
      assert.ok(states.widthMode.fitHeight > 280, "document vertical défile sans recadrage en mode largeur");
      assert.ok(states.widthScrollRange > 0 && states.widthScrollPosition > 0, "le mode largeur permet le défilement vertical natif du document long");
      assert.ok(states.zoomed.zoom >= 1.9 && states.pinchPrevented, "pincement à deux doigts intercepté et zoom appliqué");
      assert.ok(states.zoomRender.layoutWidth >= states.widthMode.fitWidth * states.zoomed.zoom - 1, `la boîte de layout est rasterisée à sa dimension zoomée à partir de l’image source (${JSON.stringify(states.zoomRender)}; zoom=${states.zoomed.zoom}; fit=${states.widthMode.fitWidth})`);
      assert.ok(states.zoomRender.layoutHeight >= states.widthMode.fitHeight * states.zoomed.zoom - 1, "la hauteur de layout suit aussi la résolution d’affichage zoomée");
      assert.doesNotMatch(states.zoomRender.cssTransform, /scale\(/, "aucun agrandissement de texture CSS par scale() au zoom");
      assert.ok(Math.abs(states.panned.offsetX) > 0, "panoramique actif après agrandissement");
      assert.equal(states.reset.zoom, 1);
      assert.equal(states.reset.offsetX, 0);
      assert.equal(states.reset.offsetY, 0);
      assert.equal(states.resized.fitWidth, 280, "ResizeObserver recalcule l’échelle du mode largeur");
      assert.equal(states.windowMode.mode, "fit");
      assert.ok(states.windowMode.fitWidth <= 280 && states.windowMode.fitHeight <= 280, "mode fenêtre restaure l’image entière dans son ratio naturel");
      t.diagnostic(`Zoom 2× : boîte CSS explicitement portée à ${states.zoomRender.cssWidth} × ${states.zoomRender.cssHeight}, transform=${states.zoomRender.cssTransform}; natural=${states.natural.join("×")}`);
      t.diagnostic(`Portrait source 200×800, viewport 360×280 : largeur initiale=${states.initial.fitWidth.toFixed(0)}×${states.initial.fitHeight.toFixed(0)} ; fenêtre=${states.windowFit.fitWidth.toFixed(0)}×${states.windowFit.fitHeight.toFixed(0)} ; largeur=${states.widthMode.fitWidth.toFixed(0)}×${states.widthMode.fitHeight.toFixed(0)} ; viewport redimensionné=${states.resized.fitWidth.toFixed(0)}×${states.resized.fitHeight.toFixed(0)}`);
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});

test("Desktop : panneau d'informations repliable sans recharger ni réinitialiser le lecteur", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page } = await createViewerPage(browser, server, 1280, 900);
    try {
      await openViewer(page, { title: TITLES.medium, fileName: "registre.jpg", src: landscapeSvg });
      const initial = await page.locator(".document-original-panel").boundingBox();
      const src = await page.locator("#viewerImage").getAttribute("src");
      await page.locator("#viewerDetailsCollapseBtn").click();
      await page.waitForFunction(() => document.getElementById("documentUnifiedLayout").classList.contains("is-details-collapsed"));
      const collapsed = await page.locator(".document-original-panel").boundingBox();
      assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), true);
      assert.ok(collapsed.width > initial.width + 100, "le panneau original gagne la largeur du panneau droit");
      assert.equal(await page.locator("#viewerImage").getAttribute("src"), src, "le fichier n’est pas rechargé pendant le repli");
      await page.locator("#viewerDetailsExpandBtn").click();
      await page.waitForFunction(() => !document.getElementById("documentUnifiedLayout").classList.contains("is-details-collapsed"));
      const restored = await page.locator(".document-original-panel").boundingBox();
      assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true);
      assert.ok(Math.abs(restored.width - initial.width) < 2, "la disposition initiale à deux panneaux est restaurée");
      assert.equal(await page.locator("#viewerImage").getAttribute("src"), src, "le document reste chargé après réouverture");
      t.diagnostic(`Desktop 1280×900 : panneau original initial=${initial.width.toFixed(0)}px ; replié=${collapsed.width.toFixed(0)}px ; restauré=${restored.width.toFixed(0)}px; URL d’image inchangée`);
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});

test("La fermeture X du viewer conserve la vue Documents sous-jacente", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page } = await createViewerPage(browser, server, 1024, 768);
    try {
      await page.evaluate(() => {
        document.getElementById("documentsView").hidden = false;
        document.getElementById("genealogyView").hidden = true;
      });
      await openViewer(page, { title: "Acte consulté", fileName: "acte.jpg", src: landscapeSvg });
      await page.locator('#documentViewerDialog [data-close="documentViewerDialog"]').click();
      assert.equal(await page.locator("#documentViewerDialog").evaluate(dialog => dialog.open), false);
      assert.equal(await page.locator("#documentsView").evaluate(view => view.hidden), false, "la bibliothèque reste la vue sous-jacente");
      assert.equal(await page.locator("#genealogyView").evaluate(view => view.hidden), true, "la fermeture ne redirige pas vers Archives");
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});
