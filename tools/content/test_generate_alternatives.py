import json
import tempfile
import unittest
from pathlib import Path
from generate_alternatives import UnusableReply, alternatives_for, load, pending, rejection, run, save

ROW = dict(id='fr-core-1', english='To reach a destination.', example='Le train devrait {arriver} à la gare.', rank=103)


class FakeModel:
    """Replies in order; records prompts."""
    def __init__(self, *replies):
        self.replies, self.prompts = list(replies), []

    def __call__(self, prompt):
        self.prompts.append(prompt)
        return self.replies.pop(0)


def verdict(candidate, ok=True, reason='ok'):
    return {'candidate': candidate, 'reason': reason, 'grammatical': ok, 'same_meaning': ok}


class FilterTests(unittest.TestCase):
    def test_drops_what_other_checks_already_forgive_or_cannot_store(self):
        cases = {'Arrivér': 'target variant', 'arriver': 'target variant', '  ': 'blank', 'a|b': 'malformed',
                 'arriver à destination enfin': 'too long'}
        for candidate, reason in cases.items():
            self.assertEqual(reason, rejection(candidate, 'arriver', set()), candidate)
        self.assertEqual('article variant', rejection('une intrigue', "l'intrigue", set()))
        self.assertEqual('duplicate', rejection('Parvenir', 'arriver', {'parvenir'}))
        self.assertIsNone(rejection('parvenir', 'arriver', set()))
        self.assertIsNone(rejection('une affaire', 'une intrigue', set()))


class GenerateTests(unittest.TestCase):
    def test_keeps_only_candidates_the_checker_accepts(self):
        model = FakeModel({'alternatives': ['parvenir', 'arriver', 'venir', 'aller']},
                          {'verdicts': [verdict('parvenir'), verdict('venir', False, 'different meaning'),
                                        {'candidate': 'aller', 'grammatical': True, 'same_meaning': False}]})
        record = alternatives_for(ROW, model)
        self.assertEqual(['parvenir'], record['accepted'])
        self.assertEqual({'arriver': 'target variant', 'venir': 'checker: different meaning', 'aller': 'checker:'},
                         {r['candidate']: r['reason'] for r in record['rejected']})
        self.assertIn('Le train devrait ________ à la gare.', model.prompts[0])
        self.assertIn('1. parvenir: Le train devrait parvenir à la gare.', model.prompts[1])

    def test_skips_the_checker_when_nothing_was_proposed(self):
        model = FakeModel({'alternatives': []})
        self.assertEqual({'example': ROW['example'], 'accepted': [], 'rejected': []}, alternatives_for(ROW, model))
        self.assertEqual(1, len(model.prompts))

    def test_unusable_replies_leave_the_row_pending(self):
        for proposal, check in [({}, None), ({'alternatives': 'parvenir'}, None),
                                ({'alternatives': ['parvenir', 'atteindre']}, {'verdicts': [verdict('parvenir')]}),
                                ({'alternatives': ['parvenir']}, {}),
                                ({'alternatives': ['parvenir']}, {'verdicts': [verdict('dérailler')]}),
                                ({'alternatives': ['parvenir']}, {'verdicts': [verdict('parvenir', False), verdict('Parvenir')]}),
                                ({'alternatives': ['parvenir']}, {'verdicts': [{'candidate': 'parvenir'}]}),
                                ({'alternatives': ['parvenir']}, {'verdicts': [verdict('parvenir') | {'same_meaning': 'yes'}]})]:
            model = FakeModel(*[r for r in (proposal, check) if r is not None])
            with self.subTest(proposal), self.assertRaises(UnusableReply):
                alternatives_for(ROW, model)

    def test_verdicts_are_matched_by_candidate_not_position(self):
        model = FakeModel({'alternatives': ['parvenir', 'dérailler']},
                          {'verdicts': [verdict('dérailler', False), verdict('Parvenir')]})
        self.assertEqual(['parvenir'], alternatives_for(ROW, model)['accepted'])

    def test_candidates_are_trimmed_before_filtering(self):
        model = FakeModel({'alternatives': [' Arrivér ', 'parvenir', ' parvenir ']}, {'verdicts': [verdict('parvenir')]})
        record = alternatives_for(ROW, model)
        self.assertEqual(['parvenir'], record['accepted'])
        self.assertEqual(['target variant', 'duplicate'], [r['reason'] for r in record['rejected']])

    def test_accepts_at_most_five(self):
        words = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6']
        model = FakeModel({'alternatives': words}, {'verdicts': [verdict(w) for w in words]})
        self.assertEqual(words[:5], alternatives_for(ROW, model)['accepted'])


class ResumeTests(unittest.TestCase):
    def test_redoes_only_rows_without_a_record_for_their_current_example(self):
        rows = [ROW, ROW | {'id': 'fr-core-2', 'rank': 200}, ROW | {'id': 'fr-core-3', 'rank': 150, 'example': 'Il va {partir}.'}]
        records = {'fr-core-1': {'example': ROW['example'], 'accepted': ['parvenir'], 'rejected': []},
                   'fr-core-3': {'example': 'Il va {sortir}.', 'accepted': [], 'rejected': []}}
        self.assertEqual(['fr-core-3', 'fr-core-2'], [r['id'] for r in pending(rows, records)])
        run(rows, records, lambda prompt: {'alternatives': []}, workers=2, limit=1)
        self.assertEqual('Il va {partir}.', records['fr-core-3']['example'])
        self.assertNotIn('fr-core-2', records)

    def test_a_failed_row_stays_pending_and_the_run_goes_on(self):
        rows = [ROW, ROW | {'id': 'fr-core-2', 'rank': 200, 'example': 'Il va {partir}.'}]
        records = run(rows, {}, lambda prompt: {} if 'arriver' in prompt else {'alternatives': []})
        self.assertEqual(['fr-core-2'], list(records))

    def test_saves_and_loads_sorted_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'alternatives.json'
            self.assertEqual({}, load(path))
            records = {'b': {'example': '{x}', 'accepted': [], 'rejected': []}, 'a': {'example': '{y}', 'accepted': ['z'], 'rejected': []}}
            save(path, records, 'gemma4:26b')
            self.assertEqual(['a', 'b'], list(json.loads(path.read_text())['examples']))
            self.assertEqual(records, load(path))


if __name__ == '__main__':
    unittest.main()
