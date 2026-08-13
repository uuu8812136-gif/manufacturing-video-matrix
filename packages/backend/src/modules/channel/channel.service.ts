import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parsePage } from '../../common/utils/page.util';
import { BadRequestException } from '@nestjs/common';
import { CreateChannelDto, CreateCodeDto, SettleDto } from './dto/channel.dto';

@Injectable()
export class ChannelService {
  constructor(private prisma: PrismaService) {}

  async listChannels(query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const [list, total] = await Promise.all([
      this.prisma.channel.findMany({ skip, take, include: { _count: { select: { codes: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.channel.count(),
    ]);
    return { list, total, page, pageSize };
  }

  async createChannel(dto: CreateChannelDto) {
    return this.prisma.channel.create({ data: dto });
  }

  async listCodes(channelId?: string) {
    const where = channelId ? { channelId } : {};
    return this.prisma.channelCode.findMany({
      where,
      include: { channel: true, _count: { select: { customers: true } } },
    });
  }

  async createCode(dto: CreateCodeDto) {
    const code = `MVMS${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    return this.prisma.channelCode.create({
      data: { channelId: dto.channelId, code, discountRate: dto.discountRate },
    });
  }

  async report(channelId?: string) {
    const codes = await this.prisma.channelCode.findMany({
      where: channelId ? { channelId } : {},
      include: { channel: true, customers: { include: { commissions: true } } },
    });
    let registered = 0;
    let paid = 0;
    let commission = 0;
    const channelMap = new Map<string, { name: string; registered: number; paid: number; commission: number }>();
    for (const c of codes) {
      for (const cust of c.customers) {
        registered++;
        if (cust.paid) paid++;
        const com = cust.commissions.reduce((s, x) => s + x.amount, 0);
        commission += com;
        const key = c.channel.name;
        const cur = channelMap.get(key) || { name: key, registered: 0, paid: 0, commission: 0 };
        cur.registered++;
        if (cust.paid) cur.paid++;
        cur.commission += com;
        channelMap.set(key, cur);
      }
    }
    return {
      summary: { registered, paid, renewalRate: registered ? Number(((paid / registered) * 100).toFixed(1)) : 0, totalCommission: Number(commission.toFixed(2)) },
      byChannel: Array.from(channelMap.values()),
    };
  }

  async customers() {
    return this.prisma.channelCustomer.findMany({
      include: { code: { include: { channel: true } }, commissions: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markPaid(customerId: string, amount: number) {
    const cents = amount * 100;
    if (!Number.isFinite(amount) || amount < 0.01 || Math.abs(cents - Math.round(cents)) > 1e-8) {
      throw new BadRequestException('实际付费金额必须大于 0，且最多保留两位小数');
    }
    const customer = await this.prisma.channelCustomer.findUnique({
      where: { id: customerId },
      include: { code: { include: { channel: true } }, commissions: true },
    });
    if (!customer) throw new BadRequestException('渠道客户不存在');
    const commission = Number((amount * customer.code.channel.commissionRate).toFixed(2));
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.channelCustomer.update({ where: { id: customerId }, data: { paid: true, paidAmount: amount } });
      if (customer.commissions.length) {
        await tx.commissionRecord.updateMany({ where: { customerId }, data: { amount: commission } });
      } else {
        await tx.commissionRecord.create({ data: { customerId, amount: commission } });
      }
      return { ...updated, commission };
    });
  }

  async settle(customerId: string, dto: SettleDto) {
    return this.prisma.commissionRecord.updateMany({
      where: { customerId },
      data: { status: dto.settled ? 'settled' : 'pending', settledAt: dto.settled ? new Date() : null },
    });
  }
}
