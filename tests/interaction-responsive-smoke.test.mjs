import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  const moduleRoot = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  ({ chromium } = moduleRoot ? require(`${moduleRoot}/playwright`) : require("playwright"));
} catch {
  console.log("Smoke responsive : non exécuté (Playwright indisponible)");
  process.exit(0);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch {
  console.log("Smoke responsive : non exécuté (navigateur Chromium indisponible)");
  process.exit(0);
}
const pageUrl = pathToFileURL(new URL("../index.html", import.meta.url).pathname).href;
const viewports = [
  { name: "desktop-large", width: 1440, height: 900 },
  { name: "desktop-medium", width: 1180, height: 800 },
  { name: "desktop-compact", width: 1024, height: 768 },
  { name: "tablet-wide", width: 900, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile-wide", width: 600, height: 900 },
  { name: "mobile", width: 390, height: 844 },
  { name: "mobile-small", width: 320, height: 700 }
];

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport });
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("directoryView").hidden = false;
    document.getElementById("directoryList").className = "content-grid directory-grid cards-mode";
    document.getElementById("directoryList").innerHTML = Array.from({ length: 5 }, (_, index) => `
      <article class="directory-entry" tabindex="0">
        <span class="directory-avatar">FT</span>
        <div class="directory-main"><h3>Giovannoni Personne ${index + 1}</h3><p class="directory-life">✦ 1869 — † 1932</p></div>
        <div class="directory-entry-actions"><button class="directory-action">Documents · 2</button><button class="directory-action directory-open-action">→</button></div>
      </article>`).join("");
  });
  await page.waitForTimeout(50);
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    navHeights: [...document.querySelectorAll(".nav-btn")].map(element => element.getBoundingClientRect().height),
    cardWidths: [...document.querySelectorAll(".directory-entry")].map(element => element.getBoundingClientRect().width)
  }));
  assert.ok(metrics.pageWidth <= metrics.viewport + 1, `${viewport.name}: overflow horizontal`);
  assert.ok(metrics.cardWidths.every(width => width >= Math.min(260, viewport.width - 32)), `${viewport.name}: carte trop étroite`);
  if (viewport.width <= 760) assert.ok(metrics.navHeights.every(height => height >= 44), `${viewport.name}: cible de navigation trop petite`);
  await page.close();
}

await browser.close();
console.log("Smoke responsive sections 23–29 : OK");
