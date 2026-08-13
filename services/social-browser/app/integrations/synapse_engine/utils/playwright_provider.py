"""Playwright 运行时提供者。

复刻 Synapse utils/playwright_provider.py 的运行时切换能力：
- SYNAPSE_PLAYWRIGHT_RUNTIME=patchright 优先使用 patchright（反检测增强版）
- SYNAPSE_PLAYWRIGHT_RUNTIME=playwright 强制使用 playwright
- 未设置时按 patchright -> playwright 顺序回退

注意：本模块在 import 时不会立即加载 Playwright 运行时，
只有真正调用 async_playwright() 等函数时才触发加载。
这样应用启动时不需要 Playwright 也能正常 import 其它模块。

用法：
    from app.integrations.synapse_engine.utils.playwright_provider import async_playwright
    pw = await async_playwright().start()  # 返回 Playwright 实例
    # 或
    async with async_playwright() as pw:  # 上下文管理器
        browser = await pw.chromium.launch()
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PLAYWRIGHT_RUNTIME = os.getenv("SYNAPSE_PLAYWRIGHT_RUNTIME", "").strip().lower()
PLAYWRIGHT_CHROMIUM_INSTALL_MESSAGE = (
    "Playwright Chromium 浏览器未安装或安装不完整，请在后端环境执行："
    "python -m playwright install chromium。Docker 环境请重新构建后端镜像。"
)

_runtime_module: Any = None
_load_error: Exception | None = None
_loaded = False


class PlaywrightBrowserMissingError(RuntimeError):
    """Playwright 浏览器二进制缺失或安装不完整。"""


def is_playwright_browser_missing_error(exc_or_message: Exception | str) -> bool:
    """识别 Playwright 浏览器缺失的常见英文错误。"""
    msg = str(exc_or_message).lower()
    return (
        "executable doesn't exist" in msg
        or "please run the following command" in msg
        or "playwright install" in msg
        or "chromium_headless_shell" in msg
        or "browser was not found" in msg
    )


def friendly_playwright_error(exc: Exception | str) -> str:
    """返回给前端的短中文错误，不泄露超长 stack/path。"""
    if is_playwright_browser_missing_error(exc):
        return PLAYWRIGHT_CHROMIUM_INSTALL_MESSAGE
    raw = str(exc).splitlines()[0].strip()
    if len(raw) > 180:
        raw = raw[:180] + "..."
    return raw or "Playwright 启动失败"


def _browser_roots() -> list[Path]:
    roots: list[Path] = []
    explicit_roots: list[Path] = []
    env_path = os.getenv("PLAYWRIGHT_BROWSERS_PATH", "").strip()
    synapse_path = os.getenv("SYNAPSE_PLAYWRIGHT_BROWSERS_DIR", "").strip()
    for value in (synapse_path, env_path):
        if value and value != "0":
            explicit_roots.append(Path(value))

    # 显式指定浏览器目录时，Playwright 只从该目录找，不能再用默认目录误判通过。
    if explicit_roots:
        return explicit_roots

    # Playwright 默认位置：Linux/macOS ~/.cache/ms-playwright；Windows %USERPROFILE%\AppData\Local\ms-playwright
    home = Path.home()
    if sys.platform.startswith("win"):
        local = os.getenv("LOCALAPPDATA")
        if local:
            roots.append(Path(local) / "ms-playwright")
    else:
        roots.append(home / ".cache" / "ms-playwright")

    # PLAYWRIGHT_BROWSERS_PATH=0 时浏览器在包内 .local-browsers
    try:
        import playwright

        roots.append(
            Path(playwright.__file__).parent / "driver" / "package" / ".local-browsers"
        )
    except Exception:
        pass

    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root)
        if key not in seen:
            seen.add(key)
            unique.append(root)
    return unique


def _headless_shell_candidates(root: Path) -> list[Path]:
    """Playwright 1.49 headless=True 默认使用 chromium_headless_shell。"""
    candidates: list[Path] = []
    if not root.exists():
        return candidates
    for d in root.glob("chromium_headless_shell-*"):
        candidates.extend(
            [
                d / "chrome-linux" / "headless_shell",
                d / "chrome-win" / "headless_shell.exe",
                d / "chrome-mac" / "headless_shell",
            ]
        )
    return candidates


def _chromium_candidates(root: Path) -> list[Path]:
    candidates: list[Path] = []
    if not root.exists():
        return candidates
    for d in root.glob("chromium-*"):
        # 注意：chromium_headless_shell-* 也匹配 chromium-*，这里跳过避免误判
        if d.name.startswith("chromium_headless_shell-"):
            continue
        candidates.extend(
            [
                d / "chrome-linux" / "chrome",
                d / "chrome-win" / "chrome.exe",
                d / "chrome-mac" / "Chromium.app" / "Contents" / "MacOS" / "Chromium",
            ]
        )
    return candidates


def _first_existing(candidates: list[Path], searched: list[str]) -> str | None:
    for p in candidates:
        searched.append(str(p))
        if p.exists():
            return str(p)
    return None


def resolve_chromium_executable(
    local_chrome_path: str | None = None,
    *,
    headless: bool = True,
    allow_regular_fallback: bool = True,
) -> str:
    """Resolve a Chromium executable that Playwright can launch.

    Playwright 1.49+ normally prefers ``chromium_headless_shell`` when
    ``headless=True``. Some mirrors only install ``chromium-*/chrome`` and miss
    the headless-shell artifact, which is exactly the runtime error shown in the
    QR-login dialog. In that case we deliberately fall back to the regular
    Chromium executable and pass it as ``executable_path`` to launch(), so
    Playwright no longer tries the missing headless-shell path.
    """
    if local_chrome_path:
        p = Path(local_chrome_path)
        if p.exists():
            return str(p)
        raise PlaywrightBrowserMissingError(
            f"SYNAPSE_LOCAL_CHROME_PATH browser does not exist: {local_chrome_path}"
        )

    searched: list[str] = []
    roots = _browser_roots()

    # 1) Prefer the exact executable Playwright wants for the requested mode.
    for root in roots:
        candidates = (
            _headless_shell_candidates(root) if headless else _chromium_candidates(root)
        )
        found = _first_existing(candidates, searched)
        if found:
            return found

    # 2) Runtime fallback: when headless_shell is absent but normal Chromium is
    # installed, launch normal Chromium in headless mode by explicitly passing
    # executable_path. This fixes Docker images built from mirrors that do not
    # provide chromium-headless-shell-linux.zip.
    if headless and allow_regular_fallback:
        for root in roots:
            found = _first_existing(_chromium_candidates(root), searched)
            if found:
                logger.warning(
                    "Playwright headless shell missing; falling back to regular Chromium: %s",
                    found,
                )
                return found

    detail = PLAYWRIGHT_CHROMIUM_INSTALL_MESSAGE
    if searched:
        detail += f" Checked path: {searched[0]}"
    raise PlaywrightBrowserMissingError(detail)


def assert_chromium_ready(
    local_chrome_path: str | None = None, *, headless: bool = True
) -> str:
    """Return a Chromium executable path that can be passed to Playwright.

    This function intentionally allows regular Chromium as a fallback for
    headless mode, because Docker mirrors may omit chromium_headless_shell.
    """
    return resolve_chromium_executable(
        local_chrome_path,
        headless=headless,
        allow_regular_fallback=True,
    )


def _try_load(name: str):
    """尝试加载 playwright/patchright 的 async_api 子模块。"""
    global _load_error
    # 优先加载 async_api 子模块（async_playwright 函数所在）
    try:
        return importlib.import_module(f"{name}.async_api")
    except Exception as exc:
        _load_error = exc
        # 回退到顶层包
        try:
            mod = importlib.import_module(name)
            if hasattr(mod, "async_playwright"):
                return mod
            # 尝试访问 async_api 子模块
            if hasattr(mod, "async_api"):
                return mod.async_api
            _load_error = ImportError(f"{name} has no async_playwright")
            return None
        except Exception as exc2:
            _load_error = exc2
            return None


def _ensure_loaded() -> Any:
    """惰性加载 Playwright 运行时模块。

    加载失败时重置 _loaded=False，下次调用会重新尝试，
    避免返回 None 导致上游报 'NoneType' object has no attribute '__name__'。
    """
    global _runtime_module, _loaded
    if _loaded:
        return _runtime_module
    _loaded = True

    if PLAYWRIGHT_RUNTIME == "playwright":
        _runtime_module = _try_load("playwright")
    elif PLAYWRIGHT_RUNTIME == "patchright":
        _runtime_module = _try_load("patchright") or _try_load("playwright")
    else:
        _runtime_module = _try_load("patchright") or _try_load("playwright")

    if _runtime_module is None:
        # 重置 _loaded，让下次调用能重新尝试加载，而不是返回 None
        _loaded = False
        raise ImportError(
            "未找到可用的 Playwright 运行时（patchright 或 playwright）。"
            f" 请先 pip install playwright 或 pip install patchright。"
            f" 最后一次错误：{_load_error}"
        )
    logger.info("Playwright 运行时加载成功: %s", _runtime_module.__name__)
    return _runtime_module


def async_playwright():
    """返回 async_playwright 上下文管理器实例。

    用法：
        pw = await async_playwright().start()
        # 或
        async with async_playwright() as pw:
            ...
    """
    mod = _ensure_loaded()
    if mod is None:
        # 防御性检查：_ensure_loaded 理论上不会返回 None（会 raise），
        # 但加这层保护避免上游报 'NoneType' object has no attribute '__name__'
        raise RuntimeError("Playwright 运行时未加载，请先 pip install playwright")
    fn = getattr(mod, "async_playwright", None)
    if fn is None:
        raise AttributeError(f"{mod.__name__} 没有 async_playwright 函数")
    return fn()  # 返回 AsyncPlaywrightContextManager 实例


def sync_playwright():
    """返回 sync_playwright 上下文管理器实例（可能不存在）。"""
    mod = _ensure_loaded()
    fn = getattr(mod, "sync_playwright", None)
    if fn is None:
        return None
    return fn()


def get_runtime_info() -> dict:
    """返回运行时信息（不触发加载）。"""
    return {
        "configured_runtime": PLAYWRIGHT_RUNTIME or "auto",
        "loaded": _loaded,
        "module_name": getattr(_runtime_module, "__name__", None),
        "load_error": str(_load_error) if _load_error else None,
    }


# 类型符号占位（实际类型在 Playwright 加载后可用）
# 这里用 type: ignore 避免静态检查报错
Browser = None  # type: ignore[assignment]
BrowserContext = None  # type: ignore[assignment]
BrowserType = None  # type: ignore[assignment]
Page = None  # type: ignore[assignment]
Locator = None  # type: ignore[assignment]
Playwright = None  # type: ignore[assignment]
TimeoutError = Exception  # type: ignore[assignment]


def configure_windows_event_loop() -> None:
    """Windows 平台必须切换到 ProactorEventLoop，否则 Playwright subprocess 会失败。"""
    if sys.platform.startswith("win"):
        import asyncio

        try:
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        except Exception:
            pass


__all__ = [
    "PLAYWRIGHT_RUNTIME",
    "PLAYWRIGHT_CHROMIUM_INSTALL_MESSAGE",
    "PlaywrightBrowserMissingError",
    "assert_chromium_ready",
    "resolve_chromium_executable",
    "friendly_playwright_error",
    "is_playwright_browser_missing_error",
    "async_playwright",
    "sync_playwright",
    "Browser",
    "BrowserContext",
    "BrowserType",
    "Page",
    "Locator",
    "Playwright",
    "TimeoutError",
    "configure_windows_event_loop",
    "get_runtime_info",
]
