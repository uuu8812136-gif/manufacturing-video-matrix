"""Cookie 管理子模块。

负责持久化每个社媒账号的 storage_state（cookies + localStorage），
落盘到 SYNAPSE_COOKIE_DIR 下，按 <platform>_<account_id>.json 命名。
"""

from app.integrations.synapse_engine.cookie.manager import CookieManager

__all__ = ["CookieManager"]
