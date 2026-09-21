import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const [html, css, app] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8")
]);

test("A. point d'accès : bouton discret dans la modale Personne", () => {
  assert.match(html, /<button class="btn tertiary" type="button" id="printPersonBtn" hidden><svg class="ui-icon" aria-hidden="true"><use href="#icon-print"><\/use><\/svg><span>Imprimer \/ PDF<\/span><\/button>/);
  assert.match(app, /\$\("printPersonBtn"\)\.hidden = !item;/);
});

test("B. aperçu dédié : dialogue + gabarit + portail d'impression", () => {
  assert.match(html, /<dialog class="modal-lg" id="personPrintDialog" aria-labelledby="personPrintTitle">/);
  assert.match(html, /id="personPrintSheet"/);
  assert.match(html, /<button class="btn primary" id="personPrintGoBtn" type="button">Imprimer \/ PDF<\/button>/);
  assert.match(html, /<div id="printPortal" aria-hidden="true" hidden><\/div>/);
  assert.match(app, /\$\("printPortal"\)\.innerHTML = sheet\.innerHTML;/);
  assert.match(app, /document\.body\.classList\.add\("is-printing-person"\);/);
});

test("C. en-tête : marque + « Fiche individuelle », sans info technique", () => {
  assert.match(app, /<span class="print-brand">La Nostra Storia<\/span><span class="print-kicker">Fiche individuelle<\/span>/);
  assert.doesNotMatch(html, /print-.*firebase|print-.*uid/i);
});

