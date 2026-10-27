import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { startStaticServer, ROOT } from "./helpers.mjs";

/* Parcours réels du formulaire guidé de Preuve (lot 2A) sous émulateur :
   création depuis une fiche Personne, depuis un document, document sans
   transcription, validation et écriture réelle dans Firestore (émulateur local).
   Exécution : npm run test:firestore-like — nécessite FIRESTORE_EMULATOR_HOST. */

const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

function injectProbe(page) {
  const bootstrap = `const appModule = await import("https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js");
    const fsModule = await import("https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js");
    const authModule = await import("https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js");
    const app = appModule.getApps().find(item => item.name === "proof-probe") || appModule.initializeApp({ apiKey: "local-emulator-only", projectId: "family-tree-emulator-test" }, "proof-probe");
    const db = fsModule.getFirestore(app);
    fsModule.connectFirestoreEmulator(db, "127.0.0.1", 8080);
    const auth = authModule.getAuth(app);
    authModule.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    await authModule.signInWithEmailAndPassword(auth, "admin-proof@example.test", "MotDePasseTest1!");`;
  return {
    setup: () => page.evaluate(async bootstrapCode => {
      const run = new Function("return (async () => {" + bootstrapCode +
        "await fsModule.setDoc(fsModule.doc(db, 'people/person-probe'), { firstName: 'Ada', middleName: '', lastName: 'Probe', birthDate: '', deathDate: '', place: '', partnerIds: [], childIds: [], treeId: null });" +
        "await fsModule.setDoc(fsModule.doc(db, 'people/person-probe2'), { firstName: 'Grace', middleName: '', lastName: 'Probe', birthDate: '', deathDate: '', place: '', partnerIds: [], childIds: [], treeId: null });" +
        "await fsModule.setDoc(fsModule.doc(db, 'documents/doc-probe2'), { title: 'Cadastre probe', type: 'Cadastre', date: '1888-06-01', place: '', personIds: ['person-probe2'], notes: '', fileName: 'cadastre.html', mimeType: 'text/html', externalUrl: 'https://example.invalid/cadastre', chunkCount: 0 });" +
        "await fsModule.setDoc(fsModule.doc(db, 'documents/doc-probe'), { title: 'Registre probe', type: 'Registre', date: '1901-04-12', place: '', personIds: ['person-probe', 'person-probe2'], notes: '', fileName: 'registre.html', mimeType: 'text/html', externalUrl: 'https://example.invalid/registre', chunkCount: 0, pages: [{ id: 'page-1', label: 'Folio 1' }] });" +
        "})()");
      await run();
    }, bootstrap),
    createOfficial: payload => page.evaluate(async ({ bootstrapCode, officialPayload }) => {
      const run = new Function("officialPayload", "return (async () => {" + bootstrapCode +
        "const storeModule = await import(new URL('./js/genealogy-collaboration-firestore.js', location.href));" +
        "const store = storeModule.createGenealogyCollaborationStore(db, { doc: fsModule.doc, runTransaction: fsModule.runTransaction, serverTimestamp: fsModule.serverTimestamp, collection: fsModule.collection, query: fsModule.query, where: fsModule.where, getDocs: fsModule.getDocs });" +
        "return store.createOfficial({ ...officialPayload, actorUid: auth.currentUser.uid });})()");
      return run(officialPayload);
    }, { bootstrapCode: bootstrap, officialPayload: payload }),
    count: collectionName => page.evaluate(async ({ bootstrapCode, collectionPath }) => {
      const run = new Function("return (async () => {" + bootstrapCode +
        "const snap = await fsModule.getDocs(fsModule.collection(db, " + JSON.stringify(collectionPath) + ")); return snap.size;})()");
      return run();
    }, { bootstrapCode: bootstrap, collectionPath: collectionName }),
    list: collectionName => page.evaluate(async ({ bootstrapCode, collectionPath }) => {
      const run = new Function("return (async () => {" + bootstrapCode +
        "const snap = await fsModule.getDocs(fsModule.collection(db, " + JSON.stringify(collectionPath) + ")); return JSON.stringify(snap.docs.map(d => ({ id: d.id, data: d.data() })));})()");
      return run();
    }, { bootstrapCode: bootstrap, collectionPath: collectionName })
  };
}

