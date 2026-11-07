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
  const localProjectIdLine = '  local: "family-tree-emulator-test"\n';
  assert.ok(output.includes(localProjectIdLine), "l’ID de l’environnement local doit être identifiable pour l’exclure de l’artefact Recette");
  output = output.replace(localProjectIdLine, "");

  const configsStart = output.indexOf("const firebaseConfigs = Object.freeze({");
  const productionStart = output.indexOf("  production: Object.freeze({", configsStart);
  const recetteStart = output.indexOf("  recette: Object.freeze({", productionStart);
  assert.ok(configsStart >= 0 && productionStart > configsStart && recetteStart > productionStart,
    "bloc de configuration Firebase attendu dans firebase-environment.js");
  output = output.slice(0, productionStart) + output.slice(recetteStart);

  const localConfigStart = output.indexOf("  local: Object.freeze({", output.indexOf("const firebaseConfigs"));
  const localConfigEnd = output.indexOf("\n  })", localConfigStart);
  assert.ok(localConfigStart >= 0 && localConfigEnd > localConfigStart,
    "bloc de configuration locale attendu pour l’exclure de l’artefact Recette");
  output = output.slice(0, localConfigStart) + output.slice(localConfigEnd + "\n  })".length);
  const localHostSetting = '/* Hôte commun pour le PC et les appareils du LAN pendant les essais locaux. */\nconst localEmulatorHost = "192.168.1.14";\n\n';
  assert.ok(output.includes(localHostSetting), "le réglage d’émulateur LAN doit être identifiable pour l’exclure de l’artefact Recette");
  output = output.replace(localHostSetting, "");

  const emulatorBranch = `  if (environment === "local") {
    result.emulators = Object.freeze({
      auth: Object.freeze({ host: localEmulatorHost, port: 9099 }),
      firestore: Object.freeze({ host: localEmulatorHost, port: 8080 })
    });
  }
`;
  assert.ok(output.includes(emulatorBranch), "les points de connexion aux émulateurs doivent être identifiables pour l’artefact Recette");
  output = output.replace(emulatorBranch, "");

  const productionHostStart = output.indexOf('  if (hostname === "f-gio.github.io") {');
  const recetteHostStart = output.indexOf('  if (hostname === "la-nostra-storia-recette.web.app")', productionHostStart);
  assert.ok(productionHostStart >= 0 && recetteHostStart > productionHostStart,
    "route d’origine Production attendue dans le résolveur Firebase");
  output = output.slice(0, productionHostStart)
    + '  if (hostname === "f-gio.github.io") return denied("production-unavailable-in-recette-build");\n'
    + output.slice(recetteHostStart);

  const localOriginBranch = `  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return protocol === "http:" || protocol === "https:" ? allow("local") : denied("local-origin-invalid");
  }
`;
  assert.ok(output.includes(localOriginBranch), "les origines locales doivent être refusées dans l’artefact Recette");
  output = output.replace(localOriginBranch, '  if (hostname === "localhost") return denied("local-unavailable-in-recette-build");\n');

  const privateHostStart = output.indexOf("/* IP privées RFC1918 uniquement");
  const resolverStart = output.indexOf("export function resolveFirebaseEnvironment", privateHostStart);
  assert.ok(privateHostStart >= 0 && resolverStart > privateHostStart,
    "le détecteur des hôtes locaux doit être identifiable pour l’exclure de l’artefact Recette");
  output = output.slice(0, privateHostStart) + output.slice(resolverStart);
  const privateRouteStart = output.indexOf("  if (isPrivateIpv4Hostname(hostname)) {");
  const fallbackStart = output.indexOf('  return denied("unrecognized-hostname");', privateRouteStart);
  assert.ok(privateRouteStart >= 0 && fallbackStart > privateRouteStart,
    "la route des IP privées doit être identifiable pour l’exclure de l’artefact Recette");
  output = output.slice(0, privateRouteStart) + output.slice(fallbackStart);
  assert.ok(!output.includes("isPrivateIpv4Hostname"), "le détecteur RFC1918 ne doit pas rester dans l’artefact Recette");

  for (const forbidden of ["family-tree-c2fe2", "family-tree-c2fe2.firebaseapp.com", "1096091899254", "1:1096091899254:", "family-tree-emulator-test", "local-emulator-only", "192.168.1.14", "127.0.0.1", "9099", "8080"]) {
    assert.ok(!output.includes(forbidden), `référence Production interdite dans l’artefact Recette : ${forbidden}`);
  }
  assert.ok(output.includes('projectId: "la-nostra-storia-recette"'), "configuration Firebase Recette conservée");
  return output;
}
