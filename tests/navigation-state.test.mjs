import test from "node:test";
import assert from "node:assert/strict";
import {
  DETAIL_VIEWS,
  detailBaseView,
  historyAction,
  isDetailTarget,
  navigationUrl,
  readNavigationTarget,
  readRestorableView
} from "../js/navigation-state.js";

test("les vues principales restent restaurables depuis l’URL", () => {
  assert.equal(readNavigationTarget("?view=directory").view, "directory");
  assert.equal(readNavigationTarget("?view=dossiers").view, "dossiers");
  assert.equal(readNavigationTarget("?view=admin").view, "tree");
  assert.equal(readNavigationTarget("").view, "tree");
  assert.equal(readRestorableView("?view=directory"), "directory");
  assert.equal(readRestorableView("?view=admin"), "tree");
  assert.equal(readRestorableView(""), "tree");
});

test("chaque fiche de détail est identifiée par son identifiant stable", () => {
  assert.deepEqual(readNavigationTarget("?view=personDetail&id=p1"), { view: "personDetail", id: "p1" });
  assert.deepEqual(readNavigationTarget("?view=documentDetail&id=doc-1"), { view: "documentDetail", id: "doc-1" });
  assert.deepEqual(readNavigationTarget("?view=sourceDetail&id=s1"), { view: "sourceDetail", id: "s1" });
  assert.deepEqual(readNavigationTarget("?view=proofDetail&id=pr1"), { view: "proofDetail", id: "pr1" });
  assert.deepEqual(readNavigationTarget("?view=dossiers&id=d1"), { view: "dossiers", id: "d1" });
  assert.deepEqual([...DETAIL_VIEWS], ["personDetail", "documentDetail", "sourceDetail", "proofDetail"]);
  for (const view of DETAIL_VIEWS) assert.equal(isDetailTarget({ view, id: "x" }), true);
  assert.equal(isDetailTarget({ view: "dossiers", id: "x" }), true);
  assert.equal(isDetailTarget({ view: "dossiers", id: "" }), false);
  assert.equal(isDetailTarget({ view: "directory", id: "" }), false);
});

test("une fiche sans identifiant valide dégénère vers sa vue d’origine", () => {
  assert.deepEqual(readNavigationTarget("?view=personDetail"), { view: "directory", id: "" });
  assert.deepEqual(readNavigationTarget("?view=documentDetail&id="), { view: "documents", id: "" });
  assert.deepEqual(readNavigationTarget("?view=sourceDetail&id=%00"), { view: "genealogy", id: "" });
  assert.deepEqual(readNavigationTarget(`?view=proofDetail&id=${"x".repeat(300)}`), { view: "genealogy", id: "" });
  assert.deepEqual(readNavigationTarget("?view=personDetail&id=p1&mode=dark"), { view: "personDetail", id: "p1" });
  assert.equal(detailBaseView("personDetail"), "directory");
  assert.equal(detailBaseView("documentDetail"), "documents");
  assert.equal(detailBaseView("sourceDetail"), "genealogy");
  assert.equal(detailBaseView("proofDetail"), "genealogy");
  assert.equal(detailBaseView("dossiers"), "dossiers");
});

test("l’URL conserve les autres paramètres et l’ancre, et port l’identifiant de fiche", () => {
  const location = { href: "https://example.test/app?mode=dark#section" };
  assert.equal(navigationUrl(location, "documents"), "/app?mode=dark&view=documents#section");
  assert.equal(navigationUrl(location, "personDetail", "p1"), "/app?mode=dark&view=personDetail&id=p1#section");
  assert.equal(navigationUrl(location, "dossiers", "d1"), "/app?mode=dark&view=dossiers&id=d1#section");
  assert.equal(
    navigationUrl({ href: "https://example.test/app?view=personDetail&id=p1&mode=dark#section" }, "tree"),
    "/app?mode=dark#section",
    "le retour à l’arbre retire vue et identifiant"
  );
  assert.equal(
    navigationUrl({ href: "https://example.test/app?view=personDetail&id=p1&mode=dark#section" }, "directory"),
    "/app?view=directory&mode=dark#section",
    "une vue principale ne porte pas d’identifiant de fiche"
  );
  assert.equal(
    navigationUrl({ href: "https://example.test/app?view=documents&id=stale" }, "documents"),
    "/app?view=documents",
    "un identifiant orphelin est retiré"
  );
});

test("aucune boucle d’historique : une URL déjà correcte ne crée jamais d’entrée", () => {
  const url = "/app?view=personDetail&id=p1";
  assert.equal(historyAction({ currentUrl: url, nextUrl: url, mode: "push", viewChanged: true }), "none");
  assert.equal(historyAction({ currentUrl: url, nextUrl: url, mode: "replace" }), "none");
  assert.equal(historyAction({ currentUrl: url, nextUrl: "/app?view=directory", mode: "none" }), "none", "retour système : aucune écriture");
  assert.equal(historyAction({ currentUrl: url, nextUrl: "/app?view=directory", mode: "push", locked: true }), "none", "pendant un retour/avant : aucune écriture");
  assert.equal(historyAction({ currentUrl: url, nextUrl: "" }), "none");
});

test("une nouvelle vue crée une entrée, une nouvelle fiche remplace la sienne", () => {
  assert.equal(
    historyAction({ currentUrl: "/app?view=directory", nextUrl: "/app?view=personDetail&id=p1", mode: "push", viewChanged: true }),
    "push",
    "ouverture d’une fiche depuis une autre vue"
  );
  assert.equal(
    historyAction({ currentUrl: "/app?view=personDetail&id=p1", nextUrl: "/app?view=personDetail&id=p2", mode: "push", viewChanged: false }),
    "replace",
    "deux personnes successives : pas d’entrée supplémentaire"
  );
  assert.equal(
    historyAction({ currentUrl: "/app?view=personDetail&id=p1", nextUrl: "/app?view=directory", mode: "push", viewChanged: true }),
    "push",
    "fermeture d’une fiche : Retour la rouvre"
  );
  assert.equal(
    historyAction({ currentUrl: "/app?view=directory", nextUrl: "/app?view=tree", mode: "replace" }),
    "replace",
    "normalisation après authentification"
  );
});
