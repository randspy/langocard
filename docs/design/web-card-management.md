# Web card management — design

Status: implemented (2026-11-12); see issues #6–#11.

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
| 8 | Web auth | No accounts. Every public function takes the shared `SYNC_TOKEN` (`requireToken` in `access.ts`), the same secret Android uses. |
| 9 | Sign-in | None. `npm run link-web` writes the token to the web app's gitignored `.env.local`. (GitHub OAuth was planned, then dropped: the app is local-only.) |
| 10 | Migration | None. Wipe/recreate the deployment, deploy v2, seed. Old APKs fail argument validation and can't write. |
| 11 | Stack | Vite + React + TypeScript + TanStack Router + Tailwind + shadcn/ui in `apps/web`. Imports `apps/backend/convex/_generated` by relative path; no workspace. |
| 12 | Hosting | Local only (`npm run dev`). A build embeds the token, so it is never hosted. `npm run link-web` writes `VITE_CONVEX_URL` and `VITE_SYNC_TOKEN` so web and Android target the same deployment. |
| 13 | Screens | Library, Entry, New entry, Upstream changes. |
| 14 | Rule parity | `convex/entryRules.ts` shared by Convex and web; Kotlin mirrors it. Shared fixtures `content/entry-rules-fixtures.json` and `content/merge-fixtures.json` run in Vitest and Android unit tests. |
| 15 | Pauses | `pausedUntil` = automatic leech pause (review clock); `suspendedUntil` = manual pause (edit clock). Field-level card merge. Android only honours web changes in v1. |
| 16 | Order | Backend v2 → Android v2 sync → web skeleton + auth + Library → entry editing → card management → upstream changes. |
| 17 | Packs on Android | Packs stay opt-in downloads. Convex holds every pack entry so the web can manage them, but Android only studies entries from installed packs (see below). |

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
`lastReview = cardEditedAt`, and clears the leech pause. A manual suspension is kept:
resetting is about memory state, not about whether to study. A review made before the
reset loses even if it syncs later. A review made after the reset (applied locally on
top of the reset state) wins. Review history is kept.

`reviews`, `sources`, `buried` and `settings` are unchanged.

### Downloadable packs

Installing a pack is still an explicit download on Android, verified against the
catalogue digest. A `sources` row with the pack's `packId` records the installation.
`sources` is a synced union, so installing a pack on one device installs it everywhere,
and there is no uninstall (unchanged from v1).

- Android pulls every entry row but keeps rows of **uninstalled** packs dormant. They aren't
  shown, scheduled or counted.
- On install, the downloaded pack is the base, and any dormant Convex row for the same ID
  (an edit made on the web, a tombstone) is applied on top.
- The active library on a device = bundled + personal + entries of installed packs.
- The web shows all entries. The Library has an "installed / not installed" pack filter, derived
  from `sources`, and pack entries can be edited before installation. Edits take effect when
  the pack is installed.

### Server functions

- `sync.push` / `sync.pull`: token-gated, v2 shapes, used by Android.
- `entries.list`, `entries.get`, `entries.create`, `entries.update`,
  `entries.remove`, `entries.restore`, `entries.resolveUpstream(keepMine | takeTheirs)`:
  token-gated.
- `cards.forEntry`, `cards.suspend`, `cards.resume`, `cards.reset`,
  `reviews.forEntry`: token-gated.
- `access.check`: reports whether a token is accepted, for the web app's "No access" screen.
- `seed` (action, run via `npm run seed`): reads `content/*.json` and
  `apps/android/app/src/main/assets/pilot.tsv`; idempotent.

All writes validate via `entryRules.ts`.

## Screens

1. **Library** `/`: table (word, English, topic, rank, origin, Read/Listen/Speak
   status chip). Search word/lemma/English; filter by origin, topic, status (active,
   deleted, edited, upstream changed, suspended), rank band. Filters live in URL search params.
2. **Entry** `/entries/$id`: edit form with inline validation and live cloze preview;
   Delete/Restore; three skill panels with FSRS state, Suspend/Resume (indefinitely or until a date,
   per skill or the whole entry), Reset (with confirmation) and review history.
3. **New entry** `/entries/new`: same form; creates `personal-<uuid>`.
4. **Upstream changes** `/conflicts`: side-by-side diff, Keep mine / Take theirs.

Out of v1: bulk actions, CSV import, stats, pack install/uninstall on the web,
editing/suspending from Android.

## Delivery slices

1. **Backend v2 foundation:** schema, `entryRules.ts`, merge rules, fixture files +
   Vitest, `seed`. Wipe and seed the deployment.
2. **Android v2 sync:** typed entries, bundled override, tombstones, field-level card
   merge, suspended cards skipped, Kotlin fixture tests. The phone works against v2.
3. **Web skeleton:** Vite app, token access, `link-web`,
   `.github/workflows/web.yml` (typecheck, test, build on `apps/web/**` and
   `apps/backend/convex/**`), read-only Library.
4. **Entry editing:** Entry and New entry pages, delete/restore.
5. **Card management:** skill panels, suspend/resume, reset, history.
6. **Upstream changes:** conflicts screen.

## Open items

- Which entries are editable was set to "all"; revisit if pack edits interact badly
  with pack reinstall on Android.
