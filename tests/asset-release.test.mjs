import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* Contrat du jeton de cache des assets :
   - source unique = la meta asset-release de index.html ;
   - toutes les références ?v= portent la même valeur ;
   - l'artefact dist-recette (lorsqu'il existe) reprend le jeton de la source ;
   - le script scripts/bump-asset-release.mjs transforme de façon déterministe
     sans jamais modifier la source lors d'un test. */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = join(ROOT, "index.html");
const SCRIPT = join(ROOT, "scripts", "bump-asset-release.mjs");
const TOKEN_RE = /^\d+-[a-z0-9]+(?:-[a-z0-9]+)*-\d{8}-\d+$/;
const metaOf = html => html.match(/<meta name="asset-release" content="([^"]*)">/)?.[1] ?? null;
const refsOf = html => [...html.matchAll(/\?v=([^"'\s&)]+)/g)].map(match => match[1]);

test("le jeton asset-release de la source respecte la convention du dépôt", () => {
  const html = readFileSync(INDEX, "utf8");
  const token = metaOf(html);
  assert.ok(token, "meta asset-release présente");
  assert.match(token, TOKEN_RE, "format <séquence>-<slug>-<AAAAMMJJ>-<révision>");
  const refs = refsOf(html);
  assert.ok(refs.length >= 50, `références ?v= attendues, obtenu ${refs.length}`);
  assert.deepEqual([...new Set(refs)], [token], "toutes les références ?v= portent le jeton de la meta");
});

test("l'artefact dist-recette, lorsqu'il existe, porte le même asset-release que la source", t => {
  const artifactPath = join(ROOT, "dist-recette", "index.html");
  if (!existsSync(artifactPath)) {
    t.skip("dist-recette absent (artefact non construit)");
    return;
  }
  const sourceToken = metaOf(readFileSync(INDEX, "utf8"));
  const artifact = readFileSync(artifactPath, "utf8");
  const artifactToken = metaOf(artifact);
  assert.equal(artifactToken, sourceToken, "l'artefact doit porter le jeton de la source");
  assert.deepEqual([...new Set(refsOf(artifact))], [artifactToken], "références ?v= de l'artefact cohérentes");
});

test("bump-asset-release.mjs : --check est stable et la transformation reste locale à la cible", () => {
  const check = spawnSync(process.execPath, [SCRIPT, "--check"], { encoding: "utf8" });
  assert.equal(check.status, 0, `--check doit réussir sur la source : ${check.stderr}`);

  const tmp = mkdtempSync(join(tmpdir(), "asset-release-"));
  try {
    const copy = join(tmp, "index.html");
    copyFileSync(INDEX, copy);
    const before = readFileSync(copy, "utf8");
    const oldToken = metaOf(before);
    assert.ok(oldToken, "jeton de départ lisible");

    const newToken = "99-bump-selftest-20991231-1";
    const bump = spawnSync(process.execPath, [SCRIPT, newToken, "--file", copy], { encoding: "utf8" });
    assert.equal(bump.status, 0, `la transformation doit réussir : ${bump.stderr}`);

    const after = readFileSync(copy, "utf8");
    assert.equal(metaOf(after), newToken, "meta mise à jour");
    assert.ok(!after.includes(oldToken), "ancien jeton entièrement remplacé");
    assert.deepEqual([...new Set(refsOf(after))], [newToken], "toutes les références portent le nouveau jeton");
    assert.equal(refsOf(after).length, refsOf(before).length, "aucune référence ajoutée ou perdue");

    const recheck = spawnSync(process.execPath, [SCRIPT, "--check", "--file", copy], { encoding: "utf8" });
    assert.equal(recheck.status, 0, "--check valide la copie transformée");

    const invalid = spawnSync(process.execPath, [SCRIPT, "jeton-invalid", "--file", copy], { encoding: "utf8" });
    assert.notEqual(invalid.status, 0, "un jeton hors convention doit être refusé");

    assert.equal(readFileSync(INDEX, "utf8"), before, "la source n'a pas été modifiée par le test");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
