import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

/*
 * Restauration de navigation : accès direct par URL, actualisation d'une fiche
 * (Personne, Document, Source, Preuve, Démarche), Retour/Avancer, session
 * expirée, fiche inexistante et navigation mobile.
 *
 * Firebase Auth/Firestore sont bloqués : aucun compte ni donnée réelle. Le
 * harnais injecté dans js/app.js appelle exactement le code de restauration
 * exécuté après l'approbation du profil (restoreNavigationAfterAuth), avec des
 * données locales de test.
 */

const svgDataUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='%23557a65'/%3E%3C/svg%3E";

const hooks = `
window.__navRestoreTest = {
  seed() {
    people = [
      { id: "nav-person", firstName: "Ada", lastName: "Rossi", gender: "F", inTree: true, birthDateInfo: { type: "year", year: 1890 } },
      { id: "nav-person-b", firstName: "Carlo", lastName: "Rossi", gender: "M", inTree: true }
    ];
    families = [];
    documents = [{
      id: "nav-document",
      title: "Acte de naissance d’Ada",
      type: "Acte",
      fileName: "acte.svg",
      mimeType: "image/svg+xml",
      fileData: "${svgDataUrl}",
      personIds: ["nav-person"]
    }];
    tasks = [];
    procedures = [{ id: "nav-dossier", title: "Démarche de test", type: "other", status: "open", organization: "Préfecture", updatedAtSort: 0 }];
    genealogyRecords = {
      sourceDocuments: [{ id: "nav-source", data: { id: "nav-source", title: "Cadastre d’Orino", status: "active", personIds: ["nav-person"], documentIds: [] } }],
      sourceRevisions: [],
      transcriptionHeads: [],
      transcriptionRevisions: [],
      genealogyProofs: [{ id: "nav-proof", data: { id: "nav-proof", factId: "fact~person~nav-person~birth", factType: "birth", personIds: ["nav-person"], relation: "supports", technicalStatus: "active", sourceValue: "1890" } }],
      genealogyProofRevisions: [],
      factConclusions: [],
      conclusionRevisions: [],
      genealogyProposals: [],
      genealogyEvents: [],
      genealogyNotifications: []
    };
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = loadedProcedures = true;
    genealogyLoaded = true;
    currentUserProfile = { role: "admin", displayName: "Testeur" };
    activeDataUid = "nav-test-uid";
    showAuthPanel("app");
    $("topbar").hidden = false;
    restoreNavigationAfterAuth(readNavigationTarget(window.location.search));
  },
  state() {
    return {
      search: window.location.search,
      historyLength: window.history.length,
      loginVisible: !$("loginForm").hidden,
      treeVisible: !$("appMain").hidden,
      directoryVisible: !$("directoryView").hidden,
      personVisible: !$("personDetailView").hidden,
      documentVisible: !$("documentDetailView").hidden,
      sourceVisible: !$("sourceDetailView").hidden,
      proofVisible: !$("proofDetailView").hidden,
      dossierOpen: $("procedureDetailDialog").open,
      personTitle: $("personPageTitle").textContent.trim(),
      documentTitle: $("viewerTitle").textContent.trim(),
      sourceTitle: $("sourcePageTitle").textContent.trim(),
      proofTitle: $("proofPageTitle").textContent.trim(),
      dossierTitle: $("procedureDetailTitle").textContent.trim(),
      toast: $("toast").textContent.trim()
    };
  }
};
`;

function routeHandler(server) {
  return async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      const source = await response.text();
      return route.fulfill({ response, body: source + "\n" + hooks });
    }
    return isAllowedRequest(url, server.baseURL)
      ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  };
}

/* Ouvre l'application sur une URL donnée et attend l'écran de connexion (session
   absente/expirée) puis le harnais injecté. */
async function openApp(t, { search = "", viewport = { width: 1280, height: 900 } }) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    t.skip(`Chromium indisponible : ${error.message}`);
    return null;
  }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR", viewport });
  await context.route("**/*", routeHandler(server));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.baseURL + search, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__navRestoreTest === "object");
  await page.waitForFunction(() => {
    const form = document.getElementById("loginForm");
    return Boolean(form) && !form.hidden;
  });
  return {
    page,
    errors,
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    }
  };
}

async function seedAndState(page) {
  await page.evaluate(() => window.__navRestoreTest.seed());
  return page.evaluate(() => window.__navRestoreTest.state());
}

