import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";
import { selectInitialDocumentImageMode } from "../js/document-image-viewer.js";

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

test("Le mode initial privilégie la largeur pour les photographies portrait très verticales", () => {
  assert.equal(selectInitialDocumentImageMode({ naturalWidth: 200, naturalHeight: 800 }), "width");
  assert.equal(selectInitialDocumentImageMode({ naturalWidth: 1000, naturalHeight: 1400 }), "fit");
  assert.equal(selectInitialDocumentImageMode({ naturalWidth: 1200, naturalHeight: 600 }), "fit");
  assert.equal(selectInitialDocumentImageMode({ naturalWidth: 0, naturalHeight: 600 }), "fit");
});

test("Viewer : règles statiques mobile, commandes compactes, plein écran et safe-area", () => {
  assert.match(css, /\.document-unified-section \.person-chip \{ background: var\(--color-surface\); border: var\(--border-default\); \}/);
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
  /* Page dédiée : le shell de la page porte la disposition en colonnes. */
  assert.match(css, /\.document-detail-shell \{ display: flex; flex-direction: column;/);
  /* Clamp / troncature du titre scopé page */
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.document-detail-heading \.page-title \{ display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; white-space: normal; overflow-wrap: anywhere; \}/);
  assert.match(css, /#documentDetailView #viewerDetailsBtn,[\s\S]*?\.viewer-image-panel-toggles \{ display: none !important; \}/, "le contrôle hérité Informations est masqué sur mobile");
  /* Sous-titre visible hors téléphone (exception scopée page) */
  assert.match(css, /\.document-detail-heading #viewerSubtitle \{ display: block;[\s\S]*?text-overflow: ellipsis;/);
  /* Safe-area basse */
  assert.match(css, /#documentDetailView \{ min-height: calc\(100dvh - 8rem\); padding-bottom: max\(var\(--space-5\), calc\(var\(--space-5\) \+ env\(safe-area-inset-bottom\)\)\); \}/);
  assert.match(html, /class="viewer-image-zoom-group viewer-image-only"[\s\S]*?data-viewer-image-zoom="out"[\s\S]*?data-viewer-image-zoom="in"[\s\S]*?id="viewerImageModeBtn"[\s\S]*?id="viewerExternalBtn"/);
  assert.match(html, /id="viewerExternalBtn"[^>]*aria-label="Ouvrir dans un nouvel onglet"[^>]*title="Ouvrir dans un nouvel onglet"/);
  assert.match(html, /id="viewerExternalBtn"[^>]*><svg class="ui-icon"[^>]*><use href="#icon-external-link"><\/use><\/svg><\/a>/);
  assert.doesNotMatch(html, /viewer-external-label/);
  assert.doesNotMatch(html.match(/id="viewerActionsMenu"[\s\S]*?<\/div>/)?.[0] || "", /viewerExternalBtn/);
  assert.match(html, /id="viewerZoomIndicator" aria-hidden="true"/);
  assert.match(html, /id="viewerImageModeBtn"[^>]*aria-label="Ajuster à la largeur"[^>]*title="Ajuster à la largeur"[^>]*><svg class="ui-icon"[^>]*><use href="#icon-fit-width"><\/use><\/svg><\/button>/);
  assert.match(html, /id="viewerFullscreenBtn"[^>]*aria-label="Afficher en plein écran"[^>]*title="Afficher en plein écran"/);
  assert.match(css, /\.viewer-fullscreen-control \{ position: absolute;/);
  assert.match(css, /\.viewer-zoom-indicator \{[\s\S]*?pointer-events: none/);
  assert.match(css, /#documentDetailView\.is-viewer-fullscreen \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.viewer-zoom-indicator/);
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

async function openViewer(page, { title, fileName, kind = "image", src = portraitSvg, detailsCollapsed = false, zoomIndicatorDuration = 1500, forceFullscreenFallback = false }) {
  await page.evaluate(async ({ title, fileName, kind, src, detailsCollapsed, zoomIndicatorDuration, forceFullscreenFallback }) => {
    const documentPage = document.getElementById("documentDetailView");
    const fullscreenPanel = documentPage.querySelector(".document-original-panel");
    window.__viewerImageController?.destroy();
    window.__viewerImageController = null;
    /* Ouverture fidèle à setView : seule la page Document reste affichée. */
    for (const viewId of ["appMain", "directoryView", "documentsView", "genealogyView", "sourceDetailView", "proofDetailView", "tasksView", "dossiersView", "transcriptionWorkshopView"]) {
      const view = document.getElementById(viewId);
      if (view) view.hidden = true;
    }
    documentPage.hidden = false;
    document.getElementById("viewerTitle").textContent = title;
    document.getElementById("viewerTitle").setAttribute("aria-label", title);
    document.getElementById("viewerTitle").title = title;
    document.getElementById("viewerSubtitle").textContent = fileName;
    const img = document.getElementById("viewerImage");
    const frame = document.getElementById("viewerFrame");
    if (forceFullscreenFallback) {
      Object.defineProperty(fullscreenPanel, "requestFullscreen", { configurable: true, value: undefined });
      Object.defineProperty(fullscreenPanel, "webkitRequestFullscreen", { configurable: true, value: undefined });
    }
    document.getElementById("viewerImageViewport").removeAttribute("data-viewer-fit-mode");
    img.hidden = true;
    frame.hidden = true;
    frame.removeAttribute("src");
    img.removeAttribute("src");
    document.getElementById("viewerMessage").hidden = true;
    document.getElementById("viewerImageControls").hidden = false;
    document.querySelectorAll("#documentDetailView .viewer-image-only").forEach(control => { control.hidden = kind !== "image"; });
    document.getElementById("viewerExternalBtn").hidden = false;
    document.getElementById("viewerExternalBtn").href = src;
    document.getElementById("viewerDocumentDetailsContent").innerHTML = `<section class="document-unified-section"><div class="document-unified-section-head"><h4>Informations documentaires</h4><button class="btn small" type="button">Modifier</button></div><div class="document-unified-facts"><div class="document-unified-fact"><strong>Type</strong><span>Registre</span></div><div class="document-unified-fact"><strong>Format</strong><span>JPEG</span></div><div class="document-unified-fact document-unified-fact--wide"><strong>Fichier</strong><span title="${fileName}">${fileName}</span></div></div></section><section class="document-unified-section"><h4>Personnes concernées</h4><p>Marie Rossi et Jean Rossi</p></section><section class="document-unified-section"><h4>Sources et provenance</h4>${Array.from({ length: 2 }, (_, index) => `<details class="document-unified-source" open><summary>Source liée ${index + 1}</summary><p>Cote archivistique de démonstration</p></details>`).join("")}</section>`;
    const layout = document.getElementById("documentUnifiedLayout");
    const details = document.getElementById("viewerDocumentDetails");
    const collapseButton = document.getElementById("viewerDetailsCollapseBtn");
    const expandButton = document.getElementById("viewerDetailsExpandBtn");
    const detailsToggle = document.getElementById("viewerDetailsBtn");
    const mobile = matchMedia("(max-width: 760px)").matches;
    layout.classList.toggle("is-details-collapsed", detailsCollapsed);
    /* Mobile : la page ouvre toujours l'onglet Original (lecteur prioritaire,
       fidèle à openStoredDocument) ; desktop : repli piloté par la demande. */
    layout.dataset.panel = mobile ? "original" : (detailsCollapsed ? "original" : "info");
    /* Mobile : les onglets pilotent l'affichage ; le hidden ne s'applique
       qu'en desktop comme avant. */
    details.hidden = mobile ? false : detailsCollapsed;
    collapseButton.hidden = true;
    expandButton.hidden = false;
    detailsToggle.setAttribute("aria-expanded", String(!detailsCollapsed));
    collapseButton.setAttribute("aria-expanded", String(!detailsCollapsed));
    expandButton.setAttribute("aria-expanded", String(!detailsCollapsed));
    const detailsLabel = detailsCollapsed ? "Afficher les informations" : "Masquer les informations";
    expandButton.setAttribute("aria-label", detailsLabel);
    expandButton.title = detailsLabel;
    expandButton.querySelector("use")?.setAttribute("href", detailsCollapsed ? "#icon-panel-expand" : "#icon-panel-collapse");
    if (kind === "image") {
      img.src = src;
      img.hidden = false;
    } else {
      const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])], { type: "application/pdf" });
      frame.src = URL.createObjectURL(blob);
      frame.hidden = false;
    }
    if (kind === "image") {
      await img.decode();
      const { createDocumentImageViewer, selectInitialDocumentImageMode } = await import("./js/document-image-viewer.js");
      window.__viewerImageController = createDocumentImageViewer({
        viewport: document.getElementById("viewerImageViewport"),
        image: img,
        controls: document.getElementById("viewerImageControls"),
        zoomIndicator: document.getElementById("viewerZoomIndicator"),
        zoomIndicatorDuration,
        modeButton: document.getElementById("viewerImageModeBtn"),
        fullscreenButton: document.getElementById("viewerFullscreenBtn"),
        fullscreenHost: fullscreenPanel,
        fullscreenRoot: documentPage,
        initialMode: selectInitialDocumentImageMode({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
      });
      document.querySelectorAll("#documentDetailView .viewer-image-only").forEach(control => { control.hidden = false; });
      const controls = document.getElementById("viewerImageControls");
      const viewport = document.getElementById("viewerImageViewport");
      const fullscreen = document.getElementById("viewerFullscreenBtn");
      const external = document.getElementById("viewerExternalBtn");
      const originalHead = fullscreenPanel.querySelector(".document-original-head");
      const toggles = document.getElementById("pdfPanelToggles");
      const thumbnails = document.getElementById("pdfThumbnailsBtn");
      const pdfToolbar = document.getElementById("viewerPdfToolbar");
      const arrangeImageChrome = () => {
        if (matchMedia("(max-width: 760px)").matches) {
          controls.insertBefore(fullscreen, external);
          originalHead.append(expandButton);
          pdfToolbar.append(thumbnails);
          thumbnails.hidden = true;
          toggles.append(detailsToggle);
          toggles.classList.add("viewer-image-panel-toggles");
          toggles.hidden = false;
          viewport.after(toggles);
        } else {
          pdfToolbar.append(thumbnails);
          thumbnails.hidden = false;
          toggles.classList.remove("viewer-image-panel-toggles");
          toggles.hidden = true;
          controls.append(fullscreen, external, expandButton);
        }
      };
      const imageViewerMedia = matchMedia("(max-width: 760px)");
      if (typeof imageViewerMedia.addEventListener === "function") imageViewerMedia.addEventListener("change", arrangeImageChrome);
      else if (typeof imageViewerMedia.addListener === "function") imageViewerMedia.addListener(arrangeImageChrome);
      arrangeImageChrome();
    }
  }, { title, fileName, kind, src, detailsCollapsed, zoomIndicatorDuration, forceFullscreenFallback });
  await page.waitForTimeout(80);
}

async function measureViewer(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById("documentDetailView");
    const head = dialog.querySelector(".document-detail-header");
    const body = dialog.querySelector(".document-detail-shell");
    const layout = dialog.querySelector(".document-unified-layout");
    const originalPanel = dialog.querySelector(".document-original-panel");
    const detailsPanel = dialog.querySelector(".document-unified-details");
    const viewer = dialog.querySelector(".viewer-body");
    const title = document.getElementById("viewerTitle");
    const subtitle = document.getElementById("viewerSubtitle");
    const external = document.getElementById("viewerExternalBtn");
    const modeButton = document.getElementById("viewerImageModeBtn");
    const zoomGroup = document.querySelector(".viewer-image-zoom-group");
    const zoomOut = document.querySelector('[data-viewer-image-zoom="out"]');
    const zoomIn = document.querySelector('[data-viewer-image-zoom="in"]');
    const detailContent = document.getElementById("viewerDocumentDetailsContent");
    const actionsButton = document.getElementById("viewerActionsBtn");
    const externalIcon = external.querySelector("use");
    const closeBtn = document.getElementById("documentPageBackBtn");
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
    const scrolling = document.scrollingElement;
    return {
      open: !dialog.hidden,
      dialog: box(dialog),
      radius: getComputedStyle(dialog).borderTopLeftRadius,
      viewerRadius: getComputedStyle(viewer).borderTopLeftRadius,
      layoutPanel: layout?.dataset.panel || "",
      detailsVisible: getComputedStyle(detailsPanel).display !== "none",
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
      externalIconHref: externalIcon?.getAttribute("href") || null,
      externalText: external.textContent.trim(),
      externalAriaLabel: external.getAttribute("aria-label"),
      externalTitle: external.getAttribute("title"),
      externalBtn: box(external),
      modeButton: box(modeButton),
      modeButtonText: modeButton.textContent.trim(),
      modeButtonAriaLabel: modeButton.getAttribute("aria-label"),
      modeButtonTitle: modeButton.title,
      modeIconHref: modeButton.querySelector("use")?.getAttribute("href") || null,
      zoomGroup: box(zoomGroup),
      zoomOut: box(zoomOut),
      zoomIn: box(zoomIn),
      detailsCardGap: getComputedStyle(detailContent).rowGap,
      detailsCardBoxes: [...detailContent.querySelectorAll(":scope > .document-unified-section")].map(section => {
        const rect = section.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
      fileNameFact: box(detailContent.querySelector(".document-unified-fact--wide span")),
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
      viewerFitMode: viewer.dataset.viewerFitMode || "",
      detailsHidden: detailsPanel.hidden,
      detailsExpandAria: document.getElementById("viewerDetailsExpandBtn").getAttribute("aria-expanded"),
      detailsCollapseAria: document.getElementById("viewerDetailsCollapseBtn").getAttribute("aria-expanded"),
      sourceSections: detailsPanel.querySelectorAll(".document-unified-source").length,
      detailSectionCount: detailsPanel.querySelectorAll(".document-unified-section").length,
      viewer: box(viewer),
       viewerOverflowY: getComputedStyle(viewer).overflowY,
       viewerScroll: { sh: viewer.scrollHeight, ch: viewer.clientHeight, sw: viewer.scrollWidth, cw: viewer.clientWidth },
        bodyScroll: { sh: scrolling.scrollHeight, ch: scrolling.clientHeight, sw: scrolling.scrollWidth, cw: scrolling.clientWidth, overflowY: getComputedStyle(scrolling).overflowY },
      img: box(img),
      imgFit: img.hidden ? null : getComputedStyle(img).objectFit,
      imageCurrentSrc: img.currentSrc,
      imageNaturalSize: [img.naturalWidth, img.naturalHeight],
      imageCssSize: [getComputedStyle(img).width, getComputedStyle(img).height],
      imageRendering: getComputedStyle(img).imageRendering,
      imageTransform: getComputedStyle(img).transform,
      devicePixelRatio,
      externalHref: external.href,
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
                assert.ok(m.open, `${key} : page ouverte`);
                /* Page dédiée : elle couvre l'essentiel de l'écran sous la barre. */
                assert.ok(m.dialog.h >= height * 0.6, `${key} : page occupe l'écran (${m.dialog.h} / ${height})`);
                assert.ok(m.dialog.h < height + 1, `${key} : page ≤ viewport`);
                if (width <= 560) {
                  /* La page dédiée remplace la modale : les surfaces de
                     lecture ne portent pas l'arrondi de sheet (≤ radius-lg). */
                  assert.ok(parseFloat(m.viewerRadius) <= 16, `${key} : rayon du lecteur borné (${m.viewerRadius})`);
                }
                assert.ok(m.titleAccessible, `${key} : titre complet accessible`);
                assert.ok(m.bodyDisplay === "flex", `${key} : shell de page en colonnes`);
                assert.equal(m.bodyMinH, "0px", `${key} : shell sans hauteur forcée`);
                assert.ok(m.layout && m.originalPanel && m.detailsPanel, `${key} : fiche unifiée contient original et informations`);
                assert.equal(m.detailSectionCount, 3, `${key} : informations, personnes et sources rendues`);
                assert.equal(m.sourceSections, 2, `${key} : plusieurs sources restent visibles séparément`);
                assert.equal(m.detailsCardGap, "16px", `${key} : grille des trois cartes utilise un véritable espacement de 16px`);
                if (width <= 760) {
                  /* Mobile : les onglets pilotent les panneaux — les cartes
                     d'informations ne sont mesurables que via l'onglet (couvert
                     par le test « informations se replient sous le lecteur »). */
                  assert.equal(m.layoutPanel, "original", `${width}px : onglet Original actif à l'ouverture`);
                  assert.equal(m.detailsPanel.w, 0, `${width}px : panneau informations masqué derrière l'onglet`);
                  assert.ok(m.originalPanel.y < m.viewer.y || m.originalPanel.y >= 0, `${width}px : original affiché en premier`);
                } else {
                  assert.equal(m.detailsCardBoxes.length, 3, `${key} : trois cartes mesurables dans le volet`);
                  for (let index = 1; index < m.detailsCardBoxes.length; index++) {
                    assert.ok(Math.abs(m.detailsCardBoxes[index].top - m.detailsCardBoxes[index - 1].bottom - 16) < 1, `${key} : espacement réel de 16px entre cartes ${index} et ${index + 1}`);
                  }
                  assert.ok(m.originalPanel.x < m.detailsPanel.x, `${width}px : original à gauche des informations`);
                  assert.ok(m.originalPanel.right <= m.detailsPanel.x + 1, `${width}px : panneaux desktop non chevauchés`);
                  assert.equal(m.detailsOverflowY, "auto", `${width}px : panneau d’informations défilant indépendamment`);
                }
                if (width <= 760) assert.equal(m.detailsCollapseHidden, true, `${width}px : aucun bouton secondaire Masquer n’est affiché`);
                if (width <= 760) assert.equal(m.detailsExpandHidden, false, `${width}px : le bouton unique reste monté lorsque les informations sont visibles`);
                assert.equal(m.viewerOverflowY, width <= 760 ? (m.viewerFitMode === "width" ? "auto" : "hidden") : "auto", `${key} : défilement adapté au mode d’ajustement`);
                assert.equal(m.docOverflowX, 0, `${key} : aucun overflow horizontal`);
                assert.ok(m.closeBtn && m.closeBtn.w >= 43.5 && m.closeBtn.h >= 43.5, `${key} : fermeture ≥44px`);
                assert.equal(m.backButtonCount, 0, `${key} : bouton Retour supprimé`);
                assert.ok(m.closeBtn && m.actionsBtn, `${key} : fermeture X et menu d’actions accessibles`);
                if (width <= 760) assert.ok(m.actionsBtn.h >= 43.5, `${key} : menu tactile`);
                assert.ok(m.externalBtn && await page.locator("#viewerExternalBtn").getAttribute("href") === await page.locator("#viewerImage").getAttribute("src"), `${key} : nouvel onglet pointe sur la source exacte de l’image`);
                assert.equal(m.imageCurrentSrc, m.externalHref, `${key} : source affichée et source du nouvel onglet identiques`);
                assert.ok(m.imageNaturalSize[0] > 0 && m.imageNaturalSize[1] > 0, `${key} : dimensions intrinsèques mesurées`);
                assert.equal(m.imageRendering, "auto", `${key} : aucun filtre de netteté artificiel`);
                assert.doesNotMatch(m.imageTransform, /scale\(/, `${key} : aucune mise à l’échelle par transform`);
                assert.equal(m.modeButtonText, "", `${key} : l’ajustement est une icône seule`);
                assert.equal(m.modeButtonTitle, m.modeButtonAriaLabel, `${key} : action de mode dans l’info-bulle et le nom accessible`);
                assert.equal(m.modeIconHref, "#icon-fit", `${key} : icône fenêtre quand l’action permet l’ajustement fenêtre`);
                assert.ok(m.zoomGroup && Math.abs(m.zoomIn.x - m.zoomOut.right) <= 1, `${key} : zoom − et + côte à côte`);
                assert.equal(await page.locator("#viewerActionsMenu").isVisible(), true, `${key} : menu d’actions ouvrable`);
                assert.equal(await page.locator('#viewerActionsMenu [role="menuitem"]').count(), 1, `${key} : Modifier seule reste dans le menu`);
                assert.equal(m.externalText, "", `${key} : l’action externe est représentée par l’icône seule`);
                assert.equal(m.externalIconHref, "#icon-external-link", `${key} : icône externe dédiée`);
                assert.ok(m.externalBtn && m.externalBtn.w >= 43.5 && m.externalBtn.h >= 43.5, `${key} : cible externe ≥44px`);
                await page.keyboard.press("Escape");
                assert.ok(m.externalAriaLabel === "Ouvrir dans un nouvel onglet", `${key} : aria-label conservé`);
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
                  assert.ok(m.head.h <= 160, `${key} : header long borné sur deux lignes (${m.head.h}px)`);
                }
                if (key === "short") {
                  assert.ok(m.head.h <= 120, `${key} : header court borné (${m.head.h}px)`);
                }
              }
              t.diagnostic(`${engineName} ${width}×${height}: header short=${headers.short.head.h} medium=${headers.medium.head.h} long=${headers.long.head.h} ; doc long=${headers.long.viewer.h} ; dialog=${headers.long.dialog.h}`);
              t.diagnostic(`${engineName} ${width}×${height}: gap cartes=${headers.short.detailsCardGap} ; mode=${headers.short.modeButtonAriaLabel}`);
              t.diagnostic(`${engineName} ${width}×${height}: source identique=${headers.short.imageCurrentSrc === headers.short.externalHref} ; natural=${headers.short.imageNaturalSize.join("×")} ; CSS=${headers.short.imageCssSize.join("×")} ; DPR=${headers.short.devicePixelRatio} ; rendering=${headers.short.imageRendering} ; transform=${headers.short.imageTransform}`);
              /* la zone document reste majoritaire même avec un titre long */
                assert.ok(headers.long.viewer.h >= height * 0.38, `original suffisamment grand avant les informations documentaires (${headers.long.viewer.h} / ${height})`);

              /* --- responsive Nouvel onglet : icône seule à toutes les largeurs --- */
              for (const vw of [320, 390, 480, 481, 560, 760]) {
                await page.setViewportSize({ width: vw, height: 844 });
                await openViewer(page, { title: TITLES.short, fileName: "acte.pdf", src: portraitSvg });
                await page.locator("#viewerActionsBtn").click();
                const m = await measureViewer(page);
                assert.equal(m.externalText, "", `${vw}px : icône seule, sans texte visible`);
                assert.ok(m.externalBtn && m.externalBtn.w >= 43.5 && m.externalBtn.h >= 43.5, `${vw}px : cible ≥44px (${JSON.stringify(m.externalBtn)})`);
                assert.equal(m.externalAriaLabel, "Ouvrir dans un nouvel onglet", `${vw}px : nom accessible explicite`);
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
               /* La page dédiée est le conteneur scrollable : l'original reste
                  contenu dans son cadre, la page entière défile. */
               await openViewer(page, { title: TITLES.short, fileName: "haut.pdf", kind: "image", src: tallSvg });
               const before = await measureViewer(page);
               assert.ok(before.bodyScroll.sh > before.bodyScroll.ch, "informations complètes défilables");
               await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
               await page.waitForTimeout(40);
               const afterScroll = await page.evaluate(() => {
                 const viewer = document.querySelector(".viewer-body");
                 return { viewerTop: viewer.scrollTop, bodyTop: window.scrollY, bodyOverflow: getComputedStyle(document.scrollingElement).overflowY };
               });
               assert.equal(afterScroll.viewerTop, 0, "l’original reste contenu dans son panneau");
               assert.ok(afterScroll.bodyTop > 0, "la page entière défile jusqu’aux informations");
               assert.ok(["auto", "scroll", "visible"].includes(afterScroll.bodyOverflow), "le document est le conteneur de défilement");
              assert.ok(before.head.h === (await measureViewer(page)).head.h, "dimensions du header stables pendant le scroll");
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
      assert.equal(m.externalIconHref, "#icon-external-link");
      assert.ok(m.externalBtn.w >= 43.5 && m.externalBtn.h >= 43.5, "cible externe ≥44px sur desktop");
      assert.equal(m.subtitleDisplay, "block", "sous-titre visible sur desktop");
      assert.equal(m.titleClamp, "none", "pas de clamp 2 lignes sur desktop");
      /* Page dédiée : pleine largeur de contenu, deux panneaux, sans modal. */
      assert.ok(m.dialog.w >= 1024 - 60, `page pleine largeur de contenu (${m.dialog.w})`);
      assert.equal(m.radius, "0px", "page sans arrondi de modal");
      assert.ok(m.originalPanel.x < m.detailsPanel.x, "original à gauche des informations");
      assert.ok(m.imgFit === "contain", "ratio conservé desktop");
      assert.equal(m.docOverflowX, 0);
      t.diagnostic(`desktop 1024×768: page=${m.dialog.w}×${m.dialog.h} y=${m.dialog.y} head=${m.head.h} ; action externe icône seule ${m.externalBtn.w}×${m.externalBtn.h}`);
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
        document.body.insertAdjacentHTML("beforeend", `<div id="gestureViewport" style="position:fixed;left:10px;top:10px;width:360px;height:280px;overflow:auto;touch-action:pan-y"><img id="gestureImage" alt="Photographie de registre"><span id="gestureIndicator" class="viewer-zoom-indicator" aria-hidden="true"></span></div><div id="gestureControls"><button type="button" data-viewer-image-zoom="out">−</button><button type="button" data-viewer-image-mode-toggle aria-label="Ajuster à la largeur" title="Ajuster à la largeur"><svg><use href="#icon-fit-width"></use></svg></button><button type="button" data-viewer-image-zoom="reset">Réinitialiser le zoom</button><button type="button" data-viewer-image-zoom="in">+</button></div>`);
        const { createDocumentImageViewer, selectInitialDocumentImageMode } = await import("./js/document-image-viewer.js");
        const image = document.getElementById("gestureImage");
        image.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="800"><rect width="200" height="800" fill="#b8c9be"/></svg>');
        await image.decode();
        const viewport = document.getElementById("gestureViewport");
        const modeButton = document.querySelector("#gestureControls [data-viewer-image-mode-toggle]");
        const initialMode = selectInitialDocumentImageMode({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
        const indicator = document.getElementById("gestureIndicator");
        const controller = createDocumentImageViewer({ viewport, image, controls: document.getElementById("gestureControls"), zoomIndicator: indicator, modeButton, initialMode });
        const initial = controller.getState();
        modeButton.click();
        const windowFit = controller.getState();
        modeButton.click();
        const widthMode = controller.getState();
        const widthModeActionLabel = modeButton.getAttribute("aria-label");
        const widthModeIcon = modeButton.querySelector("use").getAttribute("href");
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
        const pinchIndicator = indicator.textContent;
        const zoomRender = { layoutWidth: Number.parseFloat(image.style.width), layoutHeight: Number.parseFloat(image.style.height), cssWidth: image.style.width, cssHeight: image.style.height, cssTransform: image.style.transform };
        viewport.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [] }));
        viewport.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(3, 150, 120)] }));
        viewport.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [touch(3, 185, 140)] }));
        const panned = controller.getState();
        viewport.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [] }));
        controller.reset();
        const reset = controller.getState();
        const resetIndicator = indicator.textContent;
        viewport.style.width = "280px";
        await new Promise(resolve => setTimeout(resolve, 100));
        const resized = controller.getState();
        modeButton.click();
        const windowMode = controller.getState();
        const modeIndicator = indicator.textContent;
        const windowModeActionLabel = modeButton.getAttribute("aria-label");
        const windowModeIcon = modeButton.querySelector("use").getAttribute("href");
        controller.destroy();
        return { natural: [image.naturalWidth, image.naturalHeight], initial, initialMode, windowFit, widthMode, widthModeActionLabel, widthModeIcon, widthScrollRange, widthScrollPosition, zoomed, zoomRender, pinchIndicator, panned, reset, resetIndicator, resized, windowMode, modeIndicator, windowModeActionLabel, windowModeIcon, indicatorHiddenAfterDestroy: !indicator.classList.contains("is-visible"), pinchPrevented: pinchMove.defaultPrevented };
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
      assert.equal(states.widthMode.mode, "width", `mode actif après toggle (${states.widthMode.mode}; action=${states.widthModeActionLabel})`);
      assert.equal(states.widthModeIcon, "#icon-fit", "le mode largeur propose l’icône fenêtre pour revenir au mode entier");
      assert.equal(states.widthMode.fitWidth, 360, "mode largeur utilise toute la largeur disponible");
      assert.ok(states.widthMode.fitHeight > 280, "document vertical défile sans recadrage en mode largeur");
      assert.ok(states.widthScrollRange > 0 && states.widthScrollPosition > 0, "le mode largeur permet le défilement vertical natif du document long");
      assert.ok(states.zoomed.zoom >= 1.9 && states.pinchPrevented, "pincement à deux doigts intercepté et zoom appliqué");
      assert.equal(states.pinchIndicator, "200 %", "l’indicateur suit le pincement à l’échelle courante");
      assert.ok(states.zoomRender.layoutWidth >= states.widthMode.fitWidth * states.zoomed.zoom - 1, `la boîte de layout est rasterisée à sa dimension zoomée à partir de l’image source (${JSON.stringify(states.zoomRender)}; zoom=${states.zoomed.zoom}; fit=${states.widthMode.fitWidth})`);
      assert.ok(states.zoomRender.layoutHeight >= states.widthMode.fitHeight * states.zoomed.zoom - 1, "la hauteur de layout suit aussi la résolution d’affichage zoomée");
      assert.doesNotMatch(states.zoomRender.cssTransform, /scale\(/, "aucun agrandissement de texture CSS par scale() au zoom");
      assert.ok(Math.abs(states.panned.offsetX) > 0, "panoramique actif après agrandissement");
      assert.equal(states.reset.zoom, 1);
      assert.equal(states.resetIndicator, "100 %", "la réinitialisation affiche l’échelle de base relative");
      assert.equal(states.reset.offsetX, 0);
      assert.equal(states.reset.offsetY, 0);
      assert.equal(states.resized.fitWidth, 280, "ResizeObserver recalcule l’échelle du mode largeur");
      assert.equal(states.windowMode.mode, "fit");
      assert.equal(states.windowModeActionLabel, "Ajuster à la largeur");
      assert.equal(states.windowModeIcon, "#icon-fit-width");
      assert.equal(states.modeIndicator, "100 %", "le changement d’ajustement remet l’indicateur au niveau de base");
      assert.equal(states.indicatorHiddenAfterDestroy, true, "la destruction retire l’indicateur et sa temporisation");
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
      const imageToolbar = await page.evaluate(() => {
        const rect = selector => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return { x: box.x, right: box.right, y: box.y, bottom: box.bottom, width: box.width, height: box.height };
        };
        return {
          controls: rect("#viewerImageControls"), reader: rect("#viewerImageViewport"),
          zoom: rect(".viewer-image-zoom-group"), zoomOut: rect('[data-viewer-image-zoom="out"]'), zoomIn: rect('[data-viewer-image-zoom="in"]'), fit: rect("#viewerImageModeBtn"),
          fullscreen: rect("#viewerFullscreenBtn"), external: rect("#viewerExternalBtn"),
          info: rect("#viewerDetailsExpandBtn"), originalHeadDisplay: getComputedStyle(document.querySelector(".document-original-head")).display,
          documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth
        };
      });
      assert.equal(imageToolbar.originalHeadDisplay, "none", "l’en-tête Original ne crée pas une seconde ligne de commandes sur desktop");
      assert.ok(Math.abs(imageToolbar.zoomIn.x - imageToolbar.zoomOut.right + 1) <= 1, "le groupe Zoom JPEG/PNG reste accolé sur desktop");
      assert.ok(imageToolbar.zoom.x < imageToolbar.fit.x && imageToolbar.fit.right < imageToolbar.fullscreen.x && imageToolbar.fullscreen.right < imageToolbar.external.x, "zoom, ajustement, plein écran et nouvel onglet sont groupés à gauche");
      assert.ok(imageToolbar.external.right < imageToolbar.info.x, "Informations est séparé des commandes de lecture");
      assert.ok(imageToolbar.info.right >= imageToolbar.controls.right - 2, "Informations est aligné tout à droite de la barre");
      assert.ok(Math.abs(imageToolbar.reader.y - imageToolbar.controls.bottom - 12) <= 1, "l’image est séparée de la barre par l’espacement desktop standard de 12px");
      assert.equal(imageToolbar.documentWidth, imageToolbar.viewportWidth, "aucun débordement horizontal desktop");
      const initial = await page.locator(".document-original-panel").boundingBox();
      const src = await page.locator("#viewerImage").getAttribute("src");
      const infoButton = page.locator("#viewerDetailsExpandBtn");
      assert.equal(await infoButton.isVisible(), true, "le bouton unique reste visible lorsque Informations est ouvert");
      assert.equal(await infoButton.getAttribute("aria-expanded"), "true");
      assert.equal(await infoButton.getAttribute("aria-label"), "Masquer les informations");
      const openInfoBox = await infoButton.boundingBox();
      const openControlsBox = await page.locator("#viewerImageControls").boundingBox();
      assert.ok(openInfoBox.x + openInfoBox.width >= openControlsBox.x + openControlsBox.width - 2, `le bouton Informations reste à droite panneau ouvert (${JSON.stringify({ openInfoBox, openControlsBox })})`);
      await infoButton.click();
      await page.waitForFunction(() => document.getElementById("documentUnifiedLayout").classList.contains("is-details-collapsed"));
      const collapsed = await page.locator(".document-original-panel").boundingBox();
      assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), true);
      assert.equal(await infoButton.isVisible(), true, "le bouton unique reste visible panneau fermé");
      assert.equal(await infoButton.getAttribute("aria-expanded"), "false");
      const closedInfoBox = await infoButton.boundingBox();
      const closedControlsBox = await page.locator("#viewerImageControls").boundingBox();
      assert.ok(closedInfoBox.x + closedInfoBox.width >= closedControlsBox.x + closedControlsBox.width - 2, "le bouton Informations reste à droite panneau fermé");
      assert.ok(collapsed.width > initial.width + 100, "le panneau original gagne la largeur du panneau droit");
      assert.equal(await page.locator("#viewerImage").getAttribute("src"), src, "le fichier n’est pas rechargé pendant le repli");
      await infoButton.click();
      await page.waitForFunction(() => !document.getElementById("documentUnifiedLayout").classList.contains("is-details-collapsed"));
      const restored = await page.locator(".document-original-panel").boundingBox();
      assert.equal(await infoButton.isVisible(), true, "le même bouton est cliquable à la réouverture");
      assert.equal(await infoButton.getAttribute("aria-expanded"), "true");
      const reopenedInfoBox = await infoButton.boundingBox();
      const reopenedControlsBox = await page.locator("#viewerImageControls").boundingBox();
      assert.ok(reopenedInfoBox.x + reopenedInfoBox.width >= reopenedControlsBox.x + reopenedControlsBox.width - 2, "le bouton Informations reste à droite après réouverture");
      assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true);
      assert.ok(Math.abs(restored.width - initial.width) < 2, "la disposition initiale à deux panneaux est restaurée");
      assert.equal(await page.locator("#viewerImage").getAttribute("src"), src, "le document reste chargé après réouverture");
      t.diagnostic(`Desktop 1280×900 : panneau original initial=${initial.width.toFixed(0)}px ; replié=${collapsed.width.toFixed(0)}px ; restauré=${restored.width.toFixed(0)}px; URL d’image inchangée`);
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});

