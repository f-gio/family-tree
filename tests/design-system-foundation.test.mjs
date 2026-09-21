import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "css", "design-system.css"), "utf8");

assert.match(html, /href="\.\/css\/design-system\.css"/);

for (const token of [
  "--color-brand",
  "--color-danger",
  "--font-ui",
  "--font-display",
  "--text-body",
  "--space-4",
  "--radius-md",
  "--shadow-focus",
  "--control-md",
  "--control-touch",
  "--transition-fast",
]) {
  assert.ok(css.includes(token), `Token absent : ${token}`);
}

for (const selector of [
  ".btn.primary",
  ".btn.tertiary",
  ".btn.danger",
  ".icon-btn",
  ".btn:disabled",
  '.btn[aria-busy="true"]',
  ":focus-visible",
  "prefers-reduced-motion",
]) {
  assert.ok(css.includes(selector), `Règle absente : ${selector}`);
}

assert.match(css, /--control-touch:\s*2\.75rem/);
assert.match(html, /id="clearDirectoryFiltersBtn"/);

console.log("Design System sections 1–7 : OK");
