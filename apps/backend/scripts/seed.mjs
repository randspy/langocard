// Seeds the shipped French library into Convex: the bundled library (pilot list and
// the frequent pack that ships in the APK) and the downloadable packs.
// Usage: npm run seed            (development deployment)
//        npm run seed -- --prod  (production deployment)
//        npm run seed -- --dry-run (validate and count entries without writing)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { entryErrors, fromAndroidJson } from "../convex/entryRules.ts";

const prod = process.argv.includes("--prod");
const dryRun = process.argv.includes("--dry-run");
const backend = fileURLToPath(new URL("..", import.meta.url));
const repo = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), "utf8");
const BATCH = 200; // keeps each `convex run` argument well under the command-line limit

const run = (fn, args) => JSON.parse(execFileSync("npx",
  ["convex", "run", `seed:${fn}`, JSON.stringify(args), ...(prod ? ["--prod"] : [])],
  { cwd: backend, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));

// The 200-entry pilot list: id|word|english|definition|example|topic
const pilot = read("apps/android/app/src/main/assets/pilot.tsv").split("\n").filter((line) => line.trim())
  .map((line) => {
    const [id, word, english, definition, example, topic] = line.split("|");
    return { ...fromAndroidJson({ id, word, english, definition, example, topic }), origin: "bundled" };
  });

const bundledPack = "apps/android/app/src/main/assets/frequent-pack.json";
const catalogue = JSON.parse(read("content/catalogue.json"));
const packs = [{ path: bundledPack, origin: "bundled" }].concat(
  catalogue.packs.map((p) => ({ path: `content/${p.id}.json`, origin: `pack:${p.id}` })),
);
const entries = [...pilot];
const seen = new Set(pilot.map((e) => e.entryId));
for (const { path, origin } of packs) {
  for (const raw of JSON.parse(read(path)).entries) {
    if (seen.has(raw.id)) continue; // the bundled frequent pack is also in the catalogue
    seen.add(raw.id);
    entries.push({ ...fromAndroidJson(raw), origin });
  }
}

const invalid = entries.flatMap(({ entryId, origin: _, ...content }) =>
  entryErrors(entryId, content).map((error) => `${entryId}: ${error.message}`));
if (invalid.length) {
  console.error(invalid.join("\n"));
  process.exit(1);
}

if (dryRun) {
  const byOrigin = Object.groupBy(entries, (e) => e.origin);
  console.log(`${entries.length} entries`, Object.fromEntries(Object.entries(byOrigin).map(([k, v]) => [k, v.length])));
  process.exit(0);
}

let inserted = 0, updated = 0;
for (let i = 0; i < entries.length; i += BATCH) {
  const result = run("apply", { entries: entries.slice(i, i + BATCH) });
  inserted += result.inserted;
  updated += result.updated;
}
const { retired } = run("retire", { keep: [...seen] });
console.log(`Seeded ${entries.length} entries: ${inserted} new, ${updated} updated, ${retired} retired${prod ? " (prod)" : ""}.`);
