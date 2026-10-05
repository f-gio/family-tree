import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const mobileViewports = [[320, 844], [390, 844], [760, 900]];

function adminUsers(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `lot3c-user-${index + 1}`,
    displayName: index === 0 ? "Membre Élodie Rossi" : `Utilisateur ${String(index + 1).padStart(2, "0")}`,
    email: `utilisateur.${index + 1}@exemple.test`,
    status: ["pending", "approved", "suspended", "rejected"][index % 4],
    role: index % 5 === 0 ? "admin" : "member"
  }));
}

function qualityFixture(long) {
  const categories = [
    ["Informations à compléter", "missing"],
    ["Chronologie", "chronology"],
    ["Doublons potentiels", "duplicates"],
    ["Relations", "relations"]
  ];
  if (!long) {
    return categories.map(([label]) => `<div class="tree-quality-category is-empty"><div class="tree-quality-category-summary"><span class="tree-quality-category-title">${label}</span><span class="tree-quality-category-count">0</span></div></div>`).join("");
  }
  return categories.map(([label, category], categoryIndex) => {
    const rows = Array.from({ length: 12 }, (_, index) => `<article class="tree-quality-item"><div><strong>Personne ${categoryIndex + 1}-${index + 1} · Rossi Giovannoni</strong><p>Vérification d’une information généalogique pour la branche familiale concernée.</p></div><div class="tree-quality-item-actions"><button class="btn small tertiary" type="button" data-quality-person="lot3c-person-${categoryIndex}-${index}">Voir la fiche</button></div></article>`).join("");
    return `<details class="tree-quality-category" open><summary><span class="tree-quality-category-title">${label}</span><span class="tree-quality-category-count">12</span></summary><div class="tree-quality-scroll"><div class="tree-quality-category-content">${rows}</div><div class="tree-quality-scroll-indicator" aria-hidden="true"><span></span></div></div></details>`;
  }).join("");
}

async function createPage(browser, server, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "fr-FR",
    isMobile: width <= 760,
    hasTouch: width <= 760,
    reducedMotion: "reduce"
  });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (url.endsWith("/js/app.js")) {
      return route.fetch().then(async response => route.fulfill({
        response,
        body: `${await response.text()}
window.__openLot3cAdmin = users => { adminUsersCache = users; renderAdminUsers(); document.getElementById("adminDialog").showModal(); };
window.__renderLot3cAdminUsers = users => { adminUsersCache = users; renderAdminUsers(); };
window.__openLot3cQuality = (long, fixture) => { document.getElementById("treeQualitySummary").textContent = long ? "48 éléments à vérifier" : "Aucun élément à vérifier"; document.getElementById("treeQualityContent").innerHTML = fixture; initTreeQualityScroll(); document.getElementById("treeQualityDialog").showModal(); };`
      })).catch(() => {});
    }
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    return route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__openLot3cAdmin === "function" && typeof window.__openLot3cQuality === "function");
  await page.evaluate(() => {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = true;
    for (const id of ["appMain", "directoryView", "documentsView", "tasksView", "dossiersView"]) {
      const view = document.getElementById(id);
      if (view) view.hidden = true;
    }
  });
  return { context, page };
}

async function measureAdmin(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById("adminDialog");
    const header = dialog.querySelector(":scope > .modal-head");
    const body = dialog.querySelector(":scope > .modal-body");
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const scrollStyle = getComputedStyle(body);
    return {
      dialog: rect(dialog), header: rect(header), body: rect(body),
      maxHeight: getComputedStyle(dialog).maxHeight,
      radius: getComputedStyle(dialog).borderTopLeftRadius,
      backdrop: getComputedStyle(dialog, "::backdrop").backgroundColor,
      headerPaddingTop: parseFloat(getComputedStyle(header).paddingTop),
      closeButton: rect(header.querySelector("[data-close]")),
      scroll: { height: body.scrollHeight, client: body.clientHeight, top: body.scrollTop, overflowY: scrollStyle.overflowY, overflowX: scrollStyle.overflowX, scrollbarWidth: scrollStyle.scrollbarWidth, webkitScrollbar: getComputedStyle(body, "::-webkit-scrollbar").display },
      cards: dialog.querySelectorAll(".admin-user").length,
      buttons: [...dialog.querySelectorAll(".admin-user-actions .btn")].map(button => ({ height: button.getBoundingClientRect().height, minHeight: getComputedStyle(button).minHeight })),
      viewport: { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight },
      hasFooter: !!dialog.querySelector(":scope > .modal-actions"),
      hasTabs: !!dialog.querySelector('[role="tablist"], [data-admin-tab]')
    };
  });
}

