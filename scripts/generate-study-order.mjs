import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const packs = ["apps/android/app/src/main/assets/frequent-pack.json", ...read("content/catalogue.json").packs.map(p => `content/${p.id}.json`)];
const order = {};
let ordinal = 0;
for (const path of packs) for (const entry of read(path).entries) {
  if (!Object.hasOwn(order, entry.id)) order[entry.id] = ordinal++;
}
const output = JSON.stringify(order) + "\n";
const path = fileURLToPath(new URL("content/study-order.json", root));
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output) throw new Error("Regenerate study order: node scripts/generate-study-order.mjs");
} else writeFileSync(path, output);
