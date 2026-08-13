import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from './strategies/jwt.strategy';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { isSystemAdmin } from '../../common/utils/system-admin.util';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (exists) {
      throw new BadRequestException('该手机号已注册');
    }
    const password = await bcrypt.hash(dto.password, 10);

    const role = 'super_admin';
    let channelCode: string | undefined;
    let channelCodeId: string | undefined;

    if (dto.inviteCode) {
      const code = await this.prisma.channelCode.findUnique({
        where: { code: dto.inviteCode },
        include: { channel: true },
      });
      if (!code) {
        throw new BadRequestException('邀请码无效');
      }
      channelCode = dto.inviteCode;
      channelCodeId = code.id;
    }

    const { team, user } = await this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { name: dto.teamName || `${dto.name}的企业`, plan: 'professional', channelCode: channelCode || null },
      });
      const user = await tx.user.create({
        data: { phone: dto.phone, password, name: dto.name, role, teamId: team.id },
      });
      await tx.teamMember.create({ data: { teamId: team.id, userId: user.id, role } });
      if (channelCodeId) {
        await tx.channelCustomer.create({ data: { codeId: channelCodeId, teamId: team.id, teamName: team.name } });
      }
      return { team, user };
    });

    void team;
    return this.issueTokens(user.id, user.phone);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!user) {
      throw new UnauthorizedException('手机号或密码错误');
    }
    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) {
      throw new UnauthorizedException('手机号或密码错误');
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException('账号已被禁用');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    if (user.mfaEnabled) {
      const mfaToken = this.jwtService.sign(
        { sub: user.id, phone: user.phone, type: 'mfa' } as JwtPayload,
        { expiresIn: '5m' },
      );
      return { mfaRequired: true, mfaToken };
    }
    return this.issueTokens(user.id, user.phone);
  }

  async mfaVerify(mfaToken: string, code: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(mfaToken);
    } catch {
      throw new UnauthorizedException('MFA 票据无效或已过期');
    }
    if (payload.type !== 'mfa') {
      throw new UnauthorizedException('票据类型错误');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.mfaEnabled) {
      throw new BadRequestException('未开启 MFA');
    }
    const settings = await this.prisma.systemSetting.findUnique({
      where: { key: `mfa:${user.id}` },
    });
    const secret = settings?.value ? CryptoUtil.decrypt(settings.value) : undefined;
    if (!secret) {
      throw new BadRequestException('MFA 未配置');
    }
    const valid = authenticator.verify({ token: code, secret });
    if (!valid) {
      throw new BadRequestException('验证码错误');
    }
    return this.issueTokens(user.id, user.phone);
  }

  async mfaSetup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('用户不存在');
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.phone, 'MVMS', secret);
    await this.prisma.systemSetting.upsert({
      where: { key: `mfa:${user.id}` },
      update: { value: CryptoUtil.encrypt(secret) },
      create: { key: `mfa:${user.id}`, value: CryptoUtil.encrypt(secret) },
    });
    return { secret, otpauth };
  }

  async mfaEnable(userId: string, code: string) {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { key: `mfa:${userId}` },
    });
    const secret = settings?.value ? CryptoUtil.decrypt(settings.value) : undefined;
    if (!secret) throw new BadRequestException('请先获取 MFA 密钥');
    const valid = authenticator.verify({ token: code, secret });
    if (!valid) throw new BadRequestException('验证码错误');
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });
    return { enabled: true };
  }

  async mfaDisable(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false },
    });
    await this.prisma.systemSetting.deleteMany({
      where: { key: `mfa:${userId}` },
    });
    return { enabled: false };
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('刷新令牌无效');
    }
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { token: tokenHash, revoked: false, expiresAt: { gt: new Date() } },
    });
    if (!stored) {
      throw new UnauthorizedException('刷新令牌已失效');
    }
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });
    return this.issueTokens(payload.sub, payload.phone);
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { token: this.hashToken(refreshToken) },
        data: { revoked: true },
      });
    }
    return { success: true };
  }

  private async issueTokens(userId: string, phone: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    const accessPayload: JwtPayload = { sub: userId, phone, jti: randomUUID() };
    const refreshPayload: JwtPayload = { sub: userId, phone, jti: randomUUID() };
    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: (this.config.get<string>('JWT_ACCESS_EXPIRES') || '15m') as JwtSignOptions['expiresIn'],
    });
    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: (this.config.get<string>('JWT_REFRESH_EXPIRES') || '7d') as JwtSignOptions['expiresIn'],
    });
    const decodedRefresh = this.jwtService.decode(refreshToken) as { exp?: number } | null;
    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: this.hashToken(refreshToken),
        expiresAt: decodedRefresh?.exp ? new Date(decodedRefresh.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        avatar: user.avatar,
        role: user.role,
        teamId: user.teamId,
        mfaEnabled: user.mfaEnabled,
        systemAdmin: isSystemAdmin(this.config, user.phone),
      },
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
