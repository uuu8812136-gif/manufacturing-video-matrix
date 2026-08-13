#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/host-browser-bridge.pid"
LOG_FILE="$RUNTIME_DIR/host-browser-bridge.log"
BRIDGE_SCRIPT="$ROOT_DIR/scripts/host_browser_bridge.py"
PLIST_TEMPLATE="$ROOT_DIR/scripts/host-browser-bridge.plist.in"
PLIST_FILE="$RUNTIME_DIR/com.mvms.host-browser-bridge.plist"
LAUNCH_LABEL="com.mvms.host-browser-bridge"
LAUNCHD_BRIDGE_SCRIPT="/private/tmp/mvms-host-browser-bridge.py"
LAUNCHD_KEY_FILE="/private/tmp/mvms-host-browser-bridge.key"
LAUNCHD_LOG_FILE="/private/tmp/mvms-host-browser-bridge.log"
BRIDGE_HOST="${MVMS_BROWSER_BRIDGE_HOST:-0.0.0.0}"
BRIDGE_PORT="${MVMS_BROWSER_BRIDGE_PORT:-18082}"
PYTHON_BIN="${MVMS_PYTHON_BIN:-python3}"

mkdir -p "$RUNTIME_DIR"
umask 077

is_owned_process() {
  pid="$1"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command=$(ps -p "$pid" -o command= 2>/dev/null || true)
  case "$command" in
    *host_browser_bridge.py*) return 0 ;;
    *) return 1 ;;
  esac
}

health_ok() {
  curl -fsS --max-time 2 "http://127.0.0.1:${BRIDGE_PORT}/health" >/dev/null 2>&1
}

launchd_domain() {
  printf 'gui/%s' "$(id -u)"
}

launchd_loaded() {
  launchctl print "$(launchd_domain)/$LAUNCH_LABEL" >/dev/null 2>&1
}

render_launchd_plist() {
  if [ ! -f "$ROOT_DIR/.env" ]; then
    echo "Missing $ROOT_DIR/.env" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
  bridge_key="${SOCIAL_BROWSER_API_KEY:-${JWT_SECRET:-}}"
  if [ "${#bridge_key}" -lt 32 ]; then
    echo "SOCIAL_BROWSER_API_KEY/JWT_SECRET must contain at least 32 characters" >&2
    exit 1
  fi

  resolved_python=$(command -v "$PYTHON_BIN")
  cp "$BRIDGE_SCRIPT" "$LAUNCHD_BRIDGE_SCRIPT"
  chmod 700 "$LAUNCHD_BRIDGE_SCRIPT"
  printf '%s' "$bridge_key" >"$LAUNCHD_KEY_FILE"
  chmod 600 "$LAUNCHD_KEY_FILE"
  : >"$LAUNCHD_LOG_FILE"
  chmod 600 "$LAUNCHD_LOG_FILE"

  escaped_python=$(printf '%s' "$resolved_python" | sed 's/[&|]/\\&/g')
  escaped_script=$(printf '%s' "$LAUNCHD_BRIDGE_SCRIPT" | sed 's/[&|]/\\&/g')
  escaped_key=$(printf '%s' "$LAUNCHD_KEY_FILE" | sed 's/[&|]/\\&/g')
  escaped_log=$(printf '%s' "$LAUNCHD_LOG_FILE" | sed 's/[&|]/\\&/g')
  escaped_host=$(printf '%s' "$BRIDGE_HOST" | sed 's/[&|]/\\&/g')
  escaped_port=$(printf '%s' "$BRIDGE_PORT" | sed 's/[&|]/\\&/g')
  sed \
    -e "s|__PYTHON_BIN__|$escaped_python|g" \
    -e "s|__BRIDGE_SCRIPT__|$escaped_script|g" \
    -e "s|__KEY_FILE__|$escaped_key|g" \
    -e "s|__LAUNCHD_LOG_FILE__|$escaped_log|g" \
    -e "s|__BRIDGE_HOST__|$escaped_host|g" \
    -e "s|__BRIDGE_PORT__|$escaped_port|g" \
    "$PLIST_TEMPLATE" >"$PLIST_FILE"
  chmod 600 "$PLIST_FILE"
}

