import json
import unittest
from generate_alternatives import ALTERNATIVES, load
from publish_catalogue import PLACEMENT, ROOT, ContentError, build, pack_entry


def row(**changes):
    return dict(id='fr-core-1', word='arbre', english='A tree.', definition='Plante ligneuse.', example='Un {arbre} pousse.',
                topic='daily', lemma='arbre', rank=3000, sourceSense=1, sourcePos='noun', gender='m') | changes


def one_per_band(**changes):
    return [row(id='a', rank=103) | changes, row(id='b', rank=2501), row(id='c', rank=7001)]


class ConversionTests(unittest.TestCase):
    def test_nouns_take_the_article_of_their_single_gender(self):
        tree = pack_entry(row())
        self.assertEqual(('un arbre', 'masculine'), (tree['word'], tree['gender']))
        table = pack_entry(row(word='table', gender='f'))
        self.assertEqual(('une table', 'feminine'), (table['word'], table['gender']))
        pupil = pack_entry(row(word='élève', gender='m/f'))
        self.assertEqual(('élève', None), (pupil['word'], pupil['gender']))

    def test_non_nouns_are_marked_as_such_even_when_they_start_with_an_article(self):
        entry = pack_entry({k: v for k, v in row(word='un tel', lemma='un tel', sourcePos='pron').items() if k != 'gender'})
        self.assertEqual('un tel', entry['word'])
        self.assertIn('gender', entry)
        self.assertIsNone(entry['gender'])

    def test_entry_carries_its_example_and_wiktionary_source(self):
        entry = pack_entry(row(word='à l’improviste', lemma='à l’improviste', sourcePos='adv', example='Il arrive {à l’improviste}.'))
        self.assertEqual(['Il arrive {à l’improviste}.'], entry['examples'])
        self.assertNotIn('example', entry)
        self.assertEqual('https://fr.wiktionary.org/wiki/%C3%A0_l%E2%80%99improviste#fr', entry['sourceUrl'])
        self.assertEqual('CC BY-SA 4.0', entry['license'])


class PublishTests(unittest.TestCase):
    def packs(self, rows):
        files = build(rows, b'notice')
        catalogue = json.loads(files['content/catalogue.json'])
        return {p['id']: [e['rank'] for e in json.loads(files['content/' + p['id'] + '.json'])['entries']] for p in catalogue['packs']}

    def test_bands_cut_by_rank_with_no_upper_cap(self):
        ranks = [103, 2500, 2501, 7000, 7001, 20765]
        packs = self.packs([row(id=f'e{rank}', rank=rank) for rank in ranks])
        self.assertEqual({'fr-core-frequent-2026-11-v1': [103, 2500], 'fr-core-everyday-2026-11-v1': [2501, 7000],
                          'fr-core-extended-2026-11-v1': [7001, 20765]}, packs)

    def test_bundled_pack_is_the_published_frequent_pack(self):
        files = build(one_per_band(), b'notice')
        self.assertEqual(files['content/fr-core-frequent-2026-11-v1.json'], files['apps/android/app/src/main/assets/frequent-pack.json'])

    def test_refuses_content_the_app_would_reject(self):
        broken = [dict(example='Un arbre pousse.'), dict(example='{Un} {arbre} pousse.'), dict(topic='sport'),
                  dict(english=' '), dict(id='a b'), dict(rank=102)]
        for change in broken:
            with self.subTest(change), self.assertRaises(ContentError):
                build(one_per_band(**change), b'notice')
        with self.assertRaises(ContentError):
            build(one_per_band() + [row(id='a', rank=8000)], b'notice')

    def test_merges_accepted_alternatives_into_their_example(self):
        alternatives = {'a': {'example': 'Un {arbre} pousse.', 'accepted': ['arbuste', 'végétal'], 'rejected': []},
                        'b': {'example': 'Un {arbre} pousse.', 'accepted': [], 'rejected': [{'candidate': 'bois', 'reason': 'checker'}]}}
        files = build(one_per_band(), b'notice', alternatives)
        frequent = json.loads(files['content/fr-core-frequent-2026-11-v1.json'])['entries']
        everyday = json.loads(files['content/fr-core-everyday-2026-11-v1.json'])['entries']
        self.assertEqual(['Un {arbre|arbuste|végétal} pousse.'], frequent[0]['examples'])
        self.assertEqual(['Un {arbre} pousse.'], everyday[0]['examples'])

    def test_refuses_stale_or_invalid_alternatives(self):
        record = lambda accepted, example='Un {arbre} pousse.': {'example': example, 'accepted': accepted, 'rejected': []}
        broken = [{'a': record(['arbuste'], 'Un {chêne} pousse.')}, {'gone': record(['arbuste'])},
                  {'a': record(['Arbré'])}, {'a': record([' '])}, {'a': record(['arbuste|végétal'])}, {'a': record('bois')}, {'a': record(['x1', 'x2', 'x3', 'x4', 'x5', 'x6'])}]
        for alternatives in broken:
            with self.subTest(alternatives), self.assertRaises(ContentError):
                build(one_per_band(), b'notice', alternatives)

    def test_committed_files_are_what_the_draft_publishes(self):
        files = build(json.loads((ROOT/'content/core-entries.json').read_text()), (ROOT/'content/NOTICE.md').read_bytes(),
                      load(ROOT/ALTERNATIVES), (ROOT/PLACEMENT).read_bytes())
        self.assertIn('apps/android/app/src/main/assets/placement-items.json', files)
        for path, data in files.items():
            self.assertEqual(data, (ROOT/path).read_bytes(), path)
        catalogue = json.loads(files['content/catalogue.json'])
        self.assertEqual([2330, 4414, 13160], [p['meanings'] for p in catalogue['packs']])
