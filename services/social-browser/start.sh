#!/bin/sh
set -eu

display_number="${SYNAPSE_X_DISPLAY_NUMBER:-99}"
display=":${display_number}"
lock_file="/tmp/.X${display_number}-lock"
socket_file="/tmp/.X11-unix/X${display_number}"

xvfb_pid=""
x11vnc_pid=""
websockify_pid=""
uvicorn_pid=""

cleanup() {
  trap - EXIT INT TERM
  for pid in "$uvicorn_pid" "$websockify_pid" "$x11vnc_pid" "$xvfb_pid"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  rm -f "$lock_file" "$socket_file"
}
trap cleanup EXIT INT TERM

# A container restart keeps /tmp. Remove only a stale X lock/socket; never
# replace a live display belonging to another Xvfb process.
if [ -f "$lock_file" ]; then
  existing_pid="$(tr -cd '0-9' <"$lock_file" 2>/dev/null || true)"
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "X display ${display} is already owned by live pid ${existing_pid}" >&2
    exit 1
  fi
fi
rm -f "$lock_file" "$socket_file"

Xvfb "$display" -screen 0 1280x800x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
xvfb_pid="$!"

ready=0
attempt=0
while [ "$attempt" -lt 20 ]; do
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then
    echo "Xvfb exited before display ${display} became ready" >&2
    tail -80 /tmp/xvfb.log >&2 || true
    exit 1
  fi
  if [ -S "$socket_file" ]; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.5
done

if [ "$ready" -ne 1 ]; then
  echo "Xvfb display ${display} did not become ready within 10 seconds" >&2
  tail -80 /tmp/xvfb.log >&2 || true
  exit 1
fi

export DISPLAY="$display"

x11vnc -display "$display" -forever -shared -nopw -localhost -rfbport 5900 \
  >/tmp/x11vnc.log 2>&1 &
x11vnc_pid="$!"
sleep 0.5
if ! kill -0 "$x11vnc_pid" 2>/dev/null; then
  echo "x11vnc failed to start" >&2
  tail -80 /tmp/x11vnc.log >&2 || true
  exit 1
fi

websockify --web=/opt/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
websockify_pid="$!"
sleep 0.5
if ! kill -0 "$websockify_pid" 2>/dev/null; then
  echo "websockify failed to start" >&2
  tail -80 /tmp/websockify.log >&2 || true
  exit 1
fi

uvicorn app.main:app --host 0.0.0.0 --port 8000 &
uvicorn_pid="$!"
wait "$uvicorn_pid"
