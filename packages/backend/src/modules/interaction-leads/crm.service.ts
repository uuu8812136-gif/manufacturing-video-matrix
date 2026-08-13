import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';
import { CrmConfigDto } from './dto/lead.dto';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { assertSafeExternalUrl, prepareSafeExternalRequest } from '../../common/utils/external-url.util';

export interface ICrmProvider {
  pushLead(lead: any, config: any): Promise<{ success: boolean; externalId?: string }>;
}

function requiredApiUrl(config: any, provider: string): string {
  const url = String(config?.apiUrl || '').trim();
  if (!url) throw new Error(`${provider} API 地址未配置`);
  return url;
}

function responseMessage(data: any): string {
  const nested = data?.data && typeof data.data === 'object' ? data.data : undefined;
  const result = data?.result && typeof data.result === 'object' ? data.result : undefined;
  return String(
    nested?.errorMessage || nested?.message || nested?.msg || nested?.error
    || result?.errorMessage || result?.message || result?.msg || result?.error
    || data?.errorMessage || data?.message || data?.msg || data?.error
    || nested?.errorCode || nested?.code || result?.errorCode || result?.code
    || data?.errorCode || data?.code || '未知错误',
  );
}

function assertCrmSuccess(provider: string, data: any): { success: true; externalId?: string } {
  if (!data) {
    throw new Error(`${provider}推送失败：${responseMessage(data)}`);
  }
  const layers = [data, data.data, data.result]
    .filter((value) => value && typeof value === 'object');
  const successCodes = [0, '0', 200, '200', 'OK', 'ok', 'SUCCESS', 'success'];
  for (const layer of layers) {
    const status = String(layer.status || '').toLowerCase();
    if (layer.success === false || layer.error || ['failed', 'failure', 'error', 'rejected'].includes(status)) {
      throw new Error(`${provider}推送失败：${responseMessage(data)}`);
    }
    const layerCode = layer.errorCode ?? layer.code ?? layer.errcode;
    if (layerCode !== undefined && !successCodes.includes(layerCode)) {
      throw new Error(`${provider}推送失败：${responseMessage(data)}`);
    }
  }
  const externalId = data?.data?.id ?? data?.data?.objectId ?? data?.result?.id ?? data?.id;
  const confirmed = layers.some((layer) => {
    const code = layer.errorCode ?? layer.code ?? layer.errcode;
    return layer.success === true || (code !== undefined && successCodes.includes(code));
  }) || externalId !== undefined;
  if (!confirmed) throw new Error(`${provider}响应缺少明确的成功标记`);
  return { success: true, externalId: externalId === undefined ? undefined : String(externalId) };
}

export class FenxiProvider implements ICrmProvider {
  async pushLead(lead: any, config: any): Promise<{ success: boolean; externalId?: string }> {
    const target = await prepareSafeExternalRequest(requiredApiUrl(config, '纷享销客'), { requireHttps: true });
    const res = await axios.post(
      target.url.toString(),
      {
        accessToken: config?.token,
        leadName: lead.name,
        mobile: lead.phone,
        company: lead.company,
        remark: lead.demand,
      },
      { timeout: 8000, maxRedirects: 0, ...target.transport },
    );
    return assertCrmSuccess('纷享销客', res.data);
  }
}

export class XiaoshouyiProvider implements ICrmProvider {
  async pushLead(lead: any, config: any): Promise<{ success: boolean; externalId?: string }> {
    const target = await prepareSafeExternalRequest(requiredApiUrl(config, '销售易'), { requireHttps: true });
    const res = await axios.post(
      target.url.toString(),
      {
        accessToken: config?.token,
        name: lead.name,
        phone: lead.phone,
        company: lead.company,
        description: lead.demand,
      },
      { timeout: 8000, maxRedirects: 0, ...target.transport },
    );
    return assertCrmSuccess('销售易', res.data);
  }
}

