# Answer alternatives: generation and review

25 November 2026. This records how the answer alternatives in the `content-v4` packs
were generated and checked, as decisions 12 and 13 of
[`../design/answer-alternatives.md`](../design/answer-alternatives.md) require.

| Stage | Examples with alternatives | Alternatives |
| --- | ---: | ---: |
| Draft examples | 19,904 examples | |
| Generated with checker version 1 (19,573 recorded; 331 never got a usable model reply) | 7,151 | 9,114 |
| After re-judging with checker version 2 | 4,933 | 5,833 |
| After clearing 4 that version 2 never judged | 4,929 | 5,825 |
| Published, after removing the alternatives Haiku judged wrong | 4,921 | 5,815 |

## Generation

`tools/content/generate_alternatives.py` ran local Ollama `gemma4:26b` (temperature 0,
two parallel requests) over `content/core-entries.json`, from 22 to 23 November 2026,
at about 650–850 examples an hour. For each example, one call proposed candidates, the
deterministic filters dropped target variants, article variants, overlong and malformed
ones, and a second call judged each remaining candidate in the full sentence.

331 examples never got a usable reply (mostly timeouts or a verdict list that didn't
match the candidates, again on retry) and publish without alternatives, as before.

## First review: failed

A seeded sample (`review_alternatives.py sample --seed 20261124`) of 200 examples with
259 alternatives, split by band (25 frequent, 45 everyday, 130 extended), was reviewed
by Claude Haiku in 8 batches of 25.

| Verdict | Count |
| --- | ---: |
| correct | 185 |
| wrong | 21 |
| unsure | 53 |

Wrong was 10.2% of the judged (correct or wrong) alternatives, above the 5% gate. Most
wrong ones were:

- **A different register.** A neutral word for slang: *bigleux → myope*, *travelo → travesti*.
- **A broader word.** *saler → assaisonner*, *visser → fixer*, *rempart → mur*, *gâcher (le mortier) → préparer*.

## Stricter checker

Checker version 2 also requires `same_register` and `as_specific` (neither broader nor
narrower). On the first sample it kept 3 of Haiku's 21 wrong alternatives (2.2% of the
judged ones it kept) and dropped 52 of the 185 correct ones. It then re-judged all
9,114 stored alternatives (`--recheck`, about 6 hours). Four examples whose recheck
never got a usable reply had their version 1 alternatives cleared.

## Second review: passed

A new seeded sample (`--seed 20261125`) of 200 examples with 245 alternatives (25
frequent, 48 everyday, 127 extended; 9 examples also appeared in the first sample),
drawn after the recheck and reviewed the same way:

| Verdict | Count |
| --- | ---: |
| correct | 203 |
| wrong | 9 |
| unsure | 33 |

Wrong is 4.2% of the judged alternatives, within the 5% gate. The 9 wrong ones were
removed, as was *réactionnistes*, a first-review wrong one that version 2 kept. Wrong
ones in the second sample:

| Example | Alternative | Haiku's reason |
| --- | --- | --- |
| un comportement {brutal} | bestial | stronger, a different sense |
| La mise en scène … était {spectaculaire} | splendide | praises beauty, not showiness |
| a subi {une dégradation} de son rang | une rétrogradation | demotion, not stripping of rank |
| perdu sa {pagaie} … son kayak | rame | a kayak takes a paddle, not an oar |
| Ce petit {arsouille} | salaud | much harsher insult |
| {le nectar} comme une boisson divine | l'ambroisie | the food of the gods, not the drink |
| doivent {concorder} avec la réalité | correspondre | *correspondre à*, not *avec* |
| un peu {branque} | con | ruder register |
| {affiner} sa silhouette | modeler | to shape, not to slim |

## Limits

- The reviewer is a model, not a French speaker, and 33 of 245 sampled alternatives were
  `unsure`. Unsure ones stay published: they are mostly near-synonyms with a nuance,
  which a learner typing them would still be right to see accepted as Hard.
- The sample estimate is about ±3 percentage points at 95% confidence, so the true wrong
  rate could be slightly above 5%.
- An accepted alternative rates the card Hard and shows the target, so a wrong one costs
  a learner a missed Again, not a lost card.
