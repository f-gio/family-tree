import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

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
  assert.match(html, /id="viewerExternalBtn"[^>]*aria-label="Ouvrir dans un nouvel onglet"[^>]*title="Ouvrir dans un nouvel onglet"/);
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
    document.getElementById("viewerExternalBtn").hidden = false;
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
    const viewer = dialog.querySelector(".viewer-body");
    const title = document.getElementById("viewerTitle");
    const subtitle = document.getElementById("viewerSubtitle");
    const external = document.getElementById("viewerExternalBtn");
    const label = external.querySelector(".viewer-external-label");
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
      externalLabelDisplay: label ? getComputedStyle(label).display : null,
      externalLabelText: label ? label.textContent : null,
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

              /* --- responsive Nouvel onglet --- */
              for (const [vw, expectIcon] of [[320, true], [390, true], [480, true], [481, false], [560, false], [760, false]]) {
                await page.setViewportSize({ width: vw, height: 844 });
                await openViewer(page, { title: TITLES.short, fileName: "acte.pdf", src: portraitSvg });
                const m = await measureViewer(page);
                if (expectIcon) {
                  assert.equal(m.externalLabelDisplay, "none", `${vw}px : libellé masqué (icône seule)`);
                  assert.ok(m.externalBtn && m.externalBtn.w >= 43.5 && m.externalBtn.h >= 43.5, `${vw}px : cible ≥44px (${JSON.stringify(m.externalBtn)})`);
                  assert.equal(m.externalAriaLabel, "Ouvrir dans un nouvel onglet", `${vw}px : accessible name`);
                } else {
                  assert.notEqual(m.externalLabelDisplay, "none", `${vw}px : libellé texte visible`);
                  assert.equal(m.externalLabelText, "Nouvel onglet", `${vw}px : libellé « Nouvel onglet »`);
                }
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
              assert.equal(afterScroll.bodyOverflow, "hidden", "modal-body overflow hidden (scroller unique)");
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

test("Viewer : non-régression des sheets 92dvh (CSS inchangé)", () => {
  assert.match(css, /dialog#documentDialog\.modal-mobile-sheet,\s*\n\s*dialog#dossierDialog\.modal-mobile-sheet/);
  assert.match(css, /dialog\.modal-mobile-sheet--long-form \{ height: 92dvh; max-height: 92dvh; \}/);
  assert.match(css, /dialog#taskDialog\.modal-mobile-sheet--form \{\s*\n\s*height: 92dvh;\s*\n\s*max-height: 92dvh;/);
  assert.match(css, /dialog#procedureActionDialog\.modal-mobile-sheet--form,\s*\n\s*dialog#personPrintDialog\.modal-mobile-sheet--form/);
  assert.match(css, /#procedureDetailDialog\.modal-mobile-sheet--stable \{\s*\n\s*height: 92dvh;/);
  /* viewer volontairement hors du pattern sheet */
  assert.doesNotMatch(html, /id="documentViewerDialog"[^>]*modal-mobile-sheet/);
});