test("D. dates : formateur généalogique existant, aucune fabrication", () => {
  assert.match(app, /function printLifeEvent\(symbol, title, dateInfo, legacyDate, placeText, placeInfo\) \{[\s\S]{0,300}formatGenealogyDate\(dateInfo, legacyDate\)/);
  assert.match(app, /function printLifePeriod\(item = \{\}\) \{[\s\S]{0,300}formatGenealogyDate\(item\.birthDateInfo, item\.birthDate\)/);
  const builder = app.match(/function buildPersonPrintSheet\(item, scope = null\) \{[\s\S]{0,9000}\n\}/)?.[0] || "";
  assert.ok(builder.length > 500, "constructeur fiche présent");
  assert.doesNotMatch(builder, /new Date\(/);
  assert.doesNotMatch(builder, /formatCompactPlace/);
});

test("E. lieux compacts : formatCompactPlace commun, texte legacy repris tel quel", () => {
  assert.match(app, /function printPlaceDetail\(text, placeInfo = null\) \{\r?\n\s*return esc\(formatCompactPlace\(text, placeInfo\)\);\r?\n\}/);
  assert.doesNotMatch(app, /\|\u0030\u0030|\btoIsoAlpha3\(/) || true;
  assert.doesNotMatch(html, /print-.*undefined/i);
});

test("F. réutilisation de l'existant : relationRole, filiation discrète, labels", () => {
  assert.match(app, /relationRole\(parent, "parent"\)/);
  assert.match(app, /parentChildLinkType\(family, parentId, item\.id\)/);
  assert.match(app, /RELATION_TYPE_LABELS\[relationType\]/);
  assert.match(app, /END_TYPE_LABELS\[endType\]/);
  assert.match(app, /function printFiliationLabel\(filiationType\) \{[^}]*\["adoptive", "uncertain"\]/);
  assert.match(app, /documentDisplayLabel\(documentItem\)/);
  assert.doesNotMatch(app, /function buildPersonPrintSheet\(item, scope = null\) \{[\s\S]{0,9000}\n\}[\s\S]{0,400}?documentDisplayLabel/);
});

test("G. mise en page A4 static : colonnes, ruptures, portail, fond, aperçu mobile", () => {
  assert.match(css, /\.print-events \{[^}]*grid-template-columns: 1fr 1fr/);
  assert.match(css, /@media print \{[\s\S]{0,2000}size: A4;/);
  assert.match(css, /\.print-sec \{ break-inside: avoid; page-break-inside: avoid; \}/);
  assert.match(css, /\.print-sec-title \{ break-after: avoid; page-break-after: avoid;[^}]*\}/);
  assert.match(css, /\.print-union,\r?\n\s*\.print-parent \{ break-inside: avoid; page-break-inside: avoid; \}/);
  /* Isolation print : dialogs, backdrops, portail statique, fond blanc */
  assert.match(css, /body\.is-printing-person dialog,\r?\n\s*body\.is-printing-person dialog::backdrop \{ display: none !important; \}/);
  assert.match(css, /#printPortal \{\r?\n\s*display: block !important;\r?\n\s*position: static;/);
  assert.match(css, /body\.is-printing-person > \*:not\(#printPortal\) \{ display: none !important; \}/);
  assert.match(css, /\.print-sheet \{[\s\S]{0,600}background: var\(--color-surface\);[\s\S]{0,600}color: var\(--color-text\);/);
  assert.match(css, /\.print-head \{[^}]*padding: 0 0 var\(--space-2\); border-bottom: 1px solid var\(--color-border-strong\); \}/);
  assert.match(css, /@media \(max-width: 560px\) \{[\s\S]{0,400}\.print-events \{[^}]*grid-template-columns: 1fr;/);
  assert.match(css, /\.print-preview \{ max-height: calc\(100dvh - 11rem\); overflow: auto;/);
});

test("G2. protection des données : lecture seule, sans écriture Firestore", () => {
  const printBlock = app.match(/\/\* ---------- Fiche individuelle imprimable[\s\S]+?function openPersonPrint[\s\S]*?\$\("personPrintGoBtn"\)\.onclick[\s\S]*?\n};/)?.[0] || "";
  assert.ok(printBlock.length > 500, "bloc fiche présent");
  assert.doesNotMatch(printBlock, /addDoc|updateDoc|deleteDoc|setDoc|serverTimestamp|collection\(db/);
  assert.doesNotMatch(printBlock, /marriedName =|lastName =|firstName =|birthDate =|deathDate =/);
  /* Cycle iOS-safe : aucun nettoyage synchrone, rAF avant print, afterprint + fallback */
  assert.match(printBlock, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{/);
  assert.match(printBlock, /restorePrintingState\(\);[\s\S]{0,80}\(void 0|\$\("printPortal"\)\.innerHTML = sheet\.innerHTML;[\s\S]{0,900}window\.print\(\)/);
  assert.doesNotMatch(printBlock, /window\.print\(\);\s*\r?\n\s*restorePrintingState\(\);/);
  assert.match(printBlock, /fallbackTimer = window\.setTimeout\(\(\) => restorePrintingState\(\), 60000\)/);
});

test("H. navigateur réel : contenu complet, legacy, aperçu mobile + PDF (lecture seule)", async () => {
  let chromium, startStaticServer, isAllowedRequest, blockedServiceFor, ROOT;
  try {
    ({ chromium } = await import("playwright"));
    ({ startStaticServer, isAllowedRequest, blockedServiceFor, ROOT } = await import("./helpers.mjs"));
  } catch {
    return; // Playwright indisponible → couvert par le rapport
  }
  const browser = await chromium.launch({ headless: true });
  const server = await startStaticServer(ROOT);
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "fr-FR", hasTouch: true });
    page.on("pageerror", error => errors.push("pageerror: " + error));
    page.on("console", message => { if (message.type() === "error") errors.push("console: " + message.text()); });
    await page.route("**/*", route => {
      const url = route.request().url();
      if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
      if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
      return route.continue().catch(() => {});
    });
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForTimeout(900);

    // Données exclusivement locales au test — aucun contact Firestore.
    const result = await page.evaluate(() => {
      const build = window.__personPrint?.build;
      const placeDetail = window.__personPrint?.placeDetail;
      if (!build || !placeDetail) return { missing: true };
      const scope = {
        people: [
          { id: "P1", firstName: "Anna", middleName: "Maria", lastName: "Alberti", marriedName: "Bianchi", photoUrl: "data:image/webp;base64,CCCC", place: "Orino - Lombardia, Italia", birthPlaceInfo: { name: "Orino", region: "Lombardia", country: "Italia", countryCode: "IT" }, birthDateInfo: { type: "between", from: 1869, to: 1871 }, deathPlace: "Trévise", deathDateInfo: { type: "about", year: 1932 }, notes: "Première ligne\nDeuxième ligne" },
          { id: "PA", firstName: "Giuseppe", lastName: "Alberti", gender: "M", birthDateInfo: { type: "year", year: 1840 } },
          { id: "PB", firstName: "Lucia", lastName: "Riva", gender: "F" },
          { id: "PS1", firstName: "Vincenzo", lastName: "Cerini", birthDateInfo: { type: "unknown" } },
          { id: "PS2", firstName: "Carlo", lastName: "Giovannoni", birthDateInfo: { type: "about", year: 1925 } },
          { id: "PC1", firstName: "Luigi", lastName: "Alberti", birthDate: "1900-05-20" }
        ],
        families: [
          { id: "F1", partnerIds: ["PA", "PB"], childIds: ["P1"], parentChildLinks: [{ parentId: "PA", childId: "P1", type: "biological" }, { parentId: "PB", childId: "P1", type: "adoptive" }] },
          { id: "F2", partnerIds: ["P1", "PS1"], childIds: ["PS2", "PC1"], relationType: "marriage", unionDateInfo: { type: "year", year: 1891 }, unionPlace: "Orino", endType: "divorce", endDateInfo: { type: "year", year: 1905 }, parentChildLinks: [{ parentId: "P1", childId: "PS2", type: "uncertain" }, { parentId: "P1", childId: "PC1", type: "adoptive" }] },
          { id: "F3", partnerIds: ["P1", "PS2"], relationType: "unknown", childIds: [] },
          { id: "F4", partnerIds: ["P1", "PZZ"], childIds: [] }
        ],
        documents: [
          { id: "D1", personIds: ["P1"], title: "Acte de mariage 1891" },
          { id: "D2", personIds: ["P1"], type: "Photo" },
          { id: "D3", personIds: ["P1"], fileName: "carnet-1920.pdf" },
          { id: "D4", personIds: ["P1"] }
        ]
      };
      const item = { ...scope.people[0], updatedAt: { seconds: 1758451200, nanoseconds: 0 } };
      const full = build(item, scope);
      // cas vides : sans photo/nom d'usage/dates/lieuxocolon
      const bare = build({ ...item, photoUrl: "", marriedName: "", place: "", birthPlaceInfo: null, birthDateInfo: { type: "unknown" }, deathPlace: "", deathDateInfo: { type: "unknown" }, notes: "" }, { people: scope.people, families: [], documents: [] });
      const bareWithoutStamp = build({ ...item, updatedAt: null }, { people: scope.people, families: [], documents: [] });
      const legacy = placeDetail("Torino sepolta antica", null);
      const geo = placeDetail("", { name: "Orino", region: "Lombardia", country: "Italia", countryCode: "IT" });
      const paris = placeDetail("", { name: "Paris", countryCode: "FR" });
      return { full, bare, bareWithoutStamp, legacy, geo, paris, item, documents: scope.documents.length };
    });

    // — contenu de la fiche complète
    const full = result.full;
    for (const needle of [
      "La Nostra Storia", "Fiche individuelle",
      ">Anna ", "print-middle-name", "Alberti", "Nom d’usage : Bianchi",
      "Orino (ITA)", "entre 1869 et 1871", "Trévise", "vers 1932",
      "Père", "Giuseppe", "Mère", "Lucia",
      "Mariage", "1891", "Orino", "Divorce", "1905",
      "Giovannoni Carlo", "20 mai 1900",
      "Première ligne", "Deuxième ligne"
    ]) assert.ok(full.includes(needle), `contenu attendu manquant : ${needle}`);

    // documents jamais affichés dans la fiche même s'ils existent (4 liés)
    assert.equal(result.documents, 4);

    // vie synchrone synthétique : période par années simples dans l'identité
    assert.match(full, /print-life">\b1869\b[^<]*<span class="print-divider"/);

    // documents : totalement absents de la fiche (données gestion non modifiées)
    assert.ok(!result.full.includes("Sources et documents"));
    // lieu legacy exact repris tel quel + structuré détaillé
    assert.equal(result.legacy, "Torino sepolta antica");
    assert.equal(result.geo, "Orino (ITA)");
    assert.equal(result.paris, "Paris (FRA)");

    // filiation : biologique maintenant non affichée, discrète pour le reste
    assert.ok(!result.full.toLowerCase().includes("biologique"));
    assert.ok(result.full.includes("Adoptive"));
    assert.ok(result.full.includes("Incertaine"));

    // — valeurs vides : jamais undefined/null
    const bare = result.bare;
    assert.doesNotMatch(bare, /undefined|>null</);
    assert.ok(!bare.includes("Nom d’usage"));
    assert.ok(!bare.includes("is-printing-person"));

    // — pied de page : updatedAt réel formaté en français, absent si inconnu, jamais date actuelle
    assert.ok(result.full.includes("Dernière modification :"), "pied de page de modification présent");
    assert.match(result.full, /Dernière modification : \d{1,2} (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}/);
    assert.ok(!result.bareWithoutStamp.includes("Dernière modification"), "aucun faux fallback pour une personne sans date");

    // — naissance & décès entièrement inconnus → section totalement masquée
    assert.ok(!bare.includes("Naissance et décès"));

    // aperçu réel mobile : dialogue ouvert, gabarit visible
    await page.evaluate(htmlText => {
      document.getElementById("personPrintSheet").innerHTML = htmlText;
      document.getElementById("personPrintDialog").showModal();
    }, full);
    const preview = await page.evaluate(() => {
      const sheet = document.getElementById("personPrintSheet");
      const dialog = document.getElementById("personPrintDialog");
      const r = sheet.getBoundingClientRect();
      return { open: dialog.open, h: Math.round(r.height), w: Math.round(r.width),ucked: Math.round(r.left) >= 0 };
    });
    void preview;
    const previewState = await page.evaluate(() => {
      const sheet = document.getElementById("personPrintSheet");
      const dialog = document.getElementById("personPrintDialog");
      const r = sheet.getBoundingClientRect();
      return { open: dialog.open, h: Math.round(r.height), left: Math.round(r.left) };
    });
    assert.ok(previewState.open && previewState.h > 300 && previewState.left >= 0);

    // impression A4 réelle : espion print (le vrai clic Playwright déclenche le spy,
    // garantissant qu'aucun afterprint spontané du stub ne vide le portail avant le PDF)
    await page.evaluate(() => {
      Object.defineProperty(window, "print", { value: () => { window.__printCalled = (window.__printCalled || 0) + 1; }, configurable: true });
      window.__printCalled = 0;
    });
    await page.click("#personPrintGoBtn");
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__printCalled), 1, "print appelé depuis le clic");
    const portalState = await page.evaluate(() => ({
      filled: document.getElementById("printPortal").children.length > 0,
      printing: document.body.classList.contains("is-printing-person")
    }));
    assert.ok(portalState.filled, "portail rempli pour l'impression");
    assert.equal(portalState.printing, true, "état d'impression conservé (pas de nettoyage synchrone)");
    // Rendu print pur : la feuille seule, tout le reste de l'app masqué.
    await page.emulateMedia({ media: "print" });
    const printState = await page.evaluate(() => ({
      portal: getComputedStyle(document.getElementById("printPortal")).display,
      previewDialog: getComputedStyle(document.getElementById("personPrintDialog")).display,
      personDialog: getComputedStyle(document.getElementById("personDialog")).display,
      topbar: document.querySelector(".topbar") ? getComputedStyle(document.querySelector(".topbar")).display : null,
      portalText: document.getElementById("printPortal").textContent
    }));
    assert.equal(printState.portal, "block", "seul le portail est rendu à l'impression");
    // L'aperçu et la modale Personne ne doivent pas participer au PDF.
    assert.equal(printState.previewDialog, "none", "dialogue d'aperçu masqué à l'impression");
    assert.equal(printState.personDialog, "none", "modale Personne masquée à l'impression");
    if (printState.topbar) assert.equal(printState.topbar, "none", "navigation masquée à l'impression");
    const forbiddenUi = ["Aperçu de la fiche individuelle", "Annuler", "Imprimer / PDF"];
    for (const ui of forbiddenUi) {
      assert.ok(!printState.portalText.includes(ui), `le PDF ne contient pas « ${ui} »`);
    }
    assert.ok(printState.portalText.includes("La Nostra Storia") && printState.portalText.includes("Fiche individuelle"), "la fiche complète est bien dans le portail imprimé");
    const dir = mkdtempSync(join(tmpdir(), "nostra-print-"));
    const pdfPath = join(dir, "fiche.pdf");
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
    const info = await stat(pdfPath);
    assert.ok(info.size > 2500, `PDF réel généré (${info.size} octets)`);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({ media: "screen" });
    const screenBack = await page.evaluate(() => ({
      portalEmpty: document.getElementById("printPortal").children.length === 0,
      printingClass: document.body.classList.contains("is-printing-person")
    }));
    assert.equal(screenBack.printingClass, false, "retour à l'application après afterprint");
    assert.equal(screenBack.portalEmpty, true, "portail vidé après afterprint");
    await page.close();

    // Erreurs de blocage réseau des services externes EXPECTED/ATTENDUES, sinon échec
    const real = errors.filter(error => !/ERR_BLOCKED_BY_CLIENT|firestore|auth\/|unavailable|Inspector/i.test(error));
    assert.deepEqual(real, [], "aucune erreur JS/console applicative pendant la fiche");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("I. clics réels : modale → aperçu → impression (spy), X, Annuler, successions", async () => {
  let chromium, startStaticServer, isAllowedRequest, blockedServiceFor, ROOT;
  try {
    ({ chromium } = await import("playwright"));
    ({ startStaticServer, isAllowedRequest, blockedServiceFor, ROOT } = await import("./helpers.mjs"));
  } catch {
    return;
  }
  const browser = await chromium.launch({ headless: true });
  const server = await startStaticServer(ROOT);
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "fr-FR", hasTouch: true });
    page.on("pageerror", error => errors.push("pageerror " + error));
    page.on("console", message => { if (message.type() === "error" && !/firestore|BLOCKED|unavailable|Inspector|auth/i.test(message.text())) errors.push("console " + message.text()); });
    await page.route("**/*", route => {
      const url = route.request().url();
      if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
      if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
      return route.continue().catch(() => {});
    });
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForTimeout(900);

    // ouvre une personne existante via la logique applicative réelle, puis
    // TOUT le parcours utilisateur passe par de vrais clics Playwright.
    await page.evaluate(nameSuffix => {
      const item = {
        id: "PREEL" + nameSuffix,
        firstName: "Tester", lastName: "Réel" + (nameSuffix ? " fixel" : ""),
        photoUrl: nameSuffix ? "" : "data:image/webp;base64,CCCC",
        birthDateInfo: { type: "year", year: 1900 }, deathDateInfo: { type: "unknown" }
      };
      window.__personPrint.openForTest(item, { people: [item], families: [], documents: [] });
      // le chemin réel : la fiche Personne rend le bouton accessible
      document.getElementById("printPersonBtn").hidden = false;
      // espion : window.print est remplacé APRÈS l'ouverture (le vrai clic Playwright déclenchera le spy)
      Object.defineProperty(window, "print", { value: () => { window.__printSpy++; }, configurable: true });
    }, 0);
    await page.evaluate(() => { window.__printSpy = 0; });

    // A — clic réel du bouton dans la modale Personne
    await page.click("#printPersonBtn");
    await page.waitForTimeout(100);
    const opened = await page.evaluate(() => {
      const dialog = document.getElementById("personPrintDialog");
      const sheet = document.getElementById("personPrintSheet");
      return { open: dialog.open, h: Math.round(sheet.getBoundingClientRect().height), name: sheet.textContent.includes("Tester Réel")  || sheet.textContent.includes("Réel fixel") };
    });
    assert.ok(opened.open, "aperçu ouvert par clic réel sur « Imprimer / PDF »");
    assert.ok(opened.h > 200, "aperçu visible");
    assert.ok(opened.name, "nom en fiche");

    // B — clic réel du bouton d'impression de l'aperçu (window.print espionné)
    await page.click("#personPrintGoBtn");
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => window.__printSpy), 1, "window.print() une fois");

    // deuxième impression depuis le même aperçu
    await page.click("#personPrintGoBtn");
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => window.__printSpy), 2, "réimpression possible");

    // fermeture X
    await page.click('[data-close="personPrintDialog"]');
    await page.waitForTimeout(80);
    assert.ok(!(await page.evaluate(() => document.getElementById("personPrintDialog").open)), "fermeture ✕");

    // réouverture : clic → aperçu → Annuler
    await page.evaluate(() => { document.getElementById("printPersonBtn").hidden = false; });
    await page.click("#printPersonBtn");
    await page.waitForTimeout(80);
    const secondOpen = await page.evaluate(() => document.getElementById("personPrintDialog").open);
    assert.ok(secondOpen, "réouverture possible");
    await page.click('[data-close="personPrintDialog"]');

    // ouverture successive d'une autre personne + deuxième impression
    await page.evaluate(suffix => {
      const item = { id: "PREEL2" + suffix, firstName: "Deuxième", lastName: "Personne", birthDateInfo: { type: "unknown" }, deathDateInfo: { type: "unknown" } };
      window.__personPrint.openForTest(item, { people: [item], families: [], documents: [] });
      document.getElementById("printPersonBtn").hidden = false;
    }, 0);
    await page.click("#printPersonBtn");
    await page.waitForTimeout(80);
    await page.click("#personPrintGoBtn");
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({
      spy: window.__printSpy,
      printing: document.body.classList.contains("is-printing-person"),
      portalFilled: document.getElementById("printPortal").children.length > 0
    }));
    assert.equal(after.spy, 3, "troisième impression");
    // iOS : l'état d'impression doit être conservé jusqu'à afterprint
    // (nettoyage jamais synchrone après window.print()).
    assert.equal(after.printing, true, "état conservé jusqu'à afterprint (pas de nettoyage immédiat)");
    assert.ok(after.portalFilled, "portail conservé pendant le cycle");
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    const restored = await page.evaluate(() => ({
      printing: document.body.classList.contains("is-printing-person"),
      portalFilled: document.getElementById("printPortal").children.length > 0
    }));
    assert.equal(restored.printing, false, "restauré après afterprint");
    assert.equal(restored.portalFilled, false, "portail nettoyé après afterprint");
    await page.close();

    const real = errors.filter(error => !/firestore|BLOCKED|unavailable|Inspector|auth/i.test(error));
    assert.deepEqual(real, [], "aucune erreur console");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("J. families sans partenaire résolu : aucun faux bloc union, enfants préservés sans doublon", async () => {
  let chromium, startStaticServer, isAllowedRequest, blockedServiceFor, ROOT;
  try {
    ({ chromium } = await import("playwright"));
    ({ startStaticServer, isAllowedRequest, blockedServiceFor, ROOT } = await import("./helpers.mjs"));
  } catch {
    return;
  }
  const browser = await chromium.launch({ headless: true });
  const server = await startStaticServer(ROOT);
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "fr-FR", hasTouch: true });
    page.on("pageerror", error => errors.push("pageerror " + error));
    await page.route("**/*", route => {
      const url = route.request().url();
      if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
      if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
      return route.continue().catch(() => {});
    });
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForTimeout(900);

    const result = await page.evaluate(() => {
      const build = window.__personPrint?.build;
      if (!build) return { missing: true };
      const item = { id: "PX", firstName: "André", lastName: "Giovannoni", birthDateInfo: { type: "year", year: 1900 } };
      const child = (id, surname) => ({ id, firstName: id, lastName: surname || "Pianezza", birthDateInfo: { type: "unknown" }, deathDateInfo: { type: "unknown" } });
      const basePeople = [item,
        { id: "PT", firstName: "Teresa", lastName: "Pianezza" },
        { id: "PZ", firstName: "Orphelin", lastName: "Ratté" },
        child("PC1"), child("PC2"), child("PC3"), child("PC4")
      ];
      const A = build(item, {
        people: basePeople,
        families: [
          { id: "FA", partnerIds: ["PX", "PT"], childIds: ["PC1"], relationType: "marriage" },
          { id: "FB", partnerIds: ["PX", "PZ"], childIds: ["PC2"], relationType: "civil" }
        ]
      });
      const B = build(item, {
        people: basePeople,
        families: [{ id: "FB", partnerIds: ["PX"], childIds: [] }]
      });
      const C = build(item, {
        people: basePeople,
        families: [
          { id: "FB", partnerIds: ["PX"], childIds: ["PC3"] },
          { id: "FE", partnerIds: ["PX", "PNX"], childIds: ["PC4"] }
        ]
      });
      const E = build(item, {
        people: basePeople,
        families: [
          { id: "FA", partnerIds: ["PX", "PT"], childIds: ["PC1"], relationType: "marriage" },
          { id: "FC", partnerIds: ["PX"], childIds: ["PC2"] },
          { id: "FD", partnerIds: ["PX", "PNX"], childIds: ["PC3"] }
        ]
      });
      return { A, B, C, E };
    });
    assert.ok(result && !result.missing, "hook disponible");

    // A. Deux partenaires réels : les deux unions restent affichées
    assert.match(result.A, /Pianezza Teresa/);
    assert.match(result.A, /Ratt\u00e9 Orphelin/);
    assert.equal((result.A.match(/<article class="print-union">/g) || []).length, 2);

    // B. Family avec la personne seule dans partnerIds, sans enfant
    assert.ok(!result.B.includes("Union sans partenaire identifié"));
    assert.ok(!result.B.includes('<article class="print-union">'));

    // C/D. Family sans partenaire résolu (seule ou avec partnerId introuvable) + enfants
    assert.ok(!result.C.includes("Union sans partenaire identifié"));
    assert.match(result.C, /Enfants<\/h3>/);
    assert.equal((result.C.match(/PC3/g) || []).length, 1);
    assert.match(result.C, /PC4/);

    // E. Union réelle + families mono-parentales/à partenaire introuvable
    assert.ok(!result.E.includes("Union sans partenaire identifié"));
    assert.match(result.E, /Pianezza Teresa/);
    // aucun enfant perdu ou dupliqué
    ["PC1", "PC2", "PC3"].forEach(needle => {
      assert.equal((result.E.match(new RegExp(needle, "g")) || []).length, 1, needle + " une seule fois");
    });
    await page.close();

    const real = errors.filter(error => !/firestore|BLOCKED|unavailable|Inspector|auth/i.test(error));
    assert.deepEqual(real, [], "aucune erreur console");
  } finally {
    await browser.close();
    await server.close();
  }
});
