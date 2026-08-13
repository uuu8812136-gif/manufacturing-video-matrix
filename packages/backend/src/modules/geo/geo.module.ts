import { Module } from '@nestjs/common';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';
import { GeoProviderFactory } from './geo-provider.service';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';

@Module({
  imports: [AiGatewayModule],
  controllers: [GeoController],
  providers: [GeoService, GeoProviderFactory],
})
export class GeoModule {}
