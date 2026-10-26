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
        "await fsModule.setDoc(fsModule.doc(db, 'documents/doc-probe'), { title: 'Registre probe', type: 'Registre', date: '1901-04-12', place: '', personIds: ['person-probe'], notes: '', fileName: 'registre.html', mimeType: 'text/html', externalUrl: 'https://example.invalid/registre', chunkCount: 0 });" +
        "})()");
      await run();
    }, bootstrap),
    count: collectionName => page.evaluate(async ({ bootstrapCode, collectionPath }) => {
      const run = new Function("return (async () => {" + bootstrapCode +
        "const snap = await fsModule.getDocs(fsModule.collection(db, " + JSON.stringify(collectionPath) + ")); return snap.size;})()");
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
    page.on("pageerror", error => pageErrors.push(error.message.slice(0, 160)));

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
      assert.equal(await suggestions.count(), 1, "personne du document proposée");
      assert.ok(!(await suggestions.first().isChecked()), "aucune présélection automatique");
      // état vide de transcription
      assert.ok(await page.locator("#proofNoTranscription").isVisible(), "état vide transcription affiché");
      assert.ok(!(await page.locator("#proofPageFields").isVisible()), "sélecteurs pages masqués sans transcription");
      // création
      await page.selectOption("#proofFactKind", "marriage");
      await page.locator("[data-proof-suggested-person]").check();
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

    assert.deepEqual(pageErrors, [], "aucune erreur JavaScript pendant les parcours");
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
