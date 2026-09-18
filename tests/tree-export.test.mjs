import assert from "node:assert/strict";
import { treeExportSvg } from "../js/tree-export.js";
import { unionDateLabel } from "../js/tree-renderer.js";

function layout(people = [], families = []) {
  const positions = new Map(people.map(p => [p.id, { x: p.x, y: p.y, width: 282, height: 158 }]));
  return {
    positions,
    families,
    geometry: { rootXGap: 40, generationGap: 116, levelGap: 116 },
    bounds: { x: 0, y: 0, width: 720, height: 500 }
  };
}

const BASE = { birthDate: "", deathDate: "", place: "" };

// SVG autonome : un rect par carte, fond de canvas, noms insérés.
{
  const people = [{ id: "p1", x: 20, y: 20, firstName: "Marcel", lastName: "Dupont", ...BASE }];
  const svg = treeExportSvg({ people, layout: layout(people) });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="720" height="500" viewBox="0 0 720 500"/);
  assert.match(svg, /<rect width="720" height="500" fill="#fbf8f1"\/>/);
  assert.equal((svg.match(/<rect /g) || []).length, 2);
  assert.match(svg, /<text x="88" y="48" font-family="Georgia, serif" font-size="17" font-weight="700" fill="#26332e">Marcel<\/text>/);
  assert.match(svg, />Dupont<\/text>/);
  assert.match(svg, /<\/svg>$/);
}

// Layout absent → chaîne vide ; noms échappés dans les textes et attributs.
{
  assert.equal(treeExportSvg({}), "");
  const people = [{ id: "p1", x: 20, y: 20, firstName: "A & B <3", lastName: "Fils", ...BASE }];
  const svg = treeExportSvg({ people, layout: layout(people) });
  assert.ok(!svg.includes("<3"), svg);
  assert.match(svg, /A &amp; B &lt;3<\/text>/);
}

// Initiales sans photo ; <image> avec clip pour une photo data: ; urls externes en CORS.
{
  const noPhoto = [{ id: "p1", x: 20, y: 20, firstName: "Marcel", lastName: "Dupont", ...BASE }];
  const svgNoPhoto = treeExportSvg({ people: noPhoto, layout: layout(noPhoto) });
  assert.match(svgNoPhoto, />MD<\/text>/);

  const dataPhoto = [{ id: "p1", x: 20, y: 20, firstName: "Marcel", lastName: "Dupont", ...BASE }];
  const svgData = treeExportSvg({
    people: dataPhoto,
    layout: layout(dataPhoto),
    photoUrls: new Map([["p1", "data:image/webp;base64,AAAA"]])
  });
  assert.match(svgData, /<image href="data:image\/webp;base64,AAAA" x="34" y="35" width="42" height="42" preserveAspectRatio="xMidYMid slice" clip-path="url\(#clip-avatar-p1\)"\/>/);
  assert.ok(!svgData.includes(">MD<"), "photo présente → pas d'initiales");

  const remote = [{ id: "p1", x: 20, y: 20, firstName: "Marcel", lastName: "Dupont", ...BASE }];
  const svgRemote = treeExportSvg({
    people: remote,
    layout: layout(remote),
    photoUrls: new Map([["p1", "https://exemple.test/photo.jpg"]])
  });
  assert.match(svgRemote, /crossorigin="anonymous"/);
}

// Étiquette de date d'union : rendue uniquement quand une date existe, format compact.
{
  const people = [
    { id: "p1", x: 20, y: 20, firstName: "A", lastName: "B", ...BASE },
    { id: "p2", x: 322, y: 20, firstName: "C", lastName: "D", ...BASE },
    { id: "p3", x: 180, y: 294, firstName: "E", lastName: "F", ...BASE }
  ];
  // origin = (20+282+322)/2 = 312 ; y = 20+79 = 99 ; libellé à y=115. busY = 294-58 = 236.
  const baseFamily = { id: "f1", partnerIds: ["p1", "p2"], childIds: ["p3"], parentChildLinks: [{ parentId: "p1", childId: "p3", type: "biological" }] };

  const none = treeExportSvg({ people, layout: layout(people, [{ ...baseFamily }]) });
  assert.ok(!none.includes('x="312" y="115"'), "aucune étiquette sans date");
  assert.ok(!none.includes("v. 1890"));

  const exact = treeExportSvg({ people, layout: layout(people, [{ ...baseFamily, unionDateInfo: { type: "exact", value: "1890-06-02" } }]) });
  assert.match(exact, /<text x="312" y="115" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="12" font-weight="600" fill="#68746f" stroke="#fbf8f1"[^>]*>1890<\/text>/);

  const about = treeExportSvg({ people, layout: layout(people, [{ ...baseFamily, unionDateInfo: { type: "about", year: 1890 } }]) });
  assert.match(about, />v\. 1890<\/text>/);

  const between = treeExportSvg({ people, layout: layout(people, [{ ...baseFamily, unionDateInfo: { type: "between", from: 1888, to: 1892 } }]) });
  assert.match(between, />1888–1892<\/text>/);

  assert.equal(unionDateLabel({}), "");
  assert.equal(unionDateLabel({ marriageDate: "1890-05-01" }), "1890");
}

// Familles : lignes d'union colorées, jonctions, hachures adoption/incertitude/union terminée.
{
  const people = [
    { id: "p1", x: 20, y: 20, firstName: "A", lastName: "B", ...BASE },
    { id: "p2", x: 322, y: 20, firstName: "C", lastName: "D", ...BASE },
    { id: "p3", x: 180, y: 294, firstName: "E", lastName: "F", ...BASE }
  ];
  const family = {
    id: "f1",
    partnerIds: ["p1", "p2"],
    childIds: ["p3"],
    parentChildLinks: [{ parentId: "p2", childId: "p3", type: "adoptive" }],
    endType: "divorce"
  };
  const svg = treeExportSvg({ people, layout: layout(people, [family]) });
  assert.match(svg, /stroke="#b26842" stroke-width="4"/);
  assert.match(svg, /stroke-dasharray="15 7" opacity="\.78"/);
  assert.match(svg, /stroke-dasharray="10 7"/);
  assert.match(svg, /<path d="M 312 99 V 236" stroke="#b26842" stroke-width="2\.5" stroke-linecap="round"\/>/);
  assert.match(svg, /<circle cx="312" cy="99" r="5" fill="#b26842" stroke="#fffdf8" stroke-width="2"\/>/);
  assert.match(svg, /<circle cx="312" cy="236" r="4" fill="#b26842" stroke="#fffdf8" stroke-width="2"\/>/);
}

// Marqueur « Personne centrale » dans la vue branche.
{
  const people = [{ id: "p1", x: 20, y: 20, firstName: "A", lastName: "B", ...BASE }];
  const svg = treeExportSvg({ people, layout: layout(people), markers: new Map([["p1", "focus"]]) });
  assert.match(svg, />Personne centrale<\/text>/);
  assert.match(svg, /fill="#e8efe9" stroke="#e8dfd0"\/>/);
}

console.log("Export arbre : tests terminés");