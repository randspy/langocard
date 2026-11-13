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

1. Deploy the backend, set `SYNC_TOKEN` and link the web app:

   ```sh
   cd apps/backend
   npm install
   npx convex deploy        # or keep `npx convex dev` running
   npm run link-web         # writes VITE_CONVEX_URL and VITE_SYNC_TOKEN to apps/web/.env.local
   ```

2. Run the app:

   ```sh
   cd apps/web
   npm install
   npm run dev              # http://localhost:5173
   ```

## Access

There is no sign-in. Every backend function the app calls takes the deployment's
`SYNC_TOKEN`, the same secret the Android app uses; `npm run link-web` copies it into
`.env.local` (gitignored, readable only by you). The Convex functions are public, so the
token is what keeps others out. The app is meant to run only on your machine: a build
embeds the token, so never host or share `dist/`.

## Develop

```sh
npm run typecheck
npm test          # Vitest + Testing Library
npm run build
```

After changing backend functions, run `npx convex codegen` (or `npx convex dev`) in
`apps/backend` so the generated API this app imports is current.
