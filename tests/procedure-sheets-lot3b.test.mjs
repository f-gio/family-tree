import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const mobileViewports = [[320, 844], [390, 844], [760, 900]];

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
        body: `${await response.text()}\nwindow.__openLot3bAction = (item = null) => { activeDossierId = "lot3b-ui-test"; openProcedureAction(item); };\nwindow.__openLot3bTask = (item = null) => { openTask(item); };`
      })).catch(() => {});
    }
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  await page.goto(server.baseURL, { waitUntil: "load" });
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

async function openDetail(page, long = false) {
  await page.evaluate(isLong => {
    const content = document.getElementById("procedureDetailContent");
    const timeline = document.getElementById("procedureTimeline");
    content.innerHTML = isLong
      ? Array.from({ length: 7 }, (_, index) => `<section class="procedure-detail-block"><h4>Information ${index + 1}</h4><p>${"Détail généalogique utile. ".repeat(14)}</p></section>`).join("")
      : '<section class="procedure-detail-block"><h4>Objectif</h4><p>Consulter un registre ancien.</p></section>';
    timeline.innerHTML = isLong
      ? Array.from({ length: 10 }, (_, index) => `<article class="procedure-action-item"><span class="procedure-action-stamp">${index + 1} juin 2025</span><span class="procedure-action-type">Note</span><p class="procedure-action-text">${"Échange avec le service des archives. ".repeat(12)}</p></article>`).join("")
      : '<article class="procedure-action-item"><span class="procedure-action-stamp">1 juin 2025</span><span class="procedure-action-type">Note</span><p class="procedure-action-text">Premier contact avec les archives.</p></article>';
    const dialog = document.getElementById("procedureDetailDialog");
    dialog.showModal();
    dialog.getBoundingClientRect();
    dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish());
  }, long);
  await page.waitForTimeout(40);
}

async function measureDetail(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById("procedureDetailDialog");
    const body = dialog.querySelector(":scope > .modal-body");
    const content = body.querySelector(":scope > .modal-scroll");
    const head = dialog.querySelector(":scope > .modal-head");
    const footer = dialog.querySelector(":scope > .modal-actions");
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const bodyStyle = getComputedStyle(body);
    const contentStyle = getComputedStyle(content);
    return {
      dialog: box(dialog), head: box(head), body: box(body), content: box(content), footer: box(footer),
      maxHeight: getComputedStyle(dialog).maxHeight,
      radius: getComputedStyle(dialog).borderTopLeftRadius,
      backdrop: getComputedStyle(dialog, "::backdrop").backgroundColor,
      headPaddingTop: parseFloat(getComputedStyle(head).paddingTop),
      footerPaddingBottom: parseFloat(getComputedStyle(footer).paddingBottom),
      footerButtons: [...footer.querySelectorAll(".right > .btn:not([hidden])")].map(button => {
        const rect = button.getBoundingClientRect();
        return { height: rect.height, minHeight: getComputedStyle(button).minHeight };
      }),
      closeButton: box(head.querySelector("[data-close]")),
      bodyScroll: { height: body.scrollHeight, client: body.clientHeight, top: body.scrollTop, overflowY: bodyStyle.overflowY, overflowX: bodyStyle.overflowX, scrollbarWidth: bodyStyle.scrollbarWidth, webkitScrollbar: getComputedStyle(body, "::-webkit-scrollbar").display },
      nestedScroll: { overflowY: contentStyle.overflowY, top: content.scrollTop },
      viewport: { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight }
    };
  });
}

async function openAction(page, long = false) {
  await page.evaluate(isLong => {
    const dialog = document.getElementById("procedureActionDialog");
    const type = document.getElementById("procedureActionType");
    const form = document.getElementById("procedureActionForm");
    form.querySelector("[data-lot3b-filler]")?.remove();
    form.querySelectorAll("label").forEach(label => { label.hidden = false; });
    type.value = isLong ? "email-sent" : "note";
    type.dispatchEvent(new Event("change", { bubbles: true }));
    if (!isLong) {
      for (const id of ["procedureActionDate", "procedureActionDirection", "procedureActionTitleField", "procedureActionAuthor"]) {
        document.getElementById(id).closest("label").hidden = true;
      }
    } else {
      document.getElementById("procedureActionEmailFull").value = "Message de test. ".repeat(180);
      const filler = document.createElement("div");
      filler.dataset.lot3bFiller = "true";
      filler.setAttribute("aria-hidden", "true");
      filler.style.height = "900px";
      document.querySelector("#procedureActionForm .modal-scroll").append(filler);
    }
    dialog.showModal();
    dialog.getBoundingClientRect();
    dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish());
  }, long);
  await page.waitForTimeout(40);
}

