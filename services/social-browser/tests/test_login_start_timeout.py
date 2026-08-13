import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.integrations.synapse_engine.service import EmbeddedSynapseService


class WaitingAdapter:
    def __init__(self) -> None:
        self.cancelled = False

    async def get_qrcode(self):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise


class WaitingValidationAdapter:
    def __init__(self) -> None:
        self.cancelled = False

    async def validate_cookie(self, storage_state, *, include_reload_evidence):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise


class SequenceValidationAdapter:
    def __init__(self, *results: dict) -> None:
        self.validate_cookie = AsyncMock(side_effect=results)


class LoginStartTimeoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_timeout_cancels_adapter_task(self):
        service = object.__new__(EmbeddedSynapseService)
        service._login_sessions = {}
        service._lock = asyncio.Lock()
        adapter = WaitingAdapter()

        with (
            patch(
                "app.integrations.synapse_engine.service.get_platform_adapter",
                return_value=adapter,
            ),
            patch(
                "app.integrations.synapse_engine.service.LOGIN_START_TIMEOUT_SECONDS",
                0.01,
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "已取消本次扫码"):
                await service.start_login("kuaishou", "temp_timeout")

        self.assertTrue(adapter.cancelled)
        self.assertEqual(service._login_sessions, {})

    async def test_account_validation_timeout_cancels_adapter_and_preserves_state(self):
        service = object.__new__(EmbeddedSynapseService)
        service.cookie_manager = MagicMock()
        service.cookie_manager.load.return_value = {
            "cookies": [{"name": "session", "value": "real"}],
            "origins": [],
        }
        adapter = WaitingValidationAdapter()

        with (
            patch(
                "app.integrations.synapse_engine.service.get_platform_adapter",
                return_value=adapter,
            ),
            patch(
                "app.integrations.synapse_engine.service.ACCOUNT_VALIDATE_TIMEOUT_SECONDS",
                0.01,
            ),
        ):
            result = await service.validate_account_cookie(
                "bilibili", "account_timeout"
            )

        self.assertTrue(adapter.cancelled)
        self.assertFalse(result["valid"])
        self.assertTrue(result["transient"])
        self.assertIn("已取消刷新并保留原账号状态", result["reason"])
        service.cookie_manager.save.assert_not_called()

    async def test_douyin_retries_one_definitive_invalid_result_before_expiring(self):
        service = object.__new__(EmbeddedSynapseService)
        service.cookie_manager = MagicMock()
        storage_state = {
            "cookies": [{"name": "sessionid", "value": "real"}],
            "origins": [],
        }
        refreshed_state = {
            "cookies": [{"name": "sessionid", "value": "refreshed"}],
            "origins": [],
        }
        service.cookie_manager.load.return_value = storage_state
        adapter = SequenceValidationAdapter(
            {
                "valid": False,
                "reason": "Cookie invalid: redirected to login page",
            },
            {
                "valid": True,
                "reason": "creator account API verified",
                "user_info": {"user_id": "96699089696"},
                "storage_state": refreshed_state,
            },
        )

        with (
            patch(
                "app.integrations.synapse_engine.service.get_platform_adapter",
                return_value=adapter,
            ),
            patch(
                "app.integrations.synapse_engine.service.ACCOUNT_VALIDATE_RETRY_DELAY_SECONDS",
                0,
            ),
        ):
            result = await service.validate_account_cookie(
                "douyin", "account_retry"
            )

        self.assertTrue(result["valid"])
        self.assertNotIn("storage_state", result)
        self.assertEqual(adapter.validate_cookie.await_count, 2)
        service.cookie_manager.save.assert_called_once_with(
            "douyin", "account_retry", refreshed_state
        )