export class HongquanProvider implements ICrmProvider {
  async pushLead(lead: any, config: any): Promise<{ success: boolean; externalId?: string }> {
    const target = await prepareSafeExternalRequest(requiredApiUrl(config, '红圈'), { requireHttps: true });
    const res = await axios.post(
      target.url.toString(),
      {
        token: config?.token,
        customerName: lead.name,
        mobile: lead.phone,
        company: lead.company,
        demand: lead.demand,
      },
      { timeout: 8000, maxRedirects: 0, ...target.transport },
    );
    return assertCrmSuccess('红圈', res.data);
  }
}

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);
  private readonly providers: Record<string, ICrmProvider>;

  constructor(private prisma: PrismaService) {
    this.providers = {
      fenxi: new FenxiProvider(),
      xiaoshouyi: new XiaoshouyiProvider(),
      hongquan: new HongquanProvider(),
    };
  }

  async sync(leadId: string, expectedTeamId?: string): Promise<{ synced: boolean; provider?: string; error?: string }> {
    try {
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
      if (!lead) {
        this.logger.warn(`CRM 同步：线索 ${leadId} 不存在`);
        return { synced: false };
      }
      if (expectedTeamId && lead.teamId !== expectedTeamId) {
        throw new BadRequestException('线索不存在');
      }
      if (lead.crmSyncedAt) {
        return { synced: true, provider: lead.crmProvider || undefined };
      }
      const integration = await this.prisma.crmIntegration.findFirst({
        where: { teamId: lead.teamId, enabled: true },
      });
      if (!integration) {
        return { synced: false };
      }
      const provider = this.providers[integration.provider];
      if (!provider) {
        this.logger.warn(`未支持的 CRM Provider：${integration.provider}`);
        return { synced: false };
      }
      const config = integration.config ? JSON.parse(CryptoUtil.decrypt(integration.config)) : {};
      if (config.apiUrl) {
        const safeUrl = await assertSafeExternalUrl(config.apiUrl);
        if (safeUrl.protocol !== 'https:') throw new Error('CRM 网关会携带 Token，必须使用 HTTPS');
      }
      const result = await provider.pushLead(lead, config);
      if (!result.success) {
        this.logger.warn(`CRM 同步失败：${integration.provider} lead=${leadId}`);
      }
      if (result.success) {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { crmProvider: integration.provider, crmExternalId: result.externalId || null, crmSyncedAt: new Date(), crmSyncError: null },
        });
      }
      return { synced: result.success, provider: integration.provider };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`CRM 同步异常 lead=${leadId}：${(err as Error).message}`);
      await this.prisma.lead.updateMany({ where: { id: leadId }, data: { crmSyncError: (err as Error).message.slice(0, 4000) } });
      return { synced: false, error: (err as Error).message };
    }
  }

  async syncAllLeads(teamId: string): Promise<{ total: number; synced: number }> {
    const leads = await this.prisma.lead.findMany({
      where: {
        teamId,
        status: { notIn: ['deal', 'lost'] },
        crmSyncedAt: null,
      },
    });
    let synced = 0;
    for (const lead of leads) {
      const result = await this.sync(lead.id);
      if (result.synced) synced++;
    }
    return { total: leads.length, synced };
  }

  async createConfig(teamId: string, dto: CrmConfigDto) {
    await this.validateConfig(dto.config);
    const existing = await this.prisma.crmIntegration.findFirst({
      where: { teamId, provider: dto.provider },
    });
    if (existing) {
      const updated = await this.prisma.crmIntegration.update({
        where: { id: existing.id },
        data: {
          config: dto.config !== undefined ? CryptoUtil.encrypt(JSON.stringify(dto.config)) : undefined,
          enabled: dto.enabled ?? undefined,
        },
      });
      return this.sanitizeConfig(updated);
    }
    const created = await this.prisma.crmIntegration.create({
      data: {
        teamId,
        provider: dto.provider,
        config: dto.config !== undefined ? CryptoUtil.encrypt(JSON.stringify(dto.config)) : null,
        enabled: dto.enabled ?? false,
      },
    });
    return this.sanitizeConfig(created);
  }

  async updateConfig(teamId: string, id: string, dto: CrmConfigDto) {
    await this.validateConfig(dto.config);
    const existing = await this.prisma.crmIntegration.findFirst({ where: { id, teamId } });
    if (!existing) throw new BadRequestException('CRM 配置不存在');
    const updated = await this.prisma.crmIntegration.update({
      where: { id },
      data: {
        provider: dto.provider,
        config: dto.config !== undefined ? CryptoUtil.encrypt(JSON.stringify(dto.config)) : undefined,
        enabled: dto.enabled ?? undefined,
      },
    });
    return this.sanitizeConfig(updated);
  }

  async listConfig(teamId: string) {
    const rows = await this.prisma.crmIntegration.findMany({ where: { teamId } });
    return rows.map((row) => this.sanitizeConfig(row));
  }

  async removeConfig(teamId: string, id: string) {
    const result = await this.prisma.crmIntegration.deleteMany({ where: { id, teamId } });
    if (result.count === 0) throw new BadRequestException('CRM 配置不存在');
    return { deleted: true };
  }

  private sanitizeConfig<T extends { config: string | null }>(row: T) {
    const { config, ...safe } = row;
    return { ...safe, configured: Boolean(config) };
  }

  private async validateConfig(config: any) {
    if (!config || typeof config !== 'object') throw new BadRequestException('CRM 配置必须为对象');
    if (!config.token) throw new BadRequestException('CRM Access Token 不能为空');
    if (!config.apiUrl) throw new BadRequestException('CRM API 地址不能为空');
    const safeUrl = await assertSafeExternalUrl(String(config.apiUrl));
    if (safeUrl.protocol !== 'https:') throw new BadRequestException('CRM 网关必须使用 HTTPS');
  }
}
