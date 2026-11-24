import unittest
from review_alternatives import drop_wrong, sample, tally


def row(i, rank):
    return dict(id=f'fr-core-{i}', english=f'meaning {i}', example=f'Il faut {{mot{i}}} ici.', rank=rank)


def record(r, accepted):
    return {'example': r['example'], 'accepted': accepted, 'rejected': []}


class SampleTests(unittest.TestCase):
    def setUp(self):
        # 60 frequent, 30 everyday and 10 extended examples with alternatives, plus some without.
        self.rows = [row(i, 200 + i) for i in range(60)] + [row(100 + i, 3000 + i) for i in range(30)] + \
                    [row(200 + i, 8000 + i) for i in range(10)] + [row(300 + i, 300 + i) for i in range(20)]
        self.records = {r['id']: record(r, ['autre'] if int(r['id'].split('-')[-1]) < 300 else [])
                        for r in self.rows}

    def test_draws_only_examples_with_alternatives_split_across_bands_by_size(self):
        picked = sample(self.rows, self.records, size=20, seed=1)
        self.assertEqual(20, len(picked))
        self.assertTrue(all(p['accepted'] for p in picked))
        counts = {band: sum(p['band'] == band for p in picked) for band in ('frequent', 'everyday', 'extended')}
        self.assertEqual({'frequent': 12, 'everyday': 6, 'extended': 2}, counts)

    def test_is_reproducible_from_the_seed(self):
        self.assertEqual(sample(self.rows, self.records, 20, seed=7), sample(self.rows, self.records, 20, seed=7))
        self.assertNotEqual(sample(self.rows, self.records, 20, seed=7), sample(self.rows, self.records, 20, seed=8))

    def test_skips_records_for_an_older_example_text(self):
        self.records['fr-core-0']['example'] = 'Old sentence {x}.'
        picked = sample(self.rows, self.records, size=100, seed=1)
        self.assertNotIn('fr-core-0', {p['id'] for p in picked})


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.records = {'a': {'example': 'x {arriver} y', 'accepted': ['parvenir', 'venir'], 'rejected': []}}
        self.verdicts = {'a': [{'alternative': 'parvenir', 'verdict': 'correct', 'reason': 'synonym'},
                               {'alternative': 'venir', 'verdict': 'wrong', 'reason': 'different meaning'}]}

    def test_counts_verdicts(self):
        self.assertEqual({'correct': 1, 'wrong': 1, 'unsure': 0}, tally(self.verdicts))

    def test_moves_wrong_alternatives_to_rejected_with_the_review_reason(self):
        removed = drop_wrong(self.records, self.verdicts)
        self.assertEqual(1, removed)
        self.assertEqual(['parvenir'], self.records['a']['accepted'])
        self.assertEqual([{'candidate': 'venir', 'reason': 'review: different meaning'}], self.records['a']['rejected'])

    def test_rejects_malformed_verdicts_before_changing_anything(self):
        for extra in [{'alternative': 'aller', 'verdict': 'wrong', 'reason': 'x'},
                      {'alternative': 'venir', 'verdict': 'correct', 'reason': 'again'},
                      {'alternative': 'parvenir', 'verdict': 'wrong'}]:
            verdicts = {'a': [self.verdicts['a'][1], extra]}
            with self.subTest(extra), self.assertRaises(ValueError):
                drop_wrong(self.records, verdicts)
            self.assertEqual(['parvenir', 'venir'], self.records['a']['accepted'])


if __name__ == '__main__':
    unittest.main()