test("Informations repliées par défaut sur desktop, tablette et mobile; disposition réversible", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const [width, height] of [[1280, 900], [760, 900], [390, 844]]) {
      const { context, page } = await createViewerPage(browser, server, width, height);
      try {
        const longName = "registre-immobilier-acte-notarial-annotations-marginales-1891-original.jpg";
        await openViewer(page, { title: "Registre immobilier", fileName: longName, src: portraitSvg, detailsCollapsed: true });
        const source = await page.locator("#viewerImage").evaluate(image => image.currentSrc);
        const collapsed = await measureViewer(page);
        assert.equal(collapsed.detailsVisible, false, `${width}px : informations repliées à l’ouverture`);
        const expandControl = page.locator(width <= 760 ? "#documentPageInfoTab" : "#viewerDetailsExpandBtn");
        assert.equal(await expandControl.isVisible(), true, `${width}px : commande d’ouverture visible`);
        if (width <= 760) assert.equal(await page.locator("#viewerDetailsBtn").isVisible(), false, `${width}px : ancien bouton sous le lecteur masqué`);
        assert.equal(collapsed.detailsExpandAria, "false", `${width}px : aria-expanded reflète le repli`);
        assert.equal(collapsed.layoutColumns.split(" ").length, 1, `${width}px : aucune colonne vide quand le panneau est replié`);
        assert.ok(Math.abs(collapsed.originalPanel.w - collapsed.layout.w) < 2, `${width}px : le lecteur occupe toute la grille repliée`);

        for (let iteration = 0; iteration < 2; iteration++) {
          await expandControl.click();
          await page.waitForTimeout(40);
          const expanded = await measureViewer(page);
          assert.equal(expanded.detailsVisible, true, `${width}px : volet déployé (${iteration + 1})`);
          if (width <= 760) assert.equal(expanded.layoutPanel, "info", `${width}px : onglet Informations actif (${iteration + 1})`);
          assert.equal(expanded.detailsCollapseAria, "true", `${width}px : état accessible déployé`);
          assert.equal(expanded.detailSectionCount, 3, `${width}px : les trois cartes restent présentes`);
          assert.equal(expanded.detailsCardGap, "16px", `${width}px : espacement de grille entre cartes`);
          if (width > 760) {
            for (let index = 1; index < expanded.detailsCardBoxes.length; index++) {
              assert.ok(Math.abs(expanded.detailsCardBoxes[index].top - expanded.detailsCardBoxes[index - 1].bottom - 16) < 1, `${width}px : cartes ${index} et ${index + 1} séparées de 16px`);
            }
          }
          assert.ok(expanded.fileNameFact && expanded.fileNameFact.w > 0, `${width}px : le nom long occupe la carte documentaire`);
          assert.equal(expanded.docOverflowX, 0, `${width}px : le nom long ne déborde pas horizontalement`);
          if (width > 760) assert.ok(expanded.originalPanel.x < expanded.detailsPanel.x, `${width}px : Original à gauche et Informations à droite`);
          /* Mobile : le repli revient à l'onglet Original (le dépliant de la
             barre est alors à nouveau accessible sous le lecteur). */
          await page.locator(width <= 760 ? "#documentPageOriginalTab" : "#viewerDetailsExpandBtn").click();
          await page.waitForTimeout(40);
          assert.equal((await measureViewer(page)).detailsVisible, false, `${width}px : volet replié à nouveau (${iteration + 1})`);
          if (width <= 760) assert.equal((await measureViewer(page)).layoutPanel, "original", `${width}px : retour à l'onglet Original (${iteration + 1})`);
          assert.equal(await page.locator("#viewerImage").evaluate(image => image.currentSrc), source, `${width}px : la source est conservée après le repli`);
        }

        await page.locator("#viewerImageModeBtn").click();
        assert.equal((await measureViewer(page)).detailsVisible, false, `${width}px : le changement de mode ne déploie pas Informations`);
        const modeButton = await measureViewer(page);
        assert.equal(modeButton.modeButtonText, "", `${width}px : Ajustement reste une icône seule`);
        assert.equal(modeButton.modeButtonAriaLabel, "Ajuster à la largeur", `${width}px : le libellé accessible décrit l’action disponible`);
        assert.equal(modeButton.modeIconHref, "#icon-fit-width", `${width}px : icône dynamique du mode disponible`);
        t.diagnostic(`${width}×${height} : lecteur replié=${collapsed.originalPanel.w}px ; espacement cartes=${collapsed.detailsCardGap}`);
      } finally { await context.close(); }
    }
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
      await page.locator("#documentPageBackBtn").click();
      assert.equal(await page.locator("#documentDetailView").evaluate(view => view.hidden), true, "la page Document est refermée");
      assert.equal(await page.locator("#documentsView").evaluate(view => view.hidden), false, "la bibliothèque reste la vue sous-jacente");
      assert.equal(await page.locator("#genealogyView").evaluate(view => view.hidden), true, "la fermeture ne redirige pas vers Archives");
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});

