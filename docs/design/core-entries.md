# Core entries design

Status: implemented (2026-11-15). Rollout waits for operator approval.

The app's French content is one generated draft, `content/core-entries.json`. It has
19,909 meanings, one per lemma, at frequency ranks 103 to 20,765. It replaces the
Wiktionary-derived `fr-source-*` packs (1,116 meanings) and the 200 hand-written
entries in `pilot.tsv`.

Backward compatibility is out of scope. The app is pre-release with one user, and all
user data is wiped at rollout. Nothing reads old pack IDs, pilot entries or their
review data.

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Reset | Hard reset. The old packs, `pilot.tsv` and every reader of them are deleted, not converted. No migration code handles old entry IDs, pack IDs, installs or backups. |
| 2 | Built-in content | The draft is the only built-in content. Ranks 1 to 102 are absent on purpose. Android's `LearningModel` loads only the bundled pack. The unreachable 18-card starting check looked up six pilot words at startup, so its word list and its branch in `choose()` are gone. |
| 3 | Bands | `publish_catalogue.py` cuts the draft by `rank` into three packs, listed in its `BANDS` table: `fr-core-frequent-2026-11-v1` ("Frequent French", ranks 103 to 2,500, 2,330 meanings), `fr-core-everyday-2026-11-v1` ("Everyday expansion", 2,501 to 7,000, 4,415 meanings) and `fr-core-extended-2026-11-v1` ("Beyond the everyday", 7,001 and up with no upper cap, 13,164 meanings). The frequent pack ships in the APK as `frequent-pack.json`, byte-identical to the published file, and is also listed in the catalogue. Catalogue URLs point at the `content-v3` branch. |
| 4 | Provenance | Packs keep the license `CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/; see NOTICE.md for attribution and modifications`. Each entry gets `license: "CC BY-SA 4.0"` and a `sourceUrl` to its lemma's French Wiktionary page, with spaces written as `_` and the title percent-encoded. `NOTICE.md` and the pack `source` credit French Wiktionary (via Kaikki and Wiktextract) for the French definitions and Lexique 3.83 for the ranks. They also say that English glosses and examples are machine-generated and not independently reviewed. No generator for the draft is committed. |
| 5 | Noun gender | A noun recorded `m` becomes `"un " + word` with `gender: "masculine"`. A noun recorded `f` becomes `"une " + word` with `gender: "feminine"`. A noun recorded `m/f` keeps its bare word and gets `gender: null`, so it has no Gender card. Every entry carries `gender`, `null` for non-nouns, because a pack entry without the key takes the gender of a leading article. Without it, the pronoun *un tel* would become a masculine noun. Examples and clozes are unchanged. |
| 6 | Pack format | `langocard-pack` version 2 with `packVersion` 2. Entry fields are `id`, `word`, `english`, `definition`, `examples`, `topic`, `lemma`, `rank`, `sourceUrl`, `license`, `sourceSense`, `sourcePos` and `gender`. The draft's single `example` becomes `examples: [example]`. |
| 7 | Pipeline | `content/core-entries.json` is the source of truth. `python3 tools/content/publish_catalogue.py` writes the packs, `content/catalogue.json`, the asset copies of `catalogue.json` and `frequent-pack.json`, and `CONTENT-NOTICE.md` (a copy of `content/NOTICE.md`). Reruns produce identical bytes. It fails on the first entry or pack the app would refuse: an ID outside `[A-Za-z0-9_-]{1,100}`, a duplicate ID across packs, a blank field or one over 2,000 characters, a topic other than `daily`, `culture` or `news`, fewer than 1 or more than 5 examples, an example without exactly one `{answer}`, a repeated example, a rank in no band, a pack with no entries or more than 30,000, or a pack of 20 MB or more. `test_publish_catalogue.py` republishes in memory and compares the result with the committed files. `build_corpus.py`, `prepare_pack.py`, their test, `audit.json` and `sources.lock.json` are deleted. The input hashes they held now sit in `NOTICE.md`. `ranked-lemmas.json` stays frozen because the placement test uses it. The shared fixtures stay, and the noun-ending counts are recounted against the new packs. |
| 8 | Glosses | English glosses ship as written in the draft. Review is a follow-up. |

## Known content issues

These issues ship with the draft and belong to the gloss follow-up.

- Four groups of synonyms share both the English gloss and the example sentence: *mémé*, *mamie* and *mémère*; *gaieté* and *gaîté*; *lubrique* and *libidineux*; *crevant* and *éreintant*. Each of their Production cards has more than one right answer, and the Anki export has five duplicate fronts. `PublishedCatalogueTest` asserts unique fronts, so it fails on these until they are fixed.
- The draft records *peu* as a masculine noun, so it ships as *un peu* with a Gender card.

## Ubiquitous language

- **Core entries.** The draft `content/core-entries.json`, the one source of shipped French content.
- **Band.** A rank range that becomes one pack: frequent, everyday or extended.
- **Bundled pack.** The frequent pack, shipped inside the APK with origin `bundled`.

## Rollout

After merge, and only with operator approval:

1. Push a `content-v3` branch that contains the new `content/` directory. The app's `CATALOGUE_URL` and every pack URL in the catalogue point there.
2. Wipe every Convex table on the development deployment, then run `npm run seed` in `apps/backend`.
3. Wipe every Convex table on the production deployment, then run `npm run seed -- --prod`.
4. Uninstall the app, then install the new APK, so local study data starts empty.
