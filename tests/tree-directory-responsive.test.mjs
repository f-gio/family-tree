import assert from "node:assert/strict";
import test from "node:test";
import { webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

test("les contrôles mobiles de l’Arbre reprennent la largeur et le rythme de l’Annuaire", async t => {
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (error) {
    throw new Error(`WebKit mobile indisponible : ${error.message}`);
  }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({
    locale: "fr-FR",
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 }
  });
  await context.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(server.baseURL) ? route.continue() : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    for (const width of [320, 390, 760, 1024]) {
      await t.test(`${width} px`, async tViewport => {
        await page.setViewportSize({ width, height: width <= 760 ? 844 : 768 });
        const measures = await page.evaluate(() => {
          const views = ["appMain", "directoryView", "documentsView", "tasksView", "dossiersView"];
          const rect = selector => {
            const element = document.querySelector(selector);
            const box = element.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
          };
          const activate = id => {
            for (const view of views) document.getElementById(view).hidden = view !== id;
            document.getElementById("authScreen").hidden = true;
            document.getElementById("topbar").hidden = false;
          };
          activate("directoryView");
          const directoryDescription = document.querySelector("#directoryView .page-title + p");
          const directoryDescriptionStyle = getComputedStyle(directoryDescription);
          const directory = {
            cta: rect("#addDirectoryPersonBtn"),
            title: rect("#directoryView .page-title"),
            description: rect("#directoryView .page-title + p"),
            descriptionStyle: {
              display: directoryDescriptionStyle.display,
              fontSize: directoryDescriptionStyle.fontSize,
              lineHeight: directoryDescriptionStyle.lineHeight,
              color: directoryDescriptionStyle.color,
              scrollWidth: directoryDescription.scrollWidth,
              clientWidth: directoryDescription.clientWidth,
              text: directoryDescription.textContent.trim()
            },
            search: rect("#directoryView .search-bar"),
            filter: rect("#directoryView .directory-filters-trigger"),
            descriptionCtaGap: rect("#addDirectoryPersonBtn").y - rect("#directoryView .page-title + p").bottom,
            ctaSearchGap: rect("#directoryView .search-bar").y - rect("#addDirectoryPersonBtn").bottom,
            searchFilterGap: rect("#directoryView .directory-filters-trigger").y - rect("#directoryView .search-bar").bottom,
            filterGap: getComputedStyle(document.querySelector("#directoryView .directory-toolbar")).rowGap
          };
          activate("appMain");
          const treeDescription = document.querySelector("#appMain .page-title + p");
          const treeDescriptionStyle = getComputedStyle(treeDescription);
          const tree = {
            cta: rect("#addBtn"),
            title: rect("#appMain .page-title"),
            description: rect("#appMain .page-title + p"),
            descriptionStyle: {
              display: treeDescriptionStyle.display,
              fontSize: treeDescriptionStyle.fontSize,
              lineHeight: treeDescriptionStyle.lineHeight,
              color: treeDescriptionStyle.color,
              scrollWidth: treeDescription.scrollWidth,
              clientWidth: treeDescription.clientWidth,
              text: treeDescription.textContent.trim()
            },
            search: rect("#appMain .search-bar"),
            branch: rect("#treeBranchFilter"),
            shell: rect("#treeViewport"),
            status: rect("#appMain .tree-sync-status"),
            controls: rect("#appMain .tree-controls"),
            descriptionCtaGap: rect("#headerTreeActions").y - rect("#appMain .page-title + p").bottom,
            ctaSearchGap: rect("#appMain .search-bar").y - rect("#addBtn").bottom,
            searchBranchGap: rect("#treeBranchFilter").y - rect("#appMain .search-bar").bottom,
            branchCanvasGap: rect("#treeViewport").y - rect("#treeBranchFilter").bottom,
            filterGap: getComputedStyle(document.querySelector("#appMain .tree-filter-toolbar")).rowGap
          };
          return {
            directory,
            tree,
            overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
            visible: {
              treeCta: getComputedStyle(document.getElementById("addBtn")).display !== "none",
              directoryCta: getComputedStyle(document.getElementById("addDirectoryPersonBtn")).display !== "none"
            }
          };
        });
        tViewport.diagnostic(JSON.stringify(measures));
        assert.equal(measures.visible.treeCta, true);
        assert.equal(measures.visible.directoryCta, true);
        assert.ok(measures.overflow.scrollWidth <= measures.overflow.clientWidth, "aucun débordement horizontal");
        if (width <= 760) {
          assert.notEqual(measures.tree.descriptionStyle.display, "none", "la description de l’Arbre est visible");
          assert.equal(measures.tree.descriptionStyle.text, "Cliquez sur une carte pour modifier la personne. Faites-la glisser pour ajuster sa position.");
          for (const property of ["fontSize", "lineHeight", "color"]) {
            assert.equal(measures.tree.descriptionStyle[property], measures.directory.descriptionStyle[property], `style de description commun : ${property}`);
          }
            assert.ok(measures.tree.descriptionStyle.scrollWidth <= measures.tree.descriptionStyle.clientWidth, "la description de l’Arbre ne déborde pas");
            assert.ok(Math.abs(measures.tree.description.width - measures.directory.description.width) < 0.1, "les descriptions partagent la largeur disponible");
            assert.ok(Math.abs(measures.tree.description.y - measures.tree.title.bottom - 7) < 0.1, "H2 → description reprend la règle responsive commune");
            assert.ok(Math.abs(measures.tree.descriptionCtaGap - measures.directory.descriptionCtaGap) < 0.1, "espacement description → CTA commun");
            assert.ok(Math.abs(measures.tree.descriptionCtaGap - 16) < 0.1, "description → CTA utilise --space-4");
          assert.ok(Math.abs(measures.tree.cta.x - measures.directory.cta.x) < 0.1, "les CTA partagent le même axe gauche");
          assert.ok(Math.abs(measures.tree.cta.width - measures.directory.cta.width) < 0.1, "le CTA Arbre a la même largeur que celui de l’Annuaire");
          assert.ok(Math.abs(measures.tree.cta.height - measures.directory.cta.height) < 0.1, "les CTA ont la même hauteur");
          for (const element of [measures.tree.search, measures.tree.branch, measures.tree.shell]) {
            assert.ok(Math.abs(element.x - measures.directory.cta.x) < 0.1, "recherche, filtre et canvas partagent l’axe du CTA");
            assert.ok(Math.abs(element.width - measures.directory.cta.width) < 0.1, "recherche, filtre et canvas ont la largeur du contenu");
          }
          assert.ok(Math.abs(measures.directory.ctaSearchGap - 20) < 0.1, "espace CTA → recherche Annuaire : --space-5");
          assert.ok(Math.abs(measures.tree.ctaSearchGap - measures.directory.ctaSearchGap) < 0.1, "espace CTA → recherche commun");
          assert.ok(Math.abs(measures.directory.searchFilterGap - 8) < 0.1, "espace recherche → filtres Annuaire : --space-2");
          assert.ok(Math.abs(measures.tree.searchBranchGap - measures.directory.searchFilterGap) < 0.1, "espace recherche → branche commun");
          assert.equal(measures.tree.filterGap, measures.directory.filterGap, "le rythme de grille reprend celui de l’Annuaire");
          assert.ok(Math.abs(measures.tree.branchCanvasGap - 8) < 0.1, "espace branche → canvas conservé à --space-2");
          assert.ok(measures.tree.status.y >= measures.tree.shell.bottom, "Synchronisé reste sous le canvas");
          assert.ok(measures.tree.controls.x >= measures.tree.shell.x && measures.tree.controls.right <= measures.tree.shell.right, "les contrôles restent dans les limites horizontales du canvas");
          assert.ok(measures.tree.controls.bottom <= measures.tree.shell.bottom + 0.1, "les contrôles du canvas restent dans le canvas");
        } else {
          assert.ok(Math.abs(measures.tree.cta.width - measures.directory.cta.width) < 0.1, "le CTA desktop conserve sa largeur compacte commune");
        }
      });
    }
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
