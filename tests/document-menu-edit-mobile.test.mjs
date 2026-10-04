import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

async function tapVisibleElement(page, selector, viewport) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector).boundingBox();
  const diagnostics = box ? null : await page.evaluate(() => {
    const menu = document.querySelector("#documentsList .tile-context-menu");
    const toggle = document.querySelector("#documentsList [data-tile-menu-toggle]");
    const card = document.querySelector("#documentsList .document-card");
    const rect = element => { const value = element?.getBoundingClientRect(); return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null; };
    return { hidden: menu?.hidden, menuRect: rect(menu), menuDisplay: menu && getComputedStyle(menu).display, menuVisibility: menu && getComputedStyle(menu).visibility, expanded: toggle?.getAttribute("aria-expanded"), toggleRect: rect(toggle), cardRect: rect(card), contentVisibility: card && getComputedStyle(card).contentVisibility, active: document.activeElement?.outerHTML?.slice(0, 180) };
  });
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, `${selector} doit être atteignable par un tap : ${JSON.stringify({ box, diagnostics })}`);
  const hit = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
    return { tag: element?.tagName, className: typeof element?.className === "string" ? element.className : "", text: element?.textContent?.trim().slice(0, 40), authHidden: document.getElementById("authScreen")?.hidden };
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  return { box, hit };
}

