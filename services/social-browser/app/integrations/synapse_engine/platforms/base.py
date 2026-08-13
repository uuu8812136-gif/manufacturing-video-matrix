"""平台适配器抽象基类。

复刻 Synapse app_new/platforms/base.py 的接口契约，
保证原项目平台适配器可直接迁入并实现。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional


class LoginStatus(str, Enum):
    WAITING = "waiting"  # 等待扫码
    SCANNED = "scanned"  # 已扫码，等待确认
    SECURITY_VERIFICATION = "security_verification"  # 已扫码，等待 App 安全验证
    CONFIRMED = "confirmed"  # 已确认登录
    FAILED = "failed"  # 登录失败
    EXPIRED = "expired"  # 二维码过期


@dataclass
class QRCodeData:
    """二维码登录数据。"""

    session_id: str
    qr_url: str  # 二维码扫描后的目标 URL
    qr_image: str  # base64 编码的二维码图片（PNG）
    expires_in: int = 300  # 过期秒数
    qr_version: int = 1
    token_hash: Optional[str] = None
    qr_hash: Optional[str] = None
    generated_at: Optional[str] = None
    evidence: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


@dataclass
class UserInfo:
    """从平台提取的用户信息。"""

    user_id: Optional[str] = None
    name: Optional[str] = None
    username: Optional[str] = None
    avatar: Optional[str] = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class LoginResult:
    """登录结果。"""

    status: LoginStatus
    message: str = ""
    cookies: list[dict] = field(default_factory=list)
    user_info: Optional[UserInfo] = None
    full_state: Optional[dict] = None  # Playwright storage_state 完整快照


class PlatformAdapter(ABC):
    """平台适配器抽象基类。

    每个平台（小红书/抖音/B站/快手/视频号）实现此接口。
    EmbeddedSynapseService 通过此接口统一调用扫码登录、Cookie 校验、发布等能力。
    """

    def __init__(self, config: Optional[dict[str, Any]] = None):
        self.config = config or {}
        self.platform_name: str = self.config.get("platform", "")
        self.headless: bool = self.config.get("headless", False)
        self.account_id: Optional[str] = self.config.get("account_id")

    @abstractmethod
    async def get_qrcode(self) -> QRCodeData:
        """生成登录二维码。"""

    @abstractmethod
    async def poll_status(self, session_id: str) -> LoginResult:
        """轮询登录状态。"""

    @abstractmethod
    async def cleanup_session(self, session_id: str) -> None:
        """清理会话（关闭浏览器等）。"""

    async def get_qr_snapshot(self, session_id: str) -> Optional[dict[str, Any]]:
        """返回当前会话最新二维码的脱敏快照；平台不支持时返回 None。"""
        return None

    async def supports_api_login(self) -> bool:
        """是否支持纯 API 登录（无需 Playwright）。"""
        return False

    async def publish_content(
        self,
        storage_state: dict,
        title: str,
        description: str,
        tags: list[str] | None = None,
        media_paths: list[str] | None = None,
        cover_path: Optional[str] = None,
        publish_mode: str = "now",  # now|scheduled
        scheduled_at: Optional[str] = None,
        account_id: Optional[str] = None,
        publish_params: Optional[dict] = None,
    ) -> dict:
        """使用已有 storage_state 调用平台发布器。

        子类应实现：打开发布页 -> 上传素材 -> 填写标题/描述 -> 提交。
        返回 dict 至少包含 external_post_id / publish_url / status / screenshots 字段。
        """
        raise NotImplementedError(
            f"{self.platform_name} 平台未实现 publish_content；请通过源码迁入补全"
        )

    async def validate_cookie(
        self, storage_state: dict, *, include_reload_evidence: bool = True
    ) -> dict:
        """校验 Cookie 是否有效。返回 {valid: bool, user_info: UserInfo, reason: str}。"""
        return {"valid": False, "user_info": None, "reason": "未实现"}
