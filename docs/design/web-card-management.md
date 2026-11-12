# Web card management — design

Status: agreed; slice 1 (backend v2) implemented (2026-11-12).

A local React web app for browsing and managing the learner's vocabulary entries
and FSRS cards. It requires sync protocol v2, which makes entries and cards
editable across devices.

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Scope | Browse, add, **edit** and **delete** entries; view, suspend/resume and reset cards. No web studying. |
| 2 | Editable entries | All origins: bundled, pack and personal. |
| 3 | Web role | Thin online client of Convex (live `useQuery`/`useMutation`); no local replica. Android stays offline-first and syncs. |
| 4 | Library location | Convex holds the **full library** (seeded from the repo); the web only queries Convex. |
| 5 | Re-seeding | Rows carry `origin`, a `shipped` content snapshot, `editedAt`. Unedited rows are overwritten; edited rows are kept and flagged `upstreamChanged`; entries removed upstream are marked `retired`, never deleted. |
| 6 | Delete | Soft delete: `deletedAt` tombstone, synced to Android, restorable. Cards and review history are kept. Edit vs delete is last-write-wins. |
| 7 | Card operations | View, suspend/resume, reset. No manual rescheduling. |
| 8 | Web auth | Convex Auth; web functions call `requireOwner(ctx)`. Android keeps `SYNC_TOKEN` for `push`/`pull` only. |
| 9 | Sign-in | GitHub OAuth; owner pinned by numeric ID in the `ALLOWED_GITHUB_ID` env var. |
| 10 | Migration | None. Wipe/recreate the deployment, deploy v2, seed. Old APKs fail argument validation and can't write. |
| 11 | Stack | Vite + React + TypeScript + TanStack Router + Tailwind + shadcn/ui in `apps/web`. Imports `apps/backend/convex/_generated` by relative path; no workspace. |
| 12 | Hosting | Local only (`npm run dev`, `SITE_URL=http://localhost:5173`). `npm run link-web` writes `VITE_CONVEX_URL` so web and Android target the same deployment. |
| 13 | Screens | Library, Entry, New entry, Upstream changes, Sign-in. |
| 14 | Rule parity | `convex/entryRules.ts` shared by Convex and web; Kotlin mirrors it. Shared fixtures `content/entry-rules-fixtures.json` and `content/merge-fixtures.json` run in Vitest and Android unit tests. |
| 15 | Pauses | `pausedUntil` = automatic leech pause (review clock); `suspendedUntil` = manual pause (edit clock). Field-level card merge. Android only honours web changes in v1. |
| 16 | Order | Backend v2 → Android v2 sync → web skeleton + auth + Library → entry editing → card management → upstream changes. |

## Data model (protocol v2)

### `entries`

Typed fields replace the opaque `entry` JSON string.

```
entryId, word, english, definition, example (one {answer}), topic, lemma, rank,
sourceUrl, license,
origin: "bundled" | "pack:<id>" | "personal",
shipped: EntryContent | null    // latest shipped content; null for personal
editedAt: number | null         // server time of the last user edit
deletedAt: number | null        // tombstone
upstreamChanged: boolean        // shipped content changed after a user edit
retired: boolean                // removed from shipped content
updatedAt                        // server time of any write (pull cursor)
```

An entry counts as *edited* when its content differs from `shipped`, so "take theirs"
(copy `shipped` and bump `editedAt`) makes it follow future seeds again. Storing the
snapshot rather than a hash also gives the conflicts screen the upstream text.

Merge: the version with the later `max(editedAt, deletedAt)` wins. Restoring
clears `deletedAt` and sets `editedAt`. Seed writes don't advance `editedAt`.

On Android, a synced row for a bundled ID **overrides** the APK copy (this replaces
the current filter that drops such rows). Deleted entries are hidden and not
scheduled; retired entries aren't introduced as new.

### `cards`

Two field groups, each with its own clock:

| Group | Fields | Clock |
| --- | --- | --- |
| Review | `card` (FSRS JSON), `failures`, `pausedUntil` | `lastReview` |
| Manual | `suspendedUntil` (ms, or a far-future sentinel for indefinite) | `cardEditedAt` |

Each group merges independently: the newer clock wins. A card is schedulable only
when both `pausedUntil` and `suspendedUntil` are in the past.

**Reset** sets `cardEditedAt` and the review group to `card: null` (new) with
`lastReview = cardEditedAt`, and clears both pauses. A review made before the
reset loses even if it syncs later. A review made after the reset (applied locally on
top of the reset state) wins. Review history is kept.

`reviews`, `sources`, `buried` and `settings` are unchanged.

### Server functions

- `sync.push` / `sync.pull`: token-gated, v2 shapes, used by Android.
- `entries.list`, `entries.get`, `entries.create`, `entries.update`,
  `entries.remove`, `entries.restore`, `entries.resolveUpstream(keepMine | takeTheirs)`:
  `requireOwner`.
- `cards.forEntry`, `cards.suspend`, `cards.resume`, `cards.reset`,
  `reviews.forEntry`: `requireOwner`.
- `seed` (action, run via `npm run seed`): reads `content/*.json` and
  `apps/android/app/src/main/assets/pilot.tsv`; idempotent.

All writes validate via `entryRules.ts`.

## Screens

1. **Library** `/`: table (word, English, topic, rank, origin, Read/Listen/Speak
   status chip). Search word/lemma/English; filter by origin, topic, status (active,
   deleted, edited, upstream changed, suspended), rank band. Filters live in URL search params.
2. **Entry** `/entries/$id`: edit form with inline validation and live cloze preview;
   Delete/Restore; three skill panels with FSRS state, Suspend/Resume, Reset and
   review history.
3. **New entry** `/entries/new`: same form; creates `personal-<uuid>`.
4. **Upstream changes** `/conflicts`: side-by-side diff, Keep mine / Take theirs.
5. **Sign-in**: GitHub.

Out of v1: bulk actions, CSV import, stats, pack install/uninstall on the web,
editing/suspending from Android.

## Delivery slices

1. **Backend v2 foundation:** schema, `entryRules.ts`, merge rules, fixture files +
   Vitest, `seed`. Wipe and seed the deployment.
2. **Android v2 sync:** typed entries, bundled override, tombstones, field-level card
   merge, suspended cards skipped, Kotlin fixture tests. The phone works against v2.
3. **Web skeleton:** Vite app, Convex Auth + GitHub, `requireOwner`, `link-web`,
   `.github/workflows/web.yml` (typecheck, test, build on `apps/web/**` and
   `apps/backend/convex/**`), read-only Library.
4. **Entry editing:** Entry and New entry pages, delete/restore.
5. **Card management:** skill panels, suspend/resume, reset, history.
6. **Upstream changes:** conflicts screen.

## Open items

- Which entries are editable was set to "all"; revisit if pack edits interact badly
  with pack reinstall on Android.
- Seeding every pack means Android receives entries from packs it hasn't installed.
  Slice 2 must decide whether it introduces them or keeps pack installation as an opt-in filter.
