import { ConfigService } from '@nestjs/config';
import {
  runtimeMode,
  validateRuntimeModeEnvironment,
} from './runtime-mode';

describe('runtime modes', () => {
  it('normalizes whitespace and case', () => {
    const config = {
      get: (name: string) => name === 'AI_MODE' ? '  ReAl  ' : 'development',
    } as unknown as ConfigService;
    expect(runtimeMode(config, 'AI_MODE')).toBe('real');
  });

  it('rejects typos instead of silently falling back to mock or real', () => {
    const config = {
      get: (name: string) => name === 'PLATFORM_MODE' ? 'production' : 'development',
    } as unknown as ConfigService;
    expect(() => runtimeMode(config, 'PLATFORM_MODE')).toThrow('仅允许 mock 或 real');
  });

  it('validates and normalizes every mode during application startup', () => {
    const result = validateRuntimeModeEnvironment({ NODE_ENV: 'development', AI_MODE: ' REAL ' });
    expect(result.AI_MODE).toBe('real');
    expect(result.PLATFORM_MODE).toBe('real');
    expect(() => validateRuntimeModeEnvironment({ GEO_MODE: 'typo' })).toThrow('GEO_MODE');
  });

  it('forbids runtime mock mode outside the isolated test environment', () => {
    expect(() => validateRuntimeModeEnvironment({ NODE_ENV: 'development', PLATFORM_MODE: 'mock' }))
      .toThrow('仅允许用于隔离');
    expect(validateRuntimeModeEnvironment({ NODE_ENV: 'test', PLATFORM_MODE: 'mock' }).PLATFORM_MODE)
      .toBe('mock');
  });
});
