import copy
import tempfile
import unittest
from pathlib import Path

from app.integrations.synapse_engine.cookie.manager import CookieManager


class CookieBackupTests(unittest.TestCase):
    def test_snapshot_round_trip_keeps_cookie_payload_encrypted(self):
        state = {
            "cookies": [{"name": "sessionid", "value": "secret-cookie"}],
            "origins": [],
        }
        with tempfile.TemporaryDirectory() as source_dir, tempfile.TemporaryDirectory() as target_dir:
            source = CookieManager(source_dir)
            source.save("douyin", "account_12345678", state)

            snapshot = source.export_encrypted_snapshot()

            self.assertEqual(snapshot["version"], 1)
            self.assertEqual(len(snapshot["files"]), 1)
            self.assertNotIn("secret-cookie", snapshot["files"][0]["contentBase64"])

            target = CookieManager(target_dir)
            result = target.restore_encrypted_snapshot(snapshot)

            self.assertEqual(result["restored"], 1)
            self.assertEqual(target.load("douyin", "account_12345678"), state)
            raw = next(Path(target_dir).glob("*.json")).read_text(encoding="utf-8")
            self.assertFalse(raw.lstrip().startswith("{"))

    def test_invalid_snapshot_is_rejected_before_existing_state_is_deleted(self):
        state = {"cookies": [{"name": "sessionid", "value": "current"}], "origins": []}
        with tempfile.TemporaryDirectory() as directory:
            manager = CookieManager(directory)
            manager.save("bilibili", "account_12345678", state)
            snapshot = manager.export_encrypted_snapshot()
            tampered = copy.deepcopy(snapshot)
            encoded = tampered["files"][0]["contentBase64"]
            tampered["files"][0]["contentBase64"] = (
                ("A" if encoded[0] != "A" else "B") + encoded[1:]
            )

            with self.assertRaisesRegex(ValueError, "完整性校验失败"):
                manager.restore_encrypted_snapshot(tampered, replace=True)

            self.assertEqual(manager.load("bilibili", "account_12345678"), state)


if __name__ == "__main__":
    unittest.main()