test("créations réelles du formulaire guidé de preuve (émulateur)", { timeout: 240000 }, async t => {
  if (!hasEmulator) return t.skip("émulateur Firestore requis (FIRESTORE_EMULATOR_HOST absent)");
  const server = await startStaticServer(ROOT);
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => { pageErrors.push(error.message.slice(0, 160)); console.log("PAGEERROR: " + error.message.slice(0, 200)); });

    await page.goto(server.baseURL, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#authScreen", { timeout: 15000 });

    // --- Inscription du premier compte : devient primaryAdmin approuvé (bootstrap) ---
    await page.evaluate(() => { const switchPanel = document.getElementById("signupSwitch"); if (switchPanel) switchPanel.hidden = false; });
    await page.click("#showSignupBtn");
    await page.fill("#signupEmail", "admin-proof@example.test");
    await page.fill("#signupPassword", "MotDePasseTest1!");
    await page.fill("#signupPasswordConfirm", "MotDePasseTest1!");
    await page.click("#signupForm button[type=submit]");
    await page.waitForSelector("#appMain:not([hidden])", { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById("adminBtn") && !document.getElementById("adminBtn").hidden, { timeout: 15000 });

    // --- Données de test isolées (émulateur uniquement) ---
    const probe = injectProbe(page);
    await probe.setup();
    await page.waitForTimeout(1200);

    const proofSubmitState = async () => {
      await page.click("#genealogyContributionSubmitBtn");
      await page.waitForTimeout(700);
      return page.evaluate(() => {
        const invalid = document.querySelector("#genealogyContributionForm :invalid");
        return {
          open: document.getElementById("genealogyContributionDialog").open,
          invalid: invalid ? { id: invalid.id || invalid.tagName, required: invalid.required, hidden: !!invalid.closest("[hidden]") } : null,
          errors: [...document.querySelectorAll("#genealogyOfficialProofFields .field-error")].filter(el => !el.hidden).map(el => el.textContent).slice(0, 3),
          submitBusy: document.getElementById("genealogyContributionSubmitBtn").disabled
        };
      });
    };

    const closeResidualDialogs = () => page.evaluate(() => {
      for (const id of ["genealogyContributionDialog", "personDialog", "documentViewerDialog", "genealogyItemDialog"]) {
        const dialog = document.getElementById(id);
        if (dialog?.open) dialog.close();
      }
    });

    const openProofDialogFromPerson = async () => {
      // Remise à zéro des résidus de test : aucun dialogue ne doit rester ouvert d'un sous-test à l'autre.
      await closeResidualDialogs();
      await page.waitForTimeout(300);
      await page.click('.nav-btn[data-view="directory"]');
      await page.waitForSelector("#directoryList", { timeout: 10000 });
      const cardCount = await page.locator("#directoryList .content-card, #directoryList article, #directoryList [role=group]").count();
      const cardText = await page.locator("#directoryList").innerText().catch(() => "");
      const adaCard = page.locator("#directoryList").getByText("Probe", { exact: false }).first();
      if (!(await adaCard.count())) {
        const peopleCount = await probe.count("people");
        throw new Error(`carte introuvable (cartes=${cardCount}, personnes injectées=${peopleCount}, répertoire="${cardText.slice(0, 200)}")`);
      }
      await adaCard.click();
      await page.waitForSelector("#personDialog[open]", { timeout: 10000 });
      await page.click('[data-person-section="documents"]');
      await page.waitForSelector("#genealogyProposeProofForPersonBtn", { state: "visible", timeout: 10000 });
      const label = (await page.locator("#proofEntryPointLabel").textContent()).trim();
      await page.click("#genealogyProposeProofForPersonBtn");
      await page.waitForSelector("#genealogyContributionDialog[open]", { timeout: 10000 });
      return label;
    };

    await t.test("1. fiche Personne : bouton, préremplissage et création réelle", async () => {
      const label = await openProofDialogFromPerson();
      assert.equal(label, "Ajouter une preuve", "libellé administrateur");
      const title = await page.locator("#genealogyContributionTitle").textContent();
      assert.equal(title, "Créer une preuve", "titre officiel");
      assert.ok(await page.locator("#genealogyOfficialProofFields").isVisible(), "formulaire guidé visible");
      assert.ok(!(await page.locator("#genealogyContributionPayload").isVisible()), "aucun champ JSON visible");
      const personChip = await page.locator("#genealogySourcePersonSelection").textContent();
      assert.match(personChip, /Probe/, "personne pré-sélectionnée");
      // validation : type + valeur manquants → erreurs sous champs
      await page.click("#genealogyContributionSubmitBtn");
      assert.ok(await page.locator("#proofError-factKind").isVisible(), "erreur de type de fait affichée");
      assert.ok(await page.locator("#proofError-sourceValue").isVisible(), "erreur de valeur affichée");
      assert.ok(await page.locator("#genealogyContributionDialog[open]"), "dialogue conservé après erreur");
      // complétion et création
      await page.selectOption("#proofFactKind", "death");
      await page.click("#genealogySourceDocumentSearch");
      await page.fill("#genealogySourceDocumentSearch", "Registre");
      await page.locator('[data-genealogy-source-document="doc-probe"]').check();
      await page.fill("#proofSourceValue", "Ada Probe, décédée en 1901");
      await page.click("#genealogyContributionSubmitBtn");
      await page.waitForSelector("#genealogyContributionDialog[open]", { state: "detached", timeout: 15000 }).catch(() => {});
      await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open, { timeout: 15000 });
      await page.waitForTimeout(800);
      assert.equal(await probe.count("genealogyProofs"), 1, "preuve réellement créée");
      assert.equal(await probe.count("genealogyProofRevisions"), 1, "révision immuable créée");
      assert.equal(await probe.count("genealogyEvents"), 1, "événement d'historique créé");
    });

    await t.test("2. document : préremplissage et création depuis la fiche unifiée", async () => {
      await closeResidualDialogs();
      await page.waitForTimeout(300);
      await page.click('.nav-btn[data-view="documents"]');
      await page.waitForSelector("#documentsList", { timeout: 10000 });
      await page.locator(".document-card").getByText("Registre probe", { exact: false }).first().click();
      await page.waitForSelector("#documentViewerDialog[open]", { timeout: 10000 });
      // ouverture du volet Informations (desktop)
      if (await page.locator("#viewerDetailsExpandBtn").isVisible()) await page.click("#viewerDetailsExpandBtn");
      await page.waitForSelector("[data-create-proof-from-document]", { timeout: 10000 });
      await page.click("[data-create-proof-from-document]");
      await page.waitForSelector("#genealogyContributionDialog[open]", { timeout: 10000 });
      // document pré-rempli, personnes proposées non cochées
      await page.fill("#genealogySourceDocumentSearch", "Registre");
      await page.waitForSelector('[data-genealogy-source-document="doc-probe"]', { timeout: 10000 });
      const checkedDoc = await page.locator('[data-genealogy-source-document="doc-probe"]').isChecked();
      assert.ok(checkedDoc, "document pré-sélectionné");
      const suggestions = page.locator("[data-proof-suggested-person]");
      assert.equal(await suggestions.count(), 2, "les deux personnes du document sont proposées");
      assert.ok(!(await suggestions.first().isChecked()), "aucune présélection automatique");
      await suggestions.nth(0).check();
      await suggestions.nth(1).check();
      // pages du document présentes mais aucune transcription : passage indisponible
      assert.ok(await page.locator("#proofPageFields").isVisible(), "sélecteurs de page visibles (pages du document)");
      assert.ok(!(await page.locator("#proofNoTranscription").isVisible()), "état « aucune page » non déclenché puisque le document a des pages");
      assert.match(await page.locator("#proofPassage").textContent(), /Aucun passage disponible/, "sans transcription : passage indisponible");
      // création
      await page.selectOption("#proofFactKind", "marriage");
      await page.fill("#proofSourceValue", "Mariage en 1899");
      await page.click("#genealogyContributionSubmitBtn");
      await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open, { timeout: 15000 });
      await page.waitForTimeout(800);
      assert.equal(await probe.count("genealogyProofs"), 2, "seconde preuve créée");
      // réouverture : le volet doit refléter la nouvelle preuve liée
      const detailsOpen = await page.locator("#documentViewerDialog[open]").count();
      assert.ok(detailsOpen === 1, "visionneuse toujours ouverte après fermeture du dialogue");
    });

    await t.test("3. géométrie : aucun débordement horizontal du dialogue", async () => {
      const label = await openProofDialogFromPerson();
      assert.equal(label, "Ajouter une preuve");
      const box = await page.evaluate(() => {
        const dialog = document.getElementById("genealogyContributionDialog");
        return { w: dialog.getBoundingClientRect().width, sw: dialog.scrollWidth, cw: dialog.clientWidth, vw: innerWidth };
      });
      assert.ok(box.w <= box.vw, "dialogue dans le viewport");
      assert.ok(box.sw <= box.cw + 2, "aucun débordement horizontal interne");
      await page.keyboard.press("Escape");
    });

    await t.test("4. transcription de test via le flux officiel puis création depuis un passage", async () => {
      await closeResidualDialogs();
      await page.waitForTimeout(300);
      await page.click('.nav-btn[data-view="genealogy"]');
      await page.waitForTimeout(600);
      // Création de la transcription par le flux officiel existant (règles : event + révision atomiques)
      await page.click("#genealogyOfficialBtn");
      await page.waitForSelector("#genealogyContributionDialog[open]", { timeout: 10000 }).catch(async () => {
        const state = await page.evaluate(() => ({
          open: document.getElementById("genealogyContributionDialog")?.open,
          officialBtnHidden: document.getElementById("genealogyOfficialBtn")?.hidden,
          status: document.getElementById("genealogyStatus")?.textContent
        }));
        throw new Error("dialogue officiel non ouvert : " + JSON.stringify(state) + " | erreurs: " + JSON.stringify(pageErrors));
      });
      // Le select de type est masqué en mode Source guidé : le test le rend accessible
      // pour créer une transcription officielle. La soumission reste intégralement
      // soumise aux règles (event + révision atomiques via le store officiel).
      await page.evaluate(() => {
        const typeSelect = document.getElementById("genealogyContributionType");
        const label = typeSelect?.closest("label");
        if (label) label.hidden = false;
      });
      await page.selectOption("#genealogyContributionType", "transcription");
      await page.fill("#genealogyContributionTitleField", "Registre probe — page 1");
      await page.fill("#genealogyContributionPayload", JSON.stringify({
        documentId: "doc-probe",
        pageId: "page-1",
        passages: [{ id: "passage-1", order: 0, textIt: "Ada, figlia di Giuseppe", translationFr: "Ada, fille de Giuseppe", separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "riga 1", translationState: "current" }]
      }));
      await page.click("#genealogyContributionSubmitBtn");
      await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open, { timeout: 15000 });
      await page.waitForTimeout(900);
      assert.equal(await probe.count("transcriptionHeads"), 1, "transcription officielle créée");
      const heads = JSON.parse(await probe.list("transcriptionHeads"));
      const headPassage = heads[0]?.data?.data?.passages?.[0] || heads[0]?.data?.passages?.[0] || null;
      console.log("DIAG passages head : " + JSON.stringify(headPassage).slice(0, 300));
      // Ouverture directe de la carte (la tuile devient cliquable)
      const transcriptionCard = page.locator(".genealogy-entry").filter({ has: page.locator('span.genealogy-entry-kind:text-is("Transcription")') }).first();
      if (!(await transcriptionCard.count())) throw new Error("carte de transcription absente du workspace");
      await transcriptionCard.click();
      await page.waitForSelector("#genealogyItemDialog[open]", { timeout: 10000 });
      const passageButton = page.locator("[data-genealogy-passage-propose]").first();
      assert.ok(await passageButton.count(), "bouton de passage présent");
      assert.match(await passageButton.textContent(), /Créer une preuve sur ce passage/, "libellé administrateur sur passage");
      await passageButton.click();
      await page.waitForSelector("#genealogyContributionDialog[open]", { timeout: 10000 });
      // préremplissage : page, passage, citations
      assert.equal(await page.locator("#proofPage").inputValue(), "page-1", "page pré-remplie");
      assert.equal(await page.locator("#proofPassage").inputValue(), "passage-1", "passage pré-rempli");
      const citationState = await page.evaluate(() => ({
        page: document.getElementById("proofPage")?.value,
        passage: document.getElementById("proofPassage")?.value,
        pageOptions: [...(document.getElementById("proofPage")?.options || [])].map(o => o.value),
        passageOptions: [...(document.getElementById("proofPassage")?.options || [])].map(o => o.value),
        citationIt: document.getElementById("proofCitationIt")?.value,
        context: JSON.stringify(window.__proofDebugContext || null)
      }));
      assert.equal((await page.locator("#proofCitationIt").inputValue()).trim(), "Ada, figlia di Giuseppe", "citation italienne pré-remplie — état: " + JSON.stringify(citationState));
      assert.equal((await page.locator("#proofCitationFr").inputValue()).trim(), "Ada, fille de Giuseppe", "traduction pré-remplie");
      assert.ok(await page.locator("#proofPageFields").isVisible(), "sélecteurs de page visibles avec transcription");
      await page.selectOption("#proofFactKind", "birth");
      const suggested = page.locator("[data-proof-suggested-person]");
      if (await suggested.count()) await suggested.first().check();
      await page.fill("#proofSourceValue", "Naissance d'Ada en 1875");
      await page.click("#genealogyContributionSubmitBtn");
      await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open, { timeout: 15000 });
      await page.waitForTimeout(800);
      assert.equal(await probe.count("genealogyProofs"), 3, "troisième preuve créée (passage)");
    });

    await t.test("5. consultation d'une preuve : libellés métier, sans JSON, géométrie", async () => {
      await closeResidualDialogs();
      await page.waitForTimeout(300);
      await page.click('.nav-btn[data-view="genealogy"]');
      await page.waitForTimeout(800);
      const proofEntries = page.locator(".genealogy-entry").filter({ has: page.locator('span.genealogy-entry-kind:text-is("Preuve")') });
      assert.ok(await proofEntries.count() >= 3, "au moins trois preuves dans le workspace");
      const targetProof = proofEntries.first();
      await targetProof.click();
      await page.waitForSelector("#genealogyItemDialog[open]", { timeout: 10000 });
      const content = page.locator("#genealogyItemContent");
      const bodyText = await content.innerText();
      const bodyLower = bodyText.toLowerCase();
      const openTitle = (await page.locator("#genealogyItemTitle").textContent()).trim();
      // informations métier (les libellés sont stylisés en capitales par le design system)
      assert.ok(["Décès", "Naissance", "Mariage"].includes(openTitle), "titre de fait traduit en entête : " + openTitle);
      assert.equal(await content.locator(".document-unified-section h4").filter({ hasText: openTitle }).count(), 0, "titre de fait non répété dans le corps");
      assert.ok(bodyLower.includes("confirme"), "relation traduite");
      assert.ok(bodyLower.includes("valeur relevée dans le document"), "valeur relevée affichée");
      assert.ok(bodyLower.includes("personnes concernées"), "personnes affichées");
      assert.ok((await content.locator('[data-source-document-open]').count()) >= 1, "action de consultation du document");
      assert.ok((await content.locator("[data-genealogy-person]").count()) >= 1, "personne consultable");
      // aucun JSON brut
      assert.equal(await content.locator("pre").count(), 0, "aucun bloc pre/JSON visible");
      assert.ok(!(await content.innerText()).includes("{ \"factId"), "aucune donnée technique brute");
      assert.ok(!/\b(birth|death|marriage|burial|supports|contradicts|mentions)\b/.test(bodyLower), "aucune clé technique brute visible");
      // preuves liées : exactement les deux autres preuves de l'émulateur, sans répétition de la courante
      const linkedButtons = content.locator('section [data-open-genealogy="proof"]');
      assert.equal(await linkedButtons.count(), 2, "seules les autres preuves sont listées dans « Preuves liées »");
      // détails techniques repliés
      assert.equal(await content.locator("details.genealogy-proof-technical").count(), 1, "panneau Détails techniques présent");
      assert.ok(!(await content.locator("details.genealogy-proof-technical").first().evaluate(el => el.open)), "Détails techniques repliés");
      // géométrie
      const box = await page.evaluate(() => {
        const dialog = document.getElementById("genealogyItemDialog");
        const grid = document.querySelector("#genealogyItemContent .genealogy-detail-grid");
        return { sw: dialog.scrollWidth, cw: dialog.clientWidth, cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : -1 };
      });
      assert.ok(box.sw <= box.cw + 2, "aucun débordement horizontal du dialogue");
      assert.equal(box.cols, 1, "panneau pleine largeur sans photographie");
      await page.keyboard.press("Escape");
    });

    await t.test("6. navigation Preuve → Preuve/Personne/Document avec retour explicite", async () => {
      await closeResidualDialogs();
      await page.waitForTimeout(300);
      await page.click('.nav-btn[data-view="genealogy"]');
      await page.waitForTimeout(600);
      const proofEntries = page.locator(".genealogy-entry").filter({ has: page.locator('span.genealogy-entry-kind:text-is("Preuve")') });
      await proofEntries.first().click();
      await page.waitForSelector("#genealogyItemDialog[open]", { timeout: 10000 });
      assert.ok(await page.locator("#genealogyItemBackBtn").isHidden(), "aucun retour sans fiche précédente");
      const firstTitle = (await page.locator("#genealogyItemTitle").textContent()).trim();
      // Preuve → Preuve liée (même surface) : le retour doit restaurer la fiche précédente
      const linkedProof = page.locator('#genealogyItemContent [data-open-genealogy="proof"]').first();
      assert.ok(await linkedProof.count(), "preuve liée disponible");
      await linkedProof.click();
      await page.waitForTimeout(400);
      const secondTitle = (await page.locator("#genealogyItemTitle").textContent()).trim();
      assert.notEqual(secondTitle, firstTitle, "deuxième preuve ouverte");
      assert.ok(await page.locator("#genealogyItemBackBtn").isVisible(), "bouton retour affiché");
      await page.click("#genealogyItemBackBtn");
      await page.waitForTimeout(600);
      const afterBack = await page.evaluate(() => ({
        hidden: document.getElementById("genealogyItemBackBtn").hidden,
        title: (document.getElementById("genealogyItemTitle").textContent || "").trim(),
        toast: document.querySelector("[role=status].toast, .toast")?.textContent?.slice(0, 80) || ""
      }));
      assert.equal(afterBack.title, firstTitle, "retour sur la fiche précédente — état: " + JSON.stringify(afterBack));
      assert.ok(await page.locator("#genealogyItemBackBtn").isHidden(), "retour consommé");
      // Preuve → Personne : fermeture de la fiche personne = retour naturel
      const chip = page.locator("#genealogyItemContent [data-genealogy-person]").first();
      assert.ok(await chip.count(), "personne consultable depuis la preuve");
      await chip.click();
      await page.waitForSelector("#personDialog[open]", { timeout: 10000 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      assert.ok(await page.locator("#genealogyItemDialog[open]").count(), "fiche preuve conservée après la visite personne");
      // Preuve → Document : la visionneuse s'ouvre par-dessus, sa fermeture conserve la preuve
      const docLink = page.locator("#genealogyItemContent [data-source-document-open]").first();
      await docLink.click();
      await page.waitForSelector("#documentViewerDialog[open]", { timeout: 10000 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      assert.ok(await page.locator("#genealogyItemDialog[open]").count(), "fiche preuve conservée après la visite document");
      await page.keyboard.press("Escape");
    });

    await t.test("7. mobile 375/320 : une colonne, aucun débordement, retrait d'une personne", async () => {
      for (const width of [375, 320]) {
        await closeResidualDialogs();
        await page.setViewportSize({ width, height: 844 });
        await page.waitForTimeout(300);
        // Ouverture de la preuve depuis la fiche personne (parcours mobile naturel, sans menu tile)
        await page.click('.nav-btn[data-view="directory"]');
        await page.waitForTimeout(400);
        await page.locator("#directoryList").getByText("Probe", { exact: false }).first().click();
        await page.waitForSelector("#personDialog[open]", { timeout: 10000 });
        await page.click('[data-person-section="documents"]');
        const consult = page.locator('#personGenealogyEvidenceList [data-view-proof]').first();
        assert.ok(await consult.count(), `${width}px : preuve consultable depuis la fiche personne`);
        await consult.click();
        await page.waitForSelector("#genealogyItemDialog[open]", { timeout: 10000 });
        const box = await page.evaluate(() => {
          const dialog = document.getElementById("genealogyItemDialog");
          const facts = document.querySelector("#genealogyItemContent .document-unified-facts");
          return {
            sw: dialog.scrollWidth, cw: dialog.clientWidth,
            docSw: document.documentElement.scrollWidth,
            cols: facts ? getComputedStyle(facts).gridTemplateColumns.split(" ").length : -1
          };
        });
        assert.ok(box.sw <= box.cw + 2, `${width}px : dialogue sans débordement horizontal`);
        assert.ok(box.docSw <= width + 1, `${width}px : page sans débordement`);
        assert.equal(box.cols, 1, `${width}px : faits empilés en une colonne`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
      // Formulaire en mobile : pastille et retrait (375)
      const label = await openProofDialogFromPerson();
      assert.equal(label, "Ajouter une preuve", "libellé administrateur en mobile");
      assert.ok(await page.locator("#genealogySourcePersonSelection .person-chip").count() >= 1, "pastille commune en sélection");
      const formBox = await page.evaluate(() => {
        const dialog = document.getElementById("genealogyContributionDialog");
        return { sw: dialog.scrollWidth, cw: dialog.clientWidth };
      });
      assert.ok(formBox.sw <= formBox.cw + 2, "formulaire sans débordement à 375px");
      await page.locator('#genealogySourcePersonSelection [data-remove-genealogy-source-person]').first().click();
      await page.waitForTimeout(200);
      assert.equal(await page.locator("#genealogySourcePersonSelection .source-person-selection-item").count(), 0, "personne retirée de la sélection");
      await page.keyboard.press("Escape");
    });

    await t.test("8. révision d'une preuve : retrait de personne persisté, retrait total accepté", async () => {
      const openPersonSection = async () => {
        await closeResidualDialogs();
        await page.waitForTimeout(300);
        await page.click('.nav-btn[data-view="directory"]');
        await page.waitForTimeout(400);
        await page.locator("#directoryList").getByText("Probe", { exact: false }).first().click();
        await page.waitForSelector("#personDialog[open]", { timeout: 10000 });
        await page.click('[data-person-section="documents"]');
        await page.waitForTimeout(250);
      };
      await openPersonSection();
      // a) le crayon ouvre la révision guidée (sans JSON)
      assert.equal(await page.locator("#personGenealogyEvidenceList article.person-doc-card").count(), 3, "trois cartes preuve cliquables pour la personne");
      const marriageCard = page.locator("#personGenealogyEvidenceList article.person-doc-card").filter({ hasText: "Mariage" });
      await marriageCard.locator("[data-edit-genealogy-proof]").click();
      await page.waitForSelector("#genealogyContributionDialog[open]", { timeout: 10000 });
      assert.ok(await page.locator("#genealogyOfficialProofFields").isVisible(), "formulaire guidé en révision");
      assert.ok(!(await page.locator("#genealogyContributionPayload").isVisible()), "aucun champ JSON en révision");
      assert.ok(await page.locator("#genealogyContributionTarget").evaluate(el => el.readOnly), "cible en lecture seule");
      assert.equal(await page.locator("#genealogySourcePersonSelection .person-chip").count(), 2, "les deux personnes pré-remplies");
      // b) retrait d'une personne parmi plusieurs (la dernière de la liste)
      await page.locator('#genealogySourcePersonSelection [data-remove-genealogy-source-person]').last().click();
      await page.waitForTimeout(200);
      assert.equal(await page.locator("#genealogySourcePersonSelection .person-chip").count(), 1, "une personne retirée de la sélection");
      const revisionsBefore = await probe.count("genealogyProofRevisions");
      await page.click("#genealogyContributionSubmitBtn");
      await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open, { timeout: 15000 });
      await page.waitForTimeout(900);
      // c) persistance : la nouvelle liste remplace réellement l'ancienne
      assert.equal(await probe.count("genealogyProofs"), 3, "toujours trois preuves (révision, pas de création)");
      assert.equal(await probe.count("genealogyProofRevisions"), revisionsBefore + 1, "une révision immuable ajoutée");
      const proofs = JSON.parse(await probe.list("genealogyProofs")).map(entry => entry.data.data || entry.data);
      const marriage = proofs.find(data => data.factType === "marriage");
      assert.ok(marriage, "la preuve de mariage existe toujours — factTypes: " + proofs.map(data => data.factType).join(" , ") + " | factIds: " + proofs.map(data => data.factId).join(" , "));
      assert.equal(marriage.personIds.length, 1, "la personne retirée n'est plus associée");
      assert.ok(marriage.personIds.includes("person-probe"), "l'autre personne est conservée");
      assert.equal(marriage.sourceValue, "Mariage en 1899", "la valeur relevée est conservée");
      assert.equal(marriage.factType, "marriage", "le fait est conservé");
      assert.equal(proofs.find(data => data.factType === "death").personIds.length, 1, "les autres preuves ne sont pas altérées");
      // d) retrait total : accepté et persisté (associations facultatives)
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await openPersonSection();
      const deathCard = page.locator("#personGenealogyEvidenceList article.person-doc-card").filter({ hasText: "Décès" });
      await deathCard.locator("[data-edit-genealogy-proof]").click();
      await page.waitForSelector("#genealogyContributionDialog[open]", { timeout: 10000 });
      await page.locator('#genealogySourcePersonSelection [data-remove-genealogy-source-person]').first().click();
      await page.waitForTimeout(200);
      const revisionsBeforeTotal = await probe.count("genealogyProofRevisions");
      await page.click("#genealogyContributionSubmitBtn");
      await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open, { timeout: 15000 });
      await page.waitForTimeout(900);
      assert.equal(await probe.count("genealogyProofRevisions"), revisionsBeforeTotal + 1, "retrait total : une révision immuable ajoutée");
      const deathProof = JSON.parse(await probe.list("genealogyProofs")).map(entry => entry.data.data || entry.data).find(data => data.factType === "death");
      assert.ok(deathProof, "la preuve de décès existe toujours après le retrait total");
      assert.deepEqual(deathProof.personIds, [], "retrait total persisté : aucune personne associée");
      assert.equal(deathProof.documentId, "doc-probe", "le document d'origine est conservé");
      // e) fiches personnes après rechargement
      await page.keyboard.press("Escape");
      await closeResidualDialogs();
      await page.waitForTimeout(300);
      await page.click('.nav-btn[data-view="directory"]');
      await page.waitForTimeout(400);
      await page.locator("#directoryList").getByText("Grace", { exact: false }).first().click();
      await page.waitForSelector("#personDialog[open]", { timeout: 10000 });
      await page.click('[data-person-section="documents"]');
      await page.waitForTimeout(300);
      assert.equal(await page.locator("#personGenealogyEvidenceList article.person-doc-card").count(), 0, "la personne retirée n'a plus aucune preuve associée");
      assert.ok((await page.locator("#personGenealogyEvidenceList").innerText()).includes("Aucune preuve associée"), "état vide affiché");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page.click('.nav-btn[data-view="directory"]');
      await page.waitForTimeout(400);
      await page.locator("#directoryList").getByText("Ada", { exact: false }).first().click();
      await page.waitForSelector("#personDialog[open]", { timeout: 10000 });
      await page.click('[data-person-section="documents"]');
      await page.waitForTimeout(300);
      assert.equal(await page.locator("#personGenealogyEvidenceList article.person-doc-card").count(), 2, "les deux preuves encore associées à la personne sont intactes (décès détaché)");
      await page.keyboard.press("Escape");
    });

    await t.test("9. révision : retraits personne/document sans blocage (6 scénarios)", async () => {
      const openMarriageRevision = async (personName = "Probe") => {
        await closeResidualDialogs();
        await page.waitForTimeout(300);
        await page.click('.nav-btn[data-view="directory"]');
        await page.waitForTimeout(400);
        await page.locator("#directoryList").getByText(personName, { exact: false }).first().click();
        await page.waitForSelector("#personDialog[open]", { timeout: 10000 });
        await page.click('[data-person-section="documents"]');
        await page.waitForTimeout(250);
        const marriageCard = page.locator("#personGenealogyEvidenceList article.person-doc-card").filter({ hasText: "Mariage" });
        await marriageCard.locator("[data-edit-genealogy-proof]").click();
        await page.waitForSelector("#genealogyContributionDialog[open]", { timeout: 10000 });
      };
      const openBirthRevision = async () => {
        await closeResidualDialogs();
        await page.waitForTimeout(300);
        await page.click('.nav-btn[data-view="directory"]');
        await page.waitForTimeout(400);
        await page.locator("#directoryList").getByText("Ada", { exact: false }).first().click();
        await page.waitForSelector("#personDialog[open]", { timeout: 10000 });
        await page.click('[data-person-section="documents"]');
        await page.waitForTimeout(250);
        const birthCard = page.locator("#personGenealogyEvidenceList article.person-doc-card").filter({ hasText: "Naissance" });
        await birthCard.locator("[data-edit-genealogy-proof]").click();
        await page.waitForSelector("#genealogyContributionDialog[open]", { timeout: 10000 });
      };
      const selectPerson = async name => {
        await page.fill("#genealogySourcePersonSearch", name);
        await page.waitForTimeout(350);
        const box = page.locator("#genealogySourcePersonOptions input[type=checkbox]").first();
        if (await box.count() && !(await box.isChecked())) await box.check();
      };
      const removePerson = personId => page.locator(`#genealogySourcePersonSelection [data-remove-genealogy-source-person="${personId}"]`).click();
      const removeDocument = docId => page.locator(`#genealogySourceDocumentSelection [data-remove-genealogy-source-document="${docId}"]`).click();
      const chipCount = () => page.locator("#genealogySourcePersonSelection .person-chip").count();
      const proofData = async factType => {
        const proofs = JSON.parse(await probe.list("genealogyProofs")).map(entry => entry.data.data || entry.data);
        return proofs.find(data => data.factType === factType);
      };
      const proofRevisions = async headId => JSON.parse(await probe.list("genealogyProofRevisions"))
        .map(entry => ({ id: entry.id, objectId: entry.data.objectId, previousRevisionId: entry.data.previousRevisionId, proof: entry.data.data }))
        .filter(rev => rev.objectId === headId);

      // --- Scénario 5 : retirer puis re-sélectionner une personne ---
      await openMarriageRevision();
      await removePerson("person-probe");
      assert.equal(await chipCount(), 0, "S5 : personne retirée");
      await selectPerson("Grace");
      assert.equal(await chipCount(), 1, "S5 : personne re-sélectionnée");
      let state = await proofSubmitState();
      assert.ok(!state.open, "S5 : enregistrement accepté — état: " + JSON.stringify(state));
      let marriage = await proofData("marriage");
      assert.deepEqual([...marriage.personIds].sort(), ["person-probe2"], "S5 : la sélection enregistrée remplace l'ancienne liste");

      // --- Scénario 1 : deux personnes, retrait d'une seule ---
      // La preuve est désormais portée par Grace : ouverture depuis sa fiche.
      await openMarriageRevision("Grace");
      await selectPerson("Ada");
      assert.equal(await chipCount(), 2, "S1 : deux personnes");
      await removePerson("person-probe2");
      assert.equal(await chipCount(), 1, "S1 : une personne retirée");
      state = await proofSubmitState();
      assert.ok(!state.open, "S1 : enregistrement accepté — état: " + JSON.stringify(state));
      marriage = await proofData("marriage");
      assert.deepEqual([...marriage.personIds].sort(), ["person-probe"], "S1 : retrait persisté, autres associations conservées");

      // --- Scénario 3 : document retiré sans remplacement → accepté ---
      await openMarriageRevision();
      await removeDocument("doc-probe");
      state = await proofSubmitState();
      assert.ok(!state.open, "S3 : retrait du document accepté — état: " + JSON.stringify(state));
      marriage = await proofData("marriage");
      assert.equal(marriage.documentId, null, "S3 : documentId neutralisé");
      assert.deepEqual([...marriage.personIds].sort(), ["person-probe"], "S3 : les personnes sont conservées");

      // --- Scénario 4 : sélection d'un document de remplacement ---
      await openMarriageRevision();
      await page.fill("#genealogySourceDocumentSearch", "Cadastre");
      await page.waitForTimeout(350);
      await page.locator('[data-genealogy-source-document="doc-probe2"]').check();
      state = await proofSubmitState();
      assert.ok(!state.open, "S4 : remplacement accepté — état: " + JSON.stringify(state));
      marriage = await proofData("marriage");
      assert.equal(marriage.documentId, "doc-probe2", "S4 : le document de remplacement est persisté");
      assert.deepEqual([...marriage.personIds].sort(), ["person-probe"], "S4 : les personnes sont conservées");

      // --- Scénario 2 : dernière personne retirée → accepté (associations facultatives) ---
      await openMarriageRevision();
      await removePerson("person-probe");
      const revisionsBefore = await probe.count("genealogyProofRevisions");
      state = await proofSubmitState();
      assert.ok(!state.open, "S2 : retrait total des personnes accepté — état: " + JSON.stringify(state));
      assert.equal(await probe.count("genealogyProofRevisions"), revisionsBefore + 1, "S2 : une révision immuable ajoutée");
      marriage = await proofData("marriage");
      assert.deepEqual(marriage.personIds, [], "S2 : aucune personne associée après retrait total");
      assert.equal(marriage.documentId, "doc-probe2", "S2 : le document de remplacement est conservé");

      // --- Scénario 6 : retrait du document d'une preuve citant un passage →
      //     références dépendantes neutralisées dans la nouvelle révision, révision d'origine intacte ---
      const birthHeadId = JSON.parse(await probe.list("genealogyProofs")).find(entry => (entry.data.data || entry.data).factType === "birth")?.id;
      assert.ok(birthHeadId, "S6 : preuve de naissance présente");
      const birthRevisionsBefore = await proofRevisions(birthHeadId);
      const oldBirthRevision = birthRevisionsBefore.find(rev => rev.previousRevisionId === null);
      assert.ok(oldBirthRevision?.proof?.pageId === "page-1" && oldBirthRevision?.proof?.passageId === "passage-1",
        "S6 : la révision d'origine cite page et passage — état: " + JSON.stringify(oldBirthRevision?.proof));
      await openBirthRevision();
      await removeDocument("doc-probe");
      state = await proofSubmitState();
      assert.ok(!state.open, "S6 : retrait du document accepté malgré la citation — état: " + JSON.stringify(state));
      const birthRevisions = await proofRevisions(birthHeadId);
      assert.equal(birthRevisions.length, birthRevisionsBefore.length + 1, "S6 : une nouvelle révision s'ajoute à la révision d'origine");
      const newBirthRevision = birthRevisions.find(rev => rev.previousRevisionId === oldBirthRevision.id);
      assert.ok(newBirthRevision, "S6 : chaîne de révisions cohérente");
      assert.equal(newBirthRevision.proof.documentId, null, "S6 : document neutralisé dans la nouvelle révision");
      assert.equal(newBirthRevision.proof.pageId, null, "S6 : page neutralisée dans la nouvelle révision");
      assert.equal(newBirthRevision.proof.passageId, null, "S6 : passage neutralisé dans la nouvelle révision");
      assert.equal(newBirthRevision.proof.transcriptionRevisionId, null, "S6 : révision de transcription neutralisée");
      assert.equal(oldBirthRevision.proof.pageId, "page-1", "S6 : la révision d'origine reste intacte (page)");
      assert.equal(oldBirthRevision.proof.passageId, "passage-1", "S6 : la révision d'origine reste intacte (passage)");
      assert.equal(oldBirthRevision.proof.transcriptionRevisionId, birthRevisionsBefore[0]?.proof?.transcriptionRevisionId, "S6 : la révision d'origine reste intacte (révision de transcription)");
    });

    await t.test("10. création sans personne ni document (associations facultatives)", async () => {
      await closeResidualDialogs();
      await page.waitForTimeout(300);
      await page.click('.nav-btn[data-view="genealogy"]');
      await page.waitForTimeout(600);
      await page.click("#genealogyOfficialBtn");
      await page.waitForSelector("#genealogyContributionDialog[open]", { timeout: 10000 });
      // Le type par défaut est « source » : le test bascule en preuve guidée
      await page.evaluate(() => {
        const typeSelect = document.getElementById("genealogyContributionType");
        const label = typeSelect?.closest("label");
        if (label) label.hidden = false;
      });
      await page.selectOption("#genealogyContributionType", "proof");
      await page.waitForTimeout(200);
      assert.ok(await page.locator("#genealogyOfficialProofFields").isVisible(), "formulaire guidé de preuve visible");
      // Aucune personne, aucun document : fait « Autre » sans rattachement
      await page.selectOption("#proofFactKind", "other");
      await page.fill("#proofFactOtherLabel", "Naturalisation");
      await page.fill("#proofSourceValue", "Naturalisation sans rattachement");
      const proofsBefore = await probe.count("genealogyProofs");
      await page.click("#genealogyContributionSubmitBtn");
      await page.waitForFunction(() => !document.getElementById("genealogyContributionDialog").open, { timeout: 15000 });
      await page.waitForTimeout(900);
      assert.equal(await probe.count("genealogyProofs"), proofsBefore + 1, "preuve créée sans personne ni document");
      const proofs = JSON.parse(await probe.list("genealogyProofs")).map(entry => entry.data.data || entry.data);
      const orphan = proofs.find(data => data.factType === "Naturalisation");
      assert.ok(orphan, "la preuve sans association existe");
      assert.deepEqual(orphan.personIds, [], "aucune personne associée à la création");
      assert.equal(orphan.documentId, null, "aucun document d'origine à la création");
      assert.ok(orphan.factId, "factId de repli dérivé de l'identifiant officiel");
      assert.equal(orphan.relation, "supports", "relation par défaut conservée");
      await closeResidualDialogs();
    });

    await t.test("11. suppression officielle par l'interface : Preuve et Source", async () => {
      const proofId = "ui-delete-proof-lock";
      await probe.createOfficial({
        type: "proof", id: proofId, revisionId: "ui-delete-proof-lock-r1", eventId: "ui-delete-proof-lock-e1",
        data: {
          id: proofId, factId: "fact-ui-delete-proof-lock", factType: "ui-delete-proof-lock-fact", personIds: ["person-probe"], documentId: null,
          pageId: null, passageId: null, transcriptionRevisionId: null, photographId: null, zone: null,
          citation: { textIt: null, translationFr: null }, sourceValue: null, relation: "supports",
          interpretation: "", technicalStatus: "active"
        }, reason: "Fixture interface émulateur"
      });
      await page.click('.nav-btn[data-view="directory"]');
      await page.waitForTimeout(400);
      await page.locator("#directoryList").getByText("Ada", { exact: false }).first().click();
      await page.waitForSelector("#personDialog[open]", { timeout: 10000 });
      await page.click('[data-person-section="documents"]');
      const proofCard = page.locator("#personGenealogyEvidenceList article.person-doc-card").filter({ hasText: "ui-delete-proof-lock-fact" });
      await proofCard.click();
      await page.waitForSelector("#genealogyItemDialog[open]", { timeout: 10000 });
      await page.click("#genealogyItemMenuBtn");
      await page.click('#genealogyItemActionsMenu [data-genealogy-item-action="delete-official"]');
      await page.waitForSelector("#permanentDeleteDialog[open]", { timeout: 10000 });
      await page.click("#permanentDeleteConfirmBtn");
      await page.waitForFunction(() => !document.getElementById("permanentDeleteDialog").open, { timeout: 15000 });
      await page.waitForFunction(() => !document.getElementById("genealogyItemDialog").open, { timeout: 15000 });
      await page.waitForTimeout(500);
      const proofRemaining = JSON.parse(await probe.list("genealogyProofs")).some(item => item.id === proofId);
      const proofRevisionRemaining = JSON.parse(await probe.list("genealogyProofRevisions")).some(item => item.data.objectId === proofId);
      const proofToast = await page.locator("#toast").innerText().catch(() => "");
      assert.equal(proofRemaining, false, `la suppression UI de Preuve doit aboutir ; retour UI : ${proofToast}`);
      assert.equal(proofRevisionRemaining, false, "la révision de la Preuve est supprimée");
      assert.match(proofToast, /supprimé définitivement/, "le succès de suppression de Preuve est annoncé");

      await closeResidualDialogs();
      const sourceId = "ui-delete-source-lock";
      await probe.createOfficial({
        type: "source", id: sourceId, revisionId: "ui-delete-source-lock-r1", eventId: "ui-delete-source-lock-e1",
        data: { id: sourceId, title: "Source officielle test verrou", documentIds: [], personIds: [], status: "active" },
        reason: "Fixture interface émulateur"
      });
      await page.click('.nav-btn[data-view="genealogy"]');
      await page.waitForTimeout(400);
      await page.selectOption("#genealogyKindFilter", "sources");
      await page.waitForTimeout(500);
      const sourceEntry = page.locator(".genealogy-entry").filter({ hasText: "Source officielle test verrou" });
      await sourceEntry.click();
      await page.waitForSelector("#genealogyItemDialog[open]", { timeout: 10000 });
      await page.click("#genealogyItemMenuBtn");
      await page.click('#genealogyItemActionsMenu [data-genealogy-item-action="delete-official"]');
      await page.waitForSelector("#permanentDeleteDialog[open]", { timeout: 10000 });
      await page.click("#permanentDeleteConfirmBtn");
      await page.waitForFunction(() => !document.getElementById("permanentDeleteDialog").open, { timeout: 15000 });
      await page.waitForFunction(() => !document.getElementById("genealogyItemDialog").open, { timeout: 15000 });
      await page.waitForTimeout(500);
      const sourceRemaining = JSON.parse(await probe.list("sourceDocuments")).some(item => item.id === sourceId);
      const sourceRevisionRemaining = JSON.parse(await probe.list("sourceRevisions")).some(item => item.data.objectId === sourceId);
      const sourceToast = await page.locator("#toast").innerText().catch(() => "");
      assert.equal(sourceRemaining, false, `la suppression UI de Source doit aboutir ; retour UI : ${sourceToast}`);
      assert.equal(sourceRevisionRemaining, false, "la révision de la Source est supprimée");
      assert.match(sourceToast, /supprimé définitivement/, "le succès de suppression de Source est annoncé");
      await closeResidualDialogs();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.getElementById("appMain") && !document.getElementById("appMain").hidden, { timeout: 20000 });
      assert.ok(!JSON.parse(await probe.list("genealogyProofs")).some(item => item.id === proofId), "Preuve toujours absente après rechargement");
      assert.ok(!JSON.parse(await probe.list("sourceDocuments")).some(item => item.id === sourceId), "Source toujours absente après rechargement");
    });

    await t.test("12. navigation Document → Source et Document → Preuve avec retour au Document", async () => {
      const linkedSourceId = "ui-nav-linked-source";
      await probe.createOfficial({
        type: "source", id: linkedSourceId, revisionId: "ui-nav-source-r1", eventId: "ui-nav-source-e1",
        data: { id: linkedSourceId, title: "Source navigation test", documentIds: ["doc-probe"], personIds: [], status: "active" },
        reason: "Fixture navigation document"
      });
      await page.click('.nav-btn[data-view="documents"]');
      await page.waitForTimeout(500);
      await page.locator(".document-card").filter({ hasText: "Registre probe" }).first().click();
      await page.waitForSelector("#documentViewerDialog[open]", { timeout: 10000 });
      await page.click("#viewerDetailsExpandBtn");
      await page.waitForTimeout(300);

      // Document → Source : ouverture directe depuis la carte, aucun retour hérité
      const sourceCard = page.locator(`[data-unified-source-card="${linkedSourceId}"]`);
      assert.ok(await sourceCard.count(), "carte Source cliquable présente dans le volet");
      await sourceCard.click();
      await page.waitForSelector("#genealogyItemDialog[open]", { timeout: 10000 });
      assert.ok((await page.locator("#genealogyItemTitle").textContent()).includes("Source navigation test"), "fiche Source ouverte depuis le document");
      assert.ok(await page.locator("#genealogyItemBackBtn").isHidden(), "aucun bouton retour hérité sur la Source");
      await page.click('#genealogyItemDialog [data-close="genealogyItemDialog"]');
      await page.waitForFunction(() => !document.getElementById("genealogyItemDialog").open, { timeout: 10000 });
      await page.waitForSelector("#documentViewerDialog[open]", { timeout: 10000 });

      // Document → Preuve : même parcours de retour
      await page.click("#viewerDetailsExpandBtn");
      await page.waitForTimeout(300);
      const proofCard = page.locator("[data-unified-proof-card]").first();
      assert.ok(await proofCard.count(), "carte Preuve cliquable présente dans le volet");
      await proofCard.click();
      await page.waitForSelector("#genealogyItemDialog[open]", { timeout: 10000 });
      assert.ok(await page.locator("#genealogyItemBackBtn").isHidden(), "aucun bouton retour hérité sur la Preuve");
      await page.click('#genealogyItemDialog [data-close="genealogyItemDialog"]');
      await page.waitForFunction(() => !document.getElementById("genealogyItemDialog").open, { timeout: 10000 });
      await page.waitForSelector("#documentViewerDialog[open]", { timeout: 10000 });
      await closeResidualDialogs();
    });

    assert.deepEqual(pageErrors, [], "aucune erreur JavaScript pendant les parcours");
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
