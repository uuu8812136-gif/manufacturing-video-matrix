import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { prepareSafeExternalRequest } from '../../common/utils/external-url.util';
import { runtimeMode } from '../../config/runtime-mode';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type DeepSeekThinkingMode = 'enabled' | 'disabled';

function resolveDeepSeekModel(configuredModel?: string): { model: string; thinking: DeepSeekThinkingMode } {
  const model = configuredModel?.trim() || 'deepseek-v4-flash';

  // 旧模型名将在 DeepSeek 侧下线。这里在应用侧完成映射，避免旧 .env 突然失效，
  // 同时保留 chat（非思考）和 reasoner（思考）原有语义。
  if (model === 'deepseek-chat') return { model: 'deepseek-v4-flash', thinking: 'disabled' };
  if (model === 'deepseek-reasoner') return { model: 'deepseek-v4-flash', thinking: 'enabled' };
  return { model, thinking: 'disabled' };
}

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly thinking: DeepSeekThinkingMode;
  private readonly mode: string;

  constructor(private config: ConfigService) {
    this.apiKey = config.get<string>('DEEPSEEK_API_KEY') || '';
    this.baseUrl = config.get<string>('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com';
    const resolvedModel = resolveDeepSeekModel(config.get<string>('DEEPSEEK_MODEL'));
    this.model = resolvedModel.model;
    const configuredThinking = config.get<string>('DEEPSEEK_THINKING')?.trim().toLowerCase();
    this.thinking = configuredThinking === 'enabled' || configuredThinking === 'disabled'
      ? configuredThinking
      : resolvedModel.thinking;
    this.mode = runtimeMode(config, 'AI_MODE');
  }

  get isMock() {
    return this.mode === 'mock';
  }

  async chat(messages: ChatMessage[], temperature = 0.7): Promise<string> {
    if (this.isMock) {
      return this.mockChat(messages);
    }
    if (!this.apiKey) throw new ServiceUnavailableException('AI_MODE=real，但未配置 DEEPSEEK_API_KEY');
    try {
      const target = await prepareSafeExternalRequest(
        `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
        { requireHttps: true },
      );
      const resp = await axios.post(
        target.url.toString(),
        {
          model: this.model,
          messages,
          temperature,
          thinking: { type: this.thinking },
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
          maxRedirects: 0,
          ...target.transport,
        },
      );
      return resp.data?.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      this.logger.error(`DeepSeek call failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(`AI service call failed: ${(err as Error).message}`);
    }
  }

  private mockChat(messages: ChatMessage[]): string {
    const text = messages.map((m) => m.content).join('\n').toLowerCase();

    if (this.includesAny(text, ['拆解', '鎷嗚В', 'teardown'])) {
      return JSON.stringify({
        structure: { hook: '痛点开场', body: '专业科普与产品证明', cta: '引导咨询或留资' },
        script: {
          framework: '痛点-解释-方案-行动',
          keywords: ['源头工厂', '产品参数', '应用场景'],
          expressions: ['这样选更稳', '一眼看懂差别'],
        },
        emotionCurve: ['好奇', '共鸣', '信任', '行动'],
        tags: ['#制造业', '#源头厂家', '#产品展示'],
        music: '工业科技感背景音乐',
        visual: '工厂实拍、参数字幕、产品细节特写',
        duration: '45s',
        report: 'Mock teardown report generated without DEEPSEEK_API_KEY.',
      });
    }

    if (this.includesAny(text, ['二创', '浜屽垱', 'recreation'])) {
      return JSON.stringify({
        title: '源头工厂教你避开采购误区',
        body: '用客户常见痛点开场，接入企业产品参数与应用场景，最后引导咨询报价。',
        storyboard: '1. 痛点字幕开场 2. 产品细节展示 3. 参数对比 4. 留资引导',
        voiceScript: '很多采购不是买贵了，而是没看懂关键参数。停顿。看这三个点。',
        altTitles: ['采购前先看这3点', '源头工厂的避坑清单', '制造业产品怎么选不踩坑'],
        tags: ['制造业', '源头工厂', '采购避坑'],
      });
    }

    if (this.includesAny(text, ['标签', '鏍囩', 'tag'])) {
      return JSON.stringify(['#制造业', '#源头厂家', '#产品展示', '#工厂实拍', '#B2B获客']);
    }

    if (this.includesAny(text, ['标题', '鏍囬', 'title'])) {
      return JSON.stringify([
        '源头工厂教你看懂这3个关键参数',
        '采购前先看：这种产品为什么更耐用',
        '制造业老板都在用的选型思路',
        '别只看价格，真正影响效果的是这些细节',
        '工厂实测：产品好不好看这几点',
      ]);
    }

    return 'Mock AI response: configure DEEPSEEK_API_KEY to use the real model.';
  }

  private includesAny(text: string, needles: string[]): boolean {
    return needles.some((needle) => text.includes(needle.toLowerCase()));
  }
}
