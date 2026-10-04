import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

test("les en-têtes Arbre, Annuaire, Documents, Actions et Démarches partagent la même hiérarchie", async t => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    t.skip("Chromium Playwright indisponible");
    return;
  }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR" });
  await context.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(server.baseURL) || url.includes("gstatic.com")
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForSelector("#dossiersView .page-title", { state: "attached" });

    for (const viewport of [
      { label: "mobile 390 px", width: 390, height: 844 },
      { label: "desktop 1024 px", width: 1024, height: 768 }
    ]) {
      await t.test(viewport.label, async tViewport => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const headingGaps = await page.evaluate(() => {
          document.getElementById("authScreen").hidden = true;
          document.getElementById("topbar").hidden = false;
          const ids = ["appMain", "directoryView", "documentsView", "tasksView", "dossiersView"];
          return ids.map(id => {
            for (const viewId of ids) document.getElementById(viewId).hidden = viewId !== id;
            const kicker = document.querySelector(`#${id} .page-kicker`).getBoundingClientRect();
            const title = document.querySelector(`#${id} .page-title`).getBoundingClientRect();
            const description = id === "appMain"
              ? document.querySelector(`#${id} .lead`)
              : document.querySelector(`#${id} .section-head > div > p:not(.page-kicker)`);
            const descriptionStyle = getComputedStyle(description);
            const descriptionRect = descriptionStyle.display === "none" ? null : description.getBoundingClientRect();
            const header = document.getElementById("topbar").getBoundingClientRect();
            return {
              view: id,
              topToKicker: kicker.top - header.bottom,
              kickerToTitle: title.top - kicker.bottom,
              titleToDescription: descriptionRect ? descriptionRect.top - title.bottom : "masquée"
            };
          });
        });
        for (const property of ["topToKicker", "kickerToTitle"]) {
          assert.ok(headingGaps.every(gaps => Math.abs(gaps[property] - headingGaps[0][property]) < 0.1), `${property} identique : ${JSON.stringify(headingGaps)}`);
        }
        const visibleDescriptionGaps = headingGaps.filter(gaps => typeof gaps.titleToDescription === "number");
        const expectedDescriptionGap = viewport.width === 390 ? 7 : 10;
        assert.ok(visibleDescriptionGaps.every(gaps => Math.abs(gaps.titleToDescription - expectedDescriptionGap) < 0.1), `H2 → description ${expectedDescriptionGap}px : ${JSON.stringify(headingGaps)}`);
        tViewport.diagnostic(`${viewport.label}: mesures des espacements ${JSON.stringify(headingGaps)}`);
        await page.evaluate(() => {
          for (const id of ["appMain", "directoryView", "documentsView", "tasksView", "dossiersView"]) {
            document.getElementById(id).hidden = id !== "appMain";
          }
        });
        const headings = await page.evaluate(() => [
          ["Arbre", document.querySelector("#appMain .page-title"), document.querySelector("#appMain .page-kicker")],
          ["Annuaire", document.querySelector("#directoryView .page-title"), document.querySelector("#directoryView .page-kicker")],
          ["Documents", document.querySelector("#documentsView .page-title"), document.querySelector("#documentsView .page-kicker")],
          ["Actions", document.querySelector("#tasksView .page-title"), document.querySelector("#tasksView .page-kicker")],
          ["Démarches", document.querySelector("#dossiersView .page-title"), document.querySelector("#dossiersView .page-kicker")]
        ].map(([view, title, kicker]) => {
          const titleStyle = getComputedStyle(title);
          const kickerStyle = getComputedStyle(kicker);
          return {
            view,
            title: { family: titleStyle.fontFamily, size: titleStyle.fontSize, weight: titleStyle.fontWeight, lineHeight: titleStyle.lineHeight, color: titleStyle.color },
            kicker: { family: kickerStyle.fontFamily, size: kickerStyle.fontSize, weight: kickerStyle.fontWeight, lineHeight: kickerStyle.lineHeight, letterSpacing: kickerStyle.letterSpacing, color: kickerStyle.color, display: kickerStyle.display }
          };
        }));
        assert.equal(headings.length, 5);
        assert.equal(new Set(headings.map(item => JSON.stringify(item.title))).size, 1, `H2 identiques : ${JSON.stringify(headings)}`);
        assert.equal(new Set(headings.map(item => JSON.stringify(item.kicker))).size, 1, `surtitres identiques : ${JSON.stringify(headings)}`);
        assert.ok(Math.abs(parseFloat(headings[0].title.size) - (viewport.width === 390 ? 31.2 : 40)) < 0.1, `taille H2 standard responsive : ${headings[0].title.size}`);
        assert.equal(headings[0].title.color, "rgb(38, 51, 46)");
        assert.equal(headings[0].kicker.color, "rgb(104, 116, 111)");
        assert.equal(headings[0].kicker.display, "block", "le surtitre Arbre reste visible en mobile");
        tViewport.diagnostic(`${viewport.label}: H2 ${headings[0].title.size}/${headings[0].title.lineHeight}, ${headings[0].title.color}; surtitre ${headings[0].kicker.size}/${headings[0].kicker.lineHeight}, ${headings[0].kicker.color}`);
      });
    }
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
