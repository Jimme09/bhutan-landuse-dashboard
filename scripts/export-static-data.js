/**
 * STATIC SNAPSHOT EXPORTER
 * Saves every API response the dashboard needs as JSON files under
 * frontend/data/, so the frontend can run without a server (e.g. on
 * GitHub Pages). The land-use data never changes, so this only needs
 * re-running if the database or the AI prompt changes.
 *
 * Usage: start the API (`npm run server`), then `npm run export-static`.
 */
const fs = require("fs");
const path = require("path");

const API_BASE = process.env.API_BASE || "http://127.0.0.1:5000/api/v1";
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const OUT_DIR = path.join(FRONTEND_DIR, "data");

// Must match DashboardModel.slugify() in frontend/js/model.js
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Regions are read from the district dropdown, so the snapshot always
// covers exactly the options a visitor can pick (including "National").
function readRegionsFromDropdown() {
  const html = fs.readFileSync(path.join(FRONTEND_DIR, "index.html"), "utf8");
  const select = html.match(/<select id="data-filter">([\s\S]*?)<\/select>/);
  if (!select) throw new Error("Could not find #data-filter in index.html");
  return [...select[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(endpoint, name, retries = 2) {
  const url = `${API_BASE}/${endpoint}/${encodeURIComponent(name)}`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    if (attempt >= retries) {
      throw new Error(`${url} -> HTTP ${response.status}`);
    }
    await sleep(3000); // e.g. a Groq rate limit; wait and retry
  }
}

function save(endpoint, name, data) {
  const dir = path.join(OUT_DIR, endpoint);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${slugify(name)}.json`),
    JSON.stringify(data),
  );
}

async function exportEndpoint(endpoint, names) {
  const failed = [];
  for (const name of names) {
    try {
      save(endpoint, name, await fetchJson(endpoint, name));
    } catch (error) {
      failed.push(`${name} (${error.message})`);
    }
  }
  console.log(
    `✅ ${endpoint}: ${names.length - failed.length}/${names.length} saved`,
  );
  failed.forEach((f) => console.error(`   ❌ ${f}`));
  return failed.length;
}

async function main() {
  const regions = readRegionsFromDropdown();
  const national = await fetchJson("statistics", "National");
  const classes = national.categories;

  let failures = 0;
  failures += await exportEndpoint("geojson", ["dzongkhag", "gewog"]);
  failures += await exportEndpoint("statistics", regions);
  failures += await exportEndpoint("change", regions);
  failures += await exportEndpoint("class-breakdown", classes);
  failures += await exportEndpoint("insights", regions);

  console.log(`\nSnapshot written to ${OUT_DIR}`);
  if (failures > 0) {
    console.error(`${failures} file(s) failed — re-run to retry them.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("💥 Export failed:", error.message);
  console.error("Is the API running? Start it with `npm run server`.");
  process.exit(1);
});
