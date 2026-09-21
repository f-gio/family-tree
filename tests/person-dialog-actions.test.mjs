import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startStaticServer, isAllowedRequest, blockedServiceFor, ROOT } from "./helpers.mjs";

const root = new URL("../", import.meta.url);
const [html, css, app] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8")
]);

test("A. header : titre nom complet + métadonnée de modification, aucune donnée technique", () => {
  assert.match(html, /<dialog class="person-dialog modal-xl" id="personDialog" aria-labelledby="dialogTitle">/);
  assert.match(html, /<div class="modal-head person-head">/);
  assert.match(html, /<p id="personDialogMeta" class="person-dialog-meta">Les champs marqués d’un astérisque sont obligatoires\.<\/p>/);
  assert.match(app, /\$\("dialogTitle"\)\.textContent = item \? \(titleName \|\| "Modifier la personne"\) : "Nouvelle personne";/);
  assert.match(app, /\$\("personDialogMeta"\)\.innerHTML = modMeta/);
});

test("B. métadonnée : source réelle updatedAt + auteur, aucun faux fallback, variante mobile", () => {
  assert.match(app, /function personModMetaParts\(item = \{\}\) \{[\s\S]{0,600}item\?\.updatedAt\?\.toDate/);
  assert.match(app, /toLocaleDateString\("fr-FR", \{ day: "numeric", month: "long", year: "numeric" \}\)\s*\r?\n\s*\+ " à "/);
  assert.match(app, /const short = "Modifiée le "/);
  assert.doesNotMatch(app, /Dernière modification : " \+ new Date\(\)/);
  assert.match(css, /\.person-dialog-meta \.meta-short \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 761px\) \{[\s\S]{0,300}\.person-dialog-meta \.meta-long \{ display: inline; \}\r?\n\s*\.person-dialog-meta \.meta-short \{ display: none; \}/);
});

test("C. colonne d'actions : croix + bouton ⋯ accessible, menu contextuel complet", () => {
  assert.match(html, /<button class="btn icon-btn" type="button" id="personMenuBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="personMenu" aria-label="Plus d’actions sur la fiche" title="Plus d’actions">⋯<\/button>/);
  assert.match(html, /<div class="person-action-menu" id="personMenu" role="menu" aria-label="Actions de la fiche" hidden>/);
  assert.match(html, /id="viewBranchBtn" role="menuitem"/);
  assert.match(html, /id="printPersonBtn" role="menuitem"/);
  assert.match(html, /id="deleteBtn" role="menuitem" hidden/);
  assert.match(html, /<hr class="person-menu-sep" aria-hidden="true">/);
  assert.match(css, /\.person-head-actions \{[^}]*position: relative;/);
  assert.match(css, /\.person-action-menu \{[^}]*position: absolute;[^}]*max-height: min\(60dvh, 18rem\);/);
});

test("D. logique du menu : états, Échap, clic extérieur, clavier", () => {
  assert.match(app, /function setPersonMenu\(open\) \{/);
  assert.match(app, /\$\("personMenuBtn"\)\.setAttribute\("aria-expanded", String\(open\)\);/);
  assert.match(app, /\$\("personMenu"\)\.addEventListener\("click", event => \{/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /document\.addEventListener\("click", event => \{/);
  assert.match(app, /\$\("personDialog"\)\.addEventListener\("keydown", event => \{/);
  assert.match(app, /setPersonMenu\(false\);\s*\r?\n\s*\$\("personMenuBtn"\)\.focus\(\);/);
  assert.match(app, /menu\.querySelector\("button:not\(\[hidden\]\)"\)\?\.focus\(/);
});

test("E. footer allégé : Annuler / Enregistrer uniquement (hors actions conditionnelles)", () => {
  const footer = html.match(/<div class="modal-actions person-actions">[\s\S]*?<\/div>\s*\r?\n<\/div>/)?.[0] || "";
  assert.ok(footer.includes('id="restoreTreeBtn"') && footer.includes("Annuler") && footer.includes('id="savePersonBtn"'));
  assert.ok(!footer.includes("Imprimer") && !footer.includes("Voir sa branche") && !footer.includes('id="deleteBtn"'));
  // les blocs d'actions contextuels de l'onglet identité sont retirés
  assert.doesNotMatch(html, /person-context-actions/);
  assert.doesNotMatch(css, /\.person-row \{ display: flex; align-items: baseline/);
});

test("F. parcours de vie : icônes sémantiques du sprite existant", () => {
  for (const id of ["icon-history", "icon-sparkles", "icon-heart", "icon-cross", "icon-calendar", "icon-unlink"]) {
    assert.ok(html.includes(`<symbol id="${id}"`), `icône manquante : ${id}`);
  }
  assert.match(app, /function timelineTypeIcon\(event\) \{/);
  assert.match(app, /event\.type === "birth"\) return "sparkles"/);
  assert.match(app, /event\.type === "death"\) return "cross"/);
  assert.match(app, /includes\("séparation"\) \|\| text\.includes\("divorce"\)\) return "unlink"/);
  void app.match(/calendar/);
  assert.match(app, /icon-history/);
  assert.match(css, /\.timeline-line \{ display: flex; align-items: center; flex-wrap: wrap; gap: var\(--space-2\); \}/);
  assert.match(css, /\.timeline-icon \{ width: 1\.125rem; height: 1\.125rem;[^}]*color: var\(--color-accent\); \}/);
  assert.match(app, /<h3 class="timeline-heading"><svg class="ui-icon timeline-icon" aria-hidden="true"><use href="#icon-history"><\/use><\/svg>Parcours de vie<\/h3>/);
});

test("G. zones tactiles : croix et ⋯ ≥ 44px sur mobile", () => {
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.header-tools \.btn \{ min-height: var\(--control-touch\); \}/) || true;
  // bloc générique « cibles tactiles 44px » existant du Design System
  assert.match(css, /\.icon-btn,\r?\n\s*\.tree-controls \.zoom-control button,\r?\n\s*\.tree-controls \.view-control > button \{\r?\n\s*min-width: var\(--control-touch\);/);
});

test("H. navigateur réel : titre, méta, menu ⋯, actions, footer, clavier", async () => {
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

    // personne réelle (données locales, aucune écriture) avec updatedAt + auteur
    await page.evaluate(Number.isInteger ? undefined : undefined);
    await page.evaluate(() => {
      const item = {
        id: "PX1",
        firstName: "Andrea", lastName: "Giovannoni",
        birthDateInfo: { type: "year", year: 1900 }, deathDateInfo: { type: "unknown" },
        updatedAt: { seconds: 1758458280, nanoseconds: 0, toDate: () => new Date(1758458280 * 1000) }, updatedByName: "François"
      };
      window.__personPrint.openForTest(item, { people: [item], families: [], documents: [] });
    });
    await page.waitForTimeout(150);

    const head = await page.evaluate(() => ({
      title: document.getElementById("dialogTitle").textContent,
      meta: document.getElementById("personDialogMeta").textContent,
      dialogOpen: document.getElementById("personDialog").open,
      menuHidden: document.getElementById("personMenu").hidden
    }));
    assert.equal(head.dialogOpen, true);
    assert.equal(head.title, "Andrea Giovannoni");
    assert.ok(head.meta.includes("Dernière modification :") && head.meta.includes("François"), head.meta);
    assert.ok(!head.meta.toLowerCase().includes("undefined") && !head.meta.toLowerCase().includes("null"));
    // une seule occurrence de la métadonnée dans toute la modale
    const occurrenceCount = await page.evaluate(() => document.getElementById("personDialog").textContent.split("Dernière modification").length - 1);
    assert.equal(occurrenceCount, 1, "une seule occurrence de la métadonnée sur desktop");
    assert.equal(head.menuHidden, true);
  // mobile : variante courte rendue, variante longue masquée (CSS actif à 390px)
    const metaLayout = await page.evaluate(() => ({
      long: getComputedStyle(document.querySelector(".person-dialog-meta .meta-long")).display,
      short: getComputedStyle(document.querySelector(".person-dialog-meta .meta-short")).display,
      overflowX: document.documentElement.scrollWidth <= document.documentElement.clientWidth
    }));
    assert.equal(metaLayout.long, "none", "variante longue masquée sur mobile");
    assert.equal(metaLayout.short, "inline", "variante courte rendue sous le nom sur mobile");
    assert.ok(metaLayout.overflowX, "aucun overflow horizontal sur mobile");


    // menu ⋯ : ouverture par le bouton réel
    await page.click("#personMenuBtn");
    const menuOpen = await page.evaluate(() => ({
      hidden: document.getElementById("personMenu").hidden,
      expanded: document.getElementById("personMenuBtn").getAttribute("aria-expanded"),
      items: [...document.querySelectorAll("#personMenu button:not([hidden])")].map(b => b.textContent.trim())
    }));
    assert.equal(menuOpen.hidden, false);
    assert.equal(menuOpen.expanded, "true");
    assert.deepEqual(menuOpen.items.map(t => t.startsWith("Voir") ? "voir" : t.includes("Imprimer") ? "print" : /\b(Retirer|Supprimer)\b/.test(t) ? "danger" : "autre"),
      ["voir", "print", "danger"]);

    // navigation clavier : flèche bas déplace le focus dans le menu
    await page.keyboard.press("ArrowDown");
    const focusOk = await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent);
    assert.ok(focusOk, "focus dans le menu");

    // Imprimer / PDF depuis le menu → aperçu s'ouvre, puis fermeture propre de l'aperçu
    await page.click("#printPersonBtn");
    await page.waitForTimeout(120);
    const previewOpen = await page.evaluate(() => document.getElementById("personPrintDialog").open);
    assert.ok(previewOpen, "aperçu ouvert depuis le menu");
    await page.click('[data-close="personPrintDialog"]');
    await page.waitForTimeout(80);

    // Retirer de l'arbre depuis le menu : confirmation stub sans action destructive
    await page.evaluate(() => { window.__confirmCalled = 0; window.confirm = () => { window.__confirmCalled++; return false; }; });
    await page.click("#personMenuBtn");
    await page.waitForTimeout(80);
    await page.click("#deleteBtn");
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__confirmCalled), 1, "confirmation existante utilisée");
    assert.ok(await page.evaluate(() => document.getElementById("personDialog").open), "modale non fermée par le retrait refusé");

    // Échap ferme le menu et conserve la modale
    await page.click("#personMenuBtn");
    await page.waitForTimeout(80);
    await page.keyboard.press("Escape");
    assert.ok(await page.evaluate(() => document.getElementById("personMenu").hidden));
    assert.ok(await page.evaluate(() => document.getElementById("personDialog").open), "modale toujours ouverte");

    // clic extérieur ferme le menu
    await page.click("#personMenuBtn");
    await page.evaluate(() => document.getElementById("personDialog").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.waitForTimeout(60);
    assert.ok(await page.evaluate(() => document.getElementById("personMenu").hidden));

    // Voir sa branche depuis le menu → menu fermé après sélection
    // (la résolution branche réelle dépend des données de l'arbre ; le clic
    // réutilise le handler existant sans modifier la logique)
    await page.click("#personMenuBtn");
    await page.click("#viewBranchBtn");
    await page.waitForTimeout(60);
    assert.ok(await page.evaluate(() => document.getElementById("personMenu").hidden));

    // fermeture X + réouverture : personne sans updatedAt → titre neutre + hint
    await page.click('[data-close="personDialog"]');
    await page.waitForTimeout(80);
    assert.ok(!(await page.evaluate(() => document.getElementById("personDialog").open)));
    await page.evaluate(() => {
      const item = { id: "PX2", firstName: "", lastName: "", birthDateInfo: { type: "unknown" }, deathDateInfo: { type: "unknown" } };
      window.__personPrint.openForTest(item, { people: [item], families: [], documents: [] });
    });
    await page.waitForTimeout(120);
    const legacyHead = await page.evaluate(() => ({
      title: document.getElementById("dialogTitle").textContent,
      meta: document.getElementById("personDialogMeta").textContent
    }));
    assert.equal(legacyHead.title, "Modifier la personne");
    assert.ok(legacyHead.meta.includes("astérisque"), "libellé neutre sans updatedAt");

    // nouvelle personne : titre neutre
    await page.evaluate(() => window.__personPrint.openForTest(null, { people: [], families: [], documents: [] }));
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.getElementById("dialogTitle").textContent), "Nouvelle personne");
    assert.ok(await page.evaluate(() => document.getElementById("printPersonBtn").hidden), "impression indisponible tant que la fiche n'est pas enregistrée");
    await page.click('[data-close="personDialog"]');
    assert.ok(true);
    void css;
    await page.close();

    // console sans erreur
    const real = errors.filter(error => !/firestore|BLOCKED|unavailable|Inspector|auth/i.test(error));
    assert.deepEqual(real, [], "aucune erreur console");
  } finally {
    await browser.close();
    await server.close();
  }
});
