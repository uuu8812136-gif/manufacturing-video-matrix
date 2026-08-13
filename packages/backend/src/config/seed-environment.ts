export interface SeedEnvironment {
  databaseUrl: string;
  adminPhone: string;
  adminPassword: string;
}

const DEFAULT_ADMIN_PASSWORD = 'admin123';

export function resolveSeedEnvironment(env: NodeJS.ProcessEnv): SeedEnvironment {
  const databaseUrl = required(env, 'DATABASE_URL');
  assertMysqlUrl(databaseUrl);

  const adminPassword = required(env, 'SEED_ADMIN_PASSWORD');
  assertBasicPassword(adminPassword, 'SEED_ADMIN_PASSWORD');
  const production = (env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (production && (adminPassword === DEFAULT_ADMIN_PASSWORD || !isStrongProductionPassword(adminPassword))) {
    throw new Error('production 环境的 SEED_ADMIN_PASSWORD 至少 12 位，并必须包含大小写字母、数字和特殊字符');
  }

  const adminPhone = required(env, 'SEED_ADMIN_PHONE');
  if (!/^1[3-9]\d{9}$/.test(adminPhone)) {
    throw new Error('SEED_ADMIN_PHONE 必须是有效的 11 位中国大陆手机号');
  }

  return { databaseUrl, adminPhone, adminPassword };
}

function assertBasicPassword(value: string, name: string) {
  if (value.length < 8 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new Error(`${name} 至少 8 位，且必须同时包含字母和数字`);
  }
}

function isStrongProductionPassword(value: string) {
  return value.length >= 12
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`${name} 未配置，拒绝初始化管理员`);
  return value.trim();
}

function assertMysqlUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL 格式不正确');
  }
  if (url.protocol !== 'mysql:' || !url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error('DATABASE_URL 必须是包含主机和数据库名的 mysql:// URL');
  }
}