async function openActionViaApp(page, mode, long = false) {
  await page.evaluate(({ mode: kind, long: isLong }) => {
    for (const id of ["procedureActionDialog", "taskDialog"]) {
      const dialog = document.getElementById(id);
      if (dialog.open) dialog.close();
    }
    const action = kind === "edit" ? {
      id: "lot3b-edit-action",
      type: isLong ? "email-sent" : "note",
      date: "2025-06-01",
      direction: "none",
      title: "Action de chronologie",
      text: isLong ? "Message de test. ".repeat(180) : "Premier contact avec les archives.",
      author: "François"
    } : null;
    window.__openLot3bAction(action);
    if (isLong) {
      const filler = document.createElement("div");
      filler.dataset.lot3bFiller = "true";
      filler.setAttribute("aria-hidden", "true");
      filler.style.height = "900px";
      document.querySelector("#procedureActionForm .modal-scroll").append(filler);
    }
    const dialog = document.getElementById("procedureActionDialog");
    dialog.getBoundingClientRect();
    dialog.getAnimations({ subtree: true }).forEach(animation => animation.finish());
  }, { mode, long });
  await page.waitForTimeout(60);
}

async function measureAction(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById("procedureActionDialog");
    const form = document.getElementById("procedureActionForm");
    const scroller = form.querySelector(":scope > .modal-scroll");
    const head = dialog.querySelector(":scope > .modal-head");
    const footer = form.querySelector(":scope > .modal-actions");
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const scrollStyle = getComputedStyle(scroller);
    return {
      dialog: box(dialog), head: box(head), form: box(form), scroller: box(scroller), footer: box(footer),
      maxHeight: getComputedStyle(dialog).maxHeight,
      radius: getComputedStyle(dialog).borderTopLeftRadius,
      backdrop: getComputedStyle(dialog, "::backdrop").backgroundColor,
      headPaddingTop: parseFloat(getComputedStyle(head).paddingTop),
      scroll: { height: scroller.scrollHeight, client: scroller.clientHeight, top: scroller.scrollTop, overflowY: scrollStyle.overflowY, overflowX: scrollStyle.overflowX, scrollbarWidth: scrollStyle.scrollbarWidth, webkitScrollbar: getComputedStyle(scroller, "::-webkit-scrollbar").display },
      footerPaddingBottom: parseFloat(getComputedStyle(footer).paddingBottom),
      buttons: [...footer.querySelectorAll(".right > .btn:not([hidden])")].map(button => {
        const rect = button.getBoundingClientRect();
        return { y: rect.y, height: rect.height, minHeight: getComputedStyle(button).minHeight };
      }),
      viewport: { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight }
    };
  });
}

