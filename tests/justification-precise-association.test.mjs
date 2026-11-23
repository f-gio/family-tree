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
  writes: [],
  createOfficial(payload) {
    window.__preciseProofTest.createCalls.push(JSON.parse(JSON.stringify(payload)));
  },
  deleteOfficial(payload) {
    window.__preciseProofTest.deleteCalls.push(JSON.parse(JSON.stringify(payload)));
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
  reset() {
    window.__preciseProofTest.createCalls = [];
    window.__preciseProofTest.deleteCalls = [];
    window.__preciseProofTest.writes = [];
  },
  seed() {
    people = [
      {
        id: "precise-a", firstName: "Ada", lastName: "Rossi", gender: "F", inTree: true,
        birthDateInfo: { type: "year", year: 1890 }, branch: "Ramo Rossi",
        residences: [{ id: "precise-res", place: "Palermo", dateInfo: { type: "year", year: 1910 }, attestations: [] }],
        professions: [{ id: "precise-job", label: "Cartographe", dateInfo: { type: "year", year: 1912 }, attestations: [] }],
        lifeEvents: [{ id: "precise-event", kind: "census", label: "Recensement", dateInfo: { type: "year", year: 1911 }, attestations: [] }]
      },
      { id: "precise-b", firstName: "Bruno", lastName: "Bianchi", gender: "M", inTree: true },
      { id: "precise-c", firstName: "Carlo", lastName: "Benati", gender: "M", inTree: true }
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
          sourceValue: null
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
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const createHook = "genealogyStore.createOfficial(";
      const deleteHook = "genealogyStore.deleteOfficial(";
      assert.ok(source.includes(createHook), "création officielle appelable depuis le harnais");
      assert.ok(source.includes(deleteHook), "suppression officielle appelable depuis le harnais");
      source = source.split(createHook).join("window.__preciseProofTest.createOfficial(");
      source = source.split(deleteHook).join("window.__preciseProofTest.deleteOfficial(");
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
  page.on("dialog", dialog => dialog.accept().catch(() => {}));
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
    assert.match(await page.locator("#personAttestationDialog .attestation-doc-panel").first().innerText(), /Accès rapide/, "indicateur d’accès rapide");
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
    await page.fill("#journeyDocumentSearch", "zzzz");
    assert.match(await page.locator("#journeyLibraryResults").innerText(), /Aucun document ne correspond/, "résultat absent géré");
    await page.fill("#journeyDocumentSearch", "");

    /* Sélection, identité unique sur les deux parcours, récapitulatif. */
    await pickDocument(page, "precise-doc-1");
    assert.equal(await page.locator("#journeySelectedCount").innerText(), "1 document", "compteur du récapitulatif");
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 1, "récapitulatif distinct");
    assert.ok(await page.locator("#journeyDocumentSelection .attestation-document-title-link").isVisible(), "titre cliquable pour ouvrir la fiche");
    assert.ok(await page.locator("#journeyDocumentSelection [data-journey-document-view] use[href='#icon-eye']").count(), "icône œil de consultation");
    assert.equal(await page.locator("#journeyDocumentSelection [data-journey-document-sheet]").count(), 1, "aucun bouton Voir la fiche distinct du titre");
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
    assert.match(await page.locator("#journeyInfoPanel").innerText(), /La personne actuelle est proposée par défaut/, "description du champ 1");

    /* Champ 1 : personne présélectionnée, suggestions réelles, recherche globale. */
    assert.equal(await page.locator("#journeyAssociationSubjectSearch").inputValue(), "Ada Rossi", "personne actuelle présélectionnée dans le champ unique");
    await page.locator("#journeyAssociationSubjectSearch").focus();
    assert.match(await page.locator("#journeySubjectResults").innerText(), /Conjoint/, "conjoint réellement connu suggéré");
    assert.match(await page.locator("#journeySubjectResults").innerText(), /Ramo Rossi/, "branche familiale affichée dans les résultats");
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
    assert.match(await page.locator("[data-journey-relation-block]").innerText(), /De quelle personne\s*\?/, "recherche compacte de la deuxième personne");
    assert.doesNotMatch(await page.locator("[data-journey-relation-block]").innerText(), /Première personne/, "la première personne n’est pas redemandée");
    assert.match(await page.locator("#journeyRelationPhrase").innerText(), /Ada Rossi est la mère de Carlo Benati\./, "phrase construite avec les vraies personnes");
    /* Relation incohérente : la personne elle-même. */
    await page.fill("#journeySecondSearch", "Ada");
    await page.locator('[data-journey-second-pick="precise-a"]').click();
    await page.locator("[data-journey-association-add]").click();
    assert.match(await page.locator("#journeyError-association").innerText(), /deux personnes différentes/, "relation refusée avec soi-même");
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
    await page.selectOption("#journeyAssociationRelation", "contradicts");
    await page.locator("[data-journey-association-add]").click();
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 4, "troisième association ajoutée");
    const qualifications = await page.locator("#journeyAssociationList [data-col='qualification']").allTextContents();
    assert.ok(qualifications.some(text => text.includes("Contredit")), "qualification propre à la nouvelle ligne");
    assert.ok(qualifications.some(text => text.includes("Confirme")), "qualifications des autres lignes inchangées");

    /* Doublon refusé. */
    await page.locator('[data-journey-attestation-panel-open="info"]').click();
    await page.selectOption("#journeyAssociationDocument", "precise-doc-2");
    const stillBirth = (await page.locator("#journeyAssociationFact option").evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.textContent })))).find(option => option.label === "Date de naissance");
    await page.locator("#journeyAssociationFact").selectOption(stillBirth.value);
    await page.locator("[data-journey-association-add]").click();
    assert.match(await page.locator("#journeyError-association").innerText(), /existe déjà/, "doublon refusé");
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 4, "aucune ligne supplémentaire");
    await page.locator("[data-journey-panel-close]").first().click();

    /* Enregistrement : une Preuve par association explicite. */
    await page.evaluate(() => window.__preciseProofTest.reset());
    await page.fill("#journeyAttComment", "Registre communal consulté");
    await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 5000 });
    const createCalls = await page.evaluate(() => window.__preciseProofTest.createCalls);
    assert.equal(createCalls.length, 3, "trois nouvelles associations, pas un produit cartésien");
    assert.ok(createCalls.every(call => call.type === "proof"));
    assert.ok(createCalls.some(call => call.data.referenceDateInfo && call.data.referenceDateInfo.year === 1884),
      "date de référence persistée");
    const writes = await page.evaluate(() => window.__preciseProofTest.writes);
    assert.equal(writes[0].attestations[0].comment, "Registre communal consulté", "commentaire enregistré");
    assert.deepEqual([...writes[0].attestations[0].documentIds].sort(),
      ["precise-doc-1", "precise-doc-2", "precise-doc-3"], "trois documents retenus, sans doublon");
    assert.deepEqual(writes[0].attestations[0].sourceIds, [], "sourceIds préservés");
    assert.deepEqual(writes[0].attestations[0].proofIds, [], "proofIds préservés");

    /* Modification : documents et associations rechargés sans duplication. */
    await page.locator("#birthAttestationList [data-journey-attestation-edit]").first().click();
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
    assert.equal(deleteCalls.length, 1, "un retrait confirmé appliqué à l’enregistrement");
    assert.equal(deleteCalls[0].id, "precise-proof-seed");

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

    /* « Voir la fiche » : nouvel onglet, formulaire intact. */
    await openAttestation(page);
    await pickDocument(page, "precise-doc-3");
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 1, "document sélectionné avant l’onglet");
    const popupPromise = page.waitForEvent("popup");
    await page.locator("[data-journey-document-sheet]").first().click();
    const popup = await popupPromise;
    await popup.waitForURL(/view=documentDetail/, { timeout: 15000 });
    assert.match(popup.url(), /id=precise-doc/, "identifiant du document dans l’URL");
    await popup.close().catch(() => {});
    assert.equal(await page.locator("#personAttestationDialog").evaluate(dialog => dialog.open), true, "formulaire ouvert après l’onglet");
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
