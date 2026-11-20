import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { productionOnlyEnvironment } from "../scripts/production-environment.mjs";

/* Durcissement du build Production : le résolveur publié doit rester
   sélectionnable uniquement pour la Production, quel que soit le réglage LAN
   présent dans l'arbre de travail du développeur. */

const source = await readFile(new URL("../js/firebase-environment.js", import.meta.url), "utf8");
const FORBIDDEN = [
  "la-nostra-storia-recette",
  "family-tree-emulator-test",
  "local-emulator-only",
  "localEmulatorHost",
  "isPrivateIpv4Hostname",
  "emulators",
  "192.168."
];

function assertProductionOnly(output, label) {
  for (const forbidden of FORBIDDEN) {
    assert.ok(!output.includes(forbidden), `${label} : configuration non-production interdite (${forbidden})`);
  }
  /* Aucune adresse IP, sauf la boucle locale citée dans le refus explicite
     des origines de développement. */
  for (const line of output.split("\n")) {
    for (const ip of line.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) || []) {
      assert.ok(ip === "127.0.0.1" && line.includes('denied("local-unavailable-in-production-build")'),
        `${label} : adresse IP inattendue (${ip})`);
    }
  }
  assert.ok(!/\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/.test(output), `${label} : aucune adresse de réseau privé`);
  assert.ok(!output.includes('allow("local")'), `${label} : environnement local non sélectionnable`);
  assert.ok(!output.includes('allow("recette")'), `${label} : environnement Recette non sélectionnable`);
  assert.ok(output.includes('production: "family-tree-c2fe2"'), `${label} : configuration Production conservée`);
  assert.ok(output.includes('projectId: "family-tree-c2fe2"'), `${label} : identifiant de projet Production conservé`);
}

test("le résolveur Production ne contient aucune configuration hors Production", () => {
  assertProductionOnly(productionOnlyEnvironment(source), "source du dépôt");
});

test("un réglage LAN local n’est jamais publié en Production", () => {
  /* Variante telle qu'un développeur peut la créer localement : hôte
     d'émulateur pointant sur l'IP du poste. Le build doit la neutraliser. */
  const lanVariant = source.replace(/const localEmulatorHost = "[^"]*";/, 'const localEmulatorHost = "192.168.1.14";');
  assert.notEqual(lanVariant, source, "la variante LAN est bien simulée");
  const output = productionOnlyEnvironment(lanVariant);
  assertProductionOnly(output, "variante LAN");
  assert.ok(!output.includes("192.168.1.14"), "variante LAN : l’adresse locale est retirée");
});

test("la sélection d’environnement reste fermée : localhost est refusé", () => {
  const output = productionOnlyEnvironment(source);
  assert.ok(
    output.includes('if (hostname === "localhost" || hostname === "127.0.0.1") return denied("local-unavailable-in-production-build");'),
    "l’origine locale est neutralisée par un refus explicite"
  );
});

test("le résolveur généré sélectionne uniquement les origines Production", async () => {
  const output = productionOnlyEnvironment(source);
  const generated = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  const production = generated.resolveFirebaseEnvironment({ hostname: "lanostrastoria.web.app", protocol: "https:", pathname: "/" });
  assert.equal(production.allowed, true, "site officiel accepté");
  assert.equal(production.environment, "production");
  assert.equal(generated.resolveFirebaseEnvironment({ hostname: "family-tree-c2fe2.web.app", protocol: "https:", pathname: "/" }).allowed, true, "domaine court accepté");
  assert.equal(generated.resolveFirebaseEnvironment({ hostname: "f-gio.github.io", protocol: "https:", pathname: "/family-tree/" }).allowed, true, "GitHub Pages accepté");
  assert.equal(generated.resolveFirebaseEnvironment({ hostname: "la-nostra-storia-recette.web.app", protocol: "https:", pathname: "/" }).allowed, false, "Recette refusée");
  assert.equal(generated.resolveFirebaseEnvironment({ hostname: "localhost", protocol: "http:", pathname: "/" }).allowed, false, "localhost refusé");
  assert.equal(generated.resolveFirebaseEnvironment({ hostname: "127.0.0.1", protocol: "http:", pathname: "/" }).allowed, false, "boucle locale refusée");
  assert.equal(generated.resolveFirebaseEnvironment({ hostname: "192.168.1.14", protocol: "http:", pathname: "/" }).allowed, false, "IP privée refusée");
  assert.equal(generated.resolveFirebaseEnvironment({ hostname: "f-gio.github.io", protocol: "http:", pathname: "/family-tree/" }).allowed, false, "GitHub Pages sans HTTPS refusé");
});
