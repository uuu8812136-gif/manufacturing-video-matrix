import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export function assertSystemAdmin(config: ConfigService, phone: string) {
  const configured = config.get<string>('SYSTEM_ADMIN_PHONES') || config.get<string>('SEED_ADMIN_PHONE') || '';
  const phones = configured.split(',').map((item) => item.trim()).filter(Boolean);
  if (!phones.includes(phone)) throw new ForbiddenException('仅平台系统管理员可执行此操作');
}

export function isSystemAdmin(config: ConfigService, phone: string) {
  try {
    assertSystemAdmin(config, phone);
    return true;
  } catch {
    return false;
  }
}
