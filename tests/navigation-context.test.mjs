import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createNavigationContextStore, GENEALOGY_VIEW_CONTEXT_KEY } from "../js/navigation-context.js";

const [app, html, navigationContextSource] = await Promise.all([
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/navigation-context.js", import.meta.url), "utf8")
]);

test("le magasin de contextes de navigation conserve et isole les contextes par clé", () => {
  const store = createNavigationContextStore();
  assert.equal(store.has("archives"), false);
  assert.equal(store.load("archives"), null, "aucun contexte inventé pour une clé inconnue");
  store.save("archives", { scrollY: 420, search: "naissance" });
  assert.deepEqual(store.load("archives"), { scrollY: 420, search: "naissance" });
  assert.equal(store.has("archives"), true);
  /* Les copies sont isolées : muter le contexte chargé n'altère pas le stocké. */
  const loaded = store.load("archives");
  loaded.search = "modifié";
  assert.equal(store.load("archives").search, "naissance", "chargement sans effet de bord");
  store.save("autre", { scrollY: 0 });
  assert.deepEqual(store.load("autre"), { scrollY: 0 }, "clés indépendantes");
  store.clear("archives");
  assert.equal(store.has("archives"), false);
  assert.deepEqual(store.load("autre"), { scrollY: 0 }, "effacement ciblé sans effacement global");
  store.save("a", { x: 1 });
  store.clear();
  assert.equal(store.load("a"), null, "effacement global possible");
});