test("Mobile : les informations se replient sous le lecteur sans recharger l’image", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page } = await createViewerPage(browser, server, 390, 844);
    try {
      await openViewer(page, { title: "Registre consulté", fileName: "registre-long-nom-1891.jpg", src: portraitSvg, detailsCollapsed: true });
      const img = page.locator("#viewerImage");
      const originalSrc = await img.evaluate(image => image.currentSrc);
      const initial = await page.evaluate(() => ({
        detailsVisible: getComputedStyle(document.getElementById("viewerDocumentDetails")).display !== "none",
        panel: document.getElementById("documentUnifiedLayout").dataset.panel,
        expandVisible: getComputedStyle(document.querySelector(".document-detail-tabs")).display !== "none" && getComputedStyle(document.getElementById("viewerDetailsBtn")).display === "none",
        expanded: document.getElementById("documentPageInfoTab").getAttribute("aria-selected") === "true" ? "true" : "false",
        controlsVisible: !document.getElementById("viewerImageControls").hidden,
        mode: document.getElementById("viewerImageViewport").dataset.viewerFitMode,
        readerHeight: document.getElementById("viewerImageViewport").getBoundingClientRect().height,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      assert.equal(initial.detailsVisible, false, "les informations sont repliées à l’ouverture mobile");
      assert.equal(initial.panel, "original", "l’onglet Original est actif à l’ouverture");
      assert.equal(initial.expandVisible, true, "l’onglet supérieur Informations est visible et l’ancien bouton masqué");
      assert.equal(initial.expanded, "false", "aria-expanded reflète le repli");
      assert.equal(initial.controlsVisible, true, "la barre d’outils du lecteur est présente");
      assert.equal(initial.mode, "width", "un document portrait très vertical démarre en lecture à la largeur");
      assert.ok(initial.readerHeight > 42 * 844 / 100, "le lecteur replié utilise davantage de hauteur mobile");
      assert.equal(initial.scrollWidth, initial.clientWidth, "aucun débordement horizontal");
      const reader = page.locator("#viewerImageViewport");
      await reader.evaluate(viewport => { viewport.scrollTop = 80; });
      const scrollBefore = await reader.evaluate(viewport => viewport.scrollTop);

      await page.locator("#documentPageInfoTab").click();
      await page.waitForTimeout(40);
      assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true);
      assert.equal(await page.locator("#documentUnifiedLayout").getAttribute("data-panel"), "info", "le bouton pilote l’onglet Informations");
      assert.equal(await page.locator("#documentPageInfoTab").getAttribute("aria-selected"), "true");
      assert.equal(await page.locator("#viewerDocumentDetailsContent .document-unified-section").count(), 3);
      /* Mobile : le retour Original passe par l'onglet en-tête, la barre
         dépliante se retrouve ensuite sous le lecteur. */
      await page.locator("#documentPageOriginalTab").click();
      await page.waitForTimeout(40);
      assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), true);
      assert.equal(await page.locator("#documentUnifiedLayout").getAttribute("data-panel"), "original", "le repli revient à l’onglet Original");
      assert.equal(await page.locator("#documentPageInfoTab").getAttribute("aria-selected"), "false");
      assert.equal(await reader.evaluate(viewport => viewport.scrollTop), scrollBefore, "la position de lecture reste conservée");
      await page.locator('#viewerImageControls [data-viewer-image-zoom="in"]').click();
      const zoomBefore = await page.evaluate(() => window.__viewerImageController.getState().zoom);
      await page.locator("#documentPageInfoTab").click();
      await page.waitForTimeout(40);
      await page.locator("#documentPageOriginalTab").click();
      await page.waitForTimeout(40);
      assert.equal(await img.evaluate(image => image.currentSrc), originalSrc, "la source ne change pas pendant le repli/déploiement");
      assert.deepEqual(await img.evaluate(image => [image.naturalWidth, image.naturalHeight]), [200, 800], "l’image originale reste chargée");
      assert.equal(await page.evaluate(() => window.__viewerImageController.getState().zoom), zoomBefore, "le zoom est conservé");
      assert.equal(await page.locator("#viewerFrame").isHidden(), true, "le comportement image ne bascule pas vers le panneau PDF");

      await openViewer(page, { title: "Registre PDF", fileName: "registre-1891.pdf", kind: "pdf", detailsCollapsed: true });
      assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), true, "le PDF bénéficie aussi du repli initial mobile");
      assert.equal(await page.locator("#viewerImage").isHidden(), true, "un PDF ne passe pas par le rendu image");
      const pdfFrame = await page.locator("#viewerFrame").boundingBox();
      assert.ok(pdfFrame && pdfFrame.width > 100 && pdfFrame.height > 100, "le lecteur PDF reste visible dans la zone prioritaire");
      assert.ok(await page.locator("#viewerExternalBtn").evaluate(anchor => !anchor.hidden && getComputedStyle(anchor).display !== "none"), "le lien PDF reste présent dans le DOM et affiché");
      assert.equal(await page.locator("#viewerExternalBtn").isVisible(), true, "l’ouverture externe du PDF reste disponible");
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});

