#!/bin/sh
set -eu

test -S /tmp/.X11-unix/X99
test -f /tmp/.X99-lock

xvfb_pid="$(tr -d ' ' </tmp/.X99-lock)"
test -n "$xvfb_pid"
kill -0 "$xvfb_pid"

curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null
curl -fsS http://127.0.0.1:8000/health/ready >/dev/null
