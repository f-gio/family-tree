import test from "node:test";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { startStaticServer, isAllowedRequest, blockedServiceFor, ROOT } from "./helpers.mjs";

async function launchOrSkip(engine, t, name) {
  try {
    return await engine.launch({ headless: true });
  } catch (error) {
    await t.test(name, child => child.skip(`Navigateur indisponible : ${error.message}`));
    return null;
  }
}

async function createDirectoryPage(browser, server, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "fr-FR",
    isMobile: width <= 760,
    hasTouch: width <= 760
  });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("topbar").hidden = false;
    document.getElementById("appMain").hidden = true;
    document.getElementById("directoryView").hidden = false;
    for (const id of ["documentsView", "tasksView", "dossiersView"]) document.getElementById(id).hidden = true;
  });
  return { context, page };
}

async function activateControl(page, selector, isMobile) {
  const control = page.locator(selector);
  if (!isMobile) return control.click();
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `${selector} accessible au toucher`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test("toolbar Annuaire : Filtres, A → Z, Liste et Cartes ont une géométrie commune", async t => {
  const browser = await launchOrSkip(chromium, t, "toolbar Annuaire");
  if (!browser) return;
  const server = await startStaticServer(ROOT);
  try {
    for (const width of [320, 390, 760]) {
      const { context, page } = await createDirectoryPage(browser, server, width, width <= 390 ? 844 : 900);
      try {
        const controls = await page.evaluate(() => {
          const elements = [
            document.getElementById("directoryFiltersBtn"),
            document.getElementById("directorySort"),
            document.querySelector('#directoryView [data-mode="list"]'),
            document.querySelector('#directoryView [data-mode="cards"]')
          ];
          return elements.map(element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              x: rect.x, y: rect.y, right: rect.right, height: rect.height,
              borderRadius: style.borderTopLeftRadius,
              borderWidth: style.borderTopWidth,
              borderStyle: style.borderTopStyle,
              borderColor: style.borderTopColor
            };
          }).concat({
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            toolbarOverflow: document.querySelector(".directory-toolbar").scrollWidth - document.querySelector(".directory-toolbar").clientWidth
          });
        });
        const [filters, sort, list, cards, overflow] = controls;
        t.diagnostic(`${width}px ${JSON.stringify(controls)}`);
        for (const control of [filters, sort, list, cards]) {
          assert.ok(Math.abs(control.height - 44) < 0.1, `${width}px : hauteur extérieure 44px`);
          assert.equal(control.borderRadius, filters.borderRadius, `${width}px : radius harmonisé`);
          assert.equal(control.borderWidth, filters.borderWidth, `${width}px : bordure harmonisée`);
          assert.equal(control.borderStyle, "solid");
          assert.equal(control.borderColor, filters.borderColor, `${width}px : couleur de bordure harmonisée`);
          assert.ok(Math.abs(control.y - filters.y) < 0.1, `${width}px : alignement vertical`);
        }
        assert.ok(filters.right <= sort.x + 0.1 && sort.right <= list.x + 0.1 && list.right <= cards.x + 0.1, `${width}px : contrôles sans collision`);
        assert.ok(sort.right - sort.x > 0, `${width}px : select A → Z conserve sa largeur flexible`);
        assert.equal(overflow.pageOverflow, 0, `${width}px : aucun overflow horizontal de page`);
        assert.equal(overflow.toolbarOverflow, 0, `${width}px : aucun overflow horizontal de toolbar`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("pastille Filtres : chiffres centrés sur toutes les largeurs", async t => {
  const browser = await launchOrSkip(chromium, t, "centrage du compteur Filtres");
  if (!browser) return;
  const server = await startStaticServer(ROOT);
  try {
    for (const width of [320, 390, 760, 1024, 1440]) {
      const { context, page } = await createDirectoryPage(browser, server, width, width <= 760 ? 844 : 900);
      try {
        const measurements = await page.evaluate(values => {
          const trigger = document.getElementById("directoryFiltersBtn");
          const badge = document.getElementById("directoryFilterCount");
          badge.hidden = false;
          return values.map(value => {
            badge.textContent = String(value);
            const pill = badge.getBoundingClientRect();
            const button = trigger.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(badge);
            const digits = range.getBoundingClientRect();
            const style = getComputedStyle(badge);
            return {
              value: String(value),
              pill: { x: pill.x, y: pill.y, width: pill.width, height: pill.height, right: pill.right, bottom: pill.bottom },
              text: { x: digits.x, y: digits.y, width: digits.width, height: digits.height, right: digits.right, bottom: digits.bottom },
              button: { x: button.x, right: button.right, width: button.width, height: button.height },
              display: style.display,
              alignItems: style.alignItems,
              justifyContent: style.justifyContent
            };
          });
        }, [1, 2, 9, 10]);
        t.diagnostic(`${width}px ${JSON.stringify(measurements.map(item => ({ value: item.value, pill: item.pill, button: item.button })))}`);
        for (const item of measurements) {
          const pillCenterX = item.pill.x + item.pill.width / 2;
          const pillCenterY = item.pill.y + item.pill.height / 2;
          const textCenterX = item.text.x + item.text.width / 2;
          const textCenterY = item.text.y + item.text.height / 2;
          assert.ok(Math.abs(pillCenterX - textCenterX) < 0.5, `${width}px, ${item.value} : chiffre centré horizontalement`);
          assert.ok(Math.abs(pillCenterY - textCenterY) < 0.5, `${width}px, ${item.value} : chiffre centré verticalement`);
          assert.equal(item.pill.height, 20, `${width}px, ${item.value} : hauteur de pastille conservée`);
          assert.ok(item.pill.width >= 20, `${width}px, ${item.value} : largeur minimale conservée`);
          assert.ok(item.pill.x >= item.button.x && item.pill.right <= item.button.right, `${width}px, ${item.value} : pastille contenue dans son bouton`);
          assert.equal(item.display, "flex", `${width}px, ${item.value} : centrage structurel flex`);
          assert.equal(item.alignItems, "center");
          assert.equal(item.justifyContent, "center");
        }
        assert.ok(measurements.every(item => item.button.height === measurements[0].button.height), `${width}px : hauteur du bouton Filtres inchangée pour 1/2/9/10`);
        assert.ok(Math.max(...measurements.map(item => item.button.width)) - Math.min(...measurements.map(item => item.button.width)) < 0.1, `${width}px : largeur du bouton Filtres inchangée pour 1/2/9/10`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
});

async function assertFilterDialog(browser, server, width, height, isMobile) {
  const { context, page } = await createDirectoryPage(browser, server, width, height);
  try {
    await activateControl(page, "#directoryFiltersBtn", isMobile);
    assert.equal(await page.locator("#directoryFilterDialog").evaluate(dialog => dialog.open), true, `${width}px : ouverture de la modale`);
    await page.waitForTimeout(220);

    const beforeScroll = await page.evaluate(() => {
      const dialog = document.getElementById("directoryFilterDialog");
      const box = element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const content = document.querySelector(".directory-filter-content");
      const dialogStyle = getComputedStyle(dialog);
      const backdropStyle = getComputedStyle(dialog, "::backdrop");
      const contentStyle = getComputedStyle(content);
      const header = document.querySelector(".directory-filter-header");
      const footer = document.querySelector(".directory-filter-footer");
      const closeButton = document.getElementById("closeDirectoryFiltersBtn");
      const yearFields = [...content.querySelectorAll(".filter-year-row .field")];
      return {
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        dialog: box(dialog),
        dialogRadii: [dialogStyle.borderTopLeftRadius, dialogStyle.borderTopRightRadius, dialogStyle.borderBottomRightRadius, dialogStyle.borderBottomLeftRadius],
        backdropColor: backdropStyle.backgroundColor,
        header: box(header),
        content: box(content),
        footer: box(footer),
        closeButton: box(closeButton),
        dialogOverflow: dialogStyle.overflow,
        contentOverflowY: contentStyle.overflowY,
        contentOverflowX: contentStyle.overflowX,
        scrollbarWidth: contentStyle.scrollbarWidth,
        webkitScrollbarDisplay: getComputedStyle(content, "::-webkit-scrollbar").display,
        contentScrollHeight: content.scrollHeight,
        contentClientHeight: content.clientHeight,
        contentScrollRange: content.scrollHeight - content.clientHeight,
        fieldHeight: document.getElementById("directoryFirstNameFilter").getBoundingClientRect().height,
        contentGridColumns: contentStyle.gridTemplateColumns,
        yearFieldWidths: yearFields.map(field => field.getBoundingClientRect().width),
        title: document.getElementById("directoryFilterTitle").textContent,
        footerLabels: [...footer.querySelectorAll("button")].map(button => button.textContent.trim()),
        activeElement: document.activeElement.id,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert.ok(beforeScroll.dialog.x >= -0.5 && beforeScroll.dialog.right <= beforeScroll.viewport.width + 0.5, `${width}px : fenêtre contenue horizontalement`);
    assert.ok(beforeScroll.dialog.y >= -0.5 && beforeScroll.dialog.bottom <= beforeScroll.viewport.height + 0.5, `${width}px : fenêtre contenue verticalement`);
    assert.equal(beforeScroll.dialogOverflow, "hidden", `${width}px : la boîte modale ne défile pas`);
    assert.equal(beforeScroll.contentOverflowY, "auto", `${width}px : le contenu central est scrollable`);
    assert.equal(beforeScroll.contentOverflowX, "hidden", `${width}px : aucun scroll horizontal interne`);
    assert.equal(beforeScroll.scrollbarWidth, "none", `${width}px : scrollbar masquée via scrollbar-width`);
    assert.equal(beforeScroll.webkitScrollbarDisplay, "none", `${width}px : scrollbar masquée via pseudo-élément WebKit/Chromium`);
    assert.equal(beforeScroll.pageOverflow, 0, `${width}px : aucun overflow horizontal de page`);
    assert.ok(beforeScroll.header.bottom <= beforeScroll.content.y + 0.5, `${width}px : header séparé du contenu scrollable`);
    assert.ok(beforeScroll.content.bottom <= beforeScroll.footer.y + 0.5, `${width}px : footer séparé du contenu scrollable`);
    assert.ok(beforeScroll.contentScrollHeight > beforeScroll.contentClientHeight, `${width}px : contenu des critères défilant`);
    assert.ok(beforeScroll.fieldHeight >= (isMobile ? 52 : 42), `${width}px : champ utilisable`);
    assert.ok(beforeScroll.closeButton.width >= 44 && beforeScroll.closeButton.height >= 44, `${width}px : cible tactile × de 44px`);
    assert.equal(beforeScroll.activeElement, "closeDirectoryFiltersBtn", `${width}px : focus initial sur la fermeture accessible`);
    assert.equal(beforeScroll.title, "Filtres", `${width}px : titre de fenêtre principal`);
    assert.deepEqual(beforeScroll.footerLabels, ["Réinitialiser", "Afficher les résultats"], `${width}px : actions fixes conservées`);
    if (isMobile) {
      const backgroundFocus = await page.evaluate(() => {
        document.getElementById("directorySearch").focus();
        return document.activeElement?.closest("#directoryFilterDialog")?.id || "";
      });
      assert.equal(backgroundFocus, "directoryFilterDialog", `${width}px : le contenu derrière la modale reste inerte au focus`);
    } else {
      const pageScrollBefore = await page.evaluate(() => window.scrollY);
      await page.mouse.move(beforeScroll.header.x + beforeScroll.header.width / 2, beforeScroll.header.y + beforeScroll.header.height / 2);
      await page.mouse.wheel(0, 240);
      assert.equal(await page.evaluate(() => window.scrollY), pageScrollBefore, `${width}px : le document derrière la modale ne défile pas`);
    }
    if (isMobile) {
      assert.ok(Math.abs(beforeScroll.dialog.x) < 0.5, `${width}px : panneau mobile aligné aux bords latéraux`);
      assert.ok(beforeScroll.dialog.y >= beforeScroll.viewport.height * 0.06 && beforeScroll.dialog.y <= beforeScroll.viewport.height * 0.1, `${width}px : bande de page visible au-dessus du panneau`);
      assert.ok(Math.abs(beforeScroll.dialog.bottom - beforeScroll.viewport.height) < 1, `${width}px : panneau collé au bas du viewport`);
      assert.ok(Math.abs(beforeScroll.dialog.width - beforeScroll.viewport.width) < 1, `${width}px : panneau mobile pleine largeur`);
      assert.ok(Math.abs(beforeScroll.dialog.height - beforeScroll.viewport.height * 0.92) < 2, `${width}px : panneau mobile haut de 92dvh`);
      assert.deepEqual(beforeScroll.dialogRadii, ["22px", "22px", "0px", "0px"], `${width}px : seuls les coins supérieurs sont arrondis`);
      assert.match(beforeScroll.backdropColor, /0\.42/, `${width}px : backdrop natif à transparence modérée`);
      assert.ok(beforeScroll.fieldHeight >= 52 && beforeScroll.fieldHeight <= 56, `${width}px : champs compacts de 52–56px`);
      assert.ok(beforeScroll.yearFieldWidths.every(fieldWidth => fieldWidth >= 110), `${width}px : champs Dé/À restent confortables côte à côte`);
      assert.equal(beforeScroll.contentGridColumns.split(" ").length, 1, `${width}px : critères principaux sur une colonne`);
    } else {
      assert.ok(Math.abs((beforeScroll.dialog.x + beforeScroll.dialog.width / 2) - beforeScroll.viewport.width / 2) < 1, `${width}px : modale desktop centrée horizontalement`);
      assert.ok(Math.abs((beforeScroll.dialog.y + beforeScroll.dialog.height / 2) - beforeScroll.viewport.height / 2) < 1, `${width}px : modale desktop centrée verticalement`);
      assert.ok(beforeScroll.dialog.width <= 640, `${width}px : largeur desktop confortable plafonnée`);
      assert.equal(beforeScroll.contentGridColumns.split(" ").length, 2, `${width}px : colonnes utiles conservées sur desktop`);
      await page.mouse.click(2, 2);
      assert.equal(await page.locator("#directoryFilterDialog").evaluate(dialog => dialog.open), true, `${width}px : clic backdrop ne modifie pas la fermeture existante`);
    }

    if (!isMobile) {
      await page.evaluate(() => { document.querySelector(".directory-filter-content").scrollTop = 0; });
      const contentArea = page.locator(".directory-filter-content");
      await contentArea.hover();
      await page.mouse.wheel(0, 360);
      await page.waitForTimeout(80);
      const wheelScrollTop = await contentArea.evaluate(content => content.scrollTop);
      assert.ok(wheelScrollTop > 0, `${width}px : molette/trackpad fait défiler le contenu malgré la scrollbar masquée (scrollTop ${wheelScrollTop}/${beforeScroll.contentScrollRange})`);
    }
    await page.evaluate(() => { document.querySelector(".directory-filter-content").scrollTop = 80; });
    const afterScroll = await page.evaluate(() => {
      const box = element => {
        const rect = element.getBoundingClientRect();
        return { y: rect.y, bottom: rect.bottom };
      };
      return {
        header: box(document.querySelector(".directory-filter-header")),
        content: box(document.querySelector(".directory-filter-content")),
        footer: box(document.querySelector(".directory-filter-footer")),
        scrollTop: document.querySelector(".directory-filter-content").scrollTop
      };
    });
    assert.ok(afterScroll.scrollTop > 0, `${width}px : le contenu seul a défilé`);
    assert.equal(afterScroll.scrollTop, Math.min(80, beforeScroll.contentScrollRange), `${width}px : le déplacement reste borné au contenu central`);
    assert.ok(Math.abs(afterScroll.header.y - beforeScroll.header.y) < 0.5, `${width}px : header fixe`);
    assert.ok(Math.abs(afterScroll.footer.y - beforeScroll.footer.y) < 0.5, `${width}px : footer fixe`);

    await page.locator("#directoryFirstNameFilter").fill("Rossi");
    await activateControl(page, "#clearDirectoryFiltersBtn", isMobile);
    assert.equal(await page.locator("#directoryFirstNameFilter").inputValue(), "", `${width}px : Réinitialiser conserve sa fonction`);
    await activateControl(page, "#applyDirectoryFiltersBtn", isMobile);
    assert.equal(await page.locator("#directoryFilterDialog").evaluate(dialog => dialog.open), false, `${width}px : Afficher les résultats ferme la modale`);
    assert.equal(await page.evaluate(() => document.activeElement.id), "directoryFiltersBtn", `${width}px : focus rendu au déclencheur`);

    await activateControl(page, "#directoryFiltersBtn", isMobile);
    await activateControl(page, "#closeDirectoryFiltersBtn", isMobile);
    assert.equal(await page.locator("#directoryFilterDialog").evaluate(dialog => dialog.open), false, `${width}px : bouton × ferme la modale`);
    assert.equal(await page.evaluate(() => document.activeElement.id), "directoryFiltersBtn", `${width}px : focus restauré après ×`);

    await activateControl(page, "#directoryFiltersBtn", isMobile);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#directoryFilterDialog").evaluate(dialog => dialog.open), false, `${width}px : Escape ferme la modale`);
    assert.equal(await page.evaluate(() => document.activeElement.id), "directoryFiltersBtn", `${width}px : focus restauré après Escape`);
  } finally {
    await context.close();
  }
}

test("modale Filtres responsive : WebKit tactile mobile et Chrome desktop", async t => {
  const webkitBrowser = await launchOrSkip(webkit, t, "modale Filtres WebKit tactile");
  const chromiumBrowser = await launchOrSkip(chromium, t, "modale Filtres Chrome desktop");
  if (!webkitBrowser && !chromiumBrowser) return;
  const server = await startStaticServer(ROOT);
  try {
    if (webkitBrowser) {
      for (const [width, height] of [[320, 568], [390, 844], [760, 900]]) {
        await t.test(`WebKit ${width}×${height}`, () => assertFilterDialog(webkitBrowser, server, width, height, true));
      }
    }
    if (chromiumBrowser) {
      for (const [width, height] of [[761, 760], [1024, 600], [1024, 768], [1440, 900]]) {
        await t.test(`Chrome 100 % ${width}×${height}`, () => assertFilterDialog(chromiumBrowser, server, width, height, false));
      }
    }
  } finally {
    await webkitBrowser?.close();
    await chromiumBrowser?.close();
    await server.close();
  }
});

test("modale Filtres : backdrop natif et fermeture sans handler de clic ajouté", async () => {
  const app = await (await import("node:fs/promises")).readFile(new URL("../js/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /directoryFilterDialog[^;]{0,100}addEventListener\(["']click["']/);
  assert.match(app, /function closeDirectoryFilterDialog\(\)[\s\S]*?dialog\.close\(\)/);
  assert.match(app, /dialog\.showModal\(\)/);
});
