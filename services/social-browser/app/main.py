from __future__ import annotations

import asyncio
import hmac
import ipaddress
import mimetypes
import os
import re
import socket
import tempfile
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import get_settings
from app.integrations.synapse_engine.service import EmbeddedSynapseService
from app.integrations.synapse_engine.utils.playwright_provider import (
    assert_chromium_ready,
)


PUBLIC_TO_ENGINE = {
    "video_account": "channels",
    "xiaohongshu": "xiaohongshu",
    "douyin": "douyin",
    "kuaishou": "kuaishou",
    "bilibili": "bilibili",
    "baijiahao": "baijiahao",
}
ENGINE_TO_PUBLIC = {value: key for key, value in PUBLIC_TO_ENGINE.items()}
ACCOUNT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,100}$")

app = FastAPI(title="MVMS Social Browser", version="1.0.0")
service = EmbeddedSynapseService()
publish_slots = asyncio.Semaphore(max(1, int(os.getenv("SOCIAL_BROWSER_CONCURRENCY", "2"))))


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


PlatformName = Literal[
    "video_account",
    "xiaohongshu",
    "douyin",
    "kuaishou",
    "bilibili",
    "baijiahao",
]


class LoginStartRequest(StrictModel):
    platform: PlatformName
    accountId: str = Field(min_length=8, max_length=100)


class AccountRequest(StrictModel):
    platform: PlatformName
    accountId: str = Field(min_length=8, max_length=100)


class PublishVideoRequest(AccountRequest):
    videoUrl: str = Field(min_length=1, max_length=4096)
    title: str = Field(min_length=1, max_length=500)
    coverUrl: str | None = Field(default=None, max_length=4096)
    tags: list[str] = Field(default_factory=list, max_length=50)
    attachType: str | None = Field(default=None, max_length=100)
    attachValue: str | None = Field(default=None, max_length=500)


class PublishImageTextRequest(AccountRequest):
    images: list[str] = Field(default_factory=list, max_length=20)
    title: str = Field(min_length=1, max_length=500)
    body: str = Field(default="", max_length=100_000)
    tags: list[str] = Field(default_factory=list, max_length=50)
    attachType: str | None = Field(default=None, max_length=100)
    attachValue: str | None = Field(default=None, max_length=500)

class BackupFile(StrictModel):
    platform: str = Field(min_length=1, max_length=50)
    accountId: str = Field(min_length=1, max_length=100)
    contentBase64: str = Field(min_length=1, max_length=70 * 1024 * 1024)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    size: int = Field(ge=1, le=50 * 1024 * 1024)


class LoginStateSnapshot(StrictModel):
    version: Literal[1]
    exportedAt: str = Field(min_length=1, max_length=100)
    files: list[BackupFile] = Field(default_factory=list, max_length=500)


class RestoreLoginStateRequest(StrictModel):
    snapshot: LoginStateSnapshot
    replace: bool = True


def require_internal_key(x_internal_key: str | None = Header(default=None)) -> None:
    expected = get_settings().SOCIAL_BROWSER_API_KEY
    if not x_internal_key or not hmac.compare_digest(x_internal_key, expected):
        raise HTTPException(status_code=401, detail="invalid internal key")


def engine_platform(platform: str) -> str:
    result = PUBLIC_TO_ENGINE.get(platform)
    if not result:
        raise HTTPException(status_code=400, detail=f"unsupported platform: {platform}")
    return result


def validate_account_id(account_id: str) -> str:
    if not ACCOUNT_ID_PATTERN.fullmatch(account_id):
        raise HTTPException(status_code=400, detail="invalid account id")
    return account_id


@app.get("/health/live")
async def health_live() -> dict[str, bool]:
    return {"ok": True}


@app.get("/health/ready")
async def health_ready() -> dict[str, Any]:
    settings = get_settings()
    try:
        executable = assert_chromium_ready(
            settings.SYNAPSE_LOCAL_CHROME_PATH,
            headless=settings.SYNAPSE_PLAYWRIGHT_HEADLESS,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "browser": Path(executable).name}


