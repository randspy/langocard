# French core content, version 2026-11-v1

These packs adapt French Wiktionary and Lexique and are distributed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The application code and personal review history are separate from this content.

## French definitions

Credit: **French Wiktionary contributors**. Each entry retains its French Wiktionary
page URL (`sourceUrl`); that page provides contributor history and edit attribution.

- Origin: https://fr.wiktionary.org/
- Wiktionary licensing: https://fr.wiktionary.org/wiki/Wiktionnaire:Licence
- Reuse terms: https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use
- Extracted using **Wiktextract**, Tatu Ylonen and contributors, via **Kaikki**:
  https://kaikki.org/dictionary/rawdata.html
- Snapshot: 2026-10-01 dump, 2026-10-30 extraction as listed by Kaikki on 2026-11-12
  (`fr-extract.jsonl.gz`, SHA256
  `61d27bfc4bef9eb8f19d6e280ebf310adb07196da41d2f5777ff5942bef66a28`).

Changes: selected one meaning per lemma and adapted its French definition; added
`un`/`une` to nouns of a single gender. The source wording remains dictionary French
and is not guaranteed to be a simple learner definition. `sourceSense` records which
Wiktionary meaning an entry follows.

## English glosses and examples

The English gloss and the example sentence of every entry, including its `{answer}`
cloze, are machine-generated. They are not taken from Wiktionary and have not been
independently reviewed by a French or English speaker. Format checks are not
linguistic review. No third-party recordings are included; installed local French
TTS supplies pronunciation on the device.

Entry IDs are stable for this release; content corrections should preserve IDs and
record the changed fields. `ranked-lemmas.json` is a **frequency reference**, not a
study deck.

## Frequency backbone

Credit: **Boris New, Christophe Pallier and Lexique contributors**, including Ronald
Peereman, Sophie Dufour and Christian Lachaud.

- Dataset: **Lexique 3.83**, https://www.lexique.org/databases/Lexique383/Lexique383.zip
  (SHA256 `e181d132b3b0d3d87efc98d376968441b517353933011cebea5366321a6024e6`)
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

## Vocabulary starting-check items

`placement-items.json` selects 60 lemmas from the ranked Lexique reference above.
Thirty original invented control words were added for Langocard. This item set
is distributed under CC BY-SA 4.0, with the attribution and source links above.
It is not LexTALE-FR and has not been independently validated.
