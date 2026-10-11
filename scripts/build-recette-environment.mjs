import assert from "node:assert/strict";

/* Produit un résolveur Firebase dédié à l'artefact Recette.
   Le source partagé conserve les trois environnements pour GitHub Pages et le
   développement local ; l'artefact Hosting Recette ne doit contenir aucune
   configuration ou route activable vers le projet Production. */
export function buildRecetteOnlyEnvironment(source) {
  let output = source.replace(/\r\n/g, "\n");
  const projectIdLine = '  production: "family-tree-c2fe2",\n';
  assert.ok(output.includes(projectIdLine), "l’ID Production attendu doit être identifiable pour l’exclure de l’artefact Recette");
  output = output.replace(projectIdLine, "");

  const configsStart = output.indexOf("const firebaseConfigs = Object.freeze({");
  const productionStart = output.indexOf("  production: Object.freeze({", configsStart);
  const recetteStart = output.indexOf("  recette: Object.freeze({", productionStart);
  assert.ok(configsStart >= 0 && productionStart > configsStart && recetteStart > productionStart,
    "bloc de configuration Firebase attendu dans firebase-environment.js");
  output = output.slice(0, productionStart) + output.slice(recetteStart);

  const productionHostStart = output.indexOf('  if (hostname === "f-gio.github.io") {');
  const recetteHostStart = output.indexOf('  if (hostname === "la-nostra-storia-recette.web.app")', productionHostStart);
  assert.ok(productionHostStart >= 0 && recetteHostStart > productionHostStart,
    "route d’origine Production attendue dans le résolveur Firebase");
  output = output.slice(0, productionHostStart)
    + '  if (hostname === "f-gio.github.io") return denied("production-unavailable-in-recette-build");\n'
    + output.slice(recetteHostStart);

  for (const forbidden of ["family-tree-c2fe2", "family-tree-c2fe2.firebaseapp.com", "1096091899254", "1:1096091899254:"]) {
    assert.ok(!output.includes(forbidden), `référence Production interdite dans l’artefact Recette : ${forbidden}`);
  }
  assert.ok(output.includes('projectId: "la-nostra-storia-recette"'), "configuration Firebase Recette conservée");
  assert.ok(output.includes('projectId: "family-tree-emulator-test"'), "configuration Emulator locale conservée");
  return output;
}
