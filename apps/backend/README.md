# Langocard backend

Optional cloud sync for one learner, built on [Convex](https://convex.dev). The
Android app stays offline-first: its local `learning-v1.json` remains the source of
truth, and sync only pushes local changes and merges changes from other devices.

## What is stored

| Table | Contents | Merge rule |
| --- | --- | --- |
| `cards` | FSRS card per `<entryId>:<Skill>`, with failure count and pause | Newest review wins |
| `reviews` | Review history | Union, deduplicated by card key and review time |
| `entries` | Personal entries and installed pack entries | Union by entry ID |
| `sources` | Pack attribution | Union |
| `buried` | Sibling skills hidden until the next day | Latest day wins |
| `settings` | Placement, frequency band, interests, daily counters | Per field (see `convex/merge.ts`) |

The Android app mirrors these rules in `Sync.kt`. Every rule is idempotent, so a
failed or repeated sync is safe. On the same day on two devices, the daily
study time keeps the larger value rather than the sum.

## Access

There are no accounts. Every function checks a shared secret against the
`SYNC_TOKEN` environment variable on the deployment. Anyone with the deployment
URL and token can read and replace your study data, so use a long random value
and don't commit it.

## Setup

Requires Node.js 20 or newer.

```sh
cd apps/backend
npm install
npx convex dev --once        # log in and create a project (development deployment)
npx convex env set SYNC_TOKEN "$(openssl rand -hex 32)"
npm run link-android            # write URL + token into apps/android/local.properties
```

Then rebuild and install the app. The URL and token are compiled into your build, so
it syncs on first launch without typing anything. `local.properties` is gitignored;
CI can supply `LANGOCARD_SYNC_URL` and `LANGOCARD_SYNC_TOKEN` environment variables
instead. Builds without these values simply have sync off.

Anyone who has your APK can extract the token from it, so don't share personal builds.
To rotate the token, set a new `SYNC_TOKEN`, run `npm run link-android` again and
reinstall.

For a production deployment, run `npx convex deploy`, set the token with
`npx convex env set --prod SYNC_TOKEN …`, then `npm run link-android -- --prod`.

**Menu → Cloud sync** shows the sync status and has **Sync now** and **Disconnect**. You
can still enter a different deployment URL and token there; values entered in the app
take priority over the built-in ones.

The app requires HTTPS, so a local `npx convex dev --local` backend can't be used
from a phone without a TLS tunnel.

## Develop

```sh
npm run typecheck
npm test            # convex-test + vitest, no deployment needed
```

`convex/_generated` is committed so that typechecking works without a deployment.
Run `npx convex dev` (or `npx convex codegen` with a configured deployment)
after changing the schema or function signatures.

## Limits

- Restoring a backup on a device pushes the restored progress on the next sync,
  but a card that was reviewed more recently on another device keeps the newer
  review.
- Pulls overlap by a minute so writes made during a sync aren't missed; overlapping
  rows are merged again without effect.
- Convex free-plan limits are far above one learner's usage, but check the current
  plan, including whether inactive free projects are paused.
