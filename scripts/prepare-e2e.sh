#!/bin/sh
set -eu

# E2E tests are deliberately isolated from the application database. The
# suffix check makes an accidental run against `mvms` fail before migrations
# or fixtures can touch business data.
E2E_DATABASE_URL="${E2E_DATABASE_URL:-mysql://local:placeholder@localhost:3307/mvms_e2e}"
case "$E2E_DATABASE_URL" in
  */*_e2e) ;;
  *)
    echo "E2E_DATABASE_URL 必须指向以 _e2e 结尾的隔离数据库" >&2
    exit 1
    ;;
esac

docker compose up -d --wait mysql redis minio elasticsearch
docker exec mvms-mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-mvms_root_2025}" \
  -e 'CREATE DATABASE IF NOT EXISTS mvms_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON mvms_e2e.* TO "mvms"@"%"; FLUSH PRIVILEGES;'

DATABASE_URL="$E2E_DATABASE_URL" NODE_ENV=test \
  AI_MODE=mock PLATFORM_MODE=mock DIGITAL_HUMAN_MODE=mock GEO_MODE=mock CRAWL_MODE=mock \
  pnpm db:deploy
DATABASE_URL="$E2E_DATABASE_URL" NODE_ENV=test \
  AI_MODE=mock PLATFORM_MODE=mock DIGITAL_HUMAN_MODE=mock GEO_MODE=mock CRAWL_MODE=mock \
  pnpm db:seed
