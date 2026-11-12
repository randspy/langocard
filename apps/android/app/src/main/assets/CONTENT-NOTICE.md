# French source-aligned content, version 2026-11-v1

These packs are adaptations of French Wiktionary and Lexique, distributed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The application code and personal review history are separate from this content.

## Dictionary definitions, English equivalents, and examples

Credit: **French Wiktionary contributors**. Each entry retains its French Wiktionary
page URL (`sourceUrl`); that page provides contributor history and edit attribution.

- Origin: https://fr.wiktionary.org/
- Wiktionary licensing: https://fr.wiktionary.org/wiki/Wiktionnaire:Licence
- Reuse terms: https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use
- Extracted using **Wiktextract**, Tatu Ylonen and contributors, via **Kaikki**:
  https://kaikki.org/dictionary/rawdata.html
- Snapshot: 2026-10-01 dump, 2026-10-30 extraction as listed by Kaikki on 2026-11-12.
- SHA256 of the exact compressed input is recorded in `audit.json`.

Changes: selected French entries and meaning labels; aligned English translations
by a unique normalized French meaning-label/definition prefix; omitted unaligned
translations, nested definitions, attributed quotation examples, marked uncommon
forms and unsuitable examples. Added noun articles, marked one example gap, assigned
IDs derived from the original word/POS/definition, and added frequency ranks.
The source wording remains dictionary French and is not guaranteed to be a simple
learner definition. IDs are stable for this pinned snapshot; upstream definition
changes require an explicit ID migration rather than silent reidentification.

Examples with citation/ref metadata are excluded. No third-party recordings are
included; installed local French TTS supplies pronunciation on the device.
Source alignment and format checks are not independent linguistic review. Known
sample failures were excluded; further content corrections should preserve IDs
and record the changed fields. Packs intentionally do not assert 20,000 usable
study words. `ranked-lemmas.json` is a **frequency reference**, not a study deck.

## Frequency backbone

Credit: **Boris New, Christophe Pallier and Lexique contributors**, including Ronald
Peereman, Sophie Dufour and Christian Lachaud.

- Dataset: **Lexique 3.83**, https://www.lexique.org/databases/Lexique383/Lexique383.zip
- Publisher/license: https://openlexicon.fr/datasets-info/Lexique383/README-Lexique.html
- License: CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/

Changes: combined inflected rows by lemma without summing repeated lemma-frequency
values; selected maximum lemma book/subtitle frequencies, ranked each channel and
combined ranks at 70% subtitle / 30% book weight. Kept a 20,000-lemma reference and
noun gender metadata. This weighting is a product heuristic, not an experimentally
established optimal learning order. Source frequencies are corpus-specific, not
an absolute or contemporary universal ranking.

Redistributed adaptations must retain attribution, this change notice, license
links and applicable ShareAlike conditions. No warranties are provided.
