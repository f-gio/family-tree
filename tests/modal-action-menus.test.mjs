import assert from "node:assert/strict";
import test from "node:test";
import { webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

async function waitForDialogLayout(page, dialogId) {
  await page.waitForFunction(id => {
    const dialog = document.getElementById(id);
    return !!dialog?.open && dialog.getAnimations({ subtree: true }).every(animation => animation.playState === "finished");
  }, dialogId);
}

test("les formulaires partagent leurs footers et réservent … aux actions d’objets existants", async t => {
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (error) {
    throw new Error(`WebKit indisponible : ${error.message}`);
  }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({
    locale: "fr-FR",
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 }
  });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      const source = (await response.text()).replace(
        "async function loadTaskUsers() {",
        "async function loadTaskUsers() { if (window.__modalUiTest) return [];"
      );
      const testHooks = `
window.__documentExistsForTest = id => documents.some(item => item.id === id);
window.__setDocumentSnapshotForTest = complete => {
  if (complete) {
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    people = []; families = []; tasks = [];
    genealogyCollectionErrors = new Map();
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"]);
    genealogyRecords = { sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [], genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [] };
  } else {
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = false;
    genealogyCollectionErrors = new Map();
    genealogyCollectionsLoaded = new Set();
  }
};
window.__openModalForTest = async (kind, item = null) => {
  for (const id of ["personDialog", "documentDialog", "taskDialog", "familyDetailsDialog"]) {
    const dialog = document.getElementById(id);
    if (dialog.open) dialog.close();
  }
  window.__modalUiTest = true;
  document.getElementById("authScreen").hidden = true;
  document.getElementById("topbar").hidden = false;
  if (kind === "document") {
    // Instantané complet requis par le garde de suppression avant tout confirm().
    window.__setDocumentSnapshotForTest(true);
    documents = item ? [item] : [];
    openDocument(item);
  } else if (kind === "task") {
    await openTask(item);
  } else if (kind === "familyDetails") {
    document.getElementById("familyDetailsDialog").showModal();
  } else if (kind === "person") {
    openPerson(item, "tree");
  }
};`;
      return route.fulfill({ response, body: `${source}\n${testHooks}` });
    }
    return url.startsWith(server.baseURL) || url.includes("gstatic.com")
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  const confirmations = [];
  page.on("dialog", async dialog => {
    confirmations.push(dialog.message());
    await dialog.dismiss();
  });
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__openModalForTest === "function");
    const cases = [
      { kind: "person", dialog: "personDialog", close: "personDialog", title: "dialogTitle", menu: "personMenuBtn", popup: "personMenu", delete: "deleteBtn", existing: { id: "person-ui-test", firstName: "Ada", lastName: "Rossi", inTree: true } },
      { kind: "task", dialog: "taskDialog", close: "taskDialog", title: "taskDialogTitle", menu: "taskMenuBtn", popup: "taskActionMenu", delete: "deleteTaskBtn", existing: { id: "task-ui-test", title: "Action de test", status: "todo", priority: "medium", assignee: "", dueDate: "", description: "", comments: "" } },
      { kind: "document", dialog: "documentDialog", close: "documentDialog", title: "documentDialogTitle", menu: "documentMenuBtn", popup: "documentActionMenu", delete: "deleteDocumentBtn", existing: { id: "document-ui-test", title: "Document de test", type: "Photo", personIds: [], notes: "" } },
      { kind: "familyDetails", dialog: "familyDetailsDialog", close: "familyDetailsDialog", title: "familyDetailsTitle", menu: null, popup: null, delete: null, existing: null }
    ];

    for (const width of [320, 390, 760, 1024]) {
      await t.test(`${width} px`, async tViewport => {
        await page.setViewportSize({ width, height: width <= 760 ? 844 : 768 });
        const footerHeights = [];
        const responsiveFooterMeasurements = [];
        for (const modal of cases) {
          const open = async item => {
            await page.evaluate(({ kind, item }) => window.__openModalForTest(kind, item), { kind: modal.kind, item });
            await waitForDialogLayout(page, modal.dialog);
          };
          const tap = async selector => width <= 760
            ? page.locator(selector).tap()
            : page.locator(selector).click();

          await open(null);
          assert.equal(await page.locator(`#${modal.dialog}`).isVisible(), true, `${modal.kind} création ouverte`);
          assert.equal(await page.locator(`#${modal.dialog} .modal-head [data-close]`).isVisible(), true, `${modal.kind} conserve ×`);
          const footerButtons = () => page.locator(`#${modal.dialog} .modal-actions .right > .btn:not([hidden])`);
          assert.equal(await footerButtons().count(), 2, `${modal.kind} footer création contient deux actions`);
          const labels = await footerButtons().allTextContents();
          assert.match(labels[0], /Annuler/);
          assert.ok(labels[1].trim(), `${modal.kind} conserve son libellé primaire`);
          if (modal.kind === "person") assert.equal(labels[1].trim(), "Continuer");
          if (modal.menu) {
            assert.equal(await page.locator(`#${modal.menu}`).isVisible(), false, `${modal.kind} masque … en création`);
            assert.equal(await page.locator(`#${modal.delete}`).isVisible(), false, `${modal.kind} masque Supprimer en création`);
          } else {
            assert.equal(await page.locator(`#${modal.dialog} .modal-head-actions`).count(), 0, "aucun menu vide dans Détails relation");
          }
          const createFooter = await page.locator(`#${modal.dialog} .modal-actions`).boundingBox();
          footerHeights.push(createFooter.height);
          const createGeometry = await page.locator(`#${modal.dialog} .modal-actions`).evaluate(footer => {
            const footerStyle = getComputedStyle(footer);
            const buttons = [...footer.querySelectorAll(".right > .btn:not([hidden])")].map(button => {
              const box = button.getBoundingClientRect();
              return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height, minHeight: getComputedStyle(button).minHeight };
            });
            const probe = document.createElement("div");
            probe.style.cssText = "position:fixed;padding-bottom:env(safe-area-inset-bottom)";
            document.body.append(probe);
            const safeAreaInsetBottom = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
            probe.remove();
            const box = footer.getBoundingClientRect();
            return {
              height: box.height,
              paddingTop: parseFloat(footerStyle.paddingTop),
              paddingBottom: parseFloat(footerStyle.paddingBottom),
              paddingLeft: parseFloat(footerStyle.paddingLeft),
              paddingRight: parseFloat(footerStyle.paddingRight),
              minHeight: footerStyle.minHeight,
              borderTop: footerStyle.borderTop,
              background: footerStyle.backgroundColor,
              safeAreaInsetBottom,
              topGap: buttons[0].top - box.top,
              bottomGap: box.bottom - buttons[buttons.length - 1].bottom,
              buttons
            };
          });
          if (["task", "document", "person"].includes(modal.kind)) {
            responsiveFooterMeasurements.push({ modal: modal.kind, ...createGeometry });
          }
          if (width <= 760) {
            const boxes = createGeometry.buttons;
            assert.ok(Math.abs(boxes[0].top - boxes[1].top) < 1, `${modal.kind} Annuler/CTA sur une seule rangée`);
            assert.ok(boxes.every(box => box.minHeight === "44px" && box.height >= 43.5), `${modal.kind} cibles tactiles ≥44 px`);
            assert.ok(Math.abs(boxes[0].width - boxes[1].width) < 0.1, `${modal.kind} CTA à répartition 50/50`);
            assert.ok(boxes[1].left > boxes[0].right && boxes[1].right <= createFooter.x + createFooter.width + 1, `${modal.kind} CTA contenu dans le footer`);
            assert.equal(createGeometry.paddingTop, 12, `${modal.kind} padding supérieur commun`);
            assert.equal(createGeometry.paddingBottom, Math.max(12, createGeometry.safeAreaInsetBottom), `${modal.kind} padding inférieur et safe-area communs`);
            assert.equal(createGeometry.paddingLeft, 16, `${modal.kind} padding horizontal gauche commun`);
            assert.equal(createGeometry.paddingRight, 16, `${modal.kind} padding horizontal droit commun`);
            assert.ok(createGeometry.topGap >= 11.5 && createGeometry.bottomGap >= 11.5, `${modal.kind} footer sans espace vertical excédentaire: ${JSON.stringify(createGeometry)}`);
          } else {
            const save = await footerButtons().nth(1).boundingBox();
            assert.ok(Math.abs(createFooter.x + createFooter.width - save.x - save.width - 24) < 1, `${modal.kind} action primaire alignée à droite du footer`);
            assert.equal(createGeometry.paddingTop, 16, `${modal.kind} padding supérieur desktop conservé`);
            assert.equal(createGeometry.paddingBottom, 16, `${modal.kind} padding inférieur desktop conservé`);
          }
          await tap(`#${modal.dialog} .modal-actions [data-close="${modal.close}"]`);
          await page.waitForFunction(id => !document.getElementById(id).open, modal.dialog);

          if (modal.menu) {
            await open(modal.existing);
            assert.equal(await page.locator(`#${modal.menu}`).isVisible(), true, `${modal.kind} menu présent en modification`);
            if (modal.kind === "person") assert.equal(await footerButtons().nth(1).textContent(), "Enregistrer", "l’édition Personne conserve Enregistrer");
            assert.equal(await footerButtons().count(), 2, `${modal.kind} footer modification reste limité aux actions d’édition`);
            assert.equal(await page.locator(`#${modal.dialog} .modal-actions #${modal.delete}`).count(), 0, `${modal.kind} Supprimer est absent du footer`);
            const editFooter = await page.locator(`#${modal.dialog} .modal-actions`).boundingBox();
            assert.ok(Math.abs(editFooter.height - createFooter.height) < 1.5, `${modal.kind} garde la même hauteur de footer en modification`);
            footerHeights.push(editFooter.height);
            await tap(`#${modal.menu}`);
            const menuItem = page.locator(`#${modal.delete}`);
            assert.equal(await menuItem.isVisible(), true, `${modal.kind} Supprimer accessible dans …`);
            assert.equal(await page.locator(`#${modal.menu}`).getAttribute("aria-expanded"), "true");
            const menuBox = await page.locator(`#${modal.popup}`).boundingBox();
            assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= width + 1, `${modal.kind} menu dans le viewport`);
            assert.ok(await menuItem.evaluate(element => element.getBoundingClientRect().height >= 44), `${modal.kind} entrée tactile ≥44 px`);
            await page.keyboard.press("Escape");
            assert.equal(await page.locator(`#${modal.popup}`).isVisible(), false, `${modal.kind} Échap ferme …`);
            assert.equal(await page.locator(`#${modal.menu}`).evaluate(element => document.activeElement === element), true, `${modal.kind} focus restauré`);
            if (modal.kind !== "person") {
              await page.keyboard.press("ArrowDown");
              assert.equal(await page.locator(`#${modal.popup}`).isVisible(), true, `${modal.kind} ouvre … au clavier`);
              await page.keyboard.press("Escape");
            }
            await tap(`#${modal.menu}`);
            await tap(`#${modal.dialog} .modal-head h3`);
            assert.equal(await page.locator(`#${modal.popup}`).isVisible(), false, `${modal.kind} clic extérieur ferme …`);
            if (modal.kind === "document") {
              // Le garde refuse toute suppression tant que l'instantané est
              // incomplet : ni confirmation, ni écriture, message explicite.
              await page.evaluate(() => window.__setDocumentSnapshotForTest(false));
              await tap(`#${modal.menu}`);
              await tap(`#${modal.delete}`);
              await page.waitForTimeout(40);
              assert.equal(confirmations.length, 0, "document : aucune confirmation si snapshot incomplet");
              assert.equal(await page.locator(`#${modal.dialog}`).evaluate(element => element.open), true, "document : la modale reste ouverte après refus");
              assert.match(await page.locator("#toastMessage").textContent(), /ne peuvent pas toutes être vérifiées/, "document : message de chargement invitant à réessayer");
              assert.equal(await page.evaluate(() => window.__documentExistsForTest("document-ui-test")), true, "document : le document isolé reste présent après refus");
              confirmations.length = 0;
              await page.evaluate(() => window.__setDocumentSnapshotForTest(true));
            }
            await tap(`#${modal.menu}`);
            await tap(`#${modal.delete}`);
            assert.equal(confirmations.length, 1, `${modal.kind} réutilise une seule confirmation existante`);
            if (modal.kind === "document") assert.match(confirmations[0], /Supprimer définitivement « .* » et son fichier \? Cette action est irréversible\./, "document : confirmation explicite et irréversible");
            assert.equal(await page.locator(`#${modal.dialog}`).evaluate(element => element.open), true, `${modal.kind} reste ouvert après refus de confirmation`);
            assert.equal(await page.locator(`#${modal.popup}`).isVisible(), false, `${modal.kind} menu fermé après sélection`);
            confirmations.length = 0;
          } else if (modal.kind === "familyDetails") {
            await open(null);
            assert.equal(await page.locator("#familyDetailsDialog .modal-head-actions").count(), 0, "pas de menu sans action secondaire");
          }

          await tap(`#${modal.dialog} .modal-head [data-close]`);
          await page.waitForFunction(id => !document.getElementById(id).open, modal.dialog);
        }
        assert.ok(Math.max(...footerHeights) - Math.min(...footerHeights) < 1.5, `footers partageant la même hauteur : ${footerHeights.join(", ")}`);
        tViewport.diagnostic(`${width}px : ${JSON.stringify(responsiveFooterMeasurements)}`);
      });
    }
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
