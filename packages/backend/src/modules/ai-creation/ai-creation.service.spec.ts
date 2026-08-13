import { AiCreationService } from './ai-creation.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoProcessorService } from './video-processor.service';
import { TtsService } from './tts.service';
import { SttService } from './stt.service';

describe('AiCreationService', () => {
  let service: AiCreationService;
  const prisma = {
    aiRecord: { create: jest.fn().mockResolvedValue({}) },
    material: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  } as unknown as PrismaService;
  const ai = {
    chat: jest.fn(),
    isMock: true,
  } as unknown as AiGatewayService;
  const videoProcessor = {} as unknown as VideoProcessorService;
  const tts = {} as unknown as TtsService;
  const stt = {} as unknown as SttService;

  beforeEach(() => {
    jest.clearAllMocks();
    (ai.chat as jest.Mock).mockResolvedValue('mock content');
    service = new AiCreationService(prisma, ai, videoProcessor, tts, stt);
  });

  it('templates returns list', () => {
    const r = service.templates();
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBeGreaterThan(0);
  });

  it('generateScript returns content and records ai', async () => {
    const r = await service.generateScript('team1', 'u1', {
      templateType: 'product_intro',
      topic: '门窗',
    });
    expect(r).toHaveProperty('content');
    expect(r.content).toBe('mock content');
    expect(prisma.aiRecord.create).toHaveBeenCalled();
  });

  it('generateTitles returns titles array from JSON', async () => {
    (ai.chat as jest.Mock).mockResolvedValue('["标题一","标题二","标题三"]');
    const r = await service.generateTitles('team1', 'u1', { topic: '门窗' });
    expect(r).toHaveProperty('titles');
    expect(Array.isArray(r.titles)).toBe(true);
    expect(r.titles.length).toBe(3);
  });

  it('generateTitles handles non-JSON output', async () => {
    (ai.chat as jest.Mock).mockResolvedValue('plain text title');
    const r = await service.generateTitles('team1', 'u1', { topic: '门窗' });
    expect(r.titles).toEqual(['plain text title']);
  });

  it('generateTags returns tags array from JSON', async () => {
    (ai.chat as jest.Mock).mockResolvedValue('["#制造业","#源头厂家"]');
    const r = await service.generateTags('team1', 'u1', { topic: '门窗' });
    expect(r).toHaveProperty('tags');
    expect(Array.isArray(r.tags)).toBe(true);
    expect(r.tags).toContain('#制造业');
  });

  it('generateTags falls back on non-JSON output', async () => {
    (ai.chat as jest.Mock).mockResolvedValue('not json');
    const r = await service.generateTags('team1', 'u1', { topic: '门窗' });
    expect(r.tags).toEqual(['#制造业', '#源头厂家']);
  });

  it('sensitiveCheck returns check result with hit and words', async () => {
    const r = await service.sensitiveCheck('manufacturing video 2025');
    expect(r).toHaveProperty('hit');
    expect(r).toHaveProperty('words');
    expect(Array.isArray(r.words)).toBe(true);
  });

  it('listMaterials returns paginated result', async () => {
    const r = await service.listMaterials('team1', { page: 1, pageSize: 10 });
    expect(r).toHaveProperty('list');
    expect(r).toHaveProperty('total');
    expect(r).toHaveProperty('page');
    expect(r).toHaveProperty('pageSize');
  });

  it('createMaterial calls prisma create', async () => {
    const dto = { name: 'm', type: 'video', url: 'http://x' };
    (prisma.material.create as jest.Mock) = jest.fn().mockResolvedValue({ id: '1', ...dto });
    const r = await service.createMaterial('team1', dto as any);
    expect(r).toHaveProperty('id');
    expect(prisma.material.create).toHaveBeenCalled();
  });

  it('extractText degrades on stt failure', async () => {
    const failingStt = { extractText: jest.fn().mockRejectedValue(new Error('fail')) } as unknown as SttService;
    const s = new AiCreationService(prisma, ai, videoProcessor, tts, failingStt);
    const r = await s.extractText('http://x');
    expect(r).toHaveProperty('text');
  });

  it('synthesizeVoice degrades on tts failure', async () => {
    const failingTts = { synthesize: jest.fn().mockRejectedValue(new Error('fail')) } as unknown as TtsService;
    const s = new AiCreationService(prisma, ai, videoProcessor, failingTts, stt);
    const r = await s.synthesizeVoice('hello');
    expect(r).toHaveProperty('url');
  });

  it('mixcutClips degrades on videoProcessor failure', async () => {
    const failingVp = { mixcut: jest.fn().mockRejectedValue(new Error('fail')) } as unknown as VideoProcessorService;
    const s = new AiCreationService(prisma, ai, failingVp, tts, stt);
    const r = await s.mixcutClips('team1', 'u1', ['http://a']);
    expect(r).toHaveProperty('url');
  });

  it('adaptVideoRatio degrades on videoProcessor failure', async () => {
    const failingVp = { adaptRatio: jest.fn().mockRejectedValue(new Error('fail')) } as unknown as VideoProcessorService;
    const s = new AiCreationService(prisma, ai, failingVp, tts, stt);
    const r = await s.adaptVideoRatio('team1', 'u1', 'http://a', '9:16');
    expect(r).toHaveProperty('url');
  });

  it('generateMultiVersions returns versions array', async () => {
    (ai.chat as jest.Mock).mockResolvedValue('version text');
    const r = await service.generateMultiVersions('team1', 'u1', { topic: '门窗', count: 3 });
    expect(r).toHaveProperty('versions');
    expect(Array.isArray(r.versions)).toBe(true);
    expect(r.versions.length).toBe(3);
  });
});
