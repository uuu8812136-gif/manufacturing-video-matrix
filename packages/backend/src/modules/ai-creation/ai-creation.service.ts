import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { sensitiveUtil } from '../../common/utils/sensitive.util';
import { parsePage } from '../../common/utils/page.util';
import { GenerateScriptDto, GenerateTitlesDto, GenerateTagsDto, CreateMaterialDto, MultiVersionsDto, VideoToolDto } from './dto/ai.dto';
import { VideoProcessorService } from './video-processor.service';
import { TtsService } from './tts.service';
import { SttService } from './stt.service';
import { parseAiJson } from '../../common/utils/ai-json.util';

export const AI_TEMPLATES = [
  { value: 'product_intro', label: '产品介绍', prompt: '产品名称+核心参数+应用场景+竞争优势' },
  { value: 'process', label: '工艺展示', prompt: '工艺名称+流程步骤+技术优势+质量保障' },
  { value: 'customer_case', label: '客户案例', prompt: '客户背景+痛点需求+解决方案+合作成果' },
  { value: 'industry_knowledge', label: '行业知识', prompt: '行业话题+专业解读+数据支撑+互动引导' },
  { value: 'recruitment', label: '招聘宣传', prompt: '岗位介绍+企业福利+发展空间+应聘方式' },
  { value: 'digital_human', label: '数字人播报', prompt: '开场问候+内容主体+行动号召+品牌口播' },
];

@Injectable()
export class AiCreationService {
  private readonly logger = new Logger(AiCreationService.name);

  constructor(
    private prisma: PrismaService,
    private ai: AiGatewayService,
    private videoProcessor: VideoProcessorService,
    private ttsService: TtsService,
    private sttService: SttService,
  ) {}

  templates() {
    return AI_TEMPLATES;
  }

  async generateScript(teamId: string, userId: string, dto: GenerateScriptDto) {
    const tpl = AI_TEMPLATES.find((t) => t.value === dto.templateType);
    const system = '你是制造业短视频营销专家，擅长撰写高转化的 B2B 短视频脚本。输出为纯文本，包含开头钩子、内容主体、结尾 CTA。';
    const user = `模板：${tpl?.label || dto.templateType}（${tpl?.prompt || ''}）\n主题：${dto.topic}\n产品参数：${dto.productParams || '无'}\n风格：${dto.style || '专业实用'}`;
    const output = await this.ai.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    await this.prisma.aiRecord.create({
      data: { teamId, type: 'script', input: user, output, model: this.ai.isMock ? 'mock' : 'deepseek', createdBy: userId },
    });
    return { content: output };
  }

  async generateTitles(teamId: string, userId: string, dto: GenerateTitlesDto) {
    const output = await this.ai.chat([
      { role: 'system', content: '你是短视频爆款标题专家，输出 JSON 数组，5个备选标题，简洁有冲击力。' },
      { role: 'user', content: `主题：${dto.topic}\n风格：${dto.style || '吸睛'}\n请只输出 JSON 数组。` },
    ]);
    let titles: string[] = [];
    try {
      titles = parseAiJson<string[]>(output, '标题模型');
    } catch (error) {
      if (!this.ai.isMock) throw error;
      titles = [output];
    }
    await this.prisma.aiRecord.create({
      data: { teamId, type: 'title', input: dto.topic, output, model: this.ai.isMock ? 'mock' : 'deepseek', createdBy: userId },
    });
    return { titles };
  }

  async generateTags(teamId: string, userId: string, dto: GenerateTagsDto) {
    const output = await this.ai.chat([
      { role: 'system', content: '你是短视频话题标签专家，输出 JSON 数组，8-10个相关话题标签（含#）。' },
      { role: 'user', content: `主题：${dto.topic}\n请只输出 JSON 数组。` },
    ]);
    let tags: string[] = [];
    try {
      tags = parseAiJson<string[]>(output, '标签模型');
    } catch (error) {
      if (!this.ai.isMock) throw error;
      tags = ['#制造业', '#源头厂家'];
    }
    await this.prisma.aiRecord.create({
      data: { teamId, type: 'tag', input: dto.topic, output, model: this.ai.isMock ? 'mock' : 'deepseek', createdBy: userId },
    });
    return { tags };
  }

  async sensitiveCheck(text: string) {
    const result = sensitiveUtil.check(text);
    return result;
  }

