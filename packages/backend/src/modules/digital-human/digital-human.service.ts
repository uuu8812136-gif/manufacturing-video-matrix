import { Injectable, BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../system/minio.service';
import { parsePage } from '../../common/utils/page.util';
import { CreateAvatarDto, CreateIpDto, GenerateVideoDto, UpdateAvatarDto, UpdateIpDto } from './dto/digital-human.dto';
import {
  DigitalHumanProviderFactory,
  DigitalHumanGenerateOptions,
} from './digital-human.provider';
import { Interval } from '@nestjs/schedule';
import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { downloadExternalBuffer } from '../../common/utils/external-url.util';
import { DistributionService } from '../distribution/distribution.service';

const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const MAX_POLL_ATTEMPTS = 240;
const MAX_PROCESSING_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class DigitalHumanService {
  private readonly logger = new Logger(DigitalHumanService.name);

  constructor(
    private prisma: PrismaService,
    private providerFactory: DigitalHumanProviderFactory,
    private minio: MinioService,
    private distribution: DistributionService,
  ) {
    try {
      ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    } catch (err) {
      this.logger.warn(`ffmpeg 路径设置失败: ${(err as Error).message}`);
    }
  }

  async listAvatars(teamId: string) {
    return this.prisma.digitalHumanAvatar.findMany({ where: { teamId }, include: { _count: { select: { ips: true } } } });
  }

  async createAvatar(teamId: string, dto: CreateAvatarDto) {
    if (!dto.avatarKey || !dto.voiceKey) {
      throw new BadRequestException('真实数字人形象必须填写服务商 avatarKey 和 voiceKey');
    }
    return this.prisma.digitalHumanAvatar.create({ data: { teamId, ...dto } });
  }

  async updateAvatar(teamId: string, id: string, dto: UpdateAvatarDto) {
    const avatar = await this.prisma.digitalHumanAvatar.findFirst({ where: { id, teamId } });
    if (!avatar) throw new BadRequestException('数字人形象不存在');
    const updated = await this.prisma.digitalHumanAvatar.update({ where: { id }, data: dto });
    if (dto.provider && dto.provider !== avatar.provider) {
      await this.prisma.digitalHumanIp.updateMany({
        where: { teamId, avatarId: id },
        data: { provider: dto.provider },
      });
    }
    return updated;
  }

  async removeAvatar(teamId: string, id: string) {
    const avatar = await this.prisma.digitalHumanAvatar.findFirst({
      where: { id, teamId },
      include: { _count: { select: { ips: true } } },
    });
    if (!avatar) throw new BadRequestException('数字人形象不存在');
    if (avatar._count.ips > 0) throw new BadRequestException('请先解除该形象绑定的数字人 IP');
    await this.prisma.digitalHumanAvatar.delete({ where: { id } });
    return { deleted: true };
  }

  async listIps(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    const [list, total] = await Promise.all([
      this.prisma.digitalHumanIp.findMany({ where, include: { avatar: true }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.digitalHumanIp.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async createIp(teamId: string, dto: CreateIpDto) {
    let provider = dto.provider;
    if (dto.avatarId) {
      const avatar = await this.prisma.digitalHumanAvatar.findFirst({ where: { id: dto.avatarId, teamId } });
      if (!avatar) throw new BadRequestException('数字人形象不存在或不属于当前企业');
      provider = avatar.provider;
    }
    if (!dto.avatarId) throw new BadRequestException('真实数字人 IP 必须绑定已配置的数字人形象');
    return this.prisma.digitalHumanIp.create({ data: { teamId, ...dto, provider } });
  }

  async updateIp(teamId: string, id: string, dto: UpdateIpDto) {
    const ip = await this.prisma.digitalHumanIp.findFirst({ where: { id, teamId } });
    if (!ip) throw new BadRequestException('数字人 IP 不存在');
    if ('avatarId' in dto && !dto.avatarId) {
      throw new BadRequestException('真实数字人 IP 必须绑定已配置的数字人形象');
    }
    let provider = dto.provider;
    if (dto.avatarId) {
      const avatar = await this.prisma.digitalHumanAvatar.findFirst({ where: { id: dto.avatarId, teamId } });
      if (!avatar) throw new BadRequestException('数字人形象不存在或不属于当前企业');
      provider = avatar.provider;
    } else if (ip.avatarId && dto.provider) {
      const avatar = await this.prisma.digitalHumanAvatar.findFirst({ where: { id: ip.avatarId, teamId } });
      if (avatar) provider = avatar.provider;
    }
    return this.prisma.digitalHumanIp.update({
      where: { id },
      data: { ...dto, provider },
    });
  }

  async removeIp(teamId: string, id: string) {
    const ip = await this.prisma.digitalHumanIp.findFirst({
      where: { id, teamId },
      include: { _count: { select: { tasks: true } } },
    });
    if (!ip) throw new BadRequestException('数字人 IP 不存在');
    if (ip._count.tasks > 0) throw new BadRequestException('已有生成任务的数字人 IP 不能删除');
    await this.prisma.digitalHumanIp.delete({ where: { id } });
    return { deleted: true };
  }

  async generateVideo(teamId: string, userId: string, dto: GenerateVideoDto) {
    const ip = await this.prisma.digitalHumanIp.findFirst({ where: { id: dto.ipId, teamId } });
    if (!ip) throw new BadRequestException('数字人 IP 不存在');

    const avatar = ip.avatarId
      ? await this.prisma.digitalHumanAvatar.findFirst({ where: { id: ip.avatarId, teamId } })
      : null;

    const options: DigitalHumanGenerateOptions = {
      avatarKey: avatar?.avatarKey ?? undefined,
      voiceKey: avatar?.voiceKey ?? undefined,
      background: dto.background,
    };

    const providerName = (avatar?.provider || ip.provider || 'heygen').toLowerCase();
    const task = await this.prisma.digitalHumanTask.create({
      data: {
        teamId,
        ipId: dto.ipId,
        script: dto.script,
        background: dto.background || '#F3F4F6',
        videoUrl: null,
        status: 'processing',
        provider: providerName,
      },
    });

    try {
      const provider = this.providerFactory.get(providerName);
      const gen = await provider.generate(dto.script, options);
      if (!gen.videoUrl && !gen.taskId) {
        throw new Error('数字人服务商未返回视频地址或任务 ID');
      }
      const completed = Boolean(gen.videoUrl && (!gen.taskId || gen.videoUrl.startsWith('mock://')));
      const videoUrl = completed && gen.videoUrl && !gen.videoUrl.startsWith('mock://')
        ? await this.persistProviderVideo(teamId, task.id, gen.videoUrl)
        : gen.videoUrl || null;
      const updated = await this.prisma.digitalHumanTask.update({
        where: { id: task.id },
        data: {
          providerTaskId: gen.taskId || null,
          videoUrl,
          status: completed ? 'done' : 'processing',
        },
      });
      if (completed) {
        await this.prisma.digitalHumanIp.update({ where: { id: ip.id }, data: { videoCount: { increment: 1 } } });
      }
      void userId;
      return updated;
    } catch (err) {
      await this.prisma.digitalHumanTask.update({
        where: { id: task.id },
        data: { status: 'failed', error: (err as Error).message.slice(0, 4000) },
      });
      throw new ServiceUnavailableException('数字人视频生成失败：' + (err as Error).message);
    }
  }

  @Interval(15000)
  async pollProcessingTasks() {
    const tasks = await this.prisma.digitalHumanTask.findMany({
      where: { status: 'processing' },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    for (const task of tasks) {
      if (!task.providerTaskId) {
        await this.prisma.digitalHumanTask.updateMany({
          where: { id: task.id, status: 'processing' },
          data: {
            status: 'failed',
            error: '数字人任务缺少服务商任务 ID，无法继续轮询',
            lastPolledAt: new Date(),
          },
        });
        continue;
      }
      const beforePollReason = this.pollLimitReason(task.pollAttempts, task.createdAt);
      if (beforePollReason) {
        await this.prisma.digitalHumanTask.updateMany({
          where: { id: task.id, status: 'processing' },
          data: { status: 'failed', error: beforePollReason, lastPolledAt: new Date() },
        });
        continue;
      }

      const nextAttempt = task.pollAttempts + 1;
      const polledAt = new Date();
      try {
        const provider = this.providerFactory.get(task.provider || undefined);
        const result = await provider.pollStatus(task.providerTaskId);
        if (result.status === 'done' && result.videoUrl) {
          const videoUrl = result.videoUrl.startsWith('mock://')
            ? result.videoUrl
            : await this.persistProviderVideo(task.teamId, task.id, result.videoUrl);
          const updated = await this.prisma.digitalHumanTask.updateMany({
            where: { id: task.id, status: 'processing' },
            data: {
              status: 'done',
              videoUrl,
              error: null,
              pollAttempts: { increment: 1 },
              lastPolledAt: polledAt,
            },
          });
          if (updated.count === 1) {
            await this.prisma.digitalHumanIp.update({ where: { id: task.ipId }, data: { videoCount: { increment: 1 } } });
          }
        } else if (result.status === 'failed') {
          await this.prisma.digitalHumanTask.updateMany({
            where: { id: task.id, status: 'processing' },
            data: {
              status: 'failed',
              error: result.error || '服务商返回生成失败',
              pollAttempts: { increment: 1 },
              lastPolledAt: polledAt,
            },
          });
        } else if (result.status === 'processing') {
          const limitReason = this.pollLimitReason(nextAttempt, task.createdAt, polledAt.getTime());
          await this.prisma.digitalHumanTask.updateMany({
            where: { id: task.id, status: 'processing' },
            data: {
              status: limitReason ? 'failed' : 'processing',
              error: limitReason,
              pollAttempts: { increment: 1 },
              lastPolledAt: polledAt,
            },
          });
        } else {
          throw new Error(
            result.status === 'done'
              ? '服务商标记任务完成但未返回视频地址'
              : `服务商返回未知任务状态：${result.status || '空'}`,
          );
        }
      } catch (err) {
        const providerError = (err as Error).message.slice(0, 3500);
        const limitReason = this.pollLimitReason(nextAttempt, task.createdAt, polledAt.getTime());
        const error = limitReason ? `${limitReason}；最后错误：${providerError}` : providerError;
        await this.prisma.digitalHumanTask.updateMany({
          where: { id: task.id, status: 'processing' },
          data: {
            status: limitReason ? 'failed' : 'processing',
            error,
            pollAttempts: { increment: 1 },
            lastPolledAt: polledAt,
          },
        });
        this.logger.warn(`轮询数字人任务失败 task=${task.id}: ${providerError}`);
      }
    }
    return { checked: tasks.length };
  }

  private pollLimitReason(attempts: number, createdAt: Date, now = Date.now()): string | null {
    if (attempts >= MAX_POLL_ATTEMPTS) {
      return `数字人任务轮询已达最大次数 ${MAX_POLL_ATTEMPTS}`;
    }
    if (now - createdAt.getTime() >= MAX_PROCESSING_MS) {
      return '数字人任务生成超过 6 小时，已终止轮询';
    }
    return null;
  }

  private async persistProviderVideo(teamId: string, taskId: string, remoteUrl: string) {
    const buffer = await downloadExternalBuffer(remoteUrl);
    const key = `teams/${teamId}/digital-human/${taskId}.mp4`;
    await this.minio.upload(key, buffer, 'video/mp4');
    return this.minio.publicUrl(key);
  }

  private async downloadAsset(url: string, maxBytes = 512 * 1024 * 1024) {
    return await this.minio.downloadSignedPublicUrl(url, maxBytes) || await downloadExternalBuffer(url, maxBytes);
  }

  private configureBackgroundFilter(command: ReturnType<typeof ffmpeg>) {
    return command
      .complexFilter([
        '[1:v][0:v]scale2ref=w=iw:h=ih[bgraw][video]',
        '[bgraw]setsar=1[bg]',
        '[video]setsar=1,chromakey=0x00FF00:0.3:0.1[fg]',
        '[bg][fg]overlay=0:0:eof_action=repeat,setsar=1[v]',
      ])
      .outputOptions(['-map [v]', '-map 0:a?']);
  }

  async replaceBackground(teamId: string, videoUrl: string, bgUrl: string) {
    if (videoUrl.startsWith('mock://')) {
      const task = await this.prisma.digitalHumanTask.findFirst({ where: { teamId, videoUrl } });
      if (!task) throw new BadRequestException('数字人视频不存在或不属于当前企业');
      const newUrl = `mock://digital-human/${task.id}-background-${Date.now()}.mp4`;
      await this.prisma.digitalHumanTask.update({
        where: { id: task.id },
        data: { background: bgUrl, videoUrl: newUrl },
      });
      return { videoUrl: newUrl, background: bgUrl };
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputPath = join(tmpdir(), `dh-bg-input-${stamp}.mp4`);
    const bgPath = join(tmpdir(), `dh-bg-image-${stamp}`);
    const outputPath = join(tmpdir(), `dh-bg-output-${stamp}.mp4`);
    const files = [inputPath, bgPath, outputPath];
    try {
      const [video, background] = await Promise.all([
        this.downloadAsset(videoUrl),
        this.downloadAsset(bgUrl, 50 * 1024 * 1024),
      ]);
      writeFileSync(inputPath, video);
      writeFileSync(bgPath, background);
      await new Promise<void>((resolve, reject) => {
        this.configureBackgroundFilter(ffmpeg(inputPath).input(bgPath))
          .save(outputPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err));
      });
      const buffer = readFileSync(outputPath);
      const key = `digital-human/bg/${Date.now()}.mp4`;
      await this.minio.upload(key, buffer, 'video/mp4');
      const newUrl = this.minio.publicUrl(key);
      await this.prisma.digitalHumanTask.updateMany({
        where: { teamId, videoUrl },
        data: { background: bgUrl, videoUrl: newUrl },
      });
      return { videoUrl: newUrl, background: bgUrl };
    } catch (err) {
      throw new ServiceUnavailableException(`背景替换失败：${(err as Error).message}`);
    } finally {
      for (const file of files) {
        try {
          unlinkSync(file);
        } catch {
          // 文件可能尚未创建
        }
      }
    }
  }

  async mixcut(teamId: string, userId: string, avatarIds: string[], script: string) {
    const segments: string[] = [];
    for (const avatarId of avatarIds) {
      try {
        const seg = await this.generateVideo(teamId, userId, { ipId: avatarId, script });
        if (seg.videoUrl) segments.push(seg.videoUrl);
      } catch (err) {
        this.logger.warn(`mixcut 生成片段失败 avatar=${avatarId}: ${(err as Error).message}`);
      }
    }
    if (segments.length === 0) {
      throw new Error('混剪失败：未提供视频片段');
    }
    if (segments.length === 1) {
      return { videoUrl: segments[0], segments };
    }
    if (segments.some((url) => url.startsWith('mock://'))) {
      return { videoUrl: `mock://digital-human/mixcut/${Date.now()}.mp4`, segments };
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputs = await Promise.all(segments.map((url) => this.downloadAsset(url)));
    const inputPaths = inputs.map((_, index) => join(tmpdir(), `dh-mixcut-${stamp}-${index}.mp4`));
    inputPaths.forEach((path, index) => writeFileSync(path, inputs[index]));
    const outputPath = join(tmpdir(), `dh-mixcut-output-${stamp}.mp4`);
    const files = [...inputPaths, outputPath];
    try {
      await new Promise<void>((resolve, reject) => {
        const cmd = ffmpeg(inputPaths[0]);
        for (let i = 1; i < inputPaths.length; i++) cmd.input(inputPaths[i]);
        cmd
          .outputOptions([
            `-filter_complex concat=n=${inputPaths.length}:v=1:a=0`,
            '-map [v]',
          ])
          .save(outputPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err));
      });
      const buffer = readFileSync(outputPath);
      const key = `digital-human/mixcut/${Date.now()}.mp4`;
      await this.minio.upload(key, buffer, 'video/mp4');
      const newUrl = this.minio.publicUrl(key);
      return { videoUrl: newUrl, segments };
    } catch (err) {
      throw new ServiceUnavailableException(`数字人混剪失败：${(err as Error).message}`);
    } finally {
      for (const file of files) {
        try {
          unlinkSync(file);
        } catch {
          // 文件可能尚未创建
        }
      }
    }
  }

  async listTasks(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    const [list, total] = await Promise.all([
      this.prisma.digitalHumanTask.findMany({ where, include: { ip: true }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.digitalHumanTask.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async removeTask(teamId: string, id: string) {
    const task = await this.prisma.digitalHumanTask.findFirst({ where: { id, teamId } });
    if (!task) throw new BadRequestException('数字人任务不存在');
    if (task.status === 'processing' || task.status === 'pending') {
      throw new BadRequestException('处理中任务不能删除');
    }
    await this.prisma.digitalHumanTask.delete({ where: { id } });
    return { deleted: true };
  }

  async publishTask(teamId: string, userId: string, taskId: string, accountIds: string[], scheduledAt?: string) {
    const task = await this.prisma.digitalHumanTask.findFirst({ where: { id: taskId, teamId }, include: { ip: true } });
    if (!task) throw new BadRequestException('数字人任务不存在');
    if (task.status !== 'done' || !task.videoUrl) throw new BadRequestException('数字人视频尚未生成完成');
    const script = task.script || '';
    const content = await this.prisma.content.create({
      data: {
        teamId,
        type: 'video',
        title: `${task.ip.name}｜${script.slice(0, 60)}`,
        body: script,
        videoUrl: task.videoUrl,
        source: 'digital_human',
        createdBy: userId,
      },
    });
    const publishTask = await this.distribution.publish(teamId, userId, { contentId: content.id, accountIds, scheduledAt });
    return { content, task: publishTask };
  }

  async strategyAdvice(teamId: string) {
    const [avatars, ips, tasks] = await Promise.all([
      this.prisma.digitalHumanAvatar.findMany({ where: { teamId }, select: { provider: true } }),
      this.prisma.digitalHumanIp.findMany({ where: { teamId }, select: { provider: true, persona: true, videoCount: true, totalPlay: true } }),
      this.prisma.digitalHumanTask.findMany({ where: { teamId }, select: { background: true, status: true }, take: 500 }),
    ]);

    if (avatars.length === 0 && ips.length === 0) {
      return { advice: '', ratio: '', scenes: [] as string[] };
    }

    const providerCount: Record<string, number> = {};
    for (const a of avatars) {
      providerCount[a.provider] = (providerCount[a.provider] || 0) + 1;
    }
    const providers = Object.entries(providerCount)
      .sort((a, b) => b[1] - a[1])
      .map((p) => p[0]);

    const sceneCount: Record<string, number> = {};
    for (const t of tasks) {
      if (t.background) sceneCount[t.background] = (sceneCount[t.background] || 0) + 1;
    }
    const scenes = Object.entries(sceneCount)
      .sort((a, b) => b[1] - a[1])
      .map((s) => s[0])
      .slice(0, 5);

    const totalIps = ips.length;
    const totalVideo = ips.reduce((sum, i) => sum + (i.videoCount || 0), 0);
    const totalPlay = ips.reduce((sum, i) => sum + (i.totalPlay || 0), 0);

    const advice = `当前数字人矩阵共 ${totalIps} 个 IP，累计生成视频 ${totalVideo} 条，总播放 ${totalPlay}。主要服务商：${providers.join('、') || '未配置'}。建议持续扩充 IP 数量、复用爆款脚本并按场景分发。`;
    const ratio = `IP:视频 = 1:${totalIps > 0 ? Math.max(1, Math.round(totalVideo / totalIps)) : 1}`;

    return { advice, ratio, scenes };
  }
}
