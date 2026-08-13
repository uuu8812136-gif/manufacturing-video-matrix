import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse } from 'axios';
import { prepareSafeExternalRequest } from '../../common/utils/external-url.util';

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  openId?: string;
  scopes?: string[];
}

type OAuthProvider = 'douyin' | 'kuaishou' | 'bilibili' | 'explicit';

const TOKEN_ENDPOINTS: Partial<Record<string, string>> = {
  douyin: 'https://open.douyin.com/oauth/access_token/',
  kuaishou: 'https://open.kuaishou.com/oauth2/access_token',
  // B站官方 demo 使用该地址；授权页仍必须从开放平台控制台显式配置。
  bilibili: 'https://api.bilibili.com/x/account-oauth2/v1/token',
};

const REFRESH_ENDPOINTS: Partial<Record<string, string>> = {
  douyin: 'https://open.douyin.com/oauth/refresh_token/',
  kuaishou: 'https://open.kuaishou.com/oauth2/refresh_token',
};

const AUTHORIZE_ENDPOINTS: Partial<Record<string, string>> = {
  douyin: 'https://open.douyin.com/platform/oauth/connect/',
  kuaishou: 'https://open.kuaishou.com/oauth2/authorize',
};

function prefixOf(platform: string) {
  return platform.toUpperCase().replace(/-/g, '_');
}

function pickKey(platform: string, config: ConfigService): { key: string; secret: string } {
  const upper = prefixOf(platform);
  return {
    key: config.get<string>(`PLATFORM_${upper}_KEY`) || '',
    secret: config.get<string>(`PLATFORM_${upper}_SECRET`) || '',
  };
}

function resolveExpires(expiresIn: unknown): Date {
  const seconds = Number(expiresIn);
  return new Date(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 7200) * 1000);
}

function providerOf(platform: string): OAuthProvider {
  if (platform === 'douyin' || platform === 'kuaishou' || platform === 'bilibili') return platform;
  return 'explicit';
}

function normalizeScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || '').split(/[ ,]+/).filter(Boolean);
}

function tokenPayload(response: AxiosResponse, provider: OAuthProvider): Record<string, unknown> {
  const raw = (response.data || {}) as Record<string, unknown>;
  const nested = raw.data && typeof raw.data === 'object' ? raw.data as Record<string, unknown> : undefined;
  const payload = nested?.access_token ? nested : raw;

  if (provider === 'douyin') {
    const code = Number((nested || raw).error_code ?? 0);
    if (code !== 0) throw new Error(String((nested || raw).description || raw.message || `error_code=${code}`));
  } else if (provider === 'kuaishou') {
    if (Number(raw.result) !== 1) throw new Error(String(raw.error_msg || `result=${String(raw.result)}`));
  } else if (provider === 'bilibili') {
    if (Number(raw.code) !== 0) throw new Error(String(raw.message || `code=${String(raw.code)}`));
  } else {
    if (raw.error || raw.success === false) throw new Error(String(raw.error_description || raw.error || raw.message || 'OAuth 网关返回失败'));
    if (raw.code !== undefined && Number(raw.code) !== 0) throw new Error(String(raw.message || `code=${String(raw.code)}`));
    if (raw.result !== undefined && Number(raw.result) !== 1) throw new Error(String(raw.message || `result=${String(raw.result)}`));
  }
  if (!payload.access_token) throw new Error('平台未返回 access_token');
  return payload;
}

async function exchangeRequest(
  provider: OAuthProvider,
  endpoint: string,
  key: string,
  secret: string,
  code: string,
  redirectUri: string,
) {
  const target = await prepareSafeExternalRequest(endpoint, { requireHttps: true });
  const safeEndpoint = target.url.toString();
  if (provider === 'douyin') {
    return axios.post(safeEndpoint, new URLSearchParams({
      client_key: key,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
    }).toString(), {
      timeout: 30_000,
      maxRedirects: 0,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      ...target.transport,
    });
  }
  if (provider === 'kuaishou') {
    return axios.get(safeEndpoint, {
      params: { app_id: key, app_secret: secret, code, grant_type: 'authorization_code' },
      timeout: 30_000,
      maxRedirects: 0,
      ...target.transport,
    });
  }
  if (provider === 'bilibili') {
    return axios.post(safeEndpoint, undefined, {
      params: { client_id: key, client_secret: secret, code, grant_type: 'authorization_code' },
      timeout: 30_000,
      maxRedirects: 0,
      ...target.transport,
    });
  }
  return axios.post(safeEndpoint, new URLSearchParams({
    client_id: key,
    client_secret: secret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }).toString(), {
    timeout: 30_000,
    maxRedirects: 0,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    ...target.transport,
  });
}