test("le module de contexte reste pur : ni DOM, ni historique, ni import externe", () => {
  assert.equal(GENEALOGY_VIEW_CONTEXT_KEY, "genealogy");
  assert.doesNotMatch(navigationContextSource, /\bdocument\.|\bwindow\.|history\./, "aucune dépendance DOM ou d'historique");
  assert.doesNotMatch(navigationContextSource, /from\s+["'][^"']*\//, "aucun import externe");
  assert.doesNotMatch(navigationContextSource, /\b(setDoc|addDoc|updateDoc|deleteDoc|onSnapshot|getDoc)\s*\(/, "aucun accès Firestore");
});

test("setView mémorise et restaure le contexte des Archives via le magasin commun", () => {
  assert.match(app, /from "\.\/navigation-context\.js"/, "module commun importé par app.js");
  assert.match(app, /const navigationContexts = createNavigationContextStore\(\)/, "magasin unique de l'application");
  assert.match(app, /let lastDisplayedView = "tree"/, "repère de dernière vue affichée");
  assert.match(app, /const viewChanged = view !== lastDisplayedView/, "changement de vue détecté");
  assert.match(app, /if \(viewChanged && lastDisplayedView === "genealogy"\) saveGenealogyViewContext\(\)/, "capture à la sortie des Archives");
  assert.match(app, /if \(view === "genealogy"\) restoreGenealogyViewContext\(\);\r?\n\s*lastDisplayedView = view;/, "restauration à l'entrée des Archives");
  const save = app.match(/function saveGenealogyViewContext\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(save.length > 100, "capture des Archives présente");
  assert.match(save, /scrollY: window\.scrollY/, "position de défilement mémorisée");
  assert.match(save, /search: \$\("genealogySearch"\)\?\.value/, "recherche Archives mémorisée");
  assert.match(save, /kind: \$\("genealogyKindFilter"\)\?\.value/, "filtre de catégorie mémorisé");
  const restore = app.match(/function restoreGenealogyViewContext\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(restore.length > 100, "restauration des Archives présente");
  assert.match(restore, /\$\("genealogySearch"\)\.value = context\.search/, "recherche restaurée");
  assert.match(restore, /dispatchEvent\(new Event\("input"\)\)/, "bouton d'effacement resynchronisé");
  assert.match(restore, /\$\("genealogyKindFilter"\)\.value = context\.kind/, "catégorie restaurée");
  assert.match(restore, /window\.scrollTo\(\{ left: 0, top: scrollY, behavior: "instant" \}\)/, "défilement restauré");
  /* La capture n'a lieu qu'en quittant les Archives, pas en restant dessus. */
  assert.match(app, /if \(viewChanged && lastDisplayedView === "genealogy"\) saveGenealogyViewContext\(\);/, "aucune capture en restant sur la vue");
});

test("l'atelier gare une entrée d'historique réelle et sort sans double nettoyage", () => {
  assert.match(app, /function markTranscriptionWorkshopHistory\(\)/, "marqueur d'entrée de l'atelier");
  assert.match(app, /history\.pushState\(\{ transcriptionWorkshop: true \}, ""\)/, "entrée réelle poussée à l'entrée dans l'atelier");
  assert.match(app, /if \(history\.state\?\.transcriptionWorkshop\) \{\r?\n\s*history\.replaceState\(\{ transcriptionWorkshop: true \}, ""\);/, "aucune pile d'entrées atelier");
  assert.match(app, /if \(!setView\("transcriptionWorkshop"\)\) return;\r?\n\s*markTranscriptionWorkshopHistory\(\);/, "marqueur posé seulement après entrée confirmée");
  /* Le marqueur est retiré de l'entrée courante à chaque sortie. */
  const teardown = app.match(/function teardownTranscriptionWorkshop\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(teardown, /if \(history\.state\?\.transcriptionWorkshop\) history\.replaceState\(null, ""\)/, "marqueur retiré à la sortie");
  /* Sortie unique : exitTranscriptionWorkshop délègue, setView nettoie une fois. */
  const exit = app.match(/function exitTranscriptionWorkshop\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(exit, /return leaveTranscriptionWorkshop\(\);/, "sortie commune déléguée");
  assert.doesNotMatch(exit, /teardownTranscriptionWorkshop|confirmTranscriptionWorkshopClose/, "aucun double nettoyage ni double confirmation dans la sortie bouton");
  const leave = app.match(/function leaveTranscriptionWorkshop\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(leave, /const target = transcriptionWorkshopReturn;/, "origine capturée avant nettoyage");
  assert.match(leave, /if \(!setView\(activeView\)\) return false;/, "nettoyage et confirmation assurés par setView, une seule fois");
  assert.match(leave, /restoreTranscriptionWorkshopOrigin\(target\);/, "origine restaurée après la sortie");
});

test("le retour système du navigateur s'appuie sur l'entrée réelle sans boucle", () => {
  const popstate = app.match(/window\.addEventListener\("popstate", \(\) => \{[\s\S]*?\n\}\);/)?.[0] || "";
  assert.ok(popstate.length > 100, "gestionnaire popstate présent");
  assert.match(popstate, /if \(!isTranscriptionWorkshopActive\(\)\) return;/, "sans effet hors atelier");
  assert.match(popstate, /if \(!leaveTranscriptionWorkshop\(\)\) \{\r?\n\s*history\.pushState\(\{ transcriptionWorkshop: true \}, ""\);/, "annulation : rétablissement de l'entrée consommée");
  assert.doesNotMatch(popstate, /teardownTranscriptionWorkshop\(\);\r?\n\s*setView\(activeView\)/, "aucun second nettoyage dans popstate");
  /* La sortie commune réutilise le Retour de l'atelier : même confirmation. */
  assert.match(popstate, /leaveTranscriptionWorkshop\(\)/, "même sortie que le bouton Retour");
});

test("l'origine de l'atelier conserve la pile de retour entre fiches", () => {
  const capture = app.match(/function captureTranscriptionWorkshopReturn\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(capture, /ficheReturn: genealogyItemReturn \? \{ \.\.\.genealogyItemReturn \} : null/, "pile de retour de la fiche appelante capturée");
  const restore = app.match(/function restoreTranscriptionWorkshopOrigin\(target\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(restore.length > 100, "restauration de l'origine présente");
  assert.match(restore, /openGenealogyItem\(target\.itemKind, target\.id, target\.pageId, target\.photoId\)/, "fiche d'origine rouverte");
  assert.match(restore, /genealogyItemReturn = \{ \.\.\.target\.ficheReturn \};/, "pile de retour restaurée");
  assert.match(restore, /const backButton = \$\("genealogyItemBackBtn"\);/, "bouton Retour de la fiche resynchronisé");
  assert.match(restore, /openStoredDocument\(documentItem, \{[\s\S]{0,180}pageContext: target\.pageContext \|\| null/, "page Document d'origine rouverte avec son contexte structuré (lot D)");
});

test("stopPrivateData ferme l'atelier et masque sa vue privée", () => {
  const stop = app.match(/function stopPrivateData\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(stop.length > 400, "arrêt des données privées présent");
  assert.match(stop, /if \(isTranscriptionWorkshopActive\(\)\) teardownTranscriptionWorkshop\(\);/, "atelier nettoyé à la perte d'accès");
  assert.match(stop, /\$\("transcriptionWorkshopView"\)\.hidden = true/, "vue de l'atelier masquée");
  assert.match(stop, /\$\("dossiersView"\)\.hidden = \$\("transcriptionWorkshopView"\)\.hidden = true/, "vue des démarches masquée");
});

test("le module de contexte est déclaré dans la carte d'import versionnée", () => {
  assert.match(html, /"\.\/js\/navigation-context\.js":"\.\/js\/navigation-context\.js\?v=[^"]+"/, "URL d'import versionnée présente");
});