async function measureQuality(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById("treeQualityDialog");
    const header = dialog.querySelector(":scope > .modal-head");
    const body = dialog.querySelector(":scope > .tree-quality-body");
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const bodyStyle = getComputedStyle(body);
    const categoryContents = [...dialog.querySelectorAll(".tree-quality-category-content")];
    const actions = [...dialog.querySelectorAll(".tree-quality-item-actions .btn")];
    return {
      dialog: rect(dialog), header: rect(header), body: rect(body),
      maxHeight: getComputedStyle(dialog).maxHeight,
      radius: getComputedStyle(dialog).borderTopLeftRadius,
      backdrop: getComputedStyle(dialog, "::backdrop").backgroundColor,
      headerPaddingTop: parseFloat(getComputedStyle(header).paddingTop),
      closeButton: rect(header.querySelector("[data-close]")),
      scroll: { height: body.scrollHeight, client: body.clientHeight, top: body.scrollTop, overflowY: bodyStyle.overflowY, overflowX: bodyStyle.overflowX, scrollbarWidth: bodyStyle.scrollbarWidth, webkitScrollbar: getComputedStyle(body, "::-webkit-scrollbar").display },
      categoryScroll: categoryContents.map(content => ({ height: content.scrollHeight, client: content.clientHeight, overflowY: getComputedStyle(content).overflowY })),
      summaries: [...dialog.querySelectorAll(".tree-quality-category > summary")].map(summary => ({ open: summary.parentElement.open, height: summary.getBoundingClientRect().height })),
      actionButtons: actions.map(button => ({ height: button.getBoundingClientRect().height, minHeight: getComputedStyle(button).minHeight })),
      viewport: { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight },
      hasFooter: !!dialog.querySelector(":scope > .modal-actions")
    };
  });
}

