const fs = require("node:fs");
const path = require("node:path");

const outputDirectory = path.join(__dirname, "dist");
const apiBase = (process.env.ATTENDLY_API_BASE || "").trim().replace(/\/+$/, "");

if (process.env.VERCEL && !apiBase) {
  throw new Error("Set ATTENDLY_API_BASE to the public Railway service URL before deploying to Vercel.");
}
if (apiBase && !/^https:\/\/[^/]+$/i.test(apiBase)) {
  throw new Error("ATTENDLY_API_BASE must be an HTTPS origin without a path.");
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });
for (const filename of ["index.html", "app.js", "styles.css"]) {
  fs.copyFileSync(path.join(__dirname, filename), path.join(outputDirectory, filename));
}
fs.writeFileSync(
  path.join(outputDirectory, "config.js"),
  `window.ATTENDLY_API_BASE = ${JSON.stringify(apiBase)};\nwindow.ATTENDLY_IS_PRODUCTION = true;\n`
);
