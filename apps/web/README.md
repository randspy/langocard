# Langocard web app

A local React app for managing the vocabulary library and FSRS cards stored in your
Convex deployment: browse and filter every entry, edit or delete entries, add
personal ones, and suspend or reset cards. Android picks the changes up on its next
sync. **Export** downloads the active library as an Anki import file in the phone's
format, and **Content sources** shows the content notice and licences. **AI fill** on
New entry drafts an entry in the browser with WebLLM (see
[web practice](../../docs/design/web-practice.md#on-device-ai-on-the-web)). **Study**
practises Reading, Production (Speak) and Gender cards, introducing new meanings as the phone does; answers
reach the phone on its next sync. The design is in
[`docs/design/web-card-management.md`](../../docs/design/web-card-management.md).

Stack: Vite, React, TypeScript, TanStack Router, Tailwind CSS. It talks to Convex
directly, importing the backend's generated API and shared rules from
`../backend/convex` (alias `@backend`). Shared content files come from `../../content`
(alias `@content`); the export credits the APK's built-in pack from its
`frequent-pack.json` (alias `@bundled-pack`, only its source and licence are bundled). There is no workspace, so install both apps.

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
