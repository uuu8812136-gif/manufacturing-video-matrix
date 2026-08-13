import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { parsePage } from '../../common/utils/page.util';
import {
  CreateLeadFormDto,
  UpdateLeadFormDto,
  SubmitLeadDto,
  UpdateLeadDto,
  AssignLeadDto,
  FollowUpDto,
  CreateAutoReplyDto,
  UpdateAutoReplyDto,
  CreateWebhookDto,
  UpdateWebhookDto,
  CrmConfigDto,
} from './dto/lead.dto';
import { NotifyService } from './notify.service';
import { CrmService } from './crm.service';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { assertSafeExternalUrl, prepareSafeExternalRequest } from '../../common/utils/external-url.util';
import { createHmac, randomBytes } from 'node:crypto';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { PlatformAdapterFactory } from '../platform-adapters/platform-adapter.factory';
import { createHash } from 'node:crypto';

@Injectable()
export class InteractionLeadsService {
  private readonly logger = new Logger(InteractionLeadsService.name);

  constructor(
    private prisma: PrismaService,
    private ai: AiGatewayService,
    private notify: NotifyService,
    private crm: CrmService,
    private config: ConfigService,
    private adapterFactory: PlatformAdapterFactory,
  ) {}

  // ---------- 评论/私信 ----------
  async listComments(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.platform) where.platform = query.platform;
    const [list, total] = await Promise.all([
      this.prisma.comment.findMany({ where, include: { account: { select: { id: true, nickname: true, platform: true } } }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.comment.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async listMessages(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.platform) where.platform = query.platform;
    const [list, total] = await Promise.all([
      this.prisma.message.findMany({ where, include: { account: { select: { id: true, nickname: true, platform: true } } }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.message.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async replyComment(teamId: string, id: string, text: string) {
    const comment = await this.prisma.comment.findFirst({ where: { id, teamId } });
    if (!comment) throw new BadRequestException('评论不存在');
    const account = await this.prisma.platformAccount.findFirst({ where: { id: comment.accountId, teamId } });
    if (!account) throw new BadRequestException('关联账号不存在');
    const adapter = this.adapterFactory.get(account.platform, account.authType);
    const params = {
      accountCredentials: account.credentials ? CryptoUtil.decrypt(account.credentials) : '',
      externalId: comment.externalId,
      platformContentId: comment.contentId || undefined,
      text,
    };
    const result = adapter.replyComment
      ? await adapter.replyComment(params)
      : await this.replyViaConfiguredEndpoint(account.platform, 'comment', params);
    if (!result.success) throw new BadRequestException(result.failReason || '平台评论回复失败');
    return this.prisma.comment.update({
      where: { id },
      data: { replyText: text, replied: true },
    });
  }

  async replyMessage(teamId: string, id: string, text: string) {
    const message = await this.prisma.message.findFirst({ where: { id, teamId } });
    if (!message) throw new BadRequestException('私信不存在');
    const account = await this.prisma.platformAccount.findFirst({ where: { id: message.accountId, teamId } });
    if (!account) throw new BadRequestException('关联账号不存在');
    const adapter = this.adapterFactory.get(account.platform, account.authType);
    const params = {
      accountCredentials: account.credentials ? CryptoUtil.decrypt(account.credentials) : '',
      externalId: message.externalId,
      text,
    };
    const result = adapter.replyMessage
      ? await adapter.replyMessage(params)
      : await this.replyViaConfiguredEndpoint(account.platform, 'message', params);
    if (!result.success) throw new BadRequestException(result.failReason || '平台私信回复失败');
    return this.prisma.message.update({
      where: { id },
      data: { replyText: text, replied: true },
    });
  }

  async aiSuggestReply(context: string) {
    const output = await this.ai.chat([
      { role: 'system', content: '你是 B2B 客服，根据评论/私信上下文生成专业友好的回复。' },
      { role: 'user', content: `上下文：${context}\n请生成回复：` },
    ]);
    return { reply: output };
  }

  // ---------- 自动回复规则 ----------
  async listAutoReply(teamId: string) {
    return this.prisma.autoReplyRule.findMany({ where: { teamId } });
  }

  async createAutoReply(teamId: string, dto: CreateAutoReplyDto) {
    return this.prisma.autoReplyRule.create({ data: { teamId, ...dto } });
  }

  async updateAutoReply(teamId: string, id: string, dto: UpdateAutoReplyDto) {
    const exists = await this.prisma.autoReplyRule.findFirst({ where: { id, teamId } });
    if (!exists) throw new BadRequestException('自动回复规则不存在');
    return this.prisma.autoReplyRule.update({ where: { id }, data: dto });
  }

  async removeAutoReply(teamId: string, id: string) {
    return this.prisma.autoReplyRule.deleteMany({ where: { id, teamId } });
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncInteractions() {
    const activeAccounts = await this.prisma.platformAccount.findMany({ where: { status: 'active' } });
    const accounts = activeAccounts.filter((account) => account.authType !== 'scan');
    const skippedScan = activeAccounts.length - accounts.length;
    let comments = 0;
    let messages = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        const adapter = this.adapterFactory.get(account.platform, account.authType);
        const credentials = account.credentials ? CryptoUtil.decrypt(account.credentials) : '';
        const [remoteComments, remoteMessages, rules] = await Promise.all([
          adapter.fetchComments(credentials),
          adapter.fetchMessages(credentials),
          this.prisma.autoReplyRule.findMany({ where: { teamId: account.teamId, enabled: true } }),
        ]);

        for (const item of remoteComments) {
          const externalId = item.externalId || this.interactionFingerprint(item.platformContentId, item.userName, item.text, item.createdAt);
          const row = await this.prisma.comment.upsert({
            where: { accountId_externalId: { accountId: account.id, externalId } },
            update: {},
            create: {
              teamId: account.teamId,
              accountId: account.id,
              externalId,
              platform: account.platform,
              contentId: item.platformContentId || null,
              userName: item.userName,
              userAvatar: item.userAvatar || null,
              text: item.text,
              createdAt: this.safeDate(item.createdAt),
            },
          });
          comments += 1;
          await this.applyAutoReply(account.platform, adapter, credentials, row, rules, 'comment');
        }

        for (const item of remoteMessages) {
          const externalId = item.externalId || this.interactionFingerprint('', item.userName, item.text, item.createdAt);
          const row = await this.prisma.message.upsert({
            where: { accountId_externalId: { accountId: account.id, externalId } },
            update: {},
            create: {
              teamId: account.teamId,
              accountId: account.id,
              externalId,
              platform: account.platform,
              userName: item.userName,
              text: item.text,
              createdAt: this.safeDate(item.createdAt),
            },
          });
          messages += 1;
          await this.applyAutoReply(account.platform, adapter, credentials, row, rules, 'message');
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(`互动同步失败 account=${account.id}: ${(error as Error).message}`);
      }
    }
    return { accounts: accounts.length, comments, messages, failed, skippedScan };
  }

  private async applyAutoReply(
    platform: string,
    adapter: ReturnType<PlatformAdapterFactory['get']>,
    credentials: string,
    row: { id: string; externalId: string; text: string; replied: boolean; contentId?: string | null },
    rules: Array<{ keyword: string; reply: string; scope: string }>,
    type: 'comment' | 'message',
  ) {
    if (row.replied) return;
    const rule = rules.find((item) => (item.scope === 'all' || item.scope === type) && row.text.includes(item.keyword));
    if (!rule) return;
    try {
      if (type === 'comment') {
        const params = {
          accountCredentials: credentials,
          externalId: row.externalId,
          platformContentId: row.contentId || undefined,
          text: rule.reply,
        };
        const result = adapter.replyComment
          ? await adapter.replyComment(params)
          : await this.replyViaConfiguredEndpoint(platform, 'comment', params);
        if (!result.success) return;
        await this.prisma.comment.update({ where: { id: row.id }, data: { replied: true, replyText: rule.reply } });
      } else {
        const params = {
          accountCredentials: credentials,
          externalId: row.externalId,
          text: rule.reply,
        };
        const result = adapter.replyMessage
          ? await adapter.replyMessage(params)
          : await this.replyViaConfiguredEndpoint(platform, 'message', params);
        if (!result.success) return;
        await this.prisma.message.update({ where: { id: row.id }, data: { replied: true, replyText: rule.reply } });
      }
    } catch (error) {
      this.logger.warn(`自动回复失败 ${type}=${row.id}: ${(error as Error).message}`);
    }
  }

  private interactionFingerprint(contentId: string, userName: string, text: string, createdAt: string) {
    return createHash('sha256').update(`${contentId}\n${userName}\n${text}\n${createdAt}`).digest('hex');
  }

  private safeDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private async replyViaConfiguredEndpoint(
    platform: string,
    type: 'comment' | 'message',
    params: { accountCredentials: string; externalId: string; platformContentId?: string; text: string },
  ) {
    const prefix = platform.toUpperCase().replace(/-/g, '_');
    const endpoint = this.config.get<string>(`PLATFORM_${prefix}_REPLY_${type.toUpperCase()}_URL`) || '';
    if (!endpoint) throw new BadRequestException(`${platform} 未配置${type === 'comment' ? '评论' : '私信'}回复接口`);
    const target = await prepareSafeExternalRequest(endpoint, { requireHttps: true });
    let accessToken = params.accountCredentials;
    try {
      const parsed = JSON.parse(params.accountCredentials);
      accessToken = parsed.access_token || parsed.accessToken || params.accountCredentials;
    } catch {
      // Cookie 或纯 Token 直接透传
    }
    const response = await axios.post(
      target.url.toString(),
      { externalId: params.externalId, platformContentId: params.platformContentId, text: params.text },
      {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        timeout: 15000,
        maxRedirects: 0,
        ...target.transport,
      },
    );
    const outer = response.data || {};
    const layers = [outer, outer.data, outer.result]
      .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
    const successCodes = [0, '0', 1, '1', 200, '200', 'OK', 'ok', 'SUCCESS', 'success'];
    for (const layer of layers) {
      const status = String(layer.status || '').toLowerCase();
      const code = layer.errorCode ?? layer.code ?? layer.errcode;
      if (layer.success === false || layer.error || ['failed', 'failure', 'error', 'rejected'].includes(status)
        || (code !== undefined && !successCodes.includes(code))) {
        throw new BadRequestException(String(layer.message || layer.error || '回复接口返回业务失败'));
      }
    }
    const data = outer.data && typeof outer.data === 'object' ? { ...outer, ...outer.data } : outer;
    const replyId = data.id || data.replyId || data.reply_id;
    const success = layers.some((layer) => layer.success === true) || Boolean(replyId);
    if (!success) {
      throw new BadRequestException('回复接口响应缺少明确的成功标记');
    }
    return {
      success,
      platformContentId: success ? String(replyId || params.externalId) : undefined,
      failReason: undefined,
    };
  }

  // ---------- 留资表单 ----------
  async listForms(teamId: string) {
    const forms = await this.prisma.leadForm.findMany({
      where: { teamId },
      include: { _count: { select: { leads: true } } },
    });
    return forms.map((form) => ({
      ...form,
      shareUrl: this.normalizeLeadFormShareUrl(form.shareUrl),
    }));
  }

  async getFormById(id: string) {
    const form = await this.prisma.leadForm.findFirst({ where: { id, active: true } });
    if (!form) throw new BadRequestException('表单不存在');
    return form;
  }

  async createForm(teamId: string, dto: CreateLeadFormDto) {
    this.validateLeadFormFields(dto.fields);
    const form = await this.prisma.leadForm.create({
      data: {
        teamId,
        name: dto.name,
        fields: JSON.stringify(dto.fields),
        template: dto.template,
        shareUrl: '',
      },
    });
    const appDomain = this.leadFormAppDomain();
    const shareUrl = `${appDomain}/lead/${form.id}`;
    return this.prisma.leadForm.update({
      where: { id: form.id },
      data: { shareUrl },
    });
  }

  private leadFormAppDomain(): string {
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const configured = (this.config.get<string>('APP_DOMAIN') || '').trim();
    const fallback = production ? 'http://localhost' : 'http://localhost:5173';
    const appDomain = (configured || fallback).replace(/\/+$/, '');

    if (!production) return appDomain;

    try {
      const url = new URL(appDomain);
      const viteLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
        && url.port === '5173';
      if (viteLoopback) {
        url.port = '';
        return url.origin;
      }
    } catch {
      return appDomain;
    }
    return appDomain;
  }

  private normalizeLeadFormShareUrl(shareUrl: string | null): string | null {
    if (!shareUrl) return shareUrl;
    try {
      const existing = new URL(shareUrl);
      return `${this.leadFormAppDomain()}${existing.pathname}${existing.search}${existing.hash}`;
    } catch {
      return shareUrl;
    }
  }

  async updateForm(teamId: string, id: string, dto: UpdateLeadFormDto) {
    const form = await this.prisma.leadForm.findFirst({ where: { id, teamId } });
    if (!form) throw new BadRequestException('表单不存在');
    if (dto.fields) this.validateLeadFormFields(dto.fields);
    return this.prisma.leadForm.update({
      where: { id },
      data: {
        name: dto.name,
        fields: dto.fields ? JSON.stringify(dto.fields) : undefined,
        template: dto.template,
        active: dto.active,
      },
    });
  }

  async removeForm(teamId: string, id: string) {
    const form = await this.prisma.leadForm.findFirst({ where: { id, teamId }, include: { _count: { select: { leads: true } } } });
    if (!form) throw new BadRequestException('表单不存在');
    if (form._count.leads > 0) throw new BadRequestException('该表单已有历史线索，请停用而不是删除');
    return this.prisma.leadForm.delete({ where: { id } });
  }

  private validateLeadFormFields(fields: Array<{ name: string; label: string; type: string; required?: boolean }>) {
    if (fields.length < 1 || fields.length > 30) throw new BadRequestException('表单字段数量必须为 1-30 个');
    const names = new Set<string>();
    const allowedTypes = new Set(['text', 'tel', 'email', 'textarea', 'select', 'number']);
    for (const field of fields) {
      const name = String(field.name || '').trim();
      const label = String(field.label || '').trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(name)) throw new BadRequestException(`字段名 ${name || '(空)'} 不合法`);
      if (!label || label.length > 60) throw new BadRequestException(`字段 ${name} 的标签不能为空且最多 60 字`);
      if (!allowedTypes.has(field.type)) throw new BadRequestException(`字段 ${name} 的类型不支持`);
      if (names.has(name)) throw new BadRequestException(`字段名 ${name} 重复`);
      names.add(name);
    }
  }

  async submitLead(dto: SubmitLeadDto) {
    const form = await this.prisma.leadForm.findUnique({ where: { id: dto.formId } });
    if (!form) throw new BadRequestException('表单不存在');
    if (!form.active) throw new BadRequestException('表单已停用');
    const teamId = form.teamId;
    const fields = (form.fields ? JSON.parse(form.fields) : []) as { name: string; label: string; required?: boolean }[];
    const data = dto.data;
    if (Object.keys(data).length > 50 || JSON.stringify(data).length > 20_000) throw new BadRequestException('提交内容过大');
    if (data.website) throw new BadRequestException('提交失败');
    const missing = fields.filter((field) => field.required && !String(data[field.name] || '').trim());
    if (missing.length > 0) {
      throw new BadRequestException(`请填写必填字段：${missing.map((field) => field.label || field.name).join('、')}`);
    }
    const name = data.name || data['姓名'] || '匿名客户';
    const phone = data.phone || data['电话'] || data['手机'] || '';
    const company = data.company || data['公司'] || null;
    const demand = data.demand || data['需求'] || null;

    const sourceAccount = dto.sourceAccountId
      ? await this.prisma.platformAccount.findFirst({ where: { id: dto.sourceAccountId, teamId } })
      : null;
    const lead = await this.prisma.lead.create({
      data: {
        teamId,
        name,
        phone,
        company,
        demand,
        sourcePlatform: dto.sourcePlatform || sourceAccount?.platform || 'lead_form',
        sourceAccountId: sourceAccount?.id || null,
        sourceContentId: dto.sourceContentId || null,
        sourceContentTitle: dto.sourceContentTitle || form.name,
        intention: 'medium',
        status: 'new',
        formId: form.id,
      },
    });

    await this.notifyLead(teamId, { name: lead.name, phone: lead.phone, demand: lead.demand ?? undefined });
    await this.fireWebhooks(teamId, 'lead.created', lead);
    this.crm
      .sync(lead.id)
      .catch((err) => this.logger.warn(`CRM 同步异常 lead=${lead.id}：${(err as Error).message}`));
    return lead;
  }

  private async notifyLead(teamId: string, lead: { name: string; phone: string; demand?: string }) {
    await this.prisma.notification.create({
      data: {
        teamId,
        type: 'lead',
        title: '新线索提醒',
        content: `客户 ${lead.name}(${lead.phone}) 提交了留资，请及时跟进`,
      },
    });
    try {
      await this.notify.notifyAll(teamId, lead);
    } catch (err) {
      this.logger.warn(`通知发送异常：${(err as Error).message}`);
    }
  }

  private async fireWebhooks(teamId: string, event: string, payload: unknown) {
    const hooks = await this.prisma.webhookConfig.findMany({ where: { teamId, enabled: true } });
    for (const hook of hooks) {
      const events = hook.events ? JSON.parse(hook.events) : [];
      if (events.length && !events.includes(event)) continue;
      try {
        const target = await prepareSafeExternalRequest(hook.url, { requireHttps: true });
        const body = JSON.stringify({ event, data: payload });
        const secret = hook.secret ? CryptoUtil.decrypt(hook.secret) : '';
        const signature = secret ? createHmac('sha256', secret).update(body).digest('hex') : '';
        await axios.post(target.url.toString(), body, {
          timeout: 5000,
          maxRedirects: 0,
          headers: { 'Content-Type': 'application/json', 'X-MVMS-Signature': signature },
          ...target.transport,
        });
      } catch (err) {
        this.logger.warn(`Webhook 推送失败 ${hook.url}: ${(err as Error).message}`);
      }
    }
  }

  // ---------- 线索池 ----------
  async listLeads(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.status) where.status = query.status;
    if (query.intention) where.intention = query.intention;
    if (query.platform) where.sourcePlatform = query.platform;
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword as string } },
        { phone: { contains: query.keyword as string } },
        { company: { contains: query.keyword as string } },
      ];
    }
    const [list, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          assignee: { select: { id: true, phone: true, name: true, avatar: true, role: true } },
          form: true,
          account: true,
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async updateLead(teamId: string, id: string, dto: UpdateLeadDto) {
    const lead = await this.prisma.lead.findFirst({ where: { id, teamId } });
    if (!lead) throw new BadRequestException('线索不存在');
    if (dto.assigneeId) await this.assertTeamMember(teamId, dto.assigneeId);
    return this.prisma.lead.update({
      where: { id },
      data: {
        intention: dto.intention,
        status: dto.status,
        assigneeId: dto.assigneeId,
        tags: dto.tags ? JSON.stringify(dto.tags) : undefined,
        estimatedValue: dto.estimatedValue,
        dealValue: dto.dealValue,
        sourceCost: dto.sourceCost,
      },
    });
  }

  async assign(teamId: string, id: string, dto: AssignLeadDto) {
    const lead = await this.prisma.lead.findFirst({ where: { id, teamId } });
    if (!lead) throw new BadRequestException('线索不存在');
    await this.assertTeamMember(teamId, dto.assigneeId);
    return this.prisma.lead.update({
      where: { id },
      data: { assigneeId: dto.assigneeId, status: 'assigned' },
    });
  }

  async autoAssign(teamId: string) {
    const unassigned = await this.prisma.lead.findMany({ where: { teamId, assigneeId: null, status: 'new' } });
    const members = await this.prisma.user.findMany({ where: { teamId, status: 'active' } });
    if (members.length === 0) return { assigned: 0 };
    let count = 0;
    for (let i = 0; i < unassigned.length; i++) {
      const assignee = members[i % members.length];
      await this.prisma.lead.update({
        where: { id: unassigned[i].id },
        data: { assigneeId: assignee.id, status: 'assigned' },
      });
      count++;
    }
    return { assigned: count };
  }

  async followUps(teamId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, teamId } });
    if (!lead) throw new BadRequestException('线索不存在');
    return this.prisma.followUpRecord.findMany({
      where: { leadId },
      include: { user: { select: { id: true, phone: true, name: true, avatar: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addFollowUp(teamId: string, leadId: string, userId: string, dto: FollowUpDto) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, teamId } });
    if (!lead) throw new BadRequestException('线索不存在');
    const record = await this.prisma.followUpRecord.create({
      data: {
        leadId,
        userId,
        content: dto.content,
        result: dto.result,
        nextAt: dto.nextAt ? new Date(dto.nextAt) : null,
      },
    });
    if (dto.result === '成交' || dto.result === 'deal') {
      await this.prisma.lead.update({ where: { id: leadId }, data: { status: 'deal' } });
    } else {
      await this.prisma.lead.update({ where: { id: leadId }, data: { status: 'following' } });
    }
    return record;
  }

  // ---------- 归因 ----------
  async attribution(teamId: string) {
    const leads = await this.prisma.lead.findMany({ where: { teamId } });
    const byPlatform: Record<string, number> = {};
    const byContent: Record<string, number> = {};
    const byAccount: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const l of leads) {
      byPlatform[l.sourcePlatform] = (byPlatform[l.sourcePlatform] || 0) + 1;
      if (l.sourceContentTitle) byContent[l.sourceContentTitle] = (byContent[l.sourceContentTitle] || 0) + 1;
      if (l.sourceAccountId) byAccount[l.sourceAccountId] = (byAccount[l.sourceAccountId] || 0) + 1;
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    }
    const total = leads.length;
    const deal = leads.filter((l) => l.status === 'deal').length;
    const accountIds = [...new Set(leads.map((lead) => lead.sourceAccountId).filter(Boolean) as string[])];
    const accounts = accountIds.length
      ? await this.prisma.platformAccount.findMany({ where: { teamId, id: { in: accountIds } }, select: { id: true, nickname: true, platform: true } })
      : [];
    const accountMap = new Map(accounts.map((account) => [account.id, account]));
    const revenue = leads.reduce((sum, lead) => sum + (lead.status === 'deal' ? lead.dealValue : 0), 0);
    const cost = leads.reduce((sum, lead) => sum + lead.sourceCost, 0);
    return {
      total,
      deal,
      conversionRate: total ? Number(((deal / total) * 100).toFixed(1)) : 0,
      revenue: Number(revenue.toFixed(2)),
      cost: Number(cost.toFixed(2)),
      roi: cost > 0 ? Number((((revenue - cost) / cost) * 100).toFixed(1)) : null,
      byPlatform: Object.entries(byPlatform).map(([platform, count]) => ({ platform, count })),
      byContent: Object.entries(byContent).map(([content, count]) => ({ content, count })).sort((a, b) => b.count - a.count).slice(0, 20),
      byAccount: Object.entries(byAccount).map(([accountId, count]) => ({ accountId, count, nickname: accountMap.get(accountId)?.nickname || accountId, platform: accountMap.get(accountId)?.platform || '' })).sort((a, b) => b.count - a.count),
      funnel: ['new', 'assigned', 'following', 'intended', 'deal', 'lost'].map((status) => ({ status, count: byStatus[status] || 0 })),
    };
  }

  // ---------- CRM / Webhook ----------
  async listCrm(teamId: string) {
    return this.crm.listConfig(teamId);
  }

  async createCrmConfig(teamId: string, dto: CrmConfigDto) {
    return this.crm.createConfig(teamId, dto);
  }

  async updateCrmConfig(teamId: string, id: string, dto: CrmConfigDto) {
    return this.crm.updateConfig(teamId, id, dto);
  }

  async removeCrmConfig(teamId: string, id: string) {
    return this.crm.removeConfig(teamId, id);
  }

  async syncCrm(teamId: string, leadId: string) {
    return this.crm.sync(leadId, teamId);
  }

  async syncAllCrm(teamId: string) {
    return this.crm.syncAllLeads(teamId);
  }

  async testNotifications(teamId: string) {
    return this.notify.notifyAll(teamId, {
      name: '系统接入测试',
      phone: '不包含真实客户信息',
      demand: '这是一条由系统管理员手动触发的通知通道测试',
    });
  }

  async listWebhooks(teamId: string) {
    const rows = await this.prisma.webhookConfig.findMany({ where: { teamId } });
    return rows.map(({ secret: _secret, ...row }) => ({ ...row, signed: Boolean(_secret) }));
  }

  async createWebhook(teamId: string, dto: CreateWebhookDto) {
    await assertSafeExternalUrl(dto.url, { requireHttps: true });
    const secret = randomBytes(24).toString('hex');
    const row = await this.prisma.webhookConfig.create({
      data: { teamId, url: dto.url, events: JSON.stringify(dto.events || []), secret: CryptoUtil.encrypt(secret) },
    });
    const { secret: _stored, ...safe } = row;
    return { ...safe, secret };
  }

  async updateWebhook(teamId: string, id: string, dto: UpdateWebhookDto) {
    const existing = await this.prisma.webhookConfig.findFirst({ where: { id, teamId } });
    if (!existing) throw new BadRequestException('Webhook 不存在');
    if (dto.url) await assertSafeExternalUrl(dto.url, { requireHttps: true });
    const row = await this.prisma.webhookConfig.update({
      where: { id },
      data: {
        url: dto.url,
        events: dto.events ? JSON.stringify(dto.events) : undefined,
        enabled: dto.enabled,
      },
    });
    const { secret: _secret, ...safe } = row;
    return { ...safe, signed: Boolean(_secret) };
  }

  async removeWebhook(teamId: string, id: string) {
    const result = await this.prisma.webhookConfig.deleteMany({ where: { id, teamId } });
    if (result.count === 0) throw new BadRequestException('Webhook 不存在');
    return { deleted: true };
  }

  async exportLeads(teamId: string) {
    const leads = await this.prisma.lead.findMany({
      where: { teamId },
      include: { assignee: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('线索');
    sheet.columns = [
      { header: '姓名', key: 'name', width: 16 },
      { header: '手机', key: 'phone', width: 18 },
      { header: '公司', key: 'company', width: 24 },
      { header: '需求', key: 'demand', width: 36 },
      { header: '来源平台', key: 'sourcePlatform', width: 16 },
      { header: '来源内容', key: 'sourceContentTitle', width: 28 },
      { header: '意向', key: 'intention', width: 12 },
      { header: '状态', key: 'status', width: 12 },
      { header: '负责人', key: 'assignee', width: 16 },
      { header: '预计金额', key: 'estimatedValue', width: 16 },
      { header: '成交金额', key: 'dealValue', width: 16 },
      { header: '获客成本', key: 'sourceCost', width: 16 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ];
    for (const lead of leads) {
      sheet.addRow({ ...lead, assignee: lead.assignee?.name || '', createdAt: lead.createdAt });
    }
    return workbook.xlsx.writeBuffer();
  }

  private async assertTeamMember(teamId: string, userId: string) {
    const member = await this.prisma.user.findFirst({ where: { id: userId, teamId, status: 'active' } });
    if (!member) throw new BadRequestException('负责人不存在或不属于当前企业');
  }
}
