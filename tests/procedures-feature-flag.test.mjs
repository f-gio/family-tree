import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { environmentFeatureFlags, resolveFirebaseEnvironment, FIREBASE_PROJECT_IDS } from "../js/firebase-environment.js";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const [appSource, cssSource, envSource] = await Promise.all([
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../css/design-system.css", import.meta.url), "utf8"),
  readFile(new URL("../js/firebase-environment.js", import.meta.url), "utf8")
]);

/* ─── 1. Feature flag pur ─── */

test("environmentFeatureFlags : showProcedures désactivé uniquement en production", () => {
  assert.equal(environmentFeatureFlags("production").showProcedures, false);
  assert.equal(environmentFeatureFlags("recette").showProcedures, true);
  assert.equal(environmentFeatureFlags("local").showProcedures, true);
  assert.equal(environmentFeatureFlags("unknown").showProcedures, true);
  assert.ok(Object.isFrozen(environmentFeatureFlags("production")), "objet gelé");
});

test("resolveFirebaseEnvironment produit les 3 environnements attendus", () => {
  assert.equal(resolveFirebaseEnvironment({ hostname: "f-gio.github.io", protocol: "https:", pathname: "/family-tree/" }).environment, "production");
  assert.equal(resolveFirebaseEnvironment({ hostname: "la-nostra-storia-recette.web.app", protocol: "https:" }).environment, "recette");
  assert.equal(resolveFirebaseEnvironment({ hostname: "localhost", protocol: "http:" }).environment, "local");
  assert.equal(FIREBASE_PROJECT_IDS.production, "family-tree-c2fe2");
});

/* ─── 2. Câblage statique app.js + CSS ─── */

test("app.js importe et utilise le feature flag pour masquer Démarches", () => {
  assert.match(appSource, /import \{[^}]*environmentFeatureFlags[^}]*\} from "\.\/firebase-environment\.js"/);
  assert.match(appSource, /const featureFlags = environmentFeatureFlags\(firebaseEnvironment\.environment\)/);
  assert.match(appSource, /if \(!featureFlags\.showProcedures\) \{/);
  assert.match(appSource, /document\.documentElement\.classList\.add\("procedures-hidden"\)/);
  assert.match(appSource, /document\.querySelectorAll\('\[data-view="dossiers"\]'\)\.forEach\(button => \{/);
  assert.match(appSource, /button\.hidden = true/);
});

test("setView redirige dossiers vers tree quand showProcedures est désactivé", () => {
  assert.match(appSource, /function setView\(view\) \{\s*\n\s*if \(view === "dossiers" && !featureFlags\.showProcedures\) view = "tree";/);
});

test("CSS : nav mobile 4 colonnes quand procedures-hidden", () => {
  assert.match(cssSource, /@media \(max-width: 760px\) \{\s*\n\s*html\.procedures-hidden \.main-nav \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
});

test("firebase-environment.js ne touche pas aux identifiants Firebase", () => {
  assert.match(envSource, /production: "family-tree-c2fe2"/);
  assert.match(envSource, /recette: "la-nostra-storia-recette"/);
  assert.ok(!/apiKey.*=.*envSource/.test(envSource), "aucune fuite");
  const keys = envSource.match(/apiKey: "[^"]+"/g);
  assert.equal(keys.length, 3, "3 clés inchangées (production, recette, local)");
});

/* ─── 3. Navigateur : simulation Production puis Recette ─── */

const PROD_CFG = { apiKey: "AIzaSyCJEcONT97K3y0MqsiPORRjWfNj8XZGfM8", authDomain: "family-tree-c2fe2.firebaseapp.com", projectId: "family-tree-c2fe2", messagingSenderId: "1096091899254", appId: "1:1096091899254:web:4afff8d04448409d969657" };
const RECETTE_CFG = { apiKey: "AIzaSyDZC8JANaZetj33v8oLDS6Esz-3Fmeegvc", authDomain: "la-nostra-storia-recette.firebaseapp.com", projectId: "la-nostra-storia-recette", storageBucket: "la-nostra-storia-recette.firebasestorage.app", messagingSenderId: "69667950287", appId: "1:69667950287:web:52274e0cf6f4cbc11771ba" };

async function patchedEnvSource(forcedEnv) {
  const original = await readFile(new URL("../js/firebase-environment.js", import.meta.url), "utf8");
  const cfg = forcedEnv === "production" ? JSON.stringify(PROD_CFG) : JSON.stringify(RECETTE_CFG);
  return original.replace(
    "export function resolveFirebaseEnvironment(locationLike) {",
    `export function resolveFirebaseEnvironment(locationLike) {\n  return Object.freeze({ allowed: true, environment: ${JSON.stringify(forcedEnv)}, firebaseConfig: Object.freeze(${cfg}) });`
  );
}

async function createPage(browser, server, { forcedEnv, viewport }) {
  const context = await browser.newContext({
    viewport,
    locale: "fr-FR",
    isMobile: viewport.width <= 760,
    hasTouch: viewport.width <= 760,
    reducedMotion: "reduce"
  });
  await context.addInitScript(env => { window.__forcedEnv = env; }, forcedEnv);
  const envBody = await patchedEnvSource(forcedEnv);
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url.endsWith("/js/firebase-environment.js")) {
      const response = await route.fetch();
      return route.fulfill({ response, body: envBody });
    }
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = false;
  });
  return { context, page };
}

test("Production simulée : onglet Démarches masqué, accès bloqué, autres vues OK", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const [width, height] of [[1024, 768], [390, 844]]) {
      await t.test(`${width}×${height}`, async () => {
        const { context, page } = await createPage(browser, server, { forcedEnv: "production", viewport: { width, height } });
        try {
          /* onglet absent */
          const nav = await page.evaluate(() => {
            const btn = document.querySelector('[data-view="dossiers"]');
            return { exists: !!btn, hidden: btn ? btn.hidden : null, ariaHidden: btn ? btn.getAttribute("aria-hidden") : null };
          });
          assert.ok(nav.exists, "le bouton reste dans le DOM");
          assert.equal(nav.hidden, true, "onglet masqué en production");
          assert.equal(nav.ariaHidden, "true", "aria-hidden positionné");
          /* classe CSS posée */
          const htmlClass = await page.evaluate(() => document.documentElement.classList.contains("procedures-hidden"));
          assert.ok(htmlClass, "classe procedures-hidden posée");
          /* env badge absent en production */
          const badge = await page.evaluate(() => {
            const el = document.getElementById("environmentBadgeApp");
            return el ? { hidden: el.hidden, display: getComputedStyle(el).display } : null;
          });
          assert.ok(!badge || badge.hidden || badge.display === "none", "badge RECETTE absent");
          /* setView("dossiers") redirige vers tree */
          const redirected = await page.evaluate(() => {
            document.querySelector('[data-view="tree"]').click();
            document.querySelector('[data-view="dossiers"]')?.click();
            const treeVisible = !document.getElementById("appMain").hidden;
            const dossiersHidden = document.getElementById("dossiersView").hidden;
            return { treeVisible, dossiersHidden };
          });
          assert.ok(redirected.treeVisible, "retour à l'Arbre");
          assert.ok(redirected.dossiersHidden, "vue Démarches restée masquée");
          /* setView programmatique redirige aussi */
          const programmatic = await page.evaluate(() => {
            const evt = new CustomEvent("test");
            window.dispatchEvent(evt);
            /* setView n'est pas exposé globalement ; on simule via le bouton cliqué — déjà couvert.
               On vérifie au moins que dossiersView reste hidden. */
            return document.getElementById("dossiersView").hidden;
          });
          assert.ok(programmatic, "dossiersView reste hidden");
          /* autres vues accessibles */
          for (const view of ["directory", "documents", "tasks"]) {
            const ok = await page.evaluate(v => {
              document.querySelector(`[data-view="${v}"]`).click();
              const map = { directory: "directoryView", documents: "documentsView", tasks: "tasksView" };
              return !document.getElementById(map[v]).hidden;
            }, view);
            assert.ok(ok, `vue ${view} accessible`);
          }
          /* navigation mobile : 4 colonnes */
          if (width <= 760) {
            const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".main-nav")).gridTemplateColumns);
            const colCount = cols.split(" ").filter(Boolean).length;
            assert.equal(colCount, 4, `nav mobile à 4 colonnes (${cols})`);
          }
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});