test("Lot 3B : détail Démarches reste stable, scrollable au centre et fermable", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const [width, height] of mobileViewports) {
      await t.test(`${width}×${height}`, async child => {
        const { context, page } = await createPage(browser, server, width, height);
        try {
          await openDetail(page, false);
          const short = await measureDetail(page);
          await openDetail(page, true);
          const long = await measureDetail(page);
          child.diagnostic(`${width}×${height}: détail court=${short.dialog.height}px / long=${long.dialog.height}px / attendu=${height * 0.92}px`);
          assert.ok(Math.abs(long.dialog.height - height * 0.92) < 0.5, "hauteur stable de 92dvh");
          assert.ok(Math.abs(short.dialog.height - long.dialog.height) < 1, "la hauteur ne varie pas avec le contenu");
          assert.ok(short.dialog.y > 0 && Math.abs(short.dialog.bottom - height) < 1, "contenu court avec fond visible derrière");
          assert.ok(long.dialog.y > 0 && Math.abs(long.dialog.bottom - height) < 1, "sheet ancrée en bas avec fond visible derrière");
          assert.ok(long.head.height >= 44 && Math.abs(long.head.bottom - long.body.y) < 1, "header fixe avant le contenu");
          assert.ok(long.headPaddingTop >= 16, "safe-area supérieure du header respectée");
          assert.ok(Math.abs(long.body.bottom - long.footer.y) < 1 && long.footer.bottom <= height + 1, "footer fixe et accessible");
          assert.ok(long.footerPaddingBottom >= 12, "safe-area basse réservée au footer");
          assert.ok(long.footerButtons.length === 2 && long.footerButtons.every(button => button.height >= 44 && button.minHeight === "44px"), "actions footer ≥44px");
          assert.ok(long.closeButton.width >= 44 && long.closeButton.height >= 44, "fermeture × tactile ≥44px");
          assert.ok(long.bodyScroll.height > long.bodyScroll.client, "le corps central défile pour le contenu long");
          assert.equal(long.bodyScroll.overflowY, "auto");
          assert.equal(long.bodyScroll.scrollbarWidth, "none");
          assert.equal(long.bodyScroll.webkitScrollbar, "none");
          assert.equal(long.nestedScroll.overflowY, "visible", "pas de scroll imbriqué dans le contenu");
          assert.ok(parseFloat(long.radius) > 0, "coins supérieurs arrondis");
          assert.match(long.backdrop, /0\.42/);
          assert.equal(long.viewport.scrollWidth, width, "aucun overflow horizontal");
          await page.locator("#procedureDetailDialog > .modal-body").evaluate(body => { body.scrollTop = 220; });
          const afterScroll = await measureDetail(page);
          assert.ok(afterScroll.bodyScroll.top > 0, "le corps central accepte le scroll");
          assert.deepEqual(afterScroll.head, long.head, "header stable pendant le scroll");
          assert.deepEqual(afterScroll.footer, long.footer, "footer stable pendant le scroll");
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#procedureDetailDialog").evaluate(dialog => dialog.open), false, "fermeture Escape préservée");
          await openDetail(page, false);
          await page.evaluate(() => window.__openLot3bAction());
          assert.equal(await page.locator("#procedureActionDialog").evaluate(dialog => dialog.open), true, "Ajouter une action ouvre sa modale au-dessus du détail");
          await page.locator('#procedureActionForm [data-close="procedureActionDialog"]').click();
          assert.equal(await page.locator("#procedureDetailDialog").evaluate(dialog => dialog.open), true, "Annuler l’action conserve le détail ouvert");
          await page.locator('#procedureDetailDialog [data-close="procedureDetailDialog"]').last().click();
          assert.equal(await page.locator("#procedureDetailDialog").evaluate(dialog => dialog.open), false, "bouton Fermer préservé");
          child.diagnostic(`${width}×${height}: court=${short.dialog.height.toFixed(1)}px, long=${long.dialog.height.toFixed(1)}px, top=${long.dialog.y.toFixed(1)}px, header=${long.head.height.toFixed(1)}px, corps=${long.body.height.toFixed(1)}px, footer=${long.footer.height.toFixed(1)}px`);
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});

test("Lot 3B : action Démarches en sheet stable 92dvh (création, modification, court, long)", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const [width, height] of mobileViewports) {
      await t.test(`${width}×${height}`, async child => {
        const { context, page } = await createPage(browser, server, width, height);
        try {
          const target = height * 0.92;
          await openActionViaApp(page, "create", false);
          const createShort = await measureAction(page);
          await openActionViaApp(page, "create", true);
          const createLong = await measureAction(page);
          await openActionViaApp(page, "edit", false);
          const editShort = await measureAction(page);
          await openActionViaApp(page, "edit", true);
          const editLong = await measureAction(page);
          child.diagnostic(`${width}×${height}: création court=${createShort.dialog.height.toFixed(1)} / long=${createLong.dialog.height.toFixed(1)} ; modification court=${editShort.dialog.height.toFixed(1)} / long=${editLong.dialog.height.toFixed(1)} ; cible=${target.toFixed(1)}px`);
          for (const [label, m] of [["création court", createShort], ["création long", createLong], ["modification court", editShort], ["modification long", editLong]]) {
            assert.ok(Math.abs(m.dialog.height - target) < 1, `${label} = 92dvh (${m.dialog.height.toFixed(1)} / ${target.toFixed(1)})`);
            assert.ok(Math.abs(parseFloat(m.maxHeight) - target) < 1, `${label} max-height 92dvh (${m.maxHeight})`);
            assert.ok(m.dialog.y > 0 && Math.abs(m.dialog.bottom - height) < 1, `${label} ancrée en bas, page visible derrière`);
            assert.ok(Math.abs(m.head.bottom - m.form.y) < 1, `${label} header fixe`);
            assert.ok(m.headPaddingTop >= 16, `${label} safe-area header`);
            assert.ok(Math.abs(m.scroller.bottom - m.footer.y) < 1 && m.footer.bottom <= height + 1, `${label} footer fixe et accessible`);
            assert.ok(m.footerPaddingBottom >= 12, `${label} safe-area footer`);
            assert.ok(m.buttons.length === 2 && m.buttons.every(button => button.height >= 44 && button.minHeight === "44px"), `${label} CTA ≥44px`);
            assert.equal(m.scroll.overflowY, "auto", `${label} scroll vertical`);
            assert.equal(m.scroll.scrollbarWidth, "none", `${label} scrollbar masquée`);
            assert.equal(m.viewport.scrollWidth, width, `${label} aucun overflow horizontal`);
          }
          assert.ok(Math.abs(createShort.dialog.height - createLong.dialog.height) < 1, "création : hauteur stable court/long");
          assert.ok(Math.abs(editShort.dialog.height - editLong.dialog.height) < 1, "modification : hauteur stable court/long");
          assert.ok(Math.abs(createShort.dialog.y - editShort.dialog.y) < 1, "même top création/modification");
          assert.ok(Math.abs(createShort.dialog.bottom - editShort.dialog.bottom) < 1, "même bottom création/modification");
          // scroll central + dernier champ accessible (dialogue encore en modification longue)
          assert.ok(editLong.scroll.height > editLong.scroll.client, "contenu long défilable");
          await page.locator("#procedureActionForm .modal-scroll").evaluate(scroller => { scroller.scrollTop = scroller.scrollHeight; });
          await page.waitForTimeout(40);
          const afterScroll = await measureAction(page);
          const authorVisible = await page.evaluate(() => {
            const author = document.getElementById("procedureActionAuthor").closest("label").getBoundingClientRect();
            const footer = document.querySelector("#procedureActionForm .modal-actions").getBoundingClientRect();
            return author.bottom <= footer.top + 1 && author.height > 0;
          });
          assert.ok(afterScroll.scroll.top > 0, "scroll central accepté");
          assert.ok(authorVisible, "dernier champ (Auteur) accessible au-dessus du footer");
          assert.deepEqual(afterScroll.head, editLong.head, "header stable pendant le scroll");
          assert.deepEqual(afterScroll.footer, editLong.footer, "footer stable pendant le scroll");
          // comparaison avec la feuille Action standard #taskDialog
          await page.evaluate(() => { window.__openLot3bTask(null); });
          await page.waitForTimeout(60);
          const taskGeometry = await page.evaluate(() => {
            const dialog = document.getElementById("taskDialog");
            const rect = dialog.getBoundingClientRect();
            return { height: rect.height, y: rect.y, bottom: rect.bottom, maxHeight: getComputedStyle(dialog).maxHeight };
          });
          child.diagnostic(`${width}×${height}: taskDialog ref height=${taskGeometry.height.toFixed(1)} y=${taskGeometry.y.toFixed(1)} vs procedureAction createShort height=${createShort.dialog.height.toFixed(1)} y=${createShort.dialog.y.toFixed(1)}`);
          assert.ok(Math.abs(taskGeometry.height - createShort.dialog.height) < 1, "H identique à #taskDialog à ±1px");
          assert.ok(Math.abs(taskGeometry.y - createShort.dialog.y) < 1, "top identique à #taskDialog à ±1px");
          await page.keyboard.press("Escape");
          await page.evaluate(() => { document.getElementById("taskDialog")?.close(); });
          await openActionViaApp(page, "edit", false);
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#procedureActionDialog").evaluate(dialog => dialog.open), false, "fermeture Escape");
          await openActionViaApp(page, "create", false);
          await page.locator('#procedureActionForm [data-close="procedureActionDialog"]').click();
          assert.equal(await page.locator("#procedureActionDialog").evaluate(dialog => dialog.open), false, "Annuler ferme la modale");
          child.diagnostic(`${width}×${height}: court=${createShort.dialog.height.toFixed(1)}px, long=${createLong.dialog.height.toFixed(1)}px, top=${createShort.dialog.y.toFixed(1)}px, header=${createShort.head.height.toFixed(1)}px, zone=${createLong.scroller.height.toFixed(1)}px, footer=${createShort.footer.height.toFixed(1)}px`);
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});

test("Lot 3B : action Démarches 92dvh sous WebKit (création + modification)", async t => {
  let browser;
  try { browser = await webkit.launch({ headless: true }); }
  catch (error) { t.skip(`WebKit indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  try {
    for (const [width, height] of mobileViewports) {
      await t.test(`WebKit ${width}×${height}`, async child => {
        const { context, page } = await createPage(browser, server, width, height);
        try {
          const target = height * 0.92;
          const results = {};
          for (const [label, mode, long] of [["create-short", "create", false], ["create-long", "create", true], ["edit-short", "edit", false], ["edit-long", "edit", true]]) {
            await openActionViaApp(page, mode, long);
            const m = await measureAction(page);
            results[label] = m;
            assert.ok(Math.abs(m.dialog.height - target) < 1, `${label} = 92dvh (${m.dialog.height.toFixed(1)} / ${target.toFixed(1)})`);
            assert.ok(Math.abs(parseFloat(m.maxHeight) - target) < 1, `${label} max-height 92dvh`);
            assert.ok(m.dialog.y > 0 && Math.abs(m.dialog.bottom - height) < 1, `${label} ancrée en bas`);
            assert.ok(Math.abs(m.scroller.bottom - m.footer.y) < 1 && m.footer.bottom <= height + 1, `${label} footer accessible`);
            assert.ok(m.buttons.length === 2 && m.buttons.every(button => button.height >= 44), `${label} CTA ≥44px`);
            assert.equal(m.viewport.scrollWidth, width, `${label} aucun overflow horizontal`);
          }
          assert.ok(Math.abs(results["create-short"].dialog.height - results["edit-short"].dialog.height) < 1, "création/modification même H");
          assert.ok(Math.abs(results["create-short"].dialog.y - results["edit-short"].dialog.y) < 1, "création/modification même top");
          child.diagnostic(`WebKit ${width}×${height}: createShort=${results["create-short"].dialog.height.toFixed(1)} editShort=${results["edit-short"].dialog.height.toFixed(1)} createLong=${results["create-long"].dialog.height.toFixed(1)} editLong=${results["edit-long"].dialog.height.toFixed(1)} target=${target.toFixed(1)}`);
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); await server.close(); }
});

test("Lot 3B : les classes mobiles ne changent pas les modales Démarches sur desktop", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const { context, page } = await createPage(browser, server, 1024, 768);
  try {
    for (const id of ["procedureDetailDialog", "procedureActionDialog"]) {
      await page.locator(`#${id}`).evaluate(dialog => dialog.showModal());
      const withClasses = await page.locator(`#${id}`).evaluate(dialog => {
        const rect = dialog.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: getComputedStyle(dialog).borderTopLeftRadius };
      });
      await page.locator(`#${id}`).evaluate(dialog => {
        dialog.close();
        dialog.classList.remove("modal-mobile-sheet", "modal-mobile-sheet--stable", "modal-mobile-sheet--form");
        dialog.showModal();
      });
      const withoutClasses = await page.locator(`#${id}`).evaluate(dialog => {
        const rect = dialog.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: getComputedStyle(dialog).borderTopLeftRadius };
      });
      assert.deepEqual(withClasses, withoutClasses, `${id} garde sa géométrie desktop`);
      await page.locator(`#${id}`).evaluate(dialog => dialog.close());
      t.diagnostic(`${id} desktop : ${JSON.stringify(withClasses)}`);
    }
  } finally { await context.close(); await browser.close(); await server.close(); }
});
