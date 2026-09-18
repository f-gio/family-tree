import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export const SHOT_DIR = process.env.TEMP
  ? join(process.env.TEMP, "opencode", "family-tree-responsive")
  : join(process.env.TMPDIR || "/tmp", "opencode", "family-tree-responsive");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

export async function startStaticServer(root = ROOT) {
  const base = root.replace(/[\\/]+$/, "");
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";
      const file = normalize(join(base, pathname));
      if (file !== base && !file.startsWith(base + sep)) {
        res.writeHead(403);
        res.end("403");
        return;
      }
      const content = await readFile(file);
      const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("404");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    server,
    baseURL: `http://127.0.0.1:${port}/`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

export const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1024", width: 1024, height: 768 },
  { name: "tablet-760", width: 760, height: 900 },
  { name: "phablet-560", width: 560, height: 800 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-320", width: 320, height: 568 },
  { name: "landscape-844", width: 844, height: 390 }
];

export const GSTATIC_PREFIX = "https://www.gstatic.com/";
export const BOOT_WARNING = "Vérification des inscriptions impossible";
export const LOGIN_BLOCKED_MESSAGE = "Connexion impossible. Vérifiez Firebase Authentication.";

export function blockedServiceFor(urlString) {
  let host = urlString;
  try {
    host = new URL(urlString).hostname;
  } catch {
    /* URL invalide : on garde la chaîne brute */
  }
  if (host === "firestore.googleapis.com") return "firestore (données)";
  if (host === "identitytoolkit.googleapis.com") return "Firebase Authentication";
  if (host === "securetoken.googleapis.com") return "jeton Firebase";
  if (host === "api.geonames.org") return "GeoNames";
  if (host.endsWith("giovannoni-f.workers.dev")) return "GeoNames (relais Cloudflare)";
  if (host.endsWith("jsdelivr.net")) return "jsDelivr (JSZip backup/restore)";
  return null;
}

export function isAllowedRequest(urlString, baseURL) {
  return urlString.startsWith(baseURL) || urlString.startsWith(GSTATIC_PREFIX);
}