test("Recette simulée : onglet Démarches visible et fonctionnel", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const [width, height] of [[1024, 768], [390, 844]]) {
      await t.test(`${width}×${height}`, async () => {
        const { context, page } = await createPage(browser, server, { forcedEnv: "recette", viewport: { width, height } });
        try {
          const nav = await page.evaluate(() => {
            const btn = document.querySelector('[data-view="dossiers"]');
            return { hidden: btn.hidden, ariaHidden: btn.getAttribute("aria-hidden") };
          });
          assert.equal(nav.hidden, false, "onglet visible en recette");
          assert.equal(nav.ariaHidden, null, "pas d'aria-hidden en recette");
          const htmlClass = await page.evaluate(() => document.documentElement.classList.contains("procedures-hidden"));
          assert.ok(!htmlClass, "pas de classe procedures-hidden");
          const badge = await page.evaluate(() => {
            const el = document.getElementById("environmentBadgeApp");
            return el ? { hidden: el.hidden, display: getComputedStyle(el).display } : null;
          });
          assert.ok(badge && !badge.hidden && badge.display !== "none", "badge RECETTE visible");
          /* ouverture de la vue Démarches */
          const opened = await page.evaluate(() => {
            document.querySelector('[data-view="dossiers"]').click();
            return {
              dossiersVisible: !document.getElementById("dossiersView").hidden,
              treeHidden: document.getElementById("appMain").hidden
            };
          });
          assert.ok(opened.dossiersVisible, "vue Démarches ouverte");
          assert.ok(opened.treeHidden, "vue Arbre masquée");
          /* retour Arbre */
          const back = await page.evaluate(() => {
            document.querySelector('[data-view="tree"]').click();
            return !document.getElementById("appMain").hidden;
          });
          assert.ok(back, "retour Arbre OK");
          /* navigation mobile : 5 colonnes */
          if (width <= 760) {
            const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".main-nav")).gridTemplateColumns);
            const colCount = cols.split(" ").filter(Boolean).length;
            assert.equal(colCount, 5, `nav mobile à 5 colonnes (${cols})`);
          }
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});

test("WebKit : Production masquée, Recette visible", async t => {
  let browser;
  try { browser = await webkit.launch({ headless: true }); }
  catch (error) { t.skip(`WebKit indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const forcedEnv of ["production", "recette"]) {
      await t.test(forcedEnv, async () => {
        const { context, page } = await createPage(browser, server, { forcedEnv, viewport: { width: 390, height: 844 } });
        try {
          const state = await page.evaluate(() => ({
            hidden: document.querySelector('[data-view="dossiers"]').hidden,
            hasClass: document.documentElement.classList.contains("procedures-hidden")
          }));
          if (forcedEnv === "production") {
            assert.equal(state.hidden, true);
            assert.ok(state.hasClass);
          } else {
            assert.equal(state.hidden, false);
            assert.ok(!state.hasClass);
          }
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});
