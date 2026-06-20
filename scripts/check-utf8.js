const { readdirSync, readFileSync } = require("node:fs");
const { join, relative } = require("node:path");
const { TextDecoder } = require("node:util");

const root = join(__dirname, "..");
const decoder = new TextDecoder("utf-8", { fatal: true });
const scanDirs = ["src", "scripts"];
const scanFiles = ["package.json", "tsconfig.json", ".editorconfig", ".gitattributes"];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".ts", ".tsx"]);
const skippedDirs = new Set(["node_modules", "dist", "release", ".git", ".venv", "cache"]);

function extensionOf(fileName) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function collectTextFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirs.has(entry.name)) {
        collectTextFiles(join(dir, entry.name), files);
      }
      continue;
    }

    if (entry.isFile() && textExtensions.has(extensionOf(entry.name))) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

const files = [
  ...scanDirs.flatMap((dir) => collectTextFiles(join(root, dir))),
  ...scanFiles.map((file) => join(root, file))
];

const failures = [];

for (const file of files) {
  try {
    const bytes = readFileSync(file);
    const text = decoder.decode(bytes);
    if (text.includes("\uFFFD")) {
      failures.push(`${relative(root, file)} contains replacement characters`);
    }
  } catch (error) {
    failures.push(`${relative(root, file)} is not valid UTF-8: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`UTF-8 check passed (${files.length} files).`);
