import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { PlatformAdapterFactory } from '../platform-adapters/platform-adapter.factory';
import { CrmService } from './crm.service';
import { InteractionLeadsService } from './interaction-leads.service';
import { NotifyService } from './notify.service';

describe('InteractionLeadsService lead form links', () => {
  const leadForm = {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  };
  const platformAccount = {
    findMany: jest.fn(),
  };
  const prisma = { leadForm, platformAccount };

  beforeEach(() => {
    jest.clearAllMocks();
    leadForm.create.mockResolvedValue({
      id: 'form-1',
      teamId: 'team-1',
      name: '询价',
      fields: '[]',
    });
    leadForm.update.mockImplementation(async ({ data }: { data: { shareUrl: string } }) => ({
      id: 'form-1',
      shareUrl: data.shareUrl,
    }));
    leadForm.findMany.mockResolvedValue([]);
    platformAccount.findMany.mockResolvedValue([]);
  });

  function service(environment: Record<string, string | undefined>) {
    const config = {
      get: jest.fn((name: string) => environment[name]),
    };
    return new InteractionLeadsService(
      prisma as unknown as PrismaService,
      {} as AiGatewayService,
      {} as NotifyService,
      {} as CrmService,
      config as unknown as ConfigService,
      {} as PlatformAdapterFactory,
    );
  }

  const dto = {
    name: '询价',
    template: 'quote',
    fields: [{ name: 'phone', label: '电话', type: 'tel', required: true }],
  };

  it('uses the Docker frontend origin when production APP_DOMAIN is blank', async () => {
    await expect(service({ NODE_ENV: 'production', APP_DOMAIN: '' }).createForm('team-1', dto))
      .resolves.toMatchObject({ shareUrl: 'http://localhost/lead/form-1' });
  });

  it('uses the Vite origin for local development and trims a configured trailing slash', async () => {
    await expect(service({ NODE_ENV: 'development', APP_DOMAIN: '' }).createForm('team-1', dto))
      .resolves.toMatchObject({ shareUrl: 'http://localhost:5173/lead/form-1' });
    await expect(service({ NODE_ENV: 'production', APP_DOMAIN: 'https://app.example.com/' }).createForm('team-1', dto))
      .resolves.toMatchObject({ shareUrl: 'https://app.example.com/lead/form-1' });
  });

  it('does not leak the Vite port from a production loopback APP_DOMAIN', async () => {
    await expect(service({ NODE_ENV: 'production', APP_DOMAIN: 'http://localhost:5173' }).createForm('team-1', dto))
      .resolves.toMatchObject({ shareUrl: 'http://localhost/lead/form-1' });
  });

  it('normalizes existing form links to the current production app origin', async () => {
    leadForm.findMany.mockResolvedValueOnce([{
      id: 'form-1',
      shareUrl: 'http://localhost:5173/lead/form-1?source=douyin',
    }]);

    await expect(service({ NODE_ENV: 'production', APP_DOMAIN: 'http://localhost:5173' }).listForms('team-1'))
      .resolves.toEqual([{
        id: 'form-1',
      shareUrl: 'http://localhost/lead/form-1?source=douyin',
    }]);
  });

  it('reports browser-scan accounts as explicitly skipped during interaction sync', async () => {
    platformAccount.findMany.mockResolvedValueOnce([
      {
        id: 'scan-account-1',
        teamId: 'team-1',
        platform: 'video_account',
        authType: 'scan',
        status: 'active',
      },
    ]);

    await expect(service({}).syncInteractions()).resolves.toEqual({
      accounts: 0,
      comments: 0,
      messages: 0,
      failed: 0,
      skippedScan: 1,
    });
    expect(platformAccount.findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
    });
  });
});