@app.post("/login/start", dependencies=[Depends(require_internal_key)])
async def login_start(body: LoginStartRequest) -> dict[str, Any]:
    account_id = validate_account_id(body.accountId)
    try:
        result = await service.start_login(engine_platform(body.platform), account_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"启动扫码失败：{str(exc)[:300]}") from exc
    return {
        "sessionId": result["session_id"],
        "platform": body.platform,
        "qrImage": result["qr_image"],
        "expiresIn": result["expires_in"],
        "qrVersion": result.get("qr_version", 1),
        "tokenHash": result.get("token_hash"),
        "qrHash": result.get("qr_hash"),
        "generatedAt": result.get("generated_at"),
        "evidence": result.get("evidence"),
    }


@app.get("/login/{session_id}/status", dependencies=[Depends(require_internal_key)])
async def login_status(session_id: str) -> dict[str, Any]:
    if not ACCOUNT_ID_PATTERN.fullmatch(session_id):
        raise HTTPException(status_code=400, detail="invalid session id")
    result = await service.poll_login_status(session_id)
    platform = ENGINE_TO_PUBLIC.get(str(result.get("platform") or ""))
    return {
        "status": result.get("status", "waiting"),
        "message": result.get("message", ""),
        "platform": platform,
        "accountId": result.get("account_id"),
        "userInfo": result.get("user_info"),
        "saved": bool(result.get("saved")),
        "reloadVerified": bool(result.get("reload_verified")),
        "reloadResult": result.get("reload_result"),
        "qrImage": result.get("qr_image"),
        "qrVersion": result.get("qr_version"),
        "tokenHash": result.get("token_hash"),
        "qrHash": result.get("qr_hash"),
        "generatedAt": result.get("generated_at"),
        "expiresIn": result.get("expires_in"),
        "officialStatus": result.get("official_status"),
        "officialErrorCode": result.get("official_error_code"),
        "evidence": result.get("evidence"),
    }


@app.delete("/login/{session_id}", dependencies=[Depends(require_internal_key)])
async def login_cancel(session_id: str) -> dict[str, Any]:
    if not ACCOUNT_ID_PATTERN.fullmatch(session_id):
        raise HTTPException(status_code=400, detail="invalid session id")
    return await service.cancel_login(session_id)


@app.post("/account/check", dependencies=[Depends(require_internal_key)])
async def account_check(body: AccountRequest) -> dict[str, Any]:
    account_id = validate_account_id(body.accountId)
    result = await service.validate_account_cookie(
        engine_platform(body.platform), account_id
    )
    return {
        "valid": bool(result.get("valid")),
        "transient": bool(result.get("transient")),
        "reason": result.get("reason"),
        "userInfo": result.get("user_info"),
    }


@app.delete("/account", dependencies=[Depends(require_internal_key)])
async def account_delete(body: AccountRequest) -> dict[str, Any]:
    account_id = validate_account_id(body.accountId)
    deleted = service.delete_account_cookie(engine_platform(body.platform), account_id)
    return {"deleted": deleted}


@app.get("/maintenance/backup", dependencies=[Depends(require_internal_key)])
async def backup_login_states() -> dict[str, Any]:
    try:
        return service.cookie_manager.export_encrypted_snapshot()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"导出扫码登录态失败：{str(exc)[:300]}",
        ) from exc


@app.post("/maintenance/restore", dependencies=[Depends(require_internal_key)])
async def restore_login_states(body: RestoreLoginStateRequest) -> dict[str, Any]:
    try:
        return service.cookie_manager.restore_encrypted_snapshot(
            body.snapshot.model_dump(),
            replace=body.replace,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)[:300]) from exc


def _rewrite_url(url: str) -> str:
    value = url.strip()
    for source, target in get_settings().SOCIAL_BROWSER_URL_REWRITE:
        if value == source or value.startswith(f"{source}/"):
            return f"{target}{value[len(source):]}"
    return value


