// Points the local web app at this Convex deployment by writing VITE_CONVEX_URL and
// VITE_SYNC_TOKEN into apps/web/.env.local (gitignored). Use the same deployment as
// `npm run link-android` so the phone and the web app share one library.
// Usage: npm run link-web            (development deployment)
//        npm run link-web -- --prod  (production deployment)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const prod = process.argv.includes("--prod");
const backend = fileURLToPath(new URL("..", import.meta.url));
const target = fileURLToPath(new URL("../../web/.env.local", import.meta.url));
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

const settings = { VITE_CONVEX_URL: url, VITE_SYNC_TOKEN: token };
const lines = (existsSync(target) ? readFileSync(target, "utf8") : "")
  .split("\n").filter((line) => line && !Object.keys(settings).some((key) => line.startsWith(`${key}=`)));
for (const [key, value] of Object.entries(settings)) lines.push(`${key}=${value}`);
writeFileSync(target, lines.join("\n") + "\n", { mode: 0o600 });
console.log(`Linked the web app to ${url}. Restart \`npm run dev\` in apps/web to apply.`);
