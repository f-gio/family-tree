import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { AUTH_BOOTSTRAP_PATCH, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

/* Reproduction de la maquette interactive du formulaire d'attestation :
   deux accès documentaires (raccourci de la personne + bibliothèque),
   récapitulatif des documents, tableau des associations, panneau unique
   « Nouvelle information » avec ordre de champs imposé, relation familiale
   précisée à deux personnes, état de vie avec date de référence, et cycle de
   vie des Preuves rattaché à l'événement parent. */

const hooks = `
window.__preciseProofTest = {
  createCalls: [],
  deleteCalls: [],
  reviseCalls: [],
  writes: [],
  createOfficial(payload) {
    window.__preciseProofTest.createCalls.push(JSON.parse(JSON.stringify(payload)));
  },
  deleteOfficial(payload) {
    window.__preciseProofTest.deleteCalls.push(JSON.parse(JSON.stringify(payload)));
  },
  reviseOfficial(payload) {
    window.__preciseProofTest.reviseCalls.push(JSON.parse(JSON.stringify(payload)));
  },
  writeAttestations(kind, attestations) {
    window.__preciseProofTest.writes.push({ kind, attestations: attestations.map(item => ({ ...item })) });
  },
  setDraft(associations) {
    resetJourneyAttestationDraft({ documentIds: ["precise-doc-2"], associations });
  },
  stash(attestationId) {
    return journeyStashDraftAssociations(attestationId);
  },
  flush(attestationIds) {
    return journeyFlushDraftAssociations(attestationIds);
  },
  pending() {
    return journeyDraftAssociations.size;
  },
  professions(personId) {
    return person(personId)?.professions;
  },
  residences(personId) {
    return person(personId)?.residences;
  },
  associations() {
    return journeyAttestationDraft.associations.map(item => ({ key: item.key, existing: item.existing, pendingRevision: item.pendingRevision, sourceValue: item.sourceValue, proofId: item.proofId }));
  },
  reset() {
    window.__preciseProofTest.createCalls = [];
    window.__preciseProofTest.deleteCalls = [];
    window.__preciseProofTest.reviseCalls = [];
    window.__preciseProofTest.writes = [];
  },
  seed() {
    people = [
      {
        id: "precise-a", firstName: "Ada", lastName: "Rossi", gender: "F", inTree: true,
        birthDateInfo: { type: "year", year: 1890 }, branch: "Ramo Rossi",
        birthAttestations: [{ id: "attestation-shared-proof", documentIds: ["precise-doc-1"], proofIds: ["precise-proof-seed"] }],
        residences: [{ id: "precise-res", place: "Palermo", dateInfo: { type: "year", year: 1910 }, attestations: [] }],
        professions: [{ id: "precise-job", label: "Cartographe", dateInfo: { type: "year", year: 1912 }, attestations: [] }],
        lifeEvents: [{ id: "precise-event", kind: "census", label: "Recensement", dateInfo: { type: "year", year: 1911 }, attestations: [] }]
      },
      { id: "precise-b", firstName: "Bruno", lastName: "Bianchi", gender: "M", inTree: true },
      { id: "precise-c", firstName: "Carlo", lastName: "Benati", gender: "M", inTree: true },
      { id: "precise-d", firstName: "Zaira", lastName: "Zorini", gender: "F", inTree: true, branch: "Ramo Zorini" }
    ];
    families = [{
      id: "precise-family",
      partnerIds: ["precise-a", "precise-b"],
      childIds: ["precise-c"],
      relationType: "marriage",
      unionDateInfo: { type: "year", year: 1912 },
      endType: "none",
      endDateInfo: { type: "unknown" },
      parentChildLinks: [
        { parentId: "precise-a", childId: "precise-c", type: "biological" },
        { parentId: "precise-b", childId: "precise-c", type: "biological" }
      ]
    }];
    documents = [
      { id: "precise-doc-1", title: "Acte de naissance", type: "Acte", fileName: "acte.pdf", mimeType: "application/pdf", personIds: ["precise-a"] },
      { id: "precise-doc-2", title: "Registre communal", type: "Registre", fileName: "registre.pdf", mimeType: "application/pdf", personIds: ["precise-a"] },
      { id: "precise-doc-3", title: "Photographie de famille", type: "Photo", fileName: "photo.jpg", mimeType: "image/jpeg", personIds: ["precise-a"] },
      { id: "precise-doc-lib", title: "Bibliothèque sans lien", type: "Archive", fileName: "libre.bin", mimeType: "application/octet-stream", personIds: [] }
    ];
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    genealogyRecords = {
      sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [],
      genealogyProofs: [{
        id: "precise-proof-seed",
        data: {
          id: "precise-proof-seed",
          factId: "fact~person~precise-a~birth.date",
          factType: "person.birth.date",
          personIds: ["precise-a"],
          documentId: "precise-doc-1",
          relation: "supports",
          technicalStatus: "active",
          sourceValue: null,
          referenceDateInfo: null,
          citation: { textIt: null, translationFr: null },
          interpretation: "",
          suspension: null,
          statusHistory: []
        }
      }],
      genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [],
      genealogyProposals: [], genealogyEvents: [], genealogyNotifications: []
    };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin", displayName: "Archiviste" };
    treeCatalogState = "ready";
    $("authScreen").hidden = true;
    $("topbar").hidden = false;
    renderTree();
    setView("directory");
  }
};
`;

async function openAttestation(page) {
  if (await page.locator("#personPageEditHost").isHidden()) {
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden, undefined, { timeout: 10000 });
  }
  await page.locator("#birthAttestationControl [data-journey-attestation-add]").click();
  await page.waitForFunction(() => document.getElementById("personAttestationDialog").open, undefined, { timeout: 10000 });
}

