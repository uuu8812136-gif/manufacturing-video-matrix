import { Module } from '@nestjs/common';
import { DigitalHumanService } from './digital-human.service';
import { DigitalHumanController } from './digital-human.controller';
import { DigitalHumanProviderFactory } from './digital-human.provider';
import { DistributionModule } from '../distribution/distribution.module';

@Module({
  imports: [DistributionModule],
  controllers: [DigitalHumanController],
  providers: [DigitalHumanService, DigitalHumanProviderFactory],
})
export class DigitalHumanModule {}
