import hashlib
import json
import unittest
from pathlib import Path
from build_corpus import candidates

ROOT = Path(__file__).resolve().parents[2]

class SourceAlignmentTests(unittest.TestCase):
    def test_definition_label_wins_over_drifted_number(self):
        record = dict(word='change', pos='noun', senses=[
            dict(glosses=['Substitution faite par un animal.'], examples=[dict(text='Elle observe le change dans la forêt.')]),
            dict(glosses=['Vêtement prévu pour se changer.'], examples=[dict(text='Elle prépare un change pour demain.')])],
            translations=[dict(lang_code='en', word='change of clothes', sense_index=1, sense='Vêtement prévu pour se changer.')])
        rows = list(candidates(record, dict(pos=['NOM'], genders=['m'], rank=1), {'observe', 'prépare'}))
        self.assertEqual(1, len(rows))
        self.assertEqual('Vêtement prévu pour se changer.', rows[0]['definition'])
        self.assertEqual('Elle prépare {un change} pour demain.', rows[0]['example'])
        self.assertEqual('masculine', rows[0]['gender'])

    def test_ambiguous_label_and_quoted_examples_are_not_auto_aligned(self):
        record = dict(word='change', pos='noun', senses=[
            dict(glosses=['Vêtement prévu pour le soir.'], examples=[dict(text='Elle prépare un change pour demain.')]),
            dict(glosses=['Vêtement prévu pour le matin.'], examples=[dict(text='Elle prépare un change pour demain.')])],
            translations=[dict(lang_code='en', word='clothes', sense_index=1, sense='Vêtement prévu pour')])
        self.assertEqual([], list(candidates(record, dict(pos=['NOM'], genders=['m'], rank=1), {'prépare'})))
        record['senses'] = record['senses'][:1]
        record['senses'][0]['examples'][0]['ref'] = 'A copyrighted book'
        self.assertEqual([], list(candidates(record, dict(pos=['NOM'], genders=['m'], rank=1), {'prépare'})))

    def test_published_catalogue_digests_counts_and_no_overlapping_ids(self):
        catalogue = json.loads((ROOT/'content/catalogue.json').read_text())
        seen = set()
        for entry in catalogue['packs']:
            path = ROOT/'content'/entry['url'].split('/')[-1]
            self.assertEqual(entry['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
            pack = json.loads(path.read_text())
            self.assertEqual(entry['meanings'], len(pack['entries']))
            self.assertEqual(entry['lemmas'], len({row['lemma'] for row in pack['entries']}))
            for row in pack['entries']:
                self.assertNotIn(row['id'], seen)
                seen.add(row['id'])
                self.assertTrue(row['sourceUrl'].startswith('https://fr.wiktionary.org/wiki/'))
                self.assertEqual('CC BY-SA 4.0', row['license'])
        self.assertEqual(1116, len(seen))
        self.assertEqual((ROOT/'content/fr-source-frequent-2026-11-v1.json').read_bytes(),
                         (ROOT/'apps/android/app/src/main/assets/frequent-pack.json').read_bytes())
        self.assertEqual(20000, len(json.loads((ROOT/'content/ranked-lemmas.json').read_text())))

if __name__ == '__main__':
    unittest.main()
