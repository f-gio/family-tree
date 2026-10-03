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

// 3. La disponibilité est vérifiée sur le cache des personnes réellement rendues.
assert.match(app, /!treePeople\(\)\.length \|\| !currentLayout/, "le garde doit tester le cache treePeople() et le layout courant");

// 4. L'export réutilise l'état courant de la vue (positions comprises), sans nouveau calcul ni lecture Firestore.
assert.match(app, /const scope = currentTreeScope\(\);/);
assert.match(app, /const layout = currentLayout;/);
assert.match(app, /treeExportSvg\(\{ people: scope\.people, layout, markers, photoUrls, cards \}\)/);
assert.match(app, /captureTreeExportCards\(\$\("treeScene"\), layout, photoUrls\)/);

// 5. Le raster PNG utilise un facteur dédié aux dimensions intrinsèques du SVG;
//    le préchargement CORS des photos distantes déclenche bien la requête.
assert.match(app, /treeExportRasterDimensions\(image\.naturalWidth \|\| image\.width, image\.naturalHeight \|\| image\.height\)/);
assert.match(app, /image\.src = url;/);
assert.match(app, /PHOTO_EXPORT_MAX_EDGE = format === "svg" \? 512 : 128/);
assert.match(app, /photoUrls\.set\(person\.id, photoCanvas\.toDataURL\("image\/png"\)\)/);
assert.match(app, /canvas\.toBlob\(resolve, "image\/png"\)/);
// 6. Le format est choisi dans la modale « Exporter l’arbre », sans entrée SVG séparée.
assert.match(app, /\$\("menuExportTreeBtn"\)\.onclick = \(\) => \{\s*setTreeMenu\(false\);\s*\$\("treeExportDialog"\)\.showModal\(\);/);
assert.match(app, /const format = button\.dataset\.exportFormat;/);
assert.match(app, /close\("treeExportDialog"\);\s*exportTreeImage\(format\);/);

console.log("Export arbre — garde de disponibilité : OK");
