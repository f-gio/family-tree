import assert from "node:assert/strict";
import test from "node:test";
import { webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const mobileKey = "familyTreeDirectoryViewMobile";
const desktopKey = "familyTreeDirectoryViewDesktop";

test("Annuaire : défaut adaptatif et préférences Liste/Cartes indépendantes", async t => {
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (error) {
    throw new Error(`WebKit indisponible : ${error.message}`);
  }
  const server = await startStaticServer(ROOT);
  const contexts = [];

  async function createPage(width, { seed = {}, unavailableStorage = false } = {}) {
    const context = await browser.newContext({
      locale: "fr-FR",
      viewport: { width, height: width <= 760 ? 844 : 768 },
      isMobile: width <= 760,
      hasTouch: width <= 760
    });
    contexts.push(context);
    await context.addInitScript(({ initialValues, storageUnavailable }) => {
      if (storageUnavailable) {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() { throw new DOMException("Stockage indisponible", "SecurityError"); }
        });
        return;
      }
      for (const [key, value] of Object.entries(initialValues)) window.localStorage.setItem(key, value);
    }, { initialValues: seed, storageUnavailable: unavailableStorage });
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (url.endsWith("/js/app.js")) {
        const response = await route.fetch();
        const source = await response.text();
        return route.fulfill({
          response,
          body: `${source}\nwindow.__showDirectoryForTest = () => { $("authScreen").hidden = true; setView("directory"); }; window.__directoryPreferenceProbe = () => { const mode = viewModes.directory; const active = document.querySelector('[data-switch="directory"] [data-mode].active'); return { context: directoryViewContext(), mode, activeMode: active?.dataset.mode || "", activePressed: active?.getAttribute("aria-pressed") || "", listMode: document.getElementById("directoryList").classList.contains("list-mode"), cardsMode: document.getElementById("directoryList").classList.contains("cards-mode"), mobilePreference: readDirectoryViewPreference("mobile"), desktopPreference: readDirectoryViewPreference("desktop") }; };`
        });
      }
      return url.startsWith(server.baseURL) || url.includes("gstatic.com")
        ? route.continue()
        : route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__directoryPreferenceProbe === "function");
    await page.evaluate(() => window.__showDirectoryForTest());
    return { page, pageErrors };
  }

  async function state(page) {
    return page.evaluate(() => window.__directoryPreferenceProbe());
  }

  async function waitForMode(page, context, mode) {
    await page.waitForFunction(({ expectedContext, expectedMode }) => {
      const result = window.__directoryPreferenceProbe();
      return result.context === expectedContext && result.mode === expectedMode;
    }, { expectedContext: context, expectedMode: mode });
  }

  async function clickMode(page, mode) {
    await page.locator(`#directoryView [data-mode="${mode}"]`).evaluate(button => button.click());
  }

  try {
    await t.test("défauts 320/390/760/1024 et redimensionnement sans mémorisation", async () => {
      const { page } = await createPage(1024);
      for (const [width, context, mode] of [[320, "mobile", "cards"], [390, "mobile", "cards"], [760, "mobile", "cards"], [1024, "desktop", "list"]]) {
        await page.setViewportSize({ width, height: width <= 760 ? 844 : 768 });
        await waitForMode(page, context, mode);
        const current = await state(page);
        assert.equal(current.activeMode, mode, `${width}px : bouton actif`);
        assert.equal(current.activePressed, "true", `${width}px : aria-pressed reflète la vue`);
        assert.equal(current.listMode, mode === "list", `${width}px : classe Liste cohérente`);
        assert.equal(current.cardsMode, mode === "cards", `${width}px : classe Cartes cohérente`);
        assert.equal(current.mobilePreference, null, `${width}px : pas de préférence mobile créée par défaut/redimensionnement`);
        assert.equal(current.desktopPreference, null, `${width}px : pas de préférence desktop créée par défaut/redimensionnement`);
      }
    });

    await t.test("choix explicites mémorisés séparément, puis retrouvés au changement de breakpoint", async () => {
      const { page } = await createPage(390);
      await waitForMode(page, "mobile", "cards");
      await clickMode(page, "list");
      let current = await state(page);
      assert.equal(current.mode, "list", "le clic applique immédiatement Liste sur mobile");
      assert.equal(current.mobilePreference, "list");
      assert.equal(current.desktopPreference, null, "le choix mobile ne crée pas de préférence desktop");

      await page.setViewportSize({ width: 1024, height: 768 });
      await waitForMode(page, "desktop", "list");
      await clickMode(page, "cards");
      current = await state(page);
      assert.equal(current.mode, "cards", "le clic applique immédiatement Cartes sur desktop");
      assert.equal(current.mobilePreference, "list", "le choix desktop conserve la préférence mobile");
      assert.equal(current.desktopPreference, "cards");

      await page.setViewportSize({ width: 320, height: 844 });
      await waitForMode(page, "mobile", "list");
      await page.setViewportSize({ width: 1024, height: 768 });
      await waitForMode(page, "desktop", "cards");
      current = await state(page);
      assert.equal(current.mobilePreference, "list");
      assert.equal(current.desktopPreference, "cards");
    });

    await t.test("préférences indépendantes quand une seule plateforme a un choix enregistré", async () => {
      const mobile = await createPage(390);
      await clickMode(mobile.page, "list");
      let current = await state(mobile.page);
      assert.equal(current.mobilePreference, "list");
      assert.equal(current.desktopPreference, null);

      const desktop = await createPage(1024);
      await clickMode(desktop.page, "cards");
      current = await state(desktop.page);
      assert.equal(current.desktopPreference, "cards");
      assert.equal(current.mobilePreference, null);
      await desktop.page.setViewportSize({ width: 390, height: 844 });
      await waitForMode(desktop.page, "mobile", "cards");
      current = await state(desktop.page);
      assert.equal(current.mobilePreference, null, "le défaut mobile n’est pas écrit comme préférence");
      assert.equal(current.desktopPreference, "cards");
    });

    await t.test("valeurs invalides ignorées et stockage indisponible sans erreur visible", async () => {
      const invalid = await createPage(320, { seed: { [mobileKey]: "grid", [desktopKey]: "compact" } });
      await waitForMode(invalid.page, "mobile", "cards");
      assert.equal((await state(invalid.page)).mobilePreference, null);
      await invalid.page.setViewportSize({ width: 1024, height: 768 });
      await waitForMode(invalid.page, "desktop", "list");
      assert.equal((await state(invalid.page)).desktopPreference, null);

      const unavailable = await createPage(390, { unavailableStorage: true });
      await waitForMode(unavailable.page, "mobile", "cards");
      await clickMode(unavailable.page, "list");
      const current = await state(unavailable.page);
      assert.equal(current.mode, "list", "le sélecteur reste fonctionnel malgré le stockage indisponible");
      assert.equal(current.activeMode, "list");
      assert.deepEqual(unavailable.pageErrors, [], "aucune erreur visible de stockage");
    });
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await browser.close();
    await server.close();
  }
});