test("Lot 3C : Administration garde une feuille stable, une recherche fonctionnelle et un scroll central", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const [width, height] of mobileViewports) {
      await t.test(`${width}×${height}`, async child => {
        const { context, page } = await createPage(browser, server, width, height);
        try {
          await page.evaluate(users => window.__openLot3cAdmin(users), adminUsers(2));
          const short = await measureAdmin(page);
          await page.evaluate(users => window.__renderLot3cAdminUsers(users), adminUsers(28));
          const long = await measureAdmin(page);
          const target = height * 0.92;
          child.diagnostic(`${width}×${height}: court=${short.dialog.height.toFixed(1)}px, long=${long.dialog.height.toFixed(1)}px, cible=${target.toFixed(1)}px, bande=${long.dialog.y.toFixed(1)}px`);
          assert.ok(Math.abs(short.dialog.height - target) < 1 && Math.abs(long.dialog.height - target) < 1, "Administration conserve sa hauteur stable de 92dvh");
          assert.ok(long.dialog.y > 0 && Math.abs(long.dialog.bottom - height) < 1, "bottom sheet avec page visible derrière");
          assert.ok(Math.abs(long.header.bottom - long.body.y) < 1, "header fixe au-dessus du body");
          assert.ok(long.headerPaddingTop >= 16 && long.closeButton.width >= 44 && long.closeButton.height >= 44, `safe-area du header et fermeture tactile (${long.headerPaddingTop}px / ${long.closeButton.width}×${long.closeButton.height})`);
          assert.ok(long.scroll.height > long.scroll.client, "la liste longue défile dans le body central");
          assert.equal(long.scroll.overflowY, "auto");
          assert.equal(long.scroll.scrollbarWidth, "none");
          assert.equal(long.scroll.webkitScrollbar, "none");
          assert.equal(long.hasFooter, false, "la modale n’a pas de footer distinct");
          assert.equal(long.hasTabs, false, "aucun onglet Admin à fixer dans la structure actuelle");
          assert.ok(long.buttons.length > 0 && long.buttons.every(button => button.height >= 44 && button.minHeight === "44px"), "actions utilisateurs ≥44px");
          assert.equal(long.viewport.scrollWidth, width, "aucun overflow horizontal");
          await page.locator("#adminDialog > .modal-body").evaluate(body => { body.scrollTop = 240; });
          const afterScroll = await measureAdmin(page);
          assert.ok(afterScroll.scroll.top > 0, "le body central défile");
          assert.deepEqual(afterScroll.header, long.header, "header stable pendant le scroll");
          assert.equal(await page.locator("#adminSearch").count(), 1, "recherche Admin conservée");
          await page.locator("#adminSearch").fill("Utilisateur 28");
          assert.equal(await page.locator("#adminDialog .admin-user").count(), 1, "recherche filtre la liste existante");
          await page.locator('#adminDialog [data-close="adminDialog"]').focus();
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#adminDialog").evaluate(dialog => dialog.open), false, "fermeture Escape conservée");
          await page.evaluate(users => window.__openLot3cAdmin(users), adminUsers(2));
          await page.locator('#adminDialog [data-close="adminDialog"]').click();
          assert.equal(await page.locator("#adminDialog").evaluate(dialog => dialog.open), false, "fermeture × conservée");
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});

test("Lot 3C : Tree Quality reste naturelle à vide et utilise un seul scroll si le contenu est long", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const shortFixture = qualityFixture(false);
  const longFixture = qualityFixture(true);
  try {
    for (const [width, height] of mobileViewports) {
      await t.test(`${width}×${height}`, async child => {
        const { context, page } = await createPage(browser, server, width, height);
        try {
          await page.evaluate(fixture => window.__openLot3cQuality(false, fixture), shortFixture);
          const short = await measureQuality(page);
          await page.locator("#treeQualityDialog").evaluate(dialog => dialog.close());
          await page.evaluate(fixture => window.__openLot3cQuality(true, fixture), longFixture);
          const long = await measureQuality(page);
          const cap = height * 0.88;
          child.diagnostic(`${width}×${height}: court=${short.dialog.height.toFixed(1)}px, long=${long.dialog.height.toFixed(1)}px, plafond=${cap.toFixed(1)}px, bande=${long.dialog.y.toFixed(1)}px`);
          assert.ok(short.dialog.height < cap - 1, "contenu vide/court conserve sa hauteur naturelle");
          assert.ok(short.dialog.y > 0 && Math.abs(short.dialog.bottom - height) < 1, "sheet courte ancrée en bas avec fond visible");
          assert.ok(long.dialog.height <= cap + 1 && Math.abs(long.dialog.height - cap) < 1, "contenu long plafonné à 88dvh");
          assert.ok(long.dialog.y > 0 && Math.abs(long.dialog.bottom - height) < 1, "sheet longue ancrée en bas avec fond visible");
          assert.ok(Math.abs(long.header.bottom - long.body.y) < 1, "header fixe au-dessus du scroll central");
          assert.ok(long.headerPaddingTop >= 16 && long.closeButton.width >= 44 && long.closeButton.height >= 44, "safe-area du header et fermeture tactile");
          assert.ok(long.scroll.height > long.scroll.client, "le body de la modale défile avec les diagnostics longs");
          assert.equal(long.scroll.overflowY, "auto");
          assert.equal(long.scroll.scrollbarWidth, "none");
          assert.equal(long.scroll.webkitScrollbar, "none");
          assert.ok(long.categoryScroll.every(category => category.overflowY === "visible" && category.height === category.client), "les catégories ne créent pas de scroll imbriqué");
          assert.ok(long.summaries.every(summary => summary.height >= 44 && summary.open), "accordéons ouverts et résumés tactiles");
          assert.ok(long.actionButtons.length > 0 && long.actionButtons.every(button => button.height >= 44 && button.minHeight === "44px"), "actions Voir la fiche ≥44px");
          assert.equal(long.hasFooter, false, "Tree Quality n’a pas de footer distinct");
          assert.ok(long.radius !== "0px", "coins supérieurs arrondis");
          assert.match(long.backdrop, /0\.42/);
          assert.equal(long.viewport.scrollWidth, width, "aucun overflow horizontal");
          await page.locator("#treeQualityContent .tree-quality-category-content").first().evaluate(content => content.scrollTop = 300);
          assert.equal(await page.locator("#treeQualityContent .tree-quality-category-content").first().evaluate(content => content.scrollTop), 0, "aucun scroll indépendant des catégories");
          await page.locator("#treeQualityDialog .tree-quality-category > summary").first().click();
          assert.equal(await page.locator("#treeQualityDialog .tree-quality-category").first().evaluate(category => category.open), false, "accordéon existant se replie");
          await page.locator("#treeQualityDialog .tree-quality-category > summary").first().click();
          assert.equal(await page.locator("#treeQualityDialog .tree-quality-category").first().evaluate(category => category.open), true, "accordéon existant se déplie");
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#treeQualityDialog").evaluate(dialog => dialog.open), false, "fermeture Escape conservée");
          await page.evaluate(fixture => window.__openLot3cQuality(false, fixture), shortFixture);
          await page.locator('#treeQualityDialog [data-close="treeQualityDialog"]').click();
          assert.equal(await page.locator("#treeQualityDialog").evaluate(dialog => dialog.open), false, "fermeture × conservée");
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});

test("Lot 3C : les classes sheet n’altèrent pas les géométries desktop", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const { context, page } = await createPage(browser, server, 1024, 768);
  try {
    await page.evaluate(users => window.__openLot3cAdmin(users), adminUsers(3));
    const adminWith = await page.locator("#adminDialog").evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: getComputedStyle(dialog).borderTopLeftRadius };
    });
    await page.locator("#adminDialog").evaluate(dialog => { dialog.close(); dialog.classList.remove("modal-mobile-sheet", "modal-mobile-sheet--stable"); dialog.showModal(); });
    const adminWithout = await page.locator("#adminDialog").evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: getComputedStyle(dialog).borderTopLeftRadius };
    });
    assert.deepEqual(adminWith, adminWithout, "Administration desktop inchangée");
    await page.locator("#adminDialog").evaluate(dialog => dialog.close());

    await page.evaluate(fixture => window.__openLot3cQuality(true, fixture), qualityFixture(true));
    const qualityWith = await page.locator("#treeQualityDialog").evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: getComputedStyle(dialog).borderTopLeftRadius };
    });
    await page.locator("#treeQualityDialog").evaluate(dialog => { dialog.close(); dialog.classList.remove("modal-mobile-sheet", "modal-mobile-sheet--long-form"); dialog.showModal(); });
    const qualityWithout = await page.locator("#treeQualityDialog").evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: getComputedStyle(dialog).borderTopLeftRadius };
    });
    assert.deepEqual(qualityWith, qualityWithout, "Tree Quality desktop inchangé");
  } finally { await context.close(); await browser.close(); await server.close(); }
});
