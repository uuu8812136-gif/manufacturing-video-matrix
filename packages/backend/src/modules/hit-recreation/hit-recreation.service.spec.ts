import { ServiceUnavailableException } from '@nestjs/common';
import { HitRecreationService } from './hit-recreation.service';

describe('HitRecreationService crawl availability', () => {
  it('checks the crawl service before treating an empty peer list as success', async () => {
    const prisma = {
      peerAccount: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const crawl = {
      assertAvailable: jest.fn(() => {
        throw new ServiceUnavailableException('crawl not configured');
      }),
    };
    const service = new HitRecreationService(
      prisma as never,
      {} as never,
      crawl as never,
      {} as never,
      {} as never,
    );

    await expect(service.crawlPeers('team-1')).rejects.toThrow('crawl not configured');
    expect(crawl.assertAvailable).toHaveBeenCalledTimes(1);
    expect(prisma.peerAccount.findMany).not.toHaveBeenCalled();
  });
});
