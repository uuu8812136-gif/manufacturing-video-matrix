import { OriginalityService } from './originality.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('OriginalityService', () => {
  let service: OriginalityService;
  const prisma = {
    recreationContent: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
  const config = { get: (_k: string) => undefined } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.recreationContent.findMany as jest.Mock).mockResolvedValue([]);
    service = new OriginalityService(prisma, config);
  });

  it('simhash same text distance 0', () => {
    const a = (service as any).simhash('佛山门窗源头工厂直发隔音40分贝');
    const b = (service as any).simhash('佛山门窗源头工厂直发隔音40分贝');
    const dist = (service as any).hammingDistance(a, b);
    expect(dist).toBe(0);
  });

  it('simhash different text distance > 0', () => {
    const a = (service as any).simhash('佛山门窗源头工厂直发隔音40分贝');
    const b = (service as any).simhash('今天天气不错适合出去玩一下');
    const dist = (service as any).hammingDistance(a, b);
    expect(dist).toBeGreaterThan(0);
  });

  it('simhash empty text returns 0', () => {
    const h = (service as any).simhash('');
    expect(h).toBe(0n);
  });

  it('checkOriginality returns score in 0-1 with empty history', async () => {
    const r = await service.checkOriginality('一段全新的原创文案内容', 'team1');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(Array.isArray(r.similarIds)).toBe(true);
    expect(r.score).toBe(1);
  });

  it('checkOriginality with matching history returns lower score', async () => {
    (prisma.recreationContent.findMany as jest.Mock).mockResolvedValue([
      { id: 'h1', body: '一段全新的原创文案内容' },
    ]);
    const r = await service.checkOriginality('一段全新的原创文案内容', 'team1');
    expect(r.score).toBeLessThan(1);
  });

  it('does not treat unrelated Chinese copy as a near duplicate', async () => {
    (prisma.recreationContent.findMany as jest.Mock).mockResolvedValue([
      { id: 'h1', body: '买门窗要查看型材、五金品牌和售后质保，再结合现场尺寸确定方案。' },
    ]);
    const r = await service.checkOriginality('航空级框架配合数控加工轨迹，重点展示密封工艺与安装验收清单。', 'team1');
    expect(r.score).toBeGreaterThanOrEqual(0.7);
  });

  it('checkOriginality excludes excludeId', async () => {
    (prisma.recreationContent.findMany as jest.Mock).mockResolvedValue([
      { id: 'h1', body: '一段全新的原创文案内容' },
    ]);
    const r = await service.checkOriginality('一段全新的原创文案内容', 'team1', 'h1');
    expect(r.score).toBe(1);
  });

  it('fails closed when history cannot be queried', async () => {
    (prisma.recreationContent.findMany as jest.Mock).mockRejectedValue(new Error('db fail'));
    await expect(service.checkOriginality('一段全新的原创文案内容', 'team1'))
      .rejects.toThrow('无法给出可信评分');
  });
});