test("Le pourcentage de zoom réagit aux actions, se prolonge et ne capte pas les gestes", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    const { context, page } = await createViewerPage(browser, server, 390, 844);
    try {
      await openViewer(page, { title: "Image de test", fileName: "registre.svg", src: landscapeSvg, zoomIndicatorDuration: 180 });
      const indicator = page.locator("#viewerZoomIndicator");
      assert.equal(await indicator.evaluate(el => getComputedStyle(el).pointerEvents), "none");

      await page.locator('#viewerImageControls [data-viewer-image-zoom="in"]').click();
      assert.equal(await indicator.textContent(), "125 %");
      assert.equal(await indicator.evaluate(el => el.classList.contains("is-visible")), true);
      await page.waitForTimeout(100);
      await page.locator('#viewerImageControls [data-viewer-image-zoom="in"]').click();
      assert.equal(await indicator.textContent(), "156 %", "le pourcentage est recalculé après une nouvelle action");
      await page.waitForTimeout(100);
      assert.equal(await indicator.evaluate(el => el.classList.contains("is-visible")), true, "une action successive prolonge l’affichage");
      await page.waitForTimeout(120);
      assert.equal(await indicator.evaluate(el => el.classList.contains("is-visible")), false, "l’indicateur disparaît après la dernière interaction");

      await page.locator("#viewerImageModeBtn").click();
      assert.equal(await indicator.textContent(), "100 %", "le changement de mode affiche le niveau de base relatif");
      await page.evaluate(() => window.__viewerImageController.reset());
      assert.equal(await indicator.textContent(), "100 %", "la réinitialisation affiche 100 %");
      await page.locator("#viewerImageModeBtn").focus();
      await page.keyboard.press("+");
      assert.equal(await indicator.textContent(), "125 %", "la commande clavier met aussi l’indicateur à jour");
      await page.evaluate(() => window.__viewerImageController.destroy());
      assert.equal(await indicator.evaluate(el => el.classList.contains("is-visible")), false, "destroy nettoie l’affichage temporaire");
    } finally { await context.close(); }
  } finally { await browser.close(); await server.close(); }
});

