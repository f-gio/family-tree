import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { blockedServiceFor, isAllowedRequest } from "./helpers.mjs";

/* ─── 1. Assertions statiques sur la stratégie de cache (firebase.json) ────── */

function readFirebaseHostingSource() {
  return readFileSync(new URL("../firebase.json", import.meta.url), "utf8");
}

test("firebase.json impose la revalidation du document et des modules JS/CSS", () => {
  const config = JSON.parse(readFirebaseHostingSource());
  const valueFor = target => {
    const rule = (config.hosting.headers || []).find(item => item.source === target);
    return rule?.headers?.find(item => item.key === "Cache-Control")?.value ?? null;
  };
  assert.equal(valueFor("/"), "no-cache");
  assert.equal(valueFor("/index.html"), "no-cache", "document revalidé systématiquement");
  assert.equal(valueFor("/js/**/*.js"), "no-cache", "modules JS revalidés systématiquement");
  assert.equal(valueFor("/css/**/*.css"), "no-cache", "CSS revalidé systématiquement");
  assert.match(valueFor("/La_Nostra_Storia_icons/**"), /max-age=604800/, "icônes mises en cache longtemps");
  assert.equal(config.hosting.public, "dist-recette");
  assert.equal((config.hosting.headers || []).some(rule => rule.source.includes("rules")), false, "aucune règle ne touche Firestore Rules");
});

test("aucun service worker ni manifest n’est publiés (aucun cache applicatif à invalider)", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(!html.includes("serviceWorker"), "aucune inscription de service worker");
  assert.ok(!/rel=["']manifest["']/i.test(html), "aucun manifest PWA dans index.html");
});

/* ─── 2. Reproduction et validation comportementale (cache HTTP Chromium) ─── */

let htmlVersion = "A";
let jsVersion = "A";
let jsCacheControl = "max-age=3600";
let htmlCacheControl = "max-age=3600";

function startVersionedServer() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://x").pathname;
    const jsContent = `window.__moduleVersion = "${jsVersion}";`;
    const htmlContent = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>V${htmlVersion}</title></head><body><script type="module" src="./js/app.js"><\/script></body></html>`;
    if (pathname === "/js/app.js") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": jsCacheControl,
        etag: `"js-${jsVersion}"`
      });
      response.end(jsContent);
    } else {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": htmlCacheControl,
        etag: `"html-${htmlVersion}"`
      });
      response.end(htmlContent);
    }
  });
  return new Promise(async resolve => {
    await new Promise(listen => server.listen(0, "127.0.0.1", listen));
    resolve({ server, base: `http://127.0.0.1:${server.address().port}/` });
  });
}

async function chromium() {
  const { chromium } = await import("playwright");
  try { return { browser: await chromium.launch({ headless: true }), available: true }; }
  catch { return { browser: null, available: false }; }
}

test("stratégie max-age=3600 : mélange de versions après publication (cause démontrée)", async t => {
  const { browser, available } = await chromium();
  if (!available) { t.skip("Chromium indisponible"); return; }
  const { server, base } = await startVersionedServer();
  htmlVersion = "A"; jsVersion = "A";
  jsCacheControl = "max-age=3600"; htmlCacheControl = "max-age=3600";
  const context = await browser.newContext();
  const page1 = await context.newPage();
  await page1.goto(base, { waitUntil: "load" });
  assert.equal(await page1.evaluate(() => window.__moduleVersion), "A");
  // Publication de la version B : même URL, nouveaux contenus, max-age inchangé.
  htmlVersion = "B"; jsVersion = "B";
  await page1.reload({ waitUntil: "load" });
  const documentVersion = await page1.title();
  const moduleVersion = await page1.evaluate(() => window.__moduleVersion);
  assert.equal(documentVersion, "VB", "le document est revalidé au rechargement");
  assert.equal(moduleVersion, "A", "le module JS périmé reste servi avec max-age=3600 : mélange de versions");
  const page2 = await context.newPage();
  await page2.goto(base, { waitUntil: "load" });
  const staleNavigation = await page2.evaluate(() => window.__moduleVersion);
  assert.equal(staleNavigation, "A", "une navigation sans revalidation sert encore l’ancien module");
  await browser.close();
  server.close();
});

test("stratégie no-cache : version cohérente sur rechargement, nouvel onglet et nouvelle session", async t => {
  const { browser, available } = await chromium();
  if (!available) { t.skip("Chromium indisponible"); return; }
  const { server, base } = await startVersionedServer();
  htmlVersion = "B"; jsVersion = "B";
  jsCacheControl = "no-cache"; htmlCacheControl = "no-cache";
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "load" });
  // Publication de la version C : revalidation systématique garantie par les en-têtes du correctif.
  htmlVersion = "C"; jsVersion = "C";
  const tab = await context.newPage();
  await tab.goto(base, { waitUntil: "load" });
  assert.equal(await tab.evaluate(() => window.__moduleVersion), "C", "nouvel onglet : module à jour");
  assert.equal(await tab.title(), "VC", "nouvel onglet : document à jour");
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.evaluate(() => window.__moduleVersion), "C", "rechargement normal : module à jour");
  assert.equal(await page.title(), "VC", "rechargement normal : document à jour");
  const freshContext = await browser.newContext();
  const fresh = await freshContext.newPage();
  await fresh.goto(base, { waitUntil: "load" });
  assert.equal(await fresh.evaluate(() => window.__moduleVersion), "C", "nouvelle session : version à jour");
  await freshContext.close();
  await browser.close();
  server.close();
});

test("le correctif n’altère ni l’artefact ni les gardes d’environnement", () => {
  const source = readFirebaseHostingSource();
  assert.ok(/"public"\s*:\s*"dist-recette"/.test(source), "l’artefact Recette reste la racine publiée");
  assert.ok(/"rules"\s*:\s*"firestore\.rules"/.test(source), "la référence Firestore Rules est inchangée");
  isAllowedRequest("http://127.0.0.1/x/", "http://127.0.0.1/");
  blockedServiceFor("https://firestore.googleapis.com/x");
});
