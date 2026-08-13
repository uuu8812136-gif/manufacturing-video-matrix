from __future__ import annotations

import os
from functools import lru_cache


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    """Small settings object matching the embedded Synapse engine contract."""

    def __init__(self) -> None:
        shared_secret = (
            os.getenv("SOCIAL_BROWSER_API_KEY")
            or os.getenv("JWT_SECRET")
            or "development-social-browser-key-change-me"
        )
        cookie_secret = (
            os.getenv("SOCIAL_BROWSER_COOKIE_KEY")
            or os.getenv("ENCRYPTION_KEY")
            or shared_secret
        )

        self.SOCIAL_BROWSER_API_KEY = shared_secret
        self.COOKIE_ENCRYPTION_KEY = cookie_secret
        # Kept for compatibility with the source encryption helper.
        self.PHONE_ENCRYPTION_KEY = cookie_secret
        self.SYNAPSE_STORAGE_DIR = os.getenv(
            "SYNAPSE_STORAGE_DIR", "/data/synapse"
        )
        self.SYNAPSE_COOKIE_DIR = os.getenv(
            "SYNAPSE_COOKIE_DIR", f"{self.SYNAPSE_STORAGE_DIR}/cookies"
        )
        self.SYNAPSE_PLAYWRIGHT_HEADLESS = _bool(
            "SYNAPSE_PLAYWRIGHT_HEADLESS", False
        )
        self.SYNAPSE_PLAYWRIGHT_RUNTIME = os.getenv(
            "SYNAPSE_PLAYWRIGHT_RUNTIME", "patchright"
        )
        self.SYNAPSE_LOCAL_CHROME_PATH = os.getenv(
            "SYNAPSE_LOCAL_CHROME_PATH", ""
        )
        self.SYNAPSE_BROWSER_PROXY = os.getenv("SYNAPSE_BROWSER_PROXY", "")
        # macOS 可见 Edge 扫码桥接。仅登录二维码会话使用；登录态复验与
        # 发布仍在 social-browser 容器内以隔离的 Chromium 执行。
        self.SYNAPSE_HOST_BROWSER_BRIDGE_URL = os.getenv(
            "SYNAPSE_HOST_BROWSER_BRIDGE_URL", ""
        ).rstrip("/")
        # 默认不覆写 Chromium 的线路选择。只有显式配置为 true 时才强制
        # direct://，避免悄悄绕过系统/宿主机已配置的中国线路。
        self.SYNAPSE_BROWSER_NO_PROXY = _bool("SYNAPSE_BROWSER_NO_PROXY", False)
        self.SOCIAL_BROWSER_MAX_MEDIA_BYTES = int(
            os.getenv("SOCIAL_BROWSER_MAX_MEDIA_BYTES", str(1024 * 1024 * 1024))
        )
        self.SOCIAL_BROWSER_ALLOWED_PRIVATE_HOSTS = {
            host.strip().lower()
            for host in os.getenv(
                "SOCIAL_BROWSER_ALLOWED_PRIVATE_HOSTS",
                "backend,minio,localhost,127.0.0.1,host.docker.internal",
            ).split(",")
            if host.strip()
        }
        self.SOCIAL_BROWSER_URL_REWRITE = self._parse_rewrites(
            os.getenv("SOCIAL_BROWSER_URL_REWRITE", "")
        )

    @staticmethod
    def _parse_rewrites(value: str) -> list[tuple[str, str]]:
        pairs: list[tuple[str, str]] = []
        for item in value.split(","):
            source, separator, target = item.strip().partition("=")
            if separator and source and target:
                pairs.append((source.rstrip("/"), target.rstrip("/")))
        return pairs


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
