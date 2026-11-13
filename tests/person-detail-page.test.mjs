import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const svg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#557a65"/></svg>');
const hooks = `
window.__personPageTest = {
  seed() {
    people = [
      { id: "person-page-a", firstName: "Ada", middleName: "Maria", lastName: "Rossi", marriedName: "Bianchi", gender: "F", branch: "Ramo Conti", birthDateInfo: { type: "year", year: 1890 }, place: "Palermo", deathDateInfo: { type: "year", year: 1931 }, deathPlace: "Metz", notes: "Note de consultation", photoUrl: "${svg}", updatedAt: { toDate: () => new Date("2026-10-24T03:30:00Z") }, updatedByName: "Archiviste", inTree: true },
      { id: "person-page-b", firstName: "Carlo", lastName: "Rossi", gender: "M", birthDateInfo: { type: "year", year: 1860 }, place: "Palermo" },
      { id: "person-page-c", firstName: "Lina", lastName: "Rossi", gender: "F", birthAttestations: [{ id: "lina-birth-attestation", comment: "Acte de naissance de Lina", documentIds: ["person-page-document"] }, { id: "lina-birth-attestation-2", comment: "Second acte de naissance de Lina", documentIds: ["person-page-pdf"] }] },
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
      { id: "person-page-unknown", title: "Fichier inconnu", type: "Archive", fileName: "fichier.bin", mimeType: "application/octet-stream", personIds: ["person-page-a"] },
      { id: "person-page-unlinked", title: "Document sans lien", type: "Archive", fileName: "sans-lien.bin", mimeType: "application/octet-stream", personIds: [] }
    ];
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    genealogyRecords = {
      sourceDocuments: [{ id: "person-page-source", data: { id: "person-page-source", title: "Cadastre d’Orino", status: "active", personIds: ["person-page-a"], documentIds: [] } }], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [],
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
    window.__personPageUpdates = [...(window.__personPageUpdates || []), { id, firstName: data.firstName, place: data.place, birthDate: data.birthDate, birthDateInfo: data.birthDateInfo, deathDate: data.deathDate, deathDateInfo: data.deathDateInfo }];
    const current = people.find(item => item.id === id) || (activePersonPageItem?.id === id ? activePersonPageItem : { id });
    const updated = { ...current, ...data, updatedAt: { toDate: () => new Date("2026-11-04T12:00:00Z") }, updatedByName: "Archiviste" };
    people = people.some(item => item.id === id)
      ? people.map(item => item.id === id ? updated : item)
      : [...people, updated];
    if (activePersonPageItem?.id === id) activePersonPageItem = updated;
  },
  updateFamilyDetails(id, data) {
    families = families.map(item => item.id === id ? { ...item, ...data } : item);
  },
  openTree() { renderTree(); setView("tree"); },
  openDirectory() { setView("directory"); },
  openEvidenceModal(section = "documents") {
    openPerson(people.find(item => item.id === "person-page-a"), "directory");
    setPersonSection(section);
  },
  openCreatePerson() { openPerson(null, "directory"); },
  journeyState() {
    const person = people.find(item => item.id === "person-page-a");
    return {
      residences: person?.residences || [],
      professions: person?.professions || [],
      lifeEvents: person?.lifeEvents || [],
      birthAttestations: person?.birthAttestations || [],
      deathAttestations: person?.deathAttestations || [],
      families: families.map(family => ({ id: family.id, marriageAttestations: family.marriageAttestations || [] }))
    };
  },
  updateLifeEventAttestations(kind, attestations) {
    window.__personPageLifeEventWrites = [...(window.__personPageLifeEventWrites || []), { kind, attestations: attestations.map(value => ({ ...value })) }];
  },
  documentExists(id) { return documents.some(documentItem => documentItem.id === id); },
  rerenderJourney() { renderJourneySection(); },
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
  addJourneyLayoutFixtures() {
    const item = people.find(value => value.id === "person-page-a");
    const residences = item.residences || [];
    item.residences = [...residences, { id: "long-title-residence", place: "Metz-sur-l'Esch-sur-Alzette-la-Grande", region: "", country: "", dateInfo: { type: "between", from: 1925, to: 1931 }, attestations: [{ id: "long-title-att-1", comment: "Premier justificatif", documentIds: ["person-page-document"] }, { id: "long-title-att-2", comment: "Second justificatif", documentIds: ["person-page-document"] }] }];
    const lifeEvents = item.lifeEvents || [];
    item.lifeEvents = [...lifeEvents, { id: "static-detail-event", kind: "studies", label: "Études" }];
    people = people.map(value => value.id === item.id ? item : value);
    renderJourneySection();
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
    if (url.startsWith("https://family-tree-geonames.giovannoni-f.workers.dev/")) {
      const query = new URL(url).searchParams.get("q")?.toLocaleLowerCase("fr-FR") || "";
      const geoname = query.startsWith("var")
        ? { name: "Varese", adminName2: "Province de Varese", adminName1: "Lombardie", countryName: "Italie", countryCode: "IT", geonameId: 3164699 }
        : { name: "Orino", adminName2: "Varese", adminName1: "Lombardia", countryName: "Italie", countryCode: "IT", geonameId: 3171874 };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ geonames: [geoname] })
      });
    }
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const update = 'await updateDoc(doc(db, "people", id), data);';
      assert.ok(source.includes(update), "les points de sauvegarde people passent par le hook du harnais");
      source = source.split(update).join("await window.__personPageTest.update(id, data);");
      const familyUpdate = 'await withButtonPending(submitButton, () => updateDoc(doc(db, "families", familyId), data));';
      assert.ok(source.includes(familyUpdate), "la sauvegarde des détails de relation reste testable via le harnais");
      source = source.split(familyUpdate).join('await withButtonPending(submitButton, () => window.__personPageTest.updateFamilyDetails(familyId, data));');
      const lifeEventUpdates = [
        ['await updateDoc(doc(db, "people", target.id), { [field]: next });', 'await window.__personPageTest.updateLifeEventAttestations(target.kind, next);'],
        ['await updateDoc(doc(db, "families", target.id), { marriageAttestations: next, updatedAt: serverTimestamp() });', 'await window.__personPageTest.updateLifeEventAttestations("marriage", next);']
      ];
      for (const [hookSource, hookTarget] of lifeEventUpdates) {
        assert.ok(source.includes(hookSource), `point d’écriture lot 2C-4 présent : ${hookSource}`);
        source = source.split(hookSource).join(hookTarget);
      }
      return route.fulfill({ response, body: `${source}\n${hooks}` });
    }
    return isAllowedRequest(url, server.baseURL) || url.includes("gstatic.com")
      ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  const errors = [];
  const dialogMessages = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", async dialog => {
    dialogMessages.push(await dialog.message());
    await dialog.accept();
  });
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__personPageTest === "object");
    await page.evaluate(() => window.__personPageTest.seed());
    await page.waitForFunction(() => {
      const entry = document.querySelector('#directoryList [data-directory-person="person-page-a"]');
      return Boolean(entry) && entry.getBoundingClientRect().height > 0;
    });

    await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, { timeout: 10000 });
    assert.equal((await page.locator("#personPageTitle").textContent()).trim(), "Ada Maria Rossi");
    assert.match(await page.locator("#personPageContent").innerText(), /Nom d’usage[\s\S]*Bianchi/i);
    assert.match(await page.locator("#personPageContent").innerText(), /Parents|Partenaires et unions|Enfants/);
    assert.match(await page.locator("#personPageContent").innerText(), /Acte de naissance d’Ada/);
    assert.match(await page.locator("#personPageContent").innerText(), /Établie/);
    assert.equal(await page.locator("#personPageContent pre").count(), 0, "aucun JSON technique dans la page Personne");
    const earlyFamilyCounters = await page.evaluate(() => {
      const groups = [...document.querySelectorAll("#personPageFamily .relation-group")];
      const textOf = title => groups.find(group => group.querySelector("h4")?.textContent === title)?.innerText || "";
      return { parents: textOf("Parents"), partners: textOf("Partenaires et unions"), children: textOf("Enfants") };
    });
    assert.match(earlyFamilyCounters.children, /2 attestations/, "compteur de naissance de l’enfant dans Famille");
    assert.match(earlyFamilyCounters.partners, /0 attestation/, "compteur zéro visible avant l’attestation de mariage");
    assert.doesNotMatch(earlyFamilyCounters.parents, /attestation/, "aucun compteur d’attestation dans Parents");
    const desktopJourneyPresentation = await page.evaluate(() => {
      const journey = document.getElementById("personPageDetailedJourney");
      const family = document.getElementById("personPageFamily");
      const identityLabel = document.querySelector("#personPageIdentity .person-detail-identity-grid .source-detail-fact strong");
      const journeyLabel = journey.querySelector(".life-journey-column-head .source-detail-fact strong");
      const box = getComputedStyle(journey);
      const icon = journey.querySelector(".life-journey-category-icon");
      const columnLefts = [...journey.querySelectorAll(".life-journey-column")].map(column => Math.round(column.getBoundingClientRect().left));
      const columns = [...journey.querySelectorAll(".life-journey-column")];
      return {
        columnLefts,
        columnCount: columns.length,
        borders: columns.map(column => getComputedStyle(column).borderLeftWidth),
        flexDirection: getComputedStyle(journey.querySelector(".life-journey-column-head")).flexDirection,
        headingTransform: getComputedStyle(journeyLabel).textTransform,
        headingSize: getComputedStyle(journeyLabel).fontSize,
        identityHeadingSize: getComputedStyle(identityLabel).fontSize,
        headingColor: getComputedStyle(journeyLabel).color,
        identityHeadingColor: getComputedStyle(identityLabel).color,
        iconSize: Math.round(icon.getBoundingClientRect().width),
        iconColor: getComputedStyle(icon).color,
        panel: { border: box.borderTopWidth, background: box.backgroundColor, radius: box.borderTopLeftRadius, padding: box.paddingTop },
        familyPanel: (() => { const style = getComputedStyle(family); return { border: style.borderTopWidth, background: style.backgroundColor, radius: style.borderTopLeftRadius, padding: style.paddingTop }; })(),
        iconNames: [...journey.querySelectorAll(".life-journey-category-icon use")].map(use => use.getAttribute("href"))
      };
    });
    assert.equal(desktopJourneyPresentation.columnCount, 3, "trois colonnes sur desktop");
    assert.ok(desktopJourneyPresentation.columnLefts[2] > desktopJourneyPresentation.columnLefts[1] && desktopJourneyPresentation.columnLefts[1] > desktopJourneyPresentation.columnLefts[0], "colonnes horizontales distinctes sur desktop");
    assert.deepEqual(desktopJourneyPresentation.borders, ["0px", "1px", "1px"], "séparateurs verticaux fins entre les colonnes");
    assert.equal(desktopJourneyPresentation.flexDirection, "row", "titres et CTA alignés sur la même ligne en desktop large");
    assert.equal(desktopJourneyPresentation.headingTransform, "uppercase", "libellés des catégories en capitales comme Identité");
    assert.equal(desktopJourneyPresentation.headingSize, desktopJourneyPresentation.identityHeadingSize, "taille des libellés harmonisée avec Identité");
    assert.equal(desktopJourneyPresentation.headingColor, desktopJourneyPresentation.identityHeadingColor, "couleur des libellés harmonisée avec Identité");
    assert.equal(desktopJourneyPresentation.iconSize, 18, "pictogrammes discrets de 18 px");
    assert.equal(desktopJourneyPresentation.iconColor, desktopJourneyPresentation.headingColor, "pictogrammes alignés sur la couleur des libellés");
    assert.deepEqual(desktopJourneyPresentation.panel, desktopJourneyPresentation.familyPanel, "conteneur identique à Famille en consultation desktop");
    assert.deepEqual(desktopJourneyPresentation.iconNames, ["#icon-home", "#icon-procedures", "#icon-calendar"]);

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
        nameVariantAddDisplay: getComputedStyle(document.querySelector("#personNameVariantsSection .person-name-variants-add")).display,
        nativeDateVisualWrappers: document.querySelectorAll("#personForm [data-person-date-control]").length,
        timelineHidden: timeline.hidden,
        documentCards: documentCards.length,
        documentCardTitles: documentCards.map(card => card.querySelector("h3")?.textContent.trim()),
        documentCardStyles: documentCards.map(card => ({ background: getComputedStyle(card).backgroundColor, border: getComputedStyle(card).borderTopWidth, radius: getComputedStyle(card).borderTopLeftRadius })),
        documentCardRects: documentCards.map(rect),
        documentActions: [document.getElementById("linkDocumentBtn").innerText.trim(), document.getElementById("proofEntryPointLabel").innerText.trim()],
        documentActionAria: [document.getElementById("linkDocumentBtn").getAttribute("aria-label"), document.getElementById("genealogyProposeProofForPersonBtn").getAttribute("aria-label")],
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
    assert.equal(inlineDesktop.nameVariantAddDisplay, "flex", "disposition desktop des variantes inchangée");
    assert.equal(inlineDesktop.nativeDateVisualWrappers, 0, "aucun calque Date ajouté sur desktop");
    assert.equal(inlineDesktop.timelineHidden, true, "timeline masquée pendant la modification");
    assert.equal(inlineDesktop.documentCards, 2, "Documents associés et Recherches forment deux cartes distinctes");
    assert.deepEqual(inlineDesktop.documentCardTitles, ["Documents associés", "Recherches"]);
    assert.equal(inlineDesktop.documentCardStyles[0].background, inlineDesktop.documentCardStyles[1].background, "cartes Documents/Recherches sur fond identique");
    assert.equal(inlineDesktop.documentCardStyles[0].border, inlineDesktop.documentCardStyles[1].border, "cartes Documents/Recherches avec bordures identiques");
    assert.equal(inlineDesktop.documentCardStyles[0].radius, inlineDesktop.documentCardStyles[1].radius, "cartes Documents/Recherches avec arrondis identiques");
    assert.ok(inlineDesktop.documentCardRects[1].top - inlineDesktop.documentCardRects[0].bottom >= 12, "espace vertical entre les cartes Documents et Recherches");
    assert.deepEqual(inlineDesktop.documentActions, ["Ajouter", "Ajouter"], "CTA desktop concis et contextualisés par leur section");
    assert.deepEqual(inlineDesktop.documentActionAria, ["Ajouter un document", "Ajouter une preuve"], "noms accessibles explicites conservés pour les CTA desktop");
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
    await page.evaluate(() => {
      window.__relationBuilderScrollCalls = 0;
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...args) {
        window.__relationBuilderScrollCalls++;
        window.__relationBuilderScrollBehavior = args[0]?.behavior || "auto";
        return original.apply(this, args);
      };
    });
    await page.locator("#toggleRelationBuilderBtn").click();
    await page.waitForFunction(() => !document.getElementById("relationBuilder").hidden);
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => window.__relationBuilderScrollCalls), 0, "aucun scroll automatique du lien familial sur desktop");
    await page.locator("#closeRelationBuilderBtn").click();
    await page.waitForFunction(() => document.getElementById("relationBuilder").hidden);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#toggleRelationBuilderBtn").scrollIntoViewIfNeeded();
    await page.locator("#toggleRelationBuilderBtn").click();
    await page.waitForFunction(() => !document.getElementById("relationBuilder").hidden);
    await page.waitForFunction(() => {
      const builder = document.getElementById("relationBuilder");
      const headerBottom = document.querySelector(".topbar").getBoundingClientRect().bottom;
      const top = builder.getBoundingClientRect().top;
      return top >= headerBottom + 4 && top <= headerBottom + 150;
    }, undefined, { timeout: 3000 });
    const mobileRelationScroll = await page.evaluate(() => {
      const builder = document.getElementById("relationBuilder");
      const box = builder.getBoundingClientRect();
      const header = document.querySelector(".topbar").getBoundingClientRect();
      const footer = document.querySelector("#personPageEditHost .person-actions").getBoundingClientRect();
      const select = builder.querySelector("[data-relation-add-panel=parent] select").getBoundingClientRect();
      return {
        calls: window.__relationBuilderScrollCalls,
        scrollY: window.scrollY,
        top: box.top,
        headerBottom: header.bottom,
        footerTop: footer.top,
        selectBottom: select.bottom,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert.ok(mobileRelationScroll.calls > 0, "ouverture mobile défile vers le formulaire familial");
    assert.ok(mobileRelationScroll.top >= mobileRelationScroll.headerBottom + 4 && mobileRelationScroll.top <= mobileRelationScroll.headerBottom + 150, `formulaire positionné sous l’en-tête fixe avec une marge confortable : ${JSON.stringify(mobileRelationScroll)}`);
    assert.ok(mobileRelationScroll.selectBottom < mobileRelationScroll.footerTop, "premier champ visible au-dessus du footer fixe");
    assert.ok(mobileRelationScroll.pageOverflow <= 1, "ouverture du formulaire sans débordement horizontal");
    await page.locator("#closeRelationBuilderBtn").click();
    await page.waitForFunction(() => document.getElementById("relationBuilder").hidden);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => { window.__relationBuilderScrollBehavior = ""; });
    await page.locator("#toggleRelationBuilderBtn").click();
    await page.waitForFunction(() => !document.getElementById("relationBuilder").hidden);
    await page.waitForFunction(() => window.__relationBuilderScrollBehavior === "instant");
    assert.equal(await page.evaluate(() => window.__relationBuilderScrollBehavior), "instant", "défilement immédiat si Réduire les animations est activé");
    await page.locator("#closeRelationBuilderBtn").click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1280, height: 850 });
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

    /* 2C-2 : variantes orthographiques. */
    assert.doesNotMatch(await page.locator("#personPageContent").innerText(), /Variantes orthographiques/, "aucun bloc de variantes sans donnée");

    /* Création : section disponible, annulation sans enregistrement. */
    await page.evaluate(() => window.__personPageTest.openCreatePerson());
    await page.waitForFunction(() => document.getElementById("personDialog").open);
    await page.waitForTimeout(60);
    assert.ok(await page.locator("#personNameVariantsSection").isVisible(), "section variantes présente en création");
    assert.equal(await page.locator("#personNameVariantsList li").count(), 0, "liste vide en création");
    assert.equal(await page.locator("#nameVariantKind").inputValue(), "given", "type réinitialisé sur Prénom en création");
    await page.fill("#nameVariantValue", "VarianteAnnulee");
    await page.click("#addNameVariantBtn");
    assert.equal(await page.locator("#personNameVariantsList li").count(), 1, "ajout immédiat en mémoire");
    await page.locator('#personDialog [data-close="personDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("personDialog").open);

    /* Édition : validations du formulaire. */
    await page.evaluate(() => window.__personPageTest.openEvidenceModal("identity"));
    await page.waitForFunction(() => document.getElementById("personDialog").open);
    await page.waitForTimeout(60);
    assert.equal(await page.locator("#personNameVariantsList li").count(), 0, "aucune variante préexistante");

    const currentFirstName = await page.inputValue("#firstName");
    await page.fill("#nameVariantValue", currentFirstName);
    await page.click("#addNameVariantBtn");
    assert.match(await page.locator("#nameVariantError").innerText(), /identique au prénom principal/, "variante identique au prénom refusée");
    assert.equal(await page.locator("#personNameVariantsList li").count(), 0);

    await page.fill("#nameVariantValue", "   ");
    await page.click("#addNameVariantBtn");
    assert.match(await page.locator("#nameVariantError").innerText(), /Saisissez une variante/, "valeur vide refusée");

    await page.selectOption("#nameVariantKind", "family");
    await page.fill("#nameVariantValue", "Pinaezza");
    await page.click("#addNameVariantBtn");
    assert.equal(await page.locator("#personNameVariantsList li").count(), 1, "variante de nom ajoutée");
    await page.fill("#nameVariantValue", "pinaezza");
    await page.click("#addNameVariantBtn");
    assert.match(await page.locator("#nameVariantError").innerText(), /existe déjà pour ce type/, "doublon du même type refusé");
    assert.equal(await page.locator("#personNameVariantsList li").count(), 1, "liste inchangée après doublon");

    /* Enregistrement : le bloc apparaît sur la fiche, six faits inchangés. */
    await page.click("#savePersonBtn");
    await page.waitForFunction(() => !document.getElementById("personDialog").open, undefined, { timeout: 10000 });
    await page.waitForFunction(() => document.getElementById("personPageIdentity")?.textContent.includes("Variantes orthographiques"), undefined, { timeout: 8000 });
    const identityWithVariant = await page.locator("#personPageIdentity").innerText();
    assert.match(identityWithVariant, /Pinaezza/, "variante affichée sur la fiche");
    assert.match(identityWithVariant, /prénom[\s\S]*nom de naissance[\s\S]*nom d.usage[\s\S]*branche familiale[\s\S]*variantes orthographiques/i, "les six faits précèdent le bloc de variantes");

    /* Réouverture : préchargement, puis annulation sans enregistrement. */
    await page.evaluate(() => window.__personPageTest.openEvidenceModal("identity"));
    await page.waitForFunction(() => document.getElementById("personDialog").open);
    await page.waitForTimeout(60);
    assert.equal(await page.locator("#personNameVariantsList li").count(), 1, "variante préchargée à l'édition");
    assert.match(await page.locator("#personNameVariantsList li").first().innerText(), /Pinaezza/);
    assert.equal(await page.locator("#nameVariantKind").inputValue(), "given", "type réinitialisé sur Prénom à chaque ouverture, malgré le choix Précédent");
    await page.fill("#nameVariantValue", "NonEnregistree");
    await page.click("#addNameVariantBtn");
    await page.waitForFunction(() => document.querySelectorAll("#personNameVariantsList li").length === 2, undefined, { timeout: 5000 });
    assert.equal(await page.locator("#personNameVariantsList li").count(), 2, "ajout local avant annulation");
    await page.locator('#personDialog [data-close="personDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("personDialog").open);
    await page.evaluate(() => window.__personPageTest.openEvidenceModal("identity"));
    await page.waitForFunction(() => document.getElementById("personDialog").open);
    assert.equal(await page.locator("#personNameVariantsList li").count(), 1, "annulation : seule la variante enregistrée subsiste");

    /* Suppression de la dernière variante : le bloc disparaît après enregistrement. */
    await page.locator('#personNameVariantsList [data-remove-name-variant]').click();
    assert.equal(await page.locator("#personNameVariantsList li").count(), 0, "retrait immédiat dans le formulaire");
    await page.click("#savePersonBtn");
    await page.waitForFunction(() => !document.getElementById("personDialog").open, undefined, { timeout: 10000 });
    await page.waitForFunction(() => !document.getElementById("personPageIdentity")?.textContent.includes("Variantes orthographiques"), undefined, { timeout: 8000 });
    assert.doesNotMatch(await page.locator("#personPageIdentity").innerText(), /Variantes orthographiques/, "bloc disparu après suppression enregistrée");

    /* 2C-3 : Parcours détaillé — états vides sur une personne sans données. */
    assert.ok(await page.locator("#personPageDetailedJourney").isVisible(), "section Parcours détaillé visible par défaut");
    const emptyJourney = await page.locator("#personPageDetailedJourney").innerText();
    assert.match(emptyJourney, /Aucune résidence renseignée/, "état vide résidences");
    assert.match(emptyJourney, /Aucune activité renseignée/, "état vide professions");
    assert.match(emptyJourney, /Aucun événement renseigné/, "état vide événements");
    assert.equal(await page.locator('#personPageDetailedJourney [data-journey-add], #personPageDetailedJourney [data-journey-edit], #personPageDetailedJourney [data-journey-delete], #personPageDetailedJourney [data-journey-attestation-add], #personPageDetailedJourney [data-journey-attestation-edit], #personPageDetailedJourney [data-journey-attestation-delete]').count(), 0, "aucune action Parcours détaillé en consultation");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileJourneyStyle = await page.locator("#personPageDetailedJourney .life-journey-column-head h4").first().evaluate(element => {
      const section = element.closest("#personPageDetailedJourney");
      return {
        fontSize: getComputedStyle(element.querySelector(".source-detail-fact strong")).fontSize,
        rowGap: getComputedStyle(element.closest(".life-journey-column")).rowGap,
        inlineHeight: section.style.height,
        overflowY: getComputedStyle(section).overflowY,
        flexDirection: getComputedStyle(element.closest(".life-journey-column-head")).flexDirection,
        borderLefts: [...section.querySelectorAll(".life-journey-column")].map(column => getComputedStyle(column).borderLeftWidth)
      };
    });
    assert.equal(await page.locator("#personPageDetailedJourney .life-journey-column-head h4").count(), 3, "trois catégories toujours visibles sur mobile");
    assert.equal(mobileJourneyStyle.fontSize, "11px", "libellés harmonisés avec Identité sur mobile");
    assert.equal(mobileJourneyStyle.inlineHeight, "", "aucune hauteur fixe définie sur la section");
    assert.equal(mobileJourneyStyle.overflowY, "visible", "pas de défilement interne au parcours");
    assert.equal(mobileJourneyStyle.flexDirection, "column", "titres et CTA empilés verticalement sur mobile");
    assert.deepEqual(mobileJourneyStyle.borderLefts, ["0px", "0px", "0px"], "aucun séparateur vertical sur mobile");
    assert.equal(await page.locator("#personPageDetailedJourney").evaluate(section => {
      const lefts = [...section.querySelectorAll(".life-journey-column")].map(column => Math.round(column.getBoundingClientRect().left));
      return new Set(lefts).size;
    }), 1, "une colonne sur mobile");
    await page.setViewportSize({ width: 850, height: 900 });
    assert.equal(await page.locator("#personPageDetailedJourney").evaluate(section => {
      const lefts = [...section.querySelectorAll(".life-journey-column")].map(column => Math.round(column.getBoundingClientRect().left));
      return new Set(lefts).size;
    }), 1, "le conteneur étroit passe en colonne unique au breakpoint intermédiaire");
    await page.setViewportSize({ width: 1280, height: 900 });

    /* Le parcours reste au même emplacement et devient éditable inline avec la fiche. */
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    assert.equal(await page.locator("#personPageDetailedJourney").evaluate(section => section.parentElement.id), "personForm", "Parcours détaillé intégré à la fiche en modification");
    assert.equal(await page.locator('#personPageDetailedJourney [data-journey-add]').count(), 3, "ajout des trois catégories disponible en modification");
    const desktopJourneyButtons = await page.locator("#personPageDetailedJourney .life-journey-column-head > .btn").evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        label: button.innerText.trim(),
        icon: button.querySelector(".ui-icon use")?.getAttribute("href"),
        height: Math.round(box.height),
        color: style.color,
        background: style.backgroundColor,
        border: style.borderTopColor,
        radius: style.borderTopLeftRadius,
        fontSize: style.fontSize,
        padding: style.paddingLeft
      };
    }));
    assert.deepEqual(desktopJourneyButtons.map(button => button.label), ["Ajouter", "Ajouter", "Ajouter"], "libellés CTA harmonisés sur les trois catégories");
    assert.ok(desktopJourneyButtons.every(button => button.icon === "#icon-plus" && button.height >= 44), "CTA standards, icône + distincte du texte et cibles ≥ 44 px");
    assert.ok(desktopJourneyButtons.every(button => button.color === "rgb(40, 75, 63)"), "texte et icône vert foncé sur tous les CTA");
    assert.equal(await page.locator("#personPageDetailedJourney").evaluate(section => [...section.querySelectorAll(".life-journey-column")].every(column => {
      const head = column.querySelector(".life-journey-column-head");
      const title = head.querySelector("h4").getBoundingClientRect();
      const button = head.querySelector(":scope > .btn").getBoundingClientRect();
      return title.right <= button.left + 1 || title.bottom <= button.top + 1;
    })), true, "aucune collision entre titre et CTA en desktop");
    const referenceJourneyCta = await page.locator("#linkDocumentBtn").evaluate(button => {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return { height: Math.round(box.height), color: style.color, background: style.backgroundColor, border: style.borderTopColor, radius: style.borderTopLeftRadius, fontSize: style.fontSize, padding: style.paddingLeft };
    });
    for (const button of desktopJourneyButtons) {
      assert.equal(button.height, referenceJourneyCta.height, "hauteur identique à « Ajouter un document »");
      assert.equal(button.background, referenceJourneyCta.background, "fond identique au CTA de référence");
      assert.equal(button.border, referenceJourneyCta.border, "bordure identique au CTA de référence");
      assert.equal(button.radius, referenceJourneyCta.radius, "rayon identique au CTA de référence");
      assert.equal(button.fontSize, referenceJourneyCta.fontSize, "police identique au CTA de référence");
      assert.equal(button.padding, referenceJourneyCta.padding, "padding identique au CTA de référence");
    }
    assert.equal(desktopJourneyButtons[0].color, referenceJourneyCta.color, "texte vert foncé identique au CTA de référence");
    assert.deepEqual(await page.locator("#personPageDetailedJourney").evaluate(section => {
      const style = getComputedStyle(section);
      return { border: style.borderTopWidth, background: style.backgroundColor, radius: style.borderTopLeftRadius, padding: style.paddingTop };
    }), desktopJourneyPresentation.panel, "conteneur inchangé en mode modification desktop");
    const editOrder = await page.locator("#personForm").evaluate(form => [...form.children].map(element => element.id));
    assert.ok(editOrder.indexOf("personIdentityPanel") < editOrder.indexOf("personPageDetailedJourney") && editOrder.indexOf("personPageDetailedJourney") < editOrder.indexOf("personRelationsPanel"), "Parcours détaillé reste entre Identité et Famille en modification");
    await page.locator('#personPageDetailedJourney [data-journey-add="profession"]').click();
    await page.locator('#personPageDetailedJourney [data-journey-add="event"]').click();
    assert.equal(await page.locator("#personPageDetailedJourney [data-journey-form]").count(), 1, "un seul formulaire du parcours ouvert à la fois");
    assert.equal(await page.locator('#personPageDetailedJourney [data-journey-save="event"]').count(), 1, "le formulaire actif correspond à la dernière catégorie choisie");
    await page.locator("#personPageDetailedJourney [data-journey-cancel]").click();

    /* Ajout d'une résidence : autocomplétion clavier, erreur inline sans perte, puis enregistrement. */
    await page.locator('#personPageDetailedJourney [data-journey-add="residence"]').click();
    await page.locator('[data-journey-save="residence"]').click();
    assert.match(await page.locator("#journeyError-place").innerText(), /commune ou le lieu/, "erreur de validation inline");
    assert.ok(await page.locator("#personPageDetailedJourney [data-journey-form]").isVisible(), "formulaire conservé après erreur");
    await page.fill("#journeyPlace", "Ori");
    await page.waitForSelector(".location-suggestion:visible");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await page.inputValue("#journeyRegion"), "Varese, Lombardia", "région GeoNames renseignée après sélection clavier");
    assert.equal(await page.inputValue("#journeyCountry"), "Italie", "pays GeoNames renseigné après sélection clavier");
    await page.locator('[data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1892");
    await page.evaluate(() => window.__personPageTest.rerenderJourney());
    assert.equal(await page.inputValue("#journeyRegion"), "Varese, Lombardia", "région préservée après re-render");
    assert.equal(await page.inputValue("#journeyCountry"), "Italie", "pays préservé après re-render");
    assert.equal(await page.inputValue("#journeyDateYear"), "1892", "date préservée après re-render");
    await page.locator('[data-journey-save="residence"]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    let journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.residences.length, 1, "résidence enregistrée dans le document people");
    assert.equal(journey.residences[0].place, "Orino");
    assert.equal(journey.residences[0].region, "Varese, Lombardia");
    assert.equal(journey.residences[0].country, "Italie");
    assert.deepEqual(journey.residences[0].dateInfo, { type: "year", year: 1892 }, "année seule conservée sans conversion");
    assert.equal(journey.residences[0].attestations.length, 0, "résidence valide sans attestation");
    assert.match(await page.locator("#personPageDetailedJourney").innerText(), /Orino/);
    const zeroResidenceSummary = page.locator('#personPageDetailedJourney [data-journey-kind="residence"] > summary');
    assert.match(await zeroResidenceSummary.innerText(), /0 attestation/, "compteur discret visible en modification");
    assert.doesNotMatch(await zeroResidenceSummary.innerText(), /résidence|profession|naissance/i, "compteur sans précision du type d’attestation");
    assert.equal(await zeroResidenceSummary.locator(".life-entry-attestation-count .ui-icon use").getAttribute("href"), "#icon-document", "icône document devant le compteur détaillé");

    /* Espace titre/séparateur : ajouté uniquement sur les cartes fermées. */
    const residenceFooter = page.locator("#personPageDetailedJourney .life-entry-card").first().locator(":scope > .life-entry-actions");
    assert.equal(await residenceFooter.evaluate(footer => getComputedStyle(footer).marginTop), "0px", "carte dépliée : espacement du séparateur inchangé");
    await page.locator('#personPageDetailedJourney [data-journey-kind="residence"] > summary').click();
    assert.equal(await residenceFooter.evaluate(footer => getComputedStyle(footer).marginTop), "12px", "carte fermée : espace titre/séparateur porté à 12 px");
    const desktopFooterLayout = await residenceFooter.evaluate(footer => {
      const box = footer.getBoundingClientRect();
      const add = footer.querySelector(".life-attestation-add").getBoundingClientRect();
      const trash = footer.querySelector(".life-delete-icon").getBoundingClientRect();
      return { height: Math.round(box.height), addRightGap: Math.round(box.right - add.right), trashWidth: Math.round(trash.width), footerLast: footer === footer.parentElement.lastElementChild };
    });
    assert.ok(desktopFooterLayout.height <= 60, "desktop : Modifier, poubelle et Ajouter une attestation sur une seule ligne");
    assert.ok(desktopFooterLayout.addRightGap <= 2, "desktop : Ajouter une attestation aligné à droite dans la carte");
    assert.ok(desktopFooterLayout.trashWidth >= 42, "desktop : poubelle sans compression");
    assert.equal(desktopFooterLayout.footerLast, true, "pied d’actions en dernier, à l’intérieur de la bordure");
    await page.locator('#personPageDetailedJourney [data-journey-kind="residence"] > summary').click();
    assert.equal(await residenceFooter.evaluate(footer => getComputedStyle(footer).marginTop), "0px", "carte rouverte : espacement d’origine restauré");


    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#personPageEditHost [data-close="personDialog"]').click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    const emptyResidenceAttestations = page.locator('#personPageDetailedJourney [data-journey-kind="residence"]');
    assert.match(await emptyResidenceAttestations.innerText(), /0 attestation/, "compteur 0 attestation visible en consultation");
    assert.equal(await emptyResidenceAttestations.locator(".life-entry-attestation-count .ui-icon use").getAttribute("href"), "#icon-document", "icône document devant le compteur en consultation");
    assert.equal(await emptyResidenceAttestations.locator(".life-attestation").count(), 0, "aucune attestation vide affichée en consultation");
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);

    /* Attestations : date obligatoire, justificatif source, nombre affiché. */
    const addAttestation = page.locator('#personPageDetailedJourney [data-journey-attestation-add]');
    assert.equal(await addAttestation.innerText(), "Ajouter une attestation", "le CTA conserve le terme attestation");
    assert.ok(await addAttestation.evaluate(button => button.classList.contains("tertiary") && button.classList.contains("small")), "CTA d’attestation compact et secondaire");
    assert.equal(await addAttestation.locator(".ui-icon use").getAttribute("href"), "#icon-plus", "icône + présente sur le CTA d’attestation");
    assert.equal(await addAttestation.evaluate(button => getComputedStyle(button).color), "rgb(40, 75, 63)", "icône et libellé d’attestation verts");
    const mobileAttestationButtonStyle = await addAttestation.evaluate(button => {
      const style = getComputedStyle(button);
      return { borderStyle: style.borderTopStyle, borderColor: style.borderTopColor, background: style.backgroundColor, width: Math.round(button.getBoundingClientRect().width), parentWidth: Math.round(button.parentElement.getBoundingClientRect().width) };
    });
    assert.equal(mobileAttestationButtonStyle.borderStyle, "solid", "bordure visible sur le bouton d’attestation mobile");
    assert.notEqual(mobileAttestationButtonStyle.borderColor, "rgba(0, 0, 0, 0)", "bordure non transparente sur mobile");
    assert.notEqual(mobileAttestationButtonStyle.background, "rgba(0, 0, 0, 0)", "fond clair visible sur mobile");
    assert.ok(mobileAttestationButtonStyle.width < mobileAttestationButtonStyle.parentWidth, "CTA d’attestation compact, non pleine largeur sur mobile");
    await addAttestation.click();
    const justificationGroups = page.locator("[data-journey-form] .life-journey-justification-group");
    assert.deepEqual(await justificationGroups.locator(":scope > strong").allTextContents(), ["Documents associés", "Sources", "Preuves"], "sélecteurs séparés par type d'élément");
    assert.equal(await page.locator("[data-journey-document-check]").count(), 4, "documents rattachés à la personne proposés");
    assert.equal(await page.locator('[data-journey-document-check="person-page-unlinked"]').count(), 0, "document non associé exclu du sélecteur");
    assert.equal(await page.locator("[data-journey-source-check]").count(), 1, "sources officielles liées à la personne proposées");
    assert.equal(await page.locator("[data-journey-proof-check]").count(), 1, "preuves liées à la personne proposées");
    const mobileAttestationDates = await page.locator("#personPageDetailedJourney [data-journey-date]").evaluate(container => {
      const buttons = [...container.querySelectorAll("[data-journey-date-type]")];
      const switcher = container.querySelector(".date-type-switch");
      return {
        types: buttons.map(button => button.dataset.journeyDateType),
        visibleLabels: buttons.map(button => getComputedStyle(button, "::after").content.replace(/^[\"']|[\"']$/g, "")),
        heights: buttons.map(button => Math.round(button.getBoundingClientRect().height)),
        active: buttons.filter(button => button.classList.contains("active")).map(button => button.dataset.journeyDateType),
        overflowX: getComputedStyle(switcher).overflowX,
        scrollsInside: switcher.scrollWidth > switcher.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert.deepEqual(mobileAttestationDates.types, ["exact", "year", "about", "between", "unknown"]);
    assert.deepEqual(mobileAttestationDates.visibleLabels, ["Date précise", "Année", "Vers", "Entre", "Inconnue"], "cinq libellés visibles dans le sélecteur mobile");
    assert.deepEqual(mobileAttestationDates.active, ["exact"], "type sélectionné identifiable visuellement");
    assert.ok(mobileAttestationDates.heights.every(height => height >= 44), "cibles tactiles des cinq formats ≥ 44 px");
    assert.equal(mobileAttestationDates.overflowX, "auto", "défilement horizontal limité au sélecteur");
    assert.ok(mobileAttestationDates.scrollsInside, "le sélecteur peut défiler sans élargir la page");
    assert.ok(mobileAttestationDates.pageOverflow <= 1, "sélecteur mobile sans débordement horizontal de page");
    await page.setViewportSize({ width: 850, height: 850 });
    const narrowDesktopDates = await page.locator("#personPageDetailedJourney [data-journey-date]").evaluate(container => ({
      labels: [...container.querySelectorAll("[data-journey-date-type]")].map(button => button.innerText.trim()),
      widths: [...container.querySelectorAll("[data-journey-date-type]")].map(button => Math.round(button.getBoundingClientRect().width)),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    assert.deepEqual(narrowDesktopDates.labels, ["Date précise", "Année", "Vers", "Entre", "Inconnue"], "les cinq formats visibles dans une colonne desktop étroite");
    assert.ok(narrowDesktopDates.widths.every(width => width > 0), "les cinq contrôles restent affichés");
    assert.ok(narrowDesktopDates.pageOverflow <= 1, "formulaire desktop étroit sans débordement horizontal");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-journey-attestation-save]').click();
    assert.match(await page.locator("#journeyError-attDate").innerText(), /date de l'attestation/, "attestation sans date refusée");
    await page.locator('[data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1895");
    await page.locator('[data-journey-document-check="person-page-document"]').check();
    await page.locator('[data-journey-document-check="person-page-pdf"]').check();
    await page.locator('[data-journey-source-check="person-page-source"]').check();
    await page.locator('[data-journey-proof-check="person-page-proof"]').check();
    await page.locator('[data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.residences[0].attestations.length, 1, "attestation enregistrée");
    assert.deepEqual(journey.residences[0].attestations[0].documentIds, ["person-page-document", "person-page-pdf"], "sélection de plusieurs documents enregistrée sans fusionner leurs références");
    assert.deepEqual(journey.residences[0].attestations[0].sourceIds, ["person-page-source"], "association source conservée");
    assert.match(await page.locator("#personPageDetailedJourney").innerText(), /1 attestation/);
    assert.equal(await page.locator('#personPageDetailedJourney [data-journey-kind="residence"] [data-view-document]').count(), 2, "les documents associés sont consultables depuis l'attestation");
    await page.setViewportSize({ width: 850, height: 850 });
    const desktopAttestationButtonStyle = await page.locator(".life-attestation-add").first().evaluate(button => {
      const style = getComputedStyle(button);
      return { borderStyle: style.borderTopStyle, borderColor: style.borderTopColor, background: style.backgroundColor };
    });
    assert.equal(desktopAttestationButtonStyle.borderStyle, "solid", "bordure visible sur le bouton d’attestation desktop");
    assert.notEqual(desktopAttestationButtonStyle.borderColor, "rgba(0, 0, 0, 0)", "bordure non transparente sur desktop");
    assert.notEqual(desktopAttestationButtonStyle.background, "rgba(0, 0, 0, 0)", "fond clair visible sur desktop");
    await page.setViewportSize({ width: 390, height: 844 });

    /* Réouverture : les trois catégories et sélections sont restaurées ; retirer un lien ne supprime pas le document. */
    await page.locator('[data-journey-attestation-edit^="residence:"]').first().click();
    assert.equal(await page.locator('[data-journey-document-check="person-page-document"]').isChecked(), true, "document préchargé après réouverture");
    assert.equal(await page.locator('[data-journey-document-check="person-page-pdf"]').isChecked(), true, "second document préchargé après réouverture");
    assert.equal(await page.locator('[data-journey-source-check="person-page-source"]').isChecked(), true, "source préchargée après réouverture");
    assert.equal(await page.locator('[data-journey-proof-check="person-page-proof"]').isChecked(), true, "preuve préchargée après réouverture");
    await page.locator('[data-journey-document-check="person-page-pdf"]').uncheck();
    await page.locator('[data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.deepEqual(journey.residences[0].attestations[0].documentIds, ["person-page-document"], "désassociation de document répercutée uniquement sur l'attestation");
    assert.equal(await page.evaluate(() => window.__personPageTest.documentExists("person-page-pdf")), true, "le document source reste présent après désassociation");

    /* Seconde attestation datée distincte : jamais bloquée. */
    await page.locator('#personPageDetailedJourney [data-journey-attestation-add]').click();
    await page.locator('[data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1901");
    await page.locator('[data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.residences[0].attestations.length, 2, "deux attestations distinctes coexistent");
    assert.match(await page.locator("#personPageDetailedJourney").innerText(), /2 attestations/);

    await page.locator('[data-journey-edit^="residence:"]').click();
    await page.fill("#journeyAddress", "Brouillon à abandonner");
    const journeyExitIndex = dialogMessages.length;
    await page.locator('#personPageEditHost [data-close="personDialog"]').click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    assert.match(dialogMessages[journeyExitIndex] || "", /modifications ne sont pas enregistrées/, "sortie du mode modification confirme l’abandon du formulaire détaillé");
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.residences[0].address || "", "", "la saisie détaillée non enregistrée n’est pas sauvegardée implicitement");
    assert.equal(await page.locator('#personPageDetailedJourney [data-journey-add], #personPageDetailedJourney [data-journey-edit], #personPageDetailedJourney [data-journey-delete], #personPageDetailedJourney [data-journey-attestation-add], #personPageDetailedJourney [data-journey-attestation-edit], #personPageDetailedJourney [data-journey-attestation-delete]').count(), 0, "actions et attestations en lecture seule masquées");
    assert.equal(await page.locator('#personPageDetailedJourney [data-journey-open-source="person-page-source"]').count(), 1, "source consultable en mode lecture seule");
    assert.equal(await page.locator('#personPageDetailedJourney [data-view-proof="person-page-proof"]').count(), 1, "preuve consultable en mode lecture seule");
    const titleColors = await page.evaluate(() => {
      const title = document.querySelector("#personPageDetailedJourney .life-entry-title");
      const reference = document.querySelector("#personPageFamily .person-detail-relative-link");
      return {
        titleCount: document.querySelectorAll("#personPageDetailedJourney .life-entry-title").length,
        titleColor: title ? getComputedStyle(title).color : "absent",
        referenceColor: reference ? getComputedStyle(reference).color : "absent"
      };
    });
    assert.ok(titleColors.titleCount > 0, "cartes Événements de vie présentes en consultation");
    assert.equal(titleColors.titleColor, "rgb(40, 75, 63)", "titre des cartes en couleur de marque");
    assert.equal(titleColors.titleColor, titleColors.referenceColor, "titre aligné sur la couleur des noms Parents");
    const consultedAttestations = page.locator('#personPageDetailedJourney [data-journey-kind="residence"]');
    assert.equal(await consultedAttestations.locator(".life-attestation").count(), 2, "attestations existantes toujours consultables");
    assert.match(await consultedAttestations.innerText(), /2 attestations/, "compteur visible en consultation");

    /* Consultation du justificatif : fiche Source existante puis retour. */
    await page.locator('[data-journey-open-source="person-page-source"]').click();
    await page.waitForFunction(() => !document.getElementById("sourceDetailView").hidden, undefined, { timeout: 10000 });
    assert.match(await page.locator("#sourcePageTitle").textContent(), /Cadastre/, "fiche source ouverte depuis le parcours");
    await page.locator("#sourceMobileBackBtn").click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, undefined, { timeout: 10000 });

    /* Profession et événement ponctuel indépendants. */
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => document.querySelectorAll("#personForm [data-person-date-control]").length === 2);
      for (const kind of ["birth", "death"]) {
        for (const dateType of ["exact", "year", "about", "between", "unknown"]) {
          await page.locator(`#personForm [data-date-prefix="${kind}"][data-date-type="${dateType}"]`).evaluate(button => button.click());
          const layout = await page.locator(`#personForm [data-date-control="${kind}"]`).evaluate(control => {
            const group = control.parentElement;
            const groupBox = group.getBoundingClientRect();
            const style = getComputedStyle(group);
            const insetLeft = Number.parseFloat(style.paddingLeft) || 0;
            const insetRight = Number.parseFloat(style.paddingRight) || 0;
            const elements = [
              ...group.querySelectorAll(".date-type-switch, .date-value-panel:not([hidden]), .life-place, .major-event-attestation-control")
            ].filter(element => element.getBoundingClientRect().height > 0);
            const fields = [...group.querySelectorAll(".date-value-panel:not([hidden]) .field, .life-place .field")]
              .filter(field => field.getBoundingClientRect().height > 0);
            const placeBox = group.querySelector(".life-place .field").getBoundingClientRect();
            const placeStyle = getComputedStyle(group.querySelector(".life-place .field"));
            const fieldMetrics = field => {
              const visualControl = field.closest("[data-person-date-control]");
              const frame = visualControl || field;
              const visual = visualControl?.querySelector("[data-person-date-visual]") || field;
              const box = frame.getBoundingClientRect();
              const frameStyle = getComputedStyle(frame);
              const fieldStyle = getComputedStyle(visual);
              return {
                left: box.left, right: box.right, width: box.width, height: box.height,
                type: field.getAttribute("type"), textAlign: fieldStyle.textAlign,
                lineHeight: fieldStyle.lineHeight, paddingLeft: fieldStyle.paddingLeft,
                paddingRight: fieldStyle.paddingRight, paddingTop: fieldStyle.paddingTop,
                paddingBottom: fieldStyle.paddingBottom, borderRadius: frameStyle.borderTopLeftRadius,
                borderWidth: frameStyle.borderTopWidth,
                valueText: visualControl ? visual.textContent : field.value
              };
            };
            return {
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              groupLeft: groupBox.left + insetLeft,
              groupRight: groupBox.right - insetRight,
              elements: elements.map(element => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right }; }),
              fields: fields.map(fieldMetrics),
              place: { ...fieldMetrics(group.querySelector(".life-place .field")), left: placeBox.left, right: placeBox.right, textAlign: placeStyle.textAlign }
            };
          });
          assert.ok(layout.overflow <= 1, `${width}px : ${kind}/${dateType} sans débordement horizontal`);
          assert.ok(layout.elements.every(element => element.left >= layout.groupLeft - 1 && element.right <= layout.groupRight + 1), `${width}px : ${kind}/${dateType} contenus dans la carte`);
          assert.ok(layout.fields.every(field => field.width > 0 && field.left >= layout.groupLeft - 1 && field.right <= layout.groupRight + 1), `${width}px : champs ${kind}/${dateType} entièrement accessibles`);
          const dateFields = layout.fields.filter(field => field.type);
          assert.ok(dateFields.every(field => Math.abs(field.left - layout.place.left) <= 1 && Math.abs(field.right - layout.place.right) <= 1), `${width}px : ${kind}/${dateType} partage les limites horizontales du champ Lieu`);
          assert.ok(dateFields.every(field => Math.abs(field.height - layout.place.height) <= 1), `${width}px : ${kind}/${dateType} à la hauteur du champ Lieu`);
          assert.ok(dateFields.every(field => field.paddingLeft === layout.place.paddingLeft && field.paddingRight === layout.place.paddingRight && field.paddingTop === layout.place.paddingTop && field.paddingBottom === layout.place.paddingBottom), `${width}px : ${kind}/${dateType} reprend le retrait du champ Lieu`);
          assert.ok(dateFields.every(field => field.lineHeight === layout.place.lineHeight && field.borderRadius === layout.place.borderRadius && field.borderWidth === layout.place.borderWidth), `${width}px : ${kind}/${dateType} garde le centrage vertical et le style du champ Lieu`);
          assert.ok(dateFields.every(field => ["left", "start"].includes(field.textAlign)), `${width}px : ${kind}/${dateType} aligné à gauche`);
        }
      }
      await page.locator('#personForm [data-date-prefix="birth"][data-date-type="year"]').evaluate(button => button.click());
      await page.locator('#personForm [data-date-prefix="death"][data-date-type="year"]').evaluate(button => button.click());
      const variants = await page.evaluate(() => {
        const container = document.querySelector("#personNameVariantsSection .person-name-variants-add");
        const kind = document.getElementById("nameVariantKind").getBoundingClientRect();
        const value = document.getElementById("nameVariantValue").getBoundingClientRect();
        const button = document.getElementById("addNameVariantBtn").getBoundingClientRect();
        const box = container.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          kind, value, button, box,
          stacked: value.top >= kind.bottom - 1,
          buttonCentered: Math.abs((button.left + button.right) / 2 - (box.left + box.right) / 2) <= 2,
          buttonBelow: button.top >= Math.max(kind.bottom, value.bottom) - 1
        };
      });
      assert.ok(variants.overflow <= 1, `${width}px : variantes sans débordement horizontal`);
      assert.ok(variants.kind.width > 0 && variants.value.width > 0, `${width}px : les deux champs restent accessibles`);
      assert.equal(variants.stacked, true, `${width}px : variantes empilées verticalement`);
      assert.ok(variants.buttonCentered && variants.buttonBelow, `${width}px : bouton Ajouter centré sous les champs`);
      const majorCtas = await page.evaluate(() => ["birth", "death"].map(kind => {
        const group = document.getElementById(`${kind}AttestationControl`).parentElement.getBoundingClientRect();
        const control = document.getElementById(`${kind}AttestationControl`).getBoundingClientRect();
        const button = document.querySelector(`#${kind}AttestationControl .life-attestation-add`).getBoundingClientRect();
        return { centerDiff: Math.abs((control.left + control.right) / 2 - (group.left + group.right) / 2), buttonVisible: button.width > 0 && button.height > 0 };
      }));
      assert.ok(majorCtas.every(item => item.buttonVisible && item.centerDiff <= 2), `${width}px : CTA d’attestation Naissance/Décès centrés`);
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.waitForFunction(() => document.querySelectorAll("#personForm [data-person-date-control]").length === 0);
    assert.equal(await page.locator("#personNameVariantsSection .person-name-variants-add").evaluate(element => getComputedStyle(element).display), "flex", "retour à la disposition desktop d’origine");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#personPageDetailedJourney [data-journey-add="profession"]').click();
    await page.fill("#journeyLabel", "Agriculteur");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    const mobileJourneyButtons = await page.locator("#personPageDetailedJourney .life-journey-column-head > .btn").evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const title = button.closest(".life-journey-column-head").querySelector("h4").getBoundingClientRect();
      return {
        label: button.innerText.trim(),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        right: Math.round(box.right),
        titleTop: Math.round(title.top),
        titleBottom: Math.round(title.bottom),
        headRightGap: Math.round(button.closest(".life-journey-column-head").getBoundingClientRect().right - box.right),
        height: Math.round(box.height),
        color: style.color,
        background: style.backgroundColor,
        border: style.borderTopColor,
        radius: style.borderTopLeftRadius,
        fontSize: style.fontSize,
        padding: style.paddingLeft
      };
    }));
    assert.deepEqual(mobileJourneyButtons.map(button => button.label), ["Ajouter", "Ajouter", "Ajouter"], "libellés mobiles harmonisés");
    assert.ok(mobileJourneyButtons.every(button => button.top < button.titleBottom && button.bottom > button.titleTop && button.right <= 390), "CTA alignés sur la ligne du titre, sans débordement horizontal");
    assert.ok(mobileJourneyButtons.every(button => button.headRightGap <= 2), "les trois CTA principaux sont à droite du titre sur mobile");
    assert.ok(mobileJourneyButtons.every(button => button.color === "rgb(40, 75, 63)"), "texte vert foncé sur les CTA mobiles");
    const referenceMobileCta = await page.locator("#linkDocumentBtn").evaluate(button => {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return { height: Math.round(box.height), background: style.backgroundColor, border: style.borderTopColor, radius: style.borderTopLeftRadius, fontSize: style.fontSize, padding: style.paddingLeft };
    });
    for (const button of mobileJourneyButtons) {
      assert.equal(button.height, referenceMobileCta.height, "hauteur mobile identique à « Ajouter un document »");
      assert.equal(button.background, referenceMobileCta.background, "fond mobile identique au CTA de référence");
      assert.equal(button.border, referenceMobileCta.border, "bordure mobile identique au CTA de référence");
      assert.equal(button.radius, referenceMobileCta.radius, "rayon mobile identique au CTA de référence");
      assert.equal(button.fontSize, referenceMobileCta.fontSize, "police mobile identique au CTA de référence");
      assert.equal(button.padding, referenceMobileCta.padding, "padding mobile identique au CTA de référence");
    }
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1, "édition mobile sans débordement horizontal");

    /* Largeurs mobiles représentatives : CTA dans l'en-tête et aucun débordement. */
    for (const narrowWidth of [375, 320]) {
      await page.setViewportSize({ width: narrowWidth, height: 844 });
      await page.waitForTimeout(120);
      const narrow = await page.evaluate(() => {
        const footer = document.querySelector("#personPageDetailedJourney .life-entry-card .life-entry-actions");
        const box = footer.getBoundingClientRect();
        const add = footer.querySelector(".life-attestation-add");
        const addBox = add.getBoundingClientRect();
        const trashBox = footer.querySelector(".life-delete-icon").getBoundingClientRect();
        const head = document.querySelector("#personPageDetailedJourney .life-journey-column-head");
        const headBox = head.getBoundingClientRect();
        const headBtn = head.querySelector(":scope > .btn").getBoundingClientRect();
        const headTitle = head.querySelector("h4").getBoundingClientRect();
        const headers = [...document.querySelectorAll("#personPageDetailedJourney .life-journey-column-head")].map(item => {
          const title = item.querySelector("h4").getBoundingClientRect();
          const button = item.querySelector(":scope > .btn").getBoundingClientRect();
          const bounds = item.getBoundingClientRect();
          return { sameLine: button.top < title.bottom && button.bottom > title.top, rightGap: Math.round(bounds.right - button.right) };
        });
        return {
          footerHeight: Math.round(box.height),
          addRightGap: Math.round(box.right - addBox.right),
          addUnclipped: add.scrollWidth <= add.clientWidth + 1 && add.scrollHeight <= add.clientHeight + 1,
          trashWidth: Math.round(trashBox.width),
          headRightGap: Math.round(headBox.right - headBtn.right),
          headSameLine: headBtn.top < headTitle.bottom && headBtn.bottom > headTitle.top,
          headers,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      assert.ok(narrow.footerHeight <= 60, `${narrowWidth} px : les trois actions tiennent sur une seule ligne`);
      assert.ok(narrow.addRightGap <= 2, `${narrowWidth} px : Ajouter une attestation aligné à droite`);
      assert.equal(narrow.addUnclipped, true, `${narrowWidth} px : libellé entier, sans troncature ni rognage`);
      assert.ok(narrow.trashWidth >= 44, `${narrowWidth} px : poubelle conservée à 44 px`);
      assert.ok(narrow.headSameLine && narrow.headRightGap <= 2, `${narrowWidth} px : CTA de catégorie sur la ligne du sous-titre, à droite`);
      assert.ok(narrow.headers.length === 3 && narrow.headers.every(header => header.sameLine && header.rightGap <= 2), `${narrowWidth} px : les trois catégories gardent leur CTA lisible sur la même ligne`);
      assert.ok(narrow.pageOverflow <= 1, `${narrowWidth} px : aucun débordement horizontal`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(120);
    await page.fill("#journeyPlace", "Mon");
    await page.waitForSelector(".location-suggestion:visible");
    await page.locator(".location-suggestion:visible").first().evaluate(option => {
      option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1 }));
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    assert.equal(await page.inputValue("#journeyCountry"), "Italie", "pays GeoNames renseigné par sélection tactile");
    await page.locator('[data-journey-date-type="about"]').click();
    await page.fill("#journeyDateAbout", "1895");
    await page.locator('[data-journey-save="profession"]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    await page.locator('#personPageDetailedJourney [data-journey-add="event"]').click();
    await page.selectOption("#journeyEventKind", "census");
    assert.equal(await page.locator("#journeyLabel").evaluate(input => input.closest("label").innerText.trim()), "Intitulé", "intitulé facultatif sans astérisque");
    await page.fill("#journeyLabel", "Recensement de Biella");
    await page.fill("#journeyPlace", "Lieu historique sans suggestion");
    await page.locator('[data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1901");
    await page.locator('[data-journey-save="event"]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.professions.length, 1, "profession enregistrée");
    assert.equal(journey.professions[0].label, "Agriculteur");
    assert.equal(journey.professions[0].region, "Varese, Lombardia", "région associée à la profession");
    assert.equal(journey.professions[0].country, "Italie", "pays associé à la profession");
    assert.equal(journey.lifeEvents.length, 1, "événement enregistré");
    assert.equal(journey.lifeEvents[0].kind, "census");
    assert.equal(journey.lifeEvents[0].place, "Lieu historique sans suggestion", "saisie libre conservée sans suggestion géographique");
    assert.match(await page.locator("#personPageDetailedJourney").innerText(), /Agriculteur/);
    assert.match(await page.locator("#personPageDetailedJourney").innerText(), /Recensement de Biella/);
    const eventCard = page.locator('#personPageDetailedJourney [data-journey-entry-kind="event"]');
    const eventRow = page.locator('#personPageDetailedJourney [data-journey-kind="event"]');
    assert.match(await eventRow.locator(".life-entry-summary").innerText(), /Recensement · Recensement de Biella · 1901/, "intitulé distinct restitué après le type");
    assert.doesNotMatch(await eventRow.locator(".life-entry-summary").innerText(), /Lieu historique sans suggestion/, "lieu absent du résumé fermé de l’événement");
    assert.equal(await eventRow.locator(".life-entry-chevron").count(), 1, "lieu seul suffisant pour afficher un chevron de dépliage");
    assert.match(await eventRow.locator(".life-entry-body").innerText(), /Lieu\s+Lieu historique sans suggestion/i, "lieu visible dans le panneau événement ouvert");
    await eventRow.locator("summary").click();
    assert.equal(await eventRow.evaluate(details => details.open), false, "panneau événement replié au clic");
    assert.equal(await eventCard.locator('[data-journey-attestation-add]').count(), 1, "pied d’actions disponible événement replié");
    await eventCard.locator('[data-journey-edit^="event:"]').click();
    await page.fill("#journeyPlace", "Var");
    await page.waitForSelector(".location-suggestion:visible");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await page.inputValue("#journeyRegion"), "Province de Varese, Lombardie", "régions GeoNames disponibles dans le formulaire événement");
    assert.equal(await page.inputValue("#journeyCountry"), "Italie", "pays GeoNames conservé dans les données événement");
    await page.locator('[data-journey-save="event"]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.lifeEvents[0].place, "Varese");
    assert.equal(journey.lifeEvents[0].countryCode, "ITA", "code ISO alpha-3 stocké à la suite d'une sélection GeoNames fiable");
    assert.equal(journey.lifeEvents[0].region, "Province de Varese, Lombardie", "région source conservée sans modification");
    assert.match(await eventRow.locator(".life-entry-body").innerText(), /Lieu\s+Varese, Lombardie \(ITA\)/i, "lieu compact visible dans les détails ouverts");
    assert.doesNotMatch(await eventRow.locator(".life-entry-summary").innerText(), /Varese/, "lieu masqué dans l’en-tête même lorsque les détails sont ouverts");
    const mobileCardFooters = await page.locator("#personPageDetailedJourney .life-entry-card").evaluateAll(cards => cards.map(card => {
      const footer = card.querySelector(":scope > .life-entry-actions");
      const expandable = card.querySelector(":scope > details.life-entry");
      const add = footer?.querySelector(".life-attestation-add");
      const footerBox = footer?.getBoundingClientRect();
      const addBox = add?.getBoundingClientRect();
      return {
        footerInside: Boolean(footer && footer.parentElement === card),
        footerLast: Boolean(footer && card.lastElementChild === footer),
        actionOrder: footer ? [...footer.children].map(button => button.hasAttribute("data-journey-attestation-add") ? "attestation" : button.hasAttribute("data-journey-delete") ? "delete" : button.hasAttribute("data-journey-edit") ? "edit" : "other") : [],
        footerHeight: footerBox ? Math.round(footerBox.height) : 0,
        addRightGap: footerBox && addBox ? Math.round(footerBox.right - addBox.right) : 999,
        expandable: Boolean(expandable)
      };
    }));
    assert.ok(mobileCardFooters.length >= 3 && mobileCardFooters.every(card => card.footerInside && card.footerLast), "les trois catégories ont un pied d’actions en dernier dans la bordure de carte");
    assert.ok(mobileCardFooters.every(card => !card.footer || card.actionOrder.join(",") === "edit,delete,attestation"), "ordre commun des actions dans les trois catégories");
    assert.ok(mobileCardFooters.length >= 3 && mobileCardFooters.every(card => card.footerHeight <= 60 && card.addRightGap <= 2), "Résidences, Professions et Événements : une seule ligne, Ajouter une attestation à droite");
    await eventRow.locator("summary").click();
    assert.equal(await eventRow.evaluate(details => details.open), false, "panneau événement replié sans retirer son pied d’actions");
    assert.equal(await eventCard.locator("[data-journey-attestation-add]").count(), 1, "ajout d’attestation reste accessible carte fermée");
    await eventCard.locator('[data-journey-attestation-add]').click();
    await page.locator('[data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1902");
    await page.fill("#journeyAttComment", "Mention au recensement");
    await page.locator('[data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.lifeEvents[0].attestations.length, 1, "attestation événementielle enregistrée indépendamment");
    assert.equal(await eventRow.locator(".life-entry-chevron").count(), 1, "chevron affiché dès qu’une attestation apporte des détails");
    assert.equal(await eventRow.locator(".life-attestation").count(), 1, "détails de l’attestation consultables");
    await eventRow.locator('[data-journey-attestation-edit^="event:"]').click();
    await page.fill("#journeyAttComment", "Commentaire modifié");
    await page.locator('[data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    assert.match(await eventRow.innerText(), /Commentaire modifié/, "attestation d’événement modifiable");
    const eventAttestationDeleteIndex = dialogMessages.length;
    await eventRow.locator('[data-journey-attestation-delete]').click();
    for (let i = 0; i < 60 && dialogMessages.length === eventAttestationDeleteIndex; i++) await page.waitForTimeout(50);
    assert.match(dialogMessages[eventAttestationDeleteIndex] || "", /Supprimer cette attestation/, "confirmation de suppression d’attestation événementielle");
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.lifeEvents[0].attestations.length, 0, "suppression individuelle de l’attestation événementielle");
    await page.setViewportSize({ width: 1280, height: 900 });
    const editJourneyWithData = await page.locator("#personPageDetailedJourney").evaluate(section => {
      const columns = [...section.querySelectorAll(".life-journey-column")];
      const lefts = columns.map(column => Math.round(column.getBoundingClientRect().left));
      const collisions = columns.filter(column => {
        const head = column.querySelector(".life-journey-column-head");
        return head.querySelector("h4").getBoundingClientRect().right > head.querySelector(":scope > .btn").getBoundingClientRect().left + 1;
      }).length;
      return { distinctColumns: new Set(lefts).size, texts: columns.map(column => column.innerText), collisions };
    });
    assert.equal(editJourneyWithData.distinctColumns, 3, "trois colonnes desktop en modification avec données");
    assert.match(editJourneyWithData.texts[0], /Orino/, "résidence dans la colonne desktop dédiée");
    assert.match(editJourneyWithData.texts[1], /Agriculteur/, "profession dans la colonne desktop dédiée");
    assert.match(editJourneyWithData.texts[2], /Recensement de Biella/, "événement dans la colonne desktop dédiée");
    assert.equal(editJourneyWithData.collisions, 0, "aucun chevauchement CTA/titre en desktop avec données");
    await page.setViewportSize({ width: 390, height: 844 });
    await eventCard.locator('[data-journey-edit^="event:"]').click();
    await page.fill("#journeyLabel", "  RECENSEMENT  ");
    await page.locator('[data-journey-save="event"]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.lifeEvents[0].label, "  RECENSEMENT  ", "valeur historique conservée sans normalisation en écriture");
    assert.match(await eventRow.locator(".life-entry-summary").innerText(), /^Recensement · 1901/, "intitulé identique au type omis du rendu");
    await eventCard.locator('[data-journey-edit^="event:"]').click();
    await page.fill("#journeyLabel", "");
    await page.fill("#journeyPlace", "");
    await page.fill("#journeyRegion", "");
    await page.fill("#journeyCountry", "");
    await page.locator('[data-journey-save="event"]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.lifeEvents[0].label, "", "intitulé vide enregistré sans valeur automatique");
    assert.match(await eventRow.locator(".life-entry-summary").innerText(), /^Recensement · 1901/, "titre de l’événement sans intitulé");
    assert.equal(await eventRow.locator(".life-entry-place").count(), 0, "aucune ligne de lieu vide");
    assert.equal(await eventRow.locator(".life-entry-chevron").count(), 0, "aucun chevron sur l’événement sans détail");
    assert.equal(await eventRow.locator(".life-entry-body").count(), 0, "aucune zone vide sur l’événement sans détail");
    assert.equal(await eventCard.locator("[data-journey-edit], [data-journey-delete], [data-journey-attestation-add]").count(), 3, "actions disponibles dans le pied de carte même sans détails");
    const mobileJourneyDataLayout = await page.locator("#personPageDetailedJourney").evaluate(section => {
      const columns = [...section.querySelectorAll(".life-journey-column")];
      const lefts = columns.map(column => Math.round(column.getBoundingClientRect().left));
      return { singleColumn: lefts.every(left => left === lefts[0]), texts: columns.map(column => column.innerText) };
    });
    assert.equal(mobileJourneyDataLayout.singleColumn, true, "une colonne sur mobile avec données");
    assert.match(mobileJourneyDataLayout.texts[0], /Orino/, "résidence dans sa colonne");
    assert.match(mobileJourneyDataLayout.texts[1], /Agriculteur/, "profession dans sa colonne");
    assert.match(mobileJourneyDataLayout.texts[2], /Recensement · 1901/, "événement sans intitulé restitué par type et date dans sa colonne");

    /* Annulation d'une modification non enregistrée : confirmation, aucune écriture. */
    await page.locator('[data-journey-edit^="residence:"]').click();
    await page.fill("#journeyAddress", "12, rue des Forges");
    const cancelIndex = dialogMessages.length;
    await page.locator("[data-journey-cancel]").click();
    for (let i = 0; i < 60 && dialogMessages.length === cancelIndex; i++) await page.waitForTimeout(50);
    assert.match(dialogMessages[cancelIndex] || "", /Abandonner les modifications/, "confirmation avant abandon");
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.residences[0].address || "", "", "annulation : aucune modification enregistrée");
    assert.ok(!(await page.locator("#personPageDetailedJourney [data-journey-form]").isVisible()), "formulaire fermé après annulation");

    /* Édition effective d'une entrée. */
    await page.locator('[data-journey-edit^="residence:"]').click();
    await page.fill("#journeyRegion", "Varese (VA)");
    await page.locator('[data-journey-save="residence"]').click();
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.residences[0].region, "Varese (VA)", "modification enregistrée");

    /* Suppression individuelle d'une attestation. */
    const attestationIndex = dialogMessages.length;
    await page.locator('#personPageDetailedJourney [data-journey-attestation-delete]').first().click();
    for (let i = 0; i < 60 && dialogMessages.length === attestationIndex; i++) await page.waitForTimeout(50);
    assert.match(dialogMessages[attestationIndex] || "", /Supprimer cette attestation/, "confirmation de suppression d'attestation");
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.residences[0].attestations.length, 1, "attestation retirée seule");

    /* Suppression de la résidence avec ses attestations : message avec le nombre. */
    const residenceIndex = dialogMessages.length;
    await page.locator('[data-journey-delete^="residence:"]').click();
    for (let i = 0; i < 60 && dialogMessages.length === residenceIndex; i++) await page.waitForTimeout(50);
    assert.match(dialogMessages[residenceIndex] || "", /Cette résidence contient 1 attestation\. Supprimer la résidence et ses attestations \?/, "confirmation avec le nombre d'attestations");
    await page.waitForFunction(() => !document.querySelector('#personPageDetailedJourney [data-journey-delete^="residence:"]'), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.residences.length, 0, "résidence et attestations supprimées");

    /* Suppression indépendante de l'événement. */
    const eventIndex = dialogMessages.length;
    await page.locator('[data-journey-delete^="event:"]').click();
    for (let i = 0; i < 60 && dialogMessages.length === eventIndex; i++) await page.waitForTimeout(50);
    assert.match(dialogMessages[eventIndex] || "", /Supprimer cet événement/, "confirmation de suppression d'événement");
    await page.waitForFunction(() => !document.querySelector('#personPageDetailedJourney [data-journey-delete^="event:"]'), undefined, { timeout: 5000 });
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.lifeEvents.length, 0, "événement supprimé seul");
    assert.equal(journey.professions.length, 1, "profession intacte après suppressions");
    assert.match(await page.locator("#personPageDetailedJourney").innerText(), /Aucune résidence renseignée/, "état vide restauré");
    await page.fill("#notes", "Note après parcours");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    journey = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(journey.professions.length, 1, "la sauvegarde générale de la fiche conserve les professions");
    const mobileConsultJourneyWithData = await page.locator("#personPageDetailedJourney").evaluate(section => {
      const columns = [...section.querySelectorAll(".life-journey-column")];
      const lefts = columns.map(column => Math.round(column.getBoundingClientRect().left));
      return { distinctColumns: new Set(lefts).size, texts: columns.map(column => column.innerText), actions: section.querySelectorAll("[data-journey-add], [data-journey-edit], [data-journey-delete]").length };
    });
    assert.equal(mobileConsultJourneyWithData.distinctColumns, 1, "une colonne mobile en consultation avec données");
    assert.match(mobileConsultJourneyWithData.texts[1], /Agriculteur/, "profession visible dans la colonne mobile");
    assert.equal(mobileConsultJourneyWithData.actions, 0, "actions masquées en consultation mobile avec données");
    await page.setViewportSize({ width: 1280, height: 900 });
    const consultationJourneyData = await page.locator("#personPageDetailedJourney").evaluate(section => {
      const columns = [...section.querySelectorAll(".life-journey-column")];
      const lefts = columns.map(column => Math.round(column.getBoundingClientRect().left));
      return {
        distinctColumns: new Set(lefts).size,
        borders: columns.map(column => getComputedStyle(column).borderLeftWidth),
        texts: columns.map(column => column.innerText),
        actionCount: section.querySelectorAll("[data-journey-add], [data-journey-edit], [data-journey-delete], [data-journey-attestation-add], [data-journey-attestation-edit], [data-journey-attestation-delete]").length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert.equal(consultationJourneyData.distinctColumns, 3, "trois colonnes desktop avec données");
    assert.deepEqual(consultationJourneyData.borders, ["0px", "1px", "1px"], "séparateurs desktop avec données");
    assert.match(consultationJourneyData.texts[0], /Aucune résidence renseignée/, "colonne résidences avec état vide");
    assert.match(consultationJourneyData.texts[1], /Agriculteur/, "colonne professions avec donnée");
    assert.match(consultationJourneyData.texts[2], /Aucun événement renseigné/, "colonne événements avec état vide");
    assert.equal(consultationJourneyData.actionCount, 0, "aucune action en consultation malgré les données");
    assert.ok(consultationJourneyData.overflow <= 1, "consultation desktop large sans débordement");

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
          assert.ok(item.iconWidth <= 18, `${width}px : icône de l'événement ${index + 1} lisible à 18 px (${item.iconWidth}px)`);
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
        const proofLabel = document.getElementById("proofEntryPointLabel").innerText.trim();
        const documentAria = document.getElementById("linkDocumentBtn").getAttribute("aria-label");
        const proofAria = document.getElementById("genealogyProposeProofForPersonBtn").getAttribute("aria-label");
        const copy = document.querySelector("#personRelationsPanel .relation-person-copy");
        const link = copy.querySelector("strong");
        const meta = copy.querySelector(".relation-person-meta");
        const textRect = element => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect(); };
        const linkText = textRect(link), metaText = textRect(meta);
        return {
          date: { l: Math.round(box.left), t: Math.round(box.top), b: Math.round(box.bottom), h: Math.round(box.height) },
          documentLabel,
          proofLabel,
          documentAria,
          proofAria,
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
      assert.equal(editionState.documentLabel, "Ajouter", `${width}px : libellé desktop Documents concis`);
      assert.equal(editionState.proofLabel, "Ajouter", `${width}px : libellé desktop Preuves concis`);
      assert.equal(editionState.documentAria, "Ajouter un document", `${width}px : nom accessible Documents conservé`);
      assert.equal(editionState.proofAria, "Ajouter une preuve", `${width}px : nom accessible Preuves explicite`);
      assert.ok(editionState.horizontalOverflow <= 1, `${width}px : libellé desktop sans débordement (${editionState.horizontalOverflow}px)`);
      assert.ok(editionState.familyVisualGap >= 3 && editionState.familyVisualGap <= 5.5, `${width}px : espacement Famille Modification aligné sur la Consultation (${editionState.familyVisualGap}px)`);
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
          addProofLabel: document.getElementById("proofEntryPointLabel").innerText.trim(),
          addProofAccessibleName: document.getElementById("genealogyProposeProofForPersonBtn").getAttribute("aria-label") || document.getElementById("genealogyProposeProofForPersonBtn").innerText.trim(),
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
      assert.equal(inlineResponsive.addProofLabel, "Ajouter une preuve", `${width}px : libellé mobile complet des Preuves`);
      assert.equal(inlineResponsive.addProofAccessibleName, "Ajouter une preuve", `${width}px : nom accessible explicite du CTA Preuve`);
      assert.ok(inlineResponsive.listToProof >= 16, `${width}px : au moins 16px entre les preuves et « Ajouter une preuve » (${inlineResponsive.listToProof}px)`);
      assert.ok(inlineResponsive.proofToCardBottom >= 16, `${width}px : au moins 16px sous « Ajouter une preuve » avant la fin de la carte (${inlineResponsive.proofToCardBottom}px)`);
      assert.ok(inlineResponsive.familyVisualGap >= 3 && inlineResponsive.familyVisualGap <= 5.5, `${width}px : écart visuel nom/relation aligné sur la Consultation (${inlineResponsive.familyVisualGap}px)`);
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

    /* CTA sticky : consultation uniquement, seuil haut, sorties de fiche et responsive. */
    const stickyBar = page.locator("#personPageStickyActions");
    assert.equal(await stickyBar.evaluate(bar => bar.classList.contains("is-visible")), false, "à l’ouverture, les CTA restent uniquement en haut");
    assert.deepEqual(await stickyBar.locator(":scope > .btn").allTextContents(), ["Voir l’arbre", "Modifier"], "libellés complets des CTA sticky");
    for (const width of [320, 375, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(120);
      assert.equal(await stickyBar.evaluate(bar => bar.classList.contains("is-visible")), false, `${width}px : barre cachée avec les CTA d’origine visibles`);
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await page.waitForFunction(() => document.getElementById("personPageStickyActions").classList.contains("is-visible"), undefined, { timeout: 5000 });
      const stickyLayout = await page.evaluate(() => {
        const bar = document.getElementById("personPageStickyActions");
        const box = bar.getBoundingClientRect();
        const tree = document.getElementById("personPageStickyViewTreeBtn").getBoundingClientRect();
        const edit = document.getElementById("personPageStickyEditBtn").getBoundingClientRect();
        const originalTree = document.getElementById("personPageViewTreeBtn").getBoundingClientRect();
        const originalEdit = document.getElementById("personPageEditBtn").getBoundingClientRect();
        const lastSection = document.getElementById("personPageResearch").getBoundingClientRect();
        return {
          barPosition: getComputedStyle(bar).position,
          barWidth: Math.round(box.width),
          barHeight: Math.round(box.height),
          buttonsSameRow: Math.abs(tree.top - edit.top) <= 1 && Math.abs(tree.bottom - edit.bottom) <= 1,
          originalsOffscreen: originalTree.bottom <= 0 || originalTree.top >= innerHeight
            ? (originalEdit.bottom <= 0 || originalEdit.top >= innerHeight)
            : false,
          lastContentAboveBar: lastSection.bottom <= box.top,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      assert.equal(stickyLayout.barPosition, "fixed", `${width}px : barre fixe`);
      assert.ok(stickyLayout.buttonsSameRow, `${width}px : CTA côte à côte`);
      assert.ok(stickyLayout.originalsOffscreen, `${width}px : CTA d’origine et sticky jamais visibles simultanément`);
      assert.ok(stickyLayout.lastContentAboveBar, `${width}px : dernier contenu accessible au-dessus de la barre`);
      assert.ok(stickyLayout.pageOverflow <= 1, `${width}px : aucun débordement horizontal`);
      if (width <= 390) assert.ok(stickyLayout.barWidth <= width, `${width}px : barre contenue dans le viewport mobile`);
      else assert.ok(stickyLayout.barWidth <= 512, "desktop : barre de largeur contenue");
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForFunction(() => !document.getElementById("personPageStickyActions").classList.contains("is-visible"), undefined, { timeout: 5000 });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForFunction(() => document.getElementById("personPageStickyActions").classList.contains("is-visible"), undefined, { timeout: 5000 });
    await stickyBar.locator("#personPageStickyEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    assert.equal(await stickyBar.evaluate(bar => bar.classList.contains("is-visible")), false, "passage en modification : barre sticky masquée immédiatement");
    assert.equal(await page.locator("#personPageEditBtn").isHidden(), true, "CTA d’origine masqué en modification comme auparavant");
    await page.locator('#personPageEditHost [data-close="personDialog"]').click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    /* Le passage en Modification remonte désormais en haut de la fiche : on
       recrée l'état « fiche en bas » pour contrôler la réapparition de la
       barre sticky après la fermeture. */
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForFunction(() => document.getElementById("personPageStickyActions").classList.contains("is-visible"), undefined, { timeout: 5000 });
    await stickyBar.locator("#personPageStickyViewTreeBtn").click();
    await page.waitForFunction(() => document.getElementById("personDetailView").hidden && !document.getElementById("appMain").hidden);
    assert.equal(await stickyBar.evaluate(bar => bar.classList.contains("is-visible")), false, "ouverture de l’arbre : barre sticky retirée");
    await page.evaluate(() => window.__personPageTest.openDirectory());
    assert.equal(await stickyBar.evaluate(bar => bar.classList.contains("is-visible")), false, "Annuaire : aucune barre sticky Personne");
    await page.locator('#directoryList [data-directory-person="person-page-b"]').click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Carlo"));
    assert.equal(await stickyBar.evaluate(bar => bar.classList.contains("is-visible")), false, "autre fiche ouverte : barre initialement masquée");

    /* Parcours de vie desktop : jalons fondamentaux interactifs et panneau intégré. */
    const lifeTriggers = page.locator('#personPageTimeline [data-life-event]');
    assert.equal(await lifeTriggers.count(), 2, "Carlo : naissance et mariage interactifs");
    assert.equal(await page.locator('#personPageTimeline .timeline-title').count(), 2, "Carlo : naissance et mariage affichés");
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden && document.querySelectorAll('#personPageTimeline .timeline-title').length === 3, undefined, { timeout: 10000 });
    await page.setViewportSize({ width: 1280, height: 850 });
    assert.equal(await lifeTriggers.count(), 3, "Ada : naissance, mariage et décès interactifs");
    assert.deepEqual(await page.locator('#personPageTimeline .timeline-title').allTextContents(), ["Naissance", "Mariage", "Décès"], "ordre des jalons fondamentaux");
    assert.equal(await page.locator('#personPageTimeline .timeline-attestation-indicator').count(), 0, "aucun indicateur sans attestation");
    const desktopChevron = await page.locator('#personPageTimeline .timeline-event-trigger .timeline-event-chevron').first().evaluate(element => getComputedStyle(element).display);
    assert.equal(desktopChevron, "none", "chevron masqué sur la frise desktop");
    const birthTrigger = page.locator('#personPageTimeline [data-life-event="birth"]');
    await birthTrigger.hover();
    await page.waitForTimeout(250);
    const hoverBackground = await birthTrigger.evaluate(element => getComputedStyle(element).backgroundColor);
    assert.notEqual(hoverBackground, "rgba(0, 0, 0, 0)", "survol de toute la zone interactive");
    await birthTrigger.click();
    const desktopPanel = page.locator("#personPageTimelineDetail .person-page-timeline-detail-panel");
    await page.waitForFunction(() => !document.getElementById("personPageTimelineDetail").hidden);
    assert.equal(await desktopPanel.count(), 1, "panneau intégré ouvert sous la frise");
    assert.equal(await desktopPanel.getAttribute("aria-labelledby"), await birthTrigger.getAttribute("id"), "panneau associé au déclencheur");
    assert.equal(await desktopPanel.locator(":scope > h4").innerText(), "Naissance", "type de l’événement affiché");
    assert.equal(await desktopPanel.locator(".life-event-attestations").count(), 0, "aucune section attestations vide");
    const birthFacts = await desktopPanel.evaluate(panel => {
      const box = panel.querySelector(".life-event-primary-facts");
      const facts = [...panel.querySelectorAll(".life-event-primary-facts .source-detail-fact")];
      return {
        display: box ? getComputedStyle(box).display : "absent",
        labels: facts.map(fact => fact.querySelector("strong")?.textContent),
        sameRow: facts.length >= 2 ? Math.abs(facts[0].getBoundingClientRect().top - facts[1].getBoundingClientRect().top) <= 2 : null
      };
    });
    assert.equal(birthFacts.display, "flex", "date et lieu regroupés sur une ligne souple");
    assert.deepEqual(birthFacts.labels, ["Date", "Lieu"], "libellés des informations conservés");
    assert.equal(birthFacts.sameRow, true, "date et lieu sur la même ligne quand la largeur le permet");
    assert.equal(await desktopPanel.locator("[data-life-event-manage], [data-life-event-att-add], [data-life-event-att-edit], [data-journey-attestation-add]").count(), 0, "panneau strictement en lecture seule");
    assert.equal(await page.locator('#lifeEventDialog').count(), 0, "aucun volet latéral");
    assert.equal(await page.locator('#personPageEditHost').isHidden(), true, "aucune activation de Modification");
    const borderTop = await desktopPanel.evaluate(element => getComputedStyle(element).borderTopColor);
    assert.equal(borderTop, "rgb(40, 75, 63)", "bordure supérieure verte pour la Naissance");
    assert.equal(await desktopPanel.locator(".timeline-detail-marker").count(), 1, "triangle de repérage présent");
    const selectedBackground = await birthTrigger.evaluate(element => getComputedStyle(element).backgroundColor);
    assert.notEqual(selectedBackground, hoverBackground, "état sélectionné distinct du survol");
    assert.equal(await birthTrigger.getAttribute("aria-expanded"), "true", "état ouvert annoncé");
    await birthTrigger.click();
    assert.equal(await page.locator("#personPageTimelineDetail").isHidden(), true, "clic sur l’actif referme le panneau");
    assert.equal(await birthTrigger.getAttribute("aria-expanded"), "false", "état fermé annoncé");
    await page.locator('#personPageTimeline [data-life-event="union-person-page-family"]').click();
    assert.equal(await desktopPanel.locator(":scope > h4").innerText(), "Mariage", "changement d’événement actif");
    assert.equal(await desktopPanel.evaluate(element => getComputedStyle(element).borderTopColor), "rgb(183, 119, 69)", "bordure orange pour l’union");
    assert.equal(await page.locator('#personPageTimeline [data-life-event="birth"]').getAttribute("aria-expanded"), "false", "ancien événement désactivé");
    await page.locator('#personPageTimeline [data-life-event="death"]').click();
    assert.equal(await desktopPanel.locator(":scope > h4").innerText(), "Décès", "remplacement par le décès");
    assert.equal(await desktopPanel.evaluate(element => getComputedStyle(element).borderTopColor), "rgb(166, 66, 56)", "bordure rouge pour le décès");
    await page.locator('#personPageTimeline [data-life-event="death"]').click();

// Naissance : le CTA est dans les champs du fait majeur, en Modification.
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden, undefined, { timeout: 10000 });
    assert.equal(await page.locator("#personLifeTimeline").isHidden(), true, "frise toujours masquée en Modification");
    const birthAdd = page.locator("#birthAttestationControl [data-journey-attestation-add]");
    assert.equal(await birthAdd.innerText(), "Ajouter une attestation");
    const desktopBirthLayout = await page.evaluate(() => {
      const place = document.querySelector("#place").getBoundingClientRect();
      const button = document.querySelector("#birthAttestationControl .life-attestation-add").getBoundingClientRect();
      return { buttonLeft: button.left, placeRight: place.right };
    });
    assert.ok(desktopBirthLayout.buttonLeft >= desktopBirthLayout.placeRight - 2, "desktop : CTA aligné à droite des champs Naissance");
    await birthAdd.click();
    await page.locator('[data-journey-attestation-save]').click();
    assert.ok(await page.locator("#journeyError-attDate").isVisible(), "date de l’attestation obligatoire");
    assert.deepEqual(await page.locator("#personForm .life-journey-justification-group > strong").allTextContents(), ["Documents associés", "Sources", "Preuves"], "sélecteurs de justification conservés dans le formulaire");
    assert.equal(await page.locator("[data-journey-document-check]").count(), 4);
    assert.equal(await page.locator("[data-journey-source-check]").count(), 1);
    assert.equal(await page.locator("[data-journey-proof-check]").count(), 1);
    await page.locator('[data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1892");
    await page.locator('[data-journey-document-check="person-page-document"]').check();
    await page.locator('[data-journey-source-check="person-page-source"]').check();
    await page.locator('[data-journey-proof-check="person-page-proof"]').check();
    await page.locator('[data-journey-attestation-save]').click();
    await page.waitForFunction(() => window.__personPageTest.journeyState().birthAttestations.length === 1, undefined, { timeout: 5000 });
    let lifeState = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.deepEqual(lifeState.birthAttestations[0].documentIds, ["person-page-document"]);
    assert.deepEqual(lifeState.birthAttestations[0].sourceIds, ["person-page-source"]);
    assert.equal(await page.evaluate(() => (window.__personPageLifeEventWrites || []).at(-1)?.kind), "birth", "naissance enregistrée sur la fiche personne");
    assert.equal(await page.locator("#birthAttestationList .life-attestation").count(), 1, "attestation rendue sous les champs Naissance");

    // Les fenêtres mobiles gardent le CTA dans son groupe sans débordement.
    for (const narrowWidth of [320, 375, 390]) {
      await page.setViewportSize({ width: narrowWidth, height: 844 });
      const narrow = await page.evaluate(() => {
        const group = document.querySelector("#birthAttestationControl").parentElement.getBoundingClientRect();
        const control = document.querySelector("#birthAttestationControl").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, groupRight: group.right, controlRight: control.right };
      });
      assert.ok(narrow.overflow <= 1, `${narrowWidth}px : aucun débordement horizontal`);
      assert.ok(narrow.controlRight <= narrow.groupRight + 1, `${narrowWidth}px : CTA contenu dans le groupe Naissance`);
    }
    await page.setViewportSize({ width: 1280, height: 850 });

    // Enregistrer la fiche ne perd pas les attestations ; modifier et supprimer restent intégrés au même groupe.
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden, undefined, { timeout: 10000 });
    lifeState = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(lifeState.birthAttestations.length, 1, "la sauvegarde de la fiche conserve l’attestation");
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.locator('#birthAttestationList [data-journey-attestation-edit^="birth:"]').click();
    await page.fill("#journeyAttComment", "Acte de naissance retrouvé");
    await page.locator('[data-journey-attestation-save]').click();
    await page.waitForFunction(() => window.__personPageTest.journeyState().birthAttestations[0]?.comment === "Acte de naissance retrouvé", undefined, { timeout: 5000 });
    const deleteAttestationIndex = dialogMessages.length;
    await page.locator('#birthAttestationList [data-journey-attestation-delete^="birth:"]').click();
    for (let i = 0; i < 60 && dialogMessages.length === deleteAttestationIndex; i++) await page.waitForTimeout(50);
    assert.match(dialogMessages[deleteAttestationIndex] || "", /Supprimer cette attestation/);
    await page.waitForFunction(() => window.__personPageTest.journeyState().birthAttestations.length === 0, undefined, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__personPageTest.documentExists("person-page-document")), true, "suppression sans supprimer le document original");

    // Décès : même intégration, avec stockage indépendant sur la fiche personne.
    await page.locator("#deathAttestationControl [data-journey-attestation-add]").click();
    await page.locator('[data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1932");
    await page.fill("#journeyAttComment", "Acte de décès consulté");
    await page.locator('[data-journey-attestation-save]').click();
    await page.waitForFunction(() => window.__personPageTest.journeyState().deathAttestations.length === 1, undefined, { timeout: 5000 });
    assert.equal(await page.evaluate(() => (window.__personPageLifeEventWrites || []).at(-1)?.kind), "death", "décès enregistré dans son champ propre");
    await page.locator("#savePersonBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden, undefined, { timeout: 10000 });
    lifeState = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(lifeState.deathAttestations.length, 1, "la sauvegarde de la fiche conserve l’attestation de décès");
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);

    // Union : attestation partagée portée par families et conservée par la sauvegarde des détails.
    const partnerCard = page.locator('#personPageEditHost [data-family-card="partner:person-page-family"]');
    assert.equal(await partnerCard.locator("[data-family-card-toggle]").getAttribute("aria-expanded"), "true", "panneau partenaire ouvert dès l’entrée en Modification");
    assert.equal(await partnerCard.locator(".family-card-panel").isHidden(), false, "panneau partenaire visible sans interaction");
    const familyEdit = partnerCard.locator('[data-edit-family="person-page-family"]');
    await familyEdit.click();
    await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open, undefined, { timeout: 5000 });
    const marriageAdd = page.locator("#familyMarriageAttestationControl [data-journey-attestation-add]");
    assert.equal(await marriageAdd.innerText(), "Ajouter une attestation");
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const unionCta = await page.evaluate(() => {
        const section = document.querySelector(".family-union-attestation-section");
        const layout = section.querySelector(".family-union-attestation-layout").getBoundingClientRect();
        const control = section.querySelector("#familyMarriageAttestationControl").getBoundingClientRect();
        const button = section.querySelector("#familyMarriageAttestationControl .life-attestation-add").getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          centerDiff: Math.abs((control.left + control.right) / 2 - (layout.left + layout.right) / 2),
          buttonVisible: button.width > 0 && button.height > 0,
          sectionRight: section.getBoundingClientRect().right,
          buttonRight: button.right
        };
      });
      assert.ok(unionCta.overflow <= 1, `${width}px : détails de l’union sans débordement`);
      assert.ok(unionCta.buttonVisible && unionCta.centerDiff <= 2, `${width}px : CTA d’attestation d’union centré`);
      assert.ok(unionCta.buttonRight <= unionCta.sectionRight + 1, `${width}px : CTA d’union entièrement visible`);
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    for (const width of [320, 375, 390, 1280]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 850 });
      const layout = await page.evaluate(() => {
        const section = document.querySelector(".family-union-attestation-section").getBoundingClientRect();
        const button = document.querySelector("#familyMarriageAttestationControl .life-attestation-add").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, sectionRight: section.right, buttonRight: button.right };
      });
      assert.ok(layout.overflow <= 1, `${width}px : pas de débordement dans les détails de l’union`);
      assert.ok(layout.buttonRight <= layout.sectionRight + 1, `${width}px : CTA contenu dans la section Union`);
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    await marriageAdd.click();
    await page.locator('[data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1888");
    await page.fill("#journeyAttComment", "Acte de mariage partagé");
    await page.locator('[data-journey-document-check="person-page-document"]').check();
    await page.locator('[data-journey-attestation-save]').click();
    await page.waitForFunction(() => (window.__personPageTest.journeyState().families.find(f => f.id === "person-page-family")?.marriageAttestations || []).length === 1, undefined, { timeout: 5000 });
    assert.equal(await page.evaluate(() => (window.__personPageLifeEventWrites || []).at(-1)?.kind), "marriage", "mariage enregistré sur la famille partagée");
    await page.locator("#unionPlace").fill("Palermo modifié");
    await page.locator('#familyDetailsForm button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById("familyDetailsDialog").open, undefined, { timeout: 5000 });
    lifeState = await page.evaluate(() => window.__personPageTest.journeyState());
    assert.equal(lifeState.families.find(f => f.id === "person-page-family").marriageAttestations.length, 1, "la sauvegarde des détails conserve l’attestation d’union");
    await page.locator('#personPageEditHost [data-close="personDialog"]').click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    const partnerCounterText = await page.evaluate(() => {
      const groups = [...document.querySelectorAll("#personPageFamily .relation-group")];
      return groups.find(group => group.querySelector("h4")?.textContent === "Partenaires et unions")?.innerText || "";
    });
    assert.match(partnerCounterText, /1 attestation/, "compteur de mariage issu de l’union concernée");
    const desktopIndicatorAxis = await page.evaluate(() => {
      const indicator = document.querySelector("#personPageTimeline .timeline-attestation-indicator");
      if (!indicator) return null;
      return { marginLeft: Number.parseFloat(getComputedStyle(indicator).marginLeft) };
    });
    assert.ok(desktopIndicatorAxis, "indicateur d’attestation présent dans la frise desktop");
    assert.equal(desktopIndicatorAxis.marginLeft, 0, "desktop : décalage du compteur inchangé (règle mobile non appliquée)");
    assert.equal(await page.locator('#personPageFamily [data-family-card="partner:person-page-family"] .relation-person-attestation-count').innerText(), "1 attestation", "compteur sans précision du type d’attestation");
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-b"]').click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Carlo"));
    await page.locator('#personPageTimeline [data-life-event="union-person-page-family"]').click();
    const unionPanel = page.locator("#personPageTimelineDetail .person-page-timeline-detail-panel");
    assert.equal(await unionPanel.locator(":scope > h4").innerText(), "Mariage", "panneau d’union ouvert");
    assert.equal(await unionPanel.locator(".life-attestation").count(), 1, "attestation de mariage visible");
    assert.match(await unionPanel.locator(".life-attestation").innerText(), /Acte de mariage partagé/, "attestation partagée consultable");
    assert.equal(await unionPanel.locator(".life-event-attestations h4").innerText(), "Attestation", "titre au singulier pour une seule attestation");
    assert.equal(await page.locator('#lifeEventDialog').count(), 0, "union sans volet latéral");
    assert.equal(await page.locator('#personPageEditHost').isHidden(), true, "union sans activation de Modification");
    await page.locator('#personPageTimeline [data-life-event="union-person-page-family"]').click();

    /* Harmonisation Famille : icônes, cartes dépliables, liens d'attestations et actions explicites. */
    await page.evaluate(() => document.querySelector('[data-person-page-section="family"]').click());

    // Icônes du Parcours de vie : rendu réel à 18 px, filaire et sans fond.
    const familyIcons = await page.evaluate(() => {
      const results = {};
      const host = document.createElement("div");
      host.className = "person-page-timeline";
      const jalon = document.createElement("div");
      jalon.className = "timeline-jalon journey-event";
      host.appendChild(jalon);
      document.getElementById("personPageFamily").appendChild(host);
      for (const id of ["icon-shield-military", "icon-church"]) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "ui-icon timeline-icon");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#" + id);
        svg.appendChild(use);
        jalon.appendChild(svg);
        const box = svg.getBoundingClientRect();
        const style = getComputedStyle(svg);
        const symbol = document.getElementById(id);
        const paths = [...symbol.querySelectorAll("path")];
        let length = 0;
        for (const path of paths) {
          try { length += path.getTotalLength ? path.getTotalLength() : 0; } catch { /* géométrie indisponible */ }
        }
        results[id] = { width: Math.round(box.width), color: style.color, bg: style.backgroundColor, paths: paths.length, length: Math.round(length) };
        svg.remove();
      }
      host.remove();
      return results;
    });
    assert.ok(familyIcons["icon-shield-military"].width >= 16 && familyIcons["icon-shield-military"].width <= 18, `Service militaire à 18 px (${familyIcons["icon-shield-military"].width}px)`);
    assert.equal(familyIcons["icon-shield-military"].color, "rgb(70, 98, 122)", "Service militaire en bleu source");
    assert.equal(familyIcons["icon-shield-military"].bg, "rgba(0, 0, 0, 0)", "Service militaire sans fond plein");
    assert.ok(familyIcons["icon-shield-military"].paths >= 2, "bouclier filaire avec emblème distinct");
    assert.ok(familyIcons["icon-shield-military"].length > 50, "tracé du bouclier lisible");
    assert.ok(familyIcons["icon-church"].width >= 16 && familyIcons["icon-church"].width <= 18, `Baptême à 18 px (${familyIcons["icon-church"].width}px)`);
    assert.ok(familyIcons["icon-church"].paths >= 6, "église avec clocher, croix et bâtiment");
    assert.ok(familyIcons["icon-church"].length > 60, "tracé de l’église suffisamment détaillé");
    assert.equal(familyIcons["icon-church"].color, "rgb(70, 98, 122)", "Baptême en bleu source");

    // Consultation : aucun menu ⋯ ni action de gestion.
    assert.equal(await page.locator("#personPageFamily .relation-actions-menu").count(), 0, "aucun menu à trois points en consultation");
    assert.equal(await page.locator("#personPageFamily [data-edit-family], #personPageFamily [data-remove-partner], #personPageFamily [data-remove-child]").count(), 0, "aucune action de gestion en consultation");
    assert.equal(await page.locator("#personPageFamily .life-attestation-add").count(), 0, "aucun ajout d’attestation en consultation");

    // Partenaire : compteur unique = lien direct vers la visionneuse existante.
    const consultPartnerCard = page.locator('#personPageFamily [data-family-card="partner:person-page-family"]');
    assert.equal(await consultPartnerCard.locator(".family-card-panel").isHidden(), true, "panneau partenaire replié par défaut");
    const consultPartnerToggle = consultPartnerCard.locator("[data-family-card-toggle]");
    assert.equal(await consultPartnerToggle.getAttribute("aria-expanded"), "false", "chevron partenaire fermé annoncé");
    const consultChevron = await consultPartnerToggle.locator("svg").evaluate(svg => getComputedStyle(svg).transform);
    assert.ok(!consultChevron.includes("-1"), "chevron consultation orienté vers le bas");
    const consultPartnerCounter = consultPartnerCard.locator(".relation-person-copy .relation-person-attestation-count");
    assert.equal(await consultPartnerCounter.innerText(), "1 attestation", "compteur de mariage au format commun");
    assert.equal(await consultPartnerCounter.evaluate(element => element.tagName), "SPAN", "compteur strictement informatif");
    const counterStyle = await consultPartnerCounter.evaluate(element => {
      const style = getComputedStyle(element);
      return { decoration: style.textDecorationLine, color: style.color, icon: element.querySelector(".ui-icon use")?.getAttribute("href") };
    });
    assert.equal(counterStyle.decoration, "none", "compteur sans soulignement ni apparence de lien");
    assert.equal(counterStyle.icon, "#icon-document", "compteur précédé de la petite icône document");
    await consultPartnerCounter.click();
    assert.equal(await page.locator("#documentDetailView").isHidden(), true, "clic sur le compteur sans navigation");
    assert.equal(await consultPartnerCard.locator(".family-card-panel").isHidden(), true, "clic sur le compteur sans déplier la carte");

    // Panneau déplié : compléments et documents, sans répétition ni action.
    await consultPartnerToggle.click();
    await page.waitForFunction(() => document.querySelector('[data-family-card="partner:person-page-family"] .family-card-panel')?.hidden === false);
    await page.waitForFunction(() => {
      const svg = document.querySelector('[data-family-card="partner:person-page-family"] [data-family-card-toggle] svg');
      return svg && getComputedStyle(svg).transform.includes("-1");
    });
    const consultPartnerPanel = await consultPartnerCard.locator(".family-card-panel").evaluate(panel => ({
      docs: panel.querySelectorAll("[data-view-document]").length,
      text: panel.innerText,
      borderTop: getComputedStyle(panel).borderTopWidth,
      actions: panel.querySelectorAll("[data-edit-family], [data-remove-partner]").length
    }));
    assert.ok(consultPartnerPanel.docs >= 1, "documents individuellement accessibles dans le panneau");
    assert.doesNotMatch(consultPartnerPanel.text, /Palermo/, "lieu de l’union absent du panneau Famille");
    assert.equal(await consultPartnerCard.locator(".family-card-panel .source-detail-fact").count(), 0, "aucun bloc LIEU dans le panneau Famille");
    assert.doesNotMatch(consultPartnerPanel.text, /Adélaïde|Carlo/, "nom non répété dans le panneau");
    assert.notEqual(consultPartnerPanel.borderTop, "0px", "séparateur discret");
    assert.equal(consultPartnerPanel.actions, 0, "aucune action de modification en consultation");
    await consultPartnerToggle.click();
    await page.waitForFunction(() => document.querySelector('[data-family-card="partner:person-page-family"] .family-card-panel')?.hidden === true);

    // Le lien individuel du panneau conserve l'ouverture de la visionneuse.
    await consultPartnerToggle.click();
    await page.waitForFunction(() => document.querySelector('[data-family-card="partner:person-page-family"] .family-card-panel')?.hidden === false);
    await consultPartnerCard.locator('.family-card-panel [data-view-document="person-page-document"]').click();
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden, undefined, { timeout: 10000 });
    assert.match(await page.locator("#viewerTitle").innerText(), /Acte de naissance/, "visionneuse existante ouverte");
    await page.locator("#documentPageBackBtn").click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, undefined, { timeout: 10000 });
    assert.match(await page.locator("#personPageTitle").textContent(), /Carlo/, "retour à la fiche d’origine");
    assert.equal((await page.evaluate(() => window.__personPageTest.state())).section, "family", "section Famille restaurée");
    /* L'état choisi par l'utilisateur est conservé entre les re-rendus :
       on repasse le panneau partenaire à l'état de référence (fermé). */
    await page.evaluate(() => {
      const toggle = document.querySelector('#personPageFamily [data-family-card="partner:person-page-family"] [data-family-card-toggle]');
      if (toggle && toggle.getAttribute("aria-expanded") === "true") toggle.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-family-card="partner:person-page-family"] .family-card-panel')?.hidden === true);

    // Le lien du nom reste indépendant du compteur.
    await consultPartnerCard.locator(".person-detail-relative-link").click();
    await page.waitForFunction(() => !document.getElementById("personPageTitle").textContent.includes("Carlo"));
    await page.locator("#personPageBackBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Carlo"));
    await page.evaluate(() => document.querySelector('[data-person-page-section="family"]').click());

    // Enfant : compteur informatif sous la relation, les documents restent dans le panneau.
    const consultChildCard = page.locator('#personPageFamily [data-family-card="child:person-page-family"]');
    const consultChildToggle = consultChildCard.locator("[data-family-card-toggle]");
    const consultChildCounter = consultChildCard.locator(".relation-person-copy .relation-person-attestation-count");
    assert.equal(await consultChildCounter.innerText(), "2 attestations", "compteur de naissance sans précision du type");
    assert.equal(await consultChildCounter.evaluate(element => element.tagName), "SPAN", "compteur enfant non cliquable");
    assert.equal(await consultChildCounter.locator(".ui-icon use").getAttribute("href"), "#icon-document", "icône document devant le compteur enfant");
    assert.equal(await consultChildCard.locator(".family-card-panel").isHidden(), true, "panneau enfant replié par défaut");
    await consultChildCounter.click();
    assert.equal(await consultChildCard.locator(".family-card-panel").isHidden(), true, "clic sur le compteur sans déplier l’accordéon");
    assert.equal(await page.locator("#documentDetailView").isHidden(), true, "clic sur le compteur sans navigation");
    await consultChildToggle.click();
    await page.waitForFunction(() => document.querySelector('[data-family-card="child:person-page-family"] .family-card-panel')?.hidden === false);
    assert.equal(await consultChildCard.locator('.family-card-panel [data-view-document="person-page-document"]').count(), 1, "document de naissance accessible individuellement");
    assert.equal(await consultChildCard.locator('.family-card-panel [data-view-document="person-page-pdf"]').count(), 1, "second document accessible individuellement");
    await consultChildCard.locator('.family-card-panel [data-view-document="person-page-pdf"]').click();
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden, undefined, { timeout: 10000 });
    assert.match(await page.locator("#viewerTitle").innerText(), /Registre PDF/, "document choisi ouvert dans la visionneuse");
    await page.locator("#documentPageBackBtn").click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, undefined, { timeout: 10000 });
    await page.evaluate(() => document.querySelector('[data-person-page-section="family"]').click());
    await page.evaluate(() => {
      const toggle = document.querySelector('#personPageFamily [data-family-card="child:person-page-family"] [data-family-card-toggle]');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-family-card="child:person-page-family"] .family-card-panel')?.hidden === false);
    assert.match(await page.locator("#personPageTitle").textContent(), /Carlo/, "le chevron n’ouvre pas la fiche Personne");
    await page.evaluate(() => {
      const toggle = document.querySelector('#personPageFamily [data-family-card="child:person-page-family"] [data-family-card-toggle]');
      if (toggle && toggle.getAttribute("aria-expanded") === "true") toggle.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-family-card="child:person-page-family"] .family-card-panel')?.hidden === true);

    // Mobile : cartes sans débordement, chevrons tactiles et orientés.
    const consultationFamilySpacing = new Map();
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => document.querySelector('[data-person-page-section="family"]').click());
      const mobileCard = await page.evaluate(() => {
        const card = document.querySelector('#personPageFamily [data-family-card="partner:person-page-family"]');
        const toggle = card.querySelector("[data-family-card-toggle]");
        const panel = card.querySelector(".family-card-panel");
        const counter = card.querySelector(".relation-person-attestation-count");
        const meta = card.querySelector(".relation-person-meta");
        const copy = card.querySelector(".relation-person-copy");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          expanded: toggle.getAttribute("aria-expanded"),
          panelHidden: panel.hidden,
          counterLeft: counter ? Math.round(counter.getBoundingClientRect().left) : null,
          metaLeft: meta ? Math.round(meta.getBoundingClientRect().left) : null,
          counterTop: counter ? Math.round(counter.getBoundingClientRect().top) : null,
          metaBottom: meta ? Math.round(meta.getBoundingClientRect().bottom) : null,
          copyGap: copy ? getComputedStyle(copy).rowGap : "",
          metaMargin: meta ? getComputedStyle(meta).marginTop : "",
          chevronSize: Math.round(toggle.getBoundingClientRect().width)
        };
      });
      assert.ok(mobileCard.overflow <= 1, `${width}px : aucune carte Famille en débordement`);
      assert.equal(mobileCard.expanded, "false", `${width}px : carte repliée par défaut`);
      assert.equal(mobileCard.panelHidden, true, `${width}px : panneau masqué par défaut`);
      assert.ok(mobileCard.chevronSize >= 44, `${width}px : chevron tactile ≥ 44 px (${mobileCard.chevronSize}px)`);
      assert.equal(mobileCard.counterLeft, mobileCard.metaLeft, `${width}px : compteur aligné sous la relation`);
      assert.ok(mobileCard.counterTop >= mobileCard.metaBottom, `${width}px : compteur en troisième ligne`);
      const consultationCounterGap = mobileCard.counterTop - mobileCard.metaBottom;
      assert.equal(mobileCard.copyGap, "4px", `${width}px : espacement interne Consultation référent`);
      assert.equal(mobileCard.metaMargin, "0px", `${width}px : marge de relation Consultation référente`);
      assert.equal(consultationCounterGap, 4, `${width}px : espace relation/compteur Consultation référent`);
      consultationFamilySpacing.set(width, { copyGap: mobileCard.copyGap, metaMargin: mobileCard.metaMargin, counterGap: consultationCounterGap });
      await page.locator('#personPageFamily [data-family-card="partner:person-page-family"] [data-family-card-toggle]').click();
      await page.waitForFunction(() => document.querySelector('[data-family-card="partner:person-page-family"] .family-card-panel')?.hidden === false);
      await page.waitForFunction(() => {
        const svg = document.querySelector('[data-family-card="partner:person-page-family"] [data-family-card-toggle] svg');
        return svg && getComputedStyle(svg).transform.includes("-1");
      });
      const mobileOpen = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(mobileOpen <= 1, `${width}px : panneau déplié sans débordement`);
      await page.locator('#personPageFamily [data-family-card="partner:person-page-family"] [data-family-card-toggle]').click();
      await page.waitForFunction(() => document.querySelector('[data-family-card="partner:person-page-family"] .family-card-panel')?.hidden === true);
    }
    await page.setViewportSize({ width: 1280, height: 850 });

    // Parents : aucune attestation ni chevron en consultation.
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-c"]').click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Lina"));
    await page.evaluate(() => document.querySelector('[data-person-page-section="family"]').click());
    const parentsGroup = page.locator("#personPageFamily .relation-group", { hasText: "Parents" });
    assert.equal(await parentsGroup.locator(".relation-person-row").count(), 2, "deux cartes Parents");
    assert.equal(await parentsGroup.locator("[data-family-card-toggle]").count(), 0, "aucun chevron Parents en consultation");
    assert.doesNotMatch(await parentsGroup.innerText(), /attestation/, "aucun compteur d’attestation dans Parents");
    assert.equal(await parentsGroup.locator("[data-edit-family]").count(), 0, "aucune action Modifier en consultation");
    assert.equal(await parentsGroup.locator(".person-detail-relative-link").count(), 2, "en Consultation le lien nom reste indépendant");
    const parentPortraitAndName = await parentsGroup.locator(".relation-person-row").first().evaluate(row => ({
      portrait: row.querySelector(".relation-person-avatar img")?.getAttribute("src") || row.querySelector(".relation-person-avatar")?.textContent.trim(),
      linkId: row.querySelector(".person-detail-relative-link")?.dataset.openPersonPage || ""
    }));
    assert.ok(parentPortraitAndName.portrait, "portrait ou initiales du parent conservés");
    assert.ok(parentPortraitAndName.linkId, "lien existant de fiche parent conservé");
    await parentsGroup.locator(".person-detail-relative-link").first().click();
    await page.waitForFunction(() => !document.getElementById("personPageTitle").textContent.includes("Lina"));
    await page.locator("#personPageBackBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Lina"));
    await page.evaluate(() => document.querySelector('[data-person-page-section="family"]').click());
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const parentMobile = await page.evaluate(() => {
        const group = document.querySelector("#personPageFamily .relation-group");
        const rows = [...group.querySelectorAll(":scope .relation-person-row")].map(row => {
          const link = row.querySelector(".person-detail-relative-link");
          const meta = row.querySelector(".relation-person-meta");
          return {
            box: row.getBoundingClientRect(),
            relationGap: meta && link ? Math.round(meta.getBoundingClientRect().top - link.getBoundingClientRect().bottom) : null
          };
        });
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          rows: rows.map(row => ({ left: Math.round(row.box.left), right: Math.round(row.box.right), height: Math.round(row.box.height), relationGap: row.relationGap }))
        };
      });
      assert.ok(parentMobile.overflow <= 1, `${width}px : parents sans débordement`);
      assert.equal(parentMobile.rows.length, 2, `${width}px : deux lignes de parents`);
      assert.equal(parentMobile.rows[0].left, parentMobile.rows[1].left, `${width}px : lignes parents alignées`);
      assert.ok(parentMobile.rows.every(row => row.relationGap === 4), `${width}px : espacement nom/relation Parents conforme à Consultation`);
    }
    await page.setViewportSize({ width: 1280, height: 850 });

    // Modification des Parents : un bloc commun avec un seul Modifier et la dissociation de groupe.
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    const modParentGroup = page.locator("#relationsList .family-parent-group");
    assert.equal(await modParentGroup.count(), 1, "un bloc commun pour le groupe Parents");
    assert.equal(await modParentGroup.locator(".family-parent-line").count(), 2, "deux lignes compactes dans le bloc Parents");
    assert.equal(await modParentGroup.locator(".family-parent-view-link").count(), 0, "aucun lien Voir la fiche individuel");
    assert.equal(await modParentGroup.locator(".family-parent-line .person-detail-relative-link").count(), 2, "nom cliquable de chaque parent conservé");
    assert.equal(await modParentGroup.locator(".family-parent-line .relation-person-avatar img").count(), 1, "portrait réel conservé lorsqu’il existe");
    assert.equal(await modParentGroup.locator(".family-parent-actions [data-edit-family]").count(), 1, "un seul bouton Modifier dans le groupe");
    const modParentActions = modParentGroup.locator(".family-parent-actions");
    assert.equal(await modParentActions.locator('[data-edit-family="person-page-family"]').innerText(), "Modifier", "bouton Modifier explicite");
    assert.equal(await modParentActions.locator("[data-remove-child]").innerText(), "Dissocier", "libellé visible unique");
    assert.equal(await modParentActions.locator("[data-remove-child]").getAttribute("aria-label"), "Dissocier de ce groupe de parents", "nom accessible du groupe conservé");
    assert.equal(await page.locator('#relationsList [data-remove-child="person-page-family"][data-person="person-page-c"]').count(), 1, "dissociation du groupe de parents conservée");
    assert.equal(await page.locator("#relationsList .relation-actions-menu").count(), 0, "aucun menu à trois points en modification");
    assert.equal(await modParentGroup.locator(".family-parent-line [data-remove-child]").count(), 0, "aucune dissociation individuelle du parent");
    const parentBlockDesktop = await modParentGroup.evaluate(group => {
      const rows = [...group.querySelectorAll(".family-parent-line")];
      const modifierButton = group.querySelector(".family-parent-actions [data-edit-family]");
      const modifier = modifierButton.getBoundingClientRect();
      const unlink = group.querySelector(".family-parent-actions [data-remove-child]").getBoundingClientRect();
      const style = getComputedStyle(group);
      const modifierStyle = getComputedStyle(modifierButton);
      return {
        border: style.borderTopWidth,
        radius: style.borderTopLeftRadius,
        rowSeparator: getComputedStyle(rows[1]).borderTopWidth,
        paddingLeft: Number.parseFloat(style.paddingLeft),
        groupLeft: group.getBoundingClientRect().left,
        groupRight: group.getBoundingClientRect().right,
        modifierLeft: modifier.left,
        modifierRight: modifier.right,
        unlinkLeft: unlink.left,
        unlinkRight: unlink.right,
        modifierStyle: {
          height: Math.round(modifier.height),
          paddingInline: modifierStyle.paddingInlineStart,
          fontSize: modifierStyle.fontSize,
          fontWeight: modifierStyle.fontWeight,
          borderWidth: modifierStyle.borderTopWidth
        }
      };
    });
    const parentDesktopModifierStyle = parentBlockDesktop.modifierStyle;
    assert.notEqual(parentBlockDesktop.border, "0px", "contour unique autour du groupe Parents");
    assert.notEqual(parentBlockDesktop.radius, "0px", "rayon des cartes Famille conservé");
    assert.notEqual(parentBlockDesktop.rowSeparator, "0px", "séparateur entre les deux parents");
    assert.ok(parentBlockDesktop.modifierLeft < parentBlockDesktop.unlinkLeft, "Modifier avant Dissocier");
    assert.ok(parentBlockDesktop.unlinkRight <= parentBlockDesktop.groupRight + 1, "action de groupe contenue dans la carte");
    assert.ok(Math.abs(parentBlockDesktop.modifierLeft - (parentBlockDesktop.groupLeft + parentBlockDesktop.paddingLeft)) <= 2, "Modifier aligné au bord gauche du bloc Parents");
    assert.ok(parentBlockDesktop.unlinkLeft - parentBlockDesktop.modifierRight <= 12, "espacement compact entre Modifier et Dissocier");
    let parentMobileCta = null;
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const mobileParentActions = await modParentGroup.evaluate(group => {
        const style = getComputedStyle(group);
        const relationGaps = [...group.querySelectorAll(".family-parent-line")].map(line => {
          const name = line.querySelector(".person-detail-relative-link");
          const relation = line.querySelector(".relation-person-meta");
          return relation && name ? Math.round(relation.getBoundingClientRect().top - name.getBoundingClientRect().bottom) : null;
        });
        const modifier = group.querySelector(".family-parent-actions [data-edit-family]");
        const unlink = group.querySelector(".family-parent-actions [data-remove-child]");
        const mBox = modifier.getBoundingClientRect();
        const uBox = unlink.getBoundingClientRect();
        const mStyle = getComputedStyle(modifier);
        const uStyle = getComputedStyle(unlink);
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          group: group.getBoundingClientRect(),
          paddingLeft: Number.parseFloat(style.paddingLeft),
          buttons: [mBox, uBox].map(box => ({ left: Math.round(box.left), right: Math.round(box.right) })),
          relationGaps,
          modifier: { left: Math.round(mBox.left), width: Math.round(mBox.width), height: Math.round(mBox.height), fontSize: mStyle.fontSize, fontWeight: mStyle.fontWeight, borderWidth: mStyle.borderTopWidth },
          gap: Math.round(uBox.left - mBox.right),
          unlinkBorderColor: uStyle.borderTopColor
        };
      });
      assert.ok(mobileParentActions.overflow <= 1, `${width}px : bloc Parents sans débordement`);
      assert.ok(mobileParentActions.buttons.every(button => button.left >= mobileParentActions.group.left && button.right <= mobileParentActions.group.right + 1), `${width}px : actions Parents contenues`);
      assert.ok(mobileParentActions.relationGaps.every(gap => gap === 4), `${width}px : espacement nom/relation Parents identique à Consultation`);
      assert.ok(Math.abs(mobileParentActions.modifier.left - (mobileParentActions.group.left + mobileParentActions.paddingLeft)) <= 2, `${width}px : actions Parents alignées à gauche`);
      assert.ok(mobileParentActions.modifier.width < mobileParentActions.group.width / 2, `${width}px : Modifier ajusté au texte sans étirement (${mobileParentActions.modifier.width}px)`);
      assert.equal(mobileParentActions.unlinkBorderColor, "rgba(0, 0, 0, 0)", `${width}px : Dissocier Parents sans encadrement`);
      assert.ok(mobileParentActions.gap >= 4 && mobileParentActions.gap <= 12, `${width}px : espacement CTA Parents harmonisé (${mobileParentActions.gap}px)`);
      parentMobileCta = mobileParentActions;
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    await modParentActions.locator('[data-edit-family="person-page-family"]').click();
    await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open, undefined, { timeout: 5000 });
    assert.match(await page.locator("#familyDetailsTitle").innerText(), /Parents de Lina/, "formulaire de relation parent-enfant existant");
    await page.locator('#familyDetailsDialog [data-close="familyDetailsDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("familyDetailsDialog").open);
    await modParentGroup.locator(".family-parent-line .person-detail-relative-link").first().click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    await page.waitForFunction(() => !document.getElementById("personPageTitle").textContent.includes("Lina"));
    await page.locator("#personPageBackBtn").click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Lina"));

    // Modification des partenaires et enfants : panneau déplié, actions explicites, confirmations.
    await page.evaluate(() => window.__personPageTest.openDirectory());
    await page.locator('#directoryList [data-directory-person="person-page-b"]').click();
    await page.waitForFunction(() => document.getElementById("personPageTitle").textContent.includes("Carlo"));
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    assert.equal(await page.locator("#relationsList .relation-actions-menu").count(), 0, "aucun menu ⋯ en modification");
    assert.equal(await page.locator("#relationsList .life-attestation-add").count(), 0, "aucune commande d’attestation inutile en modification");
    const modChildCard = page.locator('#relationsList [data-family-card="child:person-page-family"]');
    const modChildToggle = modChildCard.locator("[data-family-card-toggle]");
    assert.equal(await modChildToggle.getAttribute("aria-expanded"), "true", "panneau enfant ouvert par défaut en Modification");
    assert.equal(await modChildCard.locator(".family-card-panel").isHidden(), false, "panneau enfant visible sans interaction");
    await page.waitForFunction(() => {
      const svg = document.querySelector('#relationsList [data-family-card="child:person-page-family"] [data-family-card-toggle] svg');
      return svg && getComputedStyle(svg).transform.includes("-1");
    });
    assert.equal(await modChildCard.locator(".family-card-aside .relation-person-attestation-count").innerText(), "2 attestations", "compteur dans l’en-tête en modification");
    const modChildPanel = modChildCard.locator(".family-card-panel");
    assert.equal(await modChildPanel.locator('[data-edit-family="person-page-family"]').innerText(), "Modifier", "Modifier enfant dans le panneau");
    const childDesktopModifierStyle = await modChildPanel.locator('[data-edit-family="person-page-family"]').evaluate(button => {
      const style = getComputedStyle(button);
      return { height: Math.round(button.getBoundingClientRect().height), paddingInline: style.paddingInlineStart, fontSize: style.fontSize, fontWeight: style.fontWeight, borderWidth: style.borderTopWidth };
    });
    assert.deepEqual(childDesktopModifierStyle, parentDesktopModifierStyle, "Modifier enfant identique à celui des Parents (desktop)");
    assert.equal(await modChildPanel.locator("[data-remove-child]").innerText(), "Dissocier", "libellé visible unique enfant");
    assert.equal(await modChildPanel.locator("[data-remove-child]").getAttribute("aria-label"), "Dissocier cet enfant", "nom accessible enfant conservé");
    assert.ok(await modChildPanel.locator("[data-view-document]").count() >= 1, "documents de naissance dans le panneau");
    await modChildPanel.locator('[data-edit-family="person-page-family"]').click();
    await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open, undefined, { timeout: 5000 });
    await page.locator('#familyDetailsDialog [data-close="familyDetailsDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("familyDetailsDialog").open);
    await page.evaluate(() => {
      const toggle = document.querySelector('#relationsList [data-family-card="child:person-page-family"] [data-family-card-toggle]');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    });
    await page.waitForFunction(() => document.querySelector('#relationsList [data-family-card="child:person-page-family"] .family-card-panel')?.hidden === false);

    await page.evaluate(() => {
      window.__familyConfirmCalls = [];
      window.__familyOriginalConfirm = window.confirm;
      window.confirm = message => { window.__familyConfirmCalls.push(message); return false; };
    });
    await page.evaluate(() => {
      const toggle = document.querySelector('#relationsList [data-family-card="child:person-page-family"] [data-family-card-toggle]');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
      document.querySelector('#relationsList [data-family-card="child:person-page-family"] [data-remove-child]').click();
    });
    const childConfirm = await page.evaluate(() => window.__familyConfirmCalls);
    assert.match(childConfirm[0] || "", /Dissocier ce lien parent-enfant/, "confirmation de dissociation enfant conservée");

    const modPartnerCard = page.locator('#relationsList [data-family-card="partner:person-page-family"]');
    assert.equal(await modPartnerCard.locator("[data-family-card-toggle]").getAttribute("aria-expanded"), "true", "panneau partenaire ouvert par défaut en Modification");
    assert.equal(await modPartnerCard.locator(".family-card-panel").isHidden(), false, "panneau partenaire visible sans interaction");
    const modPartnerPanel = modPartnerCard.locator(".family-card-panel");
    assert.equal(await modPartnerPanel.locator("[data-remove-partner]").innerText(), "Dissocier", "libellé visible unique partenaire");
    assert.equal(await modPartnerPanel.locator("[data-remove-partner]").getAttribute("aria-label"), "Dissocier ce partenaire", "nom accessible partenaire conservé");
    assert.equal(await modPartnerPanel.locator('[data-edit-family="person-page-family"]').innerText(), "Modifier", "Modifier partenaire dans le panneau");
    const partnerDesktopModifierStyle = await modPartnerPanel.locator('[data-edit-family="person-page-family"]').evaluate(button => {
      const style = getComputedStyle(button);
      return { height: Math.round(button.getBoundingClientRect().height), paddingInline: style.paddingInlineStart, fontSize: style.fontSize, fontWeight: style.fontWeight, borderWidth: style.borderTopWidth };
    });
    assert.deepEqual(partnerDesktopModifierStyle, parentDesktopModifierStyle, "Modifier partenaire identique à celui des Parents (desktop)");
    assert.doesNotMatch(await modPartnerPanel.innerText(), /Palermo/, "lieu absent du panneau Partenaires en Modification");
    await modPartnerPanel.locator('[data-edit-family="person-page-family"]').click();
    await page.waitForFunction(() => document.getElementById("familyDetailsDialog").open, undefined, { timeout: 5000 });
    assert.match(await page.locator("#familyDetailsTitle").innerText(), /Union avec/, "formulaire d’union existant");
    await page.locator('#familyDetailsDialog [data-close="familyDetailsDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("familyDetailsDialog").open);
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const mobileCtas = await page.evaluate(() => {
        const measure = (cardSelector, removeSelector) => {
          const card = document.querySelector(cardSelector);
          const cardStyle = getComputedStyle(card);
          const cardBox = card.getBoundingClientRect();
          const modifier = card.querySelector(".family-card-actions [data-edit-family]");
          const unlink = card.querySelector(`.family-card-actions ${removeSelector}`);
          const copy = card.querySelector(".relation-person-copy");
          const meta = copy.querySelector(".relation-person-meta");
          const counter = card.querySelector(".relation-person-attestation-count");
          const chevron = card.querySelector(".family-card-chevron");
          const mBox = modifier.getBoundingClientRect();
          const uBox = unlink.getBoundingClientRect();
          const mStyle = getComputedStyle(modifier);
          const uStyle = getComputedStyle(unlink);
          const copyBox = copy.getBoundingClientRect();
          const counterBox = counter.getBoundingClientRect();
          const chevronBox = chevron.getBoundingClientRect();
          return {
            cardLeft: Math.round(cardBox.left),
            cardWidth: Math.round(cardBox.width),
            paddingLeft: Number.parseFloat(cardStyle.paddingLeft),
            modifier: { left: Math.round(mBox.left), width: Math.round(mBox.width), height: Math.round(mBox.height), fontSize: mStyle.fontSize, fontWeight: mStyle.fontWeight, borderWidth: mStyle.borderTopWidth },
            unlink: { borderColor: uStyle.borderTopColor },
            gap: Math.round(uBox.left - mBox.right),
            copy: { left: Math.round(copyBox.left), right: Math.round(copyBox.right), bottom: Math.round(copyBox.bottom), gap: getComputedStyle(copy).rowGap },
            meta: { bottom: meta ? Math.round(meta.getBoundingClientRect().bottom) : null, marginTop: meta ? getComputedStyle(meta).marginTop : "" },
            counter: { left: Math.round(counterBox.left), top: Math.round(counterBox.top), tag: counter.tagName, decoration: getComputedStyle(counter).textDecorationLine },
            relationCounterGap: meta ? Math.round(counterBox.top - meta.getBoundingClientRect().bottom) : null,
            chevron: { left: Math.round(chevronBox.left), width: Math.round(chevronBox.width) },
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
          };
        };
        const footer = document.querySelector("#personPageEditHost .person-actions");
        return {
          child: measure('#relationsList [data-family-card="child:person-page-family"]', "[data-remove-child]"),
          partner: measure('#relationsList [data-family-card="partner:person-page-family"]', "[data-remove-partner]"),
          footerPresent: Boolean(footer) && footer.getBoundingClientRect().height > 0
        };
      });
      for (const [label, card] of [["enfant", mobileCtas.child], ["partenaire", mobileCtas.partner]]) {
        assert.ok(card.overflow <= 1, `${width}px : carte ${label} sans débordement`);
        assert.ok(Math.abs(card.modifier.left - (card.cardLeft + card.paddingLeft)) <= 2, `${width}px : CTA ${label} alignés à gauche`);
        assert.ok(card.modifier.width < card.cardWidth / 2, `${width}px : Modifier ${label} ajusté au texte (${card.modifier.width}px)`);
        assert.equal(card.modifier.height, parentMobileCta.modifier.height, `${width}px : hauteur Modifier ${label} identique au modèle Parents`);
        assert.equal(card.modifier.fontSize, parentMobileCta.modifier.fontSize, `${width}px : typographie Modifier ${label} identique`);
        assert.equal(card.unlink.borderColor, "rgba(0, 0, 0, 0)", `${width}px : Dissocier ${label} sans encadrement`);
        assert.ok(card.gap >= 4 && card.gap <= 12, `${width}px : espacement CTA ${label} harmonisé (${card.gap}px)`);
        assert.ok(Math.abs(card.counter.left - card.copy.left) <= 1, `${width}px : compteur ${label} aligné à gauche sous la relation`);
        assert.ok(card.counter.top >= card.copy.bottom - 1, `${width}px : compteur ${label} en troisième ligne`);
        const consultationSpacing = consultationFamilySpacing.get(width);
        assert.ok(consultationSpacing, `${width}px : espacement Consultation de référence disponible`);
        assert.equal(card.copy.gap, consultationSpacing.copyGap, `${width}px : espace nom/relation ${label} identique à Consultation`);
        assert.equal(card.meta.marginTop, consultationSpacing.metaMargin, `${width}px : marge de relation ${label} identique à Consultation`);
        assert.equal(card.relationCounterGap, consultationSpacing.counterGap, `${width}px : espace relation/compteur ${label} identique à Consultation`);
        assert.equal(card.counter.tag, "SPAN", `${width}px : compteur ${label} non cliquable`);
        assert.equal(card.counter.decoration, "none", `${width}px : compteur ${label} sans soulignement`);
        assert.ok(card.chevron.left > card.copy.right, `${width}px : chevron ${label} à droite du bloc texte`);
        assert.equal(card.chevron.width, 44, `${width}px : chevron ${label} tactile 44 px`);
      }
      assert.equal(mobileCtas.child.gap, mobileCtas.partner.gap, `${width}px : même espacement pour l’enfant et le partenaire`);
      assert.equal(mobileCtas.footerPresent, true, `${width}px : footer fixe Enregistrer/Annuler conservé`);
      /* Remise à zéro du scroller réel puis centrage : le contrôle du footer
         ne dépend pas de l'état de scroll précédent. */
      await page.evaluate(() => {
        const view = document.getElementById("personDetailView");
        let node = view?.parentElement || null;
        while (node && node !== document.documentElement) {
          const style = getComputedStyle(node);
          if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight) { node.scrollTop = 0; break; }
          node = node.parentElement;
        }
        const scroller = document.scrollingElement || document.documentElement;
        if (scroller.scrollTop > 0) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      });
      /* Centrage actif : la condition est re-vérifiée jusqu'à stabilisation
         pour ne pas dépendre du timing du scroll après un changement de taille. */
      await page.waitForFunction(() => {
        const button = document.querySelector('#relationsList [data-family-card="partner:person-page-family"] .family-card-actions [data-edit-family]');
        const footer = document.querySelector("#personPageEditHost .person-actions");
        if (!button || !footer) return false;
        button.scrollIntoView({ block: "center", behavior: "instant" });
        return button.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top + 1;
      }, undefined, { timeout: 5000 });
      const footerClearance = await page.evaluate(() => {
        const button = document.querySelector('#relationsList [data-family-card="partner:person-page-family"] .family-card-actions [data-edit-family]');
        const footer = document.querySelector("#personPageEditHost .person-actions");
        return { buttonBottom: Math.round(button.getBoundingClientRect().bottom), footerTop: Math.round(footer.getBoundingClientRect().top) };
      });
      assert.ok(footerClearance.buttonBottom <= footerClearance.footerTop + 1, `${width}px : CTA partenaire au-dessus du footer fixe (${footerClearance.buttonBottom}px / ${footerClearance.footerTop}px)`);
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.evaluate(() => {
      const toggle = document.querySelector('#relationsList [data-family-card="partner:person-page-family"] [data-family-card-toggle]');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    });
    await page.waitForFunction(() => document.querySelector('#relationsList [data-family-card="partner:person-page-family"] .family-card-panel')?.hidden === false);
    await page.evaluate(() => {
      const toggle = document.querySelector('#relationsList [data-family-card="partner:person-page-family"] [data-family-card-toggle]');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
      document.querySelector('#relationsList [data-family-card="partner:person-page-family"] [data-remove-partner]').click();
    });
    const partnerConfirm = await page.evaluate(() => window.__familyConfirmCalls);
    assert.match(partnerConfirm.at(-1) || "", /Dissocier ce partenaire/, "confirmation de dissociation partenaire conservée");
    await page.evaluate(() => { window.confirm = window.__familyOriginalConfirm; delete window.__familyOriginalConfirm; delete window.__familyConfirmCalls; });
    assert.equal(await page.locator('#relationsList [data-family-card="partner:person-page-family"]').count(), 1, "lien partenaire intact après confirmation refusée");
    assert.equal(await page.locator('#relationsList [data-family-card="child:person-page-family"]').count(), 1, "lien enfant intact après confirmation refusée");
    await page.locator('#personPageEditHost [data-close="personDialog"]').click();
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);

    // Retour systématique en haut lors du passage Consultation → Modification.
    const readPersonPageScroll = () => page.evaluate(() => {
      const view = document.getElementById("personDetailView");
      let node = view?.parentElement || null;
      let container = 0;
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight) { container = node.scrollTop; break; }
        node = node.parentElement;
      }
      return { container: Math.round(container), window: Math.round(window.scrollY || document.documentElement.scrollTop || 0) };
    });
    for (const [width, height] of [[1280, 850], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.__personPageTest.openDirectory());
      await page.locator('#directoryList [data-directory-person="person-page-a"]').click();
      await page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
      for (const [label, block, mustScroll] of [["début", "start", false], ["milieu", "center", true], ["bas", "end", true]]) {
        await page.evaluate(target => {
          const section = target === "start" ? document.getElementById("personPageIdentity")
            : target === "center" ? document.getElementById("personPageDocuments")
              : document.getElementById("personPageResearch");
          section?.scrollIntoView({ block: target, behavior: "instant" });
        }, block);
        const beforeScroll = await readPersonPageScroll();
        if (mustScroll) assert.ok(beforeScroll.container + beforeScroll.window > 0, `${width}px : fiche déjà défilée avant Modifier (${label})`);
        await page.locator("#personPageEditBtn").evaluate(button => button.click());
        await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
        const afterScroll = await readPersonPageScroll();
        assert.equal(afterScroll.container, 0, `${width}px : conteneur interne remonté en haut (${label})`);
        assert.equal(afterScroll.window, 0, `${width}px : page remontée en haut (${label})`);
        await page.locator('#personPageEditHost [data-close="personDialog"]').click();
        await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
      }
    }
    await page.setViewportSize({ width: 1280, height: 850 });

    /* Parcours détaillé : structure stable titre/compteur/chevron sur mobile. */
    await page.evaluate(() => window.__personPageTest.addJourneyLayoutFixtures());
    const desktopJourneyDisplay = await page.evaluate(() => {
      const summary = document.querySelector("#personPageDetailedJourney .life-entry > summary");
      return summary ? getComputedStyle(summary).display : null;
    });
    assert.equal(desktopJourneyDisplay, "flex", "desktop : disposition des cartes du Parcours détaillé inchangée");
    const measureJourneyCard = cardId => page.evaluate(id => {
      const card = document.querySelector(`[data-journey-id="${id}"]`);
      if (!card) return null;
      const summary = card.querySelector(".life-entry-summary");
      const title = card.querySelector(".life-entry-title");
      const counter = card.querySelector(".life-entry-attestation-count");
      const chevron = card.querySelector(".life-entry-chevron");
      const style = getComputedStyle(summary);
      const titleBox = title.getBoundingClientRect();
      const counterBox = counter.getBoundingClientRect();
      const chevronBox = chevron ? chevron.getBoundingClientRect() : null;
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        display: style.display,
        columns: style.gridTemplateColumns.split(" ").map(value => Number.parseFloat(value)),
        titleText: title.textContent.trim(),
        titleHeight: Math.round(titleBox.height),
        titleLeft: Math.round(titleBox.left),
        titleRight: Math.round(titleBox.right),
        titleBottom: Math.round(titleBox.bottom),
        counterLeft: Math.round(counterBox.left),
        counterTop: Math.round(counterBox.top),
        counterText: counter.textContent.trim(),
        counterTag: counter.tagName,
        counterDecoration: getComputedStyle(counter).textDecorationLine,
        titleWhiteSpace: getComputedStyle(title).whiteSpace,
        chevron: chevronBox ? { width: Math.round(chevronBox.width), left: Math.round(chevronBox.left) } : null,
        open: Boolean(card.querySelector("details")?.open)
      };
    }, cardId);
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const longCard = await measureJourneyCard("long-title-residence");
      assert.ok(longCard, `${width}px : carte à titre long présente`);
      assert.ok(longCard.overflow <= 1, `${width}px : carte titre long sans débordement`);
      assert.match(longCard.titleText, /Metz-sur-l'Esch-sur-Alzette-la-Grande · entre 1925 et 1931/, `${width}px : titre complet non tronqué`);
      assert.ok(longCard.titleHeight >= 30, `${width}px : titre long sur plusieurs lignes (${longCard.titleHeight}px)`);
      assert.notEqual(longCard.titleWhiteSpace, "nowrap", `${width}px : retour à la ligne du titre autorisé`);
      assert.ok(longCard.columns[1] >= 43 && longCard.columns[1] <= 45, `${width}px : colonne chevron réservée à 44 px (${longCard.columns[1]}px)`);
      assert.ok(Math.abs(longCard.titleLeft - longCard.counterLeft) <= 1, `${width}px : compteur sur l’axe du titre`);
      assert.ok(longCard.counterTop >= longCard.titleBottom, `${width}px : compteur sous le titre`);
      assert.equal(longCard.counterText, "2 attestations", `${width}px : format du compteur conservé`);
      assert.equal(longCard.counterTag, "SPAN", `${width}px : compteur non cliquable`);
      assert.equal(longCard.counterDecoration, "none", `${width}px : compteur sans soulignement`);
      assert.ok(longCard.chevron && longCard.chevron.width === 44, `${width}px : chevron tactile 44 px`);
      assert.ok(longCard.chevron.left >= longCard.titleRight, `${width}px : chevron jamais sous le titre (${longCard.chevron.left}px / ${longCard.titleRight}px)`);
      assert.equal(longCard.open, false, `${width}px : panneau titre long fermé par défaut`);

      await page.locator('[data-journey-id="long-title-residence"] > summary').click();
      await page.waitForFunction(() => document.querySelector('[data-journey-id="long-title-residence"] details')?.open === true);
      const openJourney = await page.evaluate(() => {
        const body = document.querySelector('[data-journey-id="long-title-residence"] .life-entry-body');
        return {
          bodyVisible: Boolean(body && body.getClientRects().length),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      assert.equal(openJourney.bodyVisible, true, `${width}px : panneau ouvert avec contenu`);
      assert.ok(openJourney.overflow <= 1, `${width}px : panneau ouvert sans débordement`);
      await page.locator('[data-journey-id="long-title-residence"] > summary').click();
      await page.waitForFunction(() => document.querySelector('[data-journey-id="long-title-residence"] details')?.open === false);

      const staticCard = await measureJourneyCard("static-detail-event");
      assert.ok(staticCard, `${width}px : carte sans chevron présente`);
      assert.ok(staticCard.overflow <= 1, `${width}px : carte sans chevron sans débordement`);
      assert.ok(staticCard.titleHeight <= 50, `${width}px : titre court sans troncature abusive (${staticCard.titleHeight}px)`);
      assert.ok(staticCard.titleText.length < longCard.titleText.length, `${width}px : titre court plus court que le titre long`);
      assert.equal(staticCard.chevron, null, `${width}px : aucun chevron sans contenu dépliable`);
      assert.ok(staticCard.columns[1] <= 1, `${width}px : aucune colonne réservée au chevron absent (${staticCard.columns[1]}px)`);
      assert.equal(staticCard.counterText, "0 attestation", `${width}px : compteur zéro conservé`);
      assert.ok(Math.abs(staticCard.titleLeft - staticCard.counterLeft) <= 1, `${width}px : compteur zéro sur l’axe du titre`);
    }
    await page.setViewportSize({ width: 1280, height: 850 });

    assert.deepEqual(errors, [], `aucune erreur JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});

test("WebKit mobile : contrôles Date contenus et variantes en pile dans la fiche Personne", async t => {
  let browser;
  try { browser = await webkit.launch({ headless: true }); }
  catch (error) { t.skip(`WebKit indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({
    locale: "fr-FR",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true
  });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const update = 'await updateDoc(doc(db, "people", id), data);';
      assert.ok(source.includes(update), "sauvegarde personne interceptable sans Firestore distant");
      source = source.split(update).join("await window.__personPageTest.update(id, data);");
      return route.fulfill({
        response,
        body: `${source}\n${hooks}\nwindow.__personPageWebkitHarness = { openEdit() { const item = people.find(value => value.id === "person-page-a"); item.birthDateInfo = { type: "exact", value: "1904-08-25" }; item.deathDateInfo = { type: "exact", value: "1931-07-28" }; people = people.map(value => value.id === item.id ? item : value); window.__personPageWebkitFixture = { ...item }; $("authScreen").hidden = true; renderPersonPage(item, { kind: "view", view: "directory" }); $("authScreen").hidden = true; $("personPageEditBtn").click(); }, savedDates() { const data = window.__personPageUpdates.at(-1) || {}; return { birth: data.birthDateInfo || null, death: data.deathDateInfo || null }; }, reopenSaved() { const data = window.__personPageUpdates.at(-1) || {}; const item = { ...window.__personPageWebkitFixture, ...data }; window.__personPageWebkitFixture = item; renderPersonPage(item, { kind: "view", view: "directory" }); $("authScreen").hidden = true; $("personPageEditBtn").click(); }, journeyLists() { const item = activePersonPageItem || {}; return { residences: item.residences || [], professions: item.professions || [], lifeEvents: item.lifeEvents || [] }; }, writeCount() { return (window.__personPageUpdates || []).length; }, addLegacyEvent() { const item = activePersonPageItem; const event = { id: "webkit-legacy-event", kind: "studies", label: "Études historiques", dateInfo: { type: "before", value: "1912-05-01" }, attestations: [] }; item.lifeEvents = [...(item.lifeEvents || []), event]; people = people.map(value => value.id === item.id ? item : value); renderJourneySection({ preserveForm: false }); } };`
      });
    }
    if (new URL(url).pathname.endsWith("/js/firebase-environment.js")) {
      const response = await route.fetch();
      return route.fulfill({ response, body: (await response.text()).replaceAll("192.168.1.14", "127.0.0.1") });
    }
    return isAllowedRequest(url, server.baseURL) || url.includes("gstatic.com")
      ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();
  const webkitDialogs = [];
  page.on("dialog", async dialog => { webkitDialogs.push(dialog.message()); await dialog.accept(); });
  const stageAttestation = async (year, comment, documentId = "") => {
    await page.locator("#personPageDetailedJourney [data-journey-entry-attestation-add]").evaluate(button => button.click());
    await page.waitForSelector("#personPageDetailedJourney [data-journey-attestation-save]");
    await page.locator('#personPageDetailedJourney [data-journey-date-type="year"]').evaluate(button => button.click());
    await page.fill("#journeyDateYear", String(year));
    await page.fill("#journeyAttComment", comment);
    if (documentId) {
      await page.locator(`[data-journey-document-check="${documentId}"]`).evaluate(input => {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await page.locator("#personPageDetailedJourney [data-journey-attestation-save]").evaluate(button => button.click());
    await page.waitForSelector("#personPageDetailedJourney [data-journey-entry-attestation-add]");
  };
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__personPageWebkitHarness === "object");
    await page.evaluate(() => window.__personPageTest.seed());
    await page.evaluate(() => window.__personPageWebkitHarness.openEdit());
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.evaluate(() => { document.getElementById("authScreen").hidden = true; });
    const initialVisualDates = await page.evaluate(() => ["birth", "death"].map(kind => ({
      kind,
      value: document.getElementById(`${kind}Date`).value,
      visual: document.querySelector(`[data-person-date-visual="${kind}"]`).textContent,
      visualAriaHidden: document.querySelector(`[data-person-date-visual="${kind}"]`).getAttribute("aria-hidden"),
      inputAriaHidden: document.getElementById(`${kind}Date`).getAttribute("aria-hidden"),
      labelled: Boolean(document.getElementById(`${kind}Date`).labels?.length)
    })));
    assert.deepEqual(initialVisualDates, [
      { kind: "birth", value: "1904-08-25", visual: "25 août 1904", visualAriaHidden: "true", inputAriaHidden: null, labelled: true },
      { kind: "death", value: "1931-07-28", visual: "28 juillet 1931", visualAriaHidden: "true", inputAriaHidden: null, labelled: true }
    ], "valeurs françaises initiales affichées une seule fois, le contrôle natif reste accessible");
    const nativeFocus = await page.locator("#birthDate").evaluate(input => {
      input.focus({ preventScroll: true });
      const wrapper = input.closest("[data-person-date-control]");
      return {
        focused: document.activeElement === input,
        outlineWidth: getComputedStyle(wrapper).outlineWidth,
        boxShadow: getComputedStyle(wrapper).boxShadow,
        pointerEvents: getComputedStyle(input).pointerEvents
      };
    });
    assert.equal(nativeFocus.focused, true, "le contrôle natif reste focalisable");
    assert.equal(nativeFocus.outlineWidth, "3px", "focus visible reporté sur le champ visuel");
    assert.notEqual(nativeFocus.boxShadow, "none", "indicateur de focus du champ visuel présent");
    assert.notEqual(nativeFocus.pointerEvents, "none", "le contrôle natif conserve la zone tactile");
    await page.locator("#birthDate").evaluate(input => input.blur());
    const nativeDateControlSupported = await page.locator("#birthDate").evaluate(input => input.type === "date");
    if (!nativeDateControlSupported) t.diagnostic("Ce WebKit Playwright expose input[type=date] comme text : il vérifie le layout mais ne simule pas le contrôle natif iOS.");

    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const kind of ["birth", "death"]) {
        for (const dateType of ["exact", "year", "about"]) {
          await page.locator(`#personForm [data-date-prefix="${kind}"][data-date-type="${dateType}"]`).evaluate(button => button.click());
          const measure = await page.locator(`#personForm [data-date-control="${kind}"]`).evaluate(control => {
            const group = control.parentElement;
            const date = group.querySelector(".date-value-panel:not([hidden]) .field");
            const place = group.querySelector(".life-place .field");
            const measureField = (element, frame = element, visible = element) => {
              const box = frame.getBoundingClientRect();
              const style = getComputedStyle(visible);
              const frameStyle = getComputedStyle(frame);
              return {
                left: box.left, right: box.right, width: box.width, height: box.height,
                paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
                paddingTop: style.paddingTop, paddingBottom: style.paddingBottom,
                lineHeight: style.lineHeight, textAlign: style.textAlign,
                borderRadius: frameStyle.borderTopLeftRadius, borderWidth: frameStyle.borderTopWidth,
                valueText: visible.textContent ?? element.value
              };
            };
            const visualControl = date?.closest("[data-person-date-control]");
            const visual = visualControl?.querySelector("[data-person-date-visual]") || date;
            return {
              dateId: date?.id,
              dateType: date?.type,
              dateTypeAttribute: date?.getAttribute("type"),
              date: date ? measureField(date, visualControl || date, visual) : null,
              place: measureField(place),
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              dateInputAppearance: date ? getComputedStyle(date).webkitAppearance : null,
              dateInputMinWidth: date ? getComputedStyle(date).minWidth : null,
              dateInputBoxSizing: date ? getComputedStyle(date).boxSizing : null,
              dateInputOpacity: date ? getComputedStyle(date).opacity : null,
              dateInputPointerEvents: date ? getComputedStyle(date).pointerEvents : null,
              dateInputAriaHidden: date?.getAttribute("aria-hidden") ?? null,
              dateVisualAriaHidden: visualControl?.querySelector("[data-person-date-visual]")?.getAttribute("aria-hidden") ?? null,
              dateInputTabIndex: date?.tabIndex ?? null
            };
          });
          assert.equal(measure.overflow, 0, `${width}px : ${kind}/${dateType} sans débordement horizontal`);
          assert.ok(measure.date && measure.date.width > 0, `${width}px : contrôle Date ${kind}/${dateType} visible`);
          assert.equal(Math.round(measure.date.left), Math.round(measure.place.left), `${width}px : Date ${kind}/${dateType} alignée à gauche sur Lieu`);
          assert.equal(Math.round(measure.date.right), Math.round(measure.place.right), `${width}px : Date ${kind}/${dateType} alignée à droite sur Lieu`);
          assert.ok(Math.abs(measure.date.height - measure.place.height) <= 1, `${width}px : Date ${kind}/${dateType} de même hauteur que Lieu`);
          assert.deepEqual(
            [measure.date.paddingLeft, measure.date.paddingRight, measure.date.paddingTop, measure.date.paddingBottom, measure.date.lineHeight],
            [measure.place.paddingLeft, measure.place.paddingRight, measure.place.paddingTop, measure.place.paddingBottom, measure.place.lineHeight],
            `${width}px : retrait et centrage vertical Date ${kind}/${dateType} identiques à Lieu`
          );
          assert.ok(["left", "start"].includes(measure.date.textAlign), `${width}px : contenu Date ${kind}/${dateType} aligné à gauche`);
          assert.equal(measure.date.borderRadius, measure.place.borderRadius, `${width}px : arrondi Date ${kind}/${dateType} conservé`);
          assert.equal(measure.date.borderWidth, measure.place.borderWidth, `${width}px : bordure Date ${kind}/${dateType} conservée`);
          if (dateType === "exact") {
            assert.equal(measure.dateInputAppearance, "none", `${width}px : contrôle natif préservé sous le calque visuel`);
            assert.equal(measure.dateInputOpacity, "0", `${width}px : input natif transparent mais présent`);
            assert.notEqual(measure.dateInputPointerEvents, "none", `${width}px : input natif continue de recevoir les touchers`);
            assert.equal(measure.dateInputAriaHidden, null, `${width}px : input natif reste accessible`);
            assert.equal(measure.dateVisualAriaHidden, "true", `${width}px : valeur visuelle exclue de l'annonce en double`);
            assert.ok(measure.dateInputTabIndex >= 0, `${width}px : input natif reste focalisable`);
          }
          assert.equal(measure.dateInputMinWidth, "0px", `${width}px : min-width natif maîtrisé`);
          assert.equal(measure.dateInputBoxSizing, "border-box", `${width}px : largeur calculée bordure comprise`);
          if (dateType === "exact") assert.equal(measure.dateTypeAttribute, "date", `${width}px : ${kind} garde son contrôle date natif (${measure.dateId}/${measure.dateType})`);
          else assert.equal(measure.dateType, "number", `${dateType} reste une saisie d’année`);
        }
      }

      const variants = await page.evaluate(() => {
        const add = document.querySelector("#personNameVariantsSection .person-name-variants-add");
        const type = document.getElementById("nameVariantKind").getBoundingClientRect();
        const value = document.getElementById("nameVariantValue").getBoundingClientRect();
        const button = document.getElementById("addNameVariantBtn").getBoundingClientRect();
        const box = add.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          stacked: value.top >= type.bottom - 1,
          fullWidth: Math.abs(type.left - value.left) <= 1 && Math.abs(type.right - value.right) <= 1,
          buttonCentered: Math.abs((button.left + button.right) / 2 - (box.left + box.right) / 2) <= 2,
          buttonNaturalWidth: button.width > 0 && button.width < box.width
        };
      });
      assert.equal(variants.overflow, 0, `${width}px : variantes sans débordement`);
      assert.ok(variants.stacked && variants.fullWidth, `${width}px : Type et Variante empilés sur toute la largeur`);
      assert.ok(variants.buttonCentered && variants.buttonNaturalWidth, `${width}px : Ajouter centré avec sa largeur naturelle`);
    }

    await page.evaluate(() => {
      const input = document.getElementById("nameVariantValue");
      input.value = "Arianna de Safari";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("addNameVariantBtn").click();
    });
    assert.equal(await page.locator("#personNameVariantsList .person-name-variants-item").count(), 1, "ajout de variante toujours fonctionnel");
    assert.match(await page.locator("#personNameVariantsList").innerText(), /Arianna de Safari/);
    for (const kind of ["birth", "death"]) {
      await page.locator(`#personForm [data-date-prefix="${kind}"][data-date-type="exact"]`).evaluate(button => button.click());
    }

    await page.locator("#birthDate").evaluate(input => {
      input.value = "1905-01-02";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await page.locator('[data-person-date-visual="birth"]').innerText(), "2 janvier 1905", "calque synchronisé sur input");
    await page.locator("#birthDate").evaluate(input => {
      input.value = "";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(await page.locator('[data-person-date-control="birth"]').getAttribute("class").then(value => value.includes("is-empty")), true, "effacement synchronisé au changement");
    await page.locator("#birthDate").evaluate(input => {
      input.value = "1905-01-02";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#deathDate").evaluate(input => {
      input.value = "1932-04-03";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#savePersonBtn").evaluate(button => button.click());
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden, undefined, { timeout: 10000 });
    const savedDates = await page.evaluate(() => window.__personPageWebkitHarness.savedDates());
    assert.deepEqual(savedDates, {
      birth: { type: "exact", value: "1905-01-02" },
      death: { type: "exact", value: "1932-04-03" }
    }, `dates structurées conservées à l'enregistrement : ${JSON.stringify(savedDates)}`);
    await page.evaluate(() => window.__personPageWebkitHarness.reopenSaved());
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    assert.equal(await page.inputValue("#birthDate"), "1905-01-02", "date enregistrée rechargée à la réouverture");
    assert.equal(await page.locator('[data-person-date-visual="birth"]').innerText(), "2 janvier 1905", "valeur enregistrée rechargée dans le calque visuel");
    assert.equal(await page.inputValue("#deathDate"), "1932-04-03", "date de décès enregistrée rechargée à la réouverture");
    assert.equal(await page.locator('[data-person-date-visual="death"]').innerText(), "3 avril 1932", "date de décès visuelle rechargée");

    await page.locator('#personPageEditHost [data-close="personDialog"]').evaluate(button => button.click());
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    await page.evaluate(() => window.__personPageTest.seed());
    await page.evaluate(() => window.__personPageWebkitHarness.openEdit());
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.evaluate(() => { document.getElementById("authScreen").hidden = true; });

    const tap = async selector => page.locator(selector).evaluate(element => element.click());
    const entryWrites = await page.evaluate(() => window.__personPageWebkitHarness.writeCount());
    await tap('#personPageDetailedJourney [data-journey-add="residence"]');
    await page.fill("#journeyPlace", "Orino");
    await stageAttestation(1886, "Acte de résidence", "person-page-document");
    assert.equal(await page.evaluate(() => window.__personPageWebkitHarness.writeCount()), entryWrites, "une attestation en attente ne crée aucune écriture séparée");
    assert.equal((await page.evaluate(() => window.__personPageWebkitHarness.journeyLists())).residences.length, 0, "pas d'association orpheline avant l'enregistrement de la résidence");
    await tap('#personPageDetailedJourney [data-journey-save="residence"]');
    await page.waitForFunction(() => window.__personPageWebkitHarness.journeyLists().residences.length === 1);
    let journeyLists = await page.evaluate(() => window.__personPageWebkitHarness.journeyLists());
    assert.equal(journeyLists.residences[0].attestations.length, 1, "résidence et attestation enregistrées ensemble");
    assert.deepEqual(journeyLists.residences[0].attestations[0].documentIds, ["person-page-document"], "justificatif inclus dans l'écriture unique");
    assert.equal(await page.evaluate(() => window.__personPageWebkitHarness.writeCount()), entryWrites + 1, "un seul point d'écriture pour résidence et attestation");

    const beforeCancelledProfession = await page.evaluate(() => window.__personPageWebkitHarness.writeCount());
    await tap('#personPageDetailedJourney [data-journey-add="profession"]');
    await page.fill("#journeyLabel", "Brouillon d’activité");
    await tap("#personPageDetailedJourney [data-journey-entry-attestation-add]");
    await page.waitForSelector("#personPageDetailedJourney [data-journey-attestation-save]");
    await page.locator('#personPageDetailedJourney [data-journey-date-type="year"]').evaluate(button => button.click());
    await page.fill("#journeyDateYear", "1891");
    await page.fill("#journeyAttComment", "Attestation abandonnée");
    await tap("#personPageDetailedJourney [data-journey-attestation-cancel]");
    await page.waitForFunction(() => Boolean(document.querySelector('#personPageDetailedJourney [data-journey-save="profession"]')));
    await tap("#personPageDetailedJourney [data-journey-cancel]");
    await page.waitForFunction(() => !document.querySelector("#personPageDetailedJourney [data-journey-form]"));
    journeyLists = await page.evaluate(() => window.__personPageWebkitHarness.journeyLists());
    assert.equal(journeyLists.professions.length, 0, "annulation avant l'enregistrement ne crée pas la profession ni son attestation");
    assert.equal(await page.evaluate(() => window.__personPageWebkitHarness.writeCount()), beforeCancelledProfession, "aucune écriture lors de l'annulation");
    assert.ok(webkitDialogs.some(message => /Abandonner/.test(message)), "l'abandon du brouillon est confirmé");

    const beforeProfession = await page.evaluate(() => window.__personPageWebkitHarness.writeCount());
    await tap('#personPageDetailedJourney [data-journey-add="profession"]');
    await page.fill("#journeyLabel", "Agricultrice");
    await stageAttestation(1895, "Registre professionnel");
    assert.equal(await page.evaluate(() => window.__personPageWebkitHarness.writeCount()), beforeProfession, "attestation de profession en attente sans écriture séparée");
    await tap('#personPageDetailedJourney [data-journey-save="profession"]');
    await page.waitForFunction(() => window.__personPageWebkitHarness.journeyLists().professions.length === 1);
    journeyLists = await page.evaluate(() => window.__personPageWebkitHarness.journeyLists());
    assert.equal(journeyLists.professions[0].attestations.length, 1, "profession et attestation enregistrées ensemble");
    assert.equal(await page.evaluate(() => window.__personPageWebkitHarness.writeCount()), beforeProfession + 1, "profession et attestation dans une seule écriture");
    assert.equal(await page.evaluate(() => window.__personPageWebkitHarness.writeCount()), beforeProfession + 1, "un seul point d'écriture pour profession et attestation");

    const beforeEvent = await page.evaluate(() => window.__personPageWebkitHarness.writeCount());
    await tap('#personPageDetailedJourney [data-journey-add="event"]');
    const eventKinds = await page.locator("#journeyEventKind optgroup").evaluateAll(groups => groups.map(group => group.label));
    assert.deepEqual(eventKinds, ["Religieux", "Administratif", "Migration", "Militaire", "Familial et juridique", "Autre"], "six catégories présentées comme groupes non sélectionnables");
    for (const kind of ["baptism", "census", "naturalization", "emigration", "immigration", "return", "military", "mobilization", "demobilization", "adoption", "recognition", "divorce", "separation", "other"]) {
      await page.selectOption("#journeyEventKind", kind);
      assert.equal(await page.locator("#journeyEventKind").inputValue(), kind, `${kind} sélectionnable directement`);
    }
    assert.equal(await page.locator("#journeyLabel").getAttribute("required"), "", "intitulé obligatoire pour Autre événement à la création");
    await tap('#personPageDetailedJourney [data-journey-save="event"]');
    assert.ok(await page.locator("#journeyError-label").isVisible(), "Autre événement refusé sans intitulé");
    assert.equal(await page.evaluate(() => window.__personPageWebkitHarness.writeCount()), beforeEvent, "validation sans écriture");
    await page.selectOption("#journeyEventKind", "baptism");
    assert.equal(await page.locator("#journeyLabel").getAttribute("required"), null, "intitulé facultatif pour les types prédéfinis");
    await page.fill("#journeyLabel", "Baptême d’Ada");
    await page.fill("#journeyPlace", "Orino");
    await page.locator('#personPageDetailedJourney [data-journey-date-type="year"]').evaluate(button => button.click());
    await page.fill("#journeyDateYear", "1910");
    assert.equal(await page.locator("#journeyEventShowInLifeTimeline").inputValue(), "false", "visibilité du Parcours de vie désactivée par défaut");
    assert.equal(await page.locator(".life-journey-switch").getAttribute("aria-checked"), "false", "interrupteur désactivé par défaut");
    await stageAttestation(1911, "Acte de baptême", "person-page-document");
    assert.equal(await page.inputValue("#journeyDateYear"), "1910", "les champs de l'événement sont conservés pendant l'ajout de l'attestation");
    await stageAttestation(1912, "Mention marginale");
    assert.equal(await page.evaluate(() => window.__personPageWebkitHarness.writeCount()), beforeEvent, "attestations événementielles en attente sans écriture séparée");
    await tap('#personPageDetailedJourney [data-journey-save="event"]');
    await page.waitForFunction(() => window.__personPageWebkitHarness.journeyLists().lifeEvents.length === 1);
    journeyLists = await page.evaluate(() => window.__personPageWebkitHarness.journeyLists());
    assert.equal(journeyLists.lifeEvents[0].showInLifeTimeline, false, "baptême conservé dans le Parcours détaillé sans affichage de frise");
    assert.equal(journeyLists.lifeEvents[0].attestations.length, 2, "plusieurs attestations sauvegardées avec l'événement");
    assert.deepEqual(journeyLists.lifeEvents[0].attestations[0].documentIds, ["person-page-document"]);
    assert.equal(await page.evaluate(() => window.__personPageWebkitHarness.writeCount()), beforeEvent + 1, "événement et attestations enregistrés en une seule écriture");

    await tap('#personPageEditHost [data-close="personDialog"]');
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    let timelineIds = await page.locator("#personPageTimeline [data-life-event]").evaluateAll(buttons => buttons.map(button => button.dataset.lifeEvent));
    let timelineTitles = await page.locator("#personPageTimeline .timeline-title").allTextContents();
    assert.equal(timelineIds.filter(id => id.startsWith("detailed-event-")).length, 0, "un événement désactivé reste absent de la frise");
    assert.deepEqual(timelineTitles, ["Naissance", "Mariage", "Décès"], "jalons fondamentaux présents une seule fois");

    await page.locator("#personPageEditBtn").evaluate(button => button.click());
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.locator('#personPageEditHost [data-journey-edit^="event:"]').evaluate(button => button.click());
    await page.locator(".life-journey-switch").evaluate(button => button.click());
    assert.equal(await page.locator("#journeyEventShowInLifeTimeline").inputValue(), "true", "interrupteur activé");
    assert.equal(await page.locator(".life-journey-switch").getAttribute("aria-checked"), "true", "état activé annoncé");
    const toggleTypography = await page.evaluate(() => {
      const span = document.querySelector(".life-journey-visibility-toggle > span");
      const label = document.getElementById("journeyEventKind")?.closest("label");
      const style = element => {
        const computed = getComputedStyle(element);
        return { size: computed.fontSize, weight: computed.fontWeight, color: computed.color };
      };
      return { text: span?.textContent.trim(), span: span ? style(span) : null, label: label ? style(label) : null };
    });
    assert.equal(toggleTypography.text, "Afficher dans le parcours de vie", "libellé du switch inchangé");
    assert.ok(toggleTypography.span && toggleTypography.label, "libellé du switch et libellé de champ présents");
    assert.deepEqual(toggleTypography.span, toggleTypography.label, "typographie du switch alignée sur les libellés de champ");
    await page.fill("#journeyDateYear", "1908");
    await page.fill("#journeyPlace", "Palermo");
    await tap('#personPageDetailedJourney [data-journey-save="event"]');
    await page.waitForFunction(() => window.__personPageWebkitHarness.journeyLists().lifeEvents[0]?.showInLifeTimeline === true);
    await tap('#personPageEditHost [data-close="personDialog"]');
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    timelineIds = await page.locator("#personPageTimeline [data-life-event]").evaluateAll(buttons => buttons.map(button => button.dataset.lifeEvent));
    timelineTitles = await page.locator("#personPageTimeline .timeline-title").allTextContents();
    const detailedTimelineId = timelineIds.find(id => id.startsWith("detailed-event-"));
    assert.ok(detailedTimelineId, "le baptême opt-in apparaît dans le Parcours de vie");
    assert.deepEqual(timelineTitles, ["Naissance", "Mariage", "Baptême d’Ada", "Décès"], "événement inséré selon sa date entre les jalons connus");
    assert.equal(await page.locator(`#personPageTimeline [data-life-event="${detailedTimelineId}"] .timeline-date`).innerText(), "1908", "la frise reflète la date modifiée");
    assert.equal(await page.locator("#personPageTimeline .timeline-attestation-indicator").count(), 1, "indicateur d’attestation affiché");
    assert.match(await page.locator("#personPageTimeline .timeline-attestation-indicator").innerText(), /2 attestations/, "nombre d’attestations réel");
    const webkitIndicatorAxis = await page.evaluate(() => {
      const indicator = document.querySelector("#personPageTimeline .timeline-attestation-indicator");
      if (!indicator) return null;
      const date = indicator.closest(".timeline-jalon")?.querySelector(".timeline-date");
      if (!date) return null;
      const dateBox = date.getBoundingClientRect();
      const datePadding = Number.parseFloat(getComputedStyle(date).paddingLeft);
      return {
        indicatorLeft: Math.round(indicator.getBoundingClientRect().left),
        dateTextLeft: Math.round(dateBox.left + datePadding)
      };
    });
    assert.ok(webkitIndicatorAxis, "indicateur d’attestation présent dans la frise mobile");
    assert.ok(Math.abs(webkitIndicatorAxis.indicatorLeft - webkitIndicatorAxis.dateTextLeft) <= 1, `mobile : compteur aligné sur la colonne date/lieu (${webkitIndicatorAxis.indicatorLeft} / ${webkitIndicatorAxis.dateTextLeft})`);
    const detailedTrigger = page.locator(`#personPageTimeline [data-life-event="${detailedTimelineId}"]`);
    const detailedButtonId = await detailedTrigger.getAttribute("id");
    const detailedEntryId = detailedTimelineId.replace("detailed-event-", "");

    const mobileTitleColors = await page.evaluate(() => {
      const title = document.querySelector("#personPageDetailedJourney .life-entry-title");
      const reference = document.querySelector("#personPageFamily .person-detail-relative-link");
      return {
        titleColor: title ? getComputedStyle(title).color : "absent",
        referenceColor: reference ? getComputedStyle(reference).color : "absent"
      };
    });
    assert.equal(mobileTitleColors.titleColor, "rgb(40, 75, 63)", "titre mobile en couleur de marque");
    assert.equal(mobileTitleColors.titleColor, mobileTitleColors.referenceColor, "titre mobile aligné sur les noms Parents");
    assert.equal(await detailedTrigger.locator(".timeline-icon use").getAttribute("href"), "#icon-church", "icône sémantique Baptême vers église");
    const detailedCard = page.locator(`#personPageDetailedJourney [data-journey-id="${detailedEntryId}"]`);

    // Mobile : accordéons intégrés, un seul ouvert, sans navigation parasite.
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await detailedTrigger.evaluate(button => button.click());
      await page.waitForFunction(() => {
        const open = document.querySelectorAll("#personPageTimeline .timeline-jalon.is-open");
        return open.length === 1 && open[0].querySelector(".timeline-accordion-content");
      });
      const mobileDetailed = await page.evaluate(() => {
        const open = document.querySelector("#personPageTimeline .timeline-jalon.is-open");
        const content = open?.querySelector(".timeline-accordion-content");
        const button = open?.querySelector("[data-life-event]");
        const chevron = button?.querySelector(".timeline-event-chevron");
        const list = document.querySelector("#personPageTimeline .life-timeline-list");
        const triggerText = open?.querySelector(".timeline-content");
        const contentBox = content?.getBoundingClientRect();
        const facts = content ? [...content.querySelectorAll(".life-event-primary-facts .source-detail-fact")] : [];
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          editHidden: document.getElementById("personPageEditHost").hidden,
          dialogCount: document.querySelectorAll("#lifeEventDialog").length,
          targetCount: document.querySelectorAll(".life-entry-card.is-journey-event-target").length,
          expanded: button?.getAttribute("aria-expanded"),
          contentId: content?.id,
          labelledBy: content?.getAttribute("aria-labelledby"),
          attestations: content?.querySelectorAll(".life-attestation").length || 0,
          documentLinks: content?.querySelectorAll('[data-view-document="person-page-document"]').length || 0,
          chevronTransform: chevron ? getComputedStyle(chevron).transform : "",
          iconBg: (() => { const svg = button?.querySelector(".timeline-icon"); return svg ? getComputedStyle(svg).backgroundColor : "absent"; })(),
          iconColor: (() => { const svg = button?.querySelector(".timeline-icon"); return svg ? getComputedStyle(svg).color : "absent"; })(),
          iconWidth: (() => { const svg = button?.querySelector(".timeline-icon"); return svg ? Math.round(svg.getBoundingClientRect().width) : 0; })(),
          attestationHeading: content?.querySelector(".life-event-attestations h4")?.textContent || "",
          factLabels: facts.map(fact => fact.querySelector("strong")?.textContent || ""),
          factRows: new Set(facts.map(fact => Math.round(fact.getBoundingClientRect().top))).size,
          contentLeft: contentBox ? contentBox.left : null,
          contentPadding: content ? getComputedStyle(content).paddingTop : "",
          axisLeft: list ? list.getBoundingClientRect().left + 7 : null,
          textLeft: triggerText ? triggerText.getBoundingClientRect().left : null
        };
      });
      assert.equal(mobileDetailed.overflow, 0, `${width}px : aucun débordement horizontal`);
      assert.equal(mobileDetailed.editHidden, true, `${width}px : Modification non activée`);
      assert.equal(mobileDetailed.dialogCount, 0, `${width}px : aucun volet latéral`);
      assert.equal(mobileDetailed.targetCount, 0, `${width}px : aucune navigation vers le Parcours détaillé`);
      assert.equal(mobileDetailed.expanded, "true", `${width}px : accordéon ouvert annoncé`);
      assert.ok(mobileDetailed.contentId && mobileDetailed.labelledBy === detailedButtonId, `${width}px : contenu associé au déclencheur`);
      assert.equal(mobileDetailed.attestations, 2, `${width}px : attestations affichées`);
      assert.equal(mobileDetailed.attestationHeading, "Attestations", `${width}px : titre au pluriel`);
      assert.equal(mobileDetailed.documentLinks, 1, `${width}px : document accessible`);
      assert.ok(mobileDetailed.chevronTransform.startsWith("matrix(-1"), `${width}px : chevron bas vers haut à l’ouverture`);
      assert.equal(mobileDetailed.iconBg, "rgba(0, 0, 0, 0)", `${width}px : icône sans carré plein`);
      assert.equal(mobileDetailed.iconColor, "rgb(70, 98, 122)", `${width}px : icône en bleu source`);
      assert.ok(mobileDetailed.iconWidth >= 16 && mobileDetailed.iconWidth <= 18, `${width}px : taille d’icône visible à 18 px (${mobileDetailed.iconWidth}px)`);
      assert.ok(!mobileDetailed.factLabels.includes("Date") && !mobileDetailed.factLabels.includes("Lieu"), `${width}px : date et lieu non répétés dans le panneau`);
      assert.ok(mobileDetailed.factRows <= 2, `${width}px : informations regroupées sans empilement ligne à ligne`);
      assert.ok(mobileDetailed.contentLeft > mobileDetailed.axisLeft, `${width}px : axe de la frise visible à gauche du contenu`);
      assert.ok(mobileDetailed.contentLeft < mobileDetailed.textLeft, `${width}px : contenu élargi sous le titre`);
      assert.equal(mobileDetailed.contentPadding, "12px", `${width}px : padding interne 12 px`);
      await detailedTrigger.evaluate(button => button.click());
      await page.waitForFunction(() => document.querySelectorAll("#personPageTimeline .timeline-jalon.is-open").length === 0);
      const closedChevron = await detailedTrigger.evaluate(button => getComputedStyle(button.querySelector(".timeline-event-chevron")).transform);
      assert.ok(closedChevron.startsWith("matrix(1"), `${width}px : chevron fermé pointant vers le bas`);

      await page.locator('#personPageTimeline [data-life-event="birth"]').evaluate(button => button.click());
      await page.waitForFunction(() => document.querySelectorAll("#personPageTimeline .timeline-jalon.is-open").length === 1);
      const mobileFundamental = await page.evaluate(() => ({
        openIsBirth: document.querySelector("#personPageTimeline .timeline-jalon.is-open [data-life-event]")?.dataset.lifeEvent === "birth",
        detailedOpen: document.querySelectorAll("#personPageTimeline .timeline-jalon.is-open [data-journey-event-id]").length > 0,
        text: document.querySelector("#personPageTimeline .timeline-jalon.is-open .timeline-accordion-content")?.innerText || ""
      }));
      assert.equal(mobileFundamental.openIsBirth, true, `${width}px : Naissance ouverte`);
      assert.equal(mobileFundamental.detailedOpen, false, `${width}px : seul un événement ouvert`);
      assert.doesNotMatch(mobileFundamental.text, /Naissance/, `${width}px : titre non répété dans le panneau`);
      assert.match(mobileFundamental.text, /naissance/, `${width}px : document de Naissance accessible dans le panneau`);
      await page.locator('#personPageTimeline [data-life-event="birth"]').evaluate(button => button.click());
      await page.waitForFunction(() => document.querySelectorAll("#personPageTimeline .timeline-jalon.is-open").length === 0);
    }

    // Desktop : tous les événements ouvrent le panneau intégré, sans navigation.
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await detailedTrigger.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.getElementById("personPageTimelineDetail").hidden, undefined, { timeout: 5000 });
    const desktopMetrics = await page.evaluate(id => {
      const panel = document.querySelector("#personPageTimelineDetail .person-page-timeline-detail-panel");
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        editHidden: document.getElementById("personPageEditHost").hidden,
        dialogCount: document.querySelectorAll("#lifeEventDialog").length,
        detailPanelHidden: document.getElementById("personPageTimelineDetail")?.hidden,
        targetCount: document.querySelectorAll(".life-entry-card.is-journey-event-target").length,
        panelTitle: panel?.querySelector(":scope > h4")?.textContent || "",
        panelBorder: panel ? getComputedStyle(panel).borderTopColor : "absent",
        attestations: document.querySelectorAll("#personPageTimelineDetail .life-attestation").length,
        documentLinks: document.querySelectorAll('#personPageTimelineDetail [data-view-document="person-page-document"]').length,
        primaryFactsDisplay: panel?.querySelector(".life-event-primary-facts") ? getComputedStyle(panel.querySelector(".life-event-primary-facts")).display : "absent",
        attestationHeading: panel?.querySelector(".life-event-attestations h4")?.textContent || "",
        expanded: document.querySelector(`#personPageTimeline [data-life-event="detailed-event-${id}"]`)?.getAttribute("aria-expanded"),
        icon: (() => {
          const svg = document.querySelector(`#personPageTimeline [data-life-event="detailed-event-${id}"] .timeline-icon`);
          if (!svg) return null;
          const style = getComputedStyle(svg);
          return { bg: style.backgroundColor, color: style.color, href: svg.querySelector("use")?.getAttribute("href"), width: Math.round(svg.getBoundingClientRect().width) };
        })()
      };
    }, detailedEntryId);
    assert.equal(desktopMetrics.overflow, 0, "1280px : aucun débordement horizontal");
    assert.equal(desktopMetrics.editHidden, true, "1280px : Modification non activée");
    assert.equal(desktopMetrics.dialogCount, 0, "1280px : aucun volet latéral");
    assert.equal(desktopMetrics.detailPanelHidden, false, "1280px : panneau intégré ouvert pour l’événement de vie");
    assert.equal(desktopMetrics.targetCount, 0, "1280px : aucune cible du Parcours détaillé");
    assert.equal(desktopMetrics.expanded, "true", "1280px : déclencheur annonçant le panneau");
    assert.equal(desktopMetrics.panelTitle, "Baptême d’Ada", "titre de l’événement dans le panneau");
    assert.equal(desktopMetrics.panelBorder, "rgb(70, 98, 122)", "bordure bleue #46627a pour un événement de vie");
    assert.equal(desktopMetrics.attestations, 2, "attestations affichées dans le panneau");
    assert.equal(desktopMetrics.documentLinks, 1, "document accessible depuis le panneau");
    assert.equal(desktopMetrics.primaryFactsDisplay, "flex", "date et lieu sur une ligne souple");
    assert.equal(desktopMetrics.attestationHeading, "Attestations", "titre au pluriel pour deux attestations");
    assert.ok(desktopMetrics.icon, "1280px : icône de l’événement de vie présente");
    assert.equal(desktopMetrics.icon.bg, "rgba(0, 0, 0, 0)", "1280px : icône sans carré plein");
    assert.equal(desktopMetrics.icon.color, "rgb(70, 98, 122)", "1280px : icône en bleu source");
    assert.equal(desktopMetrics.icon.href, "#icon-church", "1280px : pictogramme église");
    assert.ok(desktopMetrics.icon.width >= 14 && desktopMetrics.icon.width <= 18, `1280px : taille d’icône visible (${desktopMetrics.icon.width}px)`);
    assert.equal(await detailedCard.locator(".life-attestation").count(), 2, "attestations toujours consultables dans la carte");
    const desktopTitleColors = await page.evaluate(id => {
      const title = document.querySelector(`#personPageDetailedJourney [data-journey-id="${id}"] .life-entry-title`);
      const reference = document.querySelector("#personPageFamily .person-detail-relative-link");
      return {
        titleColor: title ? getComputedStyle(title).color : "absent",
        referenceColor: reference ? getComputedStyle(reference).color : "absent"
      };
    }, detailedEntryId);
    assert.equal(desktopTitleColors.titleColor, "rgb(40, 75, 63)", "titre du panneau : couleur de marque");
    assert.equal(desktopTitleColors.titleColor, desktopTitleColors.referenceColor, "titre du panneau aligné sur les noms Parents");
    await page.setViewportSize({ width: 390, height: 844 });

    await page.locator("#personPageEditBtn").evaluate(button => button.click());
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.locator('#personPageEditHost [data-journey-edit^="event:"]').evaluate(button => {
      button.closest(".life-entry-card").scrollIntoView({ block: "start", behavior: "instant" });
    });
    const beforeFormOpen = await page.evaluate(() => {
      const card = document.querySelector('#personPageEditHost [data-journey-edit^="event:"]').closest(".life-entry-card");
      const offset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--person-page-anchor-offset")) || 0;
      return { cardTop: Math.round(card.getBoundingClientRect().top), offset: Math.round(offset) };
    });
    assert.ok(beforeFormOpen.cardTop < beforeFormOpen.offset, `début du formulaire sous l’en-tête fixe avant ouverture (${beforeFormOpen.cardTop}px / ${beforeFormOpen.offset}px)`);
    await page.locator('#personPageEditHost [data-journey-edit^="event:"]').evaluate(button => button.click());
    await page.waitForSelector("#personPageEditHost .life-entry-editing");
    const formOpenState = await page.evaluate(() => {
      const editing = document.querySelector("#personPageEditHost .life-entry-editing");
      const offset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--person-page-anchor-offset")) || 0;
      const rect = editing.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        offset: Math.round(offset),
        titleVisible: Boolean(editing.querySelector(".life-entry-title")?.getClientRects().length),
        activeTag: document.activeElement?.tagName || ""
      };
    });
    assert.equal(formOpenState.titleVisible, true, "titre du formulaire visible sans défilement manuel");
    assert.ok(Math.abs(formOpenState.top - formOpenState.offset) <= 24, `formulaire aligné sous l’en-tête fixe (${formOpenState.top}px / ${formOpenState.offset}px)`);
    assert.ok(!["INPUT", "TEXTAREA", "SELECT"].includes(formOpenState.activeTag), "aucun clavier ouvert automatiquement");
    await page.locator(".life-journey-switch").evaluate(button => button.click());
    assert.equal(await page.locator("#journeyEventShowInLifeTimeline").inputValue(), "false", "retour à désactivé");
    assert.equal(await page.locator(".life-journey-switch").getAttribute("aria-checked"), "false", "état désactivé annoncé");
    await tap('#personPageDetailedJourney [data-journey-save="event"]');
    await page.waitForFunction(() => window.__personPageWebkitHarness.journeyLists().lifeEvents[0]?.showInLifeTimeline === false);
    journeyLists = await page.evaluate(() => window.__personPageWebkitHarness.journeyLists());
    assert.equal(journeyLists.lifeEvents.length, 1, "masquer de la frise ne supprime pas l'élément détaillé");
    assert.equal(journeyLists.lifeEvents[0].attestations.length, 2, "masquer de la frise conserve ses attestations");

    const deleteEventIndex = webkitDialogs.length;
    await page.locator('#personPageEditHost [data-journey-delete^="event:"]').evaluate(button => button.click());
    await page.waitForFunction(() => window.__personPageWebkitHarness.journeyLists().lifeEvents.length === 0);
    assert.match(webkitDialogs[deleteEventIndex] || "", /Supprimer cet événement/);
    await tap('#personPageEditHost [data-close="personDialog"]');
    await page.waitForFunction(() => document.getElementById("personPageEditHost").hidden);
    assert.equal(await page.locator('#personPageTimeline [data-life-event^="detailed-event-"]').count(), 0, "suppression retire l'événement des deux affichages");
    const webkitFamilyCounters = await page.evaluate(() => {
      const groups = [...document.querySelectorAll("#personPageFamily .relation-group")];
      const textOf = title => groups.find(group => group.querySelector("h4")?.textContent === title)?.innerText || "";
      return { partners: textOf("Partenaires et unions"), children: textOf("Enfants") };
    });
    assert.match(webkitFamilyCounters.children, /2 attestations/, "compteur de naissance de l’enfant visible en mobile");

    await page.evaluate(() => document.querySelector('[data-person-page-section="family"]').click());
    const webkitChildCard = page.locator('#personPageFamily [data-family-card="child:person-page-family"]');
    const webkitChildToggle = webkitChildCard.locator("[data-family-card-toggle]");
    assert.equal(await webkitChildToggle.getAttribute("aria-expanded"), "false", "carte enfant repliée par défaut en mobile");
    await webkitChildToggle.click();
    assert.equal(await webkitChildCard.locator(".family-card-panel").isVisible(), true, "panneau enfant déplié en mobile");
    await page.waitForFunction(() => {
      const svg = document.querySelector('#personPageFamily [data-family-card="child:person-page-family"] [data-family-card-toggle] svg');
      return svg && getComputedStyle(svg).transform.includes("-1");
    });
    const webkitFamilyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(webkitFamilyOverflow <= 1, "aucun débordement familial en mobile");
    await webkitChildToggle.click();
    assert.equal(await webkitChildCard.locator(".family-card-panel").isHidden(), true, "panneau enfant refermé en mobile");
    const webkitMilitaryIcon = await page.evaluate(() => {
      const host = document.createElement("div");
      host.className = "person-page-timeline";
      const jalon = document.createElement("div");
      jalon.className = "timeline-jalon journey-event";
      host.appendChild(jalon);
      document.getElementById("personPageFamily").appendChild(host);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "ui-icon timeline-icon");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#icon-shield-military");
      svg.appendChild(use);
      jalon.appendChild(svg);
      const box = svg.getBoundingClientRect();
      const style = getComputedStyle(svg);
      const color = style.color;
      const bg = style.backgroundColor;
      svg.remove();
      host.remove();
      return { width: Math.round(box.width), color, bg };
    });
    assert.ok(webkitMilitaryIcon.width >= 16 && webkitMilitaryIcon.width <= 18, `bouclier à 18 px en mobile (${webkitMilitaryIcon.width}px)`);
    assert.equal(webkitMilitaryIcon.color, "rgb(70, 98, 122)", "bouclier bleu source en mobile");
    assert.equal(webkitMilitaryIcon.bg, "rgba(0, 0, 0, 0)", "bouclier sans fond en mobile");
    assert.equal(await page.locator('#personPageFamily [data-family-card="partner:person-page-family"] .relation-person-attestation-count').innerText(), "0 attestation", "compteur zéro affiché sans document en mobile");

    await page.locator("#personPageEditBtn").evaluate(button => button.click());
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden);
    await page.evaluate(() => window.__personPageWebkitHarness.addLegacyEvent());
    await page.locator('#personPageDetailedJourney [data-journey-edit="event:webkit-legacy-event"]').evaluate(button => button.click());
    assert.equal(await page.locator("#journeyEventKind").inputValue(), "studies", "ancien type conservé à la réouverture");
    assert.equal(await page.locator('#journeyEventKind optgroup[label="Type historique"] option[value="studies"]').evaluate(option => option.selected), true, "ancien type proposé comme option historique sélectionnée");
    assert.equal(await page.locator('#personPageDetailedJourney [data-journey-date-type="before"]').count(), 1, "critère historique Avant affiché pour cet enregistrement");
    assert.equal(await page.locator('#personPageDetailedJourney [data-journey-date-type="before"]').evaluate(button => button.classList.contains("active")), true, "critère historique restauré");
    await tap('#personPageDetailedJourney [data-journey-save="event"]');
    await page.waitForFunction(() => window.__personPageWebkitHarness.journeyLists().lifeEvents.some(event => event.id === "webkit-legacy-event" && event.kind === "studies" && event.dateInfo?.type === "before" && event.dateInfo?.value === "1912-05-01"));

  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
