# 制造业短视频矩阵智能分发系统 v2.1

面向制造业 B2B 获客的完整 Web 系统，包含账号矩阵、内容分发、AI 创作、产品知识库、数字人、GEO、数据中心、互动与线索、团队协作、渠道合作和爆款二创。

## 仅用 Docker 启动（不要求本机安装 Node.js）

```bash
[ -f .env ] || cp .env.example .env
sh scripts/docker-deploy.sh
```

部署脚本会构建内置 Chromium/Patchright 的社媒浏览器服务和前后端镜像、执行数据库迁移，并等待所有容器健康。启动后直接打开 http://localhost 。

## 本地源码启动（真实模式）

要求：Node.js 22.13+（推荐 24 LTS）、pnpm 11+、Docker Compose v2。

```bash
cp .env.example .env
pnpm install
docker compose up -d --wait
pnpm db:deploy
pnpm db:seed
pnpm dev
```

- Web：http://localhost:5173
- API：http://localhost:3000/api
- Swagger：http://localhost:3000/api/docs
- 健康检查：http://localhost:3000/api/health
- 真实接入自检：系统管理员登录后访问“系统设置 → 接入自检”
- MinIO 控制台：http://localhost:9001
- 初始账号取自 `.env` 的 `SEED_ADMIN_PHONE` / `SEED_ADMIN_PASSWORD`。

当前 `.env.example` 将 `AI_MODE`、`PLATFORM_MODE`、`DIGITAL_HUMAN_MODE`、`GEO_MODE`、`CRAWL_MODE` 设为 `real`。未配置对应外部 Key 时，相关业务应明确失败或显示未接入，不会返回假成功。Mock 仅允许由 `pnpm e2e:prepare` 在 `NODE_ENV=test` 的隔离 E2E 数据库中启用，普通本地启动和生产运行均不得使用 Mock。

## 六平台扫码登录

账号矩阵已接入独立的 `social-browser` 服务，可从平台官方网页取得二维码并保存加密浏览器登录态。支持抖音、快手、B站、微信视频号、小红书和百家号：前五个平台的登录与发布流程参考已验证的 `ai社媒` 项目接入；百家号是按相同架构新增的实验适配，必须用真实账号单独验收。

扫码模式不需要申请六个平台的开放平台 Key，也不要求把 Cookie 手工交给系统，但每个账号都必须由账号持有人使用对应平台 App 真人扫码并确认授权。启动完整应用后：

1. 打开“账号矩阵管理 → 绑定账号”。
2. 选择平台和“浏览器扫码（无需开放平台 Key）”，获取官方登录二维码。
3. 使用对应平台 App 扫码并在手机端确认；页面确认登录态已保存后自动完成绑定。
4. 先执行“刷新”确认登录态，再用测试账号做一条低风险视频投稿验收。

扫码账号会走浏览器适配器，与 `PLATFORM_MODE=mock|real` 的 OAuth/网关账号分开路由。因此仅测试扫码登录和浏览器投稿时，无需把 `PLATFORM_MODE` 改为 `real`。生产环境仍须替换 `JWT_SECRET`、`ENCRYPTION_KEY` 等安全配置；`SOCIAL_BROWSER_API_KEY` 和 `SOCIAL_BROWSER_COOKIE_KEY` 是系统内部密钥，不是向社媒平台申请的 Key。

浏览器模式当前可为六个平台执行视频投稿，小红书额外支持图文投稿；不提供账号统计、评论同步、私信同步或评论/私信回复。这些能力仍需官方开放平台权限或合规网关。浏览器发布依赖平台创作者页面的 DOM 和风控策略，平台改版、验证码、异地登录或账号风控都可能使任务失败，不能视为官方 API 的稳定性承诺。详见 [API 与 Key 配置](docs/API_CONFIGURATION.md#六大自媒体平台)。

## 生产部署

1. 从 `.env.example` 复制 `.env`，至少替换 `MYSQL_*`、`REDIS_PASSWORD`、MinIO 凭据、`JWT_SECRET`、64 位十六进制 `ENCRYPTION_KEY`、`ASSET_SIGNING_SECRET`、`SEED_ADMIN_PASSWORD` 和系统管理员手机号。Compose 会用这些变量生成容器内部的数据库和 Redis 连接。
2. 将 `APP_DOMAIN`、`PUBLIC_API_URL`、`CORS_ORIGIN` 改成正式 HTTPS 域名。`PUBLIC_API_URL` 必须能被自媒体平台访问，否则平台无法拉取上传的视频和图片。
3. 将需要上线的能力模式切到 `real`，按 [API 配置指南](docs/API_CONFIGURATION.md) 填 Key、服务地址和账号授权回调地址。若平台账号只使用浏览器扫码，可不申请社媒开放平台 Key，但仍要完成真人扫码和逐平台投稿验收。
4. 启动完整应用：

```bash
sh scripts/docker-deploy.sh
```

部署脚本会自动处理中文项目路径下的 Docker BuildKit 兼容问题，构建社媒浏览器与前后端镜像并等待全部服务健康。后端容器启动时自动执行 Prisma migration。Nginx 已配置 SPA 回退、API 反向代理和 300 MB 上传上限；公网部署仍应在入口负载均衡器配置 TLS 1.3、证书续期、WAF/限流和可信代理头。

登录后进入“系统设置 → 接入自检”执行真实连通检查。系统不会把“已填 Key”当作“接口已通”：自动探针失败、HTTP 400/405、Seed/Mock 平台凭据或需人工验证的企业接口都会明确阻止“全部就绪”。

## 数据与运维

- MySQL 保存业务数据，Redis/BullMQ 承载可靠发布队列，MinIO 保存素材、成片和备份。
- 发布任务具备延迟调度、指数退避、幂等记录和最终失败落库；定时发布限制未来 7 天。
- 系统每天 02:00 生成一体化全量备份，内容包含 MySQL、MinIO 业务素材和已加密的扫码登录态；系统管理员可在“系统设置 → 备份与恢复”手动触发、下载和恢复。下载后的备份包应复制到独立存储，避免与业务 MinIO 处于同一故障域。
- 每小时增量项是便于审计和导出的数据快照，界面与文件均明确标记为不可独立恢复；灾难恢复以最近的一体化全量备份为基线。
- 平台凭据、CRM 配置、MFA 密钥和 Webhook 密钥使用 AES-256-GCM 加密；刷新令牌只保存 SHA-256 摘要。
- `/api/health` 可用于容器和负载均衡健康检查。
- `/api/health/integrations?probe=true` 仅允许系统管理员执行非计费的凭据/连通自检，不会发布内容。

## 验证命令

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e:prepare
pnpm e2e
```

E2E 会启动 MySQL、Redis、MinIO、Elasticsearch，部署迁移并写入测试种子数据。正式平台 API 的发布验收必须使用已审核应用和平台沙箱/测试账号完成；浏览器扫码发布必须使用真实账号扫码，并逐平台完成小流量投稿验收。

## 重要文档

- [原始 PRD](制造业短视频矩阵智能分发系统_PRD_v2.1(1).docx)

## 仓库发布说明

本仓库保留可复现项目所需的前后端源码、共享类型、社媒浏览器服务、部署脚本、Docker 配置、依赖锁文件、配置模板与产品需求文档。为避免泄露账号或提交不可复现的本机状态，发布副本不包含真实 `.env`、数据库与备份、浏览器 Cookie/Profile、扫码登录二维码、测试报告、日志、构建产物、依赖缓存和生成媒体。

首次运行请从 `.env.example` 复制本地 `.env`，仅在本机填写真实凭据；不要把凭据、扫码登录态或业务数据提交到版本库。
