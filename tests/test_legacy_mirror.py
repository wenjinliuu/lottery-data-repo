import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from sync_legacy_mirror import sync


class LegacyMirrorTests(unittest.TestCase):
    def test_aliases_are_refreshed_without_recursive_copies(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "draws").mkdir()
            (root / "bootstrap.json").write_text('{"version":2}')
            (root / "draws/ssq.json").write_text('{"draws":[]}')
            self.assertEqual(sync(root), 2)
            self.assertEqual((root / "v2/draws/ssq.json").read_bytes(), (root / "draws/ssq.json").read_bytes())
            (root / "v2/obsolete.json").write_text('{}')
            (root / "bootstrap.json").write_text('{"version":2,"updated":true}')
            self.assertEqual(sync(root), 2)
            self.assertEqual((root / "v2/bootstrap.json").read_bytes(), (root / "bootstrap.json").read_bytes())
            self.assertFalse((root / "v2/v2").exists())
            self.assertFalse((root / "v2/obsolete.json").exists())
