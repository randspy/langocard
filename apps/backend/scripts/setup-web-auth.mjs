// Configures web sign-in (Convex Auth + GitHub) on this deployment:
//  - SITE_URL (where GitHub sign-in returns to), default http://localhost:5173
//  - JWT_PRIVATE_KEY / JWKS signing keys, generated once
//  - AUTH_GITHUB_ID, AUTH_GITHUB_SECRET and ALLOWED_GITHUB_ID, if given as environment variables
// Usage: AUTH_GITHUB_ID=… AUTH_GITHUB_SECRET=… ALLOWED_GITHUB_ID=… npm run setup-web-auth [-- --prod] [-- --rotate-keys]
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";

const prod = process.argv.includes("--prod");
const rotate = process.argv.includes("--rotate-keys");
const backend = fileURLToPath(new URL("..", import.meta.url));
const convex = (...args) =>
  execFileSync("npx", ["convex", ...args, ...(prod ? ["--prod"] : [])], { cwd: backend, encoding: "utf8" }).trim();
const has = (name) => convex("env", "list").split("\n").some((line) => line.startsWith(`${name}=`));
// `--` stops the CLI from reading a value that starts with "-----" as an option.
const set = (name, value) => { convex("env", "set", name, "--", value); console.log(`Set ${name}`); };

set("SITE_URL", process.env.SITE_URL ?? "http://localhost:5173");
if (rotate || !has("JWKS")) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  set("JWT_PRIVATE_KEY", pem.trimEnd().replace(/\n/g, " "));
  set("JWKS", JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...publicKey.export({ format: "jwk" }) }] }));
} else console.log("Signing keys already set (use --rotate-keys to replace them)");
for (const name of ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "ALLOWED_GITHUB_ID"]) {
  if (process.env[name]) set(name, process.env[name]);
  else if (!has(name)) console.warn(`${name} is not set yet; pass it as an environment variable and run again`);
}