test("Plein écran image : API native ou repli viewport, sortie Échap sans rechargement", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const forceFullscreenFallback of [false, true]) {
      const { context, page } = await createViewerPage(browser, server, 390, 844);
      try {
        await openViewer(page, { title: "Registre plein écran", fileName: "registre.svg", src: landscapeSvg, detailsCollapsed: true, forceFullscreenFallback });
        const source = await page.locator("#viewerImage").evaluate(image => image.currentSrc);
        /* En mobile le lecteur vit dans l'onglet Original : le zoom part de
           celui-ci, l'onglet Infos est validé puis on repasse Original pour
           garder la barre (plein écran) accessible. */
        const detailsExpandedBefore = false;
        await page.locator('#viewerImageControls [data-viewer-image-zoom="in"]').click();
        const zoom = await page.evaluate(() => window.__viewerImageController.getState().zoom);
        if (forceFullscreenFallback) {
          await page.locator("#documentPageInfoTab").click();
          await page.waitForTimeout(40);
          assert.equal(await page.locator("#viewerDocumentDetails").isVisible(), true, "onglet Infos ouvre le panneau avant le plein écran");
          await page.locator("#documentPageOriginalTab").click();
          await page.waitForTimeout(40);
        }
        await page.locator("#viewerFullscreenBtn").click();
        await page.waitForFunction(() => document.getElementById("documentDetailView").classList.contains("is-viewer-fullscreen"));
        await page.waitForTimeout(80);
        const state = await page.evaluate(() => {
          const documentPage = document.getElementById("documentDetailView");
          const imagePanel = document.querySelector(".document-original-panel");
          const reader = document.getElementById("viewerImageViewport");
          return {
            fallback: documentPage.classList.contains("is-viewer-fullscreen-fallback"),
            nativeFullscreen: document.fullscreenElement === imagePanel,
            headerHidden: getComputedStyle(documentPage.querySelector(".document-detail-header")).display === "none",
            detailsHidden: getComputedStyle(document.getElementById("viewerDocumentDetails")).display === "none",
            viewport: [innerWidth, innerHeight],
            panel: [imagePanel.getBoundingClientRect().width, imagePanel.getBoundingClientRect().height],
            reader: [reader.getBoundingClientRect().width, reader.getBoundingClientRect().height],
            exitLabel: document.getElementById("viewerFullscreenBtn").getAttribute("aria-label"),
            zoom: window.__viewerImageController.getState().zoom
          };
        });
        t.diagnostic(`plein écran fallback forcé=${forceFullscreenFallback} ; état=${JSON.stringify(state)}`);
        if (forceFullscreenFallback) assert.equal(state.fallback, true, "le repli viewport est utilisé sans API native");
        else assert.ok(state.nativeFullscreen || state.fallback, "la Fullscreen API native ou son repli est utilisé");
        assert.equal(state.headerHidden, true, "l’en-tête non essentiel est masqué en plein écran");
        assert.equal(state.detailsHidden, true, "le panneau d’informations ne réduit pas la surface de lecture");
        assert.ok(state.panel[0] >= state.viewport[0] - 1 && state.panel[1] >= state.viewport[1] - 1, "le panneau lecteur occupe le viewport");
        assert.equal(state.exitLabel, "Quitter le plein écran", "la commande de sortie est annoncée");
        assert.equal(state.zoom, zoom, "le niveau de zoom est conservé à l’entrée");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.getElementById("documentDetailView").classList.contains("is-viewer-fullscreen"));
        assert.equal(await page.locator("#documentDetailView").evaluate(view => !view.hidden), true, "Échap quitte seulement le plein écran");
        assert.equal(await page.locator("#viewerImage").evaluate(image => image.currentSrc), source, "la sortie ne recharge pas l’image");
        assert.equal(await page.evaluate(() => window.__viewerImageController.getState().zoom), zoom, "le niveau de zoom reste identique après la sortie");
        assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), !detailsExpandedBefore, "l’état choisi pour Informations est restauré après le plein écran");
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await server.close(); }
});

