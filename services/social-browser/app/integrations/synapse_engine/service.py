"""EmbeddedSynapseService - Synapse 内嵌发布引擎对外服务。

统一封装：
1. 扫码登录：start_login / poll_login_status / sync_account
2. Cookie 校验：validate_account_cookie
3. 内容发布：publish_content（异步 worker 调用）
4. 平台适配器加载：通过 platforms.get_platform_adapter

所有方法均为进程内 Python 调用，不走 HTTP，不开子进程。
Playwright 操作放进 Celery worker 异步执行，不阻塞 FastAPI 请求。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from app.core.config import get_settings
from app.integrations.synapse_engine.cookie import CookieManager
from app.integrations.synapse_engine.platforms import get_platform_adapter
from app.integrations.synapse_engine.platforms.base import (
    LoginResult,
    LoginStatus,
    QRCodeData,
    PlatformAdapter,
)
from app.integrations.synapse_engine.platforms.codes import (
    PLATFORM_CODES,
    PLATFORM_NAMES,
    normalize_platform,
)

logger = logging.getLogger(__name__)
LOGIN_START_TIMEOUT_SECONDS = 120
# Keep enough headroom for the adapter's bounded browser/driver cleanup before
# the backend (120 s) and frontend (135 s) request budgets expire.
ACCOUNT_VALIDATE_TIMEOUT_SECONDS = 100
ACCOUNT_VALIDATE_RETRY_DELAY_SECONDS = 0.8


class EmbeddedSynapseService:
    """Synapse 内嵌引擎服务（单例）。

    线程安全：内部状态用 dict + asyncio.Lock 保护。
    """

    _instance: "EmbeddedSynapseService | None" = None
    _init_lock = asyncio.Lock()

    def __new__(cls) -> "EmbeddedSynapseService":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.settings = get_settings()
        self.cookie_manager = CookieManager()
        # 进行中的扫码会话：<session_id, {adapter, platform, account_id, started_at}>
        self._login_sessions: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    # ===== 扫码登录 =====

    async def start_login(self, platform: str, account_id: str | None = None) -> dict:
        """启动扫码登录流程，返回二维码信息。

        Args:
            platform: 平台代码（xiaohongshu/douyin/...）
            account_id: 可选，账号 ID（用于关联 cookie 文件）

        Returns:
            {
                "session_id": "...",
                "platform": "...",
                "qr_image": "data:image/png;base64,...",
                "qr_url": "...",
                "expires_in": 300,
            }

        Notes:
            session_id 由 adapter.get_qrcode() 内部生成并返回（qr.session_id），
            service 直接复用该 ID 作为会话标识，确保 poll_login_status 能找到
            adapter 内部的浏览器会话。
        """
        platform = normalize_platform(platform)
        if not platform:
            raise ValueError("platform 不能为空")

        # 浏览器模式只由 SYNAPSE_PLAYWRIGHT_HEADLESS 决定。这里不再偷偷
        # 注入 headless=True，确保 Xvfb 中运行的是普通 Chromium。
        adapter = get_platform_adapter(platform)
        try:
            qr: QRCodeData = await asyncio.wait_for(
                adapter.get_qrcode(), timeout=LOGIN_START_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError as exc:
            raise RuntimeError(
                f"{PLATFORM_NAMES.get(platform, platform)}登录页在 "
                f"{LOGIN_START_TIMEOUT_SECONDS} 秒内未返回二维码，已取消本次扫码"
            ) from exc

        # 统一使用 qr.session_id，确保 poll_status 能找到 adapter 内部会话
        session_id = qr.session_id
        account_id = account_id or f"temp_{session_id[:8]}"

        async with self._lock:
            self._login_sessions[session_id] = {
                "adapter": adapter,
                "platform": platform,
                "account_id": account_id,
                "qr_data": qr,
                "started_at": time.time(),
                "last_result": None,
                "expiry_task": None,
                "scan_extended": False,
            }
            self._login_sessions[session_id]["expiry_task"] = asyncio.create_task(
                self._expire_login_session(session_id, min(max(qr.expires_in, 60), 300))
            )

        logger.info(
            "start_login platform=%s session_id=%s account_id=%s",
            platform,
            session_id,
            account_id,
        )

        return {
            "session_id": session_id,
            "platform": platform,
            "platform_name": PLATFORM_NAMES.get(platform, platform),
            "account_id": account_id,
            "qr_image": qr.qr_image,
            "qr_url": qr.qr_url,
            "expires_in": qr.expires_in,
            "qr_version": qr.qr_version,
            "token_hash": qr.token_hash,
            "qr_hash": qr.qr_hash,
            "generated_at": qr.generated_at,
            "evidence": qr.evidence,
        }

    async def poll_login_status(self, session_id: str) -> dict:
        """轮询扫码登录状态。

        Args:
            session_id: start_login 返回的 session_id（与 adapter 内部会话 ID 一致）

        Returns:
            {
                "status": "waiting|scanned|confirmed|failed|expired",
                "message": "...",
                "platform": "...",
                "account_id": "...",
                "user_info": {...} | None,
                "saved": bool,
            }
        """
        async with self._lock:
            sess = self._login_sessions.get(session_id)
        if not sess:
            return {
                "status": LoginStatus.EXPIRED.value,
                "message": "session 不存在或已过期",
            }

        # 超时
        if time.time() - sess["started_at"] > 300:
            await self._cleanup_session(session_id)
            return {
                "status": LoginStatus.EXPIRED.value,
                "message": "二维码已过期，请重新获取",
            }

        adapter: PlatformAdapter = sess["adapter"]
        # session_id 与 adapter 内部会话 ID 一致，poll_status 能找到会话
        result: LoginResult = await adapter.poll_status(session_id)
        sess["last_result"] = result

        # 页面可能因初始化/官方刷新生成新 token。每次轮询都读取同一个
        # BrowserContext 内的最新原子快照，并把新图和新 token 版本送到前端。
        qr_snapshot = await adapter.get_qr_snapshot(session_id)
        if qr_snapshot:
            old_version = int(getattr(sess.get("qr_data"), "qr_version", 0) or 0)
            new_version = int(qr_snapshot.get("qr_version") or 0)
            if new_version > old_version:
                qr_data: QRCodeData = sess["qr_data"]
                qr_data.qr_image = str(qr_snapshot.get("qr_image") or qr_data.qr_image)
                qr_data.qr_version = new_version
                qr_data.token_hash = qr_snapshot.get("token_hash")
                qr_data.qr_hash = qr_snapshot.get("qr_hash")
                qr_data.generated_at = qr_snapshot.get("generated_at")
                qr_data.expires_in = max(
                    15, int(qr_snapshot.get("expires_in") or qr_data.expires_in)
                )
                sess["started_at"] = time.time()
                sess["scan_extended"] = False
                expiry_task = sess.get("expiry_task")
                if expiry_task and expiry_task is not asyncio.current_task():
                    expiry_task.cancel()
                sess["expiry_task"] = asyncio.create_task(
                    self._expire_login_session(
                        session_id, min(max(qr_data.expires_in, 15), 300)
                    )
                )

        # A QR image can expire shortly after it is scanned, while Douyin may
        # still require the account owner to complete an in-app security
        # verification. Once the platform has acknowledged the scan, replace
        # the image-expiry timer with a one-time confirmation grace period.
        if result.status in {
            LoginStatus.SCANNED,
            LoginStatus.SECURITY_VERIFICATION,
        } and not sess.get("scan_extended"):
            sess["scan_extended"] = True
            expiry_task = sess.get("expiry_task")
            if expiry_task and expiry_task is not asyncio.current_task():
                expiry_task.cancel()
            elapsed = max(0, int(time.time() - sess["started_at"]))
            grace_seconds = max(30, min(180, 300 - elapsed))
            sess["expiry_task"] = asyncio.create_task(
                self._expire_login_session(session_id, grace_seconds)
            )

        if result.status == LoginStatus.CONFIRMED:
            # 先关闭生成二维码的浏览器，再用保存的 storage_state 新开一个
            # Chromium 重载验证；只有重载后仍登录才允许落盘和写数据库。
            platform = sess["platform"]
            account_id = sess["account_id"]
            if not result.full_state:
                await self._cleanup_session(session_id)
                return {
                    "status": LoginStatus.FAILED.value,
                    "message": "平台已确认扫码，但未返回可保存的登录态，请重新扫码",
                    "platform": platform,
                    "account_id": account_id,
                    "saved": False,
                }
            candidate_state = result.full_state
            base_user_info = _user_info_to_dict(result.user_info)
            completion_evidence = (qr_snapshot or {}).get("evidence") or {}
            await self._cleanup_session(session_id)

            validation_adapter = get_platform_adapter(platform)
            validation = await validation_adapter.validate_cookie(candidate_state)
            refreshed_state = validation.pop("storage_state", None)
            if not validation.get("valid"):
                return {
                    "status": LoginStatus.FAILED.value,
                    "message": str(
                        validation.get("reason")
                        or "storage_state 在新浏览器中重载失败，未保存账号"
                    ),
                    "platform": platform,
                    "account_id": account_id,
                    "saved": False,
                    "reload_verified": False,
                    "evidence": completion_evidence,
                }
            final_state = refreshed_state or candidate_state
            validation_user_info = validation.get("user_info") or {}
            base_user_info = _merge_user_info(base_user_info, validation_user_info)
            storage_user_info = extract_user_info_from_storage_state(
                platform, final_state
            )
            user_info = _merge_user_info(base_user_info, storage_user_info)

            real_account_id = (
                (user_info or {}).get("user_id")
                or ((user_info or {}).get("extra") or {}).get("user_id")
                or ((user_info or {}).get("extra") or {}).get("red_id")
            )
            # If start_login used a temporary id, replace it with the platform's real uid.
            if real_account_id and str(account_id).startswith("temp_"):
                account_id = str(real_account_id)

            self.cookie_manager.save(platform, account_id, final_state)

            return {
                "status": LoginStatus.CONFIRMED.value,
                "message": result.message or "登录成功",
                "platform": platform,
                "account_id": account_id,
                "user_info": user_info,
                "saved": True,
                "reload_verified": True,
                "reload_result": {
                    "reason": validation.get("reason"),
                    "page_url": validation.get("page_url"),
                    "creator_check": validation.get("creator_check"),
                    "reload_evidence": validation.get("reload_evidence"),
                },
                "evidence": completion_evidence,
            }

        response = {
            "status": result.status.value,
            "message": result.message or "",
            "platform": sess["platform"],
            "account_id": sess["account_id"],
        }
        if qr_snapshot:
            response.update(
                {
                    "qr_image": qr_snapshot.get("qr_image"),
                    "qr_version": qr_snapshot.get("qr_version"),
                    "token_hash": qr_snapshot.get("token_hash"),
                    "qr_hash": qr_snapshot.get("qr_hash"),
                    "generated_at": qr_snapshot.get("generated_at"),
                    "expires_in": qr_snapshot.get("expires_in"),
                    "official_status": qr_snapshot.get("official_status"),
                    "official_error_code": qr_snapshot.get("official_error_code"),
                    "evidence": qr_snapshot.get("evidence"),
                }
            )
        return response

    async def cancel_login(self, session_id: str) -> dict:
        """取消扫码登录会话。"""
        await self._cleanup_session(session_id)
        return {"session_id": session_id, "status": "cancelled"}

    async def _cleanup_session(self, session_id: str) -> None:
        async with self._lock:
            sess = self._login_sessions.pop(session_id, None)
        if not sess:
            return
        expiry_task = sess.get("expiry_task")
        if expiry_task and expiry_task is not asyncio.current_task():
            expiry_task.cancel()
        adapter: PlatformAdapter = sess["adapter"]
        try:
            await adapter.cleanup_session(session_id)
        except Exception as e:
            logger.warning("清理 session %s 失败: %s", session_id, e)

    async def _expire_login_session(self, session_id: str, expires_in: int) -> None:
        """Even abandoned browser sessions must release Chromium resources."""
        try:
            await asyncio.sleep(expires_in)
            await self._cleanup_session(session_id)
        except asyncio.CancelledError:
            return

    # ===== Cookie 校验 =====

    async def validate_account_cookie(self, platform: str, account_id: str) -> dict:
        """校验账号 cookie 是否仍有效。"""
        platform = normalize_platform(platform)
        storage_state = self.cookie_manager.load(platform, account_id)
        if not storage_state:
            return {"valid": False, "reason": "未找到本地 cookie，请先扫码登录"}

        adapter = get_platform_adapter(platform)
        # Account refresh only consumes validity and user metadata. The full
        # egress/fingerprint proof is still collected during final login
        # confirmation, but repeating it here adds up to 20 s without changing
        # the refresh result.
        loop = asyncio.get_running_loop()
        deadline = loop.time() + ACCOUNT_VALIDATE_TIMEOUT_SECONDS

        async def validate_once() -> dict:
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise asyncio.TimeoutError
            return await asyncio.wait_for(
                adapter.validate_cookie(
                    storage_state, include_reload_evidence=False
                ),
                timeout=remaining,
            )

        try:
            result = await validate_once()
            # 抖音创作者后台偶发在首个新 BrowserContext 打开时短暂跳转到
            # passport/login，但同一份强认证 Cookie 随后立即可通过官方账号
            # 接口。单次跳转不能把刚扫码成功的活跃账号误标为 expired。
            # 在同一个总预算内重新创建隔离浏览器确认一次；第二次网络/浏览器
            # 异常按 transient 处理，保留最后一次可信状态。
            if (
                platform == "douyin"
                and not result.get("valid")
                and not result.get("transient")
            ):
                first_reason = str(result.get("reason") or "")[:200]
                logger.warning(
                    "douyin account validation first attempt was invalid; "
                    "retrying before expiring account reason=%s",
                    first_reason,
                )
                await asyncio.sleep(ACCOUNT_VALIDATE_RETRY_DELAY_SECONDS)
                result = await validate_once()
        except asyncio.TimeoutError:
            return {
                "valid": False,
                "transient": True,
                "reason": (
                    f"{PLATFORM_NAMES.get(platform, platform)}账号校验在 "
                    f"{ACCOUNT_VALIDATE_TIMEOUT_SECONDS} 秒内未完成，"
                    "已取消刷新并保留原账号状态"
                ),
            }
        refreshed_state = result.pop("storage_state", None)
        if result.get("valid"):
            if refreshed_state:
                self.cookie_manager.save(platform, account_id, refreshed_state)
        else:
            # Keep invalid cookies for diagnostics/retry. 账号是否失效由数据库
            # cookie_status 标记；不要在“校验失败 / 网络失败 / 页面结构变化”
            # 时直接删除本地 cookie，否则会导致用户必须重新扫码。
            pass
        return result

    # ===== 内容发布 =====

    async def publish_content(
        self,
        platform: str,
        account_id: str,
        title: str,
        description: str,
        tags: list[str] | None = None,
        media_paths: list[str] | None = None,
        cover_path: str | None = None,
        publish_mode: str = "direct",
        scheduled_at: str | None = None,
        publish_params: dict[str, Any] | None = None,
    ) -> dict:
        """发布内容到指定平台。

        由 social-browser 内部服务直接调用。外层用并发信号量限制同时启动的
        浏览器数量，避免单机资源被大量发布任务耗尽。
        """
        platform = normalize_platform(platform)
        storage_state = self.cookie_manager.load(platform, account_id)
        if not storage_state:
            return {
                "success": False,
                "status": "cookie_missing",
                "error": f"未找到 {platform} 账号 {account_id} 的 cookie，请先扫码登录",
            }

        adapter = get_platform_adapter(platform)
        try:
            result = await adapter.publish_content(
                storage_state=storage_state,
                title=title,
                description=description,
                tags=tags or [],
                media_paths=media_paths or [],
                cover_path=cover_path,
                publish_mode=publish_mode,
                scheduled_at=scheduled_at,
                account_id=account_id,
                publish_params=publish_params or {},
            )
            # 发布成功后 cookie 可能已更新（页面刷新 cookie），尝试重新保存
            # 这里不强制更新，因为多数情况下 storage_state 不变
            return result
        except Exception as e:
            logger.exception("发布到 %s 失败", platform)
            return {
                "success": False,
                "status": "publish_error",
                "error": str(e),
            }

    async def delete_published_content(
        self,
        platform: str,
        account_id: str,
        publish_url: str | None = None,
        external_post_id: str | None = None,
        title: str | None = None,
    ) -> dict:
        """通过平台网页删除或下架已发布内容。"""
        platform = normalize_platform(platform)
        storage_state = self.cookie_manager.load(platform, account_id)
        if not storage_state:
            return {
                "success": False,
                "status": "cookie_missing",
                "error": f"未找到 {platform} 账号 {account_id} 的 cookie，请先扫码登录",
            }
        adapter = get_platform_adapter(platform)
        delete_fn = getattr(adapter, "delete_published_content", None)
        if delete_fn is None:
            return {
                "success": False,
                "status": "unsupported",
                "error": f"平台 {platform} 暂未接入内容删除能力",
            }
        try:
            return await delete_fn(
                storage_state=storage_state,
                publish_url=publish_url,
                external_post_id=external_post_id,
                title=title,
                account_id=account_id,
            )
        except Exception as e:
            logger.exception("删除 %s 内容失败", platform)
            return {"success": False, "status": "remote_action_failed", "error": str(e)}

    async def update_published_visibility(
        self,
        platform: str,
        account_id: str,
        visibility: str,
        publish_url: str | None = None,
        external_post_id: str | None = None,
        title: str | None = None,
    ) -> dict:
        """通过平台网页调整已发布内容可见性。"""
        platform = normalize_platform(platform)
        storage_state = self.cookie_manager.load(platform, account_id)
        if not storage_state:
            return {
                "success": False,
                "status": "cookie_missing",
                "error": f"未找到 {platform} 账号 {account_id} 的 cookie，请先扫码登录",
            }
        adapter = get_platform_adapter(platform)
        update_fn = getattr(adapter, "update_published_visibility", None)
        if update_fn is None:
            return {
                "success": False,
                "status": "unsupported",
                "error": f"平台 {platform} 暂未接入内容可见性调整能力",
            }
        try:
            return await update_fn(
                storage_state=storage_state,
                visibility=visibility,
                publish_url=publish_url,
                external_post_id=external_post_id,
                title=title,
                account_id=account_id,
            )
        except Exception as e:
            logger.exception("修改 %s 内容可见性失败", platform)
            return {"success": False, "status": "remote_action_failed", "error": str(e)}

    # ===== 账号管理 =====

    def list_saved_accounts(self, platform: str | None = None) -> list[dict]:
        """列出已保存 cookie 的账号。"""
        return self.cookie_manager.list_accounts(platform)

    def get_account_cookie_path(self, platform: str, account_id: str) -> str | None:
        """获取账号 cookie 文件路径。"""
        p = self.cookie_manager._path(platform, account_id)
        return str(p) if p.exists() else None

    def delete_account_cookie(self, platform: str, account_id: str) -> bool:
        """删除账号 cookie 文件。"""
        return self.cookie_manager.delete(platform, account_id)

    # ===== 平台元数据 =====

    @staticmethod
    def list_platforms() -> list[dict]:
        """返回支持的平台列表。"""
        return [
            {
                "code": code,
                "platform": plat,
                "name": PLATFORM_NAMES.get(plat, plat),
            }
            for plat, code in PLATFORM_CODES.items()
        ]

    @staticmethod
    def resolve_platform(code_or_name: str) -> str | None:
        """把平台 code（数字或名字）规范化为 platform 字符串。"""
        return normalize_platform(code_or_name)


def _json_loads_safe(value: Any) -> dict | None:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        loaded = json.loads(value)
        return loaded if isinstance(loaded, dict) else None
    except Exception:
        return None


def _mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = str(phone)
    if len(digits) < 7:
        return digits
    return f"{digits[:3]}****{digits[-4:]}"


def _cookie_lookup(
    storage_state: dict | None,
    names: tuple[str, ...],
) -> str | None:
    if not storage_state:
        return None
    cookies = storage_state.get("cookies") or []
    values = {
        str(cookie.get("name") or ""): str(cookie.get("value") or "")
        for cookie in cookies
        if cookie.get("name") and cookie.get("value")
    }
    for name in names:
        if values.get(name):
            return values[name]
    return None


def extract_user_info_from_storage_state(
    platform: str, storage_state: dict | None
) -> dict | None:
    """Extract platform account identity from Playwright storage_state.

    Xiaohongshu stores accurate creator account info in localStorage.USER_INFO_FOR_BIZ.
    Keeping this parser server-side lets old temp_* rows be repaired without another login.
    """
    if not storage_state:
        return None

    info: dict[str, Any] = {"extra": {}}
    for origin in storage_state.get("origins") or []:
        for item in origin.get("localStorage") or []:
            key = item.get("name")
            value = item.get("value")
            if key == "USER_INFO_FOR_BIZ":
                data = _json_loads_safe(value) or {}
                if data.get("userId"):
                    info["user_id"] = str(data.get("userId"))
                    info["extra"]["user_id"] = str(data.get("userId"))
                if data.get("userName"):
                    info["name"] = str(data.get("userName"))
                    info["username"] = str(data.get("userName"))
                if data.get("userAvatar"):
                    info["avatar"] = str(data.get("userAvatar"))
                if data.get("redId"):
                    info["extra"]["red_id"] = str(data.get("redId"))
                if data.get("role"):
                    info["extra"]["role"] = str(data.get("role"))
                if data.get("zone"):
                    info["extra"]["zone"] = str(data.get("zone"))
                if "realNameVerified" in data:
                    info["extra"]["real_name_verified"] = bool(
                        data.get("realNameVerified")
                    )
                masked = _mask_phone(data.get("phone"))
                if masked:
                    info["extra"]["phone_masked"] = masked
            elif key == "USER_INFO":
                data = _json_loads_safe(value) or {}
                nested = (
                    ((data.get("user") or {}).get("value") or {})
                    if isinstance(data.get("user"), dict)
                    else {}
                )
                if nested.get("userId") and not info.get("user_id"):
                    info["user_id"] = str(nested.get("userId"))
                    info["extra"]["user_id"] = str(nested.get("userId"))
                if nested.get("loginUserType"):
                    info["extra"]["login_user_type"] = str(nested.get("loginUserType"))

    if platform == "xiaohongshu":
        cookie_uid = _cookie_lookup(
            storage_state, ("x-user-id-creator.xiaohongshu.com",)
        )
        if cookie_uid and not info.get("user_id"):
            info["user_id"] = cookie_uid
            info["extra"]["user_id"] = cookie_uid
        client_id = _cookie_lookup(storage_state, ("customerClientId",))
        if client_id:
            info["extra"]["customer_client_id"] = client_id

    if platform == "bilibili":
        mid = _cookie_lookup(storage_state, ("DedeUserID",))
        if mid:
            info["user_id"] = mid
            info["extra"]["mid"] = mid
            info["extra"]["user_id"] = mid

    if platform == "douyin":
        for origin in storage_state.get("origins") or []:
            for item in origin.get("localStorage") or []:
                key = item.get("name")
                value = item.get("value")
                if key == "SLARDARdouyin_creator_longvideo":
                    data = _json_loads_safe(value) or {}
                    if data.get("userId"):
                        info["user_id"] = str(data.get("userId"))
                        info["extra"]["user_id"] = str(data.get("userId"))
                    if data.get("deviceId"):
                        info["extra"]["device_id"] = str(data.get("deviceId"))
        cookie_uid = _cookie_lookup(storage_state, ("uid_tt", "uid_tt_ss"))
        if cookie_uid:
            info["extra"]["uid_tt"] = cookie_uid

    if platform == "kuaishou":
        uid = _cookie_lookup(storage_state, ("userId",))
        if uid:
            info["user_id"] = uid
            info["extra"]["kwai_id"] = uid
            info["extra"]["user_id"] = uid

    # Channels' finder_username/wxuin/uin cookie values identify the current
    # browser session and can change when the same Video Account signs in
    # again.  The stable account identity comes from the signed auth_data
    # response captured by BuiltinPlatformAdapter; never let storage_state
    # cookie parsing replace it during the final merge.

    return (
        info
        if any(v for k, v in info.items() if k != "extra") or info.get("extra")
        else None
    )


def _merge_user_info(*parts: dict | None) -> dict | None:
    merged: dict[str, Any] = {"extra": {}}
    has_value = False
    for part in parts:
        if not part:
            continue
        for key, value in part.items():
            if key == "extra" and isinstance(value, dict):
                for ek, ev in value.items():
                    if ev not in (None, ""):
                        merged["extra"][ek] = ev
                        has_value = True
            elif value not in (None, ""):
                merged[key] = value
                has_value = True
    if not merged.get("extra"):
        merged.pop("extra", None)
    return merged if has_value else None


def _user_info_to_dict(user_info) -> dict | None:
    if user_info is None:
        return None
    return {
        "user_id": user_info.user_id,
        "name": user_info.name,
        "username": user_info.username,
        "avatar": user_info.avatar,
        "extra": user_info.extra or {},
    }


__all__ = ["EmbeddedSynapseService", "extract_user_info_from_storage_state"]
