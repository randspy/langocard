# Langocard web app

A local React app for managing the vocabulary library and FSRS cards stored in your
Convex deployment: browse and filter every entry, edit or delete entries, add
personal ones, and suspend or reset cards. Android picks the changes up on its next
sync. Studying stays on the phone. The design is in
[`docs/design/web-card-management.md`](../../docs/design/web-card-management.md).

Stack: Vite, React, TypeScript, TanStack Router, Tailwind CSS. It talks to Convex
directly, importing the backend's generated API and shared rules from
`../backend/convex` (alias `@backend`). There is no workspace, so install both apps.

## Setup

Requires Node.js 20 or newer and a backend set up as in
[`apps/backend/README.md`](../backend/README.md).

1. Create a GitHub OAuth app (GitHub → Settings → Developer settings → OAuth Apps):
   - Homepage URL: `http://localhost:5173`
   - Authorization callback URL: `https://<deployment>.convex.site/api/auth/callback/github`.
     This is your deployment URL with `.convex.site` instead of `.convex.cloud`.
2. Find your numeric GitHub user ID: `gh api user --jq .id`, or
   `https://api.github.com/users/<login>`.
3. Configure the deployment and link the web app:

   ```sh
   cd apps/backend
   npm install
   AUTH_GITHUB_ID=<client id> AUTH_GITHUB_SECRET=<client secret> ALLOWED_GITHUB_ID=<numeric id> \
     npm run setup-web-auth
   npx convex deploy        # or keep `npx convex dev` running
   npm run link-web         # writes apps/web/.env.local
   ```

4. Run the app:

   ```sh
   cd apps/web
   npm install
   npm run dev              # http://localhost:5173
   ```

## Access

Anyone can complete GitHub sign-in, but every web function checks that the account's
numeric GitHub ID equals `ALLOWED_GITHUB_ID`. Anyone else sees "No access". The
Android app keeps using `SYNC_TOKEN` and can't call the web functions. The app is
only run locally, but the Convex functions themselves are public, which is why sign-in
is required.

## Develop

```sh
npm run typecheck
npm test          # Vitest + Testing Library
npm run build
```

After changing backend functions, run `npx convex codegen` (or `npx convex dev`) in
`apps/backend` so the generated API this app imports is current.
