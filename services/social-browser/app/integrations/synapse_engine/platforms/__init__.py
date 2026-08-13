"""平台适配器包。

提供本项目内置适配器（不依赖外部 D:\\social-auto-stack 源码）：
- 扫码登录：Playwright 打开登录页 -> 截屏二维码 -> 轮询登录态
- 内容发布：Playwright 打开发布页 -> 填表 -> 上传素材 -> 点击发布按钮

原 SYNAPSE_SRC_DIR / sys.path 注入的外部加载策略已移除，
本项目完全使用 backend/app/integrations/synapse_engine 内的源码。
"""

from app.integrations.synapse_engine.platforms.base import (
    LoginResult,
    LoginStatus,
    PlatformAdapter,
    QRCodeData,
    UserInfo,
)
from app.integrations.synapse_engine.platforms.builtin import (
    BuiltinPlatformAdapter,
    get_adapter,
)
from app.integrations.synapse_engine.platforms.codes import (
    CODE_TO_PLATFORM,
    PLATFORM_CODES,
)


def get_platform_adapter(platform: str, config: dict | None = None) -> PlatformAdapter:
    """获取平台适配器实例（始终使用内置实现）。

    Args:
        platform: 平台名（xiaohongshu|channels|douyin|kuaishou|bilibili）
        config: 适配器配置（headless、timeout 等）

    Returns:
        PlatformAdapter 实例
    """
    return get_adapter(platform, config)


__all__ = [
    "BuiltinPlatformAdapter",
    "PlatformAdapter",
    "LoginStatus",
    "QRCodeData",
    "UserInfo",
    "LoginResult",
    "PLATFORM_CODES",
    "CODE_TO_PLATFORM",
    "get_platform_adapter",
]
