// Points the local web app at this Convex deployment by writing VITE_CONVEX_URL into
// apps/web/.env.local (gitignored). Use the same deployment as `npm run link-android`
// so the phone and the web app share one library.
// Usage: npm run link-web            (development deployment)
//        npm run link-web -- --prod  (production deployment)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const prod = process.argv.includes("--prod");
const backend = fileURLToPath(new URL("..", import.meta.url));
const target = fileURLToPath(new URL("../../web/.env.local", import.meta.url));
const url = execFileSync("npx", ["convex", "function-spec", ...(prod ? ["--prod"] : [])], { cwd: backend, encoding: "utf8" })
  .match(/"url":\s*"([^"]+)"/)?.[1];
if (!url?.startsWith("https://")) {
  console.error("Couldn't find the deployment URL. Run `npx convex dev --once` first.");
  process.exit(1);
}
const lines = (existsSync(target) ? readFileSync(target, "utf8") : "")
  .split("\n").filter((line) => line && !line.startsWith("VITE_CONVEX_URL="));
lines.push(`VITE_CONVEX_URL=${url}`);
writeFileSync(target, lines.join("\n") + "\n");
console.log(`Linked the web app to ${url}. Restart \`npm run dev\` in apps/web to apply.`);