export async function exchangeCodeForToken(
  platform: string,
  code: string,
  redirectUri: string,
  config: ConfigService,
): Promise<OAuthTokenResult> {
  const prefix = prefixOf(platform);
  const endpoint = config.get<string>(`PLATFORM_${prefix}_TOKEN_URL`) || TOKEN_ENDPOINTS[platform];
  if (!endpoint) throw new Error(`未配置 PLATFORM_${prefix}_TOKEN_URL`);
  const { key, secret } = pickKey(platform, config);
  if (!key || !secret) throw new Error(`未配置 PLATFORM_${prefix}_KEY/SECRET`);
  const provider = providerOf(platform);

  try {
    const response = await exchangeRequest(provider, endpoint, key, secret, code, redirectUri);
    const data = tokenPayload(response, provider);
    return {
      accessToken: String(data.access_token),
      refreshToken: String(data.refresh_token || ''),
      expiresAt: resolveExpires(data.expires_in),
      openId: data.open_id ? String(data.open_id) : undefined,
      scopes: normalizeScopes(data.scopes || data.scope),
    };
  } catch (error) {
    throw new Error(`exchangeCodeForToken(${platform}) failed: ${oauthErrorDetail(error)}`);
  }
}

async function refreshRequest(
  provider: OAuthProvider,
  endpoint: string,
  key: string,
  secret: string,
  refreshToken: string,
) {
  const target = await prepareSafeExternalRequest(endpoint, { requireHttps: true });
  const safeEndpoint = target.url.toString();
  if (provider === 'douyin') {
    return axios.post(safeEndpoint, new URLSearchParams({
      client_key: key,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(), {
      timeout: 30_000,
      maxRedirects: 0,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      ...target.transport,
    });
  }
  if (provider === 'kuaishou') {
    return axios.get(safeEndpoint, {
      params: { app_id: key, app_secret: secret, refresh_token: refreshToken, grant_type: 'refresh_token' },
      timeout: 30_000,
      maxRedirects: 0,
      ...target.transport,
    });
  }
  return axios.post(safeEndpoint, new URLSearchParams({
    client_id: key,
    client_secret: secret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }).toString(), {
    timeout: 30_000,
    maxRedirects: 0,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    ...target.transport,
  });
}

export async function refreshToken(
  platform: string,
  refreshTokenValue: string,
  config: ConfigService,
): Promise<OAuthTokenResult> {
  const prefix = prefixOf(platform);
  const explicitEndpoint = config.get<string>(`PLATFORM_${prefix}_REFRESH_URL`);
  const endpoint = explicitEndpoint || REFRESH_ENDPOINTS[platform];
  if (!endpoint) throw new Error(`未配置 PLATFORM_${prefix}_REFRESH_URL，不允许猜测刷新端点`);
  const { key, secret } = pickKey(platform, config);
  if (!key) throw new Error(`未配置 PLATFORM_${prefix}_KEY`);
  const provider = providerOf(platform);
  if ((provider === 'kuaishou' || provider === 'explicit') && !secret) {
    throw new Error(`未配置 PLATFORM_${prefix}_SECRET`);
  }

  try {
    const response = await refreshRequest(provider, endpoint, key, secret, refreshTokenValue);
    const data = tokenPayload(response, provider);
    return {
      accessToken: String(data.access_token),
      refreshToken: String(data.refresh_token || refreshTokenValue),
      expiresAt: resolveExpires(data.expires_in),
      openId: data.open_id ? String(data.open_id) : undefined,
      scopes: normalizeScopes(data.scopes || data.scope),
    };
  } catch (error) {
    throw new Error(`refreshToken(${platform}) failed: ${oauthErrorDetail(error)}`);
  }
}

export function buildAuthorizationUrl(platform: string, redirectUri: string, state: string, config: ConfigService) {
  const prefix = prefixOf(platform);
  const endpoint = config.get<string>(`PLATFORM_${prefix}_AUTHORIZE_URL`) || AUTHORIZE_ENDPOINTS[platform];
  if (!endpoint) {
    throw new Error(`未配置 PLATFORM_${prefix}_AUTHORIZE_URL；该平台没有可验证的公开默认授权端点`);
  }
  const { key } = pickKey(platform, config);
  if (!key) throw new Error(`未配置 PLATFORM_${prefix}_KEY`);
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`PLATFORM_${prefix}_AUTHORIZE_URL 必须是不含内嵌凭据的 HTTPS URL`);
  }
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  const scopes = config.get<string>(`PLATFORM_${prefix}_SCOPES`);
  if (scopes) url.searchParams.set('scope', scopes);
  if (platform === 'douyin') url.searchParams.set('client_key', key);
  else if (platform === 'kuaishou') url.searchParams.set('app_id', key);
  else url.searchParams.set('client_id', key);
  return url.toString();
}

function oauthErrorDetail(error: unknown) {
  if (!axios.isAxiosError(error)) return (error as Error).message;
  const payload = error.response?.data as Record<string, unknown> | undefined;
  const nested = payload?.data as Record<string, unknown> | undefined;
  return String(nested?.description || payload?.error_description || payload?.error_msg || payload?.message || error.message);
}