async function pickDocument(page, id) {
  await page.locator(`#personAttestationDialog [data-journey-document-pick="${id}"]`).first().click();
}

test("maquette : deux accès documentaires, panneau unique et relations précisées", { timeout: 180000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 1280, height: 900 } });
  const errors = [];
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("https://family-tree-geonames.giovannoni-f.workers.dev/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ geonames: [{ name: "Metz", adminName2: "Moselle", adminName1: "Grand Est", countryName: "France", countryCode: "FR", geonameId: 2994160 }] }) });
    }
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const createHook = "genealogyStore.createOfficial(";
      const deleteHook = "genealogyStore.deleteOfficial(";
      const reviseHook = "await genealogyStore.reviseOfficial(";
      assert.ok(source.includes(createHook), "création officielle appelable depuis le harnais");
      assert.ok(source.includes(deleteHook), "suppression officielle appelable depuis le harnais");
      assert.ok(source.includes(reviseHook), "révision officielle appelable depuis le harnais");
      source = source.split(createHook).join("window.__preciseProofTest.createOfficial(");
      source = source.split(deleteHook).join("window.__preciseProofTest.deleteOfficial(");
      source = source.split(reviseHook).join("await window.__preciseProofTest.reviseOfficial(");
      const attestationHook = 'await updateDoc(doc(db, "people", target.id), { [field]: next });';
      assert.ok(source.includes(attestationHook), "écriture d’attestation appelable depuis le harnais");
      source = source.split(attestationHook).join('await window.__preciseProofTest.writeAttestations(target.kind, next);');
      const actorHook = "const actorUid = auth.currentUser?.uid || null;";
      assert.ok(source.includes(actorHook), "identifiant d’auteur appelable depuis le harnais");
      source = source.split(actorHook).join('const actorUid = "precise-test-admin";');
      return route.fulfill({ response, body: `${source}\n${AUTH_BOOTSTRAP_PATCH}\n${hooks}` });
    }
    return isAllowedRequest(url, server.baseURL) || url.includes("gstatic.com")
      ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  });

  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const nativeDialogs = [];
  page.on("dialog", dialog => { nativeDialogs.push(dialog.message()); dialog.accept().catch(() => {}); });
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__preciseProofTest === "object");
    await page.evaluate(() => window.__preciseProofTest.seed());
    await page.waitForFunction(() => Boolean(document.querySelector('#directoryList [data-directory-person="precise-a"]')));
    await page.locator('#directoryList [data-directory-person="precise-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, undefined, { timeout: 10000 });

    await openAttestation(page);

    /* Modale : titre, sous-titre contextuel, pied Annuler / Enregistrer. */
    assert.equal(await page.locator("#personAttestationDialogTitle").innerText(), "Ajouter une attestation");
    assert.match(await page.locator("#personAttestationDialogContext").innerText(), /Personne concernée : Ada Rossi/, "sous-titre nommant la personne concernée");
    assert.match(await page.locator("#personAttestationDialogContext").innerText(), /Naissance/, "contexte réel de l’attestation conservé");
    assert.equal(await page.locator("#personAttestationDialog .modal-actions [data-journey-attestation-cancel]").count(), 1, "Annuler dans le pied");
    assert.equal(await page.locator("#personAttestationDialog .modal-actions [data-journey-attestation-save]").count(), 1, "Enregistrer dans le pied");

    /* Trois sections numérotées, sans section supplémentaire. */
    assert.deepEqual(
      await page.locator("#personAttestationDialog .attestation-form-section > .attestation-section-head h4").allTextContents(),
      ["Documents justificatifs", "Informations concernées", "Commentaire (facultatif)"],
      "trois sections numérotées"
    );
    assert.equal(await page.locator("#personAttestationDialog .attestation-section-number").count(), 3, "trois pastilles de section");
    assert.equal(await page.locator("#personAttestationDialog .attestation-form-section").count(), 3, "aucune section supplémentaire");
    assert.equal(await page.locator("#personAttestationDialog [data-journey-date]").count(), 0, "champ Date supprimé");
    assert.equal(await page.locator("#personAttestationDialog [data-journey-source-check]").count(), 0, "sélection de Sources supprimée");
    assert.equal(await page.locator("#personAttestationDialog [data-journey-attestation-panel-open=\"person\"]").count(), 0,
      "aucun second CTA « Ajouter une autre personne »");

    /* Deux accès documentaires côte à côte, sans case à cocher. */
    const docPanels = await page.locator("#personAttestationDialog .attestation-doc-panels").evaluate(node => ({
      columns: getComputedStyle(node).gridTemplateColumns.split(" ").length,
      titles: [...node.querySelectorAll(".attestation-panel-title-row h5")].map(node2 => node2.textContent.trim())
    }));
    assert.deepEqual(docPanels.titles, ["Documents de Ada Rossi", "Rechercher dans la bibliothèque"], "titre personnalisé et deux panneaux distincts");
    assert.equal(docPanels.columns, 2, "panneaux côte à côte sur ordinateur");
    assert.equal(await page.locator("#personAttestationDialog input[type=checkbox][data-journey-document-pick]").count(), 0,
      "aucune case à cocher pour choisir un document");
    assert.equal(await page.locator("#journeyQuickDocumentList [data-journey-document-pick]").count(), 3,
      "documents réellement liés à la personne proposés en accès rapide");
    assert.doesNotMatch(await page.locator("#personAttestationDialog .attestation-doc-panel").first().innerText(), /Accès rapide/, "pastille d’accès rapide supprimée");
    assert.doesNotMatch(await page.locator("#personAttestationDialog .attestation-doc-panel").first().innerText(), /Documents déjà liés à sa fiche généalogique/,
      "description redondante du raccourci absente");
    assert.doesNotMatch(await page.locator("#personAttestationDialog .attestation-doc-panel").last().innerText(), /Retrouvez un document/,
      "description redondante de la bibliothèque absente");

    /* Bibliothèque : rien avant la saisie. */
    assert.equal(await page.locator("#journeyLibraryResults [data-journey-document-pick]").count(), 0, "aucune bibliothèque affichée par défaut");
    assert.equal((await page.locator("#journeyLibraryResults").innerText()).trim(), "", "aucun texte redondant sous le champ");
    await page.fill("#journeyDocumentSearch", "sans lien");
    assert.equal(await page.locator('#journeyLibraryResults [data-journey-document-pick="precise-doc-lib"]').count(), 1,
      "recherche sur toute la bibliothèque, même non lié");
    assert.ok(await page.locator('#journeyLibraryResults [data-journey-document-pick="precise-doc-lib"] .attestation-pick-check use[href="#icon-plus"]').count(), "pictogramme + conservé dans les résultats de bibliothèque");
    await page.fill("#journeyDocumentSearch", "zzzz");
    assert.match(await page.locator("#journeyLibraryResults").innerText(), /Aucun document ne correspond/, "résultat absent géré");
    await page.fill("#journeyDocumentSearch", "");

    /* Sélection, identité unique sur les deux parcours, récapitulatif. */
    assert.ok(await page.locator('#journeyQuickDocumentList [data-journey-document-pick="precise-doc-1"] .attestation-pick-check use[href="#icon-plus"]').count(), "icône + avant sélection dans la liste de la personne");
    await pickDocument(page, "precise-doc-1");
    assert.equal(await page.locator("#journeySelectedCount").innerText(), "1 document", "compteur du récapitulatif");
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 1, "récapitulatif distinct");
    assert.ok(await page.locator("#journeyDocumentSelection .attestation-document-open").isVisible(), "tuile entière consultable");
    assert.equal(await page.locator("#journeyDocumentSelection [data-journey-document-view] use[href='#icon-eye']").count(), 0, "aucune icône de consultation redondante");
    assert.equal(await page.locator("#journeyDocumentSelection [data-journey-document-sheet]").count(), 0, "aucun lien indépendant sur le titre");
    await page.fill("#journeyDocumentSearch", "Registre");
    assert.equal(await page.locator('#journeyLibraryResults [data-journey-document-pick="precise-doc-2"]').count(), 0,
      "un document déjà visible dans le raccourci n'est pas dupliqué dans la bibliothèque");
    await pickDocument(page, "precise-doc-2");
    assert.equal(await page.locator("#journeySelectedCount").innerText(), "2 documents");
    await page.fill("#journeyDocumentSearch", "Registre");
    assert.equal(await page.locator('#journeyQuickDocumentList [data-journey-document-pick="precise-doc-2"]').getAttribute("aria-pressed"), "true",
      "un document trouvé par les deux parcours conserve une seule identité sélectionnée");
    assert.match(await page.locator("#journeyLibraryResults").innerText(), /déjà disponible/, "le raccourci signale le document recherché déjà lié");
    await page.fill("#journeyDocumentSearch", "");
    await pickDocument(page, "precise-doc-1");
    assert.equal(await page.locator("#journeySelectedCount").innerText(), "1 document", "désélection possible");
    assert.equal(nativeDialogs.length, 0, "le retrait du document de la sélection ne déclenche pas de confirmation native");
    await pickDocument(page, "precise-doc-1");

    /* CTA d'ajout : désactivé sans document, actif avec un document. */
    assert.match(await page.locator("#journeyPanelActions").innerText(), /Ajouter une information/, "CTA d'information présent");
    assert.equal(await page.locator('[data-journey-attestation-panel-open="info"]').isDisabled(), false, "ajout possible");
    assert.ok(await page.locator("[data-journey-document-create]").isVisible(), "CTA « Ajouter un nouveau document » visible");
    assert.match(await page.locator(".attestation-or").innerText(), /OU/, "séparateur discret");

    /* Tableau et panneau unique. */
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 1, "association existante chargée");
    await page.locator('[data-journey-attestation-panel-open="info"]').click();
    assert.equal(await page.locator("#journeyInfoPanel").count(), 1, "panneau intégré ouvert");
    assert.equal(await page.locator("#journeyPersonPanel").count(), 0, "aucune modale ni panneau secondaire pour ajouter une personne");
    const labels = await page.locator("#journeyInfoPanel .attestation-field-label").allTextContents();
    assert.ok(labels.includes("Qui est concerné ?"), "champ 1");
    assert.ok(labels.includes("Quelle information est attestée ?"), "champ 2");
    assert.ok(labels.includes("Par quel document ?"), "champ 3");
    assert.ok(labels.includes("Comment le document se rapporte-t-il au fait ?"), "champ 4");
    assert.match(await page.locator("#journeyInfoPanel .attestation-field").first().innerText(), /1\./, "numéro du champ 1");
    assert.match(await page.locator("#journeyInfoPanel").innerText(), /Recherchez une personne dans l'arbre/, "aide de recherche globale");
    assert.equal(await page.locator("#journeyInfoPanel [data-journey-panel-close]").count(), 1, "une seule croix annule la saisie interne");
    assert.match(await page.locator("[data-journey-association-add]").innerText(), /Ajouter l’information/, "CTA secondaire d’ajout");
    assert.equal(await page.locator("#journeyInfoPanel [data-journey-panel-close] + button").count(), 0, "aucun CTA secondaire concurrent dans le pied du formulaire");

    /* Champ 1 : personne présélectionnée, suggestions réelles, recherche globale. */
    assert.equal(await page.locator("#journeyAssociationSubjectSearch").inputValue(), "Ada Rossi", "personne actuelle présélectionnée dans le champ unique");
    const closedSubjectResults = await page.locator("#journeySubjectResults").evaluate(node => ({ display: getComputedStyle(node).display, height: node.getBoundingClientRect().height, border: getComputedStyle(node).borderTopWidth, padding: getComputedStyle(node).paddingTop, background: getComputedStyle(node).backgroundColor }));
    assert.deepEqual(closedSubjectResults, { display: "none", height: 0, border: "0px", padding: "0px", background: "rgba(0, 0, 0, 0)" }, "aucun conteneur résiduel quand l’autocomplétion est fermée");
    await page.locator("#journeyAssociationSubjectSearch").focus();
    assert.match(await page.locator("#journeySubjectResults").innerText(), /Conjoint/, "conjoint réellement connu suggéré");
    assert.match(await page.locator("#journeySubjectResults").innerText(), /Ramo Rossi/, "branche familiale affichée dans les résultats");
    assert.equal(await page.locator("#journeySubjectResults .attestation-pick-check use[href='#icon-plus']").count(), 0, "aucun + dans la recherche de personne");
    await page.fill("#journeyAssociationSubjectSearch", "Zai");
    await page.locator('[data-journey-subject-pick="person:precise-d"]').click();
    assert.equal(await page.locator("#journeyAssociationSubjectSearch").inputValue(), "Zaira Zorini", "recherche globale et sélection d’une personne sans lien familial");
    await page.fill("#journeyAssociationSubjectSearch", "Ada");
    await page.locator('[data-journey-subject-pick="person:precise-a"]').click();
    await page.fill("#journeyAssociationSubjectSearch", "carlo");
    await page.locator('[data-journey-subject-pick="person:precise-c"]').click();
    assert.equal(await page.locator("#journeyAssociationSubjectSearch").inputValue(), "Carlo Benati", "recherche globale et sélection unique");
    await page.fill("#journeyAssociationSubjectSearch", "");
    await page.locator('[data-journey-subject-pick="person:precise-a"]').click();

    /* Champ 2 : catégories, sans identifiant technique. */
    const groups = await page.locator("#journeyAssociationFact optgroup").evaluateAll(nodes => nodes.map(node => node.getAttribute("label")));
    assert.ok(groups.includes("Identité"), "catégorie Identité");
    assert.ok(groups.includes("Naissance"), "catégorie Naissance");
    assert.ok(groups.includes("Décès et état de vie"), "catégorie Décès et état de vie");
    assert.ok(groups.includes("Famille et filiation"), "catégorie Famille et filiation");
    assert.ok(groups.includes("Résidence"), "catégorie Résidence");
    assert.ok(groups.includes("Profession"), "catégorie Profession");
    assert.ok(groups.includes("Parcours"), "catégorie Parcours");
    const factLabels = await page.locator("#journeyAssociationFact option").allTextContents();
    assert.ok(factLabels.some(label => label.includes("Est la mère de…")), "relation présentée en langage naturel");
    assert.ok(factLabels.every(label => !label.includes("~")), "aucun identifiant technique affiché");

    /* Champ 3 : uniquement les documents sélectionnés, sans préremplissage
       quand plusieurs sont retenus. */
    assert.equal(await page.locator("#journeyAssociationDocument option").count(), 2, "deux documents retenus, l’un prérempli");
    await pickDocument(page, "precise-doc-3");
    assert.equal(await page.locator("#journeyAssociationDocument option").count(), 3, "troisième document ajouté");
    await page.selectOption("#journeyAssociationDocument", "precise-doc-1");

    /* Relation familiale : deuxième personne et phrase de confirmation. */
    await page.locator("#journeyAssociationFact").selectOption({ label: "Est la mère de…" });
    assert.equal(await page.locator("[data-journey-relation-block]").evaluate(node => node.hidden), false, "bloc relation affiché");
    assert.equal(await page.locator("#journeySecondResults").evaluate(node => getComputedStyle(node).display), "none", "aucun conteneur sous la deuxième personne avant ouverture des suggestions");
    assert.match(await page.locator("[data-journey-relation-block]").innerText(), /De quelle personne\s*\?/, "recherche compacte de la deuxième personne");
    assert.doesNotMatch(await page.locator("[data-journey-relation-block]").innerText(), /Première personne/, "la première personne n’est pas redemandée");
    assert.match(await page.locator("#journeyRelationPhrase").innerText(), /Ada Rossi est la mère de Carlo Benati\./, "phrase construite avec les vraies personnes");
    /* La personne concernée est exclue des choix de seconde personne. */
    await page.fill("#journeySecondSearch", "Ada");
    assert.equal(await page.locator('[data-journey-second-pick="precise-a"]').count(), 0, "la première personne est exclue des résultats globaux");
    /* Relation absente de l’arbre : aucun identifiant n’est fabriqué. */
    await page.fill("#journeySecondSearch", "Bruno");
    await page.locator('[data-journey-second-pick="precise-b"]').click();
    assert.match(await page.locator("#journeyRelationPhrase").innerText(), /Ada Rossi est la mère de Bruno Bianchi/, "phrase affichée pour la combinaison choisie");
    await page.locator("[data-journey-association-add]").click();
    assert.match(await page.locator("#journeyError-association").innerText(), /pas enregistré dans l’arbre/, "relation non enregistrée bloquée");
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 1, "aucune ligne fabriquée");
    await page.fill("#journeySecondSearch", "Carlo");
    await page.locator('[data-journey-second-pick="precise-c"]').click();
    await page.locator("[data-journey-association-add]").click();
    assert.equal(await page.locator("#journeyInfoPanel").count(), 0, "panneau refermé après validation");
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 2, "relation enregistrée ajoutée au tableau");
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Ada Rossi est la mère de Carlo Benati\./, "l’association relationnelle restitue ses deux personnes");

    /* État de vie à une date avec date de référence. */
    await page.locator('[data-journey-attestation-panel-open="info"]').click();
    await page.locator("#journeyAssociationFact").selectOption({ label: "Vivant à cette date" });
    assert.equal(await page.locator("[data-journey-relation-block]").evaluate(node => node.hidden), true, "bloc relation masqué");
    assert.equal(await page.locator("[data-journey-reference-date]").evaluate(node => node.hidden), false, "date de référence affichée");
    await page.locator("[data-journey-association-add]").click();
    assert.ok(await page.locator("#journeyError-referenceDate").isVisible(), "date de référence obligatoire");
    await page.locator('#journeyInfoPanel [data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1884");
    await page.locator("[data-journey-association-add]").click();
    assert.equal(await page.locator("#journeyInfoPanel").count(), 0, "panneau refermé");

    /* Qualification indépendante : une seule ligne porte « Contredit ». */
    await page.locator('[data-journey-attestation-panel-open="info"]').click();
    await page.selectOption("#journeyAssociationDocument", "precise-doc-2");
    const factOptions = await page.locator("#journeyAssociationFact option").evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.textContent })));
    const birthFact = factOptions.find(option => option.label === "Date de naissance");
    assert.ok(birthFact, "fait « Date de naissance » disponible");
    await page.locator("#journeyAssociationFact").selectOption(birthFact.value);
    await page.locator('#journeyInfoPanel [data-journey-date-type="year"]').first().click();
    await page.locator("#journeyDateYear").first().fill("1890");
    await page.selectOption("#journeyAssociationRelation", "contradicts");
    await page.locator("[data-journey-association-add]").click();
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 4, "troisième association ajoutée");
    const qualifications = await page.locator("#journeyAssociationList [data-col='qualification']").allTextContents();
    assert.ok(qualifications.some(text => text.includes("Contredit")), "qualification propre à la nouvelle ligne");
    assert.ok(qualifications.some(text => text.includes("Confirme")), "qualifications des autres lignes inchangées");

    /* Une personne sans entrée professionnelle conserve la même catégorie et
       reçoit une cible documentaire sans faux événement généalogique. */
    await page.locator('[data-journey-attestation-panel-open="info"]').click();
    await page.fill("#journeyAssociationSubjectSearch", "Bruno");
    await page.locator('[data-journey-subject-pick="person:precise-b"]').click();
    const unknownProfession = await page.locator("#journeyAssociationFact option").evaluateAll(nodes => nodes.find(node => node.textContent.trim() === "Profession/activité")?.value || "");
    assert.ok(unknownProfession, "profession disponible sans événement Profession sur la fiche");
    await page.locator("#journeyAssociationFact").selectOption(unknownProfession);
    await page.fill("#journeySourceValue", "Menuisier");
    await page.locator('#journeyInfoPanel [data-journey-date-type="year"]').first().click();
    await page.locator("#journeyDateYear").first().fill("1925");
    await page.locator("[data-journey-association-add]").click();
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Profession \/ activité :[\s\S]*Menuisier 1925/, "valeur documentaire et période formulées naturellement");
    assert.equal(await page.evaluate(() => window.__preciseProofTest.professions("precise-b")), undefined, "aucun événement professionnel généalogique fabriqué");
    await page.locator('[data-journey-attestation-panel-open="info"]').click();
    const residenceFact = await page.locator("#journeyAssociationFact option").evaluateAll(nodes => nodes.find(node => node.textContent.includes("Lieu de résidence"))?.value || "");
    await page.locator("#journeyAssociationFact").selectOption(residenceFact);
    assert.equal(await page.locator("#journeyInfoPanel [data-journey-source-place]").count(), 1, "le champ de lieu documentaire utilise le composant d’autocomplétion partagé");
    await page.selectOption("#journeyAssociationDocument", "precise-doc-2");
    await page.fill("#journeySourceValue", "Metz");
    await page.locator("#journeySourceValue-suggestions .location-suggestion").waitFor({ state: "visible", timeout: 5000 });
    await page.locator("#journeySourceValue-suggestions .location-suggestion").click();
    await page.locator("[data-journey-association-add]").click();
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Metz \(FRA\)/, "le lieu choisi garde son code pays dans sourceValue");
    assert.equal(await page.evaluate(() => window.__preciseProofTest.residences("precise-b")), undefined, "aucune résidence généalogique fictive n'est créée");

    /* Doublon refusé. */
    await page.locator('[data-journey-attestation-panel-open="info"]').click();
    await page.fill("#journeyAssociationSubjectSearch", "Ada");
    await page.locator('[data-journey-subject-pick="person:precise-a"]').click();
    await page.selectOption("#journeyAssociationDocument", "precise-doc-2");
    const stillBirth = (await page.locator("#journeyAssociationFact option").evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.textContent })))).find(option => option.label === "Date de naissance");
    await page.locator("#journeyAssociationFact").selectOption(stillBirth.value);
    await page.locator('#journeyInfoPanel [data-journey-date-type="year"]').first().click();
    await page.locator("#journeyDateYear").first().fill("1890");
    await page.locator("[data-journey-association-add]").click();
    assert.match(await page.locator("#journeyError-association").innerText(), /existe déjà/, "doublon refusé");
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 6, "aucune ligne supplémentaire");
    await page.locator("[data-journey-panel-close]").first().click();

    /* Une preuve existante se corrige dans le même panneau et devient une
       révision; son historique n'est pas supprimé. */
    await page.locator("#journeyAssociationList [data-journey-association-edit]").first().click();
    assert.equal(await page.locator("#journeyAssociationSubjectSearch").inputValue(), "Ada Rossi", "édition préremplie avec la personne concernée");
    await page.locator('#journeyInfoPanel [data-journey-date-type="year"]').first().click();
    await page.locator("#journeyDateYear").first().fill("1892");
    await page.locator("[data-journey-panel-close]").first().click();
    assert.doesNotMatch(await page.locator('#journeyAssociationList [data-journey-association]').first().innerText(), /1892/, "annuler l’édition interne restaure l’association initiale");
    await page.locator("#journeyAssociationList [data-journey-association-edit]").first().click();
    await page.locator('#journeyInfoPanel [data-journey-date-type="year"]').first().click();
    await page.locator("#journeyDateYear").first().fill("1891");
    await page.locator('[data-journey-association-add]').click();
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Date de naissance :[\s\S]*1891/, "valeur documentaire modifiée immédiatement dans le brouillon");
    assert.ok(nativeDialogs.some(message => /réutilisée par une autre attestation/i.test(message)), "la modification partagée demande une décision explicite");
    assert.ok((await page.evaluate(() => window.__preciseProofTest.associations())).some(item => item.pendingRevision && item.proofId === "precise-proof-seed"), "édition persistée conservée comme révision en brouillon");

    /* Enregistrement : une Preuve par association explicite. */
    await page.evaluate(() => window.__preciseProofTest.reset());
    await page.fill("#journeyAttComment", "Registre communal consulté");
    await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 5000 });
    const createCalls = await page.evaluate(() => window.__preciseProofTest.createCalls);
    assert.equal(createCalls.length, 5, "cinq nouvelles associations, pas un produit cartésien");
    assert.ok(createCalls.some(call => call.data.sourceValue?.value === "Menuisier" && call.data.sourceValue?.dateInfo?.year === 1925), "sourceValue conserve la profession documentaire et sa période structurée");
    assert.ok(createCalls.every(call => call.type === "proof"));
    const revisionCalls = await page.evaluate(() => window.__preciseProofTest.reviseCalls);
    assert.equal(revisionCalls.length, 1, "la preuve existante est révisée sans suppression");
    assert.equal(revisionCalls[0].data.sourceValue.year, 1891, "la nouvelle révision porte la date documentaire corrigée");
    assert.ok(createCalls.some(call => call.data.referenceDateInfo && call.data.referenceDateInfo.year === 1884),
      "date de référence persistée");
    const writes = await page.evaluate(() => window.__preciseProofTest.writes);
    const writtenAttestation = writes[0].attestations.find(attestation => attestation.comment === "Registre communal consulté");
    assert.ok(writtenAttestation, "nouvelle attestation et commentaire enregistrés sans écraser l’ancienne");
    assert.deepEqual([...writtenAttestation.documentIds].sort(),
      ["precise-doc-1", "precise-doc-2", "precise-doc-3"], "trois documents retenus, sans doublon");
    assert.deepEqual(writtenAttestation.sourceIds, [], "sourceIds préservés");
    assert.deepEqual(writtenAttestation.proofIds, [], "proofIds préservés");

    /* Modification : documents et associations rechargés sans duplication. */
    await page.locator("#birthAttestationList [data-journey-attestation-edit]").last().click();
    await page.waitForFunction(() => document.getElementById("personAttestationDialog").open, undefined, { timeout: 10000 });
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 3, "documents restaurés");
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 1,
      "l’association réellement persistée est rechargée, jamais dupliquée (les créations du harnais ne sont pas écrites)");
    assert.match(await page.locator("#journeyAttComment").inputValue(), /Registre communal consulté/, "commentaire restauré");

    /* Retrait contrôlé d’une association persistée. */
    await page.evaluate(() => window.__preciseProofTest.reset());
    await page.locator("#journeyAssociationList [data-journey-association-remove]").first().click();
    await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 5000 });
    const deleteCalls = await page.evaluate(() => window.__preciseProofTest.deleteCalls);
    const removalRevisions = await page.evaluate(() => window.__preciseProofTest.reviseCalls);
    assert.equal(deleteCalls.length, 0, "le retrait ne supprime jamais définitivement la Preuve");
    assert.equal(removalRevisions.length, 0, "une Preuve partagée n’est pas archivée par le retrait d’une seule association");
    assert.ok((await page.locator("#toastMessage").innerText()).includes("preuve partagée conservée"), "la protection du partage est signalée");

    /* Cycle de vie §14.3 : rien tant que le parent n’est pas enregistré. */
    await page.evaluate(() => {
      window.__preciseProofTest.reset();
      window.__preciseProofTest.setDraft([{
        documentId: "precise-doc-2",
        factId: "fact~person~precise-b~person.death.aliveAt",
        factType: "person.death.aliveAt",
        subjectKind: "person",
        subjectId: "precise-b",
        personIds: ["precise-b"],
        familyId: null,
        relationshipId: null,
        relation: "supports",
        referenceDateInfo: { type: "year", year: 1884 },
        factLabel: "Vivant à cette date"
      }]);
      window.__preciseProofTest.stash("att-parente");
    });
    assert.equal(await page.evaluate(() => window.__preciseProofTest.pending()), 1, "association mise en attente");
    assert.equal((await page.evaluate(() => window.__preciseProofTest.createCalls)).length, 0, "aucune Preuve pendant la préparation");
    const cancelled = await page.evaluate(() => window.__preciseProofTest.flush(["autre-attestation"]));
    assert.equal(cancelled, null, "parent annulé : aucun brouillon correspondant");
    assert.equal((await page.evaluate(() => window.__preciseProofTest.createCalls)).length, 0, "aucune preuve orpheline");
    const flushed = await page.evaluate(() => window.__preciseProofTest.flush(["att-parente"]));
    assert.equal(flushed.created, 1, "promotion à l’enregistrement du parent");
    assert.equal((await page.evaluate(() => window.__preciseProofTest.createCalls)).length, 1, "une seule Preuve");

    /* Consultation depuis la tuile : parcours existant et brouillon restauré. */
    await openAttestation(page);
    await pickDocument(page, "precise-doc-3");
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 1, "document sélectionné avant l’onglet");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#journeyDocumentSelection .attestation-document-open").first().click();
    await page.waitForFunction(() => !document.getElementById("documentDetailView").hidden, undefined, { timeout: 10000 });
    assert.equal(await page.locator("#personAttestationDialog").evaluate(dialog => dialog.open), false, "le parcours de consultation existant est ouvert");
    await page.locator("#documentMobileBackBtn").click();
    await page.waitForFunction(() => document.getElementById("personAttestationDialog")?.open, undefined, { timeout: 10000 });
    assert.equal(await page.locator("#personAttestationDialog").evaluate(dialog => dialog.open), true, "formulaire rouvert au retour");
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 1, "état conservé");

    /* Accessibilité : navigation clavier sur une ligne de sélection. */
    await page.locator('#journeyQuickDocumentList [data-journey-document-pick="precise-doc-1"]').focus();
    assert.equal(await page.locator('#journeyQuickDocumentList [data-journey-document-pick="precise-doc-1"]').evaluate(el => document.activeElement === el), true,
      "ligne focalisable au clavier");

    /* Responsive : deux colonnes en desktop, panneaux empilés en tablette et
       mobile, sans débordement aux largeurs iPhone demandées. */
    for (const width of [1440, 1024, 768, 390, 375, 320]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      const responsive = await page.locator("#personAttestationDialog .attestation-doc-panels").evaluate(node => ({
        columns: getComputedStyle(node).gridTemplateColumns.split(" ").length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panelOrder: [...node.querySelectorAll(".attestation-doc-panel h5")].map(title => title.textContent.trim())
      }));
      assert.equal(responsive.columns, width <= 760 ? 1 : 2, `${width}px : disposition responsive des panneaux`);
      assert.ok(responsive.overflow <= 1, `${width}px : aucun débordement horizontal`);
      assert.deepEqual(responsive.panelOrder, ["Documents de Ada Rossi", "Rechercher dans la bibliothèque"], `${width}px : ordre des accès conservé`);
    }

    assert.deepEqual(errors, [], `aucune erreur JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});
