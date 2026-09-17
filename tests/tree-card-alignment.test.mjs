import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../css/design-system.css", import.meta.url), "utf8");

test("les lignes naissance et décès utilisent la largeur sous l'avatar", () => {
  assert.match(css, /\.person\s*\{[^}]*--person-life-indent:\s*3rem/s);
  assert.match(
    css,
    /\.person \.life-event\s*\{[^}]*margin-left:\s*calc\(-1 \* var\(--person-life-indent\)\)/s
  );
});
