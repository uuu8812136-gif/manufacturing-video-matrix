"""内置平台适配器（不依赖外部 D:\\social-auto-stack 源码）。

通过 Playwright 直接驱动浏览器完成扫码登录和真实发布：
- 扫码登录：打开登录页 -> 提取真实二维码元素 -> 轮询登录态
- 发布内容：加载 storage_state -> 打开发布页 -> 填表 -> 上传素材 -> 点击发布按钮 -> 等待发布成功

各平台发布按钮选择器和成功判定已内置（不再依赖 SYNAPSE_SRC_DIR）。
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import json
import logging
import os
import re
import socket
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx

from app.integrations.synapse_engine.platforms.base import (
    LoginResult,
    LoginStatus,
    PlatformAdapter,
    QRCodeData,
    UserInfo,
)
from app.integrations.synapse_engine.platforms.codes import (
    PLATFORM_AUTH_COOKIE_NAMES,
    PLATFORM_LOGIN_URLS,
    PLATFORM_NAMES,
    PLATFORM_PUBLISH_URLS,
)

logger = logging.getLogger(__name__)

_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)
_COMMON_HOST_PROXY_PORTS = (7890, 7897, 10809, 1080, 1087)


# 各平台发布按钮选择器（按优先级排列，第一个命中的就用）
# 这些选择器来自原 SynapseAutomation 项目 platforms/<platform>/upload.py 的真实实现
_PLATFORM_PUBLISH_BUTTON_SELECTORS: dict[str, list[str]] = {
    "douyin": [
        'button:has-text("发布")',
        'button[class*="primary"][class*="fixed"]',
        "div.publish-btn",
        '.publish-content-btn [class*="publish"]',
    ],
    "xiaohongshu": [
        'button:has-text("发布")',
        "div.publishBtn",
        ".publish-content .btn",
    ],
    "kuaishou": [
        'button:has-text("发布")',
        'button:has-text("发布作品")',
        ".publish-btn",
        'div[class*="publish"] button',
    ],
    "bilibili": [
        'button:has-text("立即投稿")',
        'button:has-text("发布")',
        '.submit-btn [class*="publish"]',
    ],
    "channels": [
        'button:has-text("发表")',
        'button:has-text("发布")',
        ".publish-btn",
    ],
    "baijiahao": [
        'button:has-text("发布")',
        'button:has-text("提交")',
        '[class*="publish"] button',
    ],
}

# 各平台发布成功后的 URL 片段（用于判断发布是否成功）
_PLATFORM_SUCCESS_URL_PATTERNS: dict[str, list[str]] = {
    # Do not match the generic /creator-micro URL. The upload page itself is
    # also under /creator-micro and was previously producing false "published"
    # results when the sidebar "高清发布" button was clicked.
    "douyin": [
        r"creator-micro/content/manage",
        r"creator-micro/content/(?:video|article)/manage",
    ],
    "xiaohongshu": [
        r"publish/success",
        r"creator\.xiaohongshu\.com/publish/publish\?done",
    ],
    "kuaishou": [r"cp\.kuaishou\.com/article/publish/success", r"article/manage"],
    "bilibili": [r"member\.bilibili\.com/platform/upload-manager"],
    "channels": [r"channels\.weixin\.qq\.com/platform/post/list"],
    "baijiahao": [r"baijiahao\.baidu\.com/builder/rc/(?:manage|content)"],
}

# 各平台标题输入框选择器（按优先级排列）
_PLATFORM_TITLE_SELECTORS: dict[str, list[str]] = {
    "douyin": [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        'div[contenteditable="true"].ace-editor',
    ],
    "xiaohongshu": [
        'div[contenteditable="true"][placeholder*="标题"]',
        'input[placeholder*="标题"]',
        ".title input",
    ],
    "kuaishou": [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        ".title-input input",
    ],
    "bilibili": [
        ".input-title textarea",
        'textarea[placeholder*="标题"]',
        'input[placeholder*="标题"]',
    ],
    "channels": [
        'textarea[placeholder*="标题"]',
        'input[placeholder*="标题"]',
        ".title-input input",
    ],
    "baijiahao": [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        '[class*="title"] input',
    ],
}

# 各平台正文/描述选择器
_PLATFORM_BODY_SELECTORS: dict[str, list[str]] = {
    "douyin": [
        'div.editor-comp-publish[contenteditable="true"]',
        'div.zone-container[contenteditable="true"]',
        '[class*="editor-comp-publish"][contenteditable="true"]',
        'textarea[placeholder*="描述"]',
        '[contenteditable="true"]',
    ],
    "xiaohongshu": [
        'div[contenteditable="true"][placeholder*="正文"]',
        'div[contenteditable="true"][placeholder*="描述"]',
        ".desc-input [contenteditable]",
    ],
    "kuaishou": [
        "#work-description-edit",
        'textarea[placeholder*="描述"]',
        'div[contenteditable="true"]',
    ],
    "bilibili": [
        '.ql-editor[contenteditable="true"]',
        'textarea[placeholder*="简介"]',
        'div[contenteditable="true"]',
    ],
    "channels": [
        'textarea[placeholder*="描述"]',
        'div[contenteditable="true"]',
    ],
    "baijiahao": [
        'textarea[placeholder*="简介"]',
        'textarea[placeholder*="内容"]',
        'div[contenteditable="true"]',
    ],
}

# 各平台文件上传 input 选择器
_PLATFORM_FILE_INPUT_SELECTORS: dict[str, list[str]] = {
    "douyin": ['input[type="file"][accept*="video"]', 'input[type="file"]'],
    "xiaohongshu": [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="video"]',
        'input[type="file"]',
    ],
    "kuaishou": ['input[type="file"][accept*="video"]', 'input[type="file"]'],
    "bilibili": ['input[type="file"][accept*="video"]', 'input[type="file"]'],
    "channels": ['input[type="file"][accept*="video"]', 'input[type="file"]'],
    "baijiahao": ['input[type="file"][accept*="video"]', 'input[type="file"]'],
}


class BuiltinPlatformAdapter(PlatformAdapter):
    """通用内置平台适配器。

    使用 Playwright 驱动浏览器：
    - 扫码登录：打开登录页 -> 提取真实二维码元素 -> 轮询登录态
    - 发布内容：加载 storage_state -> 打开发布页 -> 填表 -> 上传素材 -> 点击发布按钮 -> 等待发布成功
    """

    def __init__(self, platform: str, config: dict | None = None):
        self.platform = (platform or "").strip().lower()
        self.config = config or {}
        self.login_url = PLATFORM_LOGIN_URLS.get(self.platform, "")
        self.publish_url = PLATFORM_PUBLISH_URLS.get(self.platform, "")
        self.platform_name = PLATFORM_NAMES.get(self.platform, self.platform)
        # session_id -> {page, context, browser, created_at, last_status}
        self._sessions: dict[str, dict[str, Any]] = {}
        self._resolved_browser_proxy: str | None = None

    @staticmethod
    def _http_proxy_available(proxy_url: str) -> bool:
        """Confirm that a candidate accepts an HTTP CONNECT tunnel."""
        try:
            parsed = urlsplit(proxy_url)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                return False
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            with socket.create_connection((parsed.hostname, port), timeout=1.2) as sock:
                sock.settimeout(1.2)
                sock.sendall(
                    b"CONNECT creator.xiaohongshu.com:443 HTTP/1.1\r\n"
                    b"Host: creator.xiaohongshu.com:443\r\n"
                    b"Proxy-Connection: close\r\n\r\n"
                )
                first_line = sock.recv(256).split(b"\r\n", 1)[0]
                return first_line.startswith(b"HTTP/") and b" 200 " in first_line
        except (OSError, ValueError):
            return False

    def _browser_proxy(self, settings) -> str:
        """Resolve the host's working browser proxy without .env changes.

        The 智链 reference reads the macOS system proxy. Inside Docker,
        ``127.0.0.1`` points at the container, so the same proxy is reached via
        ``host.docker.internal``.
        """
        if self._resolved_browser_proxy is not None:
            return self._resolved_browser_proxy

        configured = (settings.SYNAPSE_BROWSER_PROXY or "").strip()
        if configured:
            self._resolved_browser_proxy = configured
            return configured
        if settings.SYNAPSE_BROWSER_NO_PROXY:
            self._resolved_browser_proxy = ""
            return ""

        candidates: list[str] = []
        for name in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
            value = (os.getenv(name) or "").strip()
            if value:
                candidates.append(value)

        if sys.platform == "darwin":
            try:
                output = subprocess.run(
                    ["/usr/sbin/scutil", "--proxy"],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=1.5,
                ).stdout
                enabled = re.search(r"HTTPS?Enable\s*:\s*1", output)
                host_match = re.search(
                    r"(?:HTTPSProxy|HTTPProxy)\s*:\s*([^\s]+)", output
                )
                port_match = re.search(
                    r"(?:HTTPSPort|HTTPPort)\s*:\s*(\d+)", output
                )
                if enabled and host_match and port_match:
                    candidates.append(
                        f"http://{host_match.group(1)}:{port_match.group(1)}"
                    )
            except (OSError, subprocess.SubprocessError):
                pass

        if Path("/.dockerenv").exists():
            candidates.extend(
                f"http://host.docker.internal:{port}"
                for port in _COMMON_HOST_PROXY_PORTS
            )

        for candidate in dict.fromkeys(candidates):
            if self._http_proxy_available(candidate):
                self._resolved_browser_proxy = candidate
                logger.warning(
                    "auto-detected host browser proxy platform=%s endpoint=%s",
                    self.platform,
                    candidate,
                )
                return candidate

        self._resolved_browser_proxy = ""
        return ""

    async def _stop_playwright(self, pw, *, timeout: int = 3) -> None:
        """Stop the real Patchright transport within a bounded budget.

        Patchright's public ``Playwright.stop()`` delegates to an implementation
        method that is a no-op in the pinned runtime.  Stopping the underlying
        connection is what actually terminates the Node driver process.
        """
        impl = getattr(pw, "_impl_obj", None)
        connection = getattr(impl, "_connection", None)
        stop_async = getattr(connection, "stop_async", None)
        stop = stop_async if callable(stop_async) else getattr(pw, "stop", None)
        if not callable(stop):
            return
        await asyncio.wait_for(stop(), timeout=timeout)

    async def _force_terminate_playwright_process(
        self, pw, *, timeout: int = 2
    ) -> None:
        """Terminate the driver process when its cooperative stop is stuck.

        Closing the Patchright driver also closes Chromium's remote-debugging
        pipe, so the browser exits instead of surviving an already-finished
        account refresh request.
        """
        impl = getattr(pw, "_impl_obj", None)
        connection = getattr(impl, "_connection", None)
        transport = getattr(connection, "_transport", None)
        proc = getattr(transport, "_proc", None)
        if proc is None or getattr(proc, "returncode", None) is not None:
            return
        try:
            proc.terminate()
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout)
            return
        except asyncio.TimeoutError:
            pass
        try:
            proc.kill()
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning(
                "%s Playwright driver process did not exit after kill",
                self.platform,
            )

    async def _launch_browser(
        self,
        headless: bool | None = None,
        storage_state: dict | None = None,
        *,
        visible_session_id: str | None = None,
    ):
        """启动浏览器并返回 (browser, context)。"""
        from app.core.config import get_settings
        from app.integrations.synapse_engine.utils.playwright_provider import (
            PlaywrightBrowserMissingError,
            async_playwright,
            friendly_playwright_error,
            is_playwright_browser_missing_error,
            resolve_chromium_executable,
        )

        settings = get_settings()
        headless = (
            settings.SYNAPSE_PLAYWRIGHT_HEADLESS if headless is None else headless
        )

        pw = await async_playwright().start()
        bridge_url = settings.SYNAPSE_HOST_BROWSER_BRIDGE_URL
        if visible_session_id and bridge_url:
            try:
                async with httpx.AsyncClient(timeout=25, trust_env=False) as client:
                    response = await client.post(
                        f"{bridge_url}/v1/sessions",
                        headers={
                            "X-Internal-Key": settings.SOCIAL_BROWSER_API_KEY
                        },
                        json={
                            "sessionId": visible_session_id,
                            "platform": self.platform,
                            "loginUrl": self.login_url,
                        },
                    )
                    response.raise_for_status()
                    bridge = response.json()
                ws_endpoint = str(bridge.get("wsEndpoint") or "")
                host_header = str(bridge.get("hostHeader") or "")
                if not ws_endpoint.startswith("ws://") or not host_header:
                    raise RuntimeError("宿主机 Edge 桥接未返回有效 CDP 端点")
                browser = await pw.chromium.connect_over_cdp(
                    ws_endpoint,
                    headers={"Host": host_header},
                    timeout=20_000,
                )
                browser._synapse_pw = pw  # type: ignore[attr-defined]
                browser._synapse_host_bridge_url = bridge_url  # type: ignore[attr-defined]
                browser._synapse_host_bridge_key = (  # type: ignore[attr-defined]
                    settings.SOCIAL_BROWSER_API_KEY
                )
                browser._synapse_host_bridge_session_id = (  # type: ignore[attr-defined]
                    visible_session_id
                )
                contexts = list(browser.contexts)
                if not contexts:
                    raise RuntimeError("宿主机 Edge 没有可接管的浏览器上下文")
                context = contexts[0]
                pages = list(context.pages)
                page = next(
                    (item for item in pages if item.url == "about:blank"),
                    pages[-1] if pages else None,
                )
                if page is None:
                    page = await context.new_page()
                for extra_page in pages:
                    if extra_page is page:
                        continue
                    try:
                        await extra_page.close()
                    except Exception:
                        pass
                context._synapse_initial_page = page  # type: ignore[attr-defined]
                context._synapse_launch_profile = {  # type: ignore[attr-defined]
                    "headless": False,
                    "executable": "Microsoft Edge (macOS host)",
                    "args": [],
                    "proxy_mode": "host_system",
                    "proxy_endpoint": "macOS-system",
                    "proxy_has_credentials": False,
                    "visible": True,
                }
                logger.warning(
                    "connected visible host Edge platform=%s session=%s",
                    self.platform,
                    visible_session_id[:8],
                )
                return browser, context
            except Exception:
                try:
                    async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
                        await client.post(
                            f"{bridge_url}/v1/sessions/{visible_session_id}/stop",
                            headers={
                                "X-Internal-Key": settings.SOCIAL_BROWSER_API_KEY
                            },
                        )
                except Exception:
                    pass
                try:
                    await self._stop_playwright(pw)
                except Exception:
                    await self._force_terminate_playwright_process(pw)
                raise

        launch_kwargs: dict[str, Any] = {
            "headless": headless,
            "args": [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--lang=zh-CN",
            ],
        }
        try:
            # Always pass an explicit executable_path. This prevents Playwright
            # from defaulting to a missing chromium_headless_shell when the
            # Docker image only contains chromium-*/chrome.
            launch_kwargs["executable_path"] = resolve_chromium_executable(
                settings.SYNAPSE_LOCAL_CHROME_PATH,
                headless=headless,
                allow_regular_fallback=True,
            )
        except PlaywrightBrowserMissingError:
            try:
                await self._stop_playwright(pw)
            except Exception:
                pass
            raise

        # 代理策略：显式代理优先；只有显式开启 NO_PROXY 才强制直连。
        # 默认不添加 direct:// 参数，避免绕过宿主机/系统已选定的中国线路。
        browser_proxy = self._browser_proxy(settings)
        proxy_mode = "browser_default"
        proxy_endpoint = "browser-default"
        proxy_has_credentials = False
        if browser_proxy:
            parsed_proxy = urlsplit(browser_proxy)
            if parsed_proxy.scheme and parsed_proxy.hostname:
                host = parsed_proxy.hostname
                if ":" in host and not host.startswith("["):
                    host = f"[{host}]"
                server = f"{parsed_proxy.scheme}://{host}"
                if parsed_proxy.port:
                    server += f":{parsed_proxy.port}"
                proxy_config: dict[str, str] = {"server": server}
                if parsed_proxy.username:
                    proxy_config["username"] = parsed_proxy.username
                if parsed_proxy.password:
                    proxy_config["password"] = parsed_proxy.password
                launch_kwargs["proxy"] = proxy_config
                proxy_endpoint = server
                proxy_has_credentials = bool(
                    parsed_proxy.username or parsed_proxy.password
                )
            else:
                launch_kwargs["proxy"] = {"server": browser_proxy}
                proxy_endpoint = "configured-" + self._hash12(browser_proxy)
            proxy_mode = "explicit"
        elif settings.SYNAPSE_BROWSER_NO_PROXY:
            launch_kwargs.setdefault("args", []).extend(
                ["--proxy-server=direct://", "--proxy-bypass-list=*"]
            )
            proxy_mode = "forced_direct"
            proxy_endpoint = "direct://"

        launch_profile = {
            "headless": bool(headless),
            "executable": str(launch_kwargs.get("executable_path") or ""),
            "args": list(launch_kwargs.get("args") or []),
            "proxy_mode": proxy_mode,
            "proxy_endpoint": proxy_endpoint,
            "proxy_has_credentials": proxy_has_credentials,
        }
        logger.warning(
            "browser launch profile platform=%s headless=%s executable=%s "
            "proxy_mode=%s proxy_endpoint=%s args=%s",
            self.platform,
            launch_profile["headless"],
            launch_profile["executable"],
            proxy_mode,
            proxy_endpoint,
            launch_profile["args"],
        )

        try:
            browser = await pw.chromium.launch(**launch_kwargs)
        except Exception as exc:
            try:
                await self._stop_playwright(pw)
            except Exception:
                await self._force_terminate_playwright_process(pw)
            if is_playwright_browser_missing_error(exc):
                raise PlaywrightBrowserMissingError(
                    friendly_playwright_error(exc)
                ) from exc
            raise
        # Attach the driver before creating a context.  A malformed or
        # platform-incompatible storage_state can fail inside new_context;
        # without this early attachment neither browser nor driver was
        # reachable by the cleanup path.
        browser._synapse_pw = pw  # type: ignore[attr-defined]
        context_kwargs: dict[str, Any] = {
            "viewport": {"width": 1280, "height": 800},
            "screen": {"width": 1280, "height": 800},
            "user_agent": _BROWSER_USER_AGENT,
            "locale": "zh-CN",
            "timezone_id": "Asia/Shanghai",
            "ignore_https_errors": True,
        }
        if storage_state:
            context_kwargs["storage_state"] = storage_state
        try:
            context = await browser.new_context(**context_kwargs)
        except BaseException:
            await self._close_browser(browser)
            raise
        # 登录二维码页只需要页面主体和二维码本身。字体、音视频等重资源会拖慢
        # 部分平台首屏，且不影响二维码识别；发布/校验带 storage_state 的
        # 上下文不启用拦截，避免影响视频上传预览。
        #
        # Do not install this catch-all route on Douyin. Patchright can stall
        # the main document at page.goto("commit") when every request is
        # continued through a Python route callback. The proven reference
        # implementation also leaves Douyin networking untouched; its login
        # page then commits through the same proxy in about one second.
        if not storage_state and self.platform != "douyin":
            try:

                async def _light_login_route(route):
                    if route.request.resource_type in {"font", "media"}:
                        await route.abort()
                    else:
                        await route.continue_()

                await context.route("**/*", _light_login_route)
            except Exception:
                pass
        context._synapse_launch_profile = launch_profile  # type: ignore[attr-defined]
        return browser, context

    async def _launch_authenticated_browser(self, storage_state: dict):
        """Launch the browser mode proven to work for a stored platform session.

        Xiaohongshu and Douyin headed Chromium exit or stall in the current
        Docker/Xvfb runtime, while their headless browser loads both login and
        creator pages through the detected host proxy. Keep the exception
        platform-scoped so platforms without this failure retain their
        configured mode.
        """
        if self.platform in {"douyin", "xiaohongshu"}:
            return await self._launch_browser(
                headless=True, storage_state=storage_state
            )
        return await self._launch_browser(storage_state=storage_state)

    @staticmethod
    def _hash12(value: Any) -> str:
        raw = value if isinstance(value, bytes) else str(value or "").encode("utf-8")
        return hashlib.sha256(raw).hexdigest()[:12]

    @staticmethod
    def _iso_now() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _safe_request_path(url: str) -> str:
        parsed = urlsplit(url)
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

    @staticmethod
    def _expires_in_seconds(expire_time: Any, default: int = 180) -> int:
        if not isinstance(expire_time, (int, float)):
            return default
        value = float(expire_time)
        if value > 10_000_000_000:
            value /= 1000
        if value > time.time() - 60:
            value -= time.time()
        return max(15, min(300, int(value)))

    @staticmethod
    def _coerce_follower_count(value: Any) -> int | None:
        """Return a trustworthy non-negative integer count, or ``None``.

        The creator APIs normally return an integer, but some deployments
        serialize it as a decimal string.  Deliberately do not parse formatted
        DOM values such as ``1.2万``: guessing here could silently persist an
        incorrect account metric.  ``0`` is a valid, meaningful value.
        """
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value if value >= 0 else None
        if isinstance(value, float):
            return int(value) if value >= 0 and value.is_integer() else None
        if isinstance(value, str):
            normalized = value.strip().replace(",", "")
            if re.fullmatch(r"\d+", normalized):
                return int(normalized)
        return None

    @staticmethod
    def _cookie_value_by_name_priority(
        cookies: list[dict[str, Any]],
        names: tuple[str, ...],
    ) -> str:
        """Return a cookie value using a stable name priority.

        Playwright does not guarantee that ``context.cookies()`` will keep the
        same ordering across browser sessions.  Several creator sites expose
        more than one numeric account cookie; choosing the first matching
        cookie therefore made the same account appear under different IDs on
        repeated scans.  Identity selection must follow the platform-defined
        name priority instead of response order.
        """
        values = {
            str(cookie.get("name") or ""): str(cookie.get("value") or "")
            for cookie in cookies
            if cookie.get("name") and cookie.get("value")
        }
        return next((values[name] for name in names if values.get(name)), "")

    def _official_follower_endpoint(self, response) -> tuple[str, int] | None:
        """Identify a creator-page response that contains the real fan count.

        The returned priority prevents a Kuaishou fallback response from
        replacing the preferred ``infoV2`` result.  Matching is intentionally
        strict so unrelated responses can never be interpreted as metrics.
        """
        try:
            parsed = urlsplit(str(response.url))
            host = (parsed.hostname or "").lower()
            path = parsed.path.rstrip("/")
            method = str(response.request.method or "").upper()
        except Exception:
            return None

        if (
            self.platform == "xiaohongshu"
            and host == "creator.xiaohongshu.com"
            and path == "/api/galaxy/creator/home/personal_info"
            and method == "GET"
        ):
            return ("xiaohongshu_personal_info", 20)
        if (
            self.platform == "kuaishou"
            and host == "cp.kuaishou.com"
            and method == "POST"
        ):
            if path == "/rest/cp/creator/pc/home/infoV2":
                return ("kuaishou_home_info_v2", 20)
            if path == "/rest/cp/creator/pc/home/userInfo":
                return ("kuaishou_home_user_info", 10)
        if (
            self.platform == "channels"
            and host == "channels.weixin.qq.com"
            and path == "/cgi-bin/mmfinderassistant-bin/auth/auth_data"
            and method == "POST"
        ):
            return ("channels_auth_data", 20)
        return None

    async def _capture_official_follower_response(
        self,
        response,
        state: dict[str, Any],
        source: str,
        priority: int,
    ) -> None:
        """Capture only a sanitized follower count from an official response.

        No request body, response payload, cookie, token, or signed header is
        retained or logged.  The page itself issues the request, preserving
        each platform's normal signature and session context.
        """
        try:
            status = int(response.status)
            if source == "channels_auth_data":
                if status != 201:
                    return
            elif status < 200 or status >= 300:
                return

            payload = await response.json()
            if not isinstance(payload, dict):
                return

            value: Any = None
            safe_identity: dict[str, str] = {}
            valid_business_response = False
            if source == "xiaohongshu_personal_info":
                valid_business_response = str(payload.get("code")) == "0"
                value = (payload.get("data") or {}).get("fans_count")
            elif source == "kuaishou_home_info_v2":
                valid_business_response = str(payload.get("result")) == "1"
                value = (payload.get("data") or {}).get("fansCnt")
            elif source == "kuaishou_home_user_info":
                valid_business_response = str(payload.get("result")) == "1"
                value = (
                    ((payload.get("data") or {}).get("coreUserInfo") or {}).get(
                        "fansNum"
                    )
                )
            elif source == "channels_auth_data":
                valid_business_response = str(
                    payload.get("errCode", payload.get("err_code"))
                ) == "0"
                finder_user = (
                    (payload.get("data") or {}).get("finderUser") or {}
                )
                value = finder_user.get("fansCount")
                if valid_business_response and isinstance(finder_user, dict):
                    stable_id = str(
                        finder_user.get("finderUsername")
                        or finder_user.get("uniqId")
                        or ""
                    ).strip()
                    unique_id = str(finder_user.get("uniqId") or "").strip()
                    name = str(finder_user.get("nickname") or "").strip()
                    avatar = str(finder_user.get("headImgUrl") or "").strip()
                    safe_identity = {
                        key: field_value
                        for key, field_value in {
                            "user_id": stable_id,
                            "unique_id": unique_id,
                            "name": name,
                            "avatar": avatar,
                        }.items()
                        if field_value
                    }

            follower_count = (
                self._coerce_follower_count(value)
                if valid_business_response
                else None
            )
            if follower_count is None and not safe_identity:
                return
            if priority < int(state.get("priority") or -1):
                return
            captured: dict[str, Any] = {
                    "follower_count": follower_count,
                    "source": source,
                    "priority": priority,
                    "captured_at": self._iso_now(),
                    **safe_identity,
                }
            if follower_count is None:
                captured.pop("follower_count")
            state.update(captured)
            logger.debug(
                "%s official creator follower response captured source=%s",
                self.platform,
                source,
            )
        except Exception as exc:
            logger.debug(
                "%s official creator follower response parse failed source=%s: %s",
                self.platform,
                source,
                str(exc)[:160],
            )

    def _install_official_follower_capture(self, page) -> dict[str, Any]:
        """Listen before navigation so login redirects cannot lose the response."""
        existing = getattr(page, "_synapse_official_follower_state", None)
        if isinstance(existing, dict):
            return existing

        state: dict[str, Any] = {"pending": set()}
        page._synapse_official_follower_state = state  # type: ignore[attr-defined]
        if self.platform not in {"xiaohongshu", "kuaishou", "channels"}:
            return state

        def _schedule(response) -> None:
            endpoint = self._official_follower_endpoint(response)
            if endpoint is None:
                return
            source, priority = endpoint
            task = asyncio.create_task(
                self._capture_official_follower_response(
                    response, state, source, priority
                )
            )
            pending = state["pending"]
            pending.add(task)
            task.add_done_callback(pending.discard)

        page.on("response", _schedule)
        state["listener"] = _schedule
        return state

    async def _official_follower_snapshot(self, page) -> dict[str, Any]:
        """Wait briefly for in-flight official responses and return safe fields."""
        state = getattr(page, "_synapse_official_follower_state", None)
        if not isinstance(state, dict):
            return {}
        # A post-login creator page can report its URL/cookies just before its
        # account-summary request finishes.  Give that same page a bounded
        # chance to deliver the response instead of issuing a duplicate API
        # request from Python.
        for _ in range(5):
            pending = list(state.get("pending") or [])
            if pending:
                try:
                    await asyncio.wait_for(
                        asyncio.gather(*pending, return_exceptions=True),
                        timeout=0.5,
                    )
                except asyncio.TimeoutError:
                    pass
            if "follower_count" in state:
                break
            await asyncio.sleep(0.2)
        return {
            key: state[key]
            for key in (
                "follower_count",
                "user_id",
                "unique_id",
                "name",
                "avatar",
                "source",
                "captured_at",
            )
            if key in state
        }

    async def _browser_fingerprint(self, page) -> dict[str, Any]:
        try:
            return await page.evaluate(
                """() => ({
                  userAgent: navigator.userAgent,
                  userAgentData: navigator.userAgentData ? {
                    brands: navigator.userAgentData.brands,
                    mobile: navigator.userAgentData.mobile,
                    platform: navigator.userAgentData.platform
                  } : null,
                  platform: navigator.platform,
                  languages: navigator.languages,
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  viewport: {width: innerWidth, height: innerHeight,
                    screenWidth: screen.width, screenHeight: screen.height,
                    devicePixelRatio},
                  webdriver: navigator.webdriver
                })"""
            )
        except Exception as exc:
            return {"error": str(exc)[:160]}

    async def _egress_evidence(self, context) -> dict[str, Any]:
        profile = getattr(context, "_synapse_launch_profile", {}) or {}
        evidence: dict[str, Any] = {
            "checked_at": self._iso_now(),
            "proxy_mode": profile.get("proxy_mode", "unknown"),
            "proxy_endpoint": profile.get("proxy_endpoint", "unknown"),
        }
        try:
            response = await context.request.get(
                "https://myip.ipip.net", timeout=10000
            )
            body = (await response.text()).strip()
            match = re.search(r"IP[：:]\s*([^\s]+)\s+来自于[：:]\s*(.+)", body)
            if match:
                ip = match.group(1).strip()
                evidence.update(
                    {
                        "http_status": response.status,
                        "ip_hash": self._hash12(ip),
                        "region": match.group(2).strip()[:120],
                        "source": "ipip",
                    }
                )
                return evidence
        except Exception as exc:
            evidence["ipip_error"] = str(exc)[:160]
        try:
            response = await context.request.get(
                "https://www.cloudflare.com/cdn-cgi/trace", timeout=10000
            )
            trace = {}
            for line in (await response.text()).splitlines():
                if "=" in line:
                    key, value = line.split("=", 1)
                    trace[key.strip()] = value.strip()
            ip = trace.get("ip", "")
            evidence.update(
                {
                    "http_status": response.status,
                    "ip_hash": self._hash12(ip) if ip else None,
                    "country": trace.get("loc") or None,
                    "warp": trace.get("warp") or None,
                    "source": "cloudflare",
                }
            )
        except Exception as exc:
            evidence["error"] = str(exc)[:160]
        return evidence

    async def _close_browser(self, browser) -> None:
        browser_state = vars(browser)
        pw = browser_state.get("_synapse_pw")
        bridge_url = browser_state.get("_synapse_host_bridge_url", "")
        bridge_key = browser_state.get("_synapse_host_bridge_key", "")
        bridge_session_id = browser_state.get(
            "_synapse_host_bridge_session_id", ""
        )
        try:
            # Browser transports can stall while a navigation is being
            # cancelled.  Cleanup must not consume the remaining gateway
            # budget after the overall QR-start deadline has already fired.
            await asyncio.wait_for(browser.close(), timeout=5)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning(
                "%s browser close did not finish within cleanup budget",
                self.platform,
            )
        if bridge_url and bridge_key and bridge_session_id:
            try:
                async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
                    await client.post(
                        f"{bridge_url}/v1/sessions/{bridge_session_id}/stop",
                        headers={"X-Internal-Key": bridge_key},
                    )
            except Exception:
                logger.warning(
                    "%s host Edge bridge cleanup did not finish session=%s",
                    self.platform,
                    str(bridge_session_id)[:8],
                )
        if pw is not None:
            try:
                await self._stop_playwright(pw, timeout=3)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning(
                    "%s Playwright driver stop did not finish within cleanup budget",
                    self.platform,
                )
                await self._force_terminate_playwright_process(pw, timeout=2)

    @staticmethod
    def _is_transient_navigation_error(exc: Exception | str) -> bool:
        msg = str(exc).lower()
        return any(
            token in msg
            for token in (
                "err_name_not_resolved",
                "err_timed_out",
                "err_connection_timed_out",
                "err_connection_reset",
                "err_connection_closed",
                "err_network_changed",
                "err_http2_protocol_error",
                "net::",
                "timeout",
            )
        )

    async def _goto_with_retries(
        self,
        page,
        url: str,
        *,
        wait_until: str = "domcontentloaded",
        timeout: int = 30000,
        max_attempts: int = 3,
    ):
        """Navigate with retries for flaky Docker DNS/network failures."""
        last_exc: Exception | None = None
        max_attempts = max(1, max_attempts)
        for attempt in range(1, max_attempts + 1):
            try:
                return await page.goto(url, wait_until=wait_until, timeout=timeout)
            except Exception as exc:
                last_exc = exc
                if (
                    not self._is_transient_navigation_error(exc)
                    or attempt >= max_attempts
                ):
                    break
                logger.warning(
                    "%s navigation failed on attempt %s/%s, retrying: %s",
                    self.platform,
                    attempt,
                    max_attempts,
                    exc,
                )
                await asyncio.sleep(1.5 * attempt)
        assert last_exc is not None
        raise last_exc

    async def _login_page_state(self, page) -> dict[str, Any]:
        try:
            return await page.evaluate(
                """() => ({
                  url: location.href,
                  title: document.title,
                  readyState: document.readyState,
                  bodyTextLength: document.body?.innerText?.trim().length || 0,
                  rootChildren: document.querySelector('#root')?.childElementCount || 0,
                  scripts: document.scripts.length,
                  images: document.images.length
                })"""
            )
        except Exception:
            return {
                "url": getattr(page, "url", ""),
                "title": "",
                "readyState": "unknown",
                "bodyTextLength": 0,
                "rootChildren": 0,
                "scripts": 0,
                "images": 0,
            }

    async def _recover_blank_login_page(self, page) -> None:
        """Reload once when the platform shell loaded but its app did not."""

        async def wait_for_content(timeout: int) -> bool:
            try:
                await page.wait_for_function(
                    """() => {
                      const root = document.querySelector('#root');
                      return Boolean(
                        (root && root.childElementCount > 0) ||
                        (document.body && document.body.innerText.trim().length > 0) ||
                        document.images.length > 0
                      );
                    }""",
                    timeout=timeout,
                )
                return True
            except Exception:
                return False

        initial_timeout = (
            8_000
            if self.platform in {"douyin", "kuaishou", "bilibili"}
            else 12_000
        )
        if await wait_for_content(initial_timeout):
            return

        first_state = await self._login_page_state(page)
        logger.warning(
            "platform login page blank, reloading platform=%s state=%s",
            self.platform,
            json.dumps(first_state, ensure_ascii=False, separators=(",", ":")),
        )
        try:
            await page.reload(wait_until="domcontentloaded", timeout=45_000)
        except Exception:
            await self._goto_with_retries(
                page,
                self.login_url,
                wait_until="domcontentloaded",
                timeout=60_000,
            )
        if await wait_for_content(12_000):
            return

        final_state = await self._login_page_state(page)
        raise RuntimeError(
            "平台登录页脚本未能加载，请检查系统代理后重试；"
            f"state={json.dumps(final_state, ensure_ascii=False, separators=(',', ':'))}"
        )

    async def get_qrcode(self) -> QRCodeData:
        """打开登录页，只提取可扫描的二维码图像。"""
        if not self.login_url:
            raise RuntimeError(f"平台 {self.platform} 未配置登录页 URL")

        session_id = uuid.uuid4().hex
        # Respect SYNAPSE_PLAYWRIGHT_HEADLESS.  Forcing ``headless=True`` here
        # silently overrode the Xvfb-backed visible-browser configuration and
        # caused Douyin to challenge otherwise valid QR scans as automated
        # logins.
        # The proven reference implementation runs Douyin headless on Linux.
        # In this Docker/Xvfb runtime, headed Chromium can terminate during the
        # first Douyin navigation ("Target page, context or browser has been
        # closed"), before any QR response is emitted. Xiaohongshu and
        # Baijiahao have the same runtime constraint. Use regular headless
        # Chromium for those QR pages while keeping the same user-agent,
        # viewport, locale, timezone and proxy profile.
        from app.core.config import get_settings

        host_visible_douyin = bool(
            self.platform == "douyin"
            and get_settings().SYNAPSE_HOST_BROWSER_BRIDGE_URL
        )
        browser, context = (
            await self._launch_browser(
                headless=False,
                visible_session_id=session_id,
            )
            if host_visible_douyin
            else await self._launch_browser(headless=True)
            if self.platform in {"douyin", "xiaohongshu", "baijiahao"}
            else await self._launch_browser()
        )
        page = vars(context).get("_synapse_initial_page")
        if page is None:
            page = await context.new_page()
        # Install before the first navigation.  The QR page and its post-login
        # redirect must remain one page/context, and some creator dashboards
        # request their account summary only once during that transition.
        self._install_official_follower_capture(page)
        response_qr_future: asyncio.Future[dict[str, Any]] | None = None
        douyin_qr_state: dict[str, Any] | None = None
        evidence_task: asyncio.Task | None = None

        # Douyin's QR is returned by an XHR several seconds before the React
        # login widget finishes rendering the visible <img>. Capture that
        # response directly; it cuts startup time and avoids flaky DOM waits.
        if self.platform == "douyin":
            loop = asyncio.get_running_loop()
            response_qr_future = loop.create_future()
            douyin_qr_state = {
                "status": "new",
                "message": "",
                "error_code": 0,
                "updated_at": time.time(),
                "version": 0,
                "token": None,
                "token_hash": None,
                "qr_hash": None,
                "qr_image": None,
                "qr_url": self.login_url,
                "generated_at": None,
                "expires_in": 180,
                "last_qr_sequence": 0,
                "last_status_sequence": 0,
                "events": [],
                "launch": getattr(context, "_synapse_launch_profile", {}),
            }
            network_sequence = 0

            def _request_token(resp) -> str:
                try:
                    query = parse_qs(urlsplit(resp.request.url).query)
                    for key in ("token", "qr_token", "qrcode_token"):
                        if query.get(key):
                            return str(query[key][0])
                    post_data = resp.request.post_data or ""
                    try:
                        body = json.loads(post_data)
                        for key in ("token", "qr_token", "qrcode_token"):
                            if body.get(key):
                                return str(body[key])
                    except Exception:
                        form = parse_qs(post_data)
                        for key in ("token", "qr_token", "qrcode_token"):
                            if form.get(key):
                                return str(form[key][0])
                except Exception:
                    pass
                return ""

            def _request_parameter_names(resp) -> list[str]:
                names: set[str] = set()
                try:
                    names.update(parse_qs(urlsplit(resp.request.url).query).keys())
                    post_data = resp.request.post_data or ""
                    if post_data:
                        try:
                            body = json.loads(post_data)
                            if isinstance(body, dict):
                                names.update(str(key) for key in body.keys())
                        except Exception:
                            names.update(parse_qs(post_data).keys())
                except Exception:
                    pass
                return sorted(names)

            def _append_qr_event(event: dict[str, Any]) -> None:
                if douyin_qr_state is None:
                    return
                events = douyin_qr_state.setdefault("events", [])
                events.append(event)
                del events[:-40]

            async def _capture_douyin_qr_response(resp, sequence: int) -> None:
                try:
                    is_qr_image = "/passport/web/get_qrcode/" in resp.url
                    is_qr_status = "/passport/web/check_qrconnect/" in resp.url
                    if not is_qr_image and not is_qr_status:
                        return
                    text = await resp.text()
                    payload = json.loads(text)
                    data = payload.get("data") or {}
                    try:
                        request_headers = await resp.request.all_headers()
                    except Exception:
                        request_headers = {}
                    client_hints = {
                        key: request_headers.get(key)
                        for key in (
                            "user-agent",
                            "sec-ch-ua",
                            "sec-ch-ua-mobile",
                            "sec-ch-ua-platform",
                            "origin",
                            "referer",
                        )
                        if request_headers.get(key)
                    }
                    if is_qr_status and douyin_qr_state is not None:
                        request_token = _request_token(resp)
                        request_token_hash = (
                            self._hash12(request_token) if request_token else None
                        )
                        current_token_hash = douyin_qr_state.get("token_hash")
                        stale_poll = bool(
                            request_token_hash
                            and current_token_hash
                            and request_token_hash != current_token_hash
                        )
                        previous = str(douyin_qr_state.get("status") or "")
                        current = str(data.get("status") or "").strip().lower()
                        business_code = (
                            data.get("error_code")
                            or payload.get("error_code")
                            or payload.get("status_code")
                            or payload.get("code")
                            or 0
                        )
                        message = str(
                            data.get("description")
                            or data.get("message")
                            or payload.get("description")
                            or payload.get("message")
                            or ""
                        )
                        _append_qr_event(
                            {
                                "kind": "status",
                                "at": self._iso_now(),
                                "http_status": resp.status,
                                "business_code": business_code,
                                "status": current or previous or "unknown",
                                "token_hash": request_token_hash,
                                "stale": stale_poll,
                                "message": message[:240],
                                "request": self._safe_request_path(resp.url),
                                "method": resp.request.method,
                                "parameter_names": _request_parameter_names(resp),
                                "client_hints": client_hints,
                            }
                        )
                        if stale_poll or sequence < int(
                            douyin_qr_state.get("last_status_sequence") or 0
                        ):
                            return
                        douyin_qr_state.update(
                            {
                                "status": current or previous or "new",
                                "message": message,
                                "error_code": business_code,
                                "updated_at": time.time(),
                                "last_status_sequence": sequence,
                                "last_poll_token_hash": request_token_hash,
                            }
                        )
                        if current and current != previous:
                            logger.warning(
                                "douyin QR state changed: %s -> %s",
                                previous or "unknown",
                                current,
                            )
                        return

                    qrcode = data.get("qrcode")
                    if not qrcode or douyin_qr_state is None:
                        return
                    if sequence < int(douyin_qr_state.get("last_qr_sequence") or 0):
                        return
                    qrcode_text = str(qrcode)
                    qr_image = (
                        qrcode_text
                        if qrcode_text.startswith("data:image/")
                        else f"data:image/png;base64,{qrcode_text}"
                    )
                    token = str(data.get("token") or "")
                    token_hash = self._hash12(token) if token else None
                    qr_hash = self._hash12(qrcode_text)
                    expires_in = self._expires_in_seconds(data.get("expire_time"))
                    previous_binding = (
                        douyin_qr_state.get("token_hash"),
                        douyin_qr_state.get("qr_hash"),
                    )
                    current_binding = (token_hash, qr_hash)
                    version = int(douyin_qr_state.get("version") or 0)
                    if current_binding != previous_binding or version == 0:
                        version += 1
                    generated_at = self._iso_now()
                    qr_url = str(data.get("qrcode_index_url") or self.login_url)
                    business_code = (
                        data.get("error_code")
                        or payload.get("error_code")
                        or payload.get("status_code")
                        or payload.get("code")
                        or 0
                    )
                    douyin_qr_state.update(
                        {
                            "status": "new",
                            "message": "",
                            "error_code": business_code,
                            "updated_at": time.time(),
                            "version": version,
                            # 原始 token 只保存在当前内存会话，绝不返回前端或写日志。
                            "token": token or None,
                            "token_hash": token_hash,
                            "qr_hash": qr_hash,
                            "qr_image": qr_image,
                            "qr_url": qr_url,
                            "generated_at": generated_at,
                            "expires_in": expires_in,
                            "expires_at": time.time() + expires_in,
                            "last_qr_sequence": sequence,
                        }
                    )
                    event = {
                        "kind": "qrcode",
                        "at": generated_at,
                        "http_status": resp.status,
                        "business_code": business_code,
                        "version": version,
                        "token_hash": token_hash,
                        "qr_hash": qr_hash,
                        "expires_in": expires_in,
                        "qrcode_index_url": self._safe_request_path(qr_url),
                        "request": self._safe_request_path(resp.url),
                        "method": resp.request.method,
                        "parameter_names": _request_parameter_names(resp),
                        "client_hints": client_hints,
                    }
                    _append_qr_event(event)
                    logger.warning(
                        "douyin QR generated version=%s http=%s business=%s "
                        "token_hash=%s qr_hash=%s expires_in=%s index_url=%s",
                        version,
                        resp.status,
                        business_code,
                        token_hash,
                        qr_hash,
                        expires_in,
                        event["qrcode_index_url"],
                    )
                    if response_qr_future and not response_qr_future.done():
                        response_qr_future.set_result(
                            {"version": version, "token_hash": token_hash}
                        )
                except Exception as exc:
                    logger.warning(
                        "parse douyin QR response failed request=%s error=%s",
                        self._safe_request_path(resp.url),
                        str(exc)[:200],
                    )

            def _schedule_douyin_response(resp) -> None:
                nonlocal network_sequence
                if not any(
                    marker in resp.url
                    for marker in (
                        "/passport/web/get_qrcode/",
                        "/passport/web/check_qrconnect/",
                    )
                ):
                    return
                network_sequence += 1
                asyncio.create_task(
                    _capture_douyin_qr_response(resp, network_sequence)
                )

            page.on("response", _schedule_douyin_response)

        try:
            await self._goto_with_retries(
                page,
                self.login_url,
                wait_until="commit"
                if self.platform in {"douyin", "channels"}
                else "domcontentloaded",
                timeout=60000,
            )
            await self._recover_blank_login_page(page)
            qr_url = self.login_url
            qr_base64 = ""
            qr_expires_in = 300
            if response_qr_future is not None:
                try:
                    # asyncio.wait_for uses seconds. Keep the fast XHR path
                    # bounded so a missing/blocked Douyin response promptly
                    # falls back to extracting the visible DOM QR code.
                    await asyncio.wait_for(response_qr_future, timeout=12)
                    # 页面初始化可能连续生成多个 token。短暂等待并读取同一个
                    # state 字典的最新原子快照，禁止把第一次响应的旧码返回前端。
                    await asyncio.sleep(0.75)
                    latest = douyin_qr_state or {}
                    latest_image = str(latest.get("qr_image") or "")
                    if latest_image.startswith("data:image/") and "," in latest_image:
                        qr_base64 = latest_image.split(",", 1)[1]
                    qr_url = str(latest.get("qr_url") or self.login_url)
                    qr_expires_in = int(latest.get("expires_in") or 180)
                except Exception as exc:
                    logger.warning(
                        "douyin fast QR response capture failed, falling back to DOM: %s",
                        exc,
                    )

            if not qr_base64:
                # Avoid waiting for full network-idle; Douyin/Channels keep background
                # requests open. The QR is available much earlier.
                await asyncio.sleep(
                    0.8 if self.platform in {"douyin", "kuaishou", "bilibili"} else 1.5
                )
                await self._reveal_qrcode(page)
                await self._wait_for_qrcode_candidate(
                    page,
                    timeout=90000 if self.platform == "channels" else 12000,
                )
                screenshot = await self._capture_qrcode(page)
                qr_base64 = base64.b64encode(screenshot).decode("ascii")

            if douyin_qr_state is not None:
                douyin_qr_state["fingerprint"] = await self._browser_fingerprint(page)
                logger.warning(
                    "douyin browser fingerprint=%s",
                    json.dumps(
                        douyin_qr_state["fingerprint"],
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                )

                async def _collect_egress() -> None:
                    assert douyin_qr_state is not None
                    douyin_qr_state["egress"] = await self._egress_evidence(context)
                    logger.warning(
                        "douyin egress evidence=%s",
                        json.dumps(
                            douyin_qr_state["egress"],
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ),
                    )

                evidence_task = asyncio.create_task(_collect_egress())
        except asyncio.CancelledError:
            # start_login applies an overall deadline. Cancellation must close
            # the locally-created browser because the session is not registered
            # in self._sessions until QR extraction completes.
            await self._close_browser(browser)
            raise
        except Exception as e:
            await self._close_browser(browser)
            raise RuntimeError(f"获取 {self.platform} 登录二维码失败: {e}") from e

        self._sessions[session_id] = {
            "browser": browser,
            "context": context,
            "page": page,
            "created_at": time.time(),
            "last_status": LoginStatus.WAITING,
            "cookies": None,
            "douyin_qr_state": douyin_qr_state,
            "evidence_task": evidence_task,
            "qr_maintainer_task": None,
        }
        if douyin_qr_state is not None:
            self._sessions[session_id]["qr_maintainer_task"] = asyncio.create_task(
                self._maintain_douyin_qrcode(session_id)
            )

        latest_version = int((douyin_qr_state or {}).get("version") or 1)
        latest_token_hash = (douyin_qr_state or {}).get("token_hash")
        latest_qr_hash = (douyin_qr_state or {}).get("qr_hash")
        latest_generated_at = (douyin_qr_state or {}).get("generated_at")
        # Douyin exposes an official QR token, but the remaining platforms only
        # expose the rendered QR element. Hash the actual image bytes for every
        # platform so the frontend and test evidence can distinguish a newly
        # generated code from a stale one without persisting the QR payload.
        if not latest_qr_hash:
            latest_qr_hash = self._hash12(base64.b64decode(qr_base64))
        if not latest_generated_at:
            latest_generated_at = self._iso_now()
        return QRCodeData(
            session_id=session_id,
            qr_url=qr_url,
            qr_image=f"data:image/png;base64,{qr_base64}",
            expires_in=qr_expires_in,
            qr_version=latest_version,
            token_hash=latest_token_hash,
            qr_hash=latest_qr_hash,
            generated_at=latest_generated_at,
            evidence={
                "launch": (douyin_qr_state or {}).get("launch"),
                "fingerprint": (douyin_qr_state or {}).get("fingerprint"),
            }
            if douyin_qr_state is not None
            else {},
        )

    async def _maintain_douyin_qrcode(self, session_id: str) -> None:
        """在同一 page/context 内维持官方最新二维码，不自行调用二维码接口。

        抖音当前二维码约 60 秒失效。仅在仍处于 new/waiting 且距失效不足
        6 秒时刷新官方页面；response listener 会原子绑定新图片和新 token，
        service/frontend 随 qr_version 更新并停止使用旧版本。
        """
        try:
            while True:
                sess = self._sessions.get(session_id)
                if not sess:
                    return
                page = sess.get("page")
                state = sess.get("douyin_qr_state") or {}
                if page is None or page.is_closed():
                    return
                status = str(state.get("status") or "").lower()
                if status in {
                    "scanned",
                    "scan",
                    "authorizing",
                    "pending_confirmation",
                    "confirmed",
                    "success",
                    "done",
                    "authorized",
                }:
                    await asyncio.sleep(1)
                    continue
                expires_at = float(state.get("expires_at") or 0)
                if not expires_at:
                    await asyncio.sleep(1)
                    continue
                remaining = expires_at - time.time()
                if remaining > 6:
                    await asyncio.sleep(min(2, max(0.5, remaining - 6)))
                    continue

                before_version = int(state.get("version") or 0)
                logger.warning(
                    "douyin QR official-page refresh requested old_version=%s "
                    "token_hash=%s remaining=%.1f",
                    before_version,
                    state.get("token_hash"),
                    remaining,
                )
                # Reloading the official page preserves this BrowserContext and
                # its cookies/request context. The page itself creates and polls
                # the new token; this code never calls get_qrcode/check_qrconnect.
                await page.reload(wait_until="commit", timeout=60000)
                deadline = time.time() + 12
                while time.time() < deadline:
                    if int(state.get("version") or 0) > before_version:
                        logger.warning(
                            "douyin QR atomically switched old_version=%s "
                            "new_version=%s token_hash=%s qr_hash=%s",
                            before_version,
                            state.get("version"),
                            state.get("token_hash"),
                            state.get("qr_hash"),
                        )
                        break
                    await asyncio.sleep(0.25)
                else:
                    logger.warning(
                        "douyin QR official-page refresh produced no new version "
                        "old_version=%s",
                        before_version,
                    )
                    await asyncio.sleep(3)
        except asyncio.CancelledError:
            return
        except Exception as exc:
            logger.warning(
                "douyin QR maintainer stopped session=%s error=%s",
                session_id[:8],
                str(exc)[:200],
            )

    async def get_qr_snapshot(self, session_id: str) -> dict[str, Any] | None:
        sess = self._sessions.get(session_id)
        if not sess:
            return None
        state = sess.get("douyin_qr_state") or {}
        if not state:
            return None
        expires_at = float(state.get("expires_at") or 0)
        expires_in = (
            max(0, int(expires_at - time.time()))
            if expires_at
            else int(state.get("expires_in") or 0)
        )
        return {
            "qr_image": state.get("qr_image"),
            "qr_version": int(state.get("version") or 0),
            "token_hash": state.get("token_hash"),
            "qr_hash": state.get("qr_hash"),
            "generated_at": state.get("generated_at"),
            "expires_in": expires_in,
            "official_status": state.get("status"),
            "official_message": state.get("message"),
            "official_error_code": state.get("error_code"),
            "evidence": {
                "launch": state.get("launch"),
                "fingerprint": state.get("fingerprint"),
                "egress": state.get("egress"),
                "egress_status": state.get("egress_status"),
                "verification": state.get("verification"),
                "completion": state.get("completion"),
                "events": list(state.get("events") or []),
            },
        }

    async def _reveal_qrcode(self, page) -> None:
        """Best-effort switch from password/SMS login to QR login."""
        # Kuaishou renders the real switch as a 40x40 div. Its adjacent
        # "扫码登录" tooltip is a different element; clicking the tooltip does
        # not switch modes, which previously caused a full-page screenshot to
        # be returned instead of a QR code.
        if self.platform == "kuaishou":
            deadline = time.time() + 15
            while time.time() < deadline:
                try:
                    qrcode = page.locator('.qrcode img, [class*="qrcode"] img').first
                    if await qrcode.count() > 0 and await qrcode.is_visible():
                        return
                    switch = page.locator(
                        '.platform-switch, [class~="platform-switch"]'
                    ).first
                    if await switch.count() > 0 and await switch.is_visible():
                        await switch.click(timeout=3000, force=True)
                        await page.locator(
                            '.qrcode img, [class*="qrcode"] img'
                        ).first.wait_for(
                            state="visible",
                            timeout=10000,
                        )
                        return
                except Exception as exc:
                    logger.debug("kuaishou switch-to-QR attempt failed: %s", exc)
                await asyncio.sleep(0.25)

        text_keywords = (
            "\u626b\u7801\u767b\u5f55",  # ????
            "\u4e8c\u7ef4\u7801\u767b\u5f55",  # ?????
            "\u626b\u7801",  # ??
            "QR",
            "qrcode",
        )
        try:
            for kw in text_keywords:
                loc = page.get_by_text(kw, exact=False).first
                if await loc.count() > 0 and await loc.is_visible():
                    await loc.click(timeout=2000)
                    await asyncio.sleep(0.5)
                    return
        except Exception as e:
            logger.debug("%s switch-to-QR by text failed: %s", self.platform, e)

        # Generic DOM fallback: click a visible small tab/button whose text says
        # scan/QR. This helps when hashed class names change.
        try:
            clicked = await page.evaluate(
                """() => {
                  const kws = ['\\u626b\\u7801', '\\u4e8c\\u7ef4\\u7801', 'QR', 'qrcode'];
                  const els = [...document.querySelectorAll('button,a,div,span')].filter(el => {
                    const t = (el.innerText || el.textContent || '').trim();
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0 && r.width <= 360 && r.height <= 120 && kws.some(k => t.includes(k));
                  });
                  if (els.length) { els[0].click(); return true; }
                  return false;
                }"""
            )
            if clicked:
                await asyncio.sleep(0.5)
                return
        except Exception as e:
            logger.debug("%s switch-to-QR by DOM failed: %s", self.platform, e)

        # Xiaohongshu sometimes uses a small data-image corner switch icon
        # without useful text.
        if self.platform == "xiaohongshu":
            try:
                clicked = await page.evaluate(
                    """() => {
                      const imgs=[...document.querySelectorAll('img')].filter(el=>{
                        const r=el.getBoundingClientRect();
                        return r.width>=50&&r.width<=90&&r.x>900&&r.y<280&&(el.src||'').startsWith('data:');
                      });
                      if(imgs.length){imgs[0].click();return true;}
                      return false;
                    }"""
                )
                if clicked:
                    await asyncio.sleep(0.8)
            except Exception as e:
                logger.debug("xiaohongshu QR icon switch failed: %s", e)

    # QR element selectors: include generic data-image/img because some
    # platforms (notably Xiaohongshu) render the QR with hashed CSS classes.
    _QR_ELEMENT_SELECTORS = [
        ".qrcode img",
        ".qrcode-img img",
        '[class*="qrcode"] img',
        '[class*="qrcode"] canvas',
        '[class*="qrcode"] svg',
        '[class*="qr-code"] img',
        '[class*="qr-code"] canvas',
        '[class*="qr-code"] svg',
        'svg[class*="qrcode"]',
        'svg[class*="qr-code"]',
        'img[alt*="qrcode" i]',
        'img[alt*="scan" i]',
        'img[src*="qr"]',
        'img[src^="data:image"]',
        'img[src^="blob:"]',
        "canvas",
        "img",
    ]

    @staticmethod
    async def _data_image_bytes(locator) -> bytes | None:
        """Return QR pixels without Playwright's font-dependent screenshot path.

        Besides base64 ``img`` sources, Channels can render the code in a
        canvas/blob-backed image.  Reading those pixels through the page avoids
        ``Page.screenshot`` waiting indefinitely for unrelated web fonts.
        """
        try:
            tag = (await locator.evaluate("el => el.tagName") or "").lower()
            if tag == "img":
                src = await locator.get_attribute("src")
                if src and src.startswith("data:image") and ";base64," in src:
                    return base64.b64decode(src.split(",", 1)[1], validate=False)
            data_url = await locator.evaluate(
                """async (el) => {
                  try {
                    if (el.tagName === 'CANVAS') {
                      return el.toDataURL('image/png');
                    }
                    if (el.tagName === 'svg' || el.tagName === 'SVG') {
                      const xml = new XMLSerializer().serializeToString(el);
                      const source = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
                      const image = new Image();
                      image.src = source;
                      await image.decode();
                      const box = el.getBoundingClientRect();
                      const canvas = document.createElement('canvas');
                      canvas.width = Math.max(1, Math.round(box.width));
                      canvas.height = Math.max(1, Math.round(box.height));
                      const ctx = canvas.getContext('2d');
                      if (!ctx) return '';
                      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                      return canvas.toDataURL('image/png');
                    }
                    if (el.tagName !== 'IMG' || !el.complete || !el.naturalWidth) {
                      return '';
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = el.naturalWidth;
                    canvas.height = el.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return '';
                    ctx.drawImage(el, 0, 0);
                    return canvas.toDataURL('image/png');
                  } catch (_) {
                    return '';
                  }
                }"""
            )
            if (
                isinstance(data_url, str)
                and data_url.startswith("data:image")
                and ";base64," in data_url
            ):
                return base64.b64decode(
                    data_url.split(",", 1)[1],
                    validate=False,
                )
            return None
        except (binascii.Error, Exception):
            return None

    async def _wait_for_qrcode_candidate(self, page, timeout: int = 10000) -> None:
        """Wait briefly until a visible square-ish QR element exists."""
        deadline = time.time() + max(timeout, 1000) / 1000
        while time.time() < deadline:
            try:
                for frame in page.frames:
                    for sel in self._QR_ELEMENT_SELECTORS:
                        locs = frame.locator(sel)
                        count = min(await locs.count(), 12)
                        for idx in range(count):
                            loc = locs.nth(idx)
                            if not await loc.is_visible(timeout=300):
                                continue
                            box = await loc.bounding_box(timeout=300)
                            if not box:
                                continue
                            w = float(box.get("width", 0) or 0)
                            h = float(box.get("height", 0) or 0)
                            if 90 <= w <= 560 and 90 <= h <= 560:
                                ratio = w / h if h else 0
                                if 0.70 <= ratio <= 1.42:
                                    return
            except Exception:
                pass
            await asyncio.sleep(0.35)

    async def _capture_qrcode(self, page) -> bytes:
        """Capture the actual QR image, not the whole login page screenshot.

        The previous fallback returned the complete login page, where the QR was
        too small to scan. We now scan the main page and all frames for visible
        square-ish img/canvas elements, prefer QR/data-image hints, and return
        the original data-image bytes when possible.
        """
        candidates: list[tuple[float, Any]] = []
        seen: set[tuple[int, int, int, int]] = set()
        for frame in page.frames:
            for sel in self._QR_ELEMENT_SELECTORS:
                try:
                    locs = frame.locator(sel)
                    count = min(await locs.count(), 20)
                    for idx in range(count):
                        loc = locs.nth(idx)
                        if not await loc.is_visible(timeout=1000):
                            continue
                        box = await loc.bounding_box(timeout=1000)
                        if not box:
                            continue
                        w = float(box.get("width", 0) or 0)
                        h = float(box.get("height", 0) or 0)
                        if w < 100 or h < 100 or w > 520 or h > 520:
                            continue
                        ratio = w / h if h else 0
                        if ratio < 0.72 or ratio > 1.38:
                            continue
                        key = (
                            round(box.get("x", 0)),
                            round(box.get("y", 0)),
                            round(w),
                            round(h),
                        )
                        if key in seen:
                            continue
                        seen.add(key)
                        class_name = ""
                        src = ""
                        try:
                            class_name = (
                                await loc.get_attribute("class") or ""
                            ).lower()
                            src = (await loc.get_attribute("src") or "").lower()
                        except Exception:
                            pass
                        square_score = 1.0 - min(abs(1.0 - ratio), 1.0)
                        size_score = min(max(w, h) / 260.0, 1.0)
                        hint_score = 0.0
                        if (
                            "qr" in class_name
                            or "qrcode" in class_name
                            or "code" in class_name
                        ):
                            hint_score += 1.0
                        if src.startswith("data:image") or "qr" in src:
                            hint_score += 0.8
                        candidates.append(
                            (square_score * 2.0 + size_score + hint_score, loc)
                        )
                except Exception:
                    continue

        if candidates:
            candidates.sort(key=lambda item: item[0], reverse=True)
            best = candidates[0][1]
            raw = await self._data_image_bytes(best)
            if raw:
                return raw
            return await best.screenshot()

        raise RuntimeError(
            f"{self.platform_name}登录二维码未加载，请检查网络后重试"
        )

    def _run_screenshot_dir(self, run_id: str) -> Path:
        """本次发布的截图目录：<SYNAPSE_STORAGE_DIR>/screenshots/<platform>/<run_id>。"""
        from app.core.config import get_settings

        base = (
            Path(get_settings().SYNAPSE_STORAGE_DIR)
            / "screenshots"
            / self.platform
            / run_id
        )
        base.mkdir(parents=True, exist_ok=True)
        return base

    async def _screenshot_step(
        self, page, run_dir: Path, label: str, shots: list[str]
    ) -> None:
        """对当前页面截图留痕（发布链路排错用），失败不影响主流程。"""
        try:
            path = run_dir / f"{int(time.time() * 1000)}_{label}.png"
            await asyncio.wait_for(
                page.screenshot(path=str(path), full_page=False), timeout=8
            )
            shots.append(str(path))
        except Exception as e:
            logger.warning("%s 截图 %s 失败: %s", self.platform, label, e)

    async def _evaluate_with_timeout(
        self, page, script: str, arg: Any = None, timeout: int = 8
    ) -> Any:
        """Run page.evaluate with a hard timeout.

        Some creator pages (notably Douyin after video upload) keep the main
        thread busy for a long time. A naked ``page.evaluate`` can block the
        worker indefinitely, leaving the publish task in ``running``. Keep all
        non-essential DOM probing bounded so a failed selector becomes a normal
        publish_error instead of a stuck Celery process.
        """
        coro = page.evaluate(script) if arg is None else page.evaluate(script, arg)
        return await asyncio.wait_for(coro, timeout=timeout)

    def _extract_post_id(self, url: str) -> str | None:
        """尽力从发布成功后的 URL 中解析平台内容 ID（解析不到返回 None，不伪造）。"""
        if not url:
            return None
        patterns = [
            r"[?&](?:note_id|noteId|photoId|aweme_id|bvid|vid|aid|id)=([A-Za-z0-9_-]{6,})",
            r"/(?:note|item|video|detail|explore|short-video)/([A-Za-z0-9_-]{8,})",
            r"/(BV[A-Za-z0-9]{8,})",
        ]
        for pat in patterns:
            m = re.search(pat, url)
            if m:
                return m.group(1)
        return None

    def _canonical_content_url(self, content_id: str | None) -> str | None:
        """Build a public content URL from a platform id when the creator page exposes only an id."""
        if not content_id:
            return None
        cid = str(content_id).strip()
        if not cid:
            return None
        if self.platform == "xiaohongshu":
            return f"https://www.xiaohongshu.com/explore/{cid}"
        if self.platform == "douyin":
            return f"https://www.douyin.com/video/{cid}"
        if self.platform == "bilibili":
            return f"https://www.bilibili.com/video/{cid}"
        if self.platform == "kuaishou":
            return f"https://www.kuaishou.com/short-video/{cid}"
        return None

    def _is_content_url(self, url: str | None) -> bool:
        if not url:
            return False
        patterns = {
            "xiaohongshu": r"xiaohongshu\.com/(?:explore|discovery/item)/[A-Za-z0-9_-]{8,}",
            "douyin": r"douyin\.com/(?:video|note)/[A-Za-z0-9_-]{8,}",
            "bilibili": r"bilibili\.com/video/BV[A-Za-z0-9]{8,}",
            "kuaishou": r"kuaishou\.com/(?:short-video|fw/photo)/[A-Za-z0-9_-]{8,}",
        }
        pat = patterns.get(self.platform)
        return bool(pat and re.search(pat, url))

    def _is_creator_manage_url(self, url: str | None) -> bool:
        if not url:
            return False
        return any(
            token in url
            for token in (
                "creator",
                "member.bilibili.com",
                "upload-manager",
                "content/manage",
                "publish",
            )
        )

    async def _extract_douyin_manager_post(
        self, page, title: str | None = None
    ) -> dict | None:
        """Read Douyin creator-manager React card data for the matching post."""
        title_norm = re.sub(r"\s+", "", title or "").lower()
        try:
            hit = await self._evaluate_with_timeout(
                page,
                """(targetNorm) => {
                  const norm = (s) => String(s || '').replace(/\\s+/g, '').toLowerCase();
                  const seen = new Set();
                  const hits = [];
                  const interesting = /aweme|item|video|opus|id|title|desc|share|stat|status|data/i;
                  const read = (obj, fallbackText = '') => {
                    if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
                    seen.add(obj);
                    let keys = [];
                    try { keys = Object.keys(obj); } catch { return; }
                    const awemeId = obj.aweme_id || obj.awemeId || obj.item_id || obj.itemId || obj.group_id;
                    const itemTitle = obj.item_title || obj.title || '';
                    const desc = obj.desc || obj.description || '';
                    const shareUrl = obj.share_url || obj.shareUrl || obj.share_info?.share_url || '';
                    if (awemeId && (itemTitle || desc || fallbackText || shareUrl)) {
                      const hay = norm([itemTitle, desc, fallbackText].join(' '));
                      const score = targetNorm && hay.includes(targetNorm) ? 100 : 10;
                      hits.push({
                        score,
                        aweme_id: String(awemeId),
                        item_title: String(itemTitle || ''),
                        desc: String(desc || ''),
                        share_url: String(shareUrl || '')
                      });
                    }
                    for (const key of keys.slice(0, 100)) {
                      if (!interesting.test(key) && !['props', 'memoizedProps', 'pendingProps', 'memoizedState', 'stateNode', 'return', 'child', 'sibling', 'data', 'list', 'items'].includes(key)) continue;
                      try { read(obj[key], fallbackText); } catch {}
                    }
                  };
                  const cards = [...document.querySelectorAll('[class*=video-card], [class*=card], [class*=item]')];
                  for (const card of cards) {
                    const text = card.innerText || card.textContent || '';
                    if (targetNorm && !norm(text).includes(targetNorm)) continue;
                    const fiberKey = Object.keys(card).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
                    const propsKey = Object.keys(card).find(k => k.startsWith('__reactProps$'));
                    if (fiberKey) read(card[fiberKey], text);
                    if (propsKey) read(card[propsKey], text);
                  }
                  hits.sort((a, b) => b.score - a.score);
                  return hits[0] || null;
                }""",
                title_norm,
                timeout=12,
            )
            if hit and hit.get("aweme_id"):
                cid = str(hit.get("aweme_id"))
                return {
                    "external_post_id": cid,
                    "publish_url": hit.get("share_url")
                    or self._canonical_content_url(cid),
                }
        except Exception as exc:
            logger.debug(
                "%s Douyin manager card extraction failed: %s", self.platform, exc
            )
        return None

    async def _extract_xhs_manager_post(
        self, page, title: str | None = None
    ) -> dict | None:
        """Read Xiaohongshu creator note-manager API for the matching note."""
        title_norm = re.sub(r"\s+", "", title or "").lower()
        try:
            hit = await self._evaluate_with_timeout(
                page,
                """async (targetNorm) => {
                  const norm = (s) => String(s || '').replace(/\\s+/g, '').toLowerCase();
                  const urls = [
                    '/api/galaxy/v2/creator/note/user/posted?tab=0&page=0',
                    '/api/galaxy/creator/home/latest_note_data'
                  ];
                  const hits = [];
                  for (const url of urls) {
                    try {
                      const res = await fetch(url, {credentials: 'include'});
                      const data = await res.json();
                      const notes = [];
                      if (Array.isArray(data?.data?.notes)) notes.push(...data.data.notes);
                      if (data?.data?.noteInfo) notes.push(data.data.noteInfo);
                      for (const note of notes) {
                        const id = note.id || note.note_id || note.noteId;
                        const title = note.display_title || note.title || note.desc || '';
                        const desc = note.desc || '';
                        if (!id) continue;
                        const hay = norm([title, desc].join(' '));
                        const score = targetNorm && hay.includes(targetNorm) ? 100 : 10;
                        hits.push({score, id: String(id), title: String(title || ''), desc: String(desc || '')});
                      }
                    } catch {}
                  }
                  hits.sort((a, b) => b.score - a.score);
                  if (targetNorm && (!hits.length || hits[0].score < 100)) return null;
                  return hits[0] || null;
                }""",
                title_norm,
                timeout=12,
            )
            if hit and hit.get("id"):
                cid = str(hit.get("id"))
                return {
                    "external_post_id": cid,
                    "publish_url": self._canonical_content_url(cid),
                }
        except Exception as exc:
            logger.debug(
                "%s Xiaohongshu manager API extraction failed: %s", self.platform, exc
            )
        return None

    def _extract_kuaishou_manager_post(
        self, payloads: list[dict], title: str | None = None
    ) -> dict | None:
        """Extract a matching work from captured Kuaishou work-list responses."""
        title_norm = re.sub(r"\s+", "", title or "").lower()
        hits: list[tuple[int, dict]] = []
        for payload in payloads or []:
            works = ((payload or {}).get("data") or {}).get("list") or []
            for work in works:
                content_id = (
                    work.get("workId") or work.get("photoId") or work.get("photo_id")
                )
                if not content_id:
                    continue
                work_title = str(work.get("title") or "")
                work_norm = re.sub(r"\s+", "", work_title).lower()
                score = 100 if title_norm and title_norm in work_norm else 10
                hits.append((score, work))
        hits.sort(key=lambda item: item[0], reverse=True)
        if not hits or (title_norm and hits[0][0] < 100):
            return None
        work = hits[0][1]
        content_id = str(
            work.get("workId") or work.get("photoId") or work.get("photo_id")
        )
        return {
            "external_post_id": content_id,
            "publish_url": self._canonical_content_url(content_id),
            "metrics": {
                "play_count": work.get("playCount"),
                "comment_count": work.get("commentCount"),
                "like_count": work.get("likeCount"),
            },
        }

    async def _resolve_post_url_after_publish(
        self, page, title: str | None = None
    ) -> str | None:
        """After a successful submit, try to resolve the public post URL from the manager page.

        Creator pages often redirect to a management list instead of the public
        post. This scans anchors and embedded page data for a real content id so
        the admin can click the published item directly.
        """
        if self._is_content_url(page.url):
            return page.url

        title_norm = re.sub(r"\s+", "", title or "").lower()
        if self.platform == "bilibili":
            try:
                await page.goto(
                    "https://member.bilibili.com/platform/upload-manager/article",
                    wait_until="domcontentloaded",
                    timeout=45000,
                )
                await asyncio.sleep(4)
                await self._dismiss_popups(page)
            except Exception as exc:
                logger.debug(
                    "%s open Bilibili upload manager failed: %s", self.platform, exc
                )
        elif self.platform == "xiaohongshu":
            try:
                await page.goto(
                    "https://creator.xiaohongshu.com/new/note-manager",
                    wait_until="domcontentloaded",
                    timeout=60000,
                )
                await asyncio.sleep(5)
                await self._dismiss_popups(page)
                xhs_post = await self._extract_xhs_manager_post(page, title=title)
                if xhs_post and xhs_post.get("publish_url"):
                    return xhs_post["publish_url"]
            except Exception as exc:
                logger.debug(
                    "%s open Xiaohongshu note manager failed: %s", self.platform, exc
                )
        elif self.platform == "douyin":
            try:
                await page.goto(
                    "https://creator.douyin.com/creator-micro/content/manage",
                    wait_until="domcontentloaded",
                    timeout=60000,
                )
                await asyncio.sleep(6)
                await self._dismiss_popups(page)
                douyin_post = await self._extract_douyin_manager_post(page, title=title)
                if douyin_post and douyin_post.get("publish_url"):
                    return douyin_post["publish_url"]
            except Exception as exc:
                logger.debug(
                    "%s open Douyin content manager failed: %s", self.platform, exc
                )
        elif self.platform == "kuaishou":
            payloads: list[dict] = []

            async def capture_work_list(response) -> None:
                if "/rest/cp/works/v2/video/pc/photo/list" not in response.url:
                    return
                try:
                    payload = await response.json()
                    if isinstance(payload, dict):
                        payloads.append(payload)
                except Exception:
                    pass

            try:
                page.on("response", capture_work_list)
                await page.goto(
                    "https://cp.kuaishou.com/article/manage/video?status=0&from=publish",
                    wait_until="domcontentloaded",
                    timeout=60000,
                )
                await asyncio.sleep(8)
                await self._dismiss_popups(page)
                kuaishou_post = self._extract_kuaishou_manager_post(
                    payloads, title=title
                )
                if kuaishou_post and kuaishou_post.get("publish_url"):
                    return kuaishou_post["publish_url"]
            except Exception as exc:
                logger.debug(
                    "%s open Kuaishou content manager failed: %s", self.platform, exc
                )
            finally:
                try:
                    page.remove_listener("response", capture_work_list)
                except Exception:
                    pass
        href_patterns = {
            "xiaohongshu": r"https?://(?:www\.)?xiaohongshu\.com/(?:explore|discovery/item)/[A-Za-z0-9_-]{8,}",
            "douyin": r"https?://(?:www\.)?douyin\.com/(?:video|note)/[A-Za-z0-9_-]{8,}",
            "bilibili": r"https?://(?:www\.)?bilibili\.com/video/BV[A-Za-z0-9]{8,}",
            "kuaishou": r"https?://(?:www\.)?kuaishou\.com/(?:short-video|fw/photo)/[A-Za-z0-9_-]{8,}",
        }
        id_patterns = {
            "xiaohongshu": [r'"(?:noteId|note_id|id)"\s*:\s*"([A-Za-z0-9_-]{16,})"'],
            "douyin": [
                r'"(?:aweme_id|item_id|itemId)"\s*:\s*"([0-9]{12,})"',
                r"/video/([0-9]{12,})",
            ],
            "bilibili": [r"(BV[A-Za-z0-9]{8,})"],
            "kuaishou": [r'"(?:workId|photoId|photo_id)"\s*:\s*"([A-Za-z0-9_-]{8,})"'],
        }

        deadline = time.time() + 25
        while time.time() < deadline:
            try:
                links = await self._evaluate_with_timeout(
                    page,
                    """() => [...document.querySelectorAll('a[href]')].map(a => ({
                      href: a.href || '',
                      text: (a.innerText || a.textContent || '').trim()
                    })).filter(x => x.href)""",
                    timeout=8,
                )
                candidates: list[tuple[int, str]] = []
                for item in links or []:
                    href = str(item.get("href") or "")
                    text = str(item.get("text") or "")
                    if not self._is_content_url(href):
                        continue
                    score = 10
                    if title_norm and title_norm in re.sub(r"\s+", "", text).lower():
                        score += 100
                    candidates.append((score, href))
                if candidates:
                    candidates.sort(key=lambda x: x[0], reverse=True)
                    if (
                        self.platform == "bilibili"
                        and title_norm
                        and candidates[0][0] < 100
                    ):
                        await asyncio.sleep(1.5)
                        continue
                    return candidates[0][1]
            except Exception as exc:
                logger.debug(
                    "%s scan public links after publish failed: %s", self.platform, exc
                )

            try:
                html = await asyncio.wait_for(page.content(), timeout=8)
                href_pat = href_patterns.get(self.platform)
                if href_pat:
                    m = re.search(href_pat, html)
                    if m:
                        return m.group(0).replace("\\/", "/")
                for pat in id_patterns.get(self.platform, []):
                    m = re.search(pat, html)
                    if m:
                        canonical = self._canonical_content_url(m.group(1))
                        if canonical:
                            return canonical
            except Exception:
                pass
            await asyncio.sleep(1.5)
        return None

    async def poll_status(self, session_id: str) -> LoginResult:
        sess = self._sessions.get(session_id)
        if not sess:
            return LoginResult(
                status=LoginStatus.EXPIRED,
                message="会话不存在或已过期",
                cookies=None,
                user_info=None,
            )

        # 超时检查（5 分钟过期）
        if time.time() - sess["created_at"] > 300:
            await self.cleanup_session(session_id)
            return LoginResult(
                status=LoginStatus.EXPIRED,
                message="二维码已过期",
                cookies=None,
                user_info=None,
            )

        page = sess.get("page")
        if page is None or page.is_closed():
            await self.cleanup_session(session_id)
            return LoginResult(
                status=LoginStatus.EXPIRED,
                message="浏览器页面已关闭",
                cookies=None,
                user_info=None,
            )

        try:
            current_url = page.url
            context = sess["context"]
            cookies = await context.cookies()
            strong_names = PLATFORM_AUTH_COOKIE_NAMES.get(self.platform, set())
            has_strong_auth_cookie = any(
                cookie.get("name") in strong_names and cookie.get("value")
                for cookie in cookies
            )
            left_login_page = (
                self.login_url
                and current_url != self.login_url
                and "login" not in current_url.lower()
            )
            douyin_qr_state = sess.get("douyin_qr_state") or {}
            qr_status = str(douyin_qr_state.get("status") or "").lower()
            qr_message = str(douyin_qr_state.get("message") or "").strip()
            if (
                self.platform == "douyin"
                and qr_status
                in {
                    "scanned",
                    "scan",
                    "authorizing",
                    "pending_confirmation",
                    "confirmed",
                    "success",
                    "done",
                    "authorized",
                }
                and not douyin_qr_state.get("egress_status_checked")
            ):
                douyin_qr_state["egress_status"] = await self._egress_evidence(
                    context
                )
                douyin_qr_state["egress_status_checked"] = True

            if self.platform == "douyin":
                requires_security_verification = any(
                    marker in qr_message.lower()
                    for marker in (
                        "安全验证",
                        "完成验证",
                        "账号安全",
                        "security verification",
                        "verify in",
                    )
                )
                if requires_security_verification:
                    verification = await self._douyin_verification_prompt(page)
                    douyin_qr_state["verification"] = verification
                    if (
                        not verification.get("visible")
                        and has_strong_auth_cookie
                        and left_login_page
                        and qr_status
                        in {
                            "scanned",
                            "scan",
                            "authorizing",
                            "pending_confirmation",
                            "confirmed",
                            "success",
                            "done",
                            "authorized",
                        }
                    ):
                        creator_check = await self._verify_douyin_creator_session(page)
                        sess["creator_check"] = creator_check
                        if creator_check.get("valid"):
                            storage_state = await context.storage_state()
                            strong_cookie_names = sorted(
                                {
                                    str(cookie.get("name"))
                                    for cookie in cookies
                                    if cookie.get("name") in strong_names
                                    and cookie.get("value")
                                }
                            )
                            completion = {
                                "source": "official_web_identity_verification",
                                "at": self._iso_now(),
                                "prior_qr_status": qr_status,
                                "token_hash": douyin_qr_state.get("token_hash"),
                                "qr_hash": douyin_qr_state.get("qr_hash"),
                                "page_path": urlsplit(current_url).path,
                                "strong_cookie_names": strong_cookie_names,
                                "creator_check": creator_check,
                            }
                            douyin_qr_state["completion"] = completion
                            events = douyin_qr_state.setdefault("events", [])
                            events.append({"kind": "completion", **completion})
                            del events[:-40]
                            sess["cookies"] = cookies
                            sess["storage_state"] = storage_state
                            sess["last_status"] = LoginStatus.CONFIRMED
                            user_info = await self._extract_user_info(page)
                            return LoginResult(
                                status=LoginStatus.CONFIRMED,
                                message="抖音官方身份验证已完成，强认证 Cookie 与创作者账号接口均有效",
                                cookies=cookies,
                                user_info=user_info,
                                full_state=storage_state,
                            )
                    verification_hint = ""
                    if verification.get("visible"):
                        options = " / ".join(verification.get("options") or [])
                        verification_hint = (
                            f"；请在官方身份验证窗口完成{options}"
                            if options
                            else "；请在官方身份验证窗口完成验证"
                        )
                    sess["last_status"] = LoginStatus.SECURITY_VERIFICATION
                    return LoginResult(
                        status=LoginStatus.SECURITY_VERIFICATION,
                        message=(
                            qr_message or "抖音要求完成官方安全验证"
                        )
                        + verification_hint,
                        cookies=None,
                        user_info=None,
                    )
                if qr_status in {"expired", "timeout"}:
                    sess["last_status"] = LoginStatus.EXPIRED
                    return LoginResult(
                        status=LoginStatus.EXPIRED,
                        message=qr_message or "二维码已过期，请重新获取",
                        cookies=None,
                        user_info=None,
                    )
                if qr_status in {"error", "failed", "cancelled", "canceled"}:
                    sess["last_status"] = LoginStatus.FAILED
                    return LoginResult(
                        status=LoginStatus.FAILED,
                        message=qr_message or "平台未完成登录，请重新扫码",
                        cookies=None,
                        user_info=None,
                    )

            official_qr_confirmed = self.platform == "douyin" and qr_status in {
                "confirmed",
                "success",
                "done",
                "authorized",
            }

            # 抖音必须同时满足官方 confirmed、强认证 Cookie、创作者账号接口成功。
            # URL 离开 login 页面、单独出现 Cookie、单独出现 confirmed 都不能入库。
            if self.platform == "douyin" and official_qr_confirmed:
                if not has_strong_auth_cookie:
                    verification = await self._douyin_verification_prompt(page)
                    douyin_qr_state["verification"] = verification
                    sess["last_status"] = LoginStatus.SECURITY_VERIFICATION
                    return LoginResult(
                        status=LoginStatus.SECURITY_VERIFICATION,
                        message=qr_message
                        or "抖音已确认扫码，但尚未生成强认证 Cookie；请在官方身份验证窗口完成验证",
                        cookies=None,
                        user_info=None,
                    )
                creator_check = await self._verify_douyin_creator_session(page)
                sess["creator_check"] = creator_check
                if not creator_check.get("valid"):
                    sess["last_status"] = LoginStatus.SECURITY_VERIFICATION
                    return LoginResult(
                        status=LoginStatus.SECURITY_VERIFICATION,
                        message=str(
                            creator_check.get("reason")
                            or "已获得 Cookie，但创作者账号接口尚未确认登录"
                        ),
                        cookies=None,
                        user_info=None,
                    )
                storage_state = await context.storage_state()
                sess["cookies"] = cookies
                sess["storage_state"] = storage_state
                sess["last_status"] = LoginStatus.CONFIRMED
                user_info = await self._extract_user_info(page)
                return LoginResult(
                    status=LoginStatus.CONFIRMED,
                    message="抖音官方确认成功，强认证 Cookie 与创作者账号接口均有效",
                    cookies=cookies,
                    user_info=user_info,
                    full_state=storage_state,
                )

            if self.platform != "douyin" and (
                has_strong_auth_cookie or left_login_page
            ):
                if strong_names and not has_strong_auth_cookie:
                    sess["last_status"] = LoginStatus.WAITING
                    return LoginResult(
                        status=LoginStatus.WAITING,
                        message="已扫码，等待平台确认登录",
                        cookies=None,
                        user_info=None,
                    )
                storage_state = await context.storage_state()
                sess["cookies"] = cookies
                sess["storage_state"] = storage_state
                sess["last_status"] = LoginStatus.CONFIRMED
                user_info = await self._extract_user_info(page)
                return LoginResult(
                    status=LoginStatus.CONFIRMED,
                    message="登录成功",
                    cookies=cookies,
                    user_info=user_info,
                    full_state=storage_state,
                )

            if self.platform == "douyin" and qr_status in {
                "scanned",
                "scan",
                "authorizing",
                "pending_confirmation",
            }:
                sess["last_status"] = LoginStatus.SCANNED
                return LoginResult(
                    status=LoginStatus.SCANNED,
                    message=qr_message or "已扫码，请在抖音 App 确认登录",
                    cookies=None,
                    user_info=None,
                )

            # 否则继续等待
            sess["last_status"] = LoginStatus.WAITING
            return LoginResult(
                status=LoginStatus.WAITING,
                message="等待扫码",
                cookies=None,
                user_info=None,
            )
        except Exception as e:
            logger.warning("轮询 %s 登录态失败: %s", self.platform, e)
            return LoginResult(
                status=LoginStatus.WAITING,
                message=f"轮询异常: {e}",
                cookies=None,
                user_info=None,
            )

    async def _douyin_verification_prompt(self, page) -> dict[str, Any]:
        """读取官方身份验证弹窗的可见选项，不读取手机号或验证码。"""
        try:
            result = await page.evaluate(
                """() => {
                  const visible = (element) => {
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden'
                      && rect.width > 0 && rect.height > 0;
                  };
                  const lines = [...document.querySelectorAll('body *')]
                    .filter(visible)
                    .map(element => (element.innerText || element.textContent || '').trim())
                    .filter(text => text && text.length <= 80);
                  const unique = [...new Set(lines)];
                  const title = unique.find(text => text === '身份验证'
                    || text.includes('完成身份验证')) || '';
                  const optionCandidates = [
                    '接收短信验证码',
                    '发送短信验证',
                    '手机号验证',
                    '实名认证验证'
                  ];
                  const options = optionCandidates.filter(option =>
                    unique.some(text => text === option || text.includes(option))
                  );
                  return {visible: Boolean(title || options.length), title, options};
                }"""
            )
            return {
                "visible": bool((result or {}).get("visible")),
                "title": str((result or {}).get("title") or "")[:80],
                "options": [
                    str(option)[:80] for option in ((result or {}).get("options") or [])
                ],
                "checked_at": self._iso_now(),
            }
        except Exception as exc:
            return {
                "visible": False,
                "options": [],
                "checked_at": self._iso_now(),
                "error": str(exc)[:160],
            }

    async def _verify_douyin_creator_session(self, page) -> dict[str, Any]:
        """在当前 BrowserContext 内验证抖音创作者账号接口，不暴露响应正文。"""
        if self.platform != "douyin":
            return {"valid": True, "reason": "not douyin"}
        try:
            result = await self._evaluate_with_timeout(
                page,
                """async () => {
                  const endpoints = [
                    '/aweme/v1/creator/pc/user/info/',
                    '/aweme/v1/creator/user/info/',
                    '/web/api/media/user/info/'
                  ];
                  const findAccountSignal = (value, depth = 0) => {
                    if (!value || depth > 5) return false;
                    if (Array.isArray(value)) return value.some(v => findAccountSignal(v, depth + 1));
                    if (typeof value !== 'object') return false;
                    const keys = Object.keys(value);
                    if (keys.some(k => ['uid','user_id','sec_uid','nickname','nick_name','unique_id','douyin_unique_id'].includes(k)
                      && value[k] !== null && value[k] !== undefined && String(value[k]).length > 0)) return true;
                    if (keys.some(k => ['douyin_user_verify_info','user_info','creator_info'].includes(k)
                      && value[k] && typeof value[k] === 'object')) return true;
                    return Object.values(value).some(v => findAccountSignal(v, depth + 1));
                  };
                  const attempts = [];
                  for (const endpoint of endpoints) {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 8000);
                    try {
                      const response = await fetch(endpoint, {
                        credentials: 'include',
                        headers: {'accept': 'application/json, text/plain, */*'},
                        signal: controller.signal
                      });
                      const contentType = response.headers.get('content-type') || '';
                      let payload = null;
                      if (contentType.includes('json')) {
                        try { payload = await response.json(); } catch (_) {}
                      } else {
                        const text = await response.text();
                        try { payload = JSON.parse(text); } catch (_) {}
                      }
                      const businessCode = payload && typeof payload === 'object'
                        ? (payload.status_code ?? payload.error_code ?? payload.code ?? null)
                        : null;
                      const businessOk = businessCode === null || businessCode === 0 || businessCode === '0';
                      const loginRedirect = response.redirected && /login|passport/i.test(response.url);
                      const accountSignal = findAccountSignal(payload);
                      const item = {
                        endpoint,
                        httpStatus: response.status,
                        businessCode,
                        redirected: response.redirected,
                        finalPath: (() => { try { return new URL(response.url).pathname; } catch (_) { return ''; } })(),
                        accountSignal,
                        valid: response.ok && businessOk && !loginRedirect && accountSignal
                      };
                      attempts.push(item);
                      if (item.valid) return {valid: true, attempt: item, attempts};
                    } catch (error) {
                      attempts.push({endpoint, error: String(error).slice(0, 160), valid: false});
                    } finally {
                      clearTimeout(timer);
                    }
                  }
                  return {valid: false, attempts};
                }""",
                timeout=30,
            )
            valid = bool((result or {}).get("valid"))
            attempts = (result or {}).get("attempts") or []
            safe_result = {
                "valid": valid,
                "checked_at": self._iso_now(),
                "attempts": attempts,
                "reason": (
                    "creator account API verified"
                    if valid
                    else "抖音创作者账号接口未返回已登录账号，暂不保存登录态"
                ),
            }
            logger.warning(
                "douyin creator session verification=%s",
                json.dumps(safe_result, ensure_ascii=False, separators=(",", ":")),
            )
            return safe_result
        except Exception as exc:
            return {
                "valid": False,
                "checked_at": self._iso_now(),
                "reason": f"抖音创作者账号接口校验异常: {str(exc)[:160]}",
            }

    async def _extract_user_info(self, page) -> UserInfo:
        """Extract account identity from the logged-in creator page."""
        extra: dict[str, Any] = {"url": page.url}
        try:
            if self.platform == "xiaohongshu":
                data = await page.evaluate(
                    """() => {
                      const parse = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };
                      return parse(localStorage.getItem('USER_INFO_FOR_BIZ'));
                    }"""
                )
                official = await self._official_follower_snapshot(page)
                if "follower_count" not in official:
                    # The publish page does not always issue personal_info
                    # during initial navigation.  This endpoint is an unsigned
                    # same-origin GET, so use the current page/context as a
                    # bounded fallback and return only the verified metric.
                    follower_result = await page.evaluate(
                        """async () => {
                          const controller = new AbortController();
                          const timer = setTimeout(() => controller.abort(), 8000);
                          try {
                            const response = await fetch(
                              '/api/galaxy/creator/home/personal_info',
                              {
                                method: 'GET',
                                credentials: 'include',
                                headers: {accept: 'application/json'},
                                signal: controller.signal
                              }
                            );
                            if (!response.ok) {
                              return {http_ok: false, status: response.status};
                            }
                            const payload = await response.json();
                            return {
                              http_ok: true,
                              status: response.status,
                              code: payload?.code,
                              follower_count: payload?.data?.fans_count
                            };
                          } catch (_) {
                            return {http_ok: false, status: 0};
                          } finally {
                            clearTimeout(timer);
                          }
                        }"""
                    )
                    if (
                        isinstance(follower_result, dict)
                        and follower_result.get("http_ok") is True
                        and str(follower_result.get("code")) == "0"
                    ):
                        follower_count = self._coerce_follower_count(
                            follower_result.get("follower_count")
                        )
                        if follower_count is not None:
                            official["follower_count"] = follower_count
                uid = str(data.get("userId") or "")
                name = data.get("userName")
                avatar = data.get("userAvatar")
                red_id = str(data.get("redId") or "")
                extra.update(
                    {
                        "user_id": uid or None,
                        "red_id": red_id or None,
                        "role": data.get("role"),
                        "zone": data.get("zone"),
                        "real_name_verified": data.get("realNameVerified"),
                    }
                )
                if "follower_count" in official:
                    extra["follower_count"] = official["follower_count"]
                return UserInfo(
                    user_id=uid or None,
                    name=name,
                    username=name,
                    avatar=avatar,
                    extra={k: v for k, v in extra.items() if v not in (None, "")},
                )

            if self.platform == "douyin":
                data = await page.evaluate(
                    """async () => {
                      const getJson = async (url) => {
                        try {
                          const r = await fetch(url, {credentials: 'include'});
                          return await r.json();
                        } catch (e) { return null; }
                      };
                      return {
                        pc: await getJson('/aweme/v1/creator/pc/user/info/'),
                        creator: await getJson('/aweme/v1/creator/user/info/'),
                        media: await getJson('/web/api/media/user/info/'),
                        ls: Object.fromEntries(Object.entries(localStorage)
                          .filter(([k]) => /user|login|douyin|slardar/i.test(k))
                          .slice(0, 40))
                      };
                    }"""
                )
                pc = data.get("pc") or {}
                creator = data.get("creator") or {}
                media = data.get("media") or {}
                verify = creator.get("douyin_user_verify_info") or {}
                media_user = media.get("user") or {}
                avatar_obj = (
                    media_user.get("avatar_thumb")
                    or media_user.get("avatar_medium")
                    or media_user.get("avatar_larger")
                    or {}
                )
                avatar = (
                    verify.get("avatar_url")
                    or ((avatar_obj.get("url_list") or [None])[0])
                )
                uid = str(
                    pc.get("uid") or media_user.get("uid") or creator.get("uid") or ""
                )
                unique_id = str(
                    verify.get("douyin_unique_id")
                    or media_user.get("unique_id")
                    or media_user.get("short_id")
                    or ""
                )
                name = (
                    verify.get("nick_name")
                    or media_user.get("nickname")
                    or media_user.get("nickname_raw")
                )
                follower_count = verify.get("follower_count")
                if follower_count is None:
                    follower_count = media_user.get("follower_count")
                following_count = verify.get("following_count")
                if following_count is None:
                    following_count = media_user.get("following_count")
                extra.update(
                    {
                        "user_id": uid or None,
                        "unique_id": unique_id or None,
                        "douyin_unique_id": unique_id or None,
                        "follower_count": follower_count,
                        "following_count": following_count,
                        "aweme_count": media_user.get("aweme_count"),
                        "login_app": media.get("login_app"),
                    }
                )
                return UserInfo(
                    user_id=uid or None,
                    name=name,
                    username=unique_id or None,
                    avatar=avatar,
                    extra={k: v for k, v in extra.items() if v not in (None, "")},
                )

            if self.platform == "bilibili":
                data = await page.evaluate(
                    """async () => {
                      const getJson = async (url) => {
                        try {
                          const r = await fetch(url, {credentials: 'include'});
                          return await r.json();
                        } catch (e) { return null; }
                      };
                      const nav = await getJson('https://api.bilibili.com/x/web-interface/nav');
                      const mid = nav?.data?.mid;
                      const relation = mid
                        ? await getJson(`https://api.bilibili.com/x/relation/stat?vmid=${encodeURIComponent(mid)}`)
                        : null;
                      return {nav, relation};
                    }"""
                )
                nav_response = (data or {}).get("nav") or {}
                relation_response = (data or {}).get("relation") or {}
                nav = nav_response.get("data") or {}
                relation = relation_response.get("data") or {}
                uid = str(nav.get("mid") or "")
                name = nav.get("uname")
                avatar = nav.get("face")
                level = (nav.get("level_info") or {}).get("current_level")
                follower_count = (
                    relation.get("follower")
                    if relation_response.get("code") == 0
                    else None
                )
                extra.update(
                    {
                        "user_id": uid or None,
                        "mid": uid or None,
                        "follower_count": follower_count,
                        "level": level,
                        "mobile_verified": nav.get("mobile_verified"),
                        "is_login": nav.get("isLogin"),
                        "official": nav.get("official"),
                        "vip": nav.get("vip"),
                    }
                )
                return UserInfo(
                    user_id=uid or None,
                    name=name,
                    username=name,
                    avatar=avatar,
                    extra={k: v for k, v in extra.items() if v not in (None, "")},
                )

            if self.platform == "baijiahao":
                data = await page.evaluate(
                    """async () => {
                      const getJson = async (url) => {
                        try {
                          const response = await fetch(url, {
                            method: 'GET',
                            credentials: 'include',
                            headers: {accept: 'application/json'}
                          });
                          if (!response.ok) {
                            return {http_ok: false, status: response.status, body: null};
                          }
                          return {
                            http_ok: true,
                            status: response.status,
                            body: await response.json()
                          };
                        } catch (e) {
                          return {http_ok: false, status: 0, body: null};
                        }
                      };
                      const home = await getJson('/pcui/home/index');
                      const appinfo = await getJson('/builder/app/appinfo');
                      // Only return the business status and count.  The full
                      // creator responses may contain unrelated account
                      // metadata and must never be retained or logged here.
                      return {
                        home: {
                          http_ok: home.http_ok,
                          status: home.status,
                          errno: home.body?.errno,
                          follower_count: home.body?.data?.coreData?.fansCount
                        },
                        appinfo: {
                          http_ok: appinfo.http_ok,
                          status: appinfo.status,
                          errno: appinfo.body?.errno,
                          follower_count: appinfo.body?.data?.user?.ability?.total_fans
                        }
                      };
                    }"""
                )
                home_result = (data or {}).get("home") or {}
                appinfo_result = (data or {}).get("appinfo") or {}

                follower_count: int | None = None
                if (
                    home_result.get("http_ok") is True
                    and str(home_result.get("errno")) == "0"
                ):
                    follower_count = self._coerce_follower_count(
                        home_result.get("follower_count")
                    )
                if (
                    follower_count is None
                    and appinfo_result.get("http_ok") is True
                    and str(appinfo_result.get("errno")) == "0"
                ):
                    follower_count = self._coerce_follower_count(
                        appinfo_result.get("follower_count")
                    )
                if follower_count is not None:
                    extra["follower_count"] = follower_count
                return UserInfo(
                    user_id=None,
                    name=None,
                    username=None,
                    avatar=None,
                    extra={k: v for k, v in extra.items() if v not in (None, "")},
                )

            if self.platform == "kuaishou":
                data = await page.evaluate(
                    """() => {
                      const lines = (document.body.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean);
                      const bad = [
                        '平台介绍','机构入驻','视频上传','快手创作者服务平台','立即登录',
                        '平台优势','上传视频','平台热点','机构服务','数据统计','内容推广',
                        '功能简介','常见问题','首页','内容管理','互动管理','成长中心',
                        '创作服务','其他服务','遇到问题','创作者服务','登录'
                      ];
                      const name = (lines.find(s =>
                        s.length >= 2 &&
                        s.length <= 40 &&
                        !bad.some(b => s.includes(b)) &&
                        !/^\\d+$/.test(s)
                      ) || '');
                      const imgs = [...document.querySelectorAll('img')].map(img => {
                        const r = img.getBoundingClientRect();
                        return {src: img.src || '', x: r.x, y: r.y, w: r.width, h: r.height};
                      }).filter(x => x.w > 20 && x.h > 20);
                      const avatar = (imgs.find(x => /uhead|avatar|yximgs/.test(x.src)) || {}).src || '';
                      return {name, avatar, text: lines.slice(0, 20)};
                    }"""
                )
                official = await self._official_follower_snapshot(page)
                cookies = await page.context.cookies()
                uid = ""
                for c in cookies:
                    if c.get("name") == "userId" and c.get("value"):
                        uid = str(c.get("value"))
                        break
                extra.update({"user_id": uid or None, "kwai_id": uid or None})
                if "follower_count" in official:
                    extra["follower_count"] = official["follower_count"]
                return UserInfo(
                    user_id=uid or None,
                    name=data.get("name") or None,
                    username=uid or None,
                    avatar=data.get("avatar") or None,
                    extra={k: v for k, v in extra.items() if v not in (None, "")},
                )

            if self.platform == "channels":
                data = await page.evaluate(
                    """() => {
                      const lines = (document.body.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean);
                      const imgs = [...document.querySelectorAll('img')].map(img => {
                        const r = img.getBoundingClientRect();
                        return {src: img.src || '', alt: img.alt || '', x: r.x, y: r.y, w: r.width, h: r.height};
                      }).filter(x => x.w > 20 && x.h > 20);
                      return {lines: lines.slice(0, 40), avatar: (imgs.find(x => /avatar|head|wx|qlogo/i.test(x.src + x.alt)) || {}).src || ''};
                    }"""
                )
                official = await self._official_follower_snapshot(page)
                cookies = await page.context.cookies()
                uid = self._cookie_value_by_name_priority(
                    cookies,
                    ("finder_username", "wxuin", "uin"),
                )
                name = ""
                for line in data.get("lines") or []:
                    if (
                        line
                        and len(line) <= 40
                        and not any(
                            token in line.lower()
                            for token in ("login", "platform", "assistant")
                        )
                    ):
                        name = line
                        break
                stable_uid = str(official.get("user_id") or "").strip()
                user_id = stable_uid or uid
                unique_id = str(official.get("unique_id") or "").strip()
                extra.update(
                    {
                        "user_id": user_id or None,
                        "unique_id": unique_id or None,
                        "identity_source": (
                            "channels_auth_data"
                            if stable_uid
                            else "session_cookie_fallback"
                        ),
                    }
                )
                if "follower_count" in official:
                    extra["follower_count"] = official["follower_count"]
                return UserInfo(
                    user_id=user_id or None,
                    name=official.get("name") or name or None,
                    username=unique_id or user_id or None,
                    avatar=official.get("avatar") or data.get("avatar") or None,
                    extra={k: v for k, v in extra.items() if v not in (None, "")},
                )

        except Exception as e:
            logger.debug("%s extract user info failed: %s", self.platform, e)

        try:
            cookies = await page.context.cookies()
            cookie_names = {
                "bilibili": ("DedeUserID",),
                "douyin": ("uid_tt", "uid_tt_ss"),
                "kuaishou": ("userId",),
                "channels": ("finder_username", "wxuin", "uin"),
                "xiaohongshu": ("x-user-id-creator.xiaohongshu.com",),
            }.get(self.platform, ())
            cookie_uid = self._cookie_value_by_name_priority(cookies, cookie_names)
            if cookie_uid:
                return UserInfo(
                    user_id=cookie_uid,
                    name=None,
                    username=cookie_uid,
                    avatar=None,
                    extra={"url": page.url, "user_id": cookie_uid},
                )
        except Exception:
            pass
        return UserInfo(
            user_id=None, name=None, username=None, avatar=None, extra={"url": page.url}
        )

    async def cleanup_session(self, session_id: str) -> None:
        sess = self._sessions.pop(session_id, None)
        if not sess:
            return
        evidence_task = sess.get("evidence_task")
        if evidence_task and not evidence_task.done():
            evidence_task.cancel()
        maintainer_task = sess.get("qr_maintainer_task")
        if (
            maintainer_task
            and maintainer_task is not asyncio.current_task()
            and not maintainer_task.done()
        ):
            maintainer_task.cancel()
        browser = sess.get("browser")
        if browser is not None:
            await self._close_browser(browser)

    async def validate_cookie(
        self, storage_state: dict, *, include_reload_evidence: bool = True
    ) -> dict:
        """Validate storage_state and return refreshed account metadata."""
        if not storage_state:
            return {"valid": False, "reason": "storage_state is empty"}
        browser = None
        try:
            browser, context = await self._launch_authenticated_browser(storage_state)
            page = await context.new_page()
            # Listen before opening the dashboard.  Kuaishou and Channels use
            # signed POST requests generated by their own frontend, so replaying
            # these endpoints from the service would be both brittle and wrong.
            self._install_official_follower_capture(page)
            # The Channels publish form does not consistently request
            # ``auth_data`` after a stored session is reloaded.  Open the
            # platform dashboard for validation so the official frontend can
            # emit its signed account-summary request; publishing still uses
            # ``self.publish_url`` in the publish workflow.
            test_url = (
                "https://channels.weixin.qq.com/platform"
                if self.platform == "channels"
                else self.publish_url or self.login_url
            )
            if self.platform == "xiaohongshu":
                # Keep validation below the backend client's 120 s deadline.
                # The proven headless+proxy path normally loads much faster,
                # and two bounded attempts still cover a transient reset.
                await self._goto_with_retries(
                    page,
                    test_url,
                    wait_until="domcontentloaded",
                    timeout=30000,
                    max_attempts=2,
                )
            else:
                await self._goto_with_retries(
                    page, test_url, wait_until="domcontentloaded", timeout=60000
                )
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            await asyncio.sleep(
                2 if self.platform in {"douyin", "kuaishou", "bilibili"} else 3
            )
            current = page.url
            creator_check: dict[str, Any] | None = None
            strong_cookie_names: list[str] = []
            if "login" in current.lower() or "passport" in current.lower():
                return {
                    "valid": False,
                    "reason": "Cookie invalid: redirected to login page",
                    "page_url": current,
                }
            if self.platform == "douyin":
                cookies = await context.cookies()
                strong_names = PLATFORM_AUTH_COOKIE_NAMES["douyin"]
                strong_cookie_names = sorted(
                    {
                        str(cookie.get("name"))
                        for cookie in cookies
                        if cookie.get("name") in strong_names and cookie.get("value")
                    }
                )
                if not strong_cookie_names:
                    return {
                        "valid": False,
                        "reason": "storage_state 重载后缺少抖音强认证 Cookie",
                        "page_url": current,
                    }
                creator_check = await self._verify_douyin_creator_session(page)
                if not creator_check.get("valid"):
                    return {
                        "valid": False,
                        "reason": creator_check.get("reason")
                        or "storage_state 重载后创作者账号接口未通过",
                        "page_url": current,
                        "creator_check": creator_check,
                    }
            try:
                body_text = await page.locator("body").inner_text(timeout=8000)
            except Exception:
                body_text = ""
            restriction_reason = self._account_restriction_reason(body_text)
            if restriction_reason:
                return {
                    "valid": False,
                    "status": "account_restricted",
                    "reason": restriction_reason,
                    "page_url": current,
                }
            try:
                file_inputs = await page.locator('input[type="file"]').count()
            except Exception:
                file_inputs = 0
            if self.platform == "kuaishou":
                logged_out_landing = (
                    "立即登录" in body_text
                    or ("快手创作者服务平台" in body_text and file_inputs == 0)
                    or (
                        "平台介绍" in body_text
                        and "视频上传" in body_text
                        and file_inputs == 0
                    )
                )
                if logged_out_landing:
                    return {
                        "valid": False,
                        "reason": "Cookie invalid: Kuaishou publish page shows login/landing page",
                        "page_url": current,
                    }
            user_info = await self._extract_user_info(page)
            refreshed_state = await context.storage_state()
            result = {
                "valid": True,
                "reason": (
                    "storage_state 已在新 Chromium 中重载，强认证 Cookie 与创作者账号接口有效"
                    if self.platform == "douyin"
                    else "Cookie valid"
                ),
                "page_url": current,
                "user_info": {
                    "user_id": user_info.user_id,
                    "name": user_info.name,
                    "username": user_info.username,
                    "avatar": user_info.avatar,
                    "extra": user_info.extra or {},
                },
                "storage_state": refreshed_state,
                "creator_check": creator_check,
            }
            if include_reload_evidence:
                result["reload_evidence"] = {
                    "fingerprint": await self._browser_fingerprint(page),
                    "egress": await self._egress_evidence(context),
                    "strong_cookie_names": strong_cookie_names,
                }
            return result
        except Exception as e:
            # A browser/page/network failure is not proof that the stored
            # platform login has expired.  Surface it as transient so callers
            # preserve the last trusted account status.
            return {
                "valid": False,
                "transient": True,
                "reason": f"validate exception: {e}",
            }
        finally:
            if browser is not None:
                await self._close_browser(browser)

    def _account_restriction_reason(self, body_text: str | None) -> str | None:
        """Return a customer-readable reason when the creator account is restricted."""
        if self.platform != "kuaishou":
            return None
        text = re.sub(r"\s+", "", body_text or "")
        restricted_markers = (
            "账号已被封禁",
            "账号因违规操作已受到限制",
            "无法访问创作者中心",
            "账号被永久封禁",
            "创作者中心功能受限",
        )
        if any(marker in text for marker in restricted_markers):
            return "快手账号已被封禁或限制使用，当前无法访问创作者中心，请在快手 App 查看封禁原因并申诉。"
        return None

    async def publish_content(
        self,
        storage_state: dict,
        title: str,
        description: str,
        tags: list[str] | None = None,
        media_paths: list[str] | None = None,
        cover_path: str | None = None,
        publish_mode: str = "direct",  # direct|schedule
        scheduled_at: str | None = None,
        account_id: str | None = None,
        publish_params: dict | None = None,
    ) -> dict:
        """真实发布流程：打开发布页 -> 填写标题/正文 -> 上传素材 -> 点击发布按钮 -> 等待发布成功。

        各平台 DOM 不同，使用 _PLATFORM_*_SELECTORS 中配置的选择器。
        发布成功判定：URL 跳转到管理页 / 成功页（_PLATFORM_SUCCESS_URL_PATTERNS）。
        全程按关键步骤截图留痕（screenshots），成功时尽力解析 external_post_id。
        """
        if not self.publish_url:
            return {
                "success": False,
                "status": "no_publish_url",
                "error": f"平台 {self.platform} 未配置发布页 URL",
            }

        run_id = f"{(account_id or 'anon')}_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        run_dir = self._run_screenshot_dir(run_id)
        shots: list[str] = []
        browser, context = await self._launch_authenticated_browser(storage_state)
        try:
            page = await context.new_page()
            await page.goto(
                self.publish_url, wait_until="domcontentloaded", timeout=30000
            )
            await self._wait_for_publish_page_ready(page)
            await asyncio.wait_for(self._dismiss_popups(page), timeout=12)
            await self._screenshot_step(page, run_dir, "01_opened", shots)

            # 若一进发布页就被重定向到登录页，说明 cookie 已失效
            if "login" in page.url.lower() or "passport" in page.url.lower():
                await self._screenshot_step(page, run_dir, "cookie_invalid", shots)
                return {
                    "success": False,
                    "status": "cookie_invalid",
                    "error": "发布页被重定向到登录页，Cookie 已失效，请重新扫码登录",
                    "page_url": page.url,
                    "screenshots": shots,
                }

            # 1. 上传文件（如果有）- 必须先上传，多数平台标题/正文在上传后才出现
            if media_paths:
                logger.info(
                    "%s 开始上传素材 media_count=%d", self.platform, len(media_paths)
                )
                await asyncio.wait_for(
                    self._upload_files(page, media_paths), timeout=90
                )
                logger.info("%s 素材已提交到上传控件，等待平台处理完成", self.platform)
                # 等待上传完成（视频上传较慢，最多等 120 秒）
                await asyncio.wait_for(
                    self._wait_for_upload_complete(page), timeout=240
                )
                logger.info("%s 平台上传处理等待结束", self.platform)
                await asyncio.wait_for(self._dismiss_popups(page), timeout=12)
                await self._screenshot_step(page, run_dir, "02_uploaded", shots)
                logger.info("%s 上传后截图完成", self.platform)

            # 2/3. 填写标题 + 正文/描述。
            # 快手视频发布页当前只有“作品描述”一个主输入框，没有独立标题框；
            # 把标题合并到描述首行，避免标题丢失和无意义的“未找到标题输入框”告警。
            body_text = description
            if self.platform == "kuaishou":
                body_text = "\n".join(part for part in (title, description) if part)
            else:
                await asyncio.wait_for(self._fill_title(page, title), timeout=25)

            if body_text:
                await asyncio.wait_for(self._fill_body(page, body_text), timeout=25)

            # 4. 填写标签/话题（如果提供）
            if tags:
                await self._fill_tags(page, tags)

            # 5. 设置封面（如果提供）
            if cover_path:
                await self._set_cover(page, cover_path)
            elif self.platform == "bilibili":
                await self._ensure_bilibili_cover_selected(page)
            await asyncio.wait_for(
                self._apply_publish_params(page, publish_params or {}), timeout=35
            )
            await self._screenshot_step(page, run_dir, "03_filled", shots)
            logger.info("%s 填写发布参数后截图完成", self.platform)

            # 6. 点击发布按钮（真实点击，不再只是 filled）
            await asyncio.wait_for(self._dismiss_popups(page), timeout=12)
            click_result = await asyncio.wait_for(
                self._click_publish_button(page), timeout=25
            )
            if not click_result["clicked"]:
                await self._screenshot_step(
                    page, run_dir, "publish_button_not_found", shots
                )
                return {
                    "success": False,
                    "status": "publish_button_not_found",
                    "error": click_result.get("error", "未找到发布按钮"),
                    "page_url": page.url,
                    "screenshots": shots,
                }

            # 7. 等待发布成功（URL 跳转）
            success = await asyncio.wait_for(
                self._wait_for_publish_success(page), timeout=90
            )
            await self._screenshot_step(page, run_dir, "04_result", shots)
            if success:
                if self.platform == "kuaishou":
                    try:
                        await self._goto_with_retries(
                            page,
                            "https://cp.kuaishou.com/article/manage/video?status=0&from=publish",
                            wait_until="domcontentloaded",
                            timeout=60000,
                        )
                        await asyncio.sleep(5)
                        await self._screenshot_step(
                            page, run_dir, "05_manage_verified", shots
                        )
                        manage_text = await page.locator("body").inner_text(
                            timeout=10000
                        )
                        restriction_reason = self._account_restriction_reason(
                            manage_text
                        )
                        if restriction_reason:
                            return {
                                "success": False,
                                "status": "account_restricted",
                                "error": restriction_reason,
                                "page_url": page.url,
                                "screenshots": shots,
                            }
                    except Exception as exc:
                        logger.warning("kuaishou 发布后管理页复核失败: %s", exc)
                resolved_url = await self._resolve_post_url_after_publish(
                    page, title=title
                )
                publish_url = resolved_url or page.url
                external_post_id = self._extract_post_id(
                    publish_url
                ) or self._extract_post_id(page.url)
                return {
                    "success": True,
                    "status": "published",
                    "message": f"已成功发布到 {self.platform_name}",
                    "publish_url": publish_url,
                    "page_url": page.url,
                    "external_post_id": external_post_id,
                    "screenshots": shots,
                }
            # 发布按钮点击了但没有跳转到成功页 - 可能是定时发布或需要二次确认
            return {
                "success": False,
                "status": "publish_unknown",
                "error": "已点击发布按钮，但未检测到成功跳转（可能是定时发布或需要二次确认）",
                "page_url": page.url,
                "screenshots": shots,
            }
        except Exception as e:
            logger.exception("发布到 %s 失败", self.platform)
            try:
                if "page" in dir() and page and not page.is_closed():
                    await self._screenshot_step(page, run_dir, "error", shots)
            except Exception:
                pass
            return {
                "success": False,
                "status": "publish_error",
                "error": str(e),
                "screenshots": shots,
            }
        finally:
            await self._close_browser(browser)

    def _manage_url_candidates(
        self, publish_url: str | None, external_post_id: str | None
    ) -> list[str]:
        urls: list[str] = []

        def add(url: str | None) -> None:
            if url and url not in urls:
                urls.append(url)

        if self.platform == "xiaohongshu":
            add("https://creator.xiaohongshu.com/new/note-manager")
            add("https://creator.xiaohongshu.com/creator/notes")
        elif self.platform == "douyin":
            add("https://creator.douyin.com/creator-micro/content/manage")
        elif self.platform == "bilibili":
            add("https://member.bilibili.com/platform/upload-manager/article")
            add("https://member.bilibili.com/platform/upload-manager")
        elif self.platform == "kuaishou":
            add("https://cp.kuaishou.com/article/manage")

        add(publish_url)
        add(self._canonical_content_url(external_post_id))
        return urls

    async def delete_published_content(
        self,
        storage_state: dict,
        publish_url: str | None = None,
        external_post_id: str | None = None,
        title: str | None = None,
        account_id: str | None = None,
    ) -> dict:
        """Best-effort delete/unpublish a post from the platform creator UI."""
        run_id = (
            f"delete_{(account_id or 'anon')}_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        )
        run_dir = self._run_screenshot_dir(run_id)
        shots: list[str] = []
        browser, context = await self._launch_authenticated_browser(storage_state)
        try:
            page = await context.new_page()
            for url in self._manage_url_candidates(publish_url, external_post_id):
                try:
                    await self._goto_with_retries(
                        page, url, wait_until="domcontentloaded", timeout=45000
                    )
                    await asyncio.sleep(2)
                    await self._dismiss_popups(page)
                    await self._screenshot_step(page, run_dir, "opened", shots)
                    if "login" in page.url.lower() or "passport" in page.url.lower():
                        return {
                            "success": False,
                            "status": "cookie_invalid",
                            "error": "删除内容时被重定向到登录页，Cookie 已失效",
                            "page_url": page.url,
                            "screenshots": shots,
                        }
                    clicked = await self._click_scoped_action(
                        page,
                        labels=["删除", "下架", "移除"],
                        title=title,
                        external_post_id=external_post_id,
                        publish_url=publish_url,
                        pre_open_labels=["更多", "操作", "...", "···"],
                    )
                    if clicked:
                        await asyncio.sleep(0.8)
                        await self._confirm_dialog(
                            page,
                            [
                                "确认删除",
                                "确定删除",
                                "仍要删除",
                                "删除",
                                "确认",
                                "确定",
                            ],
                        )
                        await asyncio.sleep(2)
                        await self._screenshot_step(page, run_dir, "deleted", shots)
                        return {
                            "success": True,
                            "status": "deleted",
                            "message": "平台内容删除/下架操作已提交",
                            "page_url": page.url,
                            "screenshots": shots,
                        }
                except Exception as exc:
                    logger.warning(
                        "%s delete attempt failed url=%s: %s", self.platform, url, exc
                    )
                    continue
            return {
                "success": False,
                "status": "remote_action_failed",
                "error": "未在平台管理页找到匹配内容的删除/下架按钮",
                "screenshots": shots,
            }
        finally:
            await self._close_browser(browser)

    async def update_published_visibility(
        self,
        storage_state: dict,
        visibility: str,
        publish_url: str | None = None,
        external_post_id: str | None = None,
        title: str | None = None,
        account_id: str | None = None,
    ) -> dict:
        """Best-effort adjust visibility for an already published post."""
        visibility = (visibility or "public").strip()
        if self.platform == "bilibili" and visibility != "public":
            return {
                "success": False,
                "status": "unsupported",
                "error": "B站网页视频发布/管理页未提供稳定的“仅自己可见”选项，请按公开内容处理。",
            }

        run_id = f"visibility_{(account_id or 'anon')}_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        run_dir = self._run_screenshot_dir(run_id)
        shots: list[str] = []
        browser, context = await self._launch_authenticated_browser(storage_state)
        try:
            page = await context.new_page()
            for url in self._manage_url_candidates(publish_url, external_post_id):
                try:
                    await self._goto_with_retries(
                        page, url, wait_until="domcontentloaded", timeout=45000
                    )
                    await asyncio.sleep(2)
                    await self._dismiss_popups(page)
                    await self._screenshot_step(page, run_dir, "opened", shots)
                    if "login" in page.url.lower() or "passport" in page.url.lower():
                        return {
                            "success": False,
                            "status": "cookie_invalid",
                            "error": "修改可见性时被重定向到登录页，Cookie 已失效",
                            "page_url": page.url,
                            "screenshots": shots,
                        }

                    await self._click_scoped_action(
                        page,
                        labels=["编辑", "修改", "管理"],
                        title=title,
                        external_post_id=external_post_id,
                        publish_url=publish_url,
                        pre_open_labels=["更多", "操作", "...", "···"],
                        required=False,
                    )
                    await asyncio.sleep(2)
                    applied = await self._apply_visibility(page, visibility)
                    if not applied and visibility != "public":
                        continue
                    saved = await self._click_scoped_action(
                        page,
                        labels=["保存", "更新", "提交", "确认修改", "发布"],
                        title=None,
                        external_post_id=None,
                        publish_url=None,
                        pre_open_labels=[],
                        required=False,
                        allow_global=True,
                    )
                    if saved:
                        await asyncio.sleep(2)
                    await self._screenshot_step(
                        page, run_dir, "visibility_updated", shots
                    )
                    return {
                        "success": True,
                        "status": "visibility_updated",
                        "message": f"平台内容可见性已尝试调整为 {visibility}",
                        "page_url": page.url,
                        "screenshots": shots,
                    }
                except Exception as exc:
                    logger.warning(
                        "%s visibility attempt failed url=%s: %s",
                        self.platform,
                        url,
                        exc,
                    )
                    continue
            return {
                "success": False,
                "status": "remote_action_failed",
                "error": f"未在平台管理页找到匹配内容，无法调整可见性为 {visibility}",
                "screenshots": shots,
            }
        finally:
            await self._close_browser(browser)

    async def _confirm_dialog(self, page, labels: list[str]) -> bool:
        try:
            clicked = await self._evaluate_with_timeout(
                page,
                """(labels) => {
                  const visible = (el) => {
                    const r = el.getBoundingClientRect();
                    const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                  };
                  const norm = (s) => String(s || '').trim().replace(/\\s+/g, '');
                  for (const el of document.querySelectorAll('button,[role="button"],span,div')) {
                    if (!visible(el)) continue;
                    const text = norm(el.innerText || el.textContent || '');
                    if (labels.some(label => text === norm(label) || text.includes(norm(label)))) {
                      (el.closest('button,[role="button"]') || el).click();
                      return true;
                    }
                  }
                  return false;
                }""",
                labels,
                timeout=8,
            )
            return bool(clicked)
        except Exception:
            return False

    async def _click_scoped_action(
        self,
        page,
        labels: list[str],
        title: str | None,
        external_post_id: str | None,
        publish_url: str | None,
        pre_open_labels: list[str] | None = None,
        required: bool = True,
        allow_global: bool = False,
    ) -> bool:
        """Click an action button either inside a matched content row or globally.

        Destructive actions are scoped by title/id/link whenever possible to
        avoid touching the wrong post in a management list.
        """
        target = {
            "labels": labels,
            "title": title or "",
            "id": external_post_id or "",
            "url": publish_url or "",
            "allowGlobal": allow_global,
        }
        opener_target = dict(target)
        opener_target["labels"] = pre_open_labels or []
        for attempt in range(3):
            clicked = await self._evaluate_with_timeout(
                page,
                """(target) => {
                  const visible = (el) => {
                    const r = el.getBoundingClientRect();
                    const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                  };
                  const norm = (s) => String(s || '').trim().replace(/\\s+/g, '').toLowerCase();
                  const labels = (target.labels || []).map(norm);
                  const title = norm(target.title || '');
                  const id = norm(target.id || '');
                  const url = String(target.url || '');
                  const currentIsTarget = id && location.href.includes(id);
                  const matches = (el) => {
                    const text = norm(el.innerText || el.textContent || '');
                    const href = String(el.href || el.getAttribute?.('href') || '');
                    if (title && text.includes(title.slice(0, Math.min(24, title.length)))) return true;
                    if (id && (text.includes(id) || href.includes(id))) return true;
                    if (url && href && url.includes(href)) return true;
                    return false;
                  };
                  let scopes = [];
                  if (currentIsTarget || target.allowGlobal) scopes.push(document.body);
                  for (const el of document.querySelectorAll('a,tr,li,[class*="item"],[class*="card"],[class*="row"],div')) {
                    if (!visible(el)) continue;
                    if (!matches(el)) continue;
                    scopes.push(el.closest('tr,li,[class*="item"],[class*="card"],[class*="row"]') || el);
                  }
                  scopes = [...new Set(scopes)];
                  if (!scopes.length && !target.allowGlobal) return false;
                  if (!scopes.length) scopes = [document.body];
                  const isAction = (el) => {
                    const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '');
                    return labels.some(label => text === label || text.includes(label));
                  };
                  for (const scope of scopes) {
                    const candidates = [...scope.querySelectorAll('button,[role="button"],a,span,div')].filter(visible).filter(isAction);
                    candidates.sort((a, b) => {
                      const ra = a.getBoundingClientRect();
                      const rb = b.getBoundingClientRect();
                      return (rb.x + rb.y) - (ra.x + ra.y);
                    });
                    if (candidates.length) {
                      (candidates[0].closest('button,[role="button"],a') || candidates[0]).click();
                      return true;
                    }
                  }
                  return false;
                }""",
                target,
                timeout=8,
            )
            if clicked:
                return True
            if attempt == 0 and opener_target["labels"]:
                opened = await self._evaluate_with_timeout(
                    page,
                    """(target) => {
                      const visible = (el) => {
                        const r = el.getBoundingClientRect();
                        const s = getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                      };
                      const norm = (s) => String(s || '').trim().replace(/\\s+/g, '').toLowerCase();
                      const labels = (target.labels || []).map(norm);
                      const title = norm(target.title || '');
                      const id = norm(target.id || '');
                      const scopes = [];
                      for (const el of document.querySelectorAll('a,tr,li,[class*="item"],[class*="card"],[class*="row"],div')) {
                        if (!visible(el)) continue;
                        const text = norm(el.innerText || el.textContent || '');
                        const href = String(el.href || el.getAttribute?.('href') || '');
                        if ((title && text.includes(title.slice(0, Math.min(24, title.length)))) || (id && (text.includes(id) || href.includes(id)))) {
                          scopes.push(el.closest('tr,li,[class*="item"],[class*="card"],[class*="row"]') || el);
                        }
                      }
                      for (const scope of scopes) {
                        for (const el of scope.querySelectorAll('button,[role="button"],a,span,div')) {
                          if (!visible(el)) continue;
                          const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '');
                          if (labels.some(label => text === label || text.includes(label))) {
                            (el.closest('button,[role="button"],a') || el).click();
                            return true;
                          }
                        }
                      }
                      return false;
                    }""",
                    opener_target,
                    timeout=8,
                )
                if opened:
                    await asyncio.sleep(1)
        if required:
            logger.info(
                "%s scoped action not found labels=%s title=%s id=%s",
                self.platform,
                labels,
                title,
                external_post_id,
            )
        return False

    async def _dismiss_popups(self, page) -> None:
        """Best-effort close onboarding/popover overlays that block publish buttons."""
        for text in ("我知道了", "知道了", "确定", "确认", "跳过", "稍后再说", "暂不"):
            try:
                loc = page.get_by_text(text, exact=False).first
                if await loc.count() > 0 and await loc.is_visible(timeout=500):
                    await loc.click(timeout=1200)
                    await asyncio.sleep(0.4)
            except Exception:
                continue
        try:
            await self._evaluate_with_timeout(
                page,
                """() => {
                  const selectors = [
                    '[aria-label="Skip"]', '[aria-label="Close"]',
                    '.semi-modal-close', '.ant-modal-close', '.el-dialog__headerbtn',
                    '[class*="close"]', '[class*="Close"]'
                  ];
                  for (const sel of selectors) {
                    for (const el of document.querySelectorAll(sel)) {
                      const r = el.getBoundingClientRect();
                      if (r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x < innerWidth && r.y < innerHeight) {
                        el.click();
                        return true;
                      }
                    }
                  }
                  return false;
                }""",
                timeout=5,
            )
            await asyncio.sleep(0.3)
        except Exception:
            pass

    async def _wait_for_publish_page_ready(self, page, timeout: int = 90) -> None:
        """Wait until a publish page is interactive before uploading/filling.

        Some creator centers (especially Douyin) can report domcontentloaded while
        the actual upload workspace is still a full-page spinner. Continuing at
        that point produced false "uploaded" screenshots and all later selectors
        matched nothing.  This guard waits for a real upload/input/editor signal
        or at least for the generic loading text/spinner to disappear.
        """
        deadline = time.time() + timeout
        ready_selectors = [
            'input[type="file"]',
            "textarea",
            'input[placeholder*="标题"]',
            '[contenteditable="true"]',
            'button:has-text("发布")',
            'button:has-text("立即投稿")',
            "xhs-publish-btn",
        ]
        while time.time() < deadline:
            try:
                for sel in ready_selectors:
                    loc = page.locator(sel).first
                    if await loc.count() > 0:
                        # file inputs are normally hidden, so visibility is not
                        # required for them. Other controls should exist in DOM.
                        await asyncio.sleep(1.0)
                        return
            except Exception:
                pass
            try:
                body_text = await page.locator("body").inner_text(timeout=2500)
            except Exception:
                body_text = ""
            if self._publish_page_body_is_ready(body_text):
                await asyncio.sleep(1.0)
                return
            await asyncio.sleep(1.5)
        raise RuntimeError(
            f"{self.platform_name or self.platform} 发布页面加载超时，请稍后重试"
        )

    def _publish_page_body_is_ready(self, body_text: str | None) -> bool:
        """Do not mistake a creator-center shell for a loaded publish workspace."""
        text = body_text or ""
        if self.platform == "kuaishou":
            return "拖拽视频到此或点击上传" in text
        return bool(
            text and not re.search(r"(加载中|正在加载|Loading|请稍候)", text, re.I)
        )

    async def _fill_control_text(self, locator, text: str) -> bool:
        """Fill native inputs and custom contenteditable editors robustly."""
        try:
            await locator.scroll_into_view_if_needed(timeout=3000)
        except Exception:
            pass
        try:
            await locator.click(timeout=3000)
        except Exception:
            pass
        try:
            await locator.fill(text, timeout=5000, force=True)
            return True
        except Exception:
            pass
        try:
            await locator.press("Control+A", timeout=1500)
            await locator.press("Backspace", timeout=1500)
            await locator.type(text, delay=8, timeout=15000)
            return True
        except Exception:
            pass
        try:
            await locator.evaluate(
                """(el, value) => {
                  const proto = el.tagName === 'TEXTAREA'
                    ? HTMLTextAreaElement.prototype
                    : (el.tagName === 'INPUT' ? HTMLInputElement.prototype : null);
                  if (proto) {
                    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                    if (setter) setter.call(el, value); else el.value = value;
                  } else {
                    el.focus();
                    el.textContent = value;
                    el.innerText = value;
                  }
                  el.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: value}));
                  el.dispatchEvent(new Event('change', {bubbles: true}));
                }""",
                text,
            )
            return True
        except Exception:
            return False

    async def _upload_files(self, page, media_paths: list[str]) -> None:
        """上传媒体文件。"""
        await self._prepare_upload_mode(page, media_paths)
        if self.platform == "douyin":
            if await self._upload_douyin_files(page, media_paths):
                return
        selectors = _PLATFORM_FILE_INPUT_SELECTORS.get(
            self.platform, ['input[type="file"]']
        )
        for sel in selectors:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0:
                    await loc.set_input_files(media_paths, timeout=30000)
                    logger.info(
                        "%s 已向上传控件提交文件 selector=%s", self.platform, sel
                    )
                    await asyncio.sleep(2)
                    return
            except Exception:
                continue
        # 回退：找所有 file input
        try:
            loc = page.locator('input[type="file"]').first
            if await loc.count() > 0:
                await loc.set_input_files(media_paths, timeout=30000)
                logger.info(
                    "%s 已向上传控件提交文件 selector=input[type=file] fallback",
                    self.platform,
                )
                await asyncio.sleep(2)
                return
        except Exception as e:
            logger.warning("%s 上传文件失败: %s", self.platform, e)
        raise RuntimeError(
            f"{self.platform} 未找到文件上传入口，素材未上传，已中止发布"
        )

    async def _upload_douyin_files(self, page, media_paths: list[str]) -> bool:
        """Upload Douyin media through the visible upload button when possible.

        Douyin currently renders multiple hidden file inputs. The first matching
        ``input[type=file][accept*=video]`` can belong to a menu/preload node and
        accepts ``set_input_files`` without actually moving the page into the
        editor. Prefer the real file chooser opened by the central upload button;
        if that is not available, use the last matching file input (the one
        closest to the active upload panel in current DOM order).
        """
        click_selectors = [
            'button:has-text("点击上传")',
            'button:has-text("上传视频")',
            'button:has-text("选择视频")',
            '[role="button"]:has-text("点击上传")',
            '[role="button"]:has-text("上传视频")',
            '[class*="upload"]:has-text("点击上传")',
            '[class*="upload"]:has-text("上传视频")',
        ]
        for sel in click_selectors:
            try:
                loc = page.locator(sel).last
                if await loc.count() <= 0:
                    continue
                async with page.expect_file_chooser(timeout=8000) as chooser_info:
                    await loc.click(timeout=8000)
                chooser = await chooser_info.value
                await chooser.set_files(media_paths)
                logger.info(
                    "%s 已通过文件选择器提交素材 selector=%s", self.platform, sel
                )
                await asyncio.sleep(2)
                return True
            except Exception as e:
                logger.debug(
                    "%s 文件选择器上传尝试失败 selector=%s error=%s",
                    self.platform,
                    sel,
                    e,
                )

        selectors = ['input[type="file"][accept*="video"]', 'input[type="file"]']
        for sel in selectors:
            try:
                loc = page.locator(sel)
                count = await loc.count()
                if count <= 0:
                    continue
                # Prefer the active panel input at the end of DOM order.
                await loc.nth(count - 1).set_input_files(media_paths, timeout=30000)
                logger.info(
                    "%s 已向上传控件提交文件 selector=%s nth=%d",
                    self.platform,
                    sel,
                    count - 1,
                )
                await asyncio.sleep(2)
                return True
            except Exception as e:
                logger.debug(
                    "%s 末尾上传控件提交失败 selector=%s error=%s",
                    self.platform,
                    sel,
                    e,
                )
        return False

    async def _prepare_upload_mode(self, page, media_paths: list[str]) -> None:
        """Switch platform upload tabs before selecting files when needed."""
        if not media_paths:
            return
        first = str(media_paths[0]).lower().split("?", 1)[0]
        is_image = first.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))
        if self.platform == "xiaohongshu" and is_image:
            try:
                clicked = await page.evaluate(
                    """(needle) => {
                      const nodes = [...document.querySelectorAll('.creator-tab')].filter(el => {
                        const text = (el.innerText || el.textContent || '').trim();
                        if (!text.includes(needle)) return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0;
                      });
                      const node = nodes[nodes.length - 1];
                      if (node) { node.click(); return true; }
                      return false;
                    }""",
                    "上传图文",
                )
                if clicked:
                    await asyncio.sleep(1.2)
            except Exception as e:
                logger.debug("%s 切换上传图文失败: %s", self.platform, e)

    async def _wait_for_upload_complete(self, page, timeout: int = 120) -> None:
        """等待上传完成。通用策略：等待上传进度条消失或上传成功提示出现。"""
        try:
            # 等待上传进度条消失（多数平台用 .upload-progress 或 [class*="progress"]）
            progress_selectors = [
                ".upload-progress",
                '[class*="upload-progress"]',
                '[class*="progress-bar"]',
            ]
            for sel in progress_selectors:
                try:
                    loc = page.locator(sel).first
                    if await loc.count() > 0:
                        # 等待进度条消失（最多 timeout 秒）
                        await loc.wait_for(state="hidden", timeout=timeout * 1000)
                        break
                except Exception:
                    continue
            # DOM/text fallback: 抖音等平台的上传进度不一定使用 progress-bar 类名。
            # 如果页面仍显示“上传中 / xx% / 处理中”，继续等待，避免上传未完成就点发布。
            deadline = time.time() + max(timeout, 180)
            while time.time() < deadline:
                try:
                    body_text = await page.locator("body").inner_text(timeout=3000)
                except Exception:
                    body_text = ""
                uploading = bool(
                    re.search(
                        r"(上传中|上传进度|正在上传|处理中|转码中|审核中|\b\d{1,2}%)",
                        body_text,
                    )
                )
                if not uploading:
                    break
                await asyncio.sleep(2)
            # 额外等待确保上传后 DOM 稳定
            if self.platform == "douyin":
                ready = await self._wait_for_douyin_editor_ready(
                    page, timeout=max(timeout, 180)
                )
                if not ready:
                    await self._log_douyin_upload_state(page)
                    raise RuntimeError(
                        "抖音素材提交后未进入标题/描述/发布设置编辑页，可能素材未被平台接受或上传控件选择错误。"
                    )
            await asyncio.sleep(2)
        except Exception:
            if self.platform == "douyin":
                raise
            # 超时不一定失败，可能是该平台没有进度条 UI
            await asyncio.sleep(3)

    async def _wait_for_douyin_editor_ready(self, page, timeout: int = 180) -> bool:
        """Douyin-specific post-upload guard.

        The initial upload page contains a file input immediately, so generic
        "input exists" checks can return before the selected video has actually
        moved into the editor.  Publishing before this point loses the title,
        description and visibility settings.  Wait until the real editor fields
        and publish settings are present.
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                ready = await self._evaluate_with_timeout(
                    page,
                    """() => {
                      const hasTitle = [...document.querySelectorAll('input')]
                        .some(i => (i.placeholder || '').includes('标题'));
                      const hasEditor = !!document.querySelector('.zone-container[contenteditable="true"], .editor-comp-publish[contenteditable="true"], [contenteditable="true"]');
                      const body = (document.body.innerText || document.body.textContent || '').replace(/\\s+/g, '');
                      const hasVisibility = body.includes('谁可以看') && body.includes('仅自己可见');
                      return hasTitle || (hasEditor && hasVisibility);
                    }""",
                    timeout=6,
                )
                if ready:
                    logger.info("%s 上传后已进入编辑页", self.platform)
                    return True
            except Exception as e:
                logger.debug("%s 等待抖音编辑页脚本失败: %s", self.platform, e)
            await asyncio.sleep(2)
        return False

    async def _log_douyin_upload_state(self, page) -> None:
        """Log a compact page snapshot when Douyin upload never reaches editor."""
        try:
            state = await self._evaluate_with_timeout(
                page,
                """() => {
                  const body = (document.body.innerText || document.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 500);
                  const inputs = [...document.querySelectorAll('input')].slice(0, 12).map((i, idx) => ({
                    idx,
                    type: i.type || '',
                    accept: i.accept || '',
                    placeholder: i.placeholder || '',
                    value: i.value || ''
                  }));
                  const fileInputs = [...document.querySelectorAll('input[type="file"]')].map((i, idx) => ({
                    idx,
                    accept: i.accept || '',
                    files: i.files ? i.files.length : 0
                  }));
                  return {url: location.href, body, inputs, fileInputs};
                }""",
                timeout=6,
            )
            logger.warning(
                "%s 上传后仍未进入编辑页 snapshot=%s",
                self.platform,
                json.dumps(state, ensure_ascii=False)[:1800],
            )
        except Exception as e:
            logger.warning("%s 上传后状态快照失败: %s", self.platform, e)

    async def _fill_title(self, page, title: str) -> None:
        """填写标题。"""
        if not title:
            return
        if self.platform == "douyin":
            try:
                ok = await self._evaluate_with_timeout(
                    page,
                    """(value) => {
                      const el = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes('标题'));
                      if (!el) return false;
                      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                      el.focus();
                      if (setter) setter.call(el, value.slice(0, 30)); else el.value = value.slice(0, 30);
                      el.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: value.slice(0, 30)}));
                      el.dispatchEvent(new Event('change', {bubbles: true}));
                      return true;
                    }""",
                    title,
                    timeout=8,
                )
                if ok:
                    logger.info("%s 已填写标题", self.platform)
                    await asyncio.sleep(0.3)
                    return
            except Exception as e:
                logger.debug("%s 抖音标题填写脚本失败: %s", self.platform, e)
        if self.platform == "xiaohongshu":
            for sel in (
                'input.d-text[placeholder*="标题"]',
                'input[placeholder*="标题"]',
                "input.d-text",
            ):
                try:
                    loc = page.locator(sel).first
                    if await loc.count() > 0:
                        if await self._fill_control_text(loc, title[:20]):
                            return
                except Exception:
                    continue
        selectors = _PLATFORM_TITLE_SELECTORS.get(
            self.platform,
            ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', "#title"],
        )
        for sel in selectors:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0:
                    if await self._fill_control_text(loc, title):
                        return
            except Exception:
                continue
        logger.warning("%s 未找到标题输入框", self.platform)

    async def _fill_body(self, page, body: str) -> None:
        """填写正文/描述。"""
        if self.platform == "douyin":
            try:
                ok = await self._evaluate_with_timeout(
                    page,
                    """(value) => {
                      const el = document.querySelector('.zone-container[contenteditable="true"], .editor-comp-publish[contenteditable="true"], [contenteditable="true"]');
                      if (!el) return false;
                      el.scrollIntoView({block: 'center', inline: 'nearest'});
                      el.focus();
                      // Rich editors on Douyin listen to input before change.
                      el.textContent = value;
                      el.innerText = value;
                      el.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: value}));
                      el.dispatchEvent(new Event('change', {bubbles: true}));
                      return true;
                    }""",
                    body,
                    timeout=8,
                )
                if ok:
                    logger.info("%s 已填写正文/描述", self.platform)
                    await asyncio.sleep(0.5)
                    return
            except Exception as e:
                logger.debug("%s 抖音正文填写脚本失败: %s", self.platform, e)
        if self.platform == "xiaohongshu":
            for sel in (
                '.tiptap.ProseMirror[contenteditable="true"]',
                'div[role="textbox"][contenteditable="true"]',
                '[contenteditable="true"]',
            ):
                try:
                    loc = page.locator(sel).first
                    if await loc.count() > 0:
                        if await self._fill_control_text(loc, body[:1000]):
                            return
                except Exception:
                    continue
        selectors = _PLATFORM_BODY_SELECTORS.get(
            self.platform,
            ['[contenteditable="true"]', 'textarea[placeholder*="描述"]'],
        )
        for sel in selectors:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0:
                    if await self._fill_control_text(loc, body):
                        return
            except Exception:
                continue
        logger.warning("%s 未找到正文输入框", self.platform)

    async def _fill_tags(self, page, tags: list[str]) -> None:
        """填写标签/话题。通用策略：在标题或正文后追加 #话题#"""
        if not tags:
            return
        # 多数平台支持在正文里 #话题# 触发话题选择
        # 这里只做简单追加，真实生产可能需要更复杂的话题选择器交互
        tag_text = " ".join(f"#{t}#" if not t.startswith("#") else t for t in tags)
        try:
            body_selectors = _PLATFORM_BODY_SELECTORS.get(
                self.platform, ['[contenteditable="true"]']
            )
            for sel in body_selectors:
                try:
                    loc = page.locator(sel).first
                    if await loc.count() > 0:
                        await loc.press("End")
                        await loc.type(f" {tag_text}", delay=50)
                        return
                except Exception:
                    continue
        except Exception as e:
            logger.warning("%s 填写标签失败: %s", self.platform, e)

    async def _apply_publish_params(self, page, params: dict) -> None:
        """Apply best-effort platform options from task.publish_params.

        当前各平台 DOM 变化很快，因此这里只做保守操作：
        - visibility: public/friends/private -> 点击公开/好友/仅自己可见等单选文案
        - location/location_name -> 填写位置/地理位置/详细地址输入框
        - topics/tags 已在 _fill_tags 处理；这里不重复点击复杂话题弹层
        - allow_download/allow_comment/allow_duet 等先持久化，保守不强制翻转未知开关，避免误关平台默认项
        """
        if not params:
            return
        visibility = str(params.get("visibility") or "public")
        if self.platform == "bilibili":
            if visibility != "public":
                logger.warning(
                    "bilibili does not expose a stable private visibility option in this web flow; publishing as public"
                )
            await self._apply_bilibili_publish_params(page, params)
            return
        visibility_applied = await self._apply_visibility(page, visibility)
        if visibility in {"private", "friends"} and not visibility_applied:
            raise RuntimeError(
                f"无法确认已设置可见范围为 {visibility}，已中止发布，避免误公开。"
            )
        location = (
            params.get("location")
            or params.get("location_name")
            or params.get("poi")
            or params.get("address")
        )
        if location:
            await self._fill_location(page, str(location))

    async def _apply_bilibili_publish_params(self, page, params: dict) -> None:
        """Best-effort Bilibili-specific publish settings.

        B站视频发布页通常没有“仅自己可见”。这里仅处理公开发布可用的字段：
        创作声明/分区/转载来源；标题、简介和标签仍由通用输入流程填写。
        """
        statement = str(
            params.get("creation_statement")
            or params.get("statement")
            or params.get("bilibili_statement")
            or "内容无需标注"
        ).strip()
        statement_aliases = {
            "none": "内容无需标注",
            "normal": "内容无需标注",
            "no_ai": "内容无需标注",
            "ai": "含AI生成内容",
            "generated": "含AI生成内容",
            "fiction": "含虚构演绎内容",
            "marketing": "内容含营销信息",
            "opinion": "个人观点，仅供参考",
            "reprint": "内容为转载",
        }
        statement = statement_aliases.get(statement.lower(), statement)
        if statement:
            try:
                await self._evaluate_with_timeout(
                    page,
                    """async (target) => {
                      const visible = (el) => {
                        const r = el.getBoundingClientRect();
                        const s = getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                      };
                      const textOf = (el) => (el.innerText || el.textContent || el.value || el.placeholder || '').replace(/\\s+/g, ' ').trim();
                      const root = document.querySelector('.creation-statement-container')
                        || [...document.querySelectorAll('.form-item')]
                          .filter(visible)
                          .find(el => textOf(el).includes('创作声明'));
                      if (!root) return false;
                      const input = root.querySelector('input[placeholder*="创作声明"],input');
                      const current = input ? String(input.value || '').trim() : '';
                      if (current.includes(target)) return true;
                      const opener = input || root.querySelector('.bcc-select,[class*="select"]') || root;
                      opener.scrollIntoView({block: 'center', inline: 'nearest'});
                      opener.click();
                      await new Promise(resolve => setTimeout(resolve, 400));
                      const options = [...document.querySelectorAll('.bcc-option,li,[role="option"],button,[role="button"]')]
                        .filter(visible)
                        .map(el => ({el, text: textOf(el)}))
                        .filter(x => x.text);
                      const targetNorm = String(target || '').replace(/\\s+/g, '');
                      const match = options.find(x => x.text.replace(/\\s+/g, '') === targetNorm)
                        || options.find(x => x.text.includes(target))
                        || (target.includes('无需') ? options.find(x => x.text.includes('内容无需标注')) : null);
                      if (!match) return false;
                      (match.el.closest('li,.bcc-option,[role="option"],button,[role="button"]') || match.el).click();
                      return true;
                    }""",
                    statement,
                    timeout=10,
                )
                await asyncio.sleep(0.6)
            except Exception as exc:
                logger.info("bilibili creation statement selection skipped: %s", exc)

        category = (
            params.get("category")
            or params.get("partition")
            or params.get("type")
            or params.get("category_name")
        )
        if category:
            try:
                clicked = await self._evaluate_with_timeout(
                    page,
                    """(name) => {
                      const visible = (el) => {
                        const r = el.getBoundingClientRect();
                        const s = getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                      };
                      const textOf = (el) => (el.innerText || el.textContent || el.placeholder || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
                      const root = [...document.querySelectorAll('.video-human-type,.form-item,div')]
                        .filter(visible)
                        .find(el => textOf(el).includes('分区'));
                      if (!root) return false;
                      const current = textOf(root);
                      if (current.includes(name)) return true;
                      const opener = root.querySelector('.select-controller,.selector-container,[role="combobox"],[class*="select"]') || root;
                      if (opener) {
                        opener.scrollIntoView({block: 'center', inline: 'nearest'});
                        opener.click();
                      }
                      return !!opener;
                    }""",
                    str(category),
                    timeout=8,
                )
                if clicked:
                    await asyncio.sleep(0.8)
                    await self._evaluate_with_timeout(
                        page,
                        """(name) => {
                          const visible = (el) => {
                            const r = el.getBoundingClientRect();
                            const s = getComputedStyle(el);
                            return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                          };
                          const target = String(name || '').trim();
                          const options = [...document.querySelectorAll('li,.selector-item,.bcc-option,div,span,button,[role="option"]')].filter(visible);
                          for (const el of options) {
                            if (!visible(el)) continue;
                            const text = (el.innerText || el.textContent || '').trim();
                            if (text && text.includes(target)) {
                              (el.closest('li,.selector-item,.bcc-option,button,[role="button"],[role="option"]') || el).click();
                              return true;
                            }
                          }
                          return false;
                        }""",
                        str(category),
                        timeout=8,
                    )
            except Exception as exc:
                logger.info("bilibili category selection skipped: %s", exc)

        copyright_text = str(
            params.get("copyright") or params.get("copyright_type") or ""
        ).strip()
        if copyright_text:
            try:
                labels = (
                    ["自制", "原创"]
                    if copyright_text in {"1", "original", "自制", "原创"}
                    else ["转载"]
                )
                await self._evaluate_with_timeout(
                    page,
                    """(labels) => {
                      const visible = (el) => {
                        const r = el.getBoundingClientRect();
                        const s = getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                      };
                      for (const el of document.querySelectorAll('label,button,span,div')) {
                        if (!visible(el)) continue;
                        const text = (el.innerText || el.textContent || '').trim();
                        if (labels.some(label => text === label || text.includes(label))) {
                          (el.closest('label,button,[role="button"]') || el).click();
                          return true;
                        }
                      }
                      return false;
                    }""",
                    labels,
                    timeout=8,
                )
            except Exception:
                pass

        source = str(params.get("source") or params.get("reprint_source") or "").strip()
        if source:
            selectors = [
                'input[placeholder*="来源"]',
                'textarea[placeholder*="来源"]',
                'input[placeholder*="转载"]',
            ]
            for sel in selectors:
                try:
                    loc = page.locator(sel).first
                    if await loc.count() > 0 and await loc.is_visible(timeout=800):
                        await self._fill_control_text(loc, source)
                        break
                except Exception:
                    continue

    async def _apply_visibility(self, page, visibility: str) -> bool:
        label_map = {
            "public": ("公开", "所有人可见"),
            "friends": ("好友可见", "朋友可见", "仅互关好友可见"),
            "private": ("仅自己可见", "私密", "仅我可见"),
        }
        labels = label_map.get(visibility, label_map["public"])

        # 抖音发布页是 radio 组选项：谁可以看 -> 公开 / 好友可见 / 仅自己可见。
        # 用 radio group 的结构和值直接点，避免误点左侧「高清发布」等含“发布/公开”的菜单。
        if self.platform == "douyin":
            try:
                value_map = {"public": "0", "friends": "2", "private": "1"}
                clicked = await self._evaluate_with_timeout(
                    page,
                    """(value) => {
                      const visible = (el) => {
                        const r = el.getBoundingClientRect();
                        const s = getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                      };
                      const groups = [...document.querySelectorAll('div')].filter(el => {
                        if (!visible(el)) return false;
                        const text = (el.innerText || el.textContent || '').replace(/\\s+/g, '');
                        const r = el.getBoundingClientRect();
                        return text.includes('谁可以看') && text.includes('仅自己可见') &&
                          r.x >= 200 && r.width >= 300 && r.height <= 160;
                      });
                      groups.sort((a, b) => {
                        const ra = a.getBoundingClientRect();
                        const rb = b.getBoundingClientRect();
                        return (ra.height - rb.height) || (rb.y - ra.y);
                      });
                      const group = groups[0];
                      if (!group) return false;
                      group.scrollIntoView({block: 'center', inline: 'nearest'});
                      const inputs = [...group.querySelectorAll('input[type="checkbox"],input[type="radio"]')];
                      const target = inputs.find(i => String(i.value) === String(value)) || inputs[value === '1' ? 2 : value === '2' ? 1 : 0];
                      if (!target) return false;
                      target.click();
                      target.dispatchEvent(new Event('change', {bubbles: true}));
                      return true;
                    }""",
                    value_map.get(visibility, "0"),
                    timeout=10,
                )
                if clicked:
                    await asyncio.sleep(0.8)
                    selected = await self._evaluate_with_timeout(
                        page,
                        """(value) => {
                          const visible = (el) => {
                            const r = el.getBoundingClientRect();
                            const s = getComputedStyle(el);
                            return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                          };
                          const groups = [...document.querySelectorAll('div')].filter(el => {
                            if (!visible(el)) return false;
                            const text = (el.innerText || el.textContent || '').replace(/\\s+/g, '');
                            const r = el.getBoundingClientRect();
                            return text.includes('谁可以看') && text.includes('仅自己可见') &&
                              r.x >= 200 && r.width >= 300 && r.height <= 160;
                          });
                          for (const group of groups) {
                            const target = [...group.querySelectorAll('input[type="checkbox"],input[type="radio"]')]
                              .find(i => String(i.value) === String(value));
                            if (target && target.checked) return true;
                          }
                          return false;
                        }""",
                        value_map.get(visibility, "0"),
                        timeout=8,
                    )
                else:
                    selected = False
                if selected:
                    logger.info(
                        "%s 已设置可见范围 visibility=%s", self.platform, visibility
                    )
                    return True
            except Exception as e:
                logger.debug("%s 抖音可见范围直接设置失败: %s", self.platform, e)

        # 小红书当前发布页使用 .permission-card-select 作为可见范围下拉。
        # 直接用平台选择器比文本猜测更可靠；只有选择后触发器文案变成目标文案才返回成功。
        if self.platform == "xiaohongshu":
            try:
                trigger = page.locator(".permission-card-select").first
                if await trigger.count() > 0:
                    await trigger.scroll_into_view_if_needed(timeout=3000)
                    await trigger.click(timeout=5000)
                    await asyncio.sleep(0.5)
                    for label in labels:
                        option = (
                            page.locator(".custom-option, .d-grid-item")
                            .filter(has_text=label)
                            .first
                        )
                        try:
                            if await option.count() > 0:
                                await option.wait_for(state="visible", timeout=3000)
                                await option.click(timeout=5000)
                                await asyncio.sleep(0.8)
                                selected_text = (
                                    await trigger.inner_text(timeout=3000) or ""
                                ).strip()
                                if label in selected_text or any(
                                    x in selected_text for x in labels
                                ):
                                    logger.info(
                                        "%s 已设置可见范围 visibility=%s -> %s",
                                        self.platform,
                                        visibility,
                                        selected_text,
                                    )
                                    return True
                        except Exception:
                            continue
                    try:
                        await page.keyboard.press("Escape")
                    except Exception:
                        pass
            except Exception as e:
                logger.debug("%s 小红书可见范围直接设置失败: %s", self.platform, e)

        async def _selected_visible() -> bool:
            try:
                selected = await page.evaluate(
                    """(labels) => {
                      const norm = (s) => (s || '').trim().replace(/\\s+/g, '');
                      const visible = (el) => {
                        const r = el.getBoundingClientRect();
                        const s = getComputedStyle(el);
                        return r.width > 0 && r.height > 0 &&
                          s.display !== 'none' && s.visibility !== 'hidden';
                      };
                      const hasLabel = (el) => labels.some(label => norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '').includes(norm(label)));
                      // Prefer explicit checked/selected radio/option controls.
                      for (const el of document.querySelectorAll('[aria-checked="true"],[aria-selected="true"],input:checked')) {
                        const root = el.closest('label,[role="radio"],[role="option"],li,div') || el;
                        if (visible(root) && hasLabel(root)) return true;
                      }
                      // Many creator UIs render the chosen visibility directly
                      // in a select/dropdown trigger rather than aria-checked.
                      for (const el of document.querySelectorAll('button,[role="button"],[role="combobox"],[class*="select"],[class*="dropdown"]')) {
                        if (visible(el) && hasLabel(el)) return true;
                      }
                      return false;
                    }""",
                    list(labels),
                )
                if selected:
                    return True
            except Exception:
                pass
            # Do not treat mere presence of option text as "selected".
            # Radio/dropdown menus often show every visibility option at once;
            # accepting body text caused private/friends checks to pass while
            # the default public option was still active.
            return False

        async def _click_visible_option() -> bool:
            try:
                clicked = await page.evaluate(
                    """(labels) => {
                      const visible = (el) => {
                        const r = el.getBoundingClientRect();
                        const s = getComputedStyle(el);
                        return r.width > 0 && r.height > 0 &&
                          s.display !== 'none' && s.visibility !== 'hidden';
                      };
                      const normalize = (s) => (s || '').trim().replace(/\\s+/g, '');
                      const all = [...document.querySelectorAll('label,button,[role="button"],[role="option"],li,span,div')].filter(visible);
                      const matches = all.filter(el => {
                        const text = normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
                        if (!text) return false;
                        return labels.some(label => {
                          const needle = normalize(label);
                          return text === needle || (text.length <= 18 && text.includes(needle));
                        });
                      });
                      // Prefer overlay/dropdown options and lower on-screen controls,
                      // not sidebar menu items.
                      matches.sort((a, b) => {
                        const ra = a.getBoundingClientRect();
                        const rb = b.getBoundingClientRect();
                        const sa = (a.closest('[class*="popover"],[class*="dropdown"],[class*="select"],[role="listbox"]') ? 1000 : 0) + ra.y + ra.x / 1000;
                        const sb = (b.closest('[class*="popover"],[class*="dropdown"],[class*="select"],[role="listbox"]') ? 1000 : 0) + rb.y + rb.x / 1000;
                        return sb - sa;
                      });
                      for (const el of matches) {
                        const clickable = el.closest('.custom-option,.d-grid-item,label,button,[role="button"],[role="option"],li') || el;
                        clickable.scrollIntoView({block: 'center', inline: 'center'});
                        clickable.click();
                        return true;
                      }
                      return false;
                    }""",
                    list(labels),
                )
                if clicked:
                    await asyncio.sleep(0.6)
                    return True
            except Exception:
                pass
            return False

        # 1) If target option is already visible (radio row or open menu), click it.
        if await _click_visible_option():
            if await _selected_visible():
                return True

        # XHS keeps "who can see" under the lower publish-settings card.  The
        # text/DOM class names change often, so open dropdown-like rows from the
        # bottom settings area one by one and only accept the operation when the
        # requested target option can then be clicked/verified.  This prevents
        # the previous failure mode where private was requested but the page
        # stayed public.
        if self.platform == "xiaohongshu" and visibility in {
            "private",
            "friends",
            "public",
        }:
            try:
                await page.evaluate(
                    "() => window.scrollTo({top: document.body.scrollHeight, behavior: 'instant'})"
                )
                await asyncio.sleep(0.5)
                for idx in range(10):
                    opened = await page.evaluate(
                        """(idx) => {
                          const visible = (el) => {
                            const r = el.getBoundingClientRect();
                            const s = getComputedStyle(el);
                            return r.width > 0 && r.height > 0 &&
                              r.x >= 240 && r.x < innerWidth - 240 &&
                              r.y >= 90 && r.y < innerHeight - 80 &&
                              s.display !== 'none' && s.visibility !== 'hidden';
                          };
                          const bad = ['发布', '保存', '预览', '取消', 'Creator', 'Builder'];
                          const isSwitchLike = (el) => {
                            const cls = String(el.className || '').toLowerCase();
                            if (cls.includes('switch')) return true;
                            if (el.querySelector('[role="switch"],input[type="checkbox"],[class*="switch"],[class*="Switch"]')) return true;
                            return false;
                          };
                          const rows = [...document.querySelectorAll('button,[role="button"],[role="combobox"],label,div')]
                            .filter(visible)
                            .map(el => {
                              const r = el.getBoundingClientRect();
                              const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, '');
                              return {el, r, text, cls: String(el.className || '')};
                            })
                            .filter(x => x.r.width >= 220 && x.r.width <= 420 && x.r.height >= 32 && x.r.height <= 72)
                            .filter(x => x.text && !bad.some(b => x.text.includes(b)))
                            .filter(x => !isSwitchLike(x.el))
                            .filter(x => {
                              // Prefer rows that look like dropdown/select controls:
                              // role/combobox/select class, arrow/down icon, or
                              // "可见/公开/谁可以看" text when present.
                              const cls = x.cls.toLowerCase();
                              const role = x.el.getAttribute('role') || '';
                              const hasArrow = x.el.querySelector('[class*="arrow"],[class*="Arrow"],[class*="down"],[class*="Down"],svg');
                              return role === 'button' || role === 'combobox' || cls.includes('select') || cls.includes('dropdown') ||
                                hasArrow || /可见|公开|权限|谁/.test(x.text);
                            });
                          // Bottom-to-top: the visibility dropdown is below the
                          // editor in publish settings, while topic/location rows
                          // are usually above it.
                          rows.sort((a, b) => (b.r.y - a.r.y) || (a.r.x - b.r.x));
                          const item = rows[idx];
                          if (!item) return false;
                          item.el.scrollIntoView({block: 'center', inline: 'center'});
                          item.el.click();
                          return {text: item.text, x: item.r.x, y: item.r.y, w: item.r.width, h: item.r.height};
                        }""",
                        idx,
                    )
                    if not opened:
                        break
                    await asyncio.sleep(0.7)
                    if await _click_visible_option():
                        if await _selected_visible():
                            logger.info(
                                "%s 已设置可见范围 visibility=%s（XHS 设置区匹配）",
                                self.platform,
                                visibility,
                            )
                            return True
                    try:
                        await page.keyboard.press("Escape")
                    except Exception:
                        pass
                    await asyncio.sleep(0.2)
            except Exception as e:
                logger.debug("%s XHS 可见范围设置区匹配失败: %s", self.platform, e)

        # 2) Open likely visibility controls (select/dropdown/radio group), then click option.
        try:
            opened = await page.evaluate(
                """() => {
                  const visible = (el) => {
                    const r = el.getBoundingClientRect();
                    const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 &&
                      s.display !== 'none' && s.visibility !== 'hidden';
                  };
                  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
                  const bad = ['高清发布', '发布视频', '发布图文', '发布全景视频', '发布文章', '上传视频'];
                  const anchors = ['谁可以看', '谁可见', '可见范围', '权限设置', '权限', '公开', '所有人可见', '好友可见', '朋友可见', '仅自己可见', '仅我可见', '私密'];
                  const controls = [];
                  for (const el of document.querySelectorAll('button,[role="button"],[role="combobox"],label,[class*="select"],[class*="dropdown"],[class*="radio"],span,div')) {
                    if (!visible(el)) continue;
                    const text = textOf(el).replace(/\\s+/g, '');
                    if (!text || bad.some(x => text.includes(x))) continue;
                    if (!anchors.some(x => text.includes(x))) continue;
                    const clickable = el.closest('.d-select-wrapper,.d-select,.d-select-main,button,[role="button"],[role="combobox"],label,[class*="dropdown"],[class*="radio"]') || el;
                    const r = clickable.getBoundingClientRect();
                    if (!visible(clickable)) continue;
                    const cls = String(clickable.className || '').toLowerCase();
                    const score =
                      (cls.includes('select') || cls.includes('dropdown') || clickable.getAttribute('role') === 'combobox' ? 1000 : 0) +
                      (text.includes('公开') || text.includes('权限') || text.includes('可见') ? 300 : 0) +
                      (r.x < 180 ? -1000 : 0) +
                      r.y + r.x / 1000;
                    controls.push({ el: clickable, score });
                  }
                  controls.sort((a, b) => b.score - a.score);
                  if (controls.length) {
                    controls[0].el.scrollIntoView({block: 'center', inline: 'center'});
                    controls[0].el.click();
                    return true;
                  }
                  return false;
                }"""
            )
            if opened:
                await asyncio.sleep(0.7)
                if await _click_visible_option():
                    if await _selected_visible():
                        return True
        except Exception:
            pass
        logger.warning(
            "%s 未能确认设置可见范围 visibility=%s labels=%s",
            self.platform,
            visibility,
            labels,
        )
        return visibility == "public"

    async def _fill_location(self, page, location: str) -> None:
        selectors = [
            'input[placeholder*="位置"]',
            'input[placeholder*="地理"]',
            'input[placeholder*="地址"]',
            'textarea[placeholder*="位置"]',
            'textarea[placeholder*="地址"]',
            '[role="combobox"][placeholder*="位置"]',
            '[role="combobox"]',
        ]
        for sel in selectors:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0 and await loc.is_visible(timeout=800):
                    if await self._fill_control_text(loc, location):
                        await asyncio.sleep(0.8)
                        # 尝试选择第一个下拉建议，不强依赖
                        try:
                            await page.keyboard.press("ArrowDown")
                            await page.keyboard.press("Enter")
                        except Exception:
                            pass
                        return
            except Exception:
                continue

    async def _set_cover(self, page, cover_path: str) -> None:
        """设置封面图。"""
        cover_selectors = [
            'input[type="file"][accept*="image"]',
            '.cover-upload input[type="file"]',
            '[class*="cover"] input[type="file"]',
        ]
        for sel in cover_selectors:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0:
                    await loc.set_input_files(cover_path, timeout=30000)
                    await asyncio.sleep(1)
                    return
            except Exception:
                continue
        logger.warning("%s 未找到封面上传入口", self.platform)

    async def _ensure_bilibili_cover_selected(self, page) -> None:
        """Select the first generated Bilibili video-frame cover when no cover is supplied."""
        try:
            selected = await self._evaluate_with_timeout(
                page,
                """async () => {
                  const visible = (el) => {
                    if (!el) return false;
                    const r = el.getBoundingClientRect();
                    const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                  };
                  const selected = document.querySelector('.img-item-cover-selected');
                  if (selected && visible(selected)) return 'already-selected';
                  const cards = [...document.querySelectorAll(
                    '.img-item-box.img-item-cover, .local-group .img-item-box, [class*="img-item-cover"]'
                  )].filter(visible);
                  const card = cards[0];
                  if (!card) return '';
                  card.scrollIntoView({block: 'center', inline: 'nearest'});
                  for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
                    card.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, view: window}));
                  }
                  card.click();
                  await new Promise(resolve => setTimeout(resolve, 900));
                  return card.className || 'selected';
                }""",
                timeout=10,
            )
            if selected:
                logger.info(
                    "%s auto selected generated cover: %s", self.platform, selected
                )
        except Exception as exc:
            logger.info(
                "%s auto generated cover selection skipped: %s", self.platform, exc
            )

    async def _click_bilibili_submit(self, page) -> bool:
        """Invoke Bilibili's Vue submit method. DOM clicks can miss the component handler in headless mode."""
        try:
            invoked = await self._evaluate_with_timeout(
                page,
                """() => {
                  const visible = (el) => {
                    if (!el) return false;
                    const r = el.getBoundingClientRect();
                    const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                  };
                  const span = document.querySelector('.submit-add')
                    || [...document.querySelectorAll('button,div,span')]
                      .find(el => visible(el) && (el.innerText || el.textContent || '').replace(/\\s+/g, '').includes('立即投稿'));
                  let el = span;
                  while (el) {
                    const vm = el.__vue__;
                    if (vm && typeof vm.submitVideo === 'function') {
                      vm.submitVideo();
                      return 'vue-submitVideo';
                    }
                    el = el.parentElement;
                  }
                  if (span) {
                    span.click();
                    return 'dom-click';
                  }
                  return '';
                }""",
                timeout=10,
            )
            if invoked:
                logger.info("%s submitted via %s", self.platform, invoked)
                return True
        except Exception as exc:
            logger.debug("%s Vue submit fallback failed: %s", self.platform, exc)
        return False

    async def _click_publish_button(self, page) -> dict:
        """点击发布按钮。返回 {"clicked": bool, "error": str | None}。"""
        if self.platform == "xiaohongshu":
            try:
                host = page.locator("xhs-publish-btn").first
                if await host.count() > 0:
                    box = await host.bounding_box()
                    if box:
                        # xhs-publish-btn is a custom element. The public "发布"
                        # button is inside its shadow DOM on the right side.
                        await host.click(
                            position={
                                "x": box["width"] * 0.62,
                                "y": box["height"] * 0.5,
                            },
                            timeout=10000,
                        )
                        logger.info("%s 已点击发布按钮: xhs-publish-btn", self.platform)
                        return {"clicked": True, "error": None}
            except Exception as e:
                logger.debug("%s 点击 xhs-publish-btn 失败: %s", self.platform, e)

        # Prefer the real submit button in the main work area. The first
        # button containing "发布" on Douyin is often the left sidebar "高清发布"
        # menu, which only reopens the upload menu and does not publish.
        if self.platform == "bilibili":
            try:
                await self._evaluate_with_timeout(
                    page,
                    """() => {
                      const scrollables = [document.scrollingElement, document.documentElement, document.body,
                        ...document.querySelectorAll('div,main,section')];
                      for (const el of scrollables) {
                        if (!el) continue;
                        const canScroll = el.scrollHeight && el.clientHeight && el.scrollHeight > el.clientHeight + 20;
                        if (canScroll) el.scrollTop = el.scrollHeight;
                      }
                    }""",
                    timeout=6,
                )
                await asyncio.sleep(0.7)
                if await self._click_bilibili_submit(page):
                    return {"clicked": True, "error": None}
            except Exception as e:
                logger.debug("%s 滚动到发布按钮区域失败: %s", self.platform, e)

        try:
            clicked_text = await self._evaluate_with_timeout(
                page,
                """(labels) => {
                  const visible = (el) => {
                    const r = el.getBoundingClientRect();
                    const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && r.x >= 200 && r.y >= 80 &&
                      r.x < innerWidth && r.y < innerHeight &&
                      s.display !== 'none' && s.visibility !== 'hidden';
                  };
                  const disabled = (el) =>
                    el.disabled || el.getAttribute('aria-disabled') === 'true' ||
                    /disabled/.test(String(el.className || '').toLowerCase());
                  const norm = (s) => (s || '').trim().replace(/\\s+/g, '');
                  const bad = ['高清发布', '发布视频', '发布图文', '发布全景视频', '发布文章', '上传视频', '了解上传规则'];
                  const candidates = [...document.querySelectorAll('button,[role="button"],div,span')]
                    .filter(visible)
                    .map(el => {
                      const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
                      const clickable = el.closest('button,[role="button"]') || el;
                      const r = clickable.getBoundingClientRect();
                      return {el: clickable, text, x: r.x, y: r.y, w: r.width, h: r.height, cls: String(clickable.className || '')};
                    })
                    .filter(x => labels.some(label => x.text === norm(label) || x.text === norm(label + '作品') || x.text === norm('立即' + label)))
                    .filter(x => !bad.some(b => x.text.includes(norm(b))) && visible(x.el) && !disabled(x.el));
                  candidates.sort((a, b) => {
                    const sa = a.y + (a.x > innerWidth / 2 ? 200 : 0) + (a.cls.includes('primary') ? 100 : 0);
                    const sb = b.y + (b.x > innerWidth / 2 ? 200 : 0) + (b.cls.includes('primary') ? 100 : 0);
                    return sb - sa;
                  });
                  if (candidates.length) {
                    candidates[0].el.click();
                    return candidates[0].text;
                  }
                  return '';
                }""",
                ["发布", "发表", "立即投稿", "发布笔记", "发布作品"],
                timeout=10,
            )
            if clicked_text:
                logger.info(
                    "%s 已点击发布按钮（主内容区匹配）: %s", self.platform, clicked_text
                )
                return {"clicked": True, "error": None}
        except Exception as e:
            logger.debug("%s 主内容区发布按钮匹配失败: %s", self.platform, e)

        selectors = _PLATFORM_PUBLISH_BUTTON_SELECTORS.get(
            self.platform, ['button:has-text("发布")', 'button:has-text("发表")']
        )
        for sel in selectors:
            try:
                loc = page.locator(sel).last
                if await loc.count() > 0:
                    # 等待按钮可点击
                    await loc.wait_for(state="visible", timeout=10000)
                    await loc.click()
                    logger.info("%s 已点击发布按钮: %s", self.platform, sel)
                    return {"clicked": True, "error": None}
            except Exception as e:
                logger.debug("%s 尝试选择器 %s 失败: %s", self.platform, sel, e)
                continue
        # 最后回退：找所有可见按钮中文字含"发布"或"发表"的
        try:
            buttons = page.get_by_role("button")
            count = await buttons.count()
            for i in range(count):
                btn = buttons.nth(i)
                text = (await btn.text_content() or "").strip()
                if text in ("发布", "发表", "立即投稿", "发布视频", "发布笔记"):
                    await btn.click()
                    logger.info(
                        "%s 已点击发布按钮（回退匹配）: %s", self.platform, text
                    )
                    return {"clicked": True, "error": None}
        except Exception:
            pass
        return {"clicked": False, "error": f"未找到 {self.platform} 的发布按钮"}

    async def _wait_for_publish_success(self, page, timeout: int = 60) -> bool:
        """等待发布成功（URL 跳转到管理页/成功页）。

        Args:
            page: Playwright page
            timeout: 最大等待秒数

        Returns:
            True 表示检测到成功跳转；False 表示超时未跳转
        """
        patterns = _PLATFORM_SUCCESS_URL_PATTERNS.get(self.platform, [])
        if not patterns:
            # 没有配置成功 URL 模式，只等待 5 秒看是否有跳转
            try:
                await page.wait_for_url(
                    lambda url: url != self.publish_url, timeout=10000
                )
                return True
            except Exception:
                return False

        compiled = [re.compile(p) for p in patterns]
        deadline = time.time() + timeout
        confirm_clicked = False
        while time.time() < deadline:
            try:
                if not confirm_clicked:
                    try:
                        clicked_confirm = await self._evaluate_with_timeout(
                            page,
                            """() => {
                              const labels = ['确认发布', '确定发布', '仍要发布', '确认', '确定'];
                              const visible = (el) => {
                                const r = el.getBoundingClientRect();
                                const s = getComputedStyle(el);
                                return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 &&
                                  r.x < innerWidth && r.y < innerHeight &&
                                  s.display !== 'none' && s.visibility !== 'hidden';
                              };
                              for (const el of document.querySelectorAll('button,[role="button"]')) {
                                if (!visible(el)) continue;
                                const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, '');
                                if (labels.includes(text)) {
                                  el.click();
                                  return true;
                                }
                              }
                              return false;
                            }""",
                            timeout=5,
                        )
                        if clicked_confirm:
                            confirm_clicked = True
                            await asyncio.sleep(1)
                    except Exception:
                        pass
                current_url = page.url
                for pat in compiled:
                    if pat.search(current_url):
                        logger.info("%s 发布成功跳转到: %s", self.platform, current_url)
                        return True
                # 检查是否有成功提示弹窗
                try:
                    success_toast = page.locator(
                        '[class*="success"]:has-text("成功"), [class*="toast"]:has-text("成功")'
                    )
                    if await success_toast.count() > 0:
                        logger.info("%s 发布成功（检测到成功提示）", self.platform)
                        return True
                except Exception:
                    pass
                try:
                    body_text = await page.locator("body").inner_text(timeout=2500)
                    if self.platform == "bilibili" and (
                        "\u4e0a\u4f20\u6210\u529f" in body_text
                        or (
                            "\u67e5\u770b\u8fdb\u5ea6" in body_text
                            and "\u518d\u6295\u4e00\u4e2a" in body_text
                        )
                    ):
                        logger.info(
                            "%s publish success detected from Bilibili success text",
                            self.platform,
                        )
                        return True
                    if re.search(
                        r"(发布成功|投稿成功|作品已发布|提交成功|已提交审核|发布任务已提交)",
                        body_text,
                    ):
                        logger.info("%s 发布成功（检测到成功文案）", self.platform)
                        return True
                except Exception:
                    pass
            except Exception:
                pass
            await asyncio.sleep(1)
        return False


# 平台 -> 适配器类映射（可扩展为不同子类）
_ADAPTER_REGISTRY: dict[str, type[BuiltinPlatformAdapter]] = {
    "xiaohongshu": BuiltinPlatformAdapter,
    "channels": BuiltinPlatformAdapter,
    "douyin": BuiltinPlatformAdapter,
    "kuaishou": BuiltinPlatformAdapter,
    "bilibili": BuiltinPlatformAdapter,
    "baijiahao": BuiltinPlatformAdapter,
}


def get_adapter(platform: str, config: dict | None = None) -> PlatformAdapter:
    """工厂方法：返回指定平台的内置适配器实例。"""
    cls = _ADAPTER_REGISTRY.get(platform, BuiltinPlatformAdapter)
    return cls(platform=platform, config=config)


__all__ = ["BuiltinPlatformAdapter", "get_adapter"]
