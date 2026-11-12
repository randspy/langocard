# Source library audit and release

12 November 2026. This implements the earlier source-selection proposal and records
measured coverage instead of treating dictionary row counts as a finished library.

| Stage | Measured coverage |
| --- | ---: |
| Lexique lemma ranking, weighted 70% subtitle / 30% book ranks | 20,000 lemmas |
| French Wiktionary headwords matching that ranking (including unusable records) | 19,905 |
| Source-aligned candidate study meanings | 1,152 senses / 894 lemmas |
| Published after excluding existing starter headwords and known sample failures | 1,116 senses / 868 lemmas |
| Built into the app | 200 starter meanings + 501 sourced meanings = 701 |
| Available after installing both additional packs | 1,316 meanings |

The full 20,000-lemma reference is `content/ranked-lemmas.json`. It is **not** counted
as a study deck. Most headwords did not pass the strict definition/translation/example
intersection. Those absences have not been filled with invented meanings or examples.
This is the first useful source-library release, not completion of the 20,000-word
study-content target. Further editorial content preparation is still required.

## Sources and selection

The pinned inputs and hashes are in `content/sources.lock.json`; full attribution,
licenses, modifications and reuse notices are in `content/NOTICE.md`.

- Lexique publisher and data description:
  https://openlexicon.fr/datasets-info/Lexique383/README-Lexique.html
- French Wiktionary extract from Kaikki:
  https://kaikki.org/dictionary/rawdata.html
- Extractor translation-index schema:
  https://github.com/tatuylonen/wiktextract/blob/master/src/wiktextract/extractor/fr/models.py

Lemma frequencies repeat across inflected Lexique rows. The importer uses maximum
lemma-frequency values rather than summing them repeatedly, then ranks each channel.

A concrete alignment failure was found during sampling: *change* has "Vêtement prévu
pour se changer" as the eighth extracted definition, but its English translation
"change of clothes" has index seven. *Patin* similarly has a "horseshoe" translation
numbered seven although the definition is eighth. Consequently, index alone is never
used to align senses. The importer requires a **unique normalized French translation
label/definition prefix match** and rejects nested definitions. This is conservative
structural alignment, not independent confirmation of the translation itself.

Other filters require a supported part of speech, an English equivalent, a short
French definition, a short unreferenced example with one exact lemma occurrence,
and unambiguous Lexique gender for nouns. Noun examples include a gender-bearing
article in the marked answer. Examples citing books, newspapers or other sources
are excluded. A lexical finite-verb-form check reduces fragment examples but cannot
prove grammatical sentence structure; source examples can still be phrases.

The sampled candidates included stale or questionable dictionary translations and
an old-fashioned "pour France" example. Four known sample failures are excluded in
the release builder. The packs are explicitly labeled **source-aligned, not independently
language-reviewed**. Dictionary wording can be technical, old-fashioned or regional;
further learner-focused editing remains necessary. No promise of fully modern,
simplified France French or exhaustive sense coverage is made for these source packs.

## Reproduction

From repository root, with Python 3.11+ and the exact downloaded inputs:

```sh
python3 tools/content/build_corpus.py \
  --lexique .content-cache/Lexique383.zip \
  --dictionary .content-cache/fr-extract.jsonl.gz \
  --output .content-cache/audit
python3 tools/content/publish_catalogue.py --audit .content-cache/audit
python3 -m unittest discover -s tools/content -p 'test_*.py'
```

Raw corpora stay in ignored `.content-cache/`; the builder refuses changed input
hashes. A new upstream snapshot requires a new explicit audit and source lock.
Publishing to the `content-v1` branch makes catalogue and packs available through
HTTPS raw GitHub URLs. Packs have stable IDs for this snapshot and SHA256 digests.
The app bundles the first pack and a catalogue for offline discovery, verifies
remote bytes against catalogue digests, and imports only validated complete packs.

Definitions changed upstream need an explicit ID migration, as current IDs include
the pinned original definition. Pack updates must not silently create duplicate
learning identities. Installed pack IDs persist in backups. Future source releases
must use versioned pack IDs and a deliberate update policy.
