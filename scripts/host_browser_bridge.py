#!/usr/bin/env python3
"""Launch short-lived, visible platform-login windows in the host Edge.

The application browser automation runs in Docker, while account owners need
to finish official security checks in a real macOS window.  This bridge owns
only the host Edge process.  Playwright in ``social-browser`` connects to the
same window over CDP, reads the resulting storage state, and closes the window
after confirmation.

The control API requires the existing SOCIAL_BROWSER_API_KEY.  Login URLs are
also restricted to an explicit official-domain allowlist.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


SESSION_PATTERN = re.compile(r"^[a-f0-9]{32}$")
ALLOWED_PLATFORM_HOSTS = {
    "douyin": {"creator.douyin.com"},
    "xiaohongshu": {"creator.xiaohongshu.com"},
    "channels": {"channels.weixin.qq.com"},
    "kuaishou": {"passport.kuaishou.com", "cp.kuaishou.com"},
    "bilibili": {"passport.bilibili.com", "member.bilibili.com"},
    "baijiahao": {"baijiahao.baidu.com"},
}
EDGE_DEFAULT = (
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)


def _json_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )


def _available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _official_login_url(platform: str, raw_url: str) -> str:
    parsed = urlsplit(raw_url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise ValueError("登录页必须是无内嵌凭据的 HTTPS 官方地址")
    if hostname not in ALLOWED_PLATFORM_HOSTS.get(platform, set()):
        raise ValueError("登录页不在允许的官方平台域名中")
    return raw_url


@dataclass
class EdgeSession:
    session_id: str
    platform: str
    process: subprocess.Popen[bytes]
    profile_dir: Path
    debug_port: int
    ws_endpoint: str


class BridgeState:
    def __init__(self, *, edge_path: Path, public_cdp_host: str) -> None:
        self.edge_path = edge_path
        self.public_cdp_host = public_cdp_host
        self.root = Path(tempfile.gettempdir()) / "mvms-host-browser-bridge"
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.sessions: dict[str, EdgeSession] = {}
        self.lock = threading.RLock()

    def start(self, session_id: str, platform: str, login_url: str) -> EdgeSession:
        if not SESSION_PATTERN.fullmatch(session_id):
            raise ValueError("无效的扫码会话 ID")
        official_url = _official_login_url(platform, login_url)
        if not self.edge_path.is_file():
            raise RuntimeError(f"未找到 Microsoft Edge: {self.edge_path}")

        with self.lock:
            self.stop(session_id)
            profile_dir = self.root / session_id
            if profile_dir.exists():
                shutil.rmtree(profile_dir, ignore_errors=True)
            profile_dir.mkdir(mode=0o700, parents=True)
            debug_port = _available_port()
            command = [
                str(self.edge_path),
                f"--remote-debugging-port={debug_port}",
                "--remote-debugging-address=127.0.0.1",
                "--remote-allow-origins=*",
                f"--user-data-dir={profile_dir}",
                f"--user-agent={USER_AGENT}",
                "--lang=zh-CN",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--disable-component-extensions-with-background-pages",
                "--disable-background-mode",
                "--disable-sync",
                "--new-window",
                "about:blank",
            ]
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )

            version: dict[str, Any] | None = None
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    break
                try:
                    request = Request(
                        f"http://127.0.0.1:{debug_port}/json/version",
                        headers={"Host": f"localhost:{debug_port}"},
                    )
                    with urlopen(request, timeout=1) as response:
                        version = json.loads(response.read().decode("utf-8"))
                    if version.get("webSocketDebuggerUrl"):
                        break
                except Exception:
                    time.sleep(0.2)

            if not version or not version.get("webSocketDebuggerUrl"):
                self._terminate(process)
                shutil.rmtree(profile_dir, ignore_errors=True)
                raise RuntimeError("Edge 调试端口未在 20 秒内就绪")

            parsed_ws = urlsplit(str(version["webSocketDebuggerUrl"]))
            ws_endpoint = (
                f"ws://{self.public_cdp_host}:{debug_port}{parsed_ws.path}"
            )
            session = EdgeSession(
                session_id=session_id,
                platform=platform,
                process=process,
                profile_dir=profile_dir,
                debug_port=debug_port,
                ws_endpoint=ws_endpoint,
            )
            self.sessions[session_id] = session
            # The Docker Playwright connection navigates this same blank page
            # to ``official_url`` immediately. Validate it here so no arbitrary
            # destination can be smuggled through the bridge.
            _ = official_url
            return session

    def stop(self, session_id: str) -> bool:
        with self.lock:
            session = self.sessions.pop(session_id, None)
        if session is None:
            return False
        self._terminate(session.process)
        shutil.rmtree(session.profile_dir, ignore_errors=True)
        return True

    def stop_all(self) -> None:
        with self.lock:
            session_ids = list(self.sessions)
        for session_id in session_ids:
            self.stop(session_id)

    @staticmethod
    def _terminate(process: subprocess.Popen[bytes]) -> None:
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            try:
                process.terminate()
            except ProcessLookupError:
                return
        try:
            process.wait(timeout=4)
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            try:
                process.kill()
            except ProcessLookupError:
                return
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            return


class BridgeHandler(BaseHTTPRequestHandler):
    server: "BridgeServer"

    def log_message(self, format: str, *args: object) -> None:
        # Keep the host log concise and never include request headers.
        print(f"[host-browser-bridge] {self.address_string()} {format % args}")

    def _send(self, status: HTTPStatus, value: dict[str, Any]) -> None:
        body = _json_bytes(value)
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        supplied = self.headers.get("X-Internal-Key", "")
        return bool(supplied) and hmac.compare_digest(
            supplied, self.server.api_key
        )

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("无效的 Content-Length") from exc
        if length < 2 or length > 16_384:
            raise ValueError("请求体大小无效")
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("请求体不是有效 JSON") from exc
        if not isinstance(value, dict):
            raise ValueError("请求体必须是 JSON 对象")
        return value

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "browser": self.server.state.edge_path.name,
                    "activeSessions": len(self.server.state.sessions),
                },
            )
            return
        self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorized():
            self._send(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return
        try:
            if self.path == "/v1/sessions":
                body = self._read_json()
                session = self.server.state.start(
                    str(body.get("sessionId") or ""),
                    str(body.get("platform") or "").strip().lower(),
                    str(body.get("loginUrl") or "").strip(),
                )
                self._send(
                    HTTPStatus.CREATED,
                    {
                        "sessionId": session.session_id,
                        "wsEndpoint": session.ws_endpoint,
                        "hostHeader": f"localhost:{session.debug_port}",
                        "browser": "Microsoft Edge",
                        "visible": True,
                    },
                )
                return
            match = re.fullmatch(r"/v1/sessions/([a-f0-9]{32})/stop", self.path)
            if match:
                stopped = self.server.state.stop(match.group(1))
                self._send(HTTPStatus.OK, {"stopped": stopped})
                return
            self._send(HTTPStatus.NOT_FOUND, {"error": "not found"})
        except ValueError as exc:
            self._send(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            self._send(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": str(exc)[:300] or "启动 Edge 失败"},
            )


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        *,
        api_key: str,
        state: BridgeState,
    ) -> None:
        super().__init__(address, BridgeHandler)
        self.api_key = api_key
        self.state = state


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18082)
    parser.add_argument("--public-cdp-host", default="host.docker.internal")
    parser.add_argument(
        "--edge-path",
        default=os.getenv("MVMS_EDGE_PATH", EDGE_DEFAULT),
    )
    args = parser.parse_args()

    api_key = os.getenv("MVMS_BROWSER_BRIDGE_KEY", "")
    key_file = os.getenv("MVMS_BROWSER_BRIDGE_KEY_FILE", "")
    if not api_key and key_file:
        try:
            api_key = Path(key_file).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise SystemExit(
                f"Cannot read MVMS_BROWSER_BRIDGE_KEY_FILE: {exc}"
            ) from exc
    if len(api_key) < 32:
        raise SystemExit(
            "MVMS_BROWSER_BRIDGE_KEY must contain at least 32 characters"
        )
    state = BridgeState(
        edge_path=Path(args.edge_path),
        public_cdp_host=args.public_cdp_host,
    )
    server = BridgeServer(
        (args.host, args.port),
        api_key=api_key,
        state=state,
    )

    def shutdown(_signum: int, _frame: object) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    print(
        f"[host-browser-bridge] ready on {args.host}:{args.port}; "
        f"Edge={args.edge_path}"
    )
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        state.stop_all()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