function assertNoApplicationError(errors) {
  const relevant = errors.filter(message => !/firebase|firestore|network|fetch|load failed|failed to fetch/i.test(message));
  assert.deepEqual(relevant, [], `erreurs JavaScript inattendues : ${relevant.join(" | ")}`);
}

const TARGETS = [
  {
    name: "Personne",
    search: "?view=personDetail&id=nav-person",
    visible: state => state.personVisible,
    title: state => state.personTitle,
    expected: "Ada Rossi"
  },
  {
    name: "Document",
    search: "?view=documentDetail&id=nav-document",
    visible: state => state.documentVisible,
    title: state => state.documentTitle,
    expected: "Acte de naissance d’Ada"
  },
  {
    name: "Source",
    search: "?view=sourceDetail&id=nav-source",
    visible: state => state.sourceVisible,
    title: state => state.sourceTitle,
    expected: "Cadastre d’Orino"
  },
  {
    name: "Preuve",
    search: "?view=proofDetail&id=nav-proof",
    visible: state => state.proofVisible,
    title: state => state.proofTitle,
    expected: "Naissance"
  },
  {
    name: "Démarche",
    search: "?view=dossiers&id=nav-dossier",
    visible: state => state.dossierOpen,
    title: state => state.dossierTitle,
    expected: "Démarche de test"
  }
];

test("actualisation d’une fiche : les cinq fiches sont restaurées par leur identifiant", async t => {
  for (const target of TARGETS) {
    const session = await openApp(t, { search: target.search });
    if (!session) return;
    try {
      const before = await session.page.evaluate(() => window.history.length);
      const state = await seedAndState(session.page);
      assert.ok(target.visible(state), `${target.name} : la fiche doit être visible après la restauration (${JSON.stringify(state)})`);
      assert.equal(target.title(state), target.expected, `${target.name} : titre de la fiche restaurée`);
      assert.equal(state.search, target.search, `${target.name} : l’URL de la fiche est conservée`);
      assert.equal(state.historyLength, before, `${target.name} : aucune entrée d’historique ajoutée par la restauration`);
      assert.equal(state.loginVisible, false, `${target.name} : l’écran de connexion disparaît après approbation`);
      assertNoApplicationError(session.errors);
    } finally {
      await session.close();
    }
  }
});

test("session expirée : l’URL de fiche est conservée et aucune fiche n’est ouverte", async t => {
  const session = await openApp(t, { search: "?view=personDetail&id=nav-person" });
  if (!session) return;
  try {
    const state = await session.page.evaluate(() => window.__navRestoreTest.state());
    assert.equal(state.loginVisible, true, "l’écran de connexion s’affiche");
    assert.equal(state.personVisible, false, "aucune fiche sans session approuvée");
    assert.equal(state.search, "?view=personDetail&id=nav-person", "l’URL de la fiche est conservée pour une reconnexion");
    assertNoApplicationError(session.errors);
  } finally {
    await session.close();
  }
});

test("fiche inexistante : retour à la vue d’origine sans fiche fantôme", async t => {
  const cases = [
    { search: "?view=personDetail&id=personne-inexistante", check: state => state.directoryVisible && !state.personVisible, toast: /Cette personne n’est plus disponible/ },
    { search: "?view=documentDetail&id=document-inexistant", check: state => !state.documentVisible, toast: /Ce document n’est plus disponible/ },
    { search: "?view=sourceDetail&id=source-inexistante", check: state => !state.sourceVisible, toast: /Cet élément n’est plus disponible/ },
    { search: "?view=proofDetail&id=preuve-inexistante", check: state => !state.proofVisible, toast: /Cet élément n’est plus disponible/ },
    { search: "?view=dossiers&id=demarche-inexistante", check: state => !state.dossierOpen, toast: /Démarche introuvable/ }
  ];
  for (const item of cases) {
    const session = await openApp(t, { search: item.search });
    if (!session) return;
    try {
      const state = await seedAndState(session.page);
      assert.ok(item.check(state), `${item.search} : aucune fiche ne doit rester ouverte (${JSON.stringify(state)})`);
      assert.match(state.toast, item.toast, `${item.search} : message explicite`);
      assertNoApplicationError(session.errors);
    } finally {
      await session.close();
    }
  }
});

