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
assert.match(app, /treeExportSvg\(\{ people: scope\.people, layout: currentLayout, markers, photoUrls \}\)/);

console.log("Export arbre — garde de disponibilité : OK");