import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../system/minio.service';
import { DistributionService } from '../distribution/distribution.service';
import { DigitalHumanProviderFactory } from './digital-human.provider';
import { DigitalHumanService } from './digital-human.service';

jest.mock('../../common/utils/external-url.util', () => ({
  downloadExternalBuffer: jest.fn().mockResolvedValue(Buffer.from('provider-video')),
}));

describe('DigitalHumanService task failure handling', () => {
  it('maps the filtered background output exactly once', () => {
    const service = new DigitalHumanService(
      {} as PrismaService,
      {} as DigitalHumanProviderFactory,
      {} as MinioService,
      {} as DistributionService,
    );
    const command = {
      complexFilter: jest.fn().mockReturnThis(),
      outputOptions: jest.fn().mockReturnThis(),
    };

    expect((service as any).configureBackgroundFilter(command)).toBe(command);
    expect(command.complexFilter).toHaveBeenCalledWith([
      '[1:v][0:v]scale2ref=w=iw:h=ih[bgraw][video]',
      '[bgraw]setsar=1[bg]',
      '[video]setsar=1,chromakey=0x00FF00:0.3:0.1[fg]',
      '[bg][fg]overlay=0:0:eof_action=repeat,setsar=1[v]',
    ]);
    expect(command.complexFilter.mock.calls[0]).toHaveLength(1);
    expect(command.outputOptions).toHaveBeenCalledWith(['-map [v]', '-map 0:a?']);
  });

  it('rejects removing the avatar binding from a real digital-human IP', async () => {
    const prisma = {
      digitalHumanIp: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ip-1', avatarId: 'avatar-1', provider: 'heygen' }),
        update: jest.fn(),
      },
    } as unknown as PrismaService;
    const service = new DigitalHumanService(
      prisma,
      {} as DigitalHumanProviderFactory,
      {} as MinioService,
      {} as DistributionService,
    );

    await expect(service.updateIp('team-1', 'ip-1', { avatarId: null } as never))
      .rejects.toThrow('真实数字人 IP 必须绑定已配置的数字人形象');
    expect(prisma.digitalHumanIp.update).not.toHaveBeenCalled();
  });

  it('marks the persisted task failed when provider configuration is invalid', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'task-1', status: 'failed' });
    const prisma = {
      digitalHumanIp: { findFirst: jest.fn().mockResolvedValue({ id: 'ip-1', provider: 'heygen', avatarId: null }) },
      digitalHumanAvatar: { findFirst: jest.fn() },
      digitalHumanTask: {
        create: jest.fn().mockResolvedValue({ id: 'task-1' }),
        update,
      },
    } as unknown as PrismaService;
    const providers = {
      get: jest.fn(() => { throw new Error('未配置 HEYGEN_API_KEY'); }),
    } as unknown as DigitalHumanProviderFactory;
    const service = new DigitalHumanService(
      prisma,
      providers,
      {} as MinioService,
      {} as DistributionService,
    );

    await expect(service.generateVideo('team-1', 'user-1', { ipId: 'ip-1', script: '测试脚本' }))
      .rejects.toThrow('数字人视频生成失败');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'failed', error: '未配置 HEYGEN_API_KEY' },
    });
  });

  it('marks the task failed when generate returns neither a video URL nor a provider task ID', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'task-empty', status: 'failed' });
    const prisma = {
      digitalHumanIp: { findFirst: jest.fn().mockResolvedValue({ id: 'ip-1', provider: 'heygen', avatarId: null }) },
      digitalHumanAvatar: { findFirst: jest.fn() },
      digitalHumanTask: {
        create: jest.fn().mockResolvedValue({ id: 'task-empty' }),
        update,
      },
    } as unknown as PrismaService;
    const providers = {
      get: jest.fn().mockReturnValue({ generate: jest.fn().mockResolvedValue({}) }),
    } as unknown as DigitalHumanProviderFactory;
    const service = new DigitalHumanService(
      prisma,
      providers,
      {} as MinioService,
      {} as DistributionService,
    );

    await expect(service.generateVideo('team-1', 'user-1', { ipId: 'ip-1', script: '测试脚本' }))
      .rejects.toThrow('数字人视频生成失败：数字人服务商未返回视频地址或任务 ID');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'task-empty' },
      data: {
        status: 'failed',
        error: '数字人服务商未返回视频地址或任务 ID',
      },
    });
  });

  it('persists a synchronously generated provider video before marking the task done', async () => {
    const updateTask = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'task-sync', ...data }));
    const updateIp = jest.fn().mockResolvedValue({ id: 'ip-1', videoCount: 1 });
    const prisma = {
      digitalHumanIp: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ip-1', provider: 'heygen', avatarId: null }),
        update: updateIp,
      },
      digitalHumanAvatar: { findFirst: jest.fn() },
      digitalHumanTask: {
        create: jest.fn().mockResolvedValue({ id: 'task-sync' }),
        update: updateTask,
      },
    } as unknown as PrismaService;
    const providers = {
      get: jest.fn().mockReturnValue({
        generate: jest.fn().mockResolvedValue({ videoUrl: 'https://provider.example/video.mp4' }),
      }),
    } as unknown as DigitalHumanProviderFactory;
    const minio = {
      upload: jest.fn().mockResolvedValue(undefined),
      publicUrl: jest.fn().mockReturnValue('https://storage.example/task-sync.mp4'),
    } as unknown as MinioService;
    const service = new DigitalHumanService(prisma, providers, minio, {} as DistributionService);

    await expect(service.generateVideo('team-1', 'user-1', { ipId: 'ip-1', script: '测试脚本' }))
      .resolves.toEqual(expect.objectContaining({
        id: 'task-sync',
        status: 'done',
        videoUrl: 'https://storage.example/task-sync.mp4',
      }));
    expect(minio.upload).toHaveBeenCalledWith(
      'teams/team-1/digital-human/task-sync.mp4',
      Buffer.from('provider-video'),
      'video/mp4',
    );
    expect(updateIp).toHaveBeenCalledWith({
      where: { id: 'ip-1' },
      data: { videoCount: { increment: 1 } },
    });
  });

  it('fails a legacy processing task that has no provider task ID', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      digitalHumanTask: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'task-missing-provider-id',
          teamId: 'team-1',
          ipId: 'ip-1',
          provider: 'heygen',
          providerTaskId: null,
          status: 'processing',
          pollAttempts: 0,
          createdAt: new Date(),
        }]),
        updateMany,
      },
    } as unknown as PrismaService;
    const providers = { get: jest.fn() } as unknown as DigitalHumanProviderFactory;
    const service = new DigitalHumanService(prisma, providers, {} as MinioService, {} as DistributionService);

    await expect(service.pollProcessingTasks()).resolves.toEqual({ checked: 1 });
    expect(providers.get).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'task-missing-provider-id', status: 'processing' },
      data: {
        status: 'failed',
        error: expect.stringContaining('缺少服务商任务 ID'),
        lastPolledAt: expect.any(Date),
      },
    });
  });

  it('marks an over-age processing task failed without calling the provider again', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      digitalHumanTask: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'task-old',
          teamId: 'team-1',
          ipId: 'ip-1',
          provider: 'heygen',
          providerTaskId: 'provider-1',
          status: 'processing',
          pollAttempts: 2,
          createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
        }]),
        updateMany,
      },
    } as unknown as PrismaService;
    const providers = { get: jest.fn() } as unknown as DigitalHumanProviderFactory;
    const service = new DigitalHumanService(
      prisma,
      providers,
      {} as MinioService,
      {} as DistributionService,
    );

    await expect(service.pollProcessingTasks()).resolves.toEqual({ checked: 1 });
    expect(providers.get).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'task-old', status: 'processing' },
      data: expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('6 小时'),
        lastPolledAt: expect.any(Date),
      }),
    });
  });

  it('marks a task failed when the final allowed polling attempt errors', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      digitalHumanTask: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'task-retry',
          teamId: 'team-1',
          ipId: 'ip-1',
          provider: 'heygen',
          providerTaskId: 'provider-2',
          status: 'processing',
          pollAttempts: 239,
          createdAt: new Date(),
        }]),
        updateMany,
      },
    } as unknown as PrismaService;
    const providers = {
      get: jest.fn().mockReturnValue({
        pollStatus: jest.fn().mockRejectedValue(new Error('provider unavailable')),
      }),
    } as unknown as DigitalHumanProviderFactory;
    const service = new DigitalHumanService(
      prisma,
      providers,
      {} as MinioService,
      {} as DistributionService,
    );

    await expect(service.pollProcessingTasks()).resolves.toEqual({ checked: 1 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'task-retry', status: 'processing' },
      data: expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('最大次数 240'),
        pollAttempts: { increment: 1 },
        lastPolledAt: expect.any(Date),
      }),
    });
  });
});
