import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { PrismaService } from './prisma/prisma.service';
import { prepareSafeExternalRequest } from './common/utils/external-url.util';
import { PlatformAdapterFactory } from './modules/platform-adapters/platform-adapter.factory';
import { CryptoUtil } from './common/utils/crypto.util';
import { runtimeMode } from './config/runtime-mode';

export type IntegrationStatus = 'disabled' | 'missing_config' | 'configured' | 'reachable' | 'unverified' | 'failed';
export type IntegrationVerification = 'configuration' | 'automatic' | 'manual';

export interface IntegrationCheck {
  id: string;
  label: string;
  required: boolean;
  configured: boolean;
  status: IntegrationStatus;
  verification: IntegrationVerification;
  detail: string;
}

@Injectable()
export class IntegrationReadinessService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly platformAdapters: PlatformAdapterFactory,
  ) {}

  async inspect(probe = false) {
    const modes = {
      ai: runtimeMode(this.config, 'AI_MODE'),
      platform: runtimeMode(this.config, 'PLATFORM_MODE'),
      digitalHuman: runtimeMode(this.config, 'DIGITAL_HUMAN_MODE'),
      geo: runtimeMode(this.config, 'GEO_MODE'),
      crawl: runtimeMode(this.config, 'CRAWL_MODE'),
    };
    const socialBrowserEnabled = this.booleanValue('SOCIAL_BROWSER_ENABLED');
    const realModeEnabled = Object.values(modes).some((value) => value === 'real')
      || socialBrowserEnabled;
    const checks: IntegrationCheck[] = [];

    checks.push(...this.securityConfigurationChecks(realModeEnabled));
    checks.push(await this.socialBrowserCheck(socialBrowserEnabled, probe));
    checks.push(await this.publicHttpsCheck(
      modes.platform === 'real' || modes.digitalHuman === 'real',
      probe,
    ));
    checks.push(...await Promise.all([
      this.deepSeekCheck(modes.ai === 'real' || modes.geo === 'real', probe),
      this.urlKeyCheck('stt', '语音识别 STT', modes.ai === 'real', 'STT_API_URL', 'STT_API_KEY', probe),
      this.urlKeyCheck('tts', '语音合成 TTS', modes.ai === 'real', 'TTS_API_URL', 'TTS_API_KEY', probe),
      this.digitalHumanCheck(modes.digitalHuman === 'real', probe),
      this.serpApiCheck(modes.geo === 'real', probe),
      this.geoTargetCheck(modes.geo === 'real'),
      this.geoAiModeCheck(modes.geo === 'real', modes.ai === 'real'),
      this.llmConfigCheck('doubao', '豆包 GEO 引用', modes.geo === 'real', ['DOUBAO_API_KEY', 'ARK_API_KEY'], 'DOUBAO_BASE_URL', 'https://ark.cn-beijing.volces.com/api/v3', 'DOUBAO_MODEL', '', probe),
      this.llmConfigCheck('qwen', '通义千问 GEO 引用', modes.geo === 'real', ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'], 'QWEN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'QWEN_MODEL', 'qwen-plus', probe),
      this.llmConfigCheck('ernie', '文心一言 GEO 引用', modes.geo === 'real', ['ERNIE_API_KEY'], 'ERNIE_BASE_URL', 'https://api.baiduqianfan.ai/v1', 'ERNIE_MODEL', 'ernie-3.5-8k', probe),
      this.urlKeyCheck('crawl', '同行数据服务', modes.crawl === 'real', 'CRAWL_API_URL', 'CRAWL_API_KEY', probe),
    ]));

    const platforms = [
      ['douyin', '抖音'],
      ['kuaishou', '快手'],
      ['bilibili', 'B站'],
      ['video_account', '视频号'],
      ['xiaohongshu', '小红书'],
      ['baijiahao', '百家号'],
    ] as const;
    checks.push(...await Promise.all(platforms.map((platform) =>
      this.platformCheck(platform[0], platform[1], modes.platform === 'real', probe, socialBrowserEnabled))));

    const wecomCheck = this.configOnlyCheck('wecom', '企业微信机器人', false, ['WECOM_WEBHOOK_URL'], 'manual');
    checks.push(probe && wecomCheck.configured
      ? { ...wecomCheck, status: 'unverified', detail: '需发送一条测试消息才能验证 Webhook 业务成功' }
      : wecomCheck);
    checks.push(await this.smtpCheck(probe));
    checks.push(await this.urlKeyCheck('sms', '短信网关', false, 'SMS_API_URL', 'SMS_API_KEY', probe));
    checks.push(await this.urlKeyCheck('hot_topic', '热点榜单服务', false, 'HOT_TOPIC_API_URL', 'HOT_TOPIC_API_KEY', probe));
    checks.push(await this.urlKeyCheck('originality', '原创度服务', false, 'ORIGINALITY_API_URL', 'ORIGINALITY_API_KEY', probe));

    const enabledCrm = await this.prisma.crmIntegration.count({ where: { enabled: true } });
    checks.push({
      id: 'crm',
      label: 'CRM',
      required: false,
      configured: enabledCrm > 0,
      status: enabledCrm > 0 ? (probe ? 'unverified' : 'configured') : 'disabled',
      verification: 'manual',
      detail: enabledCrm > 0
        ? `已启用 ${enabledCrm} 个 CRM 配置；需在业务界面发起一次测试同步验证`
        : '未启用 CRM 配置',
    });

    const required = checks.filter((item) => item.required);
    const allRealModes = Object.values(modes).every((value) => value === 'real');
    const configurationReady = realModeEnabled
      && required.length > 0
      && required.every((item) => item.configured);
    const probeReady = probe
      && configurationReady
      && required.every((item) => item.verification === 'configuration'
        ? item.status === 'configured' || item.status === 'reachable'
        : item.status === 'reachable');
    // `ready` is deliberately reserved for the user's stated goal: every
    // capability group is real and a live, non-billable probe has completed.
    const ready = allRealModes && probeReady;

    return {
      ready,
      configurationReady,
      probeReady,
      allRealModes,
      socialBrowserEnabled,
      probe,
      modes,
      summary: {
        total: checks.length,
        required: required.length,
        missing: checks.filter((item) => item.status === 'missing_config').length,
        unverified: checks.filter((item) => item.status === 'unverified').length,
        manual: checks.filter((item) => item.verification === 'manual' && item.configured).length,
        failed: checks.filter((item) => item.status === 'failed').length,
      },
      checks,
      checkedAt: new Date().toISOString(),
    };
  }

  private async socialBrowserCheck(enabled: boolean, probe: boolean): Promise<IntegrationCheck> {
    if (!enabled) {
      return this.baseCheck(
        'social_browser',
        '社媒浏览器扫码与发布',
        false,
        false,
        'SOCIAL_BROWSER_ENABLED=false',
        'automatic',
      );
    }

    const baseUrl = this.value('SOCIAL_BROWSER_URL') || 'http://social-browser:8000';
    const internalKey = this.value('SOCIAL_BROWSER_API_KEY') || this.value('JWT_SECRET');
    const cookieKey = this.value('SOCIAL_BROWSER_COOKIE_KEY')
      || this.value('ENCRYPTION_KEY')
      || internalKey;
    const safeUrl = this.safeSocialBrowserUrl(baseUrl);
    const configured = Boolean(safeUrl && internalKey.length >= 32 && cookieKey.length >= 32);
    const check = this.baseCheck(
      'social_browser',
      '社媒浏览器扫码与发布',
      true,
      configured,
      configured
        ? '内部地址、服务鉴权和 Cookie 加密已配置；仅覆盖扫码登录与浏览器发布，不代表评论、私信或统计可用'
        : '需要安全的 SOCIAL_BROWSER_URL，且 SOCIAL_BROWSER_API_KEY/JWT_SECRET 与 SOCIAL_BROWSER_COOKIE_KEY/ENCRYPTION_KEY 均至少 32 位',
      'automatic',
    );
    if (!probe || !configured || !safeUrl) return check;

    try {
      const healthUrl = new URL(`${safeUrl.toString().replace(/\/$/, '')}/health/ready`);
      let requestUrl = healthUrl.toString();
      let transport: object = {};
      if (healthUrl.protocol === 'https:' && !this.isLocalSocialBrowserHost(healthUrl.hostname)) {
        const target = await prepareSafeExternalRequest(requestUrl, { requireHttps: true });
        requestUrl = target.url.toString();
        transport = target.transport;
      }
      const response = await axios.request({
        url: requestUrl,
        method: 'get',
        timeout: 8_000,
        validateStatus: () => true,
        maxRedirects: 0,
        ...transport,
      });
      if (response.status >= 200 && response.status < 300 && (response.data as any)?.ok === true) {
        return {
          ...check,
          status: 'reachable',
          detail: '浏览器 sidecar 与 Chromium 已就绪；仅验证扫码登录/浏览器发布运行时，评论、私信、统计仍未接入',
        };
      }
      return {
        ...check,
        status: 'failed',
        detail: `浏览器 sidecar 未就绪（HTTP ${response.status}）`,
      };
    } catch (error) {
      return { ...check, status: 'failed', detail: `浏览器 sidecar 连通失败：${this.errorMessage(error)}` };
    }
  }

  private securityConfigurationChecks(required: boolean): IntegrationCheck[] {
    const definitions: Array<{
      id: string;
      label: string;
      name: string;
      valid: (value: string) => boolean;
      guidance: string;
    }> = [
      {
        id: 'security_jwt_secret',
        label: 'JWT 签名密钥',
        name: 'JWT_SECRET',
        valid: (value) => value.length >= 32 && !this.isTemplateSecret(value),
        guidance: 'JWT_SECRET 必须是至少 32 位的非模板随机值',
      },
      {
        id: 'security_encryption_key',
        label: '凭据加密密钥',
        name: 'ENCRYPTION_KEY',
        valid: (value) => /^[0-9a-f]{64}$/i.test(value) && !this.isTemplateSecret(value),
        guidance: 'ENCRYPTION_KEY 必须是 64 位非模板十六进制随机值',
      },
      {
        id: 'security_asset_signing_secret',
        label: '素材签名密钥',
        name: 'ASSET_SIGNING_SECRET',
        valid: (value) => value.length >= 32 && !this.isTemplateSecret(value),
        guidance: 'ASSET_SIGNING_SECRET 必须是至少 32 位的非模板随机值',
      },
      {
        id: 'security_seed_admin_password',
        label: '种子管理员密码',
        name: 'SEED_ADMIN_PASSWORD',
        valid: (value) => value.length >= 12
          && /[a-z]/.test(value)
          && /[A-Z]/.test(value)
          && /\d/.test(value)
          && /[^A-Za-z0-9]/.test(value)
          && !this.isTemplateSecret(value),
        guidance: 'SEED_ADMIN_PASSWORD 必须至少 12 位，包含大小写字母、数字和特殊字符，且不能使用默认/模板值',
      },
    ];

    return definitions.map((definition) => {
      if (!required) {
        return this.baseCheck(definition.id, definition.label, false, false, '当前未启用 real 模式', 'configuration');
      }
      const configured = definition.valid(this.value(definition.name));
      return this.baseCheck(
        definition.id,
        definition.label,
        true,
        configured,
        configured ? '已配置非模板强密钥/密码' : definition.guidance,
        'configuration',
      );
    });
  }

  private async publicHttpsCheck(required: boolean, probe: boolean): Promise<IntegrationCheck> {
    const appDomain = this.value('APP_DOMAIN');
    const publicApi = this.value('PUBLIC_API_URL');
    const configured = this.isPublicHttps(appDomain) && this.isPublicHttps(publicApi);
    const check = this.baseCheck(
      'public_https',
      '公网 HTTPS 域名',
      required,
      configured,
      configured ? 'APP_DOMAIN 与 PUBLIC_API_URL 均为公网 HTTPS' : '需配置公网 HTTPS 的 APP_DOMAIN 与 PUBLIC_API_URL',
      'automatic',
    );
    if (!probe || !configured) return check;
    const apiPrefix = this.value('API_PREFIX') || 'api';
    const publicApiPath = new URL(publicApi).pathname.replace(/\/+$/, '');
    const healthUrl = publicApiPath === `/${apiPrefix}` || publicApiPath.endsWith(`/${apiPrefix}`)
      ? `${publicApi.replace(/\/$/, '')}/health`
      : `${publicApi.replace(/\/$/, '')}/${apiPrefix}/health`;
    const [appResult, apiResult] = await Promise.all([
      this.probeRequest(check, appDomain, { method: 'head' }),
      this.probeRequest(check, healthUrl, { method: 'get' }),
    ]);
    if (appResult.status === 'reachable' && apiResult.status === 'reachable') {
      return { ...check, status: 'reachable', detail: '前端域名和公网 API 健康检查均可达' };
    }
    return {
      ...check,
      status: 'failed',
      detail: `公网可达性检查失败；前端：${appResult.detail}；API：${apiResult.detail}`,
    };
  }

  private async deepSeekCheck(required: boolean, probe: boolean): Promise<IntegrationCheck> {
    const key = this.value('DEEPSEEK_API_KEY');
    const base = this.value('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com';
    const configured = Boolean(key && this.isPublicHttps(base));
    const check = this.baseCheck(
      'deepseek',
      'DeepSeek',
      required,
      configured,
      configured ? 'API Key 和 HTTPS 基址已配置' : '缺少 DEEPSEEK_API_KEY 或 DEEPSEEK_BASE_URL 不是公网 HTTPS',
      'automatic',
    );
    if (!probe || !configured) return check;
    const configuredModel = this.value('DEEPSEEK_MODEL') || 'deepseek-v4-flash';
    const expectedModel = configuredModel === 'deepseek-chat' || configuredModel === 'deepseek-reasoner'
      ? 'deepseek-v4-flash'
      : configuredModel;
    return this.probeRequest(check, `${base.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    }, (data) => {
      const models = Array.isArray((data as any)?.data) ? (data as any).data : [];
      return models.some((item: any) => String(item?.id || item) === expectedModel)
        ? undefined
        : `账号可达，但模型列表中未找到 ${expectedModel}`;
    });
  }

  private async serpApiCheck(required: boolean, probe: boolean): Promise<IntegrationCheck> {
    const key = this.value('GEO_API_KEY');
    const check = this.baseCheck(
      'serpapi',
      'SerpAPI',
      required,
      Boolean(key),
      key ? 'API Key 已配置' : '缺少 GEO_API_KEY',
      'automatic',
    );
    if (!probe || !key) return check;
    return this.probeRequest(
      check,
      'https://serpapi.com/account.json',
      { params: { api_key: key } },
      (data) => (data as any)?.error ? String((data as any).error) : undefined,
    );
  }

  private async geoTargetCheck(required: boolean): Promise<IntegrationCheck> {
    if (!required) return this.baseCheck('geo_target', 'GEO 目标品牌/域名', false, false, 'GEO_MODE=mock');
    const globalTarget = Boolean(this.value('GEO_TARGET_DOMAIN') || this.value('GEO_TARGET_BRAND'));
    const [total, withoutTarget] = await Promise.all([
      this.prisma.geoKeyword.count(),
      this.prisma.geoKeyword.count({ where: { targetDomain: null, targetBrand: null } }),
    ]);
    const configured = globalTarget || withoutTarget === 0;
    const detail = globalTarget
      ? '已配置全局 GEO 目标'
      : total === 0
        ? '尚无关键词；新增时界面会强制填写目标品牌或域名'
        : withoutTarget === 0
          ? `已有 ${total} 个关键词逐项配置目标`
          : `有 ${withoutTarget} 个关键词缺少目标，且未配置全局 GEO_TARGET_DOMAIN/GEO_TARGET_BRAND`;
    return this.baseCheck('geo_target', 'GEO 目标品牌/域名', true, configured, detail);
  }

  private geoAiModeCheck(required: boolean, aiReal: boolean): IntegrationCheck {
    if (!required) return this.baseCheck('geo_deepseek_mode', 'GEO DeepSeek 真实模式', false, false, 'GEO_MODE=mock');
    return this.baseCheck(
      'geo_deepseek_mode',
      'GEO DeepSeek 真实模式',
      true,
      aiReal,
      aiReal ? 'AI_MODE=real，DeepSeek 引用检测不会返回 Mock' : 'GEO_MODE=real 要检测 DeepSeek 引用时还需 AI_MODE=real',
    );
  }

  private async llmConfigCheck(
    id: string,
    label: string,
    required: boolean,
    keyNames: string[],
    baseName: string,
    defaultBase: string,
    modelName: string,
    defaultModel = '',
    probe = false,
  ): Promise<IntegrationCheck> {
    if (!required) return this.baseCheck(`geo_${id}`, label, false, false, 'GEO_MODE=mock');
    const keyName = keyNames.find((name) => Boolean(this.value(name)));
    const key = keyName ? this.value(keyName) : '';
    const base = this.value(baseName) || defaultBase;
    const model = this.value(modelName) || defaultModel;
    const configured = Boolean(key && this.isPublicHttps(base) && model);
    const check = this.baseCheck(
      `geo_${id}`,
      label,
      true,
      configured,
      configured ? '凭据、公网 HTTPS 基址和模型已配置' : `缺少 ${keyNames.join('/')} / ${modelName}，或 ${baseName} 不是公网 HTTPS`,
      'automatic',
    );
    if (!probe || !configured) return check;
    return this.probeRequest(
      check,
      `${base.replace(/\/$/, '')}/models`,
      { headers: { Authorization: `Bearer ${key}` } },
      (data) => {
        const models = Array.isArray((data as any)?.data) ? (data as any).data : [];
        return models.some((item: any) => String(item?.id || item) === model)
          ? undefined
          : `账号可达，但模型列表中未找到 ${model}`;
      },
    );
  }

  private async digitalHumanCheck(required: boolean, probe: boolean): Promise<IntegrationCheck> {
    const provider = (this.value('DIGITAL_HUMAN_PROVIDER') || 'heygen').toLowerCase();
    if (!required) return this.baseCheck('digital_human', '数字人', false, false, 'DIGITAL_HUMAN_MODE=mock');
    const key = this.value(`${provider.toUpperCase()}_API_KEY`);
    const base = this.value(`${provider.toUpperCase()}_BASE_URL`)
      || (provider === 'heygen' ? 'https://api.heygen.com' : '');
    const configured = Boolean(key && this.isPublicHttps(base) && provider !== 'mock');
    const verification: IntegrationVerification = provider === 'heygen' ? 'automatic' : 'manual';
    const check = this.baseCheck(
      'digital_human',
      `数字人 (${provider})`,
      true,
      configured,
      configured ? '服务商凭据和公网 HTTPS 基址已配置' : `缺少 ${provider.toUpperCase()}_API_KEY/BASE_URL 或 URL 不安全`,
      verification,
    );
    if (!probe || !configured) return check;
    // HeyGen provides a non-generating current-user endpoint. Other custom
    // providers remain configuration-only because their customer endpoints vary.
    if (provider !== 'heygen') {
      return {
        ...check,
        status: 'unverified',
        detail: '配置已齐全；该企业服务商无统一无计费探针，必须人工发起一次测试任务',
      };
    }
    return this.probeRequest(check, `${base.replace(/\/$/, '')}/v3/users/me`, {
      method: 'get',
      headers: { 'x-api-key': key },
    });
  }

  private async platformCheck(
    platform: string,
    label: string,
    required: boolean,
    probe: boolean,
    socialBrowserEnabled = this.booleanValue('SOCIAL_BROWSER_ENABLED'),
  ): Promise<IntegrationCheck> {
    const prefix = platform.toUpperCase();
    const gateway = this.value(`PLATFORM_${prefix}_GATEWAY_URL`);
    const key = this.value(`PLATFORM_${prefix}_KEY`)
      || (platform === 'video_account' ? this.value('PLATFORM_VIDEO_KEY') : '');
    const secret = this.value(`PLATFORM_${prefix}_SECRET`)
      || (platform === 'video_account' ? this.value('PLATFORM_VIDEO_SECRET') : '');
    const gatewayOnly = ['video_account', 'xiaohongshu', 'baijiahao'].includes(platform);
    const gatewayConfigured = Boolean(gateway && this.isPublicHttps(gateway));
    const directExtraConfigured = platform !== 'bilibili' || Number(this.value('PLATFORM_BILIBILI_TID')) > 0;
    const appConfigured = gatewayOnly
      ? gatewayConfigured
      : gateway
        ? gatewayConfigured
        : Boolean(key && secret && directExtraConfigured);
    const aliases = platform === 'video_account' ? ['video_account', 'video-account'] : [platform];
    const accounts = await this.prisma.platformAccount.findMany({
      where: { platform: { in: aliases }, status: 'active' },
      select: { id: true, nickname: true, credentials: true, authType: true },
      orderBy: { createdAt: 'asc' },
    });
    const activeAccounts = accounts.length;
    const scanAccounts = accounts.filter((account) => account.authType === 'scan');
    const nonScanAccounts = accounts.filter((account) => account.authType !== 'scan');
    if (!required && scanAccounts.length === 0) {
      return this.baseCheck(`platform_${platform}`, label, false, false, 'PLATFORM_MODE=mock，且没有活跃扫码账号');
    }

    const browserConfigured = socialBrowserEnabled && this.socialBrowserConfigurationValid();
    const effectiveRequired = required || scanAccounts.length > 0;
    const configured = activeAccounts > 0
      && (scanAccounts.length === 0 || browserConfigured)
      && (nonScanAccounts.length === 0 || appConfigured);
    const directConfigurationDetail = !appConfigured
      ? gateway && !gatewayConfigured
        ? '平台网关必须是不含内嵌凭据的公网 HTTPS URL'
        : platform === 'bilibili' && key && secret && !directExtraConfigured
          ? '缺少有效的 PLATFORM_BILIBILI_TID 稿件分区'
          : (gatewayOnly ? '该平台必须配置合规网关（HTTPS）' : '缺少应用 Key/Secret 或合规网关（HTTPS）')
      : '应用 Key/Secret 或合规网关已配置';
    const detail = activeAccounts === 0
      ? appConfigured || browserConfigured
        ? '发布通道已配置，但尚无已授权的活跃账号'
        : directConfigurationDetail
      : scanAccounts.length > 0 && !browserConfigured
        ? `有 ${scanAccounts.length} 个扫码账号，但浏览器 sidecar 配置不完整`
        : nonScanAccounts.length > 0 && !appConfigured
          ? `有 ${nonScanAccounts.length} 个非扫码账号；${directConfigurationDetail}`
          : `已配置，活跃账号 ${activeAccounts} 个（扫码 ${scanAccounts.length} 个）${scanAccounts.length > 0 ? '；扫码模式仅覆盖登录与浏览器发布，不含评论、私信、统计' : ''}`;
    const check = this.baseCheck(`platform_${platform}`, label, effectiveRequired, configured, detail, 'automatic');
    if (!probe || !configured) return check;
    const failures: string[] = [];
    let validCount = 0;
    const probeBudgetMs = this.platformProbeBudgetMs();
    const probeDeadline = Date.now() + probeBudgetMs;
    for (const [accountIndex, account] of accounts.entries()) {
      const accountLabel = `${account.nickname || '未命名账号'}(${account.id.slice(-6)})`;
      if (!account.credentials) {
        failures.push(`${accountLabel}：缺少加密授权凭据`);
        continue;
      }
      try {
        const credentials = CryptoUtil.decrypt(account.credentials);
        if (this.isMockCredential(credentials)) {
          failures.push(`${accountLabel}：Seed/Mock 演示凭据，必须重新授权`);
          continue;
        }
        const remainingMs = probeDeadline - Date.now();
        if (remainingMs <= 0) {
          failures.push(`${accountLabel}：未探测（平台总探测时限 ${probeBudgetMs / 1_000} 秒已用尽）`);
          continue;
        }
        // 扫码账号需要启动隔离浏览器、加载平台创作者页并调用官方账号接口。
        // 抖音/视频号在正常网络下经常超过 8 秒；旧上限会把仍在正常校验
        // 的有效登录态误报为“连通失败”。同平台多个账号仍共享一个总预算，
        // 并按剩余账号数公平分配，保证整个 readiness 请求不超过前端 60 秒。
        const remainingAccounts = Math.max(1, accounts.length - accountIndex);
        const fairShareMs = Math.max(1_000, Math.floor(remainingMs / remainingAccounts));
        const accountTimeoutMs = Math.min(45_000, fairShareMs);
        const result = await this.withTimeout(
          this.platformAdapters.get(platform, account.authType).checkLogin(
            credentials,
            { timeoutMs: accountTimeoutMs },
          ),
          accountTimeoutMs,
          `登录态探测超过 ${Math.ceil(accountTimeoutMs / 1_000)} 秒`,
        );
        if (result.valid) validCount++;
        else failures.push(`${accountLabel}：${result.reason || '平台未确认授权有效'}`);
      } catch (error) {
        failures.push(`${accountLabel}：${this.errorMessage(error)}`);
      }
    }
    return failures.length === 0
      ? {
          ...check,
          status: 'reachable',
          detail: `全部 ${activeAccounts} 个活跃账号的授权与登录验证成功${scanAccounts.length > 0 ? '；扫码账号仅证明登录/浏览器发布通道，评论、私信、统计未接入' : ''}`,
        }
      : {
          ...check,
          status: 'failed',
          detail: `逐账号验证通过 ${validCount}/${activeAccounts}；失败：${failures.slice(0, 10).join('；')}${failures.length > 10 ? `；另有 ${failures.length - 10} 个` : ''}`,
        };
  }

  private platformProbeBudgetMs(): number {
    // Platform probes run concurrently. Keep each platform below the frontend's
    // 60-second request timeout while leaving time for response serialization.
    return 50_000;
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async urlKeyCheck(
    id: string,
    label: string,
    required: boolean,
    urlName: string,
    keyName: string,
    probe: boolean,
  ): Promise<IntegrationCheck> {
    const url = this.value(urlName);
    const key = this.value(keyName);
    const configured = Boolean(url && key && this.isPublicHttps(url));
    const check = this.baseCheck(
      id,
      label,
      required,
      configured,
      configured ? '公网 HTTPS URL 与凭据已配置' : `缺少 ${urlName}/${keyName}，或 URL 不是公网 HTTPS`,
      'automatic',
    );
    if (!probe || !configured) return check;
    return this.probeRequest(check, url, {
      method: 'head',
      headers: { Authorization: `Bearer ${key}` },
    });
  }

  private configOnlyCheck(
    id: string,
    label: string,
    required: boolean,
    names: string[],
    verification: IntegrationVerification = 'configuration',
  ): IntegrationCheck {
    const configured = names.every((name) => Boolean(this.value(name)));
    return this.baseCheck(id, label, required, configured, configured ? '配置完整' : `缺少 ${names.join('/')}`, verification);
  }

  private async smtpCheck(probe: boolean): Promise<IntegrationCheck> {
    const names = ['EMAIL_SMTP_HOST', 'EMAIL_SMTP_USER', 'EMAIL_SMTP_PASS'];
    const check = this.configOnlyCheck('smtp', 'SMTP 邮件', false, names, 'automatic');
    if (!probe || !check.configured) return check;
    try {
      const port = Number(this.value('EMAIL_SMTP_PORT') || 465);
      const transporter = nodemailer.createTransport({
        host: this.value('EMAIL_SMTP_HOST'),
        port,
        secure: port === 465,
        auth: { user: this.value('EMAIL_SMTP_USER'), pass: this.value('EMAIL_SMTP_PASS') },
      });
      await transporter.verify();
      return { ...check, status: 'reachable', detail: 'SMTP 登录验证成功' };
    } catch (error) {
      return { ...check, status: 'failed', detail: `SMTP 验证失败：${this.errorMessage(error)}` };
    }
  }

  private baseCheck(
    id: string,
    label: string,
    required: boolean,
    configured: boolean,
    detail: string,
    verification: IntegrationVerification = 'configuration',
  ): IntegrationCheck {
    return {
      id,
      label,
      required,
      configured,
      status: configured ? 'configured' : required ? 'missing_config' : 'disabled',
      verification,
      detail,
    };
  }

  private async probeRequest(
    check: IntegrationCheck,
    url: string,
    options: Record<string, unknown>,
    validateBody?: (data: unknown) => string | undefined,
  ): Promise<IntegrationCheck> {
    try {
      const target = await prepareSafeExternalRequest(url, { requireHttps: true });
      const response = await axios.request({
        url: target.url.toString(),
        method: 'get',
        timeout: 8_000,
        validateStatus: () => true,
        ...options,
        maxRedirects: 0,
        ...target.transport,
      });
      const status = Number(response.status);
      if (status >= 200 && status < 300) {
        const validationError = validateBody?.(response.data);
        if (validationError) return { ...check, status: 'failed', detail: validationError };
        return { ...check, status: 'reachable', detail: `连通成功（HTTP ${status}）` };
      }
      if ([400, 405, 409, 422].includes(status)) {
        return {
          ...check,
          status: 'unverified',
          detail: `网络可达（HTTP ${status}），但未完成鉴权/业务成功验证，不计为就绪`,
        };
      }
      return { ...check, status: 'failed', detail: `连通失败（HTTP ${status}）` };
    } catch (error) {
      return { ...check, status: 'failed', detail: `连通失败：${this.errorMessage(error)}` };
    }
  }

  private isPublicHttps(value: string) {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      return url.protocol === 'https:'
        && !url.username
        && !url.password
        && !this.isPrivateHostname(hostname);
    } catch {
      return false;
    }
  }

  private isPrivateHostname(hostname: string) {
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true;
    if (hostname.includes(':')
      && (hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd'))) return true;
    const parts = hostname.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }

  private booleanValue(name: string): boolean {
    return ['1', 'true', 'yes', 'on'].includes(this.value(name).toLowerCase());
  }

  private safeSocialBrowserUrl(value: string): URL | null {
    try {
      const url = new URL(value);
      if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return null;
      if (url.protocol === 'http:' && !this.isLocalSocialBrowserHost(url.hostname)) return null;
      return url;
    } catch {
      return null;
    }
  }

  private isLocalSocialBrowserHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return ['social-browser', 'localhost', '127.0.0.1', '::1'].includes(normalized);
  }

  private socialBrowserConfigurationValid(): boolean {
    if (!this.booleanValue('SOCIAL_BROWSER_ENABLED')) return false;
    const url = this.value('SOCIAL_BROWSER_URL') || 'http://social-browser:8000';
    const internalKey = this.value('SOCIAL_BROWSER_API_KEY') || this.value('JWT_SECRET');
    const cookieKey = this.value('SOCIAL_BROWSER_COOKIE_KEY')
      || this.value('ENCRYPTION_KEY')
      || internalKey;
    return Boolean(this.safeSocialBrowserUrl(url) && internalKey.length >= 32 && cookieKey.length >= 32);
  }

  private isTemplateSecret(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return true;
    const knownDefaults = new Set([
      'admin123',
      'password',
      'changeme',
      'change-me',
      'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    ]);
    return knownDefaults.has(normalized)
      || /(replace[-_ ]?with|change[-_ ]?me|your[-_ ]|example|placeholder|default|mvms[-_ ]?(jwt|asset|secret))/.test(normalized);
  }

  private isMockCredential(raw: string): boolean {
    const isPlaceholder = (value: unknown) => {
      if (typeof value !== 'string') return false;
      const normalized = value.trim().toLowerCase();
      return /^mock(?::|[-_]|$)/.test(normalized)
        || /^seed(?::|[-_]|$)/.test(normalized)
        || /^test(?:[-_]|$)/.test(normalized)
        || /^(replace|your)(?:[-_ :]?)/.test(normalized);
    };
    if (isPlaceholder(raw)) return true;
    try {
      const parsed = JSON.parse(raw);
      const inspect = (value: unknown): boolean => {
        if (isPlaceholder(value)) return true;
        if (Array.isArray(value)) return value.some(inspect);
        if (value && typeof value === 'object') return Object.values(value).some(inspect);
        return false;
      };
      return inspect(parsed);
    } catch {
      return false;
    }
  }

  private value(name: string): string {
    return String(this.config.get<string>(name) || '').trim();
  }

  private errorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
      return String(error.response?.data?.message || error.response?.data?.error || error.message).slice(0, 300);
    }
    return (error as Error).message.slice(0, 300);
  }
}
