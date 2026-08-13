import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { InviteMemberDto, UpdateProfileDto } from './dto/user.dto';
import { ConfigService } from '@nestjs/config';
import { isSystemAdmin } from '../../common/utils/system-admin.util';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { team: true },
    });
    if (!user) throw new BadRequestException('用户不存在');
    return {
      id: user.id,
      phone: user.phone,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      mfaEnabled: user.mfaEnabled,
      teamId: user.teamId,
      teamName: user.team?.name,
      plan: user.team?.plan,
      systemAdmin: isSystemAdmin(this.config, user.phone),
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name, avatar: dto.avatar },
      select: { id: true, phone: true, name: true, avatar: true, role: true, teamId: true, mfaEnabled: true },
    });
  }

  async listMembers(teamId: string) {
    const users = await this.prisma.user.findMany({
      where: { teamId },
      select: {
        id: true,
        phone: true,
        name: true,
        avatar: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return users;
  }

  async invite(teamId: string, actorRole: string, dto: InviteMemberDto) {
    if (dto.role === 'super_admin' && actorRole !== 'super_admin') throw new BadRequestException('仅超级管理员可邀请超级管理员');
    const exists = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (exists) throw new BadRequestException('该手机号已存在');
    const password = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { phone: dto.phone, password, name: dto.name, role: dto.role, teamId } });
      await tx.teamMember.create({ data: { teamId, userId: created.id, role: dto.role } });
      return created;
    });
    return { id: user.id, phone: user.phone, name: user.name, role: user.role };
  }

  async updateRole(teamId: string, actorId: string, actorRole: string, userId: string, role: string) {
    const member = await this.prisma.user.findFirst({ where: { id: userId, teamId } });
    if (!member) throw new BadRequestException('团队成员不存在');
    if ((member.role === 'super_admin' || role === 'super_admin') && actorRole !== 'super_admin') throw new BadRequestException('仅超级管理员可管理超级管理员角色');
    if (actorId === userId && member.role === 'super_admin' && role !== 'super_admin') {
      const admins = await this.prisma.user.count({ where: { teamId, role: 'super_admin', status: 'active' } });
      if (admins <= 1) throw new BadRequestException('企业至少需要保留一名超级管理员');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.teamMember.updateMany({ where: { userId, teamId }, data: { role } });
      return tx.user.update({
        where: { id: userId },
        data: { role },
        select: { id: true, phone: true, name: true, avatar: true, role: true, teamId: true, status: true },
      });
    });
  }

  async remove(teamId: string, actorId: string, actorRole: string, userId: string) {
    const member = await this.prisma.user.findFirst({ where: { id: userId, teamId } });
    if (!member) throw new BadRequestException('团队成员不存在');
    if (actorId === userId) throw new BadRequestException('不能移除当前登录账号');
    if (member.role === 'super_admin' && actorRole !== 'super_admin') throw new BadRequestException('仅超级管理员可移除超级管理员');
    if (member.role === 'super_admin') {
      const admins = await this.prisma.user.count({ where: { teamId, role: 'super_admin', status: 'active' } });
      if (admins <= 1) throw new BadRequestException('企业至少需要保留一名超级管理员');
    }
    await this.prisma.teamMember.deleteMany({ where: { userId, teamId } });
    return this.prisma.user.update({
      where: { id: userId },
      data: { status: 'disabled' },
      select: { id: true, phone: true, name: true, status: true },
    });
  }
}
