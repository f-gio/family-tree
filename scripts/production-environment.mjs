import assert from "node:assert/strict";

/* Produit un résolveur Firebase dédié à l'artefact Production.
   Le source partagé conserve les environnements Recette et local pour le
   développement (dont le support LAN) ; l'artefact publié ne doit contenir
   aucune configuration, route, détecteur ou hôte permettant de sélectionner
   autre chose que la Production.

   Chaque exclusion est explicite et vérifiée : si un élément interdit
   subsiste, la construction échoue au lieu de publier une configuration
   locale. Aucune transformation ne repose sur des numéros de lignes. */
export function productionOnlyEnvironment(source) {
  let output = source.replace(/\r\n/g, "\n");

  // 1. Identifiants de projet : seuls ceux de la Production subsistent.
  assert.ok(output.includes('  recette: "la-nostra-storia-recette",\n  local: "family-tree-emulator-test"'), "les environnements Recette et local doivent être repérables avant exclusion");
  output = output.replace('  recette: "la-nostra-storia-recette",\n  local: "family-tree-emulator-test"', "");

  // 2. Configurations Firebase : Recette et local retirées.
  const isolatedConfigs = output.replace(/\n  recette: Object\.freeze\(\{[\s\S]*?\n  local: Object\.freeze\(\{[\s\S]*?\n  \}\)\n\}\);/, "\n});");
  assert.notEqual(isolatedConfigs, output, "les configurations Firebase Recette/local doivent être retirées du build Production");
  output = isolatedConfigs;

  // 3. Route Hosting Recette retirée.
  const recetteRouteRemoved = output.replace(/  if \(hostname === "la-nostra-storia-recette\.web\.app"\) \{\n[\s\S]*?\n  \}\n/, "");
  assert.notEqual(recetteRouteRemoved, output, "la route Hosting Recette doit être retirée du build Production");
  output = recetteRouteRemoved;

  // 4. Réglage d'hôte d'émulateur local (commentaire + constante), quelle que
  //    soit la valeur configurée localement par le développeur.
  const localHostPattern = /\/\*(?:[^*]|\*(?!\/))*\*\/\nconst localEmulatorHost = "[^"]*";[^\n]*\n\n/;
  const withoutLocalHost = output.replace(localHostPattern, "");
  assert.notEqual(withoutLocalHost, output, "le réglage d'hôte d'émulateur local doit être repéré avant exclusion");
  output = withoutLocalHost;

  // 5. Bloc de configuration des émulateurs de l'environnement local.
  const withoutEmulators = output.replace(/  if \(environment === "local"\) \{\n    result\.emulators = Object\.freeze\(\{[\s\S]*?\n    \}\);\n  \}\n/, "");
  assert.notEqual(withoutEmulators, output, "la configuration des émulateurs doit être retirée du build Production");
  output = withoutEmulators;

  // 6. Détecteur de plages privées (commentaire + fonction).
  const privateHostStart = output.indexOf("/* IP privées RFC1918 uniquement");
  if (privateHostStart >= 0) {
    const resolverStart = output.indexOf("export function resolveFirebaseEnvironment", privateHostStart);
    assert.ok(resolverStart > privateHostStart, "le détecteur des hôtes locaux doit être identifiable pour l'exclure du build Production");
    output = output.slice(0, privateHostStart) + output.slice(resolverStart);
  }

  // 7. Route des adresses privées.
  const privateRouteStart = output.indexOf("  if (isPrivateIpv4Hostname(hostname)) {");
  if (privateRouteStart >= 0) {
    const fallbackStart = output.indexOf('  return denied("unrecognized-hostname");', privateRouteStart);
    assert.ok(fallbackStart > privateRouteStart, "la route des IP privées doit être identifiable pour l'exclure du build Production");
    output = output.slice(0, privateRouteStart) + output.slice(fallbackStart);
  }

  // 8. Origine locale refusée explicitement (jamais de configuration dedans).
  const localOrigin = output.replace(/  if \(hostname === "localhost" \|\| hostname === "127\.0\.0\.1"\) \{\n[\s\S]*?\n  \}\n/, '  if (hostname === "localhost" || hostname === "127.0.0.1") return denied("local-unavailable-in-production-build");\n');
  assert.notEqual(localOrigin, output, "l'origine locale doit être neutralisée dans le build Production");
  output = localOrigin;

  // 9. Aucune sélection d'environnement autre que la Production.
  assert.ok(!output.includes('allow("local")'), "l'environnement local ne doit pas être sélectionnable dans le build Production");
  assert.ok(!output.includes('allow("recette")'), "l'environnement Recette ne doit pas être sélectionnable dans le build Production");

  // 10. Interdits explicites : la moindre subsistance fait échouer la construction.
  for (const forbidden of [
    "la-nostra-storia-recette",   // projet / route Recette
    "family-tree-emulator-test",  // projet fictif local
    "local-emulator-only",        // clé de configuration locale
    "localEmulatorHost",          // réglage d'hôte d'émulateur
    "isPrivateIpv4Hostname",      // détecteur de plages privées
    "emulators",                  // bloc de configuration d'émulateurs
    "192.168."                    // adresse de développement historique
  ]) {
    assert.ok(!output.includes(forbidden), `Configuration non-production interdite dans l’artefact : ${forbidden}`);
  }
  // 11. Aucune adresse IP, sauf la boucle locale citée dans le refus explicite
  //     des origines de développement (jamais une adresse de réseau privé).
  for (const line of output.split("\n")) {
    for (const ip of line.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) || []) {
      assert.ok(ip === "127.0.0.1" && line.includes('denied("local-unavailable-in-production-build")'),
        `Adresse IP inattendue dans le résolveur Production : ${ip}`);
    }
  }
  assert.ok(!/\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/.test(output), "aucune adresse de réseau privé dans le résolveur Production");
  assert.ok(output.includes('production: "family-tree-c2fe2"'), "la configuration Production reste incluse");
  assert.ok(output.includes('projectId: "family-tree-c2fe2"'), "l’identifiant de projet Production reste inclus");
  return output;
}
