// Writes this Convex deployment's URL and SYNC_TOKEN into apps/android/local.properties
// (gitignored), so the next Android build syncs without typing anything.
// Usage: npm run link-android            (development deployment)
//        npm run link-android -- --prod  (production deployment)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const prod = process.argv.includes("--prod");
const backend = fileURLToPath(new URL("..", import.meta.url));
const target = fileURLToPath(new URL("../../android/local.properties", import.meta.url));
const convex = (...args) =>
  execFileSync("npx", ["convex", ...args, ...(prod ? ["--prod"] : [])], { cwd: backend, encoding: "utf8" }).trim();

const url = convex("function-spec").match(/"url":\s*"([^"]+)"/)?.[1];
if (!url?.startsWith("https://")) {
  console.error("Couldn't find the deployment URL. Run `npx convex dev --once` first.");
  process.exit(1);
}
const token = convex("env", "get", "SYNC_TOKEN").split("\n").pop();
if (!token || token.length < 16) {
  console.error('SYNC_TOKEN is missing or short. Run: npx convex env set SYNC_TOKEN "$(openssl rand -hex 32)"');
  process.exit(1);
}

const settings = { "langocard.syncUrl": url, "langocard.syncToken": token };
const lines = (existsSync(target) ? readFileSync(target, "utf8") : "")
  .split("\n").filter((line) => line && !Object.keys(settings).some((key) => line.startsWith(`${key}=`)));
for (const [key, value] of Object.entries(settings)) lines.push(`${key}=${value}`);
writeFileSync(target, lines.join("\n") + "\n", { mode: 0o600 });
console.log(`Linked Android builds to ${url}. Rebuild and reinstall the app to apply.`);
