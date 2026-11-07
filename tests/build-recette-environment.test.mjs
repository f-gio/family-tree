import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRecetteOnlyEnvironment } from "../scripts/build-recette-environment.mjs";

test("le résolveur de l'artefact Recette exclut Production, les émulateurs et les adresses LAN", async () => {
  const source = await readFile(new URL("../js/firebase-environment.js", import.meta.url), "utf8");
  const recipeSource = buildRecetteOnlyEnvironment(source);
  for (const forbidden of ["family-tree-c2fe2", "family-tree-c2fe2.firebaseapp.com", "lanostrastoria.web.app", "1096091899254", "1:1096091899254:", "family-tree-emulator-test", "local-emulator-only", "192.168.1.14", "127.0.0.1", "9099", "8080"]) {
    assert.ok(!recipeSource.includes(forbidden), `référence d'environnement non Recette exclue : ${forbidden}`);
  }
  assert.ok(recipeSource.includes('projectId: "la-nostra-storia-recette"'));
  assert.ok(recipeSource.includes('hostname === "la-nostra-storia-recette.web.app"'));
});

test("l'artefact Recette n'autorise que son hostname HTTPS", async () => {
  const source = await readFile(new URL("../js/firebase-environment.js", import.meta.url), "utf8");
  const recipeSource = buildRecetteOnlyEnvironment(source);
  const recipeModule = await import(`data:text/javascript;base64,${Buffer.from(recipeSource).toString("base64")}`);
  const production = recipeModule.resolveFirebaseEnvironment({ hostname: "f-gio.github.io", protocol: "https:", pathname: "/family-tree" });
  const shortProduction = recipeModule.resolveFirebaseEnvironment({ hostname: "lanostrastoria.web.app", protocol: "https:", pathname: "/" });
  const recette = recipeModule.resolveFirebaseEnvironment({ hostname: "la-nostra-storia-recette.web.app", protocol: "https:", pathname: "/" });
  const local = recipeModule.resolveFirebaseEnvironment({ hostname: "localhost", protocol: "http:", pathname: "/" });
  const lan = recipeModule.resolveFirebaseEnvironment({ hostname: "192.168.1.14", protocol: "http:", pathname: "/" });
  assert.equal(production.allowed, false);
  assert.equal(production.environment, "unknown");
  assert.equal(shortProduction.allowed, false);
  assert.equal(shortProduction.environment, "unknown");
  assert.equal(recette.allowed, true);
  assert.equal(recette.environment, "recette");
  assert.equal(recette.firebaseConfig.projectId, "la-nostra-storia-recette");
  assert.equal(local.allowed, false);
  assert.equal(lan.allowed, false);
});
