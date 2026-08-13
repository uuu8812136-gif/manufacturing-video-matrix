import { Module } from '@nestjs/common';
import { DistributionService } from './distribution.service';
import { DistributionController } from './distribution.controller';
import { BullModule } from '@nestjs/bullmq';
import { PUBLISH_QUEUE } from './distribution.constants';
import { PublishProcessor } from './publish.processor';
import { AiCreationModule } from '../ai-creation/ai-creation.module';

@Module({
  imports: [BullModule.registerQueue({ name: PUBLISH_QUEUE }), AiCreationModule],
  controllers: [DistributionController],
  providers: [DistributionService, PublishProcessor],
  exports: [DistributionService],
})
export class DistributionModule {}