async def _assert_safe_media_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="素材地址必须是 HTTP/HTTPS URL")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="素材地址不能包含账号密码")
    hostname = parsed.hostname.lower()
    if hostname in get_settings().SOCIAL_BROWSER_ALLOWED_PRIVATE_HOSTS:
        return

    try:
        infos = await asyncio.to_thread(
            socket.getaddrinfo, hostname, parsed.port or (443 if parsed.scheme == "https" else 80)
        )
    except OSError as exc:
        raise HTTPException(status_code=400, detail="素材域名无法解析") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        ):
            raise HTTPException(status_code=400, detail="素材地址解析到受限网络")


def _suffix(url: str, content_type: str | None) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        return suffix
    guessed = mimetypes.guess_extension((content_type or "").split(";", 1)[0].strip())
    return guessed or ".bin"


async def _download_media(url: str, directory: Path, index: int) -> str:
    current = _rewrite_url(url)
    max_bytes = get_settings().SOCIAL_BROWSER_MAX_MEDIA_BYTES
    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0), follow_redirects=False) as client:
        for _ in range(6):
            await _assert_safe_media_url(current)
            async with client.stream("GET", current) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise HTTPException(status_code=502, detail="素材下载重定向缺少地址")
                    current = urljoin(current, location)
                    continue
                if response.status_code < 200 or response.status_code >= 300:
                    raise HTTPException(
                        status_code=502,
                        detail=f"素材下载失败：HTTP {response.status_code}",
                    )
                length = int(response.headers.get("content-length") or 0)
                if length > max_bytes:
                    raise HTTPException(status_code=413, detail="素材文件超过大小限制")
                target = directory / f"media-{index}{_suffix(current, response.headers.get('content-type'))}"
                total = 0
                with target.open("wb") as output:
                    async for chunk in response.aiter_bytes(1024 * 1024):
                        total += len(chunk)
                        if total > max_bytes:
                            raise HTTPException(status_code=413, detail="素材文件超过大小限制")
                        output.write(chunk)
                return str(target)
    raise HTTPException(status_code=502, detail="素材下载重定向次数过多")


def _publish_response(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "success": bool(result.get("success")),
        "platformContentId": result.get("external_post_id"),
        "publishUrl": result.get("publish_url"),
        "status": result.get("status"),
        "message": result.get("message") or result.get("error"),
    }


@app.post("/publish/video", dependencies=[Depends(require_internal_key)])
async def publish_video(body: PublishVideoRequest) -> dict[str, Any]:
    account_id = validate_account_id(body.accountId)
    async with publish_slots:
        with tempfile.TemporaryDirectory(prefix="mvms-social-") as tmp:
            directory = Path(tmp)
            video = await _download_media(body.videoUrl, directory, 0)
            cover = (
                await _download_media(body.coverUrl, directory, 1)
                if body.coverUrl
                else None
            )
            result = await service.publish_content(
                platform=engine_platform(body.platform),
                account_id=account_id,
                title=body.title,
                description=body.title,
                tags=body.tags,
                media_paths=[video],
                cover_path=cover,
                publish_params={"visibility": "public"},
            )
    return _publish_response(result)


@app.post("/publish/image-text", dependencies=[Depends(require_internal_key)])
async def publish_image_text(body: PublishImageTextRequest) -> dict[str, Any]:
    account_id = validate_account_id(body.accountId)
    async with publish_slots:
        with tempfile.TemporaryDirectory(prefix="mvms-social-") as tmp:
            directory = Path(tmp)
            images = [
                await _download_media(url, directory, index)
                for index, url in enumerate(body.images)
            ]
            result = await service.publish_content(
                platform=engine_platform(body.platform),
                account_id=account_id,
                title=body.title,
                description=body.body,
                tags=body.tags,
                media_paths=images,
                publish_params={"visibility": "public"},
            )
    return _publish_response(result)