test("Retour/Avancer après ouverture et fermeture d’une fiche Personne", async t => {
  const session = await openApp(t, { search: "?view=directory" });
  if (!session) return;
  try {
    const seeded = await seedAndState(session.page);
    assert.ok(seeded.directoryVisible, "l’annuaire s’affiche après la restauration");
    const lengthBeforeOpen = seeded.historyLength;

    await session.page.locator('#directoryList [data-directory-person="nav-person"]').click();
    await session.page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const opened = await session.page.evaluate(() => window.__navRestoreTest.state());
    assert.equal(opened.search, "?view=personDetail&id=nav-person", "l’ouverture écrit la fiche dans l’URL");
    assert.equal(opened.historyLength, lengthBeforeOpen + 1, "l’ouverture crée une entrée d’historique");

    await session.page.goBack();
    await session.page.waitForFunction(() => !document.getElementById("directoryView").hidden);
    const afterBack = await session.page.evaluate(() => window.__navRestoreTest.state());
    assert.equal(afterBack.search, "?view=directory", "Retour revient à l’annuaire");
    assert.equal(afterBack.personVisible, false, "la fiche est refermée par Retour");

    await session.page.goForward();
    await session.page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const afterForward = await session.page.evaluate(() => window.__navRestoreTest.state());
    assert.equal(afterForward.search, "?view=personDetail&id=nav-person", "Avant rouvre la même fiche");
    assert.equal(afterForward.personTitle, "Ada Rossi", "la même personne est restaurée");

    await session.page.locator("#personPageBackBtn").click();
    await session.page.waitForFunction(() => !document.getElementById("directoryView").hidden);
    const afterClose = await session.page.evaluate(() => window.__navRestoreTest.state());
    assert.equal(afterClose.search, "?view=directory", "la fermeture revient à l’annuaire");

    await session.page.goBack();
    await session.page.waitForFunction(() => !document.getElementById("personDetailView").hidden);
    const reopenedByBack = await session.page.evaluate(() => window.__navRestoreTest.state());
    assert.equal(reopenedByBack.personTitle, "Ada Rossi", "Retour rouvre la fiche fermée, sans boucle");
    assert.equal(reopenedByBack.historyLength, afterClose.historyLength, "la réouverture par Retour n’ajoute aucune entrée");
    assertNoApplicationError(session.errors);
  } finally {
    await session.close();
  }
});

test("Retour/Avancer sur une fiche Démarche ouverte depuis la liste", async t => {
  const session = await openApp(t, { search: "?view=dossiers" });
  if (!session) return;
  try {
    await seedAndState(session.page);
    await session.page.locator('[data-procedure-card="nav-dossier"]').click();
    await session.page.waitForFunction(() => document.getElementById("procedureDetailDialog").open);
    const opened = await session.page.evaluate(() => window.__navRestoreTest.state());
    assert.equal(opened.search, "?view=dossiers&id=nav-dossier", "l’ouverture écrit l’identifiant de la démarche");

    await session.page.goBack();
    await session.page.waitForFunction(() => !document.getElementById("procedureDetailDialog").open);
    const afterBack = await session.page.evaluate(() => window.__navRestoreTest.state());
    assert.equal(afterBack.search, "?view=dossiers", "Retour referme la démarche");
    assert.equal(afterBack.dossierOpen, false);

    await session.page.goForward();
    await session.page.waitForFunction(() => document.getElementById("procedureDetailDialog").open);
    const afterForward = await session.page.evaluate(() => window.__navRestoreTest.state());
    assert.equal(afterForward.search, "?view=dossiers&id=nav-dossier", "Avant rouvre la même démarche");
    assert.equal(afterForward.dossierTitle, "Démarche de test");
    assertNoApplicationError(session.errors);
  } finally {
    await session.close();
  }
});

test("navigation mobile : les fiches se restaurent sans débordement horizontal", async t => {
  for (const target of [TARGETS[0], TARGETS[1], TARGETS[4]]) {
    const session = await openApp(t, { search: target.search, viewport: { width: 390, height: 844 } });
    if (!session) return;
    try {
      const state = await seedAndState(session.page);
      assert.ok(target.visible(state), `${target.name} (mobile) : fiche restaurée`);
      assert.equal(target.title(state), target.expected, `${target.name} (mobile) : titre restauré`);
      const overflow = await session.page.evaluate(() => ({
        doc: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth
      }));
      assert.ok(overflow.scroll <= overflow.doc + 1, `${target.name} (mobile) : débordement horizontal ${overflow.scroll}px > ${overflow.doc}px`);
      assertNoApplicationError(session.errors);
    } finally {
      await session.close();
    }
  }
});
