import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrawlService } from './crawl.service';

describe('CrawlService availability', () => {
  const createService = (values: Record<string, string | undefined>) => {
    const config = {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
    return new CrawlService(config);
  };

  it('rejects real-mode crawl before returning a misleading empty success', () => {
    const service = createService({ NODE_ENV: 'production', CRAWL_MODE: 'real' });

    expect(() => service.assertAvailable()).toThrow(ServiceUnavailableException);
    expect(() => service.assertAvailable()).toThrow('CRAWL_MODE=real');
  });

  it('accepts a fully configured API crawl service', () => {
    const service = createService({
      NODE_ENV: 'production',
      CRAWL_MODE: 'real',
      CRAWL_API_URL: 'https://crawl.example.com/api',
      CRAWL_API_KEY: 'test-key',
    });

    expect(() => service.assertAvailable()).not.toThrow();
  });

  it('accepts explicitly enabled scrape mode', () => {
    const service = createService({
      NODE_ENV: 'production',
      CRAWL_MODE: 'real',
      CRAWL_ENABLE_SCRAPE: 'true',
    });

    expect(() => service.assertAvailable()).not.toThrow();
  });
});
