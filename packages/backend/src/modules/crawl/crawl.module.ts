import { Global, Module } from '@nestjs/common';
import { CrawlService } from './crawl.service';

@Global()
@Module({
  providers: [CrawlService],
  exports: [CrawlService],
})
export class CrawlModule {}
