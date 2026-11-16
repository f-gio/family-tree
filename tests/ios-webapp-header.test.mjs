import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const cssSource = await readFile(new URL("../css/design-system.css", import.meta.url), "utf8");

/* Mode Web App iOS autonome : viewport-fit=cover + apple-mobile-web-app-status-bar-style
   = black-translucent rendent la barre d'état par-dessus le contenu, donc
   env(safe-area-inset-top) vaut la hauteur de la barre d'état (59 px sur un
   iPhone à île dynamique). Les substitutions ci-dessous rejouent ces valeurs,
   que Chromium headless renvoie sinon à 0. */
const SAFE_TOP = 59;
const SAFE_BOTTOM = 34;

test("CSS : la safe-area verticale n'est réappliquée que là où elle est utile", () => {
  const base = cssSource.match(/\.tree-controls \{\r?\n\s*position: absolute;\r?\n\s*inset: ([^;]+);/);
  assert.ok(base, "règle .tree-controls de base présente");
  assert.ok(!base[1].includes("env(safe-area-inset-top)"),
    "en vue normale les commandes ne sont pas décalées sous la barre d'état");
  assert.match(cssSource,
    /html\.tree-fullscreen-active #appMain \.tree-controls\s*\{[^}]*inset: max\(var\(--space-2\), env\(safe-area-inset-top\)\)/,
    "en plein écran, la barre d'état reste prise en compte");
  assert.match(cssSource,
    /\.person-detail-section-nav \{ top: calc\(max\(var\(--space-1\), env\(safe-area-inset-top\)\) \+ var\(--control-touch\) \+ var\(--space-1\)\)/,
    "la barre de sections colle exactement sous l'en-tête de la fiche Personne");
});

test("Web App iOS : en-tête, navigation et bouton … alignés sous la zone système", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "fr-FR",
      reducedMotion: "reduce"
    });
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (new URL(url).pathname.endsWith("/css/design-system.css")) {
        const response = await route.fetch();
        const css = (await response.text())
          .replace(/env\(safe-area-inset-top\)/g, `${SAFE_TOP}px`)
          .replace(/env\(safe-area-inset-bottom\)/g, `${SAFE_BOTTOM}px`);
        return route.fulfill({ response, body: css, headers: { ...response.headers(), "content-type": "text/css" } });
      }
      if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
      if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
      return route.continue().catch(() => {});
    });
    const page = await context.newPage();
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.firebaseEnvironment !== undefined, null, { timeout: 15000 });
    await page.evaluate(() => {
      document.getElementById("authScreen").hidden = true;
      document.getElementById("topbar").hidden = false;
      document.getElementById("appMain").hidden = false;
      /* Mode production : Démarches masqué, donc cinq destinations restantes. */
      document.documentElement.classList.add("procedures-hidden");
      const procedures = document.querySelector('[data-view="dossiers"]');
      if (procedures) { procedures.hidden = true; procedures.setAttribute("aria-hidden", "true"); }
    });

    const nav = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll(".main-nav .nav-btn")].filter(button => !button.hidden && button.offsetParent !== null);
      return {
        count: buttons.length,
        rows: new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size
      };
    });
    assert.equal(nav.count, 5, "cinq destinations visibles quand Démarches est masqué");
    assert.equal(nav.rows, 1, "navigation sur une seule ligne");

    const header = await page.evaluate(() => {
      const topbar = document.querySelector(".topbar");
      const brand = topbar.querySelector(".brand");
      return { paddingTop: getComputedStyle(topbar).paddingTop, contentTop: Math.round(brand.getBoundingClientRect().top) };
    });
    assert.equal(header.paddingTop, `${SAFE_TOP}px`, "padding haut calé sur la zone système");
    assert.ok(header.contentTop >= SAFE_TOP, `marque à ${header.contentTop}px sous les ${SAFE_TOP}px de la zone système`);

    await page.evaluate(() => {
      document.getElementById("personDetailView").hidden = false;
      document.getElementById("personPageMobileHeader").hidden = false;
    });
    const person = await page.evaluate(() => {
      const topbar = document.querySelector(".topbar");
      const sections = document.querySelector(".person-detail-section-nav");
      const back = document.querySelector(".person-page-mobile-back");
      return {
        headerHeight: Math.round(topbar.getBoundingClientRect().height),
        stickyTop: Math.round(parseFloat(getComputedStyle(sections).top)),
        backTop: back ? Math.round(back.getBoundingClientRect().top) : null
      };
    });
    assert.ok(person.stickyTop <= person.headerHeight,
      `barre de sections à ${person.stickyTop}px, en-tête de ${person.headerHeight}px : pas de trou`);
    assert.ok(person.backTop !== null && person.backTop >= SAFE_TOP,
      `bouton Retour à ${person.backTop}px sous les ${SAFE_TOP}px de la zone système`);

    await page.evaluate(() => {
      document.getElementById("personDetailView").hidden = true;
      document.querySelector('[data-view="tree"]').click();
    });
    await page.waitForTimeout(400);
    const tree = await page.evaluate(() => {
      const viewport = document.getElementById("treeViewport").getBoundingClientRect();
      const more = document.getElementById("treeMoreBtn").getBoundingClientRect();
      return {
        gapTop: Math.round(more.top - viewport.top),
        gapRight: Math.round(viewport.right - more.right),
        width: Math.round(more.width),
        height: Math.round(more.height)
      };
    });
    assert.ok(tree.gapTop >= 0 && tree.gapTop <= 16, `bouton … à ${tree.gapTop}px du haut du conteneur (≤ 16px)`);
    assert.ok(tree.gapRight >= 0 && tree.gapRight <= 16, `bouton … à ${tree.gapRight}px de la droite du conteneur (≤ 16px)`);
    assert.ok(tree.width >= 44 && tree.height >= 44, `cible tactile ${tree.width}×${tree.height}px`);
  } finally {
    if (context) await context.close();
    await browser.close();
    await server.close();
  }
});
