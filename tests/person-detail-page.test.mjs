import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const svg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#557a65"/></svg>');
const hooks = `
window.__personPageTest = {
  seed() {
    people = [
      { id: "person-page-a", firstName: "Ada", middleName: "Maria", lastName: "Rossi", marriedName: "Bianchi", gender: "F", branch: "Ramo Conti", birthDateInfo: { type: "year", year: 1890 }, place: "Palermo", deathDateInfo: { type: "year", year: 1931 }, deathPlace: "Metz", notes: "Note de consultation", photoUrl: "${svg}", updatedAt: { toDate: () => new Date("2026-10-24T03:30:00Z") }, updatedByName: "Archiviste", inTree: true },
      { id: "person-page-b", firstName: "Carlo", lastName: "Rossi", gender: "M", birthDateInfo: { type: "year", year: 1860 }, place: "Palermo" },
      { id: "person-page-c", firstName: "Lina", lastName: "Rossi", gender: "F" },
      { id: "person-page-d", firstName: "Rosa", middleName: "Margherita", lastName: "Conti", gender: "F", birthDateInfo: { type: "exact", value: "1904-08-25" }, place: "Esch-sur-Alzette", deathDateInfo: { type: "exact", value: "1931-07-28" }, deathPlace: "Metz", inTree: true },
      { id: "person-page-e", firstName: "Émile", lastName: "Conti", gender: "M", birthDateInfo: { type: "exact", value: "1902-02-02" }, inTree: true }
    ];
    families = [
      { id: "person-page-family", partnerIds: ["person-page-a", "person-page-b"], childIds: ["person-page-c"], relationType: "marriage", unionDateInfo: { type: "year", year: 1888 }, unionPlace: "Palermo", endType: "none", endDateInfo: { type: "unknown" }, parentChildLinks: [] },
      { id: "person-page-family-d", partnerIds: ["person-page-d", "person-page-e"], childIds: [], relationType: "marriage", unionDateInfo: { type: "exact", value: "1930-12-06" }, unionPlace: "Esch-sur-Alzette", endType: "none", endDateInfo: { type: "unknown" }, parentChildLinks: [] }
    ];
    documents = [
      { id: "person-page-document", title: "Acte de naissance d’Ada", type: "Acte", date: "1890-03-04", fileName: "acte.svg", mimeType: "image/svg+xml", externalUrl: "https://example.invalid/acte.svg", personIds: ["person-page-a"] },
      { id: "person-page-pdf", title: "Registre PDF", type: "Registre", fileName: "registre.pdf", mimeType: "application/pdf", personIds: ["person-page-a"] },
      { id: "person-page-image", title: "Photographie", type: "Photo", fileName: "portrait.jpg", mimeType: "application/octet-stream", personIds: ["person-page-a"] },
      { id: "person-page-unknown", title: "Fichier inconnu", type: "Archive", fileName: "fichier.bin", mimeType: "application/octet-stream", personIds: ["person-page-a"] }
    ];
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    genealogyRecords = {
      sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [],
      genealogyProofs: [{ id: "person-page-proof", data: { id: "person-page-proof", factId: "fact~person~person-page-a~birth", factType: "birth", personIds: ["person-page-a"], documentId: "person-page-document", relation: "supports", technicalStatus: "active", sourceValue: "1890" } }],
      genealogyProofRevisions: [],
      factConclusions: [{ id: "person-page-conclusion", data: { id: "person-page-conclusion", factId: "fact~person~person-page-a~birth", factType: "birth", revision: { status: "established", retainedValue: "1890" } } }],
      conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: []
    };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin", displayName: "Archiviste" };
    treeCatalogState = "ready";
    $("authScreen").hidden = true;
    $("topbar").hidden = false;
    renderTree();
    setView("directory");
  },
  update(id, data) {
    window.__personPageUpdates = [...(window.__personPageUpdates || []), { id, firstName: data.firstName, place: data.place, birthDateInfo: data.birthDateInfo }];
    people = people.map(item => item.id === id ? { ...item, ...data, updatedAt: { toDate: () => new Date("2026-11-04T12:00:00Z") }, updatedByName: "Archiviste" } : item);
  },
  openTree() { renderTree(); setView("tree"); },
  openDirectory() { setView("directory"); },
  openEvidenceModal() {
    openPerson(people.find(item => item.id === "person-page-a"), "directory");
    setPersonSection("documents");
  },
  setEvidenceRole(role) {
    currentUserProfile = { role, displayName: "Testeur" };
    renderPersonDocuments("person-page-a");
  },
  setConclusionStatus(status) {
    const conclusion = genealogyRecords.factConclusions.find(item => item.id === "person-page-conclusion");
    conclusion.data.revision.status = status;
    renderPersonDocuments("person-page-a");
  },
  tryDirectRevision() {
    openGenealogyContribution({ official: true, reviseItem: { kind: "proof", record: { id: "person-page-proof" }, data: {} } });
    return document.getElementById("genealogyContributionDialog").open;
  },
  state() {
    return {
      pageVisible: !$('personDetailView').hidden,
      directoryVisible: !$('directoryView').hidden,
      treeVisible: !$('appMain').hidden,
      documentVisible: !$('documentDetailView').hidden,
      title: $('personPageTitle').textContent,
      section: personPageActiveSection,
      returnKind: documentPageReturnContext?.kind || "",
      returnSection: documentPageReturnContext?.section || "",
      updateCount: (window.__personPageUpdates || []).length,
      noTechnicalJson: !$('personPageContent').querySelector("pre, code.json")
    };
  }
};
window.__personPageUpdates = [];
`;

