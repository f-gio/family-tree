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

test("l'artefact Recette n'autorise que son hostname HTTPS", async () => {  const source = await readFile(new URL("../js/firebase-environment.js", import.meta.url), "utf8");
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

test("le transform accepte aussi un clone propre dépourvu des réglages locaux", async () => {
  const source = (await readFile(new URL("../js/firebase-environment.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  // Reproduit l'état d'un clone propre : réglage LAN, branche d'émulateurs et
  // détecteur RFC1918 absents. Ces blocs ne sont retirés que s'ils existent.
  const clean = source
    .replace('/* Hôte commun pour le PC et les appareils du LAN pendant les essais locaux. */\nconst localEmulatorHost = "192.168.1.14";\n\n', "")
    .replace(`  if (environment === "local") {
    result.emulators = Object.freeze({
      auth: Object.freeze({ host: localEmulatorHost, port: 9099 }),
      firestore: Object.freeze({ host: localEmulatorHost, port: 8080 })
    });
  }
`, `  if (environment === "local") {
    result.emulators = Object.freeze({
      auth: Object.freeze({ host: "127.0.0.1", port: 9099 }),
      firestore: Object.freeze({ host: "127.0.0.1", port: 8080 })
    });
  }
`)
    .replace(/\/\* IP privées RFC1918[\s\S]*?export function resolveFirebaseEnvironment/, "export function resolveFirebaseEnvironment")
    .replace(/ {2}if \(isPrivateIpv4Hostname\(hostname\)\) \{[\s\S]*? {2}return denied\("unrecognized-hostname"\);/, '  return denied("unrecognized-hostname");');
  const hadLocalSettings = source.includes("localEmulatorHost");
  if (hadLocalSettings) assert.notEqual(clean, source, "le fixture retire bien les réglages locaux de l’arbre local");
  assert.equal(clean.includes("localEmulatorHost"), false, "réglage LAN absent du clone propre");
  assert.equal(clean.includes("isPrivateIpv4Hostname"), false, "détecteur RFC1918 absent du clone propre");
  assert.equal(clean.includes('auth: Object.freeze({ host: "127.0.0.1", port: 9099 })'), true, "branche d’émulateurs historique présente");

  const recipeSource = buildRecetteOnlyEnvironment(clean);
  for (const forbidden of ["family-tree-c2fe2", "family-tree-c2fe2.firebaseapp.com", "family-tree-emulator-test", "local-emulator-only", "192.168.1.14", "127.0.0.1", "9099", "8080", "isPrivateIpv4Hostname", "localEmulatorHost"]) {
    assert.ok(!recipeSource.includes(forbidden), `référence non Recette subsistant depuis un clone propre : ${forbidden}`);
  }
  assert.ok(recipeSource.includes('projectId: "la-nostra-storia-recette"'));
});
