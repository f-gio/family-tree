import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FIREBASE_PROJECT_IDS, firebaseConfigurationMatchesEnvironment, firebaseProjectIdMatches, resolveFirebaseEnvironment } from "../js/firebase-environment.js";

const root = new URL("../", import.meta.url);
const [appSource, html, css] = await Promise.all([
  readFile(new URL("js/app.js", root), "utf8"),
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8")
]);

test("Production est autorisée uniquement sur GitHub Pages et son chemin projet HTTPS", () => {
  const production = resolveFirebaseEnvironment({ protocol: "https:", hostname: "f-gio.github.io", pathname: "/family-tree/" });
  assert.equal(production.allowed, true);
  assert.equal(production.environment, "production");
  assert.equal(production.firebaseConfig.projectId, "family-tree-c2fe2");
  assert.equal(firebaseConfigurationMatchesEnvironment("production", production.firebaseConfig), true);
  for (const pathname of ["/", "/other-project/", "/family-tree-other/", "/Family-tree/"]) {
    assert.equal(resolveFirebaseEnvironment({ protocol: "https:", hostname: "f-gio.github.io", pathname }).allowed, false, `${pathname} refusé`);
  }
  assert.equal(resolveFirebaseEnvironment({ protocol: "http:", hostname: "f-gio.github.io", pathname: "/family-tree/" }).allowed, false, "HTTP Production refusé");
});

test("Recette est autorisée uniquement sur son hostname HTTPS exact", () => {
  const recette = resolveFirebaseEnvironment({ protocol: "https:", hostname: "la-nostra-storia-recette.web.app", pathname: "/" });
  assert.equal(recette.allowed, true);
  assert.equal(recette.environment, "recette");
  assert.equal(recette.firebaseConfig.projectId, "la-nostra-storia-recette");
  assert.equal(firebaseConfigurationMatchesEnvironment("recette", recette.firebaseConfig), true);
  for (const hostname of ["la-nostra-storia-recette.firebaseapp.com", "la-nostra-storia-recette.web.app.evil.test", "other.web.app"]) {
    assert.equal(resolveFirebaseEnvironment({ protocol: "https:", hostname, pathname: "/" }).allowed, false, `${hostname} refusé`);
  }
  assert.equal(resolveFirebaseEnvironment({ protocol: "http:", hostname: "la-nostra-storia-recette.web.app", pathname: "/" }).allowed, false, "HTTP Recette refusé");
});

test("localhost et 127.0.0.1 utilisent exclusivement le projet fictif et les émulateurs", () => {
  for (const hostname of ["localhost", "127.0.0.1"]) {
    const local = resolveFirebaseEnvironment({ protocol: "http:", hostname, pathname: "/" });
    assert.equal(local.allowed, true);
    assert.equal(local.environment, "local");
    assert.equal(local.firebaseConfig.projectId, "family-tree-emulator-test");
    assert.equal(firebaseConfigurationMatchesEnvironment("local", local.firebaseConfig), true);
    assert.equal(local.emulators.auth.host, "127.0.0.1");
    assert.equal(local.emulators.auth.port, 9099);
    assert.equal(local.emulators.firestore.host, "127.0.0.1");
    assert.equal(local.emulators.firestore.port, 8080);
    assert.notEqual(local.firebaseConfig.projectId, FIREBASE_PROJECT_IDS.production);
    assert.notEqual(local.firebaseConfig.projectId, FIREBASE_PROJECT_IDS.recette);
  }
});

test("origine inconnue et file:// refusés sans configuration Firebase", () => {
  for (const location of [
    { protocol: "https:", hostname: "preview.example.test", pathname: "/" },
    { protocol: "file:", hostname: "", pathname: "/C:/family-tree/index.html" },
    { protocol: "https:", hostname: "localhost.evil.test", pathname: "/" },
    {}
  ]) {
    const result = resolveFirebaseEnvironment(location);
    assert.equal(result.allowed, false);
    assert.equal(result.environment, "unknown");
    assert.equal("firebaseConfig" in result, false, "aucune configuration n’est fournie en mode bloqué");
  }
});

test("une configuration Firebase croisée ou incomplète est refusée", () => {
  assert.equal(firebaseProjectIdMatches("production", { projectId: "la-nostra-storia-recette" }), false);
  assert.equal(firebaseProjectIdMatches("recette", { projectId: "family-tree-c2fe2" }), false);
  assert.equal(firebaseProjectIdMatches("local", { projectId: "family-tree-c2fe2" }), false);
  assert.equal(firebaseProjectIdMatches("inconnu", { projectId: "family-tree-c2fe2" }), false);
  const recette = resolveFirebaseEnvironment({ protocol: "https:", hostname: "la-nostra-storia-recette.web.app", pathname: "/" });
  assert.equal(firebaseConfigurationMatchesEnvironment("recette", { ...recette.firebaseConfig, authDomain: "family-tree-c2fe2.firebaseapp.com" }), false);
  assert.equal(firebaseConfigurationMatchesEnvironment("recette", { ...recette.firebaseConfig, apiKey: "" }), false);
});

test("app.js bloque un environnement invalide avant toute initialisation Firebase", () => {
  const resolver = appSource.indexOf("const firebaseEnvironment = resolveFirebaseEnvironment(window.location)");
  const rejection = appSource.indexOf("throw new Error(`Initialisation Firebase refusée", resolver);
  const configCheck = appSource.indexOf("firebaseConfigurationMatchesEnvironment(firebaseEnvironment.environment, firebaseEnvironment.firebaseConfig)", resolver);
  const initialize = appSource.indexOf("initializeApp(firebaseEnvironment.firebaseConfig)");
  const auth = appSource.indexOf("getAuth(app)");
  const firestore = appSource.indexOf("getFirestore(app)");
  assert.ok(resolver >= 0 && configCheck > resolver && rejection > configCheck && initialize > rejection);
  assert.ok(auth > initialize && firestore > initialize);
  assert.match(appSource, /if \(firebaseEnvironment\.environment === "local"\) \{[\s\S]*?connectAuthEmulator\(auth,[\s\S]*?connectFirestoreEmulator\(db,/);
  assert.match(appSource, /if \(firebaseEnvironment\.environment === "recette"\) \{[\s\S]*?environmentBadgeAuth\.hidden = false[\s\S]*?environmentBadgeApp\.hidden = false/);
});

test("le badge RECETTE existe dans l’écran de connexion et le header, caché par défaut", () => {
  assert.match(html, /id="environmentBadgeAuth" class="environment-badge"[^>]*hidden>RECETTE<\/span>/);
  assert.match(html, /id="environmentBadgeApp" class="environment-badge"[^>]*hidden>RECETTE<\/span>/);
  assert.match(css, /\.environment-badge\s*\{[\s\S]*?background:\s*var\(--color-accent\)[\s\S]*?color:\s*var\(--color-surface\)/);
});
