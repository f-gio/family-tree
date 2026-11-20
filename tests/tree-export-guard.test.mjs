import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Non-régression du bug « arbre visible mais export considéré vide » :
// loadedPeople est un drapeau booléen (false/true), PAS un tableau. Un garde
// `!loadedPeople.length` évalue `true.length` → undefined → true, donc
// « Aucun arbre à exporter » alors que l'arbre est affiché à l'écran.
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

// 1. loadedPeople est bien déclaré comme drapeau booléen.
assert.match(app, /let loadedPeople = false, loadedFamilies = false, loadedDocuments = false, loadedTasks = false;/);

// 2. Le garde d'export n'utilise jamais .length sur ce drapeau.
assert.doesNotMatch(app, /!\s*loadedPeople\.length/, "le drapeau booléen loadedPeople ne doit pas être lu comme un tableau");

// 3. Situation invalide : périmètre vide ou layout absent → message explicite
//    puis retour immédiat, sans écriture ni export tronqué.
assert.match(app, /if \(!scope\.people\.length \|\| !layout\) \{\s*\n\s*toast\("Aucun arbre à exporter", "error"\);\s*\n\s*return;/,
  "le garde vide toast « Aucun arbre à exporter » puis renonce");
assert.doesNotMatch(app, /!\s*scope\.people\.length\s*&&/, "pas de lecture tableau du drapeau booléen dans le garde");

// 4. Périmètre et layout : l'arbre actif réutilise l'état de la vue (positions
//    comprises) ; un arbre secondaire ciblé est recomposé localement, dans une
//    scène isolée qui est libérée ensuite.
assert.match(app, /const scope = treeId === activeTreeId\s*\?\s*currentTreeScope\(\)/,
  "scope de l'arbre actif = état courant de la vue");
assert.match(app, /const layout = treeId === activeTreeId \? currentLayout : applyManualPositions\(computeTreeLayout\(scope\)\);/,
  "layout courant pour l'arbre actif, recalculé avec positions manuelles pour un arbre ciblé");
assert.match(app, /if \(treeId !== activeTreeId\) \{[\s\S]{0,500}?exportScene = document\.createElement\("div"\);[\s\S]{0,500}?createTreeRenderer\(\{ scene: exportScene, getScale: \(\) => 1 \}\)\.render\(scope\.people, layout, markers\);/,
  "un arbre secondaire est rendu dans une scène d'export isolée");
assert.match(app, /temporaryExportHost\?\.remove\(\);/, "la scène temporaire est retirée après l'export");
assert.match(app, /captureTreeExportCards\(exportScene, layout, photoUrls\)/);
assert.match(app, /treeExportSvg\(\{ people: scope\.people, layout, markers, photoUrls, cards \}\)/);

// 5. Le raster PNG utilise un facteur dédié aux dimensions intrinsèques du SVG;
//    le préchargement CORS des photos distantes déclenche bien la requête.
assert.match(app, /treeExportRasterDimensions\(image\.naturalWidth \|\| image\.width, image\.naturalHeight \|\| image\.height\)/);
assert.match(app, /image\.src = url;/);
assert.match(app, /PHOTO_EXPORT_MAX_EDGE = format === "svg" \? 512 : 128/);
assert.match(app, /photoUrls\.set\(person\.id, photoCanvas\.toDataURL\("image\/png"\)\)/);
assert.match(app, /canvas\.toBlob\(resolve, "image\/png"\)/);

// 6. Ouverture et lancement : signature complète de la modale (avec repli de
//    focus), ouverture depuis le menu ⋯ de l'arbre actif et depuis les actions
//    d'un arbre du sélecteur, puis format choisi et export de l'arbre ciblé.
assert.match(app, /function openTreeExportDialog\(treeId = activeTreeId, returnFocus = null, \{ restoreFocus = true \} = \{\}\)/,
  "signature complète de openTreeExportDialog, avec repli de focus");
assert.match(app, /\$\("menuExportTreeBtn"\)\.onclick = event => \{[\s\S]{0,300}?openTreeExportDialog\(activeTreeId, \$\("treeMoreBtn"\), \{ restoreFocus: !pointerFullscreenMobile \}\);/,
  "le menu ⋯ ouvre la modale pour l'arbre actif en préservant le repli de focus");
assert.match(app, /return openTreeExportDialog\(treeId, actionToggle \|\| \$\("treeSelectTrigger"\)\);/,
  "l'action Exporter d'un arbre du sélecteur ouvre la modale pour cet arbre");
assert.match(app, /const format = button\.dataset\.exportFormat;/);
assert.match(app, /const treeId = pendingTreeExportId;[\s\S]{0,200}?const focusReturn = treeExportReturnFocus;[\s\S]{0,200}?close\("treeExportDialog"\);\s*\n\s*exportTreeImage\(format, treeId, focusReturn\);/,
  "le format choisi exporte l'arbre de la modale et rend le focus");

console.log("Export arbre — garde de disponibilité : OK");
