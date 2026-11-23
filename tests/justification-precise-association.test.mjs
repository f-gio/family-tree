import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { AUTH_BOOTSTRAP_PATCH, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

/* R2.2/R2.3 — Refonte UX du formulaire d'attestation :
   sélection de documents par lignes (sans case à cocher), tableau des
   associations, panneaux intégrés « Ajouter une information » et « Ajouter une
   autre personne » mutuellement exclusifs, relations familiales précises,
   états de vie à une date avec date de référence, et cycle de vie des Preuves
   rattaché à l'enregistrement de l'événement parent. */

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
      { id: "precise-a", firstName: "Ada", lastName: "Rossi", gender: "F", inTree: true, birthDateInfo: { type: "year", year: 1890 } },
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
  await page.locator(`#personAttestationDialog [data-journey-document-pick="${id}"]`).click();
}

test("attestation : documents par lignes, tableau des informations et panneaux intégrés", { timeout: 180000 }, async t => {
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

    /* Étape 4 — structure, états vides et absence des anciens contrôles. */
    assert.deepEqual(
      await page.locator("#personAttestationDialog .attestation-form-section > h4").allTextContents(),
      ["Documents justificatifs", "Informations concernées", "Commentaire"],
      "trois rubriques dans la modale"
    );
    assert.equal(await page.locator("#personAttestationDialog [data-journey-date]").count(), 0, "champ Date supprimé");
    assert.equal(await page.locator("#personAttestationDialog [data-journey-source-check]").count(), 0, "sélection de Sources supprimée");
    assert.equal(await page.locator("#personAttestationDialog [data-journey-proof-check]").count(), 0, "liste de Preuves supprimée");
    assert.equal(await page.locator("#journeyDocumentSelectionEmpty").count(), 1, "état vide des documents");
    assert.match(await page.locator("#journeyDocumentSelectionEmpty").innerText(), /Aucun document sélectionné/);
    assert.match(await page.locator("#journeyDocumentSelectionEmpty").innerText(), /Sélectionnez un document existant ou ajoutez un nouveau document/);
    assert.equal(await page.locator("#journeyAssociationListEmpty").count(), 1, "état vide des informations");
    assert.match(await page.locator("#journeyAssociationListEmpty").innerText(), /Aucune information ajoutée/);
    assert.equal(await page.locator("#journeyPanelActions [data-journey-attestation-panel-open]").count(), 2, "deux CTA d’ajout");
    assert.equal(await page.locator('[data-journey-attestation-panel-open="info"]').isDisabled(), true,
      "ajout d’information bloqué tant qu’aucun document n’est choisi");
    assert.match(await page.locator("#journeyPanelActions").innerText(), /Ajoutez au moins un document justificatif/,
      "raison du blocage affichée");

    /* Étape 5 — sélection de documents par lignes, sans case à cocher. */
    assert.equal(await page.locator("#personAttestationDialog input[type=checkbox][data-journey-document-pick]").count(), 0,
      "aucune case à cocher pour choisir un document");
    await page.locator("[data-journey-documents-toggle]").click();
    assert.equal(await page.locator("[data-journey-document-pick]").count(), 3, "documents liés proposés en lignes");
    assert.equal(await page.locator('[data-journey-document-pick="precise-doc-lib"]').count(), 0, "bibliothèque absente par défaut");
    await pickDocument(page, "precise-doc-1");
    assert.equal(await page.locator('[data-journey-document-pick="precise-doc-1"]').getAttribute("aria-pressed"), "true", "état de sélection annoncé");
    await pickDocument(page, "precise-doc-2");
    assert.equal(await page.locator("[data-journey-documents-toggle]").innerText(), "2 documents sélectionnés", "résumé du nombre de documents");
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 2, "documents choisis en lignes compactes");
    const chip = page.locator("#journeyDocumentSelection .attestation-document-chip").first();
    assert.ok(await chip.locator("[data-journey-document-view]").isVisible(), "action Consulter");
    assert.ok(await chip.locator("[data-journey-document-sheet]").isVisible(), "action Voir la fiche");
    assert.ok(await chip.locator("[data-journey-document-remove]").isVisible(), "action Retirer");
    assert.ok(await chip.locator(".attestation-doc-thumb").count() === 1, " miniature présente");
    await page.fill("#journeyDocumentSearch", "bibliothèque");
    assert.equal(await page.locator('[data-journey-document-pick="precise-doc-lib"]').count(), 1, "recherche secondaire sur la bibliothèque");
    await page.fill("#journeyDocumentSearch", "");
    assert.equal(await page.locator("[data-journey-attestation-panel-open=\"info\"]").isDisabled(), false, "l’ajout devient possible");

    /* Étapes 6/7 — tableau et panneau « Ajouter une information ». */
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 1,
      "l’association déjà enregistrée sur le document choisi est chargée sans duplication");
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Enregistrée/);
    await page.locator('[data-journey-attestation-panel-open="info"]').click();
    assert.equal(await page.locator("#journeyInfoPanel").count(), 1, "panneau d’information ouvert");
    assert.equal(await page.locator("#journeyPersonPanel").count(), 0, "les deux panneaux ne sont jamais ouverts ensemble");
    assert.equal(await page.locator("#journeyAssociationRelation option").count(), 4, "qualification propre à chaque association");
    assert.match(await page.locator("#journeySubjectChosen").innerText(), /Ada Rossi/, "personne de la fiche proposée par défaut");
    const factGroups = await page.locator("#journeyAssociationFact optgroup").evaluateAll(nodes => nodes.map(node => node.getAttribute("label")));
    assert.ok(factGroups.includes("Naissance"), "catégorie Naissance");
    assert.ok(factGroups.includes("Décès et état de vie"), "catégorie Décès et état de vie");
    assert.ok(factGroups.includes("Famille et filiation"), "catégorie Famille et filiation");
    assert.equal(await page.locator("[data-journey-reference-date]").count(), 1, "champ de date de référence présent mais masqué");
    assert.equal(await page.locator("[data-journey-reference-date]").getAttribute("hidden") !== null, true, "masqué tant qu’aucun état de vie n’est choisi");

    /* Suggestion contextuelle puis recherche globale. */
    const suggestions = await page.locator("#journeySubjectResults").innerText();
    assert.match(suggestions, /Personne actuelle/, "personne actuelle suggérée");
    assert.match(suggestions, /Conjoint/, "conjoint réellement connu suggéré");
    assert.match(suggestions, /Fils/, "enfant réellement connu suggéré");
    assert.doesNotMatch(suggestions, /Père/, "aucun parent inventé : aucun n’est renseigné");
    await page.fill("#journeyAssociationSubjectSearch", "bruno");
    await page.locator('[data-journey-subject-pick="person:precise-b"]').click();
    assert.match(await page.locator("#journeySubjectChosen").innerText(), /Bruno Bianchi/, "recherche globale sur l’arbre");

    /* Étape 9 — état de vie à une date avec date de référence. */
    await page.locator("#journeyAssociationDocument").selectOption("precise-doc-2");
    await page.locator("#journeyAssociationFact").selectOption({ label: "Vivant à cette date" });
    assert.equal(await page.locator("[data-journey-reference-date]").evaluate(block => block.hidden), false,
      "date de référence affichée pour un état de vie");
    await page.locator("[data-journey-association-add]").click();
    assert.ok(await page.locator("#journeyError-referenceDate").isVisible(), "date de référence obligatoire");
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 1, "aucune ligne ajoutée sans date de référence");
    await page.locator('#journeyInfoPanel [data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1884");
    await page.locator("[data-journey-association-add]").click();
    assert.equal(await page.locator("#journeyInfoPanel").count(), 0, "le panneau se referme après validation");
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 2, "la nouvelle ligne apparaît immédiatement");
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Vivant à cette date/);
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Confirme/);

    /* Doublon refusé. */
    await page.locator('[data-journey-attestation-panel-open="info"]').click();
    await page.fill("#journeyAssociationSubjectSearch", "");
    await page.locator('[data-journey-subject-pick="person:precise-b"]').click();
    await page.locator("#journeyAssociationDocument").selectOption("precise-doc-2");
    await page.locator("#journeyAssociationFact").selectOption({ label: "Vivant à cette date" });
    await page.locator('#journeyInfoPanel [data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1884");
    await page.locator("[data-journey-association-add]").click();
    assert.match(await page.locator("#journeyError-association").innerText(), /existe déjà/, "doublon refusé");
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 2, "aucune ligne supplémentaire");

    /* Étape 8 — panneau « Ajouter une autre personne ». */
    await page.locator("[data-journey-panel-close]").first().click();
    await page.locator('[data-journey-attestation-panel-open="person"]').click();
    assert.equal(await page.locator("#journeyPersonPanel").count(), 1, "panneau de recherche ouvert");
    assert.equal(await page.locator("#journeyInfoPanel").count(), 0, "panneaux toujours mutuellement exclusifs");
    assert.match(await page.locator("#journeyPersonResults").innerText(), /Personne actuelle/, "suggestions contextuelles");
    assert.match(await page.locator("#journeyPersonResults").innerText(), /Conjoint/, "conjoint suggéré");
    await page.fill("#journeyPersonSearch", "carlo");
    await page.locator('[data-journey-person-pick="precise-c"]').click();
    assert.match(await page.locator("#journeyPersonPreview").innerText(), /Carlo Benati/, "aperçu de la personne");
    assert.match(await page.locator("#journeyPersonPreview").innerText(), /Fils/, "relation avec la personne de la fiche");
    assert.doesNotMatch(await page.locator("#journeyPersonPreview").innerText(), /Dates\s+—/, "aucune date fabriquée pour une personne sans dates");
    await page.locator("[data-journey-person-confirm]").click();
    assert.equal(await page.locator("#journeyPersonPanel").count(), 0, "panneau refermé après confirmation");
    assert.equal(await page.locator("#journeyInfoPanel").count(), 1, "panneau d’information ouvert automatiquement");
    assert.match(await page.locator("#journeySubjectChosen").innerText(), /Carlo Benati/, "personne préremplie pour la saisie");
    await page.locator("[data-journey-panel-close]").first().click();

    /* Enregistrement : une Preuve par association explicite. */
    await page.evaluate(() => window.__preciseProofTest.reset());
    await page.fill("#journeyAttComment", "Registre communal consulté");
    await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 5000 });

    const createCalls = await page.evaluate(() => window.__preciseProofTest.createCalls);
    assert.equal(createCalls.length, 1, "une seule création : une association explicite, pas un produit cartésien");
    assert.equal(createCalls[0].data.documentId, "precise-doc-2");
    assert.equal(createCalls[0].data.relation, "supports");
    assert.deepEqual([...createCalls[0].data.personIds].sort(), ["precise-b"]);
    assert.deepEqual(createCalls[0].data.referenceDateInfo, { type: "year", year: 1884 },
      "date de référence persistée, distincte de toute date de décès");
    const writes = await page.evaluate(() => window.__preciseProofTest.writes);
    assert.equal(writes.length, 1, "attestation enregistrée");
    assert.equal(writes[0].attestations[0].date, null, "aucune date d’attestation fabriquée");
    assert.deepEqual(writes[0].attestations[0].documentIds, ["precise-doc-1", "precise-doc-2"]);
    assert.deepEqual(writes[0].attestations[0].sourceIds, [], "champ sourceIds préservé");
    assert.deepEqual(writes[0].attestations[0].proofIds, [], "champ proofIds préservé");

    /* Réouverture : association existante rechargée sans duplication. */
    await page.locator("#birthAttestationList [data-journey-attestation-edit]").first().click();
    await page.waitForFunction(() => document.getElementById("personAttestationDialog").open, undefined, { timeout: 10000 });
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 2, "documents restaurés");
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 1, "association existante rechargée une seule fois");
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Enregistrée/);

    /* Retrait contrôlé d’une association persistée. */
    await page.evaluate(() => window.__preciseProofTest.reset());
    await page.locator("#journeyAssociationList [data-journey-association-remove]").first().click();
    assert.equal(await page.locator("#journeyAssociationList tr[data-journey-association]").count(), 0, "association retirée après confirmation");
    await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 5000 });
    const deleteCalls = await page.evaluate(() => window.__preciseProofTest.deleteCalls);
    assert.equal(deleteCalls.length, 1, "un retrait confirmé appliqué à l’enregistrement");
    assert.equal(deleteCalls[0].id, "precise-proof-seed");

    /* « Voir la fiche » ouvre un nouvel onglet, sans perte de saisie. */
    await openAttestation(page);
    await page.locator("[data-journey-documents-toggle]").click();
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

    /* Accessibilité : navigation clavier sur les lignes de sélection. */
    await page.locator('[data-journey-document-pick="precise-doc-1"]').focus();
    assert.equal(await page.locator('[data-journey-document-pick="precise-doc-1"]').evaluate(el => document.activeElement === el), true,
      "ligne focalisable au clavier");

    /* Étape 2 — cycle de vie (§14.3) : rien n'est écrit tant que l'événement
       parent n'est pas définitivement enregistré. */
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
    assert.equal((await page.evaluate(() => window.__preciseProofTest.createCalls)).length, 0,
      "aucune Preuve créée pendant la préparation de l’événement");

    /* Événement parent annulé : son identifiant n'apparaît dans aucune
       écriture, donc rien n'est promu — aucune preuve orpheline. */
    const cancelled = await page.evaluate(() => window.__preciseProofTest.flush(["autre-attestation"]));
    assert.equal(cancelled, null, "aucun brouillon ne correspond à l’événement annulé");
    assert.equal((await page.evaluate(() => window.__preciseProofTest.createCalls)).length, 0,
      "annulation du parent : aucune preuve orpheline");
    assert.equal(await page.evaluate(() => window.__preciseProofTest.pending()), 1, "le brouillon n’est jamais jeté silencieusement");

    /* Événement parent enregistré : les associations sont promues une fois. */
    const flushed = await page.evaluate(() => window.__preciseProofTest.flush(["att-parente"]));
    assert.equal(flushed.created, 1, "promotion à l’enregistrement du parent");
    assert.equal(await page.evaluate(() => window.__preciseProofTest.pending()), 0, "brouillon vidé après promotion");
    assert.equal((await page.evaluate(() => window.__preciseProofTest.createCalls)).length, 1, "une seule Preuve créée");
    await page.evaluate(() => window.__preciseProofTest.flush(["att-parente"]));
    assert.equal((await page.evaluate(() => window.__preciseProofTest.createCalls)).length, 1, "aucune seconde écriture");

    assert.deepEqual(errors, [], `aucune erreur JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});
