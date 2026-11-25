import assert from "node:assert/strict";
import test from "node:test";
import { webkit } from "playwright";
import { AUTH_BOOTSTRAP_PATCH, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const longTitle = "Registre paroissial ancien — actes de naissance, mariage et décès de la commune d’Orino, volume III, folios 12 à 84";
const longFileName = "FICHIER_TECHNIQUE_DO_NOT_RENDER_001_2026_03.pdf";
const hooks = `
window.__finalAttestationUX = {
  seed() {
    const id = "ux-person";
    people = [{
      id, firstName: "Carlo", middleName: "Bartolomeo", lastName: "Giovannoni", gender: "M", inTree: true,
      birthDateInfo: { type: "year", year: 1890 }, deathDateInfo: { type: "year", year: 1940 },
      residences: [{ id: "ux-residence", place: "Orino", dateInfo: { type: "year", year: 1932 }, attestations: [] }],
      professions: [{ id: "ux-profession", label: "Agriculteur", dateInfo: { type: "year", year: 1934 }, attestations: [] }],
      lifeEvents: [{
        id: "ux-event", kind: "census", label: "Recensement", dateInfo: { type: "year", year: 1932 }, showInLifeTimeline: false,
        attestations: [{ id: "ux-attestation", date: { type: "year", year: 1932 }, comment: "Attestation existante", documentIds: ["ux-doc-long"], sourceIds: [], proofIds: [] }]
      }]
    }];
    families = [];
    documents = [
      { id: "ux-doc-long", title: "${longTitle}", type: "Registre", fileName: "${longFileName}", mimeType: "application/pdf", personIds: [id] },
      { id: "ux-doc-same", title: "Acte civil", type: "Acte civil", fileName: "technical-acte.pdf", mimeType: "application/pdf", personIds: [id] },
      { id: "ux-doc-library", title: "Archives paroissiales sans lien — répertoire historique de la commune", type: "Archive", fileName: "FICHIER_TECHNIQUE_LIBRARY_002.pdf", mimeType: "application/pdf", personIds: [] }
    ];
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    const targets = enumerateJustificationTargets({ people, families, includeFamilyTargets: false }).targets
      .filter(target => target.owner.kind === "person" && target.owner.id === id);
    const entries = [
      ["person.residence.place", "supports", { value: "Orino", placeInfo: { name: "Orino", countryCode: "ITA" }, dateInfo: { type: "year", year: 1932 } }],
      ["person.profession.label", "contradicts", { value: "Agriculteur" }],
      ["person.birth.date", "mentions", { type: "year", year: 1890 }],
      ["person.death.date", "ambiguous", { type: "year", year: 1940 }]
    ];
    genealogyRecords = {
      sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [],
      genealogyProofs: entries.map(([factType, relation, sourceValue], index) => {
        const target = targets.find(value => value.targetType === factType);
        if (!target) throw new Error("Cible de test absente : " + factType);
        return { id: "ux-proof-" + index, data: {
          id: "ux-proof-" + index, factId: target.factId, factType, personIds: [id], documentId: "ux-doc-long",
          relation, technicalStatus: "active", sourceValue, referenceDateInfo: null
        } };
      }),
      genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: []
    };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin", displayName: "Testeur" };
    syncProofEntryPoints();
    treeCatalogState = "ready";
    $("authScreen").hidden = true;
    $("topbar").hidden = false;
    renderTree();
    setView("directory");
  },
  refreshResearch() {
    const host = document.querySelector("#personPageResearch");
    const item = people.find(value => value.id === "ux-person");
    const template = document.createElement("template");
    template.innerHTML = personPageResearchMarkup(item);
    host?.replaceWith(template.content.firstElementChild);
  },
  setRelation(relation) {
    const proof = genealogyRecords.genealogyProofs[0];
    proof.data.relation = relation;
    this.refreshResearch();
    renderPersonDocuments("ux-person");
  },
  finishEdit() { finishPersonPageInlineEdit({ refresh: false }); }
};
window.__authNullAt = 0;
const finalUxRefreshSignup = refreshSignupAvailability;
refreshSignupAvailability = (...args) => {
  window.__authNullAt = Date.now();
  return finalUxRefreshSignup(...args);
};
`;

test("Recherches, qualifications et modale Attestation : finitions desktop et mobile sous WebKit", { timeout: 120000 }, async t => {
  let browser;
  try { browser = await webkit.launch({ headless: true }); }
  catch (error) { t.skip(`WebKit indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR", isMobile: true, hasTouch: true });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      return route.fulfill({ response, body: `${await response.text()}\n${AUTH_BOOTSTRAP_PATCH}\n${hooks}` });
    }
    return isAllowedRequest(url, server.baseURL) || url.includes("gstatic.com")
      ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  const nativeDialogs = [];
  page.on("dialog", dialog => { nativeDialogs.push(dialog.message()); dialog.accept().catch(() => {}); });
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__finalAttestationUX === "object");
    await page.waitForFunction(() => window.__authNullAt > 0, undefined, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => window.__finalAttestationUX.seed());
    await page.waitForFunction(() => document.querySelector('#directoryList [data-directory-person="ux-person"]'), { timeout: 10000 });
    await page.locator('#directoryList [data-directory-person="ux-person"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });

    const researchCards = page.locator("#personPageResearch .person-detail-research-card--proof");
    assert.equal(await researchCards.count(), 4, "quatre preuves consultables dans Recherches");
    const researchMetrics = await researchCards.first().evaluate(card => {
      const box = card.getBoundingClientRect();
      const badge = card.querySelector(".person-detail-research-qualification").getBoundingClientRect();
      const action = card.querySelector(".person-detail-research-action").getBoundingClientRect();
      const label = card.querySelector(".documentary-fact-label");
      const value = card.querySelector(".documentary-fact-value");
      const labelStyle = getComputedStyle(label);
      const valueStyle = getComputedStyle(value);
      return {
        active: card.innerText.includes("Active"),
        document: card.querySelector(".person-detail-research-document")?.innerText || "",
        lineCount: card.querySelectorAll(".person-detail-research-document").length,
        badgeCenter: (badge.top + badge.bottom) / 2,
        actionCenter: (action.top + action.bottom) / 2,
        cardCenter: (box.top + box.bottom) / 2,
        labelSize: labelStyle.fontSize, valueSize: valueStyle.fontSize,
        labelColor: labelStyle.color, valueColor: valueStyle.color,
        labelWeight: labelStyle.fontWeight, valueWeight: valueStyle.fontWeight,
        information: card.querySelector(".person-detail-research-information")?.innerText || ""
      };
    });
    assert.equal(researchMetrics.active, false, "pastille de statut technique absente des tuiles");
    assert.match(researchMetrics.document, /Registre paroissial ancien/, "document justificatif sur la ligne secondaire");
    assert.equal(researchMetrics.lineCount, 1, "une ligne documentaire par tuile");
    assert.ok(Math.abs(researchMetrics.badgeCenter - researchMetrics.cardCenter) <= 1, "capsule centrée verticalement dans la tuile desktop");
    assert.ok(Math.abs(researchMetrics.actionCenter - researchMetrics.cardCenter) <= 1, "chevron centré verticalement sur le même axe desktop");
    assert.equal(researchMetrics.labelSize, researchMetrics.valueSize, "catégorie et valeur de même taille");
    assert.equal(researchMetrics.labelColor, researchMetrics.valueColor, "catégorie et valeur de même couleur");
    assert.notEqual(researchMetrics.labelWeight, researchMetrics.valueWeight, "catégorie et valeur différenciées uniquement par la graisse");
    assert.match(researchMetrics.information, /Lieu de résidence\s*:\s*Orino \(ITA\) en 1932/i, "lieu et temporalité formulés naturellement");

    const qualificationStyles = await page.evaluate(() => {
      const relations = ["supports", "contradicts", "mentions", "ambiguous"];
      return relations.map(relation => {
        window.__finalAttestationUX.setRelation(relation);
        const badge = document.querySelector("#personPageResearch .documentary-qualification");
        const style = getComputedStyle(badge);
        return { relation, text: badge.textContent.trim(), background: style.backgroundColor, color: style.color };
      });
    });
    assert.deepEqual(qualificationStyles.map(item => item.text), ["Confirme", "Contredit", "Mentionne", "Ambiguë"], "quatre qualifications métier affichées en capsules");
    assert.equal(new Set(qualificationStyles.map(item => item.background)).size, 4, "chaque qualification a son fond sémantique");
    assert.equal(new Set(qualificationStyles.map(item => item.color)).size, 4, "chaque qualification a son texte sémantique");
    await page.evaluate(() => window.__finalAttestationUX.setRelation("supports"));
    await page.locator('#personPageResearch [data-view-proof="ux-proof-0"]').click();
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden);
    assert.match(await page.locator("#proofPageBadges").innerText(), /Active/, "statut métier conservé dans la fiche détaillée de la preuve");
    assert.equal(await page.locator("#proofPageBadges .documentary-qualification").innerText(), "Confirme", "qualification en capsule sur la fiche détaillée");
    await page.locator("#proofPageBackBtn").click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 568 });
      const mobileTile = await page.locator("#personPageResearch .person-detail-research-card--proof").first().evaluate(card => {
        const rect = selector => { const value = card.querySelector(selector).getBoundingClientRect(); return { top: value.top, bottom: value.bottom, left: value.left, right: value.right, width: value.width }; };
        const info = rect(".person-detail-research-information");
        const action = rect(".person-detail-research-action");
        const documentLine = rect(".person-detail-research-document");
        const badge = rect(".person-detail-research-qualification");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          infoActionSameRow: Math.abs((info.top + info.bottom) / 2 - (action.top + action.bottom) / 2) <= 4,
          documentBelow: documentLine.top >= Math.max(info.bottom, action.bottom) - 1,
          qualificationBelow: badge.top >= documentLine.bottom - 1,
          widths: [info.width, documentLine.width, badge.width]
        };
      });
      assert.equal(mobileTile.overflow, 0, `${width}px consultation sans débordement horizontal`);
      assert.ok(mobileTile.infoActionSameRow && mobileTile.documentBelow && mobileTile.qualificationBelow, `${width}px consultation en trois niveaux compacts : ${JSON.stringify(mobileTile)}`);

      await page.locator("#personPageEditBtn").click();
      await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
      const editableCard = page.locator("#personGenealogyEvidenceList .person-detail-research-card--proof").first();
      assert.equal(await page.locator("#personGenealogyEvidenceList .person-detail-research-card--proof").count(), 4, `${width}px quatre preuves en mode modification`);
      assert.doesNotMatch(await editableCard.innerText(), /Active/, `${width}px aucun statut Active dans la tuile modifiable`);
      assert.ok(await editableCard.locator("[data-edit-genealogy-proof]").isVisible(), `${width}px crayon de révision présent`);
      const editCardMetrics = await editableCard.evaluate(card => {
        const information = card.querySelector(".person-detail-research-information").getBoundingClientRect();
        const action = card.querySelector(".person-detail-research-action").getBoundingClientRect();
        const documentLine = card.querySelector(".person-detail-research-document").getBoundingClientRect();
        const badge = card.querySelector(".person-detail-research-qualification").getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          infoActionSameRow: Math.abs((information.top + information.bottom) / 2 - (action.top + action.bottom) / 2) <= 4,
          documentBelow: documentLine.top >= Math.max(information.bottom, action.bottom) - 1,
          qualificationBelow: badge.top >= documentLine.bottom - 1,
          width: card.getBoundingClientRect().width
        };
      });
      assert.equal(editCardMetrics.overflow, 0, `${width}px mode modification sans débordement`);
      assert.ok(editCardMetrics.infoActionSameRow && editCardMetrics.documentBelow && editCardMetrics.qualificationBelow, `${width}px modification en trois niveaux compacts`);
      await editableCard.locator("[data-edit-genealogy-proof]").click();
      await page.waitForFunction(() => document.getElementById("genealogyContributionDialog").open);
      await page.locator('#genealogyContributionDialog [data-close="genealogyContributionDialog"]').click().catch(() => {});
      if (await page.locator("#genealogyContributionDialog").evaluate(dialog => dialog.open)) await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open);
      await page.evaluate(() => window.__finalAttestationUX.finishEdit());
      await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    const desktopEditAlignment = await page.locator("#personGenealogyEvidenceList .person-detail-research-card--proof").first().evaluate(card => {
      const center = selector => { const box = card.querySelector(selector).getBoundingClientRect(); return (box.top + box.bottom) / 2; };
      return { card: (card.getBoundingClientRect().top + card.getBoundingClientRect().bottom) / 2, qualification: center(".person-detail-research-qualification"), action: center(".person-detail-research-action"), active: card.innerText.includes("Active") };
    });
    assert.equal(desktopEditAlignment.active, false, "mode modification sans pastille de statut technique");
    assert.ok(Math.abs(desktopEditAlignment.qualification - desktopEditAlignment.card) <= 1, "mode modification desktop : capsule centrée dans la tuile");
    assert.ok(Math.abs(desktopEditAlignment.action - desktopEditAlignment.card) <= 1, "mode modification desktop : crayon centré sur le même axe");
    await page.evaluate(() => window.__finalAttestationUX.finishEdit());
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);

    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : width === 390 ? 844 : 900 });
      await page.locator("#personPageEditBtn").click();
      await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
      await page.locator('#personPageDetailedJourney [data-journey-id="ux-event"] > summary').click();
      const attestationEdit = page.locator('#personPageDetailedJourney [data-journey-attestation-edit="event:ux-event:ux-attestation"]');
      assert.equal(await attestationEdit.count(), 1, `${width}px attestation existante modifiable`);
      await attestationEdit.evaluate(button => button.click());
      await page.waitForFunction(() => document.getElementById("personAttestationDialog").open);
      await page.waitForTimeout(180);
      const associationCapsules = await page.locator("#journeyAssociationList .documentary-qualification").evaluateAll(nodes => nodes.map(node => ({ text: node.textContent.trim(), tag: node.tagName, background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color })));
      assert.deepEqual(associationCapsules.map(item => item.text), ["Confirme", "Contredit", "Mentionne", "Ambiguë"], `${width}px qualifications des informations concernées`);
      assert.ok(associationCapsules.every(item => item.tag === "SPAN"), `${width}px capsules informatives non cliquables`);
      assert.equal(new Set(associationCapsules.map(item => item.background)).size, 4, `${width}px fonds sémantiques distincts`);
      assert.equal(new Set(associationCapsules.map(item => item.color)).size, 4, `${width}px couleurs de texte sémantiques distinctes`);
      if (width >= 761) {
        const desktopTable = await page.locator("#journeyAssociationList .attestation-table").evaluate(table => ({
          display: getComputedStyle(table).display,
          layout: getComputedStyle(table).tableLayout,
          headers: table.querySelectorAll("thead th").length,
          cellWidths: [...table.querySelectorAll("tbody tr:first-child td")].map(cell => Math.round(cell.getBoundingClientRect().width))
        }));
        assert.equal(desktopTable.display, "table", "desktop : le tableau garde sa structure native");
        assert.equal(desktopTable.layout, "fixed", "desktop : disposition tabulaire fixe préservée");
        assert.equal(desktopTable.headers, 5, "desktop : cinq colonnes métier conservées");
        assert.equal(desktopTable.cellWidths.length, 5, "desktop : largeurs des cinq colonnes présentes");
        assert.match(await page.locator("#journeyDocumentSelection").innerText(), /FICHIER_TECHNIQUE_DO_NOT_RENDER_001_2026_03\.pdf/, "desktop : métadonnée fichier de la tuile sélectionnée inchangée");
      }
      if (width < 761) {
        const mobile = await page.locator("#personAttestationDialog").evaluate(dialog => {
          const rect = selector => { const el = dialog.querySelector(selector); const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }; };
          const card = dialog.querySelector("#journeyAssociationList tr[data-journey-association]");
          const subject = card.querySelector('[data-col="subject"]');
          const information = card.querySelector('[data-col="fact"]');
          const documentLine = card.querySelector('[data-col="document"]');
          const qualification = card.querySelector('[data-col="qualification"]');
          const actions = card.querySelector('[data-col="action"]');
          const footerButtons = [...dialog.querySelectorAll(":scope > .modal-actions .right .btn")].map(el => { const b = el.getBoundingClientRect(); return { text: el.textContent.trim(), x: b.x, y: b.y, right: b.right, width: b.width, height: Math.round(b.height) }; });
          const close = dialog.querySelector("#closePersonAttestationDialogBtn");
          const closeBox = close.getBoundingClientRect();
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            card: rect("#journeyAssociationList tr[data-journey-association]"),
            listWidth: dialog.querySelector("#journeyAssociationList").getBoundingClientRect().width,
            cardOverflow: card.scrollWidth - card.clientWidth,
            nameWidth: subject.getBoundingClientRect().width,
            nameText: subject.innerText,
            infoY: information.getBoundingClientRect().top,
            documentY: documentLine.getBoundingClientRect().top,
            documentIcon: getComputedStyle(documentLine.querySelector(".attestation-mobile-document-icon")).display,
            labelVisible: [...card.querySelectorAll("td")].some(td => getComputedStyle(td, "::before").content !== "none"),
            qualificationCenter: (qualification.getBoundingClientRect().top + qualification.getBoundingClientRect().bottom) / 2,
            actionCenter: (actions.getBoundingClientRect().top + actions.getBoundingClientRect().bottom) / 2,
            qualification: qualification.innerText,
            footerButtons,
            closeSize: { width: Math.round(closeBox.width), height: Math.round(closeBox.height) },
            closeBorder: getComputedStyle(close).borderTopColor,
            closeOutline: getComputedStyle(close).outlineStyle,
            closeOutlineWidth: getComputedStyle(close).outlineWidth,
            closeFocusVisible: close.matches(":focus-visible"),
            initialFocusId: document.activeElement?.id || "",
            titleOutline: getComputedStyle(dialog.querySelector("#personAttestationDialogTitle")).outlineStyle,
            selectedText: dialog.querySelector("#journeyDocumentSelection").innerText,
            selectedChip: (() => {
              const chip = dialog.querySelector("#journeyDocumentSelection .attestation-document-chip");
              const open = chip.querySelector(".attestation-document-open");
              const title = open.querySelector(".attestation-document-title-mobile");
              const icon = open.querySelector(".attestation-doc-thumb");
              const remove = chip.querySelector("[data-journey-document-remove]");
              const box = chip.getBoundingClientRect();
              const titleBox = title.getBoundingClientRect();
              const iconBox = icon.getBoundingClientRect();
              const removeBox = remove.getBoundingClientRect();
              return { width: box.width, height: box.height, scrollWidth: chip.scrollWidth, clientWidth: chip.clientWidth,
                titleText: title.innerText, titleFits: titleBox.top >= box.top && titleBox.bottom <= box.bottom,
                iconCenter: (iconBox.top + iconBox.bottom) / 2, removeCenter: (removeBox.top + removeBox.bottom) / 2,
                removeHeight: Math.round(removeBox.height) };
            })(),
            filenameVisible: dialog.querySelector("#journeyDocumentSelection").innerText.includes("FICHIER_TECHNIQUE_DO_NOT_RENDER_001_2026_03.pdf"),
            pickRows: [...dialog.querySelectorAll("#journeyQuickDocumentList .attestation-pick-row")].map(row => {
              const title = row.querySelector(".attestation-document-title");
              const titleBox = title.getBoundingClientRect();
              const rowBox = row.getBoundingClientRect();
              const iconBox = row.querySelector(".attestation-pick-check").getBoundingClientRect();
              return { rowHeight: rowBox.height, titleHeight: titleBox.height, titleScrollHeight: title.scrollHeight, titleClientHeight: title.clientHeight, titleFits: titleBox.top >= rowBox.top && titleBox.bottom <= rowBox.bottom, iconCenter: (iconBox.top + iconBox.bottom) / 2, rowCenter: (rowBox.top + rowBox.bottom) / 2, title: title.innerText, type: row.querySelector(".attestation-document-type")?.innerText || "" };
            })
          };
        });
        assert.equal(mobile.overflow, 0, `${width}px modale sans débordement horizontal`);
        assert.equal(mobile.cardOverflow, 0, `${width}px carte d’information sans débordement`);
        assert.ok(mobile.card.width >= mobile.listWidth - 1, `${width}px carte indépendante des colonnes desktop, carte/liste ${mobile.card.width}/${mobile.listWidth}`);
        assert.ok(mobile.nameWidth > 180 && /Carlo Bartolomeo Giovannoni/.test(mobile.nameText), `${width}px nom complet sur toute la carte`);
        assert.ok(mobile.documentY > mobile.infoY && mobile.documentIcon !== "none", `${width}px document en ligne secondaire avec pictogramme`);
        assert.equal(mobile.labelVisible, false, `${width}px libellés de colonnes masqués`);
        assert.ok(Math.abs(mobile.qualificationCenter - mobile.actionCenter) <= 1, `${width}px capsule et actions alignées sur la même ligne`);
        assert.deepEqual(mobile.footerButtons.map(button => button.text), ["Annuler", "Enregistrer"], `${width}px ordre secondaire puis principal`);
        assert.ok(mobile.footerButtons.every(button => button.height >= 44), `${width}px deux CTA de 44 px minimum`);
        assert.ok(Math.abs(mobile.footerButtons[0].y - mobile.footerButtons[1].y) <= 1, `${width}px CTA côte à côte`);
        assert.ok(Math.abs(mobile.footerButtons[0].width - mobile.footerButtons[1].width) <= 1, `${width}px CTA de largeurs égales`);
        assert.ok(mobile.closeSize.width >= 44 && mobile.closeSize.height >= 44, `${width}px croix de 44 × 44 minimum`);
        assert.equal(mobile.closeBorder, "rgba(0, 0, 0, 0)", `${width}px croix sans bordure permanente`);
        assert.equal(mobile.initialFocusId, "personAttestationDialogTitle", `${width}px focus initial placé sur le titre plutôt que sur la croix`);
        assert.equal(mobile.titleOutline, "none", `${width}px titre focalisé sans contour décoratif`);
        assert.equal(mobile.closeFocusVisible, false, `${width}px aucune bordure de focus automatique sur la croix`);
        assert.ok(mobile.closeFocusVisible ? mobile.closeOutlineWidth === "3px" : mobile.closeOutline === "none", `${width}px contour initial simple, indicateur clavier conservé`);
        assert.equal(mobile.selectedChip.scrollWidth, mobile.selectedChip.clientWidth, `${width}px tuile sélectionnée sans débordement horizontal`);
        assert.ok(mobile.selectedChip.titleFits && mobile.selectedChip.height >= 44, `${width}px titre sélectionné contenu dans la tuile`);
        assert.ok(mobile.selectedChip.removeHeight >= 44 && Math.abs(mobile.selectedChip.iconCenter - mobile.selectedChip.removeCenter) <= 1, `${width}px pictogramme et corbeille centrés verticalement : ${JSON.stringify(mobile.selectedChip)}`);
        assert.equal(mobile.filenameVisible, false, `${width}px nom technique absent des documents sélectionnés`);
        const longPick = mobile.pickRows.find(row => row.title.includes("Registre paroissial ancien"));
        assert.ok(longPick && longPick.rowHeight >= 44 && longPick.titleHeight > 40 && longPick.titleScrollHeight <= longPick.titleClientHeight + 1 && longPick.titleFits, `${width}px titre long intégralement contenu dans sa tuile : ${JSON.stringify(longPick)}`);
        assert.ok(Math.abs(longPick.iconCenter - longPick.rowCenter) <= longPick.titleHeight / 2, `${width}px pictogramme + aligné au centre vertical de sa tuile`);
        assert.ok(mobile.pickRows.some(row => row.title === "Acte civil" && row.type === ""), `${width}px type masqué s’il répète le titre`);
        await page.fill("#journeyDocumentSearch", "Archives paroissiales");
        const libraryRow = page.locator('#journeyLibraryResults [data-journey-document-pick="ux-doc-library"]');
        await libraryRow.waitFor({ state: "visible" });
        const libraryMetrics = await libraryRow.evaluate(row => {
          const title = row.querySelector(".attestation-document-title");
          const rowBox = row.getBoundingClientRect();
          const titleBox = title.getBoundingClientRect();
          return { rowHeight: rowBox.height, titleHeight: titleBox.height, titleFits: titleBox.top >= rowBox.top && titleBox.bottom <= rowBox.bottom, overflow: row.scrollWidth - row.clientWidth };
        });
        assert.ok(libraryMetrics.rowHeight >= 44 && libraryMetrics.titleHeight > 20 && libraryMetrics.titleFits && libraryMetrics.overflow === 0, `${width}px résultat long de bibliothèque entièrement contenu : ${JSON.stringify(libraryMetrics)}`);
        await libraryRow.click();
        assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 2, `${width}px sélection bibliothèque fonctionnelle`);
        assert.doesNotMatch(await page.locator("#journeyDocumentSelection").innerText(), /FICHIER_TECHNIQUE_DO_NOT_RENDER|FICHIER_TECHNIQUE_LIBRARY/, `${width}px noms de fichiers techniques masqués`);
        await page.locator('#journeyDocumentSelection [data-journey-document-remove="ux-doc-library"]').click();
        assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 1, `${width}px retrait de document sélectionné fonctionnel`);
        await page.fill("#journeyDocumentSearch", "");
        await page.locator("#journeyAssociationList [data-journey-association-edit]").first().click();
        assert.match(await page.locator("#journeySourceValue").inputValue(), /Orino/, `${width}px crayon d’information ouvre l’édition préremplie`);
        await page.locator("#journeyInfoPanel [data-journey-panel-close]").click();
        await page.locator('#personAttestationDialog [data-journey-attestation-panel-open="info"]').click();
        const panelMetrics = await page.locator("#journeyInfoPanel").evaluate(panel => {
          const add = panel.querySelector("[data-journey-association-add]").getBoundingClientRect();
          const body = document.querySelector("#personAttestationDialog .person-attestation-modal-body").getBoundingClientRect();
          const fields = [...panel.querySelectorAll(".field")].map(field => field.getBoundingClientRect().height);
          return { addWidth: add.width, actionWidth: panel.querySelector(".attestation-panel-actions--end").getBoundingClientRect().width, panelWidth: panel.getBoundingClientRect().width, fields };
        });
        assert.ok(panelMetrics.addWidth >= panelMetrics.actionWidth - 2, `${width}px CTA interne pleine largeur : ${JSON.stringify(panelMetrics)}`);
        assert.ok(panelMetrics.fields.filter(height => height > 0).every(height => height >= 44), `${width}px champs et sélecteurs natifs de 44 px minimum`);
        await page.locator("#journeyInfoPanel [data-journey-panel-close]").click();
      }
      await page.locator('#personAttestationDialog [data-journey-attestation-cancel]').click();
      await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open);
      await page.locator('#personPageEditHost [data-close="personDialog"]').click();
      await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    }

    assert.deepEqual(nativeDialogs, [], "aucune confirmation native pendant la consultation des interfaces");
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
