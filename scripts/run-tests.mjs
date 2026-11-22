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
     --concurrency <n> fichiers de test exécutés en parallèle (n >= 1).
                       Défaut : 1 pour la famille browser, concurrence native
                       de Node pour la famille unit.
     --list            liste les fichiers retenus sans exécuter

   Pourquoi browser = 1 par défaut : sous concurrence native (8 cœurs → 7
   fichiers simultanés), la campagne complète échoue de façon non reproductible
   sur des assertions de visibilité ou de délai (3 campagnes sur 3 : 2 à 5
   échecs, toujours des tests différents, tous verts en exécution isolée).
   Exécutée séquentiellement, la même campagne est verte (408 tests, 0 échec,
   ≈18 min). La cause démontrée est la charge, pas le code : aucun test n'est
   désactivé et aucun délai n'est relevé. --concurrency accélère une session
   locale au prix de cette stabilité.

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
const concurrencyIndex = process.argv.indexOf("--concurrency");
const concurrency = concurrencyIndex >= 0 ? process.argv[concurrencyIndex + 1] : null;
if (concurrencyIndex >= 0 && !concurrency) {
  console.error("--concurrency exige un entier >= 1");
  process.exit(2);
}
if (concurrency && !/^[1-9]\d*$/.test(concurrency)) {
  console.error(`--concurrency invalide : « ${concurrency} » (entier >= 1 attendu)`);
  process.exit(2);
}
if (!families.includes(family)) {
  console.error("usage : node scripts/run-tests.mjs <unit|browser> [--filter <texte>] [--concurrency <n>] [--list]");
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
const workers = concurrency ?? (family === "browser" ? "1" : null);
console.log(`Famille ${family}${filter ? ` / filtre « ${filter} »` : ""} : ${selected.length} fichier(s) sur ${all.length} · concurrence : ${workers ?? "native Node"}`);

if (listOnly) {
  for (const name of selected) console.log(`  tests/${name}`);
  process.exit(0);
}

const nodeArgs = ["--test"];
if (workers) nodeArgs.push(`--test-concurrency=${workers}`);
nodeArgs.push(...selected.map(name => `tests/${name}`));
const result = spawnSync(process.execPath, nodeArgs, {
  cwd: ROOT,
  stdio: "inherit"
});
if (result.error) {
  console.error(`run-tests : impossible de lancer node --test : ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
