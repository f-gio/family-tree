import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { ROOT, startStaticServer, isAllowedRequest, blockedServiceFor, BOOT_WARNING } from "./helpers.mjs";

/*
 * Smoke responsive GENUINE (remplacement de l'ancien faux test qui se déclarait
 * « exécuté » avec process.exit(0) sans jamais lancer de navigateur).
 *
 * Règles appliquées ici et héritées de la suite complète (tests/responsive-real.mjs) :
 *  - L'import de Playwright est STRICTE : s'il manque, ce fichier ÉCHOUE sous
 *    `node --test` (message explicite), jamais un succès simulé.
 *  - Le lancement de Chromium est STRICTE : s'il manque, ÉCHEC explicite.
 *  - La page est servie en HTTP local (jamais de file://), blocage des services
 *    externes (Firestore, Auth, GeoNames, jsDelivr), aucune donnée réelle.
 *  - Ce fichier est le premier niveau de garde-fou ; la suite complète (7 viewports,
 *    modale, annuaire, autocomplétion, paysage, cibles tactiles…) est lancée via
 *    `npm run test:responsive`.
 */

const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright/package.json").version;

let browser;
let server;
try {
  browser = await chromium.launch({ headless: true });
  server = await startStaticServer(ROOT);
} catch (error) {
  throw new Error(
    `Smoke responsive réel : navigateur Chromium indisponible — ${error.message}\n` +
    `Le responsive N'A PAS été évalué. Installez les binaires avec « npx playwright install chromium ».`
  );
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
const page = await context.newPage();
await context.route("**/*", route => {
  const url = route.request().url();
  if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
  const svc = blockedServiceFor(url);
  if (svc) process.stdout.write(`Smoke — service externe bloqué : ${svc}\n`);
  return route.abort("blockedbyclient").catch(() => {});
});

try {
  const bootReady = page.waitForEvent("console", {
    predicate: message => message.type() === "warning" && message.text().includes(BOOT_WARNING),
    timeout: 90000
  });
  await page.goto(server.baseURL, { waitUntil: "load" });
  const boot = await bootReady;
  assert.ok(boot, "Avertissement d'amorçage attendu");

  const loginVisible = await page.evaluate(() => {
    const form = document.getElementById("loginForm");
    return !!form && !form.hidden && getComputedStyle(form).display !== "none";
  });
  assert.ok(loginVisible, "Le formulaire de connexion doit être visible (avis : écran d'authentification réel)");

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  assert.ok(
    overflow.scroll <= overflow.doc + 1,
    `Débordement horizontal de page au chargement (scrollX ${overflow.scroll}px > ${overflow.doc}px)`
  );

  const loginBox = await page.locator("#loginBtn").boundingBox();
  assert.ok(loginBox, "Bouton de connexion introuvable");
  /* Garde minimaliste d'intégrité (plausibilité de mise en page) : la norme 44×44
     est mesurée strictement par la suite complète (npm run test:responsive) qui
     documente les écarts réels (ex. boutons à 42 px sur les breakpoints desktop). */
  assert.ok(
    loginBox.width >= 40 && loginBox.height >= 40,
    `Cible tactile du bouton de connexion effondrée : ${Math.round(loginBox.width * 10) / 10}×${Math.round(loginBox.height * 10) / 10}px`
  );

  await context.close();
  await browser.close();
  await server.close();

  console.log(`Smoke responsive réel : OK (Playwright v${playwrightVersion}, connecté en HTTP local, Chromium lancé et mesuré).`);
} catch (error) {
  if (server) await server.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  throw new Error(`Smoke responsive réel : ÉCHEC — ${error.message}`);
}