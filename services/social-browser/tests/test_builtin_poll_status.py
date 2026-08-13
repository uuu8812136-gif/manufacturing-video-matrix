import asyncio
import os
import time
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.integrations.synapse_engine.platforms.base import LoginStatus, UserInfo
from app.integrations.synapse_engine.platforms.builtin import BuiltinPlatformAdapter
from app.integrations.synapse_engine.service import extract_user_info_from_storage_state


class FakePage:
    def __init__(self, url: str) -> None:
        self.url = url

    def is_closed(self) -> bool:
        return False


class FakeContext:
    def __init__(self, cookies: list[dict]) -> None:
        self._cookies = cookies

    async def cookies(self) -> list[dict]:
        return self._cookies

    async def storage_state(self) -> dict:
        return {"cookies": self._cookies, "origins": []}


class PollStatusTests(unittest.IsolatedAsyncioTestCase):
    def adapter_with_session(
        self,
        *,
        page_url: str,
        cookies: list[dict],
        qr_status: str | None = None,
    ):
        adapter = BuiltinPlatformAdapter("douyin")
        session_id = "session-under-test"
        adapter._sessions[session_id] = {
            "page": FakePage(page_url),
            "context": FakeContext(cookies),
            "created_at": time.time(),
            "last_status": LoginStatus.WAITING,
            "douyin_qr_state": (
                {"status": qr_status, "message": ""} if qr_status else None
            ),
        }
        adapter._extract_user_info = AsyncMock(
            return_value=UserInfo(user_id="real-user")
        )
        adapter._verify_douyin_creator_session = AsyncMock(
            return_value={"valid": True, "reason": "creator account API verified"}
        )
        return adapter, session_id

    async def test_strong_cookie_without_official_confirmation_remains_waiting(self):
        adapter, session_id = self.adapter_with_session(
            page_url=BuiltinPlatformAdapter("douyin").login_url,
            cookies=[{"name": "sessionid", "value": "authenticated"}],
        )

        result = await adapter.poll_status(session_id)

        self.assertEqual(result.status, LoginStatus.WAITING)

    async def test_anonymous_cookie_on_login_url_remains_waiting(self):
        adapter, session_id = self.adapter_with_session(
            page_url=BuiltinPlatformAdapter("douyin").login_url,
            cookies=[{"name": "ttwid", "value": "anonymous"}],
        )

        result = await adapter.poll_status(session_id)

        self.assertEqual(result.status, LoginStatus.WAITING)

    async def test_redirect_without_strong_cookie_does_not_false_confirm(self):
        adapter, session_id = self.adapter_with_session(
            page_url="https://creator.douyin.com/creator-micro/home",
            cookies=[{"name": "ttwid", "value": "anonymous"}],
        )

        result = await adapter.poll_status(session_id)

        self.assertEqual(result.status, LoginStatus.WAITING)
        self.assertIn("等待扫码", result.message)

    async def test_official_scanned_state_is_exposed_to_frontend(self):
        adapter, session_id = self.adapter_with_session(
            page_url=BuiltinPlatformAdapter("douyin").login_url,
            cookies=[{"name": "ttwid", "value": "anonymous"}],
            qr_status="scanned",
        )

        result = await adapter.poll_status(session_id)

        self.assertEqual(result.status, LoginStatus.SCANNED)
        self.assertIn("确认登录", result.message)

    async def test_official_confirmed_without_strong_cookie_requires_verification(self):
        adapter, session_id = self.adapter_with_session(
            page_url=BuiltinPlatformAdapter("douyin").login_url,
            cookies=[{"name": "future_auth_cookie", "value": "authenticated"}],
            qr_status="confirmed",
        )

        result = await adapter.poll_status(session_id)

        self.assertEqual(result.status, LoginStatus.SECURITY_VERIFICATION)

    async def test_official_confirmed_with_strong_cookie_and_creator_api_confirms(self):
        adapter, session_id = self.adapter_with_session(
            page_url=BuiltinPlatformAdapter("douyin").login_url,
            cookies=[{"name": "sessionid", "value": "authenticated"}],
            qr_status="confirmed",
        )

        result = await adapter.poll_status(session_id)

        self.assertEqual(result.status, LoginStatus.CONFIRMED)
        self.assertEqual(result.full_state["cookies"][0]["name"], "sessionid")

    async def test_security_verification_message_is_not_mapped_to_waiting(self):
        adapter, session_id = self.adapter_with_session(
            page_url=BuiltinPlatformAdapter("douyin").login_url,
            cookies=[],
            qr_status="scanned",
        )
        adapter._sessions[session_id]["douyin_qr_state"]["message"] = (
            "为保障你的账号安全，请前往抖音APP完成验证后再进行登录"
        )

        result = await adapter.poll_status(session_id)

        self.assertEqual(result.status, LoginStatus.SECURITY_VERIFICATION)

    async def test_security_verification_completes_after_web_identity_check(self):
        adapter, session_id = self.adapter_with_session(
            page_url="https://creator.douyin.com/creator-micro/home",
            cookies=[{"name": "sessionid", "value": "authenticated"}],
            qr_status="scanned",
        )
        adapter._sessions[session_id]["douyin_qr_state"]["message"] = (
            "为保障你的账号安全，请前往抖音APP完成验证后再进行登录"
        )
        adapter._douyin_verification_prompt = AsyncMock(
            return_value={"visible": False, "options": [], "checked_at": "now"}
        )

        result = await adapter.poll_status(session_id)

        self.assertEqual(result.status, LoginStatus.CONFIRMED)
        self.assertEqual(result.full_state["cookies"][0]["name"], "sessionid")
        completion = adapter._sessions[session_id]["douyin_qr_state"]["completion"]
        self.assertEqual(completion["source"], "official_web_identity_verification")

    async def test_visible_security_verification_prompt_stays_pending(self):
        adapter, session_id = self.adapter_with_session(
            page_url="https://creator.douyin.com/creator-micro/home",
            cookies=[{"name": "sessionid", "value": "authenticated"}],
            qr_status="scanned",
        )
        adapter._sessions[session_id]["douyin_qr_state"]["message"] = (
            "为保障你的账号安全，请前往抖音APP完成验证后再进行登录"
        )
        adapter._douyin_verification_prompt = AsyncMock(
            return_value={
                "visible": True,
                "options": ["接收短信验证码"],
                "checked_at": "now",
            }
        )

        result = await adapter.poll_status(session_id)

        self.assertEqual(result.status, LoginStatus.SECURITY_VERIFICATION)
        self.assertIn("接收短信验证码", result.message)

    async def test_official_expired_state_is_exposed_to_frontend(self):
        adapter, session_id = self.adapter_with_session(
            page_url=BuiltinPlatformAdapter("douyin").login_url,
            cookies=[],
            qr_status="expired",
        )

        result = await adapter.poll_status(session_id)

        self.assertEqual(result.status, LoginStatus.EXPIRED)


