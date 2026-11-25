import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { webkit } from "playwright";
import { AUTH_BOOTSTRAP_PATCH, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const longTitle = "Registre paroissial ancien — actes de naissance, mariage et décès de la commune d’Orino, volume III, folios 12 à 84";
const longFileName = "FICHIER_TECHNIQUE_DO_NOT_RENDER_001_2026_03.pdf";
const screenshotDir = process.env.ATTESTATION_UX_SCREENSHOT_DIR || "";
async function captureAttestationScreenshot(page, name) {
  if (!screenshotDir) return;
  await page.screenshot({ path: join(screenshotDir, name) });
}
const hooks = `
window.__finalAttestationUX = {
  seed() {
    const id = "ux-person";
    people = [
      { id, firstName: "Carlo", middleName: "Bartolomeo", lastName: "Giovannoni", gender: "M", inTree: true,
        birthDateInfo: { type: "year", year: 1890 }, deathDateInfo: { type: "year", year: 1940 },
        residences: [{ id: "ux-residence", place: "Orino", dateInfo: { type: "year", year: 1932 }, attestations: [] }],
        professions: [{ id: "ux-profession", label: "Agriculteur", dateInfo: { type: "year", year: 1934 }, attestations: [] }],
        lifeEvents: [{
          id: "ux-event", kind: "census", label: "Recensement", dateInfo: { type: "year", year: 1932 }, showInLifeTimeline: false,
          attestations: [{ id: "ux-attestation", date: { type: "year", year: 1932 }, comment: "Attestation existante", documentIds: ["ux-doc-long"], sourceIds: [], proofIds: [] }]
        }]
      },
      { id: "ux-spouse", firstName: "Rosa", lastName: "Conti", gender: "F", inTree: true, birthDateInfo: { type: "year", year: 1892 } }
    ];
    /* Union : rend « applicable » le champ de la deuxième personne (relation). */
    families = [{ id: "ux-family", partnerIds: [id, "ux-spouse"], childIds: [], relationType: "marriage",
      unionDateInfo: { type: "year", year: 1912 }, endType: "none", endDateInfo: { type: "unknown" }, parentChildLinks: [] }];
    documents = [
      { id: "ux-doc-long", title: "${longTitle}", type: "Registre", fileName: "${longFileName}", mimeType: "application/pdf", personIds: [id] },
      { id: "ux-doc-same", title: "Acte civil", type: "Acte civil", fileName: "technical-acte.pdf", mimeType: "application/pdf", personIds: [id] },
      { id: "ux-doc-marriage", title: "Acte de Mariage Carlo Giovannoni et Rosa Conti", type: "Acte de mariage", fileName: "mariage-technique.pdf", mimeType: "application/pdf", personIds: [id] },
      { id: "ux-doc-birth", title: "Acte de Naissance Carlo Bartolomeo Giovannoni", type: "Acte de naissance", fileName: "naissance-technique.pdf", mimeType: "application/pdf", personIds: [id] },
      { id: "ux-doc-library", title: "Archives paroissiales — Décès journal Chroniques Messines, transcription intégrale de l’acte et de ses annotations marginales conservées au registre communal", type: "Chroniques Messines", fileName: "FICHIER_TECHNIQUE_LIBRARY_002.pdf", mimeType: "application/pdf", personIds: [] }
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
  setSourceDate(dateInfo) {
    journeyAttestationDraft.composerSourceDateInfo = { ...dateInfo };
    renderJourneyAssociationPanels();
  },
  prepareNewAttestationDocument() {
    journeyAttestationDraft.documentIds = ["ux-doc-long"];
    journeyAttestationDraft.composerDocumentId = "ux-doc-long";
    renderJourneyDocumentSelection();
    renderJourneyPanelActions();
  },
  openNewAttestation() { journeyOpenEditor({ type: "attestation", entryKind: "event", mode: "add", entryId: "ux-event" }); },
  readDate(scope) { return readJourneyDateRaw(scope); },
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
    if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__finalAttestationUX === "object");
    await page.waitForFunction(() => window.__authNullAt > 0, undefined, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => window.__finalAttestationUX.seed());
    await page.waitForFunction(() => document.querySelector('#directoryList [data-directory-person="ux-person"]'), { timeout: 10000 });
    await page.locator('#directoryList [data-directory-person="ux-person"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });

    const researchCards = page.locator("#personPageResearch .person-detail-research-card--proof");
    assert.equal(await researchCards.count(), 4, "quatre preuves consultables dans Recherches");
    assert.equal(await page.locator("#personPageResearchTitle").innerText(), "Recherches", "titre de section présent en consultation");
    const consultationInfo = await researchCards.first().locator(".person-detail-research-information").innerText();
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
        information: card.querySelector(".person-detail-research-information")?.innerText || "",
        afterContent: getComputedStyle(card, "::after").content,
        chevronSpans: card.querySelectorAll(".person-detail-research-chevron").length,
        editIndicators: card.querySelectorAll(".person-detail-research-edit").length,
        viewAttr: card.getAttribute("data-view-proof")
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
    assert.equal(researchMetrics.afterContent, "none", "consultation desktop : aucun chevron pseudo-élément (double chevron corrigé)");
    assert.equal(researchMetrics.chevronSpans, 1, "consultation desktop : exactement un chevron");
    assert.equal(researchMetrics.editIndicators, 0, "consultation desktop : aucun crayon");
    assert.equal(researchMetrics.viewAttr, "ux-proof-0", "consultation : la tuile ouvre la bonne fiche Preuve");

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

    for (const width of [390, 375, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await page.waitForTimeout(300);
      const mobileTile = await page.locator("#personPageResearch .person-detail-research-card--proof").first().evaluate(card => {
        const rect = selector => { const value = card.querySelector(selector).getBoundingClientRect(); return { top: value.top, bottom: value.bottom, left: value.left, right: value.right, width: value.width }; };
        const box = card.getBoundingClientRect();
        const info = rect(".person-detail-research-information");
        const action = rect(".person-detail-research-action");
        const documentLine = rect(".person-detail-research-document");
        const badge = rect(".person-detail-research-qualification");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          docBelowInfo: documentLine.top >= info.bottom - 1,
          qualBelowDoc: badge.top >= documentLine.bottom - 1,
          actionCenter: Math.round(((action.top + action.bottom) / 2) * 10) / 10,
          cardCenter: Math.round(((box.top + box.bottom) / 2) * 10) / 10,
          actionCentered: Math.abs((action.top + action.bottom) / 2 - (box.top + box.bottom) / 2) <= 1,
          noHorizontalOverlap: documentLine.right <= action.left + 0.6 && info.right <= action.left + 0.6,
          gapInfoDoc: Math.round((documentLine.top - info.bottom) * 10) / 10,
          gapDocQual: Math.round((badge.top - documentLine.bottom) * 10) / 10
        };
      });
      assert.equal(mobileTile.overflow, 0, `${width}px consultation sans débordement horizontal`);
      assert.ok(mobileTile.docBelowInfo && mobileTile.qualBelowDoc, `${width}px consultation en trois niveaux empilés : ${JSON.stringify(mobileTile)}`);
      assert.ok(mobileTile.actionCentered, `${width}px chevron centré verticalement sur le même axe que la tuile : ${JSON.stringify(mobileTile)}`);
      assert.equal(mobileTile.noHorizontalOverlap, true, `${width}px texte et chevron sans chevauchement horizontal : ${JSON.stringify(mobileTile)}`);
      assert.ok(mobileTile.gapInfoDoc >= 6 && mobileTile.gapInfoDoc <= 10 && mobileTile.gapDocQual >= 6 && mobileTile.gapDocQual <= 10, `${width}px espacements réguliers entre éléments textuels (${mobileTile.gapInfoDoc}/${mobileTile.gapDocQual}px)`);

      await page.locator("#personPageEditBtn").click();
      await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
      assert.equal(await page.locator("#personGenealogyEvidenceSection h4").innerText(), "Recherches", `${width}px titre « Recherches » restauré en modification mobile`);
      const editableCard = page.locator("#personGenealogyEvidenceList .person-detail-research-card--proof").first();
      assert.equal(await page.locator("#personGenealogyEvidenceList .person-detail-research-card--proof").count(), 4, `${width}px quatre preuves en mode modification`);
      assert.doesNotMatch(await editableCard.innerText(), /Active/, `${width}px aucun statut Active dans la tuile modifiable`);
      assert.equal(await editableCard.locator(".person-detail-research-information").innerText(), consultationInfo, `${width}px contenu documentaire identique à la consultation`);
      const editIndicators = await editableCard.evaluate(card => ({
        editAttrs: (card.hasAttribute("data-edit-genealogy-proof") ? 1 : 0) + card.querySelectorAll("[data-edit-genealogy-proof]").length,
        viewAttrs: (card.hasAttribute("data-view-proof") ? 1 : 0) + card.querySelectorAll("[data-view-proof]").length,
        chevrons: card.querySelectorAll(".person-detail-research-chevron").length,
        afterContent: getComputedStyle(card, "::after").content
      }));
      assert.deepEqual(editIndicators, { editAttrs: 1, viewAttrs: 0, chevrons: 0, afterContent: "none" }, `${width}px modification : exactement un crayon, aucun chevron, attribution unique`);
      const editCardMetrics = await editableCard.evaluate(card => {
        const box = card.getBoundingClientRect();
        const information = card.querySelector(".person-detail-research-information").getBoundingClientRect();
        const action = card.querySelector(".person-detail-research-action").getBoundingClientRect();
        const documentLine = card.querySelector(".person-detail-research-document").getBoundingClientRect();
        const badge = card.querySelector(".person-detail-research-qualification").getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          docBelowInfo: documentLine.top >= information.bottom - 1,
          qualBelowDoc: badge.top >= documentLine.bottom - 1,
          actionCentered: Math.abs((action.top + action.bottom) / 2 - (box.top + box.bottom) / 2) <= 1,
          noHorizontalOverlap: documentLine.right <= action.left + 0.6 && information.right <= action.left + 0.6,
          gapInfoDoc: Math.round((documentLine.top - information.bottom) * 10) / 10,
          gapDocQual: Math.round((badge.top - documentLine.bottom) * 10) / 10,
          width: card.getBoundingClientRect().width
        };
      });
      assert.equal(editCardMetrics.overflow, 0, `${width}px mode modification sans débordement`);
      assert.ok(editCardMetrics.docBelowInfo && editCardMetrics.qualBelowDoc, `${width}px modification en trois niveaux empilés`);
      assert.ok(editCardMetrics.actionCentered, `${width}px crayon centré verticalement dans la tuile de modification`);
      assert.equal(editCardMetrics.noHorizontalOverlap, true, `${width}px texte et crayon sans chevauchement horizontal : ${JSON.stringify(editCardMetrics)}`);
      assert.ok(editCardMetrics.gapInfoDoc >= 6 && editCardMetrics.gapInfoDoc <= 10 && editCardMetrics.gapDocQual >= 6 && editCardMetrics.gapDocQual <= 10, `${width}px espacements réguliers en modification (${editCardMetrics.gapInfoDoc}/${editCardMetrics.gapDocQual}px)`);
      await editableCard.click();
      await page.waitForFunction(() => document.getElementById("genealogyContributionDialog").open);
      await page.locator('#genealogyContributionDialog [data-close="genealogyContributionDialog"]').click().catch(() => {});
      if (await page.locator("#genealogyContributionDialog").evaluate(dialog => dialog.open)) await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open);
      // CTA d'ajout harmonisés en modification mobile
      const ctas = await page.evaluate(() => {
        const rect = el => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x) }; };
        const addDoc = document.getElementById("linkDocumentBtn");
        const addProof = document.getElementById("genealogyProposeProofForPersonBtn");
        const section = addDoc.closest(".person-documents");
        const cs = getComputedStyle(section);
        const bcs = getComputedStyle(addDoc);
        return { addDoc: rect(addDoc), addProof: rect(addProof), sectionClient: Math.round(section.clientWidth),
          sectionPad: [cs.paddingLeft, cs.paddingRight], sectionDisplay: cs.display,
          justifySelf: bcs.justifySelf, btnWidth: bcs.width, btnBox: bcs.boxSizing,
          justify: bcs.justifyContent, label1: addDoc.innerText.trim(), label2: addProof.innerText.trim() };
      });
      assert.equal(ctas.label1, "Ajouter un document", `${width}px libellé document conservé`);
      assert.equal(ctas.label2, "Ajouter une preuve", `${width}px libellé preuve conservé`);
      assert.equal(ctas.addDoc.w, ctas.addProof.w, `${width}px CTA d'ajout de largeurs identiques (${ctas.addDoc.w}/${ctas.addProof.w})`);
      const sectionInner = ctas.sectionClient - Number.parseFloat(ctas.sectionPad[0]) - Number.parseFloat(ctas.sectionPad[1]);
      assert.ok(Math.abs(ctas.addDoc.w - sectionInner) <= 2, `${width}px CTA d'ajout pleine largeur intérieure (${ctas.addDoc.w}/${sectionInner}, pad=${ctas.sectionPad}, justifySelf=${ctas.justifySelf}, width=${ctas.btnWidth})`);
      assert.ok(ctas.addDoc.h >= 44 && ctas.addProof.h >= 44, `${width}px CTA d'ajout ≥ 44 px`);
      assert.equal(ctas.justify, "center", `${width}px pictogramme et libellé centrés dans les CTA`);
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

    for (const width of [1280, 390, 375, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : width === 375 ? 812 : width === 390 ? 844 : 900 });
      await page.locator("#personPageEditBtn").click();
      await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
      await page.locator('#personPageDetailedJourney [data-journey-id="ux-event"] > summary').click();
      const attestationEdit = page.locator('#personPageDetailedJourney [data-journey-attestation-edit="event:ux-event:ux-attestation"]');
      assert.equal(await attestationEdit.count(), 1, `${width}px attestation existante modifiable`);
      await attestationEdit.evaluate(button => button.click());
      await page.waitForFunction(() => document.getElementById("personAttestationDialog").open);
      await page.waitForTimeout(180);
      if (width === 375 || width === 390) await captureAttestationScreenshot(page, `attestation-${width}-documents.png`);
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
              const type = open.querySelector(".attestation-document-type-mobile");
              const icon = open.querySelector(".attestation-doc-thumb");
              const remove = chip.querySelector("[data-journey-document-remove]");
              const box = chip.getBoundingClientRect();
              const titleBox = title.getBoundingClientRect();
              const typeBox = type ? type.getBoundingClientRect() : null;
              const iconBox = icon.getBoundingClientRect();
              const removeBox = remove.getBoundingClientRect();
              return { width: box.width, height: box.height, scrollWidth: chip.scrollWidth, clientWidth: chip.clientWidth,
                titleText: title.innerText, titleFits: titleBox.top >= box.top && titleBox.bottom <= box.bottom,
                titleFontSize: getComputedStyle(title).fontSize,
                typeFits: typeBox ? typeBox.top >= box.top && typeBox.bottom <= box.bottom : null,
                typeFontSize: type ? getComputedStyle(type).fontSize : null,
                iconCenter: (iconBox.top + iconBox.bottom) / 2, removeCenter: (removeBox.top + removeBox.bottom) / 2,
                removeHeight: Math.round(removeBox.height) };
            })(),
            filenameVisible: dialog.querySelector("#journeyDocumentSelection").innerText.includes("FICHIER_TECHNIQUE_DO_NOT_RENDER_001_2026_03.pdf"),
            factText: information.innerText,
            documentBorder: getComputedStyle(documentLine).borderBottomWidth,
            qualificationBorderTop: getComputedStyle(qualification).borderTopWidth,
            actionBorderTop: getComputedStyle(actions).borderTopWidth,
            pickRows: [...dialog.querySelectorAll("#journeyQuickDocumentList .attestation-pick-row")].map(row => {
              const title = row.querySelector(".attestation-document-title");
              const titleBox = title.getBoundingClientRect();
              const rowBox = row.getBoundingClientRect();
              const iconBox = row.querySelector(".attestation-pick-check").getBoundingClientRect();
              const type = row.querySelector(".attestation-document-type");
              const typeBox = type ? type.getBoundingClientRect() : null;
              const lineRects = element => {
                const range = document.createRange();
                range.selectNodeContents(element);
                return [...range.getClientRects()].map(rect => ({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }));
              };
              const titleLines = lineRects(title);
              const typeLines = type ? lineRects(type) : [];
              return { titleText: title.innerText, selected: row.classList.contains("is-selected"), rowHeight: rowBox.height, rowTop: rowBox.top, rowBottom: rowBox.bottom, rowLeft: rowBox.left, rowRight: rowBox.right,
                titleHeight: titleBox.height, titleScrollHeight: title.scrollHeight, titleClientHeight: title.clientHeight,
                titleFits: titleLines.length > 0 && titleLines.every(rect => rect.top >= rowBox.top - 0.5 && rect.bottom <= rowBox.bottom + 0.5 && rect.left >= rowBox.left - 0.5 && rect.right <= rowBox.right + 0.5),
                titleFontSize: getComputedStyle(title).fontSize,
                titleFontWeight: getComputedStyle(title).fontWeight,
                titleLineHeight: getComputedStyle(title).lineHeight,
                titleLineRects: titleLines,
                typeFits: typeBox ? typeLines.length > 0 && typeLines.every(rect => rect.top >= rowBox.top - 0.5 && rect.bottom <= rowBox.bottom + 0.5 && rect.left >= rowBox.left - 0.5 && rect.right <= rowBox.right + 0.5) : null,
                typeFontSize: type ? getComputedStyle(type).fontSize : null,
                typeFontWeight: type ? getComputedStyle(type).fontWeight : null,
                typeLineRects: typeLines,
                iconCenter: (iconBox.top + iconBox.bottom) / 2, rowCenter: (rowBox.top + rowBox.bottom) / 2,
                title: title.innerText, type: type?.innerText || "" };
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
        assert.equal(mobile.selectedChip.titleFontSize, "14px", `${width}px titre sélectionné calculé à 14px`);
        assert.equal(mobile.selectedChip.typeFits, true, `${width}px type sélectionné contenu dans la tuile`);
        assert.equal(mobile.selectedChip.typeFontSize, "12px", `${width}px type sélectionné calculé à 12px`);
        assert.ok(mobile.selectedChip.removeHeight >= 44 && Math.abs(mobile.selectedChip.iconCenter - mobile.selectedChip.removeCenter) <= 1, `${width}px pictogramme et corbeille centrés verticalement : ${JSON.stringify(mobile.selectedChip)}`);
        assert.equal(mobile.filenameVisible, false, `${width}px nom technique absent des documents sélectionnés`);
        const longPick = mobile.pickRows.find(row => row.title.includes("Registre paroissial ancien"));
        assert.ok(longPick && longPick.rowHeight >= 44 && longPick.titleHeight > 40 && longPick.titleScrollHeight <= longPick.titleClientHeight + 1 && longPick.titleFits, `${width}px titre long intégralement contenu dans sa tuile : ${JSON.stringify(longPick)}`);
        assert.ok(Math.abs(longPick.iconCenter - longPick.rowCenter) <= longPick.titleHeight / 2, `${width}px pictogramme + aligné au centre vertical de sa tuile`);
        assert.equal(longPick.titleFontWeight, "500", `${width}px titre de sélection à graisse moyenne`);
        assert.ok(mobile.pickRows.some(row => row.title.includes("Acte de Mariage Carlo Giovannoni et Rosa Conti") && row.titleFits && row.typeFits), `${width}px intitulé de mariage et son type contenus dans la tuile`);
        assert.ok(mobile.pickRows.some(row => row.title.includes("Acte de Naissance Carlo Bartolomeo Giovannoni") && row.titleFits && row.typeFits), `${width}px intitulé de naissance et son type contenus dans la tuile`);
        assert.equal(longPick.selected, true, `${width}px document déjà sélectionné garde son état sélectionné sans rognage`);
        assert.equal(mobile.pickRows.find(row => row.title.includes("Acte de Mariage Carlo Giovannoni et Rosa Conti")).selected, false, `${width}px document non sélectionné garde son état initial`);
        assert.ok(mobile.pickRows.some(row => row.title === "Acte civil" && row.type === ""), `${width}px type masqué s’il répète le titre`);
        const shortPick = mobile.pickRows.find(row => row.title === "Acte civil");
        assert.ok(longPick.rowHeight > shortPick.rowHeight + 20, `${width}px la hauteur augmente réellement avec le contenu (${longPick.rowHeight} > ${shortPick.rowHeight})`);
        assert.ok(mobile.pickRows.every(row => row.titleFontSize === "14px"), `${width}px titres documentaires calculés à 14px`);
        assert.ok(mobile.pickRows.filter(row => row.type).every(row => row.typeFontSize === "12px" && row.typeFontWeight === "400"), `${width}px types documentaires calculés à 12px en graisse normale`);
        assert.ok(mobile.pickRows.every((row, index) => index === 0 || row.rowTop >= mobile.pickRows[index - 1].rowBottom - 0.6), `${width}px tuiles voisines sans chevauchement vertical`);
        assert.equal(new Set(mobile.pickRows.map(row => Math.round(row.rowTop * 10) / 10)).size, mobile.pickRows.length, `${width}px chaque tuile commence sur sa propre rangée`);
        assert.equal(mobile.factText.split("\n").some(line => line.trim() === ":"), false, `${width}px aucune ligne contenant uniquement les deux-points`);
        assert.match(mobile.factText, /Lieu de résidence\s*:\s*Orino \(ITA\) en 1932/, `${width}px catégorie et valeur attachées par la ponctuation`);
        assert.equal(mobile.documentBorder, "1px", `${width}px séparateur unique sous le document`);
        assert.equal(mobile.qualificationBorderTop, "0px", `${width}px aucun fragment de séparateur sur la qualification`);
        assert.equal(mobile.actionBorderTop, "0px", `${width}px aucun fragment de séparateur sur les actions`);
        await page.fill("#journeyDocumentSearch", "Archives paroissiales");
        const libraryRow = page.locator('#journeyLibraryResults [data-journey-document-pick="ux-doc-library"]');
        await libraryRow.waitFor({ state: "visible" });
        const libraryMetrics = await libraryRow.evaluate(row => {
          const title = row.querySelector(".attestation-document-title");
          const type = row.querySelector(".attestation-document-type");
          const rowBox = row.getBoundingClientRect();
          const titleBox = title.getBoundingClientRect();
          const typeBox = type ? type.getBoundingClientRect() : null;
          return { selected: row.getAttribute("aria-pressed"), rowHeight: rowBox.height, titleHeight: titleBox.height, titleFits: titleBox.top >= rowBox.top && titleBox.bottom <= rowBox.bottom,
            titleFontSize: getComputedStyle(title).fontSize,
            typeFits: typeBox ? typeBox.top >= rowBox.top && typeBox.bottom <= rowBox.bottom : null,
            typeFontSize: type ? getComputedStyle(type).fontSize : null,
            overflow: row.scrollWidth - row.clientWidth };
        });
        assert.ok(libraryMetrics.rowHeight >= 44 && libraryMetrics.titleHeight > 20 && libraryMetrics.titleFits && libraryMetrics.overflow === 0, `${width}px résultat long de bibliothèque entièrement contenu : ${JSON.stringify(libraryMetrics)}`);
        assert.equal(libraryMetrics.titleFontSize, "14px", `${width}px titre bibliothèque calculé à 14px`);
        assert.equal(libraryMetrics.typeFits, true, `${width}px type bibliothèque contenu dans la tuile`);
        assert.equal(libraryMetrics.typeFontSize, "12px", `${width}px type bibliothèque calculé à 12px`);
        assert.equal(libraryMetrics.selected, "false", `${width}px tuile bibliothèque non sélectionnée avant appui`);
        assert.ok(libraryMetrics.rowHeight > 44, `${width}px titre très long de la bibliothèque augmente la hauteur réelle (${libraryMetrics.rowHeight}px)`);
        await libraryRow.click();
        assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 2, `${width}px sélection bibliothèque fonctionnelle`);
        const selectedLibraryPick = await page.locator('#journeyLibraryResults [data-journey-document-pick="ux-doc-library"]').evaluate(row => ({ selected: row.getAttribute("aria-pressed"), classSelected: row.classList.contains("is-selected"), icon: row.querySelector(".attestation-pick-check use")?.getAttribute("href"), background: getComputedStyle(row).backgroundColor }));
        assert.deepEqual(selectedLibraryPick, { selected: "true", classSelected: true, icon: "#icon-check", background: "rgb(231, 239, 232)" }, `${width}px coche et fond vert pâle préservés après sélection`);
        assert.doesNotMatch(await page.locator("#journeyDocumentSelection").innerText(), /FICHIER_TECHNIQUE_DO_NOT_RENDER|FICHIER_TECHNIQUE_LIBRARY/, `${width}px noms de fichiers techniques masqués`);
        const selectedLibraryMetrics = await page.locator('#journeyDocumentSelection .attestation-document-chip').filter({ has: page.locator('[data-journey-document-remove="ux-doc-library"]') }).evaluate(chip => {
          const box = chip.getBoundingClientRect();
          const open = chip.querySelector(".attestation-document-open");
          const title = open.querySelector(".attestation-document-title-mobile");
          const type = open.querySelector(".attestation-document-type-mobile");
          const contained = element => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const rects = [...range.getClientRects()];
            return rects.length > 0 && rects.every(rect => rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5 && rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5);
          };
          return { height: box.height, titleFits: contained(title), typeFits: contained(type), titleSize: getComputedStyle(title).fontSize, titleWeight: getComputedStyle(title).fontWeight, typeSize: getComputedStyle(type).fontSize, scrollWidth: chip.scrollWidth, clientWidth: chip.clientWidth };
        });
        assert.ok(selectedLibraryMetrics.height > 44 && selectedLibraryMetrics.titleFits && selectedLibraryMetrics.typeFits, `${width}px titre très long sélectionné et métadonnée contenus sans troncature : ${JSON.stringify(selectedLibraryMetrics)}`);
        assert.equal(selectedLibraryMetrics.titleSize, "14px", `${width}px titre sélectionné à 14px`);
        assert.equal(selectedLibraryMetrics.titleWeight, "500", `${width}px titre sélectionné à graisse moyenne`);
        assert.equal(selectedLibraryMetrics.typeSize, "12px", `${width}px métadonnée sélectionnée à 12px`);
        assert.equal(selectedLibraryMetrics.scrollWidth, selectedLibraryMetrics.clientWidth, `${width}px tuile sélectionnée sans débordement horizontal`);
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
        /* §10.3 — champs numérotés alignés sur la marge du panneau (référence
           « Lieu attesté »), dimensions et polices calculées identiques. */
        const residenceFact = await page.locator("#journeyAssociationFact option").evaluateAll(nodes => nodes.find(node => node.textContent.includes("Lieu de résidence"))?.value || "");
        assert.ok(residenceFact, `${width}px fait « Lieu de résidence » disponible`);
        await page.locator("#journeyAssociationFact").selectOption(residenceFact);
        await page.waitForSelector("#journeySourceValue");
        const formMetrics = await page.locator("#journeyInfoPanel").evaluate(panel => {
          const rect = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, font: getComputedStyle(el).fontSize }; };
          const controls = ["#journeyAssociationSubjectSearch", "#journeyAssociationFact", "#journeyAssociationDocument", "#journeySourceValue", "#journeyAssociationRelation"]
            .map(sel => panel.querySelector(sel)).filter(el => el && el.getBoundingClientRect().height > 0).map(el => ({ sel: el.id, ...rect(el) }));
          const sw = panel.querySelector(".date-type-switch");
          const swRect = sw.getBoundingClientRect();
          const dateButtons = [...sw.querySelectorAll(".date-type-button")];
          const active = sw.querySelector(".date-type-button.active");
          const activeRect = active.getBoundingClientRect();
          const results = panel.querySelector("#journeySubjectResults");
          const sourceValue = panel.querySelector("#journeySourceValue");
          return {
            controls,
            allSameLeft: Math.max(...controls.map(c => c.x)) - Math.min(...controls.map(c => c.x)) <= 2,
            allSameWidth: Math.max(...controls.map(c => c.w)) - Math.min(...controls.map(c => c.w)) <= 2,
            allHeights44: controls.every(c => c.h >= 44),
            allFonts16: controls.every(c => c.font === "16px"),
            date: {
              wrap: getComputedStyle(sw).flexWrap,
              count: dateButtons.length,
              clientWidth: sw.clientWidth,
              scrollWidth: sw.scrollWidth,
              width: swRect.width,
              rows: new Set(dateButtons.map(b => Math.round(b.getBoundingClientRect().top))).size,
              buttonsUncompressed: dateButtons.every(button => getComputedStyle(button).flexShrink === "0" && getComputedStyle(button).whiteSpace === "nowrap"),
              activeVisible: activeRect.left >= swRect.left - 1 && activeRect.right <= swRect.right + 1,
              contentInsideForm: swRect.left >= panel.getBoundingClientRect().left - 1 && swRect.right <= panel.getBoundingClientRect().right + 1
            },
            resultsClosed: { display: getComputedStyle(results).display, border: getComputedStyle(results).borderTopWidth },
            sourceLeft: sourceValue ? Math.round(sourceValue.getBoundingClientRect().x * 10) / 10 : null
          };
        });
        assert.equal(formMetrics.allSameLeft, true, `${width}px champs numérotés et « Lieu attesté » sur la même marge gauche : ${JSON.stringify(formMetrics.controls)}`);
        assert.equal(formMetrics.allSameWidth, true, `${width}px largeurs intérieures identiques`);
        assert.equal(formMetrics.allHeights44, true, `${width}px hauteurs calculées ≥ 44 px`);
        assert.equal(formMetrics.allFonts16, true, `${width}px polices de saisie calculées à 16 px`);
        assert.equal(formMetrics.date.wrap, "nowrap", `${width}px sélecteur de date sur une ligne unique`);
        assert.ok(formMetrics.date.count >= 5, `${width}px les cinq précisions de date sont présentes (${formMetrics.date.count})`);
        assert.equal(formMetrics.date.rows, 1, `${width}px toutes les options de date appartiennent à une seule rangée`);
        assert.ok(formMetrics.date.scrollWidth > formMetrics.date.clientWidth, `${width}px options accessibles par défilement horizontal natif`);
        assert.equal(formMetrics.date.buttonsUncompressed, true, `${width}px options non compressibles et libellés sans retour à la ligne`);
        assert.equal(formMetrics.date.contentInsideForm, true, `${width}px slider dans la largeur du formulaire`);
        assert.equal(formMetrics.date.activeVisible, true, `${width}px option de date active visible`);
        const dateSlider = page.locator("#journeyInfoPanel [data-journey-date] .date-type-switch").first();
        await dateSlider.evaluate(element => { element.scrollLeft = element.scrollWidth; });
        const lastDateOptionVisible = await dateSlider.locator('[data-journey-date-type="unknown"]').evaluate(button => {
          const viewport = button.closest(".date-type-switch").getBoundingClientRect();
          const option = button.getBoundingClientRect();
          return option.left >= viewport.left - 1 && option.right <= viewport.right + 1;
        });
        assert.equal(lastDateOptionVisible, true, `${width}px défilement jusqu’à « Inconnue »`);
        for (const mode of ["year", "about", "between", "unknown", "exact"]) {
          const option = dateSlider.locator(`[data-journey-date-type="${mode}"]`);
          await option.click();
          const activeDateOption = await option.evaluate(button => {
            const viewport = button.closest(".date-type-switch").getBoundingClientRect();
            const rect = button.getBoundingClientRect();
            return { selected: button.getAttribute("aria-pressed"), active: button.classList.contains("active"), visible: rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1, rows: new Set([...button.closest(".date-type-switch").querySelectorAll(".date-type-button")].map(node => Math.round(node.getBoundingClientRect().top))).size };
          });
          assert.equal(activeDateOption.selected, "true", `${width}px mode ${mode} sélectionnable au clavier/à l’appui`);
          assert.equal(activeDateOption.active, true, `${width}px mode ${mode} visuellement actif`);
          assert.equal(activeDateOption.visible, true, `${width}px option active ${mode} amenée dans la fenêtre horizontale`);
          assert.equal(activeDateOption.rows, 1, `${width}px changement vers ${mode} sans nouvelle ligne`);
          const modePanelVisible = await option.evaluate((button, value) => {
            const panel = button.closest("[data-journey-date]").querySelector(`[data-journey-panel="${value}"]`);
            return Boolean(panel && !panel.hidden);
          }, mode);
          assert.equal(modePanelVisible, mode !== "unknown", `${width}px panneau de saisie du mode ${mode} conforme`);
        }
        const dateFact = await page.locator("#journeyAssociationFact option").evaluateAll(nodes => nodes.find(node => /Date de naissance attestée/i.test(node.textContent))?.value || nodes.find(node => /Date de naissance/i.test(node.textContent))?.value || "");
        assert.ok(dateFact, `${width}px fait date disponible dans le formulaire`);
        await page.locator("#journeyAssociationFact").selectOption(dateFact);
        const directDateForm = page.locator("#journeyInfoPanel .attestation-source-value-fields [data-journey-date]");
        await directDateForm.locator("#journeyDateValue").waitFor();
        const exactDateInput = directDateForm.locator("#journeyDateValue");
        if (screenshotDir && (width === 375 || width === 390)) {
          await directDateForm.scrollIntoViewIfNeeded();
          await captureAttestationScreenshot(page, `attestation-${width}-date-slider.png`);
        }
        const exactDateBox = await exactDateInput.evaluate(input => {
          const wrapper = input.closest(".person-native-date-control");
          const box = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width, height: rect.height }; };
          return { wrapper: box(wrapper), reference: box(document.querySelector("#journeyAssociationSubjectSearch")), input: box(input), type: input.getAttribute("type"), font: getComputedStyle(input).fontSize, visualOpacity: getComputedStyle(input).opacity, visualDisplay: getComputedStyle(wrapper.querySelector(".person-native-date-visual")).display, wrapperOverflow: wrapper.scrollWidth - wrapper.clientWidth };
        });
        assert.ok(Math.abs(exactDateBox.wrapper.left - exactDateBox.reference.left) <= 1 && Math.abs(exactDateBox.wrapper.right - exactDateBox.reference.right) <= 1, `${width}px date alignée à ±1px avec les champs de référence : ${JSON.stringify(exactDateBox)}`);
        assert.ok(Math.abs(exactDateBox.wrapper.height - 44) <= 1, `${width}px date visuelle à 44px : ${JSON.stringify(exactDateBox)}`);
        assert.equal(exactDateBox.type, "date", `${width}px attribut de contrôle natif date conservé`);
        assert.equal(exactDateBox.font, "16px", `${width}px saisie native configurée à 16px`);
        assert.equal(exactDateBox.visualOpacity, "0", `${width}px le champ natif reste superposé et activable sous l’affichage contrôlé`);
        assert.equal(exactDateBox.wrapperOverflow, 0, `${width}px wrapper de date sans débordement`);
        await exactDateInput.evaluate(input => {
          input.value = "1931-07-28";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        assert.equal(await exactDateInput.evaluate(input => input.closest(".person-native-date-control").querySelector(".person-native-date-visual").textContent), "28/07/1931", `${width}px date visible au format JJ/MM/AAAA`);
        assert.deepEqual(await page.evaluate(() => window.__finalAttestationUX.readDate(document.querySelector("#journeyInfoPanel"))), { type: "exact", value: "1931-07-28" }, `${width}px valeur ISO conservée sans décalage jour/mois`);
        if (screenshotDir && (width === 375 || width === 390)) await captureAttestationScreenshot(page, `attestation-${width}-date-field.png`);
        if (width === 390) {
          for (const legacyMode of ["before", "after", "attested"]) {
            await page.evaluate(mode => window.__finalAttestationUX.setSourceDate({ type: mode, value: "1931-07-28" }), legacyMode);
            const legacyOption = directDateForm.locator(`[data-journey-date-type="${legacyMode}"]`);
            assert.equal(await legacyOption.count(), 1, `mode historique ${legacyMode} préservé au rendu`);
            const legacyState = await legacyOption.evaluate(button => {
              const viewport = button.closest(".date-type-switch").getBoundingClientRect();
              const option = button.getBoundingClientRect();
              const activePanel = button.closest("[data-journey-date]").querySelector(`[data-journey-panel="${button.dataset.journeyDateType}"]`);
              const input = activePanel.querySelector('input[type="date"]');
              const switcher = button.closest(".date-type-switch");
              return { active: button.getAttribute("aria-pressed"), visible: option.left >= viewport.left - 1 && option.right <= viewport.right + 1, value: input.value, visibleText: input.closest(".person-native-date-control").querySelector(".person-native-date-visual").textContent, scrollLeft: switcher.scrollLeft, scrollWidth: switcher.scrollWidth, clientWidth: switcher.clientWidth, optionLeft: option.left, optionRight: option.right, viewportLeft: viewport.left, viewportRight: viewport.right };
            });
            assert.equal(legacyState.active, "true", `mode historique ${legacyMode} sélectionné`);
            assert.equal(legacyState.visible, true, `mode historique ${legacyMode} reste visible et conserve la date ISO : ${JSON.stringify(legacyState)}`);
            assert.equal(legacyState.value, "1931-07-28", `valeur ISO historique ${legacyMode} conservée`);
            assert.equal(legacyState.visibleText, "28/07/1931", `affichage numérique historique ${legacyMode} conservé`);
          }
          await page.evaluate(() => window.__finalAttestationUX.setSourceDate({ type: "exact", value: "1931-07-28" }));
          assert.equal(await directDateForm.locator("#journeyDateValue").evaluate(input => input.closest(".person-native-date-control").querySelector(".person-native-date-visual").textContent), "28/07/1931", "réouverture/rendu du panneau restaure l’affichage numérique et l’ISO");
        }
        assert.equal(formMetrics.resultsClosed.display, "none", `${width}px autocomplétion fermée sans conteneur résiduel`);
        assert.equal(formMetrics.resultsClosed.border, "0px", `${width}px aucune bordure résiduelle quand les suggestions sont fermées`);
        /* Relation : champ de la deuxième personne sur la même marge. */
        const relationFact = await page.locator("#journeyAssociationFact option").evaluateAll(nodes => nodes.find(node => node.value.startsWith("relation:"))?.value || "");
        assert.ok(relationFact, `${width}px fait relationnel disponible`);
        await page.locator("#journeyAssociationFact").selectOption(relationFact);
        await page.waitForSelector("#journeySecondSearch");
        const secondMetrics = await page.locator("#journeySecondSearch").evaluate(el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, font: getComputedStyle(el).fontSize }; });
        assert.ok(Math.abs(secondMetrics.x - formMetrics.sourceLeft) <= 2, `${width}px deuxième personne sur la même marge (${secondMetrics.x}/${formMetrics.sourceLeft})`);
        assert.ok(Math.abs(secondMetrics.w - formMetrics.controls[0].w) <= 2, `${width}px deuxième personne de même largeur`);
        assert.ok(secondMetrics.h >= 44 && secondMetrics.font === "16px", `${width}px deuxième personne ≥ 44 px et police 16 px`);
        /* CTA interne atteignable malgré le pied de modale. */
        await page.locator("#journeyInfoPanel [data-journey-association-add]").scrollIntoViewIfNeeded();
        const ctaReach = await page.evaluate(() => {
          const add = document.querySelector("#journeyInfoPanel [data-journey-association-add]").getBoundingClientRect();
          const footer = document.querySelector("#personAttestationDialog > .modal-actions").getBoundingClientRect();
          return { addBottom: Math.round(add.bottom), footerTop: Math.round(footer.top) };
        });
        assert.ok(ctaReach.addBottom <= ctaReach.footerTop + 1, `${width}px dernier CTA interne atteignable par défilement (${JSON.stringify(ctaReach)})`);
        await page.locator("#journeyInfoPanel [data-journey-panel-close]").click();
        /* Corbeille : retrait d'une information du brouillon (dernier passage). */
        if (width === 320) {
          const rowsBefore = await page.locator("#journeyAssociationList tr[data-journey-association]").count();
          await page.locator("#journeyAssociationList [data-journey-association-remove]").first().click();
          const rowsAfter = await page.locator("#journeyAssociationList tr[data-journey-association]").count();
          assert.equal(rowsAfter, rowsBefore - 1, "corbeille retire l’information du brouillon");
        }
      }
      await page.locator('#personAttestationDialog [data-journey-attestation-cancel]').click();
      await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open);
      if (width === 390) {
        const addAttestation = page.locator('#personPageEditHost [data-journey-attestation-add="ux-event"]');
        assert.equal(await addAttestation.count(), 1, "mode Ajouter : entrée d’ajout d’attestation disponible");
        await page.evaluate(() => window.__finalAttestationUX.openNewAttestation());
        await page.waitForFunction(() => document.getElementById("personAttestationDialog").open);
        assert.equal(await page.locator("#personAttestationDialogTitle").innerText(), "Ajouter une attestation", "mode Ajouter identifié dans la modale");
        await page.evaluate(() => window.__finalAttestationUX.prepareNewAttestationDocument());
        await page.locator('#personAttestationDialog [data-journey-attestation-panel-open="info"]').click();
        const addResidenceFact = await page.locator("#journeyAssociationFact option").evaluateAll(nodes => nodes.find(node => node.textContent.includes("Lieu de résidence"))?.value || "");
        assert.ok(addResidenceFact, "mode Ajouter : fait résidentiel disponible");
        await page.locator("#journeyAssociationFact").selectOption(addResidenceFact);
        await page.evaluate(() => window.__finalAttestationUX.setSourceDate({ type: "exact", value: "1931-07-28" }));
        const addModeDate = page.locator("#journeyInfoPanel .attestation-source-date [data-journey-date]");
        const addModeMetrics = await addModeDate.evaluate(container => {
          const switcher = container.querySelector(".date-type-switch");
          const input = container.querySelector('#journeyDateValue');
          const control = input.closest(".person-native-date-control").getBoundingClientRect();
          const reference = document.querySelector("#journeyAssociationSubjectSearch").getBoundingClientRect();
          return { title: document.getElementById("personAttestationDialogTitle").textContent, rows: new Set([...switcher.querySelectorAll(".date-type-button")].map(button => Math.round(button.getBoundingClientRect().top))).size,
            width: switcher.clientWidth, scrollWidth: switcher.scrollWidth, dateAttribute: input.getAttribute("type"), controlWidth: control.width, controlHeight: control.height, leftDelta: control.left - reference.left, rightDelta: control.right - reference.right,
            visual: input.closest(".person-native-date-control").querySelector(".person-native-date-visual").textContent };
        });
        assert.equal(addModeMetrics.title, "Ajouter une attestation", "mode Ajouter conserve son contexte pendant le rendu du formulaire");
        assert.equal(addModeMetrics.rows, 1, "mode Ajouter : date sur une seule ligne défilante");
        assert.ok(addModeMetrics.scrollWidth > addModeMetrics.width, "mode Ajouter : options accessibles par glissement horizontal");
        assert.equal(addModeMetrics.dateAttribute, "date", "mode Ajouter conserve input[type=date]");
        assert.ok(Math.abs(addModeMetrics.controlHeight - 44) <= 1 && Math.abs(addModeMetrics.leftDelta) <= 1 && Math.abs(addModeMetrics.rightDelta) <= 1, `mode Ajouter : champ date aligné et de 44px (${JSON.stringify(addModeMetrics)})`);
        assert.equal(addModeMetrics.visual, "28/07/1931", "mode Ajouter affiche la date existante au format JJ/MM/AAAA");
        await page.locator("#journeyInfoPanel [data-journey-panel-close]").click();
        await page.locator('#personAttestationDialog [data-journey-attestation-cancel]').click();
        await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open);
      }
      await page.locator('#personPageEditHost [data-close="personDialog"]').click();
      await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    }

    /* Seules les confirmations métier attendues : abandon du formulaire Ajouter,
       retrait d'information, puis abandon du brouillon Modifier. */
    assert.equal(nativeDialogs.length, 3, `seules les confirmations métier attendues : ${JSON.stringify(nativeDialogs)}`);
    assert.match(nativeDialogs[0], /Abandonner les modifications/, "abandon du formulaire Ajouter modifié demandé");
    assert.match(nativeDialogs[1], /Retirer l’information/, "confirmation de retrait de l’information demandée");
    assert.match(nativeDialogs[2], /Abandonner les modifications/, "abandon du brouillon Modifier demandé");
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
