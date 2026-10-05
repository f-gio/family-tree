import assert from "node:assert/strict";
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "dist-recette");
const ENTRYPOINTS = ["index.html"];
const BLOCKED_SEGMENTS = new Set([
  ".git", ".firebase", "node_modules", "tests", "scripts", "dist-recette",
  "AGENTS.md", "firestore.rules", "package.json", "package-lock.json"
]);
const BLOCKED_EXTENSIONS = new Set([".md", ".log", ".rules"]);
const INCLUDED = new Set();

function assertInside(base, candidate, label) {
  const resolved = resolve(candidate);
  assert.ok(resolved === base || resolved.startsWith(base + sep), `${label} sort de la racine autorisée : ${resolved}`);
  return resolved;
}

function assertAllowedAsset(relativePath) {
  const normalizedPath = relativePath.split(sep).join("/");
  const segments = normalizedPath.split("/");
  assert.ok(!segments.some(segment => BLOCKED_SEGMENTS.has(segment)), `Élément interdit dans l’artefact : ${normalizedPath}`);
  assert.ok(!BLOCKED_EXTENSIONS.has(extname(normalizedPath).toLowerCase()), `Type interdit dans l’artefact : ${normalizedPath}`);
  assert.ok(!/^package(?:-lock)?\.json$/i.test(segments.at(-1)), `Manifest npm interdit dans l’artefact : ${normalizedPath}`);
  return normalizedPath;
}

function localReference(reference) {
  const value = reference.trim();
  if (!value || /^(?:#|data:|blob:|https?:|mailto:|javascript:|\/\/)/i.test(value)) return null;
  if (!value.startsWith("./") && !value.startsWith("../")) return null;
  return decodeURIComponent(value.split(/[?#]/, 1)[0]);
}

function htmlReferences(source) {
  const references = [];
  const attributePattern = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of source.matchAll(attributePattern)) references.push(match[2]);
  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) references.push(...cssReferences(match[1]));
  return references;
}

function cssReferences(source) {
  const references = [];
  for (const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) references.push(match[2]);
  for (const match of source.matchAll(/@import\s+(?:url\()?\s*(["'])(.*?)\1\s*\)?/gi)) references.push(match[2]);
  return references;
}

function javascriptReferences(source) {
  const references = [];
  for (const match of source.matchAll(/\bfrom\s*(["'])(.*?)\1/g)) references.push(match[2]);
  for (const match of source.matchAll(/\bimport\s*(["'])(.*?)\1/g)) references.push(match[2]);
  return references;
}

async function collectFrontendFiles(sourceRoot) {
  const root = resolve(sourceRoot);
  const pending = [...ENTRYPOINTS];
  const collected = new Set();
  while (pending.length) {
    const current = pending.pop();
    const sourcePath = assertInside(root, join(root, current), "Ressource frontend");
    const rel = assertAllowedAsset(relative(root, sourcePath));
    if (collected.has(rel)) continue;
    const source = await readFile(sourcePath, "utf8");
    collected.add(rel);
    const extension = extname(rel).toLowerCase();
    let references = [];
    if (extension === ".html") references = htmlReferences(source);
    else if (extension === ".js" || extension === ".mjs") references = javascriptReferences(source);
    else if (extension === ".css") references = cssReferences(source);
    for (const rawReference of references) {
      const reference = localReference(rawReference);
      if (!reference) continue;
      const child = assertInside(root, resolve(dirname(sourcePath), reference), `Dépendance de ${rel}`);
      pending.push(relative(root, child));
    }
  }
  return [...collected].sort();
}

async function listFiles(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Lien symbolique inattendu dans l’artefact : ${absolute}`);
    if (entry.isDirectory()) files.push(...await listFiles(absolute, base));
    else if (entry.isFile()) files.push(relative(base, absolute).split(sep).join("/"));
    else throw new Error(`Entrée spéciale inattendue dans l’artefact : ${absolute}`);
  }
  return files;
}

async function verifyServedFiles(outputRoot, files) {
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png"
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      const target = assertInside(outputRoot, join(outputRoot, normalize(relativePath)), "Requête HTTP locale");
      const bytes = await readFile(target);
      response.writeHead(200, { "content-type": contentTypes[extname(target).toLowerCase()] || "application/octet-stream" });
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end("404");
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/`;
    for (const file of files) {
      const response = await fetch(new URL(file.split("/").map(encodeURIComponent).join("/"), baseUrl));
      assert.equal(response.status, 200, `Ressource non servie depuis dist-recette : ${file}`);
      await response.body?.cancel();
    }
    return baseUrl;
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
  }
}

const files = await collectFrontendFiles(ROOT);
assert.ok(files.includes("index.html"), "index.html doit être l’entrée de l’artefact");
assert.ok(files.includes("css/design-system.css"), "la feuille de style commune doit être incluse");
assert.ok(files.includes("js/firebase-environment.js"), "le résolveur d’environnement doit être inclus");

const previousOutput = await (async () => {
  try {
    const info = await (await import("node:fs/promises")).lstat(OUTPUT);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), "dist-recette existant doit être un dossier généré ordinaire");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
})();
if (previousOutput) await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
for (const file of files) {
  const source = assertInside(ROOT, join(ROOT, file), "Source frontend");
  const target = assertInside(OUTPUT, join(OUTPUT, file), "Destination frontend");
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

const outputFiles = (await listFiles(OUTPUT)).sort();
assert.deepEqual(outputFiles, files, "dist-recette doit être exactement la fermeture des dépendances de la liste blanche");
for (const file of outputFiles) assertAllowedAsset(file);
const servedFrom = await verifyServedFiles(OUTPUT, outputFiles);
const totalBytes = (await Promise.all(outputFiles.map(async file => (await stat(join(OUTPUT, file))).size))).reduce((sum, size) => sum + size, 0);
const rootEntries = (await readdir(OUTPUT)).sort();

console.log("Artefact recette généré et servi localement sans contacter Firebase.");
console.log(`Racine dist-recette/: ${rootEntries.join(", ")}`);
console.log(`Fichiers inclus (${outputFiles.length}):\n${outputFiles.map(file => `  ${file}`).join("\n")}`);
console.log("Exclusions contrôlées : .git, .firebase, node_modules, tests, scripts, logs, Markdown, firestore.rules, AGENTS.md, package.json, package-lock.json.");
console.log(`Taille totale : ${totalBytes} octets (${(totalBytes / 1024).toFixed(1)} Kio).`);
console.log(`Vérification HTTP locale : ${outputFiles.length}/${outputFiles.length} ressources servies (origine ${servedFrom}).`);