start_launchd_bridge() {
  if launchd_loaded && health_ok; then
    echo "MVMS host Edge bridge is already running under launchd."
    return
  fi
  if launchd_loaded; then
    launchctl bootout "$(launchd_domain)/$LAUNCH_LABEL" >/dev/null 2>&1 || true
  fi
  render_launchd_plist
  launchctl bootstrap "$(launchd_domain)" "$PLIST_FILE"
  launchctl kickstart -k "$(launchd_domain)/$LAUNCH_LABEL"

  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if health_ok; then
      echo "MVMS host Edge bridge is ready under launchd (port $BRIDGE_PORT)."
      return
    fi
    attempts=$((attempts + 1))
    sleep 0.25
  done
  echo "MVMS host Edge bridge did not become ready in 15 seconds." >&2
  tail -80 "$LAUNCHD_LOG_FILE" >&2 || true
  exit 1
}

start_legacy_bridge() {
  if [ -f "$PID_FILE" ]; then
    pid=$(tr -cd '0-9' <"$PID_FILE")
    if is_owned_process "$pid" && health_ok; then
      echo "MVMS host Edge bridge is already running (pid $pid)."
      return
    fi
    if is_owned_process "$pid"; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi

  if [ ! -f "$ROOT_DIR/.env" ]; then
    echo "Missing $ROOT_DIR/.env" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
  bridge_key="${SOCIAL_BROWSER_API_KEY:-${JWT_SECRET:-}}"
  if [ "${#bridge_key}" -lt 32 ]; then
    echo "SOCIAL_BROWSER_API_KEY/JWT_SECRET must contain at least 32 characters" >&2
    exit 1
  fi
  export MVMS_BROWSER_BRIDGE_KEY="$bridge_key"

  nohup "$PYTHON_BIN" "$BRIDGE_SCRIPT" \
    --host "$BRIDGE_HOST" \
    --port "$BRIDGE_PORT" \
    >"$LOG_FILE" 2>&1 </dev/null &
  pid=$!
  echo "$pid" >"$PID_FILE"

  attempts=0
  while [ "$attempts" -lt 40 ]; do
    if health_ok; then
      echo "MVMS host Edge bridge is ready (pid $pid, port $BRIDGE_PORT)."
      return
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "MVMS host Edge bridge exited during startup." >&2
      tail -80 "$LOG_FILE" >&2 || true
      rm -f "$PID_FILE"
      exit 1
    fi
    attempts=$((attempts + 1))
    sleep 0.25
  done
  echo "MVMS host Edge bridge did not become ready in 10 seconds." >&2
  tail -80 "$LOG_FILE" >&2 || true
  kill "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  exit 1
}

start_bridge() {
  if [ "$(uname -s)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
    start_launchd_bridge
  else
    start_legacy_bridge
  fi
}

stop_legacy_bridge() {
  if [ ! -f "$PID_FILE" ]; then
    echo "MVMS host Edge bridge is not running."
    return
  fi
  pid=$(tr -cd '0-9' <"$PID_FILE")
  if is_owned_process "$pid"; then
    kill "$pid"
    attempts=0
    while kill -0 "$pid" 2>/dev/null && [ "$attempts" -lt 20 ]; do
      attempts=$((attempts + 1))
      sleep 0.25
    done
  fi
  rm -f "$PID_FILE"
  echo "MVMS host Edge bridge stopped."
}

stop_bridge() {
  if [ "$(uname -s)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
    if launchd_loaded; then
      launchctl bootout "$(launchd_domain)/$LAUNCH_LABEL"
      echo "MVMS host Edge bridge stopped."
    else
      echo "MVMS host Edge bridge is not running."
    fi
    rm -f "$LAUNCHD_BRIDGE_SCRIPT" "$LAUNCHD_KEY_FILE"
    return
  fi
  stop_legacy_bridge
}

status_legacy_bridge() {
  if [ -f "$PID_FILE" ]; then
    pid=$(tr -cd '0-9' <"$PID_FILE")
    if is_owned_process "$pid" && health_ok; then
      echo "MVMS host Edge bridge is running (pid $pid, port $BRIDGE_PORT)."
      return
    fi
  fi
  echo "MVMS host Edge bridge is not running."
  exit 1
}

status_bridge() {
  if [ "$(uname -s)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
    if launchd_loaded && health_ok; then
      echo "MVMS host Edge bridge is running under launchd (port $BRIDGE_PORT)."
      return
    fi
    echo "MVMS host Edge bridge is not running."
    exit 1
  fi
  status_legacy_bridge
}

case "${1:-start}" in
  start) start_bridge ;;
  stop) stop_bridge ;;
  restart)
    stop_bridge
    start_bridge
    ;;
  status) status_bridge ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