  async listMaterials(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.type) where.type = query.type;
    if (query.category) where.category = query.category;
    const [list, total] = await Promise.all([
      this.prisma.material.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.material.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async createMaterial(teamId: string, dto: CreateMaterialDto) {
    return this.prisma.material.create({ data: { teamId, ...dto } });
  }

  async removeMaterial(teamId: string, id: string) {
    return this.prisma.material.deleteMany({ where: { id, teamId } });
  }

  async extractText(videoUrl: string) {
    try {
      return await this.sttService.extractText(videoUrl);
    } catch (err) {
      if (!this.ai.isMock) throw err;
      this.logger.warn(`STT extraction failed, falling back to mock text: ${(err as Error).message}`);
      return { text: `Mock extracted transcript for ${videoUrl}` };
    }
  }

  async synthesizeVoice(text: string, voice?: string, options?: { rate?: number; pitch?: number }) {
    try {
      return await this.ttsService.synthesize(text, voice, options);
    } catch (err) {
      if (!this.ai.isMock) throw err;
      this.logger.warn(`TTS synthesis failed, falling back to mock audio: ${(err as Error).message}`);
      const duration = Math.max(1, Math.round((text.length / 6) * 10) / 10);
      return { url: `mock://ai-creation/tts/${Date.now()}.mp3`, duration };
    }
  }

  async mixcutClips(teamId: string, userId: string, clips: string[], options?: { watermark?: string; ratio?: string }) {
    try {
      const url = await this.videoProcessor.mixcut(clips, options);
      await this.prisma.aiRecord.create({
        data: {
          teamId,
          type: 'mixcut',
          input: JSON.stringify({ clips, options }),
          output: url,
          model: 'ffmpeg',
          createdBy: userId,
        },
      });
      return { url };
    } catch (err) {
      if (!this.ai.isMock) throw err;
      this.logger.warn(`Video mixcut failed, falling back to mock video: ${(err as Error).message}`);
      return { url: `mock://ai-creation/mixcut/${Date.now()}.mp4` };
    }
  }

  async adaptVideoRatio(teamId: string, userId: string, videoUrl: string, ratio: string) {
    try {
      const url = await this.videoProcessor.adaptRatio(videoUrl, ratio);
      await this.prisma.aiRecord.create({
        data: {
          teamId,
          type: 'mixcut',
          input: JSON.stringify({ videoUrl, ratio }),
          output: url,
          model: 'ffmpeg',
          createdBy: userId,
        },
      });
      return { url };
    } catch (err) {
      if (!this.ai.isMock) throw err;
      this.logger.warn(`Video ratio adaptation failed, falling back to mock video: ${(err as Error).message}`);
      return { url: `mock://ai-creation/adapt/${ratio}/${Date.now()}.mp4` };
    }
  }

  async videoTool(teamId: string, userId: string, dto: VideoToolDto) {
    let url: string;
    if (dto.operation === 'gif') url = await this.videoProcessor.convertToGif(dto.videoUrl);
    else if (dto.operation === 'speed') url = await this.videoProcessor.changeSpeed(dto.videoUrl, dto.speed ?? 1);
    else url = await this.videoProcessor.cropVideo(dto.videoUrl, dto.start ?? 0, dto.duration ?? 10);
    await this.prisma.aiRecord.create({
      data: { teamId, type: `video_${dto.operation}`, input: JSON.stringify(dto), output: url, model: 'ffmpeg', createdBy: userId },
    });
    return { url };
  }

  async generateMultiVersions(teamId: string, userId: string, dto: MultiVersionsDto) {
    try {
      const count = Math.min(Math.max(dto.count ?? 3, 1), 5);
      const versions: string[] = [];
      for (let i = 0; i < count; i++) {
        const output = await this.ai.chat([
          { role: 'system', content: '你是制造业短视频脚本专家，针对同一主题生成不同角度与风格的脚本版本，直接输出脚本正文。' },
          { role: 'user', content: `主题：${dto.topic}\n风格：${dto.style || '多样化'}\n请输出第 ${i + 1} 版脚本，角度与其他版本差异化。` },
        ]);
        versions.push(output);
      }
      await this.prisma.aiRecord.create({
        data: {
          teamId,
          type: 'multiversion',
          input: dto.topic,
          output: JSON.stringify(versions),
          model: this.ai.isMock ? 'mock' : 'deepseek',
          createdBy: userId,
        },
      });
      return { versions };
    } catch (err) {
      throw err;
    }
  }
}
