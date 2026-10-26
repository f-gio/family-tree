import assert from "node:assert/strict";
import { createServer } from "node:http";
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "dist-production");
const PDFJS_PACKAGE = resolve(ROOT, "node_modules/pdfjs-dist");
const PDFJS_PREFIX = "vendor/pdfjs/";
const STATIC_ROOTS = ["css", "js", "La_Nostra_Storia_icons"];

function inside(base, candidate, label) {
  const path = resolve(candidate);
  assert.ok(path === base || path.startsWith(base + sep), `${label} hors racine permise : ${path}`);
  return path;
}

async function listFiles(folder, root = folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Lien symbolique interdit dans le build : ${path}`);
    if (entry.isDirectory()) files.push(...await listFiles(path, root));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
    else throw new Error(`Entrée spéciale interdite dans le build : ${path}`);
  }
  return files;
}

async function productionFiles() {
  const files = ["index.html"];
  for (const folder of STATIC_ROOTS) {
    const absolute = inside(ROOT, join(ROOT, folder), "Ressource frontend");
    files.push(...(await listFiles(absolute)).map(path => `${folder}/${path}`));
  }
  const pdfFiles = ["pdf.mjs", "pdf.worker.mjs", "LICENSE"];
  for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    const absolute = inside(PDFJS_PACKAGE, join(PDFJS_PACKAGE, folder), "Ressource PDF.js");
    pdfFiles.push(...(await listFiles(absolute)).map(path => `${folder}/${path}`));
  }
  files.push(...pdfFiles.map(path => `${PDFJS_PREFIX}${path}`));
  return [...new Set(files)].sort();
}

async function verifyFirebaseEnvironment() {
  const source = await readFile(join(ROOT, "js/firebase-environment.js"), "utf8");
  assert.match(source, /production:\s*"family-tree-c2fe2"/);
  assert.match(source, /hostname === "family-tree-c2fe2\.web\.app"[\s\S]*?allow\("production"\)/);
  assert.match(source, /hostname === "la-nostra-storia-recette\.web\.app"[\s\S]*?allow\("recette"\)/);
  const productionConfig = JSON.parse(await readFile(join(ROOT, "firebase.production.json"), "utf8"));
  assert.equal(productionConfig.hosting.public, "dist-production");
  assert.equal("firestore" in productionConfig, false, "la configuration dédiée ne cible que Hosting");
}

function productionOnlyEnvironment(source) {
  let output = source.replace(/\r\n/g, "\n");
  assert.ok(output.includes('  recette: "la-nostra-storia-recette",\n  local: "family-tree-emulator-test"'), "les environnements Recette et local doivent être repérables avant exclusion");
  output = output.replace('  recette: "la-nostra-storia-recette",\n  local: "family-tree-emulator-test"', "");
  const isolatedConfigs = output.replace(/\n  recette: Object\.freeze\(\{[\s\S]*?\n  local: Object\.freeze\(\{[\s\S]*?\n  \}\)\n\}\);/, "\n});");
  assert.notEqual(isolatedConfigs, output, "les configurations Firebase Recette/local doivent être retirées du build Production");
  output = isolatedConfigs;
  const recetteRouteRemoved = output.replace(/  if \(hostname === "la-nostra-storia-recette\.web\.app"\) \{\n[\s\S]*?\n  \}\n/, "");
  assert.notEqual(recetteRouteRemoved, output, "la route Hosting Recette doit être retirée du build Production");
  output = recetteRouteRemoved;
  output = output.replace(/  if \(hostname === "localhost" \|\| hostname === "127\.0\.0\.1"\) \{\n[\s\S]*?\n  \}\n/, '  if (hostname === "localhost" || hostname === "127.0.0.1") return denied("local-unavailable-in-production-build");\n');
  for (const forbidden of ["la-nostra-storia-recette", "family-tree-emulator-test", "local-emulator-only"]) {
    assert.ok(!output.includes(forbidden), `Environnement non-production interdit dans l’artefact : ${forbidden}`);
  }
  assert.ok(output.includes('projectId: "family-tree-c2fe2"'), "la configuration Firebase Production reste incluse");
  return output;
}

async function verifyServed(output, files) {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const relativePath = path === "/" ? "index.html" : decodeURIComponent(path.slice(1));
      const target = inside(output, join(output, relativePath), "Requête du test local");
      const body = await readFile(target);
      const extension = extname(target).toLowerCase();
      const type = extension === ".html" ? "text/html; charset=utf-8"
        : extension === ".css" ? "text/css; charset=utf-8"
          : [".js", ".mjs"].includes(extension) ? "text/javascript; charset=utf-8"
            : "application/octet-stream";
      response.writeHead(200, { "content-type": type });
      response.end(body);
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
    const origin = `http://127.0.0.1:${server.address().port}/`;
    for (const file of files) {
      const response = await fetch(new URL(file.split("/").map(encodeURIComponent).join("/"), origin));
      assert.equal(response.status, 200, `Fichier absent du build servi : ${file}`);
      await response.body?.cancel();
    }
    return origin;
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
  }
}

await verifyFirebaseEnvironment();
const files = await productionFiles();
assert.ok(files.includes("index.html") && files.includes("css/design-system.css"));
assert.ok(files.includes("js/document-image-viewer.js") && files.includes("js/document-pdf-viewer.js"));
assert.ok(files.includes("vendor/pdfjs/pdf.mjs") && files.includes("vendor/pdfjs/pdf.worker.mjs"));
assert.ok(files.every(path => !["tests", "scripts", "firestore.rules", "package.json", "package-lock.json", "firebase.production.json"].some(part => path === part || path.startsWith(`${part}/`))));

try {
  const existing = await (await import("node:fs/promises")).lstat(OUTPUT);
  assert.ok(existing.isDirectory() && !existing.isSymbolicLink(), "dist-production existant doit être un dossier ordinaire généré");
  await rm(OUTPUT, { recursive: true, force: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(OUTPUT, { recursive: true });
for (const file of files) {
  let source;
  if (file.startsWith(PDFJS_PREFIX)) {
    const pdfJsPath = file.slice(PDFJS_PREFIX.length);
    const packagePath = ["pdf.mjs", "pdf.worker.mjs"].includes(pdfJsPath) ? join("build", pdfJsPath) : pdfJsPath;
    source = inside(PDFJS_PACKAGE, join(PDFJS_PACKAGE, packagePath), "Source PDF.js");
  } else source = inside(ROOT, join(ROOT, file), "Source frontend");
  const target = inside(OUTPUT, join(OUTPUT, file), "Destination production");
  await mkdir(dirname(target), { recursive: true });
  if (file === "js/firebase-environment.js") {
    await (await import("node:fs/promises")).writeFile(target, productionOnlyEnvironment(await readFile(source, "utf8")), "utf8");
  } else await copyFile(source, target);
}
const builtFiles = (await listFiles(OUTPUT)).sort();
assert.deepEqual(builtFiles, files, "dist-production contient uniquement la liste validée");
const origin = await verifyServed(OUTPUT, builtFiles);
const totalBytes = (await Promise.all(builtFiles.map(async file => (await stat(join(OUTPUT, file))).size))).reduce((total, size) => total + size, 0);
console.log(`Build Production généré et servi localement (${builtFiles.length} fichiers).`);
console.log(`Configuration Firebase Production conservée : family-tree-c2fe2 (${origin}).`);
console.log(`Aucune Rules, aucun test ni fichier de configuration n’est inclus.`);
console.log(`Taille totale : ${totalBytes} octets.`);