test("la page Personne consulte les données, réutilise la modale et restaure le parcours Document", async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 1280, height: 900 } });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const update = 'await updateDoc(doc(db, "people", id), data);';
      assert.ok(source.includes(update), "le point de sauvegarde personne doit rester celui de la modale existante");
      source = source.replace(update, "await window.__personPageTest.update(id, data);");
      return route.fulfill({ response, body: `${source}\n${hooks}` });
    }
    return isAllowedRequest(url, server.baseURL) || url.includes("gstatic.com")
      ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__personPageTest === "object");
    await page.evaluate(() => window.__personPageTest.seed());

    await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    assert.equal((await page.locator("#personPageTitle").textContent()).trim(), "Ada Maria Rossi");
    assert.match(await page.locator("#personPageContent").innerText(), /Nom d’usage[\s\S]*Bianchi/i);
    assert.match(await page.locator("#personPageContent").innerText(), /Parents|Partenaires et unions|Enfants/);
    assert.match(await page.locator("#personPageContent").innerText(), /Acte de naissance d’Ada/);
    assert.match(await page.locator("#personPageContent").innerText(), /Établie/);
    assert.equal(await page.locator("#personPageContent pre").count(), 0, "aucun JSON technique dans la page Personne");

    await page.locator('[data-person-page-section="family"]').click();
    await page.locator('[data-open-person-page="person-page-b"]').click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Carlo"));
    assert.equal(await page.locator("#personPageBackBtn").getAttribute("aria-label"), "Retour à la personne");
    assert.equal(await page.locator("#personPageEssentials .person-detail-status").count(), 0, "aucun badge Décédé sans date ni lieu de décès");
    await page.setViewportSize({ width: 390, height: 844 });
    const missingDeath = await page.locator("#personPageEssentials .person-detail-dates-copy").allTextContents();
    assert.equal(missingDeath[1].trim(), "Non renseigné", "date et lieu absents sans séparateur orphelin");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("#personPageBackBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Ada"));
    assert.equal((await page.evaluate(() => window.__personPageTest.state())).section, "family", "retour au membre précédent et à Famille");
    const adaStatus = await page.evaluate(() => {
      const badge = document.querySelector("#personPageEssentials .person-detail-status");
      const branch = document.querySelector("#personPageEssentials .person-detail-branch");
      const wrapper = document.querySelector("#personPageEssentials .person-detail-badges");
      const wrapperBox = wrapper.getBoundingClientRect();
      const styles = element => {
        const style = getComputedStyle(element);
        return { size: style.fontSize, weight: style.fontWeight, family: style.fontFamily, height: Math.round(element.getBoundingClientRect().height), padding: style.paddingLeft };
      };
      return {
        text: badge?.textContent.trim(),
        display: badge ? getComputedStyle(badge).display : "absent",
        sameLine: !!branch && Math.abs(branch.getBoundingClientRect().top - badge.getBoundingClientRect().top) <= 2,
        wrapperDisplay: wrapper ? getComputedStyle(wrapper).display : "absent",
        wrapperWidth: wrapperBox.width,
        branchStyle: styles(branch),
        statusStyle: styles(badge)
      };
    });
    assert.equal(adaStatus.text, "Décédé", "badge Décédé affiché lorsque le décès est établi");
    assert.ok(["flex", "inline-flex"].includes(adaStatus.display), `badge Décédé visible sur desktop (${adaStatus.display})`);
    assert.equal(adaStatus.sameLine, true, "Décédé aligné sur la même ligne que le badge de l'arbre");
    assert.equal(adaStatus.wrapperDisplay, "flex", "les badges sont regroupés sur une ligne dédiée en desktop");
    assert.equal(adaStatus.branchStyle.size, "13px", "badge de l'arbre à 13px");
    assert.equal(adaStatus.statusStyle.size, "13px", "badge Décédé à la même taille que le badge de l'arbre");
    assert.equal(adaStatus.statusStyle.weight, "600", "badge Décédé en graisse 600");
    assert.equal(adaStatus.statusStyle.weight, adaStatus.branchStyle.weight, "mêmes graisses pour les deux badges");
    assert.equal(adaStatus.statusStyle.family, adaStatus.branchStyle.family, "même famille typographique");
    assert.ok(Math.abs(adaStatus.statusStyle.height - adaStatus.branchStyle.height) <= 1, `mêmes hauteurs (${adaStatus.branchStyle.height}px / ${adaStatus.statusStyle.height}px)`);
    assert.equal(adaStatus.statusStyle.padding, adaStatus.branchStyle.padding, "mêmes padding latéraux");

    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), false, "l’édition reste sur la page, sans ouvrir la modale");
    const inlineDesktop = await page.evaluate(() => {
      const panel = document.getElementById("personIdentityPanel");
      const timeline = document.getElementById("personLifeTimeline");
      const editor = document.getElementById("personPageEditHost");
      const documentCards = [...document.querySelectorAll("#personDocumentsPanel > .person-page-inline-card")];
      const relationAction = document.getElementById("toggleRelationBuilderBtn");
      const relationActionStyle = getComputedStyle(relationAction);
      const rect = element => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: box.height }; };
      return {
        panelDisplay: getComputedStyle(panel).display,
        panelWidth: panel.getBoundingClientRect().width,
        editorWidth: editor.getBoundingClientRect().width,
        timelineHidden: timeline.hidden,
        documentCards: documentCards.length,
        documentCardTitles: documentCards.map(card => card.querySelector("h3")?.textContent.trim()),
        documentCardStyles: documentCards.map(card => ({ background: getComputedStyle(card).backgroundColor, border: getComputedStyle(card).borderTopWidth, radius: getComputedStyle(card).borderTopLeftRadius })),
        documentCardRects: documentCards.map(rect),
        documentActions: [document.getElementById("linkDocumentBtn").innerText.trim(), document.getElementById("proofEntryPointLabel").textContent.trim()],
        documentActionHeaders: [document.getElementById("linkDocumentBtn"), document.getElementById("genealogyProposeProofForPersonBtn")].map(button => button.parentElement.classList.contains("person-page-inline-section-header")),
        relationHeaderAction: relationAction.parentElement.classList.contains("person-page-inline-section-header"),
        relationActionPrimary: relationAction.classList.contains("primary"),
        relationActionStyle: (() => { const s = getComputedStyle(relationAction); return { border: s.borderTopColor, background: s.backgroundColor, color: s.color, height: Math.round(relationAction.getBoundingClientRect().height), width: Math.round(relationAction.getBoundingClientRect().width) }; })(),
        membership: (() => {
          const label = document.getElementById("personTreeMembershipLabel");
          const title = label.querySelector(".person-tree-membership-title");
          const value = label.querySelector(".person-tree-membership-copy strong");
          const icon = label.querySelector(":scope > .ui-icon");
          const valueStyle = getComputedStyle(value);
          return {
            hidden: label.hidden,
            gridColumn: getComputedStyle(label).gridColumnStart,
            display: getComputedStyle(label).display,
            iconDisplay: icon ? getComputedStyle(icon).display : "absent",
            labelAboveValue: title.getBoundingClientRect().bottom <= value.getBoundingClientRect().top + 1,
            labelText: title.textContent.trim(),
            valueText: value.textContent.trim(),
            valueBorder: valueStyle.borderTopWidth,
            valueRadius: valueStyle.borderTopLeftRadius,
            valueHeight: Math.round(value.getBoundingClientRect().height),
            valueSize: valueStyle.fontSize,
            labelSize: getComputedStyle(title).fontSize,
            labelWeight: getComputedStyle(title).fontWeight
          };
        })(),
        editCards: (() => {
          const pdf = document.querySelector("#personDocumentsList .person-doc-card--pdf");
          const noThumb = document.querySelector("#personDocumentsList .person-doc-card.is-no-thumbnail");
          const edit = pdf?.querySelector(".person-doc-edit");
          const editStyle = edit ? getComputedStyle(edit) : null;
          return {
            count: document.querySelectorAll("#personDocumentsList .person-doc-card").length,
            pdfHeight: pdf ? Math.round(pdf.getBoundingClientRect().height) : null,
            thumbHeight: noThumb ? Math.round(noThumb.querySelector(".person-doc-thumb").getBoundingClientRect().height) : null,
            formatDisplay: pdf ? getComputedStyle(pdf.querySelector(".person-detail-document-format-visual")).display : "absent",
            editAria: edit ? edit.getAttribute("aria-label") : null,
            editTitle: edit ? edit.title : null,
            editPosition: editStyle ? editStyle.position : null,
            editInsideCard: edit ? pdf.contains(edit) : false
          };
        })(),
        footer: (() => {
          const footer = document.querySelector("#personPageEditHost .person-actions");
          const boxes = [...footer.querySelectorAll(".right .btn:not([hidden])")].map(button => ({ button: button.textContent.trim(), box: button.getBoundingClientRect() }));
        const footerBox = footer.getBoundingClientRect();
        const heroBox = document.querySelector(".person-detail-hero").getBoundingClientRect();
        return {
            buttons: boxes.map(entry => entry.button),
            gap: boxes.length > 1 ? Math.round(boxes[1].box.left - boxes[0].box.right) : null,
            aligned: boxes.length > 1 ? Math.abs(boxes[0].box.top - boxes[1].box.top) <= 1 && Math.abs(boxes[0].box.bottom - boxes[1].box.bottom) <= 1 : false,
            heights: boxes.map(entry => Math.round(entry.box.height)),
            rightInset: Math.round(footerBox.right - Math.max(...boxes.map(entry => entry.box.right))),
            left: Math.round(footerBox.left), right: Math.round(footerBox.right),
            heroLeft: Math.round(heroBox.left), heroRight: Math.round(heroBox.right)
          };
        })(),
        badges: (() => {
          const branch = document.querySelector("#personPageEssentials .person-detail-branch");
          const status = document.querySelector("#personPageEssentials .person-detail-status");
          const style = getComputedStyle(status);
          return { branchSize: getComputedStyle(branch).fontSize, statusSize: style.fontSize, statusWeight: style.fontWeight };
        })(),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        stickyActions: getComputedStyle(document.querySelector("#personPageEditHost .person-actions")).position
      };
    });
    assert.equal(inlineDesktop.panelDisplay, "block", "édition inline desktop : carte Identité pleine largeur");
    assert.ok(inlineDesktop.panelWidth >= inlineDesktop.editorWidth - 64, "carte Identité occupe toute la largeur utile");
    assert.equal(inlineDesktop.timelineHidden, true, "timeline masquée pendant la modification");
    assert.equal(inlineDesktop.documentCards, 2, "Documents associés et Recherches forment deux cartes distinctes");
    assert.deepEqual(inlineDesktop.documentCardTitles, ["Documents associés", "Recherches"]);
    assert.equal(inlineDesktop.documentCardStyles[0].background, inlineDesktop.documentCardStyles[1].background, "cartes Documents/Recherches sur fond identique");
    assert.equal(inlineDesktop.documentCardStyles[0].border, inlineDesktop.documentCardStyles[1].border, "cartes Documents/Recherches avec bordures identiques");
    assert.equal(inlineDesktop.documentCardStyles[0].radius, inlineDesktop.documentCardStyles[1].radius, "cartes Documents/Recherches avec arrondis identiques");
    assert.ok(inlineDesktop.documentCardRects[1].top - inlineDesktop.documentCardRects[0].bottom >= 12, "espace vertical entre les cartes Documents et Recherches");
    assert.deepEqual(inlineDesktop.documentActions, ["Ajouter un document pour cette personne", "Ajouter une preuve"]);
    assert.deepEqual(inlineDesktop.documentActionHeaders, [true, true], "actions d'ajout en haut de chaque carte");
    assert.equal(inlineDesktop.relationHeaderAction, true, "Ajouter un lien familial aligné sur le titre Famille");
    assert.equal(inlineDesktop.relationActionPrimary, false, "Ajouter un lien familial reste une action secondaire");
    assert.equal(inlineDesktop.relationActionStyle.background, "rgb(255, 253, 248)", "Ajouter un lien familial garde le fond secondaire desktop");
    assert.equal(inlineDesktop.relationActionStyle.border, "rgb(214, 204, 187)", "Ajouter un lien familial garde la bordure secondaire desktop");
    assert.equal(inlineDesktop.relationActionStyle.color, "rgb(40, 75, 63)", "Ajouter un lien familial garde le texte vert foncé desktop");
    assert.equal(inlineDesktop.relationActionStyle.background, "rgb(255, 253, 248)", "Ajouter un lien familial conserve le fond secondaire desktop");
    assert.equal(inlineDesktop.relationActionStyle.border, "rgb(214, 204, 187)", "Ajouter un lien familial conserve le contour secondaire desktop");
    assert.ok(inlineDesktop.overflow <= 1, `édition inline desktop sans débordement (${inlineDesktop.overflow}px)`);
    assert.equal(inlineDesktop.stickyActions, "sticky", "barre d’actions d’édition conservée");
    assert.equal(inlineDesktop.footer.left, inlineDesktop.footer.heroLeft, "footer desktop aligné sur le bord gauche du Hero");
    assert.equal(inlineDesktop.footer.right, inlineDesktop.footer.heroRight, "footer desktop aligné sur le bord droit du Hero");
    assert.equal(inlineDesktop.membership.hidden, false, "arbre d'appartenance affiché en modification");
    assert.equal(inlineDesktop.membership.gridColumn, "2", "arbre d'appartenance en colonne de droite, sous Branche familiale");
    assert.equal(inlineDesktop.membership.display, "grid", "arbre d'appartenance traité comme un champ de la grille");
    assert.equal(inlineDesktop.membership.iconDisplay, "none", "icône décorative de l'arbre masquée");
    assert.equal(inlineDesktop.membership.labelAboveValue, true, "libellé au-dessus de la valeur");
    assert.equal(inlineDesktop.membership.labelText, "Arbre d’appartenance");
    assert.match(inlineDesktop.membership.valueText, /^Arbre/, `valeur dynamique (${inlineDesktop.membership.valueText})`);
    assert.equal(inlineDesktop.membership.valueBorder, "1px", "valeur avec la bordure d'un champ");
    assert.notEqual(inlineDesktop.membership.valueRadius, "0px", "valeur avec les arrondis d'un champ");
    assert.ok(inlineDesktop.membership.valueHeight >= 40, `valeur à la hauteur d'un champ (${inlineDesktop.membership.valueHeight}px)`);
    assert.equal(inlineDesktop.membership.labelSize, "13px", "libellé à la typographie des autres champs");
    assert.equal(inlineDesktop.membership.labelWeight, "700", "libellé à la graisse des autres champs");
    assert.equal(inlineDesktop.badges.statusSize, inlineDesktop.badges.branchSize, "badges homogènes en modification");
    assert.equal(inlineDesktop.badges.statusSize, "13px", "badges à 13px en modification");
    assert.equal(inlineDesktop.badges.statusWeight, "600", "badge Décédé en graisse 600 en modification");
    assert.ok(inlineDesktop.editCards.count >= 4, `documents éditables présents (${inlineDesktop.editCards.count})`);
    assert.equal(inlineDesktop.editCards.formatDisplay, "grid", "pictogramme de format conservé en modification");
    assert.equal(inlineDesktop.editCards.editAria, "Modifier le document", "nom accessible du crayon");
    assert.equal(inlineDesktop.editCards.editTitle, "Modifier le document", "infobulle du crayon");
    assert.equal(inlineDesktop.editCards.editPosition, "absolute", "crayon hors du flux pour préserver la hauteur");
    assert.equal(inlineDesktop.editCards.editInsideCard, true, "crayon dans la carte");
    assert.deepEqual(inlineDesktop.footer.buttons, ["Annuler", "Enregistrer"], "footer dans l'ordre Annuler puis Enregistrer");
    assert.ok(inlineDesktop.footer.gap >= 8 && inlineDesktop.footer.gap <= 12, `espacement des boutons du footer (${inlineDesktop.footer.gap}px)`);
    assert.equal(inlineDesktop.footer.aligned, true, "boutons du footer alignés verticalement");
    assert.equal(inlineDesktop.footer.heights[0], inlineDesktop.footer.heights[1], "boutons du footer de même hauteur");
    assert.ok(inlineDesktop.footer.rightInset >= 16, `marge droite du footer (${inlineDesktop.footer.rightInset}px)`);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(250);
    const footerClearance = await page.evaluate(() => {
      const footer = document.querySelector("#personPageEditHost .person-actions");
      const notes = document.getElementById("notes");
      return {
        footerTop: Math.round(footer.getBoundingClientRect().top),
        notesBottom: Math.round(notes.getBoundingClientRect().bottom),
        clear: notes.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top + 1
      };
    });
    assert.ok(footerClearance.clear, `le dernier champ reste lisible au-dessus du footer (notes:${footerClearance.notesBottom}, footer:${footerClearance.footerTop})`);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.locator("#personPageActions > summary").click();
    assert.equal(await page.locator("#personPageActionsMenu [data-person-page-action]").count(), 5, "menu ⋯ complet toujours disponible en modification");
    await page.locator('#personPageActionsMenu [data-person-page-action="print"]').focus();
    await page.keyboard.press("ArrowDown");
    const menuKeyboard = await page.evaluate(() => ({
      action: document.activeElement?.dataset.personPageAction,
      focusVisible: document.activeElement?.matches(":focus-visible"),
      outline: getComputedStyle(document.activeElement).outline
    }));
    assert.equal(menuKeyboard.action, "branch", "flèches clavier parcourent les actions du menu en modification");
    assert.equal(menuKeyboard.focusVisible, true, "la ligne active utilise le focus clavier visible");
    assert.match(menuKeyboard.outline, /solid 2px/, "contour de focus du menu visible");
    await page.keyboard.press("Escape");
    await page.locator("#personPageActions > summary").click();
    await page.locator("#toggleRelationBuilderBtn").click();
    await page.waitForFunction(() => !document.getElementById("relationBuilder").hidden);
    await page.locator("#closeRelationBuilderBtn").click();
    await page.waitForFunction(() => document.getElementById("relationBuilder").hidden);
    await page.locator("#firstName").fill("Adélaïde");
    await page.locator("#birthYear").fill("1891");
    await page.locator("#place").fill("Palermo modifiée");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Adélaïde"));
    assert.equal(await page.evaluate(() => window.__personPageTest.state().updateCount), 1, "la sauvegarde réutilise le point d’écriture existant");
    const savedInlineData = await page.evaluate(() => window.__personPageUpdates[0]);
    assert.equal(savedInlineData.place, "Palermo modifiée", "le lieu est enregistré depuis l’édition inline");
    assert.equal(savedInlineData.birthDateInfo.year, 1891, "la date est enregistrée depuis l’édition inline");
    assert.equal(await page.locator("#personDialog").evaluate(dialog => dialog.open), false, "la modale reste fermée après l’enregistrement en ligne");

    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.locator("#firstName").fill("Brouillon abandonné");
    await page.locator('#personPageEditHost [data-close="personDialog"]').click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    assert.match(await page.locator("#personPageTitle").textContent(), /Adélaïde/, "Annuler abandonne les valeurs locales");

    page.once("dialog", dialog => dialog.accept());
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.locator("#firstName").fill("Brouillon non enregistré");
    await page.locator("#personPageBackBtn").click();
    await page.waitForFunction(() => document.getElementById("personDetailView").hidden);

    await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    assert.match(await page.locator("#personPageTitle").textContent(), /Adélaïde/, "la sortie protégée n’enregistre pas le brouillon");
    await page.locator('[data-person-page-section="documents"]').click();
    await page.locator('#personPageDocuments [data-view-document="person-page-document"]').click();
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden, { timeout: 10000 });
    const documentState = await page.evaluate(() => window.__personPageTest.state());
    assert.equal(documentState.returnKind, "personPage");
    assert.equal(documentState.returnSection, "documents");
    await page.locator("#documentPageBackBtn").click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    assert.equal((await page.evaluate(() => window.__personPageTest.state())).section, "documents", "section d’origine restaurée après le Document");

    await page.locator('[data-person-page-section="research"]').click();
    await page.locator('#personPageContent [data-view-proof="person-page-proof"]').click();
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden, { timeout: 10000 });
    assert.equal(await page.locator("#proofPageBackBtn").getAttribute("aria-label"), "Retour à la personne");
    await page.locator("#proofPageContent [data-genealogy-person]").click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    await page.locator("#personPageBackBtn").click();
    await page.waitForFunction(() => !document.getElementById("proofDetailView").hidden, { timeout: 10000 });
    await page.locator("#proofPageBackBtn").click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    assert.equal((await page.evaluate(() => window.__personPageTest.state())).section, "research", "section Recherches restaurée après la Preuve");

    const researchConclusion = page.locator('#personPageContent [data-view-conclusion="person-page-conclusion"]');
    assert.equal(await researchConclusion.getAttribute("role"), "button", "carte conclusion de Recherches interactive");
    await researchConclusion.click();
    await page.waitForFunction(() => document.getElementById("genealogyItemDialog").open, { timeout: 10000 });
    assert.match(await page.locator("#genealogyItemSubtitle").innerText(), /Conclusion/, "clic sur la conclusion ouvre la conclusion");
    await page.locator('#genealogyItemDialog [data-close="genealogyItemDialog"]').click();
    await page.waitForFunction(() => !document.getElementById("genealogyItemDialog").open);
    await researchConclusion.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.getElementById("genealogyItemDialog").open, { timeout: 10000 });
    await page.locator('#genealogyItemDialog [data-close="genealogyItemDialog"]').click();
    await page.waitForFunction(() => !document.getElementById("genealogyItemDialog").open);

    await page.evaluate(() => window.__personPageTest.openEvidenceModal());
    await page.waitForFunction(() => document.getElementById("personDialog").open);
    const evidenceText = await page.locator("#personGenealogyEvidenceList").innerText();
    assert.match(evidenceText, /Conclusion · Établie/, "la modale Personne affiche le statut réel de la conclusion");
    assert.doesNotMatch(evidenceText, /à examiner/, "plus de statut par défaut « à examiner » pour les conclusions");
    assert.equal(await page.locator('#personGenealogyEvidenceList [data-view-proof]').count(), 1, "la preuve conserve data-view-proof");
    assert.equal(await page.locator('#personGenealogyEvidenceList [data-view-conclusion]').count(), 1, "la conclusion porte data-view-conclusion");
    assert.equal(await page.locator('#personGenealogyEvidenceList [data-edit-genealogy-proof]').count(), 1, "administrateur : Réviser visible sur la preuve");
    assert.equal(await page.locator('#personGenealogyEvidenceList [data-edit-genealogy-conclusion]').count(), 1, "administrateur : Réviser visible sur la conclusion");
    for (const [status, label] of [
      ["undetermined", "Indéterminée"], ["provisional", "Provisoire"], ["established", "Établie"],
      ["disputed", "Contestée"], ["reexamination_required", "À réexaminer"]
    ]) {
      await page.evaluate(statusValue => window.__personPageTest.setConclusionStatus(statusValue), status);
      assert.match(await page.locator("#personGenealogyEvidenceList").innerText(), new RegExp(`Conclusion · ${label}`), `statut ${status} restitué`);
    }
    await page.evaluate(() => window.__personPageTest.setConclusionStatus("established"));
    await page.locator('#personGenealogyEvidenceList [data-view-conclusion="person-page-conclusion"]').click();
    await page.waitForFunction(() => document.getElementById("genealogyItemDialog").open, { timeout: 10000 });
    await page.locator('#genealogyItemDialog [data-close="genealogyItemDialog"]').click();
    await page.waitForFunction(() => !document.getElementById("genealogyItemDialog").open);
    await page.evaluate(() => window.__personPageTest.setEvidenceRole("member"));
    assert.equal(await page.locator('#personGenealogyEvidenceList [data-edit-genealogy-proof]').count(), 0, "membre : Réviser masqué sur la preuve");
    assert.equal(await page.locator('#personGenealogyEvidenceList [data-edit-genealogy-conclusion]').count(), 0, "membre : Réviser masqué sur la conclusion");
    const directRevisionBlocked = await page.evaluate(() => window.__personPageTest.tryDirectRevision());
    assert.equal(directRevisionBlocked, false, "la garde officielle refuse toujours un appel direct de révision en membre");
    await page.evaluate(() => window.__personPageTest.setEvidenceRole("admin"));
    assert.equal(await page.locator('#personGenealogyEvidenceList [data-edit-genealogy-proof]').count(), 1, "retour au rôle administrateur");
    await page.locator('#personDialog [data-close="personDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("personDialog").open);
    assert.equal((await page.evaluate(() => window.__personPageTest.state())).section, "research", "la fiche Personne reste en place après la modale");

    for (const width of [320, 375, 390, 430, 760, 768, 900, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => window.__personPageTest.openDirectory());
      await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
      await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
      const layout = await page.evaluate(() => {
        const isVisible = element => !!element && getComputedStyle(element).display !== "none" && element.getBoundingClientRect().height > 0;
        const rect = id => {
          const box = document.getElementById(id).getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
        };
        const desktopBack = document.getElementById("personPageBackBtn");
        const mobileBack = document.getElementById("personPageMobileBackBtn");
        const back = isVisible(desktopBack) ? desktopBack : mobileBack;
        const overview = document.getElementById("personPageOverview");
        const identity = document.getElementById("personPageIdentity");
        const timeline = document.getElementById("personPageTimeline");
        const timelineList = document.querySelector("#personPageTimeline ol");
        const timelineItems = [...timelineList.querySelectorAll(".timeline-jalon")];
        const familyCards = [...document.querySelectorAll("#personPageFamily .relation-person-row")];
        const pdfCard = document.querySelector("#personPageDocuments .person-doc-card--pdf");
        const imageCard = document.querySelector("#personPageDocuments .person-doc-card--image");
        const extensionImageCard = document.querySelector("#personPageDocuments [data-view-document='person-page-image']");
        const unknownCard = document.querySelector("#personPageDocuments .person-doc-card[data-view-document='person-page-unknown']");
        const research = document.querySelector("#personPageResearch .person-detail-research-card[role='button']");
        const header = document.getElementById("topbar");
        const account = document.getElementById("accountMenu");
        const brand = header.querySelector(".brand");
        const activeTab = document.querySelector("#personPageSectionNav [aria-current='location']");
        const personMenu = document.getElementById("personPageActionsMenu");
        const navSeparator = getComputedStyle(document.querySelector("#personPageSectionNav [data-person-page-section]:not(:last-child)"), "::after");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          viewport: document.documentElement.clientWidth,
          columns: getComputedStyle(document.getElementById("personPageContent")).gridTemplateColumns.split(" ").length,
          backCount: [desktopBack, mobileBack].filter(isVisible).length,
          backHeight: back.getBoundingClientRect().height,
          editHeight: document.getElementById("personPageEditBtn").getBoundingClientRect().height,
          mobileHeader: isVisible(document.getElementById("personPageMobileHeader")),
          overviewDisplay: getComputedStyle(overview).display,
          overviewColumns: getComputedStyle(overview).gridTemplateColumns.split(" ").length,
          overviewOrder: [...overview.children].map(section => section.id),
          identity: rect("personPageIdentity"),
          timeline: rect("personPageTimeline"),
          titleSize: getComputedStyle(document.getElementById("personPageTitle")).fontSize,
          sectionTitleSize: getComputedStyle(identity.querySelector("h3")).fontSize,
          navBackground: getComputedStyle(document.getElementById("personPageSectionNav")).backgroundColor,
          navFlexWrap: getComputedStyle(document.getElementById("personPageSectionNav")).flexWrap,
          navPosition: getComputedStyle(document.getElementById("personPageSectionNav")).position,
          navOverflowX: getComputedStyle(document.getElementById("personPageSectionNav")).overflowX,
          navScrollWidth: document.getElementById("personPageSectionNav").scrollWidth,
          navClientWidth: document.getElementById("personPageSectionNav").clientWidth,
          navBorderTop: getComputedStyle(document.getElementById("personPageSectionNav")).borderTopWidth,
          navBorderBottom: getComputedStyle(document.getElementById("personPageSectionNav")).borderBottomWidth,
          navTop: document.getElementById("personPageSectionNav").getBoundingClientRect().top,
          navBottom: document.getElementById("personPageSectionNav").getBoundingClientRect().bottom,
          navHeight: document.getElementById("personPageSectionNav").getBoundingClientRect().height,
          firstSectionTop: document.querySelector("#personPageContent .person-detail-overview > section").getBoundingClientRect().top,
          portrait: rect("personPagePortrait"),
          headingBox: (() => {
            const boxes = [document.getElementById("personPageTitle"), ...document.querySelectorAll("#personPageEssentials .person-detail-dates")].map(element => element.getBoundingClientRect());
            return { top: Math.min(...boxes.map(box => box.top)), bottom: Math.max(...boxes.map(box => box.bottom)), left: Math.min(...boxes.map(box => box.left)), right: Math.max(...boxes.map(box => box.right)) };
          })(),
          mobileMenuSequence: [...document.querySelectorAll("#personPageMobileActionsMenu > *")].map(node => node.tagName === "HR" ? "SEP" : node.textContent.trim()),
          mobileMenuBorders: [...document.querySelectorAll("#personPageMobileActionsMenu .btn")].map(button => getComputedStyle(button).borderTopWidth),
          familyVisualGap: (() => {
            const copy = document.querySelector("#personPageFamily .relation-person-copy");
            const link = copy.querySelector(".person-detail-relative-link");
            const meta = copy.querySelector(".relation-person-meta");
            const textRect = element => { const range = document.createRange(); range.selectNodeContents(element); const box = range.getBoundingClientRect(); return box; };
            const linkText = textRect(link), metaText = textRect(meta);
            return Math.round((metaText.top - linkText.bottom) * 10) / 10;
          })(),
          navSeparator: { content: navSeparator.content, width: Number.parseFloat(navSeparator.width), height: Number.parseFloat(navSeparator.height) },
          activeTabBackground: getComputedStyle(activeTab).backgroundColor,
          navTabStyle: { size: getComputedStyle(activeTab).fontSize, weight: getComputedStyle(activeTab).fontWeight },
          backTop: rect("personPageBackBtn").top,
          backBottom: rect("personPageBackBtn").bottom,
          heroTop: document.querySelector(".person-detail-hero").getBoundingClientRect().top,
          heroBottom: document.querySelector(".person-detail-hero").getBoundingClientRect().bottom,
          mobileModification: (() => {
            const element = document.getElementById("personPageMobileModification");
            const box = element.getBoundingClientRect();
            return { visible: isVisible(element), text: element.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom, align: getComputedStyle(element).textAlign };
          })(),
          identityFacts: (() => {
            const grid = document.querySelector("#personPageIdentity .person-detail-identity-grid");
            return {
              columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
              cells: [...grid.children].map(cell => { const box = cell.getBoundingClientRect(); return { label: cell.querySelector("strong")?.textContent.trim(), top: box.top, left: box.left, width: box.width, column: getComputedStyle(cell).gridColumn }; }),
              modificationCount: grid.querySelectorAll(".person-detail-modification, .person-detail-last-modified-mobile").length
            };
          })(),
          heroDateRows: [...document.querySelectorAll("#personPageEssentials .person-detail-dates")].map(row => {
            const copy = row.querySelector(".person-detail-dates-copy");
            const icon = row.querySelector(".person-detail-event-icon");
            const box = row.getBoundingClientRect();
            return { top: box.top, height: box.height, iconDisplay: getComputedStyle(icon).display, iconLabel: icon.getAttribute("aria-label"), iconHref: icon.querySelector("use")?.getAttribute("href"), labelDisplay: getComputedStyle(row.querySelector("strong")).display, copyWhiteSpace: getComputedStyle(copy).whiteSpace, copyOverflow: getComputedStyle(copy).textOverflow, copyScrollWidth: copy.scrollWidth, copyClientWidth: copy.clientWidth };
          }),
          globalHeaderBottom: header.getBoundingClientRect().bottom,
          actions: ["personPageEditBtn", "personPageViewTreeBtn", "personPageActions"].map(rect),
          summaryGap: Math.round(document.querySelector("#personPageActions summary").getBoundingClientRect().left - document.getElementById("personPageViewTreeBtn").getBoundingClientRect().right),
          editToSummaryGap: Math.round(document.querySelector("#personPageActions summary").getBoundingClientRect().left - document.getElementById("personPageEditBtn").getBoundingClientRect().right),
          actionDateVisible: isVisible(document.querySelector(".person-detail-modification--actions")),
          actionDateText: document.querySelector(".person-detail-modification--actions").textContent,
          actionDateDisplay: getComputedStyle(document.querySelector(".person-detail-modification--actions")).display,
          actionDateHeight: document.querySelector(".person-detail-modification--actions").getBoundingClientRect().height,
          actionDateRight: document.querySelector(".person-detail-modification--actions").getBoundingClientRect().right,
          actionDateBottom: document.querySelector(".person-detail-modification--actions").getBoundingClientRect().bottom,
          essentialsDateVisible: isVisible(document.querySelector(".person-detail-modification--essentials")),
          genderBadgeVisible: isVisible(document.querySelector(".person-detail-gender")),
          familyWidths: familyCards.map(card => card.getBoundingClientRect().width),
          familyNameRelationGap: (() => {
            const copy = document.querySelector("#personPageFamily .relation-person-copy");
            const link = copy.querySelector(".person-detail-relative-link");
            const meta = copy.querySelector(".relation-person-meta");
            return { pixels: Number.parseFloat(getComputedStyle(link).paddingBottom) + Number.parseFloat(getComputedStyle(copy).rowGap) + Number.parseFloat(getComputedStyle(meta).marginTop), rowGap: getComputedStyle(copy).rowGap, alignContent: getComputedStyle(copy).alignContent, justifyContent: getComputedStyle(copy).justifyContent, linkMinHeight: getComputedStyle(link).minHeight, linkPadding: getComputedStyle(link).padding, metaMargin: getComputedStyle(meta).marginTop };
          })(),
          docTitleStyle: (() => {
            const style = getComputedStyle(document.querySelector("#personPageDocuments .person-doc-title"));
            return { size: Number.parseFloat(style.fontSize), weight: style.fontWeight, lineHeight: Number.parseFloat(style.lineHeight) };
          })(),
          documentGrid: (() => {
            const gallery = document.querySelector("#personPageDocuments .person-doc-gallery");
            const card = gallery.querySelector(".person-doc-card");
            return { columns: getComputedStyle(gallery).gridTemplateColumns.split(" ").length, cardWidth: card.getBoundingClientRect().width };
          })(),
          timelineListStyle: getComputedStyle(timelineList).listStyleType,
          timelineLineDisplay: timelineItems.length ? getComputedStyle(timelineItems[0], "::after").display : "none",
          timelineDotDisplay: getComputedStyle(timelineList.querySelector(".timeline-dot")).display,
          timelineItemRects: timelineItems.map(item => {
            const itemRect = item.getBoundingClientRect();
            const dotRect = item.querySelector(".timeline-dot").getBoundingClientRect();
            const lineStyle = getComputedStyle(item, "::after");
            const contentRect = item.querySelector(".timeline-content").getBoundingClientRect();
            const icon = item.querySelector(".timeline-icon");
            const titleRect = item.querySelector(".timeline-title").getBoundingClientRect();
            return {
              left: itemRect.left, top: itemRect.top,
              dotCenter: dotRect.left + dotRect.width / 2, dotTop: dotRect.top, dotHeight: dotRect.height,
              lineTop: Number.parseFloat(lineStyle.top), lineHeight: Number.parseFloat(lineStyle.height),
              contentCenter: contentRect.left + contentRect.width / 2,
              iconDisplay: getComputedStyle(icon).display,
              iconLeft: icon.getBoundingClientRect().left,
              iconWidth: icon.getBoundingClientRect().width,
              titleLeft: titleRect.left
            };
          }),
          statusBadge: (() => {
            const badge = document.querySelector("#personPageEssentials .person-detail-status");
            const wrapper = document.querySelector("#personPageEssentials .person-detail-badges");
            const gender = document.querySelector("#personPageEssentials .person-detail-gender");
            const branch = document.querySelector("#personPageEssentials .person-detail-branch");
            return badge ? { text: badge.textContent.trim(), top: badge.getBoundingClientRect().top, branchTop: branch?.getBoundingClientRect().top, statusWidth: badge.getBoundingClientRect().width, branchWidth: branch?.getBoundingClientRect().width, wrapperWidth: wrapper.getBoundingClientRect().width, display: getComputedStyle(badge).display, wrapperDisplay: getComputedStyle(wrapper).display, badgeInWrapper: badge.parentElement === wrapper, genderInWrapper: gender?.parentElement === wrapper, genderDisplay: gender ? getComputedStyle(gender).display : "absent" } : null;
          })(),
          statusWrapperDisplay: document.querySelector("#personPageEssentials .person-detail-badges") ? getComputedStyle(document.querySelector("#personPageEssentials .person-detail-badges")).display : "absent",
          timelineLayout: (() => {
            const card = timeline.getBoundingClientRect();
            const list = timelineList.getBoundingClientRect();
            const heading = timeline.querySelector("h3").getBoundingClientRect();
            const firstItem = timelineItems[0];
            const dot = firstItem.querySelector(".timeline-dot").getBoundingClientRect();
            const line = firstItem.querySelector(".timeline-line").getBoundingClientRect();
            const title = firstItem.querySelector(".timeline-title").getBoundingClientRect();
            const date = firstItem.querySelector(".timeline-date").getBoundingClientRect();
            return {
              ratio: Number((list.width / card.width).toFixed(3)),
              centeredGap: Math.abs((list.left - card.left) - (card.right - list.right)),
              headingToLine: dot.top - heading.bottom,
              lineToContent: line.top - (dot.top + dot.height / 2),
              dateBelowTitle: date.top >= title.bottom - 1,
              titleTransform: getComputedStyle(firstItem.querySelector(".timeline-title")).textTransform,
              ageCount: timelineList.querySelectorAll(".timeline-age").length
            };
          })(),
          pdfFormatDisplay: pdfCard && getComputedStyle(pdfCard.querySelector(".person-detail-document-format")).display,
          imageFormatDisplay: imageCard && getComputedStyle(imageCard.querySelector(".person-detail-document-format")).display,
          extensionImageFormatDisplay: getComputedStyle(extensionImageCard.querySelector(".person-detail-document-format")).display,
          pdfVisualDisplay: getComputedStyle(pdfCard.querySelector(".person-detail-document-format-visual")).display,
          imageVisualDisplay: getComputedStyle(extensionImageCard.querySelector(".person-detail-document-format-visual")).display,
          pdfVisualText: pdfCard.querySelector(".person-detail-document-format-visual").textContent.trim(),
          imageVisualText: extensionImageCard.querySelector(".person-detail-document-format-visual").textContent.trim(),
          unknownVisualHref: unknownCard.querySelector(".person-detail-document-format-visual use")?.getAttribute("href"),
          pdfMetadata: pdfCard.querySelector(".person-detail-document-format").textContent.trim(),
          imageMetadata: extensionImageCard.querySelector(".person-detail-document-format").textContent.trim(),
          pdfMetadataIcons: pdfCard.querySelectorAll(".person-detail-document-format .ui-icon").length,
          imageMetadataIcons: extensionImageCard.querySelectorAll(".person-detail-document-format .ui-icon").length,
          unknownFormat: unknownCard.querySelector(".person-detail-document-format"),
          researchChevron: research ? getComputedStyle(research, "::after").content : "none",
          accountRight: account.getBoundingClientRect().right,
          brandLeft: brand.getBoundingClientRect().left,
          accountColumn: getComputedStyle(account).gridColumnStart,
          brandColumn: getComputedStyle(brand).gridColumnStart,
          menuActions: [...personMenu.querySelectorAll("[data-person-page-action]")].map(button => ({ action: button.dataset.personPageAction, icon: button.querySelector("use")?.getAttribute("href"), border: getComputedStyle(button).borderTopWidth })),
          mobileMenuTransferIcon: document.querySelector("#personPageMobileActionsMenu [data-person-page-action='change-tree'] use")?.getAttribute("href"),
          menuBorder: getComputedStyle(personMenu).borderTopWidth,
          menuShadow: getComputedStyle(personMenu).boxShadow
        };
      });
      assert.ok(layout.overflow <= 1, `${width}px : aucun débordement horizontal (${layout.overflow}px)`);
      assert.equal(layout.backCount, 1, `${width}px : un seul bouton Retour visible (desktop/mobile)`);
      assert.ok(layout.backHeight >= 44 && layout.editHeight >= 44, `${width}px : cibles tactiles suffisantes`);
      assert.equal(layout.columns, 1, `${width}px : contenu de lecture en une colonne maîtrisée`);
      if (width <= 900) {
        assert.equal(layout.mobileHeader, width <= 760, `${width}px : en-tête adapté au breakpoint existant`);
        assert.ok(layout.mobileModification.visible, `${width}px : dernière modification affichée sous le Hero`);
        assert.match(layout.mobileModification.text, /Dernière modification : \d{2}\/\d{2}\/2026 à \d{2}:\d{2}/, `${width}px : date courte sans auteur`);
        assert.equal(layout.mobileModification.align, "left", `${width}px : date alignée à gauche`);
        assert.ok(layout.mobileModification.top >= layout.heroBottom - 1, `${width}px : date placée après le Hero`);
        assert.equal(layout.essentialsDateVisible, false, `${width}px : aucune date dupliquée dans le Hero desktop actions`);
        assert.equal(layout.identityFacts.modificationCount, 0, `${width}px : aucune mention de modification dans Identité`);
        assert.equal(layout.identityFacts.columns, 2, `${width}px : Identité en deux colonnes`);
        assert.deepEqual(layout.identityFacts.cells.map(cell => cell.label), ["Prénom", "Second prénom", "Nom de naissance", "Nom d’usage", "Sexe", "Branche familiale"], `${width}px : six cellules dans l’ordre en trois lignes`);
        assert.equal(new Set(layout.identityFacts.cells.map(cell => Math.round(cell.top))).size, 3, `${width}px : six informations sur trois lignes`);
        for (let index = 0; index < 6; index += 2) {
          assert.ok(Math.abs(layout.identityFacts.cells[index].width - layout.identityFacts.cells[index + 1].width) <= 1, `${width}px : colonnes de largeur égale, ligne ${index / 2 + 1}`);
          assert.ok(Math.abs(layout.identityFacts.cells[index].top - layout.identityFacts.cells[index + 1].top) <= 1, `${width}px : cellules alignées, ligne ${index / 2 + 1}`);
        }
        assert.deepEqual(layout.overviewOrder, ["personPageIdentity", "personPageTimeline"], `${width}px : Identité avant Parcours de vie`);
        assert.ok(layout.identity.top < layout.timeline.top, `${width}px : Identité placée avant la timeline`);
        assert.equal(layout.navFlexWrap, "nowrap", `${width}px : navigation sections sur une ligne`);
        assert.equal(layout.navPosition, "sticky", `${width}px : navigation sticky conservée`);
        assert.equal(layout.navOverflowX, "auto", `${width}px : slider sections défilant horizontalement`);
        assert.equal(layout.navTabStyle.size, "13px", `${width}px : onglets sections 13px sur petit écran`);
        assert.equal(layout.navTabStyle.weight, "600", `${width}px : onglets sections en graisse 600`);
        assert.equal(layout.familyNameRelationGap.pixels, 4, `${width}px : écart effectif nom/relation Famille de 4px (${JSON.stringify(layout.familyNameRelationGap)})`);
        assert.equal(layout.familyNameRelationGap.linkMinHeight, "0px", `${width}px : bouton nom sans hauteur minimale qui écarte la relation`);
        assert.equal(layout.familyNameRelationGap.metaMargin, "0px", `${width}px : aucune marge cumulée sur la relation`);
        if (width <= 390) assert.ok(layout.navScrollWidth > layout.navClientWidth, `${width}px : slider laisse voir le débordement vers l'onglet suivant`);
        assert.equal(layout.navBackground, "rgb(247, 243, 234)", `${width}px : fond beige de page conservé derrière le slider`);
        assert.equal(layout.navBorderTop, "1px", `${width}px : ligne supérieure encadrant le slider`);
        assert.equal(layout.navBorderBottom, "1px", `${width}px : ligne inférieure encadrant le slider`);
        assert.ok(layout.mobileModification.bottom <= layout.navTop + 1, `${width}px : date située avant la ligne supérieure du slider`);
        assert.equal(Math.round(layout.firstSectionTop - layout.navBottom), 16, `${width}px : 16px entre la bordure basse du slider et le contenu`);
        const portraitCenter = (layout.portrait.top + layout.portrait.bottom) / 2;
        const headingCenter = (layout.headingBox.top + layout.headingBox.bottom) / 2;
        assert.ok(Math.abs(portraitCenter - headingCenter) <= 2.5, `${width}px : photo centrée verticalement par rapport au bloc d’informations (${Math.round((portraitCenter - headingCenter) * 10) / 10}px)`);
        assert.deepEqual(layout.mobileMenuSequence, ["Imprimer / PDF", "SEP", "Voir sa branche", "Changer d’arbre", "Retirer de l’arbre", "SEP", "Supprimer la personne"], `${width}px : menu ⋯ en sections Imprimer / branche-arbre / Supprimer`);
        assert.ok(layout.mobileMenuBorders.every(border => border === "0px"), `${width}px : actions du menu ⋯ sans encadrement individuel`);
        assert.ok(layout.familyVisualGap >= 3 && layout.familyVisualGap <= 5.5, `${width}px : écart visuel nom/relation Famille d’environ 4px (${layout.familyVisualGap}px)`);
        assert.equal(layout.heroDateRows.length, 2, `${width}px : lignes Naissance et Décès présentes`);
        assert.deepEqual(layout.heroDateRows.map(row => row.iconLabel), ["Naissance", "Décès"], `${width}px : icônes avec libellés accessibles`);
        assert.deepEqual(layout.heroDateRows.map(row => row.iconHref), ["#icon-sparkles", "#icon-cross"], `${width}px : icônes existantes de Parcours de vie réutilisées`);
        assert.ok(layout.heroDateRows.every(row => row.iconDisplay !== "none" && row.labelDisplay === "none" && row.copyWhiteSpace === "nowrap" && row.copyOverflow === "ellipsis"), `${width}px : icônes alignées et textes sur une ligne avec troncature`);
        assert.ok(Math.abs(layout.heroDateRows[0].top - layout.heroDateRows[1].top) > 0, `${width}px : naissance et décès occupent deux lignes distinctes`);
        assert.match(layout.pdfFormatDisplay, /flex/, `${width}px : format PDF visible dans les métadonnées mobile/tablette`);
        assert.match(layout.imageFormatDisplay, /flex/, `${width}px : format Image visible dans les métadonnées mobile/tablette`);
        assert.equal(layout.pdfVisualDisplay, "grid", `${width}px : pictogramme PDF dans la partie supérieure mobile/tablette`);
        assert.equal(layout.imageVisualDisplay, "grid", `${width}px : pictogramme image dans la partie supérieure mobile/tablette`);
        assert.equal(layout.researchChevron, "none", `${width}px : aucun chevron ajouté aux recherches sur tablette/mobile`);
        assert.equal(layout.navSeparator.content, '""', `${width}px : séparateur discret du slider`);
        assert.equal(layout.mobileMenuTransferIcon, "#icon-transfer", `${width}px : menu mobile reprend l’icône desktop Changer d’arbre`);
        assert.ok(layout.statusBadge && ["flex", "inline-flex"].includes(layout.statusBadge.display), `${width}px : badge Décédé visible dans la zone de badges`);
        assert.equal(layout.statusWrapperDisplay, "flex", `${width}px : badges regroupés dans une même zone`);
        assert.equal(layout.statusBadge.badgeInWrapper, true, `${width}px : badge Décédé dans la zone commune`);
        if (layout.statusBadge.branchWidth + layout.statusBadge.statusWidth + 8 <= layout.statusBadge.wrapperWidth) assert.ok(Math.abs(layout.statusBadge.top - layout.statusBadge.branchTop) <= 2, `${width}px : badges Arbre et Décédé sur la même ligne lorsque l’espace le permet (${JSON.stringify(layout.statusBadge)})`);
        assert.equal(layout.statusBadge.genderInWrapper, true, `${width}px : sexe dans la zone commune`);
        assert.equal(layout.statusBadge.genderDisplay, "none", `${width}px : badge sexe masqué dans le Hero`);
        assert.equal(layout.genderBadgeVisible, false, `${width}px : donnée Sexe conservée dans Identité sans badge Hero`);
        assert.match(await page.locator("#personPageIdentity").innerText(), /SEXE\s+Femme/i, `${width}px : sexe toujours visible dans Identité`);
        assert.equal(layout.timelineLayout.ageCount, 0, `${width}px : aucun âge affiché pour des dates incomplètes`);
        assert.equal(layout.docTitleStyle.size, 13, `${width}px : titres de documents à 13px sur mobile/tablette`);
        assert.equal(layout.docTitleStyle.weight, "600", `${width}px : titres de documents en graisse 600 sur mobile/tablette`);
        assert.ok(layout.actions[1].left < layout.actions[0].left, `${width}px : « Voir dans l’arbre » à gauche de « Modifier la fiche »`);
        if (width <= 430) {
          await page.locator('[data-person-page-section="research"]').click();
          await page.waitForTimeout(250);
          const activeTabBounds = await page.locator('[data-person-page-section="research"]').evaluate(button => {
            const nav = document.getElementById("personPageSectionNav").getBoundingClientRect();
            const tab = button.getBoundingClientRect();
            return { navLeft: nav.left, navRight: nav.right, tabLeft: tab.left, tabRight: tab.right };
          });
          assert.ok(activeTabBounds.tabLeft >= activeTabBounds.navLeft - 1 && activeTabBounds.tabRight <= activeTabBounds.navRight + 1, `${width}px : onglet actif ramené dans le slider`);
        }
      } else {
        assert.equal(layout.mobileModification.visible, false, `${width}px : mention mobile masquée sur desktop`);
        assert.ok(layout.actionDateVisible && layout.actionDateText.startsWith("Dernière modification :"), `${width}px : dernière modification conservée sous les CTA`);
        assert.ok(layout.heroDateRows.every(row => row.iconDisplay === "none" && row.labelDisplay !== "none"), `${width}px : libellés Naissance/Décès conservés, icônes mobiles masquées`);
        assert.equal(layout.navBackground, "rgb(247, 243, 234)", `${width}px : fond desktop de navigation inchangé`);
        assert.equal(layout.mobileHeader, false, `${width}px : en-tête mobile masqué sur desktop`);
        assert.deepEqual(layout.overviewOrder, ["personPageIdentity", "personPageTimeline"], `${width}px : ordre de lecture desktop aligné sur la présentation`);
        assert.equal(layout.overviewDisplay, "grid", `${width}px : grille Identité/Parcours de vie`);
        assert.equal(layout.overviewColumns, 2, `${width}px : deux colonnes Identité/Parcours`);
        assert.ok(Math.abs(layout.identity.height - layout.timeline.height) <= 1, `${width}px : cartes Identité et Parcours de vie de même hauteur`);
        assert.ok(layout.identity.left < layout.timeline.left, `${width}px : Identité à gauche, Parcours à droite`);
        assert.equal(layout.backTop < layout.heroTop, true, `${width}px : retour au-dessus de la carte`);
        assert.ok(layout.backTop >= layout.globalHeaderBottom - 1, `${width}px : retour sous l'en-tête global`);
        assert.ok(layout.heroTop - layout.backBottom >= 8, `${width}px : espace suffisant entre le retour et la carte (${Math.round(layout.heroTop - layout.backBottom)}px)`);
        assert.ok(Number.parseFloat(layout.titleSize) >= 30, `${width}px : nom de personne ≥30px (${layout.titleSize})`);
        assert.equal(layout.sectionTitleSize, "20px", `${width}px : titre principal commun de 20px`);
        assert.equal(layout.navBackground, "rgb(247, 243, 234)", `${width}px : barre de sections sur fond ivoire`);
        assert.equal(layout.navBorderTop, "1px", `${width}px : bordure supérieure de la barre visible`);
        assert.equal(layout.navBorderBottom, "1px", `${width}px : séparateur unique sous la navigation`);
        assert.equal(layout.navSeparator.content, '""', `${width}px : séparateurs verticaux discrets visibles`);
        assert.ok(layout.navSeparator.width <= 1 && layout.navSeparator.height < layout.navHeight, `${width}px : séparateurs courts sans toucher aux bordures`);
        assert.equal(layout.activeTabBackground, "rgb(232, 239, 233)", `${width}px : onglet actif vert clair`);
        assert.equal(layout.navTabStyle.size, "13px", `${width}px : navigation à 13px`);
        assert.equal(layout.navTabStyle.weight, "600", `${width}px : navigation en graisse 600`);
        const actionsTop = Math.min(...layout.actions.map(action => action.top));
        const actionsBottom = Math.max(...layout.actions.map(action => action.bottom));
        const actionsCenter = (actionsTop + actionsBottom) / 2;
        const heroCenter = (layout.heroTop + layout.heroBottom) / 2;
        assert.ok(Math.abs(actionsCenter - heroCenter) <= 12, `${width}px : actions centrées verticalement dans la carte (écart ${Math.round(Math.abs(actionsCenter - heroCenter))}px)`);
        assert.ok(layout.actionDateBottom <= layout.heroBottom && layout.actionDateBottom >= layout.heroBottom - 44, `${width}px : dernière modification près du bas de la carte`);
        assert.ok(Math.abs(layout.actionDateRight - layout.actions[2].right) <= 2, `${width}px : dernière modification alignée à droite des actions`);
        assert.ok(layout.actions[1].left < layout.actions[0].left && layout.actions[0].left < layout.actions[2].left, `${width}px : ordre CTA « Voir dans l’arbre », « Modifier la fiche », menu ⋯`);
        assert.equal(Math.round(layout.actions[0].left - layout.actions[1].right), 8, `${width}px : 8px conservés entre « Voir dans l’arbre » et « Modifier la fiche »`);
        assert.equal(Math.round(layout.actions[2].left - layout.actions[0].right), 12, `${width}px : 12px entre « Modifier la fiche » et le menu ⋯`);
        assert.equal(layout.editToSummaryGap, 12, `${width}px : écart visuel réel de 12px jusqu’au bouton ⋯ (${layout.editToSummaryGap}px)`);
        assert.ok(layout.actionDateVisible && !layout.essentialsDateVisible, `${width}px : date de modification sous les CTA uniquement (${layout.actionDateDisplay}, h=${layout.actionDateHeight}, essentials=${layout.essentialsDateVisible})`);
        assert.match(layout.actionDateText, /\d{2}\/\d{2}\/2026 à \d{2}:\d{2}/, `${width}px : date au format JJ/MM/AAAA à HH:mm`);
        assert.doesNotMatch(layout.actionDateText, /Archiviste/, `${width}px : auteur absent de la date de modification`);
        assert.ok(layout.actionDateRight <= layout.actions[2].right + 1, `${width}px : date alignée dans la colonne des CTA`);
        assert.equal(layout.genderBadgeVisible, false, `${width}px : badge Homme/Femme absent de l’en-tête`);
        assert.ok(layout.familyWidths.every(cardWidth => cardWidth <= 500), `${width}px : cartes Famille limitées à 500px`);
        assert.ok(layout.documentGrid.cardWidth >= 288 && layout.documentGrid.cardWidth <= 352, `${width}px : cartes Documents bornées à 288–352px (${layout.documentGrid.cardWidth}px)`);
        assert.equal(layout.timelineListStyle, "none", `${width}px : aucun numéro parasite dans la timeline`);
        assert.equal(layout.timelineLineDisplay, "block", `${width}px : liaison horizontale entre événements`);
        assert.notEqual(layout.timelineDotDisplay, "none", `${width}px : pastilles visibles`);
        assert.equal(layout.timelineItemRects.length, 3, `${width}px : naissance, mariage et décès seulement`);
        assert.ok(layout.timelineItemRects[0].left < layout.timelineItemRects[1].left && layout.timelineItemRects[1].left < layout.timelineItemRects[2].left, `${width}px : événements ordonnés horizontalement`);
        assert.ok(layout.timelineItemRects.every(item => Math.abs(item.top - layout.timelineItemRects[0].top) < 1), `${width}px : pastilles sur une même rangée`);
        assert.ok(layout.timelineItemRects.every(item => Math.abs(item.dotTop + item.dotHeight / 2 - item.top - item.lineTop - item.lineHeight / 2) <= 1), `${width}px : trait horizontal centré sur les pastilles`);
        assert.ok(layout.timelineLayout.ratio >= 0.75 && layout.timelineLayout.ratio <= 0.9, `${width}px : timeline centrée sur environ 84% de la carte (ratio ${layout.timelineLayout.ratio})`);
        assert.ok(layout.timelineLayout.centeredGap <= 4, `${width}px : timeline centrée horizontalement (écart ${layout.timelineLayout.centeredGap}px)`);
        layout.timelineItemRects.forEach((item, index) => {
          assert.ok(Math.abs(item.dotCenter - item.contentCenter) <= 2, `${width}px : pastille ${index + 1} alignée sur le centre de son bloc (${Math.round(item.dotCenter)} / ${Math.round(item.contentCenter)})`);
          assert.notEqual(item.iconDisplay, "none", `${width}px : icône de l'événement ${index + 1} visible`);
          assert.ok(item.iconLeft <= item.titleLeft, `${width}px : icône de l'événement ${index + 1} à gauche du libellé`);
          assert.ok(item.iconWidth <= 16, `${width}px : icône de l'événement ${index + 1} discrète (${item.iconWidth}px)`);
        });
        assert.ok(layout.timelineLayout.headingToLine >= 22 && layout.timelineLayout.headingToLine <= 30, `${width}px : respiration titre → ligne (${Math.round(layout.timelineLayout.headingToLine)}px)`);
        assert.ok(layout.timelineLayout.lineToContent >= 18 && layout.timelineLayout.lineToContent <= 24, `${width}px : respiration ligne → informations (${Math.round(layout.timelineLayout.lineToContent)}px)`);
        assert.equal(layout.timelineLayout.dateBelowTitle, true, `${width}px : date sur son propre niveau sous le libellé`);
        assert.equal(layout.timelineLayout.titleTransform, "uppercase", `${width}px : libellés d'événements en capitales`);
        assert.equal(layout.timelineLayout.ageCount, 0, `${width}px : aucun âge avec des dates de naissance/mariage partielles`);
        assert.equal(layout.statusBadge && ["flex", "inline-flex"].includes(layout.statusBadge.display), true, `${width}px : badge Décédé visible sur desktop (${layout.statusBadge && layout.statusBadge.display})`);
        assert.equal(layout.docTitleStyle.size, 13, `${width}px : titre documentaire à 13px`);
        assert.equal(layout.docTitleStyle.weight, "600", `${width}px : titre documentaire en graisse 600`);
        assert.ok(Math.abs(layout.docTitleStyle.lineHeight - 18.2) <= 0.5, `${width}px : interligne documentaire ≈ 1,4 (${layout.docTitleStyle.lineHeight}px)`);
        assert.match(layout.pdfFormatDisplay, /flex/, `${width}px : fichier PDF identifié par son format réel`);
        assert.match(layout.imageFormatDisplay, /flex/, `${width}px : image identifiée par son format réel`);
        assert.match(layout.extensionImageFormatDisplay, /flex/, `${width}px : extension image utilisée si le MIME est générique`);
        assert.equal(layout.pdfVisualDisplay, "grid", `${width}px : pictogramme PDF dans la partie supérieure`);
        assert.equal(layout.imageVisualDisplay, "grid", `${width}px : pictogramme Image dans la partie supérieure`);
        assert.equal(layout.pdfVisualText, "", `${width}px : aucun libellé PDF sous le pictogramme supérieur`);
        assert.equal(layout.imageVisualText, "", `${width}px : aucun libellé Image sous le pictogramme supérieur`);
        assert.equal(layout.pdfMetadata, "PDF", `${width}px : format PDF conservé en texte dans les métadonnées`);
        assert.equal(layout.imageMetadata, "Image", `${width}px : format Image conservé en texte dans les métadonnées`);
        assert.equal(layout.pdfMetadataIcons, 0, `${width}px : aucun pictogramme répété dans les métadonnées PDF`);
        assert.equal(layout.imageMetadataIcons, 0, `${width}px : aucun pictogramme répété dans les métadonnées Image`);
        assert.equal(layout.unknownVisualHref, "#icon-document", `${width}px : pictogramme générique pour format inconnu`);
        assert.equal(layout.unknownFormat, null, `${width}px : repli générique pour type inconnu`);
        assert.equal(layout.researchChevron, '"›"', `${width}px : chevron sur les recherches ouvrables`);
        assert.ok(layout.accountRight >= layout.viewport - 64 && layout.accountColumn === "3" && layout.brandColumn === "1", `${width}px : compte à droite et marque à gauche (${layout.brandLeft}/${layout.accountRight})`);
        assert.deepEqual(layout.menuActions.map(item => item.action), ["print", "branch", "change-tree", "remove-tree", "delete"], `${width}px : cinq actions dans le menu ⋯`);
        assert.deepEqual(layout.menuActions.slice(1, 4).map(item => item.icon), ["#icon-tree", "#icon-transfer", "#icon-unlink"], `${width}px : icônes distinctes pour les actions arbre`);
        assert.equal(layout.mobileMenuTransferIcon, "#icon-transfer", `${width}px : icône Changer d’arbre alignée sur le desktop`);
        assert.ok(layout.menuActions.every(item => item.border === "0px"), `${width}px : lignes de menu sans contours individuels`);
        assert.equal(layout.menuBorder, "1px", `${width}px : bordure unique du menu`);
        assert.notEqual(layout.menuShadow, "none", `${width}px : ombre légère du menu`);
      }
    }

    // Espace « Voir dans l'arbre » → « ⋯ » : 12 px en consultation et en modification desktop.
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => window.__personPageTest.openDirectory());
      await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
      await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
      const readCtaGap = () => page.evaluate(() => {
        const tree = document.getElementById("personPageViewTreeBtn");
        const menu = document.getElementById("personPageActions");
        const edit = document.getElementById("personPageEditBtn");
        const treeBox = tree.getBoundingClientRect();
        const menuBox = menu.getBoundingClientRect();
        const editBox = edit.getBoundingClientRect();
        const summaryBox = menu.querySelector("summary").getBoundingClientRect();
        return {
          gap: Math.round(menuBox.left - treeBox.right),
          summaryGap: Math.round(summaryBox.left - treeBox.right),
          editGap: Math.round(menuBox.left - editBox.right),
          treeToEdit: Math.round(editBox.left - treeBox.right),
          editToSummary: Math.round(summaryBox.left - editBox.right),
          treeHidden: tree.hidden, editHidden: edit.hidden,
          menuMarginLeft: getComputedStyle(menu).marginLeft
        };
      });
      const consultationGap = await readCtaGap();
      assert.equal(consultationGap.treeToEdit, 8, `${width}px : consultation — 8px entre Voir dans l'arbre et Modifier (${JSON.stringify(consultationGap)})`);
      assert.equal(consultationGap.editToSummary, 12, `${width}px : consultation — 12px entre Modifier et le bouton ⋯ (${JSON.stringify(consultationGap)})`);
      const consultState = await page.evaluate(() => {
        const date = document.querySelector(".person-detail-modification--actions").getBoundingClientRect();
        const nav = document.getElementById("personPageSectionNav");
        const first = document.querySelector("#personPageContent .person-detail-overview > section");
        return { date: { l: Math.round(date.left), t: Math.round(date.top), b: Math.round(date.bottom), h: Math.round(date.height) }, navGap: Math.round(first.getBoundingClientRect().top - nav.getBoundingClientRect().bottom) };
      });
      await page.locator("#personPageEditBtn").click();
      await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
      await page.waitForTimeout(400);
      const editionGap = await readCtaGap();
      assert.equal(editionGap.gap, 12, `${width}px : modification — 12px entre Voir dans l'arbre et ⋯ (${JSON.stringify(editionGap)})`);
      assert.equal(editionGap.summaryGap, 12, `${width}px : modification — bouton ⋯ visible à 12px (${JSON.stringify(editionGap)})`);
      const editionState = await page.evaluate(() => {
        const date = document.querySelector(".person-detail-modification--actions");
        const box = date.getBoundingClientRect();
        const hero = document.querySelector(".person-detail-hero").getBoundingClientRect();
        const footer = document.querySelector("#personPageEditHost .person-actions").getBoundingClientRect();
        const nav = document.getElementById("personPageSectionNav");
        const panel = document.getElementById("personIdentityPanel");
        const documentLabel = document.getElementById("linkDocumentBtn").innerText.trim();
        const copy = document.querySelector("#personRelationsPanel .relation-person-copy");
        const link = copy.querySelector("strong");
        const meta = copy.querySelector(".relation-person-meta");
        const textRect = element => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect(); };
        const linkText = textRect(link), metaText = textRect(meta);
        return {
          date: { l: Math.round(box.left), t: Math.round(box.top), b: Math.round(box.bottom), h: Math.round(box.height) },
          documentLabel,
          footer: { left: Math.round(footer.left), right: Math.round(footer.right), heroLeft: Math.round(hero.left), heroRight: Math.round(hero.right) },
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          navGap: Math.round(panel.getBoundingClientRect().top - nav.getBoundingClientRect().bottom),
          familyVisualGap: Math.round((metaText.top - linkText.bottom) * 10) / 10
        };
      });
      assert.ok(editionState.date.h <= 22, `${width}px : « Dernière modification » sur une seule ligne en modification (${editionState.date.h}px)`);
      assert.equal(JSON.stringify(editionState.date), JSON.stringify(consultState.date), `${width}px : position de la mention identique en consultation et modification (${JSON.stringify(consultState.date)} / ${JSON.stringify(editionState.date)})`);
      assert.equal(editionState.footer.left, editionState.footer.heroLeft, `${width}px : footer desktop aligné à gauche du Hero`);
      assert.equal(editionState.footer.right, editionState.footer.heroRight, `${width}px : footer desktop aligné à droite du Hero`);
      assert.equal(editionState.navGap, consultState.navGap, `${width}px : espacement sous la navigation identique entre consultation (${consultState.navGap}px) et modification (${editionState.navGap}px)`);
      assert.equal(editionState.documentLabel, "Ajouter un document pour cette personne", `${width}px : libellé long Documents conservé sur desktop`);
      assert.ok(editionState.horizontalOverflow <= 1, `${width}px : libellé desktop sans débordement (${editionState.horizontalOverflow}px)`);
      assert.ok(editionState.familyVisualGap >= 3 && editionState.familyVisualGap <= 5, `${width}px : cartes Famille compactes en modification (${editionState.familyVisualGap}px)`);
      await page.locator('#personPageEditHost [data-close="personDialog"]').click();
      await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    }

    for (const width of [320, 375, 390, 430, 768, 900]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => window.__personPageTest.openDirectory());
      await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
      await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
      const consultCard = await page.evaluate(() => {
        const box = document.getElementById("personPageIdentity").getBoundingClientRect();
        return { l: Math.round(box.left), r: Math.round(box.right) };
      });
      await page.locator("#personPageEditBtn").click();
      await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
      await page.waitForTimeout(400);
      const inlineResponsive = await page.evaluate(() => {
        const hero = document.querySelector(".person-detail-hero").getBoundingClientRect();
        const actions = document.querySelector(".person-detail-header-actions").getBoundingClientRect();
        const tree = document.getElementById("personPageViewTreeBtn").getBoundingClientRect();
        const nav = document.getElementById("personPageSectionNav");
        const panels = [...document.querySelectorAll("#personPageEditHost .person-section-panel")].map(panel => { const box = panel.getBoundingClientRect(); return { id: panel.id, l: Math.round(box.left), r: Math.round(box.right) }; });
        const docsPanel = document.getElementById("personDocumentsPanel").getBoundingClientRect();
        const docsCard = document.getElementById("personDocumentsSection");
        const docsCardBox = docsCard.getBoundingClientRect();
        const docsCardStyle = getComputedStyle(docsCard);
        const addDoc = document.getElementById("linkDocumentBtn").getBoundingClientRect();
        const evidence = document.getElementById("personGenealogyEvidenceSection");
        const evidenceBox = evidence.getBoundingClientRect();
        const evidenceStyle = getComputedStyle(evidence);
        const evidenceTitle = evidence.querySelector("h4").getBoundingClientRect();
        const evidenceList = document.getElementById("personGenealogyEvidenceList").getBoundingClientRect();
        const addProof = document.getElementById("genealogyProposeProofForPersonBtn").getBoundingClientRect();
        const relationButton = document.getElementById("toggleRelationBuilderBtn");
        const relationButtonStyle = getComputedStyle(relationButton);
        const addDocumentButton = document.getElementById("linkDocumentBtn");
        const footer = document.querySelector("#personPageEditHost .person-actions");
        const footerStyle = getComputedStyle(footer);
        const footerButtons = [...footer.querySelectorAll(".right .btn:not([hidden])")].map(button => { const box = button.getBoundingClientRect(); return { label: button.innerText.trim(), top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height) }; });
        const copy = document.querySelector("#personRelationsPanel .relation-person-copy");
        const link = copy.querySelector("strong");
        const meta = copy.querySelector(".relation-person-meta");
        const textRect = element => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect(); };
        const linkText = textRect(link), metaText = textRect(meta);
        return {
          timelineInHost: document.getElementById("personLifeTimeline").parentElement === document.getElementById("personPageEditHost"),
          timelineHidden: getComputedStyle(document.getElementById("personLifeTimeline")).display === "none",
          panelDisplay: getComputedStyle(document.getElementById("personIdentityPanel")).display,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          actions: getComputedStyle(document.querySelector("#personPageEditHost .person-actions")).position,
          navGap: Math.round(panels.length ? document.getElementById("personIdentityPanel").getBoundingClientRect().top - nav.getBoundingClientRect().bottom : -1),
          panels,
          actionsCenterDelta: Math.round((actions.left + actions.right) / 2 - (hero.left + hero.right) / 2),
          treeCenterDelta: Math.round((tree.left + tree.right) / 2 - (hero.left + hero.right) / 2),
          addDocToTitle: Math.round(evidenceTitle.top - addDoc.bottom),
          addDocToCardBottom: Math.round(docsCardBox.bottom - addDoc.bottom),
          evidenceTitleInset: Math.round(evidenceTitle.top - evidenceBox.top),
          docsCardsGap: Math.round(evidenceBox.top - docsCardBox.bottom),
          docsAndEvidenceSiblings: docsCard.parentElement === evidence.parentElement,
          docsCardStyle: { background: docsCardStyle.backgroundColor, border: docsCardStyle.borderTopWidth, radius: docsCardStyle.borderTopLeftRadius },
          evidenceCardStyle: { background: evidenceStyle.backgroundColor, border: evidenceStyle.borderTopWidth, radius: evidenceStyle.borderTopLeftRadius },
          addDocumentLabel: addDocumentButton.innerText.trim(),
          listToProof: Math.round(addProof.top - evidenceList.bottom),
          proofToCardBottom: Math.round(docsPanel.bottom - addProof.bottom),
          familyVisualGap: Math.round((metaText.top - linkText.bottom) * 10) / 10,
          relationButtonStyle: { border: relationButtonStyle.borderTopColor, background: relationButtonStyle.backgroundColor, color: relationButtonStyle.color, height: Math.round(relationButton.getBoundingClientRect().height), width: Math.round(relationButton.getBoundingClientRect().width) },
          footer: { height: Math.round(footer.getBoundingClientRect().height), minHeight: footerStyle.minHeight, paddingTop: footerStyle.paddingTop, paddingBottom: footerStyle.paddingBottom, bottom: footerStyle.bottom, buttons: footerButtons }
        };
      });
      assert.equal(inlineResponsive.timelineInHost, true, `${width}px : placement historique de la timeline inline conservé`);
      assert.notEqual(inlineResponsive.panelDisplay, "grid", `${width}px : nouvelle grille desktop non appliquée au mode tablette/mobile`);
      assert.ok(inlineResponsive.overflow <= 1, `${width}px : édition sans débordement (${inlineResponsive.overflow}px)`);
      assert.equal(inlineResponsive.actions, "sticky", `${width}px : barre Enregistrer/Annuler conservée`);
      assert.equal(inlineResponsive.timelineHidden, true, `${width}px : Parcours de vie masqué en modification mobile`);
      assert.equal(inlineResponsive.navGap, 16, `${width}px : 16px entre le slider et le premier bloc éditable (${inlineResponsive.navGap}px)`);
      assert.ok(inlineResponsive.panels.every(panel => panel.l === consultCard.l && panel.r === consultCard.r), `${width}px : blocs d’édition sur la même largeur utile que la consultation (${JSON.stringify(inlineResponsive.panels)} vs ${JSON.stringify(consultCard)})`);
      assert.ok(Math.abs(inlineResponsive.actionsCenterDelta) <= 2, `${width}px : groupe d’actions centré dans le Hero en modification (${inlineResponsive.actionsCenterDelta}px)`);
      if (width <= 760) assert.ok(Math.abs(inlineResponsive.treeCenterDelta) <= 2, `${width}px : « Voir dans l’arbre » centré en modification (${inlineResponsive.treeCenterDelta}px)`);
      assert.equal(inlineResponsive.docsAndEvidenceSiblings, true, `${width}px : Documents et Preuves restent deux cartes indépendantes`);
      assert.equal(inlineResponsive.docsCardsGap, 16, `${width}px : cartes Documents et Preuves séparées de 16px (${inlineResponsive.docsCardsGap}px)`);
      assert.ok(inlineResponsive.addDocToCardBottom >= 12, `${width}px : bouton document respirant sous le contenu de sa carte (${inlineResponsive.addDocToCardBottom}px)`);
      assert.ok(inlineResponsive.evidenceTitleInset >= 12, `${width}px : titre Preuves à l’intérieur de sa carte (${inlineResponsive.evidenceTitleInset}px)`);
      assert.ok(inlineResponsive.docsCardStyle.border === "1px" && inlineResponsive.evidenceCardStyle.border === "1px", `${width}px : Documents et Preuves ont chacune leur bordure`);
      assert.equal(inlineResponsive.docsCardStyle.background, inlineResponsive.evidenceCardStyle.background, `${width}px : cartes Documents et Preuves avec le même fond`);
      assert.equal(inlineResponsive.docsCardStyle.radius, inlineResponsive.evidenceCardStyle.radius, `${width}px : arrondis cohérents entre les cartes`);
      assert.notEqual(inlineResponsive.docsCardStyle.radius, "0px", `${width}px : cartes indépendantes avec coins arrondis`);
      assert.equal(inlineResponsive.addDocumentLabel, "Ajouter un document", `${width}px : libellé mobile raccourci sans bouton dupliqué`);
      assert.ok(inlineResponsive.listToProof >= 16, `${width}px : au moins 16px entre les preuves et « Ajouter une preuve » (${inlineResponsive.listToProof}px)`);
      assert.ok(inlineResponsive.proofToCardBottom >= 16, `${width}px : au moins 16px sous « Ajouter une preuve » avant la fin de la carte (${inlineResponsive.proofToCardBottom}px)`);
      assert.ok(inlineResponsive.familyVisualGap >= 3 && inlineResponsive.familyVisualGap <= 5, `${width}px : écart visuel nom/relation en modification (~4px, ${inlineResponsive.familyVisualGap}px)`);
      assert.equal(inlineResponsive.relationButtonStyle.background, "rgb(255, 253, 248)", `${width}px : ajout lien familial en bouton secondaire`);
      assert.equal(inlineResponsive.relationButtonStyle.border, "rgb(214, 204, 187)", `${width}px : bordure secondaire conservée`);
      assert.equal(inlineResponsive.relationButtonStyle.color, "rgb(40, 75, 63)", `${width}px : texte vert foncé`);
      assert.equal(inlineResponsive.footer.minHeight, "0px", `${width}px : footer sans hauteur minimale superflue`);
      assert.equal(inlineResponsive.footer.paddingTop, "12px", `${width}px : padding haut du footer de 12px`);
      assert.equal(inlineResponsive.footer.paddingBottom, "12px", `${width}px : padding bas unique du footer de 12px`);
      assert.ok(inlineResponsive.footer.height <= 74, `${width}px : footer compact (${inlineResponsive.footer.height}px)`);
      assert.ok(inlineResponsive.footer.buttons.length >= 2, `${width}px : boutons du footer présents`);
      assert.ok(inlineResponsive.footer.buttons.every(button => button.height >= (width <= 760 ? 44 : 40)), `${width}px : hauteur des boutons du footer conservée`);
      assert.deepEqual(inlineResponsive.footer.buttons.map(button => button.label), ["Annuler", "Enregistrer"], `${width}px : libellés du footer inchangés`);
      assert.equal(new Set(inlineResponsive.footer.buttons.map(button => button.top)).size, 1, `${width}px : boutons Annuler/Enregistrer restent sur une seule ligne`);
      if (width === 390) {
        await page.locator("#genealogyProposeProofForPersonBtn").scrollIntoViewIfNeeded();
        const lastControl = await page.evaluate(() => {
          const last = document.getElementById("genealogyProposeProofForPersonBtn").getBoundingClientRect();
          const footer = document.querySelector("#personPageEditHost .person-actions").getBoundingClientRect();
          return { lastBottom: Math.round(last.bottom), footerTop: Math.round(footer.top) };
        });
        assert.ok(lastControl.lastBottom <= lastControl.footerTop + 1, `390px : dernière action visible au-dessus du footer (${JSON.stringify(lastControl)})`);
      }
      await page.locator('#personPageEditHost [data-close="personDialog"]').click();
      await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    }

    // Timeline : âges calculés uniquement lorsque les dates sont exactes.
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-d"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const exactAges = await page.evaluate(() => ({
      titles: [...document.querySelectorAll("#personPageTimeline .timeline-title")].map(node => node.textContent.trim()),
      ages: [...document.querySelectorAll("#personPageTimeline .timeline-age")].map(node => node.textContent.trim()),
      ageDisplay: getComputedStyle(document.querySelector("#personPageTimeline .timeline-age")).display
    }));
    assert.deepEqual(exactAges.titles, ["Naissance", "Mariage", "Décès"], "parcours complet : naissance, mariage, décès");
    assert.deepEqual(exactAges.ages, ["· 26 ans", "· 26 ans"], "âges au mariage et au décès, aucun à la naissance");
    assert.ok(["inline", "block"].includes(exactAges.ageDisplay), `âge visible sur desktop (${exactAges.ageDisplay})`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-d"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const mobileExact = await page.evaluate(() => {
      const title = document.getElementById("personPageTitle").getBoundingClientRect();
      const dates = [...document.querySelectorAll("#personPageEssentials .person-detail-dates")].map(row => row.getBoundingClientRect());
      const portrait = document.getElementById("personPagePortrait").getBoundingClientRect();
      const coreTop = Math.min(title.top, ...dates.map(rect => rect.top));
      const coreBottom = Math.max(title.bottom, ...dates.map(rect => rect.bottom));
      return {
        age: getComputedStyle(document.querySelector("#personPageTimeline .timeline-age")).display,
        status: getComputedStyle(document.querySelector("#personPageEssentials .person-detail-status")).display,
        photoCenterDelta: Math.round(((portrait.top + portrait.bottom) / 2 - (coreTop + coreBottom) / 2) * 10) / 10,
        titleLines: Math.round(title.height / Number.parseFloat(getComputedStyle(document.getElementById("personPageTitle")).lineHeight)),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert.match(mobileExact.age, /inline|block|flex/, `âge exact visible sur mobile (${mobileExact.age})`);
    assert.ok(["flex", "inline-flex"].includes(mobileExact.status), `badge Décédé visible sur mobile (${mobileExact.status})`);
    assert.ok(Math.abs(mobileExact.photoCenterDelta) <= 2.5, `portrait centré sur le nom et les dates malgré les badges (${mobileExact.photoCenterDelta}px)`);
    assert.ok(mobileExact.titleLines >= 1, `nom long conservé sur une ou plusieurs lignes (${mobileExact.titleLines})`);
    assert.ok(mobileExact.overflow <= 1, `mobile sans débordement (${mobileExact.overflow}px)`);
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    const emptyEditCards = await page.evaluate(() => ({
      documents: document.getElementById("personDocumentsList").innerText,
      proofs: document.getElementById("personGenealogyEvidenceList").innerText,
      docsCardParent: document.getElementById("personDocumentsSection").parentElement.id,
      proofCardParent: document.getElementById("personGenealogyEvidenceSection").parentElement.id
    }));
    assert.match(emptyEditCards.documents, /Aucun document associé/, "état vide des Documents conservé en modification mobile");
    assert.match(emptyEditCards.proofs, /Aucune preuve associée/, "état vide des Preuves conservé en modification mobile");
    assert.equal(emptyEditCards.docsCardParent, "personDocumentsPanel", "carte Documents reste dans le formulaire unique");
    assert.equal(emptyEditCards.proofCardParent, "personDocumentsPanel", "carte Preuves reste dans le formulaire unique");
    await page.locator('#personPageEditHost [data-close="personDialog"]').click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);

    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => window.__personPageTest.update("person-page-d", {
      firstName: "Rosa Margherita Teresa", middleName: "Elisabetta", lastName: "Giovannoni Conti"
    }));
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-d"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const longNameMobile = await page.evaluate(() => {
      const title = document.getElementById("personPageTitle");
      const titleBox = title.getBoundingClientRect();
      const dates = [...document.querySelectorAll("#personPageEssentials .person-detail-dates")].map(row => row.getBoundingClientRect());
      const portrait = document.getElementById("personPagePortrait").getBoundingClientRect();
      const coreTop = Math.min(titleBox.top, ...dates.map(box => box.top));
      const coreBottom = Math.max(titleBox.bottom, ...dates.map(box => box.bottom));
      return {
        titleLines: Math.round(titleBox.height / Number.parseFloat(getComputedStyle(title).lineHeight)),
        photoDelta: Math.round(((portrait.top + portrait.bottom) / 2 - (coreTop + coreBottom) / 2) * 10) / 10,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert.ok(longNameMobile.titleLines >= 2, `nom long sur plusieurs lignes à 320px (${longNameMobile.titleLines})`);
    assert.ok(Math.abs(longNameMobile.photoDelta) <= 2.5, `photo centrée face au nom long (${longNameMobile.photoDelta}px)`);
    assert.ok(longNameMobile.overflow <= 1, `nom long sans débordement horizontal (${longNameMobile.overflow}px)`);

    // Navigation par ancres : haut de section sous la barre sticky de navigation.
    const measureAnchor = () => page.evaluate(() => {
      const nav = document.getElementById("personPageSectionNav").getBoundingClientRect();
      const active = document.querySelector("#personPageSectionNav [aria-current='location']");
      const target = {
        identity: document.getElementById("personPageOverview"),
        family: document.getElementById("personPageFamily"),
        documents: document.getElementById("personPageDocuments"),
        research: document.getElementById("personPageResearch")
      }[active.dataset.personPageSection];
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const stickyTop = Number.parseFloat(getComputedStyle(document.getElementById("personPageSectionNav")).top);
      const targetTop = target.getBoundingClientRect().top;
      return {
        gap: targetTop - (stickyTop + nav.height),
        gapNow: targetTop - nav.bottom,
        saturated: window.scrollY >= maxScroll - 1,
        scrollY: Math.round(window.scrollY),
        offsetVar: document.documentElement.style.getPropertyValue("--person-page-anchor-offset"),
        scrollMargin: getComputedStyle(target).scrollMarginTop
      };
    });
    const clickSection = async section => {
      await page.locator(`[data-person-page-section="${section}"]`).click();
      await page.waitForTimeout(800);
      return measureAnchor();
    };
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => window.__personPageTest.openDirectory());
      await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
      await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
      await page.waitForTimeout(400);
      for (const [from, to] of [["identity", "documents"], ["documents", "identity"], ["research", "identity"], ["family", "research"], ["research", "family"]]) {
        for (const [label, section] of [[from, from], [`${from} → ${to}`, to]]) {
          const result = await clickSection(section);
          assert.ok(result.gapNow >= 0, `${width}px : ${label} — titre non masqué par la barre (${Math.round(result.gapNow)}px)`);
          if (!result.saturated) assert.ok(result.gap >= 14 && result.gap <= 24, `${width}px : ${label} — section sous la barre sticky (${Math.round(result.gap)}px)`);
        }
      }
      // Retour vers une section déjà active après défilement manuel.
      await clickSection("documents");
      await page.evaluate(() => window.scrollBy({ top: 300, behavior: "instant" }));
      const afterManual = await clickSection("documents");
      assert.ok(afterManual.gapNow >= 0, `${width}px : réactivation après défilement manuel — titre non masqué (${Math.round(afterManual.gapNow)}px)`);
      if (!afterManual.saturated) assert.ok(afterManual.gap >= 14 && afterManual.gap <= 24, `${width}px : réactivation après défilement manuel (${Math.round(afterManual.gap)}px)`);
    }

    for (const width of [390, 768, 900]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => window.__personPageTest.openDirectory());
      await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
      await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
      await page.locator('[data-person-page-section="family"]').click();
      await page.waitForTimeout(800);
      const mobileAnchor = await page.evaluate(() => {
        const nav = document.getElementById("personPageSectionNav");
        const navBox = nav.getBoundingClientRect();
        const section = document.getElementById("personPageFamily");
        return { position: getComputedStyle(nav).position, gap: section.getBoundingClientRect().top - navBox.bottom, scrollMargin: getComputedStyle(section).scrollMarginTop };
      });
      assert.equal(mobileAnchor.position, "sticky", `${width}px : navigation reste sticky`);
      assert.ok(mobileAnchor.gap >= 14, `${width}px : ancre Famille visible sous le slider (${mobileAnchor.gap}px)`);
    }

    // Lien Retour : position identique en consultation et en modification (1280 px).
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const backConsultation = await page.evaluate(() => document.getElementById("personPageBackBtn").getBoundingClientRect().top);
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    const backEdition = await page.evaluate(() => document.getElementById("personPageBackBtn").getBoundingClientRect().top);
    assert.ok(Math.abs(backConsultation - backEdition) <= 1, `retour à position identique en consultation et modification (${backConsultation}px / ${backEdition}px)`);
    await page.locator('#personPageEditHost [data-close="personDialog"]').click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);

    // Documents : rendu identique entre consultation et modification, crayon indépendant.
    const readDocumentCards = inEdit => page.evaluate(inEdition => {
      const card = inEdition
        ? document.querySelector("#personDocumentsList .person-doc-card--pdf")
        : document.querySelector("#personPageDocuments .person-doc-card--pdf");
      const thumb = card.querySelector(".person-doc-thumb");
      const meta = card.querySelector(".person-doc-meta");
      const title = card.querySelector(".person-doc-title");
      const subrow = card.querySelector(".person-doc-subrow");
      return {
        height: Math.round(card.getBoundingClientRect().height),
        width: Math.round(card.getBoundingClientRect().width),
        thumb: Math.round(thumb.getBoundingClientRect().height),
        meta: Math.round(meta.getBoundingClientRect().height),
        title: Math.round(title.getBoundingClientRect().height),
        subrow: Math.round(subrow.getBoundingClientRect().height),
        format: getComputedStyle(card.querySelector(".person-detail-document-format-visual")).display,
        editCount: card.querySelectorAll(".person-doc-edit").length
      };
    }, inEdit);
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const consultCards = await readDocumentCards(false);
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    const editCards = await readDocumentCards(true);
    assert.equal(consultCards.format, "grid", "pictogramme de format affiché en consultation");
    assert.equal(editCards.format, consultCards.format, "pictogramme de format identique en modification");
    assert.equal(consultCards.editCount, 0, "aucun crayon en consultation");
    assert.equal(editCards.editCount, 1, "un crayon en modification");
    assert.ok(Math.abs(editCards.height - consultCards.height) <= 1, `hauteurs identiques (${consultCards.height}px / ${editCards.height}px)`);
    assert.ok(Math.abs(editCards.width - consultCards.width) <= 1, `largeurs identiques (${consultCards.width}px / ${editCards.width}px)`);
    assert.ok(Math.abs(editCards.thumb - consultCards.thumb) <= 1, `zones vignette identiques (${consultCards.thumb}px / ${editCards.thumb}px)`);
    assert.ok(Math.abs(editCards.meta - consultCards.meta) <= 1, `zones d'information identiques (${consultCards.meta}px / ${editCards.meta}px)`);
    assert.equal(editCards.title, consultCards.title, "titres de la même hauteur");
    assert.equal(editCards.subrow, consultCards.subrow, "métadonnées de la même hauteur");
    await page.locator("#personDocumentsList .person-doc-card--pdf .person-doc-edit").click();
    await page.waitForTimeout(500);
    const afterPencil = await page.evaluate(() => ({
      documentDialog: document.getElementById("documentDialog").open,
      documentPage: !document.getElementById("documentDetailView").hidden,
      personDialog: document.getElementById("personDialog").open,
      personPage: !document.getElementById("personDetailView").hidden,
      editHost: !document.getElementById("personPageEditHost").hidden
    }));
    assert.equal(afterPencil.documentDialog, true, "le crayon ouvre le formulaire de modification du document");
    assert.equal(afterPencil.documentPage, false, "le crayon n'ouvre pas la page de consultation du document");
    assert.equal(afterPencil.personDialog, false, "la modale historique personne ne s'ouvre pas par-dessus l'édition");
    assert.equal(afterPencil.personPage, true, "la page Personne reste affichée");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("documentDialog").open);
    await page.waitForTimeout(300);
    const afterDocumentClose = await page.evaluate(() => {
      const dialog = document.getElementById("personDialog");
      return {
        personDialogExists: !!dialog,
        personDialogTag: dialog ? dialog.tagName : "absent",
        personDialogOpen: dialog ? dialog.open : null,
        personPage: !document.getElementById("personDetailView").hidden,
        editHost: !document.getElementById("personPageEditHost").hidden
      };
    });
    assert.equal(afterDocumentClose.personDialogOpen, false, `la fermeture du formulaire ne rouvre pas la modale personne (${JSON.stringify(afterDocumentClose)} | erreurs: ${errors.join(" | ")})`);
    assert.equal(afterDocumentClose.personPage, true, "la page Personne reste affichée après le crayon");

    await page.evaluate(() => window.__personPageTest.openTree());
    await page.waitForSelector("#treeScene .person");
    await page.locator('#treeScene .person[data-person-id="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    assert.equal((await page.locator("#personPageTitle").textContent()).trim(), "Adélaïde Maria Rossi", "ouverture de la page depuis l’arbre");
    assert.deepEqual(errors, [], `aucune erreur JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