class QrBrowserModeTests(unittest.IsolatedAsyncioTestCase):
    async def test_visible_host_edge_is_connected_over_cdp(self):
        adapter = BuiltinPlatformAdapter("douyin")
        page = MagicMock()
        page.url = "about:blank"
        page.close = AsyncMock()
        context = MagicMock()
        context.pages = [page]
        browser = MagicMock()
        browser.contexts = [context]
        browser.close = AsyncMock()
        playwright = MagicMock()
        playwright.chromium.connect_over_cdp = AsyncMock(return_value=browser)
        playwright.chromium.launch = AsyncMock()
        starter = MagicMock()
        starter.start = AsyncMock(return_value=playwright)
        settings = MagicMock()
        settings.SYNAPSE_HOST_BROWSER_BRIDGE_URL = (
            "http://host.docker.internal:18082"
        )
        settings.SOCIAL_BROWSER_API_KEY = "k" * 32

        response = MagicMock()
        response.raise_for_status = MagicMock()
        response.json.return_value = {
            "wsEndpoint": (
                "ws://host.docker.internal:49222/devtools/browser/real"
            ),
            "hostHeader": "localhost:49222",
        }
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.post = AsyncMock(return_value=response)

        with (
            patch(
                "app.integrations.synapse_engine.utils.playwright_provider.async_playwright",
                return_value=starter,
            ),
            patch("app.core.config.get_settings", return_value=settings),
            patch(
                "app.integrations.synapse_engine.platforms.builtin.httpx.AsyncClient",
                return_value=client,
            ),
        ):
            result = await adapter._launch_browser(
                headless=False,
                visible_session_id="a" * 32,
            )

        self.assertEqual(result, (browser, context))
        playwright.chromium.connect_over_cdp.assert_awaited_once_with(
            "ws://host.docker.internal:49222/devtools/browser/real",
            headers={"Host": "localhost:49222"},
            timeout=20_000,
        )
        playwright.chromium.launch.assert_not_awaited()
        self.assertIs(vars(context)["_synapse_initial_page"], page)
        self.assertTrue(
            vars(context)["_synapse_launch_profile"]["visible"]
        )

    async def test_browser_cleanup_has_independent_time_budgets(self):
        adapter = BuiltinPlatformAdapter("xiaohongshu")
        browser = MagicMock()
        playwright = MagicMock()
        connection = MagicMock()
        playwright._impl_obj._connection = connection
        browser._synapse_pw = playwright
        browser_close = asyncio.get_running_loop().create_future()
        browser_close.set_result(None)
        connection_stop = asyncio.get_running_loop().create_future()
        connection_stop.set_result(None)
        browser.close = MagicMock(return_value=browser_close)
        connection.stop_async = MagicMock(return_value=connection_stop)

        with patch(
            "app.integrations.synapse_engine.platforms.builtin.asyncio.wait_for",
            new=AsyncMock(side_effect=[asyncio.TimeoutError(), None]),
        ) as wait_for:
            await adapter._close_browser(browser)

        self.assertEqual(wait_for.await_args_list[0].kwargs["timeout"], 5)
        self.assertEqual(wait_for.await_args_list[1].kwargs["timeout"], 3)
        browser.close.assert_called_once_with()
        connection.stop_async.assert_called_once_with()
        playwright.stop.assert_not_called()

    async def test_browser_cleanup_force_terminates_stuck_driver(self):
        adapter = BuiltinPlatformAdapter("bilibili")
        browser = MagicMock()
        playwright = MagicMock()
        connection = MagicMock()
        playwright._impl_obj._connection = connection
        browser._synapse_pw = playwright
        browser.close = AsyncMock()
        connection.stop_async = AsyncMock()
        adapter._force_terminate_playwright_process = AsyncMock()

        with patch.object(
            adapter,
            "_stop_playwright",
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            await adapter._close_browser(browser)

        adapter._force_terminate_playwright_process.assert_awaited_once_with(
            playwright, timeout=2
        )

    async def test_context_creation_failure_closes_launched_browser(self):
        adapter = BuiltinPlatformAdapter("bilibili")
        browser = MagicMock()
        browser.new_context = AsyncMock(
            side_effect=RuntimeError("Error setting storage state")
        )
        playwright = MagicMock()
        playwright.chromium.launch = AsyncMock(return_value=browser)
        starter = MagicMock()
        starter.start = AsyncMock(return_value=playwright)
        adapter._browser_proxy = MagicMock(return_value="")
        adapter._close_browser = AsyncMock()

        with (
            patch(
                "app.integrations.synapse_engine.utils.playwright_provider.async_playwright",
                return_value=starter,
            ),
            patch(
                "app.integrations.synapse_engine.utils.playwright_provider.resolve_chromium_executable",
                return_value="/fake/chromium",
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "storage state"):
                await adapter._launch_browser(
                    headless=True,
                    storage_state={"cookies": [{"name": "SESSDATA", "value": "real"}]},
                )

        self.assertIs(browser._synapse_pw, playwright)
        adapter._close_browser.assert_awaited_once_with(browser)

    async def test_cancelled_qr_start_closes_unregistered_browser(self):
        adapter = BuiltinPlatformAdapter("kuaishou")
        browser = MagicMock()
        context = MagicMock()
        page = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        adapter._launch_browser = AsyncMock(return_value=(browser, context))
        adapter._goto_with_retries = AsyncMock(side_effect=asyncio.CancelledError())
        adapter._close_browser = AsyncMock()

        with self.assertRaises(asyncio.CancelledError):
            await adapter.get_qrcode()

        adapter._close_browser.assert_awaited_once_with(browser)
        self.assertEqual(adapter._sessions, {})

    async def test_qr_login_respects_configured_browser_mode(self):
        adapter = BuiltinPlatformAdapter("bilibili")
        browser = MagicMock()
        context = MagicMock()
        page = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        adapter._launch_browser = AsyncMock(return_value=(browser, context))
        adapter._goto_with_retries = AsyncMock()
        adapter._recover_blank_login_page = AsyncMock()
        adapter._reveal_qrcode = AsyncMock()
        adapter._wait_for_qrcode_candidate = AsyncMock()
        adapter._capture_qrcode = AsyncMock(return_value=b"real-qr-image")

        qr = await adapter.get_qrcode()

        adapter._launch_browser.assert_awaited_once_with()
        adapter._recover_blank_login_page.assert_awaited_once_with(page)
        self.assertTrue(qr.qr_image.startswith("data:image/png;base64,"))
        self.assertEqual(
            qr.qr_hash,
            BuiltinPlatformAdapter._hash12(b"real-qr-image"),
        )
        self.assertIsNotNone(qr.generated_at)

    async def test_douyin_fast_response_timeout_falls_back_to_dom_after_12_seconds(self):
        adapter = BuiltinPlatformAdapter("douyin")
        browser = MagicMock()
        context = MagicMock()
        page = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        adapter._launch_browser = AsyncMock(return_value=(browser, context))
        adapter._goto_with_retries = AsyncMock()
        adapter._recover_blank_login_page = AsyncMock()
        adapter._reveal_qrcode = AsyncMock()
        adapter._wait_for_qrcode_candidate = AsyncMock()
        adapter._capture_qrcode = AsyncMock(return_value=b"dom-douyin-qr")
        adapter._browser_fingerprint = AsyncMock(return_value={})
        adapter._egress_evidence = AsyncMock(return_value={})
        adapter._maintain_douyin_qrcode = AsyncMock()

        with patch(
            "app.integrations.synapse_engine.platforms.builtin.asyncio.wait_for",
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ) as wait_for:
            qr = await adapter.get_qrcode()

        self.assertEqual(wait_for.await_args.kwargs["timeout"], 12)
        adapter._reveal_qrcode.assert_awaited_once_with(page)
        adapter._wait_for_qrcode_candidate.assert_awaited_once_with(
            page, timeout=12000
        )
        adapter._capture_qrcode.assert_awaited_once_with(page)
        self.assertTrue(qr.qr_image.startswith("data:image/png;base64,"))

    async def test_douyin_uses_reference_headless_browser_mode(self):
        adapter = BuiltinPlatformAdapter("douyin")
        browser = MagicMock()
        context = MagicMock()
        page = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        adapter._launch_browser = AsyncMock(return_value=(browser, context))
        adapter._goto_with_retries = AsyncMock()
        adapter._recover_blank_login_page = AsyncMock()
        adapter._reveal_qrcode = AsyncMock()
        adapter._wait_for_qrcode_candidate = AsyncMock()
        adapter._capture_qrcode = AsyncMock(return_value=b"real-qr-image")
        adapter._browser_fingerprint = AsyncMock(return_value={})
        adapter._egress_evidence = AsyncMock(return_value={})
        adapter._maintain_douyin_qrcode = AsyncMock()

        qr = await adapter.get_qrcode()

        adapter._launch_browser.assert_awaited_once_with(headless=True)
        self.assertTrue(qr.qr_image.startswith("data:image/png;base64,"))

    async def test_douyin_uses_visible_host_edge_when_bridge_is_configured(self):
        adapter = BuiltinPlatformAdapter("douyin")
        browser = MagicMock()
        context = MagicMock()
        page = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        adapter._launch_browser = AsyncMock(return_value=(browser, context))
        adapter._goto_with_retries = AsyncMock()
        adapter._recover_blank_login_page = AsyncMock()
        adapter._reveal_qrcode = AsyncMock()
        adapter._wait_for_qrcode_candidate = AsyncMock()
        adapter._capture_qrcode = AsyncMock(return_value=b"real-qr-image")
        adapter._browser_fingerprint = AsyncMock(return_value={})
        adapter._egress_evidence = AsyncMock(return_value={})
        adapter._maintain_douyin_qrcode = AsyncMock()
        settings = MagicMock()
        settings.SYNAPSE_HOST_BROWSER_BRIDGE_URL = (
            "http://host.docker.internal:18082"
        )

        with patch("app.core.config.get_settings", return_value=settings):
            qr = await adapter.get_qrcode()

        launch = adapter._launch_browser.await_args
        self.assertFalse(launch.kwargs["headless"])
        self.assertRegex(
            launch.kwargs["visible_session_id"], r"^[a-f0-9]{32}$"
        )
        self.assertTrue(qr.qr_image.startswith("data:image/png;base64,"))

    async def test_douyin_launch_does_not_install_catch_all_request_route(self):
        adapter = BuiltinPlatformAdapter("douyin")
        browser = MagicMock()
        browser.close = AsyncMock()
        context = MagicMock()
        context.route = AsyncMock()
        browser.new_context = AsyncMock(return_value=context)
        playwright = MagicMock()
        playwright.chromium.launch = AsyncMock(return_value=browser)
        starter = MagicMock()
        starter.start = AsyncMock(return_value=playwright)
        adapter._browser_proxy = MagicMock(return_value="")

        with (
            patch(
                "app.integrations.synapse_engine.utils.playwright_provider.async_playwright",
                return_value=starter,
            ),
            patch(
                "app.integrations.synapse_engine.utils.playwright_provider.resolve_chromium_executable",
                return_value="/fake/chromium",
            ),
        ):
            result = await adapter._launch_browser(headless=True)

        self.assertEqual(result, (browser, context))
        context.route.assert_not_awaited()
        adapter._stop_playwright = AsyncMock()
        await adapter._close_browser(browser)

    async def test_channels_qr_navigation_waits_for_commit_not_domcontentloaded(self):
        adapter = BuiltinPlatformAdapter("channels")
        browser = MagicMock()
        context = MagicMock()
        page = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        adapter._launch_browser = AsyncMock(return_value=(browser, context))
        adapter._goto_with_retries = AsyncMock()
        adapter._recover_blank_login_page = AsyncMock()
        adapter._reveal_qrcode = AsyncMock()
        adapter._wait_for_qrcode_candidate = AsyncMock()
        adapter._capture_qrcode = AsyncMock(return_value=b"real-qr-image")

        await adapter.get_qrcode()

        adapter._goto_with_retries.assert_awaited_once_with(
            page,
            adapter.login_url,
            wait_until="commit",
            timeout=60000,
        )

    async def test_xiaohongshu_uses_reference_headless_browser_mode(self):
        adapter = BuiltinPlatformAdapter("xiaohongshu")
        browser = MagicMock()
        context = MagicMock()
        page = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        adapter._launch_browser = AsyncMock(return_value=(browser, context))
        adapter._goto_with_retries = AsyncMock()
        adapter._recover_blank_login_page = AsyncMock()
        adapter._reveal_qrcode = AsyncMock()
        adapter._wait_for_qrcode_candidate = AsyncMock()
        adapter._capture_qrcode = AsyncMock(return_value=b"real-qr-image")

        await adapter.get_qrcode()

        adapter._launch_browser.assert_awaited_once_with(headless=True)

    async def test_baijiahao_qr_uses_stable_headless_browser_mode(self):
        adapter = BuiltinPlatformAdapter("baijiahao")
        browser = MagicMock()
        context = MagicMock()
        page = MagicMock()
        context.new_page = AsyncMock(return_value=page)
        adapter._launch_browser = AsyncMock(return_value=(browser, context))
        adapter._goto_with_retries = AsyncMock()
        adapter._recover_blank_login_page = AsyncMock()
        adapter._reveal_qrcode = AsyncMock()
        adapter._wait_for_qrcode_candidate = AsyncMock()
        adapter._capture_qrcode = AsyncMock(return_value=b"real-qr-image")

        await adapter.get_qrcode()

        adapter._launch_browser.assert_awaited_once_with(headless=True)

    async def test_xiaohongshu_authenticated_flows_use_headless_browser_mode(self):
        adapter = BuiltinPlatformAdapter("xiaohongshu")
        browser = MagicMock()
        context = MagicMock()
        adapter._launch_browser = AsyncMock(return_value=(browser, context))
        storage_state = {"cookies": [{"name": "a1", "value": "real"}]}

        result = await adapter._launch_authenticated_browser(storage_state)

        self.assertEqual(result, (browser, context))
        adapter._launch_browser.assert_awaited_once_with(
            headless=True, storage_state=storage_state
        )

    async def test_douyin_authenticated_flows_use_reference_headless_mode(self):
        adapter = BuiltinPlatformAdapter("douyin")
        browser = MagicMock()
        context = MagicMock()
        adapter._launch_browser = AsyncMock(return_value=(browser, context))
        storage_state = {"cookies": [{"name": "sessionid", "value": "real"}]}

        result = await adapter._launch_authenticated_browser(storage_state)

        self.assertEqual(result, (browser, context))
        adapter._launch_browser.assert_awaited_once_with(
            headless=True, storage_state=storage_state
        )

    async def test_cookie_validation_marks_browser_failures_transient(self):
        adapter = BuiltinPlatformAdapter("bilibili")
        browser = MagicMock()
        context = MagicMock()
        context.new_page = AsyncMock(
            side_effect=RuntimeError("Target page, context or browser has been closed")
        )
        adapter._launch_authenticated_browser = AsyncMock(
            return_value=(browser, context)
        )
        adapter._close_browser = AsyncMock()

        result = await adapter.validate_cookie(
            {"cookies": [{"name": "SESSDATA", "value": "real"}]},
            include_reload_evidence=False,
        )

        self.assertFalse(result["valid"])
        self.assertTrue(result["transient"])
        self.assertIn("Target page", result["reason"])
        adapter._close_browser.assert_awaited_once_with(browser)

    async def test_cookie_validation_marks_launch_failures_transient(self):
        adapter = BuiltinPlatformAdapter("bilibili")
        adapter._launch_authenticated_browser = AsyncMock(
            side_effect=RuntimeError("Error setting storage state")
        )

        result = await adapter.validate_cookie(
            {"cookies": [{"name": "SESSDATA", "value": "real"}]},
            include_reload_evidence=False,
        )

        self.assertFalse(result["valid"])
        self.assertTrue(result["transient"])
        self.assertIn("storage state", result["reason"])

    async def test_qr_canvas_pixels_are_read_without_screenshot(self):
        locator = MagicMock()
        locator.evaluate = AsyncMock(
            side_effect=["CANVAS", "data:image/png;base64,cGl4ZWxz"]
        )
        locator.get_attribute = AsyncMock(return_value=None)

        data = await BuiltinPlatformAdapter._data_image_bytes(locator)

        self.assertEqual(data, b"pixels")

    async def test_missing_qr_never_falls_back_to_full_page_screenshot(self):
        adapter = BuiltinPlatformAdapter("xiaohongshu")
        page = MagicMock()
        page.frames = []
        page.screenshot = AsyncMock(return_value=b"whole-login-page")

        with self.assertRaisesRegex(RuntimeError, "小红书登录二维码未加载"):
            await adapter._capture_qrcode(page)

        page.screenshot.assert_not_awaited()

    def test_docker_auto_detects_reference_host_proxy_without_env_change(self):
        adapter = BuiltinPlatformAdapter("xiaohongshu")
        settings = MagicMock()
        settings.SYNAPSE_BROWSER_PROXY = ""
        settings.SYNAPSE_BROWSER_NO_PROXY = False
        adapter._http_proxy_available = MagicMock(
            side_effect=lambda value: value == "http://host.docker.internal:7890"
        )

        blank_proxy_env = {
            "HTTPS_PROXY": "",
            "https_proxy": "",
            "HTTP_PROXY": "",
            "http_proxy": "",
        }
        with (
            patch.dict(os.environ, blank_proxy_env, clear=False),
            patch(
                "app.integrations.synapse_engine.platforms.builtin.Path.exists",
                return_value=True,
            ),
        ):
            proxy = adapter._browser_proxy(settings)

        self.assertEqual(proxy, "http://host.docker.internal:7890")


class DouyinUserInfoTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_media_follower_count_when_verify_field_is_null(self):
        adapter = BuiltinPlatformAdapter("douyin")
        page = MagicMock()
        page.url = "https://creator.douyin.com/creator-micro/home"
        page.evaluate = AsyncMock(
            return_value={
                "pc": {"uid": "96699089696"},
                "creator": {
                    "douyin_user_verify_info": {
                        "nick_name": "Zoyth",
                        "follower_count": None,
                    }
                },
                "media": {
                    "user": {
                        "uid": "96699089696",
                        "nickname": "Zoyth",
                        "follower_count": 189,
                    }
                },
            }
        )

        user_info = await adapter._extract_user_info(page)

        self.assertEqual(user_info.extra["follower_count"], 189)


class BilibiliUserInfoTests(unittest.IsolatedAsyncioTestCase):
    async def test_extracts_follower_count_from_official_relation_api(self):
        adapter = BuiltinPlatformAdapter("bilibili")
        page = MagicMock()
        page.url = "https://member.bilibili.com/platform/home"
        page.evaluate = AsyncMock(
            return_value={
                "nav": {
                    "code": 0,
                    "data": {
                        "mid": 343604595,
                        "uname": "Sctor",
                        "face": "https://i.example/avatar.jpg",
                        "level_info": {"current_level": 5},
                        "isLogin": True,
                    },
                },
                "relation": {
                    "code": 0,
                    "data": {"mid": 343604595, "follower": 321},
                },
            }
        )

        user_info = await adapter._extract_user_info(page)

        self.assertEqual(user_info.user_id, "343604595")
        self.assertEqual(user_info.name, "Sctor")
        self.assertEqual(user_info.extra["follower_count"], 321)
        evaluated_script = page.evaluate.await_args.args[0]
        self.assertIn("/x/relation/stat?vmid=", evaluated_script)
        self.assertIn("credentials: 'include'", evaluated_script)

    async def test_preserves_real_zero_follower_count(self):
        adapter = BuiltinPlatformAdapter("bilibili")
        page = MagicMock()
        page.url = "https://member.bilibili.com/platform/home"
        page.evaluate = AsyncMock(
            return_value={
                "nav": {
                    "code": 0,
                    "data": {"mid": 1, "uname": "new-account", "isLogin": True},
                },
                "relation": {"code": 0, "data": {"mid": 1, "follower": 0}},
            }
        )

        user_info = await adapter._extract_user_info(page)

        self.assertIn("follower_count", user_info.extra)
        self.assertEqual(user_info.extra["follower_count"], 0)


class BaijiahaoUserInfoTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def page(evaluate_result: dict):
        page = MagicMock()
        page.url = "https://baijiahao.baidu.com/builder/rc/home"
        page.evaluate = AsyncMock(return_value=evaluate_result)
        return page

    async def test_extracts_follower_count_from_official_home_api(self):
        adapter = BuiltinPlatformAdapter("baijiahao")
        page = self.page(
            {
                "home": {
                    "http_ok": True,
                    "status": 200,
                    "errno": 0,
                    "follower_count": 123,
                },
                "appinfo": {
                    "http_ok": True,
                    "status": 200,
                    "errno": 0,
                    "follower_count": 999,
                },
            }
        )

        user_info = await adapter._extract_user_info(page)

        self.assertEqual(user_info.extra["follower_count"], 123)
        evaluated_script = page.evaluate.await_args.args[0]
        self.assertIn("getJson('/pcui/home/index')", evaluated_script)
        self.assertIn("getJson('/builder/app/appinfo')", evaluated_script)
        self.assertIn("credentials: 'include'", evaluated_script)

    async def test_preserves_real_zero_from_primary_api(self):
        adapter = BuiltinPlatformAdapter("baijiahao")
        page = self.page(
            {
                "home": {
                    "http_ok": True,
                    "status": 200,
                    "errno": 0,
                    "follower_count": 0,
                },
                "appinfo": {
                    "http_ok": True,
                    "status": 200,
                    "errno": 0,
                    "follower_count": 88,
                },
            }
        )

        user_info = await adapter._extract_user_info(page)

        self.assertIn("follower_count", user_info.extra)
        self.assertEqual(user_info.extra["follower_count"], 0)

    async def test_uses_official_appinfo_fallback(self):
        adapter = BuiltinPlatformAdapter("baijiahao")
        page = self.page(
            {
                "home": {
                    "http_ok": True,
                    "status": 200,
                    "errno": 0,
                },
                "appinfo": {
                    "http_ok": True,
                    "status": 200,
                    "errno": 0,
                    "follower_count": 45,
                },
            }
        )

        user_info = await adapter._extract_user_info(page)

        self.assertEqual(user_info.extra["follower_count"], 45)

    async def test_failed_responses_do_not_fabricate_zero(self):
        adapter = BuiltinPlatformAdapter("baijiahao")
        page = self.page(
            {
                "home": {
                    "http_ok": True,
                    "status": 200,
                    "errno": 1,
                    "follower_count": 0,
                },
                "appinfo": {
                    "http_ok": False,
                    "status": 500,
                    "errno": 0,
                    "follower_count": 0,
                },
            }
        )

        user_info = await adapter._extract_user_info(page)

        self.assertNotIn("follower_count", user_info.extra)


class OfficialFollowerCaptureTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def response(
        url: str,
        method: str,
        status: int,
        payload: dict,
    ):
        response = MagicMock()
        response.url = url
        response.status = status
        response.request.method = method
        response.json = AsyncMock(return_value=payload)
        return response

    @staticmethod
    def page(url: str, evaluate_result: dict):
        page = MagicMock()
        page.url = url
        page.evaluate = AsyncMock(return_value=evaluate_result)
        page.context.cookies = AsyncMock(return_value=[])
        callbacks: dict[str, object] = {}
        page.on.side_effect = lambda event, callback: callbacks.__setitem__(
            event, callback
        )
        return page, callbacks

    async def test_xiaohongshu_uses_official_personal_info_and_preserves_zero(self):
        adapter = BuiltinPlatformAdapter("xiaohongshu")
        page, callbacks = self.page(
            "https://creator.xiaohongshu.com/new/home",
            {
                "userId": "61f4b6c200000000100060bf",
                "userName": "Sctor",
                "redId": "6505432799",
            },
        )
        adapter._install_official_follower_capture(page)
        callbacks["response"](
            self.response(
                "https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info",
                "GET",
                200,
                {"code": 0, "data": {"fans_count": 0}},
            )
        )

        user_info = await adapter._extract_user_info(page)

        self.assertEqual(user_info.user_id, "61f4b6c200000000100060bf")
        self.assertIn("follower_count", user_info.extra)
        self.assertEqual(user_info.extra["follower_count"], 0)

    async def test_xiaohongshu_fetches_personal_info_when_publish_page_did_not_emit_it(self):
        adapter = BuiltinPlatformAdapter("xiaohongshu")
        page = MagicMock()
        page.url = "https://creator.xiaohongshu.com/publish/publish"
        page.evaluate = AsyncMock(
            side_effect=[
                {
                    "userId": "61f4b6c200000000100060bf",
                    "userName": "Sctor",
                    "redId": "6505432799",
                },
                {
                    "http_ok": True,
                    "status": 200,
                    "code": 0,
                    "follower_count": 0,
                },
            ]
        )

        user_info = await adapter._extract_user_info(page)

        self.assertEqual(user_info.extra["follower_count"], 0)
        self.assertEqual(page.evaluate.await_count, 2)
        self.assertIn(
            "/api/galaxy/creator/home/personal_info",
            page.evaluate.await_args_list[1].args[0],
        )
        self.assertIn("credentials: 'include'", page.evaluate.await_args_list[1].args[0])
        self.assertIn("AbortController", page.evaluate.await_args_list[1].args[0])
        self.assertIn("8000", page.evaluate.await_args_list[1].args[0])

    async def test_kuaishou_prefers_info_v2_over_user_info_fallback(self):
        adapter = BuiltinPlatformAdapter("kuaishou")
        page, callbacks = self.page(
            "https://cp.kuaishou.com/profile",
            {"name": "Sctor", "avatar": "", "text": []},
        )
        page.context.cookies = AsyncMock(
            return_value=[{"name": "userId", "value": "914153829"}]
        )
        adapter._install_official_follower_capture(page)
        callbacks["response"](
            self.response(
                "https://cp.kuaishou.com/rest/cp/creator/pc/home/userInfo",
                "POST",
                200,
                {
                    "result": 1,
                    "data": {"coreUserInfo": {"fansNum": 12}},
                },
            )
        )
        await asyncio.sleep(0)
        callbacks["response"](
            self.response(
                "https://cp.kuaishou.com/rest/cp/creator/pc/home/infoV2",
                "POST",
                200,
                {"result": 1, "data": {"fansCnt": 34}},
            )
        )
        await asyncio.sleep(0)
        # A slower fallback response must not replace the preferred result.
        callbacks["response"](
            self.response(
                "https://cp.kuaishou.com/rest/cp/creator/pc/home/userInfo",
                "POST",
                200,
                {
                    "result": 1,
                    "data": {"coreUserInfo": {"fansNum": 12}},
                },
            )
        )

        user_info = await adapter._extract_user_info(page)

        self.assertEqual(user_info.user_id, "914153829")
        self.assertEqual(user_info.extra["follower_count"], 34)

    async def test_channels_uses_official_auth_data_http_201(self):
        adapter = BuiltinPlatformAdapter("channels")
        page, callbacks = self.page(
            "https://channels.weixin.qq.com/platform",
            {"lines": ["视频号·助手"], "avatar": ""},
        )
        page.context.cookies = AsyncMock(
            return_value=[{"name": "finder_username", "value": "session-3605838374"}]
        )
        adapter._install_official_follower_capture(page)
        callbacks["response"](
            self.response(
                "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data",
                "POST",
                201,
                {
                    "errCode": 0,
                    "errMsg": "request successful",
                    "data": {
                        "finderUser": {
                            "fansCount": 56,
                            "finderUsername": "stable-finder-id",
                            "uniqId": "public-video-account-id",
                            "nickname": "视频号·助手",
                            "headImgUrl": "https://example.invalid/avatar.png",
                        }
                    },
                },
            )
        )

        user_info = await adapter._extract_user_info(page)

        self.assertEqual(user_info.user_id, "stable-finder-id")
        self.assertEqual(user_info.username, "public-video-account-id")
        self.assertEqual(user_info.name, "视频号·助手")
        self.assertEqual(
            user_info.avatar, "https://example.invalid/avatar.png"
        )
        self.assertEqual(user_info.extra["identity_source"], "channels_auth_data")
        self.assertEqual(user_info.extra["follower_count"], 56)

    async def test_channels_prefers_finder_username_regardless_cookie_order(self):
        adapter = BuiltinPlatformAdapter("channels")
        page, _callbacks = self.page(
            "https://channels.weixin.qq.com/platform",
            {"lines": ["视频号·助手"], "avatar": ""},
        )
        page.context.cookies = AsyncMock(
            return_value=[
                {"name": "uin", "value": "unstable-uin"},
                {"name": "wxuin", "value": "fallback-wxuin"},
                {"name": "finder_username", "value": "stable-finder"},
            ]
        )

        user_info = await adapter._extract_user_info(page)

        self.assertEqual(user_info.user_id, "stable-finder")
        self.assertEqual(user_info.extra["user_id"], "stable-finder")

    def test_channels_storage_session_cookie_does_not_override_official_identity(self):
        user_info = extract_user_info_from_storage_state(
            "channels",
            {
                "cookies": [
                    {"name": "uin", "value": "unstable-uin"},
                    {"name": "finder_username", "value": "stable-finder"},
                    {"name": "wxuin", "value": "fallback-wxuin"},
                ],
                "origins": [],
            },
        )

        self.assertIsNone(user_info)

    async def test_channels_auth_data_identity_is_kept_without_follower_count(self):
        adapter = BuiltinPlatformAdapter("channels")
        page, callbacks = self.page(
            "https://channels.weixin.qq.com/platform",
            {"lines": ["视频号·助手"], "avatar": ""},
        )
        page.context.cookies = AsyncMock(
            return_value=[{"name": "finder_username", "value": "session-id"}]
        )
        adapter._install_official_follower_capture(page)
        callbacks["response"](
            self.response(
                "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data",
                "POST",
                201,
                {
                    "errCode": 0,
                    "data": {
                        "finderUser": {
                            "finderUsername": "stable-finder-id",
                            "nickname": "视频号·助手",
                        }
                    },
                },
            )
        )

        user_info = await adapter._extract_user_info(page)

        self.assertEqual(user_info.user_id, "stable-finder-id")
        self.assertNotIn("follower_count", user_info.extra)

    async def test_channels_business_failure_does_not_persist_follower_count(self):
        adapter = BuiltinPlatformAdapter("channels")
        page, callbacks = self.page(
            "https://channels.weixin.qq.com/platform",
            {"lines": ["视频号·助手"], "avatar": ""},
        )
        adapter._install_official_follower_capture(page)
        callbacks["response"](
            self.response(
                "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data",
                "POST",
                201,
                {
                    "errCode": -1,
                    "errMsg": "session expired",
                    "data": {"finderUser": {"fansCount": 0}},
                },
            )
        )

        user_info = await adapter._extract_user_info(page)

        self.assertNotIn("follower_count", user_info.extra)

    async def test_failed_official_response_does_not_fabricate_zero(self):
        adapter = BuiltinPlatformAdapter("xiaohongshu")
        page, callbacks = self.page(
            "https://creator.xiaohongshu.com/new/home",
            {"userId": "real-user", "userName": "creator"},
        )
        adapter._install_official_follower_capture(page)
        callbacks["response"](
            self.response(
                "https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info",
                "GET",
                200,
                {"code": -1, "data": {"fans_count": 0}},
            )
        )

        user_info = await adapter._extract_user_info(page)

        self.assertNotIn("follower_count", user_info.extra)

    def test_count_parser_rejects_guessed_or_invalid_values(self):
        self.assertEqual(
            BuiltinPlatformAdapter._coerce_follower_count("1,234"), 1234
        )
        self.assertIsNone(BuiltinPlatformAdapter._coerce_follower_count("1.2万"))
        self.assertIsNone(BuiltinPlatformAdapter._coerce_follower_count(-1))
        self.assertIsNone(BuiltinPlatformAdapter._coerce_follower_count(True))


if __name__ == "__main__":
    unittest.main()
