import json
from pathlib import Path
import unittest
from fit import extract, fit


class ExtractionTest(unittest.TestCase):
    def test_backup_histories_and_duplicate(self):
        backup = json.loads(Path(__file__).with_name('backup-fixture.json').read_text())
        reviews = extract(backup)
        self.assertEqual([r.rating for r in reviews], [3, 1])
        self.assertEqual([r.key for r in reviews], ['word:Reading'] * 2)
        self.assertEqual(reviews[0].duration, 10000)
        self.assertEqual(reviews[1].duration, 12000)

    def test_too_few_reviews(self):
        with self.assertRaisesRegex(ValueError, '1000.*found 0'):
            fit([])

    def test_wrong_backup_version(self):
        with self.assertRaisesRegex(ValueError, 'version 2'):
            extract({'format': 'langocard-backup', 'version': 1})
