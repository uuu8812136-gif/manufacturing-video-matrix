import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { lookup } from 'node:dns/promises';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, LookupFunction } from 'node:net';

export interface SafeExternalTransport {
  httpAgent: HttpAgent;
  httpsAgent: HttpsAgent;
  /** Bypass environment proxies so the validated, pinned DNS lookup cannot be bypassed. */
  proxy: false;
}

export interface SafeExternalTarget {
  url: URL;
  transport: SafeExternalTransport;
}

export interface SafeExternalUrlOptions {
  requireHttps?: boolean;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }
  if (!isIP(normalized)) return false;
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  );
}

async function resolveSafeExternalUrl(
  raw: string,
  options: SafeExternalUrlOptions = {},
): Promise<{ url: URL; hostname: string; addresses: Array<{ address: string; family: number }> }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('URL 格式不正确');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BadRequestException('仅允许 http/https URL');
  }
  if (options.requireHttps && url.protocol !== 'https:') {
    throw new BadRequestException('携带凭据的外部请求必须使用 HTTPS');
  }
  if (url.username || url.password) {
    throw new BadRequestException('URL 不允许内嵌用户名或密码');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new BadRequestException('不允许访问本地地址');
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new BadRequestException('不允许访问内网地址');
  }
  return { url, hostname, addresses };
}

/**
 * Validates an external URL and pins the already-vetted DNS answers into the
 * HTTP(S) agent. This closes the time-of-check/time-of-use DNS-rebinding gap:
 * axios cannot resolve the hostname a second time to a private address.
 */
export async function prepareSafeExternalRequest(
  raw: string,
  options: SafeExternalUrlOptions = {},
): Promise<SafeExternalTarget> {
  const target = await resolveSafeExternalUrl(raw, options);
  const pinnedLookup: LookupFunction = (requestedHostname, lookupOptions, callback) => {
    const requested = requestedHostname.toLowerCase().replace(/^\[|\]$/g, '');
    const expected = target.hostname.replace(/^\[|\]$/g, '');
    if (requested !== expected) {
      const error = Object.assign(new Error('请求主机与已验证主机不一致'), { code: 'ENOTFOUND' });
      callback(error, '', 0);
      return;
    }

    const requestedFamily = Number(lookupOptions?.family || 0);
    const candidates = requestedFamily === 4 || requestedFamily === 6
      ? target.addresses.filter((item) => item.family === requestedFamily)
      : target.addresses;
    if (!candidates.length) {
      const error = Object.assign(new Error('已验证地址中没有所需 IP 协议族'), { code: 'ENOTFOUND' });
      callback(error, '', 0);
      return;
    }
    if (lookupOptions?.all) {
      callback(null, candidates.map((item) => ({ address: item.address, family: item.family })));
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };

  return {
    url: target.url,
    transport: {
      httpAgent: new HttpAgent({ keepAlive: false, lookup: pinnedLookup }),
      httpsAgent: new HttpsAgent({ keepAlive: false, lookup: pinnedLookup }),
      proxy: false,
    },
  };
}

export async function assertSafeExternalUrl(
  raw: string,
  options: SafeExternalUrlOptions = {},
): Promise<URL> {
  return (await resolveSafeExternalUrl(raw, options)).url;
}

export async function downloadExternalBuffer(raw: string, maxBytes = 512 * 1024 * 1024): Promise<Buffer> {
  let current = raw;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const target = await prepareSafeExternalRequest(current);
    const response = await axios.get<ArrayBuffer>(target.url.toString(), {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxRedirects: 0,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      validateStatus: (status) => status >= 200 && status < 400,
      ...target.transport,
    });
    if (response.status >= 300) {
      const location = response.headers.location;
      if (!location) throw new BadRequestException('下载地址重定向无效');
      current = new URL(location, target.url).toString();
      continue;
    }
    const buffer = Buffer.from(response.data);
    if (buffer.length > maxBytes) throw new BadRequestException('远程文件超过大小限制');
    return buffer;
  }
  throw new BadRequestException('下载地址重定向次数过多');
}
