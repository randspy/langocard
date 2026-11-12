import unittest
from test_emulator import valid_snapshot

class RecoveryTests(unittest.TestCase):
    def test_shell_errors_are_never_restored_as_learning_data(self):
        self.assertIsNone(valid_snapshot(b'cat: files/learning-v1.json: No such file', 0))
        self.assertIsNone(valid_snapshot(b'{"version":1,"cards":{}}', 1))
        self.assertIsNone(valid_snapshot(b'[]', 0))
        self.assertIsNone(valid_snapshot(b'{"version":1,"cards":"broken"}', 0))

    def test_valid_snapshots_are_preserved_byte_for_byte(self):
        payload=b'{"version":1,"cards":{},"reviews":[],"placementDone":true}'
        self.assertEqual(payload, valid_snapshot(payload, 0))

if __name__ == '__main__':
    unittest.main()
