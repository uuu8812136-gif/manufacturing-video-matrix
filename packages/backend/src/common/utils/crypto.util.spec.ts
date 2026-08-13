import { CryptoUtil } from './crypto.util';
import { ConfigService } from '@nestjs/config';

describe('CryptoUtil', () => {
  beforeAll(() => {
    const config = {
      get: (k: string) =>
        k === 'ENCRYPTION_KEY'
          ? 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
          : undefined,
    } as unknown as ConfigService;
    CryptoUtil.init(config);
  });

  it('encrypt then decrypt roundtrip', () => {
    const plain = 'hello world 中文测试 secret 123';
    const enc = CryptoUtil.encrypt(plain);
    expect(enc).not.toBe(plain);
    expect(CryptoUtil.decrypt(enc)).toBe(plain);
  });

  it('produces different ciphertexts for same plain', () => {
    const a = CryptoUtil.encrypt('same-secret');
    const b = CryptoUtil.encrypt('same-secret');
    expect(a).not.toBe(b);
    expect(CryptoUtil.decrypt(a)).toBe('same-secret');
    expect(CryptoUtil.decrypt(b)).toBe('same-secret');
  });

  it('ciphertext contains iv:tag:enc segments', () => {
    const enc = CryptoUtil.encrypt('abc');
    const parts = enc.split(':');
    expect(parts.length).toBe(3);
  });

  it('decrypt returns payload as-is when no colon', () => {
    expect(CryptoUtil.decrypt('plainstring')).toBe('plainstring');
  });

  it('decrypt returns legacy colon-delimited plaintext as-is', () => {
    expect(CryptoUtil.decrypt('mock:legacy:credential')).toBe('mock:legacy:credential');
  });
});
