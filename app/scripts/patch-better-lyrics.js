const fs = require("node:fs");
const path = require("node:path");

const base = path.join(process.cwd(), "extensions", "better-lyrics");
const manifestPath = path.join(base, "manifest.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.permissions = (manifest.permissions || []).filter(
  (permission) => permission !== "alarms" && permission !== "downloads"
);
if (!manifest.permissions.includes("storage")) {
  manifest.permissions.push("storage");
}
manifest.optional_permissions = [];
delete manifest.background;
delete manifest.options_ui;
manifest.action = {};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const patchFiles = [
  "content_scripts/content-0.js",
  "script.js",
  "pages/auth.js",
  "options_ui/page.js",
  "pages/marketplace.js",
  "pages/standalone-editor.js",
  "pages/unison.js"
];

for (const relativePath of patchFiles) {
  const file = path.join(base, relativePath);
  if (!fs.existsSync(file)) {
    continue;
  }

  let text = fs.readFileSync(file, "utf8");
  text = text.replaceAll("chrome.storage.sync", "chrome.storage.local");

  if (relativePath === "content_scripts/content-0.js") {
    text = text.replace(
      'document.addEventListener("DOMContentLoaded",aJ),',
      ';"loading"===document.readyState?document.addEventListener("DOMContentLoaded",aJ):aJ(),'
    );
  }

  fs.writeFileSync(file, text, "utf8");
}

console.log("Better Lyrics patched for Electron.");
