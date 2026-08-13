import { Module } from '@nestjs/common';
import { HitRecreationService } from './hit-recreation.service';
import { HitRecreationController } from './hit-recreation.controller';
import { OriginalityService } from './originality.service';
import { DistributionModule } from '../distribution/distribution.module';

@Module({
  imports: [DistributionModule],
  controllers: [HitRecreationController],
  providers: [HitRecreationService, OriginalityService],
  exports: [HitRecreationService],
})
export class HitRecreationModule {}
