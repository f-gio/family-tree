/* Gestion du jeton de cache des assets (« asset-release »).
   Source unique de vérité : la balise
       <meta name="asset-release" content="<jeton>">
   dans index.html ; TOUTES les références locales ?v= doivent porter la même
   valeur (contrat vérifié par tests/hosting-cache.test.mjs et
   tests/asset-release.test.mjs).

   Usage :
     node scripts/bump-asset-release.mjs --check [--file <chemin>]
         Vérifie la cohérence du fichier cible. AUCUNE modification. Code 0 si
         cohérent, 1 sinon.
     node scripts/bump-asset-release.mjs <nouveau-jeton> [--file <chemin>]
         Remplace l'ancien jeton par le nouveau dans la meta ET toutes les
         références ?v= du fichier cible, puis revérifie. Code 0 si réussi.

   Jeton attendu (convention du dépôt) : <séquence>-<slug>-<AAAAMMJJ>-<révision>
   Exemple : 24-unused-definitions-20261121-1
   Déterministe : aucun horodatage ni valeur aléatoire générés — le jeton est
   toujours fourni explicitement.

   Aucune dépendance externe. Windows/macOS/Linux. Ne touche qu'au fichier cible. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_RE = /^\d+-[a-z0-9]+(?:-[a-z0-9]+)*-\d{8}-\d+$/;
const META_RE = /<meta name="asset-release" content="([^"]*)">/;
const REF_RE = /\?v=([^"'\s&)]+)/g;

function fail(message) {
  console.error(`asset-release : ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = { file: null, check: false, token: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") result.check = true;
    else if (arg === "--file") {
      result.file = argv[index + 1];
      if (!result.file) fail("--file exige un chemin");
      index += 1;
    } else if (arg.startsWith("--")) fail(`option inconnue : ${arg}`);
    else if (result.token === null) result.token = arg;
    else fail("un seul jeton attendu");
  }
  if (result.check && result.token) fail("--check ne prend pas de jeton");
  if (!result.check && !result.token) fail("fournir un jeton ou --check");
  return result;
}

function analyze(text) {
  const meta = text.match(META_RE);
  if (!meta) return { ok: false, reason: "meta asset-release absente ou mal formée" };
  const token = meta[1];
  if (!TOKEN_RE.test(token)) return { ok: false, reason: `jeton meta hors convention : ${token}` };
  const refs = [...text.matchAll(REF_RE)].map(match => match[1]);
  if (refs.length === 0) return { ok: false, reason: "aucune référence ?v= trouvée" };
  const stray = refs.filter(value => value !== token);
  if (stray.length > 0) return { ok: false, reason: `${stray.length} référence(s) ?v= avec un jeton différent de la meta (ex. ${stray[0]})` };
  return { ok: true, token, refs: refs.length, occurrences: text.split(token).length - 1 };
}

const args = parseArgs(process.argv.slice(2));
const target = resolve(ROOT, args.file ?? "index.html");
const before = analyze(readFileSync(target, "utf8"));
if (!before.ok) fail(`${target} : ${before.reason}`);

if (args.check) {
  console.log(`asset-release : OK — jeton ${before.token}, ${before.refs} référence(s) ?v= + meta = ${before.occurrences} occurrence(s) cohérente(s)`);
  process.exit(0);
}

if (!TOKEN_RE.test(args.token)) fail(`jeton invalide (attendu <séquence>-<slug>-<AAAAMMJJ>-<révision>) : ${args.token}`);
if (args.token === before.token) fail(`le jeton fourni est déjà en place : ${args.token}`);

const source = readFileSync(target, "utf8");
const updated = source.split(before.token).join(args.token);
const after = analyze(updated);
if (!after.ok) fail(`après remplacement : ${after.reason}`);
if (after.occurrences !== before.occurrences) fail(`comptage incohérent : ${before.occurrences} → ${after.occurrences}`);
if (updated.includes(before.token)) fail("ancien jeton encore présent dans le fichier");
writeFileSync(target, updated, "utf8");
console.log(`asset-release : ${before.token} → ${args.token} (${before.occurrences} occurrence(s) remplacée(s) dans ${target})`);
