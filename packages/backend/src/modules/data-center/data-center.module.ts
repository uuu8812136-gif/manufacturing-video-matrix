import { Module } from '@nestjs/common';
import { DataCenterService } from './data-center.service';
import { DataCenterController } from './data-center.controller';

@Module({
  controllers: [DataCenterController],
  providers: [DataCenterService],
  exports: [DataCenterService],
})
export class DataCenterModule {}