test("Visionneuse d’images : barre desktop et bouton Informations harmonisés sur mobile", async t => {
  assert.match(app, /function arrangeViewerImageChrome\(\)/, "positionnement dédié de la visionneuse image présent");
  assert.match(app, /controls\.insertBefore\(fullscreenButton, externalButton\)/, "Plein écran est déplacé dans la barre d’outils image");
  assert.match(app, /viewport\.after\(panelToggles\)/, "le bouton dépliant Informations apparaît sous le document image");
  assert.match(app, /imageViewerMedia\.addEventListener\("change", onImageViewerMediaChange\)/, "le repositionnement suit l’orientation responsive");
  const browser = await chromium.launch({ headless: true });
  const server = await startStaticServer(ROOT);
  try {
    for (const width of [320, 375, 390]) {
      const { context, page } = await createViewerPage(browser, server, width, 844);
      try {
        const title = width === 320
          ? "Dossier Militaire Giovannoni — Archive historique complète"
          : "Dossier Militaire";
        await openViewer(page, { title, fileName: "dossier-militaire.svg", src: portraitSvg, detailsCollapsed: true });

        const state = await page.evaluate(() => {
          const rect = element => {
            const box = element.getBoundingClientRect();
            return { x: box.x, right: box.right, y: box.y, bottom: box.bottom, width: box.width, height: box.height };
          };
          const documentPage = document.getElementById("documentDetailView");
          const title = document.getElementById("viewerTitle");
          const controls = document.getElementById("viewerImageControls");
          const reader = document.getElementById("viewerImageViewport");
          const detailsToggle = document.getElementById("documentPageInfoTab");
          const details = document.getElementById("viewerDocumentDetails");
          return {
            header: rect(documentPage.querySelector(".document-detail-header")),
            title: rect(title), titleStyle: { whiteSpace: getComputedStyle(title).whiteSpace, textOverflow: getComputedStyle(title).textOverflow, webkitLineClamp: getComputedStyle(title).webkitLineClamp },
            actions: rect(documentPage.querySelector(".document-detail-actions")),
            menu: rect(document.getElementById("viewerActionsBtn")),
            close: rect(document.getElementById("documentPageBackBtn")),
            controls: rect(controls), reader: rect(reader), image: rect(document.getElementById("viewerImage")),
            fullscreen: rect(document.getElementById("viewerFullscreenBtn")), infoToggle: rect(detailsToggle), details: rect(details),
            zoomOut: rect(document.querySelector('[data-viewer-image-zoom="out"]')), zoomIn: rect(document.querySelector('[data-viewer-image-zoom="in"]')),
            toggleText: detailsToggle.textContent.trim(), toggleExpanded: detailsToggle.getAttribute("aria-selected") === "true" ? "true" : "false",
            oldToggleDisplay: getComputedStyle(document.getElementById("viewerDetailsBtn")).display,
            smallTogglesVisible: ["viewerDetailsExpandBtn", "viewerDetailsCollapseBtn"].filter(id => getComputedStyle(document.getElementById(id)).display !== "none").length,
            controlOrder: [...controls.children].filter(element => !element.hidden).map(element => element.id || element.className),
            visibleFullscreenCount: [...documentPage.querySelectorAll("#viewerFullscreenBtn")].filter(element => !element.hidden).length,
            documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth
          };
        });
        assert.ok(state.header.height <= 110, `${width}px : en-tête limité à deux lignes (${state.header.height}px)`);
        assert.equal(state.titleStyle.webkitLineClamp, "2");
        assert.equal(await page.locator("#viewerTitle").getAttribute("aria-label"), title, "titre complet accessible malgré le clamp visuel");
        assert.ok(state.title.right <= state.actions.x + 1, "le titre ne chevauche pas les actions");
        assert.ok(Math.abs(state.menu.y - state.close.y) <= 1, "menu et fermeture alignés");
        for (const action of [state.menu, state.close]) assert.ok(action.width >= 43.5 && action.height >= 43.5, "actions d’en-tête de 44 × 44 px");
        if (width === 320) {
          const titleClamp = await page.locator("#viewerTitle").evaluate(element => getComputedStyle(element).webkitLineClamp);
          assert.equal(titleClamp, "2", "le titre long est tronqué après deux lignes sans déplacer les actions");
        }
        const visibleToolbarButtons = await page.locator("#viewerImageControls .btn:visible").all();
        assert.equal(visibleToolbarButtons.length, 5, "deux commandes zoom, ajustement, plein écran et nouvel onglet, sans doublon");
        assert.deepEqual(state.controlOrder, ["viewer-image-zoom-group viewer-image-only", "viewerImageModeBtn", "viewerFullscreenBtn", "viewerExternalBtn"]);
        assert.equal(state.visibleFullscreenCount, 1);
        for (const button of visibleToolbarButtons) {
          const box = await button.boundingBox();
          assert.ok(box.width >= 43.5 && box.height >= 43.5, "commande d’image avec une cible de 44 × 44 px");
        }
        assert.ok(state.controls.height <= 48, `${width}px : barre d’outils d’une ligne (${state.controls.height}px)`);
        assert.ok(Math.abs(state.zoomIn.x - state.zoomOut.right + 1) <= 1, `${width}px : le groupe Zoom JPEG/PNG reste accolé`);
        assert.ok(state.fullscreen.y >= state.controls.y - 1 && state.fullscreen.bottom <= state.controls.bottom + 1, "Plein écran est dans la barre, non superposé à l’image");
        assert.ok(state.infoToggle.height >= 44, "l’onglet Informations conserve une cible tactile suffisante");
        assert.match(state.toggleText, /Informations/);
        assert.equal(state.toggleExpanded, "false", "le bouton unique reflète l’état replié");
        assert.equal(state.oldToggleDisplay, "none", "l’ancien bouton sous le lecteur est masqué");
        assert.equal(state.smallTogglesVisible, 0, "aucun second bouton Informations isolé n’est affiché");
        assert.ok(state.infoToggle.y < state.reader.y, "Informations est accessible depuis l’onglet supérieur");
        assert.ok(state.image.x >= state.reader.x - 1 && state.image.right <= state.reader.right + 1, "l’image conserve son cadrage dans son viewport");
        assert.equal(state.documentWidth, width, "aucun débordement horizontal global");

        const originalSource = await page.locator("#viewerImage").evaluate(image => image.currentSrc);
        await page.locator('#viewerImageControls [data-viewer-image-zoom="in"]').click();
        assert.equal(await page.evaluate(() => window.__viewerImageController.getState().zoom), 1.25, "zoom avant conservé");
        assert.equal(await page.locator("#viewerImage").evaluate(image => image.currentSrc), originalSource, "le zoom ne recharge pas l’image");
        await page.locator("#viewerImageModeBtn").click();
        assert.equal(await page.evaluate(() => window.__viewerImageController.getState().mode), "fit", "mode d’ajustement conservé");
        await page.locator("#documentPageInfoTab").click();
        await page.waitForTimeout(40);
        assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), false, "Informations s’ouvre sous l’image");
        assert.equal(await page.locator("#documentUnifiedLayout").getAttribute("data-panel"), "info", "le bouton pilote l’onglet Informations");
        assert.equal(await page.locator("#documentPageInfoTab").getAttribute("aria-selected"), "true");
        /* En mobile la bascule d'onglet emporte le lecteur : la barre (chevron
           compris) n'est plus rendue dans l'état ouvert ; la règle de pivot
           reste couverte par l'assertion statique. */
        assert.match(css, /\.pdf-panel-toggle\[aria-expanded="true"\]\s*\.pdf-panels-chevron\s*\{\s*transform: rotate\(180deg\); \}/, "règle de pivot du chevron conservée");
        await page.locator("#documentPageOriginalTab").click();
        await page.waitForTimeout(40);
        assert.equal(await page.locator("#viewerDocumentDetails").isHidden(), true, "Informations se referme normalement");
        assert.equal(await page.locator("#documentPageInfoTab").getAttribute("aria-selected"), "false");

        if (width === 390) {
          await page.setViewportSize({ width: 844, height: 390 });
          await page.waitForTimeout(80);
          assert.equal(await page.locator("#pdfPanelToggles").isHidden(), true, "après rotation paysage, le dépliant mobile disparaît de la barre desktop");
          assert.equal(await page.locator("#viewerDetailsExpandBtn").isVisible(), true, "après rotation paysage, Informations revient dans la barre desktop");
          assert.equal(await page.locator("#viewerDetailsExpandBtn").evaluate(button => Math.abs(button.getBoundingClientRect().right - document.getElementById("viewerImageControls").getBoundingClientRect().right) <= 2), true, "Informations reste à droite après rotation");
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(80);
          assert.equal(await page.locator("#documentPageInfoTab").isVisible(), true, "après rotation portrait, l’onglet Informations reste accessible");
          assert.equal(await page.locator("#viewerDetailsBtn").isVisible(), false, "après rotation portrait, l’ancien bouton reste masqué");
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await server.close(); }
});
