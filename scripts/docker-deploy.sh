#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mvms-docker-build.XXXXXX")

cleanup() {
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT INT TERM

echo "[1/6] Starting the macOS Edge login bridge..."
sh "$ROOT_DIR/scripts/host-browser-bridge.sh" start

echo "[2/6] Preparing an ASCII-only Docker build context..."
rsync -a \
  --exclude '.git/' \
  --exclude '.pnpm-store/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'coverage/' \
  --exclude 'e2e-report/' \
  --exclude 'test-results/' \
  --exclude '*.tsbuildinfo' \
  --exclude '.env' \
  "$ROOT_DIR/" "$BUILD_DIR/"

echo "[3/6] Building the social browser image..."
docker build --progress plain \
  -t mfg-video-matrix-social-browser:latest \
  "$BUILD_DIR/services/social-browser"

echo "[4/6] Building the backend image..."
docker build --progress plain \
  -f "$BUILD_DIR/Dockerfile.backend" \
  -t mfg-video-matrix-backend:latest \
  "$BUILD_DIR"

echo "[5/6] Building the frontend image..."
docker build --progress plain \
  -f "$BUILD_DIR/Dockerfile.frontend" \
  -t mfg-video-matrix-frontend:latest \
  "$BUILD_DIR"

echo "[6/6] Starting the complete application..."
docker compose \
  --project-directory "$ROOT_DIR" \
  -f "$ROOT_DIR/docker-compose.yml" \
  --profile app up -d --no-build --wait

echo "MVMS is ready at http://localhost"
