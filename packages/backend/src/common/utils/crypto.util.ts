import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';

export class CryptoUtil {
  private static key: Buffer | null = null;

  static init(configService: ConfigService) {
    const hex = configService.get<string>('ENCRYPTION_KEY') || '';
    const production = configService.get<string>('NODE_ENV') === 'production';
    if (production && !/^[a-fA-F0-9]{64}$/.test(hex)) {
      throw new Error('生产环境必须配置 64 位十六进制 ENCRYPTION_KEY');
    }
    this.key = Buffer.from(hex, 'hex');
    if (this.key.length !== 32) {
      this.key = Buffer.alloc(32);
      this.key.write(hex.slice(0, 32));
    }
  }

  static encrypt(plain: string): string {
    if (!this.key) return plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, enc].map((b) => b.toString('hex')).join(':');
  }

  static decrypt(payload: string): string {
    if (!this.key) return payload;
    const parts = payload.split(':');
    if (
      parts.length !== 3
      || !/^[0-9a-f]{24}$/i.test(parts[0])
      || !/^[0-9a-f]{32}$/i.test(parts[1])
      || !/^(?:[0-9a-f]{2})+$/i.test(parts[2])
    ) return payload;
    const [ivHex, tagHex, encHex] = parts;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return dec.toString('utf8');
  }
}
