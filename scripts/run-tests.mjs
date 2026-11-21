/* Sélection de familles de tests — aucun framework supplémentaire.
   Repose sur le runner natif Node (--test) et la détection simple de Playwright
   dans le source des fichiers de test.

   Usage :
     node scripts/run-tests.mjs unit [--filter <texte>] [--list]
         tests/*.test.mjs SANS Playwright (ni émulateur requis ; les suites
         concernées se sautent proprement)
     node scripts/run-tests.mjs browser [--filter <texte>] [--list]
         tests/*.test.mjs AVEC Playwright
     --filter <texte>  ne retient que les fichiers dont le nom contient
                       <texte> (insensible à la casse) — ex. --filter person
     --list            liste les fichiers retenus sans exécuter

   Le code de sortie du sous-processus est propagé tel quel (aucun échec masqué).
   Aucun accès réseau ni Firebase : les garde-fous des tests s'appliquent. */

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const families = ["unit", "browser"];

const positional = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
const family = positional[0];
const listOnly = process.argv.includes("--list");
const filterIndex = process.argv.indexOf("--filter");
const filter = filterIndex >= 0 ? process.argv[filterIndex + 1] : null;
if (filterIndex >= 0 && !filter) {
  console.error("--filter exige un texte");
  process.exit(2);
}
if (!families.includes(family)) {
  console.error("usage : node scripts/run-tests.mjs <unit|browser> [--filter <texte>] [--list]");
  process.exit(2);
}

const testsDir = join(ROOT, "tests");
const all = readdirSync(testsDir).filter(name => name.endsWith(".test.mjs")).sort();
const selected = all.filter(name => {
  if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return false;
  const usesPlaywright = readFileSync(join(testsDir, name), "utf8").includes("playwright");
  return family === "browser" ? usesPlaywright : !usesPlaywright;
});

if (selected.length === 0) {
  console.error(`run-tests : aucun fichier dans la famille ${family}${filter ? ` (filter: ${filter})` : ""}`);
  process.exit(1);
}
console.log(`Famille ${family}${filter ? ` / filtre « ${filter} »` : ""} : ${selected.length} fichier(s) sur ${all.length}`);

if (listOnly) {
  for (const name of selected) console.log(`  tests/${name}`);
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--test", ...selected.map(name => `tests/${name}`)], {
  cwd: ROOT,
  stdio: "inherit"
});
if (result.error) {
  console.error(`run-tests : impossible de lancer node --test : ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