test("retirer le fichier reste local jusqu’à Enregistrer et réutilise le nettoyage existant", () => {
  const open = appSource.slice(appSource.indexOf("function openDocument("), appSource.indexOf("function renderDocuments(", appSource.indexOf("function openDocument(")));
  const save = appSource.slice(appSource.indexOf("async function saveDocument("), appSource.indexOf("async function removeDocument(", appSource.indexOf("async function saveDocument(")));
  const removalClick = appSource.slice(appSource.indexOf('$("removeCurrentDocumentFileBtn").onclick'), appSource.indexOf('$("restoreCurrentDocumentFileBtn").onclick'));
  assert.match(open, /documentFileMarkedForRemoval = false;/);
  assert.match(removalClick, /documentFileMarkedForRemoval = true;\s*renderDocumentFileState\(item\);/);
  assert.doesNotMatch(removalClick, /deleteDoc|deleteFileChunks|updateDoc|setDoc/);
  assert.match(save, /else if \(removeExistingFile\) \{\s*for \(const field of DOCUMENT_FILE_METADATA_FIELDS\) data\[field\] = deleteField\(\);/);
  assert.match(save, /if \(id\) await updateDoc\(target, data\);[\s\S]*?if \(\(file \|\| removeExistingFile\) && existing\?\.chunkVersion\) await deleteFileChunks\(existing\);/);
  assert.match(save, /if \(file\) \{[\s\S]*?await writeFileChunks\(target\.id, newChunkVersion, optimized\.blob\);[\s\S]*?data\.fileName = file\.name;/);
});

test("Documents : … → Modifier/Supprimer fonctionne au clic et au tap", async t => {
  const server = await startStaticServer(ROOT);
  const scenarios = [
    { name: "WebKit mobile tactile 390 px", engine: webkit, width: 390, height: 844, isMobile: true, hasTouch: true },
    { name: "WebKit mobile tactile 320 px", engine: webkit, width: 320, height: 700, isMobile: true, hasTouch: true },
    { name: "Chromium mobile tactile 390 px", engine: chromium, width: 390, height: 844, isMobile: true, hasTouch: true },
    { name: "Chromium desktop 1024 px", engine: chromium, width: 1024, height: 768, isMobile: false, hasTouch: false }
  ];

  try {
    for (const scenario of scenarios) {
      let browser;
      try {
        browser = await scenario.engine.launch({ headless: true });
      } catch (error) {
        if (scenario.engine === webkit) {
          await t.test(scenario.name, child => child.skip(`WebKit Playwright indisponible : ${error.message}`));
          continue;
        }
        throw error;
      }
      await t.test(scenario.name, async () => {
        const context = await browser.newContext({
          locale: "fr-FR",
          viewport: { width: scenario.width, height: scenario.height },
          isMobile: scenario.isMobile,
          hasTouch: scenario.hasTouch
        });
        await context.route("**/*", async route => {
          const url = route.request().url();
          if (url.endsWith("/js/app.js")) {
            const response = await route.fetch();
            const source = (await response.text())
              .replace("onAuthStateChanged(auth, async user => {", "onAuthStateChanged(auth, async user => { window.__menuAuthCallbackStarted = true;")
              .replace(
                "    if (file) {",
                `    if (file && window.__captureDocumentSaveForTest) {
                 window.__documentSaveCaptureForTest = { id, removeExistingFile, selectedFileName: file.name, personIds: [...data.personIds], oldChunkVersion: existing?.chunkVersion || "" };
      close("documentDialog");
      return;
    }
    if (file) {`
              )
              .replace(
                "    if (id) await updateDoc(target, data);",
                `    if (id) {
      if (window.__captureDocumentSaveForTest) {
        window.__documentSaveCaptureForTest = {
          id, removeExistingFile, selectedFileName: file?.name || "", oldChunkVersion: existing?.chunkVersion || "",
          personIds: [...data.personIds],
          oldChunkVersion: existing?.chunkVersion || "",
          fileFields: DOCUMENT_FILE_METADATA_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(data, field)),
          deletedFileFields: DOCUMENT_FILE_METADATA_FIELDS.filter(field => data[field]?._methodName === "deleteField" || data[field]?.constructor?.name === "DeleteFieldValue")
        };
        close("documentDialog");
        return;
      }
      await updateDoc(target, data);
    }`
              );
            return route.fulfill({
              response,
              body: `${source}\nwindow.__setDocumentFixtures = (items, records) => { documents = items; people = records; renderDocuments(); }; window.__getDocumentFixtureForTest = id => documents.find(item => item.id === id); window.__captureDocumentSaveForTest = false; window.__documentSaveCaptureForTest = null; window.__setOtherMenuFixtures = (records, actionItems, dossiers) => { people = records; tasks = actionItems; procedures = dossiers; renderDirectory(); renderTasks(); renderProcedures(); }; window.__showMenuTestView = listId => { const views = { directoryList: 'directoryView', documentsList: 'documentsView', tasksList: 'tasksView', proceduresList: 'dossiersView' }; for (const id of Object.values(views)) document.getElementById(id).hidden = id !== views[listId]; };`
            });
          }
          return url.startsWith(server.baseURL) || url.includes("gstatic.com")
            ? route.continue()
            : route.abort("blockedbyclient");
        });
        const page = await context.newPage();
        const confirmationMessages = [];
        page.on("dialog", async dialog => {
          confirmationMessages.push(dialog.message());
          await dialog.dismiss();
        });
        try {
          await context.addInitScript(() => {
            window.__menuEventLog = [];
            for (const type of ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "mousedown", "mouseup", "click", "focusin"]) {
              document.addEventListener(type, event => {
                const target = event.target?.closest?.("[data-tile-menu-toggle], [data-tile-menu-action], [data-document-card]");
                if (target) window.__menuEventLog.push({ type, action: target.dataset.tileMenuAction || "", card: target.dataset.documentCard || "", defaultPrevented: event.defaultPrevented });
              }, true);
            }
          });
          await page.goto(server.baseURL, { waitUntil: "load" });
          await page.waitForFunction(() => typeof window.__setDocumentFixtures === "function");
          await page.waitForFunction(() => window.__menuAuthCallbackStarted === true);
          await page.evaluate(() => {
            document.getElementById("authScreen").hidden = true;
            document.getElementById("topbar").hidden = false;
            document.getElementById("appMain").hidden = true;
            for (const id of ["directoryView", "tasksView", "dossiersView"]) document.getElementById(id).hidden = true;
            document.getElementById("documentsView").hidden = false;
            window.__setDocumentFixtures([
              { id: "document-mobile-test", title: "Acte de démonstration", type: "Acte de naissance", externalUrl: `https://example.invalid/${"long-chemin_".repeat(30)}`, fileName: "Transaction_Immobilières_GiovannoniAndreaFuCarloAntonio.jpg", fileSize: 500000, storedSize: 345600, mimeType: "image/jpeg", compressed: true, storageMode: "firestore-chunks", chunkVersion: "document-test-version", chunkCount: 2, personIds: ["person-linked-test", "person-long-link"], notes: "Note conservée" }
            ], [
              { id: "person-linked-test", firstName: "Marie", lastName: "Martin", inTree: true },
              { id: "person-long-link", firstName: "Transaction_Immobilières_GiovannoniAndreaFuCarloAntonio.jpg", lastName: "Nom", inTree: true }
            ]);
          });
          await page.waitForTimeout(120);
          await page.evaluate(() => {
            document.getElementById("authScreen").hidden = true;
            document.getElementById("topbar").hidden = false;
            document.getElementById("appMain").hidden = true;
            for (const id of ["directoryView", "tasksView", "dossiersView"]) document.getElementById(id).hidden = true;
            document.getElementById("documentsView").hidden = false;
            window.__setDocumentFixtures([
              { id: "document-mobile-test", title: "Acte de démonstration", type: "Acte de naissance", externalUrl: `https://example.invalid/${"long-chemin_".repeat(30)}`, fileName: "Transaction_Immobilières_GiovannoniAndreaFuCarloAntonio.jpg", fileSize: 500000, storedSize: 345600, mimeType: "image/jpeg", compressed: true, storageMode: "firestore-chunks", chunkVersion: "document-test-version", chunkCount: 2, personIds: ["person-linked-test", "person-long-link"], notes: "Note conservée" }
            ], [
              { id: "person-linked-test", firstName: "Marie", lastName: "Martin", inTree: true },
              { id: "person-long-link", firstName: "Transaction_Immobilières_GiovannoniAndreaFuCarloAntonio.jpg", lastName: "Nom", inTree: true }
            ]);
          });

          const openDocumentEditorFromMenu = async () => {
            if (scenario.hasTouch) {
              await tapVisibleElement(page, "#documentsList [data-tile-menu-toggle]", scenario);
              await tapVisibleElement(page, '#documentsList [data-tile-menu-action="edit"] span', scenario);
            } else {
              await page.locator("#documentsList [data-tile-menu-toggle]").click();
              await page.locator('#documentsList [data-tile-menu-action="edit"] span').click();
            }
          };
          await openDocumentEditorFromMenu();

          const state = await page.evaluate(() => ({
            open: document.getElementById("documentDialog").open,
            id: document.getElementById("documentId").value,
            title: document.getElementById("documentTitle").value,
            selectedPeople: [...document.querySelectorAll("#documentPeopleChips .person-multiselect-chip-label")].map(node => node.textContent),
            menuHidden: document.querySelector("#documentsList .tile-context-menu").hidden,
            menuRect: (() => { const rect = document.querySelector("#documentsList .tile-context-menu").getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })(),
            events: window.__menuEventLog,
            activeElement: document.activeElement?.outerHTML?.slice(0, 180)
          }));
          assert.equal(state.open, true, `la modale Document est ouverte : ${JSON.stringify(state)}`);
          assert.equal(await page.locator("#documentDialog").isVisible(), true, "la modale est visible dans le viewport");
          assert.equal(state.id, "document-mobile-test", "l’identifiant du document ciblé est chargé");
          assert.equal(state.title, "Acte de démonstration", "le titre du document ciblé est chargé");
          assert.deepEqual(state.selectedPeople, ["Marie Martin", "Transaction_Immobilières_GiovannoniAndreaFuCarloAntonio.jpg Nom"], "les personnes déjà liées restent sélectionnées");
          assert.equal(state.menuHidden, true, "le menu contextuel est fermé");
          assert.equal(await page.locator("#documentMenuBtn").isVisible(), true, "le menu du header est disponible pour un document existant");
          if (scenario.hasTouch) await tapVisibleElement(page, "#documentMenuBtn", scenario);
          else await page.locator("#documentMenuBtn").click();
          assert.equal(await page.locator("#deleteDocumentBtn").isVisible(), true, "Supprimer est dans le menu du header");
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#documentActionMenu").isVisible(), false, "Échap ferme le menu du header");
          assert.equal(await page.locator("#documentMenuBtn").evaluate(button => document.activeElement === button), true, "Échap rend le focus au bouton menu");
          if (scenario.hasTouch) await tapVisibleElement(page, "#documentMenuBtn", scenario);
          else await page.locator("#documentMenuBtn").click();
          if (scenario.hasTouch) await tapVisibleElement(page, "#deleteDocumentBtn", scenario);
          else await page.locator("#deleteDocumentBtn").click();
          await page.waitForTimeout(30);
          assert.equal(confirmationMessages.length, 1, "le menu appelle une seule fois la confirmation existante");
          assert.match(confirmationMessages[0], /Supprimer définitivement ce document/);
          assert.equal(await page.locator("#documentDialog").evaluate(dialog => dialog.open), true, "Annuler la confirmation conserve la modale");
          assert.equal(await page.locator("#documentActionMenu").isVisible(), false, "le menu se ferme après sélection");
          assert.equal(await page.locator("#documentDialog .modal-actions #deleteDocumentBtn").count(), 0, "Supprimer ne figure plus dans le footer");
          confirmationMessages.length = 0;
          if (scenario.hasTouch) await tapVisibleElement(page, '#documentDialog .modal-actions [data-close="documentDialog"]', scenario);
          else await page.locator('#documentDialog .modal-actions [data-close="documentDialog"]').click();
          await page.waitForFunction(() => !document.getElementById("documentDialog").open);
          if (scenario.hasTouch) await tapVisibleElement(page, "#addDocumentBtn", scenario);
          else await page.locator("#addDocumentBtn").click();
          assert.equal(await page.locator("#documentMenuBtn").isVisible(), false, "aucun menu vide en création");
          assert.equal(await page.locator("#deleteDocumentBtn").isVisible(), false, "aucune suppression en création");
          assert.equal(await page.locator("#documentDialog .modal-actions button:not([hidden])").count(), 2, "footer de création : Annuler et Enregistrer");
          if (scenario.hasTouch) await tapVisibleElement(page, '#documentDialog .modal-actions [data-close="documentDialog"]', scenario);
          else await page.locator('#documentDialog .modal-actions [data-close="documentDialog"]').click();
          await page.waitForFunction(() => !document.getElementById("documentDialog").open);
          await openDocumentEditorFromMenu();
          const fileChooserPromise = page.waitForEvent("filechooser");
          if (scenario.hasTouch) await tapVisibleElement(page, ".document-file-picker", scenario);
          else await page.locator(".document-file-picker").click();
          const fileChooser = await fileChooserPromise;
          await fileChooser.setFiles({ name: "nouveau-document.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff]) });
          assert.equal(await page.locator("#documentFile").evaluate(input => input.files[0]?.name), "nouveau-document.jpg", "le contrôle Choisir un fichier sélectionne toujours une pièce");
          assert.match(await page.locator("#documentSelectedFileText").textContent(), /nouveau-document\.jpg.*remplacera le fichier actuel/);
          assert.equal(await page.locator("#removeCurrentDocumentFileBtn").isVisible(), false, "le remplacement masque le retrait du fichier actuel pour éviter une action ambiguë");
          const modalLayout = await page.evaluate(() => {
            const dialog = document.getElementById("documentDialog");
            const form = document.getElementById("documentForm");
            const scroller = form.querySelector(".modal-scroll");
            const footer = form.querySelector(".modal-actions");
            const rect = element => {
              const box = element.getBoundingClientRect();
              return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
            };
            const footerButtons = [...footer.querySelectorAll("button:not([hidden])")].map(button => ({ text: button.textContent.trim(), ...rect(button), minHeight: getComputedStyle(button).minHeight, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth }));
            const dialogRect = rect(dialog);
            const offenders = [...dialog.querySelectorAll("*")].filter(element => {
              if (element.classList.contains("sr-only") || getComputedStyle(element).display === "none") return false;
              const box = element.getBoundingClientRect();
              return box.width > 0 && (box.left < dialogRect.left - 1 || box.right > dialogRect.right + 1);
            }).map(element => ({ tag: element.tagName, id: element.id, className: typeof element.className === "string" ? element.className : "", ...rect(element) }));
            const fileNote = document.getElementById("currentDocumentFile");
            return {
              viewport: { width: document.documentElement.clientWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth },
              dialog: { ...dialogRect, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth },
              form: { ...rect(form), scrollWidth: form.scrollWidth, clientWidth: form.clientWidth, overflowY: getComputedStyle(form).overflowY },
              scroller: { ...rect(scroller), scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, overflowY: getComputedStyle(scroller).overflowY },
              footer: rect(footer),
              footerButtons,
              offenders,
              fileInputClass: document.getElementById("documentFile").className,
              filePicker: { text: document.querySelector(".document-file-picker").textContent.trim(), ...rect(document.querySelector(".document-file-picker")) },
              fileNote: { text: fileNote.textContent, ...rect(fileNote), scrollWidth: fileNote.scrollWidth, clientWidth: fileNote.clientWidth, lineHeight: parseFloat(getComputedStyle(fileNote).lineHeight) },
              fileUrl: rect(document.getElementById("documentUrl")),
              peoplePicker: rect(document.getElementById("documentPeopleList")),
              notes: rect(document.getElementById("documentNotes"))
            };
          });
          if (scenario.isMobile) {
            assert.ok(modalLayout.viewport.scrollWidth <= modalLayout.viewport.width + 1, `${scenario.width}px : la page ne déborde pas horizontalement`);
            assert.ok(modalLayout.dialog.left <= 1 && modalLayout.dialog.right >= modalLayout.viewport.width - 1, `${scenario.width}px : la modale occupe toute la largeur mobile`);
            assert.ok(modalLayout.dialog.scrollWidth <= modalLayout.dialog.clientWidth + 1, `${scenario.width}px : la modale ne déborde pas`);
            assert.ok(modalLayout.scroller.scrollWidth <= modalLayout.scroller.clientWidth + 1, `${scenario.width}px : le corps scrollable n’a pas d’overflow horizontal`);
            assert.equal(modalLayout.form.overflowY, "hidden", `${scenario.width}px : le formulaire ne crée pas un second scroll`);
            assert.equal(modalLayout.scroller.overflowY, "auto", `${scenario.width}px : le corps est l’unique zone scrollable`);
            assert.deepEqual(modalLayout.offenders, [], `${scenario.width}px : aucun contenu ne dépasse la modale`);
            assert.ok(modalLayout.fileNote.height > modalLayout.fileNote.lineHeight * 1.5, `${scenario.width}px : le long nom de fichier revient à la ligne (${modalLayout.fileNote.height}px / ligne ${modalLayout.fileNote.lineHeight}px)`);
            assert.ok(modalLayout.fileNote.scrollWidth <= modalLayout.fileNote.clientWidth + 1, `${scenario.width}px : le texte du fichier reste dans sa zone`);
            assert.match(modalLayout.fileNote.text, /Transaction_Immobilières_GiovannoniAndreaFuCarloAntonio\.jpg[\s\S]*stockés/);
            assert.ok(modalLayout.fileUrl.right <= modalLayout.dialog.right + 1, `${scenario.width}px : champ URL entièrement visible`);
            assert.ok(modalLayout.peoplePicker.right <= modalLayout.dialog.right + 1, `${scenario.width}px : sélecteur de personnes entièrement visible`);
            assert.ok(modalLayout.footer.bottom <= modalLayout.viewport.height + 1, `${scenario.width}px : footer entièrement dans le viewport`);
            const cancel = modalLayout.footerButtons.find(button => button.text === "Annuler");
            const save = modalLayout.footerButtons.find(button => button.text === "Enregistrer");
            assert.ok(cancel && save && modalLayout.footerButtons.length === 2, `${scenario.width}px : footer limité à Annuler/Enregistrer`);
            assert.ok(Math.abs(cancel.top - save.top) < 1, `${scenario.width}px : Annuler et Enregistrer sur la même ligne`);
            assert.ok(Math.abs(cancel.width - save.width) < 1, `${scenario.width}px : boutons Annuler/Enregistrer de largeur égale`);
            assert.ok([cancel, save].every(button => button.minHeight === "44px" && button.height >= 43.5), `${scenario.width}px : cibles du footer ≥44 px en CSS`);
            assert.ok(cancel.scrollWidth <= cancel.clientWidth + 1 && save.scrollWidth <= save.clientWidth + 1, `${scenario.width}px : libellés complets dans le footer`);
            assert.match(modalLayout.fileInputClass, /sr-only/);
            assert.equal(modalLayout.filePicker.text, "Choisir un fichier");
            assert.doesNotMatch(modalLayout.fileNote.text, /aucun fichier sélectionné/i);
            await page.locator("#documentForm .modal-scroll").evaluate(node => { node.scrollTop = node.scrollHeight; });
            const lastContent = await page.locator("#documentNotes").boundingBox();
            const scrollerBox = await page.locator("#documentForm .modal-scroll").boundingBox();
            assert.ok(lastContent.y + lastContent.height <= scrollerBox.y + scrollerBox.height + 1, `${scenario.width}px : le dernier champ est atteignable au-dessus du footer (${lastContent.y + lastContent.height} / ${scrollerBox.y + scrollerBox.height})`);
          } else {
            assert.ok(modalLayout.filePicker.width > 0, "desktop : le contrôle Choisir un fichier reste visible");
          }
          if (scenario.engine === webkit) {
            const touchEnd = state.events.findIndex(entry => entry.type === "touchend" && entry.action === "edit");
            const focusFallback = state.events.findIndex((entry, index) => index > touchEnd && entry.type === "focusin" && entry.card === "document-mobile-test");
            const actionClick = state.events.findIndex((entry, index) => index > focusFallback && entry.type === "click" && entry.action === "edit");
            assert.ok(touchEnd >= 0 && focusFallback > touchEnd && actionClick > focusFallback, `WebKit focusout retardé jusqu’au click d’action : ${JSON.stringify(state.events)}`);
          } else if (scenario.hasTouch) {
            const touchEnd = state.events.findIndex(entry => entry.type === "touchend" && entry.action === "edit");
            const actionClick = state.events.findIndex((entry, index) => index > touchEnd && entry.type === "click" && entry.action === "edit");
            const focusFallback = state.events.findIndex((entry, index) => index > touchEnd && entry.type === "focusin" && entry.card === "document-mobile-test");
            assert.ok(touchEnd >= 0 && actionClick > touchEnd && (focusFallback < 0 || actionClick < focusFallback), `Chromium émet le click avant le focusout sous-jacent : ${JSON.stringify(state.events)}`);
          }
          if (scenario.hasTouch) await tapVisibleElement(page, '#documentDialog .modal-actions [data-close="documentDialog"]', scenario);
          else await page.locator('#documentDialog .modal-actions [data-close="documentDialog"]').click();
          await page.waitForFunction(() => !document.getElementById("documentDialog").open);
          const fixtureAfterCancel = await page.evaluate(() => window.__getDocumentFixtureForTest("document-mobile-test"));
          assert.equal(fixtureAfterCancel.fileName, "Transaction_Immobilières_GiovannoniAndreaFuCarloAntonio.jpg", "Annuler conserve le fichier original");
          assert.equal(fixtureAfterCancel.chunkVersion, "document-test-version", "Annuler conserve la référence aux chunks originaux");

          if (scenario.engine === webkit && scenario.width === 390) {
            await openDocumentEditorFromMenu();
            assert.equal(await page.locator("#removeCurrentDocumentFileBtn").isVisible(), true, "le fichier existant possède une action de retrait");
            await tapVisibleElement(page, "#removeCurrentDocumentFileBtn", scenario);
            assert.equal(await page.locator("#documentFileRemovalNote").isVisible(), true, "× marque uniquement le retrait dans le formulaire");
            assert.equal(await page.locator("#documentFile").evaluate(input => input.files.length), 0, "× ne remplace pas la sélection fichier");
            assert.equal((await page.evaluate(() => window.__getDocumentFixtureForTest("document-mobile-test"))).fileName, "Transaction_Immobilières_GiovannoniAndreaFuCarloAntonio.jpg", "× ne modifie pas l’enregistrement existant");
            await tapVisibleElement(page, "#restoreCurrentDocumentFileBtn", scenario);
            assert.equal(await page.locator("#documentFileRemovalNote").isVisible(), false, "Rétablir annule le retrait local");
            await tapVisibleElement(page, "#removeCurrentDocumentFileBtn", scenario);
            await tapVisibleElement(page, '#documentDialog .modal-actions [data-close="documentDialog"]', scenario);
            await page.waitForFunction(() => !document.getElementById("documentDialog").open);
            assert.equal((await page.evaluate(() => window.__getDocumentFixtureForTest("document-mobile-test"))).chunkVersion, "document-test-version", "Annuler après × conserve les chunks originaux");

            await openDocumentEditorFromMenu();
            await tapVisibleElement(page, "#removeCurrentDocumentFileBtn", scenario);
            await page.evaluate(() => { window.__captureDocumentSaveForTest = true; });
            await tapVisibleElement(page, "#saveDocumentBtn", scenario);
            await page.waitForFunction(() => window.__documentSaveCaptureForTest?.removeExistingFile === true);
            const removedPayload = await page.evaluate(() => window.__documentSaveCaptureForTest);
            assert.equal(removedPayload.oldChunkVersion, "document-test-version", "la suppression différée référence les chunks connus");
            assert.deepEqual(removedPayload.fileFields, ["fileName", "fileSize", "storedSize", "mimeType", "compressed", "storageMode", "chunkVersion", "chunkCount", "fileData", "fileUrl", "storagePath"], "seules les métadonnées du fichier sont marquées pour suppression");
            assert.deepEqual(removedPayload.deletedFileFields, removedPayload.fileFields, "tous les champs fichier utilisent le marqueur Firestore deleteField");
            assert.deepEqual(removedPayload.personIds, ["person-linked-test", "person-long-link"], "le retrait du fichier conserve personIds");
            assert.equal((await page.evaluate(() => window.__getDocumentFixtureForTest("document-mobile-test"))).fileName, "Transaction_Immobilières_GiovannoniAndreaFuCarloAntonio.jpg", "la sonde n’a écrit aucune donnée Firestore");

            await page.evaluate(() => { window.__captureDocumentSaveForTest = false; window.__documentSaveCaptureForTest = null; });
            await openDocumentEditorFromMenu();
            await page.locator("#documentFile").setInputFiles({ name: "remplacement.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff]) });
            assert.match(await page.locator("#documentSelectedFileText").textContent(), /remplacement\.jpg.*remplacera le fichier actuel/);
            assert.equal(await page.locator("#removeCurrentDocumentFileBtn").isVisible(), false, "le retrait n’entre pas en conflit avec le remplacement sélectionné");
            await page.evaluate(() => { window.__captureDocumentSaveForTest = true; });
            await tapVisibleElement(page, "#saveDocumentBtn", scenario);
            await page.waitForFunction(() => window.__documentSaveCaptureForTest?.selectedFileName === "remplacement.jpg");
            const replacementPayload = await page.evaluate(() => window.__documentSaveCaptureForTest);
            assert.equal(replacementPayload.removeExistingFile, false, "le remplacement suit son chemin d’enregistrement existant");
            assert.equal(replacementPayload.oldChunkVersion, "document-test-version", "l’ancien jeu de chunks est connu pour le nettoyage post-enregistrement existant");
          }

          confirmationMessages.length = 0;
          if (scenario.hasTouch) {
            await tapVisibleElement(page, "#documentsList [data-tile-menu-toggle]", scenario);
            await tapVisibleElement(page, '#documentsList [data-tile-menu-action="delete"] span', scenario);
          } else {
            await page.locator("#documentsList [data-tile-menu-toggle]").click();
            await page.locator('#documentsList [data-tile-menu-action="delete"] span').click();
          }
          await page.waitForTimeout(30);
          const documentDeleteEvents = await page.evaluate(() => window.__menuEventLog);
          const documentDeleteClicks = documentDeleteEvents.filter(entry => entry.type === "click");
          assert.equal(documentDeleteClicks.filter(entry => entry.action === "delete").length, 1, "un tap déclenche un seul handler de suppression");
          assert.equal(documentDeleteClicks.filter(entry => entry.card === "document-mobile-test").length, 0, "aucun clic propagé vers la tuile");
          if (scenario.engine === webkit) {
            const touchEnd = documentDeleteEvents.findIndex(entry => entry.type === "touchend" && entry.action === "delete");
            const focusFallback = documentDeleteEvents.findIndex((entry, index) => index > touchEnd && entry.type === "focusin" && entry.card === "document-mobile-test");
            const actionClick = documentDeleteEvents.findIndex((entry, index) => index > focusFallback && entry.type === "click" && entry.action === "delete");
            assert.ok(touchEnd >= 0 && focusFallback > touchEnd && actionClick > focusFallback, `WebKit garde la confirmation joignable après le focusout : ${JSON.stringify(documentDeleteEvents)}`);
          }
          assert.equal(confirmationMessages.length, 1, "la confirmation de suppression existante est déclenchée une seule fois");
          assert.match(confirmationMessages[0], /Supprimer définitivement ce document/);
          assert.ok(await page.locator("#documentsList .document-card").count(), "le refus de confirmation ne supprime aucune donnée de test");
          assert.equal(await page.locator("#documentsList .tile-context-menu").evaluate(menu => menu.hidden), true, "le menu Supprimer est fermé");
          await page.evaluate(() => { window.__menuEventLog = []; });

          if (scenario.engine === webkit) {
            await page.evaluate(() => window.__setOtherMenuFixtures([
              { id: "person-menu-test", firstName: "Anna", lastName: "Rossi", inTree: true }
            ], [
              { id: "task-menu-test", title: "Action de démonstration", status: "todo", priority: "medium", assignee: "" }
            ], [
              { id: "procedure-menu-test", title: "Démarche de démonstration", type: "research", status: "progress", personIds: [] }
            ]));
            for (const list of ["directoryList", "tasksList", "proceduresList"]) {
              await page.evaluate(id => window.__showMenuTestView(id), list);
              await tapVisibleElement(page, `#${list} [data-tile-menu-toggle]`, scenario);
              assert.equal(await page.locator(`#${list} .tile-context-menu`).evaluate(menu => menu.hidden), false, `${list} : menu commun ouvert sur WebKit tactile`);
              await page.keyboard.press("Escape");
              assert.equal(await page.locator(`#${list} .tile-context-menu`).evaluate(menu => menu.hidden), true, `${list} : menu refermé`);
            }
          }

        } finally {
          await context.close();
        }
      });
      await browser.close();
    }
  } finally {
    await server.close();
  }
});
