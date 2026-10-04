import assert from "node:assert/strict";
import test from "node:test";
import { webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

test("Annuaire en cartes : menu près de l’identité et documents en pied, sans chevauchement", async t => {
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (error) {
    throw new Error(`WebKit indisponible : ${error.message}`);
  }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 390, height: 844 } });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url.endsWith("/js/app.js")) {
      const response = await route.fetch();
      const source = await response.text();
      return route.fulfill({
        response,
        body: `${source}\nwindow.__renderDirectoryCardsFixture = mode => { people = [{ id: "botton", firstName: "Marie-Joséphine", lastName: "Botton", photoUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", birthDateInfo: { type: "between", from: 1901, to: 1902 }, deathDateInfo: { type: "unknown" } }, { id: "conti", firstName: "Robert", middleName: "Louis Albert", lastName: "Conti", birthDateInfo: { type: "exact", value: "1939-04-13" }, deathDateInfo: { type: "exact", value: "2016-02-17" } }, { id: "giovannoni", firstName: "Carlo", middleName: "Andrea Rolando", lastName: "Giovannoni", birthDateInfo: { type: "about", year: 1898 }, deathDateInfo: { type: "unknown" } }, { id: "unknown", firstName: "Ada", lastName: "Rossi", birthDateInfo: { type: "unknown" }, deathDateInfo: { type: "unknown" } }]; documents = [{ id: "d1", personIds: ["conti"] }, { id: "d2", personIds: ["giovannoni"] }, { id: "d3", personIds: ["giovannoni"] }]; viewModes.directory = mode || "cards"; renderDirectory(); };`
      });
    }
    return url.startsWith(server.baseURL) || url.includes("gstatic.com")
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__renderDirectoryCardsFixture === "function");
    await page.evaluate(() => {
      document.getElementById("authScreen").hidden = true;
      document.getElementById("topbar").hidden = false;
      for (const id of ["appMain", "documentsView", "tasksView", "dossiersView"]) document.getElementById(id).hidden = true;
      document.getElementById("directoryView").hidden = false;
      window.__renderDirectoryCardsFixture();
    });

    for (const width of [320, 390, 760, 1024]) {
      await t.test(`${width} px`, async tViewport => {
        await page.setViewportSize({ width, height: width <= 390 ? 844 : width === 760 ? 900 : 768 });
        const cards = await page.evaluate(() => [...document.querySelectorAll("#directoryList.cards-mode .directory-entry")].map(card => {
          const box = element => {
            const rect = element.getBoundingClientRect();
            return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
          };
          const main = card.querySelector(".directory-main");
          const menu = card.querySelector(".directory-entry-menu");
          const menuButton = card.querySelector("[data-tile-menu-toggle]");
          const documents = card.querySelector(".directory-entry-documents");
          const documentAction = documents.querySelector(".directory-doc-action");
          const dateLines = [...card.querySelectorAll(".directory-birth-date, .directory-death-date")];
          const dateDivider = card.querySelector(".directory-life-divider");
          const mainHeading = main.querySelector("h3");
          card.style.contentVisibility = "visible";
          return {
            name: mainHeading.textContent,
            card: box(card),
            avatar: box(card.querySelector(".directory-avatar")),
            hasPhoto: !!card.querySelector(".directory-avatar img"),
            main: box(main),
            heading: box(mainHeading),
            headingLineHeight: parseFloat(getComputedStyle(mainHeading).lineHeight),
            menu: box(menu),
            menuButton: box(menuButton),
            menuLabel: menuButton.getAttribute("aria-label"),
            documents: box(documents),
            documentAction: box(documentAction),
            documentLabel: documentAction.getAttribute("aria-label"),
            count: documentAction.querySelector(".directory-doc-count-value")?.textContent,
            documentTagName: documentAction.tagName,
            documentJustifyContent: getComputedStyle(documents).justifyContent,
            documentContentCenter: (() => { const rect = documents.getBoundingClientRect(); const style = getComputedStyle(documents); const top = parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth); return rect.y + top + (rect.height - top) / 2; })(),
            dateLines: dateLines.map(line => ({ box: box(line), text: line.textContent.replace(/\s+/g, " ").trim() })),
            nameToBirthGap: dateLines[0].getBoundingClientRect().y - mainHeading.getBoundingClientRect().bottom,
            dateDividerDisplay: getComputedStyle(dateDivider).display,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
          };
        }));
        tViewport.diagnostic(JSON.stringify(cards));
        assert.equal(cards.length, 4, "quatre fiches de démonstration sont rendues");
        for (const card of cards) {
          assert.ok(card.main.right <= card.menu.x + 0.1, "colonne du nom séparée de celle du menu");
          assert.ok(card.documents.y >= Math.max(card.main.bottom, card.avatar.bottom, card.menu.bottom) - 0.1, "documents sous le bloc identité/menu");
          assert.ok(Math.abs(card.documentAction.x - card.avatar.x) < 1, "documents alignés sur le padding intérieur de la carte");
          assert.ok(card.documentAction.x >= card.documents.x && card.documentAction.right <= card.documents.right + 0.1, "action Documents contenue dans son pied");
          assert.ok(Math.abs((card.documentAction.y + card.documentAction.height / 2) - card.documentContentCenter) < 1, "action Documents centrée verticalement sous le séparateur");
          assert.equal(card.documentJustifyContent, "flex-start", "action Documents alignée à gauche");
          assert.ok(card.menuButton.width >= 44 && card.menuButton.height >= 44, "cible tactile du menu conservée");
          assert.match(card.menuLabel, /Actions secondaires pour/);
          assert.ok(card.documentAction.width > 0, "le compteur reste visible dans la zone Documents");
          if (card.count === "0") {
            assert.equal(card.documentTagName, "SPAN", "zéro document conserve l’affichage informatif");
            assert.equal(card.documentLabel, "Aucun document associé");
          } else {
            assert.equal(card.documentTagName, "BUTTON", "les documents associés restent une action");
            assert.match(card.documentLabel, new RegExp(`Afficher ${card.count} documents? associé`));
          }
          assert.equal(card.dateLines.length, 2, "naissance et décès disposent chacun de leur ligne");
          assert.ok(Math.abs(card.dateLines[0].box.x - card.dateLines[1].box.x) < 0.1, "les deux dates partagent le même axe gauche");
          assert.ok(Math.abs(card.dateLines[0].box.x - card.main.x) < 0.1, "dates alignées sous l’identité, dans la colonne réservée avant le menu");
          assert.equal(card.dateDividerDisplay, "none", "le séparateur entre naissance et décès est absent des cartes");
          assert.ok(card.nameToBirthGap >= 0 && card.nameToBirthGap <= 12, "les dates restent groupées naturellement sous le nom");
          assert.ok(card.card.height < 230, "la hauteur de carte reste maîtrisée avec deux lignes de dates");
          assert.equal(card.overflow, 0, "aucun débordement horizontal de page");
        }
        const findCard = surname => cards.find(card => card.name.includes(surname));
        const botton = findCard("Botton");
        const conti = findCard("Conti");
        const giovannoni = findCard("Giovannoni");
        const unknown = findCard("Rossi");
        assert.ok(botton?.name.includes("Marie-Joséphine"), "Botton Marie-Joséphine reste lisible");
        assert.ok(conti?.name.includes("Robert") && conti.name.includes("Louis Albert"), "Conti Robert Louis Albert reste lisible");
        assert.ok(giovannoni?.name.includes("Carlo") && giovannoni.name.includes("Andrea Rolando"), "Giovannoni Carlo Andrea Rolando reste lisible");
        assert.deepEqual(botton.dateLines.map(line => line.text), ["✦ entre 1901 et 1902", "† —"], "période et décès inconnu conservent leurs formats");
        assert.deepEqual(conti.dateLines.map(line => line.text), ["✦ 13 avril 1939", "† 17 février 2016"], "dates exactes restent inchangées");
        assert.deepEqual(giovannoni.dateLines.map(line => line.text), ["✦ vers 1898", "† —"], "date approximative et valeur inconnue restent inchangées");
        assert.deepEqual(unknown.dateLines.map(line => line.text), ["✦ —", "† —"], "les deux valeurs inconnues gardent leur tiret");
        assert.equal(botton.hasPhoto, true, "la photo garde la même place que les initiales");
        assert.equal(conti.hasPhoto, false, "les initiales fonctionnent sans photo");
        assert.ok(Math.max(...cards.map(card => card.documents.height)) - Math.min(...cards.map(card => card.documents.height)) < 0.1, "zone Documents de hauteur stable malgré les compteurs variables");
        if (width <= 390) assert.ok(unknown.heading.height < giovannoni.heading.height, "un nom court conserve une ligne sans réserver de ligne vide");
        if (width >= 1024) {
          const rows = cards.reduce((groups, card) => {
            const key = Math.round(card.card.y);
            groups.set(key, [...(groups.get(key) || []), card]);
            return groups;
          }, new Map());
          for (const row of rows.values()) {
            if (row.length < 2) continue;
            assert.ok(row.every(card => Math.abs(card.card.height - row[0].card.height) < 0.1), "hauteurs de cartes alignées sur une même rangée");
            assert.ok(row.every(card => Math.abs(card.documents.y - row[0].documents.y) < 0.1), "séparateurs alignés sur une même rangée");
            assert.ok(row.every(card => Math.abs(card.documentAction.y - row[0].documentAction.y) < 0.1), "blocs Documents alignés verticalement sur une même rangée");
          }
        }
      });
    }

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.evaluate(() => window.__renderDirectoryCardsFixture("list"));
    const listMode = await page.evaluate(() => {
      const life = document.querySelector("#directoryList.list-mode .directory-life");
      return {
        listMode: document.getElementById("directoryList").classList.contains("list-mode"),
        lifeDisplay: getComputedStyle(life).display,
        dividerDisplay: getComputedStyle(life.querySelector(".directory-life-divider")).display
      };
    });
    assert.equal(listMode.listMode, true, "la vue Liste reste active sans les styles Cartes");
    assert.equal(listMode.lifeDisplay, "flex", "la présentation des dates de la Liste reste horizontale");
    assert.notEqual(listMode.dividerDisplay, "none", "le séparateur de la Liste reste affiché");
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
