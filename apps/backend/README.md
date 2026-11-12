# Langocard backend

Cloud sync for one learner, built on [Convex](https://convex.dev). The Android app
stays offline-first: its local `learning-v1.json` remains what it studies from, and
sync pushes local changes and merges changes from other devices and the web app.
Convex also holds the whole vocabulary library, so it can be managed from the web.

This is **sync protocol v2** (editable entries and cards). The design is in
[`docs/design/web-card-management.md`](../../docs/design/web-card-management.md).
v1 clients are rejected by argument validation. The Android app still speaks v1
until [#7](https://github.com/randspy/langocard/issues/7) lands, so don't deploy this
to the deployment your phone syncs with before then.

## What is stored

| Table | Contents | Merge rule |
| --- | --- | --- |
| `entries` | The whole library: bundled, pack and personal entries | Later of `editedAt`/`deletedAt` wins; deletion is a tombstone |
| `cards` | FSRS card per `<entryId>:<Skill>`, with failures, leech pause and manual suspension | Review fields follow `lastReview`; `suspendedUntil` follows `cardEditedAt` |
| `reviews` | Review history | Union, deduplicated by card key and review time |
| `sources` | Pack attribution | Union |
| `buried` | Sibling skills hidden until the next day | Latest day wins |
| `settings` | Placement, frequency band, interests, daily counters | Per field (see `convex/merge.ts`) |

Every rule is idempotent, so a failed or repeated sync is safe. On the same day on two
devices, the daily study time keeps the larger value rather than the sum.

- Devices may only **add** personal entries (`personal-…`). Bundled and pack entries
  come from the seed. `push` returns the IDs it refused (invalid content or an unknown
  non-personal entry) in `rejected`.
- A card **reset** sets the FSRS card to `null` (new again) and advances both clocks,
  so reviews made before it lose even if they sync later. Review history is kept.
- `suspendedUntil` is `253402300799999` for an indefinite suspension.
- Entry validation lives in `convex/entryRules.ts`. Android mirrors it and the merge
  rules; `content/entry-rules-fixtures.json` and `content/merge-fixtures.json` hold
  cases both implementations must pass.

## Library seed

`npm run seed` loads the shipped library into `entries`: the pilot list and the
frequent pack bundled in the APK (origin `bundled`), and the catalogue packs
(origin `pack:<packId>`). It is idempotent.

- Entries you haven't edited take new shipped content.
- Edited entries keep your wording. If the shipped content changed, they're flagged
  `upstreamChanged`. The latest shipped version is kept in `shipped`.
- Entries no longer shipped are marked `retired`, not deleted. Personal entries are never
  touched.

`npm run seed -- --dry-run` validates and counts without writing (CI runs it), and
`-- --prod` targets production.

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
npm run seed                    # load the library
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
npm run typecheck   # functions and tests
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
