import { ConfigService } from '@nestjs/config';

export const RUNTIME_MODE_KEYS = [
  'AI_MODE',
  'PLATFORM_MODE',
  'DIGITAL_HUMAN_MODE',
  'GEO_MODE',
  'CRAWL_MODE',
] as const;

export type RuntimeModeKey = (typeof RUNTIME_MODE_KEYS)[number];
export type RuntimeMode = 'mock' | 'real';

function fallbackMode(_nodeEnv: unknown): RuntimeMode {
  // Missing configuration must fail closed. Runtime Mock is only available
  // when explicitly selected by isolated automated tests.
  return 'real';
}

export function normalizeRuntimeMode(
  value: unknown,
  name: RuntimeModeKey,
  fallback: RuntimeMode,
): RuntimeMode {
  const normalized = String(value ?? '').trim().toLowerCase() || fallback;
  if (normalized !== 'mock' && normalized !== 'real') {
    throw new Error(`${name} 配置无效：仅允许 mock 或 real`);
  }
  return normalized;
}

export function runtimeMode(config: ConfigService, name: RuntimeModeKey): RuntimeMode {
  const mode = normalizeRuntimeMode(
    config.get<string>(name),
    name,
    fallbackMode(config.get<string>('NODE_ENV')),
  );
  assertMockIsTestOnly(mode, name, config.get<string>('NODE_ENV') || process.env.NODE_ENV);
  return mode;
}

/** ConfigModule startup validator: normalize all modes once and reject typos. */
export function validateRuntimeModeEnvironment(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const output = { ...input };
  const fallback = fallbackMode(input.NODE_ENV);
  for (const name of RUNTIME_MODE_KEYS) {
    output[name] = normalizeRuntimeMode(input[name], name, fallback);
    assertMockIsTestOnly(output[name] as RuntimeMode, name, input.NODE_ENV || process.env.NODE_ENV);
  }
  return output;
}

function assertMockIsTestOnly(mode: RuntimeMode, name: RuntimeModeKey, nodeEnv: unknown) {
  if (mode === 'mock' && String(nodeEnv || '').trim().toLowerCase() !== 'test') {
    throw new Error(`${name}=mock 仅允许用于隔离的 NODE_ENV=test 自动化测试，应用运行必须使用 real`);
  }
}
