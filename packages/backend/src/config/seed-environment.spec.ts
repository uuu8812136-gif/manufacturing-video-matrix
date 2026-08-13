import { resolveSeedEnvironment } from './seed-environment';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'mysql://user:pass@localhost:3306/mvms',
  SEED_ADMIN_PHONE: '13800000000',
  SEED_ADMIN_PASSWORD: 'admin123',
};

describe('bootstrap administrator environment validation', () => {
  it.each(['DATABASE_URL', 'SEED_ADMIN_PHONE', 'SEED_ADMIN_PASSWORD'] as const)(
    'rejects a missing %s instead of using a fallback',
    (name) => {
      expect(() => resolveSeedEnvironment({ ...valid, [name]: '' })).toThrow(name);
    },
  );

  it('rejects a non-MySQL DATABASE_URL', () => {
    expect(() => resolveSeedEnvironment({ ...valid, DATABASE_URL: 'https://example.com/db' }))
      .toThrow('mysql://');
  });

  it('rejects an administrator phone that cannot pass the login DTO', () => {
    expect(() => resolveSeedEnvironment({ ...valid, SEED_ADMIN_PHONE: '+8613800000000' }))
      .toThrow('11 位中国大陆手机号');
  });

  it('allows an explicitly configured local bootstrap password', () => {
    const result = resolveSeedEnvironment(valid);
    expect(result.adminPassword).toBe('admin123');
    expect(result.adminPhone).toBe('13800000000');
  });

  it('rejects the local bootstrap password in production', () => {
    expect(() => resolveSeedEnvironment({ ...valid, NODE_ENV: 'production' }))
      .toThrow('production');
  });

  it('accepts a strong explicit production password', () => {
    const result = resolveSeedEnvironment({
      ...valid,
      NODE_ENV: 'production',
      SEED_ADMIN_PASSWORD: 'Strong-Seed-2026!',
    });
    expect(result.adminPassword).toBe('Strong-Seed-2026!');
  });
});
