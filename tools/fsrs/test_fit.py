import json
from pathlib import Path
import unittest
from datetime import datetime, timedelta, timezone
from fit import Review, extract, fit, training_review_count


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


class TrainingEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.start = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def test_first_reviews_do_not_train(self):
        reviews = [Review(str(i), 3, self.start, 10000) for i in range(1000)]
        with self.assertRaisesRegex(ValueError, '512.*found 0'):
            fit(reviews)

    def test_intraday_reviews_do_not_train(self):
        reviews = [Review('card', 3, self.start + timedelta(minutes=i), 10000)
                   for i in range(1000)]
        with self.assertRaisesRegex(ValueError, '512.*found 0'):
            fit(reviews)

    def test_long_history_only_trains_first_64_reviews(self):
        reviews = [Review('card', 3, self.start + timedelta(days=i), 10000)
                   for i in range(1000)]
        self.assertEqual(training_review_count(reviews), 63)
        with self.assertRaisesRegex(ValueError, '512.*found 63'):
            fit(reviews)

    def test_spacing_uses_previous_review_not_first_review(self):
        reviews = [Review('card', 3, self.start + timedelta(hours=i), 10000)
                   for i in range(64)]
        self.assertEqual(training_review_count(reviews), 0)

    def test_day_spaced_evidence_across_cards(self):
        reviews = [Review(str(card), 3, self.start + timedelta(days=i), 10000)
                   for card in range(100) for i in range(10)]
        self.assertEqual(training_review_count(list(reversed(reviews))), 900)
